/**
 * 马盈盈大厨食堂 Cloudflare Pages advanced-mode Worker
 * Required binding: D1 DB. CHEF_PIN (8+ chars) is only needed for management.
 */
const h={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const send=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:h});
const fail=(error,status=400)=>send({error},status);
const emojis=['🍚','🍜','🍲','🍗','🥩','🥗','🍰','🥤','🍓','🍽️','🍳','🍝','🍔','🍕','🥟','🍛','🍤','🍮'];
const statuses=['待制作','制作中','已完成','已取消'];
const valid=(v,min,max)=>typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max;
async function readJson(req){
  const size=Number(req.headers.get('content-length')||0);
  if(size>32000)throw new Error('请求内容过大');
  let body;
  try{body=await req.json();}catch{throw new Error('请求格式不正确');}
  if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('请求格式不正确');
  return body;
}
function chefAuth(req,env){
  if(typeof env.CHEF_PIN!=='string'||env.CHEF_PIN.length<8)return fail('请先在 Cloudflare 设置 CHEF_PIN 管理密码（至少 8 位）',503);
  if(req.headers.get('x-chef-pin')!==env.CHEF_PIN)return fail('厨师管理密码不正确',401);
  return null;
}
function validateDish(d){
  if(!valid(d.name,1,40))return '菜品名称必须为 1–40 个字';
  if(!Number.isSafeInteger(d.price_cents)||d.price_cents<0||d.price_cents>10000000)return '菜品价格不正确';
  if(!emojis.includes(d.emoji))return '菜品图标不正确';
  return '';
}
async function menu(req,env){
  if(req.method==='GET'){
    const result=await env.DB.prepare('SELECT id,name,price_cents,emoji FROM dishes ORDER BY rowid ASC').all();
    return send({dishes:result.results||[]});
  }
  if(!['POST','PATCH','DELETE'].includes(req.method))return fail('请求方法不支持',405);
  const denied=chefAuth(req,env);
  if(denied)return denied;
  const d=await readJson(req);
  if(req.method==='POST'||req.method==='PATCH'){
    const problem=validateDish(d);
    if(problem)return fail(problem);
    if(req.method==='POST'){
      const id=crypto.randomUUID();
      await env.DB.prepare('INSERT INTO dishes(id,name,price_cents,emoji) VALUES(?,?,?,?)').bind(id,d.name.trim(),d.price_cents,d.emoji).run();
      return send({ok:true,id},201);
    }
    if(!valid(d.id,1,100))return fail('菜品编号不正确');
    const result=await env.DB.prepare('UPDATE dishes SET name=?,price_cents=?,emoji=? WHERE id=?').bind(d.name.trim(),d.price_cents,d.emoji,d.id).run();
    return result.meta?.changes?send({ok:true}):fail('菜品不存在',404);
  }
  if(!valid(d.id,1,100))return fail('菜品编号不正确');
  const result=await env.DB.prepare('DELETE FROM dishes WHERE id=?').bind(d.id).run();
  return result.meta?.changes?send({ok:true}):fail('菜品不存在',404);
}
async function orders(req,env){
  if(req.method==='POST'){
    const d=await readJson(req);
    if(!valid(d.name,1,40))return fail('请输入 1–40 个字的点餐人姓名');
    if(d.remark!==undefined&&(typeof d.remark!=='string'||d.remark.length>300))return fail('备注最多 300 字');
    if(!Array.isArray(d.items)||d.items.length<1||d.items.length>25)return fail('请选择菜品（最多 25 种）');
    const counts=new Map();
    for(const it of d.items){
      if(!it||!valid(it.id,1,100)||!Number.isInteger(it.qty)||it.qty<1||it.qty>30||counts.has(it.id))return fail('购物车数据不正确');
      counts.set(it.id,it.qty);
    }
    if([...counts.values()].reduce((a,b)=>a+b,0)>100)return fail('一次最多订购 100 份');
    const ids=[...counts.keys()], placeholders=ids.map(()=>'?').join(',');
    const result=await env.DB.prepare('SELECT id,name,emoji,price_cents FROM dishes WHERE id IN ('+placeholders+')').bind(...ids).all();
    const rows=result.results||[];
    if(rows.length!==ids.length)return fail('菜单已更新，请刷新后重试',409);
    const byId=new Map(rows.map(x=>[x.id,x]));
    const items=ids.map(id=>{const x=byId.get(id);return {id,name:x.name,emoji:x.emoji,price_cents:x.price_cents,qty:counts.get(id)}});
    const total_cents=items.reduce((s,x)=>s+x.price_cents*x.qty,0);
    if(total_cents>100000000)return fail('订单总金额超出限制');
    const id=crypto.randomUUID();
    await env.DB.prepare('INSERT INTO orders(id,customer_name,remark,items_json,total_cents,status) VALUES(?,?,?,?,?,?)')
      .bind(id,d.name.trim(),(d.remark||'').trim(),JSON.stringify(items),total_cents,'待制作').run();
    return send({ok:true,id,total_cents},201);
  }
  if(req.method==='GET'){
    const result=await env.DB.prepare('SELECT id,customer_name,remark,items_json,total_cents,status,created_at FROM orders ORDER BY created_at DESC,rowid DESC LIMIT 200').all();
    const orders=(result.results||[]).map(r=>({id:r.id,name:r.customer_name,remark:r.remark,items:JSON.parse(r.items_json),total_cents:r.total_cents,status:r.status,created_at:r.created_at}));
    return send({orders});
  }
  const denied=chefAuth(req,env);
  if(denied)return denied;
  if(!['PATCH','DELETE'].includes(req.method))return fail('请求方法不支持',405);
  const d=await readJson(req);
  if(!valid(d.id,1,100))return fail('订单编号不正确');
  if(req.method==='PATCH'){
    if(!statuses.includes(d.status))return fail('订单状态不正确');
    const result=await env.DB.prepare('UPDATE orders SET status=? WHERE id=?').bind(d.status,d.id).run();
    return result.meta?.changes?send({ok:true}):fail('订单不存在',404);
  }
  const result=await env.DB.prepare('DELETE FROM orders WHERE id=?').bind(d.id).run();
  return result.meta?.changes?send({ok:true}):fail('订单不存在',404);
}
export default {
  async fetch(req,env){
    const path=new URL(req.url).pathname;
    if(!path.startsWith('/api/'))return env.ASSETS.fetch(req);
    if(!env.DB)return fail('数据库未连接：请在 Cloudflare Pages 绑定 D1，变量名 DB',503);
    try{
      if(path==='/api/health'&&req.method==='GET')return send({ok:true,database:true,orders_public:true,chef_pin_configured:typeof env.CHEF_PIN==='string'&&env.CHEF_PIN.length>=8});
      if(path==='/api/chef'&&req.method==='GET')return chefAuth(req,env)||send({ok:true});
      if(path==='/api/menu')return await menu(req,env);
      if(path==='/api/orders')return await orders(req,env);
      return fail('接口不存在',404);
    }catch(e){
      console.error('API failed',e);
      if(e.message==='请求内容过大'||e.message==='请求格式不正确')return fail(e.message);
      return fail('服务器暂时无法完成操作，请检查数据库建表是否完成',500);
    }
  }
};


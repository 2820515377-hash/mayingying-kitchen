-- 马盈盈大厨食堂 Cloudflare D1 初始化 SQL
-- 在 D1 数据库的 Console 中执行一次。请勿在已有业务数据的数据库里随意执行。
CREATE TABLE IF NOT EXISTS dishes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
  emoji TEXT NOT NULL DEFAULT '🍽️',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL,
  remark TEXT NOT NULL DEFAULT '',
  items_json TEXT NOT NULL,
  total_cents INTEGER NOT NULL CHECK(total_cents >= 0),
  status TEXT NOT NULL DEFAULT '待制作',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
INSERT OR IGNORE INTO dishes (id,name,price_cents,emoji) VALUES
 ('d1','番茄炒蛋',1600,'🍳'),
 ('d2','可乐鸡翅',2800,'🍗'),
 ('d3','红烧肉',3500,'🥩'),
 ('d4','蛋炒饭',1500,'🍚'),
 ('d5','酸辣粉',1800,'🍜'),
 ('d6','草莓甜品',2000,'🍓');
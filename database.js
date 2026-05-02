const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'pos.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'cashier',
    full_name TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sku TEXT UNIQUE,
    category TEXT DEFAULT 'General',
    cost_price REAL NOT NULL DEFAULT 0,
    selling_price REAL NOT NULL DEFAULT 0,
    stock INTEGER DEFAULT 0,
    min_stock INTEGER DEFAULT 5,
    unit TEXT DEFAULT 'pcs',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    subtotal REAL NOT NULL DEFAULT 0,
    discount REAL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    payment_method TEXT DEFAULT 'cash',
    amount_paid REAL DEFAULT 0,
    change_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'completed',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER,
    product_name TEXT NOT NULL,
    cost_price REAL NOT NULL DEFAULT 0,
    selling_price REAL NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 1,
    total REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS inventory_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    previous_stock INTEGER NOT NULL,
    new_stock INTEGER NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS category_archive (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_name TEXT NOT NULL,
    action TEXT NOT NULL,
    old_name TEXT,
    changed_by_name TEXT NOT NULL,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS product_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER,
    action TEXT NOT NULL,
    product_name TEXT NOT NULL,
    sku TEXT,
    category TEXT,
    cost_price REAL,
    selling_price REAL,
    stock INTEGER,
    min_stock INTEGER,
    unit TEXT,
    changed_by_name TEXT NOT NULL,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed categories from existing products if table is empty
const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
if (catCount === 0) {
  const insertCat = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
  const cats = db.prepare("SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != ''").all();
  for (const { category } of cats) insertCat.run(category);
  insertCat.run('General');
}

const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  db.prepare('INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)').run('admin', bcrypt.hashSync('admin123', 10), 'Administrator', 'admin');
  db.prepare('INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)').run('cashier1', bcrypt.hashSync('cashier123', 10), 'Juan Dela Cruz', 'cashier');

  const add = db.prepare('INSERT INTO products (name, sku, category, cost_price, selling_price, stock, min_stock, unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  add.run('Coca-Cola 330ml', 'COKE-330', 'Beverages', 25, 40, 100, 10, 'can');
  add.run('Pepsi 330ml', 'PEPSI-330', 'Beverages', 23, 38, 80, 10, 'can');
  add.run('Mineral Water 500ml', 'WATER-500', 'Beverages', 10, 20, 150, 20, 'bottle');
  add.run('White Bread (loaf)', 'BREAD-WH', 'Bakery', 35, 55, 30, 5, 'loaf');
  add.run('Eggs (1 dozen)', 'EGGS-12', 'Groceries', 70, 90, 50, 5, 'pack');
  add.run('Instant Noodles', 'NOODLE-INST', 'Groceries', 12, 18, 200, 30, 'pack');
  add.run('Chocolate Bar', 'CHOCO-BAR', 'Snacks', 20, 35, 60, 10, 'pcs');
  add.run('Potato Chips 100g', 'CHIPS-100', 'Snacks', 30, 50, 45, 10, 'bag');
  add.run('Shampoo 200ml', 'SHAMP-200', 'Personal Care', 65, 95, 40, 8, 'bottle');
  add.run('Laundry Detergent 1kg', 'DETERG-1KG', 'Household', 120, 175, 35, 5, 'pack');
}

module.exports = db;

const postgres = require('postgres');
const bcrypt = require('bcryptjs');

const sql = postgres(process.env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

async function initDB() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cashier',
      full_name TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT UNIQUE,
      category TEXT DEFAULT 'General',
      cost_price REAL NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL DEFAULT 0,
      stock INTEGER DEFAULT 0,
      min_stock INTEGER DEFAULT 5,
      unit TEXT DEFAULT 'pcs',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL,
      product_id INTEGER,
      product_name TEXT NOT NULL,
      cost_price REAL NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL DEFAULT 0,
      quantity INTEGER NOT NULL DEFAULT 1,
      total REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS inventory_logs (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      previous_stock INTEGER NOT NULL,
      new_stock INTEGER NOT NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS category_archive (
      id SERIAL PRIMARY KEY,
      category_name TEXT NOT NULL,
      action TEXT NOT NULL,
      old_name TEXT,
      changed_by_name TEXT NOT NULL,
      changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS product_history (
      id SERIAL PRIMARY KEY,
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
      changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS product_links (
      id SERIAL PRIMARY KEY,
      source_product_id INTEGER NOT NULL,
      target_product_id INTEGER NOT NULL,
      ratio REAL NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (target_product_id) REFERENCES products(id) ON DELETE CASCADE,
      UNIQUE (source_product_id, target_product_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS loyalty_members (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      contact_number TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      points INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    INSERT INTO settings (key, value) VALUES
      ('business_name', 'Aling Inday Kamuning'),
      ('logo', NULL)
    ON CONFLICT DO NOTHING
  `;

  const [{ c: userCount }] = await sql`SELECT COUNT(*)::int as c FROM users`;
  if (userCount === 0) {
    await sql`
      INSERT INTO users (username, password, full_name, role) VALUES
        ('admin',    ${bcrypt.hashSync('admin123',   10)}, 'Administrator',  'admin'),
        ('cashier1', ${bcrypt.hashSync('cashier123', 10)}, 'Juan Dela Cruz', 'cashier')
    `;
    await sql`
      INSERT INTO products (name, sku, category, cost_price, selling_price, stock, min_stock, unit) VALUES
        ('Coca-Cola 330ml',       'COKE-330',    'Beverages',     25,  40,  100, 10, 'can'),
        ('Pepsi 330ml',           'PEPSI-330',   'Beverages',     23,  38,   80, 10, 'can'),
        ('Mineral Water 500ml',   'WATER-500',   'Beverages',     10,  20,  150, 20, 'bottle'),
        ('White Bread (loaf)',    'BREAD-WH',    'Bakery',        35,  55,   30,  5, 'loaf'),
        ('Eggs (1 dozen)',        'EGGS-12',     'Groceries',     70,  90,   50,  5, 'pack'),
        ('Instant Noodles',       'NOODLE-INST', 'Groceries',     12,  18,  200, 30, 'pack'),
        ('Chocolate Bar',         'CHOCO-BAR',   'Snacks',        20,  35,   60, 10, 'pcs'),
        ('Potato Chips 100g',     'CHIPS-100',   'Snacks',        30,  50,   45, 10, 'bag'),
        ('Shampoo 200ml',         'SHAMP-200',   'Personal Care', 65,  95,   40,  8, 'bottle'),
        ('Laundry Detergent 1kg', 'DETERG-1KG',  'Household',    120, 175,   35,  5, 'pack')
    `;
  }

  const [{ c: catCount }] = await sql`SELECT COUNT(*)::int as c FROM categories`;
  if (catCount === 0) {
    await sql`
      INSERT INTO categories (name)
      SELECT DISTINCT category FROM products
      WHERE category IS NOT NULL AND category != ''
      ON CONFLICT DO NOTHING
    `;
    await sql`INSERT INTO categories (name) VALUES ('General') ON CONFLICT DO NOTHING`;
  }
}

module.exports = { sql, initDB };

const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./database');

const app = express();
const SECRET = 'pos_jwt_secret_2024_secure_key';
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Middleware ─────────────────────────────────────────────────────────────────
const auth = (req, res, next) => {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(h.slice(7), SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token expired or invalid' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
};

const adminOrManager = (req, res, next) => {
  if (!['admin', 'account_manager'].includes(req.user?.role)) return res.status(403).json({ error: 'Access restricted' });
  next();
};

// ── Auth ───────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const payload = { id: user.id, username: user.username, role: user.role, full_name: user.full_name };
  const token = jwt.sign(payload, SECRET, { expiresIn: '10h' });
  res.json({ token, user: payload });
});

// ── Users ──────────────────────────────────────────────────────────────────────
app.get('/api/users', auth, adminOnly, (req, res) => {
  res.json(db.prepare('SELECT id, username, full_name, role, created_at FROM users ORDER BY created_at DESC').all());
});

app.post('/api/users', auth, adminOnly, (req, res) => {
  const { username, password, full_name, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  if (!['admin', 'cashier', 'account_manager'].includes(role)) return res.status(400).json({ error: 'Role must be admin, cashier, or account_manager' });
  try {
    const r = db.prepare('INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)').run(username, bcrypt.hashSync(password, 10), full_name || username, role);
    res.json({ id: r.lastInsertRowid, username, full_name: full_name || username, role });
  } catch { res.status(409).json({ error: 'Username already exists' }); }
});

app.put('/api/users/:id', auth, adminOnly, (req, res) => {
  const { full_name, role, password } = req.body;
  const id = parseInt(req.params.id);
  if (password) {
    db.prepare('UPDATE users SET full_name=?, role=?, password=? WHERE id=?').run(full_name, role, bcrypt.hashSync(password, 10), id);
  } else {
    db.prepare('UPDATE users SET full_name=?, role=? WHERE id=?').run(full_name, role, id);
  }
  res.json({ success: true });
});

app.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  res.json({ success: true });
});

// ── Products ───────────────────────────────────────────────────────────────────
app.get('/api/products', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY name ASC').all());
});

app.post('/api/products', auth, adminOnly, (req, res) => {
  const { name, sku, category, cost_price, selling_price, stock, min_stock, unit } = req.body;
  if (!name || cost_price == null || selling_price == null) {
    return res.status(400).json({ error: 'Name, cost price, and selling price are required' });
  }
  const cat = category || 'General';
  try {
    const r = db.prepare('INSERT INTO products (name, sku, category, cost_price, selling_price, stock, min_stock, unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(name, sku || null, cat, parseFloat(cost_price), parseFloat(selling_price), parseInt(stock) || 0, parseInt(min_stock) || 5, unit || 'pcs');
    db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)').run(cat);
    db.prepare('INSERT INTO product_history (product_id, action, product_name, sku, category, cost_price, selling_price, stock, min_stock, unit, changed_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(r.lastInsertRowid, 'created', name, sku||null, cat, parseFloat(cost_price), parseFloat(selling_price), parseInt(stock)||0, parseInt(min_stock)||5, unit||'pcs', req.user.full_name||req.user.username);
    res.json(db.prepare('SELECT * FROM products WHERE id=?').get(r.lastInsertRowid));
  } catch { res.status(409).json({ error: 'SKU already exists' }); }
});

app.put('/api/products/:id', auth, adminOnly, (req, res) => {
  const { name, sku, category, cost_price, selling_price, min_stock, unit } = req.body;
  const cat = category || 'General';
  try {
    const before = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Product not found' });
    db.prepare('UPDATE products SET name=?, sku=?, category=?, cost_price=?, selling_price=?, min_stock=?, unit=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name, sku || null, cat, parseFloat(cost_price), parseFloat(selling_price), parseInt(min_stock), unit, req.params.id);
    db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)').run(cat);
    db.prepare('INSERT INTO product_history (product_id, action, product_name, sku, category, cost_price, selling_price, stock, min_stock, unit, changed_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(parseInt(req.params.id), 'updated', name, sku||null, cat, parseFloat(cost_price), parseFloat(selling_price), before.stock, parseInt(min_stock), unit, req.user.full_name||req.user.username);
    res.json({ success: true });
  } catch { res.status(409).json({ error: 'SKU already exists' }); }
});

app.delete('/api/products/:id', auth, adminOnly, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  db.prepare('INSERT INTO product_history (product_id, action, product_name, sku, category, cost_price, selling_price, stock, min_stock, unit, changed_by_name) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(product.id, 'deleted', product.name, product.sku, product.category, product.cost_price, product.selling_price, product.stock, product.min_stock, product.unit, req.user.full_name||req.user.username);
  db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ── Inventory ──────────────────────────────────────────────────────────────────
app.get('/api/inventory/logs', auth, (req, res) => {
  const logs = db.prepare(`
    SELECT il.*, p.name as product_name, u.full_name as user_name
    FROM inventory_logs il
    JOIN products p ON il.product_id = p.id
    JOIN users u ON il.user_id = u.id
    ORDER BY il.created_at DESC LIMIT 300
  `).all();
  res.json(logs);
});

app.post('/api/inventory/adjust', auth, (req, res) => {
  const { product_id, type, quantity, notes } = req.body;
  const qty = parseInt(quantity);
  if (!product_id || !type || isNaN(qty) || qty <= 0) {
    return res.status(400).json({ error: 'Invalid input. Quantity must be a positive number.' });
  }
  const product = db.prepare('SELECT * FROM products WHERE id=?').get(product_id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  let new_stock;
  if (type === 'in') {
    new_stock = product.stock + qty;
  } else if (type === 'out') {
    if (product.stock < qty) return res.status(400).json({ error: `Insufficient stock. Available: ${product.stock}` });
    new_stock = product.stock - qty;
  } else if (type === 'set') {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    new_stock = qty;
  } else {
    return res.status(400).json({ error: 'Invalid type. Use: in, out, or set' });
  }

  db.prepare('UPDATE products SET stock=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(new_stock, product_id);
  db.prepare('INSERT INTO inventory_logs (product_id, user_id, type, quantity, previous_stock, new_stock, notes) VALUES (?, ?, ?, ?, ?, ?, ?)').run(product_id, req.user.id, type, qty, product.stock, new_stock, notes || null);
  res.json({ success: true, previous_stock: product.stock, new_stock });
});

// ── Orders ─────────────────────────────────────────────────────────────────────
app.get('/api/orders', auth, (req, res) => {
  const { from, to, limit = 200 } = req.query;
  const params = [];
  let where = "WHERE o.status = 'completed'";
  if (from) { where += ' AND DATE(o.created_at) >= ?'; params.push(from); }
  if (to) { where += ' AND DATE(o.created_at) <= ?'; params.push(to); }
  params.push(parseInt(limit));
  const orders = db.prepare(`SELECT o.*, u.full_name as cashier_name FROM orders o JOIN users u ON o.user_id = u.id ${where} ORDER BY o.created_at DESC LIMIT ?`).all(...params);
  res.json(orders);
});

app.delete('/api/orders/:id', auth, adminOnly, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  try {
    db.transaction(() => {
      const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
      for (const item of items) {
        if (!item.product_id) continue;
        const product = db.prepare('SELECT * FROM products WHERE id=?').get(item.product_id);
        if (!product) continue;
        const newStock = product.stock + item.quantity;
        db.prepare('UPDATE products SET stock=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(newStock, item.product_id);
        db.prepare("INSERT INTO inventory_logs (product_id, user_id, type, quantity, previous_stock, new_stock, notes) VALUES (?,?,'in',?,?,?,?)").run(item.product_id, req.user.id, item.quantity, product.stock, newStock, `Void: ${order.order_number}`);
      }
      db.prepare('DELETE FROM order_items WHERE order_id=?').run(order.id);
      db.prepare('DELETE FROM orders WHERE id=?').run(order.id);
    })();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/orders/:id', auth, (req, res) => {
  const order = db.prepare('SELECT o.*, u.full_name as cashier_name FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id=?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(req.params.id);
  res.json({ ...order, items });
});

app.post('/api/orders', auth, (req, res) => {
  const { items, discount = 0, payment_method = 'cash', amount_paid, notes } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'Order must have at least one item' });

  try {
    const result = db.transaction(() => {
      let subtotal = 0;
      const resolved = [];

      for (const item of items) {
        const p = db.prepare('SELECT * FROM products WHERE id=?').get(item.product_id);
        if (!p) throw Object.assign(new Error(`Product ID ${item.product_id} not found`), { status: 404 });
        if (p.stock < item.quantity) throw Object.assign(new Error(`Insufficient stock for "${p.name}". Available: ${p.stock}`), { status: 400 });
        const lineTotal = p.selling_price * item.quantity;
        subtotal += lineTotal;
        resolved.push({ p, qty: item.quantity, lineTotal });
      }

      const discountAmt = parseFloat(discount) || 0;
      const total = Math.max(0, subtotal - discountAmt);
      const paid = parseFloat(amount_paid) || total;
      const change = Math.max(0, paid - total);
      const orderNum = `ORD-${Date.now()}`;

      const ord = db.prepare('INSERT INTO orders (order_number, user_id, subtotal, discount, total, payment_method, amount_paid, change_amount, notes) VALUES (?,?,?,?,?,?,?,?,?)').run(orderNum, req.user.id, subtotal, discountAmt, total, payment_method, paid, change, notes || null);

      for (const { p, qty, lineTotal } of resolved) {
        db.prepare('INSERT INTO order_items (order_id, product_id, product_name, cost_price, selling_price, quantity, total) VALUES (?,?,?,?,?,?,?)').run(ord.lastInsertRowid, p.id, p.name, p.cost_price, p.selling_price, qty, lineTotal);
        const newStock = p.stock - qty;
        db.prepare('UPDATE products SET stock=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(newStock, p.id);
        db.prepare("INSERT INTO inventory_logs (product_id, user_id, type, quantity, previous_stock, new_stock, notes) VALUES (?,?,'out',?,?,?,?)").run(p.id, req.user.id, qty, p.stock, newStock, `Sale: ${orderNum}`);
      }

      return { order_id: ord.lastInsertRowid, order_number: orderNum, subtotal, discount: discountAmt, total, change, payment_method };
    })();
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── Categories ─────────────────────────────────────────────────────────────────
app.get('/api/categories', auth, (req, res) => {
  res.json(db.prepare(`
    SELECT c.*, COUNT(p.id) as product_count
    FROM categories c LEFT JOIN products p ON p.category = c.name
    GROUP BY c.id ORDER BY c.name ASC
  `).all());
});

app.post('/api/categories', auth, adminOnly, (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Category name is required' });
  try {
    const r = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name.trim());
    res.json({ id: r.lastInsertRowid, name: name.trim(), product_count: 0 });
  } catch { res.status(409).json({ error: 'Category already exists' }); }
});

app.put('/api/categories/:id', auth, adminOnly, (req, res) => {
  const { name } = req.body;
  const id = parseInt(req.params.id);
  const cat = db.prepare('SELECT * FROM categories WHERE id=?').get(id);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  if (!name?.trim()) return res.status(400).json({ error: 'Category name is required' });
  const oldName = cat.name;
  try {
    db.transaction(() => {
      db.prepare('UPDATE categories SET name=? WHERE id=?').run(name.trim(), id);
      db.prepare('UPDATE products SET category=?, updated_at=CURRENT_TIMESTAMP WHERE category=?').run(name.trim(), oldName);
      db.prepare('INSERT INTO category_archive (category_name, action, old_name, changed_by_name) VALUES (?,?,?,?)').run(name.trim(), 'renamed', oldName, req.user.full_name||req.user.username);
    })();
    res.json({ success: true });
  } catch { res.status(409).json({ error: 'Category name already exists' }); }
});

app.delete('/api/categories/:id', auth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id);
  const cat = db.prepare('SELECT * FROM categories WHERE id=?').get(id);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  db.transaction(() => {
    db.prepare("UPDATE products SET category='General', updated_at=CURRENT_TIMESTAMP WHERE category=?").run(cat.name);
    db.prepare('INSERT INTO category_archive (category_name, action, old_name, changed_by_name) VALUES (?,?,?,?)').run(cat.name, 'deleted', null, req.user.full_name||req.user.username);
    db.prepare('DELETE FROM categories WHERE id=?').run(id);
    db.prepare("INSERT OR IGNORE INTO categories (name) VALUES ('General')").run();
  })();
  res.json({ success: true });
});

app.get('/api/category-archive', auth, adminOnly, (req, res) => {
  res.json(db.prepare('SELECT * FROM category_archive ORDER BY changed_at DESC').all());
});

app.get('/api/product-history', auth, adminOnly, (req, res) => {
  res.json(db.prepare('SELECT * FROM product_history ORDER BY changed_at DESC LIMIT 500').all());
});

// ── Reports ────────────────────────────────────────────────────────────────────
app.get('/api/reports/summary', auth, adminOrManager, (req, res) => {
  const df = req.query.from || '2000-01-01';
  const dt = req.query.to || '2999-12-31';

  const sales = db.prepare(`SELECT COUNT(*) as orders, COALESCE(SUM(total),0) as revenue, COALESCE(SUM(discount),0) as discounts FROM orders WHERE status='completed' AND DATE(created_at) BETWEEN ? AND ?`).get(df, dt);
  const cost = db.prepare(`SELECT COALESCE(SUM(oi.cost_price * oi.quantity),0) as total_cost FROM order_items oi JOIN orders o ON oi.order_id=o.id WHERE o.status='completed' AND DATE(o.created_at) BETWEEN ? AND ?`).get(df, dt);
  const topProducts = db.prepare(`SELECT oi.product_name, SUM(oi.quantity) as qty, SUM(oi.total) as revenue, SUM(oi.cost_price*oi.quantity) as cost FROM order_items oi JOIN orders o ON oi.order_id=o.id WHERE o.status='completed' AND DATE(o.created_at) BETWEEN ? AND ? GROUP BY oi.product_name ORDER BY revenue DESC LIMIT 10`).all(df, dt);
  const dailySales = db.prepare(`SELECT DATE(created_at) as date, COUNT(*) as orders, SUM(total) as revenue FROM orders WHERE status='completed' AND DATE(created_at) BETWEEN ? AND ? GROUP BY DATE(created_at) ORDER BY date ASC`).all(df, dt);
  const categoryRevenue = db.prepare(`SELECT COALESCE(p.category,'Uncategorized') as category, SUM(oi.total) as revenue FROM order_items oi LEFT JOIN products p ON oi.product_id=p.id JOIN orders o ON oi.order_id=o.id WHERE o.status='completed' AND DATE(o.created_at) BETWEEN ? AND ? GROUP BY p.category ORDER BY revenue DESC`).all(df, dt);
  const lowStock = db.prepare('SELECT * FROM products WHERE stock <= min_stock ORDER BY stock ASC').all();

  const revenue = sales.revenue;
  const totalCost = cost.total_cost;

  res.json({
    orders: sales.orders,
    revenue,
    total_cost: totalCost,
    gross_profit: revenue - totalCost,
    discounts: sales.discounts,
    profit_margin: revenue > 0 ? ((revenue - totalCost) / revenue * 100).toFixed(1) : '0.0',
    top_products: topProducts,
    daily_sales: dailySales,
    category_revenue: categoryRevenue,
    low_stock: lowStock
  });
});

// ── SPA fallback ───────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  POS System running at http://localhost:${PORT}`);
  console.log('  Admin login:   admin / admin123');
  console.log('  Cashier login: cashier1 / cashier123\n');
});

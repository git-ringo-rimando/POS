if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '.env.local' });
  require('dotenv').config();
}

const express = require('express');
const path    = require('path');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const { sql, initDB } = require('./database');

const app    = express();
const SECRET = process.env.JWT_SECRET || 'pos_jwt_secret_2024_secure_key';

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

// Forwards async route errors to the global error handler below
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ── Auth ───────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', ah(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const [user] = await sql`SELECT * FROM users WHERE username = ${username}`;
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const payload = { id: user.id, username: user.username, role: user.role, full_name: user.full_name };
  res.json({ token: jwt.sign(payload, SECRET, { expiresIn: '10h' }), user: payload });
}));

// ── Users ──────────────────────────────────────────────────────────────────────
app.get('/api/users', auth, adminOnly, ah(async (req, res) => {
  res.json(await sql`SELECT id, username, full_name, role, created_at FROM users ORDER BY created_at DESC`);
}));

app.post('/api/users', auth, adminOnly, ah(async (req, res) => {
  const { username, password, full_name, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  if (!['admin', 'cashier', 'account_manager'].includes(role)) return res.status(400).json({ error: 'Role must be admin, cashier, or account_manager' });
  try {
    const [r] = await sql`INSERT INTO users (username, password, full_name, role) VALUES (${username}, ${bcrypt.hashSync(password, 10)}, ${full_name || username}, ${role}) RETURNING id`;
    res.json({ id: r.id, username, full_name: full_name || username, role });
  } catch { res.status(409).json({ error: 'Username already exists' }); }
}));

app.put('/api/users/:id', auth, adminOnly, ah(async (req, res) => {
  const { full_name, role, password } = req.body;
  const id = parseInt(req.params.id);
  if (password) {
    await sql`UPDATE users SET full_name=${full_name}, role=${role}, password=${bcrypt.hashSync(password, 10)} WHERE id=${id}`;
  } else {
    await sql`UPDATE users SET full_name=${full_name}, role=${role} WHERE id=${id}`;
  }
  res.json({ success: true });
}));

app.delete('/api/users/:id', auth, adminOnly, ah(async (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  const [{ c }] = await sql`SELECT COUNT(*)::int as c FROM orders WHERE user_id = ${id}`;
  if (c > 0) return res.status(409).json({ error: 'Cannot delete: user has transaction history. Deactivate instead.' });
  await sql`DELETE FROM inventory_logs WHERE user_id = ${id}`;
  await sql`DELETE FROM users WHERE id=${id}`;
  res.json({ success: true });
}));

// ── Products ───────────────────────────────────────────────────────────────────
app.get('/api/products', auth, ah(async (req, res) => {
  res.json(await sql`SELECT * FROM products ORDER BY name ASC`);
}));

app.post('/api/products', auth, adminOnly, ah(async (req, res) => {
  const { name, sku, category, cost_price, selling_price, stock, min_stock, unit } = req.body;
  if (!name || cost_price == null || selling_price == null) {
    return res.status(400).json({ error: 'Name, cost price, and selling price are required' });
  }
  const cat = category || 'General';
  try {
    const [r] = await sql`INSERT INTO products (name, sku, category, cost_price, selling_price, stock, min_stock, unit) VALUES (${name}, ${sku || null}, ${cat}, ${parseFloat(cost_price)}, ${parseFloat(selling_price)}, ${parseInt(stock) || 0}, ${parseInt(min_stock) || 5}, ${unit || 'pcs'}) RETURNING id`;
    await sql`INSERT INTO categories (name) VALUES (${cat}) ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO product_history (product_id, action, product_name, sku, category, cost_price, selling_price, stock, min_stock, unit, changed_by_name) VALUES (${r.id}, 'created', ${name}, ${sku || null}, ${cat}, ${parseFloat(cost_price)}, ${parseFloat(selling_price)}, ${parseInt(stock) || 0}, ${parseInt(min_stock) || 5}, ${unit || 'pcs'}, ${req.user.full_name || req.user.username})`;
    const [product] = await sql`SELECT * FROM products WHERE id=${r.id}`;
    res.json(product);
  } catch { res.status(409).json({ error: 'SKU already exists' }); }
}));

app.put('/api/products/:id', auth, adminOnly, ah(async (req, res) => {
  const { name, sku, category, cost_price, selling_price, min_stock, unit } = req.body;
  const cat = category || 'General';
  const id = parseInt(req.params.id);
  const [before] = await sql`SELECT * FROM products WHERE id=${id}`;
  if (!before) return res.status(404).json({ error: 'Product not found' });
  try {
    await sql`UPDATE products SET name=${name}, sku=${sku || null}, category=${cat}, cost_price=${parseFloat(cost_price)}, selling_price=${parseFloat(selling_price)}, min_stock=${parseInt(min_stock)}, unit=${unit}, updated_at=CURRENT_TIMESTAMP WHERE id=${id}`;
    await sql`INSERT INTO categories (name) VALUES (${cat}) ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO product_history (product_id, action, product_name, sku, category, cost_price, selling_price, stock, min_stock, unit, changed_by_name) VALUES (${id}, 'updated', ${name}, ${sku || null}, ${cat}, ${parseFloat(cost_price)}, ${parseFloat(selling_price)}, ${before.stock}, ${parseInt(min_stock)}, ${unit}, ${req.user.full_name || req.user.username})`;
    res.json({ success: true });
  } catch { res.status(409).json({ error: 'SKU already exists' }); }
}));

app.delete('/api/products/:id', auth, adminOnly, ah(async (req, res) => {
  const id = parseInt(req.params.id);
  const [product] = await sql`SELECT * FROM products WHERE id=${id}`;
  if (!product) return res.status(404).json({ error: 'Product not found' });
  await sql.begin(async sql => {
    await sql`INSERT INTO product_history (product_id, action, product_name, sku, category, cost_price, selling_price, stock, min_stock, unit, changed_by_name) VALUES (${product.id}, 'deleted', ${product.name}, ${product.sku}, ${product.category}, ${product.cost_price}, ${product.selling_price}, ${product.stock}, ${product.min_stock}, ${product.unit}, ${req.user.full_name || req.user.username})`;
    await sql`DELETE FROM inventory_logs WHERE product_id=${id}`;
    await sql`DELETE FROM products WHERE id=${id}`;
  });
  res.json({ success: true });
}));

// ── Inventory ──────────────────────────────────────────────────────────────────
// Updates all linked targets so their stock = round(sourceNewStock × ratio).
// Recursive — handles chains A→B→C automatically.
async function applyCascadedLinks(sql, sourceProductId, sourceNewStock, sourceName, userId) {
  const links = await sql`SELECT * FROM product_links WHERE source_product_id = ${sourceProductId}`;
  for (const link of links) {
    const newTargetStock = Math.round(sourceNewStock * link.ratio);
    const [target] = await sql`SELECT id, stock, name FROM products WHERE id = ${link.target_product_id}`;
    if (!target || newTargetStock === target.stock) continue;
    await sql`UPDATE products SET stock = ${newTargetStock}, updated_at = CURRENT_TIMESTAMP WHERE id = ${target.id}`;
    await sql`INSERT INTO inventory_logs (product_id, user_id, type, quantity, previous_stock, new_stock, notes)
      VALUES (${target.id}, ${userId}, ${newTargetStock > target.stock ? 'in' : 'out'},
              ${Math.abs(newTargetStock - target.stock)}, ${target.stock}, ${newTargetStock}, ${'Linked: ' + sourceName})`;
    await applyCascadedLinks(sql, target.id, newTargetStock, target.name, userId);
  }
}

app.get('/api/inventory/logs', auth, ah(async (req, res) => {
  const { product_id } = req.query;
  if (product_id) {
    const pid = parseInt(product_id);
    if (isNaN(pid)) return res.status(400).json({ error: 'Invalid product_id' });
    return res.json(await sql`
      SELECT il.*, p.name as product_name, u.full_name as user_name
      FROM inventory_logs il
      JOIN products p ON il.product_id = p.id
      JOIN users u ON il.user_id = u.id
      WHERE il.product_id = ${pid}
      ORDER BY il.created_at DESC
    `);
  }
  res.json(await sql`
    SELECT il.*, p.name as product_name, u.full_name as user_name
    FROM inventory_logs il
    JOIN products p ON il.product_id = p.id
    JOIN users u ON il.user_id = u.id
    ORDER BY il.created_at DESC LIMIT 300
  `);
}));

app.get('/api/inventory/links/:product_id', auth, adminOnly, ah(async (req, res) => {
  const pid = parseInt(req.params.product_id);
  if (isNaN(pid)) return res.status(400).json({ error: 'Invalid product_id' });
  res.json(await sql`
    SELECT pl.*, sp.name as source_name, tp.name as target_name
    FROM product_links pl
    JOIN products sp ON pl.source_product_id = sp.id
    JOIN products tp ON pl.target_product_id = tp.id
    WHERE pl.source_product_id = ${pid} OR pl.target_product_id = ${pid}
    ORDER BY pl.created_at ASC
  `);
}));

app.post('/api/inventory/links', auth, adminOnly, ah(async (req, res) => {
  const src = parseInt(req.body.source_product_id);
  const tgt = parseInt(req.body.target_product_id);
  const r   = parseFloat(req.body.ratio);
  if (isNaN(src) || isNaN(tgt) || isNaN(r) || r <= 0)
    return res.status(400).json({ error: 'source_product_id, target_product_id, and a positive ratio are required' });
  if (src === tgt)
    return res.status(400).json({ error: 'A product cannot be linked to itself' });
  const visited = new Set();
  const queue = [tgt];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === src) return res.status(400).json({ error: 'This link would create a circular dependency' });
    if (!visited.has(cur)) {
      visited.add(cur);
      const downstream = await sql`SELECT target_product_id FROM product_links WHERE source_product_id = ${cur}`;
      for (const row of downstream) queue.push(row.target_product_id);
    }
  }
  try {
    const [link] = await sql`INSERT INTO product_links (source_product_id, target_product_id, ratio)
      VALUES (${src}, ${tgt}, ${r}) RETURNING *`;
    // Immediately sync target stock to source × ratio
    const [source] = await sql`SELECT stock, name FROM products WHERE id = ${src}`;
    if (source) await applyCascadedLinks(sql, src, source.stock, source.name, req.user.id);
    res.json(link);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'This link already exists' });
    throw e;
  }
}));

app.delete('/api/inventory/links/:id', auth, adminOnly, ah(async (req, res) => {
  const id = parseInt(req.params.id);
  const [link] = await sql`SELECT * FROM product_links WHERE id = ${id}`;
  if (!link) return res.status(404).json({ error: 'Link not found' });
  await sql`DELETE FROM product_links WHERE id = ${id}`;
  res.json({ success: true });
}));

app.post('/api/inventory/adjust', auth, ah(async (req, res) => {
  const { product_id, type, quantity, notes } = req.body;
  const qty = parseInt(quantity);
  if (!product_id || !type || isNaN(qty) || qty <= 0)
    return res.status(400).json({ error: 'Invalid input. Quantity must be a positive number.' });
  const [product] = await sql`SELECT * FROM products WHERE id=${product_id}`;
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

  await sql.begin(async sql => {
    await sql`UPDATE products SET stock=${new_stock}, updated_at=CURRENT_TIMESTAMP WHERE id=${product_id}`;
    await sql`INSERT INTO inventory_logs (product_id, user_id, type, quantity, previous_stock, new_stock, notes) VALUES (${product_id}, ${req.user.id}, ${type}, ${qty}, ${product.stock}, ${new_stock}, ${notes || null})`;
    await applyCascadedLinks(sql, product_id, new_stock, product.name, req.user.id);
  });
  res.json({ success: true, previous_stock: product.stock, new_stock });
}));

// ── Orders ─────────────────────────────────────────────────────────────────────
app.get('/api/orders', auth, ah(async (req, res) => {
  const { from, to, limit = 200 } = req.query;
  const fromFilter = from ? sql`AND o.created_at::date >= ${from}` : sql``;
  const toFilter   = to   ? sql`AND o.created_at::date <= ${to}`   : sql``;
  res.json(await sql`
    SELECT o.*, u.full_name as cashier_name
    FROM orders o JOIN users u ON o.user_id = u.id
    WHERE o.status = 'completed'
    ${fromFilter}
    ${toFilter}
    ORDER BY o.created_at DESC LIMIT ${parseInt(limit)}
  `);
}));

app.delete('/api/orders/:id', auth, adminOnly, ah(async (req, res) => {
  const [order] = await sql`SELECT * FROM orders WHERE id=${parseInt(req.params.id)}`;
  if (!order) return res.status(404).json({ error: 'Order not found' });
  await sql.begin(async sql => {
    const items = await sql`SELECT product_id, quantity FROM order_items WHERE order_id=${order.id}`;
    for (const item of items) {
      if (!item.product_id) continue;
      const [product] = await sql`SELECT * FROM products WHERE id=${item.product_id}`;
      if (!product) continue;
      const newStock = product.stock + item.quantity;
      await sql`UPDATE products SET stock=${newStock}, updated_at=CURRENT_TIMESTAMP WHERE id=${item.product_id}`;
      await sql`INSERT INTO inventory_logs (product_id, user_id, type, quantity, previous_stock, new_stock, notes) VALUES (${item.product_id}, ${req.user.id}, 'in', ${item.quantity}, ${product.stock}, ${newStock}, ${'Void: ' + order.order_number})`;
      await applyCascadedLinks(sql, item.product_id, newStock, product.name, req.user.id);
    }
    await sql`DELETE FROM order_items WHERE order_id=${order.id}`;
    await sql`DELETE FROM orders WHERE id=${order.id}`;
  });
  res.json({ success: true });
}));

app.get('/api/orders/:id', auth, ah(async (req, res) => {
  const [order] = await sql`SELECT o.*, u.full_name as cashier_name FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id=${parseInt(req.params.id)}`;
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const items = await sql`SELECT * FROM order_items WHERE order_id=${parseInt(req.params.id)}`;
  res.json({ ...order, items });
}));

app.post('/api/orders', auth, ah(async (req, res) => {
  const { items, discount = 0, payment_method = 'cash', amount_paid, notes } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'Order must have at least one item' });

  const result = await sql.begin(async sql => {
    let subtotal = 0;
    const resolved = [];

    for (const item of items) {
      const [p] = await sql`SELECT * FROM products WHERE id=${item.product_id}`;
      if (!p) throw Object.assign(new Error(`Product ID ${item.product_id} not found`), { status: 404 });
      if (p.stock < item.quantity) throw Object.assign(new Error(`Insufficient stock for "${p.name}". Available: ${p.stock}`), { status: 400 });
      subtotal += p.selling_price * item.quantity;
      resolved.push({ p, qty: item.quantity, lineTotal: p.selling_price * item.quantity });
    }

    const discountAmt = parseFloat(discount) || 0;
    const total       = Math.max(0, subtotal - discountAmt);
    const paid        = parseFloat(amount_paid) || total;
    const change      = Math.max(0, paid - total);
    const orderNum    = `ORD-${Date.now()}`;

    const [ord] = await sql`INSERT INTO orders (order_number, user_id, subtotal, discount, total, payment_method, amount_paid, change_amount, notes) VALUES (${orderNum}, ${req.user.id}, ${subtotal}, ${discountAmt}, ${total}, ${payment_method}, ${paid}, ${change}, ${notes || null}) RETURNING id`;

    for (const { p, qty, lineTotal } of resolved) {
      await sql`INSERT INTO order_items (order_id, product_id, product_name, cost_price, selling_price, quantity, total) VALUES (${ord.id}, ${p.id}, ${p.name}, ${p.cost_price}, ${p.selling_price}, ${qty}, ${lineTotal})`;
      const newStock = p.stock - qty;
      await sql`UPDATE products SET stock=${newStock}, updated_at=CURRENT_TIMESTAMP WHERE id=${p.id}`;
      await sql`INSERT INTO inventory_logs (product_id, user_id, type, quantity, previous_stock, new_stock, notes) VALUES (${p.id}, ${req.user.id}, 'out', ${qty}, ${p.stock}, ${newStock}, ${'Sale: ' + orderNum})`;
      await applyCascadedLinks(sql, p.id, newStock, p.name, req.user.id);
    }

    return { order_id: ord.id, order_number: orderNum, subtotal, discount: discountAmt, total, change, payment_method };
  });
  res.json(result);
}));

// ── Categories ─────────────────────────────────────────────────────────────────
app.get('/api/categories', auth, ah(async (req, res) => {
  res.json(await sql`
    SELECT c.*, COUNT(p.id)::int as product_count
    FROM categories c LEFT JOIN products p ON p.category = c.name
    GROUP BY c.id ORDER BY c.name ASC
  `);
}));

app.post('/api/categories', auth, adminOnly, ah(async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Category name is required' });
  try {
    const [r] = await sql`INSERT INTO categories (name) VALUES (${name.trim()}) RETURNING id`;
    res.json({ id: r.id, name: name.trim(), product_count: 0 });
  } catch { res.status(409).json({ error: 'Category already exists' }); }
}));

app.put('/api/categories/:id', auth, adminOnly, ah(async (req, res) => {
  const { name } = req.body;
  const id = parseInt(req.params.id);
  const [cat] = await sql`SELECT * FROM categories WHERE id=${id}`;
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  if (!name?.trim()) return res.status(400).json({ error: 'Category name is required' });
  try {
    await sql.begin(async sql => {
      await sql`UPDATE categories SET name=${name.trim()} WHERE id=${id}`;
      await sql`UPDATE products SET category=${name.trim()}, updated_at=CURRENT_TIMESTAMP WHERE category=${cat.name}`;
      await sql`INSERT INTO category_archive (category_name, action, old_name, changed_by_name) VALUES (${name.trim()}, 'renamed', ${cat.name}, ${req.user.full_name || req.user.username})`;
    });
    res.json({ success: true });
  } catch { res.status(409).json({ error: 'Category name already exists' }); }
}));

app.delete('/api/categories/:id', auth, adminOnly, ah(async (req, res) => {
  const id = parseInt(req.params.id);
  const [cat] = await sql`SELECT * FROM categories WHERE id=${id}`;
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  await sql.begin(async sql => {
    await sql`UPDATE products SET category='General', updated_at=CURRENT_TIMESTAMP WHERE category=${cat.name}`;
    await sql`INSERT INTO category_archive (category_name, action, old_name, changed_by_name) VALUES (${cat.name}, 'deleted', ${null}, ${req.user.full_name || req.user.username})`;
    await sql`DELETE FROM categories WHERE id=${id}`;
    await sql`INSERT INTO categories (name) VALUES ('General') ON CONFLICT DO NOTHING`;
  });
  res.json({ success: true });
}));

app.get('/api/category-archive', auth, adminOnly, ah(async (req, res) => {
  res.json(await sql`SELECT * FROM category_archive ORDER BY changed_at DESC`);
}));

app.get('/api/product-history', auth, adminOnly, ah(async (req, res) => {
  res.json(await sql`SELECT * FROM product_history ORDER BY changed_at DESC LIMIT 500`);
}));

// ── Reports ────────────────────────────────────────────────────────────────────
app.get('/api/reports/summary', auth, adminOrManager, ah(async (req, res) => {
  const df = req.query.from || '2000-01-01';
  const dt = req.query.to   || '2999-12-31';

  const [sales]        = await sql`SELECT COUNT(*)::int as orders, COALESCE(SUM(total),0) as revenue, COALESCE(SUM(discount),0) as discounts FROM orders WHERE status='completed' AND created_at::date BETWEEN ${df} AND ${dt}`;
  const [cost]         = await sql`SELECT COALESCE(SUM(oi.cost_price * oi.quantity),0) as total_cost FROM order_items oi JOIN orders o ON oi.order_id=o.id WHERE o.status='completed' AND o.created_at::date BETWEEN ${df} AND ${dt}`;
  const topProducts    = await sql`SELECT oi.product_name, SUM(oi.quantity)::int as qty, SUM(oi.total) as revenue, SUM(oi.cost_price*oi.quantity) as cost FROM order_items oi JOIN orders o ON oi.order_id=o.id WHERE o.status='completed' AND o.created_at::date BETWEEN ${df} AND ${dt} GROUP BY oi.product_name ORDER BY revenue DESC LIMIT 10`;
  const dailySales     = await sql`SELECT created_at::date as date, COUNT(*)::int as orders, SUM(total) as revenue FROM orders WHERE status='completed' AND created_at::date BETWEEN ${df} AND ${dt} GROUP BY created_at::date ORDER BY date ASC`;
  const categoryRevenue= await sql`SELECT COALESCE(p.category,'Uncategorized') as category, SUM(oi.total) as revenue FROM order_items oi LEFT JOIN products p ON oi.product_id=p.id JOIN orders o ON oi.order_id=o.id WHERE o.status='completed' AND o.created_at::date BETWEEN ${df} AND ${dt} GROUP BY p.category ORDER BY revenue DESC`;
  const lowStock       = await sql`SELECT * FROM products WHERE stock <= min_stock ORDER BY stock ASC`;

  const revenue   = parseFloat(sales.revenue);
  const totalCost = parseFloat(cost.total_cost);

  res.json({
    orders: sales.orders,
    revenue,
    total_cost: totalCost,
    gross_profit: revenue - totalCost,
    discounts: parseFloat(sales.discounts),
    profit_margin: revenue > 0 ? ((revenue - totalCost) / revenue * 100).toFixed(1) : '0.0',
    top_products: topProducts,
    daily_sales: dailySales,
    category_revenue: categoryRevenue,
    low_stock: lowStock
  });
}));

// ── SPA fallback ───────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  initDB().then(() => {
    app.listen(PORT, () => {
      console.log(`\n  POS System running at http://localhost:${PORT}`);
      console.log('  Admin login:   admin / admin123');
      console.log('  Cashier login: cashier1 / cashier123\n');
    });
  }).catch(err => { console.error('DB init failed:', err); process.exit(1); });
}

module.exports = app;

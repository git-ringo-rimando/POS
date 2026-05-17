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
function extractToken(req) {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  const cookies = req.headers.cookie || '';
  const m = cookies.match(/(?:^|;\s*)pos_token=([^;]+)/);
  return m ? m[1] : null;
}

const auth = (req, res, next) => {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, SECRET);
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
  const token = jwt.sign(payload, SECRET, { expiresIn: '10h' });
  res.cookie('pos_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 * 60 * 1000 });
  res.json({ token, user: payload });
}));

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('pos_token');
  res.json({ success: true });
});

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

    // Reverse all distributed points on void
    const distributed = Array.isArray(order.points_distributed) ? order.points_distributed : [];
    for (const dist of distributed) {
      if (!dist.member_id || !dist.points) continue;
      const [m] = await sql`SELECT id, full_name, points FROM loyalty_members WHERE id = ${dist.member_id}`;
      if (!m) continue;
      const newPoints = Math.max(0, m.points - dist.points);
      await sql`UPDATE loyalty_members SET points = ${newPoints} WHERE id = ${m.id}`;
      await sql`INSERT INTO loyalty_member_history (member_id, member_name, changed_by, field_changed, old_value, new_value)
        VALUES (${m.id}, ${m.full_name}, ${req.user.full_name || req.user.username}, 'points',
                ${String(m.points)}, ${newPoints + ' (−' + dist.points + ' pts reversed — void ' + order.order_number + ')'})`;
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
  const { items, discount = 0, payment_method = 'cash', amount_paid, notes, loyalty_member_id, points_redeemed = 0 } = req.body;
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

    const discountAmt  = parseFloat(discount) || 0;
    const redeemedPts  = parseInt(points_redeemed) || 0;
    const memberId     = loyalty_member_id ? parseInt(loyalty_member_id) : null;

    // Fetch loyalty member if provided (include referred_by_id for chain walk)
    let loyaltyMember = null;
    if (memberId) {
      [loyaltyMember] = await sql`SELECT id, full_name, points, referred_by_id FROM loyalty_members WHERE id = ${memberId}`;
      if (!loyaltyMember) throw Object.assign(new Error('Loyalty member not found'), { status: 404 });
      if (redeemedPts > 0 && loyaltyMember.points < redeemedPts)
        throw Object.assign(new Error(`Insufficient points. Member has ${loyaltyMember.points} pts (₱${loyaltyMember.points.toLocaleString()})`), { status: 400 });
    }

    // Distribute points up the referral chain — tier sort_order maps to chain level
    // Level 1 (buyer): ratio-based — floor(eligible_spend / points_ratio)
    // Level 2+ (referrers): fixed points_earned from tiers table
    let ptsToAccumulate = 0;
    const pointsDistributed = [];
    if (loyaltyMember && redeemedPts === 0) {
      const [ratioRow] = await sql`SELECT value FROM settings WHERE key = 'points_ratio'`;
      const pointsRatio = Math.max(1, parseFloat(ratioRow?.value) || 100);

      const [frozenCat] = await sql`SELECT name FROM categories WHERE name ILIKE '%FROZEN RESELER%' LIMIT 1`;
      const excludedCat = frozenCat?.name || '5 FROZEN RESELER';
      const eligibleSpend = resolved.reduce((sum, { p, lineTotal }) =>
        p.category === excludedCat ? sum : sum + lineTotal, 0);

      const tiers = await sql`SELECT * FROM loyalty_tiers WHERE is_active = true ORDER BY sort_order ASC`;
      let current = loyaltyMember;
      for (let i = 0; i < tiers.length; i++) {
        if (!current) break;
        const pts = i === 0
          ? Math.floor(eligibleSpend / pointsRatio)   // buyer: ratio-based
          : tiers[i].points_earned;                   // referrers: fixed
        if (pts > 0) {
          pointsDistributed.push({ member_id: current.id, member_name: current.full_name, points: pts });
          if (i === 0) ptsToAccumulate = pts;
        }
        current = current.referred_by_id
          ? (await sql`SELECT id, full_name, points, referred_by_id FROM loyalty_members WHERE id = ${current.referred_by_id}`)[0] || null
          : null;
      }
    }

    const total    = Math.max(0, subtotal - discountAmt - redeemedPts);
    const paid     = parseFloat(amount_paid) || total;
    const change   = Math.max(0, paid - total);
    const orderNum = `ORD-${Date.now()}`;

    const [ord] = await sql`
      INSERT INTO orders (order_number, user_id, subtotal, discount, total, payment_method, amount_paid, change_amount, notes, loyalty_member_id, points_redeemed, points_accumulated, points_distributed)
      VALUES (${orderNum}, ${req.user.id}, ${subtotal}, ${discountAmt}, ${total}, ${payment_method}, ${paid}, ${change}, ${notes || null}, ${memberId}, ${redeemedPts}, ${ptsToAccumulate}, ${JSON.stringify(pointsDistributed)})
      RETURNING id`;

    for (const { p, qty, lineTotal } of resolved) {
      await sql`INSERT INTO order_items (order_id, product_id, product_name, cost_price, selling_price, quantity, total) VALUES (${ord.id}, ${p.id}, ${p.name}, ${p.cost_price}, ${p.selling_price}, ${qty}, ${lineTotal})`;
      const newStock = p.stock - qty;
      await sql`UPDATE products SET stock=${newStock}, updated_at=CURRENT_TIMESTAMP WHERE id=${p.id}`;
      await sql`INSERT INTO inventory_logs (product_id, user_id, type, quantity, previous_stock, new_stock, notes) VALUES (${p.id}, ${req.user.id}, 'out', ${qty}, ${p.stock}, ${newStock}, ${'Sale: ' + orderNum})`;
      await applyCascadedLinks(sql, p.id, newStock, p.name, req.user.id);
    }

    // Deduct redeemed points
    if (loyaltyMember && redeemedPts > 0) {
      const newPoints = loyaltyMember.points - redeemedPts;
      await sql`UPDATE loyalty_members SET points = ${newPoints} WHERE id = ${loyaltyMember.id}`;
      await sql`INSERT INTO loyalty_member_history (member_id, member_name, changed_by, field_changed, old_value, new_value)
        VALUES (${loyaltyMember.id}, ${loyaltyMember.full_name}, ${req.user.full_name || req.user.username}, 'points',
                ${String(loyaltyMember.points)}, ${newPoints + ' (−' + redeemedPts + ' pts redeemed on ' + orderNum + ')'})`;
    }

    // Distribute earned points up the referral chain
    for (const dist of pointsDistributed) {
      const [m] = await sql`SELECT id, full_name, points FROM loyalty_members WHERE id = ${dist.member_id}`;
      if (!m) continue;
      const newPoints = m.points + dist.points;
      const label = dist.member_id === memberId
        ? `+${dist.points} pts earned on ${orderNum}`
        : `+${dist.points} pts referral bonus from ${orderNum}`;
      await sql`UPDATE loyalty_members SET points = ${newPoints} WHERE id = ${m.id}`;
      await sql`INSERT INTO loyalty_member_history (member_id, member_name, changed_by, field_changed, old_value, new_value)
        VALUES (${m.id}, ${m.full_name}, ${req.user.full_name || req.user.username}, 'points',
                ${String(m.points)}, ${newPoints + ' (' + label + ')'})`;
    }

    return { order_id: ord.id, order_number: orderNum, subtotal, discount: discountAmt, points_redeemed: redeemedPts, points_accumulated: ptsToAccumulate, points_distributed: pointsDistributed, total, change, payment_method };
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

// ── Settings ───────────────────────────────────────────────────────────────────
app.get('/api/settings', ah(async (req, res) => {
  const rows = await sql`SELECT key, value FROM settings WHERE key IN ('business_name', 'logo', 'points_ratio')`;
  const out = { business_name: 'Aling Inday Kamuning Branch POS', logo: null, points_ratio: 100 };
  rows.forEach(r => { out[r.key] = r.key === 'points_ratio' ? parseFloat(r.value) || 100 : r.value; });
  res.json(out);
}));

app.put('/api/settings', auth, adminOnly, ah(async (req, res) => {
  const { business_name, logo, points_ratio } = req.body;
  if (business_name !== undefined) {
    const name = String(business_name).trim() || 'Aling Inday Kamuning Branch POS';
    await sql`INSERT INTO settings (key, value) VALUES ('business_name', ${name}) ON CONFLICT (key) DO UPDATE SET value = ${name}, updated_at = CURRENT_TIMESTAMP`;
  }
  if (logo !== undefined) {
    await sql`INSERT INTO settings (key, value) VALUES ('logo', ${logo}) ON CONFLICT (key) DO UPDATE SET value = ${logo}, updated_at = CURRENT_TIMESTAMP`;
  }
  if (points_ratio !== undefined) {
    const ratio = Math.max(1, parseFloat(points_ratio) || 100);
    await sql`INSERT INTO settings (key, value) VALUES ('points_ratio', ${String(ratio)}) ON CONFLICT (key) DO UPDATE SET value = ${String(ratio)}, updated_at = CURRENT_TIMESTAMP`;
  }
  res.json({ success: true });
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

// ── Daily Sales Summary (all roles) ───────────────────────────────────────────
app.get('/api/reports/daily-summary', auth, ah(async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const df = req.query.from || today;
  const dt = req.query.to   || today;
  const [sales]  = await sql`SELECT COUNT(*)::int as orders, COALESCE(SUM(total),0) as revenue, COALESCE(SUM(discount),0) as discounts FROM orders WHERE status='completed' AND created_at::date BETWEEN ${df} AND ${dt}`;
  const [cost]   = await sql`SELECT COALESCE(SUM(oi.cost_price * oi.quantity),0) as total_cost FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.status='completed' AND o.created_at::date BETWEEN ${df} AND ${dt}`;
  const paymentBreakdown = await sql`SELECT payment_method, COUNT(*)::int as count, COALESCE(SUM(total),0) as total FROM orders WHERE status='completed' AND created_at::date BETWEEN ${df} AND ${dt} GROUP BY payment_method ORDER BY total DESC`;
  const cashierBreakdown = await sql`SELECT u.full_name as cashier_name, COUNT(*)::int as orders, COALESCE(SUM(o.total),0) as revenue FROM orders o JOIN users u ON o.user_id = u.id WHERE o.status='completed' AND o.created_at::date BETWEEN ${df} AND ${dt} GROUP BY u.full_name ORDER BY revenue DESC`;
  const topItems         = await sql`SELECT oi.product_name, SUM(oi.quantity)::int as qty, SUM(oi.total) as revenue FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.status='completed' AND o.created_at::date BETWEEN ${df} AND ${dt} GROUP BY oi.product_name ORDER BY qty DESC LIMIT 10`;
  const hourlyBreakdown  = await sql`SELECT EXTRACT(HOUR FROM created_at)::int as hour, COUNT(*)::int as orders, COALESCE(SUM(total),0) as revenue FROM orders WHERE status='completed' AND created_at::date BETWEEN ${df} AND ${dt} GROUP BY hour ORDER BY hour ASC`;
  const revenue   = parseFloat(sales.revenue);
  const totalCost = parseFloat(cost.total_cost);
  res.json({
    from: df,
    to: dt,
    orders: sales.orders,
    revenue,
    total_cost: totalCost,
    gross_profit: revenue - totalCost,
    discounts: parseFloat(sales.discounts),
    profit_margin: revenue > 0 ? ((revenue - totalCost) / revenue * 100).toFixed(1) : '0.0',
    payment_breakdown: paymentBreakdown,
    cashier_breakdown: cashierBreakdown,
    top_items: topItems,
    hourly_breakdown: hourlyBreakdown
  });
}));

// ── Loyalty Program ────────────────────────────────────────────────────────────
function validateReferralCode(code) {
  if (!code || code.length !== 8)        return 'Referral code must be exactly 8 characters';
  if (!/^[A-Za-z0-9]{8}$/.test(code))   return 'Referral code may only contain letters and numbers';
  return null;
}

function validatePasswordComplexity(pw) {
  if (!pw || pw.length < 8)       return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(pw))          return 'Password must contain at least 1 uppercase letter';
  if (!/[a-z]/.test(pw))          return 'Password must contain at least 1 lowercase letter';
  if (!/[0-9]/.test(pw))          return 'Password must contain at least 1 number';
  if (!/[^A-Za-z0-9]/.test(pw))   return 'Password must contain at least 1 special character';
  return null;
}
const loyaltyAuth = (req, res, next) => {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(h.slice(7), SECRET);
    if (!decoded.loyalty_member_id) return res.status(401).json({ error: 'Invalid token' });
    req.member = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Token expired or invalid' });
  }
};

app.get('/AIR', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'AIR.html'));
});

app.get('/AIR-admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'AIR-admin.html'));
});

app.get('/api/loyalty/referral-check', ah(async (req, res) => {
  const code = req.query.code?.trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Referral code required' });
  const [m] = await sql`SELECT id, full_name FROM loyalty_members WHERE referral_code = ${code}`;
  if (!m) return res.status(404).json({ error: 'Referral code not found' });
  res.json({ id: m.id, full_name: m.full_name });
}));

app.get('/api/loyalty/check-code', ah(async (req, res) => {
  const code = req.query.code?.trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'Code required' });
  const err = validateReferralCode(code);
  if (err) return res.json({ available: false, error: err });
  const [existing] = await sql`SELECT id FROM loyalty_members WHERE referral_code = ${code}`;
  res.json({ available: !existing });
}));

app.post('/api/loyalty/register', ah(async (req, res) => {
  const { full_name, contact_number, email, password, my_code, referral_code } = req.body || {};
  if (!full_name?.trim())     return res.status(400).json({ error: 'Full name is required' });
  if (!contact_number?.trim())return res.status(400).json({ error: 'Contact number is required' });
  if (!email?.trim())         return res.status(400).json({ error: 'Email address is required' });
  const pwErr = validatePasswordComplexity(password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  const myCode = my_code?.trim().toUpperCase();
  if (!myCode) return res.status(400).json({ error: 'Referral code is required' });
  const codeErr = validateReferralCode(myCode);
  if (codeErr) return res.status(400).json({ error: codeErr });
  const [codeExists] = await sql`SELECT id FROM loyalty_members WHERE referral_code = ${myCode}`;
  if (codeExists) return res.status(409).json({ error: 'That referral code is already taken. Please choose another.' });
  let referred_by_id = null;
  if (referral_code?.trim()) {
    const [referrer] = await sql`SELECT id FROM loyalty_members WHERE referral_code = ${referral_code.trim().toUpperCase()}`;
    if (referrer) referred_by_id = referrer.id;
  }
  try {
    const [m] = await sql`
      INSERT INTO loyalty_members (full_name, contact_number, email, password, referral_code, referred_by_id)
      VALUES (${full_name.trim()}, ${contact_number.trim()}, ${email.trim().toLowerCase()}, ${bcrypt.hashSync(password, 10)}, ${myCode}, ${referred_by_id})
      RETURNING id, full_name, contact_number, email, points, referral_code, referred_by_id, created_at
    `;
    const payload = { loyalty_member_id: m.id, contact_number: m.contact_number, full_name: m.full_name };
    res.json({ token: jwt.sign(payload, SECRET, { expiresIn: '24h' }), member: { id: m.id, full_name: m.full_name, contact_number: m.contact_number, email: m.email, points: m.points, referral_code: m.referral_code, referred_by_id: m.referred_by_id, created_at: m.created_at } });
  } catch (e) {
    if (e.code === '23505') {
      const msg = e.detail?.includes('contact_number') ? 'Contact number already registered' : e.detail?.includes('email') ? 'Email already registered' : 'Referral code already taken';
      return res.status(409).json({ error: msg });
    }
    throw e;
  }
}));

app.post('/api/loyalty/login', ah(async (req, res) => {
  const { contact_number, password } = req.body || {};
  if (!contact_number || !password) return res.status(400).json({ error: 'Contact number and password required' });
  const [m] = await sql`SELECT * FROM loyalty_members WHERE contact_number = ${contact_number.trim()}`;
  if (!m || !bcrypt.compareSync(password, m.password)) {
    return res.status(401).json({ error: 'Invalid contact number or password' });
  }
  const payload = { loyalty_member_id: m.id, contact_number: m.contact_number, full_name: m.full_name };
  res.json({ token: jwt.sign(payload, SECRET, { expiresIn: '24h' }), member: { id: m.id, full_name: m.full_name, contact_number: m.contact_number, email: m.email, points: m.points, referral_code: m.referral_code, created_at: m.created_at } });
}));

app.get('/api/loyalty/me', loyaltyAuth, ah(async (req, res) => {
  const [m] = await sql`SELECT id, full_name, contact_number, email, points, referral_code, created_at FROM loyalty_members WHERE id = ${req.member.loyalty_member_id}`;
  if (!m) return res.status(404).json({ error: 'Member not found' });
  res.json(m);
}));

app.post('/api/loyalty/verify-identity', ah(async (req, res) => {
  const { full_name, contact_number, email } = req.body || {};
  if (!full_name?.trim() || !contact_number?.trim() || !email?.trim())
    return res.status(400).json({ error: 'Full name, contact number, and email are all required' });
  const [m] = await sql`
    SELECT id, full_name FROM loyalty_members
    WHERE LOWER(full_name) = LOWER(${full_name.trim()})
      AND contact_number   = ${contact_number.trim()}
      AND LOWER(email)     = LOWER(${email.trim()})`;
  if (!m) return res.status(400).json({ error: 'Details do not match any account. Please check your name, contact number, and email.' });
  const resetToken = jwt.sign({ reset_member_id: m.id, purpose: 'password_reset' }, SECRET, { expiresIn: '15m' });
  res.json({ reset_token: resetToken, full_name: m.full_name });
}));

app.post('/api/loyalty/reset-password', ah(async (req, res) => {
  const { reset_token, new_password } = req.body || {};
  if (!reset_token) return res.status(400).json({ error: 'Reset token required' });
  let decoded;
  try {
    decoded = jwt.verify(reset_token, SECRET);
    if (decoded.purpose !== 'password_reset') throw new Error('invalid');
  } catch {
    return res.status(400).json({ error: 'Reset link is invalid or has expired. Please start again.' });
  }
  const pwErr = validatePasswordComplexity(new_password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  const id = decoded.reset_member_id;
  const [m] = await sql`SELECT id, full_name FROM loyalty_members WHERE id = ${id}`;
  if (!m) return res.status(404).json({ error: 'Member not found' });
  await sql`UPDATE loyalty_members SET password = ${bcrypt.hashSync(new_password, 10)} WHERE id = ${id}`;
  await sql`INSERT INTO loyalty_member_history (member_id, member_name, changed_by, field_changed, old_value, new_value) VALUES (${id}, ${m.full_name}, ${'Self (password reset)'}, ${'password'}, ${'[hidden]'}, ${'[changed via forgot password]'})`;
  res.json({ success: true });
}));

app.put('/api/loyalty/members/:id/reset-password', auth, adminOnly, ah(async (req, res) => {
  const id = parseInt(req.params.id);
  const { new_password } = req.body || {};
  const pwErr = validatePasswordComplexity(new_password);
  if (pwErr) return res.status(400).json({ error: pwErr });
  const [m] = await sql`SELECT id, full_name FROM loyalty_members WHERE id = ${id}`;
  if (!m) return res.status(404).json({ error: 'Member not found' });
  await sql`UPDATE loyalty_members SET password = ${bcrypt.hashSync(new_password, 10)} WHERE id = ${id}`;
  await sql`INSERT INTO loyalty_member_history (member_id, member_name, changed_by, field_changed, old_value, new_value) VALUES (${id}, ${m.full_name}, ${req.user.full_name || req.user.username}, ${'password'}, ${'[hidden]'}, ${'[admin hard reset]'})`;
  res.json({ success: true });
}));

// Build 2-level referral tree for a given member id
async function getReferralTree(rootId) {
  const direct = await sql`SELECT id, full_name, contact_number, points, created_at FROM loyalty_members WHERE referred_by_id = ${rootId} ORDER BY created_at ASC`;
  return Promise.all(direct.map(async m => {
    const children = await sql`SELECT id, full_name, contact_number, points, created_at FROM loyalty_members WHERE referred_by_id = ${m.id} ORDER BY created_at ASC`;
    return { ...m, referrals: children };
  }));
}

app.get('/api/loyalty/me/referrals', loyaltyAuth, ah(async (req, res) => {
  res.json(await getReferralTree(req.member.loyalty_member_id));
}));

app.get('/api/loyalty/members/:id/referrals', auth, adminOnly, ah(async (req, res) => {
  res.json(await getReferralTree(parseInt(req.params.id)));
}));

app.get('/api/loyalty/members', auth, adminOnly, ah(async (req, res) => {
  res.json(await sql`SELECT id, full_name, contact_number, email, points, referral_code, created_at FROM loyalty_members ORDER BY created_at DESC`);
}));

app.get('/api/loyalty/lookup', auth, ah(async (req, res) => {
  const q = req.query.contact?.trim();
  if (!q) return res.status(400).json({ error: 'Contact number or name required' });
  // Try exact contact number first
  const [byContact] = await sql`SELECT id, full_name, contact_number, points FROM loyalty_members WHERE contact_number = ${q}`;
  if (byContact) return res.json({ ...byContact, match_type: 'contact' });
  // Fallback: search by name (partial, case-insensitive)
  const byName = await sql`SELECT id, full_name, contact_number, points FROM loyalty_members WHERE full_name ILIKE ${'%' + q + '%'} ORDER BY full_name LIMIT 5`;
  if (byName.length === 0) return res.status(404).json({ error: 'No loyalty member found' });
  res.json({ match_type: 'name', results: byName });
}));

app.get('/api/loyalty/tiers', auth, ah(async (req, res) => {
  res.json(await sql`SELECT * FROM loyalty_tiers ORDER BY sort_order ASC`);
}));

app.put('/api/loyalty/tiers', auth, adminOnly, ah(async (req, res) => {
  const { tiers } = req.body;
  if (!Array.isArray(tiers) || tiers.length !== 5) return res.status(400).json({ error: '5 tiers required' });
  await sql.begin(async sql => {
    for (const t of tiers) {
      await sql`UPDATE loyalty_tiers SET tier_name=${t.tier_name}, min_spend=${parseFloat(t.min_spend)||0}, points_earned=${parseInt(t.points_earned)||1}, is_active=${!!t.is_active}, updated_at=CURRENT_TIMESTAMP WHERE id=${t.id}`;
    }
  });
  res.json({ success: true });
}));

app.put('/api/loyalty/members/:id', auth, adminOnly, ah(async (req, res) => {
  const id = parseInt(req.params.id);
  const { full_name, contact_number, email, points, created_at } = req.body;
  const [before] = await sql`SELECT * FROM loyalty_members WHERE id=${id}`;
  if (!before) return res.status(404).json({ error: 'Member not found' });
  const changedBy = req.user.full_name || req.user.username;
  const changes = [];
  if (full_name     !== undefined && full_name     !== before.full_name)     changes.push(['full_name',      before.full_name,                          full_name]);
  if (contact_number!== undefined && contact_number!== before.contact_number)changes.push(['contact_number', before.contact_number,                     contact_number]);
  if (email         !== undefined && email         !== before.email)         changes.push(['email',          before.email,                              email]);
  if (points        !== undefined && String(points)!== String(before.points)) changes.push(['points',        String(before.points),                     String(points)]);
  if (created_at    !== undefined)                                            changes.push(['created_at',     before.created_at?.toISOString?.() ?? String(before.created_at), created_at]);
  try {
    await sql`UPDATE loyalty_members SET
      full_name      = ${full_name      ?? before.full_name},
      contact_number = ${contact_number ?? before.contact_number},
      email          = ${email          ?? before.email},
      points         = ${points         != null ? parseInt(points) : before.points},
      created_at     = ${created_at     ?? before.created_at}
    WHERE id = ${id}`;
    for (const [field, oldVal, newVal] of changes) {
      await sql`INSERT INTO loyalty_member_history (member_id, member_name, changed_by, field_changed, old_value, new_value) VALUES (${id}, ${full_name ?? before.full_name}, ${changedBy}, ${field}, ${oldVal}, ${newVal})`;
    }
    res.json({ success: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Contact number or email already in use' });
    throw e;
  }
}));

app.get('/api/loyalty/members/:id/history', auth, adminOnly, ah(async (req, res) => {
  const id = parseInt(req.params.id);
  res.json(await sql`SELECT * FROM loyalty_member_history WHERE member_id=${id} ORDER BY changed_at DESC`);
}));

// ── Protected pages ────────────────────────────────────────────────────────────
app.get('/sales/pos/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/sales/pos/admin.html', (req, res) => {
  const token = extractToken(req);
  if (!token) return res.sendFile(path.join(__dirname, 'views', 'login.html'));
  try {
    const user = jwt.verify(token, SECRET);
    if (!['admin', 'account_manager', 'cashier'].includes(user.role)) return res.sendFile(path.join(__dirname, 'views', 'login.html'));
    res.sendFile(path.join(__dirname, 'views', 'admin.html'));
  } catch {
    res.clearCookie('pos_token');
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
  }
});

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

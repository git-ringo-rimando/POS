// ── Auth guard ─────────────────────────────────────────────────────────────────
const user = getUser();
if (!user || !getToken()) { window.location.href = '/'; throw new Error('stop'); }
if (!['admin', 'account_manager'].includes(user.role)) { window.location.href = '/pos.html'; throw new Error('stop'); }

const isAdmin = user.role === 'admin';

document.getElementById('sidebarName').textContent = user.full_name || user.username;
document.getElementById('sidebarAvatar').textContent = (user.full_name || user.username)[0].toUpperCase();
document.getElementById('sidebarRoleLabel').textContent = isAdmin ? 'Administrator' : 'Account Manager';
const h = new Date().getHours();
document.getElementById('dashGreeting').textContent = h < 12 ? 'Good morning!' : h < 18 ? 'Good afternoon!' : 'Good evening!';
document.getElementById('logoutBtn').addEventListener('click', () => { clearSession(); window.location.href = '/'; });
document.getElementById('posLink').addEventListener('click', () => window.location.href = '/pos.html');

// Hide admin-only nav items for account managers
if (!isAdmin) {
  document.querySelectorAll('[data-admin-only]').forEach(el => el.style.display = 'none');
}

// ── Navigation ─────────────────────────────────────────────────────────────────
let revenueChartInst, reportChartInst, categoryChartInst;

document.querySelectorAll('.nav-item[data-section]').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
    item.classList.add('active');
    const section = document.getElementById('section-' + item.dataset.section);
    if (section) section.classList.add('active');
    const loaders = { dashboard: loadDashboard, products: loadProducts, inventory: loadInventory, orders: loadOrders, users: loadUsers, categories: loadCategories };
    loaders[item.dataset.section]?.();
  });
});

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const parent = btn.closest('.admin-section') || document.body;
    parent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    parent.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = document.getElementById(btn.dataset.tab);
    if (panel) panel.classList.add('active');
    if (btn.dataset.tab === 'inv-logs') loadInventoryLogs();
    if (btn.dataset.tab === 'prod-history') loadProductHistory();
    if (btn.dataset.tab === 'cat-archive') loadCategoryArchive();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════════════════
async function loadDashboard() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [summary, allProducts] = await Promise.all([
      api.get(`/reports/summary?from=${today}&to=${today}`),
      api.get('/products')
    ]);

    document.getElementById('kpiRevenue').textContent = fmt(summary.revenue);
    document.getElementById('kpiOrders').textContent = `${summary.orders} orders today`;
    document.getElementById('kpiProfit').textContent = fmt(summary.gross_profit);
    document.getElementById('kpiMargin').textContent = `${summary.profit_margin}% margin`;
    document.getElementById('kpiProducts').textContent = allProducts.length;
    document.getElementById('kpiLowStock').textContent = `${summary.low_stock.length} need restocking`;
    document.getElementById('kpiLowStockCount').textContent = summary.low_stock.length;

    // Revenue chart (last 30 days)
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
    const from = thirtyDaysAgo.toISOString().slice(0, 10);
    const chartData = await api.get(`/reports/summary?from=${from}&to=${today}`);
    renderRevenueChart(chartData.daily_sales);
    renderTopProductsList(chartData.top_products);

    // Low stock table
    const tbody = document.getElementById('lowStockBody');
    if (summary.low_stock.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:24px">No low stock items 🎉</td></tr>`;
    } else {
      tbody.innerHTML = summary.low_stock.map(p => `
        <tr>
          <td><strong>${p.name}</strong>${p.sku ? `<br><span class="text-sm text-muted">${p.sku}</span>` : ''}</td>
          <td>${p.category || 'General'}</td>
          <td><strong style="color:${p.stock === 0 ? '#ef4444' : '#f59e0b'}">${p.stock}</strong> ${p.unit}</td>
          <td>${p.min_stock} ${p.unit}</td>
          <td>${p.stock === 0 ? '<span class="badge badge-danger">Out of Stock</span>' : '<span class="badge badge-warning">Low Stock</span>'}</td>
        </tr>`).join('');
    }
  } catch (e) { toast.error('Failed to load dashboard: ' + e.message); }
}

function renderRevenueChart(dailySales) {
  const ctx = document.getElementById('revenueChart').getContext('2d');
  if (revenueChartInst) revenueChartInst.destroy();
  revenueChartInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dailySales.map(d => new Date(d.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })),
      datasets: [{
        label: 'Revenue',
        data: dailySales.map(d => d.revenue),
        borderColor: '#4f46e5', backgroundColor: 'rgba(79,70,229,0.08)',
        tension: 0.3, fill: true, pointRadius: 3
      }]
    },
    options: {
      responsive: true, plugins: { legend: { display: false } },
      scales: { y: { ticks: { callback: v => '₱' + v.toLocaleString() }, grid: { color: '#f3f4f6' } }, x: { grid: { display: false } } }
    }
  });
}

function renderTopProductsList(products) {
  const el = document.getElementById('topProductsList');
  if (!products.length) { el.innerHTML = '<p class="text-muted text-sm" style="padding:16px">No sales data yet</p>'; return; }
  const max = products[0]?.revenue || 1;
  el.innerHTML = products.slice(0, 5).map((p, i) => `
    <div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px">
        <span style="font-weight:600">${i + 1}. ${p.product_name}</span>
        <span style="color:#6b7280">${fmt(p.revenue)}</span>
      </div>
      <div style="height:6px;background:#f3f4f6;border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${(p.revenue/max*100).toFixed(1)}%;background:#4f46e5;border-radius:3px"></div>
      </div>
    </div>`).join('');
}

document.getElementById('dashRefresh').addEventListener('click', loadDashboard);

// ══════════════════════════════════════════════════════════════════════════════
// PRODUCTS
// ══════════════════════════════════════════════════════════════════════════════
let allProducts = [];
let allCategories = [];

async function loadProducts() {
  try {
    [allProducts, allCategories] = await Promise.all([api.get('/products'), api.get('/categories')]);
    renderProductsTable();
    updateCategoryFilters();
  } catch (e) { toast.error('Failed to load products'); }
}

function updateCategoryFilters() {
  const cats = allCategories.map(c => c.name).sort();
  const catSel = document.getElementById('productCategoryFilter');
  catSel.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option>${c}</option>`).join('');
  const catList = document.getElementById('categoryList');
  catList.innerHTML = cats.map(c => `<option value="${c}">`).join('');
}

function renderProductsTable() {
  const search = document.getElementById('productSearchAdmin').value.toLowerCase();
  const cat = document.getElementById('productCategoryFilter').value;
  const filtered = allProducts.filter(p => {
    const ms = !search || p.name.toLowerCase().includes(search) || (p.sku || '').toLowerCase().includes(search) || (p.category || '').toLowerCase().includes(search);
    const mc = !cat || p.category === cat;
    return ms && mc;
  });
  const tbody = document.getElementById('productsBody');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#9ca3af;padding:24px">No products found</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(p => {
    const margin = p.selling_price > 0 ? ((p.selling_price - p.cost_price) / p.selling_price * 100).toFixed(1) : 0;
    return `
      <tr>
        <td><strong>${p.name}</strong></td>
        <td class="text-muted">${p.sku || '—'}</td>
        <td>${p.category || 'General'}</td>
        <td>${fmt(p.cost_price)}</td>
        <td style="font-weight:600">${fmt(p.selling_price)}</td>
        <td><span class="badge ${parseFloat(margin) > 20 ? 'badge-success' : parseFloat(margin) > 10 ? 'badge-warning' : 'badge-danger'}">${margin}%</span></td>
        <td>${stockBadge(p.stock, p.min_stock)}</td>
        <td>
          <div class="table-actions">
            <button class="btn btn-sm btn-outline" data-edit="${p.id}">Edit</button>
            <button class="btn btn-sm btn-danger" data-delete="${p.id}">Delete</button>
          </div>
        </td>
      </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openProductModal(allProducts.find(p => p.id === parseInt(btn.dataset.edit))));
  });
  tbody.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const pid = parseInt(btn.getAttribute('data-delete'));
        const p = allProducts.find(x => x.id === pid);
        if (!p) { await loadProducts(); return; }
        if (!window.confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
        await api.delete('/products/' + p.id);
        toast.success('Product deleted');
        await loadProducts();
      } catch (e) { toast.error(e.message || 'Failed to delete product'); }
    });
  });
}

document.getElementById('productSearchAdmin').addEventListener('input', renderProductsTable);
document.getElementById('productCategoryFilter').addEventListener('change', renderProductsTable);
document.getElementById('refreshProductsBtn').addEventListener('click', loadProducts);

function openProductModal(product = null) {
  document.getElementById('productModalTitle').textContent = product ? 'Edit Product' : 'Add Product';
  document.getElementById('productId').value = product?.id || '';
  document.getElementById('pName').value = product?.name || '';
  document.getElementById('pSku').value = product?.sku || '';
  document.getElementById('pCategory').value = product?.category || '';
  document.getElementById('pCost').value = product?.cost_price ?? '';
  document.getElementById('pPrice').value = product?.selling_price ?? '';
  document.getElementById('pMinStock').value = product?.min_stock ?? 5;
  document.getElementById('pUnit').value = product?.unit || 'pcs';
  updateMarginPreview();
  document.getElementById('productModal').classList.remove('hidden');
}

function updateMarginPreview() {
  const cost = parseFloat(document.getElementById('pCost').value) || 0;
  const price = parseFloat(document.getElementById('pPrice').value) || 0;
  const el = document.getElementById('pMarginPreview');
  if (cost > 0 && price > 0) {
    const margin = ((price - cost) / price * 100).toFixed(1);
    const profit = price - cost;
    el.textContent = `Gross profit: ${fmt(profit)} per unit (${margin}% margin)`;
    el.style.color = parseFloat(margin) > 0 ? '#10b981' : '#ef4444';
  } else { el.textContent = ''; }
}

['pCost', 'pPrice'].forEach(id => document.getElementById(id).addEventListener('input', updateMarginPreview));

document.getElementById('addProductBtn').addEventListener('click', () => openProductModal());
document.getElementById('closeProductModal').addEventListener('click', () => document.getElementById('productModal').classList.add('hidden'));
document.getElementById('cancelProductModal').addEventListener('click', () => document.getElementById('productModal').classList.add('hidden'));

document.getElementById('saveProductBtn').addEventListener('click', async () => {
  const id = document.getElementById('productId').value;
  const body = {
    name: document.getElementById('pName').value.trim(),
    sku: document.getElementById('pSku').value.trim() || null,
    category: document.getElementById('pCategory').value.trim() || 'General',
    cost_price: parseFloat(document.getElementById('pCost').value),
    selling_price: parseFloat(document.getElementById('pPrice').value),
    min_stock: parseInt(document.getElementById('pMinStock').value) || 5,
    unit: document.getElementById('pUnit').value.trim() || 'pcs'
  };
  if (!body.name || isNaN(body.cost_price) || isNaN(body.selling_price)) {
    toast.error('Name, cost price, and selling price are required'); return;
  }
  const btn = document.getElementById('saveProductBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    if (id) { await api.put('/products/' + id, body); toast.success('Product updated'); }
    else { await api.post('/products', body); toast.success('Product added'); }
    document.getElementById('productModal').classList.add('hidden');
    loadProducts();
  } catch (e) { toast.error(e.message); }
  finally { btn.disabled = false; btn.textContent = 'Save Product'; }
});

// ══════════════════════════════════════════════════════════════════════════════
// INVENTORY
// ══════════════════════════════════════════════════════════════════════════════
let inventoryProducts = [];

function showLowStockPopup(products) {
  document.getElementById('lowStockPopup')?.remove();
  if (!products.length) return;
  const popup = document.createElement('div');
  popup.id = 'lowStockPopup';
  popup.style.cssText = `
    position:fixed;top:20px;right:20px;z-index:9999;
    background:#fff;border:2px solid #f59e0b;border-radius:12px;
    box-shadow:0 8px 32px rgba(0,0,0,0.18);padding:16px 20px;
    min-width:280px;max-width:360px;animation:fadeIn .2s ease;
  `;
  popup.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px;font-weight:700;color:#92400e;font-size:15px">
        <span style="font-size:20px">⚠️</span> Low Stock Alert
      </div>
      <button onclick="document.getElementById('lowStockPopup').remove()"
        style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;line-height:1">✕</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px">
      ${products.map(p => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:#fef3c7;border-radius:6px">
          <span style="font-size:13px;font-weight:600;color:#374151">${p.name}</span>
          <span style="font-size:12px;color:${p.stock === 0 ? '#ef4444' : '#d97706'};font-weight:700">
            ${p.stock === 0 ? 'Out of stock' : `${p.stock} ${p.unit} left`}
          </span>
        </div>`).join('')}
    </div>
    <div style="margin-top:10px;font-size:11px;color:#9ca3af;text-align:right">Click ✕ to dismiss</div>
  `;
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 10000);
}

async function loadInventory() {
  try {
    inventoryProducts = await api.get('/products');
    renderInventoryTable();
    populateAdjustSelect();
    const lowStock = inventoryProducts.filter(p => p.stock <= p.min_stock);
    if (lowStock.length) showLowStockPopup(lowStock);
  } catch (e) { toast.error('Failed to load inventory'); }
}

function renderInventoryTable() {
  const search = document.getElementById('invSearch').value.toLowerCase();
  const filter = document.getElementById('invStockFilter').value;
  const filtered = inventoryProducts.filter(p => {
    const ms = !search || p.name.toLowerCase().includes(search) || (p.sku || '').toLowerCase().includes(search);
    const mf = !filter || (filter === 'low' && p.stock > 0 && p.stock <= p.min_stock) || (filter === 'out' && p.stock === 0);
    return ms && mf;
  });
  const tbody = document.getElementById('invBody');
  tbody.innerHTML = filtered.map(p => {
    const pct = p.min_stock > 0 ? Math.min(100, (p.stock / (p.min_stock * 3)) * 100) : 100;
    const fillClass = p.stock === 0 ? 'stock-critical' : p.stock <= p.min_stock ? 'stock-low' : 'stock-ok';
    return `
      <tr>
        <td><strong>${p.name}</strong>${p.sku ? `<br><span class="text-sm text-muted">${p.sku}</span>` : ''}</td>
        <td>${p.category || 'General'}</td>
        <td>${p.unit}</td>
        <td>
          <div class="stock-level">
            <strong style="min-width:30px">${p.stock}</strong>
            <div class="stock-bar"><div class="stock-fill ${fillClass}" style="width:${pct}%"></div></div>
          </div>
        </td>
        <td>${p.min_stock}</td>
        <td>${stockBadge(p.stock, p.min_stock)}</td>
        <td class="text-muted text-sm">${fmtDate(p.updated_at)}</td>
        <td>
          <div class="table-actions">
            <button class="btn btn-sm btn-outline" data-inv-adjust="${p.id}">Adjust</button>
            <button class="btn btn-sm btn-ghost" data-inv-history="${p.id}">History</button>
            <button class="btn btn-sm btn-ghost" data-inv-link="${p.id}">Links</button>
          </div>
        </td>
      </tr>`;
  }).join('');
  tbody.querySelectorAll('[data-inv-adjust]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = inventoryProducts.find(x => x.id === parseInt(btn.dataset.invAdjust));
      openAdjustModal(p);
    });
  });
  tbody.querySelectorAll('[data-inv-history]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = inventoryProducts.find(x => x.id === parseInt(btn.dataset.invHistory));
      openInvHistoryModal(p);
    });
  });
  tbody.querySelectorAll('[data-inv-link]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = inventoryProducts.find(x => x.id === parseInt(btn.dataset.invLink));
      openInvLinkModal(p);
    });
  });
}

document.getElementById('invSearch').addEventListener('input', renderInventoryTable);
document.getElementById('invStockFilter').addEventListener('change', renderInventoryTable);

async function loadInventoryLogs() {
  try {
    const logs = await api.get('/inventory/logs');
    const tbody = document.getElementById('logsBody');
    if (!logs.length) { tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#9ca3af;padding:24px">No inventory movements yet</td></tr>`; return; }
    const typeLabels = { in: '<span class="badge badge-success">Stock In</span>', out: '<span class="badge badge-danger">Stock Out</span>', set: '<span class="badge badge-info">Set</span>' };
    tbody.innerHTML = logs.map(l => `
      <tr>
        <td class="text-sm">${fmtDateTime(l.created_at)}</td>
        <td><strong>${l.product_name}</strong></td>
        <td>${typeLabels[l.type] || l.type}</td>
        <td style="font-weight:600">${l.quantity}</td>
        <td class="text-muted">${l.previous_stock}</td>
        <td style="font-weight:600;color:${l.new_stock < l.previous_stock ? '#ef4444' : '#10b981'}">${l.new_stock}</td>
        <td>${l.user_name}</td>
        <td class="text-muted text-sm">${l.notes || '—'}</td>
      </tr>`).join('');
  } catch (e) { toast.error('Failed to load logs'); }
}

// ── Per-product inventory history ─────────────────────────────────────────────
async function openInvHistoryModal(product) {
  document.getElementById('invHistoryModalTitle').textContent = `History: ${product.name}`;
  document.getElementById('invHistoryContent').innerHTML =
    '<div style="text-align:center;padding:40px;color:#9ca3af">Loading…</div>';
  document.getElementById('invHistoryModal').classList.remove('hidden');
  try {
    const logs = await api.get(`/inventory/logs?product_id=${product.id}`);
    if (!logs.length) {
      document.getElementById('invHistoryContent').innerHTML =
        '<div style="text-align:center;padding:40px;color:#9ca3af">No movement history for this product</div>';
      return;
    }
    const typeLabel = { in: '<span class="badge badge-success">Stock In</span>', out: '<span class="badge badge-danger">Stock Out</span>', set: '<span class="badge badge-info">Set</span>' };
    const srcLabel = n => !n ? '<span class="text-muted">Manual</span>'
      : n.startsWith('Sale:')   ? `<span class="badge badge-warning">${n}</span>`
      : n.startsWith('Void:')   ? `<span class="badge badge-info">${n}</span>`
      : n.startsWith('Linked:') ? `<span class="badge badge-secondary">${n}</span>`
      : `<span class="text-muted text-sm">${n}</span>`;
    document.getElementById('invHistoryContent').innerHTML = `
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Date/Time</th><th>Type</th><th>Qty</th><th>Before</th><th>After</th><th>By</th><th>Source / Notes</th></tr></thead>
          <tbody>${logs.map(l => `
            <tr>
              <td class="text-sm">${fmtDateTime(l.created_at)}</td>
              <td>${typeLabel[l.type] || l.type}</td>
              <td style="font-weight:600">${l.quantity}</td>
              <td class="text-muted">${l.previous_stock}</td>
              <td style="font-weight:600;color:${l.new_stock < l.previous_stock ? '#ef4444' : '#10b981'}">${l.new_stock}</td>
              <td>${l.user_name}</td>
              <td>${srcLabel(l.notes)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (e) {
    document.getElementById('invHistoryContent').innerHTML =
      `<div style="text-align:center;padding:40px;color:#ef4444">Error loading history</div>`;
  }
}
document.getElementById('closeInvHistoryModal').addEventListener('click',
  () => document.getElementById('invHistoryModal').classList.add('hidden'));
document.getElementById('closeInvHistoryModalBtn').addEventListener('click',
  () => document.getElementById('invHistoryModal').classList.add('hidden'));

// ── Inventory links ────────────────────────────────────────────────────────────
let invLinkCurrentProduct = null;

async function openInvLinkModal(product) {
  invLinkCurrentProduct = product;
  document.getElementById('invLinkModalTitle').textContent = `Links: ${product.name}`;
  document.getElementById('invLinkProductDesc').textContent =
    `When "${product.name}" stock changes (in/out), linked targets update automatically.`;
  document.getElementById('invLinkProductId').value = product.id;
  document.getElementById('invLinkTargetSelect').innerHTML = inventoryProducts
    .filter(p => p.id !== product.id)
    .map(p => `<option value="${p.id}">${p.name} (stock: ${p.stock})</option>`)
    .join('');
  document.getElementById('invLinkRatio').value = '';
  document.getElementById('invLinkModal').classList.remove('hidden');
  await renderInvLinksList(product.id);
}

async function renderInvLinksList(productId) {
  const container = document.getElementById('invLinksList');
  container.innerHTML = '<div style="text-align:center;padding:16px;color:#9ca3af">Loading…</div>';
  try {
    const links = await api.get(`/inventory/links/${productId}`);
    if (!links.length) {
      container.innerHTML = '<div style="text-align:center;padding:16px;color:#9ca3af">No links configured</div>';
      return;
    }
    container.innerHTML = links.map(link => {
      const isSource = link.source_product_id === productId;
      const roleLabel = isSource
        ? '<span class="badge badge-info">Source</span>'
        : '<span class="badge badge-secondary">Target</span>';
      const removeBtn = isSource
        ? `<button class="btn btn-sm btn-danger" data-delete-link="${link.id}">Remove</button>`
        : '<span class="text-sm text-muted">(managed by source)</span>';
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            ${roleLabel}
            <span style="font-size:13px"><strong>${link.source_name}</strong> → <strong>${link.target_name}</strong></span>
            <span class="badge badge-warning">×${link.ratio}</span>
          </div>
          ${removeBtn}
        </div>`;
    }).join('');
    container.querySelectorAll('[data-delete-link]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!window.confirm('Remove this inventory link?')) return;
        try {
          await api.delete('/inventory/links/' + btn.getAttribute('data-delete-link'));
          toast.success('Link removed');
          await renderInvLinksList(productId);
        } catch (e) { toast.error(e.message); }
      });
    });
  } catch { container.innerHTML = '<div style="text-align:center;padding:16px;color:#ef4444">Failed to load links</div>'; }
}

document.getElementById('saveInvLinkBtn').addEventListener('click', async () => {
  const productId = parseInt(document.getElementById('invLinkProductId').value);
  const targetId  = parseInt(document.getElementById('invLinkTargetSelect').value);
  const ratio     = parseFloat(document.getElementById('invLinkRatio').value);
  if (!targetId || isNaN(ratio) || ratio <= 0) {
    toast.error('Select a target product and enter a positive ratio'); return;
  }
  const btn = document.getElementById('saveInvLinkBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await api.post('/inventory/links', { source_product_id: productId, target_product_id: targetId, ratio });
    toast.success('Link added');
    document.getElementById('invLinkRatio').value = '';
    await renderInvLinksList(productId);
  } catch (e) { toast.error(e.message); }
  finally { btn.disabled = false; btn.textContent = 'Add Link'; }
});
document.getElementById('closeInvLinkModal').addEventListener('click',
  () => document.getElementById('invLinkModal').classList.add('hidden'));
document.getElementById('closeInvLinkModalBtn').addEventListener('click',
  () => document.getElementById('invLinkModal').classList.add('hidden'));

function populateAdjustSelect() {
  const sel = document.getElementById('adjustProductSelect');
  sel.innerHTML = inventoryProducts.map(p => `<option value="${p.id}">${p.name} (Stock: ${p.stock})</option>`).join('');
  updateAdjustInfo();
}

function updateAdjustInfo() {
  const id = parseInt(document.getElementById('adjustProductSelect').value);
  const p = inventoryProducts.find(x => x.id === id);
  if (p) document.getElementById('adjustCurrentStock').textContent = `Current stock: ${p.stock} ${p.unit}`;
}

function openAdjustModal(product = null) {
  populateAdjustSelect();
  if (product) document.getElementById('adjustProductSelect').value = product.id;
  updateAdjustInfo();
  document.getElementById('adjQty').value = '';
  document.getElementById('adjNotes').value = '';
  document.querySelector('input[name="adjType"][value="in"]').checked = true;
  document.getElementById('adjustModal').classList.remove('hidden');
}

document.getElementById('adjustStockBtn').addEventListener('click', () => openAdjustModal());
document.getElementById('closeAdjustModal').addEventListener('click', () => document.getElementById('adjustModal').classList.add('hidden'));
document.getElementById('cancelAdjustModal').addEventListener('click', () => document.getElementById('adjustModal').classList.add('hidden'));
document.getElementById('adjustProductSelect').addEventListener('change', updateAdjustInfo);

document.querySelectorAll('input[name="adjType"]').forEach(r => {
  r.addEventListener('change', () => {
    const type = document.querySelector('input[name="adjType"]:checked').value;
    document.getElementById('adjQtyLabel').textContent = type === 'set' ? 'Set Stock To' : 'Quantity';
  });
});

document.getElementById('saveAdjustBtn').addEventListener('click', async () => {
  const product_id = parseInt(document.getElementById('adjustProductSelect').value);
  const type = document.querySelector('input[name="adjType"]:checked').value;
  const quantity = parseInt(document.getElementById('adjQty').value);
  const notes = document.getElementById('adjNotes').value.trim();
  if (!product_id || !quantity || quantity <= 0) { toast.error('Select a product and enter a valid quantity'); return; }
  const btn = document.getElementById('saveAdjustBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await api.post('/inventory/adjust', { product_id, type, quantity, notes });
    toast.success(`Stock updated: ${res.previous_stock} → ${res.new_stock}`);
    document.getElementById('adjustModal').classList.add('hidden');
    const adjustedProduct = inventoryProducts.find(p => p.id === product_id);
    if (adjustedProduct && res.new_stock <= adjustedProduct.min_stock) {
      showLowStockPopup([{ ...adjustedProduct, stock: res.new_stock }]);
    }
    loadInventory();
  } catch (e) { toast.error(e.message); }
  finally { btn.disabled = false; btn.textContent = 'Save'; }
});

// ══════════════════════════════════════════════════════════════════════════════
// ORDERS
// ══════════════════════════════════════════════════════════════════════════════
let allOrders = [];

async function loadOrders(from, to) {
  try {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    allOrders = await api.get('/orders?' + params);
    renderOrdersTable();
  } catch (e) { toast.error('Failed to load orders'); }
}

function renderOrdersTable() {
  const search = document.getElementById('orderSearch').value.toLowerCase();
  const filtered = allOrders.filter(o =>
    !search || o.order_number.toLowerCase().includes(search) || (o.cashier_name || '').toLowerCase().includes(search)
  );
  const tbody = document.getElementById('ordersBody');
  if (!filtered.length) { tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#9ca3af;padding:24px">No orders found</td></tr>`; return; }
  tbody.innerHTML = filtered.map(o => `
    <tr>
      <td><strong style="font-size:12px">${o.order_number}</strong></td>
      <td class="text-sm">${fmtDateTime(o.created_at)}</td>
      <td>${o.cashier_name}</td>
      <td>—</td>
      <td>${fmt(o.subtotal)}</td>
      <td>${o.discount > 0 ? '-' + fmt(o.discount) : '—'}</td>
      <td style="font-weight:700">${fmt(o.total)}</td>
      <td><span class="badge badge-info">${o.payment_method.toUpperCase()}</span></td>
      <td>
        <div class="table-actions">
          <button class="btn btn-sm btn-outline" data-view-order="${o.id}">View</button>
          ${isAdmin ? `<button class="btn btn-sm btn-danger" data-delete-order="${o.id}" data-order-num="${o.order_number}" title="Delete & restore inventory">Delete</button>` : ''}
        </div>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-view-order]').forEach(btn => {
    btn.addEventListener('click', () => viewOrder(parseInt(btn.dataset.viewOrder)));
  });
  tbody.querySelectorAll('[data-delete-order]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!window.confirm(`Delete order "${btn.dataset.orderNum}"?\n\nThis will permanently remove the transaction and restore inventory stock.`)) return;
      try {
        await api.delete('/orders/' + btn.dataset.deleteOrder);
        toast.success(`Order ${btn.dataset.orderNum} deleted. Inventory restored.`);
        loadOrders();
      } catch (e) { toast.error(e.message); }
    });
  });
}

document.getElementById('orderSearch').addEventListener('input', renderOrdersTable);
document.getElementById('filterOrdersBtn').addEventListener('click', () => {
  loadOrders(document.getElementById('orderFrom').value, document.getElementById('orderTo').value);
});
document.getElementById('clearOrdersFilter').addEventListener('click', () => {
  document.getElementById('orderFrom').value = '';
  document.getElementById('orderTo').value = '';
  document.getElementById('orderSearch').value = '';
  loadOrders();
});

async function viewOrder(id) {
  try {
    const order = await api.get('/orders/' + id);
    document.getElementById('orderModalTitle').textContent = `Order ${order.order_number}`;
    document.getElementById('orderModalBody').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div><div class="form-label">Date/Time</div><div>${fmtDateTime(order.created_at)}</div></div>
        <div><div class="form-label">Cashier</div><div>${order.cashier_name}</div></div>
        <div><div class="form-label">Payment</div><div><span class="badge badge-info">${order.payment_method.toUpperCase()}</span></div></div>
        <div><div class="form-label">Amount Paid</div><div>${fmt(order.amount_paid)}</div></div>
      </div>
      <table class="table" style="margin-bottom:16px">
        <thead><tr><th>Product</th><th>Price</th><th>Qty</th><th>Total</th></tr></thead>
        <tbody>${(order.items || []).map(i => `
          <tr>
            <td>${i.product_name}</td>
            <td>${fmt(i.selling_price)}</td>
            <td>${i.quantity}</td>
            <td style="font-weight:600">${fmt(i.total)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div style="background:#f9fafb;padding:14px;border-radius:8px">
        <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:14px"><span>Subtotal</span><span>${fmt(order.subtotal)}</span></div>
        ${order.discount > 0 ? `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:14px"><span>Discount</span><span>-${fmt(order.discount)}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;padding:8px 0 0;font-size:18px;font-weight:700;border-top:1.5px solid #e5e7eb;margin-top:6px"><span>Total</span><span style="color:#4f46e5">${fmt(order.total)}</span></div>
        ${order.payment_method === 'cash' ? `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:13px;color:#6b7280"><span>Change</span><span>${fmt(order.change_amount)}</span></div>` : ''}
      </div>
      ${order.notes ? `<div style="margin-top:12px;font-size:13px;color:#6b7280">Note: ${order.notes}</div>` : ''}`;
    document.getElementById('orderModal').classList.remove('hidden');
    document.getElementById('printOrderBtn').onclick = () => {
      const win = window.open('', '_blank', 'width=420,height=600');
      win.document.write(`<html><head><title>Order ${order.order_number}</title><style>body{font-family:sans-serif;font-size:13px;padding:20px}table{width:100%;border-collapse:collapse}th,td{padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:left}th{background:#f9fafb;font-size:11px;text-transform:uppercase}.row{display:flex;justify-content:space-between;padding:3px 0}</style></head><body>${document.getElementById('orderModalBody').innerHTML}</body></html>`);
      win.print(); win.close();
    };
  } catch (e) { toast.error('Failed to load order details'); }
}

document.getElementById('closeOrderModal').addEventListener('click', () => document.getElementById('orderModal').classList.add('hidden'));
document.getElementById('closeOrderModalBtn').addEventListener('click', () => document.getElementById('orderModal').classList.add('hidden'));

// ══════════════════════════════════════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════════════════════════════════════
let lastReportData = null;

function getDateRange(preset) {
  const today = new Date();
  const fmt = d => d.toISOString().slice(0, 10);
  const start = new Date(today);
  if (preset === 'today') return { from: fmt(today), to: fmt(today) };
  if (preset === 'week') { start.setDate(today.getDate() - today.getDay()); return { from: fmt(start), to: fmt(today) }; }
  if (preset === 'month') { start.setDate(1); return { from: fmt(start), to: fmt(today) }; }
  if (preset === 'year') { start.setMonth(0, 1); return { from: fmt(start), to: fmt(today) }; }
  return { from: document.getElementById('reportFrom').value, to: document.getElementById('reportTo').value };
}

document.getElementById('reportPreset').addEventListener('change', e => {
  const isCustom = e.target.value === 'custom';
  document.getElementById('reportFrom').classList.toggle('hidden', !isCustom);
  document.getElementById('reportTo').classList.toggle('hidden', !isCustom);
});

document.getElementById('generateReportBtn').addEventListener('click', loadReport);

async function loadReport() {
  const preset = document.getElementById('reportPreset').value;
  const { from, to } = getDateRange(preset);
  if (!from || !to) { toast.error('Please select a date range'); return; }
  const btn = document.getElementById('generateReportBtn');
  btn.disabled = true; btn.textContent = 'Loading…';
  try {
    const data = await api.get(`/reports/summary?from=${from}&to=${to}`);
    lastReportData = { ...data, from, to };

    document.getElementById('rOrders').textContent = data.orders;
    document.getElementById('rRevenue').textContent = fmt(data.revenue);
    document.getElementById('rCost').textContent = fmt(data.total_cost);
    document.getElementById('rProfit').textContent = fmt(data.gross_profit);
    document.getElementById('rMargin').textContent = data.profit_margin + '%';

    // Daily chart
    const rctx = document.getElementById('reportChart').getContext('2d');
    if (reportChartInst) reportChartInst.destroy();
    reportChartInst = new Chart(rctx, {
      type: 'bar',
      data: {
        labels: data.daily_sales.map(d => new Date(d.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })),
        datasets: [
          { label: 'Revenue', data: data.daily_sales.map(d => d.revenue), backgroundColor: 'rgba(79,70,229,0.8)', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true, plugins: { legend: { display: false } },
        scales: { y: { ticks: { callback: v => '₱' + v.toLocaleString() } }, x: { grid: { display: false } } }
      }
    });

    // Category chart
    const cctx = document.getElementById('categoryChart').getContext('2d');
    if (categoryChartInst) categoryChartInst.destroy();
    const colors = ['#4f46e5','#10b981','#f59e0b','#ef4444','#3b82f6','#8b5cf6','#ec4899','#06b6d4'];
    categoryChartInst = new Chart(cctx, {
      type: 'doughnut',
      data: {
        labels: data.category_revenue.map(c => c.category),
        datasets: [{ data: data.category_revenue.map(c => c.revenue), backgroundColor: colors, borderWidth: 2 }]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } } }
    });

    // Top products table
    const tbody = document.getElementById('reportProductsBody');
    tbody.innerHTML = data.top_products.map((p, i) => {
      const profit = p.revenue - p.cost;
      const margin = p.revenue > 0 ? (profit / p.revenue * 100).toFixed(1) : 0;
      return `
        <tr>
          <td style="font-weight:700;color:#6b7280">${i + 1}</td>
          <td><strong>${p.product_name}</strong></td>
          <td>${p.qty}</td>
          <td>${fmt(p.revenue)}</td>
          <td>${fmt(p.cost)}</td>
          <td style="font-weight:600;color:#10b981">${fmt(profit)}</td>
          <td><span class="badge ${parseFloat(margin) > 20 ? 'badge-success' : 'badge-warning'}">${margin}%</span></td>
        </tr>`;
    }).join('');
    if (!data.top_products.length) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#9ca3af;padding:24px">No sales data for this period</td></tr>`;
  } catch (e) { toast.error('Failed to generate report: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = 'Generate'; }
}

document.getElementById('exportReportBtn').addEventListener('click', () => {
  if (!lastReportData) { toast.warning('Generate a report first'); return; }
  const rows = [
    ['Order Summary Report'],
    [`Period: ${lastReportData.from} to ${lastReportData.to}`],
    [],
    ['Total Orders', lastReportData.orders],
    ['Gross Revenue', lastReportData.revenue],
    ['Total Cost', lastReportData.total_cost],
    ['Gross Profit', lastReportData.gross_profit],
    ['Profit Margin', lastReportData.profit_margin + '%'],
    ['Total Discounts', lastReportData.discounts],
    [],
    ['Top Products'],
    ['Product', 'Qty Sold', 'Revenue', 'Cost', 'Profit', 'Margin'],
    ...lastReportData.top_products.map(p => [
      p.product_name, p.qty, p.revenue.toFixed(2), p.cost.toFixed(2),
      (p.revenue - p.cost).toFixed(2),
      p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue * 100).toFixed(1) + '%' : '0%'
    ]),
    [],
    ['Daily Sales'],
    ['Date', 'Orders', 'Revenue'],
    ...lastReportData.daily_sales.map(d => [d.date, d.orders, d.revenue.toFixed(2)])
  ];
  downloadCSV(`pos-report-${lastReportData.from}-${lastReportData.to}.csv`, rows);
  toast.success('Report exported');
});

// ══════════════════════════════════════════════════════════════════════════════
// USERS
// ══════════════════════════════════════════════════════════════════════════════
async function loadUsers() {
  try {
    const users = await api.get('/users');
    const tbody = document.getElementById('usersBody');
    tbody.innerHTML = users.map(u => `
      <tr>
        <td><strong>${u.full_name || '—'}</strong></td>
        <td class="text-muted">${u.username}</td>
        <td><span class="badge ${u.role === 'admin' ? 'badge-info' : u.role === 'account_manager' ? 'badge-warning' : 'badge-secondary'}">${u.role === 'account_manager' ? 'Account Manager' : u.role}</span></td>
        <td class="text-sm text-muted">${fmtDate(u.created_at)}</td>
        <td>
          <div class="table-actions">
            <button class="btn btn-sm btn-outline" data-edit-user='${JSON.stringify(u)}'>Edit</button>
            ${u.id !== user.id ? `<button class="btn btn-sm btn-danger" data-delete-user="${u.id}" data-username="${u.username}">Delete</button>` : '<span class="text-sm text-muted">(you)</span>'}
          </div>
        </td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-edit-user]').forEach(btn => {
      btn.addEventListener('click', () => {
        const u = JSON.parse(btn.dataset.editUser);
        openUserModal(u);
      });
    });
    tbody.querySelectorAll('[data-delete-user]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!window.confirm(`Delete user "${btn.dataset.username}"?`)) return;
        try { await api.delete('/users/' + btn.dataset.deleteUser); toast.success('User deleted'); loadUsers(); } catch (e) { toast.error(e.message); }
      });
    });
  } catch (e) { toast.error('Failed to load users'); }
}

function openUserModal(u = null) {
  document.getElementById('userModalTitle').textContent = u ? 'Edit User' : 'Add User';
  document.getElementById('userId').value = u?.id || '';
  document.getElementById('uFullName').value = u?.full_name || '';
  document.getElementById('uUsername').value = u?.username || '';
  document.getElementById('uPassword').value = '';
  document.getElementById('uRole').value = u?.role || 'cashier';
  document.getElementById('uUsername').disabled = !!u;
  document.getElementById('uPasswordLabel').textContent = u ? 'New Password (leave blank to keep)' : 'Password *';
  document.getElementById('uPasswordHint').textContent = u ? 'Leave blank to keep current password' : '';
  document.getElementById('userModal').classList.remove('hidden');
}

document.getElementById('addUserBtn').addEventListener('click', () => openUserModal());
document.getElementById('closeUserModal').addEventListener('click', () => document.getElementById('userModal').classList.add('hidden'));
document.getElementById('cancelUserModal').addEventListener('click', () => document.getElementById('userModal').classList.add('hidden'));

document.getElementById('saveUserBtn').addEventListener('click', async () => {
  const id = document.getElementById('userId').value;
  const body = {
    username: document.getElementById('uUsername').value.trim(),
    full_name: document.getElementById('uFullName').value.trim(),
    role: document.getElementById('uRole').value,
    password: document.getElementById('uPassword').value
  };
  if (!id && (!body.username || !body.password)) { toast.error('Username and password are required'); return; }
  if (body.password && body.password.length < 6) { toast.error('Password must be at least 6 characters'); return; }
  const btn = document.getElementById('saveUserBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    if (id) { await api.put('/users/' + id, body); toast.success('User updated'); }
    else { await api.post('/users', body); toast.success('User created'); }
    document.getElementById('userModal').classList.add('hidden');
    loadUsers();
  } catch (e) { toast.error(e.message); }
  finally { btn.disabled = false; btn.textContent = 'Save User'; }
});

// ══════════════════════════════════════════════════════════════════════════════
// CATEGORIES
// ══════════════════════════════════════════════════════════════════════════════
async function loadCategories() {
  try {
    allCategories = await api.get('/categories');
    renderCategoriesTable();
  } catch (e) { toast.error('Failed to load categories'); }
}

function renderCategoriesTable() {
  const tbody = document.getElementById('categoriesBody');
  if (!allCategories.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#9ca3af;padding:24px">No categories found</td></tr>`;
    return;
  }
  tbody.innerHTML = allCategories.map(c => `
    <tr>
      <td><strong>${c.name}</strong></td>
      <td class="text-muted">${c.product_count} product${c.product_count !== 1 ? 's' : ''}</td>
      <td class="text-sm text-muted">${fmtDate(c.created_at)}</td>
      <td>
        <div class="table-actions">
          <button class="btn btn-sm btn-outline" data-rename-cat="${c.id}" data-cat-name="${c.name}">Rename</button>
          <button class="btn btn-sm btn-danger" data-delete-cat="${c.id}" data-cat-name="${c.name}">Delete</button>
        </div>
      </td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-rename-cat]').forEach(btn => {
    btn.addEventListener('click', () => openCategoryModal({ id: parseInt(btn.dataset.renameCat), name: btn.dataset.catName }));
  });
  tbody.querySelectorAll('[data-delete-cat]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.catName;
      const cat = allCategories.find(c => c.id === parseInt(btn.dataset.deleteCat));
      const count = cat?.product_count || 0;
      if (!window.confirm(`Delete category "${name}"?${count > 0 ? `\n\n${count} product(s) will be moved to "General".` : ''}`)) return;
      try {
        await api.delete('/categories/' + btn.dataset.deleteCat);
        toast.success(`Category "${name}" deleted`);
        loadCategories();
        allProducts = await api.get('/products');
        updateCategoryFilters();
      } catch (e) { toast.error(e.message); }
    });
  });
}

async function loadCategoryArchive() {
  try {
    const archive = await api.get('/category-archive');
    const tbody = document.getElementById('categoryArchiveBody');
    if (!archive.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:24px">No archive entries yet</td></tr>`;
      return;
    }
    const actionBadge = { deleted: '<span class="badge badge-danger">Deleted</span>', renamed: '<span class="badge badge-warning">Renamed</span>' };
    tbody.innerHTML = archive.map(a => `
      <tr>
        <td><strong>${a.category_name}</strong></td>
        <td>${actionBadge[a.action] || a.action}</td>
        <td class="text-muted">${a.old_name || '—'}</td>
        <td>${a.changed_by_name}</td>
        <td class="text-sm text-muted">${fmtDateTime(a.changed_at)}</td>
      </tr>`).join('');
  } catch (e) { toast.error('Failed to load category archive'); }
}

function openCategoryModal(cat = null) {
  document.getElementById('categoryModalTitle').textContent = cat ? 'Rename Category' : 'Add Category';
  document.getElementById('categoryId').value = cat?.id || '';
  document.getElementById('categoryName').value = cat?.name || '';
  document.getElementById('categoryModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('categoryName').focus(), 50);
}

document.getElementById('addCategoryBtn').addEventListener('click', () => openCategoryModal());
document.getElementById('closeCategoryModal').addEventListener('click', () => document.getElementById('categoryModal').classList.add('hidden'));
document.getElementById('cancelCategoryModal').addEventListener('click', () => document.getElementById('categoryModal').classList.add('hidden'));

document.getElementById('saveCategoryBtn').addEventListener('click', async () => {
  const id = document.getElementById('categoryId').value;
  const name = document.getElementById('categoryName').value.trim();
  if (!name) { toast.error('Category name is required'); return; }
  const btn = document.getElementById('saveCategoryBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    if (id) { await api.put('/categories/' + id, { name }); toast.success('Category renamed'); }
    else { await api.post('/categories', { name }); toast.success('Category added'); }
    document.getElementById('categoryModal').classList.add('hidden');
    loadCategories();
  } catch (e) { toast.error(e.message); }
  finally { btn.disabled = false; btn.textContent = 'Save'; }
});

// ══════════════════════════════════════════════════════════════════════════════
// PRODUCT HISTORY
// ══════════════════════════════════════════════════════════════════════════════
async function loadProductHistory() {
  try {
    const history = await api.get('/product-history');
    const tbody = document.getElementById('productHistoryBody');
    if (!history.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#9ca3af;padding:24px">No product change history yet</td></tr>`;
      return;
    }
    const actionBadge = {
      created: '<span class="badge badge-success">Created</span>',
      updated: '<span class="badge badge-warning">Updated</span>',
      deleted: '<span class="badge badge-danger">Deleted</span>'
    };
    tbody.innerHTML = history.map(h => `
      <tr>
        <td class="text-sm">${fmtDateTime(h.changed_at)}</td>
        <td>${actionBadge[h.action] || h.action}</td>
        <td><strong>${h.product_name}</strong>${h.sku ? `<br><span class="text-sm text-muted">${h.sku}</span>` : ''}</td>
        <td>${h.category || '—'}</td>
        <td>${fmt(h.cost_price)}</td>
        <td style="font-weight:600">${fmt(h.selling_price)}</td>
        <td>${h.changed_by_name}</td>
      </tr>`).join('');
  } catch (e) { toast.error('Failed to load product history'); }
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────
loadDashboard();

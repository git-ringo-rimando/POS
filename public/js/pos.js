// ── Init ───────────────────────────────────────────────────────────────────────
const user = getUser();
if (!requireAuth()) throw new Error('stop');

let appSettings = { business_name: 'Aling Inday Kamuning Branch POS', logo: null };
loadAppSettings().then(s => {
  appSettings = s;
  const name = s.business_name || 'POS Terminal';
  document.title = name;
  document.getElementById('posHeaderName').textContent = name;
  applyLogoToEl(document.getElementById('posHeaderLogo'), s, 'height:28px;width:auto');
});

document.getElementById('cashierName').textContent = user.full_name || user.username;
const adminLink = document.getElementById('adminLink');
adminLink.classList.remove('hidden');
if (!['admin', 'account_manager'].includes(user.role)) adminLink.textContent = '📅 Daily Summary';
document.getElementById('logoutBtn').addEventListener('click', () => { clearSession(); window.location.href = '/'; });

// Live clock
function updateTime() {
  document.getElementById('posTime').textContent = new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
updateTime();
setInterval(updateTime, 1000);

// ── State ──────────────────────────────────────────────────────────────────────
let products = [];
let cart = [];
let currentCategory = 'all';
let paymentMethod = 'cash';

// ── Products ───────────────────────────────────────────────────────────────────
async function loadProducts() {
  try {
    products = await api.get('/products');
    buildCategoryTabs();
    renderProducts();
    populateStockSelect();
  } catch (e) {
    toast.error('Failed to load products: ' + e.message);
  }
}

function buildCategoryTabs() {
  const cats = ['all', ...new Set(products.map(p => p.category || 'General'))].filter(Boolean);
  const tabsEl = document.getElementById('categoryTabs');
  tabsEl.innerHTML = cats.map(c =>
    `<button class="cat-tab${c === currentCategory ? ' active' : ''}" data-cat="${c}">${c === 'all' ? 'All' : c}</button>`
  ).join('');
  tabsEl.querySelectorAll('.cat-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentCategory = btn.dataset.cat;
      tabsEl.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderProducts();
    });
  });
}

function renderProducts() {
  const search = document.getElementById('productSearch').value.toLowerCase().trim();
  const filtered = products.filter(p => {
    const matchCat = currentCategory === 'all' || p.category === currentCategory;
    const matchSearch = !search || p.name.toLowerCase().includes(search) || (p.sku || '').toLowerCase().includes(search);
    return matchCat && matchSearch;
  });
  const grid = document.getElementById('productsGrid');
  if (filtered.length === 0) {
    grid.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:160px;grid-column:1/-1;color:#9ca3af;font-size:14px">No products found</div>`;
    return;
  }
  grid.innerHTML = filtered.map(p => {
    const outOfStock = p.stock === 0;
    const lowStock = p.stock > 0 && p.stock <= p.min_stock;
    const stockLabel = outOfStock
      ? `<div class="p-oos">Out of Stock</div>`
      : lowStock
        ? `<div class="p-stock low">⚠ ${p.stock} ${p.unit} left</div>`
        : `<div class="p-stock">${p.stock} ${p.unit}</div>`;
    return `
      <div class="product-card${outOfStock ? ' out-of-stock' : ''}" data-id="${p.id}" title="${p.name}">
        <div class="p-cat">${p.category || 'General'}</div>
        <div class="p-name">${p.name}</div>
        <div class="p-price">${fmt(p.selling_price)}</div>
        ${stockLabel}
      </div>`;
  }).join('');
  grid.querySelectorAll('.product-card:not(.out-of-stock)').forEach(card => {
    card.addEventListener('click', () => addToCart(parseInt(card.dataset.id)));
  });
}

document.getElementById('productSearch').addEventListener('input', renderProducts);
document.getElementById('refreshBtn').addEventListener('click', loadProducts);

// ── Cart ───────────────────────────────────────────────────────────────────────
function addToCart(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;
  const existing = cart.find(i => i.product_id === productId);
  if (existing) {
    if (existing.quantity >= product.stock) {
      toast.warning(`Only ${product.stock} ${product.unit} available`);
      return;
    }
    existing.quantity++;
  } else {
    cart.push({ product_id: productId, quantity: 1, product });
  }
  renderCart();
}

function removeFromCart(productId) {
  cart = cart.filter(i => i.product_id !== productId);
  renderCart();
}

function updateQty(productId, delta) {
  const item = cart.find(i => i.product_id === productId);
  if (!item) return;
  const product = products.find(p => p.id === productId);
  if (!product) { removeFromCart(productId); return; }
  const newQty = item.quantity + delta;
  if (newQty <= 0) { removeFromCart(productId); return; }
  if (newQty > product.stock) { toast.warning(`Only ${product.stock} ${product.unit} available`); return; }
  item.quantity = newQty;
  renderCart();
}

function getDiscount() { return parseFloat(document.getElementById('discountInput').value) || 0; }
function getSubtotal() { return cart.reduce((sum, i) => sum + i.product.selling_price * i.quantity, 0); }
function getTotal() { return Math.max(0, getSubtotal() - getDiscount()); }

function renderCart() {
  const cartItemsEl = document.getElementById('cartItems');
  const count = cart.reduce((s, i) => s + i.quantity, 0);
  document.getElementById('cartCount').textContent = count;

  if (cart.length === 0) {
    cartItemsEl.innerHTML = `
      <div class="cart-empty">
        <div class="cart-empty-icon">🛒</div>
        <div>Cart is empty</div>
        <div class="text-sm">Click a product to add</div>
      </div>`;
    document.getElementById('checkoutBtn').disabled = true;
  } else {
    cartItemsEl.innerHTML = cart.map(item => `
      <div class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-name">${item.product.name}</div>
          <div class="cart-item-price">${fmt(item.product.selling_price)} each</div>
          <div class="cart-item-controls">
            <button class="qty-btn" data-id="${item.product_id}" data-delta="-1">−</button>
            <span class="cart-item-qty">${item.quantity}</span>
            <button class="qty-btn" data-id="${item.product_id}" data-delta="1">+</button>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <div class="cart-item-total">${fmt(item.product.selling_price * item.quantity)}</div>
          <button class="cart-item-remove" data-id="${item.product_id}">✕</button>
        </div>
      </div>`).join('');

    cartItemsEl.querySelectorAll('.qty-btn').forEach(btn => {
      btn.addEventListener('click', () => updateQty(parseInt(btn.dataset.id), parseInt(btn.dataset.delta)));
    });
    cartItemsEl.querySelectorAll('.cart-item-remove').forEach(btn => {
      btn.addEventListener('click', () => removeFromCart(parseInt(btn.dataset.id)));
    });
    document.getElementById('checkoutBtn').disabled = false;
  }
  updateTotals();
}

function updateTotals() {
  const sub = getSubtotal();
  const disc = getDiscount();
  const total = getTotal();
  document.getElementById('subtotalDisplay').textContent = fmt(sub);
  document.getElementById('discountDisplay').textContent = '-' + fmt(disc);
  document.getElementById('totalDisplay').textContent = fmt(total);
}

document.getElementById('discountInput').addEventListener('input', updateTotals);
document.getElementById('clearCartBtn').addEventListener('click', () => {
  if (cart.length === 0) return;
  confirm('Clear all items from the cart?', () => { cart = []; renderCart(); });
});

// ── Checkout ───────────────────────────────────────────────────────────────────
document.getElementById('checkoutBtn').addEventListener('click', openPayment);
document.getElementById('closePayment').addEventListener('click', closePayment);
document.getElementById('cancelPayment').addEventListener('click', closePayment);

function openPayment() {
  const total = getTotal();
  document.getElementById('paymentSummary').innerHTML = `
    <div class="payment-row"><span>Items (${cart.reduce((s,i)=>s+i.quantity,0)})</span><span>${fmt(getSubtotal())}</span></div>
    <div class="payment-row"><span>Discount</span><span>-${fmt(getDiscount())}</span></div>
    <div class="payment-row total"><span>TOTAL</span><span>${fmt(total)}</span></div>`;
  document.getElementById('amountPaid').value = total.toFixed(2);
  document.getElementById('changeDisplay').classList.add('hidden');
  document.getElementById('paymentModal').classList.remove('hidden');
  document.getElementById('amountPaid').focus();
  document.getElementById('amountPaid').select();
}

function closePayment() {
  document.getElementById('paymentModal').classList.add('hidden');
}

document.querySelectorAll('.payment-method-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.payment-method-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    paymentMethod = btn.dataset.method;
    document.getElementById('cashSection').style.display = paymentMethod === 'cash' ? '' : 'none';
  });
});

document.getElementById('amountPaid').addEventListener('input', () => {
  const paid = parseFloat(document.getElementById('amountPaid').value) || 0;
  const total = getTotal();
  const change = paid - total;
  const changeEl = document.getElementById('changeDisplay');
  if (paid > 0) {
    changeEl.classList.remove('hidden');
    document.getElementById('changeAmount').textContent = fmt(Math.max(0, change));
    changeEl.style.background = change < 0 ? '#fee2e2' : '#d1fae5';
    changeEl.querySelector('.change-label').style.color = change < 0 ? '#991b1b' : '#065f46';
    changeEl.querySelector('.change-amount').style.color = change < 0 ? '#991b1b' : '#065f46';
    changeEl.querySelector('.change-label').textContent = change < 0 ? 'AMOUNT SHORT' : 'CHANGE';
  } else {
    changeEl.classList.add('hidden');
  }
});

document.getElementById('processPayment').addEventListener('click', async () => {
  const total = getTotal();
  const paid = parseFloat(document.getElementById('amountPaid').value) || 0;
  if (paymentMethod === 'cash' && paid < total) {
    toast.error('Amount received is less than total');
    return;
  }
  const btn = document.getElementById('processPayment');
  btn.disabled = true; btn.textContent = 'Processing…';
  try {
    const result = await api.post('/orders', {
      items: cart.map(i => ({ product_id: i.product_id, quantity: i.quantity })),
      discount: getDiscount(),
      payment_method: paymentMethod,
      amount_paid: paymentMethod === 'cash' ? paid : total,
      notes: document.getElementById('orderNotes').value.trim() || null
    });
    closePayment();
    showReceipt(result, paid);
    await loadProducts();
  } catch (e) {
    toast.error(e.message);
  } finally {
    btn.disabled = false; btn.textContent = '✓ Complete Sale';
  }
});

// ── Receipt ────────────────────────────────────────────────────────────────────
function showReceipt(order, amountPaid) {
  const now = new Date().toLocaleString('en-PH');
  const rows = cart.map(i => `
    <div class="receipt-item">
      <span class="receipt-item-name">${i.product.name}</span>
      <span class="receipt-item-qty">x${i.quantity}</span>
      <span class="receipt-item-total">${fmt(i.product.selling_price * i.quantity)}</span>
    </div>`).join('');

  document.getElementById('receiptBody').innerHTML = `
    <div class="receipt">
      <div class="receipt-header">
        <h3>${appSettings.logo ? `<img src="${appSettings.logo}" alt="${appSettings.business_name}" style="max-height:48px;display:block;margin:0 auto 4px" />` : '🛒'} ${appSettings.business_name || 'POS System'}</h3>
        <div style="font-size:12px;color:#6b7280">${now}</div>
        <div style="font-size:12px;color:#6b7280">Order: ${order.order_number}</div>
        <div style="font-size:12px;color:#6b7280">Cashier: ${user.full_name}</div>
      </div>
      <hr class="receipt-divider" />
      <div style="display:flex;font-weight:700;font-size:11px;color:#6b7280;padding:0 0 6px">
        <span style="flex:1">ITEM</span><span style="width:40px;text-align:center">QTY</span><span style="width:80px;text-align:right">TOTAL</span>
      </div>
      ${rows}
      <hr class="receipt-divider" />
      <div class="receipt-item"><span class="receipt-item-name">Subtotal</span><span class="receipt-item-total" style="width:auto">${fmt(order.subtotal)}</span></div>
      ${order.discount > 0 ? `<div class="receipt-item"><span class="receipt-item-name">Discount</span><span class="receipt-item-total" style="width:auto">-${fmt(order.discount)}</span></div>` : ''}
      <div class="receipt-item" style="font-weight:700;font-size:16px;padding-top:6px"><span class="receipt-item-name">TOTAL</span><span class="receipt-item-total" style="width:auto">${fmt(order.total)}</span></div>
      ${order.payment_method === 'cash' ? `
        <div class="receipt-item" style="margin-top:4px"><span class="receipt-item-name">Cash</span><span class="receipt-item-total" style="width:auto">${fmt(amountPaid)}</span></div>
        <div class="receipt-item"><span class="receipt-item-name">Change</span><span class="receipt-item-total" style="width:auto">${fmt(order.change)}</span></div>
      ` : `<div class="receipt-item"><span>Payment</span><span>${order.payment_method.toUpperCase()}</span></div>`}
      <div class="receipt-footer">
        <p>Thank you for your purchase!</p>
        <p style="margin-top:4px">Please come again</p>
      </div>
    </div>`;
  document.getElementById('receiptModal').classList.remove('hidden');
}

function resetAfterSale() {
  document.getElementById('receiptModal').classList.add('hidden');
  cart = [];
  document.getElementById('discountInput').value = '';
  renderCart();
}
document.getElementById('closeReceipt').addEventListener('click', resetAfterSale);
document.getElementById('newOrderBtn').addEventListener('click', resetAfterSale);
document.getElementById('printReceiptBtn').addEventListener('click', () => {
  const content = document.getElementById('receiptBody').innerHTML;
  const win = window.open('', '_blank', 'width=400,height=600');
  win.document.write(`<html><head><title>Receipt</title><style>body{font-family:'Courier New',monospace;font-size:13px;padding:20px;max-width:320px;margin:0 auto}.receipt-item{display:flex;justify-content:space-between;padding:3px 0}.receipt-divider{border:none;border-top:1.5px dashed #ccc;margin:10px 0}.receipt-header{text-align:center;margin-bottom:12px}.receipt-footer{text-align:center;margin-top:12px;color:#6b7280;font-size:12px}</style></head><body>${content}</body></html>`);
  win.print();
  win.close();
});

// ── Stock In Modal ─────────────────────────────────────────────────────────────
function populateStockSelect() {
  const sel = document.getElementById('stockProduct');
  sel.innerHTML = products.map(p => `<option value="${p.id}">${p.name} (Stock: ${p.stock})</option>`).join('');
}

document.getElementById('stockBtn').addEventListener('click', () => {
  document.getElementById('stockQty').value = '';
  document.getElementById('stockNotes').value = '';
  populateStockSelect();
  document.getElementById('stockModal').classList.remove('hidden');
});
document.getElementById('closeStock').addEventListener('click', () => document.getElementById('stockModal').classList.add('hidden'));
document.getElementById('cancelStock').addEventListener('click', () => document.getElementById('stockModal').classList.add('hidden'));
document.getElementById('confirmStock').addEventListener('click', async () => {
  const productId = parseInt(document.getElementById('stockProduct').value);
  const qty = parseInt(document.getElementById('stockQty').value);
  const notes = document.getElementById('stockNotes').value.trim();
  if (!productId || !qty || qty <= 0) { toast.error('Please select a product and enter a valid quantity'); return; }
  const btn = document.getElementById('confirmStock');
  btn.disabled = true; btn.textContent = 'Adding…';
  try {
    const res = await api.post('/inventory/adjust', { product_id: productId, type: 'in', quantity: qty, notes });
    toast.success(`Stock updated! New stock: ${res.new_stock}`);
    document.getElementById('stockModal').classList.add('hidden');
    await loadProducts();
  } catch (e) {
    toast.error(e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Add Stock';
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────
loadProducts();

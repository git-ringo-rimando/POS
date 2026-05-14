// ── API helpers ────────────────────────────────────────────────────────────────
const API_BASE = '/api';

function getToken() { return localStorage.getItem('pos_token'); }
function getUser() {
  try { return JSON.parse(localStorage.getItem('pos_user') || 'null'); } catch { return null; }
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const res = await fetch(API_BASE + path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({ error: 'Server error' }));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
  return data;
}

const api = {
  get: (path) => apiFetch(path),
  post: (path, body) => apiFetch(path, { method: 'POST', body }),
  put: (path, body) => apiFetch(path, { method: 'PUT', body }),
  delete: (path) => apiFetch(path, { method: 'DELETE' })
};

// ── Auth ───────────────────────────────────────────────────────────────────────
function saveSession(token, user) {
  localStorage.setItem('pos_token', token);
  localStorage.setItem('pos_user', JSON.stringify(user));
}
function clearSession() {
  localStorage.removeItem('pos_token');
  localStorage.removeItem('pos_user');
}
function requireAuth(role) {
  const user = getUser();
  if (!user || !getToken()) { window.location.href = '/login.html'; return false; }
  if (role && user.role !== role) { window.location.href = user.role === 'admin' ? '/sales/pos/admin.html' : '/pos.html'; return false; }
  return true;
}

// ── Toast ───────────────────────────────────────────────────────────────────────
function initToasts() {
  if (!document.getElementById('toast-container')) {
    const el = document.createElement('div');
    el.id = 'toast-container';
    el.className = 'toast-container';
    document.body.appendChild(el);
  }
}
function showToast(message, type = 'info', duration = 3000) {
  initToasts();
  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span style="font-size:16px;font-weight:700">${icons[type] || '•'}</span><span>${message}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); }, duration);
}
const toast = {
  success: (m, d) => showToast(m, 'success', d),
  error: (m, d) => showToast(m, 'error', d),
  warning: (m, d) => showToast(m, 'warning', d),
  info: (m, d) => showToast(m, 'info', d)
};

// ── Modal ───────────────────────────────────────────────────────────────────────
function createModal({ title, body, size = 'md', onClose } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-${size}">
      <div class="modal-header">
        <h3 class="modal-title">${title || ''}</h3>
        <button class="btn-close" id="modalClose">✕</button>
      </div>
      <div class="modal-body" id="modalBody">${body || ''}</div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); onClose?.(); };
  overlay.querySelector('#modalClose').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  return { overlay, close };
}

function confirm(message, onConfirm) {
  const { overlay, close } = createModal({
    title: 'Confirm Action',
    size: 'sm',
    body: `
      <p style="color:#374151;margin-bottom:20px">${message}</p>
      <div class="flex justify-end gap-2">
        <button class="btn btn-secondary" id="confirmCancel">Cancel</button>
        <button class="btn btn-danger" id="confirmOk">Confirm</button>
      </div>`
  });
  overlay.querySelector('#confirmCancel').addEventListener('click', close);
  overlay.querySelector('#confirmOk').addEventListener('click', () => { close(); onConfirm(); });
}

// ── Formatting ─────────────────────────────────────────────────────────────────
function fmt(n) { return '₱' + parseFloat(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtDate(dt) { return new Date(dt).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }); }
function fmtDateTime(dt) { return new Date(dt).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function fmtNum(n) { return parseFloat(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// ── Stock badge ─────────────────────────────────────────────────────────────────
function stockBadge(stock, minStock) {
  if (stock === 0) return '<span class="badge badge-danger">Out of Stock</span>';
  if (stock <= minStock) return `<span class="badge badge-warning">Low: ${stock}</span>`;
  return `<span class="badge badge-success">${stock}</span>`;
}

// ── App settings / branding ────────────────────────────────────────────────────
async function loadAppSettings() {
  try { return await api.get('/settings'); }
  catch { return { business_name: 'Aling Inday Kamuning Branch POS', logo: null }; }
}

function applyLogoToEl(el, settings, style = '') {
  if (!el) return;
  if (settings.logo) {
    el.innerHTML = `<img src="${settings.logo}" alt="${settings.business_name || ''}" style="max-height:100%;max-width:100%;object-fit:contain;${style}" />`;
  } else {
    el.textContent = '🛒';
  }
}

// ── CSV export ─────────────────────────────────────────────────────────────────
function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

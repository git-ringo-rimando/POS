const CACHE_VERSION = 'pwa-v3';
const STATIC_ASSETS = [
  '/AIR.html',
  '/orderform.html',
  '/index.html',
  '/css/style.css',
  '/js/common.js',
  '/manifest.json'
];

const STAFF_PAGES = [
  '/sales/pos/pos.html',
  '/sales/pos/admin.html',
  '/index.html',
  '/login.html',
  '/AIR-admin.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never intercept API calls or cross-origin requests
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Never intercept staff-only pages
  if (STAFF_PAGES.includes(url.pathname)) return;

  // Cache-first for known static assets
  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
          return response;
        }).catch(() => offlineFallback());
      })
    );
    return;
  }

  // Network-first for everything else in scope, offline fallback
  event.respondWith(
    fetch(event.request).catch(() => offlineFallback())
  );
});

function offlineFallback() {
  return caches.match('/AIR.html').then(cached => {
    if (cached) return cached;
    return new Response(
      `<!DOCTYPE html><html><head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Offline — Loyalty Rewards</title>
        <style>
          *{box-sizing:border-box;margin:0;padding:0}
          body{font-family:system-ui,-apple-system,sans-serif;min-height:100vh;
               display:flex;align-items:center;justify-content:center;
               background:linear-gradient(135deg,#1e1b4b 0%,#4f46e5 50%,#7c3aed 100%);
               color:#fff;text-align:center;padding:24px}
          .box{max-width:320px}
          .icon{font-size:64px;margin-bottom:20px}
          h1{font-size:22px;font-weight:700;margin-bottom:8px}
          p{font-size:14px;opacity:.8;margin-bottom:28px;line-height:1.5}
          button{background:#fff;color:#4f46e5;border:none;padding:13px 32px;
                 border-radius:10px;font-weight:700;font-size:15px;cursor:pointer}
          button:active{opacity:.85}
        </style>
      </head>
      <body><div class="box">
        <div class="icon">📶</div>
        <h1>You're Offline</h1>
        <p>Connect to the internet to access Loyalty Rewards.</p>
        <button onclick="location.reload()">Try Again</button>
      </div></body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  });
}

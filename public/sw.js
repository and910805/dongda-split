// Only the public offline message is stored. Account pages and API responses stay network-only.
const OFFLINE_CACHE = 'triptab-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE)
      .then(cache => cache.add(OFFLINE_URL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('triptab-offline-') && key !== OFFLINE_CACHE)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin ||
      url.pathname === '/api' || url.pathname.startsWith('/api/') ||
      url.pathname === '/invite' || url.pathname.startsWith('/invite/')) return;

  event.respondWith(
    fetch(request).catch(async () => {
      const offlinePage = await (await caches.open(OFFLINE_CACHE)).match(OFFLINE_URL);
      return offlinePage || Response.error();
    })
  );
});

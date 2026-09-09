const CACHE = 'coprolink-shell-v2';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // Les appels d'API ne passent jamais par le service worker : ils portent des
  // données authentifiées, et un repli sur le shell renverrait du HTML là où le
  // client attend du JSON.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;

  // Le repli hors ligne ne concerne que la navigation : le shell est servi, puis
  // l'application affiche son propre écran d'erreur si l'API reste injoignable.
  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') return caches.match('/index.html');
      return Response.error();
    }),
  );
});

// Solo archivos públicos de la interfaz. Nunca cuentas, API, imágenes o callbacks OAuth.
const CACHE = 'lector-shell-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('lector-shell-') && name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url), base = new URL('./', self.location.href);
  const versionedAsset=/\.(js|css)$/.test(url.pathname)&&[...url.searchParams.keys()].length===1&&/^[a-f0-9]{12}$/.test(url.searchParams.get('v')??'');
  if (event.request.method !== 'GET' || url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.pathname.includes('/api/') || (url.search&&!versionedAsset) || url.pathname.endsWith('/sw.js')) return;
  const asset = event.request.mode === 'navigate' || /\.(js|css|png|webmanifest)$/.test(url.pathname);
  if (!asset) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try { const response = await fetch(event.request); if (response.ok && response.type !== 'opaque') await cache.put(event.request, response.clone()); return response; }
    catch { const response = await cache.match(event.request); return response ?? Response.error(); }
  })());
});

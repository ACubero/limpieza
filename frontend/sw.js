/* Limpieza PWA — Service Worker
 *
 * Actualización automática de assets:
 *   - sw.js NUNCA se cachea (forzado por nginx con Cache-Control: no-store).
 *   - Cuando publico cambios, solo cambio `VERSION` aquí. Eso es TODO lo que
 *     tengo que tocar yo.
 *   - index.html: network-first → siempre fresco.
 *   - JS/CSS/imgs: cache-first, pero al instalar/reactivar se pre-cachean con
 *     ?v=VERSION. Eso BURLA la caché HTTP del navegador (que sí cachea 1 año)
 *     porque el query string cambia la clave de caché. Resultado: tras un
 *     cambio de VERSION, la siguiente visita trae los assets nuevos sin que
 *     el usuario borre nada.
 *   - localStorage NO se toca (el SW ni lo lee ni lo escribe).
 */

const VERSION = 'v1.1.8';
const CACHE = `limpieza-${VERSION}`;

/** Rutas de assets (relativas al scope del SW). */
const ASSET_PATHS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'js/app.js',
  'js/ui.js',
  'js/icons.js',
  'js/store.js',
  'js/autoassign.js',
  'js/export.js',
  'js/views/plannings.js',
  'js/views/tasks.js',
  'js/views/volunteers.js',
  'js/views/settings.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
];

const HTML_PATH = './index.html';

/** Build a cache-busted URL so the browser bypasses its long-lived HTTP cache. */
function bust(url) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${VERSION}`;
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      // Pre-cache with ?v=VERSION query so we fetch fresh from the server
      // (the HTTP layer would otherwise serve a 1-year-cached file).
      Promise.all(
        ASSET_PATHS.map(p =>
          fetch(bust(p), { cache: 'reload' })
            .then(res => { if (res.ok) return c.put(p, res.clone()); })
            .catch(() => {})
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Only handle same-origin GETs
  if (url.origin !== location.origin) return;

  // NEVER cache authenticated API responses — they depend on the user's
  // token and would otherwise serve stale 401s after a token rotation,
  // causing the frontend to "log itself out" on every page load.
  // Let these go straight to the network (the browser's normal HTTP cache
  // handles the rest, and the server sets no cache headers).
  if (url.pathname.startsWith('/api/')) return;

  // Derive the asset key (path without query/fragment, relative to scope)
  const key = url.pathname.replace(self.registration.scope.replace(location.origin, ''), './');

  // index.html / root: network-first so deploys land immediately.
  if (key === HTML_PATH || key === './' || key.endsWith('/index.html')) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(HTML_PATH, copy));
        }
        return res;
      }).catch(() => caches.match(HTML_PATH))
    );
    return;
  }

  // Static asset: cache-first. On miss, fetch fresh from server and cache.
  e.respondWith(
    caches.match(key).then(cached => {
      if (cached) return cached;
      return fetch(bust(key), { cache: 'no-cache' })
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(key, copy));
          }
          return res;
        })
        .catch(() => caches.match(HTML_PATH));
    })
  );
});

/* Chips Poker service worker.
 *
 * The game is real-time and server-authoritative, so nothing gameplay-related
 * is ever served from cache: /api, /socket.io and /uploads always go to the
 * network. The worker only makes the app shell installable and fast to reopen:
 *   - hashed build assets (/assets/*) and icons: cache-first (they are immutable);
 *   - page navigations: always network; when offline, /offline.html explains
 *     that the game needs a connection (a cached shell would only show errors).
 * Bump CACHE_VERSION to drop every old cache on the next activation.
 */
const CACHE_VERSION = 'v1';
const SHELL_CACHE = `chips-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `chips-assets-${CACHE_VERSION}`;
const PRECACHE = ['/offline.html', '/icons/icon.svg', '/icons/icon-192.png', '/manifest.webmanifest'];
const NETWORK_ONLY = ['/api/', '/socket.io/', '/uploads/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('chips-') && key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NETWORK_ONLY.some((prefix) => url.pathname.startsWith(prefix))) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request));
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirstShell(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match("/offline.html")) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

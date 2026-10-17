// Keeps Fizzdoc working with the internet off. The build writes this file to /sw.js with ASSETS filled in.
// - Pages: from the network when online, so they are always fresh; from the cache when offline.
// - theme.js and the hashed files under /assets/ (the code of every tool): kept on the device when this worker installs.
// - The speech and background models are never stored here; their tools keep them in their own caches.
const ASSETS = [/* ASSETS */];
const SHELL = 'fizzdoc-shell';
const PAGES = 'fizzdoc-pages';
// Responses vary only by Accept-Encoding/Origin, which don't change what a file contains.
const ANY = { ignoreVary: true };

// Hashed names never change content, so files kept by an earlier version are reused, not downloaded again.
// Old files are not deleted: pages cached by an earlier version still need them.
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => Promise.all(ASSETS.map(async (url) => (await cache.match(url, ANY)) || cache.add(url)))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.registration.navigationPreload?.enable();
      // The page that installed this worker loaded before it existed, so keep that page now.
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      await Promise.all(clients.map((client) => fetch(client.url).then((response) => keep(PAGES, pageKey(client.url), response), () => {})));
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin || request.headers.has('range')) return;
  if (url.pathname.startsWith('/bg/') || url.pathname.startsWith('/whisper/')) return;
  if (request.mode === 'navigate') event.respondWith(networkFirst(event, PAGES, pageKey(request.url)));
  else if (url.pathname.startsWith('/assets/')) event.respondWith(cacheFirst(event));
  else event.respondWith(networkFirst(event, SHELL, request));
});

const pageKey = (href) => href.split(/[?#]/)[0];

function keep(name, key, response) {
  if (!response.ok || response.type !== 'basic' || response.redirected) return;
  return caches.open(name).then((cache) => cache.put(key, response));
}

async function networkFirst(event, name, key) {
  try {
    const response = (await event.preloadResponse) || (await fetch(event.request));
    event.waitUntil(Promise.resolve(keep(name, key, response.clone())).catch(() => {}));
    return response;
  } catch (error) {
    const cached = await caches.match(key, ANY);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(event) {
  const cached = await caches.match(event.request, ANY);
  if (cached) return cached;
  const response = await fetch(event.request);
  event.waitUntil(Promise.resolve(keep(SHELL, event.request, response.clone())).catch(() => {}));
  return response;
}

// Keeps Fizzdoc working with the internet off. The build writes this file to /sw.js with ASSETS filled in.
// - Pages: from the network when online, so they are always fresh; from the cache when offline.
// - theme.js and the hashed files under /assets/ (the code of every tool): kept on the device when this worker installs.
// - The speech and background model and runtime files (.onnx, .wasm) are never stored here; their tools keep
//   them in their own caches. Their small files (model lists, runtime loaders) are kept like any other file.
const ASSETS = [/* ASSETS */];
// The "needs the internet once" message and the home link, per language: { en: { needed, home, link }, hi: … }.
const OFFLINE = {/* OFFLINE */};
const SHELL = 'fizzdoc-shell';
const PAGES = 'fizzdoc-pages';
// Responses vary only by Accept-Encoding/Origin, which don't change what a file contains.
const ANY = { ignoreVary: true };

// Hashed names never change content, so files kept by an earlier version are reused, not downloaded again.
// Old files are not deleted: pages cached by an earlier version still need them.
// The home page is the installed app's start page, so it is kept too (fresh with each version).
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL).then((cache) => Promise.all(ASSETS.map(async (url) => (await cache.match(url, ANY)) || cache.add(url)))),
      caches.open(PAGES).then((cache) => cache.add('/')),
    ]),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.registration.navigationPreload?.enable();
      // Take charge of the open page now, so its first run can already say the tool works offline.
      await self.clients.claim();
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
  if (/^\/(bg|whisper)\/.*\.(onnx|wasm)(\.part\d+)?$/.test(url.pathname)) return;
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
    if (event.request.mode === 'navigate') return offlinePage(new URL(event.request.url));
    throw error;
  }
}

// A page that was never opened: say so plainly, in the page's language, instead of the browser's error page.
function offlinePage(url) {
  const first = url.pathname.split('/')[1];
  const lang = first in OFFLINE ? first : 'en';
  const { needed, home, link } = OFFLINE[lang];
  const html = `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fizzdoc</title>
<style>body{max-width:32rem;margin:20vh auto;padding:0 24px;font:18px/1.6 system-ui,sans-serif;color:#18181b;background:#fafafa}a{color:#4f46e5}@media (prefers-color-scheme:dark){body{color:#f4f4f5;background:#09090b}a{color:#a5b4fc}}</style>
<p>${needed}</p><p><a href="${link}">${home}</a></p>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function cacheFirst(event) {
  const cached = await caches.match(event.request, ANY);
  if (cached) return cached;
  const response = await fetch(event.request);
  event.waitUntil(Promise.resolve(keep(SHELL, event.request, response.clone())).catch(() => {}));
  return response;
}

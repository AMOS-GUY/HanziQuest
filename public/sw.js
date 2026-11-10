/* HanziQuest service worker.
 *
 * - Precaches the static offline pages (/offline, /offline/practice) and the scripts they load.
 * - Hashed build assets (/_next/static) are cache-first; they never change once built.
 * - Page navigations go to the network. Signed-in pages are NOT cached (shared devices); when the
 *   network is unavailable the learner gets the offline page instead.
 * - API requests are never cached. Offline practice is queued in IndexedDB by the app.
 */
const VERSION = "hq-sw-1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const OFFLINE_PAGES = ["/offline", "/offline/practice"];
const STATIC_FILES = ["/manifest.webmanifest", "/icon.svg", "/icons/icon-192.png"];

async function precache() {
  const shell = await caches.open(SHELL_CACHE);
  const assets = await caches.open(ASSET_CACHE);
  await shell.addAll(STATIC_FILES);
  for (const page of OFFLINE_PAGES) {
    const response = await fetch(page, { credentials: "omit", cache: "no-store" });
    if (!response.ok) continue;
    const html = await response.clone().text();
    await shell.put(page, response);
    // Cache the build assets the page references so it renders without a connection.
    const urls = new Set(
      [...html.matchAll(/["'(](\/_next\/static\/[^"'()\s]+)["')]/g)].map((m) => m[1]),
    );
    await Promise.all(
      [...urls].map((url) => assets.add(url).catch(() => undefined)),
    );
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(ASSET_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function navigation(request, url) {
  const isOfflinePage = OFFLINE_PAGES.includes(url.pathname);
  try {
    const response = await fetch(request);
    if (isOfflinePage && response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(url.pathname, response.clone());
    }
    return response;
  } catch {
    const shell = await caches.open(SHELL_CACHE);
    return (
      (await shell.match(isOfflinePage ? url.pathname : "/offline")) ??
      new Response("You are offline.", { status: 503, headers: { "Content-Type": "text/plain" } })
    );
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(navigation(request, url));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (STATIC_FILES.includes(url.pathname) || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request)),
    );
  }
});

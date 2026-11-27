const CACHE_NAME = "manufacturer-driver-shell-v1";
const APP_SHELL_URL = new URL("./", self.registration.scope).href;
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/?$/, "/");

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.add(APP_SHELL_URL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("manufacturer-driver-shell-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname === `${SCOPE_PATH}api` || url.pathname.startsWith(`${SCOPE_PATH}api/`)) return;

  if (request.mode === "navigate" && url.pathname.startsWith(SCOPE_PATH)) {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const shell = await cache.match(APP_SHELL_URL);
        return shell || Response.error();
      }),
    );
    return;
  }

  if (!["script", "style", "image", "font"].includes(request.destination) || url.search) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      await cache.put(request, response.clone());
    }
    return response;
  })());
});

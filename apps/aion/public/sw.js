/*
 * AION service worker.
 *
 * It caches the application shell and nothing else. Every request to /api/ goes straight to the
 * network with no cache read and no cache write, so no conversation, memory, task, relationship,
 * prospect, Career, activity, approval, or verification response is ever persisted by the browser.
 * That matters most on a phone: a cached API response would outlive a revoked session and would
 * survive on a device the owner no longer controls.
 *
 * If the network is unavailable the API simply fails. Showing stale customer information would be
 * worse than showing none.
 */
const SHELL = "aion-shell-v7-iphone-viewport";
const SHELL_FILES = ["/", "/phone", "/phone.html", "/manifest.webmanifest", "/icon.svg"];
// app.js / styles.css are version-queried from HTML — do not precache unversioned paths.

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== SHELL).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;
  // Anything that is not a plain same-origin GET of the shell is network-only, uncached.
  if (!sameOrigin || event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  if (!SHELL_FILES.includes(url.pathname)) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) { const copy = response.clone(); caches.open(SHELL).then((cache) => cache.put(event.request, copy)); }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached ?? Response.error())),
  );
});

/** Lets the app drop the shell cache when the owner signs a device out. */
self.addEventListener("message", (event) => {
  if (event.data === "aion-clear-cache") event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))));
});

/**
 * AbaYa Track — Service Worker
 * Strategy: cache-then-network for the app shell (HTML).
 * All API / SSE / audio requests bypass the SW entirely — they always go live.
 */
'use strict';

const CACHE = 'abaya-shell-v1';

// ── Install: pre-cache the app shell ─────────────────────────────────────────
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(c => c.add('/'))
  );
});

// ── Activate: remove stale caches ────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => clients.claim())
  );
});

// ── Fetch: offline fallback for HTML navigation only ─────────────────────────
self.addEventListener('fetch', e => {
  // Only intercept full-page navigations (not API, SSE, audio, fonts)
  if (e.request.mode !== 'navigate') return;

  e.respondWith(
    fetch(e.request)
      .then(r => {
        // Keep cache fresh with every successful load
        if (r.ok) caches.open(CACHE).then(c => c.put('/', r.clone()));
        return r;
      })
      .catch(() => caches.match('/'))   // WiFi dropped — serve cached shell
  );
});

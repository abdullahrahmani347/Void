// VOID Streaming Service Worker
// Provides offline functionality and caching.
// v12: cross-origin interception removed — the SW only handles same-origin
// traffic now. The old cache-first poster branch broke every image on the
// deployed HTTPS origin (SW fetch replays died before reaching the network)
// while working on localhost; see the comment in the fetch handler.
// F-01: every script the page loads is precached now — the shell used to list
// only app.js/styles.css, so an offline reload lost the focus manager, resume
// dialog, palette, PIN gate and the rest of the 11 feature modules. The
// content handler also returns a real 503 instead of `null` (which
// respondWith() rejects with a TypeError) when the network is unavailable.
// F-02: dead strategies removed — the write-never CACHE_NAME/STATIC_CACHE
// pair, the four no-op background-sync stubs, the push/periodicsync handlers
// with no client-side subscription flow, and the SW-internal trending
// prefetch that discarded its own response. The dynamic cache is trimmed on
// activate so it can no longer grow without bound.

const CACHE = 'void-shell-v14'; // v14: production hardening release (reliability/perf/a11y/security)
const DYNAMIC_CACHE = 'void-dynamic-v12';

// F-01: relative URLs resolve against the SW's own directory, so this works
// at the domain root AND from subpath deployments.
const SHELL = [
  './', './index.html', './styles.css', './app.js', './logo.svg', './favicon.svg',
  './manifest.webmanifest', './robots.txt', './sitemap.xml',
  // F-01: the 11 feature modules the page loads besides app.js
  './a11y.js', './resume-dialog.js', './share-card.js', './watchlist-share.js',
  './command-palette.js', './diary-depth.js', './genre-mashup.js',
  './profile-pin.js', './i18n.js', './csv-import.js', './sw-register.js'
];

const DYNAMIC_CACHE_MAX = 120;

// Install event - cache the full offline shell (P2 + F-01)
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Install');
  event.waitUntil(
    caches.open(CACHE).then((cache) => {
      console.log('[ServiceWorker] Caching offline shell (all modules)');
      return cache.addAll(SHELL);
    }).then(() => {
      console.log('[ServiceWorker] Skip waiting');
      self.skipWaiting();
    })
  );
});

// Activate event - clean up old caches, trim the dynamic cache
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activate');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE && cacheName !== DYNAMIC_CACHE) {
            console.log('[ServiceWorker] Removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => trimCache(DYNAMIC_CACHE, DYNAMIC_CACHE_MAX)).then(() => {
      console.log('[ServiceWorker] Claiming clients');
      self.clients.claim();
    })
  );
});

// F-02: cap a cache's entry count (oldest entries evicted first)
async function trimCache(name, max) {
  try {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    if (keys.length <= max) return;
    await Promise.all(keys.slice(0, keys.length - max).map((k) => cache.delete(k)));
    console.log('[ServiceWorker] Trimmed', name, 'to', max, 'entries');
  } catch (err) { console.log('[ServiceWorker] trimCache failed:', err); }
}

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // v12 FIX: cross-origin requests are NEVER intercepted. The old cache-first
  // poster branch (image.tmdb.org) worked locally but on the deployed HTTPS
  // origin the SW's fetch(event.request) replay failed instantly without
  // reaching the network — every poster broke in production while localhost
  // looked fine, so it shipped unnoticed. Browser-verified on the deployment:
  // page-direct image loads are CSP-cleared (img-src) and load 56/56, so the
  // browser now fetches them itself. Cost: posters are no longer available in
  // the offline cache (the feed needs network data anyway).
  if (url.origin !== location.origin) {
    return;
  }

  // P5-8: Netlify functions/APIs — network first, fall back to cached responses
  // so recently-fetched content stays available offline.
  if (url.pathname.startsWith('/.netlify/')) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // P5-8: navigations — network first, fall back to the cached shell (SPA)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put('./index.html', res.clone())).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then((hit) => hit || caches.match('./')))
    );
    return;
  }

  // P2: shell assets — stale-while-revalidate from CACHE
  if (SHELL.includes(url.pathname) || SHELL.includes('./' + url.pathname.split('/').pop()) || url.pathname === '/') {
    event.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(event.request);
      const net = fetch(event.request).then(res => { if (res.ok) c.put(event.request, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }

  // Handle all other content with stale-while-revalidate
  event.respondWith(handleContentRequest(request));
});

// API caching strategy — A2: stale-while-revalidate for TMDB JSON. A cached
// copy answers instantly (badged via X-Void-Cache: stale so the page can show
// its "cached data" pill) while the network refresh happens in the background.
// AI traffic is POST-only and never reaches this handler, so no stale chat
// replies can ever be served.
async function handleApiRequest(request) {
  const cache = await caches.open(DYNAMIC_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((res) => { if (res.ok) cache.put(request, res.clone()); return res; })
    .catch(() => null);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set('X-Void-Cache', 'stale');
    return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
  }
  const net = await refresh;
  if (net) return net;
  return new Response(JSON.stringify({
    error: 'offline',
    message: 'You are offline. Some features may be limited.'
  }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Content caching strategy - stale while revalidate
async function handleContentRequest(request) {
  const cachedResponse = await caches.match(request);

  // Start fetching from network in background
  const fetchPromise = fetch(request).then((networkResponse) => {
    if (networkResponse.ok) {
      const cache = caches.open(DYNAMIC_CACHE);
      cache.then((c) => c.put(request, networkResponse.clone()));
    }
    return networkResponse;
  }).catch(() => {
    console.log('[ServiceWorker] Network fetch failed for:', request.url);
    // F-01: this used to return null, which respondWith() rejects with a
    // TypeError — every offline request for a non-precached asset errored.
    return new Response('Service unavailable', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  });

  // Return cached response immediately if available, otherwise wait for network
  if (cachedResponse) {
    return cachedResponse;
  }

  return fetchPromise;
}

// Message handler for communication with main app
self.addEventListener('message', (event) => {
  console.log('[ServiceWorker] Message received:', event.data);

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data && event.data.type === 'CACHE_URLS') {
    // Pre-cache specific URLs
    event.waitUntil(
      caches.open(DYNAMIC_CACHE).then((cache) => {
        return cache.addAll(event.data.urls);
      })
    );
  } else if (event.data && event.data.type === 'CLEAR_CACHE') {
    // Clear specific cache
    event.waitUntil(
      caches.delete(event.data.cacheName)
    );
  }
});

console.log('[ServiceWorker] Service Worker loaded');

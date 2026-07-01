// VOID Streaming Service Worker
// Provides offline functionality, caching, and background sync

const CACHE_NAME = 'void-cache-v1';
const STATIC_CACHE = 'void-static-v1';
const DYNAMIC_CACHE = 'void-dynamic-v1';

// Assets to cache immediately on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/styles.css',
  '/manifest.json',
  '/favicon.svg',
  '/logo.svg',
  '/robots.txt',
  '/sitemap.xml'
];

// Images domain for caching
const IMAGE_DOMAINS = [
  'https://image.tmdb.org'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Install');
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      console.log('[ServiceWorker] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => {
      console.log('[ServiceWorker] Skip waiting');
      self.skipWaiting();
    })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activate');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE && cacheName !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[ServiceWorker] Claiming clients');
      self.clients.claim();
    })
  );
});

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

  // Handle image requests with cache-first strategy
  if (IMAGE_DOMAINS.some(domain => url.origin === domain)) {
    event.respondWith(handleImageRequest(request));
    return;
  }

  // Handle API requests with network-first strategy
  if (url.hostname === 'api.themoviedb.org' || url.hostname === 'api.anthropic.com') {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // Handle static and dynamic content with stale-while-revalidate
  event.respondWith(handleContentRequest(request));
});

// Image caching strategy - cache first, then network
async function handleImageRequest(request) {
  const cachedResponse = await caches.match(request);

  if (cachedResponse) {
    // Return cached image immediately
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      // Cache the image for future use
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    console.log('[ServiceWorker] Image fetch failed:', error);
    // Return a placeholder or empty response
    return new Response('', { status: 404 });
  }
}

// API caching strategy - network first, fallback to cache
async function handleApiRequest(request) {
  try {
    const networkResponse = await fetch(request);

    if (networkResponse.ok) {
      // Cache successful API responses
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    console.log('[ServiceWorker] API fetch failed, trying cache:', error);

    // Try to return cached response
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // Return offline error response
    return new Response(JSON.stringify({
      error: 'offline',
      message: 'You are offline. Some features may be limited.'
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
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
    return null;
  });

  // Return cached response immediately if available, otherwise wait for network
  if (cachedResponse) {
    return cachedResponse;
  }

  return fetchPromise;
}

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  console.log('[ServiceWorker] Sync event:', event.tag);

  if (event.tag === 'sync-watchlist') {
    event.waitUntil(syncWatchlist());
  } else if (event.tag === 'sync-diary') {
    event.waitUntil(syncDiary());
  } else if (event.tag === 'sync-profiles') {
    event.waitUntil(syncProfiles());
  }
});

// Sync watchlist when back online
async function syncWatchlist() {
  console.log('[ServiceWorker] Syncing watchlist...');
  // This would sync local watchlist changes with server
  // For now, we just log it
  return Promise.resolve();
}

// Sync diary entries when back online
async function syncDiary() {
  console.log('[ServiceWorker] Syncing diary...');
  return Promise.resolve();
}

// Sync profile changes when back online
async function syncProfiles() {
  console.log('[ServiceWorker] Syncing profiles...');
  return Promise.resolve();
}

// Push notifications support
self.addEventListener('push', (event) => {
  console.log('[ServiceWorker] Push received');

  const options = {
    body: event.data ? event.data.text() : 'New content available!',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      { action: 'explore', title: 'Explore Now' },
      { action: 'close', title: 'Close' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification('VOID Streaming', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('[ServiceWorker] Notification click:', event.action);
  event.notification.close();

  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

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

// Periodic background sync (if supported)
self.addEventListener('periodicsync', (event) => {
  console.log('[ServiceWorker] Periodic sync:', event.tag);

  if (event.tag === 'update-trending') {
    event.waitUntil(updateTrendingContent());
  }
});

async function updateTrendingContent() {
  console.log('[ServiceWorker] Updating trending content in background...');
  // Pre-fetch trending content for faster load next time
  try {
    await fetch('https://api.themoviedb.org/3/trending/all/day?api_key=2dca580c2a14b55200e784d157207b4d');
  } catch (error) {
    console.log('[ServiceWorker] Failed to pre-fetch trending:', error);
  }
}

console.log('[ServiceWorker] Service Worker loaded');
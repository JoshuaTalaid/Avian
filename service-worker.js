/* ═══════════════════════════════════════════════════════════
   AVIAN — Service Worker
   Strategy : Cache-first for static assets & model files
              Network-first for version.json (update checks)
   Scope     : /Avian/
═══════════════════════════════════════════════════════════ */

const CACHE_NAME    = 'avian-cache-v1.0.0';
const BASE          = '/Avian';

/* ── Assets to pre-cache on install ── */
const PRECACHE_URLS = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/style.css`,
  `${BASE}/script.js`,
  `${BASE}/manifest.json`,
  `${BASE}/version.json`,

  /* TensorFlow.js from CDN — cache so inference works offline */
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.16.0/dist/tf.min.js',

  /* Google Fonts — cache the CSS + referenced font files */
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;0,700;1,400&family=Outfit:wght@300;400;500;600&display=swap',

  /* Model files */
  `${BASE}/model/model.json`,
  `${BASE}/model/metadata.json`,
  `${BASE}/model/weights.bin`,

  /* Icons */
  `${BASE}/icons/icon-192.png`,
  `${BASE}/icons/icon-512.png`,
  `${BASE}/icons/icon-192-maskable.png`,
  `${BASE}/icons/icon-512-maskable.png`
];

/* ═══════════════════════════
   INSTALL — pre-cache assets
═══════════════════════════ */
self.addEventListener('install', event => {
  console.log('[SW] Installing — caching assets');

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      /*
       * Cache each URL individually so a single failure
       * (e.g. a missing icon) doesn't abort the whole install.
       */
      return Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err =>
            console.warn('[SW] Failed to cache:', url, err)
          )
        )
      );
    }).then(() => {
      console.log('[SW] Install complete');
      /* Skip waiting so the new SW activates immediately */
      return self.skipWaiting();
    })
  );
});

/* ═══════════════════════════
   ACTIVATE — prune old caches
═══════════════════════════ */
self.addEventListener('activate', event => {
  console.log('[SW] Activating');

  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => {
      console.log('[SW] Activation complete — claiming clients');
      return self.clients.claim();
    })
  );
});

/* ═══════════════════════════
   FETCH — serve requests
═══════════════════════════ */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  /* Skip non-GET and chrome-extension requests */
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  /* ── version.json: Network-first so update checks always get fresh data ── */
  if (url.pathname.endsWith('version.json')) {
    event.respondWith(networkFirst(request));
    return;
  }

  /* ── Google Fonts CSS: Stale-while-revalidate ── */
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  /* ── Everything else: Cache-first ── */
  event.respondWith(cacheFirst(request));
});

/* ═══════════════════════════
   STRATEGIES
═══════════════════════════ */

/**
 * Cache-first: serve from cache; fall back to network and cache response.
 * Best for: static assets, model files, TF.js library.
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.warn('[SW] Fetch failed (offline?):', request.url);
    /* Return a generic offline fallback for navigation requests */
    if (request.mode === 'navigate') {
      const cached = await caches.match(`${BASE}/index.html`);
      return cached ?? new Response('Offline — please reload when connected.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    throw err;
  }
}

/**
 * Network-first: try network; fall back to cache on failure.
 * Best for: version.json, frequently updated files.
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return caches.match(request);
  }
}

/**
 * Stale-while-revalidate: serve cache immediately; refresh in background.
 * Best for: fonts, non-critical third-party assets.
 */
async function staleWhileRevalidate(request) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached ?? fetchPromise;
}

/* ═══════════════════════════
   MESSAGE — force update
═══════════════════════════ */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then(keys =>
      Promise.all(keys.map(key => caches.delete(key)))
    ).then(() => {
      /* Notify all clients that cache is cleared */
      self.clients.matchAll().then(clients =>
        clients.forEach(client =>
          client.postMessage({ type: 'CACHE_CLEARED' })
        )
      );
    });
  }
});

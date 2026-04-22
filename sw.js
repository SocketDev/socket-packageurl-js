/* ------------------------------------------------------------------
 * Docs-site service worker.
 *
 * Cache-first for same-origin static assets (HTML pages, CSS, JS,
 * SVG icons, favicons, fonts, highlight.js bundle). Network-first
 * for the comment backend (`/api/comments/*`) so posted comments,
 * resolutions, and the unresolved list always reflect the current
 * server state.
 *
 * Versioning:
 *   The cache name embeds a generation string. Bumping CACHE_VERSION
 *   orphans the old cache; the `activate` handler prunes it. Any
 *   asset rename (e.g. fingerprinting in the future) just needs
 *   a version bump and the new file will miss-and-fetch on its
 *   first request.
 *
 * Why not Workbox?
 *   The cache-first + SWR pattern here is ~80 lines of platform JS.
 *   Adding Workbox would be a bigger asset than the handler itself.
 * ------------------------------------------------------------------ */

// `__CACHE_VERSION__` is substituted at generate time with the current
// git commit SHA (see scripts/tour.mts). Every deploy produces
// a different version string, which flips the SW bytes, which makes
// the browser's update check detect a new SW, which triggers `install`
// + `activate` — and the `activate` handler prunes the old cache.
// Fallback literal 'dev' keeps local file-serve working when the
// build step hasn't run yet.
const CACHE_VERSION = '__CACHE_VERSION__'
const CACHE_NAME = `wt-cache-${CACHE_VERSION}`

// Base path derived from the SW's own scope — works the same whether
// we're hosted at the origin root (/) or under a subdirectory like
// GitHub Pages' /<repo>/. `self.location.pathname` is the path to
// this script file itself; strip the filename to get the dir.
const BASE_PATH = self.location.pathname.replace(/\/[^/]*$/, '')

// Precache list — the critical-path assets the shell needs on first
// paint. HTML entries aren't precached (the page is the request that
// installs the SW); the *next* navigation to them is cached.
const PRECACHE = [
  `${BASE_PATH}/style.css`,
  `${BASE_PATH}/drag.js`,
  `${BASE_PATH}/comments.js`,
  `${BASE_PATH}/favicon.ico`,
  `${BASE_PATH}/favicon-16x16.png`,
  `${BASE_PATH}/favicon-32x32.png`,
  `${BASE_PATH}/apple-touch-icon.png`,
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // `addAll` is atomic — if any URL 404s, the whole install fails
      // and we keep the old SW. We use `add` per-URL with individual
      // catches so a single missing asset (comments shim on a build
      // without the commentBackend) doesn't abort install.
      Promise.all(PRECACHE.map(url => cache.add(url).catch(() => null))),
    ),
  )
  // Activate immediately on first install so the new worker starts
  // serving without waiting for all clients to navigate away.
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(k => k.startsWith('wt-cache-') && k !== CACHE_NAME)
            .map(k => caches.delete(k)),
        ),
      ),
  )
  // Take over uncontrolled pages (on first install there's no prior
  // SW, so this is the only way existing tabs opt into caching).
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  const { request } = event
  // Only handle GETs. POST/PUT/DELETE bypasses the SW entirely so the
  // comment mutations hit the network.
  if (request.method !== 'GET') {
    return
  }
  const url = new URL(request.url)
  // Only same-origin. Cross-origin (highlight.js CDN, Val Town
  // backend) goes straight to the network — we don't want to cache
  // API responses behind our version key.
  if (url.origin !== self.location.origin) {
    return
  }
  // Skip the comment API explicitly even if it's same-origin (future
  // proofing, e.g. same-origin deploy with /api/* routes).
  if (url.pathname.startsWith('/api/')) {
    return
  }

  // Navigation requests (top-level HTML page loads) are network-first.
  // Stale HTML is the scariest cache-miss mode: the page ships pointing
  // at old asset URLs that may have been renamed/moved. Always going
  // to the network for the document itself avoids "stale page between
  // deploys" even on first-load revisits. Fall back to cache only
  // when the network actually fails (offline).
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }

  event.respondWith(cacheFirst(request))
})

/**
 * Network-first: try the network, fall back to cache only on failure.
 * Used for HTML navigations so a new deploy is always picked up.
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(request)
    if (cached) {
      return cached
    }
    throw new Error('offline and no cached copy')
  }
}

/**
 * Cache-first with stale-while-revalidate: serve the cached response
 * immediately (instant), kick off a network refresh in the background
 * to update the cache for the next load. Misses fall through to a
 * fresh network fetch and cache the result.
 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  const networkFetch = fetch(request)
    .then(response => {
      // Only cache successful responses — don't poison the cache with
      // 500s or 404s from a transient backend glitch.
      if (response.ok) {
        cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => null)

  return cached || networkFetch || fetch(request)
}

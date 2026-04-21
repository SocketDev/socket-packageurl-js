/* ------------------------------------------------------------------
 * Walkthrough service worker.
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

const CACHE_VERSION = 'wt-v1'
const CACHE_NAME = `wt-cache-${CACHE_VERSION}`

// Precache list — the critical-path assets the shell needs on first
// paint. HTML entries aren't precached (the page is the request that
// installs the SW); the *next* navigation to them is cached.
const PRECACHE = [
  '/walkthrough.css',
  '/walkthrough-drag.js',
  '/walkthrough-comments.js',
  '/favicon.ico',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
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

  event.respondWith(cacheFirst(request))
})

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

// Messages PWA Service Worker
// Provides: installability, stratified caching, offline fallback

const CACHE_NAME = 'messages-v7'
const MEDIA_CACHE = 'messages-media-v2'
const MEDIA_CACHE_MAX = 200

// App shell — cached on install for instant loads
const APP_SHELL = [
  '/Messages/',
  '/Messages/login',
  '/Messages/icon-192.png',
  '/Messages/icon-512.png',
  '/Messages/favicon.ico',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== CACHE_NAME && n !== MEDIA_CACHE)
          .map((n) => caches.delete(n))
      )
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Never cache Matrix API requests, WebSocket, auth, or crypto endpoints
  if (
    url.pathname.startsWith('/Messages/api/matrix-proxy/') ||
    url.pathname.startsWith('/Messages/_matrix/') ||
    url.pathname.includes('/keys/') ||
    url.pathname.includes('/sync') ||
    url.protocol === 'wss:' ||
    request.method !== 'GET'
  ) {
    return
  }

  // Cache-first for static assets (JS, CSS, fonts, WASM)
  if (
    url.pathname.startsWith('/Messages/_next/static/') ||
    url.pathname.match(/\.(js|css|woff2?|wasm)$/)
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone()
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
            }
            return response
          })
      )
    )
    return
  }

  // Stale-while-revalidate for images (avatars, icons)
  if (url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|ico)$/)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchPromise = fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(MEDIA_CACHE).then(async (cache) => {
              await cache.put(request, clone)
              // Evict oldest entries if cache is too large
              const keys = await cache.keys()
              if (keys.length > MEDIA_CACHE_MAX) {
                await cache.delete(keys[0]).catch(() => {})
              }
            }).catch(() => {})
          }
          return response
        }).catch(() => cached)
        return cached || fetchPromise
      })
    )
    return
  }

  // Network-first for HTML pages (always get latest)
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
          }
          return response
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/Messages/')))
    )
    return
  }
})

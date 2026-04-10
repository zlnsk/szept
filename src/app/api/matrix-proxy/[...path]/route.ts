import { NextRequest, NextResponse } from 'next/server'
import { isPrivateHost, isPrivateHostResolved } from '@/lib/ssrf'
// Homeserver allowlist: only these hosts can be proxied to.
// Set via ALLOWED_HOMESERVER_HOSTS env var (comma-separated hostnames).
// If empty/unset, the allowlist is empty and ALL proxy requests are denied.
const ALLOWED_HOMESERVERS: ReadonlySet<string> = new Set(
  (process.env.ALLOWED_HOMESERVER_HOSTS ?? '')
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean)
)

// Optional per-host backend override. Lets the proxy reach the homeserver via an
// internal URL (e.g. Tailscale / private network) instead of going back out over
// the public internet. Configured via MATRIX_BACKEND_URL env var, format:
//   "host1=http://10.0.0.1:8008,host2=http://10.0.0.2:8008"
// If a host is not listed, the proxy uses the original public origin supplied by
// the client (hsUrl.origin).
const MATRIX_BACKEND_MAP: ReadonlyMap<string, string> = new Map(
  (process.env.MATRIX_BACKEND_URL ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const eq = entry.indexOf('=')
      if (eq === -1) return null
      const host = entry.slice(0, eq).trim().toLowerCase()
      const url = entry.slice(eq + 1).trim()
      if (!host || !url) return null
      return [host, url] as [string, string]
    })
    .filter((x): x is [string, string] => x !== null)
)


/**
 * Server-side proxy for Matrix API requests.
 * Bypasses browser CORS restrictions when the homeserver (e.g. behind Pangolin)
 * doesn't serve Access-Control-Allow-Origin headers.
 *
 * Client sends: POST /api/matrix-proxy/_matrix/client/v3/sync?...
 *   Header: X-Matrix-Homeserver: https://<your-homeserver>
 * Proxy sends: POST https://<your-homeserver>/_matrix/client/v3/sync?...
 *
 * The set of allowed homeservers is configured via the ALLOWED_HOMESERVER_HOSTS
 * env var (comma-separated hostnames).
 */


// ---- Per-IP rate limiting (sliding window) ----
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
const RATE_LIMIT_MAX_LOGIN = 5       // max login attempts per window
const RATE_LIMIT_MAP_MAX = 10_000
const rateLimitAttempts = new Map<string, { count: number; windowStart: number }>()

let lastCleanup = Date.now()

const RATE_LIMITS: Record<string, number> = {
  login: 5,
  register: 5,
  send_message: 30,
  media_upload: 10,
  search: 60,
  room_create: 10,
  default: 600,
}

function isRateLimited(ip: string, key: string, max: number = RATE_LIMIT_MAX_LOGIN): boolean {
  const now = Date.now()
  const mapKey = `${key}:${ip}`

  // Lazy cleanup: purge stale entries every 5 minutes instead of setInterval
  // (setInterval with unref() doesn't run reliably in all environments)
  if (now - lastCleanup > 5 * 60_000) {
    lastCleanup = now
    for (const [k, entry] of rateLimitAttempts) {
      if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
        rateLimitAttempts.delete(k)
      }
    }
  }

  const entry = rateLimitAttempts.get(mapKey)
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    // Evict oldest entry if map is at capacity to prevent unbounded growth
    if (!rateLimitAttempts.has(mapKey) && rateLimitAttempts.size >= RATE_LIMIT_MAP_MAX) {
      const firstKey = rateLimitAttempts.keys().next().value!
      rateLimitAttempts.delete(firstKey)
    }
    rateLimitAttempts.set(mapKey, { count: 1, windowStart: now })
    return false
  }
  entry.count++
  if (entry.count > max) return true
  return false
}

const MAX_BODY_SIZE = 1 * 1024 * 1024         // 1 MB
const MAX_MEDIA_BODY_SIZE = 100 * 1024 * 1024  // 100 MB
const UPSTREAM_TIMEOUT_MS = 30_000              // 30 seconds
const UPSTREAM_SYNC_TIMEOUT_MS = 65_000        // 65 seconds (sync long-polls up to 30s + buffer)

// Headers that should NOT be forwarded to the upstream server
const STRIP_REQUEST_HEADERS = new Set([
  'host',
  'x-matrix-homeserver',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'connection',
  'transfer-encoding',
  'cookie',
])

// Headers that should NOT be returned to the browser
const STRIP_RESPONSE_HEADERS = new Set([
  'transfer-encoding',
  'connection',
  // 'content-encoding' — preserved to avoid corrupting encrypted media
])


async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const homeserver = request.headers.get('x-matrix-homeserver')
  if (!homeserver) {
    return NextResponse.json({ error: 'Missing X-Matrix-Homeserver header' }, { status: 400 })
  }

  // Validate homeserver URL
  let hsUrl: URL
  try {
    hsUrl = new URL(homeserver)
    if (hsUrl.protocol !== 'https:') {
      return NextResponse.json({ error: 'Homeserver must use HTTPS' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid homeserver URL' }, { status: 400 })
  }

  // Homeserver allowlist check
  if (!ALLOWED_HOMESERVERS.has(hsUrl.hostname.toLowerCase())) {
    return NextResponse.json({ error: 'Homeserver not in allowlist' }, { status: 403 })
  }

  // SSRF protection: block requests to private/internal hosts (with DNS rebinding check)
  if (await isPrivateHostResolved(hsUrl.hostname)) {
    return NextResponse.json({ error: 'Private/internal addresses are not allowed' }, { status: 400 })
  }

  const { path } = await params
  // Re-encode path segments: Next.js auto-decodes %3A → : etc. in [...path],
  // but Matrix room/user/event IDs contain special characters (!, :, @, $)
  // that must be percent-encoded when forwarded to the homeserver.
  const matrixPath = '/' + path.map(segment => encodeURIComponent(segment)).join('/')
  const search = request.nextUrl.search

  // Only allow proxying specific /_matrix/ path prefixes to prevent SSRF
  // Federation APIs are intentionally excluded — they are server-to-server only.
  const ALLOWED_MATRIX_PREFIXES = [
    '/_matrix/client/',
    '/_matrix/media/',
    '/_matrix/key/',
  ]
  if (!ALLOWED_MATRIX_PREFIXES.some(prefix => matrixPath.startsWith(prefix))) {
    return NextResponse.json(
      { error: 'Only /_matrix/client/, /_matrix/media/, and /_matrix/key/ paths are allowed' },
      { status: 403 }
    )
  }

  // Request body size limit
  const isMediaEndpoint = matrixPath.startsWith('/_matrix/media/') || matrixPath.includes('/media/')
  const maxSize = isMediaEndpoint ? MAX_MEDIA_BODY_SIZE : MAX_BODY_SIZE
  const contentLength = request.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > maxSize) {
    return NextResponse.json(
      { errcode: 'M_TOO_LARGE', error: 'Request body too large' },
      { status: 413 }
    )
  }

  // Rate limit requests per IP based on endpoint category
  const isLogin = matrixPath.includes('/login') && request.method === 'POST'
  const isRegister = matrixPath.includes('/register') && request.method === 'POST'

  // Extract the real client IP from X-Forwarded-For using TRUSTED_PROXY_COUNT.
  // With N trusted proxies, the client IP is at position (length - N) from the end.
  // Default TRUSTED_PROXY_COUNT=1 means we trust one proxy (the immediate reverse proxy).
  const trustedProxyCount = parseInt(process.env.TRUSTED_PROXY_COUNT || '1', 10)
  const xffHeader = request.headers.get('x-forwarded-for') || ''
  const xffIps = xffHeader.split(',').map(s => s.trim()).filter(Boolean)
  const clientIndex = Math.max(0, xffIps.length - trustedProxyCount)
  const ip = xffIps[clientIndex]
    || request.headers.get('x-real-ip')
    || 'unknown'

  let limitCategory = 'default'
  let limitMax = RATE_LIMITS.default

  if (isLogin) { limitCategory = 'login'; limitMax = RATE_LIMITS.login }
  else if (isRegister) { limitCategory = 'register'; limitMax = RATE_LIMITS.register }
  else if (matrixPath.includes('/send/') && request.method === 'PUT') { limitCategory = 'send_message'; limitMax = RATE_LIMITS.send_message }
  else if (matrixPath.startsWith('/_matrix/media/') && request.method === 'POST') { limitCategory = 'media_upload'; limitMax = RATE_LIMITS.media_upload }
  else if (matrixPath.includes('/search')) { limitCategory = 'search'; limitMax = RATE_LIMITS.search }
  else if (matrixPath.includes('/createRoom')) { limitCategory = 'room_create'; limitMax = RATE_LIMITS.room_create }

  // Skip rate limiting for essential read-only SDK endpoints
  const isReadOnly = request.method === 'GET' && (
    matrixPath.includes('/sync') ||
    matrixPath.includes('/versions') ||
    matrixPath.includes('/profile/') ||
    matrixPath.includes('/keys/') ||
    matrixPath.includes('/joined_rooms') ||
    matrixPath.includes('/members') ||
    matrixPath.includes('/state') ||
    matrixPath.startsWith('/_matrix/client/v1/media/')
  )
  if (!isReadOnly && isRateLimited(ip, limitCategory, limitMax)) {
    return NextResponse.json(
      { errcode: 'M_LIMIT_EXCEEDED', error: 'Too many requests. Please wait before trying again.', retry_after_ms: RATE_LIMIT_WINDOW_MS },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) } }
    )
  }

  // Optionally route to an internal backend URL (bypasses public TLS / reverse proxy).
  // See MATRIX_BACKEND_MAP at top of file; falls back to the public homeserver origin.
  const internalOrigin = MATRIX_BACKEND_MAP.get(hsUrl.hostname.toLowerCase())
  const targetUrl = `${internalOrigin || hsUrl.origin}${matrixPath}${search}`

  // Forward request headers, stripping hop-by-hop and internal ones
  const forwardHeaders = new Headers()
  request.headers.forEach((value, key) => {
    if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) {
      forwardHeaders.set(key, value)
    }
  })

  // Inject token from HttpOnly cookie if no Authorization header present
  if (!forwardHeaders.has('authorization')) {
    const cookieToken = request.cookies.get('matrix_token')?.value
    if (cookieToken) {
      forwardHeaders.set('authorization', `Bearer ${cookieToken}`)
    }
  }

  const isSync = matrixPath.includes('/sync')
  const isUpload = matrixPath.includes('/upload')
  const effectiveTimeout = isSync ? UPSTREAM_SYNC_TIMEOUT_MS : isUpload ? 120_000 : UPSTREAM_TIMEOUT_MS
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), effectiveTimeout)

  try {
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    // Buffer the body so it can be re-sent on redirects (ReadableStream is single-use)
    const bodyBuffer = hasBody ? await request.arrayBuffer() : null
    let currentUrl = targetUrl
    let response: Response | null = null
    const MAX_REDIRECTS = 5

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
      response = await fetch(currentUrl, {
        method: request.method,
        headers: forwardHeaders,
        body: bodyBuffer,
        redirect: 'manual',
        signal: controller.signal,
      })

      // Not a redirect — we're done
      if (response.status < 300 || response.status >= 400) break

      // Handle redirect: validate each hop for SSRF protection
      const location = response.headers.get('location')
      if (!location) {
        return NextResponse.json({ error: 'Redirect with no location' }, { status: 502 })
      }

      let redirectUrl: URL
      try {
        redirectUrl = new URL(location, currentUrl)
      } catch {
        return NextResponse.json({ error: 'Invalid redirect destination' }, { status: 502 })
      }

      if (redirectUrl.protocol !== 'https:') {
        return NextResponse.json({ error: 'Redirect to non-HTTPS blocked' }, { status: 502 })
      }
      if (await isPrivateHostResolved(redirectUrl.hostname)) {
        return NextResponse.json({ error: 'Redirect to private network blocked' }, { status: 502 })
      }

      if (redirectCount === MAX_REDIRECTS) {
        return NextResponse.json({ error: 'Too many redirects' }, { status: 502 })
      }

      currentUrl = redirectUrl.toString()
    }

    clearTimeout(timeout)
    return buildResponse(response!, matrixPath)
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } }
    console.error('[matrix-proxy] upstream error:',
      e?.name, e?.message,
      'cause:', e?.cause?.code, e?.cause?.message,
      'target:', targetUrl)
    return NextResponse.json(
      { error: 'Failed to reach homeserver', detail: e?.message || 'unknown' },
      { status: 502 }
    )
  } finally {
    clearTimeout(timeout)
  }
}

function buildResponse(upstreamResponse: Response, matrixPath: string): NextResponse {
  if (upstreamResponse.status === 404 && matrixPath.startsWith('/_matrix/client/v3/pushrules')) {
    return NextResponse.json({
      global: { override: [], underride: [], sender: [], room: [], content: [] },
    }, { status: 200 })
  }

  const responseHeaders = new Headers()
  upstreamResponse.headers.forEach((value, key) => {
    if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value)
    }
  })

  responseHeaders.set('x-content-type-options', 'nosniff')

  const isMediaDownload = (matrixPath.startsWith('/_matrix/media/') || matrixPath.startsWith('/_matrix/client/v1/media/')) && matrixPath.includes('/download')
  const isSyncOrAuth = matrixPath.includes('/sync') || matrixPath.includes('/login') || matrixPath.includes('/register') || matrixPath.includes('/logout')
  if (isMediaDownload) {
    responseHeaders.set('cache-control', 'public, max-age=31536000, immutable')
    responseHeaders.set('content-encoding', 'identity')
  } else if (isSyncOrAuth) {
    responseHeaders.set('cache-control', 'private, no-store')
  }

  return new NextResponse(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  })
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const DELETE = handler
export const PATCH = handler
export const OPTIONS = handler

// Allow Next.js to keep this route alive for longer (sync long-polls)
export const maxDuration = 65

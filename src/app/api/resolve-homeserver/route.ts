import { NextRequest, NextResponse } from 'next/server'
import { isPrivateHost } from '@/lib/ssrf'

/**
 * Server-side Matrix homeserver resolution.
 * Performs .well-known discovery server-side to avoid browser CORS issues
 * (e.g. when the .well-known host doesn't serve CORS headers, or when
 * a reverse proxy like Pangolin intercepts client-side requests).
 *
 * GET /api/resolve-homeserver?server=lukasz.com
 */
export async function GET(req: NextRequest) {
  const server = req.nextUrl.searchParams.get('server')
  if (!server || server.length > 512) {
    return NextResponse.json({ error: 'Missing or invalid server parameter' }, { status: 400 })
  }

  const cleaned = server.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  if (!cleaned || cleaned.includes('/') || cleaned.includes('\\')) {
    return NextResponse.json({ error: 'Invalid server name' }, { status: 400 })
  }

  // Block internal/private network addresses (SSRF protection)
  if (isPrivateHost(cleaned.split(':')[0].toLowerCase())) {
    return NextResponse.json({ error: 'Private/internal addresses are not allowed' }, { status: 400 })
  }

  const directUrl = `https://${cleaned}`

  // Run direct check and .well-known discovery in parallel for speed
  const [directResult, wellKnownResult] = await Promise.allSettled([
    checkDirect(directUrl),
    discoverWellKnown(directUrl),
  ])

  // Prefer .well-known result (more authoritative), fall back to direct
  if (wellKnownResult.status === 'fulfilled' && wellKnownResult.value) {
    return NextResponse.json(wellKnownResult.value)
  }
  if (directResult.status === 'fulfilled' && directResult.value) {
    return NextResponse.json(directResult.value)
  }

  return NextResponse.json({ homeserverUrl: directUrl, method: 'fallback' })
}

async function checkDirect(url: string): Promise<{ homeserverUrl: string; method: string } | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4_000)
    const res = await fetch(`${url}/_matrix/client/versions`, { signal: controller.signal, redirect: 'manual' })
    clearTimeout(timeout)
    // Block redirects to prevent SSRF
    if (res.status >= 300 && res.status < 400) return null
    if (res.ok) {
      const data = await res.json()
      if (data?.versions) {
        return { homeserverUrl: url, method: 'direct' }
      }
    }
  } catch { /* not a Matrix server */ }
  return null
}

async function discoverWellKnown(url: string): Promise<{ homeserverUrl: string; method: string } | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4_000)
    const res = await fetch(`${url}/.well-known/matrix/client`, { signal: controller.signal, redirect: 'manual' })
    clearTimeout(timeout)
    // Block redirects to prevent SSRF
    if (res.status >= 300 && res.status < 400) return null
    if (!res.ok) return null

    const data = await res.json()
    const base = data?.['m.homeserver']?.base_url
    if (!base) return null

    const cleanUrl = base.replace(/\/+$/, '')
    if (!cleanUrl.startsWith('https://')) return null

    // SSRF protection: validate resolved URL doesn't point to private networks
    try {
      const resolvedHostname = new URL(cleanUrl).hostname.toLowerCase()
      if (isPrivateHost(resolvedHostname)) return null
    } catch { return null }

    // Quick validation that the resolved URL serves Matrix API
    try {
      const vc = new AbortController()
      const vt = setTimeout(() => vc.abort(), 4_000)
      const vRes = await fetch(`${cleanUrl}/_matrix/client/versions`, { signal: vc.signal, redirect: 'manual' })
      clearTimeout(vt)
      // Block redirects to prevent SSRF
      if (vRes.status >= 300 && vRes.status < 400) return null
      if (vRes.ok) {
        const vData = await vRes.json()
        if (vData?.versions) {
          return { homeserverUrl: cleanUrl, method: 'well-known' }
        }
      }
    } catch { /* validation failed */ }

    // Validation failed — do not return unverified URLs
    return null
  } catch { /* discovery failed */ }
  return null
}

import { NextResponse, type NextRequest } from 'next/server'

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip middleware for static assets
  if (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/sw.js"
  ) {
    return NextResponse.next();
  }

  // CSP nonce logic
  const requestHeaders = new Headers(request.headers)

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  requestHeaders.set('x-nonce', nonce)

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: blob: data:",
    "media-src 'self' https: blob:",
    "connect-src 'self' https: wss:",
    "manifest-src 'self' https: blob:",
    "font-src 'self' https: data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)

  return response
}

export const config = {
  matcher: [
    "/",
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest\\.webmanifest|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff|woff2)).*)",
  ],
}

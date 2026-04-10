import { NextResponse, type NextRequest } from 'next/server'

const SESSION_SECRET = process.env.OTP_SESSION_SECRET || "";
const COOKIE_NAME = "app_otp_session";
const BASE_PATH = "/Messages";

async function verifySessionEdge(token: string, secret: string): Promise<{ email: string; expiresAt: number } | null> {
  if (!token || !secret) return null;
  const dotIdx = token.lastIndexOf(".");
  if (dotIdx === -1) return null;

  const payload = token.slice(0, dotIdx);
  const signature = token.slice(dotIdx + 1);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expectedSig = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

  if (signature !== expectedSig) return null;

  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const data = JSON.parse(json);
    if (!data.email || !data.expiresAt) return null;
    if (Date.now() > data.expiresAt) return null;
    return data;
  } catch { return null; }
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Never protect auth endpoints or static assets
  if (
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/sw.js"
  ) {
    return NextResponse.next();
  }

  // Check OTP session for all other routes (including /api/matrix-proxy/*)
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionEdge(token, SESSION_SECRET) : null;

  if (!session) {
    if (pathname.startsWith("/api/") || request.headers.get("accept")?.includes("application/json")) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    return NextResponse.redirect(new URL(BASE_PATH + "/api/auth/login", request.url));
  }

  // Existing CSP nonce logic
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

  // Set authenticated user email header
  requestHeaders.set('x-user-email', session.email)

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

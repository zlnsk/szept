import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests for the security features in the Matrix proxy route:
 * - CSRF validation on mutating requests
 * - Request body size limits
 * - Registration rate limiting
 *
 * These replicate the logic from the proxy route in a testable form,
 * following the same pattern as rate-limit.test.ts and proxy-route.test.ts.
 */

describe('proxy CSRF validation', () => {
  const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH'])

  function checkCsrf(method: string, origin: string | null, expectedOrigin: string): 'pass' | 'reject' {
    if (MUTATING_METHODS.has(method)) {
      if (origin && origin !== expectedOrigin) {
        return 'reject'
      }
    }
    return 'pass'
  }

  it('rejects POST with mismatched origin', () => {
    expect(checkCsrf('POST', 'https://evil.com', 'https://myapp.com')).toBe('reject')
  })

  it('rejects PUT with mismatched origin', () => {
    expect(checkCsrf('PUT', 'https://evil.com', 'https://myapp.com')).toBe('reject')
  })

  it('rejects DELETE with mismatched origin', () => {
    expect(checkCsrf('DELETE', 'https://evil.com', 'https://myapp.com')).toBe('reject')
  })

  it('rejects PATCH with mismatched origin', () => {
    expect(checkCsrf('PATCH', 'https://evil.com', 'https://myapp.com')).toBe('reject')
  })

  it('allows POST with matching origin', () => {
    expect(checkCsrf('POST', 'https://myapp.com', 'https://myapp.com')).toBe('pass')
  })

  it('allows POST with no origin header (same-origin requests may omit it)', () => {
    expect(checkCsrf('POST', null, 'https://myapp.com')).toBe('pass')
  })

  it('allows GET requests regardless of origin', () => {
    expect(checkCsrf('GET', 'https://evil.com', 'https://myapp.com')).toBe('pass')
  })

  it('allows HEAD requests regardless of origin', () => {
    expect(checkCsrf('HEAD', 'https://evil.com', 'https://myapp.com')).toBe('pass')
  })
})

describe('proxy body size limits', () => {
  const MAX_BODY_SIZE = 1 * 1024 * 1024         // 1 MB
  const MAX_MEDIA_BODY_SIZE = 100 * 1024 * 1024  // 100 MB

  function checkBodySize(contentLength: number | null, isMediaEndpoint: boolean): 'pass' | 'reject' {
    const maxSize = isMediaEndpoint ? MAX_MEDIA_BODY_SIZE : MAX_BODY_SIZE
    if (contentLength !== null && contentLength > maxSize) {
      return 'reject'
    }
    return 'pass'
  }

  it('rejects non-media request with Content-Length > 1 MB', () => {
    const overLimit = MAX_BODY_SIZE + 1
    expect(checkBodySize(overLimit, false)).toBe('reject')
  })

  it('allows non-media request with Content-Length exactly 1 MB', () => {
    expect(checkBodySize(MAX_BODY_SIZE, false)).toBe('pass')
  })

  it('allows non-media request with Content-Length under 1 MB', () => {
    expect(checkBodySize(1024, false)).toBe('pass')
  })

  it('rejects media request with Content-Length > 100 MB', () => {
    const overLimit = MAX_MEDIA_BODY_SIZE + 1
    expect(checkBodySize(overLimit, true)).toBe('reject')
  })

  it('allows media request with Content-Length exactly 100 MB', () => {
    expect(checkBodySize(MAX_MEDIA_BODY_SIZE, true)).toBe('pass')
  })

  it('allows media request with Content-Length under 100 MB', () => {
    expect(checkBodySize(50 * 1024 * 1024, true)).toBe('pass')
  })

  it('allows request with no Content-Length header', () => {
    expect(checkBodySize(null, false)).toBe('pass')
    expect(checkBodySize(null, true)).toBe('pass')
  })
})

describe('registration rate limiting', () => {
  const RATE_LIMIT_WINDOW_MS = 60_000
  const RATE_LIMIT_MAX_LOGIN = 5
  let rateLimitAttempts: Map<string, { count: number; windowStart: number }>

  function isRateLimited(ip: string, key: string): boolean {
    const now = Date.now()
    const mapKey = `${key}:${ip}`
    const entry = rateLimitAttempts.get(mapKey)
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitAttempts.set(mapKey, { count: 1, windowStart: now })
      return false
    }
    entry.count++
    if (entry.count > RATE_LIMIT_MAX_LOGIN) return true
    return false
  }

  beforeEach(() => {
    rateLimitAttempts = new Map()
  })

  it('allows first registration attempt', () => {
    expect(isRateLimited('1.2.3.4', 'register')).toBe(false)
  })

  it('allows up to max registration attempts', () => {
    for (let i = 0; i < RATE_LIMIT_MAX_LOGIN; i++) {
      expect(isRateLimited('1.2.3.4', 'register')).toBe(false)
    }
  })

  it('blocks registration after exceeding limit', () => {
    for (let i = 0; i < RATE_LIMIT_MAX_LOGIN; i++) {
      isRateLimited('1.2.3.4', 'register')
    }
    expect(isRateLimited('1.2.3.4', 'register')).toBe(true)
  })

  it('tracks login and register rate limits independently', () => {
    // Exhaust login limit
    for (let i = 0; i < RATE_LIMIT_MAX_LOGIN; i++) {
      isRateLimited('1.2.3.4', 'login')
    }
    expect(isRateLimited('1.2.3.4', 'login')).toBe(true)
    // Register should still be allowed for the same IP
    expect(isRateLimited('1.2.3.4', 'register')).toBe(false)
  })

  it('tracks different IPs independently for registration', () => {
    for (let i = 0; i < RATE_LIMIT_MAX_LOGIN; i++) {
      isRateLimited('1.2.3.4', 'register')
    }
    expect(isRateLimited('1.2.3.4', 'register')).toBe(true)
    expect(isRateLimited('5.6.7.8', 'register')).toBe(false)
  })

  it('resets registration limit after window expires', () => {
    const realNow = Date.now
    let mockTime = 1000000

    vi.spyOn(Date, 'now').mockImplementation(() => mockTime)

    for (let i = 0; i < RATE_LIMIT_MAX_LOGIN; i++) {
      isRateLimited('1.2.3.4', 'register')
    }
    expect(isRateLimited('1.2.3.4', 'register')).toBe(true)

    // Advance time past the window
    mockTime += RATE_LIMIT_WINDOW_MS + 1
    expect(isRateLimited('1.2.3.4', 'register')).toBe(false)

    Date.now = realNow
  })
})

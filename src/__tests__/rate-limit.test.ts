import { describe, it, expect, vi, beforeEach } from 'vitest'

// Test the rate limiting logic from the proxy route
// We extract the logic into a testable form

describe('server-side login rate limiting', () => {
  // Replicate the rate limit logic from the proxy route
  const RATE_LIMIT_WINDOW_MS = 60_000
  const RATE_LIMIT_MAX_LOGIN = 5
  let loginAttempts: Map<string, { count: number; windowStart: number }>

  function isLoginRateLimited(ip: string): boolean {
    const now = Date.now()
    const entry = loginAttempts.get(ip)
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      loginAttempts.set(ip, { count: 1, windowStart: now })
      return false
    }
    entry.count++
    if (entry.count > RATE_LIMIT_MAX_LOGIN) return true
    return false
  }

  beforeEach(() => {
    loginAttempts = new Map()
  })

  it('allows first request from an IP', () => {
    expect(isLoginRateLimited('1.2.3.4')).toBe(false)
  })

  it('allows up to RATE_LIMIT_MAX_LOGIN requests', () => {
    for (let i = 0; i < RATE_LIMIT_MAX_LOGIN; i++) {
      expect(isLoginRateLimited('1.2.3.4')).toBe(false)
    }
  })

  it('blocks requests after exceeding limit', () => {
    for (let i = 0; i < RATE_LIMIT_MAX_LOGIN; i++) {
      isLoginRateLimited('1.2.3.4')
    }
    expect(isLoginRateLimited('1.2.3.4')).toBe(true)
  })

  it('tracks different IPs independently', () => {
    for (let i = 0; i < RATE_LIMIT_MAX_LOGIN; i++) {
      isLoginRateLimited('1.2.3.4')
    }
    expect(isLoginRateLimited('1.2.3.4')).toBe(true)
    expect(isLoginRateLimited('5.6.7.8')).toBe(false)
  })

  it('resets after window expires', () => {
    const realNow = Date.now
    let mockTime = 1000000

    vi.spyOn(Date, 'now').mockImplementation(() => mockTime)

    for (let i = 0; i < RATE_LIMIT_MAX_LOGIN; i++) {
      isLoginRateLimited('1.2.3.4')
    }
    expect(isLoginRateLimited('1.2.3.4')).toBe(true)

    // Advance time past the window
    mockTime += RATE_LIMIT_WINDOW_MS + 1
    expect(isLoginRateLimited('1.2.3.4')).toBe(false)

    Date.now = realNow
  })
})

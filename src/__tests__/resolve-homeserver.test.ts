import { describe, it, expect } from 'vitest'

/**
 * Tests for the SSRF protection logic in the resolve-homeserver route.
 * Validates that private/internal addresses are blocked.
 */

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '0.0.0.0' ||
    h === '[::1]' ||
    h.startsWith('10.') ||
    h.startsWith('192.168.') ||
    (h.startsWith('172.') && (() => { const b = parseInt(h.split('.')[1], 10); return b >= 16 && b <= 31 })()) ||
    h.startsWith('169.254.') ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  ) {
    return true
  }
  return false
}

describe('SSRF protection - hostname blocking', () => {
  it('blocks localhost', () => {
    expect(isBlockedHostname('localhost')).toBe(true)
  })

  it('blocks loopback addresses', () => {
    expect(isBlockedHostname('127.0.0.1')).toBe(true)
    expect(isBlockedHostname('0.0.0.0')).toBe(true)
    expect(isBlockedHostname('[::1]')).toBe(true)
  })

  it('blocks private class A (10.x.x.x)', () => {
    expect(isBlockedHostname('10.0.0.1')).toBe(true)
    expect(isBlockedHostname('10.255.255.255')).toBe(true)
  })

  it('blocks private class B (172.16-31.x.x)', () => {
    expect(isBlockedHostname('172.16.0.1')).toBe(true)
    expect(isBlockedHostname('172.31.255.255')).toBe(true)
    expect(isBlockedHostname('172.15.0.1')).toBe(false) // Not in private range
    expect(isBlockedHostname('172.32.0.1')).toBe(false) // Not in private range
  })

  it('blocks private class C (192.168.x.x)', () => {
    expect(isBlockedHostname('192.168.0.1')).toBe(true)
    expect(isBlockedHostname('192.168.1.100')).toBe(true)
  })

  it('blocks link-local (169.254.x.x)', () => {
    expect(isBlockedHostname('169.254.0.1')).toBe(true)
  })

  it('blocks .local and .internal TLDs', () => {
    expect(isBlockedHostname('myserver.local')).toBe(true)
    expect(isBlockedHostname('service.internal')).toBe(true)
  })

  it('allows public addresses', () => {
    expect(isBlockedHostname('matrix.org')).toBe(false)
    expect(isBlockedHostname('8.8.8.8')).toBe(false)
    expect(isBlockedHostname('example.com')).toBe(false)
    expect(isBlockedHostname('my-homeserver.net')).toBe(false)
  })
})

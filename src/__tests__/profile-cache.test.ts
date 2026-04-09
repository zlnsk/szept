import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setProfileCache,
  getProfileCache,
  hasProfileCache,
  clearProfileCache,
} from '@/lib/profile-cache'

// Mock requestIdleCallback so deferred promotions run via setTimeout
if (typeof globalThis.requestIdleCallback === 'undefined') {
  (globalThis as any).requestIdleCallback = (cb: () => void) => setTimeout(cb, 0)
}

describe('profile-cache', () => {
  beforeEach(() => {
    clearProfileCache()
  })

  it('stores and retrieves values', () => {
    setProfileCache('@alice:server.com', 'mxc://server.com/abc')
    expect(getProfileCache('@alice:server.com')).toBe('mxc://server.com/abc')
  })

  it('returns undefined for missing keys', () => {
    expect(getProfileCache('@nonexistent:server.com')).toBeUndefined()
  })

  it('hasProfileCache returns true for existing keys', () => {
    setProfileCache('@bob:server.com', 'mxc://server.com/xyz')
    expect(hasProfileCache('@bob:server.com')).toBe(true)
  })

  it('hasProfileCache returns false for missing keys', () => {
    expect(hasProfileCache('@nobody:server.com')).toBe(false)
  })

  it('clearProfileCache empties the cache', () => {
    setProfileCache('@alice:server.com', 'mxc://a')
    setProfileCache('@bob:server.com', 'mxc://b')
    clearProfileCache()
    expect(getProfileCache('@alice:server.com')).toBeUndefined()
    expect(getProfileCache('@bob:server.com')).toBeUndefined()
    expect(hasProfileCache('@alice:server.com')).toBe(false)
  })

  it('setProfileCache overwrites existing entries', () => {
    setProfileCache('@alice:server.com', 'mxc://old')
    setProfileCache('@alice:server.com', 'mxc://new')
    expect(getProfileCache('@alice:server.com')).toBe('mxc://new')
  })

  it('stores empty string as negative cache entry', () => {
    setProfileCache('@noavatar:server.com', '')
    expect(getProfileCache('@noavatar:server.com')).toBe('')
    expect(hasProfileCache('@noavatar:server.com')).toBe(true)
  })

  it('evicts oldest entry when cache exceeds max size', () => {
    // The real max is 2000, so we insert 2001 entries and check the first is evicted
    for (let i = 0; i < 2001; i++) {
      setProfileCache(`@user${i}:server.com`, `mxc://v${i}`)
    }
    // First entry should have been evicted
    expect(getProfileCache('@user0:server.com')).toBeUndefined()
    // Last entry should still be present
    expect(getProfileCache('@user2000:server.com')).toBe('mxc://v2000')
    // An entry just inside the limit should still be present
    expect(getProfileCache('@user1:server.com')).toBe('mxc://v1')
  })

  it('overwriting an entry does not cause spurious eviction', () => {
    // Fill to near capacity, then overwrite one — should not evict
    for (let i = 0; i < 2000; i++) {
      setProfileCache(`@user${i}:server.com`, `mxc://v${i}`)
    }
    // Overwrite the first entry (should delete + re-insert, staying at 2000)
    setProfileCache('@user0:server.com', 'mxc://updated')
    expect(getProfileCache('@user0:server.com')).toBe('mxc://updated')
    // The second entry should NOT have been evicted since size stayed at 2000
    expect(getProfileCache('@user1:server.com')).toBe('mxc://v1')
  })
})

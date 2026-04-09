import { describe, it, expect } from 'vitest'

describe('LRU profile avatar cache', () => {
  // Replicate the LRU cache logic from chat-store
  function createLruCache(maxSize: number) {
    const cache = new Map<string, string>()

    function set(key: string, value: string) {
      if (cache.has(key)) {
        cache.delete(key)
      }
      cache.set(key, value)
      if (cache.size > maxSize) {
        const firstKey = cache.keys().next().value!
        cache.delete(firstKey)
      }
    }

    function get(key: string): string | undefined {
      const value = cache.get(key)
      if (value !== undefined) {
        cache.delete(key)
        cache.set(key, value)
      }
      return value
    }

    return { set, get, cache }
  }

  it('stores and retrieves values', () => {
    const lru = createLruCache(3)
    lru.set('a', '1')
    lru.set('b', '2')
    expect(lru.get('a')).toBe('1')
    expect(lru.get('b')).toBe('2')
  })

  it('evicts the least recently used entry on overflow', () => {
    const lru = createLruCache(3)
    lru.set('a', '1')
    lru.set('b', '2')
    lru.set('c', '3')
    // 'a' is oldest — adding 'd' should evict it
    lru.set('d', '4')
    expect(lru.get('a')).toBeUndefined()
    expect(lru.get('b')).toBe('2')
    expect(lru.get('c')).toBe('3')
    expect(lru.get('d')).toBe('4')
  })

  it('reading a key promotes it (not evicted next)', () => {
    const lru = createLruCache(3)
    lru.set('a', '1')
    lru.set('b', '2')
    lru.set('c', '3')
    // Read 'a' to promote it — now 'b' is least recently used
    lru.get('a')
    lru.set('d', '4')
    expect(lru.get('a')).toBe('1') // promoted, still present
    expect(lru.get('b')).toBeUndefined() // evicted (was LRU)
  })

  it('updating a key resets its position', () => {
    const lru = createLruCache(3)
    lru.set('a', '1')
    lru.set('b', '2')
    lru.set('c', '3')
    // Update 'a' — promotes it
    lru.set('a', 'updated')
    lru.set('d', '4')
    expect(lru.get('a')).toBe('updated')
    expect(lru.get('b')).toBeUndefined() // evicted
  })

  it('handles single-entry cache', () => {
    const lru = createLruCache(1)
    lru.set('a', '1')
    lru.set('b', '2')
    expect(lru.get('a')).toBeUndefined()
    expect(lru.get('b')).toBe('2')
  })
})

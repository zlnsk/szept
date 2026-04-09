import { describe, it, expect } from 'vitest'

/**
 * Tests for MXC URL parsing logic extracted from media.ts.
 */

function parseMxcUrl(mxcUrl: string): { serverName: string; mediaId: string } | null {
  const match = mxcUrl.match(/^mxc:\/\/([^/]+)\/(.+)$/)
  if (!match) return null
  return { serverName: match[1], mediaId: match[2] }
}

describe('parseMxcUrl', () => {
  it('parses valid mxc:// URLs', () => {
    const result = parseMxcUrl('mxc://matrix.org/AbCdEfGhIjK')
    expect(result).toEqual({
      serverName: 'matrix.org',
      mediaId: 'AbCdEfGhIjK',
    })
  })

  it('handles server names with ports', () => {
    const result = parseMxcUrl('mxc://localhost:8448/mediaId123')
    expect(result).toEqual({
      serverName: 'localhost:8448',
      mediaId: 'mediaId123',
    })
  })

  it('returns null for invalid URLs', () => {
    expect(parseMxcUrl('')).toBeNull()
    expect(parseMxcUrl('https://matrix.org/media')).toBeNull()
    expect(parseMxcUrl('mxc://')).toBeNull()
    expect(parseMxcUrl('mxc://server')).toBeNull()
    expect(parseMxcUrl('mxc://server/')).toBeNull()
  })

  it('handles media IDs with special characters', () => {
    const result = parseMxcUrl('mxc://example.com/abc-def_123.png')
    expect(result).toEqual({
      serverName: 'example.com',
      mediaId: 'abc-def_123.png',
    })
  })
})

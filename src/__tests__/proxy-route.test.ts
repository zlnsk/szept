import { describe, it, expect } from 'vitest'

/**
 * Tests for the Matrix proxy path allowlist logic.
 * These validate the path prefix check without needing to run the full Next.js server.
 */

const ALLOWED_MATRIX_PREFIXES = [
  '/_matrix/client/',
  '/_matrix/media/',
  '/_matrix/key/',
  '/_matrix/federation/',
]

function isPathAllowed(matrixPath: string): boolean {
  return ALLOWED_MATRIX_PREFIXES.some(prefix => matrixPath.startsWith(prefix))
}

describe('matrix proxy path validation', () => {
  it('allows /_matrix/client/ paths', () => {
    expect(isPathAllowed('/_matrix/client/v3/sync')).toBe(true)
    expect(isPathAllowed('/_matrix/client/v1/media/download/server/id')).toBe(true)
    expect(isPathAllowed('/_matrix/client/v3/pushrules')).toBe(true)
  })

  it('allows /_matrix/media/ paths', () => {
    expect(isPathAllowed('/_matrix/media/v3/download/server/id')).toBe(true)
    expect(isPathAllowed('/_matrix/media/v3/thumbnail/server/id')).toBe(true)
  })

  it('allows /_matrix/key/ paths', () => {
    expect(isPathAllowed('/_matrix/key/v2/server')).toBe(true)
  })

  it('allows /_matrix/federation/ paths', () => {
    expect(isPathAllowed('/_matrix/federation/v1/version')).toBe(true)
  })

  it('blocks non-matrix paths', () => {
    expect(isPathAllowed('/admin')).toBe(false)
    expect(isPathAllowed('/etc/passwd')).toBe(false)
    expect(isPathAllowed('/_matrix/')).toBe(false)
    expect(isPathAllowed('/_matrix')).toBe(false)
  })

  it('blocks /_matrix/ without a valid sub-path', () => {
    expect(isPathAllowed('/_matrix/unknown/v1/foo')).toBe(false)
    expect(isPathAllowed('/_matrix/admin/')).toBe(false)
    expect(isPathAllowed('/_matrix/../etc/passwd')).toBe(false)
  })
})

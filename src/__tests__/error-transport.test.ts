import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reportError, getErrorLog, clearErrorLog, setErrorTransport } from '@/lib/error-reporter'
import type { ErrorEntry } from '@/lib/error-reporter'

describe('error transport', () => {
  beforeEach(() => {
    clearErrorLog()
    setErrorTransport(null)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('calls external transport when set', () => {
    const transport = vi.fn()
    setErrorTransport(transport)

    reportError('crypto', new Error('test error'))

    expect(transport).toHaveBeenCalledTimes(1)
    const entry: ErrorEntry = transport.mock.calls[0][0]
    expect(entry.category).toBe('crypto')
    expect(entry.message).toBe('test error')
  })

  it('does not call transport when not set', () => {
    // No transport set — should not throw
    expect(() => reportError('test', 'no transport')).not.toThrow()
  })

  it('does not propagate transport errors', () => {
    const badTransport = vi.fn(() => { throw new Error('transport failed') })
    setErrorTransport(badTransport)

    // Should not throw even if transport fails
    expect(() => reportError('test', 'error')).not.toThrow()
    expect(badTransport).toHaveBeenCalled()
  })

  it('still stores errors locally when transport is set', () => {
    const transport = vi.fn()
    setErrorTransport(transport)

    reportError('media', 'fetch failed')

    const log = getErrorLog()
    expect(log).toHaveLength(1)
    expect(log[0].message).toBe('fetch failed')
  })

  it('can clear transport by setting null', () => {
    const transport = vi.fn()
    setErrorTransport(transport)
    reportError('test', 'first')
    expect(transport).toHaveBeenCalledTimes(1)

    setErrorTransport(null)
    reportError('test', 'second')
    expect(transport).toHaveBeenCalledTimes(1) // not called again
  })
})

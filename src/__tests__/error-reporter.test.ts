import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reportError, getErrorLog, clearErrorLog } from '@/lib/error-reporter'

describe('error-reporter', () => {
  beforeEach(() => {
    clearErrorLog()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('captures and stores errors', () => {
    reportError('crypto', new Error('Crypto init failed'))

    const log = getErrorLog()
    expect(log).toHaveLength(1)
    expect(log[0].category).toBe('crypto')
    expect(log[0].message).toBe('Crypto init failed')
    expect(log[0].stack).toBeDefined()
    expect(log[0].timestamp).toBeDefined()
  })

  it('handles string errors', () => {
    reportError('sync', 'Sync timeout')

    const log = getErrorLog()
    expect(log).toHaveLength(1)
    expect(log[0].message).toBe('Sync timeout')
    expect(log[0].stack).toBeUndefined()
  })

  it('limits log size to 50 entries', () => {
    for (let i = 0; i < 60; i++) {
      reportError('test', `Error ${i}`)
    }

    const log = getErrorLog()
    expect(log.length).toBeLessThanOrEqual(50)
    expect(log[log.length - 1].message).toBe('Error 59')
  })

  it('persists to localStorage', () => {
    reportError('media', new Error('Media fetch failed'))

    const stored = localStorage.getItem('matrix_error_log')
    expect(stored).toBeTruthy()
    const parsed = JSON.parse(stored!)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].category).toBe('media')
  })

  it('clears the log', () => {
    reportError('test', 'error 1')
    reportError('test', 'error 2')
    expect(getErrorLog()).toHaveLength(2)

    clearErrorLog()
    expect(getErrorLog()).toHaveLength(0)
    expect(localStorage.getItem('matrix_error_log')).toBeNull()
  })

  it('returns a copy of the log (immutable)', () => {
    reportError('test', 'error 1')
    const log1 = getErrorLog()
    const log2 = getErrorLog()
    expect(log1).not.toBe(log2)
    expect(log1).toEqual(log2)
  })
})

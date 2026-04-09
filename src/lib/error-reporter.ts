/**
 * Lightweight error reporting utility.
 *
 * Captures critical errors (crypto init failures, sync errors, unhandled rejections)
 * and stores them in memory + localStorage for debugging. In production, this can be
 * extended to send reports to an external service (Sentry, etc.).
 *
 * Usage:
 *   import { reportError, getErrorLog } from '@/lib/error-reporter'
 *   reportError('crypto', new Error('Crypto init failed'))
 *   const log = getErrorLog() // returns recent errors
 */

export interface ErrorEntry {
  timestamp: string
  category: string
  message: string
  stack?: string
}

export type ErrorTransport = (entry: ErrorEntry) => void

const MAX_LOG_SIZE = 50
const STORAGE_KEY = 'matrix_error_log'

let errorLog: ErrorEntry[] = []
let externalTransport: ErrorTransport | null = null

/**
 * Set an external transport for error reporting (e.g. Sentry, custom endpoint).
 * The transport receives every error entry after it's been logged locally.
 */
export function setErrorTransport(transport: ErrorTransport | null): void {
  externalTransport = transport
}

// Restore from localStorage on init
if (typeof window !== 'undefined') {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) errorLog = JSON.parse(stored)
  } catch { /* ignore */ }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(errorLog.slice(-MAX_LOG_SIZE)))
  } catch { /* ignore — quota exceeded or unavailable */ }
}

/**
 * Report an error for diagnostic purposes.
 * @param category - Error category (e.g. 'crypto', 'sync', 'voip', 'media')
 * @param error - The error object or message
 */
export function reportError(category: string, error: unknown): void {
  const entry: ErrorEntry = {
    timestamp: new Date().toISOString(),
    category,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  }

  errorLog.push(entry)
  if (errorLog.length > MAX_LOG_SIZE) {
    errorLog = errorLog.slice(-MAX_LOG_SIZE)
  }

  persist()

  // Always log to console for DevTools visibility
  console.error(`[${category}]`, error)

  // Forward to external transport if configured
  if (externalTransport) {
    try { externalTransport(entry) } catch { /* avoid recursive error reporting */ }
  }
}

/**
 * Get the stored error log for debugging.
 */
export function getErrorLog(): ErrorEntry[] {
  return [...errorLog]
}

/**
 * Clear the error log.
 */
export function clearErrorLog(): void {
  errorLog = []
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}

/**
 * Install global unhandled error/rejection handlers.
 * Call once during app initialization.
 */
let globalHandlersInstalled = false

export function installGlobalErrorHandlers(): void {
  if (typeof window === 'undefined' || globalHandlersInstalled) return
  globalHandlersInstalled = true

  window.addEventListener('error', (event) => {
    reportError('unhandled', event.error || event.message)
  })

  window.addEventListener('unhandledrejection', (event) => {
    reportError('unhandled-promise', event.reason)
  })
}

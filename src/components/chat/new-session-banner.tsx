'use client'

import { useState, useEffect } from 'react'
import { ShieldAlert, Monitor, Key, Loader2, X, CheckCircle } from 'lucide-react'

interface NewSessionBannerProps {
  onVerifyWithSession: () => void
  onVerifyWithKey: (key: string) => Promise<void>
  onDismiss: () => void
  sessionVerifyError?: string | null
}

export function NewSessionBanner({ onVerifyWithSession, onVerifyWithKey, onDismiss, sessionVerifyError }: NewSessionBannerProps) {
  const [mode, setMode] = useState<'prompt' | 'key'>('prompt')
  const [securityKey, setSecurityKey] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Auto-switch to key mode when session verification fails
  useEffect(() => {
    if (sessionVerifyError) {
      setMode('key')
      setError(sessionVerifyError)
    }
  }, [sessionVerifyError])

  const handleKeySubmit = async () => {
    if (!securityKey.trim()) return
    setIsVerifying(true)
    setError(null)
    try {
      await onVerifyWithKey(securityKey)
      setIsVerifying(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid security key')
      setIsVerifying(false)
    }
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-40 animate-slide-in" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="mx-auto max-w-2xl px-4 pt-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-lg dark:border-amber-800/50 dark:bg-amber-900/30">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                Verify this session
              </h3>

              {mode === 'prompt' && (
                <>
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-300/80">
                    This session is not verified. Verify to access encrypted message history and prove your identity to other users.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={onVerifyWithSession}
                      className="flex items-center gap-1.5 rounded-lg bg-m3-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-m3-primary"
                    >
                      <Monitor className="h-3.5 w-3.5" />
                      Verify from another session
                    </button>
                    <button
                      onClick={() => setMode('key')}
                      className="flex items-center gap-1.5 rounded-lg bg-m3-surface-container-highest px-3 py-1.5 text-xs font-medium text-m3-on-surface transition-colors hover:bg-m3-outline-variant dark:bg-m3-surface-container-high dark:hover:bg-m3-surface-container-highest"
                    >
                      <Key className="h-3.5 w-3.5" />
                      Use security key
                    </button>
                  </div>
                </>
              )}

              {mode === 'key' && (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={securityKey}
                    onChange={e => { setSecurityKey(e.target.value); setError(null) }}
                    placeholder="Enter your security key (EsTC j9gP noRq ...)"
                    rows={2}
                    className="w-full rounded-lg border border-amber-200 bg-m3-surface-container-lowest px-3 py-2 font-mono text-xs text-m3-on-surface placeholder-m3-outline focus:border-m3-primary focus:outline-none focus:ring-1 focus:ring-m3-primary dark:border-amber-800 dark:bg-m3-surface-container dark:text-m3-on-surface dark:placeholder-m3-outline"
                  />
                  {error && <p className="text-xs text-m3-error dark:text-m3-error">{error}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={handleKeySubmit}
                      disabled={isVerifying || !securityKey.trim()}
                      className="flex items-center gap-1.5 rounded-lg bg-m3-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-m3-primary disabled:opacity-50"
                    >
                      {isVerifying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                      {isVerifying ? 'Verifying...' : 'Verify'}
                    </button>
                    <button
                      onClick={() => { setMode('prompt'); setError(null) }}
                      className="rounded-lg bg-m3-surface-container-high px-3 py-1.5 text-xs font-medium text-m3-on-surface transition-colors hover:bg-m3-outline-variant dark:bg-m3-surface-container-highest dark:text-m3-on-surface-variant dark:hover:bg-m3-surface-container-highest"
                    >
                      Back
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={onDismiss}
              className="flex-shrink-0 rounded p-1 text-amber-400 transition-colors hover:text-amber-600 dark:hover:text-amber-200"
              title="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { resolveHomeserver } from '@/lib/matrix/client'
import { Eye, EyeOff, Loader2, Server, CheckCircle, AlertCircle } from 'lucide-react'

// Rate limiting state persisted in sessionStorage so it survives page refreshes
// but not tab/browser close (intentional — lockout is per-session)
function getRateLimitState(): { failedAttempts: number; lockoutUntil: number } {
  if (typeof window === 'undefined') return { failedAttempts: 0, lockoutUntil: 0 }
  try {
    const raw = sessionStorage.getItem('matrix_login_ratelimit')
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { failedAttempts: 0, lockoutUntil: 0 }
}

function setRateLimitState(failedAttempts: number, lockoutUntil: number): void {
  try {
    sessionStorage.setItem('matrix_login_ratelimit', JSON.stringify({ failedAttempts, lockoutUntil }))
  } catch { /* ignore */ }
}

function mapAuthError(err: unknown, isRegister: boolean): string {
  const msg = err instanceof Error ? err.message : String(err)
  // Registration-specific errors (pass through our custom messages)
  if (msg.includes('Username is already taken')) return msg
  if (msg.includes('Invalid username')) return msg
  if (msg.includes('This username is reserved')) return msg
  if (msg.includes('Registration is disabled')) return msg
  if (msg.includes('This server requires additional verification')) return msg
  // Login errors
  if (msg.includes('M_FORBIDDEN') || msg.includes('Invalid password') || msg.includes('403'))
    return 'Incorrect username or password'
  if (msg.includes('M_USER_DEACTIVATED'))
    return 'This account has been deactivated'
  if (msg.includes('M_LIMIT_EXCEEDED'))
    return 'Too many requests — please wait and try again'
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ERR_'))
    return 'Cannot reach the homeserver — check the address and your connection'
  if (msg.includes('M_UNKNOWN_TOKEN'))
    return 'Session expired — please sign in again'
  if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED'))
    return 'Homeserver not found — check the address'
  return isRegister
    ? 'Registration failed. Please check your details and try again.'
    : 'Sign-in failed. Please check your credentials and try again.'
}

const MAX_INPUT_LENGTH = 512

type LoginStep = 'idle' | 'resolving' | 'authenticating' | 'syncing' | 'done' | 'error'

const STEP_LABELS: Record<LoginStep, string> = {
  idle: '',
  resolving: 'Resolving homeserver...',
  authenticating: 'Authenticating...',
  syncing: 'Starting sync...',
  done: 'Connected!',
  error: 'Sign-in failed',
}

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loginStep, setLoginStep] = useState<LoginStep>('idle')
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  const { signIn, signUp } = useAuthStore()
  const router = useRouter()

  const isRegister = mode === 'register'
  const isLoading = loginStep !== 'idle' && loginStep !== 'error'

  // Auto-focus the server input on mount
  useEffect(() => {
    const input = document.querySelector<HTMLInputElement>('input[placeholder="matrix.org"]')
    input?.focus()
  }, [])

  const handleServerBlur = useCallback(async () => {
    const s = server.trim()
    if (!s) {
      setResolvedUrl(null)
      return
    }
    setIsResolving(true)
    try {
      const url = await resolveHomeserver(s)
      setResolvedUrl(url)
    } catch {
      setResolvedUrl(null)
    } finally {
      setIsResolving(false)
    }
  }, [server])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Rate limiting — exponential backoff after failed attempts (persisted in sessionStorage)
    const rateLimit = getRateLimitState()
    const now = Date.now()
    if (rateLimit.lockoutUntil > now) {
      const secs = Math.ceil((rateLimit.lockoutUntil - now) / 1000)
      setError(`Too many failed attempts. Please wait ${secs}s before trying again.`)
      return
    }

    const s = server.trim()
    if (!s) {
      setError('Please enter a homeserver address')
      return
    }

    if (isRegister && password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (isRegister && password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    try {
      // Step 1: Resolve homeserver
      setLoginStep('resolving')
      const homeserverUrl = resolvedUrl || await resolveHomeserver(s)

      // Step 2: Authenticate or Register
      setLoginStep('authenticating')
      if (isRegister) {
        await signUp(username, password, homeserverUrl)
      } else {
        await signIn(username, password, homeserverUrl)
      }
      setRateLimitState(0, 0)

      // Step 3: Sync
      setLoginStep('syncing')

      // Step 4: Done — navigate immediately
      setLoginStep('done')
      router.push('/')
    } catch (err) {
      const rl = getRateLimitState()
      const newAttempts = rl.failedAttempts + 1
      let newLockout = 0
      if (newAttempts >= 3) {
        const delay = Math.min(2000 * Math.pow(2, newAttempts - 3), 30000)
        newLockout = Date.now() + delay
      }
      setRateLimitState(newAttempts, newLockout)
      setLoginStep('error')
      setError(mapAuthError(err, isRegister))
      // Reset to idle after showing error
      setTimeout(() => setLoginStep('idle'), 100)
    }
  }

  const serverDomain = server.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '') || null

  const progressPercent = loginStep === 'resolving' ? 25 : loginStep === 'authenticating' ? 55 : loginStep === 'syncing' ? 85 : loginStep === 'done' ? 100 : 0

  return (
    <div className="fixed inset-0 flex bg-m3-surface" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {/* Top progress bar */}
      {isLoading && (
        <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-m3-surface-container-high">
          <div
            className="h-full bg-m3-primary transition-all duration-700 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}

      {/* Left branding panel */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[560px] flex-col justify-between bg-[#6359dc] p-12 text-white">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
              <svg width="28" height="28" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M138 62 L83 62 L83 450 L138 450" stroke="white" strokeWidth="28" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M374 62 L429 62 L429 450 L374 450" stroke="white" strokeWidth="28" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="198" cy="178" r="21" fill="white"/>
                <circle cx="256" cy="178" r="21" fill="white"/>
                <circle cx="314" cy="178" r="21" fill="white"/>
                <circle cx="198" cy="256" r="21" fill="white" opacity="0.55"/>
                <circle cx="256" cy="256" r="32" fill="white"/>
                <circle cx="314" cy="256" r="21" fill="white" opacity="0.55"/>
                <circle cx="198" cy="334" r="21" fill="white" opacity="0.25"/>
                <circle cx="256" cy="334" r="21" fill="white" opacity="0.42"/>
                <circle cx="314" cy="334" r="21" fill="white" opacity="0.25"/>
              </svg>
            </div>
            <span className="text-2xl tracking-tight">Messages</span>
          </div>
          <p className="mt-6 text-lg font-medium leading-relaxed text-white/90">
            A modern Matrix client with end-to-end encryption, built for speed and privacy.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-white/60">
            Connect to any Matrix homeserver. Your messages, your data, your rules.
          </p>
        </div>

        {/* Decorative dots grid */}
        <div className="mt-auto pt-16">
          <div className="grid grid-cols-8 gap-3 opacity-20">
            {Array.from({ length: 32 }).map((_, i) => (
              <div key={i} className="h-2 w-2 rounded-full bg-white" />
            ))}
          </div>
        </div>

        <p className="mt-8 text-[11px] text-white/40 select-all">
          v{process.env.NEXT_PUBLIC_BUILD_VERSION}
        </p>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 sm:px-12">
        <div className="w-full max-w-[400px]">
          {/* Mobile logo */}
          <div className="mb-10 flex flex-col items-center lg:hidden">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#6359dc] shadow-lg shadow-[#6359dc]/25">
              <svg width="36" height="36" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M138 62 L83 62 L83 450 L138 450" stroke="white" strokeWidth="28" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M374 62 L429 62 L429 450 L374 450" stroke="white" strokeWidth="28" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="198" cy="178" r="21" fill="white"/>
                <circle cx="256" cy="178" r="21" fill="white"/>
                <circle cx="314" cy="178" r="21" fill="white"/>
                <circle cx="198" cy="256" r="21" fill="white" opacity="0.55"/>
                <circle cx="256" cy="256" r="32" fill="white"/>
                <circle cx="314" cy="256" r="21" fill="white" opacity="0.55"/>
                <circle cx="198" cy="334" r="21" fill="white" opacity="0.25"/>
                <circle cx="256" cy="334" r="21" fill="white" opacity="0.42"/>
                <circle cx="314" cy="334" r="21" fill="white" opacity="0.25"/>
              </svg>
            </div>
            <h1 className="mt-4 text-3xl tracking-tight text-m3-on-surface">Messages</h1>
          </div>

          {/* Desktop heading */}
          <div className="mb-8 hidden lg:block">
            <h1 className="text-3xl font-extrabold tracking-tight text-m3-on-surface">
              {isRegister ? 'Create account' : 'Sign in'}
            </h1>
            <p className="mt-2 text-sm text-m3-on-surface-variant">
              {isRegister ? 'Register on any Matrix homeserver' : 'Connect to your Matrix homeserver'}
            </p>
          </div>

          {/* Mobile heading */}
          <div className="mb-6 lg:hidden text-center">
            <p className="text-sm text-m3-on-surface-variant">
              {isRegister ? 'Register on any Matrix homeserver' : 'Sign in to any Matrix homeserver'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5" autoComplete="on">
            {error && (
              <div className="flex items-start gap-3 rounded-2xl border border-m3-error/20 bg-m3-error-container px-4 py-3 text-sm text-m3-error dark:border-m3-error/30 dark:bg-m3-error-container animate-slide-in">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Homeserver */}
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-m3-on-surface-variant">
                Homeserver
              </label>
              <div className="relative">
                <Server className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-m3-outline" />
                <input
                  type="text"
                  value={server}
                  onChange={e => { setServer(e.target.value.slice(0, MAX_INPUT_LENGTH)); setResolvedUrl(null) }}
                  onBlur={handleServerBlur}
                  placeholder="matrix.org"
                  maxLength={MAX_INPUT_LENGTH}
                  required
                  className="w-full rounded-2xl border border-m3-outline-variant bg-m3-surface-container-low py-3.5 pl-11 pr-4 text-sm text-m3-on-surface placeholder-m3-outline transition-all focus:border-m3-primary focus:outline-none focus:ring-2 focus:ring-m3-primary/20 dark:border-m3-outline-variant dark:bg-m3-surface-container-high dark:text-m3-on-surface dark:placeholder-m3-outline"
                />
                {isResolving && (
                  <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-m3-outline" />
                )}
              </div>
              {resolvedUrl && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                  <CheckCircle className="h-3 w-3" />
                  {resolvedUrl}
                </p>
              )}
            </div>

            {/* Username */}
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-m3-on-surface-variant">
                Username
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-medium text-m3-on-surface-variant">@</span>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value.slice(0, MAX_INPUT_LENGTH))}
                  placeholder="username"
                  maxLength={MAX_INPUT_LENGTH}
                  required
                  autoComplete="username"
                  className="w-full rounded-2xl border border-m3-outline-variant bg-m3-surface-container-low py-3.5 pl-9 pr-4 text-sm text-m3-on-surface placeholder-m3-outline transition-all focus:border-m3-primary focus:outline-none focus:ring-2 focus:ring-m3-primary/20 dark:border-m3-outline-variant dark:bg-m3-surface-container-high dark:text-m3-on-surface dark:placeholder-m3-outline"
                />
              </div>
              {serverDomain && (
                <p className="mt-1.5 text-xs text-m3-on-surface-variant">
                  e.g. user for @user:{serverDomain}
                </p>
              )}
            </div>

            {/* Password */}
            <div>
              <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-m3-on-surface-variant">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value.slice(0, MAX_INPUT_LENGTH))}
                  placeholder="Enter your password"
                  maxLength={MAX_INPUT_LENGTH}
                  required
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  className="w-full rounded-2xl border border-m3-outline-variant bg-m3-surface-container-low px-4 py-3.5 pr-12 text-sm text-m3-on-surface placeholder-m3-outline transition-all focus:border-m3-primary focus:outline-none focus:ring-2 focus:ring-m3-primary/20 dark:border-m3-outline-variant dark:bg-m3-surface-container-high dark:text-m3-on-surface dark:placeholder-m3-outline"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-m3-outline transition-colors hover:text-m3-on-surface-variant"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Confirm password (register only) */}
            {isRegister && (
              <div>
                <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-m3-on-surface-variant">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value.slice(0, MAX_INPUT_LENGTH))}
                    placeholder="Confirm your password"
                    maxLength={MAX_INPUT_LENGTH}
                    required
                    autoComplete="new-password"
                    className="w-full rounded-2xl border border-m3-outline-variant bg-m3-surface-container-low px-4 py-3.5 pr-12 text-sm text-m3-on-surface placeholder-m3-outline transition-all focus:border-m3-primary focus:outline-none focus:ring-2 focus:ring-m3-primary/20 dark:border-m3-outline-variant dark:bg-m3-surface-container-high dark:text-m3-on-surface dark:placeholder-m3-outline"
                  />
                </div>
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-m3-primary px-4 py-3.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-m3-primary/90 hover:shadow-md active:shadow-sm disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {STEP_LABELS[loginStep]}
                </>
              ) : (
                isRegister ? 'Create account' : 'Sign in'
              )}
            </button>

            {/* Login progress steps */}
            {isLoading && (
              <div className="flex items-center justify-center gap-4 pt-1 animate-fade-in">
                <StepDot active={loginStep === 'resolving'} done={progressPercent > 25} label="Server" />
                <div className="h-px w-6 bg-m3-outline-variant" />
                <StepDot active={loginStep === 'authenticating'} done={progressPercent > 55} label="Auth" />
                <div className="h-px w-6 bg-m3-outline-variant" />
                <StepDot active={loginStep === 'syncing'} done={progressPercent >= 100} label="Sync" />
              </div>
            )}
          </form>

          {/* Mode toggle */}
          <p className="mt-6 text-center text-sm text-m3-on-surface-variant">
            {isRegister ? (
              <>Already have an account?{' '}
                <button type="button" onClick={() => { setMode('login'); setError(''); setConfirmPassword('') }} className="font-medium text-m3-primary hover:underline">
                  Sign in
                </button>
              </>
            ) : (
              <>Don&apos;t have an account?{' '}
                <button type="button" onClick={() => { setMode('register'); setError('') }} className="font-medium text-m3-primary hover:underline">
                  Create one
                </button>
              </>
            )}
          </p>

          {/* Security badge & version (mobile) */}
          <div className="mt-4 flex flex-col items-center gap-2 lg:hidden">
            <p className="text-[10px] text-m3-outline select-all">
              v{process.env.NEXT_PUBLIC_BUILD_VERSION}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`flex h-6 w-6 items-center justify-center rounded-full transition-all duration-300 ${
        done ? 'bg-green-500 text-white' : active ? 'bg-m3-primary text-white' : 'bg-m3-surface-container-high text-m3-outline'
      }`}>
        {done ? (
          <CheckCircle className="h-3.5 w-3.5" />
        ) : active ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <div className="h-1.5 w-1.5 rounded-full bg-current" />
        )}
      </div>
      <span className={`text-[10px] ${active ? 'text-m3-primary font-medium' : done ? 'text-green-600 dark:text-green-400' : 'text-m3-outline'}`}>
        {label}
      </span>
    </div>
  )
}

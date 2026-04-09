import { create } from 'zustand'
import {
  loginWithPassword,
  registerAccount,
  restoreSession,
  startSync,
  logout,
  getAvatarUrl,
  getUserId,
} from '@/lib/matrix/client'
import { useChatStore } from './chat-store'
import { useCallStore } from './call-store'

// H-5: Session idle timeout — auto-logout after inactivity
const IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000 // 8 hours
let idleTimer: ReturnType<typeof setTimeout> | null = null
let idleListenersAttached = false

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    const state = useAuthStore.getState()
    if (state.isAuthenticated) {
      console.warn('Session idle timeout — logging out')
      state.signOut().catch(() => {}).finally(() => {
        window.location.href = '/Messages/login'
      })
    }
  }, IDLE_TIMEOUT_MS)
}

function attachIdleListeners() {
  if (idleListenersAttached || typeof window === 'undefined') return
  idleListenersAttached = true
  // Only reset on active user intent — mousemove/scroll are passive and should not extend the session
  const events = ['mousedown', 'keydown', 'touchstart', 'click'] as const
  events.forEach(evt => window.addEventListener(evt, resetIdleTimer, { passive: true }))
  resetIdleTimer()
}

function detachIdleListeners() {
  if (!idleListenersAttached || typeof window === 'undefined') return
  idleListenersAttached = false
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
  const events = ['mousedown', 'keydown', 'touchstart', 'click'] as const
  events.forEach(evt => window.removeEventListener(evt, resetIdleTimer))
}

export interface MatrixUser {
  userId: string
  displayName: string
  avatarUrl: string | null
}

interface AuthState {
  user: MatrixUser | null
  isLoading: boolean
  isAuthenticated: boolean

  initialize: () => Promise<void>
  signIn: (username: string, password: string, homeserverUrl: string) => Promise<void>
  signUp: (username: string, password: string, homeserverUrl: string) => Promise<void>
  signOut: () => Promise<void>
  updateProfile: (updates: { displayName?: string; avatarUrl?: string }) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,

  initialize: async () => {
    const client = restoreSession()
    if (client) {
      try {
        await startSync()
        const userId = getUserId()
        const matrixUser = client.getUser(userId!)
        set({
          user: {
            userId: userId!,
            displayName: matrixUser?.displayName || userId!,
            avatarUrl: getAvatarUrl(matrixUser?.avatarUrl),
          },
          isAuthenticated: true,
          isLoading: false,
        })
        attachIdleListeners()
      } catch {
        // Session expired or invalid
        localStorage.removeItem('matrix_session')
        set({ isLoading: false })
      }
    } else {
      set({ isLoading: false })
    }
  },

  signIn: async (username, password, homeserverUrl) => {
    const client = await loginWithPassword(username, password, homeserverUrl)
    await startSync()
    const userId = getUserId()
    const matrixUser = client.getUser(userId!)
    set({
      user: {
        userId: userId!,
        displayName: matrixUser?.displayName || userId!,
        avatarUrl: getAvatarUrl(matrixUser?.avatarUrl),
      },
      isAuthenticated: true,
      isLoading: false,
    })
    attachIdleListeners()
  },

  signUp: async (username, password, homeserverUrl) => {
    const client = await registerAccount(username, password, homeserverUrl)
    await startSync()
    const userId = getUserId()
    const matrixUser = client.getUser(userId!)
    set({
      user: {
        userId: userId!,
        displayName: matrixUser?.displayName || userId!,
        avatarUrl: getAvatarUrl(matrixUser?.avatarUrl),
      },
      isAuthenticated: true,
      isLoading: false,
    })
    attachIdleListeners()
  },

  signOut: async () => {
    detachIdleListeners()
    await logout()
    // Clear all stores to prevent cross-session data leakage
    useChatStore.getState().resetState()
    useCallStore.getState().reset()
    set({ user: null, isAuthenticated: false })
  },

  updateProfile: (updates) => {
    set((state) => ({
      user: state.user
        ? {
            ...state.user,
            ...(updates.displayName !== undefined && { displayName: updates.displayName }),
            ...(updates.avatarUrl !== undefined && { avatarUrl: updates.avatarUrl }),
          }
        : null,
    }))
  },
}))

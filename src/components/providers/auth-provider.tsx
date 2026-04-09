'use client'

import { useEffect, type ReactNode } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { installGlobalErrorHandlers } from '@/lib/error-reporter'

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialize = useAuthStore(s => s.initialize)
  const isLoading = useAuthStore(s => s.isLoading)

  useEffect(() => {
    installGlobalErrorHandlers()
    initialize()
  }, [initialize])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-m3-surface dark:bg-m3-surface">
        <div className="flex flex-col items-center gap-4">
          <div className="relative h-12 w-12">
            <div className="absolute inset-0 rounded-full border-2 border-m3-primary/30" />
            <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-m3-primary" />
          </div>
          <p className="text-sm text-m3-on-surface-variant">Connecting...</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

'use client'

import { useAuthStore } from '@/stores/auth-store'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { ChatLayout } from '@/components/chat/chat-layout'

function LoadingSpinner() {
  return (
    <div className="min-h-dvh flex items-center justify-center" role="status" aria-label="Loading">
      <div className="spinner" />
    </div>
  )
}

export default function HomePage() {
  const { isAuthenticated, isLoading } = useAuthStore()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login')
    }
  }, [isAuthenticated, isLoading, router])

  if (isLoading) return <LoadingSpinner />
  if (!isAuthenticated) return null

  return <ChatLayout />
}

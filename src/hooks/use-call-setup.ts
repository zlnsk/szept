'use client'

import { useEffect } from 'react'
import { setupIncomingCallListener } from '@/lib/matrix/voip'

/**
 * Hook that sets up the incoming VoIP call listener.
 */
export function useCallSetup(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return

    const cleanup = setupIncomingCallListener()

    return () => {
      cleanup?.()
    }
  }, [userId])
}

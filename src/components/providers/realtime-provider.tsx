'use client'

import { useEffect, useState, useCallback, type ReactNode } from 'react'
import { getMatrixClient, getCrossSigningStatus, requestSelfVerification, restoreFromRecoveryKey } from '@/lib/matrix/client'
import { useAuthStore } from '@/stores/auth-store'
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api/CryptoEvent'
import type { VerificationRequest } from 'matrix-js-sdk/lib/crypto-api/verification'
import { VerificationDialog } from '@/components/chat/verification-dialog'
import { CallOverlay } from '@/components/chat/call-overlay'
import { NewSessionBanner } from '@/components/chat/new-session-banner'
import { useTimelineSync } from '@/hooks/use-timeline-sync'
import { useTypingIndicators } from '@/hooks/use-typing-indicators'
import { useReadReceipts } from '@/hooks/use-read-receipts'
import { useRoomMembership } from '@/hooks/use-room-membership'
import { useCallSetup } from '@/hooks/use-call-setup'
import { useChatStore } from '@/stores/chat-store'

// Auto-archive rooms with no activity for 3 hours (skip favourites)
const AUTO_ARCHIVE_THRESHOLD_MS = 3 * 60 * 60 * 1000
const AUTO_ARCHIVE_CHECK_INTERVAL_MS = 15 * 60 * 1000

const archivingInProgress = new Set<string>()

function useAutoArchive(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return

    const check = () => {
      const { rooms, archiveRoom, favoriteRoomIds } = useChatStore.getState()
      const now = Date.now()
      for (const room of rooms) {
        if (room.isArchived || archivingInProgress.has(room.roomId)) continue
        // Never auto-archive favourite rooms
        if (favoriteRoomIds.includes(room.roomId)) continue
        if (room.lastMessageTs > 0 && now - room.lastMessageTs > AUTO_ARCHIVE_THRESHOLD_MS) {
          archivingInProgress.add(room.roomId)
          archiveRoom(room.roomId)
            .catch(() => {})
            .finally(() => archivingInProgress.delete(room.roomId))
        }
      }
    }

    // Check after initial sync settles, then every 15 minutes
    const initial = setTimeout(check, 30_000)
    const interval = setInterval(check, AUTO_ARCHIVE_CHECK_INTERVAL_MS)

    return () => {
      clearTimeout(initial)
      clearInterval(interval)
    }
  }, [userId])
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const user = useAuthStore(s => s.user)
  const [verificationRequest, setVerificationRequest] = useState<VerificationRequest | null>(null)
  const [showNewSessionBanner, setShowNewSessionBanner] = useState(false)
  const [sessionVerifyError, setSessionVerifyError] = useState<string | null>(null)

  // Compose all Matrix event hooks
  useTimelineSync(user?.userId)
  useTypingIndicators(user?.userId)
  useReadReceipts(user?.userId)
  useRoomMembership(user?.userId)
  useCallSetup(user?.userId)
  useAutoArchive(user?.userId)

  // Load ignored users list and spaces on startup
  useEffect(() => {
    if (!user) return
    useChatStore.getState().loadIgnoredUsers()
    useChatStore.getState().loadSpaces()
  }, [user])

  // Verification request listener + cross-signing check
  useEffect(() => {
    if (!user) return

    const client = getMatrixClient()
    if (!client) return

    // Listen for incoming verification requests
    const onVerificationRequest = (request: VerificationRequest) => {
      console.debug('Verification request received:', request.otherUserId, 'phase:', request.phase)
      setVerificationRequest(request)
    }

    client.on(CryptoEvent.VerificationRequestReceived as any, onVerificationRequest)

    // Check cross-signing status after sync — prompt verification if needed
    const checkCrossSigning = async () => {
      try {
        if (localStorage.getItem('matrix_verify_banner_dismissed') === 'true') return
        const status = await getCrossSigningStatus()
        if (status.exists && !status.thisDeviceVerified) {
          setShowNewSessionBanner(true)
        }
      } catch {
        // ignore
      }
    }
    const csTimer = setTimeout(checkCrossSigning, 3000)

    return () => {
      clearTimeout(csTimer)
      client.removeListener(CryptoEvent.VerificationRequestReceived as any, onVerificationRequest)
    }
  }, [user])

  const handleVerifyWithSession = useCallback(async () => {
    try {
      setSessionVerifyError(null)
      const request = await requestSelfVerification()
      setVerificationRequest(request)
      setShowNewSessionBanner(false)
    } catch (err: any) {
      console.error('Failed to request self-verification:', err)
      const msg = err?.message || String(err)
      if (msg.toLowerCase().includes('not implemented') || msg.toLowerCase().includes('not supported')) {
        setSessionVerifyError('Interactive verification is not available. Please use a security key instead.')
      } else {
        setSessionVerifyError('Failed to start verification. Please try the security key method.')
      }
    }
  }, [])

  const handleVerifyWithKey = useCallback(async (key: string) => {
    await restoreFromRecoveryKey(key)
    // Only dismiss the banner if verification actually succeeded.
    // restoreFromRecoveryKey() catches and continues on partial failures,
    // so we must verify the device is actually cross-signed before hiding the prompt.
    const status = await getCrossSigningStatus()
    if (status.thisDeviceVerified) {
      localStorage.setItem('matrix_verify_banner_dismissed', 'true')
      setShowNewSessionBanner(false)
    }
    // If not verified, keep the banner visible so the user knows it's incomplete
  }, [])

  return (
    <>
      {children}
      <CallOverlay />
      {showNewSessionBanner && !verificationRequest && (
        <NewSessionBanner
          onVerifyWithSession={handleVerifyWithSession}
          onVerifyWithKey={handleVerifyWithKey}
          sessionVerifyError={sessionVerifyError}
          onDismiss={() => {
            localStorage.setItem('matrix_verify_banner_dismissed', 'true')
            setShowNewSessionBanner(false)
          }}
        />
      )}
      {verificationRequest && (
        <VerificationDialog
          request={verificationRequest}
          onClose={() => setVerificationRequest(null)}
        />
      )}
    </>
  )
}

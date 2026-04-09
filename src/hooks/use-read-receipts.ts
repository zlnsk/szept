'use client'

import { useEffect } from 'react'
import { getMatrixClient } from '@/lib/matrix/client'
import { useChatStore } from '@/stores/chat-store'
import * as sdk from 'matrix-js-sdk'
import { playSeenSound } from '@/lib/notification-sound'

/**
 * Hook that listens for read receipts and plays a subtle "seen" sound.
 */
export function useReadReceipts(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return

    const client = getMatrixClient()
    if (!client) return

    const { loadMessages } = useChatStore.getState()

    let lastSeenSoundTs = 0

    const onReceipt = (_event: sdk.MatrixEvent, room: sdk.Room) => {
      const currentActiveRoom = useChatStore.getState().activeRoom
      if (currentActiveRoom?.roomId === room.roomId) {
        // Debounce is handled at the timeline level; receipts reload immediately
        loadMessages(room.roomId)

        const now = Date.now()
        if (now - lastSeenSoundTs > 3000) {
          lastSeenSoundTs = now
          playSeenSound()
        }
      }
    }

    client.on(sdk.RoomEvent.Receipt, onReceipt)

    return () => {
      client.removeListener(sdk.RoomEvent.Receipt, onReceipt)
    }
  }, [userId])
}

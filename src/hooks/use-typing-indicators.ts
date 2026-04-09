'use client'

import { useEffect } from 'react'
import { getMatrixClient } from '@/lib/matrix/client'
import { useChatStore } from '@/stores/chat-store'
import * as sdk from 'matrix-js-sdk'

/**
 * Hook that listens for typing notifications in the active room.
 */
export function useTypingIndicators(userId: string | undefined) {
  const activeRoomId = useChatStore(s => s.activeRoom?.roomId)

  // Clear typing indicators when switching rooms
  useEffect(() => {
    useChatStore.setState({ typingUsers: [] })
  }, [activeRoomId])

  useEffect(() => {
    if (!userId) return

    const client = getMatrixClient()
    if (!client) return

    const onRoomTyping = (_event: sdk.MatrixEvent, room: sdk.Room) => {
      const currentActiveRoom = useChatStore.getState().activeRoom
      if (currentActiveRoom?.roomId === room.roomId) {
        const typingMembers = (room as any).getTypingMembers?.() || []
        const typingNames = typingMembers
          .filter((m: any) => m.userId !== userId)
          .map((m: any) => m.name || m.userId)
        useChatStore.setState({ typingUsers: typingNames })
      }
    }

    client.on('RoomMember.typing' as any, onRoomTyping)

    return () => {
      client.removeListener('RoomMember.typing' as any, onRoomTyping)
    }
  }, [userId])
}

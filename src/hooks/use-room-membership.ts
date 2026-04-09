'use client'

import { useEffect } from 'react'
import { getMatrixClient } from '@/lib/matrix/client'
import { useChatStore } from '@/stores/chat-store'
import * as sdk from 'matrix-js-sdk'

/**
 * Hook that listens for room membership changes and member name/avatar updates.
 * Auto-archiving is handled by realtime-provider.tsx.
 */
export function useRoomMembership(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return

    const client = getMatrixClient()
    if (!client) return

    const { loadRooms } = useChatStore.getState()

    let loadRoomsTimer: ReturnType<typeof setTimeout> | null = null
    const debouncedLoadRooms = () => {
      if (loadRoomsTimer) clearTimeout(loadRoomsTimer)
      loadRoomsTimer = setTimeout(() => {
        loadRooms()
        loadRoomsTimer = null
      }, 300)
    }

    const onRoomMembership = () => {
      debouncedLoadRooms()
    }

    const onRoomMemberChange = () => {
      debouncedLoadRooms()
    }

    client.on(sdk.RoomEvent.MyMembership, onRoomMembership)
    client.on(sdk.RoomMemberEvent.Membership as any, onRoomMemberChange)
    client.on(sdk.RoomMemberEvent.Name as any, onRoomMemberChange)
    client.on(sdk.RoomStateEvent.Events as any, onRoomMemberChange)

    return () => {
      if (loadRoomsTimer) clearTimeout(loadRoomsTimer)

      client.removeListener(sdk.RoomEvent.MyMembership, onRoomMembership)
      client.removeListener(sdk.RoomMemberEvent.Membership as any, onRoomMemberChange)
      client.removeListener(sdk.RoomMemberEvent.Name as any, onRoomMemberChange)
      client.removeListener(sdk.RoomStateEvent.Events as any, onRoomMemberChange)
    }
  }, [userId])
}

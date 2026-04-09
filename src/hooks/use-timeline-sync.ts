'use client'

import { useEffect } from 'react'
import { getMatrixClient } from '@/lib/matrix/client'
import { useChatStore } from '@/stores/chat-store'
import * as sdk from 'matrix-js-sdk'
import { playNotificationSound } from '@/lib/notification-sound'

/**
 * Hook that manages Matrix timeline events, sync state, and message notifications.
 * Handles debounced room/message reloads and unarchiving rooms on new messages.
 */
export function useTimelineSync(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return

    const client = getMatrixClient()
    if (!client) return

    const { loadRooms, loadMessages, unarchiveRoom, markAsRead } = useChatStore.getState()

    // --- Debounce helpers ---
    let loadRoomsTimer: ReturnType<typeof setTimeout> | null = null
    const debouncedLoadRooms = () => {
      if (loadRoomsTimer) clearTimeout(loadRoomsTimer)
      loadRoomsTimer = setTimeout(() => {
        loadRooms()
        loadRoomsTimer = null
      }, 300)
    }

    let loadMessagesTimer: ReturnType<typeof setTimeout> | null = null
    const debouncedLoadMessages = (roomId: string, immediate = false) => {
      if (loadMessagesTimer) clearTimeout(loadMessagesTimer)
      // Use shorter debounce (50ms) for batching rapid events.
      // Immediate mode (0ms) is used for own-message events.
      const delay = immediate ? 0 : 50
      loadMessagesTimer = setTimeout(() => {
        const currentActiveRoom = useChatStore.getState().activeRoom
        if (currentActiveRoom?.roomId === roomId) {
          loadMessages(roomId)
        }
        loadMessagesTimer = null
      }, delay)
    }

    // Track whether timeline events fired for the ACTIVE room during this sync cycle
    let activeRoomTimelineEventFired = false
    let syncCycleResetTimer: ReturnType<typeof setTimeout> | null = null

    const onTimelineEvent = (
      event: sdk.MatrixEvent,
      room: sdk.Room | undefined,
      _toStartOfTimeline?: boolean,
      _removed?: boolean,
      data?: { liveEvent?: boolean },
    ) => {
      if (!room) return

      if (syncCycleResetTimer) clearTimeout(syncCycleResetTimer)
      syncCycleResetTimer = setTimeout(() => {
        activeRoomTimelineEventFired = false
      }, 500)

      const eventType = event.getType()
      if (
        (eventType === 'm.room.message' || eventType === 'm.room.encrypted') &&
        data?.liveEvent
      ) {
        const tags = room.tags || {}
        if ('m.lowpriority' in tags) {
          unarchiveRoom(room.roomId)
        }
      }

      debouncedLoadRooms()

      const currentActiveRoom = useChatStore.getState().activeRoom
      if (currentActiveRoom?.roomId === room.roomId) {
        activeRoomTimelineEventFired = true
        // Own messages get immediate reload for snappy feedback;
        // other messages use debounce to batch rapid events.
        const isOwnEvent = event.getSender() === userId
        debouncedLoadMessages(room.roomId, isOwnEvent)
      }

      if (
        (eventType === 'm.room.message' || eventType === 'm.room.encrypted' || eventType === 'm.reaction') &&
        data?.liveEvent &&
        currentActiveRoom?.roomId === room.roomId
      ) {
        markAsRead(room.roomId)
      }

      // Sound + browser notification for messages from others
      if (
        (eventType === 'm.room.message' || eventType === 'm.room.encrypted') &&
        event.getSender() !== userId &&
        data?.liveEvent
      ) {
        if (!currentActiveRoom || currentActiveRoom.roomId !== room.roomId || document.hidden) {
          playNotificationSound()
        }

        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          const senderName = room.getMember(event.getSender()!)?.name || event.getSender()
          const clearContent = (event as any).getClearContent?.()
          const content = clearContent || event.getContent()
          const body = content?.body || 'New message'
          new Notification(`${senderName} in ${room.name}`, {
            body: body.substring(0, 100),
            icon: '/favicon.ico',
          })
        }
      }
    }

    const onEventDecrypted = (event: sdk.MatrixEvent) => {
      const currentActiveRoom = useChatStore.getState().activeRoom
      if (currentActiveRoom && event.getRoomId() === currentActiveRoom.roomId) {
        debouncedLoadMessages(currentActiveRoom.roomId)
      }
      debouncedLoadRooms()
    }

    const onSync = (state: string) => {
      if (state === 'SYNCING') {
        debouncedLoadRooms()
        if (!activeRoomTimelineEventFired) {
          const currentActiveRoom = useChatStore.getState().activeRoom
          if (currentActiveRoom) {
            debouncedLoadMessages(currentActiveRoom.roomId)
          }
        }
      }
    }

    const onTimelineReset = (room: sdk.Room | undefined) => {
      if (!room) return
      const currentActiveRoom = useChatStore.getState().activeRoom
      if (currentActiveRoom?.roomId === room.roomId) {
        loadMessages(room.roomId)
      }
      debouncedLoadRooms()
    }

    const onEventStatus = (event: sdk.MatrixEvent) => {
      const currentActiveRoom = useChatStore.getState().activeRoom
      if (currentActiveRoom && event.getRoomId() === currentActiveRoom.roomId) {
        debouncedLoadMessages(currentActiveRoom.roomId)
      }
    }

    client.on(sdk.RoomEvent.Timeline, onTimelineEvent)
    client.on(sdk.RoomEvent.TimelineReset, onTimelineReset)
    client.on(sdk.MatrixEventEvent.Decrypted, onEventDecrypted)
    client.on(sdk.MatrixEventEvent.Status as any, onEventStatus)
    client.on(sdk.ClientEvent.Sync, onSync)

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    return () => {
      if (loadRoomsTimer) clearTimeout(loadRoomsTimer)
      if (loadMessagesTimer) clearTimeout(loadMessagesTimer)
      if (syncCycleResetTimer) clearTimeout(syncCycleResetTimer)

      client.removeListener(sdk.RoomEvent.Timeline, onTimelineEvent)
      client.removeListener(sdk.RoomEvent.TimelineReset, onTimelineReset)
      client.removeListener(sdk.MatrixEventEvent.Decrypted, onEventDecrypted)
      client.removeListener(sdk.MatrixEventEvent.Status as any, onEventStatus)
      client.removeListener(sdk.ClientEvent.Sync, onSync)
    }
  }, [userId])
}

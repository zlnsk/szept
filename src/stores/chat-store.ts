import { create } from 'zustand'
import { getMatrixClient, getAvatarUrl, getUserId } from '@/lib/matrix/client'
import {
  getClearContent,
  getEventStatus,
  getUnreadNotificationCount,
  getReactionIndex,
  setReactionIndex,
  getAccountDataContent,
  setAccountData,
  sendEvent,
  sendStateEvent,
  searchRoomEvents,
} from '@/lib/matrix/sdk-compat'
import { setProfileCache, getProfileCache, hasProfileCache, clearProfileCache } from '@/lib/profile-cache'

// Throttle outgoing typing notifications to avoid 429 rate limiting
let _lastTypingSentAt = 0
const TYPING_THROTTLE_MS = 3_000
import type { Room, MatrixEvent, RoomMember } from 'matrix-js-sdk'
import { EventStatus } from 'matrix-js-sdk/lib/models/event-status'

/**
 * Strip HTML tags and decode common HTML entities from a string.
 * Used for message preview snippets in the room list.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Strip Matrix ID disambiguation from display names.
 * The SDK appends " (@user:server)" when multiple members share a display name.
 * e.g. "Łukasz (@signal_52c1d86e-...:lukasz.com)" → "Łukasz"
 */
function cleanDisplayName(name: string): string {
  // Strip trailing " (@user:server.com)" disambiguation
  const match = name.match(/^(.+?)\s*\(@[^)]+\)$/)
  if (match) return match[1].trim()
  // If the name IS a raw Matrix ID, extract the localpart
  if (name.startsWith('@') && name.includes(':')) {
    return name.slice(1).split(':')[0]
  }
  return name
}

export interface MatrixSpace {
  roomId: string
  name: string
  avatarUrl: string | null
  topic: string | null
  childRoomIds: string[]
  childSpaceIds: string[]
}

export interface MatrixRoom {
  roomId: string
  name: string
  avatarUrl: string | null
  topic: string | null
  isDirect: boolean
  lastMessage: string | null
  lastMessageTs: number
  lastSenderName: string | null
  unreadCount: number
  members: MatrixRoomMember[]
  encrypted: boolean
  isArchived: boolean
  isBridged: boolean
  powerLevels: Record<string, number>
}

export interface MatrixRoomMember {
  userId: string
  displayName: string
  avatarUrl: string | null
  membership: string
  presence: 'online' | 'offline' | 'unavailable' | null
}

export interface ReadReceipt {
  userId: string
  displayName: string
  avatarUrl: string | null
  ts: number
}

export interface MatrixMessage {
  eventId: string
  roomId: string
  senderId: string
  senderName: string
  senderAvatar: string | null
  type: string
  content: string
  formattedContent: string | null
  timestamp: number
  isEdited: boolean
  isRedacted: boolean
  replyToEvent: {
    eventId: string
    senderId: string
    senderName: string
    content: string
  } | null
  reactions: Map<string, { count: number; users: string[]; includesMe: boolean }>
  mediaUrl: string | null
  mediaInfo: { w?: number; h?: number; mimetype?: string; size?: number; duration?: number } | null
  encryptedFile: { url: string; key: { k: string; alg: string; key_ops: string[]; kty: string; ext: boolean }; iv: string; hashes: Record<string, string>; v: string } | null
  msgtype: string
  readBy: ReadReceipt[]
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
  isStateEvent?: boolean
  threadRootId: string | null
  threadCount: number
  threadLatestReply: string | null
}

interface ChatState {
  rooms: MatrixRoom[]
  pendingInvites: MatrixRoom[]
  activeRoom: MatrixRoom | null
  messages: MatrixMessage[]
  isLoadingMessages: boolean
  typingUsers: string[]
  searchQuery: string

  loadRooms: () => Promise<void> | void
  acceptInvite: (roomId: string) => Promise<void>
  rejectInvite: (roomId: string) => Promise<void>
  setDisplayName: (name: string) => Promise<void>
  joinRoom: (roomIdOrAlias: string) => Promise<void>
  setActiveRoom: (room: MatrixRoom | null) => void
  loadMessages: (roomId: string) => Promise<void>
  sendMessage: (roomId: string, content: string, replyToEventId?: string) => void
  retryMessage: (eventId: string) => void
  retryAllFailed: () => void
  editMessage: (roomId: string, eventId: string, newContent: string) => Promise<void>
  redactMessage: (roomId: string, eventId: string) => Promise<void>
  sendReaction: (roomId: string, eventId: string, emoji: string) => Promise<void>
  createDirectChat: (userId: string) => Promise<string>
  createGroupChat: (name: string, userIds: string[], options?: {
    encrypted?: boolean
    isPublic?: boolean
    topic?: string
  }) => Promise<string>
  setSearchQuery: (query: string) => void
  markAsRead: (roomId: string) => Promise<void>
  sendTyping: (roomId: string, typing: boolean) => void
  refreshRoom: (roomId: string) => void
  archiveRoom: (roomId: string) => Promise<void>
  unarchiveRoom: (roomId: string) => Promise<void>
  uploadFile: (roomId: string, file: File) => Promise<void>
  leaveRoom: (roomId: string) => Promise<void>
  setRoomName: (roomId: string, name: string) => Promise<void>
  setRoomTopic: (roomId: string, topic: string) => Promise<void>
  inviteMember: (roomId: string, userId: string) => Promise<void>
  enableEncryption: (roomId: string) => Promise<void>
  pinMessage: (roomId: string, eventId: string) => Promise<void>
  unpinMessage: (roomId: string, eventId: string) => Promise<void>
  forwardMessage: (fromRoomId: string, eventId: string, toRoomId: string) => Promise<void>
  searchMessages: (query: string) => Promise<{roomId: string, roomName: string, eventId: string, sender: string, body: string, timestamp: number}[]>
  setRoomNotificationSetting: (roomId: string, setting: 'all' | 'mentions' | 'mute') => Promise<void>
  getRoomNotificationSetting: (roomId: string) => 'all' | 'mentions' | 'mute'
  kickMember: (roomId: string, userId: string, reason?: string) => Promise<void>
  banMember: (roomId: string, userId: string, reason?: string) => Promise<void>
  unbanMember: (roomId: string, userId: string) => Promise<void>
  setPowerLevel: (roomId: string, userId: string, level: number) => Promise<void>
  threadMessages: MatrixMessage[]
  isLoadingThread: boolean
  activeThreadId: string | null
  setActiveThread: (eventId: string | null) => void
  loadThread: (roomId: string, threadRootId: string) => Promise<void>
  sendThreadReply: (roomId: string, threadRootId: string, content: string) => void
  spaces: MatrixSpace[]
  activeSpaceId: string | null
  loadSpaces: () => void
  setActiveSpace: (spaceId: string | null) => void
  ignoredUsers: string[]
  loadIgnoredUsers: () => void
  ignoreUser: (userId: string) => Promise<void>
  unignoreUser: (userId: string) => Promise<void>
  unreadThreadCount: number
  updateUnreadThreadCount: () => void
  favoriteRoomIds: string[]
  toggleFavorite: (roomId: string) => Promise<void>
  loadFavorites: () => void
  notificationKeywords: string[]
  setNotificationKeywords: (keywords: string[]) => Promise<void>
  loadNotificationKeywords: () => void
  /** Prefetch room data (members + scrollback) without changing active state */
  prefetchRoom: (roomId: string) => void
  /** Prefetch the next few visible rooms after the active room finishes loading */
  prefetchAdjacentRooms: (roomIds: string[]) => void
  /** Clear all state on logout to prevent cross-session data leakage */
  resetState: () => void
}

const BOT_USER_IDS = ['@claude:lukasz.com', '@signalbot:lukasz.com', '@signal:lukasz.com', '@signal-bot:lukasz.com']
const isBotUser = (userId: string) => BOT_USER_IDS.includes(userId)
const isBotDisplayName = (name: string) => /\b(bridge\s*bot|bridgebot)\b/i.test(name)
const isBridgePuppet = (userId: string) => /^@(signal_|telegram_|whatsapp_|slack_|discord_|instagram_)/.test(userId)

function roomToMatrixRoom(room: Room): MatrixRoom {
  const client = getMatrixClient()
  const userId = getUserId()

  const timeline = room.getLiveTimeline().getEvents()
  const lastEvent = timeline.filter(
    (e) => e.getType() === 'm.room.message' || e.getType() === 'm.room.encrypted'
  ).pop()

  // Use decrypted content for last message preview
  const lastClear = lastEvent ? getClearContent(lastEvent) as Record<string, any> | null : null
  const lastContent = lastClear || lastEvent?.getContent()
  let lastMessage: string | null = null
  if (lastContent) {
    if (lastContent.msgtype === 'm.bad.encrypted') lastMessage = '🔒 Encrypted message'
    else if (lastContent.msgtype === 'm.image') lastMessage = '📷 Image'
    else if (lastContent.msgtype === 'm.video') lastMessage = '🎬 Video'
    else if (lastContent.msgtype === 'm.audio') lastMessage = '🎤 Audio'
    else if (lastContent.msgtype === 'm.file') lastMessage = '📎 File'
    else if (lastContent.body) {
      // Strip Matrix reply fallback (lines starting with "> " and trailing newline)
      const rawBody = lastContent.body.replace(/^(>.*\n?)+\n?/, '').trim() || lastContent.body
      // Strip HTML tags and decode entities for clean preview text
      lastMessage = stripHtml(rawBody)
    }
    else if (lastContent.algorithm) lastMessage = '🔒 Encrypted message'
    else lastMessage = null
  }

  const joinedMembers = room.getJoinedMembers()
  const members = joinedMembers.map((m: RoomMember) => ({
    userId: m.userId,
    displayName: m.name || m.userId,
    // Prefer profile cache (has real avatar) over room member avatar (may be bridge default like Signal logo)
    // Empty string in cache means "no avatar" (negative cache) — skip it
    avatarUrl: getAvatarUrl(getProfileCache(m.userId) || m.getMxcAvatarUrl() || null),
    membership: m.membership || 'join',
    presence: (client?.getUser(m.userId)?.presence as 'online' | 'offline' | 'unavailable') || null,
  }))

  // With lazy-loaded members, the bridged user may not appear in getJoinedMembers().
  // Include the avatar fallback member (from room summary heroes) so the sidebar
  // can resolve presence and avatar for Signal-bridged DM rooms.
  const fallbackMember = room.getAvatarFallbackMember()
  if (fallbackMember && !joinedMembers.some((m: RoomMember) => m.userId === fallbackMember.userId)) {
    members.push({
      userId: fallbackMember.userId,
      displayName: fallbackMember.name || fallbackMember.userId,
      avatarUrl: getAvatarUrl(getProfileCache(fallbackMember.userId) || fallbackMember.getMxcAvatarUrl()),
      membership: fallbackMember.membership || 'join',
      presence: (client?.getUser(fallbackMember.userId)?.presence as 'online' | 'offline' | 'unavailable') || null,
    })
  }

  // Check if direct message
  const dmMap = client ? getAccountDataContent(client, 'm.direct') : {}
  let isDirect = false
  for (const userRooms of Object.values(dmMap) as string[][]) {
    if (userRooms.includes(room.roomId)) {
      isDirect = true
      break
    }
  }


  // Signal groups may be incorrectly listed in m.direct by the bridge.
  // If the room has an explicit name and more than 3 members, treat as a group.
  if (isDirect) {
    const explicitName = room.currentState.getStateEvents('m.room.name', '')?.getContent()?.name
    const summaryCount = room.currentState?.getJoinedMemberCount?.() || joinedMembers.length
    if (explicitName && summaryCount > 3) {
      isDirect = false
    }
  }

  // Signal groups may be incorrectly listed in m.direct by the bridge.
  // If the room has an explicit name and more than 3 members, treat as a group.
  if (isDirect) {
    const explicitName = room.currentState.getStateEvents('m.room.name', '')?.getContent()?.name
    const summaryCount = room.currentState?.getJoinedMemberCount?.() || joinedMembers.length
    if (explicitName && summaryCount > 3) {
      isDirect = false
    }
  }

  // Check if archived (has m.lowpriority tag)
  const tags = room.tags || {}
  const isArchived = 'm.lowpriority' in tags

  // Avatar resolution following Element Web's algorithm:
  // 1. Room avatar (m.room.avatar) — highest priority for ALL rooms.
  //    Bridges (mautrix-signal etc.) set this to the contact's real photo.
  // 2. For DMs without room avatar: fall back to getAvatarFallbackMember().
  // 3. Groups without room avatar: show initials (never a random member).
  const roomMxc = room.getMxcAvatarUrl()
  let roomAvatarMxc = roomMxc || null

  if (isDirect && !roomMxc && client) {
    // DM with no room avatar: try member fallback (same as Element Web)
    const dmPartner = room.getAvatarFallbackMember()
    if (dmPartner) {
      const mxc = dmPartner.getMxcAvatarUrl()
      if (mxc) roomAvatarMxc = mxc
    }
    if (!roomAvatarMxc) {
      // Lazy loading fallback: try joined members directly
      const otherMembers = room.getJoinedMembers().filter((m: RoomMember) => m.userId !== client.getUserId() && !isBotUser(m.userId))
      const puppet = otherMembers.find((m: RoomMember) =>
        /^@(signal_|telegram_|whatsapp_|slack_|discord_|instagram_)/.test(m.userId)
      )
      const partner = puppet || otherMembers[0]
      if (partner?.getMxcAvatarUrl()) {
        roomAvatarMxc = partner.getMxcAvatarUrl()!
      }
    }
  }

  // For DMs, compute the display name from the other member instead of using
  // room.name which may include all participants (e.g. "Alice and @bot:server").
  let displayName = room.name || 'Unnamed Room'
  if (isDirect && client) {
    const dmPartner = room.getAvatarFallbackMember()
    if (dmPartner && !isBotUser(dmPartner.userId) && !isBotDisplayName(dmPartner.name || '')) {
      displayName = cleanDisplayName(dmPartner.name || dmPartner.userId)
    } else {
      const otherMembers = room.getJoinedMembers().filter((m: RoomMember) => m.userId !== client.getUserId() && !isBotUser(m.userId) && !isBotDisplayName(m.name || ''))
      const puppet = otherMembers.find((m: RoomMember) => isBridgePuppet(m.userId))
      const dmNameMember = puppet || otherMembers[0]
      if (dmNameMember) {
        displayName = cleanDisplayName(dmNameMember.name || dmNameMember.userId)
      } else {
        // Lazy loading fallback: strip bot name from SDK-computed room.name
        // Handles patterns like "User X and Claude" or "User X and @claude:lukasz.com"
        const stripped = displayName
          .replace(/\s+and\s+(claude|Signal Bridge Bot|signalbot)$/i, '')
          .replace(/\s+and\s+@(claude|signalbot|signal):lukasz\.com$/i, '')
          .replace(/,\s*(claude|Signal Bridge Bot|signalbot)$/i, '')
          .replace(/,\s*@(claude|signalbot|signal):lukasz\.com$/i, '')
        if (stripped && stripped !== displayName) {
          displayName = cleanDisplayName(stripped.trim())
        }
      }
    }
  }

  // Extract power levels
  const plEvent = room.currentState.getStateEvents('m.room.power_levels', '')
  const plContent = plEvent?.getContent() || {}
  const powerLevels: Record<string, number> = {}
  if (plContent.users) {
    for (const [uid, level] of Object.entries(plContent.users)) {
      powerLevels[uid] = level as number
    }
  }

  return {
    roomId: room.roomId,
    name: displayName,
    avatarUrl: getAvatarUrl(roomAvatarMxc),
    topic: room.currentState.getStateEvents('m.room.topic', '')?.getContent()?.topic || null,
    isDirect,
    lastMessage,
    lastMessageTs: lastEvent?.getTs() || room.getLastActiveTimestamp() || 0,
    lastSenderName: lastEvent ? (() => {
      const sender = lastEvent.getSender()!
      if (sender === userId) return 'You'
      const rawName = cleanDisplayName(room.getMember(sender)?.name || sender || '')
      if (!rawName) return null
      // Use first name only for message previews
      return rawName.split(' ')[0]
    })() : null,
    unreadCount: getUnreadNotificationCount(room),
    members,
    encrypted: room.hasEncryptionStateEvent(),
    isArchived,
    isBridged: members.some(m => /^@(signal_|telegram_|whatsapp_|slack_|discord_|instagram_)/.test(m.userId)),
    powerLevels,
  }
}

function eventToMatrixMessage(event: MatrixEvent, room: Room): MatrixMessage | null {
  const wireType = event.getWireType?.() || event.getType()
  const effectiveType = event.getType()
  const client = getMatrixClient()
  const userId = getUserId()

  // Accept message events, encrypted events, and stickers
  const isMessage = effectiveType === 'm.room.message' || effectiveType === 'm.sticker'
  const isEncrypted = wireType === 'm.room.encrypted' || effectiveType === 'm.room.encrypted'

  // Handle state events as system messages
  const isStateEvent = effectiveType === 'm.room.encryption' || effectiveType === 'm.room.member' || effectiveType === 'm.room.name' || effectiveType === 'm.room.topic'
  if (isStateEvent) {
    const sender = event.getSender()!
    const member = room.getMember(sender)
    const senderName = cleanDisplayName(member?.name || sender)
    let stateContent = ''

    if (effectiveType === 'm.room.encryption') {
      stateContent = `${senderName} enabled end-to-end encryption`
    } else if (effectiveType === 'm.room.member') {
      const membership = event.getContent()?.membership
      const prevMembership = event.getPrevContent?.()?.membership
      const targetName = cleanDisplayName(event.getContent()?.displayname || event.getStateKey?.() || sender)
      if (membership === 'join' && prevMembership === 'invite') {
        stateContent = `${targetName} joined the room`
      } else if (membership === 'join' && prevMembership === 'join') {
        stateContent = `${targetName} updated their profile`
      } else if (membership === 'join') {
        stateContent = `${targetName} joined the room`
      } else if (membership === 'invite') {
        stateContent = `${senderName} invited ${targetName}`
      } else if (membership === 'leave') {
        if (event.getStateKey?.() === sender) {
          stateContent = `${targetName} left the room`
        } else {
          stateContent = `${senderName} removed ${targetName}`
        }
      } else if (membership === 'ban') {
        stateContent = `${senderName} banned ${targetName}`
      } else {
        stateContent = `${targetName} membership changed to ${membership}`
      }
    } else if (effectiveType === 'm.room.name') {
      const newName = event.getContent()?.name
      stateContent = newName ? `${senderName} changed the room name to "${newName}"` : `${senderName} removed the room name`
    } else if (effectiveType === 'm.room.topic') {
      const newTopic = event.getContent()?.topic
      stateContent = newTopic ? `${senderName} changed the topic to "${newTopic}"` : `${senderName} removed the topic`
    }

    return {
      eventId: event.getId()!,
      roomId: room.roomId,
      senderId: sender,
      senderName,
      senderAvatar: getAvatarUrl((member ? getProfileCache(member.userId) : undefined) || member?.getMxcAvatarUrl()),
      type: 'm.text',
      msgtype: 'm.text',
      content: stateContent,
      formattedContent: null,
      timestamp: event.getTs(),
      isEdited: false,
      isRedacted: false,
      replyToEvent: null,
      reactions: new Map(),
      mediaUrl: null,
      mediaInfo: null,
      encryptedFile: null,
      readBy: [],
      status: 'sent',
      isStateEvent: true,
      threadRootId: null,
      threadCount: 0,
      threadLatestReply: null,
    }
  }

  if (!isMessage && !isEncrypted) return null

  const sender = event.getSender()!
  const member = room.getMember(sender)

  // For encrypted events, try to get decrypted content first.
  // getContent() returns decrypted content if the SDK has decrypted the event.
  // getClearContent() returns decrypted content only for encrypted events.
  // We check both to handle all SDK code paths (JS crypto vs Rust crypto).
  const rawContent = event.getContent()
  const clearContent = getClearContent(event)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: Record<string, any> = (clearContent?.msgtype ? clearContent : null) || (rawContent?.msgtype ? rawContent : null) || clearContent || rawContent

  // If this is an encrypted event that hasn't been decrypted,
  // content will have {algorithm, ciphertext, ...} instead of {body, msgtype, ...}.
  // The SDK also uses msgtype "m.bad.encrypted" for events it failed to decrypt
  // (e.g. "missing field algorithm" from the Rust crypto module).
  const isUndecrypted = isEncrypted && (!content.msgtype || content.msgtype === 'm.bad.encrypted')

  // Check for reply
  let replyToEvent = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const relatesTo = content['m.relates_to'] as Record<string, any> | undefined

  // Skip edit events — they are folded into the original by replacingEvent()
  if (relatesTo?.rel_type === 'm.replace') return null

  if (relatesTo?.['m.in_reply_to']?.event_id) {
    const replyEvt = room.findEventById(relatesTo['m.in_reply_to'].event_id)
    if (replyEvt) {
      const replySender = replyEvt.getSender()!
      const replyMember = room.getMember(replySender)
      const replyClear = getClearContent(replyEvt) as Record<string, any> | null
      const replyContent = replyClear || replyEvt.getContent()
      let replyBody = replyContent?.body || ''
      // Strip Matrix reply fallback (> <@user:server> prefix lines)
      if (replyBody.startsWith('> ')) {
        const lines = replyBody.split('\n')
        const firstNonQuote = lines.findIndex((l: string) => !l.startsWith('> ') && l !== '')
        if (firstNonQuote > 0) {
          replyBody = lines.slice(firstNonQuote).join('\n').trim()
        }
      }
      replyToEvent = {
        eventId: replyEvt.getId()!,
        senderId: replySender,
        senderName: cleanDisplayName(replyMember?.name || replySender),
        content: replyBody,
      }
    }
  }

  // Extract thread info
  let threadRootId: string | null = null
  if (relatesTo?.rel_type === 'm.thread') {
    threadRootId = relatesTo.event_id || null
  }

  // For thread root messages, count thread replies by scanning the timeline
  let threadCount = 0
  let threadLatestReply: string | null = null
  try {
    const thread = (room as any).getThread?.(event.getId()!)
    if (thread) {
      threadCount = thread.length || 0
      const lastReply = thread.lastReply?.()
      if (lastReply) {
        const lastContent = (getClearContent(lastReply) as Record<string, any>) || lastReply.getContent()
        threadLatestReply = lastContent?.body || null
      }
    }
  } catch {
    // getThread may not exist in this SDK version — fall back to timeline scan
  }
  if (threadCount === 0) {
    const eventId = event.getId()!
    const timeline = room.getLiveTimeline().getEvents()
    for (const e of timeline) {
      const rel = e.getContent()?.['m.relates_to'] || (getClearContent(e) as any)?.['m.relates_to']
      if (rel?.rel_type === 'm.thread' && rel?.event_id === eventId) {
        threadCount++
        const lastContent = (getClearContent(e) as Record<string, any>) || e.getContent()
        threadLatestReply = lastContent?.body || null
      }
    }
  }

  // Collect reactions from pre-built index (O(1) per message)
  const reactions = new Map<string, { count: number; users: string[]; includesMe: boolean }>()
  const reactionIndex = getReactionIndex(room)
  if (reactionIndex) {
    const msgReactions = reactionIndex.get(event.getId()!)
    if (msgReactions) {
      for (const [emoji, data] of msgReactions) {
        reactions.set(emoji, { ...data, users: [...data.users] })
      }
    }
  }

  // Check if edited
  const replacingEvt = event.replacingEvent?.()
  const isEdited = !!(content['m.new_content'] || replacingEvt)
  let displayContent = content
  if (content['m.new_content']) {
    displayContent = content['m.new_content']
  } else if (replacingEvt) {
    const replaceClear = getClearContent(replacingEvt) as Record<string, any> | null
    const replaceContent = replaceClear || replacingEvt.getContent()
    if (replaceContent?.['m.new_content']) {
      displayContent = replaceContent['m.new_content']
    }
  }

  // Media - handle both unencrypted (url) and encrypted (file.url) attachments
  let mediaUrl: string | null = null
  let mediaInfo = null
  let encryptedFile = null
  if (displayContent.msgtype === 'm.image' || displayContent.msgtype === 'm.video' || displayContent.msgtype === 'm.audio' || displayContent.msgtype === 'm.file') {
    const mxcUrl = displayContent.url || displayContent.file?.url
    if (mxcUrl) {
      mediaUrl = mxcUrl  // Store raw MXC URL; components fetch via authenticated endpoint
    }
    if (displayContent.file) {
      encryptedFile = displayContent.file
    }
    mediaInfo = displayContent.info || null
    // Fallback: for pending events in encrypted rooms, the SDK may not expose
    // the url/file fields through getClearContent. Try rawContent directly.
    if (!mediaUrl && rawContent?.url) {
      mediaUrl = rawContent.url as string
    }
    if (!mediaUrl && rawContent?.file?.url) {
      mediaUrl = (rawContent.file as Record<string, unknown>).url as string
      if (!encryptedFile && rawContent.file) {
        encryptedFile = rawContent.file as any
      }
    }
  }

  // Get body text
  let body: string
  if (isUndecrypted) {
    body = '\u{1F512} Encrypted message (unable to decrypt)'
  } else {
    body = displayContent.body || ''
    // Strip reply fallback from body
    if (body.startsWith('> ')) {
      const lines = body.split('\n')
      const firstNonQuote = lines.findIndex((l: string) => !l.startsWith('> ') && l !== '')
      if (firstNonQuote > 0) {
        body = lines.slice(firstNonQuote).join('\n').trim()
      }
    }
    // Fallback if body is still empty
    if (!body && !mediaUrl) {
      body = isEncrypted ? '\u{1F512} Encrypted message' : '[empty message]'
    }
  }

  // Read receipts — use getReceiptsForEvent() directly from SDK.
  // This works correctly even with lazyLoadMembers because receipts are
  // tracked independently from the room member list.
  // For display names/avatars, fall back gracefully if member isn't loaded.
  const readBy: ReadReceipt[] = []
  const roomReceipts = room.getReceiptsForEvent(event)
  if (roomReceipts) {
    for (const receipt of roomReceipts) {
      if (receipt.userId === sender) continue // skip own read receipt
      // getMember may return null for lazy-loaded rooms — that's OK,
      // we still record the receipt and use profile cache or userId as fallback
      const receiptMember = room.getMember(receipt.userId)
      const profileAvatar = getProfileCache(receipt.userId)
      readBy.push({
        userId: receipt.userId,
        displayName: receiptMember?.name || cleanDisplayName(receipt.userId),
        avatarUrl: getAvatarUrl(profileAvatar || receiptMember?.getMxcAvatarUrl()),
        ts: receipt.data?.ts || 0,
      })
    }
  }

  // Message status for own messages
  let status: MatrixMessage['status'] = 'sent'
  if (sender === userId) {
    const evtStatus = getEventStatus(event) as EventStatus | null
    if (evtStatus === EventStatus.NOT_SENT) {
      status = 'failed'
    } else if (readBy.length > 0) {
      status = 'read'
    } else if (evtStatus === EventStatus.QUEUED || evtStatus === EventStatus.SENDING || evtStatus === EventStatus.ENCRYPTING) {
      status = 'sending'
    } else {
      // Check if event has been sent to server
      const isSent = event.getId() && !event.getId()!.startsWith('~')
      status = isSent ? 'delivered' : 'sending'
    }
  }

  return {
    eventId: event.getId()!,
    roomId: room.roomId,
    senderId: sender,
    senderName: cleanDisplayName(member?.name || sender),
    senderAvatar: getAvatarUrl((member ? getProfileCache(member.userId) : undefined) || member?.getMxcAvatarUrl()),
    type: displayContent.msgtype || 'm.text',
    msgtype: displayContent.msgtype || 'm.text',
    content: body,
    formattedContent: displayContent.formatted_body || null,
    timestamp: event.getTs(),
    isEdited,
    isRedacted: event.isRedacted(),
    replyToEvent,
    reactions,
    mediaUrl,
    mediaInfo,
    encryptedFile,
    readBy,
    status,
    threadRootId,
    threadCount,
    threadLatestReply,
  }
}

// --- Per-room message cache: avoids flash-of-empty when switching rooms ---
const messageCache = new Map<string, MatrixMessage[]>()

// --- Prefetch tracking: avoid duplicate prefetch requests ---
const prefetchedRooms = new Set<string>()
const prefetchingRooms = new Set<string>()

export const useChatStore = create<ChatState>((set, get) => ({
  rooms: [],
  pendingInvites: [],
  activeRoom: null,
  messages: [],
  isLoadingMessages: false,
  typingUsers: [],
  searchQuery: '',
  threadMessages: [],
  isLoadingThread: false,
  activeThreadId: null,
  spaces: [],
  activeSpaceId: null,
  unreadThreadCount: 0,
  favoriteRoomIds: [],
  notificationKeywords: [],

  setActiveThread: (eventId) => {
    set({ activeThreadId: eventId, threadMessages: [] })
  },

  loadThread: async (roomId, threadRootId) => {
    const client = getMatrixClient()
    if (!client) return
    set({ isLoadingThread: true })

    try {
      const room = client.getRoom(roomId)
      if (!room) return

      // Try SDK thread API first
      let threadEvents: MatrixEvent[] = []
      try {
        const thread = (room as any).getThread?.(threadRootId)
        if (thread) {
          threadEvents = thread.events || []
        }
      } catch {
        // getThread may not exist in this SDK version
      }

      if (threadEvents.length === 0) {
        // Fallback: scan timeline for messages with m.thread relation to this root
        const timeline = room.getLiveTimeline().getEvents()
        threadEvents = timeline.filter((e: MatrixEvent) => {
          const rel = e.getContent()?.['m.relates_to'] || (getClearContent(e) as any)?.['m.relates_to']
          return rel?.rel_type === 'm.thread' && rel?.event_id === threadRootId
        })
      }

      // Include the root message first
      const rootEvent = room.findEventById(threadRootId)
      const allEvents = rootEvent
        ? [rootEvent, ...threadEvents.filter((e: MatrixEvent) => e.getId() !== threadRootId)]
        : threadEvents

      const msgs = allEvents
        .map((e: MatrixEvent) => eventToMatrixMessage(e, room))
        .filter((m): m is MatrixMessage => m !== null)
        .sort((a, b) => a.timestamp - b.timestamp)

      set({ threadMessages: msgs, isLoadingThread: false })
    } catch (err) {
      console.error('Failed to load thread:', err)
      set({ isLoadingThread: false })
    }
  },

  sendThreadReply: (roomId, threadRootId, content) => {
    const client = getMatrixClient()
    if (!client) return

    const msgContent: Record<string, unknown> = {
      msgtype: 'm.text',
      body: content,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: threadRootId,
        is_falling_back: true,
        'm.in_reply_to': {
          event_id: threadRootId,
        },
      },
    }

    sendEvent(client, roomId, 'm.room.message', msgContent)
  },

  loadRooms: async () => {
    const client = getMatrixClient()
    if (!client) return

    const allRooms = client.getRooms()

    const allJoinedRooms = allRooms
      .filter(r => r.getMyMembership() === 'join')
      .reduce<MatrixRoom[]>((acc, r) => {
        try { acc.push(roomToMatrixRoom(r)) } catch (err) { console.warn('Failed to process room', r.roomId, err) }
        return acc
      }, [])
      .sort((a, b) => b.lastMessageTs - a.lastMessageTs)

    // Deduplicate bridged DM rooms: when a bridge (e.g. Signal) creates two rooms
    // for the same contact (one portal with phone number, one DM with messages),
    // hide the empty duplicate. Detect by finding rooms that share a bridge puppet
    // user and have no real messages.
    const bridgeUserToRooms = new Map<string, typeof allJoinedRooms>()
    for (const room of allJoinedRooms) {
      if (!room.isDirect || !room.isBridged) continue
      for (const m of room.members) {
        if (/^@(signal_|telegram_|whatsapp_|slack_|discord_|instagram_)/.test(m.userId)) {
          const existing = bridgeUserToRooms.get(m.userId) || []
          existing.push(room)
          bridgeUserToRooms.set(m.userId, existing)
        }
      }
    }

    const duplicateRoomIds = new Set<string>()
    for (const [, roomGroup] of bridgeUserToRooms) {
      if (roomGroup.length <= 1) continue
      // Keep the room with the most recent real message, hide the others that have no messages
      const withMessages = roomGroup.filter(r => r.lastMessage !== null && r.lastMessage !== '🔒 Encrypted message')
      const empty = roomGroup.filter(r => r.lastMessage === null || r.lastMessage === '🔒 Encrypted message')
      if (withMessages.length > 0) {
        for (const r of empty) duplicateRoomIds.add(r.roomId)
      }
    }

    const rooms = allJoinedRooms.filter(r => !duplicateRoomIds.has(r.roomId))

    const pendingInvites = allRooms
      .filter(r => r.getMyMembership() === 'invite')
      .reduce<MatrixRoom[]>((acc, r) => {
        try {
          acc.push({
            roomId: r.roomId,
            name: r.name || 'Unnamed Room',
            avatarUrl: getAvatarUrl(r.getMxcAvatarUrl()),
            topic: r.currentState.getStateEvents('m.room.topic', '')?.getContent()?.topic || null,
            isDirect: false,
            lastMessage: null,
            lastMessageTs: 0,
            lastSenderName: null,
            unreadCount: 0,
            members: [],
            encrypted: r.hasEncryptionStateEvent(),
            isArchived: false,
            isBridged: false,
            powerLevels: {},
          } satisfies MatrixRoom)
        } catch (err) { console.warn('Failed to process invite room', r.roomId, err) }
        return acc
      }, [])

    // Preserve member data from current state when lazy loading hasn't completed.
    // Only preserve MEMBER avatars (not room avatars — those are freshly resolved).
    const currentRooms = get().rooms
    if (currentRooms.length > 0) {
      const currentByRoomId = new Map(currentRooms.map(r => [r.roomId, r]))
      for (let i = 0; i < rooms.length; i++) {
        const prev = currentByRoomId.get(rooms[i].roomId)
        if (!prev) continue
        // Preserve member avatars if fresh build has fewer or lost them
        if (prev.members.length > rooms[i].members.length ||
            prev.members.some(pm => pm.avatarUrl && !rooms[i].members.find(m => m.userId === pm.userId)?.avatarUrl)) {
          const prevMemberMap = new Map(prev.members.map(m => [m.userId, m]))
          const mergedMembers = rooms[i].members.map(m => {
            const pm = prevMemberMap.get(m.userId)
            if (!m.avatarUrl && pm?.avatarUrl) return { ...m, avatarUrl: pm.avatarUrl }
            return m
          })
          // Add members that exist in prev but not in fresh build (lazy loading gap)
          for (const pm of prev.members) {
            if (!mergedMembers.some(m => m.userId === pm.userId)) {
              mergedMembers.push(pm)
            }
          }
          rooms[i] = { ...rooms[i], members: mergedMembers }
        }
        // Preserve room avatar only if fresh build has none (DM partner not loaded yet)
        if (!rooms[i].avatarUrl && prev.avatarUrl) {
          rooms[i] = { ...rooms[i], avatarUrl: prev.avatarUrl }
        }
      }
    }

    set({ rooms, pendingInvites })

    // With lazyLoadMembers, room member state events (including avatars) aren't
    // loaded until the room's timeline is viewed. For DM rooms, proactively load
    // members so the bridge puppet's actual avatar becomes available (the room-level
    // avatar is often a generic bridge placeholder like Signal's default silhouette).
    const joinedRooms = allRooms.filter(r => r.getMyMembership() === 'join')
    const roomsNeedingMembers: Room[] = []
    for (const sdkRoom of joinedRooms) {
      const matrixRoom = rooms.find(r => r.roomId === sdkRoom.roomId)
      // Load members for DM rooms, or any small room without an avatar
      // (after bridge delete-all-portals, m.direct may not be repopulated
      // so we can't rely solely on isDirect).
      const summaryMemberCount = sdkRoom.currentState?.getJoinedMemberCount?.() || sdkRoom.getJoinedMembers().length
      // Always resolve avatars for DMs, small rooms, and bridged rooms — the
      // existing avatar may be a bridge default while the real face is in the profile.
      // Threshold is ≤3 to cover bridge DMs that include an appservice bot.
      const needsAvatar = matrixRoom?.isDirect
        || matrixRoom?.isBridged
        || (sdkRoom.getJoinedMembers().length <= 3 || summaryMemberCount <= 3)
      if (needsAvatar) {
        const otherMember = sdkRoom.getJoinedMembers().find((m: RoomMember) => m.userId !== client!.getUserId())
        // Load members if the other member isn't resolved yet, or if we haven't
        // fetched their profile yet. Skip if profile was already fetched (even with
        // negative result — empty string sentinel).
        if (!otherMember || !hasProfileCache(otherMember.userId)) {
          roomsNeedingMembers.push(sdkRoom)
        }
      }
    }
    if (roomsNeedingMembers.length > 0) {
      await Promise.allSettled(
        roomsNeedingMembers.map(r => r.loadMembersIfNeeded())
      ).then(async () => {
        // Always rebuild — loadMembersIfNeeded() returns false if members
        // were already loaded by a previous call (e.g. opening a chat), but
        // the room list may have been built before that load completed.
        const updatedRooms = allRooms
          .filter(r => r.getMyMembership() === 'join')
          .map(roomToMatrixRoom)
          .sort((a, b) => b.lastMessageTs - a.lastMessageTs)
        set((state) => ({
          rooms: updatedRooms,
          activeRoom: state.activeRoom
            ? updatedRooms.find(r => r.roomId === state.activeRoom!.roomId) || state.activeRoom
            : null,
        }))

        // Fetch the global profile for each DM partner. The room member avatar
        // may be a bridge default while the user's actual profile has their real face.
        // Only fetch for DM rooms (following Element Web — groups use room avatar only).
        const profileFetches: Promise<void>[] = []
        for (const sdkRoom of roomsNeedingMembers) {
          const matrixRoom = updatedRooms.find(r => r.roomId === sdkRoom.roomId)
          if (!matrixRoom?.isDirect) continue // Only fetch profiles for DMs

          // Use getAvatarFallbackMember() like Element Web — filters out bots
          const dmPartnerRaw = sdkRoom.getAvatarFallbackMember()
          const dmPartner = dmPartnerRaw && !isBotUser(dmPartnerRaw.userId) ? dmPartnerRaw : null
          if (!dmPartner) {
            // Fallback: find the bridge puppet or first other member
            const otherMembers = sdkRoom.getJoinedMembers().filter((m: RoomMember) => m.userId !== client!.getUserId() && !isBotUser(m.userId))
            const puppet = otherMembers.find((m: RoomMember) =>
              /^@(signal_|telegram_|whatsapp_|slack_|discord_|instagram_)/.test(m.userId)
            )
            const partner = puppet || otherMembers[0]
            if (!partner) continue

            profileFetches.push(
              client!.getProfileInfo(partner.userId).then((profile) => {
                setProfileCache(partner.userId, profile.avatar_url || '')
              }).catch(() => {
                setProfileCache(partner.userId, '')
              })
            )
            continue
          }

          profileFetches.push(
            client!.getProfileInfo(dmPartner.userId).then((profile) => {
              setProfileCache(dmPartner.userId, profile.avatar_url || '')
            }).catch(() => {
              setProfileCache(dmPartner.userId, '')
            })
          )
        }

        if (profileFetches.length > 0) {
          await Promise.allSettled(profileFetches)
          // Apply profile cache to CURRENT store state.
          // For DMs: profile avatar replaces room avatar (even if room already has one,
          // because the room avatar may be a bridge logo while the profile has the real face).
          // For groups: never touch the room avatar.
          set((state) => {
            const myUserId = getUserId()
            const updated = state.rooms.map(room => {
              let hasUpdate = false
              // Update member avatars from profile cache
              const updatedMembers = room.members.map(m => {
                const cached = getProfileCache(m.userId)
                if (cached && m.avatarUrl !== getAvatarUrl(cached)) {
                  hasUpdate = true
                  return { ...m, avatarUrl: getAvatarUrl(cached) }
                }
                return m
              })

              let roomAvatar = room.avatarUrl
              // Only update room avatar for DMs that have NO room avatar
              // If the bridge set m.room.avatar, trust it (it's the correct photo)
              if (room.isDirect && !roomAvatar) {
                const others = updatedMembers.filter(m => m.userId !== myUserId)
                const puppet = others.find(m =>
                  /^@(signal_|telegram_|whatsapp_|slack_|discord_|instagram_)/.test(m.userId)
                )
                const partner = puppet || others[0]
                if (partner) {
                  const cached = getProfileCache(partner.userId)
                  if (cached) {
                    const newAvatar = getAvatarUrl(cached)
                    if (newAvatar) {
                      roomAvatar = newAvatar
                      hasUpdate = true
                    }
                  }
                }
              }
              return hasUpdate ? { ...room, members: updatedMembers, avatarUrl: roomAvatar } : room
            })
            return {
              rooms: updated,
              activeRoom: state.activeRoom
                ? updated.find(r => r.roomId === state.activeRoom!.roomId) || state.activeRoom
                : null,
            }
          })
        }
      })
    }

    // Keep spaces in sync whenever rooms are loaded
    get().loadSpaces()
  },

  loadSpaces: () => {
    const client = getMatrixClient()
    if (!client) return

    const allRooms = client.getRooms()
    const spaces: MatrixSpace[] = []

    for (const room of allRooms) {
      if (room.getMyMembership() !== 'join') continue
      // Check if room is a space by looking at creation event
      const createEvent = room.currentState.getStateEvents('m.room.create', '')
      const roomType = createEvent?.getContent()?.type
      if (roomType !== 'm.space') continue

      // Get child rooms/spaces from m.space.child state events
      const childEvents = room.currentState.getStateEvents('m.space.child')
      const childRoomIds: string[] = []
      const childSpaceIds: string[] = []

      if (childEvents && Array.isArray(childEvents)) {
        for (const event of childEvents) {
          const stateKey = event.getStateKey()
          if (!stateKey) continue
          const content = event.getContent()
          // Empty content means the child was removed
          if (!content || Object.keys(content).length === 0) continue

          // Check if child is also a space
          const childRoom = client.getRoom(stateKey)
          if (childRoom) {
            const childCreate = childRoom.currentState.getStateEvents('m.room.create', '')
            if (childCreate?.getContent()?.type === 'm.space') {
              childSpaceIds.push(stateKey)
            } else {
              childRoomIds.push(stateKey)
            }
          } else {
            childRoomIds.push(stateKey)
          }
        }
      }

      spaces.push({
        roomId: room.roomId,
        name: room.name || 'Unnamed Space',
        avatarUrl: getAvatarUrl(room.getMxcAvatarUrl()),
        topic: room.currentState.getStateEvents('m.room.topic', '')?.getContent()?.topic || null,
        childRoomIds,
        childSpaceIds,
      })
    }

    set({ spaces })
  },

  setActiveSpace: (spaceId) => {
    set({ activeSpaceId: spaceId })
  },

  setActiveRoom: (room) => {
    // Restore cached messages instantly to avoid flash-of-empty spinner
    const cached = room ? messageCache.get(room.roomId) : undefined
    set({
      activeRoom: room,
      messages: cached || [],
      typingUsers: [],
      // Only show spinner when there's no cached data to display
      isLoadingMessages: room ? !cached : false,
    })
    if (room) {
      get().loadMessages(room.roomId)
    }
  },

  loadMessages: async (roomId) => {
    // Only show loading spinner on initial load (empty messages), not on refreshes.
    // This prevents a brief spinner flash every time the message list is updated.
    const isInitialLoad = get().messages.length === 0
    if (isInitialLoad) {
      set({ isLoadingMessages: true })
    }
    const client = getMatrixClient()
    if (!client) {
      set({ isLoadingMessages: false })
      return
    }

    const room = client.getRoom(roomId)
    if (!room) {
      set({ isLoadingMessages: false })
      return
    }

    try {
      // Ensure full member list is loaded (lazy loading may have deferred this)
      await room.loadMembersIfNeeded().catch(() => {})

      // Paginate backwards to load more history if the timeline is small.
      // Only do this on initial load — not on every refresh triggered by sync/send.
      const timelineSet = room.getLiveTimeline()
      const events = timelineSet.getEvents()
      if (isInitialLoad && events.length < 50) {
        try {
          await client.scrollback(room, 50)
        } catch {
          // Pagination may fail for some rooms, that's ok
        }
      }

      // Re-check active room: if user switched rooms during scrollback, bail out
      if (get().activeRoom?.roomId !== roomId) {
        set({ isLoadingMessages: false })
        return
      }

      const timeline = [...room.getLiveTimeline().getEvents(), ...room.getPendingEvents()]

      // Build reaction index once: Map<targetEventId, Map<emoji, summary>>
      // This avoids O(messages × timeline) scanning inside eventToMatrixMessage.
      const reactionIndex = new Map<string, Map<string, { count: number; users: string[]; includesMe: boolean }>>()
      const userId = getUserId()
      for (const e of timeline) {
        if (e.getType() !== 'm.reaction') continue
        const rel = e.getContent()['m.relates_to']
        if (!rel?.event_id || !rel?.key) continue
        let msgReactions = reactionIndex.get(rel.event_id)
        if (!msgReactions) {
          msgReactions = new Map()
          reactionIndex.set(rel.event_id, msgReactions)
        }
        const emoji = rel.key
        const existing = msgReactions.get(emoji) || { count: 0, users: [], includesMe: false }
        existing.count++
        const senderName = room.getMember(e.getSender()!)?.name || e.getSender()!
        existing.users.push(senderName)
        if (e.getSender() === userId) existing.includesMe = true
        msgReactions.set(emoji, existing)
      }
      // Attach index to room object for eventToMatrixMessage to read
      setReactionIndex(room, reactionIndex)

      const seen = new Set<string>()
      const newMessages: MatrixMessage[] = []
      for (const e of timeline) {
        try {
          const id = e.getId()
          if (id && seen.has(id)) continue // deduplicate
          if (id) seen.add(id)

          // Filter out edit/replacement events — the original message already
          // picks up the edited content via replacingEvent(). Showing the
          // replacement event as a separate message causes duplicates.
          const relatesTo = e.getContent()?.['m.relates_to']
          if (relatesTo?.rel_type === 'm.replace') continue

          const msg = eventToMatrixMessage(e, room)
          if (msg) newMessages.push(msg)
        } catch {
          // Skip events that fail to convert rather than losing all messages
        }
      }
      // Ensure chronological order (bridged/decrypted events can arrive out of order)
      newMessages.sort((a, b) => a.timestamp - b.timestamp)

      // Propagate read status backwards: if a later own message is 'read',
      // all earlier own messages should also be 'read' (read receipts in Matrix
      // are implicit acknowledgement of all prior messages).
      let sawRead = false
      for (let i = newMessages.length - 1; i >= 0; i--) {
        const msg = newMessages[i]
        if (msg.senderId !== userId) continue
        if (msg.status === 'read') {
          sawRead = true
        } else if (sawRead && (msg.status === 'delivered' || msg.status === 'sent')) {
          newMessages[i] = { ...msg, status: 'read' }
        }
      }

      // Quick equality check: skip setState if messages haven't actually changed.
      // Compare by length, then key fields of each message to avoid unnecessary re-renders.
      const existing = get().messages
      let changed = existing.length !== newMessages.length
      if (!changed) {
        for (let i = 0; i < newMessages.length; i++) {
          const a = existing[i]
          const b = newMessages[i]
          if (
            a.eventId !== b.eventId ||
            a.timestamp !== b.timestamp ||
            a.content !== b.content ||
            a.isEdited !== b.isEdited ||
            a.isRedacted !== b.isRedacted ||
            a.reactions.size !== b.reactions.size ||
            a.readBy.length !== b.readBy.length ||
            a.status !== b.status
          ) {
            changed = true
            break
          }
        }
      }

      if (changed) {
        messageCache.set(roomId, newMessages)
        set({ messages: newMessages, isLoadingMessages: false })
      } else {
        set({ isLoadingMessages: false })
      }

      // Rebuild room data from SDK now that timeline loading has resolved
      // member state. With lazy-loaded members, the room list is often built
      // before member data (including avatars) is available.
      const updatedRoom = roomToMatrixRoom(room)
      const currentRooms = get().rooms
      const roomIdx = currentRooms.findIndex(r => r.roomId === roomId)
      if (roomIdx !== -1) {
        const currentRoom = currentRooms[roomIdx]
        // Preserve fields that roomToMatrixRoom doesn't track
        const mergedRoom = {
          ...updatedRoom,
          isArchived: currentRoom.isArchived,
        }
        if (
          mergedRoom.avatarUrl !== currentRoom.avatarUrl ||
          mergedRoom.members.length !== currentRoom.members.length ||
          mergedRoom.members.some((m, i) => m.avatarUrl !== currentRoom.members[i]?.avatarUrl)
        ) {
          const updated = [...currentRooms]
          updated[roomIdx] = mergedRoom
          set((state) => ({
            rooms: updated,
            activeRoom: state.activeRoom?.roomId === roomId ? mergedRoom : state.activeRoom,
          }))
        }
      }
      // After loading the active room, prefetch adjacent rooms in the list
      if (isInitialLoad && get().activeRoom?.roomId === roomId) {
        const currentRooms = get().rooms.filter(r => !r.isArchived)
        const idx = currentRooms.findIndex(r => r.roomId === roomId)
        if (idx !== -1) {
          // Grab up to 3 neighbors (next rooms in list, wrapping if needed)
          const adjacentIds: string[] = []
          for (let offset = 1; offset <= 3 && offset < currentRooms.length; offset++) {
            const neighbor = currentRooms[(idx + offset) % currentRooms.length]
            if (neighbor.roomId !== roomId) adjacentIds.push(neighbor.roomId)
          }
          get().prefetchAdjacentRooms(adjacentIds)
        }
      }
    } catch (err) {
      console.error('Failed to load messages for room', roomId, err)
      set({ isLoadingMessages: false })
    }
  },

  sendMessage: (roomId, content, replyToEventId) => {
    const client = getMatrixClient()
    if (!client) return

    const userId = getUserId()
    if (!userId) return

    // Build the message content for the Matrix API
    const msgContent: Record<string, unknown> = {
      msgtype: 'm.text',
      body: content,
    }

    if (replyToEventId) {
      const room = client.getRoom(roomId)
      const replyEvt = room?.findEventById(replyToEventId)
      if (replyEvt) {
        const replyBody = replyEvt.getContent().body || ''
        const replySender = replyEvt.getSender()
        msgContent.body = `> <${replySender}> ${replyBody}\n\n${content}`
        msgContent.format = 'org.matrix.custom.html'
        const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        msgContent.formatted_body = `<mx-reply><blockquote><a href="https://matrix.to/#/${encodeURIComponent(roomId)}/${encodeURIComponent(replyToEventId)}">In reply to</a> <a href="https://matrix.to/#/${encodeURIComponent(replySender || '')}">${escHtml(replySender || '')}</a><br>${escHtml(replyBody)}</blockquote></mx-reply>${escHtml(content)}`
        msgContent['m.relates_to'] = {
          'm.in_reply_to': { event_id: replyToEventId },
        }
      }
    }

    // Send via SDK — the SDK creates a pending event synchronously (before the
    // network request), adds it to room.getPendingEvents(), and fires a Timeline
    // event. We rely on this SDK pending event as the local echo instead of
    // creating our own optimistic message, which caused double-message flashes.
    ;(async () => {
      try {
        await sendEvent(client, roomId, 'm.room.message', msgContent)
      } catch (err) {
        console.error('Failed to send message:', err)
      }
      // Refresh after send completes to update status (sent/failed)
      if (get().activeRoom?.roomId === roomId) {
        get().loadMessages(roomId)
      }
    })()

    // Immediately reload messages to pick up the SDK's pending event.
    // The SDK has already created it synchronously before sendEvent's first await.
    get().loadMessages(roomId)
  },

  retryMessage: (eventId) => {
    const client = getMatrixClient()
    if (!client) return

    const room = client.getRoom(get().activeRoom?.roomId || '')
    if (!room) return

    // Find the failed event in the SDK's pending events and resend it
    const pendingEvent = room.getPendingEvents().find(e => e.getId() === eventId)
    if (pendingEvent) {
      client.resendEvent(pendingEvent, room).catch(err => {
        console.error('Failed to resend message:', err)
      })
      // Refresh to show updated status
      const roomId = room.roomId
      if (get().activeRoom?.roomId === roomId) {
        get().loadMessages(roomId)
      }
      return
    }

    // Fallback: if SDK event not found, find in our messages and re-send
    const messages = get().messages
    const failedMsg = messages.find(m => m.eventId === eventId && m.status === 'failed')
    if (failedMsg) {
      get().sendMessage(failedMsg.roomId, failedMsg.content, failedMsg.replyToEvent?.eventId)
    }
  },

  retryAllFailed: () => {
    const msgs = get().messages.filter(m => m.status === 'failed')
    msgs.forEach(m => {
      get().retryMessage(m.eventId)
    })
  },

  editMessage: async (roomId, eventId, newContent) => {
    const client = getMatrixClient()
    if (!client) return

    // Sanitize edit content — strip HTML tags to prevent stored XSS.
    // The display layer (DOMPurify) is the primary defense, but sanitizing
    // at send prevents storing malicious content server-side.
    const sanitized = newContent.replace(/<[^>]*>/g, '')

    await sendEvent(client, roomId, 'm.room.message', {
      msgtype: 'm.text',
      body: `* ${sanitized}`,
      'm.new_content': {
        msgtype: 'm.text',
        body: sanitized,
      },
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: eventId,
      },
    })
  },

  redactMessage: async (roomId, eventId) => {
    const client = getMatrixClient()
    if (!client) return
    await client.redactEvent(roomId, eventId)
  },

  sendReaction: async (roomId, eventId, emoji) => {
    const client = getMatrixClient()
    if (!client) return

    const userId = getUserId()
    const room = client.getRoom(roomId)
    if (!room) return

    // Use the pre-built reaction index if available to find existing reaction
    // in O(1), falling back to timeline scan only if needed.
    let existingEventId: string | null = null
    const reactionIndex = getReactionIndex(room)
    if (reactionIndex) {
      const msgReactions = reactionIndex.get(eventId)
      if (msgReactions?.get(emoji)?.includesMe) {
        // Find the actual event ID to redact — need to scan only reaction events
        const events = room.getLiveTimeline().getEvents()
        for (const e of events) {
          if (
            e.getType() === 'm.reaction' &&
            e.getSender() === userId &&
            e.getContent()['m.relates_to']?.event_id === eventId &&
            e.getContent()['m.relates_to']?.key === emoji
          ) {
            existingEventId = e.getId()!
            break
          }
        }
      }
    } else {
      // Fallback: scan timeline
      const events = room.getLiveTimeline().getEvents()
      const existing = events.find(
        (e) =>
          e.getType() === 'm.reaction' &&
          e.getSender() === userId &&
          e.getContent()['m.relates_to']?.event_id === eventId &&
          e.getContent()['m.relates_to']?.key === emoji
      )
      if (existing) existingEventId = existing.getId()!
    }

    if (existingEventId) {
      await client.redactEvent(roomId, existingEventId)
    } else {
      await sendEvent(client, roomId, 'm.reaction', {
        'm.relates_to': {
          rel_type: 'm.annotation',
          event_id: eventId,
          key: emoji,
        },
      })
    }
  },

  createDirectChat: async (userId) => {
    const client = getMatrixClient()
    if (!client) throw new Error('Not connected')

    const result = await client.createRoom({
      is_direct: true,
      invite: [userId],
      preset: 'trusted_private_chat' as sdk.Preset,
    })

    // Mark as direct message
    const dmMap = getAccountDataContent(client, 'm.direct') as Record<string, string[]>
    const existing = dmMap[userId] || []
    dmMap[userId] = [...existing, result.room_id]
    await setAccountData(client, 'm.direct', dmMap)

    return result.room_id
  },

  createGroupChat: async (name, userIds, options) => {
    const client = getMatrixClient()
    if (!client) throw new Error('Not connected')

    const roomOptions: Record<string, unknown> = {
      name,
      invite: userIds,
      preset: options?.isPublic ? 'public_chat' as sdk.Preset : 'private_chat' as sdk.Preset,
    }

    if (options?.isPublic) {
      roomOptions.visibility = 'public'
    }

    if (options?.topic) {
      roomOptions.topic = options.topic
    }

    if (options?.encrypted !== false) {
      roomOptions.initial_state = [
        {
          type: 'm.room.encryption',
          state_key: '',
          content: { algorithm: 'm.megolm.v1.aes-sha2' },
        },
      ]
    }

    const result = await client.createRoom(roomOptions)

    return result.room_id
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  markAsRead: async (roomId) => {
    // Immediately clear the unread count in local state
    const state = get()
    const updateRoom = (r: MatrixRoom) =>
      r.roomId === roomId ? { ...r, unreadCount: 0 } : r
    set({
      rooms: state.rooms.map(updateRoom),
      activeRoom: state.activeRoom?.roomId === roomId
        ? { ...state.activeRoom, unreadCount: 0 }
        : state.activeRoom,
    })

    const client = getMatrixClient()
    if (!client) return

    const room = client.getRoom(roomId)
    if (!room) return

    const events = room.getLiveTimeline().getEvents()
    // Find the last event with a real server-assigned ID (skip local echoes starting with ~)
    const lastEvent = events.findLast(e => {
      const id = e.getId()
      return id && !id.startsWith('~')
    })
    if (lastEvent) {
      try {
        await client.sendReadReceipt(lastEvent)
      } catch {
        // Read receipt may fail for some events, ignore
      }
    }
  },

  sendTyping: (roomId, typing) => {
    const client = getMatrixClient()
    if (!client) return
    // Throttle "typing=true" to avoid hitting homeserver rate limits (429)
    if (typing) {
      const now = Date.now()
      if (now - _lastTypingSentAt < TYPING_THROTTLE_MS) return
      _lastTypingSentAt = now
    }
    client.sendTyping(roomId, typing, typing ? 30000 : 0).catch(() => {
      // Silently ignore typing notification failures (e.g. 429 rate limit)
    })
  },

  refreshRoom: (roomId) => {
    const client = getMatrixClient()
    if (!client) return
    const room = client.getRoom(roomId)
    if (!room) return

    const updatedRoom = roomToMatrixRoom(room)

    set((state) => {
      const oldRoom = state.rooms.find(r => r.roomId === roomId)
      let updatedRooms = state.rooms.map((r) =>
        r.roomId === roomId ? updatedRoom : r
      )
      // Only re-sort if the timestamp actually changed (new message arrived)
      if (oldRoom && updatedRoom.lastMessageTs !== oldRoom.lastMessageTs) {
        updatedRooms = updatedRooms.sort((a, b) => b.lastMessageTs - a.lastMessageTs)
      }
      return {
        rooms: updatedRooms,
        activeRoom: state.activeRoom?.roomId === roomId ? updatedRoom : state.activeRoom,
      }
    })

  },

  archiveRoom: async (roomId) => {
    const client = getMatrixClient()
    if (!client) return
    await client.setRoomTag(roomId, 'm.lowpriority', { order: 0.5 })
    get().loadRooms()
  },

  unarchiveRoom: async (roomId) => {
    const client = getMatrixClient()
    if (!client) return
    await client.deleteRoomTag(roomId, 'm.lowpriority')
    get().loadRooms()
  },

  uploadFile: async (roomId, file) => {
    const client = getMatrixClient()
    if (!client) return

    // Import upload store for progress tracking
    const { useUploadStore } = await import('./upload-store')
    const uploadStore = useUploadStore.getState()
    const taskId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    uploadStore.addTask({
      id: taskId,
      roomId,
      fileName: file.name,
      fileSize: file.size,
    })

    try {
      // Validate file size (100MB max)
      const MAX_FILE_SIZE = 100 * 1024 * 1024
      if (file.size > MAX_FILE_SIZE) {
        throw new Error('File too large. Maximum size is 100MB.')
      }

      // Validate file type — block dangerous MIME types and extensions
      const BLOCKED_MIMES = ['text/html', 'application/xhtml+xml', 'application/x-httpd-php', 'application/javascript', 'text/javascript']
      const BLOCKED_EXTENSIONS = ['.html', '.htm', '.xhtml', '.php', '.js', '.mjs', '.exe', '.bat', '.cmd', '.msi', '.ps1', '.sh']
      const ext = ('.' + (file.name.split('.').pop() || '')).toLowerCase()
      if (BLOCKED_MIMES.includes(file.type)) {
        throw new Error(`File type "${file.type}" is not allowed for security reasons.`)
      }
      if (BLOCKED_EXTENSIONS.includes(ext)) {
        throw new Error(`File extension "${ext}" is not allowed for security reasons.`)
      }
      // Strip SVG files that may contain embedded scripts
      if (file.type === 'image/svg+xml' || ext === '.svg') {
        throw new Error('SVG files are not allowed — they can contain executable code.')
      }
      // Upload file via fetch (through our CORS proxy) instead of XHR.
      // The SDK's uploadContent uses XMLHttpRequest by default, which
      // goes directly to the homeserver and fails due to CORS.
      // Temporarily hide XHR so the SDK falls back to fetch.
      const origXHR = globalThis.XMLHttpRequest
      try {
        ;(globalThis as any).XMLHttpRequest = undefined
        var uploadResponse = await client.uploadContent(file, {
          name: file.name,
          type: file.type,
        })
      } finally {
        globalThis.XMLHttpRequest = origXHR
      }
      const mxcUrl = uploadResponse.content_uri

      uploadStore.setStatus(taskId, 'sending')

      // Determine message type based on file MIME type
      let msgtype = 'm.file'
      if (file.type.startsWith('image/')) msgtype = 'm.image'
      else if (file.type.startsWith('video/')) msgtype = 'm.video'
      else if (file.type.startsWith('audio/')) msgtype = 'm.audio'

      const content: Record<string, unknown> = {
        msgtype,
        body: file.name,
        url: mxcUrl,
        info: {
          mimetype: file.type,
          size: file.size,
        },
      }

      // Mark voice messages with MSC3245 voice flag for bridge compatibility
      if (msgtype === 'm.audio' && file.name.startsWith('voice-message-')) {
        content['org.matrix.msc3245.voice'] = {}
      }

      // For images, try to get dimensions
      if (msgtype === 'm.image') {
        try {
          const dimensions = await getImageDimensions(file)
          ;(content.info as Record<string, unknown>).w = dimensions.width
          ;(content.info as Record<string, unknown>).h = dimensions.height
        } catch { /* ignore */ }
      }

      await sendEvent(client, roomId, 'm.room.message', content)
      uploadStore.setStatus(taskId, 'done')
    } catch (err) {
      uploadStore.setStatus(taskId, 'failed', err instanceof Error ? err.message : 'Upload failed')
      throw err
    }
  },

  leaveRoom: async (roomId) => {
    const client = getMatrixClient()
    if (!client) return

    // If this is the active room, clear it first
    if (get().activeRoom?.roomId === roomId) {
      set({ activeRoom: null, messages: [] })
    }

    // Clean up caches for this room
    messageCache.delete(roomId)
    prefetchedRooms.delete(roomId)

    await client.leave(roomId)
    // Optionally forget (removes from room list permanently)
    try {
      await client.forget(roomId)
    } catch {
      // forget may fail if server doesn't support it
    }
    get().loadRooms()
  },

  setRoomName: async (roomId: string, name: string) => {
    const client = getMatrixClient()
    if (!client) return

    try {
      await client.setRoomName(roomId, name)
      get().loadRooms()
      get().refreshRoom(roomId)
    } catch (err) {
      console.error('Failed to set room name:', err)
      throw err
    }
  },

  setRoomTopic: async (roomId: string, topic: string) => {
    const client = getMatrixClient()
    if (!client) return

    try {
      await client.setRoomTopic(roomId, topic)
      get().loadRooms()
      get().refreshRoom(roomId)
    } catch (err) {
      console.error('Failed to set room topic:', err)
      throw err
    }
  },

  inviteMember: async (roomId: string, userId: string) => {
    const client = getMatrixClient()
    if (!client) return

    try {
      await client.invite(roomId, userId)
      get().loadRooms()
      get().refreshRoom(roomId)
    } catch (err) {
      console.error('Failed to invite member:', err)
      throw err
    }
  },

  enableEncryption: async (roomId: string) => {
    const client = getMatrixClient()
    if (!client) return

    try {
      await sendStateEvent(client, roomId, 'm.room.encryption', {
        algorithm: 'm.megolm.v1.aes-sha2',
      }, '')
      get().loadRooms()
      get().refreshRoom(roomId)
    } catch (err) {
      console.error('Failed to enable encryption:', err)
      throw err
    }
  },

  acceptInvite: async (roomId: string) => {
    const client = getMatrixClient()
    if (!client) throw new Error('Matrix client not initialized')

    try {
      await client.joinRoom(roomId)
      // Wait briefly for the sync to process the membership change
      await new Promise(r => setTimeout(r, 500))
      await get().loadRooms()
      // If the room is now joined, select it
      const room = client.getRoom(roomId)
      if (room && room.getMyMembership() === 'join') {
        const rooms = get().rooms
        const joined = rooms.find(r => r.roomId === roomId)
        if (joined) {
          get().setActiveRoom(joined)
        }
      }
    } catch (err) {
      console.error('Failed to accept invite:', err)
      throw err
    }
  },

  rejectInvite: async (roomId: string) => {
    const client = getMatrixClient()
    if (!client) throw new Error('Matrix client not initialized')

    try {
      await client.leave(roomId)
      await get().loadRooms()
    } catch (err) {
      console.error('Failed to reject invite:', err)
      throw err
    }
  },

  setDisplayName: async (name: string) => {
    const client = getMatrixClient()
    if (!client) return

    try {
      await client.setDisplayName(name)
    } catch (err) {
      console.error('Failed to set display name:', err)
      throw err
    }
  },

  joinRoom: async (roomIdOrAlias: string) => {
    const client = getMatrixClient()
    if (!client) return

    try {
      await client.joinRoom(roomIdOrAlias)
      get().loadRooms()
    } catch (err) {
      console.error('Failed to join room:', err)
      throw err
    }
  },

  pinMessage: async (roomId: string, eventId: string) => {
    const client = getMatrixClient()
    if (!client) return

    try {
      const room = client.getRoom(roomId)
      if (!room) return
      const pinEvent = room.currentState.getStateEvents('m.room.pinned_events', '')
      const currentPinned: string[] = pinEvent?.getContent()?.pinned || []
      if (currentPinned.includes(eventId)) return
      await sendStateEvent(client, roomId, 'm.room.pinned_events', { pinned: [...currentPinned, eventId] }, '')
    } catch (err) {
      console.error('Failed to pin message:', err)
      throw err
    }
  },

  unpinMessage: async (roomId: string, eventId: string) => {
    const client = getMatrixClient()
    if (!client) return

    try {
      const room = client.getRoom(roomId)
      if (!room) return
      const pinEvent = room.currentState.getStateEvents('m.room.pinned_events', '')
      const currentPinned: string[] = pinEvent?.getContent()?.pinned || []
      const updated = currentPinned.filter((id: string) => id !== eventId)
      await sendStateEvent(client, roomId, 'm.room.pinned_events', { pinned: updated }, '')
    } catch (err) {
      console.error('Failed to unpin message:', err)
      throw err
    }
  },

  searchMessages: async (query: string) => {
    const client = getMatrixClient()
    if (!client) return []

    try {
      const response = await searchRoomEvents(client, { term: query })
      return (response?.results || []).map((r: any) => ({
        roomId: r.result?.room_id || '',
        roomName: client.getRoom(r.result?.room_id)?.name || r.result?.room_id,
        eventId: r.result?.event_id || '',
        sender: r.result?.sender || '',
        body: r.result?.content?.body || '',
        timestamp: r.result?.origin_server_ts || 0,
      })).slice(0, 20)
    } catch (err) {
      console.error('Search failed:', err)
      return []
    }
  },

  forwardMessage: async (fromRoomId: string, eventId: string, toRoomId: string) => {
    const client = getMatrixClient()
    if (!client) return

    try {
      const room = client.getRoom(fromRoomId)
      if (!room) return
      const event = room.findEventById(eventId)
      if (!event) return

      const clearFwd = getClearContent(event) as Record<string, any> | null
      const content = clearFwd || event.getContent()
      const msgtype = content.msgtype || 'm.text'

      if (msgtype === 'm.image' || msgtype === 'm.video' || msgtype === 'm.audio' || msgtype === 'm.file') {
        await sendEvent(client, toRoomId, 'm.room.message', {
          msgtype,
          body: content.body || '',
          url: content.url,
          info: content.info || {},
        })
      } else {
        const forwardContent: Record<string, unknown> = {
          msgtype: 'm.text',
          body: content.body || '',
        }
        // Don't forward formatted_body to avoid propagating unsanitized HTML
        await sendEvent(client, toRoomId, 'm.room.message', forwardContent)
      }
    } catch (err) {
      console.error('Failed to forward message:', err)
      throw err
    }
  },

  ignoredUsers: [],

  loadIgnoredUsers: () => {
    const client = getMatrixClient()
    if (!client) return
    const content = getAccountDataContent(client, 'm.ignored_user_list') as Record<string, any>
    const ignored = content?.ignored_users ? Object.keys(content.ignored_users) : []
    set({ ignoredUsers: ignored })
  },

  ignoreUser: async (userId) => {
    const client = getMatrixClient()
    if (!client) return
    const content = getAccountDataContent(client, 'm.ignored_user_list') as Record<string, any> || {}
    const ignoredUsers = { ...(content.ignored_users || {}), [userId]: {} }
    await setAccountData(client, 'm.ignored_user_list', { ignored_users: ignoredUsers })
    set({ ignoredUsers: Object.keys(ignoredUsers) })
  },

  unignoreUser: async (userId) => {
    const client = getMatrixClient()
    if (!client) return
    const content = getAccountDataContent(client, 'm.ignored_user_list') as Record<string, any> || {}
    const ignoredUsers = { ...(content.ignored_users || {}) }
    delete ignoredUsers[userId]
    await setAccountData(client, 'm.ignored_user_list', { ignored_users: ignoredUsers })
    set({ ignoredUsers: Object.keys(ignoredUsers) })
  },

  setRoomNotificationSetting: async (roomId, setting) => {
    const client = getMatrixClient()
    if (!client) return
    try {
      // Remove existing override and room rules first
      try { await (client as any).deletePushRule('global', 'override', roomId) } catch {}
      try { await (client as any).deletePushRule('global', 'room', roomId) } catch {}

      if (setting === 'mute') {
        await (client as any).addPushRule('global', 'override', roomId, {
          actions: ['dont_notify'],
          conditions: [{ kind: 'event_match', key: 'room_id', pattern: roomId }],
        })
      } else if (setting === 'mentions') {
        await (client as any).addPushRule('global', 'room', roomId, {
          actions: ['dont_notify'],
        })
      }
      // 'all' = default behavior, no rules needed
    } catch (err) {
      console.error('Failed to set notification setting:', err)
    }
  },

  getRoomNotificationSetting: (roomId) => {
    const client = getMatrixClient()
    if (!client) return 'all'
    try {
      const pushRules = (client as any).pushRules
      if (!pushRules?.global) return 'all'
      // Check override rules for mute
      const overrides = pushRules.global.override || []
      for (const rule of overrides) {
        if (rule.rule_id === roomId && rule.enabled) {
          const hasDontNotify = rule.actions?.includes('dont_notify') || rule.actions?.length === 0
          if (hasDontNotify) return 'mute'
        }
      }
      // Check room rules for mentions only
      const roomRules = pushRules.global.room || []
      for (const rule of roomRules) {
        if (rule.rule_id === roomId && rule.enabled) {
          const hasDontNotify = rule.actions?.includes('dont_notify') || rule.actions?.length === 0
          if (hasDontNotify) return 'mentions'
        }
      }
    } catch {}
    return 'all'
  },

  kickMember: async (roomId, userId, reason) => {
    const client = getMatrixClient()
    if (!client) return
    await (client as any).kick(roomId, userId, reason)
    get().refreshRoom(roomId)
  },

  banMember: async (roomId, userId, reason) => {
    const client = getMatrixClient()
    if (!client) return
    await (client as any).ban(roomId, userId, reason)
    get().refreshRoom(roomId)
  },

  unbanMember: async (roomId, userId) => {
    const client = getMatrixClient()
    if (!client) return
    await (client as any).unban(roomId, userId)
    get().refreshRoom(roomId)
  },

  setPowerLevel: async (roomId, userId, level) => {
    const client = getMatrixClient()
    if (!client) return
    const room = client.getRoom(roomId)
    if (!room) return
    const plEvent = room.currentState.getStateEvents('m.room.power_levels', '')
    if (!plEvent) return
    const content = { ...plEvent.getContent() }
    content.users = { ...content.users, [userId]: level }
    await sendStateEvent(client, roomId, 'm.room.power_levels', content)
    get().refreshRoom(roomId)
  },

  // Persist failed messages to localStorage for recovery
  _persistFailedMessages: () => {
    const failed = get().messages.filter(m => m.status === 'failed')
    if (failed.length > 0) {
      try {
        const serializable = failed.map(m => ({
          eventId: m.eventId,
          roomId: m.roomId,
          content: m.content,
          timestamp: m.timestamp,
        }))
        localStorage.setItem('matrix_failed_messages', JSON.stringify(serializable))
      } catch { /* ignore */ }
    } else {
      localStorage.removeItem('matrix_failed_messages')
    }
  },

  loadFavorites: () => {
    const client = getMatrixClient()
    if (!client) return
    const favIds: string[] = []
    for (const room of client.getRooms()) {
      const tags = room.tags || {}
      if ('m.favourite' in tags) {
        favIds.push(room.roomId)
      }
    }
    set({ favoriteRoomIds: favIds })
  },

  toggleFavorite: async (roomId: string) => {
    const client = getMatrixClient()
    if (!client) throw new Error('Not logged in')
    const { favoriteRoomIds } = get()
    const isFav = favoriteRoomIds.includes(roomId)
    if (isFav) {
      await client.deleteRoomTag(roomId, 'm.favourite')
      set({ favoriteRoomIds: favoriteRoomIds.filter(id => id !== roomId) })
    } else {
      await client.setRoomTag(roomId, 'm.favourite', { order: 0.5 })
      set({ favoriteRoomIds: [...favoriteRoomIds, roomId] })
    }
  },

  loadNotificationKeywords: () => {
    const client = getMatrixClient()
    if (!client) return
    const data = getAccountDataContent(client, 'im.vector.setting.notification_keywords') as { keywords?: string[] }
    if (data?.keywords) {
      set({ notificationKeywords: data.keywords })
    }
  },

  setNotificationKeywords: async (keywords: string[]) => {
    const client = getMatrixClient()
    if (!client) throw new Error('Not logged in')
    await setAccountData(client, 'im.vector.setting.notification_keywords', { keywords })
    set({ notificationKeywords: keywords })
  },

  updateUnreadThreadCount: () => {
    const client = getMatrixClient()
    if (!client) return
    let count = 0
    const rooms = client.getRooms()
    for (const room of rooms) {
      const threadRoots = room.getThreads()
      for (const thread of threadRoots) {
        const unread = (thread as any).getUnreadNotificationCount?.('total') ?? 0
        count += unread
      }
    }
    set({ unreadThreadCount: count })
  },

  prefetchRoom: (roomId) => {
    // Skip if already prefetched or currently prefetching
    if (prefetchedRooms.has(roomId) || prefetchingRooms.has(roomId)) return
    // Skip if this is the active room (already loaded)
    if (get().activeRoom?.roomId === roomId) return

    const client = getMatrixClient()
    if (!client) return
    const room = client.getRoom(roomId)
    if (!room) return

    prefetchingRooms.add(roomId)
    ;(async () => {
      try {
        // Load members and paginate timeline into the SDK cache.
        // This does NOT update Zustand state — it just warms the SDK data
        // so that loadMessages() is near-instant when the room is selected.
        await room.loadMembersIfNeeded().catch(() => {})
        const events = room.getLiveTimeline().getEvents()
        if (events.length < 50) {
          await client.scrollback(room, 50).catch(() => {})
        }
        prefetchedRooms.add(roomId)
      } catch {
        // Prefetch is best-effort
      } finally {
        prefetchingRooms.delete(roomId)
      }
    })()
  },

  prefetchAdjacentRooms: (roomIds) => {
    // Prefetch up to 3 rooms, prioritizing those with unread messages
    const rooms = get().rooms
    const unreadFirst = roomIds
      .map(id => rooms.find(r => r.roomId === id))
      .filter(Boolean)
      .sort((a, b) => (b!.unreadCount > 0 ? 1 : 0) - (a!.unreadCount > 0 ? 1 : 0))
      .slice(0, 3)

    for (const room of unreadFirst) {
      get().prefetchRoom(room!.roomId)
    }
  },

  resetState: () => {
    clearProfileCache()
    messageCache.clear()
    prefetchedRooms.clear()
    prefetchingRooms.clear()
    set({
      rooms: [],
      pendingInvites: [],
      activeRoom: null,
      messages: [],
      isLoadingMessages: false,
      typingUsers: [],
      searchQuery: '',
      ignoredUsers: [],
      threadMessages: [],
      isLoadingThread: false,
      activeThreadId: null,
      spaces: [],
      activeSpaceId: null,
      unreadThreadCount: 0,
      favoriteRoomIds: [],
      notificationKeywords: [],
    })
  },
}))

function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.width, height: img.height })
      URL.revokeObjectURL(img.src)
    }
    img.onerror = () => {
      URL.revokeObjectURL(img.src)
      reject(new Error('Failed to load image'))
    }
    img.src = URL.createObjectURL(file)
  })
}

// Need to import sdk for Preset type
import * as sdk from 'matrix-js-sdk'

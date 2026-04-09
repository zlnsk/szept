'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useChatStore, type MatrixMessage } from '@/stores/chat-store'
import { resolveRoomAvatarFromSDK } from '@/lib/matrix/client'
import { Avatar } from '@/components/ui/avatar'
import { MessageBubble } from './message-bubble'
import { MessageInput } from './message-input'
import { ChatHeader } from './chat-header'
import { RoomInfoPanel } from './room-info-panel'
import { ThreadPanel } from './thread-panel'
import {
  Search,
  X,
  Pin,
  Upload,
} from 'lucide-react'
import { getMatrixClient } from '@/lib/matrix/client'
import { useUploadStore } from '@/stores/upload-store'
import { format, isToday, isYesterday } from 'date-fns'

export function ChatArea() {
  const user = useAuthStore(s => s.user)
  const { activeRoom, messages, isLoadingMessages, sendMessage, typingUsers, archiveRoom, unarchiveRoom, setActiveRoom, leaveRoom, setRoomName, setRoomTopic, inviteMember, enableEncryption, ignoreUser, unignoreUser, setRoomNotificationSetting, getRoomNotificationSetting, kickMember, banMember, setPowerLevel } = useChatStore()
  const ignoredUsers = useChatStore(s => s.ignoredUsers)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [replyTo, setReplyTo] = useState<MatrixMessage | null>(null)
  const [showSearch, setShowSearch] = useState(false)
  const searchBarRef = useRef<HTMLDivElement>(null)
  const [chatSearch, setChatSearch] = useState('')
  const [showRoomInfo, setShowRoomInfo] = useState(false)
  const [showPinnedBanner, setShowPinnedBanner] = useState(true)
  const [externalLinkConfirm, setExternalLinkConfirm] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [newMessageCount, setNewMessageCount] = useState(0)
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [trustedDomains, setTrustedDomains] = useState<string[]>([])
  const [readMarkerEventId, setReadMarkerEventId] = useState<string | null>(null)
  const [showResumeReading, setShowResumeReading] = useState(false)
  const [resumeEventId, setResumeEventId] = useState<string | null>(null)

  // Intercept external link clicks in message content
  const handleContentClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    const anchor = target.closest('a[href]') as HTMLAnchorElement | null
    if (!anchor) return
    const href = anchor.getAttribute('href')
    if (!href) return

    // Allow matrix.to links and same-origin
    try {
      const url = new URL(href, window.location.origin)
      if (url.origin === window.location.origin) return
      if (url.hostname === 'matrix.to') return

      // Check trusted domains (session-scoped, not persisted)
      if (trustedDomains.includes(url.hostname)) return

      // Block and show confirmation
      e.preventDefault()
      e.stopPropagation()
      setExternalLinkConfirm(href)
    } catch {
      // Invalid URL — let browser handle
    }
  }, [trustedDomains])

  // Memoize pinned event IDs
  const pinnedEventIds = useMemo(() => {
    if (!activeRoom) return []
    const client = getMatrixClient()
    if (!client) return []
    const room = client.getRoom(activeRoom.roomId)
    if (!room) return []
    const pinEvent = room.currentState.getStateEvents('m.room.pinned_events', '')
    return (pinEvent?.getContent()?.pinned || []) as string[]
  }, [activeRoom?.roomId])

  const prevRoomIdRef = useRef<string | null>(null)
  const stickyRef = useRef(true)

  const isAtBottom = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }, [])

  const scrollToBottom = useCallback((instant?: boolean) => {
    const el = scrollContainerRef.current
    if (!el) return
    if (instant) {
      el.scrollTop = el.scrollHeight
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }, [])

  // Track user scroll
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const onScroll = () => { stickyRef.current = isAtBottom() }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [isAtBottom])

  // On room switch: reset sticky, close details panel, set read marker
  useEffect(() => {
    if (activeRoom && activeRoom.roomId !== prevRoomIdRef.current) {
      prevRoomIdRef.current = activeRoom.roomId
      stickyRef.current = true
      setShowRoomInfo(false)
      // Set read marker at the boundary between read and unread messages
      if (activeRoom.unreadCount > 0 && messages.length > 0) {
        const unreadIdx = Math.max(0, messages.length - activeRoom.unreadCount)
        if (unreadIdx > 0 && unreadIdx < messages.length) {
          setReadMarkerEventId(messages[unreadIdx - 1].eventId)
        } else {
          setReadMarkerEventId(null)
        }
      } else {
        setReadMarkerEventId(null)
      }
      // Check m.fully_read marker for cross-device read-position sync
      setShowResumeReading(false)
      setResumeEventId(null)
      try {
        const client = getMatrixClient()
        if (client) {
          const room = client.getRoom(activeRoom.roomId)
          const fullyReadEvent = room?.getAccountData('m.fully_read')
          const fullyReadEventId = fullyReadEvent?.getContent()?.event_id
          if (fullyReadEventId && messages.length > 0) {
            const fullyReadIdx = messages.findIndex(m => m.eventId === fullyReadEventId)
            if (fullyReadIdx >= 0 && fullyReadIdx < messages.length - 5) {
              setResumeEventId(fullyReadEventId)
              setShowResumeReading(true)
            }
          }
        }
      } catch { /* ignore */ }
    }
  }, [activeRoom]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll when messages change
  useEffect(() => {
    if (!stickyRef.current) return
    requestAnimationFrame(() => {
      scrollToBottom(true)
    })
  }, [messages, scrollToBottom])

  // Watch for layout shifts
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (stickyRef.current) {
        el.scrollTop = el.scrollHeight
      }
    })
    for (const child of el.children) {
      ro.observe(child)
    }
    return () => ro.disconnect()
  }, [messages])

  // Re-scroll when mobile keyboard opens/closes
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => { if (stickyRef.current) scrollToBottom(true) }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [scrollToBottom])

  // Track new messages arriving while scrolled up
  useEffect(() => {
    if (!stickyRef.current && messages.length > 0) {
      setNewMessageCount(prev => prev + 1)
    } else {
      setNewMessageCount(0)
    }
  }, [messages.length])

  if (!activeRoom || !user) return null

  const isSmallOrBridged = activeRoom.isDirect || activeRoom.isBridged || activeRoom.members.length <= 3
  const otherMember = isSmallOrBridged
    ? (activeRoom.members.filter(m => m.userId !== user.userId).find(m => m.avatarUrl) || activeRoom.members.find(m => m.userId !== user.userId))
    : null
  const headerAvatarUrl = (isSmallOrBridged ? otherMember?.avatarUrl : null)
    || activeRoom.avatarUrl
    || resolveRoomAvatarFromSDK(activeRoom.roomId)

  const roomDisplayName = activeRoom.name
  const roomStatus = isSmallOrBridged
    ? otherMember?.presence === 'online' ? 'online' : otherMember?.presence === 'unavailable' ? 'away' : 'offline'
    : `${activeRoom.members.length} members`

  const handleSend = useCallback((content: string) => {
    sendMessage(activeRoom.roomId, content, replyTo?.eventId)
    setReplyTo(null)
    stickyRef.current = true
    requestAnimationFrame(() => scrollToBottom(true))
  }, [activeRoom.roomId, replyTo?.eventId, sendMessage, scrollToBottom])

  const handleArchiveToggle = async () => {
    if (activeRoom.isArchived) {
      await unarchiveRoom(activeRoom.roomId)
    } else {
      await archiveRoom(activeRoom.roomId)
      setActiveRoom(null)
    }
  }

  const filteredMessages = useMemo(() => {
    let msgs = messages
    // Hide messages that belong to a thread (they appear in the thread panel)
    msgs = msgs.filter(m => !m.threadRootId)
    // Filter out messages from ignored users
    if (ignoredUsers.length > 0) {
      const ignoredSet = new Set(ignoredUsers)
      msgs = msgs.filter(m => !ignoredSet.has(m.senderId))
    }
    if (chatSearch) {
      msgs = msgs.filter(m => m.content.toLowerCase().includes(chatSearch.toLowerCase()))
    }
    return msgs
  }, [messages, chatSearch, ignoredUsers])

  const groupedMessages = useMemo(() => {
    const groups: { date: string; messages: MatrixMessage[] }[] = []
    let currentDate = ''
    for (const msg of filteredMessages) {
      const d = new Date(msg.timestamp)
      const dateKey = d.toLocaleDateString('en-US')
      if (dateKey !== currentDate) {
        currentDate = dateKey
        let label: string
        if (isToday(d)) {
          label = format(d, 'HH:mm')
        } else if (isYesterday(d)) {
          label = 'Yesterday \u00b7 ' + format(d, 'HH:mm')
        } else {
          label = format(d, 'EEEE') + ' \u00b7 ' + format(d, 'HH:mm')
        }
        groups.push({ date: label, messages: [msg] })
      } else {
        groups[groups.length - 1].messages.push(msg)
      }
    }
    return groups
  }, [filteredMessages])

  return (
    <div
      className="relative flex flex-1 flex-col min-h-0 bg-[#f8f9fa] dark:bg-m3-surface"
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true) }}
      onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false) }}
      onDrop={(e) => {
        e.preventDefault(); e.stopPropagation(); setIsDragging(false)
        const files = Array.from(e.dataTransfer.files)
        if (files.length > 0 && activeRoom) {
          files.forEach(file => {
            useChatStore.getState().uploadFile(activeRoom.roomId, file).catch(() => {
              // Upload failure is shown via upload progress UI
            })
          })
        }
      }}
    >
      {/* Header */}
      <ChatHeader
        activeRoom={activeRoom}
        roomDisplayName={roomDisplayName}
        headerAvatarUrl={headerAvatarUrl}
        roomStatus={roomStatus}
        typingUsers={typingUsers}
        isSmallOrBridged={isSmallOrBridged}
        otherMemberPresence={otherMember?.presence}
        onToggleSearch={() => setShowSearch(!showSearch)}
        onToggleRoomInfo={() => setShowRoomInfo(!showRoomInfo)}
        onArchiveToggle={handleArchiveToggle}
        onLeave={async () => {
          try {
            await leaveRoom(activeRoom.roomId)
          } catch {
            // Room leave failed — stay in room
          }
        }}
      />

      {/* Search bar */}
      {showSearch && (
        <div ref={searchBarRef} className="animate-slide-in border-b border-m3-outline-variant/30 bg-white px-4 py-2 dark:border-m3-outline-variant/30 dark:bg-m3-surface-container">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-m3-on-surface-variant" />
            <input
              type="text"
              placeholder="Search in conversation..."
              value={chatSearch}
              onChange={e => setChatSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setShowSearch(false); setChatSearch(''); } }}
              autoFocus
              className="w-full rounded-lg border border-m3-outline-variant bg-m3-surface-container-lowest py-2 pl-10 pr-4 text-sm text-m3-on-surface placeholder-m3-outline focus:border-m3-primary focus:outline-none focus:ring-1 focus:ring-m3-primary dark:border-m3-outline-variant dark:bg-m3-surface-container-high dark:text-m3-on-surface dark:placeholder-m3-outline"
            />
          </div>
        </div>
      )}

      {/* Pinned messages banner */}
      {pinnedEventIds.length > 0 && showPinnedBanner && (
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-4 py-2 dark:border-amber-900/50 dark:bg-amber-900/20">
          <div className="flex items-center gap-2">
            <Pin className="h-4 w-4 text-amber-500 dark:text-amber-400" />
            <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
              {pinnedEventIds.length} pinned {pinnedEventIds.length === 1 ? 'message' : 'messages'}
            </span>
          </div>
          <button
            onClick={() => setShowPinnedBanner(false)}
            className="rounded-lg p-1 text-amber-500 transition-colors hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/30"
            title="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollContainerRef} onClick={(e) => { if (showSearch) { setShowSearch(false); setChatSearch(''); } handleContentClick(e); }} className="message-scroll-container min-h-0 flex-1 overflow-y-auto bg-[#f8f9fa] px-3 pt-4 pb-6 dark:bg-m3-surface md:px-6 lg:px-8 md:pb-8">
        {isLoadingMessages ? (
          <div className="flex h-full flex-col justify-end space-y-4 px-4 py-6">
            {/* Skeleton messages */}
            {[...Array(6)].map((_, i) => (
              <div key={i} className={`flex ${i % 3 === 0 ? 'justify-end' : 'justify-start'}`}>
                <div className={`animate-skeleton rounded-[20px] ${
                  i % 3 === 0
                    ? 'bg-m3-primary/20 dark:bg-m3-primary/10'
                    : 'bg-m3-surface-container dark:bg-m3-surface-container-high'
                }`} style={{ width: `${35 + (i * 13) % 40}%`, height: `${36 + (i * 7) % 24}px` }} />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-full flex-col justify-end space-y-4">
            {activeRoom.topic && (
              <div className="flex items-center justify-center py-2">
                <span className="rounded-full bg-m3-surface-container-high px-4 py-1.5 text-sm text-m3-on-surface-variant shadow-sm dark:bg-m3-surface-container-high dark:text-m3-outline">
                  {activeRoom.topic}
                </span>
              </div>
            )}

            {groupedMessages.map(group => (
              <div key={group.date}>
                <div className="flex items-center justify-center py-4">
                  <span className="rounded-full bg-m3-surface-container px-4 py-1 text-[11px] font-medium tracking-wide text-m3-on-surface-variant shadow-sm dark:bg-m3-surface-container-high dark:text-m3-outline">
                    {group.date}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {group.messages.map((msg, idx) => {
                    const prevMsg = idx > 0 ? group.messages[idx - 1] : null
                    const nextMsg = idx < group.messages.length - 1 ? group.messages[idx + 1] : null
                    const showAvatar = !prevMsg || prevMsg.senderId !== msg.senderId
                    const isLastInCluster = !nextMsg || nextMsg.senderId !== msg.senderId
                    const isFirstInCluster = showAvatar
                    const isMiddleInCluster = !isFirstInCluster && !isLastInCluster
                    const clusterClass = isFirstInCluster && !isLastInCluster
                      ? 'bubble-cluster-first'
                      : isMiddleInCluster
                        ? 'bubble-cluster-middle'
                        : isLastInCluster && !isFirstInCluster
                          ? 'bubble-cluster-last'
                          : ''
                    const showReadMarker = readMarkerEventId && prevMsg?.eventId === readMarkerEventId
                    return (
                      <div key={msg.eventId} data-event-id={msg.eventId}>
                        {showReadMarker && (
                          <div className="my-2 flex items-center gap-3 px-4">
                            <div className="h-px flex-1 bg-m3-primary" />
                            <span className="text-xs font-medium text-m3-primary">New messages</span>
                            <div className="h-px flex-1 bg-m3-primary" />
                          </div>
                        )}
                      <MessageBubble
                        message={msg}
                        isOwn={msg.senderId === user.userId}
                        showAvatar={showAvatar}
                        onReply={() => setReplyTo(msg)}
                        roomId={activeRoom.roomId}
                        isPinned={pinnedEventIds.includes(msg.eventId)}
                        searchHighlight={chatSearch}
                        onOpenThread={setActiveThreadId}
                        clusterClass={clusterClass}
                      />
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}

            {/* Typing indicator — ghost bubble */}
            {typingUsers.length > 0 && (
              <div className="flex items-end gap-2 typing-ghost-bubble">
                <div className="w-8 flex-shrink-0">
                  <Avatar
                    src={null}
                    name={typingUsers[0]}
                    size="sm"
                  />
                </div>
                <div className="rounded-[20px] bg-white px-4 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-m3-surface-container-high dark:shadow-none">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      <span className="typing-dot h-2 w-2 rounded-full bg-m3-on-surface-variant/50" />
                      <span className="typing-dot h-2 w-2 rounded-full bg-m3-on-surface-variant/50" />
                      <span className="typing-dot h-2 w-2 rounded-full bg-m3-on-surface-variant/50" />
                    </div>
                    <span className="text-xs text-m3-on-surface-variant">
                      {typingUsers.length === 1 ? typingUsers[0] : `${typingUsers[0]} and ${typingUsers.length - 1} other${typingUsers.length > 2 ? 's' : ''}`}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} className="h-1" />
          </div>
        )}
      </div>

      {/* Upload progress bar */}
      <UploadProgress roomId={activeRoom.roomId} />

      {/* External link confirmation dialog */}
      {externalLinkConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in" onClick={() => setExternalLinkConfirm(null)}>
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-m3-surface-container-lowest p-6 shadow-xl animate-scale-in dark:bg-m3-surface-container" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-medium text-m3-on-surface">Open external link?</h3>
            <p className="mt-2 break-all text-sm text-m3-on-surface-variant">{externalLinkConfirm}</p>
            <div className="mt-5 flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs text-m3-on-surface-variant">
                <input
                  type="checkbox"
                  id="trust-domain"
                  className="rounded"
                />
                Trust this domain
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setExternalLinkConfirm(null)}
                  className="rounded-full px-4 py-2 text-sm font-medium text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const checkbox = document.getElementById('trust-domain') as HTMLInputElement
                    if (checkbox?.checked) {
                      try {
                        const url = new URL(externalLinkConfirm)
                        if (!trustedDomains.includes(url.hostname)) {
                          setTrustedDomains(prev => [...prev, url.hostname])
                        }
                      } catch { /* ignore */ }
                    }
                    try {
                      const linkUrl = new URL(externalLinkConfirm)
                      if (linkUrl.protocol === 'http:' || linkUrl.protocol === 'https:') {
                        window.open(externalLinkConfirm, '_blank', 'noopener,noreferrer')
                      }
                    } catch { /* invalid URL — don't open */ }
                    setExternalLinkConfirm(null)
                  }}
                  className="rounded-full bg-m3-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-m3-primary/90"
                >
                  Open
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Drag-and-drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-m3-primary/10 backdrop-blur-sm animate-fade-in">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-m3-primary bg-m3-surface-container-lowest/80 px-12 py-8 dark:bg-m3-surface-container/80">
            <Upload className="h-12 w-12 text-m3-primary" />
            <p className="text-lg font-medium text-m3-primary">Drop files here</p>
            <p className="text-sm text-m3-on-surface-variant">Files will be uploaded to this conversation</p>
          </div>
        </div>
      )}

      {/* Resume reading pill — cross-device read position sync */}
      {showResumeReading && resumeEventId && (
        <button
          onClick={() => {
            const el = scrollContainerRef.current?.querySelector(`[data-event-id="${CSS.escape(resumeEventId)}"]`)
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            setShowResumeReading(false)
          }}
          className="absolute top-20 left-1/2 z-30 -translate-x-1/2 animate-slide-in rounded-full bg-m3-secondary-container px-4 py-2 text-sm font-medium text-m3-on-secondary-container shadow-xl transition-transform hover:scale-105 active:scale-95"
        >
          Resume where you left off
        </button>
      )}

      {/* Jump to unread pill */}
      {newMessageCount > 0 && !stickyRef.current && (
        <button
          onClick={() => { scrollToBottom(); setNewMessageCount(0) }}
          className="absolute bottom-24 left-1/2 z-30 -translate-x-1/2 animate-slide-in rounded-full bg-m3-primary px-4 py-2 text-sm font-medium text-white shadow-xl transition-transform hover:scale-105 active:scale-95"
        >
          {newMessageCount} new {newMessageCount === 1 ? 'message' : 'messages'}
        </button>
      )}

      {/* Message Input */}
      <MessageInput
        onSend={handleSend}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        roomId={activeRoom.roomId}
      />

      {/* Thread Panel */}
      {activeThreadId && (
        <ThreadPanel
          roomId={activeRoom.roomId}
          threadRootId={activeThreadId}
          onClose={() => setActiveThreadId(null)}
        />
      )}

      {/* Room Info Panel */}
      {showRoomInfo && (
        <RoomInfoPanel
          activeRoom={activeRoom}
          roomDisplayName={roomDisplayName}
          headerAvatarUrl={headerAvatarUrl}
          messages={messages}
          onClose={() => setShowRoomInfo(false)}
          onSetRoomName={setRoomName}
          onSetRoomTopic={setRoomTopic}
          onInviteMember={inviteMember}
          onEnableEncryption={enableEncryption}
          onLeaveRoom={leaveRoom}
          ignoredUsers={ignoredUsers}
          onIgnoreUser={ignoreUser}
          onUnignoreUser={unignoreUser}
          notificationSetting={getRoomNotificationSetting(activeRoom.roomId)}
          onSetNotificationSetting={setRoomNotificationSetting}
          onKickMember={kickMember}
          onBanMember={banMember}
          onSetPowerLevel={setPowerLevel}
        />
      )}
    </div>
  )
}

/** Compact upload progress indicators shown above the message input. */
function UploadProgress({ roomId }: { roomId: string }) {
  // Subscribe to the full tasks array, then filter in render.
  // Using .filter() inside the selector creates a new array reference every time,
  // which causes Zustand to think state changed → infinite re-render loop.
  const allTasks = useUploadStore(s => s.tasks)
  const tasks = allTasks.filter(t => t.roomId === roomId)

  if (tasks.length === 0) return null

  return (
    <div className="border-t border-m3-outline-variant/40 bg-m3-surface-container-low px-4 py-2 dark:bg-m3-surface-container">
      {tasks.map(task => (
        <div key={task.id} className="py-1">
          <div className="flex items-center gap-3">
            <span className="text-xs text-m3-on-surface-variant truncate max-w-[180px]">
              {task.fileName}
            </span>
            {task.status !== 'failed' ? (
              <>
                <div className="flex-1 h-1.5 rounded-full bg-m3-surface-container-high dark:bg-m3-surface-container-highest overflow-hidden">
                  <div
                    className="h-full rounded-full bg-m3-primary transition-all duration-300 ease-out"
                    style={{ width: `${task.status === 'done' ? 100 : task.progress}%` }}
                  />
                </div>
                <span className="text-[11px] text-m3-on-surface-variant flex-shrink-0 w-14 text-right">
                  {task.status === 'queued' && 'Queued'}
                  {task.status === 'uploading' && `${task.progress}%`}
                  {task.status === 'sending' && 'Sending'}
                  {task.status === 'done' && 'Done'}
                </span>
              </>
            ) : (
              <span className="text-[11px] text-m3-error truncate">
                {task.error || 'Upload failed'}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

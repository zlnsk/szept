'use client'

import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useChatStore, type MatrixMessage } from '@/stores/chat-store'
import { Avatar } from '@/components/ui/avatar'
import { format } from 'date-fns'
import {
  Check,
  CheckCheck,
  X,
  Clock,
  Send,
  Pin,
  Loader2,
  AlertCircle,
  RotateCcw,
  MessageSquareText,
} from 'lucide-react'
import { LinkPreview } from './link-preview'
import { decryptMediaAttachment, fetchAuthenticatedMedia } from '@/lib/matrix/media'
import { renderRichContent, applySearchHighlight, isEmojiOnly, extractFirstUrl, parseDisplayName } from './message-content'
import { ImageLightbox, VoicePlayer } from './message-media'
import { MessageReactions, ReadReceipts } from './message-reactions'
import { DesktopActionButtons, EmojiPickerPortal, ContextMenuPortal, ForwardPickerPortal, TouchMenu, QUICK_EMOJIS } from './message-actions'

interface MessageBubbleProps {
  message: MatrixMessage
  isOwn: boolean
  showAvatar: boolean
  onReply: () => void
  roomId: string
  isPinned?: boolean
  searchHighlight?: string
  onOpenThread?: (eventId: string) => void
  clusterClass?: string
}

export const MessageBubble = memo(function MessageBubble({ message, isOwn, showAvatar, onReply, roomId, isPinned, searchHighlight, onOpenThread, clusterClass }: MessageBubbleProps) {
  const user = useAuthStore(s => s.user)
  const { sendReaction, editMessage, redactMessage, pinMessage, unpinMessage, forwardMessage, rooms } = useChatStore()
  const [showActions, setShowActions] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [showForwardPicker, setShowForwardPicker] = useState(false)
  const [showTouchMenu, setShowTouchMenu] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)
  const [copied, setCopied] = useState(false)
  const [mediaBlobUrl, setMediaBlobUrl] = useState<string | null>(null)
  const [mediaError, setMediaError] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const actionsRef = useRef<HTMLDivElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const emojiPickerPortalRef = useRef<HTMLDivElement>(null)
  const contextMenuPortalRef = useRef<HTMLDivElement>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchMoved = useRef(false)

  // Compute portal positions for emoji picker and context menu
  const getMenuPosition = useCallback(() => {
    if (!bubbleRef.current) return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, midY: 0 }
    const rect = bubbleRef.current.getBoundingClientRect()
    return { ...rect.toJSON(), midY: rect.top + rect.height / 2 }
  }, [])

  // Fetch all media via authenticated endpoint (handles both encrypted and unencrypted)
  const mediaBlobUrlRef = useRef<string | null>(null)
  const [mediaRetryCount, setMediaRetryCount] = useState(0)
  useEffect(() => {
    if (!message.mediaUrl) return
    let cancelled = false

    async function loadMedia() {
      try {
        let url: string
        if (message.encryptedFile) {
          url = await decryptMediaAttachment(
            message.encryptedFile.url,
            message.encryptedFile,
            message.mediaInfo?.mimetype
          )
        } else {
          url = await fetchAuthenticatedMedia(message.mediaUrl!, message.mediaInfo?.mimetype)
        }
        if (!cancelled) {
          mediaBlobUrlRef.current = url
          setMediaBlobUrl(url)
          setMediaError(false)
        } else if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url)
        }
      } catch (err) {
        console.error('Failed to load media:', err)
        if (!cancelled) setMediaError(true)
      }
    }
    loadMedia()

    return () => {
      cancelled = true
      if (mediaBlobUrlRef.current?.startsWith('blob:')) {
        URL.revokeObjectURL(mediaBlobUrlRef.current)
      }
      mediaBlobUrlRef.current = null
    }
  }, [message.eventId, message.encryptedFile, message.mediaUrl, mediaRetryCount]) // eslint-disable-line react-hooks/exhaustive-deps

  const effectiveMediaUrl = mediaBlobUrl

  useEffect(() => {
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      const target = e.target as Node
      const insideActions = actionsRef.current?.contains(target)
      const insideEmojiPortal = emojiPickerPortalRef.current?.contains(target)
      const insideContextPortal = contextMenuPortalRef.current?.contains(target)
      if (!insideActions && !insideEmojiPortal && !insideContextPortal) {
        setShowActions(false)
        setShowEmojiPicker(false)
        setShowContextMenu(false)
        setShowForwardPicker(false)
      }
    }
    const anyOpen = showActions || showEmojiPicker || showContextMenu || showForwardPicker
    if (!anyOpen) return
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [showActions, showEmojiPicker, showContextMenu, showForwardPicker])

  useEffect(() => {
    return () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }
    }
  }, [])

  // Long-press handlers for touch devices
  // Swipe gesture state for reply
  const swipeStartX = useRef<number>(0)
  const [swipeOffset, setSwipeOffset] = useState(0)
  const swipeThreshold = 60

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchMoved.current = false
    swipeStartX.current = e.touches[0].clientX
    setSwipeOffset(0)
    longPressTimer.current = setTimeout(() => {
      if (!touchMoved.current) {
        e.preventDefault()
        setShowTouchMenu(true)
        try { (window as any).Android?.hapticHeavy() } catch (_) {}
        if (navigator.vibrate) navigator.vibrate(30)
      }
    }, 500)
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - swipeStartX.current
    // Only track rightward swipes (for reply)
    if (Math.abs(dx) > 10) {
      touchMoved.current = true
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }
    }
    if (dx > 0 && !isOwn) {
      setSwipeOffset(Math.min(dx, 80))
    } else if (dx < 0 && isOwn) {
      setSwipeOffset(Math.max(dx, -80))
    }
  }, [isOwn])

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    // Trigger reply if swiped past threshold
    if (Math.abs(swipeOffset) >= swipeThreshold) {
      onReply()
      try { if (navigator.vibrate) navigator.vibrate(15) } catch {}
    }
    setSwipeOffset(0)
  }, [swipeOffset, swipeThreshold, onReply])

  const closeTouchMenu = useCallback(() => {
    setShowTouchMenu(false)
    setShowForwardPicker(false)
  }, [])

  const handleReaction = useCallback(async (emoji: string) => {
    await sendReaction(roomId, message.eventId, emoji)
    setShowEmojiPicker(false)
    setShowActions(false)
  }, [sendReaction, roomId, message.eventId])

  const handleEdit = useCallback(async () => {
    if (editContent.trim() && editContent !== message.content) {
      await editMessage(roomId, message.eventId, editContent.trim())
    }
    setIsEditing(false)
  }, [editContent, message.content, editMessage, roomId, message.eventId])

  const handleDelete = useCallback(async () => {
    await redactMessage(roomId, message.eventId)
    setShowContextMenu(false)
    setShowActions(false)
  }, [redactMessage, roomId, message.eventId])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    setShowContextMenu(false)
  }, [message.content])

  const handlePin = useCallback(async () => {
    try {
      if (isPinned) {
        await unpinMessage(roomId, message.eventId)
      } else {
        await pinMessage(roomId, message.eventId)
      }
    } catch (err) {
      console.error('Failed to pin/unpin message:', err)
    }
    setShowContextMenu(false)
    setShowActions(false)
  }, [isPinned, unpinMessage, pinMessage, roomId, message.eventId])

  const handleForward = useCallback(async (toRoomId: string) => {
    try {
      await forwardMessage(roomId, message.eventId, toRoomId)
    } catch (err) {
      console.error('Failed to forward message:', err)
    }
    setShowForwardPicker(false)
    setShowContextMenu(false)
    setShowActions(false)
  }, [forwardMessage, roomId, message.eventId])

  // Status icon for own messages
  const statusIcon = useMemo(() => {
    if (!isOwn) return null
    const iconClass = 'h-3.5 w-3.5'
    switch (message.status) {
      case 'sending':
        return <Clock className={`${iconClass} text-m3-outline dark:text-m3-on-surface-variant animate-pulse`} />
      case 'failed':
        return <AlertCircle className={`${iconClass} text-m3-error`} />
      case 'sent':
        return <Check className={`${iconClass} text-m3-outline dark:text-m3-on-surface-variant`} />
      case 'delivered':
        return <CheckCheck className={`${iconClass} text-m3-outline dark:text-m3-on-surface-variant`} />
      case 'read':
        return <CheckCheck className={`${iconClass} text-green-500`} />
      default:
        return <Send className={`${iconClass} text-m3-outline dark:text-m3-on-surface-variant`} />
    }
  }, [isOwn, message.status])

  if (message.isStateEvent) {
    return (
      <div className="flex justify-center my-3">
        <span className="rounded-full bg-m3-surface-container px-4 py-1.5 text-xs text-m3-on-surface-variant shadow-sm dark:bg-m3-surface-container-high dark:text-m3-outline">
          {message.content}
        </span>
      </div>
    )
  }

  if (message.isRedacted) {
    return (
      <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} ${showAvatar ? 'mt-3' : 'mt-0.5'}`}>
        <div className={`${isOwn ? 'mr-12' : 'ml-12'} rounded-2xl bg-m3-surface-container dark:bg-m3-surface-container-high/50 px-4 py-2`}>
          <p className="text-sm italic text-m3-outline dark:text-m3-on-surface-variant">This message was deleted</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`message-bubble-container group flex ${isOwn ? 'justify-end' : 'justify-start'} ${showAvatar ? 'mt-4' : 'mt-0.5'} relative ${showActions || showEmojiPicker || showContextMenu ? 'z-30' : 'z-0'} ${clusterClass || ''}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => {
        if (!showEmojiPicker && !showContextMenu) setShowActions(false)
      }}
    >
      <div
        className={`flex max-w-[85vw] sm:max-w-[420px] md:max-w-md lg:max-w-lg ${isOwn ? 'flex-row-reverse' : 'flex-row'} items-end gap-2 transition-transform`}
        style={swipeOffset !== 0 ? { transform: `translateX(${swipeOffset}px)`, transition: 'none' } : undefined}
      >
        {/* Avatar */}
        <div className="w-8 flex-shrink-0">
          {showAvatar && !isOwn && (
            <Avatar
              src={message.senderAvatar}
              name={message.senderName}
              size="sm"
            />
          )}
        </div>

        <div className="flex flex-col min-w-0" ref={actionsRef}>
          {/* Sender name */}
          {showAvatar && !isOwn && (() => {
            const { displayName, matrixId } = parseDisplayName(message.senderName, message.senderId)
            const firstName = displayName.split(' ')[0]
            return (
              <div className="mb-1 ml-1 flex items-baseline gap-2">
                <span className="text-sm font-bold text-m3-on-surface dark:text-m3-on-surface-variant" title={displayName}>
                  {firstName}
                </span>
                {matrixId && (
                  <span className="text-[10px] font-normal text-m3-on-surface-variant dark:text-m3-outline truncate max-w-[180px] select-text" title={matrixId}>
                    {matrixId}
                  </span>
                )}
              </div>
            )
          })()}

          {/* Pin indicator */}
          {isPinned && (
            <div className={`mb-1 flex items-center gap-1 text-xs text-amber-500 dark:text-amber-400 ${isOwn ? 'justify-end' : 'justify-start'}`}>
              <Pin className="h-3 w-3" />
              <span>Pinned</span>
            </div>
          )}

          {/* Bubble wrapper — action buttons positioned relative to this */}
          <div className="relative min-w-0 max-w-full" ref={bubbleRef}>
          <div
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onDoubleClick={() => {
              if (isOwn && !isEditing && message.type !== 'm.image' && message.type !== 'm.video' && message.type !== 'm.audio') {
                setIsEditing(true)
                setEditContent(message.content)
              }
            }}
            className={`rounded-[20px] overflow-hidden transition-colors duration-150 ${message.type === 'm.image' || message.type === 'm.video' ? 'w-fit border border-m3-outline-variant/30 dark:border-m3-outline-variant/20' : isEmojiOnly(message.content) && !message.replyToEvent ? 'px-1 py-0.5' : 'px-4 py-2.5'} ${isOwn ? 'cursor-pointer ' : ''}${
              isEmojiOnly(message.content) && !message.replyToEvent
                ? ''
                : isOwn
                  ? message.status === 'failed'
                    ? 'bg-m3-primary/70 text-white ring-2 ring-red-400/50'
                    : message.status === 'sending'
                      ? 'bg-m3-primary/85 text-white'
                      : 'bg-m3-primary text-white'
                  : 'bg-white text-m3-on-surface shadow-[0_1px_3px_rgba(0,0,0,0.08)] dark:bg-m3-surface-container-high dark:text-m3-on-surface dark:shadow-[0_1px_2px_rgba(0,0,0,0.2)]'
            }`}
          >
            {/* Inline reply quote */}
            {message.replyToEvent && !isEditing && (
              <div
                className={`mb-2 rounded-lg px-3 py-1.5 text-xs cursor-pointer ${(message.type === 'm.image' || message.type === 'm.video') ? 'mx-3 mt-3 ' : ''}${
                  isOwn
                    ? 'bg-white/15 hover:bg-white/25'
                    : 'bg-black/[0.04] hover:bg-black/[0.07] dark:bg-white/[0.08] dark:hover:bg-white/[0.12]'
                }`}
                onClick={(e) => {
                  e.stopPropagation()
                  const el = document.querySelector(`[data-event-id="${CSS.escape(message.replyToEvent!.eventId)}"]`)
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    el.classList.add('highlight-flash')
                    setTimeout(() => el.classList.remove('highlight-flash'), 1500)
                  }
                }}
              >
                <p className={`font-semibold ${isOwn ? 'text-white' : 'text-m3-on-surface dark:text-m3-on-surface-variant'}`}>
                  {message.replyToEvent.senderName}
                </p>
                <p className={`truncate ${isOwn ? 'text-white/80' : 'text-m3-on-surface-variant dark:text-m3-outline'}`}>
                  {/\.\w{2,5}$/i.test(message.replyToEvent.content)
                    ? <span className="underline decoration-1 underline-offset-2">{message.replyToEvent.content}</span>
                    : message.replyToEvent.content}
                </p>
              </div>
            )}

            {isEditing ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleEdit()
                    if (e.key === 'Escape') { setIsEditing(false); setEditContent(message.content) }
                  }}
                  autoFocus
                  className="min-w-[200px] rounded bg-transparent text-sm focus:outline-none"
                />
                <button onClick={handleEdit} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-green-300 transition-colors hover:bg-white/30 hover:text-green-200" title="Save">
                  <Check className="h-5 w-5" />
                </button>
                <button onClick={() => setIsEditing(false)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-red-300 transition-colors hover:bg-white/30 hover:text-red-200" title="Cancel">
                  <X className="h-5 w-5" />
                </button>
              </div>
            ) : (message.mediaUrl || effectiveMediaUrl) ? (
              <div>
                {message.type === 'm.image' ? (
                  effectiveMediaUrl ? (
                    <>
                      <img
                        src={effectiveMediaUrl}
                        alt={message.content || 'Shared image'}
                        loading="lazy"
                        decoding="async"
                        className="block max-w-full cursor-pointer transition-opacity hover:opacity-90"
                        style={{
                          maxHeight: 480,
                          width: message.mediaInfo?.w && message.mediaInfo?.h
                            ? Math.min(message.mediaInfo.w, 400, Math.round((message.mediaInfo.w / message.mediaInfo.h) * 480))
                            : message.mediaInfo?.w ? Math.min(message.mediaInfo.w, 400) : undefined,
                        }}
                        onClick={() => setLightboxOpen(true)}
                      />
                      {lightboxOpen && (
                        <ImageLightbox
                          src={effectiveMediaUrl}
                          alt={message.content || 'Shared image'}
                          onClose={() => setLightboxOpen(false)}
                        />
                      )}
                    </>
                  ) : mediaError ? (
                    <button
                      onClick={() => { setMediaError(false); setMediaRetryCount(c => c + 1) }}
                      className="flex h-32 w-48 flex-col items-center justify-center gap-2 rounded-[20px] bg-m3-surface-container dark:bg-m3-surface-container-highest cursor-pointer hover:bg-m3-surface-container-high transition-colors"
                    >
                      <AlertCircle className="h-6 w-6 text-m3-outline" />
                      <span className="text-xs text-m3-on-surface-variant">Tap to retry</span>
                    </button>
                  ) : (
                    <div className="flex h-32 w-48 items-center justify-center rounded-[20px] bg-m3-surface-container dark:bg-m3-surface-container-highest">
                      <Loader2 className="h-6 w-6 animate-spin text-m3-outline" />
                    </div>
                  )
                ) : message.type === 'm.video' ? (
                  effectiveMediaUrl ? (
                    <video
                      controls
                      src={effectiveMediaUrl}
                      className="block max-w-full rounded-xl"
                      style={{ maxHeight: 480 }}
                      onError={() => setMediaError(true)}
                    />
                  ) : mediaError ? (
                    <button
                      onClick={() => { setMediaError(false); setMediaRetryCount(c => c + 1) }}
                      className="flex h-32 w-48 flex-col items-center justify-center gap-2 rounded-[20px] bg-m3-surface-container dark:bg-m3-surface-container-highest cursor-pointer hover:bg-m3-surface-container-high transition-colors"
                    >
                      <AlertCircle className="h-6 w-6 text-m3-outline" />
                      <span className="text-xs text-m3-on-surface-variant">Tap to retry</span>
                    </button>
                  ) : (
                    <div className="flex h-32 w-48 items-center justify-center rounded-[20px] bg-m3-surface-container dark:bg-m3-surface-container-highest">
                      <Loader2 className="h-6 w-6 animate-spin text-m3-outline" />
                    </div>
                  )
                ) : message.type === 'm.audio' ? (
                  effectiveMediaUrl ? (
                    <VoicePlayer src={effectiveMediaUrl} isOwn={isOwn} duration={message.mediaInfo?.duration} />
                  ) : mediaError ? (
                    <button
                      onClick={() => { setMediaError(false); setMediaRetryCount(c => c + 1) }}
                      className="flex h-8 w-48 items-center justify-center gap-2 cursor-pointer"
                    >
                      <RotateCcw className="h-4 w-4 text-m3-outline" />
                      <span className="text-xs text-m3-on-surface-variant">Retry</span>
                    </button>
                  ) : (
                    <div className="flex h-8 w-48 items-center justify-center">
                      <Loader2 className="h-4 w-4 animate-spin text-m3-outline" />
                    </div>
                  )
                ) : (
                  <a
                    href={effectiveMediaUrl || message.mediaUrl || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm underline"
                  >
                    {message.content}
                  </a>
                )}
                {message.content && message.type === 'm.image' && !/\.\w{2,5}$/i.test(message.content) && (
                  <p className="px-3 py-1.5 text-sm">{message.content}</p>
                )}
              </div>
            ) : message.msgtype === 'm.emote' ? (
              <div className={`rich-content text-[15px] leading-relaxed whitespace-pre-wrap break-words italic ${isOwn ? 'own-bubble' : ''}`}>
                <span className="font-medium not-italic">{message.senderName}</span>{' '}
                <span
                  dangerouslySetInnerHTML={{
                    __html: applySearchHighlight(renderRichContent(message.content, message.formattedContent), searchHighlight || ''),
                  }}
                />
              </div>
            ) : (
              <div
                className={`rich-content leading-relaxed whitespace-pre-wrap break-words ${isEmojiOnly(message.content) ? 'text-4xl' : 'text-[15px]'} ${message.msgtype === 'm.notice' ? 'italic opacity-70' : ''} ${isOwn ? 'own-bubble' : ''}`}
                dangerouslySetInnerHTML={{
                  __html: applySearchHighlight(renderRichContent(message.content, message.formattedContent), searchHighlight || ''),
                }}
              />
            )}

            {(() => {
              const url = extractFirstUrl(message.content)
              return url ? <LinkPreview url={url} /> : null
            })()}

            {/* Failed to send indicator with retry */}
            {message.status === 'failed' && (
              <div className="mt-1.5 flex items-center gap-2 text-xs">
                <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                <span className="text-red-300">Failed to send</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    useChatStore.getState().retryMessage(message.eventId)
                  }}
                  className="flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs text-white transition-colors hover:bg-white/30"
                >
                  <RotateCcw className="h-3 w-3" />
                  Retry
                </button>
              </div>
            )}
          </div>

          {/* Action buttons — desktop only */}
          <DesktopActionButtons
            isOwn={isOwn}
            showActions={showActions}
            isEditing={isEditing}
            onToggleEmojiPicker={() => setShowEmojiPicker(!showEmojiPicker)}
            onReaction={handleReaction}
            onReply={onReply}
            onToggleContextMenu={() => setShowContextMenu(!showContextMenu)}
          />

          {/* Emoji picker (desktop only) — rendered via portal */}
          {showEmojiPicker && (
            <EmojiPickerPortal
              isOwn={isOwn}
              menuPosition={getMenuPosition()}
              onReaction={handleReaction}
              portalRef={emojiPickerPortalRef}
            />
          )}

          {/* Context menu (desktop only) — rendered via portal */}
          {showContextMenu && (
            <ContextMenuPortal
              isOwn={isOwn}
              isPinned={!!isPinned}
              copied={copied}
              menuPosition={getMenuPosition()}
              onCopy={handleCopy}
              onPin={handlePin}
              onForward={() => {
                setShowForwardPicker(!showForwardPicker)
                setShowContextMenu(false)
              }}
              onEdit={() => {
                setIsEditing(true)
                setEditContent(message.content)
                setShowContextMenu(false)
                setShowActions(false)
              }}
              onDelete={handleDelete}
              onClose={() => { setShowContextMenu(false); setShowActions(false) }}
              onOpenThread={onOpenThread ? () => { onOpenThread(message.eventId); setShowContextMenu(false); setShowActions(false) } : undefined}
              portalRef={contextMenuPortalRef}
            />
          )}

          {/* Forward room picker (desktop only) — rendered via portal */}
          {showForwardPicker && !showTouchMenu && (
            <ForwardPickerPortal
              isOwn={isOwn}
              menuPosition={getMenuPosition()}
              rooms={rooms}
              currentRoomId={roomId}
              onForward={handleForward}
              onClose={() => { setShowForwardPicker(false); setShowActions(false) }}
            />
          )}

          {/* Touch-friendly action menu (long-press on mobile) */}
          {showTouchMenu && (
            <TouchMenu
              message={message}
              isOwn={isOwn}
              isPinned={!!isPinned}
              roomId={roomId}
              rooms={rooms}
              onReaction={handleReaction}
              onReply={onReply}
              onCopy={handleCopy}
              onPin={handlePin}
              onEdit={() => {
                setIsEditing(true)
                setEditContent(message.content)
              }}
              onDelete={handleDelete}
              onForward={handleForward}
              onOpenThread={onOpenThread ? () => { onOpenThread(message.eventId) } : undefined}
              onClose={closeTouchMenu}
            />
          )}
          </div>{/* end bubble wrapper */}

          {/* Timestamp + status + reactions (inline) */}
          <div className={`mt-0.5 px-1 flex items-center gap-1.5 ${isOwn ? 'justify-end' : 'justify-start'}`}>
            <span className="text-[11px] text-m3-outline dark:text-m3-on-surface-variant">
              {format(new Date(message.timestamp), 'HH:mm')}
            </span>
            {message.isEdited && (
              <span className="text-[11px] text-m3-outline dark:text-m3-on-surface-variant">
                (edited)
              </span>
            )}
            {statusIcon}
            {/* Reactions — inline next to timestamp */}
            <MessageReactions message={message} isOwn={isOwn} onReaction={handleReaction} />
          </div>

          {/* Read receipts */}
          <ReadReceipts message={message} isOwn={isOwn} />

          {/* Thread indicator */}
          {message.threadCount > 0 && (
            <button
              onClick={() => onOpenThread?.(message.eventId)}
              className={`mt-1 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                isOwn
                  ? 'text-m3-primary hover:bg-m3-primary/10'
                  : 'text-m3-primary hover:bg-m3-primary/10'
              }`}
            >
              <MessageSquareText className="h-3.5 w-3.5" />
              {message.threadCount} {message.threadCount === 1 ? 'reply' : 'replies'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  const prevMsg = prevProps.message
  const nextMsg = nextProps.message
  return (
    prevMsg.eventId === nextMsg.eventId &&
    prevMsg.content === nextMsg.content &&
    prevMsg.formattedContent === nextMsg.formattedContent &&
    prevMsg.isEdited === nextMsg.isEdited &&
    prevMsg.isRedacted === nextMsg.isRedacted &&
    prevMsg.reactions.size === nextMsg.reactions.size &&
    [...prevMsg.reactions.entries()].every(([k, v]) => {
      const nv = nextMsg.reactions.get(k); return nv && nv.count === v.count && nv.includesMe === v.includesMe
    }) &&
    prevMsg.readBy.length === nextMsg.readBy.length &&
    prevMsg.status === nextMsg.status &&
    prevMsg.mediaUrl === nextMsg.mediaUrl &&
    prevProps.isOwn === nextProps.isOwn &&
    prevProps.showAvatar === nextProps.showAvatar &&
    prevProps.roomId === nextProps.roomId &&
    prevProps.isPinned === nextProps.isPinned &&
    prevMsg.threadCount === nextMsg.threadCount &&
    prevProps.searchHighlight === nextProps.searchHighlight &&
    prevProps.clusterClass === nextProps.clusterClass
  )
})

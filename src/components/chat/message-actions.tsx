'use client'

import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Reply,
  Smile,
  MoreHorizontal,
  Pencil,
  Trash2,
  Copy,
  Check,
  Pin,
  Forward,
  X,
  MessageSquareText,
} from 'lucide-react'
import type { MatrixMessage, MatrixRoom } from '@/stores/chat-store'
import { Avatar } from '@/components/ui/avatar'

export const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '🙏', '💯', '✅']

interface DesktopActionButtonsProps {
  isOwn: boolean
  showActions: boolean
  isEditing: boolean
  onToggleEmojiPicker: () => void
  onReaction: (emoji: string) => void
  onReply: () => void
  onToggleContextMenu: () => void
}

export function DesktopActionButtons({ isOwn, showActions, isEditing, onToggleEmojiPicker, onReaction, onReply, onToggleContextMenu }: DesktopActionButtonsProps) {
  const [showQuickReact, setShowQuickReact] = useState(false)

  return (
    <div className={`absolute bottom-0 z-10 hidden md:flex flex-col items-end gap-1 ${isOwn ? 'right-full mr-1.5' : 'left-full ml-1.5'}`}>
      {/* Quick react bar — 6 common emojis for one-tap reactions */}
      {showQuickReact && showActions && !isEditing && (
        <div className="flex items-center gap-0.5 rounded-2xl border border-m3-outline-variant/80 bg-m3-surface-container-lowest p-1 shadow-xl dark:border-m3-outline-variant dark:bg-m3-surface-container-high action-pill-enter">
          {QUICK_EMOJIS.slice(0, 6).map(emoji => (
            <button
              key={emoji}
              onClick={() => { onReaction(emoji); setShowQuickReact(false) }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-transform hover:scale-125 hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-highest"
              title={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Action pill */}
      <div className={`action-pill-enter flex items-center gap-0.5 rounded-2xl border border-m3-outline-variant/80 bg-m3-surface-container-lowest p-1 shadow-lg dark:border-m3-outline-variant dark:bg-m3-surface-container-high transition-all duration-150 ${showActions && !isEditing ? 'opacity-100 translate-x-0' : 'opacity-0 pointer-events-none ' + (isOwn ? 'translate-x-1' : '-translate-x-1')}`}>
        <button
          onClick={() => setShowQuickReact(!showQuickReact)}
          className="rounded-xl p-2.5 text-m3-outline transition-colors hover:bg-m3-surface-container hover:text-m3-on-surface-variant active:bg-m3-surface-container-high dark:hover:bg-m3-surface-container-highest dark:hover:text-white"
          title="Quick react"
          aria-label="Quick reaction"
        >
          <Smile className="h-5 w-5" />
        </button>
        <button
          onClick={onReply}
          className="rounded-xl p-2.5 text-m3-outline transition-colors hover:bg-m3-surface-container hover:text-m3-on-surface-variant active:bg-m3-surface-container-high dark:hover:bg-m3-surface-container-highest dark:hover:text-white"
          title="Reply"
          aria-label="Reply to message"
        >
          <Reply className="h-5 w-5" />
        </button>
        <button
          onClick={onToggleContextMenu}
          className="rounded-xl p-2.5 text-m3-outline transition-colors hover:bg-m3-surface-container hover:text-m3-on-surface-variant active:bg-m3-surface-container-high dark:hover:bg-m3-surface-container-highest dark:hover:text-white"
          title="More"
          aria-label="More actions"
          aria-haspopup="menu"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

interface EmojiPickerPortalProps {
  isOwn: boolean
  menuPosition: { top: number; left: number; right: number; bottom: number; width: number; height: number; midY: number }
  onReaction: (emoji: string) => void
  portalRef: React.RefObject<HTMLDivElement | null>
}

export function EmojiPickerPortal({ isOwn, menuPosition, onReaction, portalRef }: EmojiPickerPortalProps) {
  const pickerStyle: React.CSSProperties = {
    position: 'fixed',
    top: Math.max(8, menuPosition.midY - 8),
    transform: 'translateY(-100%)',
    zIndex: 9999,
    ...(isOwn ? { right: window.innerWidth - menuPosition.right } : { left: menuPosition.left }),
  }
  return createPortal(
    <div
      ref={portalRef}
      className="hidden md:grid grid-cols-5 gap-1 rounded-2xl border border-m3-outline-variant bg-m3-surface-container-lowest p-2.5 shadow-xl animate-slide-in dark:border-m3-outline-variant dark:bg-m3-surface-container-high"
      style={pickerStyle}
    >
      {QUICK_EMOJIS.map(emoji => (
        <button
          key={emoji}
          onClick={() => onReaction(emoji)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-xl transition-transform hover:scale-125 hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-highest"
        >
          {emoji}
        </button>
      ))}
    </div>,
    document.body
  )
}

interface ContextMenuPortalProps {
  isOwn: boolean
  isPinned: boolean
  copied: boolean
  menuPosition: { top: number; left: number; right: number; bottom: number; width: number; height: number; midY: number }
  onCopy: () => void
  onPin: () => void
  onForward: () => void
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
  onOpenThread?: () => void
  portalRef: React.RefObject<HTMLDivElement | null>
}

export function ContextMenuPortal({ isOwn, isPinned, copied, menuPosition, onCopy, onPin, onForward, onEdit, onDelete, onClose, onOpenThread, portalRef }: ContextMenuPortalProps) {
  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    top: menuPosition.midY,
    transform: 'translateY(-50%)',
    zIndex: 9999,
    ...(isOwn ? { right: window.innerWidth - menuPosition.left + 4 } : { left: menuPosition.right + 4 }),
  }
  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div ref={portalRef} className="hidden md:block min-w-[160px] rounded-xl border border-m3-outline-variant bg-m3-surface-container-lowest py-1 shadow-xl animate-slide-in dark:border-m3-outline-variant dark:bg-m3-surface-container-high" style={menuStyle}>
        <button
          onClick={onCopy}
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container dark:text-m3-on-surface-variant dark:hover:bg-m3-surface-container-highest"
        >
          {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          {copied ? 'Copied!' : 'Copy text'}
        </button>
        <button
          onClick={onPin}
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container dark:text-m3-on-surface-variant dark:hover:bg-m3-surface-container-highest"
        >
          <Pin className="h-4 w-4" />
          {isPinned ? 'Unpin message' : 'Pin message'}
        </button>
        <button
          onClick={onForward}
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container dark:text-m3-on-surface-variant dark:hover:bg-m3-surface-container-highest"
        >
          <Forward className="h-4 w-4" />
          Forward
        </button>
        {onOpenThread && (
          <button
            onClick={() => { onOpenThread(); onClose() }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container dark:text-m3-on-surface-variant dark:hover:bg-m3-surface-container-highest"
          >
            <MessageSquareText className="h-4 w-4" />
            Reply in thread
          </button>
        )}
        {isOwn && (
          <>
            <button
              onClick={onEdit}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container dark:text-m3-on-surface-variant dark:hover:bg-m3-surface-container-highest"
            >
              <Pencil className="h-4 w-4" />
              Edit message
            </button>
            <div className="my-1 border-t border-m3-outline-variant dark:border-m3-outline-variant" />
            <button
              onClick={onDelete}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-m3-error transition-colors hover:bg-m3-surface-container dark:text-m3-error dark:hover:bg-m3-surface-container-highest"
            >
              <Trash2 className="h-4 w-4" />
              Delete message
            </button>
          </>
        )}
      </div>
    </>,
    document.body
  )
}

interface ForwardPickerPortalProps {
  isOwn: boolean
  menuPosition: { top: number; left: number; right: number; bottom: number; width: number; height: number; midY: number }
  rooms: MatrixRoom[]
  currentRoomId: string
  onForward: (roomId: string) => void
  onClose: () => void
}

export function ForwardPickerPortal({ isOwn, menuPosition, rooms, currentRoomId, onForward, onClose }: ForwardPickerPortalProps) {
  const fwdStyle: React.CSSProperties = {
    position: 'fixed',
    top: menuPosition.top,
    zIndex: 9999,
    ...(isOwn ? { right: window.innerWidth - menuPosition.left + 4 } : { left: menuPosition.right + 4 }),
  }
  const otherRooms = rooms.filter(r => r.roomId !== currentRoomId)
  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} />
      <div className="hidden md:block min-w-[240px] max-h-[280px] overflow-y-auto rounded-xl border border-m3-outline-variant bg-m3-surface-container-lowest py-1.5 shadow-xl animate-slide-in dark:border-m3-outline-variant dark:bg-m3-surface-container-high" style={fwdStyle}>
        <p className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-m3-on-surface-variant dark:text-m3-outline">Forward to...</p>
        <div className="mx-2 mb-1 border-t border-m3-outline-variant/50 dark:border-m3-outline-variant/30" />
        {otherRooms.map(r => (
          <button
            key={r.roomId}
            onClick={() => onForward(r.roomId)}
            className="flex w-full items-center gap-3 px-3 py-2.5 text-sm text-m3-on-surface transition-colors hover:bg-m3-surface-container dark:text-m3-on-surface dark:hover:bg-m3-surface-container-highest rounded-lg mx-1"
            style={{ width: 'calc(100% - 8px)' }}
          >
            <Avatar src={r.avatarUrl} name={r.name} size="sm" />
            <span className="truncate font-medium">{r.name}</span>
          </button>
        ))}
        {otherRooms.length === 0 && (
          <p className="px-4 py-3 text-xs text-m3-outline dark:text-m3-on-surface-variant">No other rooms available</p>
        )}
      </div>
    </>,
    document.body
  )
}

interface TouchMenuProps {
  message: MatrixMessage
  isOwn: boolean
  isPinned: boolean
  roomId: string
  rooms: MatrixRoom[]
  onReaction: (emoji: string) => void
  onReply: () => void
  onCopy: () => void
  onPin: () => void
  onEdit: () => void
  onDelete: () => void
  onForward: (roomId: string) => void
  onOpenThread?: () => void
  onClose: () => void
}

export function TouchMenu({ message, isOwn, isPinned, roomId, rooms, onReaction, onReply, onCopy, onPin, onEdit, onDelete, onForward, onOpenThread, onClose }: TouchMenuProps) {
  const [showForwardPicker, setShowForwardPicker] = useState(false)
  const touchMenuRef = useRef<HTMLDivElement>(null)

  return createPortal(
    <div
      ref={touchMenuRef}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      onTouchEnd={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-md mx-2 mb-2 animate-slide-in rounded-2xl bg-m3-surface-container-lowest pb-4 pt-2 shadow-2xl dark:bg-m3-surface-container-high"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="mb-3 flex justify-center">
          <div className="h-1 w-10 rounded-full bg-m3-outline-variant dark:bg-m3-outline" />
        </div>

        {/* Quick reactions row */}
        <div className="flex justify-center gap-1 px-4 pb-3">
          {QUICK_EMOJIS.map(emoji => (
            <button
              key={emoji}
              onClick={() => { onReaction(emoji); onClose() }}
              className="rounded-xl p-2.5 text-2xl transition-transform active:scale-90 hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-highest"
            >
              {emoji}
            </button>
          ))}
        </div>

        <div className="mx-4 border-t border-m3-outline-variant dark:border-m3-outline-variant" />

        {/* Action buttons */}
        <div className="mt-1 px-2">
          <button
            onClick={() => { onReply(); onClose() }}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-[15px] text-m3-on-surface active:bg-m3-surface-container dark:text-m3-on-surface dark:active:bg-m3-surface-container-highest"
          >
            <Reply className="h-5 w-5 text-m3-outline" />
            Reply
          </button>
          {onOpenThread && (
            <button
              onClick={() => { onOpenThread(); onClose() }}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-[15px] text-m3-on-surface active:bg-m3-surface-container dark:text-m3-on-surface dark:active:bg-m3-surface-container-highest"
            >
              <MessageSquareText className="h-5 w-5 text-m3-outline" />
              Reply in thread
            </button>
          )}
          <button
            onClick={() => { onCopy(); onClose() }}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-[15px] text-m3-on-surface active:bg-m3-surface-container dark:text-m3-on-surface dark:active:bg-m3-surface-container-highest"
          >
            <Copy className="h-5 w-5 text-m3-outline" />
            Copy text
          </button>
          <button
            onClick={() => { onPin(); onClose() }}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-[15px] text-m3-on-surface active:bg-m3-surface-container dark:text-m3-on-surface dark:active:bg-m3-surface-container-highest"
          >
            <Pin className="h-5 w-5 text-m3-outline" />
            {isPinned ? 'Unpin message' : 'Pin message'}
          </button>
          <button
            onClick={() => setShowForwardPicker(true)}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-[15px] text-m3-on-surface active:bg-m3-surface-container dark:text-m3-on-surface dark:active:bg-m3-surface-container-highest"
          >
            <Forward className="h-5 w-5 text-m3-outline" />
            Forward
          </button>
          {showForwardPicker && (
            <div className="mb-2 ml-4 mr-4 max-h-[200px] overflow-y-auto rounded-xl border border-m3-outline-variant bg-m3-surface-container-low py-1 dark:border-m3-outline-variant dark:bg-m3-surface-container">
              {rooms
                .filter(r => r.roomId !== roomId)
                .map(r => (
                  <button
                    key={r.roomId}
                    onClick={() => { onForward(r.roomId); onClose() }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm text-m3-on-surface active:bg-m3-surface-container-high dark:text-m3-on-surface dark:active:bg-m3-surface-container-highest"
                  >
                    <Avatar src={r.avatarUrl} name={r.name} size="sm" />
                    <span className="truncate font-medium">{r.name}</span>
                  </button>
                ))}
            </div>
          )}
          {isOwn && (
            <>
              <button
                onClick={() => { onEdit(); onClose() }}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-[15px] text-m3-on-surface active:bg-m3-surface-container dark:text-m3-on-surface dark:active:bg-m3-surface-container-highest"
              >
                <Pencil className="h-5 w-5 text-m3-outline" />
                Edit message
              </button>
              <div className="mx-4 border-t border-m3-outline-variant dark:border-m3-outline-variant" />
              <button
                onClick={() => { onDelete(); onClose() }}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-[15px] text-m3-error active:bg-m3-surface-container dark:text-m3-error dark:active:bg-m3-surface-container-highest"
              >
                <Trash2 className="h-5 w-5" />
                Delete message
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

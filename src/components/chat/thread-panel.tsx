'use client'

import { useEffect, useCallback, useRef, useState } from 'react'
import { useChatStore, type MatrixMessage } from '@/stores/chat-store'
import { useAuthStore } from '@/stores/auth-store'
import { MessageBubble } from './message-bubble'
import { ArrowLeft, Send } from 'lucide-react'

interface ThreadPanelProps {
  roomId: string
  threadRootId: string
  onClose: () => void
}

export function ThreadPanel({ roomId, threadRootId, onClose }: ThreadPanelProps) {
  const user = useAuthStore(s => s.user)
  const { threadMessages, isLoadingThread, loadThread, sendThreadReply } = useChatStore()
  const [content, setContent] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    loadThread(roomId, threadRootId)
  }, [roomId, threadRootId, loadThread])

  useEffect(() => {
    // Scroll to bottom when messages change
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [threadMessages])

  const handleSend = useCallback(() => {
    const trimmed = content.trim()
    if (!trimmed) return
    sendThreadReply(roomId, threadRootId, trimmed)
    setContent('')
    inputRef.current?.focus()
    // Reload thread after sending
    setTimeout(() => loadThread(roomId, threadRootId), 500)
  }, [content, roomId, threadRootId, sendThreadReply, loadThread])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!user) return null

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white dark:bg-m3-surface">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-m3-outline-variant bg-white px-2 py-2.5 dark:border-m3-outline-variant dark:bg-m3-surface-container md:px-4">
        <button
          onClick={onClose}
          className="rounded-full p-2 text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h3 className="text-base font-medium text-m3-on-surface">Thread</h3>
        <span className="text-xs text-m3-on-surface-variant">
          {threadMessages.length > 0 ? `${threadMessages.length} ${threadMessages.length === 1 ? 'message' : 'messages'}` : ''}
        </span>
      </div>

      {/* Thread messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 pt-4 pb-4 md:px-6">
        {isLoadingThread ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-m3-primary border-t-transparent" />
          </div>
        ) : (
          <div className="flex min-h-full flex-col justify-end space-y-0.5">
            {threadMessages.map((msg, idx) => (
              <MessageBubble
                key={msg.eventId}
                message={msg}
                isOwn={msg.senderId === user.userId}
                showAvatar={idx === 0 || threadMessages[idx - 1]?.senderId !== msg.senderId}
                onReply={() => {}}
                roomId={roomId}
              />
            ))}
          </div>
        )}
      </div>

      {/* Thread input */}
      <div className="border-t border-m3-outline-variant/50 bg-[#f8f9fa] px-3 py-2.5 dark:bg-m3-surface md:px-4">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center rounded-full border border-m3-outline-variant/40 bg-white dark:border-m3-outline-variant/40 dark:bg-m3-surface-container-high">
            <textarea
              ref={inputRef}
              value={content}
              onChange={e => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Reply in thread..."
              rows={1}
              className="max-h-24 min-h-[40px] flex-1 resize-none bg-transparent px-4 py-2.5 text-[15px] text-m3-on-surface placeholder-m3-on-surface-variant focus:outline-none dark:text-m3-on-surface dark:placeholder-m3-outline"
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!content.trim()}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-m3-primary text-white transition-all hover:bg-m3-primary/90 disabled:opacity-30"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  )
}

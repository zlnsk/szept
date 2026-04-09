'use client'

import { Avatar } from '@/components/ui/avatar'
import type { MatrixMessage } from '@/stores/chat-store'

interface MessageReactionsProps {
  message: MatrixMessage
  isOwn: boolean
  onReaction: (emoji: string) => void
}

export function MessageReactions({ message, isOwn, onReaction }: MessageReactionsProps) {
  if (message.reactions.size === 0) return null

  return (
    <div className="relative z-10 flex flex-wrap gap-1">
      {Array.from(message.reactions.entries()).map(([emoji, data]) => (
        <div key={emoji} className="group/reaction relative">
          <button
            onClick={() => onReaction(emoji)}
            className={`reaction-pill flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs shadow-sm transition-all duration-150 hover:scale-105 ${
              data.includesMe
                ? 'own-reaction border-m3-primary/50 bg-m3-primary-container text-m3-primary dark:border-m3-primary/50 dark:bg-m3-primary-container/30 dark:text-m3-primary'
                : 'border-m3-outline-variant bg-white text-m3-on-surface-variant hover:border-m3-outline hover:bg-m3-surface-container-low dark:border-m3-outline-variant dark:bg-m3-surface-container dark:text-m3-outline dark:hover:border-m3-outline'
            }`}
          >
            <span className="text-base leading-none reaction-animate">{emoji}</span>
            <span className="reaction-count-animate">{data.count}</span>
          </button>
          {/* Hover tooltip showing who reacted */}
          <div className={`absolute bottom-full mb-1.5 hidden group-hover/reaction:block z-30 ${isOwn ? 'right-0' : 'left-0'}`}>
            <div className="rounded-lg border border-m3-outline-variant bg-m3-surface-container-lowest px-2.5 py-1.5 shadow-lg dark:border-m3-outline-variant dark:bg-m3-surface-container-high whitespace-nowrap">
              <p className="text-[11px] font-medium text-m3-on-surface-variant dark:text-m3-outline mb-0.5">{emoji} {data.count > 1 ? `${data.count} people` : '1 person'}</p>
              {data.users.map((userName, i) => (
                <p key={i} className="text-xs text-m3-on-surface dark:text-m3-on-surface-variant">{userName}</p>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

interface ReadReceiptsProps {
  message: MatrixMessage
  isOwn: boolean
}

export function ReadReceipts({ message, isOwn }: ReadReceiptsProps) {
  if (!isOwn || message.readBy.length === 0) return null

  return (
    <div className="mt-1.5 flex items-center justify-end gap-1.5 animate-seen-pop">
      <span className="text-[11px] font-medium text-m3-primary dark:text-m3-primary">
        Seen
      </span>
      <div className="flex -space-x-1.5">
        {message.readBy.slice(0, 4).map(r => (
          <div key={r.userId} title={`Seen by ${r.displayName}`} className="ring-2 ring-white dark:ring-m3-surface rounded-full">
            <Avatar src={r.avatarUrl} name={r.displayName} size="sm" />
          </div>
        ))}
        {message.readBy.length > 4 && (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-m3-surface-container-high text-[10px] font-medium text-m3-on-surface-variant ring-2 ring-white dark:ring-m3-surface dark:bg-m3-surface-container-highest dark:text-m3-outline">
            +{message.readBy.length - 4}
          </span>
        )}
      </div>
    </div>
  )
}

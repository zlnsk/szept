"use client"

import { useState, useEffect, lazy, Suspense } from 'react'
import { Sidebar } from './sidebar'
import { ChatArea } from './chat-area'
import { useChatStore } from '@/stores/chat-store'
import { MessageSquare } from 'lucide-react'
import { DebugStatusBar } from '@/components/ui/debug-status-bar'

// Lazy load heavy modal components — only fetched when opened
// Retry with full page reload on chunk load failure (stale deployment)
const SettingsPanel = lazy(() =>
  import('./settings-panel').then(m => ({ default: m.SettingsPanel })).catch(() => {
    // Prevent infinite reload loop on permanent chunk load failure
    const key = 'settings_chunk_reload'
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1')
      window.location.reload()
    }
    return new Promise(() => {}) // never resolves — page is reloading
  })
)

export function ChatLayout() {
  const [showSettings, setShowSettings] = useState(false)
  const [settingsSection, setSettingsSection] = useState<'main' | 'profile' | 'security' | 'about'>('main')
  const activeRoom = useChatStore(s => s.activeRoom)
  const rooms = useChatStore(s => s.rooms)

  // Update document title with unread message count
  useEffect(() => {
    const totalUnread = rooms.reduce((sum, r) => sum + r.unreadCount, 0)
    document.title = totalUnread > 0 ? `(${totalUnread}) Messages` : 'Messages'
  }, [rooms])

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-white dark:bg-m3-surface">
      <div className="flex flex-1 min-h-0">
      {/* Sidebar — always visible */}
      <div className="flex w-80 flex-shrink-0 flex-col border-r border-m3-outline-variant/40 bg-white dark:border-m3-outline-variant/40 dark:bg-m3-surface overflow-hidden">
        <Sidebar
          onSettingsClick={() => { setSettingsSection('main'); setShowSettings(true) }}
          onChatSelect={() => {}}
          onProfileClick={() => { setSettingsSection('profile'); setShowSettings(true) }}
        />
      </div>

      {/* Chat area — flexible */}
      {activeRoom ? (
        <div className="flex flex-1 flex-col min-w-0">
          <ChatArea />
        </div>
      ) : (
        <div className="flex flex-1">
          <EmptyState />
        </div>
      )}

      </div>

      <DebugStatusBar />

      {/* Settings overlay — lazy loaded */}
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsPanel onClose={() => setShowSettings(false)} initialSection={settingsSection} />
        </Suspense>
      )}

    </div>
  )
}

// StatusBar replaced by DebugStatusBar

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-[#f8f9fa] p-8 dark:bg-m3-surface">
      <div className="empty-state-icon flex h-20 w-20 items-center justify-center rounded-full bg-blue-50 dark:bg-m3-primary-container/20">
        <MessageSquare className="h-10 w-10 text-m3-primary" />
      </div>
      <h3 className="mt-5 text-xl font-normal text-m3-on-surface">
        Messages for Matrix
      </h3>
      <p className="mt-2 max-w-xs text-center text-sm text-m3-on-surface-variant">
        Send and receive messages with your Matrix contacts. Select a conversation to get started.
      </p>
    </div>
  )
}

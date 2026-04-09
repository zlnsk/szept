'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useChatStore, type MatrixRoom } from '@/stores/chat-store'
import { useAuthStore } from '@/stores/auth-store'
import { getHomeserverDomain } from '@/lib/matrix/client'
import { Avatar } from '@/components/ui/avatar'
import {
  Users,
  Loader2,
  Lock,
  Globe,
  Send,
  X,
  Search,
  MessageCircle,
  ArrowRight,
} from 'lucide-react'

interface NewChatModalProps {
  onClose: () => void
  onRoomCreated: (roomId: string) => void
}

/** Returns true when the string looks like a Matrix user ID: @something:domain */
function isMatrixId(s: string): boolean {
  return /^@[^\s:]+:[^\s:]+\.[^\s:]+$/.test(s.trim())
}

/** Returns true when the string looks like a partial Matrix ID being typed */
function looksLikeMatrixId(s: string): boolean {
  const t = s.trim()
  return t.startsWith('@') && t.includes(':')
}

export function NewChatModal({ onClose, onRoomCreated }: NewChatModalProps) {
  const { createDirectChat, createGroupChat, loadRooms, rooms, setActiveRoom } = useChatStore()
  const user = useAuthStore(s => s.user)
  const [tab, setTab] = useState<'direct' | 'group'>('direct')
  const [query, setQuery] = useState('')
  const [groupName, setGroupName] = useState('')
  const [groupMembers, setGroupMembers] = useState('')
  const [groupTopic, setGroupTopic] = useState('')
  const [enableEncryption, setEnableEncryption] = useState(true)
  const [isPublic, setIsPublic] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const domain = getHomeserverDomain() || 'matrix.org'

  // Close on click outside or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  // Filter existing rooms/contacts based on query
  const filteredRooms = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || looksLikeMatrixId(query)) return []

    return rooms
      .filter(room => {
        // Match room name
        if (room.name.toLowerCase().includes(q)) return true
        // Match member names/IDs
        return room.members.some(m =>
          m.displayName.toLowerCase().includes(q) ||
          m.userId.toLowerCase().includes(q)
        )
      })
      .slice(0, 8)
  }, [query, rooms])

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [filteredRooms.length])

  // Determine if the query is a new Matrix ID to message
  const isNewMatrixId = useMemo(() => {
    const q = query.trim()
    if (!isMatrixId(q) && !(q.length > 1 && !q.startsWith('@') && !q.includes(':'))) return false
    // Check it's not already an existing room member
    const normalized = q.startsWith('@') ? q : `@${q}`
    const existingRoom = rooms.find(r =>
      r.isDirect && r.members.some(m => m.userId === normalized || m.userId === `${normalized}:${domain}`)
    )
    return !existingRoom
  }, [query, rooms, domain])

  const handleSelectRoom = (room: MatrixRoom) => {
    setActiveRoom(room)
    onRoomCreated(room.roomId)
    onClose()
  }

  const handleDirectChat = async (targetUserId?: string) => {
    const raw = targetUserId || query.trim()
    if (!raw) return
    setError('')
    setIsCreating(true)
    try {
      let fullUserId = raw
      if (!fullUserId.startsWith('@')) {
        fullUserId = `@${fullUserId}`
      }
      if (!fullUserId.includes(':')) {
        fullUserId = `${fullUserId}:${domain}`
      }

      const matrixIdRegex = /^@[a-zA-Z0-9._=\-/+]+:[a-zA-Z0-9.-]+$/
      if (!matrixIdRegex.test(fullUserId)) {
        setError('Invalid Matrix user ID format. Expected: @user:domain.com')
        setIsCreating(false)
        return
      }

      const roomId = await createDirectChat(fullUserId)
      loadRooms()
      onRoomCreated(roomId)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create chat')
    } finally {
      setIsCreating(false)
    }
  }

  const handleCreateGroup = async () => {
    if (!groupName.trim() || !groupMembers.trim()) return
    setError('')
    setIsCreating(true)
    try {
      const memberIds = groupMembers
        .split(',')
        .map(m => {
          let id = m.trim()
          if (!id.startsWith('@')) id = `@${id}`
          if (!id.includes(':')) id = `${id}:${domain}`
          return id
        })
        .filter(Boolean)

      const roomId = await createGroupChat(groupName.trim(), memberIds, {
        encrypted: enableEncryption,
        isPublic,
        topic: groupTopic.trim() || undefined,
      })
      loadRooms()
      onRoomCreated(roomId)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group')
    } finally {
      setIsCreating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const totalItems = filteredRooms.length + (isNewMatrixId ? 1 : 0)
    if (totalItems === 0) {
      if (e.key === 'Enter') handleDirectChat()
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, totalItems - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (selectedIndex < filteredRooms.length) {
        handleSelectRoom(filteredRooms[selectedIndex])
      } else if (isNewMatrixId) {
        handleDirectChat()
      } else if (filteredRooms.length === 0) {
        handleDirectChat()
      }
    }
  }

  /** Get a display-friendly subtitle for a room in the search results */
  const getRoomSubtitle = (room: MatrixRoom) => {
    if (room.isDirect) {
      const other = room.members.find(m => m.userId !== user?.userId)
      return other?.userId || ''
    }
    return `${room.members.length} members`
  }

  /** Get avatar URL for a room */
  const getRoomAvatar = (room: MatrixRoom) => {
    if (room.avatarUrl) return room.avatarUrl
    if (room.isDirect) {
      const other = room.members.find(m => m.userId !== user?.userId)
      return other?.avatarUrl || null
    }
    return null
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-white dark:bg-m3-surface-container animate-fade-in overflow-hidden">
      <div
        ref={panelRef}
        className="flex flex-col h-full overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 className="text-xl font-medium text-m3-on-surface">New conversation</h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex mx-6 mt-1 mb-4 rounded-full bg-m3-surface-container p-1 dark:bg-m3-surface-container-high">
          <button
            onClick={() => { setTab('direct'); setError('') }}
            className={`flex-1 flex items-center justify-center gap-2 rounded-full py-2 text-sm font-medium transition-all ${
              tab === 'direct'
                ? 'bg-white text-m3-primary shadow-sm dark:bg-m3-surface-container-lowest dark:text-m3-primary'
                : 'text-m3-on-surface-variant hover:text-m3-on-surface'
            }`}
          >
            <MessageCircle className="h-4 w-4" />
            Direct message
          </button>
          <button
            onClick={() => { setTab('group'); setError('') }}
            className={`flex-1 flex items-center justify-center gap-2 rounded-full py-2 text-sm font-medium transition-all ${
              tab === 'group'
                ? 'bg-white text-m3-primary shadow-sm dark:bg-m3-surface-container-lowest dark:text-m3-primary'
                : 'text-m3-on-surface-variant hover:text-m3-on-surface'
            }`}
          >
            <Users className="h-4 w-4" />
            Group
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mb-3 rounded-xl bg-m3-error-container px-4 py-2.5 text-sm text-m3-error dark:bg-m3-error-container/20">
            {error}
          </div>
        )}

        {/* Direct message tab */}
        {tab === 'direct' && (
          <div className="flex flex-col">
            {/* Search input */}
            <div className="mx-6 mb-3">
              <div className="flex items-center gap-2.5 rounded-xl bg-m3-surface-container px-3.5 py-2.5 transition-colors focus-within:bg-m3-surface-container-high dark:bg-m3-surface-container-high dark:focus-within:bg-m3-surface-container-highest">
                <Search className="h-4 w-4 flex-shrink-0 text-m3-on-surface-variant" />
                <input
                  ref={inputRef}
                  type="text"
                  placeholder={`Search or enter @user:${domain}`}
                  value={query}
                  onChange={e => { setQuery(e.target.value); setError('') }}
                  onKeyDown={handleKeyDown}
                  autoFocus
                  className="min-w-0 flex-1 bg-transparent text-sm text-m3-on-surface placeholder-m3-outline outline-none border-none shadow-none ring-0 focus:outline-none focus:ring-0 focus:border-none focus:shadow-none"
                />
                {query && (
                  <button
                    onClick={() => setQuery('')}
                    className="rounded-full p-0.5 text-m3-on-surface-variant hover:text-m3-on-surface"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Results list */}
            <div className="overflow-y-auto" style={{ maxHeight: 340 }}>
              {/* Existing rooms/contacts */}
              {filteredRooms.map((room, i) => (
                <button
                  key={room.roomId}
                  onClick={() => handleSelectRoom(room)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`flex w-full items-center gap-3 px-6 py-3 text-left transition-colors ${
                    selectedIndex === i
                      ? 'bg-m3-primary-container/30 dark:bg-m3-surface-container-high'
                      : 'hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high'
                  }`}
                >
                  <Avatar
                    src={getRoomAvatar(room)}
                    name={room.name}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-m3-on-surface">{room.name}</p>
                    <p className="truncate text-xs text-m3-on-surface-variant">{getRoomSubtitle(room)}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 flex-shrink-0 text-m3-outline" />
                </button>
              ))}

              {/* "Start new chat" option when query looks like a Matrix ID */}
              {isNewMatrixId && (
                <button
                  onClick={() => handleDirectChat()}
                  onMouseEnter={() => setSelectedIndex(filteredRooms.length)}
                  disabled={isCreating}
                  className={`flex w-full items-center gap-3 px-6 py-3 text-left transition-colors ${
                    selectedIndex === filteredRooms.length
                      ? 'bg-m3-primary-container/30 dark:bg-m3-surface-container-high'
                      : 'hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high'
                  }`}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-m3-primary/10 text-m3-primary">
                    {isCreating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-m3-primary">
                      Message {query.startsWith('@') ? query.trim() : `@${query.trim()}`}
                    </p>
                    <p className="text-xs text-m3-on-surface-variant">Start a new conversation</p>
                  </div>
                </button>
              )}

              {/* Empty states */}
              {query.trim() && !looksLikeMatrixId(query) && filteredRooms.length === 0 && (
                <div className="px-6 py-8 text-center">
                  <Search className="mx-auto h-8 w-8 text-m3-outline/50" />
                  <p className="mt-3 text-sm text-m3-on-surface-variant">
                    No matching conversations
                  </p>
                  <p className="mt-1 text-xs text-m3-outline">
                    Enter a full Matrix ID like <span className="font-mono">@user:{domain}</span> to start a new chat
                  </p>
                </div>
              )}

              {!query.trim() && (
                <div className="px-6 py-8 text-center">
                  <MessageCircle className="mx-auto h-8 w-8 text-m3-outline/50" />
                  <p className="mt-3 text-sm text-m3-on-surface-variant">
                    Search for an existing conversation
                  </p>
                  <p className="mt-1 text-xs text-m3-outline">
                    or enter a Matrix ID like <span className="font-mono">@user:{domain}</span>
                  </p>
                </div>
              )}
            </div>

            {/* Bottom padding */}
            <div className="h-4" />
          </div>
        )}

        {/* Group tab */}
        {tab === 'group' && (
          <div className="px-6 pb-6 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-m3-on-surface-variant">Group name</label>
              <input
                type="text"
                placeholder="My Group"
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                autoFocus
                className="w-full rounded-xl bg-m3-surface-container px-4 py-2.5 text-sm text-m3-on-surface placeholder-m3-outline transition-colors focus:bg-m3-surface-container-high focus:outline-none focus:ring-1 focus:ring-m3-primary/40 dark:bg-m3-surface-container-high dark:focus:bg-m3-surface-container-highest"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-m3-on-surface-variant">
                Members (comma-separated)
              </label>
              <textarea
                placeholder={`@user1:${domain}, @user2:${domain}`}
                value={groupMembers}
                onChange={e => setGroupMembers(e.target.value)}
                rows={2}
                className="w-full rounded-xl bg-m3-surface-container px-4 py-2.5 text-sm text-m3-on-surface placeholder-m3-outline transition-colors focus:bg-m3-surface-container-high focus:outline-none focus:ring-1 focus:ring-m3-primary/40 dark:bg-m3-surface-container-high dark:focus:bg-m3-surface-container-highest resize-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-m3-on-surface-variant">
                Topic (optional)
              </label>
              <input
                type="text"
                placeholder="What is this room about?"
                value={groupTopic}
                onChange={e => setGroupTopic(e.target.value)}
                className="w-full rounded-xl bg-m3-surface-container px-4 py-2.5 text-sm text-m3-on-surface placeholder-m3-outline transition-colors focus:bg-m3-surface-container-high focus:outline-none focus:ring-1 focus:ring-m3-primary/40 dark:bg-m3-surface-container-high dark:focus:bg-m3-surface-container-highest"
              />
            </div>

            {/* Toggles */}
            <div className="space-y-1">
              <div className="flex items-center justify-between rounded-xl px-1 py-2.5">
                <div className="flex items-center gap-3">
                  <Lock className="h-4 w-4 text-m3-on-surface-variant" />
                  <span className="text-sm text-m3-on-surface">Encryption</span>
                </div>
                <button
                  type="button"
                  onClick={() => setEnableEncryption(!enableEncryption)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-all duration-200 ${
                    enableEncryption ? 'bg-m3-primary' : 'bg-m3-outline-variant dark:bg-m3-outline'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-all duration-200 ${
                      enableEncryption ? 'translate-x-[22px]' : 'translate-x-0.5'
                    } mt-0.5`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between rounded-xl px-1 py-2.5">
                <div className="flex items-center gap-3">
                  <Globe className="h-4 w-4 text-m3-on-surface-variant" />
                  <span className="text-sm text-m3-on-surface">Public room</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPublic(!isPublic)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full transition-all duration-200 ${
                    isPublic ? 'bg-m3-primary' : 'bg-m3-outline-variant dark:bg-m3-outline'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-all duration-200 ${
                      isPublic ? 'translate-x-[22px]' : 'translate-x-0.5'
                    } mt-0.5`}
                  />
                </button>
              </div>
            </div>

            <button
              onClick={handleCreateGroup}
              disabled={isCreating || !groupName.trim() || !groupMembers.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-m3-primary py-3 text-sm font-medium text-white shadow-sm transition-all hover:bg-m3-primary/90 hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
            >
              {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
              Create Group
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

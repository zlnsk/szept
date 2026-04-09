'use client'

import { useEffect, useState, useCallback, useRef, useMemo, memo, lazy, Suspense } from 'react'
import { useClickOutside } from "@/hooks/useClickOutside"
import { useAuthStore } from '@/stores/auth-store'
import { useChatStore, type MatrixRoom, type MatrixSpace } from '@/stores/chat-store'
import { resolveRoomAvatarFromSDK } from '@/lib/matrix/client'
import { getAccountDataContent, setAccountData } from '@/lib/matrix/sdk-compat'
import { useTheme } from '@/components/providers/theme-provider'
import { Avatar } from '@/components/ui/avatar'

// Lazy load modals — only fetched when opened
const NewChatModal = lazy(() => import('./new-chat-modal').then(m => ({ default: m.NewChatModal })))
import { formatDistanceToNow } from 'date-fns'
import {
  Search,
  Settings,
  Lock,
  MessageSquare,
  X,
  Archive,
  Check,
  Mail,
  Sun,
  Moon,
  Loader2,
  MessageSquareDashed,
  Menu,
  MessageCircle,
  Plus,
  ChevronRight,
  Pencil,
  Star,
} from 'lucide-react'
import { getMatrixClient } from '@/lib/matrix/client'

interface SidebarProps {
  onSettingsClick: () => void
  onChatSelect: () => void
  onProfileClick: () => void
}

export function Sidebar({ onSettingsClick, onChatSelect, onProfileClick }: SidebarProps) {
  const user = useAuthStore(s => s.user)
  const { rooms, pendingInvites, loadRooms, setActiveRoom, activeRoom, markAsRead, archiveRoom, unarchiveRoom, leaveRoom, acceptInvite, rejectInvite, searchMessages, spaces, activeSpaceId, setActiveSpace, favoriteRoomIds, toggleFavorite, loadFavorites, prefetchRoom } = useChatStore()
  const { theme, toggleTheme } = useTheme()
  const [searchFilter, setSearchFilter] = useState('')
  const [showNewChat, setShowNewChat] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [showInvites, setShowInvites] = useState(true)
  const [searchTab, setSearchTab] = useState<'conversations' | 'messages'>('conversations')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [processingInviteId, setProcessingInviteId] = useState<string | null>(null)
  const [messageResults, setMessageResults] = useState<{roomId: string, roomName: string, eventId: string, sender: string, body: string, timestamp: number}[]>([])
  const [isSearchingMessages, setIsSearchingMessages] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showHamburger, setShowHamburger] = useState(false)
  const [showProfilePopover, setShowProfilePopover] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [currentPresence, setCurrentPresence] = useState<'online' | 'unavailable' | 'offline'>('online')
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hamburgerRef = useRef<HTMLDivElement>(null)
  const profilePopoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (user) {
      loadRooms()
      loadFavorites()
    }
  }, [user, loadRooms, loadFavorites])

  // Close hamburger on outside click
  useClickOutside(hamburgerRef, useCallback(() => setShowHamburger(false), []), showHamburger)

  // Close profile popover on outside click
  useClickOutside(profilePopoverRef, useCallback(() => setShowProfilePopover(false), []), showProfilePopover)

  // Load saved status and presence from server on mount
  useEffect(() => {
    const client = getMatrixClient()
    if (!client) return
    try {
      // Load status message from account data (persists across sessions)
      const statusData = getAccountDataContent(client, 'im.vector.web.status') as { status_msg?: string }
      if (statusData?.status_msg) setStatusText(statusData.status_msg)
      // Load current presence from the SDK's user object
      const myUser = client.getUser(client.getUserId()!)
      if (myUser?.presence) {
        setCurrentPresence(myUser.presence as 'online' | 'unavailable' | 'offline')
      }
    } catch { /* ignore — account data may not exist yet */ }
  }, [user])

  const handleSaveStatus = useCallback(async () => {
    const client = getMatrixClient()
    if (!client) return
    // Persist status message to account data (survives browser close)
    try {
      await setAccountData(client, 'im.vector.web.status', { status_msg: statusText || '' })
    } catch { /* ignore */ }
    // Also set presence with status_msg for real-time visibility to other users
    try {
      await (client as unknown as { setPresence: (opts: { presence: string; status_msg?: string }) => Promise<void> })
        .setPresence({ presence: currentPresence, status_msg: statusText || undefined })
    } catch { /* ignore */ }
  }, [statusText, currentPresence])

  const handleSetPresence = useCallback(async (presence: 'online' | 'unavailable' | 'offline') => {
    setCurrentPresence(presence)
    const client = getMatrixClient()
    if (!client) return
    try {
      await (client as unknown as { setPresence: (opts: { presence: string; status_msg?: string }) => Promise<void> })
        .setPresence({ presence, status_msg: statusText || undefined })
    } catch { /* ignore */ }
  }, [statusText])

  // Debounced message search when query has 3+ characters
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }

    if (searchFilter.trim().length >= 3) {
      setIsSearchingMessages(true)
      searchDebounceRef.current = setTimeout(async () => {
        try {
          const results = await searchMessages(searchFilter.trim())
          setMessageResults(results)
        } catch {
          setMessageResults([])
        } finally {
          setIsSearchingMessages(false)
        }
      }, 400)
    } else {
      setMessageResults([])
      setIsSearchingMessages(false)
    }

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
  }, [searchFilter, searchMessages])

  const handleSelectRoom = useCallback(async (room: MatrixRoom) => {
    setShowSearch(false); setSearchFilter('');
    setActiveRoom(room)
    await markAsRead(room.roomId)
    onChatSelect()
  }, [setActiveRoom, markAsRead, onChatSelect])

  const spaceFilteredRooms = useMemo(() => {
    if (!activeSpaceId) return rooms
    const space = spaces.find(s => s.roomId === activeSpaceId)
    if (!space) return rooms
    const childIds = new Set([...space.childRoomIds, ...space.childSpaceIds])
    return rooms.filter(r => childIds.has(r.roomId))
  }, [rooms, spaces, activeSpaceId])

  const activeRooms = useMemo(() => spaceFilteredRooms.filter(room => {
    if (room.isArchived) return false
    if (searchFilter && !room.name.toLowerCase().includes(searchFilter.toLowerCase())) return false
    return true
  }), [spaceFilteredRooms, searchFilter])
  const favoriteRooms = useMemo(() => activeRooms.filter(r => favoriteRoomIds.includes(r.roomId)), [activeRooms, favoriteRoomIds])
  const nonFavoriteRooms = useMemo(() => activeRooms.filter(r => !favoriteRoomIds.includes(r.roomId)), [activeRooms, favoriteRoomIds])
  const archivedRooms = useMemo(() => spaceFilteredRooms.filter(room =>
    room.isArchived && room.name.toLowerCase().includes(searchFilter.toLowerCase())
  ), [spaceFilteredRooms, searchFilter])
  const unreadCount = useMemo(() => rooms.filter(r => !r.isArchived && r.unreadCount > 0).length, [rooms])

  // Document title is managed by ChatLayout — removed duplicate here to prevent race

  const searchHighlightRegex = useMemo(() => {
    const escaped = searchFilter.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (escaped.length < 2) return null
    return new RegExp(`(${escaped})`, 'gi')
  }, [searchFilter])

  // Avatar: roomToMatrixRoom() already computes the correct avatar via
  // Element Web's algorithm. Just use room.avatarUrl, with SDK fallback.
  const getOtherMemberAvatar = useCallback((room: MatrixRoom) => {
    if (room.avatarUrl) return room.avatarUrl
    return resolveRoomAvatarFromSDK(room.roomId)
  }, [])

  const getOtherMemberPresence = (room: MatrixRoom): 'online' | 'offline' | 'away' | null => {
    if (room.isDirect) {
      const BOT_USER_IDS: string[] = []
      const isBotUser = (userId: string) => BOT_USER_IDS.includes(userId)
      const isBridgePuppet = (userId: string) => /^@(signal_|telegram_|whatsapp_|slack_|discord_|instagram_)/.test(userId)
      const other = room.members.find(m => m.userId !== user?.userId && !isBotUser(m.userId)) || room.members.find(m => m.userId !== user?.userId && isBridgePuppet(m.userId))
      if (other?.presence === 'online') return 'online'
      if (other?.presence === 'unavailable') return 'away'
      if (other?.presence === 'offline') return 'offline'
    }
    return null
  }

  const handleArchive = async (e: React.MouseEvent, room: MatrixRoom) => {
    e.stopPropagation()
    if (room.isArchived) {
      await unarchiveRoom(room.roomId)
    } else {
      await archiveRoom(room.roomId)
      if (activeRoom?.roomId === room.roomId) {
        setActiveRoom(null)
      }
    }
  }

  const [confirmDeleteRoom, setConfirmDeleteRoom] = useState<MatrixRoom | null>(null)

  const handleLeave = (e: React.MouseEvent, room: MatrixRoom) => {
    e.stopPropagation()
    setConfirmDeleteRoom(room)
  }

  const handleMarkAsRead = async (e: React.MouseEvent, room: MatrixRoom) => {
    e.stopPropagation()
    await markAsRead(room.roomId)
  }

  const confirmLeave = async () => {
    if (!confirmDeleteRoom) return
    if (activeRoom?.roomId === confirmDeleteRoom.roomId) {
      setActiveRoom(null)
    }
    try {
      await leaveRoom(confirmDeleteRoom.roomId)
    } catch (err) {
      console.error('Failed to leave room:', err)
    }
    setConfirmDeleteRoom(null)
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Header — Google Messages Web style */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="relative sidebar-hide-collapsed" ref={hamburgerRef}>
          <button
            onClick={() => setShowHamburger(!showHamburger)}
            className="rounded-full p-2 text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container active:bg-m3-surface-container-high dark:hover:bg-m3-surface-container-high"
            aria-label="Menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Hamburger dropdown */}
          {showHamburger && (
            <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-2xl border border-m3-outline-variant bg-m3-surface-container-lowest py-2 shadow-xl animate-slide-in dark:border-m3-outline-variant dark:bg-m3-surface-container">
              {/* App title */}
              <div className="px-6 py-3 border-b border-m3-outline-variant">
                <h2 className="text-lg font-normal text-m3-on-surface">Messages</h2>
                <p className="text-xs text-m3-on-surface-variant">{user?.userId}</p>
              </div>

              <div className="py-1">
                <button
                  onClick={() => { onSettingsClick(); setShowHamburger(false) }}
                  className="flex w-full items-center gap-4 px-6 py-3 text-sm text-m3-on-surface transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
                >
                  <Settings className="h-5 w-5 text-m3-on-surface-variant" />
                  Settings
                </button>
                <button
                  onClick={() => { toggleTheme(); setShowHamburger(false) }}
                  className="flex w-full items-center gap-4 px-6 py-3 text-sm text-m3-on-surface transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
                >
                  {theme === 'dark' ? <Sun className="h-5 w-5 text-m3-on-surface-variant" /> : <Moon className="h-5 w-5 text-m3-on-surface-variant" />}
                  {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1" onClick={() => { setActiveRoom(null); onChatSelect() }} />

        {/* Theme toggle — Emails style */}
        <button
          onClick={toggleTheme}
          className="sidebar-hide-collapsed h-9 w-9 rounded-full flex items-center justify-center text-m3-on-surface-variant hover:bg-m3-surface-container transition-colors"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
        </button>

        {/* Search button */}
        <button
          onClick={() => { setShowSearch(s => !s); if (showSearch) setSearchFilter('') }}
          className={`sidebar-hide-collapsed h-9 w-9 rounded-full flex items-center justify-center transition-colors ${showSearch ? 'bg-m3-primary/10 text-m3-primary' : 'text-m3-on-surface-variant hover:bg-m3-primary/10 hover:text-m3-primary'}`}
          title="Search"
        >
          <Search className="h-[18px] w-[18px]" />
        </button>

        {/* New chat button */}
        <button
          onClick={() => setShowNewChat(true)}
          className="sidebar-hide-collapsed h-9 w-9 rounded-full flex items-center justify-center text-m3-on-surface-variant hover:bg-m3-primary/10 hover:text-m3-primary transition-colors"
          title="New chat"
        >
          <Plus className="h-[18px] w-[18px]" />
        </button>

        <div className="relative sidebar-hide-collapsed" ref={profilePopoverRef}>
          <button
            onClick={() => setShowProfilePopover(!showProfilePopover)}
            className="rounded-full transition-all hover:ring-2 hover:ring-m3-primary/30 active:scale-95"
            aria-label="Profile and status"
          >
            <Avatar
              src={user?.avatarUrl}
              name={user?.displayName || 'U'}
              size="md"
              status="online"
            />
          </button>

          {/* Profile popover */}
          {showProfilePopover && (
            <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-2xl border border-m3-outline-variant bg-m3-surface-container-lowest shadow-xl animate-scale-in dark:border-m3-outline-variant dark:bg-m3-surface-container">
              {/* User info */}
              <div className="flex items-center gap-3 px-5 py-4">
                <Avatar src={user?.avatarUrl} name={user?.displayName || 'U'} size="lg" status="online" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-m3-on-surface">{user?.displayName}</p>
                  <p className="truncate text-xs text-m3-on-surface-variant">{user?.userId}</p>
                </div>
              </div>

              {/* Theme toggle */}
              <div className="border-t border-m3-outline-variant px-5 py-3 dark:border-m3-outline-variant">
                <button
                  onClick={toggleTheme}
                  className="flex w-full items-center gap-3 text-sm text-m3-on-surface transition-colors hover:opacity-80"
                >
                  {theme === "dark" ? <Sun className="h-4 w-4 text-m3-on-surface-variant" /> : <Moon className="h-4 w-4 text-m3-on-surface-variant" />}
                  {theme === "dark" ? "Light mode" : "Dark mode"}
                </button>
              </div>

              {/* Status input */}
              <div className="border-t border-m3-outline-variant px-5 py-3 dark:border-m3-outline-variant">
                <label className="mb-1.5 block text-xs font-medium text-m3-on-surface-variant">Status message</label>
                <input
                  type="text"
                  value={statusText}
                  onChange={e => setStatusText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { handleSaveStatus(); setShowProfilePopover(false) } }}
                  placeholder="What's on your mind?"
                  className="w-full rounded-lg bg-m3-surface-container px-3 py-2 text-sm text-m3-on-surface placeholder-m3-outline transition-colors focus:bg-m3-surface-container-high focus:outline-none dark:bg-m3-surface-container-high dark:focus:bg-m3-surface-container-highest"
                />
              </div>

              {/* Presence selector */}
              <div className="border-t border-m3-outline-variant px-5 py-3 dark:border-m3-outline-variant">
                <label className="mb-2 block text-xs font-medium text-m3-on-surface-variant">Presence</label>
                <div className="flex gap-2">
                  {(['online', 'unavailable', 'offline'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => handleSetPresence(p)}
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                        currentPresence === p
                          ? 'bg-m3-primary-container text-m3-primary ring-1 ring-m3-primary/30'
                          : 'bg-m3-surface-container text-m3-on-surface-variant hover:bg-m3-surface-container-high'
                      }`}
                    >
                      <span className={`h-2 w-2 rounded-full ${
                        p === 'online' ? 'bg-green-500' : p === 'unavailable' ? 'bg-amber-500' : 'bg-gray-400'
                      }`} />
                      {p === 'online' ? 'Online' : p === 'unavailable' ? 'Away' : 'Offline'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="border-t border-m3-outline-variant dark:border-m3-outline-variant">
                <button
                  onClick={() => { onProfileClick(); setShowProfilePopover(false) }}
                  className="flex w-full items-center gap-3 px-5 py-3 text-sm text-m3-on-surface transition-colors hover:bg-m3-surface-container first:rounded-t-none last:rounded-b-2xl dark:hover:bg-m3-surface-container-high"
                >
                  <Pencil className="h-4 w-4 text-m3-on-surface-variant" />
                  Edit profile
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Search — toggled by search icon */}
      {showSearch && (
        <div className="sidebar-hide-collapsed px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-m3-on-surface-variant" />
            <input
              type="text"
              placeholder="Search conversations"
              value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setShowSearch(false); setSearchFilter(''); } }}
              autoFocus
              aria-label="Search rooms and messages"
              className="w-full rounded-full bg-m3-surface-container py-2.5 pl-11 pr-11 text-sm text-m3-on-surface placeholder-m3-outline transition-colors duration-150 focus:bg-m3-surface-container-high focus:outline-none focus:ring-1 focus:ring-m3-primary/30 dark:bg-m3-surface-container dark:text-m3-on-surface dark:placeholder-m3-outline dark:focus:bg-m3-surface-container-high"
            />
            {searchFilter && (
              <button
                onClick={() => setSearchFilter('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-m3-on-surface-variant hover:text-m3-on-surface"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}



      {/* Search tabs — when searching */}
      {searchFilter.trim().length >= 1 && (
        <div className="sidebar-hide-collapsed flex gap-0 border-b border-m3-outline-variant px-4">
          <button
            onClick={() => setSearchTab('conversations')}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              searchTab === 'conversations'
                ? 'border-b-2 border-m3-primary text-m3-primary'
                : 'text-m3-on-surface-variant hover:text-m3-on-surface'
            }`}
          >
            Conversations
          </button>
          <button
            onClick={() => setSearchTab('messages')}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              searchTab === 'messages'
                ? 'border-b-2 border-m3-primary text-m3-primary'
                : 'text-m3-on-surface-variant hover:text-m3-on-surface'
            }`}
          >
            Messages {isSearchingMessages && '...'}
          </button>
        </div>
      )}

      {/* Room list */}
      <nav className="flex-1 overflow-y-auto" aria-label="Chat rooms">
        {/* Invitations section */}
        {pendingInvites.length > 0 && (
          <div className="mb-1">
            <button
              onClick={() => setShowInvites(!showInvites)}
              className="flex w-full items-center gap-3 px-5 py-2.5 text-xs font-medium text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
            >
              <Mail className="h-4 w-4" />
              Invitations ({pendingInvites.length})
              <span className="ml-auto text-m3-outline">{showInvites ? '▲' : '▼'}</span>
            </button>
            {inviteError && (
              <p className="px-5 py-1 text-xs text-m3-error">{inviteError}</p>
            )}
            {showInvites && (
              <div>
                {pendingInvites.map(invite => (
                  <div
                    key={invite.roomId}
                    className="flex items-center gap-3 px-4 py-3.5 hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
                  >
                    <Avatar
                      src={invite.avatarUrl}
                      name={invite.name}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-m3-on-surface">
                        {invite.name}
                      </span>
                      <span className="text-xs text-m3-on-surface-variant">Invited</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation()
                          if (processingInviteId) return
                          try {
                            setInviteError(null)
                            setProcessingInviteId(invite.roomId)
                            await acceptInvite(invite.roomId)
                          } catch (err) {
                            setInviteError(`Failed to accept: ${err instanceof Error ? err.message : 'Unknown error'}`)
                          } finally {
                            setProcessingInviteId(null)
                          }
                        }}
                        disabled={processingInviteId === invite.roomId}
                        className="rounded-full p-2 text-green-600 transition-colors hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/30 disabled:opacity-50"
                        title="Accept invitation"
                      >
                        {processingInviteId === invite.roomId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation()
                          if (processingInviteId) return
                          try {
                            setInviteError(null)
                            setProcessingInviteId(invite.roomId)
                            await rejectInvite(invite.roomId)
                          } catch (err) {
                            setInviteError(`Failed to reject: ${err instanceof Error ? err.message : 'Unknown error'}`)
                          } finally {
                            setProcessingInviteId(null)
                          }
                        }}
                        disabled={processingInviteId === invite.roomId}
                        className="rounded-full p-2 text-m3-error transition-colors hover:bg-red-100 dark:text-m3-error dark:hover:bg-red-900/30 disabled:opacity-50"
                        title="Reject invitation"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Show rooms when not searching OR when on "conversations" tab */}
        {(!searchFilter.trim() || searchTab === 'conversations') && (activeRooms.length === 0 && !showArchived && !(searchFilter.trim() && archivedRooms.length > 0)) ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <MessageSquare className="h-12 w-12 text-m3-outline-variant" />
            <p className="mt-4 text-sm text-m3-on-surface-variant">
              {searchFilter ? 'No conversations found' : 'No conversations yet'}
            </p>
            {!searchFilter && (
              <button
                onClick={() => setShowNewChat(true)}
                className="mt-3 text-sm font-medium text-m3-primary transition-colors hover:text-m3-primary/80"
              >
                Start a new chat
              </button>
            )}
          </div>
        ) : (!searchFilter.trim() || searchTab === 'conversations') ? (
          <div>
            {/* Favorites section */}
            {favoriteRooms.length > 0 && (
              <div className="mb-1">
                <div className="sidebar-hide-collapsed flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-m3-on-surface-variant uppercase tracking-wider">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  Favorites
                </div>
                {favoriteRooms.map(room => (
                  <RoomListItem
                    key={room.roomId}
                    room={room}
                    isActive={activeRoom?.roomId === room.roomId}
                    onClick={() => handleSelectRoom(room)}
                    onPrefetch={() => prefetchRoom(room.roomId)}
                    onArchive={(e) => handleArchive(e, room)}
                    onDelete={(e) => handleLeave(e, room)}
                    onMarkAsRead={(e) => handleMarkAsRead(e, room)}
                    avatarUrl={getOtherMemberAvatar(room)}
                    presence={getOtherMemberPresence(room)}
                    isFavorite={true}
                    onToggleFavorite={async (e) => { e.stopPropagation(); await toggleFavorite(room.roomId) }}
                  />
                ))}
              </div>
            )}
            {nonFavoriteRooms.map(room => (
              <RoomListItem
                key={room.roomId}
                room={room}
                isActive={activeRoom?.roomId === room.roomId}
                onClick={() => handleSelectRoom(room)}
                onPrefetch={() => prefetchRoom(room.roomId)}
                onArchive={(e) => handleArchive(e, room)}
                onDelete={(e) => handleLeave(e, room)}
                onMarkAsRead={(e) => handleMarkAsRead(e, room)}
                avatarUrl={getOtherMemberAvatar(room)}
                presence={getOtherMemberPresence(room)}
                isFavorite={false}
                onToggleFavorite={async (e) => { e.stopPropagation(); await toggleFavorite(room.roomId) }}
              />
            ))}
          </div>
        ) : null}

        {/* Archived section — collapsible in chat list */}
        {(!searchFilter.trim() || searchTab === 'conversations') && archivedRooms.length > 0 && (
          <div className="border-t border-m3-outline-variant/50 mt-1">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className="flex w-full items-center gap-2 px-5 py-2.5 text-xs font-medium text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
            >
              <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-200 ${showArchived ? 'rotate-90' : ''}`} />
              <Archive className="h-3.5 w-3.5" />
              Archived ({archivedRooms.length})
            </button>
            {(showArchived || (searchFilter.trim() && archivedRooms.length > 0)) && (
              <div>
                {archivedRooms.map(room => (
                  <RoomListItem
                    key={room.roomId}
                    room={room}
                    isActive={activeRoom?.roomId === room.roomId}
                    onClick={() => handleSelectRoom(room)}
                    onPrefetch={() => prefetchRoom(room.roomId)}
                    onArchive={(e) => handleArchive(e, room)}
                    onDelete={(e) => handleLeave(e, room)}
                    onMarkAsRead={(e) => handleMarkAsRead(e, room)}
                    avatarUrl={getOtherMemberAvatar(room)}
                    presence={getOtherMemberPresence(room)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Message search results — only in messages tab */}
        {searchFilter.trim().length >= 3 && searchTab === 'messages' && (
          <div className="border-t border-m3-outline-variant/50 mt-1">
            <div className="flex items-center gap-3 px-5 py-2.5 text-xs font-medium text-m3-on-surface-variant">
              <MessageSquareDashed className="h-4 w-4" />
              Message Results
              {isSearchingMessages && <Loader2 className="h-3 w-3 animate-spin" />}
            </div>
            {messageResults.length === 0 && !isSearchingMessages ? (
              <p className="px-4 py-3.5 text-xs text-m3-outline">No messages found</p>
            ) : (
              <div>
                {messageResults.map(result => (
                  <button
                    key={result.eventId}
                    onClick={() => {
                      const room = rooms.find(r => r.roomId === result.roomId)
                      if (room) {
                        handleSelectRoom(room)
                      } else {
                        handleSelectRoom({
                          roomId: result.roomId,
                          name: result.roomName,
                          avatarUrl: null,
                          topic: null,
                          isDirect: false,
                          lastMessage: null,
                          lastMessageTs: 0,
                          lastSenderName: null,
                          unreadCount: 0,
                          members: [],
                          encrypted: false,
                          isArchived: false,
                          isBridged: false,
                          powerLevels: {},
                        })
                      }
                    }}
                    className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="truncate text-xs font-medium text-m3-primary">{result.roomName}</span>
                        {result.timestamp > 0 && (
                          <span className="ml-2 flex-shrink-0 text-xs text-m3-on-surface-variant">
                            {formatDistanceToNow(new Date(result.timestamp), { addSuffix: false })}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-m3-on-surface-variant">
                        <span className="text-m3-outline">{result.sender}: </span>
                        <span>{(() => {
                          if (!searchHighlightRegex) return result.body
                          const parts = result.body.split(searchHighlightRegex)
                          return parts.map((part, i) =>
                            i % 2 === 1
                              ? <mark key={i} className="rounded-sm bg-yellow-300/80 text-inherit dark:bg-yellow-500/40">{part}</mark>
                              : part
                          )
                        })()}</span>
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* New Chat Modal — lazy loaded */}
      {showNewChat && (
        <Suspense fallback={null}>
          <NewChatModal
            onClose={() => setShowNewChat(false)}
            onRoomCreated={(roomId) => {
              const room = rooms.find(r => r.roomId === roomId)
              if (room) handleSelectRoom(room)
            }}
          />
        </Suspense>
      )}

      {/* Delete confirmation dialog */}
      {confirmDeleteRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setConfirmDeleteRoom(null)}>
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-m3-surface-container-lowest p-6 shadow-xl dark:bg-m3-surface-container" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-medium text-m3-on-surface dark:text-m3-on-surface">Delete conversation?</h3>
            <p className="mt-2 text-sm text-m3-on-surface-variant dark:text-m3-outline">
              Leave and remove <strong>{confirmDeleteRoom.name}</strong>? This cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setConfirmDeleteRoom(null)}
                className="rounded-full px-4 py-2 text-sm font-medium text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
              >
                Cancel
              </button>
              <button
                onClick={confirmLeave}
                className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

const RoomListItem = memo(function RoomListItem({
  room,
  isActive,
  onClick,
  onPrefetch,
  onArchive,
  onDelete,
  onMarkAsRead,
  avatarUrl,
  presence,
  isFavorite,
  onToggleFavorite,
}: {
  room: MatrixRoom
  isActive: boolean
  onClick: () => void
  onPrefetch: () => void
  onArchive: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
  onMarkAsRead: (e: React.MouseEvent) => void
  avatarUrl: string | null
  presence: 'online' | 'offline' | 'away' | null
  isFavorite?: boolean
  onToggleFavorite?: (e: React.MouseEvent) => void
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const lastMsgPreview = room.lastMessage
    ? room.lastMessage.substring(0, 60) + (room.lastMessage.length > 60 ? '...' : '')
    : 'No messages yet'

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }
  useClickOutside(menuRef, useCallback(() => setContextMenu(null), []), !!contextMenu)

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onPointerEnter={onPrefetch}
        onContextMenu={handleContextMenu}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick() }}
        className={`group relative flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-all duration-150 active:scale-[0.99] ${
          isActive
            ? 'bg-m3-primary-container/40 dark:bg-m3-surface-container-high'
            : 'hover:bg-m3-surface-container active:bg-m3-surface-container-high dark:hover:bg-m3-surface-container-high/60 dark:active:bg-m3-surface-container-highest'
        } ${room.unreadCount > 0 ? 'room-unread-accent' : ''}`}
      >
        <Avatar
          src={avatarUrl}
          name={room.name}
          size="md"
          status={presence}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <span className={`truncate text-[16px] md:text-[15px] ${room.unreadCount > 0 ? 'font-semibold text-m3-on-surface' : 'font-normal text-m3-on-surface'}`}>
              {room.name}
            </span>
            {room.lastMessageTs > 0 && (
              <span className={`ml-2 flex-shrink-0 text-xs ${room.unreadCount > 0 ? 'font-medium text-m3-primary' : 'text-m3-on-surface-variant'}`}>
                {formatDistanceToNow(new Date(room.lastMessageTs), { addSuffix: false })}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between mt-0.5">
            <p className={`truncate text-[14px] md:text-[13px] ${room.unreadCount > 0 ? 'font-medium text-m3-on-surface dark:text-m3-on-surface-variant' : 'text-m3-on-surface-variant'}`}>
              {room.lastSenderName && <span className="text-m3-on-surface-variant">{room.lastSenderName}: </span>}
              {lastMsgPreview}
            </p>
            <div className="ml-2 flex items-center gap-1.5">
              {room.encrypted && (
                <Lock className="h-3 w-3 flex-shrink-0 text-m3-on-surface-variant" />
              )}
              {room.unreadCount > 0 && (
                <span className="flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-m3-primary px-1.5 text-[11px] font-bold text-white">
                  {room.unreadCount > 99 ? '99+' : room.unreadCount}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 w-52 rounded-xl border border-m3-outline-variant bg-m3-surface-container-lowest py-1.5 shadow-xl animate-scale-in dark:border-m3-outline-variant dark:bg-m3-surface-container"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {onToggleFavorite && (
            <button
              onClick={(e) => { onToggleFavorite(e); setContextMenu(null) }}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-m3-on-surface transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
            >
              <Star className={`h-4 w-4 ${isFavorite ? 'fill-amber-400 text-amber-400' : 'text-m3-on-surface-variant'}`} />
              {isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            </button>
          )}
          <button
            onClick={(e) => { onArchive(e); setContextMenu(null) }}
            className="flex w-full items-center px-4 py-2.5 text-sm text-m3-on-surface transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
          >
            {room.isArchived ? 'Unarchive' : 'Archive'}
          </button>
          <button
            onClick={(e) => { onDelete(e); setContextMenu(null) }}
            className="flex w-full items-center px-4 py-2.5 text-sm text-m3-on-surface transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
          >
            Delete
          </button>
          {room.unreadCount > 0 && (
            <button
              onClick={(e) => { onMarkAsRead(e); setContextMenu(null) }}
              className="flex w-full items-center px-4 py-2.5 text-sm text-m3-on-surface transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
            >
              Mark as read
            </button>
          )}
        </div>
      )}
    </>
  )
}, (prevProps, nextProps) => {
  const prevRoom = prevProps.room
  const nextRoom = nextProps.room
  return (
    prevRoom.roomId === nextRoom.roomId &&
    prevRoom.name === nextRoom.name &&
    prevRoom.lastMessage === nextRoom.lastMessage &&
    prevRoom.lastMessageTs === nextRoom.lastMessageTs &&
    prevRoom.lastSenderName === nextRoom.lastSenderName &&
    prevRoom.unreadCount === nextRoom.unreadCount &&
    prevRoom.isDirect === nextRoom.isDirect &&
    prevRoom.encrypted === nextRoom.encrypted &&
    prevRoom.isArchived === nextRoom.isArchived &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.avatarUrl === nextProps.avatarUrl &&
    prevProps.presence === nextProps.presence &&
    prevProps.isFavorite === nextProps.isFavorite
  )
})

'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import {
  ArrowLeft,
  Lock,
  Loader2,
  Shield,
  Users,
  Pencil,
  UserPlus,
  Bell,
  BellOff,
  Check,
  X,
  AtSign,
  Image as ImageIcon,
  FileText,
  LogOut,
  Ban,
  MoreVertical,
} from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { MediaThumbnail } from './media-thumbnail'
import { useAuthStore } from '@/stores/auth-store'
import type { MatrixMessage, MatrixRoom } from '@/stores/chat-store'

interface RoomInfoPanelProps {
  activeRoom: MatrixRoom
  roomDisplayName: string
  headerAvatarUrl: string | null | undefined
  messages: MatrixMessage[]
  onClose: () => void
  onSetRoomName: (roomId: string, name: string) => Promise<void>
  onSetRoomTopic: (roomId: string, topic: string) => Promise<void>
  onInviteMember: (roomId: string, userId: string) => Promise<void>
  onEnableEncryption: (roomId: string) => Promise<void>
  onLeaveRoom: (roomId: string) => Promise<void>
  ignoredUsers: string[]
  onIgnoreUser: (userId: string) => Promise<void>
  onUnignoreUser: (userId: string) => Promise<void>
  notificationSetting: 'all' | 'mentions' | 'mute'
  onSetNotificationSetting: (roomId: string, setting: 'all' | 'mentions' | 'mute') => Promise<void>
  onKickMember: (roomId: string, userId: string, reason?: string) => Promise<void>
  onBanMember: (roomId: string, userId: string, reason?: string) => Promise<void>
  onSetPowerLevel: (roomId: string, userId: string, level: number) => Promise<void>
}

export function RoomInfoPanel({
  activeRoom,
  roomDisplayName,
  headerAvatarUrl,
  messages,
  onClose,
  onSetRoomName,
  onSetRoomTopic,
  onInviteMember,
  onEnableEncryption,
  onLeaveRoom,
  ignoredUsers,
  onIgnoreUser,
  onUnignoreUser,
  notificationSetting,
  onSetNotificationSetting,
  onKickMember,
  onBanMember,
  onSetPowerLevel,
}: RoomInfoPanelProps) {
  const currentUserId = useAuthStore(s => s.user?.userId)
  const [editingName, setEditingName] = useState(false)
  const [editingTopic, setEditingTopic] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [topicInput, setTopicInput] = useState('')
  const [inviteInput, setInviteInput] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [savingTopic, setSavingTopic] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [memberMenu, setMemberMenu] = useState<string | null>(null)
  const menuContainerRef = useRef<HTMLDivElement>(null)

  // Close member menu on outside click
  useEffect(() => {
    if (!memberMenu) return
    const handler = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setMemberMenu(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [memberMenu])

  const myPowerLevel = activeRoom.powerLevels[currentUserId || ''] ?? 0
  const defaultPowerLevel = 0

  // Filter out Signal bridge bot and puppet users from the member list
  const isSignalBridgeUser = (userId: string) => /^@signal(bot)?:/.test(userId) && userId.endsWith(":lukasz.com")
  const filteredMembers = useMemo(() =>
    activeRoom.members.filter(m => !isSignalBridgeUser(m.userId)),
    [activeRoom.members]
  )

  const mediaMessages = useMemo(() =>
    messages.filter(m => m.mediaUrl && (m.type === 'm.image' || m.type === 'm.video'))
      .slice(-30)
      .reverse(),
    [messages]
  )

  const fileMessages = useMemo(() =>
    messages.filter(m => m.mediaUrl && m.type === 'm.file')
      .slice(-10)
      .reverse(),
    [messages]
  )

  const getPowerLevel = (userId: string) => activeRoom.powerLevels[userId] ?? defaultPowerLevel
  const getRoleBadge = (userId: string) => {
    const pl = getPowerLevel(userId)
    if (pl >= 100) return 'Admin'
    if (pl >= 50) return 'Mod'
    return null
  }

  const handleInvite = async () => {
    const matrixIdRegex = /^@[a-zA-Z0-9._=\-/+]+:[a-zA-Z0-9.-]+$/
    if (!matrixIdRegex.test(inviteInput.trim())) { setInviteError('Invalid Matrix user ID format'); return }
    setInviting(true); setInviteError('')
    try { await onInviteMember(activeRoom.roomId, inviteInput.trim()); setInviteInput('') }
    catch (err) { setInviteError(err instanceof Error ? err.message : 'Failed to invite') }
    setInviting(false)
  }

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-m3-surface-container-lowest dark:bg-m3-surface">
      {/* Header with back arrow */}
      <div className="flex items-center gap-3 border-b border-m3-outline-variant bg-m3-surface-container-lowest px-2 py-2 dark:border-m3-outline-variant dark:bg-m3-surface-container md:px-4">
        <button
          onClick={onClose}
          className="rounded-full p-2 text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h3 className="text-base font-medium text-m3-on-surface dark:text-m3-on-surface">Details</h3>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Avatar + name hero section */}
        <div className="flex flex-col items-center px-6 py-8">
          <Avatar
            src={headerAvatarUrl}
            name={roomDisplayName}
            size="xl"
          />
          <div className="mt-4 w-full text-center">
            {editingName ? (
              <div className="mx-auto flex max-w-xs items-center gap-2">
                <input
                  type="text"
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  autoFocus
                  className="flex-1 border-b-2 border-m3-primary bg-transparent px-1 py-1.5 text-center text-lg font-medium text-m3-on-surface focus:outline-none dark:text-m3-on-surface"
                  onKeyDown={async e => {
                    if (e.key === 'Enter' && nameInput.trim()) {
                      setSavingName(true)
                      try { await onSetRoomName(activeRoom.roomId, nameInput.trim()) } catch {}
                      setSavingName(false); setEditingName(false)
                    } else if (e.key === 'Escape') setEditingName(false)
                  }}
                />
                <button
                  onClick={async () => {
                    if (!nameInput.trim()) return
                    setSavingName(true)
                    try { await onSetRoomName(activeRoom.roomId, nameInput.trim()) } catch {}
                    setSavingName(false); setEditingName(false)
                  }}
                  disabled={savingName}
                  className="rounded-full p-1.5 text-m3-primary transition-colors hover:bg-m3-primary-container"
                >
                  {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                </button>
                <button onClick={() => setEditingName(false)} className="rounded-full p-1.5 text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2">
                <h4 className="text-xl font-medium text-m3-on-surface dark:text-m3-on-surface">{roomDisplayName}</h4>
                {!activeRoom.isDirect && (
                  <button
                    onClick={() => { setNameInput(activeRoom.name); setEditingName(true) }}
                    className="rounded-full p-1.5 text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}

            {editingTopic ? (
              <div className="mx-auto mt-2 flex max-w-xs items-center gap-2">
                <input
                  type="text"
                  value={topicInput}
                  onChange={e => setTopicInput(e.target.value)}
                  placeholder="Set a topic..."
                  autoFocus
                  className="flex-1 border-b border-m3-primary bg-transparent px-1 py-1 text-center text-sm text-m3-on-surface focus:outline-none dark:text-m3-on-surface"
                  onKeyDown={async e => {
                    if (e.key === 'Enter') {
                      setSavingTopic(true)
                      try { await onSetRoomTopic(activeRoom.roomId, topicInput.trim()) } catch {}
                      setSavingTopic(false); setEditingTopic(false)
                    } else if (e.key === 'Escape') setEditingTopic(false)
                  }}
                />
                <button
                  onClick={async () => {
                    setSavingTopic(true)
                    try { await onSetRoomTopic(activeRoom.roomId, topicInput.trim()) } catch {}
                    setSavingTopic(false); setEditingTopic(false)
                  }}
                  disabled={savingTopic}
                  className="rounded-full p-1 text-m3-primary transition-colors hover:bg-m3-primary-container"
                >
                  {savingTopic ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                </button>
                <button onClick={() => setEditingTopic(false)} className="rounded-full p-1 text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="mt-1 flex items-center justify-center gap-1">
                {activeRoom.topic ? (
                  <p className="text-sm text-m3-on-surface-variant dark:text-m3-outline">{activeRoom.topic}</p>
                ) : !activeRoom.isDirect ? (
                  <p className="text-sm italic text-m3-outline dark:text-m3-on-surface-variant">No topic set</p>
                ) : null}
                {!activeRoom.isDirect && (
                  <button
                    onClick={() => { setTopicInput(activeRoom.topic || ''); setEditingTopic(true) }}
                    className="rounded-full p-1 text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Action buttons row */}
        <div className="flex justify-center gap-6 border-b border-m3-outline-variant px-6 py-5 dark:border-m3-outline-variant">
          {activeRoom.encrypted ? (
            <div className="flex flex-col items-center gap-1">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50 dark:bg-green-900/20">
                <Shield className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <span className="text-xs text-green-600 dark:text-green-400">Encrypted</span>
            </div>
          ) : (
            <button
              onClick={async () => { try { await onEnableEncryption(activeRoom.roomId) } catch {} }}
              className="flex flex-col items-center gap-1"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-m3-surface-container transition-colors hover:bg-m3-surface-container-high dark:bg-m3-surface-container-high dark:hover:bg-m3-surface-container-highest">
                <Lock className="h-5 w-5 text-m3-on-surface-variant" />
              </div>
              <span className="text-xs text-m3-on-surface-variant">Encrypt</span>
            </button>
          )}
          <div className="flex flex-col items-center gap-1">
            <button
              onClick={() => onSetNotificationSetting(activeRoom.roomId, notificationSetting === 'mute' ? 'all' : 'mute')}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-m3-surface-container transition-colors hover:bg-m3-surface-container-high dark:bg-m3-surface-container-high dark:hover:bg-m3-surface-container-highest"
            >
              {notificationSetting === 'mute' ? <BellOff className="h-5 w-5 text-m3-error" /> : <Bell className="h-5 w-5 text-m3-on-surface-variant" />}
            </button>
            <span className="text-xs text-m3-on-surface-variant">{notificationSetting === 'mute' ? 'Muted' : 'Notifications'}</span>
          </div>
        </div>

        {/* List-style sections */}
        <div className="divide-y divide-m3-outline-variant dark:divide-m3-outline-variant">
          {/* Room ID */}
          <button
            onClick={() => { navigator.clipboard.writeText(activeRoom.roomId).catch(() => {}) }}
            className="flex w-full items-start gap-4 px-6 py-4 text-left transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
          >
            <AtSign className="mt-0.5 h-5 w-5 flex-shrink-0 text-m3-on-surface-variant dark:text-m3-outline" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-m3-on-surface dark:text-m3-on-surface break-all font-mono">{activeRoom.roomId}</p>
              <p className="mt-0.5 text-xs text-m3-on-surface-variant dark:text-m3-outline">Tap to copy</p>
            </div>
          </button>

          {/* Notification settings */}
          <div className="px-6 py-4">
            <div className="flex items-center gap-4">
              <Bell className="h-5 w-5 flex-shrink-0 text-m3-on-surface-variant dark:text-m3-outline" />
              <p className="text-sm text-m3-on-surface dark:text-m3-on-surface">Notifications</p>
            </div>
            <div className="mt-3 ml-9 flex gap-2">
              {(['all', 'mentions', 'mute'] as const).map(setting => (
                <button
                  key={setting}
                  onClick={() => onSetNotificationSetting(activeRoom.roomId, setting)}
                  className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
                    notificationSetting === setting
                      ? setting === 'mute'
                        ? 'bg-m3-error-container text-m3-error dark:bg-m3-error-container/30'
                        : 'bg-m3-primary-container text-m3-on-primary-container dark:bg-m3-primary-container/30 dark:text-m3-primary'
                      : 'bg-m3-surface-container text-m3-on-surface-variant hover:bg-m3-surface-container-high dark:bg-m3-surface-container-high dark:text-m3-outline dark:hover:bg-m3-surface-container-highest'
                  }`}
                >
                  {setting === 'mute' ? 'Mute' : setting.charAt(0).toUpperCase() + setting.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Invite Member */}
          <div className="px-6 py-4">
            <div className="flex items-center gap-4">
              <UserPlus className="h-5 w-5 flex-shrink-0 text-m3-on-surface-variant dark:text-m3-outline" />
              <p className="text-sm text-m3-on-surface dark:text-m3-on-surface">Invite member</p>
            </div>
            <div className="mt-3 ml-9 flex gap-2">
              <input
                type="text"
                value={inviteInput}
                onChange={e => { setInviteInput(e.target.value); setInviteError('') }}
                placeholder="@user:server.com"
                className="flex-1 border-b border-m3-outline-variant bg-transparent py-1.5 text-sm text-m3-on-surface placeholder-m3-outline focus:border-m3-primary focus:outline-none dark:border-m3-outline dark:text-m3-on-surface dark:placeholder-m3-outline"
                onKeyDown={async e => {
                  if (e.key === 'Enter') await handleInvite()
                }}
              />
              <button
                onClick={handleInvite}
                disabled={inviting || !inviteInput.trim()}
                className="rounded-full bg-m3-primary p-2 text-white transition-colors hover:bg-m3-primary/90 disabled:opacity-50"
              >
                {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              </button>
            </div>
            {inviteError && <p className="ml-9 mt-1.5 text-xs text-m3-error">{inviteError}</p>}
          </div>

          {/* Members */}
          <div className="px-6 py-4">
            <div className="flex items-center gap-4 mb-3">
              <Users className="h-5 w-5 flex-shrink-0 text-m3-on-surface-variant dark:text-m3-outline" />
              <p className="text-sm font-medium text-m3-on-surface dark:text-m3-on-surface">
                Members ({filteredMembers.length})
              </p>
            </div>
            <div className="space-y-1">
              {filteredMembers.map(member => {
                const isIgnored = ignoredUsers.includes(member.userId)
                const isSelf = member.userId === currentUserId
                const roleBadge = getRoleBadge(member.userId)
                const canModerate = !isSelf && myPowerLevel > getPowerLevel(member.userId)
                const showMenu = memberMenu === member.userId
                return (
                  <div key={member.userId} className="relative flex items-center gap-3 rounded-full px-3 py-2 transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high">
                    <Avatar
                      src={member.avatarUrl}
                      name={member.displayName}
                      size="sm"
                      status={member.presence === 'online' ? 'online' : member.presence === 'unavailable' ? 'away' : null}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm text-m3-on-surface dark:text-m3-on-surface">{member.displayName}</p>
                        {roleBadge && (
                          <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            roleBadge === 'Admin'
                              ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                              : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                          }`}>
                            {roleBadge}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-m3-on-surface-variant dark:text-m3-outline">{member.userId}</p>
                    </div>
                    {!isSelf && (
                      <div className="relative flex-shrink-0" ref={showMenu ? menuContainerRef : undefined}>
                        <button
                          onClick={() => setMemberMenu(showMenu ? null : member.userId)}
                          className="rounded-full p-1.5 text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container-high dark:hover:bg-m3-surface-container-highest"
                          title="Member actions"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                        {showMenu && (
                          <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-xl border border-m3-outline-variant bg-m3-surface-container-lowest py-1 shadow-xl animate-scale-in dark:border-m3-outline-variant dark:bg-m3-surface-container">
                            <button
                              onClick={async () => { isIgnored ? await onUnignoreUser(member.userId) : await onIgnoreUser(member.userId); setMemberMenu(null) }}
                              className="flex w-full items-center gap-3 px-4 py-2 text-sm text-m3-on-surface transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
                            >
                              <Ban className="h-4 w-4" />
                              {isIgnored ? 'Unblock' : 'Block'}
                            </button>
                            {canModerate && myPowerLevel >= 100 && getPowerLevel(member.userId) < 100 && (
                              <button
                                onClick={async () => { await onSetPowerLevel(activeRoom.roomId, member.userId, 100); setMemberMenu(null) }}
                                className="flex w-full items-center gap-3 px-4 py-2 text-sm text-m3-on-surface transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
                              >
                                <Shield className="h-4 w-4" />
                                Make Admin
                              </button>
                            )}
                            {canModerate && myPowerLevel >= 50 && getPowerLevel(member.userId) < 50 && (
                              <button
                                onClick={async () => { await onSetPowerLevel(activeRoom.roomId, member.userId, 50); setMemberMenu(null) }}
                                className="flex w-full items-center gap-3 px-4 py-2 text-sm text-m3-on-surface transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
                              >
                                <Shield className="h-4 w-4" />
                                Make Moderator
                              </button>
                            )}
                            {canModerate && getPowerLevel(member.userId) > 0 && (
                              <button
                                onClick={async () => { await onSetPowerLevel(activeRoom.roomId, member.userId, 0); setMemberMenu(null) }}
                                className="flex w-full items-center gap-3 px-4 py-2 text-sm text-m3-on-surface transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
                              >
                                <X className="h-4 w-4" />
                                Remove role
                              </button>
                            )}
                            {canModerate && myPowerLevel >= 50 && (
                              <>
                                <div className="my-1 border-t border-m3-outline-variant dark:border-m3-outline-variant" />
                                <button
                                  onClick={async () => { if (confirm(`Remove ${member.displayName} from this room?`)) { await onKickMember(activeRoom.roomId, member.userId); setMemberMenu(null) } }}
                                  className="flex w-full items-center gap-3 px-4 py-2 text-sm text-m3-error transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
                                >
                                  <LogOut className="h-4 w-4" />
                                  Remove from room
                                </button>
                                <button
                                  onClick={async () => { if (confirm(`Ban ${member.displayName} from this room?`)) { await onBanMember(activeRoom.roomId, member.userId); setMemberMenu(null) } }}
                                  className="flex w-full items-center gap-3 px-4 py-2 text-sm text-m3-error transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
                                >
                                  <Ban className="h-4 w-4" />
                                  Ban from room
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Media Gallery */}
          <div className="px-6 py-4">
            <div className="flex items-center gap-4 mb-3">
              <ImageIcon className="h-5 w-5 flex-shrink-0 text-m3-on-surface-variant dark:text-m3-outline" />
              <p className="text-sm font-medium text-m3-on-surface dark:text-m3-on-surface">Shared media</p>
            </div>
            <div className="grid grid-cols-5 gap-0.5 overflow-hidden rounded-xl">
              {mediaMessages.map(m => (
                  <div key={m.eventId} className="aspect-square overflow-hidden bg-m3-surface-container dark:bg-m3-surface-container-high">
                    <MediaThumbnail message={m} />
                  </div>
                ))}
              {mediaMessages.length === 0 && (
                <p className="col-span-5 py-6 text-center text-sm text-m3-outline dark:text-m3-on-surface-variant">No shared media yet</p>
              )}
            </div>

            {fileMessages.length > 0 && (
              <div className="mt-4 space-y-1">
                <p className="mb-2 text-xs font-medium text-m3-on-surface-variant dark:text-m3-outline">Files</p>
                {fileMessages.map(m => (
                    <a key={m.eventId} href={m.mediaUrl!} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
                    >
                      <FileText className="h-4 w-4 flex-shrink-0 text-m3-outline" />
                      <span className="truncate text-m3-on-surface dark:text-m3-on-surface-variant">{m.content}</span>
                    </a>
                  ))}
              </div>
            )}
          </div>

          {/* Leave Room */}
          <div className="px-6 py-4">
            <button
              onClick={async () => {
                if (!confirm(`Leave ${activeRoom.isDirect ? 'this conversation' : activeRoom.name}?`)) return
                try { await onLeaveRoom(activeRoom.roomId); onClose() }
                catch (err) { console.error('Failed to leave room:', err) }
              }}
              className="flex w-full items-center gap-4 rounded-full px-3 py-3 text-sm text-m3-error transition-colors hover:bg-m3-error-container dark:text-m3-error dark:hover:bg-red-900/20"
            >
              <LogOut className="h-5 w-5" />
              {activeRoom.isDirect ? 'Leave Conversation' : 'Leave Room'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useAuthStore } from '@/stores/auth-store'
import { Avatar } from '@/components/ui/avatar'
import { useRouter } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import { getHomeserverUrl, getHomeserverDomain, restoreFromRecoveryKey, deleteOtherDevice, deleteAllOtherDevices, getMatrixClient, generateSecurityKey, getEncryptionStatus } from '@/lib/matrix/client'
import {
  LogOut,
  User,
  Shield,
  Loader2,
  Server,
  Key,
  CheckCircle,
  Pencil,
  Camera,
  Monitor,
  ShieldPlus,
  Copy,
  Check,
  Info,
  Wifi,
  WifiOff,
  RefreshCw,
  Clock,
  Lock,
  ArrowLeft,
  ChevronRight,
} from 'lucide-react'

interface SettingsPanelProps {
  onClose: () => void
  initialSection?: 'main' | 'profile' | 'security' | 'about'
}

export function SettingsPanel({ onClose, initialSection = 'main' }: SettingsPanelProps) {
  const { user, signOut, updateProfile } = useAuthStore()
  const router = useRouter()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [activeSection, setActiveSection] = useState<'main' | 'profile' | 'security' | 'about'>(initialSection)
  const [recoveryKey, setRecoveryKey] = useState('')
  const [isRestoring, setIsRestoring] = useState(false)
  const [restoreResult, setRestoreResult] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [isEditingName, setIsEditingName] = useState(false)
  const [newDisplayName, setNewDisplayName] = useState(user?.displayName || '')
  const [isSavingName, setIsSavingName] = useState(false)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [devices, setDevices] = useState<{deviceId: string, displayName: string | null, lastSeenIp: string | null, lastSeenTs: number}[]>([])
  const [loadingDevices, setLoadingDevices] = useState(false)
  const [deletingDevice, setDeletingDevice] = useState<string | null>(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [showSignOutAll, setShowSignOutAll] = useState(false)
  const [signOutAllPassword, setSignOutAllPassword] = useState('')
  const [signingOutAll, setSigningOutAll] = useState(false)
  const [signOutAllError, setSignOutAllError] = useState<string | null>(null)
  const [isGeneratingKey, setIsGeneratingKey] = useState(false)
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const [generateKeyPassword, setGenerateKeyPassword] = useState('')
  const [generateKeyError, setGenerateKeyError] = useState<string | null>(null)
  const [keyCopied, setKeyCopied] = useState(false)
  const [showAccessToken, setShowAccessToken] = useState(false)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [serverLatency, setServerLatency] = useState<number | null>(null)
  const [serverStatus, setServerStatus] = useState<'connected' | 'error' | 'checking'>('checking')
  const [clientVersions, setClientVersions] = useState<string[]>([])
  const [encryptionStatus, setEncryptionStatus] = useState<{ crossSigningReady: boolean; thisDeviceVerified: boolean; keyBackupEnabled: boolean; keyBackupTrusted: boolean } | null>(null)
  const [loadingEncryption, setLoadingEncryption] = useState(false)

  const handleDeleteDevice = async (deviceId: string) => {
    if (!deletePassword.trim()) {
      setDeviceError('Password is required to sign out a session')
      return
    }
    setDeletingDevice(deviceId)
    setDeviceError(null)
    try {
      await deleteOtherDevice(deviceId, deletePassword)
      setShowDeleteConfirm(null)
      setDeletePassword('')
      await loadDevices()
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : 'Failed to sign out session')
    } finally {
      setDeletingDevice(null)
    }
  }

  const handleSignOutAllOther = async () => {
    if (!signOutAllPassword.trim()) {
      setSignOutAllError('Password is required')
      return
    }
    setSigningOutAll(true)
    setSignOutAllError(null)
    try {
      await deleteAllOtherDevices(signOutAllPassword)
      setShowSignOutAll(false)
      setSignOutAllPassword('')
      await loadDevices()
    } catch (err) {
      setSignOutAllError(err instanceof Error ? err.message : 'Failed to sign out other sessions')
    } finally {
      setSigningOutAll(false)
    }
  }

  const loadDevices = async () => {
    const client = getMatrixClient()
    if (!client) return
    setLoadingDevices(true)
    try {
      const response = await client.getDevices()
      setDevices((response.devices || []).map((d: any) => ({
        deviceId: d.device_id,
        displayName: d.display_name || null,
        lastSeenIp: d.last_seen_ip || null,
        lastSeenTs: d.last_seen_ts || 0,
      })))
    } catch (err) {
      console.error('Failed to load devices:', err)
    } finally {
      setLoadingDevices(false)
    }
  }

  const checkServerStatus = async () => {
    setServerStatus('checking')
    try {
      const hsUrl = getHomeserverUrl()
      if (!hsUrl) { setServerStatus('error'); return }
      const start = performance.now()
      const res = await fetch(`${hsUrl}/_matrix/client/versions`)
      const latency = Math.round(performance.now() - start)
      setServerLatency(latency)
      if (res.ok) {
        const data = await res.json()
        setClientVersions(data.versions || [])
        setServerStatus('connected')
      } else {
        setServerStatus('error')
      }
    } catch {
      setServerStatus('error')
      setServerLatency(null)
    }
  }

  const loadEncryptionStatus = async () => {
    setLoadingEncryption(true)
    try {
      const status = await getEncryptionStatus()
      setEncryptionStatus(status)
    } catch { /* ignore */ }
    finally { setLoadingEncryption(false) }
  }

  useEffect(() => {
    if (activeSection === 'security') { loadDevices(); loadEncryptionStatus() }
    if (activeSection === 'about') checkServerStatus()
  }, [activeSection])

  const handleSaveDisplayName = async () => {
    if (!newDisplayName.trim() || newDisplayName.trim() === user?.displayName) {
      setIsEditingName(false)
      return
    }
    setIsSavingName(true)
    setProfileError(null)
    try {
      const client = getMatrixClient()
      if (!client) throw new Error('Not connected')
      await client.setDisplayName(newDisplayName.trim())
      updateProfile({ displayName: newDisplayName.trim() })
      setIsEditingName(false)
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Failed to update display name')
    } finally {
      setIsSavingName(false)
    }
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsUploadingAvatar(true)
    setProfileError(null)
    try {
      const client = getMatrixClient()
      if (!client) throw new Error('Not connected')
      const uploadResponse = await client.uploadContent(file, { name: file.name, type: file.type })
      const mxcUrl = uploadResponse.content_uri
      await client.setAvatarUrl(mxcUrl)
      const httpUrl = client.mxcUrlToHttp(mxcUrl) || undefined
      updateProfile({ avatarUrl: httpUrl })
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Failed to upload avatar')
    } finally {
      setIsUploadingAvatar(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ''
    }
  }

  const handleSignOut = async () => {
    setIsLoggingOut(true)
    try {
      await signOut()
    } catch (err) {
      console.error('Sign out failed:', err)
    } finally {
      router.push('/login')
    }
  }

  const homeserverDomain = getHomeserverDomain() || 'unknown'
  const client = getMatrixClient()
  const currentDeviceId = client?.getDeviceId() || 'unknown'

  const goBack = () => {
    if (activeSection === 'main') onClose()
    else setActiveSection('main')
  }

  const sectionTitle = activeSection === 'main' ? 'Settings' : activeSection === 'profile' ? 'Profile' : activeSection === 'security' ? 'Security' : 'About'

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-m3-surface-container-lowest dark:bg-m3-surface animate-fade-in safe-area-pad">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-m3-outline-variant bg-m3-surface-container-lowest px-2 py-2 dark:border-m3-outline-variant dark:bg-m3-surface-container md:px-4">
        <button
          onClick={goBack}
          className="rounded-full p-2 text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h2 className="text-base font-medium text-m3-on-surface dark:text-m3-on-surface">{sectionTitle}</h2>
      </div>

      {/* Content — desktop sidebar navigation + content */}
      <div className="flex flex-1 min-h-0">
        {/* Desktop settings sidebar */}
        <div className="hidden md:flex flex-col w-60 flex-shrink-0 border-r border-m3-outline-variant dark:border-m3-outline-variant bg-m3-surface-container-lowest dark:bg-m3-surface overflow-y-auto">
          <div className="py-2">
            {[
              { id: 'profile' as const, label: 'Account', icon: User },
              { id: 'security' as const, label: 'Security & Devices', icon: Shield },
              { id: 'about' as const, label: 'About', icon: Info },
            ].map(item => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-sm transition-colors ${
                  activeSection === item.id
                    ? 'bg-m3-primary/10 text-m3-primary font-medium'
                    : 'text-m3-on-surface-variant hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high'
                }`}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-auto p-4 border-t border-m3-outline-variant dark:border-m3-outline-variant">
            <button
              onClick={handleSignOut}
              disabled={isLoggingOut}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-m3-error-container px-4 py-2 text-sm font-medium text-m3-on-error-container transition-colors hover:bg-m3-error/20 disabled:opacity-50"
            >
              {isLoggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              Sign out
            </button>
          </div>
        </div>
        {/* Settings content area */}
        <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-lg">

          {/* ===== MAIN MENU ===== */}
          {activeSection === 'main' && (
            <div>
              {/* User card at top */}
              <div className="flex items-center gap-4 px-6 py-5 border-b border-m3-outline-variant dark:border-m3-outline-variant">
                <Avatar src={user?.avatarUrl} name={user?.displayName || 'U'} size="xl" />
                <div className="min-w-0 flex-1">
                  <p className="text-base font-medium text-m3-on-surface dark:text-m3-on-surface">{user?.displayName}</p>
                  <p className="text-sm text-m3-on-surface-variant dark:text-m3-outline">{user?.userId}</p>
                  <p className="text-xs text-m3-on-surface-variant dark:text-m3-outline mt-0.5">{homeserverDomain}</p>
                </div>
              </div>

              {/* Navigation items */}
              <div className="divide-y divide-m3-outline-variant dark:divide-m3-outline-variant">
                <button onClick={() => setActiveSection('security')} className="flex w-full items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high">
                  <Shield className="h-5 w-5 text-m3-on-surface-variant dark:text-m3-outline" />
                  <div className="flex-1">
                    <p className="text-sm text-m3-on-surface dark:text-m3-on-surface">Security</p>
                    <p className="text-xs text-m3-on-surface-variant dark:text-m3-outline">Keys, sessions, encryption</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-m3-outline" />
                </button>

                <button onClick={() => setActiveSection('about')} className="flex w-full items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high">
                  <Info className="h-5 w-5 text-m3-on-surface-variant dark:text-m3-outline" />
                  <div className="flex-1">
                    <p className="text-sm text-m3-on-surface dark:text-m3-on-surface">About</p>
                    <p className="text-xs text-m3-on-surface-variant dark:text-m3-outline">Server, protocol, version</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-m3-outline" />
                </button>

                <button
                  onClick={handleSignOut}
                  disabled={isLoggingOut}
                  className="flex w-full items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-m3-error-container dark:hover:bg-red-900/20"
                >
                  {isLoggingOut ? <Loader2 className="h-5 w-5 animate-spin text-m3-error" /> : <LogOut className="h-5 w-5 text-m3-error" />}
                  <p className="text-sm text-m3-error">Sign out</p>
                </button>
              </div>


            </div>
          )}

          {/* ===== PROFILE ===== */}
          {activeSection === 'profile' && (
            <div>
              {/* Avatar hero */}
              <div className="flex flex-col items-center px-6 py-8 border-b border-m3-outline-variant dark:border-m3-outline-variant">
                <div className="relative">
                  <Avatar src={user?.avatarUrl} name={user?.displayName || 'U'} size="xl" />
                  <button
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={isUploadingAvatar}
                    className="absolute -bottom-1 -right-1 rounded-full border-2 border-white bg-m3-primary p-1.5 text-white transition-colors hover:bg-m3-primary/90 dark:border-m3-surface"
                  >
                    {isUploadingAvatar ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                  </button>
                  <input ref={avatarInputRef} type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                </div>

                {isEditingName ? (
                  <div className="mt-4 flex items-center gap-2">
                    <input
                      type="text"
                      value={newDisplayName}
                      onChange={e => setNewDisplayName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleSaveDisplayName(); if (e.key === 'Escape') setIsEditingName(false) }}
                      autoFocus
                      className="border-b-2 border-m3-primary bg-transparent px-1 py-1 text-center text-lg font-medium text-m3-on-surface focus:outline-none dark:text-m3-on-surface"
                    />
                    <button onClick={handleSaveDisplayName} disabled={isSavingName} className="rounded-full p-1.5 text-m3-primary hover:bg-m3-primary-container">
                      {isSavingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => { setNewDisplayName(user?.displayName || ''); setIsEditingName(true) }} className="mt-4 flex items-center gap-2 rounded-full px-3 py-1 transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high">
                    <span className="text-xl font-medium text-m3-on-surface dark:text-m3-on-surface">{user?.displayName}</span>
                    <Pencil className="h-3.5 w-3.5 text-m3-on-surface-variant" />
                  </button>
                )}
                <p className="mt-1 text-sm text-m3-on-surface-variant dark:text-m3-outline">{user?.userId}</p>
              </div>

              {profileError && (
                <div className="mx-6 mt-4 rounded-lg bg-m3-error-container px-4 py-3 text-sm text-m3-error dark:bg-m3-error-container/20">{profileError}</div>
              )}

              {/* Info rows */}
              <div className="divide-y divide-m3-outline-variant dark:divide-m3-outline-variant">
                <div className="flex items-center gap-4 px-6 py-4">
                  <Server className="h-5 w-5 text-m3-on-surface-variant dark:text-m3-outline" />
                  <div>
                    <p className="text-sm text-m3-on-surface dark:text-m3-on-surface">Homeserver</p>
                    <p className="text-xs text-m3-on-surface-variant dark:text-m3-outline">{homeserverDomain}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ===== SECURITY ===== */}
          {activeSection === 'security' && (
            <div className="divide-y divide-m3-outline-variant dark:divide-m3-outline-variant">
              {/* Encryption Health */}
              <div className="px-6 py-5">
                <div className="flex items-center gap-3 mb-4">
                  <Lock className="h-5 w-5 text-m3-on-surface-variant dark:text-m3-outline" />
                  <p className="text-sm font-medium text-m3-on-surface dark:text-m3-on-surface">Encryption Status</p>
                  {loadingEncryption && <Loader2 className="h-3.5 w-3.5 animate-spin text-m3-outline" />}
                </div>
                {encryptionStatus && (
                  <div className="ml-8 space-y-2">
                    <StatusRow label="Cross-signing" ok={encryptionStatus.crossSigningReady} />
                    <StatusRow label="Device verified" ok={encryptionStatus.thisDeviceVerified} />
                    <StatusRow label="Key backup" ok={encryptionStatus.keyBackupEnabled} />
                    <StatusRow label="Backup trusted" ok={encryptionStatus.keyBackupTrusted} />
                    {(!encryptionStatus.crossSigningReady || !encryptionStatus.thisDeviceVerified || !encryptionStatus.keyBackupTrusted) && (
                      <p className="text-xs text-m3-error mt-3">
                        Encryption is not fully set up. Generate a security key below to fix this.
                      </p>
                    )}
                    {encryptionStatus.crossSigningReady && encryptionStatus.thisDeviceVerified && encryptionStatus.keyBackupTrusted && (
                      <p className="text-xs text-green-600 dark:text-green-400 mt-3">
                        Encryption is healthy. New messages will be decryptable.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Security Key */}
              <div className="px-6 py-5">
                <div className="flex items-center gap-3 mb-4">
                  <ShieldPlus className="h-5 w-5 text-m3-on-surface-variant dark:text-m3-outline" />
                  <p className="text-sm font-medium text-m3-on-surface dark:text-m3-on-surface">Security Key</p>
                </div>
                {generatedKey ? (
                  <div className="space-y-3 ml-8">
                    <p className="text-xs text-green-600 dark:text-green-400 font-medium">
                      Cross-signing and key backup are set up. Save this security key.
                    </p>
                    <div className="relative rounded-lg bg-m3-surface-container p-3 font-mono text-xs text-m3-on-surface break-all dark:bg-m3-surface-container-high">
                      {generatedKey}
                      <button
                        onClick={() => { navigator.clipboard.writeText(generatedKey); setKeyCopied(true); setTimeout(() => setKeyCopied(false), 2000) }}
                        className="absolute top-2 right-2 rounded-full p-1.5 text-m3-on-surface-variant hover:bg-m3-surface-container-high dark:hover:bg-m3-surface-container-highest"
                      >
                        {keyCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <p className="text-[10px] text-m3-error">Store this key securely. If you lose it, you won't be able to decrypt message history on new devices.</p>
                  </div>
                ) : (
                  <div className="space-y-3 ml-8">
                    <p className="text-xs text-m3-on-surface-variant dark:text-m3-outline">
                      Set up cross-signing and key backup. This generates a security key for verifying other sessions.
                    </p>
                    <input
                      type="password"
                      value={generateKeyPassword}
                      onChange={e => { setGenerateKeyPassword(e.target.value); setGenerateKeyError(null) }}
                      placeholder="Account password"
                      className="w-full border-b border-m3-outline-variant bg-transparent py-2 text-sm text-m3-on-surface placeholder-m3-outline focus:border-m3-primary focus:outline-none dark:text-m3-on-surface dark:placeholder-m3-outline"
                    />
                    {generateKeyError && <p className="text-xs text-m3-error">{generateKeyError}</p>}
                    <button
                      onClick={async () => {
                        if (!generateKeyPassword.trim()) { setGenerateKeyError('Password is required'); return }
                        setIsGeneratingKey(true); setGenerateKeyError(null)
                        try { const key = await generateSecurityKey(generateKeyPassword); setGeneratedKey(key); setGenerateKeyPassword(''); loadEncryptionStatus() }
                        catch (err) { setGenerateKeyError(err instanceof Error ? err.message : 'Failed to generate security key') }
                        finally { setIsGeneratingKey(false) }
                      }}
                      disabled={isGeneratingKey || !generateKeyPassword.trim()}
                      className="flex w-full items-center justify-center gap-2 rounded-full bg-m3-primary py-2.5 text-xs font-medium text-white transition-colors hover:bg-m3-primary/90 disabled:opacity-50"
                    >
                      {isGeneratingKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldPlus className="h-3.5 w-3.5" />}
                      {isGeneratingKey ? 'Setting up...' : 'Generate Security Key'}
                    </button>
                  </div>
                )}
              </div>

              {/* Recovery Key Restore */}
              <div className="px-6 py-5">
                <div className="flex items-center gap-3 mb-4">
                  <Key className="h-5 w-5 text-m3-on-surface-variant dark:text-m3-outline" />
                  <p className="text-sm font-medium text-m3-on-surface dark:text-m3-on-surface">Key Backup Recovery</p>
                </div>
                <div className="ml-8 space-y-3">
                  <p className="text-xs text-m3-on-surface-variant dark:text-m3-outline">
                    Enter your security key or passphrase to decrypt older messages.
                  </p>
                  <textarea
                    value={recoveryKey}
                    onChange={e => { setRecoveryKey(e.target.value); setRestoreError(null); setRestoreResult(null) }}
                    placeholder="Security key (EsTC j9gP noRq ...) or passphrase..."
                    rows={2}
                    className="w-full border-b border-m3-outline-variant bg-transparent py-2 font-mono text-xs text-m3-on-surface placeholder-m3-outline focus:border-m3-primary focus:outline-none resize-none dark:text-m3-on-surface dark:placeholder-m3-outline"
                  />
                  {restoreError && <p className="text-xs text-m3-error">{restoreError}</p>}
                  {restoreResult && (
                    <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                      <CheckCircle className="h-3.5 w-3.5" />{restoreResult}
                    </div>
                  )}
                  <button
                    onClick={async () => {
                      if (!recoveryKey.trim()) return
                      setIsRestoring(true); setRestoreError(null); setRestoreResult(null)
                      try { await restoreFromRecoveryKey(recoveryKey); setRestoreResult('Device verified and keys restored'); setRecoveryKey('') }
                      catch (err) { setRestoreError(err instanceof Error ? err.message : 'Failed to restore keys') }
                      finally { setIsRestoring(false) }
                    }}
                    disabled={isRestoring || !recoveryKey.trim()}
                    className="flex w-full items-center justify-center gap-2 rounded-full bg-m3-primary py-2.5 text-xs font-medium text-white transition-colors hover:bg-m3-primary/90 disabled:opacity-50"
                  >
                    {isRestoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Key className="h-3.5 w-3.5" />}
                    {isRestoring ? 'Restoring keys...' : 'Restore from Recovery Key'}
                  </button>
                </div>
              </div>

              {/* Access Token */}
              <div className="px-6 py-5">
                <div className="flex items-center gap-3 mb-4">
                  <Key className="h-5 w-5 text-m3-on-surface-variant dark:text-m3-outline" />
                  <p className="text-sm font-medium text-m3-on-surface dark:text-m3-on-surface">Access Token</p>
                </div>
                <div className="ml-8">
                  {showAccessToken ? (
                    <div className="space-y-2">
                      <code className="block break-all rounded-lg bg-m3-surface-container dark:bg-m3-surface-container-high p-3 text-xs text-m3-on-surface font-mono select-all">
                        {getMatrixClient()?.getAccessToken() || 'Not found'}
                      </code>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            try {
                              const token = getMatrixClient()?.getAccessToken()
                              if (token) { navigator.clipboard.writeText(token); setTokenCopied(true); setTimeout(() => setTokenCopied(false), 2000) }
                            } catch {}
                          }}
                          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-m3-surface-container dark:bg-m3-surface-container-high text-m3-on-surface hover:bg-m3-surface-container-high dark:hover:bg-m3-surface-container-highest transition-colors"
                        >
                          {tokenCopied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                          {tokenCopied ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setShowAccessToken(true); setTimeout(() => setShowAccessToken(false), 5000) }}
                      className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium bg-m3-surface-container dark:bg-m3-surface-container-high text-m3-on-surface hover:bg-m3-surface-container-high dark:hover:bg-m3-surface-container-highest transition-colors"
                    >
                      <Shield className="h-3.5 w-3.5" />
                      Reveal Access Token (5s)
                    </button>
                  )}
                  <p className="text-xs text-m3-on-surface-variant mt-2">Do not share this token. It grants full access to your account.</p>
                </div>
              </div>

              {/* Active Sessions */}
              <div className="px-6 py-5">
                <div className="flex items-center gap-3 mb-4">
                  <Monitor className="h-5 w-5 text-m3-on-surface-variant dark:text-m3-outline" />
                  <p className="text-sm font-medium text-m3-on-surface dark:text-m3-on-surface">Active Sessions</p>
                </div>
                {loadingDevices ? (
                  <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-m3-outline" /></div>
                ) : (
                  <div className="space-y-1">
                    {devices.map(device => {
                      const isCurrent = device.deviceId === currentDeviceId
                      const isConfirming = showDeleteConfirm === device.deviceId
                      return (
                        <div key={device.deviceId} className={`rounded-xl px-3 py-3 ${isCurrent ? 'bg-green-50 dark:bg-green-900/10' : ''}`}>
                          <div className="flex items-center gap-3">
                            <Monitor className={`h-5 w-5 flex-shrink-0 ${isCurrent ? 'text-green-500' : 'text-m3-outline'}`} />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-m3-on-surface dark:text-m3-on-surface-variant">
                                {device.displayName || device.deviceId}
                                {isCurrent && <span className="ml-1.5 text-xs text-green-600 dark:text-green-400">(this device)</span>}
                              </p>
                              <p className="text-xs text-m3-on-surface-variant dark:text-m3-outline">
                                {device.deviceId}{device.lastSeenTs ? ` · ${new Date(device.lastSeenTs).toLocaleDateString()}` : ''}{device.lastSeenIp ? ` · ${device.lastSeenIp}` : ''}
                              </p>
                            </div>
                            {!isCurrent && !isConfirming && (
                              <button
                                onClick={() => { setShowDeleteConfirm(device.deviceId); setDeviceError(null); setDeletePassword('') }}
                                className="rounded-full px-3 py-1 text-xs text-m3-error transition-colors hover:bg-m3-error-container dark:hover:bg-red-900/20"
                              >
                                Sign out
                              </button>
                            )}
                          </div>
                          {isConfirming && (
                            <div className="mt-3 ml-8 space-y-3">
                              <p className="text-xs text-m3-on-surface-variant">Enter password to sign out this session:</p>
                              <input
                                type="password"
                                value={deletePassword}
                                onChange={e => { setDeletePassword(e.target.value); setDeviceError(null) }}
                                onKeyDown={e => { if (e.key === 'Enter') handleDeleteDevice(device.deviceId) }}
                                placeholder="Account password"
                                autoFocus
                                className="w-full border-b border-m3-outline-variant bg-transparent py-2 text-sm text-m3-on-surface focus:border-m3-primary focus:outline-none dark:text-m3-on-surface"
                              />
                              {deviceError && <p className="text-xs text-m3-error">{deviceError}</p>}
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleDeleteDevice(device.deviceId)}
                                  disabled={deletingDevice === device.deviceId}
                                  className="flex items-center gap-1.5 rounded-full bg-m3-error px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-m3-error/90 disabled:opacity-50"
                                >
                                  {deletingDevice === device.deviceId ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
                                  Confirm
                                </button>
                                <button
                                  onClick={() => { setShowDeleteConfirm(null); setDeletePassword(''); setDeviceError(null) }}
                                  className="rounded-full px-4 py-1.5 text-xs text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                {/* Sign out all other sessions */}
                {devices.filter(d => d.deviceId !== currentDeviceId).length > 0 && (
                  <div className="mt-4 px-1">
                    {!showSignOutAll ? (
                      <button
                        onClick={() => { setShowSignOutAll(true); setSignOutAllError(null); setSignOutAllPassword('') }}
                        className="flex items-center gap-2 rounded-full bg-m3-error-container px-4 py-2 text-xs font-medium text-m3-on-error-container transition-colors hover:bg-m3-error/20"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        Sign out all other sessions
                      </button>
                    ) : (
                      <div className="space-y-3 rounded-xl bg-m3-error-container/30 p-3">
                        <p className="text-xs text-m3-on-surface-variant">Enter password to sign out all other sessions:</p>
                        <input
                          type="password"
                          value={signOutAllPassword}
                          onChange={e => { setSignOutAllPassword(e.target.value); setSignOutAllError(null) }}
                          onKeyDown={e => { if (e.key === 'Enter') handleSignOutAllOther() }}
                          placeholder="Account password"
                          autoFocus
                          className="w-full border-b border-m3-outline-variant bg-transparent py-2 text-sm text-m3-on-surface focus:border-m3-primary focus:outline-none dark:text-m3-on-surface"
                        />
                        {signOutAllError && <p className="text-xs text-m3-error">{signOutAllError}</p>}
                        <div className="flex gap-2">
                          <button
                            onClick={handleSignOutAllOther}
                            disabled={signingOutAll}
                            className="flex items-center gap-1.5 rounded-full bg-m3-error px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-m3-error/90 disabled:opacity-50"
                          >
                            {signingOutAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
                            Sign out all
                          </button>
                          <button
                            onClick={() => { setShowSignOutAll(false); setSignOutAllPassword(''); setSignOutAllError(null) }}
                            className="rounded-full px-4 py-1.5 text-xs text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===== ABOUT ===== */}
          {activeSection === 'about' && (
            <div className="divide-y divide-m3-outline-variant dark:divide-m3-outline-variant">
              {/* Connection status */}
              <div className="flex items-center gap-4 px-6 py-4">
                {serverStatus === 'checking' ? (
                  <Loader2 className="h-5 w-5 animate-spin text-m3-outline" />
                ) : serverStatus === 'connected' ? (
                  <Wifi className="h-5 w-5 text-green-600 dark:text-green-400" />
                ) : (
                  <WifiOff className="h-5 w-5 text-m3-error" />
                )}
                <div className="flex-1">
                  <p className={`text-sm ${serverStatus === 'connected' ? 'text-green-700 dark:text-green-300' : serverStatus === 'error' ? 'text-m3-error' : 'text-m3-on-surface'}`}>
                    {serverStatus === 'connected' ? 'Connected' : serverStatus === 'error' ? 'Connection Error' : 'Checking...'}
                  </p>
                  <p className="text-xs text-m3-on-surface-variant dark:text-m3-outline">{getHomeserverUrl() || 'No homeserver'}</p>
                </div>
                <div className="flex items-center gap-2">
                  {serverLatency !== null && (
                    <span className={`font-mono text-xs ${serverLatency < 200 ? 'text-green-600 dark:text-green-400' : serverLatency < 500 ? 'text-yellow-600' : 'text-m3-error'}`}>
                      {serverLatency}ms
                    </span>
                  )}
                  <button onClick={checkServerStatus} disabled={serverStatus === 'checking'} className="rounded-full p-2 text-m3-on-surface-variant hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high">
                    <RefreshCw className={`h-4 w-4 ${serverStatus === 'checking' ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Build info */}
              <div className="px-6 py-4 space-y-3">
                <p className="text-xs font-medium text-m3-on-surface-variant dark:text-m3-outline">Build</p>
                <InfoRow label="Version" value={`v${process.env.NEXT_PUBLIC_BUILD_VERSION || '?'}`} mono />
                <InfoRow label="App" value="Messages for Matrix" />
              </div>

              {/* Component versions */}
              <div className="px-6 py-4 space-y-3">
                <p className="text-xs font-medium text-m3-on-surface-variant dark:text-m3-outline">Components</p>
                <InfoRow label="matrix-js-sdk" value="41.1.0" mono />
                <InfoRow label="matrix-sdk-crypto-wasm" value="18.0.0" mono />
                <InfoRow label="Next.js" value="16.2.1" mono />
                <InfoRow label="React" value="19.2.4" mono />
                <InfoRow label="Zustand" value="5.0.12" mono />
                <InfoRow label="Tailwind CSS" value="4.x" mono />
                <InfoRow label="DOMPurify" value="3.3.3" mono />
                <InfoRow label="Lucide React" value="0.577.0" mono />
              </div>

              {/* Protocol info */}
              <div className="px-6 py-4 space-y-3">
                <p className="text-xs font-medium text-m3-on-surface-variant dark:text-m3-outline">Protocol & Standards</p>
                <InfoRow label="Protocol" value="Matrix (CS API)" />
                <InfoRow label="Encryption" value="Megolm (m.megolm.v1.aes-sha2)" icon={<Lock className="h-3 w-3 text-green-500" />} />
                <InfoRow label="Key Exchange" value="Olm (m.olm.v1.curve25519-aes-sha2)" />
                <InfoRow label="Verification" value="SAS (m.sas.v1)" />
                <InfoRow label="Key Backup" value="m.megolm_backup.v1.curve25519-aes-sha2" />
                {clientVersions.length > 0 && <InfoRow label="Server API" value={clientVersions[clientVersions.length - 1]} />}
              </div>

              {/* Device info */}
              <div className="px-6 py-4 space-y-3">
                <p className="text-xs font-medium text-m3-on-surface-variant dark:text-m3-outline">Device</p>
                <InfoRow label="Device ID" value={currentDeviceId} mono />
                <InfoRow label="User ID" value={user?.userId || 'unknown'} mono />
              </div>

              {/* Server info */}
              <div className="px-6 py-4 space-y-3">
                <p className="text-xs font-medium text-m3-on-surface-variant dark:text-m3-outline">Server</p>
                <InfoRow label="Homeserver" value={homeserverDomain} />
                <InfoRow label="URL" value={getHomeserverUrl() || 'unknown'} mono />
                {clientVersions.length > 0 && <InfoRow label="Supported APIs" value={clientVersions.join(', ')} />}
              </div>
            </div>
          )}
        </div>
      </div>{/* end settings content area */}
      </div>{/* end flex row with sidebar */}
    </div>
  )
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-full flex-shrink-0 ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
      <span className="text-xs text-m3-on-surface dark:text-m3-on-surface-variant">{label}</span>
      <span className={`text-xs ml-auto ${ok ? 'text-green-600 dark:text-green-400' : 'text-m3-error'}`}>{ok ? 'OK' : 'Not set up'}</span>
    </div>
  )
}

function InfoRow({ label, value, mono, icon }: { label: string; value: string; mono?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-m3-on-surface-variant dark:text-m3-outline flex-shrink-0">{label}</span>
      <span className={`text-xs text-right text-m3-on-surface dark:text-m3-on-surface-variant flex items-center gap-1 ${mono ? 'font-mono' : ''}`}>
        {icon}{value}
      </span>
    </div>
  )
}

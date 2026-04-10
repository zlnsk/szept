'use client'

import * as sdk from 'matrix-js-sdk'
import type { Logger } from 'matrix-js-sdk/lib/logger'
import { logger as sdkGlobalLogger } from 'matrix-js-sdk/lib/logger'
import type { CryptoCallbacks } from 'matrix-js-sdk/lib/crypto-api'
import { reportError } from '@/lib/error-reporter'
import { clearTurnServerPolling } from './sdk-compat'
import { clearThumbnailCache } from './media'

let matrixClient: sdk.MatrixClient | null = null

/**
 * Get the homeserver URL from the current session or return null.
 */
export function getHomeserverUrl(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const session = localStorage.getItem('matrix_session')
    if (session) {
      return JSON.parse(session).homeserverUrl || null
    }
  } catch { /* ignore */ }
  return null
}

/**
 * Get the homeserver domain (hostname) from the current session.
 */
export function getHomeserverDomain(): string | null {
  const url = getHomeserverUrl()
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/**
 * Resolve a Matrix server name to a homeserver base URL.
 * Uses a server-side API route for .well-known discovery to avoid browser
 * CORS issues (e.g. when behind Pangolin or other auth-gating proxies).
 */
export async function resolveHomeserver(server: string): Promise<string> {
  // If user typed a full URL, use it directly
  if (server.startsWith('https://')) {
    return server.replace(/\/+$/, '')
  }
  // Block insecure http:// in production — only allow in development
  if (server.startsWith('http://')) {
    if (process.env.NODE_ENV === 'development') {
      return server.replace(/\/+$/, '')
    }
    throw new Error('Insecure homeserver URLs (http://) are not allowed. Use https:// instead.')
  }

  // Client-side discovery first — avoids Pangolin auth intercept on login page
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    const res = await fetch(`https://${server}/.well-known/matrix/client`, { signal: controller.signal })
    clearTimeout(timeout)
    if (res.ok) {
      const data = await res.json()
      const base = data?.['m.homeserver']?.base_url
      if (base) {
        const cleanUrl = base.replace(/\/+$/, '')
        if (!cleanUrl.startsWith('https://')) {
          if (process.env.NODE_ENV !== 'development' || !cleanUrl.startsWith('http://')) {
            throw new Error(`Untrusted .well-known base_url: ${cleanUrl} — must use HTTPS`)
          }
        }
        return cleanUrl
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Untrusted')) throw err
  }

  return `https://${server}`
}

// Pending secret storage key for the getSecretStorageKey callback
let pendingSecretStorageKey: Uint8Array | null = null

const cryptoCallbacks: CryptoCallbacks = {
  getSecretStorageKey: async ({ keys }: { keys: Record<string, any> }, _name: string): Promise<[string, Uint8Array<ArrayBuffer>] | null> => {
    if (pendingSecretStorageKey) {
      const keyId = Object.keys(keys)[0]
      // Don't clear pendingSecretStorageKey here — the SDK calls this callback
      // multiple times during restoration (for cross-signing keys + backup key).
      // It's cleared in restoreFromRecoveryKey after the process completes.
      const key = new Uint8Array(pendingSecretStorageKey) as Uint8Array<ArrayBuffer>
      return [keyId, key]
    }
    return null
  },
}

// Patterns for crypto/decryption noise we want to suppress
const SUPPRESSED_PATTERNS = [
  'key backup is not working',
  'sent before this device logged in',
  'DecryptionError',
  'Failed to decrypt event',
  'Unable to decrypt',
  'olm_internal_error',
  'megolm session not yet available',
  'Received megolm session for',
  'Not checking key backup for session',
  'Adding default global',
  'is not trusted',
  'already queued',
  // Key backup 404 spam for sessions that were never backed up
  'No luck requesting key backup',
  'No room_keys found',
  'requestRoomKeyFromBackup',
  // Rust WASM crypto module patterns (these bypass the JS SDK logger)
  'matrix_sdk_crypto',
  "Can't find the room key",
  'Failed to decrypt a room event',
  'Error decrypting event',
  'WARN matrix_sdk',
  'ERROR matrix_sdk',
  // to-device decryption errors (expected after crypto store reset / new device)
  'to-device event was not decrypted',
  // Per-session key backup download errors (expected for sessions not in backup)
  'Error while decrypting and importing key backup',
  'key backup for session',
  // Push rules / TURN server 404 on servers that don't support them (Conduit etc.)
  'Getting push rules failed',
  'Failed to get TURN URIs',
  'getPushRules',
  'pushrules',
  'Missing default global',
  'Missing default',
]

// Log suppression can be disabled at runtime for debugging:
//   - Set localStorage key 'MATRIX_DEBUG_LOGS' to '1' and reload
//   - Or set env var MATRIX_DEBUG_LOGS=1 at build time
// A console helper is also available: window.__matrixEnableDebugLogs()
const LOG_SUPPRESSION_ENABLED =
  typeof window !== 'undefined'
    ? !localStorage.getItem('MATRIX_DEBUG_LOGS')
    : process.env.MATRIX_DEBUG_LOGS !== '1'

if (typeof window !== 'undefined') {
  (window as any).__matrixEnableDebugLogs = () => {
    localStorage.setItem('MATRIX_DEBUG_LOGS', '1')
    console.info('Matrix debug logs enabled. Reload to apply.')
  };
  (window as any).__matrixDisableDebugLogs = () => {
    localStorage.removeItem('MATRIX_DEBUG_LOGS')
    console.info('Matrix debug logs disabled. Reload to apply.')
  }
}

function isSuppressed(args: any[]): boolean {
  if (!LOG_SUPPRESSION_ENABLED) return false
  const msg = args.map(a => (typeof a === 'string' ? a : a?.message || '')).join(' ')
  return SUPPRESSED_PATTERNS.some(p => msg.includes(p))
}

// Log suppression is handled exclusively via filteredLogger passed to the SDK.
// Global console monkey-patching is intentionally avoided to prevent masking
// errors from the application or third-party libraries.
//
// Suppressed messages are logged at debug level instead of being discarded,
// so they remain accessible in browser DevTools when verbose logging is enabled.

/**
 * A logger that filters out noisy crypto decryption warnings.
 * These occur for every historical message sent before this device logged in
 * when key backup hasn't been restored yet - expected behavior, not errors.
 *
 * Suppressed messages are downgraded to console.debug instead of being discarded,
 * making them available when DevTools verbose logging is enabled.
 */
const filteredLogger: Logger = {
  getChild(namespace: string): Logger {
    return filteredLogger
  },
  trace(...msg: any[]) { if (!isSuppressed(msg)) console.trace(...msg); else console.debug('[suppressed:trace]', ...msg) },
  debug(...msg: any[]) { if (!isSuppressed(msg)) console.debug(...msg) },
  info(...msg: any[]) { if (!isSuppressed(msg)) console.info(...msg); else console.debug('[suppressed:info]', ...msg) },
  warn(...msg: any[]) { if (!isSuppressed(msg)) console.warn(...msg); else console.debug('[suppressed:warn]', ...msg) },
  error(...msg: any[]) { if (!isSuppressed(msg)) console.error(...msg); else console.debug('[suppressed:error]', ...msg) },
}

// Wrap the SDK's global logger warn/error methods (used by MatrixEvent for
// decryption errors) to apply suppression. We wrap the methods directly instead
// of using methodFactory + rebuild() which breaks loglevel's prefix chain.
const _origWarn = (sdkGlobalLogger as any).warn
const _origError = (sdkGlobalLogger as any).error
;(sdkGlobalLogger as any).warn = (...args: any[]) => { if (!isSuppressed(args)) _origWarn.apply(sdkGlobalLogger, args) }
;(sdkGlobalLogger as any).error = (...args: any[]) => { if (!isSuppressed(args)) _origError.apply(sdkGlobalLogger, args) }

export function getMatrixClient(): sdk.MatrixClient | null {
  return matrixClient
}

/**
 * Create a fetch function that proxies all requests to the Matrix homeserver
 * through our Next.js API route, bypassing browser CORS restrictions.
 * Requests to /_matrix/* are rewritten to /api/matrix-proxy/_matrix/*
 * with the real homeserver URL passed in a header.
 */
function createProxiedFetch(homeserverUrl: string): typeof globalThis.fetch {
  const hsOrigin = new URL(homeserverUrl).origin

  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url: string
    if (input instanceof Request) {
      url = input.url
    } else if (input instanceof URL) {
      url = input.toString()
    } else {
      url = input
    }

    // Only proxy requests going to the Matrix homeserver
    if (url.startsWith(hsOrigin + '/_matrix/')) {
      const matrixPath = url.slice(hsOrigin.length) // e.g. /_matrix/client/v3/sync?...

      // Intercept TURN server polling — returns empty to avoid 404 console noise
      // on servers that don't support VoIP. The SDK's checkTurnServers runs
      // inside startClient before we can disable it.
      if (matrixPath.startsWith('/_matrix/client/v3/voip/turnServer')) {
        return Promise.resolve(new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }

      const proxyUrl = `/Messages/api/matrix-proxy${matrixPath}`

      const newInit: RequestInit = { ...init }
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
      headers.set('X-Matrix-Homeserver', homeserverUrl)
      newInit.headers = headers
      // Ensure cookies are sent (OTP session cookie required by middleware)
      newInit.credentials = 'same-origin'

      return globalThis.fetch(proxyUrl, newInit)
    }

    // Non-Matrix requests pass through normally
    return globalThis.fetch(input, init)
  }
}

async function initCrypto(client: sdk.MatrixClient): Promise<void> {
  try {
    // Use Rust crypto with IndexedDB for persistent key storage
    await client.initRustCrypto({
      useIndexedDB: true,
    })
  } catch (err) {
    // If the stored crypto account doesn't match the current device ID
    // (e.g. user logged out and back in, or device ID changed),
    // clear the stale IndexedDB crypto store and retry.
    const errMsg = String(err)
    if (errMsg.includes('account in the store doesn\'t match')) {
      console.warn('Crypto store has stale device keys, clearing and reinitializing...')
      try {
        // Delete all IndexedDB databases that the Rust crypto SDK creates
        const databases = await indexedDB.databases()
        for (const db of databases) {
          if (db.name && (db.name.includes('matrix-sdk-crypto') || db.name.includes('_rust_sdk'))) {
            await new Promise<void>((resolve, reject) => {
              const req = indexedDB.deleteDatabase(db.name!)
              req.onsuccess = () => resolve()
              req.onerror = () => reject(req.error)
            })
          }
        }
        // Retry crypto init
        await client.initRustCrypto({
          useIndexedDB: true,
        })
      } catch (retryErr) {
        reportError('crypto', retryErr)
        throw retryErr
      }
    } else {
      reportError('crypto', err)
      throw err
    }
  }

  // Device verification is intentionally NOT auto-applied here.
  // The user must complete verification via recovery key or interactive
  // emoji verification (NewSessionBanner) to mark the device as trusted.
  // Auto-verifying bypasses the cross-signing trust model and would allow
  // a compromised device to be silently trusted.
}

async function enableKeyBackup(client: sdk.MatrixClient): Promise<void> {
  try {
    const crypto = client.getCrypto()
    if (!crypto) return

    // Check if server has a key backup and enable it
    // Check backup info and trust BEFORE enabling, to avoid the SDK firing
    // per-session key requests against an untrusted backup (causing 404 spam).
    const backupInfo = await crypto.getKeyBackupInfo()
    if (!backupInfo) {
      console.debug('No key backup found on server')
      return
    }
    console.debug('Key backup found on server, version:', backupInfo.version)

    const trustInfo = await crypto.isKeyBackupTrusted(backupInfo)
    console.debug('Backup trusted:', trustInfo.trusted)

    if (!trustInfo.trusted) {
      console.debug('Skipping key backup enable — backup is not trusted')
      return
    }

    // Backup is trusted — safe to enable without 404 spam
    const check = await crypto.checkKeyBackupAndEnable()
    if (check && pendingSecretStorageKey) {
      try {
        await crypto.loadSessionBackupPrivateKeyFromSecretStorage()
        console.debug('Loaded backup decryption key from secret storage')
        const result = await crypto.restoreKeyBackup()
        console.debug(`Auto-restored ${result.imported} of ${result.total} keys from backup`)
      } catch (err) {
        console.debug('Could not auto-restore from backup:', err)
      }
    }
  } catch (err) {
    console.warn('Key backup check failed:', err)
  }
}

/**
 * Bootstrap cross-signing, secret storage, and key backup.
 * Generates a new security/recovery key that the user must save.
 * Returns the encoded recovery key string.
 */
export async function generateSecurityKey(password: string): Promise<string> {
  if (!matrixClient) throw new Error('Not connected')
  const crypto = matrixClient.getCrypto()
  if (!crypto) throw new Error('Crypto not initialized')

  // Generate the recovery key FIRST so the SSSS callback can always provide it.
  // bootstrapCrossSigning may access existing secret storage, which triggers
  // getSecretStorageKey — without pendingSecretStorageKey set, it returns null
  // causing "getSecretStorageKey callback returned falsey".
  const recoveryKey = await crypto.createRecoveryKeyFromPassphrase()
  const encodedKey = recoveryKey.encodedPrivateKey!
  pendingSecretStorageKey = recoveryKey.privateKey

  try {
    // Bootstrap cross-signing so fresh keys exist before secret storage stores them
    await crypto.bootstrapCrossSigning({
      setupNewCrossSigning: true,
      authUploadDeviceSigningKeys: async (makeRequest) => {
        // Send the first request with no auth body so the homeserver returns
        // a 401 UIA challenge with a session ID. Then re-send with the
        // password and the returned session.
        //
        // NOTE: passing `{}` here causes tuwunel to fail with
        // "missing field `session`" — its strict serde parser tries to
        // deserialize the empty auth object as a complete UIA completion.
        // Synapse tolerates `{}` and returns 401 anyway, but tuwunel does not.
        // Pass `null` so matrix-js-sdk omits the auth field entirely.
        try {
          await makeRequest(null)
        } catch (err: any) {
          if (err.httpStatus === 401 && err.data?.flows && err.data?.session) {
            await makeRequest({
              session: err.data.session,
              type: 'm.login.password',
              identifier: {
                type: 'm.id.user',
                user: matrixClient!.getUserId()!,
              },
              password,
            })
          } else {
            throw err
          }
        }
      },
    })

    // Bootstrap secret storage — stores the fresh cross-signing keys with the new SSSS key
    await crypto.bootstrapSecretStorage({
      createSecretStorageKey: async () => recoveryKey,
      setupNewSecretStorage: true,
      setupNewKeyBackup: true,
    })

    // Load the backup key and restore any existing backed-up room keys
    try {
      await crypto.loadSessionBackupPrivateKeyFromSecretStorage()
      const result = await crypto.restoreKeyBackup()
      console.debug(`Restored ${result.imported} of ${result.total} keys after security setup`)
    } catch (err) {
      console.debug('No existing key backup to restore:', err)
    }

    // Re-enable key backup now that we have fresh trusted keys
    await enableKeyBackup(matrixClient)
  } finally {
    pendingSecretStorageKey = null
  }

  return encodedKey
}

/**
 * Get encryption health status for the settings panel.
 */
export async function getEncryptionStatus(): Promise<{
  crossSigningReady: boolean
  thisDeviceVerified: boolean
  keyBackupEnabled: boolean
  keyBackupTrusted: boolean
}> {
  if (!matrixClient) return { crossSigningReady: false, thisDeviceVerified: false, keyBackupEnabled: false, keyBackupTrusted: false }
  const crypto = matrixClient.getCrypto()
  if (!crypto) return { crossSigningReady: false, thisDeviceVerified: false, keyBackupEnabled: false, keyBackupTrusted: false }

  try {
    const csStatus = await crypto.getCrossSigningStatus()
    const crossSigningReady = csStatus.publicKeysOnDevice && csStatus.privateKeysInSecretStorage

    const userId = matrixClient.getUserId()!
    const deviceId = matrixClient.getDeviceId()!
    const deviceVerification = await crypto.getDeviceVerificationStatus(userId, deviceId)
    const thisDeviceVerified = deviceVerification?.crossSigningVerified ?? false

    const backupInfo = await crypto.getKeyBackupInfo()
    let keyBackupEnabled = false
    let keyBackupTrusted = false
    if (backupInfo) {
      keyBackupEnabled = true
      const trustInfo = await crypto.isKeyBackupTrusted(backupInfo)
      keyBackupTrusted = trustInfo.trusted
    }

    return { crossSigningReady, thisDeviceVerified, keyBackupEnabled, keyBackupTrusted }
  } catch {
    return { crossSigningReady: false, thisDeviceVerified: false, keyBackupEnabled: false, keyBackupTrusted: false }
  }
}

/**
 * Check if cross-signing is set up and if this device is cross-signed.
 */
export async function getCrossSigningStatus(): Promise<{
  exists: boolean
  thisDeviceVerified: boolean
}> {
  if (!matrixClient) return { exists: false, thisDeviceVerified: false }
  const crypto = matrixClient.getCrypto()
  if (!crypto) return { exists: false, thisDeviceVerified: false }

  try {
    const status = await crypto.getCrossSigningStatus()
    const isCrossSigned = status.publicKeysOnDevice && status.privateKeysInSecretStorage

    // Check if our device is verified by cross-signing
    const userId = matrixClient.getUserId()!
    const deviceId = matrixClient.getDeviceId()!
    const deviceVerification = await crypto.getDeviceVerificationStatus(userId, deviceId)
    const thisDeviceVerified = deviceVerification?.crossSigningVerified ?? false

    return {
      exists: isCrossSigned,
      thisDeviceVerified,
    }
  } catch {
    return { exists: false, thisDeviceVerified: false }
  }
}

/**
 * Request interactive verification from another session of the same user.
 */
export async function requestSelfVerification(): Promise<any> {
  if (!matrixClient) throw new Error('Not connected')
  const crypto = matrixClient.getCrypto()
  if (!crypto) throw new Error('Crypto not initialized')

  const request = await crypto.requestOwnUserVerification()
  return request
}

export async function restoreFromRecoveryKey(input: string): Promise<void> {
  if (!matrixClient) throw new Error('Not connected')
  const crypto = matrixClient.getCrypto()
  if (!crypto) throw new Error('Crypto not initialized')

  const trimmed = input.trim()

  // Try decoding as a recovery key (space-separated base58 groups like "EsTH r6vv 8Yi8...")
  let keyBytes: Uint8Array | null = null

  try {
    const { decodeRecoveryKey } = await import('matrix-js-sdk/lib/crypto-api/recovery-key')
    keyBytes = decodeRecoveryKey(trimmed)
  } catch {
    console.debug('Not a recovery key format, trying as passphrase...')
  }

  if (!keyBytes) {
    // Try deriving from passphrase via SSSS passphrase info
    try {
      const secretStorage = matrixClient.secretStorage
      const defaultKeyId = await secretStorage.getDefaultKeyId()
      if (defaultKeyId) {
        const keyInfo = await secretStorage.getKey(defaultKeyId)
        if (keyInfo && keyInfo[1]?.passphrase) {
          const { deriveRecoveryKeyFromPassphrase } = await import('matrix-js-sdk/lib/crypto-api/key-passphrase')
          const pp = keyInfo[1].passphrase
          keyBytes = await deriveRecoveryKeyFromPassphrase(trimmed, pp.salt, pp.iterations, pp.bits || 256)
        }
      }
    } catch {
      // Not a passphrase either
    }
  }

  if (!keyBytes) {
    throw new Error(
      'Could not decode the recovery key. Make sure you entered it correctly, ' +
      'including all spaces between groups.'
    )
  }

  // Step 1: Set the recovery key so the SSSS callback can provide it
  // when bootstrapCrossSigning needs to read cross-signing private keys from Secret Storage.
  pendingSecretStorageKey = keyBytes

  try {
    // Step 2: Bootstrap cross-signing WITHOUT setupNewCrossSigning.
    try {
      await crypto.bootstrapCrossSigning({})
      console.debug('Cross-signing keys loaded from Secret Storage')
    } catch (err) {
      console.warn('bootstrapCrossSigning failed:', err)
    }

    // Step 3: Cross-sign this device using the self-signing key.
    try {
      const deviceId = matrixClient.getDeviceId()!
      await crypto.crossSignDevice(deviceId)
      console.debug('Device cross-signed successfully:', deviceId)
    } catch (err) {
      console.warn('crossSignDevice failed (may already be signed):', err)
    }

    // Step 4: Optionally restore from key backup if one exists.
    try {
      await crypto.loadSessionBackupPrivateKeyFromSecretStorage()
      console.debug('Loaded backup key from Secret Storage')
      const result = await crypto.restoreKeyBackup({
        progressCallback: (progress: any) => {
          console.debug('Key restore progress:', progress)
        },
      })
      console.debug(`Restored ${result.imported} of ${result.total} keys from backup`)
    } catch (err) {
      console.debug('Key backup restoration skipped (no backup or failed):', err)
    }
  } finally {
    pendingSecretStorageKey = null
  }
}

export async function deleteAllOtherDevices(password: string): Promise<void> {
  const client = getMatrixClient()
  if (!client) throw new Error('Not logged in')
  const { devices } = await (client as any).getDevices()
  const currentDeviceId = client.getDeviceId()
  const otherDeviceIds = devices
    .filter((d: any) => d.device_id !== currentDeviceId)
    .map((d: any) => d.device_id)
  if (otherDeviceIds.length === 0) return
  await (client as any).deleteMultipleDevices(otherDeviceIds, {
    type: 'm.login.password',
    identifier: { type: 'm.id.user', user: client.getUserId() },
    password,
  })
}

export async function deleteOtherDevice(
  deviceId: string,
  password: string
): Promise<void> {
  if (!matrixClient) throw new Error('Not connected')

  try {
    // First attempt without auth to get the session info
    await matrixClient.deleteDevice(deviceId)
  } catch (err: any) {
    // The server will return 401 with the auth flow info
    if (err.httpStatus === 401 && err.data?.flows) {
      await matrixClient.deleteDevice(deviceId, {
        type: 'm.login.password',
        identifier: {
          type: 'm.id.user',
          user: matrixClient.getUserId()!,
        },
        password,
      } as any)
    } else {
      throw err
    }
  }
}

/**
 * Register a new account on a Matrix homeserver.
 * Handles the m.login.dummy interactive auth flow (open registration servers).
 * For servers requiring captcha/email, throws with details about required flows.
 */
export async function registerAccount(
  username: string,
  password: string,
  homeserverUrl: string
): Promise<sdk.MatrixClient> {
  // Route login/register through the proxy (OTP cookie-authenticated)
  const tmpClient = sdk.createClient({
    baseUrl: homeserverUrl,
    fetchFn: createProxiedFetch(homeserverUrl),
  })

  let response: { access_token: string; user_id: string; device_id: string }

  try {
    // First attempt — try registration without auth (some servers allow it)
    const result = await tmpClient.registerRequest({
      username,
      password,
      initial_device_display_name: 'Messages Web',
      auth: { type: 'm.login.dummy' },
    })
    response = result as { access_token: string; user_id: string; device_id: string }
  } catch (err: any) {
    // The server requires interactive auth — check what flows are available
    if (err.httpStatus === 401 && err.data?.flows) {
      const flows = err.data.flows as Array<{ stages: string[] }>
      const session = err.data.session as string | undefined

      // Check if any flow only requires m.login.dummy
      const dummyFlow = flows.find((f: { stages: string[] }) =>
        f.stages.length === 1 && f.stages[0] === 'm.login.dummy'
      )

      if (dummyFlow && session) {
        // Retry with the session from the 401 response
        const result = await tmpClient.registerRequest({
          username,
          password,
          initial_device_display_name: 'Messages Web',
          auth: { type: 'm.login.dummy', session },
        })
        response = result as { access_token: string; user_id: string; device_id: string }
      } else {
        // Server requires captcha, email, or terms — can't handle in-app
        const requiredStages = flows[0]?.stages || []
        const needsCaptcha = requiredStages.includes('m.login.recaptcha')
        const needsEmail = requiredStages.includes('m.login.email.identity')
        const needsTerms = requiredStages.includes('m.login.terms')

        let message = 'This server requires additional verification to register: '
        const parts: string[] = []
        if (needsCaptcha) parts.push('CAPTCHA')
        if (needsEmail) parts.push('email verification')
        if (needsTerms) parts.push('terms acceptance')
        message += parts.join(', ') + '. '
        message += `Please register at ${homeserverUrl} directly and then sign in here.`

        throw new Error(message)
      }
    } else if (err.httpStatus === 403) {
      throw new Error('Registration is disabled on this server.')
    } else if (err.data?.errcode === 'M_USER_IN_USE') {
      throw new Error('Username is already taken. Please choose a different one.')
    } else if (err.data?.errcode === 'M_INVALID_USERNAME') {
      throw new Error('Invalid username. Use only lowercase letters, numbers, dots, hyphens, and underscores.')
    } else if (err.data?.errcode === 'M_EXCLUSIVE') {
      throw new Error('This username is reserved and cannot be registered.')
    } else {
      throw err
    }
  }

  matrixClient = sdk.createClient({
    baseUrl: homeserverUrl,
    accessToken: response.access_token,
    userId: response.user_id,
    deviceId: response.device_id,
    logger: filteredLogger,
    cryptoCallbacks,
    timelineSupport: true,
    fallbackICEServerAllowed: false,
    iceCandidatePoolSize: 20,
    fetchFn: createProxiedFetch(homeserverUrl),
    scheduler: new sdk.MatrixScheduler(
      sdk.MatrixScheduler.RETRY_BACKOFF_RATELIMIT,
      sdk.MatrixScheduler.QUEUE_MESSAGES,
    ),
  })

  localStorage.setItem(
    'matrix_session',
    JSON.stringify({
      accessToken: response.access_token,
      userId: response.user_id,
      deviceId: response.device_id,
      homeserverUrl,
    })
  )

  return matrixClient
}

export async function loginWithPassword(
  username: string,
  password: string,
  homeserverUrl: string
): Promise<sdk.MatrixClient> {
  // Route login/register through the proxy (OTP cookie-authenticated)
  const tmpClient = sdk.createClient({
    baseUrl: homeserverUrl,
    fetchFn: createProxiedFetch(homeserverUrl),
  })

  const response = await tmpClient.login('m.login.password', {
    user: username,
    password,
    initial_device_display_name: 'Messages Web',
  })

  matrixClient = sdk.createClient({
    baseUrl: homeserverUrl,
    accessToken: response.access_token,
    userId: response.user_id,
    deviceId: response.device_id,
    logger: filteredLogger,
    cryptoCallbacks,
    timelineSupport: true,
    fallbackICEServerAllowed: false,
    iceCandidatePoolSize: 20,
    fetchFn: createProxiedFetch(homeserverUrl),
    scheduler: new sdk.MatrixScheduler(
      sdk.MatrixScheduler.RETRY_BACKOFF_RATELIMIT,
      sdk.MatrixScheduler.QUEUE_MESSAGES,
    ),
  })

  // Crypto is initialized in startSync() — no need to call initCrypto here

  // Persist session in localStorage so it survives browser restarts.
  localStorage.setItem(
    'matrix_session',
    JSON.stringify({
      accessToken: response.access_token,
      userId: response.user_id,
      deviceId: response.device_id,
      homeserverUrl,
    })
  )

  // Store token in HttpOnly cookie for secure proxy auth
  await fetch('/Messages/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: response.access_token }),
  }).catch((err) => {
    console.error('Failed to store session cookie:', err)
  })

  return matrixClient
}

export function restoreSession(): sdk.MatrixClient | null {
  const stored = localStorage.getItem('matrix_session')
  if (!stored) return null

  try {
    const session = JSON.parse(stored)

    // Validate session data
    if (!session.accessToken || !session.userId || !session.deviceId || !session.homeserverUrl) {
      localStorage.removeItem('matrix_session')
      return null
    }

    // Validate homeserver URL is a valid URL
    try {
      new URL(session.homeserverUrl)
    } catch {
      localStorage.removeItem('matrix_session')
      return null
    }

    // Re-set HttpOnly cookie so the media proxy can authenticate requests.
    fetch("/Messages/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: session.accessToken }),
    }).catch(() => {})

    matrixClient = sdk.createClient({
      baseUrl: session.homeserverUrl,
      accessToken: session.accessToken,
      userId: session.userId,
      deviceId: session.deviceId,
      logger: filteredLogger,
      cryptoCallbacks,
      timelineSupport: true,
      fallbackICEServerAllowed: false,
      iceCandidatePoolSize: 20,
      fetchFn: createProxiedFetch(session.homeserverUrl),
      scheduler: new sdk.MatrixScheduler(
        sdk.MatrixScheduler.RETRY_BACKOFF_RATELIMIT,
        sdk.MatrixScheduler.QUEUE_MESSAGES,
      ),
    })
    return matrixClient
  } catch {
    localStorage.removeItem('matrix_session')
    return null
  }
}

export async function startSync(): Promise<void> {
  if (!matrixClient) return

  // Init crypto before starting sync so decryption works
  await initCrypto(matrixClient)

  // If the key backup is not trusted by this device, skip enabling it locally.
  // We intentionally do NOT delete it from the server — it may be trusted by
  // other verified sessions and deleting it would permanently destroy backed-up keys.

  await matrixClient.startClient({
    initialSyncLimit: 20,
    lazyLoadMembers: true,
    pendingEventOrdering: sdk.PendingEventOrdering.Detached,
  })

  // Stop the SDK's periodic TURN server polling — our VoIP module handles
  // ICE servers independently, and the polling causes 404 errors on servers
  // that don't support the /voip/turnServer endpoint.
  clearTurnServerPolling(matrixClient)

  // Wait for initial sync (with timeout to avoid infinite "Connecting..." spinner)
  await new Promise<void>((resolve, reject) => {
    const SYNC_TIMEOUT_MS = 60_000

    const timeout = setTimeout(() => {
      matrixClient?.removeListener(sdk.ClientEvent.Sync, onSync)
      reject(new Error('Initial sync timed out'))
    }, SYNC_TIMEOUT_MS)

    const onSync = (state: string, _prev: string | null, data?: any) => {
      if (state === 'PREPARED') {
        clearTimeout(timeout)
        matrixClient?.removeListener(sdk.ClientEvent.Sync, onSync)
        resolve()
      }
      // L-7: Force logout on 401 — access token rejected by server
      if (state === 'ERROR' && data?.error?.httpStatus === 401) {
        clearTimeout(timeout)
        console.warn('Sync returned 401 — token rejected, forcing logout')
        matrixClient?.stopClient()
        matrixClient = null
        localStorage.removeItem('matrix_session')
        window.location.href = '/Messages/login'
      }
    }
    matrixClient?.on(sdk.ClientEvent.Sync, onSync)
  })

  // Enable key backup in the background — don't block the app from loading.
  // This runs after the user already sees the chat list.
  if (matrixClient) {
    const client = matrixClient
    enableKeyBackup(client).catch(err => {
      console.warn('Key backup setup skipped:', err)
    })
  }
}

export async function logout(): Promise<void> {
  if (matrixClient) {
    try {
      matrixClient.stopClient()
      await matrixClient.logout(true)
    } catch {
      // ignore errors during logout
    }
  }
  matrixClient = null
  localStorage.removeItem('matrix_session')
  clearThumbnailCache()
  // Clear HttpOnly cookie
  fetch('/Messages/api/auth/session', { method: 'DELETE' }).catch(() => {})
}

export function getAvatarUrl(
  mxcUrl: string | null | undefined,
): string | null {
  if (!mxcUrl) return null
  // Return raw MXC URL; Avatar component fetches via authenticated endpoint
  return mxcUrl
}

export function getUserId(): string | null {
  return matrixClient?.getUserId() || null
}

/**
 * Resolve avatar for a room directly from the SDK.
 * Follows Element Web's algorithm exactly:
 * 1. Room avatar (m.room.avatar) — highest priority for ALL rooms
 * 2. For DMs without room avatar: other member's avatar via getAvatarFallbackMember()
 * 3. For groups: room avatar or null (shows initials)
 */
export function resolveRoomAvatarFromSDK(roomId: string): string | null {
  if (!matrixClient) return null
  const room = matrixClient.getRoom(roomId)
  if (!room) return null

  // 1. Room avatar (m.room.avatar) — bridges set this to the contact's real photo
  const roomMxc = room.getMxcAvatarUrl()
  if (roomMxc) return roomMxc

  // 2. Check if DM
  const dmMap = (matrixClient as unknown as { getAccountData: (type: string) => { getContent: () => Record<string, unknown> } | null }).getAccountData('m.direct')?.getContent() || {}
  let isDm = false
  for (const userRooms of Object.values(dmMap) as string[][]) {
    if (userRooms.includes(roomId)) { isDm = true; break }
  }
  if (!isDm) return null // Group with no room avatar → initials

  // 3. DM without room avatar: try member fallback
  const BOT_USER_IDS = ['@claude:lukasz.com', '@signalbot:lukasz.com', '@signal:lukasz.com']
  const isBotUser = (userId: string) => BOT_USER_IDS.includes(userId)
  const dmPartner = room.getAvatarFallbackMember()
  if (dmPartner?.getMxcAvatarUrl() && !isBotUser(dmPartner.userId)) return dmPartner.getMxcAvatarUrl()!

  // 4. Lazy loading fallback: try joined members directly
  const myUserId = matrixClient.getUserId()
  const others = room.getJoinedMembers().filter(m => m.userId !== myUserId && !isBotUser(m.userId))
  const puppet = others.find(m =>
    /^@(signal_|telegram_|whatsapp_|slack_|discord_|instagram_)/.test(m.userId)
  )
  const partner = puppet || others[0]
  if (partner?.getMxcAvatarUrl()) return partner.getMxcAvatarUrl()!

  return null
}


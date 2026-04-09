'use client'

import { createNewMatrixCall, CallEvent } from 'matrix-js-sdk'
import type { MatrixCall } from 'matrix-js-sdk'
import { CallState, CallType, CallErrorCode } from 'matrix-js-sdk/lib/webrtc/call'
import { CallFeedEvent } from 'matrix-js-sdk/lib/webrtc/callFeed'
import { CallEventHandlerEvent } from 'matrix-js-sdk/lib/webrtc/callEventHandler'
import { getMatrixClient, getAvatarUrl } from './client'
import { reportError } from '@/lib/error-reporter'
import { useCallStore } from '@/stores/call-store'
import type { CallInfo } from '@/stores/call-store'
// Static import for SDK version check — avoids runtime require() which may
// be stripped by the bundler in production builds.
import sdkPackageJson from 'matrix-js-sdk/package.json'

let currentCall: MatrixCall | null = null

// ---- VoIP disabled flag: set true if SDK internals are incompatible ----
let voipDisabled = false

/**
 * Enforce relay-only ICE transport to prevent IP leakage.
 * Disables host candidates so all media flows through TURN servers.
 */
// Tested against matrix-js-sdk 41.1.0 — peerConn is a private property.
// If the SDK changes this internal, relay enforcement will fail loudly (see assertion below).
const SDK_PEER_CONN_FIELD = 'peerConn'
const SUPPORTED_SDK_VERSION = '41.1.0'

// Validate SDK version at module load time (fail-fast)
if (sdkPackageJson.version && sdkPackageJson.version !== SUPPORTED_SDK_VERSION) {
  const msg = `matrix-js-sdk version ${sdkPackageJson.version} differs from tested ${SUPPORTED_SDK_VERSION}. VoIP relay-only ICE enforcement may not work — calls are disabled until the SDK compatibility is verified.`
  reportError('voip', msg)
  console.error(`[voip] ${msg}`)
  voipDisabled = true
}

/**
 * Access the private RTCPeerConnection from a MatrixCall.
 *
 * matrix-js-sdk does not expose peerConn publicly, so we access it via
 * a known private field name. A runtime version check and field-existence
 * assertion ensure this fails loudly if the SDK internals change.
 */
function getPeerConnection(call: MatrixCall): RTCPeerConnection | null {
  const pc = (call as unknown as Record<string, unknown>)[SDK_PEER_CONN_FIELD] as RTCPeerConnection | undefined
  if (!pc) {
    reportError('voip',
      `CRITICAL: '${SDK_PEER_CONN_FIELD}' not found on MatrixCall. ` +
      `matrix-js-sdk may have changed its internals. ` +
      `Relay-only ICE and HD bitrate controls are BROKEN. ` +
      `Pin matrix-js-sdk to ${SUPPORTED_SDK_VERSION} or update the field name.`
    )
    voipDisabled = true
    return null
  }
  return pc
}

function enforceRelayIcePolicy(call: MatrixCall): void {
  const pc = getPeerConnection(call)
  if (!pc) return
  const config = pc.getConfiguration()
  if (config?.iceTransportPolicy !== 'relay') {
    pc.setConfiguration({ ...config, iceTransportPolicy: 'relay' })
  }
}
let durationInterval: ReturnType<typeof setInterval> | null = null

function clearDurationInterval(): void {
  if (durationInterval) {
    clearInterval(durationInterval)
    durationInterval = null
  }
}

function startDurationTimer(): void {
  clearDurationInterval()
  const startTime = Date.now()
  useCallStore.getState().setDuration(0)
  durationInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000)
    useCallStore.getState().setDuration(elapsed)
  }, 1000)
}

function updateStreamsFromCall(call: MatrixCall): void {
  const store = useCallStore.getState()

  const localFeed = call.localUsermediaFeed
  if (localFeed?.stream) {
    store.setLocalStream(localFeed.stream)
  }

  const remoteFeed = call.remoteUsermediaFeed
  if (remoteFeed?.stream) {
    store.setRemoteStream(remoteFeed.stream)
  }
}

function getOpponentInfo(call: MatrixCall, roomId: string): Pick<CallInfo, 'opponentName' | 'opponentAvatarUrl' | 'opponentUserId'> {
  const client = getMatrixClient()
  const member = call.getOpponentMember()
  const room = client?.getRoom(roomId)

  if (member) {
    return {
      opponentName: member.name || member.userId,
      opponentAvatarUrl: getAvatarUrl(member.getMxcAvatarUrl()) || null,
      opponentUserId: member.userId,
    }
  }

  // Fallback: use room name
  return {
    opponentName: room?.name || roomId,
    opponentAvatarUrl: null,
    opponentUserId: '',
  }
}

function attachCallListeners(call: MatrixCall): void {
  const store = useCallStore.getState()

  call.on(CallEvent.State, (state: CallState, _oldState: CallState) => {
    const s = useCallStore.getState()

    switch (state) {
      case CallState.Ringing:
        s.setStatus('ringing')
        break
      case CallState.InviteSent:
        s.setStatus('ringing')
        break
      case CallState.Connecting:
      case CallState.CreateOffer:
      case CallState.CreateAnswer:
      case CallState.WaitLocalMedia:
        s.setStatus('connecting')
        break
      case CallState.Connected:
        s.setStatus('connected')
        startDurationTimer()
        updateStreamsFromCall(call)
        break
      case CallState.Ended:
        endCallCleanup()
        break
    }
  })

  call.on(CallEvent.FeedsChanged, () => {
    updateStreamsFromCall(call)
  })

  call.on(CallEvent.Hangup, () => {
    endCallCleanup()
  })

  call.on(CallEvent.Error, (error: any) => {
    console.error('Call error:', error)
    endCallCleanup()
  })
}

/**
 * Apply HD quality constraints to the call's local video/audio tracks
 * and boost bitrate via RTCRtpSender parameters.
 */
async function applyHdConstraints(call: MatrixCall, isVideo: boolean): Promise<void> {
  const localFeed = call.localUsermediaFeed
  if (!localFeed?.stream) return

  // Upgrade video track constraints to HD
  if (isVideo) {
    const videoTrack = localFeed.stream.getVideoTracks()[0]
    if (videoTrack) {
      try {
        await videoTrack.applyConstraints({
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        })
      } catch (e) {
        console.warn('Could not apply HD video constraints:', e)
      }
    }
  }

  // Boost audio quality
  const audioTrack = localFeed.stream.getAudioTracks()[0]
  if (audioTrack) {
    try {
      await audioTrack.applyConstraints({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: { ideal: 48000 },
        channelCount: { ideal: 1 },
      })
    } catch (e) {
      console.warn('Could not apply HD audio constraints:', e)
    }
  }

  // Boost max bitrate via RTCRtpSender
  const pc = getPeerConnection(call)
  if (!pc) return
  for (const sender of pc.getSenders()) {
    const params = sender.getParameters()
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}]
    }
    if (sender.track?.kind === 'video') {
      params.encodings[0].maxBitrate = 2_500_000 // 2.5 Mbps
    } else if (sender.track?.kind === 'audio') {
      params.encodings[0].maxBitrate = 128_000 // 128 kbps
    }
    try {
      await sender.setParameters(params)
    } catch (e) {
      console.warn('Could not set sender bitrate:', e)
    }
  }
}

/**
 * Remove HD constraints — revert to standard quality.
 */
async function applyStandardConstraints(call: MatrixCall, isVideo: boolean): Promise<void> {
  const localFeed = call.localUsermediaFeed
  if (!localFeed?.stream) return

  if (isVideo) {
    const videoTrack = localFeed.stream.getVideoTracks()[0]
    if (videoTrack) {
      try {
        await videoTrack.applyConstraints({
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24 },
        })
      } catch (e) {
        console.warn('Could not revert video constraints:', e)
      }
    }
  }

  const pc = getPeerConnection(call)
  if (!pc) return
  for (const sender of pc.getSenders()) {
    const params = sender.getParameters()
    if (!params.encodings || params.encodings.length === 0) continue
    if (sender.track?.kind === 'video') {
      params.encodings[0].maxBitrate = 800_000 // 800 kbps
    } else if (sender.track?.kind === 'audio') {
      params.encodings[0].maxBitrate = 64_000 // 64 kbps
    }
    try {
      await sender.setParameters(params)
    } catch (e) {
      console.warn('Could not revert sender bitrate:', e)
    }
  }
}

/**
 * Toggle HD quality on the current call.
 */
export async function toggleHdQuality(): Promise<void> {
  if (!currentCall) return
  const store = useCallStore.getState()
  const newHd = !store.hdQuality
  store.setHdQuality(newHd)

  const isVideo = store.callInfo?.isVideo ?? false
  if (newHd) {
    await applyHdConstraints(currentCall, isVideo)
  } else {
    await applyStandardConstraints(currentCall, isVideo)
  }
}

/**
 * Toggle screen sharing on the current call.
 * Replaces the local video track with screen capture, or reverts to camera.
 */
export async function toggleScreenSharing(): Promise<void> {
  if (!currentCall) return

  const store = useCallStore.getState()
  const isCurrentlySharing = store.screenSharing

  if (isCurrentlySharing) {
    // Stop screen sharing — revert to camera
    try {
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        video: store.callInfo?.isVideo ? { width: { ideal: 640 }, height: { ideal: 480 } } : false,
        audio: false,
      })

      const pc = getPeerConnection(currentCall)
      if (pc) {
        const videoSender = pc.getSenders().find(s => s.track?.kind === 'video')
        if (videoSender && cameraStream.getVideoTracks()[0]) {
          await videoSender.replaceTrack(cameraStream.getVideoTracks()[0])
        }
      }

      // Update local stream
      const localFeed = currentCall.localUsermediaFeed
      if (localFeed?.stream) {
        const oldTrack = localFeed.stream.getVideoTracks()[0]
        if (oldTrack) {
          localFeed.stream.removeTrack(oldTrack)
          oldTrack.stop()
        }
        const newTrack = cameraStream.getVideoTracks()[0]
        if (newTrack) {
          localFeed.stream.addTrack(newTrack)
        }
      }

      store.setScreenSharing(false)
      updateStreamsFromCall(currentCall)
    } catch (err) {
      console.error('Failed to revert to camera:', err)
    }
  } else {
    // Start screen sharing
    let screenStream: MediaStream | null = null
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      })

      const screenTrack = screenStream.getVideoTracks()[0]
      if (!screenTrack) return

      // When user stops sharing via browser UI
      screenTrack.onended = () => {
        toggleScreenSharing() // Revert to camera
      }

      const pc = getPeerConnection(currentCall)
      if (pc) {
        const videoSender = pc.getSenders().find(s => s.track?.kind === 'video')
        if (videoSender) {
          await videoSender.replaceTrack(screenTrack)
        } else {
          // No video sender exists (audio-only call) — add the screen track
          pc.addTrack(screenTrack, screenStream)
        }
      }

      // Update local stream
      const localFeed = currentCall.localUsermediaFeed
      if (localFeed?.stream) {
        const oldTrack = localFeed.stream.getVideoTracks()[0]
        if (oldTrack) {
          localFeed.stream.removeTrack(oldTrack)
          oldTrack.stop()
        }
        localFeed.stream.addTrack(screenTrack)
      }

      store.setScreenSharing(true)
      updateStreamsFromCall(currentCall)
    } catch (err) {
      // User cancelled the screen picker, or an error occurred after acquiring the stream.
      // Stop any acquired tracks to release the screen capture.
      if (screenStream) {
        screenStream.getTracks().forEach(t => t.stop())
      }
      console.log('Screen sharing cancelled or failed:', err)
    }
  }
}

function endCallCleanup(): void {
  clearDurationInterval()
  if (currentCall) { currentCall.removeAllListeners() }
  const store = useCallStore.getState()

  // Stop all media tracks to release camera/microphone hardware
  store.localStream?.getTracks().forEach(t => t.stop())
  store.remoteStream?.getTracks().forEach(t => t.stop())

  store.setScreenSharing(false)
  store.setStatus('ended')

  // Brief delay to show "ended" state, then reset
  setTimeout(() => {
    useCallStore.getState().reset()
  }, 2000)

  currentCall = null
}

/**
 * Place an outgoing call (audio or video) to a room.
 */
export async function placeCall(roomId: string, isVideo: boolean): Promise<void> {
  if (voipDisabled) {
    console.error('VoIP is disabled due to SDK incompatibility — relay-only ICE cannot be enforced. Update SDK_PEER_CONN_FIELD or pin matrix-js-sdk.')
    return
  }

  const client = getMatrixClient()
  if (!client) {
    console.error('Matrix client not initialized')
    return
  }

  if (currentCall) {
    console.warn('A call is already in progress')
    return
  }

  const call = createNewMatrixCall(client, roomId)
  if (!call) {
    console.error('Failed to create call - WebRTC may not be supported')
    return
  }

  currentCall = call

  const opponentInfo = getOpponentInfo(call, roomId)

  useCallStore.getState().setCallInfo({
    callId: call.callId,
    roomId,
    isVideo,
    isIncoming: false,
    ...opponentInfo,
  })
  useCallStore.getState().setStatus('connecting')

  // attachCallListeners registers all event handlers including CallEvent.Error
  attachCallListeners(call)
  enforceRelayIcePolicy(call)

  try {
    if (isVideo) {
      await call.placeVideoCall()
    } else {
      await call.placeVoiceCall()
    }
    // Re-apply after call placement in case peerConn was recreated
    enforceRelayIcePolicy(call)
  } catch (err) {
    console.error('Failed to place call:', err)
    endCallCleanup()
  }
}

/**
 * Handle an incoming call from the CallEventHandler.
 */
export function handleIncomingCall(call: MatrixCall): void {
  if (voipDisabled) {
    console.error('VoIP is disabled due to SDK incompatibility — rejecting incoming call')
    call.reject()
    return
  }

  if (currentCall) {
    // Already in a call, reject the incoming one
    call.reject()
    return
  }

  currentCall = call
  const roomId = call.roomId
  const isVideo = call.type === CallType.Video
  const opponentInfo = getOpponentInfo(call, roomId)

  useCallStore.getState().setCallInfo({
    callId: call.callId,
    roomId,
    isVideo,
    isIncoming: true,
    ...opponentInfo,
  })
  useCallStore.getState().setStatus('ringing')

  attachCallListeners(call)
  enforceRelayIcePolicy(call)
}

/**
 * Answer an incoming call.
 */
export async function answerCall(): Promise<void> {
  if (!currentCall) return

  try {
    useCallStore.getState().setStatus('connecting')
    await currentCall.answer()
  } catch (err) {
    console.error('Failed to answer call:', err)
    endCallCleanup()
  }
}

/**
 * Reject an incoming call.
 */
export function rejectCall(): void {
  if (!currentCall) return
  currentCall.reject()
  endCallCleanup()
}

/**
 * Hang up the current call.
 */
export function hangupCall(): void {
  if (!currentCall) return
  currentCall.hangup(CallErrorCode.UserHangup, false)
  endCallCleanup()
}

/**
 * Toggle microphone mute.
 */
export async function toggleAudioMute(): Promise<void> {
  if (!currentCall) return

  const isMuted = currentCall.isMicrophoneMuted()
  await currentCall.setMicrophoneMuted(!isMuted)
  useCallStore.getState().setAudioMuted(!isMuted)
}

/**
 * Toggle video mute.
 */
export async function toggleVideoMute(): Promise<void> {
  if (!currentCall) return

  const isMuted = currentCall.isLocalVideoMuted()
  await currentCall.setLocalVideoMuted(!isMuted)
  useCallStore.getState().setVideoMuted(!isMuted)
}

/**
 * Get the current MatrixCall object.
 */
export function getCurrentCall(): MatrixCall | null {
  return currentCall
}

/**
 * Initialize incoming call listener on the Matrix client.
 * Should be called once after the client starts syncing.
 */
export function setupIncomingCallListener(): (() => void) | undefined {
  const client = getMatrixClient()
  if (!client) return

  const onIncomingCall = (call: MatrixCall) => {
    console.debug('Incoming call from:', call.getOpponentMember()?.userId)
    handleIncomingCall(call)
  }

  client.on(CallEventHandlerEvent.Incoming as any, onIncomingCall)

  return () => {
    client.removeListener(CallEventHandlerEvent.Incoming as any, onIncomingCall)
  }
}

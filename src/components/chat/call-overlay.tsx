'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useCallStore } from '@/stores/call-store'
import {
  answerCall,
  rejectCall,
  hangupCall,
  toggleAudioMute,
  toggleVideoMute,
  toggleHdQuality,
  toggleScreenSharing,
} from '@/lib/matrix/voip'
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Maximize,
  Minimize,
  Minimize2,
  Maximize2,
  Sparkles,
  Monitor,
} from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  const parts: string[] = []
  if (hrs > 0) parts.push(String(hrs).padStart(2, '0'))
  parts.push(String(mins).padStart(2, '0'))
  parts.push(String(secs).padStart(2, '0'))
  return parts.join(':')
}

function PipOverlay() {
  const {
    callInfo,
    status,
    audioMuted,
    remoteStream,
    duration,
    setIsMinimized,
  } = useCallStore()

  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const pipRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const el = remoteVideoRef.current
    if (el) el.srcObject = remoteStream ?? null
    return () => { if (el) el.srcObject = null }
  }, [remoteStream])

  const isVideo = callInfo?.isVideo
  const isConnected = status === 'connected'

  const statusText = status === 'ringing'
    ? callInfo?.isIncoming ? 'Incoming...' : 'Ringing...'
    : status === 'connecting'
      ? 'Connecting...'
      : isConnected
        ? formatDuration(duration)
        : status === 'ended'
          ? 'Ended'
          : ''

  // Drag handling
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = pipRef.current
    if (!el) return
    el.setPointerCapture(e.pointerId)
    const rect = el.getBoundingClientRect()
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top,
    }
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return
    const dx = e.clientX - dragState.current.startX
    const dy = e.clientY - dragState.current.startY
    setPosition({
      x: dragState.current.origX + dx,
      y: dragState.current.origY + dy,
    })
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragState.current || !pipRef.current) {
      dragState.current = null
      return
    }
    // Snap to nearest corner
    const el = pipRef.current
    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = 16

    const snapX = cx < vw / 2 ? margin : vw - rect.width - margin
    const snapY = cy < vh / 2 ? margin + 60 : vh - rect.height - margin // 60 for top bar clearance

    setPosition({ x: snapX, y: snapY })
    dragState.current = null
  }, [])

  const posStyle = position
    ? { left: position.x, top: position.y, right: 'auto' as const, bottom: 'auto' as const }
    : {}

  return (
    <div
      ref={pipRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={`fixed z-50 cursor-grab overflow-hidden rounded-2xl border border-white/20 shadow-2xl active:cursor-grabbing ${
        position ? '' : 'bottom-24 right-4'
      }`}
      style={{
        width: isVideo && remoteStream ? 160 : 200,
        height: isVideo && remoteStream ? 220 : 'auto',
        touchAction: 'none',
        ...posStyle,
      }}
    >
      {/* Video or avatar background */}
      {isVideo && remoteStream ? (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex flex-col items-center gap-2 bg-m3-surface-container-highest dark:bg-m3-surface p-4">
          <Avatar
            src={callInfo?.opponentAvatarUrl}
            name={callInfo?.opponentName || ''}
            size="md"
          />
          <p className="max-w-full truncate text-xs font-medium text-white">
            {callInfo?.opponentName}
          </p>
        </div>
      )}

      {/* Status bar */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-2 py-1.5">
        <span className={`text-[10px] font-medium ${status === 'ringing' ? 'animate-pulse text-green-400' : 'text-white/80'}`}>
          {statusText}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setIsMinimized(false) }}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-white transition-colors hover:bg-white/40"
          title="Expand"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Bottom controls */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-2 py-2">
        <button
          onClick={(e) => { e.stopPropagation(); toggleAudioMute() }}
          className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
            audioMuted ? 'bg-white text-m3-on-surface' : 'bg-white/20 text-white hover:bg-white/30'
          }`}
          title={audioMuted ? 'Unmute' : 'Mute'}
        >
          {audioMuted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); hangupCall() }}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-700"
          title="Hang up"
        >
          <PhoneOff className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

export function CallOverlay() {
  const {
    callInfo,
    status,
    audioMuted,
    videoMuted,
    localStream,
    remoteStream,
    duration,
    isFullscreen,
    isMinimized,
    hdQuality,
    screenSharing,
    setIsFullscreen,
    setIsMinimized,
  } = useCallStore()

  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Attach streams to video elements
  useEffect(() => {
    const el = localVideoRef.current
    if (el) el.srcObject = localStream ?? null
    return () => { if (el) el.srcObject = null }
  }, [localStream])

  useEffect(() => {
    const el = remoteVideoRef.current
    if (el) el.srcObject = remoteStream ?? null
    return () => { if (el) el.srcObject = null }
  }, [remoteStream])

  // Handle fullscreen changes
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [setIsFullscreen])

  if (!callInfo || status === 'idle') return null

  // Show PiP overlay when minimized (only for active/connected calls, not ringing incoming)
  if (isMinimized && status !== 'ended') {
    return <PipOverlay />
  }

  const isVideo = callInfo.isVideo
  const isIncoming = callInfo.isIncoming
  const isRinging = status === 'ringing'
  const isConnected = status === 'connected'
  const isEnded = status === 'ended'

  const handleToggleFullscreen = () => {
    if (!overlayRef.current) return
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      overlayRef.current.requestFullscreen()
    }
  }

  const handleMinimize = () => {
    // Exit fullscreen first if needed
    if (document.fullscreenElement) {
      document.exitFullscreen()
    }
    setIsMinimized(true)
  }

  const statusText = isRinging
    ? isIncoming ? 'Incoming call...' : 'Ringing...'
    : status === 'connecting'
      ? 'Connecting...'
      : isConnected
        ? formatDuration(duration)
        : isEnded
          ? 'Call ended'
          : ''

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm safe-area-pad"
    >
      <div className="relative flex h-full w-full max-h-screen flex-col items-center justify-center">
        {/* Remote video (full background) */}
        {isVideo && remoteStream && (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}

        {/* When no remote video, show avatar */}
        {(!isVideo || !remoteStream) && (
          <div className="flex flex-col items-center gap-4">
            <Avatar
              src={callInfo.opponentAvatarUrl}
              name={callInfo.opponentName}
              size="lg"
            />
            <h2 className="text-2xl font-bold text-white">
              {callInfo.opponentName}
            </h2>
            <p className="text-lg text-m3-outline-variant">
              {isVideo ? 'Video Call' : 'Voice Call'}
            </p>
          </div>
        )}

        {/* Status indicator */}
        <div className="absolute top-8 left-1/2 -translate-x-1/2">
          <div className="rounded-full bg-black/60 px-6 py-3 text-center backdrop-blur-sm">
            {isVideo && remoteStream && (
              <p className="text-sm font-medium text-white">{callInfo.opponentName}</p>
            )}
            <p className={`text-sm ${isRinging && isIncoming ? 'animate-pulse text-green-400' : 'text-m3-outline-variant'}`}>
              {statusText}
            </p>
          </div>
        </div>

        {/* Local video (picture-in-picture) */}
        {isVideo && localStream && (
          <div className="absolute top-20 right-6 h-36 w-28 overflow-hidden rounded-xl border-2 border-white/20 shadow-lg sm:h-48 sm:w-36">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full object-cover mirror"
              style={{ transform: 'scaleX(-1)' }}
            />
          </div>
        )}

        {/* Controls */}
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2">
          <div className="flex items-center gap-4">
            {/* Incoming call: accept/reject */}
            {isRinging && isIncoming && (
              <>
                <button
                  onClick={rejectCall}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition-transform hover:scale-110 hover:bg-red-700"
                  title="Reject"
                >
                  <PhoneOff className="h-7 w-7" />
                </button>
                <button
                  onClick={answerCall}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-green-600 text-white shadow-lg transition-transform hover:scale-110 hover:bg-green-500"
                  title="Accept"
                >
                  <Phone className="h-7 w-7" />
                </button>
              </>
            )}

            {/* Active call or outgoing ringing: mute controls + hangup */}
            {(!isRinging || !isIncoming) && !isEnded && (
              <>
                {/* Audio mute */}
                <button
                  onClick={toggleAudioMute}
                  className={`flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-110 ${
                    audioMuted
                      ? 'bg-white text-m3-on-surface'
                      : 'bg-white/20 text-white hover:bg-white/30'
                  }`}
                  title={audioMuted ? 'Unmute microphone' : 'Mute microphone'}
                >
                  {audioMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
                </button>

                {/* Video mute (only for video calls) */}
                {isVideo && (
                  <button
                    onClick={toggleVideoMute}
                    className={`flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-110 ${
                      videoMuted
                        ? 'bg-white text-m3-on-surface'
                        : 'bg-white/20 text-white hover:bg-white/30'
                    }`}
                    title={videoMuted ? 'Turn on camera' : 'Turn off camera'}
                  >
                    {videoMuted ? <VideoOff className="h-6 w-6" /> : <Video className="h-6 w-6" />}
                  </button>
                )}

                {/* HD quality toggle */}
                {isConnected && (
                  <button
                    onClick={toggleHdQuality}
                    className={`flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-110 ${
                      hdQuality
                        ? 'bg-m3-primary text-white'
                        : 'bg-white/20 text-white hover:bg-white/30'
                    }`}
                    title={hdQuality ? 'Switch to standard quality' : 'Switch to HD quality'}
                  >
                    <Sparkles className="h-6 w-6" />
                  </button>
                )}

                {/* Screen share toggle */}
                {isConnected && (
                  <button
                    onClick={toggleScreenSharing}
                    className={`flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-110 ${
                      screenSharing
                        ? 'bg-m3-primary text-white'
                        : 'bg-white/20 text-white hover:bg-white/30'
                    }`}
                    title={screenSharing ? 'Stop sharing screen' : 'Share screen'}
                  >
                    <Monitor className="h-6 w-6" />
                  </button>
                )}

                {/* Minimize to PiP */}
                <button
                  onClick={handleMinimize}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20 text-white shadow-lg transition-transform hover:scale-110 hover:bg-white/30"
                  title="Minimize to picture-in-picture"
                >
                  <Minimize2 className="h-6 w-6" />
                </button>

                {/* Fullscreen toggle */}
                <button
                  onClick={handleToggleFullscreen}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20 text-white shadow-lg transition-transform hover:scale-110 hover:bg-white/30"
                  title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                >
                  {isFullscreen ? <Minimize className="h-6 w-6" /> : <Maximize className="h-6 w-6" />}
                </button>

                {/* Hang up */}
                <button
                  onClick={hangupCall}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition-transform hover:scale-110 hover:bg-red-700"
                  title="Hang up"
                >
                  <PhoneOff className="h-7 w-7" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

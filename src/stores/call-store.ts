'use client'

import { create } from 'zustand'

export type CallStatus = 'idle' | 'ringing' | 'connecting' | 'connected' | 'ended'

export interface CallInfo {
  callId: string
  roomId: string
  isVideo: boolean
  isIncoming: boolean
  opponentName: string
  opponentAvatarUrl: string | null
  opponentUserId: string
}

interface CallState {
  // Current call info
  callInfo: CallInfo | null
  status: CallStatus

  // Mute state
  audioMuted: boolean
  videoMuted: boolean

  // Streams
  localStream: MediaStream | null
  remoteStream: MediaStream | null

  // Call duration in seconds
  duration: number

  // Fullscreen
  isFullscreen: boolean

  // Minimized (PiP mode)
  isMinimized: boolean

  // HD quality mode
  hdQuality: boolean

  // Screen sharing
  screenSharing: boolean

  // Actions
  setCallInfo: (info: CallInfo | null) => void
  setStatus: (status: CallStatus) => void
  setAudioMuted: (muted: boolean) => void
  setVideoMuted: (muted: boolean) => void
  setLocalStream: (stream: MediaStream | null) => void
  setRemoteStream: (stream: MediaStream | null) => void
  setDuration: (duration: number) => void
  setIsFullscreen: (fullscreen: boolean) => void
  setIsMinimized: (minimized: boolean) => void
  setHdQuality: (hd: boolean) => void
  setScreenSharing: (sharing: boolean) => void
  reset: () => void
}

const initialState = {
  callInfo: null,
  status: 'idle' as CallStatus,
  audioMuted: false,
  videoMuted: false,
  localStream: null,
  remoteStream: null,
  duration: 0,
  isFullscreen: false,
  isMinimized: false,
  hdQuality: false,
  screenSharing: false,
}

export const useCallStore = create<CallState>((set) => ({
  ...initialState,

  setCallInfo: (info) => set({ callInfo: info }),
  setStatus: (status) => set({ status }),
  setAudioMuted: (muted) => set({ audioMuted: muted }),
  setVideoMuted: (muted) => set({ videoMuted: muted }),
  setLocalStream: (stream) => set({ localStream: stream }),
  setRemoteStream: (stream) => set({ remoteStream: stream }),
  setDuration: (duration) => set({ duration }),
  setIsFullscreen: (fullscreen) => set({ isFullscreen: fullscreen }),
  setIsMinimized: (minimized) => set({ isMinimized: minimized }),
  setHdQuality: (hd) => set({ hdQuality: hd }),
  setScreenSharing: (sharing) => set({ screenSharing: sharing }),
  reset: () => set(initialState),
}))

/**
 * Play a short notification chime using the Web Audio API.
 * No external audio file needed — synthesises a pleasant two-tone ping.
 *
 * AudioContext is only created after a user gesture to avoid browser warnings:
 * "The AudioContext was not allowed to start."
 */

let audioCtx: AudioContext | null = null
let userHasInteracted = false

// Track whether the user has interacted with the page.
// AudioContext can only start after a user gesture.
if (typeof window !== 'undefined') {
  const markInteracted = () => {
    userHasInteracted = true
    // If we already have a suspended context, resume it now
    if (audioCtx?.state === 'suspended') {
      audioCtx.resume().catch(() => {})
    }
    window.removeEventListener('click', markInteracted)
    window.removeEventListener('keydown', markInteracted)
    window.removeEventListener('touchstart', markInteracted)
  }
  window.addEventListener('click', markInteracted)
  window.addEventListener('keydown', markInteracted)
  window.addEventListener('touchstart', markInteracted)
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  // Do not create an AudioContext until the user has interacted
  if (!userHasInteracted) return null
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {})
  }
  return audioCtx
}

export function playNotificationSound(): void {
  const ctx = getAudioContext()
  if (!ctx || ctx.state === 'suspended') return
  scheduleChime(ctx)
}

function scheduleChime(ctx: AudioContext): void {
  const now = ctx.currentTime

  // Two-tone chime: C6 -> E6
  const frequencies = [1047, 1319]
  const duration = 0.12
  const gap = 0.08

  frequencies.forEach((freq, i) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.value = freq

    const start = now + i * (duration + gap)
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.15, start + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(start)
    osc.stop(start + duration)
  })
}

/**
 * Play a subtle "seen" confirmation sound -- a short soft click.
 */
export function playSeenSound(): void {
  const ctx = getAudioContext()
  if (!ctx || ctx.state === 'suspended') return
  scheduleSeenClick(ctx)
}

function scheduleSeenClick(ctx: AudioContext): void {
  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = 'sine'
  osc.frequency.value = 1568 // G6

  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(0.08, now + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06)

  osc.connect(gain)
  gain.connect(ctx.destination)

  osc.start(now)
  osc.stop(now + 0.06)
}

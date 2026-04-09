'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Play, Pause, ChevronLeft, ChevronRight, Download, X } from 'lucide-react'

export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [loaded, setLoaded] = useState(false)
  const [scale, setScale] = useState(1)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === '+' || e.key === '=') setScale(prev => Math.min(5, prev + 0.25))
      if (e.key === '-') { setScale(prev => { const ns = Math.max(1, prev - 0.25); if (ns === 1) setTranslate({ x: 0, y: 0 }); return ns }); }
      if (e.key === '0') { setScale(1); setTranslate({ x: 0, y: 0 }) }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation()
    const delta = e.deltaY > 0 ? -0.15 : 0.15
    setScale(prev => {
      const ns = Math.min(5, Math.max(1, prev + delta))
      if (ns === 1) setTranslate({ x: 0, y: 0 })
      return ns
    })
  }

  // Mouse drag to pan when zoomed
  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
    setDragStart({ x: e.clientX, y: e.clientY, tx: translate.x, ty: translate.y })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !dragStart) return
    e.stopPropagation()
    setTranslate({
      x: dragStart.tx + (e.clientX - dragStart.x),
      y: dragStart.ty + (e.clientY - dragStart.y),
    })
  }

  const handleMouseUp = () => {
    setDragging(false)
    setDragStart(null)
  }

  // Touch: swipe down to close (when not zoomed), pinch to zoom
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && scale <= 1) {
      setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY, tx: 0, ty: 0 })
    } else if (e.touches.length === 1 && scale > 1) {
      setDragging(true)
      setDragStart({ x: e.touches[0].clientX, y: e.touches[0].clientY, tx: translate.x, ty: translate.y })
    }
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (dragging && dragStart && e.touches.length === 1) {
      setTranslate({
        x: dragStart.tx + (e.touches[0].clientX - dragStart.x),
        y: dragStart.ty + (e.touches[0].clientY - dragStart.y),
      })
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (dragStart && !dragging && e.changedTouches.length === 1) {
      const dy = e.changedTouches[0].clientY - dragStart.y
      if (dy > 100 && scale <= 1) onClose()
    }
    setDragging(false)
    setDragStart(null)
  }

  // Double click to toggle zoom
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (scale > 1) {
      setScale(1)
      setTranslate({ x: 0, y: 0 })
    } else {
      setScale(2.5)
    }
  }

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation()
    const a = document.createElement('a')
    a.href = src
    a.download = alt || 'image'
    a.click()
  }

  const zoomIn = (e: React.MouseEvent) => { e.stopPropagation(); setScale(prev => Math.min(5, prev + 0.5)) }
  const zoomOut = (e: React.MouseEvent) => { e.stopPropagation(); setScale(prev => { const ns = Math.max(1, prev - 0.5); if (ns === 1) setTranslate({ x: 0, y: 0 }); return ns }) }
  const resetZoom = (e: React.MouseEvent) => { e.stopPropagation(); setScale(1); setTranslate({ x: 0, y: 0 }) }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gallery-backdrop bg-black/90 animate-fade-in select-none"
      onClick={scale <= 1 ? onClose : undefined}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      role="dialog"
      aria-label="Image preview"
      style={{ cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'pointer' }}
    >
      {/* Gallery toolbar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3" onClick={e => e.stopPropagation()}>
        <p className="text-sm text-white/70 truncate max-w-[60%]">{alt}</p>
        <div className="flex items-center gap-1">
          <button onClick={zoomOut} className="flex h-10 w-10 items-center justify-center rounded-full text-white/70 hover:bg-white/10 transition-colors text-lg font-bold" title="Zoom out (-)">−</button>
          <button onClick={resetZoom} className="flex h-10 min-w-[3rem] items-center justify-center rounded-full text-white/70 hover:bg-white/10 transition-colors text-xs font-medium" title="Reset zoom (0)">{Math.round(scale * 100)}%</button>
          <button onClick={zoomIn} className="flex h-10 w-10 items-center justify-center rounded-full text-white/70 hover:bg-white/10 transition-colors text-lg font-bold" title="Zoom in (+)">+</button>
          <div className="w-px h-5 bg-white/20 mx-1" />
          <button onClick={handleDownload} className="flex h-10 w-10 items-center justify-center rounded-full text-white/70 hover:bg-white/10 transition-colors" title="Download">
            <Download className="h-5 w-5" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onClose() }} className="flex h-10 w-10 items-center justify-center rounded-full text-white/70 hover:bg-white/10 transition-colors" title="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-white/60" />
        </div>
      )}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={`gallery-image-enter max-h-[85vh] max-w-[90vw] object-contain rounded-lg shadow-2xl transition-transform duration-150 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        style={{ transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)` }}
        onLoad={() => setLoaded(true)}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        onClick={e => e.stopPropagation()}
        draggable={false}
      />
    </div>,
    document.body
  )
}

function WaveformBars({ progress, isOwn, barCount = 40 }: { progress: number; isOwn: boolean; barCount?: number }) {
  // Generate deterministic "random" bar heights using a seed
  const bars = useMemo(() => {
    const result: number[] = []
    let seed = 42
    for (let i = 0; i < barCount; i++) {
      seed = (seed * 16807 + 0) % 2147483647
      result.push(0.15 + (seed % 100) / 100 * 0.85)
    }
    return result
  }, [barCount])

  return (
    <div className="flex items-center gap-[2px] h-8 w-full">
      {bars.map((height, i) => {
        const filled = i / barCount <= progress
        return (
          <div
            key={i}
            className={`flex-1 rounded-full transition-colors duration-150 ${
              filled
                ? isOwn ? 'bg-white/90' : 'bg-m3-primary'
                : isOwn ? 'bg-white/30' : 'bg-m3-outline-variant'
            }`}
            style={{ height: `${height * 100}%` }}
          />
        )
      })}
    </div>
  )
}

/** Custom inline voice/audio player that works inside colored bubbles */
export function VoicePlayer({ src, isOwn, duration: durationMs }: { src: string; isOwn: boolean; duration?: number }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(() => (durationMs ? durationMs / 1000 : 0))

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onTime = () => {
      if (a.duration && isFinite(a.duration)) {
        setProgress(a.currentTime / a.duration)
        setDuration(a.duration)
      }
    }
    const onEnd = () => { setPlaying(false); setProgress(0) }
    const onLoaded = () => { if (a.duration && isFinite(a.duration)) setDuration(a.duration) }
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('ended', onEnd)
    a.addEventListener('loadedmetadata', onLoaded)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('ended', onEnd)
      a.removeEventListener('loadedmetadata', onLoaded)
    }
  }, [])

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (playing) { a.pause(); setPlaying(false) }
    else { a.play(); setPlaying(true) }
  }

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current
    if (!a || !a.duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    a.currentTime = ratio * a.duration
    setProgress(ratio)
  }

  const fmt = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const textColor = isOwn ? 'text-white' : 'text-m3-on-surface dark:text-m3-on-surface'
  const subColor = isOwn ? 'text-white/70' : 'text-m3-on-surface-variant dark:text-m3-outline'

  return (
    <div className="flex items-center gap-3 min-w-[220px]">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button onClick={toggle} className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${isOwn ? 'bg-white/20 hover:bg-white/30' : 'bg-m3-surface-container hover:bg-m3-surface-container-high dark:bg-m3-surface-container-highest dark:hover:bg-m3-outline-variant'} transition-colors`}>
        {playing
          ? <Pause className={`h-5 w-5 ${textColor}`} />
          : <Play className={`h-5 w-5 ${textColor} ml-0.5`} />
        }
      </button>
      <div className="flex flex-1 flex-col gap-1 cursor-pointer" onClick={seek}>
        <WaveformBars progress={progress} isOwn={isOwn} />
        <span className={`text-[11px] ${subColor}`}>
          {playing ? fmt(progress * duration) : fmt(duration)}
        </span>
      </div>
    </div>
  )
}

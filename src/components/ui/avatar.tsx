'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchCachedThumbnail } from '@/lib/matrix/media'

interface AvatarProps {
  src?: string | null
  name: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  status?: 'online' | 'offline' | 'away' | null
}

const sizeMap = {
  sm: 'h-7 w-7 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-16 w-16 text-lg',
  xl: 'h-24 w-24 text-2xl',
}

const statusSizeMap = {
  sm: 'h-2.5 w-2.5 right-0 bottom-0',
  md: 'h-3 w-3 right-0 bottom-0',
  lg: 'h-3.5 w-3.5 right-0.5 bottom-0.5',
  xl: 'h-4 w-4 right-1 bottom-1',
}

const statusColorMap = {
  online: 'bg-green-500',
  away: 'bg-yellow-500',
  offline: 'bg-gray-500',
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function getAvatarColor(name: string) {
  const colors = [
    'bg-indigo-600',
    'bg-purple-600',
    'bg-pink-600',
    'bg-rose-600',
    'bg-orange-600',
    'bg-amber-600',
    'bg-emerald-600',
    'bg-teal-600',
    'bg-cyan-600',
    'bg-blue-600',
  ]
  const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return colors[hash % colors.length]
}

function InitialsFallback({ name, size }: { name: string; size: 'sm' | 'md' | 'lg' | 'xl' }) {
  return (
    <div
      className={`${sizeMap[size]} ${getAvatarColor(name)} flex items-center justify-center rounded-full font-medium text-white`}
    >
      {getInitials(name)}
    </div>
  )
}

/**
 * Detect simple placeholder/icon avatars like Signal's default dashed-circle.
 * Uses two heuristics:
 * 1. Color bucket count — placeholders have very few distinct colors
 * 2. Dominant color ratio — placeholders are mostly one color (background)
 * Also detects very small or mostly-transparent images.
 */
function isPlaceholderImage(img: HTMLImageElement): boolean {
  try {
    if (img.naturalWidth < 5 || img.naturalHeight < 5) return true

    const canvas = document.createElement('canvas')
    const s = 16
    canvas.width = s
    canvas.height = s
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return false
    ctx.drawImage(img, 0, 0, s, s)
    const { data } = ctx.getImageData(0, 0, s, s)

    const totalPixels = s * s
    let transparentPixels = 0
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 50) transparentPixels++
    }
    if (transparentPixels > totalPixels * 0.9) return true

    // Bucket each pixel's RGB into a 4x4x4 grid (64 possible buckets)
    // and track the most common bucket
    const bucketCounts = new Map<number, number>()
    let opaquePixels = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 50) continue
      opaquePixels++
      const bucket = ((data[i] >> 6) << 4) | ((data[i + 1] >> 6) << 2) | (data[i + 2] >> 6)
      bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1)
    }

    // Extremely few colors (≤2) — definitely a placeholder (solid color / dashed icon)
    if (bucketCounts.size <= 2) return true

    // If one color dominates 95%+ of opaque pixels with very few total colors,
    // it's almost certainly a generated icon/placeholder, not a real photo
    if (opaquePixels > 0) {
      let maxCount = 0
      for (const count of bucketCounts.values()) {
        if (count > maxCount) maxCount = count
      }
      if (maxCount / opaquePixels > 0.95 && bucketCounts.size <= 4) return true
    }

    return false
  } catch {
    return false
  }
}

export function Avatar({ src, name, size = 'md', status }: AvatarProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [imgError, setImgError] = useState(false)

  useEffect(() => {
    if (!src) {
      setBlobUrl(null)
      return
    }

    // If it's an MXC URL, fetch via authenticated endpoint
    if (src.startsWith('mxc://')) {
      let cancelled = false
      fetchCachedThumbnail(src, size === 'xl' ? 192 : 96, size === 'xl' ? 192 : 96)
        .then(url => {
          if (!cancelled) {
            setBlobUrl(url)
            setImgError(false)
          }
        })
        .catch((err) => {
          console.debug('[Avatar] fetch failed:', src, err?.message || err)
          if (!cancelled) setImgError(true)
        })
      return () => { cancelled = true }
    }

    // For non-MXC URLs (blob:, data:, https:), use directly
    setBlobUrl(src)
    setImgError(false)
  }, [src, size])

  const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    if (isPlaceholderImage(e.currentTarget)) {
      console.debug('[Avatar] placeholder detected, falling back to initials:', src)
      setImgError(true)
    }
  }, [src])

  const displayUrl = blobUrl

  return (
    <div className="relative flex-shrink-0">
      {displayUrl && !imgError ? (
        <img
          src={displayUrl}
          alt={name}
          className={`${sizeMap[size]} rounded-full object-cover transition-opacity duration-150`}
          onLoad={handleLoad}
          onError={() => setImgError(true)}
        />
      ) : (
        <InitialsFallback name={name} size={size} />
      )}
      {status && (
        <span
          className={`absolute ${statusSizeMap[size]} ${statusColorMap[status]} rounded-full border-2 border-white dark:border-m3-surface ${
            status === 'online' ? 'presence-online' : status === 'away' ? 'presence-away' : ''
          }`}
          title={status === 'online' ? 'Online' : status === 'away' ? 'Away' : 'Offline'}
        />
      )}
    </div>
  )
}

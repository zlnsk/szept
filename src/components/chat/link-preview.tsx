'use client'

import { useState, useEffect } from 'react'
import { getMatrixClient } from '@/lib/matrix/client'
import { fetchUrlPreview } from '@/lib/matrix/media'
import { ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'

// Session-scoped in-memory cache for link previews — prevents redundant
// homeserver requests when the same URL appears multiple times or the
// component remounts during scrolling.
const PREVIEW_CACHE_MAX = 200
const previewCache = new Map<string, {
  title?: string
  description?: string
  imageUrl?: string
  siteName?: string
} | null>()

interface LinkPreviewProps {
  url: string
}

export function LinkPreview({ url }: LinkPreviewProps) {
  const [preview, setPreview] = useState<{
    title?: string
    description?: string
    imageUrl?: string
    siteName?: string
  } | null>(() => previewCache.get(url) ?? null)
  const [error, setError] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [isLoading, setIsLoading] = useState(!previewCache.has(url))

  useEffect(() => {
    // If already cached, use it immediately
    if (previewCache.has(url)) {
      const cached = previewCache.get(url) ?? null
      setPreview(cached)
      if (!cached) setError(true)
      setIsLoading(false)
      return
    }

    let cancelled = false

    async function doFetch() {
      try {
        const data = await fetchUrlPreview(url)
        if (cancelled) return

        if (data) {
          let imageUrl: string | undefined
          if (data['og:image'] && typeof data['og:image'] === 'string') {
            // og:image might be an mxc URL if the server cached it
            const client = getMatrixClient()
            if (data['og:image'].startsWith('mxc://') && client) {
              imageUrl = client.mxcUrlToHttp(data['og:image']) || undefined
            } else {
              imageUrl = data['og:image']
            }
          }

          const result = {
            title: data['og:title'] as string | undefined,
            description: data['og:description'] as string | undefined,
            imageUrl,
            siteName: data['og:site_name'] as string | undefined,
          }
          previewCache.set(url, result)
          if (previewCache.size > PREVIEW_CACHE_MAX) {
            const first = previewCache.keys().next()
            if (!first.done) previewCache.delete(first.value)
          }
          setPreview(result)
        } else {
          previewCache.set(url, null)
          setError(true)
        }
      } catch {
        previewCache.set(url, null)
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    doFetch()
    return () => { cancelled = true }
  }, [url])

  // Loading skeleton
  if (isLoading && !error) {
    return (
      <div className="mt-2 overflow-hidden rounded-xl border border-m3-outline-variant/30 bg-m3-surface-container-low/50 dark:border-m3-outline-variant/30 dark:bg-m3-surface-container-high/40">
        <div className="animate-skeleton h-20 bg-m3-surface-container" />
        <div className="px-3 py-2.5 space-y-2">
          <div className="animate-skeleton h-3 w-24 rounded bg-m3-surface-container" />
          <div className="animate-skeleton h-4 w-3/4 rounded bg-m3-surface-container" />
          <div className="animate-skeleton h-3 w-full rounded bg-m3-surface-container" />
        </div>
      </div>
    )
  }

  // Error fallback — show a minimal link chip instead of nothing
  if (error) {
    try {
      const hostname = new URL(url).hostname
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-m3-outline-variant/30 bg-m3-surface-container-low/50 px-3 py-1.5 text-xs text-m3-outline transition-colors hover:bg-m3-surface-container dark:border-m3-outline-variant/30 dark:bg-m3-surface-container-high/40 dark:hover:bg-m3-surface-container-high"
        >
          <ExternalLink className="h-3 w-3" />
          <span className="truncate max-w-[200px]">{hostname}</span>
        </a>
      )
    } catch {
      return null
    }
  }

  if (!preview || (!preview.title && !preview.description)) return null

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-m3-outline-variant/30 bg-m3-surface-container-low/50 shadow-sm transition-all duration-150 dark:border-m3-outline-variant/30 dark:bg-m3-surface-container-high/40 dark:shadow-none">
      {/* Collapse toggle */}
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCollapsed(!collapsed) }}
        className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-m3-outline hover:bg-m3-surface-container/50 transition-colors"
      >
        <span className="flex items-center gap-1">
          <ExternalLink className="h-3 w-3" />
          {preview.siteName || new URL(url).hostname}
        </span>
        {collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
      </button>
      {!collapsed && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high transition-colors"
        >
          {preview.imageUrl && (
            <img
              src={preview.imageUrl}
              alt=""
              className="h-32 w-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          )}
          <div className="px-3 py-2">
            {preview.title && (
              <p className="text-sm font-semibold text-m3-on-surface dark:text-m3-on-surface line-clamp-2">{preview.title}</p>
            )}
            {preview.description && (
              <p className="mt-1 text-xs text-m3-on-surface-variant dark:text-m3-outline line-clamp-2">{preview.description}</p>
            )}
          </div>
        </a>
      )}
    </div>
  )
}

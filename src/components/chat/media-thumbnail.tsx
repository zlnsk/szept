'use client'

import { useState, useRef, useEffect } from 'react'
import { Loader2, Video } from 'lucide-react'
import { decryptMediaAttachment, fetchAuthenticatedMedia } from '@/lib/matrix/media'
import type { MatrixMessage } from '@/stores/chat-store'

export function MediaThumbnail({ message }: { message: MatrixMessage }) {
  const [decryptedUrl, setDecryptedUrl] = useState<string | null>(null)
  const blobUrlRef = useRef<string | null>(null)

  useEffect(() => {
    if (!message.mediaUrl) return
    let cancelled = false

    async function loadMedia() {
      try {
        let url: string
        if (message.encryptedFile) {
          url = await decryptMediaAttachment(
            message.encryptedFile.url,
            message.encryptedFile,
            message.mediaInfo?.mimetype
          )
        } else {
          url = await fetchAuthenticatedMedia(message.mediaUrl!, message.mediaInfo?.mimetype)
        }
        if (!cancelled) {
          blobUrlRef.current = url
          setDecryptedUrl(url)
        } else if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url)
        }
      } catch (err) {
        console.error('Failed to load media thumbnail:', err)
      }
    }
    loadMedia()

    return () => {
      cancelled = true
      if (blobUrlRef.current?.startsWith('blob:')) URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
  }, [message.eventId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!decryptedUrl) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-m3-surface-container-high dark:bg-m3-surface-container-highest">
        <Loader2 className="h-4 w-4 animate-spin text-m3-outline" />
      </div>
    )
  }

  if (message.type === 'm.image') {
    return (
      <a href={decryptedUrl} target="_blank" rel="noopener noreferrer" className="block h-full w-full">
        <img src={decryptedUrl} alt="" className="h-full w-full object-cover transition-transform hover:scale-110" />
      </a>
    )
  }

  return (
    <a href={decryptedUrl} target="_blank" rel="noopener noreferrer" className="flex h-full w-full items-center justify-center">
      <Video className="h-6 w-6 text-m3-outline" />
    </a>
  )
}

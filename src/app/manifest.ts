import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Messages',
    short_name: 'Messages',
    description: 'Matrix messaging client',
    start_url: '/Messages/',
    scope: '/Messages/',
    display: 'standalone',
    background_color: '#f8f9fc',
    theme_color: '#1a73e8',
    orientation: 'any',
    icons: [
      { src: '/Messages/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/Messages/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' as any },
    ],
  }
}

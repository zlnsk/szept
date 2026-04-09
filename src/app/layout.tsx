import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { ThemeProvider } from '@/components/providers/theme-provider'
import { AuthProvider } from '@/components/providers/auth-provider'
import { RealtimeProvider } from '@/components/providers/realtime-provider'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import './globals.css'

export const metadata: Metadata = {
  title: 'Messages — Secure Messaging',
  description: 'End-to-end encrypted messaging powered by the Matrix protocol',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Messages',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
  icons: {
    apple: '/apple-touch-icon.png',
  },
  manifest: '/Messages/manifest.webmanifest',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  interactiveWidget: 'resizes-content',
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#1a73e8' },
    { media: '(prefers-color-scheme: dark)', color: '#1f1f1f' },
  ],
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const nonce = (await headers()).get('x-nonce') ?? ''

  return (
    <html lang="en" className="h-dvh">
      <head>
      </head>
      <body className="h-dvh overflow-hidden antialiased bg-m3-surface" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <ErrorBoundary>
          <ThemeProvider>
            <AuthProvider>
              <RealtimeProvider>
                {children}
              </RealtimeProvider>
            </AuthProvider>
          </ThemeProvider>
        </ErrorBoundary>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator)navigator.serviceWorker.register('/Messages/sw.js').catch(function(){})`,
          }}
        />
      </body>
    </html>
  )
}

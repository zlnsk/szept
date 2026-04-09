'use client'

import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="rounded-full bg-red-100 p-4 dark:bg-red-900/30">
            <svg className="h-8 w-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-m3-on-surface dark:text-m3-on-surface">Something went wrong</h3>
            <p className="mt-1 text-sm text-m3-on-surface-variant">An unexpected error occurred. Please try again or reload the page.</p>
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="rounded-lg bg-m3-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-m3-primary/90"
          >
            Try again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

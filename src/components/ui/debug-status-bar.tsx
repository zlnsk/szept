'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { getMatrixClient } from '@/lib/matrix/client'

type ConnectionState = 'connected' | 'reconnecting' | 'offline'
interface LogEntry {
  time: string
  type: 'send' | 'recv' | 'error' | 'info'
  message: string
}

const MAX_LOG = 200
const logEntries: LogEntry[] = []

let _lastLogMsg = ""
function addLog(type: LogEntry['type'], message: string) {
  if (message === _lastLogMsg && type !== "error") return
  _lastLogMsg = message
  logEntries.unshift({
    time: new Date().toLocaleTimeString(),
    type,
    message,
  })
  if (logEntries.length > MAX_LOG) logEntries.pop()
}

// Export so other components could log if needed
export { addLog as debugLog }

const stateConfig: Record<ConnectionState, { color: string; label: string }> = {
  connected: { color: 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.5)]', label: 'Connected' },
  reconnecting: { color: 'bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.5)]', label: 'Reconnecting' },
  offline: { color: 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.5)]', label: 'Offline' },
}

export function DebugStatusBar() {
  const [connState, setConnState] = useState<ConnectionState>('connected')
  const [activityType, setActivityType] = useState<string>('')
  const [activity, setActivity] = useState<string>('')
  const [showPanel, setShowPanel] = useState(false)
  const [, setTick] = useState(0)
  const connRef = useRef(connState)
  const panelRef = useRef<HTMLDivElement>(null)
  const logBtnRef = useRef<HTMLButtonElement>(null)
  connRef.current = connState

  const refreshPanel = useCallback(() => setTick(t => t + 1), [])

  // Click-outside handler
  useEffect(() => {
    if (!showPanel) return
    function handleClick(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        logBtnRef.current && !logBtnRef.current.contains(e.target as Node)
      ) {
        setShowPanel(false)
      }
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [showPanel])

  useEffect(() => {
    const client = getMatrixClient()
    if (!client) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onSync = (syncState: string, _prevState: string | null, data?: any) => {
      if (syncState === 'SYNCING' || syncState === 'PREPARED') {
        setConnState('connected')
        setActivityType('sync')
        setActivity('Sync OK')
        addLog('recv', 'Sync OK')
      } else if (syncState === 'RECONNECTING') {
        setConnState('reconnecting')
        setActivityType('sync')
        setActivity('Reconnecting...')
        addLog('info', 'Reconnecting to homeserver')
      } else if (syncState === 'ERROR' || syncState === 'STOPPED') {
        setConnState('offline')
        setActivityType('sync')
        const errMsg = data?.error?.message || data?.error?.toString?.() || ''
        const httpCode = data?.error?.httpStatus ? ` HTTP ${data.error.httpStatus}` : ''
        setActivity(`Sync ${syncState}${errMsg ? ': ' + errMsg.slice(0, 60) : ''}${httpCode}`)
        addLog('error', `Sync ${syncState}${errMsg ? ': ' + errMsg : ''}${httpCode}`)
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onEvent = (event: any) => {
      try {
        const type = event.getType?.() || 'unknown'
        const sender = event.getSender?.() || ''
        const roomId = event.getRoomId?.() || ''
        const shortRoom = roomId.split(':')[0]?.slice(1) || roomId

        if (type === 'm.room.message') {
          const userId = client.getUserId?.() || ''
          if (sender === userId) {
            addLog('send', `Message sent to ${shortRoom}`)
            setActivityType('send')
            setActivity(`Sent to ${shortRoom}`)
          } else {
            const senderShort = sender.split(':')[0]?.slice(1) || sender
            addLog('recv', `Message from ${senderShort} in ${shortRoom}`)
            setActivityType('recv')
            setActivity(`From ${senderShort}`)
          }
        } else if (type === 'm.room.member') {
          addLog('info', `Member event in ${shortRoom}`)
        } else if (type === 'm.reaction') {
          addLog('info', `Reaction in ${shortRoom}`)
        }
      } catch {
        // ignore parse errors on events
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onError = (err: any) => {
      const msg = err?.message || String(err)
      addLog('error', msg)
      setActivityType('error')
      setActivity(`Error: ${msg.slice(0, 60)}`)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.on('sync' as any, onSync)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.on('event' as any, onEvent)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.on('sync.error' as any, onError)

    const onOnline = () => { addLog('info', 'Browser online'); setActivityType('info'); setActivity('Browser online') }
    const onOffline = () => { addLog('error', 'Browser offline'); setConnState('offline'); setActivityType('error'); setActivity('Browser offline') }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)

    addLog('info', 'Status bar initialized')

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.removeListener('sync' as any, onSync)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.removeListener('event' as any, onEvent)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.removeListener('sync.error' as any, onError)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const handleCopy = useCallback(() => {
    const text = logEntries.map(e => `${e.time} [${e.type}] ${e.message}`).join('\n')
    navigator.clipboard.writeText(text)
  }, [])


  const typeColors: Record<string, string> = {
    send: 'text-blue-500',
    recv: 'text-green-600 dark:text-green-400',
    error: 'text-red-500',
    info: 'text-gray-500 dark:text-gray-400',
  }

  return (
    <>
      <button
        ref={logBtnRef}
        onClick={() => { setShowPanel(!showPanel); refreshPanel() }}
        className="fixed bottom-2 right-2 z-50 px-2.5 py-1 rounded-lg text-[10px] font-mono border border-black/10 dark:border-white/15 bg-white/80 dark:bg-[#1e1e1e]/80 backdrop-blur hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        style={{ color: 'var(--tw-prose-body, #6b7280)' }}
        title="Debug log"
      >
        Log
      </button>

      {showPanel && (
        <div
          ref={panelRef}
          className="fixed bottom-7 right-4 z-[60] flex flex-col rounded-t-xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#1e1e1e] shadow-xl"
          style={{ width: 500, maxWidth: 'calc(100vw - 32px)', maxHeight: 400 }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-black/[0.08] dark:border-white/[0.08] text-xs font-medium">
            <span>Activity Log</span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="px-2 py-px rounded text-[10px] border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                title="Copy log to clipboard"
              >
                Copy
              </button>
              <button onClick={() => setShowPanel(false)} className="text-lg leading-none opacity-60 hover:opacity-100">&times;</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2 text-[11px] font-mono leading-relaxed" style={{ maxHeight: 360 }}>
            {logEntries.length === 0 && <div className="opacity-40 text-center py-4">No activity yet</div>}
            {logEntries.map((e, i) => (
              <div key={i} className="py-0.5 border-b border-black/[0.04] dark:border-white/[0.04]">
                <span className="opacity-50 mr-2">{e.time}</span>
                <span className={`font-semibold mr-1.5 ${typeColors[e.type] || ''}`}>{e.type}</span>
                {e.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

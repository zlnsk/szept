'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ShieldCheck, ShieldAlert, Loader2, CheckCircle2, XCircle, ArrowLeft } from 'lucide-react'
import type {
  VerificationRequest,
  ShowSasCallbacks,
  EmojiMapping,
} from 'matrix-js-sdk/lib/crypto-api/verification'
import { VerificationPhase, VerificationRequestEvent, VerifierEvent } from 'matrix-js-sdk/lib/crypto-api/verification'

interface VerificationDialogProps {
  request: VerificationRequest
  onClose: () => void
}

type DialogState =
  | { step: 'incoming' }
  | { step: 'waiting' }
  | { step: 'sas'; emojis: EmojiMapping[]; sasCallbacks: ShowSasCallbacks }
  | { step: 'done' }
  | { step: 'cancelled'; reason?: string }

export function VerificationDialog({ request, onClose }: VerificationDialogProps) {
  const [state, setState] = useState<DialogState>(() => {
    if (request.phase === VerificationPhase.Requested && !request.initiatedByMe) {
      return { step: 'incoming' }
    }
    return { step: 'waiting' }
  })

  const verifierCleanupRef = useRef<(() => void) | null>(null)

  const attachVerifierListeners = useCallback((verifier: any) => {
    if (!verifier) return
    verifierCleanupRef.current?.()
    const onShowSas = (sas: ShowSasCallbacks) => {
      if (sas.sas.emoji) {
        setState({ step: 'sas', emojis: sas.sas.emoji, sasCallbacks: sas })
      }
    }
    const onCancel = () => { setState({ step: 'cancelled' }) }
    verifier.on(VerifierEvent.ShowSas, onShowSas)
    verifier.on(VerifierEvent.Cancel, onCancel)
    verifierCleanupRef.current = () => { verifier.off(VerifierEvent.ShowSas, onShowSas); verifier.off(VerifierEvent.Cancel, onCancel) }
    const sas = verifier.getShowSasCallbacks?.()
    if (sas?.sas?.emoji) {
      setState({ step: 'sas', emojis: sas.sas.emoji, sasCallbacks: sas })
    }
  }, [])

  const handleChange = useCallback(() => {
    const phase = request.phase
    if (phase === VerificationPhase.Cancelled) {
      setState({ step: 'cancelled', reason: request.cancellationCode || undefined })
      return
    }
    if (phase === VerificationPhase.Done) { setState({ step: 'done' }); return }
    if (phase === VerificationPhase.Started || phase === VerificationPhase.Ready) {
      const verifier = request.verifier
      if (verifier) {
        attachVerifierListeners(verifier)
        const sas = verifier.getShowSasCallbacks?.()
        if (sas?.sas?.emoji) {
          setState({ step: 'sas', emojis: sas.sas.emoji, sasCallbacks: sas })
          return
        }
      }
      if (phase === VerificationPhase.Ready && request.methods?.includes('m.sas.v1')) {
        request.startVerification('m.sas.v1').then((verifier: any) => {
          attachVerifierListeners(verifier)
          verifier.verify().catch(() => { setState({ step: 'cancelled' }) })
        }).catch((err: any) => { console.error('Failed to start verification:', err) })
      }
      if (phase === VerificationPhase.Started && verifier && !(verifier as any)._hasCalledVerify) {
        (verifier as any)._hasCalledVerify = true
        verifier.verify().catch(() => { setState({ step: 'cancelled' }) })
      }
      if (state.step !== 'sas') { setState({ step: 'waiting' }) }
    }
  }, [request, state.step, attachVerifierListeners])

  useEffect(() => {
    request.on(VerificationRequestEvent.Change, handleChange)
    handleChange()
    return () => { request.off(VerificationRequestEvent.Change, handleChange); verifierCleanupRef.current?.(); verifierCleanupRef.current = null }
  }, [request, handleChange])

  useEffect(() => {
    const verifier = request.verifier
    if (!verifier) return
    attachVerifierListeners(verifier)
  }, [request.verifier, attachVerifierListeners])

  const handleAccept = async () => {
    try {
      setState({ step: 'waiting' })
      if (request.phase !== VerificationPhase.Requested) return
      await request.accept()
    } catch (err) {
      console.error('Failed to accept verification:', err)
      setState({ step: 'cancelled', reason: 'Failed to accept. Try again from the other device.' })
    }
  }

  const handleDecline = async () => {
    try { await request.cancel() } catch {}
    onClose()
  }

  const handleSasConfirm = async () => {
    if (state.step !== 'sas') return
    try { setState({ step: 'waiting' }); await state.sasCallbacks.confirm() }
    catch (err) { console.error('SAS confirm failed:', err); setState({ step: 'cancelled' }) }
  }

  const handleSasMismatch = () => {
    if (state.step !== 'sas') return
    state.sasCallbacks.mismatch()
    setState({ step: 'cancelled', reason: 'Emoji mismatch' })
  }

  const otherUser = request.otherUserId
  const isSelf = request.isSelfVerification

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-m3-surface animate-fade-in safe-area-pad">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-m3-outline-variant bg-white px-2 py-2 dark:border-m3-outline-variant dark:bg-m3-surface-container md:px-4">
        <button onClick={onClose} className="rounded-full p-2 text-m3-on-surface-variant transition-colors hover:bg-m3-surface-container dark:hover:bg-m3-surface-container-high">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <ShieldCheck className="h-5 w-5 text-m3-primary" />
        <h2 className="text-base font-medium text-m3-on-surface dark:text-m3-on-surface">
          {isSelf ? 'Verify Session' : 'Verify User'}
        </h2>
      </div>

      {/* Content */}
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-sm">
          {state.step === 'incoming' && (
            <div className="space-y-6 text-center">
              <ShieldCheck className="mx-auto h-16 w-16 text-m3-primary" />
              <p className="text-sm text-m3-on-surface-variant dark:text-m3-on-surface-variant">
                {isSelf
                  ? 'Another session is requesting verification. Accept to share encryption keys between your sessions.'
                  : `${otherUser} wants to verify with you.`}
              </p>
              <div className="flex gap-3">
                <button onClick={handleAccept} className="flex-1 rounded-full bg-m3-primary py-2.5 px-4 text-sm font-medium text-white transition-colors hover:bg-m3-primary/90">
                  Accept
                </button>
                <button onClick={handleDecline} className="flex-1 rounded-full bg-m3-surface-container py-2.5 px-4 text-sm font-medium text-m3-on-surface transition-colors hover:bg-m3-surface-container-high dark:bg-m3-surface-container-high dark:hover:bg-m3-surface-container-highest">
                  Decline
                </button>
              </div>
            </div>
          )}

          {state.step === 'waiting' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="h-10 w-10 text-m3-primary animate-spin" />
              <p className="text-sm text-m3-on-surface-variant">Waiting for the other side...</p>
            </div>
          )}

          {state.step === 'sas' && (
            <div className="space-y-6">
              <p className="text-center text-sm text-m3-on-surface-variant">
                Compare the emojis below with the other device. If they match, the session is verified.
              </p>
              <div className="grid grid-cols-7 gap-2 rounded-2xl bg-m3-surface-container p-5 dark:bg-m3-surface-container-high">
                {state.emojis.map(([emoji, name], i) => (
                  <div key={i} className="flex flex-col items-center gap-1.5">
                    <span className="text-3xl">{emoji}</span>
                    <span className="text-[10px] text-m3-on-surface-variant dark:text-m3-outline text-center leading-tight">{name}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={handleSasConfirm} className="flex flex-1 items-center justify-center gap-2 rounded-full bg-green-600 py-2.5 px-4 text-sm font-medium text-white transition-colors hover:bg-green-500">
                  <CheckCircle2 className="h-4 w-4" /> They Match
                </button>
                <button onClick={handleSasMismatch} className="flex flex-1 items-center justify-center gap-2 rounded-full bg-m3-error py-2.5 px-4 text-sm font-medium text-white transition-colors hover:bg-m3-error/90">
                  <XCircle className="h-4 w-4" /> No Match
                </button>
              </div>
            </div>
          )}

          {state.step === 'done' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <ShieldCheck className="h-16 w-16 text-green-500" />
              <p className="text-lg font-medium text-green-600 dark:text-green-400">Verification Complete!</p>
              <p className="text-center text-sm text-m3-on-surface-variant dark:text-m3-outline">
                {isSelf
                  ? 'Your session is now verified. Encrypted messages will be shared between your sessions.'
                  : `${otherUser} is now verified.`}
              </p>
              <button onClick={onClose} className="mt-2 rounded-full bg-m3-surface-container px-6 py-2.5 text-sm font-medium text-m3-on-surface transition-colors hover:bg-m3-surface-container-high dark:bg-m3-surface-container-high dark:hover:bg-m3-surface-container-highest">
                Close
              </button>
            </div>
          )}

          {state.step === 'cancelled' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <ShieldAlert className="h-16 w-16 text-m3-error" />
              <p className="text-lg font-medium text-m3-error">Verification Cancelled</p>
              {state.reason && <p className="text-sm text-m3-on-surface-variant dark:text-m3-outline">{state.reason}</p>}
              <button onClick={onClose} className="mt-2 rounded-full bg-m3-surface-container px-6 py-2.5 text-sm font-medium text-m3-on-surface transition-colors hover:bg-m3-surface-container-high dark:bg-m3-surface-container-high dark:hover:bg-m3-surface-container-highest">
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

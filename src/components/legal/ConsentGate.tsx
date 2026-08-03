import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { isConsentEnforcementEnabled } from '../../services/legal/consentFlag'
import {
  getMissingConsents,
  hasAnyPreviousAcceptance,
  hydrateConsents,
} from '../../services/legal/consentService'
import type { ConsentDocumentId } from '../../services/legal/consentDocuments'
import { useAuthStore } from '../../store/useAuthStore'
import ConsentAccountActions from './ConsentAccountActions'
import ConsentScreen from './ConsentScreen'

type GateState =
  | { status: 'checking'; userId: string | null }
  | { status: 'open'; userId: string | null }
  | { status: 'missing'; userId: string; documents: ConsentDocumentId[]; isUpdate: boolean }
  | { status: 'unavailable'; userId: string }

export default function ConsentGate({ children }: { children: ReactNode }) {
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const enabled = isConsentEnforcementEnabled()
  const [state, setState] = useState<GateState>(() => (
    enabled ? { status: 'checking', userId } : { status: 'open', userId }
  ))
  const evaluationToken = useRef(0)

  const evaluate = useCallback(async () => {
    const token = ++evaluationToken.current
    const commit = (next: GateState) => {
      if (token === evaluationToken.current) setState(next)
    }

    if (!enabled || !userId) {
      commit({ status: 'open', userId })
      return
    }

    commit({ status: 'checking', userId })
    try {
      const localMissing = await getMissingConsents(userId)
      if (localMissing.length === 0) {
        commit({ status: 'open', userId })
        return
      }

      const hydration = await hydrateConsents(userId)
      if (!hydration.ok) {
        commit({ status: 'unavailable', userId })
        return
      }

      const missing = await getMissingConsents(userId)
      if (missing.length === 0) {
        commit({ status: 'open', userId })
        return
      }

      const isUpdate = await hasAnyPreviousAcceptance(userId, missing)
      commit({ status: 'missing', userId, documents: missing, isUpdate })
    } catch {
      commit({ status: 'unavailable', userId })
    }
  }, [enabled, userId])

  useEffect(() => {
    void evaluate()
    return () => { evaluationToken.current += 1 }
  }, [evaluate])

  if (!enabled) return <>{children}</>
  if (state.userId !== userId || state.status === 'checking') return <ConsentLoading />
  if (state.status === 'open') return <>{children}</>
  if (state.status === 'unavailable') return <ConsentUnavailable onRetry={() => void evaluate()} />

  return (
    <ConsentScreen
      documents={state.documents}
      isUpdate={state.isUpdate}
      onAccepted={() => void evaluate()}
    />
  )
}

function ConsentLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="rounded-card border border-surface-border bg-surface-card px-8 py-10 text-center shadow-card">
        <div className="mx-auto h-8 w-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
        <p className="mt-4 text-sm font-medium text-ink">Verificando tus consentimientos</p>
        <ConsentAccountActions />
      </div>
    </div>
  )
}

function ConsentUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="max-w-md rounded-card border border-surface-border bg-surface-card px-8 py-10 text-center shadow-card">
        <p className="text-sm font-medium text-ink">No pudimos verificar tus consentimientos</p>
        <p className="mt-2 text-xs text-ink-muted">
          Necesitamos conexión para confirmar qué aceptaste. No te pedimos aceptar de nuevo para evitar registrar dos veces lo mismo.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-light"
        >
          Reintentar
        </button>
        <ConsentAccountActions />
      </div>
    </div>
  )
}

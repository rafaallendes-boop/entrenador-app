import { useEffect, useState } from 'react'
import type { SyncTier, SyncTierHealth, SyncTierHealthMap } from '../../types/syncDiagnostics'
import type { SyncErrorLogEntry } from '../../types/syncDiagnostics'
import { getRecentSyncErrors } from '../../services/syncDiagnostics'
import {
  clearPendingOpsForUser,
  drainQueue,
  repairAthleteProfileDuplicates,
  runFullSync,
} from '../../services/syncService'
import ConfirmDialog from '../ui/ConfirmDialog'

function formatRuntimeTimestamp(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat('es-CL', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp))
  } catch {
    return String(timestamp)
  }
}

interface Props {
  tierHealthMap: SyncTierHealthMap
  /** Bump this to force a refresh of the error log. */
  refreshToken?: number
  /** Auth user id. Sin él las acciones manuales se deshabilitan. */
  userId?: string | null
}

type ConfirmAction = 'clear-queue' | 'reset-tier-c'

type ActionState =
  | { kind: 'idle' }
  | { kind: 'running'; action: string }
  | { kind: 'result'; tone: 'ok' | 'error'; message: string }

const TIER_LABEL: Record<SyncTier, string> = {
  A: 'Criticas',
  B: 'Importantes',
  C: 'Best-effort',
}

const TIER_DESCRIPTION: Record<SyncTier, string> = {
  A: 'Perfil, sesiones, planes',
  B: 'Check-ins, resumenes',
  C: 'Chat, proposals',
}

const HEALTH_TONE: Record<SyncTierHealth, string> = {
  healthy: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
  degraded: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
  blocked: 'bg-rose-500/15 text-rose-300 border border-rose-500/30',
  unknown: 'bg-surface-raised text-ink-muted border border-surface-border',
}

const HEALTH_LABEL: Record<SyncTierHealth, string> = {
  healthy: 'OK',
  degraded: 'Pendiente',
  blocked: 'Bloqueado',
  unknown: '—',
}

export default function SyncDiagnosticsPanel({ tierHealthMap, refreshToken, userId }: Props) {
  const [errors, setErrors] = useState<SyncErrorLogEntry[] | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [actionState, setActionState] = useState<ActionState>({ kind: 'idle' })
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)
  const loading = expanded && errors === null
  const actionsDisabled = !userId || actionState.kind === 'running'

  async function runAction(label: string, fn: () => Promise<string>): Promise<void> {
    setActionState({ kind: 'running', action: label })
    try {
      const message = await fn()
      setActionState({ kind: 'result', tone: 'ok', message })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setActionState({ kind: 'result', tone: 'error', message })
    }
  }

  async function handleForceSync() {
    if (!userId) return
    await runAction('Forzar sync', async () => {
      await runFullSync(userId)
      return 'Sync completado.'
    })
  }

  async function handleDrain() {
    if (!userId) return
    await runAction('Reintentar cola', async () => {
      const drained = await drainQueue()
      return drained ? 'Cola vacía.' : 'Quedaron pendientes; se reintentarán.'
    })
  }

  async function handleRepairProfile() {
    if (!userId) return
    await runAction('Reparar perfil', async () => {
      const { remoteRowsBefore, repaired } = await repairAthleteProfileDuplicates(userId)
      return repaired
        ? `Reparados ${remoteRowsBefore} duplicados de athlete_profiles.`
        : `Sin duplicados (${remoteRowsBefore} fila${remoteRowsBefore === 1 ? '' : 's'} remota${remoteRowsBefore === 1 ? '' : 's'}).`
    })
  }

  function handleConfirm() {
    const pending = confirm
    setConfirm(null)
    if (!pending || !userId) return
    void runAction(
      pending === 'clear-queue' ? 'Limpiar cola' : 'Reset Tier C',
      async () => {
        const removed = clearPendingOpsForUser(
          userId,
          pending === 'reset-tier-c' ? ['chat_messages', 'coach_proposals'] : undefined,
        )
        return removed === 0
          ? 'No había ops pendientes para remover.'
          : `Se descartaron ${removed} op${removed === 1 ? '' : 's'} pendiente${removed === 1 ? '' : 's'}.`
      },
    )
  }

  useEffect(() => {
    if (!expanded) return
    let cancelled = false
    void getRecentSyncErrors(20).then((entries) => {
      if (cancelled) return
      setErrors(entries)
    })
    return () => {
      cancelled = true
    }
  }, [expanded, refreshToken])

  return (
    <div className="mt-3 space-y-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-2">
          Salud por tier
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(tierHealthMap) as SyncTier[]).map((tier) => {
            const health = tierHealthMap[tier]
            return (
              <div
                key={tier}
                className="rounded-xl border border-surface-border bg-surface px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink">{TIER_LABEL[tier]}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${HEALTH_TONE[health]}`}>
                    {HEALTH_LABEL[health]}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-ink-muted">{TIER_DESCRIPTION[tier]}</p>
              </div>
            )
          })}
        </div>
      </div>

      <div className="rounded-xl border border-surface-border bg-surface px-3 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-2">
          Acciones manuales
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleForceSync}
            disabled={actionsDisabled}
            className="rounded-lg border border-surface-border px-3 py-1.5 text-[11px] font-medium text-ink transition-colors hover:bg-surface-raised disabled:opacity-50"
          >
            Forzar sync
          </button>
          <button
            type="button"
            onClick={handleDrain}
            disabled={actionsDisabled}
            className="rounded-lg border border-surface-border px-3 py-1.5 text-[11px] font-medium text-ink transition-colors hover:bg-surface-raised disabled:opacity-50"
          >
            Reintentar cola
          </button>
          <button
            type="button"
            onClick={handleRepairProfile}
            disabled={actionsDisabled}
            className="rounded-lg border border-surface-border px-3 py-1.5 text-[11px] font-medium text-ink transition-colors hover:bg-surface-raised disabled:opacity-50"
          >
            Reparar perfil
          </button>
          <button
            type="button"
            onClick={() => setConfirm('reset-tier-c')}
            disabled={actionsDisabled}
            className="rounded-lg border border-surface-border px-3 py-1.5 text-[11px] font-medium text-ink-muted transition-colors hover:bg-surface-raised disabled:opacity-50"
          >
            Reset chat/RallyIQ
          </button>
          <button
            type="button"
            onClick={() => setConfirm('clear-queue')}
            disabled={actionsDisabled}
            className="rounded-lg border border-rose-500/40 px-3 py-1.5 text-[11px] font-medium text-rose-300 transition-colors hover:bg-rose-500/10 disabled:opacity-50"
          >
            Limpiar cola pendiente
          </button>
        </div>
        {actionState.kind === 'running' && (
          <p className="mt-2 text-[11px] text-ink-muted">{actionState.action} en curso…</p>
        )}
        {actionState.kind === 'result' && (
          <p
            className={`mt-2 text-[11px] ${
              actionState.tone === 'ok' ? 'text-emerald-300' : 'text-rose-300'
            }`}
          >
            {actionState.message}
          </p>
        )}
        {!userId && (
          <p className="mt-2 text-[11px] text-ink-muted">
            Iniciá sesión para ejecutar acciones de sync.
          </p>
        )}
      </div>

      <details
        className="group"
        open={expanded}
        onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer list-none text-xs font-medium text-ink-muted transition-colors group-open:text-ink">
          Ver ultimos errores de sync
        </summary>
        <div className="mt-2 rounded-xl border border-surface-border/80 bg-surface px-3 py-3 text-xs">
          {loading && <p className="text-ink-muted">Cargando…</p>}
          {!loading && errors && errors.length === 0 && (
            <p className="text-ink-muted">Sin errores registrados. Todo tranquilo.</p>
          )}
          {!loading && errors && errors.length > 0 && (
            <ul className="space-y-2">
              {errors.map((entry) => (
                <li
                  key={entry.id ?? `${entry.timestamp}-${entry.errorCategory}`}
                  className="rounded-lg border border-surface-border/60 bg-surface-raised/40 px-2 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink font-medium">
                      {entry.entity ?? 'desconocido'}
                      {entry.tier ? ` · tier ${entry.tier}` : ''}
                    </span>
                    <span className="text-[10px] text-ink-muted">
                      {formatRuntimeTimestamp(entry.timestamp)}
                    </span>
                  </div>
                  <p className="mt-1 text-ink-muted">{entry.userMessage}</p>
                  <p className="mt-0.5 text-[10px] text-ink-muted/80">
                    {entry.errorCategory}
                    {entry.retriable ? ' · retriable' : ''}
                    {entry.autoRepairable ? ' · autoReparable' : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'clear-queue' ? 'Limpiar cola pendiente' : 'Reset Tier C'}
        message={
          confirm === 'clear-queue'
            ? 'Se descartarán todas las operaciones locales no sincronizadas. Podrías perder cambios recientes que aún no subieron. ¿Continuar?'
            : 'Se descartarán los mensajes de chat y propuestas que no se hayan sincronizado. El historial local se mantiene. ¿Continuar?'
        }
        destructive={confirm === 'clear-queue'}
        confirmLabel={confirm === 'clear-queue' ? 'Descartar cola' : 'Reset Tier C'}
        onConfirm={handleConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}

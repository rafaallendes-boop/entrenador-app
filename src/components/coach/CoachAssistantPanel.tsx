import { useState } from 'react'
import type {
  AthleteTriage,
  TriageSignal,
} from '../../services/athlete/coachRosterTriage'
import type { RosterTriage } from '../../services/athlete/loadRosterTriage'
import type { DraftFailure, DraftResult } from '../../services/coach/requestAssistantDraft'

interface CoachAssistantPanelProps {
  triage: RosterTriage | null
  loading: boolean
  error?: string | null
  selfAthleteId: string
  athleteNames: Record<string, string>
  syncLabel: string
  devToolsEnabled?: boolean
  onRefresh: () => void
  onOpenWeek: (athleteId: string) => void
  onDraft: (athleteId: string) => Promise<DraftResult>
}

type AthleteDraftState =
  | { status: 'loading' }
  | { status: 'success'; body: string }
  | { status: 'failure'; reason: DraftFailure }

const SIGNAL_PRIORITY: Record<TriageSignal['kind'], number> = {
  pain: 0,
  'overdue-sessions': 1,
  'no-check-in': 2,
  'low-adherence': 3,
}

const FAILURE_COPY: Record<DraftFailure, string> = {
  quota: 'Se agotó el cupo disponible para redactar mensajes.',
  'kill-switch': 'La redacción con IA está temporalmente pausada.',
  entitlement: 'Esta acción requiere el plan Advanced.',
  timeout: 'La redacción tardó demasiado. Puedes reintentar; puede consumir cupo.',
  network: 'No pudimos conectar con el servicio. Puedes reintentar; puede consumir cupo.',
  'rate-limit': 'El proveedor está temporalmente saturado. Puedes reintentar; puede consumir cupo.',
  unavailable: 'La redacción con IA no está disponible en este momento. Puedes reintentar; puede consumir cupo.',
  'invalid-response': 'No se generó un borrador válido. Puedes reintentar; puede consumir cupo.',
  'too-long': 'El borrador generado superó el límite de 600 caracteres. Puedes reintentar; puede consumir cupo.',
}

type BlockingDraftFailure = Extract<
  DraftFailure,
  'quota' | 'kill-switch' | 'entitlement'
>

function isBlockingFailure(reason: DraftFailure): reason is BlockingDraftFailure {
  return reason === 'quota'
    || reason === 'kill-switch'
    || reason === 'entitlement'
}

function signalLabel(signal: TriageSignal): string {
  switch (signal.kind) {
    case 'pain':
      return `Dolor elevado · ${signal.days} ${signal.days === 1 ? 'día' : 'días'}`
    case 'overdue-sessions':
      return `${signal.count} ${signal.count === 1 ? 'sesión sin resolver' : 'sesiones sin resolver'} · la más antigua hace ${signal.oldestDaysAgo} ${signal.oldestDaysAgo === 1 ? 'día' : 'días'}`
    case 'no-check-in':
      return `Sin check-in · ${signal.days} ${signal.days === 1 ? 'día' : 'días'}`
    case 'low-adherence':
      return `Adherencia baja · ${signal.adherencePct}%`
  }
}

function athletePriority(athlete: AthleteTriage): number {
  return athlete.signals.reduce(
    (priority, signal) => Math.min(priority, SIGNAL_PRIORITY[signal.kind]),
    Number.POSITIVE_INFINITY,
  )
}

function sortByPriority(
  athletes: AthleteTriage[],
  athleteNames: Record<string, string>,
): AthleteTriage[] {
  return [...athletes].sort((left, right) => (
    athletePriority(left) - athletePriority(right)
    || (athleteNames[left.athleteId] ?? '').localeCompare(
      athleteNames[right.athleteId] ?? '',
      'es',
    )
  ))
}

function formatComputedAt(value: number): string {
  return new Date(value).toLocaleString('es-CL', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

export default function CoachAssistantPanel({
  triage,
  loading,
  error = null,
  selfAthleteId,
  athleteNames,
  syncLabel,
  devToolsEnabled = false,
  onRefresh,
  onOpenWeek,
  onDraft,
}: CoachAssistantPanelProps) {
  const [draftByAthlete, setDraftByAthlete] = useState<Record<string, AthleteDraftState>>({})
  const [blockingFailure, setBlockingFailure] = useState<BlockingDraftFailure | null>(null)

  async function handleDraft(athleteId: string) {
    if (triage === null || blockingFailure !== null) return
    const current = draftByAthlete[athleteId]
    if (current?.status === 'loading') return
    if (current?.status === 'failure' && isBlockingFailure(current.reason)) return

    setDraftByAthlete((states) => ({
      ...states,
      [athleteId]: { status: 'loading' },
    }))

    let result: DraftResult
    try {
      result = await onDraft(athleteId)
    } catch {
      // El callback público devuelve DraftResult, pero la pantalla mantiene su
      // degradación si una integración futura rompe ese contrato.
      result = { ok: false, reason: 'network' }
    }

    setDraftByAthlete((states) => {
      return {
        ...states,
        [athleteId]: result.ok
          ? { status: 'success', body: result.body }
          : { status: 'failure', reason: result.reason },
      }
    })
    if (!result.ok && isBlockingFailure(result.reason)) {
      // Cuota, kill switch y entitlement aplican a toda la
      // clase de request, no al atleta que casualmente disparó el primer fallo.
      setBlockingFailure(result.reason)
    }
  }

  function handleRefresh() {
    setBlockingFailure(null)
    setDraftByAthlete((states) => Object.fromEntries(
      Object.entries(states).filter(([, state]) => (
        state.status !== 'failure' || !isBlockingFailure(state.reason)
      )),
    ))
    onRefresh()
  }

  if (triage === null) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center">
        <p className="text-sm text-ink-muted">
          {loading
            ? 'Calculando el triaje del roster…'
            : error ?? 'Todavía no se calculó el triaje.'}
        </p>
        {!loading && (
          <button
            type="button"
            onClick={handleRefresh}
            className="mt-3 rounded-xl bg-brand px-4 py-2 text-xs font-semibold text-white"
          >
            Calcular ahora
          </button>
        )}
      </div>
    )
  }

  const withSignals = sortByPriority(
    triage.athletes.filter((athlete) => athlete.signals.length > 0),
    athleteNames,
  )
  const insufficientOnly = triage.athletes.filter(
    (athlete) => athlete.signals.length === 0 && athlete.insufficientData,
  )
  const upToDate = triage.athletes.filter(
    (athlete) => athlete.signals.length === 0 && !athlete.insufficientData,
  )
  function renderAthlete(athlete: AthleteTriage) {
    const draft = draftByAthlete[athlete.athleteId]
    const orderedSignals = [...athlete.signals].sort(
      (left, right) => SIGNAL_PRIORITY[left.kind] - SIGNAL_PRIORITY[right.kind],
    )
    const canDraft = athlete.signals.length > 0 && athlete.athleteId !== selfAthleteId
    const draftDisabled = blockingFailure !== null
      || draft?.status === 'loading'
      || (draft?.status === 'failure' && isBlockingFailure(draft.reason))

    return (
      <article
        key={athlete.athleteId}
        className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold text-ink">
              {athleteNames[athlete.athleteId] ?? 'Atleta'}
            </h4>
            {athlete.insufficientData && (
              <p className="mt-1 text-xs text-amber-200">Sin datos suficientes</p>
            )}
          </div>
        </div>

        {orderedSignals.length > 0 && (
          <ul
            data-testid={`signals-${athlete.athleteId}`}
            className="mt-3 flex flex-wrap gap-2"
          >
            {orderedSignals.map((signal) => (
              <li
                key={signal.kind}
                className={`rounded-full border px-2.5 py-1 text-xs ${signal.kind === 'pain'
                  ? 'border-rose-400/30 bg-rose-500/10 text-rose-100'
                  : 'border-white/10 bg-white/5 text-ink-muted'}`}
              >
                {signalLabel(signal)}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid={`week-${athlete.athleteId}`}
            onClick={() => onOpenWeek(athlete.athleteId)}
            className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-white/10"
          >
            Ver semana
          </button>
          {canDraft && (
            <button
              type="button"
              data-testid={`draft-${athlete.athleteId}`}
              disabled={draftDisabled}
              onClick={() => { void handleDraft(athlete.athleteId) }}
              className="rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              {draft?.status === 'loading' ? 'Redactando…' : 'Redactar mensaje'}
            </button>
          )}
        </div>

        {draft?.status === 'failure' && (
          <p
            role="alert"
            data-testid={`draft-error-${athlete.athleteId}`}
            className="mt-3 text-xs text-amber-200"
          >
            {FAILURE_COPY[draft.reason]}
          </p>
        )}
        {draft?.status === 'success' && (
          <div
            data-testid={`draft-body-${athlete.athleteId}`}
            className="mt-3 select-text rounded-xl border border-white/10 bg-black/15 p-3"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Borrador para revisar y copiar
            </p>
            <div className="mt-2 whitespace-pre-wrap text-sm text-ink">
              <p>{athleteNames[athlete.athleteId]
                ? `Hola ${athleteNames[athlete.athleteId]},`
                : 'Hola,'}</p>
              <p className="mt-1">{draft.body}</p>
            </div>
          </div>
        )}
      </article>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p data-testid="computed-at" className="text-xs text-ink-muted">
          Datos locales · Calculado {formatComputedAt(triage.computedAt)} · Estado de sync actual: {syncLabel}
        </p>
        <button
          type="button"
          disabled={loading}
          onClick={handleRefresh}
          className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-white/10 disabled:opacity-40"
        >
          {loading ? 'Recalculando…' : 'Recalcular'}
        </button>
      </div>

      <p className="text-xs text-ink-muted">
        El triaje refleja los datos disponibles en este dispositivo. Recalcula si acaba de sincronizar.
      </p>

      {error && (
        <p
          role="alert"
          data-testid="triage-error"
          className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
        >
          {error}
        </p>
      )}

      {blockingFailure && (
        <p
          role="alert"
          data-testid="draft-global-error"
          className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
        >
          {FAILURE_COPY[blockingFailure]}
        </p>
      )}

      <section data-testid="group-con-senales" data-collapsed="false">
        <h3 className="font-display text-sm font-semibold text-ink">
          Con señales ({withSignals.length})
        </h3>
        <div className="mt-3 space-y-3">
          {withSignals.length > 0
            ? withSignals.map(renderAthlete)
            : <p className="text-sm text-ink-muted">No hay señales que revisar.</p>}
        </div>
      </section>

      <section data-testid="group-sin-datos" data-collapsed="false">
        <h3 className="font-display text-sm font-semibold text-ink">
          Sin datos suficientes ({insufficientOnly.length})
        </h3>
        <div className="mt-3 space-y-3">
          {insufficientOnly.length > 0
            ? insufficientOnly.map(renderAthlete)
            : <p className="text-sm text-ink-muted">Todos tienen cobertura suficiente.</p>}
        </div>
      </section>

      <details data-testid="group-al-dia" data-collapsed="true">
        <summary className="cursor-pointer font-display text-sm font-semibold text-ink-muted">
          Al día ({upToDate.length})
        </summary>
        <div className="mt-3 space-y-3">
          {upToDate.length > 0
            ? upToDate.map(renderAthlete)
            : <p className="text-sm text-ink-muted">Ningún atleta está en este grupo.</p>}
        </div>
      </details>

      {devToolsEnabled && (
        <p data-testid="triage-metrics" className="text-[11px] text-ink-muted">
          Triaje local: {triage.durationMs} ms · {triage.athleteCount} atletas
        </p>
      )}
    </div>
  )
}

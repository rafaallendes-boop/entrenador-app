import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Card from '../components/ui/Card'
import { ROUTES } from '../constants/routes'
import { db } from '../db/db'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import { usePlanBuilderStore } from '../store/usePlanBuilderStore'
import { getPrimaryGoalEvent } from '../services/macroPlan'
import { ChevronLeft, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react'
import type { PlanWizardConfig } from '../types'

const PHASE_LABELS: Record<string, string> = {
  base: 'Base', build: 'Build', peak: 'Peak', taper: 'Taper', race: 'Race', transition: 'Transition',
}

function WeekStatusDot({ status }: { status: string }) {
  const color =
    status === 'draft' || status === 'accepted' ? 'bg-emerald-500' :
    status === 'generating' ? 'bg-amber-400 animate-pulse' :
    status === 'error' ? 'bg-red-500' :
    'bg-ink-faint'
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden />
}

function buildDraftSignature(goalEventId: string, wizardConfig: PlanWizardConfig): string {
  return JSON.stringify({
    goalEventId,
    wizardConfig,
  })
}

export default function PlanBuilderV2Page() {
  const navigate = useNavigate()
  const athleteProfile = useCoachMemoryStore((s) => s.athleteProfile)
  const {
    plan, weeks, issues, status, currentWeekIndex, completedWeeks, failedWeekIndexes, streamingTextByWeekIndex, lastError,
    createDraft, runGeneration, regenerateWeek, acceptPlan, discard,
  } = usePlanBuilderStore()

  const [selectedWeekIndex, setSelectedWeekIndex] = useState<number | null>(null)

  const goalEvent = getPrimaryGoalEvent(athleteProfile)
  const expectedDraftSignature = athleteProfile?.planWizardConfig && goalEvent
    ? buildDraftSignature(goalEvent.id, athleteProfile.planWizardConfig)
    : null
  const currentDraftSignature = plan
    ? buildDraftSignature(plan.goalEventId, plan.wizardConfig)
    : null

  useEffect(() => {
    if (!athleteProfile || !athleteProfile.planWizardConfig || !goalEvent) return
    const wizardConfig = athleteProfile.planWizardConfig
    if (currentDraftSignature === expectedDraftSignature) return
    if (plan) {
      void createDraft({ profile: athleteProfile, wizardConfig })
      return
    }

    let cancelled = false
    void (async () => {
      const existingPlans = await db.trainingPlans
        .where('athleteId')
        .equals(athleteProfile.id)
        .toArray()
      if (cancelled) return

      const matchingPlan = existingPlans
        .filter((candidate) => buildDraftSignature(candidate.goalEventId, candidate.wizardConfig) === expectedDraftSignature)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0]

      if (matchingPlan) {
        await usePlanBuilderStore.getState().loadDraft(matchingPlan.id)
        return
      }

      await createDraft({ profile: athleteProfile, wizardConfig })
    })()

    return () => {
      cancelled = true
    }
  }, [athleteProfile, createDraft, currentDraftSignature, expectedDraftSignature, goalEvent, plan])

  useEffect(() => {
    if (plan && weeks.length > 0 && status === 'ready' && weeks.every((w) => w.status === 'pending')) {
      if (!athleteProfile) return
      void runGeneration(athleteProfile)
    }
  }, [plan, weeks, status, athleteProfile, runGeneration])

  const effectiveSelectedWeekIndex =
    selectedWeekIndex != null && weeks.some((week) => week.weekIndex === selectedWeekIndex)
      ? selectedWeekIndex
      : weeks[0]?.weekIndex ?? 0
  const selectedWeek = weeks.find((w) => w.weekIndex === effectiveSelectedWeekIndex)
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const hasIncompleteWeeks = weeks.length === 0 || weeks.some((week) => week.status !== 'draft' || week.sessions.length === 0)
  const acceptBlockers = [
    ...(hasIncompleteWeeks ? ['Completa o regenera todas las semanas antes de aceptar el plan.'] : []),
    ...errors.map((issue) => issue.message),
  ]

  if (!athleteProfile?.planWizardConfig || !goalEvent) {
    return (
      <div className="px-4 pt-12 pb-8 max-w-md mx-auto">
        <Card className="p-4 space-y-3">
          <h1 className="text-lg font-bold text-ink">Plan Builder</h1>
          <p className="text-sm text-ink-muted">
            Necesitás completar el wizard de plan de competencia antes de generar un plan por evento.
          </p>
          <button
            onClick={() => navigate(ROUTES.COMPETITION_PLAN)}
            className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white"
          >
            Abrir wizard
          </button>
        </Card>
      </div>
    )
  }

  return (
    <div className="px-4 pt-10 pb-6 md:px-6 max-w-5xl mx-auto">
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
        >
          <ChevronLeft size={16} /> Volver
        </button>
        <div className="flex-1" />
        {status === 'done' && (
          <span className="text-sm font-semibold text-emerald-500">Plan aceptado</span>
        )}
      </div>

      <div className="mb-4">
        <h1 className="text-xl font-bold text-ink">
          {plan?.title ?? `Plan para ${goalEvent.title}`}
        </h1>
        <p className="text-xs text-ink-muted">
          {plan ? `${plan.totalWeeks} semanas · Inicio ${plan.startDate} · Evento ${plan.macroSnapshot.goalEventDate}` : 'Preparando plan…'}
        </p>
        {plan?.generationSummary && (
          <p className="mt-1 text-xs text-ink-faint">
            Estrategia {plan.generationSummary.strategy} · {completedWeeks}/{weeks.length} semanas listas · {failedWeekIndexes.length} fallidas
          </p>
        )}
        {lastError && (
          <p className="mt-2 text-xs text-red-500">{lastError}</p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-[220px_1fr_240px]">
        {/* Timeline */}
        <Card className="p-3 space-y-1 max-h-[70vh] overflow-y-auto">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint mb-2">Semanas</p>
          {weeks.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => setSelectedWeekIndex(w.weekIndex)}
              className={`w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                w.weekIndex === effectiveSelectedWeekIndex
                  ? 'bg-brand/15 text-ink'
                  : 'hover:bg-surface-raised text-ink-muted'
              }`}
            >
              <WeekStatusDot status={w.status} />
              <div className="flex-1">
                <div className="font-semibold">Semana {w.weekIndex + 1}</div>
                <div className="text-[11px] text-ink-faint">
                  {PHASE_LABELS[w.phase]} · {w.sessions.length} sesiones
                </div>
              </div>
              {currentWeekIndex === w.weekIndex && status === 'generating' && (
                <RefreshCw size={12} className="animate-spin text-amber-500" />
              )}
            </button>
          ))}
        </Card>

        {/* Detail */}
        <Card className="p-4 max-h-[70vh] overflow-y-auto">
          {selectedWeek ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-ink">
                    Semana {selectedWeek.weekIndex + 1} · {PHASE_LABELS[selectedWeek.phase]}
                  </h2>
                  <p className="text-xs text-ink-muted">
                    Lunes {selectedWeek.weekStartDate} · Estado: {selectedWeek.status}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={status === 'generating' || status === 'committing'}
                  onClick={() => athleteProfile && regenerateWeek(selectedWeek.weekIndex, athleteProfile)}
                  className="inline-flex items-center gap-1 rounded-lg bg-surface-raised px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink disabled:opacity-50"
                >
                  <RefreshCw size={12} /> Regenerar
                </button>
              </div>

              {selectedWeek.weekObjectives.length > 0 && (
                <div className="rounded-lg bg-surface-raised px-3 py-2 text-xs text-ink">
                  <p className="font-semibold text-ink-muted mb-1">Objetivos</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {selectedWeek.weekObjectives.map((obj, i) => (
                      <li key={i}>{obj.goal}</li>
                    ))}
                  </ul>
                </div>
              )}

              {selectedWeek.sessions.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-ink-muted italic">
                    {selectedWeek.status === 'generating'
                      ? 'Generando sesiones…'
                      : selectedWeek.status === 'error'
                      ? `Falló la generación. ${selectedWeek.generationMeta.lastError ?? ''}`
                      : 'Sin sesiones todavía.'}
                  </p>
                  {selectedWeek.status === 'generating' && streamingTextByWeekIndex[selectedWeek.weekIndex] && (
                    <div className="rounded-lg bg-surface-raised px-3 py-2 text-xs text-ink whitespace-pre-wrap">
                      {streamingTextByWeekIndex[selectedWeek.weekIndex]}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedWeek.sessions
                    .slice()
                    .sort((a, b) => (a.date === b.date ? (a.timeBlock > b.timeBlock ? 1 : -1) : a.date.localeCompare(b.date)))
                    .map((s, i) => (
                      <div key={i} className="rounded-lg border border-surface-border px-3 py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-ink-faint">{s.date}</span>
                          <span className="text-[10px] uppercase tracking-wider text-ink-muted">{s.timeBlock}</span>
                          <span className="text-[10px] uppercase text-brand">{s.sessionType}</span>
                          <span className="text-[10px] text-ink-faint">{s.durationMin}min</span>
                        </div>
                        <p className="mt-0.5 font-semibold text-ink">{s.title}</p>
                        {s.objective && <p className="text-xs text-ink-muted">{s.objective}</p>}
                      </div>
                    ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Seleccioná una semana</p>
          )}
        </Card>

        {/* Validation panel */}
        <Card className="p-3 max-h-[70vh] overflow-y-auto space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Validación</p>
          {errors.length === 0 && warnings.length === 0 && (
            <p className="text-xs text-emerald-500 flex items-center gap-1">
              <CheckCircle2 size={12} /> Sin alertas
            </p>
          )}
          {errors.map((issue, i) => (
            <div key={`e${i}`} className="text-xs text-red-500 flex items-start gap-1">
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
              <span>{issue.message}</span>
            </div>
          ))}
          {warnings.map((issue, i) => (
            <div key={`w${i}`} className="text-xs text-amber-600 flex items-start gap-1">
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
              <span>{issue.message}</span>
            </div>
          ))}
        </Card>
      </div>

      {/* Actions */}
      {status !== 'done' && (
        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={status === 'generating' || status === 'committing' || errors.length > 0 || hasIncompleteWeeks}
              onClick={async () => {
                const result = await acceptPlan()
                if (result.errors.length === 0) navigate(ROUTES.WEEK)
              }}
              className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {status === 'committing' ? 'Guardando…' : 'Aceptar plan'}
            </button>
            <button
              type="button"
              disabled={status === 'generating' || status === 'committing'}
              onClick={async () => {
                await discard()
                navigate(-1)
              }}
              className="rounded-xl bg-surface-raised px-4 py-2 text-sm font-semibold text-ink-muted hover:text-ink disabled:opacity-50"
            >
              Descartar
            </button>
          </div>
          {acceptBlockers.length > 0 && status !== 'generating' && status !== 'committing' && (
            <p className="text-xs text-ink-muted">
              No se puede aceptar todavía: {acceptBlockers[0]}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

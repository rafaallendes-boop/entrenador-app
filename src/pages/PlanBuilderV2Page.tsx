import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PlanBuilderLaunchDeck from '../components/planBuilder/PlanBuilderLaunchDeck'
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

const PHASE_DOT: Record<string, string> = {
  base: 'bg-sky-400',
  build: 'bg-amber-400',
  peak: 'bg-brand',
  taper: 'bg-emerald-400',
  race: 'bg-rose-400',
  transition: 'bg-ink-faint',
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
  const [initializedPlanId, setInitializedPlanId] = useState<string | null>(null)

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

  const isGenerating = status === 'generating'
  const generationProgress = weeks.length > 0 ? Math.round((completedWeeks / weeks.length) * 100) : 0
  const currentPlanId = plan?.id ?? null
  const shouldShowLaunchDeck =
    currentPlanId !== null &&
    status === 'ready' &&
    weeks.length > 0 &&
    weeks.every((week) => week.status === 'pending') &&
    currentPlanId !== initializedPlanId
  const launchInsight = goalEvent
    ? `Basado en ${goalEvent.title} y en tu configuracion competitiva actual, conviene inicializar un macro-bloque limpio antes de expandir cada semana con el motor de generacion.`
    : 'Hay un blueprint listo para generar. Conviene inicializar el protocolo desde una estructura estable y consistente.'

  async function handleInitializeProtocol() {
    if (!athleteProfile || !plan || isGenerating || status === 'committing') return
    setInitializedPlanId(plan.id)
    await runGeneration(athleteProfile)
  }

  return (
    <div className="min-h-screen pb-8">
      {/* Header */}
      <div className="relative overflow-hidden px-4 pb-5 pt-10 md:px-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {/* Ambient glow */}
        <div className="pointer-events-none absolute left-0 top-0 h-40 w-64 rounded-full bg-brand/8 blur-3xl" />
        {/* Top accent line */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,77,0,0.4), transparent)' }} />

        <div className="relative max-w-5xl mx-auto">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mb-4 flex items-center gap-1.5 text-xs font-medium text-ink-faint transition-colors hover:text-ink-muted"
          >
            <ChevronLeft size={14} /> Volver
          </button>

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.36em] text-ink-faint">
                Plan Builder
              </p>
              <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink md:text-3xl">
                {plan?.title ?? `Plan para ${goalEvent.title}`}
              </h1>
              {plan && (
                <p className="mt-1 text-xs text-ink-muted">
                  {plan.totalWeeks} semanas · Inicio {plan.startDate} · Evento {plan.macroSnapshot.goalEventDate}
                </p>
              )}
              {lastError && (
                <p className="mt-1.5 text-xs text-red-400">{lastError}</p>
              )}
            </div>

            {status === 'done' && (
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider text-emerald-400"
                style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)' }}>
                <CheckCircle2 size={12} /> Plan aceptado
              </span>
            )}
          </div>

          {/* Generation progress bar */}
          {isGenerating && weeks.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-mono text-[9px] font-bold uppercase tracking-[0.28em] text-ink-faint">
                  Generando · {completedWeeks}/{weeks.length} semanas
                </span>
                <span className="font-mono text-[9px] font-bold" style={{ color: '#ff7a33' }}>{generationProgress}%</span>
              </div>
              <div className="overflow-hidden rounded-full" style={{ height: '3px', background: 'rgba(255,255,255,0.08)' }}>
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${generationProgress}%`,
                    background: 'linear-gradient(90deg, #ff4d00, #ff7a33)',
                    boxShadow: '0 0 8px 2px rgba(255,77,0,0.55)',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main grid */}
      <div className="mx-auto max-w-5xl px-4 pt-5 md:px-6">
        {shouldShowLaunchDeck ? (
          <PlanBuilderLaunchDeck
            title="Plan Builder"
            subtitle="Architect your kinetic framework before the engine expands each week."
            insight={launchInsight}
            weeksLabel={`${plan?.totalWeeks ?? weeks.length} semanas listas para inicializar.`}
            goalLabel={goalEvent ? `Evento objetivo: ${goalEvent.title} · ${goalEvent.date}` : 'Macro-plan listo para generar.'}
            isInitializing={isGenerating}
            onInitialize={() => { void handleInitializeProtocol() }}
          />
        ) : (
        <div className="grid gap-4 md:grid-cols-[210px_1fr_230px]">

          {/* Timeline sidebar */}
          <div
            className="rounded-2xl p-3 max-h-[72vh] overflow-y-auto space-y-0.5"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <p className="font-mono text-[9px] font-bold uppercase tracking-[0.28em] text-ink-faint px-2 py-1 mb-1">
              Semanas
            </p>
            {weeks.map((w) => {
              const isActive = w.weekIndex === effectiveSelectedWeekIndex
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setSelectedWeekIndex(w.weekIndex)}
                  className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-sm transition-all"
                  style={{
                    background: isActive ? 'rgba(255,77,0,0.12)' : 'transparent',
                    border: isActive ? '1px solid rgba(255,77,0,0.22)' : '1px solid transparent',
                  }}
                >
                  <span className={`h-2 w-2 flex-shrink-0 rounded-full ${PHASE_DOT[w.phase] ?? 'bg-ink-faint'} ${w.status === 'generating' ? 'animate-pulse' : ''}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs font-semibold ${isActive ? 'text-ink' : 'text-ink-muted'}`}>
                      Sem {w.weekIndex + 1}
                    </div>
                    <div className="text-[10px] text-ink-faint truncate">
                      {PHASE_LABELS[w.phase]}
                      {w.sessions.length > 0 && ` · ${w.sessions.length}s`}
                    </div>
                  </div>
                  {currentWeekIndex === w.weekIndex && isGenerating && (
                    <RefreshCw size={11} className="animate-spin text-brand flex-shrink-0" />
                  )}
                  {w.status === 'error' && (
                    <AlertTriangle size={11} className="text-red-400 flex-shrink-0" />
                  )}
                </button>
              )
            })}
          </div>

          {/* Detail panel */}
          <div
            className="rounded-2xl p-4 max-h-[72vh] overflow-y-auto"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {selectedWeek ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${PHASE_DOT[selectedWeek.phase] ?? 'bg-ink-faint'}`} />
                      <h2 className="font-display text-base font-bold text-ink">
                        Semana {selectedWeek.weekIndex + 1} · {PHASE_LABELS[selectedWeek.phase]}
                      </h2>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {selectedWeek.weekStartDate}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isGenerating || status === 'committing'}
                    onClick={() => athleteProfile && regenerateWeek(selectedWeek.weekIndex, athleteProfile)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-muted transition-all hover:text-ink disabled:opacity-40"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                  >
                    <RefreshCw size={11} className={selectedWeek.status === 'generating' ? 'animate-spin' : ''} />
                    Regenerar
                  </button>
                </div>

                {selectedWeek.weekObjectives.length > 0 && (
                  <div className="rounded-xl px-3 py-2.5 text-xs"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <p className="font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-ink-faint mb-1.5">Objetivos</p>
                    <ul className="space-y-1">
                      {selectedWeek.weekObjectives.map((obj, i) => (
                        <li key={i} className="flex items-start gap-2 text-ink-muted">
                          <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-brand" />
                          {obj.goal}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedWeek.sessions.length === 0 ? (
                  <div className="py-4 text-center">
                    {selectedWeek.status === 'generating' ? (
                      <>
                        <div className="mb-3 flex justify-center">
                          <RefreshCw size={20} className="animate-spin text-brand" />
                        </div>
                        <p className="text-xs text-ink-muted">Generando sesiones…</p>
                        {streamingTextByWeekIndex[selectedWeek.weekIndex] && (
                          <div className="mt-3 rounded-xl px-3 py-2.5 text-left text-xs text-ink-muted whitespace-pre-wrap"
                            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                            {streamingTextByWeekIndex[selectedWeek.weekIndex]}
                          </div>
                        )}
                      </>
                    ) : selectedWeek.status === 'error' ? (
                      <p className="text-xs text-red-400">
                        Error: {selectedWeek.generationMeta.lastError ?? 'Generación fallida'}
                      </p>
                    ) : (
                      <p className="text-xs text-ink-faint">Sin sesiones todavía.</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedWeek.sessions
                      .slice()
                      .sort((a, b) => (a.date === b.date ? (a.timeBlock > b.timeBlock ? 1 : -1) : a.date.localeCompare(b.date)))
                      .map((s, i) => (
                        <div
                          key={i}
                          className="relative overflow-hidden rounded-xl px-3.5 py-2.5"
                          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                        >
                          {/* Sport color indicator */}
                          <div className="absolute left-0 inset-y-0 w-[3px] rounded-l-xl bg-brand opacity-60" />
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[10px] text-ink-faint">{s.date}</span>
                            <span className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">{s.timeBlock}</span>
                            <span className="rounded-full px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-brand-light"
                              style={{ background: 'rgba(255,77,0,0.12)' }}>
                              {s.sessionType}
                            </span>
                            <span className="font-mono text-[10px] text-ink-faint">{s.durationMin}min</span>
                          </div>
                          <p className="mt-1 text-sm font-semibold text-ink">{s.title}</p>
                          {s.objective && <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{s.objective}</p>}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center">
                <p className="text-sm text-ink-faint">Selecciona una semana</p>
              </div>
            )}
          </div>

          {/* Validation panel */}
          <div
            className="rounded-2xl p-3.5 max-h-[72vh] overflow-y-auto space-y-2"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <p className="font-mono text-[9px] font-bold uppercase tracking-[0.28em] text-ink-faint px-1">
              Validación
            </p>
            {errors.length === 0 && warnings.length === 0 && (
              <div className="rounded-xl px-3 py-2.5 text-xs text-emerald-400 flex items-center gap-1.5"
                style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.18)' }}>
                <CheckCircle2 size={12} /> Sin alertas
              </div>
            )}
            {errors.map((issue, i) => (
              <div key={`e${i}`} className="rounded-xl px-3 py-2.5 text-xs text-red-400 flex items-start gap-2"
                style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.18)' }}>
                <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                <span>{issue.message}</span>
              </div>
            ))}
            {warnings.map((issue, i) => (
              <div key={`w${i}`} className="rounded-xl px-3 py-2.5 text-xs text-amber-400 flex items-start gap-2"
                style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.18)' }}>
                <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                <span>{issue.message}</span>
              </div>
            ))}

            {plan?.generationSummary && (
              <div className="mt-3 pt-3 text-xs text-ink-faint space-y-1"
                style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                <p>Estrategia: <span className="text-ink-muted">{plan.generationSummary.strategy}</span></p>
                <p>{completedWeeks}/{weeks.length} semanas listas</p>
                {failedWeekIndexes.length > 0 && (
                  <p className="text-amber-400">{failedWeekIndexes.length} semana(s) fallida(s)</p>
                )}
              </div>
            )}
          </div>
        </div>
        )}

        {/* Action bar */}
        {status !== 'done' && !shouldShowLaunchDeck && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={isGenerating || status === 'committing' || errors.length > 0 || hasIncompleteWeeks}
              onClick={async () => {
                const result = await acceptPlan()
                if (result.errors.length === 0) navigate(ROUTES.WEEK)
              }}
              className="rounded-xl px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.15em] text-white transition-all active:scale-[0.98] disabled:opacity-40"
              style={{
                background: 'linear-gradient(135deg, #ff5500, #ff4d00)',
                boxShadow: (!isGenerating && errors.length === 0 && !hasIncompleteWeeks)
                  ? '0 8px 28px -8px rgba(255,77,0,0.55)' : 'none',
              }}
            >
              {status === 'committing' ? 'Guardando…' : 'Aceptar plan'}
            </button>
            <button
              type="button"
              disabled={isGenerating || status === 'committing'}
              onClick={async () => { await discard(); navigate(-1) }}
              className="rounded-xl px-5 py-2.5 font-display text-sm font-bold uppercase tracking-[0.15em] text-ink-muted transition-all hover:text-ink disabled:opacity-40"
              style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)' }}
            >
              Descartar
            </button>
            {acceptBlockers.length > 0 && !isGenerating && status !== 'committing' && (
              <p className="text-xs text-ink-faint">{acceptBlockers[0]}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { computeLoadAnalytics, type LoadAnalytics } from '../services/loadAnalytics'
import { AlertTriangle, CheckCircle2, MoreHorizontal, Plus, Trash2, X } from 'lucide-react'
import { useChatStore } from '../store/useChatStore'
import { useCoachActionsStore } from '../store/useCoachActionsStore'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import { useTrainingStore } from '../store/useTrainingStore'
import { CoachEngine } from '../services/ai/CoachEngine'
import { detectChatIntent } from '../services/ai/contextOptimizer'
import { currentWeekStartISO, todayISO } from '../utils/date'
import { getAthleteFirstName, getEnabledSports, getProfileCompleteness } from '../utils/athlete'
import ChatBubble from '../components/chat/ChatBubble'
import ChatInput from '../components/chat/ChatInput'
import Spinner from '../components/ui/Spinner'
import type { ChatContext, CoachProposal } from '../types'
import { ROUTES } from '../constants/routes'

const QuickActionChips = lazy(() => import('../components/chat/QuickActionChips'))
const ProposalDrawer = lazy(() => import('../components/chat/ProposalDrawer'))

const SESSION_TYPE_LABEL: Record<string, string> = {
  squash: 'squash',
  running: 'running',
  strength: 'fuerza',
  mobility: 'movilidad',
  recovery: 'recuperacion',
}

function ContextualProfileBanner({
  completeness,
  onDismiss,
  onGoToSettings,
}: {
  completeness: ReturnType<typeof getProfileCompleteness>
  onDismiss: () => void
  onGoToSettings: () => void
}) {
  const missingText = completeness.missing.join(' y ')
  const recommendedText = completeness.recommended.join(' y ')

  let message = ''
  if (completeness.state === 'missing_profile') {
    message = 'Completa tu perfil para personalizar nombre, deportes, ritmos, cargas y restricciones.'
  } else if (completeness.state === 'missing_sports') {
    message =
      'Indica tu deporte principal y, si aplica, tus deportes secundarios para que el coach sepa que datos pedirte.'
  } else {
    message = `Faltan ${missingText} en tu perfil. El coach seguira usando valores genericos para esa parte.`
    if (recommendedText) message += ` Tambien puedes agregar ${recommendedText}.`
  }

  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2">
      <span className="mt-0.5 flex-shrink-0 text-xs text-amber-400">!</span>
      <span className="flex-1 text-xs leading-relaxed text-amber-300">
        {message}{' '}
        <button
          onClick={onGoToSettings}
          className="underline underline-offset-2 transition-colors hover:text-amber-200"
        >
          Completar perfil
        </button>
      </span>
      <button onClick={onDismiss} className="flex-shrink-0 text-amber-400/60 hover:text-amber-400">
        <X size={12} />
      </button>
    </div>
  )
}

function AcceptedBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
      <CheckCircle2 size={13} className="flex-shrink-0 text-emerald-400" />
      <span className="flex-1 text-xs leading-relaxed text-emerald-300">{message}</span>
      <button onClick={onDismiss} className="text-emerald-400/60 hover:text-emerald-400">
        <X size={12} />
      </button>
    </div>
  )
}

function ProviderBadge({ providerName }: { providerName: string }) {
  const isReal = CoachEngine.isRealProviderConfigured()

  if (providerName === 'mock' || !isReal) {
    return (
      <span className="rounded-full border border-surface-border bg-surface-raised px-2 py-0.5 text-[10px] font-medium text-ink-faint/50">
        Demo
      </span>
    )
  }

  const labels: Record<string, string> = {
    claude: 'Claude AI',
    openai: 'GPT-4o mini',
    gemini: 'Gemini Flash',
    proxy: 'AI via proxy',
  }

  return (
    <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
      {labels[providerName] ?? providerName}
    </span>
  )
}

export default function ChatCoach() {
  const navigate = useNavigate()
  const location = useLocation()
  const { messages, isLoading, streamingText, error, loadHistory, sendMessage, newSession, deleteCurrentSession } =
    useChatStore()
  const { proposals, loadProposals, acceptProposal, rejectProposal } = useCoachActionsStore()
  const { coachMemory, athleteProfile, loadMemory } = useCoachMemoryStore()
  const { sessions, currentWeekSummary, dayLogs, loadWeek } = useTrainingStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  const [activeProposal, setActiveProposal] = useState<CoachProposal | null>(null)
  const [acceptedFeedback, setAcceptedFeedback] = useState<string | null>(null)
  const [proposalError, setProposalError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [profileBannerDismissed, setProfileBannerDismissed] = useState(false)
  const [profileNudgeDismissed, setProfileNudgeDismissed] = useState(false)
  const [loadAnalytics, setLoadAnalytics] = useState<LoadAnalytics | null>(null)
  const locationState = (location.state as { showProfileNudge?: boolean; composerDraft?: string; fromPlanBuilder?: boolean } | null)
  const showProfileNudge = !profileNudgeDismissed && locationState?.showProfileNudge === true
  const composerDraft = locationState?.composerDraft ?? ''
  const showPlanBuilderBanner = locationState?.fromPlanBuilder === true && composerDraft.trim().length > 0
  const hasMessages = messages.length > 0
  const athleteFirstName = getAthleteFirstName(athleteProfile, 'atleta')
  const profileCompleteness = getProfileCompleteness(athleteProfile)
  const showProfileBanner = !profileBannerDismissed && profileCompleteness.state !== 'complete'

  const latestCoachProvider = [...messages].reverse().find((message) => message.role === 'coach')?.provider
  const badgeProviderName = latestCoachProvider ?? CoachEngine.getProviderName()

  useEffect(() => {
    loadHistory()
    loadProposals()
    loadMemory()
    loadWeek(currentWeekStartISO())
  }, [loadHistory, loadProposals, loadMemory, loadWeek])

  useEffect(() => {
    let cancelled = false

    void computeLoadAnalytics(4).then((analytics) => {
      if (!cancelled) setLoadAnalytics(analytics)
    })

    return () => {
      cancelled = true
    }
  }, [sessions, dayLogs, currentWeekSummary])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, isLoading])

  useEffect(() => {
    if (streamingText) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior })
    }
  }, [streamingText])

  const buildContext = (message: string): ChatContext => {
    const sortedSessions = [...sessions]
      .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
    const plannedSessions = sortedSessions.filter(session => session.date >= todayISO())
    const historicalSessions = sortedSessions.filter(
      session => session.status !== 'planned' || session.date < todayISO(),
    )

    return {
      recentSessions: sortedSessions,
      plannedSessions,
      historicalSessions,
      currentWeekSummary: currentWeekSummary ?? undefined,
      dayLog: dayLogs[todayISO()],
      weekDayLogs: Object.values(dayLogs),
      athleteMemory: coachMemory || undefined,
      athleteProfile: athleteProfile ?? undefined,
      intent: detectChatIntent(message),
      loadAnalytics: loadAnalytics ?? undefined,
    }
  }

  const handleSend = (message: string) => sendMessage(message, buildContext(message))

  const handleViewProposal = (proposalId: string) => {
    const proposal = proposals.find((item) => item.id === proposalId)
    if (proposal) setActiveProposal(proposal)
  }

  const handleAccept = async () => {
    if (!activeProposal) return

    const proposal = activeProposal
    const result = await acceptProposal(proposal.id)
    setActiveProposal(null)
    setProposalError(null)

    if (result.errors.length > 0) {
      setProposalError(result.errors.join(' '))
      setTimeout(() => setProposalError(null), 8000)
      return
    }

    const createWeekAction = proposal.actions.find((action) => action.type === 'create_week')
    const warningSuffix = result.warnings.length > 0 ? ` Nota: ${result.warnings.join(' ')}` : ''

    if (createWeekAction?.sessions) {
      const count = createWeekAction.sessions.length
      const typeCounts = createWeekAction.sessions.reduce<Record<string, number>>((acc, session) => {
        acc[session.sessionType] = (acc[session.sessionType] ?? 0) + 1
        return acc
      }, {})
      const typeSummary = Object.entries(typeCounts)
        .map(([type, amount]) => `${amount} ${SESSION_TYPE_LABEL[type] ?? type}`)
        .join(', ')

      setAcceptedFeedback(`Listo. Semana creada con ${count} sesiones: ${typeSummary}.${warningSuffix}`)
      setTimeout(() => navigate(ROUTES.WEEK), 500)
    } else {
      const addAction = proposal.actions.find((action) => action.type === 'add_session')
      const updateAction = proposal.actions.find((action) => action.type === 'update_session')

      if (addAction?.title) {
        setAcceptedFeedback(
          `Sesion "${addAction.title}" agregada${addAction.targetDate ? ` al ${addAction.targetDate}` : ''}.${warningSuffix}`,
        )
      } else if (updateAction) {
        const parts: string[] = []
        if (updateAction.exercises?.length) parts.push(`${updateAction.exercises.length} ejercicios actualizados`)
        if (updateAction.newObjective) parts.push('objetivo actualizado')
        if (updateAction.newRpe != null) parts.push(`RPE -> ${updateAction.newRpe}`)
        if (updateAction.newDurationMin != null) parts.push(`duracion -> ${updateAction.newDurationMin} min`)
        setAcceptedFeedback(`Sesion actualizada${parts.length ? `: ${parts.join(', ')}` : ''}.${warningSuffix}`)
      } else {
        setAcceptedFeedback(
          `${proposal.actions.length} cambio${proposal.actions.length > 1 ? 's' : ''} aplicado${
            proposal.actions.length > 1 ? 's' : ''
          } correctamente.${warningSuffix}`,
        )
      }
    }

    setTimeout(() => setAcceptedFeedback(null), 6000)
  }

  const handleReject = () => {
    if (!activeProposal) return
    void rejectProposal(activeProposal.id)
    setActiveProposal(null)
  }

  return (
    <div className="h-[100dvh] bg-surface">
      <div className="fixed inset-x-0 top-0 z-40 border-b border-surface-border bg-surface/95 px-4 pb-3 pt-12 backdrop-blur md:px-6">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-ink">Coach</h1>
              <p className="mt-0.5 text-[11px] text-ink-faint">Perfil activo: {athleteFirstName}</p>
              <p className="mt-0.5 text-xs text-ink-muted">Planner · Advisor</p>
            </div>
            <ProviderBadge providerName={badgeProviderName} />
          </div>

          <div className="relative flex flex-shrink-0 items-center gap-1.5">
            <button
              onClick={() => {
                setMenuOpen(false)
                void newSession()
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-card px-2.5 py-1.5 text-[11px] font-medium text-ink transition-colors hover:bg-surface-raised"
              title="Empezar un nuevo chat"
            >
              <Plus size={14} />
              <span className="hidden sm:inline">Nuevo</span>
            </button>
            <button
              onClick={() => {
                if (!hasMessages) return
                setMenuOpen(false)
                setDeleteConfirm(true)
              }}
              disabled={!hasMessages}
              className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-card px-2.5 py-1.5 text-[11px] font-medium text-ink transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:text-ink-faint/40"
              title={hasMessages ? 'Borrar conversacion actual' : 'No hay mensajes en esta conversacion'}
            >
              <Trash2 size={14} />
              <span className="hidden sm:inline">Borrar</span>
            </button>
            <button
              onClick={() => setMenuOpen((open) => !open)}
              className="p-1 text-ink-faint transition-colors hover:text-ink-muted"
              title="Mas opciones del chat"
            >
              <MoreHorizontal size={18} />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full z-10 mt-2 w-44 rounded-lg border border-surface-border bg-surface-card shadow-lg">
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    void newSession()
                  }}
                  className="w-full border-b border-surface-border px-3 py-2 text-left text-xs text-ink transition-colors hover:bg-surface-raised"
                >
                  Nuevo chat
                </button>
                <button
                  onClick={() => {
                    if (!hasMessages) return
                    setMenuOpen(false)
                    setDeleteConfirm(true)
                  }}
                  disabled={!hasMessages}
                  className="w-full px-3 py-2 text-left text-xs text-ink transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:text-ink-faint/40"
                  title={hasMessages ? 'Borrar conversacion actual' : 'No hay mensajes en esta conversacion'}
                >
                  Borrar conversacion
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="h-full overflow-y-auto px-4 pb-[228px] pt-[108px] md:px-6 md:pb-[208px]">
        <div className="mx-auto w-full max-w-3xl space-y-4 py-4">
          {showProfileNudge && (
            <div className="flex items-start gap-2 rounded-xl border border-brand/20 bg-brand/10 px-3 py-2">
              <span className="mt-0.5 flex-shrink-0 text-xs text-brand-light">💡</span>
              <span className="flex-1 text-xs leading-relaxed text-brand-light">
                Perfil básico guardado. Para propuestas más precisas, agrega tus{' '}
                <button
                  onClick={() => navigate(ROUTES.SETTINGS)}
                  className="font-semibold underline underline-offset-2 hover:text-white"
                >
                  ritmos de running y RMs de pesas
                </button>{' '}
                en Ajustes → Perfil del atleta.
              </span>
              <button onClick={() => setProfileNudgeDismissed(true)} className="flex-shrink-0 text-brand-light/60 hover:text-brand-light">
                <X size={12} />
              </button>
            </div>
          )}

          {showPlanBuilderBanner && (
            <div className="flex items-start gap-2 rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-2">
              <span className="mt-0.5 flex-shrink-0 text-xs text-sky-300">i</span>
              <span className="flex-1 text-xs leading-relaxed text-sky-200">
                Llegaste desde el <span className="font-semibold">Plan Builder</span>. Revisa el prompt estructurado abajo, ajusta si hace falta y envíalo al coach para generar tu semana.
              </span>
            </div>
          )}

          {showProfileBanner && (
            <ContextualProfileBanner
              completeness={profileCompleteness}
              onDismiss={() => setProfileBannerDismissed(true)}
              onGoToSettings={() => navigate(ROUTES.SETTINGS)}
            />
          )}

          {messages.length === 0 && !isLoading && (
            <div className="flex min-h-[45vh] flex-col items-center justify-center gap-3 px-4 text-center md:px-6">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/15">
                <span className="text-2xl">🏋️</span>
              </div>
              <p className="font-medium text-ink">Tu coach-planner</p>
              <p className="text-sm leading-relaxed text-ink-muted">
                Pideme que cree tu semana, agregue sesiones o ajuste tu plan. Tambien puedo analizar tu progreso y
                darte recomendaciones.
              </p>
              {profileCompleteness.state !== 'complete' && (
                <p className="mt-1 text-xs text-ink-faint">
                  Para propuestas mas precisas,{' '}
                  <button
                    onClick={() => navigate(ROUTES.SETTINGS)}
                    className="underline underline-offset-2 transition-colors hover:text-ink-muted"
                  >
                    completa tu perfil
                  </button>
                  .
                </p>
              )}
            </div>
          )}

          {messages.map((message) => {
            const proposal = message.proposalId ? proposals.find((item) => item.id === message.proposalId) : undefined
            const isPending = proposal?.status === 'pending'

            return (
              <ChatBubble
                key={message.id}
                message={message}
                hasProposal={isPending}
                onViewProposal={
                  isPending && message.proposalId ? () => handleViewProposal(message.proposalId as string) : undefined
                }
              />
            )
          })}

          {isLoading &&
            (streamingText ? (
              <div className="flex items-start gap-2">
                <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand/20">
                  <span className="text-sm">🏋️</span>
                </div>
                <div className="max-w-[90%] rounded-2xl rounded-tl-sm border border-surface-border bg-surface-card px-4 py-3 md:max-w-[85%]">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{streamingText}</p>
                  <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-brand/70 align-middle" />
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/20">
                  <span className="text-sm">🏋️</span>
                </div>
                <div className="rounded-2xl rounded-tl-sm border border-surface-border bg-surface-card px-4 py-3">
                  <Spinner />
                </div>
              </div>
            ))}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-surface-border bg-surface/95 px-4 pb-28 pt-2 backdrop-blur md:px-6">
        <div className="mx-auto w-full max-w-3xl space-y-2">
          {acceptedFeedback && <AcceptedBanner message={acceptedFeedback} onDismiss={() => setAcceptedFeedback(null)} />}

          {proposalError && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0 text-red-400" />
              <span className="flex-1 text-xs leading-relaxed text-red-400">{proposalError}</span>
              <button onClick={() => setProposalError(null)} className="text-red-400/60 hover:text-red-400">
                <X size={12} />
              </button>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2">
              <span className="text-xs leading-relaxed text-red-400">{error}</span>
            </div>
          )}

          <Suspense fallback={<div className="h-8" />}>
            <QuickActionChips
              onSelect={handleSend}
              onOpenPlanBuilder={() => navigate(ROUTES.PLAN_BUILDER)}
              disabled={isLoading}
              enabledSports={getEnabledSports(athleteProfile)}
            />
          </Suspense>

          <ChatInput onSend={handleSend} disabled={isLoading} initialValue={composerDraft} />
        </div>
      </div>

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 max-w-sm rounded-2xl border border-surface-border bg-surface-card p-5">
            <h3 className="mb-2 text-sm font-semibold text-ink">Borrar conversacion</h3>
            <p className="mb-4 text-xs leading-relaxed text-ink-muted">
              ¿Seguro que quieres borrar esta conversacion? No se puede deshacer, pero el historial anterior se
              mantiene.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(false)}
                className="rounded-lg px-3 py-2 text-xs text-ink-muted transition-colors hover:bg-surface-raised"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  setDeleteConfirm(false)
                  await deleteCurrentSession()
                }}
                className="rounded-lg bg-red-500/20 px-3 py-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/30"
              >
                Borrar
              </button>
            </div>
          </div>
        </div>
      )}

      {activeProposal && (
        <Suspense fallback={null}>
          <ProposalDrawer
            proposal={activeProposal}
            existingSessions={sessions}
            onAccept={handleAccept}
            onReject={handleReject}
            onClose={() => setActiveProposal(null)}
          />
        </Suspense>
      )}
    </div>
  )
}

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, X, MoreHorizontal } from 'lucide-react'
import { useChatStore } from '../store/useChatStore'
import { useCoachActionsStore } from '../store/useCoachActionsStore'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import { useTrainingStore } from '../store/useTrainingStore'
import { CoachEngine } from '../services/ai/CoachEngine'
import { detectChatIntent } from '../services/ai/contextOptimizer'
import { currentWeekStartISO, todayISO } from '../utils/date'
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


// ─── Accepted feedback banner ─────────────────────────────────────────────────

function AcceptedBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
      <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />
      <span className="text-emerald-300 text-xs leading-relaxed flex-1">{message}</span>
      <button onClick={onDismiss} className="text-emerald-400/60 hover:text-emerald-400">
        <X size={12} />
      </button>
    </div>
  )
}

// ─── Provider badge ────────────────────────────────────────────────────────────

function ProviderBadge({ providerName }: { providerName: string }) {
  const isReal = CoachEngine.isRealProviderConfigured()

  if (providerName === 'mock' || !isReal) {
    return (
      <span className="text-[10px] text-ink-faint/50 font-medium px-2 py-0.5 rounded-full bg-surface-raised border border-surface-border">
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
    <span className="text-[10px] text-emerald-400 font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
      {labels[providerName] ?? providerName}
    </span>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function ChatCoach() {
  const navigate = useNavigate()
  const { messages, isLoading, streamingText, error, loadHistory, sendMessage, newSession, deleteCurrentSession } = useChatStore()
  const { proposals, loadProposals, acceptProposal, rejectProposal } = useCoachActionsStore()
  const { coachMemory, loadMemory } = useCoachMemoryStore()
  const { sessions, currentWeekSummary, dayLogs, loadWeek } = useTrainingStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  const [activeProposal, setActiveProposal] = useState<CoachProposal | null>(null)
  const [acceptedFeedback, setAcceptedFeedback] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const hasMessages = messages.length > 0

  const latestCoachProvider =
    [...messages].reverse().find(message => message.role === 'coach')?.provider
  const badgeProviderName = latestCoachProvider ?? CoachEngine.getProviderName()

  useEffect(() => {
    loadHistory()
    loadProposals()
    loadMemory()
    loadWeek(currentWeekStartISO())
  }, [loadHistory, loadProposals, loadMemory, loadWeek])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, isLoading])

  useEffect(() => {
    if (streamingText) bottomRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior })
  }, [streamingText])

  const buildContext = (message: string): ChatContext => {
    const recentSessions = [...sessions]
      .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
      .slice(-14)

    return {
      recentSessions,
      currentWeekSummary: currentWeekSummary ?? undefined,
      dayLog: dayLogs[todayISO()],
      weekDayLogs: Object.values(dayLogs),
      athleteMemory: coachMemory || undefined,
      intent: detectChatIntent(message),
    }
  }

  const handleSend = (msg: string) => sendMessage(msg, buildContext(msg))

  const handleViewProposal = (proposalId: string) => {
    const p = proposals.find(p => p.id === proposalId)
    if (p) setActiveProposal(p)
  }

  const handleAccept = async () => {
    if (!activeProposal) return
    const proposal = activeProposal
    const result = await acceptProposal(proposal.id)
    setActiveProposal(null)

    // Generate confirmation summary
    const createWeekAction = proposal.actions.find(a => a.type === 'create_week')
    const warningSuffix = result.warnings.length > 0 ? ` Nota: ${result.warnings.join(' ')}` : ''
    if (createWeekAction?.sessions) {
      const count = createWeekAction.sessions.length
      const typeCounts = createWeekAction.sessions.reduce<Record<string, number>>((acc, s) => {
        acc[s.sessionType] = (acc[s.sessionType] ?? 0) + 1
        return acc
      }, {})
      const typeStr = Object.entries(typeCounts)
        .map(([t, n]) => `${n} ${SESSION_TYPE_LABEL[t] ?? t}`)
        .join(', ')
      setAcceptedFeedback(`Listo. Semana creada con ${count} sesiones: ${typeStr}.${warningSuffix}`)
      // Navigate to week view after create_week
      setTimeout(() => navigate(ROUTES.WEEK), 500)
    } else {
      const addAction = proposal.actions.find(a => a.type === 'add_session')
      const updateAction = proposal.actions.find(a => a.type === 'update_session')
      if (addAction?.title) {
        setAcceptedFeedback(`Sesión "${addAction.title}" agregada${addAction.targetDate ? ` al ${addAction.targetDate}` : ''}.${warningSuffix}`)
      } else if (updateAction) {
        const parts: string[] = []
        if (updateAction.exercises?.length) parts.push(`${updateAction.exercises.length} ejercicios actualizados`)
        if (updateAction.newObjective) parts.push('objetivo actualizado')
        if (updateAction.newRpe != null) parts.push(`RPE → ${updateAction.newRpe}`)
        if (updateAction.newDurationMin != null) parts.push(`duración → ${updateAction.newDurationMin}min`)
        setAcceptedFeedback(`Sesión actualizada${parts.length ? ': ' + parts.join(', ') : ''}.${warningSuffix}`)
      } else {
        setAcceptedFeedback(`${proposal.actions.length} cambio${proposal.actions.length > 1 ? 's' : ''} aplicado${proposal.actions.length > 1 ? 's' : ''} correctamente.${warningSuffix}`)
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
    <div className="flex flex-col h-[100dvh]">
      {/* Header */}
      <div className="pt-12 px-4 pb-3 border-b border-surface-border flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div>
              <h1 className="text-xl font-bold text-ink">Coach</h1>
              <p className="text-xs text-ink-muted mt-0.5">Planner · Advisor</p>
            </div>
            <ProviderBadge providerName={badgeProviderName} />
          </div>
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="text-ink-faint hover:text-ink-muted transition-colors p-1"
              title="Opciones de chat"
            >
              <MoreHorizontal size={18} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-1 w-44 bg-surface-card border border-surface-border rounded-lg shadow-lg z-10">
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    void newSession()
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-ink hover:bg-surface-raised transition-colors border-b border-surface-border"
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
                  className="w-full text-left px-3 py-2 text-xs transition-colors disabled:text-ink-faint/40 disabled:cursor-not-allowed text-ink hover:bg-surface-raised"
                  title={hasMessages ? 'Borrar conversación actual' : 'No hay mensajes en esta conversación'}
                >
                  Borrar conversación
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
            <div className="w-14 h-14 rounded-full bg-brand/15 flex items-center justify-center">
              <span className="text-2xl">🏋️</span>
            </div>
            <p className="text-ink font-medium">Tu coach-planner</p>
            <p className="text-sm text-ink-muted leading-relaxed">
              Pídeme que cree tu semana, agregue sesiones o ajuste tu plan.
              También puedo analizar tu progreso y darte recomendaciones.
            </p>
          </div>
        )}

        {messages.map(msg => {
          const proposal = msg.proposalId
            ? proposals.find(p => p.id === msg.proposalId)
            : undefined
          const isPending = proposal?.status === 'pending'

          return (
            <ChatBubble
              key={msg.id}
              message={msg}
              hasProposal={isPending}
              onViewProposal={isPending && msg.proposalId
                ? () => handleViewProposal(msg.proposalId!)
                : undefined}
            />
          )
        })}

        {isLoading && (
          streamingText ? (
            <div className="flex gap-2 items-start">
              <div className="w-7 h-7 rounded-full bg-brand/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-sm">🏋️</span>
              </div>
              <div className="bg-surface-card border border-surface-border rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%]">
                <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{streamingText}</p>
                <span className="inline-block w-0.5 h-3.5 bg-brand/70 animate-pulse ml-0.5 align-middle" />
              </div>
            </div>
          ) : (
            <div className="flex gap-2 items-center">
              <div className="w-7 h-7 rounded-full bg-brand/20 flex items-center justify-center">
                <span className="text-sm">🏋️</span>
              </div>
              <div className="bg-surface-card border border-surface-border rounded-2xl rounded-tl-sm px-4 py-3">
                <Spinner />
              </div>
            </div>
          )
        )}

        <div ref={bottomRef} />
      </div>

      {/* Quick actions + input */}
      <div className="flex-shrink-0 px-4 pb-28 pt-2 border-t border-surface-border space-y-2 bg-surface">
        {acceptedFeedback && (
          <AcceptedBanner
            message={acceptedFeedback}
            onDismiss={() => setAcceptedFeedback(null)}
          />
        )}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20">
            <span className="text-red-400 text-xs leading-relaxed">{error}</span>
          </div>
        )}
        <Suspense fallback={<div className="h-8" />}>
          <QuickActionChips onSelect={handleSend} disabled={isLoading} />
        </Suspense>
        <ChatInput onSend={handleSend} disabled={isLoading} />
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-card border border-surface-border rounded-2xl p-5 max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-ink mb-2">Borrar conversación</h3>
            <p className="text-xs text-ink-muted mb-4 leading-relaxed">
              ¿Seguro que quieres borrar esta conversación? No se puede deshacer, pero el historial anterior se mantiene.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(false)}
                className="text-xs px-3 py-2 rounded-lg text-ink-muted hover:bg-surface-raised transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  setDeleteConfirm(false)
                  await deleteCurrentSession()
                }}
                className="text-xs px-3 py-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors font-medium"
              >
                Borrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Proposal drawer */}
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

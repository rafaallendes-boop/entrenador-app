import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, X, Zap } from 'lucide-react'
import { useChatStore } from '../store/useChatStore'
import { useCoachActionsStore } from '../store/useCoachActionsStore'
import { useTrainingStore } from '../store/useTrainingStore'
import { CoachEngine } from '../services/ai/CoachEngine'
import { currentWeekStartISO, todayISO } from '../utils/date'
import ChatBubble from '../components/chat/ChatBubble'
import ChatInput from '../components/chat/ChatInput'
import QuickActionChips from '../components/chat/QuickActionChips'
import Spinner from '../components/ui/Spinner'
import type { ChatContext, CoachProposal } from '../types'

// ─── Coach action types (display labels) ──────────────────────────────────────

const ACTION_LABEL: Record<string, string> = {
  skip_session: 'Saltar sesión',
  change_rpe: 'Cambiar RPE',
  shorten_session: 'Acortar sesión',
  lengthen_session: 'Alargar sesión',
  move_session: 'Mover sesión',
  replace_session_type: 'Cambiar tipo',
  insert_recovery: 'Insertar recuperación',
}

// ─── Proposal drawer ───────────────────────────────────────────────────────────

function ProposalDrawer({
  proposal,
  onAccept,
  onReject,
  onClose,
}: {
  proposal: CoachProposal
  onAccept: () => void
  onReject: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-card rounded-t-2xl border-t border-surface-border max-h-[70vh] overflow-y-auto">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-surface-border" />
        </div>
        <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-amber-400" />
            <h2 className="text-sm font-semibold text-ink">Propuesta del coach</h2>
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink p-1">
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          <p className="text-xs text-ink-muted leading-relaxed">{proposal.message}</p>

          <div className="space-y-2">
            {proposal.actions.map((action, i) => (
              <div key={i} className="flex items-start gap-3 bg-surface-raised rounded-xl p-3">
                <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider mt-0.5 w-24 flex-shrink-0">
                  {ACTION_LABEL[action.type] ?? action.type}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-ink-muted">{action.reason}</p>
                  {'newRpe' in action && action.newRpe != null && (
                    <p className="text-[11px] text-ink-faint mt-0.5">RPE → {action.newRpe}</p>
                  )}
                  {'newDurationMin' in action && action.newDurationMin != null && (
                    <p className="text-[11px] text-ink-faint mt-0.5">Duración → {action.newDurationMin} min</p>
                  )}
                  {'targetDate' in action && action.targetDate && (
                    <p className="text-[11px] text-ink-faint mt-0.5">Fecha → {action.targetDate}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={onReject}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-ink-muted bg-surface-raised border border-surface-border hover:border-red-500/30 hover:text-red-400 transition-colors"
            >
              Rechazar
            </button>
            <button
              onClick={onAccept}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-brand hover:bg-brand-light active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <CheckCircle2 size={14} />
              Aplicar cambios
            </button>
          </div>
        </div>
      </div>
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
  const { messages, isLoading, error, loadHistory, sendMessage, clearChat } = useChatStore()
  const { proposals, acceptProposal, rejectProposal } = useCoachActionsStore()
  const { sessions, currentWeekSummary, dayLogs, loadWeek } = useTrainingStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  const [activeProposal, setActiveProposal] = useState<CoachProposal | null>(null)
  const latestCoachProvider =
    [...messages].reverse().find(message => message.role === 'coach')?.provider
  const badgeProviderName = latestCoachProvider ?? CoachEngine.getProviderName()

  useEffect(() => {
    loadHistory()
    loadWeek(currentWeekStartISO())
  }, [loadHistory, loadWeek])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, isLoading])

  const buildContext = (): ChatContext => {
    const recentSessions = [...sessions]
      .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
      .slice(-14) // send up to 2 weeks for better context

    return {
      recentSessions,
      currentWeekSummary: currentWeekSummary ?? undefined,
      dayLog: dayLogs[todayISO()],
    }
  }

  const handleSend = (msg: string) => sendMessage(msg, buildContext())

  const handleViewProposal = (proposalId: string) => {
    const p = proposals.find(p => p.id === proposalId)
    if (p) setActiveProposal(p)
  }

  const handleAccept = async () => {
    if (!activeProposal) return
    await acceptProposal(activeProposal.id)
    setActiveProposal(null)
  }

  const handleReject = () => {
    if (!activeProposal) return
    rejectProposal(activeProposal.id)
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
              <p className="text-xs text-ink-muted mt-0.5">Tu asistente de entrenamiento</p>
            </div>
            <ProviderBadge providerName={badgeProviderName} />
          </div>
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="text-xs text-ink-faint hover:text-ink-muted transition-colors"
            >
              Limpiar
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
            <div className="w-14 h-14 rounded-full bg-brand/15 flex items-center justify-center">
              <span className="text-2xl">🏋️</span>
            </div>
            <p className="text-ink font-medium">Tu coach digital</p>
            <p className="text-sm text-ink-muted leading-relaxed">
              Hazme cualquier pregunta sobre tu entrenamiento, pídeme que ajuste tu semana
              o cuéntame cómo te sientes.
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
          <div className="flex gap-2 items-center">
            <div className="w-7 h-7 rounded-full bg-brand/20 flex items-center justify-center">
              <span className="text-sm">🏋️</span>
            </div>
            <div className="bg-surface-card border border-surface-border rounded-2xl rounded-tl-sm px-4 py-3">
              <Spinner />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Quick actions + input */}
      <div className="flex-shrink-0 px-4 pb-28 pt-2 border-t border-surface-border space-y-2 bg-surface">
        {error && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20">
            <span className="text-red-400 text-xs leading-relaxed">{error}</span>
          </div>
        )}
        <QuickActionChips onSelect={handleSend} disabled={isLoading} />
        <ChatInput onSend={handleSend} disabled={isLoading} />
      </div>

      {/* Proposal drawer */}
      {activeProposal && (
        <ProposalDrawer
          proposal={activeProposal}
          onAccept={handleAccept}
          onReject={handleReject}
          onClose={() => setActiveProposal(null)}
        />
      )}
    </div>
  )
}

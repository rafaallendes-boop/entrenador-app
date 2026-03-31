import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, X, Zap, MoreHorizontal } from 'lucide-react'
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
  add_session: 'Agregar sesión',
  create_week: 'Crear semana',
  delete_session: 'Eliminar sesión',
  update_session: 'Actualizar sesión',
}

const SESSION_TYPE_LABEL: Record<string, string> = {
  squash: 'squash', running: 'running', strength: 'fuerza',
  mobility: 'movilidad', recovery: 'recuperación',
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
  // Count total sessions for create_week proposals
  const createWeekAction = proposal.actions.find(a => a.type === 'create_week')
  const totalSessions = createWeekAction?.sessions?.length ?? 0

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-card rounded-t-2xl border-t border-surface-border max-h-[80vh] overflow-y-auto">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-surface-border" />
        </div>
        <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-amber-400" />
            <h2 className="text-sm font-semibold text-ink">
              {createWeekAction
                ? `Semana propuesta · ${totalSessions} sesiones`
                : 'Propuesta del coach'}
            </h2>
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink p-1">
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          <p className="text-xs text-ink-muted leading-relaxed">{proposal.message}</p>

          <div className="space-y-2">
            {proposal.actions.map((action, i) => (
              <div key={i} className="bg-surface-raised rounded-xl p-3">
                <div className="flex items-start gap-3">
                  <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider mt-0.5 w-24 flex-shrink-0">
                    {ACTION_LABEL[action.type] ?? action.type}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-ink-muted">{action.reason}</p>

                    {action.newRpe != null && (
                      <p className="text-[11px] text-ink-faint mt-0.5">RPE → {action.newRpe}</p>
                    )}
                    {action.newDurationMin != null && (
                      <p className="text-[11px] text-ink-faint mt-0.5">Duración → {action.newDurationMin} min</p>
                    )}
                    {action.targetDate != null && action.type === 'move_session' && (
                      <p className="text-[11px] text-ink-faint mt-0.5">Mover a → {action.targetDate}</p>
                    )}

                    {/* add_session details */}
                    {action.type === 'add_session' && (
                      <div className="mt-1.5 space-y-0.5">
                        {action.targetDate && (
                          <p className="text-[11px] text-ink-faint">
                            {action.targetDate} {action.timeBlock}
                          </p>
                        )}
                        {action.title && (
                          <p className="text-[11px] text-ink-faint">
                            {action.title}
                            {action.durationMin ? ` · ${action.durationMin}min` : ''}
                            {action.newRpe ? ` · RPE${action.newRpe}` : ''}
                          </p>
                        )}
                      </div>
                    )}

                    {/* create_week session list */}
                    {action.type === 'create_week' && action.sessions && (
                      <div className="mt-2 space-y-2 border-t border-surface-border pt-2">
                        {action.weekObjectives && action.weekObjectives.length > 0 && (
                          <div className="mb-1">
                            <p className="text-[10px] text-ink-faint/60 uppercase tracking-wide mb-0.5">Objetivos</p>
                            {action.weekObjectives.map((obj, oi) => (
                              <p key={oi} className="text-[11px] text-ink-faint">· {obj}</p>
                            ))}
                          </div>
                        )}
                        {action.sessions.map((s, si) => (
                          <div key={si}>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-ink-faint/60 w-20 flex-shrink-0">
                                {s.date} {s.timeBlock}
                              </span>
                              <span className="text-[11px] text-ink-faint">
                                {SESSION_TYPE_LABEL[s.sessionType] ?? s.sessionType} · {s.title} · {s.durationMin}min
                                {s.rpe ? ` RPE${s.rpe}` : ''}
                              </span>
                            </div>
                            {s.exercises && s.exercises.length > 0 && (
                              <div className="ml-20 mt-0.5">
                                {s.exercises.slice(0, 4).map((ex, ei) => (
                                  <span key={ei} className="text-[10px] text-ink-faint/70 mr-2">
                                    {ex.name} {ex.sets}×{ex.reps}{ex.weight ? ` ${ex.weight}kg` : ''}
                                  </span>
                                ))}
                                {s.exercises.length > 4 && (
                                  <span className="text-[10px] text-ink-faint/50">+{s.exercises.length - 4} más</span>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* update_session details */}
                    {action.type === 'update_session' && (
                      <div className="mt-1.5 space-y-0.5">
                        {action.newTitle && (
                          <p className="text-[11px] text-ink-faint">Título → {action.newTitle}</p>
                        )}
                        {action.newObjective && (
                          <p className="text-[11px] text-ink-faint">Objetivo → {action.newObjective}</p>
                        )}
                        {action.newRpe != null && (
                          <p className="text-[11px] text-ink-faint">RPE → {action.newRpe}</p>
                        )}
                        {action.newDurationMin != null && (
                          <p className="text-[11px] text-ink-faint">Duración → {action.newDurationMin} min</p>
                        )}
                        {action.exercises && action.exercises.length > 0 && (
                          <div className="mt-1">
                            <p className="text-[10px] text-ink-faint/60 uppercase tracking-wide">Ejercicios ({action.exercises.length})</p>
                            {action.exercises.slice(0, 5).map((ex, ei) => (
                              <p key={ei} className="text-[10px] text-ink-faint">
                                {ex.name} {ex.sets}×{ex.reps}{ex.weight ? ` ${ex.weight}kg` : ''}
                              </p>
                            ))}
                            {action.exercises.length > 5 && (
                              <p className="text-[10px] text-ink-faint/50">+{action.exercises.length - 5} más</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
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
  const { messages, isLoading, error, loadHistory, sendMessage, newSession, deleteCurrentSession } = useChatStore()
  const { proposals, acceptProposal, rejectProposal } = useCoachActionsStore()
  const { sessions, currentWeekSummary, dayLogs, loadWeek } = useTrainingStore()
  const bottomRef = useRef<HTMLDivElement>(null)

  const [activeProposal, setActiveProposal] = useState<CoachProposal | null>(null)
  const [acceptedFeedback, setAcceptedFeedback] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

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
      .slice(-14)

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
    const proposal = activeProposal
    await acceptProposal(proposal.id)
    setActiveProposal(null)

    // Generate confirmation summary
    const createWeekAction = proposal.actions.find(a => a.type === 'create_week')
    if (createWeekAction?.sessions) {
      const count = createWeekAction.sessions.length
      const typeCounts = createWeekAction.sessions.reduce<Record<string, number>>((acc, s) => {
        acc[s.sessionType] = (acc[s.sessionType] ?? 0) + 1
        return acc
      }, {})
      const typeStr = Object.entries(typeCounts)
        .map(([t, n]) => `${n} ${SESSION_TYPE_LABEL[t] ?? t}`)
        .join(', ')
      setAcceptedFeedback(`Listo. Semana creada con ${count} sesiones: ${typeStr}.`)
    } else {
      const addAction = proposal.actions.find(a => a.type === 'add_session')
      const updateAction = proposal.actions.find(a => a.type === 'update_session')
      if (addAction?.title) {
        setAcceptedFeedback(`Sesión "${addAction.title}" agregada${addAction.targetDate ? ` al ${addAction.targetDate}` : ''}.`)
      } else if (updateAction) {
        const parts: string[] = []
        if (updateAction.exercises?.length) parts.push(`${updateAction.exercises.length} ejercicios actualizados`)
        if (updateAction.newObjective) parts.push('objetivo actualizado')
        if (updateAction.newRpe != null) parts.push(`RPE → ${updateAction.newRpe}`)
        if (updateAction.newDurationMin != null) parts.push(`duración → ${updateAction.newDurationMin}min`)
        setAcceptedFeedback(`Sesión actualizada${parts.length ? ': ' + parts.join(', ') : ''}.`)
      } else {
        setAcceptedFeedback(`${proposal.actions.length} cambio${proposal.actions.length > 1 ? 's' : ''} aplicado${proposal.actions.length > 1 ? 's' : ''} correctamente.`)
      }
    }

    setTimeout(() => setAcceptedFeedback(null), 6000)
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
              <p className="text-xs text-ink-muted mt-0.5">Planner · Advisor</p>
            </div>
            <ProviderBadge providerName={badgeProviderName} />
          </div>
          {messages.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="text-ink-faint hover:text-ink-muted transition-colors p-1"
                title="Opciones de chat"
              >
                <MoreHorizontal size={18} />
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-1 w-40 bg-surface-card border border-surface-border rounded-lg shadow-lg z-10">
                  <button
                    onClick={() => {
                      setMenuOpen(false)
                      newSession()
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-ink hover:bg-surface-raised transition-colors border-b border-surface-border"
                  >
                    Nuevo chat
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false)
                      setDeleteConfirm(true)
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-ink hover:bg-surface-raised transition-colors"
                  >
                    Borrar conversación
                  </button>
                </div>
              )}
            </div>
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
        <QuickActionChips onSelect={handleSend} disabled={isLoading} />
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

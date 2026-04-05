import { Clock, Flame, ChevronDown, ChevronUp, Trash2, Wind } from 'lucide-react'
import { useState } from 'react'
import type { Session, SessionStatus } from '../../types'
import { SESSION_TYPE_CONFIG, SQUASH_SUBTYPE_LABELS } from '../../constants/sessionTypes'
import { formatDuration } from '../../utils/format'
import SessionTypeIcon from './SessionTypeIcon'
import ExerciseChecklist from './ExerciseChecklist'
import { useTrainingStore } from '../../store/useTrainingStore'

const STATUS_CONFIG: Record<SessionStatus, { label: string; badge: string; icon: string }> = {
  planned: { label: 'Planificado', badge: 'bg-surface-raised text-ink-faint border border-surface-border', icon: '?' },
  completed: { label: 'Realizado', badge: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25', icon: '?' },
  adjusted: { label: 'Ajustado', badge: 'bg-amber-500/15 text-amber-400 border border-amber-500/25', icon: '~' },
  skipped: { label: 'Saltado', badge: 'bg-red-500/15 text-red-400 border border-red-500/25', icon: '?' },
}

const RUNNING_TYPE_LABELS: Record<string, string> = {
  z2: 'Z2 Aerobico', tempo: 'Tempo', intervals: 'Intervalos', long: 'Long Run',
}

const MATCH_RESULT_LABELS = { win: 'Gano', loss: 'Perdio' } as const

interface SessionCardProps {
  session: Session
  compact?: boolean
  onDelete?: (session: Session) => void
}

export default function SessionCard({ session, compact = false, onDelete }: SessionCardProps) {
  const [expanded, setExpanded] = useState(false)
  const cycleStatus = useTrainingStore((s) => s.cycleSessionStatus)
  const config = SESSION_TYPE_CONFIG[session.type]
  const statusCfg = STATUS_CONFIG[session.status]

  const hasExercises =
    (session.type === 'strength' || session.type === 'mobility') &&
    session.exercises &&
    session.exercises.length > 0
  const hasRunningDetails = (session.type === 'running' || session.type === 'cycling') && session.runningDetails
  const hasSquashDetails =
    session.type === 'squash' && session.squashDetails && session.squashDetails.drills.length > 0
  const hasProtocols = Boolean(session.warmup?.length || session.cooldown?.length)
  const hasMatchMeta =
    session.type === 'squash' &&
    (session.subtype === 'match' || session.subtype === 'competitive') &&
    (session.matchResult ||
      session.opponent ||
      session.gamesWon != null ||
      session.gamesLost != null ||
      session.location)
  const isExpandable = hasExercises || session.objective || session.notes || hasRunningDetails || hasMatchMeta || hasSquashDetails || hasProtocols
  const subtypeLabel = session.subtype ? SQUASH_SUBTYPE_LABELS[session.subtype] : null
  const isSkipped = session.status === 'skipped'
  const showMatchBadge = hasMatchMeta && session.matchResult
  const matchBadgeClass =
    session.matchResult === 'win'
      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
      : 'bg-rose-500/15 text-rose-400 border border-rose-500/25'

  return (
    <div
      className={`rounded-xl border ${config.borderClass} ${config.bgClass} overflow-hidden transition-opacity ${
        isSkipped ? 'opacity-50' : ''
      }`}
    >
      <div
        className={`flex items-start gap-3 p-3 md:p-4 ${isExpandable ? 'cursor-pointer' : ''}`}
        onClick={() => isExpandable && setExpanded((e) => !e)}
      >
        <SessionTypeIcon type={session.type} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`truncate text-sm font-medium ${isSkipped ? 'line-through text-ink-muted' : 'text-ink'}`}>
              {session.title}
            </span>
            {session.source === 'coach' && (
              <span className="rounded-full border border-brand/25 bg-brand/10 px-1.5 py-0.5 text-xs font-medium text-brand-light">
                Coach
              </span>
            )}
            {subtypeLabel && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full border ${config.borderClass} ${config.textClass} font-medium flex-shrink-0`}
              >
                {subtypeLabel}
              </span>
            )}
            {showMatchBadge && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${matchBadgeClass}`}>
                {MATCH_RESULT_LABELS[session.matchResult!]}
              </span>
            )}
            {hasRunningDetails && session.runningDetails && (
              <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-xs font-medium text-sky-400 flex-shrink-0">
                {RUNNING_TYPE_LABELS[session.runningDetails.runningType] ?? session.runningDetails.runningType}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="flex items-center gap-1 text-xs text-ink-muted">
              <Clock size={11} />
              {formatDuration(session.durationMin)}
            </span>
            {session.rpe != null && (
              <span className="flex items-center gap-1 text-xs text-ink-muted">
                <Flame size={11} />
                {session.actualRpe != null && session.status === 'completed' ? `RPE real ${session.actualRpe}` : `RPE ${session.rpe}`}
              </span>
            )}
            {hasRunningDetails && session.runningDetails?.targetPaceMin && (
              <span className="flex items-center gap-1 text-xs text-sky-400">
                <Wind size={11} />
                {session.runningDetails.targetPaceMin}
                {session.runningDetails.targetPaceMax ? `-${session.runningDetails.targetPaceMax}` : ''} /km
              </span>
            )}
            {session.opponent && <span className="text-xs text-ink-faint">vs {session.opponent}</span>}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2 self-start md:self-center">
          {onDelete && !compact && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete(session)
              }}
              title="Eliminar sesion"
              className="rounded-lg p-2 text-rose-400 transition-colors hover:bg-rose-500/10"
            >
              <Trash2 size={14} />
            </button>
          )}
          {!compact && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                cycleStatus(session.id)
              }}
              title="Cambiar estado"
              className={`text-xs px-2 py-1 rounded-lg font-medium flex items-center gap-1 transition-all active:scale-95 whitespace-nowrap ${statusCfg.badge}`}
            >
              <span className="text-[11px] leading-none">{statusCfg.icon}</span>
              <span className="hidden sm:inline">{statusCfg.label}</span>
            </button>
          )}
          {compact && <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${statusCfg.badge}`}>{statusCfg.icon}</span>}
          {isExpandable && <span className="text-ink-faint">{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>}
        </div>
      </div>
      {expanded && (
        <div className="space-y-2 border-t border-white/5 px-3 pb-3 md:px-4 md:pb-4">
          {session.objective && (
            <p className="mt-2 text-xs text-ink-muted">
              <span className="mr-1 text-[10px] font-medium uppercase tracking-wider text-ink-faint">Objetivo</span>
              {session.objective}
            </p>
          )}
          {hasRunningDetails && session.runningDetails && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="rounded-lg bg-sky-500/10 p-2">
                <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-sky-400/70">Ritmo objetivo</p>
                <p className="text-sm font-semibold text-sky-400">
                  {session.runningDetails.targetPaceMin}
                  {session.runningDetails.targetPaceMax ? `-${session.runningDetails.targetPaceMax}` : ''}
                  <span className="ml-1 text-xs font-normal text-sky-400/70">/km</span>
                </p>
              </div>
              {session.runningDetails.targetHrMin && (
                <div className="rounded-lg bg-rose-500/10 p-2">
                  <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-rose-400/70">FC objetivo</p>
                  <p className="text-sm font-semibold text-rose-400">
                    {session.runningDetails.targetHrMin}-{session.runningDetails.targetHrMax}
                    <span className="ml-1 text-xs font-normal text-rose-400/70">bpm</span>
                  </p>
                </div>
              )}
            </div>
          )}
          {hasMatchMeta && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(session.matchResult || session.gamesWon != null || session.gamesLost != null) && (
                <div className="rounded-lg bg-surface-raised p-2">
                  <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-faint">Resultado</p>
                  <p
                    className={`text-sm font-semibold ${
                      session.matchResult === 'win'
                        ? 'text-emerald-400'
                        : session.matchResult === 'loss'
                          ? 'text-rose-400'
                          : 'text-ink'
                    }`}
                  >
                    {session.matchResult ? MATCH_RESULT_LABELS[session.matchResult] : 'Pendiente'}
                    {(session.gamesWon != null || session.gamesLost != null) && (
                      <span className="ml-1 font-normal text-ink-muted">
                        {session.gamesWon ?? '?'}-{session.gamesLost ?? '?'}
                      </span>
                    )}
                  </p>
                </div>
              )}
              {session.opponent && (
                <div className="rounded-lg bg-surface-raised p-2">
                  <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-faint">Rival</p>
                  <p className="text-sm font-semibold text-ink">{session.opponent}</p>
                </div>
              )}
              {session.location && (
                <div className="rounded-lg bg-surface-raised p-2 sm:col-span-2">
                  <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-faint">Lugar</p>
                  <p className="text-sm text-ink">{session.location}</p>
                </div>
              )}
            </div>
          )}
          {hasSquashDetails && session.squashDetails && (
            <div className="mt-2 space-y-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">Drills</p>
              {session.squashDetails.drills.map((drill, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-surface-raised px-2.5 py-1.5">
                  <span className="flex-1 text-xs font-medium leading-snug text-ink">{drill.name}</span>
                  {drill.durationMin && <span className="flex-shrink-0 text-[11px] text-ink-faint">{drill.durationMin}min</span>}
                  {drill.notes && <span className="sr-only">{drill.notes}</span>}
                </div>
              ))}
              {session.squashDetails.drills.some((d) => d.notes) && (
                <div className="mt-1 space-y-0.5">
                  {session.squashDetails.drills
                    .filter((d) => d.notes)
                    .map((drill, i) => (
                      <p key={i} className="text-[11px] leading-snug text-ink-faint">
                        <span className="font-medium text-ink-muted">{drill.name}:</span> {drill.notes}
                      </p>
                    ))}
                </div>
              )}
            </div>
          )}
          {hasExercises && <ExerciseChecklist sessionId={session.id} exercises={session.exercises!} />}
          {hasProtocols && (
            <div className="space-y-2">
              {session.warmup && session.warmup.length > 0 && (
                <div className="rounded-lg border border-brand/20 bg-brand/5 p-2">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-brand-light/80">Warm-up</p>
                  <div className="mt-1 space-y-1">
                    {session.warmup.map((block, index) => (
                      <div key={index}>
                        <p className="text-xs text-ink">
                          {block.title}
                          {block.durationMin ? ` · ${block.durationMin}min` : ''}
                        </p>
                        {block.steps.map((step, stepIndex) => (
                          <p key={stepIndex} className="text-[11px] text-ink-faint">· {step}</p>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {session.cooldown && session.cooldown.length > 0 && (
                <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-2">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-violet-300/80">Post / cool-down</p>
                  <div className="mt-1 space-y-1">
                    {session.cooldown.map((block, index) => (
                      <div key={index}>
                        <p className="text-xs text-ink">
                          {block.title}
                          {block.durationMin ? ` · ${block.durationMin}min` : ''}
                        </p>
                        {block.steps.map((step, stepIndex) => (
                          <p key={stepIndex} className="text-[11px] text-ink-faint">· {step}</p>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {session.notes && <p className="text-xs italic text-ink-muted">"{session.notes}"</p>}
          {session.completionNotes && <p className="text-xs italic text-ink-muted">Post: "{session.completionNotes}"</p>}
        </div>
      )}
    </div>
  )
}

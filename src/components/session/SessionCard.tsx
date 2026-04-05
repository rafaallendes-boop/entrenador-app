import { Clock, Flame, ChevronDown, ChevronUp, Wind } from 'lucide-react'
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
  z2: 'Z2 Aeróbico', tempo: 'Tempo', intervals: 'Intervalos', long: 'Long Run',
}

const MATCH_RESULT_LABELS = { win: 'Ganó', loss: 'Perdió' } as const

interface SessionCardProps {
  session: Session
  compact?: boolean
}

export default function SessionCard({ session, compact = false }: SessionCardProps) {
  const [expanded, setExpanded] = useState(false)
  const cycleStatus = useTrainingStore(s => s.cycleSessionStatus)
  const config = SESSION_TYPE_CONFIG[session.type]
  const statusCfg = STATUS_CONFIG[session.status]

  const hasExercises = (session.type === 'strength' || session.type === 'mobility') && session.exercises && session.exercises.length > 0
  const hasRunningDetails = (session.type === 'running' || session.type === 'cycling') && session.runningDetails
  const hasSquashDetails = session.type === 'squash' && session.squashDetails && session.squashDetails.drills.length > 0
  const hasMatchMeta = session.type === 'squash' && (session.subtype === 'match' || session.subtype === 'competitive') && (session.matchResult || session.opponent || session.gamesWon != null || session.gamesLost != null || session.location)
  const isExpandable = hasExercises || session.objective || session.notes || hasRunningDetails || hasMatchMeta || hasSquashDetails
  const subtypeLabel = session.subtype ? SQUASH_SUBTYPE_LABELS[session.subtype] : null
  const isSkipped = session.status === 'skipped'
  const showMatchBadge = hasMatchMeta && session.matchResult
  const matchBadgeClass = session.matchResult === 'win'
    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
    : 'bg-rose-500/15 text-rose-400 border border-rose-500/25'

  return (
    <div className={`rounded-xl border ${config.borderClass} ${config.bgClass} overflow-hidden transition-opacity ${isSkipped ? 'opacity-50' : ''}`}>
      <div className={`flex items-start gap-3 p-3 md:p-4 ${isExpandable ? 'cursor-pointer' : ''}`} onClick={() => isExpandable && setExpanded(e => !e)}>
        <SessionTypeIcon type={session.type} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-medium truncate ${isSkipped ? 'line-through text-ink-muted' : 'text-ink'}`}>{session.title}</span>
            {subtypeLabel && <span className={`text-xs px-1.5 py-0.5 rounded-full border ${config.borderClass} ${config.textClass} font-medium flex-shrink-0`}>{subtypeLabel}</span>}
            {showMatchBadge && <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${matchBadgeClass}`}>{MATCH_RESULT_LABELS[session.matchResult!]}</span>}
            {hasRunningDetails && session.runningDetails && <span className="text-xs px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 font-medium flex-shrink-0">{RUNNING_TYPE_LABELS[session.runningDetails.runningType] ?? session.runningDetails.runningType}</span>}
          </div>
          <div className="flex items-center gap-x-3 gap-y-1.5 mt-1 flex-wrap">
            <span className="flex items-center gap-1 text-xs text-ink-muted"><Clock size={11} />{formatDuration(session.durationMin)}</span>
            {session.rpe != null && <span className="flex items-center gap-1 text-xs text-ink-muted"><Flame size={11} />{session.actualRpe != null && session.status === 'completed' ? `RPE real ${session.actualRpe}` : `RPE ${session.rpe}`}</span>}
            {hasRunningDetails && session.runningDetails?.targetPaceMin && <span className="flex items-center gap-1 text-xs text-sky-400"><Wind size={11} />{session.runningDetails.targetPaceMin}{session.runningDetails.targetPaceMax ? `–${session.runningDetails.targetPaceMax}` : ''} /km</span>}
            {session.opponent && <span className="text-xs text-ink-faint">vs {session.opponent}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 self-start md:self-center">
          {!compact && <button onClick={e => { e.stopPropagation(); cycleStatus(session.id) }} title="Cambiar estado" className={`text-xs px-2 py-1 rounded-lg font-medium flex items-center gap-1 transition-all active:scale-95 whitespace-nowrap ${statusCfg.badge}`}><span className="text-[11px] leading-none">{statusCfg.icon}</span><span className="hidden sm:inline">{statusCfg.label}</span></button>}
          {compact && <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${statusCfg.badge}`}>{statusCfg.icon}</span>}
          {isExpandable && <span className="text-ink-faint">{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>}
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-3 border-t border-white/5 space-y-2 md:px-4 md:pb-4">
          {session.objective && <p className="text-xs text-ink-muted mt-2"><span className="text-ink-faint uppercase tracking-wider text-[10px] font-medium mr-1">Objetivo</span>{session.objective}</p>}
          {hasRunningDetails && session.runningDetails && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="bg-sky-500/10 rounded-lg p-2"><p className="text-[10px] text-sky-400/70 uppercase tracking-wider font-medium mb-0.5">Ritmo objetivo</p><p className="text-sm font-semibold text-sky-400">{session.runningDetails.targetPaceMin}{session.runningDetails.targetPaceMax ? `–${session.runningDetails.targetPaceMax}` : ''}<span className="text-xs font-normal text-sky-400/70 ml-1">/km</span></p></div>
              {session.runningDetails.targetHrMin && <div className="bg-rose-500/10 rounded-lg p-2"><p className="text-[10px] text-rose-400/70 uppercase tracking-wider font-medium mb-0.5">FC objetivo</p><p className="text-sm font-semibold text-rose-400">{session.runningDetails.targetHrMin}–{session.runningDetails.targetHrMax}<span className="text-xs font-normal text-rose-400/70 ml-1">bpm</span></p></div>}
            </div>
          )}
          {hasMatchMeta && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(session.matchResult || session.gamesWon != null || session.gamesLost != null) && <div className="bg-surface-raised rounded-lg p-2"><p className="text-[10px] text-ink-faint uppercase tracking-wider font-medium mb-0.5">Resultado</p><p className={`text-sm font-semibold ${session.matchResult === 'win' ? 'text-emerald-400' : session.matchResult === 'loss' ? 'text-rose-400' : 'text-ink'}`}>{session.matchResult ? MATCH_RESULT_LABELS[session.matchResult] : 'Pendiente'}{(session.gamesWon != null || session.gamesLost != null) && <span className="text-ink-muted font-normal ml-1">{session.gamesWon ?? '?'}-{session.gamesLost ?? '?'}</span>}</p></div>}
              {session.opponent && <div className="bg-surface-raised rounded-lg p-2"><p className="text-[10px] text-ink-faint uppercase tracking-wider font-medium mb-0.5">Rival</p><p className="text-sm font-semibold text-ink">{session.opponent}</p></div>}
              {session.location && <div className="bg-surface-raised rounded-lg p-2 sm:col-span-2"><p className="text-[10px] text-ink-faint uppercase tracking-wider font-medium mb-0.5">Lugar</p><p className="text-sm text-ink">{session.location}</p></div>}
            </div>
          )}
          {hasSquashDetails && session.squashDetails && (
            <div className="mt-2 space-y-1.5">
              <p className="text-[10px] text-ink-faint uppercase tracking-wider font-medium">Drills</p>
              {session.squashDetails.drills.map((drill, i) => (
                <div key={i} className="flex items-start gap-2 bg-surface-raised rounded-lg px-2.5 py-1.5">
                  <span className="text-xs font-medium text-ink leading-snug flex-1">{drill.name}</span>
                  {drill.durationMin && <span className="text-[11px] text-ink-faint flex-shrink-0">{drill.durationMin}min</span>}
                  {drill.notes && <span className="sr-only">{drill.notes}</span>}
                </div>
              ))}
              {session.squashDetails.drills.some(d => d.notes) && (
                <div className="space-y-0.5 mt-1">
                  {session.squashDetails.drills.filter(d => d.notes).map((drill, i) => (
                    <p key={i} className="text-[11px] text-ink-faint leading-snug">
                      <span className="font-medium text-ink-muted">{drill.name}:</span> {drill.notes}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
          {hasExercises && <ExerciseChecklist sessionId={session.id} exercises={session.exercises!} />}
          {session.notes && <p className="text-xs text-ink-muted italic">"{session.notes}"</p>}
          {session.completionNotes && <p className="text-xs text-ink-muted italic">Post: "{session.completionNotes}"</p>}
        </div>
      )}
    </div>
  )
}

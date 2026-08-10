import { Clock, Flame, ChevronDown, ChevronUp, Layers, Trash2, Wind } from 'lucide-react'
import { useState } from 'react'
import type { Exercise, Session, SessionStatus, SquashDrill, WhoopWorkout } from '../../types'
import { SESSION_TYPE_CONFIG, SQUASH_SUBTYPE_LABELS } from '../../constants/sessionTypes'
import { formatDuration } from '../../utils/format'
import { getHeartRateTargetDisplay } from '../../utils/heartRate'
import { isCompetitionSquashMatch, isPracticeSquashMatch, resolveSquashSessionKind, resolveSquashSessionMode } from '../../utils/squash'
import SessionTypeIcon from './SessionTypeIcon'
import ExerciseChecklist from './ExerciseChecklist'
import WhoopWorkoutMetrics from './WhoopWorkoutMetrics'
import { useTrainingStore } from '../../store/useTrainingStore'
import { normalizeGeneratedProtocol } from '../../services/trainingProtocols'
import { formatMobilityFocusAreas, normalizeMobilityTargetStructure } from '../../services/training/mobilitySessionLibrary'
import { resolveSupersetLayout } from '../../services/training/supersetGroups'
import { resolveSquashDrillGuidance } from '../../services/training/drillLibrary'

const STATUS_CONFIG: Record<SessionStatus, { label: string; badge: string; icon: string }> = {
  planned:   { label: 'Planificado', badge: 'bg-surface-raised text-ink-faint border border-surface-border',       icon: '○' },
  completed: { label: 'Completado',   badge: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25',    icon: '✓' },
  adjusted:  { label: 'Ajustado',    badge: 'bg-amber-500/15 text-amber-400 border border-amber-500/25',          icon: '↻' },
  skipped:   { label: 'Omitido',     badge: 'bg-red-500/15 text-red-400 border border-red-500/25',                icon: '×' },
}

const RUNNING_TYPE_LABELS: Record<string, string> = {
  z2: 'Z2 Aeróbico', tempo: 'Tempo', intervals: 'Intervalos', long: 'Long Run',
}

const MOBILITY_CONTEXT_LABELS: Record<string, string> = {
  post_run: 'Post-running',
  post_cycling: 'Post-cycling',
  post_squash: 'Post-squash',
  post_strength: 'Post-fuerza',
  pre_training_activation: 'Activación',
  recovery: 'Recovery',
  full_body: 'Full body',
  sport_specific: 'Específica',
}

const MATCH_RESULT_LABELS = { win: 'Ganó', loss: 'Perdió' } as const
const SQUASH_KIND_LABELS: Record<string, string> = {
  technical: 'Técnica',
  control: 'Control',
  shadows: 'Sombras',
  match: 'Partido',
  mixed: 'Mixto',
}
export const SQUASH_BLOCKS_DURATION_GUIDANCE =
  'La duracion total de la sesion es la referencia principal. Los ejercicios dentro de cada bloque son orientativos.'
export const SQUASH_DRILLS_DURATION_GUIDANCE =
  'La duracion total de la sesion es la referencia principal. Los drills listados sirven como guia.'

function summarizeExercises(exercises: Exercise[]): string {
  const groupCount = resolveSupersetLayout(exercises)
    .filter((segment) => segment.groupId != null)
    .length
  const base = `${exercises.length} ${exercises.length === 1 ? 'ejercicio' : 'ejercicios'}`
  if (groupCount === 0) return base
  return `${base} · ${groupCount} ${groupCount === 1 ? 'superserie' : 'superseries'}`
}

function SquashDrillGuidance({ drill }: { drill: SquashDrill }) {
  const guidance = resolveSquashDrillGuidance(drill)
  if (!guidance) return null
  return <p className="mt-1 text-[11px] leading-snug text-ink-faint">{guidance}</p>
}

function WhoopSyncBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-400"
      title="Sesion completada automaticamente desde Whoop"
    >
      <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" className="fill-current">
        <path d="M1 3h2l2 7 2-6h2l2 6 2-7h2l-3 10H10L8 7l-2 6H4L1 3z" />
      </svg>
      Sincronizado desde Whoop
    </span>
  )
}

interface SessionCardProps {
  session: Session
  compact?: boolean
  onDelete?: (session: Session) => void
  /** Detalle real del entrenamiento. La tarjeta no consulta Dexie: se lo pasan. */
  whoopWorkout?: WhoopWorkout
}

export default function SessionCard({ session, compact = false, onDelete, whoopWorkout }: SessionCardProps) {
  const [expanded, setExpanded] = useState(false)
  const cycleStatus = useTrainingStore((s) => s.cycleSessionStatus)
  const updateSession = useTrainingStore((s) => s.updateSession)
  const config = SESSION_TYPE_CONFIG[session.type]
  const statusCfg = STATUS_CONFIG[session.status]
  const heartRateTarget = getHeartRateTargetDisplay(
    session.runningDetails?.targetHrMin,
    session.runningDetails?.targetHrMax,
  )

  const hasExercises =
    (session.type === 'squash' || session.type === 'strength' || session.type === 'mobility') &&
    session.exercises &&
    session.exercises.length > 0
  const hasRunningDetails = (session.type === 'running' || session.type === 'cycling') && session.runningDetails
  const hasCyclingDetails = session.type === 'cycling' && session.cyclingDetails
  const hasMobilityDetails = session.type === 'mobility' && session.mobilityDetails
  const squashDrills = session.squashDetails?.drills ?? []
  const squashBlocks = session.squashDetails?.blocks ?? []
  const hasSquashDetails = session.type === 'squash' && Boolean(session.squashDetails)
  const warmup = normalizeGeneratedProtocol(session.warmup, 'warmup')
  const cooldown = normalizeGeneratedProtocol(session.cooldown, 'cooldown')
  const hasProtocols = Boolean(warmup || cooldown)
  const hasMatchMeta =
    isCompetitionSquashMatch(session) &&
    (session.matchResult ||
      session.opponent ||
      session.gamesWon != null ||
      session.gamesLost != null ||
      session.location)
  const hasCompletedFeedback = session.status === 'completed' || Boolean(session.sessionFeedback)
  const isExpandable =
    hasExercises ||
    session.objective ||
    session.notes ||
    session.completionNotes ||
    hasRunningDetails ||
    hasCyclingDetails ||
    hasMatchMeta ||
    hasSquashDetails ||
    hasMobilityDetails ||
    hasProtocols ||
    hasCompletedFeedback
  const squashSessionKind = resolveSquashSessionKind(session)
  const squashSessionMode = session.type === 'squash' && session.squashDetails
    ? resolveSquashSessionMode(session.squashDetails)
    : undefined
  const isPracticeMatch = isPracticeSquashMatch(session)
  const isCompetitionMatch = isCompetitionSquashMatch(session)
  const suppressMismatchMatchSubtype = session.subtype === 'match' && squashSessionKind && squashSessionKind !== 'match'
  const subtypeLabel = session.subtype && !(isPracticeMatch || isCompetitionMatch || suppressMismatchMatchSubtype)
    ? SQUASH_SUBTYPE_LABELS[session.subtype]
    : null
  const squashKindBadgeLabel = (isPracticeMatch || isCompetitionMatch)
    ? null
    : squashSessionKind === 'mixed' && squashBlocks.length > 1
    ? squashBlocks.map((block) => SQUASH_KIND_LABELS[block.kind] ?? block.kind).join(' + ')
    : squashSessionKind
      ? (SQUASH_KIND_LABELS[squashSessionKind] ?? squashSessionKind)
      : null
  const isSkipped = session.status === 'skipped'
  const showMatchBadge = hasMatchMeta && session.matchResult
  const matchBadgeClass =
    session.matchResult === 'win'
      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
      : 'bg-rose-500/15 text-rose-400 border border-rose-500/25'

  return (
    <div
      className={`rounded-xl border ${config.borderClass} bg-surface-card overflow-hidden transition-opacity ${
        isSkipped ? 'opacity-40' : ''
      }`}
    >
      <div className="flex">
        {/* Sport accent strip */}
        <div className={`w-[3px] flex-shrink-0 ${config.dotClass}`} />
        {/* Main content */}
        <div className="flex-1 min-w-0">
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
                RallyIQ
              </span>
            )}
            {subtypeLabel && (
              <span
                className={`text-xs px-1.5 py-0.5 rounded-full border ${config.borderClass} ${config.textClass} font-medium flex-shrink-0`}
              >
                {subtypeLabel}
              </span>
            )}
            {session.type === 'squash' && squashKindBadgeLabel && (
              <span className="rounded-full border border-brand/20 bg-brand/5 px-1.5 py-0.5 text-xs font-medium text-brand-light flex-shrink-0">
                {squashKindBadgeLabel}
              </span>
            )}
            {isPracticeMatch && (
              <span className="rounded-full border border-brand/25 bg-brand/10 px-1.5 py-0.5 text-xs font-medium text-brand-light flex-shrink-0">
                Partido entrenamiento
              </span>
            )}
            {isCompetitionMatch && session.subtype === 'match' && (
              <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-300 flex-shrink-0">
                Partido competitivo
              </span>
            )}
            {showMatchBadge && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${matchBadgeClass}`}>
                {MATCH_RESULT_LABELS[session.matchResult!]}
              </span>
            )}
            {session.type === 'cycling' && session.cyclingDetails && (
              <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-xs font-medium text-sky-400 flex-shrink-0">
                {session.cyclingDetails.sessionCategory}
              </span>
            )}
            {session.type === 'mobility' && session.mobilityDetails && (
              <span className="rounded-full border border-pink-500/20 bg-pink-500/10 px-1.5 py-0.5 text-xs font-medium text-pink-300 flex-shrink-0">
                {MOBILITY_CONTEXT_LABELS[session.mobilityDetails.context] ?? session.mobilityDetails.context}
              </span>
            )}
            {hasRunningDetails && session.runningDetails && session.type !== 'cycling' && (
              <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-xs font-medium text-sky-400 flex-shrink-0">
                {RUNNING_TYPE_LABELS[session.runningDetails.runningType] ?? session.runningDetails.runningType}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1 font-mono text-xs tabular-nums text-ink-muted">
              <Clock size={11} />
              {formatDuration(session.durationMin)}
            </span>
            {session.rpe != null && (
              <span className="flex items-center gap-1 font-mono text-xs tabular-nums text-ink-muted">
                <Flame size={11} />
                {session.actualRpe != null && session.status === 'completed' ? `RPE ${session.actualRpe}` : `RPE ${session.rpe}`}
              </span>
            )}
            {hasRunningDetails && session.runningDetails?.targetPaceMin && (
              <span className="flex items-center gap-1 font-mono text-xs tabular-nums text-sky-400">
                <Wind size={11} />
                {session.runningDetails.targetPaceMin}
                {session.runningDetails.targetPaceMax ? `–${session.runningDetails.targetPaceMax}` : ''}<span className="text-sky-400/60">/km</span>
              </span>
            )}
            {session.type === 'cycling' && session.cyclingDetails?.intensityReference && (
              <span className="font-mono text-xs tabular-nums text-sky-300">{session.cyclingDetails.intensityReference}</span>
            )}
            {session.type === 'mobility' && (session.mobilityDetails?.focusAreas?.length ?? 0) > 0 && (
              <span className="text-xs text-pink-300">{formatMobilityFocusAreas(session.mobilityDetails?.focusAreas)}</span>
            )}
            {session.opponent && <span className="text-xs text-ink-faint">vs {session.opponent}</span>}
            {/* Solo fuerza: es el unico tipo donde existen grupos, y en squash o
                movilidad la cabecera ya resume el contenido con sus propias
                señales (subtipo, areas de foco). */}
            {hasExercises && session.type === 'strength' && (
              <span className="flex items-center gap-1 text-xs text-ink-muted">
                <Layers size={11} />
                {summarizeExercises(session.exercises!)}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2 self-start md:self-center">
          {session.status === 'completed' && session.autoCompletion?.source === 'whoop_workout' && (
            <WhoopSyncBadge />
          )}
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
      {session.status === 'completed'
        && session.autoCompletion?.source === 'whoop_workout'
        && whoopWorkout?.workoutId === session.autoCompletion.workoutId && (
          <WhoopWorkoutMetrics workout={whoopWorkout} />
        )}
      {expanded && (
        <div className="space-y-2 border-t border-white/5 px-3 pb-3 md:px-4 md:pb-4">
          {session.objective && (
            <p className="mt-2 text-xs text-ink-muted">
              <span className="mr-1 font-display text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Objetivo</span>
              {session.objective}
            </p>
          )}
          {hasRunningDetails && session.runningDetails && (
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {session.runningDetails.targetPaceMin && (
                  <div className="rounded-lg bg-sky-500/10 p-2">
                    <p className="mb-0.5 font-display text-[10px] font-semibold uppercase tracking-wider text-sky-400/70">Ritmo objetivo</p>
                    <p className="font-mono text-sm font-semibold tabular-nums text-sky-400">
                      {session.runningDetails.targetPaceMin}
                      {session.runningDetails.targetPaceMax ? `–${session.runningDetails.targetPaceMax}` : ''}
                      <span className="ml-1 text-xs font-normal text-sky-400/60">/km</span>
                    </p>
                  </div>
                )}
                {heartRateTarget && (
                  <div className="rounded-lg bg-rose-500/10 p-2">
                    <p className="mb-0.5 font-display text-[10px] font-semibold uppercase tracking-wider text-rose-400/70">FC objetivo</p>
                    <p className="font-mono text-sm font-semibold tabular-nums text-rose-400">
                      {heartRateTarget.value}
                      <span className="ml-1 text-xs font-normal text-rose-400/60">{heartRateTarget.unit}</span>
                    </p>
                  </div>
                )}
              </div>
              {session.runningDetails.intervalStructure && (
                <div className="space-y-1">
                  <p className="font-display text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Estructura</p>
                  {session.runningDetails.intervalStructure.blocks.map((block, i) => (
                    <div key={`${block.label}-${i}`} className="flex items-start gap-2 rounded-lg bg-sky-500/8 px-2.5 py-1.5">
                      <span className="font-mono w-5 flex-shrink-0 text-right text-[11px] font-semibold tabular-nums text-sky-400">{i + 1}.</span>
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-medium text-ink">{block.label}</span>
                        {block.notes && <span className="ml-1 text-[11px] text-ink-faint">({block.notes})</span>}
                      </div>
                      <span className="font-mono flex-shrink-0 text-right text-[11px] tabular-nums text-sky-400/80">
                        {block.repetitions != null && block.distanceKm != null && `${block.repetitions}×${block.distanceKm}km`}
                        {block.durationMin != null && ` ${block.durationMin}min`}
                        {block.targetPace && ` · ${block.targetPace}/km`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {session.type === 'cycling' && session.cyclingDetails && (
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-lg bg-sky-500/10 p-2">
                  <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-sky-400/70">Tipo</p>
                  <p className="text-sm font-semibold text-sky-400">{session.cyclingDetails.sessionCategory}</p>
                </div>
                {session.cyclingDetails.intensityReference && (
                  <div className="rounded-lg bg-sky-500/10 p-2">
                    <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-sky-400/70">Intensidad</p>
                    <p className="text-sm font-semibold text-sky-400">{session.cyclingDetails.intensityReference}</p>
                  </div>
                )}
              </div>
              <div className="rounded-lg bg-surface-raised p-2">
                <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-faint">Estructura</p>
                <p className="text-sm text-ink">{session.cyclingDetails.targetStructure}</p>
              </div>
              {session.cyclingDetails.executionNotes && (
                <p className="text-[11px] leading-snug text-ink-faint">{session.cyclingDetails.executionNotes}</p>
              )}
            </div>
          )}
          {session.type === 'mobility' && session.mobilityDetails && (
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-lg bg-pink-500/10 p-2">
                  <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-pink-300/70">Contexto</p>
                  <p className="text-sm font-semibold text-pink-300">
                    {MOBILITY_CONTEXT_LABELS[session.mobilityDetails.context] ?? session.mobilityDetails.context}
                  </p>
                </div>
                <div className="rounded-lg bg-pink-500/10 p-2">
                  <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-pink-300/70">Foco</p>
                  <p className="text-sm font-semibold text-pink-300">{formatMobilityFocusAreas(session.mobilityDetails.focusAreas)}</p>
                </div>
              </div>
              <div className="rounded-lg bg-surface-raised p-2">
                <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-faint">Estructura</p>
                <p className="text-sm text-ink">{normalizeMobilityTargetStructure(session.mobilityDetails.targetStructure)}</p>
              </div>
              {session.mobilityDetails.executionNotes && (
                <p className="text-[11px] leading-snug text-ink-faint">{normalizeMobilityTargetStructure(session.mobilityDetails.executionNotes)}</p>
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
                    {session.matchResult ? MATCH_RESULT_LABELS[session.matchResult] : 'Por registrar'}
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
          {session.type === 'squash' && squashSessionMode && (
            <div className="rounded-lg bg-surface-raised p-2">
              <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-faint">Modo squash</p>
              <p className="text-sm text-ink">
                {squashSessionMode === 'practice_match'
                  ? 'Match-play de entrenamiento'
                  : squashSessionMode === 'competition_match'
                    ? 'Partido competitivo real'
                    : 'Sesion de drills'}
              </p>
            </div>
          )}
          {hasSquashDetails && session.squashDetails && squashBlocks.length > 0 && (
            <div className="mt-2 space-y-2">
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">Bloques squash</p>
                <p className="text-[11px] leading-snug text-ink-faint">
                  {SQUASH_BLOCKS_DURATION_GUIDANCE}
                </p>
              </div>
              {squashBlocks.map((block, blockIndex) => (
                <div key={`${block.kind}-${blockIndex}`} className="rounded-lg border border-white/5 bg-surface-raised p-2">
                  <div className="mb-1">
                    <span className="text-xs font-semibold text-ink">
                      {SQUASH_KIND_LABELS[block.kind] ?? block.kind}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {block.drills.map((drill, drillIndex) => (
                      <div key={`${block.kind}-${blockIndex}-${drill.name}-${drillIndex}`} className="rounded-lg bg-surface-card px-2.5 py-1.5">
                        <div className="flex items-start gap-2">
                          <span className="flex-1 text-xs font-medium leading-snug text-ink">{drill.name}</span>
                        </div>
                        <SquashDrillGuidance drill={drill} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {hasSquashDetails && session.squashDetails && squashBlocks.length === 0 && squashDrills.length > 0 && (
            <div className="mt-2 space-y-1.5">
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">Drills</p>
                <p className="text-[11px] leading-snug text-ink-faint">
                  {SQUASH_DRILLS_DURATION_GUIDANCE}
                </p>
              </div>
              {squashDrills.map((drill, i) => (
                <div key={i} className="flex items-start gap-2 rounded-lg bg-surface-raised px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <span className="flex-1 text-xs font-medium leading-snug text-ink">{drill.name}</span>
                    </div>
                    <SquashDrillGuidance drill={drill} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {warmup && (
            <ProtocolStaticCard
              title="Warm-up"
              accentClass="border-brand/20 bg-brand/5"
              headingClass="text-brand-light/80"
              protocol={warmup}
            />
          )}
          {hasExercises && <ExerciseChecklist sessionId={session.id} exercises={session.exercises!} sessionType={session.type} />}
          {cooldown && (
            <ProtocolStaticCard
              title="Cool-down"
              accentClass="border-violet-500/20 bg-violet-500/5"
              headingClass="text-violet-300/80"
              protocol={cooldown}
            />
          )}
          {session.notes && <p className="text-xs italic text-ink-muted">"{session.notes}"</p>}
          {session.completionNotes && <p className="text-xs italic text-ink-muted">Post: "{session.completionNotes}"</p>}
          {session.status === 'completed' && (
            <SessionFeedbackForm
              key={`${session.id}-${session.sessionFeedback?.capturedAt ?? 'none'}`}
              session={session}
              onUpdate={updateSession}
            />
          )}
        </div>
      )}
        </div>
      </div>
    </div>
  )
}

interface ProtocolStaticCardProps {
  title: string
  accentClass: string
  headingClass: string
  protocol: NonNullable<Session['warmup']>
}

function ProtocolStaticCard({
  title,
  accentClass,
  headingClass,
  protocol,
}: ProtocolStaticCardProps) {
  return (
    <div className={`rounded-lg border p-2 ${accentClass}`}>
      <div className="flex items-center justify-between">
        <p className={`text-[10px] font-medium uppercase tracking-wider ${headingClass}`}>{title}</p>
        <span className="text-[11px] text-ink-faint">Guia</span>
      </div>
      <p className="mt-1 text-xs text-ink">{protocol.title}</p>
      {protocol.note && <p className="mt-1 text-[11px] text-ink-faint">{protocol.note}</p>}
      <div className="mt-1.5 space-y-1">
        {protocol.steps.map((step, i) => (
          <div key={`${title}-${i}`} className="flex items-start gap-2 text-left">
            <span className="mt-0.5 w-4 flex-shrink-0 text-[11px] font-semibold text-ink-faint">
              {i + 1}.
            </span>
            <span className="text-[11px] leading-snug text-ink-faint">
              {step.label}
              {step.detail ? ` — ${step.detail}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface SessionFeedbackFormProps {
  session: Session
  onUpdate: (id: string, patch: Partial<Session>) => Promise<void>
}

function SessionFeedbackForm({ session, onUpdate }: SessionFeedbackFormProps) {
  const [rating, setRating] = useState<number>(session.sessionFeedback?.rating ?? 0)
  const [energy, setEnergy] = useState<number>(session.sessionFeedback?.energyDuringSession ?? 0)
  const [challenge, setChallenge] = useState(session.sessionFeedback?.mainChallenge ?? '')

  const persistFeedback = async (next: { rating?: number; energy?: number; challenge?: string }) => {
    const nextRating = next.rating ?? rating
    const nextEnergy = next.energy ?? energy
    const nextChallenge = next.challenge ?? challenge

    if (!nextRating || !nextEnergy) return

    await onUpdate(session.id, {
      sessionFeedback: {
        rating: nextRating as 1 | 2 | 3 | 4 | 5,
        energyDuringSession: nextEnergy as 1 | 2 | 3 | 4 | 5,
        mainChallenge: nextChallenge.trim() || undefined,
        capturedAt: Date.now(),
      },
    })
  }

  return (
    <div
      className="rounded-lg border border-white/8 bg-surface-raised/70 p-3"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-sm font-medium text-ink">¿Cómo fue?</p>
      <p className="mt-1 text-[11px] text-ink-faint">Guarda una señal corta para que RallyIQ lea sensaciones reales de esta sesión.</p>

      <div className="mt-3">
        <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">Rating</p>
        <div className="mt-1 flex gap-1.5">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={`rating-${value}`}
              type="button"
              onClick={() => {
                setRating(value)
                void persistFeedback({ rating: value })
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                rating === value
                  ? 'bg-brand text-white'
                  : 'border border-white/10 bg-white/5 text-ink-faint hover:border-brand/40 hover:text-ink'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">Energía durante la sesión</p>
        <div className="mt-1 flex gap-1.5">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={`energy-${value}`}
              type="button"
              onClick={() => {
                setEnergy(value)
                void persistFeedback({ energy: value })
              }}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                energy === value
                  ? 'bg-emerald-500 text-white'
                  : 'border border-white/10 bg-white/5 text-ink-faint hover:border-emerald-400/40 hover:text-ink'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <label className="text-[10px] font-medium uppercase tracking-wider text-ink-faint" htmlFor={`challenge-${session.id}`}>
          Desafío principal
        </label>
        <textarea
          id={`challenge-${session.id}`}
          value={challenge}
          onChange={(e) => setChallenge(e.target.value)}
          onBlur={() => void persistFeedback({ challenge })}
          rows={3}
          placeholder="Qué costó más, qué se sintió raro o dónde faltó energía."
          className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-brand/40"
        />
      </div>
    </div>
  )
}

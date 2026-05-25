import { CheckCircle2, Loader2, ThumbsDown, ThumbsUp, X, Zap } from 'lucide-react'
import { useState } from 'react'
import type { CoachProposal, CyclingDetails, ExerciseGroup, GeneratedProtocol, MobilityDetails, Session, SquashSessionBlockKind, SquashSessionMode } from '../../types'
import { recordCoachFeedback } from '../../services/ai/aiTelemetry'
import { resolveStrengthExerciseBlock } from '../../services/training/strengthSessionStructure'

const ACTION_LABEL: Record<string, string> = {
  skip_session: 'Saltar sesion',
  change_rpe: 'Cambiar RPE',
  shorten_session: 'Acortar sesion',
  lengthen_session: 'Alargar sesion',
  move_session: 'Mover sesion',
  replace_session_type: 'Cambiar tipo',
  insert_recovery: 'Insertar recuperacion',
  add_session: 'Agregar sesion',
  create_week: 'Crear semana',
  delete_session: 'Eliminar sesion',
  update_session: 'Actualizar sesion',
}

const SESSION_TYPE_LABEL: Record<string, string> = {
  squash: 'squash',
  running: 'running',
  strength: 'fuerza',
  cycling: 'ciclismo',
  mobility: 'movilidad',
  recovery: 'recuperacion',
}

const SQUASH_FOCUS_LABEL: Record<string, string> = {
  technical: 'Tecnico',
  tactical: 'Tactico',
  physical: 'Fisico-especifico',
  conditioned_games: 'Juegos condicionados',
}

const SQUASH_BLOCK_LABEL: Record<SquashSessionBlockKind, string> = {
  shadows: 'Sombras / pies',
  technical: 'Tecnica',
  control: 'Control',
  match: 'Partido final',
}

const SQUASH_PROPOSAL_GUIDANCE =
  'Orden y volumen orientativos: ajusta repeticiones, pausas y tiempo real segun cancha, nivel y sensaciones.'

interface ProposalDrawerProps {
  proposal: CoachProposal
  existingSessions: Session[]
  onAccept: () => void
  onReject: () => void
  onClose: () => void
  isAccepting?: boolean
}

export default function ProposalDrawer({
  proposal,
  existingSessions,
  onAccept,
  onReject,
  onClose,
  isAccepting = false,
}: ProposalDrawerProps) {
  const [rating, setRating] = useState<-1 | 1 | null>(null)
  const createWeekAction = proposal.actions.find(action => action.type === 'create_week')
  const chainedAdjustmentSessionIds = getChainedAdjustmentSessionIds(proposal.actions)
  const totalSessions = createWeekAction?.sessions?.length ?? 0
  const compactMessage = compactProposalMessage(proposal.message)
  const collisions = createWeekAction?.sessions
    ?.filter(session =>
      existingSessions.some(existing =>
        existing.date === session.date && existing.timeBlock === session.timeBlock && existing.status !== 'planned',
      ),
    )
    .map(session => `${session.date} ${session.timeBlock}`)
    .filter((value, index, array) => array.indexOf(value) === index) ?? []

  const handleRateProposal = (nextRating: -1 | 1) => {
    setRating(nextRating)
    void recordCoachFeedback({
      targetType: 'coach_proposal',
      targetId: proposal.id,
      rating: nextRating,
      proposalId: proposal.id,
      chatMessageId: proposal.chatMessageId,
    })
  }

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
          {compactMessage && (
            <p className="text-xs text-ink-muted leading-relaxed">{compactMessage}</p>
          )}

          {proposal.metadata && (
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-surface-border bg-surface-raised px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                {formatProposalSource(proposal.metadata.source)}
              </span>
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${getQualityBadgeClass(proposal.metadata.quality)}`}>
                {formatProposalQuality(proposal.metadata.quality)}
              </span>
              {proposal.metadata.relatedAlertId && (
                <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                  {proposal.metadata.relatedAlertId}
                </span>
              )}
            </div>
          )}

          <div className="flex items-center justify-between rounded-xl border border-surface-border bg-surface-raised px-3 py-2">
            <span className="text-[11px] font-medium text-ink-faint">¿La propuesta se ve útil?</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleRateProposal(1)}
                title="Propuesta útil"
                className={`rounded-lg p-2 transition-colors ${
                  rating === 1 ? 'bg-emerald-500/15 text-emerald-300' : 'text-ink-faint hover:bg-emerald-500/10 hover:text-emerald-300'
                }`}
              >
                <ThumbsUp size={14} />
              </button>
              <button
                type="button"
                onClick={() => handleRateProposal(-1)}
                title="Propuesta poco útil"
                className={`rounded-lg p-2 transition-colors ${
                  rating === -1 ? 'bg-rose-500/15 text-rose-300' : 'text-ink-faint hover:bg-rose-500/10 hover:text-rose-300'
                }`}
              >
                <ThumbsDown size={14} />
              </button>
            </div>
          </div>

          {collisions.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">Colisiones detectadas</p>
              <p className="mt-1 text-xs text-amber-100/80 leading-relaxed">
                Ya existen sesiones con historial en: {collisions.join(', ')}. Las sesiones planificadas se reemplazaran, pero estas se mantendran para no perder adherencia registrada.
              </p>
            </div>
          )}

          {proposal.metadata?.warnings && proposal.metadata.warnings.length > 0 && (
            <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/8 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-yellow-300">Aviso</p>
              {proposal.metadata.warnings.map((warning, i) => (
                <p key={i} className="mt-1 text-xs text-yellow-100/80 leading-relaxed">{warning}</p>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {proposal.actions.map((action, index) => (
              <div key={index} className="bg-surface-raised rounded-xl p-3">
                <div className="flex items-start gap-3">
                  <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider mt-0.5 w-24 flex-shrink-0">
                    {ACTION_LABEL[action.type] ?? action.type}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-ink-muted">{action.reason}</p>
                    {action.sessionId && chainedAdjustmentSessionIds.has(action.sessionId) && (
                      <p className="mt-1 text-[11px] text-amber-300">
                        Parte de un ajuste encadenado sobre la misma sesion.
                      </p>
                    )}

                    {action.newRpe != null && (
                      <p className="text-[11px] text-ink-faint mt-0.5">RPE → {action.newRpe}</p>
                    )}
                    {action.newDurationMin != null && (
                      <p className="text-[11px] text-ink-faint mt-0.5">Duracion → {action.newDurationMin} min</p>
                    )}
                    {action.targetDate != null && action.type === 'move_session' && (
                      <p className="text-[11px] text-ink-faint mt-0.5">Mover a → {action.targetDate}</p>
                    )}

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
                            {action.rpe != null ? ` · RPE${action.rpe}` : action.newRpe != null ? ` · RPE${action.newRpe}` : ''}
                          </p>
                        )}
                        {renderProposalDetails(action, 'ml-0')}
                      </div>
                    )}

                    {action.type === 'create_week' && action.sessions && (
                      <div className="mt-2 space-y-2 border-t border-surface-border pt-2">
                        {action.sessions.map((session, sessionIndex) => (
                          <div key={sessionIndex}>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-ink-faint/60 w-20 flex-shrink-0">
                                {session.date} {session.timeBlock}
                              </span>
                              <span className="text-[11px] text-ink-faint">
                                {SESSION_TYPE_LABEL[session.sessionType] ?? session.sessionType} · {session.title} · {session.durationMin}min
                                {session.rpe ? ` RPE${session.rpe}` : ''}
                              </span>
                            </div>
                            {renderProposalDetails(session)}
                          </div>
                        ))}
                      </div>
                    )}

                    {action.type === 'update_session' && (
                      <div className="mt-1.5 space-y-0.5">
                        {action.newTitle && (
                          <p className="text-[11px] text-ink-faint">Titulo → {action.newTitle}</p>
                        )}
                        {action.newObjective && (
                          <p className="text-[11px] text-ink-faint">Objetivo → {action.newObjective}</p>
                        )}
                        {action.newRpe != null && (
                          <p className="text-[11px] text-ink-faint">RPE → {action.newRpe}</p>
                        )}
                        {action.newDurationMin != null && (
                          <p className="text-[11px] text-ink-faint">Duracion → {action.newDurationMin} min</p>
                        )}
                        {renderProposalDetails(action, 'ml-0')}
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
              disabled={isAccepting}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium text-ink-muted bg-surface-raised border border-surface-border hover:border-red-500/30 hover:text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Rechazar
            </button>
            <button
              onClick={onAccept}
              disabled={isAccepting}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-brand hover:bg-brand-light active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              {isAccepting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              {isAccepting ? 'Aplicando…' : 'Aplicar cambios'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function compactProposalMessage(message: string): string {
  const cleaned = message
    .replace(/\s+/g, ' ')
    .replace(/^aqui tienes?\s+/i, '')
    .replace(/^te propongo\s+/i, '')
    .trim()

  if (!cleaned) return ''
  if (cleaned.length <= 140) return cleaned

  const slice = cleaned.slice(0, 137).trimEnd()
  const lastPeriod = slice.lastIndexOf('.')
  if (lastPeriod >= 80) {
    return slice.slice(0, lastPeriod + 1)
  }
  return `${slice}...`
}

function getChainedAdjustmentSessionIds(actions: CoachProposal['actions']): Set<string> {
  const grouped = new Map<string, Set<string>>()

  for (const action of actions) {
    if (!action.sessionId) continue
    if (action.type !== 'move_session' && action.type !== 'update_session') continue

    const types = grouped.get(action.sessionId) ?? new Set<string>()
    types.add(action.type)
    grouped.set(action.sessionId, types)
  }

  return new Set(
    [...grouped.entries()]
      .filter(([, types]) => types.has('move_session') && types.has('update_session'))
      .map(([sessionId]) => sessionId),
  )
}

function renderProposalDetails(
  item: {
    runningType?: string
    targetPaceMin?: string
    targetPaceMax?: string
    targetHrMin?: number
    targetHrMax?: number
    sessionType?: string
    newType?: string
    exercises?: Array<{ name: string; sets: number; reps: number | string; weight?: number; targetPercent1RM?: number; targetRpe?: number; group?: ExerciseGroup }>
    cyclingDetails?: CyclingDetails
    mobilityDetails?: MobilityDetails
    squashDetails?: {
      trainingFocus: string
      sessionMode?: SquashSessionMode
      drills?: Array<{ name: string; durationMin?: number; notes?: string }>
      blocks?: Array<{
        kind: SquashSessionBlockKind
        durationMin?: number
        drills: Array<{ name: string; durationMin?: number; notes?: string }>
      }>
    }
    warmup?: GeneratedProtocol
    cooldown?: GeneratedProtocol
  },
  indentClassName = 'ml-20',
) {
  const hasRunningMeta =
    item.runningType ||
    item.targetPaceMin ||
    item.targetPaceMax ||
    item.targetHrMin != null ||
    item.targetHrMax != null

  return (
    <>
      {item.squashDetails && (
        <div className={`${indentClassName} mt-1 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2`}>
          <p className="text-[10px] text-emerald-300/80 uppercase tracking-wide">
            Squash {SQUASH_FOCUS_LABEL[item.squashDetails.trainingFocus] ?? item.squashDetails.trainingFocus}
          </p>
          {item.squashDetails.sessionMode && (
            <p className="mt-1 text-[10px] text-emerald-200/80">
              {formatSquashSessionMode(item.squashDetails.sessionMode)}
            </p>
          )}
          <p className="mt-1 text-[10px] leading-snug text-emerald-100/55">
            {SQUASH_PROPOSAL_GUIDANCE}
          </p>
          {item.squashDetails.blocks?.length ? (
            <div className="mt-1 space-y-1.5">
              {item.squashDetails.blocks.map((block, blockIndex) => (
                <div key={`${block.kind}-${blockIndex}`}>
                  <p className="text-[10px] font-medium text-emerald-200/80">
                    {SQUASH_BLOCK_LABEL[block.kind] ?? block.kind}
                  </p>
                  {block.drills.slice(0, 3).map((drill, drillIndex) => (
                    <p key={`${block.kind}-${drillIndex}`} className="truncate text-[10px] text-ink-faint">
                      {drill.name}
                      {drill.notes ? ` · ${drill.notes}` : ''}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-1 space-y-1">
              {(item.squashDetails.drills ?? []).slice(0, 4).map((drill, drillIndex) => (
                <p key={drillIndex} className="truncate text-[10px] text-ink-faint">
                  {drill.name}
                  {drill.notes ? ` · ${drill.notes}` : ''}
                </p>
              ))}
              {(item.squashDetails.drills?.length ?? 0) > 4 && (
                <p className="text-[10px] text-ink-faint/50">+{(item.squashDetails.drills?.length ?? 0) - 4} drills mas</p>
              )}
            </div>
          )}
        </div>
      )}

      {hasRunningMeta && (
        <div className={`${indentClassName} mt-1`}>
          <p className="text-[10px] text-sky-300/70 uppercase tracking-wide">Running</p>
          <p className="text-[10px] text-ink-faint">
            {item.runningType ?? 'running'}
            {item.targetPaceMin ? ` · ${item.targetPaceMin}${item.targetPaceMax ? `-${item.targetPaceMax}` : ''} /km` : ''}
            {item.targetHrMin != null ? ` · FC ${item.targetHrMin}-${item.targetHrMax ?? '?'}` : ''}
          </p>
        </div>
      )}

      {item.cyclingDetails && (
        <div className={`${indentClassName} mt-1 rounded-lg border border-sky-500/20 bg-sky-500/5 px-2.5 py-2`}>
          <p className="text-[10px] text-sky-300/80 uppercase tracking-wide">Cycling</p>
          <p className="mt-1 text-[10px] text-ink-faint">
            {item.cyclingDetails.sessionCategory}
            {item.cyclingDetails.sessionFamily ? ` · ${item.cyclingDetails.sessionFamily}` : ''}
            {item.cyclingDetails.intensityReference ? ` · ${item.cyclingDetails.intensityReference}` : ''}
          </p>
          <p className="text-[10px] text-ink-faint/85">{item.cyclingDetails.targetStructure}</p>
          {item.cyclingDetails.executionNotes && (
            <p className="text-[10px] text-ink-faint/70">{item.cyclingDetails.executionNotes}</p>
          )}
        </div>
      )}

      {item.mobilityDetails && (
        <div className={`${indentClassName} mt-1 rounded-lg border border-pink-500/20 bg-pink-500/5 px-2.5 py-2`}>
          <p className="text-[10px] text-pink-300/80 uppercase tracking-wide">Mobility</p>
          <p className="mt-1 text-[10px] text-ink-faint">
            {formatMobilityContext(item.mobilityDetails.context)}
            {item.mobilityDetails.focusAreas.length > 0 ? ` · ${item.mobilityDetails.focusAreas.join(', ')}` : ''}
          </p>
          <p className="text-[10px] text-ink-faint/85">{item.mobilityDetails.targetStructure}</p>
          {item.mobilityDetails.executionNotes && (
            <p className="text-[10px] text-ink-faint/70">{item.mobilityDetails.executionNotes}</p>
          )}
        </div>
      )}

      {item.exercises && item.exercises.length > 0 && renderExercisePreview(item.exercises, {
        className: indentClassName,
        strength: item.sessionType === 'strength' || item.newType === 'strength',
      })}

      {item.warmup && (
        <div className={`${indentClassName} mt-1 rounded-lg border border-brand/20 bg-brand/5 px-2.5 py-2`}>
          <p className="text-[10px] text-brand-light/80 uppercase tracking-wide">Warm-up</p>
          <p className="mt-1 text-[10px] text-ink-faint">
            {item.warmup.title}
          </p>
          <p className="text-[10px] text-ink-faint/80">{item.warmup.note}</p>
          {item.warmup.steps.slice(0, 3).map((step, stepIndex) => (
            <p key={stepIndex} className="text-[10px] text-ink-faint/80">· {step.label}</p>
          ))}
        </div>
      )}

      {item.cooldown && (
        <div className={`${indentClassName} mt-1 rounded-lg border border-violet-500/20 bg-violet-500/5 px-2.5 py-2`}>
          <p className="text-[10px] text-violet-300/80 uppercase tracking-wide">Post / cool-down</p>
          <p className="mt-1 text-[10px] text-ink-faint">
            {item.cooldown.title}
          </p>
          <p className="text-[10px] text-ink-faint/80">{item.cooldown.note}</p>
          {item.cooldown.steps.slice(0, 3).map((step, stepIndex) => (
            <p key={stepIndex} className="text-[10px] text-ink-faint/80">· {step.label}</p>
          ))}
        </div>
      )}
    </>
  )
}

type ProposalExercise = {
  name: string
  sets: number
  reps: number | string
  weight?: number
  targetPercent1RM?: number
  targetRpe?: number
  group?: ExerciseGroup
}

type ProposalStrengthBlock = 'core' | 'strength' | 'cardio' | 'mobility'

const PROPOSAL_STRENGTH_LABEL: Record<ProposalStrengthBlock, string> = {
  core: 'Zona media',
  strength: 'Trabajo de fuerza',
  cardio: 'Cardio especifico',
  mobility: 'Movilidad / cierre',
}

const PROPOSAL_STRENGTH_ORDER: ProposalStrengthBlock[] = ['core', 'strength', 'cardio', 'mobility']

function renderExercisePreview(
  exercises: ProposalExercise[],
  options: { className: string; strength: boolean },
) {
  if (!options.strength) {
    return (
      <div className={`${options.className} mt-1`}>
        <p className="text-[10px] uppercase tracking-wide text-ink-faint/60">Ejercicios ({exercises.length})</p>
        {exercises.slice(0, 5).map((exercise, exerciseIndex) => (
          <p key={exerciseIndex} className="text-[10px] text-ink-faint">
            {formatProposalExercise(exercise)}
          </p>
        ))}
        {exercises.length > 5 && (
          <p className="text-[10px] text-ink-faint/50">+{exercises.length - 5} mas</p>
        )}
      </div>
    )
  }

  const sections = groupProposalStrengthExercises(exercises)
  return (
    <div className={`${options.className} mt-1 space-y-1.5`}>
      <p className="text-[10px] uppercase tracking-wide text-ink-faint/60">Fuerza estructurada</p>
      {sections.map((section) => (
        <div key={section.block} className="rounded-lg border border-amber-500/10 bg-amber-500/5 px-2.5 py-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-amber-300/80">
            {PROPOSAL_STRENGTH_LABEL[section.block]}
          </p>
          {section.exercises.slice(0, 4).map((exercise, exerciseIndex) => (
            <p key={`${section.block}-${exerciseIndex}`} className="truncate text-[10px] text-ink-faint">
              {formatProposalExercise(exercise)}
            </p>
          ))}
        </div>
      ))}
    </div>
  )
}

function groupProposalStrengthExercises(exercises: ProposalExercise[]): Array<{ block: ProposalStrengthBlock; exercises: ProposalExercise[] }> {
  const groups = new Map<ProposalStrengthBlock, ProposalExercise[]>()
  for (const exercise of exercises) {
    const block = toProposalStrengthBlock(resolveStrengthExerciseBlock(exercise))
    groups.set(block, [...(groups.get(block) ?? []), exercise])
  }
  return PROPOSAL_STRENGTH_ORDER
    .map((block) => ({ block, exercises: groups.get(block) ?? [] }))
    .filter((section) => section.exercises.length > 0)
}

function toProposalStrengthBlock(group: ExerciseGroup): ProposalStrengthBlock {
  if (group === 'core') return 'core'
  if (group === 'cardio') return 'cardio'
  if (group === 'mobility') return 'mobility'
  return 'strength'
}

function formatProposalExercise(exercise: ProposalExercise): string {
  const load = exercise.weight != null
    ? ` · ${exercise.weight}kg${exercise.targetPercent1RM != null ? ` (${Math.round(exercise.targetPercent1RM)}%)` : ''}`
    : exercise.targetRpe != null
      ? ` · RPE ${exercise.targetRpe}`
      : ''
  return `${exercise.name} ${exercise.sets}x${exercise.reps}${load}`
}

function formatProposalSource(source: NonNullable<CoachProposal['metadata']>['source']): string {
  switch (source) {
    case 'dashboard_auto_adjustment':
      return 'auto ajuste dashboard'
    case 'weekly_action':
      return 'weekly action'
    default:
      return 'chat'
  }
}

function formatProposalQuality(quality: NonNullable<CoachProposal['metadata']>['quality']): string {
  switch (quality) {
    case 'detailed':
      return 'detalle explicito'
    case 'generic_fallback':
      return 'fallback generico'
    case 'mixed':
      return 'detalle mixto'
    default:
      return 'sin tracking'
  }
}

function getQualityBadgeClass(quality: NonNullable<CoachProposal['metadata']>['quality']): string {
  switch (quality) {
    case 'detailed':
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
    case 'generic_fallback':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-300'
    case 'mixed':
      return 'border-sky-500/20 bg-sky-500/10 text-sky-300'
    default:
      return 'border-surface-border bg-surface-raised text-ink-faint'
  }
}

function formatMobilityContext(context: MobilityDetails['context']): string {
  switch (context) {
    case 'post_cycling':
      return 'post-cycling'
    case 'post_run':
      return 'post-running'
    case 'post_squash':
      return 'post-squash'
    case 'post_strength':
      return 'post-fuerza'
    case 'pre_training_activation':
      return 'activacion'
    case 'recovery':
      return 'recuperacion'
    case 'full_body':
      return 'full body'
    default:
      return 'sport specific'
  }
}

function formatSquashSessionMode(sessionMode: SquashSessionMode): string {
  switch (sessionMode) {
    case 'practice_match':
      return 'Match-play de entrenamiento'
    case 'competition_match':
      return 'Partido competitivo real'
    default:
      return 'Sesion de drills'
  }
}

import { CheckCircle2, X, Zap } from 'lucide-react'
import type { ChatContext, CoachProposal } from '../../types'

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
  mobility: 'movilidad',
  recovery: 'recuperacion',
}

interface ProposalDrawerProps {
  proposal: CoachProposal
  existingSessions: ChatContext['recentSessions']
  onAccept: () => void
  onReject: () => void
  onClose: () => void
}

export default function ProposalDrawer({
  proposal,
  existingSessions,
  onAccept,
  onReject,
  onClose,
}: ProposalDrawerProps) {
  const createWeekAction = proposal.actions.find(action => action.type === 'create_week')
  const totalSessions = createWeekAction?.sessions?.length ?? 0
  const collisions = createWeekAction?.sessions
    ?.filter(session =>
      existingSessions.some(existing =>
        existing.date === session.date && existing.timeBlock === session.timeBlock,
      ),
    )
    .map(session => `${session.date} ${session.timeBlock}`)
    .filter((value, index, array) => array.indexOf(value) === index) ?? []

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

          {collisions.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">Colisiones detectadas</p>
              <p className="mt-1 text-xs text-amber-100/80 leading-relaxed">
                Ya existen sesiones en: {collisions.join(', ')}. Si aceptas, la semana se creara igual y podrias terminar con duplicados.
              </p>
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
                      </div>
                    )}

                    {action.type === 'create_week' && action.sessions && (
                      <div className="mt-2 space-y-2 border-t border-surface-border pt-2">
                        {action.weekObjectives && action.weekObjectives.length > 0 && (
                          <div className="mb-1">
                            <p className="text-[10px] text-ink-faint/60 uppercase tracking-wide mb-0.5">Objetivos</p>
                            {action.weekObjectives.map((objective, objectiveIndex) => (
                              <p key={objectiveIndex} className="text-[11px] text-ink-faint">· {objective}</p>
                            ))}
                          </div>
                        )}
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
                            {session.exercises && session.exercises.length > 0 && (
                              <div className="ml-20 mt-0.5">
                                {session.exercises.slice(0, 4).map((exercise, exerciseIndex) => (
                                  <span key={exerciseIndex} className="text-[10px] text-ink-faint/70 mr-2">
                                    {exercise.name} {exercise.sets}x{exercise.reps}{exercise.weight ? ` ${exercise.weight}kg` : ''}
                                  </span>
                                ))}
                                {session.exercises.length > 4 && (
                                  <span className="text-[10px] text-ink-faint/50">+{session.exercises.length - 4} mas</span>
                                )}
                              </div>
                            )}
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
                        {action.exercises && action.exercises.length > 0 && (
                          <div className="mt-1">
                            <p className="text-[10px] text-ink-faint/60 uppercase tracking-wide">Ejercicios ({action.exercises.length})</p>
                            {action.exercises.slice(0, 5).map((exercise, exerciseIndex) => (
                              <p key={exerciseIndex} className="text-[10px] text-ink-faint">
                                {exercise.name} {exercise.sets}x{exercise.reps}{exercise.weight ? ` ${exercise.weight}kg` : ''}
                              </p>
                            ))}
                            {action.exercises.length > 5 && (
                              <p className="text-[10px] text-ink-faint/50">+{action.exercises.length - 5} mas</p>
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


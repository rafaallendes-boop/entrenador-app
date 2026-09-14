import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatContext, CoachAction, Session } from '../../types'
import type { CoachNormalizedResponse } from '../ai/types'
import { materializeProspectiveSession, postProcessCoachActions } from '../ai/actionPostProcessor'
import { resolveStrengthExercise } from '../training/exerciseLibrary'
import { INJECTED_CORE_ROTATION } from '../training/strengthSessionStructure'

function context(currentInjuries?: string): ChatContext {
  return {
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [],
    athleteProfile: {
      id: 'athlete-safety',
      updatedAt: 1,
      sportContext: { primarySport: 'squash' },
      recoveryProfile: currentInjuries ? { currentInjuries } : undefined,
      strengthProfile: { squat1RM: 100, deadlift1RM: 130, benchPress1RM: 80 },
    },
  } as ChatContext
}

function response(actions: CoachAction[]): CoachNormalizedResponse {
  return {
    message: 'Te preparé la semana solicitada.',
    actions,
    provider: 'mock',
    traceId: 'safety-trace',
    requestClass: 'chat_action',
    timestamp: 1,
  }
}

describe('seguridad de fuerza en el postprocesador', () => {
  beforeEach(() => vi.setSystemTime(new Date('2026-08-30T12:00:00.000Z')))

  it('regresión lumbar: conserva dos sesiones, con ejercicios verificables y sellados', () => {
    const output = postProcessCoachActions(response([{
      type: 'create_week',
      reason: 'semana siguiente',
      targetDate: '2026-09-07',
      sessions: [
        { date: '2026-09-08', timeBlock: 'PM', sessionType: 'strength', title: 'Fuerza A', durationMin: 60 },
        { date: '2026-09-10', timeBlock: 'PM', sessionType: 'strength', title: 'Fuerza B', durationMin: 60 },
      ],
    }]), context('Lesión espalda baja, cuadrado lumbar'), 'Créame 2 sesiones de pesas para la próxima semana')

    const action = output.actions?.[0]
    expect(action?.type).toBe('create_week')
    if (action?.type !== 'create_week') return
    expect(action.sessions).toHaveLength(2)
    for (const session of action.sessions ?? []) {
      expect(session.exercises?.length).toBeGreaterThan(0)
      expect(session.metadata?.strengthSafetyFinalization).toBeDefined()
      for (const exercise of session.exercises ?? []) {
        const definition = resolveStrengthExercise(exercise)?.definition
        expect(definition, exercise.name).toBeDefined()
        expect(definition?.safety.loadsRegions, exercise.name).not.toContain('lumbar')
        expect(INJECTED_CORE_ROTATION).not.toContain(definition?.id)
      }
    }
  })

  it('una restricción médica no resuelta elimina la acción y reemplaza el copy', () => {
    const output = postProcessCoachActions(response([{
      type: 'add_session', reason: 'fuerza', targetDate: '2026-09-04', timeBlock: 'PM',
      sessionType: 'strength', title: 'Fuerza', durationMin: 60,
    }]), context('me operaron hace dos semanas'), 'agrega fuerza el viernes')

    expect(output.actions ?? []).toHaveLength(0)
    expect(output.message).toBe('No pude identificar la zona de la lesión o restricción, así que no incluí trabajo de fuerza. Dime qué zona es (por ejemplo: espalda baja, rodilla u hombro) o regístrala en tu perfil.')
    expect(output.meta?.warnings).toContain('chat_action_strength_safety_blocked')
  })

  it('materializa update_session completo y conserva una precondición de base', () => {
    const base: Session = {
      id: 'strength-1', date: '2026-09-04', weekStartDate: '2026-08-31', timeBlock: 'PM',
      type: 'strength', status: 'planned', title: 'Fuerza', durationMin: 60,
      createdAt: 1, updatedAt: 42,
      exercises: [{ id: 'e1', name: 'Peso muerto', sets: 3, reps: 5, completed: false }],
    }
    const prospective = materializeProspectiveSession(base, {
      type: 'update_session', sessionId: base.id, reason: 'más larga', newDurationMin: 75,
    })
    expect(prospective.durationMin).toBe(75)
    expect(prospective.exercises?.map((exercise) => exercise.name)).toEqual(['Peso muerto'])

    const output = postProcessCoachActions(response([{
      type: 'update_session', sessionId: base.id, reason: 'más larga', newDurationMin: 75,
    }]), {
      ...context('Lesión espalda baja'),
      recentSessions: [base], plannedSessions: [base],
    }, 'alarga la sesión de fuerza')
    expect(output.actions?.[0]?.baseUpdatedAt).toBe(42)
    expect(output.actions?.[0]?.exercises?.map((exercise) => exercise.name)).not.toContain('Peso muerto')
  })
})

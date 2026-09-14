import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AthleteProfile, ChatContext } from '../../../types'
import type { AIProvider } from '../../ai/types'
import { useAIDebugStore } from '../../../store/useAIDebugStore'
import { WeekCreatorEngine } from '../WeekCreatorEngine'
import { BLOCKED_STRENGTH_UNRESOLVED_COPY } from '../../training/strengthSafetyCopy'

// Decisión del owner (2026-09-14): una sesión de fuerza que no se puede
// verificar se quita de la semana con aviso; el resto de la semana se entrega.
// El rechazo completo queda sólo cuando no sobrevive ninguna sesión.
const TARGET_WEEK = '2026-09-07'
const STRENGTH_DAY = '2026-09-11'

function profile(overrides: Partial<AthleteProfile> = {}): AthleteProfile {
  return {
    id: 'athlete-partial-safety',
    updatedAt: 1,
    sportContext: { enabledSports: ['squash', 'strength'], primarySport: 'squash' },
    // Marca médica sin zona: bloquea toda sesión de fuerza.
    recoveryProfile: { currentInjuries: 'me operaron hace dos semanas' },
    planWizardConfig: {
      goalEventId: 'goal-partial',
      trainingDays: ['monday', 'wednesday', 'friday'],
      sessionsPerWeek: 3,
      sessionDurationMins: 60,
      allowDoubleSession: false,
      complementarySports: ['strength'],
      currentFitnessLevel: 'normal',
      currentFatigue: 'normal',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    ...overrides,
  }
}

function context(athleteProfile: AthleteProfile): ChatContext {
  return { athleteProfile, recentSessions: [], plannedSessions: [], historicalSessions: [] }
}

const squash = (date: string, title: string, drill: string) => ({
  date,
  timeBlock: 'AM',
  sessionType: 'squash',
  title,
  durationMin: 60,
  objective: 'Técnica de base',
  squashDetails: {
    trainingFocus: 'technical',
    sessionMode: 'drill_session',
    drills: [{ name: drill, durationMin: 20 }],
  },
})

function providerWithMixedWeek(call = vi.fn()): AIProvider {
  return {
    name: 'gemini',
    call: async (request) => {
      call(request)
      return {
        provider: 'gemini',
        traceId: request.traceId,
        requestClass: request.requestClass,
        text: `<actions>${JSON.stringify([{
          type: 'create_week',
          reason: 'Semana squash con soporte de fuerza',
          targetDate: TARGET_WEEK,
          sessions: [
            squash('2026-09-07', 'Squash técnico', 'Drives paralelos'),
            squash('2026-09-09', 'Control y precisión', 'Tiros cruzados profundos'),
            {
              date: STRENGTH_DAY,
              timeBlock: 'AM',
              sessionType: 'strength',
              title: 'Fuerza',
              durationMin: 60,
              objective: 'Fuerza general',
              exercises: [
                { name: 'Remo con pecho apoyado', sets: 3, reps: 10, group: 'pull' },
                { name: 'Press inclinado con mancuernas', sets: 3, reps: 8, group: 'push' },
              ],
            },
          ],
        }])}</actions>`,
      }
    },
  }
}

beforeEach(() => useAIDebugStore.getState().clear())

describe('Week Creator — semana parcial por seguridad de fuerza', () => {
  it('quita la sesión de fuerza bloqueada y entrega el resto con aviso', async () => {
    const calls = vi.fn()
    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame la semana',
      context(profile()),
      { targetWeekStart: TARGET_WEEK, today: '2026-09-01', provider: providerWithMixedWeek(calls) },
    )

    expect(calls).toHaveBeenCalledTimes(1)
    expect(response.meta?.outcome).not.toBe('safety_blocked')
    const sessions = response.actions?.[0]?.sessions ?? []
    expect(sessions.map((session) => session.sessionType)).toEqual(['squash', 'squash'])
    // El retiro no redistribuye lo que el modelo sí armó bien.
    expect(sessions.map((session) => session.date)).toEqual(['2026-09-07', '2026-09-09'])
    expect(response.message).toContain(STRENGTH_DAY)
    // La razón cruda del repair no es copy de usuario.
    expect(response.message).not.toContain('unresolved_medical_restriction')
    expect(response.message).toContain(BLOCKED_STRENGTH_UNRESOLVED_COPY)
    const request = useAIDebugStore.getState().requests.find((item) => item.traceId === response.traceId)
    expect(request?.warnings).toContain('week_creator_strength_safety_partially_blocked:unresolved_medical_restriction')
  })

  it('una semana sólo de fuerza bloqueada sigue siendo un rechazo completo', async () => {
    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame la semana',
      context(profile({
        sportContext: { enabledSports: ['strength'], primarySport: 'strength' },
        planWizardConfig: { ...profile().planWizardConfig!, complementarySports: [], sessionsPerWeek: 1, trainingDays: ['friday'] },
      })),
      { targetWeekStart: TARGET_WEEK, today: '2026-09-01', provider: providerWithMixedWeek() },
    )

    expect(response.actions).toEqual([])
    expect(response.meta?.outcome).toBe('safety_blocked')
    expect(response.message).toBe(BLOCKED_STRENGTH_UNRESOLVED_COPY)
  })

  // Caso real de producción (2026-09-14), de punta a punta con la decisión A.
  it('"considerando mi lesión de espalda" con lesión lumbar en el perfil conserva la fuerza', async () => {
    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame una semana completa de entrenamiento para la próxima semana considerando mi lesión de espalda',
      context(profile({ recoveryProfile: { currentInjuries: 'Lesión lumbar' } })),
      { targetWeekStart: TARGET_WEEK, today: '2026-09-01', provider: providerWithMixedWeek() },
    )

    expect(response.meta?.outcome).not.toBe('safety_blocked')
    const strength = response.actions?.[0]?.sessions?.find((session) => session.sessionType === 'strength')
    expect(strength?.metadata?.strengthSafetyFinalization).toBeDefined()
    expect(response.message).not.toContain('Quité')
  })

  it('el fallback determinista también entrega la semana parcial', async () => {
    const invalidProvider: AIProvider = {
      name: 'gemini',
      call: async (request) => ({
        provider: 'gemini', traceId: request.traceId, requestClass: request.requestClass, text: '<actions>[]</actions>',
      }),
    }
    const response = await WeekCreatorEngine.sendWeekCreate(
      'Créame la semana',
      context(profile()),
      { targetWeekStart: TARGET_WEEK, today: '2026-09-01', provider: invalidProvider },
    )

    expect(response.meta?.outcome).not.toBe('safety_blocked')
    const sessions = response.actions?.[0]?.sessions ?? []
    expect(sessions.length).toBeGreaterThan(0)
    expect(sessions.some((session) => session.sessionType === 'strength')).toBe(false)
    expect(response.message).toContain(BLOCKED_STRENGTH_UNRESOLVED_COPY)
  })
})

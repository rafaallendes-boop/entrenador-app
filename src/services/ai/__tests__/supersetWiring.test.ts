import { describe, expect, it } from 'vitest'

import type { ChatContext, CoachAction } from '../../../types'
import type { CoachNormalizedResponse } from '../types'
import { postProcessCoachActions } from '../actionPostProcessor'

function makeResponse(actions: CoachAction[]): CoachNormalizedResponse {
  return {
    message: 'Listo',
    actions,
    provider: 'mock',
    traceId: 'superset-wiring',
    requestClass: 'chat_action',
    timestamp: 1,
  }
}

function makeContext(phase: 'base' | 'taper'): ChatContext {
  return {
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [],
    athleteProfile: {
      id: 'athlete-1',
      updatedAt: 1,
      sportContext: {
        primarySport: 'strength',
        enabledSports: ['strength'],
        secondarySports: [],
        trainingPriority: 'performance',
      },
      macroPlan: { currentPhase: phase } as NonNullable<ChatContext['athleteProfile']>['macroPlan'],
    },
  }
}

function strengthAction(durationMin = 30): CoachAction {
  return {
    type: 'add_session',
    reason: 'Sesion solicitada',
    targetDate: '2026-08-10',
    timeBlock: 'PM',
    sessionType: 'strength',
    title: 'Fuerza',
    durationMin,
    exercises: [
      { name: 'Plancha frontal', sets: 3, reps: '30s' },
      { name: 'Pallof press', sets: 3, reps: '10' },
      { name: 'Peso muerto con trap bar', sets: 4, reps: '5' },
    ],
  }
}

function expectCoreCircuit(actions: CoachAction[] | undefined): void {
  const exercises = actions?.[0]?.exercises ?? actions?.[0]?.sessions?.[0]?.exercises ?? []
  const plancha = exercises.find((exercise) => exercise.name === 'Plancha frontal')
  const pallof = exercises.find((exercise) => exercise.name === 'Pallof press')

  expect(plancha?.supersetGroup).toBeDefined()
  expect(plancha?.supersetGroup).toBe(pallof?.supersetGroup)
}

describe('cableado de superseries en chat', () => {
  it('una preferencia explicita sube una sesion corta de off a permissive', () => {
    const processed = postProcessCoachActions(
      makeResponse([strengthAction()]),
      makeContext('base'),
      'armame una sesion de fuerza en superseries',
    )

    expectCoreCircuit(processed.actions)
  })

  it('la misma sesion corta queda sin grupos cuando no hay preferencia', () => {
    const processed = postProcessCoachActions(
      makeResponse([strengthAction()]),
      makeContext('base'),
      'armame una sesion de fuerza',
    )

    expect(processed.actions?.[0]?.exercises?.every((exercise) => exercise.supersetGroup == null)).toBe(true)
  })

  // El contexto por si solo resuelve `permissive` a 60 min en base. Sin un
  // rechazo que mande, el atleta pedia "sin superseries" y las recibia igual.
  it('un rechazo explicito gana sobre un contexto que agruparia solo', () => {
    const sinMencion = postProcessCoachActions(
      makeResponse([strengthAction(60)]),
      makeContext('base'),
      'armame una sesion de fuerza',
    )
    expectCoreCircuit(sinMencion.actions)

    const conRechazo = postProcessCoachActions(
      makeResponse([strengthAction(60)]),
      makeContext('base'),
      'armame una sesion de fuerza sin superseries',
    )

    expect(conRechazo.actions?.[0]?.exercises?.every((exercise) => exercise.supersetGroup == null)).toBe(true)
  })

  it('un rechazo dentro de create_week apaga la politica sesion por sesion', () => {
    const processed = postProcessCoachActions(
      makeResponse([{
        type: 'create_week',
        reason: 'Semana solicitada',
        sessions: [{
          date: '2026-08-10',
          timeBlock: 'PM' as const,
          sessionType: 'strength' as const,
          title: 'Fuerza',
          durationMin: 60,
          exercises: strengthAction().exercises,
        }],
      }]),
      makeContext('base'),
      'creame la semana, nada de circuitos',
    )

    const exercises = processed.actions?.[0]?.sessions?.[0]?.exercises ?? []
    expect(exercises.length).toBeGreaterThan(0)
    expect(exercises.every((exercise) => exercise.supersetGroup == null)).toBe(true)
  })

  it('taper sin preferencia queda en off', () => {
    const processed = postProcessCoachActions(
      makeResponse([strengthAction(60)]),
      makeContext('taper'),
      'armame una sesion de fuerza',
    )

    expect(processed.actions?.[0]?.exercises?.every((exercise) => exercise.supersetGroup == null)).toBe(true)
  })

  it('aplica la duracion de cada sesion dentro de create_week', () => {
    const session = {
      date: '2026-08-10',
      timeBlock: 'PM' as const,
      sessionType: 'strength' as const,
      title: 'Fuerza',
      durationMin: 30,
      exercises: strengthAction().exercises,
    }
    const processed = postProcessCoachActions(
      makeResponse([{
        type: 'create_week',
        reason: 'Semana solicitada',
        sessions: [session],
      }]),
      makeContext('base'),
      'creame la semana con la fuerza en superseries',
    )

    expectCoreCircuit(processed.actions)
  })
})

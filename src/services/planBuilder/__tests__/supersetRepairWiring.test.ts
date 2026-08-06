import { describe, expect, it } from 'vitest'

import { repairGeneratedWeek } from '../repairWeek'
import { resolveSessionStrengthRoles } from '../strengthRoleContract'
import { buildRepairContextForTest, buildSkeletonSessionForTest } from './helpers/repairTestFixtures'

function strengthSession() {
  return buildSkeletonSessionForTest({
    date: '2026-08-03',
    timeBlock: 'AM',
    sessionType: 'strength',
    title: 'Fuerza',
    durationMin: 60,
    exercises: [
      { name: 'Plancha frontal', sets: 3, reps: '30s' },
      { name: 'Pallof press', sets: 3, reps: '10' },
      { name: 'Peso muerto con trap bar', sets: 4, reps: '5' },
    ],
  })
}

function mainLiftName(exercises: NonNullable<ReturnType<typeof strengthSession>['exercises']>): string | undefined {
  const index = resolveSessionStrengthRoles(exercises).indexOf('main_lift')
  return index === -1 ? undefined : exercises[index]?.name
}

describe('cableado de superseries en Plan Builder', () => {
  it('repairGeneratedWeek agrupa el circuito y preserva el main_lift', () => {
    const source = strengthSession()
    const baselineMainLift = mainLiftName(source.exercises ?? [])
    const context = buildRepairContextForTest({
      primarySport: 'strength',
      phase: 'base',
      sessionsPerWeek: 1,
    })

    const { sessions, failure } = repairGeneratedWeek([source], context)

    expect(failure).toBeUndefined()
    const exercises = sessions.find((session) => session.sessionType === 'strength')?.exercises ?? []
    const plancha = exercises.findIndex((exercise) => exercise.name === 'Plancha frontal')
    const pallof = exercises.findIndex((exercise) => exercise.name === 'Pallof press')
    const groupIds = new Set(exercises.map((exercise) => exercise.supersetGroup).filter(Boolean))

    expect(groupIds.size).toBeGreaterThan(0)
    expect(plancha).toBeGreaterThanOrEqual(0)
    expect(pallof).toBe(plancha + 1)
    expect(exercises[plancha]?.supersetGroup).toBeDefined()
    expect(exercises[plancha]?.supersetGroup).toBe(exercises[pallof]?.supersetGroup)
    expect(mainLiftName(exercises)).toBe(baselineMainLift)
  })

  it('transition usa la fase cruda y permanece en off', () => {
    const context = buildRepairContextForTest({
      primarySport: 'strength',
      phase: 'transition',
      sessionsPerWeek: 1,
    })

    const { sessions, failure } = repairGeneratedWeek([strengthSession()], context)

    expect(failure).toBeUndefined()
    const exercises = sessions.find((session) => session.sessionType === 'strength')?.exercises ?? []
    expect(exercises.every((exercise) => exercise.supersetGroup == null)).toBe(true)
  })
})

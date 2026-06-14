import { describe, expect, it } from 'vitest'

import type { RepairContext } from '../repairWeek'
import { repairGeneratedWeek } from '../repairWeek'

function makeContext(weekIndex: number): RepairContext {
  return {
    plan: {
      id: 'p1',
      athleteId: 'a1',
      goalEventId: 'e1',
      status: 'draft',
      generationState: 'complete',
      title: 'Test',
      startDate: '2026-06-01',
      endDate: '2026-07-24',
      totalWeeks: 9,
      phases: [{ phase: 'build', startWeekIndex: 0, endWeekIndex: 8, blockFocus: 'build', intentBySport: {} }],
      wizardConfig: {} as never,
      macroSnapshot: {
        goalEventId: 'e1',
        goalEventDate: '2026-07-24',
        currentPhase: 'build',
        weeksRemaining: 6,
        blockFocus: 'build',
        headline: '',
        timeline: [],
        sportDetails: [{ sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'hold', intensityBias: 'hold', notes: '' }],
        secondaryEvents: [],
        computedAt: 0,
      },
      createdAt: 0,
      updatedAt: 0,
    } as never,
    week: {
      id: `w${weekIndex}`,
      planId: 'p1',
      weekIndex,
      weekStartDate: '2026-06-01',
      phase: 'build',
      status: 'pending',
      sessions: [],
      weekObjectives: [],
      targetLoadBySport: { squash: 50, strength: 25 },
      validationIssues: [],
      generationMeta: { attempts: 1, provider: 'gemini', model: 'flash' },
      createdAt: 0,
      updatedAt: 0,
    } as never,
    profile: {
      id: 'a1',
      updatedAt: 0,
      age: 38,
      sportContext: { primarySport: 'squash' },
      strengthProfile: { squat1RM: 120, deadlift1RM: 140, benchPress1RM: 90, overheadPress1RM: 65 },
    } as never,
    wizardConfig: {
      goalEventId: 'e1',
      trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      doubleSessionDays: [],
      sessionsPerWeek: 5,
      sessionDurationMins: 60,
      allowDoubleSession: false,
      complementarySports: ['strength'],
      currentFitnessLevel: 'fit',
      currentFatigue: 'fresh',
      createdAt: '',
      updatedAt: '',
    } as never,
  }
}

describe('repairWeek Fase 2 wiring', () => {
  it('hydrates an empty strength session with 1RM-aware exercises and starLift metadata', () => {
    const result = repairGeneratedWeek([
      {
        date: '2026-06-02',
        timeBlock: 'AM',
        sessionType: 'strength',
        title: 'Fuerza',
        durationMin: 60,
        rpe: 6,
        exercises: [],
      },
    ] as never, makeContext(0))
    const strength = result.sessions.find((session) => session.sessionType === 'strength')

    expect(strength?.metadata?.starLift?.name).toBeDefined()
    expect(strength?.metadata?.starLift?.targetPercent1RM).toBe(75)
    expect(strength?.exercises?.some((exercise) => exercise.targetPercent1RM != null)).toBe(true)
  })

  it('uses weekIndexInBlock to rotate star lift', () => {
    const week0 = repairGeneratedWeek([
      { date: '2026-06-02', timeBlock: 'AM', sessionType: 'strength', title: 'Fuerza', durationMin: 60, rpe: 6, exercises: [] },
    ] as never, makeContext(0))
    const week1 = repairGeneratedWeek([
      { date: '2026-06-09', timeBlock: 'AM', sessionType: 'strength', title: 'Fuerza', durationMin: 60, rpe: 6, exercises: [] },
    ] as never, makeContext(1))

    expect(week0.sessions[0]?.metadata?.starLift?.name).not.toBe(week1.sessions[0]?.metadata?.starLift?.name)
  })

  it('maps unknown squash drills without regenerating the whole session template', () => {
    const result = repairGeneratedWeek([
      {
        date: '2026-06-02',
        timeBlock: 'AM',
        sessionType: 'squash',
        title: 'Intensidad Alta y Puntos Clave bajo Presión',
        durationMin: 60,
        rpe: 8,
        subtype: 'competitive',
        objective: 'Puntos condicionados con presión de marcador y toma de la T.',
        squashDetails: {
          trainingFocus: 'conditioned_games',
          sessionMode: 'drill_session',
          sessionKind: 'mixed',
          drills: [
            { name: 'Juego condicionado solo al fondo', durationMin: 16 },
            { name: 'Puntos clave bajo presión', durationMin: 16 },
          ],
        },
      },
    ] as never, makeContext(0))

    const squash = result.sessions[0]
    const drillNames = squash?.squashDetails?.drills.map((drill) => drill.name) ?? []

    expect(result.meta.warnings.some((warning) => warning.code === 'squash_unknown_drills_mapped')).toBe(true)
    expect(result.meta.warnings.some((warning) => warning.code === 'squash_unknown_drills_repaired')).toBe(false)
    expect(drillNames).toContain('Juego condicionado solo al fondo')
    expect(drillNames.length).toBeGreaterThanOrEqual(3)
    expect(squash?.squashDetails?.blocks?.length).toBeGreaterThan(0)
  })
})

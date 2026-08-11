import { describe, expect, it } from 'vitest'

import type { CoachSessionProposal } from '../../../types'
import { findSquashDrillByName } from '../../training/drillLibrary'
import { validateWeekCreatorResponse } from '../../weekCreator/validateWeekCreatorResponse'
import { repairGeneratedWeek } from '../repairWeek'
import { buildRepairContextForTest, buildSkeletonSessionForTest } from './helpers/repairTestFixtures'

const OLD_NAMES = [
  'Tiros paralelos profundos',
  'Tiros cruzados profundos',
  '100 drives desde media cancha',
  'Largo controlado de baja carga',
]

const NEW_NAMES = [
  'Drives paralelos profundos',
  'Drives cruzados profundos',
  'Drives desde media cancha — 100',
  'Peloteo profundo suave de recuperación',
]

function squashSession(date: string, names: string[]): CoachSessionProposal {
  return buildSkeletonSessionForTest({
    date,
    timeBlock: 'AM',
    sessionType: 'squash',
    subtype: 'training',
    title: 'Squash técnico',
    objective: 'Construir largo y control con ejecución limpia.',
    durationMin: 60,
    rpe: 6,
    squashDetails: {
      trainingFocus: 'technical',
      sessionMode: 'drill_session',
      sessionKind: 'technical',
      drills: names.map((name) => ({ name, durationMin: 15 })),
    },
  })
}

/** Dos sesiones con la misma firma: dispara la corrección por duplicado. */
function duplicateWeek(names: string[]): CoachSessionProposal[] {
  return [squashSession('2026-08-03', names), squashSession('2026-08-05', names)]
}

/** Misma normalización por id que usan las firmas de repair y Week Creator. */
function idsOf(session: CoachSessionProposal | undefined): string[] {
  return (session?.squashDetails?.drills ?? [])
    .map((drill) => findSquashDrillByName(drill.name)?.id ?? drill.name)
}

describe('estabilidad ante el renombre de drills', () => {
  it('los nombres viejos y los nuevos resuelven a los mismos ids', () => {
    expect(OLD_NAMES.map((name) => findSquashDrillByName(name)?.id))
      .toEqual(NEW_NAMES.map((name) => findSquashDrillByName(name)?.id))
  })

  it('el repair toma las mismas decisiones de deduplicación', () => {
    const context = () => {
      const value = buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 2 })
      value.profile.goalEvents = []
      value.plan.goalEventId = ''
      return value
    }
    const withOld = repairGeneratedWeek(duplicateWeek(OLD_NAMES), context())
    const withNew = repairGeneratedWeek(duplicateWeek(NEW_NAMES), context())

    expect(withOld.failure?.errorClass).toBe(withNew.failure?.errorClass)
    expect(withOld.sessions).toHaveLength(withNew.sessions.length)

    // La corrección por firma duplicada efectivamente se activó: sin esto la
    // comparación de abajo sería vacua.
    expect(withOld.meta.warnings.map((warning) => warning.code))
      .toContain('squash_duplicate_drills_repaired')

    // Mismas decisiones, sesión por sesión, normalizadas por id.
    expect(withOld.sessions.map(idsOf)).toEqual(withNew.sessions.map(idsOf))
    expect(withOld.meta.repairedSessionCount).toBe(withNew.meta.repairedSessionCount)
    expect(withOld.meta.warnings.map((warning) => warning.code))
      .toEqual(withNew.meta.warnings.map((warning) => warning.code))
  })

  it('el repair no reescribe un nombre viejo que ya resuelve', () => {
    const context = buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 })
    context.profile.goalEvents = []
    context.plan.goalEventId = ''
    const repaired = repairGeneratedWeek(
      [squashSession('2026-08-03', OLD_NAMES)],
      context,
    )
    const names = (repaired.sessions[0]?.squashDetails?.drills ?? []).map((drill) => drill.name)
    expect(names).toContain('Tiros paralelos profundos')
  })

  it('el validador del Week Creator detecta el duplicado igual con nombres viejos y nuevos', () => {
    const validate = (names: string[]) => validateWeekCreatorResponse({
      targetWeekStart: '2026-08-03',
      context: { recentSessions: [], plannedSessions: [], historicalSessions: [] },
      config: {
        allowedSports: ['squash'],
        primarySport: 'squash',
        sessionsPerWeek: 2,
        maxSessionsPerWeek: 2,
        sessionDurationMins: 60,
        trainingDays: ['monday', 'wednesday'],
        allowDoubleSession: false,
        currentFitnessLevel: 'normal',
        currentFatigue: 'normal',
        fromWizard: true,
        configSource: 'wizard',
      },
      response: {
        message: 'Semana lista',
        provider: 'test',
        timestamp: 0,
        traceId: 'rename-stability',
        requestClass: 'week_creator',
        actions: [{
          type: 'create_week',
          reason: 'Dos sesiones con la misma firma',
          targetDate: '2026-08-03',
          sessions: duplicateWeek(names),
        }],
      },
    })

    const withOld = validate(OLD_NAMES)
    const withNew = validate(NEW_NAMES)

    expect(withOld.ok).toBe(false)
    expect(withOld.code).toBe('duplicate_squash_content')
    expect(withNew.code).toBe(withOld.code)
    expect(withNew.ok).toBe(withOld.ok)
  })
})

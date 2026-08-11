import { describe, expect, it } from 'vitest'
import type { CoachSessionProposal, MacroPlanPhase } from '../../../types'
import { findSquashDrillByName } from '../../training/drillLibrary'
import { hasSquashCompetitiveExposureContent } from '../../training/squashMatchRole'
import { repairGeneratedWeek } from '../repairWeek'
import { buildRepairContextForTest } from './helpers/repairTestFixtures'

function technicalSession(date = '2026-08-03'): CoachSessionProposal {
  return {
    date,
    timeBlock: 'AM',
    sessionType: 'squash',
    squashKind: 'technical',
    subtype: 'training',
    title: 'Squash técnico',
    objective: 'Longitud y volea con partner.',
    durationMin: 60,
    rpe: 6,
  }
}

function repairedSingle(phase: MacroPlanPhase, session = technicalSession()) {
  const context = buildRepairContextForTest({
    primarySport: 'squash',
    phase,
    sessionsPerWeek: 1,
  })
  return { context, result: repairGeneratedWeek([session], context) }
}

function matchId(result: ReturnType<typeof repairGeneratedWeek>): string | undefined {
  return findSquashDrillByName(result.sessions[0]?.squashDetails?.drills[0]?.name ?? '')?.id
}

describe('A2.5 — exposición competitiva semanal en el repair', () => {
  it('materializa mejor de 3 en base sin pedirle al hidratador cruzar fase/modalidad', () => {
    const { result } = repairedSingle('base')

    expect(matchId(result)).toBe('practice_match_best_of_3')
    expect(result.sessions[0]).toMatchObject({
      squashKind: 'match',
      subtype: 'competitive',
      durationMin: 45,
      rpe: 6,
    })
    expect(hasSquashCompetitiveExposureContent(result.sessions[0]?.squashDetails)).toBe(true)
  })

  it('una intención compacta match en base no registra degradación intermedia', () => {
    const compact = { ...technicalSession(), squashKind: 'match' as const }
    const { result } = repairedSingle('base', compact)

    expect(matchId(result)).toBe('practice_match_best_of_3')
    expect(result.meta.squashKindDegradedCount).toBeUndefined()
    expect(result.meta.warnings.map((warning) => warning.code)).not.toContain('squash_kind_degraded')
  })

  it('usa mejor de 5 en build/peak con carga normal', () => {
    for (const phase of ['build', 'peak'] as const) {
      const { result } = repairedSingle(phase)
      expect(matchId(result)).toBe('practice_match_five_games')
      expect(result.sessions[0]).toMatchObject({ durationMin: 55, rpe: 7 })
    }
  })

  it('reduce build/peak a mejor de 3 cuando la fatiga está loaded', () => {
    const context = buildRepairContextForTest({ primarySport: 'squash', phase: 'peak', sessionsPerWeek: 1 })
    context.wizardConfig.currentFatigue = 'loaded'

    const result = repairGeneratedWeek([technicalSession()], context)

    expect(matchId(result)).toBe('practice_match_best_of_3')
    expect(result.sessions[0]).toMatchObject({ durationMin: 40, rpe: 6 })
  })

  it('permite mejor de 3 en taper sólo si queda a tres o más días del evento', () => {
    const safe = repairedSingle('taper', technicalSession('2026-08-03')).result
    const unsafe = repairedSingle('taper', technicalSession('2026-08-07')).result

    expect(matchId(safe)).toBe('practice_match_best_of_3')
    expect(hasSquashCompetitiveExposureContent(unsafe.sessions[0]?.squashDetails)).toBe(false)
  })

  it('en race el evento real cuenta y no agrega match-play de entrenamiento', () => {
    const { result } = repairedSingle('race')
    expect(result.sessions[0]?.date).toBe('2026-08-09')
    expect(hasSquashCompetitiveExposureContent(result.sessions[0]?.squashDetails)).toBe(true)
    expect(result.meta.warnings.map((warning) => warning.code))
      .not.toContain('squash_competition_match_added')
  })

  it('no confunde el evento sintético de Crear semana con una competencia real', () => {
    const context = buildRepairContextForTest({ primarySport: 'squash', phase: 'base', sessionsPerWeek: 1 })
    context.profile.goalEvents = []
    context.wizardConfig.goalEventId = 'week-creator'
    context.plan.goalEventId = 'week-creator'

    const result = repairGeneratedWeek([technicalSession()], context)

    expect(hasSquashCompetitiveExposureContent(result.sessions[0]?.squashDetails)).toBe(false)
    expect(result.meta.warnings.map((warning) => warning.code))
      .not.toContain('squash_competition_match_added')
  })

  it.each([
    ['partner solo', (context: ReturnType<typeof buildRepairContextForTest>) => {
      context.wizardConfig.partnerAvailability = 'solo'
    }],
    ['sobrecarga severa', (context: ReturnType<typeof buildRepairContextForTest>) => {
      context.wizardConfig.currentFatigue = 'overloaded'
    }],
    ['lesión activa', (context: ReturnType<typeof buildRepairContextForTest>) => {
      context.profile.recoveryProfile = { currentInjuries: 'Dolor agudo de rodilla.' }
    }],
    ['restricción médica', (context: ReturnType<typeof buildRepairContextForTest>) => {
      context.wizardConfig.injuryNotes = 'Sin cambios de dirección por indicación médica.'
    }],
  ])('respeta el veto de %s', (_label, arrange) => {
    const context = buildRepairContextForTest({ primarySport: 'squash', phase: 'base', sessionsPerWeek: 1 })
    arrange(context)

    const result = repairGeneratedWeek([technicalSession()], context)

    expect(hasSquashCompetitiveExposureContent(result.sessions[0]?.squashDetails)).toBe(false)
  })
})

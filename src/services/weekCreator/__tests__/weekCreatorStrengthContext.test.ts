import { describe, expect, it } from 'vitest'
import type { ChatContext, CoachSessionProposal, PlanWizardConfig } from '../../../types'
import { buildWeekCreatorStrengthSelectionContext } from '../WeekCreatorEngine'
import { resolveWeekCreatorStrengthSources } from '../weekCreatorExecutionSignals'
import type { WeekCreatorEffectiveConfig } from '../WeekCreatorConfig'

const NOW = new Date(2026, 8, 16, 10, 0).getTime()
const config = {
  trainingDays: ['monday'], sessionsPerWeek: 3, maxSessionsPerWeek: 5, sessionDurationMins: 60, allowDoubleSession: false,
  allowedSports: ['squash', 'strength'], primarySport: 'squash', currentFitnessLevel: 'returning', currentFatigue: 'loaded',
  fromWizard: true, configSource: 'wizard',
} as WeekCreatorEffectiveConfig
const context: ChatContext = {
  recentSessions: [], plannedSessions: [], historicalSessions: [],
  athleteProfile: { id: 'a', updatedAt: 0, age: 50, planWizardConfig: { currentFatigue: 'loaded', currentFitnessLevel: 'returning', updatedAt: '2026-09-16T12:00:00.000Z' } as PlanWizardConfig },
}
const session = (date: string) => ({ date, timeBlock: 'PM', sessionType: 'strength', title: 'Fuerza', durationMin: 60 }) as CoachSessionProposal

describe('buildWeekCreatorStrengthSelectionContext', () => {
  it('toma fatiga, experiencia, retorno y recuperación de B1 (F11)', () => {
    const safety = { constraints: [], userMessageConstraints: [], userMessage: '', profile: context.athleteProfile, strengthSources: resolveWeekCreatorStrengthSources(context, '2026-09-21', NOW) }
    expect(buildWeekCreatorStrengthSelectionContext(session('2026-09-21'), config, safety)).toMatchObject({
      fatigueLevel: 6,              // I1 + I7: loaded declarado hace 5 días
      experienceLevel: 'unknown',   // I3
      returningFromBreak: true,     // I6
      requireExtraRecovery: true,   // I5: edad 50
      rpeAdjustment: -1,
    })
  })

  it('la vigencia se evalúa por sesión: el domingo siguiente la fatiga ya venció', () => {
    const safety = { constraints: [], userMessageConstraints: [], userMessage: '', profile: context.athleteProfile, strengthSources: resolveWeekCreatorStrengthSources(context, '2026-09-21', NOW) }
    expect(buildWeekCreatorStrengthSelectionContext(session('2026-09-27'), config, safety)).toMatchObject({ fatigueLevel: 4, returningFromBreak: true })
  })
})

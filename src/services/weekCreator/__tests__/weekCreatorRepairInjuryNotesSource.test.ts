import { describe, expect, it } from 'vitest'

import type { AthleteProfile, ChatContext } from '../../../types'
import {
  buildWeekCreatorHydrationRepairContext,
  resolveWeekCreatorSafetyConstraints,
} from '../WeekCreatorLocalHydrator'
import { buildAthleteParameters } from '../../planBuilder/profileAdapter'

const profile = {
  id: 'ath-1',
  updatedAt: Date.now(),
  recoveryProfile: { restrictions: 'entrenar solo 3 veces por semana' },
  planWizardConfig: {},
} as unknown as AthleteProfile

const context = {
  athleteProfile: profile,
  recentSessions: [],
  plannedSessions: [],
  historicalSessions: [],
} as unknown as ChatContext

// `config.injuryNotes` es un campo TRANSPORTADOR: en Week Creator lleva
// `recoveryProfile.restrictions`. El resolver canónico lo excluye a propósito y
// lee la fuente persistida. Si el contexto de reparación transporta el campo
// derivado, el mismo texto se clasifica de dos formas dentro de un mismo
// request: sin restricción arriba, `unresolved_medical_restriction` abajo.
const config = {
  trainingPriority: undefined,
  allowedSports: ['squash'],
  sessionsPerWeek: 4,
  sessionDurationMins: 60,
  injuryNotes: 'entrenar solo 3 veces por semana',
} as never

describe('procedencia de injuryNotes en el contexto de reparación', () => {
  it('el contexto de reparación no reclasifica un campo transportador como nota médica', () => {
    const repairContext = buildWeekCreatorHydrationRepairContext({
      context,
      config,
      targetWeekStart: '2026-09-07',
    })

    expect(repairContext.wizardConfig.injuryNotes).toBe(profile.planWizardConfig?.injuryNotes)
  })

  it('ambas capas resuelven el mismo conjunto de restricciones', () => {
    const topLevel = resolveWeekCreatorSafetyConstraints(context, config)
    const repairContext = buildWeekCreatorHydrationRepairContext({
      context,
      config,
      targetWeekStart: '2026-09-07',
    })
    const downstream = buildAthleteParameters(repairContext.profile, repairContext.wizardConfig)

    expect(downstream.safetyConstraints.map((c) => c.kind)).toEqual(topLevel.map((c) => c.kind))
  })
})

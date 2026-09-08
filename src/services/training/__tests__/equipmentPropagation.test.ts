import { describe, expect, it } from 'vitest'

import type { AthleteProfile, ChatContext, CoachAction, PlanWizardConfig } from '../../../types'
import type { CoachNormalizedResponse } from '../../ai/types'
import { postProcessCoachActions } from '../../ai/actionPostProcessor'
import { getStrengthSelectionContext } from '../../ai/promptModules/strengthPrompt'
import { buildAthleteParameters } from '../../planBuilder/profileAdapter'
import { resolveStrengthExercise } from '../exerciseLibrary'

/**
 * El equipamiento vive en el perfil del atleta, no en la config de un plan.
 *
 * Capturarlo no alcanza: todo productor de una sesión de fuerza tiene que
 * transportarlo. `profileAdapter` leía `wizardConfig.availableEquipment` con un
 * cast de un campo que `PlanWizardConfig` nunca declaró, así que siempre
 * resolvía `undefined` y el filtro por equipamiento era inerte en producción.
 */

const WIZARD_CONFIG: PlanWizardConfig = {
  goalEventId: 'event-1',
  trainingDays: ['mon', 'wed', 'fri'],
  sessionsPerWeek: 3,
  sessionDurationMins: 60,
  allowDoubleSession: false,
  complementarySports: [],
  currentFitnessLevel: 'moderate',
  currentFatigue: 'normal',
  createdAt: '2026-09-07T00:00:00.000Z',
  updatedAt: '2026-09-07T00:00:00.000Z',
}

function profileWith(availableEquipment?: string[]): AthleteProfile {
  return { id: 'self', updatedAt: 0, availableEquipment }
}

describe('propagación del equipamiento declarado', () => {
  it('lo toma del perfil del atleta', () => {
    const parameters = buildAthleteParameters(profileWith(['máquinas', 'poleas']), WIZARD_CONFIG)

    expect(parameters.availableEquipment).toEqual(['machine', 'cable'])
  })

  it('un perfil sin declarar conserva el comportamiento previo', () => {
    const parameters = buildAthleteParameters(profileWith(undefined), WIZARD_CONFIG)

    expect(parameters.availableEquipment).toBeUndefined()
  })

  it('una declaración desconocida no se pierde al pasar al selector', () => {
    expect(buildAthleteParameters(profileWith(['elíptica']), WIZARD_CONFIG).availableEquipment).toEqual([])
  })

  it('una selección vacía no se convierte en gimnasio completo', () => {
    const parameters = buildAthleteParameters(profileWith([]), WIZARD_CONFIG)

    expect(parameters.availableEquipment).toEqual([])
  })
})

function chatContextWith(profile: AthleteProfile): ChatContext {
  return {
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [],
    athleteProfile: profile,
    currentWeekSummary: {
      id: 'week-1',
      weekStartDate: '2026-05-04',
      totalSessions: 0,
      totalMinutes: 0,
      plannedSessions: 0,
      completedSessions: 0,
      plannedMinutes: 0,
      completedMinutes: 0,
      squashSessions: 0,
      runningSessions: 0,
      strengthSessions: 0,
      updatedAt: 1,
    },
  }
}

describe('productores de fuerza del chat y del prompt', () => {
  it('el contexto de selección del prompt transporta el equipamiento', () => {
    const context = getStrengthSelectionContext(
      chatContextWith({
        id: 'self',
        updatedAt: 0,
        availableEquipment: ['mancuernas', 'bandas'],
        sportContext: { enabledSports: ['strength'], primarySport: 'strength' },
      }),
    )

    expect(context.availableEquipment).toEqual(['dumbbell', 'bands'])
  })

  it('el fallback de acciones del chat no propone equipo que el atleta no tiene', () => {
    const response: CoachNormalizedResponse = {
      message: 'Te propongo este cambio:',
      requestClass: 'chat_action',
      actions: [{
        type: 'add_session',
        targetDate: '2026-05-08',
        sessionType: 'running',
        title: 'Rodaje suave',
        durationMin: 50,
      } as CoachAction],
    }

    const processed = postProcessCoachActions(
      response,
      chatContextWith({
        id: 'self',
        updatedAt: 0,
        availableEquipment: ['peso corporal', 'bandas'],
      }),
      'Agrega una sesion de fuerza el viernes',
    )

    const added = processed.actions.find((action) => action.type === 'add_session')
    const exercises = (added as { exercises?: Array<{ name: string }> } | undefined)?.exercises ?? []
    expect(exercises.length).toBeGreaterThan(0)

    for (const exercise of exercises) {
      const definition = resolveStrengthExercise(exercise)?.definition
      if (!definition) continue
      expect(
        definition.equipment.some((item) => item === 'bodyweight' || item === 'bands'),
        `${definition.id} declara ${definition.equipment.join(',')}`,
      ).toBe(true)
    }
  })
})

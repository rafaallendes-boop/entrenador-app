import type {
  MacroPlanPhase,
  SupportedSport,
  WizardFatigueLevel,
} from '../../types'

export type SquashWeeklyMatchFormat = 'best_of_3' | 'best_of_5'

export type SquashWeeklyExposureSkipReason =
  | 'not_primary_sport'
  | 'no_squash_goal_event'
  | 'partner_unavailable'
  | 'medical_restriction'
  | 'severe_overload'
  | 'race_event_counts'
  | 'transition'

export type SquashWeeklyExposureDecision =
  | {
      ensure: false
      reason: SquashWeeklyExposureSkipReason
    }
  | {
      ensure: true
      format: SquashWeeklyMatchFormat
      durationCapMin: number
      targetRpe: number
      minimumDaysBeforeEvent: number
    }

export interface SquashWeeklyExposurePolicyInput {
  primarySport?: SupportedSport
  hasSquashGoalEvent: boolean
  phase: MacroPlanPhase
  currentFatigue: WizardFatigueLevel
  partnerAvailability?: 'solo' | 'partner' | 'either'
  hasMedicalRestriction: boolean
}

/**
 * A2.5 — política semanal de exposición competitiva de squash.
 *
 * La decisión vive sobre la semana, no sobre la identidad del drill. Así,
 * `resolveSquashMatchRole` sigue siendo un predicado puro de contenido y el
 * hidratador no necesita cruzar modalidad cuando el catálogo de una fase queda
 * corto. El partido se materializa después desde contenido canónico explícito.
 */
export function resolveSquashWeeklyExposurePolicy(
  input: SquashWeeklyExposurePolicyInput,
): SquashWeeklyExposureDecision {
  if (input.primarySport !== 'squash') {
    return { ensure: false, reason: 'not_primary_sport' }
  }
  if (!input.hasSquashGoalEvent) {
    return { ensure: false, reason: 'no_squash_goal_event' }
  }
  if (input.partnerAvailability === 'solo') {
    return { ensure: false, reason: 'partner_unavailable' }
  }
  if (input.hasMedicalRestriction) {
    return { ensure: false, reason: 'medical_restriction' }
  }
  if (input.currentFatigue === 'overloaded') {
    return { ensure: false, reason: 'severe_overload' }
  }
  if (input.phase === 'race') {
    // El evento real ya es la exposición de la semana. Agregar match-play de
    // entrenamiento dentro de la fase race duplicaría la carga competitiva.
    return { ensure: false, reason: 'race_event_counts' }
  }
  if (input.phase === 'transition') {
    return { ensure: false, reason: 'transition' }
  }

  const loaded = input.currentFatigue === 'loaded'

  if (input.phase === 'base') {
    return {
      ensure: true,
      format: 'best_of_3',
      durationCapMin: loaded ? 35 : 45,
      targetRpe: loaded ? 5 : 6,
      minimumDaysBeforeEvent: 0,
    }
  }

  if (input.phase === 'taper') {
    return {
      ensure: true,
      format: 'best_of_3',
      durationCapMin: loaded ? 35 : 40,
      targetRpe: loaded ? 5 : 6,
      minimumDaysBeforeEvent: 3,
    }
  }

  // Build/peak admiten el partido completo con carga normal. La fatiga loaded
  // reduce formato, duración y RPE; overloaded ya fue vetado arriba.
  return {
    ensure: true,
    format: loaded ? 'best_of_3' : 'best_of_5',
    durationCapMin: loaded ? 40 : 55,
    targetRpe: loaded ? 6 : 7,
    minimumDaysBeforeEvent: 0,
  }
}

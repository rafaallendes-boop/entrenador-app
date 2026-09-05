import type { LoadDirectiveVerdict } from '../training/loadDirectivePolicy'
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
      /**
       * Meta declarada de partidos duros (`PlanWizardConfig.targetHardPrimaryMatches`)
       * ya acotada por `sessionsPerWeek` y aplicable sólo en fases entrenables
       * (base/build/peak). `undefined` = sin meta declarada o no aplica en esta
       * fase; en ese caso el comportamiento es idéntico al de antes de esta
       * entrega. Nunca cambia el significado de `format`, que sigue siendo la
       * política de "cuán exigente" es el partido, no "cuántos".
       */
      declaredMatchCount?: number
    }

export interface SquashWeeklyExposurePolicyInput {
  primarySport?: SupportedSport
  hasSquashGoalEvent: boolean
  phase: MacroPlanPhase
  currentFatigue: WizardFatigueLevel
  partnerAvailability?: 'solo' | 'partner' | 'either'
  hasMedicalRestriction: boolean
  /**
   * Cupo semanal real de sesiones, si se conoce. Sólo se usa para acotar
   * `declaredMatchCount`; ausente = no se acota por este eje (queda acotado
   * igual por `targetHardPrimaryMatches` mismo).
   */
  sessionsPerWeek?: number
  /** Ver `PlanWizardConfig.targetHardPrimaryMatches`. */
  targetHardPrimaryMatches?: number
  /** Una directiva real de frenar prevalece sobre la meta de intensidad. */
  executionVerdict?: LoadDirectiveVerdict
}

/**
 * Resuelve cuántos partidos duros pedir esta semana a partir de la meta
 * declarada, sin tocar ningún veto: se llama únicamente después de que todos
 * los `return { ensure: false, ... }` de arriba ya descartaron la semana.
 *
 * Sólo aplica en fases entrenables (base/build/peak); taper y race conservan
 * su propia regla de formato/RPE y no admiten una meta de cantidad.
 */
function resolveDeclaredMatchCount(input: SquashWeeklyExposurePolicyInput): number | undefined {
  if (input.executionVerdict === 'reduce' || input.executionVerdict === 'hold') return undefined
  const declared = input.targetHardPrimaryMatches
  const isTrainablePhase = input.phase === 'base' || input.phase === 'build' || input.phase === 'peak'
  if (!isTrainablePhase) return undefined
  if (declared == null || !Number.isInteger(declared) || declared <= 0) return undefined
  const cappedBySchedule = input.sessionsPerWeek != null
    ? Math.min(declared, input.sessionsPerWeek)
    : declared
  // Base conserva un solo estímulo competitivo; build/peak admiten hasta
  // cuatro, siempre dentro del cupo semanal y con la fatiga como límite.
  const phaseCap = input.phase === 'base' || input.currentFatigue === 'loaded' ? 1 : 4
  const resolved = Math.min(phaseCap, Math.floor(cappedBySchedule))
  // NUNCA 0. `sessionsPerWeek` es 0 en una semana parcial sin días entrenables
  // (`getExpectedSessionsForPlanWeek`), y un 0 se propaga como si fuera
  // ausencia de meta a todo consumidor que use `?? 1` —apagando en silencio la
  // garantía preexistente de asegurar al menos una exposición competitiva—.
  // "Sin meta aplicable" es `undefined`, igual que en los demás cortes.
  return resolved >= 1 ? resolved : undefined
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
  // Los vetos ya devolvieron arriba: si llegamos acá, exponer es seguro.
  // La meta declarada sólo ajusta CUÁNTO, nunca reabre un veto. Se calcula acá
  // (no por-rama) para que las tres ramas de `ensure: true` compartan la misma
  // regla; `undefined` en taper/race ya está garantizado por la fase.
  const declaredMatchCount = resolveDeclaredMatchCount(input)

  if (input.phase === 'base') {
    return {
      ensure: true,
      format: 'best_of_3',
      durationCapMin: loaded ? 35 : 45,
      targetRpe: loaded ? 5 : 6,
      minimumDaysBeforeEvent: 0,
      ...(declaredMatchCount != null ? { declaredMatchCount } : {}),
    }
  }

  if (input.phase === 'taper') {
    return {
      ensure: true,
      format: 'best_of_3',
      durationCapMin: loaded ? 35 : 40,
      targetRpe: loaded ? 5 : 6,
      minimumDaysBeforeEvent: 3,
      // La meta no aplica en taper: `resolveDeclaredMatchCount` ya devuelve
      // `undefined` acá, así que no se agrega la clave.
    }
  }

  // Build/peak admiten el partido completo con carga normal. La fatiga loaded
  // reduce formato, duración y RPE; overloaded ya fue vetado arriba.
  return {
    ensure: true,
    format: loaded ? 'best_of_3' : 'best_of_5',
    durationCapMin: loaded ? 40 : 55,
    targetRpe: loaded ? 6 : declaredMatchCount ? 8 : 7,
    minimumDaysBeforeEvent: 0,
    ...(declaredMatchCount != null ? { declaredMatchCount } : {}),
  }
}

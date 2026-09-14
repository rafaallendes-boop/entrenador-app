import type { AthleteProfile, Session, StrengthProfile, WizardFatigueLevel, WizardFitnessLevel } from '../../types'
import { toISO } from '../../utils/date'
import { resolveSelectorEquipment } from './equipmentVocabulary'
import type { EquipmentType, Exercise1RMReference } from './exerciseLibrary'
import {
  decideLoadDirective,
  type ExecutionSignals,
  type LoadDirectiveDecision,
  type LoadDirectiveVerdict,
} from './loadDirectivePolicy'
import type { SlotContext } from './slotContext'
import {
  extractRecentStrengthExercises,
  type StrengthContext,
  type StrengthExperienceLevel,
} from './strengthSelector'

/**
 * B1: única autoridad de los campos de atleta del `StrengthContext` y de la
 * vigencia de lo declarado en el wizard. Implementa D1–D6 (spec §9) con la
 * traducción I1–I10 del plan de la Fase B. Chat, Week Creator y Plan Builder
 * llaman acá; ninguna ruta deriva por su cuenta fatiga, experiencia, edad,
 * 1RM ni retorno.
 */

/** I1: la fatiga numérica sale del veredicto, que ya ordena la precedencia de D6. */
export const FATIGUE_LEVEL_BY_VERDICT: Readonly<Record<LoadDirectiveVerdict, number>> = {
  progress: 2,
  no_signal: 4,
  hold: 6,
  reduce: 8,
}

/** I7 (owner, 2026-09-13). */
export const DECLARED_FATIGUE_VALID_DAYS = 7
/** I6 / D3 (owner, 2026-09-13). */
export const RETURNING_WINDOW_DAYS = 14
/** D4/D5: se conserva la regla vigente del Plan Builder, ahora compartida. */
export const EXTRA_RECOVERY_AGE_YEARS = 35

export type StrengthExperienceSource = 'declared' | 'inferred_1rm' | 'none'
export type ExtraRecoveryReason = 'acute_signal' | 'age'

/** Lo que el atleta declaró en el wizard. `PlanWizardConfig` la satisface. */
export interface AthleteDeclaration {
  currentFatigue?: WizardFatigueLevel
  currentFitnessLevel?: WizardFitnessLevel
  /** Momento de la declaración (ISO). Sin valor válido no hay declaración vigente. */
  updatedAt?: string
}

export interface DeclaredAthleteState {
  declaredAt?: string
  declaredFatigue?: WizardFatigueLevel
  returningWindowActive: boolean
}

export interface StrengthAthleteContextInput {
  slotContext: SlotContext
  /** Señales de ejecución de la ruta. Su `declaredFatigue`, si viene, se reemplaza por la vigente. */
  executionSignals: ExecutionSignals
  declaration: AthleteDeclaration | undefined
}

export interface StrengthAthleteContext {
  loadDecision: LoadDirectiveDecision
  fatigueLevel: number
  declaredFatigue?: WizardFatigueLevel
  declaredAt?: string
  experienceLevel: StrengthExperienceLevel
  experienceSource: StrengthExperienceSource
  requireExtraRecovery: boolean
  extraRecoveryReasons: ExtraRecoveryReason[]
  returningFromBreak: boolean
  rpeAdjustment: number
  available1RM: Exercise1RMReference[]
  availableEquipment: EquipmentType[] | undefined
  recentExercises: string[]
  historicalSessions: Session[]
}

export const STRENGTH_CONTEXT_ATHLETE_FIELDS = [
  'fatigueLevel',
  'experienceLevel',
  'requireExtraRecovery',
  'returningFromBreak',
  'rpeAdjustment',
  'available1RM',
  'availableEquipment',
  'recentExercises',
  'historicalSessions',
] as const

export type StrengthContextAthleteFields = Pick<StrengthContext, typeof STRENGTH_CONTEXT_ATHLETE_FIELDS[number]>

export function resolveDeclaredAthleteState(
  declaration: AthleteDeclaration | undefined,
  slotDate: string,
): DeclaredAthleteState {
  const declaredAt = parseDeclarationDate(declaration?.updatedAt)
  if (!declaredAt) return { returningWindowActive: false }
  const elapsed = daysBetween(declaredAt, slotDate)
  if (elapsed < 0) return { declaredAt, returningWindowActive: false }
  return {
    declaredAt,
    ...(declaration?.currentFatigue && elapsed < DECLARED_FATIGUE_VALID_DAYS
      ? { declaredFatigue: declaration.currentFatigue }
      : {}),
    returningWindowActive: declaration?.currentFitnessLevel === 'returning' && elapsed < RETURNING_WINDOW_DAYS,
  }
}

export function resolveStrengthAthleteContext(input: StrengthAthleteContextInput): StrengthAthleteContext {
  const profile = input.slotContext.profile
  const declared = resolveDeclaredAthleteState(input.declaration, input.slotContext.slot.date)
  const loadDecision = decideLoadDirective({ ...input.executionSignals, declaredFatigue: declared.declaredFatigue })
  const experience = resolveStrengthExperience(profile?.strengthProfile)
  const ageYears = resolveAthleteAgeYears(profile, input.slotContext.knowledgeDate)
  const extraRecoveryReasons: ExtraRecoveryReason[] = []
  if (loadDecision.verdict === 'reduce') extraRecoveryReasons.push('acute_signal')
  if (ageYears != null && ageYears >= EXTRA_RECOVERY_AGE_YEARS) extraRecoveryReasons.push('age')
  const history = [...input.slotContext.progressionHistory]

  return {
    loadDecision,
    fatigueLevel: FATIGUE_LEVEL_BY_VERDICT[loadDecision.verdict],
    declaredFatigue: declared.declaredFatigue,
    declaredAt: declared.declaredAt,
    experienceLevel: experience.level,
    experienceSource: experience.source,
    requireExtraRecovery: extraRecoveryReasons.length > 0,
    extraRecoveryReasons,
    returningFromBreak: declared.returningWindowActive,
    // I5: una sola unidad, aunque coincidan reduce y retorno.
    rpeAdjustment: loadDecision.verdict === 'reduce' || declared.returningWindowActive ? -1 : 0,
    available1RM: resolveAvailable1RM(profile?.strengthProfile),
    availableEquipment: resolveSelectorEquipment(profile?.availableEquipment),
    recentExercises: extractRecentStrengthExercises(history),
    historicalSessions: history,
  }
}

export function toStrengthContextAthleteFields(athlete: StrengthAthleteContext): StrengthContextAthleteFields {
  return {
    fatigueLevel: athlete.fatigueLevel,
    experienceLevel: athlete.experienceLevel,
    requireExtraRecovery: athlete.requireExtraRecovery,
    returningFromBreak: athlete.returningFromBreak,
    rpeAdjustment: athlete.rpeAdjustment,
    available1RM: athlete.available1RM,
    availableEquipment: athlete.availableEquipment,
    recentExercises: athlete.recentExercises,
    historicalSessions: athlete.historicalSessions,
  }
}

/** I3: declarada → conteo de 1RM (compatibilidad provisional) → `unknown`. */
export function resolveStrengthExperience(
  strengthProfile: StrengthProfile | undefined,
): { level: StrengthExperienceLevel; source: StrengthExperienceSource } {
  if (strengthProfile?.experienceLevel) return { level: strengthProfile.experienceLevel, source: 'declared' }
  const filled = resolveAvailable1RM(strengthProfile).length
  if (filled === 0) return { level: 'unknown', source: 'none' }
  if (filled >= 4) return { level: 'advanced', source: 'inferred_1rm' }
  if (filled >= 2) return { level: 'intermediate', source: 'inferred_1rm' }
  return { level: 'beginner', source: 'inferred_1rm' }
}

export function resolveAvailable1RM(strengthProfile: StrengthProfile | undefined): Exercise1RMReference[] {
  const available: Exercise1RMReference[] = []
  if (strengthProfile?.squat1RM != null) available.push('squat')
  if (strengthProfile?.deadlift1RM != null) available.push('deadlift')
  if (strengthProfile?.benchPress1RM != null) available.push('benchPress')
  if (strengthProfile?.overheadPress1RM != null) available.push('overheadPress')
  return available
}

/** Misma regla que usaba `profileAdapter.ts`, anclada a una fecha explícita. */
export function resolveAthleteAgeYears(profile: AthleteProfile | undefined, referenceDate: string): number | undefined {
  if (profile?.age != null) return profile.age
  const birthDate = (profile as { birthDate?: string } | undefined)?.birthDate
  if (!birthDate) return undefined
  const birth = new Date(`${birthDate}T00:00:00.000Z`)
  const reference = new Date(`${referenceDate}T00:00:00.000Z`)
  if (Number.isNaN(birth.getTime()) || Number.isNaN(reference.getTime())) return undefined
  let age = reference.getUTCFullYear() - birth.getUTCFullYear()
  const birthdayThisYear = Date.UTC(reference.getUTCFullYear(), birth.getUTCMonth(), birth.getUTCDate())
  if (reference.getTime() < birthdayThisYear) age -= 1
  return age
}

function parseDeclarationDate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const time = Date.parse(value)
  return Number.isNaN(time) ? undefined : toISO(new Date(time))
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00.000Z`) - Date.parse(`${from}T12:00:00.000Z`)) / 86_400_000)
}

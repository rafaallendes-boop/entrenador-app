import type { AthleteProfile, PlanWizardConfig, SupportedSport } from '../../types'
import type { EquipmentType, Exercise1RMReference } from '../training/exerciseLibrary'
import { resolveStrengthSafetyConstraints } from '../training/strengthSafetyConstraints'
import type { StrengthConstraint } from '../../types/strengthSafety'

export interface AthleteParameters {
  available1RM: Exercise1RMReference[]
  rpeAdjustment: number
  requireExtraRecovery: boolean
  primarySport: SupportedSport | undefined
  complementarySports: SupportedSport[]
  availableEquipment: EquipmentType[] | undefined
  fitnessLevel: PlanWizardConfig['currentFitnessLevel']
  fatigueLevel: PlanWizardConfig['currentFatigue']
  ageYears: number | undefined
  /** Canonical constraints shared by every strength selector/finalizer in this plan. */
  safetyConstraints: readonly StrengthConstraint[]
}

export function buildAthleteParameters(
  profile: AthleteProfile,
  wizardConfig: PlanWizardConfig,
  referenceDate = new Date(),
): AthleteParameters {
  const available1RM: Exercise1RMReference[] = []
  const strengthProfile = profile.strengthProfile

  if (strengthProfile?.squat1RM != null) available1RM.push('squat')
  if (strengthProfile?.deadlift1RM != null) available1RM.push('deadlift')
  if (strengthProfile?.benchPress1RM != null) available1RM.push('benchPress')
  if (strengthProfile?.overheadPress1RM != null) available1RM.push('overheadPress')

  const ageYears = resolveAgeYears(profile, referenceDate)

  return {
    available1RM,
    rpeAdjustment: wizardConfig.currentFatigue === 'overloaded' ? -1 : 0,
    requireExtraRecovery: (ageYears ?? 0) >= 35,
    primarySport: profile.sportContext?.primarySport,
    complementarySports: wizardConfig.complementarySports ?? [],
    availableEquipment: (wizardConfig as { availableEquipment?: EquipmentType[] }).availableEquipment,
    fitnessLevel: wizardConfig.currentFitnessLevel,
    fatigueLevel: wizardConfig.currentFatigue,
    ageYears,
    safetyConstraints: resolveStrengthSafetyConstraints({
      currentInjuries: profile.recoveryProfile?.currentInjuries,
      restrictions: profile.recoveryProfile?.restrictions,
      injuryNotes: wizardConfig.injuryNotes,
      userMessages: [],
      trainingPriority: profile.sportContext?.trainingPriority,
    }),
  }
}

function resolveAgeYears(profile: AthleteProfile, referenceDate: Date): number | undefined {
  if (profile.age != null) return profile.age

  const birthDate = (profile as { birthDate?: string }).birthDate
  if (!birthDate) return undefined

  const birth = new Date(`${birthDate}T00:00:00.000Z`)
  if (Number.isNaN(birth.getTime()) || Number.isNaN(referenceDate.getTime())) return undefined

  let age = referenceDate.getUTCFullYear() - birth.getUTCFullYear()
  const birthdayThisYear = Date.UTC(referenceDate.getUTCFullYear(), birth.getUTCMonth(), birth.getUTCDate())
  if (referenceDate.getTime() < birthdayThisYear) age -= 1
  return age
}

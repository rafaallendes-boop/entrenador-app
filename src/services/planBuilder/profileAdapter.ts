import type { AthleteProfile, PlanWizardConfig, SupportedSport } from '../../types'
import type { EquipmentType, Exercise1RMReference } from '../training/exerciseLibrary'

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
}

const TODAY = '2026-05-28'

export function buildAthleteParameters(
  profile: AthleteProfile,
  wizardConfig: PlanWizardConfig,
): AthleteParameters {
  const available1RM: Exercise1RMReference[] = []
  const strengthProfile = profile.strengthProfile

  if (strengthProfile?.squat1RM != null) available1RM.push('squat')
  if (strengthProfile?.deadlift1RM != null) available1RM.push('deadlift')
  if (strengthProfile?.benchPress1RM != null) available1RM.push('benchPress')
  if (strengthProfile?.overheadPress1RM != null) available1RM.push('overheadPress')

  const ageYears = resolveAgeYears(profile)

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
  }
}

function resolveAgeYears(profile: AthleteProfile): number | undefined {
  if (profile.age != null) return profile.age

  const birthDate = (profile as { birthDate?: string }).birthDate
  if (!birthDate) return undefined

  const birth = new Date(`${birthDate}T00:00:00.000Z`)
  const today = new Date(`${TODAY}T00:00:00.000Z`)
  if (Number.isNaN(birth.getTime()) || Number.isNaN(today.getTime())) return undefined

  let age = today.getUTCFullYear() - birth.getUTCFullYear()
  const birthdayThisYear = Date.UTC(today.getUTCFullYear(), birth.getUTCMonth(), birth.getUTCDate())
  if (today.getTime() < birthdayThisYear) age -= 1
  return age
}

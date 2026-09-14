import type { AthleteProfile, PlanWizardConfig, SupportedSport } from '../../types'
import type { EquipmentType, Exercise1RMReference } from '../training/exerciseLibrary'
import { resolveSelectorEquipment } from '../training/equipmentVocabulary'
import { resolveStrengthSafetyConstraints } from '../training/strengthSafetyConstraints'
import { resolveAthleteAgeYears } from '../training/strengthAthleteContext'
import { toISO } from '../../utils/date'
import type { StrengthConstraint } from '../../types/strengthSafety'

export interface AthleteParameters {
  available1RM: Exercise1RMReference[]
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

  const ageYears = resolveAthleteAgeYears(profile, toISO(referenceDate))
  const declaredEquipment = resolveSelectorEquipment(profile.availableEquipment)

  return {
    available1RM,
    primarySport: profile.sportContext?.primarySport,
    complementarySports: wizardConfig.complementarySports ?? [],
    availableEquipment: declaredEquipment,
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

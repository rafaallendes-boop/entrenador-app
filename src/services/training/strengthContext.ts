import type { AthleteProfile, MacroPlanPhase } from '../../types'
import { getEnabledSports, getPrimarySportNormalized } from '../../utils/athlete'
import type { StrengthContext, StrengthPhase, StrengthSportProfile } from './strengthSelector'

export function mapMacroPhaseToStrengthPhase(phase: MacroPlanPhase | undefined): StrengthPhase {
  switch (phase) {
    case 'build':
      return 'build'
    case 'peak':
      return 'peak'
    case 'taper':
    case 'race':
      return 'taper'
    case 'transition':
      return 'transition'
    case 'base':
    default:
      return 'base'
  }
}

export function deriveStrengthSportProfile(profile: AthleteProfile | undefined): StrengthSportProfile {
  const enabledSports = getEnabledSports(profile)
  const primarySport = getPrimarySportNormalized(profile)

  if (primarySport === 'strength') return 'strength_primary'
  if (enabledSports.includes('strength') && enabledSports.length > 1) return 'hybrid'
  return 'sport_support'
}

export function deriveStrengthExperienceLevel(profile: AthleteProfile | undefined): StrengthContext['experienceLevel'] {
  const sp = profile?.strengthProfile
  const filled = [sp?.benchPress1RM, sp?.squat1RM, sp?.deadlift1RM, sp?.overheadPress1RM]
    .filter((value) => value != null)
    .length

  if (filled >= 4) return 'advanced'
  if (filled >= 2) return 'intermediate'
  return 'beginner'
}

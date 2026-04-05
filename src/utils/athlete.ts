import type { AthleteProfile } from '../types'

export type ProfileCompletenessState = 'missing_profile' | 'missing_sports' | 'partial' | 'complete'

export interface ProfileCompleteness {
  state: ProfileCompletenessState
  missing: string[]
  recommended: string[]
}

export function getAthleteDisplayName(profile?: AthleteProfile | null, fallback = 'Atleta'): string {
  const name = profile?.name?.trim()
  return name && name.length > 0 ? name : fallback
}

export function getAthleteFirstName(profile?: AthleteProfile | null, fallback = 'atleta'): string {
  const displayName = getAthleteDisplayName(profile, fallback).trim()
  const [firstName] = displayName.split(/\s+/)
  return firstName || fallback
}

export function includesSport(profile: AthleteProfile | null | undefined, sport: string): boolean {
  if (!profile) return false
  const needle = sport.toLowerCase()
  if (profile.primarySport?.toLowerCase().includes(needle)) return true
  return profile.secondarySports?.some((item) => item.toLowerCase().includes(needle)) ?? false
}

function getConfiguredSports(profile: AthleteProfile | null | undefined): string[] {
  if (!profile) return []
  const sports = [profile.primarySport, ...(profile.secondarySports ?? [])]
    .map((sport) => sport?.trim().toLowerCase())
    .filter(Boolean) as string[]

  return [...new Set(sports)]
}

function includesAnySport(profile: AthleteProfile | null | undefined, aliases: string[]): boolean {
  return aliases.some((alias) => includesSport(profile, alias))
}

export function getProfileCompleteness(profile: AthleteProfile | null): ProfileCompleteness {
  if (!profile) {
    return {
      state: 'missing_profile',
      missing: ['perfil del atleta'],
      recommended: [],
    }
  }

  const configuredSports = getConfiguredSports(profile)
  if (configuredSports.length === 0) {
    return {
      state: 'missing_sports',
      missing: ['deporte principal'],
      recommended: ['nombre visible'],
    }
  }

  const missing: string[] = []
  const recommended: string[] = []

  const runningProfile = profile.runningProfile
  const hasRunningData =
    runningProfile?.z2PaceMin ||
    runningProfile?.z2PaceMax ||
    runningProfile?.thresholdPace ||
    runningProfile?.fiveKTime
  const needsRunningData = includesAnySport(profile, ['running', 'correr', 'run'])
  if (needsRunningData && !hasRunningData) missing.push('ritmos de running')

  const strengthProfile = profile.strengthProfile
  const hasStrengthData =
    strengthProfile?.benchPress1RM ||
    strengthProfile?.squat1RM ||
    strengthProfile?.deadlift1RM ||
    strengthProfile?.overheadPress1RM
  const needsStrengthData = includesAnySport(profile, ['strength', 'fuerza', 'pesas', 'gym'])
  if (needsStrengthData && !hasStrengthData) missing.push('1RMs de fuerza')

  if (!profile.name?.trim()) recommended.push('nombre visible')

  return {
    state: missing.length > 0 ? 'partial' : 'complete',
    missing,
    recommended,
  }
}

export function getProfileGaps(profile: AthleteProfile | null): string[] {
  return getProfileCompleteness(profile).missing
}

export function getAthleteSportsSummary(profile?: AthleteProfile | null): string {
  const primary = profile?.primarySport?.trim()
  const secondary = profile?.secondarySports?.map((sport) => sport.trim()).filter(Boolean) ?? []

  if (primary && secondary.length > 0) {
    return `${primary}, ${secondary.join(', ')}`
  }
  if (primary) return primary
  if (secondary.length > 0) return secondary.join(', ')
  return 'squash, running, fuerza y movilidad'
}

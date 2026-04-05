import type { AthleteProfile, SupportedSport, TrainingPriority } from '../types'

export type ProfileCompletenessState = 'missing_profile' | 'missing_sports' | 'partial' | 'complete'

export interface ProfileCompleteness {
  state: ProfileCompletenessState
  missing: string[]
  recommended: string[]
}

// ─── Sport normalization ───────────────────────────────────────────────────────

export const SPORT_ALIASES: Record<string, SupportedSport> = {
  squash: 'squash',
  running: 'running',
  correr: 'running',
  run: 'running',
  strength: 'strength',
  fuerza: 'strength',
  pesas: 'strength',
  gym: 'strength',
  mobility: 'mobility',
  movilidad: 'mobility',
  cycling: 'cycling',
  bicicleta: 'cycling',
  bike: 'cycling',
  ciclismo: 'cycling',
}

export function normalizeSport(s: string): SupportedSport | undefined {
  const key = s.trim().toLowerCase()
  if (key in SPORT_ALIASES) return SPORT_ALIASES[key]
  for (const [alias, sport] of Object.entries(SPORT_ALIASES)) {
    if (key.includes(alias)) return sport
  }
  return undefined
}

// ─── Sport accessors ───────────────────────────────────────────────────────────

/**
 * Returns the canonical list of enabled sports for the athlete.
 * Priority: sportContext.enabledSports → normalize primarySport+secondarySports → []
 */
export function getEnabledSports(profile: AthleteProfile | null | undefined): SupportedSport[] {
  if (!profile) return []

  const fromContext = profile.sportContext?.enabledSports
  if (fromContext && fromContext.length > 0) return fromContext

  const raw = [profile.primarySport, ...(profile.secondarySports ?? [])]
    .filter(Boolean) as string[]

  const normalized = raw
    .map(normalizeSport)
    .filter((s): s is SupportedSport => s !== undefined)

  return [...new Set(normalized)]
}

/**
 * Returns the normalized primary sport or undefined if not set.
 */
export function getPrimarySportNormalized(
  profile: AthleteProfile | null | undefined,
): SupportedSport | undefined {
  if (!profile) return undefined
  if (profile.sportContext?.primarySport) return profile.sportContext.primarySport
  return profile.primarySport ? normalizeSport(profile.primarySport) : undefined
}

/**
 * Returns normalized secondary sports.
 */
export function getSecondarySportsNormalized(
  profile: AthleteProfile | null | undefined,
): SupportedSport[] {
  if (!profile) return []
  if (profile.sportContext?.secondarySports?.length) return profile.sportContext.secondarySports
  return (profile.secondarySports ?? [])
    .map(normalizeSport)
    .filter((s): s is SupportedSport => s !== undefined)
}

/**
 * Human-readable sport priority string for use in prompts.
 * e.g. "squash > running > strength (objetivo: rendimiento competitivo)"
 */
export function getSportPrioritySummary(profile: AthleteProfile | null | undefined): string {
  const primary = getPrimarySportNormalized(profile)
  const secondary = getSecondarySportsNormalized(profile)
  const priority = profile?.sportContext?.trainingPriority

  const SPORT_ES: Record<SupportedSport, string> = {
    squash: 'squash',
    running: 'running',
    strength: 'fuerza',
    mobility: 'movilidad',
    cycling: 'ciclismo',
  }

  const sportLine = [
    primary ? SPORT_ES[primary] : null,
    ...secondary.map(s => SPORT_ES[s]),
  ]
    .filter(Boolean)
    .join(' > ')

  if (!sportLine) return ''

  if (priority) {
    const PRIORITY_ES: Record<TrainingPriority, string> = {
      performance: 'rendimiento competitivo',
      fitness: 'condición física general',
      body_composition: 'composición corporal',
      return_to_play: 'vuelta al deporte',
    }
    return `${sportLine} (objetivo: ${PRIORITY_ES[priority]})`
  }

  return sportLine
}

// ─── Display helpers ───────────────────────────────────────────────────────────

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
  // Check normalized enabled sports first
  const enabled = getEnabledSports(profile)
  const normalized = normalizeSport(sport)
  if (normalized && enabled.includes(normalized)) return true
  // Fallback: substring match on legacy free-text fields
  const needle = sport.toLowerCase()
  if (profile.primarySport?.toLowerCase().includes(needle)) return true
  return profile.secondarySports?.some((item) => item.toLowerCase().includes(needle)) ?? false
}

export function getAthleteSportsSummary(profile?: AthleteProfile | null): string {
  const SPORT_ES: Record<SupportedSport, string> = {
    squash: 'squash',
    running: 'running',
    strength: 'fuerza',
    mobility: 'movilidad',
    cycling: 'ciclismo',
  }

  // Prefer normalized enabled sports
  const enabled = getEnabledSports(profile)
  if (enabled.length > 0) {
    return enabled.map(s => SPORT_ES[s]).join(', ')
  }

  // Legacy: raw free-text strings
  const primary = profile?.primarySport?.trim()
  const secondary = profile?.secondarySports?.map((s) => s.trim()).filter(Boolean) ?? []
  if (primary && secondary.length > 0) return `${primary}, ${secondary.join(', ')}`
  if (primary) return primary
  if (secondary.length > 0) return secondary.join(', ')

  return ''
}

// ─── Profile completeness ──────────────────────────────────────────────────────

export function getProfileCompleteness(profile: AthleteProfile | null): ProfileCompleteness {
  if (!profile) {
    return {
      state: 'missing_profile',
      missing: ['perfil del atleta'],
      recommended: [],
    }
  }

  const configuredSports = getEnabledSports(profile)

  // Also check legacy free-text fields for backward compat
  const hasLegacySports = !!(
    profile.primarySport?.trim() ||
    (profile.secondarySports ?? []).some(s => s.trim())
  )

  if (configuredSports.length === 0 && !hasLegacySports) {
    return {
      state: 'missing_sports',
      missing: ['deporte principal'],
      recommended: ['nombre visible'],
    }
  }

  const missing: string[] = []
  const recommended: string[] = []

  const hasSport = (aliases: string[]) =>
    aliases.some((a) => includesSport(profile, a))

  const runningProfile = profile.runningProfile
  const hasRunningData =
    runningProfile?.z2PaceMin ||
    runningProfile?.z2PaceMax ||
    runningProfile?.thresholdPace ||
    runningProfile?.fiveKTime
  if (hasSport(['running', 'correr', 'run']) && !hasRunningData) missing.push('ritmos de running')

  const strengthProfile = profile.strengthProfile
  const hasStrengthData =
    strengthProfile?.benchPress1RM ||
    strengthProfile?.squat1RM ||
    strengthProfile?.deadlift1RM ||
    strengthProfile?.overheadPress1RM
  if (hasSport(['strength', 'fuerza', 'pesas', 'gym']) && !hasStrengthData) missing.push('1RMs de fuerza')

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

import type { AthleteProfile } from '../types'
import { getEnabledSports } from './athlete'
import { getActiveAthleteId, getSelfAthleteId } from '../services/athlete/activeAthlete'

const ONBOARDING_SKIP_KEY_PREFIX = 'entrenador:onboarding:skipped'

function getStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

// Self o sin atleta activo → key legacy (compat con el flag existente del owner);
// atleta gestionado → key sufijada por athleteId (spec 2b §6, espejo de chatSession).
function onboardingScopeSuffix(): string {
  const active = getActiveAthleteId()
  if (!active || active === getSelfAthleteId()) return ''
  return `:${active}`
}

function buildKey(userId?: string | null): string {
  const base = userId ? `${ONBOARDING_SKIP_KEY_PREFIX}:${userId}` : ONBOARDING_SKIP_KEY_PREFIX
  return `${base}${onboardingScopeSuffix()}`
}

export function hasSkippedOnboarding(userId?: string | null): boolean {
  return getStorage()?.getItem(buildKey(userId)) === '1'
}

export function markOnboardingSkipped(userId?: string | null): void {
  getStorage()?.setItem(buildKey(userId), '1')
}

export function clearOnboardingSkipped(userId?: string | null): void {
  getStorage()?.removeItem(buildKey(userId))
}

export function clearAllOnboardingSkipped(userId?: string | null): void {
  const storage = getStorage()
  if (!storage) return
  const prefix = userId ? `${ONBOARDING_SKIP_KEY_PREFIX}:${userId}` : ONBOARDING_SKIP_KEY_PREFIX
  const doomed: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key?.startsWith(prefix)) doomed.push(key)
  }
  doomed.forEach((key) => storage.removeItem(key))
}

export function needsOnboarding(profile: AthleteProfile | null | undefined): boolean {
  if (!profile) return true
  if (typeof profile.onboardingDeferredAt === 'number') return false

  const hasLegacySport = !!profile.primarySport?.trim()
  const hasEnabledSports = getEnabledSports(profile).length > 0
  return !hasEnabledSports && !hasLegacySport
}

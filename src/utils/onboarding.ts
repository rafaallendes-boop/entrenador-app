import type { AthleteProfile } from '../types'
import { getEnabledSports } from './athlete'

const ONBOARDING_SKIP_KEY_PREFIX = 'entrenador:onboarding:skipped'

function buildKey(userId?: string | null): string {
  return userId ? `${ONBOARDING_SKIP_KEY_PREFIX}:${userId}` : ONBOARDING_SKIP_KEY_PREFIX
}

export function hasSkippedOnboarding(userId?: string | null): boolean {
  return localStorage.getItem(buildKey(userId)) === '1'
}

export function markOnboardingSkipped(userId?: string | null): void {
  localStorage.setItem(buildKey(userId), '1')
}

export function clearOnboardingSkipped(userId?: string | null): void {
  localStorage.removeItem(buildKey(userId))
}

export function needsOnboarding(profile: AthleteProfile | null | undefined): boolean {
  if (!profile) return true

  const hasLegacySport = !!profile.primarySport?.trim()
  const hasEnabledSports = getEnabledSports(profile).length > 0
  return !hasEnabledSports && !hasLegacySport
}

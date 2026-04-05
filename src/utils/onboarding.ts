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

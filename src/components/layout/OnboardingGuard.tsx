import { useEffect, type ReactNode } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ROUTES } from '../../constants/routes'
import { useAuthStore } from '../../store/useAuthStore'
import { useEntitlementStore } from '../../store/useEntitlementStore'
import { useCoachMemoryStore } from '../../store/useCoachMemoryStore'
import { isSupabaseConfigured } from '../../services/auth'
import { hasInitialRemotePullCompleted } from '../../services/syncService'
import { hasSkippedOnboarding, needsOnboarding } from '../../utils/onboarding'

/**
 * Redirects first-time users (no sports configured) to onboarding.
 * Escape hatch: if primarySport has legacy free-text, skip the redirect.
 */
export default function OnboardingGuard({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore(s => s.user)
  const syncAttemptInFlight = useAuthStore(s => s.syncDetails.syncAttemptInFlight)
  const awaitingProfileRecreationAfterReset = useAuthStore(s => s.syncDetails.awaitingProfileRecreationAfterReset)
  const memoryLoadRequiredAfterSyncAt = useAuthStore(s => s.syncDetails.memoryLoadRequiredAfterSyncAt)
  const memoryLoadedForSyncAt = useAuthStore(s => s.syncDetails.memoryLoadedForSyncAt)
  const athleteProfile = useCoachMemoryStore(s => s.athleteProfile)
  const hasLoadedMemory = useCoachMemoryStore(s => s.hasLoaded)

  const activeAthleteId = useAuthStore(s => s.activeAthleteId)
  const role = useEntitlementStore(s => s.accountRole)
  const hydrated = useEntitlementStore(s => s.hydrated)
  const entitlementUserId = useEntitlementStore(s => s.userId)
  const pendingIdentity = !!user?.id && (!hydrated || entitlementUserId !== user.id)
  const coachWorkspace = location.pathname === ROUTES.COACH || location.pathname.startsWith(`${ROUTES.COACH}/`)
  const coachWithoutAthlete = role === 'coach' && !activeAthleteId
  // Workspace y páginas de cuenta no necesitan un perfil deportivo.
  const bypassAthleteOnboarding = coachWorkspace || coachWithoutAthlete

  useEffect(() => {
    if (pendingIdentity || bypassAthleteOnboarding) return
    if (location.pathname === ROUTES.ONBOARDING) return
    if (!hasLoadedMemory) return
    if (syncAttemptInFlight) return
    if (
      isSupabaseConfigured &&
      user?.id &&
      memoryLoadRequiredAfterSyncAt != null &&
      memoryLoadedForSyncAt !== memoryLoadRequiredAfterSyncAt
    ) return
    if (isSupabaseConfigured && user?.id && memoryLoadRequiredAfterSyncAt == null) return

    if (isSupabaseConfigured && user?.id && awaitingProfileRecreationAfterReset) {
      navigate(ROUTES.ONBOARDING, { replace: true })
      return
    }

    const skippedOnboarding = hasSkippedOnboarding(user?.id)

    // Multi-device safety: if we have a signed-in user but have never completed a remote pull
    // (e.g. sync failed before the profile was fetched), do NOT redirect to onboarding — a
    // profile may already exist in the cloud on another device. Wait for a successful sync.
    if (
      isSupabaseConfigured &&
      user?.id &&
      needsOnboarding(athleteProfile) &&
      !skippedOnboarding &&
      !hasInitialRemotePullCompleted(user.id)
    ) return

    if (needsOnboarding(athleteProfile) && !skippedOnboarding) {
      navigate(ROUTES.ONBOARDING, { replace: true })
    }
  }, [pendingIdentity, bypassAthleteOnboarding, athleteProfile, awaitingProfileRecreationAfterReset, hasLoadedMemory, location.pathname, memoryLoadRequiredAfterSyncAt, memoryLoadedForSyncAt, navigate, syncAttemptInFlight, user?.id])

  // Bloquea también el montaje del formulario abierto por URL antes de conocer
  // la identidad. La ausencia confirmada de entitlements conserva el atleta legacy.
  if (pendingIdentity) return <p role="status" className="px-4 py-6 text-sm text-ink-muted">Cargando tu cuenta...</p>
  if (coachWithoutAthlete && !coachWorkspace && location.pathname !== ROUTES.SETTINGS && location.pathname !== ROUTES.OPS) {
    return <Navigate to={ROUTES.COACH} replace />
  }
  return <>{children}</>
}


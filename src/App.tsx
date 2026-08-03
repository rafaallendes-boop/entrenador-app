import { BrowserRouter, Navigate, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { Component, lazy, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react'
import AppShell from './components/layout/AppShell'
import AuthGate from './components/auth/AuthGate'
import ConsentGate from './components/legal/ConsentGate'
import CoachScopeGuard from './components/layout/CoachScopeGuard'
import { ROUTES } from './constants/routes'
import { useAuthStore } from './store/useAuthStore'
import { runFullSync, migrateLocalDataToCloud, prepareLocalDataForUser, hasInitialRemotePullCompleted, pullMemberships } from './services/syncService'
import { useTrainingStore } from './store/useTrainingStore'
import { useCoachMemoryStore } from './store/useCoachMemoryStore'
import { usePlanBuilderStore } from './store/usePlanBuilderStore'
import { currentWeekStartISO } from './utils/date'
import { db } from './db/db'
import { hasSkippedOnboarding, needsOnboarding } from './utils/onboarding'
import { isSupabaseConfigured } from './services/auth'
import { backfillLocalAthleteScope } from './services/athlete/athleteScopeMigration'
import { hydrateActiveAthlete } from './services/athlete/hydrateActiveAthlete'
import { getActiveAthleteId } from './services/athlete/activeAthlete'
import NativeBridge from './components/native/NativeBridge'
import { NATIVE_RESUME_EVENT } from './services/nativeApp'
import { pullWorkouts } from './services/readiness/pullWorkouts'
import { autoCompleteFromWorkouts } from './services/readiness/autoCompleteFromWorkouts'
import { capturePendingClaimTokenFromUrl } from './services/athlete/claimGate'
import { isIOSPlatform } from './services/platform'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const WeeklyView = lazy(() => import('./pages/WeeklyView'))
const DayDetail = lazy(() => import('./pages/DayDetail'))
const ChatCoach = lazy(() => import('./pages/ChatCoach'))
const PlanBuilderPage = lazy(() => import('./pages/PlanBuilderPage'))
const CompetitionPlanPage = lazy(() => import('./pages/CompetitionPlanPage'))
const PlanBuilderV2Page = lazy(() => import('./pages/PlanBuilderV2Page'))
const ImportPDF = lazy(() => import('./pages/ImportPDF'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'))
const CoachWorkspacePage = lazy(() => import('./pages/CoachWorkspacePage'))
const NativeWelcomePreviewPage = lazy(() => import('./pages/NativeWelcomePreviewPage'))
const FeaturesPage = lazy(() => import('./pages/FeaturesPage'))
const PricingPage = lazy(() => import('./pages/PricingPage'))
const TermsPage = lazy(() => import('./pages/TermsPage'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))
const HealthDisclaimerPage = lazy(() => import('./pages/HealthDisclaimerPage'))
const WhoopDisclaimerPage = lazy(() => import('./pages/WhoopDisclaimerPage'))
const CoachesLandingPage = lazy(() => import('./pages/CoachesLandingPage'))

const AUTO_SYNC_RETRY_COOLDOWN_MS = 15_000

function RouteFallback() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center px-4">
      <div className="w-8 h-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
    </div>
  )
}

class AppRouteBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { hasError: boolean; message: string | null }
> {
  state: { hasError: boolean; message: string | null } = { hasError: false, message: null }

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Error inesperado',
    }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[router] route render failed', error, info.componentStack)
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, message: null })
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="mx-auto flex min-h-[55vh] w-full max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          No se pudo cargar esta vista.
          {this.state.message && <span className="mt-1 block text-xs text-rose-200/80">{this.state.message}</span>}
        </div>
        <a
          href={ROUTES.HOME}
          className="inline-flex items-center rounded-full border border-brand/30 bg-brand/15 px-4 py-2 text-sm font-semibold text-brand-light transition-colors hover:bg-brand/25"
        >
          Volver al inicio
        </a>
      </div>
    )
  }
}

function RouteBoundary({ children }: { children: ReactNode }) {
  const location = useLocation()
  return <AppRouteBoundary resetKey={location.pathname}>{children}</AppRouteBoundary>
}

/**
 * Redirects first-time users (no sports configured) to onboarding.
 * Escape hatch: if primarySport has legacy free-text, skip the redirect.
 */
function OnboardingGuard({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore(s => s.user)
  const syncAttemptInFlight = useAuthStore(s => s.syncDetails.syncAttemptInFlight)
  const awaitingProfileRecreationAfterReset = useAuthStore(s => s.syncDetails.awaitingProfileRecreationAfterReset)
  const memoryLoadRequiredAfterSyncAt = useAuthStore(s => s.syncDetails.memoryLoadRequiredAfterSyncAt)
  const memoryLoadedForSyncAt = useAuthStore(s => s.syncDetails.memoryLoadedForSyncAt)
  const athleteProfile = useCoachMemoryStore(s => s.athleteProfile)
  const hasLoadedMemory = useCoachMemoryStore(s => s.hasLoaded)

  useEffect(() => {
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
  }, [athleteProfile, awaitingProfileRecreationAfterReset, hasLoadedMemory, location.pathname, memoryLoadRequiredAfterSyncAt, memoryLoadedForSyncAt, navigate, syncAttemptInFlight, user?.id])

  return <>{children}</>
}

export default function App() {
  const user = useAuthStore(s => s.user)
  const isAuthLoading = useAuthStore(s => s.isLoading)
  const userId = user?.id ?? null
  const athleteProfile = useCoachMemoryStore(s => s.athleteProfile)
  const hasLoadedMemory = useCoachMemoryStore(s => s.hasLoaded)

  useEffect(() => {
    // D6: capture before authentication so the token survives the OAuth redirect.
    capturePendingClaimTokenFromUrl()
    void db.open().catch(console.error)
  }, [])

  useEffect(() => {
    if (!hasLoadedMemory || !athleteProfile) return
    void usePlanBuilderStore.getState().resumeGenerationJobs(athleteProfile)
  }, [athleteProfile, hasLoadedMemory])

  // Athlete Scope Foundation: ensure the owner's athlete row + stamp athleteId on
  // legacy local rows, then hydrate the active athlete id. Additive and invisible
  // with VITE_ATHLETE_SCOPE off; prepares data so the flag can be flipped safely.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void (async () => {
      try {
        await db.open().catch(() => {})
        capturePendingClaimTokenFromUrl()
        await pullMemberships(userId)
        if (cancelled) return
        const backfilled = await backfillLocalAthleteScope(userId)
        if (cancelled) return
        if (backfilled !== null) {
          await hydrateActiveAthlete(userId)
          if (cancelled) return
          useAuthStore.getState().setActiveAthleteId(getActiveAthleteId())
        }
      } catch (error) {
        console.error('[athlete-scope] hydration failed', error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userId])

  useEffect(() => {
    if (!userId) return

    let cancelled = false
    let syncInFlight = false
    let lastAutoRetryAt = 0

    const syncSignedInUser = async (reason: 'initial' | 'online' | 'visible' | 'focus' = 'initial') => {
      if (syncInFlight) return
      if (reason !== 'initial') {
        const now = Date.now()
        if (now - lastAutoRetryAt < AUTO_SYNC_RETRY_COOLDOWN_MS) return
        lastAutoRetryAt = now
      }
      syncInFlight = true
      const syncBoundaryAt = Date.now()
      useAuthStore.getState().setSyncDetails({
        memoryLoadRequiredAfterSyncAt: syncBoundaryAt,
        memoryLoadedForSyncAt: null,
      })

      try {
        await db.open().catch(() => {})
        capturePendingClaimTokenFromUrl()
        await pullMemberships(userId)
        if (cancelled) return
        const backfilled = await backfillLocalAthleteScope(userId)
        if (cancelled) return
        if (backfilled !== null) {
          await hydrateActiveAthlete(userId)
          if (cancelled) return
          useAuthStore.getState().setActiveAthleteId(getActiveAthleteId())
        }

        const { shouldMigrate } = await prepareLocalDataForUser(userId)
        if (cancelled) return

        if (shouldMigrate) {
          await migrateLocalDataToCloud(userId)
          if (cancelled) return
        }

        await runFullSync(userId)
        if (cancelled) return

        await pullWorkouts()
          .then(() => autoCompleteFromWorkouts())
          .catch((error) => console.warn('[whoop:auto-complete] pull+run failed', error))
        if (cancelled) return

        const { loadMemory } = useCoachMemoryStore.getState()
        await loadMemory()
        if (cancelled) return

        useAuthStore.getState().setSyncDetails({
          memoryLoadedForSyncAt: syncBoundaryAt,
        })

        const { loadWeek, loadAllSummaries } = useTrainingStore.getState()
        await Promise.all([
          loadWeek(currentWeekStartISO()),
          loadAllSummaries(),
        ])
      } catch (error) {
        const { loadMemory } = useCoachMemoryStore.getState()
        try {
          await loadMemory()
          if (!cancelled) {
            useAuthStore.getState().setSyncDetails({
              memoryLoadedForSyncAt: syncBoundaryAt,
            })
          }
        } catch (memoryError) {
          console.error('[app] failed to reload athlete profile after sync error', memoryError)
        }
        console.error('[app] signed-in sync failed', error)
      } finally {
        syncInFlight = false
      }
    }

    void syncSignedInUser()

    const handleOnline = () => {
      void syncSignedInUser('online')
    }

    // Shared foreground/resume auto-sync policy: skip while a schema_mismatch
    // error is pending its own retry, otherwise sync if the focus heuristic says so.
    const maybeAutoSyncOnForeground = (reason: 'focus' | 'visible') => {
      const { syncStatus, syncDetails } = useAuthStore.getState()
      if (syncStatus === 'error' && syncDetails.lastErrorCategory === 'schema_mismatch' && syncDetails.retryScheduledAt == null) return
      if (shouldAutoSyncOnFocus(syncStatus, syncDetails)) {
        void syncSignedInUser(reason)
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') maybeAutoSyncOnForeground('visible')
    }

    const handleFocus = () => maybeAutoSyncOnForeground('focus')

    const handleNativeResume = () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return
      maybeAutoSyncOnForeground('focus')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('focus', handleFocus)
    window.addEventListener(NATIVE_RESUME_EVENT, handleNativeResume)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    const intervalId = window.setInterval(() => {
      const { syncStatus, syncDetails } = useAuthStore.getState()
      if (syncStatus === 'syncing' || syncDetails.syncAttemptInFlight) return
      if (syncStatus === 'error' && syncDetails.lastErrorCategory === 'schema_mismatch' && syncDetails.retryScheduledAt == null) return
      if (syncDetails.pendingOps === 0 && syncStatus === 'error' && syncDetails.retryScheduledAt == null) return
      if (syncDetails.pendingOps === 0 && syncStatus !== 'error' && syncStatus !== 'offline') return
      const retryAt = syncDetails.retryScheduledAt
      if (retryAt != null && retryAt > Date.now()) return
      void syncSignedInUser('visible')
    }, 15000)

    return () => {
      cancelled = true
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener(NATIVE_RESUME_EVENT, handleNativeResume)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.clearInterval(intervalId)
    }
  }, [userId])

  return (
    <BrowserRouter>
      <NativeBridge />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          {isIOSPlatform() && !user && !isAuthLoading && (
            <Route path={ROUTES.HOME} element={<NativeWelcomePreviewPage />} />
          )}
          <Route path={ROUTES.IOS_WELCOME_PREVIEW} element={<NativeWelcomePreviewPage />} />
          <Route path={ROUTES.FEATURES} element={<RouteBoundary><FeaturesPage /></RouteBoundary>} />
          <Route path={ROUTES.PRICING} element={<RouteBoundary><PricingPage /></RouteBoundary>} />
          <Route path={ROUTES.TERMS} element={<RouteBoundary><TermsPage /></RouteBoundary>} />
          <Route path={ROUTES.PRIVACY} element={<RouteBoundary><PrivacyPage /></RouteBoundary>} />
          <Route path={ROUTES.HEALTH_DISCLAIMER} element={<RouteBoundary><HealthDisclaimerPage /></RouteBoundary>} />
          <Route path={ROUTES.WHOOP_DISCLAIMER} element={<RouteBoundary><WhoopDisclaimerPage /></RouteBoundary>} />
          <Route path={ROUTES.COACHES} element={<RouteBoundary><CoachesLandingPage /></RouteBoundary>} />
          <Route path="*" element={(
            <AuthGate>
              <ConsentGate>
                <CoachScopeGuard />
                <OnboardingGuard>
                  <Routes>
                  <Route path={ROUTES.ONBOARDING} element={<OnboardingPage />} />
                  <Route element={<AppShell />}>
                    <Route path={ROUTES.HOME} element={<RouteBoundary><Dashboard /></RouteBoundary>} />
                    <Route path={ROUTES.WEEK} element={<RouteBoundary><WeeklyView /></RouteBoundary>} />
                    <Route path="/day/:date" element={<RouteBoundary><DayDetail /></RouteBoundary>} />
                    <Route path={ROUTES.CHAT} element={<RouteBoundary><ChatCoach /></RouteBoundary>} />
                    <Route path={ROUTES.PLAN_BUILDER} element={<RouteBoundary><PlanBuilderPage /></RouteBoundary>} />
                    <Route path={ROUTES.COMPETITION_PLAN} element={<RouteBoundary><CompetitionPlanPage /></RouteBoundary>} />
                    <Route path={ROUTES.PLAN_BUILDER_V2} element={<RouteBoundary><PlanBuilderV2Page /></RouteBoundary>} />
                    <Route path="/history" element={<Navigate to={ROUTES.COMPETITION_PLAN} replace />} />
                    <Route path={ROUTES.COACH} element={<RouteBoundary><CoachWorkspacePage /></RouteBoundary>} />
                    <Route path="/dashboard" element={<Navigate to={ROUTES.HOME} replace />} />
                    <Route path="/plan" element={<Navigate to={ROUTES.COMPETITION_PLAN} replace />} />
                    <Route path="/plan/dashboard" element={<Navigate to={ROUTES.COMPETITION_PLAN} replace />} />
                    <Route path={ROUTES.SETTINGS} element={<RouteBoundary><SettingsPage /></RouteBoundary>} />
                    <Route path={ROUTES.IMPORT} element={<RouteBoundary><ImportPDF /></RouteBoundary>} />
                    <Route path="*" element={<Navigate to={ROUTES.HOME} replace />} />
                  </Route>
                  </Routes>
                </OnboardingGuard>
              </ConsentGate>
            </AuthGate>
          )} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

function shouldAutoSyncOnFocus(
  syncStatus: ReturnType<typeof useAuthStore.getState>['syncStatus'],
  syncDetails: ReturnType<typeof useAuthStore.getState>['syncDetails'],
): boolean {
  if (syncStatus === 'syncing' || syncDetails.syncAttemptInFlight) return false
  return true
}

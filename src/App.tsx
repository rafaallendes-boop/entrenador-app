import { BrowserRouter, Navigate, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import AppShell from './components/layout/AppShell'
import AuthGate from './components/auth/AuthGate'
import { ROUTES } from './constants/routes'
import { useAuthStore } from './store/useAuthStore'
import { runFullSync, migrateLocalDataToCloud, prepareLocalDataForUser, hasInitialRemotePullCompleted } from './services/syncService'
import { useTrainingStore } from './store/useTrainingStore'
import { useCoachMemoryStore } from './store/useCoachMemoryStore'
import { currentWeekStartISO } from './utils/date'
import { db } from './db/db'
import { hasSkippedOnboarding, needsOnboarding } from './utils/onboarding'
import { isSupabaseConfigured } from './services/auth'

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

function RouteFallback() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center px-4">
      <div className="w-8 h-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
    </div>
  )
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
  const userId = user?.id ?? null

  useEffect(() => {
    void db.open().catch(console.error)
  }, [])

  useEffect(() => {
    if (!userId) return

    let cancelled = false
    let syncInFlight = false
    let lastAutoRetryAt = 0

    const syncSignedInUser = async (reason: 'initial' | 'online' | 'visible' = 'initial') => {
      if (syncInFlight) return
      if (reason !== 'initial') {
        const now = Date.now()
        if (now - lastAutoRetryAt < 15000) return
        lastAutoRetryAt = now
      }
      syncInFlight = true
      const syncBoundaryAt = Date.now()
      useAuthStore.getState().setSyncDetails({
        memoryLoadRequiredAfterSyncAt: syncBoundaryAt,
        memoryLoadedForSyncAt: null,
      })

      try {
        const { shouldMigrate } = await prepareLocalDataForUser(userId)
        if (cancelled) return

        if (shouldMigrate) {
          await migrateLocalDataToCloud(userId)
          if (cancelled) return
        }

        await runFullSync(userId)
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

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const { syncStatus, syncDetails } = useAuthStore.getState()
        if (syncStatus === 'offline' || syncStatus === 'error' || syncDetails.pendingOps > 0) {
          void syncSignedInUser('visible')
        }
      }
    }

    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    const intervalId = window.setInterval(() => {
      const { syncStatus, syncDetails } = useAuthStore.getState()
      if (syncStatus === 'syncing' || syncDetails.syncAttemptInFlight) return
      if (syncDetails.pendingOps === 0 && syncStatus === 'error' && syncDetails.retryScheduledAt == null) return
      if (syncDetails.pendingOps === 0 && syncStatus !== 'error' && syncStatus !== 'offline') return
      const retryAt = syncDetails.retryScheduledAt
      if (retryAt != null && retryAt > Date.now()) return
      void syncSignedInUser('visible')
    }, 15000)

    return () => {
      cancelled = true
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.clearInterval(intervalId)
    }
  }, [userId])

  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <AuthGate>
          <OnboardingGuard>
            <Routes>
              <Route path={ROUTES.ONBOARDING} element={<OnboardingPage />} />
              <Route element={<AppShell />}>
                <Route path={ROUTES.HOME} element={<Dashboard />} />
                <Route path={ROUTES.WEEK} element={<WeeklyView />} />
                <Route path="/day/:date" element={<DayDetail />} />
                <Route path={ROUTES.CHAT} element={<ChatCoach />} />
                <Route path={ROUTES.PLAN_BUILDER} element={<PlanBuilderPage />} />
                <Route path={ROUTES.COMPETITION_PLAN} element={<CompetitionPlanPage />} />
                <Route path={ROUTES.PLAN_BUILDER_V2} element={<PlanBuilderV2Page />} />
                <Route path="/history" element={<Navigate to={ROUTES.COMPETITION_PLAN} replace />} />
                <Route path={ROUTES.SETTINGS} element={<SettingsPage />} />
                <Route path={ROUTES.IMPORT} element={<ImportPDF />} />
              </Route>
            </Routes>
          </OnboardingGuard>
        </AuthGate>
      </Suspense>
    </BrowserRouter>
  )
}

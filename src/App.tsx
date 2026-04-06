import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import AppShell from './components/layout/AppShell'
import AuthGate from './components/auth/AuthGate'
import { ROUTES } from './constants/routes'
import { useAuthStore } from './store/useAuthStore'
import { pullAll, migrateLocalDataToCloud, prepareLocalDataForUser } from './services/syncService'
import { useTrainingStore } from './store/useTrainingStore'
import { useCoachMemoryStore } from './store/useCoachMemoryStore'
import { currentWeekStartISO } from './utils/date'
import { db } from './db/db'
import { hasSkippedOnboarding, needsOnboarding } from './utils/onboarding'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const WeeklyView = lazy(() => import('./pages/WeeklyView'))
const DayDetail = lazy(() => import('./pages/DayDetail'))
const ChatCoach = lazy(() => import('./pages/ChatCoach'))
const PlanBuilderPage = lazy(() => import('./pages/PlanBuilderPage'))
const CompetitionPlanPage = lazy(() => import('./pages/CompetitionPlanPage'))
const History = lazy(() => import('./pages/History'))
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
  const athleteProfile = useCoachMemoryStore(s => s.athleteProfile)
  const hasLoadedMemory = useCoachMemoryStore(s => s.hasLoaded)

  useEffect(() => {
    if (location.pathname === ROUTES.ONBOARDING) return
    if (!hasLoadedMemory) return
    const skippedOnboarding = hasSkippedOnboarding(user?.id)

    if (needsOnboarding(athleteProfile) && !skippedOnboarding) {
      navigate(ROUTES.ONBOARDING, { replace: true })
    }
  }, [athleteProfile, hasLoadedMemory, location.pathname, navigate, user?.id])

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

      try {
      const { shouldMigrate } = await prepareLocalDataForUser(userId)
      if (cancelled) return

      if (shouldMigrate) {
        await migrateLocalDataToCloud(userId)
        if (cancelled) return
      }

      await pullAll(userId)
      if (cancelled) return

      const { loadWeek, loadAllSummaries } = useTrainingStore.getState()
      await Promise.all([
        loadWeek(currentWeekStartISO()),
        loadAllSummaries(),
      ])
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

    return () => {
      cancelled = true
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
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
                <Route path={ROUTES.HISTORY} element={<History />} />
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

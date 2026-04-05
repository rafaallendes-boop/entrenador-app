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
import { getEnabledSports } from './utils/athlete'
import { db } from './db/db'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const WeeklyView = lazy(() => import('./pages/WeeklyView'))
const DayDetail = lazy(() => import('./pages/DayDetail'))
const ChatCoach = lazy(() => import('./pages/ChatCoach'))
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
  const athleteProfile = useCoachMemoryStore(s => s.athleteProfile)

  useEffect(() => {
    if (location.pathname === ROUTES.ONBOARDING) return
    if (athleteProfile === null) return // still loading — don't redirect yet

    const hasLegacySport = !!athleteProfile.primarySport?.trim()
    const hasEnabledSports = getEnabledSports(athleteProfile).length > 0

    if (!hasEnabledSports && !hasLegacySport) {
      navigate(ROUTES.ONBOARDING, { replace: true })
    }
  }, [athleteProfile, location.pathname, navigate])

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

    const syncSignedInUser = async () => {
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
    }

    void syncSignedInUser()

    return () => {
      cancelled = true
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

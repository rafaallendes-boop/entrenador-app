import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { lazy, Suspense, useEffect } from 'react'
import AppShell from './components/layout/AppShell'
import { ROUTES } from './constants/routes'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const WeeklyView = lazy(() => import('./pages/WeeklyView'))
const DayDetail = lazy(() => import('./pages/DayDetail'))
const ChatCoach = lazy(() => import('./pages/ChatCoach'))
const History = lazy(() => import('./pages/History'))
const ImportPDF = lazy(() => import('./pages/ImportPDF'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

function RouteFallback() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center px-4">
      <div className="w-8 h-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
    </div>
  )
}

export default function App() {
  useEffect(() => {
    void import('./db/db')
      .then(({ db }) => db.open())
      .catch(console.error)
  }, [])

  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
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
      </Suspense>
    </BrowserRouter>
  )
}

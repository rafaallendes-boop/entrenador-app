import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useEffect } from 'react'
import AppShell from './components/layout/AppShell'
import Dashboard from './pages/Dashboard'
import WeeklyView from './pages/WeeklyView'
import DayDetail from './pages/DayDetail'
import ChatCoach from './pages/ChatCoach'
import History from './pages/History'
import ImportPDF from './pages/ImportPDF'
import { ROUTES } from './constants/routes'
import { seedDatabase } from './db/seed'

export default function App() {
  useEffect(() => {
    seedDatabase().catch(console.error)
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path={ROUTES.HOME}    element={<Dashboard />} />
          <Route path={ROUTES.WEEK}    element={<WeeklyView />} />
          <Route path="/day/:date"     element={<DayDetail />} />
          <Route path={ROUTES.CHAT}    element={<ChatCoach />} />
          <Route path={ROUTES.HISTORY} element={<History />} />
          <Route path={ROUTES.IMPORT}  element={<ImportPDF />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

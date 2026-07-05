import { Outlet, useLocation } from 'react-router-dom'
import BottomNav from './BottomNav'
import CoachContextBar from './CoachContextBar'
import { ROUTES } from '../../constants/routes'
import { useAuthStore } from '../../store/useAuthStore'

export default function AppShell() {
  const { pathname } = useLocation()
  const isChatRoute = pathname === ROUTES.CHAT
  const activeAthleteId = useAuthStore((state) => state.activeAthleteId)

  return (
    <div className="min-h-screen bg-surface flex flex-col w-full max-w-5xl mx-auto md:px-4 lg:px-6">
      <CoachContextBar />
      {/* Remount coordinado (spec 2b §3.3): cambiar de atleta desmonta y
          remonta las páginas, que releen Dexie con los lookups scoped. */}
      <main
        key={activeAthleteId ?? 'legacy'}
        className={isChatRoute ? 'flex-1 overflow-hidden' : 'flex-1 overflow-y-auto pb-24 md:pb-28'}
      >
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}

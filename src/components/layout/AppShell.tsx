import { Outlet, useLocation } from 'react-router-dom'
import BottomNav from './BottomNav'
import { ROUTES } from '../../constants/routes'

export default function AppShell() {
  const { pathname } = useLocation()
  const isChatRoute = pathname === ROUTES.CHAT

  return (
    <div className="min-h-screen bg-surface flex flex-col w-full max-w-5xl mx-auto md:px-4 lg:px-6">
      <main className={isChatRoute ? 'flex-1 overflow-hidden' : 'flex-1 overflow-y-auto pb-24 md:pb-28'}>
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}

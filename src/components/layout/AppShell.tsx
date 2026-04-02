import { Outlet } from 'react-router-dom'
import BottomNav from './BottomNav'

export default function AppShell() {
  return (
    <div className="min-h-screen bg-surface flex flex-col w-full max-w-5xl mx-auto md:px-4 lg:px-6">
      <main className="flex-1 overflow-y-auto pb-24 md:pb-28">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}

import { NavLink } from 'react-router-dom'
import { Home, CalendarDays, MessageCircle, Clock } from 'lucide-react'
import { ROUTES } from '../../constants/routes'

const tabs = [
  { to: ROUTES.HOME,    label: 'Home',     Icon: Home },
  { to: ROUTES.WEEK,    label: 'Semana',   Icon: CalendarDays },
  { to: ROUTES.CHAT,    label: 'Coach',    Icon: MessageCircle },
  { to: ROUTES.HISTORY, label: 'Historial', Icon: Clock },
]

export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg bg-surface-card border-t border-surface-border safe-bottom">
      <div className="flex">
        {tabs.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === ROUTES.HOME}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors ${
                isActive
                  ? 'text-brand'
                  : 'text-ink-faint hover:text-ink-muted'
              }`
            }
          >
            <Icon size={22} />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

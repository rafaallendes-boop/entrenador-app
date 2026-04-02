import { NavLink } from 'react-router-dom'
import { ROUTES } from '../../constants/routes'
import SyncStatusBadge from '../sync/SyncStatusBadge'
import { useAuthStore } from '../../store/useAuthStore'

const tabs = [
  { to: ROUTES.HOME, label: 'Home', icon: 'home' },
  { to: ROUTES.WEEK, label: 'Semana', icon: 'calendar' },
  { to: ROUTES.CHAT, label: 'Coach', icon: 'chat' },
  { to: ROUTES.HISTORY, label: 'Historial', icon: 'history' },
  { to: ROUTES.SETTINGS, label: 'Ajustes', icon: 'settings' },
]

export default function BottomNav() {
  const { syncStatus, syncError } = useAuthStore()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 px-2 pb-2 md:px-4">
      <div className="mx-auto w-full max-w-5xl rounded-t-2xl border border-surface-border bg-surface-card shadow-lg shadow-black/10 safe-bottom">
        <div className="px-3 pt-2 flex justify-end">
          <SyncStatusBadge status={syncStatus} error={syncError} compact />
        </div>
        <div className="flex">
          {tabs.map(({ to, label, icon }) => (
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
              <NavIcon name={icon} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  )
}

function NavIcon({ name }: { name: string }) {
  const commonProps = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.9',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'w-[22px] h-[22px]',
    'aria-hidden': true,
  }

  switch (name) {
    case 'calendar':
      return (
        <svg {...commonProps}>
          <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
          <path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.5h17" />
        </svg>
      )
    case 'chat':
      return (
        <svg {...commonProps}>
          <path d="M5.5 18.5 6.2 15A7.5 7.5 0 1 1 12 19.5H5.5Z" />
        </svg>
      )
    case 'history':
      return (
        <svg {...commonProps}>
          <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
          <path d="M4 6.5v4h4" />
          <path d="M12 8.5v4l2.8 1.6" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...commonProps}>
          <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
          <path d="M19 12a7.4 7.4 0 0 0-.1-1.3l2-1.5-2-3.4-2.4 1a7.7 7.7 0 0 0-2.1-1.2L14 3h-4l-.4 2.6a7.7 7.7 0 0 0-2.1 1.2l-2.4-1-2 3.4 2 1.5A7.4 7.4 0 0 0 5 12c0 .4 0 .9.1 1.3l-2 1.5 2 3.4 2.4-1c.6.5 1.3.9 2.1 1.2L10 21h4l.4-2.6c.8-.3 1.5-.7 2.1-1.2l2.4 1 2-3.4-2-1.5c.1-.4.1-.9.1-1.3Z" />
        </svg>
      )
    default:
      return (
        <svg {...commonProps}>
          <path d="M4.5 10.5 12 4l7.5 6.5" />
          <path d="M6.5 9.5V20h11V9.5" />
        </svg>
      )
  }
}

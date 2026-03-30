import { Clock, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Session } from '../../types'
import { SESSION_TYPE_CONFIG, SQUASH_SUBTYPE_LABELS } from '../../constants/sessionTypes'
import { formatDuration } from '../../utils/format'
import { formatShortDate, fromISO } from '../../utils/date'
import SessionTypeIcon from '../session/SessionTypeIcon'
import { ROUTES } from '../../constants/routes'

interface NextSessionCardProps {
  session: Session
}

export default function NextSessionCard({ session }: NextSessionCardProps) {
  const navigate = useNavigate()
  const config = SESSION_TYPE_CONFIG[session.type]
  const subtypeLabel = session.subtype ? SQUASH_SUBTYPE_LABELS[session.subtype] : null

  return (
    <button
      onClick={() => navigate(ROUTES.DAY(session.date))}
      className={`w-full text-left rounded-xl border ${config.borderClass} ${config.bgClass} p-3 flex items-center gap-3 active:scale-[0.98] transition-transform`}
    >
      <SessionTypeIcon type={session.type} size={18} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink truncate">{session.title}</span>
          {subtypeLabel && (
            <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${config.bgClass} ${config.textClass} border ${config.borderClass} font-medium flex-shrink-0`}>
              {subtypeLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="text-xs text-ink-muted">
            {formatShortDate(fromISO(session.date))} · {session.timeBlock}
          </span>
          <span className="flex items-center gap-1 text-xs text-ink-muted">
            <Clock size={11} />
            {formatDuration(session.durationMin)}
          </span>
        </div>
      </div>
      <ChevronRight size={16} className="text-ink-faint flex-shrink-0" />
    </button>
  )
}

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fromISO, getWeekDays, formatDay, formatDayNum, isDateToday, toISO } from '../../utils/date'
import { useUIStore } from '../../store/useUIStore'
import { useTrainingStore } from '../../store/useTrainingStore'
import { SESSION_TYPE_CONFIG } from '../../constants/sessionTypes'
import type { SessionType } from '../../types'

interface WeekStripProps {
  showNav?: boolean
  onDayPress?: (iso: string) => void
}

export default function WeekStrip({ showNav = true, onDayPress }: WeekStripProps) {
  const { currentWeekStart, selectedDate, setSelectedDate, navigateWeek } = useUIStore()
  const sessions = useTrainingStore(s => s.sessions)

  const weekDays = getWeekDays(fromISO(currentWeekStart))

  const getSessionsForDate = (dateISO: string) =>
    sessions.filter(s => s.date === dateISO)

  return (
    <div className="px-4 py-3 md:px-0">
      {showNav && (
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => navigateWeek('prev')}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-raised text-ink-muted hover:text-ink"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="font-display text-sm font-semibold uppercase tracking-wider text-ink-muted">
            {fromISO(currentWeekStart).toLocaleString('es', { month: 'long', year: 'numeric' })}
          </span>
          <button
            onClick={() => navigateWeek('next')}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-raised text-ink-muted hover:text-ink"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-7 gap-1 md:gap-2">
        {weekDays.map(day => {
          const iso = toISO(day)
          const isSelected = iso === selectedDate
          const isToday = isDateToday(iso)
          const daySessions = getSessionsForDate(iso)
          const activeSessions = daySessions.filter(s => s.status !== 'skipped')
          const types = [...new Set(activeSessions.map(s => s.type))] as SessionType[]

          return (
            <button
              key={iso}
              onClick={() => { setSelectedDate(iso); onDayPress?.(iso) }}
              className={`flex flex-col items-center gap-1 py-2.5 rounded-xl transition-all ${
                isSelected
                  ? 'bg-brand text-white shadow-glow'
                  : isToday
                  ? 'bg-brand/15 text-brand-light'
                  : 'text-ink-muted hover:bg-surface-raised'
              }`}
            >
              <span className="font-display text-[10px] font-semibold uppercase tracking-wider md:text-[11px]">
                {formatDay(day)}
              </span>
              <span className={`font-display text-lg font-bold md:text-xl ${isSelected ? 'text-white' : ''}`}>
                {formatDayNum(day)}
              </span>
              {/* Type dots */}
              <div className="flex gap-0.5 min-h-[6px]">
                {types.slice(0, 3).map(type => (
                  <div
                    key={type}
                    className={`w-1.5 h-1.5 rounded-full ${
                      isSelected ? 'bg-white/70' : SESSION_TYPE_CONFIG[type].dotClass
                    }`}
                  />
                ))}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

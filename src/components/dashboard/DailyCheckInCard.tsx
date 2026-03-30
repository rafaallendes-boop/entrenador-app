import { useEffect, useState } from 'react'
import { CheckCircle2, Minus, X, ChevronDown, ChevronUp } from 'lucide-react'
import { useTrainingStore } from '../../store/useTrainingStore'
import { todayISO } from '../../utils/date'
import type { Session } from '../../types'

const STATUS_OPTIONS = [
  { value: 'completed' as const, label: 'Realizada', icon: CheckCircle2, activeClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  { value: 'adjusted' as const, label: 'Ajustada', icon: Minus, activeClass: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  { value: 'skipped' as const, label: 'Saltada', icon: X, activeClass: 'bg-red-500/20 text-red-400 border-red-500/30' },
]

function DotScale({
  label,
  value,
  max = 10,
  onChange,
  colorFn,
}: {
  label: string
  value?: number
  max?: number
  onChange: (v: number) => void
  colorFn?: (v: number) => string
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs text-ink-muted">{label}</span>
        <span className="text-xs font-semibold text-ink">{value != null ? `${value}/${max}` : '—'}</span>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: max }, (_, i) => i + 1).map(n => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={`flex-1 h-5 rounded-sm transition-all ${
              value != null && n <= value
                ? (colorFn ? colorFn(value) : 'bg-brand')
                : 'bg-surface-raised border border-surface-border'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

interface Props {
  todaySessions: Session[]
}

export default function DailyCheckInCard({ todaySessions }: Props) {
  const { dayLogs, saveDayLog, cycleSessionStatus } = useTrainingStore()
  const today = todayISO()
  const dayLog = dayLogs[today]

  const [expanded, setExpanded] = useState(false)
  const [comment, setComment] = useState(dayLog?.postSessionComment ?? '')
  const [bodyWeight, setBodyWeight] = useState(dayLog?.bodyWeight?.toString() ?? '')

  useEffect(() => {
    setComment(dayLog?.postSessionComment ?? '')
    setBodyWeight(dayLog?.bodyWeight?.toString() ?? '')
  }, [dayLog?.postSessionComment, dayLog?.bodyWeight, dayLog?.updatedAt])

  const save = (patch: Parameters<typeof saveDayLog>[1]) => saveDayLog(today, patch)

  const activeSessions = todaySessions.filter(s => s.status !== 'skipped')
  const completedCount = todaySessions.filter(s => s.status === 'completed').length

  const energyColor = (v: number) =>
    v >= 8 ? 'bg-emerald-500' : v >= 5 ? 'bg-brand' : 'bg-amber-500'

  const painColor = (v: number) =>
    v >= 7 ? 'bg-red-500' : v >= 4 ? 'bg-amber-500' : 'bg-teal-500'

  return (
    <div className="bg-surface-card rounded-card border border-surface-border overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-brand/15 flex items-center justify-center flex-shrink-0">
            <span className="text-sm">⚡</span>
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-ink">Check-in de hoy</p>
            <p className="text-xs text-ink-muted mt-0.5">
              {activeSessions.length === 0
                ? 'Día libre'
                : `${completedCount}/${activeSessions.length} sesiones · ${
                    dayLog?.energyLevel != null
                      ? `Energía ${dayLog.energyLevel}/10`
                      : 'Sin registrar aún'
                  }`}
            </p>
          </div>
        </div>
        <span className="text-ink-faint">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-4 space-y-4 border-t border-surface-border">
          {todaySessions.length > 0 && (
            <div>
              <p className="text-[11px] text-ink-faint uppercase tracking-wider font-medium mb-2">Estado sesiones</p>
              <div className="space-y-2">
                {todaySessions.map(session => (
                  <div key={session.id} className="flex items-center gap-2">
                    <span className="text-xs text-ink flex-1 truncate">{session.title}</span>
                    <div className="flex gap-1 flex-shrink-0">
                      {STATUS_OPTIONS.map(opt => {
                        const Icon = opt.icon
                        const active = session.status === opt.value
                        return (
                          <button
                            key={opt.value}
                            onClick={() => cycleSessionStatus(session.id)}
                            title={opt.label}
                            className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-all ${
                              active
                                ? opt.activeClass
                                : 'bg-surface-raised border-surface-border text-ink-faint'
                            }`}
                          >
                            <Icon size={12} />
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <DotScale
            label="Energía"
            value={dayLog?.energyLevel}
            max={10}
            onChange={v => save({ energyLevel: v })}
            colorFn={energyColor}
          />

          <DotScale
            label="Dolor / molestia"
            value={dayLog?.painLevel}
            max={10}
            onChange={v => save({ painLevel: v })}
            colorFn={painColor}
          />

          <DotScale
            label="Calidad sueño"
            value={dayLog?.sleepQuality}
            max={5}
            onChange={v => save({ sleepQuality: v })}
          />

          <DotScale
            label="RPE real"
            value={dayLog?.rpeActual}
            max={10}
            onChange={v => save({ rpeActual: v })}
          />

          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center">
              <label className="text-xs text-ink-muted">Peso corporal</label>
              <span className="text-xs font-semibold text-ink">
                {dayLog?.bodyWeight != null ? `${dayLog.bodyWeight} kg` : '—'}
              </span>
            </div>
            <input
              type="number"
              min={30}
              max={200}
              step={0.1}
              inputMode="decimal"
              value={bodyWeight}
              onChange={e => setBodyWeight(e.target.value)}
              onBlur={() => save({
                bodyWeight: bodyWeight.trim() === '' ? undefined : Number(bodyWeight),
              })}
              placeholder="ej: 78.4"
              className="w-full bg-surface-raised border border-surface-border rounded-xl px-3 py-2 text-sm text-ink placeholder-ink-faint focus:outline-none focus:border-brand/50"
            />
          </div>

          <div>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              onBlur={() => save({ postSessionComment: comment || undefined })}
              placeholder="¿Cómo fue? Sensaciones rápidas..."
              rows={2}
              className="w-full bg-surface-raised border border-surface-border rounded-xl px-3 py-2 text-sm text-ink placeholder-ink-faint resize-none focus:outline-none focus:border-brand/50"
            />
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp, Minus, X } from 'lucide-react'
import { useTrainingStore } from '../../store/useTrainingStore'
import type { DayLog, Session } from '../../types'
import { todayISO } from '../../utils/date'

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
        <span className="text-xs font-semibold text-ink">{value != null ? `${value}/${max}` : '-'}</span>
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

function DailyCheckInNotes({
  dayLog,
  onSave,
}: {
  dayLog?: DayLog
  onSave: (patch: Partial<DayLog>) => void
}) {
  const [comment, setComment] = useState(dayLog?.postSessionComment ?? '')
  const [bodyWeight, setBodyWeight] = useState(dayLog?.bodyWeight?.toString() ?? '')

  const saveBodyWeight = () => {
    const normalized = bodyWeight.trim().replace(',', '.')
    const parsed = normalized === '' ? undefined : Number(normalized)

    onSave({
      bodyWeight: parsed != null && Number.isFinite(parsed) ? parsed : undefined,
    })

    if (parsed != null && Number.isFinite(parsed)) {
      setBodyWeight(String(parsed))
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between items-center">
          <label className="text-xs text-ink-muted">Peso corporal</label>
          <span className="text-xs font-semibold text-ink">
            {dayLog?.bodyWeight != null ? `${dayLog.bodyWeight} kg` : '-'}
          </span>
        </div>
        <input
          type="text"
          inputMode="decimal"
          value={bodyWeight}
          onChange={e => setBodyWeight(e.target.value)}
          onBlur={saveBodyWeight}
          placeholder="ej: 78,4"
          className="w-full bg-surface-raised border border-surface-border rounded-xl px-3 py-2 text-sm text-ink placeholder-ink-faint focus:outline-none focus:border-brand/50"
        />
      </div>

      <div>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          onBlur={() => onSave({ postSessionComment: comment || undefined })}
          placeholder="¿Como fue? Sensaciones rapidas..."
          rows={2}
          className="w-full bg-surface-raised border border-surface-border rounded-xl px-3 py-2 text-sm text-ink placeholder-ink-faint resize-none focus:outline-none focus:border-brand/50"
        />
      </div>
    </>
  )
}

interface Props {
  todaySessions: Session[]
  autoExpandToken?: number
}

export default function DailyCheckInCard({ todaySessions, autoExpandToken = 0 }: Props) {
  const { dayLogs, saveDayLog, updateSession } = useTrainingStore()
  const today = todayISO()
  const dayLog = dayLogs[today]

  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (autoExpandToken > 0) {
      setExpanded(true)
    }
  }, [autoExpandToken])

  const save = (patch: Parameters<typeof saveDayLog>[1]) => saveDayLog(today, patch)

  const activeSessions = todaySessions.filter(s => s.status !== 'skipped')
  const completedCount = todaySessions.filter(s => s.status === 'completed' || s.status === 'adjusted').length

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
                ? 'Dia libre'
                : `${completedCount}/${activeSessions.length} sesiones - ${
                    dayLog?.energyLevel != null
                      ? `Energia ${dayLog.energyLevel}/10`
                      : 'Sin registrar aun'
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
                            onClick={() => void updateSession(session.id, { status: opt.value })}
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
            label="Energia"
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
            label="Calidad sueno"
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

          <DailyCheckInNotes
            key={`${today}-${dayLog?.updatedAt ?? 'empty'}-${dayLog?.bodyWeight ?? 'none'}-${dayLog?.postSessionComment ?? ''}`}
            dayLog={dayLog}
            onSave={save}
          />
        </div>
      )}
    </div>
  )
}

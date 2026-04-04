import { Zap, Wind, Dumbbell, Clock, TrendingUp, Moon, Weight } from 'lucide-react'
import type { WeekSummary } from '../../types'
import Card from '../ui/Card'
import { formatDuration } from '../../utils/format'

interface WeekSummaryCardProps {
  summary: WeekSummary
  compact?: boolean
  showDisciplineAdherence?: boolean
}

export default function WeekSummaryCard({
  summary,
  compact = false,
  showDisciplineAdherence = false,
}: WeekSummaryCardProps) {
  const secondaryStats = [
    {
      key: 'strength',
      Icon: Dumbbell,
      value: String(summary.strengthSessions),
      label: 'Fuerza',
      colorClass: 'text-orange-400',
    },
    summary.avgActualRpe != null
      ? {
          key: 'rpe',
          Icon: TrendingUp,
          value: summary.avgActualRpe.toFixed(1),
          label: 'RPE real',
          colorClass: 'text-ink-muted',
        }
      : null,
    summary.avgBodyWeight != null
      ? {
          key: 'weight',
          Icon: Weight,
          value: `${summary.avgBodyWeight.toFixed(1)} kg`,
          label: 'Peso avg',
          colorClass: 'text-cyan-400',
        }
      : null,
    summary.avgSleep != null
      ? {
          key: 'sleep',
          Icon: Moon,
          value: `${summary.avgSleep.toFixed(1)}h`,
          label: 'Sueño avg',
          colorClass: 'text-violet-400',
        }
      : null,
  ].filter(Boolean).slice(0, 3) as Array<{
    key: string
    Icon: React.ComponentType<{ size?: number; className?: string }>
    value: string
    label: string
    colorClass: string
  }>

  return (
    <Card className="p-4 md:p-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          Icon={Clock}
          value={formatDuration(summary.completedMinutes)}
          label="Volumen"
          colorClass="text-brand-light"
        />
        <Stat
          Icon={Zap}
          value={String(summary.squashSessions)}
          label="Squash"
          colorClass="text-yellow-400"
        />
        <Stat
          Icon={Wind}
          value={String(summary.runningSessions)}
          label="Running"
          colorClass="text-sky-400"
        />
      </div>

      {!compact && (
        <>
          <div className="grid grid-cols-1 gap-3 mt-3 sm:grid-cols-3">
            {secondaryStats.map((stat) => (
              <Stat
                key={stat.key}
                Icon={stat.Icon}
                value={stat.value}
                label={stat.label}
                colorClass={stat.colorClass}
              />
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-ink-muted flex-wrap">
            <span>{summary.completedSessions}/{summary.plannedSessions} planificadas realizadas</span>
            {summary.adherencePct != null && (
              <span className="font-semibold text-brand-light">{summary.adherencePct}% adherencia</span>
            )}
          </div>

          {showDisciplineAdherence && (
            <div className="mt-3 pt-3 border-t border-surface-border space-y-2">
              <DisciplineBar
                label="Squash"
                completed={summary.squashSessions}
                planned={summary.plannedSquashSessions}
                colorClass="bg-yellow-400"
              />
              <DisciplineBar
                label="Running"
                completed={summary.runningSessions}
                planned={summary.plannedRunningSessions}
                colorClass="bg-sky-400"
              />
              <DisciplineBar
                label="Fuerza"
                completed={summary.strengthSessions}
                planned={summary.plannedStrengthSessions}
                colorClass="bg-orange-400"
              />
            </div>
          )}

          {summary.coachNote && (
            <div className="mt-3 pt-3 border-t border-surface-border">
              <p className="text-xs text-ink-muted italic leading-relaxed">
                "{summary.coachNote}"
              </p>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function Stat({
  Icon,
  value,
  label,
  colorClass,
}: {
  Icon: React.ComponentType<{ size?: number; className?: string }>
  value: string
  label: string
  colorClass: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-surface-raised/60 p-3">
      <Icon size={14} className={colorClass} />
      <span className="text-lg font-semibold text-ink break-words">{value}</span>
      <span className="text-[11px] text-ink-muted">{label}</span>
    </div>
  )
}

function DisciplineBar({
  label,
  completed,
  planned,
  colorClass,
}: {
  label: string
  completed: number
  planned?: number
  colorClass: string
}) {
  if (planned == null || planned === 0) return null

  const pct = Math.min(100, Math.round((completed / planned) * 100))

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-ink-faint w-12 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-surface-raised rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${colorClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] text-ink-muted w-16 text-right flex-shrink-0">
        {completed}/{planned} · {pct}%
      </span>
    </div>
  )
}

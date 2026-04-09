import type { LoadAnalytics, LoadTrend, DisciplineWeekLoad, ACWRZone, SportKey } from '../../services/loadAnalytics'

interface Props {
  analytics: LoadAnalytics
}

const SPORT_CONFIG: Record<string, { label: string; color: string }> = {
  squash:   { label: 'Squash',   color: 'bg-violet-500' },
  running:  { label: 'Running',  color: 'bg-emerald-500' },
  cycling:  { label: 'Ciclismo', color: 'bg-sky-500' },
  strength: { label: 'Fuerza',   color: 'bg-amber-500' },
  mobility: { label: 'Mov.',     color: 'bg-pink-500' },
}

const ACWR_CONFIG: Record<ACWRZone, { dot: string; text: string; label: string; detail: string }> = {
  undertrained: { dot: 'bg-sky-400',     text: 'text-sky-400',     label: 'Baja',     detail: 'Ratio <0.8 — margen para progresar si la recuperacion acompana' },
  optimal:      { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'Optima',   detail: 'Ratio 0.8-1.3 — zona razonable de progresion' },
  risk:         { dot: 'bg-red-400',     text: 'text-red-400',     label: 'Elevada',  detail: 'Ratio >1.3 — evita sumar volumen y prioriza descarga' },
  limited:      { dot: 'bg-amber-400',   text: 'text-amber-400',   label: 'Insuf.',   detail: 'Pocas semanas con carga — usar como referencia suave' },
}

const DISCIPLINE_ACWR_SPORTS: SportKey[] = ['squash', 'running', 'strength', 'cycling']
const DISCIPLINE_LABEL: Record<SportKey, string> = {
  squash: 'Squash', running: 'Running', strength: 'Fuerza', cycling: 'Ciclismo',
}

const TREND_CONFIG: Record<LoadTrend, { icon: string; color: string; label: string }> = {
  increasing: { icon: '↑', color: 'text-amber-400', label: 'subiendo' },
  stable:     { icon: '→', color: 'text-emerald-400', label: 'estable' },
  decreasing: { icon: '↓', color: 'text-sky-400', label: 'bajando' },
}

function BarRow({ disc, maxMinutes }: { disc: DisciplineWeekLoad; maxMinutes: number }) {
  const cfg = SPORT_CONFIG[disc.type]
  if (!cfg || disc.plannedSessions === 0) return null
  const pct = maxMinutes > 0 ? Math.round((disc.completedMinutes / maxMinutes) * 100) : 0
  const plannedPct = maxMinutes > 0 ? Math.round((disc.plannedMinutes / maxMinutes) * 100) : 0

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-muted w-14 flex-shrink-0">{cfg.label}</span>
        <div className="relative flex-1 h-2 rounded-full bg-surface-border overflow-hidden">
          {/* planned bar (ghost) */}
          <div
            className="absolute inset-y-0 left-0 rounded-full opacity-20"
            style={{ width: `${plannedPct}%`, background: 'currentColor' }}
          />
          {/* completed bar */}
          <div
            className={`absolute inset-y-0 left-0 rounded-full ${cfg.color}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs text-ink w-16 text-right flex-shrink-0">
          {disc.completedMinutes}
          <span className="text-ink-faint">/{disc.plannedMinutes}min</span>
        </span>
      </div>
    </div>
  )
}

function WeekColumn({
  week,
  label,
  isCurrentWeek,
}: {
  week: LoadAnalytics['weeks'][number]
  label: string
  isCurrentWeek: boolean
}) {
  const hasSessions = week.disciplines.some(d => d.plannedSessions > 0)

  return (
    <div className={`text-center ${isCurrentWeek ? '' : 'opacity-60'}`}>
      <p className="text-[10px] font-medium text-ink-faint uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-lg font-bold ${isCurrentWeek ? 'text-ink' : 'text-ink-muted'}`}>
        {hasSessions ? `${week.adherencePct}%` : '—'}
      </p>
      <p className="text-[10px] text-ink-faint">adherencia</p>
      {week.totalWeightedLoad > 0 && (
        <p className="text-[10px] text-ink-muted mt-0.5">
          {Math.round(week.totalWeightedLoad / 10) * 10}
          <span className="text-ink-faint"> carga</span>
        </p>
      )}
    </div>
  )
}

export default function LoadAnalyticsCard({ analytics }: Props) {
  const current = analytics.weeks[0]
  if (!current) return null

  const allDisciplines = current.disciplines.filter(d => d.plannedSessions > 0)
  const maxMinutes = Math.max(...allDisciplines.map(d => Math.max(d.completedMinutes, d.plannedMinutes)), 1)
  const runningCurrentWeek = analytics.runningWeeklyLoads[0]

  const trendCfg = TREND_CONFIG[analytics.overallTrend]

  // Running minutes last 4 weeks for mini sparkline
  const runningWeeks = analytics.weeks.map(w => w.runningMinutes)
  const hasRunning = runningWeeks.some(m => m > 0)

  return (
    <div className="space-y-4">
      {/* ACWR por disciplina — 3 semáforos */}
      <div className="rounded-xl border border-surface-border bg-surface-raised/40 px-3 py-2.5 space-y-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">
          ACWR por disciplina
        </p>
        <div className="grid grid-cols-3 gap-2">
          {DISCIPLINE_ACWR_SPORTS.map(sport => {
            const disc = analytics.acwrByDiscipline[sport]
            const cfg = ACWR_CONFIG[disc.status]
            return (
              <div
                key={sport}
                className="flex flex-col items-center gap-1 py-2 px-1.5 rounded-lg bg-surface-raised"
              >
                <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                <span className="text-[10px] font-semibold text-ink">{DISCIPLINE_LABEL[sport]}</span>
                <span className="text-[11px] font-mono text-ink-muted">
                  {disc.ratio != null ? disc.ratio.toFixed(2) : '—'}
                </span>
                <span className={`text-[9px] font-medium ${cfg.text}`}>{cfg.label}</span>
              </div>
            )
          })}
        </div>
        {analytics.acwr && (
          <p className="text-[10px] text-ink-faint pt-1 border-t border-surface-border">
            Global ACWR {analytics.acwr.ratio.toFixed(2)} · aguda {Math.round(analytics.acwr.acute)} / crónica {Math.round(analytics.acwr.chronic)} · baseline {analytics.acwr.baselineWeeks}s
          </p>
        )}
      </div>

      {runningCurrentWeek && runningCurrentWeek.sessionsCount > 0 && (
        <p className="text-[10px] text-ink-faint -mt-2">
          Running actual {runningCurrentWeek.totalDistanceKm != null ? `${runningCurrentWeek.totalDistanceKm}km` : `${runningCurrentWeek.totalDurationMin ?? 0}min`} · {runningCurrentWeek.sessionsCount} sesiones · carga {Math.round(runningCurrentWeek.totalLoad)}
        </p>
      )}

      {/* Header row: trend + adherence mini-history */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className={`text-sm font-bold ${trendCfg.color}`}>{trendCfg.icon}</span>
          <span className="text-xs text-ink-muted">
            Carga <span className={`font-semibold ${trendCfg.color}`}>{trendCfg.label}</span>
          </span>
        </div>
        <div className="flex gap-4">
          {analytics.weeks.slice(0, 4).map((week, i) => (
            <WeekColumn
              key={week.weekStart}
              week={week}
              label={i === 0 ? 'Esta' : i === 1 ? 'Ant.' : `-${i}`}
              isCurrentWeek={i === 0}
            />
          ))}
        </div>
      </div>

      {/* Discipline bars (current week) */}
      {allDisciplines.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">
            Esta semana — completado vs planificado
          </p>
          {allDisciplines.map(disc => (
            <BarRow key={disc.type} disc={disc} maxMinutes={maxMinutes} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-ink-faint">Sin sesiones planificadas esta semana.</p>
      )}

      {/* Running minutes trend */}
      {hasRunning && (
        <div className="pt-2 border-t border-surface-border">
          <p className="text-[10px] font-medium uppercase tracking-wider text-ink-faint mb-1.5">
            Running últimas semanas (min)
          </p>
          <div className="flex items-end gap-1.5 h-8">
            {runningWeeks.slice(0, 4).reverse().map((mins, i, arr) => {
              const maxM = Math.max(...arr, 1)
              const heightPct = Math.max((mins / maxM) * 100, mins > 0 ? 8 : 0)
              const isLast = i === arr.length - 1
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <div
                    className={`w-full rounded-t-sm ${isLast ? 'bg-emerald-500' : 'bg-emerald-500/30'}`}
                    style={{ height: `${heightPct}%` }}
                  />
                  <span className="text-[9px] text-ink-faint">{mins > 0 ? mins : '—'}</span>
                </div>
              )
            })}
          </div>
          <div className="flex gap-1.5 mt-0.5">
            {runningWeeks.slice(0, 4).reverse().map((_, i, arr) => (
              <p key={i} className="flex-1 text-center text-[9px] text-ink-faint">
                {i === arr.length - 1 ? 'hoy' : `-${arr.length - 1 - i}s`}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

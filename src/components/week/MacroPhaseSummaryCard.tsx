import { AlertTriangle, ArrowRight, CheckCircle2, Flag, Layers3 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { MacroWeekCoherenceSummary, SupportedSport } from '../../types'
import { getPhaseLabel } from '../../services/macroPlan'
import { ROUTES } from '../../constants/routes'
import Card from '../ui/Card'

const SPORT_LABELS: Record<SupportedSport, string> = {
  squash: 'Squash',
  running: 'Running',
  strength: 'Fuerza',
  mobility: 'Movilidad',
  cycling: 'Ciclismo',
}

const ROLE_LABELS = {
  primary: 'principal',
  support: 'soporte',
  excluded: 'excluido',
} as const

interface MacroPhaseSummaryCardProps {
  summary: MacroWeekCoherenceSummary
}

/**
 * Sin macroplan no hay fase, objetivo de bloque ni coherencia que mostrar: la card
 * colapsa a una invitación. Vive acá adentro —y no como guarda en la página— para
 * que ninguna superficie pueda montar por accidente la versión que inventa fase.
 */
function NoMacroPlanCard() {
  const navigate = useNavigate()

  return (
    <Card className="p-4 md:p-5">
      <button
        type="button"
        onClick={() => navigate(ROUTES.COMPETITION_PLAN)}
        className="flex w-full items-center gap-3 text-left"
      >
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-brand/15 bg-brand/10">
          <Flag size={15} className="text-brand-light" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">Sin plan de competencia</span>
          <span className="mt-0.5 block text-xs text-ink-muted">
            Define tu evento objetivo y RallyIQ arma las fases hasta ese día.
          </span>
        </span>
        <span className="flex flex-shrink-0 items-center gap-1 whitespace-nowrap text-xs font-medium text-brand-light">
          Crear plan
          <ArrowRight size={13} />
        </span>
      </button>
    </Card>
  )
}

export default function MacroPhaseSummaryCard({ summary }: MacroPhaseSummaryCardProps) {
  if (summary.coherenceStatus === 'not_applicable') return <NoMacroPlanCard />

  const sports = Array.from(new Set([
    ...(Object.keys(summary.targetDistributionBySport) as SupportedSport[]),
    ...(Object.keys(summary.actualDistributionBySport) as SupportedSport[]),
  ])).filter((sport) =>
    summary.targetDistributionBySport[sport] != null || (summary.actualDistributionBySport[sport] ?? 0) > 0,
  )

  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-ink-faint font-semibold">Macroplan y semana</p>
          <h3 className="mt-1 text-sm font-semibold text-ink md:text-base">Fase actual: {getPhaseLabel(summary.currentPhase)}</h3>
        </div>
        <div className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
          summary.coherenceStatus === 'warning'
            ? 'bg-amber-500/10 text-amber-300'
            : 'bg-emerald-500/10 text-emerald-300'
        }`}>
          {summary.coherenceStatus === 'warning' ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
          {summary.coherenceStatus === 'warning' ? 'A revisar' : 'OK'}
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-surface-border bg-surface-raised px-3 py-2.5 space-y-2">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-ink-faint font-semibold mb-0.5">Objetivo del bloque</p>
          <p className="text-xs text-ink leading-relaxed">{summary.blockGoal}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-ink-faint font-semibold mb-0.5">Esta semana</p>
          <p className="text-xs text-ink-muted leading-relaxed">{summary.weeklyRule}</p>
        </div>
      </div>

      {sports.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {sports.map((sport) => {
            const role = summary.targetDistributionBySport[sport]
            const displayRole = role ?? 'support'

            return (
              <div key={sport} className="rounded-xl bg-surface-raised/60 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold text-ink">{SPORT_LABELS[sport] ?? sport}</p>
                  <span className={`text-[10px] uppercase tracking-wide ${
                    displayRole === 'primary'
                      ? 'text-brand-light'
                      : displayRole === 'support'
                        ? 'text-amber-300'
                        : 'text-ink-faint'
                  }`}>
                    {ROLE_LABELS[displayRole]}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-ink-faint">
                  Esperado: {summary.expectedSessionsBySport[sport] ?? 'sin referencia'}
                </p>
                <p className="text-[11px] text-ink-faint">
                  Propuesto: {summary.actualDistributionBySport[sport] ?? 0} sesión(es)
                </p>
              </div>
            )
          })}
        </div>
      )}

      {summary.coherenceIssues.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-amber-300">
            <Flag size={12} />
            <p className="text-[11px] font-semibold uppercase tracking-wide">Chequeo de coherencia</p>
          </div>
          <div className="mt-2 space-y-1">
            {summary.coherenceIssues.map((issue, index) => (
              <p key={index} className="text-[11px] text-amber-100/90">{issue}</p>
            ))}
          </div>
        </div>
      )}

      {summary.coherenceIssues.length === 0 && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5 text-[11px] text-emerald-100/90">
          <Layers3 size={12} className="text-emerald-300" />
          La semana respeta la fase actual del macroplan sin contradicciones visibles.
        </div>
      )}
    </Card>
  )
}

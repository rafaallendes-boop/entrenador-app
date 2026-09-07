import { useEffect, useState } from 'react'
import {
  OperationsAccessError,
  fetchOperationsMetrics,
} from '../services/operations/fetchOperationsMetrics'
import type {
  CostCoverage,
  OperationsMetrics,
  OperationsWindow,
} from '../services/operations/operationsMetricsContract'
import {
  isClientErrorMetrics,
  rankClientErrorGroups,
  type ClientErrorMetrics,
} from '../services/observability/clientErrorMetricsContract'

function formatMs(value: number | null): string {
  return value == null ? 'sin mediciones' : `${(value / 1000).toFixed(1)} s`
}

function formatUsd(value: number): string {
  return `US$${value.toFixed(4)}`
}

function Coverage({ coverage }: { coverage: CostCoverage }) {
  return (
    <p className="text-xs text-white/50">
      Cobertura {coverage.rowsWithCost}/{coverage.rowsTotal} filas ·{' '}
      {coverage.tokensWithCost}/{coverage.tokensTotal} tokens
    </p>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <p className="text-xs text-white/60">{label}</p>
      <p className="text-lg font-semibold text-white">{value}</p>
    </div>
  )
}

function WindowPanel({ title, data }: { title: string; data: OperationsWindow }) {
  const errorRate = data.coach.requests === 0
    ? '—'
    : `${((data.coach.errors / data.coach.requests) * 100).toFixed(1)}%`
  const quotaStart = data.quota?.startDate ?? null

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-white/70">{title}</h2>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="Cuentas con uso de IA" value={String(data.activity.accountsUsingAi)} />
        <Metric label="Cuentas con planificación" value={String(data.activity.accountsPlanning)} />
        <Metric label="Requests de coach" value={String(data.coach.requests)} />
        <Metric label="Tasa de error" value={errorRate} />
        <Metric label="Declinaciones seguras" value={String(data.coach.safetyBlocked)} />
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="Coach p50" value={formatMs(data.coach.latencyP50)} />
        <Metric label="Coach p90" value={formatMs(data.coach.latencyP90)} />
        <Metric label="Coach p95" value={formatMs(data.coach.latencyP95)} />
        <Metric label="Costo IA síncrona" value={formatUsd(data.coach.costUsd)} />
      </div>
      <Coverage coverage={data.coach.coverage} />

      {data.coach.topErrorCodes.length > 0 && (
        <p className="text-xs text-white/60">
          Errores: {data.coach.topErrorCodes.map((entry) => `${entry.code} (${entry.count})`).join(' · ')}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="Corridas de plan" value={String(data.planBuilder.runs)} />
        <Metric label="Costo Plan Builder asíncrono" value={formatUsd(data.planBuilder.costUsd)} />
        <Metric label="Costo total IA" value={formatUsd(data.totalCostUsd)} />
        <Metric label="Intentos de plan" value={String(data.attempts.total)} />
      </div>
      <Coverage coverage={data.totalCostCoverage} />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Metric label="1ª semana p50" value={formatMs(data.planBuilder.firstWeekP50)} />
        <Metric label="1ª semana p90" value={formatMs(data.planBuilder.firstWeekP90)} />
        <Metric label="1ª semana p95" value={formatMs(data.planBuilder.firstWeekP95)} />
        <Metric label="Plan completo p50" value={formatMs(data.planBuilder.completeP50)} />
        <Metric label="Plan completo p90" value={formatMs(data.planBuilder.completeP90)} />
        <Metric label="Plan completo p95" value={formatMs(data.planBuilder.completeP95)} />
      </div>
      <Coverage coverage={data.planBuilder.coverage} />

      <p className="text-xs text-white/60">
        Outcomes de corridas: {' '}
        {Object.entries(data.planBuilder.byOutcome).map(([key, count]) => `${key} ${count}`).join(' · ') || 'sin corridas'}
      </p>
      <p className="text-xs text-white/60">
        Outcomes de intentos: {' '}
        {Object.entries(data.attempts.byOutcome).map(([key, count]) => `${key} ${count}`).join(' · ') || 'sin intentos'}
      </p>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric
          label={quotaStart ? `Requests con cuota desde ${quotaStart}` : 'Requests con cuota'}
          value={data.quota ? String(data.quota.requests) : 'sin datos'}
        />
        <Metric
          label={quotaStart ? `Costo registrado desde ${quotaStart}` : 'Costo registrado'}
          value={data.quota ? formatUsd(data.quota.costUsd) : 'sin datos'}
        />
      </div>
      {data.quota && Object.keys(data.quota.byBucket).length > 0 && (
        <p className="text-xs text-white/60">
          Cuotas por tipo: {' '}
          {Object.entries(data.quota.byBucket).map(([key, count]) => `${key} ${count}`).join(' · ')}
        </p>
      )}
    </section>
  )
}


const SEVERITY_STYLES: Record<string, string> = {
  alta: 'border-rose-500/30 bg-rose-500/10 text-rose-100',
  media: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
  baja: 'border-white/10 bg-white/5 text-white/70',
}

/**
 * Tarjeta de errores de cliente. Los tres estados se dicen con esas palabras:
 * «sin eventos» no es lo mismo que «sin instalar», y ninguno de los dos es
 * «no se pudo leer». Un fallo mostrado como cero sería el peor resultado
 * posible para un panel de operación.
 */
function ClientErrorsPanel({ card }: { card: ClientErrorMetrics | undefined }) {
  if (!card || !isClientErrorMetrics(card)) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/70">Errores de cliente</h2>
        <p className="text-xs text-white/50">El servidor no informó la tarjeta de errores.</p>
      </section>
    )
  }

  if (card.status === 'not_installed') {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/70">Errores de cliente</h2>
        <p className="text-xs text-white/50">Sin instalar: faltan las migraciones 035 y 036 en producción.</p>
      </section>
    )
  }

  if (card.status === 'unavailable' || !card.windows) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/70">Errores de cliente</h2>
        <p className="text-xs text-amber-200/80">No se pudo leer. Esto no significa cero eventos.</p>
      </section>
    )
  }

  const week = card.windows.week
  // El orden por severidad se resuelve **antes** de recortar el top, para que
  // un error grave de poco volumen no quede fuera por uno leve y ruidoso.
  const top = rankClientErrorGroups(week.groups, 10)
  const retention = card.retention

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-white/70">Errores de cliente</h2>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="Eventos 24 h" value={String(card.windows.day.total)} />
        <Metric label="Eventos 7 d" value={String(week.total)} />
        <Metric label="Firmas 7 d" value={String(week.groups.length)} />
        <Metric
          label="unknown 7 d"
          value={`${week.unknown.total} (${Math.round(week.unknown.share * 100)}%)`}
        />
      </div>

      {week.total === 0 ? (
        <p className="text-xs text-white/50">Sin eventos en la ventana.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {top.map(group => (
            <div
              key={`${group.fingerprint}-${group.release}`}
              className={`rounded-xl border px-3 py-2 text-xs ${SEVERITY_STYLES[group.severity] ?? SEVERITY_STYLES['baja']}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">
                  {group.severity} · {group.diagnosticCode} · {group.errorName}
                </span>
                <span className="opacity-80">
                  {group.count}× · {group.accounts} {group.accounts === 1 ? 'cuenta' : 'cuentas'}
                </span>
              </div>
              <p className="mt-0.5 opacity-70">
                {group.route}
                {group.component ? ` · ${group.component}` : ''} · release {group.release}
              </p>
              <p className="opacity-50">
                {new Date(group.firstSeen).toLocaleString('es-CL')} → {new Date(group.lastSeen).toLocaleString('es-CL')}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Triage de `unknown`: se lee agregado, nunca caso por caso. Es el
          instrumento con el que se mejora el clasificador. */}
      {week.unknown.breakdown.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-white/50">Triage de unknown</h3>
          {week.unknown.breakdown.slice(0, 8).map(entry => (
            <p
              key={`${entry.source}-${entry.errorName}-${entry.route}-${entry.release}`}
              className="text-xs text-white/60"
            >
              {entry.count}× · {entry.source} · {entry.errorName} · {entry.route} · {entry.release}
            </p>
          ))}
        </div>
      )}

      {retention && (
        <p className="text-xs text-white/50">
          Retención:{' '}
          {retention.status === 'unavailable'
            ? 'no se pudo verificar'
            : retention.status === 'behind'
              ? `atrasada — ${retention.expiredRemaining ?? 0} filas vencidas sin borrar`
              : 'al día'}
          {retention.oldestExpiredAt
            ? ` · más antigua ${new Date(retention.oldestExpiredAt).toLocaleDateString('es-CL')}`
            : ''}
        </p>
      )}
    </section>
  )
}

export default function OperationsPage() {
  const [metrics, setMetrics] = useState<OperationsMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchOperationsMetrics()
      .then((result) => { if (!cancelled) setMetrics(result) })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(cause instanceof OperationsAccessError
          ? cause.message
          : 'No se pudo leer la telemetría.')
      })
    return () => { cancelled = true }
  }, [attempt])

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center text-sm text-white/70">
        <p>{error}</p>
        <button
          type="button"
          onClick={() => {
            setError(null)
            setAttempt((value) => value + 1)
          }}
          className="mt-4 rounded-full border border-brand/30 bg-brand/15 px-4 py-2 text-sm font-semibold text-brand-light transition-colors hover:bg-brand/25"
        >
          Reintentar
        </button>
      </div>
    )
  }

  if (!metrics) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center text-sm text-white/60">
        Cargando telemetría…
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold text-white">Operación</h1>
        <p className="text-xs text-white/50">
          Generado {new Date(metrics.generatedAt).toLocaleString('es-CL')}
        </p>
      </header>
      <WindowPanel title="Últimas 24 horas" data={metrics.last24h} />
      <WindowPanel title="Últimos 7 días" data={metrics.last7d} />
      <ClientErrorsPanel card={metrics.clientErrors} />
    </div>
  )
}

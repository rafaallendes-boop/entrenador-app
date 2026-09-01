import { Link } from 'react-router-dom'
import type { Tier } from '../../services/entitlements/entitlementPolicy'

/** Nombres comerciales: los identificadores internos no forman parte del copy. */
const TIER_LABEL: Record<Tier, string> = {
  free: 'Base',
  weekly: 'Coach Semanal',
  advanced: 'Avanzado',
}

const FEATURE_LABEL: Record<string, string> = {
  plan_builder_week: 'Plan Builder',
  plan_builder_pair: 'Plan Builder',
  week_creator: 'Crear una semana completa de entrenamiento',
  weekly_summary: 'Los resúmenes semanales',
}

export function UpsellCard({
  requestClass,
  requiredTier,
}: {
  requestClass: string
  requiredTier: Tier
}) {
  const feature = FEATURE_LABEL[requestClass] ?? 'Esta función'

  return (
    <section
      aria-label="Opción de plan"
      className="hud-border rounded-2xl border border-brand/20 bg-[linear-gradient(145deg,rgba(255,77,0,0.10),rgba(14,14,14,0.96))] p-4 [--hud-accent-end:rgba(255,77,0,0.10)] [--hud-accent-start:rgba(255,122,51,0.28)]"
    >
      <p className="font-display text-sm font-bold text-ink">
        {feature} está en el plan {TIER_LABEL[requiredTier]}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-ink-muted">
        {requestClass === 'week_creator'
          ? 'Si quieres generar una semana completa de entrenamiento, está disponible para usuarios del plan Avanzado.'
          : 'Puedes seguir usando el coach y registrando tus entrenamientos. Cuando quieras que arme y ajuste tu planificación, sube de plan.'}
      </p>
      <Link
        to="/pricing"
        className="mt-3 inline-flex items-center rounded-xl bg-brand px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-light"
      >
        Ver planes
      </Link>
    </section>
  )
}

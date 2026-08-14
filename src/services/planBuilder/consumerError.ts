import { decodePlanBuilderDailyQuotaError } from './dailyQuotaError'

const GENERIC_DAILY_QUOTA_NOTICE =
  'No tienes cuota diaria suficiente para crear este plan. Vuelve mañana o reduce la cantidad de semanas.'

/**
 * Maps the locally generated daily-quota error to copy safe for production.
 * Unknown errors deliberately return null so raw provider/database details never
 * cross the developer-tools boundary.
 */
export function getPlanBuilderDailyQuotaNotice(lastError: unknown): string | null {
  const decoded = decodePlanBuilderDailyQuotaError(lastError)
  if (decoded.kind === 'unrelated') return null
  if (decoded.kind === 'malformed') return GENERIC_DAILY_QUOTA_NOTICE

  const { requested, remaining, limit } = decoded.details
  const weekLabel = requested === 1 ? 'semana' : 'semanas'
  return `No tienes cuota diaria suficiente para crear este plan: necesita ${requested} ${weekLabel} y hoy te quedan ${remaining} de ${limit}. Vuelve mañana o reduce la cantidad de semanas.`
}

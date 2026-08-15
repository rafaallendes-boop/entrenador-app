import { AIProviderError } from '../ai/types'

export interface PlanBuilderDailyQuotaDetails {
  requested: number
  remaining: number
  limit: number
}

export const PLAN_BUILDER_DAILY_QUOTA_MESSAGE_PREFIX =
  'Alcanzaste el límite diario para crear planes'

const escapedMessagePrefix = PLAN_BUILDER_DAILY_QUOTA_MESSAGE_PREFIX
  .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const MESSAGE_PATTERN = new RegExp(
  `^${escapedMessagePrefix}: necesitas (\\d+) semana\\(s\\) y quedan (\\d+)\\/(\\d+)\\. Vuelve mañana o reduce las semanas a ajustar\\.$`,
)

export type PlanBuilderDailyQuotaDecodeResult =
  | { kind: 'quota'; details: PlanBuilderDailyQuotaDetails }
  | { kind: 'malformed' }
  | { kind: 'unrelated' }

function hasValidDetails(details: PlanBuilderDailyQuotaDetails): boolean {
  return Number.isSafeInteger(details.requested)
    && details.requested >= 1
    && Number.isSafeInteger(details.remaining)
    && details.remaining >= 0
    && Number.isSafeInteger(details.limit)
    && details.limit >= 1
    && details.remaining <= details.limit
}

export function formatPlanBuilderDailyQuotaErrorMessage(
  details: PlanBuilderDailyQuotaDetails,
): string {
  return `${PLAN_BUILDER_DAILY_QUOTA_MESSAGE_PREFIX}: necesitas ${details.requested} semana(s) y quedan ${details.remaining}/${details.limit}. Vuelve mañana o reduce las semanas a ajustar.`
}

export class PlanBuilderDailyQuotaError extends AIProviderError {
  readonly details: PlanBuilderDailyQuotaDetails

  constructor(details: PlanBuilderDailyQuotaDetails) {
    super('gemini', 'rate_limit', formatPlanBuilderDailyQuotaErrorMessage(details), false)
    this.name = 'PlanBuilderDailyQuotaError'
    this.details = details
  }
}

export function decodePlanBuilderDailyQuotaError(
  value: unknown,
): PlanBuilderDailyQuotaDecodeResult {
  if (value instanceof PlanBuilderDailyQuotaError && hasValidDetails(value.details)) {
    return { kind: 'quota', details: value.details }
  }

  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : null
  const normalized = message?.trim()
  if (!normalized?.startsWith(PLAN_BUILDER_DAILY_QUOTA_MESSAGE_PREFIX)) {
    return { kind: 'unrelated' }
  }

  const match = MESSAGE_PATTERN.exec(normalized)
  if (!match) return { kind: 'malformed' }

  const details = {
    requested: Number(match[1]),
    remaining: Number(match[2]),
    limit: Number(match[3]),
  }
  return hasValidDetails(details)
    ? { kind: 'quota', details }
    : { kind: 'malformed' }
}

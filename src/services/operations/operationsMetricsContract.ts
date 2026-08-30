/**
 * Forma del JSON que devuelve el RPC `read_operations_metrics`.
 *
 * Una sola declaracion compartida por la funcion Netlify y el cliente: si el
 * RPC cambia y esto no, el type guard falla en tests antes de llegar a la UI.
 * Vive en `src/` para que el cliente la importe sin arrastrar codigo de
 * Functions al bundle, igual que `WHOOP_WORKOUT_ZONE_COLUMNS`.
 */
export const OPERATIONS_METRIC_KEYS = [
  'activity', 'coach', 'planBuilder', 'attempts', 'quota', 'totalCostUsd', 'totalCostCoverage',
] as const

export type OperationsMetricKey = typeof OPERATIONS_METRIC_KEYS[number]

/**
 * `estimated_cost_usd = null` no es cero. Sin estas cuatro cifras un total de
 * costo no se puede interpretar: las requests caras suelen ser pocas, asi que
 * la cobertura en filas puede ser alta y la de tokens baja al mismo tiempo.
 */
export interface CostCoverage {
  rowsTotal: number
  rowsWithCost: number
  tokensTotal: number
  tokensWithCost: number
}

export interface ActivityBlock {
  /** Cuentas distintas con al menos una request de IA. NO es "usuarios activos". */
  accountsUsingAi: number
  /** Cuentas distintas con al menos una corrida de Plan Builder. */
  accountsPlanning: number
}

export interface ErrorCodeCount {
  code: string
  count: number
}

export interface CoachBlock {
  requests: number
  errors: number
  /** Safe terminal declines; intentionally excluded from `errors`. */
  safetyBlocked: number
  topErrorCodes: ErrorCodeCount[]
  latencyP50: number | null
  latencyP90: number | null
  latencyP95: number | null
  costUsd: number
  coverage: CostCoverage
}

export interface PlanBuilderBlock {
  runs: number
  byOutcome: Record<string, number>
  firstWeekP50: number | null
  firstWeekP90: number | null
  firstWeekP95: number | null
  completeP50: number | null
  completeP90: number | null
  completeP95: number | null
  costUsd: number
  coverage: CostCoverage
}

export interface AttemptsBlock {
  total: number
  byOutcome: Record<string, number>
}

export interface QuotaBlock {
  /** Límite inferior inclusivo, en días calendario; no es una ventana móvil. */
  startDate: string
  requests: number
  costUsd: number
  byBucket: Record<string, number>
}

export interface OperationsWindow {
  activity: ActivityBlock
  coach: CoachBlock
  planBuilder: PlanBuilderBlock
  attempts: AttemptsBlock
  /**
   * `null` SOLO cuando `ai_usage_daily` no existe. En producción no debería
   * ocurrir: `021` está aplicada. Sin uso registrado el bloque llega con ceros,
   * que es distinto y la UI los distingue.
   */
  quota: QuotaBlock | null
  /** Suma de la telemetría síncrona y del Plan Builder asíncrono. */
  totalCostUsd: number
  /** Cobertura de la suma anterior; no se infiere de un porcentaje. */
  totalCostCoverage: CostCoverage
}

export interface OperationsMetrics {
  last24h: OperationsWindow
  last7d: OperationsWindow
  generatedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableNumber(value: unknown): boolean {
  return value === null || isFiniteNumber(value)
}

function isNumberMap(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(isFiniteNumber)
}

function isCoverage(value: unknown): value is CostCoverage {
  return isRecord(value)
    && isFiniteNumber(value['rowsTotal'])
    && isFiniteNumber(value['rowsWithCost'])
    && isFiniteNumber(value['tokensTotal'])
    && isFiniteNumber(value['tokensWithCost'])
}

export function isOperationsWindow(value: unknown): value is OperationsWindow {
  if (!isRecord(value)) return false

  const activity = value['activity']
  if (!isRecord(activity)
    || !isFiniteNumber(activity['accountsUsingAi'])
    || !isFiniteNumber(activity['accountsPlanning'])) return false

  const coach = value['coach']
  if (!isRecord(coach)
    || !isFiniteNumber(coach['requests'])
    || !isFiniteNumber(coach['errors'])
    || !isFiniteNumber(coach['safetyBlocked'])
    || !Array.isArray(coach['topErrorCodes'])
    || !coach['topErrorCodes'].every((entry) => isRecord(entry)
      && typeof entry['code'] === 'string'
      && isFiniteNumber(entry['count']))
    || !isNullableNumber(coach['latencyP50'])
    || !isNullableNumber(coach['latencyP90'])
    || !isNullableNumber(coach['latencyP95'])
    || !isFiniteNumber(coach['costUsd'])
    || !isCoverage(coach['coverage'])) return false

  const plan = value['planBuilder']
  if (!isRecord(plan)
    || !isFiniteNumber(plan['runs'])
    || !isNumberMap(plan['byOutcome'])
    || !isNullableNumber(plan['firstWeekP50'])
    || !isNullableNumber(plan['firstWeekP90'])
    || !isNullableNumber(plan['firstWeekP95'])
    || !isNullableNumber(plan['completeP50'])
    || !isNullableNumber(plan['completeP90'])
    || !isNullableNumber(plan['completeP95'])
    || !isFiniteNumber(plan['costUsd'])
    || !isCoverage(plan['coverage'])) return false

  const attempts = value['attempts']
  if (!isRecord(attempts)
    || !isFiniteNumber(attempts['total'])
    || !isNumberMap(attempts['byOutcome'])) return false

  const quota = value['quota']
  if (quota !== null) {
    if (!isRecord(quota)
      || typeof quota['startDate'] !== 'string'
      || quota['startDate'].length === 0
      || !isFiniteNumber(quota['requests'])
      || !isFiniteNumber(quota['costUsd'])
      || !isNumberMap(quota['byBucket'])) return false
  }

  if (!isFiniteNumber(value['totalCostUsd'])) return false
  if (!isCoverage(value['totalCostCoverage'])) return false

  return true
}

/** Valida el sobre completo antes de que cualquier consumidor lo renderice. */
export function isOperationsMetrics(value: unknown): value is OperationsMetrics {
  return isRecord(value)
    && isOperationsWindow(value['last24h'])
    && isOperationsWindow(value['last7d'])
    && typeof value['generatedAt'] === 'string'
    && Number.isFinite(Date.parse(value['generatedAt']))
}

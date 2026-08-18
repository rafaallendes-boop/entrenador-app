import type { AIRequestClass } from '../../../src/types'
import type { Tier } from '../../../src/services/entitlements/entitlementPolicy'
import { bucketForClass, bucketLimitForTier } from '../../../src/services/entitlements/quotaBuckets'
import { evaluateSpendCaps, type SpendSnapshot } from '../../../src/services/entitlements/spendCapPolicy'

const RPC_TIMEOUT_MS = 3_000

export function isKillSwitchActive(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['AI_KILL_SWITCH_ENABLED'] === 'true'
}

export function isUsageLimitsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['AI_USAGE_LIMITS_ENABLED'] === 'true'
}

export interface UsageGateHttpError extends Error {
  statusCode: number
  errorCode: 'quota_exceeded' | 'spend_cap_exceeded' | 'kill_switch_active' | 'server_error'
  detail?: unknown
}

function makeGateError(
  message: string,
  statusCode: number,
  errorCode: UsageGateHttpError['errorCode'],
  detail?: unknown,
): UsageGateHttpError {
  const error = new Error(message) as UsageGateHttpError
  error.statusCode = statusCode
  error.errorCode = errorCode
  if (detail !== undefined) error.detail = detail
  return error
}

// Exportados a propósito: coach.ts, enqueue-plan-generation.ts y
// generate-plan-background.ts reusan estos mismos factories para su chequeo
// de kill switch de nivel superior (antes de resolver bucket/tier), en vez de
// inventar un `makeError` local por archivo.
export function makeKillSwitchError(): UsageGateHttpError {
  return makeGateError('La IA está temporalmente pausada.', 503, 'kill_switch_active')
}

export function makeSpendCapError(scope: 'account' | 'global', capUsd: number): UsageGateHttpError {
  return makeGateError(
    'El servicio alcanzó su presupuesto diario.',
    429,
    'spend_cap_exceeded',
    { scope, capUsd },
  )
}

export function makeQuotaExceededError(bucketId: string, limit: number, remaining = 0): UsageGateHttpError {
  return makeGateError(
    'Alcanzaste el cupo diario de esta función.',
    429,
    'quota_exceeded',
    { bucketId, limit, remaining },
  )
}

export function makeServerError(message: string): UsageGateHttpError {
  return makeGateError(message, 503, 'server_error')
}

function serviceRoleCredentials(): { url: string; key: string } | null {
  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) return null
  return { url: url.replace(/\/$/, ''), key }
}

/**
 * Corrección tras revisión (P1, ronda 2): la versión anterior solo convertía
 * respuestas HTTP no-2xx en `UsageGateHttpError` — un error de RED (fetch
 * rechaza), un abort por `AbortSignal.timeout`, o un `.json()` sobre un
 * cuerpo no-JSON escapaban como `Error`/`DOMException`/`SyntaxError` crudos,
 * sin `.statusCode`/`.errorCode`. Consumido desde el worker
 * (`generate-plan-background.ts`), un error crudo así NO es reconocido por
 * `isUsageGateRejection` del loop (no es `instanceof` ninguna de las 3
 * clases) y cae al catch genérico de `generateWeekCoreWithRetry`, que lo
 * trata como si el PROVEEDOR hubiera fallado — dispara retry/fallback para
 * un fallo que ocurrió en nuestra propia infraestructura, antes siquiera de
 * intentar la llamada real. Ahora TODO camino de salida de `callRpc` es
 * `UsageGateHttpError`, nunca un error crudo.
 */
async function callRpc<T>(functionName: string, args: Record<string, unknown>, timeoutMs = RPC_TIMEOUT_MS): Promise<T> {
  const creds = serviceRoleCredentials()
  if (!creds) throw makeServerError('Configuración de Supabase ausente en el servidor.')

  let response: Response
  try {
    response = await fetch(`${creds.url}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.key}`,
        apikey: creds.key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw makeServerError(`RPC ${functionName} no se pudo completar: ${error instanceof Error ? error.message : 'error de red'}.`)
  }
  if (!response.ok) {
    throw makeServerError(`RPC ${functionName} devolvió ${response.status}.`)
  }
  try {
    return await response.json() as T
  } catch {
    throw makeServerError(`RPC ${functionName} devolvió un cuerpo no JSON.`)
  }
}

/**
 * Corrección tras revisión (P1, fail-open): la primera versión de este plan
 * parseaba la respuesta con `.catch(() => valorPorDefecto)` en varios puntos
 * — un JSON malformado, un cuerpo vacío, o campos no numéricos terminaban
 * silenciosamente como "gasto/cuota cero", que es fail-OPEN (deja pasar la
 * request cuando en realidad no se pudo confirmar nada). Cualquier anomalía
 * de forma ahora lanza `server_error` (503) — fail-CLOSED — en vez de
 * inventar un valor seguro.
 */
function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

async function readSpend(userId: string): Promise<SpendSnapshot> {
  const rows = await callRpc<unknown>('read_ai_usage_spend', { p_user_id: userId })
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw makeServerError('read_ai_usage_spend devolvió una forma inesperada.')
  }
  const row = rows[0] as { account_cost_usd?: unknown; global_cost_usd?: unknown }
  if (!isFiniteNonNegative(row.account_cost_usd) || !isFiniteNonNegative(row.global_cost_usd)) {
    throw makeServerError('read_ai_usage_spend devolvió valores no numéricos.')
  }
  return { accountCostUsd: row.account_cost_usd, globalCostUsd: row.global_cost_usd }
}

function resolveBucket(requestClass: AIRequestClass, tier: Tier): { bucketId: string; limit: number } | null {
  const bucket = bucketForClass(requestClass)
  if (!bucket) return null
  const limit = bucketLimitForTier(bucket, tier)
  if (limit == null) return null
  return { bucketId: bucket.id, limit }
}

export interface UsageGateInput {
  userId: string
  requestClass: AIRequestClass
  tier: Tier
}

export interface UsageGateReservation {
  bucketId: string
  limit: number
  usageDate: string
}

type GatePreamble =
  | { skip: true }
  | { skip: false; bucketId: string; limit: number }

/**
 * Preámbulo compartido por `assertUsageGate` y `checkUsagePreflight`: kill
 * switch → flag de limits → resolución de bucket/tier → gasto → spend caps.
 * Extraído a propósito (hallazgo de review) para que un cambio futuro a
 * cualquiera de estas cinco precondiciones no pueda aplicarse por accidente
 * a un solo entry point y no al otro — exactamente el tipo de bug que ya
 * produjo dos hallazgos fail-open en rondas previas de este mismo plan.
 * `{ skip: true }` cubre los dos casos "no gatea": limits apagado, o la
 * clase no tiene bucket/límite para el tier (eso lo resuelve el gate de
 * entitlement, no este módulo).
 */
async function evaluateGatePreamble(input: UsageGateInput): Promise<GatePreamble> {
  if (isKillSwitchActive()) throw makeKillSwitchError()
  if (!isUsageLimitsEnabled()) return { skip: true }

  const resolved = resolveBucket(input.requestClass, input.tier)
  if (!resolved) return { skip: true }

  const spend = await readSpend(input.userId)
  const capCheck = evaluateSpendCaps(spend)
  if (capCheck.exceeded) throw makeSpendCapError(capCheck.scope, capCheck.capUsd)

  return { skip: false, bucketId: resolved.bucketId, limit: resolved.limit }
}

/**
 * Gate autoritativo: chequea y CONSUME cuota. Debe llamarse inmediatamente
 * antes de la llamada real al proveedor, nunca antes. `null` significa "esta
 * llamada no está sujeta a gating" (limits apagado, o la clase no tiene
 * bucket/límite para el tier — eso lo resuelve el gate de entitlement, no
 * este).
 */
export async function assertUsageGate(input: UsageGateInput): Promise<UsageGateReservation | null> {
  const preamble = await evaluateGatePreamble(input)
  if (preamble.skip) return null

  const rows = await callRpc<unknown>('increment_ai_usage_if_under_limit', {
    p_user_id: input.userId,
    p_bucket_id: preamble.bucketId,
    p_limit: preamble.limit,
  })
  if (!Array.isArray(rows)) throw makeServerError('increment_ai_usage_if_under_limit devolvió una forma inesperada.')
  if (rows.length === 0) throw makeQuotaExceededError(preamble.bucketId, preamble.limit, 0)
  // Cardinalidad estricta (P2, ronda 2): la PK de ai_usage_daily garantiza
  // que un UPSERT nunca produce más de una fila — más de una fila acá es
  // señal de que algo está mal configurado (RPC equivocada, tabla sin PK
  // real), no un caso a tolerar en silencio.
  if (rows.length !== 1) throw makeServerError('increment_ai_usage_if_under_limit devolvió más de una fila.')
  const row = rows[0] as { usage_date?: unknown; request_count?: unknown }
  if (typeof row.usage_date !== 'string' || row.usage_date.length === 0) {
    throw makeServerError('increment_ai_usage_if_under_limit devolvió usage_date inválido.')
  }
  if (!isFiniteNonNegative(row.request_count)) {
    throw makeServerError('increment_ai_usage_if_under_limit devolvió request_count no numérico.')
  }

  return { bucketId: preamble.bucketId, limit: preamble.limit, usageDate: row.usage_date }
}

/**
 * Preflight de solo lectura para `enqueue-plan-generation.ts`. No incrementa
 * nada — solo evita crear un job que el worker va a rechazar igual. La
 * autoridad real es `assertUsageGate`, invocado por el worker en cada
 * intento real.
 */
export async function checkUsagePreflight(input: UsageGateInput): Promise<void> {
  const preamble = await evaluateGatePreamble(input)
  if (preamble.skip) return

  const creds = serviceRoleCredentials()
  if (!creds) throw makeServerError('Configuración de Supabase ausente en el servidor.')
  const today = new Date().toISOString().slice(0, 10)
  const query = new URLSearchParams({
    user_id: `eq.${input.userId}`,
    usage_date: `eq.${today}`,
    bucket_id: `eq.${preamble.bucketId}`,
    select: 'request_count',
  })
  let response: Response
  try {
    response = await fetch(`${creds.url}/rest/v1/ai_usage_daily?${query.toString()}`, {
      headers: { Authorization: `Bearer ${creds.key}`, apikey: creds.key },
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    })
  } catch (error) {
    // Mismo fix que callRpc (P1, ronda 2): esta lectura no pasa por callRpc
    // (es un GET directo a PostgREST, no una RPC), así que necesita el mismo
    // try/catch de red por separado.
    throw makeServerError(`Lectura de cuota no se pudo completar: ${error instanceof Error ? error.message : 'error de red'}.`)
  }
  if (!response.ok) throw makeServerError(`Lectura de cuota devolvió ${response.status}.`)
  let rows: unknown
  try {
    rows = await response.json()
  } catch {
    throw makeServerError('Lectura de cuota devolvió un cuerpo no JSON.')
  }
  if (!Array.isArray(rows)) throw makeServerError('Lectura de cuota devolvió una forma inesperada.')
  // Cero filas es un estado válido (todavía no hay actividad hoy en este
  // bucket) — a diferencia de readSpend/increment, acá SÍ corresponde 0.
  const row = rows[0] as { request_count?: unknown } | undefined
  const current = row ? row.request_count : 0
  if (!isFiniteNonNegative(current)) {
    throw makeServerError('Lectura de cuota devolvió request_count no numérico.')
  }
  if (current >= preamble.limit) {
    throw makeQuotaExceededError(preamble.bucketId, preamble.limit, 0)
  }
}

export interface RecordUsageCostInput {
  userId: string
  bucketId: string
  usageDate: string
  costUsd: number
  /**
   * Techo del RPC de costo, en ms. Opcional — sin él usa `RPC_TIMEOUT_MS`
   * (comportamiento previo, para callers como `generate-plan-background.ts`
   * cuyo presupuesto de worker de 13 min no está en riesgo). `coach.ts` sí lo
   * pasa: ese camino corre bajo el wall-clock síncrono de Netlify (~26s) y
   * un `RPC_TIMEOUT_MS` fijo de 3s, sumado DESPUÉS de que el proveedor ya
   * respondió, puede empujar la respuesta más allá del corte real (hallazgo
   * de revisión externa). Un valor `<= 0` salta el RPC directamente: no tiene
   * sentido intentar un fetch con presupuesto negativo.
   */
  timeoutMs?: number
}

/**
 * Suma el costo real de un intento que ya pasó por el proveedor, sobre la
 * fila que `assertUsageGate` acaba de reservar, vía la RPC atómica
 * `increment_ai_usage_cost` (no un PATCH que sobreescribe — la primera
 * versión de este plan tenía ese bug: todas las requests del mismo bucket en
 * el día comparten fila, así que un `set` en vez de un `+=` pierde todo costo
 * previo). Best-effort: una falla acá ocurre DESPUÉS del gasto y no puede
 * deshacerse — nunca convierte una respuesta correcta del modelo en error
 * para el usuario. El caller debe esperar esta promesa (no fire-and-forget):
 * en un entorno serverless, una llamada `void` puede quedar cortada si la
 * función retorna antes de que el `fetch` termine.
 */
export async function recordUsageCost(input: RecordUsageCostInput): Promise<void> {
  if (input.costUsd <= 0) return
  if (input.timeoutMs !== undefined && input.timeoutMs <= 0) {
    console.warn(`[usage-gate] recordUsageCost omitido: sin presupuesto de wallclock restante (user=${input.userId} bucket=${input.bucketId} date=${input.usageDate})`)
    return
  }
  try {
    const rows = await callRpc<unknown>('increment_ai_usage_cost', {
      p_user_id: input.userId,
      p_bucket_id: input.bucketId,
      p_usage_date: input.usageDate,
      p_delta: input.costUsd,
    }, input.timeoutMs)
    // Corrección tras revisión (P2, ronda 2): la versión anterior ignoraba
    // el resultado por completo — un UPDATE que afecta 0 filas (la fila que
    // `assertUsageGate` debió reservar no existe: bug de otra parte, drift
    // de usageDate/bucketId) parecía éxito. Sigue siendo best-effort (no
    // lanza), pero ahora al menos queda logueado si el costo NO se guardó.
    //
    // Corrección tras revisión (P2, ronda 3): validar cardinalidad (1 fila)
    // no alcanza — la fila puede volver con `estimated_cost_usd` ausente,
    // negativo o no numérico (RPC devuelve algo inesperado sin fallar el
    // HTTP) y eso también contaba como éxito silencioso. Se valida el campo.
    const row = Array.isArray(rows) && rows.length === 1
      ? (rows[0] as { estimated_cost_usd?: unknown })
      : null
    if (!row || !isFiniteNonNegative(row.estimated_cost_usd)) {
      console.warn(`[usage-gate] recordUsageCost no confirmó un valor válido: user=${input.userId} bucket=${input.bucketId} date=${input.usageDate}`)
    }
  } catch (error) {
    console.warn(`[usage-gate] recordUsageCost failed: ${error instanceof Error ? error.message : 'unknown'}`)
  }
}

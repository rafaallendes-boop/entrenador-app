import type { CapabilityDecision } from '../../../src/services/entitlements/resolveCapability'
import { bucketForClass } from '../../../src/services/entitlements/quotaBuckets'
import { evaluateSpendCaps, type SpendSnapshot } from '../../../src/services/entitlements/spendCapPolicy'

const RPC_TIMEOUT_MS = 3_000
const UPSTREAM_BODY_MAX_CHARS = 2_000

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
  diagnostics?: { upstreamStatus?: number; upstreamBody?: string }
}

function makeGateError(
  message: string,
  statusCode: number,
  errorCode: UsageGateHttpError['errorCode'],
  detail?: unknown,
  diagnostics?: UsageGateHttpError['diagnostics'],
): UsageGateHttpError {
  const error = new Error(message) as UsageGateHttpError
  error.statusCode = statusCode
  error.errorCode = errorCode
  if (detail !== undefined) error.detail = detail
  if (diagnostics !== undefined) error.diagnostics = diagnostics
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

export function makeQuotaExceededError(
  bucketId: string,
  limit: number,
  remaining = 0,
  scope: 'account' | 'subject' = 'account',
): UsageGateHttpError {
  return makeGateError(
    scope === 'subject'
      ? 'Alcanzaste el cupo diario de esta función para este atleta.'
      : 'Alcanzaste el cupo diario de esta función.',
    429,
    'quota_exceeded',
    { bucketId, limit, remaining, scope },
  )
}

export function makeServerError(
  message: string,
  diagnostics?: UsageGateHttpError['diagnostics'],
): UsageGateHttpError {
  return makeGateError(message, 503, 'server_error', undefined, diagnostics)
}

function serviceRoleCredentials(): { url: string; key: string } | null {
  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) return null
  return { url: url.replace(/\/$/, ''), key }
}

const QUOTA_SQLSTATE = '45001'

/** Códigos con que PostgREST reporta una columna que el esquema todavía no tiene. */
const UNDEFINED_COLUMN_CODES = new Set(['42703', 'PGRST204'])
/** Ídem para una función ausente (RPC de una migración no aplicada). */
const UNDEFINED_FUNCTION_CODES = new Set(['42883', 'PGRST202'])

function errorCodeOf(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { code?: unknown }
    return typeof parsed.code === 'string' ? parsed.code : null
  } catch {
    return null
  }
}

function isUndefinedColumn(body: string): boolean {
  const code = errorCodeOf(body)
  return code != null && UNDEFINED_COLUMN_CODES.has(code)
}

/**
 * Señal interna: la RPC no existe en el esquema remoto. NUNCA escapa de este
 * módulo — el llamador o cae al contrato anterior o la convierte en 503.
 */
class MissingRpcError extends Error {
  readonly functionName: string

  constructor(functionName: string) {
    super(`RPC ${functionName} no existe en el esquema remoto.`)
    this.name = 'MissingRpcError'
    this.functionName = functionName
  }
}

function isUndefinedFunction(body: string): boolean {
  const code = errorCodeOf(body)
  return code != null && UNDEFINED_FUNCTION_CODES.has(code)
}

/** `null` = no es un rechazo de cuota reconocido; el llamador lo trata como 503. */
function parseQuotaRejection(body: string): 'account' | 'subject' | null {
  try {
    const parsed = JSON.parse(body) as { code?: unknown; details?: unknown }
    if (parsed.code !== QUOTA_SQLSTATE) return null
    return parsed.details === 'account' || parsed.details === 'subject' ? parsed.details : null
  } catch {
    return null
  }
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
    // PostgREST entrega code/message/details/hint en este body. Se conserva
    // truncado para diagnóstico de servidor, pero no se incorpora al mensaje
    // que los handlers serializan hacia el cliente.
    const rawBody = (await response.text().catch(() => '')).slice(0, UPSTREAM_BODY_MAX_CHARS)
    const scope = parseQuotaRejection(rawBody)
    if (scope) {
      const limit = Number(scope === 'subject' ? args['p_subject_limit'] : args['p_limit']) || 0
      throw makeQuotaExceededError(String(args['p_bucket_id'] ?? ''), limit, 0, scope)
    }
    if (isUndefinedFunction(rawBody)) throw new MissingRpcError(functionName)
    const diagnostics = { upstreamStatus: response.status, upstreamBody: rawBody }
    console.error('[usage-gate] RPC failed', { functionName, diagnostics })
    throw makeServerError(`RPC ${functionName} devolvió ${response.status}.`, diagnostics)
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

export interface UsageGateInput {
  /**
   * Decisión ya resuelta por el borde de autorización. El gate no vuelve a
   * derivar clase, bucket, dueño ni tier: hacerlo introduciría una segunda
   * fuente de verdad e impediría delegar cuota en el producto Coach.
   */
  decision: CapabilityDecision
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
 * switch → flag de limits → decisión permitida y válida → gasto → spend caps.
 * Extraído a propósito (hallazgo de review) para que un cambio futuro a
 * cualquiera de estas cinco precondiciones no pueda aplicarse por accidente
 * a un solo entry point y no al otro — exactamente el tipo de bug que ya
 * produjo dos hallazgos fail-open en rondas previas de este mismo plan.
 * `{ skip: true }` cubre los dos casos "no gatea": limits apagado, o una
 * capacidad no permitida (eso lo resuelve el gate de entitlement, no este
 * módulo). Con limits apagado no se valida la decisión: el flag deshabilita
 * por completo este gate, excepto el kill switch que siempre prevalece.
 */
async function evaluateGatePreamble(input: UsageGateInput): Promise<GatePreamble> {
  if (isKillSwitchActive()) throw makeKillSwitchError()
  const { decision } = input
  if (!isUsageLimitsEnabled()) return { skip: true }

  // La denegación pertenece al gate de entitlement, que corre antes. Mantener
  // este no-op conserva el contrato de `assertUsageGate` para callers que
  // llegan con una capacidad no permitida, sin inventar bucket ni límite.
  if (!decision.allowed) return { skip: true }

  // La cuota actual representa exactamente un intento de proveedor. Cuando
  // cambie la ponderación por producto, este gate no puede fingir que una
  // unidad distinta equivale a uno: debe cambiar junto con la RPC atómica.
  if (decision.consumptionUnits !== 1) {
    throw makeServerError('La decisión de cuota tiene unidades no soportadas.')
  }

  // El gate no re-resuelve la decisión (eso permitiría divergir de futuros
  // dueños/tier delegados), pero sí verifica su vínculo estructural con la
  // capacidad que la originó. Así una decisión reutilizada para otra clase no
  // puede cobrar en silencio el bucket equivocado.
  const expectedBucketId = bucketForClass(decision.capability)?.id
  if (
    typeof decision.quotaOwnerUserId !== 'string' || decision.quotaOwnerUserId.length === 0
    || typeof decision.quotaBucketId !== 'string' || decision.quotaBucketId.length === 0
    || typeof decision.limit !== 'number' || !Number.isFinite(decision.limit) || decision.limit <= 0
    || decision.quotaBucketId !== expectedBucketId
    || (decision.quotaSubject !== null && (
      typeof decision.quotaSubject.athleteId !== 'string' || decision.quotaSubject.athleteId.length === 0
      || typeof decision.quotaSubject.limit !== 'number' || !Number.isFinite(decision.quotaSubject.limit)
      || decision.quotaSubject.limit <= 0 || decision.quotaSubject.limit >= decision.limit
    ))
  ) {
    throw makeServerError('La decisión de cuota está incompleta, es inválida o no corresponde a su capacidad.')
  }

  const spend = await readSpend(decision.quotaOwnerUserId)
  const capCheck = evaluateSpendCaps(spend, decision.tier)
  if (capCheck.exceeded) throw makeSpendCapError(capCheck.scope, capCheck.capUsd)

  return { skip: false, bucketId: decision.quotaBucketId, limit: decision.limit }
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

  const subject = input.decision.quotaSubject
  let rows: unknown
  try {
    rows = await callRpc<unknown>('reserve_ai_usage', {
      p_user_id: input.decision.quotaOwnerUserId,
      p_bucket_id: preamble.bucketId,
      p_limit: preamble.limit,
      p_subject_athlete_id: subject?.athleteId ?? null,
      p_subject_limit: subject?.limit ?? null,
    })
  } catch (error) {
    if (!(error instanceof MissingRpcError)) throw error
    // `029` todavía no aplicada. Sin tope por atleta el contrato anterior es
    // equivalente, así que la cuota sigue funcionando y desplegar este bundle
    // deja de exigir la migración. CON tope por atleta no hay equivalencia
    // posible: la reserva dual es justamente lo que `029` agrega, y dejar
    // pasar sin ella sería fail-open sobre el límite delegado.
    if (subject !== null) {
      throw makeServerError('El tope por atleta requiere la migración 029 aplicada.')
    }
    try {
      rows = await callRpc<unknown>('increment_ai_usage_if_under_limit', {
        p_user_id: input.decision.quotaOwnerUserId,
        p_bucket_id: preamble.bucketId,
        p_limit: preamble.limit,
      })
    } catch (fallbackError) {
      // Si TAMPOCO existe el contrato anterior, no hay forma de reservar cuota.
      // `MissingRpcError` es una señal interna y no puede escapar del módulo:
      // afuera se aplanaría a un 500 genérico en vez del 503 fail-closed.
      if (fallbackError instanceof MissingRpcError) {
        throw makeServerError(
          `No hay ninguna RPC de cuota disponible: falta ${fallbackError.functionName}.`,
        )
      }
      throw fallbackError
    }
    // El contrato anterior sí usa `[]` para cuota agotada; el nuevo no.
    if (Array.isArray(rows) && rows.length === 0) {
      throw makeQuotaExceededError(preamble.bucketId, preamble.limit, 0)
    }
  }
  if (!Array.isArray(rows)) throw makeServerError('reserve_ai_usage devolvió una forma inesperada.')
  // La denegación legítima llega como SQLSTATE 45001 y se clasifica en
  // `callRpc`. Un arreglo vacío sólo puede ser el guard de argumentos de la
  // RPC: es un defecto de programación/configuración, nunca una cuota agotada.
  if (rows.length === 0) throw makeServerError('reserve_ai_usage devolvió cero filas: argumentos inválidos.')
  // Cardinalidad estricta (P2, ronda 2): la PK de ai_usage_daily garantiza
  // que un UPSERT nunca produce más de una fila — más de una fila acá es
  // señal de que algo está mal configurado (RPC equivocada, tabla sin PK
  // real), no un caso a tolerar en silencio.
  if (rows.length !== 1) throw makeServerError('reserve_ai_usage devolvió más de una fila.')
  const row = rows[0] as { usage_date?: unknown; request_count?: unknown }
  if (typeof row.usage_date !== 'string' || row.usage_date.length === 0) {
    throw makeServerError('reserve_ai_usage devolvió usage_date inválido.')
  }
  if (!isFiniteNonNegative(row.request_count)) {
    throw makeServerError('reserve_ai_usage devolvió request_count no numérico.')
  }

  return { bucketId: preamble.bucketId, limit: preamble.limit, usageDate: row.usage_date }
}

/**
 * Preflight de solo lectura para `enqueue-plan-generation.ts`. No incrementa
 * nada — solo evita crear un job que el worker va a rechazar igual. La
 * autoridad real es `assertUsageGate`, invocado por el worker en cada
 * intento real.
 */
/** Sentinela de la fila global; debe coincidir con el default de `029`. */
const GLOBAL_SUBJECT = ''
/**
 * Tope de filas del preflight. Una cuenta acumula 1 fila global más una por
 * atleta delegado en el día. Si se alcanza el tope no se puede distinguir
 * "no hay más" de "PostgREST truncó", así que se falla cerrado.
 */
const PREFLIGHT_ROW_CAP = 500

interface UsageRow { subject_athlete_id: string; request_count: number }

/** Marca de "la columna no existe todavía" (esquema previo a `029`). */
const SUBJECT_COLUMN_MISSING = Symbol('subject_column_missing')

async function readUsageRows(
  creds: { url: string; key: string },
  query: URLSearchParams,
): Promise<UsageRow[] | typeof SUBJECT_COLUMN_MISSING> {
  let response: Response
  try {
    response = await fetch(`${creds.url}/rest/v1/ai_usage_daily?${query.toString()}`, {
      headers: { Authorization: `Bearer ${creds.key}`, apikey: creds.key },
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    })
  } catch (error) {
    // Esta lectura es un GET directo a PostgREST (no pasa por callRpc), por
    // eso necesita convertir su propio error de red a 503 fail-closed.
    throw makeServerError(`Lectura de cuota no se pudo completar: ${error instanceof Error ? error.message : 'error de red'}.`)
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    if (isUndefinedColumn(body)) return SUBJECT_COLUMN_MISSING
    throw makeServerError(`Lectura de cuota devolvió ${response.status}.`)
  }
  let rows: unknown
  try {
    rows = await response.json()
  } catch {
    throw makeServerError('Lectura de cuota devolvió un cuerpo no JSON.')
  }
  if (!Array.isArray(rows)) {
    throw makeServerError('Lectura de cuota devolvió una forma inesperada.')
  }
  if (rows.length >= PREFLIGHT_ROW_CAP) {
    throw makeServerError('Lectura de cuota devolvió más filas de las esperadas.')
  }
  return rows.map((raw) => {
    const row = raw as { subject_athlete_id?: unknown; request_count?: unknown }
    if (!isFiniteNonNegative(row.request_count)) {
      throw makeServerError('Lectura de cuota devolvió request_count no numérico.')
    }
    const subject = row.subject_athlete_id
    if (subject !== undefined && typeof subject !== 'string') {
      throw makeServerError('Lectura de cuota devolvió subject_athlete_id no textual.')
    }
    return { subject_athlete_id: subject ?? GLOBAL_SUBJECT, request_count: row.request_count }
  })
}

export async function checkUsagePreflight(input: UsageGateInput): Promise<void> {
  const preamble = await evaluateGatePreamble(input)
  if (preamble.skip) return

  const creds = serviceRoleCredentials()
  if (!creds) throw makeServerError('Configuración de Supabase ausente en el servidor.')
  const today = new Date().toISOString().slice(0, 10)

  // Sin filtro por `subject_athlete_id`: expresar la fila global como
  // `subject_athlete_id=eq.` depende de que PostgREST interprete un valor
  // vacío como la cadena vacía, y si no lo hiciera esta lectura devolvería
  // cero filas y el preflight dejaría pasar en vez de bloquear — fail-OPEN
  // silencioso. Se traen todas las filas del día para (usuario, bucket) y se
  // reparten acá, que además ahorra un round trip.
  const query = new URLSearchParams({
    user_id: `eq.${input.decision.quotaOwnerUserId}`,
    usage_date: `eq.${today}`,
    bucket_id: `eq.${preamble.bucketId}`,
    select: 'subject_athlete_id,request_count',
    limit: String(PREFLIGHT_ROW_CAP),
  })

  let rows = await readUsageRows(creds, query)
  if (rows === SUBJECT_COLUMN_MISSING) {
    // `029` todavía no aplicada: la tabla no tiene `subject_athlete_id` y cada
    // (usuario, día, bucket) tiene exactamente una fila, que es la global.
    const legacy = new URLSearchParams(query)
    legacy.set('select', 'request_count')
    const legacyRows = await readUsageRows(creds, legacy)
    if (legacyRows === SUBJECT_COLUMN_MISSING) {
      throw makeServerError('Lectura de cuota rechazada por esquema en ambos contratos.')
    }
    rows = legacyRows.map((row) => ({ ...row, subject_athlete_id: GLOBAL_SUBJECT }))
  }

  const countFor = (subject: string): number => {
    const row = rows.find((candidate) => candidate.subject_athlete_id === subject)
    return row ? row.request_count : 0
  }

  if (countFor(GLOBAL_SUBJECT) >= preamble.limit) {
    throw makeQuotaExceededError(preamble.bucketId, preamble.limit, 0)
  }

  const quotaSubject = input.decision.quotaSubject
  if (quotaSubject !== null && countFor(quotaSubject.athleteId) >= quotaSubject.limit) {
    throw makeQuotaExceededError(preamble.bucketId, quotaSubject.limit, 0, 'subject')
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

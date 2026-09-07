import { createClient } from '@supabase/supabase-js'
import { withTimeout } from './promiseTimeout'

export const PLAN_GENERATION_TELEMETRY_RETENTION_DAYS = 90

/**
 * Ventana propia de `client_error_events`, más corta que los 90 días de la
 * telemetría de IA: esa fila lleva identidad de cuenta.
 *
 * La limpieza es diaria, así que una fila puede sobrevivir hasta ~24 h después
 * del corte. La policy de RLS aplica el mismo filtro de edad, de modo que la
 * promesa de 30 días se sostiene para el usuario aunque el cron falle — pero
 * eso **esconde** el fallo, y por eso `/ops` mira el conteo físico aparte.
 */
export const CLIENT_ERROR_RETENTION_DAYS = 30
const RETENTION_TIMEOUT_MS = 15_000

interface RetentionClient {
  from(table: string): {
    delete(options: { count: 'exact' }): {
      lt(column: string, value: string): PromiseLike<{
      count: number | null
      error: { message?: string; code?: string } | null
    }>
    }
  }
}

type RetentionTable =
  | 'plan_generation_attempts'
  | 'plan_generation_jobs'
  | 'coach_requests'
  | 'client_error_events'

type RetentionResult =
  | { status: 'ok'; deleted: number }
  | { status: 'skipped' }
  | { status: 'failed'; error: string }

/**
 * `035` es de aplicación manual y el bundle se despliega antes por diseño, así
 * que la tabla puede no existir todavía. Eso **no es un fallo del cron**: sin
 * esta tolerancia devolvería 207 en cada corrida hasta que alguien aplique la
 * migración, volviendo ámbar una función que está sana.
 *
 * Se limita a la ausencia de la relación: cualquier otro error de esa tabla
 * —permisos, timeout— sigue contando como fallo.
 */
const TABLES_TOLERATING_MISSING_RELATION: ReadonlySet<RetentionTable> = new Set([
  'client_error_events',
])

/**
 * Códigos con que PostgREST y Postgres reportan una tabla ausente. Se compara
 * **por código**, no por texto: PostgREST v12 —lo que corre Supabase— dice
 * «Could not find the table … in the schema cache» y nunca «relation … does not
 * exist», así que una regex sobre ese texto no habría matcheado jamás y la
 * tolerancia habría sido inerte. Mismo conjunto que `resolveEntitlement.ts`.
 */
const MISSING_TABLE_CODES: ReadonlySet<string> = new Set(['42P01', 'PGRST205'])

function isMissingRelation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && MISSING_TABLE_CODES.has(code)
}

/** Conserva el `code` de PostgREST, que es lo único fiable para clasificar. */
function retentionError(error: { message?: string; code?: string }): Error {
  const failure = new Error(error.message ?? 'telemetry retention failed')
  ;(failure as Error & { code?: string }).code = error.code
  return failure
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function runTableRetention(
  table: RetentionTable,
  operation: Promise<number>,
): Promise<RetentionResult> {
  try {
    const deleted = await withTimeout(
      operation,
      RETENTION_TIMEOUT_MS,
      `${table} retention`,
    )
    return { status: 'ok', deleted }
  } catch (error) {
    const message = errorMessage(error)
    if (TABLES_TOLERATING_MISSING_RELATION.has(table) && isMissingRelation(error)) {
      console.info(`[plan-generation-telemetry-retention] ${table} aún no existe; se omite`)
      return { status: 'skipped' }
    }
    console.error(`[plan-generation-telemetry-retention] ${table} cleanup failed`, error)
    return { status: 'failed', error: message }
  }
}

export async function deleteExpiredPlanGenerationAttempts(
  client: RetentionClient,
  now = Date.now(),
): Promise<number> {
  const cutoff = new Date(
    now - PLAN_GENERATION_TELEMETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()
  const { count, error } = await client
    .from('plan_generation_attempts')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff)
  if (error) throw new Error(error.message ?? 'telemetry retention failed')
  return count ?? 0
}

export async function deleteExpiredPlanGenerationJobs(
  client: RetentionClient,
  now = Date.now(),
): Promise<number> {
  const cutoff = new Date(
    now - PLAN_GENERATION_TELEMETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()
  const { count, error } = await client
    .from('plan_generation_jobs')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff)
  if (error) throw new Error(error.message ?? 'telemetry retention failed')
  return count ?? 0
}

export async function deleteExpiredCoachRequests(
  client: RetentionClient,
  now = Date.now(),
): Promise<number> {
  const cutoff = new Date(
    now - PLAN_GENERATION_TELEMETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()
  const { count, error } = await client
    .from('coach_requests')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff)
  if (error) throw new Error(error.message ?? 'telemetry retention failed')
  return count ?? 0
}

export async function deleteExpiredClientErrorEvents(
  client: RetentionClient,
  now = Date.now(),
): Promise<number> {
  const cutoff = new Date(
    now - CLIENT_ERROR_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()
  const { count, error } = await client
    .from('client_error_events')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff)
  if (error) throw retentionError(error)
  return count ?? 0
}

export async function runPlanGenerationTelemetryRetention(): Promise<{
  statusCode: number
  body: string
}> {
  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL']
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !serviceRoleKey) {
    console.error('[plan-generation-telemetry-retention] missing server configuration')
    return { statusCode: 500, body: JSON.stringify({ error: 'telemetry retention misconfigured' }) }
  }

  const startedAt = Date.now()
  try {
    const client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const [attempts, jobs, coachRequests, clientErrors] = await Promise.all([
      runTableRetention(
        'plan_generation_attempts',
        deleteExpiredPlanGenerationAttempts(client),
      ),
      runTableRetention(
        'plan_generation_jobs',
        deleteExpiredPlanGenerationJobs(client),
      ),
      runTableRetention(
        'coach_requests',
        deleteExpiredCoachRequests(client),
      ),
      runTableRetention(
        'client_error_events',
        deleteExpiredClientErrorEvents(client),
      ),
    ])

    const results: Record<RetentionTable, RetentionResult> = {
      plan_generation_attempts: attempts,
      plan_generation_jobs: jobs,
      coach_requests: coachRequests,
      client_error_events: clientErrors,
    }
    const failedTables = Object.entries(results)
      .filter((entry): entry is [RetentionTable, Extract<RetentionResult, { status: 'failed' }>] => (
        entry[1].status === 'failed'
      ))
      .map(([table, result]) => ({ table, error: result.error }))
    const successfulTableCount = Object.values(results).filter(
      result => result.status === 'ok' || result.status === 'skipped',
    ).length

    return {
      statusCode: failedTables.length === 0 ? 200 : successfulTableCount > 0 ? 207 : 500,
      body: JSON.stringify({
        deleted: attempts.status === 'ok' ? attempts.deleted : null,
        deletedJobs: jobs.status === 'ok' ? jobs.deleted : null,
        deletedCoachRequests: coachRequests.status === 'ok' ? coachRequests.deleted : null,
        deletedClientErrorEvents: clientErrors.status === 'ok' ? clientErrors.deleted : null,
        results,
        failures: failedTables,
        durationMs: Date.now() - startedAt,
      }),
    }
  } catch (error) {
    console.error('[plan-generation-telemetry-retention] setup failed', error)
    return { statusCode: 500, body: JSON.stringify({ error: 'telemetry retention failed' }) }
  }
}

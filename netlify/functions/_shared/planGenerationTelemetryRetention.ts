import { createClient } from '@supabase/supabase-js'
import { withTimeout } from './promiseTimeout'

export const PLAN_GENERATION_TELEMETRY_RETENTION_DAYS = 90
const RETENTION_TIMEOUT_MS = 15_000

interface RetentionClient {
  from(table: string): {
    delete(options: { count: 'exact' }): {
      lt(column: string, value: string): PromiseLike<{ count: number | null; error: { message?: string } | null }>
    }
  }
}

type RetentionTable = 'plan_generation_attempts' | 'plan_generation_jobs' | 'coach_requests'

type RetentionResult =
  | { status: 'ok'; deleted: number }
  | { status: 'failed'; error: string }

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
    const [attempts, jobs, coachRequests] = await Promise.all([
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
    ])

    const results: Record<RetentionTable, RetentionResult> = {
      plan_generation_attempts: attempts,
      plan_generation_jobs: jobs,
      coach_requests: coachRequests,
    }
    const failedTables = Object.entries(results)
      .filter((entry): entry is [RetentionTable, Extract<RetentionResult, { status: 'failed' }>] => (
        entry[1].status === 'failed'
      ))
      .map(([table, result]) => ({ table, error: result.error }))
    const successfulTableCount = Object.values(results).filter(result => result.status === 'ok').length

    return {
      statusCode: failedTables.length === 0 ? 200 : successfulTableCount > 0 ? 207 : 500,
      body: JSON.stringify({
        deleted: attempts.status === 'ok' ? attempts.deleted : null,
        deletedJobs: jobs.status === 'ok' ? jobs.deleted : null,
        deletedCoachRequests: coachRequests.status === 'ok' ? coachRequests.deleted : null,
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

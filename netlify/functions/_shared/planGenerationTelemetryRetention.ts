import { createClient } from '@supabase/supabase-js'

export const PLAN_GENERATION_TELEMETRY_RETENTION_DAYS = 90
const RETENTION_TIMEOUT_MS = 15_000

interface RetentionClient {
  from(table: string): {
    delete(options: { count: 'exact' }): {
      lt(column: string, value: string): PromiseLike<{ count: number | null; error: { message?: string } | null }>
    }
  }
}

async function withRetentionTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('retention timeout')), RETENTION_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
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
    const deleted = await withRetentionTimeout(deleteExpiredPlanGenerationAttempts(client))
    return {
      statusCode: 200,
      body: JSON.stringify({ deleted, durationMs: Date.now() - startedAt }),
    }
  } catch {
    console.error('[plan-generation-telemetry-retention] cleanup failed')
    return { statusCode: 500, body: JSON.stringify({ error: 'telemetry retention failed' }) }
  }
}

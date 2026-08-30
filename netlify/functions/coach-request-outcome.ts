import type { Handler, HandlerEvent } from '@netlify/functions'
import { corsPreflight } from './_shared/cors'
import { JSON_HEADERS, json, resolveAuthContext } from './_shared/planGenerationShared'

const MAX_TRACE_ID_LENGTH = 200
const RETRY_DELAYS_MS = [0, 120, 280] as const

function parsePayload(body: string | null): { traceId: string } | null {
  try {
    const value = JSON.parse(body ?? '{}') as { traceId?: unknown; outcome?: unknown }
    const traceId = typeof value.traceId === 'string' ? value.traceId.trim() : ''
    return value.outcome === 'safety_blocked' && traceId.length > 0 && traceId.length <= MAX_TRACE_ID_LENGTH
      ? { traceId }
      : null
  } catch {
    return null
  }
}

function delay(ms: number): Promise<void> {
  return ms === 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Records the post-processing outcome without accepting an arbitrary outcome
 * or user id from the browser. A caller may only turn its own successful row
 * into `safety_blocked`; it can never erase a proxy/provider error.
 */
export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') return corsPreflight()
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const payload = parsePayload(event.body)
  if (!payload) return json(400, { error: 'Payload inválido.' })

  let auth: Awaited<ReturnType<typeof resolveAuthContext>>
  try {
    auth = await resolveAuthContext(event)
  } catch (error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode === 401 ? 401 : 500
    return json(statusCode, { error: statusCode === 401 ? 'Sesión requerida.' : 'No se pudo validar la sesión.' })
  }

  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL']
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !serviceRoleKey) return json(500, { error: 'Telemetría no configurada.' })

  const query = new URLSearchParams({
    trace_id: `eq.${payload.traceId}`,
    user_id: `eq.${auth.userId}`,
    // Idempotent, while intentionally excluding provider/proxy errors.
    outcome: 'in.(ok,safety_blocked)',
  })
  for (const retryDelayMs of RETRY_DELAYS_MS) {
    await delay(retryDelayMs)
    let response: Response
    try {
      response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/coach_requests?${query}`, {
        method: 'PATCH',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ outcome: 'safety_blocked' }),
        signal: AbortSignal.timeout(2_000),
      })
    } catch {
      return json(502, { error: 'No se pudo registrar el desenlace.' })
    }
    if (!response.ok) return json(502, { error: 'No se pudo registrar el desenlace.' })
    const rows = await response.json().catch(() => [])
    if (Array.isArray(rows) && rows.length > 0) return { statusCode: 204, headers: JSON_HEADERS, body: '' }
  }

  // The proxy telemetry is best-effort too. Treat a missing row as an
  // acknowledged no-op, so observability can never disturb the safe decline.
  return { statusCode: 204, headers: JSON_HEADERS, body: '' }
}

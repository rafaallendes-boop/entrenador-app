import type { Handler } from '@netlify/functions'
import { ensureFreshToken, fetchWhoopData, revokeWhoopAccess } from './_shared/whoopClient'
import { getServiceRoleDb } from './_shared/whoopOAuth'
import { json, resolveAuthContext } from './_shared/planGenerationShared'
import { normalizeWhoop, normalizeWorkouts } from './_shared/whoopNormalize'
import { runWhoopSync } from './_shared/whoopSync'
import {
  deleteAllWhoopData,
  getConnection,
  reconcileWorkouts,
  resolveSelfAthleteId,
  setSyncResult,
  upsertBiometricReadings,
  upsertConnection,
  upsertReadiness,
  upsertWorkouts,
  type WhoopDb,
} from './_shared/whoopSupabase'
import { corsPreflight } from './_shared/cors'

const baseDeps = (db: WhoopDb) => ({
  db,
  getConnection,
  upsertConnection,
  resolveSelfAthleteId,
  setSyncResult,
  upsertReadiness,
  upsertBiometricReadings,
  upsertWorkouts,
  reconcileWorkouts,
  ensureFreshToken,
  fetchWhoopData,
  normalizeWhoop,
  normalizeWorkouts,
})

function parseDays(body: string | null): number | undefined {
  if (!body) return undefined
  try {
    const parsed = JSON.parse(body) as { days?: unknown }
    if (typeof parsed.days !== 'number' || !Number.isFinite(parsed.days)) return undefined
    return Math.max(1, Math.min(14, Math.round(parsed.days)))
  } catch {
    return undefined
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return corsPreflight()
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'DELETE') {
    return json(405, { error: 'Method not allowed' })
  }

  let auth: Awaited<ReturnType<typeof resolveAuthContext>>
  try {
    auth = await resolveAuthContext(event)
  } catch (error) {
    return json((error as { statusCode?: number }).statusCode ?? 401, { error: 'Sesión requerida.' })
  }

  const db = getServiceRoleDb()

  if (event.httpMethod === 'DELETE') {
    try {
      const conn = await getConnection(db, auth.userId)
      if (conn) {
        const { accessToken } = await ensureFreshToken(conn)
        await revokeWhoopAccess(accessToken)
      }
    } catch {
      // Revocation is best-effort; local deletion still honors the user's disconnect.
    }
    await deleteAllWhoopData(db, auth.userId)
    return json(200, { ok: true })
  }

  const result = await runWhoopSync(baseDeps(db), {
    userId: auth.userId,
    trigger: 'manual',
    days: parseDays(event.body),
  })
  if (result.ok) return json(200, result)

  const statusCode = result.reason === 'cooldown' || result.reason === 'rate_limited' ? 429 : 400
  return json(statusCode, result)
}

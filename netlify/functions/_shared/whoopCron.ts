import type { HandlerResponse } from '@netlify/functions'
import { ensureFreshToken, fetchWhoopData } from './whoopClient'
import { getServiceRoleDb } from './whoopOAuth'
import { normalizeWhoop, normalizeWorkouts } from './whoopNormalize'
import { runWhoopSync } from './whoopSync'
import {
  deleteExpiredOAuthStates,
  getConnection,
  resolveSelfAthleteId,
  reconcileWorkouts,
  setSyncResult,
  upsertBiometricReadings,
  upsertConnection,
  upsertReadiness,
  upsertWorkouts,
  type WhoopDb,
} from './whoopSupabase'

interface SelectConnectionsQuery {
  select(columns?: string): Promise<{
    data?: Array<{ user_id?: string }> | null
    error?: { message?: string } | null
  }>
}

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

function connectionTable(db: WhoopDb): SelectConnectionsQuery {
  return db.from('whoop_connections') as SelectConnectionsQuery
}

export async function runWhoopCron(): Promise<HandlerResponse> {
  const db = getServiceRoleDb()
  const { data, error } = await connectionTable(db).select('user_id')
  if (error) return { statusCode: 500, body: 'error' }

  const userIds = (data ?? [])
    .map((row) => row.user_id)
    .filter((userId): userId is string => typeof userId === 'string' && userId.length > 0)

  for (const userId of userIds) {
    await runWhoopSync(baseDeps(db), { userId, trigger: 'cron' }).catch(() => undefined)
  }
  await deleteExpiredOAuthStates(db).catch(() => undefined)
  return { statusCode: 200, body: 'ok' }
}

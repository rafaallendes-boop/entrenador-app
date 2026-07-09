import type { FetchImpl, WhoopRaw, WhoopTokens } from './whoopClient'
import type { BiometricReadingRow, ReadinessRow, StoredConnection, WhoopDb } from './whoopSupabase'

export const MANUAL_COOLDOWN_MS = 300_000

export interface WhoopSyncResult {
  ok: boolean
  reason?: 'no_connection' | 'no_self_athlete' | 'cooldown' | 'rate_limited' | 'error'
  retryAfterMs?: number
  days?: number
}

export interface WhoopSyncDeps {
  db: WhoopDb
  getConnection: (db: WhoopDb, userId: string) => Promise<StoredConnection | null>
  upsertConnection: (db: WhoopDb, conn: StoredConnection) => Promise<void>
  resolveSelfAthleteId: (db: WhoopDb, userId: string) => Promise<string | null>
  setSyncResult: (
    db: WhoopDb,
    userId: string,
    input: { lastSyncAt: string; lastManualSyncAt?: string; status: 'ok' | 'error' },
  ) => Promise<void>
  upsertReadiness: (db: WhoopDb, userId: string, athleteId: string, rows: ReadinessRow[]) => Promise<void>
  upsertBiometricReadings: (db: WhoopDb, userId: string, athleteId: string, rows: BiometricReadingRow[]) => Promise<void>
  ensureFreshToken: (conn: WhoopTokens, deps?: { fetchImpl?: FetchImpl }) => Promise<{ accessToken: string; refreshed?: WhoopTokens }>
  fetchWhoopData: (accessToken: string, opts?: { fetchImpl?: FetchImpl; days?: number }) => Promise<WhoopRaw>
  normalizeWhoop: (raw: WhoopRaw) => { readiness: ReadinessRow[]; readings: BiometricReadingRow[] }
  fetchImpl?: FetchImpl
  now?: () => number
}

function isRateLimited(error: unknown): boolean {
  return Boolean((error as { rateLimited?: unknown })?.rateLimited)
}

function retryAfterMs(error: unknown): number | undefined {
  const value = (error as { retryAfterMs?: unknown })?.retryAfterMs
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export async function runWhoopSync(
  deps: WhoopSyncDeps,
  input: { userId: string; trigger: 'manual' | 'cron'; days?: number },
): Promise<WhoopSyncResult> {
  const now = deps.now ?? (() => Date.now())
  const conn = await deps.getConnection(deps.db, input.userId)
  if (!conn) return { ok: false, reason: 'no_connection' }

  const athleteId = await deps.resolveSelfAthleteId(deps.db, input.userId)
  if (!athleteId) return { ok: false, reason: 'no_self_athlete' }

  if (input.trigger === 'manual' && conn.lastManualSyncAt) {
    const elapsed = now() - new Date(conn.lastManualSyncAt).getTime()
    if (Number.isFinite(elapsed) && elapsed < MANUAL_COOLDOWN_MS) {
      return { ok: false, reason: 'cooldown', retryAfterMs: MANUAL_COOLDOWN_MS - elapsed }
    }
  }

  try {
    const { accessToken, refreshed } = await deps.ensureFreshToken(conn, { fetchImpl: deps.fetchImpl })
    if (refreshed) {
      await deps.upsertConnection(deps.db, { ...conn, ...refreshed })
    }

    const days = input.days ?? 7
    const raw = await deps.fetchWhoopData(accessToken, { fetchImpl: deps.fetchImpl, days })
    const normalized = deps.normalizeWhoop(raw)
    await deps.upsertReadiness(deps.db, input.userId, athleteId, normalized.readiness)
    await deps.upsertBiometricReadings(deps.db, input.userId, athleteId, normalized.readings)

    const nowIso = new Date(now()).toISOString()
    await deps.setSyncResult(deps.db, input.userId, {
      lastSyncAt: nowIso,
      lastManualSyncAt: input.trigger === 'manual' ? nowIso : undefined,
      status: 'ok',
    })
    return { ok: true, days }
  } catch (error) {
    await deps.setSyncResult(deps.db, input.userId, {
      lastSyncAt: new Date(now()).toISOString(),
      status: 'error',
    }).catch(() => undefined)

    if (isRateLimited(error)) {
      return { ok: false, reason: 'rate_limited', retryAfterMs: retryAfterMs(error) }
    }
    return { ok: false, reason: 'error' }
  }
}

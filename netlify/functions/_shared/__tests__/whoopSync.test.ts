import { describe, expect, it, vi } from 'vitest'
import { hasWorkoutScope, MANUAL_COOLDOWN_MS, runWhoopSync, type WhoopSyncDeps } from '../whoopSync'

const now = new Date('2026-06-21T12:00:00Z').getTime()
const baseConn = {
  userId: 'u1',
  accessToken: 'acc',
  refreshToken: 'ref',
  keyVersion: 1,
  expiresAt: new Date(now + 3_600_000).toISOString(),
}

function deps(overrides: Partial<WhoopSyncDeps> = {}): WhoopSyncDeps {
  const base: WhoopSyncDeps = {
    db: {} as WhoopSyncDeps['db'],
    getConnection: vi.fn(async () => baseConn),
    upsertConnection: vi.fn(async () => undefined),
    resolveSelfAthleteId: vi.fn(async () => 'ath_u1'),
    setSyncResult: vi.fn(async () => undefined),
    upsertReadiness: vi.fn(async () => undefined),
    upsertBiometricReadings: vi.fn(async () => undefined),
    upsertWorkouts: vi.fn(async () => undefined),
    reconcileWorkouts: vi.fn(async () => undefined),
    ensureFreshToken: vi.fn(async () => ({ accessToken: 'acc' })),
    fetchWhoopData: vi.fn(async (_token, opts) => ({
      recovery: [],
      sleep: [],
      cycles: [],
      workouts: opts?.includeWorkouts ? [] : null,
    })),
    normalizeWhoop: vi.fn(() => ({ readiness: [{ date: '2026-06-21', recoveryScore: 28 }], readings: [] })),
    normalizeWorkouts: vi.fn(() => []),
    now: () => now,
  }
  return { ...base, ...overrides }
}

describe('runWhoopSync', () => {
  it('returns no_connection when none exists', async () => {
    const d = deps({ getConnection: vi.fn(async () => null) })
    await expect(runWhoopSync(d, { userId: 'u1', trigger: 'manual' })).resolves.toEqual({
      ok: false,
      reason: 'no_connection',
    })
  })

  it('returns no_self_athlete when the account has no self athlete yet', async () => {
    const d = deps({ resolveSelfAthleteId: vi.fn(async () => null) })
    await expect(runWhoopSync(d, { userId: 'u1', trigger: 'manual' })).resolves.toEqual({
      ok: false,
      reason: 'no_self_athlete',
    })
  })

  it('enforces manual cooldown', async () => {
    const recent = new Date(now - 60_000).toISOString()
    const d = deps({ getConnection: vi.fn(async () => ({ ...baseConn, lastManualSyncAt: recent })) })

    const res = await runWhoopSync(d, { userId: 'u1', trigger: 'manual' })

    expect(res.ok).toBe(false)
    expect(res.reason).toBe('cooldown')
    expect(res.retryAfterMs).toBe(MANUAL_COOLDOWN_MS - 60_000)
  })

  it('ignores cooldown for cron trigger', async () => {
    const recent = new Date(now - 60_000).toISOString()
    const d = deps({ getConnection: vi.fn(async () => ({ ...baseConn, lastManualSyncAt: recent })) })

    const res = await runWhoopSync(d, { userId: 'u1', trigger: 'cron' })

    expect(res.ok).toBe(true)
    expect(d.upsertReadiness).toHaveBeenCalledWith(d.db, 'u1', 'ath_u1', expect.any(Array))
  })

  it('persists rotated tokens when refreshed', async () => {
    const d = deps({
      ensureFreshToken: vi.fn(async () => ({
        accessToken: 'newacc',
        refreshed: {
          accessToken: 'newacc',
          refreshToken: 'newref',
          expiresAt: new Date(now + 3_600_000).toISOString(),
        },
      })),
    })

    await runWhoopSync(d, { userId: 'u1', trigger: 'manual' })

    expect(d.upsertConnection).toHaveBeenCalledWith(d.db, expect.objectContaining({
      accessToken: 'newacc',
      refreshToken: 'newref',
    }))
  })

  it('preserves stored scopes when refresh omits scope', async () => {
    const d = deps({
      getConnection: vi.fn(async () => ({ ...baseConn, scopes: 'offline read:workout' })),
      ensureFreshToken: vi.fn(async () => ({
        accessToken: 'newacc',
        refreshed: {
          accessToken: 'newacc',
          refreshToken: 'newref',
          expiresAt: new Date(now + 3_600_000).toISOString(),
          scopes: undefined,
        },
      })),
    })
    await runWhoopSync(d, { userId: 'u1', trigger: 'cron' })
    expect(d.upsertConnection).toHaveBeenCalledWith(d.db, expect.objectContaining({
      scopes: 'offline read:workout',
    }))
  })

  it('requests workouts only for a connection with read:workout', async () => {
    const withScope = deps({
      getConnection: vi.fn(async () => ({ ...baseConn, scopes: 'offline read:workout' })),
    })
    await runWhoopSync(withScope, { userId: 'u1', trigger: 'cron' })
    expect(withScope.fetchWhoopData).toHaveBeenCalledWith('acc', expect.objectContaining({ includeWorkouts: true }))

    const withoutScope = deps({
      getConnection: vi.fn(async () => ({ ...baseConn, scopes: 'offline read:recovery' })),
    })
    await runWhoopSync(withoutScope, { userId: 'u1', trigger: 'cron' })
    expect(withoutScope.fetchWhoopData).toHaveBeenCalledWith('acc', expect.objectContaining({ includeWorkouts: false }))
  })

  it('persists and authoritatively reconciles a successful workout collection', async () => {
    const rows = [{
      workoutId: 'w-1',
      date: '2026-07-09',
      sportName: 'running',
      startAt: '2026-07-09T14:00:00.000Z',
      endAt: '2026-07-09T15:00:00.000Z',
      durationMin: 60,
      strain: null,
      avgHr: null,
      maxHr: null,
      distanceM: null,
      scoreState: 'SCORED' as const,
    }]
    const d = deps({
      getConnection: vi.fn(async () => ({ ...baseConn, scopes: 'offline read:workout' })),
      fetchWhoopData: vi.fn(async () => ({ recovery: [], sleep: [], cycles: [], workouts: [{ id: 'w-1' }] })),
      normalizeWorkouts: vi.fn(() => rows),
    })
    await runWhoopSync(d, { userId: 'u1', trigger: 'cron' })
    expect(d.upsertWorkouts).toHaveBeenCalledWith(d.db, 'u1', 'ath_u1', rows)
    expect(d.reconcileWorkouts).toHaveBeenCalledWith(d.db, 'u1', 'ath_u1', expect.any(String), ['w-1'])
  })

  it('never upserts or reconciles when workouts were not obtained', async () => {
    const d = deps({
      getConnection: vi.fn(async () => ({ ...baseConn, scopes: 'offline read:workout' })),
      fetchWhoopData: vi.fn(async () => ({ recovery: [], sleep: [], cycles: [], workouts: null })),
    })
    await runWhoopSync(d, { userId: 'u1', trigger: 'cron' })
    expect(d.upsertWorkouts).not.toHaveBeenCalled()
    expect(d.reconcileWorkouts).not.toHaveBeenCalled()
  })

  it('shares the exact 16-day window instant between fetch and reconcile', async () => {
    const d = deps({
      getConnection: vi.fn(async () => ({ ...baseConn, scopes: 'offline read:workout' })),
    })
    await runWhoopSync(d, { userId: 'u1', trigger: 'cron' })
    const fetchIso = vi.mocked(d.fetchWhoopData).mock.calls[0]?.[1]?.workoutWindowStartIso
    const reconcileIso = vi.mocked(d.reconcileWorkouts).mock.calls[0]?.[3]
    expect(fetchIso).toBe(reconcileIso)
    expect(new Date(fetchIso!).getTime()).toBe(now - 16 * 86_400_000)
  })

  it('maps rate-limit errors to a friendly result', async () => {
    const d = deps({
      fetchWhoopData: vi.fn(async () => {
        throw Object.assign(new Error('429'), { rateLimited: true, retryAfterMs: 120_000 })
      }),
    })

    const res = await runWhoopSync(d, { userId: 'u1', trigger: 'manual' })

    expect(res.reason).toBe('rate_limited')
    expect(res.retryAfterMs).toBe(120_000)
  })

  it('exports a 5-minute cooldown', () => {
    expect(MANUAL_COOLDOWN_MS).toBe(300_000)
  })

  it('recognizes whitespace- and comma-separated workout scope lists', () => {
    expect(hasWorkoutScope('offline read:workout')).toBe(true)
    expect(hasWorkoutScope('offline,read:workout')).toBe(true)
    expect(hasWorkoutScope('offline read:recovery')).toBe(false)
  })
})

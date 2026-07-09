import { describe, expect, it, vi } from 'vitest'
import { MANUAL_COOLDOWN_MS, runWhoopSync, type WhoopSyncDeps } from '../whoopSync'

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
    ensureFreshToken: vi.fn(async () => ({ accessToken: 'acc' })),
    fetchWhoopData: vi.fn(async () => ({ recovery: [], sleep: [], cycles: [] })),
    normalizeWhoop: vi.fn(() => ({ readiness: [{ date: '2026-06-21', recoveryScore: 28 }], readings: [] })),
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
})

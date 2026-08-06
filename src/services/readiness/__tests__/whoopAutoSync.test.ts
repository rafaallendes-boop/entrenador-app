import { describe, expect, it } from 'vitest'
import { shouldAutoSyncWhoop, WHOOP_AUTO_SYNC_STALE_AFTER_MS, type WhoopAutoSyncInput } from '../whoopAutoSync'

const NOW = Date.parse('2026-08-05T12:00:00.000Z')
const MIN = 60_000
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('shouldAutoSyncWhoop', () => {
  const cases: Array<[string, WhoopAutoSyncInput, boolean]> = [
    ['sin conexion no sincroniza', { connected: false, lastSyncAt: null, lastSyncStatus: null, now: NOW }, false],
    ['sin conexion no sincroniza ni con un sync fresco', { connected: false, lastSyncAt: ago(MIN), lastSyncStatus: 'ok', now: NOW }, false],
    ['nunca sincronizo', { connected: true, lastSyncAt: null, lastSyncStatus: null, now: NOW }, true],
    ['timestamp undefined', { connected: true, lastSyncAt: undefined, lastSyncStatus: 'ok', now: NOW }, true],
    ['timestamp no parseable', { connected: true, lastSyncAt: 'not-a-date', lastSyncStatus: 'ok', now: NOW }, true],
    ['timestamp en el futuro', { connected: true, lastSyncAt: new Date(NOW + 5 * MIN).toISOString(), lastSyncStatus: 'ok', now: NOW }, true],
    ['reciente pero con error', { connected: true, lastSyncAt: ago(2 * MIN), lastSyncStatus: 'error', now: NOW }, true],
    ['reciente sin status registrado', { connected: true, lastSyncAt: ago(2 * MIN), lastSyncStatus: null, now: NOW }, true],
    ['29 minutos y ok', { connected: true, lastSyncAt: ago(29 * MIN), lastSyncStatus: 'ok', now: NOW }, false],
    ['30 minutos exactos y ok', { connected: true, lastSyncAt: ago(30 * MIN), lastSyncStatus: 'ok', now: NOW }, true],
    ['31 minutos y ok', { connected: true, lastSyncAt: ago(31 * MIN), lastSyncStatus: 'ok', now: NOW }, true],
  ]

  it.each(cases)('%s', (_label, input, expected) => {
    expect(shouldAutoSyncWhoop(input)).toBe(expected)
  })

  it('respeta un staleAfterMs custom', () => {
    const base = { connected: true, lastSyncStatus: 'ok' as const, now: NOW }
    expect(shouldAutoSyncWhoop({ ...base, lastSyncAt: ago(4 * MIN), staleAfterMs: 5 * MIN })).toBe(false)
    expect(shouldAutoSyncWhoop({ ...base, lastSyncAt: ago(6 * MIN), staleAfterMs: 5 * MIN })).toBe(true)
  })

  it('usa 30 minutos como default', () => {
    expect(WHOOP_AUTO_SYNC_STALE_AFTER_MS).toBe(1_800_000)
  })
})

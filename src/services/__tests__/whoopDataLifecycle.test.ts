import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { clearAllLocalAppData } from '../appMaintenance'
import { exportAppData, importAppDataFromFile } from '../dataExport'

function installLocalStorage() {
  const state = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return state.size
      },
      key: (index: number) => Array.from(state.keys())[index] ?? null,
      getItem: (key: string) => state.get(key) ?? null,
      setItem: (key: string, value: string) => {
        state.set(key, value)
      },
      removeItem: (key: string) => {
        state.delete(key)
      },
      clear: () => {
        state.clear()
      },
    },
  })
}

describe('whoop data lifecycle', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    installLocalStorage()
    await db.readinessDaily.put({
      id: 'whoop:ath_u1:2026-06-21',
      athleteId: 'ath_u1',
      date: '2026-06-21',
      source: 'whoop',
      updatedAt: 1,
    })
  })

  afterEach(() => {
    db.close()
    delete (globalThis as { localStorage?: Storage }).localStorage
  })

  it('clearAllLocalAppData removes readinessDaily', async () => {
    await clearAllLocalAppData()
    expect(await db.readinessDaily.count()).toBe(0)
  })

  it('exports readinessDaily in the app backup', async () => {
    const { json } = await exportAppData()
    const backup = JSON.parse(json) as { tables: { readinessDaily: unknown[] } }

    expect(backup.tables.readinessDaily).toHaveLength(1)
    expect(backup.tables.readinessDaily[0]).toMatchObject({
      id: 'whoop:ath_u1:2026-06-21',
      athleteId: 'ath_u1',
      date: '2026-06-21',
      source: 'whoop',
    })
  })

  it('restores readinessDaily from an app backup', async () => {
    const { json } = await exportAppData()
    await db.readinessDaily.clear()

    const file = new File([json], 'backup.json', { type: 'application/json' })
    await importAppDataFromFile(file, 'merge')

    const row = await db.readinessDaily.get('whoop:ath_u1:2026-06-21')
    expect(row?.source).toBe('whoop')
  })
})

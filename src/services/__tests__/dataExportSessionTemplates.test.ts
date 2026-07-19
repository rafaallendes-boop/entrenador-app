import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db } from '../../db/db'
import type { StoredSessionTemplate } from '../../types/sessionTemplate'
import {
  exportAppData,
  importAppDataFromFile,
  parseAppDataExport,
  pickSessionTemplateWinner,
  previewAppDataImportFile,
} from '../dataExport'

const liveTemplate: StoredSessionTemplate = {
  id: 'template-live',
  name: 'Voleas',
  kind: 'session',
  payloadVersion: 1,
  payload: { type: 'squash', timeBlock: 'AM', title: 'Voleas', durationMin: 60 },
  createdAt: 1,
  updatedAt: 100,
}

const tombstoneTemplate: StoredSessionTemplate = {
  ...liveTemplate,
  id: 'template-deleted',
  updatedAt: 200,
  deletedAt: 200,
}

const unsupportedTemplate: StoredSessionTemplate = {
  id: 'template-future',
  name: 'Futura',
  kind: 'future-session',
  payloadVersion: 9,
  payload: { opaque: ['keep', { nested: true }] },
  createdAt: 2,
  updatedAt: 3,
}

function backup(version: number, sessionTemplates?: unknown[]) {
  return {
    app: 'RallyIQ',
    version,
    exportedAt: '2026-07-18T12:00:00.000Z',
    exportedFromAppVersion: 'test',
    tables: {
      sessions: [],
      dayLogs: [],
      weekSummaries: [],
      trainingPlans: [],
      trainingPlanWeeks: [],
      chatMessages: [],
      coachProposals: [],
      athleteProfiles: [],
      athletes: [],
      ...(sessionTemplates === undefined ? {} : { sessionTemplates }),
    },
  }
}

function backupFile(value: unknown): File {
  return new File([JSON.stringify(value)], 'backup.json', { type: 'application/json' })
}

describe('backup v4 session templates', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('exports live rows, tombstones and unsupported raw payloads', async () => {
    await db.sessionTemplates.bulkPut([liveTemplate, tombstoneTemplate, unsupportedTemplate])

    const { json } = await exportAppData()
    const exported = JSON.parse(json) as {
      version: number
      tables: { sessionTemplates: StoredSessionTemplate[] }
    }

    expect(exported.version).toBe(4)
    expect([...exported.tables.sessionTemplates].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      liveTemplate,
      tombstoneTemplate,
      unsupportedTemplate,
    ].sort((a, b) => a.id.localeCompare(b.id)))
  })

  it('migrates v1-v3 backups without a templates table to an empty collection', () => {
    for (const version of [1, 2, 3]) {
      expect(parseAppDataExport(backup(version)).tables.sessionTemplates).toEqual([])
    }
  })

  it('treats a v3 replace as an empty account-scoped templates table', async () => {
    await db.sessionTemplates.put(liveTemplate)

    await importAppDataFromFile(backupFile(backup(3)), 'replace')

    expect(await db.sessionTemplates.count()).toBe(0)
  })

  it('round-trips v4 rows identically through a replace import', async () => {
    await db.sessionTemplates.bulkPut([tombstoneTemplate, unsupportedTemplate])
    const { json } = await exportAppData()
    await db.sessionTemplates.clear()

    await importAppDataFromFile(backupFile(JSON.parse(json)), 'replace')

    expect(await db.sessionTemplates.toArray()).toEqual([
      tombstoneTemplate,
      unsupportedTemplate,
    ])
  })

  it('excludes tombstones from user-facing preview and imported counts', async () => {
    const file = backupFile(backup(4, [liveTemplate, tombstoneTemplate]))

    const preview = await previewAppDataImportFile(file)
    const result = await importAppDataFromFile(file, 'replace')

    expect(preview.counts.sessionTemplates).toBe(1)
    expect(preview.mergeConflicts.newInBackupCount).toBe(1)
    expect(result.counts.sessionTemplates).toBe(1)
    expect(await db.sessionTemplates.count()).toBe(2)
  })

  it('uses delete-wins when a merge has equal timestamps', async () => {
    const local = { ...liveTemplate, id: 'equal', updatedAt: 200 }
    const incoming = { ...local, deletedAt: 200 }
    await db.sessionTemplates.put(local)

    await importAppDataFromFile(backupFile(backup(4, [incoming])), 'merge')

    expect(await db.sessionTemplates.get('equal')).toEqual(incoming)
  })

  it('keeps a newer local live row over an older backup tombstone', async () => {
    const local = { ...liveTemplate, id: 'newer-local', updatedAt: 300 }
    const incoming = { ...local, updatedAt: 200, deletedAt: 200 }
    await db.sessionTemplates.put(local)

    await importAppDataFromFile(backupFile(backup(4, [incoming])), 'merge')

    expect(await db.sessionTemplates.get('newer-local')).toEqual(local)
  })

  it('drops malformed template rows without rejecting the rest of the backup', () => {
    const parsed = parseAppDataExport(backup(4, [
      liveTemplate,
      { id: 'missing-fields' },
      { ...liveTemplate, id: 'bad-time', updatedAt: Number.NaN },
      { ...liveTemplate, id: 'bad-version', payloadVersion: 0 },
      { ...liveTemplate, id: 'bad-tombstone', updatedAt: 20, deletedAt: 19 },
    ]))

    expect(parsed.tables.sessionTemplates).toEqual([liveTemplate])
  })

  it('drops rows the session_templates columns would reject on push', () => {
    // Admitting these would store a row locally that fails every subsequent
    // push with a non-retriable 400, wedging sync behind a validation error.
    const parsed = parseAppDataExport(backup(4, [
      liveTemplate,
      // `data jsonb not null`
      { ...liveTemplate, id: 'null-payload', payload: null },
      // `payload_version smallint` (max 32767)
      { ...liveTemplate, id: 'overflow-version', payloadVersion: 40000 },
      // `created_at` / `updated_at` bigint, kept JSON-round-trippable
      { ...liveTemplate, id: 'overflow-updated', updatedAt: 1e300 },
      { ...liveTemplate, id: 'fractional-created', createdAt: 1.5 },
      { ...liveTemplate, id: 'negative-created', createdAt: -1 },
    ]))

    expect(parsed.tables.sessionTemplates).toEqual([liveTemplate])
  })

  it('still admits unknown kinds and forward payload versions', () => {
    const parsed = parseAppDataExport(backup(4, [unsupportedTemplate]))

    expect(parsed.tables.sessionTemplates).toEqual([unsupportedTemplate])
  })

  it('rejects an envelope newer than v4', () => {
    expect(() => parseAppDataExport(backup(5, []))).toThrow(/Version de backup no soportada: 5/)
  })

  it('exposes the same stable LWW delete-wins comparator used by merge', () => {
    const live = { ...liveTemplate, updatedAt: 200 }
    const deleted = { ...live, deletedAt: 200 }
    expect(pickSessionTemplateWinner(live, deleted)).toBe(deleted)
    expect(pickSessionTemplateWinner(deleted, live)).toBe(deleted)
    expect(pickSessionTemplateWinner({ ...live, updatedAt: 300 }, deleted).updatedAt).toBe(300)
  })
})

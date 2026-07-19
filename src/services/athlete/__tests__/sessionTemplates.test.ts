import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../../../types'
import type { SupportedSessionTemplate } from '../../../types/sessionTemplate'
import { db } from '../../../db/db'
import * as syncService from '../../syncService'
import { templateToDraft } from '../sessionTemplateSerializer'
import {
  createSessionTemplate,
  createSessionTemplateFromSession,
  listSessionTemplates,
  SessionTemplateGoneError,
  softDeleteSessionTemplate,
  updateSessionTemplate,
} from '../sessionTemplates'

const draft = {
  date: '2026-07-14',
  timeBlock: 'AM' as const,
  type: 'squash' as const,
  title: 'Drills volea',
  durationMin: 60,
  subtype: 'training' as const,
}

describe('sessionTemplates CRUD local', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    vi.spyOn(syncService, 'pushSessionTemplate').mockResolvedValue()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
  })

  it('create guarda, normaliza nombre con fallback y pushea', async () => {
    const created = await createSessionTemplate('  ', draft)
    expect(created.name).toBe('Drills volea')
    expect(created.payloadVersion).toBe(1)
    expect(await db.sessionTemplates.count()).toBe(1)
    expect(syncService.pushSessionTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.id }),
    )
  })

  it('list filtra tombstones, incluye incompatibles vivas y ordena updatedAt desc', async () => {
    const deleted = await createSessionTemplate('A', draft)
    const live = await createSessionTemplate('B', draft)
    await softDeleteSessionTemplate(deleted.id)
    await db.sessionTemplates.put({
      id: 'future', name: 'Futura', kind: 'future-kind', payloadVersion: 2,
      payload: { opaque: true }, createdAt: 1, updatedAt: live.updatedAt + 20,
    })
    const listed = await listSessionTemplates()
    expect(listed.map((template) => template.id)).toEqual(['future', live.id])
  })

  it('soft-delete persiste tombstone monotónico y nunca borra físicamente', async () => {
    const created = await createSessionTemplate('A', draft)
    await softDeleteSessionTemplate(created.id)
    const row = await db.sessionTemplates.get(created.id)
    expect(row?.deletedAt).toBe(row?.updatedAt)
    expect(row!.updatedAt).toBeGreaterThan(created.updatedAt)
    expect(await db.sessionTemplates.count()).toBe(1)
    expect(syncService.pushSessionTemplate).toHaveBeenLastCalledWith(row)
  })

  it('soft-delete repetido es no-op', async () => {
    const created = await createSessionTemplate('A', draft)
    await softDeleteSessionTemplate(created.id)
    const first = await db.sessionTemplates.get(created.id)
    vi.mocked(syncService.pushSessionTemplate).mockClear()
    await softDeleteSessionTemplate(created.id)
    expect(await db.sessionTemplates.get(created.id)).toEqual(first)
    expect(syncService.pushSessionTemplate).not.toHaveBeenCalled()
  })

  it('update relee Dexie y rechaza filas borradas o incompatibles', async () => {
    const created = await createSessionTemplate('A', draft)
    const { draft: formDraft, originalsById } = templateToDraft(
      created.payload,
      '2026-07-14',
    )
    await softDeleteSessionTemplate(created.id)
    await expect(updateSessionTemplate(
      created.id, created, formDraft, originalsById, 'A',
    )).rejects.toThrow(SessionTemplateGoneError)

    await db.sessionTemplates.put({
      ...created, kind: 'future-kind', payloadVersion: 2, payload: { raw: true }, deletedAt: undefined,
    })
    await expect(updateSessionTemplate(
      created.id, created, formDraft, originalsById, 'A',
    )).rejects.toThrow('Esta plantilla ya no está disponible.')
  })

  it('aplica el patch sobre la última versión y preserva rico concurrente', async () => {
    const created = await createSessionTemplate('A', draft)
    const concurrent: SupportedSessionTemplate = {
      ...created,
      updatedAt: created.updatedAt + 10,
      payload: {
        ...created.payload,
        squashDetails: {
          trainingFocus: 'technical', drills: [{ name: 'nuevo' }],
        },
      },
    }
    await db.sessionTemplates.put(concurrent)
    const { draft: formDraft, originalsById } = templateToDraft(
      created.payload,
      '2026-07-14',
    )
    const updated = await updateSessionTemplate(
      created.id, created, { ...formDraft, title: 'Editada' }, originalsById, 'A',
    )
    expect(updated.payload.title).toBe('Editada')
    expect(updated.payload.squashDetails?.drills).toEqual([{ name: 'nuevo' }])
    expect(updated.updatedAt).toBeGreaterThan(concurrent.updatedAt)
  })

  it('una edición solo de duración conserva título y nombre concurrentes', async () => {
    const created = await createSessionTemplate('A', draft)
    const concurrent: SupportedSessionTemplate = {
      ...created,
      name: 'Nombre remoto',
      updatedAt: created.updatedAt + 10,
      payload: { ...created.payload, title: 'Título remoto' },
    }
    await db.sessionTemplates.put(concurrent)
    const { draft: formDraft, originalsById } = templateToDraft(
      created.payload,
      '2026-07-14',
    )
    const updated = await updateSessionTemplate(
      created.id,
      created,
      { ...formDraft, durationMin: 45 },
      originalsById,
      created.name,
    )
    expect(updated.name).toBe('Nombre remoto')
    expect(updated.payload.title).toBe('Título remoto')
    expect(updated.payload.durationMin).toBe(45)
  })

  it('updatedAt es monotónico con reloj congelado', async () => {
    const created = await createSessionTemplate('A', draft)
    vi.spyOn(Date, 'now').mockReturnValue(created.updatedAt)
    const { draft: formDraft, originalsById } = templateToDraft(
      created.payload,
      '2026-07-14',
    )
    const updated = await updateSessionTemplate(
      created.id, created, { ...formDraft, title: 'X' }, originalsById, 'A',
    )
    expect(updated.updatedAt).toBe(created.updatedAt + 1)
  })

  it('guardar desde planificación conserva rico y descarta ejecución', async () => {
    const session = {
      id: 's1', athleteId: 'ath1', date: '2026-07-14', weekStartDate: '2026-07-13',
      timeBlock: 'AM', type: 'squash', status: 'completed', title: 'Plan rica',
      durationMin: 60, createdAt: 1, updatedAt: 2, completedAt: 3, actualRpe: 8,
      squashDetails: {
        trainingFocus: 'technical', drills: [{ name: 'volea' }],
      },
    } as Session
    const created = await createSessionTemplateFromSession('  ', session)
    expect(created.name).toBe('Plan rica')
    expect(created.payload.squashDetails?.drills).toEqual([{ name: 'volea' }])
    expect(created.payload).not.toHaveProperty('completedAt')
    expect(created.payload).not.toHaveProperty('actualRpe')
  })
})

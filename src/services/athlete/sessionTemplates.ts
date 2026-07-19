import type { Session } from '../../types'
import {
  isSupportedSessionTemplate,
  SESSION_TEMPLATE_PAYLOAD_VERSION,
  type SessionTemplateExercise,
  type StoredSessionTemplate,
  type SupportedSessionTemplate,
} from '../../types/sessionTemplate'
import { db } from '../../db/db'
import { v4 as uuid } from '../../utils/uuid'
import { pushSessionTemplate } from '../syncService'
import type { CoachSessionDraft } from './coachSessionSerializer'
import {
  applyTemplatePatch,
  sessionToTemplatePayload,
  templateDraftToPatch,
  templateDraftToPayload,
} from './sessionTemplateSerializer'

const GONE_MESSAGE = 'Esta plantilla ya no está disponible.'

export class SessionTemplateGoneError extends Error {
  constructor(message = GONE_MESSAGE) {
    super(message)
    this.name = 'SessionTemplateGoneError'
  }
}

function nextStamp(previous: number): number {
  return Math.max(Date.now(), previous + 1)
}

export async function listSessionTemplates(): Promise<StoredSessionTemplate[]> {
  const rows = await db.sessionTemplates.toArray()
  return rows
    .filter((row) => row.deletedAt == null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function createSessionTemplate(
  name: string,
  draft: CoachSessionDraft,
): Promise<SupportedSessionTemplate> {
  const now = Date.now()
  const template: SupportedSessionTemplate = {
    id: uuid(),
    name: name.trim() || draft.title.trim(),
    kind: 'session',
    payloadVersion: SESSION_TEMPLATE_PAYLOAD_VERSION,
    payload: templateDraftToPayload(draft),
    createdAt: now,
    updatedAt: now,
  }
  await db.sessionTemplates.put(template)
  void pushSessionTemplate(template)
  return template
}

export async function updateSessionTemplate(
  id: string,
  openedVersion: SupportedSessionTemplate,
  draft: CoachSessionDraft,
  originalsById: Map<string, SessionTemplateExercise>,
  name: string,
): Promise<SupportedSessionTemplate> {
  // Re-read at submit time: updating a tombstone would otherwise resurrect it.
  const latest = await db.sessionTemplates.get(id)
  if (!latest || latest.deletedAt != null || !isSupportedSessionTemplate(latest)) {
    throw new SessionTemplateGoneError()
  }

  const visiblePatch = templateDraftToPatch(openedVersion.payload, draft, originalsById)
  const requestedName = name.trim() || draft.title.trim()
  const openedName = openedVersion.name.trim() || openedVersion.payload.title.trim()
  const updated: SupportedSessionTemplate = {
    ...latest,
    name: requestedName === openedName ? latest.name : requestedName,
    payload: applyTemplatePatch(latest.payload, visiblePatch, originalsById),
    updatedAt: nextStamp(latest.updatedAt),
  }
  await db.sessionTemplates.put(updated)
  void pushSessionTemplate(updated)
  return updated
}

export async function softDeleteSessionTemplate(id: string): Promise<void> {
  const latest = await db.sessionTemplates.get(id)
  if (!latest || latest.deletedAt != null) return
  const stamp = nextStamp(latest.updatedAt)
  const tombstone: StoredSessionTemplate = {
    ...latest,
    updatedAt: stamp,
    deletedAt: stamp,
  }
  await db.sessionTemplates.put(tombstone)
  void pushSessionTemplate(tombstone)
}

/** Save from Planning while retaining drills, blocks and other rich content. */
export async function createSessionTemplateFromSession(
  name: string,
  session: Session,
): Promise<SupportedSessionTemplate> {
  const now = Date.now()
  const template: SupportedSessionTemplate = {
    id: uuid(),
    name: name.trim() || session.title.trim(),
    kind: 'session',
    payloadVersion: SESSION_TEMPLATE_PAYLOAD_VERSION,
    payload: sessionToTemplatePayload(session),
    createdAt: now,
    updatedAt: now,
  }
  await db.sessionTemplates.put(template)
  void pushSessionTemplate(template)
  return template
}

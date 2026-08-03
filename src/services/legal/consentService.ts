import { db } from '../../db/db'
import type { ConsentAcceptance } from '../../types/consent'
import { supabase } from '../auth'
import {
  CONSENT_DOCUMENTS,
  ENTRY_DOCUMENT_IDS,
  getCurrentVersion,
  type ConsentDocumentId,
} from './consentDocuments'

const TABLE = 'user_consents'
const DOCUMENT_IDS = new Set<ConsentDocumentId>(CONSENT_DOCUMENTS.map((document) => document.id))

interface RemoteConsentRow {
  id: string
  user_id: string
  document: ConsentDocumentId
  version: string
  accepted_at: string
}

interface RemoteReadResult {
  ok: boolean
  rows: RemoteConsentRow[]
}

interface RemoteInsertResult {
  ok: boolean
  row?: RemoteConsentRow
  conflict: boolean
}

function parseRemoteRow(value: unknown): RemoteConsentRow | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (
    typeof row.id !== 'string'
    || typeof row.user_id !== 'string'
    || typeof row.document !== 'string'
    || !DOCUMENT_IDS.has(row.document as ConsentDocumentId)
    || typeof row.version !== 'string'
    || typeof row.accepted_at !== 'string'
  ) return null

  return {
    id: row.id,
    user_id: row.user_id,
    document: row.document as ConsentDocumentId,
    version: row.version,
    accepted_at: row.accepted_at,
  }
}

function toAcceptance(row: RemoteConsentRow): ConsentAcceptance {
  return {
    id: row.id,
    userId: row.user_id,
    document: row.document,
    version: row.version,
    acceptedAt: row.accepted_at,
  }
}

/** Compara por pertenencia exacta; las versiones son identificadores opacos. */
export async function getMissingConsents(
  userId: string,
  ids: readonly ConsentDocumentId[] = ENTRY_DOCUMENT_IDS,
): Promise<ConsentDocumentId[]> {
  const rows = await db.consentAcceptances.where('userId').equals(userId).toArray()
  const accepted = new Map<ConsentDocumentId, Set<string>>()

  for (const row of rows) {
    const versions = accepted.get(row.document) ?? new Set<string>()
    versions.add(row.version)
    accepted.set(row.document, versions)
  }

  return ids.filter((id) => !accepted.get(id)?.has(getCurrentVersion(id)))
}

/**
 * Indica si al menos un documento faltante ya tuvo otra versión aceptada.
 * Permite explicar que se trata de una actualización y no de un error del gate.
 */
export async function hasAnyPreviousAcceptance(
  userId: string,
  documents: readonly ConsentDocumentId[],
): Promise<boolean> {
  const rows = await db.consentAcceptances.where('userId').equals(userId).toArray()
  return documents.some((document) => rows.some(
    (row) => row.document === document && row.version !== getCurrentVersion(document),
  ))
}

export async function fetchRemoteConsents(userId: string): Promise<RemoteReadResult> {
  if (!supabase) return { ok: false, rows: [] }
  const { data, error } = await supabase
    .from(TABLE)
    .select('id,user_id,document,version,accepted_at')
    .eq('user_id', userId)

  if (error || !data) return { ok: false, rows: [] }
  return {
    ok: true,
    rows: (data as unknown[]).map(parseRemoteRow).filter((row): row is RemoteConsentRow => row != null),
  }
}

async function insertRemoteConsent(
  userId: string,
  document: ConsentDocumentId,
  version: string,
): Promise<RemoteInsertResult> {
  if (!supabase) return { ok: false, conflict: false }
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ user_id: userId, document, version })
    .select('id,user_id,document,version,accepted_at')
    .single()

  if (error) return { ok: false, conflict: error.code === '23505' }
  const row = parseRemoteRow(data)
  return row ? { ok: true, row, conflict: false } : { ok: false, conflict: false }
}

/** Solo persiste localmente filas que Supabase devolvió y validó. */
export async function hydrateConsents(userId: string): Promise<{ ok: boolean }> {
  const remote = await fetchRemoteConsents(userId)
  if (!remote.ok) return { ok: false }

  const mine = remote.rows.filter((row) => row.user_id === userId)
  try {
    if (mine.length > 0) await db.consentAcceptances.bulkPut(mine.map(toAcceptance))
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

/**
 * Revalida una versión contra Supabase, sin confiar en un espejo local que
 * podría haber quedado por delante del servidor que acaba de rechazarla.
 */
export async function verifyCurrentConsentRemotely(
  userId: string,
  document: ConsentDocumentId,
): Promise<{ ok: boolean; current: boolean }> {
  const remote = await fetchRemoteConsents(userId)
  if (!remote.ok) return { ok: false, current: false }

  const mine = remote.rows.filter((row) => row.user_id === userId)
  const exact = mine.find((row) => (
    row.document === document && row.version === getCurrentVersion(document)
  ))

  try {
    if (mine.length > 0) await db.consentAcceptances.bulkPut(mine.map(toAcceptance))
    return { ok: true, current: exact != null }
  } catch {
    return { ok: false, current: false }
  }
}

/** Escribe un documento por request; un 23505 solo vale tras verificar la fila exacta. */
export async function acceptConsent(
  userId: string,
  document: ConsentDocumentId,
): Promise<{ ok: boolean }> {
  const version = getCurrentVersion(document)
  const inserted = await insertRemoteConsent(userId, document, version)

  if (inserted.ok && inserted.row) {
    if (inserted.row.user_id !== userId || inserted.row.document !== document || inserted.row.version !== version) {
      return { ok: false }
    }
    try {
      await db.consentAcceptances.put(toAcceptance(inserted.row))
      return { ok: true }
    } catch {
      return { ok: false }
    }
  }

  if (!inserted.conflict) return { ok: false }

  const remote = await fetchRemoteConsents(userId)
  if (!remote.ok) return { ok: false }
  const exact = remote.rows.find((row) => (
    row.user_id === userId && row.document === document && row.version === version
  ))
  if (!exact) return { ok: false }

  try {
    await db.consentAcceptances.put(toAcceptance(exact))
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

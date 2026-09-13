import { db } from '../../db/db'
import { getLegacyAthleteScopeBackfillTables } from '../../db/athleteScopedTables'
import { isScopedAthleteId } from './effectiveAthleteKey'
import { isClaimPending } from './claimGate'
import { getAccountRole } from '../entitlements/accountRoleHolder'
import { roleOwnsLegacySelfData } from './athleteScopeKind'
import { getSelfMembership, putLocalMembership } from './membershipCache'

const BACKFILL_MARKER_KEY_PREFIX = 'entrenador_athlete_scope_backfill_v2'
const IMPORT_DIRTY_MARKER_KEY = 'entrenador_athlete_scope_import_dirty_v1'

/** Deterministic athlete id for an owner account. Mirrors the SQL backfill ('ath_' || user_id). */
export function athleteIdForOwner(ownerAccountId: string): string {
  return `ath_${ownerAccountId}`
}

/** A row is pending scope when it has no athleteId or still holds ATHLETE_PROFILE_LOCAL_ID. */
function isPending(athleteId: string | null | undefined): boolean {
  return !isScopedAthleteId(athleteId)
}

// Minimal structural view of a Dexie table — avoids Dexie's invariant Table<T>
// generics across heterogeneous stores while keeping the test fakes compatible.
interface ScopableRow {
  id: string
  athleteId?: string
  updatedAt?: number
  date?: string
  weekStartDate?: string
}
interface ScopableTable {
  toArray(): Promise<ScopableRow[]>
  bulkPut(rows: ScopableRow[]): Promise<unknown>
}

/**
 * Las dos claves naturales que se volvieron athlete-scoped en Dexie v14. Al
 * estampar una fila legacy, puede chocar con una fila ya scoped de otra sesión
 * de sync aunque sus `id` sean distintos. Esa fila se deja legacy en este paso
 * aditivo: Dexie mantiene su índice único y el sync posterior decide el LWW.
 */
function scopedNaturalKeyFor(
  table: ScopableTable,
  row: ScopableRow,
): string | undefined {
  if (table === (db.dayLogs as unknown as ScopableTable)) return row.date ? `day:${row.date}` : undefined
  if (table === (db.weekSummaries as unknown as ScopableTable)) {
    return row.weekStartDate ? `week:${row.weekStartDate}` : undefined
  }
  return undefined
}

async function patchTable(table: ScopableTable, athleteId: string): Promise<number> {
  const rows = await table.toArray()
  const pending = rows
    .filter((row) => isPending(row.athleteId))
  const scopedNaturalKeys = new Set(
    rows
      .filter((row) => row.athleteId === athleteId)
      .map((row) => scopedNaturalKeyFor(table, row))
      .filter((key): key is string => key != null),
  )

  // El backfill es aditivo: una legacy que chocaría con un índice compuesto
  // ya scoped se deja intacta. La migración inicial coalesce su payload y el
  // full sync siguiente tiene la reparación durable/LWW transaccional; borrar
  // o elegir una ganadora aquí perdería datos antes de poder sincronizarlos.
  const patched = pending
    .filter((row) => {
      const key = scopedNaturalKeyFor(table, row)
      return key == null || !scopedNaturalKeys.has(key)
    })
    .map((row) => ({ ...row, athleteId }))
  if (patched.length) await table.bulkPut(patched)
  return patched.length
}

function backfillMarkerKey(ownerAccountId: string): string {
  return `${BACKFILL_MARKER_KEY_PREFIX}:${ownerAccountId}`
}

function isBackfillMarkedComplete(ownerAccountId: string, athleteId: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    if (localStorage.getItem(IMPORT_DIRTY_MARKER_KEY) === '1') return false
    return localStorage.getItem(backfillMarkerKey(ownerAccountId)) === athleteId
  } catch {
    return false
  }
}

/**
 * Permite a lecturas sensibles a legacy evitar escaneos históricos cuando el
 * backfill ya terminó. Las únicas filas legacy que pueden quedar tras ese paso
 * son colisiones con una fila scoped de la misma clave natural.
 */
export function isAthleteScopeBackfillComplete(
  ownerAccountId: string,
  athleteId: string,
): boolean {
  return isBackfillMarkedComplete(ownerAccountId, athleteId)
}

function markBackfillComplete(ownerAccountId: string, athleteId: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(backfillMarkerKey(ownerAccountId), athleteId)
    localStorage.removeItem(IMPORT_DIRTY_MARKER_KEY)
  } catch {
    // localStorage may be unavailable in private/SSR contexts; the backfill stays safe and idempotent.
  }
}

export function invalidateBackfillMarker(ownerAccountId: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(backfillMarkerKey(ownerAccountId))
  } catch {
    // localStorage may be unavailable in private/SSR contexts.
  }
}

export function markBackfillDirtyAfterImport(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(IMPORT_DIRTY_MARKER_KEY, '1')
  } catch {
    // localStorage may be unavailable in private/SSR contexts.
  }
}

async function patchScopableTables(athleteId: string): Promise<number> {
  const tables = getLegacyAthleteScopeBackfillTables() as unknown as ScopableTable[]
  let patched = 0
  for (const table of tables) patched += await patchTable(table, athleteId)
  return patched
}

/**
 * Idempotent local backfill: ensure the owner's athlete row exists and stamp
 * athleteId on legacy rows that lack it. Mirrors Supabase migration 007 for
 * Dexie. Forward-only and additive: never deletes data, never touches user_id.
 *
 * Devuelve `null` cuando NO hay self que hidratar: claim pendiente, o cuenta
 * coach confirmada (spec §6: un coach nunca tiene self; el trigger de 030
 * rechazaría el push y `pullAthletes` abortaría el sync). Todo llamador trata
 * `null` como «no hidrates el scope self» — `ensureRemoteAthleteOnce` ya lo
 * hacía para el claim.
 */
export async function backfillLocalAthleteScope(ownerAccountId: string): Promise<string | null> {
  if (isClaimPending()) return null
  if (!roleOwnsLegacySelfData(getAccountRole())) return null
  const selfMembership = await getSelfMembership(ownerAccountId)
  if (selfMembership && selfMembership.athleteId !== athleteIdForOwner(ownerAccountId)) {
    return selfMembership.athleteId
  }
  const athleteId = athleteIdForOwner(ownerAccountId)
  const now = Date.now()
  const existing = await db.athletes.get(athleteId)
  await db.athletes.put({
    id: athleteId,
    ownerAccountId,
    linkedAccountId: ownerAccountId,
    status: existing?.status ?? 'active',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  })
  // El servidor siembra `self` en el insert (013b) y `031` lo backfilleó para
  // todas las cuentas; el espejo lo anticipa para que la elegibilidad local no
  // dependa del primer pull.
  await putLocalMembership(ownerAccountId, athleteId, 'self')
  if (!existing || !isBackfillMarkedComplete(ownerAccountId, athleteId)) {
    await patchScopableTables(athleteId)
    markBackfillComplete(ownerAccountId, athleteId)
  }
  return athleteId
}

// ─── Dry-run (pure) ───────────────────────────────────────────────────────────

export interface ScopeSnapshot {
  tables: Record<string, Array<{ athleteId?: string | null }>>
}

export interface ScopeMigrationReport {
  perTable: Record<string, { total: number; toMap: number; alreadyMapped: number }>
  totalToMap: number
}

/**
 * Pure dry-run: report how many rows per table still need an athleteId, without
 * mutating anything. Used by the dev pre-check script (scripts/migrate-dry-run.ts)
 * so the migration can be validated BEFORE the automatic Dexie upgrade runs.
 */
export function planAthleteScopeMigration(snapshot: ScopeSnapshot): ScopeMigrationReport {
  const perTable: ScopeMigrationReport['perTable'] = {}
  let totalToMap = 0
  for (const [table, rows] of Object.entries(snapshot.tables)) {
    const toMap = rows.filter((row) => isPending(row.athleteId)).length
    perTable[table] = { total: rows.length, toMap, alreadyMapped: rows.length - toMap }
    totalToMap += toMap
  }
  return { perTable, totalToMap }
}

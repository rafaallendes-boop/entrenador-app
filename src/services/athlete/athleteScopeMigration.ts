import { db } from '../../db/db'
import { isScopedAthleteId } from './effectiveAthleteKey'
import { isClaimPending } from './claimGate'
import { getSelfMembership } from './membershipCache'

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
}
interface ScopableTable {
  toArray(): Promise<ScopableRow[]>
  bulkPut(rows: ScopableRow[]): Promise<unknown>
}

async function patchTable(table: ScopableTable, athleteId: string): Promise<number> {
  const rows = await table.toArray()
  const patched = rows
    .filter((row) => isPending(row.athleteId))
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
  const tables = [
    db.sessions,
    db.dayLogs,
    db.weekSummaries,
    db.chatMessages,
    db.coachProposals,
    db.athleteProfiles,
    db.trainingPlans,
    db.trainingPlanWeeks,
    db.planGenerationJobs,
  ] as unknown as ScopableTable[]
  let patched = 0
  for (const table of tables) patched += await patchTable(table, athleteId)
  return patched
}

/**
 * Idempotent local backfill: ensure the owner's athlete row exists and stamp
 * athleteId on legacy rows that lack it (or still hold ATHLETE_PROFILE_LOCAL_ID). Mirrors the
 * Supabase migration 007 for the local Dexie store. Forward-only and additive:
 * it never deletes data and never touches user_id.
 *
 * The row-patching scan runs until a local completion marker is written. This
 * repairs partial beta backfills where the athlete row exists but legacy rows
 * are still unscoped, while keeping later startups O(1).
 */
export async function backfillLocalAthleteScope(ownerAccountId: string): Promise<string | null> {
  if (isClaimPending()) return null
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

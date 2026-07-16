/**
 * Thin wrappers around the Supabase client used by the sync layer.
 *
 * Centralised so that:
 * - There is a single `getSupabase()` that fails loudly with a typed category
 *   when the env is misconfigured.
 * - All paginated reads go through `fetchAll()` (handles `.range` fallback).
 * - All direct requests can be wrapped with a timeout to avoid hanging the
 *   drain queue indefinitely.
 */

import { supabase } from '../auth'
import type { SupabaseTable, SyncErrorCategory } from '../syncUtils'
import { resolveReadScope, type ReadScope } from '../athlete/readScope'
import { getMembershipAthleteIds } from '../athlete/membershipCache'
import { getAthleteDeleteTombstoneSnapshot } from './athleteDeleteTombstones'
import { getRemoteRowAthleteId } from './remoteRowAthleteId'

/** Page size for paginated remote fetches via `.range(from, to)`. */
export const FETCH_PAGE_SIZE = 1000

/**
 * Timeout máximo para un request directo a Supabase (upsert/delete/fetch).
 * Evita que un request colgado bloquee drainQueue indefinidamente.
 */
export const DIRECT_REQUEST_TIMEOUT_MS = 15_000

export function getSupabase() {
  if (!supabase) {
    throw Object.assign(
      new TypeError('Supabase client is null — VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing'),
      { category: 'supabase_not_configured' as SyncErrorCategory },
    )
  }
  return supabase
}

/**
 * Envuelve una promesa con un timeout que rechaza si no resuelve a tiempo.
 * El error lanzado es clasificable como network_error por classifySyncError.
 */
export async function withRequestTimeout<T>(
  source: PromiseLike<T>,
  label: string,
  timeoutMs = DIRECT_REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(Object.assign(new Error(`Sync request timeout after ${timeoutMs}ms: ${label}`), {
        name: 'SyncRequestTimeoutError',
      }))
    }, timeoutMs)
  })
  try {
    return await Promise.race([Promise.resolve(source), timeoutPromise])
  } finally {
    if (timeoutHandle != null) clearTimeout(timeoutHandle)
  }
}

/**
 * Pagina la lectura de una tabla por user_id.
 * Si el cliente no expone `.range`, hace una sola pasada (compat con tests/mocks).
 */
export function buildPullFilter(
  table: SupabaseTable,
  userId: string,
  memberAthleteIds: string[],
  scope: ReadScope,
):
  | { kind: 'or'; value: string }
  | { kind: 'eq_user' }
  | { kind: 'eq_owner' }
  | { kind: 'in_athletes'; value: string[] }
  | { kind: 'skip' } {
  if (table === 'athletes') {
    return memberAthleteIds.length > 0
      ? { kind: 'or', value: `id.in.(${memberAthleteIds.join(',')}),owner_account_id.eq.${userId}` }
      : { kind: 'eq_owner' }
  }
  if (table === 'athlete_memberships') return { kind: 'skip' }
  if (table === 'athlete_coach_notes') {
    if (memberAthleteIds.length > 0) return { kind: 'in_athletes', value: memberAthleteIds }
    if (scope.mode === 'athlete') return { kind: 'in_athletes', value: [scope.athleteId] }
    return { kind: 'skip' }
  }
  if (memberAthleteIds.length > 0) {
    return {
      kind: 'or',
      value: `athlete_id.in.(${memberAthleteIds.join(',')}),and(athlete_id.is.null,user_id.eq.${userId})`,
    }
  }
  if (scope.mode === 'athlete') {
    return {
      kind: 'or',
      value: `athlete_id.eq.${scope.athleteId},and(athlete_id.is.null,user_id.eq.${userId})`,
    }
  }
  return { kind: 'eq_user' }
}

export async function fetchAll<T>(
  table: SupabaseTable,
  userId: string,
  scope: ReadScope = resolveReadScope(),
): Promise<T[]> {
  const rows: T[] = []
  const memberAthleteIds = await getMembershipAthleteIds(userId)
  const filter = buildPullFilter(table, userId, memberAthleteIds, scope)
  if (filter.kind === 'skip') return rows
  // Athlete Scope Foundation (Fase D): when the flag is on AND an athlete is
  // hydrated, scope by athlete_id but keep legacy rows (athlete_id IS NULL) so
  // flipping the flag never hides existing data. Flag off → identical to before.

  for (let from = 0; ; from += FETCH_PAGE_SIZE) {
    const to = from + FETCH_PAGE_SIZE - 1
    const base = getSupabase()
      .from(table)
      .select('*')
    const query = filter.kind === 'eq_owner'
      ? base.eq('owner_account_id', userId)
      : filter.kind === 'in_athletes'
      ? base.in('athlete_id', filter.value)
      : filter.kind === 'or'
      ? base.or(filter.value)
      : base.eq('user_id', userId)
    const supportsRange = typeof (query as { range?: unknown }).range === 'function'
    const pagedQuery = supportsRange
      ? (query as { range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }> }).range(from, to)
      : query as PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }>
    const { data, error } = await pagedQuery

    if (error) {
      console.error(`[sync] fetch error on ${table}:`, error.message)
      throw error
    }

    const page = (data ?? []) as T[]
    // Un snapshot por página mantiene el costo O(keys + filas), y se refresca
    // después de cada await de red para observar deletes iniciados entretanto.
    const tombstones = getAthleteDeleteTombstoneSnapshot()
    const alive = page.filter((row) => {
      if (!row || typeof row !== 'object') return true
      const athleteId = getRemoteRowAthleteId(row as Record<string, unknown>)
      return !athleteId || !tombstones.has(userId, athleteId)
    })
    rows.push(...alive)
    if (!supportsRange || page.length < FETCH_PAGE_SIZE) break
  }

  return rows
}

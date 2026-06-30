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
import { resolveReadScope } from '../athlete/readScope'

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
export async function fetchAll<T>(table: SupabaseTable, userId: string): Promise<T[]> {
  const rows: T[] = []
  // Athlete Scope Foundation (Fase D): when the flag is on AND an athlete is
  // hydrated, scope by athlete_id but keep legacy rows (athlete_id IS NULL) so
  // flipping the flag never hides existing data. Flag off → identical to before.
  const scope = resolveReadScope()

  for (let from = 0; ; from += FETCH_PAGE_SIZE) {
    const to = from + FETCH_PAGE_SIZE - 1
    const base = getSupabase()
      .from(table)
      .select('*')
    const query = table === 'athletes'
      ? base.eq('owner_account_id', userId)
      : scope.mode === 'athlete'
      ? base.or(`athlete_id.eq.${scope.athleteId},and(athlete_id.is.null,user_id.eq.${userId})`)
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
    rows.push(...page)
    if (!supportsRange || page.length < FETCH_PAGE_SIZE) break
  }

  return rows
}

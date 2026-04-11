import type { DayLog, WeekSummary } from '../types'
import { scoreEntityData } from './syncUtils'

export interface MergeResolution<T extends { id: string }> {
  winner: T
  loserId?: string
}

export type SyncFailureStatus = 'idle' | 'offline' | 'error'

export function isLikelyOfflineError(error: unknown, isOnline: boolean): boolean {
  if (!isOnline) return true

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('load failed') ||
    message.includes('offline') ||
    message.includes('timed out') ||
    message.includes('timeout')
  )
}

export function isInfrastructureError(error: unknown): boolean {
  const obj = error as Record<string, unknown> | null
  if (!obj) return false

  if (typeof obj.code === 'string' && obj.code === '42P01') return true
  if (typeof obj.code === 'string' && obj.code.startsWith('PGRST')) return true

  const statusCode = typeof obj.status === 'number' ? obj.status : null
  if (statusCode === 401 || statusCode === 403 || statusCode === 404) return true

  const message = (
    (error instanceof Error ? error.message : '') +
    (typeof obj.message === 'string' ? obj.message : '') +
    (typeof obj.details === 'string' ? obj.details : '') +
    (typeof obj.hint === 'string' ? obj.hint : '')
  ).toLowerCase()

  return (
    (message.includes('relation') && message.includes('does not exist')) ||
    message.includes('undefined_table') ||
    (message.includes('schema') && message.includes('not found')) ||
    message.includes('invalid api key') ||
    message.includes('jwt') ||
    message.includes('anon key') ||
    message.includes('not authorized') ||
    (message.includes('permission') && message.includes('denied')) ||
    message.includes('does not have permission')
  )
}

export function getSyncErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

export function resolveSyncFailureStatus(error: unknown, isOnline: boolean): SyncFailureStatus {
  if (isInfrastructureError(error)) return 'idle'
  if (isLikelyOfflineError(error, isOnline)) return 'offline'
  return 'error'
}

export function resolveDayLogConflict(local: DayLog | undefined, remote: DayLog): MergeResolution<DayLog> {
  if (!local) {
    return { winner: remote }
  }

  if (remote.updatedAt > local.updatedAt) {
    return { winner: remote, loserId: local.id !== remote.id ? local.id : undefined }
  }

  if (local.updatedAt > remote.updatedAt) {
    return { winner: local, loserId: local.id !== remote.id ? remote.id : undefined }
  }

  if (scoreEntityData(remote) > scoreEntityData(local)) {
    return { winner: remote, loserId: local.id !== remote.id ? local.id : undefined }
  }

  return { winner: local, loserId: local.id !== remote.id ? remote.id : undefined }
}

export function resolveWeekSummaryConflict(
  local: WeekSummary | undefined,
  remote: WeekSummary,
  remoteUpdatedAt: number,
): MergeResolution<WeekSummary> {
  if (!local) {
    return { winner: remote }
  }

  const localUpdatedAt = getWeekSummaryUpdatedAt(local)
  if (remoteUpdatedAt > localUpdatedAt) {
    return { winner: remote, loserId: local.id !== remote.id ? local.id : undefined }
  }

  if (localUpdatedAt > remoteUpdatedAt) {
    return { winner: local, loserId: local.id !== remote.id ? remote.id : undefined }
  }

  if (scoreEntityData(remote) > scoreEntityData(local)) {
    return { winner: remote, loserId: local.id !== remote.id ? local.id : undefined }
  }

  return { winner: local, loserId: local.id !== remote.id ? remote.id : undefined }
}

export function compareDayLogsForRepair(a: DayLog, b: DayLog): number {
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
  return scoreEntityData(b) - scoreEntityData(a)
}

export function compareWeekSummariesForRepair(a: WeekSummary, b: WeekSummary): number {
  const aUpdatedAt = getWeekSummaryUpdatedAt(a)
  const bUpdatedAt = getWeekSummaryUpdatedAt(b)
  if (bUpdatedAt !== aUpdatedAt) return bUpdatedAt - aUpdatedAt
  return scoreEntityData(b) - scoreEntityData(a)
}

export function getWeekSummaryUpdatedAt(summary: WeekSummary): number {
  return ((summary as unknown as { updatedAt?: number }).updatedAt) ?? 0
}

export function groupRowsBy<T>(rows: T[], getKey: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()

  for (const row of rows) {
    const key = getKey(row)
    const existing = groups.get(key)
    if (existing) existing.push(row)
    else groups.set(key, [row])
  }

  return groups
}

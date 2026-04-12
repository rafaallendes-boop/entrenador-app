import { addDays } from 'date-fns'

import type { Session, TimeBlock } from '../types'
import { fromISO, toISO } from '../utils/date'

export interface SlotAdherenceStats {
  plannedCount: number
  completedCount: number
  adherencePct: number
}

export type SlotAdherenceProfile = Record<string, SlotAdherenceStats>

function getSlotKey(dateISO: string, timeBlock: TimeBlock): string {
  const weekday = new Date(`${dateISO}T12:00:00`).getDay()
  return `${weekday}-${timeBlock}`
}

export function buildSlotAdherenceProfile(
  historicalSessions: Session[],
  referenceDateISO: string,
  weeks = 8,
): SlotAdherenceProfile {
  const cutoff = toISO(addDays(fromISO(referenceDateISO), -(weeks * 7)))
  const counts = new Map<string, { plannedCount: number; completedCount: number }>()

  for (const session of historicalSessions) {
    if (session.date < cutoff || session.date >= referenceDateISO) continue
    if (session.status === 'skipped') continue

    const key = getSlotKey(session.date, session.timeBlock)
    const current = counts.get(key) ?? { plannedCount: 0, completedCount: 0 }
    current.plannedCount += 1
    if (session.status === 'completed' || session.status === 'adjusted') {
      current.completedCount += 1
    }
    counts.set(key, current)
  }

  return Object.fromEntries(
    [...counts.entries()].map(([key, value]) => [
      key,
      {
        plannedCount: value.plannedCount,
        completedCount: value.completedCount,
        adherencePct: value.plannedCount > 0
          ? Math.round((value.completedCount / value.plannedCount) * 100)
          : 0,
      },
    ]),
  )
}

export function getSlotAdherenceStats(
  profile: SlotAdherenceProfile,
  dateISO: string,
  timeBlock: TimeBlock,
): SlotAdherenceStats | undefined {
  return profile[getSlotKey(dateISO, timeBlock)]
}

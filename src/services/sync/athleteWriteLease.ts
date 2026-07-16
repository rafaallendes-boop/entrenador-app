import { hasAthleteDeleteTombstoneForAthlete } from './athleteDeleteTombstones'

const athleteDeletionBarriers = new Set<string>()
const inFlightAthleteOps = new Map<string, Set<Promise<unknown>>>()

export function acquireAthleteDeletionBarrier(athleteId: string): (() => void) | null {
  if (athleteDeletionBarriers.has(athleteId)) return null
  athleteDeletionBarriers.add(athleteId)
  let released = false
  return () => {
    if (released) return
    released = true
    athleteDeletionBarriers.delete(athleteId)
  }
}

export function trackInFlightAthleteOp<T>(
  athleteId: string | null,
  operation: Promise<T>,
): Promise<T> {
  if (!athleteId) return operation
  let bucket = inFlightAthleteOps.get(athleteId)
  if (!bucket) {
    bucket = new Set()
    inFlightAthleteOps.set(athleteId, bucket)
  }
  const owner = bucket
  const tracked = operation.finally(() => {
    owner.delete(tracked)
    if (owner.size === 0 && inFlightAthleteOps.get(athleteId) === owner) {
      inFlightAthleteOps.delete(athleteId)
    }
  })
  owner.add(tracked)
  return tracked
}

export async function waitForInFlightAthleteOps(athleteId: string): Promise<void> {
  for (;;) {
    const bucket = inFlightAthleteOps.get(athleteId)
    if (!bucket || bucket.size === 0) return
    await Promise.allSettled([...bucket])
  }
}

/**
 * Chequea el tombstone y registra la operacion en el mismo tick. `run` empieza
 * en la microtask siguiente, cuando el lease ya es visible para la barrera.
 */
export function withAthleteWriteLease<T>(
  athleteId: string | null,
  run: () => Promise<T>,
): Promise<T> | null {
  if (athleteId && hasAthleteDeleteTombstoneForAthlete(athleteId)) return null
  return trackInFlightAthleteOp(athleteId, Promise.resolve().then(run))
}

/** Forma canónica para consumidores async que solo necesitan saber si hubo veto. */
export async function runAthleteWrite<T>(
  athleteId: string | null | undefined,
  run: () => Promise<T>,
): Promise<boolean> {
  const operation = withAthleteWriteLease(athleteId ?? null, run)
  if (!operation) return false
  await operation
  return true
}

/** Variante atomica multi-atleta para reemplazos batch. */
export function withAthleteWriteLeases<T>(
  athleteIds: string[],
  run: () => Promise<T>,
): Promise<T> | null {
  const unique = [...new Set(athleteIds.filter(Boolean))]
  if (unique.some((athleteId) => hasAthleteDeleteTombstoneForAthlete(athleteId))) return null

  let tracked = Promise.resolve().then(run)
  for (const athleteId of unique) {
    tracked = trackInFlightAthleteOp(athleteId, tracked)
  }
  return tracked
}

export async function runAthleteWrites<T>(
  athleteIds: string[],
  run: () => Promise<T>,
): Promise<boolean> {
  const operation = withAthleteWriteLeases(athleteIds, run)
  if (!operation) return false
  await operation
  return true
}

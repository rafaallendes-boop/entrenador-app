export interface HydrationTicket {
  key: string
  registryEpoch: number
  keyGeneration: number
}

const hydrated = new Set<string>()
const inFlight = new Map<string, Promise<void>>()
const generations = new Map<string, number>()
let registryEpoch = 0

const hydrationKey = (ownerAccountId: string, athleteId: string, weekStartDate: string): string => (
  JSON.stringify([ownerAccountId, athleteId, weekStartDate])
)

function isCurrent(ticket: HydrationTicket): boolean {
  return ticket.registryEpoch === registryEpoch
    && generations.get(ticket.key) === ticket.keyGeneration
}

export function beginHydration(
  ownerAccountId: string,
  athleteId: string,
  weekStartDate: string,
): HydrationTicket {
  const key = hydrationKey(ownerAccountId, athleteId, weekStartDate)
  const keyGeneration = (generations.get(key) ?? 0) + 1
  generations.set(key, keyGeneration)
  hydrated.delete(key)
  return { key, registryEpoch, keyGeneration }
}

export function completeHydration(ticket: HydrationTicket): void {
  if (isCurrent(ticket)) hydrated.add(ticket.key)
}

export function failHydration(ticket: HydrationTicket): void {
  if (isCurrent(ticket)) hydrated.delete(ticket.key)
}

export function getHydrationInFlight(
  ownerAccountId: string,
  athleteId: string,
  weekStartDate: string,
): Promise<void> | undefined {
  return inFlight.get(hydrationKey(ownerAccountId, athleteId, weekStartDate))
}

export function setHydrationInFlight(ticket: HydrationTicket, operation: Promise<void>): void {
  if (isCurrent(ticket)) inFlight.set(ticket.key, operation)
}

export function finishHydration(ticket: HydrationTicket, operation: Promise<void>): void {
  if (inFlight.get(ticket.key) === operation) inFlight.delete(ticket.key)
}

export function hasHydrationMark(
  ownerAccountId: string,
  athleteId: string,
  weekStartDate: string,
): boolean {
  return hydrated.has(hydrationKey(ownerAccountId, athleteId, weekStartDate))
}

export function isWeekHydrated(
  ownerAccountId: string,
  athleteId: string,
  weekStartDate: string,
): boolean {
  return hasHydrationMark(ownerAccountId, athleteId, weekStartDate)
}

export function clearCoachPlanningHydrationRegistry(athleteId?: string): void {
  if (athleteId === undefined) {
    registryEpoch += 1
    hydrated.clear()
    inFlight.clear()
    generations.clear()
    return
  }

  const knownKeys = new Set([...hydrated, ...inFlight.keys(), ...generations.keys()])
  for (const key of knownKeys) {
    let keyAthleteId: unknown
    try {
      keyAthleteId = (JSON.parse(key) as unknown[])[1]
    } catch {
      continue
    }
    if (keyAthleteId !== athleteId) continue
    hydrated.delete(key)
    inFlight.delete(key)
    generations.set(key, (generations.get(key) ?? 0) + 1)
  }
}

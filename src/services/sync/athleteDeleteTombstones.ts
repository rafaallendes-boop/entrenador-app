/**
 * Tombstones durables para el borrado definitivo de atletas.
 *
 * Cada intento crea una key propia. De este modo, el rollback de un intento
 * solo puede retirar su tombstone y nunca el de otro delete concurrente.
 * El espejo mantiene visibles los tombstones creados en esta pestaña cuando
 * localStorage deja de ser legible.
 */
export const ATHLETE_DELETE_TOMBSTONE_PREFIX = 'entrenador_athlete_delete_tombstone_v1'

const memoryMirror = new Set<string>()
const durableKeyIndex = new Set<string>()
let indexedStorage: Storage | null = null
let durableIndexHydrated = false
let tokenSequence = 0

export interface AthleteDeleteTombstoneSnapshot {
  has(userId: string, athleteId: string): boolean
  hasAthlete(athleteId: string): boolean
  hasAny(): boolean
}

type ReadResult =
  | { ok: true; value: string | null }
  | { ok: false }

function pairPrefix(userId: string, athleteId: string): string {
  return `${ATHLETE_DELETE_TOMBSTONE_PREFIX}:${userId}:${athleteId}:`
}

function readKey(key: string): ReadResult {
  try {
    return { ok: true, value: localStorage.getItem(key) }
  } catch {
    return { ok: false }
  }
}

function createToken(): string {
  tokenSequence += 1
  return `${Date.now()}-${tokenSequence.toString(36)}-${Math.random().toString(36).slice(2)}`
}

function ensureDurableIndex(): void {
  let storage: Storage
  try {
    storage = localStorage
  } catch {
    return
  }
  if (indexedStorage !== storage) {
    indexedStorage = storage
    durableIndexHydrated = false
    durableKeyIndex.clear()
  }
  if (durableIndexHydrated) return

  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key?.startsWith(`${ATHLETE_DELETE_TOMBSTONE_PREFIX}:`)) durableKeyIndex.add(key)
    }
    durableIndexHydrated = true
  } catch {
    // El espejo sigue protegiendo los tombstones creados en esta pestaña.
  }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.storageArea && indexedStorage && event.storageArea !== indexedStorage) return
    if (event.key == null) {
      durableKeyIndex.clear()
      durableIndexHydrated = false
      return
    }
    if (!event.key.startsWith(`${ATHLETE_DELETE_TOMBSTONE_PREFIX}:`)) return
    if (event.newValue == null) durableKeyIndex.delete(event.key)
    else durableKeyIndex.add(event.key)
  })
}

/**
 * Vista indexada para hot paths. Enumera localStorage una sola vez y conserva
 * una referencia viva al espejo, de modo que un delete iniciado en esta misma
 * pestaña después de crear el snapshot también sea visible.
 */
export function getAthleteDeleteTombstoneSnapshot(): AthleteDeleteTombstoneSnapshot {
  ensureDurableIndex()
  const matches = (predicate: (key: string) => boolean): boolean => {
    for (const key of memoryMirror) if (predicate(key)) return true
    for (const key of durableKeyIndex) if (predicate(key)) return true
    return false
  }
  return {
    has(userId, athleteId) {
      const prefix = pairPrefix(userId, athleteId)
      return matches((key) => key.startsWith(prefix))
    },
    hasAthlete(athleteId) {
      return matches((key) => (
        key.startsWith(`${ATHLETE_DELETE_TOMBSTONE_PREFIX}:`)
        && key.split(':')[2] === athleteId
      ))
    },
    hasAny() {
      return memoryMirror.size > 0 || durableKeyIndex.size > 0
    },
  }
}

export function rememberAthleteDeleteTombstone(userId: string, athleteId: string): string {
  const token = createToken()
  const key = `${pairPrefix(userId, athleteId)}${token}`
  localStorage.setItem(key, '1')

  const check = readKey(key)
  if (!check.ok || check.value == null) {
    throw new Error('No se pudo persistir el tombstone de borrado del atleta.')
  }

  memoryMirror.add(key)
  ensureDurableIndex()
  durableKeyIndex.add(key)
  return token
}

/** Retira solo el tombstone de este intento y verifica su ausencia. */
export function clearAthleteDeleteTombstone(
  userId: string,
  athleteId: string,
  token: string,
): boolean {
  const key = `${pairPrefix(userId, athleteId)}${token}`
  const before = readKey(key)
  if (!before.ok || before.value == null) return false

  try {
    localStorage.removeItem(key)
  } catch {
    return false
  }

  const after = readKey(key)
  if (!after.ok || after.value != null) return false

  memoryMirror.delete(key)
  durableKeyIndex.delete(key)
  return true
}

export function hasAthleteDeleteTombstone(userId: string, athleteId: string): boolean {
  ensureDurableIndex()
  const prefix = pairPrefix(userId, athleteId)
  for (const key of memoryMirror) if (key.startsWith(prefix)) return true
  for (const key of durableKeyIndex) if (key.startsWith(prefix)) return true
  return false
}

export function hasAthleteDeleteTombstoneForAthlete(athleteId: string): boolean {
  ensureDurableIndex()
  const matches = (key: string): boolean => (
    key.startsWith(`${ATHLETE_DELETE_TOMBSTONE_PREFIX}:`)
    && key.split(':')[2] === athleteId
  )
  for (const key of memoryMirror) if (matches(key)) return true
  for (const key of durableKeyIndex) if (matches(key)) return true
  return false
}

/**
 * Elimina todos los tombstones verificándolos uno a uno. Las keys que no se
 * pudieron verificar permanecen en el espejo para mantener el bloqueo local.
 */
export function clearAllAthleteDeleteTombstones(): boolean {
  ensureDurableIndex()
  const durableKeys: string[] = []
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(`${ATHLETE_DELETE_TOMBSTONE_PREFIX}:`)) {
        durableKeys.push(key)
      }
    }
  } catch {
    return false
  }

  let allCleared = true
  for (const key of new Set([...durableKeys, ...memoryMirror])) {
    try {
      localStorage.removeItem(key)
    } catch {
      allCleared = false
      continue
    }

    const after = readKey(key)
    if (after.ok && after.value == null) {
      memoryMirror.delete(key)
      durableKeyIndex.delete(key)
    } else {
      allCleared = false
    }
  }

  if (allCleared) durableIndexHydrated = true
  return allCleared
}

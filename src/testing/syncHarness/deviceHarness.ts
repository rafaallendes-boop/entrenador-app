/**
 * Dos dispositivos representados como snapshots que se alternan alrededor de un
 * backend compartido.
 *
 * Es **concurrencia lógica desde snapshots divergentes**, no concurrencia real:
 * al alternar un único Dexie no puede haber operaciones de A y B en vuelo a la
 * vez. Cubre resolución de conflictos, orden de merge y resurrección; no cubre
 * carreras simultáneas.
 */
import { db } from '../../db/db'
import { getActiveAthleteId, getSelfAthleteId, setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'
import { useAuthStore } from '../../store/useAuthStore'
import { useTrainingStore } from '../../store/useTrainingStore'
import type { FakePostgrest } from './fakePostgrest'
import { clearTrackedTimers, isHarnessOnline, setHarnessOnline } from './harnessEnv'

/**
 * Tablas Dexie que el harness aísla. Se derivan del schema real en vez de
 * enumerarse: una lista corta dejaba estado compartido entre dispositivos —
 * memberships, chat y proposals— justo en las entidades que sync toca.
 */
const SNAPSHOT_TABLES: string[] = db.tables.map((table) => table.name)

export interface DeviceSnapshot {
  dexie: Record<string, unknown[]>
  localStorage: Record<string, string>
  activeAthleteId: string | null
  selfAthleteId: string | null
  /**
   * Estado de auth y sync completo. Compartir `lastSuccessfulSyncAt` entre
   * dispositivos invalidaría sobre todo los casos de delete, porque decide si
   * una operación encolada se considera vieja.
   */
  auth: {
    user: unknown
    /**
     * El holder de módulo (`activeAthlete.ts`) y el store pueden divergir: el
     * store es lo que lee la UI. Se snapshotean los dos.
     */
    activeAthleteId: string | null
    syncStatus: unknown
    syncError: unknown
    syncDetails: unknown
  }
  training: {
    requestedWeekStart: string | null
    loadedWeekStart: string | null
    sessions: unknown[]
    currentWeekSummary: unknown
  }
  online: boolean
}

export interface DeviceHarness {
  withDevice: (name: string, fn: () => Promise<void>) => Promise<void>
  snapshotOf: (name: string) => DeviceSnapshot
  seedSnapshot: (name: string, dexie: Record<string, unknown[]>) => void
  setOnline: (online: boolean) => void
  ownershipOf: (name: string) => Map<string, string>
  dispose: () => Promise<void>
}

function emptySnapshot(): DeviceSnapshot {
  return {
    dexie: Object.fromEntries(SNAPSHOT_TABLES.map((table) => [table, []])),
    localStorage: {},
    activeAthleteId: null,
    selfAthleteId: null,
    auth: {
      user: useAuthStore.getState().user ?? null,
      activeAthleteId: useAuthStore.getState().activeAthleteId ?? null,
      syncStatus: 'idle',
      syncError: null,
      syncDetails: { ...useAuthStore.getState().syncDetails },
    },
    training: {
      requestedWeekStart: null,
      loadedWeekStart: null,
      sessions: [],
      currentWeekSummary: null,
    },
    online: true,
  }
}

async function readDexie(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const table of SNAPSHOT_TABLES) {
    const store = (db as unknown as Record<string, { toArray?: () => Promise<unknown[]> }>)[table]
    out[table] = store?.toArray ? await store.toArray() : []
  }
  return out
}

async function writeDexie(dexie: Record<string, unknown[]>): Promise<void> {
  for (const table of SNAPSHOT_TABLES) {
    const store = (db as unknown as Record<string, {
      clear?: () => Promise<void>
      bulkPut?: (rows: unknown[]) => Promise<unknown>
    }>)[table]
    if (!store?.clear || !store.bulkPut) continue
    await store.clear()
    const rows = dexie[table] ?? []
    if (rows.length > 0) await store.bulkPut(rows)
  }
}

function readLocalStorage(): Record<string, string> {
  const out: Record<string, string> = {}
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)
    if (key == null) continue
    out[key] = localStorage.getItem(key) ?? ''
  }
  return out
}

function writeLocalStorage(entries: Record<string, string>): void {
  localStorage.clear()
  for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value)
}

export function createDeviceHarness(backend: FakePostgrest): DeviceHarness {
  const snapshots = new Map<string, DeviceSnapshot>()
  const ownership = new Map<string, Map<string, string>>()
  let currentDevice: string | null = null

  // Estado original del proceso, para que `dispose()` lo devuelva intacto.
  const originalLocalStorage = readLocalStorage()
  let originalDexie: Record<string, unknown[]> | null = null
  const originalTraining = { ...useTrainingStore.getState() }
  const originalAuth = {
    activeAthleteId: useAuthStore.getState().activeAthleteId ?? null,
    syncStatus: useAuthStore.getState().syncStatus,
    syncError: useAuthStore.getState().syncError,
    syncDetails: { ...useAuthStore.getState().syncDetails },
  }
  const originalActiveAthleteId = getActiveAthleteId()
  const originalSelfAthleteId = getSelfAthleteId()

  const ownershipFor = (name: string): Map<string, string> => {
    if (!ownership.has(name)) ownership.set(name, new Map())
    return ownership.get(name)!
  }

  /** Registra el dueño la primera vez que se ve una fila; nunca lo sobrescribe. */
  const recordOwnership = (name: string, dexie: Record<string, unknown[]>): void => {
    const owners = ownershipFor(name)
    for (const [table, rows] of Object.entries(dexie)) {
      for (const row of rows as Array<Record<string, unknown>>) {
        const id = row?.id
        const athleteId = row?.athleteId
        if (typeof id !== 'string' || typeof athleteId !== 'string') continue
        const key = `${table}/${id}`
        if (!owners.has(key)) owners.set(key, athleteId)
      }
    }
  }

  const capture = async (name: string): Promise<void> => {
    const training = useTrainingStore.getState()
    const dexie = await readDexie()
    recordOwnership(name, dexie)
    snapshots.set(name, {
      dexie,
      localStorage: readLocalStorage(),
      activeAthleteId: getActiveAthleteId(),
      selfAthleteId: getSelfAthleteId(),
      auth: {
        user: useAuthStore.getState().user ?? null,
        activeAthleteId: useAuthStore.getState().activeAthleteId ?? null,
        syncStatus: useAuthStore.getState().syncStatus,
        syncError: useAuthStore.getState().syncError,
        syncDetails: { ...useAuthStore.getState().syncDetails },
      },
      training: {
        requestedWeekStart: training.requestedWeekStart ?? null,
        loadedWeekStart: training.loadedWeekStart ?? null,
        sessions: [...(training.sessions ?? [])],
        currentWeekSummary: training.currentWeekSummary ?? null,
      },
      online: isHarnessOnline(),
    })
  }

  const restore = async (snapshot: DeviceSnapshot): Promise<void> => {
    await writeDexie(snapshot.dexie)
    writeLocalStorage(snapshot.localStorage)
    setSelfAthleteId(snapshot.selfAthleteId)
    setActiveAthleteId(snapshot.activeAthleteId)
    // Sin restaurar esto los dos dispositivos compartirían el estado de sync,
    // que es exactamente lo que el harness pretende aislar.
    useAuthStore.setState({
      user: snapshot.auth.user,
      activeAthleteId: snapshot.auth.activeAthleteId,
      syncStatus: snapshot.auth.syncStatus,
      syncError: snapshot.auth.syncError,
      syncDetails: snapshot.auth.syncDetails,
    } as never)
    // `setState` hace merge: los métodos del store sobreviven. Serializar el
    // store entero los borraría.
    useTrainingStore.setState({
      requestedWeekStart: snapshot.training.requestedWeekStart,
      loadedWeekStart: snapshot.training.loadedWeekStart,
      sessions: snapshot.training.sessions,
      currentWeekSummary: snapshot.training.currentWeekSummary,
    } as never)
    setHarnessOnline(snapshot.online)
  }

  return {
    async withDevice(name, fn) {
      // Se captura una sola vez, antes del primer turno: `dispose()` debe
      // devolver el Dexie que había, no dejarlo vacío.
      if (originalDexie == null) originalDexie = await readDexie()
      if (currentDevice != null) await capture(currentDevice)
      // Frontera: nada programado por el dispositivo anterior puede despertar
      // con el siguiente restaurado.
      clearTrackedTimers()
      currentDevice = name
      await restore(snapshots.get(name) ?? emptySnapshot())
      try {
        await fn()
      } finally {
        // Se captura pase lo que pase: un callback fallido no puede dejar el
        // snapshot del dispositivo desincronizado del estado real.
        await capture(name)
      }
    },

    snapshotOf(name) {
      const snapshot = snapshots.get(name)
      if (!snapshot) throw new Error(`deviceHarness: no hay snapshot para "${name}"`)
      return snapshot
    },

    seedSnapshot(name, dexie) {
      const base = snapshots.get(name) ?? emptySnapshot()
      const next: DeviceSnapshot = { ...base, dexie: { ...base.dexie, ...dexie } }
      recordOwnership(name, dexie)
      snapshots.set(name, next)
    },

    setOnline(online) {
      setHarnessOnline(online)
    },

    ownershipOf(name) {
      return ownershipFor(name)
    },

    async dispose() {
      await writeDexie(originalDexie ?? Object.fromEntries(SNAPSHOT_TABLES.map((table) => [table, []])))
      writeLocalStorage(originalLocalStorage)
      setSelfAthleteId(originalSelfAthleteId)
      setActiveAthleteId(originalActiveAthleteId)
      useTrainingStore.setState(originalTraining as never)
      useAuthStore.setState({
        activeAthleteId: originalAuth.activeAthleteId,
        syncStatus: originalAuth.syncStatus,
        syncError: originalAuth.syncError,
        syncDetails: originalAuth.syncDetails,
      } as never)
      currentDevice = null
      originalDexie = null
      snapshots.clear()
      ownership.clear()
      backend.reset()
    },
  }
}

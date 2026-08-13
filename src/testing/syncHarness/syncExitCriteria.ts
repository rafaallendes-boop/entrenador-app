/**
 * Criterios de salida del roadmap, como aserciones reutilizables.
 *
 * Convergir no demuestra que se ejercitó el camino que importa: dos clientes
 * pueden coincidir sin que jamás ocurriera un conflicto. Por eso `assertTrace`
 * afirma sobre la traza del doble, y por forma —no por conteo bruto.
 */
import { canonicalJson } from '../../utils/canonicalJson'
import type { DeviceHarness } from './deviceHarness'
import type { FakeFilter, FakePostgrest } from './fakePostgrest'

/** Columnas de fecha de los únicos compuestos de `008b`. */
const NATURAL_KEY_DATE_COLUMNS = new Set(['date', 'week_start_date'])

function sortById(rows: unknown[]): Array<Record<string, unknown>> {
  return [...(rows as Array<Record<string, unknown>>)]
    .sort((left, right) => String(left?.id).localeCompare(String(right?.id)))
}

export function assertConverged(
  harness: DeviceHarness,
  deviceA: string,
  deviceB: string,
  table: string,
): void {
  const rowsA = sortById(harness.snapshotOf(deviceA).dexie[table] ?? [])
  const rowsB = sortById(harness.snapshotOf(deviceB).dexie[table] ?? [])

  // Canónico, no `JSON.stringify` directo: un dispositivo que escribió la fila
  // y otro que la hidrató desde el backend producen las mismas claves en
  // distinto orden. Declarar eso "no convergen" sería un falso positivo que
  // enterraría las divergencias verdaderas.
  const serializedA = JSON.stringify(canonicalJson(rowsA))
  const serializedB = JSON.stringify(canonicalJson(rowsB))
  if (serializedA !== serializedB) {
    throw new Error(
      `Los dispositivos ${deviceA} y ${deviceB} no convergen en "${table}".\n`
      + `${deviceA}: ${serializedA}\n${deviceB}: ${serializedB}`,
    )
  }
}

export function assertQueuesDrained(harness: DeviceHarness, names: string[]): void {
  for (const name of names) {
    const storage = harness.snapshotOf(name).localStorage
    for (const [key, value] of Object.entries(storage)) {
      if (!key.toLowerCase().includes('queue')) continue
      const parsed: unknown = value ? JSON.parse(value) : []
      if (Array.isArray(parsed) && parsed.length > 0) {
        throw new Error(`La cola de ${name} no quedó vacía (${key}): ${value}`)
      }
    }
  }
}

export function assertNoResurrection(
  harness: DeviceHarness,
  table: string,
  ids: string[],
  names: string[],
): void {
  for (const name of names) {
    const rows = (harness.snapshotOf(name).dexie[table] ?? []) as Array<Record<string, unknown>>
    for (const id of ids) {
      if (rows.some((row) => row?.id === id)) {
        throw new Error(`La fila "${id}" resucitó en ${name} tras el borrado.`)
      }
    }
  }
}

/**
 * Afirma que ninguna fila cambió de dueño y que la proyección visible muestra
 * sólo el atleta activo.
 *
 * **No** exige que Dexie carezca de filas de otros atletas: cachear varios es
 * legítimo y esperable en una cuenta de coach.
 */
export function assertNoScopeLeak(
  harness: DeviceHarness,
  names: string[],
  activeAthleteId: string,
): void {
  for (const name of names) {
    const owners = harness.ownershipOf(name)
    const snapshot = harness.snapshotOf(name)

    for (const [table, rows] of Object.entries(snapshot.dexie)) {
      for (const row of rows as Array<Record<string, unknown>>) {
        const id = row?.id
        const athleteId = row?.athleteId
        if (typeof id !== 'string' || typeof athleteId !== 'string') continue
        const expected = owners.get(`${table}/${id}`)
        if (expected != null && expected !== athleteId) {
          throw new Error(
            `La fila ${table}/${id} cambió de athleteId en ${name}: `
            + `${expected} → ${athleteId}`,
          )
        }
      }
    }

    const visible = snapshot.training.sessions as Array<Record<string, unknown>>
    const foreign = visible.filter((row) => row?.athleteId !== activeAthleteId)
    if (foreign.length > 0) {
      throw new Error(
        `La proyección visible de ${name} incluye ${foreign.length} sesión(es) `
        + `de otro atleta que ${activeAthleteId}.`,
      )
    }
  }
}

export interface TrainingStoreTransition {
  requestedWeekStart: string | null
  loadedWeekStart: string | null
  sessionWeekStarts: string[]
  summaryWeekStart: string | null
}

/**
 * Afirma que ninguna transición del store expuso una proyección que mezcle
 * semanas.
 *
 * **No** falla por `requestedWeekStart !== loadedWeekStart`: durante una
 * transición eso es legítimo mientras la UI no proyecte los datos viejos, que
 * es exactamente la frontera que dejó preparada PR #11. Lo que se prohíbe es la
 * proyección inconsistente, no el estado intermedio.
 */
export function assertVisibleWeekStable(recorded: TrainingStoreTransition[]): void {
  recorded.forEach((transition, index) => {
    const { requestedWeekStart, loadedWeekStart, sessionWeekStarts, summaryWeekStart } = transition
    const describe = (): string => (
      `transición #${index}: ${JSON.stringify(transition)}`
    )
    void requestedWeekStart

    if (sessionWeekStarts.length > 1) {
      throw new Error(
        `La vista mezcló semanas (${sessionWeekStarts.join(', ')}) en la misma `
        + `proyección — ${describe()}`,
      )
    }

    if (sessionWeekStarts.length === 1 && sessionWeekStarts[0] !== loadedWeekStart) {
      throw new Error(
        `La vista expuso sesiones de ${sessionWeekStarts[0]} con la semana `
        + `cargada en ${loadedWeekStart} — ${describe()}`,
      )
    }

    if (summaryWeekStart != null && summaryWeekStart !== loadedWeekStart) {
      throw new Error(
        `El resumen visible es de ${summaryWeekStart} con la semana cargada en `
        + `${loadedWeekStart} — ${describe()}`,
      )
    }
  })
}

function hasEqOn(filters: FakeFilter[], column: string): boolean {
  return filters.some((filter) => filter.op === 'eq' && filter.column === column)
}

export function assertTrace(
  backend: FakePostgrest,
  expected: { conflicts?: number; naturalKeySelects?: number; conditionalUpdates?: number },
): void {
  const conflicts = backend.trace.filter((entry) => entry.code === '23505').length

  // Un select de clave natural pide exactamente `id, updated_at` y filtra por
  // user + athlete + la columna de fecha. Contar todos los selects mezclaría los
  // muchos genéricos de `runFullSync`.
  const naturalKeySelects = backend.trace.filter((entry) => (
    entry.op === 'select'
    && entry.columns === 'id, updated_at'
    && hasEqOn(entry.filters, 'user_id')
    && hasEqOn(entry.filters, 'athlete_id')
    && entry.filters.some((filter) => filter.op === 'eq' && NATURAL_KEY_DATE_COLUMNS.has(filter.column))
  )).length

  // `lt` sobre `updated_at`, no `eq`: distinguirlos es la razón de que
  // `filters` sea una lista tipada y no un mapa.
  const conditionalUpdates = backend.trace.filter((entry) => (
    entry.op === 'update'
    && entry.filters.some((filter) => filter.op === 'lt' && filter.column === 'updated_at')
  )).length

  const actual = { conflicts, naturalKeySelects, conditionalUpdates }
  for (const [key, value] of Object.entries(expected)) {
    const observed = actual[key as keyof typeof actual]
    if (observed !== value) {
      throw new Error(
        `assertTrace: se esperaban ${value} ${key} pero se observaron ${observed}. `
        + `Traza: ${JSON.stringify(actual)}`,
      )
    }
  }
}

/**
 * Asignación de bloque para accesorios de fuerza (spec §8).
 *
 * Módulo PURO: sin Dexie, sin red, sin reloj, sin `Math.random` y sin depender
 * del orden de iteración de ningún `Map` para producir resultado. Cada worker
 * ejecuta esto completo con la misma entrada y toma su propia columna, así que
 * cualquiera de esas tres cosas rompería la garantía entre workers (I4).
 */

const DEFAULT_MAX_NODES = 20_000
/** Presupuesto de I1: dos ids compartidos por par es tolerable; tres dispara el check. */
const PAIR_OVERLAP_BUDGET = 2

export type AllocationDegradationReason =
  | 'infeasible_intra_week'
  | 'insufficient_pool'
  | 'unresolved_identity'
  | 'search_exhausted'

export interface AllocatorSlot {
  slotKey: string
  canonicalId: string
  candidateIds: ReadonlyArray<string>
}

export interface AllocatorFixedWeek {
  /** Todo id fijo presente esa semana: entra en `all(P_i)`. */
  all: ReadonlyArray<string>
  /** Sólo los fijos contables: entran en `countables(P_j)`. Excluye el main lift. */
  countable: ReadonlyArray<string>
}

export interface AllocatorInput {
  slots: ReadonlyArray<AllocatorSlot>
  blockId: string
  weekCount: number
  /**
   * I1 es DIRECCIONAL: `|countables(P_j) ∩ all(P_i)|`. El main lift de la
   * semana anterior está en `all(P_i)`, pero el de la semana actual NO está
   * en `countables(P_j)`. Colapsar ambos en una sola lista contaría el main
   * lift contra sí mismo en cada par y haría fallar el presupuesto siempre.
   */
  fixedIdsByWeek: ReadonlyArray<AllocatorFixedWeek>
  maxNodes?: number
}

export interface AllocatorDegradedCell {
  slotKey: string
  week: number
  reason: AllocationDegradationReason
}

export interface AllocatorResult {
  /**
   * matrix[weekIndex][slotKey] = id asignado. Una celda degradada NO se omite:
   * lleva el `canonicalId` original, porque ese ejercicio sigue estando en la
   * semana y por lo tanto sigue consumiendo presupuesto de I1 y cupo de I2.
   * Omitirla la haría desaparecer de la proyección y el presupuesto mentiría.
   */
  matrix: ReadonlyArray<ReadonlyMap<string, string>>
  degradedCells: ReadonlyArray<AllocatorDegradedCell>
  searchExhausted: boolean
}

/**
 * Prefijo del centinela de identidad no resuelta. Es el mismo que
 * `strengthTemplateSnapshot.ts` ya construye para su `slotKey`, y tiene que ser
 * **único por slot**: si todos los originales sin resolver colapsaran en un
 * solo literal, dos ejercicios distintos contarían como un id compartido en I1
 * —subconteo— y se ocuparían cupo mutuamente en I2, mientras que
 * `qualityReview` los trata como ids distintos por nombre normalizado.
 */
export const UNRESOLVED_CANONICAL_ID_PREFIX = 'unresolved:'

/**
 * Un original que no resuelve no acredita identidad (spec §4): no se puede
 * garantizar I3 contra él, así que el slot no entra al allocator y degrada.
 * La cadena vacía se acepta como forma equivalente para no romper llamadores
 * que aún no estampen el centinela por slot, pero **colapsa** todos los
 * originales sin resolver en un mismo id: la forma correcta es el prefijo.
 */
function isUnresolvedCanonicalId(canonicalId: string): boolean {
  return canonicalId === '' || canonicalId.startsWith(UNRESOLVED_CANONICAL_ID_PREFIX)
}

/**
 * FNV-1a de 32 bits, congelado por test contra los golden de la especificación.
 * `Math.imul` mantiene la multiplicación en 32 bits y `>>> 0` devuelve el
 * entero sin signo; sin ninguno de los dos, el desbordamiento a doble precisión
 * daría un valor distinto del canónico.
 */
export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Lista de preferencia del slot: candidatos únicos ordenados por `localeCompare`
 * y rotados por `fnv1a32(blockId|slotKey)`. La semilla usa la identidad del
 * slot y nunca su posición, que es el mecanismo C de la spec.
 */
function preferenceOrder(slot: AllocatorSlot, blockId: string): string[] {
  const unique = [...new Set(slot.candidateIds)].sort((left, right) => left.localeCompare(right))
  if (unique.length === 0) return unique
  const offset = fnv1a32(`${blockId}|${slot.slotKey}`) % unique.length
  return [...unique.slice(offset), ...unique.slice(0, offset)]
}

/** Multiconjunto por semana: los fijos pueden repetirse y una celda degradada puede coincidir con uno. */
type CountMap = Map<string, number>

function increment(counts: CountMap, value: string): boolean {
  const next = (counts.get(value) ?? 0) + 1
  counts.set(value, next)
  return next === 1
}

function decrement(counts: CountMap, value: string): boolean {
  const next = (counts.get(value) ?? 0) - 1
  if (next <= 0) {
    counts.delete(value)
    return next === 0
  }
  counts.set(value, next)
  return false
}

function has(counts: CountMap, value: string): boolean {
  return (counts.get(value) ?? 0) > 0
}

interface Cell {
  slotIndex: number
  week: number
  preference: ReadonlyArray<string>
}

interface Solution {
  values: string[]
  degraded: boolean[]
  degradedReasons: Array<AllocationDegradationReason | undefined>
  excessPairs: number
  degradedCount: number
  /** Semanas de las celdas degradadas, orden descendente (criterio (c) de §9). */
  degradedWeeksDesc: number[]
  /** `slotKey` de las celdas degradadas, orden descendente (criterio (d) de §9). */
  degradedSlotKeysDesc: string[]
}

/**
 * Objetivo lexicográfico de §9, total y determinista: sin totalidad, dos
 * workers podrían quedarse con soluciones distintas y romper I4.
 * Devuelve < 0 si `candidate` es estrictamente mejor que `best`.
 */
function compareSolutions(candidate: Solution, best: Solution): number {
  if (candidate.excessPairs !== best.excessPairs) return candidate.excessPairs - best.excessPairs
  if (candidate.degradedCount !== best.degradedCount) return candidate.degradedCount - best.degradedCount
  for (let index = 0; index < candidate.degradedWeeksDesc.length; index++) {
    const left = candidate.degradedWeeksDesc[index]!
    const right = best.degradedWeeksDesc[index]!
    // Degradar primero las celdas de mayor `week`: gana la semana más alta.
    if (left !== right) return right - left
  }
  for (let index = 0; index < candidate.degradedSlotKeysDesc.length; index++) {
    const left = candidate.degradedSlotKeysDesc[index]!
    const right = best.degradedSlotKeysDesc[index]!
    if (left !== right) return right.localeCompare(left)
  }
  return 0
}

export function allocateStrengthBlock(input: AllocatorInput): AllocatorResult {
  const { slots, blockId } = input
  const weekCount = Math.max(0, input.weekCount)
  const maxNodes = input.maxNodes ?? DEFAULT_MAX_NODES

  // Proyección por semana. `allCounts` alimenta el lado `all(P_i)` de I1 y el
  // cupo de I2; `countableCounts` alimenta el lado `countables(P_j)`.
  const allCounts: CountMap[] = []
  const countableCounts: CountMap[] = []
  const fixedCountableUnique: string[][] = []
  for (let week = 0; week < weekCount; week++) {
    const fixed = input.fixedIdsByWeek[week] ?? { all: [], countable: [] }
    const all: CountMap = new Map()
    const countable: CountMap = new Map()
    for (const id of fixed.all) increment(all, id)
    for (const id of fixed.countable) increment(countable, id)
    allCounts.push(all)
    countableCounts.push(countable)
    fixedCountableUnique.push([...new Set(fixed.countable)].sort((left, right) => left.localeCompare(right)))
  }

  // `pairOverlap[i][j]` con i < j: |countables(P_j) ∩ all(P_i)|.
  const pairOverlap: number[][] = Array.from({ length: weekCount }, () =>
    Array.from({ length: weekCount }, () => 0),
  )

  // Línea base fijo-contra-fijo. Omitirla haría que el presupuesto mienta justo
  // donde más importa: el core estructural de §29 es un id FIJO y CONTABLE que
  // se repite entre semanas hermanas, así que consume presupuesto sin que
  // ninguna celda lo asigne. Se recorre un arreglo ordenado, no las claves del
  // `Map`, para no apoyarse en su orden de iteración (I4).
  for (let earlier = 0; earlier < weekCount; earlier++) {
    for (let later = earlier + 1; later < weekCount; later++) {
      let overlap = 0
      for (const value of fixedCountableUnique[later]!) {
        if (has(allCounts[earlier]!, value)) overlap += 1
      }
      pairOverlap[earlier]![later] = overlap
    }
  }

  function addValue(week: number, value: string): void {
    if (increment(countableCounts[week]!, value)) {
      for (let earlier = 0; earlier < week; earlier++) {
        if (has(allCounts[earlier]!, value)) pairOverlap[earlier]![week]! += 1
      }
    }
    if (increment(allCounts[week]!, value)) {
      for (let later = week + 1; later < weekCount; later++) {
        if (has(countableCounts[later]!, value)) pairOverlap[week]![later]! += 1
      }
    }
  }

  function removeValue(week: number, value: string): void {
    if (decrement(countableCounts[week]!, value)) {
      for (let earlier = 0; earlier < week; earlier++) {
        if (has(allCounts[earlier]!, value)) pairOverlap[earlier]![week]! -= 1
      }
    }
    if (decrement(allCounts[week]!, value)) {
      for (let later = week + 1; later < weekCount; later++) {
        if (has(countableCounts[later]!, value)) pairOverlap[week]![later]! -= 1
      }
    }
  }

  // La columna 0 no se decide: se declara y las demás se restringen contra ella.
  for (const slot of slots) {
    if (weekCount > 0) addValue(0, slot.canonicalId)
  }

  const preferences = slots.map((slot) => preferenceOrder(slot, blockId))

  // Orden de decisión estable: `week` ascendente y, dentro de la semana,
  // `slotKey` por `localeCompare`. La unidad es la celda, no la columna.
  const slotOrder = slots
    .map((slot, slotIndex) => ({ slot, slotIndex }))
    .sort((left, right) => left.slot.slotKey.localeCompare(right.slot.slotKey))

  const cells: Cell[] = []
  const cellIndexByWeekAndSlot = new Map<string, number>()
  for (let week = 1; week < weekCount; week++) {
    for (const { slotIndex } of slotOrder) {
      const cellIndex = cells.length
      cells.push({ slotIndex, week, preference: preferences[slotIndex]! })
      cellIndexByWeekAndSlot.set(`${week}:${slotIndex}`, cellIndex)
    }
  }

  const values: string[] = new Array<string>(cells.length).fill('')
  const degraded: boolean[] = new Array<boolean>(cells.length).fill(false)
  const degradedReasons: Array<AllocationDegradationReason | undefined> = new Array(cells.length).fill(undefined)

  let nodes = 0
  let searchExhausted = false
  /**
   * Una solución con 0 pares en exceso y 0 celdas degradadas es el mínimo de
   * los dos primeros niveles del objetivo, así que ninguna otra puede ganarle:
   * seguir explorando quemaría el tope de nodos en toda corrida sana y dejaría
   * `searchExhausted` pegado en `true`, inútil como señal de telemetría.
   */
  let optimalFound = false
  let best: Solution | undefined

  function countExcessPairs(): number {
    let excess = 0
    for (let earlier = 0; earlier < weekCount; earlier++) {
      for (let later = earlier + 1; later < weekCount; later++) {
        if (pairOverlap[earlier]![later]! > PAIR_OVERLAP_BUDGET) excess += 1
      }
    }
    return excess
  }

  function snapshotSolution(): Solution {
    const degradedWeeks: number[] = []
    const degradedSlotKeys: string[] = []
    for (let index = 0; index < cells.length; index++) {
      if (!degraded[index]) continue
      degradedWeeks.push(cells[index]!.week)
      degradedSlotKeys.push(slots[cells[index]!.slotIndex]!.slotKey)
    }
    return {
      values: [...values],
      degraded: [...degraded],
      degradedReasons: [...degradedReasons],
      excessPairs: countExcessPairs(),
      degradedCount: degradedWeeks.length,
      degradedWeeksDesc: [...degradedWeeks].sort((left, right) => right - left),
      degradedSlotKeysDesc: [...degradedSlotKeys].sort((left, right) => right.localeCompare(left)),
    }
  }

  function recordSolution(): void {
    const candidate = snapshotSolution()
    // Empate estricto conserva la primera visitada: el orden de visita es
    // determinista, así que "la mejor visitada" es reproducible entre workers.
    if (!best || compareSolutions(candidate, best) < 0) best = candidate
    if (best.excessPairs === 0 && best.degradedCount === 0) optimalFound = true
  }

  /**
   * Cota inferior monotónica para una rama parcial. Los solapes y las
   * degradaciones sólo pueden crecer al completar celdas, así que una rama que
   * ya pierde contra `best` no puede volver a ganar al deshacer otra rama.
   *
   * Cuando ya igualó el número de degradaciones, tampoco puede degradar más;
   * en ese caso todavía se conserva únicamente si su desempate parcial es
   * estrictamente mejor. Esto hace segura la rama opcional de degradación sin
   * convertirla en una explosión de nodos innecesaria.
   */
  function canStillImproveBest(): boolean {
    if (!best) return true

    const excessPairs = countExcessPairs()
    if (excessPairs !== best.excessPairs) return excessPairs < best.excessPairs

    const degradedWeeks: number[] = []
    const degradedSlotKeys: string[] = []
    for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
      if (!degraded[cellIndex]) continue
      degradedWeeks.push(cells[cellIndex]!.week)
      degradedSlotKeys.push(slots[cells[cellIndex]!.slotIndex]!.slotKey)
    }
    if (degradedWeeks.length !== best.degradedCount) return degradedWeeks.length < best.degradedCount

    const current: Solution = {
      // El valor no participa del desempate; se deja vacío para no copiar una
      // matriz parcial sólo para podar.
      values: [],
      degraded: [],
      degradedReasons: [],
      excessPairs,
      degradedCount: degradedWeeks.length,
      degradedWeeksDesc: degradedWeeks.sort((left, right) => right - left),
      degradedSlotKeysDesc: degradedSlotKeys.sort((left, right) => right.localeCompare(left)),
    }
    // Con el mismo número de degradaciones, cualquier otra degradación ya
    // perdería el segundo criterio. Por eso el desempate parcial es definitivo.
    return compareSolutions(current, best) < 0
  }

  /**
   * Repetir un candidato en semanas inmediatamente consecutivas no viola I1
   * por sí solo, pero reintroduce la resonancia que el orden por slot estable
   * debe eliminar. Se prefiere cualquier alternativa de la lista determinista
   * antes que ese id. No es una restricción dura: si I1/I2 dejan una sola
   * salida, el candidato previo sigue siendo alcanzable y no se degrada una
   * celda que sí puede resolverse.
   */
  function preferenceForCell(cell: Cell): ReadonlyArray<string> {
    const previousValue = cell.week === 1
      ? slots[cell.slotIndex]!.canonicalId
      : values[cellIndexByWeekAndSlot.get(`${cell.week - 1}:${cell.slotIndex}`)!]
    if (!previousValue || cell.preference.length < 2) return cell.preference

    return [
      ...cell.preference.filter((candidateId) => candidateId !== previousValue),
      ...cell.preference.filter((candidateId) => candidateId === previousValue),
    ]
  }

  /** Poda de la celda, en el orden fijo de §8: I3, luego I2, luego I1. */
  function isAdmissible(cell: Cell, candidateId: string): boolean {
    const slot = slots[cell.slotIndex]!
    if (isUnresolvedCanonicalId(slot.canonicalId)) return false
    if (candidateId === slot.canonicalId) return false // I3
    if (has(allCounts[cell.week]!, candidateId)) return false // I2, fijos incluidos
    // I1 direccional: el candidato entra en `countables` de SU semana y se
    // compara contra `all` de cada semana anterior, nunca al revés.
    const alreadyCountable = has(countableCounts[cell.week]!, candidateId)
    for (let earlier = 0; earlier < cell.week; earlier++) {
      const delta = !alreadyCountable && has(allCounts[earlier]!, candidateId) ? 1 : 0
      if (pairOverlap[earlier]![cell.week]! + delta > PAIR_OVERLAP_BUDGET) return false
    }
    return true
  }

  /**
   * Alcanzado el tope se completa el camino actual degradando lo que falta y se
   * registra igual: la búsqueda nunca lanza, nunca cuelga y nunca deja una
   * semana sin columna.
   */
  function finishByDegrading(fromIndex: number): void {
    const trail: number[] = []
    for (let index = fromIndex; index < cells.length; index++) {
      const cell = cells[index]!
      const canonicalId = slots[cell.slotIndex]!.canonicalId
      values[index] = canonicalId
      degraded[index] = true
      degradedReasons[index] = resolveKnownDegradationReason(slots[cell.slotIndex]!) ?? 'search_exhausted'
      addValue(cell.week, canonicalId)
      trail.push(index)
    }
    recordSolution()
    for (let position = trail.length - 1; position >= 0; position--) {
      const index = trail[position]!
      removeValue(cells[index]!.week, values[index]!)
      degraded[index] = false
      degradedReasons[index] = undefined
      values[index] = ''
    }
  }

  function search(index: number): void {
    if (searchExhausted || optimalFound) return
    if (!canStillImproveBest()) return
    if (index === cells.length) {
      recordSolution()
      return
    }
    nodes += 1
    if (nodes > maxNodes) {
      searchExhausted = true
      finishByDegrading(index)
      return
    }

    const cell = cells[index]!
    for (const candidateId of preferenceForCell(cell)) {
      if (!isAdmissible(cell, candidateId)) continue
      values[index] = candidateId
      degraded[index] = false
      degradedReasons[index] = undefined
      addValue(cell.week, candidateId)
      // El backtracking cruza fronteras de semana: al deshacer esta celda se
      // puede deshacer una de una semana anterior, que es lo que el
      // contraejemplo de Hall necesita y una resolución por columna no da.
      search(index + 1)
      removeValue(cell.week, candidateId)
      values[index] = ''
      if (searchExhausted || optimalFound) return
    }

    // La degradación también es una decisión cuando hubo candidatos admisibles.
    // Elegir uno ahora puede bloquear una celda posterior y forzar un original
    // que lleve algún par sobre I1; explorar el original aquí permite comparar
    // esa alternativa por el objetivo lexicográfico completo.
    //
    // LÍMITE DECLARADO: no se poda por I2. Si otro slot tomó antes este id en
    // la misma semana, la celda degradada lo duplica. Con los pools reales no
    // es alcanzable —la Tarea 1 excluye el original de su propio pool—, pero
    // I2 se garantiza para las celdas asignadas, no para las degradadas.
    const canonicalId = slots[cell.slotIndex]!.canonicalId
    values[index] = canonicalId
    degraded[index] = true
    degradedReasons[index] = resolveKnownDegradationReason(slots[cell.slotIndex]!) ?? 'infeasible_intra_week'
    addValue(cell.week, canonicalId)
    // La cota se evalúa DESPUÉS de proyectar el original: así la rama sólo
    // consume nodos si todavía puede mejorar la mejor solución conocida.
    if (canStillImproveBest()) {
      search(index + 1)
    }
    removeValue(cell.week, canonicalId)
    degraded[index] = false
    degradedReasons[index] = undefined
    values[index] = ''
  }

  search(0)

  function resolveKnownDegradationReason(slot: AllocatorSlot): AllocationDegradationReason | undefined {
    if (isUnresolvedCanonicalId(slot.canonicalId)) return 'unresolved_identity'
    if (slot.candidateIds.length === 0) return 'insufficient_pool'
    return undefined
  }

  const matrix: Map<string, string>[] = Array.from({ length: weekCount }, () => new Map<string, string>())
  if (weekCount > 0) {
    for (const slot of slots) matrix[0]!.set(slot.slotKey, slot.canonicalId)
  }

  const degradedCells: AllocatorDegradedCell[] = []
  if (best) {
    for (let index = 0; index < cells.length; index++) {
      const cell = cells[index]!
      const slot = slots[cell.slotIndex]!
      matrix[cell.week]!.set(slot.slotKey, best.values[index]!)
      if (best.degraded[index]) {
        degradedCells.push({
          slotKey: slot.slotKey,
          week: cell.week,
          reason: best.degradedReasons[index] ?? resolveKnownDegradationReason(slot) ?? 'infeasible_intra_week',
        })
      }
    }
  }

  return { matrix, degradedCells, searchExhausted }
}

import type { ExerciseGroup } from '../../types'
import type { ExerciseLibraryRef } from '../../types/exerciseLibraryRef'

/** Estructura pura: alcanza para agrupar, validar y renderizar. */
export type SupersetMember = {
  sets: number
  supersetGroup?: string
}

/** Estructura + identidad deportiva: lo que la politica necesita para decidir. */
export type SupersetCandidate = SupersetMember & {
  name: string
  group?: ExerciseGroup
  libraryRef?: ExerciseLibraryRef
}

/**
 * Frontera runtime: un id vacio, en blanco o no-string es AUSENCIA de grupo,
 * nunca un grupo invalido. Se aplica en todo borde de deserializacion.
 */
export function normalizeSupersetGroupId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

interface RawSegment {
  groupId: string | undefined
  start: number
  length: number
}

function splitIntoRawSegments<T extends SupersetMember>(exercises: readonly T[]): RawSegment[] {
  const segments: RawSegment[] = []

  exercises.forEach((exercise, index) => {
    const groupId = normalizeSupersetGroupId(exercise.supersetGroup)
    const previous = segments[segments.length - 1]

    if (groupId != null && previous && previous.groupId === groupId) {
      previous.length += 1
      return
    }
    segments.push({ groupId, start: index, length: 1 })
  })

  return segments
}

/**
 * Corrige tags y `sets`. NO reordena, NO inserta y NO borra: eso mantiene
 * intactos los contratos posicionales de fuerza.
 *
 * Reglas, EN ESTE ORDEN:
 *   1. Contiguidad — el PRIMER segmento reclama el id; una reaparicion posterior
 *      del mismo id se disuelve.
 *   2. Cardinalidad — un segmento de 1 miembro pierde el tag.
 *   3. Rondas — todo el segmento adopta el `sets` de su primer miembro.
 *
 * El orden importa: con `A, X, A, A` el primer segmento reserva `A` aunque
 * despues se disuelva por singleton, asi que el segundo tambien lo pierde.
 */
export function normalizeSupersetGroups<T extends SupersetMember>(exercises: readonly T[]): T[] {
  const segments = splitIntoRawSegments(exercises)
  const claimed = new Set<string>()
  const result: T[] = []

  for (const segment of segments) {
    const members = exercises.slice(segment.start, segment.start + segment.length)
    let groupId = segment.groupId

    if (groupId != null) {
      if (claimed.has(groupId)) groupId = undefined   // regla 1
      else claimed.add(groupId)
    }
    if (groupId != null && members.length < 2) groupId = undefined   // regla 2

    const anchorSets = members[0]!.sets   // regla 3

    for (const member of members) {
      const nextSets = groupId == null ? member.sets : anchorSets
      if (member.supersetGroup === groupId && member.sets === nextSets) {
        result.push(member)
        continue
      }
      const next = { ...member, sets: nextSets } as T
      if (groupId == null) delete (next as { supersetGroup?: string }).supersetGroup
      else (next as { supersetGroup?: string }).supersetGroup = groupId
      result.push(next)
    }
  }

  return result
}

export interface SupersetSegment<T> {
  groupId?: string
  members: T[]
}

/**
 * Para consumidores de RENDER. Normaliza internamente, de modo que la UI nunca
 * interprete como valida una estructura corrupta. El EDITOR no la usa: alli un
 * grupo de 1 en construccion es un estado intermedio legitimo.
 */
export function resolveSupersetLayout<T extends SupersetMember>(
  exercises: readonly T[],
): SupersetSegment<T>[] {
  const normalized = normalizeSupersetGroups(exercises)

  return splitIntoRawSegments(normalized).map((segment) => ({
    groupId: segment.groupId,
    members: normalized.slice(segment.start, segment.start + segment.length),
  }))
}

export function describeSupersetSegment(memberCount: number): 'Superserie' | 'Triserie' | 'Circuito' {
  if (memberCount <= 2) return 'Superserie'
  if (memberCount === 3) return 'Triserie'
  return 'Circuito'
}

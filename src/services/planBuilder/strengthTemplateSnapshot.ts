import { resolveStrengthExercise } from '../training/exerciseLibrary'
import { resolveSessionStrengthRoles } from './strengthRoleContract'
import type { StrengthContractRole } from './strengthRoleContract'
import type { CoachSessionProposal } from '../../types'
import type { ExerciseLibraryRef } from '../../types/exerciseLibraryRef'

/**
 * Registro transitorio e inmutable del primer template de fuerza observable.
 * En Plan Builder productivo lo crea el selector local porque el contrato del
 * modelo prohíbe `exercises`; otros consumidores todavía pueden proveer una
 * plantilla poblada. Vive dentro de una sola pasada de repair y NO cruza
 * ninguna frontera de serialización: no se persiste, no va a backup ni a
 * plantillas.
 */
export interface StrengthTemplateSlot {
  slotKey: string
  /** Ancla de la sesión viva: sobrevive a recortes y a reordenamientos posteriores. */
  sessionKey: string
  sessionOrdinal: number
  positionInSession: number
  canonicalId: string | null
  name: string
  libraryRef?: ExerciseLibraryRef
  role: StrengthContractRole
}

export interface StrengthTemplateSnapshot {
  readonly slots: ReadonlyArray<StrengthTemplateSlot>
}

/** Fecha+bloque ya son únicos después de resolver las colisiones del repair. */
export function strengthTemplateSessionKey(
  session: Pick<CoachSessionProposal, 'date' | 'timeBlock'> | { date?: string; timeBlock?: string },
): string {
  return `${session.date ?? '?'}|${session.timeBlock ?? '?'}`
}

export function captureStrengthTemplateSnapshot(
  strengthSessions: ReadonlyArray<CoachSessionProposal>,
): StrengthTemplateSnapshot {
  const slots: StrengthTemplateSlot[] = []

  strengthSessions.forEach((session, sessionOrdinal) => {
    const sessionKey = strengthTemplateSessionKey(session)
    const exercises = session.exercises ?? []
    const roles = resolveSessionStrengthRoles(exercises)
    // La ocurrencia desambigua ids repetidos en la misma sesión. NO se usa la
    // posición como identidad: la posición deriva entre semanas por el core
    // rotado y el relleno, y esa deriva es el mecanismo C de la spec.
    const occurrences = new Map<string, number>()

    exercises.forEach((exercise, positionInSession) => {
      // `definition` es opcional a propósito: una resolución `ambiguous` no
      // acredita identidad, así que cae a `null` y el slot se identifica por
      // nombre sin fingir un id canónico.
      const canonicalId = resolveStrengthExercise(exercise)?.definition?.id ?? null
      const identity = canonicalId ?? `unresolved:${exercise.name}`
      const occurrenceIndex = occurrences.get(identity) ?? 0
      occurrences.set(identity, occurrenceIndex + 1)

      // Copia por valor: el snapshot no puede quedar acoplado a la sesión que
      // los mutadores posteriores del repair van a seguir modificando.
      const libraryRef = exercise.libraryRef
        ? { source: exercise.libraryRef.source, id: exercise.libraryRef.id }
        : undefined

      slots.push(Object.freeze({
        slotKey: `${sessionOrdinal}:${identity}:${occurrenceIndex}`,
        sessionKey,
        sessionOrdinal,
        positionInSession,
        canonicalId,
        name: exercise.name,
        libraryRef: libraryRef ? Object.freeze(libraryRef) : undefined,
        role: roles[positionInSession]!,
      }))
    })
  })

  return Object.freeze({ slots: Object.freeze(slots) })
}

/**
 * Cubre la entrada estructural completa, no sólo el conjunto de ids: dos
 * templates con los mismos ids repartidos en sesiones distintas, o con roles
 * distintos, producen matrices distintas y deben tener firmas distintas.
 */
export function computeTemplateSignature(snapshot: StrengthTemplateSnapshot): string {
  return snapshot.slots
    .map((slot) => `${slot.slotKey}|${slot.role}`)
    .join('#')
}

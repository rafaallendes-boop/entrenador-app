import { describe, expect, it } from 'vitest'

import type { CoachExerciseProposal, CoachSessionProposal, TrainingPlanWeek } from '../../../types'
import { resolveStrengthExercise } from '../../training/exerciseLibrary'
import { repairGeneratedWeek, type RepairContext } from '../repairWeek'

/**
 * El snapshot del template se captura en el paso 6 del repair, pero la columna
 * local se aplica en el paso 15. Entre medio hay mutadores que quitan sesiones
 * de fuerza de la lista: `ensurePrimarySportDominance` las convierte al deporte
 * primario en build/peak, y `balanceSessionCount` recorta por prioridad y
 * reordena por fecha.
 *
 * Mientras el slot se localizaba por ordinal posicional, ese hueco producía dos
 * defectos distintos: un `TypeError` duro al desreferenciar
 * `strengthSessions[slot.sessionOrdinal]!` —que mataba la semana completa en
 * Plan Builder, en Crear semana del chat y en el fallback local, los tres
 * consumidores de `repairGeneratedWeek`— y, cuando no reventaba, la aplicación
 * de una celda sobre la sesión equivocada.
 *
 * El anclaje por `date|timeBlock` es lo que cierra ambos. Estos casos lo fijan
 * desde afuera: no inspeccionan la implementación, sólo exigen que el repair
 * sobreviva a que una sesión de fuerza desaparezca y que la que queda conserve
 * una prescripción coherente.
 */

const WEEK_START_DATES = ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22']
const MONDAY_OF_WEEK_1 = '2026-06-08'

function planWith(sessionsPerWeek: number, primarySport?: string) {
  return {
    id: 'p1', athleteId: 'a1', goalEventId: 'e1', status: 'draft', generationState: 'generating',
    title: 'Test', startDate: '2026-06-01', endDate: '2026-08-30', totalWeeks: 4,
    phases: [{ phase: 'peak', startWeekIndex: 0, endWeekIndex: 3, blockFocus: 'peak', intentBySport: {} }],
    wizardConfig: wizardConfig(sessionsPerWeek),
    macroSnapshot: {
      goalEventId: 'e1', goalEventDate: '2026-08-30', currentPhase: 'peak', weeksRemaining: 4,
      blockFocus: 'peak', headline: '', timeline: [],
      sportDetails: primarySport
        ? [{
            sport: primarySport, role: 'primary', phaseFocus: '', weeklyIntent: '',
            volumeBias: 'hold', intensityBias: 'hold', notes: '',
          }]
        : [],
      secondaryEvents: [], computedAt: 0,
    },
    createdAt: 0, updatedAt: 0,
  } as never
}

function wizardConfig(sessionsPerWeek: number) {
  return {
    goalEventId: 'e1', trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    doubleSessionDays: [], sessionsPerWeek, sessionDurationMins: 60,
    allowDoubleSession: false, complementarySports: ['strength'],
    currentFitnessLevel: 'fit', currentFatigue: 'fresh', createdAt: '', updatedAt: '',
  } as never
}

const TEMPLATE: CoachExerciseProposal[] = [
  { name: 'Sentadilla trasera', sets: 4, reps: 5, group: 'legs' },
  { name: 'Peso muerto rumano', sets: 3, reps: 8, group: 'legs' },
  { name: 'Press vertical', sets: 4, reps: 6, group: 'push' },
  { name: 'Remo con barra', sets: 3, reps: 8, group: 'pull' },
  { name: 'Dead bug — control de tronco', sets: 3, reps: 10, group: 'core' },
]

/**
 * Dos sesiones con familias de movimiento DISJUNTAS. El allocator sólo puede
 * reemplazar dentro del mismo `movement`, así que una materialización correcta
 * conserva las familias del template de esa sesión. Si una celda se aplicara
 * sobre la sesión equivocada, la superviviente perdería sus propias familias y
 * heredaría las de la otra: es lo único que distingue una asignación cruzada
 * silenciosa de una correcta, porque ambas producen ejercicios válidos.
 */
const SQUAT_PUSH_TEMPLATE: CoachExerciseProposal[] = [
  { name: 'Sentadilla trasera', sets: 4, reps: 5, group: 'legs' },
  { name: 'Press vertical', sets: 4, reps: 6, group: 'push' },
  { name: 'Dead bug — control de tronco', sets: 3, reps: 10, group: 'core' },
]
const HINGE_PULL_TEMPLATE: CoachExerciseProposal[] = [
  { name: 'Peso muerto rumano', sets: 3, reps: 8, group: 'legs' },
  { name: 'Remo con barra', sets: 3, reps: 8, group: 'pull' },
  { name: 'Dead bug — control de tronco', sets: 3, reps: 10, group: 'core' },
]

function strengthSession(date: string, exercises = TEMPLATE): CoachSessionProposal {
  return {
    date, timeBlock: 'AM', sessionType: 'strength', title: 'Fuerza', durationMin: 60, rpe: 6,
    exercises: exercises.map((exercise) => ({ ...exercise })),
  } as never
}

function movementsOf(session: CoachSessionProposal | undefined): Set<string> {
  return new Set(
    (session?.exercises ?? [])
      .map((exercise) => resolveStrengthExercise(exercise)?.definition?.movement)
      .filter((movement): movement is string => movement != null),
  )
}

function squashSession(date: string): CoachSessionProposal {
  return {
    date, timeBlock: 'AM', sessionType: 'squash', subtype: 'technical',
    title: 'Squash', durationMin: 60, rpe: 6,
    squashDetails: { sessionKind: 'technical', drills: [{ name: 'Drives paralelos', durationMin: 60 }] },
  } as never
}

/** Shell: la hermana anterior no está lista, que es la condición real bajo concurrencia 3. */
function shellWeek(weekIndex: number): TrainingPlanWeek {
  return {
    id: `w${weekIndex}`, planId: 'p1', weekIndex, weekStartDate: WEEK_START_DATES[weekIndex]!,
    phase: 'peak', status: 'generating', sessions: [], weekObjectives: [],
    targetLoadBySport: { strength: 30 }, validationIssues: [],
    generationMeta: { attempts: 0, provider: 'gemini', model: 'flash' }, createdAt: 0, updatedAt: 0,
  } as never
}

/** La semana 1 del bloque es la primera con política activa (`localWeek > 0`). */
function context(sessionsPerWeek: number, primarySport?: string): RepairContext {
  return {
    plan: planWith(sessionsPerWeek, primarySport),
    week: {
      ...shellWeek(1), status: 'draft',
      generationMeta: { attempts: 1, provider: 'gemini', model: 'flash' },
    } as TrainingPlanWeek,
    profile: { id: 'default', updatedAt: 0 } as never,
    wizardConfig: wizardConfig(sessionsPerWeek),
    previousWeek: shellWeek(0),
    planWeekDescriptors: [0, 1, 2, 3].map((weekIndex) => ({ weekIndex, phase: 'peak' })),
  }
}

function strengthExerciseNames(sessions: CoachSessionProposal[]): string[] {
  return sessions
    .filter((session) => session.sessionType === 'strength')
    .flatMap((session) => session.exercises ?? [])
    .map((exercise) => exercise.name)
}

describe('los slots de fuerza sobreviven a que el repair quite una sesión', () => {
  it('no lanza cuando la dominancia convierte una sesión de fuerza al deporte primario', () => {
    // 1 squash + 2 fuerza en una semana de tres: no hay recorte ni relleno, así
    // que `ensurePrimarySportDominance` es el único mutador que actúa y
    // convierte una de fuerza para que el primario domine.
    const sessions = [
      strengthSession(MONDAY_OF_WEEK_1),
      strengthSession('2026-06-09'),
      squashSession('2026-06-10'),
    ]

    const result = repairGeneratedWeek(sessions, context(3, 'squash'))

    expect(result.sessions.filter((session) => session.sessionType === 'strength').length)
      .toBeLessThan(2)
    expect(result.failure).toBeUndefined()
  })

  it('no lanza cuando el recorte por exceso elimina una sesión de fuerza', () => {
    // Tres sesiones para una semana de dos: `balanceSessionCount` recorta por
    // prioridad y vuelve a ordenar por fecha, así que los ordinales derivan.
    const sessions = [
      strengthSession(MONDAY_OF_WEEK_1),
      strengthSession('2026-06-09'),
      strengthSession('2026-06-10'),
    ]

    const result = repairGeneratedWeek(sessions, context(2))

    expect(result.sessions.length).toBe(2)
    expect(result.failure).toBeUndefined()
  })

  it('la sesión de fuerza que sobrevive conserva una prescripción resoluble', () => {
    const sessions = [
      strengthSession(MONDAY_OF_WEEK_1),
      strengthSession('2026-06-09'),
      squashSession('2026-06-10'),
    ]

    const survivors = repairGeneratedWeek(sessions, context(3, 'squash')).sessions
      .filter((session) => session.sessionType === 'strength')

    expect(survivors.length).toBeGreaterThan(0)
    for (const session of survivors) {
      const exercises = session.exercises ?? []
      expect(exercises.length).toBeGreaterThan(0)
      // Una celda aplicada sobre la sesión equivocada dejaba nombres que no
      // resuelven contra el catálogo vivo, o duplicaba una identidad.
      const ids = exercises.map((exercise) => resolveStrengthExercise(exercise)?.definition?.id)
      expect(ids.every((id) => id != null)).toBe(true)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('las celdas de la sesión eliminada se reportan como no materializadas, no como asignadas', () => {
    const sessions = [
      strengthSession(MONDAY_OF_WEEK_1),
      strengthSession('2026-06-09'),
      squashSession('2026-06-10'),
    ]

    const meta = repairGeneratedWeek(sessions, context(3, 'squash')).meta
    const allocator = meta.strengthAllocator

    expect(allocator).toBeDefined()
    // El contador nunca puede acreditar más celdas que las que la columna tiene.
    expect(allocator!.assignedCount).toBeLessThanOrEqual(allocator!.slotCount)
    expect(allocator!.assignedCount + allocator!.unmaterializedCount)
      .toBeLessThanOrEqual(allocator!.slotCount)
  })

  it('la superviviente recibe su propia celda y conserva sus familias de movimiento', () => {
    // La dominancia convierte la PRIMERA sesión de fuerza, así que la que
    // sobrevive era el ordinal 1 del snapshot y pasa a ocupar el índice 0. Con
    // localización posicional, las celdas del ordinal 0 caen sobre ella.
    const sessions = [
      strengthSession(MONDAY_OF_WEEK_1, SQUAT_PUSH_TEMPLATE),
      strengthSession('2026-06-09', HINGE_PULL_TEMPLATE),
      squashSession('2026-06-10'),
    ]

    const repaired = repairGeneratedWeek(sessions, context(3, 'squash')).sessions
    const survivor = repaired.find((session) => session.sessionType === 'strength')

    expect(survivor?.date).toBe('2026-06-09')
    const movements = movementsOf(survivor)
    // `hinge` y `pull` son las familias de su propio template; el allocator sólo
    // reemplaza dentro de la familia, así que ambas tienen que seguir ahí.
    expect(movements.has('hinge')).toBe(true)
    expect(movements.has('pull')).toBe(true)
    // Y su propia celda tiene que haberse materializado: `bent_over_row` es el
    // accesorio contable de ESTA sesión y en la semana 1 la matriz lo rota. Si
    // el slot se localizara por ordinal, quedaría sin tocar y el accesorio
    // seguiría siendo el canónico del template.
    const ids = (survivor?.exercises ?? [])
      .map((exercise) => resolveStrengthExercise(exercise)?.definition?.id)
    expect(ids).not.toContain('bent_over_row')
  })

  it('sin sesiones que quitar, el repair mantiene las dos sesiones y sus ejercicios', () => {
    // Control: mismo template y misma semana, pero con cupo para las dos. Sin
    // esto, los casos de arriba pasarían también si el repair dejara de
    // aplicar la columna por completo.
    const sessions = [strengthSession(MONDAY_OF_WEEK_1), strengthSession('2026-06-09')]

    const result = repairGeneratedWeek(sessions, context(2))

    expect(result.sessions.filter((session) => session.sessionType === 'strength').length).toBe(2)
    expect(strengthExerciseNames(result.sessions).length).toBeGreaterThanOrEqual(TEMPLATE.length)
  })
})

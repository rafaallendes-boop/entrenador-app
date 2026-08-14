import { describe, expect, it } from 'vitest'
import type { CoachExerciseProposal } from '../../../types'
import { normalizeStrengthSessionExercises } from '../strengthSessionStructure'
import { resolveStrengthExercise } from '../exerciseLibrary'

/**
 * Hallazgo 5 de la QA deportiva del 2026-08-13. El core de fundación se
 * inyectaba siempre como `dead_bug`, así que aparecía idéntico en todas las
 * semanas de un bloque y aportaba un ejercicio compartido gratis a cada par,
 * empujando `quality.strength.repeated_template` sobre su umbral.
 *
 * El contrato nuevo: con contexto de semana el core inyectado rota; sin
 * contexto —el caso del chat— sigue siendo `dead_bug`.
 */

/** Sesión sin ningún ejercicio de grupo `core`, que es lo que dispara la inyección. */
function sessionWithoutCore(): CoachExerciseProposal[] {
  return [
    { name: 'Sentadilla trasera', sets: 4, reps: 5, group: 'legs' },
    { name: 'Press vertical', sets: 4, reps: 6, group: 'push' },
    { name: 'Remo con barra', sets: 3, reps: 8, group: 'pull' },
  ]
}

function injectedCoreId(exercises: CoachExerciseProposal[] | undefined): string | undefined {
  const core = exercises?.find((exercise) => exercise.group === 'core')
  return core ? resolveStrengthExercise(core)?.definition?.id : undefined
}

function normalizeAt(weekIndexInBlock: number | undefined): string | undefined {
  return injectedCoreId(normalizeStrengthSessionExercises(sessionWithoutCore(), {
    durationMin: 60,
    ...(weekIndexInBlock == null ? {} : { weekIndexInBlock }),
  }))
}

describe('rotación del core inyectado', () => {
  it('inyecta cores distintos en semanas consecutivas del mismo bloque', () => {
    const ids = [0, 1, 2, 3].map((weekIndexInBlock) => normalizeAt(weekIndexInBlock))

    expect(ids.every((id) => id != null)).toBe(true)
    // Variedad real, no solo "no dispara el warning": cuatro semanas
    // consecutivas no pueden compartir el mismo core de fundación.
    expect(new Set(ids).size).toBe(4)
  })

  it('mantiene `dead_bug` cuando no hay contexto de semana (camino del chat)', () => {
    expect(normalizeAt(undefined)).toBe('dead_bug')
  })

  it('es determinista: el mismo índice de semana da siempre el mismo core', () => {
    expect(normalizeAt(2)).toBe(normalizeAt(2))
    expect(normalizeAt(7)).toBe(normalizeAt(7))
  })

  it('recorre el pool de forma cíclica y estable', () => {
    const first = [0, 1, 2, 3].map((index) => normalizeAt(index))
    const second = [4, 5, 6, 7].map((index) => normalizeAt(index))
    expect(second).toEqual(first)
  })

  it('solo inyecta cores de fundación reconocidos por la librería', () => {
    for (const index of [0, 1, 2, 3]) {
      const id = normalizeAt(index)
      expect(id).toBeDefined()
      const definition = resolveStrengthExercise({ name: '', libraryRef: { source: 'strength_exercise', id: id! } })?.definition
      expect(definition?.tags).toContain('core')
    }
  })
})

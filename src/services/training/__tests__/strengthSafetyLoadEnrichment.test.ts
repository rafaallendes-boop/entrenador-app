import { describe, expect, it } from 'vitest'

import type { CoachExerciseProposal } from '../../../types'
import type { StrengthConstraint } from '../../../types/strengthSafety'
import { prepareStrengthSession } from '../strengthSafetyFinalizer'
import { buildStrengthSafetyContext } from '../strengthSafetySurface'

const lumbar: StrengthConstraint[] = [
  { kind: 'region', region: 'lumbar', sources: ['current_injuries'] },
]

function prepare(exercises: CoachExerciseProposal[], constraints: readonly StrengthConstraint[]) {
  const session = { durationMin: 60, objective: 'fuerza general', exercises }
  return prepareStrengthSession(session, {
    constraints,
    userMessageConstraints: [],
    userMessage: '',
    selectionContext: buildStrengthSafetyContext(undefined, 60, 'fuerza general', constraints),
    structureOptions: { durationMin: 60, strengthProfile: undefined },
    supersetMode: 'off',
    sealLocation: 'root',
  })
}

describe('enriquecimiento de carga posterior al finalizador', () => {
  // El enhancer corre ANTES del finalizador, y `toProposal` no transporta
  // weight/warmupSets/targetRpe. Sin una pasada posterior, todo ejercicio que
  // el finalizador sustituye o agrega llega al atleta sin esfuerzo objetivo,
  // junto a hermanos que sí lo tienen.
  it('la exclusión por seguridad no degrada el enriquecimiento respecto del camino sin restricción', () => {
    // Propiedad comparativa en vez de un predicado interno: los pliométricos
    // legítimamente no llevan esfuerzo objetivo, así que lo que importa es que
    // sustituir por seguridad no AGREGUE ejercicios sin carga enriquecida.
    const sinEsfuerzo = (constraints: readonly StrengthConstraint[]): string[] => {
      const result = prepare(
        [
          { name: 'Peso muerto convencional', sets: 4, reps: 5 },
          { name: 'Press de banca', sets: 3, reps: 8 },
        ],
        constraints,
      )
      expect(result.status).toBe('ok')
      if (result.status !== 'ok') return []
      return result.session.exercises!
        .filter((exercise) => exercise.targetRpe == null && exercise.targetPercent1RM == null)
        .map((exercise) => exercise.name)
    }

    expect(sinEsfuerzo(lumbar).length).toBeLessThanOrEqual(sinEsfuerzo([]).length)
  })

  it('el ejercicio sustituido llega con esfuerzo objetivo, como sus hermanos', () => {
    const result = prepare(
      [
        { name: 'Peso muerto convencional', sets: 4, reps: 5 },
        { name: 'Press de banca', sets: 3, reps: 8 },
      ],
      lumbar,
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return

    // El peso muerto sale por la restricción lumbar y el finalizador completa
    // densidad con ejercicios que el enhancer nunca vio. Al menos uno de esos
    // debe llegar con carga resuelta.
    expect(result.session.exercises!.some((exercise) => /peso muerto/i.test(exercise.name))).toBe(false)
    const agregados = result.session.exercises!.filter(
      (exercise) => !/press de banca/i.test(exercise.name),
    )
    expect(agregados.length).toBeGreaterThan(0)
    expect(agregados.some((exercise) => exercise.targetRpe != null || exercise.targetPercent1RM != null)).toBe(true)
  })

  it('el enriquecimiento no altera la membresía decidida por el finalizador', () => {
    const result = prepare([{ name: 'Press de banca', sets: 3, reps: 8 }], lumbar)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    // Todo lo que sobrevive sigue siendo permitido; enriquecer no repone nada.
    expect(result.session.exercises!.some((exercise) => /peso muerto/i.test(exercise.name))).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'

import { preserveStrengthExerciseIdentity } from '../useCoachActionsStore'

const current = [
  { id: 'ex-1', name: 'Sentadilla trasera', sets: 4, reps: 5, completed: true },
  { id: 'ex-2', name: 'Press de banca', sets: 3, reps: 8, completed: true },
  { id: 'ex-3', name: 'Remo con barra', sets: 3, reps: 10, completed: false },
]

describe('preserveStrengthExerciseIdentity', () => {
  // Aceptar "cámbiale el título a la fuerza del lunes" no puede desmarcar el
  // progreso que el atleta ya registró. La verificación de seguridad devuelve
  // ejercicios sin id ni estado, así que hay que reponerlos.
  it('conserva id y completado de los ejercicios que sobreviven la verificación', () => {
    const verified = [
      { name: 'Sentadilla trasera', sets: 4, reps: 5 },
      { name: 'Press de banca', sets: 3, reps: 8 },
      { name: 'Remo con barra', sets: 3, reps: 10 },
    ]
    expect(preserveStrengthExerciseIdentity(verified, current).map((e) => [e.id, e.completed])).toEqual([
      ['ex-1', true], ['ex-2', true], ['ex-3', false],
    ])
  })

  it('asigna identidad nueva sólo a lo que el finalizador agregó o reemplazó', () => {
    const verified = [
      { name: 'Sentadilla trasera', sets: 4, reps: 5 },
      { name: 'Empuje de cadera', sets: 3, reps: 8 },
    ]
    const result = preserveStrengthExerciseIdentity(verified, current)
    expect(result[0].id).toBe('ex-1')
    expect(result[0].completed).toBe(true)
    expect(result[1].id).not.toBe('ex-2')
    expect(result[1].completed).toBe(false)
  })

  it('no reutiliza el mismo id para dos ejercicios homónimos', () => {
    const verified = [
      { name: 'Plancha', sets: 3, reps: 30 },
      { name: 'Plancha', sets: 3, reps: 30 },
    ]
    const result = preserveStrengthExerciseIdentity(verified, [
      { id: 'ex-9', name: 'Plancha', sets: 3, reps: 30, completed: true },
    ])
    expect(result[0].id).toBe('ex-9')
    expect(result[1].id).not.toBe('ex-9')
    expect(new Set(result.map((e) => e.id)).size).toBe(2)
  })

  it('ignora acentos y capitalización al emparejar', () => {
    const result = preserveStrengthExerciseIdentity(
      [{ name: 'SENTADILLA TRASERA', sets: 4, reps: 5 }],
      current,
    )
    expect(result[0].id).toBe('ex-1')
    expect(result[0].completed).toBe(true)
  })
})

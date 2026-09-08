import { describe, expect, it } from 'vitest'

import { findStrengthExerciseByName, resolveStrengthExercise, resolveStrengthExerciseName } from '../exerciseLibrary'

/**
 * Guard de modificador de equipamiento sobre el tier `substring`.
 *
 * Un fragmento que nombra equipamiento que el candidato no declara deja de
 * resolver: `'Press banca en máquina'` heredaba la referencia de carga de la
 * banca libre (factor 1 sobre el 1RM de barra) por coincidencia parcial.
 *
 * El guard sólo puede **quitar** candidatos. Nunca convierte un nombre ambiguo
 * en una definición confiable: si antes del filtro había más de un candidato,
 * el resultado sigue siendo `ambiguous` aunque sobreviva uno solo. Prescribir
 * carga sobre un fragmento que empataba es exactamente el error que se corrige.
 */
describe('guard de modificador de equipamiento en la resolución por nombre', () => {
  it.each([
    ['Press banca en máquina', 'machine'],
    ['Bench press machine', 'machine'],
    ['Bench press with dumbbells', 'dumbbell'],
    ['Press banca en polea', 'cable'],
  ] as const)('no resuelve %s: el candidato no declara ese equipamiento', (name) => {
    expect(findStrengthExerciseByName(name)).toBeUndefined()
  })

  it.each([
    ['Press banca en Smith', 'smith_bench_press'],
    ['Hip thrust con barra', 'hip_thrust'],
    ['Búlgaras con mancuernas', 'bulgarian_split_squat'],
    ['Press banca con barra y mancuernas', 'bench_press'],
  ] as const)('conserva %s: el equipamiento nombrado está declarado', (name, id) => {
    expect(findStrengthExerciseByName(name)?.id).toBe(id)
  })

  it('mencionar equipamiento no es pedirlo: la negación no descarta al candidato', () => {
    expect(findStrengthExerciseByName('Press banca sin máquina')?.id).toBe('bench_press')
    expect(findStrengthExerciseByName('Press banca con máquina')).toBeUndefined()
  })

  it('no estrecha la lista de un nombre ambiguo', () => {
    // Estrechar dejaría sólo `assisted_pull_up`, y los consumidores que miran
    // `candidates` para decidir si exponen un %1RM pasarían a exponerlo. El
    // guard sólo puede quitar confianza.
    const resolution = resolveStrengthExerciseName('Dominada asistida con banda')

    expect(resolution?.matchKind).toBe('ambiguous')
    expect(resolution?.candidates.map((candidate) => candidate.id)).toContain('pull_up')
  })

  it('no convierte un nombre ambiguo en una definición confiable', () => {
    // `Peso muerto` y `Peso muerto rumano` empatan con factores distintos (1 vs
    // 0,8). Filtrar por mancuernas deja uno solo, pero prescribir 0,8 del 1RM de
    // barra para un RDL con mancuernas sería el mismo error con otro disfraz.
    const resolution = resolveStrengthExerciseName('Peso muerto rumano con mancuernas')
    expect(resolution?.matchKind).toBe('ambiguous')
    expect(resolution?.definition).toBeUndefined()
  })

  it('el libraryRef sigue siendo autoritativo sobre el nombre', () => {
    const resolution = resolveStrengthExercise({
      name: 'Press banca en máquina',
      libraryRef: { source: 'strength_exercise', id: 'bench_press' },
    })

    expect(resolution?.matchKind).toBe('ref')
    expect(resolution?.definition?.id).toBe('bench_press')
  })

  it('no toca los tiers exacto ni alias', () => {
    expect(findStrengthExerciseByName('Peso muerto con trap bar')?.id).toBe('trap_bar_deadlift')
    expect(findStrengthExerciseByName('Sentadilla trasera con barra')?.id).toBe('back_squat')
  })
})

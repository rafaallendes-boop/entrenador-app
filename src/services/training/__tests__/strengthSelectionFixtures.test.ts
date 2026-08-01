import { describe, expect, it } from 'vitest'

import { findStrengthExerciseByName } from '../exerciseLibrary'
import { selectStrengthSession, type StrengthContext } from '../strengthSelector'

/**
 * Fixtures de selección (spec 2026-07-31 §7.2).
 *
 * El snapshot por ejercicio congela propiedades de cada definición; esto congela
 * la **elección**.
 *
 * `selectStrengthSession` tiene dos caminos y hay que cubrir los dos por
 * separado. `shouldUseBlockTemplateSelection:139` desvía a la selección por
 * plantilla si el contexto trae `weekIndexInBlock`, `available1RM` no vacío o
 * `rpeAdjustment`. El desempate que cambia la Tarea 3 —`scoreExercises:1006`—
 * vive en el camino **sin** plantilla, así que los escenarios normales no deben
 * traer ninguno de esos tres campos.
 *
 * NO correr `vitest -u` sobre este archivo.
 */

/** Sin `as`: si un campo deja de ser válido, TypeScript lo dice acá. */
function contextFor(overrides: Partial<StrengthContext>): StrengthContext {
  return {
    fatigueLevel: 4,
    phase: 'build',
    recentExercises: [],
    goal: 'ganar fuerza para squash',
    sportProfile: 'sport_support',
    primarySport: 'squash',
    experienceLevel: 'intermediate',
    sessionDurationMin: 50,
    ...overrides,
  }
}

/** Camino sin plantilla: es el que recorre el desempate de la Tarea 3. */
const SCORED_SCENARIOS: Array<{ name: string; context: StrengthContext }> = [
  { name: 'base', context: contextFor({ phase: 'base' }) },
  { name: 'build', context: contextFor({ phase: 'build' }) },
  { name: 'peak', context: contextFor({ phase: 'peak' }) },
  { name: 'taper', context: contextFor({ phase: 'taper' }) },
  { name: 'fatiga alta', context: contextFor({ fatigueLevel: 8 }) },
  { name: 'fatiga baja', context: contextFor({ fatigueLevel: 1 }) },
  { name: 'solo peso corporal', context: contextFor({ availableEquipment: ['bodyweight'] }) },
  { name: 'gimnasio completo', context: contextFor({ availableEquipment: ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight'] }) },
  { name: 'competencia cercana', context: contextFor({ competitionSoon: true, daysToCompetition: 3 }) },
  { name: 'principiante', context: contextFor({ experienceLevel: 'beginner' }) },
]

/** Camino por plantilla: se congela igual, pero no cubre el desempate. */
const TEMPLATE_SCENARIOS: Array<{ name: string; context: StrengthContext }> = [
  { name: 'plantilla semana 0', context: contextFor({ weekIndexInBlock: 0 }) },
  { name: 'plantilla semana 1', context: contextFor({ weekIndexInBlock: 1 }) },
  { name: 'plantilla con 1RM completo', context: contextFor({ available1RM: ['squat', 'deadlift', 'benchPress', 'overheadPress'] }) },
  { name: 'plantilla con 1RM solo squat', context: contextFor({ available1RM: ['squat'] }) },
]

/**
 * La firma va por `id`, no por nombre. El selector solo expone `name`
 * (`strengthSelector.ts:49` y `:75`), pero esos nombres son canónicos y
 * resuelven por el primer escalón del matcher, así que guardarlos como `id`
 * desacopla este snapshot de la futura entrega de copy.
 */
/** Único punto de conversión nombre→id. Rompe en vez de degradar a `null`. */
function idForCanonicalName(name: string): string {
  const id = findStrengthExerciseByName(name)?.id
  if (!id) throw new Error(`nombre no resuelto en la selección: "${name}"`)
  return id
}

function signatureOf(names: string[]): string {
  return names.map(idForCanonicalName).join(' | ')
}

function rowsFor(scenarios: typeof SCORED_SCENARIOS, path: string) {
  return scenarios.map(({ name, context }) => {
    const session = selectStrengthSession(context)
    return {
      path,
      scenario: name,
      focus: session.focus,
      // Mismo helper que la firma: un starLift sin resolver debe romper, no
      // convertirse en `null` en silencio.
      starLift: session.starLift ? idForCanonicalName(session.starLift.name) : null,
      signature: signatureOf(session.exercises.map((exercise) => exercise.name)),
    }
  })
}

describe('fixtures de selección de fuerza', () => {
  it('la selección es estable por escenario', async () => {
    const rows = [
      ...rowsFor(SCORED_SCENARIOS, 'scored'),
      ...rowsFor(TEMPLATE_SCENARIOS, 'template'),
    ]

    expect(rows).toHaveLength(SCORED_SCENARIOS.length + TEMPLATE_SCENARIOS.length)
    expect(rows.every((row) => row.signature.length > 0)).toBe(true)
    // Los escenarios del camino puntuado tienen que producir selecciones
    // distintas entre sí; si no, no discriminan y no servirían de detector.
    expect(new Set(rows.filter((row) => row.path === 'scored').map((row) => row.signature)).size)
      .toBeGreaterThan(1)

    await expect(`${JSON.stringify(rows, null, 2)}\n`)
      .toMatchFileSnapshot('./__snapshots__/strengthSelectionFixtures.json')
  })
})

describe('desempate del selector', () => {
  it('ante puntajes iguales gana el id menor, no el nombre', () => {
    const session = selectStrengthSession(contextFor({ phase: 'build' }))
    const ids = session.exercises.map((exercise) => idForCanonicalName(exercise.name))

    // `back_squat` y `trap_bar_deadlift` empatan en `score = 24` en este
    // escenario —junto a landmine_press, romanian_deadlift, overhead_press y
    // front_squat— y solo uno entra a la sesión. Con desempate por nombre
    // entraba `trap_bar_deadlift`; con desempate por id entra `back_squat`.
    expect(ids).toContain('back_squat')
    expect(ids).not.toContain('trap_bar_deadlift')
  })
})

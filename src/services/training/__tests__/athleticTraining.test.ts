import { describe, expect, it } from 'vitest'
import { ATHLETIC_EXERCISES } from '../athleticExerciseLibrary'
import { isFinisherExercise } from '../athleticTraining'
import { getCatalogForSport, searchCatalog } from '../coachExerciseCatalog'
import { findStrengthExerciseByName, getExerciseById, resolveStrengthExercise } from '../exerciseLibrary'
import { resolveDeclaredEquipment } from '../equipmentVocabulary'
import { selectStrengthSession, getStrengthReplacementPool, buildStrengthReplacementById, type StrengthContext } from '../strengthSelector'
import { enhanceStrengthSessionExercises } from '../strengthSessionStructure'
import { finalizeStrengthExercisesForRestrictions } from '../strengthSafetyFinalizer'

function context(overrides: Partial<StrengthContext> = {}): StrengthContext {
  return {
    phase: 'build', fatigueLevel: 3, recentExercises: [], safetyConstraints: [],
    goal: 'fuerza squash', sportProfile: 'sport_support', primarySport: 'squash',
    experienceLevel: 'intermediate', sessionDurationMin: 60,
    availableEquipment: ['barbell', 'dumbbell', 'bodyweight', 'bands', 'cable', 'ladder', 'mini_hurdles', 'treadmill', 'assault_bike'],
    ...overrides,
  }
}

const ids = (c: StrengthContext) => selectStrengthSession(c).exercises.map((exercise) => exercise.libraryRef!.id)

describe('catálogo de potencia, coordinación y finishers', () => {
  it.each(ATHLETIC_EXERCISES.map((exercise) => exercise.id))('%s tiene identidad, dosis y restricciones propias', (id) => {
    const exercise = getExerciseById(id)!
    for (const name of [exercise.name, ...exercise.aliases!]) expect(findStrengthExerciseByName(name)?.id, name).toBe(id)
    expect(exercise.safety.loadsRegions.length).toBeGreaterThan(0)
    expect(exercise.riskLevel).toBeDefined()
    expect(exercise.fatigueCost).toBeDefined()
    expect(exercise.loadReference).toBeUndefined()
    const manual = getCatalogForSport('strength').find((entry) => entry.libraryId === id)!
    const automatic = buildStrengthReplacementById(id, context({ experienceLevel: 'advanced' }), 1)!
    expect(manual.defaults.sets).toBe(automatic.sets)
    expect(manual.defaults.reps).toBe(String(automatic.reps))
    expect(manual.defaults.notes).toContain(exercise.athleticPrescription!.cues)
    expect(automatic.notes).toContain(exercise.athleticPrescription!.cues)
    expect(automatic.targetPercent1RM).toBeUndefined()
  })
  it('permite buscar mini vallas, escalera y el finisher exacto', () => {
    expect(searchCatalog('strength', 'mini valla').map((entry) => entry.libraryId)).toContain('mini_hurdle_lateral_rebounds')
    expect(searchCatalog('strength', 'escalera split-step').map((entry) => entry.libraryId)).toContain('ladder_split_step_acceleration')
    expect(searchCatalog('strength', 'cinta 30/30').map((entry) => entry.libraryId)).toContain('treadmill_30_30')
  })
  it('declara mini vallas y distingue cinta convencional de curva', () => {
    expect(resolveDeclaredEquipment(['mini vallas', 'cinta de correr', 'trotadora curva']).equipment)
      .toEqual(['mini_hurdles', 'treadmill', 'air_treadmill'])
  })
})

describe.each([undefined, 0, 1, 2])('selector atlético — bloque %s', (weekIndexInBlock) => {
  it('responde al objetivo horizontal sin duplicar el salto existente', () => {
    expect(ids(context({ weekIndexInBlock, goal: 'saltos horizontales buscando distancia en metros' }))).toContain('broad_jump')
  })
  it('selecciona mini vallas laterales cuando existen y se solicitan', () => {
    expect(ids(context({ weekIndexInBlock, goal: 'saltos laterales rapidos en mini vallas' }))).toContain('mini_hurdle_lateral_rebounds')
  })
  it('termina con un único finisher 4 × 30/30, cuatro minutos en total', () => {
    const selection = selectStrengthSession(context({ weekIndexInBlock, goal: 'finisher cinta 4 x 30 seg in 30 seg out' }))
    const finishers = selection.exercises.filter((exercise) => isFinisherExercise(resolveStrengthExercise(exercise)!.definition!))
    expect(finishers).toHaveLength(1)
    expect(finishers[0]).toMatchObject({ libraryRef: { id: 'treadmill_30_30' }, sets: 1, reps: '4 rondas: 30s fuerte / 30s suave (4 min)' })
    expect(selection.exercises.at(-1)?.libraryRef?.id).toBe('treadmill_30_30')
  })
  it('permite coordinación y finisher en la misma sesión', () => {
    const selection = selectStrengthSession(context({ weekIndexInBlock, sessionDurationMin: 65, goal: 'escalera y finisher en cinta 30/30' }))
    expect(selection.exercises.some((exercise) => getExerciseById(exercise.libraryRef!.id)?.athleticPrescription?.kind === 'coordination')).toBe(true)
    expect(selection.exercises.at(-1)?.libraryRef?.id).toBe('treadmill_30_30')
  })
  it('no inventa mini vallas, escalera ni cinta con peso corporal', () => {
    const selection = ids(context({ weekIndexInBlock, availableEquipment: ['bodyweight'], goal: 'mini vallas escalera finisher cinta' }))
    expect(selection.some((id) => getExerciseById(id)?.equipment.includes('mini_hurdles'))).toBe(false)
    expect(selection.some((id) => getExerciseById(id)?.equipment.includes('ladder'))).toBe(false)
    expect(selection.some((id) => isFinisherExercise(getExerciseById(id)!))).toBe(false)
  })
  it('limita la cantidad de ejercicios explosivos al ampliar el catálogo', () => {
    const selection = selectStrengthSession(context({ weekIndexInBlock, experienceLevel: 'advanced', sessionDurationMin: 75, goal: 'saltos horizontales y mini vallas' }))
    expect(selection.exercises.filter((exercise) => {
      const definition = resolveStrengthExercise(exercise)!.definition!
      return definition.intensityType === 'power' && !isFinisherExercise(definition)
    }).length).toBeLessThanOrEqual(2)
  })
})

describe('contexto y compatibilidad del trabajo atlético', () => {
  it.each([
    { fatigueLevel: 8 }, { competitionSoon: true }, { daysToCompetition: 2 },
    { requireExtraRecovery: true }, { phase: 'taper' as const }, { phase: 'race' as const },
  ])('no añade finishers en descarga (%j)', (overrides) => {
    for (const weekIndexInBlock of [undefined, 0, 1, 2]) {
      const selection = ids(context({ weekIndexInBlock, goal: 'finisher cinta 30/30 y mini vallas', ...overrides }))
      expect(selection.some((id) => isFinisherExercise(getExerciseById(id)!))).toBe(false)
      expect(selection).not.toContain('mini_hurdle_lateral_rebounds')
    }
  })
  it('un finisher no reemplaza un salto, una zancada ni un ejercicio de escalera', () => {
    for (const id of ['broad_jump', 'walking_lunge', 'ladder_lateral_crossover']) {
      const pool = getStrengthReplacementPool({ name: getExerciseById(id)!.name }, context({ experienceLevel: 'advanced' }))
      expect(pool.some((candidate) => isFinisherExercise(getExerciseById(candidate)!))).toBe(false)
    }
    const finisherPool = getStrengthReplacementPool({ name: getExerciseById('treadmill_30_30')!.name }, context())
    expect(finisherPool.length).toBeGreaterThan(0)
    expect(finisherPool.every((id) => isFinisherExercise(getExerciseById(id)!))).toBe(true)
  })
  it('no selecciona saltos, vallas o carrera si está excluido el impacto', () => {
    const c = context({ safetyConstraints: [{ kind: 'load_pattern', pattern: 'impact', sources: ['restrictions'] }] })
    for (const id of ['broad_jump', 'mini_hurdle_lateral_rebounds', 'treadmill_30_30']) {
      expect(buildStrengthReplacementById(id, c, 1)).toBeUndefined()
    }
    expect(buildStrengthReplacementById('assault_bike_15_45', c, 1)).toBeDefined()
  })
  it('la normalización conserva dosis y coloca el finisher después de la escalera', () => {
    const exercises = ['treadmill_30_30', 'ladder_split_step_acceleration'].map((id) => buildStrengthReplacementById(id, context(), 1)!)
    const enhanced = enhanceStrengthSessionExercises(exercises, { durationMin: 30, safetyConstraints: [] })!
    expect(enhanced.at(-1)).toMatchObject({ libraryRef: { id: 'treadmill_30_30' }, sets: 1, reps: exercises[0].reps })
  })
  it('el finalizador también retira el finisher con fatiga aunque venga de la IA', () => {
    const result = finalizeStrengthExercisesForRestrictions({
      exercises: [buildStrengthReplacementById('treadmill_30_30', context(), 1)!],
      constraints: [], durationMin: 60, sessionType: 'strength', userMessage: '', supersetMode: 'off',
      selectionContext: context({ fatigueLevel: 8 }),
    })
    expect(result.removed).toContainEqual({ exerciseId: 'treadmill_30_30', reason: 'training_context', matchedConstraints: [] })
    if (result.status === 'ok') expect(result.exercises.some((exercise) => isFinisherExercise(resolveStrengthExercise(exercise)!.definition!))).toBe(false)
  })
  it('el finalizador limita a un finisher y respeta la duración real de la sesión', () => {
    const exercises = ['treadmill_30_30', 'assault_bike_15_45'].map((id) => buildStrengthReplacementById(id, context(), 1)!)
    for (const durationMin of [30, 60]) {
      const result = finalizeStrengthExercisesForRestrictions({
        exercises, durationMin, constraints: [], sessionType: 'strength', userMessage: '', supersetMode: 'off', selectionContext: context(),
      })
      if (durationMin === 30) {
        expect(result.removed.filter((item) => item.reason === 'training_context')).toHaveLength(2)
      } else {
        expect(result.removed).toContainEqual({ exerciseId: 'assault_bike_15_45', reason: 'training_context', matchedConstraints: [] })
      }
      if (result.status === 'ok') expect(result.exercises.filter((exercise) => isFinisherExercise(resolveStrengthExercise(exercise)!.definition!)).length)
        .toBeLessThanOrEqual(durationMin === 30 ? 0 : 1)
    }
  })
})

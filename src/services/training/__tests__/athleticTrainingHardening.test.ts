import { describe, expect, it } from 'vitest'
import { EQUIPMENT_PRESETS } from '../equipmentPresets'
import {
  ALL_EQUIPMENT,
  detectEquipmentMentionsInName,
  hasExerciseEquipment,
  resolveDeclaredEquipment,
} from '../equipmentVocabulary'
import {
  findStrengthExerciseByName,
  getExerciseById,
  isImpactPowerExercise,
  STRENGTH_EXERCISE_LIBRARY,
} from '../exerciseLibrary'
import { athleticPreferenceScore, isAthleticWorkAllowed } from '../athleticTraining'
import { finalizeStrengthExercisesForRestrictions } from '../strengthSafetyFinalizer'
import {
  blockedStrengthCopy,
  BLOCKED_STRENGTH_COPY,
  BLOCKED_STRENGTH_TRAINING_CONTEXT_COPY,
} from '../strengthSafetyCopy'
import { selectStrengthSession, type StrengthContext } from '../strengthSelector'

function context(overrides: Partial<StrengthContext> = {}): StrengthContext {
  return {
    phase: 'build', fatigueLevel: 3, recentExercises: [], safetyConstraints: [],
    goal: 'fuerza para squash', primarySport: 'squash', sportProfile: 'sport_support',
    experienceLevel: 'advanced', sessionDurationMin: 60,
    ...overrides,
  }
}

const idsOf = (c: StrengthContext) => selectStrengthSession(c).exercises.map((e) => e.libraryRef!.id)

describe('«cinta» no es equipamiento dentro de un nombre', () => {
  it.each(['Remo con cinta elastica', 'Press banca con cinta elástica', 'Jalón con cintas elásticas'])(
    '%s no pide una trotadora', (name) => {
      expect(detectEquipmentMentionsInName(name).requested).not.toContain('treadmill')
    },
  )

  it('ningún ejercicio deja de resolver por llevar «cinta elástica» en el nombre', () => {
    // El token suelto hacía que `filterCandidatesByNamedEquipment` exigiera
    // `treadmill` y dejaba sin identidad a decenas de ejercicios de barra.
    const unresolved = STRENGTH_EXERCISE_LIBRARY.filter((definition) =>
      detectEquipmentMentionsInName(`${definition.name} con cinta elastica`).requested.includes('treadmill'),
    )
    expect(unresolved).toEqual([])
    expect(findStrengthExerciseByName('Press banca con cinta elastica')?.id).toBe('bench_press')
  })

  it('la secuencia completa sí nombra la máquina y la curva conserva su identidad', () => {
    expect(detectEquipmentMentionsInName('Intervalos en cinta de correr').requested).toEqual(['treadmill'])
    expect(findStrengthExerciseByName('Trotadora curva 20/20')?.id).toBe('air_treadmill_20_20')
    expect(findStrengthExerciseByName('Cinta 30/30 — 4 rondas')?.id).toBe('treadmill_30_30')
  })
})

describe('inventario declarado', () => {
  it('«cinta elástica» es una banda, no una cinta de correr', () => {
    expect(resolveDeclaredEquipment(['cinta elastica']).equipment).toEqual(['bands'])
    expect(resolveDeclaredEquipment(['bandas elásticas']).equipment).toEqual(['bands'])
  })

  it.each(['trotadora', 'cinta'])(
    '«%s» a secas conserva la curva que ya acreditaba, sin perder la convencional', (value) => {
      // Migración: antes de la ampliación estos textos significaban `air_treadmill`.
      // Reasignarlos sólo a `treadmill` le quitaba en silencio un ejercicio al
      // atleta que ya lo tenía.
      expect(resolveDeclaredEquipment([value]).equipment).toEqual(
        expect.arrayContaining(['treadmill', 'air_treadmill']),
      )
    },
  )

  it('el texto preciso no se vuelve ambiguo', () => {
    expect(resolveDeclaredEquipment(['cinta de correr']).equipment).toEqual(['treadmill'])
    expect(resolveDeclaredEquipment(['trotadora curva']).equipment).toEqual(['air_treadmill'])
  })
})

describe('presets de equipamiento', () => {
  it('«Gimnasio completo» declara la lista entera', () => {
    const full = EQUIPMENT_PRESETS.find((preset) => preset.id === 'full_gym')!
    expect([...full.equipment].sort()).toEqual([...ALL_EQUIPMENT].sort())
  })

  it('ningún ejercicio del catálogo es inalcanzable con el gimnasio completo', () => {
    const full = EQUIPMENT_PRESETS.find((preset) => preset.id === 'full_gym')!
    const unreachable = STRENGTH_EXERCISE_LIBRARY
      .filter((exercise) => !hasExerciseEquipment(exercise, full.equipment))
      .map((exercise) => exercise.id)
    expect(unreachable).toEqual([])
  })
})

describe('el freno agudo va por categoría, no por tabla de dosis', () => {
  const acute: Array<[string, Partial<StrengthContext>]> = [
    ['fatiga 7', { fatigueLevel: 7 }],
    ['competencia declarada', { competitionSoon: true }],
    ['competencia en 2 días', { daysToCompetition: 2 }],
    ['recuperación extra', { requireExtraRecovery: true }],
    ['ACWR en riesgo', { strengthAcwr: { status: 'risk' } as StrengthContext['strengthAcwr'] }],
  ]

  it('cubre todo el trabajo de impacto del catálogo, no sólo el que tiene dosis atlética', () => {
    const impact = STRENGTH_EXERCISE_LIBRARY.filter(isImpactPowerExercise)
    // La regresión concreta: con la tabla como criterio pasaban justo los de
    // mayor demanda, porque nunca recibieron `athleticPrescription`.
    expect(impact.map((exercise) => exercise.id)).toEqual(
      expect.arrayContaining(['depth_jump', 'drop_jump', 'barbell_jump_squat', 'jump_squat', 'pogo_jumps']),
    )
    expect(impact.filter((exercise) => !exercise.athleticPrescription).length).toBeGreaterThan(0)
  })

  it.each(acute)('%s frena todo el impacto', (_label, overrides) => {
    const c = context({ phase: 'peak', ...overrides })
    for (const exercise of STRENGTH_EXERCISE_LIBRARY.filter(isImpactPowerExercise)) {
      expect(isAthleticWorkAllowed(exercise, c), exercise.id).toBe(false)
    }
  })

  it.each(acute)('%s no deja ningún ejercicio de impacto en la sesión', (_label, overrides) => {
    const selected = idsOf(context({
      phase: 'peak', goal: 'potencia, saltos y pliometria',
      availableEquipment: ['box', 'bodyweight', 'barbell', 'mini_hurdles'],
      ...overrides,
    }))
    expect(selected.filter((id) => isImpactPowerExercise(getExerciseById(id)!))).toEqual([])
  })

  it('la potencia sin impacto no se frena por la misma regla', () => {
    // `push_press` y `clean_high_pull` son potencia cargada, no recepción.
    for (const id of ['push_press', 'clean_high_pull', 'kettlebell_swing']) {
      expect(isImpactPowerExercise(getExerciseById(id)!), id).toBe(false)
    }
  })
})

describe('bloqueo por contexto de entrenamiento', () => {
  const exercise = (id: string) => ({
    name: getExerciseById(id)!.name,
    libraryRef: { source: 'strength_exercise' as const, id },
    sets: 3,
    reps: 5,
  })

  it('sin ninguna restricción registrada no se reporta como restricción', () => {
    const result = finalizeStrengthExercisesForRestrictions({
      exercises: ['back_squat', 'broad_jump', 'pogo_jumps', 'assault_bike_30_30'].map(exercise),
      constraints: [],
      userMessageConstraints: [],
      userMessage: '',
      selectionContext: context({ phase: 'taper', sessionDurationMin: 50, availableEquipment: ['barbell', 'dumbbell', 'bodyweight', 'assault_bike'] }),
      durationMin: 50,
      densityCompletion: 'preserve',
    })

    expect(result.status).toBe('blocked')
    expect(result.status === 'blocked' && result.reason).toBe('training_context_unavailable')
    expect(result.removed.every((item) => item.reason === 'training_context')).toBe(true)
    expect(blockedStrengthCopy('training_context_unavailable')).toBe(BLOCKED_STRENGTH_TRAINING_CONTEXT_COPY)
    expect(blockedStrengthCopy('training_context_unavailable')).not.toContain('restricción registrada')
  })

  it('una restricción real sigue usando el copy conservador', () => {
    expect(blockedStrengthCopy('insufficient_safe_pool')).toBe(BLOCKED_STRENGTH_COPY)
    expect(blockedStrengthCopy(undefined)).toBe(BLOCKED_STRENGTH_COPY)
  })
})

describe('preferencias del objetivo', () => {
  it.each([
    'apoyo de fuerza para correr 10 mil metros',
    'mejorar distancia de zancada al correr',
    'fuerza general, ganar distancia en la carrera',
  ])('«%s» no asciende pliometría horizontal', (goal) => {
    expect(athleticPreferenceScore(getExerciseById('broad_jump')!, goal)).toBe(0)
  })

  it.each(['saltos horizontales buscando distancia en metros', 'saltar mas lejos', 'bounding'])(
    '«%s» sí la asciende', (goal) => {
      expect(athleticPreferenceScore(getExerciseById('broad_jump')!, goal)).toBeGreaterThan(0)
    },
  )

  it('un número suelto no elige el intervalo; su grafía sí', () => {
    const machines = ['treadmill_30_30', 'air_treadmill_20_20', 'assault_bike_30_30', 'assault_bike_15_45']
    const pick = (goal: string) => idsOf(context({
      goal, availableEquipment: ['barbell', 'dumbbell', 'bodyweight', 'assault_bike', 'air_treadmill', 'treadmill', 'ladder'],
    })).filter((id) => machines.includes(id))

    expect(pick('trotadora curva, 30 min')).toEqual(['air_treadmill_20_20'])
    expect(pick('bici de asalto 15 min')).toEqual(['assault_bike_30_30'])
    expect(pick('finisher cinta 30/30')).toEqual(['treadmill_30_30'])
    expect(pick('bici de asalto 15/45')).toEqual(['assault_bike_15_45'])
  })
})

describe('cobertura de tren inferior', () => {
  it.each(['beginner', 'intermediate', 'advanced'] as const)(
    'una sesión de apoyo de %s trae trabajo real de piernas', (experienceLevel) => {
      for (const availableEquipment of [
        undefined,
        ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight'],
        ['dumbbell', 'bands', 'bodyweight'],
      ]) {
        for (const weekIndexInBlock of [undefined, 0, 1, 2]) {
          const definitions = idsOf(context({ phase: 'base', experienceLevel, availableEquipment, weekIndexInBlock }))
            .map((id) => getExerciseById(id)!)
          const lower = definitions.filter((exercise) =>
            exercise.category === 'lower'
            && exercise.isolation !== true
            && exercise.intensityType !== 'power'
            && exercise.intensityType !== 'recovery',
          )
          expect(lower.length, `${experienceLevel}/${availableEquipment ?? 'sin declarar'}/${weekIndexInBlock}`).toBeGreaterThan(0)
        }
      }
    },
  )

  it('el nivel principiante sigue siendo estricto mientras cubre el patrón', () => {
    const definitions = idsOf(context({ phase: 'base', experienceLevel: 'beginner' })).map((id) => getExerciseById(id)!)
    for (const exercise of definitions) expect(exercise.difficulty, exercise.id).toBe('beginner')
  })
})

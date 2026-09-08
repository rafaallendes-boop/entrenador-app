import { describe, expect, it } from 'vitest'
import { findStrengthExerciseByName, getExerciseById, isMainLiftEligible } from '../exerciseLibrary'
import { enhanceStrengthSessionExercises } from '../strengthSessionStructure'
import { selectStrengthSession, type StrengthContext } from '../strengthSelector'

const IDS = [
  'machine_incline_chest_press', 'machine_hack_squat', 'machine_glute_drive',
  'machine_glute_kickback', 'machine_biceps_curl', 'machine_triceps_extension',
  'machine_assisted_dip', 'machine_lateral_raise', 'cable_biceps_curl',
  'cable_face_pull', 'cable_chest_fly', 'cable_straight_arm_pulldown',
  'smith_squat', 'smith_bench_press', 'smith_incline_press',
]

describe('segunda tanda de máquinas, poleas y Smith', () => {
  it.each(IDS)('%s conserva identidad, seguridad y esfuerzo independiente de barra', id => {
    const definition = getExerciseById(id)!
    expect(definition).toBeDefined()
    for (const name of [definition.name, ...(definition.aliases ?? [])]) {
      expect(findStrengthExerciseByName(name)?.id, name).toBe(id)
    }
    expect(definition.safety.loadsRegions.length).toBeGreaterThan(0)
    expect(definition.appropriateForPhases?.length).toBeGreaterThan(0)
    expect(definition.loadReference).toBeUndefined()
    if (definition.isolation) expect(isMainLiftEligible(definition)).toBe(false)
    const enhanced = enhanceStrengthSessionExercises([{ name: definition.name, sets: 3, reps: 10 }], {
      durationMin: 30, safetyConstraints: [],
      strengthProfile: { squat1RM: 140, benchPress1RM: 100, deadlift1RM: 180, overheadPress1RM: 60 },
    })![0]!
    expect(enhanced.targetRpe).toEqual(expect.any(Number))
    expect(enhanced.weight).toBeUndefined()
    expect(enhanced.targetPercent1RM).toBeUndefined()
  })

  it('limita aislamientos y respeta inventario en los dos caminos de selección', () => {
    const inventories: NonNullable<StrengthContext['availableEquipment']>[] = [
      ['machine'], ['smith', 'bodyweight'], ['cable', 'bodyweight'], ['dumbbell', 'bands', 'bodyweight'],
    ]
    for (const availableEquipment of inventories) {
      for (const phase of ['base', 'build', 'peak', 'taper'] as const) {
        for (const sportProfile of ['strength_primary', 'hybrid', 'sport_support'] as const) {
          for (const block of [false, true]) {
            for (const fatigueLevel of [4, 7]) {
              const context: StrengthContext = {
                phase, sportProfile, fatigueLevel, availableEquipment, primarySport: 'squash',
                goal: 'fuerza de apoyo', recentExercises: [], safetyConstraints: [],
                sessionDurationMin: 60, experienceLevel: 'intermediate',
                ...(block ? { weekIndexInBlock: 0, available1RM: [] } : {}),
              }
              const session = selectStrengthSession(context)
              const definitions = session.exercises.map(exercise => findStrengthExerciseByName(exercise.name)!)
              const label = JSON.stringify(context)
              expect(definitions.length, label).toBeGreaterThan(0)
              expect(definitions.every(def => def?.equipment.some(item => availableEquipment.includes(item))), label).toBe(true)
              expect(definitions.filter(def => def.isolation).length, label).toBeLessThanOrEqual(2)
            }
          }
        }
      }
    }
  })
})

import { describe, expect, it } from 'vitest'

import { resolveDeclaredEquipment } from '../equipmentVocabulary'
import { EQUIPMENT_LABELS, EQUIPMENT_PRESETS, matchEquipmentPreset } from '../equipmentPresets'
import { STRENGTH_EXERCISE_LIBRARY } from '../exerciseLibrary'
import { filterByEquipment } from '../strengthSelector'

describe('presets de equipamiento', () => {
  it('casa sólo habilita el material anunciado', () => {
    expect(EQUIPMENT_PRESETS.find(preset => preset.id === 'home')?.equipment)
      .toEqual(['dumbbell', 'bands', 'bodyweight'])
  })

  it('cada preset deja trabajo de fuerza real disponible', () => {
    for (const preset of EQUIPMENT_PRESETS) {
      const usable = filterByEquipment(STRENGTH_EXERCISE_LIBRARY, preset.equipment)
      expect(usable.length, `${preset.id} sin ejercicios`).toBeGreaterThan(10)
    }
  })

  it('el preset de máquinas habilita las altas de máquina y no la barra libre', () => {
    const machineGym = EQUIPMENT_PRESETS.find((preset) => preset.id === 'machine_gym')!
    const usable = filterByEquipment(STRENGTH_EXERCISE_LIBRARY, machineGym.equipment).map((item) => item.id)

    expect(usable).toContain('leg_press_45')
    expect(usable).toContain('machine_chest_press')
    expect(usable).not.toContain('back_squat')
    expect(usable).not.toContain('deadlift')
  })

  it('lo que el preset guarda es lo que el vocabulario devuelve', () => {
    // Si el inventario guardado no sobrevive la interpretación, la captura
    // mentiría: el atleta vería un preset y el selector usaría otra cosa.
    for (const preset of EQUIPMENT_PRESETS) {
      const resolved = resolveDeclaredEquipment(preset.equipment)
      expect(resolved.declared).toBe(true)
      expect(resolved.unrecognized).toEqual([])
      expect([...resolved.equipment].sort()).toEqual([...preset.equipment].sort())
    }
  })

  it('reconoce el preset guardado y distingue una selección propia', () => {
    const home = EQUIPMENT_PRESETS.find((preset) => preset.id === 'home')!
    expect(matchEquipmentPreset(home.equipment)).toBe('home')
    expect(matchEquipmentPreset(['dumbbell'])).toBe('custom')
    expect(matchEquipmentPreset(undefined)).toBeUndefined()
  })

  it('toda familia de equipamiento tiene etiqueta visible', () => {
    const declared = new Set(STRENGTH_EXERCISE_LIBRARY.flatMap((exercise) => exercise.equipment))
    for (const item of declared) expect(EQUIPMENT_LABELS[item], item).toBeTruthy()
  })
})

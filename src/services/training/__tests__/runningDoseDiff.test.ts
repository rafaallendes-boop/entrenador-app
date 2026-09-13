import { describe, expect, it } from 'vitest'
import { materializeRunningTemplate } from '../runningTemplateMaterializer'
import { describeRunningDoseDiff, validateManualPaceAgainstStructure } from '../runningDoseDiff'

const dose = (durationMin: number, profile = { fiveKTime: '25:00' }) => {
  const result = materializeRunningTemplate({ template: 'repeats_400', durationMin, profile, intent: 'progress' })
  if (!result.ok) throw new Error(result.message)
  return result.structure
}

describe('describeRunningDoseDiff', () => {
  it('nombra el cambio de repeticiones y de minutos de trabajo', () => {
    const lines = describeRunningDoseDiff(dose(60), dose(45))
    expect(lines.some(line => /repeticiones: 11 → \d+/.test(line))).toBe(true)
    expect(lines.some(line => /trabajo: \d+ → \d+ min/.test(line))).toBe(true)
  })
  it('nombra el cambio de ritmo cuando cambia el perfil', () => {
    const lines = describeRunningDoseDiff(dose(60), dose(60, { fiveKTime: '23:00' }))
    expect(lines.some(line => /ritmo de trabajo: .* → .*/.test(line))).toBe(true)
  })
  it('sin cambios devuelve una sola línea que lo dice', () => {
    expect(describeRunningDoseDiff(dose(60), dose(60))).toEqual(['la dosis resultante es la misma'])
  })
})

describe('validateManualPaceAgainstStructure', () => {
  it('acepta un rango que se solapa con los ritmos de trabajo de los bloques', () => {
    const structure = dose(60)
    const work = structure.blocks.find(block => block.distanceKm === 0.4)!.targetPace! // p.ej. "4:36 /km"
    const [min, sec] = work.replace(' /km', '').split(':').map(Number)
    const faster = `${min}:${String(Math.max(0, sec - 10)).padStart(2, '0')}`
    const slower = `${min}:${String(sec + 10).padStart(2, '0')}`
    expect(validateManualPaceAgainstStructure(faster, slower, structure).ok).toBe(true)
  })
  it('rechaza un rango incompatible con los bloques', () => {
    const result = validateManualPaceAgainstStructure('6:30', '7:00', dose(60))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('no corresponden a los bloques')
  })
  it('sin ritmos manuales no opina', () => {
    expect(validateManualPaceAgainstStructure(undefined, undefined, dose(60)).ok).toBe(true)
  })
})

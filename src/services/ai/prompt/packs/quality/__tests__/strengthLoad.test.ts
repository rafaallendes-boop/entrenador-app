import { describe, expect, it } from 'vitest'

import { buildStrengthLoadPack } from '../strengthLoad'

describe('buildStrengthLoadPack', () => {
  it('renders the load prescription rules and lists every 1RM when profile is populated', () => {
    const output = buildStrengthLoadPack({
      strengthProfile: {
        benchPress1RM: 100,
        squat1RM: 140,
        deadlift1RM: 180,
        overheadPress1RM: 65,
        pullUpMaxReps: 14,
      },
    })

    expect(output).toContain('1RMs disponibles del atleta')
    expect(output).toContain('sentadilla 140kg')
    expect(output).toContain('peso muerto 180kg')
    expect(output).toContain('press banca 100kg')
    expect(output).toContain('targetPercent1RM')
    expect(output).toContain('warmupSets')
    // Equivalence table for derived lifts
    expect(output).toContain('press inclinado')
    expect(output).toContain('hip thrust')
  })

  it('falls back to RPE-only mode when no 1RMs are available', () => {
    const output = buildStrengthLoadPack({ strengthProfile: undefined })
    expect(output).toContain('no tiene 1RMs cargados')
    expect(output).toContain('NO inventes pesos')
    expect(output).toContain('targetRpe')
    expect(output).toContain('Omite weight')
  })

  it('falls back to RPE-only mode when profile has only non-numeric fields', () => {
    const output = buildStrengthLoadPack({ strengthProfile: { notes: 'leve dolor lumbar' } })
    expect(output).toContain('no tiene 1RMs cargados')
  })
})

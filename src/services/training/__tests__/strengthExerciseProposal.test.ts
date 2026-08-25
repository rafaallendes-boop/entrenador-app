import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type { StrengthSelectionExercise } from '../strengthSelector'
import {
  getStrengthExerciseKey,
  toModelFacingProposal,
  toStrengthProposal,
  toStrengthProposalForEnhancement,
} from '../strengthExerciseProposal'

const SELECTION: StrengthSelectionExercise = {
  name: 'Sentadilla trasera con barra',
  sets: 4,
  reps: 5,
  intensity: 'heavy',
  notes: 'Tronco firme.',
  group: 'legs',
  targetPercent1RM: 80,
  targetRpe: 8,
  libraryRef: { source: 'strength_exercise', id: 'back_squat' },
}

describe('conversión canónica a CoachExerciseProposal', () => {
  it('lleva la unión completa de campos, incluido el ref', () => {
    expect(toStrengthProposal(SELECTION)).toEqual({
      name: 'Sentadilla trasera con barra',
      sets: 4,
      reps: 5,
      group: 'legs',
      notes: 'Tronco firme.',
      targetPercent1RM: 80,
      targetRpe: 8,
      libraryRef: { source: 'strength_exercise', id: 'back_squat' },
    })
  })

  it('el envoltorio model-facing expone exactamente los campos del prompt', () => {
    expect(Object.keys(toModelFacingProposal(SELECTION)).sort())
      .toEqual(['group', 'name', 'notes', 'reps', 'sets'])
  })

  it('la proyección pre-enrichment conserva el ref pero no adelanta targets', () => {
    expect(toStrengthProposalForEnhancement(SELECTION)).toEqual({
      name: 'Sentadilla trasera con barra',
      sets: 4,
      reps: 5,
      group: 'legs',
      notes: 'Tronco firme.',
      libraryRef: { source: 'strength_exercise', id: 'back_squat' },
    })
  })

  it('el envoltorio model-facing no filtra ref, porcentaje ni RPE', () => {
    const proposal = toModelFacingProposal(SELECTION) as Record<string, unknown>
    expect(proposal.libraryRef).toBeUndefined()
    expect(proposal.targetPercent1RM).toBeUndefined()
    expect(proposal.targetRpe).toBeUndefined()
  })

  it('el envoltorio model-facing anota la intensidad en las notas', () => {
    expect(toModelFacingProposal(SELECTION).notes).toBe('Tronco firme. [heavy]')
    expect(toModelFacingProposal({ ...SELECTION, notes: undefined }).notes).toBe('[heavy]')
  })

  it('ninguna ruta convierte a propuesta con un literal inline', () => {
    const sites = [
      {
        file: 'src/services/ai/actionPostProcessor.ts',
        canonicalCalls: /\.map\(toStrengthProposalForEnhancement\)/g,
        expectedCalls: 3,
      },
      {
        file: 'src/services/planBuilder/repairWeek.ts',
        canonicalCalls: /(?:\.map\(toStrengthProposal\)|=\s*toStrengthProposal\(replacement\))/g,
        // La densidad ahora centraliza su conversión en
        // `selectStrengthDensityCandidates`; los dos sitios restantes son la
        // materialización de allocator y la hidratación completa.
        expectedCalls: 2,
      },
      {
        file: 'src/services/ai/promptModules/strengthPrompt.ts',
        canonicalCalls: /export const toCoachExerciseProposal = toModelFacingProposal/g,
        expectedCalls: 1,
      },
    ]

    for (const { file, canonicalCalls, expectedCalls } of sites) {
      const source = readFileSync(file, 'utf-8')
      expect(source).not.toMatch(/exercises\s*\.?\s*map\s*\(\s*\(\s*\w+\s*\)\s*=>\s*\(\{\s*\n\s*name:/)
      expect(source.match(canonicalCalls)).toHaveLength(expectedCalls)
    }
  })
})

describe('identidad de rotación y deduplicación', () => {
  it('un ref vivo define la identidad', () => {
    expect(getStrengthExerciseKey({
      name: 'Nombre libre irreconocible',
      libraryRef: { source: 'strength_exercise', id: 'back_squat' },
    })).toBe('back_squat')
  })

  it('sin ref cae al id resuelto por nombre', () => {
    expect(getStrengthExerciseKey({ name: 'Press banca' })).toBe('bench_press')
  })

  it('un fragmento ambiguo cae al nombre normalizado', () => {
    expect(getStrengthExerciseKey({ name: 'press' })).toBe('press')
  })
})

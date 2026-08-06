import { describe, expect, it } from 'vitest'

import { resolveStrengthExercise } from '../exerciseLibrary'
import { normalizeStrengthSessionExercises } from '../strengthSessionStructure'
import type { StrengthPhase, StrengthSportProfile } from '../strengthSelector'
import { planSupersetGroups, shouldApplySupersetPolicy } from '../supersetPolicy'

type Scenario = {
  label: string
  durationMin: number
  phase: StrengthPhase
  sportProfile: StrengthSportProfile
  exercises: Array<{ name: string; sets: number; reps: string }>
}

const CORPUS: Scenario[] = [
  {
    label: 'squash sport_support 60min',
    durationMin: 60,
    phase: 'base',
    sportProfile: 'sport_support',
    exercises: [
      { name: 'Plancha frontal', sets: 3, reps: '30s' },
      { name: 'Pallof press', sets: 3, reps: '10' },
      { name: 'Peso muerto con trap bar', sets: 4, reps: '5' },
      { name: 'Remo con pecho apoyado', sets: 3, reps: '10' },
      { name: 'Press vertical', sets: 3, reps: '8' },
      { name: 'Bici de asalto 30/30', sets: 1, reps: '4 min' },
    ],
  },
  {
    label: 'strength_primary 70min con potencia',
    durationMin: 70,
    phase: 'build',
    sportProfile: 'strength_primary',
    exercises: [
      { name: 'Plancha lateral', sets: 3, reps: '30s' },
      { name: 'Dead bug — control de tronco', sets: 3, reps: '10' },
      { name: 'Clean', sets: 4, reps: '3' },
      { name: 'Dominadas', sets: 4, reps: '6' },
      { name: 'Sentadilla trasera con barra', sets: 4, reps: '5' },
      { name: 'Salto al cajon', sets: 4, reps: '4' },
    ],
  },
  {
    label: 'sets divergentes',
    durationMin: 60,
    phase: 'base',
    sportProfile: 'strength_primary',
    exercises: [
      { name: 'Peso muerto con trap bar', sets: 5, reps: '3' },
      { name: 'Salto al cajon', sets: 3, reps: '4' },
      { name: 'Plancha frontal', sets: 3, reps: '30s' },
      { name: 'Pallof press', sets: 4, reps: '10' },
    ],
  },
]

describe('auditoria de la politica de superseries', () => {
  // Un nombre que no resuelve cae en rol `unknown` y bloque `other`, asi que
  // desaparece de todas las reglas y el snapshot registra un descarte que la
  // politica nunca decidio. Sin este guard, un fixture mal escrito produce una
  // auditoria que se lee como valida y no lo es.
  it('todo el corpus resuelve contra el catalogo vivo', () => {
    const unresolved = CORPUS.flatMap(({ label, exercises }) => exercises
      .filter((exercise) => resolveStrengthExercise(exercise)?.definition == null)
      .map((exercise) => `${label}: ${exercise.name}`))

    expect(unresolved).toEqual([])
  })

  it('produce un reporte legible de grupos y descartes', () => {
    const report = CORPUS.map(({ label, durationMin, phase, sportProfile, exercises }) => {
      const input = normalizeStrengthSessionExercises(exercises, { durationMin }) ?? []
      const mode = shouldApplySupersetPolicy({ phase, sportProfile, sessionDurationMin: durationMin })
      const { exercises: grouped, decisions } = planSupersetGroups(input, mode)
      const nameOf = (index: number) => input[index]?.name

      return {
        label,
        mode,
        groups: decisions
          .filter((decision) => decision.outcome === 'grouped')
          .map((decision) => ({ rule: decision.rule, members: decision.memberIndexes.map(nameOf) })),
        discarded: decisions
          .filter((decision) => decision.outcome !== 'grouped')
          .map((decision) => ({
            rule: decision.rule,
            reason: decision.outcome,
            members: decision.memberIndexes.map(nameOf),
          })),
        finalOrder: grouped.map((exercise) => `${exercise.name}${exercise.supersetGroup ? ' *' : ''}`),
      }
    })

    expect(report).toMatchSnapshot()
  })

  it('explica cardio como bloqueo de elegibilidad', () => {
    const input = normalizeStrengthSessionExercises(CORPUS[0]!.exercises, { durationMin: 60 }) ?? []
    const { decisions } = planSupersetGroups(input, 'permissive')
    const blocked = decisions.filter((decision) => decision.outcome === 'blocked_kind')

    expect(blocked.length).toBeGreaterThan(0)
    expect(blocked.every((decision) => decision.rule === 'eligibility')).toBe(true)
  })

  it('explica los descartes por sets incompatibles', () => {
    const input = normalizeStrengthSessionExercises(CORPUS[2]!.exercises, { durationMin: 60 }) ?? []
    const { decisions } = planSupersetGroups(input, 'full')

    expect(decisions.some((decision) => decision.outcome === 'sets_mismatch')).toBe(true)
  })
})

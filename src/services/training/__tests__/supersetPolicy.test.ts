import { describe, expect, it } from 'vitest'

import { resolveSessionStrengthRoles } from '../../planBuilder/strengthRoleContract'
import { normalizeSupersetGroups } from '../supersetGroups'
import {
  isOlympicPowerExercise,
  isPlyometricExercise,
  planSupersetGroups,
  type SupersetRule,
} from '../supersetPolicy'

const ex = (name: string, sets: number) => ({ name, sets })

function withoutSupersetGroup<T extends object>(value: T): T {
  const copy = { ...value } as T & { supersetGroup?: string }
  delete copy.supersetGroup
  return copy
}

describe('predicados de superseries', () => {
  it('reconoce power olimpico por el tag olympic_power', () => {
    expect(isOlympicPowerExercise(ex('Clean', 4))).toBe(true)
    expect(isOlympicPowerExercise(ex('Push press', 4))).toBe(false)
  })

  it('reconoce pliometricos solo por la allowlist de ids', () => {
    expect(isPlyometricExercise(ex('Salto al cajon', 4))).toBe(true)
    expect(isPlyometricExercise(ex('Sentadilla con salto', 4))).toBe(true)
    expect(isPlyometricExercise(ex('Push press', 4))).toBe(false)
    expect(isPlyometricExercise(ex('Sentadilla con salto y barra', 4))).toBe(false)
  })
})

describe('planSupersetGroups', () => {
  it('en off conserva grupos existentes y no crea otros', () => {
    const input = [
      { name: 'Clean', sets: 4, supersetGroup: 'g1' },
      { name: 'Dominadas', sets: 4, supersetGroup: 'g1' },
      ex('Plancha frontal', 3),
      ex('Pallof press', 3),
    ]

    const { exercises, decisions } = planSupersetGroups(input, 'off')

    expect(exercises[0]!.supersetGroup).toBe('g1')
    expect(exercises[1]!.supersetGroup).toBe('g1')
    expect(exercises[2]!.supersetGroup).toBeUndefined()
    expect(decisions).toEqual([])
  })

  it('en permissive arma el circuito de zona media', () => {
    const { exercises } = planSupersetGroups([
      ex('Plancha frontal', 3),
      ex('Pallof press', 3),
      ex('Peso muerto con trap bar', 4),
    ], 'permissive')

    expect(exercises[0]!.supersetGroup).toBeDefined()
    expect(exercises[0]!.supersetGroup).toBe(exercises[1]!.supersetGroup)
    expect(exercises[2]!.supersetGroup).toBeUndefined()
  })

  it('en permissive no empareja potencia ni main_lift', () => {
    const { exercises } = planSupersetGroups([
      ex('Peso muerto con trap bar', 4),
      ex('Salto al cajon', 4),
    ], 'permissive')

    expect(exercises.every((exercise) => exercise.supersetGroup == null)).toBe(true)
  })

  it('registra sets_mismatch sin cambiar la prescripcion', () => {
    const { exercises, decisions } = planSupersetGroups([
      ex('Peso muerto con trap bar', 5),
      ex('Salto al cajon', 3),
    ], 'full')

    expect(exercises.every((exercise) => exercise.supersetGroup == null)).toBe(true)
    expect(decisions).toContainEqual(expect.objectContaining({
      rule: 'main_lift_plyo',
      outcome: 'sets_mismatch',
    }))
  })

  it('busca en todos los candidatos hasta encontrar sets compatibles', () => {
    const input = [
      ex('Peso muerto con trap bar', 4),
      ex('Salto horizontal', 3),
      ex('Salto al cajon', 4),
    ]

    const { exercises, decisions } = planSupersetGroups(input, 'full')
    const trapIndex = exercises.findIndex((exercise) => exercise.name === 'Peso muerto con trap bar')

    expect(exercises[trapIndex + 1]!.name).toBe('Salto al cajon')
    expect(exercises[trapIndex]!.supersetGroup).toBe(exercises[trapIndex + 1]!.supersetGroup)
    expect(decisions).toContainEqual(expect.objectContaining({
      rule: 'main_lift_plyo',
      outcome: 'grouped',
      anchorIndex: 0,
      memberIndexes: [0, 2],
    }))
  })

  it('solo cambia orden y supersetGroup', () => {
    const input = [
      { name: 'Press vertical', sets: 3, reps: 10, weight: 20, note: 'push' },
      { name: 'Peso muerto con trap bar', sets: 4, reps: 5, weight: 90, note: 'main' },
      { name: 'Remo con pecho apoyado', sets: 3, reps: 12, weight: 24, note: 'pull' },
    ]

    const { exercises } = planSupersetGroups(input, 'permissive')
    const withoutTags = exercises
      .map(withoutSupersetGroup)
      .sort((left, right) => left.name.localeCompare(right.name))

    expect(withoutTags).toEqual([...input].sort((left, right) => left.name.localeCompare(right.name)))
  })

  it('arma el circuito core con la cohorte de sets mas grande', () => {
    const { exercises } = planSupersetGroups([
      ex('Plancha frontal', 5),
      ex('Pallof press', 3),
      ex('Plancha lateral', 3),
      ex('Dead bug — control de tronco', 3),
    ], 'permissive')

    const grouped = exercises.filter((exercise) => exercise.supersetGroup != null)
    expect(grouped).toHaveLength(3)
    expect(grouped.every((exercise) => exercise.sets === 3)).toBe(true)
  })

  it('olympic_pull no consume un pull que sea main_lift', () => {
    const { exercises, decisions } = planSupersetGroups([
      ex('Clean', 4),
      ex('Dominadas', 4),
    ], 'full')

    expect(exercises.every((exercise) => exercise.supersetGroup == null)).toBe(true)
    expect(decisions).toContainEqual(expect.objectContaining({
      rule: 'olympic_pull',
      outcome: 'no_eligible_partner',
    }))
  })

  it('olympic_pull empareja un movimiento olimpico con un pull accesorio', () => {
    const { exercises, decisions } = planSupersetGroups([
      ex('Clean', 4),
      ex('Peso muerto con trap bar', 4),
      ex('Dominadas', 4),
    ], 'full')
    const cleanIndex = exercises.findIndex((exercise) => exercise.name === 'Clean')

    expect(decisions).toContainEqual(expect.objectContaining({
      rule: 'olympic_pull',
      outcome: 'grouped',
    }))
    expect(exercises[cleanIndex + 1]!.name).toBe('Dominadas')
    expect(exercises[cleanIndex]!.supersetGroup).toBe(exercises[cleanIndex + 1]!.supersetGroup)
  })

  it('push_pull resuelve bloques de candidatos definidos solo por nombre', () => {
    const { exercises, decisions } = planSupersetGroups([
      ex('Peso muerto con trap bar', 4),
      ex('Press vertical', 3),
      ex('Remo con pecho apoyado', 3),
    ], 'permissive')
    const pressIndex = exercises.findIndex((exercise) => exercise.name === 'Press vertical')

    expect(decisions).toContainEqual(expect.objectContaining({
      rule: 'push_pull',
      outcome: 'grouped',
    }))
    expect(exercises[pressIndex + 1]!.name).toBe('Remo con pecho apoyado')
    expect(exercises[pressIndex]!.supersetGroup).toBe(exercises[pressIndex + 1]!.supersetGroup)
  })

  it('atribuye cardio y movilidad a eligibility', () => {
    const { exercises, decisions } = planSupersetGroups([
      ex('Plancha frontal', 3),
      ex('Pallof press', 3),
      ex('Bici de asalto 30/30', 1),
    ], 'permissive')

    const blocked = decisions.filter((decision) => decision.outcome === 'blocked_kind')
    expect(blocked).toHaveLength(1)
    expect(blocked[0]!.rule).toBe('eligibility')
    expect(exercises.find((exercise) => exercise.name === 'Bici de asalto 30/30')!.supersetGroup)
      .toBeUndefined()
  })
})

describe('reflow', () => {
  const CROSS_BLOCK = [
    ex('Peso muerto con trap bar', 4),
    ex('Press vertical', 4),
    ex('Remo con pecho apoyado', 4),
    ex('Salto al cajon', 4),
  ]

  it('deja cada grupo contiguo y con el lider primero', () => {
    const { exercises, decisions } = planSupersetGroups(CROSS_BLOCK, 'full')

    for (const decision of decisions.filter((candidate) => candidate.outcome === 'grouped')) {
      const indexes = exercises
        .map((exercise, index) => ({ exercise, index }))
        .filter(({ exercise }) => exercise.supersetGroup === decision.groupId)
        .map(({ index }) => index)

      expect(indexes.at(-1)! - indexes[0]!).toBe(indexes.length - 1)
      expect(exercises[indexes[0]!]!.name).toBe(CROSS_BLOCK[decision.anchorIndex]!.name)
    }
  })

  it('sobrevive al normalizador sin disolver grupos', () => {
    const { exercises } = planSupersetGroups(CROSS_BLOCK, 'full')
    const groupedBefore = exercises.filter((exercise) => exercise.supersetGroup != null)

    expect(normalizeSupersetGroups(exercises).filter((exercise) => exercise.supersetGroup != null))
      .toHaveLength(groupedBefore.length)
  })

  const RULE_FIXTURES: ReadonlyArray<readonly [SupersetRule, ReturnType<typeof ex>[]]> = [
    ['core_circuit', [ex('Plancha frontal', 3), ex('Pallof press', 3), ex('Plancha lateral', 3)]],
    ['main_lift_plyo', [ex('Peso muerto con trap bar', 4), ex('Salto al cajon', 4)]],
    ['olympic_pull', [ex('Clean', 4), ex('Peso muerto con trap bar', 4), ex('Dominadas', 4)]],
    ['push_pull', [ex('Peso muerto con trap bar', 4), ex('Press vertical', 3), ex('Remo con pecho apoyado', 3)]],
  ]

  it.each(RULE_FIXTURES)('es idempotente despues de disparar %s', (rule, fixture) => {
    const first = planSupersetGroups(fixture, 'full')
    expect(first.decisions).toContainEqual(expect.objectContaining({ rule, outcome: 'grouped' }))

    const second = planSupersetGroups(first.exercises, 'full')
    expect(second.exercises).toEqual(first.exercises)
  })

  it('preserva la identidad del main_lift sobre multiples ordenes alcanzables', () => {
    const mainLiftOf = (list: ReadonlyArray<{ name: string; supersetGroup?: string }>) => {
      const roles = resolveSessionStrengthRoles(list)
      const index = roles.indexOf('main_lift')
      return index === -1 ? undefined : list[index]!.name
    }
    const pool = [
      ex('Plancha frontal', 3),
      ex('Pallof press', 3),
      ex('Plancha lateral', 3),
      ex('Clean', 4),
      ex('Peso muerto con trap bar', 4),
      ex('Salto al cajon', 4),
      ex('Dominadas', 4),
      ex('Press vertical', 3),
      ex('Remo con pecho apoyado', 3),
    ]
    let regrouped = 0
    let reflowed = 0

    for (let offset = 0; offset < pool.length; offset += 1) {
      for (const mode of ['permissive', 'full'] as const) {
        const input = [...pool.slice(offset), ...pool.slice(0, offset)]
        const normalized = normalizeSupersetGroups(input)
        const before = mainLiftOf(normalized)
        const { exercises, decisions } = planSupersetGroups(normalized, mode)

        const grouped = decisions.filter((decision) => decision.outcome === 'grouped')
        regrouped += grouped.length
        reflowed += grouped.filter((decision) => (
          decision.memberIndexes.some((index, position) => index !== decision.anchorIndex + position)
        )).length

        expect(mainLiftOf(exercises), `offset ${offset} / ${mode}`).toBe(before)
      }
    }

    expect(regrouped).toBeGreaterThan(0)
    expect(reflowed).toBeGreaterThan(0)
  })
})

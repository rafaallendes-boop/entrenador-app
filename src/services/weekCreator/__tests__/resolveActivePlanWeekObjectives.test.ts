import { beforeEach, describe, expect, it, vi } from 'vitest'

const tables = vi.hoisted(() => ({
  weekRows: [] as Array<Record<string, unknown>>,
  plansById: new Map<string, Record<string, unknown>>(),
}))

vi.mock('../../../db/db', () => ({
  db: {
    trainingPlanWeeks: {
      where: (field: string) => ({
        equals: (value: string) => ({
          toArray: async () => tables.weekRows.filter((row) => row[field] === value),
        }),
      }),
    },
    trainingPlans: {
      get: async (id: string) => tables.plansById.get(id),
    },
  },
}))

import { resolveActivePlanWeekObjectives } from '../WeekCreatorEngine'

describe('resolveActivePlanWeekObjectives', () => {
  beforeEach(() => {
    tables.weekRows = []
    tables.plansById = new Map()
  })

  it('returns the objectives of the active plan week matching the target monday', async () => {
    tables.weekRows = [
      {
        planId: 'plan-draft',
        weekStartDate: '2026-06-15',
        weekObjectives: [{ goal: 'Objetivo de borrador' }],
      },
      {
        planId: 'plan-active',
        weekStartDate: '2026-06-15',
        weekObjectives: [{ goal: 'Consolidar presión a la T' }, { goal: '  ' }, { goal: 'Subir fuerza' }],
      },
    ]
    tables.plansById = new Map([
      ['plan-draft', { id: 'plan-draft', athleteId: 'athlete-1', status: 'draft' }],
      ['plan-active', { id: 'plan-active', athleteId: 'athlete-1', status: 'active' }],
    ])

    await expect(resolveActivePlanWeekObjectives('2026-06-15', 'athlete-1')).resolves.toEqual([
      'Consolidar presión a la T',
      'Subir fuerza',
    ])
  })

  it('returns [] when no active plan covers the week', async () => {
    tables.weekRows = [
      { planId: 'plan-draft', weekStartDate: '2026-06-15', weekObjectives: [{ goal: 'x' }] },
    ]
    tables.plansById = new Map([['plan-draft', { id: 'plan-draft', athleteId: 'athlete-1', status: 'draft' }]])

    await expect(resolveActivePlanWeekObjectives('2026-06-15')).resolves.toEqual([])
    await expect(resolveActivePlanWeekObjectives('2026-06-22')).resolves.toEqual([])
  })

  it('ignores active plans from another athlete and malformed objective rows', async () => {
    tables.weekRows = [
      {
        planId: 'plan-other-athlete',
        weekStartDate: '2026-06-15',
        weekObjectives: [{ goal: 'Objetivo ajeno' }],
      },
      {
        planId: 'plan-empty',
        weekStartDate: '2026-06-15',
        weekObjectives: undefined,
      },
      {
        planId: 'plan-active',
        weekStartDate: '2026-06-15',
        weekObjectives: [{ goal: 'Objetivo correcto' }],
      },
    ]
    tables.plansById = new Map([
      ['plan-other-athlete', { id: 'plan-other-athlete', athleteId: 'athlete-2', status: 'active' }],
      ['plan-empty', { id: 'plan-empty', athleteId: 'athlete-1', status: 'active' }],
      ['plan-active', { id: 'plan-active', athleteId: 'athlete-1', status: 'active' }],
    ])

    await expect(resolveActivePlanWeekObjectives('2026-06-15', 'athlete-1')).resolves.toEqual([
      'Objetivo correcto',
    ])
  })
})

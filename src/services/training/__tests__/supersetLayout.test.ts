import { describe, expect, it } from 'vitest'

import { describeSupersetSegment, resolveSupersetLayout } from '../supersetGroups'

type Row = { name: string; sets: number; supersetGroup?: string }

const row = (name: string, sets: number, supersetGroup?: string): Row => ({ name, sets, supersetGroup })

describe('resolveSupersetLayout', () => {
  it('devuelve un segmento por grupo y singletons para los sueltos', () => {
    const layout = resolveSupersetLayout([
      row('Plancha', 4, 'g1'),
      row('Abs ruso', 4, 'g1'),
      row('Sentadilla', 3),
    ])

    expect(layout).toHaveLength(2)
    expect(layout[0]!.groupId).toBe('g1')
    expect(layout[0]!.members.map((m) => m.name)).toEqual(['Plancha', 'Abs ruso'])
    expect(layout[1]!.groupId).toBeUndefined()
    expect(layout[1]!.members.map((m) => m.name)).toEqual(['Sentadilla'])
  })

  it('normaliza defensivamente: nunca expone un grupo corrupto', () => {
    const layout = resolveSupersetLayout([
      row('A', 4, 'g1'),
      row('X', 3),
      row('B', 4, 'g1'),
      row('C', 4, 'g1'),
    ])

    expect(layout.every((segment) => segment.groupId === undefined)).toBe(true)
    expect(layout).toHaveLength(4)
  })

  it('preserva el orden de entrada', () => {
    const layout = resolveSupersetLayout([row('A', 3), row('B', 4, 'g1'), row('C', 4, 'g1')])

    expect(layout.flatMap((s) => s.members.map((m) => m.name))).toEqual(['A', 'B', 'C'])
  })
})

describe('describeSupersetSegment', () => {
  it('deriva la etiqueta de la cardinalidad', () => {
    expect(describeSupersetSegment(2)).toBe('Superserie')
    expect(describeSupersetSegment(3)).toBe('Triserie')
    expect(describeSupersetSegment(4)).toBe('Circuito')
    expect(describeSupersetSegment(7)).toBe('Circuito')
  })
})

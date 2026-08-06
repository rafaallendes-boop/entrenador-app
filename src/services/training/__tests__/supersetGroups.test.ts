import { describe, expect, it } from 'vitest'

import { normalizeSupersetGroups, normalizeSupersetGroupId } from '../supersetGroups'

type Row = { name: string; sets: number; supersetGroup?: string }

const row = (name: string, sets: number, supersetGroup?: string): Row => ({ name, sets, supersetGroup })

describe('normalizeSupersetGroups', () => {
  it('conserva un grupo contiguo de dos y no toca a los sueltos', () => {
    const result = normalizeSupersetGroups([
      row('Clean', 4, 'g1'),
      row('Dominadas', 4, 'g1'),
      row('Plancha', 3),
    ])

    expect(result.map((r) => r.supersetGroup)).toEqual(['g1', 'g1', undefined])
    expect(result.map((r) => r.sets)).toEqual([4, 4, 3])
  })

  it('disuelve un segmento de un solo miembro', () => {
    const result = normalizeSupersetGroups([row('Clean', 4, 'g1'), row('Plancha', 3)])

    expect(result[0]!.supersetGroup).toBeUndefined()
  })

  it('propaga los sets del primer ejercicio del grupo', () => {
    const result = normalizeSupersetGroups([
      row('Clean', 5, 'g1'),
      row('Dominadas', 3, 'g1'),
      row('Saltos', 2, 'g1'),
    ])

    expect(result.map((r) => r.sets)).toEqual([5, 5, 5])
  })

  it('disuelve el segundo segmento cuando un id reaparece separado', () => {
    const result = normalizeSupersetGroups([
      row('A1', 4, 'g1'),
      row('A2', 4, 'g1'),
      row('X', 3),
      row('A3', 4, 'g1'),
      row('A4', 4, 'g1'),
    ])

    expect(result.map((r) => r.supersetGroup)).toEqual(['g1', 'g1', undefined, undefined, undefined])
  })

  it('congela el caso A, X, A, A: contigüidad antes que cardinalidad', () => {
    const result = normalizeSupersetGroups([
      row('A', 4, 'g1'),
      row('X', 3),
      row('A', 4, 'g1'),
      row('A', 4, 'g1'),
    ])

    expect(result.map((r) => r.supersetGroup)).toEqual([undefined, undefined, undefined, undefined])
  })

  it('es idempotente', () => {
    const input = [row('A', 5, 'g1'), row('B', 3, 'g1'), row('C', 2, 'g2')]
    const once = normalizeSupersetGroups(input)
    const twice = normalizeSupersetGroups(once)

    expect(twice).toEqual(once)
  })

  it('no muta la entrada', () => {
    const input = [row('A', 5, 'g1'), row('B', 3, 'g1')]
    const snapshot = JSON.parse(JSON.stringify(input))
    normalizeSupersetGroups(input)

    expect(input).toEqual(snapshot)
  })

  it('no reordena, no inserta y no borra', () => {
    const input = [row('A', 4, 'g1'), row('B', 4, 'g1'), row('C', 3)]
    const result = normalizeSupersetGroups(input)

    expect(result.map((r) => r.name)).toEqual(['A', 'B', 'C'])
  })

  it('trata ids vacios o no-string como ausencia de grupo', () => {
    const result = normalizeSupersetGroups([
      { name: 'A', sets: 4, supersetGroup: '   ' },
      { name: 'B', sets: 4, supersetGroup: '   ' },
      { name: 'C', sets: 4, supersetGroup: 7 as unknown as string },
      { name: 'D', sets: 4, supersetGroup: 7 as unknown as string },
    ])

    expect(result.map((r) => r.supersetGroup)).toEqual([undefined, undefined, undefined, undefined])
  })
})

describe('normalizeSupersetGroupId', () => {
  it('recorta y descarta vacios y no-strings', () => {
    expect(normalizeSupersetGroupId('  g1 ')).toBe('g1')
    expect(normalizeSupersetGroupId('')).toBeUndefined()
    expect(normalizeSupersetGroupId('   ')).toBeUndefined()
    expect(normalizeSupersetGroupId(undefined)).toBeUndefined()
    expect(normalizeSupersetGroupId(42)).toBeUndefined()
  })
})

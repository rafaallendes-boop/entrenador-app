import { describe, expect, it } from 'vitest'

import {
  filterByExecutionMode,
  filterByFatigue,
  filterByPhase,
  selectSquashDrillReplacement,
  type SquashSelectionContext,
} from '../drillSelector'
import {
  normalizeSquashDrillKey,
  resolveDrillExecutionMode,
  resolveSquashDrillKind,
  SQUASH_DRILL_LIBRARY,
  type SquashDrillDefinition,
} from '../drillLibrary'

const buildContext = (overrides: Partial<SquashSelectionContext> = {}): SquashSelectionContext => ({
  fatigueLevel: 4,
  phase: 'build',
  recentDrills: [],
  goal: 'mejorar control y precision',
  competitionSoon: false,
  ...overrides,
})

function getAllowed(context: SquashSelectionContext): SquashDrillDefinition[] {
  return filterByExecutionMode(
    filterByPhase(filterByFatigue(SQUASH_DRILL_LIBRARY, context), context),
    context.partnerAvailability,
  )
}

function findOriginal(
  context: SquashSelectionContext,
  matches: (original: SquashDrillDefinition, candidate: SquashDrillDefinition) => boolean,
): SquashDrillDefinition {
  const allowed = getAllowed(context)
  const original = allowed.find((candidate) =>
    allowed.some((other) => other.id !== candidate.id && matches(candidate, other)),
  )

  expect(original).toBeDefined()
  return original!
}

describe('selectSquashDrillReplacement', () => {
  it('strict preserva category y resolveSquashDrillKind()', () => {
    const context = buildContext()
    const original = findOriginal(
      context,
      (candidate, other) => candidate.category === other.category
        && resolveSquashDrillKind(candidate) === resolveSquashDrillKind(other),
    )

    const replacement = selectSquashDrillReplacement({
      originalName: original.name,
      context,
      excludedKeys: new Set(),
      rotationIndex: 1,
      relaxation: 'strict',
    })

    expect(replacement).toBeDefined()
    expect(replacement?.category).toBe(original.category)
    expect(replacement && resolveSquashDrillKind(replacement)).toBe(resolveSquashDrillKind(original))
  })

  it('en contexto solo nunca devuelve un drill partnerRequired ni de match', () => {
    const context = buildContext({ partnerAvailability: 'solo' })
    const original = getAllowed(context)[0]

    expect(original).toBeDefined()
    const replacement = selectSquashDrillReplacement({
      originalName: original!.name,
      context,
      excludedKeys: new Set(),
      rotationIndex: 0,
      relaxation: 'any',
    })

    expect(replacement).toBeDefined()
    expect(replacement?.partnerRequired).not.toBe(true)
    expect(replacement && resolveDrillExecutionMode(replacement)).not.toBe('match')
    expect(replacement && resolveSquashDrillKind(replacement)).not.toBe('match')
  })

  it('en taper nunca devuelve un candidato excluido por filterByPhase', () => {
    const context = buildContext({ phase: 'taper' })
    const original = getAllowed(context)[0]

    expect(original).toBeDefined()
    const replacement = selectSquashDrillReplacement({
      originalName: original!.name,
      context,
      excludedKeys: new Set(),
      rotationIndex: 0,
      relaxation: 'any',
    })

    expect(replacement).toBeDefined()
    expect(replacement?.tags).not.toContain('rsa')
    expect(replacement?.tags).not.toContain('multiball')
    expect(replacement?.tags).not.toContain('match_play')
    expect(replacement?.intensity).not.toBe('high')
  })

  it('no tiene valvula: con todos los candidatos validos excluidos devuelve undefined', () => {
    const context = buildContext()
    const original = findOriginal(
      context,
      (candidate, other) => candidate.category === other.category
        && resolveSquashDrillKind(candidate) === resolveSquashDrillKind(other),
    )
    const validCandidates = getAllowed(context).filter((candidate) =>
      candidate.category === original.category
      && resolveSquashDrillKind(candidate) === resolveSquashDrillKind(original),
    )

    expect(validCandidates.length).toBeGreaterThan(0)
    const replacement = selectSquashDrillReplacement({
      originalName: original.name,
      context,
      excludedKeys: new Set(validCandidates.map((candidate) => normalizeSquashDrillKey(candidate.id))),
      rotationIndex: 0,
      relaxation: 'strict',
    })

    expect(replacement).toBeUndefined()
  })

  it('same_kind relaja category y same_category relaja kind', () => {
    const context = buildContext()
    const sameKindOriginal = findOriginal(
      context,
      (candidate, other) => candidate.category !== other.category
        && resolveSquashDrillKind(candidate) === resolveSquashDrillKind(other),
    )
    const sameKindReplacement = selectSquashDrillReplacement({
      originalName: sameKindOriginal.name,
      context,
      excludedKeys: new Set(
        getAllowed(context)
          .filter((candidate) => candidate.category === sameKindOriginal.category)
          .map((candidate) => normalizeSquashDrillKey(candidate.id)),
      ),
      rotationIndex: 0,
      relaxation: 'same_kind',
    })

    expect(sameKindReplacement).toBeDefined()
    expect(sameKindReplacement?.category).not.toBe(sameKindOriginal.category)
    expect(sameKindReplacement && resolveSquashDrillKind(sameKindReplacement)).toBe(resolveSquashDrillKind(sameKindOriginal))

    const sameCategoryOriginal = findOriginal(
      context,
      (candidate, other) => candidate.category === other.category
        && resolveSquashDrillKind(candidate) !== resolveSquashDrillKind(other),
    )
    const sameCategoryReplacement = selectSquashDrillReplacement({
      originalName: sameCategoryOriginal.name,
      context,
      excludedKeys: new Set(
        getAllowed(context)
          .filter((candidate) => resolveSquashDrillKind(candidate) === resolveSquashDrillKind(sameCategoryOriginal))
          .map((candidate) => normalizeSquashDrillKey(candidate.id)),
      ),
      rotationIndex: 0,
      relaxation: 'same_category',
    })

    expect(sameCategoryReplacement).toBeDefined()
    expect(sameCategoryReplacement?.category).toBe(sameCategoryOriginal.category)
    expect(sameCategoryReplacement && resolveSquashDrillKind(sameCategoryReplacement)).not.toBe(resolveSquashDrillKind(sameCategoryOriginal))
  })

  it('es determinista para el mismo rotationIndex', () => {
    const context = buildContext()
    const original = findOriginal(
      context,
      (candidate, other) => candidate.category === other.category
        && resolveSquashDrillKind(candidate) === resolveSquashDrillKind(other),
    )
    const request = {
      originalName: original.name,
      context,
      excludedKeys: new Set<string>(),
      rotationIndex: 3,
      relaxation: 'strict' as const,
    }

    expect(selectSquashDrillReplacement(request)?.id).toBe(selectSquashDrillReplacement(request)?.id)
  })
})

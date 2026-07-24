import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { createRepairMeta, repairGeneratedWeek } from '../repairWeek'
import { summarizeTaxonomy } from '../repairTaxonomy'
import {
  buildRepairContextForTest,
  buildSkeletonSessionForTest,
} from './helpers/repairTestFixtures'

describe('RepairMeta taxonomy wiring', () => {
  it('initialises the taxonomy alongside the legacy counters', () => {
    const meta = createRepairMeta(0)

    expect(meta.repairedSessionCount).toBe(0)
    expect(summarizeTaxonomy(meta.taxonomy).hydrationActionCount).toBe(0)
  })
})

describe('hydration classification', () => {
  it('classifies skeleton hydration as hydration, never corrective', () => {
    const context = buildRepairContextForTest({
      primarySport: 'running',
      phase: 'base',
      sessionsPerWeek: 1,
      targetLoadBySport: {},
    })
    const sessions = [
      buildSkeletonSessionForTest({
        sessionType: 'running',
        date: '2026-08-03',
      }),
    ]

    const { meta } = repairGeneratedWeek(sessions, context)
    const summary = summarizeTaxonomy(meta.taxonomy)

    expect(summary.hydrationActionCount).toBeGreaterThan(0)
    expect(summary.correctiveActionCount).toBe(0)
    expect(summary.structuralActionCount).toBe(0)
  })

  it('replaces the isolated hydration increment one-for-one in the legacy counter', () => {
    const context = buildRepairContextForTest({
      primarySport: 'running',
      phase: 'base',
      sessionsPerWeek: 1,
      targetLoadBySport: {},
    })
    const sessions = [
      buildSkeletonSessionForTest({
        sessionType: 'running',
        date: '2026-08-03',
      }),
    ]

    const { meta } = repairGeneratedWeek(sessions, context)
    const summary = summarizeTaxonomy(meta.taxonomy)

    expect(meta.repairedSessionCount).toBe(summary.hydrationActionCount)
  })
})

describe('corrective classification', () => {
  it('classifies out-of-catalogue squash drills as corrective, not hydration', () => {
    const context = buildRepairContextForTest()
    const sessions = [
      buildSkeletonSessionForTest({
        sessionType: 'squash',
        date: '2026-08-03',
        squashDetails: {
          drills: [{ name: 'drill-que-no-existe-en-el-catalogo', durationMin: 30 }],
          blocks: [],
          trainingFocus: 'technical',
          sessionMode: 'drill_session',
          sessionKind: 'technical',
        },
      }),
    ]

    const { meta } = repairGeneratedWeek(sessions, context)
    const summary = summarizeTaxonomy(meta.taxonomy)

    expect(summary.correctiveActionCount).toBeGreaterThan(0)
    expect(summary.hydrationActionCount).toBe(0)
  })
})

describe('structural classification', () => {
  it('balanceSessionCount fallback records one structural action', () => {
    const context = buildRepairContextForTest({
      primarySport: 'running',
      phase: 'base',
      sessionsPerWeek: 2,
      targetLoadBySport: {},
    })
    const sessions = [
      buildSkeletonSessionForTest({
        sessionType: 'running',
        date: '2026-08-03',
        fullyHydrated: true,
      }),
    ]

    const { meta } = repairGeneratedWeek(sessions, context)
    const summary = summarizeTaxonomy(meta.taxonomy)

    expect(meta.addedFallbackCount).toBe(1)
    expect(summary.structuralActionCount).toBe(1)
    expect(summary.hydrationActionCount).toBe(0)
    expect(summary.correctiveActionCount).toBe(0)
  })

  it('keeps the orphan fallback out of the legacy repaired counter', () => {
    const context = buildRepairContextForTest({
      primarySport: 'running',
      phase: 'base',
      sessionsPerWeek: 2,
      targetLoadBySport: {},
    })
    const sessions = [
      buildSkeletonSessionForTest({
        sessionType: 'running',
        date: '2026-08-03',
        fullyHydrated: true,
      }),
    ]

    const { meta } = repairGeneratedWeek(sessions, context)

    expect(meta.addedFallbackCount).toBe(1)
    expect(meta.repairedSessionCount).toBe(0)
  })

  it('pairs a competitive fallback with one structural action', () => {
    const context = buildRepairContextForTest({
      primarySport: 'squash',
      phase: 'peak',
      sessionsPerWeek: 3,
      targetLoadBySport: {},
    })
    const sessions = [
      buildSkeletonSessionForTest({
        sessionType: 'squash',
        date: '2026-08-03',
        squashDetails: {
          trainingFocus: 'technical',
          sessionMode: 'drill_session',
          sessionKind: 'technical',
          drills: [
            { name: 'Tiros paralelos profundos', durationMin: 15 },
            { name: 'Tiros cruzados profundos', durationMin: 15 },
            { name: 'Cambio de paralelo a cruzado', durationMin: 15 },
          ],
        },
      }),
      buildSkeletonSessionForTest({
        sessionType: 'squash',
        date: '2026-08-04',
        squashDetails: {
          trainingFocus: 'technical',
          sessionMode: 'drill_session',
          sessionKind: 'technical',
          drills: [
            { name: 'Boast y drive paralelo de salida', durationMin: 15 },
            { name: 'Drop y contra-drop por ambos lados', durationMin: 15 },
            { name: '100 drives desde media cancha', durationMin: 15 },
          ],
        },
      }),
    ]

    const { meta } = repairGeneratedWeek(sessions, context)
    const summary = summarizeTaxonomy(meta.taxonomy)

    expect(meta.addedFallbackCount).toBe(1)
    expect(summary.structuralActionCount).toBe(1)
    expect(summary.hydrationActionCount).toBe(0)
    expect(summary.correctiveActionCount).toBe(0)
    expect(meta.repairedSessionCount).toBe(1)
  })
})

describe('taxonomy coverage guard', () => {
  it('leaves no unclassified repair increment in repairWeek.ts', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const source = readFileSync(join(here, '..', 'repairWeek.ts'), 'utf8')
    const lines = source.split('\n')

    const rawLegacyIncrements = lines
      .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
      .filter(({ line }) => /meta\.repairedSessionCount\s*(\+\+|\+=)/.test(line))
      .filter(({ line }) => !line.startsWith('//'))

    expect(rawLegacyIncrements.map((item) => item.line)).toEqual([
      'meta.repairedSessionCount++',
    ])

    const helperStart = source.indexOf('function recordRepair(')
    const helperEnd = source.indexOf('function recordTaxonomyOnly(')
    expect(helperStart).toBeGreaterThanOrEqual(0)
    expect(helperEnd).toBeGreaterThan(helperStart)
    expect(source.slice(helperStart, helperEnd)).toContain(
      'meta.repairedSessionCount++',
    )

    const fallbackMutations = lines
      .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
      .filter(({ line }) => /meta\.addedFallbackCount\s*(\+\+|\+=)/.test(line))
      .filter(({ line }) => !line.startsWith('//'))

    expect(fallbackMutations).toHaveLength(3)
    for (const mutation of fallbackMutations) {
      const window = lines.slice(mutation.lineNumber - 1, mutation.lineNumber + 4).join('\n')
      expect(window).toMatch(
        /record(?:Repair|TaxonomyOnly)\(\s*meta,\s*'structural'/,
      )
    }
  })
})

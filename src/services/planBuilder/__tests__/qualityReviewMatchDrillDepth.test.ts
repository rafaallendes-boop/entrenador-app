import { describe, expect, it } from 'vitest'

import { reviewPlanQuality } from '../qualityReview'
import { buildPlanForTest, buildWeekForTest } from './helpers/qualityTestFixtures'
import { buildSkeletonSessionForTest } from './helpers/repairTestFixtures'

/**
 * `buildSquashMatchDrills` devuelve UNA sola entrada por construcción: jugar un
 * partido es una actividad, no una lista de drills. La regla de profundidad no
 * puede exigirle dos, porque ninguna sesión de partido bien formada la cumple y
 * rellenarla con drills técnicos sería contenido equivocado.
 */
function matchSession(date: string, sessionMode: 'practice_match' | 'competition_match') {
  return buildSkeletonSessionForTest({
    date,
    timeBlock: 'AM',
    sessionType: 'squash',
    title: 'Partido de entrenamiento',
    objective: 'Competir puntos con estructura de partido.',
    durationMin: 60,
    rpe: 8,
    squashDetails: {
      trainingFocus: 'match',
      sessionMode,
      sessionKind: 'match',
      drills: [{ name: 'Partido de entrenamiento al mejor de 5 juegos', durationMin: 60 }],
    },
  })
}

function drillSession(date: string) {
  return buildSkeletonSessionForTest({
    date,
    timeBlock: 'AM',
    sessionType: 'squash',
    title: 'Squash técnico',
    objective: 'Control y largo.',
    durationMin: 60,
    rpe: 6,
    squashDetails: {
      trainingFocus: 'technical',
      sessionMode: 'drill_session',
      sessionKind: 'technical',
      drills: [{ name: 'Tiros paralelos profundos', durationMin: 60 }],
    },
  })
}

function codesFor(sessions: ReturnType<typeof drillSession>[]): string[] {
  const plan = buildPlanForTest()
  const week = buildWeekForTest({ sessions })
  return reviewPlanQuality(plan, [week]).weeks
    .flatMap((review) => review.issues)
    .map((issue) => issue.code)
}

describe('quality.squash.low_drill_depth', () => {
  it('no penaliza una sesión de partido por tener un solo drill', () => {
    expect(codesFor([matchSession('2026-08-03', 'practice_match')]))
      .not.toContain('quality.squash.low_drill_depth')
  })

  it('tampoco penaliza un partido de competencia', () => {
    expect(codesFor([matchSession('2026-08-03', 'competition_match')]))
      .not.toContain('quality.squash.low_drill_depth')
  })

  it('sigue penalizando una sesión de drills con un solo drill', () => {
    expect(codesFor([drillSession('2026-08-03')]))
      .toContain('quality.squash.low_drill_depth')
  })
})

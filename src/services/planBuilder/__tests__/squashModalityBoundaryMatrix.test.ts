import { describe, expect, it } from 'vitest'

import type {
  ChatContext,
  CoachAction,
  SquashDetails,
  SquashSessionBlockKind,
} from '../../../types'
import { draftToNewSessionFields } from '../../athlete/coachSessionSerializer'
import { postProcessCoachActions } from '../../ai/actionPostProcessor'
import type { CoachNormalizedResponse } from '../../ai/types'
import {
  findSquashDrillByName,
  resolveDrillExecutionMode,
  resolveSquashDrillKind,
} from '../../training/drillLibrary'
import { getCatalogForSport } from '../../training/coachExerciseCatalog'
import { isSquashDrillKindCompatible, projectSquashSubtype } from '../../training/squashSessionHydrator'
import type { WeekCreatorEffectiveConfig } from '../../weekCreator/WeekCreatorConfig'
import { hydrateWeekCreatorSkeleton } from '../../weekCreator/WeekCreatorLocalHydrator'
import type { WeekCreatorSkeleton } from '../../weekCreator/weekCreatorSkeleton'
import { repairGeneratedWeek } from '../repairWeek'
import { buildRepairContextForTest, buildSkeletonSessionForTest } from './helpers/repairTestFixtures'

const EXPECTED_MODE = {
  control: 'solo',
  technical: 'partner',
  shadows: 'solo',
  match: 'match',
} as const

const KINDS = ['control', 'technical', 'shadows', 'match'] as const
const WEEK_START = '2026-08-03'

function context(): ChatContext {
  return {
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [],
    athleteProfile: {
      id: 'athlete-matrix',
      updatedAt: 1,
      sportContext: { primarySport: 'squash' },
      macroPlan: { currentPhase: 'build' } as never,
      strengthProfile: {
        squat1RM: 100,
        deadlift1RM: 120,
        benchPress1RM: 70,
        overheadPress1RM: 45,
      },
    },
  }
}

function weekCreatorConfig(): WeekCreatorEffectiveConfig {
  return {
    trainingDays: ['monday'],
    doubleSessionDays: [],
    sessionsPerWeek: 1,
    maxSessionsPerWeek: 1,
    sessionDurationMins: 45,
    allowDoubleSession: false,
    allowedSports: ['squash'],
    primarySport: 'squash',
    currentFitnessLevel: 'fit',
    currentFatigue: 'normal',
    fromWizard: true,
    configSource: 'wizard',
  }
}

function planBuilderDetails(kind: SquashSessionBlockKind): SquashDetails {
  const repairContext = buildRepairContextForTest({
    primarySport: 'squash',
    sessionsPerWeek: 1,
  })
  repairContext.plan = {
    ...repairContext.plan,
    totalWeeks: 1,
    phases: [{
      phase: 'build', startWeekIndex: 0, endWeekIndex: 0, blockFocus: '', intentBySport: {},
    }],
  }
  repairContext.week = {
    ...repairContext.week,
    weekIndex: 0,
    weekStartDate: WEEK_START,
    phase: 'build',
  }
  repairContext.planWeekDescriptors = [{ weekIndex: 0, phase: 'build' }]

  const proposal = buildSkeletonSessionForTest({
    date: WEEK_START,
    timeBlock: 'AM',
    sessionType: 'squash',
    squashKind: kind,
    subtype: projectSquashSubtype(kind),
    title: 'Squash estructurado',
    objective: 'Intención deportiva neutral.',
    durationMin: 45,
    rpe: 6,
  })
  const result = repairGeneratedWeek([proposal], repairContext)
  expect(result.failure).toBeUndefined()
  return result.sessions[0]!.squashDetails!
}

function weekCreatorDetails(kind: SquashSessionBlockKind): SquashDetails {
  const skeleton: WeekCreatorSkeleton = {
    type: 'create_week',
    reason: 'Matriz de modalidad',
    targetDate: WEEK_START,
    sessions: [{
      date: WEEK_START,
      timeBlock: 'AM',
      sessionType: 'squash',
      durationMin: 45,
      rpe: 6,
      focusKey: 'intención neutral',
      title: 'Squash estructurado',
      objective: 'Intención deportiva neutral.',
      squashKind: kind,
      subtype: projectSquashSubtype(kind),
    }],
  }
  const envelope: CoachNormalizedResponse = {
    message: '',
    provider: 'mock',
    traceId: 'week-matrix',
    requestClass: 'create_week',
    timestamp: 1,
  }
  const result = hydrateWeekCreatorSkeleton({
    skeleton,
    response: envelope,
    context: context(),
    config: weekCreatorConfig(),
    targetWeekStart: WEEK_START,
  })
  expect(result.status).toBe('hydrated')
  return result.response.actions![0]!.sessions![0]!.squashDetails!
}

function chatDetails(kind: SquashSessionBlockKind): SquashDetails {
  const action: CoachAction = {
    type: 'add_session',
    reason: 'Matriz de modalidad',
    targetDate: WEEK_START,
    timeBlock: 'AM',
    sessionType: 'squash',
    squashKind: kind,
    subtype: projectSquashSubtype(kind),
    title: 'Squash estructurado',
    objective: 'Intención deportiva neutral.',
    durationMin: 45,
  }
  const response = postProcessCoachActions({
    message: 'Sesión propuesta.',
    actions: [action],
    provider: 'mock',
    traceId: 'chat-matrix',
    requestClass: 'chat_action',
    timestamp: 1,
  }, context(), 'Agrega una sesión de squash el lunes')
  return response.actions![0]!.squashDetails!
}

function expectExecutableDetails(
  details: SquashDetails,
  requestedKind: SquashSessionBlockKind,
): void {
  expect(details.sessionKind).toBe(requestedKind)
  expect(details.drills.length).toBeGreaterThan(0)
  expect(details.blocks?.flatMap((block) => block.drills)).toEqual(details.drills)
  for (const block of details.blocks ?? []) {
    expect(isSquashDrillKindCompatible(requestedKind, block.kind)).toBe(true)
  }
  for (const drill of details.drills) {
    const definition = findSquashDrillByName(drill.name)!
    expect(isSquashDrillKindCompatible(
      requestedKind,
      resolveSquashDrillKind(definition),
    )).toBe(true)
    expect(drill.executionMode).toBe(resolveDrillExecutionMode(definition))
    expect(drill.executionMode).toBe(EXPECTED_MODE[resolveSquashDrillKind(definition)])
  }
}

describe('A7 — matriz de modalidad por frontera', () => {
  it.each(KINDS)('Plan Builder preserva %s con bloques y ejecución compatibles', (kind) => {
    expectExecutableDetails(planBuilderDetails(kind), kind)
  })

  it.each(KINDS)('Crear semana preserva %s con bloques y ejecución compatibles', (kind) => {
    expectExecutableDetails(weekCreatorDetails(kind), kind)
  })

  it.each(KINDS)('chat preserva %s con bloques y ejecución compatibles', (kind) => {
    expectExecutableDetails(chatDetails(kind), kind)
  })

  it.each(KINDS)('formulario persiste %s y su picker ofrece ejecución compatible', (kind) => {
    const subtype = projectSquashSubtype(kind)
    const fields = draftToNewSessionFields({
      date: WEEK_START,
      timeBlock: 'AM',
      type: 'squash',
      title: 'Squash manual',
      durationMin: 45,
      squashKind: kind,
      subtype,
    })
    expect(fields.squashDetails).toMatchObject({
      sessionKind: kind,
      blocks: [],
      drills: [],
    })
    const catalogDrills = getCatalogForSport('squash', kind)
      .filter((entry) => entry.source === 'squash_drill')
    expect(catalogDrills.length).toBeGreaterThan(0)
    for (const entry of catalogDrills) {
      const definition = findSquashDrillByName(entry.libraryId)!
      expect(resolveSquashDrillKind(definition)).toBe(kind)
      expect(resolveDrillExecutionMode(definition)).toBe(EXPECTED_MODE[kind])
    }
  })
})

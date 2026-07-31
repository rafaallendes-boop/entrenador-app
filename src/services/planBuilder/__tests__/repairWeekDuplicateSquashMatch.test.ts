import { describe, expect, it } from 'vitest'

import type { CoachSessionProposal } from '../../../types'
import type { RepairContext } from '../repairWeek'
import { repairGeneratedWeek } from '../repairWeek'
import { findSquashDrillByName } from '../../training/drillLibrary'
import { resolveSquashMatchRole } from '../../training/squashMatchRole'

// Mirrors validateWeekCreatorResponse.buildSquashDrillSignature so this test
// fails for exactly the same reason the Week Creator validator rejected the
// hydrated week (`duplicate_squash_content`).
function squashSignature(session: CoachSessionProposal): string | undefined {
  const drills = [
    ...(session.squashDetails?.drills ?? []),
    ...(session.squashDetails?.blocks ?? []).flatMap((block) => block.drills ?? []),
  ]
  if (drills.length === 0) return undefined
  return drills
    .map((drill) => findSquashDrillByName(drill.name)?.id ?? drill.name.trim().toLowerCase())
    .sort()
    .join('|')
}

function findDuplicateSquashSignature(sessions: CoachSessionProposal[]): string | undefined {
  const seen = new Set<string>()
  for (const session of sessions) {
    if (session.sessionType !== 'squash') continue
    // Un standalone canónico comparte formato, no una prescripción repetida de
    // drills; por contrato no entra en la unicidad de firmas.
    if (resolveSquashMatchRole(session.squashDetails) === 'standalone') continue
    const signature = squashSignature(session)
    if (!signature) continue
    if (seen.has(signature)) return signature
    seen.add(signature)
  }
  return undefined
}

function makeContext(): RepairContext {
  return {
    plan: {
      id: 'p1',
      athleteId: 'a1',
      goalEventId: 'e1',
      status: 'draft',
      generationState: 'complete',
      title: 'Test',
      startDate: '2026-06-01',
      endDate: '2026-06-14',
      totalWeeks: 2,
      phases: [{ phase: 'peak', startWeekIndex: 0, endWeekIndex: 1, blockFocus: 'peak', intentBySport: {} }],
      wizardConfig: {} as never,
      macroSnapshot: {
        goalEventId: 'e1',
        goalEventDate: '2026-06-14',
        currentPhase: 'peak',
        weeksRemaining: 1,
        blockFocus: 'peak',
        headline: '',
        timeline: [],
        sportDetails: [{ sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'hold', intensityBias: 'hold', notes: '' }],
        secondaryEvents: [],
        computedAt: 0,
      },
      createdAt: 0,
      updatedAt: 0,
    } as never,
    week: {
      id: 'w0',
      planId: 'p1',
      weekIndex: 0,
      weekStartDate: '2026-06-01',
      phase: 'peak',
      status: 'pending',
      sessions: [],
      weekObjectives: [],
      targetLoadBySport: { squash: 70 },
      validationIssues: [],
      generationMeta: { attempts: 1, provider: 'gemini', model: 'flash' },
      createdAt: 0,
      updatedAt: 0,
    } as never,
    profile: {
      id: 'a1',
      updatedAt: 0,
      age: 38,
      sportContext: { primarySport: 'squash', competitiveLevel: 'competitive' },
    } as never,
    wizardConfig: {
      goalEventId: 'e1',
      trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
      doubleSessionDays: [],
      sessionsPerWeek: 4,
      sessionDurationMins: 60,
      allowDoubleSession: false,
      complementarySports: ['strength'],
      currentFitnessLevel: 'fit',
      currentFatigue: 'fresh',
      partnerAvailability: 'either',
      createdAt: '',
      updatedAt: '',
    } as never,
    planWeekDescriptors: [{ weekIndex: 0, phase: 'peak' }],
  }
}

// Regression for the Week Creator canary: a compact skeleton produced two
// squash `match/competitive` sessions in the same week. `applySquashMatchDetails`
// keyed its drill variant on `week.weekIndex`, so both sessions were rebuilt
// with the identical pair of drills after the diversify pass had already
// separated them, and the validator failed the whole week.
describe('repairGeneratedWeek: two competitive squash matches in one week', () => {
  // Three squash sessions that all read as match play and share the same drill
  // pair. `diversifyDuplicateSquashSessions` rebuilds the two duplicates as
  // shadows/control work, but their titles still say "Match Play", so the
  // `normalizeSquashSemanticMetadata` pass that runs right after flips both back
  // to match content -- keyed on `week.weekIndex`, so both land on the identical
  // drill pair the diversify pass had just separated.
  const matchSession = (date: string): CoachSessionProposal => ({
    date,
    timeBlock: 'PM',
    sessionType: 'squash',
    subtype: 'competitive',
    title: 'Squash - Match Play Competitivo',
    durationMin: 60,
    rpe: 7,
    objective: 'Competir con marcador real, presión de cierre y rutinas entre puntos.',
    squashDetails: {
      trainingFocus: 'conditioned_games',
      sessionMode: 'practice_match',
      sessionKind: 'technical',
      drills: [
        { name: 'Circuito experimental alfa', durationMin: 20 },
        { name: 'Circuito experimental beta', durationMin: 20 },
      ],
    },
  } as never)

  // repairGeneratedWeek mutates sessions in place, so each test needs its own.
  const makeSessions = (): CoachSessionProposal[] => [
    matchSession('2026-06-01'),
    matchSession('2026-06-03'),
    matchSession('2026-06-04'),
  ]

  it('leaves every squash session with a distinct drill signature', () => {
    const result = repairGeneratedWeek(makeSessions(), makeContext())
    expect(findDuplicateSquashSignature(result.sessions)).toBeUndefined()
  })

  it('keeps real competitive exposure while diversifying', () => {
    const result = repairGeneratedWeek(makeSessions(), makeContext())
    const competitive = result.sessions.filter(
      (session) => session.squashDetails?.sessionMode === 'competition_match',
    )
    expect(competitive.length).toBeGreaterThanOrEqual(1)
  })
})

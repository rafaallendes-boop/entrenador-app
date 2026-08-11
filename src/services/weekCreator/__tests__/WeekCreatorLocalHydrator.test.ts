import { describe, expect, it } from 'vitest'

import type { ChatContext, CoachAction } from '../../../types'
import type { CoachNormalizedResponse } from '../../ai/types'
import { findSquashDrillByName } from '../../training/drillLibrary'
import type { WeekCreatorEffectiveConfig } from '../WeekCreatorConfig'
import {
  hydrateWeekCreatorSkeleton,
  hydrateWeekCreatorResponse,
  overlayWeekCreatorSkeletonIntent,
  type WeekCreatorHydrationResult,
} from '../WeekCreatorLocalHydrator'
import type { WeekCreatorSkeleton } from '../weekCreatorSkeleton'
import { parseWeekCreatorSkeletonResponse } from '../parseWeekCreatorSkeletonResponse'
import { validateWeekCreatorResponse } from '../validateWeekCreatorResponse'

const TARGET_WEEK = '2026-07-20'

function makeContext(restrictions?: string): ChatContext {
  return {
    recentSessions: [],
    athleteProfile: {
      id: 'athlete-1',
      updatedAt: 0,
      age: 38,
      sportContext: { primarySport: 'squash' },
      strengthProfile: {
        squat1RM: 120,
        deadlift1RM: 140,
        benchPress1RM: 90,
        overheadPress1RM: 65,
      },
      recoveryProfile: restrictions ? { restrictions } : undefined,
    },
  }
}

function makeConfig(overrides: Partial<WeekCreatorEffectiveConfig> = {}): WeekCreatorEffectiveConfig {
  return {
    trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    doubleSessionDays: [],
    sessionsPerWeek: 5,
    maxSessionsPerWeek: 5,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    allowedSports: ['squash', 'strength', 'cycling'],
    primarySport: 'squash',
    currentFitnessLevel: 'fit',
    currentFatigue: 'normal',
    fromWizard: true,
    configSource: 'wizard',
    ...overrides,
  }
}

function skeletonAction(): CoachAction {
  return {
    type: 'create_week',
    reason: 'Semana compacta',
    targetDate: TARGET_WEEK,
    sessions: [
      session('2026-07-20', 'AM', 'squash', 'Squash técnico', 'training'),
      session('2026-07-21', 'AM', 'strength', 'Fuerza base'),
      session('2026-07-22', 'AM', 'squash', 'Squash control', 'control'),
      session('2026-07-23', 'AM', 'cycling', 'Bici Z2'),
      session('2026-07-24', 'AM', 'squash', 'Squash juego', 'match', 'match'),
    ],
  }
}

function session(
  date: string,
  timeBlock: 'AM' | 'PM',
  sessionType: 'squash' | 'strength' | 'cycling',
  title: string,
  subtype?: 'training' | 'control' | 'match',
  squashKind: 'control' | 'technical' | 'shadows' | 'match' = 'technical',
) {
  return {
    date,
    timeBlock,
    sessionType,
    title,
    durationMin: 60,
    rpe: sessionType === 'cycling' ? 4 : 6,
    objective: `Objetivo de ${title}`,
    subtype,
    // El contrato v2 exige la modalidad para squash y la prohíbe en el resto.
    ...(sessionType === 'squash' ? { squashKind } : {}),
  }
}

function response(action = skeletonAction()): CoachNormalizedResponse {
  return {
    message: 'Semana propuesta',
    actions: [action],
    provider: 'openai',
    model: 'gpt-4.1-mini',
    timestamp: 0,
    traceId: 'trace-1',
    requestClass: 'week_creator',
  }
}

function hydrate(
  overrides: Partial<Parameters<typeof hydrateWeekCreatorResponse>[0]> = {},
): WeekCreatorHydrationResult {
  return hydrateWeekCreatorResponse({
    response: response(),
    context: makeContext(),
    config: makeConfig(),
    targetWeekStart: TARGET_WEEK,
    ...overrides,
  })
}

describe('WeekCreatorLocalHydrator', () => {
  it('hydrates a compact multi-sport skeleton into a response accepted by final validation', () => {
    const result = hydrate()
    const sessions = result.response.actions?.[0]?.sessions ?? []
    const squash = sessions.filter((candidate) => candidate.sessionType === 'squash')
    const strength = sessions.find((candidate) => candidate.sessionType === 'strength')
    const cycling = sessions.find((candidate) => candidate.sessionType === 'cycling')

    expect(result.status).toBe('hydrated')
    expect(squash).toHaveLength(3)
    expect(squash.every((candidate) => (candidate.squashDetails?.drills.length ?? 0) > 0)).toBe(true)
    expect(strength?.exercises?.length).toBeGreaterThanOrEqual(6)
    expect(strength?.metadata?.starLift?.name).toBeDefined()
    expect(cycling?.cyclingDetails?.targetStructure).toBeTruthy()

    const validation = validateWeekCreatorResponse({
      response: result.response,
      context: makeContext(),
      config: makeConfig(),
      targetWeekStart: TARGET_WEEK,
    })
    expect(validation).toMatchObject({ ok: true })
  })

  it('keeps unavailable days and pinned time blocks as hard schedule constraints', () => {
    const config = makeConfig({
      trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
      maxSessionsPerWeek: 6,
      scheduleConstraints: 'martes solo PM; jueves no disponible',
    })
    const action = skeletonAction()
    const result = hydrate({ response: response(action), config })
    const sessions = result.response.actions?.[0]?.sessions ?? []

    expect(sessions.find((candidate) => candidate.date === '2026-07-21')?.timeBlock).toBe('PM')
    expect(sessions.some((candidate) => candidate.date === '2026-07-23')).toBe(false)
    expect(result.repairMeta?.taxonomy.correctiveActionCount).toBeGreaterThan(0)
    expect(result.repairMeta?.taxonomy.correctedSessions.has('2026-07-21|PM')).toBe(true)

    const validation = validateWeekCreatorResponse({
      response: result.response,
      context: makeContext(),
      config,
      targetWeekStart: TARGET_WEEK,
    })
    expect(validation).toMatchObject({ ok: true })
  })

  it('does not synthesize exercises or drills when active medical restrictions are free text', () => {
    const original = response()
    const result = hydrateWeekCreatorResponse({
      response: original,
      context: makeContext('Sin impacto ni carga de rodilla hasta alta médica.'),
      config: makeConfig({ injuryNotes: 'Evitar flexión profunda de rodilla.' }),
      targetWeekStart: TARGET_WEEK,
    })

    expect(result.status).toBe('blocked_medical_restrictions')
    expect(result.response).toBe(original)
    expect(result.response.actions?.[0]?.sessions?.find((candidate) => candidate.sessionType === 'strength')?.exercises).toBeUndefined()
    expect(result.repairMeta).toBeUndefined()
  })

  it('blocks the typed skeleton entry point before replacing the medical response envelope', () => {
    const original = response()
    const skeleton: WeekCreatorSkeleton = {
      type: 'create_week',
      reason: 'No debe hidratarse',
      targetDate: TARGET_WEEK,
      sessions: [{
        ...session('2026-07-20', 'AM', 'squash', 'Squash intenso', undefined, 'match'),
        focusKey: 'squash_match_pressure',
      }],
    }
    const result = hydrateWeekCreatorSkeleton({
      skeleton,
      response: original,
      context: makeContext('Sin impacto ni carga de rodilla hasta alta médica.'),
      config: makeConfig({ injuryNotes: 'Evitar flexión profunda de rodilla.' }),
      targetWeekStart: TARGET_WEEK,
    })

    expect(result.status).toBe('blocked_medical_restrictions')
    expect(result.response).toBe(original)
    expect(result.focusOverlayCount).toBe(0)
  })

  it('does not mutate the provider skeleton while hydrating its cloned action', () => {
    const original = response()
    const before = JSON.stringify(original)
    const result = hydrate({ response: original })

    expect(JSON.stringify(original)).toBe(before)
    expect(result.response).not.toBe(original)
    expect(result.response.actions?.[0]).not.toBe(original.actions?.[0])
  })

  it('parses and overlays focusKey through selector-facing semantic fields', () => {
    const action: CoachAction = {
      type: 'create_week',
      reason: 'Semana compacta',
      targetDate: TARGET_WEEK,
      sessions: [
        session('2026-07-20', 'AM', 'squash', 'Squash presión', undefined, 'match'),
        {
          date: '2026-07-21',
          timeBlock: 'AM',
          sessionType: 'running',
          title: 'Running calidad',
          durationMin: 45,
          rpe: 7,
          objective: 'Trabajo aeróbico de calidad.',
        },
      ],
    }
    const payload = JSON.stringify({
      ...action,
      sessions: [
        { ...action.sessions?.[0], focusKey: 'squash_match_pressure' },
        { ...action.sessions?.[1], focusKey: 'running_intervals_vo2' },
      ],
    })
    const parsed = parseWeekCreatorSkeletonResponse(payload)

    expect(parsed.ok).toBe(true)
    const skeleton = parsed.ok ? parsed.skeleton : undefined
    const overlaid = overlayWeekCreatorSkeletonIntent(action, skeleton as WeekCreatorSkeleton)
    expect(overlaid.appliedCount).toBe(2)
    // `focusKey` sigue enriqueciendo el objetivo, pero ya no decide la
    // modalidad: eso viaja en `squashKind` y llega intacto a la propuesta.
    expect(overlaid.action.sessions?.[0]).toMatchObject({
      squashKind: 'match',
      objective: expect.stringContaining('partido y presión competitiva'),
    })
    expect(overlaid.action.sessions?.[1]).toMatchObject({
      runningType: 'intervals',
      objective: expect.stringContaining('intervalos'),
    })
  })

  /**
   * A0 — regresión congelada: `focusKey` es foco deportivo, no modalidad.
   *
   * `inferSquashSubtypeFromFocus` (WeekCreatorLocalHydrator.ts:356) hace
   * `/control/.test(key) => 'control'`. Es la segunda autoridad de modalidad por
   * regex sobre string del proyecto, independiente de la de `repairWeek`. Un
   * foco legítimo como `squash_length_control` sobre una sesión que se juega con
   * partner la degradaba a volumen en solitario.
   */
  describe('A0 — focusKey no decide la modalidad de squash', () => {
    function overlayWithFocus(focusKey: string, subtype?: 'training' | 'control' | 'match') {
      const action: CoachAction = {
        type: 'create_week',
        reason: 'Semana compacta',
        targetDate: TARGET_WEEK,
        sessions: [session('2026-07-20', 'AM', 'squash', 'Squash rotación con partner', subtype)],
      }
      const skeleton: WeekCreatorSkeleton = {
        type: 'create_week',
        reason: 'Semana compacta',
        targetDate: TARGET_WEEK,
        sessions: [{
          ...session('2026-07-20', 'AM', 'squash', 'Squash rotación con partner', subtype),
          focusKey,
        }],
      }
      return overlayWeekCreatorSkeletonIntent(action, skeleton)
    }

    it('focusKey squash_length_control no fuerza subtype control', () => {
      const overlaid = overlayWithFocus('squash_length_control')
      expect(overlaid.action.sessions?.[0]?.subtype).not.toBe('control')
    })

    it('un foco de precisión sobre trabajo con partner tampoco lo vuelve control', () => {
      const overlaid = overlayWithFocus('squash_technical_control_precision')
      expect(overlaid.action.sessions?.[0]?.subtype).not.toBe('control')
    })

    it('el subtype declarado explícitamente siempre gana sobre el focusKey', () => {
      const overlaid = overlayWithFocus('squash_length_control', 'training')
      expect(overlaid.action.sessions?.[0]?.subtype).toBe('training')
    })
  })

  it('hydrates the typed skeleton directly so focusKey survives the generic normalizer boundary', () => {
    const context = makeContext()
    context.athleteProfile!.goalEvents = [{
      id: 'squash-event',
      title: 'Open objetivo',
      date: '2026-08-01',
      sport: 'squash',
      priority: 'primary',
    }]
    const skeleton: WeekCreatorSkeleton = {
      type: 'create_week',
      reason: 'Semana compacta',
      targetDate: TARGET_WEEK,
      sessions: [
        { ...session('2026-07-20', 'AM', 'squash', 'Squash técnico'), focusKey: 'squash_technical' },
        { ...session('2026-07-21', 'AM', 'strength', 'Fuerza base'), focusKey: 'strength_lower' },
        { ...session('2026-07-22', 'AM', 'squash', 'Squash control', undefined, 'control'), focusKey: 'squash_control' },
        { ...session('2026-07-23', 'AM', 'cycling', 'Bici Z2'), focusKey: 'cycling_z2' },
        { ...session('2026-07-24', 'AM', 'squash', 'Squash match', undefined, 'match'), focusKey: 'squash_match' },
      ],
    }
    const result = hydrateWeekCreatorSkeleton({
      skeleton,
      response: response({ type: 'create_week', reason: 'descartada por mapper genérico' }),
      context,
      config: makeConfig(),
      targetWeekStart: TARGET_WEEK,
    })
    const sessions = result.response.actions?.[0]?.sessions ?? []

    expect(result.focusOverlayCount).toBe(5)
    // La modalidad llega declarada en el skeleton y sobrevive al mapper. A2.5
    // La fase se resuelve para la semana objetivo (peak, a dos semanas del
    // evento): materializa mejor de 5 sin degradar a técnica.
    const declaredMatch = sessions.find((candidate) => candidate.squashKind === 'match')
    expect(declaredMatch?.squashDetails?.drills.length).toBeGreaterThan(0)
    expect(findSquashDrillByName(declaredMatch?.squashDetails?.drills[0]?.name ?? '')?.id)
      .toBe('practice_match_five_games')
    expect(result.repairMeta?.squashKindDegradedCount).toBeUndefined()
    expect(result.repairMeta?.warnings.some((warning) => warning.code === 'squash_kind_degraded')).toBe(false)
    expect(sessions.find((candidate) => candidate.title === 'Fuerza base')?.objective)
      .toContain('fuerza lower de tren inferior')
  })

  it('reads the focus intent as coach copy, not as pipeline metadata', () => {
    const skeleton: WeekCreatorSkeleton = {
      type: 'create_week',
      reason: 'Semana compacta',
      targetDate: TARGET_WEEK,
      sessions: [{
        date: '2026-07-20',
        timeBlock: 'AM',
        sessionType: 'squash',
        durationMin: 60,
        rpe: 6,
        focusKey: 'squash_control',
        title: 'Squash control',
        objective: 'Sostener el ritmo de la semana',
      }],
    }
    const focusContext = makeContext()
    focusContext.athleteProfile!.sportContext!.primarySport = 'running'
    const objective = hydrateWeekCreatorSkeleton({
      skeleton,
      response: response(),
      context: focusContext,
      config: makeConfig({
        primarySport: 'running',
        allowedSports: ['running', 'squash'],
        sessionsPerWeek: 1,
        maxSessionsPerWeek: 1,
      }),
      targetWeekStart: TARGET_WEEK,
    }).response.actions?.[0]?.sessions?.[0]?.objective ?? ''

    expect(objective).toContain('Foco: control de largo y recuperación a la T.')
    expect(objective).not.toContain('Foco local')
    // The model objective has no trailing punctuation; the append must add it
    // instead of running the two sentences together.
    expect(objective).toContain('Sostener el ritmo de la semana. Foco:')
  })
})

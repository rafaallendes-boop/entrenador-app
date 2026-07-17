import { describe, expect, it } from 'vitest'
import type { Session } from '../../../types'
import {
  applyCoachSessionPatch,
  draftToPatch,
  draftToNewSessionFields,
  sessionToDraft,
  type CoachSessionDraft,
} from '../coachSessionSerializer'

const draft: CoachSessionDraft = {
  date: '2026-07-14', timeBlock: 'AM', type: 'squash', title: 'Drills', durationMin: 60,
  subtype: 'training', objective: 'volea',
}

const planBuilderSession = {
  id: 'pb-1', athleteId: 'ath_m', date: '2026-07-14', timeBlock: 'AM', type: 'squash',
  status: 'planned', title: 'PB Squash', durationMin: 75, source: 'coach',
  authoredByRole: 'coach', createdAt: 1, updatedAt: 1, subtype: 'training',
  weekStartDate: '2026-07-13', objective: 'técnica',
  squashDetails: {
    trainingFocus: 'technical', sessionMode: 'drill_session',
    drills: [{ name: 'boast-drive' }],
    blocks: [{ kind: 'technical', drills: [{ name: 'drive' }] }],
  },
  warmup: { title: 'W', durationMin: 10, note: '', tone: 'general', steps: [], consecutiveTrainingDays: 0, hasCompetitionSoon: false },
  cooldown: { title: 'C', durationMin: 5, note: '', tone: 'general', steps: [], consecutiveTrainingDays: 0, hasCompetitionSoon: false },
  exercises: [{
    id: 'e1', name: 'Sentadilla', sets: 5, reps: '5', completed: true,
    warmupSets: [{ reps: 5 }], group: 'legs', targetPercent1RM: 80,
  }],
} as Session

describe('draftToNewSessionFields', () => {
  it('genera protocolos, details y estado planned', () => {
    const fields = draftToNewSessionFields(draft)
    expect(fields).toMatchObject({ status: 'planned', source: 'coach', weekStartDate: '2026-07-13' })
    expect(fields.warmup).toBeDefined()
    expect(fields.cooldown).toBeDefined()
    expect(fields.squashDetails?.sessionMode).toBe('drill_session')
  })

  it('normaliza ejercicios y los crea incomplete', () => {
    const fields = draftToNewSessionFields({
      ...draft, type: 'strength', subtype: undefined,
      exercises: [{ id: 'e1', name: ' Press ', sets: 3, reps: '  ', notes: '  ' }],
    })
    expect(fields.exercises?.[0]).toMatchObject({
      name: 'Press', reps: '10', notes: undefined, completed: false,
    })
  })

  it('convierte exercises vacío en undefined', () => {
    expect(draftToNewSessionFields({
      ...draft, type: 'strength', subtype: undefined, exercises: [],
    }).exercises).toBeUndefined()
  })
})

describe('applyCoachSessionPatch sin cambio de tipo', () => {
  it('preserva estructuras enriquecidas, protocolos e identidad', () => {
    const result = applyCoachSessionPatch(planBuilderSession, { title: 'PB editada', durationMin: 60 })
    expect(result.squashDetails?.drills).toHaveLength(1)
    expect(result.squashDetails?.blocks).toHaveLength(1)
    expect(result.warmup?.title).toBe('W')
    expect(result).toMatchObject({
      id: 'pb-1', athleteId: 'ath_m', authoredByRole: 'coach', source: 'coach',
      createdAt: 1, weekStartDate: '2026-07-13',
    })
  })

  it('mergea ejercicios por id y conserva toda su metadata', () => {
    const result = applyCoachSessionPatch(planBuilderSession, {
      exercises: [
        { id: 'e1', name: 'Sentadilla pausada', sets: 4, reps: '6' },
        { id: 'e2', name: 'Peso muerto', sets: 3, reps: '5' },
      ],
    })
    expect(result.exercises?.[0]).toMatchObject({
      id: 'e1', completed: true, group: 'legs', targetPercent1RM: 80,
    })
    expect(result.exercises?.[0].warmupSets).toHaveLength(1)
    expect(result.exercises?.[1]).toMatchObject({ id: 'e2', completed: false })
    expect(applyCoachSessionPatch(planBuilderSession, { exercises: [] }).exercises).toEqual([])
  })

  it('actualiza derivados squash preservando drills y blocks', () => {
    const subtype = applyCoachSessionPatch(planBuilderSession, { subtype: 'competitive' })
    expect(subtype.squashDetails?.sessionMode).toBe('competition_match')
    const objective = applyCoachSessionPatch(planBuilderSession, { objective: 'potencia física' })
    expect(objective.squashDetails?.trainingFocus).toBe('physical')
    const cleared = applyCoachSessionPatch(objective, { objective: undefined })
    expect(cleared.squashDetails?.trainingFocus).toBe('technical')
    expect(cleared.squashDetails?.drills).toEqual(planBuilderSession.squashDetails?.drills)
    expect(cleared.squashDetails?.blocks).toEqual(planBuilderSession.squashDetails?.blocks)
  })

  it('mergea running targets y preserva campos extra', () => {
    const running = {
      ...planBuilderSession, type: 'running', squashDetails: undefined, subtype: undefined,
      runningDetails: { runningType: 'z2', targetPaceMin: '5:30', extraCue: 'cadencia' },
    } as unknown as Session
    const result = applyCoachSessionPatch(running, {
      runningTargets: { runningType: 'tempo', targetPaceMin: '4:50' },
    })
    expect(result.runningDetails).toMatchObject({ runningType: 'tempo', targetPaceMin: '4:50' })
    expect((result.runningDetails as unknown as Record<string, unknown>).extraCue).toBe('cadencia')
  })

  it('preserva executionNotes al cambiar la zona de cycling', () => {
    const cycling = {
      ...planBuilderSession, type: 'cycling', squashDetails: undefined, subtype: undefined,
      runningDetails: { runningType: 'z2' },
      cyclingDetails: {
        sessionCategory: 'custom', targetStructure: 'custom', intensityReference: 'custom',
        executionNotes: 'Nota enriquecida',
      },
    } as unknown as Session
    const result = applyCoachSessionPatch(cycling, {
      runningTargets: { runningType: 'intervals' },
    })
    expect(result.cyclingDetails?.sessionCategory).toBe('primary build')
    expect(result.cyclingDetails?.executionNotes).toBe('Nota enriquecida')
  })

  it('limpia opcionales presentes con undefined y preserva completación', () => {
    const existing = {
      ...planBuilderSession, objective: 'Anterior', location: 'Club', rpe: 7,
      opponent: 'Rival', status: 'completed', actualRpe: 8, completedAt: 99,
    } as Session
    const result = applyCoachSessionPatch(existing, {
      objective: undefined, location: undefined, rpe: undefined, opponent: undefined,
    })
    expect(result).toMatchObject({
      objective: undefined, location: undefined, rpe: undefined, opponent: undefined,
      status: 'completed', actualRpe: 8, completedAt: 99,
    })
  })
})

describe('applyCoachSessionPatch con cambio de tipo', () => {
  it('limpia campos incompatibles y regenera defaults', () => {
    const result = applyCoachSessionPatch(planBuilderSession, { type: 'strength', title: 'Fuerza' })
    expect(result).toMatchObject({ type: 'strength', title: 'Fuerza' })
    expect(result.subtype).toBeUndefined()
    expect(result.squashDetails).toBeUndefined()
    expect(result.warmup).toBeDefined()
  })

  it('crea runningDetails al cambiar a running', () => {
    const result = applyCoachSessionPatch(planBuilderSession, {
      type: 'running', runningTargets: { runningType: 'tempo', targetPaceMin: '4:50' },
    })
    expect(result.runningDetails).toMatchObject({ runningType: 'tempo', targetPaceMin: '4:50' })
  })

  it('conserva metadata de ejercicios entre strength y mobility', () => {
    const strength = {
      ...planBuilderSession, type: 'strength', squashDetails: undefined, subtype: undefined,
    } as unknown as Session
    const result = applyCoachSessionPatch(strength, {
      type: 'mobility',
      exercises: [{ id: 'e1', name: 'Sentadilla', sets: 5, reps: '5' }],
    })
    expect(result.exercises?.[0]).toMatchObject({
      completed: true, group: 'legs', targetPercent1RM: 80,
    })
    expect(result.exercises?.[0].warmupSets).toHaveLength(1)
  })
})

describe('sessionToDraft y draftToPatch', () => {
  it('mapea runningDetails y ejercicios conservando ids editables', () => {
    const running = {
      ...planBuilderSession,
      type: 'running',
      subtype: undefined,
      squashDetails: undefined,
      runningDetails: { runningType: 'tempo', targetPaceMin: '4:50', targetHrMax: 170 },
    } as unknown as Session
    const converted = sessionToDraft(running)
    expect(converted.runningTargets).toEqual({
      runningType: 'tempo', targetPaceMin: '4:50', targetPaceMax: undefined,
      targetHrMin: undefined, targetHrMax: 170,
    })
    expect(converted.exercises?.[0]).toMatchObject({ id: 'e1', name: 'Sentadilla' })
    expect(draftToPatch(converted, running)).toEqual({})
  })

  it('conserva una limpieza opcional como clave presente', () => {
    const original = { ...planBuilderSession, objective: 'Técnica' } as Session
    const converted = sessionToDraft(original)
    const patch = draftToPatch({ ...converted, objective: undefined }, original)
    expect(patch).toHaveProperty('objective')
    expect(patch.objective).toBeUndefined()
  })

  it('con cambio de tipo emite el draft completo y conserva metadata no editable al aplicar', () => {
    const strength = {
      ...planBuilderSession, type: 'strength', subtype: undefined, squashDetails: undefined,
    } as Session
    const converted = sessionToDraft(strength)
    const patch = draftToPatch({ ...converted, type: 'mobility' }, strength)
    expect(patch.type).toBe('mobility')
    expect(patch.exercises).toEqual(converted.exercises)
    const result = applyCoachSessionPatch(strength, patch)
    expect(result.exercises?.[0]).toMatchObject({
      completed: true, group: 'legs', targetPercent1RM: 80,
    })
    expect(result.exercises?.[0].warmupSets).toEqual(strength.exercises?.[0].warmupSets)
  })
})

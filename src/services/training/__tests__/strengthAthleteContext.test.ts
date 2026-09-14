import { describe, expect, it } from 'vitest'
import type { AthleteProfile, DayLog, Session } from '../../../types'
import type { ExecutionSignals } from '../loadDirectivePolicy'
import { captureSources, deriveSlotContext } from '../slotContext'
import {
  STRENGTH_CONTEXT_ATHLETE_FIELDS,
  resolveDeclaredAthleteState,
  resolveStrengthAthleteContext,
  toStrengthContextAthleteFields,
  type AthleteDeclaration,
} from '../strengthAthleteContext'

const NOW = new Date(2026, 8, 16, 10, 0).getTime() // miércoles 16-09-2026
const SLOT = { date: '2026-09-16', timeBlock: 'PM' as const }
const DECLARED_YESTERDAY = '2026-09-15T12:00:00.000Z'

function strengthSession(id: string, date: string, exercise: string): Session {
  return {
    id, date, weekStartDate: date, timeBlock: 'AM', type: 'strength', status: 'completed', title: id,
    durationMin: 60, createdAt: 0, updatedAt: 0,
    exercises: [{ id: `${id}-ex`, name: exercise, sets: 3, reps: 8, completed: true, libraryRef: { source: 'strength_exercise', id: exercise } }],
  } as Session
}

function resolve(
  profile: AthleteProfile,
  declaration: AthleteDeclaration | undefined,
  signals: ExecutionSignals = {},
  options: { sessions?: Session[]; dayLogs?: DayLog[] } = {},
) {
  const capture = captureSources({ scope: { athleteId: 'a', epoch: 0, requestId: 'r' }, now: NOW, profile, sessions: options.sessions ?? [], dayLogs: options.dayLogs ?? [] })
  return resolveStrengthAthleteContext({ slotContext: deriveSlotContext(capture, SLOT), executionSignals: signals, declaration })
}

const profile = (extra: Partial<AthleteProfile> = {}): AthleteProfile => ({ id: 'a', updatedAt: 0, age: 30, ...extra })
const declared = (extra: AthleteDeclaration): AthleteDeclaration => ({ updatedAt: DECLARED_YESTERDAY, ...extra })

describe('I1 — escala única de fatiga', () => {
  it.each([
    ['fresh', 2, 'progress'], ['normal', 4, 'no_signal'], ['loaded', 6, 'hold'], ['overloaded', 8, 'reduce'],
  ] as const)('%s vigente → %i (%s)', (currentFatigue, level, verdict) => {
    const athlete = resolve(profile(), declared({ currentFatigue }))
    expect(athlete.fatigueLevel).toBe(level)
    expect(athlete.loadDecision.verdict).toBe(verdict)
  })

  it('sin datos ni declaración queda no_signal, distinguible de progress', () => {
    const athlete = resolve(profile(), undefined)
    expect(athlete).toMatchObject({ fatigueLevel: 4, declaredFatigue: undefined })
    expect(athlete.loadDecision.verdict).toBe('no_signal')
  })

  it('una señal aguda gana a la fatiga declarada (precedencia D6)', () => {
    const athlete = resolve(profile(), declared({ currentFatigue: 'fresh' }), { latestPainLevel: 7 })
    expect(athlete).toMatchObject({ fatigueLevel: 8, extraRecoveryReasons: ['acute_signal'], rpeAdjustment: -1 })
  })
})

describe('I6/I7 — vigencia de lo declarado', () => {
  it.each([
    ['2026-09-10T12:00:00.000Z', 'loaded'],   // 6 días → vigente
    ['2026-09-09T12:00:00.000Z', undefined],  // 7 días → vencida
    ['2026-09-17T12:00:00.000Z', undefined],  // declarada después del slot
    ['', undefined],                          // sin fecha verificable
  ] as const)('fatiga declarada el %s → %s', (updatedAt, expected) => {
    expect(resolveDeclaredAthleteState({ currentFatigue: 'loaded', updatedAt }, SLOT.date).declaredFatigue).toBe(expected)
  })

  it('una señal con fatiga declarada vencida no la reintroduce', () => {
    const athlete = resolve(profile(), { currentFatigue: 'overloaded', updatedAt: '2026-09-01T12:00:00.000Z' }, { declaredFatigue: 'overloaded' })
    expect(athlete.fatigueLevel).toBe(4)
  })

  it.each([
    ['2026-09-03T12:00:00.000Z', true],   // 13 días
    ['2026-09-02T12:00:00.000Z', false],  // 14 días
  ] as const)('retorno declarado el %s → %s', (updatedAt, active) => {
    const athlete = resolve(profile(), { currentFitnessLevel: 'returning', currentFatigue: 'normal', updatedAt })
    expect(athlete.returningFromBreak).toBe(active)
    expect(athlete.rpeAdjustment).toBe(active ? -1 : 0)
    expect(athlete.fatigueLevel).toBe(4)
  })
})

describe('D4/D5 — recuperación extra', () => {
  it('edad ≥ 35 a la fecha de la captura', () => {
    expect(resolve(profile({ age: 41 }), undefined).extraRecoveryReasons).toEqual(['age'])
    expect(resolve(profile({ age: 34 }), undefined).requireExtraRecovery).toBe(false)
    expect(resolve(profile({ age: 41 }), undefined).rpeAdjustment).toBe(0)
  })

  it('calcula la edad desde birthDate cuando no hay age', () => {
    const turns35Yesterday = { ...profile({ age: undefined }), birthDate: '1991-09-15' } as AthleteProfile
    const turns35Tomorrow = { ...profile({ age: undefined }), birthDate: '1991-09-17' } as AthleteProfile
    expect(resolve(turns35Yesterday, undefined).requireExtraRecovery).toBe(true)
    expect(resolve(turns35Tomorrow, undefined).requireExtraRecovery).toBe(false)
  })
})

describe('D1/D2 — experiencia con procedencia (I3)', () => {
  it('la declarada gana a cuatro 1RM', () => {
    const athlete = resolve(profile({ strengthProfile: { squat1RM: 1, deadlift1RM: 1, benchPress1RM: 1, overheadPress1RM: 1, experienceLevel: 'beginner' } }), undefined)
    expect(athlete).toMatchObject({ experienceLevel: 'beginner', experienceSource: 'declared' })
  })

  it.each([
    [{}, 'unknown', 'none'],
    [{ squat1RM: 100 }, 'beginner', 'inferred_1rm'],
    [{ squat1RM: 100, deadlift1RM: 120 }, 'intermediate', 'inferred_1rm'],
    [{ squat1RM: 100, deadlift1RM: 120, benchPress1RM: 80, overheadPress1RM: 50 }, 'advanced', 'inferred_1rm'],
  ] as const)('1RM %j → %s', (strengthProfile, level, source) => {
    expect(resolve(profile({ strengthProfile }), undefined)).toMatchObject({ experienceLevel: level, experienceSource: source })
  })
})

describe('I10 — historial', () => {
  it('recentExercises y historicalSessions sólo con lo anterior al slot', () => {
    const athlete = resolve(profile(), undefined, {}, { sessions: [
      strengthSession('before', '2026-09-14', 'goblet_squat'),
      strengthSession('after', '2026-09-18', 'back_squat'),
    ] })
    expect(athlete.historicalSessions.map((session) => session.id)).toEqual(['before'])
    expect(athlete.recentExercises).toEqual(['goblet_squat'])
  })

  it('1RM disponibles y equipamiento resuelto', () => {
    const athlete = resolve(profile({ strengthProfile: { squat1RM: 100, benchPress1RM: 80 }, availableEquipment: ['barbell', 'dumbbell'] }), undefined)
    expect([...athlete.available1RM].sort()).toEqual(['benchPress', 'squat'])
    expect(athlete.availableEquipment).toEqual(expect.arrayContaining(['barbell', 'dumbbell']))
  })
})

describe('toStrengthContextAthleteFields', () => {
  it('proyecta exactamente las claves de atleta', () => {
    const fields = toStrengthContextAthleteFields(resolve(profile(), undefined))
    expect(Object.keys(fields).sort()).toEqual([...STRENGTH_CONTEXT_ATHLETE_FIELDS].sort())
  })
})

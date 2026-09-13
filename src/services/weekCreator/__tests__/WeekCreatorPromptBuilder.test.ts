import { describe, expect, it } from 'vitest'
import type { AthleteProfile, ChatContext } from '../../../types'
import { buildWeekCreatorPrompt } from '../WeekCreatorPromptBuilder'
import type { WeekCreatorEffectiveConfig } from '../WeekCreatorConfig'

function makeConfig(overrides: Partial<WeekCreatorEffectiveConfig> = {}): WeekCreatorEffectiveConfig {
  return {
    trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    doubleSessionDays: [],
    sessionsPerWeek: 4,
    maxSessionsPerWeek: 5,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    allowedSports: ['squash', 'strength'],
    primarySport: 'squash',
    competitiveLevel: 'competitive',
    trainingPriority: 'performance',
    currentFitnessLevel: 'fit',
    currentFatigue: 'normal',
    fromWizard: true,
    configSource: 'wizard',
    ...overrides,
  }
}

function makeProfile(overrides: Partial<AthleteProfile> = {}): AthleteProfile {
  return {
    id: 'athlete-1',
    updatedAt: 0,
    name: 'Rafa',
    age: 40,
    weightKg: 78,
    sportContext: {
      enabledSports: ['squash', 'strength'],
      primarySport: 'squash',
      trainingPriority: 'performance',
    },
    mainGoal: 'Competir mejor',
    goalEvents: [{ id: 'goal-1', title: 'Open Nacional', date: '2026-07-20', sport: 'squash', priority: 'primary' }],
    macroPlan: {
      goalEventId: 'goal-1',
      goalEventDate: '2026-07-20',
      currentPhase: 'build',
      weeksRemaining: 5,
      blockFocus: 'Construir especificidad',
      headline: 'Bloque build',
      timeline: [],
      sportDetails: [
        {
          sport: 'squash',
          role: 'primary',
          phaseFocus: 'Especificidad',
          weeklyIntent: 'Sostener 3 estímulos de cancha con presión progresiva',
          volumeBias: 'build',
          intensityBias: 'build',
          notes: '',
        },
      ],
      secondaryEvents: [],
      computedAt: 0,
    } as AthleteProfile['macroPlan'],
    strengthProfile: {
      squat1RM: 120,
      benchPress1RM: 90,
      deadlift1RM: 150,
      overheadPress1RM: 60,
    },
    recoveryProfile: {
      restrictions: 'Molestia leve de hombro derecho',
    },
    ...overrides,
  }
}

function buildPrompt(
  contextOverrides: Partial<ChatContext> = {},
  configOverrides: Partial<WeekCreatorEffectiveConfig> = {},
  weekObjectives?: string[],
): string {
  const context: ChatContext = {
    athleteProfile: makeProfile(),
    recentSessions: [],
    plannedSessions: [],
    historicalSessions: [],
    weekDayLogs: [],
    ...contextOverrides,
  }

  return buildWeekCreatorPrompt(context, {
    userMessage: 'Créame la semana',
    targetWeekStart: '2026-06-15',
    config: makeConfig(configOverrides),
    strictFormatting: true,
    structuredOutput: true,
    weekObjectives,
  }).userPrompt
}

describe('buildWeekCreatorPrompt whoop effort', () => {
  it('does not show WHOOP-prefilled rpeActual as declared effort', () => {
    const prompt = buildPrompt({
      weekDayLogs: [
        { id: 'd1', date: '2026-06-10', rpeActual: 8, prefillSource: { rpeActual: 'whoop' }, updatedAt: 1 },
      ],
    })
    expect(prompt).not.toContain('RPE real 8/10')
    expect(prompt).not.toContain('esfuerzo 8/10')
  })

  it('shows a manually-set effort as "esfuerzo"', () => {
    const prompt = buildPrompt({
      weekDayLogs: [
        { id: 'd2', date: '2026-06-10', rpeActual: 9, updatedAt: 1 },
      ],
    })
    expect(prompt).toContain('esfuerzo 9/10')
  })
})

describe('buildWeekCreatorPrompt quality blocks', () => {
  it('uses one compact JSON contract when structured output is enabled', () => {
    const context: ChatContext = {
      athleteProfile: makeProfile(),
      recentSessions: [],
      plannedSessions: [],
      historicalSessions: [],
      weekDayLogs: [],
    }
    const result = buildWeekCreatorPrompt(context, {
      userMessage: 'Créame la semana',
      targetWeekStart: '2026-06-15',
      config: makeConfig(),
      strictFormatting: true,
      structuredOutput: true,
    })

    expect(result.systemPrompt).toContain('responseSchema')
    expect(result.systemPrompt).toContain('restricciones médicas activas')
    expect(result.systemPrompt).toContain('Omite exercises, squashDetails')
    expect(result.systemPrompt).toContain('la app los completa y valida localmente')
    expect(result.systemPrompt).not.toContain('primer caracter debe ser "<"')
    expect(result.userPrompt.match(/Contrato de salida obligatorio/g)).toBeNull()
    expect(result.systemPrompt.length).toBeLessThan(1_100)
  })

  it('states the minimum number of double sessions required by the target', () => {
    const prompt = buildPrompt({}, {
      trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
      doubleSessionDays: ['monday', 'wednesday', 'friday'],
      sessionsPerWeek: 8,
      maxSessionsPerWeek: 8,
      allowDoubleSession: true,
    })

    expect(prompt).toContain('debes usar al menos 2 doble(s) AM/PM')
  })

  it('renders an enriched athlete profile, week objectives and squash phase guide', () => {
    const prompt = buildPrompt({}, { currentFatigue: 'fresh' }, [
      'Consolidar presión a la T',
      'Subir carga de fuerza un escalón',
    ])

    expect(prompt).toContain('## PERFIL DEL ATLETA')
    expect(prompt).toContain('Back Squat/Sentadilla 120kg 1RM')
    expect(prompt).toContain('Bench Press 90kg 1RM')
    expect(prompt).toContain('Deadlift/Trap Bar ref. 150kg 1RM')
    expect(prompt).toContain('⚠️ Restricciones activas: Molestia leve de hombro derecho')
    expect(prompt).toContain('## OBJETIVOS DE LA SEMANA')
    expect(prompt).toContain('Consolidar presión a la T')
    expect(prompt).toContain('Subir carga de fuerza un escalón')
    expect(prompt).toContain('## GUÍA DE CONTENIDO — FASE BUILD')
    expect(prompt).toContain('pressure drills')
    expect(prompt).toContain('SUBIR CARGA')
  })

  it('keeps fitness/fatigue and operative level only in the athlete profile block', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain('- Estado de forma y fatiga: fitness fit · fatiga normal')
    expect(prompt).toContain('- Prioridad de entrenamiento: performance')
    expect(prompt).not.toContain('- Estado inicial:')
    expect(prompt).not.toContain('- Nivel operativo del atleta:')
    expect(prompt.match(/fitness fit · fatiga normal/g)).toHaveLength(1)
  })

  it('concatenates profile restrictions and wizard injury notes without duplicates', () => {
    const merged = buildPrompt({}, { injuryNotes: 'Evitar pliometría esta semana' })
    expect(merged).toContain('⚠️ Restricciones activas: Molestia leve de hombro derecho · Evitar pliometría esta semana')

    const deduped = buildPrompt({}, { injuryNotes: 'molestia leve de hombro derecho' })
    const restrictionLine = deduped.split('\n').find((line) => line.includes('Restricciones activas'))
    expect(restrictionLine).toBe('- ⚠️ Restricciones activas: Molestia leve de hombro derecho. Adapta carga, ejercicios, impactos y RPE a estas restricciones.')
  })

  it('renders the declared performance limiter as its own line, separate from restrictions', () => {
    const prompt = buildPrompt({
      athleteProfile: makeProfile({ performanceLimiter: 'recuperación cardíaca entre puntos' }),
    })

    expect(prompt).toContain('Limitante de rendimiento a trabajar: recuperación cardíaca entre puntos')
    const limiterLine = prompt.split('\n').find((line) => line.includes('Limitante de rendimiento'))
    expect(limiterLine).toBeDefined()
    expect(limiterLine).not.toContain('hombro')
  })

  it('omits the performance limiter line when it is absent or blank', () => {
    const absent = buildPrompt({ athleteProfile: makeProfile({ performanceLimiter: undefined }) })
    expect(absent).not.toContain('Limitante de rendimiento')

    const blank = buildPrompt({ athleteProfile: makeProfile({ performanceLimiter: '   ' }) })
    expect(blank).not.toContain('Limitante de rendimiento')
  })

  it('holds load without raising when fatigue is loaded', () => {
    const prompt = buildPrompt({
      historicalSessions: [
        { date: '2026-06-10', timeBlock: 'AM', type: 'squash', title: 'Control', durationMin: 60, rpe: 6 },
      ] as ChatContext['historicalSessions'],
    }, { currentFatigue: 'loaded' })

    expect(prompt).toContain('MANTENER SIN SUBIR — el atleta declara carga acumulada')
  })

  it('falls back to macro plan weekly intents when there is no active plan week', () => {
    const prompt = buildPrompt()

    expect(prompt).toContain('## OBJETIVOS DE LA SEMANA')
    expect(prompt).toContain('squash: Sostener 3 estímulos de cancha con presión progresiva')
  })

  it('omits the objectives block when neither source has content', () => {
    const prompt = buildPrompt({
      athleteProfile: makeProfile({ macroPlan: undefined }),
    })

    expect(prompt).not.toContain('## OBJETIVOS DE LA SEMANA')
  })

  it('reduces load when fatigue is overloaded before looking at history', () => {
    const prompt = buildPrompt({
      historicalSessions: [
        { date: '2026-06-10', timeBlock: 'AM', type: 'squash', title: 'Control', durationMin: 60, rpe: 6 },
      ] as ChatContext['historicalSessions'],
    }, { currentFatigue: 'overloaded' })

    expect(prompt).toContain('REDUCIR CARGA REAL — el atleta declara fatiga acumulada alta')
  })

  it('reduces load when the latest day log has low energy or high pain', () => {
    const prompt = buildPrompt({
      weekDayLogs: [
        { id: 'log-1', date: '2026-06-12', energyLevel: 4, painLevel: 2, updatedAt: 0 },
      ],
    }, { currentFatigue: 'fresh' })

    expect(prompt).toContain('REDUCIR CARGA REAL — el último registro marca energía 4/10')
  })

  it('uses the log with the latest date, not positional order, when several day logs are present', () => {
    // Regression guard for the final-review finding: buildWeekCreatorExecutionSignals
    // must pick the log by MAX date, never by array position — this caller pre-sorts
    // its own copy DESCENDING (recentLogs above) while the hydrator's call site passes
    // context.weekDayLogs ASCENDING; a positional pick (`[0]` or `.at(-1)`) is correct
    // for exactly one of the two and silently wrong for the other.
    const prompt = buildPrompt({
      weekDayLogs: [
        { id: 'log-old', date: '2026-06-10', energyLevel: 8, painLevel: 0, updatedAt: 0 },
        { id: 'log-new', date: '2026-06-12', energyLevel: 4, painLevel: 2, updatedAt: 0 },
      ],
    }, { currentFatigue: 'fresh' })

    expect(prompt).toContain('REDUCIR CARGA REAL — el último registro marca energía 4/10')
  })

  it('uses conservative or high-load directives from recent history', () => {
    const noHistoryPrompt = buildPrompt({}, { currentFatigue: 'normal' })
    expect(noHistoryPrompt).toContain('INICIAR CON CARGA CONSERVADORA')

    const highRpePrompt = buildPrompt({
      historicalSessions: [
        { date: '2026-06-11', timeBlock: 'AM', type: 'squash', title: 'Match 1', durationMin: 60, rpe: 6, actualRpe: 8, status: 'completed' },
        { date: '2026-06-10', timeBlock: 'PM', type: 'strength', title: 'Fuerza', durationMin: 60, rpe: 6, actualRpe: 9, status: 'completed' },
        { date: '2026-06-09', timeBlock: 'AM', type: 'squash', title: 'Match 2', durationMin: 75, rpe: 6, actualRpe: 8, status: 'completed' },
      ] as ChatContext['historicalSessions'],
    }, { currentFatigue: 'normal' })

    expect(highRpePrompt).toContain('MANTENER SIN SUBIR — el RPE real promedio fue 8.3/10 en 3 sesiones')
    expect(highRpePrompt).toContain('RPE promedio reciente: 8.3/10')
  })
})

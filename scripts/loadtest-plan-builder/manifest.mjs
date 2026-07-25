/**
 * Matriz experimental CONGELADA del control (spec §3.3). Cambiar cualquier
 * valor de este archivo invalida la comparabilidad con controles anteriores:
 * comparar variantes exige repetir exactamente el mismo manifest.
 */

export const MANIFEST_VERSION = 1
export const ATTEMPTED_PLAN_TOTAL = 12
export const TARGET_WEEK_TOTAL = 42

const PLANS_PER_SCENARIO = 2

function addDaysISO(startDate, days) {
  const date = new Date(`${startDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Lunes de la semana que contiene `isoDate`. `weekStartDate` es lunes por contrato. */
export function mondayOf(isoDate) {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  const weekday = date.getUTCDay()
  const offset = weekday === 0 ? -6 : 1 - weekday
  return addDaysISO(isoDate, offset)
}

function baseProfile(overrides) {
  return {
    id: 'loadtest-athlete',
    updatedAt: 1,
    sportContext: { enabledSports: ['squash', 'strength'], primarySport: 'squash' },
    ...overrides,
  }
}

function baseWizardConfig(overrides) {
  return {
    goalEventId: 'loadtest-event',
    trainingDays: ['monday', 'wednesday', 'friday'],
    sessionsPerWeek: 3,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    // La UI solo ofrece complementarios dentro de `enabledSports` menos el
    // primario (`CompetitionPlanPage.tsx:381`). Declarar running acá con un
    // perfil que no lo habilita produce una config irreproducible desde la app,
    // y encima lo cuela en getAllowedSports sin carga objetivo ni sportDetails.
    complementarySports: ['strength'],
    currentFitnessLevel: 'normal',
    currentFatigue: 'fresh',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function sportDetail(sport, role) {
  return {
    sport,
    role,
    phaseFocus: '',
    weeklyIntent: '',
    volumeBias: 'hold',
    intensityBias: 'hold',
    notes: '',
  }
}

/** Todas las semanas en `build` salvo que el escenario diga otra cosa. */
const buildEveryWeek = () => 'build'

export const SCENARIOS = {
  squash_build: {
    key: 'squash_build',
    weekCount: 4,
    startDate: '2026-08-03',
    primarySport: 'squash',
    sportDetails: [sportDetail('squash', 'primary'), sportDetail('strength', 'support')],
    targetLoadBySport: { squash: 50, strength: 25 },
    phaseForWeek: buildEveryWeek,
    buildProfile: () => baseProfile({}),
    buildWizardConfig: () => baseWizardConfig({}),
  },
  squash_taper_medico: {
    key: 'squash_taper_medico',
    weekCount: 3,
    startDate: '2026-08-10',
    primarySport: 'squash',
    sportDetails: [sportDetail('squash', 'primary'), sportDetail('strength', 'support')],
    targetLoadBySport: { squash: 40, strength: 15 },
    // Escenario de taper de verdad: sin fases taper/race mediría lo mismo que build.
    phaseForWeek: (index, weekCount) => {
      if (index === weekCount - 1) return 'race'
      if (index === weekCount - 2) return 'taper'
      return 'peak'
    },
    buildProfile: () => baseProfile({}),
    buildWizardConfig: () => baseWizardConfig({
      // `injuryNotes` vive en el wizard config, que es lo que lee el motor.
      injuryNotes: 'Molestia de rodilla derecha en control, sin dolor agudo.',
      currentFitnessLevel: 'fit',
      currentFatigue: 'loaded',
      complementarySports: ['strength'],
    }),
  },
  running: {
    key: 'running',
    weekCount: 4,
    startDate: '2026-08-17',
    primarySport: 'running',
    // El primary DEBE estar en sportDetails o filterDisallowedSports descarta
    // todas las sesiones del deporte del escenario.
    sportDetails: [sportDetail('running', 'primary'), sportDetail('strength', 'support')],
    targetLoadBySport: { running: 60, strength: 20 },
    phaseForWeek: buildEveryWeek,
    buildProfile: () => baseProfile({
      sportContext: { enabledSports: ['running', 'strength'], primarySport: 'running' },
    }),
    buildWizardConfig: () => baseWizardConfig({
      complementarySports: ['strength'],
      trainingDays: ['monday', 'tuesday', 'thursday', 'saturday'],
      sessionsPerWeek: 4,
    }),
  },
  ciclismo: {
    key: 'ciclismo',
    weekCount: 3,
    startDate: '2026-08-24',
    primarySport: 'cycling',
    sportDetails: [sportDetail('cycling', 'primary'), sportDetail('strength', 'support')],
    targetLoadBySport: { cycling: 60, strength: 20 },
    phaseForWeek: buildEveryWeek,
    buildProfile: () => baseProfile({
      sportContext: { enabledSports: ['cycling', 'strength'], primarySport: 'cycling' },
    }),
    buildWizardConfig: () => baseWizardConfig({
      complementarySports: ['strength'],
      sessionDurationMins: 90,
      trainingDays: ['tuesday', 'thursday', 'sunday'],
    }),
  },
  dobles: {
    key: 'dobles',
    weekCount: 4,
    startDate: '2026-08-31',
    primarySport: 'squash',
    sportDetails: [sportDetail('squash', 'primary'), sportDetail('strength', 'support')],
    targetLoadBySport: { squash: 70, strength: 30 },
    phaseForWeek: buildEveryWeek,
    buildProfile: () => baseProfile({}),
    buildWizardConfig: () => baseWizardConfig({
      allowDoubleSession: true,
      sessionsPerWeek: 5,
      trainingDays: ['monday', 'tuesday', 'wednesday', 'friday', 'saturday'],
    }),
  },
  semana_parcial: {
    key: 'semana_parcial',
    weekCount: 3,
    // Fecha congelada: MIÉRCOLES. `plan.startDate` cae a mitad de semana y la
    // primera `weekStartDate` es el lunes anterior (2026-09-07). Así la semana
    // parcial es real; meter el miércoles en `weekStartDate` produciría una
    // semana miércoles-martes que el prompt describiría como lunes.
    startDate: '2026-09-09',
    primarySport: 'squash',
    sportDetails: [sportDetail('squash', 'primary'), sportDetail('strength', 'support')],
    targetLoadBySport: { squash: 40, strength: 20 },
    phaseForWeek: buildEveryWeek,
    buildProfile: () => baseProfile({}),
    buildWizardConfig: () => baseWizardConfig({ sessionsPerWeek: 3 }),
  },
}

const SCENARIO_ORDER = [
  'squash_build',
  'squash_taper_medico',
  'running',
  'ciclismo',
  'dobles',
  'semana_parcial',
]

export function buildManifest() {
  const cases = []
  for (const scenarioKey of SCENARIO_ORDER) {
    const scenario = SCENARIOS[scenarioKey]
    for (let planIndex = 1; planIndex <= PLANS_PER_SCENARIO; planIndex++) {
      cases.push({
        caseId: `${scenarioKey}#${planIndex}`,
        scenarioKey,
        planIndex,
        weekCount: scenario.weekCount,
        startDate: scenario.startDate,
      })
    }
  }
  return cases
}

export function buildPlanFixture(manifestCase) {
  const scenario = SCENARIOS[manifestCase.scenarioKey]
  const wizardConfig = scenario.buildWizardConfig()
  const planId = `loadtest-${manifestCase.caseId.replace('#', '-')}`
  // La primera semana se ancla al lunes de la semana que contiene startDate.
  // Cuando startDate cae a mitad de semana, esa primera semana es parcial.
  const firstMonday = mondayOf(manifestCase.startDate)
  const endDate = addDaysISO(firstMonday, manifestCase.weekCount * 7 - 1)
  const goalEventId = wizardConfig.goalEventId
  const profile = {
    ...scenario.buildProfile(),
    goalEvents: [{
      id: goalEventId,
      title: `Loadtest ${scenario.key}`,
      date: endDate,
      sport: scenario.primarySport,
      priority: 'primary',
    }],
  }
  const phases = Array.from({ length: manifestCase.weekCount }, (_, index) =>
    scenario.phaseForWeek(index, manifestCase.weekCount))

  const plan = {
    id: planId,
    athleteId: 'loadtest-athlete',
    goalEventId,
    status: 'draft',
    generationState: 'shell',
    title: `Loadtest ${manifestCase.caseId}`,
    startDate: manifestCase.startDate,
    endDate,
    totalWeeks: manifestCase.weekCount,
    phases: phases.map((phase, index) => ({
      phase,
      startWeekIndex: index,
      endWeekIndex: index,
      blockFocus: '',
      intentBySport: {},
    })),
    wizardConfig,
    macroSnapshot: {
      goalEventId,
      goalEventDate: endDate,
      currentPhase: phases[0],
      weeksRemaining: manifestCase.weekCount,
      blockFocus: '',
      headline: '',
      timeline: [],
      sportDetails: scenario.sportDetails,
      secondaryEvents: [],
      computedAt: 0,
    },
    createdAt: 1,
    updatedAt: 1,
  }

  const weeks = Array.from({ length: manifestCase.weekCount }, (_, index) => ({
    id: `${planId}-week-${index}`,
    planId,
    weekIndex: index,
    weekStartDate: addDaysISO(firstMonday, index * 7),
    phase: phases[index],
    status: 'pending',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: scenario.targetLoadBySport,
    validationIssues: [],
    generationMeta: { attempts: 0 },
    createdAt: 1,
    updatedAt: 1,
  }))

  return { plan, weeks, profile, wizardConfig }
}

/**
 * Snapshot serializable y AUTOCONTENIDO del manifest. Es lo único que Entrega 2
 * puede leer de un artefacto histórico: si algo no está acá, esa corrida deja de
 * ser reconstruible en cuanto este archivo cambie.
 */
export function describeManifest() {
  return {
    manifestVersion: MANIFEST_VERSION,
    attemptedPlanTotal: ATTEMPTED_PLAN_TOTAL,
    targetWeekTotal: TARGET_WEEK_TOTAL,
    cases: buildManifest().map((manifestCase) => {
      const scenario = SCENARIOS[manifestCase.scenarioKey]
      const { plan, weeks, profile, wizardConfig } = buildPlanFixture(manifestCase)
      return {
        ...manifestCase,
        primarySport: scenario.primarySport,
        sportDetails: scenario.sportDetails,
        targetLoadBySport: scenario.targetLoadBySport,
        planStartDate: plan.startDate,
        planEndDate: plan.endDate,
        // Descriptor efectivo por semana: sin esto no se puede saber qué se
        // pidió realmente en cada una.
        weeks: weeks.map((week) => ({
          weekIndex: week.weekIndex,
          weekStartDate: week.weekStartDate,
          phase: week.phase,
          targetLoadBySport: week.targetLoadBySport,
        })),
        profile,
        wizardConfig,
      }
    }),
  }
}

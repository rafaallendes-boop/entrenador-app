/**
 * Casos dirigidos del probe de selección deportiva (E0).
 *
 * Reglas de este archivo:
 *
 * - **Dirigidos, no cartesianos.** Cada caso existe para caracterizar un
 *   hallazgo concreto del audit y lo declara en `covers`. Un par que no
 *   discrimina nada no entra.
 * - **Sin reloj.** Todas las fechas son literales y anteriores o iguales a
 *   `PROBE_TODAY`. Nada acá puede depender de cuándo se ejecuta el probe.
 * - **Sin expectativas.** Estos casos describen entradas; la salida esperada
 *   vive en el artefacto congelado, que es caracterización del comportamiento
 *   actual —incluido el defectuoso—, no un contrato deseado.
 */

/** Fecha de referencia única. El probe nunca lee el reloj. */
export const PROBE_TODAY = '2026-09-07'

const GOAL_SQUASH = 'mejorar squash'
const GOAL_SUPPORT = 'base aeróbica para squash'

/** Sesión de squash sintética con drills nombrados del catálogo. */
export function squashSession({ id, date, status, drillNames, timeBlock = 'AM' }) {
  return {
    id,
    athleteId: 'probe-athlete',
    date,
    timeBlock,
    type: 'squash',
    subtype: 'training',
    status,
    title: 'Sesión de squash',
    durationMin: 60,
    rpe: 6,
    squashDetails: {
      trainingFocus: 'technical',
      sessionMode: 'drill_session',
      sessionKind: 'technical',
      drills: drillNames.map((name) => ({ name, durationMin: 16 })),
    },
  }
}

/** Sesión de running sintética. `runningType` y título alimentan la inferencia de familia. */
export function runningSession({ id, date, status, runningType, title, objective = '', timeBlock = 'AM' }) {
  return {
    id,
    athleteId: 'probe-athlete',
    date,
    timeBlock,
    type: 'running',
    subtype: 'easy',
    status,
    title,
    objective,
    durationMin: 45,
    rpe: 4,
    runningDetails: { runningType },
  }
}

// ─── Squash: composición por duración (S1) ──────────────────────────────────

const squashBase = {
  phase: 'build',
  fatigueLevel: 4,
  goal: GOAL_SQUASH,
  recentDrills: [],
  competitionSoon: false,
  partnerAvailability: 'partner',
}

export const SQUASH_HYDRATION_CASES = [
  ...[15, 20, 30, 45, 60].map((durationMin) => ({
    name: `technical/build/f4/partner/${durationMin}min`,
    covers: ['S1'],
    input: { ...squashBase, kind: 'technical', durationMin },
  })),
  {
    name: 'control/base/f4/solo/45min',
    covers: ['S1'],
    input: { ...squashBase, phase: 'base', kind: 'control', durationMin: 45, partnerAvailability: 'solo' },
  },
  {
    name: 'match/peak/f3/partner/60min',
    covers: ['S1'],
    input: { ...squashBase, phase: 'peak', kind: 'match', durationMin: 60, fatigueLevel: 3 },
  },
  {
    name: 'match/peak/f3/solo/60min — redirección declarada',
    covers: ['S1', 'S5'],
    input: {
      ...squashBase,
      phase: 'peak',
      kind: 'match',
      durationMin: 60,
      fatigueLevel: 3,
      partnerAvailability: 'solo',
    },
  },
  {
    name: 'shadows/taper/f7/solo/30min',
    covers: ['S1'],
    input: { ...squashBase, phase: 'taper', kind: 'shadows', durationMin: 30, fatigueLevel: 7, partnerAvailability: 'solo' },
  },
  {
    name: 'technical/taper/f8/partner/45min — fatiga alta',
    covers: ['S1'],
    input: { ...squashBase, phase: 'taper', kind: 'technical', durationMin: 45, fatigueLevel: 8 },
  },
  {
    name: 'technical/build/f4/partner/45min + sombras accesorias',
    covers: ['S1'],
    input: { ...squashBase, kind: 'technical', durationMin: 45, withShadowsAccessory: true },
  },
  {
    name: 'technical/base/f9/partner/45min — pool exprimido por fatiga',
    covers: ['S1', 'S6'],
    input: { ...squashBase, phase: 'base', kind: 'technical', durationMin: 45, fatigueLevel: 9 },
  },
]

// ─── Squash: selección, fase y ejecución (S5, S6) ────────────────────────────

export const SQUASH_SELECTION_CASES = [
  {
    name: 'genérico/base/f2/either — sin desiredKind',
    covers: ['S6'],
    input: { ...squashBase, phase: 'base', fatigueLevel: 2, partnerAvailability: undefined },
  },
  {
    name: 'genérico/base/f9/either — sin desiredKind, pool exprimido',
    covers: ['S6'],
    input: { ...squashBase, phase: 'base', fatigueLevel: 9, partnerAvailability: undefined },
  },
  {
    name: 'genérico/taper/f8/either — sin desiredKind',
    covers: ['S6'],
    input: { ...squashBase, phase: 'taper', fatigueLevel: 8, partnerAvailability: undefined },
  },
  {
    name: 'desiredKind=technical/base/f9 — modalidad explícita conserva fase',
    covers: ['S6'],
    input: { ...squashBase, phase: 'base', fatigueLevel: 9, desiredKind: 'technical' },
  },
  {
    name: 'genérico/build/f4/solo — ejecución sin partner',
    covers: ['S5'],
    input: { ...squashBase, partnerAvailability: 'solo' },
  },
  {
    name: 'genérico/build/f4/partnerAvailability ausente — default del selector',
    covers: ['S5'],
    input: { ...squashBase, partnerAvailability: undefined },
  },
]

// ─── Squash: historial y progresión (S2, S3) ─────────────────────────────────

const DRIVE_FAMILY_SESSION = ['Drives paralelos profundos']
const DRIVE_FAMILY_MULTI = [
  'Drives paralelos profundos',
  'Drives cruzados profundos',
  'Alternar drive paralelo y cruzado',
]

export const SQUASH_HISTORY_CASES = [
  ...['completed', 'adjusted', 'planned', 'skipped'].map((status) => ({
    name: `historial estado=${status}`,
    covers: ['S2'],
    sessions: [squashSession({ id: `h-${status}`, date: '2026-09-06', status, drillNames: DRIVE_FAMILY_SESSION })],
  })),
  {
    name: 'historial con fecha futura (planned 2026-09-20)',
    covers: ['S2'],
    sessions: [squashSession({ id: 'h-future', date: '2026-09-20', status: 'planned', drillNames: DRIVE_FAMILY_SESSION })],
  },
  {
    name: 'una sesión con tres drills de la misma familia',
    covers: ['S3'],
    sessions: [squashSession({ id: 'h-multi', date: '2026-09-06', status: 'completed', drillNames: DRIVE_FAMILY_MULTI })],
  },
  {
    name: 'dos sesiones completadas de la misma familia',
    covers: ['S3'],
    sessions: [
      squashSession({ id: 'h-d1', date: '2026-09-06', status: 'completed', drillNames: DRIVE_FAMILY_SESSION }),
      squashSession({ id: 'h-d2', date: '2026-09-04', status: 'completed', drillNames: ['Drives cruzados profundos'] }),
    ],
  },
  {
    name: 'familias solo/volume_reps distintas colapsadas',
    covers: ['S3'],
    sessions: [
      squashSession({ id: 'h-s1', date: '2026-09-06', status: 'completed', drillNames: ['Saque lob a objetivo — 100 (50 por lado)'] }),
      squashSession({ id: 'h-s2', date: '2026-09-04', status: 'completed', drillNames: ['Drops en solitario — 100 (50 por lado)'] }),
    ],
  },
]

// ─── Running: contexto declarado vs efectivo (R1, R2) ────────────────────────

const runningBase = {
  fatigueLevel: 4,
  phase: 'build',
  recentSessions: [],
  goal: GOAL_SUPPORT,
  sportProfile: 'sport_support',
  primarySport: 'squash',
  competitionSoon: false,
}

export const RUNNING_SELECTION_CASES = [
  { name: 'base sport_support/build/f4', covers: ['R1'], input: { ...runningBase } },
  ...[15, 20, 30, 45, 60].map((sessionDurationMin) => ({
    name: `sessionDurationMin=${sessionDurationMin}`,
    covers: ['R1'],
    input: { ...runningBase, sessionDurationMin },
  })),
  ...['beginner', 'intermediate', 'advanced'].map((experienceLevel) => ({
    name: `experienceLevel=${experienceLevel}`,
    covers: ['R1'],
    input: { ...runningBase, experienceLevel },
  })),
  ...[2, 6].map((weeklyRunCount) => ({
    name: `weeklyRunCount=${weeklyRunCount}`,
    covers: ['R1'],
    input: { ...runningBase, weeklyRunCount },
  })),
  {
    name: 'primarySport=squash vs ausente',
    covers: ['R2'],
    input: { ...runningBase, primarySport: undefined },
  },
  {
    name: 'sport_support con dos rodajes fáciles recientes',
    covers: ['R3', 'R4'],
    input: { ...runningBase, recentSessions: ['easy_aerobic', 'easy_aerobic'] },
  },
  {
    name: 'sport_support con easy + recovery recientes',
    covers: ['R4'],
    input: { ...runningBase, recentSessions: ['easy_aerobic', 'recovery'] },
  },
  {
    name: 'sport_support/base con dos rodajes fáciles recientes',
    covers: ['R3', 'R4'],
    input: { ...runningBase, phase: 'base', recentSessions: ['easy_aerobic', 'easy_aerobic'] },
  },
  {
    name: 'sport_support/f8 — fatiga alta',
    covers: ['R3'],
    input: { ...runningBase, fatigueLevel: 8 },
  },
  {
    name: 'sport_support/f8 con dos rodajes fáciles recientes',
    covers: ['R3', 'R4'],
    input: { ...runningBase, fatigueLevel: 8, recentSessions: ['easy_aerobic', 'easy_aerobic'] },
  },
  {
    name: 'sport_support/taper con competencia próxima',
    covers: ['R3'],
    input: { ...runningBase, phase: 'taper', competitionSoon: true, daysToCompetition: 2 },
  },
  // `recentSessions` (claves de familia) alimenta el filtro duro de recencia;
  // `historicalSessions` alimenta la progresión. Son dos fuentes distintas de
  // «reciente» y un productor puede llenar una sola. Se prueban por separado y
  // juntas para que la diferencia quede registrada.
  {
    name: 'dos rodajes fáciles sólo en historicalSessions',
    covers: ['R4'],
    input: {
      ...runningBase,
      historicalSessions: [
        runningSession({ id: 'rr-1', date: '2026-09-05', status: 'completed', runningType: 'z2', title: 'Rodaje fácil' }),
        runningSession({ id: 'rr-2', date: '2026-09-03', status: 'completed', runningType: 'z2', title: 'Rodaje fácil' }),
      ],
    },
  },
  {
    name: 'dos rodajes fáciles en ambas fuentes',
    covers: ['R3', 'R4'],
    input: {
      ...runningBase,
      recentSessions: ['easy_aerobic', 'easy_aerobic'],
      historicalSessions: [
        runningSession({ id: 'rb-1', date: '2026-09-05', status: 'completed', runningType: 'z2', title: 'Rodaje fácil' }),
        runningSession({ id: 'rb-2', date: '2026-09-03', status: 'completed', runningType: 'z2', title: 'Rodaje fácil' }),
      ],
    },
  },
  {
    name: 'dos rodajes fáciles en ambas fuentes, fatiga 2',
    covers: ['R3', 'R4'],
    input: {
      ...runningBase,
      fatigueLevel: 2,
      recentSessions: ['easy_aerobic', 'easy_aerobic'],
      historicalSessions: [
        runningSession({ id: 'rc-1', date: '2026-09-05', status: 'completed', runningType: 'z2', title: 'Rodaje fácil' }),
        runningSession({ id: 'rc-2', date: '2026-09-03', status: 'completed', runningType: 'z2', title: 'Rodaje fácil' }),
      ],
    },
  },
]

export const RUNNING_HISTORY_CASES = [
  ...['completed', 'adjusted', 'planned', 'skipped'].map((status) => ({
    name: `historial running estado=${status}`,
    covers: ['S2'],
    sessions: [
      runningSession({ id: `r-${status}-1`, date: '2026-09-05', status, runningType: 'z2', title: 'Rodaje fácil' }),
      runningSession({ id: `r-${status}-2`, date: '2026-09-03', status, runningType: 'z2', title: 'Rodaje fácil' }),
    ],
  })),
  {
    name: 'sprint en cuesta clasificado por título',
    covers: ['R5'],
    sessions: [
      runningSession({ id: 'r-hill', date: '2026-09-05', status: 'completed', runningType: 'intervals', title: 'Short hill sprints' }),
    ],
  },
  {
    name: 'sesión específica de 10K clasificada por runningType',
    covers: ['R5'],
    sessions: [
      runningSession({ id: 'r-10k', date: '2026-09-05', status: 'completed', runningType: 'intervals', title: '10K pace reps' }),
    ],
  },
]

// ─── Ruta: materialización vía repairGeneratedWeek (R6, R7, R8, S1, S5) ──────

/**
 * Semana base de la ruta Plan Builder / Week Creator.
 *
 * No es decorativa. Con una sola sesión, el repair convierte lo que le llegue
 * en squash para cubrir el mínimo del deporte principal y agrega el partido
 * duro semanal: el caso de running desaparecía antes de materializarse. La
 * semana tiene que satisfacer esos mínimos **antes** de que la sesión bajo
 * estudio pueda observarse.
 */
export const WEEK_TRAINING_DAYS = ['monday', 'tuesday', 'thursday', 'saturday']
export const WEEK_SESSIONS_PER_WEEK = 4

const SLOT_MATCH = { date: '2026-06-01', timeBlock: 'PM' }
const SLOT_SQUASH = { date: '2026-06-02', timeBlock: 'AM' }
const SLOT_RUNNING = { date: '2026-06-04', timeBlock: 'AM' }
const SLOT_CONTROL = { date: '2026-06-06', timeBlock: 'AM' }

export const RUNNING_SLOT = SLOT_RUNNING
export const SQUASH_SLOT = SLOT_SQUASH

/** Sesiones de relleno que cubren los mínimos; nunca son la sesión observada. */
export function baseWeekProposals() {
  return [
    {
      ...SLOT_MATCH,
      sessionType: 'squash',
      subtype: 'match',
      squashKind: 'match',
      title: 'Partido de entrenamiento',
      objective: 'competir',
      durationMin: 60,
      rpe: 8,
    },
    {
      ...SLOT_SQUASH,
      sessionType: 'squash',
      subtype: 'training',
      squashKind: 'technical',
      title: 'Técnica',
      objective: 'técnica',
      durationMin: 60,
      rpe: 6,
    },
    {
      ...SLOT_RUNNING,
      sessionType: 'running',
      subtype: 'easy',
      runningType: 'z2',
      title: 'Rodaje',
      objective: 'base',
      durationMin: 45,
      rpe: 4,
    },
    {
      ...SLOT_CONTROL,
      sessionType: 'squash',
      subtype: 'control',
      squashKind: 'control',
      title: 'Control',
      objective: 'control',
      durationMin: 45,
      rpe: 5,
    },
  ]
}

export const REPAIR_RUNNING_CASES = [
  ...[20, 30, 45, 60].map((durationMin) => ({
    name: `tempo ${durationMin}min`,
    covers: ['R6', 'R7', 'R8'],
    session: { sessionType: 'running', subtype: 'tempo', runningType: 'tempo', title: 'Tempo', objective: 'umbral', durationMin, rpe: 7 },
  })),
  ...[40, 60].map((durationMin) => ({
    name: `intervals ${durationMin}min`,
    covers: ['R6', 'R7'],
    session: { sessionType: 'running', subtype: 'intervals', runningType: 'intervals', title: 'Series', objective: 'VO2', durationMin, rpe: 8 },
  })),
  {
    name: 'intervals sin runningType declarado',
    covers: ['R6'],
    session: { sessionType: 'running', subtype: 'intervals', title: 'Series', objective: 'VO2', durationMin: 50, rpe: 8 },
  },
  {
    name: 'z2 45min',
    covers: ['R7', 'R8'],
    session: { sessionType: 'running', subtype: 'easy', runningType: 'z2', title: 'Rodaje', objective: 'base', durationMin: 45, rpe: 4 },
  },
  {
    name: 'long 70min',
    covers: ['R7', 'R8'],
    session: { sessionType: 'running', subtype: 'long', runningType: 'long', title: 'Fondo', objective: 'fondo', durationMin: 70, rpe: 5 },
  },
]

export const REPAIR_SQUASH_CASES = [
  ...[30, 45, 60].map((durationMin) => ({
    name: `squash technical ${durationMin}min`,
    covers: ['S1'],
    partnerAvailability: undefined,
    session: { sessionType: 'squash', subtype: 'training', squashKind: 'technical', title: 'Técnica', objective: 'técnica', durationMin, rpe: 6 },
  })),
  {
    name: 'squash match 60min con wizard solo',
    covers: ['S5'],
    partnerAvailability: 'solo',
    session: { sessionType: 'squash', subtype: 'match', squashKind: 'match', title: 'Partido', objective: 'partido', durationMin: 60, rpe: 8 },
  },
  {
    name: 'squash match 60min con wizard ausente (default)',
    covers: ['S5'],
    partnerAvailability: undefined,
    session: { sessionType: 'squash', subtype: 'match', squashKind: 'match', title: 'Partido', objective: 'partido', durationMin: 60, rpe: 8 },
  },
]

// ─── Ruta: chat (postProcessCoachActions) ────────────────────────────────────

/**
 * El chat no pasa por `repairGeneratedWeek`: tiene su propio post-procesador,
 * con un tercer productor de estructura de running
 * (`buildRunningZone2IntervalStructure`). Por eso la ruta se prueba aparte y no
 * se asume equivalente a la de Plan Builder.
 */
export const CHAT_CASES = [
  ...[20, 30, 45, 60].map((durationMin) => ({
    name: `chat add_session running Z2 ${durationMin}min`,
    covers: ['R8'],
    userMessage: `agrega un running z2 de ${durationMin} minutos manana`,
    action: {
      type: 'add_session',
      reason: 'pedido explícito',
      sessionType: 'running',
      title: 'Running',
      objective: 'base',
      durationMin,
      targetDate: '2026-09-08',
      timeBlock: 'AM',
      rpe: 4,
    },
  })),
  ...[30, 45, 60].map((durationMin) => ({
    name: `chat add_session squash technical ${durationMin}min`,
    covers: ['S1'],
    userMessage: `agrega una sesion de squash tecnica de ${durationMin} minutos manana`,
    action: {
      type: 'add_session',
      reason: 'pedido explícito',
      sessionType: 'squash',
      subtype: 'training',
      squashKind: 'technical',
      title: 'Técnica de squash',
      objective: 'técnica',
      durationMin,
      targetDate: '2026-09-08',
      timeBlock: 'AM',
      rpe: 6,
    },
  })),
]

export type ActionKind =
  | 'create_week'
  | 'add_session'
  | 'update_session'
  | 'move_session'
  | 'skip_session'
  | 'delete_session'
  | 'replace_session_type'
  | 'change_rpe'
  | 'shorten_session'
  | 'lengthen_session'
  | 'insert_recovery'

export type OutputContractDensity = 'minimal' | 'full'

export type JsonSchemaType = 'STRING' | 'INTEGER' | 'NUMBER' | 'OBJECT' | 'ARRAY'

export interface FieldSpec {
  name: string
  type: JsonSchemaType
  required?: boolean
  enumValues?: readonly string[]
  items?: FieldSpec
  fields?: readonly FieldSpec[]
}

export interface ActionCatalogContext {
  allowedSessionTypes?: string
}

export interface ActionContract {
  kind: ActionKind
  fields: readonly FieldSpec[]
  prose?: Record<OutputContractDensity, readonly string[]>
  catalog?: (ctx: ActionCatalogContext) => string
}

function field(
  name: string,
  type: JsonSchemaType,
  options: Omit<FieldSpec, 'name' | 'type'> = {},
): FieldSpec {
  return { name, type, ...options }
}

function objectField(
  name: string,
  fields: readonly FieldSpec[],
  options: Omit<FieldSpec, 'name' | 'type' | 'fields'> = {},
): FieldSpec {
  return field(name, 'OBJECT', { ...options, fields })
}

function arrayField(
  name: string,
  items: FieldSpec,
  options: Omit<FieldSpec, 'name' | 'type' | 'items'> = {},
): FieldSpec {
  return field(name, 'ARRAY', { ...options, items })
}

const drillFields = [
  field('name', 'STRING', { required: true }),
  field('durationMin', 'INTEGER'),
  field('notes', 'STRING'),
] as const

const sessionFields = [
  field('date', 'STRING', { required: true }),
  field('timeBlock', 'STRING', { required: true, enumValues: ['AM', 'PM'] }),
  field('sessionType', 'STRING', {
    required: true,
    enumValues: ['squash', 'running', 'cycling', 'strength', 'mobility'],
  }),
  field('title', 'STRING', { required: true }),
  field('durationMin', 'INTEGER', { required: true }),
  field('rpe', 'INTEGER'),
  field('objective', 'STRING', { required: true }),
  field('subtype', 'STRING', { enumValues: ['training', 'match', 'competitive', 'control', 'light'] }),
  field('runningType', 'STRING', { enumValues: ['z2', 'tempo', 'intervals', 'long'] }),
  field('targetPaceMin', 'STRING'),
  field('targetPaceMax', 'STRING'),
  field('targetHrMin', 'INTEGER'),
  field('targetHrMax', 'INTEGER'),
  objectField('intervalStructure', [
    arrayField('blocks', objectField('block', [
      field('label', 'STRING', { required: true }),
      field('repetitions', 'INTEGER'),
      field('durationMin', 'INTEGER'),
      field('distanceKm', 'NUMBER'),
      field('targetPace', 'STRING'),
      field('targetHrMax', 'INTEGER'),
      field('notes', 'STRING'),
    ]), { required: true }),
  ]),
  arrayField('exercises', objectField('exercise', [
    field('name', 'STRING', { required: true }),
    field('sets', 'INTEGER'),
    field('reps', 'STRING'),
    field('weight', 'NUMBER'),
    field('group', 'STRING', { enumValues: ['push', 'pull', 'legs', 'core', 'olympic', 'cardio', 'mobility', 'other'] }),
    field('notes', 'STRING'),
    field('targetPercent1RM', 'NUMBER'),
    field('targetRpe', 'NUMBER'),
    arrayField('warmupSets', objectField('warmupSet', [
      field('reps', 'STRING'),
      field('weight', 'NUMBER'),
      field('percent1RM', 'NUMBER'),
    ])),
  ])),
  objectField('squashDetails', [
    field('trainingFocus', 'STRING', {
      required: true,
      enumValues: ['technical', 'tactical', 'physical', 'conditioned_games'],
    }),
    field('sessionMode', 'STRING', {
      required: true,
      enumValues: ['drill_session', 'practice_match', 'competition_match'],
    }),
    field('sessionKind', 'STRING', {
      enumValues: ['technical', 'control', 'shadows', 'match', 'mixed'],
    }),
    arrayField('drills', objectField('drill', drillFields), { required: true }),
    arrayField('blocks', objectField('block', [
      field('kind', 'STRING', {
        required: true,
        enumValues: ['technical', 'control', 'shadows', 'match'],
      }),
      field('durationMin', 'INTEGER'),
      arrayField('drills', objectField('drill', drillFields), { required: true }),
    ])),
  ]),
  objectField('cyclingDetails', [
    field('sessionCategory', 'STRING', { required: true }),
    field('sessionFamily', 'STRING'),
    field('targetStructure', 'STRING', { required: true }),
    field('intensityReference', 'STRING'),
    field('executionNotes', 'STRING'),
  ]),
  objectField('mobilityDetails', [
    arrayField('focusAreas', field('focusArea', 'STRING'), { required: true }),
    field('context', 'STRING', {
      required: true,
      enumValues: [
        'post_run',
        'post_cycling',
        'post_squash',
        'post_strength',
        'pre_training_activation',
        'recovery',
        'full_body',
        'sport_specific',
      ],
    }),
    field('targetStructure', 'STRING', { required: true }),
    field('executionNotes', 'STRING'),
  ]),
] as const

export const CREATE_WEEK_ACTION_CONTRACT: ActionContract = {
  kind: 'create_week',
  fields: [
    field('type', 'STRING', { required: true, enumValues: ['create_week'] }),
    field('reason', 'STRING', { required: true }),
    field('targetDate', 'STRING', { required: true }),
    arrayField('weekObjectives', field('weekObjective', 'STRING')),
    arrayField('sessions', objectField('session', sessionFields), { required: true }),
  ],
  catalog: () => '- create_week — campos: sessions (array con detalles útiles y válidos), weekObjectives (array de strings), reason',
  prose: {
    minimal: [
      '',
      '═══ ESQUEMA DE SESIÓN ═══',
      'Campos obligatorios por sesión:',
      '  date: "YYYY-MM-DD" dentro de la semana objetivo',
      '  timeBlock: "AM" | "PM"',
      '  sessionType: "squash" | "running" | "cycling" | "strength" | "mobility" | "recovery" | "nutrition"',
      '  title: string no vacío',
      '  durationMin: número entero >= 5',
      '  objective: string corto',
      '  rpe: número 1-10 (opcional pero recomendado)',
      '',
      'Campos opcionales por deporte:',
      '  squash → subtype: "training" | "match" | "competitive" | "control" | "light"',
      '  running → runningType: "z2" | "tempo" | "intervals" | "long"',
      '',
      'NO incluyas squashDetails, exercises, cyclingDetails ni mobilityDetails.',
      'La app genera automáticamente estos detalles según el contexto del plan.',
      'Si los incluyes y son válidos, se conservarán (best-effort).',
      '',
      'warmup y cooldown son opcionales; el sistema genera protocolos base si se omiten.',
      '',
    ],
    full: [
      '',
      '═══ ESQUEMA DE SESIÓN (OBLIGATORIO SEGUIR LITERAL) ═══',
      'Campos base por sesión:',
      '  date: "YYYY-MM-DD" dentro de la semana objetivo',
      '  timeBlock: "AM" | "PM"',
      '  sessionType: "squash" | "running" | "cycling" | "strength" | "mobility" | "recovery" | "nutrition"',
      '  title: string no vacío',
      '  durationMin: número entero >= 5',
      '  objective: string corto',
      '  rpe: número 1-10 (opcional pero recomendado)',
      '',
      'Detalles obligatorios por deporte (si faltan, la sesión se descarta):',
      '',
      'Para sessionType="squash":',
      '  subtype: "training" | "match" | "competitive" | "control" | "light"',
      '  squashDetails es OBLIGATORIO con esta forma exacta:',
      '    {',
      '      "trainingFocus": "technical" | "tactical" | "physical" | "conditioned_games",',
      '      "sessionMode": "drill_session" | "practice_match" | "competition_match",',
      '      "sessionKind": "technical" | "control" | "shadows" | "match" | "mixed",',
      '      "drills": [ {"name": string, "durationMin": number, "notes"?: string}, ... ]   // al menos 1 drill, drills no puede ir vacío',
      '    }',
      '  Regla: drills[] debe tener al menos un elemento, incluso en partidos (usa un bloque descriptivo).',
      '  Para subtype="match" o "competitive" usa sessionMode="practice_match" (entrenamiento) o "competition_match" (partido real) y sessionKind="match".',
      '  Si sessionKind="mixed", añade blocks[] con { "kind": "technical"|"control"|"shadows"|"match", "drills": [...], "durationMin": number } y replica los drills también en el array plano drills[] para compatibilidad.',
      '  trainingFocus NO acepta "control" ni "shadows" (esos son sessionKind). Para sesiones de control usa trainingFocus="technical" o "tactical".',
      '',
      'Para sessionType="cycling":',
      '  cyclingDetails es OBLIGATORIO: {"sessionCategory": string, "targetStructure": string, "intensityReference"?: string, "executionNotes"?: string}',
      '  Si es intervalos o tempo, puedes añadir runningType y targetPace/targetHr para referencia.',
      '',
      'Para sessionType="running":',
      '  runningType: "z2" | "tempo" | "intervals" | "long" (recomendado)',
      '  targetPaceMin / targetPaceMax: string "m:ss" (opcional)',
      '  targetHrMin / targetHrMax: number (opcional)',
      '  Si runningType="intervals" o "tempo", añade intervalStructure:',
      '    {"blocks": [{"label": string, "durationMin"?: number, "distanceKm"?: number, "repetitions"?: number, "targetPace"?: string, "notes"?: string}, ...]}',
      '',
      'Para sessionType="strength":',
      '  exercises es OBLIGATORIO: array de {"name": string, "sets": number, "reps": number | string, "weight"?: number, "group"?: "push"|"pull"|"legs"|"core"|"olympic"|"cardio"|"mobility"|"other", "notes"?: string, "targetPercent1RM"?: number, "targetRpe"?: number, "warmupSets"?: [{"reps": number|string, "weight"?: number, "percent1RM"?: number}, ...]}',
      '  weight y targetPercent1RM van juntos cuando hay 1RM de referencia en el perfil (ej. weight=95, targetPercent1RM=75 → "95kg al 75% 1RM").',
      '  targetRpe se usa SOLO si no hay 1RM disponible para ese ejercicio (ej. targetRpe=8 → "RPE 8").',
      '  warmupSets describe series de aproximación previas al set efectivo, idealmente 2-4 series con cargas crecientes.',
      '',
      'Para sessionType="mobility":',
      '  mobilityDetails es OBLIGATORIO: {"focusAreas": string[], "context": "post_run"|"post_cycling"|"post_squash"|"post_strength"|"pre_training_activation"|"recovery"|"full_body"|"sport_specific", "targetStructure": string, "executionNotes"?: string}',
      '',
      'Para sessionType="recovery" o "nutrition": no requiere detalles extra, pero mantén title/objective claros.',
      '',
      'warmup y cooldown son opcionales; el sistema genera protocolos base si se omiten. No gastes tokens en ellos salvo que aporten.',
      '',
    ],
  },
}

function chatActionContract(
  kind: ActionKind,
  catalog: (ctx: ActionCatalogContext) => string,
): ActionContract {
  return { kind, fields: [], catalog }
}

export const ADD_SESSION_ACTION_CONTRACT: ActionContract = chatActionContract(
  'add_session',
  () => '- add_session — targetDate, timeBlock, sessionType, title, durationMin, rpe?, objective?, subtype?, reason',
)

export const UPDATE_SESSION_ACTION_CONTRACT: ActionContract = chatActionContract(
  'update_session',
  () => '- update_session — sessionId, reason, y solo los campos que cambian: newType, subtype, newTitle, newObjective, newRpe, newDurationMin, runningType, targetPaceMin, targetPaceMax, targetHrMin, targetHrMax, intervalStructure, cyclingDetails, mobilityDetails, squashDetails, exercises',
)

export const MOVE_SESSION_ACTION_CONTRACT: ActionContract = chatActionContract(
  'move_session',
  () => '- move_session — sessionId, targetDate, reason',
)

export const SKIP_SESSION_ACTION_CONTRACT: ActionContract = chatActionContract(
  'skip_session',
  () => '- skip_session — sessionId, reason',
)

export const DELETE_SESSION_ACTION_CONTRACT: ActionContract = chatActionContract(
  'delete_session',
  () => '- delete_session — sessionId, reason',
)

export const REPLACE_SESSION_TYPE_ACTION_CONTRACT: ActionContract = chatActionContract(
  'replace_session_type',
  (ctx) => ctx.allowedSessionTypes
    ? `- replace_session_type — sessionId, newType (${ctx.allowedSessionTypes}), reason`
    : '- replace_session_type — sessionId, newType, reason',
)

export const CHANGE_RPE_ACTION_CONTRACT: ActionContract = chatActionContract(
  'change_rpe',
  () => '- change_rpe — sessionId, newRpe (1-10), reason',
)

export const SHORTEN_SESSION_ACTION_CONTRACT: ActionContract = chatActionContract(
  'shorten_session',
  () => '- shorten_session — sessionId, newDurationMin, reason',
)

export const LENGTHEN_SESSION_ACTION_CONTRACT: ActionContract = chatActionContract(
  'lengthen_session',
  () => '- lengthen_session — sessionId, newDurationMin, reason',
)

export const INSERT_RECOVERY_ACTION_CONTRACT: ActionContract = chatActionContract(
  'insert_recovery',
  () => '- insert_recovery — targetDate, reason',
)

export const ACTION_CONTRACTS: Readonly<Record<ActionKind, ActionContract>> = {
  create_week: CREATE_WEEK_ACTION_CONTRACT,
  add_session: ADD_SESSION_ACTION_CONTRACT,
  update_session: UPDATE_SESSION_ACTION_CONTRACT,
  move_session: MOVE_SESSION_ACTION_CONTRACT,
  skip_session: SKIP_SESSION_ACTION_CONTRACT,
  delete_session: DELETE_SESSION_ACTION_CONTRACT,
  replace_session_type: REPLACE_SESSION_TYPE_ACTION_CONTRACT,
  change_rpe: CHANGE_RPE_ACTION_CONTRACT,
  shorten_session: SHORTEN_SESSION_ACTION_CONTRACT,
  lengthen_session: LENGTHEN_SESSION_ACTION_CONTRACT,
  insert_recovery: INSERT_RECOVERY_ACTION_CONTRACT,
}

import type { ExerciseLibraryRef } from './exerciseLibraryRef'
import type { StrengthConstraint } from './strengthSafety'

// ─── AI provider ─────────────────────────────────────────────────────────────

/** Which AI provider generated a coach response. */
export type AIProviderName = 'claude' | 'openai' | 'mock' | 'gemini'
export type AIRequestClass =
  | 'chat_general'
  | 'chat_action'
  | 'weekly_summary'
  | 'week_creator'
  | 'plan_builder_week'
  | 'plan_builder_pair'
  | 'import_extract'
  | 'coach_assistant_message'

export type CoachStage =
  | 'prompt_build'
  | 'provider_call'
  | 'normalize'
  | 'hydrate'
  | 'validate'
  | 'repair'
  | 'fallback'
  | 'apply'

export interface StageTiming {
  stage: CoachStage
  durationMs: number
  ok: boolean
  error?: string
}

export type AITechnicalSurface =
  | 'chat'
  | 'weekly_summary'
  | 'plan_builder'
  | 'import'
  | 'coach_assistant'

export type CoachPromptRequestType = 'chat_general' | 'adjust_session' | 'weekly_summary'

export interface PromptTrace {
  promptRequestType: CoachPromptRequestType
  intent?: ChatContext['intent']
  includedSports: SupportedSport[]
  includedSections: string[]
  estimatedPromptChars: number
  estimatedPromptTokens: number
  profileVariant: 'slim'
  profileSizeChars: number
  profileIncludedSports: SupportedSport[]
}

export interface AITechnicalResult {
  traceId: string
  /** Correlates all provider attempts and the local fallback for one user request. */
  generationId?: string
  /**
   * Cuenta dueña de la request. Las filas legacy sin este campo no cuentan
   * para ninguna cuota: contarlas castigaría a un usuario por consumo ajeno.
   */
  userId?: string
  /** Logical Week Creator attempt. Provider-internal retries remain server telemetry. */
  attempt?: number
  surface: AITechnicalSurface
  requestClass: AIRequestClass
  promptTrace?: PromptTrace
  provider?: AIProviderName
  model?: string
  /** Effective terminal transport used by the proxy response. */
  streamed?: boolean
  systemPromptCharCount?: number
  userPromptCharCount?: number
  responseSchemaCharCount?: number
  inputCharCount?: number
  maxTokens?: number
  promptTokens?: number
  completionTokens?: number
  reasoningTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  /** Provider tier reported by the API; used to attribute Phase 4 canaries. */
  serviceTier?: string
  /** Effective reasoning effort sent for this request, when applicable. */
  reasoningEffort?: string
  durationMs?: number
  authDurationMs?: number
  serverDurationMs?: number
  endToEndDurationMs?: number
  proposalReadyAt?: number
  /** Terminal result for the complete logical generation, not an individual provider attempt. */
  generationOutcome?: 'model_success' | 'local_fallback' | 'safe_decline' | 'failed'
  generationCompletedAt?: number
  status: 'started' | 'streaming' | 'completed' | 'failed'
  outcome?: 'ok' | 'truncated_mid' | 'truncated_early' | 'parse_invalid' | 'schema_invalid' | 'quality_rejected' | 'safety_blocked'
  errorCode?: string
  retryUsed?: boolean
  fallbackUsed?: boolean
  proposalCreated?: boolean
  responseCharCount?: number
  responsePreview?: string
  finishReason?: string
  actionCount?: number
  warnings?: string[]
  stageTimings?: StageTiming[]
  repairStats?: {
    repairedSessionCount: number
    movedSessionCount: number
    addedFallbackCount: number
    droppedSessionCount: number
    filteredSportCount: number
    repairTaxonomyVersion?: 2
    hydrationActionCount?: number
    correctiveActionCount?: number
    structuralActionCount?: number
    hydratedSessionsAffected?: number
    correctedSessionsAffected?: number
    structurallyRepairedSessionsAffected?: number
    codes: string[]
    /**
     * Week Creator skeleton contract only: the local hydration pass, kept apart
     * from the final repair so the two passes over the same sessions are not
     * summed into a double-counted total.
     */
    hydration?: {
      repairedSessionCount: number
      movedSessionCount: number
      addedFallbackCount: number
      droppedSessionCount: number
      filteredSportCount: number
      repairTaxonomyVersion?: 2
      hydrationActionCount?: number
      correctiveActionCount?: number
      structuralActionCount?: number
      hydratedSessionsAffected?: number
      correctedSessionsAffected?: number
      structurallyRepairedSessionsAffected?: number
    }
  }
  expectedSessionCount?: number
  trainingDayCount?: number
  allowedSportCount?: number
  doubleSessionAllowed?: boolean
  partialWeek?: boolean
  activeRestrictionsPresent?: boolean
  /** Versioned provider boundary used by Week Creator. */
  weekCreatorContract?: 'skeleton_v2' | 'detailed'
  firstChunkAt?: number
  startedAt: number
  completedAt?: number
}

export interface CoachFeedback {
  id: string
  targetType: 'coach_message' | 'coach_proposal'
  targetId: string
  rating: -1 | 1
  comment?: string
  traceId?: string
  chatMessageId?: string
  proposalId?: string
  requestClass?: AIRequestClass
  createdAt: number
  updatedAt: number
}

// ─── Session types ────────────────────────────────────────────────────────────

export type SessionType =
  | 'squash'
  | 'running'
  | 'cycling'
  | 'strength'
  | 'mobility'
  | 'recovery'
  | 'nutrition'

export type SquashSubtype = 'control' | 'training' | 'match' | 'competitive' | 'light'
export type MatchResult = 'win' | 'loss'
export type RunningType = 'z2' | 'tempo' | 'intervals' | 'long'
export type TimeBlock = 'AM' | 'PM'
export type MessageRole = 'user' | 'coach'
export type SessionSource = 'manual' | 'coach'

/** Lifecycle state of a session */
export type SessionStatus = 'planned' | 'completed' | 'adjusted' | 'skipped'

// ─── Core entities ────────────────────────────────────────────────────────────

export type ExerciseGroup =
  | 'push' | 'pull' | 'legs' | 'core' | 'olympic' | 'cardio' | 'mobility' | 'other'

export type MobilityFocus =
  | 'hip' | 'ankle' | 'shoulder' | 'spine' | 'knee' | 'full_body' | 'other'

export interface Exercise {
  id: string
  name: string
  sets: number
  reps: number | string
  weight?: number
  completed: boolean
  notes?: string
  group?: ExerciseGroup        // strength sessions
  mobilityFocus?: MobilityFocus // mobility sessions
  durationSec?: number         // for timed exercises (e.g. 30s holds)
  targetPercent1RM?: number    // strength: target intensity as % of reference 1RM
  targetRpe?: number           // strength: fallback target effort when no 1RM available (1-10)
  warmupSets?: WarmupSet[]     // strength: approach sets before the working set
  libraryRef?: ExerciseLibraryRef // optional origin in the curated exercise libraries
  supersetGroup?: string   // id opaco y estable de superserie; la etiqueta visible se deriva
}

export interface WarmupSet {
  reps: number | string
  weight?: number
  percent1RM?: number
}

export interface RunningDetails {
  runningType: RunningType
  targetPaceMin?: string   // e.g. "5:00"
  targetPaceMax?: string   // e.g. "5:30"
  targetHrMin?: number
  targetHrMax?: number
  intervalStructure?: RunningIntervalStructure
}

export interface CyclingDetails {
  sessionCategory: string
  sessionFamily?: string
  targetStructure: string
  intensityReference?: string
  executionNotes?: string
}

export type MobilitySessionContext =
  | 'post_run'
  | 'post_cycling'
  | 'post_squash'
  | 'post_strength'
  | 'pre_training_activation'
  | 'recovery'
  | 'full_body'
  | 'sport_specific'

export interface MobilityDetails {
  focusAreas: string[]
  context: MobilitySessionContext
  targetStructure: string
  executionNotes?: string
}

export interface RunningIntervalBlock {
  label: string
  repetitions?: number
  durationMin?: number
  distanceKm?: number
  targetPace?: string
  targetHrMax?: number
  notes?: string
}

export interface RunningIntervalStructure {
  blocks: RunningIntervalBlock[]
}

export type SquashTrainingFocus = 'technical' | 'tactical' | 'physical' | 'conditioned_games'
export type SquashSessionMode = 'drill_session' | 'practice_match' | 'competition_match'
export type SquashSessionKind = 'technical' | 'control' | 'shadows' | 'match' | 'mixed'
export type SquashSessionBlockKind = Exclude<SquashSessionKind, 'mixed'>
/**
 * Modalidad de ejecución de una definición del catálogo.
 *
 * `either` NO está: era la puerta por la que volvía la ambigüedad que separa
 * control (solitario) de técnico (con partner). Una definición siempre declara
 * qué necesita. La disponibilidad del atleta —que sí admite "indistinto"— es
 * `SquashPartnerAvailability`, un tipo distinto.
 */
export type SquashDrillExecutionMode = 'solo' | 'partner' | 'match'

/**
 * Superset tolerante para deserializar contenido anterior a la separación de
 * modalidad. Sesiones, backups y plantillas persistidas pueden traer `either`;
 * se acepta en lectura y se normaliza contra el catálogo. Nunca se escribe.
 */
export type SquashDrillExecutionModeLegacy = SquashDrillExecutionMode | 'either'

export interface SquashDrill {
  name: string
  durationMin?: number
  notes?: string
  /**
   * Tolera `either` porque hay sesiones persistidas que lo traen. La autoridad
   * de modalidad es el catálogo, no esta copia: ver `resolveDrillExecutionMode`.
   */
  executionMode?: SquashDrillExecutionModeLegacy
}

export interface SquashSessionBlock {
  kind: SquashSessionBlockKind
  drills: SquashDrill[]
  durationMin?: number
}

export interface SquashDetails {
  trainingFocus: SquashTrainingFocus
  drills: SquashDrill[]
  sessionMode?: SquashSessionMode
  sessionKind?: SquashSessionKind
  blocks?: SquashSessionBlock[]
}

export type ProtocolKind = 'warmup' | 'cooldown'
export type ProtocolTone = 'general' | 'protective' | 'competitive' | 'recovery'

export interface ProtocolStep {
  label: string
  detail?: string
}

export interface GeneratedProtocol {
  title: string
  durationMin: number
  note: string
  tone: ProtocolTone
  steps: ProtocolStep[]
  source: 'base' | 'adapted'
}

export interface SessionStarLiftMetadata {
  name: string
  targetPercent1RM?: number
  targetRpe?: number
  weekProgression: number
}

/**
 * Local change detector for a strength session that passed the safety
 * finalizer. It is deliberately not an authorization credential.
 */
export interface StrengthSafetyFinalizationSeal {
  policyVersion: number
  exerciseFingerprint: string
  constraintFingerprint: string
  /** Structured constraints derived from the user message, never source text. */
  userMessageConstraints: readonly StrengthConstraint[]
}

export interface SessionMetadata {
  starLift?: SessionStarLiftMetadata
  /** Proyección de fuerza ya resuelta: evita que un segundo repair recicle slots equivalentes. */
  planBuilderStrengthRotation?: {
    blockId: string
    signature: string
    /** Firma del template antes de proyectar core, allocator y densidad. */
    templateSignature?: string
    /** Origen del template: el selector local hidrata los esqueletos productivos. */
    templateSource?: 'selector' | 'provided'
  }
  /** Proyección de squash ya resuelta: evita volver a permutar slots equivalentes. */
  planBuilderSquashRotation?: {
    blockId: string
    signature: string
  }
  /** Only local finalization may emit this seal. */
  strengthSafetyFinalization?: StrengthSafetyFinalizationSeal
}

export interface ProtocolContext {
  kind: ProtocolKind
  sport?: SupportedSport
  sessionType?: SessionType
  sessionSubtype?: SquashSubtype
  runningType?: RunningType
  plannedRpe?: number
  energyLevel?: number
  painLevel?: number
  painNotes?: string
  sleepHours?: number
  sleepQuality?: number
  consecutiveTrainingDays: number
  hasCompetitionSoon: boolean
  daysToCompetition?: number
}

/** Common fields shared by all session types. */
export interface SessionBase {
  id: string
  athleteId?: string       // scope key (text); maps to Supabase athlete_id. Legacy rows: undefined.
  authoredByRole?: MembershipRole
  date: string             // ISO "YYYY-MM-DD"
  weekStartDate?: string   // ISO "YYYY-MM-DD", Monday — indexed in Dexie for efficient week queries
  timeBlock: TimeBlock
  source?: SessionSource
  /** Plan Builder provenance. Persisted in the session JSON payload (no DB index required). */
  planId?: string
  planWeekId?: string
  status: SessionStatus
  title: string
  objective?: string
  durationMin: number
  actualDurationMin?: number
  location?: string
  rpe?: number             // 1-10 planned RPE
  actualRpe?: number       // 1-10 RPE real
  notes?: string
  completionNotes?: string
  warmup?: GeneratedProtocol
  cooldown?: GeneratedProtocol
  metadata?: SessionMetadata
  sessionFeedback?: SessionFeedback
  autoCompletion?: SessionAutoCompletion
  completedAt?: number
  createdAt: number
  updatedAt: number
}

/** Sport-specific optional fields — present on all sessions for backwards compat. */
export interface SessionSportFields {
  subtype?: SquashSubtype
  opponent?: string
  matchResult?: MatchResult
  gamesWon?: number
  gamesLost?: number
  exercises?: Exercise[]
  runningDetails?: RunningDetails
  cyclingDetails?: CyclingDetails
  mobilityDetails?: MobilityDetails
  squashDetails?: SquashDetails
}

/**
 * Discriminated session types — narrow via session.type.
 * Sport-specific fields are optional on each variant for backwards compatibility
 * with existing data and code, but type guards let new code narrow safely.
 */
export interface SquashSession extends SessionBase, SessionSportFields {
  type: 'squash'
}

export interface RunningSession extends SessionBase, SessionSportFields {
  type: 'running'
}

export interface CyclingSession extends SessionBase, SessionSportFields {
  type: 'cycling'
}

export interface StrengthSession extends SessionBase, SessionSportFields {
  type: 'strength'
}

export interface MobilitySession extends SessionBase, SessionSportFields {
  type: 'mobility'
}

export interface RecoverySession extends SessionBase, SessionSportFields {
  type: 'recovery'
}

export interface NutritionSession extends SessionBase, SessionSportFields {
  type: 'nutrition'
}

/** Discriminated union: use session.type to narrow to a specific sport type. */
export type Session =
  | SquashSession
  | RunningSession
  | CyclingSession
  | StrengthSession
  | MobilitySession
  | RecoverySession
  | NutritionSession

// ─── Type guards ─────────────────────────────────────────────────────────────

export function isSquashSession(s: Session): s is SquashSession { return s.type === 'squash' }
export function isRunningSession(s: Session): s is RunningSession { return s.type === 'running' }
export function isCyclingSession(s: Session): s is CyclingSession { return s.type === 'cycling' }
export function isStrengthSession(s: Session): s is StrengthSession { return s.type === 'strength' }
export function isMobilitySession(s: Session): s is MobilitySession { return s.type === 'mobility' }
export function isRecoverySession(s: Session): s is RecoverySession { return s.type === 'recovery' }

export interface SessionFeedback {
  rating: 1 | 2 | 3 | 4 | 5
  energyDuringSession: 1 | 2 | 3 | 4 | 5
  mainChallenge?: string
  capturedAt: number
}

/** Procedencia durable del auto-complete Whoop. Sobrevive un revert manual a
 * `planned`; el badge solo se muestra cuando la sesion esta completada. */
export interface SessionAutoCompletion {
  source: 'whoop_workout'
  workoutId: string
  completedAt: string
}

export interface DayLog {
  id: string
  athleteId?: string       // scope key (text); maps to Supabase athlete_id. Legacy rows: undefined.
  date: string             // ISO "YYYY-MM-DD"
  sleepHours?: number
  sleepQuality?: number    // 1-5
  energyLevel?: number     // 1-10
  painLevel?: number       // 0-10 (0 = sin dolor)
  painNotes?: string
  rpeActual?: number       // 1-10 esfuerzo percibido/final del día (UI: "Esfuerzo"; autollenable desde Whoop strain)
  postSessionComment?: string
  generalNotes?: string
  bodyWeight?: number
  // Which check-in fields were prefilled from Whoop (cleared when edited by hand).
  prefillSource?: Partial<Record<'sleepHours' | 'sleepQuality' | 'energyLevel' | 'rpeActual', 'whoop'>>
  updatedAt: number
}

export interface ReadinessDaily {
  id: string                // synthetic, e.g. "whoop:<athleteId>:YYYY-MM-DD"
  athleteId: string         // scope key; maps to Supabase athlete_id
  date: string              // ISO "YYYY-MM-DD"
  recoveryScore?: number    // 0-100
  hrvMs?: number
  rhrBpm?: number
  strain?: number
  sleepHours?: number
  sleepPerformance?: number // 0-100
  source: string            // "whoop"
  updatedAt: number         // epoch ms
}

export type WhoopWorkoutMatchStatus =
  | 'completed'
  | 'skipped_short'
  | 'skipped_multiple'
  | 'no_session'
  | 'unmapped_sport'

/** Estado local de matching; la fuente durable es
 * `session.autoCompletion.workoutId`. `no_session` es re-evaluable. */
export interface WhoopWorkoutAutoComplete {
  status: WhoopWorkoutMatchStatus
  sessionId?: string
  processedAt: number
}

/**
 * Milisegundos por zona de FC, tal como los publica Whoop en
 * `score.zone_durations`. Objeto opcional con seis campos REQUERIDOS: el
 * todo-o-nada deja de ser una convención que hay que recordar en cada consumidor
 * y pasa a ser una garantía del tipo. No existe forma de representar una
 * distribución parcial.
 */
export interface WhoopZoneDurations {
  z0: number
  z1: number
  z2: number
  z3: number
  z4: number
  z5: number
}

export interface WhoopWorkout {
  id: string
  workoutId: string
  athleteId: string
  date: string
  sportName: string
  startAt: string
  endAt: string
  durationMin: number
  strain?: number
  avgHr?: number
  maxHr?: number
  distanceM?: number
  scoreState: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE'
  zoneDurations?: WhoopZoneDurations
  /** `score.percent_recorded`: float 0-100. Independiente de `zoneDurations`. */
  percentRecorded?: number
  updatedAt: number
  autoComplete?: WhoopWorkoutAutoComplete
}

export interface WeekSummary {
  id: string
  athleteId?: string       // scope key (text); maps to Supabase athlete_id. Legacy rows: undefined.
  weekStartDate: string    // ISO "YYYY-MM-DD", always Monday
  updatedAt?: number
  totalSessions: number
  totalMinutes: number
  plannedSessions: number
  completedSessions: number
  plannedMinutes: number
  completedMinutes: number
  adherencePct?: number
  squashSessions: number
  runningSessions: number
  strengthSessions: number
  plannedSquashSessions?: number
  plannedRunningSessions?: number
  plannedStrengthSessions?: number
  mobilityMinutes?: number
  avgRpe?: number
  avgActualRpe?: number
  avgSleep?: number
  avgEnergy?: number
  avgBodyWeight?: number
  weightEntries?: number
  weekNotes?: string
  objectives?: string[]
  coachNote?: string
  coachNoteGeneratedAt?: number
  coachNoteSnapshot?: string
}

export type WeeklyActionKind =
  | 'plan_week'
  | 'fix_coherence'
  | 'close_checkin'
  | 'review_coach_note'
  | 'recover_adherence'
  | 'review_load_risk'

export type WeeklyActionTarget =
  | 'plan_builder'
  | 'chat_adjust_week'
  | 'today_checkin'
  | 'today_detail'
  | 'generate_coach_note'

export type WeeklyActionLaunchIntentTarget =
  | WeeklyActionTarget
  | 'open_auto_adjustment'

export interface WeeklyActionLaunchIntent {
  intent: WeeklyActionLaunchIntentTarget
  date?: string
  alertId?: string
  source?: string
  weeklyRule?: string
}

export type WeeklyActionStatus = 'pending' | 'recommended' | 'done' | 'blocked'
export type WeeklyActionAdherenceStatus = 'unknown' | 'on_track' | 'low' | 'at_risk' | 'no_plan'
export type WeeklyActionCheckInStatus = 'complete' | 'pending' | 'not_needed'
export type WeeklyActionWeekState = 'empty' | 'planned' | 'needs_attention' | 'on_track'

export interface WeeklyActionItem {
  id: string
  kind: WeeklyActionKind
  priority: number
  title: string
  body: string
  reason: string
  ctaLabel: string
  ctaTarget: WeeklyActionTarget
  status: WeeklyActionStatus
}

export interface WeeklyActionSummary {
  primaryAction: WeeklyActionItem | null
  secondaryActions: WeeklyActionItem[]
  adherenceStatus: WeeklyActionAdherenceStatus
  checkInStatus: WeeklyActionCheckInStatus
  coherenceStatus: PhaseCoherenceStatus
  weekState: WeeklyActionWeekState
}

export interface RunningProfile {
  fiveKTime?: string          // "23:30"
  tenKTime?: string           // "49:00"
  halfMarathonTime?: string   // "1:48:00"
  easyPaceMin?: string        // "5:45" /km
  easyPaceMax?: string        // "6:15" /km
  z2PaceMin?: string          // "5:30" /km
  z2PaceMax?: string          // "6:00" /km
  thresholdPace?: string      // "4:45" /km
  longRunPace?: string        // "5:50" /km
  notes?: string
}

export interface StrengthProfile {
  benchPress1RM?: number      // kg
  squat1RM?: number           // kg
  deadlift1RM?: number        // kg
  overheadPress1RM?: number   // kg
  pullUpMaxReps?: number      // reps
  notes?: string
}

export interface RecoveryProfile {
  currentInjuries?: string    // free text
  previousInjuries?: string   // free text
  restrictions?: string       // free text
}

export interface ScheduleProfile {
  availableDays?: string[]      // ['lun','mar','mié','jue','vie','sáb','dom']
  doubleSessionDays?: string[]
  sessionsPerWeek?: number      // explicit weekly target; undefined means auto
  constraints?: string          // free text
}

export interface NutritionProfile {
  fuelingGoal?: 'performance' | 'maintain' | 'mild_fat_loss'
  sweatRate?: 'low' | 'moderate' | 'high'
  goalBodyWeightKg?: number     // target weight kg
  fatMassPct?: number           // measured % fat mass
  fatMassGoalPct?: number       // target % fat mass
  muscleMassKg?: number         // measured muscle mass kg
  muscleMassGoalKg?: number     // target muscle mass kg
  proteinTargetG?: number       // daily protein target in grams
  dailyWaterLiters?: number     // baseline water target L/day (excl. training)
  notes?: string                // intolerances, preferences, free text
}

export type SupportedSport = 'squash' | 'running' | 'strength' | 'mobility' | 'cycling'
export type TrainingPriority = 'performance' | 'fitness' | 'body_composition' | 'return_to_play'

// ─── Macro planning (MVP) ─────────────────────────────────────────────────────

export type GoalEventType = 'tournament' | 'race' | 'cycling_event' | 'other'
export type GoalEventObjective = 'win' | 'perform' | 'finish' | 'personal_best'
export type GoalEventLevel = 'recreational' | 'competitive' | 'masters' | 'elite'

export interface GoalEvent {
  id: string
  title: string
  /**
   * Inicio de la ventana del evento. Se conserva el nombre por compatibilidad
   * con datos existentes; un evento sin `endDate` dura un solo día.
   *
   * No compares esta fecha por tu cuenta: `resolveGoalEventWindow` es la única
   * autoridad de ventana (`src/services/goalEventWindow.ts`).
   */
  date: string            // ISO "YYYY-MM-DD"
  /** Término inclusive. Ausente = evento de un día. */
  endDate?: string
  /** Día clave inclusive; debe caer dentro de la ventana. */
  keyDate?: string
  sport: string           // free text aligned to SupportedSport when possible
  priority: 'primary' | 'secondary'
  notes?: string
  // Wizard-enriched fields
  eventType?: GoalEventType
  objective?: GoalEventObjective
  competitiveLevel?: GoalEventLevel
}

export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
export type WizardFitnessLevel = 'fit' | 'normal' | 'returning' | 'low'
export type WizardFatigueLevel = 'fresh' | 'normal' | 'loaded' | 'overloaded'

/** Configuration captured by the competition plan wizard */
export interface PlanWizardConfig {
  goalEventId: string
  trainingDays: DayOfWeek[]
  sessionsPerWeek: number
  sessionDurationMins: number       // 30 | 45 | 60 | 90 | 120
  allowDoubleSession: boolean
  doubleSessionDays?: DayOfWeek[]
  scheduleConstraints?: string
  partnerAvailability?: 'solo' | 'partner' | 'either'
  complementarySports: SupportedSport[]
  currentFitnessLevel: WizardFitnessLevel
  currentFatigue: WizardFatigueLevel
  injuryNotes?: string
  createdAt: string
  updatedAt: string
}

/**
 * Deterministic macro phases resolved locally from distance to goal event.
 * Generic thresholds (in weeks to event):
 *   >12 → base, 8-12 → build, 4-8 → peak, 1-4 → taper, 0 → race, <0 → transition
 * Sport-specific overrides may shorten taper windows (squash uses taper only at <=1 week).
 */
export type MacroPlanPhase =
  | 'base'
  | 'build'
  | 'peak'
  | 'taper'
  | 'race'
  | 'transition'

export type MacroPlanSportRole = 'primary' | 'support'
export type MacroPlanLoadBias = 'build' | 'hold' | 'reduce' | 'minimal'
export type MacroPlanEventTiming = 'upcoming' | 'active' | 'past'

export interface MacroPlanSportDetail {
  sport: SupportedSport
  role: MacroPlanSportRole
  phaseFocus: string
  weeklyIntent: string
  volumeBias: MacroPlanLoadBias
  intensityBias: MacroPlanLoadBias
  notes: string
}

export interface MacroPlanEventMarker {
  id: string
  title: string
  /** Inicio de la ventana; se conserva el nombre por compatibilidad. */
  date: string
  /** Término inclusive. Ausente = marcador de un día. */
  endDate?: string
  /** Día competitivo clave dentro de la ventana. */
  keyDate?: string
  sport?: SupportedSport
  priority: GoalEvent['priority']
  timing: MacroPlanEventTiming
  weeksFromReference: number
}

export interface MacroPlanTimelineEntry {
  phase: MacroPlanPhase
  startWeek: number
  endWeek: number
  label: string
  focus: string
  isCurrent: boolean
  eventMarkers: MacroPlanEventMarker[]
}

export interface MacroPlan {
  goalEventId: string
  /** Inicio de la ventana. Alias compatible: los macroplanes previos sólo tienen esto. */
  goalEventDate: string   // ISO "YYYY-MM-DD" — denormalized for quick display
  /**
   * Término inclusive de la ventana. Opcional a propósito: los macroplanes ya
   * persistidos no lo traen y no hay backfill, así que su ausencia significa
   * evento de un día, igual que en `GoalEvent`.
   */
  goalEventEndDate?: string
  /** Ancla competitiva declarada, dentro de la ventana. */
  goalEventKeyDate?: string
  /**
   * Deporte del evento objetivo. Denormalizado como las fechas para que el
   * validator —que sólo recibe el plan— aplique el mismo gate que el repair.
   * Ausente en snapshots anteriores: ahí se conserva el comportamiento previo,
   * que decide sólo por el deporte principal.
   */
  goalEventSport?: SupportedSport
  currentPhase: MacroPlanPhase
  weeksRemaining: number
  blockFocus: string      // human-readable focus for the current phase
  headline: string
  timeline: MacroPlanTimelineEntry[]
  sportDetails: MacroPlanSportDetail[]
  secondaryEvents: MacroPlanEventMarker[]
  computedAt: number      // Date.now() timestamp of last computation
}

export interface Athlete {
  id: string                      // text PK, e.g. "ath_<userId>"
  ownerAccountId: string
  linkedAccountId?: string | null
  displayName?: string | null
  status: string                  // 'active' | ...
  createdAt: number
  updatedAt: number
}

export type MembershipRole = 'self' | 'coach'

export interface AthleteMembership {
  athleteId: string
  accountId: string
  role: MembershipRole
  createdAt: number
  updatedAt: number
}

export interface AthleteCoachNote {
  athleteId: string
  coachMemory?: string
  updatedByAccountId?: string
  updatedAt: number
}

export interface AthleteProfile {
  id: string
  athleteId?: string       // scope key (text); maps to Supabase athlete_id. Legacy rows: undefined.
  coachMemory?: string
  onboardingDeferredAt?: number
  updatedAt: number
  // Structured profile
  name?: string
  age?: number
  weightKg?: number
  primarySport?: string
  secondarySports?: string[]
  sportContext?: {
    enabledSports?: SupportedSport[]
    primarySport?: SupportedSport
    secondarySports?: SupportedSport[]
    trainingPriority?: TrainingPriority
  }
  mainGoal?: string
  secondaryGoal?: string
  runningProfile?: RunningProfile
  strengthProfile?: StrengthProfile
  recoveryProfile?: RecoveryProfile
  scheduleProfile?: ScheduleProfile
  nutritionProfile?: NutritionProfile
  // Macro planning (MVP — single primary event)
  goalEvents?: GoalEvent[]
  macroPlan?: MacroPlan
  // Competition plan wizard config
  planWizardConfig?: PlanWizardConfig
}

export interface ChatMessage {
  id: string
  athleteId?: string       // scope key (text); maps to Supabase athlete_id. Legacy rows: undefined.
  role: MessageRole
  content: string
  timestamp: number
  chatSessionId?: string
  /** Minimal persisted request metadata for new messages. Full context is legacy-only. */
  contextMeta?: ChatContextMetadata
  /** Legacy full context kept for backwards compatibility with older local/exported data. */
  context?: ChatContext
  /** Which AI provider generated this message (undefined for user messages) */
  provider?: AIProviderName
  /** ID of the CoachProposal created from this message's actions, if any */
  proposalId?: string
}

export interface ChatContextMetadata {
  contextVersion: 1
  intent?: ChatContext['intent']
  traceId?: string
  likelyTruncated?: boolean
  plannedSessionCount?: number
  historicalSessionCount?: number
  recentSessionCount?: number
  weekDayLogCount?: number
  hasDayLog?: boolean
  hasAthleteProfile?: boolean
  hasAthleteMemory?: boolean
}

export interface ChatContext {
  /** Legacy combined session list kept for backwards compatibility and exports */
  recentSessions: Session[]
  /** Sessions from today onward that the coach may modify via actions */
  plannedSessions?: Session[]
  /** Completed / adjusted / skipped history used for reasoning and progression */
  historicalSessions?: Session[]
  currentWeekSummary?: WeekSummary
  dayLog?: DayLog
  readiness?: ReadinessDaily
  weekDayLogs?: DayLog[]
  athleteMemory?: string
  athleteProfile?: AthleteProfile
  recentMessages?: { role: MessageRole; content: string; timestamp?: number }[]
  recentProposals?: Array<{
    id: string
    status: CoachProposal['status']
    createdAt: number
    resolvedAt?: number
    message: string
    actions: CoachAction[]
  }>
  /**
   * Bloque de carga objetiva de Whoop, ya renderizado a texto de prompt.
   *
   * Viaja como string armado y no como datos crudos a propósito: el optimizador
   * recorta sesiones para acotar tokens, así que calcularlo aguas abajo lo
   * construiría sobre la colección ya recortada.
   */
  whoopWorkoutBlock?: string
  intent?: 'general_chat' | 'plan_week' | 'adjust_session' | 'weekly_summary'
  /** Multi-week load analytics — optional, computed async before sending */
  loadAnalytics?: import('../services/loadAnalytics').LoadAnalytics
}

// ─── Nutrition ────────────────────────────────────────────────────────────────

export type NutritionFuelingGoal = 'performance' | 'maintain' | 'mild_fat_loss'
export type HydrationSweatRate = 'low' | 'moderate' | 'high'
export type NutritionDayType = 'rest' | 'light' | 'moderate' | 'high' | 'double_session' | 'competition' | 'recovery'
export type DayLoadType = NutritionDayType
export type NutritionMacroEmphasis = 'protein_forward' | 'balanced' | 'carb_support' | 'carb_priority' | 'recovery_support'

export interface NutritionHydrationGuidance {
  totalLiters: number | null
  baselineLiters: number | null
  trainingAddLiters: number
  electrolyteFocus: 'none' | 'optional' | 'recommended'
  summary: string
}

export interface NutritionMealTimingGuidance {
  label: string
  timing: 'pre' | 'post' | 'during' | 'all_day'
  window: string
  summary: string
}

export interface NutritionReasoning {
  summary: string
  factors: string[]
}

export interface NutritionDailyRecommendation {
  loadType: NutritionDayType
  dayType: NutritionDayType
  sport: SupportedSport | 'mixed' | 'none'
  sessionCount: number
  mainFocus: string
  keyAction: string
  whyItMatters: string
  macroEmphasis: NutritionMacroEmphasis
  hydrationGuidance: NutritionHydrationGuidance
  mealTiming: NutritionMealTimingGuidance[]
  preWorkoutGuidance?: NutritionMealTimingGuidance
  postWorkoutGuidance?: NutritionMealTimingGuidance
  recoveryNote?: string
  reasoning: NutritionReasoning
  dailyFocus: string
  hydration: string
  preWorkout?: string
  postWorkout?: string
  breakfast?: string
  lunch?: string
  snack?: string
  dinner?: string
  preTraining?: string
  postTraining?: string
  /** Computed protein target, e.g. "~152g" — present when athlete weight is known */
  proteinTarget?: string
  /** Free-text dietary notes/restrictions from athlete profile */
  dietaryNotes?: string
}

export type NutritionRec = NutritionDailyRecommendation

// ─── Config types ─────────────────────────────────────────────────────────────

export interface SessionTypeConfig {
  type: SessionType
  label: string
  bgClass: string
  textClass: string
  borderClass: string
  dotClass: string
  icon: string
}

export interface QuickAction {
  id: string
  label: string
  prompt: string
}

// ─── Coach actions ────────────────────────────────────────────────────────────

export type CoachActionType =
  | 'move_session'
  | 'change_rpe'
  | 'shorten_session'
  | 'lengthen_session'
  | 'insert_recovery'
  | 'skip_session'
  | 'replace_session_type'
  | 'add_session'
  | 'create_week'
  | 'delete_session'
  | 'update_session'

/** Simplified exercise for AI proposals (executor adds id + completed) */
export interface CoachExerciseProposal {
  name: string
  sets: number
  reps: number | string    // e.g. 12 or "30s"
  weight?: number          // kg
  notes?: string
  group?: ExerciseGroup
  mobilityFocus?: MobilityFocus
  targetPercent1RM?: number
  targetRpe?: number
  warmupSets?: WarmupSet[]
  libraryRef?: ExerciseLibraryRef // origen opcional en las librerías curadas
  supersetGroup?: string   // id opaco de superserie; la politica corre antes de materializar
}

/** Session proposal used inside create_week actions */
export interface CoachSessionProposal {
  date: string             // YYYY-MM-DD
  timeBlock: TimeBlock
  sessionType: SessionType
  title: string
  durationMin: number
  rpe?: number
  objective?: string
  subtype?: SquashSubtype
  /**
   * Modalidad declarada de una sesión de squash. Autoridad de la composición.
   *
   * Es intención de frontera, no una segunda fuente persistida: el materializador
   * la consume y la verdad canónica queda en `squashDetails.sessionKind`. Opcional
   * en el tipo porque el objeto también representa otros deportes y porque hay
   * respuestas antiguas sin el campo; en runtime se exige para squash y su
   * ausencia cae por la cascada heredada, nunca por el texto de la sesión.
   */
  squashKind?: SquashSessionBlockKind
  runningType?: RunningType
  targetPaceMin?: string   // e.g. "5:00" — for running
  targetPaceMax?: string   // e.g. "5:30" — for running
  targetHrMin?: number
  targetHrMax?: number
  intervalStructure?: RunningIntervalStructure
  cyclingDetails?: CyclingDetails
  exercises?: CoachExerciseProposal[]  // for strength/mobility
  mobilityDetails?: MobilityDetails
  squashDetails?: SquashDetails        // for squash training/control sessions
  warmup?: GeneratedProtocol
  cooldown?: GeneratedProtocol
  metadata?: SessionMetadata
}

export interface CoachAction {
  type: CoachActionType
  sessionId?: string
  targetDate?: string      // for move_session, add_session
  rpe?: number             // for add_session
  newRpe?: number          // for change_rpe, update_session
  newDurationMin?: number  // for shorten_session / lengthen_session / update_session
  newType?: SessionType    // for replace_session_type / update_session
  reason: string           // always required — explains why
  // Fields for add_session
  sessionType?: SessionType
  title?: string
  durationMin?: number
  timeBlock?: TimeBlock
  objective?: string
  subtype?: SquashSubtype
  /** Modalidad estructurada para add_session/update_session de squash. */
  squashKind?: SquashSessionBlockKind
  runningType?: RunningType
  targetPaceMin?: string
  targetPaceMax?: string
  targetHrMin?: number
  targetHrMax?: number
  intervalStructure?: RunningIntervalStructure
  cyclingDetails?: CyclingDetails
  // Fields for create_week
  sessions?: CoachSessionProposal[]
  weekObjectives?: string[]
  // Fields for update_session
  newTitle?: string
  newObjective?: string
  exercises?: CoachExerciseProposal[]  // replace full exercise list
  mobilityDetails?: MobilityDetails
  squashDetails?: SquashDetails        // for squash sessions in add_session / update_session
  warmup?: GeneratedProtocol
  cooldown?: GeneratedProtocol
  /** Seal for flat add/update actions; create-week sessions store it in metadata. */
  strengthSafetyFinalization?: StrengthSafetyFinalizationSeal
  /** Optimistic concurrency precondition captured when a strength patch is proposed. */
  baseUpdatedAt?: number
}

export type CoachProposalSource = 'chat' | 'dashboard_auto_adjustment' | 'weekly_action' | 'plan_builder'
export type CoachProposalSpecificity = 'detailed' | 'generic_fallback'
export type CoachProposalQuality = 'none' | 'detailed' | 'mixed' | 'generic_fallback'

export interface CoachProposalSportInsight {
  sport: 'cycling' | 'mobility' | 'nutrition'
  actionCount: number
  hasExplicitDetails: boolean
  specificity: CoachProposalSpecificity
}

export interface CoachProposalMetadata {
  source: CoachProposalSource
  sports: SupportedSport[]
  sportInsights: CoachProposalSportInsight[]
  genericFallbackSports: Array<'cycling' | 'mobility' | 'nutrition'>
  quality: CoachProposalQuality
  resolutionOutcome: 'pending' | 'accepted' | 'rejected' | 'partial'
  relatedAlertId?: string
  nutritionPrompts?: string[]
  /** Warnings generated during normalization, e.g. sessions dropped by the normalizer. */
  warnings?: string[]
}

export type PlanValidationStatus = 'ok' | 'warning'
export type WeeklyPlanIntent = 'progress' | 'hold' | 'rotate' | 'deload' | 'unknown'
export type PhaseSportTargetRole = 'primary' | 'support' | 'excluded'
/**
 * `not_applicable` es el estado sin macroplan: no hay bloque contra el cual medir
 * coherencia, así que afirmar `ok` sería falso. No es un empate ni un warning suave.
 */
export type PhaseCoherenceStatus = 'ok' | 'warning' | 'not_applicable'

export interface MacroWeekCoherenceSummary {
  currentPhase: MacroPlanPhase
  blockGoal: string
  weeklyRule: string
  targetDistributionBySport: Partial<Record<SupportedSport, PhaseSportTargetRole>>
  actualDistributionBySport: Partial<Record<SupportedSport, number>>
  expectedSessionsBySport: Partial<Record<SupportedSport, string>>
  coherenceStatus: PhaseCoherenceStatus
  coherenceIssues: string[]
}

export interface PlanGenerationSummary {
  allowedSports: SupportedSport[]
  excludedSports: SupportedSport[]
  sessionsBySport: Partial<Record<SupportedSport, number>>
  estimatedLoadBySport: Partial<Record<SupportedSport, number>>
  intentsBySport: Partial<Record<SupportedSport, WeeklyPlanIntent>>
  weeklyIntent: WeeklyPlanIntent
  weeklyGoalSummary: string
  validationStatus: PlanValidationStatus
  validationIssues: string[]
  macroWeekCoherence: MacroWeekCoherenceSummary
}

export interface CoachProposal {
  id: string
  athleteId?: string       // scope key (text); maps to Supabase athlete_id. Legacy rows: undefined.
  chatMessageId?: string   // link to the chat message that generated this
  message: string          // human-readable summary of the proposal
  actions: CoachAction[]
  planSummary?: PlanGenerationSummary
  metadata?: CoachProposalMetadata
  status: 'pending' | 'accepted' | 'rejected' | 'partial'
  createdAt: number
  resolvedAt?: number
}

// ─── PDF import ───────────────────────────────────────────────────────────────

export interface ParsedSessionDraft {
  date?: string
  timeBlock?: TimeBlock
  type?: SessionType
  title?: string
  durationMin?: number
  rpe?: number
  objective?: string
  notes?: string
  subtype?: SquashSubtype
  runningDetails?: RunningDetails
  warmup?: GeneratedProtocol
  cooldown?: GeneratedProtocol
  exercises?: Omit<Exercise, 'id' | 'completed'>[]
  confidence: 'high' | 'medium' | 'low'  // parsing confidence
  rawText?: string                         // original source text for review
}

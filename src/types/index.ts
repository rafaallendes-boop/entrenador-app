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

export type AITechnicalSurface =
  | 'chat'
  | 'weekly_summary'
  | 'plan_builder'
  | 'import'

export type CoachPromptRequestType = 'chat_general' | 'adjust_session'

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
  surface: AITechnicalSurface
  requestClass: AIRequestClass
  promptTrace?: PromptTrace
  provider?: AIProviderName
  model?: string
  durationMs?: number
  status: 'started' | 'streaming' | 'completed' | 'failed'
  outcome?: 'ok' | 'truncated_mid' | 'truncated_early' | 'parse_invalid' | 'schema_invalid'
  errorCode?: string
  retryUsed?: boolean
  fallbackUsed?: boolean
  proposalCreated?: boolean
  responseCharCount?: number
  actionCount?: number
  warnings?: string[]
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
export type SquashDrillExecutionMode = 'solo' | 'partner' | 'either' | 'match'

export interface SquashDrill {
  name: string
  durationMin?: number
  notes?: string
  executionMode?: SquashDrillExecutionMode
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
  date: string             // ISO "YYYY-MM-DD"
  weekStartDate?: string   // ISO "YYYY-MM-DD", Monday — indexed in Dexie for efficient week queries
  timeBlock: TimeBlock
  source?: SessionSource
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
  sessionFeedback?: SessionFeedback
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

export interface DayLog {
  id: string
  date: string             // ISO "YYYY-MM-DD"
  sleepHours?: number
  sleepQuality?: number    // 1-5
  energyLevel?: number     // 1-10
  painLevel?: number       // 0-10 (0 = sin dolor)
  painNotes?: string
  rpeActual?: number       // 1-10 RPE real post sesión
  postSessionComment?: string
  generalNotes?: string
  bodyWeight?: number
  updatedAt: number
}

export interface WeekSummary {
  id: string
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
  date: string            // ISO "YYYY-MM-DD"
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
  complementarySports: SupportedSport[]
  currentFitnessLevel: WizardFitnessLevel
  currentFatigue: WizardFatigueLevel
  injuryNotes?: string
  createdAt: string
  updatedAt: string
}

/**
 * Deterministic macro phases resolved locally from distance to goal event.
 * Thresholds (in weeks to event):
 *   >12 → base, 8-12 → build, 4-8 → peak, 1-4 → taper, 0 → race, <0 → transition
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
  date: string
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
  goalEventDate: string   // ISO "YYYY-MM-DD" — denormalized for quick display
  currentPhase: MacroPlanPhase
  weeksRemaining: number
  blockFocus: string      // human-readable focus for the current phase
  headline: string
  timeline: MacroPlanTimelineEntry[]
  sportDetails: MacroPlanSportDetail[]
  secondaryEvents: MacroPlanEventMarker[]
  computedAt: number      // Date.now() timestamp of last computation
}

export interface AthleteProfile {
  id: string
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
  weekDayLogs?: DayLog[]
  athleteMemory?: string
  athleteProfile?: AthleteProfile
  recentMessages?: { role: MessageRole; content: string }[]
  recentProposals?: Array<{
    id: string
    status: CoachProposal['status']
    createdAt: number
    resolvedAt?: number
    message: string
    actions: CoachAction[]
  }>
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
export type PhaseCoherenceStatus = 'ok' | 'warning'

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

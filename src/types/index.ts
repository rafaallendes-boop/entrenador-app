// ─── AI provider ─────────────────────────────────────────────────────────────

/** Which AI provider generated a coach response. */
export type AIProviderName = 'claude' | 'openai' | 'mock' | 'gemini'

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
}

export type SquashTrainingFocus = 'technical' | 'tactical' | 'physical' | 'conditioned_games'

export interface SquashDrill {
  name: string
  durationMin?: number
  notes?: string
}

export interface SquashDetails {
  trainingFocus: SquashTrainingFocus
  drills: SquashDrill[]
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

export interface Session {
  id: string
  date: string             // ISO "YYYY-MM-DD"
  timeBlock: TimeBlock
  source?: SessionSource
  type: SessionType
  subtype?: SquashSubtype  // squash only
  opponent?: string
  matchResult?: MatchResult
  gamesWon?: number
  gamesLost?: number
  status: SessionStatus    // replaces completed: boolean
  title: string
  objective?: string
  durationMin: number
  actualDurationMin?: number
  location?: string
  rpe?: number             // 1-10 planned RPE
  actualRpe?: number       // 1-10 RPE real
  notes?: string
  completionNotes?: string
  exercises?: Exercise[]   // strength + mobility
  runningDetails?: RunningDetails
  squashDetails?: SquashDetails
  warmup?: GeneratedProtocol
  cooldown?: GeneratedProtocol
  completedAt?: number
  createdAt: number
  updatedAt: number
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
  constraints?: string          // free text
}

export interface NutritionProfile {
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

export interface AthleteProfile {
  id: string
  coachMemory?: string
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
}

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  timestamp: number
  chatSessionId?: string
  context?: ChatContext
  /** Which AI provider generated this message (undefined for user messages) */
  provider?: AIProviderName
  /** ID of the CoachProposal created from this message's actions, if any */
  proposalId?: string
}

export interface ChatContext {
  recentSessions: Session[]
  currentWeekSummary?: WeekSummary
  dayLog?: DayLog
  weekDayLogs?: DayLog[]
  athleteMemory?: string
  athleteProfile?: AthleteProfile
  recentMessages?: { role: MessageRole; content: string }[]
  intent?: 'general_chat' | 'plan_week' | 'adjust_session' | 'weekly_summary'
  /** Multi-week load analytics — optional, computed async before sending */
  loadAnalytics?: import('../services/loadAnalytics').LoadAnalytics
}

// ─── Nutrition ────────────────────────────────────────────────────────────────

export type DayLoadType = 'rest' | 'light' | 'medium' | 'high' | 'double' | 'match' | 'long_run'

export interface NutritionRec {
  loadType: DayLoadType
  dailyFocus: string
  hydration: string
  preWorkout?: string
  postWorkout?: string
  breakfast: string
  lunch: string
  snack: string
  dinner: string
  preTraining?: string
  postTraining?: string
}

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
  exercises?: CoachExerciseProposal[]  // for strength/mobility
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
  // Fields for create_week
  sessions?: CoachSessionProposal[]
  weekObjectives?: string[]
  // Fields for update_session
  newTitle?: string
  newObjective?: string
  exercises?: CoachExerciseProposal[]  // replace full exercise list
  squashDetails?: SquashDetails        // for squash sessions in add_session / update_session
  warmup?: GeneratedProtocol
  cooldown?: GeneratedProtocol
}

export interface CoachProposal {
  id: string
  chatMessageId?: string   // link to the chat message that generated this
  message: string          // human-readable summary of the proposal
  actions: CoachAction[]
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

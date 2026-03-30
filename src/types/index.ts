// ─── AI provider ─────────────────────────────────────────────────────────────

/** Which AI provider generated a coach response. */
export type AIProviderName = 'claude' | 'openai' | 'mock' | 'gemini'

// ─── Session types ────────────────────────────────────────────────────────────

export type SessionType =
  | 'squash'
  | 'running'
  | 'strength'
  | 'mobility'
  | 'recovery'
  | 'nutrition'

export type SquashSubtype = 'control' | 'training' | 'match' | 'competitive' | 'light'
export type MatchResult = 'win' | 'loss'
export type RunningType = 'z2' | 'tempo' | 'intervals' | 'long'
export type TimeBlock = 'AM' | 'PM'
export type MessageRole = 'user' | 'coach'

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

export interface Session {
  id: string
  date: string             // ISO "YYYY-MM-DD"
  timeBlock: TimeBlock
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

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  timestamp: number
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
  recentMessages?: { role: MessageRole; content: string }[]
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

export interface CoachAction {
  type: CoachActionType
  sessionId?: string
  targetDate?: string      // for move_session
  newRpe?: number          // for change_rpe
  newDurationMin?: number  // for shorten_session / lengthen_session
  newType?: SessionType    // for replace_session_type
  reason: string           // always required — explains why
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
  exercises?: Omit<Exercise, 'id' | 'completed'>[]
  confidence: 'high' | 'medium' | 'low'  // parsing confidence
  rawText?: string                         // original source text for review
}

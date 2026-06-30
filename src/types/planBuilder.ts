import type { AIRequestClass } from './index'
import type {
  CoachSessionProposal,
  MacroPlan,
  MacroPlanPhase,
  PlanWizardConfig,
  SupportedSport,
} from './index'
import type { PlanQualityReview } from '../services/planBuilder/qualityReview'

export type PlanStatus = 'draft' | 'active' | 'archived' | 'superseded'

export type PlanGenerationState = 'shell' | 'generating' | 'partial' | 'failed' | 'complete' | 'cancelled'

export type PlanWeekStatus = 'pending' | 'generating' | 'draft' | 'accepted' | 'error' | 'regenerating'

export type PlanGenerationJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type PlanValidationSeverity = 'error' | 'warning' | 'info'

export interface PlanPhaseBlock {
  phase: MacroPlanPhase
  startWeekIndex: number
  endWeekIndex: number
  blockFocus: string
  intentBySport: Partial<Record<SupportedSport, string>>
}

export interface PlanWeekObjective {
  sport?: SupportedSport
  goal: string
  metric?: string
}

export interface PlanGenerationMeta {
  provider?: string
  model?: string
  requestClass?: AIRequestClass
  traceId?: string
  promptTokens?: number
  completionTokens?: number
  attempts: number
  lastError?: string
  lastAttemptAt?: number
  durationMs?: number
  chunkCount?: number
  retryUsed?: boolean
  fallbackUsed?: boolean
  strategy?: 'single' | 'pairs'
  batchId?: string
  rawSessionCount?: number
  validSessionCount?: number
  droppedSessionCount?: number
  degradedFromPairs?: boolean
  repairedSessionCount?: number
  movedSessionCount?: number
  addedFallbackCount?: number
  filteredSportCount?: number
  repairWarnings?: Array<{ code: string; message: string }>
  stageTimings?: Array<{ stage: string; durationMs: number; ok: boolean; error?: string }>
  errorClass?: string
  generationSource?: 'ai' | 'deterministic' | 'fallback'
}

export interface PlanGenerationSummary {
  startedAt: number
  jobId?: string
  completedAt?: number
  totalDurationMs?: number
  strategy: 'single' | 'pairs'
  completedWeeks: number
  failedWeeks: number[]
  totalAttempts: number
  heartbeatAt?: number
  cancelRequested?: boolean
  acceptedAt?: number
  discardedAt?: number
  qualityReview?: PlanQualityReview
}

export interface RegenerationMeta {
  attempts: number
  lastRegeneratedAt: number
  previousFallbackUsed?: boolean
}

export interface PlanValidationIssue {
  severity: PlanValidationSeverity
  code: string
  message: string
  weekIndex?: number
  sessionId?: string
}

export interface TrainingPlan {
  id: string
  athleteId: string
  goalEventId: string
  status: PlanStatus
  generationState: PlanGenerationState
  title: string
  startDate: string        // YYYY-MM-DD (fecha efectiva desde la que se puede entrenar)
  endDate: string          // YYYY-MM-DD (fecha final solicitada/evento; puede cortar la última semana)
  totalWeeks: number
  phases: PlanPhaseBlock[]
  wizardConfig: PlanWizardConfig
  macroSnapshot: MacroPlan
  createdAt: number
  updatedAt: number
  acceptedAt?: number
  notes?: string
  generationSummary?: PlanGenerationSummary
}

export interface TrainingPlanWeek {
  id: string
  athleteId?: string        // scope key (text); derived from the parent plan. Legacy rows: undefined.
  planId: string
  weekIndex: number         // 0-based
  weekStartDate: string     // YYYY-MM-DD (lunes)
  phase: MacroPlanPhase
  status: PlanWeekStatus
  sessions: CoachSessionProposal[]
  weekObjectives: PlanWeekObjective[]
  targetLoadBySport: Partial<Record<SupportedSport, number>>
  validationIssues: PlanValidationIssue[]
  generationMeta: PlanGenerationMeta
  regenerationMeta?: RegenerationMeta
  createdAt: number
  updatedAt: number
}

export interface PlanBuilderProgress {
  totalWeeks: number
  completedWeeks: number
  currentWeekIndex: number | null
  failedWeeks: number[]
}

export interface PlanGenerationJob {
  id: string
  planId: string
  athleteId: string
  status: PlanGenerationJobStatus
  strategy: 'single' | 'pairs'
  targetWeekIndexes?: number[]
  totalWeeks: number
  completedWeeks: number
  failedWeekIndexes: number[]
  currentWeekIndex: number | null
  repairInstructions?: Record<number, string>
  startedAt?: number
  completedAt?: number
  heartbeatAt?: number
  lastError?: string
  createdAt: number
  updatedAt: number
}

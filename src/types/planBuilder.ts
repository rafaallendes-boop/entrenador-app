import type {
  CoachSessionProposal,
  MacroPlan,
  MacroPlanPhase,
  PlanWizardConfig,
  SupportedSport,
} from './index'

export type PlanStatus = 'draft' | 'active' | 'archived' | 'superseded'

export type PlanWeekStatus = 'pending' | 'generating' | 'draft' | 'accepted' | 'error'

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
  promptTokens?: number
  completionTokens?: number
  attempts: number
  lastError?: string
  lastAttemptAt?: number
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
  title: string
  startDate: string        // YYYY-MM-DD (lunes)
  endDate: string          // YYYY-MM-DD (domingo del último bloque)
  totalWeeks: number
  phases: PlanPhaseBlock[]
  wizardConfig: PlanWizardConfig
  macroSnapshot: MacroPlan
  createdAt: number
  updatedAt: number
  acceptedAt?: number
  notes?: string
}

export interface TrainingPlanWeek {
  id: string
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
  createdAt: number
  updatedAt: number
}

export interface PlanBuilderProgress {
  totalWeeks: number
  completedWeeks: number
  currentWeekIndex: number | null
  failedWeeks: number[]
}

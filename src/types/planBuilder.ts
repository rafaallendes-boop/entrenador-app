import type {
  AIRequestClass,
  CoachSessionProposal,
  MacroPlan,
  MacroPlanPhase,
  PlanWizardConfig,
  StageTiming,
  SupportedSport,
  TimeBlock,
} from './index'
import type { PersistedPlanQualityReview } from '../services/planBuilder/qualityReview'
import type { BlockedReason } from '../services/training/strengthSafetyFinalizer'

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
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  finishReason?: string
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
  hydrationActionCount?: number
  correctiveActionCount?: number
  structuralActionCount?: number
  hydratedSessionsAffected?: number
  correctedSessionsAffected?: number
  structurallyRepairedSessionsAffected?: number
  /** Fuente real del contexto previo que recibió esta semana. */
  previousWeekContextSource?: 'none' | 'shell' | 'ready'
  /** Política de rotación (no entra en countRepairsV2). */
  strengthAccessoryRotationActionCount?: number
  strengthAccessoryRotationSessionsAffected?: number
  /** Diagnóstico de la columna local del allocator de fuerza. */
  strengthAllocator?: StrengthAllocatorMetrics
  squashDrillRotationActionCount?: number
  squashDrillRotationSessionsAffected?: number
  squashDrillRotationOmittedCount?: number
  /** Observacionales de rol de partido (no entran en countRepairsV2). */
  squashFinisherProposedCount?: number
  squashFinisherPreservedCount?: number
  squashStandaloneMatchCount?: number
  repairTaxonomyVersion?: 2
  qualityVersion?: 1 | 2
  repairWarnings?: Array<{ code: string; message: string }>
  stageTimings?: StageTiming[]
  errorClass?: string
  generationSource?: 'ai' | 'deterministic' | 'fallback'
  /** A final safety pass removed one or more impossible strength slots. */
  safetyDegraded?: boolean
  strengthSafetyBlocked?: StrengthSafetyBlockedSlot[]
}

export interface StrengthSafetyBlockedSlot {
  date: string
  timeBlock: TimeBlock
  reason: BlockedReason
}

/**
 * Métricas de la columna materializada por un worker. La matriz se calcula
 * completa en cada worker, por lo que estos valores no suman semanas virtuales.
 */
export interface StrengthAllocatorMetrics {
  slotCount: number
  assignedCount: number
  infeasibleIntraWeekCount: number
  insufficientPoolCount: number
  unresolvedIdentityCount: number
  searchExhaustedCount: number
  /** La matriz asignó la celda, pero el repair ya no encontró su sesión viva. */
  unmaterializedCount: number
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
  qualityReview?: PersistedPlanQualityReview
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
  /**
   * Marcador durable de que una recalibración (`recalibrateRemainingWeeks`)
   * disparó generación para estas semanas y todavía no reconcilió el
   * calendario real. Es la red de seguridad para cuando la pestaña que
   * disparó la recalibración se cierra antes de que el polling termine.
   *
   * Es local: `planRows.ts` no lo serializa. Polling y sync lo preservan al
   * importar checkpoints remotos hasta que el calendario se reconcilia.
   * Permite recuperar una recarga en el mismo navegador; no es una cola
   * de reconciliación entre dispositivos.
   */
  pendingRecalibration?: {
    weekIndexes: number[]
    requestedAt: number
  }
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

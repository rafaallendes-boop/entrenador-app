import type { AthleteProfile } from '../../types'
import type { TrainingPlan } from '../../types/planBuilder'
import { buildExecutionSignals } from '../training/executionSignals'
import type { ExecutionSignals } from '../training/loadDirectivePolicy'
import { captureSources, deriveSlotContext, shiftIsoDate, type SourceCapture } from '../training/slotContext'
import type { PlanBuilderRecentContext } from './recentContextRender'
import { executionSignalsFromLivedWeeks } from './recentContextRender'
import type { RepairContext } from './repairWeek'

/**
 * Fuentes B2/B3 de un job del Plan Builder: una captura por job, derivada del
 * payload del contexto reciente. Todas las semanas del job comparten el mismo
 * corte de conocimiento.
 */
export function buildPlanBuilderRepairSources(
  plan: TrainingPlan,
  profile: AthleteProfile,
  recentContext: PlanBuilderRecentContext | undefined,
): Pick<RepairContext, 'executionSignals' | 'historicalSessions' | 'sourceCapture'> {
  const historicalSessions = recentContext?.executedSessions
  if (!recentContext) return { executionSignals: undefined, historicalSessions }
  const rows = recentContext.signalRows
  const sourceCapture = captureSources({
    scope: { athleteId: plan.athleteId ?? null, epoch: 0, requestId: plan.id },
    now: recentContext.capturedAt ?? Date.parse(`${recentContext.referenceDate}T12:00:00.000Z`),
    profile,
    sessions: [
      ...(recentContext.executedSessions ?? []),
      ...(recentContext.executedStrengthSessions ?? []),
      ...(rows?.sessions ?? []),
    ],
    dayLogs: rows?.dayLogs ?? [],
  })
  return {
    historicalSessions,
    sourceCapture,
    executionSignals: resolvePlanBuilderExecutionSignals(recentContext, sourceCapture),
  }
}

/** I8: última semana vivida; payload anterior a la Fase B → ruta agregada legacy. */
export function resolvePlanBuilderExecutionSignals(
  recentContext: PlanBuilderRecentContext,
  capture: SourceCapture,
): ExecutionSignals | undefined {
  const rows = recentContext.signalRows
  if (!rows) return executionSignalsFromLivedWeeks(recentContext)
  const slotContext = deriveSlotContext(capture, { date: shiftIsoDate(rows.weekStartDate, 7), timeBlock: 'AM' })
  const { signals } = buildExecutionSignals(slotContext, { windowStart: rows.weekStartDate })
  return rows.adherencePct != null ? { ...signals, adherencePct: rows.adherencePct } : signals
}

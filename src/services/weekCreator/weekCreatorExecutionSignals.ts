import type { ChatContext } from '../../types'
import { captureFromChatContext } from '../ai/chatSourceCapture'
import { buildExecutionSignals, previousWeekWindowStart } from '../training/executionSignals'
import { decideLoadDirective, type ExecutionSignals, type LoadDirectiveDecision } from '../training/loadDirectivePolicy'
import { deriveSlotContext, type SourceCapture } from '../training/slotContext'
import { resolveDeclaredAthleteState } from '../training/strengthAthleteContext'

/**
 * Única construcción de las fuentes de fuerza del Week Creator por operación.
 * La consumen el prompt (directiva), el hidratador (RepairContext) y el
 * finalizador de fuerza. El prompt usa una directiva semanal; la composición
 * resuelve la fuerza por slot con la captura compartida. Reemplaza
 * `buildWeekCreatorExecutionSignals` (A1).
 *
 * `executionSignals` conserva la fatiga declarada VIGENTE en el ancla: el
 * veredicto de ejecución de `repairWeek` (A1, F02) la sigue necesitando. El
 * resolver de fuerza extrae señales y evalúa vigencia por sesión (I9),
 * usando la caché compartida de T7; no reutiliza el agregado semanal.
 */
export interface WeekCreatorStrengthSources {
  capture: SourceCapture
  executionSignals: ExecutionSignals
  loadDecision: LoadDirectiveDecision
}

export function resolveWeekCreatorStrengthSources(
  context: ChatContext,
  planningStartDate: string,
  now: number,
): WeekCreatorStrengthSources {
  const capture = captureFromChatContext(context, now)
  const slotContext = deriveSlotContext(capture, { date: planningStartDate, timeBlock: 'AM' })
  const { signals } = buildExecutionSignals(slotContext, { windowStart: previousWeekWindowStart(planningStartDate) })
  const declared = resolveDeclaredAthleteState(capture.profile?.planWizardConfig, planningStartDate)
  const executionSignals: ExecutionSignals = { ...signals, declaredFatigue: declared.declaredFatigue }
  return { capture, executionSignals, loadDecision: decideLoadDirective(executionSignals) }
}

export function computeRecentRpeStats(
  sessions: ChatContext['historicalSessions'],
): { average: number; count: number } {
  const values = (sessions ?? [])
    .filter((session) => session.status === 'completed' || session.status === 'adjusted')
    .map((session) => session.actualRpe)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (values.length === 0) return { average: 0, count: 0 }
  return {
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    count: values.length,
  }
}

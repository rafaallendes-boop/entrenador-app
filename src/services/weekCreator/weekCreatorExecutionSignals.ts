import type { ChatContext, DayLog } from '../../types'
import { isWhoopPrefilled } from '../readiness/dayLogPrefillSave'
import type { ExecutionSignals } from '../training/loadDirectivePolicy'
import type { WeekCreatorEffectiveConfig } from './WeekCreatorConfig'

/**
 * Única construcción de `ExecutionSignals` del Week Creator. La consumen el
 * prompt (`buildLoadDirective`) y el contexto de reparación del hidratador,
 * para que la señal que ve el modelo sea la misma que ve la composición local.
 *
 * `logs` NO tiene un orden garantizado: el hidratador pasa
 * `weekDayLogs` tal cual llega (ascendente por fecha), pero
 * `WeekCreatorPromptBuilder` pasa una copia pre-ordenada DESCENDENTE
 * (`recentLogs`, más reciente primero). Por eso el registro más reciente se
 * busca por fecha máxima, nunca por posición — un índice fijo (`[0]` o
 * `at(-1)`) acierta con un solo llamador y falla silenciosamente con el otro.
 */
export function buildWeekCreatorExecutionSignals(
  config: Pick<WeekCreatorEffectiveConfig, 'currentFatigue'>,
  sessions: ChatContext['historicalSessions'],
  logs: ChatContext['weekDayLogs'],
): ExecutionSignals {
  const rpeStats = computeRecentRpeStats(sessions)
  const latestLog = pickMostRecentLog(logs)
  return {
    declaredFatigue: config.currentFatigue,
    latestEnergyLevel: latestLog && !isWhoopPrefilled(latestLog, 'energyLevel')
      ? latestLog.energyLevel ?? undefined
      : undefined,
    latestPainLevel: latestLog?.painLevel ?? undefined,
    avgActualRpe: rpeStats.count > 0 ? rpeStats.average : undefined,
    rpeSampleCount: rpeStats.count,
  }
}

function pickMostRecentLog(logs: DayLog[] | undefined): DayLog | undefined {
  return (logs ?? []).reduce<DayLog | undefined>(
    (best, log) => (!best || log.date > best.date ? log : best),
    undefined,
  )
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

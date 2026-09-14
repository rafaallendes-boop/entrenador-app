import type { DayLog, WizardFatigueLevel } from '../../types'
import { isWhoopPrefilled } from '../readiness/dayLogPrefillSave'
import { isExecutedStatus } from './executedSessions'
import type { ExecutionSignals } from './loadDirectivePolicy'
import { fromISO, getWeekStart, toISO } from '../../utils/date'
import { shiftIsoDate, type SlotContext } from './slotContext'

/** I9: ventana compartida por chat y Week Creator para el mismo ancla. */
export function previousWeekWindowStart(anchorDate: string): string {
  return shiftIsoDate(toISO(getWeekStart(fromISO(anchorDate))), -7)
}

/**
 * B3: única construcción de `ExecutionSignals` desde datos capturados.
 * Generaliza la extracción de A1 (Week Creator) y la del contexto reciente del
 * Plan Builder. La exclusión del prefill Whoop es responsabilidad de ESTE
 * módulo: ningún llamador filtra por su cuenta.
 */

export interface SignalProvenance {
  source: 'day_log' | 'session' | 'day_log+session'
  /** Fecha del dato más reciente que respalda la señal. */
  date: string
  sampleSize: number
}

export type ProvenancedSignal = 'avgActualRpe' | 'latestEnergyLevel' | 'latestPainLevel' | 'avgSleepHours' | 'adherencePct'

export interface ExecutionSignalsResult {
  signals: ExecutionSignals
  provenance: Partial<Record<ProvenancedSignal, SignalProvenance>>
}

export interface ExecutionSignalOptions {
  declaredFatigue?: WizardFatigueLevel
  /** Primer día (inclusive) que cuenta. Ausente: todo lo anterior al slot. */
  windowStart?: string
}

export function buildExecutionSignals(
  slotContext: SlotContext,
  options: ExecutionSignalOptions = {},
): ExecutionSignalsResult {
  const inWindow = (date: string) => options.windowStart == null || date >= options.windowStart
  const sessions = slotContext.signalHistory.filter((session) => inWindow(session.date))
  const logs = slotContext.dayLogs.filter((log) => inWindow(log.date))
  const executed = sessions.filter((session) => isExecutedStatus(session.status))
  const signals: ExecutionSignals = {}
  const provenance: ExecutionSignalsResult['provenance'] = {}
  if (options.declaredFatigue) signals.declaredFatigue = options.declaredFatigue

  const rpeSamples = [
    ...executed
      .filter((session) => isFiniteNumber(session.actualRpe))
      .map((session) => ({ value: session.actualRpe as number, date: session.date, source: 'session' as const })),
    ...logs
      .filter((log) => !isWhoopPrefilled(log, 'rpeActual') && isFiniteNumber(log.rpeActual))
      .map((log) => ({ value: log.rpeActual as number, date: log.date, source: 'day_log' as const })),
  ]
  signals.rpeSampleCount = rpeSamples.length
  if (rpeSamples.length > 0) {
    signals.avgActualRpe = roundOneDecimal(mean(rpeSamples.map((sample) => sample.value)))
    const sources = new Set(rpeSamples.map((sample) => sample.source))
    provenance.avgActualRpe = {
      source: sources.size > 1 ? 'day_log+session' : [...sources][0],
      date: rpeSamples.map((sample) => sample.date).sort().at(-1) as string,
      sampleSize: rpeSamples.length,
    }
  }

  const energyLog = logs.find((log) => !isWhoopPrefilled(log, 'energyLevel') && isFiniteNumber(log.energyLevel))
  if (energyLog) {
    signals.latestEnergyLevel = energyLog.energyLevel
    provenance.latestEnergyLevel = latestLogProvenance(energyLog)
  }

  // Whoop nunca prellena el dolor: siempre es del atleta.
  const painLog = logs.find((log) => isFiniteNumber(log.painLevel))
  if (painLog) {
    signals.latestPainLevel = painLog.painLevel
    provenance.latestPainLevel = latestLogProvenance(painLog)
  }

  const sleepLogs = logs.filter((log) => !isWhoopPrefilled(log, 'sleepHours') && isFiniteNumber(log.sleepHours))
  if (sleepLogs.length > 0) {
    signals.avgSleepHours = roundOneDecimal(mean(sleepLogs.map((log) => log.sleepHours as number)))
    provenance.avgSleepHours = { source: 'day_log', date: sleepLogs[0].date, sampleSize: sleepLogs.length }
  }

  // Una planificada que todavía no vence no es una sesión perdida.
  const due = sessions.filter((session) => isExecutedStatus(session.status) || session.date < slotContext.knowledgeDate)
  if (due.length > 0) {
    signals.adherencePct = Math.round((executed.length / due.length) * 100)
    provenance.adherencePct = { source: 'session', date: due[0].date, sampleSize: due.length }
  }

  return { signals, provenance }
}

function latestLogProvenance(log: DayLog): SignalProvenance {
  return { source: 'day_log', date: log.date, sampleSize: 1 }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}

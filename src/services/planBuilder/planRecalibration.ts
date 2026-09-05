import { getWeekStart, fromISO, toISO } from '../../utils/date'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'

export interface RecalibrationTarget {
  /** Semanas a regenerar. Siempre estrictamente futuras. */
  weekIndexes: number[]
  /** Fecha de corte para leer historial real. */
  asOfDate: string
  /**
   * Semanas COMPLETAS ya vividas a `asOfDate`: `weekStartDate <
   * currentWeekStart`. La semana en curso NO cuenta.
   *
   * Esto tiene que coincidir con lo que el motor realmente lee: con
   * `asOfDate`, `buildPlanBuilderRecentContext` puebla `livedPlanWeeks`
   * recorriendo `while (cursor < referenceWeekStart)` — la semana en curso
   * queda fuera de esa ventana porque todavía no terminó. Contarla acá haría
   * que el copy de la UI prometiera datos de una semana que el prompt nunca
   * ve. Coincide además con el umbral de elegibilidad de abajo
   * (`hasCompleteLivedWeek`).
   */
  livedWeekCount: number
}

/**
 * Qué semanas de un plan EN CURSO pueden regenerarse con datos reales.
 *
 * Reglas duras:
 * - Sólo planes `active`. Un borrador ya tiene sus propias rutas de
 *   regeneración y no tiene nada vivido que leer.
 * - Sólo semanas **estrictamente futuras**. La semana en curso queda fuera a
 *   propósito: el atleta puede haberla empezado, y regenerarla borraría
 *   sesiones que no pidió borrar.
 * - Hace falta al menos UNA semana completa vivida (`weekStartDate` anterior
 *   a la semana en curso), o la recalibración no tendría más datos que la
 *   generación original.
 */
export function selectRecalibrationTargets(input: {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
  todayISO: string
}): RecalibrationTarget | null {
  const { plan, weeks, todayISO } = input
  if (plan.status !== 'active') return null

  const currentWeekStart = toISO(getWeekStart(fromISO(todayISO)))

  const hasCompleteLivedWeek = weeks.some((week) => week.weekStartDate < currentWeekStart)
  if (!hasCompleteLivedWeek) return null

  const futureWeeks = weeks
    .filter((week) => week.weekStartDate > currentWeekStart)
    .sort((a, b) => a.weekIndex - b.weekIndex)
  if (futureWeeks.length === 0) return null

  const livedWeekCount = weeks.filter((week) => week.weekStartDate < currentWeekStart).length

  return {
    weekIndexes: futureWeeks.map((week) => week.weekIndex),
    asOfDate: todayISO,
    livedWeekCount,
  }
}

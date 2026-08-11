import { format } from 'date-fns'
import { es } from 'date-fns/locale'

import type { GoalEvent, MacroPlan } from '../types'
import { fromISO, isStrictISODate } from '../utils/date'

/**
 * Autoridad única de la ventana de un evento objetivo.
 *
 * Existe porque `GoalEvent.date` significaba a la vez "el evento" y "el día del
 * evento": con campeonatos multijornada esas dos cosas dejan de coincidir. Todo
 * consumidor de calendario (macro, shell, repair, validator, prompt, UI) resuelve
 * la ventana acá en vez de leer `.date` directamente.
 */
export interface GoalEventWindow {
  /** Inicio inclusive. */
  startDate: string
  /** Término inclusive. Igual a `startDate` en un evento de un día. */
  endDate: string
  /** Ancla competitiva declarada, sólo si cae dentro de la ventana. */
  keyDate?: string
}

export interface GoalEventWindowIssue {
  field: 'date' | 'endDate' | 'keyDate'
  message: string
}

/** Entrada mínima: acepta un `GoalEvent` completo o sólo sus tres fechas. */
export type GoalEventWindowInput = Pick<GoalEvent, 'date'> & Partial<Pick<GoalEvent, 'endDate' | 'keyDate'>>

/**
 * Camino de **lectura**: total y tolerante, nunca lanza.
 *
 * Un backup manipulado, un import antiguo o una fila corrupta no pueden romper
 * la vista de la semana, así que un término inválido degrada a evento de un día
 * y un día clave fuera de rango se descarta sin perder el rango. Para impedir
 * que ese dato entre, usar `validateGoalEventWindow` en el borde de escritura.
 */
export function resolveGoalEventWindow(event: GoalEventWindowInput): GoalEventWindow {
  const startDate = event.date
  const endDate = isUsableEnd(startDate, event.endDate) ? event.endDate! : startDate
  const keyDate = isWithinRange(startDate, endDate, event.keyDate) ? event.keyDate : undefined
  return { startDate, endDate, keyDate }
}

/** `true` si la fecha ISO cae dentro de la ventana, extremos incluidos. */
export function isWithinGoalEventWindow(event: GoalEventWindowInput, isoDate: string): boolean {
  const { startDate, endDate } = resolveGoalEventWindow(event)
  return isWithinRange(startDate, endDate, isoDate)
}

/**
 * Camino de **escritura**: estricto. Devuelve la lista de problemas para que la
 * UI y el importador rechacen una ventana inválida en vez de persistirla.
 */
export function validateGoalEventWindow(event: GoalEventWindowInput): GoalEventWindowIssue[] {
  const issues: GoalEventWindowIssue[] = []

  if (!isStrictISODate(event.date)) {
    issues.push({ field: 'date', message: 'La fecha de inicio debe ser una fecha válida.' })
  }

  if (event.endDate != null) {
    if (!isStrictISODate(event.endDate)) {
      issues.push({ field: 'endDate', message: 'La fecha de término debe ser una fecha válida.' })
    } else if (isStrictISODate(event.date) && event.endDate < event.date) {
      issues.push({ field: 'endDate', message: 'El término no puede ser anterior al inicio.' })
    }
  }

  if (event.keyDate != null) {
    if (!isStrictISODate(event.keyDate)) {
      issues.push({ field: 'keyDate', message: 'El día clave debe ser una fecha válida.' })
    } else if (issues.length === 0) {
      // Sólo tiene sentido comparar contra una ventana que ya es coherente.
      const endDate = event.endDate ?? event.date
      if (!isWithinRange(event.date, endDate, event.keyDate)) {
        issues.push({ field: 'keyDate', message: 'El día clave debe caer entre el inicio y el término.' })
      }
    }
  }

  return issues
}

/**
 * Adapta el snapshot denormalizado del macroplan a la entrada del resolver.
 *
 * Existe para que las superficies que sólo tienen el plan —historial, dashboard—
 * no reimplementen el mapeo de nombres ni vuelvan a leer `goalEventDate` como si
 * fuera la ventana entera.
 */
export function goalEventWindowFromMacroPlan(
  macroPlan: Pick<MacroPlan, 'goalEventDate' | 'goalEventEndDate' | 'goalEventKeyDate'>,
): GoalEventWindowInput {
  return {
    date: macroPlan.goalEventDate,
    endDate: macroPlan.goalEventEndDate,
    keyDate: macroPlan.goalEventKeyDate,
  }
}

/**
 * Etiqueta de la ventana. Única implementación para resumen, builder, dashboard
 * e historial, para que las cuatro superficies no diverjan en el formato.
 *
 * Muestra sólo lo que cambia entre los dos extremos: un rango dentro del mismo
 * mes no repite mes ni año.
 */
export function formatGoalEventWindow(event: GoalEventWindowInput): string {
  const { startDate, endDate } = resolveGoalEventWindow(event)
  const start = fromISO(startDate)
  const end = fromISO(endDate)

  if (startDate === endDate) return formatPart(start, 'd MMM yyyy')

  // Guion corto sin espacios cuando une dos números; con espacios cuando une
  // dos fechas de varias palabras, donde pegarlo se vuelve ilegible.
  if (start.getFullYear() !== end.getFullYear()) {
    return `${formatPart(start, 'd MMM yyyy')} – ${formatPart(end, 'd MMM yyyy')}`
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${formatPart(start, 'd MMM')} – ${formatPart(end, 'd MMM yyyy')}`
  }
  return `${formatPart(start, 'd')}–${formatPart(end, 'd MMM yyyy')}`
}

/** `undefined` cuando no hay día clave utilizable, para no renderizar una línea vacía. */
export function formatGoalEventKeyDate(event: GoalEventWindowInput): string | undefined {
  const { keyDate } = resolveGoalEventWindow(event)
  if (!keyDate) return undefined
  return `Día clave: ${formatPart(fromISO(keyDate), 'd MMM')}`
}

function formatPart(date: Date, pattern: string): string {
  return format(date, pattern, { locale: es })
}

function isUsableEnd(startDate: string, endDate: string | undefined): boolean {
  return endDate != null && isStrictISODate(endDate) && endDate >= startDate
}

// Las tres fechas son ISO `YYYY-MM-DD`, así que la comparación lexicográfica es
// equivalente a la cronológica y no necesita construir `Date` ni cruzar husos.
function isWithinRange(startDate: string, endDate: string, candidate: string | undefined): boolean {
  if (candidate == null || !isStrictISODate(candidate)) return false
  return candidate >= startDate && candidate <= endDate
}

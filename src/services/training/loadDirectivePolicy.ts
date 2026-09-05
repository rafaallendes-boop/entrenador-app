/**
 * Regla de decisión de carga a partir de ejecución REAL del atleta.
 *
 * Existe como módulo aparte porque Week Creator y Plan Builder necesitan la
 * misma regla deportiva pero tienen tipos de entrada incompatibles
 * (`WeekCreatorEffectiveConfig` + `ChatContext` contra `TrainingPlanWeek` +
 * `PlanWizardConfig`). Cada llamador normaliza lo suyo a `ExecutionSignals` y
 * comparte la decisión.
 *
 * No depende de Whoop: `ExecutionSignals` sólo admite datos autoreportados
 * (energía, dolor, sueño vía day logs) y RPE real de sesiones completadas. El
 * llamador es responsable de excluir valores prellenados por Whoop antes de
 * construir las señales.
 */

export type LoadDirectiveVerdict = 'reduce' | 'hold' | 'progress' | 'no_signal'

export interface ExecutionSignals {
  /**
   * Promedio de RPE real. El llamador DEBE excluir los valores que Whoop
   * prellenó (`isWhoopPrefilled(log, 'rpeActual')`): un strain alto convertido
   * a esfuerzo no es un RPE declarado por el atleta.
   */
  avgActualRpe?: number
  /**
   * Cuántos valores respaldan `avgActualRpe`. Es el conteo de RPE reales, NO
   * el de sesiones completadas: una semana con 5 sesiones hechas y 1 RPE
   * anotado tiene muestra 1, y con menos de 3 no hay señal.
   */
  rpeSampleCount?: number
  /** Energía autoreportada, 1-10, excluyendo prefill Whoop. */
  latestEnergyLevel?: number
  /**
   * Dolor autoreportado, 1-10. Whoop no prellena este campo
   * (`prefillSource` sólo cubre `sleepHours`, `sleepQuality`, `energyLevel` y
   * `rpeActual`), así que siempre es del atleta.
   */
  latestPainLevel?: number
  /** Sueño autoreportado en horas, excluyendo prefill Whoop. */
  avgSleepHours?: number
  /** Adherencia de la ventana, 0-100. */
  adherencePct?: number
  /** Fatiga declarada por el atleta. */
  declaredFatigue?: 'fresh' | 'normal' | 'loaded' | 'overloaded'
}

export interface LoadDirectiveDecision {
  verdict: LoadDirectiveVerdict
  reason: string
}

/** Mismos umbrales que ya usaba Week Creator, para no cambiar su comportamiento. */
const LOW_ENERGY_THRESHOLD = 4
const HIGH_PAIN_THRESHOLD = 6
const HIGH_RPE_THRESHOLD = 8
const MIN_RPE_SAMPLE = 3
const LOW_ADHERENCE_THRESHOLD = 60
/** Mismo umbral que ya usa `recommendationFromWeeks` en `recentContext.ts`. */
const LOW_SLEEP_THRESHOLD = 6.5

/**
 * El orden de las reglas es el contrato: seguridad primero (fatiga declarada,
 * dolor, energía), después evidencia de sobrecarga (RPE), después adherencia,
 * y sólo al final la señal que permite subir. Una señal de reducir nunca puede
 * ser anulada por una de progresar que venga después.
 */
export function decideLoadDirective(signals: ExecutionSignals): LoadDirectiveDecision {
  if (signals.declaredFatigue === 'overloaded') {
    return { verdict: 'reduce', reason: 'el atleta declara fatiga acumulada alta' }
  }
  if (signals.latestPainLevel != null && signals.latestPainLevel >= HIGH_PAIN_THRESHOLD) {
    return { verdict: 'reduce', reason: `el último registro marca dolor ${signals.latestPainLevel}/10` }
  }
  if (signals.latestEnergyLevel != null && signals.latestEnergyLevel <= LOW_ENERGY_THRESHOLD) {
    return { verdict: 'reduce', reason: `el último registro marca energía ${signals.latestEnergyLevel}/10` }
  }
  if (signals.declaredFatigue === 'loaded') {
    return { verdict: 'hold', reason: 'el atleta declara carga acumulada' }
  }
  if (
    signals.avgActualRpe != null
    && (signals.rpeSampleCount ?? 0) >= MIN_RPE_SAMPLE
    && signals.avgActualRpe >= HIGH_RPE_THRESHOLD
  ) {
    return {
      verdict: 'hold',
      reason: `el RPE real promedio fue ${formatOneDecimal(signals.avgActualRpe)}/10 en ${signals.rpeSampleCount} sesiones`,
    }
  }
  if (signals.avgSleepHours != null && signals.avgSleepHours < LOW_SLEEP_THRESHOLD) {
    return {
      verdict: 'hold',
      reason: `el sueño promedio fue ${formatOneDecimal(signals.avgSleepHours)}h`,
    }
  }
  if (signals.adherencePct != null && signals.adherencePct < LOW_ADHERENCE_THRESHOLD) {
    return {
      verdict: 'hold',
      reason: `la adherencia real fue ${Math.round(signals.adherencePct)}%, así que no hay base para subir carga`,
    }
  }
  if (signals.declaredFatigue === 'fresh') {
    return { verdict: 'progress', reason: 'el atleta llega fresco' }
  }
  return { verdict: 'no_signal', reason: '' }
}

/**
 * Devuelve cadena vacía en `no_signal` a propósito: el llamador filtra líneas
 * vacías, así que la ausencia de señal no imprime nada en vez de imprimir un
 * "sin datos" que el modelo interpretaría como una instrucción.
 */
export function renderLoadDirective(decision: LoadDirectiveDecision): string {
  switch (decision.verdict) {
    case 'reduce':
      return `REDUCIR CARGA REAL — ${decision.reason}. Baja volumen e intensidad, deja las sesiones duras en RPE 6-7 y evita impactos agresivos.`
    case 'hold':
      return `MANTENER SIN SUBIR — ${decision.reason}. Conserva los estímulos de calidad, recorta volumen accesorio y no agregues intensidad extra.`
    case 'progress':
      return `SUBIR CARGA — ${decision.reason}. Puedes incrementar volumen o intensidad un escalón, no ambos a la vez.`
    case 'no_signal':
      return ''
  }
}

function formatOneDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

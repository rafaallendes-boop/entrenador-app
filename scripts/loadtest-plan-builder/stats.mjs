/**
 * Estadística del loadtest. El método de percentil es NEAREST-RANK y está
 * congelado en el spec: comparar variantes con métodos distintos produciría
 * diferencias que no existen.
 */

/** Nearest-rank: ceil(p * n) sobre la muestra ordenada, sin interpolar. */
export function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const rank = Math.ceil(p * sorted.length)
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1]
}

function numericOnly(values) {
  return values.filter((value) => typeof value === 'number' && Number.isFinite(value))
}

/**
 * Los `null` (por ejemplo `plan_complete_ms` de una corrida que no completó) se
 * excluyen y se cuentan aparte. Tratarlos como cero inventaría latencias de 0ms.
 */
export function summarizeLatency(values) {
  const numeric = numericOnly(values)
  return {
    n: numeric.length,
    nullCount: values.length - numeric.length,
    p50: percentile(numeric, 0.5),
    p95: percentile(numeric, 0.95),
  }
}

export function summarizeDistribution(values) {
  const numeric = numericOnly(values)
  const histogram = {}
  for (const value of numeric) {
    histogram[value] = (histogram[value] ?? 0) + 1
  }
  return {
    n: numeric.length,
    p50: percentile(numeric, 0.5),
    p90: percentile(numeric, 0.9),
    p99: percentile(numeric, 0.99),
    max: numeric.length === 0 ? null : Math.max(...numeric),
    histogram,
  }
}

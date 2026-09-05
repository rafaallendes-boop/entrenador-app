/**
 * Todo lo que lee o escribe `ai_usage_daily`. Desde `029` la tabla tiene un eje
 * `subject_athlete_id`: la fila global (`''`) es la ÚNICA contable y las filas
 * por sujeto son limitadores de tasa. Un consumidor que no distinga el eje
 * duplica costo, gasto o métricas — o, si conserva un `on conflict` de tres
 * columnas, falla en ejecución porque esa constraint dejó de existir.
 */
export interface AiUsageConsumer {
  name: string
  file: string
  role: 'reserve' | 'reserve_legacy' | 'cost' | 'spend' | 'metrics' | 'preflight'
}

export const AI_USAGE_DAILY_CONSUMERS: readonly AiUsageConsumer[] = [
  { name: 'reserve_ai_usage', file: 'supabase/029_ai_usage_daily_subject.sql', role: 'reserve' },
  { name: 'increment_ai_usage_if_under_limit', file: 'supabase/029_ai_usage_daily_subject.sql', role: 'reserve_legacy' },
  { name: 'increment_ai_usage_cost', file: 'supabase/029_ai_usage_daily_subject.sql', role: 'cost' },
  { name: 'read_ai_usage_spend', file: 'supabase/029_ai_usage_daily_subject.sql', role: 'spend' },
  { name: 'read_operations_metrics', file: 'supabase/029_ai_usage_daily_subject.sql', role: 'metrics' },
  { name: 'checkUsagePreflight', file: 'netlify/functions/_shared/usageGate.ts', role: 'preflight' },
] as const

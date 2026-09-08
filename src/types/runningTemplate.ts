export type RunningEffort = 'easy' | 'steady' | 'threshold' | 'five_k' | 'ten_k' | 'half_marathon' | 'marathon' | 'stride' | 'hill_hard' | 'hill_sprint'
export interface RunningTemplatePrescription {
  minimumMinutes: number
  defaultMinutes: number
  kind: 'continuous' | 'repeats' | 'progressive' | 'run_walk'
  effort: RunningEffort
  workSeconds?: number
  distanceKm?: number
  recoverySeconds?: number
  repetitions?: { min: number; max: number }
  terrain?: 'flat' | 'hill'
  techniqueSeconds?: number
  minimumEasySeconds?: number
}
export interface RunningTemplateRef {
  source: 'running_template'
  id: string
  version: number
}

/** Shape validation preserves readable historical references across catalog versions. */
export function sanitizeRunningTemplateRef(value: unknown): RunningTemplateRef | undefined {
  if (!value || typeof value !== 'object') return undefined
  const ref = value as Record<string, unknown>
  return ref.source === 'running_template' && typeof ref.id === 'string' && ref.id.length > 0
    && Number.isInteger(ref.version) && Number(ref.version) > 0
    ? { source: 'running_template', id: ref.id, version: Number(ref.version) } : undefined
}

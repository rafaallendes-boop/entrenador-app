import type { ReadinessDaily } from '../../types'
import { recoveryBand } from '../readiness/readinessBands'

export function formatReadinessLine(readiness?: ReadinessDaily): string | null {
  if (!readiness) return null

  const parts: string[] = []
  if (readiness.recoveryScore != null) {
    const band = recoveryBand(readiness.recoveryScore)
    const label = band === 'red' ? ' (bajo)' : band === 'green' ? ' (alto)' : ''
    parts.push(`recovery ${Math.round(readiness.recoveryScore)}%${label}`)
  }
  if (readiness.sleepHours != null) parts.push(`sueño ${readiness.sleepHours}h`)
  if (readiness.strain != null) parts.push(`strain ${readiness.strain.toFixed(1)}`)
  if (parts.length === 0) return null

  return `Readiness Whoop: ${parts.join(', ')}.`
}

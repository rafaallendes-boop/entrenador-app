export interface HeartRateTargetDisplay {
  value: string
  unit: 'bpm' | 'FCmax'
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '')
}

export function getHeartRateTargetDisplay(
  min: number | null | undefined,
  max?: number | null,
): HeartRateTargetDisplay | null {
  const minValue = finiteNumber(min)
  const maxValue = finiteNumber(max)
  if (minValue == null && maxValue == null) return null

  const values = [minValue, maxValue].filter((value): value is number => value != null)
  const isPercentOfMax = values.every(value => value > 0 && value <= 100)
  const range = minValue != null && maxValue != null
    ? `${formatValue(minValue)}–${formatValue(maxValue)}`
    : formatValue(minValue ?? maxValue ?? 0)

  return {
    value: isPercentOfMax ? `${range}%` : range,
    unit: isPercentOfMax ? 'FCmax' : 'bpm',
  }
}

export function formatHeartRateTarget(
  min: number | null | undefined,
  max?: number | null,
): string | null {
  const display = getHeartRateTargetDisplay(min, max)
  return display ? `${display.value} ${display.unit}` : null
}

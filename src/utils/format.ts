export const formatDuration = (minutes: number): string => {
  if (minutes < 60) return `${minutes}min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}min`
}

export const formatRpe = (rpe: number): string => `RPE ${rpe}`

export const capitalize = (s: string): string =>
  s.charAt(0).toUpperCase() + s.slice(1)

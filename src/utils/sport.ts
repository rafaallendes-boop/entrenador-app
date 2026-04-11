import type { SupportedSport } from '../types'

export const SPORT_LABELS: Record<SupportedSport, string> = {
  squash: 'squash',
  running: 'running',
  strength: 'fuerza',
  mobility: 'movilidad',
  cycling: 'ciclismo',
}

export function getSportLabel(sport: string): string {
  return (SPORT_LABELS as Record<string, string>)[sport] ?? sport
}

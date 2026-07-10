import type { SupportedSport } from '../../types'

const WHOOP_SPORT_TO_APP: Record<string, SupportedSport> = {
  squash: 'squash',
  running: 'running',
  cycling: 'cycling',
  weightlifting: 'strength',
  'functional fitness': 'strength',
  'strength trainer': 'strength',
  hiit: 'strength',
  powerlifting: 'strength',
  yoga: 'mobility',
  pilates: 'mobility',
  stretching: 'mobility',
}

export function normalizeWhoopSportName(value: string): string {
  return value.toLowerCase().replace(/[\s_]+/g, ' ').trim()
}

export function mapWhoopSport(sportName: string): SupportedSport | null {
  return WHOOP_SPORT_TO_APP[normalizeWhoopSportName(sportName)] ?? null
}

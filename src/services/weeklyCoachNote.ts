import type { WeekSummary } from '../types'

type CoachNoteSnapshot = {
  weekStartDate: string
  plannedSessions: number
  completedSessions: number
  plannedMinutes: number
  completedMinutes: number
  adherencePct: number | null
  squashSessions: number
  runningSessions: number
  strengthSessions: number
  plannedSquashSessions: number | null
  plannedRunningSessions: number | null
  plannedStrengthSessions: number | null
  mobilityMinutes: number | null
  avgRpe: number | null
  avgActualRpe: number | null
  avgSleep: number | null
  avgEnergy: number | null
  avgBodyWeight: number | null
  weightEntries: number | null
  objectives: string[]
}

function nullableNumber(value: number | undefined): number | null {
  return value == null ? null : value
}

function normalizedObjectives(objectives: string[] | undefined): string[] {
  return objectives?.map((objective) => objective.trim()).filter(Boolean) ?? []
}

export function buildWeeklyCoachNoteSnapshot(summary: WeekSummary): string {
  const snapshot: CoachNoteSnapshot = {
    weekStartDate: summary.weekStartDate,
    plannedSessions: summary.plannedSessions,
    completedSessions: summary.completedSessions,
    plannedMinutes: summary.plannedMinutes,
    completedMinutes: summary.completedMinutes,
    adherencePct: nullableNumber(summary.adherencePct),
    squashSessions: summary.squashSessions,
    runningSessions: summary.runningSessions,
    strengthSessions: summary.strengthSessions,
    plannedSquashSessions: nullableNumber(summary.plannedSquashSessions),
    plannedRunningSessions: nullableNumber(summary.plannedRunningSessions),
    plannedStrengthSessions: nullableNumber(summary.plannedStrengthSessions),
    mobilityMinutes: nullableNumber(summary.mobilityMinutes),
    avgRpe: nullableNumber(summary.avgRpe),
    avgActualRpe: nullableNumber(summary.avgActualRpe),
    avgSleep: nullableNumber(summary.avgSleep),
    avgEnergy: nullableNumber(summary.avgEnergy),
    avgBodyWeight: nullableNumber(summary.avgBodyWeight),
    weightEntries: nullableNumber(summary.weightEntries),
    objectives: normalizedObjectives(summary.objectives),
  }

  return JSON.stringify(snapshot)
}

export function hasFreshWeeklyCoachNote(summary: WeekSummary | null | undefined): summary is WeekSummary & {
  coachNote: string
  coachNoteSnapshot: string
} {
  if (!summary?.coachNote?.trim()) return false
  if (!summary.coachNoteSnapshot) return false
  return summary.coachNoteSnapshot === buildWeeklyCoachNoteSnapshot(summary)
}

export function getFreshWeeklyCoachNote(summary: WeekSummary | null | undefined): string | null {
  return hasFreshWeeklyCoachNote(summary) ? summary.coachNote.trim() : null
}

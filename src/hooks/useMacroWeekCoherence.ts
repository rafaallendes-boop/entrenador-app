import { useMemo } from 'react'
import { buildMacroWeekCoherenceSummary } from '../services/macroWeekCoherence'
import { useTrainingStore } from '../store/useTrainingStore'
import { useCoachMemoryStore } from '../store/useCoachMemoryStore'
import type { MacroWeekCoherenceSummary } from '../types'

/**
 * Central hook for macro week coherence — computed once, shared across surfaces.
 * Replaces the triple useMemo pattern in Dashboard, WeeklyView, and SettingsPage.
 */
export function useMacroWeekCoherence(): MacroWeekCoherenceSummary {
  const sessions = useTrainingStore(state => state.sessions)
  const athleteProfile = useCoachMemoryStore(state => state.athleteProfile)

  return useMemo(() => buildMacroWeekCoherenceSummary({
    athleteProfile,
    sessions,
    historicalSessions: sessions.filter(
      s => s.status === 'completed' || s.status === 'adjusted',
    ),
  }), [athleteProfile, sessions])
}

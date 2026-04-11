import { useEffect, useMemo, useState } from 'react'

import type { WeeklyActionLoopInput } from '../services/weeklyActionLoop'
import { buildWeeklyActionSummary } from '../services/weeklyActionLoop'
import { buildAutoAdjustmentDraft, type AutoAdjustmentDraft } from '../services/alertAdjustmentEngine'
import { computeLoadAnalytics, type LoadAnalytics } from '../services/loadAnalytics'
import type { WeeklyActionSummary } from '../types'

export interface WeeklySnapshotInput extends WeeklyActionLoopInput {}

export interface WeeklySnapshot {
  loadAnalytics: LoadAnalytics | null
  weeklyActionSummary: WeeklyActionSummary
  autoAdjustmentDraft: AutoAdjustmentDraft | null
}

export function buildWeeklySnapshot(
  input: WeeklySnapshotInput & { loadAnalytics?: LoadAnalytics | null },
): WeeklySnapshot {
  const loadAnalytics = input.loadAnalytics ?? null

  return {
    loadAnalytics,
    weeklyActionSummary: buildWeeklyActionSummary({
      sessions: input.sessions,
      currentWeekSummary: input.currentWeekSummary,
      todayDayLog: input.todayDayLog,
      macroWeekCoherence: input.macroWeekCoherence,
      loadAnalytics,
      today: input.today,
    }),
    autoAdjustmentDraft: buildAutoAdjustmentDraft({
      sessions: input.sessions,
      currentWeekSummary: input.currentWeekSummary,
      todayDayLog: input.todayDayLog,
      macroWeekCoherence: input.macroWeekCoherence,
      loadAnalytics,
      today: input.today,
    }),
  }
}

export function useLoadAnalytics(currentWeekStart: string, sessions: WeeklySnapshotInput['sessions']) {
  const [loadAnalytics, setLoadAnalytics] = useState<LoadAnalytics | null>(null)

  useEffect(() => {
    let cancelled = false

    void computeLoadAnalytics(4).then((analytics) => {
      if (!cancelled) setLoadAnalytics(analytics)
    })

    return () => {
      cancelled = true
    }
  }, [currentWeekStart, sessions])

  return loadAnalytics
}

export function useWeeklySnapshot(
  currentWeekStart: string,
  input: WeeklySnapshotInput,
): WeeklySnapshot {
  const loadAnalytics = useLoadAnalytics(currentWeekStart, input.sessions)

  return useMemo(
    () =>
      buildWeeklySnapshot({
        ...input,
        loadAnalytics,
      }),
    [
      currentWeekStart,
      input.sessions,
      input.currentWeekSummary,
      input.todayDayLog,
      input.macroWeekCoherence,
      input.today,
      loadAnalytics,
    ],
  )
}

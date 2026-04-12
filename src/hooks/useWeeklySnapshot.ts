import { useEffect, useMemo, useState } from 'react'

import { getHistoricalSessionsWindow } from '../db/queries'
import { buildActionAlerts } from '../services/actionAlerts'
import type { WeeklyActionLoopInput } from '../services/weeklyActionLoop'
import { buildWeeklyActionSummary } from '../services/weeklyActionLoop'
import {
  buildAutoAdjustmentDraft,
  type AutoAdjustmentDraft,
} from '../services/alertAdjustmentEngine'
import { computeLoadAnalytics, type LoadAnalytics } from '../services/loadAnalytics'
import { buildSlotAdherenceProfile, type SlotAdherenceProfile } from '../services/slotAdherence'
import type { ActionableAlert } from '../services/actionAlerts'
import type { AthleteProfile, Session, WeeklyActionSummary } from '../types'
import { todayISO } from '../utils/date'

export interface WeeklySnapshotInput extends WeeklyActionLoopInput {
  athleteProfile?: AthleteProfile | null
  historicalSessions?: Session[]
  slotAdherenceProfile?: SlotAdherenceProfile | null
  activeAlerts?: ActionableAlert[]
}

export interface WeeklySnapshot {
  loadAnalytics: LoadAnalytics | null
  weeklyActionSummary: WeeklyActionSummary
  autoAdjustmentDraft: AutoAdjustmentDraft | null
}

export function buildWeeklySnapshot(
  input: WeeklySnapshotInput & { loadAnalytics?: LoadAnalytics | null },
): WeeklySnapshot {
  const loadAnalytics = input.loadAnalytics ?? null
  const activeAlerts = input.activeAlerts ?? buildActionAlerts({
    sessions: input.sessions,
    currentWeekSummary: input.currentWeekSummary,
    todayDayLog: input.todayDayLog,
    macroWeekCoherence: input.macroWeekCoherence,
    loadAnalytics,
    today: input.today,
  })

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
      athleteProfile: input.athleteProfile,
      historicalSessions: input.historicalSessions,
      loadAnalytics,
      today: input.today,
      activeAlerts,
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

export function useHistoricalSessions(referenceDate: string) {
  const [historicalSessions, setHistoricalSessions] = useState<Session[]>([])

  useEffect(() => {
    let cancelled = false

    void getHistoricalSessionsWindow(referenceDate, 8).then((next) => {
      if (!cancelled) setHistoricalSessions(next)
    })

    return () => {
      cancelled = true
    }
  }, [referenceDate])

  return historicalSessions
}

export function useWeeklySnapshot(
  currentWeekStart: string,
  input: WeeklySnapshotInput,
): WeeklySnapshot {
  const loadAnalytics = useLoadAnalytics(currentWeekStart, input.sessions)
  const referenceDate = input.currentWeekSummary?.weekStartDate ?? currentWeekStart
  const historicalSessions = useHistoricalSessions(referenceDate)
  const today = input.today ?? todayISO()
  const slotAdherenceProfile = useMemo(
    () => buildSlotAdherenceProfile(historicalSessions, today),
    [historicalSessions, today],
  )

  return useMemo(
    () =>
      buildWeeklySnapshot({
        ...input,
        historicalSessions: input.historicalSessions ?? historicalSessions,
        slotAdherenceProfile: input.slotAdherenceProfile ?? slotAdherenceProfile,
        activeAlerts: buildActionAlerts({
          sessions: input.sessions,
          currentWeekSummary: input.currentWeekSummary,
          todayDayLog: input.todayDayLog,
          macroWeekCoherence: input.macroWeekCoherence,
          loadAnalytics,
          today,
        }),
        loadAnalytics,
      }),
    [
      currentWeekStart,
      input.athleteProfile,
      input.historicalSessions,
      input.slotAdherenceProfile,
      input.sessions,
      input.currentWeekSummary,
      input.todayDayLog,
      input.macroWeekCoherence,
      today,
      historicalSessions,
      slotAdherenceProfile,
      loadAnalytics,
    ],
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AthleteProfile, SupportedSport, TrainingPriority } from '../types'
import { getEnabledSports, getPrimarySportNormalized } from '../utils/athlete'

export type OnboardingStep = 1 | 2 | 3 | 4
export type OnboardingDayKey = 'lun' | 'mar' | 'mié' | 'jue' | 'vie' | 'sáb' | 'dom'

interface OnboardingFormState {
  step: OnboardingStep
  name: string
  selectedSports: SupportedSport[]
  primarySport: SupportedSport | null
  priority: TrainingPriority | null
  availableDays: OnboardingDayKey[]
  doubleSessionDays: OnboardingDayKey[]
}

interface UseOnboardingFormResult extends OnboardingFormState {
  canGoNext: boolean
  canFinish: boolean
  setStep: (step: OnboardingStep) => void
  setName: (name: string) => void
  setPrimarySport: (sport: SupportedSport) => void
  setPriority: (priority: TrainingPriority) => void
  toggleSport: (sport: SupportedSport) => void
  toggleDay: (day: OnboardingDayKey) => void
  toggleDoubleDay: (day: OnboardingDayKey) => void
}

const EMPTY_STATE: OnboardingFormState = {
  step: 1,
  name: '',
  selectedSports: [],
  primarySport: null,
  priority: null,
  availableDays: [],
  doubleSessionDays: [],
}

function buildStateFromProfile(profile: AthleteProfile | null | undefined): Omit<OnboardingFormState, 'step'> {
  const enabledSports = getEnabledSports(profile)
  const availableDays = (profile?.scheduleProfile?.availableDays ?? []) as OnboardingDayKey[]
  const doubleSessionDays = (profile?.scheduleProfile?.doubleSessionDays ?? []) as OnboardingDayKey[]

  return {
    name: profile?.name?.trim() ?? '',
    selectedSports: enabledSports,
    primarySport: getPrimarySportNormalized(profile) ?? null,
    priority: profile?.sportContext?.trainingPriority ?? null,
    availableDays,
    doubleSessionDays: doubleSessionDays.filter((day) => availableDays.includes(day)),
  }
}

export function useOnboardingForm(
  profile: AthleteProfile | null | undefined,
  isReady: boolean,
  isSaving: boolean,
): UseOnboardingFormResult {
  const [state, setState] = useState<OnboardingFormState>(EMPTY_STATE)
  const hasHydratedRef = useRef(false)

  useEffect(() => {
    if (!isReady || hasHydratedRef.current) return
    hasHydratedRef.current = true
    setState((current) => ({
      ...current,
      ...buildStateFromProfile(profile),
    }))
  }, [isReady, profile])

  const canGoNext = useMemo(() => {
    switch (state.step) {
      case 1:
        return state.selectedSports.length > 0
      case 2:
        return state.primarySport !== null
      case 3:
        return state.priority !== null
      case 4:
        return false
    }
  }, [state.primarySport, state.priority, state.selectedSports.length, state.step])

  const canFinish = state.availableDays.length > 0 && !isSaving

  return {
    ...state,
    canGoNext,
    canFinish,
    setStep: (step) => setState((current) => ({ ...current, step })),
    setName: (name) => setState((current) => ({ ...current, name })),
    setPrimarySport: (sport) => setState((current) => ({ ...current, primarySport: sport })),
    setPriority: (priority) => setState((current) => ({ ...current, priority })),
    toggleSport: (sport) =>
      setState((current) => {
        const selectedSports = current.selectedSports.includes(sport)
          ? current.selectedSports.filter((item) => item !== sport)
          : [...current.selectedSports, sport]

        return {
          ...current,
          selectedSports,
          primarySport:
            current.primarySport && !selectedSports.includes(current.primarySport) ? null : current.primarySport,
        }
      }),
    toggleDay: (day) =>
      setState((current) => {
        const availableDays = current.availableDays.includes(day)
          ? current.availableDays.filter((item) => item !== day)
          : [...current.availableDays, day]

        return {
          ...current,
          availableDays,
          doubleSessionDays: current.doubleSessionDays.filter((item) => availableDays.includes(item)),
        }
      }),
    toggleDoubleDay: (day) =>
      setState((current) => ({
        ...current,
        doubleSessionDays: current.doubleSessionDays.includes(day)
          ? current.doubleSessionDays.filter((item) => item !== day)
          : [...current.doubleSessionDays, day],
      })),
  }
}

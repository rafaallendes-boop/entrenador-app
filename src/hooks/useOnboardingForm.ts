import { useMemo, useState } from 'react'
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
  const baseState = useMemo<OnboardingFormState>(
    () => ({
      ...EMPTY_STATE,
      ...(isReady ? buildStateFromProfile(profile) : {}),
    }),
    [isReady, profile],
  )
  const [draftState, setDraftState] = useState<OnboardingFormState | null>(null)
  const state = draftState ?? baseState

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
    setStep: (step) => setDraftState((current) => ({ ...(current ?? baseState), step })),
    setName: (name) => setDraftState((current) => ({ ...(current ?? baseState), name })),
    setPrimarySport: (sport) => setDraftState((current) => ({ ...(current ?? baseState), primarySport: sport })),
    setPriority: (priority) => setDraftState((current) => ({ ...(current ?? baseState), priority })),
    toggleSport: (sport) =>
      setDraftState((current) => {
        const resolvedState = current ?? baseState
        const selectedSports = resolvedState.selectedSports.includes(sport)
          ? resolvedState.selectedSports.filter((item) => item !== sport)
          : [...resolvedState.selectedSports, sport]

        return {
          ...resolvedState,
          selectedSports,
          primarySport:
            resolvedState.primarySport && !selectedSports.includes(resolvedState.primarySport)
              ? null
              : resolvedState.primarySport,
        }
      }),
    toggleDay: (day) =>
      setDraftState((current) => {
        const resolvedState = current ?? baseState
        const availableDays = resolvedState.availableDays.includes(day)
          ? resolvedState.availableDays.filter((item) => item !== day)
          : [...resolvedState.availableDays, day]

        return {
          ...resolvedState,
          availableDays,
          doubleSessionDays: resolvedState.doubleSessionDays.filter((item) => availableDays.includes(item)),
        }
      }),
    toggleDoubleDay: (day) =>
      setDraftState((current) => {
        const resolvedState = current ?? baseState

        return {
          ...resolvedState,
          doubleSessionDays: resolvedState.doubleSessionDays.includes(day)
            ? resolvedState.doubleSessionDays.filter((item) => item !== day)
            : [...resolvedState.doubleSessionDays, day],
        }
      }),
  }
}

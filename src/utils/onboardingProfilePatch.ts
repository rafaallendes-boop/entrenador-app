import type { AthleteProfile, GoalEventType, SupportedSport, TrainingPriority } from '../types'
import type { OnboardingDayKey } from './schedule'
import { v4 as uuid } from './uuid'

export type OnboardingAthleteProfilePatch = Partial<Omit<AthleteProfile, 'id' | 'updatedAt'>>

export interface OnboardingAthleteProfilePatchInput {
  existingProfile?: AthleteProfile | null
  name: string
  selectedSports: SupportedSport[]
  primarySport: SupportedSport
  priority: TrainingPriority
  availableDays: OnboardingDayKey[]
  doubleSessionDays: OnboardingDayKey[]
  goalEventTitle: string
  goalEventDate: string
  goalEventNotes: string
  availabilityNotes: string
  currentInjuries: string
  previousInjuries: string
  restrictions: string
  strengthNotes: string
  squat1RM: string
  deadlift1RM: string
  benchPress1RM: string
  overheadPress1RM: string
  createId?: () => string
}

const GOAL_MAIN_LABEL: Record<TrainingPriority, string> = {
  performance: 'Competir mejor',
  fitness: 'Mejorar condición física',
  body_composition: 'Composición corporal',
  return_to_play: 'Volver de una lesión',
}

export function trimToUndefined(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function parseOptionalKg(value: string): number | undefined {
  const normalized = value.replace(',', '.').trim()
  if (!normalized) return undefined

  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function eventTypeForSport(sport: SupportedSport): GoalEventType {
  if (sport === 'running') return 'race'
  if (sport === 'cycling') return 'cycling_event'
  if (sport === 'squash') return 'tournament'
  return 'other'
}

export function buildOnboardingAthleteProfilePatch(
  input: OnboardingAthleteProfilePatchInput,
): OnboardingAthleteProfilePatch {
  const strengthProfile = {
    squat1RM: parseOptionalKg(input.squat1RM),
    deadlift1RM: parseOptionalKg(input.deadlift1RM),
    benchPress1RM: parseOptionalKg(input.benchPress1RM),
    overheadPress1RM: parseOptionalKg(input.overheadPress1RM),
    notes: trimToUndefined(input.strengthNotes),
  }
  const recoveryProfile = {
    currentInjuries: trimToUndefined(input.currentInjuries),
    previousInjuries: trimToUndefined(input.previousInjuries),
    restrictions: trimToUndefined(input.restrictions),
  }
  const existingPrimaryEvent = input.existingProfile?.goalEvents?.find((event) => event.priority === 'primary')
  const otherEvents = (input.existingProfile?.goalEvents ?? []).filter((event) => event.priority !== 'primary')
  const eventTitle = input.goalEventTitle.trim()
  const eventDate = input.goalEventDate.trim()
  const goalEvents = eventTitle && eventDate
    ? [
        {
          id: existingPrimaryEvent?.id ?? (input.createId ?? uuid)(),
          title: eventTitle,
          date: eventDate,
          sport: input.primarySport,
          priority: 'primary' as const,
          notes: trimToUndefined(input.goalEventNotes),
          eventType: eventTypeForSport(input.primarySport),
        },
        ...otherEvents,
      ]
    : input.existingProfile?.goalEvents
  const hasStrengthProfile = Object.values(strengthProfile).some((value) => value != null)
  const hasRecoveryProfile = Object.values(recoveryProfile).some((value) => value != null)

  return {
    name: input.name.trim() || undefined,
    onboardingDeferredAt: undefined,
    sportContext: {
      enabledSports: input.selectedSports,
      primarySport: input.primarySport,
      secondarySports: input.selectedSports.filter((sport) => sport !== input.primarySport),
      trainingPriority: input.priority,
    },
    mainGoal: GOAL_MAIN_LABEL[input.priority],
    scheduleProfile: {
      ...input.existingProfile?.scheduleProfile,
      availableDays: input.availableDays,
      doubleSessionDays: input.doubleSessionDays.length > 0 ? input.doubleSessionDays : undefined,
      constraints: trimToUndefined(input.availabilityNotes),
    },
    strengthProfile: hasStrengthProfile ? strengthProfile : undefined,
    recoveryProfile: hasRecoveryProfile ? recoveryProfile : undefined,
    ...(goalEvents ? { goalEvents } : {}),
  }
}

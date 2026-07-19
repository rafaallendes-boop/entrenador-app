import type {
  AthleteProfile,
  DayOfWeek,
  GoalEventLevel,
  SupportedSport,
  TrainingPriority,
  WizardFatigueLevel,
  WizardFitnessLevel,
} from '../../types'
import { getAllowedPlanningSports } from '../planningConstraints'
import { getEnabledSports, getPrimarySportNormalized, normalizeSport } from '../../utils/athlete'
import { MAX_WEEKLY_SESSIONS } from '../../utils/schedule'

export interface WeekCreatorEffectiveConfig {
  trainingDays: DayOfWeek[]
  doubleSessionDays?: DayOfWeek[]
  sessionsPerWeek: number
  maxSessionsPerWeek: number
  sessionDurationMins: number
  allowDoubleSession: boolean
  allowedSports: SupportedSport[]
  primarySport?: SupportedSport
  competitiveLevel?: GoalEventLevel
  trainingPriority?: TrainingPriority
  injuryNotes?: string
  scheduleConstraints?: string
  currentFitnessLevel: WizardFitnessLevel
  currentFatigue: WizardFatigueLevel
  /** Whether the config was derived from a plan wizard; false means fallback defaults. */
  fromWizard: boolean
  configSource: 'wizard' | 'schedule' | 'defaults'
}

export type WeekCreatorAthleteTier = 'foundation' | 'recreational' | 'competitive' | 'advanced' | 'elite'

const DEFAULT_TRAINING_DAYS: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]

const ALL_DAYS: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]

const SPANISH_DAY_MAP: Record<string, DayOfWeek> = {
  lun: 'monday', lunes: 'monday',
  mar: 'tuesday', martes: 'tuesday',
  mie: 'wednesday', mié: 'wednesday', miercoles: 'wednesday', miércoles: 'wednesday',
  jue: 'thursday', jueves: 'thursday',
  vie: 'friday', viernes: 'friday',
  sab: 'saturday', sáb: 'saturday', sabado: 'saturday', sábado: 'saturday',
  dom: 'sunday', domingo: 'sunday',
}

const DEFAULT_ALLOWED_SPORTS: SupportedSport[] = ['squash']
const DEFAULT_SESSIONS_PER_WEEK = 3
const DEFAULT_SESSION_DURATION_MINS = 60
const DEFAULT_FITNESS_LEVEL: WizardFitnessLevel = 'normal'
const DEFAULT_FATIGUE_LEVEL: WizardFatigueLevel = 'normal'

function normalizeAvailableDays(rawDays: string[] | undefined): DayOfWeek[] {
  if (!rawDays || rawDays.length === 0) return []
  const seen = new Set<DayOfWeek>()
  for (const raw of rawDays) {
    const key = raw.trim().toLowerCase()
    const asciiKey = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const mapped = SPANISH_DAY_MAP[key]
      ?? SPANISH_DAY_MAP[asciiKey]
      ?? (ALL_DAYS.includes(key as DayOfWeek) ? (key as DayOfWeek) : undefined)
    if (mapped) seen.add(mapped)
  }
  return Array.from(seen)
}

function clampSessionsPerWeek(value: number, maxSessionsPerWeek: number): number {
  return Math.min(Math.max(Math.round(value), DEFAULT_SESSIONS_PER_WEEK), maxSessionsPerWeek)
}

function resolveMaxSessionsPerWeek(
  trainingDays: DayOfWeek[],
  rawDoubleSessionDays?: string[],
): number {
  const trainingDaySet = new Set(trainingDays)
  const doubleDays = normalizeAvailableDays(rawDoubleSessionDays)
    .filter((day) => trainingDaySet.has(day))
  const capacity = trainingDays.length + new Set(doubleDays).size
  return Math.max(1, Math.min(capacity, MAX_WEEKLY_SESSIONS))
}

function deriveScheduleSessionsPerWeek(
  trainingDays: DayOfWeek[],
  doubleSessionDays: DayOfWeek[],
  explicitSessionsPerWeek: number | undefined,
  maxSessionsPerWeek: number,
): number {
  if (explicitSessionsPerWeek != null && Number.isFinite(explicitSessionsPerWeek)) {
    return clampSessionsPerWeek(explicitSessionsPerWeek, maxSessionsPerWeek)
  }

  const base = trainingDays.length >= 5
    ? trainingDays.length - 1
    : Math.max(trainingDays.length, DEFAULT_SESSIONS_PER_WEEK)
  const doubleCapacity = doubleSessionDays.length > 0
    ? Math.min(maxSessionsPerWeek, Math.max(trainingDays.length, base + 2))
    : base
  const derived = Math.max(base, doubleCapacity)
  return clampSessionsPerWeek(derived, maxSessionsPerWeek)
}

export function withRequestedSessionsPerWeek(
  config: WeekCreatorEffectiveConfig,
  userMessage: string,
): WeekCreatorEffectiveConfig {
  if (config.configSource === 'wizard') return config
  const requested = extractRequestedSessionsPerWeek(userMessage)
  if (requested == null) return config
  return {
    ...config,
    sessionsPerWeek: clampSessionsPerWeek(requested, config.maxSessionsPerWeek),
  }
}

export function extractRequestedSessionsPerWeek(userMessage: string): number | undefined {
  const normalized = userMessage
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  const digitMatch = normalized.match(/\b([2-9])\s*(?:sesiones|entrenamientos|sesion(?:es)?|dias?\s+de\s+entreno)\b/)
  if (digitMatch) return Number(digitMatch[1])

  const wordToNumber: Record<string, number> = {
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
  }
  const wordMatch = normalized.match(/\b(dos|tres|cuatro|cinco|seis|siete|ocho)\s*(?:sesiones|entrenamientos|sesion(?:es)?|dias?\s+de\s+entreno)\b/)
  return wordMatch ? wordToNumber[wordMatch[1]] : undefined
}

export function deriveWeekCreatorAthleteTier(
  input: Pick<WeekCreatorEffectiveConfig, 'competitiveLevel' | 'trainingPriority' | 'currentFitnessLevel'>,
): WeekCreatorAthleteTier {
  if (input.trainingPriority === 'return_to_play' || input.currentFitnessLevel === 'low' || input.currentFitnessLevel === 'returning') {
    return 'foundation'
  }
  switch (input.competitiveLevel) {
    case 'elite':
      return 'elite'
    case 'masters':
      return 'advanced'
    case 'competitive':
      return 'competitive'
    case 'recreational':
      return 'recreational'
    default:
      return input.currentFitnessLevel === 'fit' ? 'competitive' : 'recreational'
  }
}

function resolveAllowedSports(profile: AthleteProfile | null | undefined): SupportedSport[] {
  const configuredSports = getAllowedPlanningSports(profile)
  if (profile?.planWizardConfig && configuredSports.length > 0) {
    const currentPrimary = getPrimarySportNormalized(profile)
    if (!currentPrimary || configuredSports.includes(currentPrimary)) return configuredSports
    return [...new Set([currentPrimary, ...configuredSports, ...getEnabledSports(profile)])]
  }

  const enabledSports = getEnabledSports(profile)
  if (enabledSports.length > 0) return enabledSports

  const inferredPrimary = getPrimarySportNormalized(profile)
  if (inferredPrimary) return [inferredPrimary]

  if (configuredSports.length > 0) return configuredSports

  const legacyPrimary = profile?.primarySport ? normalizeSport(profile.primarySport) : undefined
  if (legacyPrimary) return [legacyPrimary]

  const legacySecondary = (profile?.secondarySports ?? [])
    .map((sport) => normalizeSport(sport))
    .find((sport): sport is SupportedSport => sport !== undefined)
  if (legacySecondary) return [legacySecondary]

  // Avoid blocking chat-generated weeks when onboarding is still incomplete.
  return [...DEFAULT_ALLOWED_SPORTS]
}

export function resolveWeekCreatorConfig(profile: AthleteProfile | null | undefined): WeekCreatorEffectiveConfig {
  if (!profile) {
    return {
      trainingDays: [...DEFAULT_TRAINING_DAYS],
      doubleSessionDays: [],
      sessionsPerWeek: DEFAULT_SESSIONS_PER_WEEK,
      maxSessionsPerWeek: DEFAULT_TRAINING_DAYS.length,
      sessionDurationMins: DEFAULT_SESSION_DURATION_MINS,
      allowDoubleSession: false,
      allowedSports: [...DEFAULT_ALLOWED_SPORTS],
      primarySport: DEFAULT_ALLOWED_SPORTS[0],
      currentFitnessLevel: DEFAULT_FITNESS_LEVEL,
      currentFatigue: DEFAULT_FATIGUE_LEVEL,
      fromWizard: false,
      configSource: 'defaults',
    }
  }

  const allowedSports = resolveAllowedSports(profile)
  const primarySport = getPrimarySportNormalized(profile) ?? allowedSports[0]
  const goalEvent = resolveConfigGoalEvent(profile)
  const competitiveLevel = goalEvent?.competitiveLevel
  const trainingPriority = profile.sportContext?.trainingPriority
  const wizard = profile.planWizardConfig

  if (wizard) {
    const scheduleDays = normalizeAvailableDays(profile.scheduleProfile?.availableDays)
    const wizardTrainingDays = wizard.trainingDays.length > 0 ? [...wizard.trainingDays] : [...DEFAULT_TRAINING_DAYS]
    const trainingDays = scheduleDays.length > 0 ? scheduleDays : wizardTrainingDays
    const scheduleDoubleDays = normalizeAvailableDays(profile.scheduleProfile?.doubleSessionDays)
      .filter((day) => trainingDays.includes(day))
    const hasCurrentScheduleDays = scheduleDays.length > 0
    const doubleSessionDays = hasCurrentScheduleDays
      ? scheduleDoubleDays
      : (wizard.doubleSessionDays ?? []).filter((day) => trainingDays.includes(day))
    const allowDoubleSession = hasCurrentScheduleDays
      ? doubleSessionDays.length > 0
      : doubleSessionDays.length > 0 || wizard.allowDoubleSession
    const scheduleConstraints = profile.scheduleProfile?.constraints ?? wizard.scheduleConstraints
    const maxSessionsPerWeek = allowDoubleSession
      ? Math.min(
          trainingDays.length + (
            hasCurrentScheduleDays
              ? doubleSessionDays.length
              : Math.max(doubleSessionDays.length, wizard.allowDoubleSession ? trainingDays.length : 0)
          ),
          MAX_WEEKLY_SESSIONS,
        )
      : Math.min(trainingDays.length, MAX_WEEKLY_SESSIONS)
    const sessionsPerWeek = hasCurrentScheduleDays
      ? deriveScheduleSessionsPerWeek(trainingDays, doubleSessionDays, profile.scheduleProfile?.sessionsPerWeek, Math.max(1, maxSessionsPerWeek))
      // Cap the wizard target to the real day/double capacity. We only clamp the
      // upper bound (no floor) so explicit low-volume wizards keep their value,
      // while an over-capacity wizard can no longer outrun the available slots
      // and crash the deterministic fallback builder.
      : Math.min(Math.max(1, wizard.sessionsPerWeek), Math.max(1, maxSessionsPerWeek))
    return {
      trainingDays,
      doubleSessionDays,
      sessionsPerWeek,
      maxSessionsPerWeek: Math.max(1, maxSessionsPerWeek),
      sessionDurationMins: wizard.sessionDurationMins,
      allowDoubleSession,
      allowedSports,
      primarySport,
      competitiveLevel,
      trainingPriority,
      injuryNotes: profile.recoveryProfile?.restrictions ?? wizard.injuryNotes,
      scheduleConstraints,
      currentFitnessLevel: wizard.currentFitnessLevel,
      currentFatigue: wizard.currentFatigue,
      fromWizard: true,
      configSource: 'wizard',
    }
  }

  const derivedDays = normalizeAvailableDays(profile.scheduleProfile?.availableDays)
  const trainingDays = derivedDays.length > 0 ? derivedDays : [...DEFAULT_TRAINING_DAYS]
  const doubleSessionDays = normalizeAvailableDays(profile.scheduleProfile?.doubleSessionDays)
    .filter((day) => trainingDays.includes(day))
  const hasScheduleSignal = derivedDays.length > 0 || Boolean(profile.scheduleProfile)
  const maxSessionsPerWeek = resolveMaxSessionsPerWeek(
    trainingDays,
    profile.scheduleProfile?.doubleSessionDays,
  )
  const sessionsPerWeek = hasScheduleSignal
    ? deriveScheduleSessionsPerWeek(trainingDays, doubleSessionDays, profile.scheduleProfile?.sessionsPerWeek, maxSessionsPerWeek)
    : DEFAULT_SESSIONS_PER_WEEK

  return {
    trainingDays,
    doubleSessionDays,
    sessionsPerWeek,
    maxSessionsPerWeek,
    sessionDurationMins: DEFAULT_SESSION_DURATION_MINS,
    allowDoubleSession: doubleSessionDays.length > 0,
    allowedSports,
    primarySport,
    competitiveLevel,
    trainingPriority,
    injuryNotes: profile.recoveryProfile?.restrictions,
    scheduleConstraints: profile.scheduleProfile?.constraints,
    currentFitnessLevel: DEFAULT_FITNESS_LEVEL,
    currentFatigue: DEFAULT_FATIGUE_LEVEL,
    fromWizard: false,
    configSource: hasScheduleSignal ? 'schedule' : 'defaults',
  }
}

function resolveConfigGoalEvent(profile: AthleteProfile): NonNullable<AthleteProfile['goalEvents']>[number] | undefined {
  const goalEventId = profile.planWizardConfig?.goalEventId
  if (goalEventId) {
    const selected = profile.goalEvents?.find((event) => event.id === goalEventId)
    if (selected) return selected
  }
  return profile.goalEvents?.find((event) => event.priority === 'primary') ?? profile.goalEvents?.[0]
}

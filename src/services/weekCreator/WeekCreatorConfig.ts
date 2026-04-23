import type {
  AthleteProfile,
  DayOfWeek,
  SupportedSport,
  WizardFatigueLevel,
  WizardFitnessLevel,
} from '../../types'
import { getAllowedPlanningSports, getPlanningPrimarySport } from '../planningConstraints'
import { getEnabledSports, normalizeSport } from '../../utils/athlete'

export interface WeekCreatorEffectiveConfig {
  trainingDays: DayOfWeek[]
  sessionsPerWeek: number
  sessionDurationMins: number
  allowDoubleSession: boolean
  allowedSports: SupportedSport[]
  primarySport?: SupportedSport
  injuryNotes?: string
  currentFitnessLevel: WizardFitnessLevel
  currentFatigue: WizardFatigueLevel
  /** Whether the config was derived from a plan wizard; false means fallback defaults. */
  fromWizard: boolean
  configSource: 'wizard' | 'schedule' | 'defaults'
}

const DEFAULT_TRAINING_DAYS: DayOfWeek[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
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
    const mapped = SPANISH_DAY_MAP[key]
      ?? (DEFAULT_TRAINING_DAYS.includes(raw as DayOfWeek) ? (raw as DayOfWeek) : undefined)
    if (mapped) seen.add(mapped)
  }
  return Array.from(seen)
}

function resolveAllowedSports(profile: AthleteProfile | null | undefined): SupportedSport[] {
  const configuredSports = getAllowedPlanningSports(profile)
  if (configuredSports.length > 0) return configuredSports

  const inferredPrimary = getPlanningPrimarySport(profile)
  if (inferredPrimary) return [inferredPrimary]

  const enabledSports = getEnabledSports(profile)
  if (enabledSports.length > 0) return [enabledSports[0]]

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
      sessionsPerWeek: DEFAULT_SESSIONS_PER_WEEK,
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
  const primarySport = getPlanningPrimarySport(profile) ?? allowedSports[0]
  const wizard = profile.planWizardConfig

  if (wizard) {
    return {
      trainingDays: wizard.trainingDays.length > 0 ? [...wizard.trainingDays] : [...DEFAULT_TRAINING_DAYS],
      sessionsPerWeek: wizard.sessionsPerWeek,
      sessionDurationMins: wizard.sessionDurationMins,
      allowDoubleSession: wizard.allowDoubleSession,
      allowedSports,
      primarySport,
      injuryNotes: wizard.injuryNotes,
      currentFitnessLevel: wizard.currentFitnessLevel,
      currentFatigue: wizard.currentFatigue,
      fromWizard: true,
      configSource: 'wizard',
    }
  }

  const derivedDays = normalizeAvailableDays(profile.scheduleProfile?.availableDays)
  const trainingDays = derivedDays.length > 0 ? derivedDays : [...DEFAULT_TRAINING_DAYS]
  const hasScheduleSignal = derivedDays.length > 0 || Boolean(profile.scheduleProfile)
  const sessionsPerWeek = hasScheduleSignal
    ? Math.min(Math.max(trainingDays.length, DEFAULT_SESSIONS_PER_WEEK), 4)
    : DEFAULT_SESSIONS_PER_WEEK

  return {
    trainingDays,
    sessionsPerWeek,
    sessionDurationMins: DEFAULT_SESSION_DURATION_MINS,
    allowDoubleSession: Boolean(profile.scheduleProfile?.doubleSessionDays?.length),
    allowedSports,
    primarySport,
    injuryNotes: profile.recoveryProfile?.restrictions,
    currentFitnessLevel: DEFAULT_FITNESS_LEVEL,
    currentFatigue: DEFAULT_FATIGUE_LEVEL,
    fromWizard: false,
    configSource: hasScheduleSignal ? 'schedule' : 'defaults',
  }
}

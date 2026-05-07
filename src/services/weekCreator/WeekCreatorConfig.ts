import type {
  AthleteProfile,
  DayOfWeek,
  SupportedSport,
  WizardFatigueLevel,
  WizardFitnessLevel,
} from '../../types'
import { getAllowedPlanningSports } from '../planningConstraints'
import { getEnabledSports, getPrimarySportNormalized, normalizeSport } from '../../utils/athlete'

export interface WeekCreatorEffectiveConfig {
  trainingDays: DayOfWeek[]
  sessionsPerWeek: number
  maxSessionsPerWeek: number
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
const MAX_SESSIONS_PER_WEEK = 6
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

function clampSessionsPerWeek(value: number, maxSessionsPerWeek: number): number {
  return Math.min(Math.max(Math.round(value), DEFAULT_SESSIONS_PER_WEEK), maxSessionsPerWeek)
}

function resolveMaxSessionsPerWeek(trainingDays: DayOfWeek[], rawDoubleSessionDays?: string[]): number {
  const trainingDaySet = new Set(trainingDays)
  const doubleDays = normalizeAvailableDays(rawDoubleSessionDays)
    .filter((day) => trainingDaySet.has(day))
  const capacity = trainingDays.length + new Set(doubleDays).size
  return Math.max(1, Math.min(capacity, MAX_SESSIONS_PER_WEEK))
}

function deriveScheduleSessionsPerWeek(
  trainingDays: DayOfWeek[],
  explicitSessionsPerWeek: number | undefined,
  maxSessionsPerWeek: number,
): number {
  if (explicitSessionsPerWeek != null && Number.isFinite(explicitSessionsPerWeek)) {
    return clampSessionsPerWeek(explicitSessionsPerWeek, maxSessionsPerWeek)
  }

  const derived = trainingDays.length >= 5
    ? trainingDays.length - 1
    : Math.max(trainingDays.length, DEFAULT_SESSIONS_PER_WEEK)
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
  }
  const wordMatch = normalized.match(/\b(dos|tres|cuatro|cinco|seis)\s*(?:sesiones|entrenamientos|sesion(?:es)?|dias?\s+de\s+entreno)\b/)
  return wordMatch ? wordToNumber[wordMatch[1]] : undefined
}

function resolveAllowedSports(profile: AthleteProfile | null | undefined): SupportedSport[] {
  const enabledSports = getEnabledSports(profile)
  if (enabledSports.length > 0) return enabledSports

  const inferredPrimary = getPrimarySportNormalized(profile)
  if (inferredPrimary) return [inferredPrimary]

  const configuredSports = getAllowedPlanningSports(profile)
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
      sessionsPerWeek: DEFAULT_SESSIONS_PER_WEEK,
      maxSessionsPerWeek: MAX_SESSIONS_PER_WEEK,
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
  const wizard = profile.planWizardConfig

  if (wizard) {
    const wizardTrainingDays = wizard.trainingDays.length > 0 ? [...wizard.trainingDays] : [...DEFAULT_TRAINING_DAYS]
    const maxSessionsPerWeek = Math.min(
      wizardTrainingDays.length * (wizard.allowDoubleSession ? 2 : 1),
      MAX_SESSIONS_PER_WEEK,
    )
    return {
      trainingDays: wizardTrainingDays,
      sessionsPerWeek: wizard.sessionsPerWeek,
      maxSessionsPerWeek: Math.max(1, maxSessionsPerWeek),
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
  const maxSessionsPerWeek = resolveMaxSessionsPerWeek(trainingDays, profile.scheduleProfile?.doubleSessionDays)
  const sessionsPerWeek = hasScheduleSignal
    ? deriveScheduleSessionsPerWeek(trainingDays, profile.scheduleProfile?.sessionsPerWeek, maxSessionsPerWeek)
    : DEFAULT_SESSIONS_PER_WEEK

  return {
    trainingDays,
    sessionsPerWeek,
    maxSessionsPerWeek,
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

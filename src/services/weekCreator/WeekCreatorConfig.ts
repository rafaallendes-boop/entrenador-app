import type {
  AthleteProfile,
  DayOfWeek,
  SupportedSport,
  WizardFatigueLevel,
  WizardFitnessLevel,
} from '../../types'
import { getAllowedPlanningSports, getPlanningPrimarySport } from '../planningConstraints'

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

export function resolveWeekCreatorConfig(profile: AthleteProfile | null | undefined): WeekCreatorEffectiveConfig | null {
  if (!profile) return null

  const allowedSports = getAllowedPlanningSports(profile)
  if (allowedSports.length === 0) return null

  const primarySport = getPlanningPrimarySport(profile)
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
    }
  }

  const derivedDays = normalizeAvailableDays(profile.scheduleProfile?.availableDays)
  const trainingDays = derivedDays.length > 0 ? derivedDays : [...DEFAULT_TRAINING_DAYS]
  const sessionsPerWeek = Math.min(Math.max(trainingDays.length, 3), 4)

  return {
    trainingDays,
    sessionsPerWeek,
    sessionDurationMins: 60,
    allowDoubleSession: Boolean(profile.scheduleProfile?.doubleSessionDays?.length),
    allowedSports,
    primarySport,
    injuryNotes: profile.recoveryProfile?.restrictions,
    currentFitnessLevel: 'normal',
    currentFatigue: 'normal',
    fromWizard: false,
  }
}

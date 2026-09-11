import { isImpactPowerExercise, type ExerciseDefinition } from './exerciseLibrary'
import type { StrengthContext } from './strengthSelector'

export function isFinisherExercise(exercise: ExerciseDefinition): boolean {
  return exercise.athleticPrescription?.kind === 'finisher'
    || exercise.tags.includes('cardio_specific') || exercise.tags.includes('court_conditioning')
}

/** Evita que el patrón locomotion intercambie fuerza, saltos, escalera e intervalos. */
export function isAthleticReplacementCompatible(original: ExerciseDefinition, candidate: ExerciseDefinition): boolean {
  if (!original.athleticPrescription && !candidate.athleticPrescription) return true
  if (isFinisherExercise(original) || isFinisherExercise(candidate)) {
    return isFinisherExercise(original) && isFinisherExercise(candidate)
  }
  const isCoordination = (exercise: ExerciseDefinition) => exercise.athleticPrescription?.kind === 'coordination'
    || exercise.tags.includes('court_footwork')
  if (isCoordination(original) || isCoordination(candidate)) return isCoordination(original) && isCoordination(candidate)
  return (original.intensityType === 'power') === (candidate.intensityType === 'power')
}

/**
 * Lo que la fatiga aguda y la proximidad competitiva tienen que poder frenar.
 *
 * El predicado va por el perfil declarado del catálogo —`isImpactPowerExercise`,
 * que vive en la biblioteca— y no por si el ejercicio recibió tabla de dosis.
 * Con la tabla como criterio, la ventana de competencia bloqueaba un pogo y
 * dejaba pasar `depth_jump`, `drop_jump` y `barbell_jump_squat`, que son justo
 * los de mayor demanda.
 */
function isAcuteRiskWork(exercise: ExerciseDefinition): boolean {
  return isImpactPowerExercise(exercise) || isFinisherExercise(exercise)
}

/** La carga explosiva y los intervalos no se añaden para completar cantidad. */
export function isAthleticWorkAllowed(exercise: ExerciseDefinition, context: StrengthContext): boolean {
  const withinDeclaredPhases = exercise.appropriateForPhases?.includes(context.phase) ?? true

  // Coordinación: sin impacto ni carga externa. Sólo respeta la fase declarada.
  if (exercise.athleticPrescription?.kind === 'coordination') return withinDeclaredPhases

  if (!isAcuteRiskWork(exercise) && !exercise.athleticPrescription) return true
  if (!withinDeclaredPhases) return false

  // La fase permitida la declara cada ejercicio en `appropriateForPhases`; acá
  // sólo va lo agudo, que ninguna fase puede autorizar por sí sola.
  if (context.fatigueLevel >= 7) return false
  if (context.competitionSoon) return false
  if (context.daysToCompetition != null && context.daysToCompetition >= 0 && context.daysToCompetition <= 4) return false
  if (context.requireExtraRecovery) return false
  if (context.strengthAcwr?.status === 'risk') return false

  return !isFinisherExercise(exercise) || (context.sessionDurationMin ?? 50) >= 45
}

export function athleticPrescriptionNotes(exercise: ExerciseDefinition): string | undefined {
  const dose = exercise.athleticPrescription
  if (!dose) return undefined
  const rest = dose.restSeconds > 0 ? ` Descansa ${dose.restSeconds}s entre series.` : ''
  const position = dose.kind === 'finisher' ? 'Finisher al final. '
    : dose.kind === 'coordination' ? 'Coordinación de apoyos. ' : 'Potencia con recuperaciones completas. '
  return `${position}${dose.cues}${rest}`
}

/**
 * Preferencias expresadas en el objetivo; no sustituyen los filtros duros.
 *
 * El patrón de salto horizontal exige nombrar el salto. `distancia` y `metros`
 * sueltos pertenecen al vocabulario de carrera —«correr 10 mil metros», «ganar
 * distancia en la carrera»— y ascendían pliometría en una sesión de apoyo a un
 * fondista. Running es una disciplina de primera clase de la app.
 */
const HORIZONTAL_POWER_GOAL = /salt\w*\s+horizontal|horizontal\s+jump|multisalto|triple\s+salto|bounding|distancia\s+de\s+salto|saltar\s+(mas\s+)?lejos/

export function athleticPreferenceScore(exercise: ExerciseDefinition, goal: string): number {
  const value = goal.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/mini\s*valla|mini\s*hurdle|vallas/.test(value) && exercise.equipment.includes('mini_hurdles')) return 45
  if (HORIZONTAL_POWER_GOAL.test(value) && exercise.athleticPrescription?.kind === 'horizontal_power') return 40
  if (/escalera|ladder/.test(value) && exercise.athleticPrescription?.kind === 'coordination') return 15
  return 0
}

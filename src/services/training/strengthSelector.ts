import type { ExerciseGroup, Session } from '../../types'
import {
  findStrengthExerciseByName,
  getExerciseGroupForDefinition,
  normalizeStrengthExerciseKey,
  STRENGTH_EXERCISE_LIBRARY,
  type EquipmentType,
  type ExerciseDefinition,
  type ExperienceLevel,
  type MovementPattern,
} from './exerciseLibrary'

export type StrengthPhase = 'base' | 'build' | 'peak' | 'taper' | 'transition'
export type StrengthSportProfile = 'strength_primary' | 'hybrid' | 'sport_support'

export interface StrengthContext {
  fatigueLevel: number
  phase: StrengthPhase
  recentExercises: string[]
  goal: string
  sportProfile: StrengthSportProfile
  primarySport?: string
  experienceLevel?: ExperienceLevel
  availableEquipment?: string[]
  sessionDurationMin?: number
  competitionSoon?: boolean
  daysToCompetition?: number
}

export interface StrengthSelectionExercise {
  name: string
  sets: number
  reps: number | string
  intensity: 'light' | 'moderate' | 'moderate-heavy' | 'heavy' | 'explosive' | 'controlled'
  notes?: string
  group?: ExerciseGroup
}

interface ScoredExercise {
  exercise: ExerciseDefinition
  score: number
}

export function selectStrengthSession(
  context: StrengthContext,
): { focus: string; exercises: StrengthSelectionExercise[] } {
  const normalizedEquipment = normalizeEquipment(context.availableEquipment)
  const recentSet = new Set(context.recentExercises.map(normalizeStrengthExerciseKey))
  const equipmentPool = filterByEquipment(STRENGTH_EXERCISE_LIBRARY, normalizedEquipment)
  const fatiguePool = filterByFatigue(equipmentPool, context)
  const phasePool = filterByPhase(fatiguePool, context)
  const experiencePool = filterByExperience(phasePool, context)
  const withoutRecent = avoidRecentExercises(experiencePool, recentSet)
  const pool = withoutRecent.length >= 6 ? withoutRecent : experiencePool
  const selected = pickStrengthStructure(pool, context, recentSet)

  const fallback = selected.length >= 3
    ? selected
    : pickStrengthStructure(filterByFatigue(equipmentPool, { ...context, fatigueLevel: Math.min(context.fatigueLevel, 6) }), context, recentSet)

  const finalSelection = fallback.slice(0, 6)

  return {
    focus: deriveStrengthFocus(finalSelection, context),
    exercises: finalSelection.map((exercise, index) => buildSelectionExercise(exercise, context, index)),
  }
}

export function extractRecentStrengthExercises(historicalSessions: Session[]): string[] {
  const strengthSessions = [...historicalSessions]
    .filter((session) =>
      session.type === 'strength' &&
      (session.status === 'completed' || session.status === 'adjusted') &&
      session.exercises &&
      session.exercises.length > 0,
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.timeBlock.localeCompare(a.timeBlock))
    .slice(0, 3)

  return strengthSessions.flatMap((session) =>
    (session.exercises ?? []).map((exercise) =>
      findStrengthExerciseByName(exercise.name)?.id ?? normalizeStrengthExerciseKey(exercise.name),
    ),
  )
}

export function filterByFatigue(
  exercises: ExerciseDefinition[],
  context: StrengthContext,
): ExerciseDefinition[] {
  if (context.competitionSoon || context.fatigueLevel >= 8) {
    return exercises.filter((exercise) =>
      exercise.intensityType !== 'power' &&
      exercise.intensityType !== 'strength' ||
      exercise.tags.includes('beginner_friendly') ||
      exercise.tags.includes('recovery'),
    )
  }

  if (context.fatigueLevel >= 7) {
    return exercises.filter((exercise) =>
      exercise.intensityType === 'stability' ||
      exercise.intensityType === 'recovery' ||
      exercise.intensityType === 'hypertrophy',
    )
  }

  return exercises
}

export function filterByPhase(
  exercises: ExerciseDefinition[],
  context: StrengthContext,
): ExerciseDefinition[] {
  switch (context.phase) {
    case 'taper':
      return exercises.filter((exercise) =>
        exercise.intensityType !== 'hypertrophy' ||
        exercise.category === 'upper' ||
        exercise.tags.includes('recovery'),
      )
    case 'peak':
      return exercises.filter((exercise) =>
        !exercise.tags.includes('general_fitness') || exercise.intensityType === 'power',
      )
    case 'transition':
      return exercises.filter((exercise) =>
        exercise.intensityType !== 'strength' || exercise.tags.includes('beginner_friendly'),
      )
    case 'base':
    case 'build':
    default:
      return exercises
  }
}

export function filterByEquipment(
  exercises: ExerciseDefinition[],
  availableEquipment: EquipmentType[],
): ExerciseDefinition[] {
  return exercises.filter((exercise) =>
    exercise.equipment.some((item) => availableEquipment.includes(item)),
  )
}

export function avoidRecentExercises(
  exercises: ExerciseDefinition[],
  recentExercises: Set<string>,
): ExerciseDefinition[] {
  return exercises.filter((exercise) => !recentExercises.has(normalizeStrengthExerciseKey(exercise.id)))
}

export function pickStrengthStructure(
  exercises: ExerciseDefinition[],
  context: StrengthContext,
  recentExercises: Set<string>,
): ExerciseDefinition[] {
  const scored = scoreExercises(exercises, context, recentExercises)
  const selected: ExerciseDefinition[] = []
  const selectedMovements = new Set<MovementPattern>()
  const selectedIds = new Set<string>()
  const targetCount = getTargetExerciseCount(context)

  const mainLift = pickFirst(scored, context, (exercise) =>
    exercise.intensityType === 'strength' &&
    exercise.category !== 'core' &&
    !recentExercises.has(normalizeStrengthExerciseKey(exercise.id)),
  )
  if (mainLift) {
    selected.push(mainLift)
    selectedMovements.add(mainLift.movement)
    selectedIds.add(mainLift.id)
  }

  const powerNeeded = shouldIncludePower(context)
  if (powerNeeded) {
    const powerExercise = pickFirst(scored, context, (exercise) =>
      exercise.intensityType === 'power' &&
      !selectedIds.has(exercise.id),
    )
    if (powerExercise) {
      selected.push(powerExercise)
      selectedMovements.add(powerExercise.movement)
      selectedIds.add(powerExercise.id)
    }
  }

  const accessory = pickFirst(scored, context, (exercise) =>
    !selectedIds.has(exercise.id) &&
    exercise.category !== 'core' &&
    exercise.intensityType !== 'recovery' &&
    (!selectedMovements.has(exercise.movement) || context.sportProfile === 'strength_primary'),
  )
  if (accessory) {
    selected.push(accessory)
    selectedMovements.add(accessory.movement)
    selectedIds.add(accessory.id)
  }

  const unilateralOrStability = pickFirst(scored, context, (exercise) =>
    !selectedIds.has(exercise.id) &&
    (exercise.unilateral || exercise.intensityType === 'stability') &&
    exercise.category !== 'core',
  )
  if (unilateralOrStability) {
    selected.push(unilateralOrStability)
    selectedMovements.add(unilateralOrStability.movement)
    selectedIds.add(unilateralOrStability.id)
  }

  const trunk = pickFirst(scored, context, (exercise) =>
    !selectedIds.has(exercise.id) &&
    exercise.category === 'core',
  )
  if (trunk) {
    selected.push(trunk)
    selectedIds.add(trunk.id)
  }

  const upperOptional = pickFirst(scored, context, (exercise) =>
    !selectedIds.has(exercise.id) &&
    exercise.category === 'upper' &&
    (context.sportProfile !== 'sport_support' || context.competitionSoon || context.primarySport === 'running'),
  )
  if (upperOptional && selected.length < targetCount) {
    selected.push(upperOptional)
    selectedIds.add(upperOptional.id)
  }

  for (const { exercise } of scored) {
    if (selected.length >= targetCount) break
    if (selectedIds.has(exercise.id)) continue
    selected.push(exercise)
    selectedIds.add(exercise.id)
  }

  return selected.slice(0, targetCount)
}

function scoreExercises(
  exercises: ExerciseDefinition[],
  context: StrengthContext,
  recentExercises: Set<string>,
): ScoredExercise[] {
  const goal = context.goal.toLowerCase()

  return exercises
    .map((exercise) => {
      let score = 0

      if (context.sportProfile === 'strength_primary') {
        if (exercise.intensityType === 'strength') score += 6
        if (exercise.intensityType === 'hypertrophy') score += 4
        if (exercise.tags.includes('compound')) score += 3
      }

      if (context.sportProfile === 'hybrid') {
        if (exercise.tags.includes('athletic_transfer')) score += 5
        if (exercise.unilateral) score += 2
        if (exercise.intensityType === 'stability') score += 2
      }

      if (context.sportProfile === 'sport_support') {
        if (exercise.tags.includes('athletic_transfer')) score += 6
        if (exercise.intensityType === 'stability' || exercise.category === 'core') score += 4
        if (exercise.intensityType === 'hypertrophy' && exercise.category === 'lower') score -= 2
      }

      switch (context.phase) {
        case 'base':
          if (exercise.intensityType === 'hypertrophy') score += 4
          if (exercise.intensityType === 'stability') score += 3
          break
        case 'build':
          if (exercise.intensityType === 'strength') score += 5
          if (exercise.intensityType === 'power') score += 3
          break
        case 'peak':
          if (exercise.intensityType === 'power') score += 4
          if (exercise.intensityType === 'strength') score += 2
          if (exercise.intensityType === 'hypertrophy') score -= 2
          break
        case 'taper':
          if (exercise.intensityType === 'stability' || exercise.intensityType === 'recovery') score += 5
          if (exercise.intensityType === 'hypertrophy') score -= 4
          if (exercise.category === 'lower' && exercise.unilateral) score -= 2
          break
        case 'transition':
          if (exercise.intensityType === 'recovery' || exercise.intensityType === 'stability') score += 5
          if (exercise.tags.includes('general_fitness')) score += 2
          if (exercise.intensityType === 'strength') score -= 3
          break
      }

      if (context.fatigueLevel >= 7) {
        if (exercise.intensityType === 'stability' || exercise.intensityType === 'recovery') score += 5
        if (exercise.intensityType === 'strength') score -= 5
        if (exercise.intensityType === 'power') score -= 4
      } else if (context.fatigueLevel <= 3) {
        if (exercise.intensityType === 'strength' || exercise.intensityType === 'power') score += 2
      }

      if (context.competitionSoon) {
        if (exercise.intensityType === 'recovery' || exercise.intensityType === 'stability') score += 4
        if (exercise.category === 'upper') score += 2
        if (exercise.category === 'lower' && exercise.intensityType !== 'recovery') score -= 4
      }

      if (goal.includes('upper') && exercise.category === 'upper') score += 5
      if ((goal.includes('lower') || goal.includes('pierna')) && exercise.category === 'lower') score += 5
      if (goal.includes('core') || goal.includes('trunk')) {
        if (exercise.category === 'core') score += 5
      }
      if (goal.includes('poten') && exercise.intensityType === 'power') score += 5
      if (goal.includes('hipert') && exercise.intensityType === 'hypertrophy') score += 5
      if (goal.includes('fuerza') && exercise.intensityType === 'strength') score += 5
      if (goal.includes('recuper') && exercise.intensityType === 'recovery') score += 5

      if (context.primarySport === 'running' || context.primarySport === 'cycling') {
        if (exercise.category === 'core') score += 2
        if (exercise.unilateral) score += 2
      }
      if (context.primarySport === 'squash') {
        if (exercise.tags.includes('athletic_transfer')) score += 2
        if (exercise.movement === 'rotation') score += 2
      }

      if (recentExercises.has(normalizeStrengthExerciseKey(exercise.id))) score -= 10

      return { exercise, score }
    })
    .sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name))
}

function deriveStrengthFocus(
  exercises: ExerciseDefinition[],
  context: StrengthContext,
): string {
  if (context.competitionSoon || context.phase === 'taper') {
    return 'activation + trunk stability'
  }
  if (exercises.length === 0) {
    return context.sportProfile === 'strength_primary'
      ? 'full body strength'
      : 'strength support + trunk stability'
  }

  const main = exercises[0]
  const hasCore = exercises.some((exercise) => exercise.category === 'core')
  const hasPower = exercises.some((exercise) => exercise.intensityType === 'power')

  if (context.sportProfile === 'strength_primary') {
    if (main.category === 'upper') return hasCore ? 'upper strength + trunk support' : 'upper strength'
    if (main.category === 'lower') return hasCore ? 'lower strength + trunk stability' : 'lower strength'
    return hasPower ? 'full body strength + power' : 'full body strength'
  }

  if (context.sportProfile === 'hybrid') {
    return hasPower
      ? 'full body strength + athletic transfer'
      : 'efficient strength + trunk stability'
  }

  return hasCore
    ? 'sport support + trunk stability'
    : 'sport support strength'
}

function buildSelectionExercise(
  exercise: ExerciseDefinition,
  context: StrengthContext,
  index: number,
): StrengthSelectionExercise {
  const prescription = getPrescription(exercise, context, index)

  return {
    name: exercise.name,
    sets: prescription.sets,
    reps: prescription.reps,
    intensity: prescription.intensity,
    notes: buildExerciseNotes(exercise, context, prescription.intensity, index),
    group: getExerciseGroupForDefinition(exercise),
  }
}

function getPrescription(
  exercise: ExerciseDefinition,
  context: StrengthContext,
  index: number,
): {
  sets: number
  reps: number | string
  intensity: StrengthSelectionExercise['intensity']
} {
  const isLead = index === 0

  switch (exercise.intensityType) {
    case 'strength':
      if (context.competitionSoon || context.phase === 'taper' || context.fatigueLevel >= 7) {
        return { sets: 3, reps: 5, intensity: 'moderate' }
      }
      if (context.phase === 'peak') return { sets: 4, reps: 3, intensity: isLead ? 'heavy' : 'moderate-heavy' }
      if (context.phase === 'build') return { sets: 4, reps: 5, intensity: isLead ? 'moderate-heavy' : 'moderate' }
      if (context.phase === 'base') return { sets: 4, reps: 6, intensity: 'moderate' }
      return { sets: 3, reps: 5, intensity: 'moderate' }
    case 'hypertrophy':
      if (context.fatigueLevel >= 7 || context.competitionSoon) return { sets: 2, reps: 10, intensity: 'light' }
      if (context.phase === 'build') return { sets: 4, reps: 8, intensity: 'moderate' }
      if (context.phase === 'base') return { sets: 3, reps: 10, intensity: 'moderate' }
      if (context.phase === 'peak') return { sets: 3, reps: 8, intensity: 'moderate' }
      return { sets: 3, reps: 10, intensity: 'light' }
    case 'power':
      if (context.competitionSoon || context.phase === 'taper') return { sets: 3, reps: 3, intensity: 'explosive' }
      if (context.fatigueLevel >= 7) return { sets: 2, reps: 3, intensity: 'controlled' }
      return { sets: 4, reps: 3, intensity: 'explosive' }
    case 'stability':
      if (exercise.id === 'farmer_carry') return { sets: 3, reps: '30s', intensity: 'controlled' }
      if (exercise.id === 'plank' || exercise.id === 'side_plank') return { sets: 3, reps: '30s', intensity: 'controlled' }
      return { sets: 3, reps: 10, intensity: 'controlled' }
    case 'recovery':
    default:
      return { sets: 2, reps: 10, intensity: 'light' }
  }
}

function buildExerciseNotes(
  exercise: ExerciseDefinition,
  context: StrengthContext,
  intensity: StrengthSelectionExercise['intensity'],
  index: number,
): string | undefined {
  if (context.competitionSoon) {
    if (exercise.category === 'lower') return 'Activation only. Leave reps in reserve and avoid soreness.'
    return 'Keep it crisp and low-fatigue before competition.'
  }
  if (context.fatigueLevel >= 7) {
    return 'Prioritize clean execution and stop well before grindy reps.'
  }
  if (exercise.intensityType === 'power') {
    return 'Every rep should look fast. Cut the set if speed drops.'
  }
  if (index === 0 && context.sportProfile === 'strength_primary') {
    return intensity === 'heavy'
      ? 'Main lift of the day. Prioritize bar speed and repeatable technique.'
      : 'Main lift of the day. Build quality volume without missing reps.'
  }
  if (exercise.unilateral) {
    return 'Use controlled tempo and match both sides.'
  }
  return undefined
}

function shouldIncludePower(context: StrengthContext): boolean {
  if (context.fatigueLevel >= 7) return false
  if (context.competitionSoon && context.sportProfile === 'sport_support') return false
  return context.phase === 'build' || context.phase === 'peak'
}

function getTargetExerciseCount(context: StrengthContext): number {
  if (context.competitionSoon || context.phase === 'taper') return 3
  if (context.fatigueLevel >= 7) return 3
  if (context.sportProfile === 'strength_primary') {
    if (context.phase === 'base' || context.phase === 'build') return 5
    return 4
  }
  if (context.sportProfile === 'hybrid') return context.sessionDurationMin && context.sessionDurationMin < 50 ? 4 : 5
  return 4
}

function filterByExperience(
  exercises: ExerciseDefinition[],
  context: StrengthContext,
): ExerciseDefinition[] {
  if (context.experienceLevel === 'advanced') return exercises
  if (context.experienceLevel === 'intermediate') {
    return exercises.filter((exercise) => exercise.difficulty !== 'advanced')
  }
  return exercises.filter((exercise) => exercise.difficulty !== 'advanced' && !exercise.tags.includes('advanced'))
}

function pickFirst(
  scored: ScoredExercise[],
  context: StrengthContext,
  predicate: (exercise: ExerciseDefinition) => boolean,
): ExerciseDefinition | undefined {
  return scored.find(({ exercise }) => predicate(exercise))?.exercise
    ?? scored.find(({ exercise }) =>
      predicate(exercise) ||
      (context.sportProfile === 'strength_primary' && exercise.intensityType === 'strength'),
    )?.exercise
}

function normalizeEquipment(availableEquipment?: string[]): EquipmentType[] {
  if (!availableEquipment || availableEquipment.length === 0) {
    return ['barbell', 'dumbbell', 'bodyweight', 'machine', 'cable', 'kettlebell', 'medball', 'bands']
  }

  const mapped = availableEquipment
    .map((item) => item.toLowerCase().trim())
    .flatMap<EquipmentType>((item) => {
      if (item.includes('bar')) return ['barbell']
      if (item.includes('manc') || item.includes('dumb')) return ['dumbbell']
      if (item.includes('body') || item.includes('peso')) return ['bodyweight']
      if (item.includes('machine') || item.includes('maquina')) return ['machine']
      if (item.includes('cable') || item.includes('polea')) return ['cable']
      if (item.includes('kettle')) return ['kettlebell']
      if (item.includes('med')) return ['medball']
      if (item.includes('band')) return ['bands']
      return []
    })

  return mapped.length > 0 ? [...new Set(mapped)] : ['bodyweight', 'dumbbell', 'bands']
}

export function runStrengthSelectorSmokeChecks(): string[] {
  const outputs: string[] = []

  const strengthPrimary = selectStrengthSession({
    phase: 'build',
    fatigueLevel: 3,
    recentExercises: ['back_squat', 'bench_press'],
    goal: 'desarrollar fuerza lower y trunk',
    sportProfile: 'strength_primary',
    experienceLevel: 'intermediate',
    availableEquipment: ['barbell', 'dumbbell', 'cable', 'bodyweight'],
    sessionDurationMin: 70,
    competitionSoon: false,
  })
  outputs.push(`strength_primary=${strengthPrimary.exercises.map((exercise) => `${exercise.name} ${exercise.sets}x${exercise.reps}`).join(' | ')}`)

  const hybrid = selectStrengthSession({
    phase: 'base',
    fatigueLevel: 4,
    recentExercises: ['romanian_deadlift', 'pull_up'],
    goal: 'fuerza util y transferencia atletica',
    sportProfile: 'hybrid',
    primarySport: 'squash',
    experienceLevel: 'intermediate',
    availableEquipment: ['barbell', 'dumbbell', 'medball', 'bodyweight'],
    sessionDurationMin: 55,
    competitionSoon: false,
  })
  outputs.push(`hybrid=${hybrid.exercises.map((exercise) => `${exercise.name} ${exercise.sets}x${exercise.reps}`).join(' | ')}`)

  const support = selectStrengthSession({
    phase: 'taper',
    fatigueLevel: 5,
    recentExercises: ['bulgarian_split_squat', 'hip_thrust'],
    goal: 'apoyar competencia de squash sin cargar piernas',
    sportProfile: 'sport_support',
    primarySport: 'squash',
    experienceLevel: 'intermediate',
    availableEquipment: ['dumbbell', 'bands', 'bodyweight', 'medball'],
    sessionDurationMin: 40,
    competitionSoon: true,
    daysToCompetition: 2,
  })
  outputs.push(`sport_support=${support.exercises.map((exercise) => `${exercise.name} ${exercise.sets}x${exercise.reps}`).join(' | ')}`)

  const fatigueHigh = selectStrengthSession({
    phase: 'build',
    fatigueLevel: 8,
    recentExercises: [],
    goal: 'mantener fuerza sin castigar',
    sportProfile: 'hybrid',
    primarySport: 'running',
    experienceLevel: 'beginner',
    availableEquipment: ['bands', 'bodyweight', 'dumbbell'],
    sessionDurationMin: 35,
    competitionSoon: false,
  })
  outputs.push(`fatigue_high=${fatigueHigh.exercises.map((exercise) => `${exercise.name} ${exercise.intensity}`).join(' | ')}`)

  const buildA = selectStrengthSession({
    phase: 'build',
    fatigueLevel: 4,
    recentExercises: ['back_squat', 'romanian_deadlift'],
    goal: 'fuerza lower y estabilidad',
    sportProfile: 'strength_primary',
    experienceLevel: 'intermediate',
    availableEquipment: ['barbell', 'dumbbell', 'bodyweight', 'cable'],
    sessionDurationMin: 65,
    competitionSoon: false,
  })
  const buildB = selectStrengthSession({
    phase: 'build',
    fatigueLevel: 4,
    recentExercises: buildA.exercises.map((exercise) => normalizeStrengthExerciseKey(exercise.name)),
    goal: 'fuerza lower y estabilidad',
    sportProfile: 'strength_primary',
    experienceLevel: 'intermediate',
    availableEquipment: ['barbell', 'dumbbell', 'bodyweight', 'cable'],
    sessionDurationMin: 65,
    competitionSoon: false,
  })
  outputs.push(`variation=${buildA.exercises.map((exercise) => exercise.name).join(' / ')} <> ${buildB.exercises.map((exercise) => exercise.name).join(' / ')}`)

  return outputs
}

// TODO: agregar progresion multi-semana por familia y scoring mas fino por nivel del atleta.

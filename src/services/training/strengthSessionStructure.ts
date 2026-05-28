import type { CoachExerciseProposal, Exercise, ExerciseGroup, StrengthProfile } from '../../types'
import { findStrengthExerciseByName, getExerciseGroupForDefinition, type ExerciseDefinition } from './exerciseLibrary'
import {
  buildWarmupRamp,
  computeWeightFromPercent,
  mapExerciseTo1RMReference,
} from './strengthLoadPrescription'

type StrengthExerciseLike = CoachExerciseProposal | Exercise

const BLOCK_ORDER: ExerciseGroup[] = ['core', 'olympic', 'legs', 'push', 'pull', 'other', 'cardio', 'mobility']

export function normalizeStrengthSessionExercises<T extends StrengthExerciseLike>(
  exercises: T[] | undefined,
  options: { durationMin?: number } = {},
): T[] | undefined {
  if (!exercises || exercises.length === 0) return exercises

  const durationMin = options.durationMin ?? 50
  const protocolFiltered = removeProtocolExercisesWhenStrengthWorkExists(exercises)
  const normalized = protocolFiltered.map((exercise) => normalizeStrengthExerciseGroup(exercise))
  const withCore = durationMin >= 45
    ? ensureCoreBlock(normalized)
    : normalized

  return [...withCore].sort((a, b) => {
    const groupDelta = groupRank(a.group) - groupRank(b.group)
    if (groupDelta !== 0) return groupDelta
    return coreRank(a) - coreRank(b)
  })
}

function removeProtocolExercisesWhenStrengthWorkExists<T extends StrengthExerciseLike>(exercises: T[]): T[] {
  const hasStrengthWork = exercises.some((exercise) => !isProtocolExercise(exercise) && inferExerciseGroup(exercise) !== 'mobility')
  if (!hasStrengthWork) return exercises
  return exercises.filter((exercise) => !isProtocolExercise(exercise))
}

export function enhanceStrengthSessionExercises<T extends StrengthExerciseLike>(
  exercises: T[] | undefined,
  options: { durationMin?: number; strengthProfile?: StrengthProfile } = {},
): T[] | undefined {
  const normalized = normalizeStrengthSessionExercises(exercises, options)
  if (!normalized || normalized.length === 0) return normalized

  const firstLoadBearingIndex = normalized.findIndex(isLoadBearingStrengthExercise)

  return normalized.map((exercise, index) => completeStrengthLoadAndEffort(
    exercise,
    options.strengthProfile,
    index === firstLoadBearingIndex,
  ))
}

export function resolveStrengthExerciseBlock(exercise: Pick<StrengthExerciseLike, 'name' | 'group'>): ExerciseGroup {
  const definition = findStrengthExerciseByName(exercise.name)
  return definition ? getStrengthBlockForDefinition(definition) : inferExerciseGroup(exercise)
}

function normalizeStrengthExerciseGroup<T extends StrengthExerciseLike>(exercise: T): T {
  const definition = findStrengthExerciseByName(exercise.name)
  const group = definition ? getStrengthBlockForDefinition(definition) : inferExerciseGroup(exercise)
  const reps = normalizePlankReps(exercise.name, exercise.reps)
  return { ...exercise, group, reps }
}

function normalizePlankReps(name: string, reps: number | string): number | string {
  if (typeof reps !== 'number') return reps
  if (/plancha|plank/i.test(normalizeText(name))) return `${reps}s`
  return reps
}

function getStrengthBlockForDefinition(definition: NonNullable<ReturnType<typeof findStrengthExerciseByName>>): ExerciseGroup {
  if (definition.equipment.includes('ladder') || definition.tags.includes('court_footwork')) return 'cardio'
  return getExerciseGroupForDefinition(definition)
}

function inferExerciseGroup(exercise: Pick<StrengthExerciseLike, 'name' | 'group'>): ExerciseGroup {
  const name = normalizeText(exercise.name)
  if (/\b(escalera|ladder|footwork|shuffle|icky|split\s*step|bici\s+de\s+asalto|assault\s+bike|air\s+bike|trotadora\s+de\s+aire|trotadora\s+curva|air\s+runner|curved\s+treadmill|cinta\s+curva)\b/.test(name)) return 'cardio'
  if (/\b(plancha|plank|dead\s*bug|pallof|copenhagen|core|tronco|anti[-\s]?rot|chop|corte\s+diagonal)\b/.test(name)) return 'core'
  return exercise.group ?? 'other'
}

function ensureCoreBlock<T extends StrengthExerciseLike>(exercises: T[]): T[] {
  const core = exercises.filter((exercise) => exercise.group === 'core')
  if (core.length === 0) {
    return [
      makeCoreExercise<T>('Control de tronco dead bug', 'Zona media: controla pelvis y costillas antes de la fuerza principal.'),
      ...exercises,
    ]
  }

  if (core.length === 1) {
    return [
      makeCoreExercise<T>('Control de tronco dead bug', 'Zona media: anti-extensión y control lumbo-pélvico.'),
      ...exercises,
    ]
  }

  const hasFoundationCore = core.some(isFoundationCore)
  if (hasFoundationCore) return exercises

  let replaced = false
  return exercises.map((exercise) => {
    if (replaced || exercise.group !== 'core') return exercise
    replaced = true
    return makeCoreExercise<T>('Control de tronco dead bug', 'Zona media: anti-extensión y control lumbo-pélvico.')
  })
}

function completeStrengthLoadAndEffort<T extends StrengthExerciseLike>(
  exercise: T,
  profile: StrengthProfile | undefined,
  isMainLift: boolean,
): T {
  if (!isLoadBearingStrengthExercise(exercise)) return exercise

  const definition = findStrengthExerciseByName(exercise.name)
  const exposePercent1RM = shouldExposePercent1RM(exercise, definition)
  const targetRpe = exercise.targetRpe ?? (isMainLift ? 7 : 6)
  const targetPercent1RM = exercise.targetPercent1RM ?? inferTargetPercent1RM(exercise, isMainLift)
  const withEffort = sanitizePercentLoadMetadata({ ...exercise, targetRpe }, exposePercent1RM, targetPercent1RM)

  if (exercise.weight != null) {
    const weight = limitImplementableWeight(exercise, definition, exercise.weight)
    return sanitizeWarmupSets({ ...withEffort, weight }, exposePercent1RM, weight, targetPercent1RM)
  }

  const reference = mapExerciseTo1RMReference(exercise.name, profile)
  if (!reference || reference.lift === 'pullUp') return withEffort

  const weight = computeWeightFromPercent(reference.referenceKg, targetPercent1RM, {
    factor: reference.factor,
  })
  const implementableWeight = limitImplementableWeight(exercise, definition, weight)

  return sanitizeWarmupSets({
    ...withEffort,
    weight: implementableWeight,
  }, exposePercent1RM, implementableWeight, targetPercent1RM)
}

function isLoadBearingStrengthExercise(exercise: StrengthExerciseLike): boolean {
  if (isProtocolExercise(exercise)) return false

  const group = resolveStrengthExerciseBlock(exercise)
  if (group === 'core' || group === 'cardio' || group === 'mobility') return false

  const definition = findStrengthExerciseByName(exercise.name)
  if (definition?.intensityType === 'power' && exercise.weight == null && exercise.targetPercent1RM == null) return false

  return true
}

function isProtocolExercise(exercise: Pick<StrengthExerciseLike, 'name'>): boolean {
  const name = normalizeText(exercise.name ?? '')
  return (
    /\b(warm.?up|cool.?down|calentamiento|enfriamiento|estiramiento|estiramientos|stretch|static\s+stretch|foam\s+roller|liberacion\s+miofascial)\b/.test(name) ||
    /\bmovilidad\b/.test(name) ||
    /\bactivacion\b/.test(name)
  )
}

function inferTargetPercent1RM(exercise: StrengthExerciseLike, isMainLift: boolean): number {
  const reps = extractRepresentativeReps(exercise.reps)
  const name = normalizeText(exercise.name)

  let percent = 67.5
  if (reps != null) {
    if (reps <= 3) percent = /\b(salto|jump|power|potencia)\b/.test(name) ? 60 : 82.5
    else if (reps <= 5) percent = 80
    else if (reps <= 6) percent = 77.5
    else if (reps <= 8) percent = 72.5
    else if (reps <= 10) percent = 67.5
    else percent = 60
  }

  if (!isMainLift) percent -= 5
  return Math.max(55, Math.min(85, percent))
}

function shouldExposePercent1RM(
  exercise: StrengthExerciseLike,
  definition: ExerciseDefinition | undefined,
): boolean {
  const name = normalizeText(exercise.name)
  if (/\bmancuerna(s)?\b|\bdumbbell(s)?\b|\bkettlebell(s)?\b|\bpesa(s)?\s+rusa(s)?\b/.test(name) && !/\bbarra\b|\bbarbell\b/.test(name)) {
    return false
  }
  if (!definition) return true
  if (definition.id === 'goblet_squat') return false
  const hasBarbellReference = definition.equipment.includes('barbell') || definition.equipment.includes('trap_bar') || definition.equipment.includes('machine')
  return hasBarbellReference && !definition.unilateral
}

function limitImplementableWeight(
  exercise: StrengthExerciseLike,
  definition: ExerciseDefinition | undefined,
  weight: number,
): number {
  if (!Number.isFinite(weight) || weight <= 0) return weight
  const maxWeight = getImplementableMaxWeight(exercise, definition)
  if (maxWeight == null) return weight
  return Math.min(weight, maxWeight)
}

function getImplementableMaxWeight(
  exercise: StrengthExerciseLike,
  definition: ExerciseDefinition | undefined,
): number | undefined {
  const name = normalizeText(exercise.name)
  if (definition?.id === 'goblet_squat' || /\bgoblet\b/.test(name)) return 40
  if (definition?.unilateral || /\b(bulgar|zancada|lunge|split\s*squat|step\s*up|subida)\b/.test(name)) return 50
  if (/\bremo\b.*\bmancuerna\b|\bdumbbell\s*row\b/.test(name)) return 45
  if (/\bpress\b.*\bmancuerna(s)?\b|\bdumbbell\s*press\b/.test(name)) return 50
  if (definition?.equipment.includes('kettlebell') && !definition.equipment.includes('barbell')) return 40
  if (definition?.equipment.includes('dumbbell') && !definition.equipment.includes('barbell')) return 50
  if (definition?.equipment.includes('medball')) return 15
  if (definition?.equipment.includes('plate')) return 25
  return undefined
}

function sanitizePercentLoadMetadata<T extends StrengthExerciseLike>(
  exercise: T,
  exposePercent1RM: boolean,
  targetPercent1RM: number,
): T {
  if (exposePercent1RM) return { ...exercise, targetPercent1RM }
  const rest = { ...exercise }
  delete rest.targetPercent1RM
  delete rest.warmupSets
  return rest as T
}

function sanitizeWarmupSets<T extends StrengthExerciseLike>(
  exercise: T,
  exposePercent1RM: boolean,
  weight: number,
  targetPercent1RM: number,
): T {
  if (!exposePercent1RM) {
    const rest = { ...exercise }
    delete rest.warmupSets
    return rest as T
  }
  return {
    ...exercise,
    warmupSets: exercise.warmupSets ?? buildWarmupRamp(weight, targetPercent1RM),
  }
}

function extractRepresentativeReps(reps: number | string): number | undefined {
  if (typeof reps === 'number') return reps
  const match = reps.match(/\d+/)
  if (!match) return undefined
  return Number(match[0])
}

function makeCoreExercise<T extends StrengthExerciseLike>(name: string, notes: string): T {
  return {
    name,
    sets: 3,
    reps: '8/lado',
    group: 'core',
    notes,
  } as T
}

function isFoundationCore(exercise: StrengthExerciseLike): boolean {
  const definition = findStrengthExerciseByName(exercise.name)
  if (definition) {
    return (
      definition.tags.includes('anti_extension') ||
      definition.tags.includes('lateral_stability') ||
      definition.squashTransfer?.includes('pelvic_control') ||
      definition.id === 'plank' ||
      definition.id === 'dead_bug' ||
      definition.id === 'side_plank'
    )
  }

  const name = normalizeText(exercise.name)
  return /\b(dead\s*bug|plancha|plank|copenhagen|fitball)\b/.test(name)
}

function coreRank(exercise: StrengthExerciseLike): number {
  if (exercise.group !== 'core') return 0
  return isFoundationCore(exercise) ? 0 : 1
}

function groupRank(group: ExerciseGroup | undefined): number {
  const index = BLOCK_ORDER.indexOf(group ?? 'other')
  return index === -1 ? BLOCK_ORDER.indexOf('other') : index
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

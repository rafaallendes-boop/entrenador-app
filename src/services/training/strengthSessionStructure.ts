import type { CoachExerciseProposal, Exercise, ExerciseGroup, StrengthProfile } from '../../types'
import type { ExerciseLibraryRef } from '../../types/exerciseLibraryRef'
import {
  findStrengthExerciseByName,
  getExerciseGroupForDefinition,
  resolveStrengthExercise,
  type ExerciseDefinition,
  type StrengthExerciseResolution,
} from './exerciseLibrary'
import {
  buildWarmupRamp,
  computeWeightFromPercent,
  getStrengthReferenceKg,
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
  const expanded = expandGenericFootworkBlocks(protocolFiltered)
  const normalized = expanded.map((exercise) => normalizeStrengthExerciseGroup(exercise))
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
  const resolved = exercises.map((exercise) => ({
    exercise,
    resolution: resolveStrengthExercise(exercise),
  }))
  const hasStrengthWork = resolved.some(({ exercise, resolution }) =>
    !isProtocolExercise(exercise, resolution) &&
    resolveBlockFromResolution(exercise, resolution) !== 'mobility',
  )
  if (!hasStrengthWork) return exercises
  return resolved
    .filter(({ exercise, resolution }) => !isProtocolExercise(exercise, resolution))
    .map(({ exercise }) => exercise)
}

export function enhanceStrengthSessionExercises<T extends StrengthExerciseLike>(
  exercises: T[] | undefined,
  options: { durationMin?: number; strengthProfile?: StrengthProfile } = {},
): T[] | undefined {
  const normalized = normalizeStrengthSessionExercises(exercises, options)
  if (!normalized || normalized.length === 0) return normalized

  const firstLoadBearingIndex = normalized.findIndex((exercise) => isLoadBearingStrengthExercise(exercise))

  return normalized.map((exercise, index) => completeStrengthLoadAndEffort(
    exercise,
    options.strengthProfile,
    index === firstLoadBearingIndex,
  ))
}

export function resolveStrengthExerciseBlock(
  exercise: Pick<StrengthExerciseLike, 'name' | 'group'> & { libraryRef?: ExerciseLibraryRef },
): ExerciseGroup {
  return resolveBlockFromResolution(exercise, resolveStrengthExercise(exercise))
}

/**
 * Clasificar no es fail-closed (spec §2): mandar todo nombre libre a `other`
 * degrada la estructura de la sesión sin ganar seguridad. Por eso un fragmento
 * ambiguo se clasifica igual, con el primer candidato por `id` —determinista,
 * no dependiente del orden de declaración—, aunque no reciba carga.
 */
function resolveBlockFromResolution(
  exercise: Pick<StrengthExerciseLike, 'name' | 'group'>,
  resolution: StrengthExerciseResolution | undefined,
): ExerciseGroup {
  const definition = resolution?.definition ?? resolution?.candidates[0]
  return definition ? getStrengthBlockForDefinition(definition) : inferExerciseGroup(exercise)
}

function normalizeStrengthExerciseGroup<T extends StrengthExerciseLike>(exercise: T): T {
  const resolution = resolveStrengthExercise(exercise)
  const group = resolveBlockFromResolution(exercise, resolution)
  const reps = normalizePlankReps(exercise.name, exercise.reps, resolution)
  return { ...exercise, group, reps }
}

function expandGenericFootworkBlocks<T extends StrengthExerciseLike>(exercises: T[]): T[] {
  return exercises.flatMap((exercise) => {
    if (!isGenericFootworkBlock(exercise)) return [exercise]
    return buildFootworkSeriesFromGenericBlock(exercise)
  })
}

function isGenericFootworkBlock(exercise: StrengthExerciseLike): boolean {
  if (resolveStrengthExercise(exercise)?.definition) return false
  const name = normalizeText(exercise.name)
  const reps = normalizeText(String(exercise.reps ?? ''))
  const isFootwork = /\b(escalera|ladder|footwork)\b/.test(name)
  const isTimedBlock = /\b(4\s*min|minuto|minutos)\b/.test(`${name} ${reps}`)
  return isFootwork && isTimedBlock
}

function buildFootworkSeriesFromGenericBlock<T extends StrengthExerciseLike>(exercise: T): T[] {
  const base = {
    ...exercise,
    group: 'cardio' as ExerciseGroup,
    weight: undefined,
    targetPercent1RM: undefined,
    targetRpe: undefined,
    warmupSets: undefined,
    libraryRef: undefined,
  }

  return [
    {
      ...base,
      name: 'Escalera lateral – dos pies por cuadro',
      libraryRef: { source: 'strength_exercise' as const, id: 'ladder_bipodal_lateral_1' },
      sets: 2,
      reps: '2 pasadas por lado',
      notes: appendExerciseNote(exercise.notes, 'E1 coordinación lateral: calidad de apoyo, cadera baja y regreso caminando.'),
    },
    {
      ...base,
      name: 'Escalera frontal – in-in-out-out',
      libraryRef: { source: 'strength_exercise' as const, id: 'ladder_bipodal_front_2' },
      sets: 2,
      reps: '2 pasadas',
      notes: appendExerciseNote(exercise.notes, 'E2 ritmo de pies: precisión antes que velocidad.'),
    },
    {
      ...base,
      name: 'Escalera frontal – Icky shuffle',
      libraryRef: { source: 'strength_exercise' as const, id: 'ladder_coordinativo_front_4' },
      sets: 2,
      reps: '2 pasadas',
      notes: appendExerciseNote(exercise.notes, 'E3 coordinación diagonal: pies activos sin convertirlo en cardio duro.'),
    },
  ] as T[]
}

function appendExerciseNote(original: string | undefined, addition: string): string {
  return original?.trim() ? `${addition} ${original.trim()}` : addition
}

function normalizePlankReps(
  name: string,
  reps: number | string,
  resolution: StrengthExerciseResolution | undefined,
): number | string {
  if (typeof reps !== 'number') return reps
  if (isAuthoritativeResolution(resolution)) {
    return resolution.definition.prescriptionUnit === 'seconds' ? `${reps}s` : reps
  }
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
      makeCoreExercise<T>('Control de tronco dead bug', 'Zona media: controla pelvis y costillas antes de la fuerza principal.', 'dead_bug'),
      ...exercises,
    ]
  }

  if (core.length === 1) {
    return [
      makeCoreExercise<T>('Control de tronco dead bug', 'Zona media: anti-extensión y control lumbo-pélvico.', 'dead_bug'),
      ...exercises,
    ]
  }

  const hasFoundationCore = core.some(isFoundationCore)
  if (hasFoundationCore) return exercises

  let replaced = false
  return exercises.map((exercise) => {
    if (replaced || exercise.group !== 'core') return exercise
    replaced = true
    return makeCoreExercise<T>('Control de tronco dead bug', 'Zona media: anti-extensión y control lumbo-pélvico.', 'dead_bug')
  })
}

function completeStrengthLoadAndEffort<T extends StrengthExerciseLike>(
  exercise: T,
  profile: StrengthProfile | undefined,
  isMainLift: boolean,
): T {
  const resolution = resolveStrengthExercise(exercise)
  const definition = resolution?.definition
  if (!isLoadBearingStrengthExercise(exercise, resolution)) return exercise

  const exposePercent1RM = shouldExposePercent1RM(exercise, resolution)
  const targetRpe = exercise.targetRpe ?? (isMainLift ? 7 : 6)
  const targetPercent1RM = exercise.targetPercent1RM ?? inferTargetPercent1RM(exercise, resolution, isMainLift)
  const withEffort = sanitizePercentLoadMetadata({ ...exercise, targetRpe }, exposePercent1RM, targetPercent1RM)

  if (exercise.weight != null) {
    const weight = limitImplementableWeight(exercise, resolution, exercise.weight)
    return sanitizeWarmupSets({ ...withEffort, weight }, exposePercent1RM, weight, targetPercent1RM)
  }

  const reference = definition?.loadReference
  if (!reference || reference.factor == null) return withEffort
  const referenceKg = getStrengthReferenceKg(reference.lift, profile)
  if (referenceKg == null) return withEffort

  const weight = computeWeightFromPercent(referenceKg, targetPercent1RM, {
    factor: reference.factor,
  })
  const implementableWeight = limitImplementableWeight(exercise, resolution, weight)

  return sanitizeWarmupSets({
    ...withEffort,
    weight: implementableWeight,
  }, exposePercent1RM, implementableWeight, targetPercent1RM)
}

function isLoadBearingStrengthExercise(
  exercise: StrengthExerciseLike,
  resolution = resolveStrengthExercise(exercise),
): boolean {
  if (isProtocolExercise(exercise, resolution)) return false

  const group = resolveBlockFromResolution(exercise, resolution)
  if (group === 'core' || group === 'cardio' || group === 'mobility') return false

  // Un fragmento ambiguo cuenta como potencia solo si todas sus lecturas lo
  // son. Un salto sin carga declarada no debe recibir porcentaje.
  const candidates = resolution?.candidates ?? []
  const isPower = candidates.length > 0 && candidates.every((candidate) => candidate.intensityType === 'power')
  if (isPower && exercise.weight == null && exercise.targetPercent1RM == null) return false

  return true
}

/**
 * Solo un `libraryRef` vivo, un id, un nombre canónico o un alias declarado
 * identifican al ejercicio con certeza. `substring` y `ambiguous` son
 * coincidencias de texto: conservan los regex estructurales, que fueron
 * escritos justamente para nombres libres.
 */
function isAuthoritativeResolution(
  resolution: StrengthExerciseResolution | undefined,
): resolution is StrengthExerciseResolution & { definition: ExerciseDefinition; matchKind: 'ref' | 'exact' | 'alias' } {
  return resolution?.matchKind === 'ref'
    || resolution?.matchKind === 'exact'
    || resolution?.matchKind === 'alias'
}

function isProtocolExercise(
  exercise: Pick<StrengthExerciseLike, 'name'>,
  resolution: StrengthExerciseResolution | undefined,
): boolean {
  if (isAuthoritativeResolution(resolution)) return false
  const name = normalizeText(exercise.name ?? '')
  return (
    /\b(warm.?up|cool.?down|calentamiento|enfriamiento|estiramiento|estiramientos|stretch|static\s+stretch|foam\s+roller|liberacion\s+miofascial)\b/.test(name) ||
    /\bmovilidad\b/.test(name) ||
    /\bactivacion\b/.test(name)
  )
}

function inferTargetPercent1RM(
  exercise: StrengthExerciseLike,
  resolution: StrengthExerciseResolution | undefined,
  isMainLift: boolean,
): number {
  const reps = extractRepresentativeReps(exercise.reps)

  let percent = 67.5
  if (reps != null) {
    const isPower = isAuthoritativeResolution(resolution)
      ? resolution.definition.intensityType === 'power'
      : /\b(salto|jump|power|potencia)\b/.test(normalizeText(exercise.name))
    if (reps <= 3) percent = isPower ? 60 : 82.5
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
  resolution: StrengthExerciseResolution | undefined,
): boolean {
  if (isAuthoritativeResolution(resolution)) return definitionExposesPercent1RM(resolution.definition)

  const name = normalizeText(exercise.name)
  const isNameLimitedImplement = (
    /\bmancuerna(s)?\b|\bdumbbell(s)?\b|\bkettlebell(s)?\b|\bpesa(s)?\s+rusa(s)?\b/.test(name) &&
    !/\bbarra\b|\bbarbell\b/.test(name)
  )
  if (isNameLimitedImplement) return false

  // Un nombre del que no sabemos nada mantiene el default histórico. Uno
  // ambiguo sí sabe algo: basta un candidato que no exponga para no arriesgar
  // un %1RM sobre lo que puede ser una dominada a peso corporal.
  const candidates = resolution?.candidates ?? []
  if (candidates.length === 0) return true
  return candidates.every(definitionExposesPercent1RM)
}

function definitionExposesPercent1RM(definition: ExerciseDefinition): boolean {
  if (definition.id === 'goblet_squat') return false
  const hasBarbellReference = definition.equipment.includes('barbell') || definition.equipment.includes('trap_bar') || definition.equipment.includes('machine')
  return hasBarbellReference && !definition.unilateral
}

function limitImplementableWeight(
  exercise: StrengthExerciseLike,
  resolution: StrengthExerciseResolution | undefined,
  weight: number,
): number {
  if (!Number.isFinite(weight) || weight <= 0) return weight
  const maxWeight = getImplementableMaxWeight(exercise, resolution)
  if (maxWeight == null) return weight
  return Math.min(weight, maxWeight)
}

function getImplementableMaxWeight(
  exercise: StrengthExerciseLike,
  resolution: StrengthExerciseResolution | undefined,
): number | undefined {
  if (isAuthoritativeResolution(resolution)) return definitionMaxWeight(resolution.definition)

  const name = normalizeText(exercise.name)
  if (/\bgoblet\b/.test(name)) return 40
  if (/\b(bulgar|zancada|lunge|split\s*squat|step\s*up|subida)\b/.test(name)) return 50
  if (/\bremo\b.*\bmancuerna\b|\bdumbbell\s*row\b/.test(name)) return 45
  if (/\bpress\b.*\bmancuerna(s)?\b|\bdumbbell\s*press\b/.test(name)) return 50

  // Un tope es una cota de seguridad, no una prescripción: nunca sube un peso.
  // Por eso, entre lecturas posibles del nombre, gana la más estricta. Que un
  // candidato no declare tope significa que la tabla no tiene regla para su
  // implemento, no que aguante cualquier carga.
  const caps = (resolution?.candidates ?? [])
    .map(definitionMaxWeight)
    .filter((cap): cap is number => cap != null)
  return caps.length > 0 ? Math.min(...caps) : undefined
}

function definitionMaxWeight(definition: ExerciseDefinition): number | undefined {
  if (definition.id === 'goblet_squat') return 40
  if (definition.unilateral) return 50
  if (definition.equipment.includes('kettlebell') && !definition.equipment.includes('barbell')) return 40
  if (definition.equipment.includes('dumbbell') && !definition.equipment.includes('barbell')) return 50
  if (definition.equipment.includes('medball')) return 15
  if (definition.equipment.includes('plate')) return 25
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

function makeCoreExercise<T extends StrengthExerciseLike>(name: string, notes: string, id: string): T {
  return {
    name,
    sets: 3,
    reps: '8/lado',
    group: 'core',
    notes,
    libraryRef: { source: 'strength_exercise', id },
  } as T
}

function isFoundationCore(exercise: StrengthExerciseLike): boolean {
  const definition = resolveStrengthExercise(exercise)?.definition
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

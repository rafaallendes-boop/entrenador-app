import type { ExerciseGroup, Session } from '../../types'
import type { ExerciseLibraryRef } from '../../types/exerciseLibraryRef'
import type { StrengthConstraint } from '../../types/strengthSafety'
import {
  findStrengthExerciseByName,
  getExerciseGroupForDefinition,
  getStrengthExerciseRole,
  normalizeStrengthExerciseKey,
  resolveStrengthExercise,
  STRENGTH_EXERCISE_LIBRARY,
  type EquipmentType,
  type Exercise1RMReference,
  type ExerciseDefinition,
  type ExercisePhase,
  type ExperienceLevel,
  type MovementPattern,
  type StrengthExerciseRole,
} from './exerciseLibrary'
import { getStrengthExerciseKey } from './strengthExerciseProposal'
import { selectStrengthBlockTemplate, type StrengthBlockSlot } from './strengthBlocks'
import type { DisciplineAcwr } from '../loadAnalytics'
import { isExerciseAllowed } from './strengthSafetyConstraints'

export type StrengthPhase = 'base' | 'build' | 'peak' | 'taper' | 'transition' | 'race'
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
  historicalSessions?: Session[]
  /** Quantitative ACWR signal for strength-specific load */
  strengthAcwr?: DisciplineAcwr
  weekIndexInBlock?: number
  available1RM?: Exercise1RMReference[]
  rpeAdjustment?: number
  requireExtraRecovery?: boolean
  /** Hard constraints: every caller must consciously supply an empty set or resolved restrictions. */
  safetyConstraints: readonly StrengthConstraint[]
}

export interface StrengthExerciseDensity {
  min: number
  target: number
  max: number
}

export interface StrengthSelectionExercise {
  name: string
  sets: number
  reps: number | string
  intensity: 'light' | 'moderate' | 'moderate-heavy' | 'heavy' | 'explosive' | 'controlled'
  notes?: string
  group?: ExerciseGroup
  targetPercent1RM?: number
  targetRpe?: number
  libraryRef?: ExerciseLibraryRef
}

/**
 * Reemplazo enfocado para la rotación de accesorios. Construye el ejercicio
 * completo con los filtros y la prescripción normales del selector: no parchea
 * `name` sobre la prescripción anterior, que dejaría notas de otro movimiento o
 * un `targetPercent1RM` sin referencia de 1RM.
 */
export interface StrengthReplacementRequest {
  originalName: string
  /** Identidad estable del ejercicio original cuando el texto no alcanza. */
  originalRef?: ExerciseLibraryRef
  context: StrengthContext
  excludedKeys: ReadonlySet<string>
  rotationIndex: number
  /** La prescripción depende de la posición dentro de la sesión. */
  exerciseIndex: number
}

/**
 * El pool canónico de un slot de rotación, antes de exclusiones locales.
 *
 * La asignación de bloque necesita conocer el dominio completo y compartido de
 * cada slot. Las exclusiones por columna pertenecen al allocator; incluirlas
 * aquí volvería a hacer que el pool dependiera de mutaciones locales.
 */
export function getStrengthReplacementPool(
  original: { name: string; libraryRef?: ExerciseLibraryRef },
  context: StrengthContext,
): string[] {
  const resolved = resolveStrengthExercise(original)?.definition
  if (!resolved) return []

  return STRENGTH_EXERCISE_LIBRARY
    .filter((candidate) => candidate.movement === resolved.movement)
    .filter((candidate) => candidate.id !== resolved.id)
    .filter((candidate) => isCandidateAllowedInContext(candidate, context))
    .map((candidate) => candidate.id)
    .sort((left, right) => left.localeCompare(right))
}

/**
 * Materializa una prescripción para un id que ya eligió el allocator. Devuelve
 * `undefined` si el catálogo o el contexto dejaron de hacerlo elegible.
 */
export function buildStrengthReplacementById(
  candidateId: string,
  context: StrengthContext,
  exerciseIndex: number,
): StrengthSelectionExercise | undefined {
  const candidate = STRENGTH_EXERCISE_LIBRARY.find((exercise) => exercise.id === candidateId)
  if (!candidate || !isCandidateAllowedInContext(candidate, context)) return undefined
  return buildPrescribedExercise(candidate, context, exerciseIndex)
}

export interface StarLiftInfo {
  name: string
  targetPercent1RM?: number
  targetRpe?: number
  weekProgression: number
}

interface ScoredExercise {
  exercise: ExerciseDefinition
  score: number
}

// Fase 2: 4-state model. 'rotate' = cambiar patron principal para evitar sobreestimulo.
export type StrengthProgressionIntent = 'progress' | 'hold' | 'deload' | 'rotate'

interface PatternProgressionEntry {
  pattern: MovementPattern
  frequency: number
  lastExerciseId: string
  lastRole: StrengthExerciseRole
  lastDate: string
}

export interface StrengthProgressionState {
  intent: StrengthProgressionIntent
  mainPattern?: MovementPattern
  patterns: Partial<Record<MovementPattern, PatternProgressionEntry>>
}

export function selectStrengthSession(
  context: StrengthContext,
): { focus: string; exercises: StrengthSelectionExercise[]; starLift?: StarLiftInfo } {
  if (shouldUseBlockTemplateSelection(context)) {
    return selectBlockStrengthSession(context)
  }

  const normalizedEquipment = normalizeEquipment(context.availableEquipment)
  const recentSet = buildRecentStrengthKeySet(context.recentExercises)
  const progressionState = deriveStrengthProgressionState(context)
  const equipmentPool = filterByEquipment(STRENGTH_EXERCISE_LIBRARY, normalizedEquipment)
  const experiencePool = buildStrengthCandidatePool(equipmentPool, context)
  const withoutRecent = avoidRecentExercises(experiencePool, recentSet)
  const pool = withoutRecent.length >= 6 ? withoutRecent : experiencePool
  const density = getTargetExerciseDensity(context)
  const selected = pickStrengthStructure(pool, context, recentSet, progressionState)

  const fallback = selected.length >= density.min
    ? selected
    : pickStrengthStructure(
        buildStrengthCandidatePool(equipmentPool, { ...context, fatigueLevel: Math.min(context.fatigueLevel, 6) }),
        context,
        recentSet,
        progressionState,
      )

  const finalSelection = fallback.slice(0, density.max)
  const builtExercises = finalSelection.map((exercise, index) => buildSelectionExercise(exercise, context, index, progressionState))

  return {
    focus: deriveStrengthFocus(finalSelection, context),
    exercises: orderStrengthExercisesForSession(builtExercises, context),
  }
}

function shouldUseBlockTemplateSelection(context: StrengthContext): boolean {
  return (
    context.weekIndexInBlock != null ||
    (context.available1RM != null && context.available1RM.length > 0) ||
    context.rpeAdjustment != null
  )
}

function selectBlockStrengthSession(
  context: StrengthContext,
): { focus: string; exercises: StrengthSelectionExercise[]; starLift?: StarLiftInfo } {
  const phase = toExercisePhase(context.phase)
  const weekIndexInBlock = context.weekIndexInBlock ?? 0
  const template = selectStrengthBlockTemplate(phase, weekIndexInBlock)
  const normalizedEquipment = normalizeEquipment(context.availableEquipment)
  const recentSet = buildRecentStrengthKeySet(context.recentExercises)
  const available1RM = new Set(context.available1RM ?? [])
  const selectedDefinitions: ExerciseDefinition[] = []
  const selectedIds = new Set<string>()
  let starDefinition: ExerciseDefinition | undefined

  for (const slot of template.slots) {
    if (!slot.required && slot.minDurationMin != null && (context.sessionDurationMin ?? 50) < slot.minDurationMin) continue

    const candidate = selectExerciseForBlockSlot({
      slot,
      phase,
      context,
      normalizedEquipment,
      recentSet,
      available1RM,
      selectedIds,
    })
    if (!candidate) continue

    selectedDefinitions.push(candidate)
    selectedIds.add(candidate.id)
    if (!starDefinition && slot.isStarLiftCandidate) {
      starDefinition = candidate
    }
  }

  const density = getTargetExerciseDensity(context)
  if (selectedDefinitions.length < density.target) {
    const fillers = pickBlockFillers({
      phase,
      context,
      normalizedEquipment,
      recentSet,
      available1RM,
      selectedIds,
      targetCount: density.target - selectedDefinitions.length,
    })
    for (const filler of fillers) {
      selectedDefinitions.push(filler)
      selectedIds.add(filler.id)
    }
  }

  const finalSelection = selectedDefinitions.slice(0, density.max)
  const builtExercises = finalSelection.map((exercise, index) =>
    buildPrescribedExercise(exercise, context, index, exercise.id === starDefinition?.id),
  )
  const ordered = orderStrengthExercisesForSession(builtExercises, context)
  const starLift = starDefinition ? selectStarLift(starDefinition, context, weekIndexInBlock) : undefined

  return {
    focus: deriveStrengthFocus(finalSelection, context),
    exercises: ordered,
    starLift,
  }
}

function selectExerciseForBlockSlot({
  slot,
  phase,
  context,
  normalizedEquipment,
  recentSet,
  available1RM,
  selectedIds,
}: {
  slot: StrengthBlockSlot
  phase: ExercisePhase
  context: StrengthContext
  normalizedEquipment: EquipmentType[]
  recentSet: Set<string>
  available1RM: Set<Exercise1RMReference>
  selectedIds: Set<string>
}): ExerciseDefinition | undefined {
  const pool = buildStrengthCandidatePool(STRENGTH_EXERCISE_LIBRARY, context)
    .filter((exercise) => !selectedIds.has(exercise.id))
    .filter((exercise) => exercise.appropriateForPhases?.includes(phase) ?? true)
    .filter((exercise) => matchesBlockSlotPattern(exercise, slot.pattern))

  const scored = scoreBlockCandidates(pool, {
    slot,
    context,
    normalizedEquipment,
    recentSet,
    available1RM,
  })

  return scored[0]?.exercise
}

function pickBlockFillers({
  phase,
  context,
  normalizedEquipment,
  recentSet,
  available1RM,
  selectedIds,
  targetCount,
}: {
  phase: ExercisePhase
  context: StrengthContext
  normalizedEquipment: EquipmentType[]
  recentSet: Set<string>
  available1RM: Set<Exercise1RMReference>
  selectedIds: Set<string>
  targetCount: number
}): ExerciseDefinition[] {
  const pool = buildStrengthCandidatePool(STRENGTH_EXERCISE_LIBRARY, context)
    .filter((exercise) => !selectedIds.has(exercise.id))
    .filter((exercise) => exercise.appropriateForPhases?.includes(phase) ?? true)

  return scoreBlockCandidates(pool, {
    context,
    normalizedEquipment,
    recentSet,
    available1RM,
  }).slice(0, targetCount).map(({ exercise }) => exercise)
}

function scoreBlockCandidates(
  exercises: ExerciseDefinition[],
  {
    slot,
    context,
    normalizedEquipment,
    recentSet,
    available1RM,
  }: {
    slot?: StrengthBlockSlot
    context: StrengthContext
    normalizedEquipment: EquipmentType[]
    recentSet: Set<string>
    available1RM: Set<Exercise1RMReference>
  },
): ScoredExercise[] {
  return exercises
    .map((exercise) => {
      let score = 0
      if (slot?.preferredRotationGroup && exercise.blockRotationGroup === slot.preferredRotationGroup) score += 30
      const reference = exercise.loadReference
      if (reference?.selectorEligible && available1RM.has(reference.lift)) score += 35
      if (exercise.tags.includes('athletic_transfer')) score += 6
      if (context.primarySport === 'squash' && exercise.sportsTransfer?.includes('squash')) score += 5
      if (exercise.unilateral) score += slot?.pattern === 'lunge' ? 10 : 2
      if (exercise.category === 'core') score += 4
      if (exercise.equipment.some((item) => normalizedEquipment.includes(item))) score += 8
      else score -= 30
      if (recentSet.has(normalizeStrengthExerciseKey(exercise.id)) || recentSet.has(normalizeStrengthExerciseKey(exercise.name))) score -= 60
      if (context.fatigueLevel >= 7 && (exercise.intensityType === 'strength' || exercise.intensityType === 'power')) score -= 12
      if (context.requireExtraRecovery && exercise.fatigueCost === 'high') score -= 25
      if (context.requireExtraRecovery && exercise.tags.includes('olympic_power')) score -= 18
      return { exercise, score }
    })
    .sort((a, b) => b.score - a.score || a.exercise.id.localeCompare(b.exercise.id))
}

function matchesBlockSlotPattern(exercise: ExerciseDefinition, pattern: StrengthBlockSlot['pattern']): boolean {
  if (pattern === 'core') return exercise.category === 'core'
  if (pattern === 'cardio') return isSpecificCardioExercise(exercise)
  if (pattern === 'plyo') return exercise.intensityType === 'power' && !isSpecificCardioExercise(exercise)
  if (pattern === 'mobility') return exercise.intensityType === 'recovery' || exercise.tags.includes('recovery')
  if (pattern === 'lunge') {
    return exercise.unilateral === true || exercise.tags.includes('court_lunge') || exercise.tags.includes('lateral_strength')
  }
  return exercise.movement === pattern
}

function buildPrescribedExercise(
  exercise: ExerciseDefinition,
  context: StrengthContext,
  index: number,
  isStarLift = false,
): StrengthSelectionExercise {
  const base = buildSelectionExercise(exercise, context, index)
  const targetRpe = clamp(resolveTargetRpe(base.intensity) + (context.rpeAdjustment ?? 0), 4, 9)
  const reference = exercise.loadReference
  const targetPercent1RM = reference?.selectorEligible && context.available1RM?.includes(reference.lift)
    ? resolveTargetPercent1RM(context, isStarLift)
    : undefined

  return {
    ...base,
    targetRpe,
    targetPercent1RM,
  }
}

function isCandidateAllowedInContext(
  candidate: ExerciseDefinition,
  context: StrengthContext,
): boolean {
  const phase = toExercisePhase(context.phase)
  if (!(candidate.appropriateForPhases?.includes(phase) ?? true)) return false

  const eligible = buildStrengthCandidatePool([candidate], context)
  return filterByEquipment(eligible, normalizeEquipment(context.availableEquipment)).length > 0
}

/**
 * Adaptador de compatibilidad para consumidores externos del selector escalar.
 * El Plan Builder no lo usa: toma `getStrengthReplacementPool` y materializa
 * con `buildStrengthReplacementById` el id que decidió su allocator de bloque.
 * Determinista: el orden del pool es total y estable, con `id` como desempate.
 */
export function selectStrengthReplacement(
  request: StrengthReplacementRequest,
): StrengthSelectionExercise | undefined {
  const original = {
    name: request.originalName,
    libraryRef: request.originalRef,
  }
  const candidates = getStrengthReplacementPool(original, request.context)
    .filter((candidateId) => {
      const candidate = STRENGTH_EXERCISE_LIBRARY.find((exercise) => exercise.id === candidateId)
      return candidate != null
        && !request.excludedKeys.has(getStrengthExerciseKey(candidate))
        && !request.excludedKeys.has(normalizeStrengthExerciseKey(candidate.name))
    })

  if (candidates.length === 0) return undefined

  const picked = candidates[request.rotationIndex % candidates.length]!
  return buildStrengthReplacementById(picked, request.context, request.exerciseIndex)
}

export function selectStarLift(
  exercise: ExerciseDefinition,
  context: StrengthContext,
  weekIndexInBlock = context.weekIndexInBlock ?? 0,
): StarLiftInfo {
  const reference = exercise.loadReference
  const targetPercent1RM = reference?.selectorEligible && context.available1RM?.includes(reference.lift)
    ? resolveTargetPercent1RM(context, true)
    : undefined

  return {
    name: exercise.name,
    targetPercent1RM,
    targetRpe: clamp(resolveTargetRpe(context.phase === 'peak' ? 'heavy' : 'moderate-heavy') + (context.rpeAdjustment ?? 0), 4, 9),
    weekProgression: weekIndexInBlock,
  }
}

function resolveTargetPercent1RM(context: StrengthContext, isStarLift: boolean): number {
  const weekStep = Math.abs(context.weekIndexInBlock ?? 0) % 3
  if (context.phase === 'peak') return isStarLift ? [80, 82, 85][weekStep]! : 72
  if (context.phase === 'build') return isStarLift ? [75, 80, 85][weekStep]! : 70
  if (context.phase === 'base') return isStarLift ? 70 : 65
  return 60
}

function resolveTargetRpe(intensity: StrengthSelectionExercise['intensity']): number {
  switch (intensity) {
    case 'heavy':
      return 8
    case 'moderate-heavy':
      return 7
    case 'moderate':
      return 6
    case 'explosive':
      return 7
    case 'controlled':
      return 6
    case 'light':
    default:
      return 5
  }
}

function toExercisePhase(phase: StrengthPhase): ExercisePhase {
  return phase
}

function buildRecentStrengthKeySet(recentExercises: string[]): Set<string> {
  const keys = new Set<string>()
  for (const exercise of recentExercises) {
    keys.add(normalizeStrengthExerciseKey(exercise))
    const definition = findStrengthExerciseByName(exercise)
    if (definition) keys.add(normalizeStrengthExerciseKey(definition.id))
  }
  return keys
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
    (session.exercises ?? []).map((exercise) => getStrengthExerciseKey(exercise)),
  )
}

export function filterByFatigue(
  exercises: ExerciseDefinition[],
  context: StrengthContext,
): ExerciseDefinition[] {
  if (context.competitionSoon || context.fatigueLevel >= 8) {
    return exercises.filter((exercise) =>
      (exercise.intensityType !== 'power' &&
      exercise.intensityType !== 'strength') ||
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

function buildStrengthCandidatePool(
  exercises: ExerciseDefinition[],
  context: StrengthContext,
): ExerciseDefinition[] {
  return filterByFatigue(
    filterByPhase(
      filterBySafetyMetadata(
        filterByExperience(filterBySafetyConstraints(exercises, context), context),
        context,
      ),
      context,
    ),
    context,
  )
}

function filterBySafetyConstraints(
  exercises: ExerciseDefinition[],
  context: StrengthContext,
): ExerciseDefinition[] {
  return context.safetyConstraints.length === 0
    ? exercises
    : exercises.filter((exercise) => isExerciseAllowed(exercise, context.safetyConstraints))
}

function filterBySafetyMetadata(
  exercises: ExerciseDefinition[],
  context: StrengthContext,
): ExerciseDefinition[] {
  return exercises.filter((exercise) => {
    const isHighRisk = exercise.riskLevel === 'high' || exercise.tags.includes('high_impact') || exercise.tags.includes('high_skill')
    const isHighFatigue = exercise.fatigueCost === 'high'

    if (context.competitionSoon || context.phase === 'taper') {
      return !isHighRisk && !isHighFatigue
    }

    if (context.fatigueLevel >= 8) {
      return exercise.riskLevel !== 'high' && exercise.fatigueCost !== 'high'
    }

    if (context.fatigueLevel >= 7) {
      return !isHighRisk
    }

    return true
  })
}

export function pickStrengthStructure(
  exercises: ExerciseDefinition[],
  context: StrengthContext,
  recentExercises: Set<string>,
  progressionState?: StrengthProgressionState,
): ExerciseDefinition[] {
  const scored = scoreExercises(exercises, context, recentExercises, progressionState)
  const selected: ExerciseDefinition[] = []
  const selectedMovements = new Set<MovementPattern>()
  const selectedIds = new Set<string>()
  const targetCount = getTargetExerciseDensity(context).target
  const coreTarget = getTargetCoreCount(context, targetCount)
  const cardioTarget = getSpecificCardioTarget(scored, context, targetCount)
  const nonCoreLimit = Math.max(1, targetCount - coreTarget - cardioTarget)

  const mainLift = selectMainLiftWithProgression(scored, context, recentExercises, progressionState)
  if (mainLift) {
    selected.push(mainLift)
    selectedMovements.add(mainLift.movement)
    selectedIds.add(mainLift.id)
  }

  const powerNeeded = shouldIncludePower(context)
  if (powerNeeded && selected.length < nonCoreLimit) {
    const powerExercise = pickFirst(scored, context, (exercise) =>
      exercise.intensityType === 'power' &&
      !isSpecificCardioExercise(exercise) &&
      !selectedIds.has(exercise.id),
    )
    if (powerExercise) {
      selected.push(powerExercise)
      selectedMovements.add(powerExercise.movement)
      selectedIds.add(powerExercise.id)
    }
  }

  if (selected.length < nonCoreLimit) {
    const accessory = pickFirst(scored, context, (exercise) =>
      !selectedIds.has(exercise.id) &&
      exercise.category !== 'core' &&
      !isSpecificCardioExercise(exercise) &&
      exercise.intensityType !== 'recovery' &&
      (!selectedMovements.has(exercise.movement) || context.sportProfile === 'strength_primary'),
    (exercise) =>
      !selectedIds.has(exercise.id) &&
      exercise.category !== 'core' &&
      !isSpecificCardioExercise(exercise) &&
      exercise.intensityType !== 'recovery',
    )
    if (accessory) {
      selected.push(accessory)
      selectedMovements.add(accessory.movement)
      selectedIds.add(accessory.id)
    }
  }

  if (selected.length < nonCoreLimit) {
    const unilateralOrStability = pickFirst(scored, context, (exercise) =>
      !selectedIds.has(exercise.id) &&
      !isSpecificCardioExercise(exercise) &&
      (exercise.unilateral || exercise.intensityType === 'stability') &&
      exercise.category !== 'core',
    (exercise) =>
      !selectedIds.has(exercise.id) &&
      !isSpecificCardioExercise(exercise) &&
      exercise.category !== 'core',
    )
    if (unilateralOrStability) {
      selected.push(unilateralOrStability)
      selectedMovements.add(unilateralOrStability.movement)
      selectedIds.add(unilateralOrStability.id)
    }
  }

  const trunkBlock = pickCoreBlock(scored, context, selectedIds, coreTarget)
  for (const trunk of trunkBlock) {
    selected.push(trunk)
    selectedIds.add(trunk.id)
  }

  if (cardioTarget > 0 && selected.length < targetCount) {
    const cardioBlock = pickSpecificCardioBlock(scored, context, selectedIds, Math.min(cardioTarget, targetCount - selected.length))
    for (const cardio of cardioBlock) {
      selected.push(cardio)
      selectedIds.add(cardio.id)
    }
  }

  const upperOptional = pickFirst(scored, context, (exercise) =>
    !selectedIds.has(exercise.id) &&
    !isSpecificCardioExercise(exercise) &&
    exercise.category === 'upper' &&
    (context.sportProfile !== 'sport_support' || context.competitionSoon || context.primarySport === 'running'),
  (exercise) =>
    !selectedIds.has(exercise.id) &&
    !isSpecificCardioExercise(exercise) &&
    exercise.category === 'upper',
  )
  if (upperOptional && selected.length < targetCount) {
    selected.push(upperOptional)
    selectedIds.add(upperOptional.id)
  }

  for (const { exercise } of scored) {
    if (selected.length >= targetCount) break
    if (selectedIds.has(exercise.id)) continue
    if (isSpecificCardioExercise(exercise)) continue
    selected.push(exercise)
    selectedIds.add(exercise.id)
  }

  return selected.slice(0, targetCount)
}

function shouldIncludeSpecificCardio(context: StrengthContext, targetCount: number): boolean {
  const duration = context.sessionDurationMin ?? 50
  const goal = context.goal.toLowerCase()
  const explicitlyWantsCardio =
    goal.includes('cardio') ||
    goal.includes('acondicion') ||
    goal.includes('puntos cortos') ||
    goal.includes('repeat sprint') ||
    goal.includes('footwork') ||
    goal.includes('escalera') ||
    goal.includes('bici de asalto') ||
    goal.includes('trotadora')

  if (context.fatigueLevel >= 7 || context.competitionSoon || context.phase === 'taper') return false
  if (context.primarySport !== 'squash' && !explicitlyWantsCardio) return false
  if (duration < 55 && !explicitlyWantsCardio) return false
  if (targetCount < 5 && !explicitlyWantsCardio) return false
  return context.phase === 'base' || context.phase === 'build' || context.phase === 'peak' || explicitlyWantsCardio
}

function isSpecificCardioExercise(exercise: ExerciseDefinition): boolean {
  return isMachineSpecificCardioExercise(exercise) || isFootworkSpecificCardioExercise(exercise)
}

function isMachineSpecificCardioExercise(exercise: ExerciseDefinition): boolean {
  return (
    exercise.equipment.includes('assault_bike') ||
    exercise.equipment.includes('air_treadmill') ||
    exercise.tags.includes('court_conditioning') ||
    exercise.tags.includes('cardio_specific')
  )
}

function isFootworkSpecificCardioExercise(exercise: ExerciseDefinition): boolean {
  return exercise.equipment.includes('ladder') || exercise.tags.includes('court_footwork')
}

function getSpecificCardioTarget(
  scored: ScoredExercise[],
  context: StrengthContext,
  targetCount: number,
): number {
  if (!shouldIncludeSpecificCardio(context, targetCount)) return 0

  const goal = context.goal.toLowerCase()
  const wantsFootwork = goal.includes('footwork') || goal.includes('escalera') || goal.includes('coordinacion') || goal.includes('coordinación')
  const wantsMachine = goal.includes('bici') || goal.includes('bike') || goal.includes('asalto') || goal.includes('trotadora') || goal.includes('runner') || goal.includes('cinta')
  const hasFootwork = scored.some(({ exercise }) => isFootworkSpecificCardioExercise(exercise))
  const hasMachine = scored.some(({ exercise }) => isMachineSpecificCardioExercise(exercise))

  if ((wantsFootwork || (!wantsMachine && !hasMachine)) && hasFootwork) {
    if (targetCount <= 5) return 1
    if (wantsFootwork && (context.sessionDurationMin ?? 50) >= 65 && context.fatigueLevel <= 4 && targetCount >= 8) return 3
    return 2
  }

  return hasMachine || hasFootwork ? 1 : 0
}

function pickSpecificCardioBlock(
  scored: ScoredExercise[],
  context: StrengthContext,
  selectedIds: Set<string>,
  targetCount: number,
): ExerciseDefinition[] {
  const goal = context.goal.toLowerCase()
  const prefersAirTreadmill = goal.includes('trotadora') || goal.includes('runner') || goal.includes('cinta')
  const prefersAssaultBike = goal.includes('bici') || goal.includes('bike') || goal.includes('asalto')
  const prefersFootwork = goal.includes('footwork') || goal.includes('escalera') || goal.includes('coordinacion') || goal.includes('coordinación')

  const preferredId = prefersAirTreadmill
    ? 'air_treadmill_20_20'
    : prefersAssaultBike
      ? 'assault_bike_30_30'
      : undefined

  if (preferredId) {
    const preferred = scored.find(({ exercise }) => exercise.id === preferredId && !selectedIds.has(exercise.id))
    if (preferred) return [preferred.exercise]
  }

  if (prefersFootwork || !scored.some(({ exercise }) => isMachineSpecificCardioExercise(exercise))) {
    const footwork = pickFootworkCardioBlock(scored, context, selectedIds, targetCount)
    if (footwork.length > 0) return footwork
  }

  const machine = pickFirst(scored, context, (exercise) =>
    isMachineSpecificCardioExercise(exercise) &&
    !selectedIds.has(exercise.id),
  )
  if (machine) return [machine]

  return pickFootworkCardioBlock(scored, context, selectedIds, targetCount)
}

function pickFootworkCardioBlock(
  scored: ScoredExercise[],
  context: StrengthContext,
  selectedIds: Set<string>,
  targetCount: number,
): ExerciseDefinition[] {
  const picked: ExerciseDefinition[] = []
  const add = (predicate: (exercise: ExerciseDefinition) => boolean): void => {
    if (picked.length >= targetCount) return
    const next = pickFirst(scored, context, (exercise) =>
      isFootworkSpecificCardioExercise(exercise) &&
      !selectedIds.has(exercise.id) &&
      !picked.some((selected) => selected.id === exercise.id) &&
      predicate(exercise),
    (exercise) =>
      isFootworkSpecificCardioExercise(exercise) &&
      !selectedIds.has(exercise.id) &&
      !picked.some((selected) => selected.id === exercise.id),
    )
    if (next) picked.push(next)
  }

  add((exercise) => exercise.tags.includes('lateral_power') || exercise.squashTransfer?.includes('lateral_movement') === true)
  add((exercise) => exercise.squashTransfer?.includes('split_step_quality') === true)
  add((exercise) => exercise.squashTransfer?.includes('court_reacceleration') === true)

  while (picked.length < targetCount) {
    const before = picked.length
    add(() => true)
    if (picked.length === before) break
  }

  return picked
}

function getTargetCoreCount(context: StrengthContext, targetCount: number): number {
  if (targetCount <= 0) return 0
  const duration = context.sessionDurationMin ?? 50
  const goal = context.goal.toLowerCase()
  const explicitlyWantsCore =
    goal.includes('core') ||
    goal.includes('trunk') ||
    goal.includes('zona media') ||
    goal.includes('plancha') ||
    goal.includes('dead bug') ||
    goal.includes('deadbug')

  if (targetCount <= 3) return explicitlyWantsCore ? 1 : 0
  if (duration < 45 && !explicitlyWantsCore) return 1

  if (context.primarySport === 'squash' || context.sportProfile === 'hybrid' || context.sportProfile === 'sport_support') {
    return targetCount >= 5 ? 2 : 1
  }

  return explicitlyWantsCore && targetCount >= 5 ? 2 : 1
}

function pickCoreBlock(
  scored: ScoredExercise[],
  context: StrengthContext,
  selectedIds: Set<string>,
  targetCount: number,
): ExerciseDefinition[] {
  if (targetCount <= 0) return []

  const picked: ExerciseDefinition[] = []
  const pick = (predicate: (exercise: ExerciseDefinition) => boolean): void => {
    if (picked.length >= targetCount) return
    const next = pickFirst(scored, context, (exercise) =>
      exercise.category === 'core' &&
      !selectedIds.has(exercise.id) &&
      !picked.some((selected) => selected.id === exercise.id) &&
      predicate(exercise),
    (exercise) =>
      exercise.category === 'core' &&
      !selectedIds.has(exercise.id) &&
      !picked.some((selected) => selected.id === exercise.id),
    )
    if (next) picked.push(next)
  }

  pick((exercise) =>
    exercise.tags.includes('anti_extension') ||
    exercise.tags.includes('lateral_stability') ||
    exercise.squashTransfer?.includes('pelvic_control') ||
    exercise.id === 'plank' ||
    exercise.id === 'dead_bug' ||
    exercise.id === 'side_plank',
  )

  pick((exercise) =>
    exercise.tags.includes('anti_rotation') ||
    exercise.tags.includes('lateral_stability') ||
    exercise.movement === 'rotation',
  )

  while (picked.length < targetCount) {
    const before = picked.length
    pick(() => true)
    if (picked.length === before) break
  }

  return picked
}

function scoreExercises(
  exercises: ExerciseDefinition[],
  context: StrengthContext,
  recentExercises: Set<string>,
  progressionState = deriveStrengthProgressionState(context),
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
      if (context.requireExtraRecovery) {
        if (exercise.fatigueCost === 'high') score -= 25
        if (exercise.tags.includes('olympic_power')) score -= 18
        if (exercise.intensityType === 'stability' || exercise.fatigueCost === 'low') score += 3
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
        if (exercise.sportsTransfer?.includes('squash')) score += 2
        if (exercise.tags.includes('athletic_transfer')) score += 2
        if (exercise.tags.includes('squash_specific')) score += 4
        if (exercise.tags.includes('court_conditioning')) score += 4
        if (exercise.tags.includes('repeat_sprint')) score += 3
        if (exercise.tags.includes('anti_rotation')) score += 3
        if (exercise.tags.includes('anti_extension')) score += 3
        if (exercise.tags.includes('lateral_stability')) score += 3
        if (exercise.tags.includes('trunk_stability')) score += 2
        if (exercise.squashTransfer?.includes('pelvic_control')) score += 2
        if (exercise.tags.includes('lateral_strength')) score += 3
        if (exercise.tags.includes('lateral_power')) score += 3
        if (exercise.tags.includes('court_footwork')) score += 3
        if (exercise.tags.includes('reactive_stiffness')) score += 2
        if (exercise.tags.includes('olympic_power') && context.experienceLevel === 'advanced') score += 2
        if (exercise.movement === 'rotation') score += 2
        if (context.phase === 'build' || context.phase === 'peak') {
          if (exercise.intensityType === 'power' && exercise.fatigueCost !== 'high') score += 2
        }
        if (context.competitionSoon || context.fatigueLevel >= 7) {
          if (exercise.fatigueCost === 'low') score += 3
          if (exercise.riskLevel === 'high' || exercise.fatigueCost === 'high') score -= 8
        }
      }

      if (recentExercises.has(normalizeStrengthExerciseKey(exercise.id))) score -= 10

      if (progressionState.mainPattern && exercise.movement === progressionState.mainPattern) {
        if (progressionState.intent === 'progress' && exercise.intensityType === 'strength') score += 5
        if (progressionState.intent === 'hold' && exercise.intensityType !== 'recovery') score += 2
        if (progressionState.intent === 'deload' && (exercise.intensityType === 'stability' || exercise.intensityType === 'recovery')) score += 4
        if (progressionState.intent === 'rotate') score -= 6 // discourage overused pattern
      }

      if (progressionState.intent === 'rotate' && progressionState.mainPattern && exercise.movement !== progressionState.mainPattern) {
        if (exercise.intensityType === 'strength' || exercise.intensityType === 'hypertrophy') score += 3
      }

      if (
        progressionState.intent === 'progress' &&
        progressionState.mainPattern &&
        exercise.movement === progressionState.mainPattern &&
        progressionState.patterns[exercise.movement]?.lastExerciseId === exercise.id
      ) {
        score -= context.sportProfile === 'strength_primary' ? 1 : 4
      }

      return { exercise, score }
    })
    // El desempate va por `id`, que es estable y nunca es texto de usuario. Con
    // `name` un renombre cambiaba qué ejercicio se prescribe.
    .sort((a, b) => b.score - a.score || a.exercise.id.localeCompare(b.exercise.id))
}

export function deriveStrengthProgressionState(context: StrengthContext): StrengthProgressionState {
  const strengthSessions = [...(context.historicalSessions ?? [])]
    .filter((session) =>
      session.type === 'strength' &&
      (session.status === 'completed' || session.status === 'adjusted') &&
      session.exercises &&
      session.exercises.length > 0,
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.timeBlock.localeCompare(a.timeBlock))
    .slice(0, 5)

  const patterns: Partial<Record<MovementPattern, PatternProgressionEntry>> = {}
  let mainPattern: MovementPattern | undefined

  strengthSessions.forEach((session, sessionIndex) => {
    session.exercises?.forEach((exercise, index) => {
      const definition = resolveStrengthExercise(exercise)?.definition
      if (!definition) return

      const role = getStrengthExerciseRole(definition, index)
      const entry = patterns[definition.movement]
      if (!entry) {
        patterns[definition.movement] = {
          pattern: definition.movement,
          frequency: 1,
          lastExerciseId: definition.id,
          lastRole: role,
          lastDate: session.date,
        }
      } else {
        entry.frequency += 1
      }

      if (sessionIndex === 0 && role === 'main_lift' && !mainPattern) {
        mainPattern = definition.movement
      }
    })
  })

  const mainPatternFrequency = mainPattern ? (patterns[mainPattern]?.frequency ?? 0) : 0

  return {
    intent: deriveProgressionIntent(context, mainPattern, mainPatternFrequency),
    mainPattern,
    patterns,
  }
}

export function deriveProgressionIntent(
  context: StrengthContext,
  mainPattern?: MovementPattern,
  mainPatternFrequency?: number,
): StrengthProgressionIntent {
  if (context.competitionSoon || context.phase === 'taper' || context.fatigueLevel >= 7) return 'deload'

  // ACWR risk override: objective load signal takes priority
  if (context.strengthAcwr?.status === 'risk') return 'deload'

  const freq = mainPatternFrequency ?? 0

  // ACWR undertrained: nudge to progress unless rotation thresholds would fire
  if (context.strengthAcwr?.status === 'undertrained' && context.fatigueLevel <= 5 && !context.competitionSoon) {
    const wouldRotate =
      (context.sportProfile === 'strength_primary' && mainPattern != null && freq >= 4) ||
      (context.sportProfile === 'hybrid' && mainPattern != null && freq >= 3) ||
      (context.sportProfile === 'sport_support' && mainPattern != null && freq >= 2)
    if (!wouldRotate) return 'progress'
  }

  if (context.sportProfile === 'strength_primary') {
    // strength_primary: progress aggressively, rotate only when clearly overloaded
    if (mainPattern && freq >= 4) return 'rotate'
    if (mainPattern) return 'progress'
    if (context.phase === 'build' && context.fatigueLevel <= 5) return 'progress'
    return 'hold'
  }

  if (context.sportProfile === 'hybrid') {
    // hybrid: softer progression rhythm, rotate after 3 sessions with same pattern
    if (mainPattern && freq >= 3) return 'rotate'
    if (mainPattern && freq >= 1 && context.phase === 'build' && context.fatigueLevel <= 5) return 'progress'
    return 'hold'
  }

  // sport_support: conservative — hold unless very fresh, rotate quickly to avoid overloading sport legs
  if (mainPattern && freq >= 2) return 'rotate'
  if (context.phase === 'base' && context.fatigueLevel <= 4) return 'progress'
  return 'hold'
}

export function selectMainLiftWithProgression(
  scored: ScoredExercise[],
  context: StrengthContext,
  recentExercises: Set<string>,
  progressionState = deriveStrengthProgressionState(context),
): ExerciseDefinition | undefined {
  // rotate: pick a main lift from a DIFFERENT pattern to break overload cycle
  if (progressionState.intent === 'rotate' && progressionState.mainPattern) {
    const alternative = scored.find(({ exercise }) =>
      exercise.movement !== progressionState.mainPattern &&
      exercise.intensityType === 'strength' &&
      exercise.category !== 'core' &&
      !recentExercises.has(normalizeStrengthExerciseKey(exercise.id)),
    )
    if (alternative) return alternative.exercise
  }

  if (progressionState.mainPattern) {
    const preferred = scored.find(({ exercise }) =>
      exercise.movement === progressionState.mainPattern &&
      exercise.intensityType === 'strength' &&
      exercise.category !== 'core' &&
      (
        progressionState.intent !== 'progress' ||
        !recentExercises.has(normalizeStrengthExerciseKey(exercise.id)) ||
        context.sportProfile === 'strength_primary'
      ),
    )
    if (preferred) return preferred.exercise
  }

  return pickFirst(scored, context, (exercise) =>
    exercise.intensityType === 'strength' &&
    exercise.category !== 'core' &&
    !recentExercises.has(normalizeStrengthExerciseKey(exercise.id)),
  )
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

  if (context.primarySport === 'squash') {
    const hasLateral = exercises.some((exercise) =>
      exercise.tags.includes('lateral_strength') ||
      exercise.tags.includes('lateral_power') ||
      exercise.tags.includes('court_footwork'),
    )

    if (hasPower && hasLateral) return 'squash power + lateral strength'
    if (hasPower) return 'squash power + trunk stability'
    if (hasLateral) return 'squash lateral strength + trunk stability'
  }

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
  progressionState = deriveStrengthProgressionState(context),
): StrengthSelectionExercise {
  const prescription = getProgressedPrescription(exercise, context, index, progressionState)

  return {
    name: exercise.name,
    sets: prescription.sets,
    reps: prescription.reps,
    intensity: prescription.intensity,
    notes: buildExerciseNotes(exercise, context, prescription.intensity, index),
    group: getExerciseGroupForDefinition(exercise),
    libraryRef: { source: 'strength_exercise', id: exercise.id },
  }
}

function orderStrengthExercisesForSession(
  exercises: StrengthSelectionExercise[],
  context: StrengthContext,
): StrengthSelectionExercise[] {
  if (exercises.length <= 1) return exercises

  const wantsEarlyCore =
    context.primarySport === 'squash' ||
    context.sportProfile === 'hybrid' ||
    context.sportProfile === 'sport_support' ||
    context.goal.toLowerCase().includes('zona media')

  if (!wantsEarlyCore) return exercises

  const core = exercises.filter((exercise) => exercise.group === 'core')
  const strength = exercises.filter((exercise) => exercise.group !== 'core' && exercise.group !== 'cardio' && exercise.group !== 'mobility')
  const cardio = exercises.filter((exercise) => exercise.group === 'cardio')
  const mobility = exercises.filter((exercise) => exercise.group === 'mobility')

  return [...core, ...strength, ...cardio, ...mobility]
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

  if (exercise.id === 'assault_bike_30_30') {
    return {
      sets: context.phase === 'build' && context.fatigueLevel <= 4 && (context.sessionDurationMin ?? 50) >= 65 ? 2 : 1,
      reps: '4 min: 30s fuerte / 30s suave',
      intensity: 'explosive',
    }
  }

  if (exercise.id === 'air_treadmill_20_20') {
    return {
      sets: context.phase === 'build' && context.fatigueLevel <= 4 && (context.sessionDurationMin ?? 50) >= 65 ? 2 : 1,
      reps: '4 min: 20s fuerte / 20s suave',
      intensity: 'explosive',
    }
  }

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

export function getProgressedPrescription(
  exercise: ExerciseDefinition,
  context: StrengthContext,
  index: number,
  progressionState = deriveStrengthProgressionState(context),
): {
  sets: number
  reps: number | string
  intensity: StrengthSelectionExercise['intensity']
} {
  const base = getPrescription(exercise, context, index)
  const isMainPattern = progressionState.mainPattern != null && exercise.movement === progressionState.mainPattern

  if (progressionState.intent === 'deload') {
    if (typeof base.reps === 'number') {
      return {
        sets: Math.max(2, base.sets - 1),
        reps: base.reps,
        intensity: base.intensity === 'heavy' || base.intensity === 'moderate-heavy' ? 'moderate' : 'light',
      }
    }
    return { ...base, sets: Math.max(2, base.sets - 1), intensity: 'controlled' }
  }

  if (progressionState.intent === 'progress' && isMainPattern && exercise.intensityType === 'strength') {
    if (context.phase === 'build') return { sets: 5, reps: 3, intensity: 'moderate-heavy' }
    if (context.phase === 'peak') return { sets: 5, reps: 3, intensity: 'heavy' }
    return { sets: Math.max(base.sets, 4), reps: typeof base.reps === 'number' ? Math.max(5, base.reps) : base.reps, intensity: 'moderate-heavy' }
  }

  if (progressionState.intent === 'hold' && isMainPattern && exercise.intensityType === 'strength') {
    return { ...base, intensity: base.intensity === 'heavy' ? 'moderate-heavy' : base.intensity }
  }

  // rotate: this exercise is a different pattern from the overused one — treat like a fresh hold
  if (progressionState.intent === 'rotate' && !isMainPattern && exercise.intensityType === 'strength') {
    return { ...base, intensity: 'moderate' }
  }

  return base
}

function buildExerciseNotes(
  exercise: ExerciseDefinition,
  context: StrengthContext,
  intensity: StrengthSelectionExercise['intensity'],
  index: number,
): string | undefined {
  if (exercise.category === 'core') {
    if (exercise.tags.includes('anti_extension') || exercise.id === 'plank' || exercise.id === 'dead_bug') {
      return 'Zona media: controla pelvis y costillas antes de pasar a la fuerza principal.'
    }
    if (exercise.tags.includes('lateral_stability')) {
      return 'Zona media: estabilidad lateral, cadera alta y respiración controlada.'
    }
    return 'Zona media: tronco firme, sin compensar con lumbar ni hombros.'
  }
  if (context.competitionSoon) {
    if (exercise.category === 'lower') return 'Solo activación. Deja repeticiones en reserva y evita generar dolor muscular.'
    return 'Ejecución limpia y sin fatiga acumulada antes de la competencia.'
  }
  if (context.fatigueLevel >= 7) {
    return 'Prioriza técnica limpia y detente mucho antes de llegar al fallo.'
  }
  if (exercise.intensityType === 'power') {
    if (exercise.tags.includes('court_conditioning')) {
      return 'Cardio específico al final: potencia corta y recuperación entre puntos; corta el bloque si cae la mecánica.'
    }
    if (exercise.riskLevel === 'high') {
      return 'Ejercicio de potencia avanzado. Volumen bajo, prioriza calidad de aterrizaje y detente si cae la velocidad o el control.'
    }
    return 'Cada repetición debe verse rápida. Corta la serie si cae la velocidad.'
  }
  if (context.primarySport === 'squash' && exercise.tags.includes('court_footwork')) {
    return 'Usá este bloque como coordinación y calidad de pisada, no como acondicionamiento.'
  }
  if (context.primarySport === 'squash' && exercise.tags.includes('anti_rotation')) {
    return 'Resiste la rotación y mantén las caderas apiladas para transferencia al squash.'
  }
  if (index === 0 && context.sportProfile === 'strength_primary') {
    return intensity === 'heavy'
      ? 'Ejercicio principal del día. Prioriza velocidad de barra y técnica repetible.'
      : 'Ejercicio principal del día. Construye volumen de calidad sin perder repeticiones.'
  }
  if (exercise.unilateral) {
    return 'Usá tempo controlado e igualá ambos lados.'
  }
  return undefined
}

export function summarizeStrengthProgression(context: StrengthContext): string {
  const state = deriveStrengthProgressionState(context)
  const acwrLabel = context.strengthAcwr?.ratio != null
    ? ` ACWR fuerza: ${context.strengthAcwr.ratio.toFixed(2)} (${context.strengthAcwr.status}).`
    : context.strengthAcwr?.status
      ? ` ACWR fuerza: ${context.strengthAcwr.status}.`
      : ''

  if (!state.mainPattern) {
    return `Sin historia suficiente: usar variacion estructurada segun contexto.${acwrLabel}`
  }

  switch (state.intent) {
    case 'progress':
      return `Patron principal ${state.mainPattern} en modo progress — escalar carga o densidad.${acwrLabel}`
    case 'hold':
      return `Patron principal ${state.mainPattern} en modo hold — mantener estimulo sin escalar.${acwrLabel}`
    case 'deload':
      return `Patron principal ${state.mainPattern} en modo deload — reducir volumen e intensidad.${acwrLabel}`
    case 'rotate':
      return `Patron ${state.mainPattern} sobreentrenado — rotar a patron distinto esta sesion.${acwrLabel}`
  }
}

function shouldIncludePower(context: StrengthContext): boolean {
  if (context.fatigueLevel >= 7) return false
  if (context.competitionSoon && context.sportProfile === 'sport_support') return false
  return context.phase === 'build' || context.phase === 'peak'
}

export function getTargetExerciseDensity(context: StrengthContext): StrengthExerciseDensity {
  const duration = context.sessionDurationMin ?? 50
  const base = getDurationExerciseDensity(duration)
  let modifier = 0

  if (context.competitionSoon || context.phase === 'taper') modifier -= 3
  if (context.fatigueLevel >= 7) modifier -= 2
  if (context.requireExtraRecovery) modifier -= 1
  if (
    context.sportProfile === 'strength_primary' &&
    (context.phase === 'base' || context.phase === 'build') &&
    !context.competitionSoon &&
    context.fatigueLevel < 7
  ) {
    modifier += 1
  }

  const absoluteMax = 10
  const minFloor = context.fatigueLevel >= 8 && (context.competitionSoon || context.phase === 'taper') ? 2 : 3
  const min = clamp(base.min + modifier, minFloor, absoluteMax)
  const target = clamp(base.target + modifier, min, absoluteMax)
  const max = clamp(base.max + modifier, target, absoluteMax)

  return { min, target, max }
}

function getDurationExerciseDensity(durationMin: number): StrengthExerciseDensity {
  if (durationMin <= 30) return { min: 3, target: 3, max: 4 }
  if (durationMin <= 44) return { min: 4, target: 4, max: 4 }
  if (durationMin <= 54) return { min: 5, target: 6, max: 7 }
  if (durationMin <= 69) return { min: 6, target: 8, max: 9 }
  return { min: 7, target: 9, max: 10 }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
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
  fallbackPredicate: (exercise: ExerciseDefinition) => boolean = predicate,
): ExerciseDefinition | undefined {
  return scored.find(({ exercise }) => predicate(exercise))?.exercise
    ?? scored.find(({ exercise }) =>
      fallbackPredicate(exercise) &&
      (context.sportProfile === 'strength_primary' ? exercise.intensityType === 'strength' : true),
    )?.exercise
}

function normalizeEquipment(availableEquipment?: string[]): EquipmentType[] {
  if (!availableEquipment || availableEquipment.length === 0) {
    return ['barbell', 'dumbbell', 'bodyweight', 'machine', 'cable', 'kettlebell', 'medball', 'bands', 'trap_bar', 'trx', 'box', 'ladder', 'plate', 'stability_ball', 'assault_bike', 'air_treadmill']
  }

  const mapped = availableEquipment
    .map((item) => item.toLowerCase().trim())
    .flatMap<EquipmentType>((item) => {
      if (item.includes('trap') || item.includes('hex')) return ['trap_bar']
      if (item.includes('trx') || item.includes('suspension')) return ['trx']
      if (item.includes('box') || item.includes('cajon') || item.includes('cajón')) return ['box']
      if (item.includes('ladder') || item.includes('escalera')) return ['ladder']
      if (item.includes('assault') || item.includes('asalto') || item.includes('air bike') || item.includes('bici')) return ['assault_bike']
      if (item.includes('air runner') || item.includes('trotadora') || item.includes('cinta') || item.includes('curved') || item.includes('curva')) return ['air_treadmill']
      if (item.includes('plate') || item.includes('disco')) return ['plate']
      if (item.includes('stability') || item.includes('swiss') || item.includes('fitball')) return ['stability_ball']
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
    safetyConstraints: [],
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
    safetyConstraints: [],
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
    safetyConstraints: [],
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
    safetyConstraints: [],
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
    safetyConstraints: [],
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
    safetyConstraints: [],
  })
  outputs.push(`variation=${buildA.exercises.map((exercise) => exercise.name).join(' / ')} <> ${buildB.exercises.map((exercise) => exercise.name).join(' / ')}`)
  outputs.push(`progression_signal=${summarizeStrengthProgression({
    phase: 'build',
    fatigueLevel: 4,
    recentExercises: buildA.exercises.map((exercise) => normalizeStrengthExerciseKey(exercise.name)),
    goal: 'fuerza lower y estabilidad',
    sportProfile: 'strength_primary',
    experienceLevel: 'intermediate',
    availableEquipment: ['barbell', 'dumbbell', 'bodyweight', 'cable'],
    sessionDurationMin: 65,
    competitionSoon: false,
    historicalSessions: [],
    safetyConstraints: [],
  })}`)

  return outputs
}

// Fase 2 implementada: intent 4-state (progress/hold/deload/rotate) con deteccion de frecuencia por patron y perfil deportivo.
// Pendiente Fase 3: progresion cuantitativa por kg, periodizacion completa, equipamiento persistido en perfil, metadata visible en UI.

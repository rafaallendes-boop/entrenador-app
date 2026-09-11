import { hasExerciseEquipment, resolveDeclaredEquipment } from './equipmentVocabulary'
import { isAthleticWorkAllowed, isFinisherExercise } from './athleticTraining'
import type {
  CoachExerciseProposal,
  SessionMetadata,
  SessionType,
  StrengthProfile,
  StrengthSafetyFinalizationSeal,
} from '../../types'
import type { ExerciseLibraryRef } from '../../types/exerciseLibraryRef'
import type { ConstraintKey, ConstraintSource, StrengthConstraint } from '../../types/strengthSafety'
import { resolveStrengthExercise, type ExerciseDefinition, type MovementPattern } from './exerciseLibrary'
import {
  constraintKey,
  hasUnresolvedMedicalRestriction,
  isExerciseAllowed,
  matchedConstraintKeys,
} from './strengthSafetyConstraints'
import {
  buildStrengthReplacementById,
  getStrengthReplacementPool,
  getTargetExerciseDensity,
  selectStrengthSession,
  type StrengthContext,
  type StrengthSelectionExercise,
} from './strengthSelector'
import {
  applyStrengthLoadCompletion,
  enhanceStrengthSessionExercises,
  getMinimumStrengthWorkCount,
  isStrengthWorkExercise,
  type StrengthStructureOptions,
} from './strengthSessionStructure'
import { normalizeSupersetGroups } from './supersetGroups'
import { planSupersetGroups, type SupersetPolicyMode } from './supersetPolicy'

export type { StrengthSafetyFinalizationSeal } from '../../types'

export const STRENGTH_SAFETY_POLICY_VERSION = 1

export type BlockedReason =
  | 'unresolved_medical_restriction'
  | 'insufficient_safe_pool'
  /** Ventana competitiva, fatiga aguda o sesión demasiado corta. No es una restricción. */
  | 'training_context_unavailable'
  | 'unresolvable_exercise_identity'

export interface RemovedExercise {
  exerciseId?: string
  libraryRef?: ExerciseLibraryRef
  reason: 'equipment_unavailable' | 'constraint_intersection' | 'unresolvable_identity' | 'ambiguous_identity' | 'training_context'
  matchedConstraints: readonly ConstraintKey[]
}

export interface ReplacedExercise {
  fromExerciseId: string
  toExerciseId: string
  movementPattern: MovementPattern
  matchedConstraints: readonly ConstraintKey[]
}

export type StrengthSafetyFinalization =
  | {
      status: 'ok'
      exercises: CoachExerciseProposal[]
      removed: RemovedExercise[]
      replaced: ReplacedExercise[]
    }
  | {
      status: 'blocked'
      reason: BlockedReason
      removed: RemovedExercise[]
    }

export interface FinalizeStrengthExercisesInput {
  exercises: CoachExerciseProposal[]
  constraints: readonly StrengthConstraint[]
  durationMin: number | undefined
  sessionType: SessionType
  selectionContext: StrengthContext
  /** Only normalized user-authored text may be passed here. */
  userMessage: string
  /** Required: each producer must make its superset policy explicit. */
  supersetMode: SupersetPolicyMode
  /**
   * Plan Builder may already have completed density through its block-wide I1
   * projection. Re-filling here would be a second, uncoordinated allocator.
   */
  densityCompletion?: 'fill' | 'preserve'
}

/**
 * The final fail-closed array pass. It deliberately also runs with no
 * constraints: identity, density, grouping and viability still need checking.
 */
export function finalizeStrengthExercisesForRestrictions(
  input: FinalizeStrengthExercisesInput,
): StrengthSafetyFinalization {
  if (hasUnresolvedMedicalRestriction(input.constraints)) {
    return { status: 'blocked', reason: 'unresolved_medical_restriction', removed: [] }
  }

  const removed: RemovedExercise[] = []
  const replaced: ReplacedExercise[] = []
  const kept: CoachExerciseProposal[] = []
  const hasFinisher = () => kept.some((exercise) => {
    const definition = resolveStrengthExercise(exercise)?.definition
    return definition != null && isFinisherExercise(definition)
  })
  // The finalizer owns the hard constraint set.  Callers may accidentally
  // carry an older selection context; never let that make replacement or
  // density selection broader than the constraints being finalized.
  const safetyContext: StrengthContext = {
    ...input.selectionContext,
    safetyConstraints: input.constraints,
    sessionDurationMin: input.durationMin ?? input.selectionContext.sessionDurationMin,
  }
  const availableEquipment = resolveDeclaredEquipment(safetyContext.availableEquipment).equipment
  const hasEquipment = (definition: ExerciseDefinition | undefined) =>
    definition != null && hasExerciseEquipment(definition, availableEquipment)
  const usedIds = new Set(
    input.exercises
      .map((exercise) => resolveStrengthExercise(exercise)?.definition?.id)
      .filter((id): id is string => id != null),
  )

  for (const exercise of input.exercises) {
    const resolution = resolveStrengthExercise(exercise)
    const definition = resolution?.definition
    if (!definition) {
      if (isPinnedByUser(exercise.name, input.userMessage)) {
        return { status: 'blocked', reason: 'unresolvable_exercise_identity', removed }
      }
      removed.push({
        libraryRef: exercise.libraryRef,
        reason: resolution?.matchKind === 'ambiguous' ? 'ambiguous_identity' : 'unresolvable_identity',
        matchedConstraints: [],
      })
      continue
    }

    if (!isAthleticWorkAllowed(definition, safetyContext) || (isFinisherExercise(definition) && hasFinisher())) {
      removed.push({ exerciseId: definition.id, reason: 'training_context', matchedConstraints: [] })
      continue
    }

    if (isExerciseAllowed(definition, input.constraints) && hasEquipment(definition)) {
      kept.push(exercise)
      continue
    }

    const matched = matchedConstraintKeys(definition, input.constraints)
    usedIds.delete(definition.id)
    const substituteId = getStrengthReplacementPool(
      { name: exercise.name, libraryRef: exercise.libraryRef },
      safetyContext,
    ).find((candidateId) => !usedIds.has(candidateId))
    const substitute = substituteId
      ? buildStrengthReplacementById(substituteId, safetyContext, kept.length)
      : undefined

    if (!substitute || !substituteId) {
      removed.push({
        exerciseId: definition.id,
        reason: hasEquipment(definition) ? 'constraint_intersection' : 'equipment_unavailable',
        matchedConstraints: matched,
      })
      continue
    }

    kept.push({ ...toProposal(substitute), supersetGroup: exercise.supersetGroup })
    usedIds.add(substituteId)
    replaced.push({
      fromExerciseId: definition.id,
      toExerciseId: substituteId,
      movementPattern: definition.movement,
      matchedConstraints: matched,
    })
  }

  const density = getTargetExerciseDensity(safetyContext)
  const candidates = selectStrengthSession(safetyContext).exercises
  const minimumStrengthWork = getMinimumStrengthWorkCount(input.durationMin ?? 50)
  let strengthWorkCount = kept.filter(isStrengthWorkExercise).length
  const addCandidate = (candidate: StrengthSelectionExercise): boolean => {
    const definition = resolveStrengthExercise(candidate)?.definition
    if (!definition || usedIds.has(definition.id) || (!isExerciseAllowed(definition, input.constraints) || !hasEquipment(definition))) return false
    if (isFinisherExercise(definition) && hasFinisher()) return false
    const proposal = toProposal(candidate)
    kept.push(proposal)
    usedIds.add(definition.id)
    if (isStrengthWorkExercise(proposal)) strengthWorkCount += 1
    return true
  }

  if (input.densityCompletion !== 'preserve') {
    // El selector devuelve orden de ejecución y puede poner todos sus cores al
    // principio. Si se rellenara hasta `density.target` en ese orden, una sesión
    // con pool real suficiente podría quedar llena de core y bloquearse por un
    // falso `insufficient_safe_pool`. Primero satisface trabajo de fuerza real.
    for (const candidate of candidates) {
      if (strengthWorkCount >= minimumStrengthWork) break
      if (!isStrengthWorkExercise(candidate)) continue
      addCandidate(candidate)
    }
    for (const candidate of candidates) {
      if (kept.length >= density.target) break
      addCandidate(candidate)
    }
  }

  const grouped = normalizeSupersetGroups(
    planSupersetGroups(kept, input.supersetMode).exercises,
  )
  for (const exercise of grouped) {
    const definition = resolveStrengthExercise(exercise)?.definition
    if (!definition) {
      return { status: 'blocked', reason: 'unresolvable_exercise_identity', removed }
    }
    if (!isExerciseAllowed(definition, input.constraints) || !hasEquipment(definition)) {
      return { status: 'blocked', reason: 'insufficient_safe_pool', removed }
    }
    if (!isAthleticWorkAllowed(definition, safetyContext)) {
      return { status: 'blocked', reason: 'training_context_unavailable', removed }
    }
  }

  const realStrengthWork = grouped.filter(isStrengthWorkExercise).length
  if (
    grouped.length < density.min ||
    realStrengthWork < minimumStrengthWork
  ) {
    // Un déficit causado SÓLO por retiros de contexto no es un pool inseguro:
    // no hay restricción que reportar y el copy médico mentiría.
    return {
      status: 'blocked',
      reason: removed.length > 0 && removed.every((item) => item.reason === 'training_context')
        ? 'training_context_unavailable'
        : 'insufficient_safe_pool',
      removed,
    }
  }

  return { status: 'ok', exercises: grouped, removed, replaced }
}

/**
 * Shape shared by nested `create_week` sessions and flat coach actions. The
 * generic return preserves all other proposal fields for every caller.
 */
export interface StrengthSessionLike {
  exercises?: CoachExerciseProposal[]
  durationMin?: number
  metadata?: SessionMetadata
}

export interface PrepareStrengthSessionOptions {
  constraints: readonly StrengthConstraint[]
  userMessageConstraints: readonly StrengthConstraint[]
  userMessage: string
  selectionContext: StrengthContext
  /** The wrapper supplies `safetyConstraints` from `constraints` to prevent drift. */
  structureOptions: Omit<StrengthStructureOptions, 'safetyConstraints'> & { strengthProfile?: StrengthProfile }
  supersetMode: SupersetPolicyMode
  /** Preserve Plan Builder's coordinated density projection during its terminal pass. */
  densityCompletion?: 'fill' | 'preserve'
  /** Nested create-week sessions use metadata; flat add/update actions use root. */
  sealLocation?: 'metadata' | 'root'
}

export type PrepareStrengthSessionResult<T extends StrengthSessionLike> =
  | {
      status: 'ok'
      session: T
      removed: RemovedExercise[]
      replaced: ReplacedExercise[]
    }
  | {
      status: 'blocked'
      session: T
      reason: BlockedReason
      removed: RemovedExercise[]
      replaced: []
    }

/**
 * The only public session-level entry point: enriches unsealed/changed input,
 * always finalizes it, then writes the local seal in its declared location.
 * A valid seal prevents re-enrichment, never enforcement.
 */
export function prepareStrengthSession<T extends StrengthSessionLike>(
  session: T,
  options: PrepareStrengthSessionOptions,
): PrepareStrengthSessionResult<T> {
  const sealLocation = options.sealLocation ?? 'metadata'
  const existingSeal = readSeal(session, sealLocation)
  const existingExercises = session.exercises ?? []
  const sealIsValid = isSealValid(
    existingSeal,
    existingExercises,
    options.constraints,
    'strength',
    session.durationMin,
  )
  const exercises = sealIsValid
    ? existingExercises
    : enhanceStrengthSessionExercises(existingExercises, {
        ...options.structureOptions,
        safetyConstraints: options.constraints,
      }) ?? []
  const finalized = finalizeStrengthExercisesForRestrictions({
    exercises,
    constraints: options.constraints,
    durationMin: session.durationMin,
    sessionType: 'strength',
    selectionContext: options.selectionContext,
    userMessage: options.userMessage,
    supersetMode: options.supersetMode,
    densityCompletion: options.densityCompletion,
  })
  if (finalized.status === 'blocked') {
    emitStrengthSafetyTelemetry(finalized, options.constraints)
    return {
      status: 'blocked',
      session,
      reason: finalized.reason,
      removed: finalized.removed,
      replaced: [],
    }
  }

  // La exclusión sustituye y rellena DESPUÉS del enriquecimiento, así que sus
  // ejercicios llegarían sin carga ni esfuerzo. Esta pasada es un `map` puro:
  // completa campos y no puede reintroducir contenido no verificado, de modo
  // que el finalizador sigue siendo terminal en cuanto a membresía.
  const enrichedExercises = applyStrengthLoadCompletion(
    [...finalized.exercises],
    options.structureOptions?.strengthProfile,
  )
  const finalizedWithLoads = { ...finalized, exercises: enrichedExercises }

  const seal = buildStrengthSafetySeal(
    finalizedWithLoads.exercises,
    options.constraints,
    'strength',
    session.durationMin,
    options.userMessageConstraints,
  )
  emitStrengthSafetyTelemetry(finalized, options.constraints)
  return {
    status: 'ok',
    session: writeSeal({ ...session, exercises: finalizedWithLoads.exercises }, seal, sealLocation),
    removed: finalized.removed,
    replaced: finalized.replaced,
  }
}

/**
 * Eventos estructurados sin texto del atleta ni nombres visibles. La consola
 * sigue el mismo transporte liviano de `stageLogger`; el backend puede
 * capturarlos sin convertir al finalizador en una dependencia de red.
 */
function emitStrengthSafetyTelemetry(
  result: StrengthSafetyFinalization,
  constraints: readonly StrengthConstraint[],
): void {
  if (typeof console === 'undefined' || typeof console.info !== 'function') return
  const emit = (payload: Record<string, unknown>) => {
    try {
      console.info(JSON.stringify(payload))
    } catch {
      // La observabilidad nunca puede alterar el resultado de seguridad.
    }
  }

  for (const item of result.removed) {
    emit({
      event: 'strength.safety.exercise_removed',
      exerciseId: item.exerciseId,
      reason: item.reason,
      constraintKeys: item.matchedConstraints,
      sources: sourcesForKeys(constraints, item.matchedConstraints),
    })
  }

  if (result.status === 'blocked') {
    const keys = constraints.map(constraintKey)
    emit({
      event: 'strength.safety.blocked',
      reason: result.reason,
      constraintKeys: keys,
      sources: sourcesForKeys(constraints, keys),
    })
    return
  }

  for (const item of result.replaced) {
    emit({
      event: 'strength.safety.exercise_replaced',
      fromExerciseId: item.fromExerciseId,
      toExerciseId: item.toExerciseId,
      movementPattern: item.movementPattern,
      constraintKeys: item.matchedConstraints,
      sources: sourcesForKeys(constraints, item.matchedConstraints),
    })
  }
}

function sourcesForKeys(
  constraints: readonly StrengthConstraint[],
  keys: readonly ConstraintKey[],
): readonly ConstraintSource[] {
  const selected = new Set(keys)
  const sources = new Set<ConstraintSource>()
  for (const constraint of constraints) {
    if (!selected.has(constraintKey(constraint))) continue
    for (const source of constraint.sources) sources.add(source)
  }
  return [...sources]
}

export function buildStrengthSafetySeal(
  exercises: readonly CoachExerciseProposal[],
  constraints: readonly StrengthConstraint[],
  sessionType: SessionType,
  durationMin: number | undefined,
  userMessageConstraints: readonly StrengthConstraint[],
): StrengthSafetyFinalizationSeal {
  return {
    policyVersion: STRENGTH_SAFETY_POLICY_VERSION,
    exerciseFingerprint: fingerprintExercises(exercises, sessionType, durationMin),
    constraintFingerprint: fingerprintConstraints(constraints),
    userMessageConstraints,
  }
}

export function isSealValid(
  seal: StrengthSafetyFinalizationSeal | undefined,
  exercises: readonly CoachExerciseProposal[],
  constraints: readonly StrengthConstraint[],
  sessionType: SessionType,
  durationMin: number | undefined,
): boolean {
  if (!seal || seal.policyVersion !== STRENGTH_SAFETY_POLICY_VERSION) return false
  try {
    return seal.exerciseFingerprint === fingerprintExercises(exercises, sessionType, durationMin)
      && seal.constraintFingerprint === fingerprintConstraints(constraints)
  } catch {
    return false
  }
}

function readSeal(
  session: StrengthSessionLike,
  sealLocation: 'metadata' | 'root',
): StrengthSafetyFinalizationSeal | undefined {
  if (sealLocation === 'metadata') return session.metadata?.strengthSafetyFinalization
  return (session as StrengthSessionLike & { strengthSafetyFinalization?: StrengthSafetyFinalizationSeal })
    .strengthSafetyFinalization
}

function writeSeal<T extends StrengthSessionLike>(
  session: T,
  seal: StrengthSafetyFinalizationSeal,
  sealLocation: 'metadata' | 'root',
): T {
  if (sealLocation === 'metadata') {
    return {
      ...session,
      metadata: { ...session.metadata, strengthSafetyFinalization: seal },
    }
  }
  return {
    ...session,
    strengthSafetyFinalization: seal,
  } as T
}

function fingerprintExercises(
  exercises: readonly CoachExerciseProposal[],
  sessionType: SessionType,
  durationMin: number | undefined,
): string {
  const payload = exercises.map((exercise) => {
    const id = resolveStrengthExercise(exercise)?.definition?.id
    if (!id) throw new Error('No se puede sellar un ejercicio sin identidad canónica')
    return [
      id,
      exercise.sets,
      exercise.reps,
      exercise.weight ?? null,
      exercise.targetPercent1RM ?? null,
      exercise.targetRpe ?? null,
      (exercise.warmupSets ?? []).map((set) => [
        set.reps,
        set.percent1RM ?? null,
        set.weight ?? null,
      ]),
      exercise.supersetGroup ?? null,
      exercise.group ?? null,
    ]
  })
  return hash(JSON.stringify({ sessionType, durationMin, payload }))
}

function fingerprintConstraints(constraints: readonly StrengthConstraint[]): string {
  // El resolver ya entrega restricciones y fuentes en orden canónico. Mantener
  // ese orden en el payload hace que el sello también detecte una colección
  // adulterada o construida por fuera de la autoridad.
  const payload = constraints.map((constraint) => [
    constraintKey(constraint),
    [...constraint.sources],
  ])
  return hash(JSON.stringify(payload))
}

function toProposal(exercise: StrengthSelectionExercise): CoachExerciseProposal {
  return {
    name: exercise.name,
    sets: exercise.sets,
    reps: exercise.reps,
    notes: exercise.notes,
    group: exercise.group,
    targetPercent1RM: exercise.targetPercent1RM,
    targetRpe: exercise.targetRpe,
    libraryRef: exercise.libraryRef,
  }
}

function isPinnedByUser(name: string, userMessage: string): boolean {
  if (!userMessage.trim()) return false
  const normalizedMessage = normalizeText(userMessage)
  const normalizedName = normalizeText(name)
  return normalizedName.length >= 6 && normalizedMessage.includes(normalizedName)
}

function normalizeText(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** FNV-1a is a change detector, never an authentication mechanism. */
function hash(value: string): string {
  let result = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 0x01000193) >>> 0
  }
  return result.toString(16).padStart(8, '0')
}

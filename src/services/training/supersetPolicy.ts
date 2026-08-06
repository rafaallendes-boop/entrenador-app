import type { ExerciseGroup } from '../../types'
import { v4 as uuid } from '../../utils/uuid'
import { resolveSessionStrengthRoles } from '../planBuilder/strengthRoleContract'
import { resolveStrengthExercise } from './exerciseLibrary'
import { resolveStrengthExerciseBlock } from './strengthSessionStructure'
import type { StrengthPhase, StrengthSportProfile } from './strengthSelector'
import { normalizeSupersetGroups, type SupersetCandidate } from './supersetGroups'

export type SupersetPolicyMode = 'off' | 'permissive' | 'full'

export type SupersetRule =
  | 'eligibility'
  | 'core_circuit'
  | 'push_pull'
  | 'main_lift_plyo'
  | 'olympic_pull'

export type SupersetOutcome =
  | 'grouped'
  | 'sets_mismatch'
  | 'no_eligible_partner'
  | 'blocked_kind'

/**
 * Los indices se refieren a la lista normalizada de entrada, antes del reflow.
 * Un consumidor que necesite resolver nombres debe indexar esa lista, no la
 * salida de `planSupersetGroups`.
 */
export interface SupersetPolicyDecision {
  rule: SupersetRule
  outcome: SupersetOutcome
  anchorIndex: number
  memberIndexes: number[]
  groupId?: string
}

interface SupersetUnit {
  anchorIndex: number
  memberIndexes: number[]
  groupId?: string
}

/** Pliometricos de baja dosis, enumerados por identidad estable. */
const PLYOMETRIC_EXERCISE_IDS: ReadonlySet<string> = new Set([
  'box_jump',
  'jump_squat',
  'broad_jump',
  'single_leg_broad_jump',
  'drop_jump',
  'depth_jump',
  'half_kneeling_lateral_jump',
  'lateral_skater_jumps',
  'alternating_step_up_jump',
  'pogo_jumps',
])

export function isPlyometricExercise(exercise: SupersetCandidate): boolean {
  const definition = resolveStrengthExercise(exercise)?.definition
  return definition != null && PLYOMETRIC_EXERCISE_IDS.has(definition.id)
}

export function isOlympicPowerExercise(exercise: SupersetCandidate): boolean {
  const definition = resolveStrengthExercise(exercise)?.definition
  return definition?.tags.includes('olympic_power') === true
}

function isNeverGroupable(block: ExerciseGroup): boolean {
  return block === 'cardio' || block === 'mobility'
}

/**
 * Forma grupos sin cambiar la prescripcion. Los grupos existentes son
 * autoritativos; la politica solo considera ejercicios que siguen libres tras
 * normalizarlos.
 */
export function planSupersetGroups<T extends SupersetCandidate>(
  exercises: readonly T[],
  mode: SupersetPolicyMode,
): { exercises: T[]; decisions: SupersetPolicyDecision[] } {
  const normalized = normalizeSupersetGroups(exercises)
  if (mode === 'off') return { exercises: normalized, decisions: [] }

  const roles = resolveSessionStrengthRoles(normalized)
  const blocks = normalized.map((exercise) => resolveStrengthExerciseBlock(exercise))
  const decisions: SupersetPolicyDecision[] = []
  const unavailable = new Set<number>()
  const units: SupersetUnit[] = []

  let cursor = 0
  while (cursor < normalized.length) {
    const groupId = normalized[cursor]!.supersetGroup
    if (groupId == null) {
      units.push({ anchorIndex: cursor, memberIndexes: [cursor] })
      cursor += 1
      continue
    }

    let end = cursor
    while (
      end + 1 < normalized.length
      && normalized[end + 1]!.supersetGroup === groupId
    ) {
      end += 1
    }
    const memberIndexes = Array.from(
      { length: end - cursor + 1 },
      (_, offset) => cursor + offset,
    )
    memberIndexes.forEach((index) => unavailable.add(index))
    units.push({ anchorIndex: cursor, memberIndexes, groupId })
    cursor = end + 1
  }

  for (const index of normalized.keys()) {
    if (unavailable.has(index) || !isNeverGroupable(blocks[index]!)) continue
    unavailable.add(index)
    decisions.push({
      rule: 'eligibility',
      outcome: 'blocked_kind',
      anchorIndex: index,
      memberIndexes: [index],
    })
  }

  const unitOf = (index: number): SupersetUnit => {
    const unit = units.find((candidate) => candidate.memberIndexes.includes(index))
    if (!unit) throw new Error(`Unidad de superserie inexistente para el indice ${index}`)
    return unit
  }

  const removeUnit = (unit: SupersetUnit) => {
    const index = units.indexOf(unit)
    if (index >= 0) units.splice(index, 1)
  }

  const freeIndexes = (
    predicate: (exercise: T, index: number) => boolean,
  ): number[] => normalized
    .map((exercise, index) => ({ exercise, index }))
    .filter(({ exercise, index }) => (
      !unavailable.has(index) && predicate(exercise, index)
    ))
    .map(({ index }) => index)

  const pairWith = (
    rule: SupersetRule,
    anchorIndex: number,
    candidates: readonly number[],
  ) => {
    if (candidates.length === 0) {
      decisions.push({
        rule,
        outcome: 'no_eligible_partner',
        anchorIndex,
        memberIndexes: [anchorIndex],
      })
      return
    }

    const anchorSets = normalized[anchorIndex]!.sets
    const partnerIndex = candidates.find((index) => normalized[index]!.sets === anchorSets)
    if (partnerIndex == null) {
      decisions.push({
        rule,
        outcome: 'sets_mismatch',
        anchorIndex,
        memberIndexes: [anchorIndex, ...candidates],
      })
      return
    }

    const anchorUnit = unitOf(anchorIndex)
    const partnerUnit = unitOf(partnerIndex)
    const groupId = uuid()
    anchorUnit.memberIndexes.push(partnerIndex)
    anchorUnit.groupId = groupId
    removeUnit(partnerUnit)
    unavailable.add(anchorIndex)
    unavailable.add(partnerIndex)
    decisions.push({
      rule,
      outcome: 'grouped',
      anchorIndex,
      memberIndexes: [anchorIndex, partnerIndex],
      groupId,
    })
  }

  const trunkIndexes = freeIndexes((_, index) => roles[index] === 'trunk')
  if (trunkIndexes.length >= 2) {
    const cohorts = new Map<number, number[]>()
    for (const index of trunkIndexes) {
      const sets = normalized[index]!.sets
      cohorts.set(sets, [...(cohorts.get(sets) ?? []), index])
    }

    const bestCohort = [...cohorts.values()]
      .sort((left, right) => right.length - left.length || left[0]! - right[0]!)[0]!

    if (bestCohort.length >= 2) {
      const anchorIndex = bestCohort[0]!
      const anchorUnit = unitOf(anchorIndex)
      const groupId = uuid()
      anchorUnit.groupId = groupId
      for (const memberIndex of bestCohort.slice(1)) {
        const memberUnit = unitOf(memberIndex)
        anchorUnit.memberIndexes.push(memberIndex)
        removeUnit(memberUnit)
      }
      bestCohort.forEach((index) => unavailable.add(index))
      decisions.push({
        rule: 'core_circuit',
        outcome: 'grouped',
        anchorIndex,
        memberIndexes: bestCohort,
        groupId,
      })
    } else {
      decisions.push({
        rule: 'core_circuit',
        outcome: 'sets_mismatch',
        anchorIndex: trunkIndexes[0]!,
        memberIndexes: trunkIndexes,
      })
    }
  }

  if (mode === 'full') {
    const mainLiftIndex = freeIndexes((_, index) => roles[index] === 'main_lift')[0]
    if (mainLiftIndex != null) {
      pairWith(
        'main_lift_plyo',
        mainLiftIndex,
        freeIndexes((exercise, index) => (
          index !== mainLiftIndex && isPlyometricExercise(exercise)
        )),
      )
    }

    const olympicIndex = freeIndexes((exercise) => isOlympicPowerExercise(exercise))[0]
    if (olympicIndex != null) {
      pairWith(
        'olympic_pull',
        olympicIndex,
        freeIndexes((_, index) => (
          index !== olympicIndex
          && blocks[index] === 'pull'
          && roles[index] === 'accessory'
        )),
      )
    }
  }

  const pushIndex = freeIndexes((_, index) => (
    blocks[index] === 'push' && roles[index] === 'accessory'
  ))[0]
  if (pushIndex != null) {
    pairWith(
      'push_pull',
      pushIndex,
      freeIndexes((_, index) => (
        index !== pushIndex
        && blocks[index] === 'pull'
        && roles[index] === 'accessory'
      )),
    )
  }

  const result = [...units]
    .sort((left, right) => left.anchorIndex - right.anchorIndex)
    .flatMap((unit) => unit.memberIndexes.map((index) => {
      const exercise = normalized[index]!
      if (unit.groupId == null) {
        if (exercise.supersetGroup == null) return exercise
        const next = { ...exercise } as T
        delete (next as { supersetGroup?: string }).supersetGroup
        return next
      }
      if (exercise.supersetGroup === unit.groupId) return exercise
      return { ...exercise, supersetGroup: unit.groupId } as T
    }))

  return { exercises: result, decisions }
}

export interface SupersetPolicyContext {
  phase?: StrengthPhase
  sportProfile?: StrengthSportProfile
  sessionDurationMin?: number
  prefersSupersets?: boolean
}

const MODE_RANK: Record<SupersetPolicyMode, number> = {
  off: 0,
  permissive: 1,
  full: 2,
}
const RANK_MODE: readonly SupersetPolicyMode[] = ['off', 'permissive', 'full']

const PHASE_MODE_CAP: Record<StrengthPhase, SupersetPolicyMode> = {
  base: 'full',
  build: 'full',
  peak: 'permissive',
  taper: 'permissive',
  race: 'permissive',
  transition: 'permissive',
}

const VALID_PROFILES: ReadonlySet<string> = new Set<StrengthSportProfile>([
  'strength_primary',
  'hybrid',
  'sport_support',
])

function hasInvalidInput(context: SupersetPolicyContext): boolean {
  if (context.phase == null || !Object.hasOwn(PHASE_MODE_CAP, context.phase)) return true
  if (context.sportProfile == null || !VALID_PROFILES.has(context.sportProfile)) return true
  const duration = context.sessionDurationMin
  return typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0
}

function resolveBaseMode(context: SupersetPolicyContext): SupersetPolicyMode {
  const phase = context.phase!
  const duration = context.sessionDurationMin!

  if (phase === 'taper' || phase === 'race') return 'off'
  if (phase === 'transition') return 'off'
  if (duration < 45) return 'off'
  if (
    context.sportProfile === 'strength_primary'
    && (phase === 'base' || phase === 'build')
    && duration >= 55
  ) {
    return 'full'
  }
  return 'permissive'
}

function upgradeOneLevel(mode: SupersetPolicyMode): SupersetPolicyMode {
  return RANK_MODE[Math.min(MODE_RANK[mode] + 1, MODE_RANK.full)]!
}

function minMode(left: SupersetPolicyMode, right: SupersetPolicyMode): SupersetPolicyMode {
  return MODE_RANK[left] <= MODE_RANK[right] ? left : right
}

/** Resuelve el modo para toda entrada posible; R0 es un `off` absoluto. */
export function shouldApplySupersetPolicy(context: SupersetPolicyContext): SupersetPolicyMode {
  if (hasInvalidInput(context)) return 'off'

  const baseMode = resolveBaseMode(context)
  const requestedMode = context.prefersSupersets
    ? upgradeOneLevel(baseMode)
    : baseMode

  return minMode(requestedMode, PHASE_MODE_CAP[context.phase!])
}

const SUPERSET_TERM = '(?:superserie|superseries|super\\s?serie|triserie|triseries|circuito|circuitos|agrup\\w*)'
const POSITIVE_PATTERN = new RegExp(`\\b${SUPERSET_TERM}\\b`, 'g')
const NEGATIVE_PATTERN = new RegExp(
  `\\b(?:sin|nada\\s+de|no)\\s+(?:\\w+\\s+){0,3}?${SUPERSET_TERM}\\b`,
  'g',
)

function normalizeIntentText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

interface Span {
  start: number
  end: number
}

function collectSpans(text: string, pattern: RegExp): Span[] {
  return [...text.matchAll(pattern)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }))
}

/** La ultima mencion explicita prevalece sobre menciones anteriores. */
export function detectSupersetPreference(intentText: string): boolean {
  const text = normalizeIntentText(intentText)
  const negatives = collectSpans(text, NEGATIVE_PATTERN)
  const positives = collectSpans(text, POSITIVE_PATTERN)
    .filter((span) => !negatives.some((negative) => (
      span.start >= negative.start && span.end <= negative.end
    )))

  const lastNegative = negatives[negatives.length - 1]
  const lastPositive = positives[positives.length - 1]

  if (lastPositive == null) return false
  if (lastNegative == null) return true
  return lastPositive.start > lastNegative.start
}

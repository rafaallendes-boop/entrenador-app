import type { Exercise, Session } from '../../types'
import type {
  SessionTemplateExercise,
  SessionTemplatePayload,
} from '../../types/sessionTemplate'
import { sanitizeExerciseLibraryRef } from '../../types/exerciseLibraryRef'
import { jsonStructurallyEqual } from '../../utils/canonicalJson'
import { fromISO, getWeekStart, toISO } from '../../utils/date'
import { v4 as uuid } from '../../utils/uuid'
import { normalizeSupersetGroupId, normalizeSupersetGroups } from '../training/supersetGroups'
import {
  buildCyclingDetailsDraft,
  buildSquashDetailsDraft,
  draftToNewSessionFields,
  EXERCISE_TYPES,
  resolveCoachSquashKind,
  resolveSquashTrainingFocus,
  type CoachSessionDraft,
  type CoachSessionPatch,
} from './coachSessionSerializer'
import { projectSquashSubtype } from '../training/squashSessionHydrator'

function isExerciseType(type: string): boolean {
  return (EXERCISE_TYPES as readonly string[]).includes(type)
}

function toTemplateExercise(exercise: Record<string, unknown>): SessionTemplateExercise {
  const copy = structuredClone(exercise)
  delete copy.id
  delete copy.completed
  return copy as unknown as SessionTemplateExercise
}

/** Explicit allowlist: new Session fields never enter a template implicitly. */
export function sessionToTemplatePayload(session: Session): SessionTemplatePayload {
  return {
    type: session.type,
    timeBlock: session.timeBlock,
    title: session.title,
    durationMin: session.durationMin,
    objective: session.objective,
    location: session.location,
    rpe: session.rpe,
    notes: session.notes,
    subtype: session.subtype,
    squashDetails: session.squashDetails ? structuredClone(session.squashDetails) : undefined,
    runningDetails: session.runningDetails ? structuredClone(session.runningDetails) : undefined,
    cyclingDetails: session.cyclingDetails ? structuredClone(session.cyclingDetails) : undefined,
    mobilityDetails: session.mobilityDetails ? structuredClone(session.mobilityDetails) : undefined,
    warmup: session.warmup ? structuredClone(session.warmup) : undefined,
    cooldown: session.cooldown ? structuredClone(session.cooldown) : undefined,
    exercises: session.exercises?.length
      ? session.exercises.map((exercise) => (
          toTemplateExercise(exercise as unknown as Record<string, unknown>)
        ))
      : undefined,
  }
}

/** New templates get the same sport defaults and protocols as new sessions. */
export function templateDraftToPayload(draft: CoachSessionDraft): SessionTemplatePayload {
  const fields = draftToNewSessionFields(draft)
  return sessionToTemplatePayload({
    ...fields,
    id: '',
    createdAt: 0,
    updatedAt: 0,
  } as Session)
}

function exerciseToDraft(
  id: string,
  exercise: SessionTemplateExercise,
): NonNullable<CoachSessionDraft['exercises']>[number] {
  return {
    id,
    name: exercise.name,
    sets: exercise.sets,
    reps: String(exercise.reps),
    weight: exercise.weight,
    notes: exercise.notes,
    libraryRef: sanitizeExerciseLibraryRef(exercise.libraryRef),
    supersetGroup: normalizeSupersetGroupId(exercise.supersetGroup),
  }
}

/** Payload to reusable SessionForm state plus ephemeral exercise identities. */
export function templateToDraft(
  payload: SessionTemplatePayload,
  date: string,
): { draft: CoachSessionDraft; originalsById: Map<string, SessionTemplateExercise> } {
  const originalsById = new Map<string, SessionTemplateExercise>()
  const exercises = payload.exercises?.map((exercise) => {
    const draftId = uuid()
    originalsById.set(draftId, exercise)
    return exerciseToDraft(draftId, exercise)
  })
  return {
    originalsById,
    draft: {
      date,
      timeBlock: payload.timeBlock,
      type: payload.type,
      title: payload.title,
      durationMin: payload.durationMin,
      objective: payload.objective,
      location: payload.location,
      rpe: payload.rpe,
      notes: payload.notes,
      subtype: payload.subtype,
      squashKind: payload.type === 'squash'
        ? resolveCoachSquashKind(payload.squashDetails, payload.subtype)
        : undefined,
      runningTargets: payload.runningDetails
        ? {
            runningType: payload.runningDetails.runningType,
            targetPaceMin: payload.runningDetails.targetPaceMin,
            targetPaceMax: payload.runningDetails.targetPaceMax,
            targetHrMin: payload.runningDetails.targetHrMin,
            targetHrMax: payload.runningDetails.targetHrMax,
          }
        : undefined,
      exercises,
    },
  }
}

function mergeTemplateExercises(
  drafts: CoachSessionDraft['exercises'],
  originalsById: Map<string, SessionTemplateExercise>,
): SessionTemplateExercise[] | undefined {
  if (!drafts?.length) return undefined
  const merged = drafts
    .filter((draft) => draft.name.trim())
    .map((draft) => {
      const mergedExercise = structuredClone({
        ...(originalsById.get(draft.id) ?? {}),
        name: draft.name.trim(),
        sets: draft.sets,
        reps: draft.reps.trim() || '10',
        weight: draft.weight,
        notes: draft.notes?.trim() || undefined,
      }) as SessionTemplateExercise
      const libraryRef = sanitizeExerciseLibraryRef(draft.libraryRef)
      if (libraryRef) mergedExercise.libraryRef = libraryRef
      else delete mergedExercise.libraryRef
      const supersetGroup = normalizeSupersetGroupId(draft.supersetGroup)
      if (supersetGroup) mergedExercise.supersetGroup = supersetGroup
      else delete mergedExercise.supersetGroup
      return mergedExercise
    })
  return merged.length > 0 ? merged : undefined
}

function squashSessionMode(subtype: CoachSessionDraft['subtype']) {
  return subtype === 'competitive'
    ? 'competition_match' as const
    : subtype === 'match'
      ? 'practice_match' as const
      : 'drill_session' as const
}

function mergeCyclingDerivedDetails(
  existing: SessionTemplatePayload['cyclingDetails'],
  runningType: NonNullable<CoachSessionDraft['runningTargets']>['runningType'],
  objective: string,
): SessionTemplatePayload['cyclingDetails'] {
  const regenerated = buildCyclingDetailsDraft(runningType, objective)
  if (!existing) return regenerated
  return {
    ...existing,
    sessionCategory: regenerated.sessionCategory,
    targetStructure: regenerated.targetStructure,
    intensityReference: regenerated.intensityReference,
  }
}

/**
 * Applies the complete visible form to a payload. Rich fields survive same-type
 * edits; a type change rebuilds only the new sport's defaults.
 */
export function applyTemplateDraft(
  existing: SessionTemplatePayload,
  draft: CoachSessionDraft,
  originalsById: Map<string, SessionTemplateExercise>,
): SessionTemplatePayload {
  if (draft.type !== existing.type) {
    const regenerated = templateDraftToPayload(draft)
    return {
      ...regenerated,
      exercises: isExerciseType(draft.type)
        ? mergeTemplateExercises(draft.exercises, originalsById)
        : undefined,
    }
  }

  const next: SessionTemplatePayload = {
    ...structuredClone(existing),
    timeBlock: draft.timeBlock,
    title: draft.title.trim(),
    durationMin: draft.durationMin,
    objective: draft.objective?.trim() || undefined,
    location: draft.location?.trim() || undefined,
    rpe: draft.rpe,
    notes: draft.notes?.trim() || undefined,
  }

  if (existing.type === 'squash') {
    next.subtype = draft.subtype
    const squashKind = draft.squashKind
      ?? resolveCoachSquashKind(next.squashDetails, draft.subtype)
    const subtype = draft.subtype ?? projectSquashSubtype(squashKind)
    next.squashDetails = next.squashDetails
      ? {
        ...next.squashDetails,
        sessionKind: squashKind,
        trainingFocus: resolveSquashTrainingFocus(
          subtype,
          draft.objective ?? '',
        ),
        sessionMode: squashSessionMode(subtype),
      }
      : buildSquashDetailsDraft(squashKind, subtype, draft.objective ?? '')
  }

  if ((existing.type === 'running' || existing.type === 'cycling') && draft.runningTargets) {
    const previousRunningType = existing.runningDetails?.runningType
    next.runningDetails = {
      ...existing.runningDetails,
      ...draft.runningTargets,
    }
    if (existing.type === 'cycling' && draft.runningTargets.runningType !== previousRunningType) {
      next.cyclingDetails = mergeCyclingDerivedDetails(
        existing.cyclingDetails,
        draft.runningTargets.runningType,
        draft.objective ?? '',
      )
    }
  }

  // SessionForm edits exercises for squash/strength/mobility. For every other
  // same-type template the array is opaque rich content and must survive.
  if (isExerciseType(existing.type)) {
    next.exercises = mergeTemplateExercises(draft.exercises, originalsById)
  }
  return next
}

function originalExerciseDrafts(
  originalsById: Map<string, SessionTemplateExercise>,
): CoachSessionDraft['exercises'] {
  if (originalsById.size === 0) return undefined
  return Array.from(originalsById, ([id, exercise]) => exerciseToDraft(id, exercise))
}

/** Only fields changed relative to the version that the user opened. */
export function templateDraftToPatch(
  openedPayload: SessionTemplatePayload,
  draft: CoachSessionDraft,
  originalsById: Map<string, SessionTemplateExercise>,
): CoachSessionPatch {
  if (draft.type !== openedPayload.type) return { ...draft }

  const originalVisible: Omit<CoachSessionDraft, 'date'> = {
    timeBlock: openedPayload.timeBlock,
    type: openedPayload.type,
    title: openedPayload.title,
    durationMin: openedPayload.durationMin,
    objective: openedPayload.objective,
    location: openedPayload.location,
    rpe: openedPayload.rpe,
    notes: openedPayload.notes,
    subtype: openedPayload.subtype,
    squashKind: openedPayload.type === 'squash'
      ? resolveCoachSquashKind(openedPayload.squashDetails, openedPayload.subtype)
      : undefined,
    runningTargets: openedPayload.runningDetails
      ? {
          runningType: openedPayload.runningDetails.runningType,
          targetPaceMin: openedPayload.runningDetails.targetPaceMin,
          targetPaceMax: openedPayload.runningDetails.targetPaceMax,
          targetHrMin: openedPayload.runningDetails.targetHrMin,
          targetHrMax: openedPayload.runningDetails.targetHrMax,
        }
      : undefined,
    exercises: originalExerciseDrafts(originalsById),
  }
  const patch: CoachSessionPatch = {}
  const keys: Array<keyof typeof originalVisible> = [
    'timeBlock',
    'title',
    'durationMin',
    'objective',
    'location',
    'rpe',
    'notes',
    'subtype',
    'squashKind',
    'runningTargets',
    'exercises',
  ]
  for (const key of keys) {
    if (!jsonStructurallyEqual(draft[key], originalVisible[key])) {
      Object.assign(patch, { [key]: draft[key] })
    }
  }
  return patch
}

function hasPatchKey(patch: CoachSessionPatch, key: keyof CoachSessionPatch): boolean {
  return Object.prototype.hasOwnProperty.call(patch, key)
}

/**
 * A `type` key means the user changed the sport, which by contract carries a
 * complete draft rather than a sparse patch. The contract is enforced here so a
 * violation surfaces as a named error instead of a `TypeError` several frames
 * deeper inside `draftToNewSessionFields`.
 */
function asCompleteDraft(patch: CoachSessionPatch): CoachSessionDraft {
  const missing = (['date', 'timeBlock', 'type', 'title', 'durationMin'] as const)
    .filter((key) => patch[key] === undefined)
  if (missing.length > 0) {
    throw new Error(
      `applyTemplatePatch: a patch carrying "type" must be a complete draft; missing ${missing.join(', ')}.`,
    )
  }
  return patch as CoachSessionDraft
}

/** Applies a visible patch to the latest local payload, preserving concurrent fields. */
export function applyTemplatePatch(
  latest: SessionTemplatePayload,
  patch: CoachSessionPatch,
  originalsById: Map<string, SessionTemplateExercise>,
): SessionTemplatePayload {
  if (hasPatchKey(patch, 'type')) {
    const fullDraft = asCompleteDraft(patch)
    const regenerated = templateDraftToPayload(fullDraft)
    return {
      ...regenerated,
      exercises: isExerciseType(fullDraft.type)
        ? mergeTemplateExercises(fullDraft.exercises, originalsById)
        : undefined,
    }
  }

  const next = structuredClone(latest)
  if (hasPatchKey(patch, 'timeBlock') && patch.timeBlock !== undefined) {
    next.timeBlock = patch.timeBlock
  }
  if (hasPatchKey(patch, 'title') && patch.title !== undefined) next.title = patch.title.trim()
  if (hasPatchKey(patch, 'durationMin') && patch.durationMin !== undefined) {
    next.durationMin = patch.durationMin
  }
  if (hasPatchKey(patch, 'objective')) next.objective = patch.objective?.trim() || undefined
  if (hasPatchKey(patch, 'location')) next.location = patch.location?.trim() || undefined
  if (hasPatchKey(patch, 'rpe')) next.rpe = patch.rpe
  if (hasPatchKey(patch, 'notes')) next.notes = patch.notes?.trim() || undefined

  if (latest.type === 'squash' && hasPatchKey(patch, 'subtype')) {
    next.subtype = patch.subtype
  }
  if (
    latest.type === 'squash'
    && (
      hasPatchKey(patch, 'subtype')
      || hasPatchKey(patch, 'squashKind')
      || hasPatchKey(patch, 'objective')
    )
  ) {
    // Un patch que sólo cambia el objetivo no declara modalidad. Recomputarla
    // igual colapsaba una plantilla `mixed` heredada, porque
    // `resolveCoachSquashKind` nunca devuelve `mixed` y cae a `subtype`.
    const declaresModality = hasPatchKey(patch, 'squashKind') || hasPatchKey(patch, 'subtype')
    const squashKind = patch.squashKind
      ?? (declaresModality
        ? resolveCoachSquashKind(next.squashDetails, next.subtype)
        : next.squashDetails?.sessionKind ?? resolveCoachSquashKind(next.squashDetails, next.subtype))
    const subtype = next.subtype ?? projectSquashSubtype(
      squashKind === 'mixed' ? 'technical' : squashKind,
    )
    next.squashDetails = next.squashDetails
      ? {
          ...next.squashDetails,
          sessionKind: squashKind,
          trainingFocus: resolveSquashTrainingFocus(subtype, next.objective ?? ''),
          sessionMode: squashSessionMode(subtype),
        }
      : buildSquashDetailsDraft(
          squashKind === 'mixed' ? 'technical' : squashKind,
          subtype,
          next.objective ?? '',
        )
  }

  if (
    (latest.type === 'running' || latest.type === 'cycling')
    && hasPatchKey(patch, 'runningTargets')
    && patch.runningTargets
  ) {
    const previousRunningType = latest.runningDetails?.runningType
    next.runningDetails = { ...latest.runningDetails, ...patch.runningTargets }
    if (latest.type === 'cycling' && patch.runningTargets.runningType !== previousRunningType) {
      next.cyclingDetails = mergeCyclingDerivedDetails(
        latest.cyclingDetails,
        patch.runningTargets.runningType,
        next.objective ?? '',
      )
    }
  }

  if (hasPatchKey(patch, 'exercises') && isExerciseType(latest.type)) {
    next.exercises = mergeTemplateExercises(patch.exercises, originalsById)
  }
  return next
}

/** Materializes a fresh planned coach session for the selected athlete/date. */
export function materializeTemplateSession(
  payload: SessionTemplatePayload,
  options: {
    date: string
    overlayDraft: CoachSessionDraft
    originalsById: Map<string, SessionTemplateExercise>
  },
): Omit<Session, 'id' | 'athleteId' | 'authoredByRole' | 'createdAt' | 'updatedAt'> {
  const { date, overlayDraft, originalsById } = options
  const draftForDate = { ...overlayDraft, date }
  const base = draftToNewSessionFields(draftForDate)
  const mergedPayload = applyTemplateDraft(payload, draftForDate, originalsById)
  const richFields = {
    ...(mergedPayload.squashDetails !== undefined
      ? { squashDetails: mergedPayload.squashDetails }
      : {}),
    ...(mergedPayload.runningDetails !== undefined
      ? { runningDetails: mergedPayload.runningDetails }
      : {}),
    ...(mergedPayload.cyclingDetails !== undefined
      ? { cyclingDetails: mergedPayload.cyclingDetails }
      : {}),
    ...(mergedPayload.mobilityDetails !== undefined
      ? { mobilityDetails: mergedPayload.mobilityDetails }
      : {}),
    ...(mergedPayload.warmup !== undefined ? { warmup: mergedPayload.warmup } : {}),
    ...(mergedPayload.cooldown !== undefined ? { cooldown: mergedPayload.cooldown } : {}),
  }
  // Re-emitir ids de grupo por aplicacion: dos aplicaciones de la misma
  // plantilla en el mismo dia no pueden compartir id de superserie, o el
  // normalizador disolveria el segundo segmento por su regla de contiguidad.
  const materializedExercises = (() => {
    const groupIds = new Map<string, string>()
    return mergedPayload.exercises?.map((exercise): Exercise => {
      const copy = structuredClone(exercise) as Record<string, unknown>
      delete copy.libraryRef
      delete copy.supersetGroup
      const libraryRef = sanitizeExerciseLibraryRef(exercise.libraryRef)
      const sourceGroup = normalizeSupersetGroupId(exercise.supersetGroup)
      let supersetGroup: string | undefined
      if (sourceGroup) {
        if (!groupIds.has(sourceGroup)) groupIds.set(sourceGroup, uuid())
        supersetGroup = groupIds.get(sourceGroup)
      }
      return {
        ...copy,
        id: uuid(),
        completed: false,
        ...(libraryRef ? { libraryRef } : {}),
        ...(supersetGroup ? { supersetGroup } : {}),
      } as Exercise
    })
  })()
  return {
    ...base,
    ...richFields,
    date,
    weekStartDate: toISO(getWeekStart(fromISO(date))),
    exercises: materializedExercises ? normalizeSupersetGroups(materializedExercises) : undefined,
  } as Omit<Session, 'id' | 'athleteId' | 'authoredByRole' | 'createdAt' | 'updatedAt'>
}

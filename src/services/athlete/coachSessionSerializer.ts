import type {
  CyclingDetails,
  Exercise,
  MatchResult,
  MobilityDetails,
  RunningType,
  Session,
  SessionType,
  SquashDetails,
  SquashSubtype,
  SquashTrainingFocus,
  TimeBlock,
} from '../../types'
import type { ExerciseLibraryRef } from '../../types/exerciseLibraryRef'
import { fromISO, getWeekStart, toISO } from '../../utils/date'
import { generateDefaultProtocols } from '../trainingProtocols'
import { normalizeSupersetGroupId } from '../training/supersetGroups'

export interface CoachSessionDraft {
  date: string
  timeBlock: TimeBlock
  type: SessionType
  title: string
  durationMin: number
  objective?: string
  location?: string
  rpe?: number
  notes?: string
  subtype?: SquashSubtype
  opponent?: string
  matchResult?: MatchResult
  gamesWon?: number
  gamesLost?: number
  runningTargets?: {
    runningType: RunningType
    targetPaceMin?: string
    targetPaceMax?: string
    targetHrMin?: number
    targetHrMax?: number
  }
  exercises?: Array<{
    id: string
    name: string
    sets: number
    reps: string
    weight?: number
    notes?: string
    libraryRef?: ExerciseLibraryRef
    supersetGroup?: string
  }>
}

export type CoachSessionPatch = Partial<CoachSessionDraft>

export function sessionToDraft(session: Session): CoachSessionDraft {
  return {
    date: session.date,
    timeBlock: session.timeBlock,
    type: session.type,
    title: session.title,
    durationMin: session.durationMin,
    objective: session.objective,
    location: session.location,
    rpe: session.rpe,
    notes: session.notes,
    subtype: session.subtype,
    opponent: session.opponent,
    matchResult: session.matchResult,
    gamesWon: session.gamesWon,
    gamesLost: session.gamesLost,
    runningTargets: session.runningDetails
      ? {
          runningType: session.runningDetails.runningType,
          targetPaceMin: session.runningDetails.targetPaceMin,
          targetPaceMax: session.runningDetails.targetPaceMax,
          targetHrMin: session.runningDetails.targetHrMin,
          targetHrMax: session.runningDetails.targetHrMax,
        }
      : undefined,
    exercises: session.exercises?.map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      sets: exercise.sets,
      reps: String(exercise.reps),
      weight: exercise.weight,
      notes: exercise.notes,
      libraryRef: exercise.libraryRef,
      supersetGroup: normalizeSupersetGroupId(exercise.supersetGroup),
    })),
  }
}

function structurallyEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function exercisesForComparison(
  exercises: CoachSessionDraft['exercises'],
): CoachSessionDraft['exercises'] {
  return exercises?.length ? exercises : undefined
}

export function draftToPatch(draft: CoachSessionDraft, original: Session): CoachSessionPatch {
  if (draft.type !== original.type) return { ...draft }
  const originalDraft = sessionToDraft(original)
  const patch: CoachSessionPatch = {}
  for (const key of Object.keys(draft) as Array<keyof CoachSessionDraft>) {
    const nextValue = key === 'exercises' ? exercisesForComparison(draft.exercises) : draft[key]
    const originalValue = key === 'exercises'
      ? exercisesForComparison(originalDraft.exercises)
      : originalDraft[key]
    if (!structurallyEqual(nextValue, originalValue)) {
      Object.assign(patch, { [key]: draft[key] })
    }
  }
  return patch
}

export function buildCyclingDetailsDraft(runningType: RunningType, objective: string): CyclingDetails {
  const byType: Record<RunningType, Pick<CyclingDetails, 'sessionCategory' | 'targetStructure' | 'intensityReference' | 'executionNotes'>> = {
    z2: {
      sessionCategory: 'support aerobic',
      targetStructure: 'Rodaje continuo en Z1-Z2 con cadencia estable.',
      intensityReference: 'Conversacional, respiracion controlada, sin cierres agresivos.',
      executionNotes: 'Mantener piernas sueltas y sumar base sin convertirlo en dia duro.',
    },
    tempo: {
      sessionCategory: 'fatigue-managed threshold',
      targetStructure: 'Bloque principal sostenido en tempo o sweetspot bajo con recuperaciones suaves.',
      intensityReference: 'RPE 6-7 sostenido, sin entrar en VO2.',
      executionNotes: 'Buscar control y estabilidad de potencia, no vaciarse.',
    },
    intervals: {
      sessionCategory: 'primary build',
      targetStructure: 'Series estructuradas con recuperacion activa y vuelta a la calma completa.',
      intensityReference: 'RPE 8 en los bloques duros, con recuperacion real entre repeticiones.',
      executionNotes: 'Calidad alta, tecnica estable y sin perder cadencia.',
    },
    long: {
      sessionCategory: 'support aerobic',
      targetStructure: 'Fondo aerobico sostenido con nutricion y ritmo parejo.',
      intensityReference: 'Z2 sostenido, sin picos innecesarios.',
      executionNotes: 'Usar como construccion de resistencia, no como carrera encubierta.',
    },
  }
  const base = byType[runningType]
  return {
    ...base,
    executionNotes: objective.trim() ? `${base.executionNotes} Foco extra: ${objective.trim()}.` : base.executionNotes,
  }
}

export function buildMobilityDetailsDraft(objective: string): MobilityDetails {
  const normalized = objective.toLowerCase()
  const focusAreas = [
    normalized.includes('hombro') ? 'hombro' : null,
    normalized.includes('torac') || normalized.includes('columna') ? 'toracica/columna' : null,
    normalized.includes('tobillo') ? 'tobillo' : null,
    normalized.includes('cadera') ? 'cadera' : null,
  ].filter((item): item is string => Boolean(item))
  return {
    context: 'full_body',
    focusAreas: focusAreas.length > 0 ? focusAreas : ['cadera', 'toracica/columna'],
    targetStructure: 'Flujo breve con movilidad articular, respiracion y estiramientos activos bien dosificados.',
    executionNotes: 'Buscar rango util y sensacion de soltura, no fatiga.',
  }
}

export function resolveSquashTrainingFocus(
  subtype: SquashSubtype,
  objective: string,
): SquashTrainingFocus {
  const normalized = objective.toLowerCase()
  if (subtype === 'match') return 'conditioned_games'
  if (subtype === 'competitive') return 'tactical'
  if (/(fisic|acelera|potencia|resisten|carga|intens)/.test(normalized)) return 'physical'
  if (/(tact|decision|patron|estrateg|ritmo|presion)/.test(normalized)) return 'tactical'
  if (/(game|set|partido|punto condicionado)/.test(normalized)) return 'conditioned_games'
  return 'technical'
}

export function buildSquashDetailsDraft(subtype: SquashSubtype, objective: string): SquashDetails {
  return {
    trainingFocus: resolveSquashTrainingFocus(subtype, objective),
    sessionMode: subtype === 'competitive'
      ? 'competition_match'
      : subtype === 'match'
        ? 'practice_match'
        : 'drill_session',
    drills: [],
  }
}

export const EXERCISE_TYPES: SessionType[] = ['squash', 'strength', 'mobility']

function buildTypeDefaults(
  draft: Pick<CoachSessionDraft, 'type' | 'subtype' | 'rpe' | 'objective' | 'runningTargets'>,
): Partial<Session> {
  const runningType = draft.runningTargets?.runningType ?? 'z2'
  const protocols = generateDefaultProtocols({
    type: draft.type,
    subtype: draft.type === 'squash' ? draft.subtype : undefined,
    rpe: draft.rpe,
    runningType: draft.type === 'running' || draft.type === 'cycling' ? runningType : undefined,
  })
  return {
    warmup: protocols.warmup,
    cooldown: protocols.cooldown,
    runningDetails: draft.type === 'running' || draft.type === 'cycling'
      ? {
          runningType,
          targetPaceMin: draft.runningTargets?.targetPaceMin,
          targetPaceMax: draft.runningTargets?.targetPaceMax,
          targetHrMin: draft.runningTargets?.targetHrMin,
          targetHrMax: draft.runningTargets?.targetHrMax,
        }
      : undefined,
    squashDetails: draft.type === 'squash'
      ? buildSquashDetailsDraft(draft.subtype ?? 'training', draft.objective ?? '')
      : undefined,
    cyclingDetails: draft.type === 'cycling'
      ? buildCyclingDetailsDraft(runningType, draft.objective ?? '')
      : undefined,
    mobilityDetails: draft.type === 'mobility'
      ? buildMobilityDetailsDraft(draft.objective ?? '')
      : undefined,
  }
}

function draftExercisesToExercises(
  drafts: NonNullable<CoachSessionDraft['exercises']>,
  existing: Exercise[] | undefined,
): Exercise[] {
  const byId = new Map((existing ?? []).map((exercise) => [exercise.id, exercise]))
  return drafts
    .filter((draft) => draft.name.trim())
    .map((draft) => {
      const reps = draft.reps.trim() || '10'
      const notes = draft.notes?.trim() || undefined
      const supersetGroup = normalizeSupersetGroupId(draft.supersetGroup)
      const prior = byId.get(draft.id)
      if (prior) {
        const next: Exercise = {
          ...prior,
          name: draft.name.trim(),
          sets: draft.sets,
          reps,
          weight: draft.weight,
          notes,
        }
        if (draft.libraryRef) next.libraryRef = draft.libraryRef
        else delete next.libraryRef
        if (supersetGroup) next.supersetGroup = supersetGroup
        else delete next.supersetGroup
        return next
      }
      return {
        id: draft.id,
        name: draft.name.trim(),
        sets: draft.sets,
        reps,
        weight: draft.weight,
        notes,
        completed: false,
        ...(draft.libraryRef ? { libraryRef: draft.libraryRef } : {}),
        ...(supersetGroup ? { supersetGroup } : {}),
      }
    })
}

export function draftToNewSessionFields(
  draft: CoachSessionDraft,
): Omit<Session, 'id' | 'athleteId' | 'authoredByRole' | 'createdAt' | 'updatedAt'> {
  return {
    date: draft.date,
    weekStartDate: toISO(getWeekStart(fromISO(draft.date))),
    timeBlock: draft.timeBlock,
    type: draft.type,
    status: 'planned',
    source: 'coach',
    title: draft.title.trim(),
    objective: draft.objective?.trim() || undefined,
    durationMin: draft.durationMin,
    location: draft.location?.trim() || undefined,
    rpe: draft.rpe,
    notes: draft.notes?.trim() || undefined,
    subtype: draft.type === 'squash' ? draft.subtype : undefined,
    opponent: draft.type === 'squash' ? draft.opponent?.trim() || undefined : undefined,
    matchResult: draft.type === 'squash' ? draft.matchResult : undefined,
    gamesWon: draft.type === 'squash' ? draft.gamesWon : undefined,
    gamesLost: draft.type === 'squash' ? draft.gamesLost : undefined,
    ...buildTypeDefaults(draft),
    exercises: draft.exercises?.length && EXERCISE_TYPES.includes(draft.type)
      ? draftExercisesToExercises(draft.exercises, undefined)
      : undefined,
  } as Omit<Session, 'id' | 'athleteId' | 'authoredByRole' | 'createdAt' | 'updatedAt'>
}

function scalarPatch(patch: CoachSessionPatch): Partial<Session> {
  const out: Partial<Session> = {}
  const has = (key: keyof CoachSessionPatch) => Object.prototype.hasOwnProperty.call(patch, key)
  if (has('date') && patch.date !== undefined) out.date = patch.date
  if (has('timeBlock') && patch.timeBlock !== undefined) out.timeBlock = patch.timeBlock
  if (has('title') && patch.title !== undefined) out.title = patch.title.trim()
  if (has('durationMin') && patch.durationMin !== undefined) out.durationMin = patch.durationMin
  if (has('objective')) out.objective = patch.objective?.trim() || undefined
  if (has('location')) out.location = patch.location?.trim() || undefined
  if (has('rpe')) out.rpe = patch.rpe
  if (has('notes')) out.notes = patch.notes?.trim() || undefined
  if (has('opponent')) out.opponent = patch.opponent?.trim() || undefined
  if (has('matchResult')) out.matchResult = patch.matchResult
  if (has('gamesWon')) out.gamesWon = patch.gamesWon
  if (has('gamesLost')) out.gamesLost = patch.gamesLost
  return out
}

export function applyCoachSessionPatch(existing: Session, patch: CoachSessionPatch): Session {
  const has = (key: keyof CoachSessionPatch) => Object.prototype.hasOwnProperty.call(patch, key)
  const typeChanged = patch.type !== undefined && patch.type !== existing.type
  if (typeChanged) {
    const merged: Record<string, unknown> = { ...existing }
    for (const field of [
      'subtype', 'opponent', 'matchResult', 'gamesWon', 'gamesLost', 'squashDetails',
      'runningDetails', 'cyclingDetails', 'mobilityDetails', 'exercises',
    ]) {
      delete merged[field]
    }
    const draftLike = {
      type: patch.type!,
      subtype: patch.subtype,
      rpe: has('rpe') ? patch.rpe : existing.rpe,
      objective: has('objective') ? patch.objective : existing.objective,
      runningTargets: patch.runningTargets,
    }
    return {
      ...(merged as unknown as Session),
      ...scalarPatch(patch),
      type: patch.type!,
      subtype: patch.type === 'squash' ? patch.subtype : undefined,
      ...buildTypeDefaults(draftLike),
      exercises: patch.exercises?.length && EXERCISE_TYPES.includes(patch.type!)
        ? draftExercisesToExercises(patch.exercises, existing.exercises)
        : undefined,
    } as Session
  }

  const next: Session = { ...existing, ...scalarPatch(patch) } as Session
  if (existing.type === 'squash' && has('subtype')) {
    next.subtype = patch.subtype
    if (patch.subtype && next.squashDetails && patch.subtype !== existing.subtype) {
      next.squashDetails = {
        ...next.squashDetails,
        sessionMode: patch.subtype === 'competitive'
          ? 'competition_match'
          : patch.subtype === 'match'
            ? 'practice_match'
            : 'drill_session',
      }
    }
  }
  if (
    existing.type === 'squash'
    && has('objective')
    && patch.objective !== existing.objective
    && next.squashDetails
  ) {
    next.squashDetails = {
      ...next.squashDetails,
      trainingFocus: resolveSquashTrainingFocus(next.subtype ?? 'training', patch.objective ?? ''),
    }
  }
  if ((existing.type === 'running' || existing.type === 'cycling') && has('runningTargets')) {
    const targets = patch.runningTargets
    if (targets) {
      next.runningDetails = { ...existing.runningDetails, ...targets }
      if (
        existing.type === 'cycling'
        && targets.runningType !== existing.runningDetails?.runningType
      ) {
        const regenerated = buildCyclingDetailsDraft(
          targets.runningType,
          has('objective') ? patch.objective ?? '' : existing.objective ?? '',
        )
        next.cyclingDetails = {
          ...existing.cyclingDetails,
          sessionCategory: regenerated.sessionCategory,
          targetStructure: regenerated.targetStructure,
          intensityReference: regenerated.intensityReference,
        } as CyclingDetails
      }
    }
  }
  if (has('exercises')) {
    next.exercises = patch.exercises
      ? draftExercisesToExercises(patch.exercises, existing.exercises)
      : undefined
  }
  return next
}

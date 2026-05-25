import type {
  AthleteProfile,
  CoachExerciseProposal,
  CoachSessionProposal,
  DayOfWeek,
  GoalEventLevel,
  PlanWizardConfig,
  SupportedSport,
  WizardFatigueLevel,
} from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { getExpectedSessionsForPlanWeek, getPlanWeekDateRange, isDateInsidePlanWeekRange } from './dateRange'
import { selectSquashDrills, type SquashSelectionDesiredKind, type SquashSelectionPhase } from '../training/drillSelector'
import { findSquashDrillByName, normalizeSquashDrillKey } from '../training/drillLibrary'
import { selectRunningSession, type RunningPhase, type RunningSportProfile } from '../training/runningSelector'
import {
  getTargetExerciseDensity,
  selectStrengthSession,
  type StrengthContext,
  type StrengthPhase,
  type StrengthSelectionExercise,
  type StrengthSportProfile,
} from '../training/strengthSelector'
import { enhanceStrengthSessionExercises, resolveStrengthExerciseBlock } from '../training/strengthSessionStructure'
import { findStrengthExerciseByName, normalizeStrengthExerciseKey, type ExperienceLevel } from '../training/exerciseLibrary'
import { selectMobilitySession, type MobilityPhase } from '../training/mobilitySelector'
import { selectCyclingSession, type CyclingPhase, type CyclingSportProfile } from '../training/cyclingSelector'
import type { MobilitySportContext } from '../training/mobilitySessionLibrary'
import type { CyclingRole } from '../training/cyclingSessionLibrary'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RepairContext {
  plan: TrainingPlan
  week: TrainingPlanWeek
  profile: AthleteProfile
  wizardConfig: PlanWizardConfig
  previousWeek?: TrainingPlanWeek
}

export interface RepairWarning {
  code: string
  message: string
  sessionDate?: string
}

export interface RepairMeta {
  rawSessionCount: number
  repairedSessionCount: number
  movedSessionCount: number
  addedFallbackCount: number
  droppedSessionCount: number
  filteredSportCount: number
  warnings: RepairWarning[]
}

export interface RepairResult {
  sessions: CoachSessionProposal[]
  meta: RepairMeta
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function repairGeneratedWeek(
  rawSessions: CoachSessionProposal[],
  context: RepairContext,
): RepairResult {
  const meta: RepairMeta = {
    rawSessionCount: rawSessions.length,
    repairedSessionCount: 0,
    movedSessionCount: 0,
    addedFallbackCount: 0,
    droppedSessionCount: 0,
    filteredSportCount: 0,
    warnings: [],
  }

  if (rawSessions.length === 0) {
    return { sessions: [], meta }
  }

  let sessions = rawSessions.map((s) => ({ ...s }))

  // 1. Drop invalid dates
  const validDateSessions: CoachSessionProposal[] = []
  for (const s of sessions) {
    if (isStrictISODate(s.date)) {
      validDateSessions.push(s)
    } else {
      meta.droppedSessionCount++
      meta.warnings.push({ code: 'invalid_date', message: `Sesión "${s.title}" eliminada: fecha inválida (${s.date}).`, sessionDate: s.date })
    }
  }
  sessions = validDateSessions

  // 2. Move sessions outside the week range
  sessions = moveOutOfWeekSessions(sessions, context, meta)

  // 3. Move sessions on disallowed days
  sessions = moveOutOfAllowedDaySessions(sessions, context, meta)

  // 4. Resolve date+timeBlock collisions
  sessions = resolveCollisions(sessions, context, meta)

  // 5. Filter disallowed sports
  sessions = filterDisallowedSports(sessions, context, meta)

  // 6. Complete sport details (best-effort)
  completeSportDetails(sessions, context, meta)

  // 7. Balance session count
  sessions = balanceSessionCount(sessions, context, meta)

  // 8. Preserve primary-sport minimums after fallback/trim decisions
  sessions = ensurePrimarySportMinimum(sessions, context, meta)

  // 9. Diversify duplicated sport content after fallbacks are added
  diversifyDuplicateSquashSessions(sessions, context, meta)

  return { sessions, meta }
}

// ─── 1. Date validation ──────────────────────────────────────────────────────

function isStrictISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}

// ─── 2. Move out-of-week sessions ───────────────────────────────────────────

function moveOutOfWeekSessions(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  const allowedDates = getAllowedDatesInWeek(context)

  return sessions.map((s) => {
    if (isDateInsidePlanWeekRange(s.date, context.plan, context.week)) return s

    const available = findNearestAvailableDate(allowedDates, sessions, s.timeBlock, undefined, context.wizardConfig)
    if (available) {
      meta.movedSessionCount++
      meta.warnings.push({ code: 'moved_into_week', message: `Sesión "${s.title}" movida de ${s.date} a ${available.date} (fuera del rango válido de la semana).`, sessionDate: s.date })
      return { ...s, date: available.date, timeBlock: available.timeBlock }
    }

    meta.droppedSessionCount++
    meta.warnings.push({ code: 'drop_out_of_week', message: `Sesión "${s.title}" eliminada: fuera de semana y sin espacio disponible.`, sessionDate: s.date })
    return null
  }).filter((s): s is CoachSessionProposal => s !== null)
}

// ─── 3. Move sessions on disallowed days ────────────────────────────────────

function moveOutOfAllowedDaySessions(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  const allowedDays = new Set(context.wizardConfig.trainingDays)
  const allowedDates = getAllowedDatesInWeek(context)

  return sessions.map((s) => {
    const dayOfWeek = isoDateToDayOfWeek(s.date)
    if (dayOfWeek && allowedDays.has(dayOfWeek)) return s

    const available = findNearestAvailableDate(allowedDates, sessions, s.timeBlock, s.date, context.wizardConfig)
    if (available) {
      meta.movedSessionCount++
      meta.warnings.push({ code: 'moved_allowed_day', message: `Sesión "${s.title}" movida de ${s.date} a ${available.date} (día no permitido).`, sessionDate: s.date })
      return { ...s, date: available.date, timeBlock: available.timeBlock }
    }
    return s // keep it; validator will flag it
  })
}

// ─── 4. Resolve collisions ──────────────────────────────────────────────────

function resolveCollisions(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  const occupied = new Set<string>()
  const result: CoachSessionProposal[] = []
  const allowDoubleSession = context.wizardConfig.allowDoubleSession

  for (const s of sessions) {
    const key = `${s.date}|${s.timeBlock}`
    if (!occupied.has(key)) {
      occupied.add(key)
      result.push(s)
      continue
    }

    // Try opposite timeBlock on the same date
    const oppositeBlock = s.timeBlock === 'AM' ? 'PM' : 'AM'
    const oppositeKey = `${s.date}|${oppositeBlock}`
    if (allowDoubleSession && canUseDoubleSessionOnDate(s.date, context.wizardConfig) && !occupied.has(oppositeKey)) {
      occupied.add(oppositeKey)
      meta.movedSessionCount++
      meta.warnings.push({ code: 'collision_resolved', message: `Sesión "${s.title}" movida a ${s.date} ${oppositeBlock} (colisión).`, sessionDate: s.date })
      result.push({ ...s, timeBlock: oppositeBlock })
      continue
    }

    // Try a different allowed date
    const allowedDates = getAllowedDatesInWeek(context)
    const available = findNearestAvailableDate(allowedDates, [...sessions, ...result], s.timeBlock, s.date, context.wizardConfig)
    if (available) {
      const newKey = `${available.date}|${available.timeBlock}`
      occupied.add(newKey)
      meta.movedSessionCount++
      meta.warnings.push({ code: 'collision_resolved', message: `Sesión "${s.title}" movida a ${available.date} ${available.timeBlock} (colisión).`, sessionDate: s.date })
      result.push({ ...s, date: available.date, timeBlock: available.timeBlock })
      continue
    }

    meta.droppedSessionCount++
    meta.warnings.push({ code: 'collision_drop', message: `Sesión "${s.title}" eliminada: colisión sin espacio disponible.`, sessionDate: s.date })
  }

  return result
}

// ─── 5. Filter disallowed sports ────────────────────────────────────────────

function filterDisallowedSports(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  const allowed = getAllowedSports(context)

  return sessions.filter((s) => {
    if (allowed.has(s.sessionType as SupportedSport)) return true
    meta.filteredSportCount++
    meta.droppedSessionCount++
    meta.warnings.push({ code: 'sport_not_allowed', message: `Sesión "${s.title}" eliminada: deporte ${s.sessionType} no permitido.`, sessionDate: s.date })
    return false
  })
}

// ─── 6. Complete sport details ──────────────────────────────────────────────

function completeSportDetails(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): void {
  const currentWeekSquashDrills = extractRecentSquashDrills(context.previousWeek)
  const currentWeekStrengthExercises = extractRecentStrengthExercises(context.previousWeek)

  for (const session of sessions) {
    try {
      switch (session.sessionType) {
        case 'squash':
          if (!hasValidSquashDetails(session)) {
            completeSquashDetails(session, context, currentWeekSquashDrills)
            meta.repairedSessionCount++
          } else if (hasUnresolvedSquashDrills(session)) {
            completeSquashDetails(session, context, currentWeekSquashDrills)
            meta.repairedSessionCount++
            meta.warnings.push({ code: 'squash_unknown_drills_repaired', message: `Sesión "${session.title}" regenerada: usaba drills fuera de catálogo.`, sessionDate: session.date })
          }
          currentWeekSquashDrills.push(...extractSquashDrillNames(session))
          break
        case 'running':
          if (!session.runningType) {
            completeRunningDetails(session, context)
            meta.repairedSessionCount++
          }
          break
        case 'strength':
          if (!session.exercises || session.exercises.length === 0) {
            completeStrengthExercises(session, context, currentWeekStrengthExercises)
            meta.repairedSessionCount++
          } else if (enhanceStrengthSessionDetails(session, context, currentWeekStrengthExercises)) {
            meta.repairedSessionCount++
          }
          currentWeekStrengthExercises.push(...(session.exercises ?? []).map((exercise) => exercise.name))
          break
        case 'mobility':
          if (!session.mobilityDetails) {
            completeMobilityDetails(session, context)
            meta.repairedSessionCount++
          }
          break
        case 'cycling':
          if (!session.cyclingDetails) {
            completeCyclingDetails(session, context)
            meta.repairedSessionCount++
          }
          break
      }
    } catch {
      meta.warnings.push({ code: 'repair_failed', message: `No se pudo completar detalles para "${session.title}" (${session.sessionType}).`, sessionDate: session.date })
    }
  }
}

function hasValidSquashDetails(session: CoachSessionProposal): boolean {
  const d = session.squashDetails
  if (!d) return false
  return Boolean(d.trainingFocus) && Array.isArray(d.drills) && d.drills.length > 0 && Boolean(d.sessionKind)
}

function hasUnresolvedSquashDrills(session: CoachSessionProposal): boolean {
  const names = extractSquashDrillNames(session)
  if (names.length === 0) return false
  return names.some((name) => findSquashDrillByName(name) == null)
}

function completeSquashDetails(
  session: CoachSessionProposal,
  context: RepairContext,
  recentDrills = extractRecentSquashDrills(context.previousWeek),
): void {
  const phase = mapPhase(context.week.phase) as SquashSelectionPhase
  const result = selectSquashDrills({
    fatigueLevel: fatigueToNumber(context.wizardConfig.currentFatigue),
    phase,
    recentDrills,
    goal: buildLevelAwareGoal(context, context.profile.mainGoal ?? ''),
    competitionSoon: false,
    competitiveLevel: deriveCompetitiveLevel(context),
    desiredKind: mapSubtypeToDesiredKind(session.subtype) ?? inferSquashDesiredKind(session, recentDrills),
  })
  applySquashSelection(session, result)
}

function applySquashSelection(
  session: CoachSessionProposal,
  result: ReturnType<typeof selectSquashDrills>,
): void {
  session.squashDetails = {
    trainingFocus: result.trainingFocus,
    drills: result.drills,
    sessionMode: session.subtype === 'match' || session.subtype === 'competitive' ? 'practice_match' : 'drill_session',
    sessionKind: result.sessionKind,
    blocks: result.blocks,
  }
}

function diversifyDuplicateSquashSessions(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): void {
  const squashSessions = sessions.filter((session) => session.sessionType === 'squash')
  if (squashSessions.length < 2) return

  const seen = new Set<string>()
  const usedDrills = extractRecentSquashDrills(context.previousWeek)
  let repairedCount = 0

  for (const session of squashSessions) {
    const signature = buildSquashDrillSignature(session)
    if (signature && !seen.has(signature)) {
      seen.add(signature)
      usedDrills.push(...extractSquashDrillNames(session))
      continue
    }

    const repaired = rebuildSquashDetailsAvoidingDuplicates(session, context, usedDrills, seen)
    const nextSignature = buildSquashDrillSignature(session)
    if (repaired && nextSignature && !seen.has(nextSignature)) {
      seen.add(nextSignature)
      usedDrills.push(...extractSquashDrillNames(session))
      repairedCount++
      continue
    }

    if (nextSignature) seen.add(nextSignature)
    usedDrills.push(...extractSquashDrillNames(session))
  }

  if (repairedCount > 0) {
    meta.repairedSessionCount += repairedCount
    meta.warnings.push({
      code: 'squash_duplicate_drills_repaired',
      message: `Se regeneraron ${repairedCount} sesiones de squash para evitar repetir los mismos drills.`,
    })
  }
}

function rebuildSquashDetailsAvoidingDuplicates(
  session: CoachSessionProposal,
  context: RepairContext,
  usedDrills: string[],
  seenSignatures: Set<string>,
): boolean {
  const preferred = inferSquashDesiredKind(session, usedDrills)
  const candidatePool: SquashSelectionDesiredKind[] = [
    ...(preferred ? [preferred] : []),
    'mixed-shadows-control',
    'control',
    'technical',
    'mixed-control-technical',
    'mixed-shadows-technical',
    'match',
  ]
  const candidates = candidatePool.filter((kind, index, all) => all.indexOf(kind) === index)

  for (const desiredKind of candidates) {
    const result = selectSquashDrills({
      fatigueLevel: fatigueToNumber(context.wizardConfig.currentFatigue),
      phase: mapPhase(context.week.phase) as SquashSelectionPhase,
      recentDrills: usedDrills,
      goal: buildLevelAwareGoal(context, session.objective ?? context.profile.mainGoal ?? ''),
      competitionSoon: false,
      competitiveLevel: deriveCompetitiveLevel(context),
      desiredKind,
    })
    applySquashSelection(session, result)
    const signature = buildSquashDrillSignature(session)
    if (signature && !seenSignatures.has(signature)) return true
    usedDrills.push(...extractSquashDrillNames(session))
  }

  return false
}

function buildSquashDrillSignature(session: CoachSessionProposal): string | undefined {
  const drillNames = extractSquashDrillNames(session)
  if (drillNames.length === 0) return undefined
  return drillNames
    .map((name) => findSquashDrillByName(name)?.id ?? normalizeSquashDrillKey(name))
    .sort()
    .join('|')
}

function completeRunningDetails(session: CoachSessionProposal, context: RepairContext): void {
  const phase = mapPhase(context.week.phase) as RunningPhase
  const recentSessions = extractRecentRunningSessions(context.previousWeek)
  const sportProfile = deriveRunningSportProfile(context)
  const result = selectRunningSession({
    fatigueLevel: fatigueToNumber(context.wizardConfig.currentFatigue),
    phase,
    recentSessions,
    goal: session.objective ?? context.profile.mainGoal ?? '',
    sportProfile,
    primarySport: context.profile.sportContext?.primarySport,
  })
  if (!session.runningType) {
    session.runningType = result.session.runningType
  }
}

function completeStrengthExercises(
  session: CoachSessionProposal,
  context: RepairContext,
  recentExercises = extractRecentStrengthExercises(context.previousWeek),
): void {
  const result = selectStrengthSession(buildStrengthSelectionContext(session, context, recentExercises))
  session.exercises = result.exercises.map<CoachExerciseProposal>((e) => ({
    name: e.name,
    sets: e.sets,
    reps: e.reps,
    group: e.group,
    notes: e.notes,
  }))
  enhanceStrengthSessionDetails(session, context, recentExercises)
}

function enhanceStrengthSessionDetails(
  session: CoachSessionProposal,
  context: RepairContext,
  recentExercises = extractRecentStrengthExercises(context.previousWeek),
): boolean {
  const before = JSON.stringify(session.exercises ?? [])
  const enhanced = enhanceStrengthSessionExercises(session.exercises, {
    durationMin: session.durationMin,
    strengthProfile: context.profile.strengthProfile,
  })
  session.exercises = completeStrengthExerciseDensity(session, context, recentExercises, enhanced)
  return before !== JSON.stringify(session.exercises ?? [])
}

function buildStrengthSelectionContext(
  session: CoachSessionProposal,
  context: RepairContext,
  recentExercises: string[],
): StrengthContext {
  return {
    fatigueLevel: fatigueToNumber(context.wizardConfig.currentFatigue),
    phase: mapPhase(context.week.phase) as StrengthPhase,
    recentExercises,
    goal: buildLevelAwareGoal(context, session.objective ?? context.profile.mainGoal ?? ''),
    sportProfile: deriveStrengthSportProfile(context),
    primarySport: context.profile.sportContext?.primarySport,
    experienceLevel: deriveStrengthExperienceLevel(context),
    sessionDurationMin: session.durationMin,
  }
}

function completeStrengthExerciseDensity(
  session: CoachSessionProposal,
  context: RepairContext,
  recentExercises: string[],
  exercises: CoachExerciseProposal[] | undefined,
): CoachExerciseProposal[] | undefined {
  if (!exercises || exercises.length === 0) return exercises

  const selectionContext = buildStrengthSelectionContext(session, context, recentExercises)
  const density = getTargetExerciseDensity(selectionContext)
  if (exercises.length >= density.target) return exercises

  const selected = selectStrengthSession(selectionContext).exercises
  const existingKeys = new Set(exercises.map(getStrengthExerciseKey))
  const additions: CoachExerciseProposal[] = []
  const minimumStrengthWork = getMinimumStrengthWorkCount(session.durationMin)
  let strengthWorkCount = exercises.filter(isStrengthWorkExercise).length

  const candidates = selected
    .map(toCoachExerciseProposal)
    .filter((exercise) => !existingKeys.has(getStrengthExerciseKey(exercise)))

  for (const candidate of candidates) {
    if (exercises.length + additions.length >= density.target) break
    if (!isStrengthWorkExercise(candidate)) continue
    additions.push(candidate)
    existingKeys.add(getStrengthExerciseKey(candidate))
    strengthWorkCount++
    if (strengthWorkCount >= minimumStrengthWork) break
  }

  for (const candidate of candidates) {
    if (exercises.length + additions.length >= density.target) break
    const key = getStrengthExerciseKey(candidate)
    if (existingKeys.has(key)) continue
    additions.push(candidate)
    existingKeys.add(key)
  }

  if (additions.length === 0) return exercises

  return enhanceStrengthSessionExercises([...exercises, ...additions], {
    durationMin: session.durationMin,
    strengthProfile: context.profile.strengthProfile,
  })
}

function toCoachExerciseProposal(exercise: StrengthSelectionExercise): CoachExerciseProposal {
  return {
    name: exercise.name,
    sets: exercise.sets,
    reps: exercise.reps,
    group: exercise.group,
    notes: exercise.notes,
  }
}

function getMinimumStrengthWorkCount(durationMin: number): number {
  if (durationMin >= 70) return 5
  if (durationMin >= 55) return 4
  if (durationMin >= 45) return 3
  return 2
}

function isStrengthWorkExercise(exercise: CoachExerciseProposal): boolean {
  const block = resolveStrengthExerciseBlock(exercise)
  return block !== 'core' && block !== 'cardio' && block !== 'mobility'
}

function getStrengthExerciseKey(exercise: Pick<CoachExerciseProposal, 'name'>): string {
  return findStrengthExerciseByName(exercise.name)?.id ?? normalizeStrengthExerciseKey(exercise.name)
}

function completeMobilityDetails(session: CoachSessionProposal, context: RepairContext): void {
  const primarySport = (context.profile.sportContext?.primarySport ?? 'general') as MobilitySportContext
  const phase = mapPhase(context.week.phase) as MobilityPhase
  const result = selectMobilitySession({
    primarySport,
    phase,
    recentSessionIds: [],
    fatigueLevel: fatigueToNumber(context.wizardConfig.currentFatigue),
  })
  session.mobilityDetails = {
    focusAreas: result.recommendedFocus,
    context: 'full_body',
    targetStructure: result.session.typicalStructure,
  }
}

function completeCyclingDetails(session: CoachSessionProposal, context: RepairContext): void {
  const phase = mapPhase(context.week.phase) as CyclingPhase
  const role = deriveCyclingRole(context)
  const sportProfile = deriveCyclingSportProfile(context)
  const result = selectCyclingSession({
    phase,
    role,
    fatigueLevel: fatigueToNumber(context.wizardConfig.currentFatigue),
    sportProfile,
    recentSessionIds: [],
  })
  session.cyclingDetails = {
    sessionCategory: result.session.category,
    sessionFamily: result.session.family,
    targetStructure: result.session.structure,
    intensityReference: result.session.intensity,
    executionNotes: result.session.notes,
  }
}

// ─── 7. Balance session count ───────────────────────────────────────────────

function balanceSessionCount(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  const expected = getExpectedSessionsForPlanWeek(context.plan, context.week)
  let result = [...sessions]

  // Trim excess: remove least important first (recovery > mobility > complementary)
  if (result.length > expected) {
    const trimPriority: Record<string, number> = {
      recovery: 0, nutrition: 1, mobility: 2,
    }
    const primarySport = getPrimarySport(context)
    result.sort((a, b) => {
      const pa = trimPriority[a.sessionType] ?? (a.sessionType === primarySport ? 10 : 5)
      const pb = trimPriority[b.sessionType] ?? (b.sessionType === primarySport ? 10 : 5)
      return pa - pb
    })
    const trimmed = result.length - expected
    result = result.slice(trimmed)
    meta.droppedSessionCount += trimmed
    meta.warnings.push({ code: 'trimmed_excess', message: `Se recortaron ${trimmed} sesiones excedentes.` })
    // Re-sort by date+timeBlock
    result.sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
  }

  // Add fallback sessions (max 2)
  if (result.length < expected) {
    const diff = expected - result.length
    const maxFallback = Math.min(diff, 2)
    const allowedDates = getAllowedDatesInWeek(context)
    const primarySport = getPrimarySport(context)
    const primaryCount = result.filter((s) => s.sessionType === primarySport).length
    const minimumPrimary = primarySport === 'squash' && expected >= 4
      ? Math.floor(expected / 2) + 1
      : Math.min(expected, 1)

    for (let i = 0; i < maxFallback; i++) {
      const available = findNearestAvailableDate(allowedDates, result, 'AM', undefined, context.wizardConfig)
      if (!available) break

      const needPrimary = i === 0 && primarySport && primaryCount < minimumPrimary
      const fallback = needPrimary
        ? buildPrimaryFallbackSession(primarySport, available.date, context, result)
        : buildMobilityFallbackSession(available.date, context)

      fallback.timeBlock = available.timeBlock

      result.push(fallback)
      meta.addedFallbackCount++
    }

    if (meta.addedFallbackCount > 0) {
      meta.warnings.push({ code: 'added_fallback', message: `Se agregaron ${meta.addedFallbackCount} sesiones fallback para completar la semana.` })
    }

    result.sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
  }

  return result
}

function buildMobilityFallbackSession(date: string, context: RepairContext): CoachSessionProposal {
  const session: CoachSessionProposal = {
    date,
    timeBlock: 'AM',
    sessionType: 'mobility',
    title: 'Movilidad de recuperación',
    durationMin: 30,
    rpe: 3,
    objective: 'Mantener rango de movimiento y facilitar recuperación.',
  }
  try {
    completeMobilityDetails(session, context)
  } catch { /* leave without details; validator will flag */ }
  return session
}

function buildPrimaryFallbackSession(
  sport: string,
  date: string,
  context: RepairContext,
  currentSessions: CoachSessionProposal[] = [],
): CoachSessionProposal {
  const session: CoachSessionProposal = {
    date,
    timeBlock: 'AM',
    sessionType: sport as CoachSessionProposal['sessionType'],
    title: `${sport.charAt(0).toUpperCase() + sport.slice(1)} técnico ligero`,
    durationMin: 45,
    rpe: 4,
    objective: `Sesión técnica ligera de ${sport} para mantener presencia del deporte principal.`,
    subtype: sport === 'squash' ? 'light' : undefined,
  }
  try {
    switch (sport) {
      case 'squash': completeSquashDetails(session, context, currentSessions.flatMap(extractSquashDrillNames)); break
      case 'running': completeRunningDetails(session, context); break
      case 'strength': completeStrengthExercises(session, context); break
      case 'cycling': completeCyclingDetails(session, context); break
    }
  } catch { /* leave without details */ }
  return session
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function minimumPrimarySessionsForWeek(context: RepairContext): number {
  const primarySport = getPrimarySport(context)
  const expected = getExpectedSessionsForPlanWeek(context.plan, context.week)
  if (!primarySport || expected <= 0 || context.week.phase === 'transition') return 0
  if (primarySport === 'squash' && (context.week.phase === 'build' || context.week.phase === 'peak')) {
    return expected >= 4
      ? Math.min(expected, Math.floor(expected / 2) + 1)
      : Math.min(expected, 2)
  }
  return Math.min(expected, 1)
}

function ensurePrimarySportMinimum(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  const primarySport = getPrimarySport(context)
  const minimum = minimumPrimarySessionsForWeek(context)
  if (!primarySport || minimum <= 0) return sessions

  let primaryCount = sessions.filter((session) => session.sessionType === primarySport).length
  if (primaryCount >= minimum) return sessions

  const next = [...sessions]
  const replacementOrder = ['mobility', 'recovery', 'nutrition', 'strength', 'running', 'cycling']

  for (const sport of replacementOrder) {
    for (let i = 0; i < next.length && primaryCount < minimum; i++) {
      if (next[i].sessionType === primarySport || next[i].sessionType !== sport) continue
      const replacement = buildPrimaryFallbackSession(primarySport, next[i].date, context, next)
      replacement.timeBlock = next[i].timeBlock
      next[i] = {
        ...replacement,
        title: replacement.title,
        durationMin: Math.max(30, Math.min(next[i].durationMin, replacement.durationMin)),
      }
      primaryCount++
      meta.repairedSessionCount++
    }
  }

  if (primaryCount >= minimum) {
    meta.warnings.push({
      code: 'primary_sport_minimum_repaired',
      message: `Se ajustaron sesiones accesorias para cumplir el mínimo de ${primarySport}.`,
    })
  }

  return next
}

function getAllowedDatesInWeek(context: RepairContext): string[] {
  const weekStart = new Date(`${context.week.weekStartDate}T00:00:00.000Z`)
  const validRange = getPlanWeekDateRange(context.plan, context.week)
  const allowedDays = new Set(context.wizardConfig.trainingDays)
  const dayMapping: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000)
    const iso = d.toISOString().slice(0, 10)
    if (iso < validRange.startDate || iso > validRange.endDate) continue
    const dayOfWeek = dayMapping[d.getUTCDay()]
    if (allowedDays.has(dayOfWeek)) {
      dates.push(iso)
    }
  }
  return dates
}

function findNearestAvailableDate(
  allowedDates: string[],
  currentSessions: CoachSessionProposal[],
  preferredBlock: 'AM' | 'PM',
  referenceDate?: string,
  wizardConfig?: PlanWizardConfig,
): { date: string; timeBlock: 'AM' | 'PM' } | null {
  const occupied = new Set(currentSessions.map((s) => `${s.date}|${s.timeBlock}`))
  const occupiedDates = new Set(currentSessions.map((s) => s.date))
  const allowDoubleSession = wizardConfig?.allowDoubleSession ?? true
  // Sort by proximity to referenceDate if provided
  const sorted = referenceDate
    ? [...allowedDates].sort((a, b) => Math.abs(new Date(a).getTime() - new Date(referenceDate).getTime()) - Math.abs(new Date(b).getTime() - new Date(referenceDate).getTime()))
    : allowedDates

  for (const date of sorted) {
    const dateAlreadyOccupied = occupiedDates.has(date)
    const canDouble = allowDoubleSession && canUseDoubleSessionOnDate(date, wizardConfig)
    if (dateAlreadyOccupied && !canDouble) continue
    if (!occupied.has(`${date}|${preferredBlock}`)) return { date, timeBlock: preferredBlock }
    const opposite = preferredBlock === 'AM' ? 'PM' : 'AM'
    if (canDouble && !occupied.has(`${date}|${opposite}`)) return { date, timeBlock: opposite }
  }
  return null
}

function canUseDoubleSessionOnDate(date: string, wizardConfig?: PlanWizardConfig): boolean {
  if (!wizardConfig?.allowDoubleSession) return false
  const doubleDays = wizardConfig.doubleSessionDays
  if (!doubleDays || doubleDays.length === 0) return true
  const day = isoDateToDayOfWeek(date)
  return Boolean(day && doubleDays.includes(day))
}

function isoDateToDayOfWeek(date: string): DayOfWeek | null {
  if (!isStrictISODate(date)) return null
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay()
  const mapping: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  return mapping[weekday] ?? null
}

function getAllowedSports(context: RepairContext): Set<string> {
  const fromMacro = context.plan.macroSnapshot.sportDetails.map((d) => d.sport) as string[]
  const fromWizard = context.wizardConfig.complementarySports as string[]
  // Always allow mobility and recovery
  return new Set([...fromMacro, ...fromWizard, 'mobility', 'recovery', 'nutrition'])
}

function getPrimarySport(context: RepairContext): string | undefined {
  return context.plan.macroSnapshot.sportDetails.find((d) => d.role === 'primary')?.sport
}

function fatigueToNumber(level: WizardFatigueLevel): number {
  const map: Record<WizardFatigueLevel, number> = { fresh: 2, normal: 5, loaded: 7, overloaded: 9 }
  return map[level] ?? 5
}

function mapPhase(phase: string): string {
  if (phase === 'race') return 'taper'
  if (phase === 'transition') return 'base'
  return phase
}

function mapSubtypeToDesiredKind(subtype?: string) {
  if (!subtype) return undefined
  if (subtype === 'match' || subtype === 'competitive') return 'match' as const
  if (subtype === 'control') return 'control' as const
  if (subtype === 'training') return undefined // let selector decide
  return undefined
}

function inferSquashDesiredKind(session: CoachSessionProposal, recentDrills: string[]) {
  const text = `${session.title ?? ''} ${session.objective ?? ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  if (text.includes('control') || text.includes('precision')) return 'control' as const
  if (text.includes('desplaz') || text.includes('movimiento') || text.includes('shadow') || text.includes('ghost')) return 'mixed-shadows-control' as const
  if (text.includes('partido') || text.includes('match')) return 'match' as const
  if (recentDrills.length >= 3 || text.includes('juego') || text.includes('condicionado')) return 'shadows' as const
  if (recentDrills.length > 0) return 'control' as const
  return undefined
}

function deriveRunningSportProfile(context: RepairContext): RunningSportProfile {
  const primary = context.profile.sportContext?.primarySport
  if (primary === 'running') return 'running_primary'
  if (primary) return 'sport_support'
  return 'hybrid'
}

function deriveStrengthSportProfile(context: RepairContext): StrengthSportProfile {
  const primary = context.profile.sportContext?.primarySport
  if (primary === 'strength') return 'strength_primary'
  if (primary) return 'sport_support'
  return 'hybrid'
}

function deriveStrengthExperienceLevel(context: RepairContext): ExperienceLevel {
  const fitness = context.wizardConfig.currentFitnessLevel
  if (fitness === 'low' || fitness === 'returning') return 'beginner'
  const competitiveLevel = deriveCompetitiveLevel(context)
  if (competitiveLevel === 'elite' || competitiveLevel === 'masters') return 'advanced'
  if (competitiveLevel === 'competitive' || fitness === 'fit') return 'intermediate'
  return 'intermediate'
}

function deriveCompetitiveLevel(context: RepairContext): GoalEventLevel | undefined {
  const goalEventId = context.wizardConfig.goalEventId
  const event = context.profile.goalEvents?.find((item) => item.id === goalEventId)
    ?? context.profile.goalEvents?.find((item) => item.priority === 'primary')
    ?? context.profile.goalEvents?.[0]
  return event?.competitiveLevel
}

function buildLevelAwareGoal(context: RepairContext, goal: string): string {
  const competitiveLevel = deriveCompetitiveLevel(context)
  const fitness = context.wizardConfig.currentFitnessLevel
  const parts = [goal]
  if (competitiveLevel) parts.push(`nivel competitivo ${competitiveLevel}`)
  parts.push(`fitness ${fitness}`)
  if (competitiveLevel === 'elite' || competitiveLevel === 'masters') {
    parts.push('priorizar transferencia competitiva, presion, tactica y especificidad')
  }
  if (fitness === 'low' || fitness === 'returning') {
    parts.push('priorizar retorno seguro, control tecnico y baja complejidad')
  }
  return parts.filter(Boolean).join(' · ')
}

function deriveCyclingRole(context: RepairContext): CyclingRole {
  const primary = context.profile.sportContext?.primarySport
  return primary === 'cycling' ? 'primary' : 'support'
}

function deriveCyclingSportProfile(context: RepairContext): CyclingSportProfile {
  const primary = context.profile.sportContext?.primarySport
  if (primary === 'cycling') return 'cycling_primary'
  if (primary) return 'sport_support'
  return 'hybrid'
}

function extractRecentSquashDrills(previousWeek?: TrainingPlanWeek): string[] {
  if (!previousWeek) return []
  return previousWeek.sessions
    .filter((s) => s.sessionType === 'squash' && s.squashDetails?.drills)
    .flatMap((s) => s.squashDetails!.drills.map((d) => d.name))
}

function extractSquashDrillNames(session: CoachSessionProposal): string[] {
  const details = session.squashDetails
  if (!details) return []
  return [
    ...(details.drills ?? []).map((drill) => drill.name),
    ...((details.blocks ?? []).flatMap((block) => block.drills.map((drill) => drill.name))),
  ]
}

function extractRecentRunningSessions(previousWeek?: TrainingPlanWeek): string[] {
  if (!previousWeek) return []
  return previousWeek.sessions
    .filter((s) => s.sessionType === 'running')
    .map((s) => s.runningType ?? 'easy_aerobic')
}

function extractRecentStrengthExercises(previousWeek?: TrainingPlanWeek): string[] {
  if (!previousWeek) return []
  return previousWeek.sessions
    .filter((s) => s.sessionType === 'strength' && s.exercises)
    .flatMap((s) => s.exercises!.map((e) => e.name))
}

import type {
  AthleteProfile,
  CoachExerciseProposal,
  CoachSessionProposal,
  DayOfWeek,
  PlanWizardConfig,
  SupportedSport,
  WizardFatigueLevel,
} from '../../types'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { selectSquashDrills, type SquashSelectionPhase } from '../training/drillSelector'
import { selectRunningSession, type RunningPhase, type RunningSportProfile } from '../training/runningSelector'
import { selectStrengthSession, type StrengthPhase, type StrengthSportProfile } from '../training/strengthSelector'
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
  const weekStart = new Date(`${context.week.weekStartDate}T00:00:00.000Z`).getTime()
  const weekEndExclusive = weekStart + 7 * 24 * 60 * 60 * 1000
  const allowedDates = getAllowedDatesInWeek(context)

  return sessions.map((s) => {
    const ts = new Date(`${s.date}T00:00:00.000Z`).getTime()
    if (ts >= weekStart && ts < weekEndExclusive) return s

    const available = findNearestAvailableDate(allowedDates, sessions, s.timeBlock, undefined, context.wizardConfig.allowDoubleSession)
    if (available) {
      meta.movedSessionCount++
      meta.warnings.push({ code: 'moved_into_week', message: `Sesión "${s.title}" movida de ${s.date} a ${available.date} (fuera de semana).`, sessionDate: s.date })
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

    const available = findNearestAvailableDate(allowedDates, sessions, s.timeBlock, s.date, context.wizardConfig.allowDoubleSession)
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
    if (allowDoubleSession && !occupied.has(oppositeKey)) {
      occupied.add(oppositeKey)
      meta.movedSessionCount++
      meta.warnings.push({ code: 'collision_resolved', message: `Sesión "${s.title}" movida a ${s.date} ${oppositeBlock} (colisión).`, sessionDate: s.date })
      result.push({ ...s, timeBlock: oppositeBlock })
      continue
    }

    // Try a different allowed date
    const allowedDates = getAllowedDatesInWeek(context)
    const available = findNearestAvailableDate(allowedDates, [...sessions, ...result], s.timeBlock, s.date, allowDoubleSession)
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
  for (const session of sessions) {
    try {
      switch (session.sessionType) {
        case 'squash':
          if (!hasValidSquashDetails(session)) {
            completeSquashDetails(session, context)
            meta.repairedSessionCount++
          }
          break
        case 'running':
          if (!session.runningType) {
            completeRunningDetails(session, context)
            meta.repairedSessionCount++
          }
          break
        case 'strength':
          if (!session.exercises || session.exercises.length === 0) {
            completeStrengthExercises(session, context)
            meta.repairedSessionCount++
          }
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

function completeSquashDetails(session: CoachSessionProposal, context: RepairContext): void {
  const phase = mapPhase(context.week.phase) as SquashSelectionPhase
  const recentDrills = extractRecentSquashDrills(context.previousWeek)
  const result = selectSquashDrills({
    fatigueLevel: fatigueToNumber(context.wizardConfig.currentFatigue),
    phase,
    recentDrills,
    goal: context.profile.mainGoal ?? '',
    competitionSoon: false,
    desiredKind: mapSubtypeToDesiredKind(session.subtype),
  })
  session.squashDetails = {
    trainingFocus: result.trainingFocus,
    drills: result.drills,
    sessionMode: session.subtype === 'match' || session.subtype === 'competitive' ? 'practice_match' : 'drill_session',
    sessionKind: result.sessionKind,
    blocks: result.blocks,
  }
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

function completeStrengthExercises(session: CoachSessionProposal, context: RepairContext): void {
  const phase = mapPhase(context.week.phase) as StrengthPhase
  const recentExercises = extractRecentStrengthExercises(context.previousWeek)
  const sportProfile = deriveStrengthSportProfile(context)
  const result = selectStrengthSession({
    fatigueLevel: fatigueToNumber(context.wizardConfig.currentFatigue),
    phase,
    recentExercises,
    goal: session.objective ?? context.profile.mainGoal ?? '',
    sportProfile,
    primarySport: context.profile.sportContext?.primarySport,
  })
  session.exercises = result.exercises.map<CoachExerciseProposal>((e) => ({
    name: e.name,
    sets: e.sets,
    reps: e.reps,
    group: e.group,
    notes: e.notes,
  }))
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
  const expected = context.wizardConfig.sessionsPerWeek
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
    const minimumPrimary = primarySport === 'squash' ? 2 : 1

    for (let i = 0; i < maxFallback; i++) {
      const available = findNearestAvailableDate(allowedDates, result, 'AM', undefined, context.wizardConfig.allowDoubleSession)
      if (!available) break

      const needPrimary = i === 0 && primarySport && primaryCount < minimumPrimary
      const fallback = needPrimary
        ? buildPrimaryFallbackSession(primarySport, available.date, context)
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

function buildPrimaryFallbackSession(sport: string, date: string, context: RepairContext): CoachSessionProposal {
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
      case 'squash': completeSquashDetails(session, context); break
      case 'running': completeRunningDetails(session, context); break
      case 'strength': completeStrengthExercises(session, context); break
      case 'cycling': completeCyclingDetails(session, context); break
    }
  } catch { /* leave without details */ }
  return session
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAllowedDatesInWeek(context: RepairContext): string[] {
  const weekStart = new Date(`${context.week.weekStartDate}T00:00:00.000Z`)
  const allowedDays = new Set(context.wizardConfig.trainingDays)
  const dayMapping: DayOfWeek[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000)
    const dayOfWeek = dayMapping[d.getUTCDay()]
    if (allowedDays.has(dayOfWeek)) {
      dates.push(d.toISOString().slice(0, 10))
    }
  }
  return dates
}

function findNearestAvailableDate(
  allowedDates: string[],
  currentSessions: CoachSessionProposal[],
  preferredBlock: 'AM' | 'PM',
  referenceDate?: string,
  allowDoubleSession = true,
): { date: string; timeBlock: 'AM' | 'PM' } | null {
  const occupied = new Set(currentSessions.map((s) => `${s.date}|${s.timeBlock}`))
  const occupiedDates = new Set(currentSessions.map((s) => s.date))
  // Sort by proximity to referenceDate if provided
  const sorted = referenceDate
    ? [...allowedDates].sort((a, b) => Math.abs(new Date(a).getTime() - new Date(referenceDate).getTime()) - Math.abs(new Date(b).getTime() - new Date(referenceDate).getTime()))
    : allowedDates

  for (const date of sorted) {
    if (!allowDoubleSession && occupiedDates.has(date)) continue
    if (!occupied.has(`${date}|${preferredBlock}`)) return { date, timeBlock: preferredBlock }
    const opposite = preferredBlock === 'AM' ? 'PM' : 'AM'
    if (allowDoubleSession && !occupied.has(`${date}|${opposite}`)) return { date, timeBlock: opposite }
  }
  return null
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

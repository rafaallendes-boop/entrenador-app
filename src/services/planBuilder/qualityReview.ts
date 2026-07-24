import type { AthleteProfile, CoachSessionProposal, SupportedSport } from '../../types'
import type { PlanValidationIssue, TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'
import { mapExerciseTo1RMReference, type ReferenceLift } from '../training/strengthLoadPrescription'
import { getExpectedSessionsForPlanWeek, getPlanWeekDateRange } from './dateRange'
import { summarizeTaxonomy, type RepairTaxonomyMeta } from './repairTaxonomy'
import { validatePlan, validatePlanWeek } from './validator'

export type PlanQualityGrade = 'excellent' | 'good' | 'needs_review' | 'poor'

export interface PlanQualityWeekReview {
  weekIndex: number
  weekStartDate: string
  score: number
  grade: PlanQualityGrade
  issues: PlanValidationIssue[]
  repairCount: number
}

export interface PlanQualityReview {
  qualityVersion: 1 | 2
  score: number
  grade: PlanQualityGrade
  issues: PlanValidationIssue[]
  weeks: PlanQualityWeekReview[]
  repairCount: number
  criticalIssueCount: number
  warningCount: number
}

export type PersistedPlanQualityReview =
  Omit<PlanQualityReview, 'qualityVersion'>
  & { qualityVersion?: 1 | 2 }

export function resolvePersistedQualityVersion(
  review: Pick<PersistedPlanQualityReview, 'qualityVersion'>,
): 1 | 2 {
  return review.qualityVersion ?? 1
}

export type PlanQualityRepairInstructions = Record<number, string>

export interface PlanQualityContext {
  profile?: AthleteProfile
  qualityVersion?: 1 | 2
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)))
}

function gradeFromScore(score: number): PlanQualityGrade {
  if (score >= 90) return 'excellent'
  if (score >= 78) return 'good'
  if (score >= 62) return 'needs_review'
  return 'poor'
}

function issue(input: {
  severity: PlanValidationIssue['severity']
  code: string
  message: string
  weekIndex?: number
}): PlanValidationIssue {
  return input
}

function getPrimarySport(plan: TrainingPlan): SupportedSport | undefined {
  return plan.macroSnapshot.sportDetails.find((detail) => detail.role === 'primary')?.sport
}

function countBySport(sessions: CoachSessionProposal[]): Partial<Record<SupportedSport, number>> {
  return sessions.reduce<Partial<Record<SupportedSport, number>>>((acc, session) => {
    const sport = session.sessionType as SupportedSport
    acc[sport] = (acc[sport] ?? 0) + 1
    return acc
  }, {})
}

function weekLoad(week: TrainingPlanWeek): number {
  return week.sessions.reduce((total, session) => total + session.durationMin * (session.rpe ?? 6), 0)
}

function weekLoadForProgression(plan: TrainingPlan, week: TrainingPlanWeek): number {
  const rawLoad = weekLoad(week)
  const { startDate, endDate } = getPlanWeekDateRange(plan, week)
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime()
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return rawLoad

  const days = Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1
  if (days >= 7 || days <= 0) return rawLoad
  return rawLoad * (7 / days)
}

function hasRunningStructure(session: CoachSessionProposal): boolean {
  return Boolean(
    session.runningType
    && (session.targetPaceMin || session.targetPaceMax || session.targetHrMin || session.targetHrMax)
    && Array.isArray(session.intervalStructure?.blocks)
    && session.intervalStructure.blocks.length > 0,
  )
}

function strengthDensityTarget(durationMin: number): number {
  if (durationMin >= 60) return 6
  if (durationMin >= 45) return 5
  return 3
}

function getSportCompletenessIssues(week: TrainingPlanWeek): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []

  for (const session of week.sessions) {
    if (week.phase === 'taper' || week.phase === 'race') {
      const durationCap = getTaperDurationCap(session.sessionType)
      if (session.durationMin > durationCap) {
        issues.push(issue({
          severity: 'warning',
          code: 'quality.taper.session_too_long',
          message: `Taper con sesión demasiado larga (${session.durationMin}min) en ${session.date}; sugerido <=${durationCap}min.`,
          weekIndex: week.weekIndex,
        }))
      }
    }

    if (session.sessionType === 'running' && !hasRunningStructure(session)) {
      issues.push(issue({
        severity: 'warning',
        code: 'quality.running.incomplete_structure',
        message: `Running sin ritmos/HR o estructura de bloques (${session.date}).`,
        weekIndex: week.weekIndex,
      }))
    }

    if (session.sessionType === 'strength') {
      const exercises = session.exercises ?? []
      const target = strengthDensityTarget(session.durationMin)
      if (exercises.length < target) {
        issues.push(issue({
          severity: 'warning',
          code: 'quality.strength.low_density',
          message: `Fuerza con baja densidad (${exercises.length}/${target} ejercicios) en ${session.date}.`,
          weekIndex: week.weekIndex,
        }))
      }
      if (!exercises.some((exercise) => exercise.group === 'core')) {
        issues.push(issue({
          severity: 'warning',
          code: 'quality.strength.missing_core',
          message: `Fuerza sin bloque explícito de zona media en ${session.date}.`,
          weekIndex: week.weekIndex,
        }))
      }
    }

    if (session.sessionType === 'squash') {
      const drills = session.squashDetails?.drills ?? []
      if (drills.length < 2 && session.durationMin >= 45) {
        issues.push(issue({
          severity: 'warning',
          code: 'quality.squash.low_drill_depth',
          message: `Squash con pocos drills específicos (${drills.length}) en ${session.date}.`,
          weekIndex: week.weekIndex,
        }))
      }
      const duplicateDrills = getDuplicateSquashDrillNames(session)
      if (duplicateDrills.length > 0) {
        issues.push(issue({
          severity: 'warning',
          code: 'quality.squash.repeated_drills',
          message: `Squash repite drills dentro de la misma sesión (${duplicateDrills.slice(0, 3).join(', ')}) en ${session.date}.`,
          weekIndex: week.weekIndex,
        }))
      }
      if (hasSquashModeMismatch(session)) {
        issues.push(issue({
          severity: 'warning',
          code: 'quality.squash.mode_mismatch',
          message: `Squash etiquetado como match-play aunque sus bloques no son partido completo (${session.date}).`,
          weekIndex: week.weekIndex,
        }))
      }
      if (hasSquashTitleMismatch(session)) {
        issues.push(issue({
          severity: 'warning',
          code: 'quality.squash.title_mismatch',
          message: `Título de squash no calza con los bloques reales (${session.date}).`,
          weekIndex: week.weekIndex,
        }))
      }
    }

    if (session.sessionType === 'mobility' && /world|thoracic|childs|ankle circles|hip 90\/90 flow/i.test(session.mobilityDetails?.targetStructure ?? '')) {
      issues.push(issue({
        severity: 'warning',
        code: 'quality.mobility.english_structure',
        message: `Movilidad con estructura poco localizada al español en ${session.date}.`,
        weekIndex: week.weekIndex,
      }))
    }
  }

  return issues
}

function getSquashDrillKeys(session: CoachSessionProposal): string[] {
  const details = session.squashDetails
  if (!details) return []
  const names = (details.drills?.length ?? 0) > 0
    ? details.drills!.map((drill) => drill.name)
    : ((details.blocks ?? []).flatMap((block) => block.drills.map((drill) => drill.name)))
  return names
    .map(normalizeExerciseName)
    .filter(Boolean)
}

function getDuplicateSquashDrillNames(session: CoachSessionProposal): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const key of getSquashDrillKeys(session)) {
    if (seen.has(key)) {
      duplicates.add(key)
    } else {
      seen.add(key)
    }
  }

  return [...duplicates]
}

function hasSquashModeMismatch(session: CoachSessionProposal): boolean {
  const details = session.squashDetails
  if (!details || details.sessionMode !== 'practice_match') return false
  const blocks = details.blocks ?? []
  if (blocks.length > 0) return !blocks.every((block) => block.kind === 'match')
  if (details.sessionKind && details.sessionKind !== 'match') return true
  return false
}

function hasSquashTitleMismatch(session: CoachSessionProposal): boolean {
  const details = session.squashDetails
  if (!details) return false
  const blockKinds: string[] = [...new Set((details.blocks ?? []).map((block) => block.kind))]
  if (blockKinds.length === 0) return false
  const normalized = normalizeExerciseName(session.title)
  const has = (kind: string) => blockKinds.includes(kind)
  const saysMatch = normalized.includes('match') || normalized.includes('partido') || normalized.includes('juego condicionado')
  const saysShadows = normalized.includes('sombra') || normalized.includes('salida')
  const saysControl = normalized.includes('control') || normalized.includes('patron') || normalized.includes('precision')
  const saysTechnical = normalized.includes('tecnica') || normalized.includes('aplicacion tactica') || normalized.includes('activacion')

  if (saysMatch && !has('match')) return true
  if (saysShadows && !has('shadows')) return true
  if (saysControl && !has('control')) return true
  if (saysTechnical && blockKinds.length === 1 && has('match')) return true
  if (blockKinds.length > 1 && has('shadows') && has('control') && !saysControl) return true
  if (blockKinds.length > 1 && has('technical') && has('match') && !saysMatch) return true
  return false
}

function getTaperDurationCap(sessionType: CoachSessionProposal['sessionType']): number {
  switch (sessionType) {
    case 'squash': return 50
    case 'strength': return 40
    case 'running':
    case 'cycling': return 35
    case 'mobility':
    case 'recovery': return 30
    default: return 35
  }
}

function getDistributionIssues(plan: TrainingPlan, week: TrainingPlanWeek): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []
  const primarySport = getPrimarySport(plan)
  const expected = getExpectedSessionsForPlanWeek(plan, week)
  const counts = countBySport(week.sessions)

  if (
    primarySport === 'squash'
    && (week.phase === 'build' || week.phase === 'peak')
    && expected >= 5
    && (counts.strength ?? 0) === 0
  ) {
    issues.push(issue({
      severity: 'warning',
      code: 'quality.support.missing_strength',
      message: `Semana ${week.weekIndex + 1} no incluye fuerza de soporte pese a ser bloque ${week.phase}.`,
      weekIndex: week.weekIndex,
    }))
  }

  if (
    primarySport === 'squash'
    && (week.phase === 'build' || week.phase === 'peak')
    && expected >= 4
    && ((week.targetLoadBySport.running ?? 0) > 0 || (week.targetLoadBySport.cycling ?? 0) > 0)
    && (counts.running ?? 0) === 0
    && (counts.cycling ?? 0) === 0
  ) {
    issues.push(issue({
      severity: 'warning',
      code: 'quality.support.missing_aerobic',
      message: `Semana ${week.weekIndex + 1} no incluye trabajo aeróbico complementario.`,
      weekIndex: week.weekIndex,
    }))
  }

  if (
    primarySport === 'squash'
    && (week.phase === 'taper' || week.phase === 'race')
    && ((counts.running ?? 0) > 0 || (counts.cycling ?? 0) > 0)
  ) {
    issues.push(issue({
      severity: 'warning',
      code: 'quality.taper.accessory_aerobic_present',
      message: `Semana taper ${week.weekIndex + 1} mantiene running/ciclismo accesorio; para squash competitivo debería ser opcional y muy corto.`,
      weekIndex: week.weekIndex,
    }))
  }

  return issues
}

function getHardSessionClusterIssues(week: TrainingPlanWeek): PlanValidationIssue[] {
  const hardDates = new Set(
    week.sessions
      .filter((session) => (session.rpe ?? 6) >= 8)
      .map((session) => session.date),
  )
  const sortedDates = [...hardDates].sort()
  const issues: PlanValidationIssue[] = []

  for (let i = 1; i < sortedDates.length; i++) {
    const prev = new Date(`${sortedDates[i - 1]}T00:00:00.000Z`).getTime()
    const curr = new Date(`${sortedDates[i]}T00:00:00.000Z`).getTime()
    const dayDiff = Math.round((curr - prev) / (24 * 60 * 60 * 1000))
    if (dayDiff === 1) {
      issues.push(issue({
        severity: 'warning',
        code: 'quality.load.hard_days_clustered',
        message: `Semana ${week.weekIndex + 1} acumula sesiones duras en días consecutivos.`,
        weekIndex: week.weekIndex,
      }))
      break
    }
  }

  return issues
}

function getPlanLevelIssues(plan: TrainingPlan, weeks: TrainingPlanWeek[]): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []
  const generated = weeks.filter((week) => week.sessions.length > 0).sort((a, b) => a.weekIndex - b.weekIndex)

  const fallbackWeeks = generated.filter((week) => week.generationMeta.fallbackUsed)
  if (generated.length > 0 && fallbackWeeks.length / generated.length >= 0.5) {
    issues.push(issue({
      severity: 'warning',
      code: 'quality.generation.fallback_reliance',
      message: `${fallbackWeeks.length}/${generated.length} semanas fueron generadas por fallback local; revisar prompts/modelo aunque el plan sea aplicable.`,
    }))
  }

  const repairedByFallback = generated.filter((week) => (week.generationMeta.addedFallbackCount ?? 0) > 0)
  if (generated.length > 0 && repairedByFallback.length / generated.length >= 0.5) {
    issues.push(issue({
      severity: 'warning',
      code: 'quality.generation.repair_fallback_reliance',
      message: `${repairedByFallback.length}/${generated.length} semanas necesitaron sesiones fallback durante reparación; revisar calidad antes de aceptar.`,
    }))
  }

  const droppedSessionWeeks = generated.filter((week) => (week.generationMeta.droppedSessionCount ?? 0) > 0)
  if (generated.length > 0 && droppedSessionWeeks.length / generated.length >= 0.5) {
    issues.push(issue({
      severity: 'warning',
      code: 'quality.generation.dropped_session_reliance',
      message: `${droppedSessionWeeks.length}/${generated.length} semanas descartaron sesiones inválidas durante normalización.`,
    }))
  }

  for (let i = 1; i < generated.length; i++) {
    const prev = weekLoadForProgression(plan, generated[i - 1])
    const curr = weekLoadForProgression(plan, generated[i])
    if (prev <= 0) continue
    const jump = (curr - prev) / prev
    if (jump > 0.3 && generated[i].phase !== 'race') {
      issues.push(issue({
        severity: 'warning',
        code: 'quality.load.progression_jump',
        message: `La carga sube ${Math.round(jump * 100)}% entre semanas ${generated[i - 1].weekIndex + 1} y ${generated[i].weekIndex + 1}.`,
        weekIndex: generated[i].weekIndex,
      }))
    }
  }

  for (let i = 1; i < generated.length; i++) {
    const week = generated[i]
    const prev = generated[i - 1]
    if (week.phase !== 'taper') continue
    const prevLoad = weekLoadForProgression(plan, prev)
    const taperLoad = weekLoadForProgression(plan, week)
    if (prevLoad > 0 && taperLoad > prevLoad * 0.9) {
      issues.push(issue({
        severity: 'warning',
        code: 'quality.taper.not_reduced',
        message: `La semana taper ${week.weekIndex + 1} no reduce claramente la carga frente a la semana anterior.`,
        weekIndex: week.weekIndex,
      }))
    }
  }

  return issues
}

function getGenerationReliabilityIssues(
  week: TrainingPlanWeek,
  qualityVersion: 1 | 2,
): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []
  const dropped = week.generationMeta.droppedSessionCount ?? 0
  const fallbackAdded = week.generationMeta.addedFallbackCount ?? 0
  const repaired = qualityVersion === 1
    ? (week.generationMeta.repairedSessionCount ?? 0)
    : (week.generationMeta.correctiveActionCount ?? 0)
      + (week.generationMeta.structuralActionCount ?? 0)

  if (dropped > 0) {
    issues.push(issue({
      severity: dropped >= 2 ? 'warning' : 'info',
      code: 'quality.generation.dropped_sessions',
      message: `Semana ${week.weekIndex + 1} descartó ${dropped} sesión(es) inválidas durante normalización.`,
      weekIndex: week.weekIndex,
    }))
  }

  if (fallbackAdded > 0) {
    issues.push(issue({
      severity: fallbackAdded >= 2 ? 'warning' : 'info',
      code: 'quality.generation.repair_fallback_added',
      message: `Semana ${week.weekIndex + 1} necesitó ${fallbackAdded} sesión(es) fallback para quedar completa.`,
      weekIndex: week.weekIndex,
    }))
  }

  // v2: threshold disabled until calibrated against the control distribution.
  const repairWarningEnabled = qualityVersion === 1
  if (repairWarningEnabled && repaired >= 8) {
    issues.push(issue({
      severity: 'warning',
      code: 'quality.generation.high_repair_count',
      message: `Semana ${week.weekIndex + 1} requirió ${repaired} reparaciones automáticas; revisar coherencia manualmente.`,
      weekIndex: week.weekIndex,
    }))
  }

  return issues
}

function getPlanPhaseForWeek(plan: TrainingPlan, week: TrainingPlanWeek): string {
  if (plan.phases.length === 0) return `${week.phase}:legacy`
  const phase = plan.phases.find((candidate) =>
    week.weekIndex >= candidate.startWeekIndex && week.weekIndex <= candidate.endWeekIndex,
  )
  return `${phase?.phase ?? week.phase}:${phase?.startWeekIndex ?? week.weekIndex}:${phase?.endWeekIndex ?? week.weekIndex}`
}

function getStrengthExerciseKeys(week: TrainingPlanWeek): Set<string> {
  return new Set(
    week.sessions
      .filter((session) => session.sessionType === 'strength')
      .flatMap((session) => session.exercises ?? [])
      .map((exercise) => normalizeExerciseName(exercise.name))
      .filter(Boolean),
  )
}

function getRepeatedStrengthTemplateIssues(plan: TrainingPlan, weeks: TrainingPlanWeek[]): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = []
  const generated = weeks.filter((week) => week.sessions.length > 0).sort((a, b) => a.weekIndex - b.weekIndex)
  const byBlock = new Map<string, TrainingPlanWeek[]>()

  for (const week of generated) {
    const key = getPlanPhaseForWeek(plan, week)
    byBlock.set(key, [...(byBlock.get(key) ?? []), week])
  }

  for (const blockWeeks of byBlock.values()) {
    // Precompute each week's strength key set once instead of recomputing per pair.
    const keysByWeek = blockWeeks.map((week) => ({ week, keys: getStrengthExerciseKeys(week) }))

    for (let j = 1; j < keysByWeek.length; j++) {
      const current = keysByWeek[j]
      if (current.keys.size === 0) continue

      // Flag each week at most once: against the earlier week in the same block
      // with the largest exercise overlap. Avoids quadratic warning blow-up that
      // would over-penalize a single non-rotating block in scorePlan/scoreWeek.
      let worstOverlap = 0
      let worstWeek: TrainingPlanWeek | undefined
      for (let i = 0; i < j; i++) {
        const earlier = keysByWeek[i]
        if (earlier.keys.size === 0) continue
        const overlap = [...current.keys].filter((key) => earlier.keys.has(key)).length
        if (overlap > worstOverlap) {
          worstOverlap = overlap
          worstWeek = earlier.week
        }
      }

      if (worstOverlap < 3 || !worstWeek) continue

      issues.push(issue({
        severity: 'warning',
        code: 'quality.strength.repeated_template',
        message: `Semanas ${worstWeek.weekIndex + 1} y ${current.week.weekIndex + 1} del bloque ${current.week.phase} comparten ${worstOverlap} ejercicios de fuerza.`,
        weekIndex: current.week.weekIndex,
      }))
    }
  }

  return issues
}

function getSquashDrillVarietyIssues(plan: TrainingPlan, weeks: TrainingPlanWeek[]): PlanValidationIssue[] {
  if (getPrimarySport(plan) !== 'squash') return []

  const generated = weeks.filter((week) => week.sessions.length > 0).sort((a, b) => a.weekIndex - b.weekIndex)
  const byBlock = new Map<string, TrainingPlanWeek[]>()

  for (const week of generated) {
    const key = getPlanPhaseForWeek(plan, week)
    byBlock.set(key, [...(byBlock.get(key) ?? []), week])
  }

  const issues: PlanValidationIssue[] = []
  for (const blockWeeks of byBlock.values()) {
    const squashSessions = blockWeeks.flatMap((week) => week.sessions.filter((session) => session.sessionType === 'squash'))
    const drillKeys = squashSessions.flatMap(getSquashDrillKeys)
    if (squashSessions.length < 3 || drillKeys.length < 8) continue

    const counts = new Map<string, number>()
    for (const key of drillKeys) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }

    const uniqueCount = counts.size
    const varietyRatio = uniqueCount / drillKeys.length
    const topCount = Math.max(...counts.values())
    const topSessionRatio = topCount / squashSessions.length
    if (varietyRatio > 0.45 && topSessionRatio < 0.75) continue

    const lastWeek = blockWeeks[blockWeeks.length - 1]
    issues.push(issue({
      severity: 'warning',
      code: 'quality.squash.low_drill_variety',
      message: `Bloque ${lastWeek.phase} con baja variedad de squash: ${uniqueCount} drills únicos sobre ${drillKeys.length} usos.`,
      weekIndex: lastWeek.weekIndex,
    }))
  }

  return issues
}

const NUMERIC_REFERENCE_LABELS: Record<Exclude<ReferenceLift, 'pullUp'>, string> = {
  squat: 'sentadilla',
  deadlift: 'peso muerto',
  bench: 'press banca',
  overheadPress: 'press hombro',
}

// Un ejercicio cuenta como cobertura de su referencia solo si es el lift base o
// una variante cercana del mismo patrón. `factor` (carga relativa al 1RM de
// referencia) sirve de proxy: la banda [0.8, 1.0] admite variantes reales
// (sentadilla frontal 0.85, peso muerto sumo 0.95, RDL 0.8, press inclinado
// 0.85) y descarta accesorios de bajo factor (remos, zancadas) y movimientos
// mecánicamente ventajosos sobre el 1RM estricto (hip thrust 1.2, push press
// 1.15), que no demuestran uso del lift de referencia como movimiento base.
const COVERAGE_MIN_FACTOR = 0.8

function getAvailableNumericReferences(profile: AthleteProfile): Set<Exclude<ReferenceLift, 'pullUp'>> {
  const strength = profile.strengthProfile
  const available = new Set<Exclude<ReferenceLift, 'pullUp'>>()
  if ((strength?.squat1RM ?? 0) > 0) available.add('squat')
  if ((strength?.deadlift1RM ?? 0) > 0) available.add('deadlift')
  if ((strength?.benchPress1RM ?? 0) > 0) available.add('bench')
  if ((strength?.overheadPress1RM ?? 0) > 0) available.add('overheadPress')
  return available
}

function getProfileStrengthCoverageIssues(
  plan: TrainingPlan,
  weeks: TrainingPlanWeek[],
  profile: AthleteProfile | undefined,
): PlanValidationIssue[] {
  if (!profile || plan.totalWeeks < 4) return []
  const available = getAvailableNumericReferences(profile)
  if (available.size < 4) return []

  const strengthWeeks = weeks.filter((week) => week.sessions.some((session) => session.sessionType === 'strength'))
  if (strengthWeeks.length === 0) return []

  const covered = new Set<Exclude<ReferenceLift, 'pullUp'>>()
  for (const session of strengthWeeks.flatMap((week) => week.sessions.filter((item) => item.sessionType === 'strength'))) {
    for (const exercise of session.exercises ?? []) {
      if (exercise.targetPercent1RM == null) continue
      const reference = mapExerciseTo1RMReference(exercise.name, profile.strengthProfile)
      if (!reference || reference.lift === 'pullUp' || !available.has(reference.lift)) continue
      if (reference.factor < COVERAGE_MIN_FACTOR || reference.factor > 1) continue
      covered.add(reference.lift)
    }
  }

  const missing = [...available].filter((reference) => !covered.has(reference))
  if (missing.length === 0) return []

  const targetWeek = strengthWeeks[strengthWeeks.length - 1]
  const missingLabel = ` Faltan referencias de ${missing.map((reference) => NUMERIC_REFERENCE_LABELS[reference]).join(', ')}.`
  return [issue({
    severity: 'warning',
    code: 'quality.strength.profile_1rm_underused',
    message: `El perfil tiene ${available.size} referencias 1RM, pero el plan solo prescribe carga basada en ${covered.size} de ellas.${missingLabel}`,
    weekIndex: targetWeek.weekIndex,
  })]
}

function normalizeExerciseName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function scoreWeek(
  issues: PlanValidationIssue[],
  repairCount: number,
  qualityVersion: 1 | 2,
): number {
  const penalty = issues.reduce((total, item) => {
    if (isGenerationReliabilitySignal(item)) return total
    if (item.severity === 'error') return total + 22
    if (item.severity === 'warning') return total + 7
    return total + 3
  }, 0)
  // v2 remains opt-in until its repair penalty is calibrated from control data.
  const repairPenalty = qualityVersion === 1
    ? Math.min(10, Math.floor(repairCount / 2))
    : 0
  return clampScore(100 - penalty - repairPenalty)
}

function scorePlan(
  weeks: PlanQualityWeekReview[],
  planIssues: PlanValidationIssue[],
  repairCount: number,
  qualityVersion: 1 | 2,
): number {
  if (weeks.length === 0) return 0
  const average = weeks.reduce((total, week) => total + week.score, 0) / weeks.length
  const planPenalty = planIssues.reduce((total, item) => {
    if (isGenerationReliabilitySignal(item)) return total
    return total + (item.severity === 'error' ? 14 : item.severity === 'warning' ? 5 : 2)
  }, 0)
  const repairPenalty = qualityVersion === 1
    ? Math.min(8, Math.floor(repairCount / 8))
    : 0
  return clampScore(average - planPenalty - repairPenalty)
}

function isGenerationReliabilitySignal(issue: PlanValidationIssue): boolean {
  return issue.code.startsWith('quality.generation.')
}

export const LATEST_QUALITY_VERSION = 2 as const

/**
 * v2 excludes deterministic hydration and prevents overlapping observational
 * counters from penalising the same repair twice.
 */
export function countRepairsV2(week: TrainingPlanWeek): number {
  const meta = week.generationMeta
  return (meta.correctiveActionCount ?? 0)
    + (meta.structuralActionCount ?? 0)
    + (meta.movedSessionCount ?? 0)
    + (meta.droppedSessionCount ?? 0)
}

/** Same formula as countRepairsV2, applied to live repair metadata. */
export function countRepairsV2FromRepairMeta(meta: {
  movedSessionCount: number
  droppedSessionCount: number
  taxonomy: RepairTaxonomyMeta
}): number {
  const summary = summarizeTaxonomy(meta.taxonomy)
  return summary.correctiveActionCount
    + summary.structuralActionCount
    + meta.movedSessionCount
    + meta.droppedSessionCount
}

function countRepairs(week: TrainingPlanWeek, qualityVersion: 1 | 2): number {
  if (qualityVersion === 2) return countRepairsV2(week)

  const meta = week.generationMeta
  return (meta.repairedSessionCount ?? 0)
    + (meta.movedSessionCount ?? 0)
    + (meta.addedFallbackCount ?? 0)
    + (meta.filteredSportCount ?? 0)
}

function resolveQualityVersion(
  weeks: TrainingPlanWeek[],
  requested?: 1 | 2,
): 1 | 2 {
  const hasV2Taxonomy = weeks.length > 0
    && weeks.every((week) => week.generationMeta.repairTaxonomyVersion === 2)

  if (requested === 2 && !hasV2Taxonomy) {
    throw new Error('quality_version 2 requires repairTaxonomyVersion 2')
  }
  if (requested != null) return requested

  return hasV2Taxonomy
    && weeks.every((week) => week.generationMeta.qualityVersion === 2)
    ? 2
    : 1
}

export function reviewPlanQuality(
  plan: TrainingPlan,
  weeks: TrainingPlanWeek[],
  context: PlanQualityContext = {},
): PlanQualityReview {
  const sortedWeeks = [...weeks].sort((a, b) => a.weekIndex - b.weekIndex)
  const qualityVersion = resolveQualityVersion(sortedWeeks, context.qualityVersion)
  const planValidationIssues = validatePlan({ plan, weeks: sortedWeeks })
  const planLevelQualityIssues = [
    ...getPlanLevelIssues(plan, sortedWeeks),
    ...getRepeatedStrengthTemplateIssues(plan, sortedWeeks),
    ...getSquashDrillVarietyIssues(plan, sortedWeeks),
    ...getProfileStrengthCoverageIssues(plan, sortedWeeks, context.profile),
  ]

  const weekReviews = sortedWeeks.map((week) => {
    const issues = [
      ...validatePlanWeek(plan, week),
      ...getSportCompletenessIssues(week),
      ...getDistributionIssues(plan, week),
      ...getHardSessionClusterIssues(week),
      ...getGenerationReliabilityIssues(week, qualityVersion),
      ...planLevelQualityIssues.filter((item) => item.weekIndex === week.weekIndex),
    ]
    const repairCount = countRepairs(week, qualityVersion)
    const score = scoreWeek(issues, repairCount, qualityVersion)
    return {
      weekIndex: week.weekIndex,
      weekStartDate: week.weekStartDate,
      score,
      grade: gradeFromScore(score),
      issues,
      repairCount,
    }
  })

  const allIssues = [
    ...planValidationIssues,
    ...planLevelQualityIssues,
    ...weekReviews.flatMap((week) => week.issues),
  ]
  const uniqueIssues = allIssues.filter((item, index, arr) =>
    arr.findIndex((candidate) =>
      candidate.code === item.code
      && candidate.weekIndex === item.weekIndex
      && candidate.message === item.message,
    ) === index,
  )
  const repairCount = sortedWeeks.reduce(
    (total, week) => total + countRepairs(week, qualityVersion),
    0,
  )
  const score = scorePlan(weekReviews, planLevelQualityIssues, repairCount, qualityVersion)

  return {
    qualityVersion,
    score,
    grade: gradeFromScore(score),
    issues: uniqueIssues,
    weeks: weekReviews,
    repairCount,
    criticalIssueCount: uniqueIssues.filter((item) => item.severity === 'error').length,
    warningCount: uniqueIssues.filter((item) => item.severity === 'warning').length,
  }
}

export function buildPlanQualityRepairInstructions(review: PlanQualityReview): PlanQualityRepairInstructions {
  const byWeek = new Map<number, string[]>()

  for (const issue of review.issues) {
    if (issue.weekIndex == null) continue
    const items = byWeek.get(issue.weekIndex) ?? []
    items.push(issue.message)
    byWeek.set(issue.weekIndex, items)
  }

  for (const week of review.weeks) {
    if (week.grade !== 'poor' && week.grade !== 'needs_review') continue
    const items = byWeek.get(week.weekIndex) ?? []
    if (items.length === 0) {
      items.push(`Semana con score ${week.score}/100; reequilibra carga, especificidad deportiva y variedad de sesiones.`)
    }
    byWeek.set(week.weekIndex, items)
  }

  return Object.fromEntries(
    [...byWeek.entries()].map(([weekIndex, issues]) => [
      weekIndex,
      [
        `Repara la semana ${weekIndex + 1} del Plan Builder manteniendo el mismo targetDate.`,
        `Problemas detectados: ${issues.slice(0, 5).join(' · ')}`,
        'Genera una semana completa y aplicable, con exactamente la cantidad de sesiones pedida, fechas válidas, deportes permitidos, mejor progresión de carga, menos repetición de fuerza y taper/peak coherente según fase.',
        'No expliques fuera del JSON; corrige el plan en la acción create_week.',
      ].join('\n'),
    ]),
  )
}

import type { Session, SquashDrill, SquashTrainingFocus } from '../../types'
import {
  findSquashDrillByName,
  getSquashDrillFamily,
  getSuggestedTrainingFocus,
  normalizeSquashDrillKey,
  SQUASH_DRILL_LIBRARY,
  type DrillCategory,
  type SquashDrillDefinition,
} from './drillLibrary'
import type { DisciplineAcwr } from '../loadAnalytics'

export type SquashSelectionPhase = 'base' | 'build' | 'peak' | 'taper'

export interface SquashSelectionContext {
  fatigueLevel: number
  phase: SquashSelectionPhase
  recentDrills: string[]
  goal: string
  competitionSoon: boolean
  historicalSessions?: Session[]
  /** Quantitative ACWR signal for squash-specific load */
  squashAcwr?: DisciplineAcwr
}

// Fase 2: 4-state model. 'progress' = continuar familia con más exigencia,
// 'hold' = mantener sin agregar estímulo nuevo, 'rotate' = cambiar familia,
// 'deload' = bajar carga/volumen (fatiga, taper, competencia).
export type SquashProgressionRecommendation = 'progress' | 'hold' | 'rotate' | 'deload'

interface SquashFamilyProgressionEntry {
  family: string
  lastDrillId: string
  lastLevel: number
  frequency: number
  lastDate: string
  recentFocuses: string[]
}

export interface SquashProgressionState {
  recommendation: SquashProgressionRecommendation
  targetFamily?: string
  targetFocus?: string
  families: Record<string, SquashFamilyProgressionEntry>
}

interface DrillScore {
  drill: SquashDrillDefinition
  score: number
}

export function selectSquashDrills(
  context: SquashSelectionContext,
): { trainingFocus: SquashTrainingFocus; drills: SquashDrill[] } {
  const recentSet = new Set(context.recentDrills.map(normalizeSquashDrillKey))
  const progressionState = deriveSquashProgressionState(context)
  const byFatigue = filterByFatigue(SQUASH_DRILL_LIBRARY, context)
  const byPhase = filterByPhase(byFatigue, context)
  const withoutRecent = avoidRecentDrills(byPhase, recentSet)
  const pool = withoutRecent.length >= 3 ? withoutRecent : byPhase
  const selected = pickDiverseDrills(pool, context, recentSet, progressionState)

  const fallbackSelected = selected.length >= 3
    ? selected
    : pickDiverseDrills(byFatigue, context, recentSet, progressionState)

  const finalSelection = fallbackSelected.slice(0, 5)
  const trainingFocus = deriveTrainingFocus(finalSelection, context)

  return {
    trainingFocus,
    drills: finalSelection.map((definition, index) => ({
      name: definition.name,
      durationMin: getDrillDuration(definition, index, context),
      notes: buildProgressedDrillNotes(definition, context, progressionState),
    })),
  }
}

export function extractRecentSquashDrills(historicalSessions: Session[]): string[] {
  const squashSessions = [...historicalSessions]
    .filter(session =>
      session.type === 'squash' &&
      session.squashDetails?.drills &&
      session.squashDetails.drills.length > 0,
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.timeBlock.localeCompare(a.timeBlock))
    .slice(0, 4)

  return squashSessions.flatMap((session) =>
    (session.squashDetails?.drills ?? [])
      .map((drill) => findSquashDrillByName(drill.name)?.id ?? normalizeSquashDrillKey(drill.name)),
  )
}

export function filterByFatigue(
  drills: SquashDrillDefinition[],
  context: SquashSelectionContext,
): SquashDrillDefinition[] {
  if (context.competitionSoon) {
    return drills.filter((drill) => drill.intensity !== 'high' && !drill.tags.includes('rsa'))
  }

  if (context.fatigueLevel >= 7) {
    return drills.filter((drill) => drill.intensity === 'low' || drill.intensity === 'moderate')
  }

  if (context.fatigueLevel <= 3) {
    return drills
  }

  const highLimit = 2
  let highCount = 0
  return drills.filter((drill) => {
    if (drill.intensity !== 'high') return true
    highCount += 1
    return highCount <= highLimit
  })
}

export function filterByPhase(
  drills: SquashDrillDefinition[],
  context: SquashSelectionContext,
): SquashDrillDefinition[] {
  switch (context.phase) {
    case 'taper':
      return drills.filter((drill) =>
        !drill.tags.includes('rsa') &&
        !drill.tags.includes('multiball') &&
        !drill.tags.includes('match_play') &&
        drill.intensity !== 'high',
      )
    case 'peak':
      return drills.filter((drill) =>
        !drill.tags.includes('recovery_technical') || drill.tags.includes('pre_match'),
      )
    case 'build':
      return drills.filter((drill) =>
        !drill.tags.includes('pre_match') &&
        !drill.tags.includes('recovery_technical'),
      )
    case 'base':
    default:
      return drills.filter((drill) =>
        !drill.tags.includes('match_play') &&
        !drill.tags.includes('pre_match'),
      )
  }
}

export function avoidRecentDrills(
  drills: SquashDrillDefinition[],
  recentDrills: Set<string>,
): SquashDrillDefinition[] {
  return drills.filter((drill) => !recentDrills.has(normalizeSquashDrillKey(drill.id)))
}

export function pickDiverseDrills(
  drills: SquashDrillDefinition[],
  context: SquashSelectionContext,
  recentDrills: Set<string>,
  progressionState?: SquashProgressionState,
): SquashDrillDefinition[] {
  const scored = scoreDrillsWithProgression(drills, context, recentDrills, progressionState)
  const selected: SquashDrillDefinition[] = []
  const categories = new Set<DrillCategory>()
  const goal = context.goal.toLowerCase()
  const preferredCount = context.competitionSoon || context.fatigueLevel >= 7 ? 3 : 4

  for (const { drill } of scored) {
    const repeatedCategory = categories.has(drill.category)
    const isPhysicalHigh = drill.category === 'physical' && drill.intensity === 'high'
    if (
      repeatedCategory &&
      selected.length < 2 &&
      scored.some((candidate) => !categories.has(candidate.drill.category))
    ) {
      continue
    }
    if (context.phase === 'build' && selected.length === 0 && drill.category === 'physical') {
      continue
    }
    if ((context.competitionSoon || context.fatigueLevel >= 7) && isPhysicalHigh) {
      continue
    }

    selected.push(drill)
    categories.add(drill.category)

    if (selected.length >= preferredCount) break
  }

  if (selected.length < 3) {
    for (const { drill } of scored) {
      if (selected.some((item) => item.id === drill.id)) continue
      selected.push(drill)
      if (selected.length >= 3) break
    }
  }

  if (context.phase === 'build') {
    const hasTechnical = selected.some((drill) => drill.category === 'technical')
    const hasTactical = selected.some((drill) => drill.category === 'tactical')

    if (!(hasTechnical && hasTactical)) {
      const neededCategory: DrillCategory = hasTechnical ? 'tactical' : 'technical'
      const replacement = scored.find(({ drill }) =>
        drill.category === neededCategory &&
        !selected.some((item) => item.id === drill.id),
      )
      if (replacement) selected.push(replacement.drill)
    }
  }

  if (goal.includes('partido') || goal.includes('torneo')) {
    return selected.slice(0, Math.min(4, selected.length))
  }

  return selected.slice(0, 5)
}

function scoreDrills(
  drills: SquashDrillDefinition[],
  context: SquashSelectionContext,
  recentDrills: Set<string>,
): DrillScore[] {
  const goal = context.goal.toLowerCase()

  return drills
    .map((drill) => {
      let score = 0

      if (context.phase === 'build' && (drill.category === 'technical' || drill.category === 'tactical')) score += 4
      if (context.phase === 'base' && drill.category === 'technical') score += 4
      if (context.phase === 'peak' && (drill.tags.includes('pressure') || drill.tags.includes('match_play'))) score += 4
      if (context.phase === 'taper' && (drill.intensity === 'low' || drill.tags.includes('pre_match'))) score += 5

      if (context.competitionSoon && drill.tags.includes('pre_match')) score += 6
      if (context.competitionSoon && drill.tags.includes('recovery_technical')) score += 4
      if (context.competitionSoon && drill.intensity === 'high') score -= 8

      if (context.fatigueLevel >= 7 && drill.intensity === 'low') score += 5
      if (context.fatigueLevel >= 7 && drill.intensity === 'high') score -= 8

      if (goal.includes('drive') && drill.focus.includes('drive')) score += 5
      if (goal.includes('volea') && drill.focus.includes('volley')) score += 5
      if (goal.includes('t') && drill.tags.includes('t_control')) score += 5
      if (goal.includes('tact') && drill.category === 'tactical') score += 4
      if (goal.includes('control') && drill.tags.includes('length_control')) score += 4
      if (goal.includes('recuper') && drill.tags.includes('recovery_technical')) score += 5
      if (goal.includes('presion') && drill.tags.includes('pressure')) score += 4

      if (recentDrills.has(normalizeSquashDrillKey(drill.id))) score -= 10

      return { drill, score }
    })
    .sort((a, b) => b.score - a.score || a.drill.name.localeCompare(b.drill.name))
}

export function deriveSquashProgressionState(context: SquashSelectionContext): SquashProgressionState {
  const squashSessions = [...(context.historicalSessions ?? [])]
    .filter(session =>
      session.type === 'squash' &&
      session.squashDetails?.drills &&
      session.squashDetails.drills.length > 0,
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.timeBlock.localeCompare(a.timeBlock))
    .slice(0, 6)

  const families: Record<string, SquashFamilyProgressionEntry> = {}

  for (const session of squashSessions) {
    for (const drill of session.squashDetails?.drills ?? []) {
      const definition = findSquashDrillByName(drill.name)
      if (!definition) continue
      const family = getSquashDrillFamily(definition)
      const existing = families[family]
      const lastLevel = definition.progressionLevel ?? 1

      if (!existing) {
        families[family] = {
          family,
          lastDrillId: definition.id,
          lastLevel,
          frequency: 1,
          lastDate: session.date,
          recentFocuses: [...definition.focus],
        }
        continue
      }

      existing.frequency += 1
      existing.lastLevel = Math.max(existing.lastLevel, lastLevel)
      existing.recentFocuses = [...new Set([...existing.recentFocuses, ...definition.focus])].slice(0, 4)
    }
  }

  const mostRecentDefinition = squashSessions[0]?.squashDetails?.drills?.[0]
    ? findSquashDrillByName(squashSessions[0].squashDetails!.drills[0].name)
    : undefined
  const targetFamily = mostRecentDefinition ? getSquashDrillFamily(mostRecentDefinition) : undefined
  const targetFocus = mostRecentDefinition?.focus[0]

  // Deload: competition imminent, taper phase, or high fatigue
  if (context.competitionSoon || context.phase === 'taper' || context.fatigueLevel >= 7) {
    return { recommendation: 'deload', targetFamily, targetFocus, families }
  }

  // ACWR override: objective load signal overrides heuristic (risk wins)
  if (context.squashAcwr?.status === 'risk') {
    return { recommendation: 'deload', targetFamily, targetFocus, families }
  }

  if (!targetFamily) {
    return { recommendation: 'progress', targetFamily, targetFocus, families }
  }

  // Detect consecutive repetition: same family in the 2 most recent sessions
  const prevSessionDefinition = squashSessions[1]?.squashDetails?.drills?.[0]
    ? findSquashDrillByName(squashSessions[1].squashDetails!.drills[0].name)
    : undefined
  const prevFamily = prevSessionDefinition ? getSquashDrillFamily(prevSessionDefinition) : undefined
  const appearedConsecutive = prevFamily === targetFamily

  const recentFamily = families[targetFamily]

  // Rotate: same family used in consecutive sessions or overused (3+ times in last 6)
  if (appearedConsecutive || (recentFamily && recentFamily.frequency >= 3)) {
    return { recommendation: 'rotate', targetFamily, targetFocus, families }
  }

  // ACWR undertrained: nudge to progress when load is low and no rotation signal
  if (context.squashAcwr?.status === 'undertrained' && context.fatigueLevel <= 5) {
    return { recommendation: 'progress', targetFamily, targetFocus, families }
  }

  // Progress: family used once recently — add more exigence
  if (recentFamily && recentFamily.frequency === 1) {
    return { recommendation: 'progress', targetFamily, targetFocus, families }
  }

  // Hold: seen but not consecutive, maintain stimulus without escalating
  return { recommendation: 'hold', targetFamily, targetFocus, families }
}

export function shouldProgressSquashFamily(
  drill: SquashDrillDefinition,
  progressionState: SquashProgressionState,
): boolean {
  const family = getSquashDrillFamily(drill)
  const targetFamily = progressionState.targetFamily
  if (!targetFamily || progressionState.recommendation !== 'progress') return false
  if (family !== targetFamily) return false

  const familyEntry = progressionState.families[family]
  if (!familyEntry) return true
  return (drill.progressionLevel ?? 1) >= familyEntry.lastLevel
}

export function scoreDrillsWithProgression(
  drills: SquashDrillDefinition[],
  context: SquashSelectionContext,
  recentDrills: Set<string>,
  progressionState = deriveSquashProgressionState(context),
): DrillScore[] {
  const baseScores = scoreDrills(drills, context, recentDrills)

  return baseScores
    .map(({ drill, score }) => {
      const family = getSquashDrillFamily(drill)
      const familyEntry = progressionState.families[family]

      if (progressionState.recommendation === 'progress' && shouldProgressSquashFamily(drill, progressionState)) {
        score += 7
      }

      if (progressionState.recommendation === 'hold' && family === progressionState.targetFamily) {
        // hold: keep same family but don't prioritize harder variants
        score += 2
      }

      if (
        progressionState.recommendation === 'rotate' &&
        familyEntry &&
        family === progressionState.targetFamily
      ) {
        score -= 6
      }

      if (
        progressionState.recommendation === 'rotate' &&
        progressionState.targetFocus &&
        drill.focus.includes(progressionState.targetFocus) &&
        family !== progressionState.targetFamily
      ) {
        score += 4
      }

      if (progressionState.recommendation === 'deload') {
        if (drill.tags.includes('recovery_technical') || drill.tags.includes('pre_match') || drill.intensity === 'low') score += 6
        if (family === progressionState.targetFamily && drill.intensity === 'low') score += 2
      }

      return { drill, score }
    })
    .sort((a, b) => b.score - a.score || a.drill.name.localeCompare(b.drill.name))
}

function deriveTrainingFocus(
  drills: SquashDrillDefinition[],
  context: SquashSelectionContext,
): SquashTrainingFocus {
  if (drills.length === 0) return context.phase === 'taper' ? 'technical' : 'tactical'

  const conditionedCount = drills.filter((drill) => drill.tags.includes('conditioned_game')).length
  if (conditionedCount >= 2) return 'conditioned_games'

  const counts = new Map<SquashTrainingFocus, number>()
  for (const drill of drills) {
    const focus = getSuggestedTrainingFocus(drill.category, drill.tags)
    counts.set(focus, (counts.get(focus) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'technical'
}

function getDrillDuration(
  drill: SquashDrillDefinition,
  index: number,
  context: SquashSelectionContext,
): number {
  const base = context.competitionSoon ? 12 : context.fatigueLevel >= 7 ? 14 : 16
  const intensityAdjust = drill.intensity === 'low' ? -2 : drill.intensity === 'high' ? 2 : 0
  const positionAdjust = index === 0 ? 2 : 0
  return Math.max(10, Math.min(20, base + intensityAdjust + positionAdjust))
}

function buildDrillNotes(drill: SquashDrillDefinition, context: SquashSelectionContext): string {
  if (context.competitionSoon && drill.tags.includes('pre_match')) {
    return 'Activacion corta y precisa, sin fatiga residual.'
  }
  if (context.phase === 'taper') {
    return 'Mantener timing y sensaciones, evitando carga alta.'
  }
  if (context.fatigueLevel >= 7) {
    return 'Control tecnico y calidad de movimiento por sobre volumen.'
  }
  return drill.description
}

export function buildProgressedDrillNotes(
  drill: SquashDrillDefinition,
  context: SquashSelectionContext,
  progressionState = deriveSquashProgressionState(context),
): string {
  const baseNote = buildDrillNotes(drill, context)
  const family = getSquashDrillFamily(drill)

  if (progressionState.recommendation === 'deload') {
    return `${baseNote} Variante de control para mantener timing sin fatiga extra.`
  }

  if (progressionState.recommendation === 'progress' && shouldProgressSquashFamily(drill, progressionState)) {
    const nextConstraint = drill.constraints?.[0]
    const progressionCue = nextConstraint
      ? `Progresar familia ${family} agregando constraint: ${nextConstraint}.`
      : `Progresar familia ${family} con mayor exigencia de precision, decision o ritmo.`
    return `${baseNote} ${progressionCue}`
  }

  if (progressionState.recommendation === 'hold' && family === progressionState.targetFamily) {
    return `${baseNote} Mantener nivel de exigencia, sin escalar — consolidar lo entrenado.`
  }

  if (
    progressionState.recommendation === 'rotate' &&
    progressionState.targetFocus &&
    drill.focus.includes(progressionState.targetFocus) &&
    family !== progressionState.targetFamily
  ) {
    return `${baseNote} Rotacion del mismo foco para evitar repetir el drill exacto demasiado cerca.`
  }

  return baseNote
}

export function summarizeSquashProgression(context: SquashSelectionContext): string {
  const state = deriveSquashProgressionState(context)
  const acwrLabel = context.squashAcwr?.ratio != null
    ? ` ACWR squash: ${context.squashAcwr.ratio.toFixed(2)} (${context.squashAcwr.status}).`
    : context.squashAcwr?.status
      ? ` ACWR squash: ${context.squashAcwr.status}.`
      : ''

  if (!state.targetFamily) {
    return `Sin historia suficiente: usar variacion contextual limpia.${acwrLabel}`
  }

  switch (state.recommendation) {
    case 'deload':
      return `Descargar familia ${state.targetFamily} — variante controlada sin escalar carga.${acwrLabel}`
    case 'progress':
      return `Continuar familia ${state.targetFamily} con progresion (mas exigencia, constraint o ritmo).${acwrLabel}`
    case 'hold':
      return `Mantener familia ${state.targetFamily} — consolidar sin agregar estimulo nuevo.${acwrLabel}`
    case 'rotate':
      return `Rotar desde familia ${state.targetFamily} — cambiar foco para evitar sobreestimulo.${acwrLabel}`
  }
}

export function runSquashDrillSelectorSmokeChecks(): string[] {
  const outputs: string[] = []

  const buildA = selectSquashDrills({
    phase: 'build',
    fatigueLevel: 4,
    competitionSoon: false,
    goal: 'mejorar tactica y control del T',
    recentDrills: ['drive_parallel_depth', 'ghosting_4_corners'],
  })
  const buildB = selectSquashDrills({
    phase: 'build',
    fatigueLevel: 4,
    competitionSoon: false,
    goal: 'mejorar tactica y control del T',
    recentDrills: buildA.drills.map((drill) => normalizeSquashDrillKey(drill.name)),
  })
  outputs.push(`build_variation=${buildA.drills.map((d) => d.name).join(' | ')} <> ${buildB.drills.map((d) => d.name).join(' | ')}`)

  const fatigueHigh = selectSquashDrills({
    phase: 'build',
    fatigueLevel: 8,
    competitionSoon: false,
    goal: 'recuperar sensaciones',
    recentDrills: [],
  })
  outputs.push(`fatigue_high=${fatigueHigh.drills.map((d) => d.name).join(' | ')}`)

  const taper = selectSquashDrills({
    phase: 'taper',
    fatigueLevel: 5,
    competitionSoon: true,
    goal: 'llegar fresco al partido',
    recentDrills: [],
  })
  outputs.push(`taper_competition=${taper.drills.map((d) => d.name).join(' | ')}`)
  outputs.push(`progression_signal=${summarizeSquashProgression({
    phase: 'build',
    fatigueLevel: 4,
    competitionSoon: false,
    goal: 'mejorar tactica y control del T',
    recentDrills: buildA.drills.map((drill) => normalizeSquashDrillKey(drill.name)),
    historicalSessions: [],
  })}`)

  return outputs
}

// Fase 2 implementada: progresion 4-state (progress/hold/rotate/deload) con deteccion de familias consecutivas.
// Pendiente Fase 3: rotacion semanal explicita por microciclo, progresion cuantitativa de nivel, metadata visible en UI.

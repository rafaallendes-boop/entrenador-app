import type { Session, SquashDrill, SquashTrainingFocus } from '../../types'
import {
  findSquashDrillByName,
  getSuggestedTrainingFocus,
  normalizeSquashDrillKey,
  SQUASH_DRILL_LIBRARY,
  type DrillCategory,
  type SquashDrillDefinition,
} from './drillLibrary'

export type SquashSelectionPhase = 'base' | 'build' | 'peak' | 'taper'

export interface SquashSelectionContext {
  fatigueLevel: number
  phase: SquashSelectionPhase
  recentDrills: string[]
  goal: string
  competitionSoon: boolean
}

interface DrillScore {
  drill: SquashDrillDefinition
  score: number
}

export function selectSquashDrills(
  context: SquashSelectionContext,
): { trainingFocus: SquashTrainingFocus; drills: SquashDrill[] } {
  const recentSet = new Set(context.recentDrills.map(normalizeSquashDrillKey))
  const byFatigue = filterByFatigue(SQUASH_DRILL_LIBRARY, context)
  const byPhase = filterByPhase(byFatigue, context)
  const withoutRecent = avoidRecentDrills(byPhase, recentSet)
  const pool = withoutRecent.length >= 3 ? withoutRecent : byPhase
  const selected = pickDiverseDrills(pool, context, recentSet)

  const fallbackSelected = selected.length >= 3
    ? selected
    : pickDiverseDrills(byFatigue, context, recentSet)

  const finalSelection = fallbackSelected.slice(0, 5)
  const trainingFocus = deriveTrainingFocus(finalSelection, context)

  return {
    trainingFocus,
    drills: finalSelection.map((definition, index) => ({
      name: definition.name,
      durationMin: getDrillDuration(definition, index, context),
      notes: buildDrillNotes(definition, context),
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
): SquashDrillDefinition[] {
  const scored = scoreDrills(drills, context, recentDrills)
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

  return outputs
}

// TODO: agregar progresion multi-semana real por microciclo y soporte reutilizable para otros deportes.

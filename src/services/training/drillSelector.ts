import type {
  Session,
  SquashDrill,
  SquashDrillExecutionMode,
  SquashSessionBlock,
  SquashSessionBlockKind,
  SquashSessionKind,
  SquashTrainingFocus,
  GoalEventLevel,
} from '../../types'
import { getRecentSquashCompetitiveExposure } from '../../utils/squash'
import {
  findSquashDrillByName,
  getSquashDrillFamily,
  getSuggestedTrainingFocus,
  isControlDrill,
  orderSquashBlocksForSession,
  normalizeSquashDrillKey,
  orderSquashDrillsForSession,
  resolveDrillExecutionMode,
  resolveSquashDrillKind,
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
  desiredKind?: SquashSelectionDesiredKind
  partnerAvailability?: SquashPartnerAvailability
  competitiveLevel?: GoalEventLevel
}

export type SquashPartnerAvailability = 'solo' | 'partner' | 'either'

export type SquashSelectionDesiredKind =
  | SquashSessionBlockKind
  | 'mixed-control-technical'
  | 'mixed-shadows-control'
  | 'mixed-shadows-technical'

export interface SquashSelectionResult {
  trainingFocus: SquashTrainingFocus
  drills: SquashDrill[]
  sessionKind: SquashSessionKind
  blocks?: SquashSessionBlock[]
  selectionNote?: string
}

/**
 * Reemplazo enfocado para la rotación de drills. A diferencia de
 * `selectSquashDrills`, NO tiene válvula de escape: si no hay candidato válido
 * devuelve `undefined` en vez de readmitir un drill reciente. Reusar la ruta con
 * válvula haría que la telemetría reportara "roté" habiendo devuelto un repetido.
 *
 * Los hard constraints (fatiga, fase, partner) NUNCA se relajan: los niveles de
 * relajación solo aflojan `category` y kind.
 */
export type SquashRelaxationLevel = 'strict' | 'same_kind' | 'same_category' | 'any'

export interface SquashDrillReplacementRequest {
  originalName: string
  context: SquashSelectionContext
  excludedKeys: ReadonlySet<string>
  rotationIndex: number
  relaxation: SquashRelaxationLevel
  /**
   * Restringe el pool a estos IDs sin saltear los hard constraints. Un
   * finisher solo puede rotar entre finishers, pero sigue sujeto a fatiga,
   * fase y partner.
   */
  allowedIds?: ReadonlySet<string>
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

const MIXED_KIND_ORDER: Record<Exclude<SquashSelectionDesiredKind, SquashSessionBlockKind>, SquashSessionBlockKind[]> = {
  'mixed-control-technical': ['technical', 'control'],
  'mixed-shadows-control': ['shadows', 'control'],
  'mixed-shadows-technical': ['shadows', 'technical'],
}

function isPhaseAllowed(drill: SquashDrillDefinition, phase: SquashSelectionPhase): boolean {
  if (drill.phaseAppropriate) return drill.phaseAppropriate.includes(phase)

  switch (phase) {
    case 'base':
      return drill.tags.includes('base') || drill.tags.includes('recovery_technical')
    case 'build':
      return drill.tags.includes('build')
    case 'peak':
      return drill.tags.includes('peak') || drill.tags.includes('pre_match') || drill.tags.includes('match_play')
    case 'taper':
      return drill.tags.includes('taper') || drill.tags.includes('pre_match') || drill.tags.includes('recovery_technical')
    default:
      return true
  }
}

export function selectSquashDrills(
  context: SquashSelectionContext,
): SquashSelectionResult {
  const recentSet = new Set(context.recentDrills.map(normalizeSquashDrillKey))
  const progressionState = deriveSquashProgressionState(context)
  const byFatigue = filterByFatigue(SQUASH_DRILL_LIBRARY, context)
  const byPhase = filterByPhase(byFatigue, context)
  const byExecutionMode = filterByExecutionMode(byPhase, context.partnerAvailability)
  const fallbackByExecutionMode = filterByExecutionMode(byFatigue, context.partnerAvailability)
  const withoutRecent = avoidRecentDrills(byExecutionMode, recentSet)
  const basePool = withoutRecent.length >= 3 ? withoutRecent : byExecutionMode

  if (context.desiredKind) {
    // El pool tolerante conserva fase y fatiga: la única preferencia que se
    // relaja es evitar un drill reciente. `fallbackByExecutionMode` no sirve
    // acá porque no filtra por fase, y relajarla readmitiría partidos en base.
    return selectSquashDrillsByDesiredKind(basePool, byExecutionMode, context, recentSet, progressionState)
  }

  const selected = pickDiverseDrills(basePool, context, recentSet, progressionState)
  const fallbackSelected = selected.length >= 3
    ? selected
    : pickDiverseDrills(fallbackByExecutionMode, context, recentSet, progressionState)

  return buildSelectionResult(fallbackSelected.slice(0, 5), context, progressionState)
}

export function selectSquashDrillReplacement(
  request: SquashDrillReplacementRequest,
): SquashDrillDefinition | undefined {
  const original = findSquashDrillByName(request.originalName)
  if (!original) return undefined

  const originalKind = resolveSquashDrillKind(original)

  // Hard constraints: siempre, en todos los niveles.
  const byFatigue = filterByFatigue(SQUASH_DRILL_LIBRARY, request.context)
  const byPhase = filterByPhase(byFatigue, request.context)
  const allowed = filterByExecutionMode(byPhase, request.context.partnerAvailability)

  const matchesAxis = (candidate: SquashDrillDefinition): boolean => {
    const sameCategory = candidate.category === original.category
    const sameKind = resolveSquashDrillKind(candidate) === originalKind
    switch (request.relaxation) {
      case 'strict': return sameCategory && sameKind
      case 'same_kind': return sameKind
      case 'same_category': return sameCategory
      case 'any': return true
    }
  }

  const candidates = allowed
    .filter(matchesAxis)
    .filter((candidate) => request.allowedIds == null || request.allowedIds.has(candidate.id))
    .filter((candidate) => !request.excludedKeys.has(normalizeSquashDrillKey(candidate.id)))
    // Orden total y estable: sin esto el índice no es determinista.
    .sort((a, b) => scoreByFocusOverlap(b, original) - scoreByFocusOverlap(a, original)
      || a.id.localeCompare(b.id))

  if (candidates.length === 0) return undefined
  return candidates[request.rotationIndex % candidates.length]
}

/** `focus` es preferencia de scoring, NO filtro: filtrarlo colapsa el pool. */
function scoreByFocusOverlap(
  candidate: SquashDrillDefinition,
  original: SquashDrillDefinition,
): number {
  return candidate.focus.filter((value) => original.focus.includes(value)).length
}

function selectSquashDrillsByDesiredKind(
  basePool: SquashDrillDefinition[],
  recentTolerantPool: SquashDrillDefinition[],
  context: SquashSelectionContext,
  recentSet: Set<string>,
  progressionState: SquashProgressionState,
): SquashSelectionResult {
  const desiredKind = context.desiredKind!

  if (desiredKind === 'match' && context.partnerAvailability === 'solo') {
    // Redirección declarada, no silenciosa: un partido sin partner es
    // inejecutable. El destino es control, y si control tampoco alcanza se
    // entrega corto — caer a `pickDiverseDrills` readmitiría justamente los
    // drills con partner que motivaron la redirección.
    const selected = buildSingleKindSelection(
      'control',
      basePool,
      recentTolerantPool,
      context,
      recentSet,
      progressionState,
    )
    return {
      ...buildSelectionResult(selected.slice(0, 5), context, progressionState),
      selectionNote: 'desiredKind=match requiere partner; modalidad solo redirigida a control sin partido.',
    }
  }

  if (desiredKind in MIXED_KIND_ORDER) {
    const selected = buildMixedKindSelection(
      MIXED_KIND_ORDER[desiredKind as keyof typeof MIXED_KIND_ORDER],
      basePool,
      context,
      recentSet,
      progressionState,
    )
    if (selected.length >= 2) {
      return buildSelectionResult(selected, context, progressionState)
    }
    return {
      ...buildSelectionResult(selected, context, progressionState),
      selectionNote: `desiredKind=${desiredKind} sin pool suficiente; se entrega la mezcla parcial disponible.`,
    }
  }

  const selected = buildSingleKindSelection(
    desiredKind as SquashSessionBlockKind,
    basePool,
    recentTolerantPool,
    context,
    recentSet,
    progressionState,
  )
  if (selected.length >= 2 || desiredKind === 'match') {
    return buildSelectionResult(selected, context, progressionState)
  }

  // Pool agotado dentro de la modalidad pedida. Antes acá se llamaba a
  // `pickDiverseDrills` sobre el pool completo, que devuelve cualquier
  // modalidad: es el cruce silencioso que esta entrega elimina. Se entrega lo
  // que haya de la modalidad correcta y se declara la insuficiencia.
  return {
    ...buildSelectionResult(selected, context, progressionState),
    selectionNote: `desiredKind=${desiredKind} sin pool suficiente; no se cruza de modalidad.`,
  }
}

/**
 * Selección pura de una modalidad. Nunca cruza a otra.
 *
 * Antes, un pool corto caía a `['control','technical']` o a
 * `['technical','control']`: una sesión de control terminaba con drills que
 * exigen partner sin que nadie lo pidiera ni lo registrara. La única relajación
 * admitida es reutilizar un drill reciente **de la misma modalidad**; agotar la
 * modalidad se informa hacia arriba y lo resuelve el llamador, no el selector.
 */
function buildSingleKindSelection(
  kind: SquashSessionBlockKind,
  pool: SquashDrillDefinition[],
  recentTolerantPool: SquashDrillDefinition[],
  context: SquashSelectionContext,
  recentSet: Set<string>,
  progressionState: SquashProgressionState,
): SquashDrillDefinition[] {
  const kindPool = filterBySessionKind(pool, kind, context)
  const preferredCount = kind === 'match' ? 2 : kind === 'shadows' ? 1 : 3
  const selected = pickKindDrills(kindPool, context, recentSet, progressionState, preferredCount)

  if (selected.length >= Math.min(preferredCount, 2)) return selected

  // Reutilizar modalidad antes que mezclar: se afloja "evitar reciente", que es
  // una preferencia, y no la modalidad, que es identidad.
  const tolerantPool = filterBySessionKind(recentTolerantPool, kind, context)
  const retried = pickKindDrills(tolerantPool, context, new Set<string>(), progressionState, preferredCount)

  return retried.length > selected.length ? retried : selected
}

function buildMixedKindSelection(
  blockKinds: SquashSessionBlockKind[],
  pool: SquashDrillDefinition[],
  context: SquashSelectionContext,
  recentSet: Set<string>,
  progressionState: SquashProgressionState,
): SquashDrillDefinition[] {
  const selected: SquashDrillDefinition[] = []

  for (const kind of blockKinds) {
    const kindPool = filterBySessionKind(pool, kind, context)
    const targetCount = kind === 'shadows' ? 1 : kind === 'match' ? 1 : 2
    const kindSelection = pickKindDrills(kindPool, context, recentSet, progressionState, targetCount)
    selected.push(...kindSelection)
  }

  return dedupeDrills(orderSelectionDefinitions(selected)).slice(0, 5)
}

function filterBySessionKind(
  drills: SquashDrillDefinition[],
  kind: SquashSessionBlockKind,
  context: SquashSelectionContext,
): SquashDrillDefinition[] {
  return drills.filter((drill) => {
    const drillKind = resolveSquashDrillKind(drill)
    // Sin excepción por fase para control: la razón de existir de una sesión de
    // control es que se puede hacer solo, y eso no cambia en taper. La excepción
    // anterior admitía cualquier drill con `recovery_technical`, que tras la
    // separación de modalidad son cooperativos: el día antes del torneo la
    // activación terminaba exigiendo partner.
    if (kind === 'match' && context.phase === 'taper') {
      return drill.tags.includes('pre_match')
    }
    return drillKind === kind
  })
}

function pickKindDrills(
  drills: SquashDrillDefinition[],
  context: SquashSelectionContext,
  recentDrills: Set<string>,
  progressionState: SquashProgressionState,
  targetCount: number,
): SquashDrillDefinition[] {
  const scored = scoreDrillsWithProgression(drills, context, recentDrills, progressionState)
  const selected: SquashDrillDefinition[] = []

  for (const { drill } of scored) {
    const kind = resolveSquashDrillKind(drill)

    if (kind === 'shadows' && selected.some((item) => resolveSquashDrillKind(item) === 'shadows')) {
      continue
    }
    if (kind === 'control' && selected.some((item) => resolveSquashDrillKind(item) === 'match')) {
      continue
    }
    if (kind === 'match' && selected.some((item) => isControlDrill(item))) {
      continue
    }

    selected.push(drill)
    if (selected.length >= targetCount) break
  }

  return selected
}

function buildSelectionResult(
  definitions: SquashDrillDefinition[],
  context: SquashSelectionContext,
  progressionState: SquashProgressionState,
): SquashSelectionResult {
  const orderedDefinitions = orderSelectionDefinitions(definitions)
  const drills = orderSquashDrillsForSession(
    orderedDefinitions.map((definition, index) => ({
      name: definition.name,
      durationMin: getDrillDuration(definition, index, context),
      notes: buildProgressedDrillNotes(definition, context, progressionState),
      executionMode: resolveDrillExecutionMode(definition),
    })),
  )
  const blocks = buildSelectionBlocks(orderedDefinitions, drills)
  const sessionKind = resolveSelectedSessionKind(blocks)

  return {
    trainingFocus: deriveTrainingFocus(orderedDefinitions, context),
    drills,
    sessionKind,
    blocks,
  }
}

function buildSelectionBlocks(
  definitions: SquashDrillDefinition[],
  drills: SquashDrill[],
): SquashSessionBlock[] {
  const blockMap = new Map<SquashSessionBlockKind, SquashDrill[]>()

  for (const definition of definitions) {
    const kind = resolveSquashDrillKind(definition)
    const drill = drills.find((item) => item.name === definition.name)
    if (!drill) continue
    const existing = blockMap.get(kind) ?? []
    existing.push(drill)
    blockMap.set(kind, existing)
  }

  return orderSquashBlocksForSession(
    [...blockMap.entries()].map(([kind, blockDrills]) => ({
      kind,
      drills: blockDrills,
      durationMin: blockDrills.reduce((sum, drill) => sum + (drill.durationMin ?? 0), 0) || undefined,
    })),
  )
}

function resolveSelectedSessionKind(blocks: SquashSessionBlock[]): SquashSessionKind {
  if (blocks.length === 0) return 'technical'
  if (blocks.length === 1) return blocks[0]!.kind
  return 'mixed'
}

function orderSelectionDefinitions(definitions: SquashDrillDefinition[]): SquashDrillDefinition[] {
  const orderedKinds = orderSquashBlocksForSession(
    dedupeDrills(definitions).map((definition) => ({
      kind: resolveSquashDrillKind(definition),
      definition,
    })),
  )
  return orderedKinds.map((item) => item.definition)
}

function dedupeDrills(definitions: SquashDrillDefinition[]): SquashDrillDefinition[] {
  return [...new Map(definitions.map((definition) => [definition.id, definition])).values()]
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
    return drills.filter((drill) =>
      drill.intensity !== 'high' &&
      !drill.tags.includes('rsa') &&
      !(drill.tags.includes('match_play') && drill.tags.includes('practice')),
    )
  }

  if (context.fatigueLevel >= 7) {
    return drills.filter((drill) =>
      (drill.intensity === 'low' || drill.intensity === 'moderate') &&
      !(drill.tags.includes('match_play') && drill.tags.includes('practice')),
    )
  }

  if (context.fatigueLevel <= 3) {
    return drills
  }

  const nonHigh = drills.filter((drill) => drill.intensity !== 'high')
  const high = drills
    .filter((drill) => drill.intensity === 'high')
    .sort((a, b) => {
      const aScore = Number(a.tags.includes('pressure')) + Number(a.tags.includes('match_play')) + Number(a.tags.includes('peak'))
      const bScore = Number(b.tags.includes('pressure')) + Number(b.tags.includes('match_play')) + Number(b.tags.includes('peak'))
      return bScore - aScore || a.id.localeCompare(b.id)
    })

  return [...nonHigh, ...high.slice(0, 2)]
}

export function filterByPhase(
  drills: SquashDrillDefinition[],
  context: SquashSelectionContext,
): SquashDrillDefinition[] {
  switch (context.phase) {
    case 'taper':
      return drills.filter((drill) =>
        isPhaseAllowed(drill, 'taper') &&
        !drill.tags.includes('rsa') &&
        !drill.tags.includes('multiball') &&
        !drill.tags.includes('match_play') &&
        drill.intensity !== 'high',
      )
    case 'peak':
      return drills.filter((drill) =>
        isPhaseAllowed(drill, 'peak') &&
        !drill.tags.includes('recovery_technical'),
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

/**
 * Filtra por la disponibilidad declarada del atleta.
 *
 * Ojo con el alcance: esto responde "¿tiene con quién jugar?", no "¿de qué tipo
 * es la sesión?". La modalidad de la sesión la decide la intención estructural
 * y se aplica antes; este filtro sólo recorta el pool resultante. Con
 * `either` —el default, y en la práctica el único valor que llega hoy porque el
 * wizard no captura disponibilidad— no recorta nada.
 */
export function filterByExecutionMode(
  drills: SquashDrillDefinition[],
  partnerAvailability: SquashPartnerAvailability = 'either',
): SquashDrillDefinition[] {
  if (partnerAvailability === 'either') return drills

  return drills.filter((drill) => {
    const executionMode: SquashDrillExecutionMode = resolveDrillExecutionMode(drill)
    if (partnerAvailability === 'solo') {
      if (drill.partnerRequired) return false
      return executionMode === 'solo'
    }
    // Con partner disponible las sombras siguen siendo válidas: son el único
    // contenido en solitario que complementa una sesión con otra persona.
    if (executionMode === 'solo') return resolveSquashDrillKind(drill) === 'shadows'
    return true
  })
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

  if (shouldPrioritizePracticeMatch(context)) {
    const practiceMatch = scored.find(({ drill }) =>
      drill.tags.includes('match_play') &&
      drill.tags.includes('practice'),
    )?.drill

    if (practiceMatch && !selected.some((drill) => drill.id === practiceMatch.id)) {
      if (selected.length >= preferredCount) {
        selected[selected.length - 1] = practiceMatch
      } else {
        selected.push(practiceMatch)
      }
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
  const recentMatchExposure = getRecentSquashCompetitiveExposure(context.historicalSessions ?? [])
  const wantsCompetitiveExposure =
    goal.includes('partido') ||
    goal.includes('presion') ||
    goal.includes('torneo') ||
    goal.includes('tact') ||
    goal.includes('compet') ||
    goal.includes('match')

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
      if (context.competitionSoon && drill.tags.includes('match_play') && drill.tags.includes('practice')) score -= 10

      if (context.fatigueLevel >= 7 && drill.intensity === 'low') score += 5
      if (context.fatigueLevel >= 7 && drill.intensity === 'high') score -= 8
      if (context.fatigueLevel >= 7 && drill.tags.includes('match_play') && drill.tags.includes('practice')) score -= 10

      if (goal.includes('drive') && drill.focus.includes('drive')) score += 5
      if (goal.includes('volea') && drill.focus.includes('volley')) score += 5
      if (goal.includes('t') && drill.tags.includes('t_control')) score += 5
      if (goal.includes('tact') && drill.category === 'tactical') score += 4
      if (goal.includes('control') && drill.tags.includes('length_control')) score += 4
      if (goal.includes('recuper') && drill.tags.includes('recovery_technical')) score += 5
      if (goal.includes('presion') && drill.tags.includes('pressure')) score += 4
      if (context.desiredKind === 'control' && drill.tags.includes('volume_reps')) score += 1

      if (context.competitiveLevel === 'elite' || context.competitiveLevel === 'masters') {
        if (drill.category === 'tactical') score += 3
        if (drill.tags.includes('pressure')) score += 4
        if (drill.tags.includes('conditioned_game')) score += 3
        if (drill.tags.includes('match_play') && context.partnerAvailability !== 'solo') score += 3
        if ((drill.progressionLevel ?? 1) >= 3) score += context.competitiveLevel === 'elite' ? 3 : 2
        if (drill.tags.includes('volume_reps') && !context.goal.toLowerCase().includes('control')) score -= 3
      } else if (context.competitiveLevel === 'competitive') {
        if (drill.tags.includes('pressure') || drill.tags.includes('conditioned_game')) score += 2
        if ((drill.progressionLevel ?? 1) >= 2) score += 1
      } else if (context.competitiveLevel === 'recreational') {
        if ((drill.progressionLevel ?? 1) >= 3) score -= 3
        if (drill.intensity === 'low' || drill.tags.includes('control_session')) score += 2
      }

      if (!context.competitionSoon && context.fatigueLevel <= 6 && (context.phase === 'build' || context.phase === 'peak')) {
        if (drill.tags.includes('match_play') && drill.tags.includes('practice') && wantsCompetitiveExposure) score += 8
        if (drill.tags.includes('match_play') && drill.tags.includes('practice') && recentMatchExposure.totalMatchCount === 0) score += 4
        if (drill.tags.includes('match_play') && drill.tags.includes('practice') && recentMatchExposure.practiceMatchCount >= 2) score -= 6
        if (drill.tags.includes('match_play') && drill.tags.includes('practice') && recentMatchExposure.exposureScore >= 3) score -= 4
      }
      if (context.phase === 'taper' && drill.tags.includes('match_play') && drill.tags.includes('practice')) score -= 9

      if (recentDrills.has(normalizeSquashDrillKey(drill.id))) score -= 10

      return { drill, score }
    })
    .sort((a, b) => b.score - a.score || a.drill.id.localeCompare(b.drill.id))
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

  const recentDefinitions = (squashSessions[0]?.squashDetails?.drills ?? [])
    .map((drill) => findSquashDrillByName(drill.name))
    .filter((drill): drill is SquashDrillDefinition => Boolean(drill))
  const targetFamily = recentDefinitions[0] ? getSquashDrillFamily(recentDefinitions[0]) : undefined
  const targetFocus = resolvePrimaryFocus(recentDefinitions)

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
  const prevSessionDefinitions = (squashSessions[1]?.squashDetails?.drills ?? [])
    .map((drill) => findSquashDrillByName(drill.name))
    .filter((drill): drill is SquashDrillDefinition => Boolean(drill))
  const prevFamily = prevSessionDefinitions[0] ? getSquashDrillFamily(prevSessionDefinitions[0]) : undefined
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

function resolvePrimaryFocus(definitions: SquashDrillDefinition[]): string | undefined {
  const counts = new Map<string, number>()

  for (const definition of definitions) {
    for (const focus of definition.focus) {
      counts.set(focus, (counts.get(focus) ?? 0) + 1)
    }
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
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
  return (drill.progressionLevel ?? 1) > familyEntry.lastLevel
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
    .sort((a, b) => b.score - a.score || a.drill.id.localeCompare(b.drill.id))
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
  const volumeCue = getVolumePrescription(drill)
  if (context.competitionSoon && drill.tags.includes('pre_match')) {
    return 'Activacion corta y precisa, sin fatiga residual.'
  }
  if (context.phase === 'taper') {
    return `Mantener timing y sensaciones, evitando carga alta.${volumeCue ? ` ${volumeCue}` : ''}`
  }
  if (context.fatigueLevel >= 7) {
    return `Control tecnico y calidad de movimiento por sobre volumen.${volumeCue ? ` ${volumeCue}` : ''}`
  }
  return `${drill.description}${volumeCue ? ` ${volumeCue}` : ''}`
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
  const recentMatchExposure = getRecentSquashCompetitiveExposure(context.historicalSessions ?? [])
  const acwrLabel = context.squashAcwr?.ratio != null
    ? ` ACWR squash: ${context.squashAcwr.ratio.toFixed(2)} (${context.squashAcwr.status}).`
    : context.squashAcwr?.status
      ? ` ACWR squash: ${context.squashAcwr.status}.`
      : ''
  const matchPlayLabel = ` Exposicion reciente a match-play: ${recentMatchExposure.practiceMatchCount} practice / ${recentMatchExposure.competitionMatchCount} competencia.`

  if (!state.targetFamily) {
    return `Sin historia suficiente: usar variacion contextual limpia.${matchPlayLabel}${acwrLabel}`
  }

  switch (state.recommendation) {
    case 'deload':
      return `Descargar familia ${state.targetFamily} — variante controlada sin escalar carga.${matchPlayLabel}${acwrLabel}`
    case 'progress':
      return `Continuar familia ${state.targetFamily} con progresion (mas exigencia, constraint o ritmo).${matchPlayLabel}${acwrLabel}`
    case 'hold':
      return `Mantener familia ${state.targetFamily} — consolidar sin agregar estimulo nuevo.${matchPlayLabel}${acwrLabel}`
    case 'rotate':
      return `Rotar desde familia ${state.targetFamily} — cambiar foco para evitar sobreestimulo.${matchPlayLabel}${acwrLabel}`
  }
}

function shouldPrioritizePracticeMatch(context: SquashSelectionContext): boolean {
  const goal = context.goal.toLowerCase()
  const recentExposure = getRecentSquashCompetitiveExposure(context.historicalSessions ?? [])
  const wantsCompetitiveExposure =
    goal.includes('partido') ||
    goal.includes('presion') ||
    goal.includes('torneo') ||
    goal.includes('tact') ||
    goal.includes('compet') ||
    goal.includes('match')

  return (
    wantsCompetitiveExposure &&
    !context.competitionSoon &&
    context.fatigueLevel <= 6 &&
    (context.phase === 'build' || context.phase === 'peak') &&
    recentExposure.practiceMatchCount < 2 &&
    recentExposure.exposureScore < 3
  )
}

function getVolumePrescription(drill: SquashDrillDefinition): string {
  switch (drill.id) {
    case 'solo_100_drops':
      return 'Objetivo: 100 reps totales, 50 por lado.'
    case 'solo_100_mid_court_shots':
      return 'Objetivo: 100 reps totales alternando paralelo y cruzado.'
    case 'solo_100_service_box':
      return 'Objetivo: 100 reps al target, 50 por lado.'
    case 'solo_100_parallels_back':
      return 'Objetivo: 100 paralelas de fondo, 50 por lado.'
    case 'solo_volleys_only':
      return 'Objetivo: series limpias de 20 contactos antes de progresar.'
    default:
      return drill.tags.includes('volume_reps') ? 'Usa durationMin como aproximación; manda la cuenta objetivo de reps.' : ''
  }
}

export function runSquashDrillSelectorSmokeChecks(): string[] {
  const outputs: string[] = []

  const buildA = selectSquashDrills({
    phase: 'build',
    fatigueLevel: 4,
    competitionSoon: false,
    goal: 'mejorar tactica y control de la T',
    recentDrills: ['drive_parallel_depth', 'ghosting_4_corners'],
  })
  const buildB = selectSquashDrills({
    phase: 'build',
    fatigueLevel: 4,
    competitionSoon: false,
    goal: 'mejorar tactica y control de la T',
    recentDrills: buildA.drills.map((drill) => normalizeSquashDrillKey(drill.name)),
  })
  outputs.push(`build_variation=${buildA.sessionKind}:${buildA.drills.map((d) => d.name).join(' | ')} <> ${buildB.sessionKind}:${buildB.drills.map((d) => d.name).join(' | ')}`)

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
  outputs.push(`taper_competition=${taper.sessionKind}:${taper.drills.map((d) => d.name).join(' | ')}`)
  outputs.push(`progression_signal=${summarizeSquashProgression({
    phase: 'build',
    fatigueLevel: 4,
    competitionSoon: false,
    goal: 'mejorar tactica y control de la T',
    recentDrills: buildA.drills.map((drill) => normalizeSquashDrillKey(drill.name)),
    historicalSessions: [],
  })}`)

  return outputs
}

// Fase 2 implementada: progresion 4-state (progress/hold/rotate/deload) con deteccion de familias consecutivas.
// Pendiente Fase 3: rotacion semanal explicita por microciclo, progresion cuantitativa de nivel, metadata visible en UI.

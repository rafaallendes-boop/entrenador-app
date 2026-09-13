import type { SquashTrainingContext } from '../../types/squashTrainingContext'
import { doseSquashSession } from './squashSessionDose'
import type {
  GoalEventLevel,
  Session,
  SquashDetails,
  SquashSessionBlock,
  SquashSessionBlockKind,
  SquashSubtype,
} from '../../types'
import type { DisciplineAcwr } from '../loadAnalytics'
import { orderSquashBlocksForSession, resolveSquashDrillKind, findSquashDrillByName } from './drillLibrary'
import {
  selectSquashDrills,
  type SquashPartnerAvailability,
  type SquashSelectionPhase,
} from './drillSelector'

/**
 * Composición de una sesión de squash a partir de una intención declarada.
 *
 * Es la única autoridad de composición: Plan Builder, Crear semana, chat y
 * formulario manual entran por acá para que la misma intención produzca la
 * misma sesión. La modalidad llega como dato (`kind`) y nunca se infiere del
 * título, del objetivo ni de `focusKey`.
 *
 * Función pura: no lee Dexie, no llama al proveedor y no depende del reloj.
 */

export type SquashHydrationWarningCode =
  | 'duration_infeasible'
  | 'pool_insufficient'
  | 'shadows_accessory_unavailable'
  | 'match_requires_partner'
  | 'accessory_dropped'

export interface SquashHydrationWarning {
  code: SquashHydrationWarningCode
  message: string
}

export interface SquashHydrationInput extends SquashTrainingContext {
  /** Modalidad principal declarada. Autoridad de la composición. */
  kind: SquashSessionBlockKind
  durationMin: number
  phase: SquashSelectionPhase
  fatigueLevel: number
  goal: string
  recentDrills: string[]
  competitionSoon: boolean
  competitiveLevel?: GoalEventLevel
  partnerAvailability?: SquashPartnerAvailability
  referenceDate?: string
  historicalSessions?: Session[]
  squashAcwr?: DisciplineAcwr
  /** Sombras como complemento del bloque principal. Nunca lo reemplaza. */
  withShadowsAccessory?: boolean
  /** Distingue partido de entrenamiento de partido de competencia. */
  competitive?: boolean
}

export interface SquashHydrationResult {
  subtype: SquashSubtype
  details: SquashDetails
  warnings: SquashHydrationWarning[]
  /** Presente sólo cuando la modalidad entregada difiere de la pedida. */
  fallback?: {
    requestedKind: SquashSessionBlockKind
    resolvedKind: SquashSessionBlockKind
    reason: SquashHydrationWarningCode
  }
}

/**
 * Combinaciones válidas. La clave es la modalidad principal; el valor son los
 * accesorios admitidos. Un accesorio nunca cambia `sessionKind`: una sesión de
 * control con sombras sigue siendo una sesión de control.
 */
const ALLOWED_ACCESSORIES: Record<SquashSessionBlockKind, SquashSessionBlockKind[]> = {
  control: ['shadows'],
  technical: ['shadows'],
  match: ['shadows'],
  shadows: [],
}

/**
 * Única regla de compatibilidad entre la modalidad principal y contenido
 * conocido. La UI la usa para advertir sin borrar contenido histórico.
 */
export function isSquashDrillKindCompatible(
  sessionKind: SquashSessionBlockKind,
  drillKind: SquashSessionBlockKind,
): boolean {
  return drillKind === sessionKind || ALLOWED_ACCESSORIES[sessionKind].includes(drillKind)
}

export function projectSquashSubtype(
  kind: SquashSessionBlockKind,
  competitive = false,
): SquashSubtype {
  if (kind === 'match') return competitive ? 'competitive' : 'match'
  if (kind === 'control') return 'control'
  // Sombras y técnico comparten `training`; la carga ligera se expresa en
  // duración y RPE, no en la modalidad.
  return 'training'
}

function selectForKind(kind: SquashSessionBlockKind, input: SquashHydrationInput) {
  return selectSquashDrills({
    availability: input.availability,
    technicalIntent: input.technicalIntent,
    fatigueLevel: input.fatigueLevel,
    phase: input.phase,
    recentDrills: input.recentDrills,
    goal: input.goal,
    competitionSoon: input.competitionSoon,
    competitiveLevel: input.competitiveLevel,
    partnerAvailability: input.availability?.partnerAvailability ?? input.partnerAvailability,
    historicalSessions: input.historicalSessions,
    referenceDate: input.referenceDate,
    squashAcwr: input.squashAcwr,
    desiredKind: kind,
  })
}

/** Conserva sólo los drills que pertenecen realmente a la modalidad pedida. */
function keepOnlyKind(
  blocks: SquashSessionBlock[] | undefined,
  kind: SquashSessionBlockKind,
): SquashSessionBlock[] {
  return (blocks ?? [])
    .map((block) => ({
      ...block,
      drills: (block.drills ?? []).filter((drill) => {
        const definition = findSquashDrillByName(drill.name)
        return definition != null && resolveSquashDrillKind(definition) === kind
      }),
    }))
    .filter((block) => block.drills.length > 0)
    .map((block) => ({ ...block, kind }))
}

export function hydrateSquashSession(input: SquashHydrationInput): SquashHydrationResult {
  const warnings: SquashHydrationWarning[] = []

  // Un partido sin partner es inejecutable. La redirección se declara; no se
  // resuelve en silencio ni se compensa con contenido de otra modalidad.
  let kind = input.kind
  let fallback: SquashHydrationResult['fallback']
  if (kind === 'match' && (input.availability?.partnerAvailability ?? input.partnerAvailability) === 'solo') {
    warnings.push({
      code: 'match_requires_partner',
      message: 'Un partido necesita rival: se entrega trabajo de control ejecutable en solitario.',
    })
    fallback = { requestedKind: 'match', resolvedKind: 'control', reason: 'match_requires_partner' }
    kind = 'control'
  }

  const selection = selectForKind(kind, input)
  const mainBlocks = keepOnlyKind(selection.blocks, kind)

  const blocks: SquashSessionBlock[] = [...mainBlocks]

  if (input.withShadowsAccessory && ALLOWED_ACCESSORIES[kind].includes('shadows')) {
    const shadowsSelection = selectForKind('shadows', input)
    const shadowsBlocks = keepOnlyKind(shadowsSelection.blocks, 'shadows')
    if (shadowsBlocks.length === 0) {
      warnings.push({
        code: 'shadows_accessory_unavailable',
        message: 'No hay sombras elegibles para esta fase; la sesión queda sin el complemento.',
      })
    } else {
      blocks.push(...shadowsBlocks)
    }
  }

  const orderedBlocks = orderSquashBlocksForSession(blocks)
  const drills = orderedBlocks.flatMap((block) => block.drills)

  const details: SquashDetails = {
    availability: input.availability, technicalIntent: input.technicalIntent,
    selectionReason: selection.selectionNote ?? `Modalidad ${kind}; fase ${input.phase}; fatiga ${input.fatigueLevel}/10.${input.technicalIntent ? ` Objetivo: ${input.technicalIntent.family}.` : ''}`,
    trainingFocus: selection.trainingFocus,
    sessionMode: kind === 'match'
      ? (input.competitive ? 'competition_match' : 'practice_match')
      : 'drill_session',
    // La modalidad principal manda aunque haya un accesorio de sombras: el
    // accesorio complementa, no redefine lo que la sesión es.
    sessionKind: kind,
    drills,
    blocks: orderedBlocks,
  }

  const dose = doseSquashSession(details, input.durationMin)
  if (!dose.ok) warnings.push({ code: 'duration_infeasible', message: dose.message })
  else for (const message of dose.warnings) warnings.push({ code: 'accessory_dropped', message })
  return { subtype: projectSquashSubtype(kind, input.competitive), details: dose.ok ? dose.details : { ...details, drills: [], blocks: [] }, warnings, fallback }
}

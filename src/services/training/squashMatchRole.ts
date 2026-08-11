import type { SquashDetails, SquashDrill } from '../../types'
import { findSquashDrillByName } from './drillLibrary'

/**
 * Rol de una sesión de squash derivado de su CONTENIDO, nunca de `sessionMode`.
 *
 * `isSquashMatchDrill` no sirve para esto: devuelve true para todo
 * `category === 'match'`, y eso incluye `pre_match_activation_timing`, que es una
 * activación de taper de intensidad baja. Tratarla como partido proyectaría una
 * activación aislada a un best-of-5 completo, justo lo contrario de lo que esa
 * sesión debe ser a 48 h de competir. Por eso el contenido competitivo se define
 * por enumeración.
 */
export type SquashMatchRole = 'standalone' | 'finisher' | 'none'

export const SQUASH_STANDALONE_MATCH_ID = 'practice_match_five_games'

export const SQUASH_FINISHER_MATCH_IDS = [
  'practice_match_best_of_3',
  'match_sim_points_short_sets',
] as const

export type SquashFinisherMatchId = typeof SQUASH_FINISHER_MATCH_IDS[number]

const COMPETITIVE_MATCH_IDS: ReadonlySet<string> = new Set([
  SQUASH_STANDALONE_MATCH_ID,
  ...SQUASH_FINISHER_MATCH_IDS,
])

export function resolveSquashDrillIdentity(drill: Pick<SquashDrill, 'name'>): string {
  return findSquashDrillByName(drill.name)?.id ?? drill.name.trim().toLowerCase()
}

export function isCompetitiveMatchDrill(drill: Pick<SquashDrill, 'name'>): boolean {
  return COMPETITIVE_MATCH_IDS.has(findSquashDrillByName(drill.name)?.id ?? '')
}

export function isFinisherMatchDrill(drill: Pick<SquashDrill, 'name'>): boolean {
  const id = findSquashDrillByName(drill.name)?.id
  return id != null && (SQUASH_FINISHER_MATCH_IDS as readonly string[]).includes(id)
}

/** Invariante duro: `drills[]` es exactamente el flatten de `blocks` por ID y orden. */
export function blocksMatchDrills(details: SquashDetails): boolean {
  const flattened = (details.blocks ?? []).flatMap((block) => block.drills ?? [])
  const drills = details.drills ?? []
  if (flattened.length !== drills.length) return false
  return flattened.every((drill, index) =>
    resolveSquashDrillIdentity(drill) === resolveSquashDrillIdentity(drills[index]!))
}

export function resolveSquashMatchRole(details: SquashDetails | undefined): SquashMatchRole {
  if (!details) return 'none'

  const drills = details.drills ?? []
  const blocks = details.blocks ?? []
  if (blocks.length > 0 && !blocksMatchDrills(details)) return 'none'

  const competitive = drills.filter(isCompetitiveMatchDrill)
  if (competitive.length === 0) return 'none'

  // Un partido que es el único contenido de la sesión es un partido dedicado,
  // sea al mejor de 5 o al mejor de 3. Reconocer sólo el mejor de 5 hacía que un
  // mejor de 3 dedicado cayera en `finisher`: perdía la exención de densificación
  // de `getMinimumSquashDrillCount`, se le agregaban drills de acompañamiento y
  // recién entonces pasaba a ser una sesión mixta que nadie declaró así.
  // Sigue siendo un predicado puro de contenido: no mira fase ni calendario.
  if (drills.length === 1 && competitive.length === 1) return 'standalone'

  // Sin bloques no hay forma de demostrar que el partido es el último ni que
  // existe un bloque previo no-match.
  if (blocks.length < 2) return 'none'
  if (competitive.length !== 1) return 'none'

  const lastBlock = blocks[blocks.length - 1]!
  if (lastBlock.kind !== 'match') return 'none'
  if ((lastBlock.drills ?? []).length !== 1) return 'none'
  if (!isFinisherMatchDrill(lastBlock.drills[0]!)) return 'none'
  if (!blocks.slice(0, -1).some((block) => block.kind !== 'match')) return 'none'

  return 'finisher'
}

/**
 * Único predicado de exposición competitiva del proyecto, definido sobre
 * contenido. `utils/squash.ts` y `repairWeek.ts` lo envuelven; no lo
 * reimplementan.
 */
export function hasSquashCompetitiveExposureContent(
  details: SquashDetails | undefined,
): boolean {
  return resolveSquashMatchRole(details) !== 'none'
}

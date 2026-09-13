import type { SquashDetails, SquashDrill, SquashSessionBlock, SquashSessionBlockKind } from '../../types'
import { sessionBudget, SESSION_COMPOSITION_MINUTES, splitSeconds } from './sessionTimeBudget'

export type SquashDoseResult =
  | { ok: true; details: SquashDetails; warnings: string[] }
  | { ok: false; message: string }

const DOSE_MARKER = '\nDosis por tiempo: '
/** Tres minutos de práctica más pausas por drill; debajo de eso no hay drill viable. */
const MIN_DRILL_SEC = 180

/** durationMin includes the complete slot, including rests and the assigned
 * warmup/cooldown. Blocks and drills are two projections, never additive.
 * The timed instruction overrides catalog repetition examples explicitly.
 *
 * El bloque cuyo `kind` coincide con `sessionKind` recibe su dosis primero;
 * los accesorios entran sólo si queda al menos un drill viable, y si no caben
 * se retiran con advertencia. El accesorio cede antes que el objetivo.
 */
export function doseSquashSession(details: SquashDetails, durationMin: number): SquashDoseResult {
  const kind = resolveMainKind(details)
  const min = SESSION_COMPOSITION_MINUTES[kind]
  if (!Number.isFinite(durationMin) || durationMin < min || !details.drills.length) {
    return { ok: false, message: `No cabe una sesión de ${kind} en ${durationMin} min con contenido ejecutable; mínimo de composición ${min} min.` }
  }
  if (kind === 'match') {
    const drills = details.drills.map(drill => ({ ...drill,
      notes: `${(drill.notes ?? '').split(DOSE_MARKER)[0]}${DOSE_MARKER}Duración estimada por marcador; calentamiento y cierre incluidos en la reserva. El partido puede terminar antes o después.` }))
    return { ok: true, details: projectSingleBlock(details, kind, drills), warnings: [] }
  }

  const budget = sessionBudget(durationMin)
  const maxDrills = Math.max(1, Math.floor(budget.workSec / MIN_DRILL_SEC))
  const allocation = allocateDrillsByBlock(details, kind, maxDrills)
  const count = allocation.blocks.reduce((n, block) => n + block.drills.length, 0)
  const practice = splitSeconds(budget.workSec, count)

  let index = 0
  const blocks: SquashSessionBlock[] = allocation.blocks.map(block => {
    const drills = block.drills.map(drill => {
      const i = index++
      const warmup = i === 0 ? budget.warmupSec : 0
      const cooldown = i === count - 1 ? budget.cooldownSec : 0
      const roundWork = block.kind === 'shadows' ? 30 : 120
      const roundRest = 30
      const cycles = Math.floor(practice[i] / (roundWork + roundRest))
      const rest = Math.max(0, cycles * roundRest)
      const work = practice[i] - rest
      const parts = [
        warmup ? `Calentamiento progresivo ${warmup / 60} min` : '',
        `práctica ${work} s + pausas ${rest} s: alternar hasta ${roundWork} s de trabajo con ${roundRest} s suaves; terminar al cumplir el tiempo asignado`,
        cooldown ? `Enfriamiento suave ${cooldown / 60} min` : '',
      ].filter(Boolean)
      return { ...drill, durationMin: (practice[i] + warmup + cooldown) / 60,
        notes: `${(drill.notes ?? '').split(DOSE_MARKER)[0]}${DOSE_MARKER}${parts.join('; ')}. Todo incluido; las repeticiones del catálogo son referencias, no volumen adicional obligatorio.` }
    })
    return { ...block, drills, durationMin: drills.reduce((n, d) => n + (d.durationMin ?? 0), 0) }
  })
  const drills = blocks.flatMap(block => block.drills)
  return { ok: true, details: { ...details, drills, blocks }, warnings: allocation.warnings }
}

function resolveMainKind(details: SquashDetails): SquashSessionBlockKind {
  return details.sessionKind === 'mixed' ? 'technical' : details.sessionKind ?? 'technical'
}

/**
 * Reparte el cupo de drills por bloque: primero los bloques de la modalidad
 * principal, después los accesorios. Conserva el orden original de los
 * bloques en la salida (las sombras siguen yendo antes si el hidratador las
 * ordenó así), pero la RESERVA se decide por rol.
 */
function allocateDrillsByBlock(
  details: SquashDetails,
  mainKind: SquashSessionBlockKind,
  maxDrills: number,
): { blocks: Array<{ kind: SquashSessionBlockKind; drills: SquashDrill[] }>; warnings: string[] } {
  const source = details.blocks?.length
    ? details.blocks.map(block => ({ kind: block.kind, drills: block.drills }))
    : [{ kind: mainKind, drills: details.drills }]
  const hasMain = source.some(block => block.kind === mainKind)
  // Sin bloque principal declarado (contenido legacy con blocks de otra
  // modalidad), no hay accesorio que ceder: todo se trata como principal.
  const order = source
    .map((block, position) => ({ block, position, main: !hasMain || block.kind === mainKind }))
    .sort((a, b) => Number(b.main) - Number(a.main) || a.position - b.position)

  const warnings: string[] = []
  let remaining = maxDrills
  const chosen = order.map(({ block, position, main }) => {
    if (remaining <= 0) {
      if (!main) warnings.push(`Se retiró el bloque de ${block.kind}: no queda tiempo para un drill viable de ${MIN_DRILL_SEC / 60} min sin recortar el objetivo principal (${mainKind}).`)
      return { position, kind: block.kind, drills: [] as SquashDrill[] }
    }
    const drills = block.drills.slice(0, remaining)
    remaining -= drills.length
    if (!main && drills.length < block.drills.length) {
      warnings.push(`El bloque de ${block.kind} quedó recortado a ${drills.length} drill(s) para conservar el objetivo principal (${mainKind}).`)
    }
    return { position, kind: block.kind, drills }
  })

  return {
    blocks: chosen
      .filter(block => block.drills.length > 0)
      .sort((a, b) => a.position - b.position)
      .map(({ kind, drills }) => ({ kind, drills })),
    warnings,
  }
}

function projectSingleBlock(details: SquashDetails, kind: SquashSessionBlockKind, drills: SquashDrill[]): SquashDetails {
  const durationMin = drills.reduce((n, d) => n + (d.durationMin ?? 0), 0)
  return { ...details, drills, blocks: [{ kind, drills, durationMin }] }
}

import type { SquashDetails, SquashDrill, SquashSessionBlockKind } from '../../types'
import { sessionBudget, SESSION_COMPOSITION_MINUTES, splitSeconds } from './sessionTimeBudget'

export type SquashDoseResult = { ok: true; details: SquashDetails } | { ok: false; message: string }
const DOSE_MARKER = '\nDosis por tiempo: '

/** durationMin includes the complete slot, including rests and the assigned
 * warmup/cooldown. Blocks and drills are two projections, never additive.
 * The timed instruction overrides catalog repetition examples explicitly.
 */
export function doseSquashSession(details: SquashDetails, durationMin: number): SquashDoseResult {
  const kind = details.sessionKind === 'mixed' ? 'technical' : details.sessionKind ?? 'technical'
  const min = SESSION_COMPOSITION_MINUTES[kind]
  if (!Number.isFinite(durationMin) || durationMin < min || !details.drills.length) {
    return { ok: false, message: `No cabe una sesión de ${kind} en ${durationMin} min con contenido ejecutable; mínimo de composición ${min} min.` }
  }
  if (kind === 'match') {
    const drills = details.drills.map(drill => ({ ...drill,
      notes: `${(drill.notes ?? '').split(DOSE_MARKER)[0]}${DOSE_MARKER}Duración estimada por marcador; calentamiento y cierre incluidos en la reserva. El partido puede terminar antes o después.` }))
    return { ok: true, details: project(details, drills) }
  }
  const budget = sessionBudget(durationMin)
  // At least three minutes of practice/rest per chosen drill. Never create
  // tiny drills solely to satisfy an old minimum drill count.
  const count = Math.min(details.drills.length, Math.max(1, Math.floor(budget.workSec / 180)))
  const practice = splitSeconds(budget.workSec, count)
  const drills = details.drills.slice(0, count).map((drill, i) => {
    const warmup = i === 0 ? budget.warmupSec : 0
    const cooldown = i === count - 1 ? budget.cooldownSec : 0
    const roundWork = kind === 'shadows' ? 30 : 120
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
  return { ok: true, details: project(details, drills) }
}

function project(details: SquashDetails, drills: SquashDrill[]): SquashDetails {
  const blocks: NonNullable<SquashDetails['blocks']> = []
  let offset = 0
  for (const block of details.blocks ?? []) {
    const blockDrills = drills.slice(offset, offset + block.drills.length)
    offset += block.drills.length
    if (blockDrills.length) blocks.push({ ...block, drills: blockDrills,
      durationMin: blockDrills.reduce((n, d) => n + (d.durationMin ?? 0), 0) })
  }
  if (!blocks.length || offset < drills.length) {
    const kind: SquashSessionBlockKind = details.sessionKind === 'mixed' ? 'technical' : details.sessionKind ?? 'technical'
    return { ...details, drills, blocks: [{ kind, drills, durationMin: drills.reduce((n, d) => n + (d.durationMin ?? 0), 0) }] }
  }
  return { ...details, drills, blocks }
}

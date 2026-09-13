import type { RunningIntervalStructure } from '../../types'
import { sumTimedBlocks } from './sessionTimeBudget'
import { FILLER_BLOCK_LABEL, FILLER_BLOCK_LABEL_WALK } from './runningTemplateMaterializer'

type Block = RunningIntervalStructure['blocks'][number]

const EASY_ROLES = new Set(['warmup', 'cooldown', 'recovery', 'technique'])
/** El materializador rellena el remanente de tiempo con un bloque de relleno a
 * ritmo fácil, marcado igual que el trabajo real (`role: 'work'`) porque
 * cuenta para el presupuesto total. Sus dos únicos labels posibles son
 * constantes importadas —no literales duplicados— para que un futuro
 * renombre de copy rompa en compilación, no en silencio; excluirlos por
 * label —no por role— es lo único que separa relleno de trabajo real sin
 * asumir nada sobre la plantilla (continua, progresiva o de repeticiones). */
const FILLER_LABELS = new Set([FILLER_BLOCK_LABEL, FILLER_BLOCK_LABEL_WALK])
const isWorkBlock = (block: Block) => !EASY_ROLES.has(block.role ?? '') && !FILLER_LABELS.has(block.label)

function paceToSeconds(pace: string | undefined): number | undefined {
  if (!pace) return undefined
  const match = /^(\d{1,2}):(\d{2})/.exec(pace.trim())
  if (!match) return undefined
  return Number(match[1]) * 60 + Number(match[2])
}

function workRepetitions(structure: RunningIntervalStructure): number {
  return structure.blocks.filter(isWorkBlock).reduce((n, block) => n + (block.repetitions ?? 1), 0)
}

function workMinutes(structure: RunningIntervalStructure): number {
  const total = sumTimedBlocks(structure.blocks.filter(isWorkBlock)) ?? 0
  return Math.round(total / 60)
}

function workPaces(structure: RunningIntervalStructure): string[] {
  return [...new Set(structure.blocks.filter(isWorkBlock).map(block => block.targetPace).filter((p): p is string => Boolean(p)))]
}

/** Diferencias CONCRETAS de dosis entre dos estructuras; para el preview de recalculado. */
export function describeRunningDoseDiff(before: RunningIntervalStructure, after: RunningIntervalStructure): string[] {
  const lines: string[] = []
  const repsBefore = workRepetitions(before), repsAfter = workRepetitions(after)
  if (repsBefore !== repsAfter) lines.push(`repeticiones: ${repsBefore} → ${repsAfter}`)
  const minBefore = workMinutes(before), minAfter = workMinutes(after)
  if (minBefore !== minAfter) lines.push(`trabajo: ${minBefore} → ${minAfter} min`)
  const pacesBefore = workPaces(before).join(', '), pacesAfter = workPaces(after).join(', ')
  if (pacesBefore !== pacesAfter) lines.push(`ritmo de trabajo: ${pacesBefore || 'sin ritmo'} → ${pacesAfter || 'sin ritmo'}`)
  if (before.blocks.length !== after.blocks.length) lines.push(`bloques: ${before.blocks.length} → ${after.blocks.length}`)
  return lines.length > 0 ? lines : ['la dosis resultante es la misma']
}

/**
 * Los ritmos escritos a mano son instrucción explícita del usuario; se guardan,
 * pero tienen que describir la misma sesión que los bloques. Tolerancia: 15 s/km
 * a cada lado del rango de ritmos de trabajo de la estructura.
 */
export function validateManualPaceAgainstStructure(
  paceMin: string | undefined,
  paceMax: string | undefined,
  structure: RunningIntervalStructure | undefined,
): { ok: true } | { ok: false; message: string } {
  const manual = [paceToSeconds(paceMin), paceToSeconds(paceMax)].filter((v): v is number => v != null)
  if (manual.length === 0 || !structure) return { ok: true }
  const work = workPaces(structure).map(paceToSeconds).filter((v): v is number => v != null)
  if (work.length === 0) return { ok: true }
  const lo = Math.min(...work) - 15, hi = Math.max(...work) + 15
  const overlaps = Math.min(...manual) <= hi && Math.max(...manual) >= lo
  return overlaps
    ? { ok: true }
    : { ok: false, message: `Los ritmos que escribiste (${paceMin ?? '—'}–${paceMax ?? '—'}) no corresponden a los bloques de la receta (${workPaces(structure).join(', ')}). Ajusta los ritmos o recalcula la dosis.` }
}

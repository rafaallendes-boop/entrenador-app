import type { Session, SquashSessionKind } from '../../types'
import { resolveSquashSessionKind } from '../../utils/squash'
import type { DisciplineAcwr } from '../loadAnalytics'
import type { SquashSelectionDesiredKind, SquashSelectionPhase } from './drillSelector'

export interface SquashWeekPlanSlot {
  kind: SquashSelectionDesiredKind
  rationale: string
}

export interface SquashWeekPlan {
  slots: SquashWeekPlanSlot[]
}

export interface PlanSquashWeekInput {
  sessionSlots: number
  phase: SquashSelectionPhase
  daysToNextCompetition?: number
  recentKinds: SquashSessionKind[]
  fatigueLevel: number
  squashAcwr?: DisciplineAcwr
}

const PHASE_PATTERNS: Record<SquashSelectionPhase, Record<number, SquashSelectionDesiredKind[]>> = {
  base: {
    1: ['technical'],
    2: ['technical', 'shadows'],
    3: ['technical', 'shadows', 'control'],
    4: ['technical', 'shadows', 'control', 'technical'],
  },
  build: {
    1: ['technical'],
    2: ['technical', 'match'],
    3: ['technical', 'shadows', 'match'],
    4: ['technical', 'shadows', 'control', 'match'],
  },
  peak: {
    1: ['technical'],
    2: ['technical', 'match'],
    3: ['technical', 'match', 'control'],
    4: ['technical', 'shadows', 'match', 'control'],
  },
  taper: {
    1: ['control'],
    2: ['control', 'technical'],
    3: ['control', 'technical', 'control'],
    4: ['control', 'technical', 'control', 'match'],
  },
}

export function extractRecentSquashKinds(sessions: Session[], limit = 6): SquashSessionKind[] {
  return [...sessions]
    .filter((session): session is Session & { type: 'squash' } => session.type === 'squash')
    .sort((a, b) => b.date.localeCompare(a.date) || b.timeBlock.localeCompare(a.timeBlock))
    .map((session) => resolveSquashSessionKind(session))
    .filter((kind): kind is SquashSessionKind => Boolean(kind))
    .slice(0, limit)
}

export function planSquashWeek(input: PlanSquashWeekInput): SquashWeekPlan {
  const sessionSlots = Math.max(1, Math.min(4, input.sessionSlots || 1))
  const phasePattern = PHASE_PATTERNS[input.phase][sessionSlots] ?? PHASE_PATTERNS[input.phase][4]
  const slots = [...phasePattern]

  if ((input.daysToNextCompetition ?? 99) <= 3) {
    slots[slots.length - 1] = 'control'
  }

  if (input.squashAcwr?.status === 'risk' || input.fatigueLevel >= 8) {
    replaceFirstSlot(slots, 'match', 'control')
    replaceFirstSlot(slots, 'technical', 'shadows')
  } else if (input.fatigueLevel >= 6) {
    replaceFirstSlot(slots, 'match', 'control')
  }

  const repeatedKinds = getRepeatedKinds(input.recentKinds)
  for (const repeatedKind of repeatedKinds) {
    const index = slots.findIndex((slot) => slot === repeatedKind)
    if (index >= 0) {
      slots[index] = findReplacementKind(repeatedKind, slots, input.phase)
    }
  }

  const normalizedSlots = normalizeSlotCount(slots, sessionSlots)
  return {
    slots: normalizedSlots.map((kind, index) => ({
      kind,
      rationale: buildSlotRationale(kind, index, input),
    })),
  }
}

function normalizeSlotCount(slots: SquashSelectionDesiredKind[], count: number): SquashSelectionDesiredKind[] {
  if (slots.length === count) return slots
  if (slots.length > count) return slots.slice(0, count)

  const padded = [...slots]
  while (padded.length < count) {
    padded.splice(Math.max(0, padded.length - 1), 0, 'control')
  }
  return padded
}

function replaceFirstSlot(
  slots: SquashSelectionDesiredKind[],
  from: SquashSelectionDesiredKind,
  to: SquashSelectionDesiredKind,
) {
  const index = slots.findIndex((slot) => slot === from)
  if (index >= 0) slots[index] = to
}

function getRepeatedKinds(recentKinds: SquashSessionKind[]): SquashSessionKind[] {
  const repeated = new Set<SquashSessionKind>()

  for (let index = 0; index < recentKinds.length - 1; index += 1) {
    if (recentKinds[index] === recentKinds[index + 1]) {
      repeated.add(recentKinds[index]!)
    }
  }

  return [...repeated]
}

function findReplacementKind(
  repeatedKind: SquashSessionKind,
  slots: SquashSelectionDesiredKind[],
  phase: SquashSelectionPhase,
): SquashSelectionDesiredKind {
  const candidates: SquashSelectionDesiredKind[] =
    phase === 'taper'
      ? ['control', 'technical', 'shadows']
      : ['technical', 'control', 'shadows', 'match']

  return candidates.find((candidate) => candidate !== repeatedKind && !slots.includes(candidate)) ?? 'control'
}

function buildSlotRationale(
  kind: SquashSelectionDesiredKind,
  index: number,
  input: PlanSquashWeekInput,
): string {
  if ((input.daysToNextCompetition ?? 99) <= 3 && index === input.sessionSlots - 1) {
    return 'Último estímulo antes de competir: timing, touch y frescura por encima de carga.'
  }
  if (input.squashAcwr?.status === 'risk') {
    return 'ACWR squash en riesgo: priorizar estímulos sostenibles y bajar carga específica.'
  }
  if (input.fatigueLevel >= 7) {
    return 'Fatiga alta: sostener calidad sin apilar intensidad ni match-play.'
  }
  switch (kind) {
    case 'technical':
      return 'Bloque principal para calidad de golpe, orden y transferencia a la semana.'
    case 'control':
      return 'Sesión de precisión repetible y bajo costo de fatiga para consolidar timing.'
    case 'shadows':
      return 'Movimiento específico y vuelta a la T sin disfrazar la sesión como físico genérico.'
    case 'match':
      return 'Exposición a ritmo real y toma de decisiones; va al final de la progresión semanal.'
    case 'mixed-control-technical':
      return 'Mixto útil cuando faltan slots: primero calidad de golpe, luego volumen controlado.'
    case 'mixed-shadows-control':
      return 'Mixto corto para sumar pies + touch sin convertir la sesión en carga alta.'
    case 'mixed-shadows-technical':
      return 'Mixto para abrir con desplazamientos y terminar con técnica usable.'
  }
}

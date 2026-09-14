import type { AthleteProfile, DayLog, Session, TimeBlock } from '../../types'
import type { RequestScope } from '../athlete/requestScope'
import { fromISO, getWeekStart, toISO } from '../../utils/date'
import { isExecutedStatus } from './executedSessions'

/**
 * B2: captura inmutable por operación y contextos por slot. Todo resolver de
 * la Fase B consume `SlotContext`, nunca sesiones crudas.
 */

export interface ReferenceSlot {
  date: string
  timeBlock: TimeBlock
}

export interface SourceCapture {
  /** Identidad capturada. B no la lee; la revalidación de D la usa. */
  scope: Pick<RequestScope, 'athleteId' | 'epoch' | 'requestId'>
  /** Instante ISO de la captura: nada leído después entra. */
  knowledgeCutoff: string
  /** Fecha calendario local del corte (YYYY-MM-DD). Decide qué ya venció. */
  knowledgeDate: string
  profile: AthleteProfile | undefined
  /** `profile.updatedAt` al capturar. */
  profileRevision: number | undefined
  sessions: readonly Session[]
  dayLogs: readonly DayLog[]
}

export interface CaptureSourcesInput {
  scope: SourceCapture['scope']
  now: number
  profile: AthleteProfile | undefined
  sessions: readonly Session[]
  dayLogs: readonly DayLog[]
}

export interface ExposureWindow {
  /** Semanas contiguas a cada lado de la semana del slot. El tamaño definitivo lo fija C1 (spec §10). */
  neighborWeeks: 0 | 1 | 2
  /** Qué sesión de una semana vecina cuenta como carga relevante; lo decide el consumidor. */
  isHardNeighbor: (session: Session) => boolean
}

export const NO_NEIGHBOR_EXPOSURE: ExposureWindow = { neighborWeeks: 0, isHardNeighbor: () => false }

export interface SlotContext {
  scope: SourceCapture['scope']
  knowledgeCutoff: string
  knowledgeDate: string
  profile: AthleteProfile | undefined
  slot: ReferenceSlot
  targetSessionId?: string
  /** `completed`/`adjusted` estrictamente antes del slot, más reciente primero. Alimenta progresión. */
  progressionHistory: readonly Session[]
  /** Cualquier estado estrictamente antes del slot, más reciente primero. Alimenta adherencia y RPE. */
  signalHistory: readonly Session[]
  /** Semana del slot (y vecinos duros), cualquier estado, sin la sesión objetivo. Orden cronológico. */
  exposure: readonly Session[]
  /** Fecha ≤ slot.date, más reciente primero. */
  dayLogs: readonly DayLog[]
  legacySlotSessionIds: readonly string[]
}

const BLOCK_ORDER: Record<TimeBlock, number> = { AM: 0, PM: 1 }

export function shiftIsoDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function captureSources(input: CaptureSourcesInput): SourceCapture {
  // Registros de dominio clonables: no congelar objetos propiedad del store.
  const snapshot = structuredClone({
    profile: input.profile,
    sessions: lastById(input.sessions),
    dayLogs: lastById(input.dayLogs),
  })
  return deepFreeze({
    scope: { ...input.scope },
    knowledgeCutoff: new Date(input.now).toISOString(),
    knowledgeDate: toISO(new Date(input.now)),
    profile: snapshot.profile,
    profileRevision: snapshot.profile?.updatedAt,
    sessions: snapshot.sessions,
    dayLogs: snapshot.dayLogs,
  })
}

/** Sólo sobre la copia privada de objetos/arrays de dominio. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

export function normalizeSessionSlot(session: Pick<Session, 'date' | 'timeBlock'>): { slot: ReferenceSlot; legacySlot: boolean } {
  const known = session.timeBlock === 'AM' || session.timeBlock === 'PM'
  return { slot: { date: session.date, timeBlock: known ? session.timeBlock : 'AM' }, legacySlot: !known }
}

export function compareSlots(a: ReferenceSlot, b: ReferenceSlot): number {
  return a.date.localeCompare(b.date) || BLOCK_ORDER[a.timeBlock] - BLOCK_ORDER[b.timeBlock]
}

export function deriveSlotContext(
  capture: SourceCapture,
  slot: ReferenceSlot,
  options: { window?: ExposureWindow; targetSessionId?: string } = {},
): SlotContext {
  const window = options.window ?? NO_NEIGHBOR_EXPOSURE
  const weekStart = toISO(getWeekStart(fromISO(slot.date)))
  const weekEnd = shiftIsoDate(weekStart, 6)
  const outerStart = shiftIsoDate(weekStart, -7 * window.neighborWeeks)
  const outerEnd = shiftIsoDate(weekEnd, 7 * window.neighborWeeks)

  const before: Session[] = []
  const exposure: Session[] = []
  const legacy: string[] = []

  for (const session of capture.sessions) {
    const normalized = normalizeSessionSlot(session)
    if (normalized.legacySlot) legacy.push(session.id)
    if (options.targetSessionId != null && session.id === options.targetSessionId) continue
    if (compareSlots(normalized.slot, slot) < 0) before.push(session)
    const inWeek = session.date >= weekStart && session.date <= weekEnd
    const inNeighbor = !inWeek && session.date >= outerStart && session.date <= outerEnd && window.isHardNeighbor(session)
    if (inWeek || inNeighbor) exposure.push(session)
  }

  const signalHistory = [...before].sort(bySlotDesc)
  return {
    scope: capture.scope,
    knowledgeCutoff: capture.knowledgeCutoff,
    knowledgeDate: capture.knowledgeDate,
    profile: capture.profile,
    slot,
    ...(options.targetSessionId != null ? { targetSessionId: options.targetSessionId } : {}),
    progressionHistory: signalHistory.filter((session) => isExecutedStatus(session.status)),
    signalHistory,
    exposure: exposure.sort((a, b) => -bySlotDesc(a, b)),
    dayLogs: capture.dayLogs.filter((log) => log.date <= slot.date).sort((a, b) => b.date.localeCompare(a.date)),
    legacySlotSessionIds: legacy,
  }
}

function bySlotDesc(a: Session, b: Session): number {
  return compareSlots(normalizeSessionSlot(b).slot, normalizeSessionSlot(a).slot)
}

function lastById<T extends { id: string }>(rows: readonly T[]): T[] {
  const byId = new Map<string, T>()
  for (const row of rows) {
    byId.delete(row.id)
    byId.set(row.id, row)
  }
  return [...byId.values()]
}

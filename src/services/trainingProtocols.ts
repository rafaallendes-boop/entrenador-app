import type { DayLog, Session, SessionType, SquashSubtype, RunningType } from '../types'
import {
  buildCooldown,
  buildWarmup,
  normalizeGeneratedProtocol,
  resolveProtocolContext,
  resolveSessionProtocols,
  type ProtocolResolutionInputs,
} from './protocolEngine'

interface SessionProtocolContext {
  type: SessionType
  subtype?: SquashSubtype
  rpe?: number
  runningType?: RunningType
}

export type { ProtocolResolutionInputs } from './protocolEngine'
export { getProtocolSummary, normalizeGeneratedProtocol, resolveSessionProtocols } from './protocolEngine'

export function generateDefaultProtocols(
  context: SessionProtocolContext,
  inputs: ProtocolResolutionInputs = {},
): Pick<Session, 'warmup' | 'cooldown'> {
  const sessionLike = {
    date: inputs.dayLog?.date ?? new Date().toISOString().slice(0, 10),
    timeBlock: 'AM' as const,
    type: context.type,
    subtype: context.subtype,
    rpe: context.rpe,
    runningDetails: context.runningType ? { runningType: context.runningType } : undefined,
  }

  const warmupContext = resolveProtocolContext(sessionLike, 'warmup', inputs)
  const cooldownContext = resolveProtocolContext(sessionLike, 'cooldown', inputs)

  return {
    warmup: buildWarmup(warmupContext),
    cooldown: buildCooldown(cooldownContext),
  }
}

export function ensureSessionProtocols<T extends {
  date: string
  type: SessionType
  subtype?: SquashSubtype
  rpe?: number
  runningDetails?: { runningType?: RunningType }
  warmup?: unknown
  cooldown?: unknown
}>(
  session: T,
  inputs: ProtocolResolutionInputs = {},
): T {
  const existingWarmup = normalizeGeneratedProtocol(session.warmup, 'warmup')
  const existingCooldown = normalizeGeneratedProtocol(session.cooldown, 'cooldown')

  const resolved = resolveSessionProtocols(
    {
      ...session,
      id: 'protocol-preview',
      timeBlock: 'AM',
      status: 'planned',
      title: 'protocol-preview',
      durationMin: 0,
      createdAt: 0,
      updatedAt: 0,
    } as Session,
    inputs,
  )

  return {
    ...session,
    warmup: existingWarmup ?? resolved.warmup,
    cooldown: existingCooldown ?? resolved.cooldown,
  }
}

export function getDayLogProtocolInputs(dayLog?: DayLog, recentSessions?: Session[]): ProtocolResolutionInputs {
  return {
    dayLog,
    recentSessions,
  }
}

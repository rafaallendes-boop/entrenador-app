import { sessionBudget } from './training/sessionTimeBudget'
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
  runningDetails?: { runningType?: RunningType; intervalStructure?: import('../types').RunningIntervalStructure }
  squashDetails?: Session['squashDetails']
  durationMin?: number
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

  let warmup = existingWarmup ?? resolved.warmup
  let cooldown = existingCooldown ?? resolved.cooldown
  const timedRunning = session.runningDetails?.intervalStructure?.blocks
  const runningWarmup = timedRunning?.find(b => b.label === 'Calentamiento Z2' && b.notes?.includes('Incluido en el tiempo total'))
  const runningCooldown = timedRunning?.find(b => b.label === 'Enfriamiento Z2' && b.notes?.includes('Incluido en el tiempo total'))
  const timedSquash = session.squashDetails?.sessionKind !== 'match'
    && session.squashDetails?.drills.some(d => d.notes?.includes('Dosis por tiempo:'))
  const budget = timedSquash && session.durationMin ? sessionBudget(session.durationMin) : undefined
  // Protocol cards describe the SAME reserved minutes, not extra work.
  if (warmup && (runningWarmup?.durationMin || budget)) warmup = { ...warmup,
    durationMin: runningWarmup?.durationMin ?? budget!.warmupSec / 60,
    note: 'Incluido en la duración total de la sesión; no añadir estos minutos de nuevo.',
    steps: [{ label: 'Activación progresiva', detail: 'Comenzar suave y aumentar gradualmente dentro del tiempo reservado.' }],
  }
  if (cooldown && (runningCooldown?.durationMin || budget)) cooldown = { ...cooldown,
    durationMin: runningCooldown?.durationMin ?? budget!.cooldownSec / 60,
    note: 'Incluido en la duración total de la sesión; no añadir estos minutos de nuevo.',
    steps: [{ label: 'Vuelta a la calma', detail: 'Reducir gradualmente el esfuerzo dentro del tiempo reservado.' }],
  }
  return { ...session, warmup, cooldown }
}

export function getDayLogProtocolInputs(dayLog?: DayLog, recentSessions?: Session[]): ProtocolResolutionInputs {
  return {
    dayLog,
    recentSessions,
  }
}

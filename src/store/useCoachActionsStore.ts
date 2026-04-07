import { create } from 'zustand'
import type { CoachProposal, CoachAction } from '../types'
import { db } from '../db/db'
import { v4 as uuid } from '../utils/uuid'
import { useTrainingStore } from './useTrainingStore'
import { upsertWeekSummary } from '../db/queries'
import * as syncService from '../services/syncService'
import { toISO, fromISO, getWeekStart } from '../utils/date'
import { ensureSessionProtocols, generateDefaultProtocols } from '../services/trainingProtocols'
import { useCoachMemoryStore } from './useCoachMemoryStore'
import { buildPlanGenerationSummary } from '../services/planGenerationSummary'
import { filterCoachSessionsToAllowedSports, isSessionTypeAllowedForPlan, sanitizeCoachActionsForPlan } from '../services/planningConstraints'

interface ApplyCoachActionResult {
  warnings: string[]
}

interface AcceptProposalResult {
  errors: string[]
  warnings: string[]
}

interface CoachActionsState {
  proposals: CoachProposal[]

  loadProposals: () => Promise<void>
  addProposal: (message: string, actions: CoachAction[], chatMessageId?: string) => Promise<CoachProposal>
  acceptProposal: (id: string) => Promise<AcceptProposalResult>
  rejectProposal: (id: string) => Promise<void>
  getPendingProposals: () => CoachProposal[]
}

export const useCoachActionsStore = create<CoachActionsState>((set, get) => ({
  proposals: [],

  loadProposals: async () => {
    const proposals = await db.coachProposals.orderBy('createdAt').toArray()
    set({ proposals })
  },

  addProposal: async (message, actions, chatMessageId) => {
    const athleteProfile = useCoachMemoryStore.getState().athleteProfile
    const sanitized = sanitizeCoachActionsForPlan(actions, athleteProfile)
    const historicalSessions = await db.sessions.toArray()
    const planSummary = buildPlanGenerationSummary({
      athleteProfile,
      actions: sanitized.actions,
      historicalSessions,
    })
    const proposal: CoachProposal = {
      id: uuid(),
      chatMessageId,
      message,
      actions: sanitized.actions,
      planSummary,
      status: 'pending',
      createdAt: Date.now(),
    }
    await db.coachProposals.put(proposal)
    void syncService.pushCoachProposal(proposal)
    set(state => ({ proposals: [...state.proposals, proposal] }))
    return proposal
  },

  rejectProposal: async (id) => {
    const proposal = get().proposals.find(p => p.id === id)
    if (!proposal) return

    const nextProposal = { ...proposal, status: 'rejected' as const, resolvedAt: Date.now() }
    await db.coachProposals.put(nextProposal)
    void syncService.pushCoachProposal(nextProposal)
    set(state => ({
      proposals: state.proposals.map(p => (p.id === id ? nextProposal : p)),
    }))
  },

  acceptProposal: async (id) => {
    const proposal = get().proposals.find(p => p.id === id)
    if (!proposal || proposal.status !== 'pending') {
      return { errors: [], warnings: [] }
    }

    const trainingStore = useTrainingStore.getState()
    const errors: string[] = []
    const warnings: string[] = []

    for (const action of proposal.actions) {
      try {
        const result = await applyCoachAction(action, trainingStore)
        warnings.push(...result.warnings)
      } catch (e) {
        errors.push(`${action.type}: ${e}`)
      }
    }

    const nextProposal: CoachProposal = {
      ...proposal,
      status: errors.length === 0 ? 'accepted' : 'partial',
      resolvedAt: Date.now(),
    }

    await db.coachProposals.put(nextProposal)
    void syncService.pushCoachProposal(nextProposal)
    set(state => ({
      proposals: state.proposals.map(p =>
        p.id === id ? nextProposal : p
      ),
    }))

    if (errors.length > 0) {
      console.warn('Some coach actions failed:', errors)
    }

    return { errors, warnings }
  },

  getPendingProposals: () => get().proposals.filter(p => p.status === 'pending'),
}))

// ─── Action executor ──────────────────────────────────────────────────────────

async function applyCoachAction(
  action: CoachAction,
  store: ReturnType<typeof useTrainingStore.getState>
): Promise<ApplyCoachActionResult> {
  const warnings: string[] = []
  const athleteProfile = useCoachMemoryStore.getState().athleteProfile

  switch (action.type) {
    case 'skip_session': {
      if (!action.sessionId) throw new Error('sessionId required')
      await store.updateSession(resolveSessionId(action.sessionId, store), { status: 'skipped' })
      break
    }

    case 'change_rpe': {
      if (!action.sessionId || action.newRpe == null) throw new Error('sessionId + newRpe required')
      await store.updateSession(resolveSessionId(action.sessionId, store), { rpe: action.newRpe })
      break
    }

    case 'shorten_session': {
      if (!action.sessionId || action.newDurationMin == null) throw new Error('sessionId + newDurationMin required')
      await store.updateSession(resolveSessionId(action.sessionId, store), { durationMin: action.newDurationMin })
      break
    }

    case 'lengthen_session': {
      if (!action.sessionId || action.newDurationMin == null) throw new Error('sessionId + newDurationMin required')
      await store.updateSession(resolveSessionId(action.sessionId, store), { durationMin: action.newDurationMin })
      break
    }

    case 'move_session': {
      if (!action.sessionId || !action.targetDate) throw new Error('sessionId + targetDate required')
      await store.updateSession(resolveSessionId(action.sessionId, store), { date: action.targetDate })
      break
    }

    case 'replace_session_type': {
      if (!action.sessionId || !action.newType) throw new Error('sessionId + newType required')
      if (!isSessionTypeAllowedForPlan(action.newType, athleteProfile)) {
        warnings.push(`Se filtró replace_session_type a ${action.newType} por no estar permitido en la planificación actual.`)
        break
      }
      const id = resolveSessionId(action.sessionId, store)
      await store.updateSession(id, buildSessionTypePatch(action.newType))
      break
    }

    case 'insert_recovery': {
      if (!action.targetDate) throw new Error('targetDate required')
      await store.addSession(ensureSessionProtocols({
        date: action.targetDate,
        timeBlock: 'PM',
        source: 'coach',
        type: 'recovery',
        status: 'planned',
        title: 'Recuperación activa (coach)',
        durationMin: 30,
        objective: action.reason,
      }))
      break
    }

    case 'add_session': {
      if (!action.targetDate || !action.sessionType || !action.title || !action.durationMin || !action.timeBlock) {
        throw new Error('add_session requires targetDate, sessionType, title, durationMin, timeBlock')
      }
      if (!isSessionTypeAllowedForPlan(action.sessionType, athleteProfile)) {
        warnings.push(`Se filtró add_session de ${action.sessionType} por no estar permitido en la planificación actual.`)
        break
      }
      await store.addSession(ensureSessionProtocols({
        date: action.targetDate,
        timeBlock: action.timeBlock,
        source: 'coach',
        type: action.sessionType,
        subtype: action.subtype,
        title: action.title,
        durationMin: action.durationMin,
        rpe: action.rpe ?? action.newRpe,
        objective: action.objective,
        status: 'planned',
        exercises: action.exercises?.map(ex => ({ ...ex, id: uuid(), completed: false })),
        runningDetails: action.runningType
          ? {
              runningType: action.runningType,
              targetPaceMin: action.targetPaceMin,
              targetPaceMax: action.targetPaceMax,
              targetHrMin: action.targetHrMin,
              targetHrMax: action.targetHrMax,
            }
          : undefined,
        squashDetails: action.squashDetails,
        warmup: action.warmup,
        cooldown: action.cooldown,
      }))
      break
    }

    case 'create_week': {
      if (!action.sessions || action.sessions.length === 0) {
        throw new Error('create_week requires sessions array')
      }
      const allowedSessions = filterCoachSessionsToAllowedSports(action.sessions, athleteProfile)
      if (allowedSessions.length !== action.sessions.length) {
        warnings.push('Se filtraron sesiones de deportes no permitidos antes de guardar la semana.')
      }
      if (allowedSessions.length === 0) {
        warnings.push('No se guardó ninguna sesión porque todas pertenecían a deportes no permitidos para esta planificación.')
        break
      }
      const collisions = await findCreateWeekCollisions(allowedSessions)
      if (collisions.length > 0) {
        warnings.push(
          `Colisiones detectadas: ${collisions.map(c => `${c.date} ${c.timeBlock}`).join(', ')}`
        )
      }
      for (const s of allowedSessions) {
        await store.addSession(ensureSessionProtocols({
          date: s.date,
          timeBlock: s.timeBlock,
          source: 'coach',
          type: s.sessionType,
          subtype: s.subtype,
          title: s.title,
          durationMin: s.durationMin,
          rpe: s.rpe,
          objective: s.objective,
          status: 'planned',
          exercises: s.exercises?.map(ex => ({ ...ex, id: uuid(), completed: false })),
          runningDetails: s.runningType ? {
            runningType: s.runningType,
            targetPaceMin: s.targetPaceMin,
            targetPaceMax: s.targetPaceMax,
            targetHrMin: s.targetHrMin,
            targetHrMax: s.targetHrMax,
          } : undefined,
          squashDetails: s.squashDetails,
          warmup: s.warmup,
          cooldown: s.cooldown,
        }))
      }
      // Set week objectives if provided
      if (action.weekObjectives && action.weekObjectives.length > 0) {
        const weekStart = toISO(getWeekStart(fromISO(allowedSessions[0].date)))
        await upsertWeekSummary(weekStart, { objectives: action.weekObjectives })
        // Reload week to pick up objectives in store
        await store.loadWeek(weekStart)
      }
      break
    }

    case 'delete_session': {
      if (!action.sessionId) throw new Error('sessionId required')
      await store.deleteSession(resolveSessionId(action.sessionId, store))
      break
    }

    case 'update_session': {
      if (!action.sessionId) throw new Error('sessionId required')
      const id = resolveSessionId(action.sessionId, store)
      const current = store.sessions.find((session) => session.id === id)
      if (!current) throw new Error(`sessionId no encontrado: ${action.sessionId}`)

      const nextType = action.newType ?? current.type
      if (!isSessionTypeAllowedForPlan(nextType, athleteProfile)) {
        warnings.push(`Se filtró update_session a ${nextType} por no estar permitido en la planificación actual.`)
        break
      }
      const patch: Record<string, unknown> = buildSessionTypePatch(nextType)
      if (action.newTitle != null) patch.title = action.newTitle
      if (action.newObjective != null) patch.objective = action.newObjective
      if (action.newRpe != null) patch.rpe = action.newRpe
      if (action.newDurationMin != null) patch.durationMin = action.newDurationMin
      if (action.newType != null) patch.type = action.newType
      if (nextType === 'squash') {
        patch.subtype = action.subtype ?? current.subtype
        patch.squashDetails = action.squashDetails ?? current.squashDetails
      }
      if (nextType === 'running' || nextType === 'cycling') {
        patch.runningDetails = action.runningType || action.targetPaceMin || action.targetPaceMax || action.targetHrMin != null || action.targetHrMax != null
          ? {
              runningType: action.runningType ?? current.runningDetails?.runningType ?? 'z2',
              targetPaceMin: action.targetPaceMin ?? current.runningDetails?.targetPaceMin,
              targetPaceMax: action.targetPaceMax ?? current.runningDetails?.targetPaceMax,
              targetHrMin: action.targetHrMin ?? current.runningDetails?.targetHrMin,
              targetHrMax: action.targetHrMax ?? current.runningDetails?.targetHrMax,
            }
          : current.runningDetails
      }
      if (Array.isArray(action.exercises)) {
        patch.exercises = action.exercises.map(ex => ({ ...ex, id: uuid(), completed: false }))
      } else if (nextType === 'strength' || nextType === 'mobility') {
        patch.exercises = current.exercises
      }
      const resolvedRunningType =
        nextType === 'running' || nextType === 'cycling'
          ? action.runningType ?? current.runningDetails?.runningType
          : undefined
      const defaults = generateDefaultProtocols({
        type: nextType,
        subtype: nextType === 'squash' ? ((patch.subtype as typeof current.subtype) ?? current.subtype) : undefined,
        rpe: (patch.rpe as number | undefined) ?? current.rpe,
        runningType: resolvedRunningType,
      })
      patch.warmup = action.warmup ?? current.warmup ?? defaults.warmup
      patch.cooldown = action.cooldown ?? current.cooldown ?? defaults.cooldown
      await store.updateSession(id, patch)
      break
    }

    default:
      throw new Error(`Unknown action type: ${(action as CoachAction).type}`)
  }

  return { warnings }
}

function buildSessionTypePatch(type: CoachAction['newType']): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (type) patch.type = type

  switch (type) {
    case 'squash':
      patch.exercises = undefined
      patch.runningDetails = undefined
      break
    case 'running':
    case 'cycling':
      patch.exercises = undefined
      patch.squashDetails = undefined
      patch.subtype = undefined
      break
    case 'strength':
    case 'mobility':
      patch.runningDetails = undefined
      patch.squashDetails = undefined
      patch.subtype = undefined
      break
    case 'recovery':
    case 'nutrition':
      patch.exercises = undefined
      patch.runningDetails = undefined
      patch.squashDetails = undefined
      patch.subtype = undefined
      break
  }

  return patch
}

function resolveSessionId(
  sessionIdOrPrefix: string,
  store: ReturnType<typeof useTrainingStore.getState>
): string {
  const exact = store.sessions.find(session => session.id === sessionIdOrPrefix)
  if (exact) return exact.id

  const matches = store.sessions.filter(session => session.id.startsWith(sessionIdOrPrefix))
  if (matches.length === 1) return matches[0].id
  if (matches.length > 1) {
    throw new Error(`sessionId prefix ambiguo: ${sessionIdOrPrefix}`)
  }
  throw new Error(`sessionId no encontrado: ${sessionIdOrPrefix}`)
}

// ─── Helper to parse coach proposals from AI response text ───────────────────
// Future: the Claude API response can include structured actions in a JSON block.
// This parser will extract them and call addProposal automatically.

export function parseProposalFromText(text: string): CoachAction[] {
  // TODO: parse ```json blocks from coach response
  // For now returns empty — actions will be manually constructed in Phase 2
  void text
  return []
}

async function findCreateWeekCollisions(
  sessions: NonNullable<CoachAction['sessions']>
): Promise<Array<{ date: string; timeBlock: string }>> {
  const targetDates = [...new Set(sessions.map(session => session.date))]
  const existingSessions = await db.sessions.where('date').anyOf(targetDates).toArray()

  return sessions
    .filter(session =>
      existingSessions.some(existing =>
        existing.date === session.date && existing.timeBlock === session.timeBlock
      )
    )
    .map(session => ({ date: session.date, timeBlock: session.timeBlock }))
}

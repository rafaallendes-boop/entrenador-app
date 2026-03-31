import { create } from 'zustand'
import type { CoachProposal, CoachAction } from '../types'
import { v4 as uuid } from '../utils/uuid'
import { useTrainingStore } from './useTrainingStore'
import { upsertWeekSummary } from '../db/queries'
import { toISO, fromISO, getWeekStart } from '../utils/date'

// ─── DB extension needed in future migration — for now proposals are in-memory
// In a future db.ts v4 migration, add: coachProposals: 'id, status, createdAt'

interface CoachActionsState {
  proposals: CoachProposal[]

  addProposal: (message: string, actions: CoachAction[], chatMessageId?: string) => CoachProposal
  acceptProposal: (id: string) => Promise<void>
  rejectProposal: (id: string) => void
  getPendingProposals: () => CoachProposal[]
}

export const useCoachActionsStore = create<CoachActionsState>((set, get) => ({
  proposals: [],

  addProposal: (message, actions, chatMessageId) => {
    const proposal: CoachProposal = {
      id: uuid(),
      chatMessageId,
      message,
      actions,
      status: 'pending',
      createdAt: Date.now(),
    }
    set(state => ({ proposals: [...state.proposals, proposal] }))
    return proposal
  },

  rejectProposal: (id) => {
    set(state => ({
      proposals: state.proposals.map(p =>
        p.id === id ? { ...p, status: 'rejected', resolvedAt: Date.now() } : p
      ),
    }))
  },

  acceptProposal: async (id) => {
    const proposal = get().proposals.find(p => p.id === id)
    if (!proposal || proposal.status !== 'pending') return

    const trainingStore = useTrainingStore.getState()
    const errors: string[] = []

    for (const action of proposal.actions) {
      try {
        await applyCoachAction(action, trainingStore)
      } catch (e) {
        errors.push(`${action.type}: ${e}`)
      }
    }

    set(state => ({
      proposals: state.proposals.map(p =>
        p.id === id
          ? {
              ...p,
              status: errors.length === 0 ? 'accepted' : 'partial',
              resolvedAt: Date.now(),
            }
          : p
      ),
    }))

    if (errors.length > 0) {
      console.warn('Some coach actions failed:', errors)
    }
  },

  getPendingProposals: () => get().proposals.filter(p => p.status === 'pending'),
}))

// ─── Action executor ──────────────────────────────────────────────────────────

async function applyCoachAction(
  action: CoachAction,
  store: ReturnType<typeof useTrainingStore.getState>
): Promise<void> {
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
      await store.updateSession(resolveSessionId(action.sessionId, store), { type: action.newType })
      break
    }

    case 'insert_recovery': {
      if (!action.targetDate) throw new Error('targetDate required')
      await store.addSession({
        date: action.targetDate,
        timeBlock: 'PM',
        type: 'recovery',
        status: 'planned',
        title: 'Recuperación activa (coach)',
        durationMin: 30,
        objective: action.reason,
      })
      break
    }

    case 'add_session': {
      if (!action.targetDate || !action.sessionType || !action.title || !action.durationMin || !action.timeBlock) {
        throw new Error('add_session requires targetDate, sessionType, title, durationMin, timeBlock')
      }
      await store.addSession({
        date: action.targetDate,
        timeBlock: action.timeBlock,
        type: action.sessionType,
        subtype: action.subtype,
        title: action.title,
        durationMin: action.durationMin,
        rpe: action.newRpe,
        objective: action.objective,
        status: 'planned',
        exercises: action.exercises?.map(ex => ({ ...ex, id: uuid(), completed: false })),
        runningDetails: action.runningType
          ? { runningType: action.runningType }
          : undefined,
      })
      break
    }

    case 'create_week': {
      if (!action.sessions || action.sessions.length === 0) {
        throw new Error('create_week requires sessions array')
      }
      for (const s of action.sessions) {
        await store.addSession({
          date: s.date,
          timeBlock: s.timeBlock,
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
        })
      }
      // Set week objectives if provided
      if (action.weekObjectives && action.weekObjectives.length > 0) {
        const weekStart = toISO(getWeekStart(fromISO(action.sessions[0].date)))
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
      const patch: Record<string, unknown> = {}
      if (action.newTitle != null) patch.title = action.newTitle
      if (action.newObjective != null) patch.objective = action.newObjective
      if (action.newRpe != null) patch.rpe = action.newRpe
      if (action.newDurationMin != null) patch.durationMin = action.newDurationMin
      if (Array.isArray(action.exercises)) {
        patch.exercises = action.exercises.map(ex => ({ ...ex, id: uuid(), completed: false }))
      }
      await store.updateSession(id, patch)
      break
    }

    default:
      throw new Error(`Unknown action type: ${(action as CoachAction).type}`)
  }
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

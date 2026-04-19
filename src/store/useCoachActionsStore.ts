import { create } from 'zustand'
import type { AthleteProfile, CoachAction, CoachProposal, CoachProposalSource, Session, WeekSummary } from '../types'
import { db } from '../db/db'
import { recalculateWeekSummary } from '../db/queries'
import { buildPlanGenerationSummary } from '../services/planGenerationSummary'
import { isSessionTypeAllowedForPlan, sanitizeCoachActionsForPlan } from '../services/planningConstraints'
import { applyCreateWeek } from '../services/planning/applyCreateWeek'
import { normalizeCoachProposal } from '../services/coachProposalMetadata'
import * as syncService from '../services/syncService'
import { ensureSessionProtocols, generateDefaultProtocols } from '../services/trainingProtocols'
import { v4 as uuid } from '../utils/uuid'
import { useCoachMemoryStore } from './useCoachMemoryStore'
import { useTrainingStore } from './useTrainingStore'

interface ApplyCoachActionResult {
  warnings: string[]
  createdSessionIds: string[]
  restoredSessions: Session[]
  restoredWeekSummaries: WeekSummary[]
  deletedWeekSummaryIds: string[]
}

interface AcceptProposalResult {
  errors: string[]
  warnings: string[]
}

interface CoachActionsState {
  proposals: CoachProposal[]
  loadProposals: () => Promise<void>
  addProposal: (
    message: string,
    actions: CoachAction[],
    chatMessageId?: string,
    options?: { source?: CoachProposalSource; relatedAlertId?: string },
  ) => Promise<CoachProposal>
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

  addProposal: async (message, actions, chatMessageId, options) => {
    const athleteProfile = useCoachMemoryStore.getState().athleteProfile
    const sanitized = sanitizeCoachActionsForPlan(actions, athleteProfile)
    const normalized = normalizeCoachProposal(sanitized.actions, {
      source: options?.source ?? 'chat',
      relatedAlertId: options?.relatedAlertId,
      existingSessions: useTrainingStore.getState().sessions,
      proposalMessage: message,
    })
    const historicalSessions = await db.sessions.toArray()
    const planSummary = buildPlanGenerationSummary({
      athleteProfile,
      actions: normalized.actions,
      historicalSessions,
    })
    const proposal: CoachProposal = {
      id: uuid(),
      chatMessageId,
      message,
      actions: normalized.actions,
      planSummary,
      metadata: normalized.metadata,
      status: 'pending',
      createdAt: Date.now(),
    }
    await db.coachProposals.put(proposal)
    void syncService.pushCoachProposal(proposal)
    set((state) => ({ proposals: [...state.proposals, proposal] }))
    return proposal
  },

  rejectProposal: async (id) => {
    const proposal = get().proposals.find((item) => item.id === id)
    if (!proposal) return

    const nextProposal = {
      ...proposal,
      status: 'rejected' as const,
      resolvedAt: Date.now(),
      metadata: proposal.metadata
        ? { ...proposal.metadata, resolutionOutcome: 'rejected' as const }
        : proposal.metadata,
    }
    await db.coachProposals.put(nextProposal)
    void syncService.pushCoachProposal(nextProposal)
    set((state) => ({
      proposals: state.proposals.map((item) => (item.id === id ? nextProposal : item)),
    }))
  },

  acceptProposal: async (id) => {
    const proposal = get().proposals.find((item) => item.id === id)
    if (!proposal || proposal.status !== 'pending') {
      return { errors: [], warnings: [] }
    }

    const trainingStore = useTrainingStore.getState()
    const athleteProfile = useCoachMemoryStore.getState().athleteProfile
    const errors: string[] = []
    const warnings: string[] = []
    const normalized = normalizeCoachProposal(proposal.actions, {
      source: proposal.metadata?.source ?? 'chat',
      relatedAlertId: proposal.metadata?.relatedAlertId,
      existingSessions: trainingStore.sessions,
      proposalMessage: proposal.message,
    })
    const workingProposal: CoachProposal = {
      ...proposal,
      actions: normalized.actions,
      metadata: {
        ...normalized.metadata,
        resolutionOutcome: proposal.metadata?.resolutionOutcome ?? 'pending',
      },
    }

    const validationErrors = preValidateActions(workingProposal.actions, trainingStore, athleteProfile)
    if (validationErrors.length > 0) {
      const nextProposal: CoachProposal = {
        ...workingProposal,
        status: 'rejected',
        resolvedAt: Date.now(),
        metadata: workingProposal.metadata
          ? { ...workingProposal.metadata, resolutionOutcome: 'rejected' }
          : workingProposal.metadata,
      }
      await db.coachProposals.put(nextProposal)
      void syncService.pushCoachProposal(nextProposal)
      set((state) => ({
        proposals: state.proposals.map((item) => (item.id === id ? nextProposal : item)),
      }))
      return { errors: validationErrors, warnings: [] }
    }

    const appliedResults: Array<{ index: number; createdSessionIds: string[]; restoredSessions: Session[]; restoredWeekSummaries: WeekSummary[]; deletedWeekSummaryIds: string[] }> = []
    for (let i = 0; i < workingProposal.actions.length; i++) {
      try {
        const result = await applyCoachAction(workingProposal.actions[i], trainingStore)
        warnings.push(...result.warnings)
        appliedResults.push({
          index: i,
          createdSessionIds: result.createdSessionIds,
          restoredSessions: result.restoredSessions,
          restoredWeekSummaries: result.restoredWeekSummaries,
          deletedWeekSummaryIds: result.deletedWeekSummaryIds,
        })
      } catch (error) {
        errors.push(`Accion ${i + 1} (${workingProposal.actions[i].type}): ${error}`)
      }
    }

    if (errors.length > 0 && appliedResults.length > 0) {
      await rollbackAppliedActions(workingProposal.actions, appliedResults, trainingStore)
      warnings.push(`Se revirtieron ${appliedResults.length} acciones aplicadas antes del fallo.`)
    }

    const nextProposal: CoachProposal = {
      ...workingProposal,
      status: errors.length === 0 ? 'accepted' : 'rejected',
      resolvedAt: Date.now(),
      metadata: workingProposal.metadata
        ? {
            ...workingProposal.metadata,
            resolutionOutcome: errors.length === 0 ? 'accepted' : 'rejected',
          }
        : workingProposal.metadata,
    }

    await db.coachProposals.put(nextProposal)
    void syncService.pushCoachProposal(nextProposal)
    set((state) => ({
      proposals: state.proposals.map((item) => (item.id === id ? nextProposal : item)),
    }))

    if (errors.length > 0) {
      console.warn('Coach proposal rejected - all actions rolled back:', errors)
    }

    return { errors, warnings }
  },

  getPendingProposals: () => get().proposals.filter((proposal) => proposal.status === 'pending'),
}))

function preValidateActions(
  actions: CoachAction[],
  store: ReturnType<typeof useTrainingStore.getState>,
  athleteProfile: AthleteProfile | null,
): string[] {
  const errors: string[] = []

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]
    const label = `Accion ${i + 1} (${action.type})`

    switch (action.type) {
      case 'skip_session':
      case 'change_rpe':
      case 'shorten_session':
      case 'lengthen_session':
      case 'move_session':
      case 'delete_session':
        if (!action.sessionId) {
          errors.push(`${label}: sessionId requerido`)
        } else {
          try {
            resolveSessionId(action.sessionId, store)
          } catch {
            errors.push(`${label}: sesion no encontrada (${action.sessionId})`)
          }
        }
        if (action.type === 'change_rpe' && action.newRpe == null) errors.push(`${label}: newRpe requerido`)
        if ((action.type === 'shorten_session' || action.type === 'lengthen_session') && action.newDurationMin == null) {
          errors.push(`${label}: newDurationMin requerido`)
        }
        if (action.type === 'move_session' && !action.targetDate) errors.push(`${label}: targetDate requerido`)
        break

      case 'replace_session_type':
        if (!action.sessionId || !action.newType) {
          errors.push(`${label}: sessionId + newType requeridos`)
        } else {
          try {
            resolveSessionId(action.sessionId, store)
          } catch {
            errors.push(`${label}: sesion no encontrada (${action.sessionId})`)
          }
          if (!isSessionTypeAllowedForPlan(action.newType, athleteProfile)) {
            errors.push(`${label}: tipo ${action.newType} no permitido en planificacion actual`)
          }
        }
        break

      case 'insert_recovery':
        if (!action.targetDate) errors.push(`${label}: targetDate requerido`)
        break

      case 'add_session':
        if (!action.targetDate || !action.sessionType || !action.title || !action.durationMin || !action.timeBlock) {
          errors.push(`${label}: campos requeridos faltantes (targetDate, sessionType, title, durationMin, timeBlock)`)
        } else if (!isSessionTypeAllowedForPlan(action.sessionType, athleteProfile)) {
          errors.push(`${label}: tipo ${action.sessionType} no permitido en planificacion actual`)
        } else if (action.sessionType === 'squash' && !action.squashDetails) {
          errors.push(`${label}: squashDetails requerido para sesiones de squash`)
        } else if (action.sessionType === 'cycling' && !action.cyclingDetails) {
          errors.push(`${label}: cyclingDetails requerido para sesiones de ciclismo`)
        } else if (action.sessionType === 'mobility' && !action.mobilityDetails) {
          errors.push(`${label}: mobilityDetails requerido para sesiones de movilidad`)
        }
        break

      case 'create_week':
        if (!action.sessions || action.sessions.length === 0) {
          errors.push(`${label}: sessions array requerido`)
        } else {
          action.sessions.forEach((session, sessionIndex) => {
            if (session.sessionType === 'squash' && !session.squashDetails) {
              errors.push(`${label}: sesion ${sessionIndex + 1} requiere squashDetails`)
            }
            if (session.sessionType === 'cycling' && !session.cyclingDetails) {
              errors.push(`${label}: sesion ${sessionIndex + 1} requiere cyclingDetails`)
            }
            if (session.sessionType === 'mobility' && !session.mobilityDetails) {
              errors.push(`${label}: sesion ${sessionIndex + 1} requiere mobilityDetails`)
            }
          })
        }
        break

      case 'update_session':
        if (!action.sessionId) {
          errors.push(`${label}: sessionId requerido`)
        } else {
          try {
            resolveSessionId(action.sessionId, store)
          } catch {
            errors.push(`${label}: sesion no encontrada (${action.sessionId})`)
          }
          const nextType = action.newType ?? store.sessions.find((session) => session.id === action.sessionId)?.type
          if (nextType && !isSessionTypeAllowedForPlan(nextType, athleteProfile)) {
            errors.push(`${label}: tipo ${nextType} no permitido en planificacion actual`)
          }
          if (nextType === 'cycling' && !action.cyclingDetails) {
            errors.push(`${label}: cyclingDetails requerido para update_session de ciclismo`)
          }
          if (nextType === 'mobility' && !action.mobilityDetails) {
            errors.push(`${label}: mobilityDetails requerido para update_session de movilidad`)
          }
          if (nextType === 'squash' && !action.squashDetails && !store.sessions.find((session) => session.id === action.sessionId)?.squashDetails) {
            errors.push(`${label}: squashDetails requerido para update_session de squash`)
          }
        }
        break
    }
  }

  return errors
}

async function rollbackAppliedActions(
  actions: CoachAction[],
  appliedResults: Array<{ index: number; createdSessionIds: string[]; restoredSessions: Session[]; restoredWeekSummaries: WeekSummary[]; deletedWeekSummaryIds: string[] }>,
  store: ReturnType<typeof useTrainingStore.getState>,
): Promise<void> {
  const affectedDates = new Set<string>()

  for (const result of [...appliedResults].reverse()) {
    const action = actions[result.index]
    try {
      if (result.createdSessionIds.length > 0) {
        for (const sessionId of result.createdSessionIds) {
          const current = await db.sessions.get(sessionId)
          if (!current) continue
          affectedDates.add(current.date)
          await db.sessions.delete(sessionId)
          void syncService.deleteSession(sessionId)
        }
      }

      if (result.restoredSessions.length > 0) {
        for (const snapshot of result.restoredSessions) {
          const current = await db.sessions.get(snapshot.id)
          if (current) {
            affectedDates.add(current.date)
          }
          affectedDates.add(snapshot.date)
          await db.sessions.put(snapshot)
          void syncService.pushSession(snapshot)
        }
      }

      if (result.restoredWeekSummaries.length > 0) {
        for (const summary of result.restoredWeekSummaries) {
          await db.weekSummaries.put(summary)
          void syncService.pushWeekSummary(summary)
        }
      }

      if (result.deletedWeekSummaryIds.length > 0) {
        await db.weekSummaries.bulkDelete(result.deletedWeekSummaryIds)
      }

      if (result.restoredSessions.length > 0 || result.restoredWeekSummaries.length > 0 || result.deletedWeekSummaryIds.length > 0) {
        continue
      }

      console.warn(`Rollback: no se puede revertir automaticamente ${action.type} - accion ${result.index + 1}`)
    } catch (error) {
      console.error(`Rollback failed for action ${result.index + 1} (${action.type}):`, error)
    }
  }

  for (const date of affectedDates) {
    await recalculateWeekSummary(date)
  }

  const activeWeekStart = useTrainingStore.getState().loadedWeekStart
  if (activeWeekStart) {
    await store.loadWeek(activeWeekStart)
  }
  await store.loadAllSummaries()
}

async function applyCoachAction(
  action: CoachAction,
  store: ReturnType<typeof useTrainingStore.getState>,
): Promise<ApplyCoachActionResult> {
  const warnings: string[] = []
  const createdSessionIds: string[] = []
  const restoredSessions: Session[] = []
  const restoredWeekSummaries: WeekSummary[] = []
  const deletedWeekSummaryIds: string[] = []
  const athleteProfile = useCoachMemoryStore.getState().athleteProfile

  switch (action.type) {
    case 'skip_session': {
      if (!action.sessionId) throw new Error('sessionId required')
      const id = resolveSessionId(action.sessionId, store)
      restoredSessions.push(await getSessionSnapshot(id, store))
      await store.updateSession(id, { status: 'skipped' })
      break
    }

    case 'change_rpe': {
      if (!action.sessionId || action.newRpe == null) throw new Error('sessionId + newRpe required')
      const id = resolveSessionId(action.sessionId, store)
      restoredSessions.push(await getSessionSnapshot(id, store))
      await store.updateSession(id, { rpe: action.newRpe })
      break
    }

    case 'shorten_session': {
      if (!action.sessionId || action.newDurationMin == null) throw new Error('sessionId + newDurationMin required')
      const id = resolveSessionId(action.sessionId, store)
      restoredSessions.push(await getSessionSnapshot(id, store))
      await store.updateSession(id, { durationMin: action.newDurationMin })
      break
    }

    case 'lengthen_session': {
      if (!action.sessionId || action.newDurationMin == null) throw new Error('sessionId + newDurationMin required')
      const id = resolveSessionId(action.sessionId, store)
      restoredSessions.push(await getSessionSnapshot(id, store))
      await store.updateSession(id, { durationMin: action.newDurationMin })
      break
    }

    case 'move_session': {
      if (!action.sessionId || !action.targetDate) throw new Error('sessionId + targetDate required')
      const id = resolveSessionId(action.sessionId, store)
      restoredSessions.push(await getSessionSnapshot(id, store))
      await store.updateSession(id, { date: action.targetDate })
      break
    }

    case 'replace_session_type': {
      if (!action.sessionId || !action.newType) throw new Error('sessionId + newType required')
      if (!isSessionTypeAllowedForPlan(action.newType, athleteProfile)) {
        warnings.push(`Se filtro replace_session_type a ${action.newType} por no estar permitido en la planificacion actual.`)
        break
      }
      const id = resolveSessionId(action.sessionId, store)
      restoredSessions.push(await getSessionSnapshot(id, store))
      await store.updateSession(id, buildSessionTypePatch(action.newType))
      break
    }

    case 'insert_recovery': {
      if (!action.targetDate) throw new Error('targetDate required')
      const created = await store.addSession(ensureSessionProtocols({
        date: action.targetDate,
        timeBlock: 'PM',
        source: 'coach',
        type: 'recovery',
        status: 'planned',
        title: 'Recuperacion activa (coach)',
        durationMin: 30,
        objective: action.reason,
      }))
      createdSessionIds.push(created.id)
      break
    }

    case 'add_session': {
      if (!action.targetDate || !action.sessionType || !action.title || !action.durationMin || !action.timeBlock) {
        throw new Error('add_session requires targetDate, sessionType, title, durationMin, timeBlock')
      }
      if (!isSessionTypeAllowedForPlan(action.sessionType, athleteProfile)) {
        warnings.push(`Se filtro add_session de ${action.sessionType} por no estar permitido en la planificacion actual.`)
        break
      }
      const created = await store.addSession(ensureSessionProtocols({
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
        exercises: action.exercises?.map((exercise) => ({ ...exercise, id: uuid(), completed: false })),
        runningDetails: action.runningType
          ? {
              runningType: action.runningType,
              targetPaceMin: action.targetPaceMin,
              targetPaceMax: action.targetPaceMax,
              targetHrMin: action.targetHrMin,
              targetHrMax: action.targetHrMax,
              intervalStructure: action.intervalStructure,
            }
          : undefined,
        cyclingDetails: action.sessionType === 'cycling' ? action.cyclingDetails : undefined,
        mobilityDetails: action.sessionType === 'mobility' ? action.mobilityDetails : undefined,
        squashDetails: action.squashDetails,
        warmup: action.warmup,
        cooldown: action.cooldown,
      }))
      createdSessionIds.push(created.id)
      break
    }

    case 'create_week': {
      if (!action.sessions || action.sessions.length === 0) {
        throw new Error('create_week requires sessions array')
      }
      const result = await applyCreateWeek({
        sessions: action.sessions,
        weekObjectives: action.weekObjectives,
        athleteProfile,
        store,
      })
      warnings.push(...result.warnings)
      createdSessionIds.push(...result.createdSessionIds)
      restoredSessions.push(...result.restoredSessions)
      restoredWeekSummaries.push(...result.restoredWeekSummaries)
      deletedWeekSummaryIds.push(...result.deletedWeekSummaryIds)
      break
    }

    case 'delete_session': {
      if (!action.sessionId) throw new Error('sessionId required')
      const id = resolveSessionId(action.sessionId, store)
      restoredSessions.push(await getSessionSnapshot(id, store))
      await store.deleteSession(id)
      break
    }

    case 'update_session': {
      if (!action.sessionId) throw new Error('sessionId required')
      const id = resolveSessionId(action.sessionId, store)
      const current = store.sessions.find((session) => session.id === id)
      if (!current) throw new Error(`sessionId no encontrado: ${action.sessionId}`)
      restoredSessions.push({ ...current })

      const nextType = action.newType ?? current.type
      if (!isSessionTypeAllowedForPlan(nextType, athleteProfile)) {
        warnings.push(`Se filtro update_session a ${nextType} por no estar permitido en la planificacion actual.`)
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
        patch.runningDetails = action.runningType || action.targetPaceMin || action.targetPaceMax || action.targetHrMin != null || action.targetHrMax != null || action.intervalStructure != null
          ? {
              runningType: action.runningType ?? current.runningDetails?.runningType ?? 'z2',
              targetPaceMin: action.targetPaceMin ?? current.runningDetails?.targetPaceMin,
              targetPaceMax: action.targetPaceMax ?? current.runningDetails?.targetPaceMax,
              targetHrMin: action.targetHrMin ?? current.runningDetails?.targetHrMin,
              targetHrMax: action.targetHrMax ?? current.runningDetails?.targetHrMax,
              intervalStructure: action.intervalStructure ?? current.runningDetails?.intervalStructure,
            }
          : current.runningDetails
        patch.cyclingDetails = nextType === 'cycling'
          ? action.cyclingDetails ?? current.cyclingDetails
          : undefined
      }
      if (Array.isArray(action.exercises)) {
        patch.exercises = action.exercises.map((exercise) => ({ ...exercise, id: uuid(), completed: false }))
      } else if (nextType === 'strength' || nextType === 'mobility') {
        patch.exercises = current.exercises
      }
      if (nextType === 'mobility') {
        patch.mobilityDetails = action.mobilityDetails ?? current.mobilityDetails
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

  return { warnings, createdSessionIds, restoredSessions, restoredWeekSummaries, deletedWeekSummaryIds }
}

function buildSessionTypePatch(type: CoachAction['newType']): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (type) patch.type = type

  switch (type) {
    case 'squash':
      patch.exercises = undefined
      patch.runningDetails = undefined
      patch.cyclingDetails = undefined
      patch.mobilityDetails = undefined
      patch.subtype = 'training'
      patch.squashDetails = {
        trainingFocus: 'technical',
        sessionMode: 'drill_session',
        drills: [],
      }
      break
    case 'running':
    case 'cycling':
      patch.exercises = undefined
      patch.mobilityDetails = undefined
      patch.squashDetails = undefined
      patch.subtype = undefined
      if (type !== 'cycling') patch.cyclingDetails = undefined
      break
    case 'strength':
    case 'mobility':
      patch.runningDetails = undefined
      patch.cyclingDetails = undefined
      patch.squashDetails = undefined
      patch.subtype = undefined
      if (type !== 'mobility') patch.mobilityDetails = undefined
      break
    case 'recovery':
    case 'nutrition':
      patch.exercises = undefined
      patch.runningDetails = undefined
      patch.cyclingDetails = undefined
      patch.mobilityDetails = undefined
      patch.squashDetails = undefined
      patch.subtype = undefined
      break
  }

  return patch
}

function resolveSessionId(
  sessionIdOrPrefix: string,
  store: ReturnType<typeof useTrainingStore.getState>,
): string {
  const exact = store.sessions.find((session) => session.id === sessionIdOrPrefix)
  if (exact) return exact.id

  const matches = store.sessions.filter((session) => session.id.startsWith(sessionIdOrPrefix))
  if (matches.length === 1) return matches[0].id
  if (matches.length > 1) {
    throw new Error(`sessionId prefix ambiguo: ${sessionIdOrPrefix}`)
  }
  throw new Error(`sessionId no encontrado: ${sessionIdOrPrefix}`)
}

async function getSessionSnapshot(
  sessionId: string,
  store: ReturnType<typeof useTrainingStore.getState>,
): Promise<Session> {
  const visible = store.sessions.find((session) => session.id === sessionId)
  if (visible) return { ...visible }

  const persisted = await db.sessions.get(sessionId)
  if (!persisted) {
    throw new Error(`sessionId no encontrado: ${sessionId}`)
  }

  return { ...persisted }
}

export function parseProposalFromText(text: string): CoachAction[] {
  void text
  return []
}

import { todayISO } from '../utils/date'
import { getExecutedSessionsThrough } from '../services/training/executedSessions'
import { finalizeCoachActionDose } from '../services/training/coachActionDose'
import { create } from 'zustand'
import type { AthleteProfile, CoachAction, CoachProposal, CoachProposalSource, Session, WeekSummary } from '../types'
import { db } from '../db/db'
import { buildPlanGenerationSummary } from '../services/planGenerationSummary'
import { isSessionTypeAllowedForPlan, sanitizeCoachActionsForPlan } from '../services/planningConstraints'
import { applyCreateWeek } from '../services/planning/applyCreateWeek'
import { normalizeCoachProposal } from '../services/coachProposalMetadata'
import { getActiveAthleteId, getSelfAthleteId, getSwitchEpoch } from '../services/athlete/activeAthlete'
import { filterRowsToActiveScope, withActiveAthleteStamp } from '../services/athlete/activeScopeFilter'
import { isScopedAthleteId } from '../services/athlete/effectiveAthleteKey'
import * as syncService from '../services/syncService'
import { ensureSessionProtocols, generateDefaultProtocols } from '../services/trainingProtocols'
import { materializeProspectiveSession } from '../services/ai/actionPostProcessor'
import { prepareStrengthSession } from '../services/training/strengthSafetyFinalizer'
import { mergeStrengthConstraints } from '../services/training/strengthSafetyConstraints'
import {
  buildStrengthSafetyContext,
  resolveProfileStrengthSafetyConstraints,
} from '../services/training/strengthSafetySurface'
import { normalizeSport } from '../utils/athlete'
import { fromISO, getWeekStart, toISO } from '../utils/date'
import { v4 as uuid } from '../utils/uuid'
import { useCoachMemoryStore } from './useCoachMemoryStore'
import { useTrainingStore } from './useTrainingStore'
import { BLOCKED_STRENGTH_COPY } from '../services/training/strengthSafetyCopy'

// Promise cache: repeated accept calls for the same proposal share the same work.
const activeAcceptProposalPromises = new Map<string, Promise<AcceptProposalResult>>()
let latestProposalsLoadRequestId = 0
const ATHLETE_SWITCH_ABORT_MESSAGE =
  'Cambiaste de atleta mientras se aplicaba la propuesta. La propuesta quedó pendiente; revísala con el atleta correcto activo.'

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
    options?: { source?: CoachProposalSource; relatedAlertId?: string; warnings?: string[] },
  ) => Promise<CoachProposal>
  acceptProposal: (id: string) => Promise<AcceptProposalResult>
  rejectProposal: (id: string) => Promise<void>
  getPendingProposals: () => CoachProposal[]
  resetForAthleteSwitch: () => void
}

/**
 * Repone identidad y progreso sobre la salida del verificador de seguridad.
 *
 * `prepareStrengthSession` devuelve propuestas sin `id` ni `completed`, así que
 * asignarlos a ciegas convertía cualquier `update_session` sobre una sesión de
 * fuerza —incluido un cambio de título— en un borrado del progreso que el
 * atleta ya había registrado. Un ejercicio que sobrevive la verificación
 * conserva su fila; sólo lo que el finalizador agregó o reemplazó estrena
 * identidad. El emparejamiento consume cada fila previa una sola vez para que
 * dos ejercicios homónimos no compartan `id`.
 */
export function preserveStrengthExerciseIdentity(
  verified: ReadonlyArray<Record<string, unknown>>,
  current: ReadonlyArray<{ id: string; name: string; completed: boolean }>,
): Array<Record<string, unknown>> {
  const available = new Map<string, Array<{ id: string; completed: boolean }>>()
  for (const exercise of current) {
    const key = normalizeExerciseMatchKey(exercise.name)
    const bucket = available.get(key)
    if (bucket) bucket.push({ id: exercise.id, completed: exercise.completed })
    else available.set(key, [{ id: exercise.id, completed: exercise.completed }])
  }
  return verified.map((exercise) => {
    const key = normalizeExerciseMatchKey(String(exercise.name ?? ''))
    const previous = available.get(key)?.shift()
    return previous
      ? { ...exercise, id: previous.id, completed: previous.completed }
      : { ...exercise, id: uuid(), completed: false }
  })
}

function normalizeExerciseMatchKey(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
}

export const useCoachActionsStore = create<CoachActionsState>((set, get) => ({
  proposals: [],

  loadProposals: async () => {
    const requestId = ++latestProposalsLoadRequestId
    const athleteProfile = useCoachMemoryStore.getState().athleteProfile
    const proposals = filterRowsToActiveScope(await db.coachProposals.orderBy('createdAt').toArray())
      .map((proposal) => ({
        ...proposal,
        actions: prepareProposalActionsForDisplay(proposal.actions, athleteProfile),
      }))
    if (requestId !== latestProposalsLoadRequestId) return
    set({ proposals })
  },

  resetForAthleteSwitch: () => {
    latestProposalsLoadRequestId += 1
    activeAcceptProposalPromises.clear()
    set({ proposals: [] })
  },

  addProposal: async (message, actions, chatMessageId, options) => {
    const athleteProfile = useCoachMemoryStore.getState().athleteProfile
    const sanitized = sanitizeCoachActionsForPlan(actions, athleteProfile)
    const displayReadyActions = prepareProposalActionsForDisplay(sanitized.actions, athleteProfile)
    const normalized = normalizeCoachProposal(displayReadyActions, {
      source: options?.source ?? 'chat',
      relatedAlertId: options?.relatedAlertId,
      existingSessions: useTrainingStore.getState().sessions,
      proposalMessage: message,
    })
    const historicalSessions = getExecutedSessionsThrough(filterRowsToActiveScope(await db.sessions.toArray()), todayISO())
    const planSummary = buildPlanGenerationSummary({
      athleteProfile,
      actions: normalized.actions,
      historicalSessions,
    })
    const metadata = normalized.metadata
      ? { ...normalized.metadata, warnings: options?.warnings }
      : normalized.metadata
    const proposal: CoachProposal = withActiveAthleteStamp<CoachProposal>({
      id: uuid(),
      chatMessageId,
      message,
      actions: normalized.actions,
      planSummary,
      metadata,
      status: 'pending',
      createdAt: Date.now(),
    })
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
    const active = activeAcceptProposalPromises.get(id)
    if (active) return active

    const promise = (async (): Promise<AcceptProposalResult> => {
      const switchEpochAtStart = getSwitchEpoch()
      const activeAthleteIdAtStart = getActiveAthleteId()
      const hasAthleteSwitchChanged = () => getSwitchEpoch() !== switchEpochAtStart
      const proposal = await db.coachProposals.get(id) ?? get().proposals.find((item) => item.id === id)
      if (!proposal || proposal.status !== 'pending') {
        return { errors: [], warnings: [] }
      }

      const trainingStore = useTrainingStore.getState()
      const persistedSessions = filterRowsToActiveScope(await db.sessions.toArray())
      if (hasAthleteSwitchChanged()) {
        return { errors: [ATHLETE_SWITCH_ABORT_MESSAGE], warnings: [] }
      }
      const sessionsById = new Map(
        [...trainingStore.sessions, ...persistedSessions].map((session) => [session.id, session]),
      )
      // The calendar store intentionally exposes only its loaded week. Proposal
      // actions may target an adjacent week, so ID resolution must use the
      // athlete's persisted sessions while retaining the live store methods.
      const actionResolutionStore = {
        ...trainingStore,
        sessions: [...sessionsById.values()],
      }
      const athleteProfile = useCoachMemoryStore.getState().athleteProfile
      const errors: string[] = []
      const warnings: string[] = []
      const addSwitchAbortError = () => {
        if (!errors.includes(ATHLETE_SWITCH_ABORT_MESSAGE)) {
          errors.push(ATHLETE_SWITCH_ABORT_MESSAGE)
        }
      }
      if (hasAthleteSwitchChanged()) {
        addSwitchAbortError()
        return { errors, warnings }
      }
      const normalized = normalizeCoachProposal(proposal.actions, {
        source: proposal.metadata?.source ?? 'chat',
        relatedAlertId: proposal.metadata?.relatedAlertId,
        existingSessions: actionResolutionStore.sessions,
        proposalMessage: proposal.message,
      })
      const workingProposal: CoachProposal = {
        ...proposal,
        actions: normalized.actions,
        metadata: {
          ...normalized.metadata,
          warnings: proposal.metadata?.warnings,
          resolutionOutcome: proposal.metadata?.resolutionOutcome ?? 'pending',
        },
      }

      const validationErrors = preValidateActions(workingProposal.actions, actionResolutionStore, athleteProfile)
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
        if (hasAthleteSwitchChanged()) {
          addSwitchAbortError()
          break
        }
        try {
          const weekSummarySnapshots = await captureWeekSummaryRollbackSnapshots(
            workingProposal.actions[i],
            actionResolutionStore,
            activeAthleteIdAtStart,
          )
          const result = await applyCoachAction(workingProposal.actions[i], actionResolutionStore, workingProposal.createdAt)
          await appendWeekSummaryRollbackEntries(result, weekSummarySnapshots, activeAthleteIdAtStart)
          warnings.push(...result.warnings)
          appliedResults.push({
            index: i,
            createdSessionIds: result.createdSessionIds,
            restoredSessions: result.restoredSessions,
            restoredWeekSummaries: result.restoredWeekSummaries,
            deletedWeekSummaryIds: result.deletedWeekSummaryIds,
          })
          if (hasAthleteSwitchChanged()) {
            addSwitchAbortError()
            break
          }
        } catch (error) {
          errors.push(`Accion ${i + 1} (${workingProposal.actions[i].type}): ${error}`)
          if (hasAthleteSwitchChanged()) {
            addSwitchAbortError()
            break
          }
        }
      }

      if (hasAthleteSwitchChanged()) {
        addSwitchAbortError()
      }

      if (errors.length > 0 && appliedResults.length > 0) {
        await rollbackAppliedActions(workingProposal.actions, appliedResults, actionResolutionStore, {
          refreshStore: !hasAthleteSwitchChanged(),
        })
        warnings.push(`Se revirtieron ${appliedResults.length} acciones aplicadas antes del fallo.`)
      }

      if (hasAthleteSwitchChanged()) {
        return { errors, warnings }
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
    })()

    activeAcceptProposalPromises.set(id, promise)
    try {
      return await promise
    } finally {
      if (activeAcceptProposalPromises.get(id) === promise) {
        activeAcceptProposalPromises.delete(id)
      }
    }
  },

  getPendingProposals: () => get().proposals.filter((proposal) => proposal.status === 'pending'),
}))

function prepareProposalActionsForDisplay(actions: CoachAction[], athleteProfile: AthleteProfile | null): CoachAction[] {
  const profileConstraints = resolveProfileStrengthSafetyConstraints(athleteProfile)
  return actions.flatMap((action): CoachAction[] => {
    if ((action.type === 'add_session' || action.type === 'update_session') && action.exercises) {
      const durationMin = action.type === 'add_session' ? action.durationMin : action.newDurationMin
      const sessionType = normalizeSport((action.type === 'add_session' ? action.sessionType : action.newType) ?? '')
      if (sessionType !== 'strength' && !action.strengthSafetyFinalization) return [action]
      const messageConstraints = action.strengthSafetyFinalization?.userMessageConstraints ?? []
      const constraints = mergeStrengthConstraints(profileConstraints, messageConstraints)
      const input = {
        ...action,
        durationMin,
      }
      const result = prepareStrengthSession(input, {
        constraints,
        userMessageConstraints: messageConstraints,
        userMessage: '',
        selectionContext: buildStrengthSafetyContext(
          athleteProfile,
          durationMin,
          action.type === 'add_session' ? action.objective : action.newObjective,
          constraints,
        ),
        structureOptions: {
          durationMin,
          strengthProfile: athleteProfile?.strengthProfile,
        },
        supersetMode: 'off',
        sealLocation: 'root',
      })
      if (result.status === 'blocked') return []
      return [{
        ...action,
        ...(action.type === 'add_session' ? { sessionType: 'strength' as const } : {}),
        exercises: result.session.exercises,
        strengthSafetyFinalization: (
          result.session as typeof input & Pick<CoachAction, 'strengthSafetyFinalization'>
        ).strengthSafetyFinalization,
      }]
    }

    if (action.type === 'create_week' && action.sessions) {
      const prepared: NonNullable<CoachAction['sessions']> = []
      for (const session of action.sessions) {
        if (normalizeSport(session.sessionType) !== 'strength') {
          prepared.push(stripSquashInternalDurations(session))
          continue
        }
        const messageConstraints = session.metadata?.strengthSafetyFinalization?.userMessageConstraints ?? []
        const constraints = mergeStrengthConstraints(profileConstraints, messageConstraints)
        const result = prepareStrengthSession({ ...session, sessionType: 'strength' as const }, {
          constraints,
          userMessageConstraints: messageConstraints,
          userMessage: '',
          selectionContext: buildStrengthSafetyContext(
            athleteProfile,
            session.durationMin,
            session.objective,
            constraints,
          ),
          structureOptions: {
            durationMin: session.durationMin,
            strengthProfile: athleteProfile?.strengthProfile,
          },
          supersetMode: 'off',
          sealLocation: 'metadata',
        })
        if (result.status === 'blocked') return []
        prepared.push(stripSquashInternalDurations(result.session))
      }
      return [{ ...action, sessions: prepared }]
    }

    if ((action.type === 'add_session' || action.type === 'update_session') && action.squashDetails) {
      return [stripSquashInternalDurations(action)]
    }

    return [action]
  })
}

function stripSquashInternalDurations<T extends { squashDetails?: CoachAction['squashDetails'] }>(item: T): T {
  if (!item.squashDetails) return item
  return {
    ...item,
    squashDetails: {
      ...item.squashDetails,
      drills: item.squashDetails.drills?.map((drill) => {
        const next = { ...drill }
        delete next.durationMin
        return next
      }),
      blocks: item.squashDetails.blocks?.map((block) => {
        const nextBlock = { ...block }
        delete nextBlock.durationMin
        return {
          ...nextBlock,
          drills: block.drills.map((drill) => {
            const next = { ...drill }
            delete next.durationMin
            return next
          }),
        }
      }),
    },
  }
}

function preValidateActions(
  actions: CoachAction[],
  store: ReturnType<typeof useTrainingStore.getState>,
  athleteProfile: AthleteProfile | null,
): string[] {
  const errors: string[] = []
  const occupiedSessionsBySlot = new Map(
    store.sessions
      .filter((session) => session.status !== 'skipped')
      .map((session) => [`${session.date}|${session.timeBlock}`, session]),
  )
  const proposedAddSessionSlots = new Set<string>()

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

      case 'add_session': {
        let addSessionIsValid = true
        if (!action.targetDate || !action.sessionType || !action.title || !action.durationMin || !action.timeBlock) {
          errors.push(`${label}: campos requeridos faltantes (targetDate, sessionType, title, durationMin, timeBlock)`)
          addSessionIsValid = false
        } else if (!isSessionTypeAllowedForPlan(action.sessionType, athleteProfile)) {
          errors.push(`${label}: tipo ${action.sessionType} no permitido en planificacion actual`)
          addSessionIsValid = false
        } else if (action.sessionType === 'squash' && !action.squashDetails) {
          errors.push(`${label}: squashDetails requerido para sesiones de squash`)
          addSessionIsValid = false
        } else if (action.sessionType === 'cycling' && !action.cyclingDetails) {
          errors.push(`${label}: cyclingDetails requerido para sesiones de ciclismo`)
          addSessionIsValid = false
        } else if (action.sessionType === 'mobility' && !action.mobilityDetails) {
          errors.push(`${label}: mobilityDetails requerido para sesiones de movilidad`)
          addSessionIsValid = false
        }
        if (addSessionIsValid && action.targetDate && action.timeBlock) {
          const slotKey = `${action.targetDate}|${action.timeBlock}`
          const occupiedSession = occupiedSessionsBySlot.get(slotKey)
          if (occupiedSession) {
            errors.push(`${label}: bloque ${action.targetDate} ${action.timeBlock} ya ocupado por "${occupiedSession.title}"; usa update_session, move_session o libera el bloque antes de agregar otra sesión`)
          } else if (proposedAddSessionSlots.has(slotKey)) {
            errors.push(`${label}: bloque ${action.targetDate} ${action.timeBlock} duplicado dentro de la propuesta`)
          } else {
            proposedAddSessionSlots.add(slotKey)
          }
        }
        break
      }

      case 'create_week':
        if (!action.sessions || action.sessions.length === 0) {
          errors.push(`${label}: sessions array requerido`)
        } else {
          action.sessions.forEach((session, sessionIndex) => {
            if (!isSessionTypeAllowedForPlan(session.sessionType, athleteProfile)) {
              errors.push(`${label}: sesion ${sessionIndex + 1} usa tipo ${session.sessionType} no permitido en planificacion actual`)
            }
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
  options: { refreshStore: boolean } = { refreshStore: true },
): Promise<void> {
  for (const result of [...appliedResults].reverse()) {
    const action = actions[result.index]
    try {
      if (result.createdSessionIds.length > 0) {
        for (const sessionId of result.createdSessionIds) {
          const current = await db.sessions.get(sessionId)
          if (!current) continue
          await db.sessions.delete(sessionId)
          void syncService.deleteSession(sessionId)
        }
      }

      if (result.restoredSessions.length > 0) {
        for (const snapshot of result.restoredSessions) {
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
        void syncService.deleteWeekSummaries(result.deletedWeekSummaryIds)
      }

      if (result.restoredSessions.length > 0 || result.restoredWeekSummaries.length > 0 || result.deletedWeekSummaryIds.length > 0) {
        continue
      }

      console.warn(`Rollback: no se puede revertir automaticamente ${action.type} - accion ${result.index + 1}`)
    } catch (error) {
      console.error(`Rollback failed for action ${result.index + 1} (${action.type}):`, error)
    }
  }

  if (!options.refreshStore) return
  const activeWeekStart = useTrainingStore.getState().loadedWeekStart
  if (activeWeekStart) {
    await store.loadWeek(activeWeekStart)
  }
  await store.loadAllSummaries()
}

function getWeekStartDate(dateISO: string): string {
  return toISO(getWeekStart(fromISO(dateISO)))
}

function pushUniqueDate(dates: string[], date: string | null | undefined): void {
  if (date && !dates.includes(date)) dates.push(date)
}

function getActionAffectedDates(
  action: CoachAction,
  store: ReturnType<typeof useTrainingStore.getState>,
): string[] {
  const dates: string[] = []

  switch (action.type) {
    case 'insert_recovery':
    case 'add_session':
      pushUniqueDate(dates, action.targetDate)
      break

    case 'create_week':
      action.sessions?.forEach((session) => pushUniqueDate(dates, session.date))
      break

    case 'move_session': {
      if (action.sessionId) {
        try {
          const id = resolveSessionId(action.sessionId, store)
          const current = store.sessions.find((session) => session.id === id)
          pushUniqueDate(dates, current?.date)
        } catch {
          // Validation handles the actionable error; rollback snapshots stay best-effort.
        }
      }
      pushUniqueDate(dates, action.targetDate)
      break
    }

    case 'skip_session':
    case 'change_rpe':
    case 'shorten_session':
    case 'lengthen_session':
    case 'replace_session_type':
    case 'delete_session':
    case 'update_session':
      if (action.sessionId) {
        try {
          const id = resolveSessionId(action.sessionId, store)
          const current = store.sessions.find((session) => session.id === id)
          pushUniqueDate(dates, current?.date)
        } catch {
          // Validation handles the actionable error; rollback snapshots stay best-effort.
        }
      }
      break
  }

  return dates
}

async function getWeekSummaryForAthleteScope(
  weekStartDate: string,
  athleteId: string | null,
): Promise<WeekSummary | undefined> {
  if (athleteId) {
    const scoped = await db.weekSummaries
      .where('[athleteId+weekStartDate]')
      .equals([athleteId, weekStartDate])
      .first()
    if (scoped) return scoped

    if (athleteId !== getSelfAthleteId()) return undefined
    const candidates = await db.weekSummaries.where('weekStartDate').equals(weekStartDate).toArray()
    return candidates.find((summary) => !isScopedAthleteId(summary.athleteId))
  }

  const candidates = await db.weekSummaries.where('weekStartDate').equals(weekStartDate).toArray()
  const legacy = candidates.find((summary) => !isScopedAthleteId(summary.athleteId))
  return legacy ?? (candidates.length === 1 ? candidates[0] : undefined)
}

async function captureWeekSummaryRollbackSnapshots(
  action: CoachAction,
  store: ReturnType<typeof useTrainingStore.getState>,
  athleteId: string | null,
): Promise<Array<{ weekStartDate: string; before: WeekSummary | null }>> {
  const weekStarts = [...new Set(getActionAffectedDates(action, store).map(getWeekStartDate))]
  const snapshots: Array<{ weekStartDate: string; before: WeekSummary | null }> = []

  for (const weekStartDate of weekStarts) {
    const before = await getWeekSummaryForAthleteScope(weekStartDate, athleteId)
    snapshots.push({ weekStartDate, before: before ? { ...before } : null })
  }

  return snapshots
}

async function appendWeekSummaryRollbackEntries(
  result: ApplyCoachActionResult,
  snapshots: Array<{ weekStartDate: string; before: WeekSummary | null }>,
  athleteId: string | null,
): Promise<void> {
  for (const snapshot of snapshots) {
    if (snapshot.before) {
      if (!result.restoredWeekSummaries.some((summary) => summary.id === snapshot.before?.id)) {
        result.restoredWeekSummaries.push(snapshot.before)
      }
      continue
    }

    const created = await getWeekSummaryForAthleteScope(snapshot.weekStartDate, athleteId)
    if (created && !result.deletedWeekSummaryIds.includes(created.id)) {
      result.deletedWeekSummaryIds.push(created.id)
    }
  }
}

async function applyCoachAction(
  action: CoachAction,
  store: ReturnType<typeof useTrainingStore.getState>,
  proposalCreatedAt?: number,
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

    case 'shorten_session':
    case 'lengthen_session': {
      if (!action.sessionId || action.newDurationMin == null) throw new Error('sessionId + newDurationMin required')
      const id = resolveSessionId(action.sessionId, store)
      const current = await getSessionSnapshot(id, store)
      const dose = finalizeCoachActionDose({ ...action, sessionId: id }, { recentSessions: store.sessions, athleteProfile: athleteProfile ?? undefined }, store.sessions)
      if (!dose.ok) throw new Error(dose.message)
      // La duración persistida es la que salió del finalizador, no la pedida:
      // el clamp al tope semanal devuelve una estructura más corta y escribir
      // los minutos originales dejaba la sesión declarando más de lo que suman
      // sus bloques, algo que la dosis siguiente rechaza.
      const patch: Partial<Session> = { durationMin: dose.action.newDurationMin ?? action.newDurationMin }
      if (dose.action.squashDetails) patch.squashDetails = dose.action.squashDetails
      if (dose.action.intervalStructure) patch.runningDetails = { ...current.runningDetails,
        runningType: dose.action.runningType ?? current.runningDetails?.runningType ?? 'z2', intervalStructure: dose.action.intervalStructure, templateRef: dose.action.runningTemplateRef, selectionReason: dose.action.runningSelectionReason }
      const timed = ensureSessionProtocols({ ...current, ...patch })
      patch.warmup = timed.warmup; patch.cooldown = timed.cooldown
      restoredSessions.push(current)
      await store.updateSession(id, patch)
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
        title: 'Recuperacion activa (RallyIQ)',
        durationMin: 30,
        objective: action.reason,
      }))
      createdSessionIds.push(created.id)
      break
    }

    case 'add_session': {
      const dose = finalizeCoachActionDose(action, { recentSessions: store.sessions, athleteProfile: athleteProfile ?? undefined }, store.sessions)
      if (!dose.ok) throw new Error(dose.message)
      action = dose.action
      if (!action.targetDate || !action.sessionType || !action.title || !action.durationMin || !action.timeBlock) {
        throw new Error('add_session requires targetDate, sessionType, title, durationMin, timeBlock')
      }
      if (!isSessionTypeAllowedForPlan(action.sessionType, athleteProfile)) {
        warnings.push(`Se filtro add_session de ${action.sessionType} por no estar permitido en la planificacion actual.`)
        break
      }
      let verifiedExercises = action.exercises
      if (action.sessionType === 'strength') {
        const messageConstraints = action.strengthSafetyFinalization?.userMessageConstraints ?? []
        const constraints = mergeStrengthConstraints(
          resolveProfileStrengthSafetyConstraints(athleteProfile),
          messageConstraints,
        )
        const prepared = prepareStrengthSession(action, {
          constraints,
          userMessageConstraints: messageConstraints,
          userMessage: '',
          selectionContext: buildStrengthSafetyContext(
            athleteProfile,
            action.durationMin,
            action.objective,
            constraints,
          ),
          structureOptions: {
            durationMin: action.durationMin,
            strengthProfile: athleteProfile?.strengthProfile,
          },
          supersetMode: 'off',
          sealLocation: 'root',
        })
        if (prepared.status === 'blocked') {
          throw new Error(BLOCKED_STRENGTH_COPY)
        }
        verifiedExercises = prepared.session.exercises
        if (prepared.removed.length > 0 || prepared.replaced.length > 0) {
          warnings.push('Se excluyeron o reemplazaron ejercicios por tu restricción.')
        }
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
        exercises: verifiedExercises?.map((exercise) => ({ ...exercise, id: uuid(), completed: false })),
        runningDetails: action.runningType
          ? {
              runningType: action.runningType,
              targetPaceMin: action.targetPaceMin,
              targetPaceMax: action.targetPaceMax,
              targetHrMin: action.targetHrMin,
              targetHrMax: action.targetHrMax,
              intervalStructure: action.intervalStructure,
              templateRef: action.runningTemplateRef, selectionReason: action.runningSelectionReason,
            }
          : undefined,
        cyclingDetails: action.sessionType === 'cycling' ? action.cyclingDetails : undefined,
        mobilityDetails: action.sessionType === 'mobility' || action.sessionType === 'recovery'
          ? action.mobilityDetails
          : undefined,
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
        replacementCutoffAt: proposalCreatedAt,
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
      if (action.baseUpdatedAt != null && action.baseUpdatedAt !== current.updatedAt) {
        throw new Error('La sesión tiene cambios más recientes. Actualiza la propuesta antes de aceptarla.')
      }
      restoredSessions.push({ ...current })

      const dose = finalizeCoachActionDose(action, { recentSessions: store.sessions, athleteProfile: athleteProfile ?? undefined }, store.sessions)
      if (!dose.ok) throw new Error(dose.message)
      action = dose.action
      const nextType = action.newType ?? current.type
      if (!isSessionTypeAllowedForPlan(nextType, athleteProfile)) {
        warnings.push(`Se filtro update_session a ${nextType} por no estar permitido en la planificacion actual.`)
        break
      }

      let verifiedStrengthExercises: CoachAction['exercises']
      if (nextType === 'strength') {
        const prospective = materializeProspectiveSession(current, action)
        const messageConstraints = action.strengthSafetyFinalization?.userMessageConstraints ?? []
        const constraints = mergeStrengthConstraints(
          resolveProfileStrengthSafetyConstraints(athleteProfile),
          messageConstraints,
        )
        const prepared = prepareStrengthSession(prospective, {
          constraints,
          userMessageConstraints: messageConstraints,
          userMessage: '',
          selectionContext: buildStrengthSafetyContext(
            athleteProfile,
            prospective.durationMin,
            prospective.objective,
            constraints,
          ),
          structureOptions: {
            durationMin: prospective.durationMin,
            strengthProfile: athleteProfile?.strengthProfile,
          },
          supersetMode: 'off',
          sealLocation: 'root',
        })
        if (prepared.status === 'blocked') {
          throw new Error(BLOCKED_STRENGTH_COPY)
        }
        verifiedStrengthExercises = prepared.session.exercises
        if (prepared.removed.length > 0 || prepared.replaced.length > 0) {
          warnings.push('Se excluyeron o reemplazaron ejercicios por tu restricción.')
        }
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
      if (nextType === 'running') {
        patch.runningDetails = action.runningType || action.targetPaceMin || action.targetPaceMax || action.targetHrMin != null || action.targetHrMax != null || action.intervalStructure != null
          ? {
              runningType: action.runningType ?? current.runningDetails?.runningType ?? 'z2',
              targetPaceMin: action.targetPaceMin ?? current.runningDetails?.targetPaceMin,
              targetPaceMax: action.targetPaceMax ?? current.runningDetails?.targetPaceMax,
              targetHrMin: action.targetHrMin ?? current.runningDetails?.targetHrMin,
              targetHrMax: action.targetHrMax ?? current.runningDetails?.targetHrMax,
              intervalStructure: action.intervalStructure ?? current.runningDetails?.intervalStructure,
              templateRef: action.runningTemplateRef, selectionReason: action.runningSelectionReason,
            }
          : current.runningDetails
        patch.cyclingDetails = undefined
      }
      if (nextType === 'cycling') {
        patch.runningDetails = undefined
        patch.cyclingDetails = action.cyclingDetails ?? current.cyclingDetails
      }
      if (nextType === 'strength') {
        patch.exercises = verifiedStrengthExercises
          ? preserveStrengthExerciseIdentity(
              verifiedStrengthExercises as unknown as ReadonlyArray<Record<string, unknown>>,
              current.type === 'strength' ? current.exercises ?? [] : [],
            )
          : undefined
      } else if (Array.isArray(action.exercises)) {
        patch.exercises = action.exercises.map((exercise) => ({ ...exercise, id: uuid(), completed: false }))
      } else if (nextType === 'mobility') {
        patch.exercises = current.exercises
      }
      if (nextType === 'mobility') {
        patch.mobilityDetails = action.mobilityDetails ?? current.mobilityDetails
      }

      const resolvedRunningType =
        nextType === 'running'
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
      const timed = ensureSessionProtocols({ ...current, ...patch } as Session)
      patch.warmup = timed.warmup
      patch.cooldown = timed.cooldown
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

import { db } from '../../db/db'
import type { ChatMessage, CoachProposal } from '../../types'
import { getActiveAthleteId, getSelfAthleteId } from '../athlete/activeAthlete'
import { isScopedAthleteId } from '../athlete/effectiveAthleteKey'
import * as syncService from '../syncService'

// Serializa escrituras para un mismo hilo+scope, pero NO comparte el array de
// salida: dos hidrataciones pueden haber leído snapshots distintos del hilo.
const orphanProposalRepairLocks = new Map<string, Promise<void>>()

interface AthleteScopeSnapshot {
  activeAthleteId: string | null
  selfAthleteId: string | null
}

export async function repairOrphanProposalMessages(
  chatSessionId: string,
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  // El scope es estado global mutable. Capturarlo antes del primer await evita
  // filtrar o estampar con otro atleta si el usuario cambia mientras reparamos.
  const scope = captureAthleteScope()
  // chatSessionId puede colisionar entre atletas, así que tampoco alcanza como
  // clave del lock por sí solo.
  const lockKey = JSON.stringify([
    chatSessionId,
    scope.activeAthleteId,
    scope.selfAthleteId,
  ])
  const previous = orphanProposalRepairLocks.get(lockKey)
  const repairPromise = (previous ?? Promise.resolve())
    // Una reparación fallida no debe bloquear para siempre las siguientes.
    .catch(() => undefined)
    .then(() => repairOrphanProposalMessagesUnlocked(chatSessionId, messages, scope))
  const completion = repairPromise.then(
    () => undefined,
    () => undefined,
  )
  orphanProposalRepairLocks.set(lockKey, completion)
  void completion.finally(() => {
    // No borrar el lock de un caller posterior que ya quedó encolado.
    if (orphanProposalRepairLocks.get(lockKey) === completion) {
      orphanProposalRepairLocks.delete(lockKey)
    }
  })
  return repairPromise
}

async function repairOrphanProposalMessagesUnlocked(
  chatSessionId: string,
  messages: ChatMessage[],
  scope: AthleteScopeSnapshot,
): Promise<ChatMessage[]> {
  const repairedForSync: Array<{ message: ChatMessage; proposal: CoachProposal }> = []
  const repairedMessages = await db.transaction('rw', db.chatMessages, db.coachProposals, async () => {
    // Scope the repair pool: a proposal from another athlete must never be
    // re-attached to the current thread just because the timing matches.
    const proposals = (await db.coachProposals.orderBy('createdAt').toArray())
      .filter((proposal) => isRowInScope(proposal.athleteId, scope))
    if (proposals.length === 0 || messages.length === 0) return messages

    const nextMessages = [...messages]
    const messageIds = new Set(nextMessages.map((message) => message.id))
    const linkedProposalIds = new Set(
      nextMessages
        .map((message) => message.proposalId)
        .filter((proposalId): proposalId is string => typeof proposalId === 'string' && proposalId.length > 0),
    )
    const userMessages = nextMessages
      .filter((message) => message.role === 'user')
      .sort((a, b) => a.timestamp - b.timestamp)

    for (const proposal of proposals.sort((a, b) => a.createdAt - b.createdAt)) {
      if (linkedProposalIds.has(proposal.id)) continue
      if (proposal.chatMessageId && messageIds.has(proposal.chatMessageId)) continue

      const anchor = findProposalAnchorMessage(proposal, userMessages)
      if (!anchor) continue
      const hasNearbyCoachReply = nextMessages.some((message) =>
        message.role === 'coach' &&
        message.timestamp >= anchor.timestamp &&
        message.timestamp <= proposal.createdAt + 5 * 60 * 1000
      )
      if (hasNearbyCoachReply) continue

      // El mensaje recuperado hereda el scope de su propuesta (ya filtrada al
      // scope activo); si la propuesta es legacy, cae al estampado genérico.
      const recovered = buildProposalRecoveredMessage(proposal, chatSessionId, anchor.timestamp)
      const repairedMessage = isScopedAthleteId(proposal.athleteId)
        ? { ...recovered, athleteId: proposal.athleteId }
        : withScopeStamp(recovered, scope)
      const repairedProposal = { ...proposal, chatMessageId: repairedMessage.id }
      await db.chatMessages.put(repairedMessage)
      await db.coachProposals.put(repairedProposal)

      repairedForSync.push({ message: repairedMessage, proposal: repairedProposal })
      nextMessages.push(repairedMessage)
      messageIds.add(repairedMessage.id)
      linkedProposalIds.add(proposal.id)
    }

    return nextMessages.sort((a, b) => a.timestamp - b.timestamp)
  })

  for (const repaired of repairedForSync) {
    void syncService.pushChatMessage(repaired.message)
    void syncService.pushCoachProposal(repaired.proposal)
  }

  return repairedMessages
}

function captureAthleteScope(): AthleteScopeSnapshot {
  return {
    activeAthleteId: getActiveAthleteId(),
    selfAthleteId: getSelfAthleteId(),
  }
}

function isRowInScope(
  rowAthleteId: string | null | undefined,
  scope: AthleteScopeSnapshot,
): boolean {
  if (!scope.activeAthleteId) return true
  if (isScopedAthleteId(rowAthleteId)) {
    return rowAthleteId === scope.activeAthleteId
  }
  return scope.activeAthleteId === scope.selfAthleteId
}

function withScopeStamp<T extends { athleteId?: string }>(
  row: T,
  scope: AthleteScopeSnapshot,
): T {
  if (isScopedAthleteId(row.athleteId) || !scope.activeAthleteId) return row
  return { ...row, athleteId: scope.activeAthleteId }
}

function findProposalAnchorMessage(
  proposal: CoachProposal,
  userMessages: ChatMessage[],
): ChatMessage | undefined {
  const ORPHAN_REPAIR_WINDOW_MS = 30 * 60 * 1000
  return [...userMessages]
    .reverse()
    .find((message) =>
      message.timestamp <= proposal.createdAt &&
      proposal.createdAt - message.timestamp <= ORPHAN_REPAIR_WINDOW_MS
    )
}

function buildProposalRecoveredMessage(
  proposal: CoachProposal,
  chatSessionId: string,
  anchorTimestamp: number,
): ChatMessage {
  return {
    id: `recovered-proposal-${proposal.id}`,
    role: 'coach',
    content: proposal.message || 'Tengo una propuesta lista para revisar.',
    timestamp: Math.max(anchorTimestamp + 1, proposal.createdAt),
    chatSessionId,
    proposalId: proposal.id,
    contextMeta: {
      contextVersion: 1,
    },
  }
}

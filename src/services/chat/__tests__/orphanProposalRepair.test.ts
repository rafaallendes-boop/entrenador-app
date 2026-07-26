import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, CoachProposal } from '../../../types'
import { setActiveAthleteId, setSelfAthleteId } from '../../athlete/activeAthlete'

const mocks = vi.hoisted(() => ({
  proposals: [] as CoachProposal[],
  storedMessages: [] as ChatMessage[],
  firstReadGate: null as Promise<void> | null,
  markFirstReadStarted: null as (() => void) | null,
  proposalReadCount: 0,
  pushChatMessage: vi.fn(),
  pushCoachProposal: vi.fn(),
}))

vi.mock('../../../db/db', () => ({
  db: {
    transaction: vi.fn(async (_mode: string, ...args: unknown[]) => {
      const work = args[args.length - 1] as () => Promise<unknown>
      return work()
    }),
    chatMessages: {
      put: vi.fn(async (message: ChatMessage) => {
        mocks.storedMessages.push(message)
      }),
    },
    coachProposals: {
      orderBy: vi.fn(() => ({
        toArray: vi.fn(async () => {
          mocks.proposalReadCount += 1
          if (mocks.proposalReadCount === 1 && mocks.firstReadGate) {
            mocks.markFirstReadStarted?.()
            await mocks.firstReadGate
          }
          return [...mocks.proposals]
        }),
      })),
      put: vi.fn(async () => undefined),
    },
  },
}))

vi.mock('../../syncService', () => ({
  pushChatMessage: mocks.pushChatMessage,
  pushCoachProposal: mocks.pushCoachProposal,
}))

const { repairOrphanProposalMessages } = await import('../orphanProposalRepair')

function userMessage(id: string, athleteId?: string): ChatMessage {
  return {
    id,
    role: 'user',
    content: 'Necesito ajustar el plan',
    timestamp: 100,
    chatSessionId: 'colliding-session',
    ...(athleteId ? { athleteId } : {}),
  }
}

function proposal(id: string, athleteId?: string): CoachProposal {
  return {
    id,
    message: `Propuesta ${id}`,
    actions: [],
    status: 'pending',
    createdAt: 110,
    ...(athleteId ? { athleteId } : {}),
  }
}

afterEach(() => {
  setActiveAthleteId(null)
  setSelfAthleteId(null)
  mocks.proposals.length = 0
  mocks.storedMessages.length = 0
  mocks.firstReadGate = null
  mocks.markFirstReadStarted = null
  mocks.proposalReadCount = 0
  mocks.pushChatMessage.mockReset()
  mocks.pushCoachProposal.mockReset()
})

describe('repairOrphanProposalMessages scope ownership', () => {
  it('isolates colliding session locks and keeps the entry scope through awaits', async () => {
    mocks.proposals.push(
      proposal('legacy-proposal'),
      proposal('managed-proposal', 'ath_managed'),
    )

    let releaseFirstRead = () => undefined
    let markFirstReadStarted = () => undefined
    const firstReadStarted = new Promise<void>((resolve) => {
      markFirstReadStarted = resolve
    })
    mocks.firstReadGate = new Promise<void>((resolve) => {
      releaseFirstRead = resolve
    })
    mocks.markFirstReadStarted = markFirstReadStarted

    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')
    const selfRepair = repairOrphanProposalMessages(
      'colliding-session',
      [userMessage('self-user')],
    )
    await firstReadStarted

    // Mismo chatSessionId, otro scope, mientras la primera reparación espera.
    setActiveAthleteId('ath_managed')
    const managedRepair = repairOrphanProposalMessages(
      'colliding-session',
      [userMessage('managed-user', 'ath_managed')],
    )

    releaseFirstRead()
    const [selfMessages, managedMessages] = await Promise.all([
      selfRepair,
      managedRepair,
    ])

    expect(selfMessages).toHaveLength(2)
    expect(selfMessages[1]).toMatchObject({
      proposalId: 'legacy-proposal',
      athleteId: 'ath_self',
    })
    expect(managedMessages).toHaveLength(2)
    expect(managedMessages[1]).toMatchObject({
      proposalId: 'managed-proposal',
      athleteId: 'ath_managed',
    })
    expect(mocks.proposalReadCount).toBe(2)
  })

  it('serializes the repair without reusing the first caller message snapshot', async () => {
    mocks.proposals.push(proposal('legacy-proposal'))

    let releaseFirstRead = () => undefined
    let markFirstReadStarted = () => undefined
    const firstReadStarted = new Promise<void>((resolve) => {
      markFirstReadStarted = resolve
    })
    mocks.firstReadGate = new Promise<void>((resolve) => {
      releaseFirstRead = resolve
    })
    mocks.markFirstReadStarted = markFirstReadStarted

    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')
    const first = repairOrphanProposalMessages(
      'colliding-session',
      [userMessage('old-user')],
    )
    await firstReadStarted

    const second = repairOrphanProposalMessages(
      'colliding-session',
      [
        userMessage('old-user'),
        { ...userMessage('fresh-user'), timestamp: 105 },
      ],
    )

    releaseFirstRead()
    const [firstMessages, secondMessages] = await Promise.all([first, second])

    expect(firstMessages.map(message => message.id)).not.toContain('fresh-user')
    expect(secondMessages.map(message => message.id)).toContain('fresh-user')
    expect(secondMessages).toHaveLength(3)
    expect(mocks.proposalReadCount).toBe(2)
  })
})

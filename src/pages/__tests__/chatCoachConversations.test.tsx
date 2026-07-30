// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../types'

const h = vi.hoisted(() => ({
  openConversation: vi.fn(),
  messages: [] as ChatMessage[],
  loadHistory: vi.fn(),
  loadProposals: vi.fn(),
  loadMemory: vi.fn(),
  loadWeek: vi.fn(),
  currentSessionId: 's1',
}))

vi.mock('../../components/chat/ConversationDrawer', () => ({
  default: ({
    isOpen,
    onSelect,
  }: {
    isOpen: boolean
    onSelect: (sessionId: string, matchedMessageId: string | null) => void
  }) =>
    isOpen ? (
      <>
        <button type="button" onClick={() => onSelect('s2', 'msg-2')}>
          abrir resultado
        </button>
        <button type="button" onClick={() => onSelect('s3', null)}>
          abrir sin match
        </button>
      </>
    ) : null,
}))

vi.mock('../../store/useChatStore', () => {
  const useChatStore = () => ({
    messages: h.messages,
    isLoading: false,
    streamingText: '',
    responsePhase: 'idle',
    error: null,
    loadHistory: h.loadHistory,
    sendMessage: vi.fn(),
    newSession: vi.fn(),
    deleteCurrentSession: vi.fn(),
    openConversation: h.openConversation,
  })
  useChatStore.getState = () => ({
    currentSessionId: h.currentSessionId,
    error: h.currentSessionId === 's2' ? null : 'No encontramos esa conversación.',
    messages: h.messages,
  })
  return { useChatStore }
})

vi.mock('../../store/useCoachActionsStore', () => ({
  useCoachActionsStore: () => ({
    proposals: [],
    loadProposals: h.loadProposals,
    acceptProposal: vi.fn(),
    rejectProposal: vi.fn(),
  }),
}))

vi.mock('../../store/useCoachMemoryStore', () => ({
  useCoachMemoryStore: () => ({
    coachMemory: '',
    athleteProfile: null,
    loadMemory: h.loadMemory,
  }),
}))

vi.mock('../../store/useTrainingStore', () => ({
  useTrainingStore: () => ({
    sessions: [],
    currentWeekSummary: null,
    dayLogs: {},
    loadWeek: h.loadWeek,
  }),
}))

vi.mock('../../store/useAuthStore', () => {
  const authState = {
    activeAthleteId: null,
    user: null,
    syncDetails: {
      lastErrorEntity: null,
      pendingTables: [],
      consecutiveFailures: 0,
    },
    setSyncDetails: vi.fn(),
    setSyncStatus: vi.fn(),
  }
  const useAuthStore = (selector: (state: typeof authState) => unknown) => selector(authState)
  useAuthStore.getState = () => authState
  return { useAuthStore }
})

vi.mock('../../hooks/useWeeklySnapshot', () => ({
  useLoadAnalytics: () => null,
}))

vi.mock('../../hooks/useWeeklyLaunchIntent', () => ({
  useWeeklyLaunchIntent: () => ({ launchIntent: null, launchId: 0 }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({
    key: 'test',
    pathname: '/chat',
    search: '',
    state: null,
  }),
}))

const scrollSpy = vi.fn()

beforeEach(() => {
  scrollSpy.mockReset()
  h.openConversation.mockReset()
  h.loadHistory.mockReset()
  h.loadProposals.mockReset()
  h.loadMemory.mockReset()
  h.loadWeek.mockReset()
  h.currentSessionId = 's1'
  h.openConversation.mockImplementation(async (sessionId: string) => {
    h.currentSessionId = sessionId
  })
  Element.prototype.scrollIntoView = function scrollIntoView(options?: ScrollIntoViewOptions) {
    scrollSpy(this, options)
  }
  h.messages = [
    {
      id: 'current-msg',
      role: 'user',
      content: 'actual',
      timestamp: 1,
      chatSessionId: 's1',
    } as ChatMessage,
  ]
})

afterEach(() => {
  cleanup()
})

describe('ChatCoach conversation wiring', () => {
  it('opens the drawer from the header button', async () => {
    const { default: ChatCoach } = await import('../ChatCoach')
    render(<ChatCoach />)

    await userEvent.click(screen.getByRole('button', { name: /conversaciones/i }))

    expect(await screen.findByText('abrir resultado')).toBeTruthy()
  })

  it('keeps a pending target and scrolls the match instead of the bottom', async () => {
    let finishOpen: () => void = () => {}
    h.openConversation.mockImplementation(
      (sessionId: string) =>
        new Promise<void>((resolve) => {
          finishOpen = () => {
            h.currentSessionId = sessionId
            resolve()
          }
        }),
    )
    const { default: ChatCoach } = await import('../ChatCoach')
    const view = render(<ChatCoach />)

    await userEvent.click(screen.getByRole('button', { name: /conversaciones/i }))
    await userEvent.click(await screen.findByText('abrir resultado'))

    expect(h.openConversation).toHaveBeenCalledWith('s2')
    expect(document.querySelector('[data-message-id="msg-2"]')).toBeNull()

    h.messages = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'uno',
        timestamp: 1,
        chatSessionId: 's2',
      } as ChatMessage,
      {
        id: 'msg-2',
        role: 'user',
        content: 'dos',
        timestamp: 2,
        chatSessionId: 's2',
      } as ChatMessage,
    ]
    view.rerender(<ChatCoach />)
    finishOpen()

    const target = document.querySelector('[data-message-id="msg-2"]')
    expect(target).toBeTruthy()
    expect(scrollSpy).toHaveBeenLastCalledWith(target, {
      behavior: 'smooth',
      block: 'center',
    })
  })

  it('releases a successful open whose matched message no longer exists', async () => {
    h.openConversation.mockImplementation(async (sessionId: string) => {
      h.currentSessionId = sessionId
      h.messages = [
        {
          id: 'surviving-message',
          role: 'coach',
          content: 'el mensaje encontrado ya no existe',
          timestamp: 2,
          chatSessionId: sessionId,
        } as ChatMessage,
      ]
    })
    const { default: ChatCoach } = await import('../ChatCoach')
    const view = render(<ChatCoach />)

    await userEvent.click(screen.getByRole('button', { name: /conversaciones/i }))
    await userEvent.click(await screen.findByText('abrir resultado'))
    view.rerender(<ChatCoach />)

    const bottom = document.querySelector('[data-chat-bottom]')
    expect(document.querySelector('[data-message-id="msg-2"]')).toBeNull()
    expect(scrollSpy).toHaveBeenLastCalledWith(bottom, { behavior: 'smooth' })
  })

  it('releases bottom scrolling when a stale result cannot be opened', async () => {
    h.openConversation.mockResolvedValue(undefined)
    const { default: ChatCoach } = await import('../ChatCoach')
    const view = render(<ChatCoach />)

    await userEvent.click(screen.getByRole('button', { name: /conversaciones/i }))
    await userEvent.click(await screen.findByText('abrir resultado'))

    h.messages = [
      {
        id: 'after-failure',
        role: 'user',
        content: 'continúa la conversación actual',
        timestamp: 2,
        chatSessionId: 's1',
      } as ChatMessage,
      {
        id: 'after-failure-2',
        role: 'coach',
        content: 'respuesta',
        timestamp: 3,
        chatSessionId: 's1',
      } as ChatMessage,
    ]
    view.rerender(<ChatCoach />)

    const bottom = document.querySelector('[data-chat-bottom]')
    expect(scrollSpy).toHaveBeenLastCalledWith(bottom, { behavior: 'smooth' })
  })

  it('scrolls to the bottom when a same-count conversation has no match target', async () => {
    const { default: ChatCoach } = await import('../ChatCoach')
    const view = render(<ChatCoach />)

    await userEvent.click(screen.getByRole('button', { name: /conversaciones/i }))
    await userEvent.click(await screen.findByText('abrir sin match'))

    h.messages = [
      {
        id: 'same-count-new-thread',
        role: 'coach',
        content: 'otro hilo con la misma cantidad',
        timestamp: 2,
        chatSessionId: 's3',
      } as ChatMessage,
    ]
    view.rerender(<ChatCoach />)

    const bottom = document.querySelector('[data-chat-bottom]')
    expect(h.openConversation).toHaveBeenCalledWith('s3')
    expect(scrollSpy).toHaveBeenLastCalledWith(bottom, { behavior: 'smooth' })
  })
})

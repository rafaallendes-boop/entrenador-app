// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ConversationSearchResult,
  ConversationSummary,
} from '../../../services/chat/conversationIndex'
import ConversationDrawer from '../ConversationDrawer'

const h = vi.hoisted(() => ({
  conversations: [] as ConversationSummary[],
  searchDeferrals: [] as Array<(value: ConversationSearchResult[]) => void>,
  loadConversations: vi.fn(),
  deleteConversation: vi.fn(),
  status: 'ready' as 'idle' | 'loading' | 'ready' | 'error',
}))

// Se stubean solo las dos lecturas; `normalizeForMatch` queda real a propósito.
// El resaltado del snippet tiene que usar exactamente la misma normalización que
// la búsqueda: dos implementaciones distintas resaltarían el span equivocado.
vi.mock('../../../services/chat/conversationIndex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/chat/conversationIndex')>()),
  searchConversations: vi.fn(
    () =>
      new Promise<ConversationSearchResult[]>((resolve) => {
        h.searchDeferrals.push(resolve)
      }),
  ),
  listConversations: vi.fn(async () => h.conversations),
}))

vi.mock('../../../store/useChatStore', () => ({
  useChatStore: (selector: (state: unknown) => unknown) =>
    selector({
      conversations: h.conversations,
      conversationsStatus: h.status,
      conversationsDirty: false,
      currentSessionId: 's1',
      loadConversations: h.loadConversations,
      deleteConversation: h.deleteConversation,
    }),
}))

const NOW = new Date(2026, 6, 26, 12, 0).getTime()

beforeEach(() => {
  h.searchDeferrals.length = 0
  h.loadConversations.mockReset()
  h.deleteConversation.mockReset()
  h.status = 'ready'
  h.conversations = [
    {
      sessionId: 's1',
      title: 'Molestia en el hombro',
      lastMessageAt: NOW,
      firstMessageAt: NOW - 1_000,
      messageCount: 8,
    },
    {
      sessionId: 's2',
      title: 'Semana de torneo',
      lastMessageAt: NOW - 86_400_000,
      firstMessageAt: NOW - 90_000_000,
      messageCount: 12,
    },
  ]
  vi.setSystemTime(NOW)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ConversationDrawer', () => {
  it('lists conversations grouped by day', async () => {
    render(<ConversationDrawer isOpen onClose={() => {}} onSelect={() => {}} />)

    expect(await screen.findByText('Molestia en el hombro')).toBeTruthy()
    expect(screen.getByText('Semana de torneo')).toBeTruthy()
    expect(screen.getByText('Hoy')).toBeTruthy()
    expect(screen.getByText('Ayer')).toBeTruthy()
  })

  it('uses distinct groups and labels for the same calendar day across years', () => {
    h.conversations = [
      {
        sessionId: 'year-2025',
        title: 'Temporada 2025',
        firstMessageAt: new Date(2025, 0, 2, 8).getTime(),
        lastMessageAt: new Date(2025, 0, 2, 9).getTime(),
        messageCount: 2,
      },
      {
        sessionId: 'year-2024',
        title: 'Temporada 2024',
        firstMessageAt: new Date(2024, 0, 2, 8).getTime(),
        lastMessageAt: new Date(2024, 0, 2, 9).getTime(),
        messageCount: 2,
      },
    ]

    render(<ConversationDrawer isOpen onClose={() => {}} onSelect={() => {}} />)

    expect(screen.getByText('2 ene 2025')).toBeTruthy()
    expect(screen.getByText('2 ene 2024')).toBeTruthy()
  })

  it('calls onSelect with the session id when a conversation is tapped', async () => {
    const onSelect = vi.fn()
    render(<ConversationDrawer isOpen onClose={() => {}} onSelect={onSelect} />)

    await userEvent.click(await screen.findByText('Semana de torneo'))

    expect(onSelect).toHaveBeenCalledWith('s2', null)
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <ConversationDrawer isOpen={false} onClose={() => {}} onSelect={() => {}} />,
    )

    expect(container.firstChild).toBeNull()
  })

  it('reuses an index load that is already in flight when reopened', () => {
    h.status = 'loading'

    render(<ConversationDrawer isOpen onClose={() => {}} onSelect={() => {}} />)

    expect(h.loadConversations).not.toHaveBeenCalled()
  })

  it('discards a stale search result that resolves late', async () => {
    vi.useFakeTimers()
    render(<ConversationDrawer isOpen onClose={() => {}} onSelect={() => {}} />)
    const input = screen.getByPlaceholderText(/buscar/i)

    fireEvent.change(input, { target: { value: 'hom' } })
    await vi.advanceTimersByTimeAsync(300)
    fireEvent.change(input, { target: { value: 'hombro' } })
    await vi.advanceTimersByTimeAsync(300)

    expect(h.searchDeferrals).toHaveLength(2)

    const fresh: ConversationSearchResult[] = [
      {
        ...h.conversations[0],
        title: 'Resultado nuevo',
        snippet: 'bro',
        matchCount: 1,
        matchedMessageId: 'm2',
      },
    ]
    const stale: ConversationSearchResult[] = [
      {
        ...h.conversations[1],
        title: 'Resultado viejo',
        snippet: 'hom',
        matchCount: 1,
        matchedMessageId: 'm1',
      },
    ]

    h.searchDeferrals[1](fresh)
    await vi.advanceTimersByTimeAsync(0)
    h.searchDeferrals[0](stale)
    await vi.advanceTimersByTimeAsync(0)

    expect(screen.getByText('Resultado nuevo')).toBeTruthy()
    expect(screen.queryByText('Resultado viejo')).toBeNull()
  })

  it('does not keep results when the drawer closes with a search in flight', async () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <ConversationDrawer isOpen onClose={() => {}} onSelect={() => {}} />,
    )
    fireEvent.change(screen.getByPlaceholderText(/buscar/i), {
      target: { value: 'hombro' },
    })
    await vi.advanceTimersByTimeAsync(300)

    rerender(<ConversationDrawer isOpen={false} onClose={() => {}} onSelect={() => {}} />)

    h.searchDeferrals[0]?.([
      {
        ...h.conversations[0],
        title: 'Tarde',
        snippet: 'x',
        matchCount: 1,
        matchedMessageId: 'm1',
      },
    ])
    await vi.advanceTimersByTimeAsync(0)

    rerender(<ConversationDrawer isOpen onClose={() => {}} onSelect={() => {}} />)
    expect(screen.queryByText('Tarde')).toBeNull()
  })

  it('removes a deleted search result and refreshes the active query', async () => {
    vi.useFakeTimers()
    render(<ConversationDrawer isOpen onClose={() => {}} onSelect={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText(/buscar/i), {
      target: { value: 'torneo' },
    })
    await vi.advanceTimersByTimeAsync(300)

    await act(async () => {
      h.searchDeferrals[0]([
        {
          ...h.conversations[1],
          snippet: 'Semana de torneo',
          matchCount: 1,
          matchedMessageId: 'm2',
        },
      ])
      await Promise.resolve()
    })
    // El título va plano; en el snippet el término buscado viaja resaltado, así
    // que se verifica por separado en vez de contar dos strings idénticos.
    expect(screen.getByText('Semana de torneo')).toBeTruthy()
    expect(screen.getByText('torneo', { selector: 'mark' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Borrar conversación' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Borrar conversación' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar borrado' }))
      await Promise.resolve()
    })

    expect(h.deleteConversation).toHaveBeenCalledWith('s2')
    expect(screen.queryAllByText('Semana de torneo')).toHaveLength(0)
    expect(screen.queryAllByText('torneo', { selector: 'mark' })).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(300)
    expect(h.searchDeferrals).toHaveLength(2)
    h.searchDeferrals[1]([])
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.queryAllByText('Semana de torneo')).toHaveLength(0)
  })

  it('distinguishes a failed search from a search with no matches', async () => {
    vi.useFakeTimers()
    const { searchConversations } = await import('../../../services/chat/conversationIndex')
    vi.mocked(searchConversations).mockRejectedValueOnce(new Error('dexie caída'))

    render(<ConversationDrawer isOpen onClose={() => {}} onSelect={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText(/buscar/i), {
      target: { value: 'hombro' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(screen.getByText(/no pudimos buscar/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /buscar de nuevo/i })).toBeTruthy()
    // Cero resultados por un fallo no puede leerse como "no hay coincidencias".
    expect(screen.queryByText(/nada coincide/i)).toBeNull()
  })

  it('shows the empty-search message when the scan succeeded with no matches', async () => {
    vi.useFakeTimers()
    render(<ConversationDrawer isOpen onClose={() => {}} onSelect={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText(/buscar/i), {
      target: { value: 'hombro' },
    })
    await vi.advanceTimersByTimeAsync(300)

    await act(async () => {
      h.searchDeferrals[0]([])
      await Promise.resolve()
    })

    expect(screen.getByText(/nada coincide con «hombro»/i)).toBeTruthy()
    expect(screen.queryByText(/no pudimos buscar/i)).toBeNull()
  })

  it('shows the last valid list plus a retry when the index errored', async () => {
    h.status = 'error'
    render(<ConversationDrawer isOpen onClose={() => {}} onSelect={() => {}} />)

    expect(screen.getByText('Molestia en el hombro')).toBeTruthy()
    expect(h.loadConversations).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(h.loadConversations).toHaveBeenCalledTimes(2)
  })
})

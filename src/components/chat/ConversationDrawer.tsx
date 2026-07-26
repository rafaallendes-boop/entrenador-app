import { format, isThisYear, isToday, isYesterday } from 'date-fns'
import { es } from 'date-fns/locale'
import { Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  normalizeForMatch,
  searchConversations,
  type ConversationSearchResult,
  type ConversationSummary,
} from '../../services/chat/conversationIndex'
import { useChatStore } from '../../store/useChatStore'

interface ConversationDrawerProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (sessionId: string, matchedMessageId: string | null) => void
}

function dayGroup(timestamp: number): { key: string; label: string } {
  const date = new Date(timestamp)
  const key = format(date, 'yyyy-MM-dd')
  if (isToday(date)) return { key, label: 'Hoy' }
  if (isYesterday(date)) return { key, label: 'Ayer' }
  return {
    key,
    label: format(date, isThisYear(date) ? 'd MMM' : 'd MMM yyyy', { locale: es }),
  }
}

/**
 * Resalta el término buscado dentro del snippet. Solo hace aritmética de
 * índices cuando normalizar preserva la longitud; ante un caso Unicode
 * excepcional devuelve el texto plano en vez de un recorte equivocado.
 */
function highlightMatch(snippet: string, query: string) {
  const needle = normalizeForMatch(query.trim())
  const normalized = normalizeForMatch(snippet)
  if (needle.length === 0 || normalized.length !== snippet.length) return snippet

  const index = normalized.indexOf(needle)
  if (index < 0) return snippet

  return (
    <>
      {snippet.slice(0, index)}
      <mark className="bg-transparent text-brand-light">
        {snippet.slice(index, index + needle.length)}
      </mark>
      {snippet.slice(index + needle.length)}
    </>
  )
}

export default function ConversationDrawer({
  isOpen,
  onClose,
  onSelect,
}: ConversationDrawerProps) {
  if (!isOpen) return null
  return <ConversationDrawerPanel onClose={onClose} onSelect={onSelect} />
}

function ConversationDrawerPanel({
  onClose,
  onSelect,
}: Omit<ConversationDrawerProps, 'isOpen'>) {
  const conversations = useChatStore((state) => state.conversations)
  const conversationsStatus = useChatStore((state) => state.conversationsStatus)
  const conversationsDirty = useChatStore((state) => state.conversationsDirty)
  const currentSessionId = useChatStore((state) => state.currentSessionId)
  const loadConversations = useChatStore((state) => state.loadConversations)
  const deleteConversation = useChatStore((state) => state.deleteConversation)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ConversationSearchResult[] | null>(null)
  const [searchFailed, setSearchFailed] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [searchRevision, setSearchRevision] = useState(0)
  const searchToken = useRef(0)
  const initialLoadAttempted = useRef(false)
  const mounted = useRef(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      searchToken.current += 1
    }
  }, [])

  useEffect(() => {
    searchInputRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    if (initialLoadAttempted.current) return
    initialLoadAttempted.current = true
    if (conversationsStatus === 'loading') return
    if (conversationsStatus === 'ready' && !conversationsDirty) return
    void loadConversations()
  }, [conversationsStatus, conversationsDirty, loadConversations])

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length === 0) {
      searchToken.current += 1
      return
    }

    const token = ++searchToken.current
    let cancelled = false
    const timer = window.setTimeout(() => {
      searchConversations(trimmed)
        .then((found) => {
          if (cancelled || token !== searchToken.current) return
          setSearchFailed(false)
          setResults(found)
        })
        .catch(() => {
          if (cancelled || token !== searchToken.current) return
          // Un fallo del escaneo no puede leerse como "no hay resultados":
          // son dos estados distintos y el usuario decide distinto en cada uno.
          setSearchFailed(true)
          setResults([])
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, searchRevision])

  const handleDelete = async (sessionId: string) => {
    setPendingDelete(null)
    try {
      await deleteConversation(sessionId)
    } catch {
      return
    }
    if (!mounted.current) return

    // La lista del store ya se actualizó, pero los resultados son estado local.
    // Invalidar cualquier escaneo anterior, retirar la fila inmediatamente y
    // repetir la query activa sobre Dexie ya actualizado.
    searchToken.current += 1
    setResults((current) => current?.filter((row) => row.sessionId !== sessionId) ?? null)
    setSearchRevision((revision) => revision + 1)
  }

  const rows: (ConversationSummary | ConversationSearchResult)[] = results ?? conversations
  const grouped = useMemo(() => {
    const groups: Array<{
      key: string
      label: string
      items: Array<ConversationSummary | ConversationSearchResult>
    }> = []

    for (const row of rows) {
      const { key, label } = dayGroup(row.lastMessageAt)
      const last = groups[groups.length - 1]
      if (last?.key === key) {
        last.items.push(row)
      } else {
        groups.push({ key, label, items: [row] })
      }
    }

    return groups
  }, [rows])

  const isSearching = query.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className="drawer-scrim-in absolute inset-0 bg-[rgba(8,8,8,0.72)] backdrop-blur-sm"
      />

      <aside
        role="dialog"
        aria-label="Conversaciones"
        className="drawer-panel-in relative flex h-full w-[86%] max-w-sm flex-col border-r border-surface-border bg-surface-card shadow-hud"
      >
        <header className="flex items-center justify-between gap-3 border-b border-surface-border px-4 pb-3 pt-12">
          <div className="min-w-0">
            <p className="font-display text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-faint">
              Historial
            </p>
            <h2 className="font-display text-lg font-bold leading-tight text-ink">
              Conversaciones
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mr-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-pill text-ink-faint transition-colors hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex items-center gap-2 border-b border-surface-border px-4 py-2.5">
          <Search size={13} className="flex-shrink-0 text-ink-faint" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setResults(null)
              // Tipear invalida un fallo anterior: el próximo escaneo decide.
              setSearchFailed(false)
            }}
            placeholder="Buscar en tus conversaciones"
            aria-label="Buscar en tus conversaciones"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-none px-4 pb-6 pt-3">
          {conversationsStatus === 'loading' && rows.length === 0 && (
            <p className="py-2 text-xs text-ink-faint">Cargando tus conversaciones…</p>
          )}

          {conversationsStatus === 'error' && (
            <div className="mb-3 rounded-card-sm border border-surface-border bg-surface-raised px-3 py-2.5">
              <p className="text-xs text-ink-muted">
                No pudimos actualizar la lista. Abajo está la última que cargamos.
              </p>
              <button
                type="button"
                onClick={() => {
                  void loadConversations()
                }}
                className="mt-1.5 font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-light transition-colors hover:text-brand focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Reintentar
              </button>
            </div>
          )}

          {searchFailed && (
            <div className="mb-3 rounded-card-sm border border-surface-border bg-surface-raised px-3 py-2.5">
              <p className="text-xs text-ink-muted">
                No pudimos buscar en tus conversaciones.
              </p>
              <button
                type="button"
                onClick={() => setSearchRevision((revision) => revision + 1)}
                className="mt-1.5 font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-light transition-colors hover:text-brand focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Buscar de nuevo
              </button>
            </div>
          )}

          {rows.length === 0 && !searchFailed && conversationsStatus !== 'loading' && (
            <p className="py-2 text-xs leading-relaxed text-ink-faint">
              {isSearching
                ? `Nada coincide con «${query.trim()}». Probá con otra palabra.`
                : 'Todavía no hay conversaciones. Escribile al coach y esta lista se va armando sola.'}
            </p>
          )}

          {grouped.map((group) => (
            <section key={group.key} className="day-rail relative">
              <p className="relative z-10 -ml-4 mb-1 bg-surface-card py-1 pl-4 font-display text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-faint">
                {group.label}
              </p>

              {group.items.map((row) => {
                const isCurrent = row.sessionId === currentSessionId
                const matchedMessageId = 'matchedMessageId' in row ? row.matchedMessageId : null
                const snippet = 'snippet' in row ? row.snippet : ''
                const isConfirming = pendingDelete === row.sessionId

                return (
                  <div
                    key={row.sessionId}
                    className="group relative flex items-start gap-2 rounded-card-sm py-2 pl-9 pr-1 transition-colors hover:bg-surface-raised/70"
                  >
                    {/* Nodo sobre el rail: lleno y en naranja solo el hilo actual. */}
                    <span
                      aria-hidden="true"
                      className={`absolute left-[13px] top-[15px] h-[9px] w-[9px] rounded-pill border ${
                        isCurrent
                          ? 'border-brand bg-brand'
                          : 'border-surface-soft bg-surface-card'
                      }`}
                    />

                    <button
                      type="button"
                      onClick={() => onSelect(row.sessionId, matchedMessageId)}
                      className="min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    >
                      <p
                        className={`truncate text-sm leading-snug ${
                          isCurrent ? 'text-ink' : 'text-ink-muted group-hover:text-ink'
                        }`}
                      >
                        {row.title}
                      </p>

                      {snippet && (
                        <p className="mt-1 truncate text-[11px] leading-snug text-ink-faint">
                          {highlightMatch(snippet, query)}
                        </p>
                      )}

                      <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                        {format(new Date(row.lastMessageAt), 'HH:mm')}
                        <span className="px-1 text-surface-soft">/</span>
                        {row.messageCount} msj
                        {isCurrent && (
                          <span className="pl-2 text-brand-light">en curso</span>
                        )}
                      </p>
                    </button>

                    {isConfirming ? (
                      <button
                        type="button"
                        aria-label="Confirmar borrado"
                        onClick={() => {
                          void handleDelete(row.sessionId)
                        }}
                        className="flex-shrink-0 rounded-pill border border-red-400/30 px-2 py-1 font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-red-300 transition-colors hover:bg-red-400/10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-red-400"
                      >
                        Confirmar
                      </button>
                    ) : (
                      <button
                        type="button"
                        aria-label="Borrar conversación"
                        onClick={() => setPendingDelete(row.sessionId)}
                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-pill text-ink-faint opacity-0 transition-opacity hover:text-red-300 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-brand group-hover:opacity-100 max-md:opacity-100"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      </aside>
    </div>
  )
}

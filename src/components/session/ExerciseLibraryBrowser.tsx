import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { SessionType } from '../../types'
import {
  getCatalogForSport,
  searchCatalog,
  type CatalogEntry,
} from '../../services/training/coachExerciseCatalog'

export interface ExerciseLibraryBrowserProps {
  sessionType: SessionType
  onAdd: (entry: CatalogEntry) => void
  onClose: () => void
}

type SourceFilter = 'all' | CatalogEntry['source']
type IntensityFilter = 'all' | CatalogEntry['intensity']

const INTENSITY_LABELS: Record<CatalogEntry['intensity'], string> = {
  low: 'Suave',
  moderate: 'Media',
  high: 'Alta',
}

export default function ExerciseLibraryBrowser({
  sessionType,
  onAdd,
  onClose,
}: ExerciseLibraryBrowserProps) {
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [intensityFilter, setIntensityFilter] = useState<IntensityFilter>('all')
  const [addedKey, setAddedKey] = useState<string | null>(null)
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null
    searchRef.current?.focus()

    return () => {
      if (addedTimer.current) clearTimeout(addedTimer.current)
      previouslyFocused.current?.focus()
    }
  }, [])

  const categories = useMemo(() => {
    const catalog = getCatalogForSport(sessionType)
    const sourceEntries = sourceFilter === 'all'
      ? catalog
      : catalog.filter((entry) => entry.source === sourceFilter)
    return Array.from(new Set(sourceEntries.map((entry) => entry.category)))
  }, [sessionType, sourceFilter])

  const entries = useMemo(() => {
    const base = query.trim()
      ? searchCatalog(sessionType, query)
      : getCatalogForSport(sessionType)

    return base
      .filter((entry) => sourceFilter === 'all' || entry.source === sourceFilter)
      .filter((entry) => categoryFilter === 'all' || entry.category === categoryFilter)
      .filter((entry) => intensityFilter === 'all' || entry.intensity === intensityFilter)
  }, [sessionType, query, sourceFilter, categoryFilter, intensityFilter])

  const handleAdd = (entry: CatalogEntry) => {
    onAdd(entry)

    const key = `${entry.source}:${entry.libraryId}`
    setAddedKey(key)
    if (addedTimer.current) clearTimeout(addedTimer.current)
    addedTimer.current = setTimeout(() => setAddedKey(null), 1_500)
  }

  const chipClassName = (pressed: boolean) =>
    `rounded-full border px-3 py-1 text-xs ${
      pressed
        ? 'border-brand text-brand'
        : 'border-surface-border text-ink-muted'
    }`

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col justify-end md:items-center md:justify-center md:p-6"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onClose()
          return
        }
        if (event.key !== 'Tab' || !dialogRef.current) return

        const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ))
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Biblioteca de ejercicios"
        className="relative flex h-[100dvh] w-full flex-col bg-surface-card md:h-auto md:max-h-[80vh] md:max-w-2xl md:rounded-2xl md:border md:border-surface-border"
      >
        <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">Biblioteca de ejercicios</h3>
          <button
            type="button"
            aria-label="Cerrar biblioteca"
            onClick={onClose}
            className="rounded-lg p-1 text-ink-muted hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 border-b border-surface-border px-4 py-3">
          <input
            ref={searchRef}
            aria-label="Buscar en la biblioteca"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Busca por nombre, alias o tag"
            className="w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2 text-sm text-ink"
          />

          <div className="flex flex-wrap gap-2">
            {sessionType === 'squash' &&
              ([
                ['all', 'Todo'],
                ['squash_drill', 'Drills squash'],
                ['strength_exercise', 'Fuerza'],
              ] as Array<[SourceFilter, string]>).map(([option, label]) => (
                <button
                  type="button"
                  key={option}
                  aria-pressed={sourceFilter === option}
                  onClick={() => {
                    setSourceFilter(option)
                    setCategoryFilter('all')
                  }}
                  className={chipClassName(sourceFilter === option)}
                >
                  {label}
                </button>
              ))}

            <button
              type="button"
              aria-pressed={categoryFilter === 'all'}
              onClick={() => setCategoryFilter('all')}
              className={chipClassName(categoryFilter === 'all')}
            >
              Todas las categorías
            </button>
            {categories.map((category) => (
              <button
                type="button"
                key={category}
                aria-pressed={categoryFilter === category}
                onClick={() => setCategoryFilter(category)}
                className={chipClassName(categoryFilter === category)}
              >
                {category}
              </button>
            ))}

            {(['all', 'low', 'moderate', 'high'] as IntensityFilter[]).map((option) => (
              <button
                type="button"
                key={option}
                aria-pressed={intensityFilter === option}
                onClick={() => setIntensityFilter(option)}
                className={chipClassName(intensityFilter === option)}
              >
                {option === 'all' ? 'Toda intensidad' : INTENSITY_LABELS[option]}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <span role="status" aria-live="polite" className="sr-only">
            {addedKey ? 'Ejercicio agregado a la sesión' : ''}
          </span>
          {entries.length === 0 && (
            <p className="py-6 text-center text-sm text-ink-muted">
              No hay resultados para esa búsqueda.
            </p>
          )}
          <ul className="space-y-2">
            {entries.map((entry) => {
              const key = `${entry.source}:${entry.libraryId}`

              return (
                <li
                  key={key}
                  data-testid="library-entry"
                  className="rounded-xl border border-surface-border bg-surface-raised p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{entry.name}</p>
                      <p className="text-xs text-ink-muted">
                        {entry.category} · {INTENSITY_LABELS[entry.intensity]}
                      </p>
                      <p
                        className="mt-1 text-xs text-ink-faint"
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {entry.description}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Agregar ${entry.name}`}
                      onClick={() => handleAdd(entry)}
                      className="shrink-0 rounded-full border border-brand px-3 py-1.5 text-xs font-medium text-brand"
                    >
                      {addedKey === key ? 'Agregado ✓' : 'Agregar'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}

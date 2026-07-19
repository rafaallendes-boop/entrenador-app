import { useId, useMemo, useState } from 'react'
import type { SessionType } from '../../types'
import {
  searchCatalog,
  type CatalogEntry,
} from '../../services/training/coachExerciseCatalog'

interface ExerciseNameInputProps {
  index: number
  value: string
  sessionType: SessionType
  onChangeText: (value: string) => void
  onSelectEntry: (entry: CatalogEntry) => void
}

const SOURCE_BADGE: Record<CatalogEntry['source'], string> = {
  squash_drill: 'Drill squash',
  strength_exercise: 'Fuerza',
}

export default function ExerciseNameInput({
  index,
  value,
  sessionType,
  onChangeText,
  onSelectEntry,
}: ExerciseNameInputProps) {
  const generatedId = useId()
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const suggestions = useMemo(() => (
    value.trim().length >= 2 ? searchCatalog(sessionType, value).slice(0, 6) : []
  ), [sessionType, value])
  const showList = open && suggestions.length > 0
  const listId = `exercise-suggestions-${generatedId}`
  const optionId = (position: number) => `${listId}-option-${position}`
  const activeIndex = Math.min(highlighted, Math.max(0, suggestions.length - 1))

  const select = (entry: CatalogEntry) => {
    onSelectEntry(entry)
    setOpen(false)
  }

  return (
    <div className="relative flex-1">
      <input
        role="combobox"
        aria-label={`Ejercicio ${index + 1}`}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? optionId(activeIndex) : undefined}
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          onChangeText(event.target.value)
          setOpen(true)
          setHighlighted(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false)
            return
          }
          if (!showList) return
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setHighlighted(Math.min(activeIndex + 1, suggestions.length - 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setHighlighted(Math.max(activeIndex - 1, 0))
          } else if (event.key === 'Enter') {
            event.preventDefault()
            const selected = suggestions[activeIndex]
            if (selected) select(selected)
          }
        }}
        className="w-full rounded-lg border bg-surface px-2.5 py-1.5"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-surface-border bg-surface-card shadow-lg"
        >
          {suggestions.map((entry, position) => (
            <li
              key={`${entry.source}:${entry.libraryId}`}
              id={optionId(position)}
              role="option"
              aria-selected={position === activeIndex}
              onMouseDown={(event) => {
                event.preventDefault()
                select(entry)
              }}
              className={`cursor-pointer px-3 py-2 text-sm ${position === activeIndex ? 'bg-surface-raised' : ''}`}
            >
              <span className="text-ink">{entry.name}</span>
              <span className="ml-2 text-xs text-ink-muted">
                {SOURCE_BADGE[entry.source]} · {entry.category}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

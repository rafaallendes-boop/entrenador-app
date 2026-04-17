import type { ReactNode } from 'react'

interface OnboardingChoiceButtonProps {
  label: string
  description?: string
  leading?: ReactNode
  trailing?: ReactNode
  selected: boolean
  onClick: () => void
}

export default function OnboardingChoiceButton({
  label,
  description,
  leading,
  trailing,
  selected,
  onClick,
}: OnboardingChoiceButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="group relative flex w-full items-start gap-3 rounded-xl px-4 py-3.5 text-left transition-all duration-150 active:scale-[0.99]"
      style={{
        background: selected ? 'rgba(255,77,0,0.10)' : 'rgba(255,255,255,0.04)',
        border: selected ? '1px solid rgba(255,77,0,0.30)' : '1px solid rgba(255,255,255,0.09)',
        boxShadow: selected ? '0 0 24px -8px rgba(255,77,0,0.38)' : 'none',
      }}
    >
      {/* Left accent bar — shown when selected */}
      {selected && (
        <span
          className="absolute inset-y-0 left-0 rounded-l-xl"
          style={{
            width: '3px',
            background: 'linear-gradient(180deg, #ff7a33, #ff4d00)',
          }}
        />
      )}

      {/* Leading emoji / icon container */}
      {leading != null && (
        <span
          className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-lg leading-none transition-colors"
          style={{
            background: selected ? 'rgba(255,77,0,0.18)' : 'rgba(255,255,255,0.06)',
          }}
        >
          {leading}
        </span>
      )}

      {/* Text content */}
      <span className="min-w-0 flex-1">
        <span
          className={`block text-sm font-semibold transition-colors ${
            selected ? 'text-ink' : 'text-ink-muted group-hover:text-ink'
          }`}
        >
          {label}
        </span>
        {description && (
          <span className="mt-1 block text-xs leading-relaxed text-ink-faint">{description}</span>
        )}
      </span>

      {/* Trailing badge */}
      {trailing != null && (
        <span
          className="mt-0.5 flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em]"
          style={{
            background: 'rgba(255,77,0,0.15)',
            color: '#ff7a33',
          }}
        >
          {trailing}
        </span>
      )}
    </button>
  )
}

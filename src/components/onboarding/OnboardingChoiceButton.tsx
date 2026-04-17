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
      className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
        selected
          ? 'border-brand/25 bg-brand/10 text-ink shadow-glow-sm'
          : 'border-surface-soft/70 bg-surface-panel text-ink-muted hover:border-brand/30 hover:bg-surface-raised'
      }`}
    >
      {leading && <span className="mt-0.5 text-xl leading-none">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-semibold ${selected ? 'text-ink' : 'text-ink'}`}>{label}</span>
        {description && <span className="mt-1 block text-xs leading-relaxed text-ink-muted">{description}</span>}
      </span>
      {trailing && <span className="mt-0.5 flex-shrink-0 text-xs font-medium">{trailing}</span>}
    </button>
  )
}

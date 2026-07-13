interface CoachWorkspacePlaceholderPanelProps {
  title: string
  description: string
}

export default function CoachWorkspacePlaceholderPanel({ title, description }: CoachWorkspacePlaceholderPanelProps) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 px-4 py-8 text-center">
      <p className="font-display text-sm font-semibold text-ink">{title}</p>
      <p className="mt-2 text-xs text-ink-muted">{description}</p>
    </div>
  )
}

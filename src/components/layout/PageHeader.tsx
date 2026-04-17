import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'

interface PageHeaderProps {
  title: string
  subtitle?: string
  backTo?: string
  action?: React.ReactNode
}

export default function PageHeader({ title, subtitle, backTo, action }: PageHeaderProps) {
  const navigate = useNavigate()

  return (
    <div className="px-4 pt-12 pb-4 md:px-6">
      <div className="flex items-start gap-3 md:items-center">
        {backTo && (
          <button
            onClick={() => navigate(backTo)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-surface-soft/70 bg-surface-panel text-ink-muted transition-colors hover:border-brand/20 hover:text-ink"
          >
            <ChevronLeft size={20} />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl font-semibold leading-tight text-ink md:text-2xl">{title}</h1>
          {subtitle && <p className="text-sm text-ink-muted mt-0.5">{subtitle}</p>}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
    </div>
  )
}

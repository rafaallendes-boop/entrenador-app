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
            className="w-9 h-9 flex items-center justify-center rounded-full bg-surface-raised text-ink-muted hover:text-ink transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-ink leading-tight md:text-2xl">{title}</h1>
          {subtitle && <p className="text-sm text-ink-muted mt-0.5">{subtitle}</p>}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
    </div>
  )
}

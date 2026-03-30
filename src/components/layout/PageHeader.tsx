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
    <div className="flex items-center gap-3 px-4 pt-12 pb-4">
      {backTo && (
        <button
          onClick={() => navigate(backTo)}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-surface-raised text-ink-muted hover:text-ink transition-colors"
        >
          <ChevronLeft size={20} />
        </button>
      )}
      <div className="flex-1">
        <h1 className="text-xl font-semibold text-ink leading-tight">{title}</h1>
        {subtitle && <p className="text-sm text-ink-muted mt-0.5">{subtitle}</p>}
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}

import { MessageCircle, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '../../constants/routes'

interface CoachMessageCardProps {
  message: string
}

export default function CoachMessageCard({ message }: CoachMessageCardProps) {
  const navigate = useNavigate()

  return (
    <button
      onClick={() => navigate(ROUTES.CHAT)}
      className="w-full text-left bg-brand/10 border border-brand/25 rounded-card p-4 flex gap-3 items-start hover:bg-brand/15 transition-colors active:scale-[0.98] md:p-5"
    >
      <div className="w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center flex-shrink-0 mt-0.5">
        <MessageCircle size={16} className="text-brand-light" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3 mb-1">
          <span className="text-xs font-semibold text-brand-light uppercase tracking-wider">Coach</span>
          <ChevronRight size={14} className="text-ink-faint flex-shrink-0" />
        </div>
        <p className="text-sm text-ink leading-relaxed">{message}</p>
      </div>
    </button>
  )
}

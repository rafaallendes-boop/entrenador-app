import type { ChatMessage } from '../../types'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { MessageCircle, Zap } from 'lucide-react'

const PROVIDER_LABEL: Record<string, string> = {
  claude: 'Claude',
  gemini: 'Gemini',
  openai: 'GPT',
  mock: '',
}

interface ChatBubbleProps {
  message: ChatMessage
  hasProposal?: boolean
  onViewProposal?: () => void
}

export default function ChatBubble({ message, hasProposal, onViewProposal }: ChatBubbleProps) {
  const isCoach = message.role === 'coach'
  const time = format(new Date(message.timestamp), 'HH:mm', { locale: es })
  const providerLabel = message.provider ? PROVIDER_LABEL[message.provider] : ''

  return (
    <div className={`flex gap-2 ${isCoach ? 'items-start' : 'items-start flex-row-reverse'}`}>
      {isCoach && (
        <div className="w-7 h-7 rounded-full bg-brand/20 flex items-center justify-center flex-shrink-0 mt-1">
          <MessageCircle size={14} className="text-brand-light" />
        </div>
      )}

      <div className={`max-w-[80%] ${isCoach ? '' : 'items-end flex flex-col'}`}>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isCoach
            ? 'bg-surface-card border border-surface-border text-ink rounded-tl-sm'
            : 'bg-brand text-white rounded-tr-sm'
        }`}>
          {message.content}
        </div>

        <div className="flex items-center gap-2 mt-1 px-1">
          <span className="text-[11px] text-ink-faint">{time}</span>
          {providerLabel && (
            <span className="text-[10px] text-ink-faint/60 font-medium">{providerLabel}</span>
          )}
          {hasProposal && onViewProposal && (
            <button
              onClick={onViewProposal}
              className="flex items-center gap-1 text-[11px] text-amber-400 font-medium hover:text-amber-300 transition-colors"
            >
              <Zap size={10} />
              Ver propuesta
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

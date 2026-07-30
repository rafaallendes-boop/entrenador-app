import type { ChatMessage } from '../../types'
import { format, isSameYear, isToday, isYesterday } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertTriangle, MessageCircle, ThumbsDown, ThumbsUp, Zap } from 'lucide-react'
import { useState } from 'react'
import ChatMarkdown from './ChatMarkdown'

interface ChatBubbleProps {
  message: ChatMessage
  hasProposal?: boolean
  onViewProposal?: () => void
  onRate?: (rating: -1 | 1) => void
}

export default function ChatBubble({ message, hasProposal, onViewProposal, onRate }: ChatBubbleProps) {
  const isCoach = message.role === 'coach'
  const time = formatMessageTimestamp(message.timestamp)
  const likelyTruncated = message.contextMeta?.likelyTruncated === true
  const [rating, setRating] = useState<-1 | 1 | null>(null)

  const handleRate = (nextRating: -1 | 1) => {
    setRating(nextRating)
    onRate?.(nextRating)
  }

  return (
    <div className={`flex gap-2 ${isCoach ? 'items-start' : 'items-start flex-row-reverse'}`}>
      {isCoach && (
        <div className="mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-forge-cyan/20 bg-forge-cyan/10 shadow-[0_0_24px_-10px_rgba(0,227,253,0.6)]">
          <MessageCircle size={14} className="text-forge-cyan" />
        </div>
      )}

      <div className={`max-w-[88%] md:max-w-[80%] ${isCoach ? '' : 'items-end flex flex-col'}`}>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isCoach
            ? 'rounded-tl-sm border border-surface-soft/70 bg-[linear-gradient(145deg,rgba(26,26,26,0.96),rgba(14,14,14,0.98))] text-ink shadow-panel'
            : 'rounded-tr-sm border border-brand/25 bg-[linear-gradient(145deg,rgba(255,77,0,0.22),rgba(40,10,0,0.96))] text-white shadow-[0_20px_50px_-32px_rgba(255,77,0,0.4)]'
        }`}>
          {isCoach
            ? <ChatMarkdown text={message.content} />
            : <p className="whitespace-pre-wrap break-words font-medium">{message.content}</p>
          }
        </div>

        <div className="flex items-center gap-x-2 gap-y-1 mt-1 px-1 flex-wrap">
          <span className="text-[11px] text-ink-faint">{time}</span>
          {hasProposal && onViewProposal && (
            <button
              onClick={onViewProposal}
              className="flex items-center gap-1 text-[11px] font-medium text-forge-ember transition-colors hover:text-[#fff4c9]"
            >
              <Zap size={10} />
              Ver propuesta
            </button>
          )}
          {likelyTruncated && (
            <span
              className="flex items-center gap-1 text-[11px] font-medium text-amber-300"
              title="La respuesta llegó incompleta incluso después del reintento automático."
            >
              <AlertTriangle size={10} />
              Respuesta incompleta
            </span>
          )}
          {isCoach && onRate && (
            <div className="ml-1 flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleRate(1)}
                title="Respuesta útil"
                className={`rounded-md p-1 transition-colors ${
                  rating === 1 ? 'bg-emerald-500/15 text-emerald-300' : 'text-ink-faint hover:bg-surface-raised hover:text-emerald-300'
                }`}
              >
                <ThumbsUp size={11} />
              </button>
              <button
                type="button"
                onClick={() => handleRate(-1)}
                title="Respuesta poco útil"
                className={`rounded-md p-1 transition-colors ${
                  rating === -1 ? 'bg-rose-500/15 text-rose-300' : 'text-ink-faint hover:bg-surface-raised hover:text-rose-300'
                }`}
              >
                <ThumbsDown size={11} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function formatMessageTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  const time = format(date, 'HH:mm', { locale: es })
  if (isToday(date)) return time
  if (isYesterday(date)) return `ayer ${time}`
  const day = isSameYear(date, new Date())
    ? format(date, 'd MMM', { locale: es })
    : format(date, 'd MMM yyyy', { locale: es })
  return `${day} ${time}`
}

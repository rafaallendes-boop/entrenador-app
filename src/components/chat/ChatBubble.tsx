import type React from 'react'
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

/** Minimal markdown renderer: bold, italic, bullet lists, numbered lists, paragraphs. */
function MarkdownContent({ text }: { text: string }) {
  const blocks = text.split(/\n\n+/)

  return (
    <div className="space-y-2">
      {blocks.map((block, bi) => {
        const lines = block.split('\n')
        const isBulletList = lines.every(l => /^[*-]\s/.test(l.trim()) || l.trim() === '')
        const isNumList = lines.every(l => /^\d+\.\s/.test(l.trim()) || l.trim() === '')

        if (isBulletList && lines.some(l => /^[*-]\s/.test(l.trim()))) {
          return (
            <ul key={bi} className="list-disc list-inside space-y-0.5">
              {lines.filter(l => /^[*-]\s/.test(l.trim())).map((l, li) => (
                <li key={li}>{renderInline(l.replace(/^[*-]\s/, ''))}</li>
              ))}
            </ul>
          )
        }

        if (isNumList && lines.some(l => /^\d+\.\s/.test(l.trim()))) {
          return (
            <ol key={bi} className="list-decimal list-inside space-y-0.5">
              {lines.filter(l => /^\d+\.\s/.test(l.trim())).map((l, li) => (
                <li key={li}>{renderInline(l.replace(/^\d+\.\s/, ''))}</li>
              ))}
            </ol>
          )
        }

        return (
          <p key={bi} className="whitespace-pre-wrap break-words">
            {lines.map((line, li) => (
              <span key={li}>{renderInline(line)}{li < lines.length - 1 ? '\n' : ''}</span>
            ))}
          </p>
        )
      })}
    </div>
  )
}

function renderInline(text: string): React.ReactNode {
  // Split on **bold** and *italic* patterns
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    return part
  })
}

export default function ChatBubble({ message, hasProposal, onViewProposal }: ChatBubbleProps) {
  const isCoach = message.role === 'coach'
  const time = format(new Date(message.timestamp), 'HH:mm', { locale: es })
  const providerLabel = message.provider ? PROVIDER_LABEL[message.provider] : ''

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
            ? <MarkdownContent text={message.content} />
            : <p className="whitespace-pre-wrap break-words font-medium">{message.content}</p>
          }
        </div>

        <div className="flex items-center gap-x-2 gap-y-1 mt-1 px-1 flex-wrap">
          <span className="text-[11px] text-ink-faint">{time}</span>
          {providerLabel && (
            <span className="text-[10px] text-ink-faint/60 font-medium">{providerLabel}</span>
          )}
          {hasProposal && onViewProposal && (
            <button
              onClick={onViewProposal}
              className="flex items-center gap-1 text-[11px] font-medium text-forge-ember transition-colors hover:text-[#fff4c9]"
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

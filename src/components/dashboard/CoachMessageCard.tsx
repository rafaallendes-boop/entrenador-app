import type React from 'react'
import { MessageCircle, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '../../constants/routes'

interface CoachMessageCardProps {
  message: string
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={index}>{part.slice(1, -1)}</em>
    }
    return part
  })
}

function MarkdownPreview({ text }: { text: string }) {
  const blocks = text.split(/\n\n+/)

  return (
    <div className="space-y-2">
      {blocks.map((block, blockIndex) => {
        const lines = block.split('\n')
        const isBulletList = lines.every((line) => /^[*-]\s/.test(line.trim()) || line.trim() === '')
        const isNumberedList = lines.every((line) => /^\d+\.\s/.test(line.trim()) || line.trim() === '')

        if (isBulletList && lines.some((line) => /^[*-]\s/.test(line.trim()))) {
          return (
            <ul key={blockIndex} className="list-disc space-y-1 pl-4">
              {lines
                .filter((line) => /^[*-]\s/.test(line.trim()))
                .map((line, lineIndex) => (
                  <li key={lineIndex}>{renderInline(line.replace(/^[*-]\s/, ''))}</li>
                ))}
            </ul>
          )
        }

        if (isNumberedList && lines.some((line) => /^\d+\.\s/.test(line.trim()))) {
          return (
            <ol key={blockIndex} className="list-decimal space-y-1 pl-4">
              {lines
                .filter((line) => /^\d+\.\s/.test(line.trim()))
                .map((line, lineIndex) => (
                  <li key={lineIndex}>{renderInline(line.replace(/^\d+\.\s/, ''))}</li>
                ))}
            </ol>
          )
        }

        return (
          <p key={blockIndex} className="whitespace-pre-wrap break-words">
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {renderInline(line)}
                {lineIndex < lines.length - 1 ? '\n' : ''}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
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
        <div className="text-sm text-ink leading-relaxed">
          <MarkdownPreview text={message} />
        </div>
      </div>
    </button>
  )
}

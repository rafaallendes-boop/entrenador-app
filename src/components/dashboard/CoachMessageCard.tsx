import type React from 'react'
import { MessageCircle, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '../../constants/routes'
import Card from '../ui/Card'

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
    <button onClick={() => navigate(ROUTES.CHAT)} className="w-full text-left active:scale-[0.99]">
      <Card
        variant="hud"
        accent="cyan"
        className="overflow-hidden bg-[linear-gradient(145deg,rgba(38,38,38,0.92),rgba(14,14,14,0.98))] p-4 transition-transform duration-200 hover:-translate-y-0.5 md:p-5"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="inline-flex items-center rounded-full border border-forge-cyan/20 bg-forge-cyan/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-forge-cyan">
            Canal coach
          </span>
          <ChevronRight size={14} className="flex-shrink-0 text-ink-faint" />
        </div>

        <div className="flex gap-3 items-start">
          <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-forge-cyan/20 bg-forge-cyan/10 shadow-[0_0_24px_-10px_rgba(0,227,253,0.65)]">
            <MessageCircle size={17} className="text-forge-cyan" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-faint">
              Insight del día
            </p>
            <div className="text-sm leading-relaxed text-ink">
              <MarkdownPreview text={message} />
            </div>
          </div>
        </div>
      </Card>
    </button>
  )
}

import type React from 'react'
import { normalizeCoachMarkdown } from './markdown'

/** Minimal markdown renderer: bold, italic, bullet lists, numbered lists, paragraphs. */
export default function ChatMarkdown({ text }: { text: string }) {
  const blocks = normalizeCoachMarkdown(text).split(/\n\n+/)

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

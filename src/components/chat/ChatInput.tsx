import { useState, type KeyboardEvent } from 'react'
import { Send } from 'lucide-react'

interface ChatInputProps {
  onSend: (message: string) => void
  disabled?: boolean
}

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState('')

  const handleSend = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
  }

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex gap-2 items-end bg-surface-raised rounded-2xl border border-surface-border p-2">
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Escríbele al coach..."
        rows={1}
        disabled={disabled}
        className="flex-1 bg-transparent text-sm text-ink placeholder-ink-faint resize-none focus:outline-none py-1.5 px-2 max-h-32"
        style={{ fieldSizing: 'content' } as React.CSSProperties}
      />
      <button
        onClick={handleSend}
        disabled={!value.trim() || disabled}
        className="w-9 h-9 rounded-xl bg-brand flex items-center justify-center text-white disabled:opacity-30 disabled:cursor-not-allowed transition-opacity flex-shrink-0"
      >
        <Send size={16} />
      </button>
    </div>
  )
}

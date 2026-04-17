import { useState, type KeyboardEvent } from 'react'
import { Send } from 'lucide-react'

interface ChatInputProps {
  onSend: (message: string) => void
  disabled?: boolean
  initialValue?: string
}

export default function ChatInput({ onSend, disabled, initialValue = '' }: ChatInputProps) {
  const [value, setValue] = useState(initialValue)

  const handleSend = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
  }

  const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="hud-border flex items-end gap-2 rounded-2xl border border-white/5 bg-[linear-gradient(145deg,rgba(32,32,32,0.94),rgba(14,14,14,0.98))] p-2 shadow-panel [--hud-accent-start:rgba(0,227,253,0.28)] [--hud-accent-end:rgba(0,115,128,0.18)]">
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKey}
        placeholder="Escríbele al coach..."
        rows={1}
        disabled={disabled}
        className="flex-1 bg-transparent text-sm text-ink placeholder-ink-faint resize-none focus:outline-none py-1.5 px-2 max-h-32 min-h-[42px]"
        style={{ fieldSizing: 'content' } as React.CSSProperties}
      />
      <button
        onClick={handleSend}
        disabled={!value.trim() || disabled}
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-forge-cyan text-[#003a42] transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Send size={16} />
      </button>
    </div>
  )
}

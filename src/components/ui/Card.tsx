import { type ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  onClick?: () => void
  variant?: 'default' | 'panel' | 'hud'
  accent?: 'default' | 'lime' | 'cyan' | 'ember'
}

const VARIANT_STYLES = {
  default: 'border border-surface-border bg-surface-card shadow-card',
  panel: 'border border-surface-soft/70 bg-surface-panel shadow-panel backdrop-blur-sm',
  hud: 'hud-border border border-white/5 bg-surface-glass shadow-hud backdrop-blur-xl',
} as const

const ACCENT_STYLES = {
  default: '',
  lime: '[--hud-accent-start:rgba(255,77,0,0.32)] [--hud-accent-end:rgba(255,150,50,0.14)]',
  cyan: '[--hud-accent-start:rgba(0,227,253,0.28)] [--hud-accent-end:rgba(0,180,200,0.12)]',
  ember: '[--hud-accent-start:rgba(255,235,156,0.28)] [--hud-accent-end:rgba(255,150,50,0.16)]',
} as const

export default function Card({
  children,
  className = '',
  onClick,
  variant = 'default',
  accent = 'default',
}: CardProps) {
  return (
    <div
      className={`rounded-card p-5 ${VARIANT_STYLES[variant]} ${variant === 'hud' ? ACCENT_STYLES[accent] : ''} ${
        onClick ? 'cursor-pointer transition-colors hover:border-brand/30 hover:bg-surface-raised' : ''
      } ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

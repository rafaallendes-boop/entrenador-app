import { type ReactNode } from 'react'

type Variant = 'default' | 'success' | 'warning' | 'danger' | 'muted'

interface BadgeProps {
  children: ReactNode
  variant?: Variant
  className?: string
}

const variantClasses: Record<Variant, string> = {
  default: 'bg-brand/15 text-brand-light',
  success: 'bg-emerald-500/15 text-emerald-400',
  warning: 'bg-yellow-500/15 text-yellow-400',
  danger:  'bg-red-500/15 text-red-400',
  muted:   'bg-surface-raised text-ink-muted',
}

export default function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-pill text-xs font-medium ${variantClasses[variant]} ${className}`}>
      {children}
    </span>
  )
}

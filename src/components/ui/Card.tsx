import { type ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  onClick?: () => void
}

export default function Card({ children, className = '', onClick }: CardProps) {
  return (
    <div
      className={`rounded-card border border-surface-border bg-surface-card p-5 shadow-card ${
        onClick ? 'cursor-pointer transition-colors hover:border-brand/30 hover:bg-surface-raised' : ''
      } ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

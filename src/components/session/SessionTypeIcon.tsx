import {
  Zap, Wind, Dumbbell, Orbit, Heart, Apple, Bike, type LucideProps
} from 'lucide-react'
import { SESSION_TYPE_CONFIG } from '../../constants/sessionTypes'
import type { SessionType } from '../../types'

const iconMap: Record<string, React.ComponentType<LucideProps>> = {
  Zap, Wind, Dumbbell, Orbit, Heart, Apple, Bike,
}

interface SessionTypeIconProps {
  type: SessionType
  size?: number
  className?: string
}

export default function SessionTypeIcon({ type, size = 16, className = '' }: SessionTypeIconProps) {
  const config = SESSION_TYPE_CONFIG[type]
  const Icon = iconMap[config.icon] ?? Zap
  return (
    <div className={`w-8 h-8 flex items-center justify-center rounded-lg ${config.bgClass} ${className}`}>
      <Icon size={size} className={config.textClass} />
    </div>
  )
}

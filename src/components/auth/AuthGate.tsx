import type { ReactNode } from 'react'
import { useAuthStore } from '../../store/useAuthStore'
import LoginScreen from './LoginScreen'

interface AuthGateProps {
  children: ReactNode
}

export default function AuthGate({ children }: AuthGateProps) {
  const user = useAuthStore(s => s.user)
  const isLoading = useAuthStore(s => s.isLoading)

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!user) {
    return <LoginScreen />
  }

  return <>{children}</>
}

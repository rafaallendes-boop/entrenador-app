import { lazy, Suspense, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'

const LandingPage = lazy(() => import('../../pages/LandingPage'))
const FeaturesPage = lazy(() => import('../../pages/FeaturesPage'))
const PricingPage = lazy(() => import('../../pages/PricingPage'))

interface AuthGateProps {
  children: ReactNode
}

function AuthLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="rounded-card border border-surface-border bg-surface-card px-8 py-10 text-center shadow-card">
        <div className="mx-auto h-8 w-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
        <p className="mt-4 text-sm font-medium text-ink">Preparando tu sesión</p>
        <p className="mt-1 text-xs text-ink-muted">Estamos restaurando tu acceso y sincronización.</p>
      </div>
    </div>
  )
}

export default function AuthGate({ children }: AuthGateProps) {
  const user = useAuthStore(s => s.user)
  const isLoading = useAuthStore(s => s.isLoading)
  const { pathname } = useLocation()

  if (isLoading) {
    return <AuthLoading />
  }

  if (!user) {
    if (pathname === '/features') {
      return <Suspense fallback={<AuthLoading />}><FeaturesPage /></Suspense>
    }
    if (pathname === '/pricing') {
      return <Suspense fallback={<AuthLoading />}><PricingPage /></Suspense>
    }
    return (
      <Suspense fallback={<AuthLoading />}>
        <LandingPage />
      </Suspense>
    )
  }

  return <>{children}</>
}

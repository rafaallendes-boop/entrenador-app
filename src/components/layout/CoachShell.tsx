import { Link, Outlet } from 'react-router-dom'
import { ROUTES } from '../../constants/routes'
import { useAuthStore } from '../../store/useAuthStore'

/** El workspace no depende del perfil ni de la navegación deportiva. */
export default function CoachShell() {
  const signOut = useAuthStore(state => state.signOut)
  return (
    <div className="min-h-screen bg-surface w-full max-w-5xl mx-auto md:px-4 lg:px-6">
      <nav aria-label="Cuenta de coach" className="flex items-center gap-4 border-b border-white/10 px-4 py-4 text-sm text-ink-muted">
        <Link to={ROUTES.COACH} className="mr-auto font-semibold text-ink">Workspace de coach</Link>
        <Link to={ROUTES.SETTINGS}>Configuración</Link>
        <button type="button" onClick={() => void signOut()}>Cerrar sesión</button>
      </nav>
      <main><Outlet /></main>
    </div>
  )
}

import { isSupabaseConfigured } from '../../services/auth'
import { useAuthStore } from '../../store/useAuthStore'

export default function LoginScreen() {
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle)
  const isAuthAvailable = isSupabaseConfigured

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-8 sm:px-6 lg:px-10">
      <div className="w-full max-w-6xl">
        <div className="rounded-card border border-surface-border bg-surface-card p-6 shadow-card md:p-8 xl:p-10">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.8fr)] lg:gap-10 xl:gap-14">
            <div className="min-w-0">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/15 shadow-glow-sm lg:h-20 lg:w-20">
                <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8 text-brand-light" stroke="currentColor" strokeWidth={2}>
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              <p className="font-display text-[11px] font-semibold uppercase tracking-widest text-ink-faint">
                Entrenador
              </p>
              <h1 className="mt-2 max-w-2xl font-display text-3xl font-bold tracking-tight text-ink md:text-4xl xl:text-5xl">
                Planifica, ajusta y sigue tu entrenamiento en un solo lugar
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted md:text-base">
                Inicia sesión para sincronizar tu perfil, tus semanas y el contexto del coach entre todos tus dispositivos.
              </p>

              <div className="mt-6 grid gap-3 md:grid-cols-3">
                {LOGIN_HIGHLIGHTS.map((item) => (
                  <div key={item.title} className="rounded-xl border border-surface-border bg-surface-raised p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink">{item.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-ink-muted">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="min-w-0 lg:flex lg:items-center">
              <div className="w-full rounded-2xl border border-surface-border bg-surface-raised p-5 md:p-6">
              <p className="text-sm font-semibold text-ink">Continúa con tu cuenta</p>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                Usamos tu sesión para guardar tus datos de entrenamiento de forma segura y restaurarlos cuando vuelvas a entrar.
              </p>

              <button
                onClick={() => void signInWithGoogle()}
                disabled={!isAuthAvailable}
                className="mt-5 flex w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-gray-800 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <GoogleIcon />
                Continuar con Google
              </button>

              {!isAuthAvailable ? (
                <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-left">
                  <p className="text-xs font-medium text-amber-300">Autenticación no disponible</p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-200">
                    Falta configurar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en tu entorno local.
                  </p>
                </div>
              ) : null}

              <p className="mt-4 text-xs leading-relaxed text-ink-faint">
                Tus datos se sincronizan de forma segura. Solo tú puedes verlos.
              </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const LOGIN_HIGHLIGHTS = [
  {
    title: 'Perfil',
    description: 'Recupera tu configuración del atleta y el contexto del coach.',
  },
  {
    title: 'Plan',
    description: 'Mantén tus semanas, objetivos y sesiones sincronizados.',
  },
  {
    title: 'Progreso',
    description: 'Sigue tu historial y tus ajustes desde cualquier dispositivo.',
  },
]

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

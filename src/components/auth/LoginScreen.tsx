import { isSupabaseConfigured } from '../../services/auth'
import { useAuthStore } from '../../store/useAuthStore'

export default function LoginScreen() {
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle)
  const isAuthAvailable = isSupabaseConfigured

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-12">
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0">
        <div
          className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/3"
          style={{
            width: '600px',
            height: '500px',
            background: 'radial-gradient(ellipse at center, rgba(255,77,0,0.12) 0%, transparent 65%)',
            filter: 'blur(40px)',
          }}
        />
        <div
          className="absolute bottom-0 right-1/4"
          style={{
            width: '300px',
            height: '300px',
            background: 'radial-gradient(circle, rgba(0,227,253,0.05) 0%, transparent 70%)',
            filter: 'blur(50px)',
          }}
        />
      </div>

      <div className="relative z-10 flex w-full max-w-[360px] flex-col items-center">
        {/* Logo mark */}
        <LogoMark />

        {/* Brand label */}
        <p
          className="mt-5 font-mono text-[9.5px] font-semibold uppercase text-ink-faint"
          style={{ letterSpacing: '0.42em' }}
        >
          RallyIQ AI
        </p>

        {/* Headline */}
        <div className="mt-8 text-center">
          <h1 className="font-display text-[2.4rem] font-bold leading-[1.07] tracking-tight text-ink">
            Entrena con
            <br />
            <span
              style={{
                background: 'linear-gradient(90deg, #ff4d00 0%, #ff7a33 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              precisión de élite.
            </span>
          </h1>
          <p className="mt-3.5 text-[13px] leading-relaxed text-ink-muted">
            RallyIQ AI para squash, running y fuerza. Tu plan semanal, carga y seguimiento en un solo lugar.
          </p>
        </div>

        {/* Feature pills */}
        <div className="mt-6 flex flex-wrap justify-center gap-1.5">
          {FEATURES.map((f) => (
            <span
              key={f}
              className="rounded-full px-2.5 py-[5px] text-[10.5px] font-medium text-ink-faint"
              style={{
                border: '1px solid rgba(255,255,255,0.07)',
                background: 'rgba(255,255,255,0.03)',
                letterSpacing: '0.01em',
              }}
            >
              {f}
            </span>
          ))}
        </div>

        {/* Separator */}
        <div
          className="mt-9 h-px w-full"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1) 40%, rgba(255,255,255,0.1) 60%, transparent)',
          }}
        />

        {/* Sign-in panel */}
        <div className="mt-8 w-full">
          <div
            className="rounded-2xl p-px"
            style={{
              background: 'linear-gradient(135deg, rgba(255,77,0,0.4) 0%, rgba(255,255,255,0.05) 45%, rgba(255,77,0,0.15) 100%)',
            }}
          >
            <div
              className="rounded-[15px] p-5"
              style={{ background: 'rgba(14,12,12,0.97)' }}
            >
              <p className="text-center text-[12.5px] font-semibold tracking-wide text-ink">
                Accede a tu cuenta
              </p>

              <button
                onClick={() => void signInWithGoogle()}
                disabled={!isAuthAvailable}
                className="mt-4 flex w-full items-center justify-center gap-3 rounded-xl px-5 py-3.5 text-[13px] font-semibold text-ink transition-all disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.16)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
                }}
              >
                <GoogleIcon />
                Continuar con Google
              </button>

              {!isAuthAvailable && (
                <div
                  className="mt-3 rounded-xl px-3 py-2.5"
                  style={{
                    border: '1px solid rgba(251,191,36,0.18)',
                    background: 'rgba(251,191,36,0.06)',
                  }}
                >
                  <p className="text-[11px] font-medium text-amber-300">Auth no disponible en este entorno</p>
                  <p className="mt-0.5 text-[10.5px] leading-relaxed text-amber-200/60">
                    Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.
                  </p>
                </div>
              )}

              <p className="mt-4 text-center text-[10.5px] text-ink-faint" style={{ letterSpacing: '0.02em' }}>
                Datos cifrados · Solo tú los ves
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function LogoMark() {
  return (
    <div className="relative flex items-center justify-center">
      {/* Outer ambient glow pulse */}
      <div
        className="absolute rounded-[28px]"
        style={{
          inset: '-12px',
          background: 'radial-gradient(circle, rgba(255,77,0,0.18) 0%, transparent 70%)',
          filter: 'blur(16px)',
          animation: 'logo-glow 3s ease-in-out infinite',
        }}
      />

      {/* Icon shell */}
      <div
        className="relative flex h-[88px] w-[88px] items-center justify-center overflow-hidden"
        style={{
          borderRadius: '24px',
          background: 'linear-gradient(145deg, #1d1714 0%, #0f0b09 100%)',
          boxShadow:
            '0 0 0 1px rgba(255,77,0,0.22), 0 12px 40px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.07)',
        }}
      >
        {/* Radial spotlight inside icon */}
        <div
          className="absolute inset-0"
          style={{
            borderRadius: '24px',
            background:
              'radial-gradient(ellipse at 50% 20%, rgba(255,77,0,0.14) 0%, transparent 60%)',
          }}
        />

        {/* Fine grid overlay */}
        <div
          className="absolute inset-0"
          style={{
            borderRadius: '24px',
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
            backgroundSize: '10px 10px',
          }}
        />

        {/* Lightning bolt SVG */}
        <svg
          viewBox="0 0 32 32"
          className="relative h-11 w-11"
          fill="none"
          aria-hidden
        >
          {/* Drop shadow layer */}
          <path
            d="M19 2L7 18H15L12 30L24 14H16L19 2Z"
            fill="rgba(0,0,0,0.5)"
            transform="translate(0.4, 0.8)"
          />
          {/* Main bolt — solid polygon */}
          <path
            d="M19 2L7 18H15L12 30L24 14H16L19 2Z"
            fill="#ff4d00"
            style={{ filter: 'drop-shadow(0 0 5px rgba(255,77,0,0.7))' }}
          />
          {/* Highlight on upper tip */}
          <path
            d="M19 2L16 14H24L19 2Z"
            fill="rgba(255,140,70,0.65)"
          />
          {/* Edge shine — thin bright line on left face */}
          <path
            d="M19 2L7 18H9.5L19 4.5Z"
            fill="rgba(255,255,255,0.12)"
          />
        </svg>
      </div>

      <style>{`
        @keyframes logo-glow {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.06); }
        }
      `}</style>
    </div>
  )
}

const FEATURES = [
  'Planificación semanal',
  'RallyIQ AI',
  'ACWR y carga',
  'Multi-deporte',
  'Offline',
]

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden>
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}

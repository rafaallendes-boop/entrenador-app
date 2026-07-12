import { useEffect, useState } from 'react'
import { Activity, Gauge, Layers3, Trophy } from 'lucide-react'
import './NativeWelcomePreviewPage.css'

const BENEFITS = [
  {
    icon: Layers3,
    title: 'Todos tus deportes',
    detail: 'Una sola carga',
  },
  {
    icon: Gauge,
    title: 'Tu recuperación',
    detail: 'Ajustes inteligentes',
  },
  {
    icon: Trophy,
    title: 'Tus objetivos',
    detail: 'Preparación real',
  },
] as const

export default function NativeWelcomePreviewPage() {
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!notice) return
    const timeoutId = window.setTimeout(() => setNotice(null), 2400)
    return () => window.clearTimeout(timeoutId)
  }, [notice])

  const showPreviewNotice = () => {
    setNotice('Vista previa: el acceso se conectará en una siguiente iteración.')
  }

  return (
    <main className="native-welcome-shell">
      <div className="native-welcome-ambient" aria-hidden="true" />

      <section className="native-welcome-content" aria-labelledby="welcome-title">
        <header className="native-welcome-logo" aria-label="RallyIQ">
          RallyIQ
        </header>

        <div className="native-welcome-copy">
          <p className="native-welcome-kicker">Tu entrenador multideporte</p>
          <h1 id="welcome-title">
            Tu próximo objetivo
            <br />
            no se alcanza solo.
            <span>Se entrena.</span>
          </h1>
          <p className="native-welcome-support">
            RallyIQ organiza tu semana, entiende tu recuperación y te ayuda a rendir al máximo cuando importa.
          </p>
        </div>

        <SquashHeroVisual />

        <div className="native-welcome-progress" aria-label="Paso 1 de 3">
          <span className="is-active" />
          <span />
          <span />
        </div>

        <div className="native-welcome-actions">
          <button className="native-welcome-primary" type="button" onClick={showPreviewNotice}>
            <GoogleIcon />
            Comenzar con Google
          </button>
          <button className="native-welcome-secondary" type="button" onClick={showPreviewNotice}>
            Ya tengo una cuenta
          </button>
        </div>

        <p className="native-welcome-legal">
          Al continuar aceptas los <button type="button" onClick={showPreviewNotice}>Términos</button> y la{' '}
          <button type="button" onClick={showPreviewNotice}>Política de privacidad</button>.
        </p>

        <div className="native-welcome-home-indicator" aria-hidden="true" />
      </section>

      <div className={`native-welcome-notice${notice ? ' is-visible' : ''}`} role="status" aria-live="polite">
        <Activity size={15} aria-hidden="true" />
        {notice}
      </div>
    </main>
  )
}

function SquashHeroVisual() {
  const [imageAvailable, setImageAvailable] = useState(true)

  return (
    <div
      className={`squash-hero${imageAvailable ? '' : ' uses-fallback'}`}
      role="img"
      aria-label="Escena cinematográfica de squash sobre una cancha oscura"
    >
      {imageAvailable && (
        <img
          className="squash-hero-image"
          src="/images/ios-welcome-squash.webp"
          alt=""
          loading="eager"
          onError={() => setImageAvailable(false)}
        />
      )}
      <div className="squash-hero-fallback" aria-hidden="true">
        <span className="squash-player-blur" />
        <span className="squash-court-line" />
      </div>
      <div className="squash-hero-grade" aria-hidden="true" />

      <div className="squash-benefits">
        {BENEFITS.map(({ icon: Icon, title, detail }, index) => (
          <div className={`squash-benefit benefit-${index + 1}`} key={title}>
            <span className="squash-benefit-icon"><Icon size={17} strokeWidth={1.9} /></span>
            <span>
              <strong>{title}</strong>
              <small>{detail}</small>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="native-google-icon" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09A6.7 6.7 0 0 1 5.49 12c0-.73.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

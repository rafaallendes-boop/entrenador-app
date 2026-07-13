import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Activity, Gauge, Layers3, Target, Timer, TrendingUp, Trophy, type LucideIcon } from 'lucide-react'
import { isSupabaseConfigured } from '../services/auth'
import { useAuthStore } from '../store/useAuthStore'
import './NativeWelcomePreviewPage.css'

type WelcomeSlide = {
  id: 'squash' | 'cycling' | 'running'
  eyebrow: string
  title: readonly [string, string]
  accent: string
  support: string
  image: string
  imageAlt: string
  messages: readonly {
    icon: LucideIcon
    title: string
    detail: string
    tone: 'neutral' | 'cyan' | 'lime'
  }[]
}

const WELCOME_SLIDES: readonly WelcomeSlide[] = [
  {
    id: 'squash',
    eyebrow: 'Tu entrenador multideporte',
    title: ['Tu próximo objetivo', 'no se alcanza solo.'],
    accent: 'Se entrena.',
    support: 'RallyIQ organiza tu semana, entiende tu recuperación y te ayuda a rendir al máximo cuando importa.',
    image: '/images/ios-welcome-squash.webp',
    imageAlt: 'Pelota de squash en primer plano y un jugador preparándose en una cancha oscura',
    messages: [
      { icon: Target, title: 'Tu objetivo', detail: 'Preparación real', tone: 'neutral' },
      { icon: Activity, title: 'Técnica', detail: 'Drills + match-play', tone: 'neutral' },
      { icon: Trophy, title: 'Competición', detail: 'Taper sin improvisar', tone: 'lime' },
    ],
  },
  {
    id: 'cycling',
    eyebrow: 'Tu entrenador multideporte',
    title: ['Cinco deportes.', 'Un solo sistema.'],
    accent: 'Una sola carga.',
    support: 'RallyIQ unifica squash, running, fuerza, movilidad y ciclismo. No sumas apps: sumas claridad.',
    image: '/images/ios-welcome-cycling.webp',
    imageAlt: 'Ciclista entrenando con intensidad en un entorno oscuro',
    messages: [
      { icon: Layers3, title: '5 deportes', detail: 'Una sola semana', tone: 'neutral' },
      { icon: Gauge, title: 'Carga unificada', detail: 'ACWR + strain', tone: 'cyan' },
      { icon: Activity, title: 'Cada disciplina', detail: 'Sus propias métricas', tone: 'neutral' },
    ],
  },
  {
    id: 'running',
    eyebrow: 'Resistencia pura',
    title: ['Cada kilómetro', 'tiene un propósito.'],
    accent: 'Y una carga.',
    support: 'Series, tempo y progresión aeróbica con métricas de running y una semana que protege tu recuperación.',
    image: '/images/ios-welcome-running.webp',
    imageAlt: 'Atleta preparado en el bloque de salida de una pista nocturna',
    messages: [
      { icon: Timer, title: 'Series + tempo', detail: 'Ritmo con intención', tone: 'neutral' },
      { icon: TrendingUp, title: 'Progresión', detail: 'Aeróbica visible', tone: 'cyan' },
      { icon: Gauge, title: 'Carga vigilada', detail: 'Sin deuda innecesaria', tone: 'neutral' },
    ],
  },
] as const

const SWIPE_THRESHOLD_PX = 42

export default function NativeWelcomePreviewPage() {
  const signInWithGoogle = useAuthStore((state) => state.signInWithGoogle)
  const [activeIndex, setActiveIndex] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [authPending, setAuthPending] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const pointerStartX = useRef<number | null>(null)
  const activeSlide = WELCOME_SLIDES[activeIndex]

  useEffect(() => {
    WELCOME_SLIDES.forEach(({ image }) => {
      const preload = new Image()
      preload.src = image
    })
  }, [])

  useEffect(() => {
    if (!notice) return
    const timeoutId = window.setTimeout(() => setNotice(null), 2400)
    return () => window.clearTimeout(timeoutId)
  }, [notice])

  const handleSignIn = async () => {
    if (authPending) return
    setAuthError(null)
    if (!isSupabaseConfigured) {
      setAuthError('El acceso no está disponible en este entorno.')
      return
    }

    setAuthPending(true)
    try {
      await signInWithGoogle()
    } catch (error) {
      console.error('[native-welcome] sign-in failed', error)
      setAuthError('No pudimos abrir el acceso con Google. Intenta nuevamente.')
    } finally {
      setAuthPending(false)
    }
  }

  const showLegalPreviewNotice = () => {
    setNotice('Los enlaces legales se conectarán antes de publicar esta pantalla.')
  }

  const showSlide = (index: number) => {
    const normalizedIndex = (index + WELCOME_SLIDES.length) % WELCOME_SLIDES.length
    setActiveIndex(normalizedIndex)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    pointerStartX.current = event.clientX
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerStartX.current == null) return
    const deltaX = event.clientX - pointerStartX.current
    pointerStartX.current = null
    if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX) return
    showSlide(activeIndex + (deltaX < 0 ? 1 : -1))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      showSlide(activeIndex + 1)
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      showSlide(activeIndex - 1)
    }
  }

  return (
    <main className="native-welcome-shell">
      <div className="native-welcome-ambient" aria-hidden="true" />

      <section className="native-welcome-content" aria-labelledby={`welcome-title-${activeSlide.id}`}>
        <header className="native-welcome-logo" aria-label="RallyIQ">
          RallyIQ
        </header>

        <div
          className="native-onboarding-carousel"
          role="region"
          aria-roledescription="carrusel"
          aria-label="Presentación de RallyIQ"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => { pointerStartX.current = null }}
        >
          <div className="native-welcome-copy" key={`copy-${activeSlide.id}`} aria-live="polite">
            <p className="native-welcome-kicker">{activeSlide.eyebrow}</p>
            <h1 id={`welcome-title-${activeSlide.id}`}>
              {activeSlide.title[0]}
              <br />
              {activeSlide.title[1]}
              <span>{activeSlide.accent}</span>
            </h1>
            <p className="native-welcome-support">{activeSlide.support}</p>
          </div>

          <SportHeroVisual slide={activeSlide} key={`visual-${activeSlide.id}`} />
        </div>

        <div className="native-welcome-progress" aria-label={`Paso ${activeIndex + 1} de ${WELCOME_SLIDES.length}`}>
          {WELCOME_SLIDES.map((slide, index) => (
            <button
              type="button"
              className={index === activeIndex ? 'is-active' : ''}
              key={slide.id}
              aria-label={`Mostrar pantalla ${index + 1}: ${slide.messages[0].title}`}
              aria-current={index === activeIndex ? 'step' : undefined}
              onClick={() => showSlide(index)}
            />
          ))}
        </div>

        <div className="native-welcome-actions">
          <button
            className="native-welcome-primary"
            type="button"
            disabled={authPending || !isSupabaseConfigured}
            aria-busy={authPending}
            onClick={() => void handleSignIn()}
          >
            {authPending ? <span className="native-auth-spinner" aria-hidden="true" /> : <GoogleIcon />}
            {authPending ? 'Abriendo Google…' : 'Comenzar con Google'}
          </button>
          <button
            className="native-welcome-secondary"
            type="button"
            disabled={authPending || !isSupabaseConfigured}
            onClick={() => void handleSignIn()}
          >
            Ya tengo una cuenta
          </button>
        </div>

        {authError && <p className="native-welcome-auth-error" role="alert">{authError}</p>}

        <p className="native-welcome-legal">
          Al continuar aceptas los <button type="button" onClick={showLegalPreviewNotice}>Términos</button> y la{' '}
          <button type="button" onClick={showLegalPreviewNotice}>Política de privacidad</button>.
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

function SportHeroVisual({ slide }: { slide: WelcomeSlide }) {
  const [imageAvailable, setImageAvailable] = useState(true)

  return (
    <div
      className={`native-onboarding-hero sport-${slide.id}${imageAvailable ? '' : ' uses-fallback'}`}
      role="img"
      aria-label={slide.imageAlt}
    >
      {imageAvailable && (
        <img
          className="native-onboarding-hero-image"
          src={slide.image}
          alt=""
          loading={slide.id === 'squash' ? 'eager' : 'lazy'}
          onError={() => setImageAvailable(false)}
        />
      )}
      <div className="native-onboarding-hero-fallback" aria-hidden="true" />
      <div className="native-onboarding-hero-grade" aria-hidden="true" />

      <div className="native-onboarding-messages">
        {slide.messages.map(({ icon: MessageIcon, title, detail, tone }) => (
          <div className={`native-onboarding-message tone-${tone}`} key={title}>
            <span className="native-onboarding-message-icon">
              <MessageIcon size={16} strokeWidth={1.85} />
            </span>
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

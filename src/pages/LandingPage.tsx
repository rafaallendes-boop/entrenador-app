import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { isSupabaseConfigured } from '../services/auth'
import { useAuthStore } from '../store/useAuthStore'

const BRAND = '#ff4d00'
const BRAND_LIGHT = '#ff7a33'
const FORGE_LIME = '#d1fc00'
const FORGE_CYAN = '#00e3fd'
const INK = '#f5f5f7'
const INK_MUTED = '#a0a0a5'
const INK_FAINT = '#6e6e73'
const SURFACE_BORDER = 'rgba(255,255,255,0.07)'

const FONT_DISPLAY = "'Lexend', 'Inter', system-ui, sans-serif"
const FONT_MONO = "'JetBrains Mono', 'Fira Mono', monospace"

const SPORTS = ['Squash', 'Running', 'Fuerza', 'Movilidad', 'Ciclismo']

export default function LandingPage() {
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle)
  const authAvailable = isSupabaseConfigured
  const [authError, setAuthError] = useState<string | null>(null)

  const handleSignIn = async () => {
    setAuthError(null)
    if (!authAvailable) {
      setAuthError('Auth no disponible. Configura Supabase para continuar.')
      return
    }
    try {
      await signInWithGoogle()
    } catch (err) {
      console.error('[landing] sign-in failed', err)
      setAuthError('No pudimos iniciar sesión. Intenta de nuevo.')
    }
  }

  return (
    <div
      className="relative min-h-screen w-full overflow-x-hidden antialiased"
      style={{
        background: '#0a0a0a',
        color: INK,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <TopNav onLogin={handleSignIn} onSignup={handleSignIn} />

      <main>
        <Hero onPrimary={handleSignIn} />
        <SportsStrip />
        <HowItWorks />
        <DisciplinesGrid />
        <FeatureTeaser />
        <QuoteBlock />
        <AccessCard
          onSignup={handleSignIn}
          onGoogle={handleSignIn}
          authError={authError}
          authAvailable={authAvailable}
        />
        <Footer />
      </main>

      <style>{css}</style>
    </div>
  )
}

/* ───────────────────────────────────────────────────────── NAV */

function TopNav({ onLogin, onSignup }: { onLogin: () => void; onSignup: () => void }) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 10)
    fn()
    window.addEventListener('scroll', fn, { passive: true })
    return () => window.removeEventListener('scroll', fn)
  }, [])

  return (
    <nav
      className="fixed inset-x-0 top-0 z-50 transition-all duration-300"
      style={{
        backgroundColor: scrolled ? 'rgba(10,10,10,0.92)' : 'rgba(10,10,10,0.5)',
        backdropFilter: 'blur(18px) saturate(140%)',
        WebkitBackdropFilter: 'blur(18px) saturate(140%)',
        borderBottom: scrolled ? `1px solid ${SURFACE_BORDER}` : '1px solid transparent',
      }}
    >
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4 md:px-10 md:py-5">
        {/* Logo */}
        <a href="#top" className="flex items-center gap-2.5">
          <BoltIcon />
          <span
            className="text-[1.35rem] font-black tracking-[-0.03em] text-white"
            style={{ fontFamily: FONT_DISPLAY }}
          >
            RallyIQ
          </span>
        </a>

        {/* Nav links */}
        <div className="hidden items-center gap-7 md:flex">
          {(['Producto', 'Funcionalidades', 'Precios', 'Atletas'] as const).map((label) => (
            <a
              key={label}
              href="#"
              className="nav-link text-[13px] font-semibold tracking-tight transition-colors"
              style={{ color: INK_FAINT, fontFamily: FONT_DISPLAY }}
            >
              {label}
            </a>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 md:gap-3">
          <button
            onClick={onLogin}
            className="hidden rounded-xl px-4 py-2 text-sm font-medium transition-colors hover:text-white md:inline-flex"
            style={{ color: INK_MUTED }}
          >
            Iniciar sesión
          </button>
          <button
            onClick={onSignup}
            className="btn-primary-pill group relative inline-flex items-center gap-1.5 overflow-hidden rounded-xl px-5 py-2.5 text-[13px] font-bold text-white"
          >
            <span className="relative z-10">Empezar</span>
            <ArrowRight className="relative z-10 h-3.5 w-3.5 opacity-90" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </nav>
  )
}

/* ───────────────────────────────────────────────────────── HERO */

function Hero({ onPrimary }: { onPrimary: () => void }) {
  return (
    <section
      id="top"
      className="relative overflow-hidden"
      style={{ padding: '72px 0 88px' }}
    >
      {/* Background glows */}
      <div
        className="hero-bg-glow pointer-events-none absolute"
        style={{
          top: -120, left: -80, width: 520, height: 520,
          background: 'radial-gradient(circle, rgba(255,77,0,0.28), transparent 60%)',
        }}
      />
      <div
        className="hero-bg-glow pointer-events-none absolute"
        style={{
          top: -40, right: -120, width: 480, height: 480,
          background: 'radial-gradient(circle, rgba(0,227,253,0.22), transparent 60%)',
        }}
      />

      <div className="relative z-10 mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-16 px-6 md:px-10 lg:grid-cols-[1.15fr_1fr]">
        {/* Copy */}
        <div>
          <div
            className="mb-7 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.22em]"
            style={{
              color: BRAND,
              background: 'rgba(255,77,0,0.08)',
              border: `1px solid rgba(255,77,0,0.18)`,
              fontFamily: FONT_MONO,
            }}
          >
            v2.4 · release en abril
          </div>

          <h1
            className="text-[2.75rem] font-extrabold leading-[1.04] tracking-[-0.035em] text-white md:text-[4.25rem]"
            style={{ fontFamily: FONT_DISPLAY, marginBottom: 20 }}
          >
            Un coach de élite,<br />
            en tu{' '}
            <span style={{ color: BRAND }}>bolsillo.</span>
          </h1>

          <p
            className="max-w-xl text-[17px] font-medium leading-relaxed"
            style={{ color: INK_MUTED, marginBottom: 36 }}
          >
            Planea tu semana, registra cada sesión y recibe propuestas reales de IA — no solo
            chat. RallyIQ lee tu carga, tu sueño y tus dolores, y ajusta el plan con un tap.
          </p>

          <div className="flex flex-wrap items-center gap-3" style={{ marginBottom: 40 }}>
            <button
              onClick={onPrimary}
              className="btn-primary-pill group inline-flex items-center gap-2 rounded-xl px-7 py-4 text-[15px] font-bold text-white"
            >
              Empezar gratis <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2.5} />
            </button>
            <a
              href="#how"
              className="inline-flex items-center gap-2 rounded-xl px-7 py-4 text-[15px] font-bold transition-all"
              style={{
                color: INK,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              Ver cómo funciona
            </a>
          </div>

          {/* Proof row */}
          <div
            className="flex flex-wrap items-center gap-7 pt-7"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
          >
            <ProofStat value="5" unit=" deportes" label="Cobertura" />
            <ProofStat value="< 90" unit=" s" label="Log por sesión" />
            <ProofStat value="100" unit="%" label="Local-first PWA" />
            <ProofStat value="24/7" label="Coach disponible" />
          </div>
        </div>

        {/* Phone mockup */}
        <div className="flex justify-center">
          <PhoneMockup />
        </div>
      </div>
    </section>
  )
}

function ProofStat({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="text-[22px] font-bold leading-none tabular-nums"
        style={{ fontFamily: FONT_MONO, color: INK }}
      >
        {value}
        {unit && <span style={{ color: INK_FAINT, fontWeight: 500 }}>{unit}</span>}
      </div>
      <div
        className="text-[10px] uppercase tracking-[0.22em] font-semibold"
        style={{ fontFamily: FONT_MONO, color: INK_FAINT }}
      >
        {label}
      </div>
    </div>
  )
}

function PhoneMockup() {
  return (
    <div
      style={{
        width: 340, height: 700,
        borderRadius: 44,
        background: '#0a0a0a',
        border: '1.5px solid rgba(255,255,255,0.12)',
        boxShadow:
          '0 0 0 6px rgba(255,255,255,0.03), 0 60px 140px -30px rgba(0,0,0,0.95), 0 0 120px -20px rgba(255,77,0,0.25), inset 0 0 0 1px rgba(255,255,255,0.05)',
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Notch */}
      <div
        style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: 110, height: 30, background: '#0a0a0a',
          borderRadius: '0 0 16px 16px', zIndex: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}
      >
        <div style={{ width: 36, height: 3, borderRadius: 9999, background: '#181818' }} />
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#181818' }} />
      </div>

      {/* Screen */}
      <div
        style={{
          width: '100%', height: '100%',
          padding: '44px 18px 0',
          backgroundImage:
            'radial-gradient(circle at top left, rgba(209,252,0,0.07), transparent 28%), radial-gradient(circle at 85% 15%, rgba(0,227,253,0.08), transparent 24%), linear-gradient(180deg, rgba(19,19,19,0.96) 0%, rgba(8,8,8,1) 100%)',
        }}
      >
        {/* Status bar */}
        <div
          className="flex justify-between pb-4"
          style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: 600, color: INK }}
        >
          <span>9:42</span>
          <span>●●●●● LTE</span>
        </div>

        {/* Greeting */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 700, color: INK }}>
            Hola, <span style={{ color: BRAND }}>Rafa</span>
          </div>
          <div
            style={{
              fontFamily: FONT_MONO, fontSize: 10, color: INK_FAINT,
              letterSpacing: '0.22em', textTransform: 'uppercase', marginTop: 4,
            }}
          >
            Martes · semana 16 · bloque B
          </div>
        </div>

        {/* HUD card */}
        <div
          style={{
            background: 'rgba(24,24,24,0.6)',
            border: `1px solid ${SURFACE_BORDER}`,
            borderRadius: 14, padding: '12px 14px', marginBottom: 12,
          }}
        >
          <div
            className="flex justify-between"
            style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.24em', textTransform: 'uppercase', marginBottom: 10 }}
          >
            <span style={{ color: INK_FAINT, fontWeight: 600 }}>Tu semana</span>
            <span style={{ color: FORGE_LIME }}>78% adherencia</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <PhoneStat label="Sesiones" value="3/5" />
            <PhoneStat label="RPE avg" value="7.2" color={FORGE_LIME} />
            <PhoneStat label="Sueño" value="7h" color={FORGE_CYAN} />
          </div>
        </div>

        {/* Today card */}
        <PhoneCard
          tag="HOY · 18:30"
          time="60 min"
          title="Squash — Intervalos 4×4"
          body="Bloque B · trabajo aeróbico · objetivo RPE 8"
          meta={[['Vol', '24′'], ['Int', 'Alta'], ['Zona', '4']]}
        />

        {/* Coach proposal */}
        <div
          style={{
            background: 'rgba(24,24,24,0.6)',
            border: `1px solid ${SURFACE_BORDER}`,
            borderRadius: 14, padding: 14, marginBottom: 10,
          }}
        >
          <div className="flex justify-between" style={{ marginBottom: 10 }}>
            <span style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.24em', textTransform: 'uppercase', color: FORGE_LIME, fontWeight: 700 }}>
              PROPUESTA · COACH
            </span>
            <span style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: INK_FAINT }}>
              hace 3 min
            </span>
          </div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 600, color: INK, marginBottom: 4 }}>
            Reduce volumen el jueves
          </div>
          <p style={{ fontSize: 11, color: INK_MUTED, lineHeight: 1.45 }}>
            Sueño bajo 3 noches seguidas. Baja fuerza −15%.
          </p>
          <div className="flex gap-1.5" style={{ marginTop: 12 }}>
            <button
              style={{
                flex: 1, fontSize: 11, padding: '8px', borderRadius: 8,
                background: 'rgba(209,252,0,0.12)', border: '1px solid rgba(209,252,0,0.3)',
                color: FORGE_LIME, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Aplicar
            </button>
            <button
              style={{
                fontSize: 11, padding: '8px 14px', borderRadius: 8,
                background: 'rgba(255,255,255,0.04)', border: `1px solid ${SURFACE_BORDER}`,
                color: INK_MUTED, cursor: 'pointer',
              }}
            >
              Más tarde
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PhoneStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: 8, padding: 8,
      }}
    >
      <div style={{ fontFamily: FONT_MONO, fontSize: 8, letterSpacing: '0.22em', textTransform: 'uppercase', color: INK_FAINT, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 16, fontWeight: 700, color: color || INK }}>
        {value}
      </div>
    </div>
  )
}

function PhoneCard({
  tag, time, title, body, meta,
}: {
  tag: string; time: string; title: string; body: string;
  meta: [string, string][];
}) {
  return (
    <div
      style={{
        background: 'rgba(24,24,24,0.6)',
        border: `1px solid ${SURFACE_BORDER}`,
        borderRadius: 14, padding: 14, marginBottom: 10,
      }}
    >
      <div className="flex justify-between" style={{ marginBottom: 10 }}>
        <span style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.24em', textTransform: 'uppercase', color: BRAND_LIGHT, fontWeight: 700 }}>
          {tag}
        </span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase', color: INK_FAINT }}>
          {time}
        </span>
      </div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 600, color: INK, marginBottom: 4 }}>
        {title}
      </div>
      <p style={{ fontSize: 11, color: INK_MUTED, lineHeight: 1.45 }}>{body}</p>
      <div className="flex flex-wrap gap-2.5" style={{ marginTop: 12, fontFamily: FONT_MONO, fontSize: 10, color: INK_MUTED }}>
        {meta.map(([k, v]) => (
          <span key={k}>{k} <b style={{ color: INK, fontWeight: 600 }}>→ {v}</b></span>
        ))}
      </div>
    </div>
  )
}

/* ───────────────────────────────────────────────────────── SPORTS STRIP */

function SportsStrip() {
  return (
    <div
      style={{
        padding: '28px 0',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-8 px-6 md:px-10">
        <span
          style={{
            fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.32em',
            textTransform: 'uppercase', color: INK_FAINT, fontWeight: 600,
          }}
        >
          Construido para
        </span>
        <div className="flex flex-wrap items-center gap-4">
          {SPORTS.map((s, i) => (
            <span key={s} className="flex items-center gap-4">
              {i > 0 && <span style={{ color: 'rgba(255,255,255,0.18)' }}>·</span>}
              <span
                style={{
                  fontFamily: FONT_DISPLAY, fontWeight: 600,
                  fontSize: 18, color: INK,
                }}
              >
                {s}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────────────────────────────────────── HOW IT WORKS */

function HowItWorks() {
  return (
    <section id="how" className="section-padding">
      <div className="mx-auto w-full max-w-7xl px-6 md:px-10">
        {/* Header */}
        <div className="mb-12 flex flex-col items-start justify-between gap-6 md:flex-row md:items-baseline">
          <div className="max-w-[620px]">
            <div className="label-mono mb-3.5">Cómo funciona</div>
            <h2
              className="text-[2rem] font-bold leading-[1.08] tracking-[-0.025em] text-white md:text-[2.75rem]"
              style={{ fontFamily: FONT_DISPLAY }}
            >
              Tres pasos. Sin planillas,<br /> sin fricción, sin Excel.
            </h2>
          </div>
          <p
            className="max-w-[320px] text-[14px] leading-[1.55]"
            style={{ color: INK_MUTED }}
          >
            El flujo completo de un atleta serio, destilado en una app que usas en menos de dos minutos por día.
          </p>
        </div>

        {/* Steps */}
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          <Step
            num="01"
            phase="Planificar"
            title="Crea tu semana"
            body="Define sesiones por día, deporte y objetivo. Arrastra, duplica, ajusta. La semana vive en una grilla que entiendes en 5 segundos."
            accent={BRAND}
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            }
          />
          <Step
            num="02"
            phase="Registrar"
            title="Entrena y checkea"
            body="Registra cada sesión en &lt; 90 s. Check-in diario de sueño, RPE y dolor. Todo tabular, todo monospace, todo al grano."
            accent={FORGE_LIME}
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
              </svg>
            }
          />
          <Step
            num="03"
            phase="Ajustar"
            title="El coach propone"
            body="La IA lee tu carga, tu fatiga y tu historial. Propone cambios concretos — no consejos vagos. Aplicas con un tap."
            accent={FORGE_CYAN}
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>
              </svg>
            }
          />
        </div>
      </div>
    </section>
  )
}

function Step({
  num, phase, title, body, accent, icon,
}: {
  num: string; phase: string; title: string; body: string;
  accent: string; icon: React.ReactNode;
}) {
  const bg = `${accent}1a`
  const border = `${accent}38`
  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      style={{
        padding: 32,
        background: 'rgba(24,24,24,0.5)',
        border: `1px solid ${SURFACE_BORDER}`,
      }}
    >
      {/* Ghost number */}
      <div
        className="pointer-events-none absolute select-none"
        style={{
          top: -40, right: -20,
          fontFamily: FONT_DISPLAY, fontSize: 200, fontWeight: 900,
          color: 'rgba(255,255,255,0.025)', lineHeight: 1,
        }}
      >
        {num}
      </div>

      <div
        className="flex items-center justify-center"
        style={{
          width: 44, height: 44, borderRadius: 12,
          background: bg, border: `1px solid ${border}`,
          color: accent, marginBottom: 24,
        }}
      >
        {icon}
      </div>

      <div
        className="mb-3.5 text-[10px] uppercase tracking-[0.26em] font-semibold"
        style={{ fontFamily: FONT_MONO, color: INK_FAINT }}
      >
        <b style={{ color: INK, fontWeight: 600 }}>Paso {num}</b> · {phase}
      </div>

      <h3
        className="mb-3 text-[22px] font-semibold leading-tight tracking-[-0.01em] text-white"
        style={{ fontFamily: FONT_DISPLAY }}
      >
        {title}
      </h3>
      <p
        className="text-[14px] leading-[1.6]"
        style={{ color: INK_MUTED }}
        dangerouslySetInnerHTML={{ __html: body }}
      />
    </div>
  )
}

/* ───────────────────────────────────────────────────────── DISCIPLINES */

const DISCIPLINE_CARDS: Array<{
  title: string; tag: string; blurb: string;
  accent: string; image: string; alt: string;
  fallback: string;
}> = [
  {
    title: 'Squash', tag: 'Herencia técnica',
    blurb: 'Drills técnicos, match-play y lectura de partido real.',
    accent: BRAND,
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAehGJU9K_OKOG721C0R2W6efCxo9k4vnJS2siZJ6r47KylE_SqGjYl6wqVNmsNsHo695j0fDYZJszFHImcukQyfIt11IMQaarNd2Ju_JO4KbOGfpIv95U-mHQ7RlMX1n-Eo_TwC9xhni6GC9zE1OyJ1Q60J7BIwSTL9sqafKMUXQ4IRrNq3lXtdN-soKtqNdFpyjgcCdBGGr9Crwr85fMjflG6zgbUXMt5Dpq7zA3kDIPttPBwznZ647jYa8oaUalfRtkZpWZmlM5M',
    alt: 'Cancha de squash con iluminación dramática',
    fallback: 'linear-gradient(150deg, rgba(255,77,0,0.25), rgba(20,10,5,1) 70%)',
  },
  {
    title: 'Running', tag: 'Resistencia pura',
    blurb: 'Series, tempo y progresión aeróbica con ACWR vigilado.',
    accent: FORGE_CYAN,
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuB1XpnMPHAGOKmb10vEIGlEkjFFsQpBcabcXJScQFNeZQEaPTXvSuh9IdSQZxskEl5o9rXxP2EIo0-kx_XkUMUALbhNZtSKijwsqsC4GUFHE2NkF1mWHUNPRyLH4Oc6D-PhFmIn-g_h00TNJoXN78Xe4b2rTOPkppYShfhNKvujUcBTueSN24mCYAIkJlmBTi59ChH9qZwaWStenfQFC-uBew5HGgNbstLO-uO-8T_Be8lib8OQXL1IUJG-sBQl6kc7AjHzGxqGalLb',
    alt: 'Atleta en bloque de salida sobre pista nocturna',
    fallback: 'linear-gradient(150deg, rgba(0,227,253,0.18), rgba(5,10,20,1) 70%)',
  },
  {
    title: 'Fuerza', tag: 'Potencia explosiva',
    blurb: 'Fuerza máxima, potencia y transferencia a la cancha.',
    accent: BRAND,
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDO55mUlnqFLj10LgEBdpx3rgQvK75EbYiMu-nWB81BdO2-HKxQ78wYltIQDKebUvvJ17Y5lNRVckdRnkQqZui46jajP9gaNofgQiaCnbgmHDUU4VCLg2MwRdF6nsc1ygZEVrU3BTLrh1E75USOen2NITEXCyuMGadHRmrKJ-eP-WzJd7j5OY7-DGkL31wtXzB9heXSOFD_THWJt_MYI6-HSNkIlDhaCrPerQ3qfoqLxzCbk6huvshWtbdvdGwYL1c8vslvjVV5fc2t',
    alt: 'Barra olímpica en gimnasio oscuro',
    fallback: 'linear-gradient(150deg, rgba(255,77,0,0.2), rgba(15,10,5,1) 70%)',
  },
  {
    title: 'Ciclismo', tag: 'Soporte aeróbico',
    blurb: 'Volumen de bajo impacto y build de base para días largos.',
    accent: FORGE_CYAN,
    image: '/landing/cycling.jpg',
    alt: 'Ciclista de élite en posición aerodinámica',
    fallback: 'linear-gradient(150deg, rgba(0,227,253,0.15), rgba(10,8,6,1) 70%)',
  },
  {
    title: 'Movilidad', tag: 'Recuperación activa',
    blurb: 'Reset post-sesión, rango articular y desbloqueo de cadenas.',
    accent: FORGE_LIME,
    image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCIbwLT9cKRxWbV62Fnkn8ICVaOu9FuYhPEB4Ufh6Rtihsw-Ko7v8cU1e1kTVp5YmkF6P_hWgoHUWzclzFcapaSyTTedIlC_xqSq8nSVuQF26xJey1npfXaEcg0o8LCfdWXmLqtn9Evz1qW105Y8ehoLRN-HeXhi1wXdcSMbnvTh80OoQclnJ0SYa2av5NMuza9DfKSJ4SyIfsyy6vA0gief7BNPzyQSfDnFwYr4Xtdh-FNdqWSxkd3lwPsTyn4tzSm3czhlnp4kOhk',
    alt: 'Silueta realizando flow de movilidad al amanecer',
    fallback: 'linear-gradient(150deg, rgba(209,252,0,0.14), rgba(8,10,15,1) 70%)',
  },
]

function DisciplinesGrid() {
  return (
    <section id="disciplines" className="section-padding" style={{ paddingTop: 24 }}>
      <div className="mx-auto w-full max-w-7xl px-6 md:px-10">
        {/* Header */}
        <div
          className="mb-10 flex flex-col items-start justify-between gap-8 md:flex-row md:items-end"
        >
          <div>
            <div className="label-mono mb-4">Multidisciplina</div>
            <h2
              className="text-[2rem] font-bold leading-[1.05] tracking-[-0.025em] text-white md:text-[3rem]"
              style={{ fontFamily: FONT_DISPLAY }}
            >
              Multidisciplina<br />
              <span style={{ color: BRAND }}>Avanzada.</span>
            </h2>
            <p
              className="mt-2 max-w-[380px] text-[15px] leading-[1.55]"
              style={{ color: INK_MUTED }}
            >
              Originado en la intensidad del squash, evolucionado para dominar cualquier campo. Una sola carga unificada, cinco lenguajes distintos.
            </p>
          </div>
          <a
            href="#"
            className="disc-link inline-flex items-center gap-2.5 pb-1.5 font-bold uppercase tracking-[0.26em] transition-colors"
            style={{
              fontFamily: FONT_MONO, fontSize: 11, color: BRAND_LIGHT,
              borderBottom: '1px solid rgba(255,77,0,0.3)',
            }}
          >
            Ver todas <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
          </a>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
          {DISCIPLINE_CARDS.map((c) => (
            <article
              key={c.title}
              className="disc-card group relative overflow-hidden rounded-2xl"
              style={{
                aspectRatio: '3/4',
                background: c.fallback,
                border: '1px solid rgba(255,255,255,0.06)',
                cursor: 'pointer',
              }}
            >
              <img
                src={c.image}
                alt={c.alt}
                loading="lazy"
                decoding="async"
                draggable={false}
                className="disc-art absolute inset-0 h-full w-full object-cover"
                onError={(e) => { e.currentTarget.style.display = 'none' }}
              />
              {/* Gradient overlay */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: 'linear-gradient(180deg, transparent 40%, rgba(8,8,8,0.65) 75%, rgba(8,8,8,0.95) 100%)',
                }}
              />
              {/* Accent hover overlay */}
              <div
                className="disc-hover-glow absolute inset-0 pointer-events-none opacity-0 transition-opacity duration-500"
                style={{ background: `radial-gradient(circle at 75% 15%, ${c.accent}22, transparent 65%)` }}
              />

              {/* Caption */}
              <div className="absolute inset-x-0 bottom-0 z-10 p-5 md:p-6">
                <div
                  className="disc-line mb-3 h-px transition-all duration-500"
                  style={{ width: 32, background: c.accent }}
                />
                <h5
                  className="text-[1.35rem] font-black leading-tight tracking-tight text-white md:text-[1.5rem]"
                  style={{ fontFamily: FONT_DISPLAY, marginBottom: 4 }}
                >
                  {c.title}
                </h5>
                <span
                  className="text-[10px] font-bold uppercase tracking-[0.22em]"
                  style={{ color: c.accent }}
                >
                  {c.tag}
                </span>
                <p
                  className="disc-blurb mt-2 text-[12px] leading-relaxed text-white/80"
                  style={{ maxHeight: 0, overflow: 'hidden', opacity: 0, transition: 'max-height .5s, opacity .5s' }}
                >
                  {c.blurb}
                </p>
              </div>

              {/* Hover body (desktop overlay) */}
              <div
                className="disc-hover-body absolute inset-0 z-20 flex items-end p-6 opacity-0 transition-opacity duration-300"
                style={{
                  background: 'rgba(8,8,8,0.72)',
                  backdropFilter: 'blur(4px)',
                }}
              >
                <p style={{ fontSize: 13, color: INK, lineHeight: 1.55, maxWidth: '28ch' }}>
                  <b
                    style={{
                      color: c.accent, display: 'block',
                      fontFamily: FONT_MONO, fontSize: 9,
                      letterSpacing: '0.28em', textTransform: 'uppercase',
                      marginBottom: 10, fontWeight: 700,
                    }}
                  >
                    {c.tag}
                  </b>
                  {c.blurb}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ───────────────────────────────────────────────────────── FEATURES TEASER */

function FeatureTeaser() {
  return (
    <section className="section-padding" style={{ paddingTop: 48 }}>
      <div className="mx-auto w-full max-w-7xl px-6 md:px-10">
        {/* Header */}
        <div className="mb-12 flex flex-col items-start justify-between gap-6 md:flex-row md:items-baseline">
          <div className="max-w-[620px]">
            <div className="label-mono lime mb-3.5">Lo que incluye</div>
            <h2
              className="text-[2rem] font-bold leading-[1.08] tracking-[-0.025em] text-white md:text-[2.75rem]"
              style={{ fontFamily: FONT_DISPLAY }}
            >
              Un sistema completo,<br />
              no un{' '}
              <span style={{ color: FORGE_LIME }}>chatbot más.</span>
            </h2>
          </div>
          <p
            className="max-w-[320px] text-[14px] leading-[1.55]"
            style={{ color: INK_MUTED }}
          >
            RallyIQ combina planificación, registro, coach IA y analytics en un solo flujo diseñado para el atleta que ya sabe lo que hace.
          </p>
        </div>

        {/* 2-card grid */}
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
          {/* Coach AI */}
          <div
            className="relative overflow-hidden rounded-2xl p-8"
            style={{
              background: 'rgba(24,24,24,0.5)',
              border: `1px solid ${SURFACE_BORDER}`,
            }}
          >
            <div
              className="mb-5 inline-block text-[9px] font-bold uppercase tracking-[0.3em]"
              style={{ fontFamily: FONT_MONO, color: BRAND_LIGHT }}
            >
              Coach AI
            </div>
            {/* Mini chat */}
            <div
              className="mb-4 rounded-xl p-4"
              style={{ background: 'rgba(8,8,8,0.6)', border: '1px solid rgba(255,255,255,0.04)' }}
            >
              <div className="flex flex-col gap-1.5">
                <MiniChatBubble type="a">Baja volumen jueves −15%. ¿Aplico?</MiniChatBubble>
                <MiniChatBubble type="u">Sí, aplica.</MiniChatBubble>
                <MiniChatBubble type="a">Hecho. Semana ajustada.</MiniChatBubble>
              </div>
            </div>
            <h3
              className="mb-2.5 text-[22px] font-semibold tracking-[-0.01em] text-white"
              style={{ fontFamily: FONT_DISPLAY }}
            >
              Propuestas reales, no consejos vagos
            </h3>
            <p className="text-[13px] leading-[1.55]" style={{ color: INK_MUTED }}>
              El coach IA genera cambios concretos a tu plan — volumen, intensidad, descansos. Aplicas con un tap o descartas.
            </p>
          </div>

          {/* Semana */}
          <div
            className="relative overflow-hidden rounded-2xl p-8"
            style={{
              background: 'rgba(24,24,24,0.5)',
              border: `1px solid rgba(209,252,0,0.14)`,
            }}
          >
            <div
              className="mb-5 inline-block text-[9px] font-bold uppercase tracking-[0.3em]"
              style={{ fontFamily: FONT_MONO, color: FORGE_LIME }}
            >
              Semana
            </div>
            {/* Mini week grid */}
            <div
              className="mb-4 rounded-xl p-4"
              style={{ background: 'rgba(8,8,8,0.6)', border: '1px solid rgba(255,255,255,0.04)' }}
            >
              <div className="grid grid-cols-7 gap-1">
                {[
                  { d: 'L', t: 'f' }, { d: 'M', t: 'f' }, { d: 'X', t: 'p' },
                  { d: 'J', t: 'f' }, { d: 'V', t: '' }, { d: 'S', t: 'p' }, { d: 'D', t: '' },
                ].map(({ d, t }) => (
                  <div
                    key={d}
                    className="flex items-start justify-center pt-1.5"
                    style={{
                      aspectRatio: '1/1.4', borderRadius: 6,
                      background: t === 'f' ? 'rgba(255,77,0,0.18)' : t === 'p' ? 'rgba(209,252,0,0.14)' : 'rgba(255,255,255,0.04)',
                      border: t === 'f' ? '1px solid rgba(255,77,0,0.3)' : t === 'p' ? '1px solid rgba(209,252,0,0.3)' : 'none',
                      fontFamily: FONT_MONO, fontSize: 10, fontWeight: 600,
                      color: t === 'f' ? BRAND_LIGHT : t === 'p' ? FORGE_LIME : INK_FAINT,
                    }}
                  >
                    {d}
                  </div>
                ))}
              </div>
            </div>
            <h3
              className="mb-2.5 text-[22px] font-semibold tracking-[-0.01em] text-white"
              style={{ fontFamily: FONT_DISPLAY }}
            >
              Planificación semanal visual
            </h3>
            <p className="text-[13px] leading-[1.55]" style={{ color: INK_MUTED }}>
              Grilla de 7 días, deportes por color, adherencia en tiempo real. Duplica semanas, copia plantillas, arrastra sesiones.
            </p>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-10 flex justify-center">
          <a
            href="#"
            className="inline-flex items-center gap-2 rounded-xl px-7 py-3.5 text-[14px] font-bold transition-all"
            style={{
              color: INK,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            Ver todas las funcionalidades <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
          </a>
        </div>
      </div>
    </section>
  )
}

function MiniChatBubble({ type, children }: { type: 'a' | 'u'; children: React.ReactNode }) {
  return (
    <div
      className="max-w-[85%] rounded-[10px] px-3 py-2 text-[12px]"
      style={{
        alignSelf: type === 'a' ? 'flex-start' : 'flex-end',
        background: type === 'a' ? 'rgba(255,77,0,0.08)' : 'rgba(255,255,255,0.04)',
        border: type === 'a' ? '1px solid rgba(255,77,0,0.22)' : `1px solid ${SURFACE_BORDER}`,
        color: type === 'a' ? INK : INK_MUTED,
      }}
    >
      {children}
    </div>
  )
}

/* ───────────────────────────────────────────────────────── QUOTE BLOCK */

function QuoteBlock() {
  return (
    <section className="section-padding">
      <div className="mx-auto w-full max-w-7xl px-6 md:px-10">
        <div
          className="grid grid-cols-1 items-center gap-14 rounded-[20px] p-8 md:grid-cols-[1.3fr_1fr] md:p-16"
          style={{
            background: 'rgba(24,24,24,0.5)',
            border: `1px solid ${SURFACE_BORDER}`,
          }}
        >
          {/* Quote */}
          <div>
            <div className="label-mono mb-7">Atletas que la usan</div>
            <blockquote
              className="mb-7 text-[1.5rem] font-medium leading-[1.25] tracking-[-0.015em] text-white md:text-[2rem]"
              style={{ fontFamily: FONT_DISPLAY }}
            >
              "Dejé Excel, Notas y tres apps. Lo único que necesito para{' '}
              <span style={{ color: BRAND }}>entrenar con cabeza</span> está acá adentro."
            </blockquote>
            <div className="flex items-center gap-3.5">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold"
                style={{
                  background: `linear-gradient(135deg, ${BRAND}, #d63200)`,
                  fontFamily: FONT_MONO, color: '#000',
                }}
              >
                MC
              </div>
              <div>
                <div
                  className="text-[14px] font-semibold text-white"
                  style={{ fontFamily: FONT_DISPLAY }}
                >
                  Martín Cáceres
                </div>
                <div
                  className="mt-0.5 text-[10px] uppercase tracking-[0.22em]"
                  style={{ fontFamily: FONT_MONO, color: INK_FAINT }}
                >
                  Squash · #8 ranking nacional
                </div>
              </div>
            </div>
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-2 gap-4">
            <MetricCard value="+18" unit="%" label="Adherencia" color={FORGE_LIME} note="Atletas con coach IA completan más del plan que con planillas." />
            <MetricCard value="90" unit="s" label="Log promedio" color={BRAND_LIGHT} note="Registrar una sesión completa — sin teclado, mínima fricción." />
            <div
              className="col-span-2 rounded-xl p-4 md:p-5"
              style={{ background: 'rgba(8,8,8,0.5)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div
                className="mb-2.5 text-[26px] font-bold leading-none tabular-nums text-white"
                style={{ fontFamily: FONT_MONO }}
              >
                {SPORTS.length}
                <span style={{ color: INK_FAINT, fontSize: 14, fontWeight: 500 }}> deportes ·</span>{' '}
                24<span style={{ color: INK_FAINT, fontSize: 14, fontWeight: 500 }}>/7 coach ·</span>{' '}
                0<span style={{ color: INK_FAINT, fontSize: 14, fontWeight: 500 }}> permanencia</span>
              </div>
              <div
                className="text-[9px] uppercase tracking-[0.3em] font-semibold"
                style={{ fontFamily: FONT_MONO, color: INK_FAINT }}
              >
                Cobertura total
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function MetricCard({
  value, unit, label, color, note,
}: {
  value: string; unit: string; label: string; color: string; note: string;
}) {
  return (
    <div
      className="rounded-xl p-4 md:p-5"
      style={{ background: 'rgba(8,8,8,0.5)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div
        className="mb-2.5 text-[28px] font-bold leading-none tabular-nums"
        style={{ fontFamily: FONT_MONO, color }}
      >
        {value}
        <span style={{ color: INK_FAINT, fontSize: 14, fontWeight: 500 }}>{unit}</span>
      </div>
      <div
        className="mb-2 text-[9px] uppercase tracking-[0.3em] font-semibold"
        style={{ fontFamily: FONT_MONO, color: INK_FAINT }}
      >
        {label}
      </div>
      <p className="text-[12px] leading-[1.5]" style={{ color: INK_MUTED }}>{note}</p>
    </div>
  )
}

/* ───────────────────────────────────────────────────────── ACCESS CARD */

function AccessCard({
  onSignup, onGoogle, authError, authAvailable,
}: {
  onSignup: () => void; onGoogle: () => void;
  authError: string | null; authAvailable: boolean;
}) {
  return (
    <section id="access" className="section-padding">
      <div className="mx-auto w-full max-w-7xl px-6 md:px-10">
        <div
          className="access-card relative overflow-hidden rounded-[28px] p-12 text-center md:p-20"
          style={{
            background: 'linear-gradient(180deg, rgba(24,24,26,0.7), rgba(10,10,12,0.8))',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.07)',
            boxShadow: '0 40px 120px -40px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.04)',
          }}
        >
          {/* Glows */}
          <div
            className="pointer-events-none absolute rounded-full"
            style={{
              top: -120, left: -80, width: 380, height: 380,
              background: 'radial-gradient(circle, rgba(255,77,0,0.22), transparent 65%)',
              filter: 'blur(80px)',
            }}
          />
          <div
            className="pointer-events-none absolute rounded-full"
            style={{
              bottom: -120, right: -80, width: 380, height: 380,
              background: 'radial-gradient(circle, rgba(0,227,253,0.16), transparent 65%)',
              filter: 'blur(80px)',
            }}
          />
          <div
            className="pointer-events-none absolute rounded-full"
            style={{
              top: '20%', right: '30%', width: 260, height: 260,
              background: 'radial-gradient(circle, rgba(209,252,0,0.08), transparent 65%)',
              filter: 'blur(80px)',
            }}
          />
          {/* Grid overlay */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)',
              backgroundSize: '28px 28px',
              WebkitMaskImage: 'radial-gradient(ellipse 70% 70% at 50% 50%, #000, transparent 85%)',
              maskImage: 'radial-gradient(ellipse 70% 70% at 50% 50%, #000, transparent 85%)',
            }}
          />

          {/* Content */}
          <div className="relative z-10">
            <div className="label-mono brand mb-6 flex justify-center">
              Empieza tu evolución
            </div>
            <h2
              className="mx-auto mb-5 max-w-[680px] text-[2.25rem] font-bold leading-[1.05] tracking-[-0.03em] text-white md:text-[3.5rem]"
              style={{ fontFamily: FONT_DISPLAY }}
            >
              Entrena con{' '}
              <span style={{ color: BRAND }}>cabeza.</span>
              <br />
              Compite con{' '}
              <span style={{ color: BRAND }}>datos.</span>
            </h2>
            <p
              className="mx-auto mb-9 max-w-[520px] text-[16px] leading-[1.55]"
              style={{ color: INK_MUTED }}
            >
              Únete a la élite y transforma tus hábitos en rendimiento puro. Sin tarjeta, sin permanencia. Tu primera semana de Pro es cortesía de la casa.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={onSignup}
                disabled={!authAvailable}
                className="btn-primary-pill inline-flex items-center gap-2 rounded-xl px-7 py-4 text-[15px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Crear cuenta gratis <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
              </button>
              <button
                onClick={onGoogle}
                disabled={!authAvailable}
                className="inline-flex items-center justify-center gap-3 rounded-xl bg-white px-7 py-4 text-[15px] font-bold text-black transition-transform hover:bg-white/95 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <GoogleIcon />
                Continuar con Google
              </button>
              <span
                className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.26em]"
                style={{ fontFamily: FONT_MONO, color: INK_FAINT }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: FORGE_LIME, boxShadow: `0 0 8px ${FORGE_LIME}` }}
                />
                5 días de Pro incluidos
              </span>
            </div>

            {authError && (
              <p className="mt-4 text-xs font-medium text-red-300">{authError}</p>
            )}
            {!authAvailable && (
              <div
                className="mx-auto mt-5 max-w-md rounded-xl px-4 py-3"
                style={{
                  background: 'rgba(251,191,36,0.05)',
                  border: '1px solid rgba(251,191,36,0.15)',
                }}
              >
                <p className="text-[12px] font-semibold text-amber-300">Auth no disponible en este entorno</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-amber-200/70">
                  Configura <code className="font-mono">VITE_SUPABASE_URL</code> y{' '}
                  <code className="font-mono">VITE_SUPABASE_ANON_KEY</code>.
                </p>
              </div>
            )}

            <p className="mt-8 text-[12px]" style={{ color: INK_FAINT }}>
              ¿Ya eres parte de RallyIQ?{' '}
              <button
                onClick={onSignup}
                className="font-bold text-white underline-offset-2 transition-colors hover:underline"
              >
                Iniciar sesión
              </button>
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ───────────────────────────────────────────────────────── FOOTER */

function Footer() {
  return (
    <footer
      className="relative px-6 py-14 md:px-10"
      style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: '#050505' }}
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col items-start justify-between gap-8 md:flex-row">
        <div className="max-w-[260px]">
          <div className="flex items-center gap-2.5">
            <BoltIcon />
            <span
              className="text-[15px] font-black tracking-tight text-white"
              style={{ fontFamily: FONT_DISPLAY }}
            >
              RallyIQ
            </span>
          </div>
          <p
            className="mt-3 text-[13px] leading-relaxed"
            style={{ color: INK_MUTED }}
          >
            Entrenador AI para atletas de raqueta y endurance. Hecho por atletas, para atletas.
          </p>
        </div>

        <div className="flex flex-wrap gap-12">
          <FooterCol title="Producto" links={['Funcionalidades', 'Precios', 'Changelog', 'Roadmap']} />
          <FooterCol title="Comunidad" links={['Atletas', 'Blog', 'Discord', 'Newsletter']} />
          <FooterCol title="Empresa" links={['Nosotros', 'Contacto', 'Privacidad', 'Términos']} />
        </div>
      </div>

      <div
        className="mx-auto mt-12 flex w-full max-w-7xl items-center justify-between"
        style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 20 }}
      >
        <span
          className="text-[11px] font-semibold"
          style={{ fontFamily: FONT_MONO, color: INK_FAINT }}
        >
          © 2026 · RALLYIQ LABS
        </span>
        <div className="flex items-center gap-4">
          <span className="text-[11px]" style={{ fontFamily: FONT_MONO, color: INK_FAINT }}>v2.4.0</span>
          <span className="text-[11px]" style={{ fontFamily: FONT_MONO, color: INK_FAINT }}>BUILT IN BUENOS AIRES</span>
        </div>
      </div>
    </footer>
  )
}

function FooterCol({ title, links }: { title: string; links: string[] }) {
  return (
    <div>
      <h4
        className="mb-4 text-[13px] font-bold text-white"
        style={{ fontFamily: FONT_DISPLAY }}
      >
        {title}
      </h4>
      <ul className="space-y-2.5">
        {links.map((l) => (
          <li key={l}>
            <a
              href="#"
              className="text-[13px] transition-colors hover:text-white"
              style={{ color: INK_MUTED }}
            >
              {l}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ───────────────────────────────────────────────────────── SHARED ICONS */

function BoltIcon() {
  return (
    <span
      className="relative flex h-8 w-8 items-center justify-center"
      style={{
        borderRadius: '10px',
        background: 'linear-gradient(145deg, #1a120e 0%, #0a0706 100%)',
        boxShadow: `0 0 0 1px ${BRAND}40, inset 0 1px 0 rgba(255,255,255,0.05), 0 6px 20px rgba(0,0,0,0.5)`,
      }}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
        <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill={BRAND} />
      </svg>
    </span>
  )
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

/* ───────────────────────────────────────────────────────── GLOBAL CSS */

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

  html { scroll-behavior: smooth; }

  .section-padding { padding: 80px 0; }

  .label-mono {
    display: inline-flex; align-items: center;
    font-family: ${FONT_MONO};
    font-size: 10px; font-weight: 600;
    letter-spacing: 0.3em; text-transform: uppercase;
    color: ${BRAND}; margin-bottom: 14px;
  }
  .label-mono.lime { color: ${FORGE_LIME}; }
  .label-mono.brand { color: ${BRAND_LIGHT}; }

  .btn-primary-pill {
    background: linear-gradient(135deg, ${BRAND} 0%, ${BRAND_LIGHT} 100%);
    box-shadow: 0 0 0 1px rgba(255,255,255,0.06) inset, 0 10px 30px -12px rgba(255,77,0,0.5);
    transition: transform .15s, box-shadow .15s;
  }
  .btn-primary-pill:hover {
    transform: translateY(-1px);
    box-shadow: 0 0 0 1px rgba(255,255,255,0.08) inset, 0 16px 36px -12px rgba(255,77,0,0.6);
  }
  .btn-primary-pill:active { transform: scale(0.97); }

  .nav-link:hover { color: #fff !important; }

  .disc-link:hover { color: ${BRAND} !important; border-color: ${BRAND} !important; }

  /* Discipline cards */
  .disc-card .disc-art {
    filter: grayscale(1) contrast(1.05) brightness(0.75);
    transition: filter .6s ease, transform .6s ease;
  }
  .disc-card:hover .disc-art {
    filter: grayscale(0) contrast(1) brightness(0.95);
    transform: scale(1.05);
  }
  .disc-card:hover .disc-hover-glow { opacity: 1 !important; }
  .disc-card:hover .disc-hover-body { opacity: 1 !important; }
  .disc-card:hover .disc-line { width: 64px !important; }
  .disc-card { transition: border-color .3s; }
  .disc-card:hover { border-color: rgba(255,77,0,0.35) !important; }

  .hero-bg-glow {
    filter: blur(90px);
    opacity: 0.5;
    z-index: 0;
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.55; transform: scale(1.15); }
  }
  .animate-pulse { animation: pulse-dot 1.8s ease-in-out infinite; }
`

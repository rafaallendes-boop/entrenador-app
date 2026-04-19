import { useEffect, useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  Brain,
  CheckCircle2,
  Headphones,
  MoreVertical,
  RefreshCw,
  Send,
  Sparkles,
  UserPlus,
  Zap,
} from 'lucide-react'
import { isSupabaseConfigured } from '../services/auth'
import { useAuthStore } from '../store/useAuthStore'

const BRAND = '#ff4d00'
const BRAND_LIGHT = '#ff7a33'
const COOL_BLUE = '#adc7ff'
const INK_FAINT = '#8B949E'

const FONT_STACK_DISPLAY = "'Lexend', 'Inter', system-ui, sans-serif"

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
      className="relative min-h-screen w-full overflow-x-hidden text-ink antialiased"
      style={{
        background: '#0a0a0a',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <AmbientBackdrop />
      <TopNav onLogin={handleSignIn} onSignup={handleSignIn} />

      <main className="relative">
        <Hero onPrimary={handleSignIn} />
        <SocialProof />
        <BentoBenefits onTalkToRally={handleSignIn} />
        <HowItWorks />
        <DisciplinesGrid />
        <AICoachMockup />
        <AccessCard onSignup={handleSignIn} onGoogle={handleSignIn} authError={authError} authAvailable={authAvailable} />
        <Footer />
      </main>

      <style>{globalLandingCSS}</style>
    </div>
  )
}

/* ---------- Ambient backdrop ---------- */

function AmbientBackdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* Deep vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(1200px 600px at 20% -10%, rgba(255,77,0,0.18) 0%, transparent 55%), radial-gradient(900px 500px at 100% 30%, rgba(173,199,255,0.06) 0%, transparent 60%), radial-gradient(800px 600px at 60% 110%, rgba(255,77,0,0.08) 0%, transparent 60%)',
        }}
      />
      {/* Grain overlay */}
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
          mixBlendMode: 'overlay',
        }}
      />
    </div>
  )
}

/* ---------- Top nav ---------- */

function TopNav({ onLogin, onSignup }: { onLogin: () => void; onSignup: () => void }) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav
      className="fixed inset-x-0 top-0 z-50 transition-all duration-300"
      style={{
        backgroundColor: scrolled ? 'rgba(10,10,10,0.85)' : 'rgba(10,10,10,0.4)',
        backdropFilter: 'blur(18px) saturate(140%)',
        WebkitBackdropFilter: 'blur(18px) saturate(140%)',
        borderBottom: scrolled ? '1px solid rgba(255,255,255,0.05)' : '1px solid transparent',
      }}
    >
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4 md:px-8 md:py-5">
        <a href="#top" className="group flex items-center gap-2">
          <Bolt />
          <span
            className="text-xl font-black tracking-tighter text-white md:text-[1.4rem]"
            style={{ fontFamily: FONT_STACK_DISPLAY, letterSpacing: '-0.03em' }}
          >
            RallyIQ
          </span>
        </a>

        <div className="hidden items-center gap-7 md:flex">
          <NavLink href="#coach" active>Coach</NavLink>
          <NavLink href="#disciplines">Disciplines</NavLink>
          <NavLink href="#features">Features</NavLink>
          <NavLink href="#access">Pricing</NavLink>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          <button
            onClick={onLogin}
            className="hidden rounded-xl px-4 py-2 text-sm font-medium text-ink-muted transition-colors hover:text-white md:inline-flex"
          >
            Login
          </button>
          <button
            onClick={onSignup}
            className="group relative inline-flex items-center gap-1.5 overflow-hidden rounded-xl px-5 py-2.5 text-[13px] font-bold text-white transition-transform active:scale-[0.97]"
            style={{
              background: `linear-gradient(135deg, ${BRAND} 0%, ${BRAND_LIGHT} 100%)`,
              boxShadow: '0 0 0 1px rgba(255,255,255,0.06) inset, 0 10px 30px -12px rgba(255,77,0,0.5)',
            }}
          >
            <span className="relative z-10">Sign Up</span>
            <Zap className="relative z-10 h-3.5 w-3.5 opacity-90" strokeWidth={2.5} />
            <span
              className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.14), transparent)' }}
            />
          </button>
        </div>
      </div>
    </nav>
  )
}

function NavLink({
  href,
  children,
  active,
}: {
  href: string
  children: React.ReactNode
  active?: boolean
}) {
  return (
    <a
      href={href}
      className="group relative text-[13px] font-semibold tracking-tight transition-colors"
      style={{ color: active ? BRAND : INK_FAINT, fontFamily: FONT_STACK_DISPLAY }}
    >
      <span className="transition-colors group-hover:text-white">{children}</span>
      <span
        className="absolute -bottom-1 left-0 h-[2px] w-full origin-left transition-transform duration-300"
        style={{
          background: BRAND,
          transform: active ? 'scaleX(1)' : 'scaleX(0)',
        }}
      />
    </a>
  )
}

function Bolt() {
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
        <path
          d="M14 2L5 14h5l-2 8 9-12h-5l2-8z"
          fill={BRAND}
          style={{ filter: `drop-shadow(0 0 3px ${BRAND}aa)` }}
        />
        <path d="M14 2L10 12h5l-1-10z" fill={BRAND_LIGHT} opacity={0.7} />
      </svg>
    </span>
  )
}

/* ---------- Hero ---------- */

function Hero({ onPrimary }: { onPrimary: () => void }) {
  return (
    <section id="top" className="relative z-10 px-6 pt-32 pb-20 md:px-8 md:pt-40 md:pb-28">
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-16 lg:grid-cols-[1.05fr_1fr]">
        {/* Copy */}
        <div className="relative">
          <span
            className="mb-6 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.22em]"
            style={{
              color: BRAND,
              background: 'rgba(255,77,0,0.08)',
              border: '1px solid rgba(255,77,0,0.18)',
              letterSpacing: '0.22em',
            }}
          >
            <Sparkles className="h-3 w-3" strokeWidth={2.5} /> Nueva generación de coaching
          </span>

          <h1
            className="text-[2.75rem] font-extrabold leading-[1.04] tracking-[-0.035em] text-white md:text-[4.25rem]"
            style={{ fontFamily: FONT_STACK_DISPLAY }}
          >
            Rendimiento Inteligente.
            <br />
            <span
              style={{
                background: `linear-gradient(100deg, ${BRAND} 0%, ${BRAND_LIGHT} 60%, #ffb380 100%)`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Resultados de Élite.
            </span>
          </h1>

          <p className="mt-7 max-w-xl text-[17px] font-medium leading-relaxed text-ink-muted md:text-[19px]">
            Tu coach de IA integral que evoluciona contigo. Planificación técnica avanzada para atletas
            que no se conforman con lo ordinario.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <button
              onClick={onPrimary}
              className="group inline-flex items-center gap-2 rounded-xl px-7 py-4 text-[15px] font-bold text-white transition-transform active:scale-[0.97]"
              style={{
                background: `linear-gradient(135deg, ${BRAND} 0%, ${BRAND_LIGHT} 100%)`,
                boxShadow:
                  '0 0 0 1px rgba(255,255,255,0.08) inset, 0 18px 45px -18px rgba(255,77,0,0.6), 0 0 0 6px rgba(255,77,0,0.05)',
              }}
            >
              Probar coach
              <Zap className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2.5} />
            </button>
            <a
              href="#how"
              className="inline-flex items-center gap-2 rounded-xl px-7 py-4 text-[15px] font-bold text-ink transition-all"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                backdropFilter: 'blur(6px)',
              }}
            >
              Ver cómo funciona
              <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
            </a>
          </div>

          {/* Stats band */}
          <div className="mt-14 flex items-center gap-8">
            <StatPip value="4.9/5" label="Calificación Élite" />
            <div className="h-10 w-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
            <StatPip value="12k+" label="Atletas Activos" />
            <div className="h-10 w-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
            <StatPip value="24/7" label="Coach IA" accent />
          </div>
        </div>

        {/* Dashboard mock */}
        <div className="relative">
          <div
            className="absolute -inset-8 -z-10 rounded-full blur-3xl"
            style={{ background: 'radial-gradient(circle, rgba(255,77,0,0.25), transparent 60%)' }}
          />
          <DashboardMock />
        </div>
      </div>
    </section>
  )
}

function StatPip({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="flex flex-col">
      <span
        className="text-2xl font-black tracking-tight text-white md:text-[1.7rem]"
        style={{ fontFamily: FONT_STACK_DISPLAY, color: accent ? BRAND : '#fff' }}
      >
        {value}
      </span>
      <span className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-ink-faint">
        {label}
      </span>
    </div>
  )
}

function DashboardMock() {
  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      style={{
        background: 'linear-gradient(160deg, #151515 0%, #0c0c0c 100%)',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 40px 80px -30px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,77,0,0.08)',
      }}
    >
      {/* Window chrome */}
      <div
        className="flex items-center gap-2 px-4 py-3"
        style={{
          background: 'rgba(0,0,0,0.35)',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
        }}
      >
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#ff5f57' }} />
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: '#febc2e' }} />
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: BRAND }} />
        <span
          className="ml-4 font-mono text-[10px] uppercase tracking-[0.22em]"
          style={{ color: 'rgba(255,255,255,0.35)' }}
        >
          rallyiq · dashboard v2.0
        </span>
      </div>

      {/* Dashboard body */}
      <div className="relative p-5" style={{ background: '#0a0a0a' }}>
        {/* Top row: big number */}
        <div
          className="rounded-xl p-5"
          style={{
            background: 'linear-gradient(135deg, rgba(255,77,0,0.08), rgba(255,77,0,0.02))',
            border: '1px solid rgba(255,77,0,0.14)',
          }}
        >
          <div className="flex items-start justify-between">
            <div>
              <div
                className="text-[10px] font-bold uppercase tracking-[0.24em]"
                style={{ color: BRAND }}
              >
                Load Score · Semana 12
              </div>
              <div
                className="mt-2 text-6xl font-black tracking-tight text-white"
                style={{ fontFamily: FONT_STACK_DISPLAY }}
              >
                87<span className="text-2xl text-ink-muted">/100</span>
              </div>
              <div className="mt-1 text-xs font-medium text-ink-muted">
                ACWR 1.14 · óptimo
              </div>
            </div>
            <div className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ color: BRAND, background: 'rgba(255,77,0,0.1)', border: '1px solid rgba(255,77,0,0.2)' }}>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: BRAND }} />
              LIVE
            </div>
          </div>

          {/* Fake sparkline */}
          <Sparkline />
        </div>

        {/* Two cards */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <MiniCard label="SESIONES" value="5" sub="de 7 planeadas" progress={5 / 7} />
          <MiniCard label="RITMO CARDÍACO" value="164" sub="BPM · Zona 4" progress={0.75} accent />
        </div>

        {/* Bottom row */}
        <div
          className="mt-3 flex items-center justify-between rounded-xl p-3.5"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
        >
          <div className="flex items-center gap-3">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ background: 'rgba(255,77,0,0.12)', color: BRAND }}
            >
              <Brain className="h-4 w-4" strokeWidth={2.25} />
            </span>
            <div>
              <div className="text-[11px] font-bold text-white">Coach insight · hace 2m</div>
              <div className="text-[11px] text-ink-muted">Fuerza óptima para tempo mañana.</div>
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-ink-muted" strokeWidth={2.25} />
        </div>
      </div>

      {/* Floating HUD */}
      <div
        className="absolute bottom-6 right-6 hidden rounded-xl p-3.5 md:block"
        style={{
          background: 'rgba(15,15,15,0.75)',
          backdropFilter: 'blur(14px)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 20px 60px -20px rgba(0,0,0,0.8)',
        }}
      >
        <div className="text-[9px] font-bold uppercase tracking-[0.22em]" style={{ color: BRAND }}>
          HRV
        </div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-2xl font-black text-white" style={{ fontFamily: FONT_STACK_DISPLAY }}>
            68
          </span>
          <span className="text-[10px] font-bold text-ink-faint">ms</span>
        </div>
        <div className="mt-2 h-[3px] w-28 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }}>
          <div
            className="h-full"
            style={{ width: '72%', background: `linear-gradient(90deg, ${BRAND}, ${BRAND_LIGHT})` }}
          />
        </div>
      </div>
    </div>
  )
}

function MiniCard({
  label,
  value,
  sub,
  progress,
  accent,
}: {
  label: string
  value: string
  sub: string
  progress: number
  accent?: boolean
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      <div className="text-[9.5px] font-bold uppercase tracking-[0.22em] text-ink-faint">{label}</div>
      <div
        className="mt-1.5 text-3xl font-black tracking-tight text-white"
        style={{ fontFamily: FONT_STACK_DISPLAY }}
      >
        {value}
      </div>
      <div className="text-[10.5px] font-medium text-ink-muted">{sub}</div>
      <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div
          className="h-full"
          style={{
            width: `${Math.min(100, Math.max(0, progress * 100))}%`,
            background: accent ? BRAND : COOL_BLUE,
          }}
        />
      </div>
    </div>
  )
}

function Sparkline() {
  const pts = [28, 34, 30, 42, 36, 48, 44, 58, 52, 64, 60, 72, 68, 78, 82]
  const max = Math.max(...pts)
  const w = 260
  const h = 48
  const step = w / (pts.length - 1)
  const path = pts
    .map((p, i) => {
      const x = i * step
      const y = h - (p / max) * h
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
  const area = `${path} L${w} ${h} L0 ${h} Z`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-4 w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="spark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={BRAND} stopOpacity="0.45" />
          <stop offset="100%" stopColor={BRAND} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark)" />
      <path d={path} fill="none" stroke={BRAND} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ---------- Social proof ---------- */

function SocialProof() {
  const brands = ['NIKE+', 'RED BULL', 'STRAVA', 'IRONMAN', 'POLAR']
  return (
    <section
      className="relative z-10 overflow-hidden py-10"
      style={{ borderTop: '1px solid rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-6 px-6 md:flex-row md:px-8">
        <span
          className="text-[10.5px] font-bold uppercase tracking-[0.28em] text-ink-faint"
          style={{ fontFamily: FONT_STACK_DISPLAY }}
        >
          Usado por atletas de élite
        </span>
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 opacity-45">
          {brands.map((b) => (
            <span
              key={b}
              className="text-sm font-black uppercase tracking-[0.22em] text-white/85"
              style={{ fontFamily: FONT_STACK_DISPLAY }}
            >
              {b}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ---------- Bento benefits ---------- */

function BentoBenefits({ onTalkToRally }: { onTalkToRally: () => void }) {
  return (
    <section id="features" className="relative z-10 mx-auto w-full max-w-7xl px-6 py-24 md:px-8">
      <div className="mb-10 flex flex-col items-start gap-2 md:mb-14">
        <span
          className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.26em]"
          style={{
            color: BRAND,
            background: 'rgba(255,77,0,0.08)',
            border: '1px solid rgba(255,77,0,0.18)',
          }}
        >
          <span className="h-1 w-1 rounded-full" style={{ background: BRAND }} />
          Capacidades
        </span>
        <h2
          className="max-w-3xl text-[2rem] font-black leading-[1.05] tracking-[-0.025em] text-white md:text-[2.75rem]"
          style={{ fontFamily: FONT_STACK_DISPLAY }}
        >
          Diseñado como una{' '}
          <span style={{ color: BRAND }}>sala de ingeniería</span>, no como una app genérica.
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:grid-rows-[auto_auto_auto] md:gap-4">
        {/* Large main */}
        <BentoCard className="md:col-span-2 md:row-span-2">
          <div className="pointer-events-none absolute -right-12 -top-12 opacity-[0.07]">
            <Brain className="h-64 w-64" strokeWidth={0.75} />
          </div>
          <div className="relative">
            <Pill>Siguiente Nivel</Pill>
            <h3
              className="mt-5 text-4xl font-black tracking-[-0.02em] text-white md:text-[2.5rem]"
              style={{ fontFamily: FONT_STACK_DISPLAY }}
            >
              Planificación Dinámica
            </h3>
            <p className="mt-4 max-w-md text-[15.5px] leading-relaxed text-ink-muted md:text-base">
              Los algoritmos no siguen un calendario. Analizan tu sueño, estrés y carga previa para dictar tu próxima sesión con precisión quirúrgica.
            </p>
          </div>
          <div className="relative mt-10 flex flex-wrap gap-3">
            <MetricChip value="98%" label="Precisión predictiva" />
            <MetricChip value="−24%" label="Riesgo de lesión" cool />
            <MetricChip value="1.14" label="ACWR óptimo" subtle />
          </div>
        </BentoCard>

        <BentoCard>
          <RefreshCw className="h-9 w-9" style={{ color: BRAND }} strokeWidth={2} />
          <h4
            className="mt-5 text-xl font-bold tracking-tight text-white"
            style={{ fontFamily: FONT_STACK_DISPLAY }}
          >
            Adaptación en tiempo real
          </h4>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">
            ¿Saltaste una serie? Rally recalcula el resto de tu semana en milisegundos.
          </p>
        </BentoCard>

        <BentoCard>
          <BarChart3 className="h-9 w-9" style={{ color: COOL_BLUE }} strokeWidth={2} />
          <h4
            className="mt-5 text-xl font-bold tracking-tight text-white"
            style={{ fontFamily: FONT_STACK_DISPLAY }}
          >
            Alto rendimiento
          </h4>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">
            Métricas de nivel olímpico, simplificadas para el atleta ambicioso.
          </p>
        </BentoCard>

        {/* Long bottom CTA */}
        <div
          id="coach"
          className="rounded-2xl p-[1.5px] md:col-span-3"
          style={{
            background: `linear-gradient(90deg, ${BRAND} 0%, ${BRAND_LIGHT} 50%, rgba(255,77,0,0.2) 100%)`,
          }}
        >
          <div
            className="flex flex-col items-center justify-between gap-5 rounded-[14px] p-6 md:flex-row md:p-8"
            style={{ background: '#0a0a0a' }}
          >
            <div className="flex items-center gap-5">
              <div
                className="flex h-14 w-14 items-center justify-center rounded-xl"
                style={{
                  background: `linear-gradient(135deg, ${BRAND}, ${BRAND_LIGHT})`,
                  boxShadow: '0 10px 30px -10px rgba(255,77,0,0.55)',
                }}
              >
                <Headphones className="h-6 w-6 text-white" strokeWidth={2.25} />
              </div>
              <div>
                <h4
                  className="text-xl font-bold text-white md:text-2xl"
                  style={{ fontFamily: FONT_STACK_DISPLAY }}
                >
                  Coach IA 24/7
                </h4>
                <p className="text-[13.5px] text-ink-muted md:text-sm">
                  Acceso ilimitado a tu mentor deportivo digital en cualquier momento.
                </p>
              </div>
            </div>
            <button
              onClick={onTalkToRally}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-[13px] font-bold text-black transition-transform hover:scale-[1.03] active:scale-[0.97]"
            >
              Hablar con Rally <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function BentoCard({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl p-7 transition-all md:p-8 ${className}`}
      style={{
        background: 'linear-gradient(160deg, #131313 0%, #0b0b0b 100%)',
        border: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
        style={{
          background: 'radial-gradient(400px 200px at 30% 0%, rgba(255,77,0,0.08), transparent 60%)',
        }}
      />
      <div className="relative flex h-full flex-col justify-between">{children}</div>
    </div>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em]"
      style={{
        color: BRAND,
        background: 'rgba(255,77,0,0.1)',
        border: '1px solid rgba(255,77,0,0.2)',
      }}
    >
      <span className="h-1 w-1 rounded-full" style={{ background: BRAND }} />
      {children}
    </span>
  )
}

function MetricChip({
  value,
  label,
  cool,
  subtle,
}: {
  value: string
  label: string
  cool?: boolean
  subtle?: boolean
}) {
  return (
    <div
      className="flex min-w-[140px] flex-1 flex-col rounded-xl p-4"
      style={{
        background: subtle ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <span
        className="text-2xl font-black tracking-tight md:text-[1.7rem]"
        style={{
          fontFamily: FONT_STACK_DISPLAY,
          color: subtle ? '#fff' : cool ? COOL_BLUE : BRAND,
        }}
      >
        {value}
      </span>
      <span className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-ink-faint">
        {label}
      </span>
    </div>
  )
}

/* ---------- How it works ---------- */

function HowItWorks() {
  const steps = [
    {
      n: '01',
      title: 'Sincronización total',
      body: 'Conecta tus wearables. Rally absorbe datos de sueño, HRV y actividad histórica para entender tu punto de partida biológico.',
    },
    {
      n: '02',
      title: 'Análisis neuronal',
      body: 'La IA procesa miles de variables para diseñar bloques de entrenamiento que optimizan la adaptación fisiológica sin quemarte.',
    },
    {
      n: '03',
      title: 'Evolución cinética',
      body: 'A medida que mejoras, Rally se vuelve más exigente. El sistema aprende de tu fatiga para empujar tus límites con seguridad.',
    },
  ]
  return (
    <section
      id="how"
      className="relative z-10 px-6 py-24 md:px-8"
      style={{ background: '#050505', borderTop: '1px solid rgba(255,255,255,0.04)' }}
    >
      <div className="mx-auto w-full max-w-7xl">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <h2
            className="text-[2rem] font-black tracking-[-0.025em] text-white md:text-[2.75rem]"
            style={{ fontFamily: FONT_STACK_DISPLAY }}
          >
            Ingeniería del éxito
          </h2>
          <div className="mx-auto mt-4 h-[3px] w-16 rounded-full" style={{ background: BRAND }} />
        </div>

        <div className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-16">
          {steps.map((s) => (
            <div key={s.n} className="relative">
              <div
                className="pointer-events-none absolute -top-10 -left-3 select-none text-[128px] font-black leading-none"
                style={{
                  fontFamily: FONT_STACK_DISPLAY,
                  color: 'rgba(255,255,255,0.04)',
                  letterSpacing: '-0.04em',
                }}
              >
                {s.n}
              </div>
              <div className="relative z-10 pt-10">
                <h4
                  className="text-[15px] font-extrabold uppercase tracking-[0.14em]"
                  style={{ fontFamily: FONT_STACK_DISPLAY, color: BRAND }}
                >
                  {s.title}
                </h4>
                <p className="mt-4 text-[15px] leading-relaxed text-ink-muted">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ---------- Disciplines ---------- */

const DISCIPLINE_CARDS: Array<{
  title: string
  tag: string
  blurb: string
  accent: string
  image: string
  alt: string
  fallback: string
}> = [
  {
    title: 'Squash',
    tag: 'Herencia técnica',
    blurb: 'Drills técnicos, match-play y lectura de partido real.',
    accent: BRAND,
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuAehGJU9K_OKOG721C0R2W6efCxo9k4vnJS2siZJ6r47KylE_SqGjYl6wqVNmsNsHo695j0fDYZJszFHImcukQyfIt11IMQaarNd2Ju_JO4KbOGfpIv95U-mHQ7RlMX1n-Eo_TwC9xhni6GC9zE1OyJ1Q60J7BIwSTL9sqafKMUXQ4IRrNq3lXtdN-soKtqNdFpyjgcCdBGGr9Crwr85fMjflG6zgbUXMt5Dpq7zA3kDIPttPBwznZ647jYa8oaUalfRtkZpWZmlM5M',
    alt: 'Cancha de squash con iluminación dramática y pelota en movimiento',
    fallback: 'linear-gradient(150deg, rgba(255,77,0,0.25), rgba(20,10,5,1) 70%)',
  },
  {
    title: 'Running',
    tag: 'Resistencia pura',
    blurb: 'Series, tempo y progresión aeróbica con ACWR vigilado.',
    accent: COOL_BLUE,
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuB1XpnMPHAGOKmb10vEIGlEkjFFsQpBcabcXJScQFNeZQEaPTXvSuh9IdSQZxskEl5o9rXxP2EIo0-kx_XkUMUALbhNZtSKijwsqsC4GUFHE2NkF1mWHUNPRyLH4Oc6D-PhFmIn-g_h00TNJoXN78Xe4b2rTOPkppYShfhNKvujUcBTueSN24mCYAIkJlmBTi59ChH9qZwaWStenfQFC-uBew5HGgNbstLO-uO-8T_Be8lib8OQXL1IUJG-sBQl6kc7AjHzGxqGalLb',
    alt: 'Atleta en bloque de salida sobre pista nocturna',
    fallback: 'linear-gradient(150deg, rgba(173,199,255,0.18), rgba(5,10,20,1) 70%)',
  },
  {
    title: 'Strength',
    tag: 'Potencia explosiva',
    blurb: 'Fuerza máxima, potencia y transferencia a la cancha.',
    accent: BRAND,
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuDO55mUlnqFLj10LgEBdpx3rgQvK75EbYiMu-nWB81BdO2-HKxQ78wYltIQDKebUvvJ17Y5lNRVckdRnkQqZui46jajP9gaNofgQiaCnbgmHDUU4VCLg2MwRdF6nsc1ygZEVrU3BTLrh1E75USOen2NITEXCyuMGadHRmrKJ-eP-WzJd7j5OY7-DGkL31wtXzB9heXSOFD_THWJt_MYI6-HSNkIlDhaCrPerQ3qfoqLxzCbk6huvshWtbdvdGwYL1c8vslvjVV5fc2t',
    alt: 'Barra olímpica con platos en gimnasio oscuro y polvo de magnesio',
    fallback: 'linear-gradient(150deg, rgba(255,77,0,0.2), rgba(15,10,5,1) 70%)',
  },
  {
    title: 'Cycling',
    tag: 'Soporte aeróbico',
    blurb: 'Volumen de bajo impacto y build de base para días largos.',
    accent: BRAND,
    image: '/landing/cycling.jpg',
    alt: 'Ciclista de élite en posición aerodinámica sobre velódromo oscuro',
    fallback: 'linear-gradient(150deg, rgba(255,77,0,0.18), rgba(10,8,6,1) 70%)',
  },
  {
    title: 'Mobility',
    tag: 'Recuperación activa',
    blurb: 'Reset post-sesión, rango articular y desbloqueo de cadenas.',
    accent: COOL_BLUE,
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCIbwLT9cKRxWbV62Fnkn8ICVaOu9FuYhPEB4Ufh6Rtihsw-Ko7v8cU1e1kTVp5YmkF6P_hWgoHUWzclzFcapaSyTTedIlC_xqSq8nSVuQF26xJey1npfXaEcg0o8LCfdWXmLqtn9Evz1qW105Y8ehoLRN-HeXhi1wXdcSMbnvTh80OoQclnJ0SYa2av5NMuza9DfKSJ4SyIfsyy6vA0gief7BNPzyQSfDnFwYr4Xtdh-FNdqWSxkd3lwPsTyn4tzSm3czhlnp4kOhk',
    alt: 'Silueta en estudio minimalista realizando flow de movilidad al amanecer',
    fallback: 'linear-gradient(150deg, rgba(173,199,255,0.14), rgba(8,10,15,1) 70%)',
  },
]

function DisciplinesGrid() {
  return (
    <section id="disciplines" className="relative z-10 mx-auto w-full max-w-7xl px-6 py-24 md:px-8">
      <div className="mb-12 flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h2
            className="text-[2rem] font-black tracking-[-0.025em] text-white md:text-[2.5rem]"
            style={{ fontFamily: FONT_STACK_DISPLAY }}
          >
            Multidisciplina avanzada
          </h2>
          <p className="mt-2 max-w-md text-[15px] text-ink-muted">
            Originado en la intensidad del squash, evolucionado para dominar cualquier campo.
          </p>
        </div>
        <a
          href="#access"
          className="inline-flex items-center gap-2 text-sm font-bold transition-colors hover:underline"
          style={{ color: BRAND }}
        >
          Ver todas <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
        </a>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {DISCIPLINE_CARDS.map((c) => (
          <article
            key={c.title}
            className="group relative aspect-[3/4] overflow-hidden rounded-2xl"
            style={{
              background: c.fallback,
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <img
              src={c.image}
              alt={c.alt}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1200ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.08]"
              style={{ filter: 'grayscale(1) contrast(1.08) brightness(0.92)' }}
              onError={(e) => {
                const el = e.currentTarget
                el.style.display = 'none'
              }}
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgba(7,7,7,0.15) 0%, rgba(7,7,7,0.55) 55%, rgba(7,7,7,0.92) 100%)',
              }}
            />
            <div
              className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
              style={{
                background: `radial-gradient(circle at 75% 15%, ${c.accent}22, transparent 65%)`,
              }}
            />

            <div className="absolute inset-x-0 bottom-0 p-5 md:p-6">
              <div
                className="h-[1px] w-8 transition-all duration-500 group-hover:w-16"
                style={{ background: c.accent }}
              />
              <h5
                className="mt-3 text-[1.6rem] font-black tracking-tight text-white md:text-[1.75rem]"
                style={{ fontFamily: FONT_STACK_DISPLAY }}
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
                className="mt-2 max-h-0 overflow-hidden text-[12px] leading-relaxed text-white/80 opacity-0 transition-all duration-500 group-hover:max-h-24 group-hover:opacity-100"
              >
                {c.blurb}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

/* ---------- AI Coach mockup ---------- */

function AICoachMockup() {
  return (
    <section
      className="relative z-10 py-24"
      style={{ background: '#070707', borderTop: '1px solid rgba(255,255,255,0.04)' }}
    >
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 items-center gap-14 px-6 md:px-8 lg:grid-cols-2 lg:gap-16">
        <ChatMockup />
        <div>
          <span
            className="text-[11px] font-black uppercase tracking-[0.3em]"
            style={{ color: BRAND, fontFamily: FONT_STACK_DISPLAY }}
          >
            Feedback inteligente
          </span>
          <h2
            className="mt-4 text-[2.25rem] font-black leading-[1.05] tracking-[-0.025em] text-white md:text-[3rem]"
            style={{ fontFamily: FONT_STACK_DISPLAY }}
          >
            Tu coach te conoce mejor que tú mismo.
          </h2>
          <p className="mt-5 max-w-xl text-[15.5px] leading-relaxed text-ink-muted md:text-base">
            Rally no es un chatbot genérico. Es una red neuronal entrenada en fisiología del deporte que analiza tus biometrías en tiempo real para darte el consejo exacto en el momento preciso.
          </p>
          <ul className="mt-8 space-y-3.5">
            {[
              'Ajuste de carga diario según estrés y sueño',
              'Análisis técnico con video y cadencia',
              'Nutrición peri-entrenamiento personalizada',
            ].map((item) => (
              <li key={item} className="flex items-center gap-3 text-[14.5px] font-semibold text-white">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                  style={{ background: 'rgba(255,77,0,0.12)', color: BRAND }}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.5} />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function ChatMockup() {
  return (
    <div className="order-2 lg:order-1">
      <div
        className="overflow-hidden rounded-2xl"
        style={{
          background: 'linear-gradient(160deg, rgba(20,20,20,0.9), rgba(8,8,8,0.9))',
          backdropFilter: 'blur(18px)',
          border: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '0 30px 80px -30px rgba(0,0,0,0.9)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full text-white"
              style={{
                background: `linear-gradient(135deg, ${BRAND}, ${BRAND_LIGHT})`,
                fontFamily: FONT_STACK_DISPLAY,
                fontWeight: 900,
                boxShadow: '0 10px 24px -10px rgba(255,77,0,0.55)',
              }}
            >
              R
            </div>
            <div>
              <div className="text-[13.5px] font-bold text-white">Rally · Coach IA</div>
              <div
                className="mt-0.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em]"
                style={{ color: BRAND }}
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: BRAND }} />
                Online · Analizando
              </div>
            </div>
          </div>
          <MoreVertical className="h-4 w-4 text-ink-muted" />
        </div>

        {/* Messages */}
        <div className="space-y-4 p-5">
          <Bubble direction="in">
            Buen entrenamiento hoy. Tu potencia explosiva en el tercer set de sprints fue un <b>12% superior</b> a tu promedio. ¿Cómo te sientes mecánicamente?
          </Bubble>
          <Bubble direction="out">Un poco de tensión en el sóleo derecho, pero nada grave.</Bubble>
          <Bubble direction="in">
            Entendido. Mañana priorizo cadena posterior en la movilidad y reduzco 15% el volumen de impacto. Revisa el nuevo plan ✓
          </Bubble>
        </div>

        {/* Input */}
        <div
          className="flex items-center gap-2 p-4"
          style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
        >
          <div
            className="flex-1 rounded-lg px-4 py-2.5 text-[13px]"
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.05)',
              color: 'rgba(255,255,255,0.4)',
            }}
          >
            Escribe un mensaje…
          </div>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-lg text-white transition-transform active:scale-90"
            style={{
              background: `linear-gradient(135deg, ${BRAND}, ${BRAND_LIGHT})`,
              boxShadow: '0 10px 24px -10px rgba(255,77,0,0.55)',
            }}
            aria-label="Enviar"
          >
            <Send className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </div>
  )
}

function Bubble({
  direction,
  children,
}: {
  direction: 'in' | 'out'
  children: React.ReactNode
}) {
  if (direction === 'in') {
    return (
      <div className="flex justify-start">
        <div
          className="max-w-[80%] rounded-2xl rounded-tl-sm px-4 py-3 text-[13.5px] text-white/90"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {children}
        </div>
      </div>
    )
  }
  return (
    <div className="flex justify-end">
      <div
        className="max-w-[80%] rounded-2xl rounded-tr-sm px-4 py-3 text-[13.5px] font-medium"
        style={{
          color: '#ffe3cf',
          background: 'rgba(255,77,0,0.12)',
          border: '1px solid rgba(255,77,0,0.25)',
        }}
      >
        {children}
      </div>
    </div>
  )
}

/* ---------- Access card ---------- */

function AccessCard({
  onSignup,
  onGoogle,
  authError,
  authAvailable,
}: {
  onSignup: () => void
  onGoogle: () => void
  authError: string | null
  authAvailable: boolean
}) {
  return (
    <section id="access" className="relative z-10 px-6 py-24 md:px-8">
      <div
        className="relative mx-auto w-full max-w-4xl overflow-hidden rounded-3xl p-10 md:p-14"
        style={{
          background: 'linear-gradient(160deg, #121212 0%, #0a0a0a 100%)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {/* Glow blobs */}
        <div
          className="pointer-events-none absolute -top-32 -left-32 h-80 w-80 rounded-full blur-3xl"
          style={{ background: 'rgba(255,77,0,0.18)' }}
        />
        <div
          className="pointer-events-none absolute -bottom-32 -right-32 h-80 w-80 rounded-full blur-3xl"
          style={{ background: 'rgba(173,199,255,0.08)' }}
        />

        <div className="relative text-center">
          <h2
            className="text-[2.25rem] font-black tracking-[-0.025em] text-white md:text-[2.75rem]"
            style={{ fontFamily: FONT_STACK_DISPLAY }}
          >
            Empieza tu evolución
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-ink-muted">
            Únete a la élite y transforma tus datos en rendimiento puro. Tu primera semana de coach premium es cortesía de la casa.
          </p>

          <div className="mx-auto mt-9 flex max-w-lg flex-col justify-center gap-3 sm:flex-row">
            <button
              onClick={onSignup}
              disabled={!authAvailable}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-7 py-4 text-[14.5px] font-bold text-white transition-transform active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: `linear-gradient(135deg, ${BRAND}, ${BRAND_LIGHT})`,
                boxShadow: '0 18px 45px -18px rgba(255,77,0,0.55)',
              }}
            >
              Crear cuenta <UserPlus className="h-4 w-4" strokeWidth={2.25} />
            </button>
            <button
              onClick={onGoogle}
              disabled={!authAvailable}
              className="inline-flex items-center justify-center gap-3 rounded-xl bg-white px-7 py-4 text-[14.5px] font-bold text-black transition-transform hover:bg-white/95 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <GoogleIcon />
              Continuar con Google
            </button>
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

          <p className="mt-8 text-[12px] text-ink-faint">
            ¿Ya eres parte de RallyIQ?{' '}
            <button
              onClick={onSignup}
              className="font-bold text-white underline-offset-2 transition-colors hover:underline"
              style={{ color: '#fff' }}
            >
              Iniciar sesión
            </button>
          </p>
        </div>
      </div>
    </section>
  )
}

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

/* ---------- Footer ---------- */

function Footer() {
  return (
    <footer
      className="relative z-10 px-6 py-14 md:px-8"
      style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: '#050505' }}
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-6 md:flex-row">
        <div className="flex items-center gap-3">
          <Bolt />
          <div>
            <div
              className="text-[15px] font-black tracking-tight text-white"
              style={{ fontFamily: FONT_STACK_DISPLAY }}
            >
              RallyIQ
            </div>
            <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-ink-faint">
              © 2026 · Engineered for kinetic performance
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2">
          {['Product', 'Coach', 'Contact', 'Privacy', 'Terms'].map((label) => (
            <a
              key={label}
              href="#"
              className="text-[11px] font-bold uppercase tracking-[0.22em] text-ink-faint transition-colors hover:text-white"
              style={{ fontFamily: FONT_STACK_DISPLAY }}
            >
              {label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  )
}

/* ---------- Global helpers ---------- */

const globalLandingCSS = `
  @keyframes pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.55; transform: scale(1.15); }
  }
  .animate-pulse { animation: pulse-dot 1.8s ease-in-out infinite; }
  html { scroll-behavior: smooth; }
`

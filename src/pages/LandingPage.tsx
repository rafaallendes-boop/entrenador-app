import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Dumbbell,
  Gauge,
  LineChart,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  Zap,
} from 'lucide-react'
import { isSupabaseConfigured } from '../services/auth'
import { useAuthStore } from '../store/useAuthStore'
import SharedPublicNav from '../components/SharedPublicNav'

const BRAND = '#ff4d00'
const BRAND_LIGHT = '#ff7a33'
const FORGE_LIME = '#d1fc00'
const FORGE_CYAN = '#00e3fd'
const FORGE_EMBER = '#ffeb9c'
const INK = '#f5f5f7'
const INK_MUTED = '#a0a0a5'
const INK_FAINT = '#6e6e73'
const SURFACE_BORDER = 'rgba(255,255,255,0.08)'
const FONT_DISPLAY = "'Lexend', 'Inter', system-ui, sans-serif"
const FONT_MONO = "'JetBrains Mono', 'Fira Mono', monospace"

const HERO_STATS = [
  { value: '5', unit: ' deportes', label: 'un solo plan' },
  { value: '12', unit: ' semanas', label: 'macro plan' },
  { value: '<90', unit: ' s', label: 'registro' },
  { value: '24/7', unit: '', label: 'RallyIQ AI' },
] as const

const TRUST_POINTS = [
  'Plan Builder por evento',
  'Taper y activacion final',
  'Carga de squash + fuerza + running',
  'Coach AI con contexto',
] as const

const SYSTEM_CARDS = [
  {
    icon: <CalendarDays size={18} strokeWidth={2.2} />,
    eyebrow: 'Plan Builder',
    title: 'Microciclos para llegar fresco al partido',
    body: 'Construye semanas desde el evento objetivo: base, build, peak, taper y activacion final. El match play fuerte queda lejos del ultimo dia.',
    accent: BRAND,
  },
  {
    icon: <Activity size={18} strokeWidth={2.2} />,
    eyebrow: 'Carga competitiva',
    title: 'Una sola lectura de fatiga real',
    body: 'Une squash, fuerza, running y movilidad para entender strain, adherencia y riesgo antes de sumar intensidad.',
    accent: FORGE_CYAN,
  },
  {
    icon: <Dumbbell size={18} strokeWidth={2.2} />,
    eyebrow: 'Preparacion fisica',
    title: 'Fuerza que transfiere a la cancha',
    body: 'Piernas, core, potencia lateral y prevencion. La app evita mezclar sesiones pesadas justo antes de competir.',
    accent: FORGE_EMBER,
  },
  {
    icon: <Sparkles size={18} strokeWidth={2.2} />,
    eyebrow: 'RallyIQ AI',
    title: 'Ajustes aplicables, no consejos sueltos',
    body: 'Si duermes mal o sube el RPE, RallyIQ propone bajar carga, mover sesiones o cambiar el objetivo del dia.',
    accent: FORGE_LIME,
  },
] as const

const PHASES = [
  { label: 'Base', note: 'volumen y tecnica', load: 58, color: FORGE_CYAN },
  { label: 'Build', note: 'presion + fuerza', load: 72, color: FORGE_EMBER },
  { label: 'Peak', note: 'rally intenso', load: 84, color: BRAND_LIGHT },
  { label: 'Taper', note: 'bajar fatiga', load: 46, color: FORGE_LIME },
  { label: 'Match', note: 'control + activacion', load: 26, color: BRAND },
] as const

const WORKFLOW = [
  {
    num: '01',
    title: 'Define el evento',
    body: 'Fecha, prioridad, disponibilidad, dias de doble sesion y restricciones reales de tu semana.',
  },
  {
    num: '02',
    title: 'Genera el bloque',
    body: 'RallyIQ distribuye tecnica, match play, fisico, movilidad y descarga con coherencia entre semanas.',
  },
  {
    num: '03',
    title: 'Entrena y registra',
    body: 'Cada sesion suma RPE, duracion, sensacion y notas. El registro esta pensado para hacerse al salir de cancha.',
  },
  {
    num: '04',
    title: 'Ajusta sin improvisar',
    body: 'El coach AI propone cambios concretos cuando la fatiga, el sueno o la carga rompen el plan original.',
  },
] as const

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
      setAuthError('No pudimos iniciar sesion. Intenta de nuevo.')
    }
  }

  return (
    <div
      className="relative min-h-screen w-full overflow-x-hidden antialiased"
      style={{
        background: '#070707',
        color: INK,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <SharedPublicNav onLogin={handleSignIn} onSignup={handleSignIn} scrollAware />

      <main>
        <Hero onPrimary={handleSignIn} />
        <TrustStrip />
        <DisciplinesGrid />
        <SquashSystem />
        <WorkflowSection />
        <CompetitionBlock />
        <CoachIntelligence />
        <MethodProof />
        <AccessCard
          onSignup={handleSignIn}
          authError={authError}
          authAvailable={authAvailable}
        />
      </main>

      <Footer />
      <style>{css}</style>
    </div>
  )
}

function Hero({ onPrimary }: { onPrimary: () => void }) {
  return (
    <section id="top" className="hero-shell relative overflow-hidden">
      <HeroScene />
      <div className="relative z-10 mx-auto flex min-h-[780px] w-full max-w-7xl items-center px-6 pb-20 pt-28 md:px-10 md:pt-32">
        <div className="max-w-[720px]">
          <div className="label-mono brand mb-6">
            Multideporte · beta privada
          </div>
          <h1
            className="max-w-[760px] text-5xl font-black leading-[1.02] text-white md:text-7xl"
            style={{ fontFamily: FONT_DISPLAY }}
          >
            Un solo plan para todo lo que entrenas.
          </h1>
          <p
            className="mt-6 max-w-[600px] text-[17px] font-medium leading-8 md:text-lg"
            style={{ color: INK_MUTED }}
          >
            RallyIQ une squash, fuerza, running, movilidad y ciclismo en una sola carga
            semanal. Originado en la intensidad del squash, evolucionado para preparar
            cualquier objetivo — con un coach AI que ajusta taper, fatiga y recuperacion.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              onClick={onPrimary}
              className="btn-primary-pill group inline-flex items-center gap-2 rounded-xl px-7 py-4 text-[15px] font-bold text-white"
            >
              Crear mi plan
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2.5} />
            </button>
            <Link
              to="/features"
              className="inline-flex items-center gap-2 rounded-xl px-7 py-4 text-[15px] font-bold transition-all"
              style={{
                color: INK,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.09)',
                textDecoration: 'none',
              }}
            >
              Ver sistema
            </Link>
          </div>

          <div className="mt-10 grid max-w-[680px] grid-cols-2 gap-3 sm:grid-cols-4">
            {HERO_STATS.map((stat) => (
              <ProofStat key={stat.label} {...stat} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function HeroScene() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="court-backdrop absolute inset-0" />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-[linear-gradient(180deg,transparent,#070707)]" />
      <div className="hero-vignette absolute inset-0" />

      <div className="hero-product-scene absolute right-[-160px] top-28 hidden w-[720px] lg:block">
        <div className="relative">
          <CourtBlueprint />
          <div className="absolute right-28 top-12">
            <PlanPhoneMockup />
          </div>
          <div className="absolute left-8 top-44">
            <MatchReadinessPanel />
          </div>
          <div className="absolute bottom-10 left-40">
            <TaperPanel />
          </div>
        </div>
      </div>

      <div className="absolute bottom-10 right-6 hidden w-[320px] opacity-80 md:block md:right-10 lg:hidden">
        <PlanPhoneMockup compact />
      </div>
    </div>
  )
}

function ProofStat({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <div
      className="rounded-xl px-4 py-4"
      style={{
        background: 'rgba(20,20,20,0.58)',
        border: `1px solid ${SURFACE_BORDER}`,
        boxShadow: '0 18px 60px -46px rgba(0,0,0,0.95)',
      }}
    >
      <div
        className="text-2xl font-bold leading-none"
        style={{ fontFamily: FONT_MONO, color: INK }}
      >
        {value}
        {unit && <span className="text-sm font-medium" style={{ color: INK_FAINT }}>{unit}</span>}
      </div>
      <div
        className="mt-2 text-[9px] font-semibold uppercase tracking-[0.22em]"
        style={{ fontFamily: FONT_MONO, color: INK_FAINT }}
      >
        {label}
      </div>
    </div>
  )
}

function CourtBlueprint() {
  return (
    <div className="court-blueprint relative h-[600px] w-[640px]">
      <div className="court-line court-line-front" />
      <div className="court-line court-line-mid" />
      <div className="court-line court-line-service" />
      <div className="court-line court-line-left" />
      <div className="court-line court-line-right" />
      <div className="court-line court-line-box-l" />
      <div className="court-line court-line-box-r" />
    </div>
  )
}

function PlanPhoneMockup({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className="app-phone"
      style={{
        width: compact ? 250 : 330,
        height: compact ? 520 : 680,
      }}
    >
      <div className="phone-notch" />
      <div className="h-full px-4 pb-4 pt-11">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.24em]" style={{ fontFamily: FONT_MONO, color: INK_FAINT }}>
              Semana 09 · taper
            </p>
            <h3 className="mt-1 text-xl font-black text-white" style={{ fontFamily: FONT_DISPLAY }}>
              Regional Open
            </h3>
          </div>
          <span
            className="rounded-full px-2.5 py-1 text-[10px] font-bold"
            style={{ background: 'rgba(209,252,0,0.12)', color: FORGE_LIME, border: '1px solid rgba(209,252,0,0.24)' }}
          >
            82%
          </span>
        </div>

        <div className="phone-card mb-3">
          <div className="mb-3 flex items-center justify-between">
            <span className="mono-caption" style={{ color: BRAND_LIGHT }}>Hoy · cancha</span>
            <span className="mono-caption">55 min</span>
          </div>
          <h4 className="text-sm font-bold text-white" style={{ fontFamily: FONT_DISPLAY }}>
            Control + patrones de salida
          </h4>
          <p className="mt-1 text-[11px] leading-5" style={{ color: INK_MUTED }}>
            RPE 6. Nada de match largo. Ultimos 12 min de activacion y velocidad.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            <PhoneMetric label="T" value="55" />
            <PhoneMetric label="RPE" value="6" color={FORGE_LIME} />
            <PhoneMetric label="Load" value="330" color={BRAND_LIGHT} />
          </div>
        </div>

        <div className="phone-card mb-3">
          <div className="mb-3 flex items-center justify-between">
            <span className="mono-caption" style={{ color: FORGE_CYAN }}>Plan Builder</span>
            <span className="mono-caption">12 sem</span>
          </div>
          <div className="space-y-2">
            {PHASES.map((phase) => (
              <div key={phase.label}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-white" style={{ fontFamily: FONT_DISPLAY }}>
                    {phase.label}
                  </span>
                  <span className="text-[9px]" style={{ fontFamily: FONT_MONO, color: INK_FAINT }}>{phase.note}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                  <div className="h-full rounded-full" style={{ width: `${phase.load}%`, background: phase.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="phone-card">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: 'rgba(0,227,253,0.12)', color: FORGE_CYAN }}>
              <Sparkles size={13} strokeWidth={2.4} />
            </span>
            <span className="mono-caption" style={{ color: FORGE_CYAN }}>RallyIQ recomienda</span>
          </div>
          <p className="text-[12px] leading-5 text-white">
            Mueve el match fuerte a 4 dias antes. Mantiene activacion el ultimo dia.
          </p>
          <button className="mt-3 w-full rounded-lg px-3 py-2 text-[11px] font-bold text-white" style={{ background: BRAND }}>
            Aplicar ajuste
          </button>
        </div>
      </div>
    </div>
  )
}

function PhoneMetric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.03] px-2 py-2">
      <div className="text-[8px] uppercase tracking-[0.2em]" style={{ fontFamily: FONT_MONO, color: INK_FAINT }}>
        {label}
      </div>
      <div className="mt-1 text-sm font-bold" style={{ fontFamily: FONT_MONO, color: color ?? INK }}>
        {value}
      </div>
    </div>
  )
}

function MatchReadinessPanel() {
  return (
    <div className="scene-panel w-[260px] p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="mono-caption" style={{ color: BRAND_LIGHT }}>Readiness</span>
        <Gauge size={15} style={{ color: BRAND_LIGHT }} />
      </div>
      <div className="flex items-end gap-3">
        <span className="text-5xl font-black text-white" style={{ fontFamily: FONT_MONO }}>88</span>
        <div className="pb-1">
          <p className="text-xs font-semibold text-white">Listo para competir</p>
          <p className="mt-1 text-[11px]" style={{ color: INK_MUTED }}>Carga aguda controlada</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <PanelMetric label="Sueno" value="7.6h" color={FORGE_LIME} />
        <PanelMetric label="RPE" value="6.4" color={FORGE_CYAN} />
        <PanelMetric label="Dolor" value="1/10" color={FORGE_EMBER} />
      </div>
    </div>
  )
}

function TaperPanel() {
  return (
    <div className="scene-panel w-[300px] p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="mono-caption" style={{ color: FORGE_LIME }}>Semana de torneo</span>
        <Trophy size={15} style={{ color: FORGE_LIME }} />
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {['M', 'T', 'W', 'T', 'F'].map((day, index) => (
          <div
            key={`${day}-${index}`}
            className="rounded-lg px-2 py-3 text-center"
            style={{
              background: index === 1 ? 'rgba(255,77,0,0.18)' : index === 4 ? 'rgba(209,252,0,0.14)' : 'rgba(255,255,255,0.04)',
              border: index === 1 ? '1px solid rgba(255,77,0,0.32)' : index === 4 ? '1px solid rgba(209,252,0,0.28)' : '1px solid rgba(255,255,255,0.05)',
            }}
          >
            <div className="text-[9px] font-bold" style={{ fontFamily: FONT_MONO, color: INK_FAINT }}>{day}</div>
            <div className="mt-2 h-1.5 rounded-full" style={{ background: index === 1 ? BRAND : index === 4 ? FORGE_LIME : 'rgba(255,255,255,0.18)' }} />
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-5" style={{ color: INK_MUTED }}>
        Match play fuerte martes. Viernes solo activacion y control.
      </p>
    </div>
  )
}

function PanelMetric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="text-[8px] uppercase tracking-[0.18em]" style={{ fontFamily: FONT_MONO, color: INK_FAINT }}>
        {label}
      </div>
      <div className="mt-1 text-xs font-bold" style={{ fontFamily: FONT_MONO, color }}>
        {value}
      </div>
    </div>
  )
}

function TrustStrip() {
  return (
    <section className="border-y border-white/[0.06] bg-[#090909] py-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-6 md:flex-row md:items-center md:justify-between md:px-10">
        <span className="text-[10px] font-bold uppercase tracking-[0.28em]" style={{ fontFamily: FONT_MONO, color: INK_FAINT }}>
          Diseñado para jugadores que compiten
        </span>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {TRUST_POINTS.map((point) => (
            <span key={point} className="inline-flex items-center gap-2 text-sm font-semibold text-white">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: BRAND }} />
              {point}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

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
    tag: 'Herencia tecnica',
    blurb: 'Drills tecnicos, match-play y lectura de partido real.',
    accent: BRAND,
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuAehGJU9K_OKOG721C0R2W6efCxo9k4vnJS2siZJ6r47KylE_SqGjYl6wqVNmsNsHo695j0fDYZJszFHImcukQyfIt11IMQaarNd2Ju_JO4KbOGfpIv95U-mHQ7RlMX1n-Eo_TwC9xhni6GC9zE1OyJ1Q60J7BIwSTL9sqafKMUXQ4IRrNq3lXtdN-soKtqNdFpyjgcCdBGGr9Crwr85fMjflG6zgbUXMt5Dpq7zA3kDIPttPBwznZ647jYa8oaUalfRtkZpWZmlM5M',
    alt: 'Cancha de squash con iluminacion dramatica',
    fallback: 'linear-gradient(150deg, rgba(255,77,0,0.25), rgba(20,10,5,1) 70%)',
  },
  {
    title: 'Running',
    tag: 'Resistencia pura',
    blurb: 'Series, tempo y progresion aerobica con carga vigilada.',
    accent: FORGE_CYAN,
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuB1XpnMPHAGOKmb10vEIGlEkjFFsQpBcabcXJScQFNeZQEaPTXvSuh9IdSQZxskEl5o9rXxP2EIo0-kx_XkUMUALbhNZtSKijwsqsC4GUFHE2NkF1mWHUNPRyLH4Oc6D-PhFmIn-g_h00TNJoXN78Xe4b2rTOPkppYShfhNKvujUcBTueSN24mCYAIkJlmBTi59ChH9qZwaWStenfQFC-uBew5HGgNbstLO-uO-8T_Be8lib8OQXL1IUJG-sBQl6kc7AjHzGxqGalLb',
    alt: 'Atleta en bloque de salida sobre pista nocturna',
    fallback: 'linear-gradient(150deg, rgba(0,227,253,0.18), rgba(5,10,20,1) 70%)',
  },
  {
    title: 'Fuerza',
    tag: 'Potencia explosiva',
    blurb: 'Fuerza maxima, potencia y transferencia a la cancha.',
    accent: BRAND,
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuDO55mUlnqFLj10LgEBdpx3rgQvK75EbYiMu-nWB81BdO2-HKxQ78wYltIQDKebUvvJ17Y5lNRVckdRnkQqZui46jajP9gaNofgQiaCnbgmHDUU4VCLg2MwRdF6nsc1ygZEVrU3BTLrh1E75USOen2NITEXCyuMGadHRmrKJ-eP-WzJd7j5OY7-DGkL31wtXzB9heXSOFD_THWJt_MYI6-HSNkIlDhaCrPerQ3qfoqLxzCbk6huvshWtbdvdGwYL1c8vslvjVV5fc2t',
    alt: 'Barra olimpica en gimnasio oscuro',
    fallback: 'linear-gradient(150deg, rgba(255,77,0,0.2), rgba(15,10,5,1) 70%)',
  },
  {
    title: 'Ciclismo',
    tag: 'Soporte aerobico',
    blurb: 'Volumen de bajo impacto y build de base para dias largos.',
    accent: FORGE_CYAN,
    image: '/landing/cycling.jpg',
    alt: 'Ciclista de elite en posicion aerodinamica',
    fallback: 'linear-gradient(150deg, rgba(0,227,253,0.15), rgba(10,8,6,1) 70%)',
  },
  {
    title: 'Movilidad',
    tag: 'Recuperacion activa',
    blurb: 'Reset post-sesion, rango articular y desbloqueo de cadenas.',
    accent: FORGE_LIME,
    image:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCIbwLT9cKRxWbV62Fnkn8ICVaOu9FuYhPEB4Ufh6Rtihsw-Ko7v8cU1e1kTVp5YmkF6P_hWgoHUWzclzFcapaSyTTedIlC_xqSq8nSVuQF26xJey1npfXaEcg0o8LCfdWXmLqtn9Evz1qW105Y8ehoLRN-HeXhi1wXdcSMbnvTh80OoQclnJ0SYa2av5NMuza9DfKSJ4SyIfsyy6vA0gief7BNPzyQSfDnFwYr4Xtdh-FNdqWSxkd3lwPsTyn4tzSm3czhlnp4kOhk',
    alt: 'Silueta realizando flow de movilidad al amanecer',
    fallback: 'linear-gradient(150deg, rgba(209,252,0,0.14), rgba(8,10,15,1) 70%)',
  },
]

function DisciplinesGrid() {
  return (
    <section id="disciplines" className="landing-section pt-0">
      <div className="mx-auto w-full max-w-7xl px-6 md:px-10">
        <div className="mb-10 flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <div>
            <div className="label-mono mb-4">Multidisciplina</div>
            <h2
              className="text-[2rem] font-bold leading-[1.05] tracking-[-0.02em] text-white md:text-[3rem]"
              style={{ fontFamily: FONT_DISPLAY }}
            >
              Cinco deportes,
              <br />
              <span style={{ color: BRAND }}>una sola carga.</span>
            </h2>
            <p className="mt-3 max-w-[400px] text-[15px] leading-[1.55]" style={{ color: INK_MUTED }}>
              Originado en la intensidad del squash, evolucionado para dominar cualquier campo.
              Cinco lenguajes distintos que RallyIQ lee como una sola semana.
            </p>
          </div>
          <Link
            to="/features"
            className="disc-link inline-flex items-center gap-2.5 pb-1.5 font-bold uppercase transition-colors"
            style={{
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: '0.26em',
              color: BRAND_LIGHT,
              borderBottom: '1px solid rgba(255,77,0,0.3)',
              textDecoration: 'none',
            }}
          >
            Ver todas <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
          {DISCIPLINE_CARDS.map((card) => (
            <article
              key={card.title}
              className="disc-card group relative overflow-hidden rounded-2xl"
              style={{
                aspectRatio: '3 / 4',
                background: card.fallback,
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <img
                src={card.image}
                alt={card.alt}
                loading="lazy"
                decoding="async"
                draggable={false}
                className="disc-art absolute inset-0 h-full w-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'linear-gradient(180deg, transparent 40%, rgba(8,8,8,0.65) 75%, rgba(8,8,8,0.95) 100%)',
                }}
              />
              <div
                className="disc-hover-glow pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500"
                style={{ background: `radial-gradient(circle at 75% 15%, ${card.accent}22, transparent 65%)` }}
              />
              <div className="absolute inset-x-0 bottom-0 z-10 p-5 md:p-6">
                <div className="disc-line mb-3 h-px transition-all duration-500" style={{ width: 32, background: card.accent }} />
                <h5
                  className="text-[1.35rem] font-black leading-tight tracking-tight text-white md:text-[1.5rem]"
                  style={{ fontFamily: FONT_DISPLAY, marginBottom: 4 }}
                >
                  {card.title}
                </h5>
                <span className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: card.accent }}>
                  {card.tag}
                </span>
                <p className="disc-blurb mt-2 text-[12px] leading-relaxed text-white/80">{card.blurb}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function SquashSystem() {
  return (
    <section id="system" className="landing-section">
      <div className="mx-auto w-full max-w-7xl px-6 md:px-10">
        <SectionHeader
          label="Sistema de entrenamiento"
          title={<>Todo lo que afecta tu rendimiento, en una sola pantalla.</>}
          body="No alcanza con sumar sesiones. Necesitas ordenar intensidad, fuerza, recuperacion y taper entre todos tus deportes para que el cuerpo llegue listo cuando importa."
        />

        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-4">
          {SYSTEM_CARDS.map((card) => (
            <SystemCard key={card.title} {...card} />
          ))}
        </div>
      </div>
    </section>
  )
}

function SystemCard({
  icon,
  eyebrow,
  title,
  body,
  accent,
}: {
  icon: ReactNode
  eyebrow: string
  title: string
  body: string
  accent: string
}) {
  return (
    <article
      className="system-card relative overflow-hidden rounded-2xl p-6"
      style={{
        background: 'linear-gradient(180deg, rgba(24,24,24,0.72), rgba(12,12,12,0.9))',
        border: `1px solid ${SURFACE_BORDER}`,
      }}
    >
      <div
        className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl"
        style={{ color: accent, background: `${accent}14`, border: `1px solid ${accent}28` }}
      >
        {icon}
      </div>
      <div className="mono-caption mb-3" style={{ color: accent }}>{eyebrow}</div>
      <h3 className="text-xl font-bold leading-snug text-white" style={{ fontFamily: FONT_DISPLAY }}>
        {title}
      </h3>
      <p className="mt-4 text-sm leading-6" style={{ color: INK_MUTED }}>
        {body}
      </p>
    </article>
  )
}

function WorkflowSection() {
  return (
    <section className="landing-section pt-0">
      <div className="mx-auto w-full max-w-7xl px-6 md:px-10">
        <SectionHeader
          label="Flujo de trabajo"
          title={<>De evento objetivo a semana entrenable.</>}
          body="La app no intenta reemplazar criterio tecnico. Lo ordena: primero objetivo, luego estructura, despues registro y ajustes con datos."
        />

        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-4">
          {WORKFLOW.map((item) => (
            <article
              key={item.num}
              className="relative overflow-hidden rounded-2xl p-6"
              style={{ background: 'rgba(24,24,24,0.52)', border: `1px solid ${SURFACE_BORDER}` }}
            >
              <div
                className="absolute right-4 top-2 text-7xl font-black leading-none"
                style={{ fontFamily: FONT_DISPLAY, color: 'rgba(255,255,255,0.035)' }}
              >
                {item.num}
              </div>
              <div className="mono-caption mb-6" style={{ color: BRAND_LIGHT }}>
                Paso {item.num}
              </div>
              <h3 className="relative text-xl font-bold leading-snug text-white" style={{ fontFamily: FONT_DISPLAY }}>
                {item.title}
              </h3>
              <p className="relative mt-4 text-sm leading-6" style={{ color: INK_MUTED }}>
                {item.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function CompetitionBlock() {
  return (
    <section className="landing-section pt-0">
      <div className="mx-auto w-full max-w-7xl px-6 md:px-10">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <div
            className="rounded-[22px] p-6 md:p-8"
            style={{
              background: 'linear-gradient(145deg, rgba(255,77,0,0.12), rgba(16,16,16,0.92))',
              border: '1px solid rgba(255,77,0,0.18)',
            }}
          >
            <div className="label-mono brand">Plan por torneo</div>
            <h2 className="mt-2 max-w-[620px] text-3xl font-black leading-tight text-white md:text-5xl" style={{ fontFamily: FONT_DISPLAY }}>
              El match importante empieza varias semanas antes.
            </h2>
            <p className="mt-5 max-w-[620px] text-[15px] leading-7" style={{ color: INK_MUTED }}>
              RallyIQ organiza cada fase alrededor del evento. El bloque no solo reparte sesiones:
              protege el dia final, evita fuerza pesada tarde y programa el match play competitivo
              con margen suficiente para recuperar.
            </p>

            <div className="mt-8 space-y-3">
              {PHASES.map((phase) => (
                <div key={phase.label} className="rounded-xl border border-white/[0.06] bg-black/25 px-4 py-3">
                  <div className="mb-2 flex items-center justify-between gap-4">
                    <div>
                      <span className="text-sm font-bold text-white" style={{ fontFamily: FONT_DISPLAY }}>{phase.label}</span>
                      <span className="ml-2 text-xs" style={{ color: INK_FAINT }}>{phase.note}</span>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ fontFamily: FONT_MONO, color: phase.color }}>
                      {phase.load} load
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
                    <div className="h-full rounded-full" style={{ width: `${phase.load}%`, background: phase.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <TrainingStackCard
              icon={<Target size={18} />}
              label="Squash"
              title="Tecnica, tactica y match play"
              body="Drills con objetivo, sesiones de control, partidos de practica y exposicion competitiva medida."
              color={BRAND_LIGHT}
            />
            <TrainingStackCard
              icon={<Dumbbell size={18} />}
              label="Fisico"
              title="Fuerza y potencia sin matar piernas"
              body="Sesiones compatibles con cancha: lateralidad, core, potencia y descarga antes del evento."
              color={FORGE_EMBER}
            />
            <TrainingStackCard
              icon={<ShieldCheck size={18} />}
              label="Recuperacion"
              title="Movilidad y control de riesgo"
              body="El sistema detecta acumulacion de carga y propone bajar volumen antes de que el plan se vuelva deuda."
              color={FORGE_LIME}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

function TrainingStackCard({
  icon,
  label,
  title,
  body,
  color,
}: {
  icon: ReactNode
  label: string
  title: string
  body: string
  color: string
}) {
  return (
    <article
      className="rounded-2xl p-6"
      style={{ background: 'rgba(24,24,24,0.58)', border: `1px solid ${SURFACE_BORDER}` }}
    >
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${color}12`, border: `1px solid ${color}26`, color }}>
          {icon}
        </span>
        <span className="mono-caption" style={{ color }}>{label}</span>
      </div>
      <h3 className="text-xl font-bold text-white" style={{ fontFamily: FONT_DISPLAY }}>{title}</h3>
      <p className="mt-3 text-sm leading-6" style={{ color: INK_MUTED }}>{body}</p>
    </article>
  )
}

function CoachIntelligence() {
  return (
    <section className="landing-section">
      <div className="mx-auto w-full max-w-7xl px-6 md:px-10">
        <SectionHeader
          label="Coach AI con contexto"
          title={<>Cuando el cuerpo cambia, el plan tambien.</>}
          body="El valor no esta en generar un bloque perfecto el dia uno. Esta en mantenerlo inteligente cuando aparecen mal sueno, dolor, calendario real o partidos extra."
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[22px] p-6 md:p-8" style={{ background: 'rgba(24,24,24,0.58)', border: `1px solid ${SURFACE_BORDER}` }}>
            <div className="mb-6 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: 'rgba(0,227,253,0.12)', color: FORGE_CYAN, border: '1px solid rgba(0,227,253,0.22)' }}>
                <Sparkles size={19} strokeWidth={2.4} />
              </span>
              <div>
                <div className="mono-caption" style={{ color: FORGE_CYAN }}>RallyIQ Chat</div>
                <h3 className="mt-1 text-xl font-bold text-white" style={{ fontFamily: FONT_DISPLAY }}>No pregunta desde cero.</h3>
              </div>
            </div>
            <div className="space-y-2.5">
              <ChatBubble type="user">Tengo partido el sabado y dormi mal dos noches.</ChatBubble>
              <ChatBubble type="assistant">Veo fatiga acumulada y fuerza pesada programada manana. Conviene cambiarla por activacion y mover el match play intenso a hoy.</ChatBubble>
              <ProposalCard />
            </div>
          </div>

          <div className="rounded-[22px] p-6 md:p-8" style={{ background: 'linear-gradient(145deg, rgba(209,252,0,0.08), rgba(16,16,16,0.92))', border: '1px solid rgba(209,252,0,0.16)' }}>
            <div className="grid gap-3 md:grid-cols-2">
              <CoachMetric icon={<LineChart size={16} />} label="Carga aguda" value="-18%" note="baja planificada en taper" color={FORGE_LIME} />
              <CoachMetric icon={<Gauge size={16} />} label="Readiness" value="88" note="fatiga controlada" color={FORGE_CYAN} />
              <CoachMetric icon={<Zap size={16} />} label="Activacion" value="35 min" note="ultimo dia, baja carga" color={BRAND_LIGHT} />
              <CoachMetric icon={<CheckCircle2 size={16} />} label="Adherencia" value="91%" note="semana competitiva" color={FORGE_EMBER} />
            </div>
            <div className="mt-6 rounded-2xl border border-white/[0.06] bg-black/25 p-5">
              <div className="mono-caption mb-3" style={{ color: FORGE_LIME }}>Decision del sistema</div>
              <p className="text-sm leading-6 text-white">
                Mantener tecnica y control. Evitar partido completo el ultimo dia. Priorizar sensacion
                de piernas, movilidad de cadera y primeros desplazamientos.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function ChatBubble({ type, children }: { type: 'user' | 'assistant'; children: ReactNode }) {
  const isUser = type === 'user'
  return (
    <div
      className="max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6"
      style={{
        marginLeft: isUser ? 'auto' : 0,
        background: isUser ? 'rgba(255,77,0,0.18)' : 'rgba(255,255,255,0.05)',
        border: isUser ? '1px solid rgba(255,77,0,0.28)' : `1px solid ${SURFACE_BORDER}`,
        color: isUser ? INK : INK_MUTED,
      }}
    >
      {children}
    </div>
  )
}

function ProposalCard() {
  return (
    <div className="rounded-2xl border border-brand/25 bg-brand/10 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="mono-caption" style={{ color: BRAND_LIGHT }}>Propuesta aplicable</span>
        <span className="rounded-full bg-black/25 px-2 py-1 text-[10px] font-bold" style={{ color: FORGE_LIME }}>segura</span>
      </div>
      <h4 className="text-base font-bold text-white" style={{ fontFamily: FONT_DISPLAY }}>
        Cambiar fuerza por activacion
      </h4>
      <p className="mt-2 text-xs leading-5" style={{ color: INK_MUTED }}>
        Fuerza 55 min pasa a movilidad + potencia ligera 32 min. Mantiene velocidad sin sumar fatiga residual.
      </p>
      <div className="mt-4 flex gap-2">
        <button className="rounded-lg px-3 py-2 text-xs font-bold text-white" style={{ background: BRAND }}>
          Aplicar
        </button>
        <button className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold" style={{ color: INK_MUTED }}>
          Revisar
        </button>
      </div>
    </div>
  )
}

function CoachMetric({
  icon,
  label,
  value,
  note,
  color,
}: {
  icon: ReactNode
  label: string
  value: string
  note: string
  color: string
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-black/25 p-4">
      <div className="mb-4 flex items-center justify-between">
        <span className="mono-caption">{label}</span>
        <span style={{ color }}>{icon}</span>
      </div>
      <div className="text-3xl font-black" style={{ fontFamily: FONT_MONO, color }}>{value}</div>
      <p className="mt-2 text-xs" style={{ color: INK_MUTED }}>{note}</p>
    </div>
  )
}

function MethodProof() {
  return (
    <section className="landing-section pt-0">
      <div className="mx-auto w-full max-w-7xl px-6 md:px-10">
        <div
          className="grid grid-cols-1 gap-10 rounded-[24px] p-8 md:grid-cols-[1.05fr_0.95fr] md:p-12"
          style={{ background: 'rgba(24,24,24,0.55)', border: `1px solid ${SURFACE_BORDER}` }}
        >
          <div>
            <div className="label-mono">Criterios del sistema</div>
            <h2 className="mt-4 text-3xl font-black leading-tight text-white md:text-5xl" style={{ fontFamily: FONT_DISPLAY }}>
              Preparacion seria, sin humo.
            </h2>
            <p className="mt-5 max-w-[560px] text-[15px] leading-7" style={{ color: INK_MUTED }}>
              RallyIQ muestra las reglas que usa para armar y ajustar tu semana: cuando meter
              match play, cuando descargar, que hacer el ultimo dia y como equilibrar cancha con fisico.
            </p>

            <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MethodRule label="Match play" value="3-4 dias antes" body="La exposicion competitiva fuerte no queda pegada al torneo." color={BRAND_LIGHT} />
              <MethodRule label="Ultimo dia" value="Activacion" body="Control, movilidad y velocidad corta. Nada de fatiga residual." color={FORGE_LIME} />
              <MethodRule label="Fuerza" value="Transferencia" body="Piernas, core y potencia lateral ubicadas donde no interfieren." color={FORGE_EMBER} />
              <MethodRule label="Carga" value="Unificada" body="Squash, running y fuerza se leen como una sola demanda semanal." color={FORGE_CYAN} />
            </div>
          </div>

          <div
            className="rounded-[22px] p-5 md:p-6"
            style={{
              background: 'linear-gradient(145deg, rgba(255,77,0,0.10), rgba(8,8,8,0.82))',
              border: '1px solid rgba(255,77,0,0.18)',
            }}
          >
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <div className="mono-caption" style={{ color: BRAND_LIGHT }}>Semana de torneo</div>
                <h3 className="mt-1 text-xl font-black text-white" style={{ fontFamily: FONT_DISPLAY }}>
                  Decisiones visibles
                </h3>
              </div>
              <ShieldCheck size={20} style={{ color: FORGE_LIME }} />
            </div>

            <div className="space-y-3">
              <MethodTimeline day="D-4" title="Match play competitivo" tag="estimulo alto" color={BRAND_LIGHT} />
              <MethodTimeline day="D-3" title="Fuerza ligera + movilidad" tag="bajar deuda" color={FORGE_EMBER} />
              <MethodTimeline day="D-2" title="Control tactico en cancha" tag="precision" color={FORGE_CYAN} />
              <MethodTimeline day="D-1" title="Activacion y velocidad corta" tag="fresco" color={FORGE_LIME} />
              <MethodTimeline day="DIA" title="Partido objetivo" tag="competir" color={BRAND} />
            </div>

            <div className="mt-5 rounded-2xl border border-white/[0.06] bg-black/30 p-4">
              <div className="mono-caption mb-2" style={{ color: FORGE_LIME }}>Control previo</div>
              <p className="text-sm leading-6 text-white">
                Si aparece mala recuperacion, el sistema reduce volumen antes de tocar la intensidad clave.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function MethodRule({
  label,
  value,
  body,
  color,
}: {
  label: string
  value: string
  body: string
  color: string
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-black/25 p-4">
      <div className="mono-caption" style={{ color }}>
        {label}
      </div>
      <div className="mt-3 text-2xl font-black text-white" style={{ fontFamily: FONT_DISPLAY }}>{value}</div>
      <p className="mt-2 text-xs leading-5" style={{ color: INK_MUTED }}>{body}</p>
    </div>
  )
}

function MethodTimeline({
  day,
  title,
  tag,
  color,
}: {
  day: string
  title: string
  tag: string
  color: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-black/25 px-4 py-3">
      <div
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-[11px] font-black"
        style={{ fontFamily: FONT_MONO, color, background: `${color}12`, border: `1px solid ${color}28` }}
      >
        {day}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-white" style={{ fontFamily: FONT_DISPLAY }}>{title}</p>
        <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.2em]" style={{ fontFamily: FONT_MONO, color: INK_FAINT }}>
          {tag}
        </p>
      </div>
    </div>
  )
}

function AccessCard({
  onSignup,
  authError,
  authAvailable,
}: {
  onSignup: () => void
  authError: string | null
  authAvailable: boolean
}) {
  return (
    <section id="access" className="landing-section pt-0">
      <div className="mx-auto w-full max-w-7xl px-6 md:px-10">
        <div
          className="relative overflow-hidden rounded-[28px] p-8 text-center md:p-16"
          style={{
            background: 'linear-gradient(180deg, rgba(28,20,16,0.86), rgba(10,10,10,0.96))',
            border: '1px solid rgba(255,77,0,0.18)',
            boxShadow: '0 40px 120px -50px rgba(255,77,0,0.45)',
          }}
        >
          <div className="relative z-10">
            <div className="label-mono brand justify-center">
              Acceso temprano
            </div>
            <h2 className="mx-auto mt-4 max-w-[760px] text-4xl font-black leading-tight text-white md:text-6xl" style={{ fontFamily: FONT_DISPLAY }}>
              Prepara tu proximo torneo con estructura profesional.
            </h2>
            <p className="mx-auto mt-5 max-w-[560px] text-[16px] leading-7" style={{ color: INK_MUTED }}>
              Entra a RallyIQ, crea tu evento objetivo y genera un plan competitivo que puedas entrenar,
              medir y ajustar sin salir de la app.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={onSignup}
                disabled={!authAvailable}
                className="btn-primary-pill inline-flex items-center gap-2 rounded-xl px-7 py-4 text-[15px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Empezar ahora
                <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
              </button>
              <Link
                to="/pricing"
                className="inline-flex items-center gap-2 rounded-xl px-7 py-4 text-[15px] font-bold transition-all"
                style={{
                  color: INK,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  textDecoration: 'none',
                }}
              >
                Ver precios
              </Link>
            </div>

            {authError && <p className="mt-4 text-xs font-medium text-red-300">{authError}</p>}
            {!authAvailable && (
              <div
                className="mx-auto mt-5 max-w-md rounded-xl px-4 py-3"
                style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.18)' }}
              >
                <p className="text-[12px] font-semibold text-amber-300">Auth no disponible en este entorno</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-amber-200/70">
                  Configura <code className="font-mono">VITE_SUPABASE_URL</code> y{' '}
                  <code className="font-mono">VITE_SUPABASE_ANON_KEY</code>.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function SectionHeader({
  label,
  title,
  body,
}: {
  label: string
  title: ReactNode
  body: string
}) {
  return (
    <div className="mb-12 flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
      <div className="max-w-[720px]">
        <div className="label-mono">{label}</div>
        <h2 className="mt-2 text-3xl font-black leading-tight text-white md:text-5xl" style={{ fontFamily: FONT_DISPLAY }}>
          {title}
        </h2>
      </div>
      <p className="max-w-[390px] text-sm leading-6" style={{ color: INK_MUTED }}>
        {body}
      </p>
    </div>
  )
}

function Footer() {
  return (
    <footer className="relative px-6 py-14 md:px-10" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: '#050505' }}>
      <div className="mx-auto flex w-full max-w-7xl flex-col items-start justify-between gap-8 md:flex-row">
        <div className="max-w-[280px]">
          <div className="flex items-center gap-2.5">
            <BoltIcon />
            <span className="text-[15px] font-black text-white" style={{ fontFamily: FONT_DISPLAY }}>
              RallyIQ
            </span>
          </div>
          <p className="mt-3 text-[13px] leading-relaxed" style={{ color: INK_MUTED }}>
            Planificacion premium para squash competitivo, preparacion fisica y decisiones con datos.
          </p>
        </div>

        <div className="flex flex-wrap gap-12">
          <FooterCol title="Producto" links={['Funcionalidades', 'Precios', 'Plan Builder', 'RallyIQ AI']} />
          <FooterCol title="Squash" links={['Torneos', 'Taper', 'Carga', 'Preparacion fisica']} />
          <FooterCol title="Empresa" links={['Contacto', 'Privacidad', 'Terminos']} />
        </div>
      </div>

      <div
        className="mx-auto mt-12 flex w-full max-w-7xl flex-col gap-3 border-t border-white/[0.06] pt-5 md:flex-row md:items-center md:justify-between"
      >
        <span className="text-[11px] font-semibold" style={{ fontFamily: FONT_MONO, color: INK_FAINT }}>
          © 2026 · RALLYIQ LABS
        </span>
        <span className="text-[11px]" style={{ fontFamily: FONT_MONO, color: INK_FAINT }}>HECHO EN CHILE</span>
      </div>
    </footer>
  )
}

function FooterCol({ title, links }: { title: string; links: string[] }) {
  return (
    <div>
      <h4 className="mb-4 text-[13px] font-bold text-white" style={{ fontFamily: FONT_DISPLAY }}>
        {title}
      </h4>
      <ul className="space-y-2.5">
        {links.map((link) => (
          <li key={link}>
            <a href="#" className="text-[13px] transition-colors hover:text-white" style={{ color: INK_MUTED }}>
              {link}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function BoltIcon() {
  return (
    <span
      className="relative flex h-8 w-8 items-center justify-center"
      style={{
        borderRadius: 10,
        background: 'linear-gradient(145deg, #1a120e 0%, #0a0706 100%)',
        boxShadow: `0 0 0 1px ${BRAND}40, inset 0 1px 0 rgba(255,255,255,0.05), 0 6px 20px rgba(0,0,0,0.5)`,
      }}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
        <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill={BRAND} />
      </svg>
    </span>
  )
}

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

  html { scroll-behavior: smooth; }

  .hero-shell {
    background:
      linear-gradient(90deg, rgba(7,7,7,0.98) 0%, rgba(7,7,7,0.9) 42%, rgba(7,7,7,0.58) 72%, rgba(7,7,7,0.92) 100%),
      linear-gradient(180deg, #0d0d0d 0%, #070707 100%);
  }

  .landing-section { padding: 88px 0; }

  .label-mono {
    display: inline-flex;
    align-items: center;
    font-family: ${FONT_MONO};
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: ${BRAND};
  }

  .label-mono.brand { color: ${BRAND_LIGHT}; }

  .mono-caption {
    font-family: ${FONT_MONO};
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: ${INK_FAINT};
  }

  .btn-primary-pill {
    background: linear-gradient(135deg, ${BRAND} 0%, ${BRAND_LIGHT} 100%);
    box-shadow: 0 0 0 1px rgba(255,255,255,0.06) inset, 0 10px 30px -12px rgba(255,77,0,0.58);
    transition: transform .15s, box-shadow .15s;
  }

  .btn-primary-pill:hover {
    transform: translateY(-1px);
    box-shadow: 0 0 0 1px rgba(255,255,255,0.08) inset, 0 16px 36px -12px rgba(255,77,0,0.66);
  }

  .btn-primary-pill:active { transform: scale(0.98); }

  .court-backdrop {
    background-image:
      linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px),
      radial-gradient(circle at 78% 32%, rgba(255,77,0,0.16), transparent 30%),
      radial-gradient(circle at 82% 68%, rgba(0,227,253,0.08), transparent 28%);
    background-size: 56px 56px, 56px 56px, auto, auto;
    opacity: 0.76;
  }

  .hero-vignette {
    background:
      linear-gradient(90deg, #070707 0%, rgba(7,7,7,0.8) 34%, rgba(7,7,7,0.24) 68%, #070707 100%),
      linear-gradient(180deg, rgba(7,7,7,0.18) 0%, #070707 100%);
  }

  .court-blueprint {
    transform: perspective(900px) rotateX(58deg) rotateZ(-8deg);
    transform-origin: center;
    border: 2px solid rgba(255,77,0,0.34);
    background: linear-gradient(145deg, rgba(255,77,0,0.08), rgba(0,0,0,0.1));
    box-shadow: 0 60px 120px -80px rgba(255,77,0,0.8);
  }

  .court-line {
    position: absolute;
    background: rgba(255,122,51,0.52);
    box-shadow: 0 0 18px rgba(255,77,0,0.22);
  }

  .court-line-front { left: 0; right: 0; top: 14%; height: 2px; }
  .court-line-mid { left: 0; right: 0; top: 50%; height: 2px; }
  .court-line-service { left: 0; right: 0; top: 68%; height: 2px; }
  .court-line-left { top: 50%; bottom: 0; left: 50%; width: 2px; }
  .court-line-right { top: 0; bottom: 0; left: 26%; width: 1px; opacity: 0.3; }
  .court-line-box-l { left: 0; top: 68%; width: 26%; height: 2px; transform: translateY(82px); }
  .court-line-box-r { right: 0; top: 68%; width: 26%; height: 2px; transform: translateY(82px); }

  .app-phone {
    position: relative;
    overflow: hidden;
    border-radius: 42px;
    background: #090909;
    border: 1px solid rgba(255,255,255,0.12);
    box-shadow:
      0 0 0 6px rgba(255,255,255,0.03),
      0 50px 130px -34px rgba(0,0,0,0.95),
      0 0 90px -28px rgba(255,77,0,0.44),
      inset 0 0 0 1px rgba(255,255,255,0.05);
  }

  .app-phone::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(circle at 20% 0%, rgba(255,77,0,0.14), transparent 34%),
      radial-gradient(circle at 90% 10%, rgba(0,227,253,0.08), transparent 32%),
      linear-gradient(180deg, rgba(22,22,22,0.96), rgba(8,8,8,1));
    z-index: 0;
  }

  .app-phone > * { position: relative; z-index: 1; }

  .phone-notch {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 110px;
    height: 30px;
    border-radius: 0 0 16px 16px;
    background: #090909;
    z-index: 3;
  }

  .phone-card,
  .scene-panel {
    background: rgba(24,24,24,0.68);
    border: 1px solid ${SURFACE_BORDER};
    box-shadow: 0 30px 80px -55px rgba(0,0,0,0.95);
    backdrop-filter: blur(18px);
  }

  .phone-card { border-radius: 14px; padding: 14px; }
  .scene-panel { border-radius: 18px; }

  .disc-card { transition: transform .5s, border-color .5s; }
  .disc-card:hover { transform: translateY(-4px); border-color: rgba(255,255,255,0.14) !important; }
  .disc-art {
    filter: grayscale(1) brightness(0.72);
    transition: filter .7s ease, transform .7s ease;
  }
  .disc-card:hover .disc-art { filter: grayscale(0) brightness(0.92); transform: scale(1.08); }
  .disc-card:hover .disc-hover-glow { opacity: 1; }
  .disc-card:hover .disc-line { width: 56px !important; }
  .disc-blurb {
    max-height: 0;
    opacity: 0;
    overflow: hidden;
    transition: max-height .5s ease, opacity .5s ease, margin-top .5s ease;
  }
  .disc-card:hover .disc-blurb { max-height: 80px; opacity: 1; }
  .disc-link:hover { color: #ffffff; }

  @media (hover: none) {
    .disc-art { filter: grayscale(0) brightness(0.85); }
    .disc-blurb { max-height: 80px; opacity: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    .disc-card, .disc-art, .disc-blurb, .disc-line { transition: none; }
  }

  .system-card::after {
    content: '';
    position: absolute;
    inset: auto 0 0 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent);
    opacity: 0.55;
  }

  @media (max-width: 1023px) {
    .hero-shell {
      background:
        linear-gradient(180deg, rgba(7,7,7,0.9) 0%, rgba(7,7,7,0.76) 55%, #070707 100%),
        linear-gradient(180deg, #0d0d0d 0%, #070707 100%);
    }

    .hero-vignette {
      background:
        linear-gradient(180deg, rgba(7,7,7,0.12) 0%, rgba(7,7,7,0.72) 58%, #070707 100%);
    }
  }

  @media (max-width: 767px) {
    .landing-section { padding: 68px 0; }
    .hero-shell .app-phone { opacity: 0.34; transform: translateY(30px); }
  }
`

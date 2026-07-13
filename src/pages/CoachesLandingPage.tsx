import { Link } from 'react-router-dom'
import { ROUTES } from '../constants/routes'
import { getPublicRouteMetadata } from '../constants/publicRouteMetadata'
import { usePageMetadata } from '../hooks/usePageMetadata'

const BRAND = '#ff4d00'
const BRAND_LIGHT = '#ff7a33'
const INK = '#f5f5f7'
const INK_MUTED = '#a0a0a5'
const INK_FAINT = '#6e6e73'
const SURFACE_BORDER = 'rgba(255,255,255,0.08)'
const FONT_DISPLAY = "'Lexend', 'Inter', system-ui, sans-serif"
const FONT_MONO = "'JetBrains Mono', 'Fira Mono', monospace"

const PRELAUNCH_MAILTO =
  'mailto:hola@rallyiq.cl?subject=' +
  encodeURIComponent('Quiero recibir novedades del lanzamiento de RallyIQ para coaches')

const PARA_QUIEN_ES = [
  'Ya llevas entre 1 y 5 atletas y quieres ordenar planificación y adherencia en un solo lugar.',
  'Tu deporte de origen es competitivo — squash, running o fuerza — y quieres que la carga se lea igual entre tus atletas.',
  'Quieres ahorrar tiempo armando semanas a mano para cada persona que entrenas.',
] as const

const QUE_NO_ES = [
  'No es diagnóstico ni reemplaza a un profesional de la salud.',
  'No reemplaza tu supervisión presencial — es una herramienta, no un entrenador automático.',
  'No garantiza resultados deportivos.',
  'No es "IA ilimitada": siempre revisas y confirmas las propuestas del coach AI antes de aplicarlas.',
] as const

export default function CoachesLandingPage() {
  usePageMetadata(getPublicRouteMetadata(ROUTES.COACHES))

  return (
    <div
      className="coaches-landing"
      style={{
        background: '#070707',
        color: INK,
        minHeight: '100vh',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <CoachesNav />
      <main>
        <Hero />
        <ParaQuienEs />
        <QueNoEs />
        <ClosingCta />
      </main>
      <CoachesFooter />
      <style>{`
        .coaches-cta { white-space: nowrap; transition: transform .15s ease, background .15s ease; }
        .coaches-cta:hover { background: ${BRAND_LIGHT} !important; transform: translateY(-1px); }
        @media (max-width: 520px) {
          .coaches-nav { padding: 14px 16px !important; }
          .coaches-nav .coaches-cta { padding: 9px 13px !important; font-size: 11px !important; }
          .coaches-hero { padding-top: 72px !important; }
        }
      `}</style>
    </div>
  )
}

function CoachesNav() {
  return (
    <nav
      className="coaches-nav"
      aria-label="Navegación de RallyIQ Coach"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        backdropFilter: 'blur(14px)',
        background: 'rgba(7,7,7,0.85)',
        borderBottom: `1px solid ${SURFACE_BORDER}`,
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
      }}
    >
      <Link
        to={ROUTES.HOME}
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 900,
          fontSize: 18,
          color: INK,
          textDecoration: 'none',
        }}
      >
        RallyIQ <span style={{ color: BRAND }}>Coach</span>
      </Link>
      <CtaLink compact />
    </nav>
  )
}

function Hero() {
  return (
    <section
      className="coaches-hero"
      style={{ padding: '96px 24px 64px', maxWidth: 860, margin: '0 auto', textAlign: 'center' }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.24em',
          textTransform: 'uppercase',
          color: BRAND_LIGHT,
          marginBottom: 20,
        }}
      >
        Para entrenadores
      </div>
      <h1
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 'clamp(36px, 6vw, 56px)',
          fontWeight: 800,
          lineHeight: 1.08,
          letterSpacing: '-0.02em',
          margin: '0 0 20px',
        }}
      >
        Gestiona el entrenamiento de tus atletas desde una sola cuenta.
      </h1>
      <p style={{ fontSize: 18, lineHeight: 1.6, color: INK_MUTED, maxWidth: 650, margin: '0 auto 32px' }}>
        RallyIQ reúne tu roster, la planificación multideporte y un coach AI con contexto objetivo opcional. Tú
        revisas cada propuesta: nunca diagnostica ni ajusta un plan automáticamente.
      </p>
      <CtaLink />
      <p style={{ fontSize: 12, lineHeight: 1.6, color: INK_FAINT, margin: '16px auto 0', maxWidth: 590 }}>
        Antes de pedir que te avisemos del lanzamiento puedes revisar nuestros{' '}
        <Link to={ROUTES.TERMS} style={{ color: BRAND_LIGHT }}>
          Términos
        </Link>
        ,{' '}
        <Link to={ROUTES.PRIVACY} style={{ color: BRAND_LIGHT }}>
          Privacidad
        </Link>
        ,{' '}
        <Link to={ROUTES.HEALTH_DISCLAIMER} style={{ color: BRAND_LIGHT }}>
          Descargo de salud
        </Link>{' '}
        y{' '}
        <Link to={ROUTES.WHOOP_DISCLAIMER} style={{ color: BRAND_LIGHT }}>
          Descargo Whoop
        </Link>
        .
      </p>
    </section>
  )
}

function CtaLink({ compact = false }: { compact?: boolean }) {
  return (
    <a
      className="coaches-cta"
      href={PRELAUNCH_MAILTO}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT_DISPLAY,
        fontSize: compact ? 14 : 15,
        fontWeight: 700,
        color: '#fff',
        background: BRAND,
        padding: compact ? '10px 20px' : '16px 28px',
        borderRadius: compact ? 999 : 12,
        textDecoration: 'none',
      }}
    >
      Avisarme del lanzamiento
    </a>
  )
}

function ParaQuienEs() {
  return (
    <ListSection title="Para quién es" items={PARA_QUIEN_ES} markerColor={BRAND} />
  )
}

function QueNoEs() {
  return <ListSection title="Qué no es" items={QUE_NO_ES} markerColor={INK_FAINT} withBorder />
}

function ListSection({
  title,
  items,
  markerColor,
  withBorder = false,
}: {
  title: string
  items: readonly string[]
  markerColor: string
  withBorder?: boolean
}) {
  return (
    <section
      style={{
        padding: '48px 24px',
        maxWidth: 760,
        margin: '0 auto',
        borderTop: withBorder ? `1px solid ${SURFACE_BORDER}` : undefined,
      }}
    >
      <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 700, marginBottom: 20 }}>{title}</h2>
      <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {items.map((item) => (
          <li key={item} style={{ display: 'flex', gap: 12, fontSize: 15, lineHeight: 1.6, color: INK_MUTED }}>
            <span aria-hidden="true" style={{ color: markerColor, flexShrink: 0 }}>
              —
            </span>
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}

function ClosingCta() {
  return (
    <section
      style={{
        padding: '64px 24px 96px',
        maxWidth: 640,
        margin: '0 auto',
        textAlign: 'center',
        borderTop: `1px solid ${SURFACE_BORDER}`,
      }}
    >
      <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 700, marginBottom: 16 }}>
        ¿Listo para ordenar el entrenamiento de tus atletas?
      </h2>
      <CtaLink />
    </section>
  )
}

function CoachesFooter() {
  return (
    <footer style={{ borderTop: `1px solid ${SURFACE_BORDER}`, padding: '32px 24px', textAlign: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
        <Link to={ROUTES.TERMS} style={{ fontSize: 13, color: INK_FAINT, textDecoration: 'none' }}>
          Términos
        </Link>
        <Link to={ROUTES.PRIVACY} style={{ fontSize: 13, color: INK_FAINT, textDecoration: 'none' }}>
          Privacidad
        </Link>
        <Link to={ROUTES.HEALTH_DISCLAIMER} style={{ fontSize: 13, color: INK_FAINT, textDecoration: 'none' }}>
          Descargo de salud
        </Link>
        <Link to={ROUTES.WHOOP_DISCLAIMER} style={{ fontSize: 13, color: INK_FAINT, textDecoration: 'none' }}>
          Descargo Whoop
        </Link>
      </div>
      <p style={{ fontFamily: FONT_MONO, fontSize: 11, color: INK_FAINT, margin: 0 }}>© 2026 · RALLYIQ LABS</p>
    </footer>
  )
}

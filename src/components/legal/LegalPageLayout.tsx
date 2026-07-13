import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { getPublicRouteMetadata } from '../../constants/publicRouteMetadata'
import { ROUTES } from '../../constants/routes'
import { usePageMetadata } from '../../hooks/usePageMetadata'

const BRAND = '#ff4d00'
const INK = '#f5f5f7'
const INK_MUTED = '#a0a0a5'
const INK_FAINT = '#72727a'
const SURFACE_BORDER = 'rgba(255,255,255,0.1)'
const FONT_MONO = "'JetBrains Mono', 'Fira Mono', monospace"

interface LegalPageLayoutProps {
  eyebrow: string
  title: string
  /** Public route this page is served at; its `<head>` copy lives in publicRouteMetadata.json. */
  metaRoute: string
  updatedAt: string
  children: ReactNode
}

export default function LegalPageLayout({ eyebrow, title, metaRoute, updatedAt, children }: LegalPageLayoutProps) {
  usePageMetadata(getPublicRouteMetadata(metaRoute))

  return (
    <div
      style={{
        background: '#0a0a0a',
        color: INK,
        minHeight: '100vh',
        fontFamily: "'Inter', system-ui, sans-serif",
        lineHeight: 1.6,
      }}
    >
      <main style={{ maxWidth: 860, margin: '0 auto', padding: '56px 20px 80px' }}>
        <header style={{ borderBottom: `1px solid ${SURFACE_BORDER}`, marginBottom: 32, paddingBottom: 28 }}>
          <Link
            to={ROUTES.HOME}
            style={{
              fontFamily: FONT_MONO,
              fontSize: 14,
              fontWeight: 700,
              color: INK,
              textDecoration: 'none',
            }}
          >
            RallyIQ
          </Link>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.22em',
              textTransform: 'uppercase',
              color: BRAND,
              marginTop: 20,
              marginBottom: 12,
            }}
          >
            {eyebrow}
          </div>
          <h1
            style={{
              margin: '0 0 12px',
              fontSize: 'clamp(34px, 6vw, 54px)',
              lineHeight: 1.15,
              letterSpacing: '-0.01em',
              color: INK,
            }}
          >
            {title}
          </h1>
          <p style={{ color: INK_FAINT, fontSize: 13, margin: 0 }}>Última actualización: {updatedAt}</p>
        </header>
        <div className="legal-content">{children}</div>
      </main>
      <style>{`
        .legal-content h2 { margin: 36px 0 12px; font-size: 22px; line-height: 1.15; letter-spacing: -0.01em; color: ${INK}; }
        .legal-content p, .legal-content li { color: ${INK_MUTED}; line-height: 1.6; }
        .legal-content strong { color: ${INK}; }
        .legal-content ul { padding-left: 20px; margin: 12px 0; }
        .legal-content li { margin-bottom: 6px; }
        .legal-content a { color: #ff8a4d; }
      `}</style>
    </div>
  )
}

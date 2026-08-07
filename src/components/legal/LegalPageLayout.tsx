import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { isSupabaseConfigured } from '../../services/auth'
import { useAuthStore } from '../../store/useAuthStore'
import SharedPublicNav from '../SharedPublicNav'
import { getPublicRouteMetadata } from '../../constants/publicRouteMetadata'
import { ROUTES } from '../../constants/routes'
import { usePageMetadata } from '../../hooks/usePageMetadata'

// Tokens heredados de LandingPage.tsx. Una página legal es parte del sitio, no
// una hoja suelta: si estos valores se separan, la página vuelve a leerse como
// de otro producto.
const BRAND = '#ff4d00'
const BRAND_LIGHT = '#ff7a33'
const INK = '#f5f5f7'
const INK_MUTED = '#a0a0a5'
const INK_FAINT = '#6e6e73'
const SURFACE_BORDER = 'rgba(255,255,255,0.08)'
const FONT_DISPLAY = "'Lexend', 'Inter', system-ui, sans-serif"
const FONT_MONO = "'JetBrains Mono', 'Fira Mono', monospace"

export interface LegalSection {
  /** Ancla estable por posición: el texto del encabezado es contenido legal y no debe acoplarse a una URL. */
  id: string
  text: string
}

interface LegalPageLayoutProps {
  eyebrow: string
  title: string
  /** Public route this page is served at; its `<head>` copy lives in publicRouteMetadata.json. */
  metaRoute: string
  updatedAt: string
  /** Encabezados del documento, en orden. Alimentan el índice lateral. */
  sections?: LegalSection[]
  children: ReactNode
}

/**
 * Marca la sección visible para el índice lateral.
 *
 * `IntersectionObserver` no existe en jsdom ni durante el render estático del
 * prerender, así que la ausencia se trata como "sin sección activa" en vez de
 * romper: el índice sigue siendo navegable, solo no se resalta.
 */
function useActiveSection(sections: LegalSection[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    if (sections.length === 0) return
    if (typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (visible) setActiveId(visible.target.id)
      },
      // La banda alta mantiene marcada la sección que el lector tiene arriba,
      // no la que apenas asoma por abajo.
      { rootMargin: '-88px 0px -70% 0px', threshold: 0 },
    )

    const observed = sections
      .map((section) => document.getElementById(section.id))
      .filter((node): node is HTMLElement => node !== null)

    observed.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [sections])

  return activeId
}

export default function LegalPageLayout({
  eyebrow,
  title,
  metaRoute,
  updatedAt,
  sections = [],
  children,
}: LegalPageLayoutProps) {
  usePageMetadata(getPublicRouteMetadata(metaRoute))

  const signInWithGoogle = useAuthStore((state) => state.signInWithGoogle)
  const user = useAuthStore((state) => state.user)
  const activeId = useActiveSection(sections)

  const handleSignIn = async () => {
    if (!isSupabaseConfigured) return
    try {
      await signInWithGoogle()
    } catch (error) {
      console.error('[legal] sign-in failed', error)
    }
  }

  return (
    <div className="legal-page">
      <SharedPublicNav onSignup={handleSignIn} onLogin={handleSignIn} isAuthenticated={Boolean(user)} />

      <main className="legal-main">
        <header className="legal-header">
          <div className="legal-header-grid" aria-hidden="true" />
          <div className="legal-header-inner">
            <div className="legal-eyebrow">{eyebrow}</div>
            <h1 className="legal-title">{title}</h1>
            <div className="legal-meta">
              <p className="legal-updated">Última actualización: {updatedAt}</p>
              {sections.length > 0 && (
                <span className="legal-meta-count">
                  {sections.length} {sections.length === 1 ? 'sección' : 'secciones'}
                </span>
              )}
            </div>
          </div>
        </header>

        <div className="legal-body">
          {sections.length > 0 && (
            <>
              {/* Riel fijo en escritorio. En móvil ocuparía una pantalla entera
                  antes del texto, así que ahí va plegado. Uno de los dos está
                  siempre en `display: none`, y eso lo saca del árbol de
                  accesibilidad: no hay índice duplicado para un lector. */}
              <nav className="legal-index" aria-label="Secciones de este documento">
                <div className="legal-index-sticky">
                  <div className="legal-index-label">En este documento</div>
                  <div className="legal-index-list">
                    {sections.map((section) => (
                      <a
                        key={section.id}
                        href={`#${section.id}`}
                        className={section.id === activeId ? 'legal-index-link is-active' : 'legal-index-link'}
                        aria-current={section.id === activeId ? 'true' : undefined}
                      >
                        {section.text}
                      </a>
                    ))}
                  </div>
                </div>
              </nav>

              <details className="legal-index-mobile">
                <summary>
                  Ir a una sección
                  <span>{sections.length}</span>
                </summary>
                <div className="legal-index-list">
                  {sections.map((section) => (
                    <a key={section.id} href={`#${section.id}`} className="legal-index-link">
                      {section.text}
                    </a>
                  ))}
                </div>
              </details>
            </>
          )}

          <div className="legal-content">{children}</div>
        </div>
      </main>

      <footer className="legal-footer">
        <div className="legal-footer-inner">
          <div className="legal-footer-brand">
            <span className="legal-footer-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
                <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill={BRAND} />
              </svg>
            </span>
            RallyIQ
          </div>
          <div className="legal-footer-links">
            <Link to={ROUTES.TERMS}>Términos</Link>
            <Link to={ROUTES.PRIVACY}>Privacidad</Link>
            <Link to={ROUTES.HEALTH_DISCLAIMER}>Salud</Link>
            <Link to={ROUTES.WHOOP_DISCLAIMER}>Datos Whoop</Link>
            <a href="mailto:hola@rallyiq.cl">Contacto</a>
          </div>
        </div>
        <div className="legal-footer-rule">
          <span>© 2026 · RALLYIQ LABS</span>
          <span>BETA PRIVADA · SANTIAGO, CHILE</span>
        </div>
      </footer>

      <style>{css}</style>
    </div>
  )
}

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

  .legal-page {
    background: #070707;
    color: ${INK};
    min-height: 100vh;
    font-family: 'Inter', system-ui, sans-serif;
    /* clip y no hidden: hidden vuelve a este nodo un scroll container y eso
       desactiva el position sticky del indice lateral. */
    overflow-x: clip;
    -webkit-font-smoothing: antialiased;
  }

  /* index.css deja #root en overflow-x: hidden, y eso lo vuelve el scroll
     container que desactiva el sticky del indice. Se neutraliza solo mientras
     una pagina legal esta montada; clip conserva el corte horizontal. */
  :root:has(.legal-page) #root { overflow-x: clip; }

  .legal-page a { color: inherit; }

  .legal-main { padding-bottom: 96px; }

  /* --- Cabecera: el mismo aire del hero, sin su mobiliario --- */

  .legal-header {
    position: relative;
    overflow: hidden;
    padding: 116px 0 40px;
    background: linear-gradient(180deg, #0d0d0d 0%, #070707 100%);
    border-bottom: 1px solid ${SURFACE_BORDER};
  }

  .legal-header-grid {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px),
      radial-gradient(circle at 88% 12%, rgba(255,77,0,0.14), transparent 34%);
    background-size: 56px 56px, 56px 56px, auto;
    -webkit-mask-image: linear-gradient(180deg, #000 0%, transparent 92%);
    mask-image: linear-gradient(180deg, #000 0%, transparent 92%);
    opacity: 0.7;
  }

  .legal-header-inner {
    position: relative;
    z-index: 1;
    max-width: 1112px;
    margin: 0 auto;
    padding: 0 24px;
  }

  .legal-eyebrow {
    display: inline-flex;
    align-items: center;
    font-family: ${FONT_MONO};
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: ${BRAND_LIGHT};
    margin-bottom: 18px;
  }

  .legal-title {
    margin: 0;
    font-family: ${FONT_DISPLAY};
    font-weight: 800;
    /* Título de documento, no titular de venta: por debajo del h1 de la landing a propósito. */
    font-size: clamp(32px, 4.4vw, 46px);
    line-height: 1.08;
    letter-spacing: -0.025em;
    color: #fff;
    max-width: 22ch;
  }

  .legal-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
    margin-top: 24px;
  }

  .legal-updated,
  .legal-meta-count {
    margin: 0;
    font-family: ${FONT_MONO};
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: ${INK_FAINT};
  }

  .legal-meta-count {
    padding: 4px 10px;
    border: 1px solid ${SURFACE_BORDER};
    border-radius: 999px;
    background: rgba(255,255,255,0.03);
  }

  /* --- Cuerpo: índice pegajoso + documento --- */

  .legal-body {
    max-width: 1112px;
    margin: 0 auto;
    padding: 48px 24px 0;
    display: grid;
    grid-template-columns: 1fr;
    gap: 40px;
  }

  @media (min-width: 1024px) {
    .legal-body {
      grid-template-columns: 232px minmax(0, 1fr);
      gap: 72px;
    }
  }

  .legal-index { display: none; }

  @media (min-width: 1024px) {
    .legal-index { display: block; }
    .legal-index-mobile { display: none; }

    .legal-index-sticky {
      position: sticky;
      top: 96px;
      max-height: calc(100vh - 128px);
      overflow-y: auto;
    }
  }

  .legal-index-mobile {
    border: 1px solid ${SURFACE_BORDER};
    border-radius: 14px;
    background: rgba(255,255,255,0.02);
    padding: 0 16px;
  }

  .legal-index-mobile > summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 0;
    cursor: pointer;
    list-style: none;
    font-family: ${FONT_MONO};
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: ${INK_MUTED};
  }

  .legal-index-mobile > summary::-webkit-details-marker { display: none; }

  .legal-index-mobile > summary > span {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 22px;
    border-radius: 999px;
    border: 1px solid ${SURFACE_BORDER};
    color: ${BRAND_LIGHT};
    font-size: 10px;
  }

  .legal-index-mobile > .legal-index-list {
    border-left: none;
    border-top: 1px solid ${SURFACE_BORDER};
    padding: 6px 0 12px;
  }

  .legal-index-mobile .legal-index-link { padding-left: 0; }
  .legal-index-mobile .legal-index-link::before { content: none; }

  .legal-index-label {
    font-family: ${FONT_MONO};
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: ${INK_FAINT};
    margin-bottom: 14px;
  }

  .legal-index-list {
    display: flex;
    flex-direction: column;
    border-left: 1px solid ${SURFACE_BORDER};
  }

  .legal-index-link {
    position: relative;
    padding: 8px 0 8px 16px;
    font-size: 13px;
    line-height: 1.45;
    color: ${INK_FAINT};
    text-decoration: none;
    transition: color .15s;
  }

  .legal-index-link::before {
    content: '';
    position: absolute;
    left: -1px;
    top: 6px;
    bottom: 6px;
    width: 2px;
    background: transparent;
    transition: background-color .15s;
  }

  .legal-index-link:hover { color: ${INK}; }
  .legal-index-link.is-active { color: ${INK}; font-weight: 600; }
  .legal-index-link.is-active::before { background: ${BRAND}; }

  .legal-index-link:focus-visible,
  .legal-content a:focus-visible,
  .legal-footer a:focus-visible {
    outline: 2px solid ${BRAND_LIGHT};
    outline-offset: 3px;
    border-radius: 3px;
  }

  /* --- Documento --- */

  .legal-content {
    max-width: 68ch;
    font-size: 16px;
    line-height: 1.75;
  }

  .legal-content h2 {
    scroll-margin-top: 96px;
    margin: 44px 0 14px;
    font-family: ${FONT_DISPLAY};
    font-weight: 700;
    font-size: 21px;
    line-height: 1.25;
    letter-spacing: -0.015em;
    color: ${INK};
  }

  .legal-content h2:first-child { margin-top: 0; }

  .legal-content p,
  .legal-content li { color: ${INK_MUTED}; }

  .legal-content p { margin: 0 0 16px; }
  .legal-content strong { color: ${INK}; font-weight: 600; }

  .legal-content ul {
    margin: 0 0 16px;
    padding-left: 0;
    list-style: none;
  }

  .legal-content li {
    position: relative;
    margin-bottom: 8px;
    padding-left: 20px;
  }

  .legal-content li::before {
    content: '';
    position: absolute;
    left: 2px;
    top: 0.72em;
    width: 5px;
    height: 5px;
    border-radius: 1px;
    background: ${BRAND};
    opacity: 0.75;
  }

  .legal-content a {
    color: ${BRAND_LIGHT};
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-thickness: 1px;
    text-decoration-color: rgba(255,122,51,0.4);
    transition: text-decoration-color .15s;
  }

  .legal-content a:hover { text-decoration-color: ${BRAND_LIGHT}; }

  /* --- Pie --- */

  .legal-footer {
    border-top: 1px solid rgba(255,255,255,0.06);
    background: #050505;
    padding: 44px 0 32px;
  }

  .legal-footer-inner {
    max-width: 1112px;
    margin: 0 auto;
    padding: 0 24px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
  }

  .legal-footer-brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-family: ${FONT_DISPLAY};
    font-weight: 900;
    font-size: 15px;
    letter-spacing: -0.02em;
    color: #fff;
  }

  .legal-footer-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 9px;
    background: linear-gradient(145deg, #1a120e 0%, #0a0706 100%);
    box-shadow: 0 0 0 1px rgba(255,77,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05);
  }

  .legal-footer-links {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 22px;
  }

  .legal-footer-links a {
    font-size: 13px;
    color: ${INK_MUTED};
    text-decoration: none;
    transition: color .15s;
  }

  .legal-footer-links a:hover { color: #fff; }

  .legal-footer-rule {
    max-width: 1112px;
    margin: 28px auto 0;
    padding: 18px 24px 0;
    border-top: 1px solid rgba(255,255,255,0.06);
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    justify-content: space-between;
    font-family: ${FONT_MONO};
    font-size: 11px;
    color: ${INK_FAINT};
  }

  @media (prefers-reduced-motion: reduce) {
    .legal-page * { transition: none !important; animation: none !important; }
  }

  /* Una revisión legal termina en papel o en PDF: que salga legible. */
  @media print {
    .legal-page { background: #fff; color: #000; }
    .legal-page nav, .legal-index, .legal-footer, .legal-header-grid { display: none !important; }
    .legal-header { padding: 0 0 16px; background: none; border-bottom: 1px solid #ccc; }
    .legal-body { display: block; padding: 24px 0 0; }
    .legal-title, .legal-content h2, .legal-content strong { color: #000; }
    .legal-content { max-width: none; font-size: 11pt; }
    .legal-content p, .legal-content li { color: #1a1a1a; }
    .legal-content a { color: #000; }
    .legal-content h2 { page-break-after: avoid; }
    .legal-updated, .legal-meta-count { color: #444; border-color: #ccc; }
  }
`

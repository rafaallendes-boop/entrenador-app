import { useState, useEffect, useCallback } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowRight, X, Menu } from 'lucide-react'

const BRAND = '#ff4d00'
const BRAND_LIGHT = '#ff7a33'
const INK = '#f5f5f7'
const INK_MUTED = '#a0a0a5'
const INK_FAINT = '#6e6e73'
const SURFACE_BORDER = 'rgba(255,255,255,0.08)'
const FONT_DISPLAY = "'Lexend', 'Inter', system-ui, sans-serif"
const FONT_MONO = "'JetBrains Mono', 'Fira Mono', monospace"

const NAV_LINKS = [
  { label: 'Producto', to: '/' },
  { label: 'Funcionalidades', to: '/features' },
  { label: 'Precios', to: '/pricing' },
] as const

function BoltLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill="url(#snav-g)" />
      <defs>
        <linearGradient id="snav-g" x1="12" y1="2" x2="12" y2="22">
          <stop stopColor="#ff8040" />
          <stop offset="1" stopColor="#d63200" />
        </linearGradient>
      </defs>
    </svg>
  )
}

interface SharedPublicNavProps {
  onSignup: () => void
  onLogin: () => void
  isAuthenticated?: boolean
  scrollAware?: boolean
}

export default function SharedPublicNav({ onSignup, onLogin, isAuthenticated = false, scrollAware }: SharedPublicNavProps) {
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => {
    if (!scrollAware) return
    const fn = () => setScrolled(window.scrollY > 10)
    fn()
    window.addEventListener('scroll', fn, { passive: true })
    return () => window.removeEventListener('scroll', fn)
  }, [scrollAware])

  // Lock body scroll when menu is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  const bgOpacity = scrollAware
    ? (scrolled ? 'rgba(10,10,10,0.92)' : 'rgba(10,10,10,0.5)')
    : 'rgba(10,10,10,0.92)'

  const borderColor = scrollAware
    ? (scrolled ? SURFACE_BORDER : 'transparent')
    : SURFACE_BORDER

  const closeMobile = useCallback(() => setMobileOpen(false), [])

  return (
    <>
      <nav
        style={{
          position: 'fixed', inset: '0 0 auto 0', zIndex: 100,
          backgroundColor: bgOpacity,
          backdropFilter: 'blur(18px) saturate(140%)',
          WebkitBackdropFilter: 'blur(18px) saturate(140%)',
          borderBottom: `1px solid ${borderColor}`,
          transition: 'background-color .3s, border-color .3s',
          height: 64,
          display: 'flex', alignItems: 'center',
        }}
      >
        <div
          style={{
            maxWidth: 1240, margin: '0 auto', padding: '0 24px',
            width: '100%', display: 'flex', alignItems: 'center', gap: 0,
          }}
        >
          {/* Logo */}
          <Link
            to="/"
            style={{
              display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none',
              fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: '1.3rem',
              letterSpacing: '-0.03em', color: INK, flexShrink: 0,
            }}
          >
            <span style={{
              width: 28, height: 28,
              background: 'linear-gradient(135deg,#ff6020,#cc2c00)',
              borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <BoltLogo />
            </span>
            RallyIQ
          </Link>

          {/* Desktop links */}
          <div
            style={{
              alignItems: 'center', gap: 28, flex: 1,
              justifyContent: 'center',
              // hide on mobile via media-query class
            }}
            className="hidden md:flex"
          >
            {NAV_LINKS.map(({ label, to }) => {
              const active = pathname === to || (to !== '/' && pathname.startsWith(to))
              return (
                <Link
                  key={to}
                  to={to}
                  style={{
                    fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 600,
                    color: active ? INK : INK_FAINT,
                    textDecoration: 'none', transition: 'color .15s',
                    ...(active ? { color: active ? BRAND : INK_FAINT } : {}),
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = active ? BRAND_LIGHT : INK)}
                  onMouseLeave={e => (e.currentTarget.style.color = active ? BRAND : INK_FAINT)}
                >
                  {label}
                </Link>
              )
            })}
          </div>

          {/* Spacer on mobile */}
          <div style={{ flex: 1 }} className="md:hidden" />

          {/* Desktop actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {isAuthenticated ? (
              <Link
                to="/"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: BRAND, color: '#fff',
                  fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 700,
                  padding: '9px 18px', borderRadius: 999, textDecoration: 'none',
                  boxShadow: '0 2px 14px rgba(255,77,0,0.35)',
                }}
              >
                Ir a mi panel <ArrowRight size={13} strokeWidth={2.5} />
              </Link>
            ) : (
              <>
                <button
                  onClick={onLogin}
                  className="hidden md:inline-flex"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 500,
                    color: INK_MUTED, padding: '6px 12px', borderRadius: 8,
                    transition: 'color .15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = INK)}
                  onMouseLeave={e => (e.currentTarget.style.color = INK_MUTED)}
                >
                  Iniciar sesión
                </button>
                <button
                  onClick={onSignup}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: BRAND, color: '#fff', border: 'none', cursor: 'pointer',
                    fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 700,
                    padding: '9px 18px', borderRadius: 999,
                    boxShadow: '0 2px 14px rgba(255,77,0,0.35)',
                    transition: 'all .18s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = BRAND_LIGHT; (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = BRAND; (e.currentTarget as HTMLButtonElement).style.transform = '' }}
                >
                  Empezar gratis <ArrowRight size={13} strokeWidth={2.5} />
                </button>
              </>
            )}

            {/* Hamburger — mobile only */}
            <button
              className="md:hidden"
              onClick={() => setMobileOpen(o => !o)}
              aria-label="Abrir menú"
              style={{
                background: mobileOpen ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${SURFACE_BORDER}`,
                borderRadius: 8, cursor: 'pointer', color: INK,
                width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginLeft: 8, transition: 'background .15s',
              }}
            >
              {mobileOpen ? <X size={16} strokeWidth={2} /> : <Menu size={16} strokeWidth={2} />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          onClick={closeMobile}
          style={{
            position: 'fixed', inset: 0, zIndex: 98,
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(4px)',
            animation: 'fadeIn .2s ease',
          }}
        />
      )}

      {/* Mobile slide-in panel from right */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 99,
          width: 'min(320px, 85vw)',
          background: 'linear-gradient(160deg, #141414 0%, #0c0c0c 100%)',
          borderLeft: `1px solid ${SURFACE_BORDER}`,
          boxShadow: '-24px 0 80px rgba(0,0,0,0.6)',
          transform: mobileOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform .3s cubic-bezier(0.4,0,0.2,1)',
          display: 'flex', flexDirection: 'column',
          paddingTop: 64,
        }}
      >
        {/* Close button inside panel */}
        <button
          onClick={closeMobile}
          aria-label="Cerrar menú"
          style={{
            position: 'absolute', top: 14, right: 16,
            background: 'rgba(255,255,255,0.06)', border: `1px solid ${SURFACE_BORDER}`,
            borderRadius: 8, cursor: 'pointer', color: INK_MUTED,
            width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <X size={15} strokeWidth={2} />
        </button>

        {/* Mono label */}
        <div style={{
          padding: '20px 24px 12px',
          fontFamily: FONT_MONO, fontSize: 10, fontWeight: 600,
          letterSpacing: '0.28em', textTransform: 'uppercase', color: INK_FAINT,
        }}>
          Navegación
        </div>

        {/* Nav links */}
        <div style={{ display: 'flex', flexDirection: 'column', padding: '0 16px' }}>
          {NAV_LINKS.map(({ label, to }) => {
            const active = pathname === to || (to !== '/' && pathname.startsWith(to))
            return (
              <Link
                key={to}
                to={to}
                onClick={closeMobile}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '15px 12px', borderRadius: 10, textDecoration: 'none',
                  fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: active ? 700 : 500,
                  color: active ? INK : INK_MUTED,
                  background: active ? 'rgba(255,77,0,0.07)' : 'transparent',
                  borderLeft: active ? `3px solid ${BRAND}` : '3px solid transparent',
                  marginBottom: 2, transition: 'all .15s',
                }}
              >
                <span>{label}</span>
                {active && (
                  <span style={{
                    fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.2em',
                    color: BRAND, textTransform: 'uppercase', padding: '3px 7px',
                    background: 'rgba(255,77,0,0.12)', borderRadius: 4,
                  }}>
                    Activo
                  </span>
                )}
              </Link>
            )
          })}
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: SURFACE_BORDER, margin: '12px 24px' }} />

        {/* Auth actions */}
        <div style={{ padding: '8px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {isAuthenticated ? (
            <Link
              to="/"
              onClick={closeMobile}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: BRAND, color: '#fff', fontFamily: FONT_DISPLAY,
                fontSize: 14, fontWeight: 700, padding: '13px 20px',
                borderRadius: 999, width: '100%', textDecoration: 'none',
              }}
            >
              Ir a mi panel <ArrowRight size={14} strokeWidth={2.5} />
            </Link>
          ) : (
            <>
              <button
                onClick={() => { onSignup(); closeMobile() }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  background: BRAND, color: '#fff', border: 'none', cursor: 'pointer',
                  fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 700,
                  padding: '13px 20px', borderRadius: 999,
                  boxShadow: '0 4px 20px rgba(255,77,0,0.3)',
                  width: '100%', transition: 'all .18s',
                }}
              >
                Empezar gratis <ArrowRight size={14} strokeWidth={2.5} />
              </button>
              <button
                onClick={() => { onLogin(); closeMobile() }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(255,255,255,0.05)', color: INK_MUTED,
                  border: `1px solid ${SURFACE_BORDER}`, cursor: 'pointer',
                  fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 500,
                  padding: '11px 20px', borderRadius: 999, width: '100%',
                }}
              >
                Iniciar sesión
              </button>
            </>
          )}
        </div>

        {/* Bottom brand note */}
        <div style={{ marginTop: 'auto', padding: '20px 24px', borderTop: `1px solid ${SURFACE_BORDER}` }}>
          <p style={{ fontFamily: FONT_MONO, fontSize: 10, color: INK_FAINT, letterSpacing: '0.15em', margin: 0 }}>
            RALLYIQ · BETA PRIVADA · 2026
          </p>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @media (min-width: 768px) { .md\\:hidden { display: none !important; } .hidden.md\\:flex { display: flex !important; } .hidden.md\\:inline-flex { display: inline-flex !important; } }
      `}</style>
    </>
  )
}

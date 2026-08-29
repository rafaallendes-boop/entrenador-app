import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'
import { isSupabaseConfigured } from '../services/auth'
import SharedPublicNav from '../components/SharedPublicNav'
import { buildBetaAccessMailto, PRELAUNCH_CONTACT_EMAIL } from '../constants/prelaunchContact'
import { ROUTES } from '../constants/routes'
import { getPublicRouteMetadata } from '../constants/publicRouteMetadata'
import { usePageMetadata } from '../hooks/usePageMetadata'

const BETA_BADGE = 'Beta cerrada · sin cobro todavía'

// ── Design tokens ────────────────────────────────────────────────────────────
const BRAND = '#ff4d00'
const BRAND_LIGHT = '#ff7a33'
const FORGE_LIME = '#d1fc00'
const INK = '#f5f5f7'
const INK_MUTED = '#a0a0a5'
const INK_FAINT = '#6e6e73'
const SURFACE = '#111111'
const SURFACE_DEEP = '#0c0c0c'
const SURFACE_RAISED = '#1a1a1a'
const SURFACE_BORDER = 'rgba(255,255,255,0.08)'
const FONT_DISPLAY = "'Lexend', 'Inter', system-ui, sans-serif"
const FONT_MONO = "'JetBrains Mono', 'Fira Mono', monospace"

// ── Inline styles ────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');

  .pricing-wrap { max-width: 1240px; margin: 0 auto; padding: 0 32px; }
  .pricing-wrap-wide { max-width: 1400px; margin: 0 auto; padding: 0 32px; }

  /* Buttons */
  .p-btn {
    display: inline-flex; align-items: center; gap: 7px;
    font-family: ${FONT_DISPLAY}; font-size: 14px; font-weight: 600;
    padding: 10px 20px; border-radius: 999px; text-decoration: none;
    transition: all .18s; cursor: pointer; border: none;
    letter-spacing: -0.01em; white-space: nowrap;
  }
  .p-btn-primary {
    background: ${BRAND}; color: #fff;
    box-shadow: 0 2px 16px rgba(255,77,0,0.35);
  }
  .p-btn-primary:hover { background: ${BRAND_LIGHT}; box-shadow: 0 4px 24px rgba(255,77,0,0.5); transform: translateY(-1px); }
  .p-btn-ghost {
    background: rgba(255,255,255,0.06); color: ${INK};
    border: 1px solid ${SURFACE_BORDER};
  }
  .p-btn-ghost:hover { background: rgba(255,255,255,0.11); border-color: rgba(255,255,255,0.16); }
  .p-btn-ghost-muted { background: transparent; color: ${INK_MUTED}; }
  .p-btn-ghost-muted:hover { color: ${INK}; }
  .p-btn-lg { font-size: 15px; padding: 13px 28px; }
  .p-btn-block { width: 100%; justify-content: center; }

  /* Label pill */
  .p-label {
    display: inline-flex; align-items: center; gap: 6px;
    font-family: ${FONT_MONO}; font-size: 10px; font-weight: 600;
    letter-spacing: 0.22em; text-transform: uppercase; color: ${INK_FAINT};
    padding: 5px 12px; border-radius: 999px;
    background: rgba(255,255,255,0.05); border: 1px solid ${SURFACE_BORDER};
  }
  .p-label.brand { color: ${BRAND_LIGHT}; background: rgba(255,77,0,0.08); border-color: rgba(255,77,0,0.22); }

  /* Hero */
  .p-hero {
    padding: 128px 0 64px; text-align: center; position: relative; overflow: hidden;
  }
  .p-hero .glow {
    position: absolute; pointer-events: none;
    top: -140px; left: 50%; transform: translateX(-50%);
    width: 700px; height: 500px;
    background: radial-gradient(ellipse, rgba(255,77,0,0.28), transparent 60%);
    filter: blur(80px); opacity: 0.6; z-index: 0;
  }
  .p-hero-inner { position: relative; z-index: 1; }
  .p-hero h1 {
    font-family: ${FONT_DISPLAY}; font-weight: 700;
    font-size: clamp(44px, 5.6vw, 68px); letter-spacing: -0.025em; line-height: 1.05;
    color: ${INK}; margin: 22px 0 20px;
  }
  .p-hero h1 .hl { color: ${BRAND}; }
  .p-hero .lede {
    font-size: 18px; line-height: 1.55; color: ${INK_MUTED};
    max-width: 58ch; margin: 0 auto;
  }

  /* Billing toggle */
  .billing-toggle {
    margin-top: 36px; display: inline-flex;
    background: rgba(21,21,21,0.7); border: 1px solid ${SURFACE_BORDER};
    padding: 4px; border-radius: 999px; gap: 2px;
  }
  .billing-toggle button {
    font-family: ${FONT_DISPLAY}; font-size: 12px; font-weight: 600;
    padding: 10px 20px; border-radius: 999px; color: ${INK_MUTED};
    transition: all .18s; display: inline-flex; align-items: center; gap: 8px;
    background: transparent; border: none; cursor: pointer;
  }
  .billing-toggle button.on { background: ${INK}; color: ${SURFACE_DEEP}; }
  .billing-save {
    font-family: ${FONT_MONO}; font-size: 9px; letter-spacing: 0.2em;
    padding: 2px 6px; border-radius: 4px;
    background: rgba(209,252,0,0.2); color: ${FORGE_LIME};
  }
  .billing-toggle button.on .billing-save {
    background: rgba(20,20,20,0.2); color: #1a0800;
  }

  /* Pricing grid */
  .pricing-grid {
    display: grid; grid-template-columns: repeat(3,1fr); gap: 20px; margin-top: 40px;
  }
  .tier {
    position: relative; padding: 36px 32px 32px; border-radius: 20px;
    background: rgba(20,20,20,0.7); border: 1px solid ${SURFACE_BORDER};
    display: flex; flex-direction: column;
  }
  .tier.featured {
    background: rgba(24,16,10,0.85);
    border-color: rgba(255,77,0,0.3);
    box-shadow: 0 0 60px -20px rgba(255,77,0,0.45), inset 0 0 0 1px rgba(255,77,0,0.15);
  }
  .tier-ribbon {
    position: absolute; top: -12px; left: 32px;
    background: ${BRAND}; color: #1a0800;
    padding: 4px 10px; border-radius: 6px;
    font-family: ${FONT_MONO}; font-size: 9px; font-weight: 700;
    letter-spacing: 0.28em; text-transform: uppercase;
  }
  .tier-badge {
    font-family: ${FONT_MONO}; font-size: 10px; font-weight: 600;
    letter-spacing: 0.16em; text-transform: uppercase; color: ${INK_MUTED};
    background: rgba(255,255,255,0.05); border: 1px solid ${SURFACE_BORDER};
    border-radius: 8px; padding: 9px 12px; margin-bottom: 14px; text-align: center;
  }
  .tier h3 {
    font-family: ${FONT_DISPLAY}; font-size: 20px; font-weight: 700;
    color: ${INK}; letter-spacing: -0.01em; margin-bottom: 6px;
  }
  .tier .tier-sub { font-size: 13px; color: ${INK_MUTED}; line-height: 1.5; margin-bottom: 28px; max-width: 34ch; }
  .tier .tier-price { margin-bottom: 28px; display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
  .tier .price-num {
    font-family: ${FONT_DISPLAY}; font-weight: 700; font-size: 52px;
    color: ${INK}; line-height: 1; letter-spacing: -0.03em; font-variant-numeric: tabular-nums;
  }
  .tier.featured .price-num { color: ${BRAND}; }
  .tier .price-unit { font-family: ${FONT_MONO}; font-size: 12px; color: ${INK_FAINT}; letter-spacing: 0.15em; }
  .tier .price-orig { font-family: ${FONT_MONO}; font-size: 14px; color: ${INK_FAINT}; text-decoration: line-through; margin-left: 8px; }
  .tier .tier-divider { height: 1px; background: rgba(255,255,255,0.06); margin: 0 -32px 28px; }
  .tier .feat-label {
    font-family: ${FONT_MONO}; font-size: 10px; letter-spacing: 0.32em;
    text-transform: uppercase; color: ${INK_FAINT}; margin-bottom: 18px;
  }
  .tier ul { list-style: none; display: flex; flex-direction: column; gap: 13px; }
  .tier li { display: flex; gap: 10px; font-size: 13.5px; line-height: 1.5; color: ${INK}; align-items: flex-start; }
  .tier li.dim { color: ${INK_FAINT}; }
  .tier li .chk-icon { flex-shrink: 0; margin-top: 2px; color: ${FORGE_LIME}; }
  .tier.featured li .chk-icon { color: ${BRAND}; }
  .tier li.dim .chk-icon { color: ${INK_FAINT}; opacity: 0.5; }
  .tier li em { font-style: normal; color: ${INK_MUTED}; font-size: 12px; margin-left: 4px; }

  /* Guarantee row */
  .guarantee {
    display: grid; grid-template-columns: repeat(4,1fr);
    gap: 2px; background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 16px; overflow: hidden;
  }
  .g-item { background: ${SURFACE}; padding: 28px; transition: background .2s; }
  .g-item:hover { background: ${SURFACE_RAISED}; }
  .g-item .g-ic {
    width: 32px; height: 32px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(209,252,0,0.08); border: 1px solid rgba(209,252,0,0.22);
    color: ${FORGE_LIME}; margin-bottom: 18px;
  }
  .g-item h4 { font-size: 14px; font-weight: 600; color: ${INK}; margin-bottom: 6px; letter-spacing: -0.005em; }
  .g-item p { font-size: 13px; color: ${INK_MUTED}; line-height: 1.5; }

  /* Compare table */
  .compare-shell {
    background: rgba(21,21,21,0.4); border: 1px solid ${SURFACE_BORDER};
    border-radius: 16px; overflow: hidden;
  }
  .compare-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13.5px; }
  .compare-table th, .compare-table td {
    padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.05);
    text-align: left; vertical-align: middle;
  }
  .compare-table thead th {
    background: rgba(21,21,21,0.6); font-family: ${FONT_DISPLAY};
    font-weight: 600; font-size: 15px; color: ${INK}; letter-spacing: -0.01em;
    text-align: center;
  }
  .compare-table thead th.pro { color: ${BRAND_LIGHT}; background: rgba(255,77,0,0.06); }
  .compare-table thead th:first-child {
    width: 40%; font-family: ${FONT_MONO}; font-size: 10px;
    letter-spacing: 0.3em; text-transform: uppercase; color: ${INK_FAINT};
    font-weight: 600; text-align: left;
  }
  .compare-table tbody td:first-child { color: ${INK}; font-weight: 500; font-family: ${FONT_DISPLAY}; }
  .compare-table tbody td {
    text-align: center; color: ${INK_MUTED}; font-family: ${FONT_MONO}; font-size: 13px;
  }
  .compare-table tbody td.pro { background: rgba(255,77,0,0.03); }
  .compare-table tbody tr:hover td { background: rgba(255,255,255,0.02); }
  .compare-table tbody tr:hover td.pro { background: rgba(255,77,0,0.06); }
  .compare-table .chk { color: ${FORGE_LIME}; }
  .compare-table .chk.brand { color: ${BRAND}; }
  .compare-table .dash { color: ${INK_FAINT}; opacity: 0.4; }
  .compare-table tbody tr.section-row td {
    background: ${SURFACE_DEEP}; padding: 20px 20px 12px;
    font-family: ${FONT_MONO}; font-size: 10px; letter-spacing: 0.32em;
    text-transform: uppercase; color: ${INK_FAINT}; font-weight: 600;
    text-align: left; border-bottom: 1px solid rgba(255,255,255,0.08);
  }

  /* FAQ */
  .faq { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; }
  .faq-head { position: sticky; top: 96px; align-self: start; }
  .faq-head h2 {
    font-family: ${FONT_DISPLAY}; font-size: 40px; font-weight: 700;
    letter-spacing: -0.02em; line-height: 1.1; margin: 14px 0 18px;
    color: ${INK};
  }
  .faq-head p { font-size: 15px; color: ${INK_MUTED}; line-height: 1.6; max-width: 38ch; }
  .faq-head a { color: ${BRAND_LIGHT}; text-decoration: underline; text-underline-offset: 3px; }
  .faq-list { display: flex; flex-direction: column; }
  .faq-item { padding: 22px 4px; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .faq-item-header {
    display: flex; justify-content: space-between; align-items: center; gap: 16px;
    cursor: pointer; user-select: none;
  }
  .faq-q {
    font-family: ${FONT_DISPLAY}; font-size: 17px; font-weight: 600;
    color: ${INK}; letter-spacing: -0.005em;
  }
  .faq-ic {
    flex-shrink: 0; width: 24px; height: 24px; border-radius: 6px;
    border: 1px solid ${SURFACE_BORDER}; display: flex; align-items: center;
    justify-content: center; color: ${INK_MUTED}; transition: all .2s;
  }
  .faq-ic.open {
    background: rgba(255,77,0,0.1); border-color: rgba(255,77,0,0.3);
    color: ${BRAND_LIGHT}; transform: rotate(45deg);
  }
  .faq-a {
    font-size: 14px; line-height: 1.65; color: ${INK_MUTED}; margin-top: 12px; max-width: 52ch;
  }

  /* CTA block */
  .cta-block {
    position: relative; padding: 64px 56px; border-radius: 24px; overflow: hidden;
    background: radial-gradient(ellipse 80% 80% at 50% 110%, rgba(255,77,0,0.25), transparent 60%),
                linear-gradient(180deg, #151515, #0c0c0c);
    border: 1px solid rgba(255,77,0,0.18); text-align: center;
  }
  .cta-grid-bg {
    position: absolute; inset: 0; pointer-events: none;
    background-image: linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
                      linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
    background-size: 22px 22px;
    mask-image: radial-gradient(ellipse 80% 80% at 50% 50%, #000, transparent 80%);
  }
  .cta-block > * { position: relative; }
  .cta-block h2 {
    font-family: ${FONT_DISPLAY}; font-size: clamp(32px,4vw,44px); font-weight: 700;
    letter-spacing: -0.025em; line-height: 1.08; margin: 14px auto;
    color: ${INK}; max-width: 700px;
  }
  .cta-block h2 .hl { color: ${BRAND}; }
  .cta-block p { font-size: 16px; color: ${INK_MUTED}; max-width: 500px; margin: 0 auto 28px; line-height: 1.5; }
  .cta-act { display: inline-flex; gap: 12px; align-items: center; }

  /* Footer */
  .pricing-footer {
    border-top: 1px solid ${SURFACE_BORDER}; padding: 56px 0 32px;
    background: ${SURFACE_DEEP};
  }
  .footer-grid { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 40px; margin-bottom: 48px; }
  .footer-brand .nav-logo-f {
    font-family: ${FONT_DISPLAY}; font-weight: 700; font-size: 18px;
    color: ${INK}; text-decoration: none; display: flex; align-items: center; gap: 8px;
    margin-bottom: 16px;
  }
  .footer-brand .bolt-sm {
    width: 26px; height: 26px; background: linear-gradient(135deg,#ff6020,#cc2c00);
    border-radius: 6px; display: flex; align-items: center; justify-content: center;
  }
  .footer-brand p { font-size: 13px; color: ${INK_FAINT}; line-height: 1.6; max-width: 28ch; }
  .footer-col h4 { font-family: ${FONT_DISPLAY}; font-size: 13px; font-weight: 600; color: ${INK}; margin-bottom: 16px; }
  .footer-col ul { list-style: none; display: flex; flex-direction: column; gap: 10px; }
  .footer-col a { font-size: 13px; color: ${INK_FAINT}; text-decoration: none; transition: color .15s; }
  .footer-col a:hover { color: ${INK}; }
  .footer-bottom {
    display: flex; justify-content: space-between; align-items: center;
    padding-top: 24px; border-top: 1px solid ${SURFACE_BORDER};
    font-family: ${FONT_MONO}; font-size: 11px; color: ${INK_FAINT};
    letter-spacing: 0.12em;
  }
  .footer-bottom .r { display: flex; gap: 20px; }

  /* Section spacing */
  .p-section { padding: 64px 0; }
  .p-section-sm { padding: 48px 0; }
  .section-header { margin-bottom: 40px; text-align: center; }
  .section-header h2 {
    font-family: ${FONT_DISPLAY}; font-size: clamp(28px,3.4vw,40px); font-weight: 700;
    letter-spacing: -0.02em; line-height: 1.08; margin-top: 14px;
    color: ${INK}; max-width: 700px; margin-left: auto; margin-right: auto;
  }
  .section-header .r { font-size: 14px; color: ${INK_MUTED}; max-width: 56ch; margin: 14px auto 0; line-height: 1.55; }
  /* ── Responsive ───────────────────────────────────────────────────────────
     La página nació sin un solo breakpoint: .pricing-grid era repeat(3,1fr)
     fijo, así que a 360px eran tres columnas de ~100px. Los margin negativos
     de .tier-divider tienen que seguir al padding de .tier en cada corte, o el
     divisor sobresale y produce scroll horizontal. */
  @media (max-width: 1080px) {
    .pricing-grid { grid-template-columns: 1fr; max-width: 520px; margin-left: auto; margin-right: auto; }
    .guarantee { grid-template-columns: repeat(2,1fr); }
    .footer-grid { grid-template-columns: 1fr 1fr; gap: 32px; }
  }
  @media (max-width: 760px) {
    .faq { grid-template-columns: 1fr; gap: 28px; }
    .cta-block { padding: 44px 24px; }
  }
  @media (max-width: 600px) {
    .pricing-wrap, .pricing-wrap-wide { padding: 0 20px; }
    .tier { padding: 28px 22px 24px; }
    .tier .tier-divider { margin: 0 -22px 24px; }
    .p-hero { padding: 104px 0 48px; }
    .guarantee { grid-template-columns: 1fr; }
    .footer-grid { grid-template-columns: 1fr; gap: 28px; }
    .g-item { padding: 22px; }
  }
  @media (max-width: 380px) {
    .pricing-wrap, .pricing-wrap-wide { padding: 0 14px; }
    .tier { padding: 24px 18px 22px; }
    .tier .tier-divider { margin: 0 -18px 22px; }
    .tier .price-num { font-size: 42px; }
    .billing-toggle button { padding: 9px 14px; font-size: 11px; }
  }

`

// ── Sub-components ────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg className="chk-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function DashIcon() {
  return (
    <svg className="chk-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function BoltIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill="url(#bp1)" />
      <defs>
        <linearGradient id="bp1" x1="12" y1="2" x2="12" y2="22">
          <stop stopColor="#ff8040" />
          <stop offset="1" stopColor="#d63200" />
        </linearGradient>
      </defs>
    </svg>
  )
}


interface TierFeature { text: string; note?: string; dim?: boolean }

interface TierCardProps {
  name: string
  tagline: string
  monthlyPrice: number
  annualPrice: number
  isAnnual: boolean
  featured?: boolean
  ribbon?: string
  ctaText: string
  ctaStyle?: 'primary' | 'ghost'
  onCta: () => void
  /** Distintivo sobre el CTA: hoy marca un plan publicado que todavía no se cobra. */
  badge?: string
  /** Con destino, el CTA es un enlace real en vez del alta; el alta no puede vender. */
  ctaHref?: string
  featLabel: string
  features: TierFeature[]
  origMonthly?: number
}

function TierCard({ name, tagline, monthlyPrice, annualPrice, isAnnual, featured, ribbon, ctaText, ctaStyle = 'ghost', onCta, badge, ctaHref, featLabel, features, origMonthly }: TierCardProps) {
  const price = isAnnual ? annualPrice : monthlyPrice
  const unit = isAnnual ? 'CLP / mes · pago anual' : 'CLP / mes'
  const formatClp = (value: number) => `$${value.toLocaleString('es-CL')}`

  return (
    <div className={`tier${featured ? ' featured' : ''}`}>
      {ribbon && <span className="tier-ribbon">{ribbon}</span>}
      <h3>{name}</h3>
      <p className="tier-sub">{tagline}</p>
      <div className="tier-price">
        {price === 0 ? (
          <span className="price-num">Gratis</span>
        ) : (
          <>
            <span className="price-num">{formatClp(price)}</span>
            <span className="price-unit">{unit}</span>
            {!isAnnual && origMonthly && price < origMonthly && (
              <span className="price-orig">{formatClp(origMonthly)}</span>
            )}
          </>
        )}
      </div>
      {badge && <div className="tier-badge">{badge}</div>}
      {ctaHref ? (
        <a href={ctaHref} className={`p-btn p-btn-lg p-btn-block p-btn-${ctaStyle}`} style={{ marginBottom: '28px' }}>
          {ctaText} {ctaStyle === 'primary' && <span>→</span>}
        </a>
      ) : (
        <button type="button" onClick={onCta} className={`p-btn p-btn-lg p-btn-block p-btn-${ctaStyle}`} style={{ marginBottom: '28px' }}>
          {ctaText} {ctaStyle === 'primary' && <span>→</span>}
        </button>
      )}
      <div className="tier-divider" />
      <div className="feat-label">{featLabel}</div>
      <ul>
        {features.map((f, i) => (
          <li key={i} className={f.dim ? 'dim' : ''}>
            {f.dim ? <DashIcon /> : <CheckIcon />}
            <span>{f.text}{f.note && <em> {f.note}</em>}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface FaqItemProps { question: string; answer: string; defaultOpen?: boolean }
function FaqItem({ question, answer, defaultOpen }: FaqItemProps) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div className="faq-item">
      <div className="faq-item-header" onClick={() => setOpen(o => !o)}>
        <span className="faq-q">{question}</span>
        <span className={`faq-ic${open ? ' open' : ''}`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </span>
      </div>
      {open && <p className="faq-a">{answer}</p>}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function PricingPage() {
  usePageMetadata(getPublicRouteMetadata(ROUTES.PRICING))

  const [isAnnual, setIsAnnual] = useState(false)
  const signInWithGoogle = useAuthStore(s => s.signInWithGoogle)
  const user = useAuthStore(s => s.user)
  const navigate = useNavigate()
  const authAvailable = isSupabaseConfigured
  const handleSignIn = async () => {
    if (!authAvailable) return
    try { await signInWithGoogle() } catch (e) { console.error(e) }
  }
  const handleAccess = () => {
    if (user) {
      navigate(ROUTES.HOME)
      return
    }
    void handleSignIn()
  }

  const starterFeatures: TierFeature[] = [
    { text: 'Habla con RallyIQ Coach sobre tu entrenamiento' },
    { text: 'Crea y registra entrenamientos multideporte' },
    { text: 'Semana simple con estado de cada sesión' },
    { text: 'Check-in diario de sueño, energía y molestias' },
    { text: 'Funciona sin conexión y sincroniza después' },
    { text: 'Plan semanal generado por el coach', dim: true },
    { text: 'Plan Builder por objetivo', dim: true },
  ]

  const proFeatures: TierFeature[] = [
    { text: 'Coach AI con contexto completo de tu semana' },
    { text: 'Entrenamientos semanales sugeridos y ajustables' },
    { text: 'Squash, running, fuerza, movilidad y ciclismo' },
    { text: 'Cambios por fatiga, alcohol, sueño o dolor' },
    { text: 'Resúmenes semanales y notas accionables' },
    { text: 'Historial y carga por deporte' },
    { text: 'Plan Builder por objetivo', dim: true },
  ]

  const eliteFeatures: TierFeature[] = [
    { text: 'Todo lo del plan Coach Semanal' },
    { text: 'Plan Builder por carrera, torneo o bloque' },
    { text: 'Periodización por fases: base, build, peak y taper' },
    { text: 'Reparación automática de semanas incoherentes' },
    { text: 'Exporta tus datos cuando quieras' },
    { text: 'Soporte prioritario para preparar objetivos' },
  ]

  return (
    <div style={{ background: SURFACE_DEEP, minHeight: '100vh', color: INK, fontFamily: FONT_DISPLAY }}>
      <style>{css}</style>
      <SharedPublicNav onSignup={handleSignIn} onLogin={handleSignIn} isAuthenticated={Boolean(user)} />

      {/* Hero */}
      <section className="p-hero">
        <div className="glow" />
        <div className="pricing-wrap">
          <div className="p-hero-inner">
            <span className="p-label brand" style={{ justifyContent: 'center', display: 'inline-flex' }}>
              Precios simples · beta privada
            </span>
            <h1>Elige cuánto quieres que el coach <span className="hl">haga contigo.</span></h1>
            <p className="lede">
              RallyIQ parte gratis para conversar con el coach y registrar entrenamientos. Cuando necesitas estructura semanal o preparar un objetivo completo, subes de plan sin cambiar de app.
            </p>
            <div className="billing-toggle">
              <button className={!isAnnual ? 'on' : ''} onClick={() => setIsAnnual(false)}>Mensual</button>
              <button className={isAnnual ? 'on' : ''} onClick={() => setIsAnnual(true)}>
                Anual <span className="billing-save">−20%</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Cards */}
      <section style={{ paddingBottom: '24px' }}>
        <div className="pricing-wrap">
          <div className="pricing-grid">
            <TierCard
              name="Base"
              tagline="Para empezar a conversar con tu coach y registrar lo que entrenas."
              monthlyPrice={0}
              annualPrice={0}
              isAnnual={isAnnual}
              ctaText={user ? 'Ir a mi panel' : 'Empezar gratis'}
              ctaStyle="ghost"
              onCta={handleAccess}
              featLabel="Incluye"
              features={starterFeatures}
            />
            <TierCard
              name="Coach Semanal"
              tagline="Para que RallyIQ te ayude a armar y ajustar la semana de entrenamiento."
              monthlyPrice={12990}
              annualPrice={9990}
              isAnnual={isAnnual}
              featured
              ribbon="Más útil"
              ctaText="Pedir acceso a la beta"
              ctaStyle="primary"
              onCta={handleAccess}
              badge={BETA_BADGE}
              ctaHref={buildBetaAccessMailto('Coach Semanal')}
              featLabel="Todo de Base, más"
              features={proFeatures}
              origMonthly={15990}
            />
            <TierCard
              name="Avanzado"
              tagline="Para preparar carreras, torneos o bloques completos con Plan Builder."
              monthlyPrice={24990}
              annualPrice={19990}
              isAnnual={isAnnual}
              ctaText="Pedir acceso a la beta"
              ctaStyle="ghost"
              onCta={handleAccess}
              badge={BETA_BADGE}
              ctaHref={buildBetaAccessMailto('Avanzado')}
              featLabel="Todo de Coach Semanal, más"
              features={eliteFeatures}
            />
          </div>
        </div>
      </section>

      {/* Guarantee Row */}
      <section className="p-section-sm">
        <div className="pricing-wrap">
          <div className="guarantee">
            <div className="g-item">
              <div className="g-ic">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="10" />
                </svg>
              </div>
              <h4>Sin permanencia</h4>
              <p>Base es gratis. En planes pagados puedes bajar cuando quieras mientras la beta crece.</p>
            </div>
            <div className="g-item">
              <div className="g-ic">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <h4>Datos tuyos, siempre</h4>
              <p>Export completo en cualquier plan. Tus sesiones no se pierden si te vas.</p>
            </div>
            <div className="g-item">
              <div className="g-ic">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
                </svg>
              </div>
              <h4>Demo acompañada</h4>
              <p>Si estás evaluando RallyIQ para entrenar en serio, te ayudamos a configurar la primera semana.</p>
            </div>
            <div className="g-item">
              <div className="g-ic">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h4>Soporte humano</h4>
              <p>Escríbenos y te responde alguien del equipo — no un bot, no un ticket perdido.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="p-section" style={{ paddingTop: '48px' }}>
        <div className="pricing-wrap">
          <div className="section-header">
            <span className="p-label" style={{ display: 'inline-flex' }}>Comparación completa</span>
            <h2>¿Qué cambia entre planes?</h2>
            <p className="r">Todas las funcionalidades, lado a lado. Sin letra pequeña.</p>
          </div>
          <div className="compare-shell">
            <table className="compare-table">
              <thead>
                <tr>
                  <th>Funcionalidad</th>
                  <th>Base</th>
                  <th className="pro">Coach Semanal</th>
                  <th>Avanzado</th>
                </tr>
              </thead>
              <tbody>
                <tr className="section-row"><td colSpan={4}>Planificación</td></tr>
                <tr><td>Crear y registrar entrenamientos</td><td><span className="chk">✓</span></td><td className="pro"><span className="chk brand">✓</span></td><td><span className="chk">✓</span></td></tr>
                <tr><td>Entrenamientos semanales sugeridos</td><td className="dash">—</td><td className="pro"><span className="chk brand">✓</span></td><td><span className="chk">✓</span></td></tr>
                <tr><td>Plan Builder por objetivo</td><td className="dash">—</td><td className="dash">—</td><td><span className="chk">✓</span></td></tr>
                <tr><td>Deportes soportados</td><td>5</td><td className="pro">5</td><td>5</td></tr>

                <tr className="section-row"><td colSpan={4}>RallyIQ AI</td></tr>
                <tr><td>Chat con contexto</td><td><span className="chk">✓</span></td><td className="pro"><span className="chk brand">Completo</span></td><td><span className="chk">Completo</span></td></tr>
                <tr><td>Propuestas automáticas aplicables</td><td className="dash">—</td><td className="pro"><span className="chk brand">✓</span></td><td><span className="chk">✓</span></td></tr>
                <tr><td>Notas semanales del coach</td><td className="dash">—</td><td className="pro"><span className="chk brand">✓</span></td><td><span className="chk">✓</span></td></tr>
                <tr><td>Razonamiento transparente</td><td className="dash">—</td><td className="pro"><span className="chk brand">✓</span></td><td><span className="chk">✓</span></td></tr>

                <tr className="section-row"><td colSpan={4}>Analytics & datos</td></tr>
                <tr><td>Historial</td><td>30 días</td><td className="pro">Completo</td><td>Completo</td></tr>
                <tr><td>ACWR, strain, monotonía</td><td className="dash">—</td><td className="pro"><span className="chk brand">✓</span></td><td><span className="chk">✓</span></td></tr>
                <tr><td>Export CSV / JSON</td><td className="dash">—</td><td className="dash">—</td><td><span className="chk">✓</span></td></tr>
                <tr><td>Plan exportable</td><td className="dash">—</td><td className="dash">—</td><td><span className="chk">✓</span></td></tr>

                <tr className="section-row"><td colSpan={4}>Colaboración & soporte</td></tr>
                <tr><td>Configuración inicial acompañada</td><td className="dash">—</td><td className="pro">Beta</td><td>Beta</td></tr>
                <tr><td>Soporte</td><td>Email</td><td className="pro">Email prioritario</td><td>Prioritario</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="p-section" style={{ paddingTop: '24px' }}>
        <div className="pricing-wrap">
          <div className="faq">
            <div className="faq-head">
              <span className="p-label" style={{ display: 'inline-flex' }}>Dudas frecuentes</span>
              <h2>Preguntas honestas, respuestas honestas.</h2>
              <p>
                Si algo no está aquí, <a href={`mailto:${PRELAUNCH_CONTACT_EMAIL}`}>escríbenos</a>. Responde una persona, no un bot.
              </p>
            </div>
            <div className="faq-list">
              <FaqItem
                defaultOpen
                question="¿Puedo cancelar cuando quiera?"
                answer="Sí. Base es gratis y los planes pagados no tienen permanencia. Durante beta cerrada también podemos ayudarte manualmente si algo no está automatizado todavía."
              />
              <FaqItem
                question="¿Qué pasa con mis datos si me voy?"
                answer="Tus datos son tuyos. Puedes exportar sesiones, check-ins y planes desde Ajustes. Si bajas de plan, no perdemos tu historial."
              />
              <FaqItem
                question="¿Funciona offline?"
                answer="Sí. RallyIQ es una PWA local-first. Registras sesiones, haces check-in y ves tu plan sin conexión. Cuando vuelves a tener señal, sincroniza en segundo plano. RallyIQ AI sí requiere conexión."
              />
              <FaqItem
                question="¿Hay descuento por pago anual?"
                answer="Sí — el selector de arriba muestra el precio anual con descuento. También estamos probando cupos fundador para atletas que quieran dar feedback temprano."
              />
              <FaqItem
                question="¿Qué deportes soporta exactamente?"
                answer="Squash, running, fuerza, movilidad, ciclismo y recuperación. La app nació desde squash competitivo, pero la dirección es multideporte: una semana, una carga, varios estímulos."
              />
              <FaqItem
                question="¿Dónde se guardan mis datos?"
                answer="Local en tu dispositivo (IndexedDB) y sincronizado con Supabase en servidores EU-West. Cifrado en tránsito y en reposo. No vendemos datos, no entrenamos modelos con tu información."
              />
              <FaqItem
                question="¿Cuál plan recomiendan para partir?"
                answer="Base si quieres explorar y hablar con el coach. Coach Semanal si ya entrenas 3-6 veces por semana. Avanzado si estás preparando una carrera, torneo o bloque completo."
              />
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="p-section">
        <div className="pricing-wrap">
          <div className="cta-block">
            <div className="cta-grid-bg" />
            <span className="p-label brand" style={{ display: 'inline-flex' }}>Empieza simple</span>
            <h2>Habla con el coach, registra tu semana y <span className="hl">sube cuando haga sentido.</span></h2>
            <p>La demo tiene que sentirse útil desde el primer día, no como una promesa futura.</p>
            <div className="cta-act">
              <button type="button" onClick={handleAccess} className="p-btn p-btn-primary p-btn-lg">
                {user ? 'Ir a mi panel' : 'Empezar gratis'} <span>→</span>
              </button>
              <Link to="/features" className="p-btn p-btn-ghost p-btn-lg">Ver funcionalidades</Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="pricing-footer">
        <div className="pricing-wrap-wide">
          <div className="footer-grid">
            <div className="footer-brand">
              <Link to="/" className="nav-logo-f">
                <span className="bolt-sm">
                  <BoltIcon />
                </span>
                RallyIQ
              </Link>
              <p>Un coach multideporte para planificar, ajustar y entender tu entrenamiento semanal.</p>
            </div>
            <div className="footer-col">
              <h4>Producto</h4>
              <ul>
                <li><Link to={ROUTES.FEATURES}>Funcionalidades</Link></li>
                <li><Link to={ROUTES.PRICING}>Precios</Link></li>
                <li><a href={`mailto:${PRELAUNCH_CONTACT_EMAIL}`}>Demo</a></li>
                <li><a href={`mailto:${PRELAUNCH_CONTACT_EMAIL}`}>Roadmap</a></li>
              </ul>
            </div>
            <div className="footer-col">
              <h4>Para atletas</h4>
              <ul>
                <li><a href={`mailto:${PRELAUNCH_CONTACT_EMAIL}`}>Piloto fundador</a></li>
                <li><a href={`mailto:${PRELAUNCH_CONTACT_EMAIL}`}>Clubes</a></li>
                <li><a href={`mailto:${PRELAUNCH_CONTACT_EMAIL}`}>Entrenadores</a></li>
                <li><a href={`mailto:${PRELAUNCH_CONTACT_EMAIL}`}>Feedback</a></li>
              </ul>
            </div>
            <div className="footer-col">
              <h4>Empresa</h4>
              <ul>
                <li><a href={`mailto:${PRELAUNCH_CONTACT_EMAIL}`}>Contacto</a></li>
                <li><a href={`mailto:${PRELAUNCH_CONTACT_EMAIL}`}>Soporte</a></li>
                <li><Link to={ROUTES.PRIVACY}>Privacidad</Link></li>
                <li><Link to={ROUTES.TERMS}>Términos</Link></li>
                <li><Link to={ROUTES.HEALTH_DISCLAIMER}>Descargo de salud</Link></li>
                <li><Link to={ROUTES.WHOOP_DISCLAIMER}>Descargo Whoop</Link></li>
              </ul>
            </div>
          </div>
          <div className="footer-bottom">
            <div>© 2026 · RALLYIQ LABS</div>
            <div className="r"><span>Beta privada</span><span>Hecho para atletas multideporte</span></div>
          </div>
        </div>
      </footer>
    </div>
  )
}

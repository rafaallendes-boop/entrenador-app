import { ArrowRight } from 'lucide-react'
import { useAuthStore } from '../store/useAuthStore'
import { isSupabaseConfigured } from '../services/auth'
import SharedPublicNav from '../components/SharedPublicNav'

const BRAND = '#ff4d00'
const BRAND_LIGHT = '#ff7a33'
const FORGE_LIME = '#d1fc00'
const FORGE_CYAN = '#00e3fd'
const FORGE_EMBER = '#ffeb9c'
const INK = '#f5f5f7'
const INK_MUTED = '#a0a0a5'
const INK_FAINT = '#6e6e73'
const SURFACE_BORDER = 'rgba(255,255,255,0.07)'
const FONT_DISPLAY = "'Lexend', 'Inter', system-ui, sans-serif"
const FONT_MONO = "'JetBrains Mono', 'Fira Mono', monospace"

export default function FeaturesPage() {
  const signInWithGoogle = useAuthStore(s => s.signInWithGoogle)
  const authAvailable = isSupabaseConfigured

  const handleSignIn = async () => {
    if (!authAvailable) return
    try { await signInWithGoogle() } catch (e) { console.error(e) }
  }

  return (
    <div
      style={{ background: '#0a0a0a', color: INK, fontFamily: "'Inter', system-ui, sans-serif", minHeight: '100vh' }}
    >
      <SharedPublicNav onSignup={handleSignIn} onLogin={handleSignIn} />

      <main>
        <FeaturesHero />
        <FeatureRow1Coach />
        <FeatureRow2Semana />
        <FeatureRow3Multi />
        <FeatureRow4Checkin />
        <FeaturesCTA onSignup={handleSignIn} />
        <FeaturesFooter />
      </main>

      <style>{css}</style>
    </div>
  )
}

/* ─── HERO ─────────────────────────────────────────────── */

function FeaturesHero() {
  return (
    <section className="relative overflow-hidden" style={{ padding: '88px 0 64px', paddingTop: 120 }}>
      <div className="pointer-events-none absolute" style={{ top: -120, left: '10%', width: 520, height: 520, background: 'radial-gradient(circle, rgba(255,77,0,0.3), transparent 60%)', filter: 'blur(90px)', opacity: 0.45 }} />
      <div className="pointer-events-none absolute" style={{ top: -40, right: '5%', width: 440, height: 440, background: 'radial-gradient(circle, rgba(0,227,253,0.22), transparent 60%)', filter: 'blur(90px)', opacity: 0.45 }} />
      <div className="relative z-10 mx-auto w-full max-w-7xl px-6 md:px-10">
        <div className="grid grid-cols-1 items-end gap-16 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <div className="label-mono brand mb-5">Funcionalidades · v2.4</div>
            <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(40px, 5vw, 64px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.05, margin: '0 0 24px', color: INK }}>
              Cada sesión,{' '}
              <span style={{ color: BRAND }}>analizada.</span>
              <br />
              Cada semana,{' '}
              <span style={{ color: FORGE_LIME }}>optimizada.</span>
            </h1>
            <p style={{ fontSize: 18, lineHeight: 1.55, color: INK_MUTED, maxWidth: '56ch' }}>
              RallyIQ no es otro tracker. Es un sistema cerrado —
              plan, registro, RallyIQ AI y analytics — diseñado para atletas que entrenan
              en serio y no tienen tiempo para planillas.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <KpiCard value="05" label="Módulos core" note="RallyIQ · Semana · Check-in · Historial · Analytics" color={BRAND_LIGHT} />
            <KpiCard value="05" label="Deportes" note="Squash, running, fuerza, movilidad, ciclismo" color={FORGE_LIME} />
            <KpiCard value="24/7" unit="" label="RallyIQ disponible" note="Propuestas automáticas según tu carga y fatiga" color={FORGE_CYAN} />
            <KpiCard value="PWA" unit="" label="Local-first" note="Funciona offline. Sincroniza cuando puedes." />
          </div>
        </div>
      </div>
    </section>
  )
}

function KpiCard({ value, unit, label, note, color }: { value: string; unit?: string; label: string; note: string; color?: string }) {
  return (
    <div
      style={{
        padding: 22, background: 'rgba(24,24,24,0.6)',
        border: `1px solid ${SURFACE_BORDER}`, borderRadius: 14,
      }}
    >
      <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 28, color: color || INK, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {value}
        {unit !== undefined && <span style={{ color: INK_FAINT, fontSize: 14, fontWeight: 400 }}>{unit}</span>}
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.26em', textTransform: 'uppercase', color: INK_FAINT, marginTop: 10 }}>{label}</div>
      <p style={{ fontSize: 12, color: INK_MUTED, marginTop: 8, lineHeight: 1.5 }}>{note}</p>
    </div>
  )
}

/* ─── FEATURE ROWS ─────────────────────────────────────── */

function FeatureRow({ reverse, children }: { reverse?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ padding: '0 0 88px' }}>
      <div className="mx-auto w-full max-w-7xl px-6 md:px-10">
        <div
          className={`grid grid-cols-1 items-center gap-20 lg:grid-cols-2 ${reverse ? 'lg:[&>:first-child]:order-2' : ''}`}
          style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 88 }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function FeatureRow1Coach() {
  return (
    <FeatureRow>
      <div style={{ maxWidth: 520 }}>
        <div className="label-mono brand flex items-center gap-2 mb-4">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>
          RALLYIQ AI
        </div>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 38, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1, margin: '0 0 18px', color: INK }}>
          Propuestas reales, no consejos vagos.
        </h2>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: INK_MUTED, marginBottom: 28 }}>
          RallyIQ AI lee tu plan, tu adherencia y tu check-in diario. Genera cambios concretos al volumen, intensidad o descansos — con justificación. Aplicas con un tap.
        </p>
        <FeatureList items={[
          { title: 'Chat 24/7 con contexto', sub: 'Conoce tu semana, tu historial y tu estado actual. Nada genérico.' },
          { title: 'Propuestas aplicables en un tap', sub: 'Cada sugerencia viene con diff visual y botón "Aplicar".' },
          { title: 'Razonamiento transparente', sub: 'Expande cada propuesta para ver los datos que usó.' },
        ]} accent={BRAND} />
      </div>

      <VisualCard accent={BRAND} tag="RALLYIQ · EN VIVO">
        <div className="flex flex-col gap-2.5">
          <ChatBub type="u">Mañana tengo match pero dormí mal 3 días.</ChatBub>
          <ChatBub type="a">
            Bajemos la carga de fuerza hoy. Tu{' '}
            <b style={{ color: FORGE_LIME }}>RPE promedio</b>{' '}
            subió de 6.8 a 7.9 esta semana. Preparo propuesta.
          </ChatBub>
          <ProposalCard
            title="Jueves · Fuerza −15%"
            body="Vol de 45 → 38 min. Reemplazo series máximas por activación. Mantengo técnica."
          />
        </div>
      </VisualCard>
    </FeatureRow>
  )
}

function FeatureRow2Semana() {
  return (
    <FeatureRow reverse>
      <div style={{ maxWidth: 520 }}>
        <div className="label-mono lime flex items-center gap-2 mb-4">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          SEMANA
        </div>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 38, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1, margin: '0 0 18px', color: INK }}>
          Planificación semanal sin fricción.
        </h2>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: INK_MUTED, marginBottom: 28 }}>
          Una grilla de 7 días que entiendes en 5 segundos. Deportes por color, adherencia en tiempo real, duplicación de semanas y plantillas listas por bloque.
        </p>
        <FeatureList accent={FORGE_LIME} items={[
          { title: 'Vista día + vista semana', sub: 'Alterna entre foco diario y vista general sin perder contexto.' },
          { title: 'Plantillas por bloque', sub: 'Periodización A/B/C. Copia estructura, ajustá cargas.' },
          { title: 'Adherencia en vivo', sub: 'Porcentaje por semana, volumen real vs planificado.' },
        ]} />
      </div>

      <VisualCard tag="SEMANA 16 · BLOQUE B" tagRight="78% ADHERENCIA" tagRightColor={FORGE_LIME}>
        <WeekGrid />
      </VisualCard>
    </FeatureRow>
  )
}

function FeatureRow3Multi() {
  return (
    <FeatureRow>
      <div style={{ maxWidth: 520 }}>
        <div className="label-mono cyan flex items-center gap-2 mb-4">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 010 20"/><path d="M12 2a15 15 0 000 20"/></svg>
          MULTIDEPORTE
        </div>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 38, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1, margin: '0 0 18px', color: INK }}>
          Cinco deportes. Una sola carga.
        </h2>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: INK_MUTED, marginBottom: 28 }}>
          El mismo sistema unifica squash, running, fuerza, movilidad y ciclismo. No sumas apps — sumas claridad. La carga total se mide una vez, por todo.
        </p>
        <FeatureList accent={FORGE_CYAN} items={[
          { title: 'Métricas por deporte', sub: 'Zonas en running, series en fuerza, rallies en squash.' },
          { title: 'Carga unificada', sub: 'ACWR, monotonía y strain calculados sobre todo lo que haces.' },
        ]} />
      </div>

      <VisualCard tag="DEPORTES ACTIVOS" tagRight="05">
        <SportGrid />
      </VisualCard>
    </FeatureRow>
  )
}

function FeatureRow4Checkin() {
  return (
    <FeatureRow reverse>
      <div style={{ maxWidth: 520 }}>
        <div className="label-mono brand flex items-center gap-2 mb-4">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          CHECK-IN DIARIO
        </div>
        <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 38, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1, margin: '0 0 18px', color: INK }}>
          30 segundos por día. Datos para toda la temporada.
        </h2>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: INK_MUTED, marginBottom: 28 }}>
          Sueño, RPE del día anterior, dolor/molestias, ánimo. El check-in toma medio minuto — y alimenta cada propuesta de RallyIQ.
        </p>
        <FeatureList items={[
          { title: 'Notificación inteligente', sub: 'Por la mañana, una sola. No te perseguimos.' },
          { title: 'Tendencias visibles', sub: '7, 14, 28 días. Detectá patrones antes de que sean lesión.' },
        ]} accent={BRAND} />
      </div>

      <VisualCard accent={BRAND} tag="CHECK-IN · 09:14 AM" tagRight="COMPLETADO" tagRightColor={FORGE_LIME}>
        <CheckInVisual />
      </VisualCard>
    </FeatureRow>
  )
}

/* ─── VISUAL CARD WRAPPER ───────────────────────────────── */

function VisualCard({
  children, tag, tagRight, tagRightColor, accent,
}: {
  children: React.ReactNode; tag: string;
  tagRight?: string; tagRightColor?: string; accent?: string;
}) {
  const borderGrad = accent
    ? `linear-gradient(135deg, ${accent}88, rgba(255,255,255,0.06) 40%, ${accent}44 100%)`
    : `linear-gradient(135deg, rgba(209,252,0,0.4), rgba(255,255,255,0.06) 40%, rgba(0,227,253,0.3) 100%)`

  return (
    <div
      style={{
        position: 'relative', borderRadius: 20,
        background: 'rgba(22,22,22,0.8)',
        backdropFilter: 'blur(12px)',
        padding: 28, minHeight: 460,
        boxShadow: '0 40px 80px -30px rgba(0,0,0,0.9)',
      }}
      className="vcard-wrap"
    >
      <div
        className="vcard-border"
        style={{
          position: 'absolute', inset: 0, borderRadius: 20, padding: 1,
          background: borderGrad,
          WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
          pointerEvents: 'none',
        }}
      />
      <div className="relative z-10">
        <div className="mb-5 flex items-center justify-between">
          <span style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.32em', textTransform: 'uppercase', color: INK_FAINT }}>{tag}</span>
          {tagRight && <span style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.32em', textTransform: 'uppercase', color: tagRightColor || INK_FAINT }}>{tagRight}</span>}
          {!tagRight && <span style={{ width: 8, height: 8, borderRadius: '50%', background: BRAND, boxShadow: `0 0 14px ${BRAND}`, display: 'inline-block' }} />}
        </div>
        {children}
      </div>
    </div>
  )
}

/* ─── CHAT BUBBLES ──────────────────────────────────────── */

function ChatBub({ type, children }: { type: 'u' | 'a'; children: React.ReactNode }) {
  return (
    <div
      style={{
        alignSelf: type === 'u' ? 'flex-end' : 'flex-start',
        padding: '12px 14px', borderRadius: 14,
        maxWidth: '80%', fontSize: 13, lineHeight: 1.45,
        background: type === 'u' ? 'rgba(255,77,0,0.12)' : 'rgba(255,255,255,0.04)',
        border: type === 'u' ? '1px solid rgba(255,77,0,0.28)' : '1px solid rgba(255,255,255,0.08)',
        color: INK,
      }}
    >
      {children}
    </div>
  )
}

function ProposalCard({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        background: 'rgba(20,20,20,0.9)',
        border: '1px solid rgba(209,252,0,0.25)',
        borderRadius: 14, padding: 14, width: '100%', marginTop: 4,
      }}
    >
      <div className="flex justify-between" style={{ marginBottom: 10, fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.26em', textTransform: 'uppercase', color: FORGE_LIME }}>
        <span>PROPUESTA</span><span>ahora</span>
      </div>
      <h5 style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 6 }}>{title}</h5>
      <p style={{ fontSize: 12, color: INK_MUTED, lineHeight: 1.5 }}>{body}</p>
      <div className="mt-3 flex gap-2">
        <div style={{ flex: 1, padding: 8, borderRadius: 8, fontSize: 12, fontWeight: 600, textAlign: 'center', background: 'rgba(209,252,0,0.14)', border: '1px solid rgba(209,252,0,0.32)', color: FORGE_LIME }}>
          Aplicar cambios
        </div>
        <div style={{ padding: '8px 14px', borderRadius: 8, fontSize: 12, background: 'rgba(255,255,255,0.04)', border: `1px solid ${SURFACE_BORDER}`, color: INK_MUTED }}>
          Más tarde
        </div>
      </div>
    </div>
  )
}

/* ─── WEEK GRID ─────────────────────────────────────────── */

const WEEK_CELLS = [
  { type: 'orange', sport: 'Squash', time: '18:30 · 60′' },
  { type: 'lime', sport: 'Fuerza', time: '7:00 · 45′' },
  { type: 'cyan', sport: 'Run', time: '7:30 · 40′' },
  { type: 'orange', sport: 'Squash', time: '18:30 · 60′' },
  { type: 'ember', sport: 'Movil.', time: '8:00 · 20′' },
  { type: 'empty', sport: '—', time: 'libre' },
  { type: 'lime', sport: 'Fuerza', time: '9:00 · 50′' },
]

function WeekGrid() {
  const colorsMap: Record<string, { bg: string; border: string; text: string }> = {
    orange: { bg: 'rgba(255,77,0,0.1)', border: 'rgba(255,77,0,0.3)', text: BRAND_LIGHT },
    lime:   { bg: 'rgba(209,252,0,0.1)', border: 'rgba(209,252,0,0.3)', text: FORGE_LIME },
    cyan:   { bg: 'rgba(0,227,253,0.08)', border: 'rgba(0,227,253,0.26)', text: FORGE_CYAN },
    ember:  { bg: 'rgba(255,235,156,0.08)', border: 'rgba(255,235,156,0.22)', text: FORGE_EMBER },
    empty:  { bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.06)', text: INK_FAINT },
  }
  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-7 gap-2" style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.32em', textTransform: 'uppercase', color: INK_FAINT, textAlign: 'center' }}>
        {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d => <span key={d}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {WEEK_CELLS.map((c, i) => {
          const col = colorsMap[c.type]
          return (
            <div key={i} style={{ minHeight: 80, borderRadius: 10, background: col.bg, border: `1px solid ${col.border}`, padding: 8, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.22em', textTransform: 'uppercase', color: col.text, fontWeight: 600 }}>{c.sport}</span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: INK_FAINT, marginTop: 'auto' }}>{c.time}</span>
            </div>
          )
        })}
      </div>
      <div className="flex justify-between" style={{ paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        {[['Volumen total','215′'], ['Sesiones plan','6'], ['Hechas','4 / 6'], ['Descanso','2 d']].map(([label, val]) => (
          <div key={label}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: '0.3em', textTransform: 'uppercase', color: INK_FAINT, marginBottom: 2 }}>{label}</div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: label === 'Hechas' ? FORGE_LIME : INK, fontWeight: 600 }}>{val}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── SPORT GRID ────────────────────────────────────────── */

const SPORTS_DATA = [
  { name: 'Squash', sessions: '08', vol: '540′', stat: 'RPE 7.4', style: { border: 'rgba(255,77,0,0.3)', bg: 'rgba(255,77,0,0.06)', nameColor: BRAND_LIGHT } },
  { name: 'Fuerza', sessions: '06', vol: '280′', stat: 'RPE 6.8', style: { border: 'rgba(209,252,0,0.28)', bg: 'rgba(209,252,0,0.05)', nameColor: INK } },
  { name: 'Running', sessions: '04', vol: '32 km', stat: 'Ritmo 4:50', style: { border: 'rgba(0,227,253,0.28)', bg: 'transparent', nameColor: INK } },
  { name: 'Movilidad', sessions: '12', vol: '180′', stat: '', style: { border: SURFACE_BORDER, bg: 'transparent', nameColor: INK } },
  { name: 'Ciclismo', sessions: '04', vol: '120 km', stat: 'Z2 80%', style: { border: SURFACE_BORDER, bg: 'transparent', nameColor: INK } },
]

function SportGrid() {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {SPORTS_DATA.map(s => (
        <div key={s.name} style={{ padding: 18, borderRadius: 12, background: s.style.bg || 'rgba(255,255,255,0.03)', border: `1px solid ${s.style.border}` }}>
          <div className="mb-3.5 flex items-center justify-between">
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600, color: s.style.nameColor }}>{s.name}</span>
            <span style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.28em', textTransform: 'uppercase', color: INK_FAINT }}>{s.sessions} SES</span>
          </div>
          <div className="flex gap-3">
            <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: INK_MUTED }}>Vol <b style={{ color: INK }}>{s.vol}</b></span>
            {s.stat && <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: INK_MUTED }}>{s.stat.split(' ')[0]} <b style={{ color: INK }}>{s.stat.split(' ').slice(1).join(' ')}</b></span>}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ─── CHECK-IN VISUAL ───────────────────────────────────── */

function CheckInVisual() {
  return (
    <div className="flex flex-col gap-3.5">
      {[
        { label: 'Sueño', val: '7.2 h', active: 7, color: FORGE_CYAN },
        { label: 'RPE ayer', val: '7', active: 7, color: FORGE_LIME },
        { label: 'Ánimo', val: '8', active: 8, color: FORGE_LIME },
        { label: 'Dolor', val: '2', active: 2, color: BRAND },
      ].map(r => (
        <div key={r.label} className="flex items-center justify-between" style={{ padding: '14px 16px', background: 'rgba(255,255,255,0.03)', border: `1px solid ${SURFACE_BORDER}`, borderRadius: 12 }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: INK_MUTED }}>{r.label}</span>
          <span style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: 20, color: INK, fontVariantNumeric: 'tabular-nums' }}>{r.val}</span>
          <div className="flex gap-1">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} style={{ width: 16, height: 6, borderRadius: 2, background: i < r.active ? r.color : 'rgba(255,255,255,0.08)' }} />
            ))}
          </div>
        </div>
      ))}
      <div style={{ padding: 14, background: 'rgba(209,252,0,0.06)', border: '1px solid rgba(209,252,0,0.2)', borderRadius: 12, display: 'flex', gap: 12 }}>
        <div style={{ width: 6, borderRadius: 3, background: FORGE_LIME, flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: INK, marginBottom: 2 }}>Estado: listo para cargar.</div>
          <div style={{ fontSize: 12, color: INK_MUTED, lineHeight: 1.5 }}>Sueño consolidado, dolor bajo, RPE acumulado estable. Puedes ejecutar el plan como está.</div>
        </div>
      </div>
    </div>
  )
}

/* ─── FEATURE LIST ──────────────────────────────────────── */

function FeatureList({
  items, accent,
}: {
  items: { title: string; sub: string }[];
  accent?: string;
}) {
  const col = accent || BRAND
  const bg = `${col}14`
  const border = `${col}38`
  return (
    <ul className="flex flex-col gap-4">
      {items.map(item => (
        <li key={item.title} className="flex items-start gap-3.5">
          <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: bg, border: `1px solid ${border}`, color: col }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: INK, marginBottom: 3 }}>{item.title}</div>
            <div style={{ fontSize: 13, color: INK_MUTED, lineHeight: 1.5 }}>{item.sub}</div>
          </div>
        </li>
      ))}
    </ul>
  )
}

/* ─── CTA ───────────────────────────────────────────────── */

function FeaturesCTA({ onSignup }: { onSignup: () => void }) {
  return (
    <section style={{ padding: '80px 0' }}>
      <div className="mx-auto w-full max-w-7xl px-6 md:px-10">
        <div
          style={{
            position: 'relative', padding: '64px 56px', borderRadius: 24, overflow: 'hidden',
            background: 'radial-gradient(ellipse 80% 80% at 50% 110%, rgba(255,77,0,0.25), transparent 60%), linear-gradient(180deg, #151515, #0c0c0c)',
            border: '1px solid rgba(255,77,0,0.18)',
          }}
        >
          <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)', backgroundSize: '22px 22px', WebkitMaskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, #000, transparent 80%)', maskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, #000, transparent 80%)' }} />
          <div style={{ position: 'relative' }}>
            <div className="label-mono brand" style={{ marginBottom: 24 }}>Listo para empezar</div>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(28px, 3.6vw, 44px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.08, marginBottom: 16, maxWidth: 700, color: INK }}>
              Empieza <span style={{ color: BRAND }}>gratis.</span><br /> Sube a Pro cuando lo necesites.
            </h2>
            <p style={{ fontSize: 16, color: INK_MUTED, maxWidth: 500, marginBottom: 28, lineHeight: 1.5 }}>
              5 días de Pro incluidos al registrarte. Sin tarjeta. Sin letra pequeña.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={onSignup}
                className="btn-primary-pill inline-flex items-center gap-2 rounded-xl px-7 py-4 text-[15px] font-bold text-white"
              >
                Ver precios <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
              </button>
              <a href="/" style={{ color: INK, background: 'rgba(255,255,255,0.03)', border: `1px solid ${SURFACE_BORDER}`, borderRadius: 12, padding: '16px 28px', fontSize: 15, fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                Volver al inicio
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ─── FOOTER ────────────────────────────────────────────── */

function FeaturesFooter() {
  return (
    <footer style={{ borderTop: `1px solid ${SURFACE_BORDER}`, background: '#050505', padding: '56px 0' }}>
      <div className="mx-auto flex w-full max-w-7xl flex-col items-start justify-between gap-8 px-6 md:flex-row md:px-10">
        <div style={{ maxWidth: 260 }}>
          <div className="flex items-center gap-2.5">
            <BoltIcon />
            <span style={{ fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 900, letterSpacing: '-0.03em', color: '#fff' }}>RallyIQ</span>
          </div>
          <p style={{ marginTop: 12, fontSize: 13, lineHeight: 1.6, color: INK_MUTED }}>RallyIQ AI para atletas de raqueta y endurance. Hecho por atletas, para atletas.</p>
        </div>
        <div className="flex flex-wrap gap-12">
          {[
            { title: 'Producto', links: ['Funcionalidades', 'Precios', 'Changelog', 'Roadmap'] },
            { title: 'Comunidad', links: ['Atletas', 'Blog', 'Discord', 'Newsletter'] },
            { title: 'Empresa', links: ['Nosotros', 'Contacto', 'Privacidad', 'Términos'] },
          ].map(col => (
            <div key={col.title}>
              <h4 style={{ fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 16 }}>{col.title}</h4>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {col.links.map(l => <li key={l}><a href="#" style={{ fontSize: 13, color: INK_MUTED, textDecoration: 'none' }}>{l}</a></li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 md:px-10" style={{ borderTop: `1px solid ${SURFACE_BORDER}`, marginTop: 48, paddingTop: 20 }}>
        <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: INK_FAINT }}>© 2026 · RALLYIQ LABS</span>
        <div className="flex gap-4">
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: INK_FAINT }}>v2.4.0</span>
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: INK_FAINT }}>BUILT IN BUENOS AIRES</span>
        </div>
      </div>
    </footer>
  )
}

/* ─── SHARED ICONS / CSS ────────────────────────────────── */

function BoltIcon() {
  return (
    <span style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(145deg, #1a120e, #0a0706)', boxShadow: `0 0 0 1px ${BRAND}40, inset 0 1px 0 rgba(255,255,255,0.05)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill={BRAND} /></svg>
    </span>
  )
}

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
  html { scroll-behavior: smooth; }
  .label-mono { display:inline-flex; align-items:center; font-family:${FONT_MONO}; font-size:10px; font-weight:600; letter-spacing:.3em; text-transform:uppercase; color:${BRAND}; }
  .label-mono.brand { color:${BRAND_LIGHT}; }
  .label-mono.lime { color:${FORGE_LIME}; }
  .label-mono.cyan { color:${FORGE_CYAN}; }
  .btn-primary-pill { background: linear-gradient(135deg, ${BRAND} 0%, ${BRAND_LIGHT} 100%); box-shadow: 0 0 0 1px rgba(255,255,255,0.06) inset, 0 10px 30px -12px rgba(255,77,0,0.5); transition: transform .15s, box-shadow .15s; }
  .btn-primary-pill:hover { transform: translateY(-1px); }
  .btn-primary-pill:active { transform: scale(0.97); }
`

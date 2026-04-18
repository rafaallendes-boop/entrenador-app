import { Flame, Sparkles, Trophy } from 'lucide-react'

export type LaunchSport = 'squash' | 'running' | 'cycling' | 'other'

interface PlanBuilderLaunchDeckProps {
  title: string
  subtitle: string
  insight: string
  weeksLabel: string
  goalLabel: string
  isInitializing: boolean
  sport: LaunchSport
  onInitialize: () => void
}

const SPORT_COPY: Record<LaunchSport, { label: string; tagline: string; caption: string }> = {
  squash: {
    label: 'Squash Protocol',
    tagline: 'Competition Macro-Plan',
    caption:
      'Pista silenciosa, swing explosivo. Periodización afilada para sostener potencia y lectura táctica sobre la T.',
  },
  running: {
    label: 'Running Protocol',
    tagline: 'Race Macro-Plan',
    caption:
      'Tartán, nocturno, zancada cerrada. Periodización fasada para llegar fresco y con techo aeróbico al día del evento.',
  },
  cycling: {
    label: 'Cycling Protocol',
    tagline: 'Race Macro-Plan',
    caption:
      'Velódromo, tuck aero, watts sostenidos. Periodización por fases para construir umbral y descargar sin perder chispa.',
  },
  other: {
    label: 'Hybrid Protocol',
    tagline: 'Competition Macro-Plan',
    caption:
      'Un evento propio, un protocolo propio. Periodización fasada para llegar agudo, cargado y enfocado al día objetivo.',
  },
}

export default function PlanBuilderLaunchDeck({
  title,
  subtitle,
  insight,
  weeksLabel,
  goalLabel,
  isInitializing,
  sport,
  onInitialize,
}: PlanBuilderLaunchDeckProps) {
  const copy = SPORT_COPY[sport]

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#120d0b] px-4 py-5 shadow-[0_24px_80px_-28px_rgba(255,77,0,0.45)] sm:px-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,89,0,0.22),transparent_42%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0))]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, transparent 18%, transparent 82%, rgba(255,255,255,0.03) 100%), repeating-linear-gradient(135deg, transparent 0 22px, rgba(255,255,255,0.025) 22px 23px)',
        }}
      />

      <div className="relative mx-auto max-w-3xl space-y-4">
        <div className="space-y-1">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.34em] text-[#c56b3a]">
            Obsidian Forge
          </p>
          <h2 className="font-display text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">
            {title}
          </h2>
          <p className="max-w-xl text-sm text-white/68 sm:text-[15px]">{subtitle}</p>
        </div>

        <div className="rounded-[22px] border border-[#ff5a1f]/25 bg-[linear-gradient(180deg,rgba(84,43,30,0.96),rgba(62,33,24,0.94))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_16px_32px_-20px_rgba(0,0,0,0.85)]">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-[#7e3d24] text-[#ff6a1a]">
              <Flame size={18} />
            </div>
            <div>
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-[#ff7a33]">
                Forge Intelligence
              </p>
              <p className="mt-1 text-sm leading-6 text-white/72">{insight}</p>
            </div>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,8,8,0.96),rgba(4,4,4,0.99))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_30px_60px_-36px_rgba(0,0,0,0.9)] sm:p-5">
          {/* HUD corner chevrons */}
          <div className="pointer-events-none absolute left-3 top-3 h-3 w-3 border-l border-t border-[#ff5a1f]/60" />
          <div className="pointer-events-none absolute right-3 top-3 h-3 w-3 border-r border-t border-[#ff5a1f]/60" />
          <div className="pointer-events-none absolute left-3 bottom-3 h-3 w-3 border-l border-b border-[#ff5a1f]/60" />
          <div className="pointer-events-none absolute right-3 bottom-3 h-3 w-3 border-r border-b border-[#ff5a1f]/60" />

          <div className="relative flex flex-col items-center gap-4">
            <div className="flex w-full items-center justify-between gap-3">
              <span className="inline-flex items-center rounded-full bg-[#ff5a1f] px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-white">
                Elite Tier
              </span>
              <div className="flex items-center gap-2 text-[#ff7a33]">
                <Trophy size={14} />
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em]">
                  {copy.label}
                </span>
              </div>
            </div>

            <div className="space-y-2 text-center">
              <h3 className="font-display text-xl font-black uppercase tracking-tight text-white sm:text-2xl">
                {copy.tagline}
              </h3>
              <p className="mx-auto max-w-md text-[13px] leading-6 text-white/70">{copy.caption}</p>
            </div>

            <SportHeroStage sport={sport} />

            <div className="w-full space-y-1 text-center text-xs text-white/54">
              <p>{weeksLabel}</p>
              <p>{goalLabel}</p>
            </div>

            <button
              type="button"
              disabled={isInitializing}
              onClick={onInitialize}
              className="relative z-10 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#ff5a1f] px-4 py-3 font-display text-sm font-black uppercase tracking-[0.18em] text-white shadow-[0_10px_30px_-10px_rgba(255,90,31,0.75)] transition-transform duration-150 hover:scale-[1.01] disabled:cursor-wait disabled:opacity-70 sm:max-w-[360px]"
            >
              <Sparkles size={16} className={isInitializing ? 'animate-pulse' : ''} />
              {isInitializing ? 'Initializing…' : 'Initialize Protocol'}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function SportHeroStage({ sport }: { sport: LaunchSport }) {
  return (
    <div className="relative w-full overflow-hidden rounded-[20px] border border-white/5 bg-[radial-gradient(ellipse_at_center,#0f0b09_0%,#050403_78%)]">
      {/* Studio rim-light halos */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_70%,rgba(255,98,0,0.28),transparent_42%),radial-gradient(circle_at_75%_30%,rgba(255,120,50,0.14),transparent_40%)]" />
      {/* Film grain */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.12] mix-blend-overlay"
        style={{
          backgroundImage:
            'radial-gradient(rgba(255,255,255,0.9) 0.5px, transparent 0.5px), radial-gradient(rgba(255,255,255,0.4) 0.4px, transparent 0.4px)',
          backgroundSize: '3px 3px, 7px 7px',
          backgroundPosition: '0 0, 1px 1px',
        }}
      />
      {/* Vertical side shadows (vignette) */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.6),transparent_15%,transparent_85%,rgba(0,0,0,0.6))]" />
      {/* Bottom falloff */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.75))]" />

      <div className="relative mx-auto flex aspect-[4/3] w-full max-w-lg items-end justify-center px-4 pb-2 pt-3 sm:aspect-[5/4]">
        {sport === 'squash' && <SquashHero />}
        {sport === 'running' && <RunnerHero />}
        {sport === 'cycling' && <CyclistHero />}
        {sport === 'other' && <GenericAthleteHero />}
      </div>
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════════
 * SQUASH HERO — mid-lunge forehand, racket extended, court backdrop
 * ═════════════════════════════════════════════════════════════════ */
function SquashHero() {
  return (
    <svg viewBox="0 0 420 320" className="h-full w-full" aria-hidden fill="none">
      <defs>
        <linearGradient id="sq-skin" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3a1e12" />
          <stop offset="50%" stopColor="#1a0d08" />
          <stop offset="100%" stopColor="#050302" />
        </linearGradient>
        <linearGradient id="sq-rim" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ff8040" stopOpacity="0" />
          <stop offset="45%" stopColor="#ff6a1a" />
          <stop offset="100%" stopColor="#ffb070" />
        </linearGradient>
        <linearGradient id="sq-shirt" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1a1d24" />
          <stop offset="100%" stopColor="#0a0c10" />
        </linearGradient>
        <linearGradient id="sq-floor" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#221714" />
          <stop offset="100%" stopColor="#060403" />
        </linearGradient>
        <radialGradient id="sq-spot" cx="50%" cy="90%" r="60%">
          <stop offset="0%" stopColor="rgba(255,120,50,0.35)" />
          <stop offset="100%" stopColor="rgba(255,120,50,0)" />
        </radialGradient>
        <filter id="sq-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
        <filter id="sq-ballglow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      {/* Court back wall glass reflections */}
      <rect x="0" y="0" width="420" height="265" fill="#0a0806" />
      <line x1="20" y1="20" x2="400" y2="20" stroke="rgba(255,90,31,0.12)" strokeWidth="0.8" />
      <line x1="20" y1="260" x2="400" y2="260" stroke="rgba(255,90,31,0.20)" strokeWidth="1" />
      {/* Vertical rim-light streaks */}
      <rect x="30" y="40" width="1" height="220" fill="rgba(255,120,50,0.28)" />
      <rect x="55" y="60" width="1" height="200" fill="rgba(255,120,50,0.14)" />
      <rect x="388" y="40" width="1" height="220" fill="rgba(255,120,50,0.22)" />
      <rect x="364" y="70" width="1" height="190" fill="rgba(255,120,50,0.10)" />

      {/* Floor */}
      <rect x="0" y="265" width="420" height="55" fill="url(#sq-floor)" />
      <ellipse cx="210" cy="295" rx="180" ry="20" fill="url(#sq-spot)" />
      {/* Floor reflection line */}
      <line x1="40" y1="274" x2="380" y2="274" stroke="rgba(255,120,50,0.18)" strokeWidth="0.6" />

      {/* ═══ PLAYER — mid-lunge forehand ═══ */}
      <g transform="translate(96,46)">
        {/* Back leg — planted behind */}
        <path d="M140,168 C146,180 152,194 150,212 L170,212 C172,196 168,180 160,168 Z" fill="url(#sq-skin)" />
        {/* Back foot — heel slightly lifted, side profile */}
        <path d="M146,216 C150,212 166,210 174,214 C178,216 176,222 170,224 L150,226 C145,226 143,220 146,216 Z" fill="#050403" />
        <path d="M150,214 C158,212 168,213 173,216" stroke="#ff7a33" strokeWidth="0.6" fill="none" opacity="0.35" />

        {/* Front leg — deep lunge forward */}
        <path d="M58,168 C50,186 40,208 38,230 L64,232 C70,212 78,192 84,168 Z" fill="url(#sq-skin)" />
        {/* Front foot — planted flat, side profile with subtle sole line */}
        <path d="M32,234 C36,230 62,228 68,232 C72,234 70,242 62,244 L36,246 C30,246 28,238 32,234 Z" fill="#070604" />
        <path d="M34,240 C44,238 62,238 68,240" stroke="rgba(255,255,255,0.18)" strokeWidth="0.5" fill="none" />
        <path d="M40,232 C50,230 62,230 66,232" stroke="#ff7a33" strokeWidth="0.6" fill="none" opacity="0.35" />

        {/* Shorts */}
        <path d="M66,132 C62,148 62,162 68,172 L140,172 C146,162 146,148 142,132 Z" fill="#0a0c10" />
        <line x1="104" y1="135" x2="104" y2="170" stroke="rgba(255,120,50,0.35)" strokeWidth="1" />

        {/* Torso — twisted for forehand */}
        <path d="M72,58 C64,76 60,100 66,134 L146,134 C150,102 146,78 138,58 Z" fill="url(#sq-shirt)" />
        {/* Shirt rim-light on right side (player's right / screen's right) */}
        <path d="M140,62 C148,82 150,106 148,134" stroke="url(#sq-rim)" strokeWidth="3" fill="none" filter="url(#sq-glow)" />
        <path d="M144,66 C152,88 154,110 152,134" stroke="#ff8040" strokeWidth="1.2" fill="none" opacity="0.55" />

        {/* Collar shadow */}
        <path d="M82,60 C96,52 120,52 134,60 L134,68 C120,62 96,62 82,68 Z" fill="#06080b" />

        {/* Left arm — extended high for balance, back */}
        <path d="M74,70 C58,64 40,52 22,32" stroke="url(#sq-skin)" strokeWidth="15" strokeLinecap="round" fill="none" />
        <path d="M68,62 C54,54 36,40 22,22" stroke="url(#sq-rim)" strokeWidth="3" strokeLinecap="round" fill="none" filter="url(#sq-glow)" />
        <circle cx="22" cy="32" r="7" fill="url(#sq-skin)" />

        {/* Right arm — forehand swing extended forward */}
        <path d="M138,74 C158,84 180,100 200,124" stroke="url(#sq-skin)" strokeWidth="15" strokeLinecap="round" fill="none" />
        <path d="M144,70 C164,80 186,96 204,118" stroke="url(#sq-rim)" strokeWidth="3" strokeLinecap="round" fill="none" filter="url(#sq-glow)" />
        {/* Forearm extended to racket grip */}
        <path d="M200,124 C214,136 226,148 238,160" stroke="url(#sq-skin)" strokeWidth="13" strokeLinecap="round" fill="none" />
        <circle cx="238" cy="160" r="7" fill="url(#sq-skin)" />

        {/* Head */}
        <ellipse cx="105" cy="36" rx="18" ry="22" fill="url(#sq-skin)" />
        {/* Hair shadow */}
        <path d="M88,28 C95,14 118,14 124,30 L122,38 C112,30 96,30 88,36 Z" fill="#030201" />
        {/* Face rim-light on right */}
        <path d="M118,22 C124,32 126,46 120,56" stroke="url(#sq-rim)" strokeWidth="2.2" fill="none" filter="url(#sq-glow)" opacity="0.9" />
        {/* Headband */}
        <rect x="87" y="24" width="36" height="4" fill="#ff5a1f" opacity="0.8" />

        {/* Racket grip */}
        <rect x="234" y="156" width="8" height="18" rx="1.5" fill="#2a1a12" stroke="#ff7a33" strokeWidth="0.8" transform="rotate(-28 238 165)" />

        {/* Racket head — large, angled forward contact */}
        <ellipse cx="254" cy="130" rx="34" ry="26" transform="rotate(-32 254 130)" stroke="#ff7a33" strokeWidth="3" fill="rgba(255,77,0,0.04)" filter="url(#sq-glow)" />
        <ellipse cx="254" cy="130" rx="34" ry="26" transform="rotate(-32 254 130)" stroke="#ffb070" strokeWidth="1" fill="none" opacity="0.6" />
        {/* String mesh — detailed */}
        <g transform="rotate(-32 254 130)">
          <line x1="222" y1="118" x2="286" y2="118" stroke="rgba(255,170,90,0.4)" strokeWidth="0.6" />
          <line x1="222" y1="126" x2="286" y2="126" stroke="rgba(255,170,90,0.35)" strokeWidth="0.6" />
          <line x1="222" y1="134" x2="286" y2="134" stroke="rgba(255,170,90,0.35)" strokeWidth="0.6" />
          <line x1="222" y1="142" x2="286" y2="142" stroke="rgba(255,170,90,0.35)" strokeWidth="0.6" />
          <line x1="232" y1="108" x2="232" y2="152" stroke="rgba(255,170,90,0.35)" strokeWidth="0.6" />
          <line x1="244" y1="104" x2="244" y2="156" stroke="rgba(255,170,90,0.4)" strokeWidth="0.6" />
          <line x1="256" y1="104" x2="256" y2="156" stroke="rgba(255,170,90,0.4)" strokeWidth="0.6" />
          <line x1="268" y1="104" x2="268" y2="156" stroke="rgba(255,170,90,0.35)" strokeWidth="0.6" />
          <line x1="280" y1="108" x2="280" y2="152" stroke="rgba(255,170,90,0.35)" strokeWidth="0.6" />
        </g>

        {/* Ball mid-flight */}
        <circle cx="220" cy="108" r="9" fill="#ff9455" filter="url(#sq-ballglow)" />
        <circle cx="220" cy="108" r="6" fill="#ffb070" />
        <circle cx="220" cy="108" r="6" fill="none" stroke="#ffffff" strokeWidth="0.6" opacity="0.4" />
        {/* Ball trail */}
        <line x1="210" y1="106" x2="180" y2="96" stroke="rgba(255,148,85,0.55)" strokeWidth="2" strokeLinecap="round" strokeDasharray="3,5" />
        <line x1="207" y1="110" x2="178" y2="108" stroke="rgba(255,148,85,0.25)" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="2,6" />

        {/* Sweat droplets */}
        <circle cx="118" cy="14" r="1.2" fill="#ffb070" opacity="0.7" />
        <circle cx="134" cy="48" r="0.9" fill="#ff8040" opacity="0.55" />
        <circle cx="66" cy="40" r="0.8" fill="#ff8040" opacity="0.45" />
      </g>
    </svg>
  )
}

/* ═════════════════════════════════════════════════════════════════
 * RUNNER HERO — front-facing sprint, night track, orange rim-light
 * ═════════════════════════════════════════════════════════════════ */
function RunnerHero() {
  return (
    <svg viewBox="0 0 420 320" className="h-full w-full" aria-hidden fill="none">
      <defs>
        <linearGradient id="run-skin" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#402218" />
          <stop offset="55%" stopColor="#1c0e08" />
          <stop offset="100%" stopColor="#040302" />
        </linearGradient>
        <linearGradient id="run-rim" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ffb070" />
          <stop offset="50%" stopColor="#ff6a1a" />
          <stop offset="100%" stopColor="#ffb070" />
        </linearGradient>
        <linearGradient id="run-singlet" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#0c0c0c" />
          <stop offset="100%" stopColor="#030303" />
        </linearGradient>
        <linearGradient id="run-track" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#2a130c" />
          <stop offset="100%" stopColor="#050201" />
        </linearGradient>
        <radialGradient id="run-stadium" cx="50%" cy="30%" r="55%">
          <stop offset="0%" stopColor="rgba(255,120,50,0.18)" />
          <stop offset="100%" stopColor="rgba(255,120,50,0)" />
        </radialGradient>
        <filter id="run-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
        <filter id="run-bigglow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
      </defs>

      {/* Night sky */}
      <rect x="0" y="0" width="420" height="215" fill="#050506" />
      <rect x="0" y="0" width="420" height="215" fill="url(#run-stadium)" />
      {/* Stadium lights */}
      <circle cx="70" cy="34" r="3" fill="#fff3d8" opacity="0.85" filter="url(#run-bigglow)" />
      <circle cx="140" cy="28" r="2.5" fill="#fff3d8" opacity="0.7" filter="url(#run-bigglow)" />
      <circle cx="280" cy="30" r="2.5" fill="#fff3d8" opacity="0.7" filter="url(#run-bigglow)" />
      <circle cx="360" cy="36" r="3" fill="#fff3d8" opacity="0.85" filter="url(#run-bigglow)" />
      <circle cx="70" cy="34" r="1" fill="#ffffff" />
      <circle cx="140" cy="28" r="0.8" fill="#ffffff" />
      <circle cx="280" cy="30" r="0.8" fill="#ffffff" />
      <circle cx="360" cy="36" r="1" fill="#ffffff" />
      {/* Stadium silhouette */}
      <path d="M0,180 L60,160 L110,170 L170,155 L230,170 L290,158 L350,170 L420,160 L420,215 L0,215 Z" fill="#080707" />

      {/* Track — tartan red tone */}
      <rect x="0" y="215" width="420" height="105" fill="url(#run-track)" />
      {/* Lane lines — perspective */}
      <path d="M0,240 L210,222 L420,240" stroke="rgba(255,255,255,0.10)" strokeWidth="0.6" fill="none" />
      <path d="M0,260 L210,230 L420,260" stroke="rgba(255,255,255,0.14)" strokeWidth="0.7" fill="none" />
      <path d="M0,282 L210,242 L420,282" stroke="rgba(255,255,255,0.18)" strokeWidth="0.9" fill="none" />
      <path d="M0,308 L210,258 L420,308" stroke="rgba(255,255,255,0.22)" strokeWidth="1" fill="none" />
      {/* Track spotlight under runner */}
      <ellipse cx="210" cy="295" rx="140" ry="18" fill="rgba(255,120,50,0.24)" filter="url(#run-bigglow)" />

      {/* ═══ RUNNER — front sprint ═══ */}
      <g transform="translate(148,58)">
        {/* Rear leg (pushoff behind) — extended back, slightly to viewer's left */}
        <path d="M40,106 C28,122 16,140 10,162 L32,174 C44,158 54,140 60,116 Z" fill="url(#run-skin)" />
        <path d="M10,162 C4,180 0,198 4,212 L30,218 C32,204 36,188 44,170 Z" fill="url(#run-skin)" />
        {/* Rear foot — toe still in contact, heel lifted */}
        <path d="M-4,220 C-2,216 28,214 34,218 C38,220 36,228 28,230 L0,232 C-6,232 -8,224 -4,220 Z" fill="#050403" />
        <path d="M2,218 C12,216 28,216 32,218" stroke="#ff7a33" strokeWidth="0.55" fill="none" opacity="0.3" />

        {/* Front leg (high knee drive) — bent, coming up */}
        <path d="M86,106 C96,118 110,128 124,136 L140,122 C128,112 114,100 104,86 Z" fill="url(#run-skin)" />
        <path d="M124,136 C136,144 146,156 148,172 L124,182 C116,170 108,158 100,142 Z" fill="url(#run-skin)" />
        {/* Front foot — mid air, forefoot pointed down for strike */}
        <path d="M118,180 C122,176 152,172 160,176 C164,178 162,188 154,190 L124,194 C118,194 114,184 118,180 Z" fill="#060504" />
        <path d="M124,178 C134,176 152,175 158,177" stroke="#ff7a33" strokeWidth="0.55" fill="none" opacity="0.32" />

        {/* Shorts */}
        <path d="M44,86 C38,100 38,110 44,120 L100,120 C106,110 106,100 100,86 Z" fill="#0a0c10" />

        {/* Torso — singlet front-facing, slight lean */}
        <path d="M52,30 C44,50 40,70 46,90 L100,90 C106,70 102,50 94,30 Z" fill="url(#run-singlet)" />
        {/* Singlet side rim-lights */}
        <path d="M100,32 C106,50 108,72 104,90" stroke="url(#run-rim)" strokeWidth="3" fill="none" filter="url(#run-glow)" />
        <path d="M46,32 C40,50 38,72 42,90" stroke="url(#run-rim)" strokeWidth="3" fill="none" filter="url(#run-glow)" opacity="0.9" />
        {/* Collar V */}
        <path d="M60,30 L73,50 L86,30" stroke="#020202" strokeWidth="2" fill="none" />
        {/* Bib number */}
        <rect x="60" y="46" width="26" height="20" rx="1.5" fill="rgba(255,255,255,0.06)" stroke="rgba(255,120,50,0.35)" strokeWidth="0.8" />
        <text x="73" y="61" fontSize="11" fontFamily="monospace" fontWeight="700" fill="#ff8040" textAnchor="middle" opacity="0.8">
          07
        </text>

        {/* Neck/collarbone shadow */}
        <path d="M58,24 L88,24 L86,32 L60,32 Z" fill="#030302" />

        {/* Head — slight tilt forward */}
        <ellipse cx="73" cy="12" rx="17" ry="20" fill="url(#run-skin)" />
        {/* Hair/shadow top */}
        <path d="M58,4 C63,-4 84,-4 89,6 L88,14 C80,8 66,8 58,14 Z" fill="#030201" />
        {/* Face rim light on right */}
        <path d="M85,2 C91,10 92,20 88,30" stroke="url(#run-rim)" strokeWidth="2" fill="none" filter="url(#run-glow)" opacity="0.9" />
        {/* Jawline shadow */}
        <path d="M60,22 C66,28 80,28 86,22" stroke="#020202" strokeWidth="1" fill="none" />

        {/* Left arm — pumping forward, bent */}
        <path d="M100,42 C114,40 128,32 138,18" stroke="url(#run-skin)" strokeWidth="14" strokeLinecap="round" fill="none" />
        <path d="M106,40 C118,36 132,26 140,14" stroke="url(#run-rim)" strokeWidth="2.8" strokeLinecap="round" fill="none" filter="url(#run-glow)" />
        {/* Fist */}
        <circle cx="140" cy="14" r="7" fill="url(#run-skin)" />

        {/* Right arm — back drive, bent */}
        <path d="M46,44 C30,46 14,56 4,74" stroke="url(#run-skin)" strokeWidth="14" strokeLinecap="round" fill="none" />
        <path d="M42,40 C24,42 8,52 0,70" stroke="url(#run-rim)" strokeWidth="2.6" strokeLinecap="round" fill="none" filter="url(#run-glow)" opacity="0.85" />
        <circle cx="4" cy="74" r="7" fill="url(#run-skin)" />

        {/* Speed streaks — orange motion blur trailing */}
        <line x1="-40" y1="96" x2="-8" y2="96" stroke="rgba(255,120,50,0.5)" strokeWidth="3" strokeLinecap="round" />
        <line x1="-52" y1="108" x2="-12" y2="108" stroke="rgba(255,120,50,0.35)" strokeWidth="2" strokeLinecap="round" />
        <line x1="-44" y1="120" x2="-6" y2="120" stroke="rgba(255,120,50,0.22)" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="-36" y1="84" x2="-6" y2="84" stroke="rgba(255,120,50,0.25)" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="168" y1="100" x2="200" y2="100" stroke="rgba(255,120,50,0.4)" strokeWidth="2.4" strokeLinecap="round" />
        <line x1="172" y1="112" x2="200" y2="112" stroke="rgba(255,120,50,0.25)" strokeWidth="1.4" strokeLinecap="round" />

        {/* Sweat droplets */}
        <circle cx="88" cy="-2" r="1.2" fill="#ffb070" opacity="0.75" />
        <circle cx="98" cy="20" r="0.9" fill="#ff8040" opacity="0.6" />
        <circle cx="56" cy="12" r="0.8" fill="#ff8040" opacity="0.5" />

        {/* Front foot ground-contact glow */}
        <ellipse cx="140" cy="192" rx="20" ry="4" fill="rgba(255,120,50,0.5)" filter="url(#run-bigglow)" />
      </g>
    </svg>
  )
}

/* ═════════════════════════════════════════════════════════════════
 * CYCLIST HERO — aero tuck, leaning into turn, velodrome crowd
 * ═════════════════════════════════════════════════════════════════ */
function CyclistHero() {
  return (
    <svg viewBox="0 0 420 320" className="h-full w-full" aria-hidden fill="none">
      <defs>
        <linearGradient id="cyc-skin" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3a1e12" />
          <stop offset="60%" stopColor="#140a05" />
          <stop offset="100%" stopColor="#040302" />
        </linearGradient>
        <linearGradient id="cyc-rim" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ff8040" stopOpacity="0.05" />
          <stop offset="60%" stopColor="#ff6a1a" />
          <stop offset="100%" stopColor="#ffb070" />
        </linearGradient>
        <linearGradient id="cyc-kit" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0a0c0e" />
          <stop offset="100%" stopColor="#1a1a1a" />
        </linearGradient>
        <radialGradient id="cyc-sky" cx="50%" cy="15%" r="70%">
          <stop offset="0%" stopColor="#4a2514" />
          <stop offset="55%" stopColor="#1a0a05" />
          <stop offset="100%" stopColor="#060302" />
        </radialGradient>
        <linearGradient id="cyc-road" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#160c08" />
          <stop offset="100%" stopColor="#040201" />
        </linearGradient>
        <filter id="cyc-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.3" />
        </filter>
        <filter id="cyc-bigglow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id="cyc-motion" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.5 0.3" />
        </filter>
      </defs>

      {/* Sunset sky — dusk velodrome */}
      <rect x="0" y="0" width="420" height="240" fill="url(#cyc-sky)" />
      {/* Crowd silhouette blur */}
      <rect x="0" y="175" width="420" height="45" fill="#0a0605" opacity="0.85" />
      {[20, 60, 95, 140, 180, 220, 260, 300, 340, 380].map((x, i) => (
        <rect
          key={i}
          x={x}
          y={180 + (i % 3)}
          width="22"
          height="40"
          fill="#0d0807"
          opacity="0.85"
        />
      ))}
      {/* Distant crowd highlights */}
      {[40, 110, 200, 280, 360].map((x, i) => (
        <circle key={`h${i}`} cx={x} cy="190" r="1.2" fill="#ff8040" opacity="0.5" filter="url(#cyc-bigglow)" />
      ))}
      {/* Track barrier line */}
      <line x1="0" y1="220" x2="420" y2="220" stroke="rgba(255,120,50,0.35)" strokeWidth="1.4" />
      <line x1="0" y1="224" x2="420" y2="224" stroke="rgba(255,120,50,0.12)" strokeWidth="0.6" />

      {/* Track surface */}
      <rect x="0" y="224" width="420" height="96" fill="url(#cyc-road)" />
      {/* Track lane arcs — leaning perspective */}
      <path d="M-20,300 Q210,254 440,305" stroke="rgba(255,120,50,0.18)" strokeWidth="1.1" fill="none" />
      <path d="M-20,282 Q210,240 440,288" stroke="rgba(255,120,50,0.10)" strokeWidth="0.8" fill="none" />
      {/* Motion streaks on track */}
      <line x1="20" y1="270" x2="110" y2="270" stroke="rgba(255,120,50,0.35)" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
      <line x1="305" y1="270" x2="400" y2="270" stroke="rgba(255,120,50,0.35)" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />

      {/* ═══ BIKE + RIDER (side profile, aero tuck, slight lean) ═══ */}
      <g transform="translate(70,98)">
        {/* Bike shadow on track */}
        <ellipse cx="150" cy="180" rx="140" ry="8" fill="rgba(0,0,0,0.6)" filter="url(#cyc-bigglow)" />

        {/* REAR WHEEL — motion-blurred */}
        <g filter="url(#cyc-motion)">
          <circle cx="52" cy="148" r="44" stroke="#ff7a33" strokeWidth="3" fill="rgba(0,0,0,0.5)" />
          <circle cx="52" cy="148" r="40" stroke="rgba(255,120,50,0.3)" strokeWidth="1" fill="none" />
        </g>
        <circle cx="52" cy="148" r="44" stroke="rgba(255,170,90,0.5)" strokeWidth="0.8" fill="none" />
        <circle cx="52" cy="148" r="6" fill="#1a1a1a" stroke="#ff8040" strokeWidth="1" />
        {/* Rear spokes (blurred) */}
        <g opacity="0.4">
          <line x1="52" y1="108" x2="52" y2="188" stroke="#ff8040" strokeWidth="0.6" />
          <line x1="14" y1="132" x2="90" y2="164" stroke="#ff8040" strokeWidth="0.5" />
          <line x1="14" y1="164" x2="90" y2="132" stroke="#ff8040" strokeWidth="0.5" />
        </g>

        {/* FRONT WHEEL */}
        <g filter="url(#cyc-motion)">
          <circle cx="258" cy="148" r="44" stroke="#ff7a33" strokeWidth="3" fill="rgba(0,0,0,0.5)" />
          <circle cx="258" cy="148" r="40" stroke="rgba(255,120,50,0.3)" strokeWidth="1" fill="none" />
        </g>
        <circle cx="258" cy="148" r="44" stroke="rgba(255,170,90,0.55)" strokeWidth="0.9" fill="none" />
        <circle cx="258" cy="148" r="6" fill="#1a1a1a" stroke="#ff8040" strokeWidth="1" />
        <g opacity="0.4">
          <line x1="258" y1="108" x2="258" y2="188" stroke="#ff8040" strokeWidth="0.6" />
          <line x1="220" y1="132" x2="296" y2="164" stroke="#ff8040" strokeWidth="0.5" />
          <line x1="220" y1="164" x2="296" y2="132" stroke="#ff8040" strokeWidth="0.5" />
        </g>

        {/* FRAME — aero triangle */}
        {/* Seat tube */}
        <line x1="140" y1="148" x2="108" y2="78" stroke="#0a0a0a" strokeWidth="7" strokeLinecap="round" />
        <line x1="140" y1="148" x2="108" y2="78" stroke="#ff7a33" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
        {/* Top tube */}
        <line x1="114" y1="76" x2="216" y2="64" stroke="#0a0a0a" strokeWidth="6" strokeLinecap="round" />
        <line x1="114" y1="76" x2="216" y2="64" stroke="#ff7a33" strokeWidth="1" strokeLinecap="round" opacity="0.7" />
        {/* Down tube */}
        <line x1="220" y1="68" x2="140" y2="148" stroke="#0a0a0a" strokeWidth="7" strokeLinecap="round" />
        <line x1="220" y1="68" x2="140" y2="148" stroke="#ff7a33" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
        {/* Chain stays */}
        <line x1="140" y1="148" x2="52" y2="148" stroke="#0a0a0a" strokeWidth="5" strokeLinecap="round" />
        <line x1="140" y1="148" x2="52" y2="148" stroke="#ff7a33" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
        {/* Seat stays */}
        <line x1="108" y1="78" x2="52" y2="148" stroke="#0a0a0a" strokeWidth="4" strokeLinecap="round" />
        <line x1="108" y1="78" x2="52" y2="148" stroke="#ff7a33" strokeWidth="0.8" strokeLinecap="round" opacity="0.55" />
        {/* Fork */}
        <line x1="220" y1="68" x2="258" y2="148" stroke="#0a0a0a" strokeWidth="6" strokeLinecap="round" />
        <line x1="220" y1="68" x2="258" y2="148" stroke="#ff7a33" strokeWidth="1" strokeLinecap="round" opacity="0.7" />

        {/* Saddle */}
        <path d="M94,66 L124,62 L126,70 L96,74 Z" fill="#0a0a0a" stroke="#ff8040" strokeWidth="0.7" />

        {/* Handlebar drops */}
        <path d="M216,64 C218,52 222,48 230,52 L238,70" stroke="#0a0a0a" strokeWidth="5" strokeLinecap="round" fill="none" />
        <path d="M216,64 C218,52 222,48 230,52 L238,70" stroke="#ff8040" strokeWidth="1" strokeLinecap="round" fill="none" opacity="0.7" />

        {/* Chain ring */}
        <circle cx="140" cy="148" r="12" stroke="#ff8040" strokeWidth="0.8" fill="rgba(0,0,0,0.6)" opacity="0.7" />
        <circle cx="140" cy="148" r="3" fill="#ff7a33" />

        {/* ═══ RIDER ═══ */}
        {/* Left leg (down, power stroke) */}
        <path d="M124,78 C118,96 110,116 112,138 L140,146 C138,128 138,108 140,86 Z" fill="url(#cyc-kit)" />
        <path d="M112,138 C112,150 118,160 132,160 L142,148 C138,142 134,140 134,138 Z" fill="url(#cyc-skin)" />
        {/* Shoe on pedal */}
        <path d="M128,158 L152,154 L154,164 L130,168 Z" fill="#0a0a0a" stroke="#ff8040" strokeWidth="0.8" />

        {/* Right leg (up, recovery) */}
        <path d="M130,78 C140,88 156,94 170,92 L168,102 C152,104 138,98 126,88 Z" fill="url(#cyc-kit)" />

        {/* Torso — horizontal aero */}
        <path d="M108,74 C124,58 150,48 186,42 C210,38 222,42 224,54 C226,66 216,72 198,72 C168,74 144,80 126,92 C118,96 106,92 104,82 Z" fill="url(#cyc-kit)" />
        {/* Kit stripe rim-light along back */}
        <path d="M112,58 C132,48 162,42 198,42" stroke="url(#cyc-rim)" strokeWidth="3.5" fill="none" filter="url(#cyc-glow)" />
        <path d="M110,62 C130,52 162,46 200,46" stroke="#ff8040" strokeWidth="1.2" fill="none" opacity="0.6" />
        {/* Kit number */}
        <rect x="156" y="56" width="26" height="14" rx="1.5" fill="rgba(255,255,255,0.06)" stroke="rgba(255,120,50,0.35)" strokeWidth="0.6" />
        <text x="169" y="67" fontSize="9" fontFamily="monospace" fontWeight="700" fill="#ff8040" textAnchor="middle" opacity="0.8">
          24
        </text>

        {/* Arm on drops — stretched forward */}
        <path d="M210,56 C216,64 222,74 226,82 C228,90 222,94 216,90 C208,84 204,74 202,64" stroke="url(#cyc-skin)" strokeWidth="12" strokeLinecap="round" fill="none" />
        <path d="M218,60 C224,70 228,80 228,84" stroke="url(#cyc-rim)" strokeWidth="2.2" strokeLinecap="round" fill="none" filter="url(#cyc-glow)" opacity="0.85" />

        {/* Helmet — aero teardrop */}
        <ellipse cx="216" cy="32" rx="22" ry="14" fill="#0a0a0a" />
        <path d="M198,30 C196,24 204,18 216,18 C230,18 238,24 238,34 L236,40 C228,34 218,32 200,38 Z" fill="#0a0a0a" />
        {/* Aero tail */}
        <path d="M196,34 C186,38 180,40 188,44 C196,48 208,46 216,42" fill="#0a0a0a" opacity="0.85" />
        {/* Visor */}
        <path d="M222,28 C230,28 238,32 238,38 L230,40 C226,36 220,34 218,32 Z" fill="#ff5a1f" opacity="0.85" />
        <path d="M222,28 C230,28 238,32 238,38" stroke="#ffb070" strokeWidth="0.8" fill="none" opacity="0.9" />
        {/* Helmet rim-light */}
        <path d="M230,18 C238,22 240,30 238,36" stroke="url(#cyc-rim)" strokeWidth="2" fill="none" filter="url(#cyc-glow)" />

        {/* Chin/jaw */}
        <path d="M206,42 C214,46 222,46 228,42" stroke="url(#cyc-skin)" strokeWidth="7" strokeLinecap="round" fill="none" />

        {/* Motion-blur streaks — coming from behind */}
        <line x1="-40" y1="90" x2="-4" y2="90" stroke="rgba(255,120,50,0.55)" strokeWidth="3" strokeLinecap="round" />
        <line x1="-52" y1="106" x2="-8" y2="106" stroke="rgba(255,120,50,0.35)" strokeWidth="2" strokeLinecap="round" />
        <line x1="-44" y1="124" x2="-6" y2="124" stroke="rgba(255,120,50,0.22)" strokeWidth="1.4" strokeLinecap="round" />
        <line x1="-38" y1="74" x2="-8" y2="74" stroke="rgba(255,120,50,0.28)" strokeWidth="1.6" strokeLinecap="round" />
        <line x1="-32" y1="58" x2="-6" y2="58" stroke="rgba(255,120,50,0.18)" strokeWidth="1" strokeLinecap="round" />

        {/* Sweat */}
        <circle cx="236" cy="48" r="1" fill="#ffb070" opacity="0.7" />
      </g>
    </svg>
  )
}

/* ═════════════════════════════════════════════════════════════════
 * GENERIC HERO — sport-neutral athlete, powerful ready stance with
 * a luminous target ring behind (represents the competition goal)
 * ═════════════════════════════════════════════════════════════════ */
function GenericAthleteHero() {
  return (
    <svg viewBox="0 0 420 320" className="h-full w-full" aria-hidden fill="none">
      <defs>
        <linearGradient id="gen-skin" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#3a1e12" />
          <stop offset="55%" stopColor="#1a0d08" />
          <stop offset="100%" stopColor="#050302" />
        </linearGradient>
        <linearGradient id="gen-rim" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ff8040" stopOpacity="0" />
          <stop offset="50%" stopColor="#ff6a1a" />
          <stop offset="100%" stopColor="#ffb070" />
        </linearGradient>
        <linearGradient id="gen-kit" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#15100d" />
          <stop offset="100%" stopColor="#050302" />
        </linearGradient>
        <linearGradient id="gen-bar" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#5a4030" />
          <stop offset="50%" stopColor="#3c2a1e" />
          <stop offset="100%" stopColor="#1c130d" />
        </linearGradient>
        <radialGradient id="gen-plate" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#2a1a10" />
          <stop offset="75%" stopColor="#100a07" />
          <stop offset="100%" stopColor="#030201" />
        </radialGradient>
        <radialGradient id="gen-backlight" cx="50%" cy="32%" r="60%">
          <stop offset="0%" stopColor="rgba(255,100,30,0.36)" />
          <stop offset="65%" stopColor="rgba(255,100,30,0.06)" />
          <stop offset="100%" stopColor="rgba(255,100,30,0)" />
        </radialGradient>
        <linearGradient id="gen-floor" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1a0d08" />
          <stop offset="100%" stopColor="#030201" />
        </linearGradient>
        <filter id="gen-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
        <filter id="gen-bigglow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>

      {/* Backdrop — dark gym atmosphere */}
      <rect x="0" y="0" width="420" height="320" fill="#050403" />
      <rect x="0" y="0" width="420" height="270" fill="url(#gen-backlight)" />

      {/* Back wall vertical rim-light streaks (weight room bars) */}
      <rect x="28" y="36" width="1" height="220" fill="rgba(255,120,50,0.22)" />
      <rect x="58" y="60" width="1" height="190" fill="rgba(255,120,50,0.10)" />
      <rect x="391" y="36" width="1" height="220" fill="rgba(255,120,50,0.22)" />
      <rect x="360" y="60" width="1" height="190" fill="rgba(255,120,50,0.10)" />

      {/* Rafter beams — industrial ceiling hint */}
      <line x1="0" y1="22" x2="420" y2="22" stroke="rgba(255,120,50,0.18)" strokeWidth="0.8" />
      <line x1="0" y1="36" x2="420" y2="36" stroke="rgba(255,120,50,0.08)" strokeWidth="0.6" />

      {/* Halo behind lifter — raised bar apex */}
      <ellipse cx="210" cy="52" rx="140" ry="30" fill="rgba(255,120,50,0.18)" filter="url(#gen-bigglow)" />

      {/* Floor */}
      <rect x="0" y="260" width="420" height="60" fill="url(#gen-floor)" />
      <line x1="0" y1="262" x2="420" y2="262" stroke="rgba(255,120,50,0.30)" strokeWidth="0.8" />
      <line x1="0" y1="268" x2="420" y2="268" stroke="rgba(255,120,50,0.08)" strokeWidth="0.5" />
      <ellipse cx="210" cy="290" rx="150" ry="18" fill="rgba(255,120,50,0.28)" filter="url(#gen-bigglow)" />

      {/* Chalk dust particles — drifting */}
      <circle cx="128" cy="108" r="1.4" fill="#ffb070" opacity="0.55" filter="url(#gen-bigglow)" />
      <circle cx="298" cy="92" r="1.2" fill="#ff9060" opacity="0.5" filter="url(#gen-bigglow)" />
      <circle cx="88" cy="158" r="1.1" fill="#ff8040" opacity="0.45" filter="url(#gen-bigglow)" />
      <circle cx="336" cy="168" r="1.3" fill="#ff8040" opacity="0.4" filter="url(#gen-bigglow)" />
      <circle cx="248" cy="200" r="0.9" fill="#ffb070" opacity="0.5" filter="url(#gen-bigglow)" />

      {/* ═══ BARBELL — overhead press, lifted above head ═══ */}
      {/* Bar shaft */}
      <rect x="80" y="44" width="260" height="5" rx="1.2" fill="url(#gen-bar)" />
      <rect x="80" y="44" width="260" height="1.4" fill="rgba(255,170,90,0.55)" />
      {/* Knurling hint */}
      <g opacity="0.45">
        <line x1="150" y1="45.5" x2="150" y2="48.5" stroke="#1a0f09" strokeWidth="0.5" />
        <line x1="158" y1="45.5" x2="158" y2="48.5" stroke="#1a0f09" strokeWidth="0.5" />
        <line x1="166" y1="45.5" x2="166" y2="48.5" stroke="#1a0f09" strokeWidth="0.5" />
        <line x1="254" y1="45.5" x2="254" y2="48.5" stroke="#1a0f09" strokeWidth="0.5" />
        <line x1="262" y1="45.5" x2="262" y2="48.5" stroke="#1a0f09" strokeWidth="0.5" />
        <line x1="270" y1="45.5" x2="270" y2="48.5" stroke="#1a0f09" strokeWidth="0.5" />
      </g>

      {/* Left plate stack — outer */}
      <ellipse cx="66" cy="46.5" rx="10" ry="38" fill="url(#gen-plate)" stroke="#2a1a10" strokeWidth="1" />
      <ellipse cx="66" cy="46.5" rx="10" ry="38" fill="none" stroke="url(#gen-rim)" strokeWidth="1.6" filter="url(#gen-glow)" opacity="0.8" />
      <ellipse cx="66" cy="46.5" rx="6" ry="24" fill="rgba(255,120,50,0.10)" />
      {/* Left inner plate */}
      <ellipse cx="78" cy="46.5" rx="7" ry="30" fill="url(#gen-plate)" stroke="#2a1a10" strokeWidth="0.8" />
      <ellipse cx="78" cy="46.5" rx="7" ry="30" fill="none" stroke="url(#gen-rim)" strokeWidth="1" opacity="0.6" />
      {/* Collar clip */}
      <rect x="86" y="40" width="3" height="13" rx="0.6" fill="#ff7a33" opacity="0.7" />

      {/* Right plate stack — outer */}
      <ellipse cx="354" cy="46.5" rx="10" ry="38" fill="url(#gen-plate)" stroke="#2a1a10" strokeWidth="1" />
      <ellipse cx="354" cy="46.5" rx="10" ry="38" fill="none" stroke="url(#gen-rim)" strokeWidth="1.6" filter="url(#gen-glow)" opacity="0.8" />
      <ellipse cx="354" cy="46.5" rx="6" ry="24" fill="rgba(255,120,50,0.10)" />
      {/* Right inner plate */}
      <ellipse cx="342" cy="46.5" rx="7" ry="30" fill="url(#gen-plate)" stroke="#2a1a10" strokeWidth="0.8" />
      <ellipse cx="342" cy="46.5" rx="7" ry="30" fill="none" stroke="url(#gen-rim)" strokeWidth="1" opacity="0.6" />
      {/* Collar clip */}
      <rect x="331" y="40" width="3" height="13" rx="0.6" fill="#ff7a33" opacity="0.7" />

      {/* Bar bend flex hint */}
      <path d="M80,48.5 Q210,52 340,48.5" stroke="rgba(255,150,80,0.20)" strokeWidth="0.6" fill="none" />

      {/* ═══ LIFTER — overhead press, front-facing ═══ */}
      <g transform="translate(148,76)">
        {/* Right leg (screen left) — slightly flexed, planted */}
        <path d="M20,150 C14,170 10,196 14,220 L38,222 C42,196 46,172 48,150 Z" fill="url(#gen-kit)" />
        {/* Right foot */}
        <path d="M8,224 C12,220 40,218 46,222 C50,224 48,234 42,236 L14,238 C6,238 4,228 8,224 Z" fill="#050403" />
        <path d="M12,222 C22,220 40,220 44,222" stroke="#ff7a33" strokeWidth="0.55" fill="none" opacity="0.3" />

        {/* Left leg (screen right) — planted wide, load-bearing */}
        <path d="M96,150 C102,170 106,196 102,220 L78,222 C74,196 70,172 68,150 Z" fill="url(#gen-kit)" />
        <path d="M66,224 C72,220 100,218 106,222 C110,224 108,234 102,236 L74,238 C66,238 62,228 66,224 Z" fill="#050403" />
        <path d="M70,222 C82,220 100,220 104,222" stroke="#ff7a33" strokeWidth="0.55" fill="none" opacity="0.3" />

        {/* Shorts */}
        <path d="M20,128 C16,142 16,154 22,160 L96,160 C102,154 102,142 98,128 Z" fill="#0a0806" />
        <line x1="58" y1="130" x2="58" y2="158" stroke="rgba(255,120,50,0.3)" strokeWidth="0.8" />
        {/* Belt */}
        <path d="M18,124 L100,124 L100,130 L18,130 Z" fill="#1a0e08" />
        <path d="M18,124 L100,124" stroke="url(#gen-rim)" strokeWidth="1" opacity="0.55" />
        <circle cx="59" cy="127" r="1.6" fill="#ff7a33" opacity="0.9" />

        {/* Torso — braced, rib cage visible under tank */}
        <path d="M22,42 C14,72 12,100 20,128 L98,128 C106,100 104,72 96,42 Z" fill="url(#gen-kit)" />
        {/* Rim-light down both sides — hero framing */}
        <path d="M98,46 C106,70 108,98 102,128" stroke="url(#gen-rim)" strokeWidth="3" fill="none" filter="url(#gen-glow)" />
        <path d="M20,46 C12,70 10,98 16,128" stroke="url(#gen-rim)" strokeWidth="3" fill="none" filter="url(#gen-glow)" opacity="0.85" />
        {/* Tank top straps */}
        <path d="M38,42 L44,16" stroke="#020101" strokeWidth="5" strokeLinecap="round" />
        <path d="M80,42 L74,16" stroke="#020101" strokeWidth="5" strokeLinecap="round" />
        {/* Chest shadow center */}
        <line x1="59" y1="48" x2="59" y2="118" stroke="rgba(0,0,0,0.55)" strokeWidth="1" />
        {/* Upper chest rim-light (light spilling from overhead spot) */}
        <path d="M26,40 C40,36 78,36 92,40" stroke="url(#gen-rim)" strokeWidth="1.4" fill="none" opacity="0.55" />

        {/* Traps — lifted under the bar */}
        <path d="M28,18 C40,8 78,8 90,18 L84,32 C70,28 48,28 34,32 Z" fill="url(#gen-kit)" />
        <path d="M28,18 C40,8 78,8 90,18" stroke="url(#gen-rim)" strokeWidth="1.6" fill="none" filter="url(#gen-glow)" opacity="0.8" />

        {/* Head — tilted slightly back under bar */}
        <ellipse cx="59" cy="-2" rx="16" ry="18" fill="url(#gen-skin)" />
        {/* Hair shadow */}
        <path d="M45,-12 C51,-20 71,-20 76,-10 L74,-2 C66,-8 52,-8 44,0 Z" fill="#020101" />
        {/* Face rim-light on right */}
        <path d="M72,-12 C78,-4 80,8 76,14" stroke="url(#gen-rim)" strokeWidth="2" fill="none" filter="url(#gen-glow)" opacity="0.9" />
        {/* Jaw line — clenched under load */}
        <path d="M48,6 C54,12 66,12 72,6" stroke="#020101" strokeWidth="0.8" fill="none" />
        {/* Neck tension lines */}
        <path d="M52,12 L50,20" stroke="#020101" strokeWidth="0.6" />
        <path d="M68,12 L70,20" stroke="#020101" strokeWidth="0.6" />

        {/* Left arm (screen right) — locked out overhead, wrist gripping bar */}
        <path d="M92,26 C106,10 114,-8 116,-32" stroke="url(#gen-skin)" strokeWidth="15" strokeLinecap="round" fill="none" />
        <path d="M98,20 C110,4 118,-12 120,-30" stroke="url(#gen-rim)" strokeWidth="2.6" strokeLinecap="round" fill="none" filter="url(#gen-glow)" />
        {/* Shoulder delt bulge */}
        <circle cx="94" cy="30" r="10" fill="url(#gen-skin)" />
        <path d="M88,22 C96,20 104,24 104,32" stroke="url(#gen-rim)" strokeWidth="1.4" fill="none" opacity="0.7" />
        {/* Fist gripping bar */}
        <circle cx="118" cy="-30" r="8" fill="url(#gen-skin)" />
        <path d="M114,-36 C120,-38 124,-34 124,-28" stroke="url(#gen-rim)" strokeWidth="1.2" fill="none" opacity="0.65" />

        {/* Right arm (screen left) — locked out overhead */}
        <path d="M26,26 C12,10 4,-8 2,-32" stroke="url(#gen-skin)" strokeWidth="15" strokeLinecap="round" fill="none" />
        <path d="M20,20 C8,4 0,-12 -2,-30" stroke="url(#gen-rim)" strokeWidth="2.4" strokeLinecap="round" fill="none" filter="url(#gen-glow)" opacity="0.85" />
        {/* Shoulder delt bulge */}
        <circle cx="24" cy="30" r="10" fill="url(#gen-skin)" />
        <path d="M14,22 C22,20 30,24 30,32" stroke="url(#gen-rim)" strokeWidth="1.2" fill="none" opacity="0.6" />
        {/* Fist gripping bar */}
        <circle cx="0" cy="-30" r="8" fill="url(#gen-skin)" />
        <path d="M-4,-36 C2,-38 6,-34 6,-28" stroke="url(#gen-rim)" strokeWidth="1" fill="none" opacity="0.55" />

        {/* Abdominal shadow hint */}
        <path d="M40,78 L78,78" stroke="rgba(0,0,0,0.45)" strokeWidth="0.6" />
        <path d="M40,92 L78,92" stroke="rgba(0,0,0,0.4)" strokeWidth="0.6" />
        <path d="M40,106 L78,106" stroke="rgba(0,0,0,0.35)" strokeWidth="0.6" />

        {/* Sweat droplets */}
        <circle cx="54" cy="-14" r="1.1" fill="#ffb070" opacity="0.7" />
        <circle cx="82" cy="4" r="0.9" fill="#ff8040" opacity="0.55" />
        <circle cx="36" cy="6" r="0.8" fill="#ff8040" opacity="0.5" />
      </g>
    </svg>
  )
}

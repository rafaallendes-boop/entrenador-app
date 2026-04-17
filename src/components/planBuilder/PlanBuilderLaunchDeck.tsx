import { Flame, Sparkles, Trophy } from 'lucide-react'

interface PlanBuilderLaunchDeckProps {
  title: string
  subtitle: string
  insight: string
  weeksLabel: string
  goalLabel: string
  isInitializing: boolean
  onInitialize: () => void
}

export default function PlanBuilderLaunchDeck({
  title,
  subtitle,
  insight,
  weeksLabel,
  goalLabel,
  isInitializing,
  onInitialize,
}: PlanBuilderLaunchDeckProps) {
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

        <div className="relative overflow-hidden rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(8,8,8,0.95),rgba(13,13,13,0.98))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_30px_60px_-36px_rgba(0,0,0,0.9)] sm:p-5">
          <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_70%_35%,rgba(255,98,0,0.18),transparent_36%),radial-gradient(circle_at_100%_80%,rgba(255,255,255,0.08),transparent_28%)]" />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(125deg,rgba(255,103,31,0.12),transparent_34%)]" />

          <div className="relative flex min-h-[280px] flex-col justify-between">
            <div className="max-w-[62%] space-y-3 sm:max-w-[58%]">
              <span className="inline-flex items-center rounded-full bg-[#ff5a1f] px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-white">
                Elite Tier
              </span>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[#ff7a33]">
                  <Trophy size={16} />
                  <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em]">
                    Competition Macro-Plan
                  </span>
                </div>
                <p className="max-w-xs text-sm leading-6 text-white/74">
                  High-impact, phased periodization designed to sharpen performance without romper tu flujo actual.
                </p>
              </div>

              <div className="space-y-1 text-xs text-white/54">
                <p>{weeksLabel}</p>
                <p>{goalLabel}</p>
              </div>
            </div>

            <button
              type="button"
              disabled={isInitializing}
              onClick={onInitialize}
              className="relative z-10 mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#ff5a1f] px-4 py-3 font-display text-sm font-black uppercase tracking-[0.16em] text-white transition-transform duration-150 hover:scale-[1.01] disabled:cursor-wait disabled:opacity-70 sm:max-w-[320px]"
            >
              <Sparkles size={16} className={isInitializing ? 'animate-pulse' : ''} />
              {isInitializing ? 'Initializing…' : 'Initialize Protocol'}
            </button>

            <div className="pointer-events-none absolute inset-y-0 right-0 w-[46%] min-w-[170px] translate-x-4">
              <SquashPlayerIllustration />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function SquashPlayerIllustration() {
  return (
    <svg
      viewBox="0 0 240 320"
      className="h-full w-full opacity-90"
      aria-hidden="true"
      fill="none"
    >
      <defs>
        <linearGradient id="playerGlow" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="60%" stopColor="#e5e5e5" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#ff5a1f" stopOpacity="0.25" />
        </linearGradient>
        <linearGradient id="playerBody" x1="30%" x2="70%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="#1a1a1a" />
          <stop offset="100%" stopColor="#050505" />
        </linearGradient>
      </defs>

      <ellipse cx="118" cy="164" rx="108" ry="136" fill="url(#playerGlow)" opacity="0.15" />
      <path
        d="M122 72c16 0 26 13 26 30 0 10-4 19-10 25l18 37 17-12c7-5 16-4 21 2l12 15c4 6 4 14-1 19l-24 20c-6 5-15 6-22 2l-20-12-12 46 22 44c4 8 0 18-9 22l-8 4c-8 4-18 1-23-7l-26-49c-3-5-4-10-2-15l14-54-20-38-10 48c-2 8-9 14-17 15l-23 2c-8 1-16-5-17-13l-2-12c-1-8 5-15 13-17l27-6 16-73c4-17 20-30 39-30Z"
        fill="url(#playerBody)"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="2"
      />
      <circle cx="122" cy="54" r="26" fill="url(#playerBody)" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
      <path
        d="M174 128c20-26 37-40 53-43"
        stroke="rgba(255,255,255,0.28)"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <ellipse
        cx="205"
        cy="78"
        rx="22"
        ry="30"
        transform="rotate(24 205 78)"
        stroke="rgba(255,255,255,0.45)"
        strokeWidth="4"
      />
      <path
        d="M188 60l34 36M183 86l43-15"
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M92 294c22 4 55 4 81 0"
        stroke="rgba(255,90,31,0.45)"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </svg>
  )
}

import type { ReactNode } from 'react'

interface OnboardingStepFrameProps {
  step: number
  totalSteps: number
  title: string
  description: string
  children: ReactNode
  actions: ReactNode
  onSkip: () => void
}

export default function OnboardingStepFrame({
  step,
  totalSteps,
  title,
  description,
  children,
  actions,
  onSkip,
}: OnboardingStepFrameProps) {
  const progress = Math.round((step / totalSteps) * 100)

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      {/* Atmospheric background */}
      <div className="pointer-events-none fixed inset-0">
        <div
          className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/3"
          style={{
            width: '560px',
            height: '420px',
            background: 'radial-gradient(ellipse at center, rgba(255,77,0,0.11) 0%, transparent 65%)',
            filter: 'blur(40px)',
          }}
        />
        <div
          className="absolute bottom-0 right-1/4"
          style={{
            width: '280px',
            height: '280px',
            background: 'radial-gradient(circle, rgba(255,77,0,0.05) 0%, transparent 70%)',
            filter: 'blur(50px)',
          }}
        />
      </div>

      <div className="relative z-10 w-full max-w-lg">
        {/* Skip button — ghost pill */}
        <div className="mb-5 flex justify-end">
          <button
            type="button"
            onClick={onSkip}
            className="rounded-full px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-faint transition-all hover:text-ink-muted"
            style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}
          >
            Omitir
          </button>
        </div>

        {/* Glass card */}
        <div
          className="rounded-2xl p-6 md:p-8"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.09)',
            backdropFilter: 'blur(24px)',
          }}
        >
          {/* Progress section */}
          <div className="mb-7">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.32em] text-ink-faint">
                Paso {step} / {totalSteps}
              </span>
              <span
                className="font-mono text-[9px] font-bold"
                style={{ color: '#ff7a33' }}
              >
                {progress}%
              </span>
            </div>
            <div
              className="overflow-hidden rounded-full"
              style={{ height: '3px', background: 'rgba(255,255,255,0.08)' }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-label="Progreso del onboarding"
            >
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{
                  width: `${progress}%`,
                  background: 'linear-gradient(90deg, #ff4d00, #ff7a33)',
                  boxShadow: '0 0 8px 2px rgba(255,77,0,0.55)',
                }}
              />
            </div>
          </div>

          {/* Header */}
          <header className="mb-7">
            <h1 className="font-display text-2xl font-bold leading-tight tracking-tight text-ink md:text-[1.85rem]">
              {title}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{description}</p>
          </header>

          <div className="space-y-5">{children}</div>

          <div className="mt-8">{actions}</div>
        </div>
      </div>
    </div>
  )
}

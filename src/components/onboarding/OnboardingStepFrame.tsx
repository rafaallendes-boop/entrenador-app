import type { ReactNode } from 'react'
import Card from '../ui/Card'

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
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={onSkip}
            className="text-sm font-medium text-ink-faint transition-colors hover:text-ink-muted"
          >
            Omitir por ahora
          </button>
        </div>

        <Card className="p-6 md:p-7">
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between text-xs text-ink-muted">
              <span>Paso {step} de {totalSteps}</span>
              <span>{progress}%</span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-surface-raised"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-label="Progreso del onboarding"
            >
              <div className="h-full rounded-full bg-brand transition-[width] duration-200" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <header className="mb-6">
            <h1 className="text-2xl font-semibold text-ink md:text-3xl">{title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">{description}</p>
          </header>

          <div className="space-y-6">{children}</div>

          <div className="mt-8">{actions}</div>
        </Card>
      </div>
    </div>
  )
}

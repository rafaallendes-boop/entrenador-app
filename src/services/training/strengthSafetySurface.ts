import type { AthleteProfile } from '../../types'
import type { StrengthConstraint } from '../../types/strengthSafety'
import type { StrengthContext, StrengthPhase, StrengthSportProfile } from './strengthSelector'
import { resolveStrengthSafetyConstraints } from './strengthSafetyConstraints'

/** Restricciones vigentes persistidas. Las del mensaje se combinan por sello. */
export function resolveProfileStrengthSafetyConstraints(
  profile: AthleteProfile | null | undefined,
): readonly StrengthConstraint[] {
  return resolveStrengthSafetyConstraints({
    currentInjuries: profile?.recoveryProfile?.currentInjuries,
    restrictions: profile?.recoveryProfile?.restrictions,
    injuryNotes: profile?.planWizardConfig?.injuryNotes,
    trainingPriority: profile?.sportContext?.trainingPriority,
  })
}

/** Contexto conservador compartido por display y aceptación. */
export function buildStrengthSafetyContext(
  profile: AthleteProfile | null | undefined,
  durationMin: number | undefined,
  goal: string | undefined,
  constraints: readonly StrengthConstraint[],
): StrengthContext {
  const primarySport = profile?.sportContext?.primarySport
  return {
    fatigueLevel: 5,
    phase: mapPhase(profile?.macroPlan?.currentPhase),
    recentExercises: [],
    goal: goal ?? profile?.mainGoal ?? 'sesión de fuerza útil y estructurada',
    sportProfile: mapSportProfile(primarySport),
    primarySport,
    experienceLevel: 'intermediate',
    sessionDurationMin: durationMin ?? 60,
    safetyConstraints: constraints,
  }
}

function mapPhase(phase: string | undefined): StrengthPhase {
  if (phase === 'build' || phase === 'peak' || phase === 'taper' || phase === 'transition') return phase
  if (phase === 'race') return 'taper'
  return 'base'
}

function mapSportProfile(primarySport: string | undefined): StrengthSportProfile {
  if (primarySport === 'strength') return 'strength_primary'
  if (primarySport) return 'sport_support'
  return 'hybrid'
}

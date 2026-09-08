import type { AthleteProfile, Session } from '../../types'
import { resolveStrengthSafetyConstraints } from './strengthSafetyConstraints'

/** Consumes the shared restriction authority; does not reinterpret medical text. */
export function runningProfileWithRestrictions(profile?: AthleteProfile | null) {
  const constraints = resolveStrengthSafetyConstraints({
    ...profile?.recoveryProfile, injuryNotes: profile?.planWizardConfig?.injuryNotes,
  })
  const blocked = constraints.some(c => c.kind === 'unresolved_medical_restriction'
    || c.kind === 'load_pattern' && c.pattern === 'impact'
    || c.kind === 'region' && ['pelvis_sacroiliac', 'hip', 'groin', 'hamstring', 'knee', 'calf', 'achilles', 'ankle', 'foot'].includes(c.region))
  return { ...profile?.runningProfile, ...(blocked ? { impactRestriction: 'no_running' as const } : {}) }
}

/** Planned exposure is separate from executed history. Date supplied by the caller. */
export function hasNeighboringHardSession(sessions: readonly Pick<Session, 'date' | 'type' | 'status' | 'rpe' | 'runningDetails' | 'subtype'>[], date: string): boolean {
  const target = Date.parse(`${date}T12:00:00Z`)
  if (!Number.isFinite(target)) return false
  return sessions.some(s => s.status !== 'skipped'
    && Math.abs(Date.parse(`${s.date}T12:00:00Z`) - target) <= 86400000
    && ((s.rpe ?? 0) >= 7 || s.type === 'squash' && (s.subtype === 'match' || s.subtype === 'competitive')
      || s.type === 'running' && ['tempo', 'intervals', 'long'].includes(s.runningDetails?.runningType ?? '')))
}

export function resolveRunningSupportPolicy(input: {
  primarySport?: string; phase: string; fatigueLevel?: number; neighboringHardSession?: boolean
  weeklyRunCount?: number; runningMinutesThisWeek?: number; loadRisk?: boolean
}) {
  const support = input.primarySport != null && input.primarySport !== 'running'
  const taper = input.phase === 'taper'
  const lowOnly = (input.fatigueLevel ?? 0) >= 6 || input.loadRisk || input.neighboringHardSession
    || support && (['build', 'peak', 'taper'].includes(input.phase) || (input.weeklyRunCount ?? 0) >= 4)
  // Composition caps for complementary running, shared by every producer.
  const weeklyBudget = support ? (taper ? 75 : 120) : Infinity
  const remaining = weeklyBudget - (input.runningMinutesThisWeek ?? 0)
  const durationCap = Math.max(0, Math.min(support ? taper ? 25 : ['build', 'peak'].includes(input.phase) ? 40 : 60 : Infinity, remaining))
  return { lowOnly: Boolean(lowOnly), durationCap, weeklyBudget,
    reason: support ? `Running de apoyo: máximo ${weeklyBudget} min semanales${lowOnly ? ', intensidad baja por fase, fatiga o sesión vecina' : ''}.` : lowOnly ? 'Intensidad baja por carga o sesión vecina.' : 'Running principal con dosis específica.' }
}


export function runningExposureInWeek(sessions: readonly Pick<Session, 'date' | 'type' | 'status' | 'durationMin'>[], date: string) {
  const target = new Date(`${date}T12:00:00Z`)
  const day = (target.getUTCDay() + 6) % 7
  const monday = target.getTime() - day * 86400000
  const rows = sessions.filter(s => s.type === 'running' && s.status !== 'skipped'
    && Date.parse(`${s.date}T12:00:00Z`) >= monday && Date.parse(`${s.date}T12:00:00Z`) < monday + 7 * 86400000)
  return { runningMinutesThisWeek: rows.reduce((total, s) => total + Math.max(0, s.durationMin), 0), weeklyRunCount: rows.length }
}

import type { Session } from '../../types'
import {
  MOBILITY_SESSION_LIBRARY,
  type MobilityFocus,
  type MobilitySessionDefinition,
  type MobilitySportContext,
} from './mobilitySessionLibrary'

export type MobilityPhase = 'base' | 'build' | 'peak' | 'taper' | 'race' | 'transition'

export interface MobilityContext {
  primarySport: MobilitySportContext
  phase: MobilityPhase
  recentSessionIds: string[]
  postTrainingType?: MobilitySportContext
  fatigueLevel?: number
  historicalSessions?: Session[]
}

export interface MobilitySelectionResult {
  session: MobilitySessionDefinition
  rationale: string
  recommendedFocus: MobilityFocus[]
}

export function selectMobilitySession(context: MobilityContext): MobilitySelectionResult {
  const recentIds = new Set(context.recentSessionIds)

  if (context.postTrainingType) {
    const postSpecific = findPostTrainingSession(context.postTrainingType, recentIds)
    if (postSpecific) {
      return {
        session: postSpecific,
        rationale: `Rutina especifica post-${context.postTrainingType} para restaurar rango y acelerar recuperacion.`,
        recommendedFocus: postSpecific.focus,
      }
    }
  }

  const sportSpecific = MOBILITY_SESSION_LIBRARY
    .filter(session =>
      session.suitableSportContext.includes(context.primarySport) &&
      !recentIds.has(session.id) &&
      matchesPhase(session, context.phase),
    )

  const scored = scoreForContext(sportSpecific, context)
  if (scored.length > 0) {
    const selected = scored[0]
    return {
      session: selected,
      rationale: buildMobilityRationale(selected, context),
      recommendedFocus: selected.focus,
    }
  }

  const fallback = MOBILITY_SESSION_LIBRARY.find(session => session.id === 'full_body_flow')
    ?? MOBILITY_SESSION_LIBRARY[0]

  return {
    session: fallback,
    rationale: 'Flujo de movilidad global como base universal para cualquier contexto deportivo.',
    recommendedFocus: fallback.focus,
  }
}

function findPostTrainingSession(
  sport: MobilitySportContext,
  recentIds: Set<string>,
): MobilitySessionDefinition | undefined {
  const postMap: Partial<Record<MobilitySportContext, string>> = {
    running: 'post_run_mobility',
    squash: 'post_squash_mobility',
    cycling: 'post_cycling_mobility',
  }

  const targetId = postMap[sport]
  if (!targetId) return undefined

  const session = MOBILITY_SESSION_LIBRARY.find(entry => entry.id === targetId)
  if (!session) return undefined
  if (recentIds.has(session.id)) return undefined

  return session
}

function matchesPhase(session: MobilitySessionDefinition, phase: MobilityPhase): boolean {
  if (!session.suitablePhases) return true
  return session.suitablePhases.includes(phase)
}

function scoreForContext(
  sessions: MobilitySessionDefinition[],
  context: MobilityContext,
): MobilitySessionDefinition[] {
  const phasePreferredFocus = getPhasePreferredFocus(context.phase)
  const recentIds = new Set(context.recentSessionIds)

  return sessions
    .map(session => ({
      session,
      score: computeMobilityScore(session, context, phasePreferredFocus, recentIds),
    }))
    .sort((a, b) => b.score - a.score || a.session.name.localeCompare(b.session.name))
    .map(entry => entry.session)
}

function computeMobilityScore(
  session: MobilitySessionDefinition,
  context: MobilityContext,
  phasePreferredFocus: MobilityFocus[],
  recentIds: Set<string>,
): number {
  let score = 0

  if (session.focus.some(focus => phasePreferredFocus.includes(focus))) score += 5
  if (session.focus.includes('sport_specific')) score += 3

  if ((context.fatigueLevel ?? 5) >= 7 && session.category === 'passive') score += 4
  if ((context.fatigueLevel ?? 5) >= 7 && session.category === 'activation') score -= 3

  if (recentIds.has(session.id)) score -= 8

  if ((context.phase === 'transition' || context.phase === 'taper') && session.focus.includes('full_body')) {
    score += 3
  }

  if ((context.phase === 'peak' || context.phase === 'race') && session.focus.includes('activation')) {
    score += 4
  }

  return score
}

function getPhasePreferredFocus(phase: MobilityPhase): MobilityFocus[] {
  switch (phase) {
    case 'base':
      return ['full_body', 'hip', 'ankle_foot']
    case 'build':
      return ['sport_specific', 'hip', 'shoulder_thoracic']
    case 'peak':
      return ['activation', 'sport_specific']
    case 'taper':
      return ['full_body', 'hip']
    case 'race':
      return ['activation']
    case 'transition':
      return ['full_body', 'hip', 'ankle_foot']
  }
}

function buildMobilityRationale(session: MobilitySessionDefinition, context: MobilityContext): string {
  if (context.phase === 'taper' || context.phase === 'race') {
    return `Movilidad suave pre-evento - ${session.description} Sin fatiga residual.`
  }
  if (context.phase === 'transition') {
    return `Movilidad de recuperacion - ${session.description}`
  }
  return `${session.description} Adaptada al contexto de ${context.primarySport} en fase ${context.phase}.`
}

export function extractRecentMobilitySessions(historicalSessions: Session[]): string[] {
  return [...historicalSessions]
    .filter(
      session =>
        session.type === 'mobility' &&
        (session.status === 'completed' || session.status === 'adjusted'),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt)
    .slice(0, 5)
    .map(deriveMobilityLibraryIdFromSession)
    .filter((id): id is string => Boolean(id))
}

export function summarizeMobilitySelection(result: MobilitySelectionResult): string {
  return `${result.session.name} - foco: ${result.recommendedFocus.join(', ')} - ${result.rationale}`
}

export function deriveMobilityLibraryIdFromSession(session: Session): string | undefined {
  if (session.type !== 'mobility') return undefined

  const normalized = normalizeMobilityText([
    session.title,
    session.objective,
    session.notes,
    session.completionNotes,
  ].filter(Boolean).join(' '))

  if (!normalized) return undefined

  if (normalized.includes('post squash')) return 'post_squash_mobility'
  if (normalized.includes('post running') || normalized.includes('post run')) return 'post_run_mobility'
  if (
    normalized.includes('post ciclismo') ||
    normalized.includes('post cycling') ||
    normalized.includes('post bici')
  ) return 'post_cycling_mobility'
  if (normalized.includes('activacion pre entrenamiento') || normalized.includes('pre training activation')) {
    return 'pre_training_activation'
  }
  if (normalized.includes('flujo de movilidad global') || normalized.includes('full body flow')) return 'full_body_flow'
  if (normalized.includes('movilidad de recuperacion activa') || normalized.includes('recovery mobility')) {
    return 'recovery_mobility'
  }
  if (normalized.includes('cadera completa') || normalized.includes('hip full range')) return 'hip_full_range'
  if (normalized.includes('flexores de cadera') || normalized.includes('hip flexor') || normalized.includes('psoas')) {
    return 'hip_flexor_release'
  }
  if (normalized.includes('tobillo') || normalized.includes('dorsiflexion')) return 'ankle_dorsiflexion'
  if (normalized.includes('cars de hombro') || normalized.includes('apertura toracica')) return 'shoulder_cars'
  if (normalized.includes('movilidad toracica') || normalized.includes('rotacion toracica')) return 'thoracic_mobility'

  return undefined
}

function normalizeMobilityText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .toLowerCase()
    .trim()
}

import { describe, expect, it } from 'vitest'

import type { Session } from '../../types'
import {
  deriveMobilityLibraryIdFromSession,
  extractRecentMobilitySessions,
  selectMobilitySession,
} from '../training/mobilitySelector'
import { findMobilitySessionById, normalizeMobilityTargetStructure } from '../training/mobilitySessionLibrary'

function makeMobilitySession(
  date: string,
  title: string,
  objective = '',
): Session {
  return {
    id: `${date}-${title}`,
    date,
    timeBlock: 'AM',
    type: 'mobility',
    status: 'completed',
    title,
    objective,
    durationMin: 25,
    createdAt: 1,
    updatedAt: 1,
  } as Session
}

describe('mobilitySelector', () => {
  it('maps recent mobility history to library ids instead of local uuids', () => {
    const session = makeMobilitySession('2026-04-08', 'Movilidad post-running')

    expect(deriveMobilityLibraryIdFromSession(session)).toBe('post_run_mobility')
    expect(extractRecentMobilitySessions([session])).toEqual(['post_run_mobility'])
  })

  it('prioritizes a post-running routine when the latest completed sport was running', () => {
    const result = selectMobilitySession({
      primarySport: 'running',
      phase: 'build',
      recentSessionIds: [],
      postTrainingType: 'running',
      fatigueLevel: 5,
    })

    expect(result.session.id).toBe('post_run_mobility')
  })

  it('avoids repeating the same post-session mobility if it was already done recently', () => {
    const result = selectMobilitySession({
      primarySport: 'running',
      phase: 'build',
      recentSessionIds: ['post_run_mobility'],
      postTrainingType: 'running',
      fatigueLevel: 5,
    })

    expect(result.session.id).not.toBe('post_run_mobility')
  })

  it('prioritizes activation in race context', () => {
    const result = selectMobilitySession({
      primarySport: 'squash',
      phase: 'race',
      recentSessionIds: [],
      fatigueLevel: 4,
    })

    expect(result.session.id).toBe('pre_training_activation')
  })

  it('recognizes post-strength routines from recent mobility history', () => {
    const session = makeMobilitySession('2026-04-08', 'Reset post-fuerza', 'movilidad post strength')
    expect(deriveMobilityLibraryIdFromSession(session)).toBe('post_strength_reset')
  })

  it('keeps mobility structures in clear Spanish for user-facing sessions', () => {
    const fullBody = findMobilitySessionById('full_body_flow')

    expect(fullBody?.typicalStructure).toContain('Estocada larga con rotacion')
    expect(fullBody?.typicalStructure).toContain('Postura del nino')
    expect(fullBody?.typicalStructure).not.toMatch(/World|Thoracic|Childs|Ankle circles/i)
  })

  it('translates English mobility structures defensively', () => {
    const normalized = normalizeMobilityTargetStructure(
      'Worlds greatest stretch 5/l + Hip 90/90 flow 2min/l + Thoracic rotation 10/l + CARs hombro 5/l + Ankle circles + Childs pose 3min.',
    )

    expect(normalized).toBe(
      'Estocada larga con rotacion 5/lado + Flujo 90/90 de cadera 2 min/lado + Rotacion toracica 10/lado + CARs de hombro 5/lado + Circulos de tobillo + Postura del nino 3 min.',
    )
  })
})

import { describe, expect, it } from 'vitest'

import type { Session } from '../../types'
import {
  deriveMobilityLibraryIdFromSession,
  extractRecentMobilitySessions,
  selectMobilitySession,
} from '../training/mobilitySelector'

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
})

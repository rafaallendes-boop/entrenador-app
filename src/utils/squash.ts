import type { Session, SquashDetails, SquashSessionMode } from '../types'

export interface SquashCompetitiveExposureSummary {
  practiceMatchCount: number
  competitionMatchCount: number
  totalMatchCount: number
  exposureScore: number
}

export function resolveSquashSessionMode(squashDetails?: SquashDetails): SquashSessionMode {
  return squashDetails?.sessionMode ?? 'competition_match'
}

export function isPracticeSquashMatch(session: Pick<Session, 'type' | 'subtype' | 'squashDetails'>): boolean {
  return session.type === 'squash' && session.subtype === 'match' && resolveSquashSessionMode(session.squashDetails) === 'practice_match'
}

export function isCompetitionSquashMatch(session: Pick<Session, 'type' | 'subtype' | 'squashDetails'>): boolean {
  if (session.type !== 'squash') return false
  if (session.subtype === 'competitive') return true
  if (session.subtype !== 'match') return false
  return resolveSquashSessionMode(session.squashDetails) !== 'practice_match'
}

export function getRecentSquashCompetitiveExposure(
  sessions: Array<Pick<Session, 'type' | 'subtype' | 'squashDetails'>>,
  limit = 4,
): SquashCompetitiveExposureSummary {
  let practiceMatchCount = 0
  let competitionMatchCount = 0

  for (const session of sessions.slice(0, limit)) {
    if (isPracticeSquashMatch(session)) {
      practiceMatchCount += 1
      continue
    }

    if (isCompetitionSquashMatch(session)) {
      competitionMatchCount += 1
    }
  }

  return {
    practiceMatchCount,
    competitionMatchCount,
    totalMatchCount: practiceMatchCount + competitionMatchCount,
    exposureScore: practiceMatchCount + competitionMatchCount,
  }
}

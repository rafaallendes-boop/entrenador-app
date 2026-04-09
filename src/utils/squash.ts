import type { Session, SquashDetails, SquashSessionMode } from '../types'

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

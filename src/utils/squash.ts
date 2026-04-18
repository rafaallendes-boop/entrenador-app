import type { Session, SquashDetails, SquashSessionKind, SquashSessionMode } from '../types'
import {
  findSquashDrillByName,
  isControlDrill,
  isShadowsDrill,
  isSquashMatchDrill,
} from '../services/training/drillLibrary'

export interface SquashCompetitiveExposureSummary {
  practiceMatchCount: number
  competitionMatchCount: number
  totalMatchCount: number
  exposureScore: number
}

export function resolveSquashSessionMode(squashDetails?: SquashDetails): SquashSessionMode {
  return squashDetails?.sessionMode ?? 'drill_session'
}

export function resolveSquashSessionKind(
  session: Pick<Session, 'type' | 'subtype' | 'squashDetails'>,
): SquashSessionKind | undefined {
  if (session.type !== 'squash') return undefined

  const details = session.squashDetails
  if (!details) {
    if (session.subtype === 'match' || session.subtype === 'competitive') return 'match'
    return undefined
  }

  if (details.sessionKind) return details.sessionKind

  const blockKinds = [...new Set((details.blocks ?? []).map((block) => block.kind))]
  if (blockKinds.length > 1) return 'mixed'
  if (blockKinds.length === 1) return blockKinds[0]

  if (session.subtype === 'match' || session.subtype === 'competitive') return 'match'
  if (resolveSquashSessionMode(details) !== 'drill_session') return 'match'

  const counts = new Map<SquashSessionKind, number>()
  for (const drill of details.drills ?? []) {
    const definition = findSquashDrillByName(drill.name)
    const kind = definition
      ? isSquashMatchDrill(definition)
        ? 'match'
        : isShadowsDrill(definition)
          ? 'shadows'
          : isControlDrill(definition)
            ? 'control'
            : 'technical'
      : 'technical'
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }

  if (counts.size === 0) return 'technical'

  const sortedKinds = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const [topKind, topCount] = sortedKinds[0]!
  const tiedTop = sortedKinds.filter(([, count]) => count === topCount)

  if (topKind === 'match' && sortedKinds.length > 1) return 'mixed'
  if (tiedTop.length > 1) return 'mixed'
  return topKind
}

export function isPracticeSquashMatch(session: Pick<Session, 'type' | 'subtype' | 'squashDetails'>): boolean {
  return session.type === 'squash' && session.subtype === 'match' && resolveSquashSessionMode(session.squashDetails) === 'practice_match'
}

export function isCompetitionSquashMatch(session: Pick<Session, 'type' | 'subtype' | 'squashDetails'>): boolean {
  if (session.type !== 'squash') return false
  if (session.subtype === 'competitive') return true
  if (session.subtype !== 'match') return false
  return resolveSquashSessionMode(session.squashDetails) === 'competition_match'
}

export function getRecentSquashCompetitiveExposure(
  sessions: Array<Pick<Session, 'date' | 'timeBlock' | 'type' | 'subtype' | 'squashDetails'>>,
  limit = 4,
): SquashCompetitiveExposureSummary {
  let practiceMatchCount = 0
  let competitionMatchCount = 0

  const recentSessions = [...sessions]
    .sort((a, b) => b.date.localeCompare(a.date) || b.timeBlock.localeCompare(a.timeBlock))
    .slice(0, limit)

  for (const session of recentSessions) {
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

import type { AthleteMembership } from '../../types'

export function canExportCoachNotesFor(
  athleteId: string,
  accountId: string,
  memberships: AthleteMembership[],
): boolean {
  if (memberships.length === 0) return true
  const forAthlete = memberships.filter((membership) => membership.athleteId === athleteId)
  if (forAthlete.length === 0) return false
  const mine = forAthlete.filter((membership) => membership.accountId === accountId)
  if (mine.some((membership) => membership.role === 'coach')) return true
  const iAmSelf = mine.some((membership) => membership.role === 'self')
  const externalCoach = forAthlete.some(
    (membership) => membership.accountId !== accountId && membership.role === 'coach',
  )
  return iAmSelf && !externalCoach
}

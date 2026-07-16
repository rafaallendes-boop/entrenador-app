/**
 * Returns the athlete scope carried by a remote row. Older tables keep the
 * scope inside `data.athleteId`, while newer schemas expose `athlete_id`.
 */
export function getRemoteRowAthleteId(row: Record<string, unknown>): string | undefined {
  const data = row.data && typeof row.data === 'object'
    ? row.data as Record<string, unknown>
    : {}
  const direct = row.athlete_id
  const nested = data.athleteId
  return typeof direct === 'string' && direct.length > 0
    ? direct
    : typeof nested === 'string' && nested.length > 0
      ? nested
      : undefined
}

import type { Session } from '../../types'
import { isScopedAthleteId } from '../athlete/effectiveAthleteKey'

export type RemoteSessionTarget =
  | { kind: 'scoped'; athleteId: string }
  | { kind: 'legacySelf'; ownerAccountId: string; selfAthleteId: string }

/** Captures the remote ownership target before mutating the local session. */
export function captureRemoteSessionTarget(
  localRow: Session,
  ownerAccountId: string,
  selfAthleteId: string,
): RemoteSessionTarget {
  if (isScopedAthleteId(localRow.athleteId)) {
    return { kind: 'scoped', athleteId: localRow.athleteId }
  }
  return { kind: 'legacySelf', ownerAccountId, selfAthleteId }
}

export function isRemoteSessionTarget(value: unknown): value is RemoteSessionTarget {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  if (row.kind === 'scoped') {
    return typeof row.athleteId === 'string' && row.athleteId.length > 0
  }
  return row.kind === 'legacySelf'
    && typeof row.ownerAccountId === 'string'
    && row.ownerAccountId.length > 0
    && typeof row.selfAthleteId === 'string'
    && row.selfAthleteId.length > 0
}

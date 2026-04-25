/**
 * Centralised localStorage keys used by the sync layer.
 *
 * Kept in a single module so that:
 * - There is one place to audit/rotate keys.
 * - Per-user keys go through builders (no ad-hoc string concatenation).
 *
 * Do not change these values without a migration plan — they shape the
 * persisted state of every existing user.
 */

export const QUEUE_KEY = 'entrenador_sync_queue_v1'
export const LAST_SYNC_USER_KEY = 'entrenador_sync_user_v1'
export const MIGRATION_KEY_PREFIX = 'entrenador_migrated_v1'
export const INITIAL_PULL_KEY_PREFIX = 'entrenador_initial_pull_v1'
export const REMOTE_WIPE_KEY = 'entrenador_remote_wipe_v1'
export const REMOTE_FULL_RESET_ACK_KEY_PREFIX = 'entrenador_remote_reset_ack_v1'
export const PROFILE_RESET_LOCK_KEY = 'entrenador_profile_reset_lock_v1'
export const SESSION_DELETE_TOMBSTONES_KEY = 'entrenador_sync_session_tombstones_v1'
export const COACH_PROPOSAL_DELETE_TOMBSTONES_KEY = 'entrenador_sync_coach_proposal_tombstones_v1'
export const ATHLETE_PROFILE_WRITE_MODE_KEY = '__athleteProfileWriteMode'

export function getInitialPullKey(userId: string): string {
  return `${INITIAL_PULL_KEY_PREFIX}:${userId}`
}

export function getRemoteFullResetAckKey(userId: string): string {
  return `${REMOTE_FULL_RESET_ACK_KEY_PREFIX}:${userId}`
}

export function getMigrationKey(userId: string): string {
  return `${MIGRATION_KEY_PREFIX}:${userId}`
}

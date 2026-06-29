/**
 * Gates athlete_id scope behavior in sync.
 *
 * Default OFF. This flag controls read/write scoping only; it does not change
 * the hydrated active athlete id and it cannot revert Dexie schema changes.
 */
export function isAthleteScopeEnabled(): boolean {
  return import.meta.env.VITE_ATHLETE_SCOPE === 'true'
}

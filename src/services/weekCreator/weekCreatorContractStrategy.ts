export type WeekCreatorContractStrategy = 'skeleton_v2' | 'detailed'

/**
 * Deployment rollback switch. The compact contract is the default; setting
 * VITE_WEEK_CREATOR_CONTRACT=detailed restores the previous provider boundary
 * without removing either schema or changing final validation.
 */
export function resolveWeekCreatorContractStrategy(
  configured = import.meta.env.VITE_WEEK_CREATOR_CONTRACT,
): WeekCreatorContractStrategy {
  return configured?.trim().toLowerCase() === 'detailed'
    ? 'detailed'
    : 'skeleton_v2'
}

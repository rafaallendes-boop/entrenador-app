import { isDevToolsEnabled } from '../devTools'

/**
 * Legacy alias. Plan Builder debug surfaces use the unified dev-tools flag now.
 * @see isDevToolsEnabled
 */
export function shouldShowPlanQuality(): boolean {
  return isDevToolsEnabled()
}

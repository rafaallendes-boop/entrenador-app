/**
 * Plan Builder Phase 3 debug flag.
 * Local/dev can enable badges and regeneration controls with VITE_SHOW_PLAN_QUALITY=true.
 * Production is forcibly off to avoid accidental beta exposure.
 */
export function shouldShowPlanQuality(): boolean {
  if (import.meta.env.PROD === true) return false
  return import.meta.env.VITE_SHOW_PLAN_QUALITY === 'true'
}

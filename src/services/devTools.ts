/**
 * Single source of truth for developer-only UI.
 * Production is forcibly off; local/dev enables via VITE_DEV_TOOLS=true.
 * VITE_SHOW_PLAN_QUALITY is kept as a legacy alias.
 */
export function isDevToolsEnabled(): boolean {
  if (import.meta.env.PROD === true) return false
  return (
    import.meta.env.VITE_DEV_TOOLS === 'true' ||
    import.meta.env.VITE_SHOW_PLAN_QUALITY === 'true'
  )
}

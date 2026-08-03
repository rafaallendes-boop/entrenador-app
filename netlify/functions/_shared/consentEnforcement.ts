import { getCurrentVersion } from '../../../src/services/legal/consentDocuments'

/**
 * Consulta a la autoridad remota y falla cerrado. Si Supabase no está
 * disponible, no se incorporan datos biométricos nuevos hasta poder comprobar
 * el consentimiento vigente.
 */
export async function hasCurrentWhoopConsent(userId: string): Promise<boolean> {
  const supabaseUrl = process.env['SUPABASE_URL']
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!supabaseUrl || !serviceRoleKey) return false

  const endpoint = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/user_consents`
    + `?user_id=eq.${encodeURIComponent(userId)}`
    + '&document=eq.whoop_biometric&select=version'

  try {
    const response = await fetch(endpoint, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    })
    if (!response.ok) return false

    const rows = await response.json() as Array<{ version?: unknown }>
    const currentVersion = getCurrentVersion('whoop_biometric')
    return Array.isArray(rows) && rows.some((row) => row.version === currentVersion)
  } catch {
    return false
  }
}

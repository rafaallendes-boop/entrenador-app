import type { Handler } from '@netlify/functions'
import { json, resolveAuthContext } from './_shared/planGenerationShared'
import { buildAuthorizeUrl, generateOAuthState, getServiceRoleDb, OAUTH_STATE_TTL_MS, WHOOP_SCOPES } from './_shared/whoopOAuth'
import { insertOAuthState } from './_shared/whoopSupabase'
import { corsPreflight } from './_shared/cors'

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return corsPreflight()
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  let auth: Awaited<ReturnType<typeof resolveAuthContext>>
  try {
    auth = await resolveAuthContext(event)
  } catch (error) {
    return json((error as { statusCode?: number }).statusCode ?? 401, { error: 'Sesión requerida.' })
  }

  const clientId = process.env['WHOOP_CLIENT_ID']
  const redirectUri = process.env['WHOOP_REDIRECT_URI']
  const authorizeUrl = process.env['WHOOP_AUTHORIZE_URL']
  if (!clientId || !redirectUri || !authorizeUrl) {
    return json(500, { error: 'Whoop no está configurado.' })
  }

  let nativeReturn = false
  try {
    nativeReturn = (JSON.parse(event.body ?? '{}') as { nativeReturn?: unknown }).nativeReturn === true
  } catch {
    return json(400, { error: 'Invalid JSON body' })
  }

  const state = `${nativeReturn ? 'ios.' : 'web.'}${generateOAuthState()}`
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString()
  try {
    await insertOAuthState(getServiceRoleDb(), { state, userId: auth.userId, expiresAt })
  } catch {
    return json(500, { error: 'No se pudo iniciar la conexión con Whoop.' })
  }

  const url = buildAuthorizeUrl({ authorizeUrl, clientId, redirectUri, scopes: WHOOP_SCOPES, state })
  return json(200, { url })
}

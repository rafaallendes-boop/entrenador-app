import type { Handler } from '@netlify/functions'
import { exchangeCode } from './_shared/whoopClient'
import { getServiceRoleDb } from './_shared/whoopOAuth'
import { consumeOAuthState, upsertConnection } from './_shared/whoopSupabase'
import { CURRENT_KEY_VERSION } from './_shared/tokenCrypto'

const SETTINGS_SUCCESS = '/settings?whoop=connected'
const SETTINGS_ERROR = '/settings?whoop=error'

function redirect(location: string) {
  return { statusCode: 302, headers: { Location: location }, body: '' }
}

export const handler: Handler = async (event) => {
  const code = event.queryStringParameters?.code
  const state = event.queryStringParameters?.state
  if (!code || !state) return redirect(SETTINGS_ERROR)

  const db = getServiceRoleDb()
  const consumed = await consumeOAuthState(db, state).catch(() => null)
  if (!consumed) return redirect(SETTINGS_ERROR)

  try {
    const tokens = await exchangeCode({ code })
    await upsertConnection(db, {
      userId: consumed.userId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      keyVersion: CURRENT_KEY_VERSION,
      expiresAt: tokens.expiresAt,
      whoopUserId: tokens.whoopUserId ?? null,
      scopes: tokens.scopes ?? null,
    })
    return redirect(SETTINGS_SUCCESS)
  } catch (error) {
    console.error('[whoop] oauth callback failed', {
      userId: consumed.userId,
      message: error instanceof Error ? error.message : String(error),
    })
    return redirect(SETTINGS_ERROR)
  }
}

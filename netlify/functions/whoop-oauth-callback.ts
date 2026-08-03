import type { Handler } from '@netlify/functions'
import { exchangeCode } from './_shared/whoopClient'
import { getServiceRoleDb } from './_shared/whoopOAuth'
import { consumeOAuthState, upsertConnection } from './_shared/whoopSupabase'
import { CURRENT_KEY_VERSION } from './_shared/tokenCrypto'
import { isConsentEnforcementEnabled } from './_shared/consentFlag'
import { hasCurrentWhoopConsent } from './_shared/consentEnforcement'

const SETTINGS_SUCCESS = '/settings?whoop=connected'
const NATIVE_SETTINGS_SUCCESS = 'rallyiq://settings?whoop=connected'

type CallbackFailureReason =
  | 'authorization_denied'
  | 'invalid_callback'
  | 'expired_state'
  | 'state_error'
  | 'consent_required'
  | 'token_exchange'
  | 'connection_save'

function redirect(location: string) {
  return { statusCode: 302, headers: { Location: location }, body: '' }
}

function errorLocation(nativeReturn: boolean, reason: CallbackFailureReason): string {
  const location = nativeReturn ? 'rallyiq://settings' : '/settings'
  return `${location}?whoop=error&reason=${reason}`
}

export const handler: Handler = async (event) => {
  const code = event.queryStringParameters?.code
  const state = event.queryStringParameters?.state
  const nativeReturn = state?.startsWith('ios.') === true
  const successLocation = nativeReturn ? NATIVE_SETTINGS_SUCCESS : SETTINGS_SUCCESS
  const providerError = event.queryStringParameters?.error
  if (!code || !state) {
    return redirect(errorLocation(nativeReturn, providerError ? 'authorization_denied' : 'invalid_callback'))
  }

  let db: ReturnType<typeof getServiceRoleDb>
  let consumed: { userId: string } | null
  try {
    db = getServiceRoleDb()
    consumed = await consumeOAuthState(db, state)
  } catch (error) {
    console.error('[whoop] oauth state validation failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    return redirect(errorLocation(nativeReturn, 'state_error'))
  }
  if (!consumed) return redirect(errorLocation(nativeReturn, 'expired_state'))

  if (isConsentEnforcementEnabled() && !(await hasCurrentWhoopConsent(consumed.userId))) {
    return redirect(errorLocation(nativeReturn, 'consent_required'))
  }

  let tokens: Awaited<ReturnType<typeof exchangeCode>>
  try {
    tokens = await exchangeCode({ code })
  } catch (error) {
    console.error('[whoop] oauth token exchange failed', {
      userId: consumed.userId,
      message: error instanceof Error ? error.message : String(error),
    })
    return redirect(errorLocation(nativeReturn, 'token_exchange'))
  }

  try {
    await upsertConnection(db, {
      userId: consumed.userId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      keyVersion: CURRENT_KEY_VERSION,
      expiresAt: tokens.expiresAt,
      whoopUserId: tokens.whoopUserId ?? null,
      scopes: tokens.scopes ?? null,
    })
    return redirect(successLocation)
  } catch (error) {
    console.error('[whoop] oauth callback failed', {
      userId: consumed.userId,
      message: error instanceof Error ? error.message : String(error),
    })
    return redirect(errorLocation(nativeReturn, 'connection_save'))
  }
}

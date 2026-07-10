import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from './planGenerationShared'
import type { WhoopDb } from './whoopSupabase'

export const OAUTH_STATE_TTL_MS = 600_000
export const WHOOP_SCOPES = ['offline', 'read:recovery', 'read:sleep', 'read:cycles', 'read:profile', 'read:workout']

export function generateOAuthState(): string {
  return randomBytes(32).toString('hex')
}

export function buildAuthorizeUrl(input: {
  authorizeUrl: string
  clientId: string
  redirectUri: string
  scopes: string[]
  state: string
}): string {
  const url = new URL(input.authorizeUrl)
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', input.scopes.join(' '))
  url.searchParams.set('state', input.state)
  return url.toString()
}

export function getServiceRoleDb(): WhoopDb {
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  return createClient(getSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as WhoopDb
}

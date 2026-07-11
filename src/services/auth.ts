import { createClient } from '@supabase/supabase-js'
import { authStorage } from './authStorage'
import { isNativePlatform, isWebPlatform } from './platform'

export const NATIVE_AUTH_REDIRECT_URL = 'rallyiq://auth/callback'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (!isSupabaseConfigured) {
  console.warn('[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY - sync disabled')
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: isWebPlatform(),
        flowType: 'pkce',
        persistSession: true,
        storage: authStorage,
      },
    })
  : null

export function getAuthRedirectUrl(): string {
  const explicitRedirect = (import.meta.env.VITE_AUTH_REDIRECT_URL as string | undefined)?.trim()
  return resolveAuthRedirectUrl({
    native: isNativePlatform(),
    explicitRedirect,
    webOrigin: typeof window !== 'undefined' ? window.location.origin : '',
    development: import.meta.env.DEV,
  })
}

export function resolveAuthRedirectUrl(input: {
  native: boolean
  explicitRedirect?: string
  webOrigin: string
  development?: boolean
}): string {
  if (input.native) return NATIVE_AUTH_REDIRECT_URL
  if (!input.explicitRedirect) return input.webOrigin

  try {
    const configured = new URL(input.explicitRedirect)
    const current = new URL(input.webOrigin)
    if (
      input.development
      && configured.hostname === current.hostname
      && configured.port !== current.port
    ) {
      return input.webOrigin
    }
  } catch {
    return input.explicitRedirect
  }
  return input.explicitRedirect
}

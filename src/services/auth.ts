import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (!isSupabaseConfigured) {
  console.warn('[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY - sync disabled')
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

export function getAuthRedirectUrl(): string {
  const explicitRedirect = (import.meta.env.VITE_AUTH_REDIRECT_URL as string | undefined)?.trim()
  if (explicitRedirect) return explicitRedirect

  if (typeof window !== 'undefined') {
    return window.location.origin
  }

  return ''
}

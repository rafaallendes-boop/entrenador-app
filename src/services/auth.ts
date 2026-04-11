import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY - sync disabled')
}

export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '')

export function getAuthRedirectUrl(): string {
  const explicitRedirect = (import.meta.env.VITE_AUTH_REDIRECT_URL as string | undefined)?.trim()
  if (explicitRedirect) return explicitRedirect

  if (typeof window !== 'undefined') {
    return window.location.origin
  }

  return ''
}

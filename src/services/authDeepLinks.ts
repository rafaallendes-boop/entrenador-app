import { Browser } from '@capacitor/browser'
import type { SupabaseClient } from '@supabase/supabase-js'
import { authStorage } from './authStorage'
import { NATIVE_AUTH_REDIRECT_URL, supabase } from './auth'

const PENDING_AUTH_CONTEXT_KEY = 'rallyiq.auth.pending-context.v1'
const processedCallbacks = new Set<string>()
const callbacksInFlight = new Map<string, Promise<AuthDeepLinkResult>>()

export interface PendingAuthContext {
  returnPath: string
  claimToken?: string
  invitationToken?: string
}

export interface AuthDeepLinkResult {
  handled: boolean
  duplicate?: boolean
  navigateTo?: string
  error?: string
}

interface AuthClient {
  auth: Pick<SupabaseClient['auth'], 'exchangeCodeForSession' | 'setSession'>
}

export async function rememberPendingAuthContext(location = window.location): Promise<void> {
  const params = new URLSearchParams(location.search)
  const context: PendingAuthContext = {
    returnPath: safeInternalPath(`${location.pathname}${location.search}`),
    claimToken: params.get('claim_token') ?? undefined,
    invitationToken: params.get('invitation_token') ?? params.get('invite_token') ?? undefined,
  }
  await authStorage.setItem(PENDING_AUTH_CONTEXT_KEY, JSON.stringify(context))
}

export async function readPendingAuthContext(): Promise<PendingAuthContext | null> {
  const raw = await authStorage.getItem(PENDING_AUTH_CONTEXT_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<PendingAuthContext>
    return {
      returnPath: safeInternalPath(parsed.returnPath ?? '/'),
      claimToken: typeof parsed.claimToken === 'string' ? parsed.claimToken : undefined,
      invitationToken: typeof parsed.invitationToken === 'string' ? parsed.invitationToken : undefined,
    }
  } catch {
    return null
  }
}

export async function clearPendingAuthContext(): Promise<void> {
  await authStorage.removeItem(PENDING_AUTH_CONTEXT_KEY)
}

export function isAuthCallbackUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return (
      (url.protocol === 'rallyiq:' && url.hostname === 'auth' && url.pathname === '/callback')
      || ((url.protocol === 'https:' || url.protocol === 'http:') && url.pathname === '/auth/callback')
    )
  } catch {
    return false
  }
}

export function processAuthDeepLink(
  rawUrl: string,
  client: AuthClient | null = supabase,
): Promise<AuthDeepLinkResult> {
  if (!isAuthCallbackUrl(rawUrl)) return Promise.resolve({ handled: false })
  if (processedCallbacks.has(rawUrl)) {
    return Promise.resolve({ handled: true, duplicate: true })
  }
  const existing = callbacksInFlight.get(rawUrl)
  if (existing) return existing

  const task = processAuthDeepLinkOnce(rawUrl, client).finally(() => {
    callbacksInFlight.delete(rawUrl)
  })
  callbacksInFlight.set(rawUrl, task)
  return task
}

async function processAuthDeepLinkOnce(rawUrl: string, client: AuthClient | null): Promise<AuthDeepLinkResult> {
  if (!client) return { handled: true, error: 'Supabase no está configurado.' }

  const url = new URL(rawUrl)
  const params = mergedAuthParams(url)
  const callbackError = params.get('error_description') ?? params.get('error')
  if (callbackError) {
    processedCallbacks.add(rawUrl)
    return { handled: true, error: callbackError }
  }

  try {
    const code = params.get('code')
    if (code) {
      const { error } = await client.auth.exchangeCodeForSession(code)
      if (error) throw error
    } else {
      const accessToken = params.get('access_token')
      const refreshToken = params.get('refresh_token')
      if (!accessToken || !refreshToken) {
        throw new Error('El callback OAuth no contiene un código o una sesión válida.')
      }
      const { error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      })
      if (error) throw error
    }

    const pending = await readPendingAuthContext()
    await clearPendingAuthContext()
    processedCallbacks.add(rawUrl)
    await Browser.close().catch(() => undefined)
    return { handled: true, navigateTo: pending?.returnPath ?? '/' }
  } catch (error) {
    return {
      handled: true,
      error: error instanceof Error ? error.message : 'No se pudo completar el login.',
    }
  }
}

function mergedAuthParams(url: URL): URLSearchParams {
  const params = new URLSearchParams(url.search)
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
  for (const [key, value] of hash) {
    if (!params.has(key)) params.set(key, value)
  }
  return params
}

function safeInternalPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) return '/'
  return path
}

export function resetProcessedAuthCallbacksForTests(): void {
  processedCallbacks.clear()
  callbacksInFlight.clear()
}

export { NATIVE_AUTH_REDIRECT_URL }

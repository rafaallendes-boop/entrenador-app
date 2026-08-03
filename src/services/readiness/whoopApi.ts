import { getSupabase } from '../sync/syncSupabase'
import { resolveApiUrl } from '../apiUrl'

const WHOOP_OAUTH_START_PATH = '/.netlify/functions/whoop-oauth-start'
const WHOOP_STATUS_PATH = '/.netlify/functions/whoop-status'
const WHOOP_SYNC_PATH = '/.netlify/functions/whoop-sync'

export interface WhoopStatus {
  connected: boolean
  lastSyncAt: string | null
  lastSyncStatus: 'ok' | 'error' | null
  scopes: string[]
}

export interface WhoopSyncResponse {
  ok: boolean
  reason?: 'no_connection' | 'no_self_athlete' | 'cooldown' | 'rate_limited' | 'error'
  code?: 'consent_required'
  error?: string
  retryAfterMs?: number
}

export class WhoopApiError extends Error {
  readonly status: number
  readonly code?: 'consent_required'

  constructor(
    message: string,
    status: number,
    code?: 'consent_required',
  ) {
    super(message)
    this.name = 'WhoopApiError'
    this.status = status
    this.code = code
  }
}

export function isWhoopConsentRequiredError(error: unknown): boolean {
  return error instanceof WhoopApiError && error.code === 'consent_required'
}

async function authHeader(): Promise<Record<string, string>> {
  const supabase = getSupabase()
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sesion no disponible.')
  return { Authorization: `Bearer ${token}` }
}

export async function startWhoopConnect(options: { nativeReturn?: boolean } = {}): Promise<string> {
  const res = await fetch(resolveApiUrl(WHOOP_OAUTH_START_PATH), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...await authHeader() },
    body: JSON.stringify({ nativeReturn: options.nativeReturn === true }),
  })
  const data = await res.json().catch(() => ({})) as { url?: string; error?: string; code?: unknown }
  if (!res.ok) {
    throw new WhoopApiError(
      data.error ?? 'No se pudo iniciar la conexion con Whoop.',
      res.status,
      data.code === 'consent_required' ? 'consent_required' : undefined,
    )
  }
  if (!data.url) throw new Error('Whoop no devolvio una URL de autorizacion.')
  return data.url
}

export async function getWhoopStatus(): Promise<WhoopStatus> {
  const res = await fetch(resolveApiUrl(WHOOP_STATUS_PATH), {
    headers: await authHeader(),
  })
  if (!res.ok) return { connected: false, lastSyncAt: null, lastSyncStatus: null, scopes: [] }
  return res.json() as Promise<WhoopStatus>
}

export async function syncWhoopNow(): Promise<WhoopSyncResponse> {
  const res = await fetch(resolveApiUrl(WHOOP_SYNC_PATH), {
    method: 'POST',
    headers: await authHeader(),
  })
  const data = await res.json().catch(() => ({})) as Partial<WhoopSyncResponse>
  if (!res.ok) {
    return {
      ...data,
      ok: false,
      reason: data.reason ?? 'error',
    }
  }
  return { ...data, ok: data.ok === true }
}

export async function disconnectWhoop(): Promise<void> {
  const res = await fetch(resolveApiUrl(WHOOP_SYNC_PATH), {
    method: 'DELETE',
    headers: await authHeader(),
  })
  if (!res.ok) throw new Error('No se pudo desconectar Whoop.')
}

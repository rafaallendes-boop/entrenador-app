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
  retryAfterMs?: number
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
  if (!res.ok) throw new Error('No se pudo iniciar la conexion con Whoop.')
  const data = await res.json() as { url?: string }
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
  return res.json() as Promise<WhoopSyncResponse>
}

export async function disconnectWhoop(): Promise<void> {
  const res = await fetch(resolveApiUrl(WHOOP_SYNC_PATH), {
    method: 'DELETE',
    headers: await authHeader(),
  })
  if (!res.ok) throw new Error('No se pudo desconectar Whoop.')
}

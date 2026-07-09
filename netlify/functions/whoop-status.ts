import type { Handler } from '@netlify/functions'
import { json, resolveAuthContext } from './_shared/planGenerationShared'
import { getServiceRoleDb } from './_shared/whoopOAuth'
import type { WhoopDb } from './_shared/whoopSupabase'

interface StatusRow {
  last_sync_at?: string | null
  last_sync_status?: 'ok' | 'error' | null
  scopes?: string | null
}

interface StatusQuery {
  select(columns?: string): StatusQuery
  eq(column: string, value: unknown): StatusQuery
  maybeSingle(): Promise<{ data?: StatusRow | null; error?: { message?: string } | null }>
}

function statusTable(db: WhoopDb): StatusQuery {
  return db.from('whoop_connections') as StatusQuery
}

export const handler: Handler = async (event) => {
  let auth: Awaited<ReturnType<typeof resolveAuthContext>>
  try {
    auth = await resolveAuthContext(event)
  } catch (error) {
    return json((error as { statusCode?: number }).statusCode ?? 401, { error: 'Sesión requerida.' })
  }

  const { data, error } = await statusTable(getServiceRoleDb())
    .select('last_sync_at,last_sync_status,scopes')
    .eq('user_id', auth.userId)
    .maybeSingle()
  if (error) return json(500, { error: 'No se pudo leer el estado de Whoop.' })

  return json(200, {
    connected: Boolean(data),
    lastSyncAt: data?.last_sync_at ?? null,
    lastSyncStatus: data?.last_sync_status ?? null,
    scopes: data?.scopes ? data.scopes.split(/\s+/).filter(Boolean) : [],
  })
}

export type FetchImpl = (input: string | URL, init?: RequestInit) => Promise<{
  ok: boolean
  status: number
  headers?: Pick<Headers, 'get'>
  json(): Promise<unknown>
  text?(): Promise<string>
}>

const REFRESH_SKEW_MS = 60_000
const WHOOP_PAGE_LIMIT = 25

export interface WhoopTokens {
  accessToken: string
  refreshToken: string
  expiresAt: string
}

export interface WhoopRaw {
  recovery: unknown[]
  sleep: unknown[]
  cycles: unknown[]
}

interface TokenResponse {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  scope?: unknown
}

interface CollectionResponse {
  records?: unknown
  next_token?: unknown
}

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

function parseExpiresAt(expiresIn: unknown): string {
  const seconds = typeof expiresIn === 'number'
    ? expiresIn
    : typeof expiresIn === 'string'
      ? Number(expiresIn)
      : NaN
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error('Whoop token response is missing expires_in')
  }
  return new Date(Date.now() + seconds * 1000).toISOString()
}

async function requestTokens(
  body: Record<string, string>,
  fetchImpl: FetchImpl,
): Promise<WhoopTokens & { whoopUserId?: string; scopes?: string }> {
  const response = await fetchImpl(env('WHOOP_TOKEN_URL'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  if (!response.ok) throw new Error(`Whoop token request failed: ${response.status}`)

  const data = await response.json() as TokenResponse
  if (typeof data.access_token !== 'string') {
    throw new Error('Whoop token response is missing access_token')
  }
  const refreshToken = typeof data.refresh_token === 'string'
    ? data.refresh_token
    : body.refresh_token
  if (!refreshToken) throw new Error('Whoop token response is missing refresh_token')

  return {
    accessToken: data.access_token,
    refreshToken,
    expiresAt: parseExpiresAt(data.expires_in),
    scopes: typeof data.scope === 'string' ? data.scope : undefined,
  }
}

export async function exchangeCode(input: { code: string; fetchImpl?: FetchImpl }) {
  const fetchImpl = input.fetchImpl ?? fetch
  return requestTokens({
    grant_type: 'authorization_code',
    code: input.code,
    client_id: env('WHOOP_CLIENT_ID'),
    client_secret: env('WHOOP_CLIENT_SECRET'),
    redirect_uri: env('WHOOP_REDIRECT_URI'),
  }, fetchImpl as FetchImpl)
}

export async function ensureFreshToken(
  conn: WhoopTokens,
  deps: { fetchImpl?: FetchImpl } = {},
): Promise<{ accessToken: string; refreshed?: WhoopTokens }> {
  const expiresMs = new Date(conn.expiresAt).getTime()
  if (Number.isFinite(expiresMs) && expiresMs - REFRESH_SKEW_MS > Date.now()) {
    return { accessToken: conn.accessToken }
  }

  const fetchImpl = deps.fetchImpl ?? fetch
  const refreshed = await requestTokens({
    grant_type: 'refresh_token',
    refresh_token: conn.refreshToken,
    client_id: env('WHOOP_CLIENT_ID'),
    client_secret: env('WHOOP_CLIENT_SECRET'),
    scope: 'offline',
  }, fetchImpl as FetchImpl)
  return { accessToken: refreshed.accessToken, refreshed }
}

async function getCollection(
  baseUrl: string,
  path: string,
  accessToken: string,
  start: string,
  end: string,
  fetchImpl: FetchImpl,
): Promise<unknown[]> {
  const records: unknown[] = []
  let nextToken: string | undefined

  do {
    const url = new URL(`${baseUrl.replace(/\/$/, '')}${path}`)
    url.searchParams.set('limit', String(WHOOP_PAGE_LIMIT))
    url.searchParams.set('start', start)
    url.searchParams.set('end', end)
    if (nextToken) url.searchParams.set('nextToken', nextToken)

    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = response.headers?.get('retry-after')
        throw Object.assign(new Error('Whoop rate limited'), {
          rateLimited: true,
          retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : undefined,
        })
      }
      throw new Error(`Whoop API ${path} failed: ${response.status}`)
    }

    const data = await response.json() as CollectionResponse
    if (Array.isArray(data.records)) records.push(...data.records)
    nextToken = typeof data.next_token === 'string' && data.next_token ? data.next_token : undefined
  } while (nextToken)

  return records
}

export async function fetchWhoopData(
  accessToken: string,
  opts: { fetchImpl?: FetchImpl; days?: number } = {},
): Promise<WhoopRaw> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const days = opts.days ?? 7
  const end = new Date().toISOString()
  const start = new Date(Date.now() - days * 86_400_000).toISOString()
  const base = env('WHOOP_API_BASE')

  const [recovery, sleep, cycles] = await Promise.all([
    getCollection(base, '/v2/recovery', accessToken, start, end, fetchImpl as FetchImpl),
    getCollection(base, '/v2/activity/sleep', accessToken, start, end, fetchImpl as FetchImpl),
    getCollection(base, '/v2/cycle', accessToken, start, end, fetchImpl as FetchImpl),
  ])
  return { recovery, sleep, cycles }
}

export async function revokeWhoopAccess(
  accessToken: string,
  deps: { fetchImpl?: FetchImpl } = {},
): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch
  await fetchImpl(new URL(`${env('WHOOP_API_BASE').replace(/\/$/, '')}/v2/user/access`), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => undefined)
}

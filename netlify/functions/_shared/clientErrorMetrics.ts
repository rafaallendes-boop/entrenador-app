/**
 * Lectura de los agregados de errores de cliente para `/ops`.
 * Definición: `docs/superpowers/specs/2026-09-06-client-error-reporting-design.md` §8 y §9.2.
 *
 * Devuelve **tres estados distintos** y no los colapsa:
 *   - `ready`          → hay datos. Total cero significa «sin eventos».
 *   - `not_installed`  → la tabla o la RPC no existen (falta `035`/`036`).
 *   - `unavailable`    → la consulta falló: timeout, permiso, red.
 *
 * Un timeout presentado como cero sería el peor resultado posible para un panel
 * de operación: diría «no pasó nada» cuando en realidad no se pudo mirar.
 *
 * La salud de la retención se consulta **siempre**, incluso sin eventos
 * recientes: su pregunta es si quedan filas vencidas, no si hubo actividad.
 */

import { CLIENT_ERROR_RETENTION_DAYS } from './planGenerationTelemetryRetention'
import type {
  ClientErrorGroup,
  ClientErrorMetrics,
  ClientErrorRetentionHealth,
  ClientErrorWindow,
  UnknownBreakdownEntry,
} from '../../../src/services/observability/clientErrorMetricsContract'

const DAY_MS = 24 * 60 * 60 * 1000

/** La RPC no existe todavía: es ausencia, no fallo. */
export class MissingClientErrorRpcError extends Error {
  readonly functionName: string

  constructor(functionName: string) {
    super(`RPC ausente: ${functionName}`)
    this.name = 'MissingClientErrorRpcError'
    this.functionName = functionName
  }
}

export interface ClientErrorMetricsDeps {
  readonly callRpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>
  readonly now?: () => number
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function mapGroup(raw: unknown): ClientErrorGroup {
  const row = asRecord(raw)
  return {
    fingerprint: asString(row['fingerprint']),
    release: asString(row['release']),
    source: asString(row['source']) as ClientErrorGroup['source'],
    diagnosticCode: asString(row['diagnostic_code']) as ClientErrorGroup['diagnosticCode'],
    errorName: asString(row['error_name']),
    component: typeof row['component'] === 'string' ? row['component'] : null,
    route: asString(row['route']),
    count: asNumber(row['count']),
    accounts: asNumber(row['accounts']),
    firstSeen: asString(row['first_seen']),
    lastSeen: asString(row['last_seen']),
  }
}

function mapBreakdown(raw: unknown): UnknownBreakdownEntry {
  const row = asRecord(raw)
  return {
    source: asString(row['source']) as UnknownBreakdownEntry['source'],
    errorName: asString(row['error_name']),
    route: asString(row['route']),
    release: asString(row['release']),
    count: asNumber(row['count']),
  }
}

function mapWindow(raw: unknown): ClientErrorWindow {
  const payload = asRecord(raw)
  const unknown = asRecord(payload['unknown'])
  const groups = Array.isArray(payload['groups']) ? payload['groups'] : []
  const breakdown = Array.isArray(unknown['breakdown']) ? unknown['breakdown'] : []

  return {
    total: asNumber(payload['total']),
    groups: groups.map(mapGroup),
    unknown: {
      total: asNumber(unknown['total']),
      share: asNumber(unknown['share']),
      breakdown: breakdown.map(mapBreakdown),
    },
  }
}

async function readRetentionHealth(
  deps: ClientErrorMetricsDeps,
): Promise<ClientErrorRetentionHealth> {
  try {
    const raw = asRecord(
      await deps.callRpc('read_client_error_retention_health', {
        p_cutoff_days: CLIENT_ERROR_RETENTION_DAYS,
      }),
    )
    const remaining = asNumber(raw['expiredRemaining'], -1)
    if (remaining < 0) {
      return { status: 'unavailable', expiredRemaining: null, oldestExpiredAt: null, checkedAt: null }
    }

    return {
      // Cualquier fila por sobre el corte es atraso: la limpieza es diaria, así
      // que el margen de ~24 h ya está contemplado en el propio cutoff.
      status: remaining > 0 ? 'behind' : 'ok',
      expiredRemaining: remaining,
      oldestExpiredAt: typeof raw['oldestExpiredAt'] === 'string' ? raw['oldestExpiredAt'] : null,
      checkedAt: typeof raw['checkedAt'] === 'string' ? raw['checkedAt'] : null,
    }
  } catch {
    // Nunca «sano» cuando no se pudo mirar.
    return { status: 'unavailable', expiredRemaining: null, oldestExpiredAt: null, checkedAt: null }
  }
}

export async function readClientErrorMetrics(
  deps: ClientErrorMetricsDeps,
): Promise<ClientErrorMetrics> {
  const now = deps.now?.() ?? Date.now()

  let dayRaw: unknown
  let weekRaw: unknown
  try {
    ;[dayRaw, weekRaw] = await Promise.all([
      deps.callRpc('read_client_error_metrics', {
        p_since: new Date(now - DAY_MS).toISOString(),
      }),
      deps.callRpc('read_client_error_metrics', {
        p_since: new Date(now - 7 * DAY_MS).toISOString(),
      }),
    ])
  } catch (error) {
    if (error instanceof MissingClientErrorRpcError) return { status: 'not_installed' }
    return { status: 'unavailable' }
  }

  return {
    status: 'ready',
    windows: { day: mapWindow(dayRaw), week: mapWindow(weekRaw) },
    retention: await readRetentionHealth(deps),
  }
}

const RPC_TIMEOUT_MS = 8_000

/**
 * PostgREST usa `PGRST202` para «no existe esa función». La frase
 * `does not exist` **no** sirve como señal: la emite también para columnas y
 * relaciones ausentes, así que un `035` mal aplicado se presentaría como «sin
 * instalar» en vez de «no se pudo leer» — justo la conflación que el módulo
 * promete evitar.
 */
function isMissingFunction(status: number, body: string): boolean {
  if (status === 404) return true
  return body.includes('PGRST202')
}

/**
 * Llamador con `service_role`. Traduce «la función no existe» a
 * `MissingClientErrorRpcError` para que el panel distinga ausencia de fallo.
 *
 * El cuerpo de PostgREST no cruza al cliente ni al log: puede traer detalles de
 * infraestructura.
 */
export function createServiceRoleRpcCaller(): ClientErrorMetricsDeps['callRpc'] {
  return async (functionName, args) => {
    const url = process.env['SUPABASE_URL']
    const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
    if (!url || !key) throw new Error('Configuración de Supabase ausente en el servidor.')

    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      if (isMissingFunction(response.status, body)) {
        throw new MissingClientErrorRpcError(functionName)
      }
      throw new Error(`RPC ${functionName} devolvió ${response.status}.`)
    }

    return (await response.json()) as unknown
  }
}

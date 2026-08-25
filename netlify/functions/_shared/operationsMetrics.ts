import {
  isOperationsWindow,
  type OperationsMetrics,
  type OperationsWindow,
} from '../../../src/services/operations/operationsMetricsContract'

const RPC_TIMEOUT_MS = 8_000
const DAY_MS = 24 * 60 * 60 * 1000

export class OperationsMetricsError extends Error {
  readonly statusCode: number
  readonly diagnostics?: { upstreamStatus?: number; upstreamBody?: string }

  constructor(
    message: string,
    statusCode = 500,
    diagnostics?: { upstreamStatus?: number; upstreamBody?: string },
  ) {
    super(message)
    this.name = 'OperationsMetricsError'
    this.statusCode = statusCode
    this.diagnostics = diagnostics
  }
}

async function readWindow(
  url: string,
  serviceRoleKey: string,
  sinceIso: string,
): Promise<OperationsWindow> {
  let response: Response
  try {
    response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/read_operations_metrics`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_since: sinceIso }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    })
  } catch {
    throw new OperationsMetricsError('No se pudo consultar la telemetría.')
  }

  if (!response.ok) {
    // 404 acá significa, casi siempre, que `022` no fue aplicada. Se reporta
    // como fallo del servidor, no como "sin datos": mostrar ceros cuando en
    // realidad no se pudo leer sería el peor resultado posible para un panel
    // de operación.
    const upstreamBody = (await response.text().catch(() => '')).slice(0, 2_000)
    throw new OperationsMetricsError('La telemetría no está disponible.', 500, {
      upstreamStatus: response.status,
      upstreamBody,
    })
  }

  const payload = await response.json().catch(() => null)
  if (!isOperationsWindow(payload)) {
    throw new OperationsMetricsError('La telemetría devolvió una forma inesperada.')
  }
  return payload
}

/**
 * Lee las dos ventanas en paralelo. Usa service role porque el RPC sólo se le
 * concedió a ese rol; el resultado son agregados, nunca filas por cuenta.
 */
export async function readOperationsMetrics(
  now: number = Date.now(),
): Promise<OperationsMetrics> {
  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL']
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !serviceRoleKey) {
    throw new OperationsMetricsError('Telemetría mal configurada en el servidor.')
  }

  const [last24h, last7d] = await Promise.all([
    readWindow(url, serviceRoleKey, new Date(now - DAY_MS).toISOString()),
    readWindow(url, serviceRoleKey, new Date(now - 7 * DAY_MS).toISOString()),
  ])

  return { last24h, last7d, generatedAt: new Date(now).toISOString() }
}

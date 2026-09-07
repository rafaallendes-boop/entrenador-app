import type { Handler } from '@netlify/functions'
import { corsPreflight } from './_shared/cors'
import { isOperationsAdmin } from './_shared/operationsAdmins'
import { readOperationsMetrics } from './_shared/operationsMetrics'
import {
  createServiceRoleRpcCaller,
  readClientErrorMetrics,
} from './_shared/clientErrorMetrics'
import { json, resolveAuthContext } from './_shared/planGenerationShared'

/**
 * Punto de acceso deliberadamente pequeño para la telemetría operacional.
 * La lista de administradores vive sólo en el entorno de Functions; el cliente
 * no recibe ninguna pista sobre quién puede acceder al panel.
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return corsPreflight()
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' })

  let auth: Awaited<ReturnType<typeof resolveAuthContext>>
  try {
    auth = await resolveAuthContext(event)
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode === 401 ? 401 : 500
    return json(statusCode, {
      error: statusCode === 401 ? 'Sesión requerida.' : 'No se pudo validar la sesión.',
    })
  }

  // Autorizar antes de consultar: una cuenta no listada no debe ni disparar el
  // RPC de telemetría.
  if (!isOperationsAdmin(auth.userId)) {
    return json(403, { error: 'No autorizado.' })
  }

  try {
    // La tarjeta de errores de cliente se lee aparte y **no puede tumbar el
    // resto del panel**: si `035`/`036` no están aplicadas, o su consulta
    // falla, viaja con su propio estado y lo demás sigue disponible.
    const [metrics, clientErrors] = await Promise.all([
      readOperationsMetrics(),
      readClientErrorMetrics({ callRpc: createServiceRoleRpcCaller() }).catch(
        () => ({ status: 'unavailable' as const }),
      ),
    ])
    return json(200, { ...metrics, clientErrors })
  } catch (error) {
    // El detalle se registra para operar el servicio, pero no cruza al browser:
    // podría contener hosts, puertos o respuestas de infraestructura.
    const reportedStatus = (error as { statusCode?: unknown }).statusCode
    const statusCode = typeof reportedStatus === 'number' && reportedStatus >= 500 && reportedStatus < 600
      ? reportedStatus
      : 500
    console.error('[operations-dashboard] telemetry read failed', error)
    return json(statusCode, { error: 'No se pudo leer la telemetría.' })
  }
}

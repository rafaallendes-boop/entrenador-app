import { resolveApiUrl } from '../apiUrl'
import { supabase } from '../auth'
import {
  isOperationsMetrics,
  type OperationsMetrics,
} from './operationsMetricsContract'

export type OperationsAccessKind = 'unauthenticated' | 'forbidden' | 'unavailable'

export class OperationsAccessError extends Error {
  readonly kind: OperationsAccessKind

  constructor(kind: OperationsAccessKind, message: string) {
    super(message)
    this.name = 'OperationsAccessError'
    this.kind = kind
  }
}

/**
 * El navegador no decide quién puede operar el dashboard: sólo presenta los
 * estados de acceso que resuelve el endpoint server-only.
 */
export async function fetchOperationsMetrics(): Promise<OperationsMetrics> {
  if (!supabase) {
    throw new OperationsAccessError('unavailable', 'No se pudo configurar la conexión.')
  }

  let token: string | undefined
  try {
    const { data } = await supabase.auth.getSession()
    token = data.session?.access_token
  } catch {
    throw new OperationsAccessError('unavailable', 'No se pudo validar la sesión local.')
  }

  if (!token) {
    throw new OperationsAccessError('unauthenticated', 'Inicia sesión para ver esta vista.')
  }

  let response: Response
  try {
    response = await fetch(resolveApiUrl('/.netlify/functions/operations-dashboard'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    throw new OperationsAccessError('unavailable', 'No se pudo conectar con el servidor.')
  }

  if (response.status === 401) {
    throw new OperationsAccessError('unauthenticated', 'Tu sesión expiró.')
  }
  if (response.status === 403) {
    throw new OperationsAccessError('forbidden', 'Esta vista no está disponible para tu cuenta.')
  }
  if (!response.ok) {
    throw new OperationsAccessError('unavailable', 'No se pudo leer la telemetría.')
  }

  const payload = await response.json().catch(() => null)
  if (!isOperationsMetrics(payload)) {
    throw new OperationsAccessError('unavailable', 'La telemetría no está disponible.')
  }
  return payload
}

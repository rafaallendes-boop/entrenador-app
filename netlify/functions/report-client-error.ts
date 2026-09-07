import type { Handler } from '@netlify/functions'
import { corsPreflight } from './_shared/cors'
import { isClientErrorIngestionEnabled } from './_shared/clientErrorIngestionFlag'
import { ingestClientError } from './_shared/clientErrorIngest'
import generatedCatalog from './_shared/generatedReleaseCatalog.json'
import { json, resolveAuthContext } from './_shared/planGenerationShared'
import type { ReleaseCatalog } from '../../src/services/observability/releaseCatalog'

/**
 * Ingesta de errores de cliente.
 * Definición: `docs/superpowers/specs/2026-09-06-client-error-reporting-design.md` §7.
 *
 * Tres cosas que este handler hace a propósito y conviene no "mejorar":
 *
 *  - **Éxito y descarte por cupo devuelven ambos 204.** El cliente no debe
 *    reaccionar a su propio techo: distinguirlo le daría material para
 *    reintentar justo cuando lo que hace falta es que se calle.
 *  - **La sesión autoriza; el `user_id` lo pone el servidor.** Lo que venga en
 *    el payload se descarta en silencio, no se reporta como error.
 *  - **Nunca se loguea el payload ni el `user_id`.** El detalle crudo de un
 *    fallo puede arrastrar el cuerpo de PostgREST y con él fragmentos de fila.
 *
 * El catálogo de releases se importa **estáticamente**: en tiempo de request no
 * hay red, ni almacenamiento privado, ni credenciales para leer manifiestos.
 */

const RPC_TIMEOUT_MS = 5_000

function serviceRoleCredentials(): { url: string; key: string } | null {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (typeof url !== 'string' || url === '') return null
  if (typeof key !== 'string' || key === '') return null
  return { url: url.replace(/\/$/, ''), key }
}

async function callRpc(functionName: string, args: Record<string, unknown>): Promise<unknown> {
  const creds = serviceRoleCredentials()
  if (!creds) throw new Error('Configuración de Supabase ausente en el servidor.')

  const response = await fetch(`${creds.url}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.key}`,
      apikey: creds.key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  })

  if (!response.ok) {
    // El estado sirve para operar; el cuerpo no cruza ni al log ni al cliente.
    throw new Error(`RPC ${functionName} devolvió ${response.status}.`)
  }

  return (await response.json()) as unknown
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return corsPreflight()
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  let auth: Awaited<ReturnType<typeof resolveAuthContext>>
  try {
    auth = await resolveAuthContext(event)
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode === 401 ? 401 : 500
    return json(statusCode, {
      error: statusCode === 401 ? 'Sesión requerida.' : 'No se pudo validar la sesión.',
    })
  }

  // La ingesta es total por contrato; este try es la última barrera para que
  // ningún bug de telemetría se presente como caída del servidor.
  let outcome: Awaited<ReturnType<typeof ingestClientError>>
  try {
    outcome = await ingestClientError(
      { rawBody: event.body ?? '', userId: auth.userId },
      {
        callRpc,
        catalog: generatedCatalog as ReleaseCatalog,
        ingestionEnabled: isClientErrorIngestionEnabled(),
      },
    )
  } catch {
    console.error('[report-client-error] ingesta lanzó de forma inesperada')
    return json(503, { error: 'Ingesta no disponible.' })
  }

  if (!outcome.ok) {
    if (outcome.status === 400) return json(400, { error: 'Contrato inválido.' })
    if (outcome.status === 413) return json(413, { error: 'Payload demasiado grande.' })
    // 503: el control durable no está disponible. No hay vía alternativa de
    // inserción a propósito — sin techo, la ingesta deja de tener uno.
    console.error('[report-client-error] ingesta no disponible')
    return json(503, { error: 'Ingesta no disponible.' })
  }

  // Insertado o descartado por cupo: el cliente ve lo mismo.
  return { statusCode: 204, headers: corsPreflight().headers, body: '' }
}

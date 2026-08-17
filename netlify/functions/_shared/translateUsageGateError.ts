import {
  KillSwitchActiveError,
  QuotaExceededError,
  SpendCapExceededError,
  UsageGateUnavailableError,
  isQuotaExceededDetail,
  isSpendCapExceededDetail,
} from '../../../src/services/entitlements/usageGateError'
import type { UsageGateHttpError } from './usageGate'

/**
 * Adaptador de forma de error: `assertUsageGate` lanza `UsageGateHttpError`
 * (statusCode/errorCode/detail — el mismo shape que `EntitlementHttpError`,
 * pensado para la serialización HTTP síncrona de las 3 funciones). Pero en
 * el worker el error no va a una respuesta HTTP: entra al loop async
 * (`asyncGenerationLoop.ts`), que reconoce las 4 causas por `instanceof`
 * sobre las clases cliente de `usageGateError.ts` (mismo tipo que ya usa
 * `classifyProxyHttpError`). Sin esta traducción, el loop nunca reconoce el
 * rechazo — cae al catch genérico, se convierte en `provider_failed` y
 * dispara un segundo intento inútil. Este es el único punto de la app donde
 * un error server-shaped cruza hacia código que espera el shape cliente.
 *
 * `server_error` (RPC caída, red, JSON malformado — ver `usageGate.ts`) se
 * traduce a `UsageGateUnavailableError`, NO se propaga tal cual: un error
 * crudo sin traducir tampoco sería reconocido por el loop (P1, ronda 2 —
 * hallazgo real sobre la primera versión de este adaptador, que dejaba
 * pasar `server_error` sin convertir).
 *
 * Corrección tras revisión (P2, ronda 3): la versión anterior forzaba
 * `error.detail as QuotaExceededDetail`/`as SpendCapExceededDetail` sin
 * validar la forma real — `detail` es `unknown` en el momento en que llega
 * acá (viene de un `JSON.parse` en el otro extremo del RPC), así que un
 * detail corrupto o con forma inesperada se construía igual como un
 * rechazo de política "válido" con datos basura. Ahora usa los mismos type
 * guards que `classifyProxyHttpError`/Task 9: si el `errorCode` dice una
 * cosa pero el `detail` no calza con esa forma, se trata como fallo de
 * infraestructura (`UsageGateUnavailableError`), no como un rechazo de
 * cuota/costo corrupto.
 */
export function translateUsageGateError(error: UsageGateHttpError): Error {
  if (error.errorCode === 'quota_exceeded' && isQuotaExceededDetail(error.detail)) {
    return new QuotaExceededError(error.detail)
  }
  if (error.errorCode === 'spend_cap_exceeded' && isSpendCapExceededDetail(error.detail)) {
    return new SpendCapExceededError(error.detail)
  }
  if (error.errorCode === 'kill_switch_active') {
    return new KillSwitchActiveError()
  }
  return new UsageGateUnavailableError(error.message)
}

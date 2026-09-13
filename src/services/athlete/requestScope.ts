import { v4 as uuid } from '../../utils/uuid'
import { getActiveAthleteId, getSelfAthleteId, getSwitchEpoch } from './activeAthlete'

/**
 * Identidad capturada ANTES del primer `await` de una operación del coach y
 * comprobada antes de escribir. Mismo patrón que `pullWorkouts.ts`: se
 * comparan epoch E identidad porque `hydrateActiveAthlete` publica el atleta
 * sin tocar el epoch.
 */
export interface RequestScope {
  athleteId: string | null
  epoch: number
  conversationId?: string
  requestId: string
}

export function captureRequestScope(conversationId?: string): RequestScope {
  return {
    athleteId: getActiveAthleteId(),
    epoch: getSwitchEpoch(),
    ...(conversationId ? { conversationId } : {}),
    requestId: uuid(),
  }
}

/**
 * `null → self` con el mismo epoch es la hidratación inicial, no un switch: se
 * acepta. `null → cualquier otro atleta` es un cambio real aunque el epoch no
 * se haya movido. Cualquier otro cambio de identidad, o un epoch distinto,
 * invalida.
 */
export function isRequestScopeCurrent(scope: RequestScope): boolean {
  if (getSwitchEpoch() !== scope.epoch) return false
  const current = getActiveAthleteId()
  if (scope.athleteId == null) return current == null || current === getSelfAthleteId()
  return current === scope.athleteId
}

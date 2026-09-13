import { getActiveAthleteId, getSelfAthleteId } from '../athlete/activeAthlete'

/**
 * Objetivo que el cliente PROPONE; el servidor verifica la membresía (Task 5).
 *
 * Devuelve `null` cuando la acción es sobre el propio actor. No es una omisión
 * por comodidad: con `roleGate: 'on'` una membresía `self` NO habilita
 * delegación, así que mandar el id propio marcaría cada request del atleta
 * como `wouldDeny` y arruinaría la evidencia de la ventana de auditoría.
 */
export function resolveRequestTargetAthleteId(explicit?: string | null): string | null {
  // Solo omitir el argumento permite consultar el holder vivo. Un null
  // capturado antes de hidratar no puede adoptar luego otro atleta.
  const target = explicit === undefined ? getActiveAthleteId() : explicit
  if (!target) return null
  const self = getSelfAthleteId()
  if (self && target === self) return null
  return target
}

import { getActiveAthleteId, getSelfAthleteId } from './activeAthlete'
import { isCoachAccount } from './coachAccess'
import { getAccountRole } from '../entitlements/accountRoleHolder'
import { switchActiveAthlete } from './switchActiveAthlete'

/**
 * Defensa de rollback (spec 2b §2): hydrateActiveAthlete respeta una selección
 * persistida válida sin consultar la allowlist. Si la cuenta dejó de ser coach
 * —salió de `VITE_COACH_ACCOUNTS`, o su `account_role` ya no es `coach`— con un
 * gestionado activo, este guard fuerza el retorno al self y limpia la
 * selección. Retorna true si intervino.
 *
 * **Habilitar y revocar no usan el mismo criterio.** `isCoachAccount` falla
 * cerrado con `unknown`: sin evidencia no se muestra la UI de coach, que es lo
 * correcto para *otorgar*. Acá se *revoca*, y el rol arranca en `unknown` hasta
 * que hidraten los entitlements: aplicar el mismo criterio destruiría en cada
 * arranque la selección de un coach real que no esté en la allowlist, antes de
 * saber quién es. Sin evidencia se difiere; el guard vuelve a correr cuando el
 * rol llega.
 */
export async function enforceCoachScopeGuard(
  user: { id: string; email?: string | null } | null | undefined,
  rawAllowlist?: string,
): Promise<boolean> {
  if (!user?.id) return false
  if (getAccountRole() === 'unknown') return false
  if (isCoachAccount(user, rawAllowlist)) return false

  const active = getActiveAthleteId()
  const selfId = getSelfAthleteId()
  if (!selfId || !active || active === selfId) return false

  // switchActiveAthlete limpia la selección persistida al volver al self.
  return switchActiveAthlete(user.id, selfId)
}

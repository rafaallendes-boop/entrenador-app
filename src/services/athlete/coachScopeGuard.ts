import { getActiveAthleteId, getSelfAthleteId } from './activeAthlete'
import { isCoachAccount } from './coachAccess'
import { switchActiveAthlete } from './switchActiveAthlete'

/**
 * Defensa de rollback (spec 2b §2): hydrateActiveAthlete respeta una selección
 * persistida válida sin consultar la allowlist. Si la cuenta dejó de ser coach
 * (VITE_COACH_ACCOUNTS removida) con un gestionado activo, este guard fuerza
 * el retorno al self y limpia la selección. Retorna true si intervino.
 */
export async function enforceCoachScopeGuard(
  user: { id: string; email?: string | null } | null | undefined,
  rawAllowlist?: string,
): Promise<boolean> {
  if (!user?.id) return false
  if (isCoachAccount(user, rawAllowlist)) return false

  const active = getActiveAthleteId()
  const selfId = getSelfAthleteId()
  if (!selfId || !active || active === selfId) return false

  // switchActiveAthlete limpia la selección persistida al volver al self.
  return switchActiveAthlete(user.id, selfId)
}

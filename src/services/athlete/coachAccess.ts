import { getAccountRole } from '../entitlements/accountRoleHolder'
import type { ResolvedAccountRole } from '../entitlements/entitlementPolicy'

/**
 * Gate de **UI** del modo coach. NO es una barrera de seguridad: la barrera
 * real es la RLS por membresía (`031`) y la autorización del servidor
 * (`resolveCapability`). Que alguien vea la UI no le da acceso a ningún dato.
 *
 * Desde la Entrega 2 hay dos fuentes, en este orden:
 *
 *  1. **`account_role === 'coach'`**, el criterio definitivo. Lo introdujo la
 *     Entrega 1a: el rol ya viaja en el espejo de entitlements y gobierna el
 *     scope de lectura/escritura; acá pasa a gobernar también la UI.
 *  2. **La allowlist de email (`VITE_COACH_ACCOUNTS`), como puente.** La cuenta
 *     del owner es híbrida a propósito —rol `athlete` con self más gestionados,
 *     decisión registrada en la Task 8 de 1a—, así que exigir rol coach hoy la
 *     dejaría fuera de su propio Coach Workspace.
 *
 * **Pendiente explícito:** cuando exista y se pruebe la cuenta coach
 * definitiva, el gate pasa a ser sólo por rol y `VITE_COACH_ACCOUNTS` se
 * elimina junto con `parseCoachAllowlist`. Ver §6 del roadmap.
 *
 * `unknown` no habilita: hasta que una lectura remota confirme identidad, la
 * UI de coach no se muestra. Para **revocar** un scope ya elegido rige lo
 * contrario — ver `enforceCoachScopeGuard`.
 */
export function parseCoachAllowlist(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

export function isCoachAccount(
  user: { email?: string | null } | null | undefined,
  rawAllowlist: string | undefined = import.meta.env.VITE_COACH_ACCOUNTS as string | undefined,
  accountRole: ResolvedAccountRole = getAccountRole(),
): boolean {
  if (!user) return false
  // El rol no depende del email: una cuenta coach creada por RPC puede no
  // tenerlo, y la allowlist la dejaría fuera de su propia UI.
  if (accountRole === 'coach') return true

  const email = user.email?.trim().toLowerCase()
  if (!email) return false
  return parseCoachAllowlist(rawAllowlist).includes(email)
}

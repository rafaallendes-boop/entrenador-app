/**
 * Allowlist de operación. Server-only a propósito: una variable `VITE_*` viaja
 * dentro del bundle público, que es exactamente el error que `VITE_COACH_ACCOUNTS`
 * ya cometió una vez.
 *
 * Sólo UUID. Un email en la lista no autoriza a nadie: el identificador estable
 * de una cuenta de Supabase es su `id`, y el email puede cambiar.
 *
 * Fail-closed: variable ausente, vacía o ilegible ⇒ nadie es admin.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isOperationsAdmin(
  userId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const normalizedUserId = userId.trim().toLowerCase()
  if (!UUID_PATTERN.test(normalizedUserId)) return false

  const raw = env['OPERATIONS_ADMIN_USER_IDS']
  if (typeof raw !== 'string' || raw.trim().length === 0) return false

  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    // Defensa deliberada e inobservable por construcción: si llegamos hasta acá,
    // `normalizedUserId` ya pasó el guard de UUID de arriba, así que ninguna entrada
    // basura podría igualarlo de todos modos y este filtro no cambia ningún resultado
    // hoy. Se conserva para el día en que ese guard se relaje (p. ej. si se acepta un
    // `userId` no normalizado antes de llegar acá): en ese escenario deja de ser
    // redundante y pasa a ser la única defensa contra entradas no-UUID en la lista.
    .filter((entry) => UUID_PATTERN.test(entry))
    .includes(normalizedUserId)
}

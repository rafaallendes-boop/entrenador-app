import type { ResolvedAccountRole } from '../entitlements/entitlementPolicy'

/** Scope efectivo de la sesión; `none` es conjunto vacío y falla cerrado. */
export type AthleteScopeKind = 'self' | 'managed' | 'none'

/**
 * Sólo evidencia POSITIVA de rol coach cierra el scope. Un rol ilegible
 * (`unknown`) se comporta como `athlete`.
 *
 * El razonamiento: este scope es un filtro de LECTURA local, no la frontera de
 * seguridad —esa es la RLS del servidor, que decide con el rol real del JWT—.
 * Cerrarlo ante `unknown` deja la app entera en blanco en el arranque offline y
 * para cualquier cuenta sin fila en `user_entitlements`, que hoy son casi
 * todas, porque una ausencia confirmada borra el espejo local. Es el mismo
 * criterio de compatibilidad que ya aplican `readEntitlementRecordPre028` y la
 * ausencia confirmada de fila: sin roles no hay coaches, y toda cuenta es
 * atleta.
 *
 * La invariante que importa —un coach nunca adopta filas legacy/unscoped—
 * queda intacta: para que una cuenta coach tuviera filas legacy tendría que
 * haber sido atleta antes en ese mismo dispositivo, y ninguna entrega hasta 1b
 * cambia el rol de una cuenta existente.
 */
export function resolveAthleteScopeKind(input: {
  accountRole: ResolvedAccountRole
  activeAthleteId: string | null
  selfAthleteId: string | null
}): AthleteScopeKind {
  if (input.accountRole === 'coach') {
    // Un coach no tiene self. Antes de resolver su selección no puede adoptar
    // el singleton legacy de ninguna cuenta.
    return input.activeAthleteId == null ? 'none' : 'managed'
  }

  // Compatibilidad exacta para la cuenta atleta, incluida la pre-hidratación.
  if (input.activeAthleteId == null) return 'self'
  return input.activeAthleteId === input.selfAthleteId ? 'self' : 'managed'
}

/** Las filas legacy/unscoped pertenecen exclusivamente al self. */
export function canAdoptLegacyRows(kind: AthleteScopeKind): boolean {
  return kind === 'self'
}

/**
 * ¿Esta cuenta es dueña de las filas legacy/unscoped? Sólo un coach
 * CONFIRMADO no lo es. Un rol ilegible sigue el camino de `athlete`, por la
 * misma razón que `resolveAthleteScopeKind`.
 *
 * Es la autoridad única del predicado: lo consultan el bootstrap (backfill de
 * scope y migración a la nube) y los re-syncs de `App.tsx`. Tenerlo acá evita
 * que esas copias se desincronicen.
 */
export function roleOwnsLegacySelfData(role: ResolvedAccountRole): boolean {
  return role !== 'coach'
}

import { db } from '../../db/db'
import type { StoredEntitlement } from '../../types/entitlement'
import { supabase } from '../auth'
import { USER_ENTITLEMENT_SELECT } from './entitlementColumns'
import {
  isTier,
  parseAccountRole,
  resolveTier,
  type AccountRole,
  type ResolvedAccountRole,
  type Tier,
} from './entitlementPolicy'

const TABLE = 'user_entitlements'

type RemoteEntitlementRead =
  | { ok: true; row: StoredEntitlement; accountRole: AccountRole }
  | { ok: true; row: null; accountRole: 'athlete' | 'unknown' }
  | { ok: false; row: null; accountRole: 'unknown' }

/** PostgREST reporta así una columna que el esquema todavía no tiene. */
function isUndefinedColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return code === '42703' || code === 'PGRST204'
}

/** Lectura con el contrato previo a `028`: sin rol, todos son `athlete`. */
async function fetchRemoteEntitlementPre028(
  userId: string,
): Promise<RemoteEntitlementRead> {
  if (!supabase) return { ok: false, row: null, accountRole: 'unknown' }
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('user_id, tier, expires_at')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) return { ok: false, row: null, accountRole: 'unknown' }
    if (!data) return { ok: true, row: null, accountRole: 'athlete' }

    const raw = data as { tier?: unknown; expires_at?: unknown }
    if (!isTier(raw.tier)) return { ok: true, row: null, accountRole: 'unknown' }
    const expires = parseExpiresAt(raw.expires_at)
    if (!expires.ok) return { ok: true, row: null, accountRole: 'unknown' }

    return {
      ok: true,
      accountRole: 'athlete',
      row: {
        userId,
        tier: raw.tier,
        expiresAt: expires.value,
        confirmedAt: Date.now(),
        accountRole: 'athlete',
      },
    }
  } catch {
    return { ok: false, row: null, accountRole: 'unknown' }
  }
}

/**
 * Misma semántica fail-closed que el helper de servidor: un vencimiento
 * ilegible NO es "sin vencimiento". Se reimplementa acá en vez de importarse
 * desde `netlify/` para no arrastrar código de Functions al bundle del cliente.
 */
function parseExpiresAt(
  value: unknown,
): { ok: true; value: number | null } | { ok: false } {
  if (value === null) return { ok: true, value: null }
  if (typeof value !== 'string' || value.length === 0) return { ok: false }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? { ok: false } : { ok: true, value: parsed }
}

/**
 * `ok` distingue "el servidor respondió" de "no pude leer". Esa distinción
 * permite borrar el espejo ante ausencia confirmada y conservarlo ante red mala.
 */
export async function fetchRemoteEntitlement(
  userId: string,
): Promise<RemoteEntitlementRead> {
  if (!supabase) return { ok: false, row: null, accountRole: 'unknown' }

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(USER_ENTITLEMENT_SELECT)
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      // `028` todavía no aplicada: el select entero falla por la columna
      // ausente y con él se perdería el tier. En el mundo previo a `028` no
      // hay roles y toda cuenta es atleta — misma regla de compatibilidad que
      // la ausencia confirmada de fila. Se reintenta con el contrato anterior
      // para que el bundle no exija la migración.
      if (isUndefinedColumnError(error)) return fetchRemoteEntitlementPre028(userId)
      return { ok: false, row: null, accountRole: 'unknown' }
    }
    // Ausencia confirmada conserva la compatibilidad de tier y de rol: las
    // cuentas anteriores a 028 son atletas, pero un espejo viejo nunca basta
    // para llegar a esa conclusión por sí solo.
    if (!data) return { ok: true, row: null, accountRole: 'athlete' }

    const raw = data as { tier?: unknown; expires_at?: unknown; account_role?: unknown }
    if (!isTier(raw.tier)) return { ok: true, row: null, accountRole: 'unknown' }

    const expires = parseExpiresAt(raw.expires_at)
    // Una fecha ilegible nunca puede transformarse en acceso sin vencimiento.
    if (!expires.ok) return { ok: true, row: null, accountRole: 'unknown' }

    const accountRole = parseAccountRole(raw.account_role)
    // Una fila presente sin rol válido es una identidad ilegible, no la
    // ausencia confirmada que resuelve `athlete` por compatibilidad.
    if (accountRole == null) return { ok: true, row: null, accountRole: 'unknown' }

    return {
      ok: true,
      accountRole,
      row: {
        userId,
        tier: raw.tier,
        expiresAt: expires.value,
        confirmedAt: Date.now(),
        accountRole,
      },
    }
  } catch {
    return { ok: false, row: null, accountRole: 'unknown' }
  }
}

/**
 * Un espejo se usa sólo como evidencia temporal durante la hidratación. Las
 * filas escritas antes de account_role —o una fila corrupta— no pueden abrir
 * scope de atleta por omisión.
 */
export function readStoredEntitlementRole(
  stored: StoredEntitlement | null | undefined,
): ResolvedAccountRole {
  if (!stored) return 'unknown'
  return parseAccountRole((stored as { accountRole?: unknown }).accountRole) ?? 'unknown'
}

export async function readMirroredEntitlementRole(userId: string): Promise<ResolvedAccountRole> {
  try {
    const stored = await db.entitlements.get(userId)
    if (!stored || stored.userId !== userId) return 'unknown'
    return readStoredEntitlementRole(stored)
  } catch {
    return 'unknown'
  }
}

/**
 * Reconcilia los tres resultados autoritativos:
 *  - fila presente: escribe el espejo;
 *  - ausencia confirmada: borra el espejo;
 *  - fallo de lectura: conserva el espejo.
 */
export async function hydrateEntitlement(
  userId: string,
  now: number = Date.now(),
): Promise<{ ok: boolean; tier: Tier; accountRole: ResolvedAccountRole }> {
  const remote = await fetchRemoteEntitlement(userId)

  if (!remote.ok) {
    // El espejo es la MISMA evidencia para tier y para rol. Degradar sólo el
    // rol a `unknown` deja la sesión offline con tier resuelto pero scope
    // vacío: `isSelfScopeActive()` devuelve false y toda lectura local
    // (sesiones, day logs, perfil) responde vacío en una app local-first.
    // Un espejo sin rol —escrito antes de 028— sigue resolviendo `unknown`.
    const [mirrored, mirroredRole] = await Promise.all([
      readMirroredTier(userId, now),
      readMirroredEntitlementRole(userId),
    ])
    return { ok: false, tier: mirrored ?? 'free', accountRole: mirroredRole }
  }

  try {
    if (remote.row) {
      await db.entitlements.put(remote.row)
      return { ok: true, tier: resolveTier(remote.row, now), accountRole: remote.accountRole }
    }

    await db.entitlements.delete(userId)
    return { ok: true, tier: 'free', accountRole: remote.accountRole }
  } catch {
    // La lectura remota SÍ resolvió el rol; lo que falló fue escribir el
    // espejo. Perder esa identidad cerraría el scope por un fallo de Dexie.
    return { ok: false, tier: 'free', accountRole: remote.accountRole }
  }
}

/** `null` significa "no hay espejo", que no es lo mismo que `free`. */
export async function readMirroredTier(
  userId: string,
  now: number = Date.now(),
): Promise<Tier | null> {
  try {
    const row = await db.entitlements.get(userId)
    if (!row || row.userId !== userId) return null
    return resolveTier(row, now)
  } catch {
    return null
  }
}

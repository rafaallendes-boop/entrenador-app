import { db } from '../../db/db'
import type { StoredEntitlement } from '../../types/entitlement'
import { supabase } from '../auth'
import { USER_ENTITLEMENT_SELECT } from './entitlementColumns'
import { isTier, resolveTier, type Tier } from './entitlementPolicy'

const TABLE = 'user_entitlements'

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
): Promise<{ ok: boolean; row: StoredEntitlement | null }> {
  if (!supabase) return { ok: false, row: null }

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select(USER_ENTITLEMENT_SELECT)
      .eq('user_id', userId)
      .maybeSingle()

    if (error) return { ok: false, row: null }
    if (!data) return { ok: true, row: null }

    const raw = data as { tier?: unknown; expires_at?: unknown }
    if (!isTier(raw.tier)) return { ok: true, row: null }

    const expires = parseExpiresAt(raw.expires_at)
    // Una fecha ilegible nunca puede transformarse en acceso sin vencimiento.
    if (!expires.ok) return { ok: true, row: null }

    return {
      ok: true,
      row: {
        userId,
        tier: raw.tier,
        expiresAt: expires.value,
        confirmedAt: Date.now(),
      },
    }
  } catch {
    return { ok: false, row: null }
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
): Promise<{ ok: boolean; tier: Tier }> {
  const remote = await fetchRemoteEntitlement(userId)

  if (!remote.ok) {
    const mirrored = await readMirroredTier(userId, now)
    return { ok: false, tier: mirrored ?? 'free' }
  }

  try {
    if (remote.row) {
      await db.entitlements.put(remote.row)
      return { ok: true, tier: resolveTier(remote.row, now) }
    }

    await db.entitlements.delete(userId)
    return { ok: true, tier: 'free' }
  } catch {
    return { ok: false, tier: 'free' }
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

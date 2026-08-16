import {
  resolveTier,
  type EntitlementRow,
  type Tier,
} from '../../../src/services/entitlements/entitlementPolicy'
import { USER_ENTITLEMENT_SELECT } from '../../../src/services/entitlements/entitlementColumns'

const READ_TIMEOUT_MS = 3_000

/**
 * Flag de servidor, runtime. Apagado = comportamiento previo al gate.
 * Solo la cadena exacta 'true' enciende: cualquier otra cosa es apagado, para
 * que un valor mal tipeado no active un gate a medias.
 */
export function isEntitlementEnforcementEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env['ENTITLEMENTS_ENABLED'] === 'true'
}

/**
 * Tres resultados distintos, y colapsarlos rompe el fail-closed:
 *  - `{ ok: true, value: null }`   → ausente = sin vencimiento (legítimo)
 *  - `{ ok: true, value: number }` → vencimiento parseado
 *  - `{ ok: false }`               → presente pero ilegible → tratar como free
 *
 * Devolver `null` ante un valor inválido significaría "sin vencimiento", que es
 * lo más permisivo posible: exactamente al revés de lo que queremos.
 */
export function parseExpiresAt(
  value: unknown,
): { ok: true; value: number | null } | { ok: false } {
  if (value == null) return { ok: true, value: null }
  if (typeof value !== 'string' || value.length === 0) return { ok: false }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? { ok: false } : { ok: true, value: parsed }
}

/**
 * Lee el tier con el token del usuario. RLS filtra por auth.uid(), así que no
 * hace falta conocer el userId de antemano — lo que permite correr esta lectura
 * en Promise.all con la verificación de auth.
 *
 * Fail-closed literal: cualquier error devuelve 'free'. Nunca lanza.
 */
export async function resolveEntitlementTier(
  token: string,
  now: number = Date.now(),
): Promise<Tier> {
  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL']
  const anonKey = process.env['SUPABASE_ANON_KEY'] ?? process.env['VITE_SUPABASE_ANON_KEY']
  if (!url || !anonKey) return 'free'

  try {
    const endpoint = `${url.replace(/\/$/, '')}/rest/v1/user_entitlements`
      + `?select=${encodeURIComponent(USER_ENTITLEMENT_SELECT)}&limit=1`

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
    if (!response.ok) return 'free'

    const body = await response.json().catch(() => null)
    if (!Array.isArray(body) || body.length === 0) return 'free'

    const raw = body[0] as { tier?: unknown; expires_at?: unknown }
    const expires = parseExpiresAt(raw.expires_at)
    if (!expires.ok) return 'free'

    const row: EntitlementRow = {
      tier: raw.tier as Tier,
      expiresAt: expires.value,
    }
    return resolveTier(row, now)
  } catch {
    return 'free'
  }
}

import {
  parseAccountRole,
  resolveTier,
  type AccountRole,
  type EntitlementRow,
  type Tier,
} from '../../../src/services/entitlements/entitlementPolicy'
import type { VerifiedMembership } from '../../../src/services/entitlements/resolveCapability'
import {
  resolveCapability,
  type CapabilityDecision,
} from '../../../src/services/entitlements/resolveCapability'
import { USER_ENTITLEMENT_SELECT } from '../../../src/services/entitlements/entitlementColumns'
import {
  buildEntitlementDetail,
  formatEntitlementMessage,
} from '../../../src/services/entitlements/entitlementError'

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
 * Resultado de leer `user_entitlements` con el token del usuario, discriminado
 * en tres estados en vez de colapsar todo a "sin fila":
 *  - `present`   → fila legible, con tier y rol resueltos.
 *  - `absent`    → ausencia CONFIRMADA (la consulta respondió 0 filas).
 *  - `unreadable` → no se pudo determinar nada (red, HTTP, parseo, forma).
 *
 * Colapsar `absent` y `unreadable` es correcto para el TIER —`free` es el
 * menos capaz en cualquiera de los dos casos— pero no lo es para el ROL: ver
 * `ResolvedAccountRole` en `entitlementPolicy.ts` (§5.1).
 */
export type EntitlementReadResult =
  | { status: 'present'; row: EntitlementRow; accountRole: AccountRole }
  | { status: 'absent' }
  | { status: 'unreadable' }

/**
 * La ausencia de membresía y una lectura que falló son hechos distintos. La
 * primera deniega delegación; la segunda es infraestructura no verificable y
 * el borde HTTP debe responder 503, nunca disfrazarla como un 403.
 */
export type VerifiedMembershipReadResult =
  | { status: 'present'; membership: VerifiedMembership }
  | { status: 'absent' }
  | { status: 'unreadable' }

/**
 * Lee la fila de entitlement con el token del usuario. RLS filtra por
 * auth.uid(), así que no hace falta conocer el userId de antemano — lo que
 * permite correr esta lectura en Promise.all con la verificación de auth.
 *
 * Nunca lanza: cualquier fallo de red, HTTP o de forma del payload resuelve a
 * `{ status: 'unreadable' }`.
 */
/** Códigos con que PostgREST reporta una columna o tabla ausente. */
const UNDEFINED_COLUMN_CODES = new Set(['42703', 'PGRST204'])
const UNDEFINED_TABLE_CODES = new Set(['42P01', 'PGRST205'])

async function errorCodeOf(response: Response): Promise<string | null> {
  try {
    const parsed = await response.json() as { code?: unknown }
    return typeof parsed.code === 'string' ? parsed.code : null
  } catch {
    return null
  }
}

export async function readEntitlementRecord(token: string): Promise<EntitlementReadResult> {
  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL']
  const anonKey = process.env['SUPABASE_ANON_KEY'] ?? process.env['VITE_SUPABASE_ANON_KEY']
  if (!url || !anonKey) return { status: 'unreadable' }

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
    if (!response.ok) {
      // `028` todavía no aplicada: la columna no existe, así que el select
      // entero falla y con él se perdería también el TIER. En el mundo previo
      // a `028` no hay roles y toda cuenta es atleta, que es la misma regla de
      // compatibilidad que ya rige la ausencia confirmada de fila. Se reintenta
      // con el contrato anterior en vez de exigir la migración antes del
      // bundle.
      if (UNDEFINED_COLUMN_CODES.has(await errorCodeOf(response) ?? '')) {
        return readEntitlementRecordPre028(url, anonKey, token)
      }
      return { status: 'unreadable' }
    }

    const body = await response.json().catch(() => null)
    if (!Array.isArray(body)) return { status: 'unreadable' }
    if (body.length === 0) return { status: 'absent' }

    const raw = body[0] as { tier?: unknown; expires_at?: unknown; account_role?: unknown }
    const expires = parseExpiresAt(raw.expires_at)
    if (!expires.ok) return { status: 'unreadable' }

    const accountRole = parseAccountRole(raw.account_role)
    if (accountRole == null) return { status: 'unreadable' }

    return {
      status: 'present',
      row: { tier: raw.tier as Tier, expiresAt: expires.value },
      accountRole,
    }
  } catch {
    return { status: 'unreadable' }
  }
}

/** Lectura con el contrato previo a `028`: sin rol, todos son `athlete`. */
async function readEntitlementRecordPre028(
  url: string,
  anonKey: string,
  token: string,
): Promise<EntitlementReadResult> {
  try {
    const endpoint = `${url.replace(/\/$/, '')}/rest/v1/user_entitlements`
      + '?select=user_id%2Ctier%2Cexpires_at&limit=1'
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
    if (!response.ok) return { status: 'unreadable' }
    const body = await response.json().catch(() => null)
    if (!Array.isArray(body)) return { status: 'unreadable' }
    if (body.length === 0) return { status: 'absent' }

    const raw = body[0] as { tier?: unknown; expires_at?: unknown }
    const expires = parseExpiresAt(raw.expires_at)
    if (!expires.ok) return { status: 'unreadable' }
    return {
      status: 'present',
      row: { tier: raw.tier as Tier, expiresAt: expires.value },
      accountRole: 'athlete',
    }
  } catch {
    return { status: 'unreadable' }
  }
}

/**
 * Lee la membresía del actor para un atleta candidato. El token del actor es
 * imprescindible: la policy de `athlete_memberships` limita las filas a
 * `account_id = auth.uid()`, por lo que una fila presente ya está verificada.
 *
 * Nunca lanza. El llamador distingue `absent` de `unreadable` para no convertir
 * una caída de lectura en una denegación de autorización aparentemente normal.
 */
export async function readVerifiedMembership(
  token: string,
  athleteId: string,
): Promise<VerifiedMembershipReadResult> {
  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL']
  const anonKey = process.env['SUPABASE_ANON_KEY'] ?? process.env['VITE_SUPABASE_ANON_KEY']
  if (!url || !anonKey) return { status: 'unreadable' }

  try {
    const endpoint = `${url.replace(/\/$/, '')}/rest/v1/athlete_memberships`
      + `?select=athlete_id%2Crole&athlete_id=eq.${encodeURIComponent(athleteId)}&limit=2`
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
    if (!response.ok) {
      // `013b` todavía no aplicada: sin tabla no existe ninguna membresía, y
      // eso es una ausencia CONFIRMADA, no una lectura que falló. Sigue siendo
      // fail-closed —ausencia deniega la delegación— y evita que el bundle
      // exija la migración para no responder 503 en cada request.
      if (UNDEFINED_TABLE_CODES.has(await errorCodeOf(response) ?? '')) {
        return { status: 'absent' }
      }
      return { status: 'unreadable' }
    }

    const body = await response.json().catch(() => null)
    if (!Array.isArray(body)) return { status: 'unreadable' }
    if (body.length === 0) return { status: 'absent' }
    // La PK (athlete_id, account_id) y RLS permiten como máximo una fila. Más
    // de una es una respuesta que no sabemos interpretar con seguridad.
    if (body.length !== 1) return { status: 'unreadable' }

    const raw = body[0] as { athlete_id?: unknown; role?: unknown }
    if (raw.athlete_id !== athleteId) return { status: 'unreadable' }
    if (raw.role !== 'self' && raw.role !== 'coach') return { status: 'unreadable' }

    return {
      status: 'present',
      membership: { athleteId: raw.athlete_id, role: raw.role },
    }
  } catch {
    return { status: 'unreadable' }
  }
}

/**
 * Fail-closed literal: cualquier error devuelve 'free'. Nunca lanza.
 * Comportamiento idéntico al anterior; ahora se apoya en la lectura
 * discriminada. Colapsar ausencia y fallo es correcto para el TIER porque
 * `free` es el menos capaz; para el ROL no lo es (§5.1).
 */
export async function resolveEntitlementTier(
  token: string,
  now: number = Date.now(),
): Promise<Tier> {
  const result = await readEntitlementRecord(token)
  if (result.status !== 'present') return 'free'
  return resolveTier(result.row, now)
}

/** La clase que representa la generación de Plan Builder en ambas funciones. */
export const PLAN_GENERATION_REQUEST_CLASS = 'plan_builder_week' as const

export interface EntitlementHttpError extends Error {
  statusCode: number
  errorCode: 'entitlement_required'
  detail: ReturnType<typeof buildEntitlementDetail>
}

/**
 * Lanza un error con forma HTTP si el tier no alcanza para generar planes.
 * Cuando permite, devuelve la decisión completa que debe pasar sin
 * reinterpretarse hasta `usageGate`. Compartido por enqueue y worker para
 * que los dos rechacen y contabilicen de forma idéntica.
 */
export function assertPlanGenerationEntitlement(
  tier: Tier,
  actorUserId: string,
): CapabilityDecision {
  const decision = resolveCapability({
    actorUserId,
    targetAthleteId: null,
    capability: PLAN_GENERATION_REQUEST_CLASS,
    now: Date.now(),
    // `tier` ya fue resuelto por `resolveEntitlementTier`; no se debe volver
    // a interpretar vencimientos dentro de este borde.
    entitlement: { tier, expiresAt: null },
    // Esta entrega no cambia quién tiene acceso: Plan Builder sigue decidiendo
    // por tier, sin rol ni delegación.
    accountRole: 'athlete',
    membership: null,
    roleGate: 'off',
  })
  if (decision.allowed) return decision

  const requiredTier = decision.requiredTier ?? 'advanced'
  const detail = buildEntitlementDetail(PLAN_GENERATION_REQUEST_CLASS, requiredTier, decision.tier)
  const error = new Error(formatEntitlementMessage(detail)) as EntitlementHttpError
  error.statusCode = 403
  error.errorCode = 'entitlement_required'
  error.detail = detail
  throw error
}

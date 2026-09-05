# Separación del rol Coach — Entrega 1a (auditoría) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introducir rol de cuenta, scope explícito, autorización por membresía y cuota delegada, **sin cambiar todavía quién tiene acceso**, y producir la evidencia de equivalencia que habilita el corte de RLS de la Entrega 1b.

**Architecture:** Tres migraciones manuales (`028` rol, `029` cuota por sujeto, `030` invariantes de rol + RPC de alta/borrado) y un flag `COACH_AUTHZ_MODE` que corre en `audit`: se calculan **dos** decisiones —la legacy, que manda, y la nueva, que sólo se registra—. `resolveCapability` sigue siendo puro y recibe rol y membresía **ya verificados**.

**Tech Stack:** TypeScript, React, Vitest, Dexie, Supabase/PostgREST, Netlify Functions, plpgsql.

**Spec:** [`docs/superpowers/specs/2026-09-01-coach-role-separation-design.md`](../specs/2026-09-01-coach-role-separation-design.md)

## Global Constraints

- **Las migraciones remotas son de aplicación manual.** Ninguna task asume que una migración corrió.
- **Numeración:** `028` rol, `029` cuota por sujeto, `030` invariantes + RPC. `031` (corte) y `032` (rollback) quedan **reservadas para la Entrega 1b**.
- **Esta entrega no cambia quién tiene acceso.** Ninguna task retira una policy legacy ni transfiere datos.
- **`COACH_AUTHZ_MODE`:** sólo el literal `'enforce'` enciende el corte; cualquier otro valor es `'audit'`. En producción queda en `audit`.
- **La decisión efectiva en `audit` debe reproducir el comportamiento legacy EXACTAMENTE.** Si la efectiva aplicara el gate de rol, la auditoría no compararía nada.
- **`null` en `limit` significa "el plan no permite la clase", nunca `0`.**
- **El tope por atleta es estrictamente menor que el global.**
- **Orden del gate, no negociable:** `auth → kill switch → entitlement → spend cap → cuota → proveedor → costo`.
- **`resolveCapability` y `entitlementPolicy` son módulos puros.**
- **Ninguna cuenta cambia de rol en esta entrega.** La cuenta del owner es hoy híbrida (rol `athlete`, con self propio y gestionados a cargo) y marcarla `coach` encendería el scope coach del cliente, que es exactamente lo que 1a promete no cambiar. Por eso `030` impone sólo la mitad de la invariante —**una cuenta `coach` nunca tiene self**— y posterga el recíproco —**sólo un `coach` tiene gestionados**— a 1b/Entrega 2, mientras `admin_create_managed_athlete` sí lo exige internamente. Decisión del owner del 2026-09-02; detalle en la Task 8.
- **`REQUEST_CLASS_MIN_TIER` no se toca en esta entrega.** `coach_assistant_message` sigue en `'advanced'`; su gate de rol vive en la ruta role-aware y sólo se activa en `enforce`.
- Antes de commitear: `npm run lint && npm test && npx tsc -b && npm run build && git diff --check`. Línea base: **515 archivos / 4145 tests**.
- Commits: los hace el owner. Las tasks **no ejecutan `git commit`**.

---

### Task 1: `028` — `account_role`, guard de columnas y fixtures

**Files:**
- Create: `supabase/028_user_entitlement_account_role.sql`
- Modify: `src/services/entitlements/entitlementPolicy.ts`
- Modify: `src/services/entitlements/entitlementColumns.ts`
- Modify: `src/services/entitlements/__tests__/entitlementColumns.test.ts`
- Test: `src/services/entitlements/__tests__/accountRole.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `AccountRole = 'athlete' | 'coach'`; `ResolvedAccountRole = AccountRole | 'unknown'`; `parseAccountRole(value: unknown): AccountRole | null`; `'account_role'` en `USER_ENTITLEMENT_SELECT_COLUMNS`.

**Trampa verificada:** el guard existente lee **sólo** `supabase/020_user_entitlements.sql` y extrae el primer `grant select (...)`. Agregar la columna al código **rompe ese guard** si no se le enseña a mirar también `028`. Es exactamente lo que el guard debe hacer, y por eso se amplía en la misma task.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/services/entitlements/__tests__/accountRole.test.ts
import { describe, expect, it } from 'vitest'
import { parseAccountRole } from '../entitlementPolicy'
import { USER_ENTITLEMENT_SELECT_COLUMNS } from '../entitlementColumns'

describe('parseAccountRole', () => {
  it('acepta los dos roles persistidos', () => {
    expect(parseAccountRole('athlete')).toBe('athlete')
    expect(parseAccountRole('coach')).toBe('coach')
  })

  it('devuelve null para cualquier otra cosa, incluido "unknown"', () => {
    // `unknown` es un estado RESUELTO en runtime, nunca un valor persistido.
    for (const value of ['unknown', '', 'COACH', null, undefined, 0, {}]) {
      expect(parseAccountRole(value)).toBeNull()
    }
  })
})

describe('columnas del select', () => {
  it('pide account_role', () => {
    expect(USER_ENTITLEMENT_SELECT_COLUMNS).toContain('account_role')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/entitlements/__tests__/accountRole.test.ts`
Expected: FAIL — `parseAccountRole` no existe.

- [ ] **Step 3: Escribir la migración**

```sql
-- supabase/028_user_entitlement_account_role.sql
-- Rol de cuenta explícito (spec §5). El rol NO es un plan: `account_role` dice
-- qué producto usa la cuenta, `tier` dice cuánto puede hacer.
-- Aplicación manual.

begin;

alter table public.user_entitlements
  add column if not exists account_role text not null default 'athlete';

alter table public.user_entitlements
  drop constraint if exists user_entitlements_account_role_check;
alter table public.user_entitlements
  add constraint user_entitlements_account_role_check
  check (account_role in ('athlete','coach'));

-- Nunca `select *`: el grant es la lista exacta. `note` sigue fuera a propósito.
grant select (user_id, tier, expires_at, account_role)
  on public.user_entitlements to authenticated;

commit;

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Tipos, parser y columna**

En `entitlementPolicy.ts`, tras `export type Tier`:

```ts
/** Rol persistido. `unknown` NO se persiste: ver ResolvedAccountRole. */
export type AccountRole = 'athlete' | 'coach'

/**
 * Rol tal como lo ve el runtime. `unknown` es el resultado de un FALLO de
 * lectura, distinto de una ausencia confirmada de fila, que resuelve `athlete`
 * por compatibilidad (§5.1). Colapsarlos rompe el fail-closed: degradar
 * identidad CONCEDE capacidades de tier `free`, no sólo las quita.
 */
export type ResolvedAccountRole = AccountRole | 'unknown'

export function parseAccountRole(value: unknown): AccountRole | null {
  return value === 'athlete' || value === 'coach' ? value : null
}
```

En `entitlementColumns.ts`, agregar `'account_role'` al arreglo.

- [ ] **Step 5: Enseñarle al guard a mirar las dos migraciones**

En `src/services/entitlements/__tests__/entitlementColumns.test.ts`, reemplazar la lectura de un solo archivo por la unión de los grants de `020` y `028`:

```ts
const MIGRATIONS = ['supabase/020_user_entitlements.sql', 'supabase/028_user_entitlement_account_role.sql']

function grantedColumns(): string[] {
  const granted = new Set<string>()
  for (const file of MIGRATIONS) {
    const sql = readFileSync(resolve(process.cwd(), file), 'utf8')
    // Un archivo puede traer más de un `grant select (...)`: se toman todos, y
    // el último gana en Postgres, así que la UNIÓN es la cota superior segura.
    for (const match of sql.matchAll(/grant select \(([^)]+)\)/gi)) {
      for (const col of match[1].split(',')) granted.add(col.trim())
    }
  }
  return [...granted]
}
```

Conservar el caso que fija que `note` **no** está en ningún grant.

- [ ] **Step 6: Actualizar los fixtures**

Buscar los fixtures que construyen filas de `user_entitlements` y agregarles `account_role: 'athlete'`:

Run: `grep -rln "expires_at" src netlify --include='*.test.ts' --include='*.test.tsx' | xargs grep -ln "tier"`
Expected: cada archivo listado se revisa; los que arman una fila remota completa reciben la clave nueva. Un fixture sin `account_role` hará que `readEntitlementRecord` (Task 2) devuelva `unreadable`, así que esto no es cosmético.

- [ ] **Step 7: Correr y verificar que pasan**

Run: `npx vitest run src/services/entitlements`
Expected: PASS, incluido el guard ampliado.

---

### Task 2: Lectura discriminada del rol en servidor

**Files:**
- Modify: `netlify/functions/_shared/resolveEntitlement.ts`
- Test: `netlify/functions/_shared/__tests__/readEntitlementRecord.test.ts`

**Interfaces:**
- Consumes: `parseAccountRole`, `USER_ENTITLEMENT_SELECT` (Task 1).
- Produces: `EntitlementReadResult = { status: 'present'; row: EntitlementRow; accountRole: AccountRole } | { status: 'absent' } | { status: 'unreadable' }`; `readEntitlementRecord(token: string): Promise<EntitlementReadResult>`. `resolveEntitlementTier` conserva firma y comportamiento.

**Por qué.** `resolveEntitlementTier` declara *"Fail-closed literal: cualquier error devuelve 'free'. Nunca lanza"*. Para el tier es correcto —`free` es el menos capaz—. Para el rol no: un coach degradado a `athlete` queda **habilitado** para `chat_general` e `import_extract`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// netlify/functions/_shared/__tests__/readEntitlementRecord.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readEntitlementRecord, resolveEntitlementTier } from '../resolveEntitlement'

const OLD_ENV = { ...process.env }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function mockFetch(impl: () => Promise<Response> | Response) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

beforeEach(() => {
  process.env['SUPABASE_URL'] = 'https://example.supabase.co'
  process.env['SUPABASE_ANON_KEY'] = 'anon'
})
afterEach(() => { vi.unstubAllGlobals(); process.env = { ...OLD_ENV } })

describe('readEntitlementRecord', () => {
  it('fila presente devuelve tier y rol', async () => {
    mockFetch(() => json([{ tier: 'advanced', expires_at: null, account_role: 'coach' }]))
    expect(await readEntitlementRecord('t')).toEqual({
      status: 'present', row: { tier: 'advanced', expiresAt: null }, accountRole: 'coach',
    })
  })

  it('cero filas es ausencia CONFIRMADA, no fallo', async () => {
    mockFetch(() => json([]))
    expect(await readEntitlementRecord('t')).toEqual({ status: 'absent' })
  })

  it('respuesta no-ok es fallo de lectura', async () => {
    mockFetch(() => new Response('boom', { status: 500 }))
    expect(await readEntitlementRecord('t')).toEqual({ status: 'unreadable' })
  })

  it('error de red es fallo de lectura y no lanza', async () => {
    mockFetch(() => { throw new Error('network') })
    expect(await readEntitlementRecord('t')).toEqual({ status: 'unreadable' })
  })

  it('account_role fuera de la unión es fallo, NO athlete', async () => {
    mockFetch(() => json([{ tier: 'free', expires_at: null, account_role: 'wat' }]))
    expect(await readEntitlementRecord('t')).toEqual({ status: 'unreadable' })
  })

  it('expires_at ilegible es fallo de lectura', async () => {
    mockFetch(() => json([{ tier: 'advanced', expires_at: 'no-es-fecha', account_role: 'athlete' }]))
    expect(await readEntitlementRecord('t')).toEqual({ status: 'unreadable' })
  })
})

describe('resolveEntitlementTier no cambia', () => {
  it('ausencia confirmada sigue dando free', async () => {
    mockFetch(() => json([]))
    expect(await resolveEntitlementTier('t')).toBe('free')
  })
  it('fallo de lectura sigue dando free y sin lanzar', async () => {
    mockFetch(() => { throw new Error('network') })
    expect(await resolveEntitlementTier('t')).toBe('free')
  })
  it('fila vencida sigue dando free', async () => {
    const past = new Date(Date.now() - 1000).toISOString()
    mockFetch(() => json([{ tier: 'advanced', expires_at: past, account_role: 'athlete' }]))
    expect(await resolveEntitlementTier('t')).toBe('free')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run netlify/functions/_shared/__tests__/readEntitlementRecord.test.ts`
Expected: FAIL — `readEntitlementRecord` no existe.

- [ ] **Step 3: Implementar**

```ts
export type EntitlementReadResult =
  | { status: 'present'; row: EntitlementRow; accountRole: AccountRole }
  | { status: 'absent' }
  | { status: 'unreadable' }

export async function readEntitlementRecord(token: string): Promise<EntitlementReadResult> {
  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL']
  const anonKey = process.env['SUPABASE_ANON_KEY'] ?? process.env['VITE_SUPABASE_ANON_KEY']
  if (!url || !anonKey) return { status: 'unreadable' }
  try {
    const endpoint = `${url.replace(/\/$/, '')}/rest/v1/user_entitlements`
      + `?select=${encodeURIComponent(USER_ENTITLEMENT_SELECT)}&limit=1`
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    })
    if (!response.ok) return { status: 'unreadable' }
    const body = await response.json().catch(() => null)
    if (!Array.isArray(body)) return { status: 'unreadable' }
    if (body.length === 0) return { status: 'absent' }
    const raw = body[0] as { tier?: unknown; expires_at?: unknown; account_role?: unknown }
    const expires = parseExpiresAt(raw.expires_at)
    if (!expires.ok) return { status: 'unreadable' }
    const accountRole = parseAccountRole(raw.account_role)
    if (accountRole == null) return { status: 'unreadable' }
    return { status: 'present', row: { tier: raw.tier as Tier, expiresAt: expires.value }, accountRole }
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
export async function resolveEntitlementTier(token: string, now: number = Date.now()): Promise<Tier> {
  const result = await readEntitlementRecord(token)
  if (result.status !== 'present') return 'free'
  return resolveTier(result.row, now)
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run netlify/functions/_shared src/services/entitlements`
Expected: PASS. Los tests preexistentes de `resolveEntitlementTier` deben pasar **sin modificarse**.

---

### Task 3: `perSubjectLimits` y cuota del bucket `coach_assistant`

**Files:**
- Modify: `src/services/entitlements/quotaBuckets.ts`
- Test: `src/services/entitlements/__tests__/perSubjectLimits.test.ts`

**Interfaces:**
- Consumes: `QuotaBucket`, `Tier`.
- Produces: `QuotaBucket.perSubjectLimits?`; `perSubjectLimitForTier(bucket, tier): number | null`; `bucketLimitIgnoringTierGate(bucket, tier): number | null`.

**Dos cosas, no una.** El bucket `coach_assistant` declara hoy sólo `{ advanced: 20 }`. Cuando la ruta role-aware habilite la clase para un coach con tier `free` o `weekly` (Task 4), su cuota resolvería `null` y la denegaría por la puerta de atrás. Necesita límites en los tres tiers, y una resolución que no pase por el gate de tier.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/services/entitlements/__tests__/perSubjectLimits.test.ts
import { describe, expect, it } from 'vitest'
import {
  QUOTA_BUCKETS, bucketForClass, bucketLimitForTier,
  bucketLimitIgnoringTierGate, perSubjectLimitForTier,
} from '../quotaBuckets'
import { TIER_ORDER, type Tier } from '../entitlementPolicy'

const TIERS = Object.keys(TIER_ORDER) as Tier[]

describe('perSubjectLimitForTier', () => {
  it('null cuando el bucket no declara tope por atleta', () => {
    expect(perSubjectLimitForTier({ id: 'x', classes: ['chat_general'], limits: { free: 5 } }, 'free')).toBeNull()
  })
  it('null cuando el tier no puede usar ninguna clase del bucket', () => {
    const b = { id: 'x', classes: ['plan_builder_week'] as const, limits: { advanced: 10 }, perSubjectLimits: { advanced: 4 } }
    expect(perSubjectLimitForTier(b, 'free')).toBeNull()
  })
})

describe('coach_assistant tiene cuota en los tres tiers', () => {
  it('un coach con tier free resuelve un límite, no null', () => {
    // La clase se habilita por ROL, no por tier: si el bucket sólo declarara
    // `advanced`, un coach Free quedaría denegado por falta de cuota.
    const bucket = bucketForClass('coach_assistant_message')
    expect(bucket).not.toBeNull()
    for (const tier of TIERS) {
      expect(bucketLimitIgnoringTierGate(bucket!, tier)).toBeGreaterThan(0)
    }
  })
})

describe('invariantes de configuración', () => {
  it('todo tope por atleta es ESTRICTAMENTE menor que el global de su tier', () => {
    for (const bucket of QUOTA_BUCKETS) {
      for (const tier of TIERS) {
        const perSubject = perSubjectLimitForTier(bucket, tier)
        if (perSubject == null) continue
        const global = bucketLimitForTier(bucket, tier)
        expect(global).not.toBeNull()
        expect(perSubject).toBeGreaterThan(0)
        expect(perSubject).toBeLessThan(global as number)
      }
    }
  })
  it('ningún tope por atleta es 0: la ausencia se expresa omitiendo la clave', () => {
    for (const bucket of QUOTA_BUCKETS) {
      for (const value of Object.values(bucket.perSubjectLimits ?? {})) {
        expect(value).toBeGreaterThan(0)
      }
    }
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/entitlements/__tests__/perSubjectLimits.test.ts`
Expected: FAIL — `perSubjectLimitForTier` no existe.

- [ ] **Step 3: Implementar**

```ts
export interface QuotaBucket {
  id: string
  classes: readonly AIRequestClass[]
  limits: Partial<Record<Tier, number>>
  /**
   * Tope adicional del par (coach, atleta) cuando la capacidad se ejerce por
   * delegación. Omitir la clave = sin tope; NUNCA 0. Estrictamente menor que
   * `limits` del mismo tier. Provisional hasta la Fase 0, igual que `limits`.
   */
  perSubjectLimits?: Partial<Record<Tier, number>>
}
```

```ts
export function perSubjectLimitForTier(bucket: QuotaBucket, tier: Tier): number | null {
  if (!bucket.classes.some((cls) => isClassAllowed(tier, cls))) return null
  return bucket.perSubjectLimits?.[tier] ?? null
}

/**
 * Límite del bucket SIN consultar el gate de tier. Es para las clases cuyo
 * requisito real es el ROL (§5.3): su entrada en REQUEST_CLASS_MIN_TIER sigue
 * en `advanced` para no alterar la ruta legacy, así que `bucketLimitForTier`
 * devolvería `null` para un coach Free y lo denegaría por falta de cuota.
 * NO usar para clases gateadas por tier.
 */
export function bucketLimitIgnoringTierGate(bucket: QuotaBucket, tier: Tier): number | null {
  return bucket.limits[tier] ?? null
}
```

Actualizar los literales. Aritmética a la vista: un coach no debe poder gastar su día entero en un solo alumno, y con 3–5 alumnos un tercio del global deja holgura.

```ts
  { id: 'chat', classes: ['chat_general', 'chat_action'], limits: { free: 15, weekly: 40, advanced: 120 }, perSubjectLimits: { weekly: 15, advanced: 40 } },
  { id: 'week_creator', classes: ['week_creator'], limits: { weekly: 3, advanced: 8 }, perSubjectLimits: { advanced: 3 } },
  // Gateado por ROL, no por tier: los tres valores existen para que un coach
  // con cualquier tier tenga cuota resoluble.
  { id: 'coach_assistant', classes: ['coach_assistant_message'], limits: { free: 20, weekly: 20, advanced: 20 } },
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run src/services/entitlements`
Expected: PASS.

- [ ] **Step 5: Verificar que el guard no es vacuo**

Poner `perSubjectLimits: { advanced: 120 }` en el bucket `chat` (igual al global): el test debe FALLAR en "estrictamente menor". Revertir.

---

### Task 4: `resolveCapability` con `roleGate`, membresía verificada y `quotaSubject`

**Files:**
- Modify: `src/services/entitlements/resolveCapability.ts`
- Modify: `src/services/entitlements/entitlementPolicy.ts`
- Modify: `src/hooks/useEntitlement.ts`
- Modify: `netlify/functions/_shared/resolveEntitlement.ts:113`
- Modify: `netlify/functions/coach.ts:1926`
- Test: `src/services/entitlements/__tests__/resolveCapabilityDelegation.test.ts`

**Interfaces:**
- Consumes: `ResolvedAccountRole` (Task 1); `perSubjectLimitForTier`, `bucketLimitIgnoringTierGate` (Task 3); `MembershipRole` de `src/types` (ya existe).
- Produces: `ResolveCapabilityInput` con `accountRole`, `membership` y `roleGate: 'off' | 'on'`; `CapabilityDecision` con `entitlementSource: 'self' | 'coach'` y `quotaSubject`; `CLASS_REQUIRES_COACH_ROLE`.

**`roleGate` es lo que hace posible la auditoría.** Con `'off'` la función reproduce el comportamiento **legacy exacto**: sin rol, sin delegación, `coach_assistant_message` exigiendo `advanced`. Con `'on'` aplica las reglas nuevas. La auditoría (Task 11) llama a las dos y compara. Sin este parámetro, la "decisión efectiva" ya incluiría el gate nuevo y no habría nada que comparar.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/services/entitlements/__tests__/resolveCapabilityDelegation.test.ts
import { describe, expect, it } from 'vitest'
import { resolveCapability } from '../resolveCapability'

const NOW = 1_700_000_000_000
const ADVANCED = { tier: 'advanced' as const, expiresAt: null }
const FREE = { tier: 'free' as const, expiresAt: null }

function decide(over: Partial<Parameters<typeof resolveCapability>[0]> = {}) {
  return resolveCapability({
    actorUserId: 'user-1', targetAthleteId: null, capability: 'chat_general',
    now: NOW, entitlement: ADVANCED, accountRole: 'athlete', membership: null,
    roleGate: 'on', ...over,
  })
}

describe('roleGate off reproduce el comportamiento legacy', () => {
  it('ignora el rol por completo', () => {
    expect(decide({ roleGate: 'off', accountRole: 'unknown' }).allowed).toBe(true)
    expect(decide({ roleGate: 'off', accountRole: 'coach' }).allowed).toBe(true)
  })

  it('coach_assistant_message sigue exigiendo advanced y NO rol', () => {
    expect(decide({ roleGate: 'off', capability: 'coach_assistant_message', accountRole: 'athlete', entitlement: ADVANCED }).allowed).toBe(true)
    expect(decide({ roleGate: 'off', capability: 'coach_assistant_message', accountRole: 'coach', entitlement: FREE }).allowed).toBe(false)
  })

  it('nunca delega, aunque le pasen objetivo y membresía', () => {
    const d = decide({
      roleGate: 'off', accountRole: 'coach', targetAthleteId: 'ath_1',
      membership: { athleteId: 'ath_1', role: 'coach' },
    })
    expect(d.entitlementSource).toBe('self')
    expect(d.quotaSubject).toBeNull()
  })
})

describe('roleGate on — delegación', () => {
  it('coach sobre atleta vinculado cobra al coach y fija el sujeto', () => {
    const d = decide({
      capability: 'chat_action', accountRole: 'coach', targetAthleteId: 'ath_1',
      membership: { athleteId: 'ath_1', role: 'coach' },
    })
    expect(d.allowed).toBe(true)
    expect(d.entitlementSource).toBe('coach')
    expect(d.quotaOwnerUserId).toBe('user-1')
    expect(d.quotaSubject).toEqual({ athleteId: 'ath_1', limit: 40 })
    expect(d.quotaBucketId).toBe('chat')  // canónico: usageGate compara por igualdad
  })

  it('objetivo sin membresía DENIEGA; nunca recae en "sobre sí mismo"', () => {
    const d = decide({ capability: 'chat_action', accountRole: 'coach', targetAthleteId: 'ath_1', membership: null })
    expect(d.allowed).toBe(false)
    expect(d.quotaSubject).toBeNull()
    expect(d.quotaBucketId).toBeNull()
  })

  it('membresía sobre otro atleta DENIEGA', () => {
    expect(decide({
      capability: 'chat_action', accountRole: 'coach', targetAthleteId: 'ath_1',
      membership: { athleteId: 'ath_OTRO', role: 'coach' },
    }).allowed).toBe(false)
  })

  it('membresía self no habilita delegación', () => {
    expect(decide({
      capability: 'chat_action', accountRole: 'coach', targetAthleteId: 'ath_1',
      membership: { athleteId: 'ath_1', role: 'self' },
    }).allowed).toBe(false)
  })

  it('rol athlete no delega ni con membresía coach', () => {
    expect(decide({
      capability: 'chat_action', accountRole: 'athlete', targetAthleteId: 'ath_1',
      membership: { athleteId: 'ath_1', role: 'coach' },
    }).allowed).toBe(false)
  })
})

describe('roleGate on — rol unknown', () => {
  it('deniega TODO, incluidas las clases de tier free', () => {
    for (const capability of ['chat_general', 'import_extract'] as const) {
      expect(decide({ capability, accountRole: 'unknown' }).allowed).toBe(false)
    }
  })
})

describe('roleGate on — coach_assistant_message', () => {
  it('exige rol coach y deja de exigir tier', () => {
    expect(decide({ capability: 'coach_assistant_message', accountRole: 'athlete', entitlement: ADVANCED }).allowed).toBe(false)
    expect(decide({ capability: 'coach_assistant_message', accountRole: 'coach', entitlement: FREE }).allowed).toBe(true)
  })

  it('un coach Free tiene cuota resoluble', () => {
    const d = decide({ capability: 'coach_assistant_message', accountRole: 'coach', entitlement: FREE })
    expect(d.quotaBucketId).toBe('coach_assistant')
    expect(d.limit).toBe(20)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/entitlements/__tests__/resolveCapabilityDelegation.test.ts`
Expected: FAIL — la entrada no acepta `roleGate`.

- [ ] **Step 3: Implementar**

En `entitlementPolicy.ts` **sin tocar `REQUEST_CLASS_MIN_TIER`**:

```ts
/**
 * Clases cuyo requisito real es el ROL. Su entrada en REQUEST_CLASS_MIN_TIER se
 * conserva para que la ruta legacy (`roleGate: 'off'`) no cambie; en la ruta
 * role-aware el tier deja de consultarse para ellas.
 * Provisional: durante el piloto toda cuenta coach las recibe. Al monetizar el
 * producto Coach, el requisito se muda a su plan propio y NO al tier del atleta.
 */
export const CLASS_REQUIRES_COACH_ROLE: ReadonlySet<AIRequestClass> = new Set([
  'coach_assistant_message',
])
```

En `resolveCapability.ts`:

```ts
export interface VerifiedMembership { athleteId: string; role: MembershipRole }

export interface ResolveCapabilityInput {
  actorUserId: string
  targetAthleteId: string | null
  capability: AIRequestClass
  now: number
  entitlement: EntitlementRow | null
  accountRole: ResolvedAccountRole
  /** Membresía sobre `targetAthleteId`, YA VERIFICADA por el llamador. */
  membership: VerifiedMembership | null
  /** 'off' = comportamiento legacy exacto. 'on' = reglas de rol y delegación. */
  roleGate: 'off' | 'on'
}
```

```ts
export function resolveCapability(input: ResolveCapabilityInput): CapabilityDecision {
  const tier = resolveTier(input.entitlement, input.now)
  const requiredTier = minTierForClass(input.capability)

  const base = {
    tier,
    capability: input.capability,
    requiredTier,
    entitlementOwnerUserId: input.actorUserId,
    quotaOwnerUserId: input.actorUserId,
    consumptionUnits: 1,
  }
  const denied = (source: 'self' | 'coach' = 'self'): CapabilityDecision => ({
    ...base, allowed: false, entitlementSource: source,
    quotaBucketId: null, limit: null, quotaSubject: null,
  })

  // ── Ruta legacy: idéntica al comportamiento anterior a esta entrega ───────
  if (input.roleGate === 'off') {
    const allowed = isClassAllowed(tier, input.capability)
    const bucket = allowed ? bucketForClass(input.capability) : null
    const limit = bucket ? bucketLimitForTier(bucket, tier) : null
    return {
      ...base, allowed, entitlementSource: 'self',
      quotaBucketId: bucket?.id ?? null, limit, quotaSubject: null,
    }
  }

  // ── Ruta role-aware ──────────────────────────────────────────────────────
  // Un rol ilegible no habilita nada, ni las clases `free`: degradar identidad
  // CONCEDE, no sólo quita (§5.1).
  if (input.accountRole === 'unknown') return denied()

  const roleGated = CLASS_REQUIRES_COACH_ROLE.has(input.capability)
  if (roleGated && input.accountRole !== 'coach') return denied()

  // La ausencia de vínculo NUNCA se reinterpreta como "actúa sobre sí mismo".
  const delegating = input.targetAthleteId != null
  if (delegating) {
    if (input.accountRole !== 'coach') return denied()
    if (input.membership == null) return denied('coach')
    if (input.membership.athleteId !== input.targetAthleteId) return denied('coach')
    if (input.membership.role !== 'coach') return denied('coach')
  }

  const source: 'self' | 'coach' = delegating ? 'coach' : 'self'
  if (!roleGated && !isClassAllowed(tier, input.capability)) return denied(source)

  const bucket = bucketForClass(input.capability)
  if (bucket == null) return denied(source)

  // Para una clase gateada por rol el tier no decide, así que su cuota tampoco
  // puede resolverse a través del gate de tier.
  const limit = roleGated
    ? bucketLimitIgnoringTierGate(bucket, tier)
    : bucketLimitForTier(bucket, tier)
  if (limit == null) return denied(source)

  const perSubject = delegating ? perSubjectLimitForTier(bucket, tier) : null

  return {
    ...base, allowed: true, entitlementSource: source,
    quotaBucketId: bucket.id, limit,
    quotaSubject: perSubject == null ? null : { athleteId: input.targetAthleteId as string, limit: perSubject },
  }
}
```

- [ ] **Step 4: Actualizar los tres call sites obligatorios**

`tsc` los señalará. Los tres pasan `roleGate: 'off'` en esta entrega, salvo la sombra de la Task 11:

- `src/hooks/useEntitlement.ts:43` — agregar `accountRole: 'athlete'`, `membership: null`, `roleGate: 'off'`. Es consultivo y no conoce identidad.
- `netlify/functions/_shared/resolveEntitlement.ts:113` — mismos tres valores.
- `netlify/functions/coach.ts:1926` — mismos tres valores; la Task 11 agrega la sombra.

- [ ] **Step 5: Correr y verificar que pasan**

Run: `npx vitest run src/services/entitlements src/hooks netlify/functions && npx tsc -b`
Expected: PASS. **`tsc -b` sin errores es el criterio de que no quedó ningún call site sin actualizar.**

---

### Task 5: Transporte de `targetAthleteId` hasta el servidor

**Files:**
- Modify: `src/services/ai/types.ts:28-46` (`AIRequest`)
- Modify: `src/services/ai/providers/ProxyProvider.ts` (cuerpo de la request)
- Modify: `netlify/functions/coach.ts:76,102,~422` (tipo crudo, tipo validado, validación)
- Create: `src/services/ai/requestTarget.ts`
- Modify: `src/services/ai/CoachEngine.ts:72-118` (`extractRaw`) y `:185-210` (`sendTrackedCoachRequest`)
- Modify: `src/services/weekCreator/WeekCreatorEngine.ts:~386` (el `provider.call` de la corrida)
- Modify: `src/services/coach/requestAssistantDraft.ts:88-116`
- Modify: `src/pages/CoachWorkspacePage.tsx:222-228` (`handleAssistantDraft`)
- Test: `netlify/functions/__tests__/coachTargetAthlete.test.ts`
- Test: `src/services/ai/__tests__/requestTarget.test.ts`
- Test: `src/services/coach/__tests__/requestAssistantDraftTarget.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `AIRequest.targetAthleteId?: string | null`; el mismo campo validado en el payload de `coach.ts`; `resolveRequestTargetAthleteId(explicit?)`; `requestAssistantDraft(athleteId, signals)`.

**Por qué existe esta task.** Verificado: `targetAthleteId` está **hardcodeado a `null`** en los tres call sites (`useEntitlement.ts:49`, `coach.ts:1928`, `resolveEntitlement.ts:115`) y **no existe** en `AIRequest`, en el cuerpo que arma `ProxyProvider`, ni en el payload que valida `coach.ts`. Sin este transporte, la decisión sombra de la Task 11 jamás podría verificar una membresía ni aplicar la cuota por atleta: la delegación de la Task 4 sería código muerto e inauditable.

**Regla de confianza.** El cliente **propone** un objetivo; el servidor **verifica** la membresía. Un `targetAthleteId` del cliente nunca autoriza por sí solo — es una afirmación sobre a quién se dirige la acción, no sobre quién puede hacerla.

**Regla de asignación: quién lo manda y con qué valor.** Agregar el campo al tipo y al payload no basta —sin un productor real, la delegación de la Task 4 y la sombra de la Task 11 quedan igual de muertas que hoy—. El significado declarado es "el atleta sobre el que se ejerce la acción **cuando no es el propio actor**", y de ahí salen las cuatro superficies:

| Superficie | Punto de construcción | Qué manda |
|---|---|---|
| Asistente del coach | `requestAssistantDraft` → `extractRaw` | el atleta **explícito** de la tarjeta |
| Chat general / acción / resumen semanal | `sendTrackedCoachRequest` (`CoachEngine.ts:185`) | el atleta **activo** |
| Week Creator | `WeekCreatorEngine` (`~:386`) | el atleta **activo** |
| Import de PDF | `extractRaw` (`pdfImport.ts:249`) | el atleta **activo** |

En los tres últimos el valor sale del helper, no del call site: **si el objetivo coincide con el self del actor, o cualquiera de los dos ids es desconocido, va `null`**.

**Por qué el self va como `null` y no como su propio id.** La Task 4 fija que con `roleGate: 'on'` una membresía `self` **no habilita delegación**: mandar el id propio produciría un `wouldDeny` en cada request del propio atleta y contaminaría exactamente la evidencia que la Entrega 1a existe para recoger. `null` es la afirmación correcta —"esto es sobre mí"—, no una omisión por comodidad.

`CoachWorkspacePage.handleAssistantDraft` ya tiene el `athleteId` y ya descarta el self antes de llamar (`athleteId === assistantSelfAthleteId` devuelve error), pero hoy **lo tira**: llama `requestAssistantDraft(athlete.signals)` sin él. Ése es el único call site donde el objetivo es explícito y no derivable del scope activo.

- [ ] **Step 1: Escribir el test que falla**

```ts
// netlify/functions/__tests__/coachTargetAthlete.test.ts
import { describe, expect, it } from 'vitest'
import { validateCoachPayload } from '../coach'

function payload(over: Record<string, unknown> = {}) {
  return {
    systemPrompt: 'sys', userMessage: 'hola', requestClass: 'chat_action',
    traceId: 't-1', ...over,
  }
}

describe('targetAthleteId en el payload', () => {
  it('ausente es válido y queda null', () => {
    const result = validateCoachPayload(payload())
    expect(result.ok).toBe(true)
    expect(result.ok && result.value.targetAthleteId).toBeNull()
  })

  it('una cadena razonable se conserva', () => {
    const result = validateCoachPayload(payload({ targetAthleteId: 'ath_m_abc' }))
    expect(result.ok && result.value.targetAthleteId).toBe('ath_m_abc')
  })

  it('rechaza tipos que no sean cadena', () => {
    for (const value of [1, {}, [], true]) {
      expect(validateCoachPayload(payload({ targetAthleteId: value })).ok).toBe(false)
    }
  })

  it('rechaza cadena vacía y cadenas absurdamente largas', () => {
    expect(validateCoachPayload(payload({ targetAthleteId: '' })).ok).toBe(false)
    expect(validateCoachPayload(payload({ targetAthleteId: 'a'.repeat(200) })).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run netlify/functions/__tests__/coachTargetAthlete.test.ts`
Expected: FAIL — el campo no existe en el payload validado.

- [ ] **Step 3: Agregar el campo a `AIRequest`**

En `src/services/ai/types.ts`, dentro de `AIRequest`:

```ts
  /**
   * Atleta sobre el que se ejerce la acción, cuando no es el propio actor.
   * El cliente lo PROPONE; el servidor verifica la membresía. Nunca autoriza
   * por sí solo.
   */
  targetAthleteId?: string | null
```

- [ ] **Step 4: Transportarlo en `ProxyProvider`**

En el objeto que `ProxyProvider` serializa hacia `/coach`, agregar la clave junto a `requestClass` y `traceId`, omitiéndola cuando sea nula para no ensanchar el cuerpo:

```ts
      ...(request.targetAthleteId ? { targetAthleteId: request.targetAthleteId } : {}),
```

- [ ] **Step 6: Validarlo en `coach.ts`**

Agregar `targetAthleteId?: unknown` al tipo crudo (`:76`) y `targetAthleteId: string | null` al validado (`:102`). En la validación, junto a los otros campos opcionales:

```ts
  let targetAthleteId: string | null = null
  if (raw.targetAthleteId != null) {
    if (typeof raw.targetAthleteId !== 'string'
        || raw.targetAthleteId.length === 0
        || raw.targetAthleteId.length > ATHLETE_ID_MAX_CHARS) {
      return { ok: false, error: 'Invalid targetAthleteId' }
    }
    targetAthleteId = raw.targetAthleteId
  }
```

con `const ATHLETE_ID_MAX_CHARS = 128` junto a los demás topes, e incluirlo en el objeto devuelto (`:519`).

- [ ] **Step 5: Cablear los cuatro productores**

Primero el test del helper y del único call site explícito:

```ts
// src/services/ai/__tests__/requestTarget.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveRequestTargetAthleteId } from '../requestTarget'
import * as activeAthlete from '../../athlete/activeAthlete'

function scope(self: string | null, active: string | null) {
  vi.spyOn(activeAthlete, 'getSelfAthleteId').mockReturnValue(self)
  vi.spyOn(activeAthlete, 'getActiveAthleteId').mockReturnValue(active)
}

beforeEach(() => { vi.restoreAllMocks() })

describe('resolveRequestTargetAthleteId', () => {
  it('el atleta activo gestionado viaja', () => {
    scope('ath_self', 'ath_m_1')
    expect(resolveRequestTargetAthleteId()).toBe('ath_m_1')
  })

  it('el self NO viaja: mandarlo produciría un wouldDeny falso', () => {
    scope('ath_self', 'ath_self')
    expect(resolveRequestTargetAthleteId()).toBeNull()
  })

  it('un objetivo explícito gana sobre el scope activo', () => {
    scope('ath_self', 'ath_self')
    expect(resolveRequestTargetAthleteId('ath_m_2')).toBe('ath_m_2')
  })

  it('un objetivo explícito igual al self tampoco viaja', () => {
    scope('ath_self', 'ath_m_1')
    expect(resolveRequestTargetAthleteId('ath_self')).toBeNull()
  })

  it('sin objetivo resoluble devuelve null', () => {
    scope('ath_self', null)
    expect(resolveRequestTargetAthleteId()).toBeNull()
  })

  it('una cuenta sin self (coach) sí manda el gestionado activo', () => {
    scope(null, 'ath_m_1')
    expect(resolveRequestTargetAthleteId()).toBe('ath_m_1')
  })
})
```

```ts
// src/services/coach/__tests__/requestAssistantDraftTarget.test.ts
import { describe, expect, it, vi } from 'vitest'
import { requestAssistantDraft } from '../requestAssistantDraft'
import { CoachEngine } from '../../ai/CoachEngine'

describe('el Asistente propone su atleta explícito', () => {
  it('pasa targetAthleteId a extractRaw', async () => {
    const spy = vi.spyOn(CoachEngine, 'extractRaw').mockResolvedValue('{}')
    await requestAssistantDraft('ath_m_1', [
      { kind: 'no-check-in', athleteId: 'ath_m_1' } as never,
    ])
    expect(spy.mock.calls[0]?.[2]).toMatchObject({ targetAthleteId: 'ath_m_1' })
  })
})
```

Después el helper:

```ts
// src/services/ai/requestTarget.ts
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
  const target = explicit ?? getActiveAthleteId()
  if (!target) return null
  const self = getSelfAthleteId()
  if (self && target === self) return null
  return target
}
```

Y los cuatro call sites:

1. **`CoachEngine.extractRaw`** — agregar `targetAthleteId?: string | null` a `options` y, en el objeto de `provider.call` (`:104`), `targetAthleteId: resolveRequestTargetAthleteId(options?.targetAthleteId)`. Cubre el Asistente y el import de PDF con una sola línea.
2. **`sendTrackedCoachRequest`** — en el literal `const request: AIRequest` (`:185`), `targetAthleteId: resolveRequestTargetAthleteId()`. Cubre `chat_general`, `chat_action` y `weekly_summary`.
3. **`WeekCreatorEngine`** — en el `provider.call` de la corrida (`~:386`), la misma línea. Los reintentos y el repair reusan ese mismo objeto, así que no hay un segundo lugar.
4. **`requestAssistantDraft`** — cambiar la firma a `requestAssistantDraft(athleteId: string, signals: TriageSignal[])`, pasar `targetAthleteId: athleteId` en las opciones de `extractRaw`, y en `CoachWorkspacePage.handleAssistantDraft` llamar `requestAssistantDraft(athleteId, athlete.signals)`. El guard de self que ya existe ahí se conserva: es una regla de producto —el coach no se escribe a sí mismo—, independiente del `null` del helper.

**El Plan Builder async queda fuera a propósito.** No pasa por `coach.ts` —`generate-plan-background` llama a Anthropic directo— así que este transporte no lo alcanza. Su delegación es trabajo de la Entrega 1b, cuando el gate de rol se aplique también ahí.

- [ ] **Step 7: Correr y verificar que pasan**

Run: `npx vitest run netlify/functions src/services/ai src/services/coach && npx tsc -b`
Expected: PASS.

---

### Task 6: `029` — `ai_usage_daily` por sujeto y sus SEIS consumidores

**Files:**
- Create: `supabase/029_ai_usage_daily_subject.sql`
- Create: `src/services/entitlements/aiUsageConsumers.ts`
- Test: `src/services/entitlements/__tests__/aiUsageConsumers.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: RPC `reserve_ai_usage(...)`; SQLSTATE `45001` con `detail in ('account','subject')`; `AI_USAGE_DAILY_CONSUMERS`.

**Cuatro trampas verificadas, todas bloqueantes:**

1. **Cambiar la PK rompe `increment_ai_usage_if_under_limit`.** Su `on conflict (user_id, usage_date, bucket_id)` deja de corresponder a ninguna constraint y falla en ejecución. Es el **sexto** consumidor y hay que redefinirlo para la fila global.
2. **Ambigüedad plpgsql**, la misma que `024` corrigió: los nombres `usage_date` y `request_count` son a la vez columnas y parámetros `OUT`. Va `#variable_conflict use_column` en toda función nueva o redefinida.
3. **La versión vigente de `read_operations_metrics` está en `025`, no en `022`.** Copiar de `022` perdería `safetyBlocked`.
4. **Todo va antes del mismo `commit`.** Un `commit` intermedio dejaría la PK cambiada con consumidores viejos.
5. **`p_limit` nulo no corta con `p_limit < 1`.** En SQL, `null < 1` es `null`, que no es `true`: el guard de entrada no dispara y la ejecución sigue. Y sigue hasta un lugar peligroso — el `on conflict ... where request_count + 1 <= p_limit` también evalúa `null`, así que **no** actualiza una fila existente, pero el `insert` de una fila **nueva** no pasa por esa condición y reserva la primera unidad igual. Resultado: un límite ausente concede exactamente una request por bucket y por día en vez de cero. El guard tiene que ser `p_limit is null or p_limit < 1`, en **las dos** rutas de reserva. Es la misma clase de defecto que la constante del proyecto "`null` en `limit` significa que el plan no permite la clase, nunca `0`": acá el `null` llega hasta SQL y hay que cortarlo también ahí.
6. **Un guard a nivel de archivo no prueba nada cuando el archivo es compartido.** Los cinco consumidores de SQL viven en `029`, así que "el archivo menciona `subject_athlete_id`" se cumple aunque cuatro funciones lo ignoren. El guard tiene que recortar **el cuerpo de cada función** y comprobarlo ahí.

- [ ] **Step 1: Escribir el guard que falla**

```ts
// src/services/entitlements/__tests__/aiUsageConsumers.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AI_USAGE_DAILY_CONSUMERS } from '../aiUsageConsumers'

/** Cuerpo de una función SQL: desde su `create ... function public.<name>(` hasta el `$$;` que la cierra. */
function sqlFunctionBody(sql: string, name: string): string {
  const start = sql.indexOf(`function public.${name}(`)
  if (start < 0) return ''
  const open = sql.indexOf('as $$', start)
  const close = sql.indexOf('$$;', open)
  return open < 0 || close < 0 ? '' : sql.slice(open, close)
}

/** Cuerpo de una función TS exportada: hasta el siguiente `export` de nivel superior. */
function tsFunctionBody(source: string, name: string): string {
  const start = source.search(new RegExp(`export (?:async )?function ${name}\\b`))
  if (start < 0) return ''
  const next = source.indexOf('\nexport ', start + 1)
  return next < 0 ? source.slice(start) : source.slice(start, next)
}

describe('consumidores de ai_usage_daily', () => {
  it('están los seis declarados', () => {
    expect(AI_USAGE_DAILY_CONSUMERS.map((c) => c.name).sort()).toEqual([
      'checkUsagePreflight',
      'increment_ai_usage_cost',
      'increment_ai_usage_if_under_limit',
      'read_ai_usage_spend',
      'read_operations_metrics',
      'reserve_ai_usage',
    ])
  })

  it('cada consumidor distingue el eje EN SU PROPIO CUERPO', () => {
    // Un `source.includes(...)` sobre el archivo entero es vacuo: los cinco
    // consumidores de SQL comparten `029`, así que una sola mención los da por
    // buenos a todos. Se recorta el bloque de cada uno.
    for (const consumer of AI_USAGE_DAILY_CONSUMERS) {
      const source = readFileSync(consumer.file, 'utf8')
      const body = consumer.file.endsWith('.sql')
        ? sqlFunctionBody(source, consumer.name)
        : tsFunctionBody(source, consumer.name)
      expect(
        body.length,
        `${consumer.name}: no se encontró su bloque en ${consumer.file}`,
      ).toBeGreaterThan(0)
      expect(
        body.includes('subject_athlete_id'),
        `${consumer.name} (${consumer.file}) no distingue el eje en su cuerpo`,
      ).toBe(true)
    }
  })

  it('el recorte no es vacuo: una función sin el eje falla', () => {
    // Sin este caso, un `sqlFunctionBody` que devolviera el archivo entero
    // reintroduciría el guard vacuo sin que nadie lo note.
    const fake = [
      'create or replace function public.impostor(p uuid)',
      'returns void language sql as $$',
      '  select 1 from public.ai_usage_daily where user_id = p;',
      '$$;',
    ].join('\n')
    expect(sqlFunctionBody(fake, 'impostor')).not.toContain('subject_athlete_id')
  })

  it('las DOS rutas de reserva cortan con límite nulo, no sólo con < 1', () => {
    // `null < 1` es null, no true: sin este guard un límite ausente concede la
    // primera request del día en vez de cero.
    const sql = readFileSync('supabase/029_ai_usage_daily_subject.sql', 'utf8')
    for (const name of ['reserve_ai_usage', 'increment_ai_usage_if_under_limit']) {
      expect(
        sqlFunctionBody(sql, name),
        `${name} no corta con p_limit nulo`,
      ).toMatch(/p_limit\s+is\s+null\s+or\s+p_limit\s*<\s*1/i)
    }
  })

  it('las funciones plpgsql redefinidas declaran variable_conflict', () => {
    // Misma clase de defecto que 024: `usage_date` y `request_count` son
    // columna y parámetro OUT a la vez.
    const sql = readFileSync('supabase/029_ai_usage_daily_subject.sql', 'utf8')
    const plpgsqlBlocks = sql.split('language plpgsql').length - 1
    const guards = sql.split('#variable_conflict use_column').length - 1
    expect(guards).toBeGreaterThanOrEqual(plpgsqlBlocks)
  })

  it('029 redefine el incrementador legacy: la PK vieja ya no existe', () => {
    const sql = readFileSync('supabase/029_ai_usage_daily_subject.sql', 'utf8')
    expect(sql).toContain('increment_ai_usage_if_under_limit')
  })

  it('la métrica se copia de 025, que trae safetyBlocked', () => {
    const sql = readFileSync('supabase/029_ai_usage_daily_subject.sql', 'utf8')
    expect(sql).toContain('safetyBlocked')
  })

  it('un solo commit al final: nada queda a medio migrar', () => {
    const sql = readFileSync('supabase/029_ai_usage_daily_subject.sql', 'utf8')
    expect(sql.match(/^commit;/gim)?.length ?? 0).toBe(1)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/entitlements/__tests__/aiUsageConsumers.test.ts`
Expected: FAIL — no existe `aiUsageConsumers.ts`.

- [ ] **Step 3: Escribir la migración**

```sql
-- supabase/029_ai_usage_daily_subject.sql
-- Cuota delegada: tope por par (coach, atleta) además del global de la cuenta.
-- Spec §8. Aplicación manual. UNA sola transacción: cambiar la PK invalida el
-- `on conflict` de los consumidores viejos, así que todos se redefinen acá.
--
-- La fila GLOBAL es `subject_athlete_id = ''` y es la ÚNICA contable: costo,
-- spend cap y métricas leen sólo esa. Las filas por sujeto son limitadores de
-- tasa, con costo siempre 0.

begin;

alter table public.ai_usage_daily
  add column if not exists subject_athlete_id text not null default '';

alter table public.ai_usage_daily drop constraint if exists ai_usage_daily_pkey;
alter table public.ai_usage_daily
  add primary key (user_id, usage_date, bucket_id, subject_athlete_id);

grant select (user_id, usage_date, bucket_id, subject_athlete_id, request_count, estimated_cost_usd, updated_at)
  on public.ai_usage_daily to authenticated;

-- ── 1. Reserva: global sola, o global + sujeto en la misma transacción ──────
create or replace function public.reserve_ai_usage(
  p_user_id uuid,
  p_bucket_id text,
  p_limit integer,
  p_subject_athlete_id text default null,
  p_subject_limit integer default null
)
returns table (usage_date date, request_count integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_rows integer;
begin
  -- `p_limit is null` va PRIMERO: `null < 1` es null, no true, así que el
  -- guard no cortaría y el insert de una fila nueva reservaría una unidad.
  if p_limit is null or p_limit < 1
     or p_user_id is null or p_bucket_id is null or length(p_bucket_id) = 0 then
    return;
  end if;

  if (p_subject_athlete_id is null) <> (p_subject_limit is null) then
    raise exception 'reserve_ai_usage: subject and subject_limit must be provided together';
  end if;
  if p_subject_athlete_id is not null
     and (length(p_subject_athlete_id) = 0
          or p_subject_limit is null or p_subject_limit < 1) then
    raise exception 'reserve_ai_usage: invalid subject arguments';
  end if;

  insert into public.ai_usage_daily (user_id, usage_date, bucket_id, subject_athlete_id, request_count)
  values (p_user_id, current_date, p_bucket_id, '', 1)
  on conflict (user_id, usage_date, bucket_id, subject_athlete_id)
  do update set request_count = ai_usage_daily.request_count + 1, updated_at = now()
   where ai_usage_daily.request_count + 1 <= p_limit;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception using errcode = '45001', message = 'quota_exceeded', detail = 'account';
  end if;

  if p_subject_athlete_id is not null then
    insert into public.ai_usage_daily (user_id, usage_date, bucket_id, subject_athlete_id, request_count)
    values (p_user_id, current_date, p_bucket_id, p_subject_athlete_id, 1)
    on conflict (user_id, usage_date, bucket_id, subject_athlete_id)
    do update set request_count = ai_usage_daily.request_count + 1, updated_at = now()
     where ai_usage_daily.request_count + 1 <= p_subject_limit;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      -- Revierte TAMBIÉN el incremento global: misma transacción.
      raise exception using errcode = '45001', message = 'quota_exceeded', detail = 'subject';
    end if;
  end if;

  return query
  select d.usage_date, d.request_count
  from public.ai_usage_daily d
  where d.user_id = p_user_id and d.usage_date = current_date
    and d.bucket_id = p_bucket_id and d.subject_athlete_id = '';
end;
$$;

revoke all on function public.reserve_ai_usage(uuid, text, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(uuid, text, integer, text, integer) to service_role;

-- ── 2. El incrementador legacy: su `on conflict` de 3 columnas ya no existe ──
--     Se conserva operativo sobre la fila global para que un rollback del
--     bundle siga funcionando.
create or replace function public.increment_ai_usage_if_under_limit(
  p_user_id uuid,
  p_bucket_id text,
  p_limit integer
)
returns table (usage_date date, request_count integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  -- Mismo guard que reserve_ai_usage: `null < 1` no corta.
  if p_limit is null or p_limit < 1
     or p_user_id is null or p_bucket_id is null or length(p_bucket_id) = 0 then
    return;
  end if;

  return query
  insert into public.ai_usage_daily (user_id, usage_date, bucket_id, subject_athlete_id, request_count)
  values (p_user_id, current_date, p_bucket_id, '', 1)
  on conflict (user_id, usage_date, bucket_id, subject_athlete_id)
  do update set request_count = ai_usage_daily.request_count + 1, updated_at = now()
   where ai_usage_daily.request_count + 1 <= p_limit
  returning ai_usage_daily.usage_date, ai_usage_daily.request_count;
end;
$$;

-- ── 3. Costo: SÓLO la fila global ──────────────────────────────────────────
create or replace function public.increment_ai_usage_cost(
  p_user_id uuid, p_bucket_id text, p_usage_date date, p_delta numeric
)
returns table (estimated_cost_usd numeric)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if p_delta <= 0 or p_user_id is null or p_bucket_id is null or p_usage_date is null then
    return;
  end if;

  return query
  update public.ai_usage_daily
     set estimated_cost_usd = ai_usage_daily.estimated_cost_usd + p_delta,
         updated_at = now()
   where ai_usage_daily.user_id = p_user_id
     and ai_usage_daily.usage_date = p_usage_date
     and ai_usage_daily.bucket_id = p_bucket_id
     and ai_usage_daily.subject_athlete_id = ''
  returning ai_usage_daily.estimated_cost_usd;
end;
$$;

-- ── 4. Spend cap: SÓLO la fila global ──────────────────────────────────────
create or replace function public.read_ai_usage_spend(p_user_id uuid)
returns table (account_cost_usd numeric, global_cost_usd numeric)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(sum(estimated_cost_usd) filter (where user_id = p_user_id), 0),
    coalesce(sum(estimated_cost_usd), 0)
  from public.ai_usage_daily
  where usage_date = current_date and subject_athlete_id = '';
$$;

-- ── 5. Métricas: SÓLO la fila global ───────────────────────────────────────
-- IMPORTANTE: copiar el cuerpo COMPLETO de `read_operations_metrics` desde
-- `supabase/025_coach_request_safety_blocked.sql`, que es la versión vigente y
-- la única que emite `safetyBlocked`. Aplicar ÚNICAMENTE este cambio: agregar
-- `and subject_athlete_id = ''` a las DOS apariciones de
-- `where usage_date >= $1::date` dentro del bloque de cuotas. No reescribir
-- ninguna otra parte del RPC. El guard recorta el cuerpo de esta función y
-- exige la mención ahí: copiar 025 sin ese filtro falla el test, que es el
-- punto.

commit;

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Escribir la lista de consumidores**

```ts
// src/services/entitlements/aiUsageConsumers.ts
/**
 * Todo lo que lee o escribe `ai_usage_daily`. Desde `029` la tabla tiene un eje
 * `subject_athlete_id`: la fila global (`''`) es la ÚNICA contable y las filas
 * por sujeto son limitadores de tasa. Un consumidor que no distinga el eje
 * duplica costo, gasto o métricas — o, si conserva un `on conflict` de tres
 * columnas, falla en ejecución porque esa constraint dejó de existir.
 *
 * El guard en __tests__/aiUsageConsumers.test.ts falla si aparece uno que no
 * menciona la columna. Mismo precedente que WHOOP_WORKOUT_ZONE_COLUMNS.
 */
export interface AiUsageConsumer {
  name: string
  file: string
  role: 'reserve' | 'reserve_legacy' | 'cost' | 'spend' | 'metrics' | 'preflight'
}

export const AI_USAGE_DAILY_CONSUMERS: readonly AiUsageConsumer[] = [
  { name: 'reserve_ai_usage', file: 'supabase/029_ai_usage_daily_subject.sql', role: 'reserve' },
  { name: 'increment_ai_usage_if_under_limit', file: 'supabase/029_ai_usage_daily_subject.sql', role: 'reserve_legacy' },
  { name: 'increment_ai_usage_cost', file: 'supabase/029_ai_usage_daily_subject.sql', role: 'cost' },
  { name: 'read_ai_usage_spend', file: 'supabase/029_ai_usage_daily_subject.sql', role: 'spend' },
  { name: 'read_operations_metrics', file: 'supabase/029_ai_usage_daily_subject.sql', role: 'metrics' },
  { name: 'checkUsagePreflight', file: 'netlify/functions/_shared/usageGate.ts', role: 'preflight' },
] as const
```

- [ ] **Step 5: Correr y verificar que pasan**

Run: `npx vitest run src/services/entitlements/__tests__/aiUsageConsumers.test.ts`
Expected: PASS para los cinco de SQL, incluido el recorte por bloque de cada uno. `checkUsagePreflight` **falla hasta la Task 7**, que es el orden correcto: el guard detecta el hueco antes de que exista el arreglo. Si se prefiere el árbol verde entre tasks, marcar ese caso como `it.fails` y quitarlo en la Task 7; **no relajar el guard**.

---

### Task 7: `usageGate` — `429` preservado, `503` para lo demás, preflight dual

**Files:**
- Modify: `netlify/functions/_shared/usageGate.ts`
- Test: `netlify/functions/_shared/__tests__/usageGateDelegation.test.ts`

**Interfaces:**
- Consumes: `CapabilityDecision.quotaSubject` (Task 4); `reserve_ai_usage` y SQLSTATE `45001` (Task 6).
- Produces: `makeQuotaExceededError(bucketId, limit, remaining, scope)`.

**Tres defectos verificados que esta task corrige:**

1. `callRpc` convierte **cualquier** `!response.ok` en `makeServerError` (503). Con el `RAISE` de la Task 6, agotar la cuota llegaría como caída del servidor en vez de `429`.
2. La firma real es `makeGateError(message, statusCode, errorCode, detail, diagnostics)` — el `message` va **primero**.
3. `assertUsageGate` trata hoy `rows.length === 0` como `429`. Con `reserve_ai_usage`, `[]` sólo ocurre por **argumentos inválidos** (`p_limit < 1`, usuario nulo, bucket vacío), que es un defecto de programación: debe ser **503**, no un 429 que le mienta al usuario.

- [ ] **Step 1: Escribir el test que falla**

```ts
// netlify/functions/_shared/__tests__/usageGateDelegation.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertUsageGate } from '../usageGate'
import type { CapabilityDecision } from '../../../../src/services/entitlements/resolveCapability'

const OLD_ENV = { ...process.env }

function decision(over: Partial<CapabilityDecision> = {}): CapabilityDecision {
  return {
    allowed: true, tier: 'advanced', capability: 'chat_action', requiredTier: 'weekly',
    entitlementSource: 'coach', entitlementOwnerUserId: 'u1', quotaOwnerUserId: 'u1',
    quotaBucketId: 'chat', consumptionUnits: 1, limit: 120,
    quotaSubject: { athleteId: 'ath_1', limit: 40 }, ...over,
  }
}
function pgError(code: string, details: string) {
  return new Response(JSON.stringify({ code, message: 'quota_exceeded', details, hint: null }),
    { status: 400, headers: { 'Content-Type': 'application/json' } })
}
function spendOk() {
  return new Response(JSON.stringify([{ account_cost_usd: 0, global_cost_usd: 0 }]), { status: 200 })
}
function route(rpcResponse: () => Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    url.includes('read_ai_usage_spend') ? spendOk() : rpcResponse()))
}

beforeEach(() => {
  process.env['AI_USAGE_LIMITS_ENABLED'] = 'true'
  process.env['AI_KILL_SWITCH_ENABLED'] = 'false'
  process.env['SUPABASE_URL'] = 'https://example.supabase.co'
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'svc'
})
afterEach(() => { vi.unstubAllGlobals(); process.env = { ...OLD_ENV } })

describe('clasificación de la reserva', () => {
  it('45001 detail=account es 429, no 503', async () => {
    route(() => pgError('45001', 'account'))
    await expect(assertUsageGate({ decision: decision(), token: 't' } as never))
      .rejects.toMatchObject({ statusCode: 429, errorCode: 'quota_exceeded' })
  })

  it('45001 detail=subject es 429 y distingue el scope', async () => {
    route(() => pgError('45001', 'subject'))
    const err = await assertUsageGate({ decision: decision(), token: 't' } as never).catch((e) => e)
    expect(err.statusCode).toBe(429)
    expect(err.detail).toMatchObject({ scope: 'subject', limit: 40 })
  })

  it('un SQLSTATE desconocido sigue siendo 503', async () => {
    route(() => pgError('P0001', 'lo que sea'))
    await expect(assertUsageGate({ decision: decision(), token: 't' } as never))
      .rejects.toMatchObject({ statusCode: 503 })
  })

  it('45001 con detail inesperado NO se adivina: 503', async () => {
    route(() => pgError('45001', ''))
    await expect(assertUsageGate({ decision: decision(), token: 't' } as never))
      .rejects.toMatchObject({ statusCode: 503 })
  })

  it('[] es argumento inválido, no cuota agotada: 503', async () => {
    // Con reserve_ai_usage la denegación llega por RAISE. Un arreglo vacío
    // significa que la RPC salió por su guarda de argumentos.
    route(() => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await expect(assertUsageGate({ decision: decision(), token: 't' } as never))
      .rejects.toMatchObject({ statusCode: 503 })
  })
})

describe('argumentos de la reserva', () => {
  async function capture(d: CapabilityDecision) {
    const bodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('read_ai_usage_spend')) return spendOk()
      bodies.push(String(init?.body))
      return new Response(JSON.stringify([{ usage_date: '2026-09-02', request_count: 1 }]), { status: 200 })
    }))
    await assertUsageGate({ decision: d, token: 't' } as never)
    return JSON.parse(bodies[0] as string)
  }

  it('sin delegación no manda sujeto', async () => {
    const body = await capture(decision({ quotaSubject: null }))
    expect(body.p_subject_athlete_id).toBeNull()
    expect(body.p_subject_limit).toBeNull()
  })

  it('con delegación manda sujeto y su tope', async () => {
    const body = await capture(decision())
    expect(body.p_subject_athlete_id).toBe('ath_1')
    expect(body.p_subject_limit).toBe(40)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run netlify/functions/_shared/__tests__/usageGateDelegation.test.ts`
Expected: FAIL — la cuota agotada llega como `503`.

- [ ] **Step 3: Clasificar el error de PostgREST**

Un SQLSTATE de PostgreSQL tiene exactamente cinco caracteres, así que el scope viaja aparte, en `DETAIL`. La clasificación se hace sobre el **cuerpo de error de PostgREST** (`code`, `details`), nunca sobre el status HTTP que PostgREST elija.

```ts
const QUOTA_SQLSTATE = '45001'

/** `null` = no es un rechazo de cuota reconocido; el llamador lo trata como 503. */
function parseQuotaRejection(body: string): 'account' | 'subject' | null {
  try {
    const parsed = JSON.parse(body) as { code?: unknown; details?: unknown }
    if (parsed.code !== QUOTA_SQLSTATE) return null
    return parsed.details === 'account' || parsed.details === 'subject' ? parsed.details : null
  } catch {
    return null
  }
}
```

En `callRpc`, reemplazar el bloque `if (!response.ok)`:

```ts
  if (!response.ok) {
    const rawBody = (await response.text().catch(() => '')).slice(0, UPSTREAM_BODY_MAX_CHARS)
    const scope = parseQuotaRejection(rawBody)
    if (scope) {
      // Agotar la cuota NO es un error del servidor. El rollback ya ocurrió
      // dentro de la función: no queda ninguna fila incrementada.
      const limit = Number(scope === 'subject' ? args['p_subject_limit'] : args['p_limit']) || 0
      throw makeQuotaExceededError(String(args['p_bucket_id'] ?? ''), limit, 0, scope)
    }
    const diagnostics = { upstreamStatus: response.status, upstreamBody: rawBody }
    console.error('[usage-gate] RPC failed', { functionName, diagnostics })
    throw makeServerError(`RPC ${functionName} devolvió ${response.status}.`, diagnostics)
  }
```

- [ ] **Step 4: Dar scope al error, respetando la firma real**

`makeGateError(message, statusCode, errorCode, detail, diagnostics)` — el mensaje va primero:

```ts
export function makeQuotaExceededError(
  bucketId: string,
  limit: number,
  remaining = 0,
  scope: 'account' | 'subject' = 'account',
): UsageGateHttpError {
  return makeGateError(
    scope === 'subject'
      ? 'Alcanzaste el cupo diario de esta función para este atleta.'
      : 'Alcanzaste el cupo diario de esta función.',
    429,
    'quota_exceeded',
    { bucketId, limit, remaining, scope },
  )
}
```

- [ ] **Step 5: Usar `reserve_ai_usage` y corregir el caso de `[]`**

```ts
  const rows = await callRpc<unknown>('reserve_ai_usage', {
    p_user_id: input.decision.quotaOwnerUserId,
    p_bucket_id: preamble.bucketId,
    p_limit: preamble.limit,
    p_subject_athlete_id: input.decision.quotaSubject?.athleteId ?? null,
    p_subject_limit: input.decision.quotaSubject?.limit ?? null,
  })
  if (!Array.isArray(rows)) throw makeServerError('reserve_ai_usage devolvió una forma inesperada.')
  // La denegación de cuota llega por SQLSTATE 45001, no por arreglo vacío: `[]`
  // significa que la RPC salió por su guarda de argumentos, y eso es un defecto
  // de programación, no un límite alcanzado.
  if (rows.length === 0) throw makeServerError('reserve_ai_usage devolvió cero filas: argumentos inválidos.')
  if (rows.length !== 1) throw makeServerError('reserve_ai_usage devolvió más de una fila.')
```

Conservar sin cambios las validaciones de `usage_date` y `request_count`.

- [ ] **Step 6: Preflight que comprueba ambos contadores**

La lectura global gana el filtro del eje, y aparece una segunda lectura cuando hay delegación:

```ts
  const baseQuery = (subject: string) => new URLSearchParams({
    user_id: `eq.${input.decision.quotaOwnerUserId}`,
    usage_date: `eq.${today}`,
    bucket_id: `eq.${preamble.bucketId}`,
    subject_athlete_id: `eq.${subject}`,
    select: 'request_count',
  })
```

Tras comparar la global contra `preamble.limit`, si `input.decision.quotaSubject` no es `null`, repetir con `baseQuery(quotaSubject.athleteId)` y lanzar `makeQuotaExceededError(preamble.bucketId, quotaSubject.limit, 0, 'subject')` cuando ya esté alcanzado. Sin esta segunda lectura el preflight dejaría encolar justo el caso que la delegación introduce.

- [ ] **Step 7: Correr y verificar que pasan**

Run: `npx vitest run netlify/functions/_shared src/services/entitlements`
Expected: PASS, incluido el guard de drift ahora completo con `checkUsagePreflight`.

- [ ] **Step 8: Verificar que la clasificación no es vacua**

Hacer que `parseQuotaRejection` devuelva siempre `null`: los dos casos de `429` deben FALLAR. Revertir.

---

### Task 8: `030` — invariantes de rol y RPC de alta/borrado de atleta

**Files:**
- Create: `supabase/030_athlete_role_invariants.sql`
- Test: `supabase/__tests__/migration030Contract.test.ts`

**Interfaces:**
- Consumes: `account_role` (Task 1); `athlete_memberships`, el trigger `athletes_seed_membership` y los helpers de `013b`.
- Produces: policies `*_write_member`; trigger `athletes_enforce_role_invariants`; RPC `create_self_athlete(p_athlete_id text)` (JWT del usuario); `admin_create_managed_athlete` y `admin_delete_athlete` (service role).

**Hueco adicional hallado al implementar:** `013b` migró `readiness_daily`,
pero omitió `whoop_workouts`; esa tabla conserva desde `012` sólo el `select`
legacy por owner/linked. `030` agrega `whoop_workouts_select_membership` sin
retirar la policy legacy, coherente con el modo auditoría de 1a.

**Cuatro trampas verificadas:**

1. **`013b` ya crea la membresía por trigger.** `seed_membership_for_new_athlete` corre `after insert on athletes` y elige el rol según `linked_account_id`: **igual a owner → `self`; cualquier otra cosa, incluido NULL → `coach`**. Un alta self que inserte el atleta con `linked_account_id` nulo produce una membresía **coach** y después choca al insertar la `self`. La RPC debe estampar `linked_account_id = auth.uid()` y **dejar que el trigger sea la única fuente de membresía**.
2. **`athletes.created_at` y `updated_at` son `bigint not null` sin default.** Hay que estamparlos.
3. **`on conflict do nothing` sobre un id existente permitiría apropiarse de un atleta ajeno**: el insert no haría nada y la RPC devolvería éxito. Un id que ya existe **debe fallar**.
4. **La policy legacy `athletes_insert` sigue viva** y permite a cualquier cuenta insertar con `owner_account_id = auth.uid()`, esquivando la RPC. Como en 1a no se retiran policies, la invariante se impone con un **trigger**, que vale para todos los caminos.

**Decisión del owner (2026-09-02): la invariante de rol entra PARTIDA, no entera.**

| Invariante | ¿Entra en 1a? | Dónde |
|---|---|---|
| Una cuenta `coach` nunca tiene atleta `self` | **sí** | trigger, sección 2 |
| Sólo una cuenta `coach` puede tener gestionados | **no** | se posterga a 1b/Entrega 2 |
| El alta administrativa nueva exige dueño `coach` | **sí** | dentro de `admin_create_managed_athlete` |

El motivo es concreto, no una preferencia de estilo: **la cuenta del owner es hoy transicionalmente híbrida** —rol `athlete`, con su propio self y con gestionados a cargo—. Las dos salidas que se barajaron para el recíproco eran marcarla `coach` o postergarlo, y marcarla `coach` **activaría de inmediato el scope coach del cliente** (Task 9: el rol viaja en el espejo y el scope pasa a tres estados), que es justamente lo que la Entrega 1a promete no cambiar. Además rompería el alta de gestionados en producción por el camino legacy, que sigue siendo el único que la UI usa.

Postergar el recíproco **no abre un agujero nuevo**: hoy cualquier cuenta puede crear gestionados por la policy legacy, y 1a no lo empeora. La ruta nueva —la única que 1b va a cablear— sí lo exige desde el primer día, así que la restricción queda escrita y probada donde todavía no tiene consumidor productivo.

**Cuándo entra la invariante completa:** cuando exista una ruta que preserve el alta de gestionados para la cuenta híbrida, o después de separar las cuentas. Queda como decisión explícita a resolver en el plan de la Entrega 1b, no como un pendiente implícito.

- [ ] **Step 1: Escribir el test de contrato que falla**

```ts
// supabase/__tests__/migration030Contract.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SQL = readFileSync('supabase/030_athlete_role_invariants.sql', 'utf8')

/** Cuerpo de una función SQL. Un `SQL.includes(...)` global no distingue entre
 *  el trigger y la RPC, que es exactamente lo que hay que distinguir acá. */
function fnBody(sql: string, name: string): string {
  const start = sql.indexOf(`function public.${name}(`)
  if (start < 0) return ''
  const open = sql.indexOf('as $$', start)
  const close = sql.indexOf('$$;', open)
  return open < 0 || close < 0 ? '' : sql.slice(open, close)
}

describe('030 cierra los huecos de comando de 013b', () => {
  it('amplía la escritura self a las tres tablas coach-only', () => {
    for (const table of ['coach_proposals', 'training_plans', 'training_plan_weeks']) {
      expect(SQL).toContain(`${table}_write_member`)
    }
    expect(SQL).toContain('auth_athlete_ids()')
  })
  it('agrega select por membresía para whoop_workouts', () => {
    expect(SQL).toContain('whoop_workouts_select_membership')
  })
})

describe('030 respeta el trigger de membresía de 013b', () => {
  it('el alta self estampa linked_account_id para que el trigger cree "self"', () => {
    expect(SQL).toMatch(/linked_account_id/)
  })

  it('NO inserta membresías a mano: el trigger es la única fuente', () => {
    expect(SQL).not.toMatch(/insert\s+into\s+public\.athlete_memberships/i)
  })

  it('estampa created_at y updated_at, que son not null sin default', () => {
    expect(SQL).toMatch(/created_at/)
    expect(SQL).toMatch(/updated_at/)
  })

  it('un id existente falla: nada de on conflict do nothing', () => {
    expect(SQL).not.toMatch(/on\s+conflict\s+do\s+nothing/i)
  })
})

describe('030 impone las invariantes por trigger, no sólo por RPC', () => {
  it('existe el trigger que cubre también la policy legacy athletes_insert', () => {
    expect(SQL).toContain('athletes_enforce_role_invariants')
    expect(SQL).toMatch(/before insert on public\.athletes/i)
  })

  it('una cuenta coach no puede crear un atleta self', () => {
    expect(SQL).toMatch(/account_role/)
    expect(SQL).toContain('a coach account cannot own a self athlete')
  })

  it('una cuenta no puede tener dos self', () => {
    expect(SQL).toContain('account already has a self athlete')
  })
})

describe('030 posterga el recíproco a propósito (decisión del owner)', () => {
  // La cuenta del owner es híbrida: exigir rol coach para un gestionado
  // rompería su alta legacy, y marcarla coach encendería el scope coach del
  // cliente, que es lo que 1a promete no cambiar.
  it('el TRIGGER no exige rol coach para un gestionado', () => {
    expect(fnBody(SQL, 'enforce_athlete_role_invariants'))
      .not.toContain('only a coach account can own a managed athlete')
  })

  it('pero el ALTA ADMINISTRATIVA sí lo exige, en su propio cuerpo', () => {
    const body = fnBody(SQL, 'admin_create_managed_athlete')
    expect(body).toContain('account_role')
    expect(body).toContain('owner is not a coach account')
  })

  it('la ausencia de fila cuenta como athlete y por lo tanto rechaza', () => {
    expect(fnBody(SQL, 'admin_create_managed_athlete')).toMatch(/coalesce\(v_role,\s*'athlete'\)/)
  })
})

describe('030 borra con veto sobre self', () => {
  it('el borrado veta atletas con membresía self', () => {
    expect(SQL).toContain('admin_delete_athlete')
    expect(SQL).toMatch(/role\s*=\s*'self'/)
  })
})

describe('030 no retira nada legacy: eso es 031', () => {
  it('no toca las policies legacy', () => {
    expect(SQL).not.toMatch(/drop\s+policy\s+if\s+exists\s+athletes_select\b/i)
    expect(SQL).not.toMatch(/drop\s+policy\s+if\s+exists\s+\w+_select_by_athlete/i)
    expect(SQL).not.toMatch(/drop\s+policy\s+if\s+exists\s+athletes_insert\b/i)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run supabase/__tests__/migration030Contract.test.ts`
Expected: FAIL — el archivo no existe.

- [ ] **Step 3: Escribir la migración**

```sql
-- supabase/030_athlete_role_invariants.sql
-- Cierra los huecos de comando de la RLS v2 (spec §4.2, §7.1) para que la
-- equivalencia con la legacy sea alcanzable, e impone por TRIGGER las
-- invariantes de rol, que así valen también para la policy legacy
-- `athletes_insert`, todavía vigente en 1a.
-- NO retira ninguna policy legacy: eso es 031 (Entrega 1b). Aplicación manual.
-- Requiere 028 aplicada: lee `account_role`.

begin;

-- ── 1. Escritura self donde 013b dejó sólo coach ───────────────────────────
do $$
declare tbl text;
begin
  foreach tbl in array array['coach_proposals','training_plans','training_plan_weeks']
  loop
    execute format('drop policy if exists %I on public.%I', tbl || '_write_member', tbl);
    execute format(
      'create policy %I on public.%I for all using (
         athlete_id in (select public.auth_athlete_ids())
       ) with check (
         athlete_id in (select public.auth_athlete_ids())
       )', tbl || '_write_member', tbl);
  end loop;
end $$;

-- `013b` migró readiness_daily pero omitió whoop_workouts. La policy legacy
-- de 012 sigue viva durante 1a; ésta agrega la ruta por membresía para auditar.
drop policy if exists whoop_workouts_select_membership on public.whoop_workouts;
create policy whoop_workouts_select_membership on public.whoop_workouts
  for select using (athlete_id in (select public.auth_athlete_ids()));

-- ── 2. Invariantes de rol, por trigger ─────────────────────────────────────
-- Vale para CUALQUIER camino de inserción, incluida la policy legacy
-- `athletes_insert`, que sigue viva y permitiría esquivar la RPC.
create or replace function public.enforce_athlete_role_invariants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_is_self boolean := new.linked_account_id is not distinct from new.owner_account_id;
begin
  select account_role into v_role
  from public.user_entitlements where user_id = new.owner_account_id;
  -- Ausencia de fila = 'athlete' por compatibilidad (§5.1).
  v_role := coalesce(v_role, 'athlete');

  if v_is_self then
    -- Invariante que SÍ entra en 1a: una cuenta coach nunca tiene self.
    if v_role = 'coach' then
      raise exception 'athletes: a coach account cannot own a self athlete';
    end if;
    if exists (
      select 1 from public.athlete_memberships
      where account_id = new.owner_account_id and role = 'self'
    ) then
      raise exception 'athletes: account already has a self athlete';
    end if;
  else
    -- DECISIÓN EXPLÍCITA DE 1a: el recíproco —"sólo una cuenta coach puede
    -- tener gestionados"— NO se impone acá. La cuenta del owner es hoy híbrida
    -- (rol athlete, con self propio y gestionados a cargo); marcarla `coach`
    -- para satisfacer este trigger activaría de inmediato el scope coach del
    -- cliente, que es lo que la Entrega 1a promete no cambiar, y romper el alta
    -- legacy de gestionados en producción es peor que postergar la invariante.
    -- Dónde sí se exige: `admin_create_managed_athlete` (sección 4), la ruta
    -- nueva, que en 1a todavía no tiene consumidor productivo.
    -- Cuándo entra acá: cuando exista una ruta que preserve el alta de
    -- gestionados para la cuenta híbrida, o tras separar las cuentas.
    null;
  end if;

  return new;
end $$;

drop trigger if exists athletes_enforce_role_invariants on public.athletes;
create trigger athletes_enforce_role_invariants
  before insert on public.athletes
  for each row execute function public.enforce_athlete_role_invariants();

-- ── 3. Alta self: la invoca el USUARIO con su JWT ──────────────────────────
-- La membresía la crea el trigger `athletes_seed_membership` de 013b, que
-- elige 'self' porque acá linked_account_id = owner_account_id. NO se inserta
-- membresía a mano: una sola fuente.
create or replace function public.create_self_athlete(p_athlete_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if v_uid is null then
    raise exception 'create_self_athlete: no authenticated user';
  end if;
  if p_athlete_id is null or length(p_athlete_id) = 0 then
    raise exception 'create_self_athlete: invalid athlete id';
  end if;

  -- Sin ON CONFLICT: un id existente DEBE fallar. Tolerarlo permitiría
  -- apropiarse de un atleta gestionado ajeno devolviendo éxito.
  insert into public.athletes (id, owner_account_id, linked_account_id, created_at, updated_at)
  values (p_athlete_id, v_uid, v_uid, v_now, v_now);

  return p_athlete_id;
end;
$$;

revoke all on function public.create_self_athlete(text) from public, anon;
grant execute on function public.create_self_athlete(text) to authenticated;

-- ── 4. Alta managed y borrado: SERVICE ROLE ────────────────────────────────
-- La autorización la pone el endpoint que las invoca (§7.4); el service role
-- protege la tabla, no al invocador.
create or replace function public.admin_create_managed_athlete(
  p_owner uuid, p_athlete_id text, p_display_name text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  v_role text;
begin
  -- El trigger de la sección 2 NO exige rol coach para un gestionado (decisión
  -- de 1a, ver arriba). La ruta administrativa nueva sí lo exige, porque no
  -- tiene todavía consumidor productivo y puede nacer con la invariante puesta.
  -- `select ... into` deja v_role nulo si no hay fila; el coalesce es lo que
  -- hace que la ausencia signifique 'athlete' y por lo tanto rechace.
  select account_role into v_role
  from public.user_entitlements where user_id = p_owner;
  if coalesce(v_role, 'athlete') <> 'coach' then
    raise exception 'admin_create_managed_athlete: owner is not a coach account';
  end if;

  -- linked_account_id NULL => el trigger de 013b crea la membresía 'coach'.
  insert into public.athletes (id, owner_account_id, linked_account_id, display_name, created_at, updated_at)
  values (p_athlete_id, p_owner, null, p_display_name, v_now, v_now);
  return p_athlete_id;
end;
$$;

create or replace function public.admin_delete_athlete(p_actor uuid, p_athlete_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.athlete_memberships
    where account_id = p_actor and athlete_id = p_athlete_id and role = 'coach'
  ) then
    raise exception 'admin_delete_athlete: actor has no coach membership over athlete';
  end if;

  -- Borrar la propia identidad de atleta no es una operación de roster sino de
  -- cuenta, y tiene su propio flujo.
  if exists (
    select 1 from public.athlete_memberships
    where athlete_id = p_athlete_id and role = 'self'
  ) then
    raise exception 'admin_delete_athlete: athlete has a self membership';
  end if;

  delete from public.athletes where id = p_athlete_id;
  return p_athlete_id;
end;
$$;

revoke all on function public.admin_create_managed_athlete(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_delete_athlete(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_create_managed_athlete(uuid, text, text) to service_role;
grant execute on function public.admin_delete_athlete(uuid, text) to service_role;

commit;

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run supabase/__tests__/migration030Contract.test.ts`
Expected: PASS.

**Advertencia de rollout, para el guion — resuelta, y por eso ya no bloquea.** La versión anterior de esta task imponía en el trigger que **todo atleta gestionado tuviera un dueño `coach`**, lo que habría roto el alta de gestionados de la cuenta híbrida del owner en cuanto se aplicara `030`. La decisión de arriba lo cambia: el trigger sólo impone la mitad que la cuenta híbrida ya cumple —no tener self siendo coach—, así que **`030` se puede aplicar sin tocar el rol de ninguna cuenta**. La consulta del Paso 0b del guion deja de ser una precondición bloqueante y pasa a ser **evidencia** para dimensionar 1b: dice cuántos gestionados habría que reparentar, o cuántas cuentas separar, antes de poder cerrar la invariante completa.

**El camino administrativo de 1a es manual, y es una decisión.** El invocador de las RPC `admin_*` es el owner en el SQL Editor, que ya es un camino con autorización real. Un endpoint con allowlist recién hace falta cuando la UI del coach cree atletas, y eso es la **Entrega 2**. No construirlo acá: sería superficie de ataque sin consumidor.

---

### Task 9: Cliente — el rol viaja en el espejo y el scope pasa a tres estados

**Files:**
- Modify: `src/types/entitlement.ts` (`StoredEntitlement`)
- Modify: `src/services/entitlements/entitlementService.ts`
- Modify: `src/store/useEntitlementStore.ts`
- Create: `src/services/entitlements/accountRoleHolder.ts`
- Create: `src/services/athlete/athleteScopeKind.ts`
- Modify: `src/services/athlete/activeAthlete.ts`
- Test: `src/services/athlete/__tests__/athleteScopeKind.test.ts`
- Test: `src/services/entitlements/__tests__/entitlementRoleMirror.test.ts`

**Interfaces:**
- Consumes: `ResolvedAccountRole`, `parseAccountRole` (Task 1).
- Produces: `AthleteScopeKind = 'self' | 'managed' | 'none'`; `resolveAthleteScopeKind(...)`; `canAdoptLegacyRows(kind)`; `getAccountRole()` / `setAccountRole()`; `StoredEntitlement.accountRole`.

**Trampa verificada:** `StoredEntitlement` sólo tiene `{ userId, tier, expiresAt, confirmedAt }` y `entitlementService` sólo transporta tier. Sin ampliarlos, el cliente **no puede** conocer el rol y el scope de tres estados no tendría entrada. Además, un espejo sin rol debe resolver `unknown`, no `athlete`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// src/services/athlete/__tests__/athleteScopeKind.test.ts
import { describe, expect, it } from 'vitest'
import { canAdoptLegacyRows, resolveAthleteScopeKind } from '../athleteScopeKind'

describe('cuenta de atleta', () => {
  it('sin hidratar sigue siendo self: conserva la política legacy actual', () => {
    const kind = resolveAthleteScopeKind({ accountRole: 'athlete', activeAthleteId: null, selfAthleteId: null })
    expect(kind).toBe('self')
    expect(canAdoptLegacyRows(kind)).toBe(true)
  })
  it('activo igual al self es self', () => {
    expect(resolveAthleteScopeKind({ accountRole: 'athlete', activeAthleteId: 'a1', selfAthleteId: 'a1' })).toBe('self')
  })
  it('activo distinto del self es managed y no adopta legacy', () => {
    const kind = resolveAthleteScopeKind({ accountRole: 'athlete', activeAthleteId: 'a2', selfAthleteId: 'a1' })
    expect(kind).toBe('managed')
    expect(canAdoptLegacyRows(kind)).toBe(false)
  })
})

describe('cuenta de coach', () => {
  it('sin atleta activo es none, NUNCA self', () => {
    const kind = resolveAthleteScopeKind({ accountRole: 'coach', activeAthleteId: null, selfAthleteId: null })
    expect(kind).toBe('none')
    expect(canAdoptLegacyRows(kind)).toBe(false)
  })
  it('con atleta activo es managed', () => {
    expect(resolveAthleteScopeKind({ accountRole: 'coach', activeAthleteId: 'a2', selfAthleteId: null })).toBe('managed')
  })
  it('nunca alcanza self, ni con selfAthleteId poblado', () => {
    expect(resolveAthleteScopeKind({ accountRole: 'coach', activeAthleteId: 'a1', selfAthleteId: 'a1' })).toBe('managed')
  })
})

describe('rol unknown', () => {
  it('siempre none y sin adopción legacy', () => {
    for (const activeAthleteId of [null, 'a1']) {
      const kind = resolveAthleteScopeKind({ accountRole: 'unknown', activeAthleteId, selfAthleteId: 'a1' })
      expect(kind).toBe('none')
      expect(canAdoptLegacyRows(kind)).toBe(false)
    }
  })
})
```

```ts
// src/services/entitlements/__tests__/entitlementRoleMirror.test.ts
import { describe, expect, it } from 'vitest'
import { readStoredEntitlementRole } from '../entitlementService'

describe('espejo local del rol', () => {
  it('un espejo con rol válido lo devuelve', () => {
    expect(readStoredEntitlementRole({
      userId: 'u1', tier: 'advanced', expiresAt: null, confirmedAt: 1, accountRole: 'coach',
    })).toBe('coach')
  })

  it('un espejo VIEJO sin rol resuelve unknown, no athlete', () => {
    // Un espejo escrito antes de esta entrega no sabe nada del rol. Tratarlo
    // como `athlete` le daría a una cuenta coach el scope self por omisión.
    expect(readStoredEntitlementRole({
      userId: 'u1', tier: 'advanced', expiresAt: null, confirmedAt: 1,
    } as never)).toBe('unknown')
  })

  it('un rol corrupto resuelve unknown', () => {
    expect(readStoredEntitlementRole({
      userId: 'u1', tier: 'free', expiresAt: null, confirmedAt: 1, accountRole: 'wat',
    } as never)).toBe('unknown')
  })

  it('espejo ausente resuelve unknown', () => {
    expect(readStoredEntitlementRole(null)).toBe('unknown')
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/services/athlete/__tests__/athleteScopeKind.test.ts src/services/entitlements/__tests__/entitlementRoleMirror.test.ts`
Expected: FAIL — no existen ni el módulo de scope ni `readStoredEntitlementRole`.

- [ ] **Step 3: Ampliar el espejo**

En `src/types/entitlement.ts`:

```ts
export interface StoredEntitlement {
  userId: string
  tier: Tier
  expiresAt: number | null
  confirmedAt: number
  /**
   * Ausente en espejos escritos antes de esta entrega. Su ausencia resuelve
   * `unknown`, NUNCA `athlete`: un espejo viejo no es evidencia de rol.
   */
  accountRole?: AccountRole
}
```

En `entitlementService.ts`, propagar `account_role` en la lectura remota (ya viene en `USER_ENTITLEMENT_SELECT` por la Task 1), persistirlo en el espejo, y exponer:

```ts
export function readStoredEntitlementRole(
  stored: StoredEntitlement | null | undefined,
): ResolvedAccountRole {
  if (!stored) return 'unknown'
  return parseAccountRole((stored as { accountRole?: unknown }).accountRole) ?? 'unknown'
}
```

La lectura remota usa el mismo criterio discriminado que el servidor: fila presente con rol válido → ese rol; **ausencia confirmada** de fila → `'athlete'`; fallo o rol corrupto → `'unknown'`.

- [ ] **Step 4: Holder y scope**

```ts
// src/services/entitlements/accountRoleHolder.ts
import type { ResolvedAccountRole } from './entitlementPolicy'

// Arranca en 'unknown': hasta que el bootstrap resuelva el rol, nada puede
// adoptar scope self por omisión.
let accountRole: ResolvedAccountRole = 'unknown'
export function getAccountRole(): ResolvedAccountRole { return accountRole }
export function setAccountRole(role: ResolvedAccountRole): void { accountRole = role }
```

```ts
// src/services/athlete/athleteScopeKind.ts
import type { ResolvedAccountRole } from '../entitlements/entitlementPolicy'

/**
 * Scope efectivo de la sesión. `none` falla cerrado: conjunto vacío y escritura
 * bloqueada, nunca un default permisivo. El ROL se resuelve antes que la
 * hidratación de atletas (§5.2), y por eso `none` es alcanzable de inmediato
 * para una cuenta coach sin depender de que la hidratación haya terminado.
 */
export type AthleteScopeKind = 'self' | 'managed' | 'none'

export function resolveAthleteScopeKind(input: {
  accountRole: ResolvedAccountRole
  activeAthleteId: string | null
  selfAthleteId: string | null
}): AthleteScopeKind {
  if (input.accountRole === 'unknown') return 'none'
  if (input.accountRole === 'coach') {
    return input.activeAthleteId == null ? 'none' : 'managed'
  }
  // Cuenta de atleta: comportamiento actual EXACTO, incluida la rama de
  // pre-hidratación que adopta filas legacy self-only.
  if (input.activeAthleteId == null) return 'self'
  return input.activeAthleteId === input.selfAthleteId ? 'self' : 'managed'
}

/** Las filas legacy/unscoped pertenecen SÓLO al self (política F2-lite). */
export function canAdoptLegacyRows(kind: AthleteScopeKind): boolean {
  return kind === 'self'
}
```

En `activeAthlete.ts`, reexpresar `isSelfScopeActive` sobre el resolutor conservando su firma, para no tocar los 27 consumidores:

```ts
export function isSelfScopeActive(): boolean {
  return canAdoptLegacyRows(resolveAthleteScopeKind({
    accountRole: getAccountRole(), activeAthleteId, selfAthleteId,
  }))
}
```

En `useEntitlementStore`, agregar `accountRole: ResolvedAccountRole` (inicial `'unknown'`), poblarlo desde espejo y remoto, llamar a `setAccountRole` en ambos, y volverlo a `'unknown'` en `reset`.

- [ ] **Step 5: Correr y verificar que pasan**

Run: `npx vitest run src/services/athlete src/services/entitlements src/store && npx tsc -b`
Expected: PASS. Los tests preexistentes de scope deben pasar **sin modificarse** cuando el rol es `'athlete'`. Si alguno falla por el arranque en `'unknown'`, es un problema de **orden de bootstrap** y lo cierra la Task 10 — anotarlo y no relajar el holder.

---

### Task 10: Bootstrap único, ordenado y con epoch

**Files:**
- Create: `src/services/bootstrap/sessionBootstrap.ts`
- Modify: `src/App.tsx:182,198,223`
- Test: `src/services/bootstrap/__tests__/sessionBootstrap.test.ts`

**Interfaces:**
- Consumes: `prepareLocalDataForUser`, `pullMemberships`, `backfillLocalAthleteScope`, `hydrateActiveAthlete`, `useEntitlementStore.hydrate` (Task 9).
- Produces: `runSessionBootstrap(userId, deps): Promise<void>`; `getBootstrapEpoch(): number`.

**Trampa verificada: son TRES efectos, no dos.** `App.tsx` tiene efectos con dependencia `[userId]` en `:182` (entitlement), `:198` (scope de atleta) y `:223` (sync), y **los dos últimos repiten** `db.open()`, `pullMemberships`, `backfillLocalAthleteScope` e `hydrateActiveAthlete` en paralelo. Fusionar sólo dos deja el tercero corriendo contra Dexie antes de que se conozcan la frontera de cuenta y el rol.

**Y el backfill legacy no debe correr para un coach.** `backfillLocalAthleteScope` estampa filas legacy bajo el self; una cuenta coach no tiene self, así que ejecutarlo sería adoptar datos ajenos por otra puerta.

**Un epoch que sólo se comprueba DESPUÉS de cada `await` no protege la frontera de cuenta.** `prepareLocalDataForUser` es la operación destructiva del arranque: borra y reescribe Dexie y mueve `LAST_SYNC_USER_KEY`. Si la comprobación de obsolescencia vive únicamente después de ese `await`, dos bootstraps `u1 → u2` **pueden estar dentro de la frontera al mismo tiempo**: el de `u1` ya la empezó, el de `u2` la empieza igual, y el epoch recién los separa cuando ambas ya escribieron. El resultado no es "una gana": es Dexie mutada por dos dueños distintos y una clave de última cuenta que puede quedar apuntando a cualquiera de los dos.

El test de la versión anterior de esta task **no reproducía esa carrera**: lanzaba `u2` desde dentro de `hydrateRole`, es decir, con la frontera de `u1` ya terminada. Sólo demostraba que un bootstrap obsoleto deja de escribir *después*, que es la parte fácil.

La corrección es **serializar globalmente la frontera**: el epoch se toma de forma **síncrona** en la llamada —para que `u2` invalide a `u1` en el instante en que el usuario cambia, sin esperar ningún `await`— y la ejecución entra por una cadena de módulo, así que una corrida nunca empieza su frontera mientras otra la tiene abierta. Un bootstrap que quedó obsoleto **esperando su turno** aborta antes de tocar Dexie: nunca llega a la operación destructiva. La alternativa —hacer que `prepareLocalDataForUser` compruebe una generación adentro, en cada paso destructivo— es igual de válida y más invasiva; se descarta por eso, no por ser incorrecta.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/services/bootstrap/__tests__/sessionBootstrap.test.ts
import { describe, expect, it, vi } from 'vitest'
import { getBootstrapEpoch, runSessionBootstrap } from '../sessionBootstrap'

function deps(calls: string[], over: Record<string, unknown> = {}) {
  return {
    prepareLocalDataForUser: vi.fn(async () => { calls.push('boundary') }),
    hydrateRole: vi.fn(async () => { calls.push('role'); return 'athlete' as const }),
    pullMemberships: vi.fn(async () => { calls.push('memberships') }),
    backfillLegacyScope: vi.fn(async () => { calls.push('backfill'); return 0 }),
    hydrateAthleteScope: vi.fn(async () => { calls.push('scope') }),
    runFullSync: vi.fn(async () => { calls.push('sync') }),
    ...over,
  }
}

describe('orden', () => {
  it('frontera → rol → membresías → backfill → scope → sync', async () => {
    const calls: string[] = []
    await runSessionBootstrap('u1', deps(calls))
    expect(calls).toEqual(['boundary', 'role', 'memberships', 'backfill', 'scope', 'sync'])
  })

  it('nada corre si falla la frontera de cuenta', async () => {
    const calls: string[] = []
    const d = deps(calls, { prepareLocalDataForUser: vi.fn(async () => { throw new Error('boom') }) })
    await expect(runSessionBootstrap('u1', d)).rejects.toThrow('boom')
    expect(d.hydrateRole).not.toHaveBeenCalled()
    expect(d.runFullSync).not.toHaveBeenCalled()
  })

  it('rol unknown corta antes de tocar Dexie', async () => {
    const calls: string[] = []
    const d = deps(calls, { hydrateRole: vi.fn(async () => { calls.push('role'); return 'unknown' as const }) })
    await runSessionBootstrap('u1', d)
    expect(calls).toEqual(['boundary', 'role'])
    expect(d.backfillLegacyScope).not.toHaveBeenCalled()
    expect(d.hydrateAthleteScope).not.toHaveBeenCalled()
  })

  it('una cuenta coach NO corre el backfill legacy', async () => {
    // backfillLocalAthleteScope estampa filas legacy bajo el self; un coach no
    // tiene self, así que correrlo sería adoptar datos ajenos.
    const calls: string[] = []
    const d = deps(calls, { hydrateRole: vi.fn(async () => { calls.push('role'); return 'coach' as const }) })
    await runSessionBootstrap('u1', d)
    expect(d.backfillLegacyScope).not.toHaveBeenCalled()
    expect(calls).toEqual(['boundary', 'role', 'memberships', 'scope', 'sync'])
  })
})

describe('cambio rápido de cuenta', () => {
  it('u1 → u2 aborta el bootstrap de u1 en el primer punto de control', async () => {
    const calls: string[] = []
    const slow = deps(calls, {
      hydrateRole: vi.fn(async () => {
        calls.push('role')
        void runSessionBootstrap('u2', deps(calls))  // el usuario cambió
        return 'athlete' as const
      }),
    })
    await runSessionBootstrap('u1', slow)
    // El de u1 no debe seguir escribiendo después de que u2 tomó el epoch.
    expect(slow.hydrateAthleteScope).not.toHaveBeenCalled()
  })

  it('DOS fronteras nunca se solapan: u2 espera a que la de u1 termine', async () => {
    // Ésta es la carrera peligrosa, y el test anterior NO la reproduce: ahí u2
    // arranca con la frontera de u1 ya cerrada. Acá u2 llega mientras u1 está
    // dentro de prepareLocalDataForUser, que borra y reescribe Dexie y mueve
    // LAST_SYNC_USER_KEY.
    const events: string[] = []
    let releaseFirst = () => {}
    const first = deps([], {
      prepareLocalDataForUser: vi.fn(async () => {
        events.push('u1:boundary:start')
        await new Promise<void>((resolve) => { releaseFirst = resolve })
        events.push('u1:boundary:end')
      }),
    })
    const second = deps([], {
      prepareLocalDataForUser: vi.fn(async () => { events.push('u2:boundary:start') }),
    })

    const p1 = runSessionBootstrap('u1', first)
    const p2 = runSessionBootstrap('u2', second)   // el usuario cambió AHORA
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).toEqual(['u1:boundary:start'])  // u2 no entró todavía

    releaseFirst()
    await Promise.all([p1, p2])

    expect(events).toEqual([
      'u1:boundary:start', 'u1:boundary:end', 'u2:boundary:start',
    ])
    // u1 quedó obsoleto en cuanto se llamó a u2, así que no siguió.
    expect(first.hydrateRole).not.toHaveBeenCalled()
    expect(second.hydrateRole).toHaveBeenCalled()
  })

  it('un bootstrap obsoleto esperando turno NO llega a tocar Dexie', async () => {
    const events: string[] = []
    let releaseFirst = () => {}
    const first = deps([], {
      prepareLocalDataForUser: vi.fn(async () => {
        await new Promise<void>((resolve) => { releaseFirst = resolve })
      }),
    })
    const stale = deps([], {
      prepareLocalDataForUser: vi.fn(async () => { events.push('stale:boundary') }),
    })
    const winner = deps([], {
      prepareLocalDataForUser: vi.fn(async () => { events.push('winner:boundary') }),
    })

    const p1 = runSessionBootstrap('u1', first)
    const p2 = runSessionBootstrap('u2', stale)
    const p3 = runSessionBootstrap('u3', winner)   // u2 quedó obsoleto en la cola
    await new Promise((resolve) => setTimeout(resolve, 0))
    releaseFirst()
    await Promise.all([p1, p2, p3])

    expect(stale.prepareLocalDataForUser).not.toHaveBeenCalled()
    expect(events).toEqual(['winner:boundary'])
  })

  it('una frontera que falla no deja la cadena rota', async () => {
    const boom = deps([], {
      prepareLocalDataForUser: vi.fn(async () => { throw new Error('boom') }),
    })
    await expect(runSessionBootstrap('u1', boom)).rejects.toThrow('boom')

    const after = deps([])
    await runSessionBootstrap('u2', after)
    expect(after.runFullSync).toHaveBeenCalled()
  })

  it('el epoch avanza en cada corrida', async () => {
    const before = getBootstrapEpoch()
    await runSessionBootstrap('u1', deps([]))
    expect(getBootstrapEpoch()).toBeGreaterThan(before)
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/bootstrap/__tests__/sessionBootstrap.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

```ts
// src/services/bootstrap/sessionBootstrap.ts
import type { ResolvedAccountRole } from '../entitlements/entitlementPolicy'

export interface SessionBootstrapDeps {
  prepareLocalDataForUser: (userId: string) => Promise<unknown>
  hydrateRole: (userId: string) => Promise<ResolvedAccountRole>
  pullMemberships: (userId: string) => Promise<unknown>
  backfillLegacyScope: (userId: string) => Promise<unknown>
  hydrateAthleteScope: (userId: string) => Promise<unknown>
  runFullSync: (userId: string) => Promise<unknown>
}

let epoch = 0
let chain: Promise<unknown> = Promise.resolve()

export function getBootstrapEpoch(): number { return epoch }

/**
 * Secuencia ÚNICA de arranque. Reemplaza los tres efectos paralelos de App.tsx
 * (`:182` entitlement, `:198` scope, `:223` sync), que repetían pullMemberships
 * y backfill contra Dexie sin orden garantizado (§4.7).
 *
 * DOS mecanismos distintos, y hacen falta los dos:
 *
 * 1. El epoch se toma de forma SÍNCRONA acá, no dentro de la parte async: así
 *    un cambio de cuenta invalida la corrida anterior en el instante en que
 *    ocurre, sin esperar a que ningún `await` resuelva.
 * 2. La ejecución entra por una cadena de módulo, así que dos corridas NUNCA
 *    están dentro de `prepareLocalDataForUser` a la vez. Esa función borra y
 *    reescribe Dexie y mueve LAST_SYNC_USER_KEY; con sólo el epoch, dos
 *    fronteras `u1 → u2` podían solaparse y la comprobación llegaba tarde.
 *
 * La cadena se continúa incluso cuando una corrida falla: un error de arranque
 * no puede dejar bloqueado el arranque siguiente.
 */
export function runSessionBootstrap(
  userId: string,
  deps: SessionBootstrapDeps,
): Promise<void> {
  const mine = ++epoch
  const run = chain.then(() => executeBootstrap(userId, deps, mine))
  chain = run.then(() => undefined, () => undefined)
  return run
}

async function executeBootstrap(
  userId: string,
  deps: SessionBootstrapDeps,
  mine: number,
): Promise<void> {
  const stale = () => epoch !== mine

  // Antes de la frontera, no después: una corrida que quedó obsoleta esperando
  // su turno no debe tocar Dexie en absoluto.
  if (stale()) return

  await deps.prepareLocalDataForUser(userId)
  if (stale()) return

  const role = await deps.hydrateRole(userId)
  if (stale()) return
  // Con el rol ilegible no se toca Dexie: quedaría en `none` igual y cualquier
  // escritura sería sobre datos de dueño desconocido.
  if (role === 'unknown') return

  await deps.pullMemberships(userId)
  if (stale()) return

  // Sólo para cuentas de atleta: el backfill estampa filas legacy bajo el self.
  if (role === 'athlete') {
    await deps.backfillLegacyScope(userId)
    if (stale()) return
  }

  await deps.hydrateAthleteScope(userId)
  if (stale()) return

  await deps.runFullSync(userId)
}
```

- [ ] **Step 4: Reemplazar los tres efectos de `App.tsx`**

Borrar los efectos de `:182`, `:198` y `:223` y dejar **uno**:

```tsx
  useEffect(() => {
    if (!userId) {
      useEntitlementStore.getState().reset()
      return
    }
    void runSessionBootstrap(userId, {
      prepareLocalDataForUser,
      hydrateRole: async (id) => {
        await useEntitlementStore.getState().hydrate(id)
        return useEntitlementStore.getState().accountRole
      },
      pullMemberships,
      backfillLegacyScope: backfillLocalAthleteScope,
      hydrateAthleteScope: async (id) => {
        await hydrateActiveAthlete(id)
        useAuthStore.getState().setActiveAthleteId(getActiveAthleteId())
      },
      runFullSync: syncSignedInUser,
    }).catch((error) => console.error('[bootstrap] failed', error))
  }, [userId])
```

Conservar los listeners de `online`/`visible`/`focus` del efecto `:223`, que **no** son parte del arranque: registrarlos en su propio efecto y hacer que llamen a `syncSignedInUser` directamente, con su cooldown intacto. Conservar también `db.open()` y `capturePendingClaimTokenFromUrl()` en el efecto sin dependencias de `:176`, que ya corre antes.

- [ ] **Step 5: Correr y verificar que pasan**

Run: `npx vitest run src/services/bootstrap src/services/athlete src/store src/services/sync && npx tsc -b`
Expected: PASS, incluidos los tests que la Task 9 dejó anotados.

**Límite declarado.** Esto serializa las fronteras **dentro de una pestaña**. Dos pestañas de la misma app siguen pudiendo abrir su frontera a la vez: la cadena es un singleton de módulo, no un lease compartido. No se amplía acá porque el contrato multi-tab del proyecto ya está declarado como no cubierto (§Coach Workspace, borrado de roster), y resolverlo pide un lease durable, que es una pieza propia.

---

### Task 11: Modo auditoría — legacy manda, role-aware se registra

**Files:**
- Create: `src/services/entitlements/coachAuthzMode.ts`
- Modify: `netlify/functions/coach.ts:1926`
- Test: `src/services/entitlements/__tests__/coachAuthzMode.test.ts`

**Interfaces:**
- Consumes: `resolveCapability` con `roleGate` (Task 4); `readEntitlementRecord` (Task 2); `targetAthleteId` validado (Task 5).
- Produces: `CoachAuthzMode = 'audit' | 'enforce'`; `resolveCoachAuthzMode(env)`; `reconcileDecision(legacy, shadow, mode)`.

**La semántica correcta, que la versión anterior de este plan tenía mal.** La decisión **efectiva** en `audit` debe reproducir el comportamiento **legacy** (`roleGate: 'off'`); si aplicara el gate nuevo, no habría con qué comparar. Los dos casos que la auditoría debe producir son:

| Caso | Legacy (manda) | Sombra | Registro |
|---|---|---|---|
| Atleta `advanced` pidiendo `coach_assistant_message` | permitido | denegado | `wouldDeny` |
| Coach `free` pidiendo `coach_assistant_message` | denegado | permitido | `wouldGrant` |

**Y un rol `unreadable` es `503` antes de reconciliar nada.** No se compara una decisión construida sobre un rol que no se pudo leer.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/services/entitlements/__tests__/coachAuthzMode.test.ts
import { describe, expect, it } from 'vitest'
import { reconcileDecision, resolveCoachAuthzMode } from '../coachAuthzMode'
import { resolveCapability } from '../resolveCapability'

const NOW = 1_700_000_000_000
function pair(over: { accountRole: 'athlete' | 'coach'; tier: 'free' | 'advanced' }) {
  const shared = {
    actorUserId: 'u1', targetAthleteId: null, capability: 'coach_assistant_message' as const,
    now: NOW, entitlement: { tier: over.tier, expiresAt: null }, membership: null,
  }
  return {
    legacy: resolveCapability({ ...shared, accountRole: 'athlete', roleGate: 'off' as const }),
    shadow: resolveCapability({ ...shared, accountRole: over.accountRole, roleGate: 'on' as const }),
  }
}

describe('resolveCoachAuthzMode', () => {
  it('sólo el literal enforce enciende el corte', () => {
    expect(resolveCoachAuthzMode({ COACH_AUTHZ_MODE: 'enforce' } as NodeJS.ProcessEnv)).toBe('enforce')
    for (const value of ['audit', 'ENFORCE', 'true', '', undefined]) {
      expect(resolveCoachAuthzMode({ COACH_AUTHZ_MODE: value } as NodeJS.ProcessEnv)).toBe('audit')
    }
  })
})

describe('los dos casos que la auditoría debe producir', () => {
  it('atleta advanced: permitido hoy, wouldDeny', () => {
    const { legacy, shadow } = pair({ accountRole: 'athlete', tier: 'advanced' })
    expect(legacy.allowed).toBe(true)
    expect(shadow.allowed).toBe(false)
    const out = reconcileDecision(legacy, shadow, 'audit')
    expect(out.decision).toBe(legacy)
    expect(out.audit).toMatchObject({ wouldDeny: true, wouldGrant: false })
  })

  it('coach free: denegado hoy, wouldGrant', () => {
    const { legacy, shadow } = pair({ accountRole: 'coach', tier: 'free' })
    expect(legacy.allowed).toBe(false)
    expect(shadow.allowed).toBe(true)
    const out = reconcileDecision(legacy, shadow, 'audit')
    expect(out.decision).toBe(legacy)
    expect(out.audit).toMatchObject({ wouldDeny: false, wouldGrant: true })
  })
})

describe('reconcileDecision', () => {
  it('en enforce devuelve la sombra', () => {
    const { legacy, shadow } = pair({ accountRole: 'coach', tier: 'free' })
    expect(reconcileDecision(legacy, shadow, 'enforce').decision).toBe(shadow)
  })
  it('no registra nada cuando coinciden', () => {
    const { legacy } = pair({ accountRole: 'athlete', tier: 'advanced' })
    expect(reconcileDecision(legacy, legacy, 'audit').audit).toBeNull()
  })
  it('el registro no lleva identificadores de persona', () => {
    const { legacy, shadow } = pair({ accountRole: 'coach', tier: 'free' })
    expect(JSON.stringify(reconcileDecision(legacy, shadow, 'audit').audit)).not.toContain('u1')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/entitlements/__tests__/coachAuthzMode.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

```ts
// src/services/entitlements/coachAuthzMode.ts
import type { CapabilityDecision } from './resolveCapability'

export type CoachAuthzMode = 'audit' | 'enforce'

/** Sólo el literal exacto enciende el corte; cualquier otra cosa es `audit`. */
export function resolveCoachAuthzMode(env: NodeJS.ProcessEnv = process.env): CoachAuthzMode {
  return env['COACH_AUTHZ_MODE'] === 'enforce' ? 'enforce' : 'audit'
}

export interface CoachAuthzAudit {
  capability: string
  legacyAllowed: boolean
  shadowAllowed: boolean
  wouldDeny: boolean
  wouldGrant: boolean
  entitlementSource: CapabilityDecision['entitlementSource']
  hadSubjectCap: boolean
}

/**
 * En `audit` manda la decisión LEGACY y la role-aware sólo se registra. En
 * `enforce` manda la role-aware. El registro lleva sólo claves estructuradas:
 * nunca ids de usuario ni de atleta.
 */
export function reconcileDecision(
  legacy: CapabilityDecision,
  shadow: CapabilityDecision,
  mode: CoachAuthzMode,
): { decision: CapabilityDecision; audit: CoachAuthzAudit | null } {
  if (mode === 'enforce') return { decision: shadow, audit: null }
  if (legacy.allowed === shadow.allowed) return { decision: legacy, audit: null }
  return {
    decision: legacy,
    audit: {
      capability: legacy.capability,
      legacyAllowed: legacy.allowed,
      shadowAllowed: shadow.allowed,
      wouldDeny: legacy.allowed && !shadow.allowed,
      wouldGrant: !legacy.allowed && shadow.allowed,
      entitlementSource: shadow.entitlementSource,
      hadSubjectCap: shadow.quotaSubject != null,
    },
  }
}
```

- [ ] **Step 4: Cablear `coach.ts`**

```ts
const record = await readEntitlementRecord(token)
// Un rol ilegible corta ANTES de reconciliar: no se compara una decisión
// construida sobre un rol que no se pudo leer.
if (record.status === 'unreadable') {
  throw makeServerError('No se pudo resolver el plan de la cuenta.')
}
const entitlement = record.status === 'present' ? record.row : null
const accountRole = record.status === 'present' ? record.accountRole : 'athlete'

const membership = payload.targetAthleteId
  ? await readVerifiedMembership(token, payload.targetAthleteId)
  : null

const shared = { actorUserId: userId, capability: requestClass, now: Date.now(), entitlement } as const
const legacy = resolveCapability({ ...shared, targetAthleteId: null, accountRole: 'athlete', membership: null, roleGate: 'off' })
const shadow = resolveCapability({ ...shared, targetAthleteId: payload.targetAthleteId, accountRole, membership, roleGate: 'on' })

const { decision, audit } = reconcileDecision(legacy, shadow, resolveCoachAuthzMode())
if (audit) console.info('[coach-authz]', audit)
```

`readVerifiedMembership` es una lectura nueva en `resolveEntitlement.ts`: consulta `athlete_memberships` filtrando `athlete_id` con el **token del usuario** —la RLS de `013b` ya restringe a `account_id = auth.uid()`— y devuelve `{ athleteId, role }` o `null`. Un fallo de lectura devuelve `null`, que deniega la delegación: fail-closed.

- [ ] **Step 5: Correr y verificar que pasan**

Run: `npx vitest run src/services/entitlements netlify/functions && npx tsc -b`
Expected: PASS.

---

### Task 12: Backfill y equivalencia por (tabla, comando)

**Files:**
- Create: `supabase/queries/2026-09-02-membership-backfill.sql`
- Create: `supabase/queries/2026-09-02-membership-equivalence.sql`
- Create: `docs/superpowers/smokes/2026-09-02-coach-authz-audit.md`

**Interfaces:**
- Consumes: `030` aplicada.
- Produces: la evidencia que habilita la Entrega 1b.

**Dos trampas verificadas:**

1. **El id del atleta self es `ath_<uuid CON guiones>`** (`athleteScopeMigration.ts:12`: `` `ath_${ownerAccountId}` ``), y los gestionados son `ath_m_<uuid>`. Una heurística que quite guiones no coincide con nada. Pero **no hace falta heurística de id**: `013b` ya clasifica por `linked_account_id`, y hay que copiar exactamente ese criterio.

   **Y ese criterio trata `linked_account_id IS NULL` como `coach`, no como `self`.** `seed_membership_for_new_athlete` sólo elige `self` cuando `linked_account_id = owner_account_id`; cualquier otra cosa, **NULL incluido**, produce `coach` (misma trampa que la Task 8 §1). Agrupar el nulo con el caso self —como hacía la primera versión de este backfill— inventaría membresías `self` para todos los atletas gestionados del padrón actual, que es justamente el caso mayoritario: los gestionados se crean con `linked_account_id` nulo. La clasificación correcta son **tres** ramas, no dos:

   | `linked_account_id` | Membresía que corresponde |
   |---|---|
   | `= owner_account_id` | owner → `self` |
   | `IS NULL` | owner → `coach` |
   | `<> owner_account_id` | linked → `self`, y owner → `coach` |

   Un backfill que contradiga al trigger no sólo escribe filas equivocadas: hace que la equivalencia de los Pasos 3 y 4 mida contra un padrón que el propio trigger nunca habría producido.
2. **Las consultas deben modelar las policies reales, por (tabla, comando) y en ambas direcciones.** Una comparación global sobre `athletes` puede dar cero y aun así `031` retiraría acceso válido, porque las policies legacy de las tablas hijas incluyen predicados por `user_id` que no se derivan de `athletes`.

- [ ] **Step 1: Escribir el backfill, con la clasificación de `013b`**

```sql
-- supabase/queries/2026-09-02-membership-backfill.sql
-- Idempotente. SÓLO escribe membresías: no borra, no transfiere, no reparenta.
-- La clasificación es la MISMA de 013b §3, por linked_account_id. No se usa
-- ninguna heurística sobre el formato del id.

-- 1. linked = owner  ->  el owner es 'self'.
insert into public.athlete_memberships (athlete_id, account_id, role, created_at, updated_at)
select a.id, a.owner_account_id, 'self', a.created_at, a.updated_at
from public.athletes a
where a.linked_account_id = a.owner_account_id
on conflict (athlete_id, account_id) do nothing;

-- 2. linked NULO  ->  el owner es 'coach'. NO es un self: el trigger de 013b
--    trata el nulo como gestionado, y así se creó todo el roster actual.
insert into public.athlete_memberships (athlete_id, account_id, role, created_at, updated_at)
select a.id, a.owner_account_id, 'coach', a.created_at, a.updated_at
from public.athletes a
where a.linked_account_id is null
on conflict (athlete_id, account_id) do nothing;

-- 3. linked distinto del owner  ->  el linked es 'self' y el owner es 'coach'.
insert into public.athlete_memberships (athlete_id, account_id, role, created_at, updated_at)
select a.id, a.linked_account_id, 'self', a.created_at, a.updated_at
from public.athletes a
where a.linked_account_id is not null and a.linked_account_id <> a.owner_account_id
on conflict (athlete_id, account_id) do nothing;

insert into public.athlete_memberships (athlete_id, account_id, role, created_at, updated_at)
select a.id, a.owner_account_id, 'coach', a.created_at, a.updated_at
from public.athletes a
where a.linked_account_id is not null and a.linked_account_id <> a.owner_account_id
on conflict (athlete_id, account_id) do nothing;

-- Verificación A: el backfill coincide con el trigger de 013b. Cero filas.
-- Cualquier membresía cuyo rol no sea el que `seed_membership_for_new_athlete`
-- habría elegido para ese atleta es un error de clasificación, no un matiz.
select m.athlete_id, m.account_id, m.role as rol_backfill,
       case when a.linked_account_id is not distinct from a.owner_account_id
            then 'self' else 'coach' end as rol_trigger
from public.athlete_memberships m
join public.athletes a on a.id = m.athlete_id
where m.account_id = a.owner_account_id
  and m.role <> case when a.linked_account_id is not distinct from a.owner_account_id
                     then 'self' else 'coach' end;

-- Verificación B: ningún par (atleta, cuenta) alcanzable quedó sin membresía. Cero.
select count(*) as pares_sin_membresia from (
  select a.id, a.owner_account_id as acct from public.athletes a
  union
  select a.id, a.linked_account_id from public.athletes a where a.linked_account_id is not null
) p
where p.acct is not null and not exists (
  select 1 from public.athlete_memberships m where m.athlete_id = p.id and m.account_id = p.acct
);
```

- [ ] **Step 2: Volcar las policies reales ANTES de escribir la equivalencia**

Las consultas de equivalencia se escriben **contra el volcado**, no contra el repo (§4.8). Primero:

```sql
select tablename, policyname, cmd, permissive, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('athletes','sessions','day_logs','week_summaries','chat_messages',
                    'coach_proposals','athlete_profiles','training_plans','training_plan_weeks',
                    'readiness_daily','whoop_workouts')
order by tablename, cmd, policyname;
```

Pegar la salida completa en el documento de evidencia. **Cada fila cuyo `qual` o `with_check` mencione `user_id`, `owner_account_id` o `linked_account_id` es una policy legacy** y necesita su par de consultas de equivalencia; cada una que mencione `auth_athlete_ids` o `auth_coach_athlete_ids` es v2.

- [ ] **Step 3: Escribir la equivalencia por (tabla, comando)**

```sql
-- supabase/queries/2026-09-02-membership-equivalence.sql
-- Se completa DESPUÉS del volcado del Paso 2: una sección por cada par
-- (tabla, comando) que el volcado haya mostrado, en AMBAS direcciones.
-- Cada bloque debe devolver cero filas inexplicadas.

-- ── A. athletes, por comando ───────────────────────────────────────────────
-- A1 SELECT legacy-only
select 'athletes/select/legacy_only' as caso, a.id as athlete_id, u.id as account_id
from public.athletes a
join auth.users u on (u.id = a.owner_account_id or u.id = a.linked_account_id)
where not exists (select 1 from public.athlete_memberships m
                  where m.athlete_id = a.id and m.account_id = u.id);

-- A2 SELECT membership-only
select 'athletes/select/membership_only' as caso, m.athlete_id, m.account_id
from public.athlete_memberships m
join public.athletes a on a.id = m.athlete_id
where a.owner_account_id is distinct from m.account_id
  and a.linked_account_id is distinct from m.account_id;

-- A3 UPDATE: legacy = owner; v2 = auth_athlete_ids() ∪ auth_coach_athlete_ids().
select 'athletes/update/legacy_only' as caso, a.id as athlete_id, a.owner_account_id as account_id
from public.athletes a
where not exists (select 1 from public.athlete_memberships m
                  where m.athlete_id = a.id and m.account_id = a.owner_account_id);

-- A4 INSERT y A5 DELETE: reemplazados por RPC más restrictivas (§7.1). Su
-- diferencia es ESPERADA y debe coincidir EXACTAMENTE con la lista enumerada
-- del documento de evidencia. Enumerar acá los casos y contarlos:
--   (i)  una cuenta athlete con self ya existente no puede crear otro;
--   (ii) una cuenta athlete no puede crear gestionados;
--   (iii) un atleta con membresía self no se puede borrar por el camino de roster.
select 'athletes/insert/intentional' as caso, count(*) as cuentas_con_self
from public.athlete_memberships where role = 'self';

-- ── B. Tablas hijas, SELECT ────────────────────────────────────────────────
-- Legacy `<tbl>_select_by_athlete`: athlete_id in (athletes de owner/linked).
with legacy as (
  select u.id as account_id, a.id as athlete_id
  from auth.users u
  join public.athletes a on (a.owner_account_id = u.id or a.linked_account_id = u.id)
),
membership as (select account_id, athlete_id from public.athlete_memberships)
select 'children/select/legacy_only' as caso, l.account_id, l.athlete_id from legacy l
where not exists (select 1 from membership m where m.account_id = l.account_id and m.athlete_id = l.athlete_id)
union all
select 'children/select/membership_only', m.account_id, m.athlete_id from membership m
where not exists (select 1 from legacy l where l.account_id = m.account_id and l.athlete_id = m.athlete_id);

-- ── C. Filas sin athlete_id: el caso que la membresía NO puede alcanzar ─────
-- Las policies v2 usan `athlete_id in (...)`, que es FALSE cuando la columna es
-- null. Toda fila unscoped que hoy se alcance por una policy legacy de user_id
-- PIERDE acceso con 031. Estas cuentas deben dar cero, o resolverse antes.
select 'sessions' as tabla, count(*) as filas_sin_athlete_id from public.sessions where athlete_id is null
union all select 'day_logs', count(*) from public.day_logs where athlete_id is null
union all select 'week_summaries', count(*) from public.week_summaries where athlete_id is null
union all select 'chat_messages', count(*) from public.chat_messages where athlete_id is null
union all select 'coach_proposals', count(*) from public.coach_proposals where athlete_id is null
union all select 'athlete_profiles', count(*) from public.athlete_profiles where athlete_id is null
union all select 'training_plans', count(*) from public.training_plans where athlete_id is null
union all select 'training_plan_weeks', count(*) from public.training_plan_weeks where athlete_id is null
union all select 'whoop_workouts', count(*) from public.whoop_workouts where athlete_id is null;

-- ── D. Escritura, ambas direcciones, por tabla ─────────────────────────────
-- Para day_logs/week_summaries/chat_messages/athlete_profiles la v2 es
-- auth_athlete_ids(); para coach_proposals/training_plans/training_plan_weeks
-- pasa a ser auth_athlete_ids() tras 030. sessions tiene su propio predicado
-- por authored_by_role y se compara aparte.
with legacy_write as (
  select u.id as account_id, a.id as athlete_id
  from auth.users u join public.athletes a on a.owner_account_id = u.id
),
membership as (select account_id, athlete_id from public.athlete_memberships)
select 'children/write/legacy_only' as caso, l.account_id, l.athlete_id from legacy_write l
where not exists (select 1 from membership m where m.account_id = l.account_id and m.athlete_id = l.athlete_id)
union all
select 'children/write/membership_only', m.account_id, m.athlete_id from membership m
where not exists (select 1 from legacy_write l where l.account_id = m.account_id and l.athlete_id = m.athlete_id);
```

**Si el volcado del Paso 2 muestra policies legacy con predicados por `user_id` que no se derivan de `athletes`** —las anteriores a `007`—, agregar una sección por cada una comparando el conjunto de filas alcanzables por `user_id` contra el alcanzable por `athlete_id in (auth_athlete_ids())`. Ésa es la comparación que las secciones B y D **no** cubren.

- [ ] **Step 4: Escribir el documento de evidencia**

Crear `docs/superpowers/smokes/2026-09-02-coach-authz-audit.md` con secciones para pegar: (1) volcado completo de `pg_policies`; (2) salida del backfill y su conteo en cero; (3) salida de cada bloque de equivalencia, identificado por (tabla, comando); (4) conteo de filas sin `athlete_id` por tabla; (5) **lista enumerada y firmada** de restricciones intencionales, cada una con su caso; (6) muestra de registros `[coach-authz]` con `wouldDeny`/`wouldGrant` observados en la ventana de auditoría.

**Criterio de salida de la Entrega 1a:** cero diferencias **inexplicadas** en todos los pares (tabla, comando), correspondencia **exacta y bidireccional** entre las diferencias observadas y la lista enumerada, y **cero filas sin `athlete_id`** en las nueve tablas, incluida `whoop_workouts`. Una diferencia sin caso, o un caso sin diferencia, es bloqueante por igual.

- [ ] **Step 5: Verificación**

No hay test automatizado: la salida es evidencia de producción. Lo que sí se verifica localmente es que las consultas parsean, revisándolas con el owner antes de ejecutarlas.

---

### Task 13: Gate final y guion de rollout de 1a

**Files:**
- Create: `docs/superpowers/smokes/2026-09-02-coach-role-1a-rollout.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: el guion que el owner ejecuta.

- [ ] **Step 1: Gate local completo**

Run: `npm run lint && npm test && npx tsc -b && npm run build && git diff --check`
Expected: los cinco verdes. Registrar el conteo y compararlo con la línea base de **515 archivos / 4145 tests**.

- [ ] **Step 2: Escribir el guion**

**Paso 0 — precondición de `013`, con la consulta que muestra lo que falta.** No basta un `select * from pg_policies`: hay que hacer `LEFT JOIN` contra la lista esperada para que una policy ausente **aparezca como fila**, en vez de tener que notar su ausencia a ojo. Son 25 al incluir `readiness_daily_select`; para ésta también se inspecciona `qual`, porque el nombre ya existía antes de `013b`.

```sql
with esperadas(tablename, policyname) as (values
  ('athletes','athletes_select_membership'),
  ('athletes','athletes_write_coach'),
  ('athletes','athletes_update_self'),
  ('sessions','sessions_select_membership'),
  ('sessions','sessions_insert_membership'),
  ('sessions','sessions_update_membership'),
  ('sessions','sessions_delete_membership'),
  ('day_logs','day_logs_select_membership'),
  ('day_logs','day_logs_write_membership'),
  ('week_summaries','week_summaries_select_membership'),
  ('week_summaries','week_summaries_write_membership'),
  ('chat_messages','chat_messages_select_membership'),
  ('chat_messages','chat_messages_write_membership'),
  ('athlete_profiles','athlete_profiles_select_membership'),
  ('athlete_profiles','athlete_profiles_write_membership'),
  ('coach_proposals','coach_proposals_select_membership'),
  ('coach_proposals','coach_proposals_write_coach'),
  ('training_plans','training_plans_select_membership'),
  ('training_plans','training_plans_write_coach'),
  ('training_plan_weeks','training_plan_weeks_select_membership'),
  ('training_plan_weeks','training_plan_weeks_write_coach'),
  ('athlete_memberships','athlete_memberships_select_own'),
  ('athlete_coach_notes','athlete_coach_notes_select'),
  ('athlete_coach_notes','athlete_coach_notes_write'),
  ('readiness_daily','readiness_daily_select')
)
select e.tablename, e.policyname,
       case
         when p.policyname is null then 'FALTA'
         when e.tablename = 'readiness_daily'
           and coalesce(p.qual, '') not ilike '%auth_athlete_ids%'
           then 'FALTA_V2'
         else 'ok'
       end as estado,
       p.cmd,
       p.qual
from esperadas e
left join pg_policies p
  on p.schemaname = 'public' and p.tablename = e.tablename and p.policyname = e.policyname
order by estado desc, e.tablename, e.policyname;
```

**Si aparece cualquier fila en `FALTA` o `FALTA_V2`, detenerse:** `013b` no está completa y todo el plan la supone. `FALTA_V2` detecta que `readiness_daily_select` conserva el nombre antiguo pero no el predicado por membresía. Pegar la salida entera en el documento.

**Paso 0b — evidencia para 1b, NO precondición bloqueante.** El trigger de `030` no exige rol `coach` para un gestionado (decisión del 2026-09-02, Task 8), así que esta consulta **ya no puede impedir aplicar la migración**. Se corre igual, y su salida es el insumo que dimensiona la invariante que falta: cuántos gestionados hay bajo una cuenta que no es `coach`, y por lo tanto cuántos habría que reparentar —o cuántas cuentas separar— antes de poder cerrarla en 1b.

```sql
select a.id, a.owner_account_id, coalesce(e.account_role, 'athlete') as rol_actual
from public.athletes a
left join public.user_entitlements e on e.user_id = a.owner_account_id
where (a.linked_account_id is null or a.linked_account_id <> a.owner_account_id)
  and coalesce(e.account_role, 'athlete') <> 'coach';
```

Se espera que devuelva al menos la cuenta híbrida del owner con sus gestionados: eso es lo normal hoy, no un hallazgo. **Pegar la salida en el documento de evidencia y seguir.** Lo que sí es un hallazgo, y hay que anotarlo, es una cuenta *distinta* de la del owner en esa lista: significaría que hay más de una cuenta creando gestionados y que la separación de 1b toca a más de una persona.

**No asignar `coach` a ninguna cuenta en este paso.** Hacerlo encendería el scope coach del cliente (Task 9) y rompería la premisa de 1a.

**Paso 1 — aplicar `028`, `029` y `030`, en ese orden.** `030` lee `account_role`. Cada una es transaccional; verificar que PostgREST recargó el esquema.

**Paso 2 — desplegar con `COACH_AUTHZ_MODE` ausente** (equivale a `audit`). Confirmar que `ENTITLEMENTS_ENABLED` y `AI_USAGE_LIMITS_ENABLED` siguen como estaban.

**Paso 3 — smoke de no-regresión, que es el que demuestra que `029` no rompió la contabilidad.** Con el owner en su tier actual: el chat responde; una acción de chat aplica; el gasto queda en **una sola** fila (`subject_athlete_id = ''`); `/ops` no duplica requests ni costo y **sigue mostrando `safetyBlocked`**; y el Plan Builder encola sin que el preflight lo rechace.

**Paso 4 — verificar la lectura discriminada del rol.** Poner `account_role = 'coach'` en una cuenta **de prueba** —nunca en la del owner, por el Paso 0b— y confirmar en los registros `[coach-authz]` un `wouldGrant` para `coach_assistant_message`; con una cuenta `advanced` athlete, un `wouldDeny`. **En `audit` el comportamiento visible NO cambia**: el coach `free` sigue sin recibir respuesta del Asistente y el atleta `advanced` sigue recibiéndola. Eso es lo correcto y es lo que hay que observar.

**Paso 5 — backfill y equivalencia** (Task 12), pegando todo en `2026-09-02-coach-authz-audit.md`.

**Paso 6 — ventana de auditoría.** Dejar correr `audit` y recoger los registros. **No encender `enforce` en esta entrega**: eso es la Entrega 1b, cuyo plan se escribe con esta evidencia en la mano.

- [ ] **Step 3: Registrar lo que 1a NO cierra**

1. La membresía sigue **decorativa**: las policies legacy siguen vigentes y una revocación no produce 403. Lo cierra `031`.
2. La cuota sigue contando **intentos del proveedor**, no unidades de producto.
3. `GLOBAL_DAILY_SPEND_CAP_USD` sigue en US$5, sin revisar para un coach con cartera.
4. El atleta con cuenta propia sigue sin consentir el acceso dentro de la app.
5. La transferencia del roster, las rutas separadas y el endpoint administrativo son la Entrega 2.
6. **La invariante "sólo una cuenta `coach` tiene gestionados" queda abierta.** `030` impone sólo el sentido contrario. Cerrarla exige una ruta que preserve el alta de gestionados para la cuenta híbrida, o separar las cuentas; el Paso 0b deja la evidencia para dimensionarlo. **Es una decisión explícita a resolver en el plan de 1b**, con su propia migración, no un pendiente que se arrastre sin dueño.
7. La serialización del bootstrap (Task 10) vale dentro de una pestaña. Dos pestañas siguen pudiendo abrir la frontera de cuenta a la vez.

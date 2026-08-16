# Entitlements de tres tiers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un usuario `free` no pueda disparar generación de IA cara desde ninguna superficie —UI, `enqueue-plan-generation` ni `generate-plan-background`— y que en su lugar vea una oferta de plan, no un error.

**Architecture:** Una tabla `user_entitlements` en Supabase es la única fuente de verdad, con RLS `select` propio y sin políticas de escritura. Un módulo puro compartido por `src/` y `netlify/` decide si un tier alcanza para una `AIRequestClass`. Tres funciones Netlify consultan la tabla con el token del usuario en paralelo a su verificación de auth y rechazan con `403 entitlement_required` más metadata tipada. El cliente espeja el tier en Dexie para decidir qué mostrar, pero nunca es la autoridad.

**Tech Stack:** TypeScript, React 19, Dexie 4 (v19 → v20), Supabase (PostgREST + RLS), Netlify Functions, Vitest, fake-indexeddb.

**Spec:** [`docs/superpowers/specs/2026-08-15-entitlements-design.md`](../specs/2026-08-15-entitlements-design.md)

## Global Constraints

- **Tiers:** exactamente `free`, `weekly`, `advanced`. Orden total `free(0) < weekly(1) < advanced(2)`.
- **Ausencia de fila, vencimiento o fallo de lectura resuelven a `free`.** En servidor siempre; en cliente, el espejo vigente tiene prioridad y `free` es el fallback.
- **Clase desconocida se deniega para todo tier, incluido `advanced`.**
- **El chequeo de entitlement va SIEMPRE antes que el de cuota.** Una clase bloqueada por plan nunca debe reportarse como límite diario.
- **Nunca `select=*` sobre `user_entitlements`:** la columna `note` está fuera del grant y pedirla rompe la consulta.
- **No ejecutar `git commit` fuera de los pasos que lo indican.** El repo está en la rama `feat/entitlements`.
- **Comandos de verificación:** `npm test`, `npm run lint`, `npm run build`. Antes de cerrar el plan, los tres.
- **Migraciones remotas son de aplicación manual.** Escribir el `.sql` no es aplicarlo. Ningún paso de este plan aplica nada en producción.
- **Idioma:** identificadores y comentarios de código en inglés cuando el archivo ya lo esté; copy visible al usuario en español rioplatense neutro, tuteo.

---

### Task 1: Política pura de entitlements

El corazón del sistema: un módulo sin dependencias de red, Dexie ni React, importable tanto desde `src/` como desde `netlify/functions/`.

**Files:**
- Create: `src/services/entitlements/entitlementPolicy.ts`
- Test: `src/services/entitlements/__tests__/entitlementPolicy.test.ts`

**Interfaces:**
- Consumes: `AIRequestClass` de `src/types/index.ts`
- Produces:
  - `type Tier = 'free' | 'weekly' | 'advanced'`
  - `interface EntitlementRow { tier: Tier; expiresAt: number | null }`
  - `const TIER_ORDER: Record<Tier, number>`
  - `const REQUEST_CLASS_MIN_TIER: Record<AIRequestClass, Tier>`
  - `function isTier(value: unknown): value is Tier`
  - `function resolveTier(row: EntitlementRow | null | undefined, now: number): Tier`
  - `function isClassAllowed(tier: Tier, requestClass: string): boolean`
  - `function minTierForClass(requestClass: string): Tier | null`

- [ ] **Step 1: Write the failing test**

Create `src/services/entitlements/__tests__/entitlementPolicy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  isClassAllowed,
  isTier,
  minTierForClass,
  resolveTier,
  REQUEST_CLASS_MIN_TIER,
  TIER_ORDER,
  type Tier,
} from '../entitlementPolicy'
import type { AIRequestClass } from '../../../types'

const NOW = Date.parse('2026-08-15T12:00:00Z')
const ALL_TIERS: Tier[] = ['free', 'weekly', 'advanced']

const ALL_CLASSES: AIRequestClass[] = [
  'chat_general',
  'chat_action',
  'weekly_summary',
  'week_creator',
  'plan_builder_week',
  'plan_builder_pair',
  'import_extract',
]

describe('resolveTier', () => {
  it('sin fila resuelve free', () => {
    expect(resolveTier(null, NOW)).toBe('free')
    expect(resolveTier(undefined, NOW)).toBe('free')
  })

  it('fila sin vencimiento conserva su tier', () => {
    expect(resolveTier({ tier: 'advanced', expiresAt: null }, NOW)).toBe('advanced')
  })

  it('fila vigente conserva su tier', () => {
    expect(resolveTier({ tier: 'weekly', expiresAt: NOW + 1000 }, NOW)).toBe('weekly')
  })

  it('fila vencida resuelve free', () => {
    expect(resolveTier({ tier: 'advanced', expiresAt: NOW - 1 }, NOW)).toBe('free')
  })

  it('vencimiento exactamente ahora ya no es vigente', () => {
    expect(resolveTier({ tier: 'advanced', expiresAt: NOW }, NOW)).toBe('free')
  })
})

describe('isClassAllowed — matriz completa 3 tiers x 7 clases', () => {
  // Expectativa declarada a mano, NO derivada del mapa: si se deriva, el test
  // no puede detectar que el mapa cambió.
  const EXPECTED: Record<AIRequestClass, Record<Tier, boolean>> = {
    chat_general:      { free: true,  weekly: true, advanced: true },
    chat_action:       { free: true,  weekly: true, advanced: true },
    import_extract:    { free: true,  weekly: true, advanced: true },
    weekly_summary:    { free: false, weekly: true, advanced: true },
    week_creator:      { free: false, weekly: true, advanced: true },
    plan_builder_week: { free: false, weekly: false, advanced: true },
    plan_builder_pair: { free: false, weekly: false, advanced: true },
  }

  for (const requestClass of ALL_CLASSES) {
    for (const tier of ALL_TIERS) {
      it(`${tier} → ${requestClass} = ${EXPECTED[requestClass][tier]}`, () => {
        expect(isClassAllowed(tier, requestClass)).toBe(EXPECTED[requestClass][tier])
      })
    }
  }
})

describe('clase desconocida', () => {
  it('se deniega para todo tier, incluido advanced', () => {
    for (const tier of ALL_TIERS) {
      expect(isClassAllowed(tier, 'clase_inventada')).toBe(false)
    }
  })

  it('minTierForClass devuelve null para una clase desconocida', () => {
    expect(minTierForClass('clase_inventada')).toBeNull()
  })
})

describe('guard de drift', () => {
  it('toda AIRequestClass tiene entrada en el mapa', () => {
    for (const requestClass of ALL_CLASSES) {
      expect(REQUEST_CLASS_MIN_TIER[requestClass]).toBeDefined()
    }
  })

  it('el mapa no tiene entradas de más', () => {
    expect(Object.keys(REQUEST_CLASS_MIN_TIER).sort()).toEqual([...ALL_CLASSES].sort())
  })

  it('todo valor del mapa es un Tier válido', () => {
    for (const tier of Object.values(REQUEST_CLASS_MIN_TIER)) {
      expect(isTier(tier)).toBe(true)
    }
  })
})

describe('TIER_ORDER', () => {
  it('es un orden total estricto', () => {
    expect(TIER_ORDER.free).toBeLessThan(TIER_ORDER.weekly)
    expect(TIER_ORDER.weekly).toBeLessThan(TIER_ORDER.advanced)
  })
})

describe('isTier', () => {
  it('acepta los tres tiers y rechaza el resto', () => {
    expect(isTier('free')).toBe(true)
    expect(isTier('weekly')).toBe(true)
    expect(isTier('advanced')).toBe(true)
    expect(isTier('pro')).toBe(false)
    expect(isTier(null)).toBe(false)
    expect(isTier(2)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/entitlements/__tests__/entitlementPolicy.test.ts`
Expected: FAIL — `Failed to resolve import "../entitlementPolicy"`

- [ ] **Step 3: Write minimal implementation**

Create `src/services/entitlements/entitlementPolicy.ts`:

```ts
import type { AIRequestClass } from '../../types'

/**
 * Política de acceso por plan. Módulo puro y sin dependencias: lo importan
 * tanto el cliente como las funciones de Netlify, igual que
 * WHOOP_WORKOUT_ZONE_COLUMNS. No agregar acá lecturas de red, Dexie ni React.
 */

export type Tier = 'free' | 'weekly' | 'advanced'

export interface EntitlementRow {
  tier: Tier
  /** Epoch ms. `null` significa sin vencimiento. */
  expiresAt: number | null
}

export const TIER_ORDER: Record<Tier, number> = {
  free: 0,
  weekly: 1,
  advanced: 2,
}

/**
 * Exhaustivo por construcción: agregar una AIRequestClass sin entrada acá
 * rompe la compilación, que es exactamente lo que queremos. El default nunca
 * puede ser "free por olvido".
 */
export const REQUEST_CLASS_MIN_TIER: Record<AIRequestClass, Tier> = {
  chat_general: 'free',
  chat_action: 'free',
  import_extract: 'free',
  weekly_summary: 'weekly',
  week_creator: 'weekly',
  plan_builder_week: 'advanced',
  plan_builder_pair: 'advanced',
}

export function isTier(value: unknown): value is Tier {
  return value === 'free' || value === 'weekly' || value === 'advanced'
}

export function resolveTier(
  row: EntitlementRow | null | undefined,
  now: number,
): Tier {
  if (!row) return 'free'
  if (!isTier(row.tier)) return 'free'
  if (row.expiresAt != null && row.expiresAt <= now) return 'free'
  return row.tier
}

/**
 * `null` para una clase que no está en el mapa. El llamador tiene que tratar
 * ese caso como denegación, no como ausencia de requisito.
 */
export function minTierForClass(requestClass: string): Tier | null {
  const required = (REQUEST_CLASS_MIN_TIER as Record<string, Tier | undefined>)[requestClass]
  return required ?? null
}

export function isClassAllowed(tier: Tier, requestClass: string): boolean {
  const required = minTierForClass(requestClass)
  // Clase desconocida: se deniega para todos, incluido advanced. Una cadena
  // que llegó por la red y no está en la unión no tiene requisito conocido,
  // y "sin requisito" no puede significar "permitido".
  if (required == null) return false
  return TIER_ORDER[tier] >= TIER_ORDER[required]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/entitlements/__tests__/entitlementPolicy.test.ts`
Expected: PASS — 30+ tests

- [ ] **Step 5: Commit**

```bash
git add src/services/entitlements/entitlementPolicy.ts src/services/entitlements/__tests__/entitlementPolicy.test.ts
git commit -m "feat(entitlements): politica pura de tiers por clase de request"
```

---

### Task 2: Error tipado compartido

Productor y consumidor comparten módulo. El precedente es `dailyQuotaError.ts`, que existe porque el acoplamiento por string ya causó un defecto en este proyecto (§28).

**Files:**
- Create: `src/services/entitlements/entitlementError.ts`
- Modify: `src/services/ai/types.ts` (agregar `entitlement_required` a `AIErrorCode`, línea ~159)
- Modify: `netlify/functions/coach.ts` (agregar `entitlement_required` a `TechnicalErrorCode`, línea 39)
- Test: `src/services/entitlements/__tests__/entitlementError.test.ts`

**Interfaces:**
- Consumes: `Tier` de Task 1; `AIProviderError` de `src/services/ai/types.ts`
- Produces:
  - `const ENTITLEMENT_ERROR_CODE = 'entitlement_required'`
  - `interface EntitlementRequiredDetail { requestClass: string; requiredTier: Tier; currentTier: Tier }`
  - `class EntitlementRequiredError extends AIProviderError` con `readonly detail`
  - `function buildEntitlementDetail(requestClass, requiredTier, currentTier): EntitlementRequiredDetail`
  - `function isEntitlementRequiredDetail(value: unknown): value is EntitlementRequiredDetail`
  - `function formatEntitlementMessage(detail): string`

- [ ] **Step 1: Write the failing test**

Create `src/services/entitlements/__tests__/entitlementError.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  EntitlementRequiredError,
  ENTITLEMENT_ERROR_CODE,
  buildEntitlementDetail,
  formatEntitlementMessage,
  isEntitlementRequiredDetail,
} from '../entitlementError'
import { AIProviderError } from '../../ai/types'

describe('buildEntitlementDetail', () => {
  it('arma la metadata tipada', () => {
    expect(buildEntitlementDetail('plan_builder_week', 'advanced', 'free')).toEqual({
      requestClass: 'plan_builder_week',
      requiredTier: 'advanced',
      currentTier: 'free',
    })
  })
})

describe('isEntitlementRequiredDetail', () => {
  it('acepta una forma válida', () => {
    expect(isEntitlementRequiredDetail({
      requestClass: 'week_creator',
      requiredTier: 'weekly',
      currentTier: 'free',
    })).toBe(true)
  })

  it('rechaza tiers inválidos, campos faltantes y no-objetos', () => {
    expect(isEntitlementRequiredDetail({
      requestClass: 'week_creator', requiredTier: 'pro', currentTier: 'free',
    })).toBe(false)
    expect(isEntitlementRequiredDetail({ requestClass: 'week_creator' })).toBe(false)
    expect(isEntitlementRequiredDetail(null)).toBe(false)
    expect(isEntitlementRequiredDetail('week_creator')).toBe(false)
  })
})

describe('EntitlementRequiredError', () => {
  const detail = buildEntitlementDetail('plan_builder_week', 'advanced', 'free')

  it('es un AIProviderError con el código propio', () => {
    const error = new EntitlementRequiredError(detail)
    expect(error).toBeInstanceOf(AIProviderError)
    expect(error.code).toBe(ENTITLEMENT_ERROR_CODE)
    expect(error.name).toBe('EntitlementRequiredError')
  })

  it('conserva la metadata y no es reintentable', () => {
    const error = new EntitlementRequiredError(detail)
    expect(error.detail).toEqual(detail)
    expect(error.retryable).toBe(false)
  })

  it('el mensaje no depende del parseo: la metadata es la fuente', () => {
    const error = new EntitlementRequiredError(detail)
    expect(error.message).toBe(formatEntitlementMessage(detail))
    expect(error.message.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/entitlements/__tests__/entitlementError.test.ts`
Expected: FAIL — `Failed to resolve import "../entitlementError"`

- [ ] **Step 3: Write minimal implementation**

Create `src/services/entitlements/entitlementError.ts`:

```ts
import { AIProviderError } from '../ai/types'
import { isTier, type Tier } from './entitlementPolicy'

export const ENTITLEMENT_ERROR_CODE = 'entitlement_required' as const

export interface EntitlementRequiredDetail {
  requestClass: string
  requiredTier: Tier
  currentTier: Tier
}

export function buildEntitlementDetail(
  requestClass: string,
  requiredTier: Tier,
  currentTier: Tier,
): EntitlementRequiredDetail {
  return { requestClass, requiredTier, currentTier }
}

export function isEntitlementRequiredDetail(
  value: unknown,
): value is EntitlementRequiredDetail {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<EntitlementRequiredDetail>
  return typeof candidate.requestClass === 'string'
    && candidate.requestClass.length > 0
    && isTier(candidate.requiredTier)
    && isTier(candidate.currentTier)
}

/**
 * Mensaje de respaldo. La UI construye la oferta desde `detail`, NO desde este
 * texto: existe para logs y para el caso en que algo lo muestre igual.
 */
export function formatEntitlementMessage(detail: EntitlementRequiredDetail): string {
  return `Esta función requiere el plan ${detail.requiredTier}.`
}

export class EntitlementRequiredError extends AIProviderError {
  readonly detail: EntitlementRequiredDetail

  constructor(detail: EntitlementRequiredDetail) {
    super('gemini', ENTITLEMENT_ERROR_CODE, formatEntitlementMessage(detail), false)
    this.name = 'EntitlementRequiredError'
    this.detail = detail
  }
}
```

- [ ] **Step 4: Add the code to both error enums**

In `src/services/ai/types.ts`, extend `AIErrorCode` (currently at line 159):

```ts
export type AIErrorCode =
  | 'unauthorized'   // bad or missing API key
  | 'rate_limit'     // 429 from provider
  | 'timeout'        // fetch timeout
  | 'truncated'      // provider stopped because output token budget was exhausted
  | 'parse_error'    // response could not be parsed
  | 'misconfigured'  // server or provider config missing
  | 'server_error'   // internal proxy/backend error
  | 'entitlement_required' // el plan del usuario no alcanza para esta clase
  | 'unknown'        // catch-all
```

In `netlify/functions/coach.ts`, extend `TechnicalErrorCode` (line 39):

```ts
type TechnicalErrorCode = 'timeout' | 'rate_limit' | 'parse_error' | 'server_error' | 'misconfigured' | 'unknown' | 'unauthorized' | 'entitlement_required'
```

- [ ] **Step 5: Run test and typecheck**

Run: `npx vitest run src/services/entitlements/__tests__/entitlementError.test.ts && npx tsc -b`
Expected: PASS, y `tsc -b` sin errores

- [ ] **Step 6: Commit**

```bash
git add src/services/entitlements/entitlementError.ts src/services/entitlements/__tests__/entitlementError.test.ts src/services/ai/types.ts netlify/functions/coach.ts
git commit -m "feat(entitlements): error tipado compartido y codigo entitlement_required"
```

---

### Task 3: Migración 020 y guard de columnas

La migración es de aplicación manual. Este task solo escribe el `.sql` y el guard que impide que el código y la migración diverjan.

**Files:**
- Create: `supabase/020_user_entitlements.sql`
- Create: `src/services/entitlements/entitlementColumns.ts`
- Test: `src/services/entitlements/__tests__/entitlementColumns.test.ts`

**Interfaces:**
- Produces: `const USER_ENTITLEMENT_SELECT_COLUMNS: readonly string[]` — la lista exacta que el cliente y el servidor piden a PostgREST.

- [ ] **Step 1: Write the failing test**

Create `src/services/entitlements/__tests__/entitlementColumns.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { USER_ENTITLEMENT_SELECT_COLUMNS } from '../entitlementColumns'

const MIGRATION = readFileSync(
  resolve(process.cwd(), 'supabase/020_user_entitlements.sql'),
  'utf8',
)

describe('guard de drift entre codigo y migracion 020', () => {
  it('toda columna que el codigo pide existe en el grant de la migracion', () => {
    const grantMatch = /grant select \(([^)]+)\)/i.exec(MIGRATION)
    expect(grantMatch).not.toBeNull()
    const granted = grantMatch![1].split(',').map((c) => c.trim())
    for (const column of USER_ENTITLEMENT_SELECT_COLUMNS) {
      expect(granted).toContain(column)
    }
  })

  it('`note` NO esta en el grant: es comentario operacional interno', () => {
    const grantMatch = /grant select \(([^)]+)\)/i.exec(MIGRATION)
    const granted = grantMatch![1].split(',').map((c) => c.trim())
    expect(granted).not.toContain('note')
  })

  it('el codigo nunca pide `note`', () => {
    expect(USER_ENTITLEMENT_SELECT_COLUMNS).not.toContain('note')
  })

  it('la migracion revoca los permisos por defecto antes de otorgar columnas', () => {
    expect(MIGRATION).toMatch(/revoke all on public\.user_entitlements from anon, authenticated/i)
  })

  it('la migracion no declara politicas de escritura', () => {
    expect(MIGRATION).not.toMatch(/for\s+(insert|update|delete)/i)
  })

  it('el CHECK del tier cubre exactamente los tres valores', () => {
    expect(MIGRATION).toMatch(/check \(tier in \('free','weekly','advanced'\)\)/i)
  })

  it('la policy es idempotente', () => {
    expect(MIGRATION).toMatch(/drop policy if exists user_entitlements_select_own/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/entitlements/__tests__/entitlementColumns.test.ts`
Expected: FAIL — no existe `supabase/020_user_entitlements.sql`

- [ ] **Step 3: Write the migration**

Create `supabase/020_user_entitlements.sql`:

```sql
-- 020_user_entitlements.sql — Entitlements por plan.
--
-- Una fila por cuenta. La ausencia de fila significa `free`: no hay backfill y
-- un registro nuevo no escribe nada. Sin políticas de insert/update/delete —
-- solo el service role asigna, así nadie se auto-asciende.
-- Spec: docs/superpowers/specs/2026-08-15-entitlements-design.md

create table if not exists public.user_entitlements (
  user_id    uuid primary key,
  tier       text not null check (tier in ('free','weekly','advanced')),
  expires_at timestamptz,
  source     text not null default 'manual',
  note       text,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- `updated_at` no puede depender de que quien escribe se acuerde.
create or replace function public.touch_user_entitlements() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists user_entitlements_touch on public.user_entitlements;
create trigger user_entitlements_touch
  before update on public.user_entitlements
  for each row execute function public.touch_user_entitlements();

alter table public.user_entitlements enable row level security;

drop policy if exists user_entitlements_select_own on public.user_entitlements;
create policy user_entitlements_select_own on public.user_entitlements
  for select using (auth.uid() = user_id);

-- Deliberadamente no se declaran políticas de insert, update ni delete.

-- `note` es comentario operacional interno y NO se expone al cliente. RLS
-- filtra filas, no columnas: la restricción por columna tiene que ser un grant.
revoke all on public.user_entitlements from anon, authenticated;
grant select (user_id, tier, expires_at, source, granted_at, updated_at)
  on public.user_entitlements to authenticated;
```

- [ ] **Step 4: Write the column contract**

Create `src/services/entitlements/entitlementColumns.ts`:

```ts
/**
 * Columnas que cliente y servidor piden a PostgREST. Nunca `select=*`: `note`
 * está fuera del grant de 020 y pedirla hace fallar la consulta entera.
 * El guard en __tests__/entitlementColumns.test.ts cruza esta lista contra el
 * .sql, así que ampliar la migración sin tocar el código rompe en CI en vez de
 * dar 400 en producción.
 */
export const USER_ENTITLEMENT_SELECT_COLUMNS = [
  'tier',
  'expires_at',
] as const

export const USER_ENTITLEMENT_SELECT = USER_ENTITLEMENT_SELECT_COLUMNS.join(',')
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/services/entitlements/__tests__/entitlementColumns.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 6: Commit**

```bash
git add supabase/020_user_entitlements.sql src/services/entitlements/entitlementColumns.ts src/services/entitlements/__tests__/entitlementColumns.test.ts
git commit -m "feat(entitlements): migracion 020 y guard de columnas"
```

---

### Task 4: Helper de servidor `resolveEntitlement`

**Files:**
- Create: `netlify/functions/_shared/resolveEntitlement.ts`
- Test: `netlify/functions/__tests__/resolveEntitlement.test.ts`

**Interfaces:**
- Consumes: `resolveTier`, `Tier` (Task 1); `USER_ENTITLEMENT_SELECT` (Task 3)
- Produces:
  - `function isEntitlementEnforcementEnabled(env?: NodeJS.ProcessEnv): boolean`
  - `async function resolveEntitlementTier(token: string): Promise<Tier>`

- [ ] **Step 1: Write the failing test**

Create `netlify/functions/__tests__/resolveEntitlement.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isEntitlementEnforcementEnabled, resolveEntitlementTier } from '../_shared/resolveEntitlement'

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  process.env['SUPABASE_URL'] = 'https://example.supabase.co'
  process.env['SUPABASE_ANON_KEY'] = 'anon-key'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.restoreAllMocks()
})

function mockFetchJson(status: number, body: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })))
}

describe('isEntitlementEnforcementEnabled', () => {
  it('apagado por defecto', () => {
    expect(isEntitlementEnforcementEnabled({} as NodeJS.ProcessEnv)).toBe(false)
  })

  it('solo la cadena exacta "true" lo enciende', () => {
    expect(isEntitlementEnforcementEnabled({ ENTITLEMENTS_ENABLED: 'true' } as never)).toBe(true)
    expect(isEntitlementEnforcementEnabled({ ENTITLEMENTS_ENABLED: '1' } as never)).toBe(false)
    expect(isEntitlementEnforcementEnabled({ ENTITLEMENTS_ENABLED: 'TRUE' } as never)).toBe(false)
  })
})

describe('resolveEntitlementTier', () => {
  it('fila presente y vigente devuelve su tier', async () => {
    mockFetchJson(200, [{ tier: 'advanced', expires_at: null }])
    await expect(resolveEntitlementTier('tok')).resolves.toBe('advanced')
  })

  it('respuesta vacia (sin fila) devuelve free', async () => {
    mockFetchJson(200, [])
    await expect(resolveEntitlementTier('tok')).resolves.toBe('free')
  })

  it('fila vencida devuelve free', async () => {
    mockFetchJson(200, [{ tier: 'advanced', expires_at: '2020-01-01T00:00:00Z' }])
    await expect(resolveEntitlementTier('tok')).resolves.toBe('free')
  })

  it('tier invalido en la fila devuelve free', async () => {
    mockFetchJson(200, [{ tier: 'pro', expires_at: null }])
    await expect(resolveEntitlementTier('tok')).resolves.toBe('free')
  })

  it('expires_at ILEGIBLE devuelve free, no "sin vencimiento"', async () => {
    // Un valor que no parsea no puede interpretarse como null: eso sería lo
    // más permisivo posible, al revés del fail-closed.
    for (const bad of ['no-es-fecha', '', 42, {}]) {
      mockFetchJson(200, [{ tier: 'advanced', expires_at: bad }])
      await expect(resolveEntitlementTier('tok')).resolves.toBe('free')
    }
  })

  it('expires_at ausente sigue siendo sin vencimiento', async () => {
    mockFetchJson(200, [{ tier: 'advanced' }])
    await expect(resolveEntitlementTier('tok')).resolves.toBe('advanced')
  })

  it('error HTTP devuelve free (fail-closed)', async () => {
    mockFetchJson(500, { message: 'boom' })
    await expect(resolveEntitlementTier('tok')).resolves.toBe('free')
  })

  it('fallo de red devuelve free (fail-closed)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    await expect(resolveEntitlementTier('tok')).resolves.toBe('free')
  })

  it('config ausente devuelve free', async () => {
    delete process.env['SUPABASE_URL']
    await expect(resolveEntitlementTier('tok')).resolves.toBe('free')
  })

  it('nunca pide select=*, y pide las columnas del contrato', async () => {
    const spy = vi.fn(async () => new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', spy)
    await resolveEntitlementTier('tok')
    const url = String(spy.mock.calls[0][0])
    expect(url).not.toContain('select=*')
    expect(url).toContain('select=tier%2Cexpires_at')
  })

  it('manda el token del usuario para que RLS filtre', async () => {
    const spy = vi.fn(async () => new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', spy)
    await resolveEntitlementTier('tok-123')
    const init = spy.mock.calls[0][1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer tok-123')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/__tests__/resolveEntitlement.test.ts`
Expected: FAIL — no existe `../_shared/resolveEntitlement`

- [ ] **Step 3: Write minimal implementation**

Create `netlify/functions/_shared/resolveEntitlement.ts`:

```ts
import { resolveTier, type EntitlementRow, type Tier } from '../../../src/services/entitlements/entitlementPolicy'
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
    // Vencimiento ilegible → free. No se puede asumir "sin vencimiento".
    if (!expires.ok) return 'free'

    const row: EntitlementRow = {
      tier: raw.tier as Tier,
      expiresAt: expires.value,
    }
    return resolveTier(row, now)
  } catch {
    // Fail-closed: red caída, timeout, tabla ausente o JSON corrupto → free.
    return 'free'
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/__tests__/resolveEntitlement.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/resolveEntitlement.ts netlify/functions/__tests__/resolveEntitlement.test.ts
git commit -m "feat(entitlements): helper de lectura fail-closed en servidor"
```

---

### Task 5: Gate en `coach.ts` y preservación del 403

Dos cambios que van juntos: sin el arreglo de `normalizeError`, el gate produce `unauthorized` y el usuario ve un error de sesión.

**Files:**
- Modify: `netlify/functions/coach.ts` — `normalizeError` (línea 496), `makeError` (línea 483), bloque de auth (líneas 1619-1653)
- Test: `netlify/functions/__tests__/coachEntitlementGate.test.ts`

**Interfaces:**
- Consumes: `resolveEntitlementTier`, `isEntitlementEnforcementEnabled` (Task 4); `EntitlementRequiredError`, `buildEntitlementDetail` (Task 2); `isClassAllowed`, `minTierForClass` (Task 1)
- Produces: respuesta `403` con body `{ error, errorCode: 'entitlement_required', detail: EntitlementRequiredDetail }`

- [ ] **Step 1: Write the failing test**

Create `netlify/functions/__tests__/coachEntitlementGate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { normalizeErrorForTest } from '../coach'

describe('normalizeError preserva el 403 de entitlement', () => {
  it('un 403 con entitlement_required conserva codigo y detail', () => {
    const detail = { requestClass: 'week_creator', requiredTier: 'weekly', currentTier: 'free' }
    const source = Object.assign(new Error('Requiere plan weekly.'), {
      statusCode: 403,
      errorCode: 'entitlement_required' as const,
      detail,
    })
    const normalized = normalizeErrorForTest(source)
    expect(normalized.statusCode).toBe(403)
    expect(normalized.errorCode).toBe('entitlement_required')
    expect(normalized.detail).toEqual(detail)
  })

  it('un 403 SIN codigo propio sigue cayendo a unauthorized', () => {
    const source = Object.assign(new Error('Sesión inválida.'), { statusCode: 403 })
    const normalized = normalizeErrorForTest(source)
    expect(normalized.errorCode).toBe('unauthorized')
    expect(normalized.detail).toBeUndefined()
  })

  it('un 401 sigue cayendo a unauthorized', () => {
    const source = Object.assign(new Error('Sesión requerida.'), { statusCode: 401 })
    const normalized = normalizeErrorForTest(source)
    expect(normalized.errorCode).toBe('unauthorized')
  })

  it('un 429 sigue siendo rate_limit reintentable', () => {
    const source = Object.assign(new Error('Muchas solicitudes.'), { statusCode: 429 })
    const normalized = normalizeErrorForTest(source)
    expect(normalized.errorCode).toBe('rate_limit')
    expect(normalized.retryable).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/__tests__/coachEntitlementGate.test.ts`
Expected: FAIL — `normalizeErrorForTest` no existe

- [ ] **Step 3: Extend `makeError` and fix `normalizeError`**

In `netlify/functions/coach.ts`, replace `makeError` and `normalizeError` (lines 483-513):

```ts
function makeError(
  message: string,
  statusCode: number,
  errorCode: TechnicalErrorCode,
  retryable = false,
  detail?: unknown,
): NormalizedServerError {
  const error = new Error(message) as NormalizedServerError
  error.statusCode = statusCode
  error.errorCode = errorCode
  error.retryable = retryable
  if (detail !== undefined) error.detail = detail
  return error
}

function normalizeError(error: unknown): NormalizedServerError {
  const err = error as NormalizedServerError
  const message = err.message ?? 'Error interno del servidor.'
  const statusCode = err.statusCode
  // Un error que ya trae su propio código lo conserva: aplanar un 403 a
  // 'unauthorized' rutearía un rechazo por plan como sesión inválida y
  // descartaría su `detail`, dejando la oferta sin datos para armarse.
  if (statusCode === 403 && err.errorCode === 'entitlement_required') {
    return makeError(message, 403, 'entitlement_required', false, err.detail)
  }
  if (statusCode === 401 || statusCode === 403) {
    return makeError(message, statusCode, 'unauthorized')
  }
  if (statusCode === 429) {
    return makeError(message, 429, 'rate_limit', true)
  }
  if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
    return makeError(message, statusCode, 'timeout', true)
  }
  if (message.toLowerCase().includes('timeout') || message.toLowerCase().includes('timed out')) {
    return makeError(message, 504, 'timeout', true)
  }
  return makeError(message, 500, err.errorCode ?? 'server_error')
}

/** Export sólo para test: `normalizeError` no es parte del contrato público. */
export const normalizeErrorForTest = normalizeError
```

Add `detail?: unknown` to the `NormalizedServerError` interface (search for `interface NormalizedServerError`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/__tests__/coachEntitlementGate.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Wire the gate into the handler**

In `netlify/functions/coach.ts`, inside the auth `try` block, right after `enforceRateLimit(auth)` (line ~1629):

```ts
Reemplazar el `const auth = await resolveAuthContext(event)` del bloque `try`
por una lectura **realmente paralela**. `getBearerToken` es síncrona, así que el
token está disponible antes de resolver auth, y RLS filtra por `auth.uid()` del
propio token: la lectura del tier no necesita esperar a que auth termine.

```ts
    const bearer = getBearerToken(event)
    const gateEnabled = isEntitlementEnforcementEnabled()
    const [auth, gateTier] = await Promise.all([
      resolveAuthContext(event),
      gateEnabled && bearer
        ? resolveEntitlementTier(bearer)
        : Promise.resolve('free' as Tier),
    ])
    const token = bearer
    if (token && auth.userId !== ANONYMOUS_USER_ID) {
      persistence = { userId: auth.userId, token }
    }
    enforceRateLimit(auth)

    // Entitlement ANTES que cualquier cuota: una clase bloqueada por plan no
    // puede reportarse como límite diario, o el usuario recibe la oferta
    // equivocada y vuelve mañana esperando que se le renueve.
    if (gateEnabled && auth.userId !== ANONYMOUS_USER_ID) {
      const gateClass = normalizeRequestClass(req.requestClass)
      const currentTier = gateTier
      if (!isClassAllowed(currentTier, gateClass)) {
        const requiredTier = minTierForClass(gateClass) ?? 'advanced'
        const detail = buildEntitlementDetail(gateClass, requiredTier, currentTier)
        throw makeError(
          formatEntitlementMessage(detail),
          403,
          'entitlement_required',
          false,
          detail,
        )
      }
    }
    authDurationMs = Date.now() - authStartedAt
```

Add the imports at the top of the file:

```ts
import { isClassAllowed, minTierForClass } from '../../src/services/entitlements/entitlementPolicy'
import { buildEntitlementDetail, formatEntitlementMessage } from '../../src/services/entitlements/entitlementError'
import { isEntitlementEnforcementEnabled, resolveEntitlementTier } from './_shared/resolveEntitlement'
```

- [ ] **Step 6: Serialize `detail` in the error response**

In the same `catch` block (line ~1646), add `detail` to the JSON body:

```ts
    return json(normalized.statusCode ?? 500, {
      error: normalized.message,
      errorCode: normalized.errorCode ?? 'unknown',
      ...(normalized.detail !== undefined ? { detail: normalized.detail } : {}),
      traceId: req.traceId,
      requestClass: normalizeRequestClass(req.requestClass),
      generationId: req.generationId,
      authDurationMs,
      serverDurationMs: Date.now() - requestReceivedAt,
    })
```

- [ ] **Step 7: Verify typecheck and full suite**

Run: `npx tsc -b && npx vitest run netlify/functions/__tests__/`
Expected: sin errores de tipo; tests de funciones en verde

- [ ] **Step 8: Commit**

```bash
git add netlify/functions/coach.ts netlify/functions/__tests__/coachEntitlementGate.test.ts
git commit -m "feat(entitlements): gate en coach.ts preservando el 403 tipado"
```

---

### Task 6: Gate en `enqueue-plan-generation`

**Files:**
- Modify: `netlify/functions/enqueue-plan-generation.ts` (después de `resolveAuthContext`, línea ~66, antes de `createSupabaseWriter`)
- Test: `netlify/functions/__tests__/enqueuePlanEntitlement.test.ts`

**Interfaces:**
- Consumes: `resolveEntitlementTier`, `isEntitlementEnforcementEnabled` (Task 4); `isClassAllowed` (Task 1); `buildEntitlementDetail` (Task 2)
- Produces: respuesta `403` con el mismo body que `coach.ts`

- [ ] **Step 1: Write the failing test**

Create `netlify/functions/__tests__/enqueuePlanEntitlement.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { assertPlanGenerationEntitlement } from '../_shared/resolveEntitlement'

describe('assertPlanGenerationEntitlement', () => {
  it('advanced pasa sin lanzar', () => {
    expect(() => assertPlanGenerationEntitlement('advanced')).not.toThrow()
  })

  it('free es rechazado con 403 y detail', () => {
    try {
      assertPlanGenerationEntitlement('free')
      throw new Error('debio lanzar')
    } catch (error) {
      const err = error as { statusCode?: number; errorCode?: string; detail?: unknown }
      expect(err.statusCode).toBe(403)
      expect(err.errorCode).toBe('entitlement_required')
      expect(err.detail).toEqual({
        requestClass: 'plan_builder_week',
        requiredTier: 'advanced',
        currentTier: 'free',
      })
    }
  })

  it('weekly tambien es rechazado: Plan Builder es advanced', () => {
    expect(() => assertPlanGenerationEntitlement('weekly')).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/__tests__/enqueuePlanEntitlement.test.ts`
Expected: FAIL — `assertPlanGenerationEntitlement` no existe

- [ ] **Step 3: Add the shared assertion**

En `netlify/functions/_shared/resolveEntitlement.ts`, **agregar estos imports al bloque de imports de arriba** (no al final del archivo):

```ts
import { isClassAllowed, minTierForClass } from '../../../src/services/entitlements/entitlementPolicy'
import { buildEntitlementDetail, formatEntitlementMessage } from '../../../src/services/entitlements/entitlementError'
```

Y agregar al final del archivo:

```ts
/** La clase que representa la generación de Plan Builder en ambas funciones. */
export const PLAN_GENERATION_REQUEST_CLASS = 'plan_builder_week' as const

export interface EntitlementHttpError extends Error {
  statusCode: number
  errorCode: 'entitlement_required'
  detail: ReturnType<typeof buildEntitlementDetail>
}

/**
 * Lanza un error con forma HTTP si el tier no alcanza para generar planes.
 * Compartido por enqueue y worker para que los dos rechacen idéntico.
 */
export function assertPlanGenerationEntitlement(tier: Tier): void {
  if (isClassAllowed(tier, PLAN_GENERATION_REQUEST_CLASS)) return
  const requiredTier = minTierForClass(PLAN_GENERATION_REQUEST_CLASS) ?? 'advanced'
  const detail = buildEntitlementDetail(PLAN_GENERATION_REQUEST_CLASS, requiredTier, tier)
  const error = new Error(formatEntitlementMessage(detail)) as EntitlementHttpError
  error.statusCode = 403
  error.errorCode = 'entitlement_required'
  error.detail = detail
  throw error
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/__tests__/enqueuePlanEntitlement.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: Wire it into the enqueue handler**

In `netlify/functions/enqueue-plan-generation.ts`, right after `const auth = await resolveAuthContext(event)` and **before** `createSupabaseWriter`:

Lectura paralela: `getBearerToken` es síncrona y RLS filtra por el token, así
que la consulta del tier no espera a que auth resuelva.

```ts
    const bearer = getBearerToken(event)
    const gateEnabled = isEntitlementEnforcementEnabled()
    const [auth, gateTier] = await Promise.all([
      resolveAuthContext(event),
      gateEnabled && bearer
        ? resolveEntitlementTier(bearer)
        : Promise.resolve('free' as Tier),
    ])
    // Antes de cualquier escritura: un rechazo acá no debe dejar un plan en
    // 'generating' ni un jobId huérfano.
    if (gateEnabled) assertPlanGenerationEntitlement(gateTier)

    const writer = createSupabaseWriter(auth.userId, auth.token)
```

`getBearerToken` es privada de `planGenerationShared.ts`. **Exportarla** desde
ahí (`export function getBearerToken`) y agregar los imports:

```ts
import { getBearerToken } from './_shared/planGenerationShared'
import type { Tier } from '../../src/services/entitlements/entitlementPolicy'
import {
  assertPlanGenerationEntitlement,
  isEntitlementEnforcementEnabled,
  resolveEntitlementTier,
} from './_shared/resolveEntitlement'
```

- [ ] **Step 6: Verify the error body carries `detail`**

The existing `catch` builds the response from `statusCode`. Confirm it forwards `errorCode` and `detail`; if it only sends `{ error: message }`, extend that branch:

```ts
    const errorCode = (error as { errorCode?: string }).errorCode
    const detail = (error as { detail?: unknown }).detail
    return json(statusCode, {
      error: message,
      ...(errorCode ? { errorCode } : {}),
      ...(detail !== undefined ? { detail } : {}),
    })
```

- [ ] **Step 7: Run typecheck and function tests**

Run: `npx tsc -b && npx vitest run netlify/functions/__tests__/`
Expected: verde

- [ ] **Step 8: Commit**

```bash
git add netlify/functions/_shared/resolveEntitlement.ts netlify/functions/enqueue-plan-generation.ts netlify/functions/__tests__/enqueuePlanEntitlement.test.ts
git commit -m "feat(entitlements): gate en enqueue-plan-generation antes de escribir"
```

---

### Task 7: Gate y terminalización en `generate-plan-background`

El task más delicado. Cierra la puerta trasera de §4.3 y la carrera de §4.3.1.

**Files:**
- Modify: `netlify/functions/generate-plan-background.ts` (después de `resolveAuthContext`, línea ~42)
- Test: `netlify/functions/__tests__/backgroundPlanEntitlement.test.ts`

**Interfaces:**
- Consumes: `assertPlanGenerationEntitlement`, `resolveEntitlementTier`, `isEntitlementEnforcementEnabled` (Tasks 4/6)
- Produces: `async function terminalizeRejectedJob(writer, planId, jobId): Promise<'marked' | 'skipped'>` — exportada para test

- [ ] **Step 1: Write the failing test**

Create `netlify/functions/__tests__/backgroundPlanEntitlement.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { terminalizeRejectedJob } from '../generate-plan-background'
import type { TrainingPlan } from '../../../src/types/planBuilder'

function makePlan(jobId: string): TrainingPlan {
  return {
    id: 'plan-1',
    generationState: 'generating',
    updatedAt: 1,
    generationSummary: {
      startedAt: 1,
      jobId,
      strategy: 'single',
      completedWeeks: 0,
      failedWeeks: [],
      totalAttempts: 0,
      heartbeatAt: 1,
    },
  } as unknown as TrainingPlan
}

describe('terminalizeRejectedJob', () => {
  it('marca failed cuando el jobId coincide con el plan persistido', async () => {
    const plan = makePlan('job-abc')
    const putPlan = vi.fn(async () => {})
    const writer = { getPlan: vi.fn(async () => plan), putPlan }

    const result = await terminalizeRejectedJob(writer as never, 'plan-1', 'job-abc')

    expect(result).toBe('marked')
    expect(putPlan).toHaveBeenCalledTimes(1)
    const written = putPlan.mock.calls[0][0] as TrainingPlan
    expect(written.generationState).toBe('failed')
    expect(written.generationSummary?.completedAt).toBeGreaterThan(0)
  })

  it('NO escribe cuando el jobId no coincide: no se marca un plan ajeno', async () => {
    const plan = makePlan('job-de-otra-corrida')
    const putPlan = vi.fn(async () => {})
    const writer = { getPlan: vi.fn(async () => plan), putPlan }

    const result = await terminalizeRejectedJob(writer as never, 'plan-1', 'job-abc')

    expect(result).toBe('skipped')
    expect(putPlan).not.toHaveBeenCalled()
  })

  it('NO escribe cuando no hay jobId (invocacion directa)', async () => {
    const putPlan = vi.fn(async () => {})
    const writer = { getPlan: vi.fn(async () => makePlan('job-abc')), putPlan }

    const result = await terminalizeRejectedJob(writer as never, 'plan-1', undefined)

    expect(result).toBe('skipped')
    expect(putPlan).not.toHaveBeenCalled()
  })

  it('NO escribe cuando no hay plan persistido', async () => {
    const putPlan = vi.fn(async () => {})
    const writer = { getPlan: vi.fn(async () => null), putPlan }

    const result = await terminalizeRejectedJob(writer as never, 'plan-1', 'job-abc')

    expect(result).toBe('skipped')
    expect(putPlan).not.toHaveBeenCalled()
  })

  it('NO degrada un plan ya completado con el mismo jobId', async () => {
    const done = { ...makePlan('job-abc'), generationState: 'complete' } as unknown as TrainingPlan
    const putPlan = vi.fn(async () => {})
    const writer = { getPlan: vi.fn(async () => done), putPlan }

    const result = await terminalizeRejectedJob(writer as never, 'plan-1', 'job-abc')

    expect(result).toBe('skipped')
    expect(putPlan).not.toHaveBeenCalled()
  })

  it('un fallo al escribir no propaga: el rechazo ya ocurrio', async () => {
    const writer = {
      getPlan: vi.fn(async () => makePlan('job-abc')),
      putPlan: vi.fn(async () => { throw new Error('supabase caido') }),
    }
    await expect(terminalizeRejectedJob(writer as never, 'plan-1', 'job-abc')).resolves.toBe('skipped')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/__tests__/backgroundPlanEntitlement.test.ts`
Expected: FAIL — `terminalizeRejectedJob` no existe

- [ ] **Step 3: Implement the terminalizer**

In `netlify/functions/generate-plan-background.ts`, add near the top-level (before `handler`):

```ts
/**
 * Terminaliza un job ya encolado cuando el worker rechaza por entitlement.
 *
 * `enqueue-plan-generation` escribe el plan como 'generating' ANTES de invocar
 * al worker y deja de observar en cuanto Netlify responde 202. Si el worker
 * rechaza y nadie marca el plan, queda colgado hasta el detector de stalled
 * (5 min). Y no hace falta mala fe: la lectura de entitlement es fail-closed,
 * así que un error transitorio de red basta para que un `advanced` legítimo
 * quede así.
 *
 * Solo escribe si el jobId del payload coincide con el del plan persistido.
 * Sin esa comparación, cualquier usuario autenticado podría marcar `failed`
 * planes ajenos pasando un planId cualquiera.
 */
export async function terminalizeRejectedJob(
  writer: { getPlan: (id: string) => Promise<TrainingPlan | null>; putPlan: (plan: TrainingPlan) => Promise<void> },
  planId: string,
  jobId: string | undefined,
): Promise<'marked' | 'skipped'> {
  if (!jobId) return 'skipped'
  try {
    const existing = await writer.getPlan(planId)
    if (!existing?.generationSummary) return 'skipped'
    if (existing.generationSummary.jobId !== jobId) return 'skipped'
    // Sólo un job EN CURSO se puede terminalizar. Sin esta guarda, un reintento
    // tardío con el mismo jobId sobre un plan ya completado lo degradaría a
    // 'failed' y le borraría al usuario un plan que sí se generó.
    if (existing.generationState !== 'generating') return 'skipped'

    const now = Date.now()
    await writer.putPlan({
      ...existing,
      generationState: 'failed',
      updatedAt: now,
      generationSummary: { ...existing.generationSummary, completedAt: now },
    })
    return 'marked'
  } catch (error) {
    console.error(`[generate-plan] terminalize failed planId=${planId}: ${error instanceof Error ? error.message : String(error)}`)
    return 'skipped'
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/__tests__/backgroundPlanEntitlement.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Wire the gate into the handler**

In `netlify/functions/generate-plan-background.ts`, immediately after `const auth = await resolveAuthContext(event)` (line ~42):

```ts
    const auth = await resolveAuthContext(event)

    // Gate obligatorio, no defensa en profundidad: esta función acepta llamadas
    // autenticadas directas y acuña su propio jobId, así que gatear sólo el
    // enqueue dejaría una puerta trasera. Ver spec §4.3.
    if (isEntitlementEnforcementEnabled()) {
      const tier = await resolveEntitlementTier(auth.token)
      if (!isClassAllowed(tier, PLAN_GENERATION_REQUEST_CLASS)) {
        // El writer se crea SOLO para limpiar un job ya encolado, nunca para
        // iniciar trabajo. Ver spec §4.3.1.
        const cleanupWriter = createSupabaseWriter(auth.userId, auth.token)
        const outcome = await terminalizeRejectedJob(
          cleanupWriter,
          body.plan.id,
          typeof body.jobId === 'string' ? body.jobId : undefined,
        )
        console.warn(`[generate-plan] entitlement denied tier=${tier} planId=${body.plan.id} cleanup=${outcome}`)
        // Mismo contrato que coach.ts y enqueue: el 403 SIEMPRE lleva detail.
        const detail = buildEntitlementDetail(PLAN_GENERATION_REQUEST_CLASS, 'advanced', tier)
        return json(403, {
          error: formatEntitlementMessage(detail),
          errorCode: 'entitlement_required',
          detail,
        })
      }
    }
```

Add the imports:

```ts
import { isClassAllowed } from '../../src/services/entitlements/entitlementPolicy'
import {
  PLAN_GENERATION_REQUEST_CLASS,
  isEntitlementEnforcementEnabled,
  resolveEntitlementTier,
} from './_shared/resolveEntitlement'
```

- [ ] **Step 6: Add the race regression test — contra el handler real**

Un mock de proveedor declarado dentro del test y nunca conectado al handler no
demuestra nada: pasaría aunque el gate no existiera. El test tiene que invocar
`handler` y verificar que el proveedor **real** no se llamó.

Append to `netlify/functions/__tests__/backgroundPlanEntitlement.test.ts`:

```ts
import { handler } from '../generate-plan-background'

const callProvider = vi.fn()
vi.mock('../_shared/anthropicCaller', () => ({
  callAnthropicForWeek: (...args: unknown[]) => callProvider(...args),
}))

const putPlan = vi.fn(async () => {})
const getPlan = vi.fn(async () => makePlan('job-abc'))
vi.mock('../_shared/planGenerationShared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../_shared/planGenerationShared')>()),
  resolveAuthContext: async () => ({ userId: 'user-free', token: 'tok-free' }),
  createSupabaseWriter: () => ({ getPlan, putPlan }),
}))

vi.mock('../_shared/resolveEntitlement', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../_shared/resolveEntitlement')>()),
  isEntitlementEnforcementEnabled: () => true,
  resolveEntitlementTier: async () => 'free' as const,
}))

describe('carrera enqueue-aceptado / worker-rechazado (handler real)', () => {
  it('responde 403 con detail, terminaliza el plan y NO llama al proveedor', async () => {
    callProvider.mockClear()
    putPlan.mockClear()

    const response = await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer tok-free' },
      body: JSON.stringify({
        plan: { id: 'plan-1' },
        weeks: [],
        targetWeekIndexes: [0],
        jobId: 'job-abc',
      }),
    } as never, {} as never)

    expect(response?.statusCode).toBe(403)
    const parsed = JSON.parse(response!.body as string)
    expect(parsed.errorCode).toBe('entitlement_required')
    expect(parsed.detail).toMatchObject({ requiredTier: 'advanced', currentTier: 'free' })

    // El plan queda terminal: el cliente no depende del detector de stalled.
    expect(putPlan).toHaveBeenCalledTimes(1)
    expect((putPlan.mock.calls[0][0] as TrainingPlan).generationState).toBe('failed')

    // Lo que de verdad importa: cero gasto.
    expect(callProvider).not.toHaveBeenCalled()
  })
})
```

Si el nombre del módulo del proveedor difiere, ajustar el `vi.mock` al que
importe realmente `asyncGenerationLoop`; el assert que no se puede negociar es
`expect(callProvider).not.toHaveBeenCalled()`.

- [ ] **Step 7: Run tests and typecheck**

Run: `npx tsc -b && npx vitest run netlify/functions/__tests__/`
Expected: verde

- [ ] **Step 8: Commit**

```bash
git add netlify/functions/generate-plan-background.ts netlify/functions/__tests__/backgroundPlanEntitlement.test.ts
git commit -m "feat(entitlements): gate y terminalizacion en generate-plan-background"
```

---

### Task 8: Dexie v20 y espejo con reconciliación

**Files:**
- Create: `src/types/entitlement.ts`
- Modify: `src/db/db.ts` (import de tipo línea ~6, declaración de tabla línea ~30, versión nueva después de línea 251)
- Create: `src/services/entitlements/entitlementService.ts`
- Test: `src/services/entitlements/__tests__/entitlementService.test.ts`
- Test: `src/db/__tests__/dexieV20Upgrade.test.ts`

**Interfaces:**
- Consumes: `resolveTier`, `Tier` (Task 1); `USER_ENTITLEMENT_SELECT` (Task 3); `supabase` de `src/services/auth` (el mismo import que usa `consentService`, que lo trae como `'../auth'`)
- Produces:
  - `interface StoredEntitlement { userId: string; tier: Tier; expiresAt: number | null; confirmedAt: number }`
  - `async function fetchRemoteEntitlement(userId): Promise<{ ok: boolean; row: StoredEntitlement | null }>`
  - `async function hydrateEntitlement(userId): Promise<{ ok: boolean; tier: Tier }>`
  - `async function readMirroredTier(userId, now?): Promise<Tier | null>`

- [ ] **Step 1: Write the failing test**

Create `src/services/entitlements/__tests__/entitlementService.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../../../db/db'

// OJO: el cliente Supabase vive en `src/services/auth`, no en `src/lib`.
// Es el mismo import que usa `consentService.ts` (`from '../auth'`).
const selectMock = vi.fn()
vi.mock('../../auth', () => ({
  supabase: { from: () => ({ select: selectMock }) },
}))

const { hydrateEntitlement, readMirroredTier } = await import('../entitlementService')

const USER = 'user-1'
const NOW = Date.parse('2026-08-15T12:00:00Z')

function remoteReturns(data: unknown, error: unknown = null) {
  selectMock.mockReturnValue({ eq: () => ({ maybeSingle: async () => ({ data, error }) }) })
}

beforeEach(async () => {
  await db.entitlements.clear()
  selectMock.mockReset()
})

describe('hydrateEntitlement — reconciliacion', () => {
  it('fila presente escribe el espejo', async () => {
    remoteReturns({ tier: 'advanced', expires_at: null })
    const result = await hydrateEntitlement(USER)
    expect(result).toEqual({ ok: true, tier: 'advanced' })
    expect(await db.entitlements.get(USER)).toMatchObject({ userId: USER, tier: 'advanced' })
  })

  it('ausencia CONFIRMADA borra el espejo y resuelve free', async () => {
    await db.entitlements.put({ userId: USER, tier: 'advanced', expiresAt: null, confirmedAt: 1 })
    remoteReturns(null)

    const result = await hydrateEntitlement(USER)

    expect(result).toEqual({ ok: true, tier: 'free' })
    expect(await db.entitlements.get(USER)).toBeUndefined()
  })

  it('error de red CONSERVA el espejo', async () => {
    await db.entitlements.put({ userId: USER, tier: 'advanced', expiresAt: null, confirmedAt: 1 })
    remoteReturns(null, { message: 'network' })

    const result = await hydrateEntitlement(USER)

    expect(result.ok).toBe(false)
    expect(await db.entitlements.get(USER)).toMatchObject({ tier: 'advanced' })
  })

  it('vencimiento ILEGIBLE se trata como ausencia confirmada, no como sin vencimiento', async () => {
    await db.entitlements.put({ userId: USER, tier: 'advanced', expiresAt: null, confirmedAt: 1 })
    remoteReturns({ tier: 'advanced', expires_at: 'no-es-fecha' })

    const result = await hydrateEntitlement(USER)

    expect(result).toEqual({ ok: true, tier: 'free' })
    expect(await db.entitlements.get(USER)).toBeUndefined()
  })
})

describe('readMirroredTier', () => {
  it('sin espejo devuelve null (no free): permite distinguir "no se" de "free"', async () => {
    expect(await readMirroredTier(USER, NOW)).toBeNull()
  })

  it('espejo vigente devuelve su tier', async () => {
    await db.entitlements.put({ userId: USER, tier: 'weekly', expiresAt: NOW + 1000, confirmedAt: 1 })
    expect(await readMirroredTier(USER, NOW)).toBe('weekly')
  })

  it('espejo vencido resuelve free sin red', async () => {
    await db.entitlements.put({ userId: USER, tier: 'advanced', expiresAt: NOW - 1, confirmedAt: 1 })
    expect(await readMirroredTier(USER, NOW)).toBe('free')
  })

  it('el espejo de otro usuario no se lee', async () => {
    await db.entitlements.put({ userId: 'otro', tier: 'advanced', expiresAt: null, confirmedAt: 1 })
    expect(await readMirroredTier(USER, NOW)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/entitlements/__tests__/entitlementService.test.ts`
Expected: FAIL — `db.entitlements` no existe

- [ ] **Step 3: Add the type and the Dexie table**

Create `src/types/entitlement.ts`:

```ts
import type { Tier } from '../services/entitlements/entitlementPolicy'

/** Espejo local de lo que Supabase confirmó. Nunca se escribe un tier local. */
export interface StoredEntitlement {
  userId: string
  tier: Tier
  /** Epoch ms; `null` = sin vencimiento. Se conserva para resolver offline. */
  expiresAt: number | null
  confirmedAt: number
}
```

In `src/db/db.ts`, add the import (after line 6):

```ts
import type { StoredEntitlement } from '../types/entitlement'
```

Add the table declaration (after line 30):

```ts
  entitlements!: Table<StoredEntitlement, string>
```

Add the version (after the `version(19)` block, ~line 251):

```ts
    // v20 — espejo local del entitlement confirmado por el servidor. Una fila
    // por cuenta; el servidor sigue siendo la autoridad.
    this.version(20).stores({
      entitlements: 'userId',
    })
```

- [ ] **Step 4: Write the service**

Create `src/services/entitlements/entitlementService.ts`:

```ts
import { db } from '../../db/db'
import { supabase } from '../auth'
import type { StoredEntitlement } from '../../types/entitlement'
import { USER_ENTITLEMENT_SELECT } from './entitlementColumns'
import { isTier, resolveTier, type Tier } from './entitlementPolicy'

const TABLE = 'user_entitlements'

/**
 * Misma semántica fail-closed que el helper de servidor: un vencimiento
 * ilegible NO es "sin vencimiento". Se reimplementa acá en vez de importarse
 * desde `netlify/` para no arrastrar código de Functions al bundle del cliente;
 * el test de abajo fija que ambas se comporten igual.
 */
function parseExpiresAt(
  value: unknown,
): { ok: true; value: number | null } | { ok: false } {
  if (value == null) return { ok: true, value: null }
  if (typeof value !== 'string' || value.length === 0) return { ok: false }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? { ok: false } : { ok: true, value: parsed }
}

/**
 * `ok` distingue "el servidor respondió" de "no pude leer". Es la distinción
 * que hace posible borrar el espejo ante una ausencia confirmada sin borrarlo
 * ante un fallo de red. Mismo contrato que `fetchRemoteConsents`.
 */
export async function fetchRemoteEntitlement(
  userId: string,
): Promise<{ ok: boolean; row: StoredEntitlement | null }> {
  if (!supabase) return { ok: false, row: null }

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
  // Fila presente pero con vencimiento ilegible: se trata como ausencia
  // confirmada, o sea free. Escribir un espejo sin vencimiento sería otorgar
  // el tier para siempre por un dato corrupto.
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
}

/**
 * Reconcilia el espejo. Las tres respuestas son distintas y ninguna se puede
 * colapsar con otra:
 *  - fila presente        → escribir
 *  - ausencia confirmada  → BORRAR (cierra el downgrade)
 *  - fallo de lectura     → CONSERVAR (no castigar red mala)
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

/** `null` significa "no hay espejo", que NO es lo mismo que `free`. */
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/services/entitlements/__tests__/entitlementService.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 6: Write the Dexie upgrade test**

Create `src/db/__tests__/dexieV20Upgrade.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import Dexie from 'dexie'

describe('upgrade Dexie v19 -> v20', () => {
  it('conserva datos previos y agrega la tabla entitlements', async () => {
    // Abrir primero una base legacy v19 CON datos, como exige CLAUDE.md: un
    // upgrade sobre una base vacía no demuestra nada.
    const legacy = new Dexie('EntrenadorDB')
    legacy.version(19).stores({
      sessions: 'id, date, athleteId',
      consentAcceptances: 'id, userId, &[userId+document+version]',
    })
    await legacy.open()
    await legacy.table('sessions').put({ id: 's1', date: '2026-08-01', athleteId: 'a1' })
    legacy.close()

    const { db } = await import('../db')
    await db.open()

    expect(await db.sessions.get('s1')).toMatchObject({ id: 's1' })
    await db.entitlements.put({ userId: 'u1', tier: 'weekly', expiresAt: null, confirmedAt: 1 })
    expect(await db.entitlements.get('u1')).toMatchObject({ tier: 'weekly' })
    expect(db.verno).toBeGreaterThanOrEqual(20)

    db.close()
  })
})
```

- [ ] **Step 7: Run the upgrade test**

Run: `npx vitest run src/db/__tests__/dexieV20Upgrade.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/types/entitlement.ts src/db/db.ts src/services/entitlements/entitlementService.ts src/services/entitlements/__tests__/entitlementService.test.ts src/db/__tests__/dexieV20Upgrade.test.ts
git commit -m "feat(entitlements): Dexie v20 y espejo con reconciliacion de tres casos"
```

---

### Task 9: Store global de entitlement

Un hook con `useState` guarda estado **por instancia**: dos componentes montados
harían dos fetches y podrían discrepar, y nada fuera de React —`useChatStore`,
las cuotas— podría leer el tier. La autoridad tiene que ser un store global
hidratado una sola vez; el hook queda como selector.

**Files:**
- Create: `src/store/useEntitlementStore.ts`
- Create: `src/hooks/useEntitlement.ts`
- Modify: `src/App.tsx` — disparar la hidratación en el bootstrap autenticado
- Test: `src/store/__tests__/useEntitlementStore.test.ts`

**Interfaces:**
- Consumes: `hydrateEntitlement`, `readMirroredTier` (Task 8); `isClassAllowed`, `Tier` (Task 1)
- Produces:
  - `useEntitlementStore` con `{ tier, loading, source, userId, hydrate(userId), reset() }`
  - `function getEntitlementTier(): Tier` — lectura sincrónica fuera de React
  - `function useEntitlement(): { tier; loading; source; canUse(requestClass) }`

- [ ] **Step 1: Write the failing test**

Create `src/store/__tests__/useEntitlementStore.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hydrateEntitlement = vi.fn()
const readMirroredTier = vi.fn()

vi.mock('../../services/entitlements/entitlementService', () => ({
  hydrateEntitlement: (...args: unknown[]) => hydrateEntitlement(...args),
  readMirroredTier: (...args: unknown[]) => readMirroredTier(...args),
}))

const { useEntitlementStore, getEntitlementTier } = await import('../useEntitlementStore')

beforeEach(() => {
  hydrateEntitlement.mockReset()
  readMirroredTier.mockReset()
  useEntitlementStore.getState().reset()
})

describe('hidratacion unica', () => {
  it('dos llamadas concurrentes para el mismo usuario hacen UN solo fetch', async () => {
    readMirroredTier.mockResolvedValue(null)
    hydrateEntitlement.mockResolvedValue({ ok: true, tier: 'advanced' })

    await Promise.all([
      useEntitlementStore.getState().hydrate('user-1'),
      useEntitlementStore.getState().hydrate('user-1'),
    ])

    expect(hydrateEntitlement).toHaveBeenCalledTimes(1)
    expect(useEntitlementStore.getState().tier).toBe('advanced')
  })

  it('cambiar de cuenta descarta el tier anterior antes de hidratar', async () => {
    readMirroredTier.mockResolvedValue(null)
    hydrateEntitlement.mockResolvedValue({ ok: true, tier: 'advanced' })
    await useEntitlementStore.getState().hydrate('user-1')
    expect(useEntitlementStore.getState().tier).toBe('advanced')

    // La cuenta nueva no puede heredar el tier de la anterior ni por un frame.
    hydrateEntitlement.mockImplementation(() => new Promise(() => {}))
    void useEntitlementStore.getState().hydrate('user-2')

    expect(useEntitlementStore.getState().tier).toBe('free')
    expect(useEntitlementStore.getState().source).toBe('default')
    expect(useEntitlementStore.getState().loading).toBe(true)
  })

  it('una respuesta tardia de la cuenta anterior no pisa a la nueva', async () => {
    let resolveOld: (v: unknown) => void = () => {}
    readMirroredTier.mockResolvedValue(null)
    hydrateEntitlement.mockImplementationOnce(() => new Promise((r) => { resolveOld = r }))
    void useEntitlementStore.getState().hydrate('user-1')

    hydrateEntitlement.mockResolvedValueOnce({ ok: true, tier: 'free' })
    await useEntitlementStore.getState().hydrate('user-2')

    resolveOld({ ok: true, tier: 'advanced' })
    await Promise.resolve()

    expect(useEntitlementStore.getState().userId).toBe('user-2')
    expect(useEntitlementStore.getState().tier).toBe('free')
  })
})

describe('estado neutro', () => {
  it('sin espejo arranca loading y source default', async () => {
    readMirroredTier.mockResolvedValue(null)
    hydrateEntitlement.mockImplementation(() => new Promise(() => {}))

    void useEntitlementStore.getState().hydrate('user-1')
    await Promise.resolve()

    expect(useEntitlementStore.getState().loading).toBe(true)
    expect(useEntitlementStore.getState().source).toBe('default')
  })

  it('con espejo lo usa antes de que responda la red', async () => {
    readMirroredTier.mockResolvedValue('advanced')
    hydrateEntitlement.mockImplementation(() => new Promise(() => {}))

    void useEntitlementStore.getState().hydrate('user-1')
    await vi.waitFor(() => expect(useEntitlementStore.getState().source).toBe('mirror'))
    expect(useEntitlementStore.getState().tier).toBe('advanced')
  })
})

describe('getEntitlementTier', () => {
  it('permite leer el tier fuera de React', async () => {
    readMirroredTier.mockResolvedValue(null)
    hydrateEntitlement.mockResolvedValue({ ok: true, tier: 'weekly' })
    await useEntitlementStore.getState().hydrate('user-1')
    expect(getEntitlementTier()).toBe('weekly')
  })

  it('sin hidratar devuelve free', () => {
    expect(getEntitlementTier()).toBe('free')
  })
})

describe('reset', () => {
  it('vuelve a free al cerrar sesion', async () => {
    readMirroredTier.mockResolvedValue(null)
    hydrateEntitlement.mockResolvedValue({ ok: true, tier: 'advanced' })
    await useEntitlementStore.getState().hydrate('user-1')

    useEntitlementStore.getState().reset()

    expect(useEntitlementStore.getState().tier).toBe('free')
    expect(useEntitlementStore.getState().userId).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/__tests__/useEntitlementStore.test.ts`
Expected: FAIL — no existe `../useEntitlementStore`

- [ ] **Step 3: Write the store**

Create `src/store/useEntitlementStore.ts`:

```ts
import { create } from 'zustand'
import { hydrateEntitlement, readMirroredTier } from '../services/entitlements/entitlementService'
import type { Tier } from '../services/entitlements/entitlementPolicy'

export type EntitlementSource = 'remote' | 'mirror' | 'default'

interface EntitlementState {
  tier: Tier
  loading: boolean
  source: EntitlementSource
  userId: string | null
  hydrate: (userId: string) => Promise<void>
  reset: () => void
}

/** Deduplica hidrataciones concurrentes de la misma cuenta. */
let inFlight: { userId: string; promise: Promise<void> } | null = null
/** Descarta respuestas tardías de una cuenta que ya no es la activa. */
let epoch = 0

export const useEntitlementStore = create<EntitlementState>((set, get) => ({
  tier: 'free',
  loading: false,
  source: 'default',
  userId: null,

  hydrate: async (userId: string) => {
    if (inFlight && inFlight.userId === userId) return inFlight.promise

    // Cambiar de cuenta descarta el tier anterior de inmediato: heredarlo aunque
    // sea por un frame le mostraría a la cuenta nueva un plan que no tiene.
    if (get().userId !== userId) {
      set({ userId, tier: 'free', source: 'default', loading: true })
    } else {
      set({ loading: true })
    }

    const myEpoch = ++epoch
    const promise = (async () => {
      const mirrored = await readMirroredTier(userId)
      if (myEpoch !== epoch) return
      if (mirrored) set({ tier: mirrored, source: 'mirror' })

      const remote = await hydrateEntitlement(userId)
      if (myEpoch !== epoch) return
      set({
        tier: remote.tier,
        source: remote.ok ? 'remote' : (mirrored ? 'mirror' : 'default'),
        loading: false,
      })
    })().finally(() => {
      if (inFlight?.userId === userId) inFlight = null
    })

    inFlight = { userId, promise }
    return promise
  },

  reset: () => {
    epoch++
    inFlight = null
    set({ tier: 'free', loading: false, source: 'default', userId: null })
  },
}))

/** Lectura sincrónica para consumidores fuera de React (cuotas, chat store). */
export function getEntitlementTier(): Tier {
  return useEntitlementStore.getState().tier
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/store/__tests__/useEntitlementStore.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Write the selector hook**

Create `src/hooks/useEntitlement.ts`:

```ts
import { useEntitlementStore } from '../store/useEntitlementStore'
import { isClassAllowed, type Tier } from '../services/entitlements/entitlementPolicy'
import type { EntitlementSource } from '../store/useEntitlementStore'

export interface EntitlementView {
  tier: Tier
  loading: boolean
  /** 'default' = sin evidencia todavía; la UI muestra neutro, no una oferta. */
  source: EntitlementSource
  canUse: (requestClass: string) => boolean
}

/** Selector puro sobre el store global. No hidrata: eso lo hace App.tsx. */
export function useEntitlement(): EntitlementView {
  const tier = useEntitlementStore((state) => state.tier)
  const loading = useEntitlementStore((state) => state.loading)
  const source = useEntitlementStore((state) => state.source)

  return {
    tier,
    loading,
    source,
    canUse: (requestClass: string) => isClassAllowed(tier, requestClass),
  }
}
```

- [ ] **Step 6: Mount hydration in `App.tsx`**

Find the authenticated bootstrap effect (the one that runs the initial pull after
sign-in) and add, next to the existing hydrations:

```ts
  useEffect(() => {
    const userId = user?.id
    if (!userId) {
      useEntitlementStore.getState().reset()
      return
    }
    void useEntitlementStore.getState().hydrate(userId)
  }, [user?.id])
```

Import: `import { useEntitlementStore } from './store/useEntitlementStore'`

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run src/store/__tests__/useEntitlementStore.test.ts && npx tsc -b`
Expected: verde

- [ ] **Step 8: Commit**

```bash
git add src/store/useEntitlementStore.ts src/hooks/useEntitlement.ts src/App.tsx src/store/__tests__/useEntitlementStore.test.ts
git commit -m "feat(entitlements): store global hidratado una vez y selector"
```

---

### Task 10: Cuotas por tier realmente cableadas

Crear `QUOTA_BUCKETS` no cambia nada por sí solo. Este task conecta los buckets
con los dos consumidores reales y estampa `userId` en las filas que se cuentan.

**Files:**
- Modify: `src/types/index.ts` — `userId?: string` en `AITechnicalResult`
- Create: `src/services/entitlements/quotaBuckets.ts`
- Modify: `src/services/ai/aiTelemetry.ts` — `getDailyAIUsage`, `assertDailyAIRequestLimit`
- Modify: `src/services/planBuilder/rateLimit.ts` — usar buckets en vez de `DEFAULT_DAILY_AI_LIMITS`
- Modify: los productores de `AITechnicalResult` que estampan filas contables
- Test: `src/services/entitlements/__tests__/quotaBuckets.test.ts`
- Test: `src/services/ai/__tests__/aiTelemetryQuota.test.ts`

**Interfaces:**
- Consumes: `Tier`, `isClassAllowed` (Task 1); `getEntitlementTier` (Task 9)
- Produces:
  - `const QUOTA_BUCKETS`, `bucketForClass`, `bucketLimitForTier`
  - `getDailyAIUsage(now, userId)` — filtrada por cuenta
  - `assertDailyAIRequestLimit(requestClass, now, ctx?)` — por bucket y por tier

- [ ] **Step 1: Write the buckets test**

Create `src/services/entitlements/__tests__/quotaBuckets.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { QUOTA_BUCKETS, bucketForClass, bucketLimitForTier } from '../quotaBuckets'
import type { AIRequestClass } from '../../../types'

const ALL_CLASSES: AIRequestClass[] = [
  'chat_general', 'chat_action', 'weekly_summary', 'week_creator',
  'plan_builder_week', 'plan_builder_pair', 'import_extract',
]

describe('cobertura de buckets', () => {
  it('toda AIRequestClass pertenece a exactamente un bucket', () => {
    for (const requestClass of ALL_CLASSES) {
      expect(QUOTA_BUCKETS.filter((b) => b.classes.includes(requestClass))).toHaveLength(1)
    }
  })
})

describe('bucket de chat compartido', () => {
  it('chat_general y chat_action comparten bucket', () => {
    expect(bucketForClass('chat_general')).toBe(bucketForClass('chat_action'))
  })

  it('free tiene 15 compartidos, no 15 + 10', () => {
    expect(bucketLimitForTier(bucketForClass('chat_general')!, 'free')).toBe(15)
  })

  it('los tiers pagados conservan la capacidad total previa (80 + 40)', () => {
    expect(bucketLimitForTier(bucketForClass('chat_general')!, 'weekly')).toBe(120)
    expect(bucketLimitForTier(bucketForClass('chat_general')!, 'advanced')).toBe(120)
  })
})

describe('import_extract', () => {
  it('tiene bucket propio con 3/dia en free', () => {
    const bucket = bucketForClass('import_extract')!
    expect(bucket.classes).toEqual(['import_extract'])
    expect(bucketLimitForTier(bucket, 'free')).toBe(3)
    expect(bucketLimitForTier(bucket, 'advanced')).toBe(10)
  })
})

describe('clases bloqueadas NO se representan como cuota 0', () => {
  it('devuelve null, no 0, para una clase que el tier no puede usar', () => {
    expect(bucketLimitForTier(bucketForClass('week_creator')!, 'free')).toBeNull()
    expect(bucketLimitForTier(bucketForClass('plan_builder_week')!, 'free')).toBeNull()
    expect(bucketLimitForTier(bucketForClass('plan_builder_week')!, 'weekly')).toBeNull()
  })

  it('plan_builder_week y plan_builder_pair tienen contadores independientes', () => {
    expect(bucketForClass('plan_builder_week')).not.toBe(bucketForClass('plan_builder_pair'))
    expect(bucketLimitForTier(bucketForClass('plan_builder_week')!, 'advanced')).toBe(12)
    expect(bucketLimitForTier(bucketForClass('plan_builder_pair')!, 'advanced')).toBe(6)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/entitlements/__tests__/quotaBuckets.test.ts`
Expected: FAIL — no existe `../quotaBuckets`

- [ ] **Step 3: Write the buckets module**

Create `src/services/entitlements/quotaBuckets.ts`:

```ts
import type { AIRequestClass } from '../../types'
import { isClassAllowed, type Tier } from './entitlementPolicy'

export interface QuotaBucket {
  id: string
  classes: readonly AIRequestClass[]
  limits: Partial<Record<Tier, number>>
}

/**
 * Un bucket agrupa clases que comparten contador. Sólo el chat lo necesita; los
 * demás son buckets de una clase, o sea contadores por clase como hoy.
 *
 * El bucket de chat pagado queda en 120 = 80 + 40 para preservar la capacidad
 * total previa y no introducir una regresión al unificar los dos contadores.
 */
export const QUOTA_BUCKETS: readonly QuotaBucket[] = [
  { id: 'chat', classes: ['chat_general', 'chat_action'], limits: { free: 15, weekly: 120, advanced: 120 } },
  { id: 'import', classes: ['import_extract'], limits: { free: 3, weekly: 10, advanced: 10 } },
  { id: 'weekly_summary', classes: ['weekly_summary'], limits: { weekly: 10, advanced: 10 } },
  { id: 'week_creator', classes: ['week_creator'], limits: { weekly: 8, advanced: 8 } },
  { id: 'plan_builder_week', classes: ['plan_builder_week'], limits: { advanced: 12 } },
  { id: 'plan_builder_pair', classes: ['plan_builder_pair'], limits: { advanced: 6 } },
]

export function bucketForClass(requestClass: AIRequestClass): QuotaBucket | null {
  return QUOTA_BUCKETS.find((bucket) => bucket.classes.includes(requestClass)) ?? null
}

/**
 * `null` significa "no aplica cuota porque el plan no permite esta clase".
 * NO devolver 0: un 0 haría que el llamador reportara límite diario alcanzado
 * cuando el mensaje correcto es la oferta de plan.
 */
export function bucketLimitForTier(bucket: QuotaBucket, tier: Tier): number | null {
  if (!isClassAllowed(tier, bucket.classes[0])) return null
  return bucket.limits[tier] ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/entitlements/__tests__/quotaBuckets.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Write the integration test**

Create `src/services/ai/__tests__/aiTelemetryQuota.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../../../db/db'
import type { AITechnicalResult } from '../../../types'

let currentTier: 'free' | 'weekly' | 'advanced' = 'free'
vi.mock('../../../store/useEntitlementStore', () => ({
  getEntitlementTier: () => currentTier,
}))

const { assertDailyAIRequestLimit, getDailyAIUsage, upsertAIRequestLog } = await import('../aiTelemetry')
const { AIProviderError } = await import('../types')

const USER = 'user-a'

function log(traceId: string, userId: string | undefined, requestClass: AITechnicalResult['requestClass']): AITechnicalResult {
  return { traceId, userId, surface: 'chat', requestClass, startedAt: Date.now() } as AITechnicalResult
}

beforeEach(async () => {
  await db.aiRequestLogs.clear()
  currentTier = 'free'
})

describe('account scoping', () => {
  it('no cuenta filas de otra cuenta', async () => {
    await upsertAIRequestLog(log('t1', 'user-a', 'chat_general'))
    await upsertAIRequestLog(log('t2', 'user-b', 'chat_general'))
    expect((await getDailyAIUsage(Date.now(), 'user-a')).chat_general).toBe(1)
  })

  it('las filas legacy sin userId no cuentan para nadie', async () => {
    await upsertAIRequestLog(log('t1', undefined, 'chat_general'))
    expect((await getDailyAIUsage(Date.now(), 'user-a')).chat_general ?? 0).toBe(0)
    expect((await getDailyAIUsage(Date.now(), null)).chat_general ?? 0).toBe(0)
  })
})

describe('BUCKET COMPARTIDO: 15 de chat_general agotan tambien chat_action', () => {
  it('el mensaje 16 falla aunque sea de la otra clase del bucket', async () => {
    for (let i = 0; i < 15; i++) {
      await upsertAIRequestLog(log(`t${i}`, USER, 'chat_general'))
    }
    await expect(
      assertDailyAIRequestLimit('chat_action', Date.now(), { userId: USER }),
    ).rejects.toBeInstanceOf(AIProviderError)
  })

  it('con 14 usados todavia pasa', async () => {
    for (let i = 0; i < 14; i++) {
      await upsertAIRequestLog(log(`t${i}`, USER, 'chat_general'))
    }
    await expect(
      assertDailyAIRequestLimit('chat_action', Date.now(), { userId: USER }),
    ).resolves.toBeUndefined()
  })

  it('import_extract tiene contador propio y no se agota con el chat', async () => {
    for (let i = 0; i < 15; i++) {
      await upsertAIRequestLog(log(`t${i}`, USER, 'chat_general'))
    }
    await expect(
      assertDailyAIRequestLimit('import_extract', Date.now(), { userId: USER }),
    ).resolves.toBeUndefined()
  })
})

describe('el limite depende del tier', () => {
  it('weekly aguanta 100 de chat donde free ya habria fallado', async () => {
    currentTier = 'weekly'
    for (let i = 0; i < 100; i++) {
      await upsertAIRequestLog(log(`t${i}`, USER, 'chat_general'))
    }
    await expect(
      assertDailyAIRequestLimit('chat_general', Date.now(), { userId: USER }),
    ).resolves.toBeUndefined()
  })
})

describe('ORDEN: clase bloqueada por plan NO reporta cuota', () => {
  it('free + week_creator no lanza rate_limit: el gate de entitlement es quien rechaza', async () => {
    currentTier = 'free'
    // Sin filas: si la cuota mandara, un límite `null`/0 lanzaría igual.
    // El contrato es que la cuota NO opina sobre clases no permitidas.
    await expect(
      assertDailyAIRequestLimit('week_creator', Date.now(), { userId: USER }),
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 6: Wire the quota**

In `src/types/index.ts`, add to `AITechnicalResult` after `generationId`:

```ts
  /** Cuenta dueña de la request. Las filas legacy sin este campo no cuentan
   *  para ninguna cuota: contarlas castigaría a un usuario por consumo ajeno. */
  userId?: string
```

In `src/services/ai/aiTelemetry.ts`, replace `getDailyAIUsage` and
`assertDailyAIRequestLimit`:

```ts
import { bucketForClass, bucketLimitForTier } from '../entitlements/quotaBuckets'
import { getEntitlementTier } from '../../store/useEntitlementStore'

export async function getDailyAIUsage(
  now = Date.now(),
  userId: string | null = null,
): Promise<Partial<Record<AIRequestClass, number>>> {
  const start = startOfLocalDay(now)
  const logs = await db.aiRequestLogs.where('startedAt').aboveOrEqual(start).toArray()

  // Account-scoped: dos cuentas en el mismo navegador no comparten cupo. Las
  // filas legacy sin `userId` no pertenecen a nadie y quedan fuera; el costo es
  // una ventana única de cupo extra tras el deploy.
  const owned = logs.filter((log) => log.userId != null && log.userId === userId)

  // Quota is spent per logical generation, not per telemetry row. One Week
  // Creator request can log several rows -- a provider attempt, a retry, and the
  // local fallback that costs no provider call -- and charging each of them let
  // usage run past the declared daily cap.
  const counted = new Set<string>()
  return owned.reduce<Partial<Record<AIRequestClass, number>>>((acc, log) => {
    const generationKey = `${log.requestClass}:${log.generationId ?? log.traceId}`
    if (counted.has(generationKey)) return acc
    counted.add(generationKey)
    acc[log.requestClass] = (acc[log.requestClass] ?? 0) + 1
    return acc
  }, {})
}

export async function assertDailyAIRequestLimit(
  requestClass: AIRequestClass,
  now = Date.now(),
  ctx?: { userId?: string | null; tier?: Tier },
): Promise<void> {
  try {
    const bucket = bucketForClass(requestClass)
    if (!bucket) return

    const tier = ctx?.tier ?? getEntitlementTier()
    const limit = bucketLimitForTier(bucket, tier)
    // `null` = la clase no está permitida para este tier. La cuota NO opina:
    // rechazar acá reportaría "límite diario" cuando el mensaje correcto es la
    // oferta de plan, y el gate server-side ya es quien rechaza.
    if (limit == null) return

    const usage = await getDailyAIUsage(now, ctx?.userId ?? null)
    // El bucket es compartido: se suma el consumo de TODAS sus clases.
    const used = bucket.classes.reduce((total, cls) => total + (usage[cls] ?? 0), 0)

    if (used >= limit) {
      throw new AIProviderError(
        'gemini',
        'rate_limit',
        `Límite diario alcanzado (${used}/${limit}). Vuelve a intentarlo mañana.`,
        false,
      )
    }
  } catch (error) {
    if (error instanceof AIProviderError) throw error
    // If local telemetry cannot be read, do not block the coach.
  }
}
```

Add `import type { Tier } from '../entitlements/entitlementPolicy'`.

- [ ] **Step 7: Stamp `userId` on the rows that count**

Every producer of `AITechnicalResult` that ends up in `aiRequestLogs` has to
stamp the active account, or the counter will always read zero. Find them with:

```bash
grep -rn "upsertAIRequestLog(" src/ --include=*.ts --include=*.tsx | grep -v __tests__
```

For each call site, add `userId: useAuthStore.getState().user?.id`. In
`useAIDebugStore` (which builds the rows for the chat path) stamp it where the
row is created, so retries and fallbacks of the same generation carry it too.

- [ ] **Step 8: Migrate `planBuilder/rateLimit.ts`**

`assertPlanBuilderWeekRateLimit` still reads `DEFAULT_DAILY_AI_LIMITS`. Replace
its body so the limit comes from the bucket and the tier:

```ts
export async function assertPlanBuilderWeekRateLimit(
  weekIndexes: readonly number[],
  now = Date.now(),
  ctx?: { userId?: string | null; tier?: Tier },
): Promise<void> {
  const requested = uniqueWeekIndexes(weekIndexes).length
  if (requested === 0) return

  try {
    const bucket = bucketForClass(REQUEST_CLASS)
    if (!bucket) return
    const tier = ctx?.tier ?? getEntitlementTier()
    const limit = bucketLimitForTier(bucket, tier)
    // Clase no permitida: el gate de entitlement rechaza, no la cuota.
    if (limit == null) return

    const usage = await getDailyAIUsage(now, ctx?.userId ?? null)
    const used = bucket.classes.reduce((total, cls) => total + (usage[cls] ?? 0), 0)
    const remaining = Math.max(0, limit - used)
    if (requested > remaining) {
      throw new PlanBuilderDailyQuotaError({ requested, remaining, limit })
    }
  } catch (error) {
    if (error instanceof AIProviderError) throw error
    // If local telemetry cannot be read, do not block generation.
  }
}
```

Delete the now-unused `DEFAULT_DAILY_AI_LIMITS` import from this file. Keep the
constant exported from `aiTelemetry.ts` only if `getBetaQualitySnapshot` still
needs it; otherwise replace its use there with the per-tier limits so Ajustes
muestre los topes reales del plan del usuario.

- [ ] **Step 9: Run the full suite**

Run: `npx vitest run src/services/ai/ src/services/planBuilder/ src/services/entitlements/ && npx tsc -b`
Expected: verde. Ajustar los tests existentes que asumían `DEFAULT_DAILY_AI_LIMITS`.

- [ ] **Step 10: Commit**

```bash
git add src/types/index.ts src/services/entitlements/quotaBuckets.ts src/services/ai/aiTelemetry.ts src/services/planBuilder/rateLimit.ts src/services/entitlements/__tests__/quotaBuckets.test.ts src/services/ai/__tests__/aiTelemetryQuota.test.ts
git commit -m "feat(entitlements): cuotas por bucket y tier, account-scoped"
```

---

### Task 11: `ProxyProvider` preserva el 403 tipado

Sin esto, el arreglo del servidor (Task 5) no produce ningún cambio observable.

**Files:**
- Create: `src/services/ai/providers/proxyHttpError.ts`
- Modify: `src/services/ai/providers/ProxyProvider.ts` — eliminar el método privado, delegar en los dos call sites (líneas 135 y 185), agregar `detail?: unknown` a los dos tipos inline
- Test: `src/services/ai/providers/__tests__/proxyEntitlementError.test.ts`

**Interfaces:**
- Consumes: `EntitlementRequiredError`, `isEntitlementRequiredDetail` (Task 2)
- Produces: `function classifyProxyHttpError(res: Response, data: ProxyErrorPayload): never`

- [ ] **Step 1: Write the failing test**

Create `src/services/ai/providers/__tests__/proxyEntitlementError.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { classifyProxyHttpError } from '../proxyHttpError'
import { EntitlementRequiredError } from '../../../entitlements/entitlementError'

function res(status: number): Response {
  return new Response(null, { status })
}

describe('classifyProxyHttpError preserva entitlement_required', () => {
  it('403 con detail produce EntitlementRequiredError con metadata intacta', () => {
    const detail = { requestClass: 'plan_builder_week', requiredTier: 'advanced', currentTier: 'free' }
    try {
      classifyProxyHttpError(res(403), { error: 'Requiere advanced.', errorCode: 'entitlement_required', detail })
      throw new Error('debio lanzar')
    } catch (error) {
      expect(error).toBeInstanceOf(EntitlementRequiredError)
      expect((error as EntitlementRequiredError).detail).toEqual(detail)
    }
  })

  it('403 con codigo pero detail malformado NO se convierte en entitlement', () => {
    try {
      classifyProxyHttpError(res(403), {
        error: 'Requiere advanced.',
        errorCode: 'entitlement_required',
        detail: { requiredTier: 'pro' },
      })
      throw new Error('debio lanzar')
    } catch (error) {
      expect(error).not.toBeInstanceOf(EntitlementRequiredError)
      expect((error as { code?: string }).code).toBe('unauthorized')
    }
  })

  it('403 sin codigo propio sigue siendo unauthorized', () => {
    try {
      classifyProxyHttpError(res(403), { error: 'Sesión inválida.' })
      throw new Error('debio lanzar')
    } catch (error) {
      expect((error as { code?: string }).code).toBe('unauthorized')
    }
  })

  it('401 sigue siendo unauthorized', () => {
    try {
      classifyProxyHttpError(res(401), { error: 'Sesión requerida.' })
      throw new Error('debio lanzar')
    } catch (error) {
      expect((error as { code?: string }).code).toBe('unauthorized')
    }
  })

  it('429 sigue siendo rate_limit reintentable', () => {
    try {
      classifyProxyHttpError(res(429), { error: 'Muchas.' })
      throw new Error('debio lanzar')
    } catch (error) {
      expect((error as { code?: string; retryable?: boolean }).code).toBe('rate_limit')
      expect((error as { retryable?: boolean }).retryable).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/ai/providers/__tests__/proxyEntitlementError.test.ts`
Expected: FAIL — no existe `../proxyHttpError`

- [ ] **Step 3: Extract the classifier**

La lógica hoy es un método privado, intesteable sin trucos sobre el prototipo.
Se extrae a una función libre y el método desaparece.

Create `src/services/ai/providers/proxyHttpError.ts`:

```ts
import { createProviderError } from '../types'
import type { AIErrorCode } from '../types'
import { EntitlementRequiredError, isEntitlementRequiredDetail } from '../../entitlements/entitlementError'

export interface ProxyErrorPayload {
  error?: string
  errorCode?: AIErrorCode
  detail?: unknown
}

export function classifyProxyHttpError(res: Response, data: ProxyErrorPayload): never {
  const message = data.error ?? `Error del servidor (${res.status}).`

  // ANTES del aplanado a 'unauthorized': un rechazo por plan trae su propia
  // metadata y aplanarlo lo rutearía como sesión inválida, perdiendo la oferta.
  // El servidor ya lo preserva (coach.ts normalizeError). Si acá se aplanara
  // igual, ese arreglo no tendría ningún efecto observable.
  if (res.status === 403
    && data.errorCode === 'entitlement_required'
    && isEntitlementRequiredDetail(data.detail)) {
    throw new EntitlementRequiredError(data.detail)
  }

  if (res.status === 401 || res.status === 403) {
    throw createProviderError('gemini', data.errorCode === 'misconfigured' ? 'misconfigured' : 'unauthorized', message)
  }
  if (res.status === 429 || data.errorCode === 'rate_limit') {
    throw createProviderError('gemini', 'rate_limit', message, true)
  }
  if (res.status === 502 || res.status === 503 || res.status === 504 || data.errorCode === 'timeout') {
    throw createProviderError('gemini', 'timeout', message, true)
  }
  if (data.errorCode === 'misconfigured') {
    throw createProviderError('gemini', 'misconfigured', message)
  }
  throw createProviderError('gemini', data.errorCode ?? 'server_error', message)
}
```

**Antes de borrar el método privado**, comparar rama por rama contra
`ProxyProvider.ts:322-345`: cualquier diferencia es una regresión silenciosa en
todo el manejo de errores del chat, no sólo en el camino de entitlement.

In `ProxyProvider.ts`: delete `private throwHttpError`, import
`classifyProxyHttpError`, add `detail?: unknown` to the two inline response
types, and replace both call sites with `classifyProxyHttpError(res, data)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/ai/providers/__tests__/ && npx tsc -b`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/services/ai/providers/proxyHttpError.ts src/services/ai/providers/ProxyProvider.ts src/services/ai/providers/__tests__/proxyEntitlementError.test.ts
git commit -m "fix(entitlements): el cliente deja de aplanar el 403 a unauthorized"
```

---

### Task 12: Plan Builder preserva el 403 en el enqueue

`ProxyProvider` cubre el camino del coach. Plan Builder tiene el suyo propio y
hoy descarta la metadata: `triggerBackgroundGeneration` parsea sólo
`{ jobId, error }` y lanza `PlanEnqueueRejectedError(message, status)`. Durante
el rollout servidor-on/cliente-off, un Free vería un fallo técnico en vez de la
oferta.

**Files:**
- Modify: `src/services/planBuilder/triggerBackgroundGeneration.ts` — parseo de la respuesta y `PlanEnqueueRejectedError`
- Test: `src/services/planBuilder/__tests__/triggerBackgroundEntitlement.test.ts`

**Interfaces:**
- Consumes: `isEntitlementRequiredDetail`, `EntitlementRequiredDetail` (Task 2)
- Produces: `PlanEnqueueRejectedError` con `readonly entitlement: EntitlementRequiredDetail | null`

- [ ] **Step 1: Write the failing test**

Create `src/services/planBuilder/__tests__/triggerBackgroundEntitlement.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { triggerBackgroundGeneration } from '../triggerBackgroundGeneration'
import { PlanEnqueueRejectedError } from '../triggerBackgroundGeneration'

afterEach(() => { vi.restoreAllMocks() })

function mockResponse(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })))
}

const INPUT = { plan: { id: 'plan-1' }, weeks: [], targetWeekIndexes: [0] } as never

describe('el 403 de entitlement conserva su metadata', () => {
  it('expone el detail para que la UI arme la oferta', async () => {
    const detail = { requestClass: 'plan_builder_week', requiredTier: 'advanced', currentTier: 'free' }
    mockResponse(403, { error: 'Requiere advanced.', errorCode: 'entitlement_required', detail })

    await expect(triggerBackgroundGeneration(INPUT, 'tok')).rejects.toSatisfy((error: unknown) => {
      const err = error as PlanEnqueueRejectedError
      return err instanceof PlanEnqueueRejectedError
        && err.status === 403
        && JSON.stringify(err.entitlement) === JSON.stringify(detail)
    })
  })

  it('un 403 sin detail deja entitlement en null y sigue siendo un rechazo normal', async () => {
    mockResponse(403, { error: 'Sesión inválida.' })
    await expect(triggerBackgroundGeneration(INPUT, 'tok')).rejects.toSatisfy((error: unknown) => {
      return (error as PlanEnqueueRejectedError).entitlement === null
    })
  })

  it('un detail malformado no se propaga como oferta', async () => {
    mockResponse(403, { errorCode: 'entitlement_required', detail: { requiredTier: 'pro' } })
    await expect(triggerBackgroundGeneration(INPUT, 'tok')).rejects.toSatisfy((error: unknown) => {
      return (error as PlanEnqueueRejectedError).entitlement === null
    })
  })

  it('un 500 sigue comportandose igual que antes', async () => {
    mockResponse(500, { error: 'boom' })
    await expect(triggerBackgroundGeneration(INPUT, 'tok')).rejects.toSatisfy((error: unknown) => {
      const err = error as PlanEnqueueRejectedError
      return err.status === 500 && err.entitlement === null
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/triggerBackgroundEntitlement.test.ts`
Expected: FAIL — `entitlement` no existe en `PlanEnqueueRejectedError`

- [ ] **Step 3: Preserve the metadata**

In `src/services/planBuilder/triggerBackgroundGeneration.ts`, extend the error
class:

```ts
export class PlanEnqueueRejectedError extends Error {
  readonly status: number
  /** Metadata de oferta cuando el rechazo fue por plan; `null` en el resto. */
  readonly entitlement: EntitlementRequiredDetail | null

  constructor(message: string, status: number, entitlement: EntitlementRequiredDetail | null = null) {
    super(message)
    this.name = 'PlanEnqueueRejectedError'
    this.status = status
    this.entitlement = entitlement
  }
}
```

And widen the response parse (line ~93):

```ts
  const result = await response.json().catch(() => ({})) as {
    jobId?: string
    error?: string
    errorCode?: string
    detail?: unknown
  }
  if (!response.ok) {
    // Un rechazo por plan no es un fallo técnico: conserva su metadata para que
    // la página muestre la oferta en vez de un error.
    const entitlement = result.errorCode === 'entitlement_required'
      && isEntitlementRequiredDetail(result.detail)
      ? result.detail
      : null
    throw new PlanEnqueueRejectedError(
      result.error ?? `No se pudo iniciar la generación async (${response.status}).`,
      response.status,
      entitlement,
    )
  }
```

Import: `import { isEntitlementRequiredDetail, type EntitlementRequiredDetail } from '../entitlements/entitlementError'`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/planBuilder/__tests__/triggerBackgroundEntitlement.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Surface it in the store**

Find the `catch` in `usePlanBuilderStore` that handles `PlanEnqueueRejectedError`
and add a transient field, same shape as the chat one:

```ts
  entitlementOffer: EntitlementRequiredDetail | null
```

```ts
      if (error instanceof PlanEnqueueRejectedError && error.entitlement) {
        set({ entitlementOffer: error.entitlement, isGenerating: false })
        return
      }
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run src/services/planBuilder/ && npx tsc -b`
Expected: verde

- [ ] **Step 7: Commit**

```bash
git add src/services/planBuilder/triggerBackgroundGeneration.ts src/store/usePlanBuilderStore.ts src/services/planBuilder/__tests__/triggerBackgroundEntitlement.test.ts
git commit -m "fix(entitlements): Plan Builder conserva la metadata del 403"
```

---

### Task 13: Diagnóstico `filtered_create_week` y su consumidor

**Files:**
- Modify: `src/services/ai/responseNormalizer.ts` — bloque de filtrado (líneas 214-221) y el objeto de retorno
- Modify: `src/services/ai/types.ts` — campo nuevo en `CoachNormalizedResponse`
- Modify: `src/store/useChatStore.ts` — traducir el diagnóstico a oferta
- Test: `src/services/ai/__tests__/filteredCreateWeekDiagnostic.test.ts`

**Interfaces:**
- Consumes: `normalizeResponse(raw: AIRawResponse): CoachNormalizedResponse` — **ojo: la API real recibe un objeto `AIRawResponse` con `.text` y `.requestClass`, no `(string, requestClass)`**
- Produces: `CoachNormalizedResponse.filteredCreateWeek: boolean`

- [ ] **Step 1: Write the failing test**

Create `src/services/ai/__tests__/filteredCreateWeekDiagnostic.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { normalizeResponse } from '../responseNormalizer'
import type { AIRawResponse, AIRequestClass } from '../../../types'

const CREATE_WEEK_TEXT = JSON.stringify({
  message: 'Te armo la semana.',
  actions: [{ type: 'create_week', targetDate: '2026-08-17', sessions: [] }],
})

function raw(text: string, requestClass: AIRequestClass): AIRawResponse {
  return { text, requestClass, provider: 'gemini' } as AIRawResponse
}

describe('BARRERA DE NEGOCIO: create_week nunca sale de chat_action', () => {
  // Este filtro dejó de ser una regla de calidad: es lo que impide que un
  // usuario free obtenga una semana generada por la vía del chat, sin pasar
  // por el gate de `week_creator`. No retirarlo sin leer el spec §3.4.
  it('chat_action descarta la accion create_week', () => {
    const result = normalizeResponse(raw(CREATE_WEEK_TEXT, 'chat_action'))
    expect(result.actions?.some((a) => a.type === 'create_week')).toBeFalsy()
  })

  it('emite el diagnostico neutro filteredCreateWeek', () => {
    expect(normalizeResponse(raw(CREATE_WEEK_TEXT, 'chat_action')).filteredCreateWeek).toBe(true)
  })

  it('sin create_week el diagnostico es false', () => {
    const plain = JSON.stringify({ message: 'Hola.', actions: [] })
    expect(normalizeResponse(raw(plain, 'chat_action')).filteredCreateWeek).toBe(false)
  })

  it('week_creator NO filtra: ahi la accion es legitima', () => {
    const result = normalizeResponse(raw(CREATE_WEEK_TEXT, 'week_creator'))
    expect(result.actions?.some((a) => a.type === 'create_week')).toBe(true)
    expect(result.filteredCreateWeek).toBe(false)
  })

  it('el normalizador NO recibe tier: emite igual para todos', () => {
    // La firma toma un solo argumento a propósito. Si algún día recibe el tier,
    // este test deja de pasar y hay que releer el spec §6.1: la decisión
    // comercial vive en presentación, no acá.
    expect(normalizeResponse.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/ai/__tests__/filteredCreateWeekDiagnostic.test.ts`
Expected: FAIL — `filteredCreateWeek` no existe en el resultado

- [ ] **Step 3: Emit the diagnostic**

In `src/services/ai/responseNormalizer.ts`, replace lines 214-221:

```ts
  // BARRERA DE NEGOCIO, no sólo regla de calidad: esto es lo que impide que un
  // usuario free obtenga una semana generada por la vía del chat sin pasar por
  // el gate de `week_creator`. Ver spec §3.4 antes de tocarlo.
  let filteredCreateWeek = false
  if (requestClass === 'chat_action' && actions?.length) {
    const nextActions = actions.filter((action) => action.type !== 'create_week')
    filteredCreateWeek = nextActions.length < actions.length
    invalidActionCount += actions.length - nextActions.length
    if (actions.length > 0 && nextActions.length === 0) {
      actionParseFailed = true
      likelyTruncated = true
    }
    actions = nextActions
  }
```

Add `filteredCreateWeek` to the returned object, and to `CoachNormalizedResponse`
in `src/services/ai/types.ts`:

```ts
  /**
   * Diagnóstico neutro: la respuesta traía `create_week` en un turno de chat y
   * se descartó. NO es una decisión comercial — el normalizador no conoce el
   * tier y no debe conocerlo. La capa de presentación lo traduce a oferta sólo
   * cuando el tier resuelto está por debajo de `weekly`.
   */
  filteredCreateWeek: boolean
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/ai/__tests__/filteredCreateWeekDiagnostic.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Consume it in the chat store**

Where `useChatStore` handles a successful normalized response, translate the
diagnostic into an offer **only for tiers below `weekly`**:

```ts
      if (normalized.filteredCreateWeek && !isClassAllowed(getEntitlementTier(), 'week_creator')) {
        set({ entitlementOffer: buildEntitlementDetail('week_creator', 'weekly', getEntitlementTier()) })
      }
```

- [ ] **Step 6: Test the tier-dependent translation**

Append to the test file:

```ts
import { isClassAllowed } from '../../entitlements/entitlementPolicy'

describe('la traduccion a oferta depende del tier, no del diagnostico', () => {
  it('weekly NO ve la tarjeta aunque el diagnostico se emita', () => {
    const result = normalizeResponse(raw(CREATE_WEEK_TEXT, 'chat_action'))
    expect(result.filteredCreateWeek).toBe(true)
    // La condición exacta que usa el store:
    expect(isClassAllowed('weekly', 'week_creator')).toBe(true)
  })

  it('free SI la ve', () => {
    expect(isClassAllowed('free', 'week_creator')).toBe(false)
  })
})
```

- [ ] **Step 7: Run the full normalizer suite**

Run: `npx vitest run src/services/ai/ && npx tsc -b`
Expected: verde

- [ ] **Step 8: Commit**

```bash
git add src/services/ai/responseNormalizer.ts src/services/ai/types.ts src/store/useChatStore.ts src/services/ai/__tests__/filteredCreateWeekDiagnostic.test.ts
git commit -m "feat(entitlements): diagnostico filtered_create_week y su traduccion a oferta"
```

---

### Task 14: `UpsellCard` y cableado en las dos superficies

**Files:**
- Create: `src/components/entitlements/UpsellCard.tsx`
- Modify: `src/services/entitlements/entitlementError.ts` — `toChatEntitlementOffer`
- Modify: `src/store/useChatStore.ts` — interceptar antes de `formatError`; caso nuevo en `formatError`
- Modify: `src/pages/ChatCoach.tsx` — render de la tarjeta
- Modify: `src/pages/PlanBuilderV2Page.tsx` — gatear **affordances**, no la página
- Test: `src/components/entitlements/__tests__/UpsellCard.test.tsx`
- Test: `src/store/__tests__/chatEntitlementOffer.test.ts`

**Interfaces:**
- Consumes: `EntitlementRequiredDetail` (Task 2); `useEntitlement` (Task 9)
- Produces: `function UpsellCard(props: { requestClass: string; requiredTier: Tier }): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `src/components/entitlements/__tests__/UpsellCard.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { UpsellCard } from '../UpsellCard'

function renderCard(requestClass: string, requiredTier: 'weekly' | 'advanced') {
  return render(
    <MemoryRouter>
      <UpsellCard requestClass={requestClass} requiredTier={requiredTier} />
    </MemoryRouter>,
  )
}

describe('UpsellCard', () => {
  it('nombra la funcion y el plan, con CTA a pricing', () => {
    renderCard('plan_builder_week', 'advanced')
    expect(screen.getByText(/Plan Builder/i)).toBeTruthy()
    expect(screen.getByText(/Avanzado/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /ver planes/i }).getAttribute('href')).toBe('/pricing')
  })

  it('usa el nombre comercial del tier, no el identificador tecnico', () => {
    renderCard('week_creator', 'weekly')
    expect(screen.getByText(/Coach Semanal/i)).toBeTruthy()
    expect(screen.queryByText(/\bweekly\b/)).toBeNull()
  })

  it('no usa lenguaje de error', () => {
    const { container } = renderCard('plan_builder_week', 'advanced')
    expect(container.textContent).not.toMatch(/error|falló|inválido|no autorizado/i)
  })

  it('una clase desconocida cae a copy generico sin romper', () => {
    renderCard('clase_inventada', 'advanced')
    expect(screen.getByRole('link', { name: /ver planes/i })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/entitlements/__tests__/UpsellCard.test.tsx`
Expected: FAIL — no existe `../UpsellCard`

- [ ] **Step 3: Write the component**

Create `src/components/entitlements/UpsellCard.tsx`:

```tsx
import { Link } from 'react-router-dom'
import type { Tier } from '../../services/entitlements/entitlementPolicy'

/** Nombres comerciales. El usuario nunca ve `weekly` ni `advanced`. */
const TIER_LABEL: Record<Tier, string> = {
  free: 'Base',
  weekly: 'Coach Semanal',
  advanced: 'Avanzado',
}

const FEATURE_LABEL: Record<string, string> = {
  plan_builder_week: 'Plan Builder',
  plan_builder_pair: 'Plan Builder',
  week_creator: 'la semana generada por el coach',
  weekly_summary: 'los resúmenes semanales',
}

export function UpsellCard({
  requestClass,
  requiredTier,
}: {
  requestClass: string
  requiredTier: Tier
}) {
  const feature = FEATURE_LABEL[requestClass] ?? 'esta función'

  return (
    <div className="rounded-lg border border-brand/30 bg-brand/5 p-4">
      <p className="text-sm font-semibold text-ink">
        {feature} está en el plan {TIER_LABEL[requiredTier]}
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        Podés seguir usando el coach y registrando tus entrenamientos. Cuando
        quieras que arme y ajuste tu planificación, subí de plan.
      </p>
      <Link
        to="/pricing"
        className="mt-3 inline-flex items-center rounded-md bg-brand px-3 py-2 text-sm font-medium text-white"
      >
        Ver planes
      </Link>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/entitlements/__tests__/UpsellCard.test.tsx`
Expected: PASS — 4 tests

- [ ] **Step 5: Add the chat translator**

Append to `src/services/entitlements/entitlementError.ts`:

```ts
/**
 * Traduce un error a la metadata de oferta, o `null` si no corresponde.
 * `useChatStore.formatError` reexpone `Error.message` crudo en el hilo — el
 * defecto que §21 del roadmap documenta —, así que este chequeo tiene que
 * correr ANTES de llegar ahí.
 */
export function toChatEntitlementOffer(error: unknown): EntitlementRequiredDetail | null {
  if (error instanceof EntitlementRequiredError) return error.detail
  return null
}
```

Create `src/store/__tests__/chatEntitlementOffer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  EntitlementRequiredError,
  buildEntitlementDetail,
  toChatEntitlementOffer,
} from '../../services/entitlements/entitlementError'

describe('el 403 no llega crudo al chat', () => {
  it('un EntitlementRequiredError se traduce a oferta', () => {
    const detail = buildEntitlementDetail('week_creator', 'weekly', 'free')
    expect(toChatEntitlementOffer(new EntitlementRequiredError(detail))).toEqual(detail)
  })

  it('cualquier otro error devuelve null y sigue el camino normal', () => {
    expect(toChatEntitlementOffer(new Error('timeout'))).toBeNull()
  })
})
```

- [ ] **Step 6: Wire the chat**

La oferta es UI efímera: no se escribe en `chatMessages` ni se sincroniza,
porque no es contenido de la conversación. Eso evita tocar `ChatMessage`, su
serializador y el sync.

Add to the store state (init `null`, clear at the start of every send):

```ts
  /** Oferta de plan a mostrar bajo el hilo. Efímera: no se persiste. */
  entitlementOffer: EntitlementRequiredDetail | null
```

In the catch block, **before** the `coachErrorMsg` branch (line ~444):

```ts
      const offer = toChatEntitlementOffer(error)
      if (offer) {
        // Oferta, no error: el usuario no hizo nada mal, así que no se anexa
        // un mensaje de error ni se persiste nada.
        set({ entitlementOffer: offer, isLoading: false, streamingText: '', responsePhase: 'idle' })
        return { route: route.kind }
      }
```

Defensa adicional en `formatError`, cuyo `default` devuelve
`` `Error de RallyIQ (${e.provider}): ${e.message}` ``:

```ts
      case 'entitlement_required':
        return 'Esta función está en un plan superior. Mirá los planes disponibles.'
```

In `src/pages/ChatCoach.tsx`:

```tsx
  const entitlementOffer = useChatStore(s => s.entitlementOffer)
  // ... bajo el hilo:
  {entitlementOffer && (
    <UpsellCard
      requestClass={entitlementOffer.requestClass}
      requiredTier={entitlementOffer.requiredTier}
    />
  )}
```

- [ ] **Step 7: Gate Plan Builder affordances, not the page**

**No** reemplazar la página con un `return` temprano: un usuario que bajó de plan
tiene que poder seguir viendo los planes que ya generó. Se gatean las
**acciones** — generar, reparar, reintentar — y se muestra la oferta arriba.

```tsx
  const { canUse, loading: entitlementLoading } = useEntitlement()
  const planBuilderBlocked = isProactiveEntitlementUiEnabled()
    && !entitlementLoading
    && !canUse('plan_builder_week')
```

```tsx
  {planBuilderBlocked && (
    <UpsellCard requestClass="plan_builder_week" requiredTier="advanced" />
  )}

  {/* Los planes existentes se siguen listando siempre. */}
  <ExistingPlansList />

  {/* Cada affordance de generación queda condicionada: */}
  {!planBuilderBlocked && <GenerateButton />}
  {!planBuilderBlocked && <RepairWeekButton />}
  {!planBuilderBlocked && <RetryButton />}
```

**El estado de carga no puede bloquear la página.** Con `VITE_ENTITLEMENTS`
apagada, `planBuilderBlocked` es `false` sin mirar `loading`, así que el
comportamiento es idéntico al de hoy — incluso si la hidratación cuelga para
siempre. Con la flag encendida, mientras `loading` sea `true` tampoco se bloquea:
se prefiere mostrar un botón de más a acusar de Free a quien pagó. El servidor
rechaza igual si hace falta, y ahí entra el camino reactivo.

- [ ] **Step 8: Run tests, lint and typecheck**

Run: `npx vitest run src/components/entitlements/ src/store/__tests__/chatEntitlementOffer.test.ts && npx tsc -b && npm run lint`
Expected: verde

- [ ] **Step 9: Commit**

```bash
git add src/components/entitlements/ src/services/entitlements/entitlementError.ts src/store/useChatStore.ts src/pages/ChatCoach.tsx src/pages/PlanBuilderV2Page.tsx src/store/__tests__/chatEntitlementOffer.test.ts
git commit -m "feat(entitlements): tarjeta de oferta en chat y affordances de Plan Builder"
```

---

### Task 15: Flag de UI proactiva

**Files:**
- Create: `src/services/entitlements/entitlementFlag.ts`
- Test: `src/services/entitlements/__tests__/entitlementFlag.test.ts`

**Interfaces:**
- Produces: `function isProactiveEntitlementUiEnabled(): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/services/entitlements/__tests__/entitlementFlag.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

describe('isProactiveEntitlementUiEnabled', () => {
  it('apagado por defecto', async () => {
    vi.stubEnv('VITE_ENTITLEMENTS', '')
    const { isProactiveEntitlementUiEnabled } = await import('../entitlementFlag')
    expect(isProactiveEntitlementUiEnabled()).toBe(false)
  })

  it('solo la cadena exacta "true" enciende', async () => {
    vi.stubEnv('VITE_ENTITLEMENTS', 'true')
    const mod = await import('../entitlementFlag')
    expect(mod.isProactiveEntitlementUiEnabled()).toBe(true)
  })

  it('un valor mal tipeado no enciende a medias', async () => {
    vi.stubEnv('VITE_ENTITLEMENTS', 'TRUE')
    const mod = await import('../entitlementFlag')
    expect(mod.isProactiveEntitlementUiEnabled()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/entitlements/__tests__/entitlementFlag.test.ts`
Expected: FAIL — no existe `../entitlementFlag`

- [ ] **Step 3: Write the flag**

Create `src/services/entitlements/entitlementFlag.ts`:

```ts
/**
 * Gatea SÓLO el ocultamiento proactivo de affordances. El manejo reactivo del
 * 403 va siempre encendido: así el estado intermedio del rollout —servidor
 * activo, cliente apagado— es seguro y además muestra la oferta bien.
 */
export function isProactiveEntitlementUiEnabled(): boolean {
  return import.meta.env.VITE_ENTITLEMENTS === 'true'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/entitlements/__tests__/entitlementFlag.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/services/entitlements/entitlementFlag.ts src/services/entitlements/__tests__/entitlementFlag.test.ts
git commit -m "feat(entitlements): flag de UI proactiva"
```

---

### Task 16: Documentación de rollout y verificación final

**Files:**
- Modify: `README.md` — variables de entorno y orden de rollout
- Modify: `CLAUDE.md` — **sólo** el estado actual de Dexie y las reglas del proyecto
- Modify: `PROJECT_REVIEW_AND_ROADMAP.md` — §Pre-Lanzamiento punto 2

- [ ] **Step 1: Document the rollout in README**

Add to the environment-variables section:

```markdown
### Entitlements por plan

| Variable | Ámbito | Default | Qué hace |
|---|---|---|---|
| `ENTITLEMENTS_ENABLED` | Servidor (runtime) | apagado | Enciende el gate en `coach.ts`, `enqueue-plan-generation` y `generate-plan-background`. Sólo la cadena exacta `true`. |
| `VITE_ENTITLEMENTS` | Cliente (build-time) | apagado | Enciende sólo el ocultamiento proactivo de affordances. El manejo del 403 va siempre encendido. |

**Orden de rollout, no negociable:**

1. Aplicar `supabase/020_user_entitlements.sql` a mano en producción.
2. **Asignarse `advanced`**, o al encender el gate se pierde Plan Builder en la
   propia cuenta (ausencia de fila = `free`, y eso vale para el owner).
3. Desplegar con las dos flags apagadas: comportamiento idéntico al previo.
4. Encender `ENTITLEMENTS_ENABLED` (runtime, sin redeploy).
5. Redesplegar con `VITE_ENTITLEMENTS=true`.

**Nunca el cliente antes que el servidor:** con el cliente gateando y el
servidor permisivo, la UI oculta el botón pero una llamada directa pasa.

SQL de asignación manual (service role):

```sql
insert into public.user_entitlements (user_id, tier, source, note)
values ('<uuid>', 'advanced', 'manual', 'transferencia <fecha>, <nombre>')
on conflict (user_id) do update
  set tier = excluded.tier, source = excluded.source, note = excluded.note;
```
```

- [ ] **Step 2: Update CLAUDE.md — sólo el estado actual**

**No** hacer un reemplazo global de «v19» → «v20»: las menciones históricas de
bloques anteriores (superseries, consentimiento, Whoop) describen el estado
*de ese momento* y reescribirlas falsearía el registro. Cambiar únicamente:

- «Dexie local en **v19**» (línea de estado actual) → **v20**.
- «El modelo local es Dexie (**v19**)» en Reglas del proyecto → **v20**.

Y agregar a Reglas del proyecto:

```markdown
- **Entitlements: `entitlementPolicy.ts` es la única autoridad de acceso por plan.** Tres tiers `free < weekly < advanced`; ausencia de fila, vencimiento, vencimiento ilegible o fallo de lectura resuelven a `free`; clase desconocida se deniega para todos. El gate va en las **tres** funciones (`coach.ts`, `enqueue-plan-generation`, `generate-plan-background`) porque la última acepta llamadas directas y acuña su propio `jobId`. **El chequeo de entitlement va siempre antes que el de cuota** y una clase no permitida **nunca** se representa como cuota `0`, o se reporta como límite diario en vez de oferta. El filtro de `create_week` en `chat_action` (`responseNormalizer.ts`) es una **barrera de negocio**, no una regla de calidad.
```

- [ ] **Step 3: Update the roadmap**

In §Pre-Lanzamiento punto 2, change the status to implemented-pending-rollout.
**No marcar el blocker como cerrado**: el código existiendo no es el gate
estando vivo. Se cierra recién tras el paso 5 del rollout.

- [ ] **Step 4: Full verification**

Run: `npm test && npm run lint && npm run build && npx tsc -b && git diff --check`
Expected: los cinco en verde. Anotar el conteo de archivos/tests para el roadmap.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md PROJECT_REVIEW_AND_ROADMAP.md
git commit -m "docs(entitlements): rollout, reglas del proyecto y estado del roadmap"
```

---

## Cobertura del spec

| Sección del spec | Task |
|---|---|
| §3.1 migración, trigger, grants por columna | 3 |
| §3.2 orden de tiers | 1 |
| §3.3 mapa exhaustivo, clase desconocida denegada | 1 |
| §3.4 invariante `create_week` como barrera de negocio | 13 |
| §4.1 módulo puro | 1 |
| §4.2 helper de servidor, columnas explícitas, fail-closed, vencimiento ilegible | 4 |
| §4.3 tres puntos de enganche, lecturas en paralelo con auth | 5, 6, 7 |
| §4.3.1 terminalización del job rechazado | 7 |
| §4.4 orden entitlement-antes-que-cuota | 10 (`bucketLimitForTier` → `null`, y la cuota no opina) |
| §4.5 error tipado compartido | 2 |
| §4.6 los dos puntos de aplanamiento del 403 | 5 (servidor), 11 (cliente coach), 12 (cliente Plan Builder) |
| §5.1 espejo Dexie v20 con `expiresAt` | 8 |
| §5.1.1 reconciliación de tres casos | 8 |
| §5.1.2 estado neutro | 9, 14 |
| §5.2 cliente gatea affordance | 9, 14 |
| §5.3 buckets por tier | 10 |
| §5.4 cuota account-scoped | 10 |
| §6 upsell como oferta | 14 |
| §6.1 dos caminos hacia la tarjeta | 13 (diagnóstico), 14 (403) |
| §6.2 el 403 no llega crudo al chat | 14 |
| §7 rollout y flags | 15, 16 |
| §8 verificación | distribuida; cierre en 16 |

## Orden de ejecución y riesgo

**Tasks 1–4** no tocan nada existente: módulos nuevos y un `.sql` que no se
aplica. Seguras de correr de corrido.

**Tasks 5–7** modifican las tres funciones Netlify. La 7 es la más delicada del
plan por la terminalización.

**Tasks 8–9** introducen Dexie v20 y el store global.

**Task 10** es la de mayor superficie: toca los productores de telemetría y
`planBuilder/rateLimit.ts`, y va a romper tests existentes que asumían
`DEFAULT_DAILY_AI_LIMITS`. Presupuestar tiempo de ajuste.

**Task 11** exige comparar rama por rama el clasificador extraído contra el
método original: una diferencia ahí es una regresión en todo el manejo de
errores del chat, no sólo en entitlements.

**Tasks 12–16** son cliente y documentación.

Al terminar las 16, producción sigue comportándose igual que hoy: la migración
no está aplicada y las dos flags están apagadas.

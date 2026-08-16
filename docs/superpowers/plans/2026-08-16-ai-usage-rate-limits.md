# Límites durables de uso y gasto de IA — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar una autoridad durable server-side de cuota diaria por bucket
(Supabase, incremento atómico), circuit breaker de gasto (US$3/cuenta,
US$5/global) y kill switch, gateando en `coach.ts`, `enqueue-plan-generation.ts`
y `generate-plan-background.ts`. Esto **no reemplaza** `enforceRateLimit`
(el `Map` en memoria de `coach.ts`, 20 req/60s) — ese sigue protegiendo contra
ráfagas dentro de una ventana corta, un problema distinto del techo diario
que este bloque agrega. Lo que sí queda obsoleto es el límite local de Dexie
(`assertDailyAIRequestLimit`/`aiTelemetry.ts`): pasa a ser preflight de UX no
confiable, con la autoridad real ahora en `ai_usage_daily`.

**Architecture:** Una tabla nueva (`ai_usage_daily`) con dos funciones SQL
`security definer` solo ejecutables por `service_role`: una hace
check-and-increment atómico (cierra la carrera de concurrencia), la otra lee
gasto acumulado del día. Un módulo servidor puro (`netlify/functions/_shared/usageGate.ts`)
envuelve esas RPC y expone el gate compuesto. El punto de consumo real es
inmediatamente antes de cada llamada al proveedor — no al encolar, no al
autenticar — así que solo cuenta lo que efectivamente llegó al modelo.

**Tech Stack:** TypeScript, Netlify Functions, Supabase (Postgres + PostgREST
RPC vía `fetch`, sin `@supabase/supabase-js` en el gate — mismo patrón que
`resolveEntitlement.ts`), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-16-ai-usage-rate-limits-design.md`

## Global Constraints

- Orden de gate no negociable: `auth → kill switch → entitlement → spend cap (lectura) → cuota (incremento atómico) → proveedor → costo (post-respuesta)`. El kill switch va después de auth (no antes) en las 3 funciones — `auth.userId` no es estrictamente necesario para el chequeo en sí, pero el orden se mantiene consistente en todo el flujo.
- `enforceRateLimit` (rate limit de ráfaga en memoria, `coach.ts`, 20 req/60s) **se conserva sin cambios** — protege contra un problema distinto (ráfagas cortas) del que resuelve este bloque (techo diario durable). No se toca ni se elimina en ninguna task.
- El incremento de cuota ocurre **inmediatamente antes de cada llamada real al proveedor**, incluyendo cada retry y cada fallback — nunca al encolar, nunca al autenticar.
- **No hay reembolso.** Un intento que alcanzó al proveedor consumió cuota real, sin importar el resultado.
- Flags: `AI_USAGE_LIMITS_ENABLED` y `AI_KILL_SWITCH_ENABLED`, ambas solo se activan con el string literal `'true'` (mismo patrón que `ENTITLEMENTS_ENABLED`).
- Techo por cuenta: **US$3/día**. Techo global: **US$5/día**. Constantes literales, no env vars.
- Con `AI_USAGE_LIMITS_ENABLED=false`, el sistema no debe hacer ninguna lectura ni escritura contra `ai_usage_daily` — comportamiento idéntico al actual.
- Los 3 errores nuevos (`quota_exceeded`, `spend_cap_exceeded`, `kill_switch_active`) son **no reintentables** y **nunca** abren `UpsellCard` — no se resuelven pagando más.
- `quota_exhausted` es un `outcome` de job **distinto** de `budget_exhausted` (wallclock).
- Ningún test de este plan levanta Postgres real — todo mock de HTTP/fetch, siguiendo el patrón de `coachEntitlementGate.test.ts` / `enqueuePlanEntitlement.test.ts` / `backgroundPlanEntitlement.test.ts`.
- Antes de cerrar el plan: `npm run lint && npm test && npm run build && npx tsc -b && git diff --check` todo verde.

---

### Task 1: Migración SQL — tabla, RPC atómico, RPC de lectura, taxonomía de outcome

**Files:**
- Create: `supabase/021_ai_usage_daily.sql`

**Interfaces:**
- Produces: tabla `public.ai_usage_daily(user_id, usage_date, bucket_id, request_count, estimated_cost_usd, updated_at)`; función `public.increment_ai_usage_if_under_limit(p_user_id uuid, p_bucket_id text, p_limit integer) returns table(usage_date date, request_count integer)`; función `public.read_ai_usage_spend(p_user_id uuid) returns table(account_cost_usd numeric, global_cost_usd numeric)`; función `public.increment_ai_usage_cost(p_user_id uuid, p_bucket_id text, p_usage_date date, p_delta numeric) returns table(estimated_cost_usd numeric)`; `plan_generation_jobs.outcome` admite `'quota_exhausted'`.

**Corrección tras revisión (P0):** la primera versión de este plan proponía
registrar el costo con un `PATCH estimated_cost_usd = $1` (sobreescritura).
Es incorrecto: todas las requests del mismo `(user_id, usage_date, bucket_id)`
comparten una fila, así que la segunda request pisa el costo de la primera en
vez de sumarlo. El costo necesita su propia RPC atómica, igual que el
contador — `estimated_cost_usd = estimated_cost_usd + p_delta`, no un `set`.

- [ ] **Step 1: Verificar el nombre real del constraint de outcome antes de escribir el `alter`**

`016_plan_generation_jobs.sql` declara `outcome text not null check (outcome in (...))` sin nombre explícito — Postgres autogenera `plan_generation_jobs_outcome_check`. Antes de aplicar en producción, confirmar con:

```sql
select conname from pg_constraint
where conrelid = 'public.plan_generation_jobs'::regclass and contype = 'c';
```

Si el nombre real difiere de `plan_generation_jobs_outcome_check`, ajustar el `alter table ... drop constraint` del Step 2 al nombre real antes de aplicar (esto se hace en producción, no en CI — dejar la nota en el propio SQL).

- [ ] **Step 2: Escribir la migración completa**

```sql
-- 021_ai_usage_daily.sql
-- Cuota diaria durable + circuit breaker de gasto (Pre-Lanzamiento puntos 3 y 4).
-- Ver docs/superpowers/specs/2026-08-16-ai-usage-rate-limits-design.md
-- Aplicación manual, como todas las anteriores.

create table public.ai_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  bucket_id text not null,
  request_count integer not null default 0 check (request_count >= 0),
  estimated_cost_usd numeric(12, 6) not null default 0 check (estimated_cost_usd >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date, bucket_id)
);

alter table public.ai_usage_daily enable row level security;

create policy ai_usage_daily_select_own
  on public.ai_usage_daily
  for select
  using (auth.uid() = user_id);

-- Sin INSERT/UPDATE/DELETE para clientes. service_role es el único escritor.
revoke all on public.ai_usage_daily from anon, authenticated;
grant select (user_id, usage_date, bucket_id, request_count, estimated_cost_usd, updated_at)
  on public.ai_usage_daily to authenticated;

-- Check-and-increment atómico. Una fila si el incremento quedó bajo p_limit,
-- cero filas si lo hubiera excedido — no hay ventana de "leer y después
-- escribir". Solo invocable con service_role.
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
begin
  if p_limit < 1 or p_user_id is null or p_bucket_id is null or length(p_bucket_id) = 0 then
    return;
  end if;

  return query
  insert into public.ai_usage_daily (user_id, usage_date, bucket_id, request_count)
  values (p_user_id, current_date, p_bucket_id, 1)
  on conflict (user_id, usage_date, bucket_id)
  do update
     set request_count = ai_usage_daily.request_count + 1,
         updated_at = now()
   where ai_usage_daily.request_count + 1 <= p_limit
  returning ai_usage_daily.usage_date, ai_usage_daily.request_count;
end;
$$;

revoke all on function public.increment_ai_usage_if_under_limit(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.increment_ai_usage_if_under_limit(uuid, text, integer)
  to service_role;

-- Gasto acumulado hoy: por cuenta y global. Solo lectura, no gatea nada por
-- sí sola. Solo invocable con service_role.
create or replace function public.read_ai_usage_spend(p_user_id uuid)
returns table (account_cost_usd numeric, global_cost_usd numeric)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(sum(estimated_cost_usd) filter (where user_id = p_user_id), 0) as account_cost_usd,
    coalesce(sum(estimated_cost_usd), 0) as global_cost_usd
  from public.ai_usage_daily
  where usage_date = current_date;
$$;

revoke all on function public.read_ai_usage_spend(uuid) from public, anon, authenticated;
grant execute on function public.read_ai_usage_spend(uuid) to service_role;

-- Acumula costo real sobre la fila que un incremento previo ya reservó. Es
-- un UPDATE, no un upsert: la fila tiene que existir (la creó
-- increment_ai_usage_if_under_limit). Atómico por la misma razón que el
-- contador — SET x = x + delta en una sola sentencia, sin leer antes.
create or replace function public.increment_ai_usage_cost(
  p_user_id uuid,
  p_bucket_id text,
  p_usage_date date,
  p_delta numeric
)
returns table (estimated_cost_usd numeric)
language plpgsql
security definer
set search_path = public
as $$
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
  returning ai_usage_daily.estimated_cost_usd;
end;
$$;

revoke all on function public.increment_ai_usage_cost(uuid, text, date, numeric)
  from public, anon, authenticated;
grant execute on function public.increment_ai_usage_cost(uuid, text, date, numeric)
  to service_role;

-- quota_exhausted es distinto de budget_exhausted (wallclock) Y de failed:
-- solo cubre agotar la CUOTA DIARIA de plan_builder_week. Un rechazo por
-- techo de gasto o kill switch durante el loop termina como 'failed' (ver
-- asyncGenerationLoop.ts) — no comparte este outcome.
alter table public.plan_generation_jobs drop constraint plan_generation_jobs_outcome_check;
alter table public.plan_generation_jobs add constraint plan_generation_jobs_outcome_check
  check (outcome in ('succeeded', 'partial', 'failed', 'cancelled', 'budget_exhausted', 'quota_exhausted'));
```

- [ ] **Step 3: No aplicar todavía**

Esta migración sigue la convención del proyecto: se escribe ahora, se aplica a mano en Supabase recién en el rollout (Task 13), después de que todo el código dependiente esté commiteado y revisado. No ejecutar contra producción en este task.

- [ ] **Step 4: Commit**

```bash
git add supabase/021_ai_usage_daily.sql
git commit -m "feat(usage-limits): migracion 021 - tabla, RPC atomico y taxonomia de outcome"
```

---

### Task 2: Política pura de spend cap

**Files:**
- Create: `src/services/entitlements/spendCapPolicy.ts`
- Test: `src/services/entitlements/__tests__/spendCapPolicy.test.ts`

**Interfaces:**
- Consumes: nada (módulo puro, sin I/O).
- Produces: `ACCOUNT_DAILY_SPEND_CAP_USD`, `GLOBAL_DAILY_SPEND_CAP_USD`, `SpendCapScope = 'account' | 'global'`, `SpendCapCheckResult = { exceeded: false } | { exceeded: true; scope: SpendCapScope; capUsd: number }`, `evaluateSpendCaps(spend: { accountCostUsd: number; globalCostUsd: number }): SpendCapCheckResult`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/services/entitlements/__tests__/spendCapPolicy.test.ts
import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_DAILY_SPEND_CAP_USD,
  GLOBAL_DAILY_SPEND_CAP_USD,
  evaluateSpendCaps,
} from '../spendCapPolicy'

describe('spendCapPolicy', () => {
  it('los montos son los aprobados en el spec', () => {
    expect(ACCOUNT_DAILY_SPEND_CAP_USD).toBe(3)
    expect(GLOBAL_DAILY_SPEND_CAP_USD).toBe(5)
  })

  it('debajo de ambos caps, permite', () => {
    expect(evaluateSpendCaps({ accountCostUsd: 1, globalCostUsd: 2 }))
      .toEqual({ exceeded: false })
  })

  it('cuenta en el cap exacto, rechaza por cuenta', () => {
    expect(evaluateSpendCaps({ accountCostUsd: 3, globalCostUsd: 2 }))
      .toEqual({ exceeded: true, scope: 'account', capUsd: 3 })
  })

  it('cuenta por encima del cap, rechaza por cuenta', () => {
    expect(evaluateSpendCaps({ accountCostUsd: 3.5, globalCostUsd: 1 }))
      .toEqual({ exceeded: true, scope: 'account', capUsd: 3 })
  })

  it('global en el cap exacto con cuenta bajo su cap, rechaza por global', () => {
    expect(evaluateSpendCaps({ accountCostUsd: 0.5, globalCostUsd: 5 }))
      .toEqual({ exceeded: true, scope: 'global', capUsd: 5 })
  })

  it('cuenta y global exceden a la vez, prioriza el rechazo por cuenta', () => {
    // Rechazo por cuenta es más específico y accionable para el usuario.
    expect(evaluateSpendCaps({ accountCostUsd: 4, globalCostUsd: 6 }))
      .toEqual({ exceeded: true, scope: 'account', capUsd: 3 })
  })
})
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `npx vitest run src/services/entitlements/__tests__/spendCapPolicy.test.ts`
Expected: FAIL — `Cannot find module '../spendCapPolicy'`.

- [ ] **Step 3: Implementar**

```ts
// src/services/entitlements/spendCapPolicy.ts
/**
 * Política pura del circuit breaker de gasto. Sin I/O, sin Dexie, sin React —
 * la importan tanto el gate server-side (netlify/functions/_shared/usageGate.ts)
 * como cualquier superficie de cliente que quiera mostrar el mismo número.
 *
 * Los montos son constantes versionadas, no env vars: Netlify captura config
 * por deploy, así que un env var no da ajuste real "en caliente" sin de todas
 * formas desplegar. Un cambio de monto queda auditable en el commit.
 */

export const ACCOUNT_DAILY_SPEND_CAP_USD = 3
export const GLOBAL_DAILY_SPEND_CAP_USD = 5

export type SpendCapScope = 'account' | 'global'

export type SpendCapCheckResult =
  | { exceeded: false }
  | { exceeded: true; scope: SpendCapScope; capUsd: number }

export interface SpendSnapshot {
  accountCostUsd: number
  globalCostUsd: number
}

/**
 * El cap por cuenta se evalúa antes que el global: es más específico y más
 * accionable para quien lo dispara. Ambos usan `>=`, no `>`: el cap es un
 * techo, no un piso — llegar exactamente a él ya cuenta como alcanzado.
 */
export function evaluateSpendCaps(spend: SpendSnapshot): SpendCapCheckResult {
  if (spend.accountCostUsd >= ACCOUNT_DAILY_SPEND_CAP_USD) {
    return { exceeded: true, scope: 'account', capUsd: ACCOUNT_DAILY_SPEND_CAP_USD }
  }
  if (spend.globalCostUsd >= GLOBAL_DAILY_SPEND_CAP_USD) {
    return { exceeded: true, scope: 'global', capUsd: GLOBAL_DAILY_SPEND_CAP_USD }
  }
  return { exceeded: false }
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `npx vitest run src/services/entitlements/__tests__/spendCapPolicy.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/entitlements/spendCapPolicy.ts src/services/entitlements/__tests__/spendCapPolicy.test.ts
git commit -m "feat(usage-limits): politica pura de spend cap"
```

---

### Task 3: Errores tipados de cliente (`usageGateError.ts`)

**Files:**
- Create: `src/services/entitlements/usageGateError.ts`
- Test: `src/services/entitlements/__tests__/usageGateError.test.ts`

**Interfaces:**
- Consumes: `AIProviderError` de `src/services/ai/types.ts`.
- Produces: `UsageGateErrorCode`, `QuotaExceededDetail`, `SpendCapExceededDetail`, `QuotaExceededError`, `SpendCapExceededError`, `KillSwitchActiveError`, `UsageGateUnavailableError`, `isQuotaExceededDetail`, `isSpendCapExceededDetail`.

**Agregado tras revisión (P1, ronda 2):** `UsageGateUnavailableError` cubre
el caso "el propio gate no pudo resolverse" (RPC caída, red, JSON
malformado — todo lo que `usageGate.ts` normaliza a `server_error`). Sin esta
clase, un fallo de infraestructura del gate no era reconocido por
`isUsageGateRejection` del loop (Task 7) y se trataba como si el PROVEEDOR
hubiera fallado — disparando retry/fallback para un error que nunca llegó al
proveedor. Reusa el código `'server_error'`, que ya existe en `AIErrorCode`
(no hace falta agregar uno nuevo).

Mismo molde que `src/services/entitlements/entitlementError.ts` (interfaz de
detalle + type guard + clase que extiende `AIProviderError` + mensaje de
respaldo). `QuotaExceededError`/`SpendCapExceededError`/`KillSwitchActiveError`
las usa `classifyProxyHttpError` (Task 9) para construir el error tipado del
lado del cliente a partir de la respuesta HTTP.

**Corrección tras revisión (P3, ronda 4):** `UsageGateUnavailableError` es la
excepción — `classifyProxyHttpError` (Task 9) **no** la construye; esa clase
solo se produce del lado del worker, dentro de `translateUsageGateError`
(Task 8, netlify/functions/_shared/translateUsageGateError.ts), para el
único punto donde un error server-shaped cruza hacia `asyncGenerationLoop.ts`.
Un `server_error` HTTP normal (chat/enqueue vía `classifyProxyHttpError`) cae
en la rama genérica existente (`createProviderError('gemini', 'server_error', ...)`)
— no hay necesidad de que el cliente del navegador distinga
`UsageGateUnavailableError` de un `AIProviderError` genérico con
`code: 'server_error'`, porque no hay ninguna UI que dependa de esa
distinción hoy.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/services/entitlements/__tests__/usageGateError.test.ts
import { describe, expect, it } from 'vitest'
import {
  KillSwitchActiveError,
  QuotaExceededError,
  SpendCapExceededError,
  UsageGateUnavailableError,
  isQuotaExceededDetail,
  isSpendCapExceededDetail,
} from '../usageGateError'

describe('usageGateError', () => {
  it('QuotaExceededError lleva code, detail y no es reintentable', () => {
    const error = new QuotaExceededError({ bucketId: 'chat', limit: 15, remaining: 0 })
    expect(error.code).toBe('quota_exceeded')
    expect(error.retryable).toBe(false)
    expect(error.detail).toEqual({ bucketId: 'chat', limit: 15, remaining: 0 })
    expect(error.message.length).toBeGreaterThan(0)
  })

  it('SpendCapExceededError lleva scope y capUsd', () => {
    const error = new SpendCapExceededError({ scope: 'global', capUsd: 5 })
    expect(error.code).toBe('spend_cap_exceeded')
    expect(error.retryable).toBe(false)
    expect(error.detail).toEqual({ scope: 'global', capUsd: 5 })
  })

  it('KillSwitchActiveError no requiere detail', () => {
    const error = new KillSwitchActiveError()
    expect(error.code).toBe('kill_switch_active')
    expect(error.retryable).toBe(false)
  })

  it('isQuotaExceededDetail valida forma completa', () => {
    expect(isQuotaExceededDetail({ bucketId: 'chat', limit: 15, remaining: 0 })).toBe(true)
    expect(isQuotaExceededDetail({ bucketId: 'chat', limit: 15 })).toBe(false)
    expect(isQuotaExceededDetail(null)).toBe(false)
    expect(isQuotaExceededDetail('chat')).toBe(false)
  })

  it('isSpendCapExceededDetail valida scope y capUsd', () => {
    expect(isSpendCapExceededDetail({ scope: 'account', capUsd: 3 })).toBe(true)
    expect(isSpendCapExceededDetail({ scope: 'other', capUsd: 3 })).toBe(false)
    expect(isSpendCapExceededDetail({ scope: 'account' })).toBe(false)
  })

  it('UsageGateUnavailableError usa server_error, no un código de rechazo de política', () => {
    const error = new UsageGateUnavailableError('RPC de cuota devolvió 500.')
    expect(error.code).toBe('server_error')
    expect(error.retryable).toBe(false)
    expect(error.message).toBe('RPC de cuota devolvió 500.')
  })
})
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `npx vitest run src/services/entitlements/__tests__/usageGateError.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```ts
// src/services/entitlements/usageGateError.ts
import { AIProviderError } from '../ai/types'

export type UsageGateErrorCode = 'quota_exceeded' | 'spend_cap_exceeded' | 'kill_switch_active'

export interface QuotaExceededDetail {
  bucketId: string
  limit: number
  remaining: number
}

export interface SpendCapExceededDetail {
  scope: 'account' | 'global'
  capUsd: number
}

export function isQuotaExceededDetail(value: unknown): value is QuotaExceededDetail {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<QuotaExceededDetail>
  return typeof candidate.bucketId === 'string' && candidate.bucketId.length > 0
    && typeof candidate.limit === 'number'
    && typeof candidate.remaining === 'number'
}

export function isSpendCapExceededDetail(value: unknown): value is SpendCapExceededDetail {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SpendCapExceededDetail>
  return (candidate.scope === 'account' || candidate.scope === 'global')
    && typeof candidate.capUsd === 'number'
}

export class QuotaExceededError extends AIProviderError {
  readonly detail: QuotaExceededDetail

  constructor(detail: QuotaExceededDetail) {
    super('gemini', 'quota_exceeded', 'Alcanzaste el cupo diario de esta función.', false)
    this.name = 'QuotaExceededError'
    this.detail = detail
  }
}

export class SpendCapExceededError extends AIProviderError {
  readonly detail: SpendCapExceededDetail

  constructor(detail: SpendCapExceededDetail) {
    super('gemini', 'spend_cap_exceeded', 'El servicio alcanzó su presupuesto diario.', false)
    this.name = 'SpendCapExceededError'
    this.detail = detail
  }
}

export class KillSwitchActiveError extends AIProviderError {
  constructor() {
    super('gemini', 'kill_switch_active', 'La IA está temporalmente pausada.', false)
    this.name = 'KillSwitchActiveError'
  }
}

/**
 * El gate mismo no pudo resolverse (RPC caída, red, JSON malformado — ver
 * `usageGate.ts`). Deliberadamente distinta de las 3 anteriores: no es un
 * rechazo de política (cuota/gasto/kill switch), es una falla de
 * infraestructura. Aun así debe tratarse como terminal (no reintentable) y
 * NO como fallo del proveedor — reusa `server_error`, código ya existente.
 */
export class UsageGateUnavailableError extends AIProviderError {
  constructor(message: string) {
    super('gemini', 'server_error', message, false)
    this.name = 'UsageGateUnavailableError'
  }
}
```

- [ ] **Step 4: Extender `AIErrorCode`**

En `src/services/ai/types.ts:165-174`, agregar los 3 códigos a la unión:

```ts
export type AIErrorCode =
  | 'unauthorized'
  | 'rate_limit'
  | 'timeout'
  | 'truncated'
  | 'parse_error'
  | 'misconfigured'
  | 'server_error'
  | 'entitlement_required'
  | 'quota_exceeded'
  | 'spend_cap_exceeded'
  | 'kill_switch_active'
  | 'unknown'
```

- [ ] **Step 5: Correr el test y confirmar que pasa**

Run: `npx vitest run src/services/entitlements/__tests__/usageGateError.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/entitlements/usageGateError.ts src/services/entitlements/__tests__/usageGateError.test.ts src/services/ai/types.ts
git commit -m "feat(usage-limits): errores tipados de cliente para cuota/gasto/kill switch"
```

---

### Task 4: Gate server-side (`netlify/functions/_shared/usageGate.ts`)

**Files:**
- Create: `netlify/functions/_shared/usageGate.ts`
- Test: `netlify/functions/__tests__/usageGate.test.ts`

**Interfaces:**
- Consumes: `bucketForClass`, `bucketLimitForTier` de `src/services/entitlements/quotaBuckets.ts`; `ACCOUNT_DAILY_SPEND_CAP_USD`, `GLOBAL_DAILY_SPEND_CAP_USD`, `evaluateSpendCaps` de `spendCapPolicy.ts`; `Tier` de `entitlementPolicy.ts`; `AIRequestClass` de `src/types`.
- Produces: `isKillSwitchActive()`, `isUsageLimitsEnabled()`, `UsageGateHttpError` (interfaz), `assertUsageGate(input)`, `checkUsagePreflight(input)`, `recordUsageCost(input)`, y los factories exportados `makeKillSwitchError()`, `makeQuotaExceededError(bucketId, limit, remaining?)`, `makeSpendCapError(scope, capUsd)`, `makeServerError(message)` — reusados por Tasks 5/6/8 en vez de un `makeError` local por archivo.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// netlify/functions/__tests__/usageGate.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertUsageGate,
  checkUsagePreflight,
  isKillSwitchActive,
  isUsageLimitsEnabled,
  recordUsageCost,
} from '../_shared/usageGate'

const ENV = {
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('flags', () => {
  it('isKillSwitchActive solo se activa con el literal true', () => {
    expect(isKillSwitchActive({ AI_KILL_SWITCH_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(true)
    expect(isKillSwitchActive({ AI_KILL_SWITCH_ENABLED: 'TRUE' } as NodeJS.ProcessEnv)).toBe(false)
    expect(isKillSwitchActive({} as NodeJS.ProcessEnv)).toBe(false)
  })

  it('isUsageLimitsEnabled solo se activa con el literal true', () => {
    expect(isUsageLimitsEnabled({ AI_USAGE_LIMITS_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(true)
    expect(isUsageLimitsEnabled({} as NodeJS.ProcessEnv)).toBe(false)
  })
})

describe('assertUsageGate', () => {
  const originalFetch = global.fetch
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env['SUPABASE_URL'] = ENV.SUPABASE_URL
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = ENV.SUPABASE_SERVICE_ROLE_KEY
    process.env['AI_USAGE_LIMITS_ENABLED'] = 'true'
    process.env['AI_KILL_SWITCH_ENABLED'] = 'false'
  })

  afterEach(() => {
    global.fetch = originalFetch
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it('kill switch activo rechaza antes de cualquier fetch', async () => {
    process.env['AI_KILL_SWITCH_ENABLED'] = 'true'
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(assertUsageGate({ userId: 'u1', requestClass: 'chat_general', tier: 'free' }))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'kill_switch_active' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('con limits apagado, no hace fetch y no rechaza', async () => {
    process.env['AI_USAGE_LIMITS_ENABLED'] = 'false'
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await assertUsageGate({ userId: 'u1', requestClass: 'chat_general', tier: 'free' })
    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('spend cap por cuenta ya alcanzado rechaza antes del incremento de cuota', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) {
        return jsonResponse([{ account_cost_usd: 3.2, global_cost_usd: 1 }])
      }
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(assertUsageGate({ userId: 'u1', requestClass: 'chat_general', tier: 'weekly' }))
      .rejects.toMatchObject({
        statusCode: 429,
        errorCode: 'spend_cap_exceeded',
        detail: { scope: 'account', capUsd: 3 },
      })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('incremento atómico sin filas devueltas rechaza con quota_exceeded', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) {
        return jsonResponse([{ account_cost_usd: 0, global_cost_usd: 0 }])
      }
      if (url.includes('/rpc/increment_ai_usage_if_under_limit')) {
        return jsonResponse([])
      }
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(assertUsageGate({ userId: 'u1', requestClass: 'chat_general', tier: 'weekly' }))
      .rejects.toMatchObject({
        statusCode: 429,
        errorCode: 'quota_exceeded',
        detail: { bucketId: 'chat', limit: 120, remaining: 0 },
      })
  })

  it('incremento atómico con fila devuelta permite y expone usageDate/bucketId', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) {
        return jsonResponse([{ account_cost_usd: 0, global_cost_usd: 0 }])
      }
      if (url.includes('/rpc/increment_ai_usage_if_under_limit')) {
        return jsonResponse([{ usage_date: '2026-08-16', request_count: 1 }])
      }
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await assertUsageGate({ userId: 'u1', requestClass: 'chat_general', tier: 'weekly' })
    expect(result).toEqual({ bucketId: 'chat', limit: 120, usageDate: '2026-08-16' })
  })

  it('clase sin bucket o sin límite para el tier no gatea (lo resuelve entitlement)', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await assertUsageGate({ userId: 'u1', requestClass: 'plan_builder_week', tier: 'free' })
    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('spend con forma inesperada falla cerrado (503), no asume gasto cero', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) return jsonResponse([])   // cero filas: forma inválida para esta RPC
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(assertUsageGate({ userId: 'u1', requestClass: 'chat_general', tier: 'weekly' }))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
  })

  it('spend con campos no numéricos falla cerrado, no los trata como cero', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) return jsonResponse([{ account_cost_usd: null, global_cost_usd: 0 }])
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(assertUsageGate({ userId: 'u1', requestClass: 'chat_general', tier: 'weekly' }))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
  })

  it('un error de red (fetch rechaza) se convierte en server_error, no escapa crudo', async () => {
    global.fetch = vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch

    await expect(assertUsageGate({ userId: 'u1', requestClass: 'chat_general', tier: 'weekly' }))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
  })

  it('un cuerpo no-JSON en una respuesta 200 se convierte en server_error, no escapa como SyntaxError', async () => {
    global.fetch = vi.fn(async () => new Response('esto no es json', { status: 200 })) as unknown as typeof fetch

    await expect(assertUsageGate({ userId: 'u1', requestClass: 'chat_general', tier: 'weekly' }))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
  })

  it('el incremento con más de una fila devuelta falla cerrado (cardinalidad estricta)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) return jsonResponse([{ account_cost_usd: 0, global_cost_usd: 0 }])
      if (url.includes('/rpc/increment_ai_usage_if_under_limit')) {
        return jsonResponse([{ usage_date: '2026-08-16', request_count: 1 }, { usage_date: '2026-08-16', request_count: 1 }])
      }
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(assertUsageGate({ userId: 'u1', requestClass: 'chat_general', tier: 'weekly' }))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
  })
})

describe('checkUsagePreflight', () => {
  beforeEach(() => {
    process.env['SUPABASE_URL'] = ENV.SUPABASE_URL
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = ENV.SUPABASE_SERVICE_ROLE_KEY
    process.env['AI_USAGE_LIMITS_ENABLED'] = 'true'
    process.env['AI_KILL_SWITCH_ENABLED'] = 'false'
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('cuota ya en el límite rechaza sin incrementar nada', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) {
        return jsonResponse([{ account_cost_usd: 0, global_cost_usd: 0 }])
      }
      if (url.includes('/ai_usage_daily?')) {
        return jsonResponse([{ request_count: 12 }])
      }
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(checkUsagePreflight({ userId: 'u1', requestClass: 'plan_builder_week', tier: 'advanced' }))
      .rejects.toMatchObject({ statusCode: 429, errorCode: 'quota_exceeded' })
    const calledIncrement = fetchMock.mock.calls.some(([url]) => String(url).includes('increment_ai_usage_if_under_limit'))
    expect(calledIncrement).toBe(false)
  })

  it('lectura del contador con cuerpo no-JSON falla cerrado', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/rpc/read_ai_usage_spend')) return jsonResponse([{ account_cost_usd: 0, global_cost_usd: 0 }])
      if (url.includes('/ai_usage_daily?')) return new Response('no es json', { status: 200 })
      throw new Error(`fetch inesperado: ${url}`)
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(checkUsagePreflight({ userId: 'u1', requestClass: 'plan_builder_week', tier: 'advanced' }))
      .rejects.toMatchObject({ statusCode: 503, errorCode: 'server_error' })
  })
})

describe('recordUsageCost', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env['SUPABASE_URL'] = ENV.SUPABASE_URL
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = ENV.SUPABASE_SERVICE_ROLE_KEY
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it('llama a la RPC atómica de acumulación, no a un PATCH que sobreescribe', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([{ estimated_cost_usd: 0.05 }]))
    global.fetch = fetchMock as unknown as typeof fetch

    await recordUsageCost({ userId: 'u1', bucketId: 'chat', usageDate: '2026-08-16', costUsd: 0.02 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/rpc/increment_ai_usage_cost')
    expect(JSON.parse(init.body as string)).toEqual({
      p_user_id: 'u1', p_bucket_id: 'chat', p_usage_date: '2026-08-16', p_delta: 0.02,
    })
  })

  it('es best-effort: un fetch fallido no lanza', async () => {
    global.fetch = vi.fn(async () => { throw new Error('network down') }) as unknown as typeof fetch

    await expect(recordUsageCost({ userId: 'u1', bucketId: 'chat', usageDate: '2026-08-16', costUsd: 0.01 }))
      .resolves.toBeUndefined()
  })

  it('costo <= 0 no hace fetch', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await recordUsageCost({ userId: 'u1', bucketId: 'chat', usageDate: '2026-08-16', costUsd: 0 })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cero filas afectadas se loguea, no se ignora en silencio', async () => {
    global.fetch = vi.fn(async () => jsonResponse([])) as unknown as typeof fetch
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await recordUsageCost({ userId: 'u1', bucketId: 'chat', usageDate: '2026-08-16', costUsd: 0.02 })

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no confirmó un valor válido'))
  })

  it('una fila con estimated_cost_usd negativo o ausente también se loguea, no cuenta como éxito', async () => {
    global.fetch = vi.fn(async () => jsonResponse([{ estimated_cost_usd: -1 }])) as unknown as typeof fetch
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await recordUsageCost({ userId: 'u1', bucketId: 'chat', usageDate: '2026-08-16', costUsd: 0.02 })

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no confirmó un valor válido'))
  })
})
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run netlify/functions/__tests__/usageGate.test.ts`
Expected: FAIL — módulo `../_shared/usageGate` inexistente.

- [ ] **Step 3: Implementar**

```ts
// netlify/functions/_shared/usageGate.ts
import type { AIRequestClass } from '../../../src/types'
import type { Tier } from '../../../src/services/entitlements/entitlementPolicy'
import { bucketForClass, bucketLimitForTier } from '../../../src/services/entitlements/quotaBuckets'
import { evaluateSpendCaps, type SpendSnapshot } from '../../../src/services/entitlements/spendCapPolicy'

const RPC_TIMEOUT_MS = 3_000

export function isKillSwitchActive(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['AI_KILL_SWITCH_ENABLED'] === 'true'
}

export function isUsageLimitsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['AI_USAGE_LIMITS_ENABLED'] === 'true'
}

export interface UsageGateHttpError extends Error {
  statusCode: number
  errorCode: 'quota_exceeded' | 'spend_cap_exceeded' | 'kill_switch_active' | 'server_error'
  detail?: unknown
}

function makeGateError(
  message: string,
  statusCode: number,
  errorCode: UsageGateHttpError['errorCode'],
  detail?: unknown,
): UsageGateHttpError {
  const error = new Error(message) as UsageGateHttpError
  error.statusCode = statusCode
  error.errorCode = errorCode
  if (detail !== undefined) error.detail = detail
  return error
}

// Exportados a propósito: coach.ts, enqueue-plan-generation.ts y
// generate-plan-background.ts reusan estos mismos factories para su chequeo
// de kill switch de nivel superior (antes de resolver bucket/tier), en vez de
// inventar un `makeError` local por archivo.
export function makeKillSwitchError(): UsageGateHttpError {
  return makeGateError('La IA está temporalmente pausada.', 503, 'kill_switch_active')
}

export function makeSpendCapError(scope: 'account' | 'global', capUsd: number): UsageGateHttpError {
  return makeGateError(
    'El servicio alcanzó su presupuesto diario.',
    429,
    'spend_cap_exceeded',
    { scope, capUsd },
  )
}

export function makeQuotaExceededError(bucketId: string, limit: number, remaining = 0): UsageGateHttpError {
  return makeGateError(
    'Alcanzaste el cupo diario de esta función.',
    429,
    'quota_exceeded',
    { bucketId, limit, remaining },
  )
}

export function makeServerError(message: string): UsageGateHttpError {
  return makeGateError(message, 503, 'server_error')
}

function serviceRoleCredentials(): { url: string; key: string } | null {
  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) return null
  return { url: url.replace(/\/$/, ''), key }
}

/**
 * Corrección tras revisión (P1, ronda 2): la versión anterior solo convertía
 * respuestas HTTP no-2xx en `UsageGateHttpError` — un error de RED (fetch
 * rechaza), un abort por `AbortSignal.timeout`, o un `.json()` sobre un
 * cuerpo no-JSON escapaban como `Error`/`DOMException`/`SyntaxError` crudos,
 * sin `.statusCode`/`.errorCode`. Consumido desde el worker
 * (`generate-plan-background.ts`), un error crudo así NO es reconocido por
 * `isUsageGateRejection` del loop (no es `instanceof` ninguna de las 3
 * clases) y cae al catch genérico de `generateWeekCoreWithRetry`, que lo
 * trata como si el PROVEEDOR hubiera fallado — dispara retry/fallback para
 * un fallo que ocurrió en nuestra propia infraestructura, antes siquiera de
 * intentar la llamada real. Ahora TODO camino de salida de `callRpc` es
 * `UsageGateHttpError`, nunca un error crudo.
 */
async function callRpc<T>(functionName: string, args: Record<string, unknown>): Promise<T> {
  const creds = serviceRoleCredentials()
  if (!creds) throw makeServerError('Configuración de Supabase ausente en el servidor.')

  let response: Response
  try {
    response = await fetch(`${creds.url}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.key}`,
        apikey: creds.key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    })
  } catch (error) {
    throw makeServerError(`RPC ${functionName} no se pudo completar: ${error instanceof Error ? error.message : 'error de red'}.`)
  }
  if (!response.ok) {
    throw makeServerError(`RPC ${functionName} devolvió ${response.status}.`)
  }
  try {
    return await response.json() as T
  } catch {
    throw makeServerError(`RPC ${functionName} devolvió un cuerpo no JSON.`)
  }
}

/**
 * Corrección tras revisión (P1, fail-open): la primera versión de este plan
 * parseaba la respuesta con `.catch(() => valorPorDefecto)` en varios puntos
 * — un JSON malformado, un cuerpo vacío, o campos no numéricos terminaban
 * silenciosamente como "gasto/cuota cero", que es fail-OPEN (deja pasar la
 * request cuando en realidad no se pudo confirmar nada). Cualquier anomalía
 * de forma ahora lanza `server_error` (503) — fail-CLOSED — en vez de
 * inventar un valor seguro.
 */
function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

async function readSpend(userId: string): Promise<SpendSnapshot> {
  const rows = await callRpc<unknown>('read_ai_usage_spend', { p_user_id: userId })
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw makeServerError('read_ai_usage_spend devolvió una forma inesperada.')
  }
  const row = rows[0] as { account_cost_usd?: unknown; global_cost_usd?: unknown }
  if (!isFiniteNonNegative(row.account_cost_usd) || !isFiniteNonNegative(row.global_cost_usd)) {
    throw makeServerError('read_ai_usage_spend devolvió valores no numéricos.')
  }
  return { accountCostUsd: row.account_cost_usd, globalCostUsd: row.global_cost_usd }
}

function resolveBucket(requestClass: AIRequestClass, tier: Tier): { bucketId: string; limit: number } | null {
  const bucket = bucketForClass(requestClass)
  if (!bucket) return null
  const limit = bucketLimitForTier(bucket, tier)
  if (limit == null) return null
  return { bucketId: bucket.id, limit }
}

export interface UsageGateInput {
  userId: string
  requestClass: AIRequestClass
  tier: Tier
}

export interface UsageGateReservation {
  bucketId: string
  limit: number
  usageDate: string
}

/**
 * Gate autoritativo: chequea y CONSUME cuota. Debe llamarse inmediatamente
 * antes de la llamada real al proveedor, nunca antes. `null` significa "esta
 * llamada no está sujeta a gating" (limits apagado, o la clase no tiene
 * bucket/límite para el tier — eso lo resuelve el gate de entitlement, no
 * este).
 */
export async function assertUsageGate(input: UsageGateInput): Promise<UsageGateReservation | null> {
  if (isKillSwitchActive()) throw makeKillSwitchError()
  if (!isUsageLimitsEnabled()) return null

  const resolved = resolveBucket(input.requestClass, input.tier)
  if (!resolved) return null

  const spend = await readSpend(input.userId)
  const capCheck = evaluateSpendCaps(spend)
  if (capCheck.exceeded) throw makeSpendCapError(capCheck.scope, capCheck.capUsd)

  const rows = await callRpc<unknown>('increment_ai_usage_if_under_limit', {
    p_user_id: input.userId,
    p_bucket_id: resolved.bucketId,
    p_limit: resolved.limit,
  })
  if (!Array.isArray(rows)) throw makeServerError('increment_ai_usage_if_under_limit devolvió una forma inesperada.')
  if (rows.length === 0) throw makeQuotaExceededError(resolved.bucketId, resolved.limit, 0)
  // Cardinalidad estricta (P2, ronda 2): la PK de ai_usage_daily garantiza
  // que un UPSERT nunca produce más de una fila — más de una fila acá es
  // señal de que algo está mal configurado (RPC equivocada, tabla sin PK
  // real), no un caso a tolerar en silencio.
  if (rows.length !== 1) throw makeServerError('increment_ai_usage_if_under_limit devolvió más de una fila.')
  const row = rows[0] as { usage_date?: unknown; request_count?: unknown }
  if (typeof row.usage_date !== 'string' || row.usage_date.length === 0) {
    throw makeServerError('increment_ai_usage_if_under_limit devolvió usage_date inválido.')
  }
  if (!isFiniteNonNegative(row.request_count)) {
    throw makeServerError('increment_ai_usage_if_under_limit devolvió request_count no numérico.')
  }

  return { bucketId: resolved.bucketId, limit: resolved.limit, usageDate: row.usage_date }
}

/**
 * Preflight de solo lectura para `enqueue-plan-generation.ts`. No incrementa
 * nada — solo evita crear un job que el worker va a rechazar igual. La
 * autoridad real es `assertUsageGate`, invocado por el worker en cada
 * intento real.
 */
export async function checkUsagePreflight(input: UsageGateInput): Promise<void> {
  if (isKillSwitchActive()) throw makeKillSwitchError()
  if (!isUsageLimitsEnabled()) return

  const resolved = resolveBucket(input.requestClass, input.tier)
  if (!resolved) return

  const spend = await readSpend(input.userId)
  const capCheck = evaluateSpendCaps(spend)
  if (capCheck.exceeded) throw makeSpendCapError(capCheck.scope, capCheck.capUsd)

  const creds = serviceRoleCredentials()
  if (!creds) throw makeServerError('Configuración de Supabase ausente en el servidor.')
  const today = new Date().toISOString().slice(0, 10)
  const query = new URLSearchParams({
    user_id: `eq.${input.userId}`,
    usage_date: `eq.${today}`,
    bucket_id: `eq.${resolved.bucketId}`,
    select: 'request_count',
  })
  let response: Response
  try {
    response = await fetch(`${creds.url}/rest/v1/ai_usage_daily?${query.toString()}`, {
      headers: { Authorization: `Bearer ${creds.key}`, apikey: creds.key },
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    })
  } catch (error) {
    // Mismo fix que callRpc (P1, ronda 2): esta lectura no pasa por callRpc
    // (es un GET directo a PostgREST, no una RPC), así que necesita el mismo
    // try/catch de red por separado.
    throw makeServerError(`Lectura de cuota no se pudo completar: ${error instanceof Error ? error.message : 'error de red'}.`)
  }
  if (!response.ok) throw makeServerError(`Lectura de cuota devolvió ${response.status}.`)
  let rows: unknown
  try {
    rows = await response.json()
  } catch {
    throw makeServerError('Lectura de cuota devolvió un cuerpo no JSON.')
  }
  if (!Array.isArray(rows)) throw makeServerError('Lectura de cuota devolvió una forma inesperada.')
  // Cero filas es un estado válido (todavía no hay actividad hoy en este
  // bucket) — a diferencia de readSpend/increment, acá SÍ corresponde 0.
  const row = rows[0] as { request_count?: unknown } | undefined
  const current = row ? row.request_count : 0
  if (!isFiniteNonNegative(current)) {
    throw makeServerError('Lectura de cuota devolvió request_count no numérico.')
  }
  if (current >= resolved.limit) {
    throw makeQuotaExceededError(resolved.bucketId, resolved.limit, 0)
  }
}

export interface RecordUsageCostInput {
  userId: string
  bucketId: string
  usageDate: string
  costUsd: number
}

/**
 * Suma el costo real de un intento que ya pasó por el proveedor, sobre la
 * fila que `assertUsageGate` acaba de reservar, vía la RPC atómica
 * `increment_ai_usage_cost` (no un PATCH que sobreescribe — la primera
 * versión de este plan tenía ese bug: todas las requests del mismo bucket en
 * el día comparten fila, así que un `set` en vez de un `+=` pierde todo costo
 * previo). Best-effort: una falla acá ocurre DESPUÉS del gasto y no puede
 * deshacerse — nunca convierte una respuesta correcta del modelo en error
 * para el usuario. El caller debe esperar esta promesa (no fire-and-forget):
 * en un entorno serverless, una llamada `void` puede quedar cortada si la
 * función retorna antes de que el `fetch` termine.
 */
export async function recordUsageCost(input: RecordUsageCostInput): Promise<void> {
  if (input.costUsd <= 0) return
  try {
    const rows = await callRpc<unknown>('increment_ai_usage_cost', {
      p_user_id: input.userId,
      p_bucket_id: input.bucketId,
      p_usage_date: input.usageDate,
      p_delta: input.costUsd,
    })
    // Corrección tras revisión (P2, ronda 2): la versión anterior ignoraba
    // el resultado por completo — un UPDATE que afecta 0 filas (la fila que
    // `assertUsageGate` debió reservar no existe: bug de otra parte, drift
    // de usageDate/bucketId) parecía éxito. Sigue siendo best-effort (no
    // lanza), pero ahora al menos queda logueado si el costo NO se guardó.
    //
    // Corrección tras revisión (P2, ronda 3): validar cardinalidad (1 fila)
    // no alcanza — la fila puede volver con `estimated_cost_usd` ausente,
    // negativo o no numérico (RPC devuelve algo inesperado sin fallar el
    // HTTP) y eso también contaba como éxito silencioso. Se valida el campo.
    const row = Array.isArray(rows) && rows.length === 1
      ? (rows[0] as { estimated_cost_usd?: unknown })
      : null
    if (!row || !isFiniteNonNegative(row.estimated_cost_usd)) {
      console.warn(`[usage-gate] recordUsageCost no confirmó un valor válido: user=${input.userId} bucket=${input.bucketId} date=${input.usageDate}`)
    }
  } catch (error) {
    console.warn(`[usage-gate] recordUsageCost failed: ${error instanceof Error ? error.message : 'unknown'}`)
  }
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run netlify/functions/__tests__/usageGate.test.ts`
Expected: PASS (20 tests) — contado directamente contra el bloque de Step 1
(corregido tras revisión, P3 ronda 4: la cifra anterior, 23, no coincidía con
los `it(...)` reales del bloque).

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_shared/usageGate.ts netlify/functions/__tests__/usageGate.test.ts
git commit -m "feat(usage-limits): gate server-side (assertUsageGate, preflight, recordUsageCost)"
```

---

### Task 5: Cablear el gate en `coach.ts`

**Files:**
- Modify: `netlify/functions/coach.ts`
- Test: `netlify/functions/__tests__/coachUsageGate.test.ts`

**Interfaces:**
- Consumes: `assertUsageGate`, `isKillSwitchActive`, `makeKillSwitchError`, `recordUsageCost` de `./_shared/usageGate`; `estimateCostUsd` de `../../src/services/planBuilder/pricing.ts`.
- Produces: `executeWithPolicy` acepta ahora `gateContext: { userId: string; tier: Tier }`.

- [ ] **Step 1: Leer el contrato exacto de `invokeProvider` y `logCoachAttempt` antes de tocar nada**

Abrir `netlify/functions/coach.ts:1336-1365` (`invokeProvider`) y la llamada a
`logCoachAttempt` dentro de `runAttempt` (línea ~1420). Confirmar los nombres
de campo exactos del resultado que trae tokens/modelo/tier (`promptTokens`,
`completionTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`,
`model`, `serviceTier` son los nombres usados en el resto del archivo — pero
**verificar contra el tipo real de `ProviderExecutionResult`/lo que devuelve
`invokeProvider`**, no asumir). Si algún nombre difiere de lo escrito en el
Step 3, ajustar ahí antes de compilar — `tsc -b` lo va a marcar si hay un
mismatch.

- [ ] **Step 2: Escribir el test que falla**

```ts
// netlify/functions/__tests__/coachUsageGate.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlerMocks = vi.hoisted(() => ({
  isKillSwitchActive: vi.fn(() => false),
  isUsageLimitsEnabled: vi.fn(() => true),
  assertUsageGate: vi.fn(),
  recordUsageCost: vi.fn(async () => undefined),
  isEntitlementEnforcementEnabled: vi.fn(() => false),
  resolveEntitlementTier: vi.fn(async () => 'free'),
}))

vi.mock('../_shared/usageGate', async (importActual) => {
  const actual = await importActual<typeof import('../_shared/usageGate')>()
  return {
    ...actual,
    isKillSwitchActive: handlerMocks.isKillSwitchActive,
    isUsageLimitsEnabled: handlerMocks.isUsageLimitsEnabled,
    assertUsageGate: handlerMocks.assertUsageGate,
    recordUsageCost: handlerMocks.recordUsageCost,
  }
})

vi.mock('../_shared/resolveEntitlement', async (importActual) => {
  const actual = await importActual<typeof import('../_shared/resolveEntitlement')>()
  return {
    ...actual,
    isEntitlementEnforcementEnabled: handlerMocks.isEntitlementEnforcementEnabled,
    resolveEntitlementTier: handlerMocks.resolveEntitlementTier,
  }
})

// NOTA para el implementador: revisar cómo `coachEntitlementGate.test.ts`
// arma `callHandler`/el mock de fetch de proveedor y de auth (`/auth/v1/user`)
// y reusar exactamente ese setup acá — no reinventarlo. Este archivo asume
// ese mismo helper `callHandler(body, token)` disponible en el mismo estilo.
import { callHandler, stubProviderFetch, stubAuthFetch } from './helpers/coachTestHarness'

describe('coach.ts — usage gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    handlerMocks.isKillSwitchActive.mockReturnValue(false)
    handlerMocks.isUsageLimitsEnabled.mockReturnValue(true)
    stubAuthFetch({ userId: 'user-1' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('kill switch activo rechaza antes de invocar al proveedor', async () => {
    handlerMocks.isKillSwitchActive.mockReturnValue(true)
    const providerFetch = stubProviderFetch()

    const response = await callHandler({ requestClass: 'chat_general', userMessage: 'hola' }, 'token-1')

    expect(response.statusCode).toBe(503)
    expect(JSON.parse(response.body).errorCode).toBe('kill_switch_active')
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it('cuota agotada rechaza antes de invocar al proveedor y preserva detail', async () => {
    const gateError = Object.assign(new Error('cupo agotado'), {
      statusCode: 429,
      errorCode: 'quota_exceeded',
      detail: { bucketId: 'chat', limit: 15, remaining: 0 },
    })
    handlerMocks.assertUsageGate.mockRejectedValue(gateError)
    const providerFetch = stubProviderFetch()

    const response = await callHandler({ requestClass: 'chat_general', userMessage: 'hola' }, 'token-1')

    expect(response.statusCode).toBe(429)
    const body = JSON.parse(response.body)
    expect(body.errorCode).toBe('quota_exceeded')
    expect(body.detail).toEqual({ bucketId: 'chat', limit: 15, remaining: 0 })
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it('un retry consume el gate de nuevo, cada intento por separado', async () => {
    handlerMocks.assertUsageGate
      .mockResolvedValueOnce({ bucketId: 'chat', limit: 15, usageDate: '2026-08-16' })
      .mockResolvedValueOnce({ bucketId: 'chat', limit: 15, usageDate: '2026-08-16' })
    const providerFetch = stubProviderFetch({ failFirstAttempt: true })

    await callHandler({ requestClass: 'chat_general', userMessage: 'hola' }, 'token-1')

    expect(handlerMocks.assertUsageGate).toHaveBeenCalledTimes(2)
  })

  it('el bypass determinista no llama al gate de cuota', async () => {
    const providerFetch = stubProviderFetch()

    await callHandler({ requestClass: 'chat_action', userMessage: 'pon descanso el lunes' }, 'token-1')

    expect(handlerMocks.assertUsageGate).not.toHaveBeenCalled()
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it('con limits apagado, no llama al gate y responde normal', async () => {
    handlerMocks.isUsageLimitsEnabled.mockReturnValue(false)
    stubProviderFetch()

    const response = await callHandler({ requestClass: 'chat_general', userMessage: 'hola' }, 'token-1')

    expect(response.statusCode).toBe(200)
    expect(handlerMocks.assertUsageGate).not.toHaveBeenCalled()
  })

  it('si el proveedor no reporta tokens, no se registra costo y queda logueada una advertencia', async () => {
    handlerMocks.assertUsageGate.mockResolvedValue({ bucketId: 'chat', limit: 15, usageDate: '2026-08-16' })
    // NOTA: ajustar según la forma real de stubProviderFetch — necesita
    // poder simular una respuesta del proveedor SIN promptTokens/completionTokens.
    stubProviderFetch({ omitUsage: true })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await callHandler({ requestClass: 'chat_general', userMessage: 'hola' }, 'token-1')

    expect(handlerMocks.recordUsageCost).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no reportó usage'))
  })

  it('provider mal configurado (API key ausente) no consume cuota', async () => {
    // chat_general corre en gemini (confirmado en OPTIMIZATION_AND_COSTS.md
    // §8) — resolveApiKey('gemini') lee GEMINI_API_KEY (coach.ts:1326) y
    // lanza 500 'misconfigured' si falta, ANTES de la posición del gate.
    const originalKey = process.env['GEMINI_API_KEY']
    delete process.env['GEMINI_API_KEY']
    const providerFetch = stubProviderFetch()

    try {
      const response = await callHandler({ requestClass: 'chat_general', userMessage: 'hola' }, 'token-1')

      expect(response.statusCode).toBe(500)
      expect(JSON.parse(response.body).errorCode).toBe('misconfigured')
      expect(handlerMocks.assertUsageGate).not.toHaveBeenCalled()
      expect(providerFetch).not.toHaveBeenCalled()
    } finally {
      if (originalKey !== undefined) process.env['GEMINI_API_KEY'] = originalKey
    }
  })
})
```

**Corrección tras revisión (P2, ronda 4):** la ronda 3 dejaba esto como nota
de "no fácilmente testeable" — incorrecto. `resolveApiKey` lee
`process.env` directamente (`coach.ts:1325-1329`), así que borrar
temporalmente la env var del provider correspondiente y restaurarla en un
`finally` es exactamente lo que se necesita — sin mockear el módulo bajo
prueba, sin self-mock de ESM.

**Nota para el implementador:** `stubProviderFetch`/`stubAuthFetch`/`callHandler`
no existen todavía como helpers compartidos — extraerlos del setup ya
duplicado en `coachEntitlementGate.test.ts` a
`netlify/functions/__tests__/helpers/coachTestHarness.ts` es trabajo de este
mismo step (refactor de test, no de producción), porque este archivo nuevo
los necesita idénticos y no hay que duplicar el mock de `@netlify/functions`
y de `fetch` una tercera vez.

- [ ] **Step 2b: Extraer el harness compartido**

Leer `coachEntitlementGate.test.ts` completo, mover su setup de
`vi.mock('@netlify/functions', ...)`, el armado de `HandlerEvent` y el stub de
`fetch` para `/auth/v1/user` a `netlify/functions/__tests__/helpers/coachTestHarness.ts`,
exportando `callHandler`, `stubAuthFetch`, `stubProviderFetch`. Actualizar
`coachEntitlementGate.test.ts` para importar desde ahí en vez de duplicar el
setup — confirmar que sigue pasando después del refactor.

Run: `npx vitest run netlify/functions/__tests__/coachEntitlementGate.test.ts`
Expected: PASS, sin cambios de comportamiento.

- [ ] **Step 3: Correr el test nuevo y confirmar que falla**

Run: `npx vitest run netlify/functions/__tests__/coachUsageGate.test.ts`
Expected: FAIL — el gate no está cableado todavía.

- [ ] **Step 4: Implementar en `coach.ts`**

Agregar el import:
```ts
import { assertUsageGate, isKillSwitchActive, makeKillSwitchError, recordUsageCost } from './_shared/usageGate'
import { estimateCostUsd } from '../../src/services/planBuilder/pricing'
```

Extender `TechnicalErrorCode` (línea 52):
```ts
type TechnicalErrorCode =
  | 'timeout' | 'rate_limit' | 'parse_error' | 'server_error' | 'misconfigured'
  | 'unknown' | 'unauthorized' | 'entitlement_required'
  | 'quota_exceeded' | 'spend_cap_exceeded' | 'kill_switch_active'
```

En `normalizeError` (línea 512-535), agregar las 3 ramas ANTES de las
genéricas de 429/502-504:
```ts
function normalizeError(error: unknown): NormalizedServerError {
  const err = error as NormalizedServerError
  const message = err.message ?? 'Error interno del servidor.'
  const statusCode = err.statusCode
  if (statusCode === 403 && err.errorCode === 'entitlement_required') {
    return makeError(message, 403, 'entitlement_required', false, err.detail)
  }
  if (statusCode === 429 && err.errorCode === 'quota_exceeded') {
    return makeError(message, 429, 'quota_exceeded', false, err.detail)
  }
  if (statusCode === 429 && err.errorCode === 'spend_cap_exceeded') {
    return makeError(message, 429, 'spend_cap_exceeded', false, err.detail)
  }
  if (statusCode === 503 && err.errorCode === 'kill_switch_active') {
    return makeError(message, 503, 'kill_switch_active', false)
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
```

Extender `executeWithPolicy` para aceptar el contexto de gate y envolver
`invokeProvider` dentro de `runAttempt` (líneas ~1367-1538).

Función módulo-nivel nueva (fuera de `executeWithPolicy`, no depende de su
clausura — recibe todo por parámetro, así que no hay razón para redefinirla
en cada request):
```ts
/**
 * Registra el costo solo cuando el proveedor efectivamente reportó usage —
 * ver §3.3 del spec. `promptTokens`/`completionTokens` ausentes (no `0`,
 * ausentes) NO deben leerse como "cero tokens", porque terminaría en un
 * costo estimado de casi-cero en vez de "no se pudo estimar". La versión
 * anterior de este plan usaba `?? 0` en las 4 posiciones, colapsando
 * "desconocido" y "cero real" en el mismo valor — silencioso, sin la
 * advertencia operacional que el spec exige para usage desconocido o precio
 * ausente. `cacheReadTokens`/`cacheCreationTokens` sí usan `?? 0` porque
 * muchos modelos/proveedores nunca los reportan cuando no aplica caching —
 * eso es genuinamente cero, no "desconocido".
 */
async function recordCostIfKnown(input: {
  userId: string
  reservation: { bucketId: string; usageDate: string }
  result: { model: string; serviceTier?: string; promptTokens?: number; completionTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number }
}): Promise<void> {
  const { promptTokens, completionTokens } = input.result
  if (promptTokens == null || completionTokens == null) {
    console.warn(`[usage-gate] costo no estimable: el proveedor no reportó usage (model=${input.result.model})`)
    return
  }
  const costUsd = estimateCostUsd({
    model: input.result.model,
    at: Date.now(),
    serviceTier: input.result.serviceTier,
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    cacheReadTokens: input.result.cacheReadInputTokens ?? 0,
    cacheCreationTokens: input.result.cacheCreationInputTokens ?? 0,
  })
  if (costUsd == null) {
    console.warn(`[usage-gate] costo no estimable: sin precio cargado para model=${input.result.model} serviceTier=${input.result.serviceTier ?? '(default)'}`)
    return
  }
  // await, no `void`: en serverless una llamada disparada-y-olvidada puede
  // quedar cortada si la función retorna antes de que termine el fetch.
  // recordUsageCost nunca lanza (best-effort interno), así que esperar acá
  // no arriesga la respuesta al usuario.
  await recordUsageCost({ userId: input.userId, bucketId: input.reservation.bucketId, usageDate: input.reservation.usageDate, costUsd })
}
```

```ts
async function executeWithPolicy(
  req: CoachRequest,
  gateContext: { userId: string; tier: Tier },
  onChunk?: (chunk: string) => void,
): Promise<ProviderExecutionResult> {
  const requestClass = normalizeRequestClass(req.requestClass)
  const traceId = req.traceId ?? `srv-${Date.now()}`
  // ... resto de la función sin cambios hasta runAttempt ...

  let attemptIndex = 0
  const runAttempt = async (provider: ProviderName, attemptsRemaining: number) => {
    attemptIndex += 1
    const thisAttempt = attemptIndex

    /**
     * Corrección tras revisión (P1, ronda 4 — código real leído completo
     * esta vez, `coach.ts:1388-1465`). La ronda 3 movió la LLAMADA al gate
     * antes de `computeAttemptTimeoutMs`, reintroduciendo el mismo problema
     * en otro punto: `computeAttemptTimeoutMs` (línea 567) **también puede
     * lanzar** — `504 timeout` si ya no queda presupuesto de wallclock — y
     * si eso pasa DESPUÉS del gate, la cuota se gastó para un intento que
     * nunca iba a intentar nada. La distinción correcta no es "antes/después
     * del gate" a secas, sino entre dos cosas distintas:
     *
     * - **Calcular** el presupuesto (`computeAttemptTimeoutMs`, puro, puede
     *   lanzar) — debe ir ANTES del gate, en la posición exacta que ya tenía
     *   en el código original (antes del `try`), no dentro.
     * - **Armar** el timer real (`armTimeout`, que sí empieza a contar) —
     *   debe ir DESPUÉS del gate, para que el reloj no corra mientras el RPC
     *   del gate (hasta 3s) sigue en vuelo.
     *
     * Además, `attemptStartedAt` no puede seguir siendo una única variable:
     * el código real la usa en dos roles distintos — telemetría
     * (`durationMs` en `logCoachAttempt`, necesita cubrir el intento
     * completo, incluido el gate) y matemática de extensión de timeout en
     * streaming (`extendTimeoutForStreaming`, línea 1401-1411, que
     * necesita saber cuánto tiempo lleva corriendo el temporizador REAL, no
     * cuánto lleva el intento completo desde antes del gate). Se separan en
     * `attemptStartedAt` (telemetría, arranca al principio del intento) y
     * `providerStartedAt` (matemática del timer, arranca cuando se arma el
     * timer real, después del gate).
     */
    const attemptStartedAt = Date.now()

    // Config primero (síncrono, sin I/O) — una config inválida no debe
    // consumir cuota. `invokeProvider` los vuelve a resolver internamente;
    // redundante pero inofensivo, no se le cambia la firma.
    resolveModel(provider, requestClass)
    resolveApiKey(provider)

    // Cálculo del presupuesto, en la misma posición que el código original
    // (antes del try): si no queda presupuesto, lanza acá y nunca llega al
    // gate.
    let attemptTimeoutMs = computeAttemptTimeoutMs(deadline, attemptsRemaining)

    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    let streamingDeadlineExtended = false
    const armTimeout = (ms: number) => {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(() => controller.abort(), ms)
    }

    try {
      // Gate de cuota/costo: después de validar config y calcular (no
      // armar) el presupuesto, antes del timer real y antes de invokeProvider.
      const reservation = await assertUsageGate({
        userId: gateContext.userId,
        requestClass,
        tier: gateContext.tier,
      })

      // El timer real arranca DESPUÉS del gate. `providerStartedAt` marca el
      // punto desde el que cuenta `attemptTimeoutMs` — `extendTimeoutForStreaming`
      // necesita este punto, no `attemptStartedAt`, para no confundir
      // latencia del gate con latencia del proveedor.
      const providerStartedAt = Date.now()
      const extendTimeoutForStreaming = () => {
        if (streamingDeadlineExtended) return
        streamingDeadlineExtended = true
        const remainingBudget = deadline - Date.now()
        if (remainingBudget <= 0) {
          controller.abort()
          return
        }
        attemptTimeoutMs = Date.now() - providerStartedAt + remainingBudget
        armTimeout(remainingBudget)
      }
      armTimeout(attemptTimeoutMs)

      const result = await invokeProvider(
        provider,
        req,
        controller.signal,
        onChunk ? (chunk) => {
          extendTimeoutForStreaming()
          partialChunks = true
          onChunk(chunk)
        } : undefined,
      )
      logCoachAttempt({ /* ...campos existentes sin cambios: attemptTimeoutMs, durationMs: Date.now() - attemptStartedAt, etc... */ })
      if (reservation) {
        await recordCostIfKnown({ userId: gateContext.userId, reservation, result })
      }
      return result
    } catch (error) {
      const normalized = (error as Error).name === 'AbortError'
        ? makeError(`Timeout del proveedor ${provider} (${attemptTimeoutMs}ms).`, 504, 'timeout', true)
        : normalizeError(error)
      logCoachAttempt({ /* ...outcome: 'error'... campos existentes sin cambios ... */ })
      throw normalized
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }
  // ... resto sin cambios (primer intento, retry, fallback) ...
}
```

**Nota de fidelidad:** este bloque reproduce `partialChunks`/`streamingDeadlineExtended`
tal como existen en el código real (`coach.ts:1385-1411`) — declarados en el
scope de `executeWithPolicy`/`runAttempt` respectivamente, sin renombrar
nada más de lo estrictamente necesario para el fix. `computeAttemptTimeoutMs`
queda exactamente en la misma posición relativa (antes del `try`) que en el
código original — el único movimiento real es `armTimeout`/`providerStartedAt`,
de antes del `try` a después de que el gate resuelve.

**Corrección tras revisión (P1, no compilaba):** la primera versión de este
plan declaraba `const gateContext = { userId: auth.userId, tier: currentTier }`
"más abajo", fuera del `try`. Pero `auth`/`gateTier`/`currentTier` se
declaran con `const` **dentro** del `try` del bloque de auth
(`coach.ts:1649`, confirmado contra el archivo real) — son inaccesibles
fuera de ese bloque, ni siquiera con `tsc` en modo laxo. El fix hoistea un
`let` antes del `try`, igual que ya hace `persistence` unas líneas arriba.

**Corrección tras revisión (P1, tier neutro faltante):** con
`ENTITLEMENTS_ENABLED` apagado, `gateTier`/`currentTier` resuelven siempre a
`'free'`. Si `AI_USAGE_LIMITS_ENABLED` se enciende en ese estado (rollout
intermedio, o alguien lo activa sin activar entitlements), una clase
`weekly`/`advanced` (p. ej. `week_creator`) no tiene límite definido para
`'free'` en `QUOTA_BUCKETS`, así que `assertUsageGate` devuelve `null` (no
gatea) — la cuota queda salteada exactamente para las clases más caras. Igual
que ya hace Task 6/8, con `gateEnabled=false` el tier usado para el gate de
uso es `'advanced'` (neutro: no bloquea nada por sí solo, solo evita que
"nadie tiene límite" se lea como "cuota infinita").

En el `handler` (líneas ~1624-1821):
```ts
const authStartedAt = Date.now()
let authDurationMs = 0
let persistence: { userId: string; token: string } | undefined
let gateContext: { userId: string; tier: Tier } | undefined   // hoisteado, mismo patrón que `persistence`

try {
  const bearer = getBearerToken(event)
  const gateEnabled = isEntitlementEnforcementEnabled()
  const [auth, gateTier] = await Promise.all([
    resolveAuthContext(event),
    gateEnabled && AUTH_REQUIRED && bearer
      ? resolveEntitlementTier(bearer)
      : Promise.resolve('free' as Tier),
  ])

  // Kill switch DESPUÉS de auth (orden no negociable: auth → kill switch →
  // entitlement), no antes — `auth.userId` no hace falta para el chequeo en
  // sí, pero el orden del gate completo se mantiene consistente en las 3
  // funciones.
  if (isKillSwitchActive()) {
    throw makeKillSwitchError()
  }

  const token = bearer
  if (token && auth.userId !== ANONYMOUS_USER_ID) {
    persistence = { userId: auth.userId, token }
  }
  enforceRateLimit(auth)   // rate limit de ráfaga: SE CONSERVA, no lo reemplaza este bloque

  // ... resto del bloque de entitlement sin cambios (isClassAllowed, etc) ...

  const currentTier = auth.userId === ANONYMOUS_USER_ID ? 'free' : gateTier
  gateContext = { userId: auth.userId, tier: gateEnabled ? currentTier : 'advanced' }

  authDurationMs = Date.now() - authStartedAt
} catch (error) { /* ... sin cambios ... */ }

// más abajo, en las 2 llamadas a executeWithPolicy — `gateContext!` porque si
// se llegó hasta acá el try de arriba no lanzó, así que está asignado:
// streaming:
await executeWithPolicy(req, gateContext!, onChunk)
// no-streaming:
const result = await executeWithPolicy(req, gateContext!)
```

Importar `makeKillSwitchError` desde `./_shared/usageGate` junto al resto de
los imports del Step 4.

**Verificar los call sites reales de `executeWithPolicy`** con
`grep -n "executeWithPolicy(" netlify/functions/coach.ts` antes de editar —
el plan asume 2 (streaming y no-streaming); si hay una tercera copia dentro
del branch de streaming, pasarle `gateContext!` también ahí.

**Corrección tras revisión (P1, `detail` no llegaba al cliente):** tanto el
cuerpo de error streaming (`coach.ts:1603-1611`) como el no-streaming
(`coach.ts:1811-1818`) construyen su payload con una lista explícita de
campos que **no incluye `detail`** — confirmado contra el archivo real. Un
`quota_exceeded`/`spend_cap_exceeded` sin `detail` en el cuerpo hace que
`classifyProxyHttpError` (Task 9) nunca pase el type-guard de detalle y caiga
a la rama genérica `rate_limit` — reintentable, exactamente lo que el spec
prohíbe. Agregar `detail` a los dos payloads:

```ts
// streaming (dentro del catch que arma el chunk de tipo 'error'):
controller.enqueue(encoder.encode(`${JSON.stringify({
  type: 'error',
  truncated: sentAnyChunk,
  traceId,
  generationId: req.generationId,
  requestClass,
  error: normalized.message,
  errorCode: normalized.errorCode ?? 'unknown',
  ...(normalized.detail !== undefined ? { detail: normalized.detail } : {}),
  authDurationMs: timing.authDurationMs,
  serverDurationMs,
})}\n`))

// no-streaming (el catch final del handler):
return json(normalized.statusCode ?? 500, {
  error: normalized.message,
  errorCode: normalized.errorCode ?? 'unknown',
  ...(normalized.detail !== undefined ? { detail: normalized.detail } : {}),
  traceId: req.traceId,
  requestClass: normalizeRequestClass(req.requestClass),
  generationId: req.generationId,
  authDurationMs,
  serverDurationMs,
})
```

Agregar 2 tests a `coachUsageGate.test.ts` (Step 2) confirmando esto en ambos
transportes:
```ts
it('el body JSON no-streaming incluye detail para quota_exceeded', async () => {
  const gateError = Object.assign(new Error('cupo agotado'), {
    statusCode: 429, errorCode: 'quota_exceeded', detail: { bucketId: 'chat', limit: 15, remaining: 0 },
  })
  handlerMocks.assertUsageGate.mockRejectedValue(gateError)

  const response = await callHandler({ requestClass: 'chat_general', userMessage: 'hola', stream: false }, 'token-1')

  expect(JSON.parse(response.body).detail).toEqual({ bucketId: 'chat', limit: 15, remaining: 0 })
})

it('el chunk de error streaming incluye detail para spend_cap_exceeded', async () => {
  const gateError = Object.assign(new Error('presupuesto agotado'), {
    statusCode: 429, errorCode: 'spend_cap_exceeded', detail: { scope: 'global', capUsd: 5 },
  })
  handlerMocks.assertUsageGate.mockRejectedValue(gateError)

  const chunks = await callStreamingHandler({ requestClass: 'chat_general', userMessage: 'hola' }, 'token-1')
  const errorChunk = chunks.map((c) => JSON.parse(c)).find((c) => c.type === 'error')

  expect(errorChunk.detail).toEqual({ scope: 'global', capUsd: 5 })
})
```

**Nota:** `callStreamingHandler` es otro helper a extraer/confirmar contra
`coachEntitlementGate.test.ts` en el Step 2b — si ese archivo ya prueba el
transporte streaming con un nombre distinto, reusar ese nombre en vez de
inventar uno nuevo.

- [ ] **Step 5: Correr los tests y confirmar que pasan**

Run: `npx vitest run netlify/functions/__tests__/coachUsageGate.test.ts netlify/functions/__tests__/coachEntitlementGate.test.ts`
Expected: PASS, ambos archivos.

- [ ] **Step 6: `tsc -b` para confirmar que los nombres de campo de Step 1 son correctos**

Run: `npx tsc -b`
Expected: sin errores. Si hay un mismatch de nombre de campo (`promptTokens` vs otro nombre real), corregirlo acá.

- [ ] **Step 7: Commit**

```bash
git add netlify/functions/coach.ts netlify/functions/__tests__/coachUsageGate.test.ts netlify/functions/__tests__/coachEntitlementGate.test.ts netlify/functions/__tests__/helpers/coachTestHarness.ts
git commit -m "feat(usage-limits): cablear gate de cuota/costo/kill switch en coach.ts"
```

---

### Task 6: Cablear el gate en `enqueue-plan-generation.ts`

**Files:**
- Modify: `netlify/functions/enqueue-plan-generation.ts`
- Test: `netlify/functions/__tests__/enqueuePlanUsageGate.test.ts`

**Interfaces:**
- Consumes: `checkUsagePreflight`, `isKillSwitchActive`, `makeKillSwitchError` de `./_shared/usageGate`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// netlify/functions/__tests__/enqueuePlanUsageGate.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlerMocks = vi.hoisted(() => ({
  isKillSwitchActive: vi.fn(() => false),
  checkUsagePreflight: vi.fn(async () => undefined),
  createSupabaseWriter: vi.fn(),
  resolveAuthContext: vi.fn(async () => ({ userId: 'user-1', token: 'token-1' })),
  isEntitlementEnforcementEnabled: vi.fn(() => false),
  resolveEntitlementTier: vi.fn(async () => 'advanced'),
  assertPlanGenerationEntitlement: vi.fn(),
}))

vi.mock('../_shared/usageGate', async (importActual) => {
  const actual = await importActual<typeof import('../_shared/usageGate')>()
  return { ...actual, isKillSwitchActive: handlerMocks.isKillSwitchActive, checkUsagePreflight: handlerMocks.checkUsagePreflight }
})

vi.mock('../_shared/planGenerationShared', async (importActual) => {
  const actual = await importActual<typeof import('../_shared/planGenerationShared')>()
  return { ...actual, createSupabaseWriter: handlerMocks.createSupabaseWriter, resolveAuthContext: handlerMocks.resolveAuthContext }
})

vi.mock('../_shared/resolveEntitlement', async (importActual) => {
  const actual = await importActual<typeof import('../_shared/resolveEntitlement')>()
  return {
    ...actual,
    isEntitlementEnforcementEnabled: handlerMocks.isEntitlementEnforcementEnabled,
    resolveEntitlementTier: handlerMocks.resolveEntitlementTier,
    assertPlanGenerationEntitlement: handlerMocks.assertPlanGenerationEntitlement,
  }
})

// NOTA: reusar el body/event mínimo que ya arma enqueuePlanEntitlement.test.ts.
import { handler } from '../enqueue-plan-generation'
import { buildEnqueueEvent } from './helpers/enqueuePlanTestHarness'

describe('enqueue-plan-generation — usage gate', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('kill switch activo rechaza antes de actuar sobre entitlement o crear nada', async () => {
    handlerMocks.isKillSwitchActive.mockReturnValue(true)

    const response = await handler(buildEnqueueEvent(), {} as never)

    expect(response.statusCode).toBe(503)
    expect(JSON.parse(response.body).errorCode).toBe('kill_switch_active')
    // `resolveEntitlementTier` SÍ se invoca (corre en paralelo con auth vía
    // Promise.all, optimización ya existente) — lo que no debe pasar es que
    // se ACTÚE sobre esa resolución ni que se cree nada.
    expect(handlerMocks.assertPlanGenerationEntitlement).not.toHaveBeenCalled()
    expect(handlerMocks.checkUsagePreflight).not.toHaveBeenCalled()
    expect(handlerMocks.createSupabaseWriter).not.toHaveBeenCalled()
  })

  it('preflight de cuota rechazado no crea writer ni job', async () => {
    const gateError = Object.assign(new Error('cupo agotado'), {
      statusCode: 429,
      errorCode: 'quota_exceeded',
      detail: { bucketId: 'plan_builder_week', limit: 12, remaining: 0 },
    })
    handlerMocks.checkUsagePreflight.mockRejectedValue(gateError)

    const response = await handler(buildEnqueueEvent(), {} as never)

    expect(response.statusCode).toBe(429)
    expect(JSON.parse(response.body).errorCode).toBe('quota_exceeded')
    expect(handlerMocks.createSupabaseWriter).not.toHaveBeenCalled()
  })

  it('preflight aceptado sigue el flujo normal', async () => {
    handlerMocks.createSupabaseWriter.mockReturnValue({
      getPlan: vi.fn(async () => null),
      putPlan: vi.fn(async () => undefined),
      putWeek: vi.fn(async () => undefined),
    })

    const response = await handler(buildEnqueueEvent(), {} as never)

    expect(handlerMocks.checkUsagePreflight).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', requestClass: 'plan_builder_week' }),
    )
    expect(response.statusCode).not.toBe(429)
    expect(response.statusCode).not.toBe(503)
  })
})
```

**Nota:** igual que en Task 5, extraer `buildEnqueueEvent` del setup ya
existente en `enqueuePlanEntitlement.test.ts` a
`netlify/functions/__tests__/helpers/enqueuePlanTestHarness.ts` si no existe
ya un helper compartido — leer ese archivo primero para no duplicar.

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `npx vitest run netlify/functions/__tests__/enqueuePlanUsageGate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

En `netlify/functions/enqueue-plan-generation.ts`, agregar el import y
extender el bloque de gating (líneas 73-96):

```ts
import { checkUsagePreflight, isKillSwitchActive, makeKillSwitchError } from './_shared/usageGate'

// dentro del handler, reemplazando el bloque existente:
try {
  const bearer = getBearerToken(event)
  const gateEnabled = isEntitlementEnforcementEnabled()
  const [auth, gateTier] = await Promise.all([
    resolveAuthContext(event),
    gateEnabled && bearer
      ? resolveEntitlementTier(bearer)
      : Promise.resolve('free' as Tier),
  ])

  // Kill switch DESPUÉS de que `auth` está disponible (orden no negociable:
  // auth → kill switch → entitlement), pero antes de ACTUAR sobre el
  // entitlement o crear ningún writer/job. `resolveEntitlementTier` ya
  // corrió en paralelo con auth arriba — eso es preexistente, no algo que
  // este orden cambie.
  if (isKillSwitchActive()) {
    throw makeKillSwitchError()
  }

  if (gateEnabled) assertPlanGenerationEntitlement(gateTier)

  await checkUsagePreflight({
    userId: auth.userId,
    requestClass: 'plan_builder_week',
    tier: gateEnabled ? gateTier : 'advanced',
  })

  const writer = createSupabaseWriter(auth.userId, auth.token)
  // ... resto sin cambios ...
```

`makeKillSwitchError` viene de `usageGate.ts` (Task 4, ya exportado) — no
hace falta un `makeError` local en este archivo: el catch existente (líneas
123-157) ya lee `.statusCode`/`.errorCode`/`.detail` genéricamente de
cualquier `Error`, así que el objeto que devuelve `makeKillSwitchError()`
encaja sin cambios en esa serialización.

**Sobre el tier usado en el preflight cuando `gateEnabled` es `false`:** con
entitlements apagado el tier efectivo hoy es siempre `'free'` en el resto del
archivo (ver `Promise.resolve('free' as Tier)` arriba) — pero eso bloquearía
`plan_builder_week` por completo en el preflight (mínimo `advanced`). Dado que
con `gateEnabled=false` el propio `assertPlanGenerationEntitlement` no se
invoca (nadie es rechazado por plan), el preflight de cuota tampoco debe
inventar un tier ficticio que bloquee — usar `'advanced'` como valor neutro
solo para la resolución de bucket/límite en este caso (mismo criterio que ya
aplica el resto del archivo al tratar el modo sin gate como "todo permitido").

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run netlify/functions/__tests__/enqueuePlanUsageGate.test.ts netlify/functions/__tests__/enqueuePlanEntitlement.test.ts`
Expected: PASS, ambos archivos.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/enqueue-plan-generation.ts netlify/functions/__tests__/enqueuePlanUsageGate.test.ts
git commit -m "feat(usage-limits): preflight de cuota/costo en enqueue-plan-generation"
```

---

### Task 7: `quota_exhausted` en el loop async — tipo, flag, `finalizeJob`

**Files:**
- Modify: `src/services/planBuilder/asyncGenerationLoop.ts`
- Test: `src/services/planBuilder/__tests__/asyncGenerationLoopQuotaExhausted.test.ts`

**Interfaces:**
- Produces: `PlanGenerationJobTelemetry['outcome']` incluye `'quota_exhausted'` (solo para `QuotaExceededError`; `SpendCapExceededError`/`KillSwitchActiveError`/`UsageGateUnavailableError` producen `'failed'`); `RunAsyncPlanGenerationInput.callLLM` puede lanzar `QuotaExceededError | SpendCapExceededError | KillSwitchActiveError | UsageGateUnavailableError` (de `src/services/entitlements/usageGateError.ts`) y el loop las reconoce sin convertirlas en `provider_failed`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/services/planBuilder/__tests__/asyncGenerationLoopQuotaExhausted.test.ts
import { describe, expect, it, vi } from 'vitest'
import { runAsyncPlanGeneration } from '../asyncGenerationLoop'
import { KillSwitchActiveError, QuotaExceededError, SpendCapExceededError, UsageGateUnavailableError } from '../../entitlements/usageGateError'
// NOTA: importar los mismos builders/fixtures en memoria que ya usa
// asyncGenerationLoop.test.ts (o el archivo de test existente equivalente,
// buscar con `grep -rl "runAsyncPlanGeneration" src/services/planBuilder/__tests__`)
// para el writer en memoria, el plan/semanas de fixture y el manifest de
// concurrencia — no reinventarlos acá.
import { buildInMemoryWriter, buildFixturePlan, buildFixtureWeeks } from './helpers/asyncLoopFixtures'

describe('asyncGenerationLoop — quota_exhausted', () => {
  it('un rechazo de cuota en attempt 1 no dispara attempt 2 y no se trata como provider_failed', async () => {
    const plan = buildFixturePlan({ weekCount: 1 })
    const weeks = buildFixtureWeeks(plan, 1)
    const writer = buildInMemoryWriter(plan, weeks)
    const callLLM = vi.fn(async () => { throw new QuotaExceededError({ bucketId: 'plan_builder_week', limit: 12, remaining: 0 }) })

    const result = await runAsyncPlanGeneration({
      plan, weeks, writer, callLLM,
      jobId: 'job-1', enqueuedAt: Date.now(), concurrency: 1,
      targetWeekIndexes: [0],
      // ...resto de campos obligatorios de RunAsyncPlanGenerationInput según su firma real...
    } as never)

    expect(callLLM).toHaveBeenCalledTimes(1)
    const finalWeek = result.weeks.find((week) => week.weekIndex === 0)
    expect(finalWeek?.status).toBe('error')
    expect(finalWeek?.generationMeta.errorClass).not.toBe('provider_failed')
  })

  it('rechazo de cuota detiene el lanzamiento de semanas siguientes del mismo job', async () => {
    const plan = buildFixturePlan({ weekCount: 3 })
    const weeks = buildFixtureWeeks(plan, 3)
    const writer = buildInMemoryWriter(plan, weeks)
    const callLLM = vi.fn(async () => { throw new QuotaExceededError({ bucketId: 'plan_builder_week', limit: 12, remaining: 0 }) })

    await runAsyncPlanGeneration({
      plan, weeks, writer, callLLM,
      jobId: 'job-2', enqueuedAt: Date.now(), concurrency: 1,
      targetWeekIndexes: [0, 1, 2],
    } as never)

    // Con concurrencia 1 y rechazo en la primera semana, las 2 restantes no
    // deben llegar a invocar callLLM.
    expect(callLLM).toHaveBeenCalledTimes(1)
  })

  it('el job queda con outcome quota_exhausted', async () => {
    const plan = buildFixturePlan({ weekCount: 1 })
    const weeks = buildFixtureWeeks(plan, 1)
    const writer = buildInMemoryWriter(plan, weeks)
    const callLLM = vi.fn(async () => { throw new QuotaExceededError({ bucketId: 'plan_builder_week', limit: 12, remaining: 0 }) })
    const putJob = vi.fn(async () => undefined)
    writer.putJob = putJob

    await runAsyncPlanGeneration({
      plan, weeks, writer, callLLM,
      jobId: 'job-3', enqueuedAt: Date.now(), concurrency: 1,
      targetWeekIndexes: [0],
    } as never)

    expect(putJob).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'quota_exhausted' }))
  })

  it('spend_cap_exceeded produce outcome failed, no quota_exhausted', async () => {
    const plan = buildFixturePlan({ weekCount: 1 })
    const weeks = buildFixtureWeeks(plan, 1)
    const writer = buildInMemoryWriter(plan, weeks)
    const callLLM = vi.fn(async () => { throw new SpendCapExceededError({ scope: 'global', capUsd: 5 }) })
    const putJob = vi.fn(async () => undefined)
    writer.putJob = putJob

    await runAsyncPlanGeneration({
      plan, weeks, writer, callLLM,
      jobId: 'job-4', enqueuedAt: Date.now(), concurrency: 1,
      targetWeekIndexes: [0],
    } as never)

    expect(putJob).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }))
  })

  it('kill_switch_active produce outcome failed, aunque otra semana del mismo job ya haya tenido éxito', async () => {
    const plan = buildFixturePlan({ weekCount: 2 })
    const weeks = buildFixtureWeeks(plan, 2)
    const writer = buildInMemoryWriter(plan, weeks)
    let call = 0
    const callLLM = vi.fn(async () => {
      call += 1
      if (call === 1) return { model: 'claude-sonnet-4-6', promptTokens: 100, completionTokens: 50 }
      throw new KillSwitchActiveError()
    })
    const putJob = vi.fn(async () => undefined)
    writer.putJob = putJob

    await runAsyncPlanGeneration({
      plan, weeks, writer, callLLM,
      jobId: 'job-5', enqueuedAt: Date.now(), concurrency: 1,
      targetWeekIndexes: [0, 1],
    } as never)

    // Una semana exitosa no basta para 'partial': el spec pide 'failed' sin
    // matices cuando la causa es spend cap o kill switch.
    expect(putJob).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }))
  })

  it('UsageGateUnavailableError (falla de infraestructura del gate) produce un solo intento, cero fallback y outcome failed', async () => {
    // Agregado tras revisión (P2, ronda 4): Task 7 implementa el
    // reconocimiento de esta 4ª clase (isUsageGateRejection la incluye), pero
    // no había ningún test que lo ejercitara — solo las otras 3 estaban
    // cubiertas.
    const plan = buildFixturePlan({ weekCount: 1 })
    const weeks = buildFixtureWeeks(plan, 1)
    const writer = buildInMemoryWriter(plan, weeks)
    const callLLM = vi.fn(async () => { throw new UsageGateUnavailableError('RPC de cuota devolvió 503.') })
    const putJob = vi.fn(async () => undefined)
    writer.putJob = putJob

    await runAsyncPlanGeneration({
      plan, weeks, writer, callLLM,
      jobId: 'job-6', enqueuedAt: Date.now(), concurrency: 1,
      targetWeekIndexes: [0],
    } as never)

    // Un solo intento: no se trata como fallo del proveedor, así que no
    // dispara el segundo attempt de generateWeekCoreWithRetry ni ningún
    // fallback a otro proveedor.
    expect(callLLM).toHaveBeenCalledTimes(1)
    expect(putJob).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }))
  })
})
```

**Nota crítica para el implementador:** este test necesita el fixture real de
`RunAsyncPlanGenerationInput` (todos sus campos obligatorios) y el writer en
memoria — **leer `asyncGenerationLoop.test.ts` existente primero** (o el
archivo equivalente localizado con
`grep -rl "runAsyncPlanGeneration" src/services/planBuilder/__tests__`) y
copiar su fixture builder exacto en vez de inventar uno nuevo con campos
adivinados. Los `as never` de arriba son un placeholder deliberado de este
plan para no fingir precisión que no tengo sobre la firma completa — el
implementador debe reemplazarlos por el input real y tipado antes de
considerar el test terminado.

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `npx vitest run src/services/planBuilder/__tests__/asyncGenerationLoopQuotaExhausted.test.ts`
Expected: FAIL — hoy el error se convierte en `provider_failed` y sí dispara el segundo intento.

- [ ] **Step 3: Implementar — tipo de outcome**

En `src/services/planBuilder/asyncGenerationLoop.ts:93`:
```ts
outcome: 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'budget_exhausted' | 'quota_exhausted'
```

- [ ] **Step 4: Implementar — reconocer el error tipado en `generateWeekCoreWithRetry`**

En el catch de `generateWeekCoreWithRetry` (líneas 592-614), relanzar el
error del gate ANTES de convertirlo a `makeThrownAttemptResult`:
```ts
import { QuotaExceededError, SpendCapExceededError, KillSwitchActiveError, UsageGateUnavailableError } from '../entitlements/usageGateError'

// Incluye UsageGateUnavailableError (agregado tras revisión, P1 ronda 2):
// una falla del gate en sí (RPC caída, red) tampoco es un fallo del
// proveedor y no debe disparar retry/fallback como si lo fuera.
function isUsageGateRejection(
  error: unknown,
): error is QuotaExceededError | SpendCapExceededError | KillSwitchActiveError | UsageGateUnavailableError {
  return error instanceof QuotaExceededError
    || error instanceof SpendCapExceededError
    || error instanceof KillSwitchActiveError
    || error instanceof UsageGateUnavailableError
}

// dentro del for de generateWeekCoreWithRetry:
try {
  result = await generateWeekCore({ /* ...sin cambios... */ })
} catch (error) {
  if (isUsageGateRejection(error)) throw error   // no se convierte, no consume el segundo attempt
  const message = error instanceof Error ? error.message : String(error)
  result = makeThrownAttemptResult(message, attemptTraceId, lastResult?.meta.provider ?? 'claude')
  result.meta.durationMs = Date.now() - attemptStartedAt
}
```

- [ ] **Step 5: Implementar — `generateTargetWeek` captura la excepción relanzada**

**Corrección tras revisión (P1):** la primera versión de este plan marcaba
`quotaExhausted = true` para los 3 tipos de error indistintamente. El spec es
explícito (§5.3): *"Si la causa fue `quota_exceeded`, el job usa
`quota_exhausted`. Spend cap y kill switch usan `failed`."* — son outcomes
distintos, no el mismo flag. Además cada causa necesita su propio mensaje al
marcar las semanas restantes, no un texto genérico de "cuota agotada" para
las tres.

Localizar el try/catch que envuelve la llamada a `generateWeekCoreWithRetry`
dentro de `generateTargetWeek` (líneas ~1009-1237, buscar con
`grep -n "generateWeekCoreWithRetry(" src/services/planBuilder/asyncGenerationLoop.ts`
para la línea exacta de la llamada dentro de esta función). Agregar un catch
específico antes del catch genérico que ya existe:
```ts
let quotaExhausted = false      // junto a `let budgetExhausted = false` (línea 790)
let usageGateFailed = false     // spend_cap_exceeded, kill_switch_active o falla de infraestructura del gate

type UsageGateRejection = QuotaExceededError | SpendCapExceededError | KillSwitchActiveError | UsageGateUnavailableError

function usageGateRejectionMessage(error: UsageGateRejection): string {
  if (error instanceof QuotaExceededError) return 'Cuota diaria de IA agotada.'
  if (error instanceof SpendCapExceededError) return 'El servicio alcanzó su presupuesto diario.'
  if (error instanceof KillSwitchActiveError) return 'La IA está temporalmente pausada.'
  return error.message   // UsageGateUnavailableError: mensaje real del fallo de infraestructura, no genérico
}

// dentro de generateTargetWeek, alrededor de la llamada a generateWeekCoreWithRetry:
try {
  const coreResult = await generateWeekCoreWithRetry({ /* ...sin cambios... */ })
  // ...resto sin cambios...
} catch (error) {
  if (isUsageGateRejection(error)) {
    stopLaunching = true
    if (error instanceof QuotaExceededError) {
      quotaExhausted = true
    } else {
      usageGateFailed = true
    }
    const erroredWeek = makeErroredWeek(target, error.message, getNow(), error.code, 0)
    weeks = replaceWeek(weeks, erroredWeek)
    await input.writer.putWeek(erroredWeek)
    observeWeekWrite(erroredWeek)
    await markRemainingWeeksAsUsageGateRejected(targetPosition, error)
    return
  }
  // ...catch genérico existente sin cambios...
}
```

- [ ] **Step 6: Implementar — `markRemainingWeeksAsUsageGateRejected`**

Junto a `markRemainingBudgetErrors` (líneas 894-905), agregar la función
gemela — toma el error real para que el mensaje/errorClass de las semanas
restantes coincida con la causa real, no un texto genérico de cuota para las
tres:
```ts
const markRemainingWeeksAsUsageGateRejected = async (
  fromPosition: number,
  error: UsageGateRejection,
): Promise<void> => {
  const message = usageGateRejectionMessage(error)
  for (const remainingIndex of targetWeekIndexes.slice(fromPosition)) {
    const remainingWeek = weeks.find((week) => week.weekIndex === remainingIndex)
    if (!remainingWeek) continue
    if (!input.targetWeekIndexes?.length && isReadyWeek(remainingWeek)) continue
    const erroredWeek = makeErroredWeek(remainingWeek, message, getNow(), error.code, 0)
    weeks = replaceWeek(weeks, erroredWeek)
    await input.writer.putWeek(erroredWeek)
    observeWeekWrite(erroredWeek)
  }
}
```

**Nota:** verificar la firma exacta de `makeErroredWeek` (4o parámetro —
¿acepta cualquier string como `errorClass`, o es una unión cerrada?) con
`grep -n "function makeErroredWeek" src/services/planBuilder/asyncGenerationLoop.ts`
antes de pasar `error.code` (`'quota_exceeded' | 'spend_cap_exceeded' | 'kill_switch_active'`)
— si es una unión cerrada que no incluye estos valores, extenderla (es una
extensión de tipo local, no requiere migración) en vez de degradar a un
`errorClass` que no refleje la causa real.

- [ ] **Step 7: Implementar — `finalizeJob` respeta `quotaExhausted` y `usageGateFailed`**

En la cadena ternaria de `outcome` (dentro de `finalizeJob`, líneas ~833-838).
`quotaExhausted` produce su outcome propio; `usageGateFailed` fuerza `'failed'`
incluso si algunas semanas ya habían terminado con éxito antes del rechazo —
así lo pide el spec, sin la nuance de "partial" que sí aplica a
`budget_exhausted`:
```ts
const outcome: PlanGenerationJobTelemetry['outcome'] =
  cancelled ? 'cancelled'
    : quotaExhausted ? 'quota_exhausted'
      : usageGateFailed ? 'failed'
        : budgetExhausted ? 'budget_exhausted'
          : succeeded === targetWeekIndexes.length && !threwDuringRun ? 'succeeded'
            : succeeded > 0 && !threwDuringRun ? 'partial'
              : 'failed'
```

- [ ] **Step 8: Ajustar el fixture del test con la firma real y correr**

Reemplazar los `as never` del Step 1 por el input real (copiado del fixture
de `asyncGenerationLoop.test.ts` existente).

Run: `npx vitest run src/services/planBuilder/__tests__/asyncGenerationLoopQuotaExhausted.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 9: Correr la suite completa de `asyncGenerationLoop` para confirmar que no rompiste nada existente**

Run: `npx vitest run src/services/planBuilder/__tests__/asyncGenerationLoop*.test.ts`
Expected: PASS, todo.

- [ ] **Step 10: Commit**

```bash
git add src/services/planBuilder/asyncGenerationLoop.ts src/services/planBuilder/__tests__/asyncGenerationLoopQuotaExhausted.test.ts
git commit -m "feat(usage-limits): outcome quota_exhausted en el loop async de Plan Builder"
```

---

### Task 8: Cablear el gate en `generate-plan-background.ts`

**Files:**
- Modify: `netlify/functions/generate-plan-background.ts`
- Create: `netlify/functions/_shared/translateUsageGateError.ts`
- Test: `netlify/functions/__tests__/backgroundPlanUsageGate.test.ts`
- Test: `netlify/functions/__tests__/translateUsageGateError.test.ts`

**Interfaces:**
- Consumes: `assertUsageGate`, `isKillSwitchActive`, `makeKillSwitchError`, `recordUsageCost` de `./_shared/usageGate`; `estimateCostUsd` de `pricing.ts`; `QuotaExceededError`, `SpendCapExceededError`, `KillSwitchActiveError` de `../../src/services/entitlements/usageGateError` (para el adaptador); `terminalizeRejectedJob` existente (local a este archivo).
- Produces: `callLLM` pasado a `runAsyncPlanGeneration` queda envuelto (`gatedCallAnthropicForWeek`).

**Corrección tras revisión (P2, mecánicamente inválido):** la primera versión
de este plan intentaba mockear `terminalizeRejectedJob` vía
`vi.mock('../_shared/planGenerationShared', ...)`. Es imposible —
`terminalizeRejectedJob` está definida y exportada **dentro de
`generate-plan-background.ts`** (confirmado contra el archivo real, líneas
32-69), no en `_shared/planGenerationShared`. No se puede interceptar una
función local al módulo bajo test mockeando otro módulo. El test se reescribe
para verificar el **efecto observable** (`writer.putPlan` con
`generationState: 'failed'`) en vez de mockear la función.

- [ ] **Step 1: Escribir el test que falla**

```ts
// netlify/functions/__tests__/backgroundPlanUsageGate.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlerMocks = vi.hoisted(() => ({
  isKillSwitchActive: vi.fn(() => false),
  assertUsageGate: vi.fn(),
  recordUsageCost: vi.fn(async () => undefined),
  callAnthropicForWeek: vi.fn(async () => ({ /* respuesta mínima válida del proveedor */ })),
  resolveAuthContext: vi.fn(async () => ({ userId: 'user-1', token: 'token-1' })),
  createSupabaseWriter: vi.fn(),
  isEntitlementEnforcementEnabled: vi.fn(() => false),
  resolveEntitlementTier: vi.fn(async () => 'advanced'),
  assertPlanGenerationEntitlement: vi.fn(),
}))

vi.mock('../_shared/usageGate', async (importActual) => {
  const actual = await importActual<typeof import('../_shared/usageGate')>()
  return { ...actual, isKillSwitchActive: handlerMocks.isKillSwitchActive, assertUsageGate: handlerMocks.assertUsageGate, recordUsageCost: handlerMocks.recordUsageCost }
})
vi.mock('../_shared/anthropicCaller', () => ({ callAnthropicForWeek: handlerMocks.callAnthropicForWeek }))
vi.mock('../_shared/planGenerationShared', async (importActual) => {
  const actual = await importActual<typeof import('../_shared/planGenerationShared')>()
  // terminalizeRejectedJob NO va acá — es local a generate-plan-background.ts,
  // no se puede interceptar mockeando este módulo. Se verifica por su efecto
  // observable sobre el writer (putPlan con generationState: 'failed').
  return { ...actual, resolveAuthContext: handlerMocks.resolveAuthContext, createSupabaseWriter: handlerMocks.createSupabaseWriter }
})
vi.mock('../_shared/resolveEntitlement', async (importActual) => {
  const actual = await importActual<typeof import('../_shared/resolveEntitlement')>()
  return {
    ...actual,
    isEntitlementEnforcementEnabled: handlerMocks.isEntitlementEnforcementEnabled,
    resolveEntitlementTier: handlerMocks.resolveEntitlementTier,
    assertPlanGenerationEntitlement: handlerMocks.assertPlanGenerationEntitlement,
  }
})

import { handler } from '../generate-plan-background'
import { buildBackgroundEvent } from './helpers/backgroundPlanTestHarness'

function buildWriterStub(existingPlan: { generationState?: string; generationSummary?: { jobId: string } } | null) {
  return {
    getPlan: vi.fn(async () => existingPlan),
    putPlan: vi.fn(async () => undefined),
    putWeek: vi.fn(async () => undefined),
    putJob: vi.fn(async () => undefined),
  }
}

describe('generate-plan-background — usage gate', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('kill switch activo con jobId previo marca el plan failed (efecto observable de terminalizeRejectedJob)', async () => {
    handlerMocks.isKillSwitchActive.mockReturnValue(true)
    const writer = buildWriterStub({ generationState: 'generating', generationSummary: { jobId: 'job-existing' } })
    handlerMocks.createSupabaseWriter.mockReturnValue(writer)

    await handler(buildBackgroundEvent({ jobId: 'job-existing' }), {} as never)

    expect(writer.putPlan).toHaveBeenCalledWith(expect.objectContaining({ generationState: 'failed' }))
    expect(handlerMocks.callAnthropicForWeek).not.toHaveBeenCalled()
  })

  it('kill switch activo sin jobId previo no crea ningún writer ni toca ningún plan', async () => {
    handlerMocks.isKillSwitchActive.mockReturnValue(true)

    await handler(buildBackgroundEvent({ jobId: undefined }), {} as never)

    // Sin jobId no hay nada que limpiar (rejectedJobId es undefined, la rama
    // de terminalizeRejectedJob nunca corre) Y el throw del kill switch corta
    // antes de llegar al createSupabaseWriter principal más abajo — así que
    // no debería invocarse en absoluto.
    expect(handlerMocks.createSupabaseWriter).not.toHaveBeenCalled()
  })

  it('gate de cuota rechaza el primer attempt antes de llamar al proveedor real', async () => {
    const writer = buildWriterStub(null)
    handlerMocks.createSupabaseWriter.mockReturnValue(writer)
    handlerMocks.assertUsageGate.mockRejectedValue(
      Object.assign(new Error('cupo agotado'), { statusCode: 429, errorCode: 'quota_exceeded', detail: { bucketId: 'plan_builder_week', limit: 12, remaining: 0 } }),
    )

    await handler(buildBackgroundEvent({ jobId: undefined }), {} as never)

    expect(handlerMocks.callAnthropicForWeek).not.toHaveBeenCalled()
  })

  it('gate aceptado permite la llamada y registra costo después de la respuesta, esperado (no fire-and-forget)', async () => {
    const writer = buildWriterStub(null)
    handlerMocks.createSupabaseWriter.mockReturnValue(writer)
    handlerMocks.assertUsageGate.mockResolvedValue({ bucketId: 'plan_builder_week', limit: 12, usageDate: '2026-08-16' })
    let costRecordedBeforeReturn = false
    handlerMocks.recordUsageCost.mockImplementation(async () => { costRecordedBeforeReturn = true })
    handlerMocks.callAnthropicForWeek.mockResolvedValue({
      model: 'claude-sonnet-4-6', promptTokens: 1000, completionTokens: 500, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
    })

    await handler(buildBackgroundEvent({ jobId: undefined }), {} as never)

    expect(handlerMocks.callAnthropicForWeek).toHaveBeenCalledTimes(1)
    expect(handlerMocks.recordUsageCost).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', bucketId: 'plan_builder_week', usageDate: '2026-08-16' }),
    )
    // Si gatedCallLLM hiciera `void recordUsageCost(...)` en vez de `await`,
    // esto podría ser false en un entorno real donde la función corta antes.
    // Acá el mock resuelve síncrono, así que el valor real de esta aserción
    // depende de que el código awaitee — es una señal, no una prueba
    // determinística de la corrección serverless (eso se confirma leyendo el
    // código: no debe haber `void recordUsageCost(...)`).
    expect(costRecordedBeforeReturn).toBe(true)
  })

  it('si el proveedor no reporta tokens, no se registra costo y queda logueada una advertencia', async () => {
    const writer = buildWriterStub(null)
    handlerMocks.createSupabaseWriter.mockReturnValue(writer)
    handlerMocks.assertUsageGate.mockResolvedValue({ bucketId: 'plan_builder_week', limit: 12, usageDate: '2026-08-16' })
    handlerMocks.callAnthropicForWeek.mockResolvedValue({ model: 'claude-sonnet-4-6' })   // sin promptTokens/completionTokens
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await handler(buildBackgroundEvent({ jobId: undefined }), {} as never)

    expect(handlerMocks.recordUsageCost).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no reportó usage'))
  })

  it('CLAUDE_API_KEY ausente no consume cuota (P2, ronda 4)', async () => {
    const writer = buildWriterStub(null)
    handlerMocks.createSupabaseWriter.mockReturnValue(writer)
    const originalKey = process.env['CLAUDE_API_KEY']
    delete process.env['CLAUDE_API_KEY']

    try {
      await expect(handler(buildBackgroundEvent({ jobId: undefined }), {} as never))
        .resolves.toMatchObject({ statusCode: expect.any(Number) })
      expect(handlerMocks.assertUsageGate).not.toHaveBeenCalled()
      expect(handlerMocks.callAnthropicForWeek).not.toHaveBeenCalled()
    } finally {
      if (originalKey !== undefined) process.env['CLAUDE_API_KEY'] = originalKey
    }
  })
})
```

**Corrección tras revisión (P1, ronda 2 — test vacuo):** la primera versión
de esta ronda tenía acá un test que solo comprobaba
`expect(QuotaExceededError).toBeDefined()` — pasaría aunque `gatedCallLLM` no
tradujera absolutamente nada, porque no ejercita ninguna lógica real. La
traducción de shape (`UsageGateHttpError` → clase cliente) se extrae a un
módulo propio, puro y directamente testeable — ver Step 2b — en vez de vivir
inline dentro del handler donde solo se puede probar indirectamente.

**Nota:** `buildBackgroundEvent` sigue el mismo patrón que
`backgroundPlanEntitlement.test.ts` ya usa — leer ese archivo primero y
extraer/reusar su helper si ya existe, o crearlo en
`netlify/functions/__tests__/helpers/backgroundPlanTestHarness.ts` copiando
el body mínimo válido que ese archivo ya arma.

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `npx vitest run netlify/functions/__tests__/backgroundPlanUsageGate.test.ts`
Expected: FAIL.

- [ ] **Step 2b: Extraer el traductor de forma de error a un módulo propio, testeable directamente**

**Files:**
- Create: `netlify/functions/_shared/translateUsageGateError.ts`
- Test: `netlify/functions/__tests__/translateUsageGateError.test.ts`

```ts
// netlify/functions/_shared/translateUsageGateError.ts
// Corrección tras revisión (P1, ronda 3): desde _shared/ hacen falta 3
// niveles hasta la raíz del repo (_shared → functions → netlify → raíz),
// no 2 — ../../src apuntaría a netlify/src, que no existe. Mismo fix en el
// archivo de test de más abajo.
import {
  KillSwitchActiveError,
  QuotaExceededError,
  SpendCapExceededError,
  UsageGateUnavailableError,
  isQuotaExceededDetail,
  isSpendCapExceededDetail,
} from '../../../src/services/entitlements/usageGateError'
import type { UsageGateHttpError } from './usageGate'

/**
 * Adaptador de forma de error: `assertUsageGate` lanza `UsageGateHttpError`
 * (statusCode/errorCode/detail — el mismo shape que `EntitlementHttpError`,
 * pensado para la serialización HTTP síncrona de las 3 funciones). Pero en
 * el worker el error no va a una respuesta HTTP: entra al loop async
 * (`asyncGenerationLoop.ts`), que reconoce las 4 causas por `instanceof`
 * sobre las clases cliente de `usageGateError.ts` (mismo tipo que ya usa
 * `classifyProxyHttpError`). Sin esta traducción, el loop nunca reconoce el
 * rechazo — cae al catch genérico, se convierte en `provider_failed` y
 * dispara un segundo intento inútil. Este es el único punto de la app donde
 * un error server-shaped cruza hacia código que espera el shape cliente.
 *
 * `server_error` (RPC caída, red, JSON malformado — ver `usageGate.ts`) se
 * traduce a `UsageGateUnavailableError`, NO se propaga tal cual: un error
 * crudo sin traducir tampoco sería reconocido por el loop (P1, ronda 2 —
 * hallazgo real sobre la primera versión de este adaptador, que dejaba
 * pasar `server_error` sin convertir).
 *
 * Corrección tras revisión (P2, ronda 3): la versión anterior forzaba
 * `error.detail as QuotaExceededDetail`/`as SpendCapExceededDetail` sin
 * validar la forma real — `detail` es `unknown` en el momento en que llega
 * acá (viene de un `JSON.parse` en el otro extremo del RPC), así que un
 * detail corrupto o con forma inesperada se construía igual como un
 * rechazo de política "válido" con datos basura. Ahora usa los mismos type
 * guards que `classifyProxyHttpError`/Task 9: si el `errorCode` dice una
 * cosa pero el `detail` no calza con esa forma, se trata como fallo de
 * infraestructura (`UsageGateUnavailableError`), no como un rechazo de
 * cuota/costo corrupto.
 */
export function translateUsageGateError(error: UsageGateHttpError): Error {
  if (error.errorCode === 'quota_exceeded' && isQuotaExceededDetail(error.detail)) {
    return new QuotaExceededError(error.detail)
  }
  if (error.errorCode === 'spend_cap_exceeded' && isSpendCapExceededDetail(error.detail)) {
    return new SpendCapExceededError(error.detail)
  }
  if (error.errorCode === 'kill_switch_active') {
    return new KillSwitchActiveError()
  }
  return new UsageGateUnavailableError(error.message)
}
```

```ts
// netlify/functions/__tests__/translateUsageGateError.test.ts
import { describe, expect, it } from 'vitest'
import { translateUsageGateError } from '../_shared/translateUsageGateError'
import {
  KillSwitchActiveError,
  QuotaExceededError,
  SpendCapExceededError,
  UsageGateUnavailableError,
} from '../../../src/services/entitlements/usageGateError'
import type { UsageGateHttpError } from '../_shared/usageGate'

function httpError(overrides: Partial<UsageGateHttpError>): UsageGateHttpError {
  return Object.assign(new Error('mensaje'), {
    statusCode: 429,
    errorCode: 'quota_exceeded',
    ...overrides,
  }) as UsageGateHttpError
}

describe('translateUsageGateError', () => {
  it('quota_exceeded → QuotaExceededError con el mismo detail', () => {
    const detail = { bucketId: 'plan_builder_week', limit: 12, remaining: 0 }
    const translated = translateUsageGateError(httpError({ errorCode: 'quota_exceeded', detail }))
    expect(translated).toBeInstanceOf(QuotaExceededError)
    expect((translated as QuotaExceededError).detail).toEqual(detail)
  })

  it('spend_cap_exceeded → SpendCapExceededError con el mismo detail', () => {
    const detail = { scope: 'global' as const, capUsd: 5 }
    const translated = translateUsageGateError(httpError({ errorCode: 'spend_cap_exceeded', detail }))
    expect(translated).toBeInstanceOf(SpendCapExceededError)
    expect((translated as SpendCapExceededError).detail).toEqual(detail)
  })

  it('kill_switch_active → KillSwitchActiveError', () => {
    const translated = translateUsageGateError(httpError({ errorCode: 'kill_switch_active', detail: undefined }))
    expect(translated).toBeInstanceOf(KillSwitchActiveError)
  })

  it('server_error → UsageGateUnavailableError, NO se propaga crudo', () => {
    const translated = translateUsageGateError(httpError({ errorCode: 'server_error', detail: undefined, statusCode: 503 }))
    expect(translated).toBeInstanceOf(UsageGateUnavailableError)
    expect(translated.message).toBe('mensaje')
  })

  it('quota_exceeded con detail malformado se trata como fallo de infraestructura, no como rechazo corrupto', () => {
    const translated = translateUsageGateError(httpError({ errorCode: 'quota_exceeded', detail: { bucketId: 'chat' } }))
    expect(translated).toBeInstanceOf(UsageGateUnavailableError)
    expect(translated).not.toBeInstanceOf(QuotaExceededError)
  })

  it('spend_cap_exceeded con detail ausente se trata como fallo de infraestructura', () => {
    const translated = translateUsageGateError(httpError({ errorCode: 'spend_cap_exceeded', detail: undefined }))
    expect(translated).toBeInstanceOf(UsageGateUnavailableError)
    expect(translated).not.toBeInstanceOf(SpendCapExceededError)
  })
})
```

Run: `npx vitest run netlify/functions/__tests__/translateUsageGateError.test.ts`
Expected: FAIL (módulo inexistente), después de crear el archivo de
implementación PASS (6 tests). Commit junto con el resto de esta task.

- [ ] **Step 3: Implementar el cableado en `generate-plan-background.ts`**

```ts
import { assertUsageGate, isKillSwitchActive, makeKillSwitchError, recordUsageCost, type UsageGateHttpError } from './_shared/usageGate'
import { translateUsageGateError } from './_shared/translateUsageGateError'
import { estimateCostUsd } from '../../src/services/planBuilder/pricing'
// Mismas funciones que anthropicCaller.ts usa internamente — se reusan acá
// solo para validar config ANTES del gate (ver comentario en gatedCallLLM
// más abajo). Confirmar el import real con
// `grep -n "resolvePlanBuilderModel\|resolvePlanBuilderRequestDirectives" netlify/functions/_shared/anthropicCaller.ts`
// si esta ruta relativa no calza tras mover archivos.
import { resolvePlanBuilderModel, resolvePlanBuilderRequestDirectives } from './_shared/planBuilderRunConfig'

// Función módulo-nivel, igual que en Task 5 — no depende de clausura, no se
// redefine por request. Misma corrección (P2, ronda 2: `?? 0` colapsaba
// "desconocido" con "cero real" y nunca emitía el warning que pide el spec
// §3.3 para usage o precio ausente).
async function recordCostIfKnown(input: {
  userId: string
  reservation: { bucketId: string; usageDate: string }
  result: { model: string; serviceTier?: string; promptTokens?: number; completionTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number }
}): Promise<void> {
  const { promptTokens, completionTokens } = input.result
  if (promptTokens == null || completionTokens == null) {
    console.warn(`[usage-gate] costo no estimable: el proveedor no reportó usage (model=${input.result.model})`)
    return
  }
  const costUsd = estimateCostUsd({
    model: input.result.model,
    at: Date.now(),
    serviceTier: input.result.serviceTier,
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    cacheReadTokens: input.result.cacheReadInputTokens ?? 0,
    cacheCreationTokens: input.result.cacheCreationInputTokens ?? 0,
  })
  if (costUsd == null) {
    console.warn(`[usage-gate] costo no estimable: sin precio cargado para model=${input.result.model} serviceTier=${input.result.serviceTier ?? '(default)'}`)
    return
  }
  await recordUsageCost({ userId: input.userId, bucketId: input.reservation.bucketId, usageDate: input.reservation.usageDate, costUsd })
}

// Kill switch, mismo patrón que el gate de entitlement existente (líneas 91-121):
try {
  const bearer = getBearerToken(event)
  const gateEnabled = isEntitlementEnforcementEnabled()
  const [auth, gateTier] = await Promise.all([
    resolveAuthContext(event),
    gateEnabled && bearer ? resolveEntitlementTier(bearer) : Promise.resolve('free' as Tier),
  ])

  // Kill switch DESPUÉS de auth, ANTES de entitlement — mismo orden que
  // coach.ts y enqueue. `makeKillSwitchError()` viene de usageGate.ts (Task
  // 4), no un `makeError` local que este archivo no tiene.
  if (isKillSwitchActive()) {
    const rejectedJobId = typeof body.jobId === 'string' && body.jobId ? body.jobId : undefined
    const cleanupOutcome = rejectedJobId
      ? await terminalizeRejectedJob(createSupabaseWriter(auth.userId, auth.token), body.plan.id, rejectedJobId)
      : 'skipped'
    console.warn(`[generate-plan] kill switch active planId=${body.plan.id} cleanup=${cleanupOutcome}`)
    throw makeKillSwitchError()
  }

  if (gateEnabled) {
    try {
      assertPlanGenerationEntitlement(gateTier)
    } catch (error) {
      // ...bloque existente sin cambios...
    }
  }

  const writer = createSupabaseWriter(auth.userId, auth.token)
  const startedAt = Date.now()
  const planId = body.plan.id
  const weekCount = body.weeks.length
  const jobId = typeof body.jobId === 'string' && body.jobId ? body.jobId : createJobId(planId)

  const effectiveTier: Tier = gateEnabled ? gateTier : 'advanced'

  const gatedCallLLM = async (request: Parameters<typeof callAnthropicForWeek>[0]) => {
    /**
     * Corrección tras revisión (P1, ronda 3): mismo problema que en
     * `coach.ts` — `callAnthropicForWeek` valida `CLAUDE_API_KEY` y resuelve
     * modelo/directivas recién al principio de SU PROPIO cuerpo
     * (`anthropicCaller.ts:75-86`), después del gate en la versión anterior
     * de este plan. Una config inválida consumiría cuota sin que el request
     * llegara a abrirse. Se duplica acá la misma validación barata (sin I/O)
     * ANTES del gate — `callAnthropicForWeek` la vuelve a hacer internamente,
     * redundante pero inofensivo, no se le cambia la firma pública.
     *
     * A diferencia de `coach.ts`, acá no hace falta reordenar ningún
     * timeout: `callAnthropicForWeek` arma el suyo (`setTimeout`/
     * `AbortController`) dentro de su propio cuerpo, invocado recién
     * DESPUÉS de que el gate ya haya resuelto — no hay una versión
     * "adelantada" del timeout que este wrapper arme por su cuenta.
     */
    const apiKey = process.env['CLAUDE_API_KEY']
    if (!apiKey) throw new Error('CLAUDE_API_KEY no configurada.')
    const model = resolvePlanBuilderModel(process.env)
    resolvePlanBuilderRequestDirectives(process.env, model)   // valida; el resultado se descarta, callAnthropicForWeek lo vuelve a resolver

    let reservation: Awaited<ReturnType<typeof assertUsageGate>>
    try {
      reservation = await assertUsageGate({
        userId: auth.userId,
        requestClass: 'plan_builder_week',
        tier: effectiveTier,
      })
    } catch (error) {
      throw translateUsageGateError(error as UsageGateHttpError)
    }
    const result = await callAnthropicForWeek(request)
    if (reservation) {
      await recordCostIfKnown({ userId: auth.userId, reservation, result })
    }
    return result
  }

  const generationResult = await runAsyncPlanGeneration({
    // ...campos existentes sin cambios...
    callLLM: gatedCallLLM,   // reemplaza `callAnthropicForWeek` directo (línea 206)
  })
  // ...resto sin cambios...
} catch (error) {
  // ...manejo existente sin cambios, ya serializa statusCode/errorCode/detail genéricamente...
}
```

**Nota para el implementador:** verificar el tipo exacto de retorno de
`callAnthropicForWeek` (¿trae `model`/`promptTokens`/etc. con esos nombres
exactos, o es un tipo distinto al de `invokeProvider` en `coach.ts`? son
proveedores distintos — Claude vs el genérico de `coach.ts`) antes de asumir
que los nombres de campo coinciden con los usados en Task 5. Ajustar si
difieren; `tsc -b` lo va a señalar.

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run netlify/functions/__tests__/backgroundPlanUsageGate.test.ts netlify/functions/__tests__/backgroundPlanEntitlement.test.ts netlify/functions/__tests__/translateUsageGateError.test.ts`
Expected: PASS, los 3 archivos.

- [ ] **Step 5: `tsc -b`**

Run: `npx tsc -b`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/generate-plan-background.ts netlify/functions/_shared/translateUsageGateError.ts netlify/functions/__tests__/backgroundPlanUsageGate.test.ts netlify/functions/__tests__/translateUsageGateError.test.ts
git commit -m "feat(usage-limits): cablear gate de cuota/costo/kill switch en generate-plan-background"
```

---

### Task 9: `classifyProxyHttpError` reconoce los 3 códigos nuevos

**Files:**
- Modify: `src/services/ai/providers/proxyHttpError.ts`
- Modify: `src/services/ai/providers/ProxyProvider.ts` (transporte streaming, Step 5)
- Test: `src/services/ai/providers/__tests__/proxyUsageGateError.test.ts`
- Test: streaming — extender o crear `src/services/ai/providers/__tests__/proxyProviderStreamingUsageGate.test.ts` (Step 5)

**Interfaces:**
- Consumes: `QuotaExceededError`, `SpendCapExceededError`, `KillSwitchActiveError`, `isQuotaExceededDetail`, `isSpendCapExceededDetail` de `src/services/entitlements/usageGateError.ts` (Task 3).

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/services/ai/providers/__tests__/proxyUsageGateError.test.ts
import { describe, expect, it } from 'vitest'
import { classifyProxyHttpError } from '../proxyHttpError'
import { KillSwitchActiveError, QuotaExceededError, SpendCapExceededError } from '../../../entitlements/usageGateError'

function res(status: number): Response {
  return new Response(null, { status })
}

describe('classifyProxyHttpError — usage gate', () => {
  it('429 quota_exceeded con detail válido lanza QuotaExceededError tipado', () => {
    expect(() => classifyProxyHttpError(res(429), {
      error: 'Alcanzaste el cupo diario.',
      errorCode: 'quota_exceeded',
      detail: { bucketId: 'chat', limit: 15, remaining: 0 },
    })).toThrowError(QuotaExceededError)
  })

  it('429 spend_cap_exceeded con detail válido lanza SpendCapExceededError tipado', () => {
    expect(() => classifyProxyHttpError(res(429), {
      error: 'Presupuesto diario alcanzado.',
      errorCode: 'spend_cap_exceeded',
      detail: { scope: 'global', capUsd: 5 },
    })).toThrowError(SpendCapExceededError)
  })

  it('503 kill_switch_active lanza KillSwitchActiveError sin exigir detail', () => {
    expect(() => classifyProxyHttpError(res(503), {
      error: 'IA pausada.',
      errorCode: 'kill_switch_active',
    })).toThrowError(KillSwitchActiveError)
  })

  it('429 quota_exceeded con detail malformado NO usa el error tipado', () => {
    let thrown: unknown
    try {
      classifyProxyHttpError(res(429), { error: 'x', errorCode: 'quota_exceeded', detail: { bucketId: 'chat' } })
    } catch (error) {
      thrown = error
    }
    expect(thrown).not.toBeInstanceOf(QuotaExceededError)
  })

  it('429 genérico sin errorCode sigue cayendo a rate_limit', () => {
    let thrown: unknown
    try {
      classifyProxyHttpError(res(429), { error: 'demasiadas solicitudes' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).not.toBeInstanceOf(QuotaExceededError)
  })
})
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `npx vitest run src/services/ai/providers/__tests__/proxyUsageGateError.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

En `src/services/ai/providers/proxyHttpError.ts`, agregar los 3 casos ANTES
de la rama genérica de 429 (línea 41) y de la de 502/503/504 (línea 45):

```ts
import { KillSwitchActiveError, QuotaExceededError, SpendCapExceededError, isQuotaExceededDetail, isSpendCapExceededDetail } from '../../entitlements/usageGateError'

export function classifyProxyHttpError(res: Response, data: ProxyErrorPayload): never {
  const message = data.error ?? `Error del servidor (${res.status}).`

  if (res.status === 403 && data.errorCode === 'entitlement_required' && isEntitlementRequiredDetail(data.detail)) {
    throw new EntitlementRequiredError(data.detail)
  }

  if (res.status === 429 && data.errorCode === 'quota_exceeded' && isQuotaExceededDetail(data.detail)) {
    throw new QuotaExceededError(data.detail)
  }

  if (res.status === 429 && data.errorCode === 'spend_cap_exceeded' && isSpendCapExceededDetail(data.detail)) {
    throw new SpendCapExceededError(data.detail)
  }

  if (res.status === 503 && data.errorCode === 'kill_switch_active') {
    throw new KillSwitchActiveError()
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

  if (data.errorCode === 'unauthorized') {
    throw createProviderError('gemini', 'unauthorized', message)
  }

  if (res.status >= 500 || data.errorCode === 'server_error') {
    throw createProviderError('gemini', 'server_error', message)
  }

  throw createProviderError('gemini', data.errorCode ?? 'unknown', message)
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/services/ai/providers/__tests__/proxyUsageGateError.test.ts src/services/ai/providers/__tests__/proxyEntitlementError.test.ts`
Expected: PASS, ambos archivos.

- [ ] **Step 5: `ProxyProvider.ts` — el transporte streaming también necesita reconocer `detail`**

**Agregado tras revisión (P2, ronda 2):** `classifyProxyHttpError` (arriba)
solo cubre el transporte **no-streaming**. El servidor SÍ agrega `detail` al
chunk de error streaming (Task 5, corrección de `coach.ts:1603-1611`), pero
el parser del cliente en `src/services/ai/providers/ProxyProvider.ts` (líneas
~220-282, confirmado contra el archivo real) **no declara `detail` en el tipo
del evento parseado ni lo usa** — el bloque `if (event.type === 'error')`
construye siempre un `AIProviderError` genérico vía `createProviderError(...)`,
sin pasar por las clases tipadas. Sin este fix, un chat en modo streaming que
recibe `quota_exceeded` termina con un error genérico en vez de
`QuotaExceededError` — funcionalmente el código (`.code`) sigue llegando bien
así que `formatError` (Task 10) igual muestra el copy correcto, pero
`.detail` se pierde y cualquier consumidor futuro que lo necesite (no
`formatError`, que no lo usa hoy) se queda sin datos.

**Fuera de alcance, encontrado de paso:** el mismo parser tampoco declara
`detail` para `entitlement_required` — el streaming de chat probablemente ya
pierde el detail de la oferta de upgrade hoy, antes de este bloque. Es un gap
preexistente no introducido por esta entrega; no se corrige acá para no
mezclar un fix no relacionado con esta feature. Si se decide corregirlo,
es una entrega aparte.

**Test primero** — extender el test de streaming existente de `ProxyProvider`
(buscar con `grep -rl "ProxyProvider" src/services/ai/providers/__tests__` el
archivo que ya cubre el parser de streaming; si no existe uno dedicado,
crear `src/services/ai/providers/__tests__/proxyProviderStreamingUsageGate.test.ts`
mockeando `fetch` para devolver un stream NDJSON con un chunk
`{"type":"error","errorCode":"quota_exceeded","detail":{"bucketId":"chat","limit":15,"remaining":0},"error":"..."}`):

```ts
it('un chunk de error streaming con quota_exceeded lanza QuotaExceededError con detail', async () => {
  // mock de fetch que devuelve un ReadableStream con esa línea NDJSON —
  // reusar el helper de streaming que el archivo existente ya tenga.
  const provider = new ProxyProvider(/* ...config existente... */)

  // Corrección tras revisión (P1, ronda 3): el método público de
  // ProxyProvider es `call`, no `complete` (confirmado contra
  // ProxyProvider.ts:31: `async call(request: AIRequest): Promise<AIRawResponse>`)
  await expect(provider.call(/* ...request mínimo existente... */))
    .rejects.toBeInstanceOf(QuotaExceededError)
})
```

**Implementación** — en `ProxyProvider.ts`, agregar `detail?: unknown` al
tipo del evento parseado (línea ~244, junto a `errorCode?: AIErrorCode`), e
insertar los 3 casos nuevos ANTES del `throw createProviderError(...)`
genérico dentro del bloque `if (event.type === 'error')` (línea ~282):

```ts
import { KillSwitchActiveError, QuotaExceededError, SpendCapExceededError, isQuotaExceededDetail, isSpendCapExceededDetail } from '../../entitlements/usageGateError'

// en la interfaz del evento parseado (dentro del try, línea ~223):
const event = JSON.parse(trimmed) as {
  // ...campos existentes sin cambios...
  detail?: unknown
}

// dentro de `if (event.type === 'error') { ... }`, antes del throw genérico:
if (event.truncated && fullText) {
  truncated = true
  truncatedErrorClass = event.errorCode
  break
}
if (event.errorCode === 'quota_exceeded' && isQuotaExceededDetail(event.detail)) {
  throw new QuotaExceededError(event.detail)
}
if (event.errorCode === 'spend_cap_exceeded' && isSpendCapExceededDetail(event.detail)) {
  throw new SpendCapExceededError(event.detail)
}
if (event.errorCode === 'kill_switch_active') {
  throw new KillSwitchActiveError()
}
throw createProviderError('gemini', event.errorCode ?? 'unknown', event.error ?? 'Streaming falló.')
```

Run: `npx vitest run src/services/ai/providers/__tests__/proxyProviderStreamingUsageGate.test.ts` (o el nombre real del archivo extendido)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/ai/providers/proxyHttpError.ts src/services/ai/providers/ProxyProvider.ts src/services/ai/providers/__tests__/proxyUsageGateError.test.ts src/services/ai/providers/__tests__/proxyProviderStreamingUsageGate.test.ts
git commit -m "feat(usage-limits): classifyProxyHttpError y streaming reconocen cuota/spend cap/kill switch"
```

---

### Task 10: `formatError` en el chat muestra copy específico

**Files:**
- Modify: `src/store/useChatStore.ts`
- Test: `src/store/__tests__/chatUsageGateError.test.ts`

**Interfaces:**
- Consumes: `QuotaExceededError`, `SpendCapExceededError`, `KillSwitchActiveError` de `src/services/entitlements/usageGateError.ts`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/store/__tests__/chatUsageGateError.test.ts
import { describe, expect, it } from 'vitest'
// NOTA: formatError no está exportada hoy (función interna del módulo) —
// ver Step 3 para exportarla o testear vía el flujo público del store, según
// lo que ya haga chatEntitlementOffer.test.ts. Leer ese archivo primero.
import { formatError } from '../useChatStore'
import { KillSwitchActiveError, QuotaExceededError, SpendCapExceededError } from '../../services/entitlements/usageGateError'

describe('formatError — usage gate', () => {
  it('quota_exceeded muestra copy de cupo diario, no texto crudo del servidor', () => {
    const message = formatError(new QuotaExceededError({ bucketId: 'chat', limit: 15, remaining: 0 }))
    expect(message).not.toContain('quota_exceeded')
    expect(message.length).toBeGreaterThan(0)
  })

  it('spend_cap_exceeded muestra copy de presupuesto del servicio', () => {
    const message = formatError(new SpendCapExceededError({ scope: 'global', capUsd: 5 }))
    expect(message).not.toContain('spend_cap_exceeded')
  })

  it('kill_switch_active muestra copy de pausa operativa', () => {
    const message = formatError(new KillSwitchActiveError())
    expect(message).not.toContain('kill_switch_active')
  })
})
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `npx vitest run src/store/__tests__/chatUsageGateError.test.ts`
Expected: FAIL (por el `case` inexistente, o por `formatError` no exportada — resolver la exportación primero si hace falta, siguiendo lo que ya haga `chatEntitlementOffer.test.ts` para probar el mismo tipo de función).

- [ ] **Step 3: Implementar**

En `src/store/useChatStore.ts`, dentro de `formatError` (líneas ~955-979),
agregar 3 casos nuevos al `switch (e.code)`, antes del `default`:

```ts
function formatError(e: unknown): string {
  if (e instanceof AIProviderError) {
    switch (e.code) {
      case 'unauthorized': return '...' // sin cambios
      case 'misconfigured': return '...' // sin cambios
      case 'entitlement_required': return 'Esta función está en un plan superior. Mirá los planes disponibles.'
      case 'quota_exceeded': return 'Alcanzaste el cupo diario de esta función. Vuelve a intentarlo mañana.'
      case 'spend_cap_exceeded': return 'El servicio alcanzó su presupuesto diario. Vuelve a intentarlo mañana.'
      case 'kill_switch_active': return 'La IA está temporalmente pausada. Volvé a intentarlo más tarde.'
      case 'rate_limit': /* ...sin cambios... */
      case 'timeout': /* ...sin cambios... */
      case 'parse_error': /* ...sin cambios... */
      default: return `Error de RallyIQ (${e.provider}): ${e.message}`
    }
  }
  // ...resto sin cambios...
}
```

**Confirmar explícitamente:** estos 3 casos usan el camino normal de burbuja
de error de chat (mismo que `rate_limit`/`timeout`), **no** tocan
`entitlementOffer` ni `toChatEntitlementOffer` — así se evita `UpsellCard` sin
ningún cambio estructural adicional. No agregar estos 3 códigos a
`toChatEntitlementOffer`.

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/store/__tests__/chatUsageGateError.test.ts src/store/__tests__/chatEntitlementOffer.test.ts`
Expected: PASS, ambos archivos.

- [ ] **Step 5: Commit**

```bash
git add src/store/useChatStore.ts src/store/__tests__/chatUsageGateError.test.ts
git commit -m "feat(usage-limits): copy especifico de cuota/costo/kill switch en el chat"
```

---

### Task 11: Plan Builder — `PlanEnqueueRejectedError` y `usePlanBuilderStore.ts`

**Files:**
- Modify: `src/services/planBuilder/triggerBackgroundGeneration.ts`
- Modify: `src/store/usePlanBuilderStore.ts`
- Test: `src/pages/__tests__/planBuilderUsageGateRejection.test.tsx`

**Interfaces:**
- Produces: `PlanEnqueueRejectedError` gana un campo `usageRejection?: { errorCode: 'quota_exceeded' | 'spend_cap_exceeded' | 'kill_switch_active'; detail?: unknown }`, distinto de `entitlement`.

- [ ] **Step 1: Escribir el test que falla**

```tsx
// src/pages/__tests__/planBuilderUsageGateRejection.test.tsx
import { describe, expect, it, vi } from 'vitest'
// NOTA: seguir exactamente el patrón de setup de
// planBuilderEntitlementOffer.test.tsx (mock de fetch del enqueue, store real,
// render mínimo) — leer ese archivo completo antes de escribir este, no
// inventar un setup paralelo.
import { renderPlanBuilderWithRejectedEnqueue } from './helpers/planBuilderTestHarness'

describe('Plan Builder — rechazo por cuota/costo/kill switch', () => {
  it('quota_exceeded muestra mensaje de cupo, no abre UpsellCard', async () => {
    const { queryByText, findByText } = await renderPlanBuilderWithRejectedEnqueue({
      status: 429,
      body: { error: 'Alcanzaste el cupo diario.', errorCode: 'quota_exceeded', detail: { bucketId: 'plan_builder_week', limit: 12, remaining: 0 } },
    })

    expect(await findByText(/cupo diario/i)).toBeTruthy()
    expect(queryByText(/Ver planes/i)).toBeNull()
  })

  it('spend_cap_exceeded muestra mensaje de presupuesto del servicio, no abre UpsellCard', async () => {
    const { queryByText, findByText } = await renderPlanBuilderWithRejectedEnqueue({
      status: 429,
      body: { error: 'El servicio alcanzó su presupuesto diario.', errorCode: 'spend_cap_exceeded', detail: { scope: 'global', capUsd: 5 } },
    })

    expect(await findByText(/presupuesto/i)).toBeTruthy()
    expect(queryByText(/Ver planes/i)).toBeNull()
  })

  it('kill_switch_active muestra mensaje de pausa operativa, no abre UpsellCard', async () => {
    const { queryByText, findByText } = await renderPlanBuilderWithRejectedEnqueue({
      status: 503,
      body: { error: 'IA pausada.', errorCode: 'kill_switch_active' },
    })

    expect(await findByText(/pausada/i)).toBeTruthy()
    expect(queryByText(/Ver planes/i)).toBeNull()
  })
})
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `npx vitest run src/pages/__tests__/planBuilderUsageGateRejection.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Extender `PlanEnqueueRejectedError`**

**Corrección tras revisión (P2):** el constructor actual tiene
`entitlement: EntitlementRequiredDetail | null = null` **con default**
(confirmado contra el archivo real) — al menos un call site existente lo
invoca con 2 argumentos (`triggerBackgroundGeneration.ts:76`:
`new PlanEnqueueRejectedError(mensaje, 401)`), apoyándose en ese default. La
primera versión de este plan quitaba el `= null` al reescribir la firma, lo
que rompe ese call site en tiempo de compilación. El default se conserva.

En `src/services/planBuilder/triggerBackgroundGeneration.ts:28-43`:
```ts
export class PlanEnqueueRejectedError extends Error {
  readonly statusCode: number
  readonly entitlement: EntitlementRequiredDetail | null
  readonly usageRejection: { errorCode: 'quota_exceeded' | 'spend_cap_exceeded' | 'kill_switch_active'; detail?: unknown } | null

  constructor(
    message: string,
    statusCode: number,
    entitlement: EntitlementRequiredDetail | null = null,   // default preservado — no romper call sites de 2 args
    usageRejection: PlanEnqueueRejectedError['usageRejection'] = null,
  ) {
    super(message)
    this.name = 'PlanEnqueueRejectedError'
    this.statusCode = statusCode
    this.entitlement = entitlement
    this.usageRejection = usageRejection
  }
}
```

Después de este cambio, correr
`grep -n "new PlanEnqueueRejectedError" src/services/planBuilder/triggerBackgroundGeneration.ts`
y confirmar que los 5 call sites existentes (líneas ~68, 76, 80, 93, 121 antes
de esta edición) siguen compilando sin tocarlos — ninguno necesita el 4º
argumento nuevo, todos deben seguir pasando como antes.

Y en su construcción (líneas 113-126):
```ts
if (!response.ok) {
  const entitlement = response.status === 403
    && result.errorCode === 'entitlement_required'
    && isEntitlementRequiredDetail(result.detail)
    ? result.detail
    : null
  const usageRejection = (
    result.errorCode === 'quota_exceeded'
    || result.errorCode === 'spend_cap_exceeded'
    || result.errorCode === 'kill_switch_active'
  )
    ? { errorCode: result.errorCode, detail: result.detail }
    : null
  throw new PlanEnqueueRejectedError(
    result.error ?? `No se pudo iniciar la generación async (${response.status}).`,
    response.status,
    entitlement,
    usageRejection,
  )
}
```

- [ ] **Step 4: `usePlanBuilderStore.ts` — copy específico sin abrir `UpsellCard`**

En los 3 puntos donde hoy se chequea `error instanceof PlanEnqueueRejectedError && error.entitlement`
(líneas ~697, ~852, ~981), agregar una rama hermana ANTES de la genérica de
`markGenerationStartRejected`:

```ts
const USAGE_REJECTION_COPY: Record<'quota_exceeded' | 'spend_cap_exceeded' | 'kill_switch_active', string> = {
  quota_exceeded: 'Alcanzaste el cupo diario de Plan Builder. Vuelve a intentarlo mañana.',
  spend_cap_exceeded: 'El servicio alcanzó su presupuesto diario. Vuelve a intentarlo mañana.',
  kill_switch_active: 'La IA está temporalmente pausada. Volvé a intentarlo más tarde.',
}

if (error instanceof PlanEnqueueRejectedError && error.entitlement) {
  // ...bloque existente sin cambios...
  return
}
if (error instanceof PlanEnqueueRejectedError && error.usageRejection) {
  const message = USAGE_REJECTION_COPY[error.usageRejection.errorCode]
  await markGenerationStartRejected({ plan: nextPlan, message /* ...resto de campos igual que el camino genérico... */ })
  return
}
if (error instanceof PlanEnqueueRejectedError || !remotePlanPublished) {
  // ...bloque genérico existente sin cambios...
}
```

**Nota para el implementador:** confirmar la firma exacta de
`markGenerationStartRejected` (¿acepta `message` como parámetro, o construye
el mensaje internamente a partir de `error`?) leyendo su definición completa
antes de este paso — si no acepta un mensaje custom, extenderla para
aceptarlo opcionalmente en vez de forzar el mensaje genérico de servidor.

- [ ] **Step 5: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/pages/__tests__/planBuilderUsageGateRejection.test.tsx src/pages/__tests__/planBuilderEntitlementOffer.test.tsx`
Expected: PASS, ambos archivos.

- [ ] **Step 6: Commit**

```bash
git add src/services/planBuilder/triggerBackgroundGeneration.ts src/store/usePlanBuilderStore.ts src/pages/__tests__/planBuilderUsageGateRejection.test.tsx
git commit -m "feat(usage-limits): Plan Builder muestra copy de cuota/costo sin UpsellCard"
```

---

### Task 12: Comentario aclaratorio en las reservas locales de Plan Builder

**Files:**
- Modify: `src/services/planBuilder/rateLimit.ts`

**Interfaces:**
- No cambia comportamiento — solo documentación inline.

- [ ] **Step 1: Agregar el comentario**

Encima de `releasePlanBuilderWeekReservations` (línea 86):
```ts
/**
 * Reserva/liberación local, solo para UX y para el snapshot de calidad del
 * cliente (Ajustes → Diagnóstico IA). No tiene efecto sobre la cuota real:
 * la autoridad server-side vive en `ai_usage_daily` y se consume vía
 * `assertUsageGate` (netlify/functions/_shared/usageGate.ts), inmediatamente
 * antes de cada llamada real al proveedor. Borrar IndexedDB reinicia este
 * indicador local, pero nunca recupera cupo real.
 */
export async function releasePlanBuilderWeekReservations(...
```

- [ ] **Step 2: Confirmar que no rompiste nada**

Run: `npx vitest run src/services/planBuilder/__tests__/rateLimit.test.ts`
Expected: PASS (sin cambios de comportamiento, solo comentario).

- [ ] **Step 3: Commit**

```bash
git add src/services/planBuilder/rateLimit.ts
git commit -m "docs(usage-limits): aclarar que las reservas locales de Plan Builder no son la autoridad real"
```

---

### Task 13: Verificación completa y rollout

**Files:**
- Ninguno nuevo — verificación end-to-end del bloque completo.

- [ ] **Step 1: Suite completa**

Run: `npm run lint && npx vitest run && npx tsc -b && npm run build && git diff --check`
Expected: todo verde. Si algo falla, es un problema de integración entre
tasks — no cerrar el bloque hasta que pase completo.

- [ ] **Step 2: Confirmar cobertura contra el spec §9 (no negociables)**

Repasar la lista de "No negociables" en
`docs/superpowers/specs/2026-08-16-ai-usage-rate-limits-design.md#9-verificación-automatizada`
uno por uno contra los tests escritos en las Tasks 2-11. Cualquier ítem sin
test correspondiente se agrega antes de seguir.

- [ ] **Step 3: Rollout — aplicar la migración manualmente**

Aplicar `supabase/021_ai_usage_daily.sql` en el SQL editor de Supabase de
producción (después de confirmar el nombre real del constraint, Task 1 Step
1). Confirmar con service role que las **3** funciones RPC existen
(`increment_ai_usage_if_under_limit`, `read_ai_usage_spend`,
`increment_ai_usage_cost` — corregido tras revisión, P3 ronda 4: quedaban
solo 2 mencionadas acá, desactualizado desde que Task 1 agregó la tercera
para el fix del P0 de costo) y que un usuario autenticado normal NO puede
ejecutar ninguna de las tres ni escribir en `ai_usage_daily` de ninguna
forma (`INSERT` vía upsert de la primera RPC, `UPDATE` vía la tercera):
```sql
select has_function_privilege('authenticated', 'public.increment_ai_usage_if_under_limit(uuid,text,integer)', 'execute'); -- debe ser false
select has_function_privilege('authenticated', 'public.read_ai_usage_spend(uuid)', 'execute'); -- debe ser false
select has_function_privilege('authenticated', 'public.increment_ai_usage_cost(uuid,text,date,numeric)', 'execute'); -- debe ser false
select has_table_privilege('authenticated', 'public.ai_usage_daily', 'insert'); -- debe ser false
select has_table_privilege('authenticated', 'public.ai_usage_daily', 'update'); -- debe ser false
```

- [ ] **Step 4: Desplegar con ambas flags apagadas**

`AI_USAGE_LIMITS_ENABLED=false`, `AI_KILL_SWITCH_ENABLED=false` en Netlify.
Confirmar que el comportamiento observable no cambió (mismo smoke que
cualquier deploy — chat, week creator, un plan builder chico).

- [ ] **Step 5: Encender `AI_USAGE_LIMITS_ENABLED` y hacer el smoke dirigido**

Con una cuenta de prueba, bajar temporalmente el límite de un bucket (o
generar tráfico suficiente) para forzar un `429 quota_exceeded` real en
`coach.ts`, en el enqueue y en el worker. Confirmar `errorCode`/`detail`
correctos en los 3, y que un job de Plan Builder cortado a mitad de camino
queda con `outcome: 'quota_exhausted'` en `plan_generation_jobs` (no
`generating` colgado).

- [ ] **Step 6: Confirmar que el costo se acumula en la fila correcta**

Generar una request real, confirmar en `ai_usage_daily` que
`estimated_cost_usd` subió en la misma fila `(user_id, usage_date, bucket_id)`
que incrementó `request_count`.

- [ ] **Step 7: Dejar el kill switch documentado y probado, pero apagado**

Confirmar en un ambiente de prueba que `AI_KILL_SWITCH_ENABLED=true` corta
las 3 funciones antes de tocar el proveedor, después volver a `false` en
producción. Documentar en el roadmap que el kill switch está listo para un
incidente real.

- [ ] **Step 8: Actualizar `PROJECT_REVIEW_AND_ROADMAP.md`**

Marcar los Puntos 3 y 4 del Pre-Lanzamiento como implementados con rollout
cerrado (siguiendo el mismo formato que usó el cierre del Punto 2 de
entitlements), incluyendo la cifra de tests final de `npx vitest run`.

---

## Self-Review

**Cobertura del spec:** §3 (modelo de datos) → Task 1. §4 (política/flags) →
Tasks 2, 4. §5 (puntos de inyección) → Tasks 5, 6, 7, 8. §6 (contrato de
error) → Tasks 3, 5, 9. §7 (cliente) → Tasks 3, 9, 10, 11, 12. §8 (rollout) →
Task 13. §9 (testing) → verificado explícitamente en Task 13 Step 2. §10/§11
(límites conocidos / fuera de alcance) no requieren tasks — son restricciones
del diseño, no entregables.

**Huecos honestos dejados a propósito, no placeholders ocultos:** Task 5
Step 1 y Task 8 Step 3 piden verificar nombres de campo exactos de
`invokeProvider`/`callAnthropicForWeek` antes de escribir el cálculo de costo
— no tenía el tipo exacto confirmado por la exploración y prefiero que el
implementador lo verifique contra el código real en vez de que yo invente
nombres plausibles. Task 7 Step 1 y Step 6 tienen la misma naturaleza para la
firma de `RunAsyncPlanGenerationInput` y `makeErroredWeek`. Estos son pasos de
verificación concretos y accionables, no instrucciones vagas.

**Ronda de revisión (2026-08-16):** una revisión del owner encontró 9 huecos
reales antes de aprobar, todos corregidos inline en el plan (no en un
changelog aparte — el contenido de cada task ya refleja el fix):

1. **P0** `recordUsageCost` sobrescribía en vez de sumar (todas las requests
   de un bucket comparten fila diaria) → RPC atómica `increment_ai_usage_cost`
   nueva (Task 1, Task 4).
2. **P1** El loop no reconocía los errores server-shaped del gate
   (`.errorCode` vs `.code`/`instanceof`) → adaptador explícito en
   `gatedCallLLM` (Task 8), en vez de unificar los dos shapes ya establecidos
   en el codebase (`XHttpError` servidor / `XError extends AIProviderError`
   cliente — mismo split que ya usa entitlements).
3. **P1** Los 3 tipos de rechazo se etiquetaban todos como `quota_exhausted`
   → solo `QuotaExceededError` produce ese outcome; spend cap/kill switch
   producen `'failed'`, literal como pide el spec §5.3 (Task 7).
4. **P1** El cableado de `coach.ts` no compilaba (`auth`/`currentTier`
   usados fuera de su scope de `try`) y saltaba la cuota para clases
   weekly/advanced con entitlements apagado → hoisting + tier neutro `'advanced'`
   (Task 5).
5. **P1** `callRpc`/el preflight fallaban abierto ante respuestas ilegibles o
   vacías → validación estricta de forma + fail-closed (`503 server_error`)
   en `readSpend`/`checkUsagePreflight` (Task 4).
6. **P1** `detail` no llegaba al cliente desde `coach.ts` (ni streaming ni
   JSON omiten el campo en su serialización real) → agregado explícitamente
   en ambos transportes (Task 5).
7. **P2** `void recordUsageCost(...)` fire-and-forget, riesgo real en
   serverless → `await` en los 2 call sites (Task 5, Task 8).
8. **P2** Test de Task 8 mockeaba `terminalizeRejectedJob` desde el módulo
   equivocado (es local, no exportado de `_shared/planGenerationShared`) y
   usaba un `makeError` inexistente en ese archivo; `PlanEnqueueRejectedError`
   perdía el default `= null` de `entitlement`, rompiendo un call site de 2
   argumentos → los 3 corregidos (Task 8, Task 11).
9. **P2** El kill switch se chequeaba antes de `resolveAuthContext` en Tasks
   5/6, violando el propio orden declarado del plan → movido a después del
   `Promise.all` de auth en ambas (Task 5, Task 6).

También se corrigió el `Goal`: este bloque no reemplaza `enforceRateLimit`
(rate limit de ráfaga en memoria, `coach.ts`) — lo conserva y agrega la cuota
diaria durable como capa adicional.

**Ronda de revisión 2 (2026-08-16):** una segunda pasada encontró 7 huecos
más, todos corregidos inline:

1. **P1** Errores de red/abort/JSON malformado en `callRpc` (y en el fetch
   directo de `checkUsagePreflight`) escapaban crudos, sin `.statusCode`/
   `.errorCode` — el worker los trataba como fallo del proveedor y disparaba
   retry inútil → `callRpc` envuelve fetch y `.json()` en try/catch,
   convierte todo a `server_error` (Task 4). Se agregó `UsageGateUnavailableError`
   (Task 3) para que el loop reconozca también esta cuarta causa —
   `isUsageGateRejection` y `finalizeJob` la tratan como `usageGateFailed`
   (outcome `'failed'`, igual que spend cap/kill switch) (Task 7). El
   adaptador `translateUsageGateError` ya no deja pasar `server_error` sin
   traducir (Task 8).
2. **P1** En `coach.ts`, `assertUsageGate` se llamaba antes de
   `computeAttemptTimeoutMs`/crear el `AbortController` — si el RPC del gate
   tardaba, se consumía cuota sin margen real para llegar al proveedor →
   movido a ser literalmente lo último antes de `invokeProvider`, dentro del
   `try` (Task 5).
3. **P1** El test del adaptador de Task 8 solo comprobaba que
   `QuotaExceededError` estaba exportado — pasaría aunque `gatedCallLLM` no
   tradujera nada → `translateUsageGateError` se extrae a
   `netlify/functions/_shared/translateUsageGateError.ts`, módulo puro con 4
   tests reales que ejercitan la traducción completa (Task 8, Step 2b).
4. **P2** El transporte streaming de chat (`ProxyProvider.ts`) no declaraba
   `detail` en el evento parseado ni construía las clases tipadas — un
   `quota_exceeded` en streaming caía siempre a `AIProviderError` genérico →
   agregado `detail` al tipo del evento y los 3 casos, reusando los mismos
   type guards que `classifyProxyHttpError` (Task 9, Step 5). Se documentó
   como fuera de alcance el mismo gap preexistente para `entitlement_required`.
5. **P2** `recordUsageCost` ignoraba el resultado de la RPC de costo — un
   `UPDATE` que afecta 0 filas (fila inexistente, bug de otra parte) parecía
   éxito. El incremento de cuota tampoco exigía cardinalidad exacta ni
   validaba `request_count` → ambos ahora validan filas/valores antes de
   aceptar la respuesta (Task 4).
6. **P2** El cálculo de costo usaba `?? 0` para `promptTokens`/`completionTokens`,
   colapsando "el proveedor no reportó usage" con "0 tokens reales" — nunca
   se emitía el warning que pide el spec §3.3 para usage o precio
   desconocido → `recordCostIfKnown` (nueva función módulo-nivel, Task 5 y
   Task 8) solo estima cuando ambos campos están genuinamente presentes, y
   loguea una advertencia distinta para "sin usage" vs "sin precio cargado".
   `cacheReadTokens`/`cacheCreationTokens` conservan `?? 0` porque su
   ausencia sí es genuinamente cero para modelos sin caching.
7. **P3** El comentario de la migración decía que `quota_exhausted` cubre
   "cuota diaria o techo de gasto" — contradice el fix de la Task 7 de la
   ronda 1 (spend cap → `'failed'`) → corregido para mencionar solo cuota
   diaria (Task 1).

**Ronda de revisión 3 (2026-08-16):** una tercera pasada, ahora contra el
código real (no solo el propio plan), encontró 7 huecos más:

1. **P1** Los imports de `netlify/functions/_shared/translateUsageGateError.ts`
   y su test usaban `../../src/...` — desde `_shared/`/`__tests__/` hacen
   falta 3 niveles hasta la raíz del repo, no 2; `../../src` apunta a
   `netlify/src`, que no existe → corregido a `../../../src/...` en ambos
   (Task 8). Los imports de `coach.ts`/`generate-plan-background.ts` mismos
   (directamente en `netlify/functions/`, no en `_shared/`) sí usan
   correctamente `../../src/...` — 2 niveles es lo correcto para esa
   profundidad; no se tocaron.
2. **P1** El gate seguía pudiendo consumir cuota sin que el proveedor
   recibiera nada: en `coach.ts` el timeout del intento se armaba antes del
   gate (el reloj corría mientras el RPC del gate, hasta 3s, seguía en
   vuelo), y tanto `invokeProvider` como `callAnthropicForWeek` resuelven
   modelo/API key recién en su propio cuerpo, después del gate → `coach.ts`
   ahora resuelve `resolveModel`/`resolveApiKey` antes del gate y arma el
   timeout recién después de que el gate acepta (Task 5); `generate-plan-background.ts`
   valida `CLAUDE_API_KEY`/modelo/directivas antes del gate en `gatedCallLLM`
   (Task 8) — sin necesidad de reordenar timeout ahí, porque
   `callAnthropicForWeek` arma el suyo internamente, ya después del gate por
   construcción.
3. **P1** El test de streaming usaba `provider.complete(...)`, un método que
   no existe — `ProxyProvider` expone `call` (confirmado contra
   `ProxyProvider.ts:31`) → corregido (Task 9).
4. **P2** `translateUsageGateError` forzaba `error.detail as QuotaExceededDetail`/
   `as SpendCapExceededDetail` sin validar la forma real — un `detail`
   corrupto se aceptaba igual como rechazo de política "válido" → ahora usa
   los mismos type guards que `classifyProxyHttpError`; un detail que no
   calza con su `errorCode` se trata como `UsageGateUnavailableError`, no
   como cuota/costo corrupto (Task 8, con 2 tests nuevos para el caso
   malformado).
5. **P2** `recordUsageCost` validaba cardinalidad (1 fila) pero no el
   contenido — una fila con `estimated_cost_usd` ausente, negativo o no
   numérico contaba como éxito silencioso → se valida el campo con
   `isFiniteNonNegative` antes de aceptar la respuesta como confirmada
   (Task 4).
6. **P2** Task 11 anunciaba cobertura de cuota/costo/kill switch pero solo
   tenía tests de cuota y kill switch — faltaba el caso `spend_cap_exceeded`
   → agregado (Task 11).
7. **P3** Quedó un fence ` ```ts ` huérfano de cuando la ronda 2 partió un
   bloque de código en dos (la función módulo-nivel de costo + el bloque de
   `executeWithPolicy`) sin limpiar la apertura vieja — 109 fences totales,
   desbalanceado, corrompía el render del resto del documento → eliminado el
   fragmento sobrante; 108 fences, balanceado (Task 5).

**Ronda de revisión 4 (2026-08-16):** una cuarta pasada, ahora leyendo
`coach.ts:1388-1465` completo en vez de trabajar sobre fragmentos, encontró 7
huecos más:

1. **P1** La ronda 3 movió la LLAMADA al gate antes de
   `computeAttemptTimeoutMs` — pero esa función también puede lanzar
   (`504 timeout` si se agotó el presupuesto de wallclock, `coach.ts:567-571`),
   así que el mismo bug de "cuota consumida sin request real" reapareció en
   otro punto. Fix correcto: `computeAttemptTimeoutMs` vuelve a su posición
   original (antes del `try`, antes del gate); solo `armTimeout` (el timer
   real) se mueve a después del gate (Task 5).
2. **P1** Ese reordenamiento rompía el scope de `attemptStartedAt`, que el
   código real usa en dos roles — telemetría (`durationMs`) y matemática de
   `extendTimeoutForStreaming` — con requisitos de timing distintos. Se separó
   en `attemptStartedAt` (arranca al principio del intento, para telemetría)
   y `providerStartedAt` (arranca después del gate, para
   `extendTimeoutForStreaming`) (Task 5).
3. **P2** `UsageGateUnavailableError` no tenía ningún test de integración en
   el loop — Task 7 la reconoce pero el test file no la importaba ni la
   ejercitaba → agregado un test confirmando un solo intento, cero fallback y
   outcome `failed` (Task 7).
4. **P2** La garantía de "config antes del gate" se había dejado como nota de
   "no fácilmente testeable" — incorrecto: `resolveApiKey`/`CLAUDE_API_KEY`
   leen `process.env` directamente, así que borrar la env var
   temporalmente (con restauración en `finally`) es un test real y directo →
   agregado en Task 5 (`GEMINI_API_KEY`, la que usa `chat_general`) y Task 8
   (`CLAUDE_API_KEY`).
5. **P3** Task 3 afirmaba que `classifyProxyHttpError` usa
   `UsageGateUnavailableError` — falso, esa clase solo la construye
   `translateUsageGateError` del lado del worker → corregido, con la
   distinción explícita de por qué el cliente del navegador no necesita
   construirla.
6. **P3** Task 13 seguía hablando de "las 2 funciones RPC" y solo verificaba
   permisos de `execute` de una función más `INSERT` en la tabla — desde el
   fix del P0 de costo (ronda 1) hay 3 funciones, y la tercera hace `UPDATE`,
   no `INSERT` → corregido a las 3 funciones + verificación de `UPDATE`.
7. **P3** Task 4 anunciaba "PASS (23 tests)" sin contar realmente los `it(...)`
   del bloque — son 20 → corregido a la cifra contada directamente contra el
   texto.

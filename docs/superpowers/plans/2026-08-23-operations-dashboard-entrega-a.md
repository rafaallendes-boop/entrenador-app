# Dashboard de operación (Entrega A) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una vista privada `/ops`, accesible sólo por los UUID listados en
`OPERATIONS_ADMIN_USER_IDS`, que responde en una pantalla cuánta actividad,
cuántos errores, cuánta latencia y cuánto costo hubo en 24 h y 7 días, agregando
la telemetría que ya está en producción.

**Architecture:** Toda la agregación ocurre en Postgres, dentro de un RPC
`security definer` que sólo `service_role` puede ejecutar y que devuelve
únicamente agregados — nunca filas ni `user_id`. Una función Netlify autentica,
autoriza contra una env server-only y reenvía ese JSON. La página es una
consumidora tonta: no tiene guard propio y trata el `403` como un estado.

**Tech Stack:** Supabase/Postgres (plpgsql, `security definer`), Netlify
Functions (TypeScript, `@netlify/functions`), React + React Router + Zustand,
Vitest.

**Spec:** [`docs/superpowers/specs/2026-08-23-operations-dashboard-and-client-errors-design.md`](../specs/2026-08-23-operations-dashboard-and-client-errors-design.md)

## Global Constraints

- **Las migraciones son de aplicación manual.** Escribir el `.sql` no es
  aplicarlo. Ninguna tarea asume que `022` corrió en producción.
- **El RPC devuelve sólo agregados.** Ninguna consulta de este plan selecciona
  `user_id`, texto de usuario ni filas individuales. `count(distinct user_id)`
  sí; `select user_id` no.
- **`OPERATIONS_ADMIN_USER_IDS` es server-only.** Nunca `VITE_*`. Nunca emails.
  Precedente a no repetir: `VITE_COACH_ACCOUNTS`.
- **Fail-closed en autorización:** env ausente, vacía o ilegible ⇒ **nadie** es
  admin. Nunca "si no hay lista, pasa cualquiera".
- **`estimated_cost_usd = null` no es cero.** Toda suma de costo excluye nulls y
  reporta cobertura en dos dimensiones: filas y tokens.
- **Ninguna métrica se llama "usuarios activos".** Los nombres son
  `accountsUsingAi` / "Cuentas con uso de IA" y `accountsPlanning` / "Cuentas con
  planificación" (spec §3 D2).
- **Percentiles p50, p90 y p95.** El p90 se conserva porque es la medida de la
  línea base en `OPTIMIZATION_AND_COSTS.md`.
- Copy visible en español, tuteo, sin jerga técnica innecesaria.
- Antes de cada commit: `npm run lint && npm test && npm run build`.
- Los commits los hace el owner. Las tareas dejan el árbol listo y verificado;
  el paso "Commit" se ejecuta sólo si el owner lo pide explícitamente.

## Estado real de las migraciones previas (verificado 2026-08-23)

`020_user_entitlements.sql` y `021_ai_usage_daily.sql` **están aplicadas en
producción**. Verificado contra el REST de producción con la anon key: una tabla
inexistente devuelve `PGRST205 "Could not find the table"`, mientras que
`user_entitlements` y `ai_usage_daily` devuelven `42501 permission denied` —
error que Postgres sólo emite para una relación que existe. Ese `permission
denied` para `anon` es además exactamente lo que produce el
`revoke all from anon, authenticated` de `021`, así que la migración está
aplicada tal como está escrita.

**`PROJECT_REVIEW_AND_ROADMAP.md` está desactualizado en este punto** (§Pre-Lanzamiento
puntos 2, 3 y 4 los dan por "pendiente rollout"). Corregirlo es trabajo aparte de
este plan, pero hay que hacerlo: son tres blockers P0 cuyo estado declarado no
coincide con producción.

**Consecuencia para este plan:** el bloque de cuotas del panel debe mostrar
**datos o ceros**, no "sin datos". Y ojo con la diferencia, porque se leen
distinto:

| Lo que muestra el panel | Qué significa |
|---|---|
| `sin datos` | La tabla no existe. Hoy **no debería pasar** en producción |
| `0` | La tabla existe y no hay uso registrado en la ventana — esperable mientras `AI_USAGE_LIMITS_ENABLED` siga apagada, porque nadie escribe filas |
| Un número | Hay uso registrado |

## Decisión de diseño: `to_regclass` se conserva, con otra justificación

El fallback dinámico con `to_regclass` + `execute` se escribió originalmente
para no bloquear la Entrega A detrás del rollout de `021`. **Esa justificación
ya no aplica**, porque `021` está aplicada.

Se conserva igual, y conviene decir por qué de verdad: cuesta nada, y cubre un
entorno de desarrollo o un proyecto Supabase nuevo donde `021` no esté aplicada
— ahí un `create function` con referencia estática fallaría al crearse y dejaría
el RPC entero sin instalar, no sólo el bloque de cuotas. Es seguro por
construcción: el texto del `execute` es una constante literal y el único valor
variable entra por `using`, así que no hay superficie de inyección.

---

### Task 1: Contrato compartido de métricas

Una sola declaración de la forma del JSON, importable por la función Netlify y
por el cliente. Vive en `src/` —no en `netlify/`— por el mismo motivo que
`WHOOP_WORKOUT_ZONE_COLUMNS`: el cliente la importa sin arrastrar código de
Functions al bundle.

**Files:**
- Create: `src/services/operations/operationsMetricsContract.ts`
- Test: `src/services/operations/__tests__/operationsMetricsContract.test.ts`

**Corrección aplicada durante la ejecución (2026-08-23):** la primera versión de
`isRecord` no rechazaba arrays, así que `isNumberMap` validaba `byOutcome: [6, 2]`
como si fuera un objeto. Detectado por la revisión de tarea y corregido; el plan
ya refleja la versión correcta.

**Interfaces:**
- Consumes: nada.
- Produces: `OPERATIONS_METRIC_KEYS`, tipos `CostCoverage`, `ActivityBlock`,
  `CoachBlock`, `PlanBuilderBlock`, `AttemptsBlock`, `QuotaBlock`,
  `OperationsWindow`, `OperationsMetrics`; type guard
  `isOperationsWindow(value: unknown): value is OperationsWindow`.

- [ ] **Step 1: Write the failing test**

```ts
// src/services/operations/__tests__/operationsMetricsContract.test.ts
import { describe, expect, it } from 'vitest'
import {
  OPERATIONS_METRIC_KEYS,
  isOperationsWindow,
} from '../operationsMetricsContract'

const VALID = {
  activity: { accountsUsingAi: 3, accountsPlanning: 1 },
  coach: {
    requests: 10,
    errors: 2,
    topErrorCodes: [{ code: 'timeout', count: 2 }],
    latencyP50: 900,
    latencyP90: 2100,
    latencyP95: 3000,
    costUsd: 0.12,
    coverage: { rowsTotal: 10, rowsWithCost: 8, tokensTotal: 5000, tokensWithCost: 4200 },
  },
  planBuilder: {
    runs: 2,
    byOutcome: { succeeded: 2 },
    firstWeekP50: 14000, firstWeekP90: 20000, firstWeekP95: 22000,
    completeP50: 31000, completeP90: 40000, completeP95: 44000,
    costUsd: 0.23,
    coverage: { rowsTotal: 2, rowsWithCost: 2, tokensTotal: 900, tokensWithCost: 900 },
  },
  attempts: { total: 8, byOutcome: { succeeded: 6, truncated: 2 } },
  quota: null,
}

describe('operationsMetricsContract', () => {
  it('acepta una ventana completa', () => {
    expect(isOperationsWindow(VALID)).toBe(true)
  })

  it('acepta quota poblada, que es el estado de produccion', () => {
    const withQuota = {
      ...VALID,
      quota: {
        startDate: '2026-08-22',
        requests: 42,
        costUsd: 0.51,
        byBucket: { chat: 30, plan_builder_week: 12 },
      },
    }
    expect(isOperationsWindow(withQuota)).toBe(true)
  })

  it('acepta quota null: entornos sin 021 aplicada', () => {
    expect(isOperationsWindow({ ...VALID, quota: null })).toBe(true)
  })

  it('rechaza quota con byBucket no numerico', () => {
    const broken = {
      ...VALID,
      quota: { startDate: '2026-08-22', requests: 1, costUsd: 0, byBucket: { chat: 'muchos' } },
    }
    expect(isOperationsWindow(broken)).toBe(false)
  })

  it('rechaza un bloque de actividad ausente', () => {
    const { activity: _omitted, ...rest } = VALID
    expect(isOperationsWindow(rest)).toBe(false)
  })

  it('rechaza cobertura incompleta: sin cobertura el costo miente', () => {
    const broken = { ...VALID, coach: { ...VALID.coach, coverage: { rowsTotal: 10 } } }
    expect(isOperationsWindow(broken)).toBe(false)
  })

  it('rechaza valores no numericos', () => {
    const broken = { ...VALID, activity: { accountsUsingAi: '3', accountsPlanning: 1 } }
    expect(isOperationsWindow(broken)).toBe(false)
  })

  it('las claves del contrato estan congeladas', () => {
    expect([...OPERATIONS_METRIC_KEYS]).toEqual([
      'activity', 'coach', 'planBuilder', 'attempts', 'quota',
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/operations/__tests__/operationsMetricsContract.test.ts`
Expected: FAIL — "Failed to resolve import ../operationsMetricsContract".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/services/operations/operationsMetricsContract.ts

/**
 * Forma del JSON que devuelve el RPC `read_operations_metrics`.
 *
 * Una sola declaracion compartida por la funcion Netlify y el cliente: si el
 * RPC cambia y esto no, el type guard falla en tests antes de llegar a la UI.
 * Vive en `src/` para que el cliente la importe sin arrastrar codigo de
 * Functions al bundle, igual que `WHOOP_WORKOUT_ZONE_COLUMNS`.
 */
export const OPERATIONS_METRIC_KEYS = [
  'activity', 'coach', 'planBuilder', 'attempts', 'quota',
] as const

export type OperationsMetricKey = typeof OPERATIONS_METRIC_KEYS[number]

/**
 * `estimated_cost_usd = null` no es cero. Sin estas cuatro cifras un total de
 * costo no se puede interpretar: las requests caras suelen ser pocas, asi que
 * la cobertura en filas puede ser alta y la de tokens baja al mismo tiempo.
 */
export interface CostCoverage {
  rowsTotal: number
  rowsWithCost: number
  tokensTotal: number
  tokensWithCost: number
}

export interface ActivityBlock {
  /** Cuentas distintas con al menos una request de IA. NO es "usuarios activos". */
  accountsUsingAi: number
  /** Cuentas distintas con al menos una corrida de Plan Builder. */
  accountsPlanning: number
}

export interface ErrorCodeCount {
  code: string
  count: number
}

export interface CoachBlock {
  requests: number
  errors: number
  topErrorCodes: ErrorCodeCount[]
  latencyP50: number | null
  latencyP90: number | null
  latencyP95: number | null
  costUsd: number
  coverage: CostCoverage
}

export interface PlanBuilderBlock {
  runs: number
  byOutcome: Record<string, number>
  firstWeekP50: number | null
  firstWeekP90: number | null
  firstWeekP95: number | null
  completeP50: number | null
  completeP90: number | null
  completeP95: number | null
  costUsd: number
  coverage: CostCoverage
}

export interface AttemptsBlock {
  total: number
  byOutcome: Record<string, number>
}

export interface QuotaBlock {
  /** Límite inferior inclusivo, en días calendario; no es una ventana móvil. */
  startDate: string
  requests: number
  costUsd: number
  byBucket: Record<string, number>
}

export interface OperationsWindow {
  activity: ActivityBlock
  coach: CoachBlock
  planBuilder: PlanBuilderBlock
  attempts: AttemptsBlock
  /**
   * `null` SOLO cuando `ai_usage_daily` no existe. En producción no debería
   * ocurrir: `021` está aplicada. Sin uso registrado el bloque llega con ceros,
   * que es distinto y la UI los distingue.
   */
  quota: QuotaBlock | null
}

export interface OperationsMetrics {
  last24h: OperationsWindow
  last7d: OperationsWindow
  generatedAt: string
}

/**
 * Rechaza arrays a propósito: `typeof [] === 'object'`, así que sin el
 * `!Array.isArray` un `byOutcome: [6, 2]` pasaría como si fuera
 * `{ succeeded: 6, truncated: 2 }` — y el trabajo de este contrato es
 * justamente impedir que una forma inesperada llegue a la UI.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableNumber(value: unknown): boolean {
  return value === null || isFiniteNumber(value)
}

function isNumberMap(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(isFiniteNumber)
}

function isCoverage(value: unknown): value is CostCoverage {
  return isRecord(value)
    && isFiniteNumber(value['rowsTotal'])
    && isFiniteNumber(value['rowsWithCost'])
    && isFiniteNumber(value['tokensTotal'])
    && isFiniteNumber(value['tokensWithCost'])
}

export function isOperationsWindow(value: unknown): value is OperationsWindow {
  if (!isRecord(value)) return false

  const activity = value['activity']
  if (!isRecord(activity)
    || !isFiniteNumber(activity['accountsUsingAi'])
    || !isFiniteNumber(activity['accountsPlanning'])) return false

  const coach = value['coach']
  if (!isRecord(coach)
    || !isFiniteNumber(coach['requests'])
    || !isFiniteNumber(coach['errors'])
    || !Array.isArray(coach['topErrorCodes'])
    || !coach['topErrorCodes'].every((entry) => isRecord(entry)
      && typeof entry['code'] === 'string'
      && isFiniteNumber(entry['count']))
    || !isNullableNumber(coach['latencyP50'])
    || !isNullableNumber(coach['latencyP90'])
    || !isNullableNumber(coach['latencyP95'])
    || !isFiniteNumber(coach['costUsd'])
    || !isCoverage(coach['coverage'])) return false

  const plan = value['planBuilder']
  if (!isRecord(plan)
    || !isFiniteNumber(plan['runs'])
    || !isNumberMap(plan['byOutcome'])
    || !isNullableNumber(plan['firstWeekP50'])
    || !isNullableNumber(plan['firstWeekP90'])
    || !isNullableNumber(plan['firstWeekP95'])
    || !isNullableNumber(plan['completeP50'])
    || !isNullableNumber(plan['completeP90'])
    || !isNullableNumber(plan['completeP95'])
    || !isFiniteNumber(plan['costUsd'])
    || !isCoverage(plan['coverage'])) return false

  const attempts = value['attempts']
  if (!isRecord(attempts)
    || !isFiniteNumber(attempts['total'])
    || !isNumberMap(attempts['byOutcome'])) return false

  const quota = value['quota']
  if (quota !== null) {
    if (!isRecord(quota)
      || typeof quota['startDate'] !== 'string'
      || quota['startDate'].length === 0
      || !isFiniteNumber(quota['requests'])
      || !isFiniteNumber(quota['costUsd'])
      || !isNumberMap(quota['byBucket'])) return false
  }

  return true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/operations/__tests__/operationsMetricsContract.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Verify and hand off**

Run: `npm run lint && npx tsc -b`
Expected: sin errores.

---

### Task 2: Migración `022` con el RPC de agregación y su guard de drift

**Files:**
- Create: `supabase/022_operations_metrics.sql`
- Test: `src/services/operations/__tests__/operationsMetricsMigrationGuard.test.ts`

**Corrección aplicada durante la ejecución (2026-08-23):** el guard extraía el
bloque de plan con `SQL.indexOf('into v_plan')`, que matcheaba antes contra la
variable intermedia `into v_plan_outcomes` y dejaba vacías —y por lo tanto
vacuas— las dos aserciones de columnas de tokens. Se renombró esa variable a
`v_run_outcomes`. Deuda registrada: el `indexOf` sigue sin anclaje.

**Interfaces:**
- Consumes: `OPERATIONS_METRIC_KEYS` (Task 1).
- Produces: RPC `public.read_operations_metrics(p_since timestamptz) returns jsonb`,
  ejecutable **sólo** por `service_role`.

- [ ] **Step 1: Write the failing test**

El `.sql` no se puede ejecutar en CI (aplicación manual), así que el guard
verifica sobre el texto las propiedades que, si se rompen, sólo se descubrirían
en producción: que el contrato de claves coincide, que ningún `grant` alcanza a
`authenticated`, y que la tolerancia a `021` ausente sigue ahí.

```ts
// src/services/operations/__tests__/operationsMetricsMigrationGuard.test.ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OPERATIONS_METRIC_KEYS } from '../operationsMetricsContract'

const SQL = readFileSync(
  resolve(process.cwd(), 'supabase/022_operations_metrics.sql'),
  'utf8',
)

describe('022_operations_metrics.sql', () => {
  it('emite cada clave del contrato', () => {
    for (const key of OPERATIONS_METRIC_KEYS) {
      expect(SQL).toContain(`'${key}'`)
    }
  })

  it('el RPC es security definer con search_path fijo', () => {
    expect(SQL).toContain('security definer')
    expect(SQL).toContain('set search_path = public')
  })

  it('revoca a public/anon/authenticated y concede solo a service_role', () => {
    expect(SQL).toMatch(/revoke all on function public\.read_operations_metrics\(timestamptz\)\s*\n?\s*from public, anon, authenticated;/)
    expect(SQL).toMatch(/grant execute on function public\.read_operations_metrics\(timestamptz\)\s*\n?\s*to service_role;/)
  })

  it('ningun grant alcanza a authenticated', () => {
    const grants = SQL.match(/grant [^;]+;/g) ?? []
    expect(grants.some((line) => /\bauthenticated\b/.test(line))).toBe(false)
  })

  it('tolera ai_usage_daily ausente con to_regclass', () => {
    expect(SQL).toContain("to_regclass('public.ai_usage_daily')")
  })

  it('nunca selecciona user_id crudo: solo count(distinct user_id)', () => {
    const selectsRawUserId = /select\s+user_id/i.test(SQL)
    expect(selectsRawUserId).toBe(false)
    expect(SQL).toContain('count(distinct user_id)')
  })

  it('usa las columnas de tokens propias de cada tabla de telemetria', () => {
    const coachStart = SQL.indexOf("'requests', count(*)")
    const coachBlock = SQL.slice(coachStart, SQL.indexOf('into v_coach'))
    expect(coachBlock).toContain('prompt_tokens')
    expect(coachBlock).toContain('completion_tokens')
    expect(coachBlock).not.toMatch(/coalesce\(total_input_tokens/)

    const planStart = SQL.indexOf("'runs', count(*)")
    const planBlock = SQL.slice(planStart, SQL.indexOf('into v_plan'))
    expect(planBlock).toContain('total_input_tokens')
    expect(planBlock).toContain('total_output_tokens')
    expect(planBlock).not.toMatch(/coalesce\(prompt_tokens/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/operations/__tests__/operationsMetricsMigrationGuard.test.ts`
Expected: FAIL — `ENOENT: no such file ... supabase/022_operations_metrics.sql`.

- [ ] **Step 3: Write the migration**

```sql
-- supabase/022_operations_metrics.sql
-- Dashboard de operación (Pre-Lanzamiento punto 10, Entrega A).
-- Ver docs/superpowers/specs/2026-08-23-operations-dashboard-and-client-errors-design.md
-- Aplicación manual, como todas las anteriores.
--
-- Devuelve SOLO agregados. Ninguna consulta de acá selecciona user_id, texto de
-- usuario ni filas individuales: la función Netlify que lo consume nunca debe
-- tener acceso a datos por cuenta, ni aunque alguien la modifique después.

create or replace function public.read_operations_metrics(p_since timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity jsonb;
  v_coach jsonb;
  v_error_codes jsonb;
  v_plan jsonb;
  v_run_outcomes jsonb;
  v_attempts jsonb;
  v_attempt_outcomes jsonb;
  v_quota jsonb := null;
begin
  -- Actividad. Ninguna de las dos es "usuarios activos": ambas salen de
  -- telemetría de IA, así que una cuenta que usa la app sin tocar la IA no
  -- aparece. La UI las nombra por lo que miden.
  select jsonb_build_object(
    'accountsUsingAi', (
      select count(distinct user_id) from public.coach_requests
      where created_at >= p_since
    ),
    'accountsPlanning', (
      select count(distinct user_id) from public.plan_generation_jobs
      where created_at >= p_since
    )
  ) into v_activity;

  select coalesce(
    jsonb_agg(jsonb_build_object('code', code, 'count', c) order by c desc),
    '[]'::jsonb
  ) into v_error_codes
  from (
    select coalesce(error_code, 'sin_codigo') as code, count(*) as c
    from public.coach_requests
    where created_at >= p_since and outcome = 'error'
    group by 1
    order by 2 desc
    limit 5
  ) top_codes;

  -- Costo: excluye nulls y publica cobertura en filas Y tokens. Un null no es
  -- cero, y la cobertura en filas sola engaña porque las requests caras son
  -- pocas.
  select jsonb_build_object(
    'requests', count(*),
    'errors', count(*) filter (where outcome = 'error'),
    'topErrorCodes', v_error_codes,
    'latencyP50', percentile_cont(0.5) within group (order by server_duration_ms),
    'latencyP90', percentile_cont(0.9) within group (order by server_duration_ms),
    'latencyP95', percentile_cont(0.95) within group (order by server_duration_ms),
    'costUsd', coalesce(sum(estimated_cost_usd), 0),
    'coverage', jsonb_build_object(
      'rowsTotal', count(*),
      'rowsWithCost', count(*) filter (where estimated_cost_usd is not null),
      'tokensTotal', coalesce(sum(coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0)), 0),
      'tokensWithCost', coalesce(sum(coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0))
        filter (where estimated_cost_usd is not null), 0)
    )
  ) into v_coach
  from public.coach_requests
  where created_at >= p_since;

  select coalesce(jsonb_object_agg(outcome, c), '{}'::jsonb) into v_run_outcomes
  from (
    select outcome, count(*) as c from public.plan_generation_jobs
    where created_at >= p_since group by 1
  ) o;

  select jsonb_build_object(
    'runs', count(*),
    'byOutcome', v_run_outcomes,
    'firstWeekP50', percentile_cont(0.5) within group (order by first_week_ready_ms),
    'firstWeekP90', percentile_cont(0.9) within group (order by first_week_ready_ms),
    'firstWeekP95', percentile_cont(0.95) within group (order by first_week_ready_ms),
    'completeP50', percentile_cont(0.5) within group (order by plan_complete_ms),
    'completeP90', percentile_cont(0.9) within group (order by plan_complete_ms),
    'completeP95', percentile_cont(0.95) within group (order by plan_complete_ms),
    'costUsd', coalesce(sum(estimated_cost_usd), 0),
    'coverage', jsonb_build_object(
      'rowsTotal', count(*),
      'rowsWithCost', count(*) filter (where estimated_cost_usd is not null),
      -- `plan_generation_jobs` usa total_input_tokens/total_output_tokens;
      -- prompt_tokens/completion_tokens existen sólo en coach_requests.
      'tokensTotal', coalesce(sum(coalesce(total_input_tokens, 0) + coalesce(total_output_tokens, 0)), 0),
      'tokensWithCost', coalesce(sum(coalesce(total_input_tokens, 0) + coalesce(total_output_tokens, 0))
        filter (where estimated_cost_usd is not null), 0)
    )
  ) into v_plan
  from public.plan_generation_jobs
  where created_at >= p_since;

  select coalesce(jsonb_object_agg(outcome, c), '{}'::jsonb) into v_attempt_outcomes
  from (
    select outcome, count(*) as c from public.plan_generation_attempts
    where created_at >= p_since group by 1
  ) a;

  select jsonb_build_object('total', count(*), 'byOutcome', v_attempt_outcomes)
  into v_attempts
  from public.plan_generation_attempts
  where created_at >= p_since;

  -- Granularidad declarada: `ai_usage_daily` guarda por día. Por eso este
  -- bloque publica `startDate`: se agrega desde ese día calendario inclusivo y
  -- la UI nunca debe presentarlo como una ventana móvil exacta de 24 h.
  --
  -- `021` YA está aplicada en producción (verificado 2026-08-23), así que en
  -- producción este bloque devuelve datos o ceros. El `to_regclass` se conserva
  -- para entornos donde no lo esté: una referencia estática a una tabla
  -- inexistente haría fallar el `create function` completo, dejando sin
  -- instalar todo el RPC y no sólo este bloque. El texto del `execute` es una
  -- constante literal y el único valor variable entra por `using`: sin
  -- superficie de inyección.
  if to_regclass('public.ai_usage_daily') is not null then
    execute $q$
      select jsonb_build_object(
        'startDate', $1::date::text,
        'requests', coalesce(sum(request_count), 0),
        'costUsd', coalesce(sum(estimated_cost_usd), 0),
        'byBucket', coalesce((
          select jsonb_object_agg(bucket_id, total)
          from (
            select bucket_id, sum(request_count) as total
            from public.ai_usage_daily
            where usage_date >= $1::date
            group by 1
          ) b
        ), '{}'::jsonb)
      )
      from public.ai_usage_daily
      where usage_date >= $1::date
    $q$
    into v_quota
    using p_since;
  end if;

  return jsonb_build_object(
    'activity', v_activity,
    'coach', v_coach,
    'planBuilder', v_plan,
    'attempts', v_attempts,
    'quota', v_quota
  );
end;
$$;

revoke all on function public.read_operations_metrics(timestamptz)
  from public, anon, authenticated;
grant execute on function public.read_operations_metrics(timestamptz)
  to service_role;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/operations/__tests__/operationsMetricsMigrationGuard.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verificar que el guard no es vacuo**

Editar temporalmente el `.sql` cambiando `to service_role;` por
`to authenticated;`, correr el test y confirmar que **falla**. Revertir la
edición y volver a correr para confirmar que pasa.

Expected: FAIL con la edición, PASS sin ella. Si pasa en ambos casos el guard no
sirve y hay que arreglarlo antes de seguir.

---

### Task 3: Autorización de operaciones

**Files:**
- Create: `netlify/functions/_shared/operationsAdmins.ts`
- Test: `netlify/functions/__tests__/operationsAdmins.test.ts`

**Correcciones aplicadas durante la ejecución (2026-08-23):** (1) el test de
case-insensitivity usaba `UUID_A`, sin letras hexadecimales, así que era un
no-op — verificado por mutación: quitar `.toLowerCase()` de cualquiera de los
dos lados dejaba la suite verde. Reescrito con `UUID_B` en ambas direcciones.
(2) el test del email no ejercita el `.filter(UUID_PATTERN)` sobre las entradas
de la allowlist, porque ese filter es **inobservable por construcción**; se
conserva como defensa ante un futuro refactor del guard de `userId` y el test
fue renombrado para declarar lo que realmente verifica.

**Interfaces:**
- Consumes: nada.
- Produces: `isOperationsAdmin(userId: string, env?: NodeJS.ProcessEnv): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// netlify/functions/__tests__/operationsAdmins.test.ts
import { describe, expect, it } from 'vitest'
import { isOperationsAdmin } from '../_shared/operationsAdmins'

const UUID_A = '11111111-2222-4333-8444-555555555555'
const UUID_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function env(value?: string): NodeJS.ProcessEnv {
  return (value === undefined ? {} : { OPERATIONS_ADMIN_USER_IDS: value }) as NodeJS.ProcessEnv
}

describe('isOperationsAdmin', () => {
  it('sin variable definida NADIE es admin', () => {
    expect(isOperationsAdmin(UUID_A, env())).toBe(false)
  })

  it('variable vacia o solo separadores: nadie', () => {
    expect(isOperationsAdmin(UUID_A, env(''))).toBe(false)
    expect(isOperationsAdmin(UUID_A, env('  , ,  '))).toBe(false)
  })

  it('acepta un uuid listado', () => {
    expect(isOperationsAdmin(UUID_A, env(UUID_A))).toBe(true)
  })

  it('acepta listas con espacios y varios uuid', () => {
    expect(isOperationsAdmin(UUID_B, env(`${UUID_A} , ${UUID_B}`))).toBe(true)
  })

  it('rechaza un uuid no listado', () => {
    expect(isOperationsAdmin(UUID_B, env(UUID_A))).toBe(false)
  })

  it('compara sin distinguir mayusculas', () => {
    // UUID_A no tiene letras hexadecimales (a-f), asi que toUpperCase() es un
    // no-op sobre el y el test seria vacuo. UUID_B si las tiene. Las dos
    // direcciones importan: el .toLowerCase() esta en dos lugares distintos y
    // cada uno puede romperse por separado.
    expect(isOperationsAdmin(UUID_B.toUpperCase(), env(UUID_B))).toBe(true)
    expect(isOperationsAdmin(UUID_B, env(UUID_B.toUpperCase()))).toBe(true)
  })

  it('descarta entradas que no son uuid: un email jamas autoriza', () => {
    expect(isOperationsAdmin('rafa@example.com', env('rafa@example.com'))).toBe(false)
  })

  it('una entrada basura no invalida las demas', () => {
    expect(isOperationsAdmin(UUID_A, env(`no-es-uuid, ${UUID_A}`))).toBe(true)
  })

  it('userId vacio nunca autoriza, ni con lista basura', () => {
    expect(isOperationsAdmin('', env('no-es-uuid'))).toBe(false)
    expect(isOperationsAdmin('', env(''))).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/__tests__/operationsAdmins.test.ts`
Expected: FAIL — no se resuelve `../_shared/operationsAdmins`.

- [ ] **Step 3: Write minimal implementation**

```ts
// netlify/functions/_shared/operationsAdmins.ts

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
    .filter((entry) => UUID_PATTERN.test(entry))
    .includes(normalizedUserId)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/__tests__/operationsAdmins.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Verify**

Run: `npm run lint && npx tsc -b`

---

### Task 4: Lectura del RPC con service role

**Files:**
- Create: `netlify/functions/_shared/operationsMetrics.ts`
- Test: `netlify/functions/__tests__/operationsMetrics.test.ts`

**Interfaces:**
- Consumes: `isOperationsWindow` y tipos de Task 1.
- Produces: `readOperationsMetrics(now?: number): Promise<OperationsMetrics>`;
  `OperationsMetricsError` con `.statusCode`.

- [ ] **Step 1: Write the failing test**

```ts
// netlify/functions/__tests__/operationsMetrics.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OperationsMetricsError, readOperationsMetrics } from '../_shared/operationsMetrics'

const ORIGINAL_ENV = { ...process.env }

const WINDOW = {
  activity: { accountsUsingAi: 2, accountsPlanning: 1 },
  coach: {
    requests: 4, errors: 1, topErrorCodes: [{ code: 'timeout', count: 1 }],
    latencyP50: 800, latencyP90: 1500, latencyP95: 1800, costUsd: 0.05,
    coverage: { rowsTotal: 4, rowsWithCost: 3, tokensTotal: 100, tokensWithCost: 80 },
  },
  planBuilder: {
    runs: 1, byOutcome: { succeeded: 1 },
    firstWeekP50: 1, firstWeekP90: 1, firstWeekP95: 1,
    completeP50: 2, completeP90: 2, completeP95: 2,
    costUsd: 0.1,
    coverage: { rowsTotal: 1, rowsWithCost: 1, tokensTotal: 10, tokensWithCost: 10 },
  },
  attempts: { total: 2, byOutcome: { succeeded: 2 } },
  quota: null,
}

beforeEach(() => {
  process.env['SUPABASE_URL'] = 'https://example.supabase.co'
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service-role-key'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl as never)
  vi.stubGlobal('fetch', spy)
  return spy
}

function ok(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }))
}

describe('readOperationsMetrics', () => {
  it('consulta las dos ventanas y las devuelve etiquetadas', async () => {
    const spy = stubFetch(() => ok(WINDOW))
    const result = await readOperationsMetrics(Date.parse('2026-08-23T12:00:00Z'))

    expect(spy).toHaveBeenCalledTimes(2)
    expect(result.last24h.activity.accountsUsingAi).toBe(2)
    expect(result.last7d.activity.accountsUsingAi).toBe(2)
    expect(result.generatedAt).toBe('2026-08-23T12:00:00.000Z')
  })

  it('envia los dos p_since correctos: 24 h y 7 dias', async () => {
    const bodies: string[] = []
    stubFetch((_url, init) => {
      bodies.push(String(init?.body))
      return ok(WINDOW)
    })
    await readOperationsMetrics(Date.parse('2026-08-23T12:00:00Z'))

    expect(bodies).toContain(JSON.stringify({ p_since: '2026-08-22T12:00:00.000Z' }))
    expect(bodies).toContain(JSON.stringify({ p_since: '2026-08-16T12:00:00.000Z' }))
  })

  it('usa el service role y llama al RPC por nombre', async () => {
    const spy = stubFetch(() => ok(WINDOW))
    await readOperationsMetrics(Date.now())

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/read_operations_metrics')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer service-role-key')
  })

  it('sin service role configurado falla con 500, sin llamar a la red', async () => {
    delete process.env['SUPABASE_SERVICE_ROLE_KEY']
    const spy = stubFetch(() => ok(WINDOW))

    await expect(readOperationsMetrics(Date.now())).rejects.toMatchObject({ statusCode: 500 })
    expect(spy).not.toHaveBeenCalled()
  })

  it('RPC ausente (404) es 500 explicito: la migracion no fue aplicada', async () => {
    stubFetch(() => Promise.resolve(new Response('{}', { status: 404 })))
    await expect(readOperationsMetrics(Date.now())).rejects.toBeInstanceOf(OperationsMetricsError)
  })

  it('respuesta con forma inesperada NO se propaga a la UI', async () => {
    stubFetch(() => ok({ activity: { accountsUsingAi: 'muchas' } }))
    await expect(readOperationsMetrics(Date.now())).rejects.toMatchObject({ statusCode: 500 })
  })

  it('quota null se preserva tal cual, sin convertirse en ceros', async () => {
    stubFetch(() => ok({ ...WINDOW, quota: null }))
    const result = await readOperationsMetrics(Date.now())
    expect(result.last24h.quota).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/__tests__/operationsMetrics.test.ts`
Expected: FAIL — no se resuelve `../_shared/operationsMetrics`.

- [ ] **Step 3: Write minimal implementation**

```ts
// netlify/functions/_shared/operationsMetrics.ts
import {
  isOperationsWindow,
  type OperationsMetrics,
  type OperationsWindow,
} from '../../../src/services/operations/operationsMetricsContract'

const RPC_TIMEOUT_MS = 8_000
const DAY_MS = 24 * 60 * 60 * 1000

export class OperationsMetricsError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode = 500) {
    super(message)
    this.name = 'OperationsMetricsError'
    this.statusCode = statusCode
  }
}

async function readWindow(
  url: string,
  serviceRoleKey: string,
  sinceIso: string,
): Promise<OperationsWindow> {
  let response: Response
  try {
    response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/read_operations_metrics`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_since: sinceIso }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    })
  } catch {
    throw new OperationsMetricsError('No se pudo consultar la telemetría.')
  }

  if (!response.ok) {
    // 404 acá significa, casi siempre, que `022` no fue aplicada. Se reporta
    // como fallo del servidor, no como "sin datos": mostrar ceros cuando en
    // realidad no se pudo leer sería el peor resultado posible para un panel
    // de operación.
    throw new OperationsMetricsError('La telemetría no está disponible.')
  }

  const payload = await response.json().catch(() => null)
  if (!isOperationsWindow(payload)) {
    throw new OperationsMetricsError('La telemetría devolvió una forma inesperada.')
  }
  return payload
}

/**
 * Lee las dos ventanas en paralelo. Usa service role porque el RPC sólo se le
 * concedió a ese rol; el resultado son agregados, nunca filas por cuenta.
 */
export async function readOperationsMetrics(
  now: number = Date.now(),
): Promise<OperationsMetrics> {
  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL']
  const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !serviceRoleKey) {
    throw new OperationsMetricsError('Telemetría mal configurada en el servidor.')
  }

  const [last24h, last7d] = await Promise.all([
    readWindow(url, serviceRoleKey, new Date(now - DAY_MS).toISOString()),
    readWindow(url, serviceRoleKey, new Date(now - 7 * DAY_MS).toISOString()),
  ])

  return { last24h, last7d, generatedAt: new Date(now).toISOString() }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/__tests__/operationsMetrics.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verify**

Run: `npm run lint && npx tsc -b`

---

### Task 5: Función Netlify `operations-dashboard`

**Files:**
- Create: `netlify/functions/operations-dashboard.ts`
- Test: `netlify/functions/__tests__/operationsDashboard.test.ts`

**Interfaces:**
- Consumes: `resolveAuthContext` y `json` de `_shared/planGenerationShared`,
  `corsPreflight` de `_shared/cors`, `isOperationsAdmin` (Task 3),
  `readOperationsMetrics` (Task 4).
- Produces: `handler` (`@netlify/functions`), en `GET
  /.netlify/functions/operations-dashboard`.

- [ ] **Step 1: Write the failing test**

```ts
// netlify/functions/__tests__/operationsDashboard.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandlerEvent } from '@netlify/functions'

const ADMIN_ID = '11111111-2222-4333-8444-555555555555'
const OTHER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

const resolveAuthContext = vi.fn()
const readOperationsMetrics = vi.fn()

vi.mock('../_shared/planGenerationShared', async () => {
  const actual = await vi.importActual<typeof import('../_shared/planGenerationShared')>(
    '../_shared/planGenerationShared',
  )
  return { ...actual, resolveAuthContext: (event: HandlerEvent) => resolveAuthContext(event) }
})

vi.mock('../_shared/operationsMetrics', () => ({
  readOperationsMetrics: () => readOperationsMetrics(),
  OperationsMetricsError: class extends Error {
    statusCode = 500
  },
}))

const ORIGINAL_ENV = { ...process.env }

function event(method = 'GET'): HandlerEvent {
  return { httpMethod: method, headers: {} } as unknown as HandlerEvent
}

async function invoke(method = 'GET') {
  const { handler } = await import('../operations-dashboard')
  return handler(event(method), {} as never, () => undefined) as Promise<{
    statusCode: number
    body: string
  }>
}

beforeEach(() => {
  vi.resetModules()
  process.env['OPERATIONS_ADMIN_USER_IDS'] = ADMIN_ID
  resolveAuthContext.mockResolvedValue({ userId: ADMIN_ID, token: 'tok' })
  readOperationsMetrics.mockResolvedValue({
    last24h: { marker: '24h' }, last7d: { marker: '7d' }, generatedAt: 'now',
  })
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.clearAllMocks()
})

describe('operations-dashboard', () => {
  it('sin sesion devuelve 401 y no consulta telemetria', async () => {
    resolveAuthContext.mockRejectedValue(Object.assign(new Error('no'), { statusCode: 401 }))
    const response = await invoke()
    expect(response.statusCode).toBe(401)
    expect(readOperationsMetrics).not.toHaveBeenCalled()
  })

  it('cuenta autenticada NO listada devuelve 403 y no consulta telemetria', async () => {
    resolveAuthContext.mockResolvedValue({ userId: OTHER_ID, token: 'tok' })
    const response = await invoke()
    expect(response.statusCode).toBe(403)
    expect(readOperationsMetrics).not.toHaveBeenCalled()
  })

  it('sin OPERATIONS_ADMIN_USER_IDS nadie pasa', async () => {
    delete process.env['OPERATIONS_ADMIN_USER_IDS']
    const response = await invoke()
    expect(response.statusCode).toBe(403)
    expect(readOperationsMetrics).not.toHaveBeenCalled()
  })

  it('cuenta listada recibe 200 con las dos ventanas', async () => {
    const response = await invoke()
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      last24h: { marker: '24h' }, last7d: { marker: '7d' }, generatedAt: 'now',
    })
  })

  it('metodo no permitido devuelve 405', async () => {
    expect((await invoke('POST')).statusCode).toBe(405)
  })

  it('fallo de telemetria devuelve 500 sin filtrar la causa cruda', async () => {
    readOperationsMetrics.mockRejectedValue(
      Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { statusCode: 500 }),
    )
    const response = await invoke()
    expect(response.statusCode).toBe(500)
    expect(response.body).not.toContain('ECONNREFUSED')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/__tests__/operationsDashboard.test.ts`
Expected: FAIL — no se resuelve `../operations-dashboard`.

- [ ] **Step 3: Write minimal implementation**

```ts
// netlify/functions/operations-dashboard.ts
import type { Handler } from '@netlify/functions'
import { json, resolveAuthContext } from './_shared/planGenerationShared'
import { corsPreflight } from './_shared/cors'
import { isOperationsAdmin } from './_shared/operationsAdmins'
import { readOperationsMetrics } from './_shared/operationsMetrics'

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return corsPreflight()
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' })

  let auth: Awaited<ReturnType<typeof resolveAuthContext>>
  try {
    auth = await resolveAuthContext(event)
  } catch (error) {
    return json((error as { statusCode?: number }).statusCode ?? 401, {
      error: 'Sesión requerida.',
    })
  }

  // La autorización va antes de tocar la telemetría: una cuenta no autorizada
  // no debe poder ni siquiera provocar la consulta.
  if (!isOperationsAdmin(auth.userId)) {
    return json(403, { error: 'No autorizado.' })
  }

  try {
    return json(200, await readOperationsMetrics())
  } catch (error) {
    // La causa cruda va al log, nunca al cuerpo: puede traer host, puerto o
    // detalle de infraestructura.
    console.error('[operations-dashboard] telemetry read failed', error)
    return json(500, { error: 'No se pudo leer la telemetría.' })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/__tests__/operationsDashboard.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify**

Run: `npm run lint && npx tsc -b`

---

### Task 6: Servicio de cliente

**Files:**
- Create: `src/services/operations/fetchOperationsMetrics.ts`
- Test: `src/services/operations/__tests__/fetchOperationsMetrics.test.ts`

**Interfaces:**
- Consumes: `resolveApiUrl` (`src/services/apiUrl.ts`), `getSupabase`
  (`src/services/supabase.ts`), tipos de Task 1.
- Produces: `fetchOperationsMetrics(): Promise<OperationsMetrics>`;
  `OperationsAccessError` con `.kind: 'unauthenticated' | 'forbidden' | 'unavailable'`.

- [ ] **Step 1: Write the failing test**

```ts
// src/services/operations/__tests__/fetchOperationsMetrics.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getSession = vi.fn()
vi.mock('../../supabase', () => ({ getSupabase: () => ({ auth: { getSession } }) }))

import { OperationsAccessError, fetchOperationsMetrics } from '../fetchOperationsMetrics'

const PAYLOAD = { last24h: {}, last7d: {}, generatedAt: '2026-08-23T00:00:00.000Z' }

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function stubFetch(status: number, body: unknown) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }))
  vi.stubGlobal('fetch', spy)
  return spy
}

describe('fetchOperationsMetrics', () => {
  it('manda el bearer de la sesion al endpoint correcto', async () => {
    const spy = stubFetch(200, PAYLOAD)
    await fetchOperationsMetrics()

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/.netlify/functions/operations-dashboard')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok')
  })

  it('sin sesion local no llama a la red', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    const spy = stubFetch(200, PAYLOAD)

    await expect(fetchOperationsMetrics()).rejects.toMatchObject({ kind: 'unauthenticated' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('403 se distingue de 401: es acceso denegado, no sesion caida', async () => {
    stubFetch(403, { error: 'No autorizado.' })
    await expect(fetchOperationsMetrics()).rejects.toMatchObject({ kind: 'forbidden' })
  })

  it('401 se reporta como sesion requerida', async () => {
    stubFetch(401, { error: 'Sesión requerida.' })
    await expect(fetchOperationsMetrics()).rejects.toMatchObject({ kind: 'unauthenticated' })
  })

  it('500 se reporta como no disponible', async () => {
    stubFetch(500, { error: 'No se pudo leer la telemetría.' })
    await expect(fetchOperationsMetrics()).rejects.toBeInstanceOf(OperationsAccessError)
  })

  it('200 devuelve el payload tal cual', async () => {
    stubFetch(200, PAYLOAD)
    await expect(fetchOperationsMetrics()).resolves.toEqual(PAYLOAD)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/operations/__tests__/fetchOperationsMetrics.test.ts`
Expected: FAIL — no se resuelve `../fetchOperationsMetrics`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/services/operations/fetchOperationsMetrics.ts
import { resolveApiUrl } from '../apiUrl'
import { getSupabase } from '../supabase'
import type { OperationsMetrics } from './operationsMetricsContract'

export type OperationsAccessKind = 'unauthenticated' | 'forbidden' | 'unavailable'

export class OperationsAccessError extends Error {
  readonly kind: OperationsAccessKind

  constructor(kind: OperationsAccessKind, message: string) {
    super(message)
    this.name = 'OperationsAccessError'
    this.kind = kind
  }
}

/**
 * El cliente no tiene ninguna autoridad sobre quién es admin: pide y traduce la
 * respuesta. Un guard de cliente sería una segunda fuente de verdad, y la
 * autoridad vive en `OPERATIONS_ADMIN_USER_IDS`, que es server-only.
 */
export async function fetchOperationsMetrics(): Promise<OperationsMetrics> {
  const { data } = await getSupabase().auth.getSession()
  const token = data.session?.access_token
  if (!token) {
    throw new OperationsAccessError('unauthenticated', 'Iniciá sesión para ver esta vista.')
  }

  let response: Response
  try {
    response = await fetch(resolveApiUrl('/.netlify/functions/operations-dashboard'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    throw new OperationsAccessError('unavailable', 'No se pudo conectar con el servidor.')
  }

  if (response.status === 401) {
    throw new OperationsAccessError('unauthenticated', 'Tu sesión expiró.')
  }
  if (response.status === 403) {
    throw new OperationsAccessError('forbidden', 'Esta vista no está disponible para tu cuenta.')
  }
  if (!response.ok) {
    throw new OperationsAccessError('unavailable', 'No se pudo leer la telemetría.')
  }

  return await response.json() as OperationsMetrics
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/operations/__tests__/fetchOperationsMetrics.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify**

Run: `npm run lint && npx tsc -b`

---

### Task 7: Página `/ops` y su ruta

**Files:**
- Create: `src/pages/OperationsPage.tsx`
- Modify: `src/constants/routes.ts` (agregar `OPS: '/ops'`)
- Modify: `src/App.tsx` (import `lazy` junto a las demás páginas, ~línea 45; ruta
  junto a `ROUTES.COACH`, ~línea 417)
- Test: `src/pages/__tests__/OperationsPage.test.tsx`

**Convenciones de test verificadas en este repo, no asumidas:** los tests de
página llevan `// @vitest-environment jsdom` en la primera línea y `cleanup()`
en `afterEach`. **No hay `@testing-library/jest-dom`**: se usa
`.toBeTruthy()` / `.toBeNull()`, nunca `.toBeInTheDocument()`. Referencia viva:
`src/pages/__tests__/WeeklyViewNoMacroPlan.test.tsx`.

**Interfaces:**
- Consumes: `fetchOperationsMetrics`, `OperationsAccessError` (Task 6);
  `OperationsMetrics` (Task 1).
- Produces: `OperationsPage` (default export), ruta `ROUTES.OPS`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/pages/__tests__/OperationsPage.test.tsx
// @vitest-environment jsdom
//
// El proyecto NO usa @testing-library/jest-dom: las aserciones van con
// .toBeTruthy() / .toBeNull(), como en WeeklyViewNoMacroPlan.test.tsx.
// Y como la pagina renderiza DOS paneles (24 h y 7 dias), todo texto de
// metrica aparece dos veces: usar siempre las variantes All*.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const fetchOperationsMetrics = vi.fn()
vi.mock('../../services/operations/fetchOperationsMetrics', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/operations/fetchOperationsMetrics')
  >('../../services/operations/fetchOperationsMetrics')
  return { ...actual, fetchOperationsMetrics: () => fetchOperationsMetrics() }
})

import { OperationsAccessError } from '../../services/operations/fetchOperationsMetrics'
import OperationsPage from '../OperationsPage'

const WINDOW = {
  activity: { accountsUsingAi: 3, accountsPlanning: 2 },
  coach: {
    requests: 12, errors: 2, topErrorCodes: [{ code: 'timeout', count: 2 }],
    latencyP50: 900, latencyP90: 2100, latencyP95: 3000, costUsd: 0.1234,
    coverage: { rowsTotal: 12, rowsWithCost: 9, tokensTotal: 1000, tokensWithCost: 600 },
  },
  planBuilder: {
    runs: 2, byOutcome: { succeeded: 2 },
    firstWeekP50: 14000, firstWeekP90: 20000, firstWeekP95: 22000,
    completeP50: 31000, completeP90: 40000, completeP95: 44000,
    costUsd: 0.2, coverage: { rowsTotal: 2, rowsWithCost: 2, tokensTotal: 50, tokensWithCost: 50 },
  },
  attempts: { total: 5, byOutcome: { succeeded: 5 } },
  quota: null,
}

const METRICS = { last24h: WINDOW, last7d: WINDOW, generatedAt: '2026-08-23T00:00:00.000Z' }

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

describe('OperationsPage', () => {
  it('muestra estado de carga antes de resolver', () => {
    fetchOperationsMetrics.mockReturnValue(new Promise(() => {}))
    render(<OperationsPage />)
    expect(screen.getByText(/cargando/i)).toBeTruthy()
  })

  it('403 muestra acceso denegado, no un error tecnico', async () => {
    fetchOperationsMetrics.mockRejectedValue(
      new OperationsAccessError('forbidden', 'Esta vista no está disponible para tu cuenta.'),
    )
    render(<OperationsPage />)
    expect(await screen.findByText(/no está disponible para tu cuenta/i)).toBeTruthy()
  })

  it('fallo de servidor muestra mensaje humano', async () => {
    fetchOperationsMetrics.mockRejectedValue(
      new OperationsAccessError('unavailable', 'No se pudo leer la telemetría.'),
    )
    render(<OperationsPage />)
    expect(await screen.findByText(/no se pudo leer la telemetr/i)).toBeTruthy()
  })

  it('nunca rotula una metrica como "usuarios activos"', async () => {
    fetchOperationsMetrics.mockResolvedValue(METRICS)
    render(<OperationsPage />)
    // Dos paneles: cada rotulo aparece dos veces.
    expect(await screen.findAllByText(/cuentas con uso de IA/i)).toHaveLength(2)
    expect(screen.getAllByText(/cuentas con planificación/i)).toHaveLength(2)
    expect(screen.queryByText(/usuarios activos/i)).toBeNull()
  })

  it('publica la cobertura junto al costo: un total sin cobertura miente', async () => {
    fetchOperationsMetrics.mockResolvedValue(METRICS)
    render(<OperationsPage />)
    expect(await screen.findAllByText(/9\/12 filas/i)).toHaveLength(2)
    expect(screen.getAllByText(/600\/1000 tokens/i)).toHaveLength(2)
  })

  it('quota poblada muestra sus numeros: es el estado de produccion', async () => {
    const quota = { startDate: '2026-08-22', requests: 42, costUsd: 0.51, byBucket: { chat: 42 } }
    fetchOperationsMetrics.mockResolvedValue({
      last24h: { ...WINDOW, quota }, last7d: { ...WINDOW, quota },
      generatedAt: '2026-08-23T00:00:00.000Z',
    })
    render(<OperationsPage />)
    expect(await screen.findAllByText('42')).toHaveLength(2)
    expect(screen.getAllByText('US$0.5100')).toHaveLength(2)
    expect(screen.getAllByText('Requests con cuota desde 2026-08-22')).toHaveLength(2)
    expect(screen.queryByText(/sin datos/i)).toBeNull()
  })

  it('quota en cero NO se muestra como sin datos: son cosas distintas', async () => {
    const quota = { startDate: '2026-08-22', requests: 0, costUsd: 0, byBucket: {} }
    fetchOperationsMetrics.mockResolvedValue({
      last24h: { ...WINDOW, quota }, last7d: { ...WINDOW, quota },
      generatedAt: '2026-08-23T00:00:00.000Z',
    })
    render(<OperationsPage />)
    expect(await screen.findAllByText('0')).toHaveLength(2)
    expect(screen.queryByText(/sin datos/i)).toBeNull()
  })

  it('quota null se muestra como sin datos: tabla ausente, no uso cero', async () => {
    fetchOperationsMetrics.mockResolvedValue(METRICS)
    render(<OperationsPage />)
    // Dos paneles y dos métricas de cuota por panel (requests y costo).
    expect(await screen.findAllByText(/sin datos/i)).toHaveLength(4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/__tests__/OperationsPage.test.tsx`
Expected: FAIL — no se resuelve `../OperationsPage`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/pages/OperationsPage.tsx
import { useEffect, useState } from 'react'
import {
  OperationsAccessError,
  fetchOperationsMetrics,
} from '../services/operations/fetchOperationsMetrics'
import type {
  CostCoverage,
  OperationsMetrics,
  OperationsWindow,
} from '../services/operations/operationsMetricsContract'

function formatMs(value: number | null): string {
  return value == null ? 'sin datos' : `${(value / 1000).toFixed(1)} s`
}

function formatUsd(value: number): string {
  return `US$${value.toFixed(4)}`
}

/**
 * La cobertura viaja pegada al costo a propósito: `estimated_cost_usd = null`
 * no es cero, así que un total sin su cobertura es un número que engaña.
 */
function Coverage({ coverage }: { coverage: CostCoverage }) {
  return (
    <p className="text-xs text-white/50">
      cobertura {coverage.rowsWithCost}/{coverage.rowsTotal} filas ·{' '}
      {coverage.tokensWithCost}/{coverage.tokensTotal} tokens
    </p>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <p className="text-xs text-white/60">{label}</p>
      <p className="text-lg font-semibold text-white">{value}</p>
    </div>
  )
}

function WindowPanel({ title, data }: { title: string; data: OperationsWindow }) {
  const errorRate = data.coach.requests === 0
    ? '—'
    : `${((data.coach.errors / data.coach.requests) * 100).toFixed(1)}%`

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-white/70">{title}</h2>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="Cuentas con uso de IA" value={String(data.activity.accountsUsingAi)} />
        <Metric label="Cuentas con planificación" value={String(data.activity.accountsPlanning)} />
        <Metric label="Requests de coach" value={String(data.coach.requests)} />
        <Metric label="Tasa de error" value={errorRate} />
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="Coach p50" value={formatMs(data.coach.latencyP50)} />
        <Metric label="Coach p90" value={formatMs(data.coach.latencyP90)} />
        <Metric label="Coach p95" value={formatMs(data.coach.latencyP95)} />
        <Metric label="Costo de coach" value={formatUsd(data.coach.costUsd)} />
      </div>
      <Coverage coverage={data.coach.coverage} />

      {data.coach.topErrorCodes.length > 0 && (
        <p className="text-xs text-white/60">
          Errores: {data.coach.topErrorCodes.map((entry) => `${entry.code} (${entry.count})`).join(' · ')}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric label="Corridas de plan" value={String(data.planBuilder.runs)} />
        <Metric label="1ª semana p90" value={formatMs(data.planBuilder.firstWeekP90)} />
        <Metric label="Plan completo p90" value={formatMs(data.planBuilder.completeP90)} />
        <Metric label="Costo de plan" value={formatUsd(data.planBuilder.costUsd)} />
      </div>
      <Coverage coverage={data.planBuilder.coverage} />

      <p className="text-xs text-white/60">
        Intentos: {data.attempts.total} ·{' '}
        {Object.entries(data.attempts.byOutcome).map(([key, count]) => `${key} ${count}`).join(' · ') || 'sin datos'}
      </p>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Metric
          label={data.quota ? `Requests con cuota desde ${data.quota.startDate}` : 'Requests con cuota'}
          value={data.quota ? String(data.quota.requests) : 'sin datos'}
        />
        <Metric
          label={data.quota ? `Costo registrado desde ${data.quota.startDate}` : 'Costo registrado'}
          value={data.quota ? formatUsd(data.quota.costUsd) : 'sin datos'}
        />
      </div>
    </section>
  )
}

export default function OperationsPage() {
  const [metrics, setMetrics] = useState<OperationsMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchOperationsMetrics()
      .then((result) => { if (!cancelled) setMetrics(result) })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(cause instanceof OperationsAccessError
          ? cause.message
          : 'No se pudo leer la telemetría.')
      })
    return () => { cancelled = true }
  }, [])

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center text-sm text-white/70">
        {error}
      </div>
    )
  }

  if (!metrics) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center text-sm text-white/60">
        Cargando telemetría…
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold text-white">Operación</h1>
        <p className="text-xs text-white/50">
          Generado {new Date(metrics.generatedAt).toLocaleString('es-CL')}
        </p>
      </header>
      <WindowPanel title="Últimas 24 horas" data={metrics.last24h} />
      <WindowPanel title="Últimos 7 días" data={metrics.last7d} />
    </div>
  )
}
```

Agregar a `src/constants/routes.ts`, después de `COACH`:

```ts
  OPS:              '/ops',
```

Agregar a `src/App.tsx`, junto a los demás `lazy` (~línea 45):

```tsx
const OperationsPage = lazy(() => import('./pages/OperationsPage'))
```

Y la ruta, junto a la de `ROUTES.COACH` (~línea 417):

```tsx
                    <Route path={ROUTES.OPS} element={<RouteBoundary><OperationsPage /></RouteBoundary>} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/__tests__/OperationsPage.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Confirmar que la ruta no aparece en navegación**

Run: `grep -rn "ROUTES.OPS" src/ | grep -v "App.tsx\|routes.ts"`
Expected: **sin resultados**. Si algún componente de navegación la enlaza, hay
que quitarlo: la ruta es privada y no se anuncia.

- [ ] **Step 6: Verify**

Run: `npm run lint && npm test && npm run build && npx tsc -b && git diff --check`
Expected: todo verde. Anotar el conteo de archivos/tests para el roadmap.

---

## Rollout (owner, después de la última tarea)

1. Aplicar `supabase/022_operations_metrics.sql` en producción.
2. Confirmar en el SQL editor que `authenticated` **no** puede ejecutar el RPC:
   `select has_function_privilege('authenticated', 'public.read_operations_metrics(timestamptz)', 'execute');`
   Expected: `false`.
3. Setear `OPERATIONS_ADMIN_USER_IDS` en Netlify con el UUID de Supabase del
   owner (no el email).
4. Desplegar.
5. Abrir `/ops` con la cuenta del owner y verificar que muestra datos reales.
6. Abrir `/ops` con una segunda cuenta real y verificar que muestra
   "Esta vista no está disponible para tu cuenta".
7. Confirmar que el bloque de cuotas **no** dice "sin datos": `021` está
   aplicada, así que debe mostrar números o ceros. Si dice "sin datos", el RPC
   no está viendo la tabla y hay que revisar antes de dar el panel por bueno.

Ningún paso consume API de IA.

## Notas para el ejecutor

- **No agregar el bloque de errores de cliente.** Es la Entrega B y necesita
  `023`; el contrato de Task 1 no lo incluye a propósito.
- **No crear un guard de cliente para `/ops`.** La autoridad es
  `OPERATIONS_ADMIN_USER_IDS` y vive en el servidor. Una lista en el bundle
  sería una segunda fuente de verdad y además pública.
- Si una consulta del RPC necesita crecer, revisar antes que no empiece a
  devolver filas: el invariante de "sólo agregados" es lo que permite que la
  función Netlify no tenga acceso a datos por cuenta.

# Coach Request Telemetry (`018`) Implementation Plan

> **For agentic workers:** si están disponibles, superpowers:subagent-driven-development o superpowers:executing-plans ayudan a ejecutar tarea por tarea; **son opcionales**, no un requisito. El plan es autocontenido y se puede ejecutar a mano. Los pasos usan checkbox (`- [ ]`) para seguimiento.

**Goal:** Persistir en Supabase una fila por request del coach síncrono, con latencia, tokens y usage, **dejando los datos recalculables**. Esto **no** responde todavía "cuánto cuesta el chat": Gemini y OpenAI no tienen precio en `MODEL_PRICES`, así que su costo queda `null` hasta que se pueble esa tabla, que es trabajo aparte.

**Architecture:** Se replica el contrato de `016`: tabla server-shaped con RLS de fila propia, un row mapper puro en `netlify/functions/_shared/`, un guard de drift bidireccional que compara el `.sql` contra las claves del mapper, y retención a 90 días en el cron existente. La diferencia con `016` es que la escritura va con el **token del usuario** (no service role) y es **best-effort sin `await`**, con aborto real a los 3 s.

**Tech Stack:** TypeScript, Netlify Functions v1 (`@netlify/functions` ^5.2.0), `@supabase/supabase-js`, Vitest, PostgreSQL/Supabase.

**Spec:** `docs/superpowers/specs/2026-08-03-coach-request-telemetry-design.md`

## Global Constraints

- **Migración de aplicación manual.** Escribir `supabase/018_coach_requests.sql` **no** es aplicarlo. No asumir que la tabla existe en producción.
- **Nunca romper el camino caliente.** Un fallo de telemetría no puede alterar el payload ni el status de la respuesta del coach, ni lanzar. `insertCoachRequestRow` **nunca** lanza: devuelve `'ok' | 'failed'`.
- **Sin `await` en el camino de request.** La escritura se dispara con `void`. Ver §6.1 de la spec: el cliente espera el cierre del stream, no el evento `done`.
- **Cancelación real, no race.** `withTimeout` (`netlify/functions/_shared/promiseTimeout.ts:1-9`) **no cancela**. El corte es `.abortSignal(AbortSignal.timeout(3_000))`.
- **No depender del nombre del error.** supabase-js devuelve `{ error, status: 0 }` al abortar en vez de rechazar, y `AbortSignal.timeout()` produce `TimeoutError`, no `AbortError`. Se traga *cualquier* error, devuelto o lanzado.
- **`user_id` es `not null`.** Requests anónimas (`COACH_PROXY_REQUIRE_AUTH=false` → `userId === 'anonymous'`, `coach.ts:659`) y requests que fallan la autenticación **no se persisten**. Siguen logueándose por `console.info`.
- **Conservar y extender `logCoachRequest`.** Los `console.info` con evento `coach.request.completed` (`coach.ts:617`) se conservan intactos en su comportamiento —son la fuente del contraste de pérdida en el rollout— pero su payload **gana `streamed` como campo obligatorio**: la verificación del rollout segmenta por esa dimensión en ambos lados, así que un evento sin ella es un evento inutilizable.
- **`estimated_cost_usd` tiene tres estados:** `0` para el bypass determinista, `null` para precio ausente o usage insuficiente, numérico en el resto. `null` **nunca** significa cero.
- **`streamed` es el transporte efectivo**, hoy `Boolean(req.stream)` en todas las requests persistibles, incluido el bypass (que tiene su propia rama de streaming en `coach.ts:1603`).
- **Autoridad sobre commits, por rol:**
  - **Owner humano** — commitea normalmente.
  - **Agente principal que ejecuta este plan** (p. ej. Codex corriendo las tareas de punta a punta) — **sí** puede ejecutar los commits descritos en los pasos "Commit", respetando el agrupamiento y la exclusión de cambios ajenos.
  - **Subagentes** — **no** commitean nunca. Entregan el trabajo al agente principal, que decide y agrupa.

  Esto reemplaza cualquier lectura previa de "ningún agente puede commitear": la restricción real es sobre *subagentes*, no sobre quien ejecuta el plan.
- **El árbol arranca sucio con trabajo ajeno a `018`.** No se enumera una foto fija acá porque cambia entre sesiones. La regla es de procedimiento:
  1. **Correr `git status --short` como primer paso**, antes de tocar nada, y anotar qué archivos ya venían modificados.
  2. **Preservar todos esos cambios.** Ninguna tarea de este plan puede revertir, reescribir ni descartar un hunk que no haya escrito ella misma. En los archivos que la Task 6 modifica, **agregar** secciones, nunca reemplazar el archivo entero.
  3. **Commitear solo lo propio.** Si un archivo mezcla cambios de `018` con cambios ajenos, usar `git add -p` para dejar los ajenos fuera.
  4. `ios/App/App/Info.plist` **no entra en ningún commit** de este plan.
- Verificación de cierre de cada tarea: `npm run lint && npm test && npx tsc --noEmit`.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `supabase/018_coach_requests.sql` | Tabla, checks, índices, RLS (`select` + `insert` propios) |
| `netlify/functions/_shared/coachRequestTelemetry.ts` | Tipo `CoachRequestTelemetry`, `resolveCoachRequestCostUsd`, `coachRequestToRow`, `insertCoachRequestRow` |
| `netlify/functions/_shared/__tests__/coachRequestTelemetry.test.ts` | Mapper, tres estados de costo, aborto, tragado de errores |
| `netlify/functions/_shared/__tests__/coachRequestSchema.test.ts` | Guard de drift bidireccional `.sql` ↔ mapper |
| `netlify/functions/_shared/planGenerationTelemetryRetention.ts` | + `deleteExpiredCoachRequests` |
| `netlify/functions/_shared/planGenerationTelemetryRetention.test.ts` | + test de la retención nueva |
| `netlify/functions/coach.ts` | Plomería de `userId`/token/`streamed`, `recordCoachRequest` |
| `netlify/functions/__tests__/coachRequestPersistence.test.ts` | Inserción autenticada, `streamed` en ambos transportes, anónimo, auth fallida, fallo de Supabase |
| `src/services/ai/providers/ProxyProvider.ts` + tipos/normalizador/engine | Propaga `streamed` terminal hasta `useAIDebugStore`; fallback streaming→JSON termina en `false` |

---

### Task 1: Row mapper y semántica de costo

**Files:**
- Create: `netlify/functions/_shared/coachRequestTelemetry.ts`
- Test: `netlify/functions/_shared/__tests__/coachRequestTelemetry.test.ts`

**Interfaces:**
- Consumes: `estimateCostUsd` de `src/services/planBuilder/pricing.ts` (firma: `{ model: string; at: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number } => number | null`).
- Produces: `CoachRequestTelemetry` (interface), `DETERMINISTIC_BYPASS_MODEL` (const), `resolveCoachRequestCostUsd(t: CoachRequestTelemetry): number | null`, `coachRequestToRow(t: CoachRequestTelemetry): Record<string, unknown>`.

- [ ] **Step 1: Write the failing test**

Crear `netlify/functions/_shared/__tests__/coachRequestTelemetry.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'

import {
  coachRequestToRow,
  DETERMINISTIC_BYPASS_MODEL,
  resolveCoachRequestCostUsd,
  type CoachRequestTelemetry,
} from '../coachRequestTelemetry'

const AT = Date.parse('2026-08-05T12:00:00.000Z')

function makeTelemetry(overrides: Partial<CoachRequestTelemetry> = {}): CoachRequestTelemetry {
  return {
    traceId: 'chat_general-abc',
    userId: '11111111-1111-4111-8111-111111111111',
    requestClass: 'chat_general',
    streamed: true,
    outcome: 'ok',
    authDurationMs: 12,
    serverDurationMs: 900,
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    promptTokens: 1_000_000,
    completionTokens: 1_000_000,
    createdAt: AT,
    ...overrides,
  }
}

describe('resolveCoachRequestCostUsd', () => {
  it('calcula el costo con la tabla fechada cuando el modelo tiene precio', () => {
    // 1M input a US$3 + 1M output a US$15
    expect(resolveCoachRequestCostUsd(makeTelemetry())).toBeCloseTo(18, 6)
  })

  it('devuelve 0 para el bypass determinista, que no llama a ningún proveedor', () => {
    const cost = resolveCoachRequestCostUsd(makeTelemetry({
      model: DETERMINISTIC_BYPASS_MODEL,
      promptTokens: undefined,
      completionTokens: undefined,
    }))
    expect(cost).toBe(0)
  })

  it('devuelve null cuando el modelo no está en MODEL_PRICES', () => {
    expect(resolveCoachRequestCostUsd(makeTelemetry({ model: 'gemini-2.5-flash' }))).toBeNull()
  })

  it('devuelve null cuando el usage es insuficiente aunque el modelo tenga precio', () => {
    const cost = resolveCoachRequestCostUsd(makeTelemetry({
      promptTokens: undefined,
      completionTokens: undefined,
    }))
    expect(cost).toBeNull()
  })

  it('devuelve null cuando falta el modelo', () => {
    expect(resolveCoachRequestCostUsd(makeTelemetry({ model: undefined }))).toBeNull()
  })
})

describe('coachRequestToRow', () => {
  it('mapea a snake_case y estampa created_at como ISO', () => {
    const row = coachRequestToRow(makeTelemetry({ generationId: 'gen-1', logicalAttempt: 2 }))

    expect(row['trace_id']).toBe('chat_general-abc')
    expect(row['generation_id']).toBe('gen-1')
    expect(row['logical_attempt']).toBe(2)
    expect(row['request_class']).toBe('chat_general')
    expect(row['streamed']).toBe(true)
    expect(row['created_at']).toBe(new Date(AT).toISOString())
  })

  it('deja null los campos opcionales ausentes en vez de undefined', () => {
    const row = coachRequestToRow(makeTelemetry({ generationId: undefined, errorCode: undefined }))

    expect(row['generation_id']).toBeNull()
    expect(row['error_code']).toBeNull()
    expect(Object.values(row).every((value) => value !== undefined)).toBe(true)
  })

  it('incluye el costo resuelto', () => {
    const row = coachRequestToRow(makeTelemetry({ model: 'gemini-2.5-flash' }))
    expect(row['estimated_cost_usd']).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/_shared/__tests__/coachRequestTelemetry.test.ts`
Expected: FAIL — `Failed to resolve import "../coachRequestTelemetry"`.

- [ ] **Step 3: Write minimal implementation**

Crear `netlify/functions/_shared/coachRequestTelemetry.ts`:

```typescript
import { estimateCostUsd } from '../../../src/services/planBuilder/pricing'

/**
 * Modelo que registra el bypass determinista (`coach.ts:1571`). No corresponde
 * a ninguna llamada a proveedor: su costo real es cero, no desconocido.
 */
export const DETERMINISTIC_BYPASS_MODEL = 'local_regex (deterministic_bypass)'

export type CoachRequestClass =
  | 'chat_general'
  | 'chat_action'
  | 'weekly_summary'
  | 'week_creator'
  | 'plan_builder_week'
  | 'plan_builder_pair'
  | 'import_extract'

export interface CoachRequestTelemetry {
  traceId: string
  userId: string
  generationId?: string
  logicalAttempt?: number
  requestClass: CoachRequestClass
  /** Transporte efectivo, no el solicitado. Ver spec §4.0. */
  streamed: boolean
  outcome: 'ok' | 'error'
  errorCode?: string
  finishReason?: string
  retryUsed?: boolean
  fallbackUsed?: boolean
  authDurationMs: number
  providerDurationMs?: number
  serverDurationMs: number
  provider?: string
  model?: string
  serviceTier?: string
  reasoningEffort?: string
  promptTokens?: number
  completionTokens?: number
  reasoningTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  responseCharCount?: number
  createdAt: number
}

/**
 * Tres estados, no dos (spec §5.1):
 *   0    -> bypass determinista: costo conocido y cero
 *   null -> precio no disponible o usage insuficiente
 *   n    -> costo estimado con la tabla fechada
 */
export function resolveCoachRequestCostUsd(telemetry: CoachRequestTelemetry): number | null {
  if (telemetry.model === DETERMINISTIC_BYPASS_MODEL) return 0
  if (!telemetry.model) return null
  const { promptTokens, completionTokens } = telemetry
  if (typeof promptTokens !== 'number' || typeof completionTokens !== 'number') return null
  return estimateCostUsd({
    model: telemetry.model,
    at: telemetry.createdAt,
    inputTokens: promptTokens,
    outputTokens: completionTokens,
    cacheReadTokens: telemetry.cacheReadInputTokens ?? 0,
    cacheCreationTokens: telemetry.cacheCreationInputTokens ?? 0,
  })
}

function orNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : value
}

export function coachRequestToRow(telemetry: CoachRequestTelemetry): Record<string, unknown> {
  return {
    trace_id: telemetry.traceId,
    user_id: telemetry.userId,
    generation_id: orNull(telemetry.generationId),
    logical_attempt: orNull(telemetry.logicalAttempt),
    request_class: telemetry.requestClass,
    streamed: telemetry.streamed,
    outcome: telemetry.outcome,
    error_code: orNull(telemetry.errorCode),
    finish_reason: orNull(telemetry.finishReason),
    retry_used: orNull(telemetry.retryUsed),
    fallback_used: orNull(telemetry.fallbackUsed),
    auth_duration_ms: telemetry.authDurationMs,
    provider_duration_ms: orNull(telemetry.providerDurationMs),
    server_duration_ms: telemetry.serverDurationMs,
    provider: orNull(telemetry.provider),
    model: orNull(telemetry.model),
    service_tier: orNull(telemetry.serviceTier),
    reasoning_effort: orNull(telemetry.reasoningEffort),
    prompt_tokens: orNull(telemetry.promptTokens),
    completion_tokens: orNull(telemetry.completionTokens),
    reasoning_tokens: orNull(telemetry.reasoningTokens),
    cache_creation_input_tokens: orNull(telemetry.cacheCreationInputTokens),
    cache_read_input_tokens: orNull(telemetry.cacheReadInputTokens),
    response_char_count: orNull(telemetry.responseCharCount),
    estimated_cost_usd: resolveCoachRequestCostUsd(telemetry),
    created_at: new Date(telemetry.createdAt).toISOString(),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/_shared/__tests__/coachRequestTelemetry.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

Agrupar: `netlify/functions/_shared/coachRequestTelemetry.ts` y su test.
Mensaje sugerido: `feat(telemetry): map coach requests to rows with three-state cost`

---

### Task 2: Migración `018` y guard de drift

**Files:**
- Create: `supabase/018_coach_requests.sql`
- Create: `netlify/functions/_shared/__tests__/coachRequestSchema.test.ts`

**Interfaces:**
- Consumes: `coachRequestToRow` y `CoachRequestTelemetry` de Task 1.
- Produces: la tabla `public.coach_requests` con 27 columnas SQL (26 escritas
  por el mapper + `id` generada por PostgreSQL) y dos policies.

- [ ] **Step 1: Write the failing test**

Crear `netlify/functions/_shared/__tests__/coachRequestSchema.test.ts`:

```typescript
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { coachRequestToRow, type CoachRequestTelemetry } from '../coachRequestTelemetry'

function readMigration(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return readFileSync(join(here, '..', '..', '..', '..', 'supabase', '018_coach_requests.sql'), 'utf8')
}

const TELEMETRY: CoachRequestTelemetry = {
  traceId: 't', userId: 'u', requestClass: 'chat_general', streamed: true,
  outcome: 'ok', authDurationMs: 1, serverDurationMs: 2, createdAt: 3,
}

describe('coach_requests schema drift guard', () => {
  it('las columnas del CREATE y las claves del mapper son el mismo conjunto', () => {
    const sql = readMigration()
    const createBlock = sql.slice(
      sql.indexOf('create table if not exists public.coach_requests'),
      sql.indexOf('create index'),
    )
    const sqlColumns = new Set(
      // La clase incluye 0-9 porque hay identificadores con dígitos; sin eso
      // el tokenizer los trunca.
      [...createBlock.matchAll(/^\s{2}([a-z0-9_]+)\s/gm)]
        .map((m) => m[1])
        .filter((name) => name !== 'id')
        .filter((name) => !['create', 'primary', 'constraint', 'check', 'references'].includes(name)),
    )
    const rowColumns = new Set(Object.keys(coachRequestToRow(TELEMETRY)))

    expect([...rowColumns].filter((c) => !sqlColumns.has(c))).toEqual([])
    expect([...sqlColumns].filter((c) => !rowColumns.has(c))).toEqual([])
  })

  it('declara RLS con select e insert propios y sin update ni delete para clientes', () => {
    const sql = readMigration()
    expect(sql).toContain('alter table public.coach_requests enable row level security')
    expect(sql).toMatch(/create policy coach_requests_select_own[\s\S]*?for select[\s\S]*?using \(auth\.uid\(\) = user_id\)/)
    expect(sql).toMatch(/create policy coach_requests_insert_own[\s\S]*?for insert[\s\S]*?with check \(auth\.uid\(\) = user_id\)/)
    expect(sql).not.toMatch(/for update/)
    expect(sql).not.toMatch(/for delete/)
  })

  it('restringe request_class a las 7 clases y outcome a las 2', () => {
    const sql = readMigration()
    for (const requestClass of [
      'chat_general', 'chat_action', 'weekly_summary', 'week_creator',
      'plan_builder_week', 'plan_builder_pair', 'import_extract',
    ]) {
      expect(sql).toContain(`'${requestClass}'`)
    }
    expect(sql).toMatch(/outcome text not null check \(outcome in \('ok', 'error'\)\)/)
  })

  it('user_id es not null con FK a auth.users y cascade', () => {
    const sql = readMigration()
    expect(sql).toMatch(/user_id uuid not null references auth\.users\(id\) on delete cascade/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/_shared/__tests__/coachRequestSchema.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open '.../supabase/018_coach_requests.sql'`.

- [ ] **Step 3: Write minimal implementation**

Crear `supabase/018_coach_requests.sql`:

```sql
-- Telemetría por request del coach síncrono (las 7 clases que pasan por
-- netlify/functions/coach.ts). El Plan Builder async NO pasa por acá: está
-- cubierto por 016 (plan_generation_jobs / plan_generation_attempts).
--
-- Escritura con el token del usuario, no service role: por eso hay policy de
-- insert propio. Sin update ni delete para clientes; el borrado lo hace la
-- retención con service role desde otra función.
--
-- Sin contenido de mensajes: solo conteos y metadata.

create table if not exists public.coach_requests (
  id bigint generated always as identity primary key,
  trace_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  generation_id text null,
  -- Alineado con la validación de request (`coach.ts:447` acepta 1..10).
  -- No se replica el tope: acoplar la tabla a esa constante la haría frágil.
  logical_attempt smallint null check (logical_attempt >= 1),
  request_class text not null check (request_class in (
    'chat_general', 'chat_action', 'weekly_summary', 'week_creator',
    'plan_builder_week', 'plan_builder_pair', 'import_extract'
  )),
  streamed boolean not null,
  outcome text not null check (outcome in ('ok', 'error')),
  error_code text null,
  finish_reason text null,
  retry_used boolean null,
  fallback_used boolean null,
  auth_duration_ms integer not null check (auth_duration_ms >= 0),
  provider_duration_ms integer null check (provider_duration_ms >= 0),
  server_duration_ms integer not null check (server_duration_ms >= 0),
  provider text null,
  model text null,
  service_tier text null,
  reasoning_effort text null,
  prompt_tokens integer null check (prompt_tokens >= 0),
  completion_tokens integer null check (completion_tokens >= 0),
  reasoning_tokens integer null check (reasoning_tokens >= 0),
  cache_creation_input_tokens integer null check (cache_creation_input_tokens >= 0),
  cache_read_input_tokens integer null check (cache_read_input_tokens >= 0),
  response_char_count integer null check (response_char_count >= 0),
  estimated_cost_usd numeric(12, 6) null check (estimated_cost_usd >= 0),
  created_at timestamptz not null default now()
);

comment on column public.coach_requests.streamed is
  'Transporte efectivo, no el solicitado. El bypass determinista respeta req.stream (coach.ts:1603).';
comment on column public.coach_requests.estimated_cost_usd is
  'Tres estados: 0 = bypass determinista (costo cero conocido); null = precio no disponible o usage insuficiente; n = estimado. null NUNCA significa cero.';

create index if not exists coach_requests_user_created_idx
  on public.coach_requests (user_id, created_at desc);
create index if not exists coach_requests_class_created_idx
  on public.coach_requests (request_class, created_at desc);
create index if not exists coach_requests_trace_created_idx
  on public.coach_requests (trace_id, created_at desc);

alter table public.coach_requests enable row level security;

drop policy if exists coach_requests_select_own on public.coach_requests;
create policy coach_requests_select_own
  on public.coach_requests
  for select
  using (auth.uid() = user_id);

drop policy if exists coach_requests_insert_own on public.coach_requests;
create policy coach_requests_insert_own
  on public.coach_requests
  for insert
  with check (auth.uid() = user_id);

-- Sin UPDATE ni DELETE para clientes. La retención usa service role.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/_shared/__tests__/coachRequestSchema.test.ts`
Expected: PASS — 4 tests. Si el primero falla, el diff dice exactamente qué columna sobra o falta de cada lado.

- [ ] **Step 5: Commit**

Agrupar: `supabase/018_coach_requests.sql` y su guard.
Mensaje sugerido: `feat(telemetry): add 018 coach_requests table with drift guard`

---

### Task 3: Insert best-effort con aborto real

**Files:**
- Modify: `netlify/functions/_shared/coachRequestTelemetry.ts`
- Modify: `netlify/functions/_shared/__tests__/coachRequestTelemetry.test.ts`

**Interfaces:**
- Consumes: `coachRequestToRow` de Task 1.
- Produces: `COACH_REQUEST_INSERT_TIMEOUT_MS` (const, `3_000`), `insertCoachRequestRow(client: CoachRequestInsertClient, telemetry: CoachRequestTelemetry): Promise<'ok' | 'failed'>`. **Nunca lanza.**

- [ ] **Step 1: Write the failing test**

Agregar al final de `netlify/functions/_shared/__tests__/coachRequestTelemetry.test.ts`:

```typescript
import { insertCoachRequestRow, COACH_REQUEST_INSERT_TIMEOUT_MS } from '../coachRequestTelemetry'

describe('insertCoachRequestRow', () => {
  function makeClient(result: { error: unknown } | Error) {
    const abortSignal = vi.fn(
      async (_signal: AbortSignal): Promise<{ error: unknown }> => {
        if (result instanceof Error) throw result
        return result
      },
    )
    const insert = vi.fn((_row: Record<string, unknown>) => ({ abortSignal }))
    const from = vi.fn((_table: string) => ({ insert }))
    return { client: { from }, from, insert, abortSignal }
  }

  it('inserta en coach_requests y devuelve ok', async () => {
    const { client, from, insert } = makeClient({ error: null })

    await expect(insertCoachRequestRow(client, makeTelemetry())).resolves.toBe('ok')
    expect(from).toHaveBeenCalledWith('coach_requests')
    expect(insert).toHaveBeenCalledWith(coachRequestToRow(makeTelemetry()))
  })

  // Se espía `AbortSignal.timeout` en vez de avanzar timers: el temporizador
  // del built-in es nativo y `vi.useFakeTimers()` no lo controla de forma
  // confiable. Lo que hay que probar es nuestro contrato —que se pide un
  // aborto real, con el plazo correcto, y que ese signal es el que llega a
  // supabase-js—, no la semántica temporal del built-in.
  it('pide un AbortSignal.timeout con el plazo configurado y lo pasa al insert', async () => {
    const controller = new AbortController()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    try {
      const { client, abortSignal } = makeClient({ error: null })

      await insertCoachRequestRow(client, makeTelemetry())

      expect(timeoutSpy).toHaveBeenCalledWith(COACH_REQUEST_INSERT_TIMEOUT_MS)
      // El signal que se pide es exactamente el que se adjunta: si se
      // construyera uno y se pasara otro, el fetch nunca se abortaría.
      expect(abortSignal).toHaveBeenCalledWith(controller.signal)
    } finally {
      timeoutSpy.mockRestore()
    }
  })

  it('adjunta un AbortSignal real cuando no se espía el built-in', async () => {
    const { client, abortSignal } = makeClient({ error: null })

    await insertCoachRequestRow(client, makeTelemetry())

    expect(abortSignal.mock.calls[0]![0]).toBeInstanceOf(AbortSignal)
  })

  // supabase-js normalmente NO rechaza al abortar: devuelve { error, status: 0 }
  it('se traga un error devuelto y no lanza', async () => {
    const { client } = makeClient({ error: { message: 'aborted', status: 0 } })
    await expect(insertCoachRequestRow(client, makeTelemetry())).resolves.toBe('failed')
  })

  // ...pero si alguna vez lanza (TimeoutError, red caída), tampoco puede escapar
  it('se traga una excepción lanzada y no lanza', async () => {
    const { client } = makeClient(new Error('TimeoutError'))
    await expect(insertCoachRequestRow(client, makeTelemetry())).resolves.toBe('failed')
  })
})
```

Agregar `vi` al import de vitest en la primera línea del archivo:

```typescript
import { describe, expect, it, vi } from 'vitest'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/_shared/__tests__/coachRequestTelemetry.test.ts`
Expected: FAIL — `insertCoachRequestRow is not a function` / import no resuelve.

- [ ] **Step 3: Write minimal implementation**

Agregar al final de `netlify/functions/_shared/coachRequestTelemetry.ts`:

```typescript
/**
 * Plazo del insert. El corte es el AbortSignal, no un race: `withTimeout`
 * (promiseTimeout.ts) deja de esperar pero no cancela el fetch, y un fetch vivo
 * sigue ocupando el event loop.
 */
export const COACH_REQUEST_INSERT_TIMEOUT_MS = 3_000

export interface CoachRequestInsertClient {
  from(table: string): {
    insert(row: Record<string, unknown>): {
      abortSignal(signal: AbortSignal): PromiseLike<{ error: unknown }>
    }
  }
}

/**
 * Best-effort: NUNCA lanza y nunca altera el camino caliente. Devuelve estado
 * en vez de propagar, y no distingue formas de error a propósito — supabase-js
 * devuelve `{ error, status: 0 }` al abortar en vez de rechazar, y
 * `AbortSignal.timeout()` produce `TimeoutError`, no `AbortError`.
 */
export async function insertCoachRequestRow(
  client: CoachRequestInsertClient,
  telemetry: CoachRequestTelemetry,
): Promise<'ok' | 'failed'> {
  try {
    const { error } = await client
      .from('coach_requests')
      .insert(coachRequestToRow(telemetry))
      .abortSignal(AbortSignal.timeout(COACH_REQUEST_INSERT_TIMEOUT_MS))
    return error ? 'failed' : 'ok'
  } catch {
    return 'failed'
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/_shared/__tests__/coachRequestTelemetry.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

Mensaje sugerido: `feat(telemetry): insert coach request rows best-effort with real abort`

> **Por qué no hay test de "el fetch se cancela de verdad".** Que abortar el
> signal libere el socket es comportamiento de `undici`/`fetch`, no nuestro. Lo
> que sí es nuestro —y está cubierto— es pedir el timeout con el plazo correcto
> y adjuntar *ese mismo* signal al insert. Si alguna vez se reemplaza
> `.abortSignal()` por `withTimeout`, estos tests fallan, que es exactamente la
> regresión que importa atrapar.

---

### Task 4: Plomería en `coach.ts`

**Files:**
- Modify: `netlify/functions/coach.ts` (`streamResponse` en `:1434-1437`, los 6 call sites de `logCoachRequest`, y el handler)
- Create: `netlify/functions/__tests__/coachRequestPersistence.test.ts`

> **Por qué el test va en `netlify/functions/__tests__/`.** `tsconfig.node.json`
> incluye `netlify/functions` **sin excluir tests** y declara `types: ["node"]`;
> `tsconfig.app.json` incluye `src` pero **excluye** `src/**/*.test.ts`. O sea:
> un test bajo `src/**/__tests__/` **no lo typechequea nadie** cuando corre
> `npx tsc --noEmit`. Ubicarlo en `netlify/functions/__tests__/` le da tipos de
> Node automáticamente —sin `/// <reference types="node" />`— y lo pone bajo
> typecheck real.
>
> El comentario que `coachFunction.test.ts` lleva arriba («no lo cubre ningún
> tsconfig del proyecto») no es una justificación de esa ubicación: es la
> descripción de un problema que este test **no** debe heredar.
>
> Lo que sí se replica de ahí es el mock de `@netlify/functions`, que es
> necesario en cualquier ubicación: sin él se ejerce el wrapper de AWS
> (`awslambda`) en vez del handler.
>
> **Consecuencia práctica:** como el archivo *sí* se typechequea, y
> `tsconfig.node.json` tiene `strict`, `noUnusedLocals` y `noUnusedParameters`
> activos, el tipado del mock y de los helpers del test no es cosmético — un
> error ahí rompe `npx tsc --noEmit`. Los parámetros sin usar van con prefijo
> `_`, que TypeScript ignora.

**Interfaces:**
- Consumes: `insertCoachRequestRow`, `CoachRequestTelemetry` de Tasks 1 y 3.
- Produces: `recordCoachRequest(payload, persistence?)` interno a `coach.ts`. No se exporta.

**Contexto necesario:** los 6 call sites y su valor de `streamed`:

| Línea | Situación | `streamed` | ¿Persiste? |
|---|---|---|---|
| `:1457` | stream, éxito | `true` | sí |
| `:1484` | stream, error | `true` | sí |
| `:1544` | auth fallida | `Boolean(req.stream)` | **no** (sin usuario) |
| `:1586` | bypass | `Boolean(req.stream)` | sí |
| `:1626` | no-stream, éxito | `false` | sí |
| `:1653` | no-stream, error | `false` | sí |

- [ ] **Step 1: Write the failing test**

El primer ciclo **debe** incluir una aserción positiva: un test que solo afirme
"no se inserta" ya pasa hoy, antes del wiring, así que no probaría nada. Por eso
el caso rojo real es una request **autenticada** al bypass que **sí** debe
insertar.

Se usa el bypass porque no llama a ningún proveedor: no hay que mockear la
cadena de providers. El mensaje `'pon descanso el lunes'` está verificado como
disparador en `src/services/__tests__/coachFunction.test.ts:204`.

Crear `netlify/functions/__tests__/coachRequestPersistence.test.ts`:

```typescript
// Cubierto por tsconfig.node.json (include: netlify/functions, types: ["node"]),
// así que los tipos de Node llegan solos y el archivo entra en `tsc --noEmit`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CoachRequestTelemetry } from '../_shared/coachRequestTelemetry'

// Sin este mock se ejerce el wrapper de AWS (`awslambda`) en vez del handler.
vi.mock('@netlify/functions', () => ({
  stream: <T>(handler: T) => handler,
}))

const mocks = vi.hoisted(() => ({
  insertRow: vi.fn<
    (client: unknown, telemetry: CoachRequestTelemetry) => Promise<'ok' | 'failed'>
  >(async () => 'ok'),
  createClient: vi.fn((..._args: unknown[]) => ({ __client: true })),
}))

vi.mock('../_shared/coachRequestTelemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_shared/coachRequestTelemetry')>()
  return { ...actual, insertCoachRequestRow: mocks.insertRow }
})
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))

const AUTHED_USER_ID = '11111111-1111-4111-8111-111111111111'
/** Disparador verificado del bypass determinista (coachFunction.test.ts:204). */
const BYPASS_MESSAGE = 'pon descanso el lunes'

interface HandlerResult {
  statusCode: number
  body?: unknown
  headers?: Record<string, string>
}

async function callHandler(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<HandlerResult> {
  const { handler } = await import('../coach')
  const result = await (handler as unknown as (
    event: unknown,
    context: unknown,
    callback: () => void,
  ) => Promise<HandlerResult>)(
    { httpMethod: 'POST', body: JSON.stringify(body), headers },
    {},
    () => undefined,
  )
  return result
}

function stubAuthFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ id: AUTHED_USER_ID }),
  })))
}

/** Deja que corra el `void insert(...)` disparado sin await. */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('persistencia de telemetría del coach', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.insertRow.mockClear()
    mocks.insertRow.mockResolvedValue('ok')
    mocks.createClient.mockClear()
    // `vi.stubEnv` en vez de asignar `process.env` directo: se revierte entero
    // en afterEach y no contamina a los demás tests que comparten el worker.
    // `coach.ts` lee AUTH_REQUIRED a nivel de módulo, así que el stub tiene que
    // estar puesto antes del `await import(...)` que hace `callHandler` —
    // garantizado por el `vi.resetModules()` de arriba.
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_ANON_KEY', 'anon')
    vi.stubEnv('COACH_PROXY_REQUIRE_AUTH', 'true')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('persiste una fila para una request autenticada', async () => {
    stubAuthFetch()

    await callHandler(
      { systemPrompt: 's', userMessage: BYPASS_MESSAGE, requestClass: 'chat_action', stream: false },
      { authorization: 'Bearer tok' },
    )
    await flushMicrotasks()

    expect(mocks.insertRow).toHaveBeenCalledTimes(1)
    const telemetry = mocks.insertRow.mock.calls[0]![1]
    expect(telemetry.userId).toBe(AUTHED_USER_ID)
    expect(telemetry.requestClass).toBe('chat_action')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/__tests__/coachRequestPersistence.test.ts`
Expected: FAIL — `expected "insertRow" to be called 1 times, but got 0 times`. Ese es el fallo correcto: el wiring no existe. Si en cambio falla por no resolver `../_shared/coachRequestTelemetry`, entonces falta completar la Task 1/3 antes de seguir.

- [ ] **Step 3: Write minimal implementation**

En `netlify/functions/coach.ts`:

**3a.** Agregar imports arriba, junto a los demás:

```typescript
import { createClient } from '@supabase/supabase-js'
import {
  insertCoachRequestRow,
  type CoachRequestTelemetry,
} from './_shared/coachRequestTelemetry'
```

**3b.** Agregar debajo de `logCoachRequest` (después de la línea `621`):

```typescript
/** Literal que usa `resolveAuthContext` cuando AUTH_REQUIRED es false. */
const ANONYMOUS_USER_ID = 'anonymous'

/**
 * Loguea siempre y persiste cuando hay un usuario real. La persistencia es
 * best-effort y sin `await`: el cliente espera el cierre del stream, así que
 * bloquear acá le agregaría latencia a cada request (spec §6.1).
 */
function recordCoachRequest(
  payload: Parameters<typeof logCoachRequest>[0] & { streamed: boolean },
  persistence?: { userId: string; token: string },
): void {
  logCoachRequest(payload)
  if (!persistence) return
  if (!persistence.userId || persistence.userId === ANONYMOUS_USER_ID) return

  const url = process.env['SUPABASE_URL'] ?? process.env['VITE_SUPABASE_URL']
  const anonKey = process.env['SUPABASE_ANON_KEY'] ?? process.env['VITE_SUPABASE_ANON_KEY']
  if (!url || !anonKey) return

  const telemetry: CoachRequestTelemetry = {
    traceId: payload.traceId,
    userId: persistence.userId,
    generationId: payload.generationId,
    logicalAttempt: payload.logicalAttempt,
    requestClass: payload.requestClass,
    streamed: payload.streamed,
    outcome: payload.outcome,
    errorCode: payload.errorCode,
    finishReason: payload.finishReason,
    retryUsed: payload.retryUsed,
    fallbackUsed: payload.fallbackUsed,
    authDurationMs: payload.authDurationMs,
    providerDurationMs: payload.providerDurationMs,
    serverDurationMs: payload.serverDurationMs,
    provider: payload.provider,
    model: payload.model,
    serviceTier: payload.serviceTier,
    reasoningEffort: payload.reasoningEffort,
    promptTokens: payload.promptTokens,
    completionTokens: payload.completionTokens,
    reasoningTokens: payload.reasoningTokens,
    cacheCreationInputTokens: payload.cacheCreationInputTokens,
    cacheReadInputTokens: payload.cacheReadInputTokens,
    responseCharCount: payload.responseCharCount,
    createdAt: Date.now(),
  }

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${persistence.token}` } },
  })

  void insertCoachRequestRow(client as never, telemetry).then((status) => {
    if (status === 'failed' && typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('[coach] telemetry insert failed', { traceId: telemetry.traceId })
    }
  })
}
```

**3c.** Agregar `streamed` al tipo del payload de `logCoachRequest` (línea `591`) como campo **obligatorio**. El rollout segmenta por esa dimensión en los dos lados del contraste, así que un evento sin ella no sirve; hacerlo opcional dejaría que un call site futuro lo omitiera en silencio:

```typescript
function logCoachRequest(payload: {
  traceId: string
  // ...campos existentes sin cambios...
  errorCode?: TechnicalErrorCode
  /** Transporte efectivo. Obligatorio: el rollout segmenta por esta dimensión. */
  streamed: boolean
}): void {
```

Al hacerlo obligatorio, TypeScript va a marcar los 6 call sites hasta que todos
lo pasen — que es exactamente la red que queremos. Completar el paso **3e**
antes de correr el typecheck.

**3d.** Cambiar la firma de `streamResponse` (línea `1434`) para recibir la persistencia:

```typescript
function streamResponse(
  req: CoachRequest,
  timing: { requestReceivedAt: number; authDurationMs: number },
  persistence?: { userId: string; token: string },
): StreamingResponse {
```

**3e.** En los 6 call sites, reemplazar `logCoachRequest({...})` por `recordCoachRequest({...}, persistence)` agregando `streamed` según la tabla de arriba. Ejemplo del sitio `:1457`:

```typescript
          recordCoachRequest({
            traceId: result.traceId,
            generationId: req.generationId,
            logicalAttempt: req.logicalAttempt,
            requestClass,
            outcome: 'ok',
            streamed: true,
            // ...resto de campos sin cambios...
          }, persistence)
```

En el sitio de auth fallida (`:1544`) **no** se pasa `persistence`:

```typescript
    recordCoachRequest({
      // ...campos existentes...
      streamed: Boolean(req.stream),
    })
```

**3f.** En el handler, capturar el token y armar la persistencia después de resolver auth:

```typescript
  const authStartedAt = Date.now()
  let authDurationMs = 0
  let persistence: { userId: string; token: string } | undefined
  try {
    const auth = await resolveAuthContext(event)
    enforceRateLimit(auth)
    authDurationMs = Date.now() - authStartedAt
    const token = getBearerToken(event)
    if (token && auth.userId !== ANONYMOUS_USER_ID) {
      persistence = { userId: auth.userId, token }
    }
  } catch (error) {
```

Y pasar `persistence` a `streamResponse`:

```typescript
  if (req.stream) {
    return streamResponse(req, { requestReceivedAt, authDurationMs }, persistence)
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/__tests__/coachRequestPersistence.test.ts`
Expected: PASS — 1 test.

- [ ] **Step 5: Verify nothing else broke**

Run: `npx vitest run netlify/ src/services/__tests__/coachFunction.test.ts && npx tsc --noEmit`
Expected: PASS, sin errores de tipo. `coachFunction.test.ts` entra explícitamente porque es el otro consumidor del handler y el cambio de firma de `logCoachRequest` lo puede romper.

- [ ] **Step 6: Add the remaining wiring tests**

Agregar a `netlify/functions/__tests__/coachRequestPersistence.test.ts`, dentro del
mismo `describe`:

```typescript
  it('el bypass con stream:true persiste streamed=true', async () => {
    stubAuthFetch()

    await callHandler(
      { systemPrompt: 's', userMessage: BYPASS_MESSAGE, requestClass: 'chat_action', stream: true },
      { authorization: 'Bearer tok' },
    )
    await flushMicrotasks()

    expect(mocks.insertRow).toHaveBeenCalledTimes(1)
    expect(mocks.insertRow.mock.calls[0]![1].streamed).toBe(true)
  })

  it('el bypass con stream:false persiste streamed=false', async () => {
    stubAuthFetch()

    await callHandler(
      { systemPrompt: 's', userMessage: BYPASS_MESSAGE, requestClass: 'chat_action', stream: false },
      { authorization: 'Bearer tok' },
    )
    await flushMicrotasks()

    expect(mocks.insertRow).toHaveBeenCalledTimes(1)
    expect(mocks.insertRow.mock.calls[0]![1].streamed).toBe(false)
  })

  it('no persiste en modo dev sin auth: userId es el literal anonymous', async () => {
    vi.stubEnv('COACH_PROXY_REQUIRE_AUTH', 'false')

    await callHandler(
      { systemPrompt: 's', userMessage: BYPASS_MESSAGE, requestClass: 'chat_action', stream: false },
    )
    await flushMicrotasks()

    expect(mocks.insertRow).not.toHaveBeenCalled()
  })

  it('no persiste cuando la autenticación falla', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))

    await callHandler(
      { systemPrompt: 's', userMessage: BYPASS_MESSAGE, requestClass: 'chat_action', stream: false },
      { authorization: 'Bearer malo' },
    )
    await flushMicrotasks()

    expect(mocks.insertRow).not.toHaveBeenCalled()
  })

  it('un fallo de Supabase no altera la respuesta del coach ni lanza', async () => {
    stubAuthFetch()
    mocks.insertRow.mockResolvedValue('failed')

    const response = await callHandler(
      { systemPrompt: 's', userMessage: BYPASS_MESSAGE, requestClass: 'chat_action', stream: false },
      { authorization: 'Bearer tok' },
    )
    await flushMicrotasks()

    expect(response.statusCode).toBe(200)
  })
```

- [ ] **Step 7: Run the full wiring suite**

Run: `npx vitest run netlify/functions/__tests__/coachRequestPersistence.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 8: Commit**

Agrupar: `netlify/functions/coach.ts` y `netlify/functions/__tests__/coachRequestPersistence.test.ts`.
Mensaje sugerido: `feat(telemetry): persist coach requests for authenticated users`

---

### Task 5: Retención a 90 días

**Files:**
- Modify: `netlify/functions/_shared/planGenerationTelemetryRetention.ts`
- Modify: `netlify/functions/_shared/planGenerationTelemetryRetention.test.ts`

**Interfaces:**
- Consumes: `PLAN_GENERATION_TELEMETRY_RETENTION_DAYS` ya exportada (valor `90`).
- Produces: `deleteExpiredCoachRequests(client: RetentionClient, now?: number): Promise<number>`.

- [ ] **Step 1: Write the failing test**

Agregar a `netlify/functions/_shared/planGenerationTelemetryRetention.test.ts`:

```typescript
describe('deleteExpiredCoachRequests', () => {
  it('borra filas de coach_requests más viejas que el corte de 90 días', async () => {
    const lt = vi.fn(async () => ({ count: 7, error: null }))
    const from = vi.fn(() => ({ delete: () => ({ lt }) }))
    const now = Date.parse('2026-08-05T12:00:00.000Z')

    const deleted = await deleteExpiredCoachRequests({ from }, now)

    expect(deleted).toBe(7)
    expect(from).toHaveBeenCalledWith('coach_requests')
    expect(lt).toHaveBeenCalledWith(
      'created_at',
      new Date(now - PLAN_GENERATION_TELEMETRY_RETENTION_DAYS * 86_400_000).toISOString(),
    )
  })

  it('falla visiblemente cuando Supabase rechaza la limpieza', async () => {
    const from = () => ({
      delete: () => ({ lt: async () => ({ count: null, error: { message: 'denied' } }) }),
    })
    await expect(deleteExpiredCoachRequests({ from })).rejects.toThrow('denied')
  })
})
```

Y agregar `deleteExpiredCoachRequests` al import del archivo.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/_shared/planGenerationTelemetryRetention.test.ts`
Expected: FAIL — `deleteExpiredCoachRequests is not a function`.

- [ ] **Step 3: Write minimal implementation**

En `netlify/functions/_shared/planGenerationTelemetryRetention.ts`, agregar después de `deleteExpiredPlanGenerationJobs`:

```typescript
export async function deleteExpiredCoachRequests(
  client: RetentionClient,
  now = Date.now(),
): Promise<number> {
  const cutoff = new Date(
    now - PLAN_GENERATION_TELEMETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()
  const { count, error } = await client
    .from('coach_requests')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff)
  if (error) throw new Error(error.message ?? 'telemetry retention failed')
  return count ?? 0
}
```

Y sumarla al `Promise.all` de `runPlanGenerationTelemetryRetention`:

```typescript
    const [deleted, deletedJobs, deletedCoachRequests] = await Promise.all([
      withTimeout(
        deleteExpiredPlanGenerationAttempts(client),
        RETENTION_TIMEOUT_MS,
        'plan generation attempt retention',
      ),
      withTimeout(
        deleteExpiredPlanGenerationJobs(client),
        RETENTION_TIMEOUT_MS,
        'plan generation job retention',
      ),
      withTimeout(
        deleteExpiredCoachRequests(client),
        RETENTION_TIMEOUT_MS,
        'coach request retention',
      ),
    ])
    return {
      statusCode: 200,
      body: JSON.stringify({ deleted, deletedJobs, deletedCoachRequests, durationMs: Date.now() - startedAt }),
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/_shared/planGenerationTelemetryRetention.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

Mensaje sugerido: `feat(telemetry): retain coach_requests for 90 days`

---

### Task 6: Documentación y checklist de rollout

**Files:**
- Modify: `CLAUDE.md`
- Modify: `PROJECT_REVIEW_AND_ROADMAP.md`
- Modify: `OPTIMIZATION_AND_COSTS.md`

**Interfaces:**
- Consumes: nada. Es documentación del estado real al cerrar las Tasks 1-5.

- [ ] **Step 1: Verificación completa antes de documentar**

Run: `npm run lint && npm test && npx tsc --noEmit && npm run build`
Expected: todo verde. Anotar el conteo real de archivos/tests que imprime vitest — se usa en el paso siguiente y **no se inventa**.

- [ ] **Step 2: Actualizar `CLAUDE.md`**

En "Estado actual del producto", cambiar la línea de migraciones a:

```markdown
Migraciones remotas aplicadas hasta `017`; `018_coach_requests.sql` está escrita pero **no aplicada**. Dexie local en **v19**.
```

Y agregar a "Bloques recientes relevantes":

```markdown
- **Telemetría de requests del coach** (`018`, 2026-08-05, sin cambios de Dexie): una fila por request de las 7 clases que pasan por `coach.ts`, con latencia, tokens y costo estimado. Escritura **best-effort** con el token del usuario (no service role) y aborto real a 3 s; una fila perdida nunca altera la respuesta. `estimated_cost_usd` tiene tres estados: `0` para el bypass determinista, `null` para precio ausente o usage insuficiente, numérico en el resto — **`null` nunca significa cero**. `streamed` registra el transporte efectivo. El Plan Builder async no entra acá: ya lo cubre `016`. **Escrita y verificada localmente; `018` no aplicada.** Poblar `MODEL_PRICES` con los modelos de Gemini/OpenAI es trabajo aparte y sin él el costo del chat sigue sin responderse.
```

- [ ] **Step 3: Actualizar `PROJECT_REVIEW_AND_ROADMAP.md`**

Agregar antes de `### Producto Publico Y Marca`:

```markdown
### 22. Telemetría de requests del coach (`018`, 2026-08-05)

El chat era el camino de mayor volumen sin cifra de costo ni de latencia, y eso
bloqueaba fijar el precio del piloto. La entrada 6 del backlog decía que no
tenía instrumentación; era falso. `logCoachRequest` (`coach.ts:591`) ya emitía
duración, tokens, `finishReason` y `outcome` por request — pero como
`console.info`, imposible de agregar. Lo que faltaba era **persistencia**.

`018_coach_requests.sql` guarda una fila por request de las 7 clases que pasan
por `coach.ts`. El Plan Builder **async** no entra: ya lo cubre `016`; las filas
`plan_builder_*` de esta tabla son del camino **síncrono**. No mezclar las dos
fuentes al analizar.

Decisiones que se apartan del contrato de `016`, cada una con su motivo:

- **Escritura con el token del usuario**, no service role, con policy
  `insert with check (auth.uid() = user_id)`. Evita meter
  `SUPABASE_SERVICE_ROLE_KEY` en la función de mayor tráfico del proyecto. A
  cambio, un cliente podría forjar filas: aceptable con 1-3 usuarios de
  confianza, **a revisar si aparece self-serve**.
- **`user_id not null`**, que es lo que exige esa policy. Consecuencia: no se
  persisten las requests en modo dev sin auth (`userId === 'anonymous'`,
  `coach.ts:659`) ni las que fallan la autenticación. Siguen en los
  `console.info`.
- **Best-effort sin `await`**, porque el cliente espera el cierre del stream
  (`ProxyProvider.ts:211-213`) y bloquear ahí le agregaría latencia a cada
  request. El corte es `AbortSignal.timeout(3_000)`: `withTimeout` no cancela
  nada, solo deja de esperar.

`estimated_cost_usd` tiene **tres** estados: `0` para el bypass determinista
(no llamó a ningún proveedor), `null` para precio ausente o usage insuficiente,
numérico en el resto. **`null` nunca significa cero.**

`streamed` registra el transporte efectivo. Existe porque `request_class` no
permite segmentar: quien decide es `req.stream`, y hay dos bifurcaciones sobre
él —la del camino normal (`coach.ts:1618`) y la propia del bypass
(`coach.ts:1603`)—.

**Limitación que esta entrega no resuelve:** `MODEL_PRICES` solo contiene
`claude-sonnet-4-6` (`pricing.ts:22`). Si el chat corre sobre Gemini u OpenAI,
el costo sale `null`. Los tokens se persisten igual, así que es recalculable,
pero responder «cuánto cuesta el chat» exige confirmar los `AI_PROVIDER_*` de
producción y poblar la tabla de precios — **trabajo separado**.
```

Actualizar también el punto 6 del backlog, reemplazando la descripción del
trabajo pendiente por:

```markdown
6. **Chat — latencia y costo.** *(persistencia implementada 2026-08-05, ver
   §22)* Ya no es trabajo de código: queda aplicar `018` en producción, correr
   la verificación de pérdida y latencia del rollout, y poblar `MODEL_PRICES`
   con los modelos que realmente sirven el chat. Sin ese último paso el costo
   del chat sigue sin respuesta, aunque los tokens ya queden guardados.
```

- [ ] **Step 4: Actualizar `OPTIMIZATION_AND_COSTS.md`**

Cambiar la fila del chat en la tabla de §1:

```markdown
| **Chat general / chat action** | `logCoachRequest` + persistencia en `coach_requests` (`018`) | **Instrumentado, pendiente de aplicar `018` y poblar precios.** Los tokens quedan persistidos siempre que el proveedor los reporte; `estimated_cost_usd` es `null` mientras el modelo no esté en `MODEL_PRICES` |
```

Y agregar la regla de consulta:

```markdown
> **`estimated_cost_usd = null` no es cero.** Toda agregación de costo debe
> excluir los nulls y reportar cobertura en **dos** dimensiones: % de filas y
> % de tokens cubiertos. Reportar solo filas engaña, porque las requests caras
> suelen ser pocas.
```

- [ ] **Step 5: Escribir el checklist de rollout en el roadmap**

```markdown
Rollout de `018`:

1. Aplicar `supabase/018_coach_requests.sql` en producción (**manual**).
2. Desplegar el bundle.
3. **Verificar pérdida**, separada por `streamed`: contar filas en
   `coach_requests` contra los eventos `coach.request.completed` de los logs de
   Netlify sobre la misma ventana.
4. **Verificar latencia**, separada por `streamed`: p50/p90 de
   `completedAt - startedAt` de `useAIDebugStore` contra la línea base previa
   al deploy. **No usar `serverDurationMs`**: se calcula antes de la escritura,
   así que mostraría "sin cambios" aunque el usuario espere más.
5. Si hay pérdida material o impacto de latencia en cualquiera de los dos
   caminos, ejecutar la escalada al endpoint dedicado antes de confiar en los
   agregados.
6. Recién entonces, poblar `MODEL_PRICES` (trabajo separado) y agregar la
   sección medida del chat.
```

- [ ] **Step 6: Commit**

Agrupar los tres `.md` de estado **más los dos documentos de diseño**, que
también están sin commitear desde antes de empezar:

- `CLAUDE.md`
- `PROJECT_REVIEW_AND_ROADMAP.md`
- `OPTIMIZATION_AND_COSTS.md`
- `docs/superpowers/specs/2026-08-03-coach-request-telemetry-design.md`
- `docs/superpowers/plans/2026-08-05-coach-request-telemetry.md`

**No incluir `ios/App/App/Info.plist`.** Y si `CLAUDE.md` o
`PROJECT_REVIEW_AND_ROADMAP.md` conservan hunks ajenos a `018` que el owner
quiera separar, usar `git add -p` para dejarlos fuera (ver Global Constraints).

Mensaje sugerido: `docs(telemetry): record 018 design and rollout checklist`

---

## Notas para quien ejecute

- **Corrección de integración posterior al code review.** `trace_id` no es PK:
  `ProxyProvider` lo reutiliza en el fallback streaming→no-streaming. La tabla
  usa `id bigint generated always as identity` y conserva ambas requests;
  `trace_id` queda indexado y no único. El cliente persiste además el transporte
  terminal en `AITechnicalResult.streamed` para que el rollout pueda segmentar
  la latencia real.
- **Lo que este plan no puede probar.** Que la escritura sin `await` efectivamente persista, y que no agregue latencia observable, son propiedades del runtime de Netlify. Un test con Supabase mockeado no las demuestra. Por eso viven en el checklist de rollout (Task 6, Step 5) y no en la suite.
- **`waitUntil` no existe** en `@netlify/functions` v5 (verificado en `node_modules/@netlify/functions/dist/main.d.ts:5-25`). No intentar usarlo. El mecanismo candidato es `callbackWaitsForEmptyEventLoop`, cuyo default `true` puede tanto salvar la escritura como retrasar la respuesta en el camino no-streaming — por eso ambas propiedades se miden.
- **No "arreglar" el `provider: 'gemini'` del bypass** (`coach.ts:1573`). Registra Gemini sin haber llamado a ningún proveedor; es contaminación preexistente, está fuera de alcance, y el análisis debe excluir ese modelo. Cambiarlo acá sería tocar comportamiento ajeno a esta entrega.

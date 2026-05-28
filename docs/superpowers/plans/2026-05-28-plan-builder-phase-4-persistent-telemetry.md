# Plan Builder Fase 4 — Telemetría persistida (condicional)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistir un resumen de cada trace AI y cada feedback de usuario en Supabase, con RLS estricto (cada atleta lee solo lo suyo; admin lee todo) y retención de 90 días. Habilitar análisis cross-sesión cuando la beta privada acumule volumen suficiente.

**Architecture:** Espejo remoto de los stores locales `db.aiRequestLogs` y `db.coachFeedback`. El cliente sigue escribiendo a Dexie como hoy (telemetría local nunca se rompe). Un módulo nuevo `remoteTelemetry` corre fire-and-forget en paralelo, encolando con la misma estrategia que `syncService` para no bloquear el flujo del coach. El resumen remoto es estrictamente menor que el local: nada de `promptTrace` completo, nada de `responsePreview` largo, opt-out por env var.

**Tech Stack:** Supabase (Postgres + RLS), Netlify Functions (para el job de retención si decidimos correrlo server-side), TypeScript, Vitest. Sin nuevas deps en cliente.

**Spec:** `docs/superpowers/specs/2026-05-27-plan-builder-star-product-design.md` — Fase 4 (líneas 274–286).

**Pre-condiciones para empezar (NO ejecutar este plan antes de cumplirlas):**

1. Fase 3 mergeada y verde en producción.
2. Beta privada activa al menos 2 semanas con ≥3 usuarios reales (incluido owner).
3. Volumen mínimo medido: ≥200 `aiRequestLogs` y ≥30 `coachFeedback` en Dexie del propio owner. Si no, el ROI del persistido no justifica la complejidad de schema + RLS + retención.
4. El plan a producción de Supabase del owner soporta agregar dos tablas adicionales sin exceder cuotas.

Si cualquiera de estas falla → no implementar. El spec explícitamente lo marca como out-of-MVP.

**Restricción operativa:** Cada task debe pasar `npm run lint && npm test && npm run build && npm run audit:prompt`. Las migraciones SQL deben correr primero en un proyecto Supabase de staging, no directo en prod del owner.

**⚠️ Política de commits:** UN commit grande al final. NO `git add` ni `git commit` dentro de las tasks. Excepción: la migración SQL puede commitearse junto con su test de smoke separado para que el usuario la pueda aplicar progresivamente, pero solo si el usuario lo pide explícitamente.

---

## Contexto operativo previo

Antes de la primera task, el implementador debería leer en orden:

1. `supabase/003_training_plans_sync.sql` — patrón canónico de tabla + RLS por `user_id`. Las nuevas tablas siguen el mismo formato (text PK, user_id uuid → auth.users, RLS select/insert/update/delete por `auth.uid()`).
2. `src/services/sync/syncSupabase.ts` — `getSupabase()` es el cliente que retorna `null` si no está configurado. Toda escritura remota debe degradar si `getSupabase()` retorna falsy.
3. `src/services/syncService.ts` línea 922 / 1140 — patrón actual de upsert remoto: `pushQueue` con throttling + dedup. Reusar `syncQueue` para telemetría es overkill; mejor un módulo simple con `setTimeout` + max-batch.
4. `src/services/ai/aiTelemetry.ts` — `upsertAIRequestLog`, `recordCoachFeedback`, `getBetaQualitySnapshot`. Aquí entran los hooks remotos.
5. `src/types/index.ts:34-70` — `AITechnicalResult` y `CoachFeedback`. Los campos del resumen remoto son un subset.

**Decisión de modelo:** el resumen remoto NO incluye `promptTrace`, `responsePreview`, `warnings` completos. El cliente publica un objeto stripped, no el log entero. Razón: privacidad (prompt puede incluir nombre del atleta, métricas), tamaño (responsePreview puede ser ~5kb), retención (90 días × 200 logs/día × 5kb = ~90MB por usuario, lo evitamos).

---

## File Structure

```
supabase/
  006_coach_telemetry.sql                          [NEW: coach_request_log + coach_feedback + RLS + retention]

src/services/telemetry/
  remoteTelemetry.ts                               [NEW: cliente push (fire-and-forget)]
  remoteTelemetryQueue.ts                          [NEW: queue local con batching + retry]
  remoteTelemetryConfig.ts                         [NEW: feature flag + opt-out]
  remoteTelemetryStripper.ts                       [NEW: AITechnicalResult → RemoteTraceSummary]
  __tests__/
    remoteTelemetryQueue.test.ts                   [NEW]
    remoteTelemetryStripper.test.ts                [NEW]
    remoteTelemetry.test.ts                        [NEW]

src/services/ai/
  aiTelemetry.ts                                   [MODIFY: hook a remoteTelemetry en upsertAIRequestLog + recordCoachFeedback]

src/services/planBuilder/
  betaQualityPlanRollup.ts                         [MODIFY: opcional read-through a remote para vista admin]
  betaQualityRemote.ts                             [NEW: helper para leer remote por user_id]

src/pages/
  SettingsPage.tsx                                 [MODIFY: toggle "Sync telemetry" + estado de cola]

src/types/
  telemetry.ts                                     [NEW: RemoteTraceSummary + RemoteFeedbackSummary]

netlify/functions/
  telemetry-retention.ts                           [NEW (optional): cron-style cleanup de >90 días]

netlify.toml                                       [MODIFY: scheduled function para retention]
```

---

## Task 1: Migración SQL — `coach_request_log` y `coach_feedback`

**Files:**
- Create: `supabase/006_coach_telemetry.sql`

- [ ] **Step 1: Diseñar el schema**

Crear `supabase/006_coach_telemetry.sql`:

```sql
-- Phase 4: persistent telemetry summary.
-- Each user only sees their own rows; admins (role 'service_role') see all via service key.
-- Retention: 90 days. Cleanup runs server-side (see netlify/functions/telemetry-retention.ts).

create table if not exists public.coach_request_log (
  trace_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  surface text not null,
  request_class text not null,
  provider text null,
  model text null,
  status text not null,
  outcome text null,
  error_code text null,
  retry_used boolean null,
  fallback_used boolean null,
  proposal_created boolean null,
  duration_ms integer null,
  action_count integer null,
  response_char_count integer null,
  started_at bigint not null,
  completed_at bigint null,
  -- No promptTrace, no responsePreview: privacy + size.
  warnings_count integer null,
  client_app_version text null
);

create index if not exists coach_request_log_user_started_idx
  on public.coach_request_log (user_id, started_at desc);

create index if not exists coach_request_log_user_class_idx
  on public.coach_request_log (user_id, request_class, started_at desc);

create table if not exists public.coach_feedback_log (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('coach_message', 'coach_proposal')),
  target_id text not null,
  rating integer not null check (rating in (-1, 1)),
  comment text null,
  trace_id text null,
  chat_message_id text null,
  proposal_id text null,
  request_class text null,
  created_at bigint not null,
  updated_at bigint not null
);

create index if not exists coach_feedback_log_user_created_idx
  on public.coach_feedback_log (user_id, created_at desc);

create index if not exists coach_feedback_log_trace_idx
  on public.coach_feedback_log (trace_id);

-- RLS: each user sees only their own.
alter table public.coach_request_log enable row level security;
alter table public.coach_feedback_log enable row level security;

drop policy if exists "coach_request_log_select_own" on public.coach_request_log;
create policy "coach_request_log_select_own"
  on public.coach_request_log
  for select
  using (auth.uid() = user_id);

drop policy if exists "coach_request_log_insert_own" on public.coach_request_log;
create policy "coach_request_log_insert_own"
  on public.coach_request_log
  for insert
  with check (auth.uid() = user_id);

-- update solo desde service_role (retention/admin).
-- delete solo desde service_role (retention).

drop policy if exists "coach_feedback_log_select_own" on public.coach_feedback_log;
create policy "coach_feedback_log_select_own"
  on public.coach_feedback_log
  for select
  using (auth.uid() = user_id);

drop policy if exists "coach_feedback_log_insert_own" on public.coach_feedback_log;
create policy "coach_feedback_log_insert_own"
  on public.coach_feedback_log
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "coach_feedback_log_update_own" on public.coach_feedback_log;
create policy "coach_feedback_log_update_own"
  on public.coach_feedback_log
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

- [ ] **Step 2: Aplicar en staging**

Subir `006_coach_telemetry.sql` al proyecto Supabase de staging vía SQL editor. Confirmar que las dos tablas existen, RLS está enabled, y que `select * from coach_request_log` retorna `permission denied` cuando se ejecuta sin auth.

- [ ] **Step 3: NO-OP commit** (a menos que el usuario diga lo contrario)

---

## Task 2: Tipos del resumen remoto

**Files:**
- Create: `src/types/telemetry.ts`
- Test: `src/services/telemetry/__tests__/remoteTelemetryStripper.test.ts` (parcialmente)

- [ ] **Step 1: Definir los tipos**

`src/types/telemetry.ts`:

```ts
import type { AIProviderName, AIRequestClass, AITechnicalSurface, CoachFeedback } from './index'

/**
 * Subset of AITechnicalResult that is safe to persist remotely.
 * NO promptTrace, NO responsePreview, NO warnings text — privacy + size.
 */
export interface RemoteTraceSummary {
  traceId: string
  surface: AITechnicalSurface
  requestClass: AIRequestClass
  provider?: AIProviderName
  model?: string
  status: 'started' | 'streaming' | 'completed' | 'failed'
  outcome?: 'ok' | 'truncated_mid' | 'truncated_early' | 'parse_invalid' | 'schema_invalid'
  errorCode?: string
  retryUsed?: boolean
  fallbackUsed?: boolean
  proposalCreated?: boolean
  durationMs?: number
  actionCount?: number
  responseCharCount?: number
  warningsCount?: number
  startedAt: number
  completedAt?: number
  clientAppVersion?: string
}

export type RemoteFeedbackSummary = Pick<CoachFeedback,
  | 'id'
  | 'targetType'
  | 'targetId'
  | 'rating'
  | 'comment'
  | 'traceId'
  | 'chatMessageId'
  | 'proposalId'
  | 'requestClass'
  | 'createdAt'
  | 'updatedAt'
>
```

- [ ] **Step 2: NO-OP commit**

---

## Task 3: Stripper `AITechnicalResult → RemoteTraceSummary`

**Files:**
- Create: `src/services/telemetry/remoteTelemetryStripper.ts`
- Test: `src/services/telemetry/__tests__/remoteTelemetryStripper.test.ts`

- [ ] **Step 1: Test failing**

`src/services/telemetry/__tests__/remoteTelemetryStripper.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { stripTraceForRemote } from '../remoteTelemetryStripper'
import type { AITechnicalResult } from '../../../types'

const log: AITechnicalResult = {
  traceId: 'trace-1',
  surface: 'coach',
  requestClass: 'chat_action',
  provider: 'gemini',
  model: 'gemini-2.5-flash',
  status: 'completed',
  outcome: 'ok',
  retryUsed: false,
  fallbackUsed: false,
  proposalCreated: true,
  durationMs: 1234,
  actionCount: 2,
  responseCharCount: 4321,
  startedAt: 1700000000000,
  completedAt: 1700000001234,
  promptTrace: { provider: 'gemini', requestClass: 'chat_action' } as any,
  responsePreview: 'sensitive content',
  warnings: ['w1', 'w2'],
}

describe('stripTraceForRemote', () => {
  it('strips promptTrace, responsePreview and warnings text', () => {
    const summary = stripTraceForRemote(log)
    expect(summary).not.toHaveProperty('promptTrace')
    expect(summary).not.toHaveProperty('responsePreview')
    expect(summary).not.toHaveProperty('warnings')
    expect(summary.warningsCount).toBe(2)
  })

  it('preserves stable fields', () => {
    const summary = stripTraceForRemote(log)
    expect(summary.traceId).toBe('trace-1')
    expect(summary.requestClass).toBe('chat_action')
    expect(summary.provider).toBe('gemini')
    expect(summary.outcome).toBe('ok')
  })

  it('handles minimal logs (no optional fields)', () => {
    const minimal: AITechnicalResult = {
      traceId: 't', surface: 'coach', requestClass: 'chat_general',
      status: 'started', startedAt: 1,
    }
    const summary = stripTraceForRemote(minimal)
    expect(summary.traceId).toBe('t')
    expect(summary.warningsCount).toBeUndefined()
  })
})
```

- [ ] **Step 2: Verificar fail**

Run: `npx vitest run src/services/telemetry/__tests__/remoteTelemetryStripper.test.ts`
Expected: FAIL "Cannot find module".

- [ ] **Step 3: Implementar**

`src/services/telemetry/remoteTelemetryStripper.ts`:

```ts
import type { AITechnicalResult, CoachFeedback } from '../../types'
import type { RemoteFeedbackSummary, RemoteTraceSummary } from '../../types/telemetry'
import { APP_INFO } from '../../constants/appInfo'

export function stripTraceForRemote(log: AITechnicalResult): RemoteTraceSummary {
  return {
    traceId: log.traceId,
    surface: log.surface,
    requestClass: log.requestClass,
    provider: log.provider,
    model: log.model,
    status: log.status,
    outcome: log.outcome,
    errorCode: log.errorCode,
    retryUsed: log.retryUsed,
    fallbackUsed: log.fallbackUsed,
    proposalCreated: log.proposalCreated,
    durationMs: log.durationMs,
    actionCount: log.actionCount,
    responseCharCount: log.responseCharCount,
    warningsCount: log.warnings?.length,
    startedAt: log.startedAt,
    completedAt: log.completedAt,
    clientAppVersion: APP_INFO?.version,
  }
}

export function stripFeedbackForRemote(feedback: CoachFeedback): RemoteFeedbackSummary {
  return {
    id: feedback.id,
    targetType: feedback.targetType,
    targetId: feedback.targetId,
    rating: feedback.rating,
    comment: feedback.comment,
    traceId: feedback.traceId,
    chatMessageId: feedback.chatMessageId,
    proposalId: feedback.proposalId,
    requestClass: feedback.requestClass,
    createdAt: feedback.createdAt,
    updatedAt: feedback.updatedAt,
  }
}
```

- [ ] **Step 4: Verificar pass**

Run: `npx vitest run src/services/telemetry/__tests__/remoteTelemetryStripper.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: NO-OP commit**

---

## Task 4: Feature flag + opt-out

**Files:**
- Create: `src/services/telemetry/remoteTelemetryConfig.ts`

El push remoto se controla por:
1. `VITE_REMOTE_TELEMETRY_ENABLED === 'true'` (default off).
2. localStorage `telemetry_opt_out === 'true'` (usuario apaga desde Settings).
3. `getSupabase()` retorna non-null (proyecto configurado).

- [ ] **Step 1: Test failing**

`src/services/telemetry/__tests__/remoteTelemetryConfig.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const importFresh = async () => {
  vi.resetModules()
  return await import('../remoteTelemetryConfig')
}

describe('remoteTelemetryConfig', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => {
    Object.assign(import.meta.env, { VITE_REMOTE_TELEMETRY_ENABLED: undefined })
  })

  it('returns false when flag off', async () => {
    const mod = await importFresh()
    expect(mod.isRemoteTelemetryEnabled()).toBe(false)
  })

  it('returns true when flag on and not opted out', async () => {
    Object.assign(import.meta.env, { VITE_REMOTE_TELEMETRY_ENABLED: 'true' })
    const mod = await importFresh()
    expect(mod.isRemoteTelemetryEnabled()).toBe(true)
  })

  it('returns false when user opted out', async () => {
    Object.assign(import.meta.env, { VITE_REMOTE_TELEMETRY_ENABLED: 'true' })
    localStorage.setItem('telemetry_opt_out', 'true')
    const mod = await importFresh()
    expect(mod.isRemoteTelemetryEnabled()).toBe(false)
  })

  it('setOptOut persists in localStorage', async () => {
    const mod = await importFresh()
    mod.setTelemetryOptOut(true)
    expect(localStorage.getItem('telemetry_opt_out')).toBe('true')
    mod.setTelemetryOptOut(false)
    expect(localStorage.getItem('telemetry_opt_out')).toBe('false')
  })
})
```

- [ ] **Step 2: Verificar fail**

Run: `npx vitest run src/services/telemetry/__tests__/remoteTelemetryConfig.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`src/services/telemetry/remoteTelemetryConfig.ts`:

```ts
const OPT_OUT_KEY = 'telemetry_opt_out'

export function isRemoteTelemetryEnabled(): boolean {
  if (import.meta.env.VITE_REMOTE_TELEMETRY_ENABLED !== 'true') return false
  try {
    return localStorage.getItem(OPT_OUT_KEY) !== 'true'
  } catch {
    return true
  }
}

export function isTelemetryOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === 'true'
  } catch {
    return false
  }
}

export function setTelemetryOptOut(value: boolean): void {
  try {
    localStorage.setItem(OPT_OUT_KEY, value ? 'true' : 'false')
  } catch {
    // ignore
  }
}
```

- [ ] **Step 4: Verificar pass**

Run: `npx vitest run src/services/telemetry/__tests__/remoteTelemetryConfig.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: NO-OP commit**

---

## Task 5: Queue local de telemetría remota

**Files:**
- Create: `src/services/telemetry/remoteTelemetryQueue.ts`
- Test: `src/services/telemetry/__tests__/remoteTelemetryQueue.test.ts`

La queue:
- En memoria, no Dexie (la telemetría local ya está en Dexie).
- Flushea cada 5 segundos o cuando supera 25 items.
- Si falla el flush, los items vuelven a la cola con un contador de retries. >3 retries → descartar (no degradar UX por telemetría).

- [ ] **Step 1: Test failing**

`src/services/telemetry/__tests__/remoteTelemetryQueue.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteTelemetryQueue } from '../remoteTelemetryQueue'
import type { RemoteTraceSummary } from '../../../types/telemetry'

const summary = (id: string): RemoteTraceSummary => ({
  traceId: id, surface: 'coach', requestClass: 'chat_general',
  status: 'completed', startedAt: 1,
})

describe('RemoteTelemetryQueue', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('flushes after FLUSH_INTERVAL_MS', async () => {
    const flush = vi.fn().mockResolvedValue(undefined)
    const queue = new RemoteTelemetryQueue({ flush })
    queue.enqueue(summary('a'))
    vi.advanceTimersByTime(5000)
    await vi.runAllTimersAsync()
    expect(flush).toHaveBeenCalledWith([summary('a')])
  })

  it('flushes when batch fills up', async () => {
    const flush = vi.fn().mockResolvedValue(undefined)
    const queue = new RemoteTelemetryQueue({ flush, maxBatchSize: 3 })
    queue.enqueue(summary('a'))
    queue.enqueue(summary('b'))
    queue.enqueue(summary('c'))
    await vi.runAllTimersAsync()
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush.mock.calls[0][0]).toHaveLength(3)
  })

  it('retries failed batches up to 3 times then drops', async () => {
    const flush = vi.fn().mockRejectedValue(new Error('boom'))
    const queue = new RemoteTelemetryQueue({ flush, maxBatchSize: 1 })
    queue.enqueue(summary('a'))
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(5000)
      await vi.runAllTimersAsync()
    }
    expect(flush).toHaveBeenCalledTimes(3) // retries cap at 3
    expect(queue.size).toBe(0) // dropped
  })

  it('coalesces same-traceId updates (later overwrites earlier)', () => {
    const flush = vi.fn().mockResolvedValue(undefined)
    const queue = new RemoteTelemetryQueue({ flush })
    queue.enqueue({ ...summary('a'), status: 'started' })
    queue.enqueue({ ...summary('a'), status: 'completed' })
    expect(queue.size).toBe(1)
  })
})
```

- [ ] **Step 2: Verificar fail**

Run: `npx vitest run src/services/telemetry/__tests__/remoteTelemetryQueue.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`src/services/telemetry/remoteTelemetryQueue.ts`:

```ts
import type { RemoteTraceSummary } from '../../types/telemetry'

interface QueueItem {
  summary: RemoteTraceSummary
  retries: number
}

interface QueueOptions {
  flush: (batch: RemoteTraceSummary[]) => Promise<void>
  flushIntervalMs?: number
  maxBatchSize?: number
  maxRetries?: number
}

export class RemoteTelemetryQueue {
  private readonly items = new Map<string, QueueItem>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly flush: (batch: RemoteTraceSummary[]) => Promise<void>
  private readonly intervalMs: number
  private readonly batchSize: number
  private readonly maxRetries: number
  private flushing = false

  constructor(opts: QueueOptions) {
    this.flush = opts.flush
    this.intervalMs = opts.flushIntervalMs ?? 5000
    this.batchSize = opts.maxBatchSize ?? 25
    this.maxRetries = opts.maxRetries ?? 3
  }

  get size(): number {
    return this.items.size
  }

  enqueue(summary: RemoteTraceSummary): void {
    const existing = this.items.get(summary.traceId)
    this.items.set(summary.traceId, { summary, retries: existing?.retries ?? 0 })
    if (this.items.size >= this.batchSize) {
      void this.runFlush()
    } else if (!this.timer) {
      this.timer = setTimeout(() => { void this.runFlush() }, this.intervalMs)
    }
  }

  async drain(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.runFlush()
  }

  private async runFlush(): Promise<void> {
    if (this.flushing) return
    this.flushing = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const batch = Array.from(this.items.values())
    const summaries = batch.map((i) => i.summary)
    try {
      await this.flush(summaries)
      for (const item of batch) this.items.delete(item.summary.traceId)
    } catch {
      for (const item of batch) {
        const nextRetries = item.retries + 1
        if (nextRetries >= this.maxRetries) {
          this.items.delete(item.summary.traceId)
        } else {
          this.items.set(item.summary.traceId, { ...item, retries: nextRetries })
        }
      }
      if (this.items.size > 0) {
        this.timer = setTimeout(() => { void this.runFlush() }, this.intervalMs)
      }
    } finally {
      this.flushing = false
    }
  }
}
```

- [ ] **Step 4: Verificar pass**

Run: `npx vitest run src/services/telemetry/__tests__/remoteTelemetryQueue.test.ts`
Expected: 4 PASS.

- [ ] **Step 5: NO-OP commit**

---

## Task 6: `remoteTelemetry` push entrypoint

**Files:**
- Create: `src/services/telemetry/remoteTelemetry.ts`
- Test: `src/services/telemetry/__tests__/remoteTelemetry.test.ts`

Entrypoint:
- `pushTrace(log: AITechnicalResult)` — stripa + encola si está enabled.
- `pushFeedback(feedback: CoachFeedback)` — best-effort directo (más raro, no encolamos).
- Lee `getSupabase()` y `auth.uid()` para escribir.

- [ ] **Step 1: Test failing**

`src/services/telemetry/__tests__/remoteTelemetry.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as supabaseMod from '../../sync/syncSupabase'
import * as configMod from '../remoteTelemetryConfig'
import { pushTrace, pushFeedback } from '../remoteTelemetry'

describe('remoteTelemetry', () => {
  beforeEach(() => {
    vi.spyOn(configMod, 'isRemoteTelemetryEnabled').mockReturnValue(true)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('no-ops when disabled', async () => {
    vi.spyOn(configMod, 'isRemoteTelemetryEnabled').mockReturnValue(false)
    const upsert = vi.fn()
    vi.spyOn(supabaseMod, 'getSupabase').mockReturnValue({ from: () => ({ upsert }) } as any)
    await pushTrace(({ traceId: 't', surface: 'coach', requestClass: 'chat_general', status: 'completed', startedAt: 1 }) as any)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('no-ops when getSupabase() is null', async () => {
    vi.spyOn(supabaseMod, 'getSupabase').mockReturnValue(null as any)
    await expect(pushTrace(({ traceId: 't', surface: 'coach', requestClass: 'chat_general', status: 'completed', startedAt: 1 }) as any)).resolves.toBeUndefined()
  })

  it('pushFeedback writes directly to coach_feedback_log', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    vi.spyOn(supabaseMod, 'getSupabase').mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
      from: (table: string) => {
        expect(table).toBe('coach_feedback_log')
        return { upsert }
      },
    } as any)

    await pushFeedback({
      id: 'fb-1', targetType: 'coach_message', targetId: 'm-1', rating: 1,
      createdAt: 1, updatedAt: 1,
    } as any)
    expect(upsert).toHaveBeenCalled()
    const arg = upsert.mock.calls[0][0]
    expect(arg.user_id).toBe('user-1')
    expect(arg.target_type).toBe('coach_message')
  })
})
```

- [ ] **Step 2: Verificar fail**

Run: `npx vitest run src/services/telemetry/__tests__/remoteTelemetry.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`src/services/telemetry/remoteTelemetry.ts`:

```ts
import type { AITechnicalResult, CoachFeedback } from '../../types'
import type { RemoteFeedbackSummary, RemoteTraceSummary } from '../../types/telemetry'
import { getSupabase } from '../sync/syncSupabase'
import { isRemoteTelemetryEnabled } from './remoteTelemetryConfig'
import { stripFeedbackForRemote, stripTraceForRemote } from './remoteTelemetryStripper'
import { RemoteTelemetryQueue } from './remoteTelemetryQueue'

const queue = new RemoteTelemetryQueue({
  flush: async (batch) => {
    const client = getSupabase()
    if (!client) return
    const { data: { user } } = await client.auth.getUser()
    if (!user) return
    const rows = batch.map((s) => mapTraceToRow(s, user.id))
    const { error } = await client.from('coach_request_log').upsert(rows as never)
    if (error) throw error
  },
})

export async function pushTrace(log: AITechnicalResult): Promise<void> {
  if (!isRemoteTelemetryEnabled()) return
  const client = getSupabase()
  if (!client) return
  const summary = stripTraceForRemote(log)
  queue.enqueue(summary)
}

export async function pushFeedback(feedback: CoachFeedback): Promise<void> {
  if (!isRemoteTelemetryEnabled()) return
  const client = getSupabase()
  if (!client) return
  const { data: { user } } = await client.auth.getUser()
  if (!user) return
  const summary = stripFeedbackForRemote(feedback)
  const row = mapFeedbackToRow(summary, user.id)
  const { error } = await client.from('coach_feedback_log').upsert(row as never)
  if (error) {
    // No bloqueante. Telemetría no debe romper UX.
    console.warn('[remoteTelemetry] pushFeedback failed', error)
  }
}

export async function drainTelemetry(): Promise<void> {
  await queue.drain()
}

function mapTraceToRow(summary: RemoteTraceSummary, userId: string) {
  return {
    trace_id: summary.traceId,
    user_id: userId,
    surface: summary.surface,
    request_class: summary.requestClass,
    provider: summary.provider,
    model: summary.model,
    status: summary.status,
    outcome: summary.outcome,
    error_code: summary.errorCode,
    retry_used: summary.retryUsed,
    fallback_used: summary.fallbackUsed,
    proposal_created: summary.proposalCreated,
    duration_ms: summary.durationMs,
    action_count: summary.actionCount,
    response_char_count: summary.responseCharCount,
    started_at: summary.startedAt,
    completed_at: summary.completedAt,
    warnings_count: summary.warningsCount,
    client_app_version: summary.clientAppVersion,
  }
}

function mapFeedbackToRow(summary: RemoteFeedbackSummary, userId: string) {
  return {
    id: summary.id,
    user_id: userId,
    target_type: summary.targetType,
    target_id: summary.targetId,
    rating: summary.rating,
    comment: summary.comment,
    trace_id: summary.traceId,
    chat_message_id: summary.chatMessageId,
    proposal_id: summary.proposalId,
    request_class: summary.requestClass,
    created_at: summary.createdAt,
    updated_at: summary.updatedAt,
  }
}
```

- [ ] **Step 4: Verificar pass**

Run: `npx vitest run src/services/telemetry/__tests__/remoteTelemetry.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: NO-OP commit**

---

## Task 7: Hook en `aiTelemetry`

**Files:**
- Modify: `src/services/ai/aiTelemetry.ts`

- [ ] **Step 1: Test failing**

`src/services/ai/__tests__/aiTelemetryRemoteHook.test.ts`:

```ts
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../../db/db'
import { upsertAIRequestLog, recordCoachFeedback } from '../aiTelemetry'
import * as remoteMod from '../../telemetry/remoteTelemetry'

describe('aiTelemetry remote hook', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks() })

  it('calls pushTrace after upsert', async () => {
    const spy = vi.spyOn(remoteMod, 'pushTrace').mockResolvedValue()
    await upsertAIRequestLog({
      traceId: 't', surface: 'coach', requestClass: 'chat_general',
      status: 'completed', startedAt: 1,
    })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('does not throw if pushTrace fails', async () => {
    vi.spyOn(remoteMod, 'pushTrace').mockRejectedValue(new Error('boom'))
    await expect(upsertAIRequestLog({
      traceId: 't2', surface: 'coach', requestClass: 'chat_general',
      status: 'completed', startedAt: 1,
    })).resolves.toBeUndefined()
  })

  it('calls pushFeedback after recordCoachFeedback', async () => {
    const spy = vi.spyOn(remoteMod, 'pushFeedback').mockResolvedValue()
    await recordCoachFeedback({
      targetType: 'coach_message', targetId: 'm1', rating: 1,
    })
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Verificar fail**

Run: `npx vitest run src/services/ai/__tests__/aiTelemetryRemoteHook.test.ts`
Expected: FAIL.

- [ ] **Step 3: Modificar `aiTelemetry.ts`**

Top del archivo, importar:

```ts
import { pushFeedback, pushTrace } from '../telemetry/remoteTelemetry'
```

En `upsertAIRequestLog`, después del `db.aiRequestLogs.put(entry)` y dentro del `try`:

```ts
export async function upsertAIRequestLog(entry: AITechnicalResult): Promise<void> {
  try {
    await db.aiRequestLogs.put(entry)
    await pruneAIRequestLogs()
  } catch {
    // Observability must never break the product flow.
  }
  // Remote push fuera del try del Dexie — su propio error handling no debe romper local.
  try {
    await pushTrace(entry)
  } catch {
    // ignore
  }
}
```

En `recordCoachFeedback`, después de `await db.coachFeedback.put(feedback)`:

```ts
  await db.coachFeedback.put(feedback)
  try {
    await pushFeedback(feedback)
  } catch {
    // ignore
  }
  return feedback
```

- [ ] **Step 4: Verificar pass**

Run: `npx vitest run src/services/ai/__tests__/aiTelemetryRemoteHook.test.ts`
Expected: 3 PASS.

Run: `npx vitest run src/services/__tests__/coachFunction.test.ts src/services/__tests__/actionPostProcessor.test.ts`
Expected: tests pre-existentes verdes.

- [ ] **Step 5: NO-OP commit**

---

## Task 8: Toggle de opt-out en SettingsPage

**Files:**
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: Importar**

```tsx
import { isTelemetryOptedOut, setTelemetryOptOut } from '../services/telemetry/remoteTelemetryConfig'
```

- [ ] **Step 2: Estado**

```tsx
const [optedOut, setOptedOut] = useState(isTelemetryOptedOut())
```

- [ ] **Step 3: Render dentro de Beta Quality**

Antes del bloque "Planes generados" introducido en Fase 3:

```tsx
<label className="mt-4 flex items-center gap-2 text-xs">
  <input
    type="checkbox"
    checked={optedOut}
    onChange={(e) => {
      setTelemetryOptOut(e.target.checked)
      setOptedOut(e.target.checked)
    }}
  />
  No enviar telemetría remota (la telemetría local sigue activa).
</label>
```

- [ ] **Step 4: Verificación manual**

Run: `VITE_REMOTE_TELEMETRY_ENABLED=true npm run dev`. Marcar/desmarcar el toggle, recargar, confirmar que persiste.

- [ ] **Step 5: NO-OP commit**

---

## Task 9: Función de retención server-side (opcional pero recomendado)

**Files:**
- Create: `netlify/functions/telemetry-retention.ts`
- Modify: `netlify.toml`

- [ ] **Step 1: Implementar la función**

`netlify/functions/telemetry-retention.ts`:

```ts
import type { Handler } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

const RETENTION_DAYS = 90

export const handler: Handler = async () => {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return { statusCode: 500, body: 'misconfigured' }
  }

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  const client = createClient(url, key, { auth: { persistSession: false } })

  const { error: traceError, count: traceCount } = await client
    .from('coach_request_log')
    .delete({ count: 'exact' })
    .lt('started_at', cutoff)

  const { error: feedbackError, count: feedbackCount } = await client
    .from('coach_feedback_log')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff)

  if (traceError || feedbackError) {
    return {
      statusCode: 500,
      body: JSON.stringify({ traceError, feedbackError }),
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ deletedTraces: traceCount ?? 0, deletedFeedback: feedbackCount ?? 0 }),
  }
}
```

- [ ] **Step 2: Schedule en `netlify.toml`**

Añadir al final:

```toml
[functions."telemetry-retention"]
  schedule = "0 4 * * *"
```

(Cron 4 AM UTC diario.)

- [ ] **Step 3: Setear secret**

Decirle al usuario: añadir `SUPABASE_SERVICE_ROLE_KEY` en Netlify env vars (NO en `VITE_*` — no debe llegar al cliente).

- [ ] **Step 4: Test smoke manual**

Después de aplicar, manualmente disparar `curl https://<dev-url>/.netlify/functions/telemetry-retention` con la URL de la función schedulable y verificar que devuelve `{"deletedTraces": 0, "deletedFeedback": 0}` la primera vez.

- [ ] **Step 5: NO-OP commit**

---

## Task 10: Vista admin para Beta Quality remota

**Files:**
- Create: `src/services/planBuilder/betaQualityRemote.ts`
- Modify: `src/pages/SettingsPage.tsx`

Vista interna que lee `coach_request_log` agrupado por requestClass para el usuario actual.

- [ ] **Step 1: Test failing**

`src/services/planBuilder/__tests__/betaQualityRemote.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as supabaseMod from '../../sync/syncSupabase'
import { fetchRemoteBetaQuality } from '../betaQualityRemote'

describe('fetchRemoteBetaQuality', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns null when supabase not configured', async () => {
    vi.spyOn(supabaseMod, 'getSupabase').mockReturnValue(null as any)
    expect(await fetchRemoteBetaQuality()).toBeNull()
  })

  it('aggregates rows by requestClass with totals + fallback counts', async () => {
    const rows = [
      { request_class: 'chat_general', fallback_used: false, outcome: 'ok' },
      { request_class: 'chat_general', fallback_used: false, outcome: 'ok' },
      { request_class: 'plan_builder_week', fallback_used: true, outcome: 'truncated_early' },
      { request_class: 'plan_builder_week', fallback_used: false, outcome: 'ok' },
    ]
    vi.spyOn(supabaseMod, 'getSupabase').mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: 'u' } } }) },
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({ limit: () => Promise.resolve({ data: rows, error: null }) }),
          }),
        }),
      }),
    } as any)
    const result = await fetchRemoteBetaQuality()
    expect(result?.byClass.chat_general.total).toBe(2)
    expect(result?.byClass.chat_general.fallbackCount).toBe(0)
    expect(result?.byClass.plan_builder_week.total).toBe(2)
    expect(result?.byClass.plan_builder_week.fallbackCount).toBe(1)
  })
})
```

- [ ] **Step 2: Implementar**

`src/services/planBuilder/betaQualityRemote.ts`:

```ts
import type { AIRequestClass } from '../../types'
import { getSupabase } from '../sync/syncSupabase'

export interface RemoteBetaQualityAggregate {
  byClass: Partial<Record<AIRequestClass, {
    total: number
    fallbackCount: number
    failedCount: number
    avgDurationMs: number | null
  }>>
  rowCount: number
}

export async function fetchRemoteBetaQuality(): Promise<RemoteBetaQualityAggregate | null> {
  const client = getSupabase()
  if (!client) return null
  const { data: { user } } = await client.auth.getUser()
  if (!user) return null

  const { data, error } = await client
    .from('coach_request_log')
    .select('request_class, fallback_used, outcome, duration_ms, status')
    .eq('user_id', user.id)
    .order('started_at', { ascending: false })
    .limit(500)

  if (error || !data) return null

  const byClass: RemoteBetaQualityAggregate['byClass'] = {}
  for (const row of data) {
    const key = row.request_class as AIRequestClass
    const bucket = byClass[key] ?? { total: 0, fallbackCount: 0, failedCount: 0, avgDurationMs: null }
    bucket.total += 1
    if (row.fallback_used) bucket.fallbackCount += 1
    if (row.status === 'failed') bucket.failedCount += 1
    if (typeof row.duration_ms === 'number') {
      const previous = bucket.avgDurationMs ?? 0
      bucket.avgDurationMs = previous + (row.duration_ms - previous) / bucket.total
    }
    byClass[key] = bucket
  }
  return { byClass, rowCount: data.length }
}
```

- [ ] **Step 3: Renderizar en SettingsPage**

En la subsección Beta Quality, después del rollup de planes:

```tsx
const [remoteAggregate, setRemoteAggregate] = useState<RemoteBetaQualityAggregate | null>(null)
useEffect(() => { void fetchRemoteBetaQuality().then(setRemoteAggregate) }, [])

{remoteAggregate && (
  <section className="mt-4 rounded border border-zinc-200 p-3">
    <h3 className="text-sm font-semibold">Telemetría remota (últimos {remoteAggregate.rowCount})</h3>
    <ul className="mt-2 space-y-1 text-xs">
      {Object.entries(remoteAggregate.byClass).map(([k, v]) => (
        <li key={k}>
          <span className="font-medium">{k}</span> · {v?.total} · {v?.fallbackCount} fallback · {v?.failedCount} failed
          {v?.avgDurationMs != null && ` · ${Math.round(v.avgDurationMs)}ms avg`}
        </li>
      ))}
    </ul>
  </section>
)}
```

- [ ] **Step 4: Verificar tests + manual**

Run: `npx vitest run src/services/planBuilder/__tests__/betaQualityRemote.test.ts`
Expected: 2 PASS.

Manual: con `VITE_REMOTE_TELEMETRY_ENABLED=true` y proyecto Supabase staging configurado, ejecutar coach varias veces, recargar Settings → Beta Quality, ver que aparece el agregado.

- [ ] **Step 5: NO-OP commit**

---

## Task 11: Hardening + métricas de cierre

- [ ] **Step 1: Validación local completa**

```bash
npm run lint
npm test
npm run build
npm run audit:prompt
```

Expected: todo verde.

- [ ] **Step 2: Smoke staging**

1. Subir migración `006_coach_telemetry.sql` a staging.
2. Configurar `VITE_REMOTE_TELEMETRY_ENABLED=true` en `.env.local`.
3. Crear cuenta de prueba.
4. Ejecutar: 5 chats, 1 week_creator, 1 plan builder.
5. En el SQL editor de Supabase: `select count(*), request_class from coach_request_log group by request_class` → confirmar conteos.
6. `select count(*) from coach_feedback_log` después de dejar un thumbs-up/down.

- [ ] **Step 3: Verificar RLS**

Con la misma cuenta, en el SQL editor sin role admin:
```sql
select * from coach_request_log where user_id != auth.uid();
```
Expected: 0 filas.

- [ ] **Step 4: Verificar opt-out**

Toggle en Settings ON → recargar → ejecutar coach → confirmar que `coach_request_log` no crece.

- [ ] **Step 5: Documentar en `OPTIMIZATION_AND_COSTS.md` y `PROJECT_REVIEW_AND_ROADMAP.md`**

- En `OPTIMIZATION_AND_COSTS.md`, sumar costo Supabase estimado (Postgres rows ~negligible, 200 logs/día × 30 días × 5 usuarios = 30k rows/mes, dentro de free tier).
- En `PROJECT_REVIEW_AND_ROADMAP.md`, mover Fase 4 de "fuera de MVP" a "implementada" con fecha.

- [ ] **Step 6: Self-review final**

Releer la sección "Fase 4 — Telemetría persistida" del spec:

- ✅ Persistir trace summary: `coach_request_log` + `pushTrace` (Task 1, 6, 7).
- ✅ Asociar feedback a trace/proposal/session: `coach_feedback_log` con columnas `trace_id`, `proposal_id`, `chat_message_id` (Task 1, 6, 7).
- ✅ RLS: solo el propio user lee/inserta; service_role para mantenimiento (Task 1).
- ✅ Retención 90 días: scheduled function (Task 9).

---

## Métricas de cierre (espejo del spec)

1. ✅ Los traces aparecen en Supabase en <10 segundos desde la ejecución del coach.
2. ✅ Cada usuario solo ve sus propias filas.
3. ✅ El opt-out funciona y persiste cross-session.
4. ✅ La función de retención borra >90 días sin afectar usuarios activos.
5. ✅ El cliente nunca crashea si Supabase está caído o si la queue falla.

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| `pushTrace` se ejecuta en cada coach call y satura la red | Queue con batching + flushIntervalMs=5000 + maxBatchSize=25. La latencia del coach NO depende de telemetría. |
| Filtro de promptTrace falla y se filtra info sensible | El stripper es declarativo en `remoteTelemetryStripper.ts` — su test cubre que NUNCA aparecen `promptTrace`, `responsePreview`, `warnings`. Cualquier campo nuevo en `AITechnicalResult` requiere decisión explícita. |
| RLS mal escrita filtra datos entre usuarios | Smoke explícito en Task 11 Step 3. Idealmente revisar con dos cuentas de prueba. |
| Service role key se filtra al cliente | El key SOLO va en Netlify env (server-side). NO usar `VITE_*` para esto. Documentado en Task 9 Step 3. |
| Costo Supabase crece con la beta | Retention de 90 días + opt-out individual. Si en algún momento se acerca a límites: bajar a 30 días o muestrear (1 de cada 5 traces). |
| Schema cambia en `AITechnicalResult` rompiendo la tabla | El stripper desacopla. Si se agrega un campo nuevo, no rompe; si se renombra un campo persistido, requiere migración SQL. Documentar en CLAUDE.md. |
| Usuario beta pone `VITE_REMOTE_TELEMETRY_ENABLED=true` en su build local pensando que lo apaga | El flag default es off. Test explícito en Task 4. Documentado en Settings UI. |

---

## Qué NO hacer en esta fase

- No mover la telemetría local (`db.aiRequestLogs`) a remota: el local sigue siendo la fuente de verdad para Beta Quality export.
- No subir `promptTrace` ni `responsePreview` completos al backend.
- No habilitar este sistema antes de cumplir las pre-condiciones (volumen mínimo + 2 semanas de beta privada).
- No crear vista de admin global con cross-user reads — RLS lo prohíbe; cualquier dashboard cross-user vive en SQL queries con service_role manuales por ahora.
- No migrar feedback existente local a remoto retroactivamente (los IDs son determinísticos pero el `auth.uid()` requiere sesión activa por evento).
- No agregar más columnas al schema sin justificación clara (el principio es: el menos que sirve).

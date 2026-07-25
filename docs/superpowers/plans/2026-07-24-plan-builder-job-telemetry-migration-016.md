# Plan Builder Job Telemetry + Migration 016 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar la unidad de medición a nivel de **plan/job** que hoy falta: una tabla `plan_generation_jobs` (una fila por corrida) que agrupa los `plan_generation_attempts` existentes, con timings por corrida, descriptor de variante fiel a la request real, tokens/costo y outcome; más las columnas de variante y taxonomía que faltan en `plan_generation_attempts`.

**Architecture:** El worker (`runAsyncPlanGeneration`) es el único punto que observa el ciclo de vida completo de una corrida. Se le agrega un `finalizeJob()` idempotente que emite una `PlanGenerationJobTelemetry` en **todos** los caminos terminales (normal, cancelación y excepción) vía un nuevo `writer.putJob`. Un **resolver puro de configuración efectiva** (`resolveEffectivePlanBuilderConfig`) es la única fuente de verdad de lo que realmente se envía a Anthropic, compartido por el caller y por la telemetría, para que la variante registrada no mienta. La capa Netlify mapea la telemetría a filas y las upserta con el service role.

**Tech Stack:** TypeScript, Vitest, Supabase (Postgres + RLS), Netlify Functions. No se toca Dexie ni el cliente. No cambia comportamiento de generación.

## Global Constraints

- **Fase de medición, sin cambio de comportamiento.** No se toca modelo, `effort`, `temperature`, prompt, schema ni concurrencia. Fuente: spec §Alcance.
- **La variante registrada describe la request real.** `provider` es `'claude'` (igual que `AIRawResponse.provider` y `plan_generation_attempts.provider`), no `'anthropic'`. `effort`/`thinkingMode` valen `'omitted'` mientras el caller no los envíe — no leer env vars que la request ignora. Modelo/temperatura/maxTokens/concurrencia salen de un resolver compartido, no de literales duplicados. Fuente: review del owner, hallazgo 1.
- **`variant_id` identifica la variante completa.** Cambiar cualquier dimensión (provider, model, effort, thinking, temperature, maxTokens, prompt, schema, quality, concurrencia) cambia el id. Fuente: spec §3.1 + hallazgo 2.
- **Concurrencia normalizada.** El descriptor usa el mismo valor normalizado (1–6) que ejecuta el worker, vía un `normalizePlanBuilderConcurrency()` exportado y único. Fuente: hallazgo 3.
- **`quality_version` es la versión que aplica el gate**, no un literal suelto: sale de `PRODUCTIVE_QUALITY_VERSION` exportado por `qualityReview.ts` (hoy `1`; Plan 3 lo mueve junto con activar v2). Fuente: hallazgo 1.
- **`plan_complete_ms` termina en el último `putWeek` terminal**, no en la revisión/escritura final; solo es `null` si quedan semanas pendientes (p. ej. cancelación). Fuente: hallazgo 4.
- **Precedencia de outcome:** `cancelled → budget_exhausted → succeeded → partial → failed`. Fuente: hallazgo 5.
- **`enqueued_at` valida identidad de job**: solo adopta `startedAt` previo si `generationSummary.jobId === jobId`; si no, cae al worker start. Fuente: hallazgo 6.
- **Una fila por corrida en todo camino terminal**, incluida excepción, vía `finalizeJob()` idempotente. Un hard-kill del worker sigue sin ser observable y se documenta. Fuente: hallazgo 7.
- **Usage ausente ≠ costo cero.** Si algún intento facturable no reporta `input_tokens`/`output_tokens`, `estimated_cost_usd = null`. El costo se calcula con el **modelo real de cada intento** (`meta.model`), fechado en su `createdAt`. Fuente: hallazgo 8.
- **Rollout: migración primero.** `016` es aditiva y debe aplicarse **antes** de desplegar el código: el nuevo mapper de attempts envía columnas nuevas y PostgREST rechaza la fila completa si no existen — apagaría la telemetría de attempts existente, no solo `putJob`. Fuente: hallazgo 10.
- **RLS idéntica a `014`:** `select` propio, sin `insert`/`update`/`delete` para clientes. Solo escribe el service role. Fuente: spec §3.1.
- **Migración manual.** Escribir el `.sql` no lo aplica. Confirmar rollout con el owner. Fuente: CLAUDE.md + spec §3.1.
- **`estimated_cost_usd` usa tabla de precios versionada y fechada** (§5.4). Los valores DEBEN verificarse contra la fuente oficial antes de confiar en ellos.
- **Nombres de latencia (§5.1):** `first_week_ready_ms`, `first_week_ready_e2e_ms`, `plan_complete_ms`, `terminal_ms`. `first_week_discoverable_estimated_ms` derivado/nullable (comentado como tal en la columna). `first_week_visible_ms` reservado, no se usa.
- **Telemetría best-effort:** un fallo de `putJob`/`putAttempt` nunca hace fallar la generación, y se loguea sanitizado.
- No se agregan dependencias. Comandos: `npm run lint`, `npm test`, `npm run build`.
- Los commits los hace el owner — **no ejecutar `git commit` salvo pedido explícito**.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/services/planBuilder/pricing.ts` (**crear**) | Tabla de precios por modelo, fechada, y `estimateCostUsd`. Puro. |
| `src/services/planBuilder/telemetryVersions.ts` (**crear**) | `PLAN_BUILDER_PROMPT_VERSION`, `PLAN_BUILDER_SCHEMA_VERSION`, `PlanBuilderVariantDescriptor`, `buildVariantId` (hash de todas las dimensiones). |
| `netlify/functions/_shared/planBuilderRunConfig.ts` (**crear**) | `resolvePlanBuilderModel`, `resolveEffectivePlanBuilderConfig`. Única fuente de la config efectiva enviada a Anthropic. |
| `netlify/functions/_shared/anthropicCaller.ts` (**modificar**) | Resolver el modelo vía `resolvePlanBuilderModel` (deja de duplicar la lógica). |
| `src/services/planBuilder/asyncGenerationLoop.ts` (**modificar**) | Exportar `normalizePlanBuilderConcurrency`, `DEFAULT_MAX_TOKENS`, `DEFAULT_TEMPERATURE`; `PlanGenerationJobTelemetry` + `PlanGenerationJobVariant`; `writer.putJob`; `finalizeJob` idempotente; timings correctos; costo per-attempt; campos de variante/taxonomía en el attempt. |
| `src/services/planBuilder/qualityReview.ts` (**modificar**) | Exportar `PRODUCTIVE_QUALITY_VERSION = 1`. |
| `netlify/functions/_shared/planGenerationTelemetry.ts` (**modificar**) | Mapear variante + taxonomía (incl. 3 contadores de sesiones únicas) del attempt. |
| `netlify/functions/_shared/planGenerationTelemetry.test.ts` (**modificar**) | Extender el test existente (no crear otro). |
| `netlify/functions/_shared/planGenerationJobTelemetry.ts` (**crear**) | `planGenerationJobToRow` + `upsertPlanGenerationJob`. |
| `netlify/functions/_shared/planGenerationShared.ts` (**modificar**) | Cablear `putJob` (gateado por service role). |
| `netlify/functions/generate-plan-background.ts` (**modificar**) | Pasar `enqueuedAt` (identity-checked) y `variant` desde el resolver. |
| `netlify/functions/_shared/planGenerationTelemetryRetention.ts` (**modificar**) | Purgar también `plan_generation_jobs`. |
| `supabase/016_plan_generation_jobs.sql` (**crear**) | Tabla + RLS + índices + `COMMENT` + `ALTER` de attempts. Aplicación manual. |
| Tests nuevos | `pricing.test.ts`, `telemetryVersions.test.ts`, `planBuilderRunConfig.test.ts`, `asyncGenerationLoopJobTelemetry.test.ts`, `planGenerationJobTelemetry.test.ts`, `planGenerationJobSchema.test.ts`. |

## Dependencias dentro de Fase 0

```text
Plan 1 — taxonomía + soporte v2 opt-in            ✅ HECHO (5053549 + 956932f)
        ↓
Plan 2 — migración 016 + persistencia job/intento   ← ESTE
        ↓
Plan 3 — loadtest + calibración + activación de v2
```

**Fuera de este plan (→ Plan 3):** instrumentación cross-week detallada de §3.4 (rotaciones, overlaps, ratio de carga), loadtest §3.6, calibración de divisores/umbral y activación productiva de v2 (§5.3). La migración 016 **sí** crea `previous_week_context_source` (poblada a nivel job); las columnas de los contadores finos de §3.4 **no** entran en 016 — las agrega Plan 3 con su propio `.sql`.

---

### Task 1: Tabla de precios fechada (§5.4)

**Files:**
- Create: `src/services/planBuilder/pricing.ts`
- Test: `src/services/planBuilder/__tests__/pricing.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `ModelPrice`, `MODEL_PRICES: ModelPrice[]`, `estimateCostUsd(input: { model: string; at: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }): number | null`.

`estimateCostUsd` devuelve `null` cuando no hay precio vigente para ese `model` en `at`.

- [x] **Step 1: Write the failing test**

Create `src/services/planBuilder/__tests__/pricing.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { estimateCostUsd } from '../pricing'

const AUG_2026 = Date.UTC(2026, 7, 15)

describe('estimateCostUsd', () => {
  it('prices a sonnet-4-6 run from input/output/cache tokens', () => {
    const cost = estimateCostUsd({
      model: 'claude-sonnet-4-6', at: AUG_2026,
      inputTokens: 1_000_000, outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000, cacheCreationTokens: 1_000_000,
    })
    // 3 + 15 + 0.3 + 3.75 = 22.05
    expect(cost).toBeCloseTo(22.05, 6)
  })

  it('scales linearly with token counts', () => {
    const cost = estimateCostUsd({
      model: 'claude-sonnet-4-6', at: AUG_2026,
      inputTokens: 10_000, outputTokens: 2_000, cacheReadTokens: 0, cacheCreationTokens: 0,
    })
    expect(cost).toBeCloseTo(0.06, 6)
  })

  it('returns null for a model with no dated price entry', () => {
    expect(estimateCostUsd({
      model: 'model-inexistente', at: AUG_2026,
      inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheCreationTokens: 0,
    })).toBeNull()
  })

  it('returns null when no price window covers the timestamp', () => {
    expect(estimateCostUsd({
      model: 'claude-sonnet-4-6', at: Date.UTC(2020, 0, 1),
      inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheCreationTokens: 0,
    })).toBeNull()
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/pricing.test.ts`
Expected: FAIL — `Failed to resolve import "../pricing"`.

- [x] **Step 3: Write minimal implementation**

Create `src/services/planBuilder/pricing.ts`:

```ts
/**
 * Precios por modelo, **fechados** (spec §5.4). Sin fecha, el costo de Fase 3
 * quedaría mal al expirar un precio introductorio.
 *
 * IMPORTANTE (owner): verificar estos valores contra la página oficial de
 * precios de Anthropic (o la skill `claude-api`) antes de confiar en
 * `estimated_cost_usd`. USD por 1.000.000 de tokens.
 */

export interface ModelPrice {
  model: string
  effectiveFrom: string
  effectiveTo: string | null
  inputUsdPerMTok: number
  outputUsdPerMTok: number
  cacheReadUsdPerMTok: number
  cacheWriteUsdPerMTok: number
}

const MTOK = 1_000_000

export const MODEL_PRICES: ModelPrice[] = [
  {
    model: 'claude-sonnet-4-6',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    inputUsdPerMTok: 3,
    outputUsdPerMTok: 15,
    cacheReadUsdPerMTok: 0.3,
    cacheWriteUsdPerMTok: 3.75,
  },
]

function findPrice(model: string, at: number): ModelPrice | null {
  for (const price of MODEL_PRICES) {
    if (price.model !== model) continue
    const fromMs = Date.parse(`${price.effectiveFrom}T00:00:00Z`)
    const toMs = price.effectiveTo ? Date.parse(`${price.effectiveTo}T23:59:59.999Z`) : Number.POSITIVE_INFINITY
    if (at >= fromMs && at <= toMs) return price
  }
  return null
}

export function estimateCostUsd(input: {
  model: string
  at: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}): number | null {
  const price = findPrice(input.model, input.at)
  if (!price) return null
  return (
    (input.inputTokens / MTOK) * price.inputUsdPerMTok +
    (input.outputTokens / MTOK) * price.outputUsdPerMTok +
    (input.cacheReadTokens / MTOK) * price.cacheReadUsdPerMTok +
    (input.cacheCreationTokens / MTOK) * price.cacheWriteUsdPerMTok
  )
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/planBuilder/__tests__/pricing.test.ts`
Expected: PASS — 4 tests.

- [x] **Step 5: Commit (owner)**

```bash
git add src/services/planBuilder/pricing.ts src/services/planBuilder/__tests__/pricing.test.ts
git commit -m "feat(plan-builder): add dated model pricing table for cost estimation"
```

---

### Task 2: Descriptor de variante y `variant_id` completo

**Files:**
- Create: `src/services/planBuilder/telemetryVersions.ts`
- Test: `src/services/planBuilder/__tests__/telemetryVersions.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `PLAN_BUILDER_PROMPT_VERSION: string`, `PLAN_BUILDER_SCHEMA_VERSION: string`, `PlanBuilderVariantDescriptor` (todas las dimensiones), `buildVariantId(descriptor: PlanBuilderVariantDescriptor): string`.

`buildVariantId` produce `<modelShort>-q<n>-<hash8>`, con hash determinístico de **todas** las dimensiones. Prefijo legible; el hash de 32 bits hace **altamente improbable** una colisión a este volumen (no la garantiza en el sentido criptográfico).

- [x] **Step 1: Write the failing test**

Create `src/services/planBuilder/__tests__/telemetryVersions.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { buildVariantId, type PlanBuilderVariantDescriptor } from '../telemetryVersions'

const BASE: PlanBuilderVariantDescriptor = {
  provider: 'claude',
  model: 'claude-sonnet-4-6',
  effort: 'omitted',
  thinkingMode: 'omitted',
  temperature: 0.25,
  maxTokens: 5000,
  promptVersion: '2026-07-week-v1',
  schemaVersion: '2026-07-week-v1',
  qualityVersion: 1,
  concurrency: 3,
}

describe('buildVariantId', () => {
  it('produces a readable prefix with model short and quality version', () => {
    expect(buildVariantId(BASE)).toMatch(/^s46-q1-[a-z0-9]{8}$/)
  })

  it('is deterministic for the same descriptor', () => {
    expect(buildVariantId(BASE)).toBe(buildVariantId({ ...BASE }))
  })

  it('changes the id when ANY dimension changes', () => {
    const base = buildVariantId(BASE)
    const dims: Array<Partial<PlanBuilderVariantDescriptor>> = [
      { provider: 'openai' },
      { model: 'claude-sonnet-5' },
      { effort: 'high' },
      { thinkingMode: 'extended' },
      { temperature: 0.3 },
      { maxTokens: 12000 },
      { promptVersion: 'x' },
      { schemaVersion: 'x' },
      { qualityVersion: 2 },
      { concurrency: 6 },
    ]
    for (const override of dims) {
      expect(buildVariantId({ ...BASE, ...override }), JSON.stringify(override)).not.toBe(base)
    }
  })

  it('falls back to a safe token when model is null', () => {
    expect(buildVariantId({ ...BASE, model: null })).toMatch(/^unknown-q1-[a-z0-9]{8}$/)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/telemetryVersions.test.ts`
Expected: FAIL — `Failed to resolve import "../telemetryVersions"`.

- [x] **Step 3: Write minimal implementation**

Create `src/services/planBuilder/telemetryVersions.ts`:

```ts
/**
 * Etiquetas y descriptor de la variante experimental del Plan Builder
 * (spec §3.1). El owner bumpea PROMPT/SCHEMA version cuando cambia el prompt
 * del coach o el JSON schema de la semana.
 */

export const PLAN_BUILDER_PROMPT_VERSION = '2026-07-week-v1'
export const PLAN_BUILDER_SCHEMA_VERSION = '2026-07-week-v1'

export interface PlanBuilderVariantDescriptor {
  provider: string
  model: string | null
  effort: string | null
  thinkingMode: string | null
  temperature: number | null
  maxTokens: number | null
  promptVersion: string
  schemaVersion: string
  qualityVersion: 1 | 2
  concurrency: number
}

const KNOWN_MODEL_SHORT: Record<string, string> = {
  'claude-sonnet-4-6': 's46',
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** FNV-1a de 32 bits en base36, 8 chars. Sin dependencias, estable entre corridas. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36).padStart(8, '0').slice(0, 8)
}

/**
 * Identidad de una ventana experimental sin depender de `created_at`
 * (spec §3.1). Prefijo legible + hash de TODAS las dimensiones: cambiar
 * cualquiera cambia el id salvo colisión de hash, altamente improbable a
 * este volumen.
 */
export function buildVariantId(descriptor: PlanBuilderVariantDescriptor): string {
  const modelToken = descriptor.model
    ? KNOWN_MODEL_SHORT[descriptor.model] ?? slugify(descriptor.model)
    : 'unknown'
  const canonical = JSON.stringify([
    descriptor.provider, descriptor.model, descriptor.effort, descriptor.thinkingMode,
    descriptor.temperature, descriptor.maxTokens, descriptor.promptVersion,
    descriptor.schemaVersion, descriptor.qualityVersion, descriptor.concurrency,
  ])
  return `${modelToken}-q${descriptor.qualityVersion}-${fnv1a(canonical)}`
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/planBuilder/__tests__/telemetryVersions.test.ts`
Expected: PASS — 4 tests.

- [x] **Step 5: Commit (owner)**

```bash
git add src/services/planBuilder/telemetryVersions.ts src/services/planBuilder/__tests__/telemetryVersions.test.ts
git commit -m "feat(plan-builder): add variant descriptor and full-dimension variant id"
```

---

### Task 3: Config efectiva compartida + constantes exportadas

**Files:**
- Create: `netlify/functions/_shared/planBuilderRunConfig.ts`
- Modify: `netlify/functions/_shared/anthropicCaller.ts:5,67`
- Modify: `src/services/planBuilder/asyncGenerationLoop.ts:86,88,175` (exportar constantes y normalizador)
- Modify: `src/services/planBuilder/qualityReview.ts` (exportar `PRODUCTIVE_QUALITY_VERSION`)
- Test: `netlify/functions/_shared/__tests__/planBuilderRunConfig.test.ts`

**Interfaces:**
- Consumes: `PLAN_BUILDER_PROMPT_VERSION`, `PLAN_BUILDER_SCHEMA_VERSION` (Task 2); `PRODUCTIVE_QUALITY_VERSION`.
- Produces:
  - `resolvePlanBuilderModel(env: NodeJS.ProcessEnv): string` (usado por caller **y** telemetría).
  - `normalizePlanBuilderConcurrency(value: number | undefined): number` (export desde `asyncGenerationLoop.ts`, reemplaza al `normalizeConcurrency` privado).
  - `resolveEffectivePlanBuilderConfig(env: NodeJS.ProcessEnv): PlanBuilderVariantDescriptor` — describe la request real: `provider: 'claude'`, `effort: 'omitted'`, `thinkingMode: 'omitted'`, `temperature`/`maxTokens` desde las constantes del loop, `concurrency` normalizada, `qualityVersion: PRODUCTIVE_QUALITY_VERSION`.
  - `export const DEFAULT_MAX_TOKENS`, `export const DEFAULT_TEMPERATURE` en `asyncGenerationLoop.ts`.
  - `export const PRODUCTIVE_QUALITY_VERSION: 1 | 2` en `qualityReview.ts`.

`effort`/`thinkingMode` valen `'omitted'` porque el caller **no** los envía hoy (`anthropicCaller.buildClaudeBody` solo manda model/max_tokens/temperature/system/messages/tools). Cuando alguien cablee effort a la request, lo cambia **en un solo lugar** (este resolver) y la telemetría lo refleja automáticamente.

- [x] **Step 1: Write the failing test**

Create `netlify/functions/_shared/__tests__/planBuilderRunConfig.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { resolveEffectivePlanBuilderConfig, resolvePlanBuilderModel } from '../planBuilderRunConfig'

describe('resolvePlanBuilderModel', () => {
  it('prefers the week-specific env, then generic, then default', () => {
    expect(resolvePlanBuilderModel({ CLAUDE_MODEL_PLAN_BUILDER_WEEK: 'm-week' } as never)).toBe('m-week')
    expect(resolvePlanBuilderModel({ CLAUDE_MODEL: 'm-generic' } as never)).toBe('m-generic')
    expect(resolvePlanBuilderModel({} as never)).toBe('claude-sonnet-4-6')
  })
})

describe('resolveEffectivePlanBuilderConfig', () => {
  it('describes the request actually sent, not env vars the caller ignores', () => {
    const config = resolveEffectivePlanBuilderConfig({} as never)
    expect(config.provider).toBe('claude')
    expect(config.model).toBe('claude-sonnet-4-6')
    expect(config.effort).toBe('omitted')
    expect(config.thinkingMode).toBe('omitted')
    expect(config.temperature).toBe(0.25)
    expect(config.maxTokens).toBe(5000)
    expect(config.qualityVersion).toBe(1)
    expect(config.concurrency).toBe(3) // default normalizado
  })

  it('normalises out-of-range concurrency to the worker bounds (1..6)', () => {
    expect(resolveEffectivePlanBuilderConfig({ PLAN_BUILDER_WEEK_CONCURRENCY: '10' } as never).concurrency).toBe(6)
    expect(resolveEffectivePlanBuilderConfig({ PLAN_BUILDER_WEEK_CONCURRENCY: '0' } as never).concurrency).toBe(1)
  })
})
```

Also add a **contractual** test binding the configured version to what the gate
resolves, so Plan 3 can't move one side alone. Create
`src/services/planBuilder/__tests__/productiveQualityVersion.test.ts`, reusing the
Plan 1 quality fixtures:

```ts
import { describe, expect, it } from 'vitest'

import { PRODUCTIVE_QUALITY_VERSION, reviewPlanQuality } from '../qualityReview'
import { buildPlanForTest, buildWeekForTest } from './helpers/qualityTestFixtures'

describe('PRODUCTIVE_QUALITY_VERSION contract', () => {
  it('matches the version the gate resolves for an unmarked productive run', () => {
    // Semana sin marca (sin generationMeta.qualityVersion): el gate la resuelve por
    // su propia lógica. Debe coincidir con la versión que la variante etiqueta.
    const week = buildWeekForTest({ generationMeta: { attempts: 1 } })
    const review = reviewPlanQuality(buildPlanForTest(), [week])
    expect(review.qualityVersion).toBe(PRODUCTIVE_QUALITY_VERSION)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/_shared/__tests__/planBuilderRunConfig.test.ts`
Expected: FAIL — módulo inexistente.

- [x] **Step 3: Export the shared primitives**

In `src/services/planBuilder/asyncGenerationLoop.ts`, export the two constants (add `export` at lines 86, 88):

```ts
export const DEFAULT_MAX_TOKENS = 5000
export const DEFAULT_TEMPERATURE = 0.25
```

Rename the private `normalizeConcurrency` (line 175) to an exported `normalizePlanBuilderConcurrency` and update its internal call sites:

```ts
export function normalizePlanBuilderConcurrency(value: number | undefined): number {
  // cuerpo idéntico al normalizeConcurrency actual (default 3, clamp 1..6)
}
```

Grep `normalizeConcurrency(` in the file and replace each internal call with `normalizePlanBuilderConcurrency(`.

In `src/services/planBuilder/qualityReview.ts`, next to `LATEST_QUALITY_VERSION` (line 678), add:

```ts
/**
 * Versión de calidad **productiva configurada**. Es la que la variante etiqueta
 * (job, attempts y `variant_id`) antes de ejecutar. Hoy vale 1 y coincide con lo
 * que `resolveQualityVersion` computa por su cuenta para semanas sin marca; esa
 * coincidencia NO está cableada — la fija el test contractual de calidad (Step 1),
 * para que Plan 3 falle si mueve solo un lado al activar v2.
 */
export const PRODUCTIVE_QUALITY_VERSION: 1 | 2 = 1
```

In `netlify/functions/_shared/anthropicCaller.ts`, replace the inline model resolution (line 67) so el caller y la telemetría comparten la misma lógica. Import the resolver and keep the per-call override:

```ts
import { resolvePlanBuilderModel } from './planBuilderRunConfig'
```

```ts
  const model = options?.model ?? resolvePlanBuilderModel(process.env)
```

Keep `DEFAULT_MODEL` in `anthropicCaller.ts` **only if** nothing else uses it after this change; otherwise move the default into `planBuilderRunConfig.ts`. Put the canonical default in the resolver (next step) and delete the now-unused `DEFAULT_MODEL` from the caller if grep shows no other reference.

- [x] **Step 4: Write the resolver**

Create `netlify/functions/_shared/planBuilderRunConfig.ts`:

```ts
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  normalizePlanBuilderConcurrency,
} from '../../../src/services/planBuilder/asyncGenerationLoop'
import { PRODUCTIVE_QUALITY_VERSION } from '../../../src/services/planBuilder/qualityReview'
import {
  PLAN_BUILDER_PROMPT_VERSION,
  PLAN_BUILDER_SCHEMA_VERSION,
  type PlanBuilderVariantDescriptor,
} from '../../../src/services/planBuilder/telemetryVersions'

const DEFAULT_PLAN_BUILDER_MODEL = 'claude-sonnet-4-6'

export function resolvePlanBuilderModel(env: NodeJS.ProcessEnv): string {
  return env['CLAUDE_MODEL_PLAN_BUILDER_WEEK'] ?? env['CLAUDE_MODEL'] ?? DEFAULT_PLAN_BUILDER_MODEL
}

function resolveRawConcurrency(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env['PLAN_BUILDER_WEEK_CONCURRENCY']
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/**
 * Única fuente de la config efectiva enviada a Anthropic. `effort`/`thinkingMode`
 * son `'omitted'` porque hoy la request no los incluye; cambiarlos aquí (y en el
 * caller) mantiene la telemetría fiel sin tocar dos lugares.
 */
export function resolveEffectivePlanBuilderConfig(env: NodeJS.ProcessEnv): PlanBuilderVariantDescriptor {
  return {
    provider: 'claude',
    model: resolvePlanBuilderModel(env),
    effort: 'omitted',
    thinkingMode: 'omitted',
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: DEFAULT_MAX_TOKENS,
    promptVersion: PLAN_BUILDER_PROMPT_VERSION,
    schemaVersion: PLAN_BUILDER_SCHEMA_VERSION,
    qualityVersion: PRODUCTIVE_QUALITY_VERSION,
    concurrency: normalizePlanBuilderConcurrency(resolveRawConcurrency(env)),
  }
}
```

- [x] **Step 5: Run tests**

Run: `npx vitest run netlify/functions/_shared/__tests__/planBuilderRunConfig.test.ts src/services/planBuilder/__tests__/productiveQualityVersion.test.ts src/services/planBuilder/__tests__/asyncGenerationLoop.test.ts`
Expected: PASS — resolver correcto, contrato de versión de calidad verde, y el rename de concurrencia no rompió el loop.

- [x] **Step 6: Commit (owner)**

```bash
git add netlify/functions/_shared/planBuilderRunConfig.ts netlify/functions/_shared/anthropicCaller.ts src/services/planBuilder/asyncGenerationLoop.ts src/services/planBuilder/qualityReview.ts netlify/functions/_shared/__tests__/planBuilderRunConfig.test.ts src/services/planBuilder/__tests__/productiveQualityVersion.test.ts
git commit -m "feat(plan-builder): share effective run config between caller and telemetry"
```

---

### Task 4: Campos de variante + taxonomía en `plan_generation_attempts`

**Files:**
- Modify: `src/services/planBuilder/asyncGenerationLoop.ts` (`PlanGenerationAttemptTelemetry`)
- Modify: `netlify/functions/_shared/planGenerationTelemetry.ts`
- Modify: `netlify/functions/_shared/planGenerationTelemetry.test.ts` (**extender el existente**)

**Interfaces:**
- Consumes: nada nuevo (los valores se cablean en Task 5).
- Produces: `PlanGenerationAttemptTelemetry` gana `variantId?: string`, `effort?: string | null`, `thinkingMode?: string | null`, `promptVersion?: string`, `schemaVersion?: string`, `qualityVersion?: 1 | 2`, `repairTaxonomyVersion?: 2`, `correctiveActionCount?`, `structuralActionCount?`, `hydrationActionCount?`, `movedSessionCount?`, `filteredSportCount?`, `hydratedSessionsAffected?`, `correctedSessionsAffected?`, `structurallyRepairedSessionsAffected?` (los 3 últimos exigidos por spec §3.2 y ya producidos por `generateWeekCore`).

Este task va **antes** de la asamblea del job (Task 5) para que el wrapper de attempts compile sin errores de tipo. Vitest no sustituye al typecheck.

- [x] **Step 1: Write the failing test**

Extend `netlify/functions/_shared/planGenerationTelemetry.test.ts` (append a `describe`):

```ts
import type { PlanGenerationAttemptTelemetry } from '../../../src/services/planBuilder/asyncGenerationLoop'
import { planGenerationAttemptToRow } from './planGenerationTelemetry'

const RICH: PlanGenerationAttemptTelemetry = {
  athleteId: 'a', planId: 'p', jobId: 'j', weekIndex: 0, attempt: 1,
  traceId: 't', provider: 'claude', outcome: 'succeeded',
  retryUsed: false, maxTokens: 5000, workerConcurrency: 3, createdAt: 1,
  variantId: 's46-q1-abcd1234',
  effort: 'omitted',
  thinkingMode: 'omitted',
  promptVersion: '2026-07-week-v1',
  schemaVersion: '2026-07-week-v1',
  qualityVersion: 1,
  repairTaxonomyVersion: 2,
  correctiveActionCount: 2,
  structuralActionCount: 1,
  hydrationActionCount: 9,
  movedSessionCount: 0,
  filteredSportCount: 0,
  hydratedSessionsAffected: 7,
  correctedSessionsAffected: 2,
  structurallyRepairedSessionsAffected: 1,
}

describe('planGenerationAttemptToRow variant + taxonomy', () => {
  it('maps variant and full taxonomy (incl. affected-session counters)', () => {
    const row = planGenerationAttemptToRow(RICH, 'user-1')
    expect(row['variant_id']).toBe('s46-q1-abcd1234')
    expect(row['effort']).toBe('omitted')
    expect(row['prompt_version']).toBe('2026-07-week-v1')
    expect(row['quality_version']).toBe(1)
    expect(row['repair_taxonomy_version']).toBe(2)
    expect(row['corrective_action_count']).toBe(2)
    expect(row['structural_action_count']).toBe(1)
    expect(row['hydration_action_count']).toBe(9)
    expect(row['moved_session_count']).toBe(0)
    expect(row['filtered_sport_count']).toBe(0)
    expect(row['hydrated_sessions_affected']).toBe(7)
    expect(row['corrected_sessions_affected']).toBe(2)
    expect(row['structurally_repaired_sessions_affected']).toBe(1)
  })

  it('nulls the new fields for a legacy attempt', () => {
    const legacy: PlanGenerationAttemptTelemetry = {
      athleteId: 'a', planId: 'p', jobId: 'j', weekIndex: 0, attempt: 1,
      traceId: 't', provider: 'claude', outcome: 'succeeded',
      retryUsed: false, maxTokens: 5000, workerConcurrency: 3, createdAt: 1,
    }
    const row = planGenerationAttemptToRow(legacy, 'user-1')
    expect(row['variant_id']).toBeNull()
    expect(row['repair_taxonomy_version']).toBeNull()
    expect(row['hydrated_sessions_affected']).toBeNull()
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/_shared/planGenerationTelemetry.test.ts`
Expected: FAIL — los campos no existen en el tipo ni en el mapper.

- [x] **Step 3: Write minimal implementation**

Extend `PlanGenerationAttemptTelemetry` in `asyncGenerationLoop.ts` (after `qualityWarningCount?`, line 40):

```ts
  variantId?: string
  effort?: string | null
  thinkingMode?: string | null
  promptVersion?: string
  schemaVersion?: string
  qualityVersion?: 1 | 2
  repairTaxonomyVersion?: 2
  correctiveActionCount?: number
  structuralActionCount?: number
  hydrationActionCount?: number
  movedSessionCount?: number
  filteredSportCount?: number
  hydratedSessionsAffected?: number
  correctedSessionsAffected?: number
  structurallyRepairedSessionsAffected?: number
```

Extend `planGenerationAttemptToRow` in `planGenerationTelemetry.ts`, before `created_at`:

```ts
    variant_id: attempt.variantId ?? null,
    effort: attempt.effort ?? null,
    thinking_mode: attempt.thinkingMode ?? null,
    prompt_version: attempt.promptVersion ?? null,
    schema_version: attempt.schemaVersion ?? null,
    quality_version: attempt.qualityVersion ?? null,
    repair_taxonomy_version: attempt.repairTaxonomyVersion ?? null,
    corrective_action_count: attempt.correctiveActionCount ?? null,
    structural_action_count: attempt.structuralActionCount ?? null,
    hydration_action_count: attempt.hydrationActionCount ?? null,
    moved_session_count: attempt.movedSessionCount ?? null,
    filtered_sport_count: attempt.filteredSportCount ?? null,
    hydrated_sessions_affected: attempt.hydratedSessionsAffected ?? null,
    corrected_sessions_affected: attempt.correctedSessionsAffected ?? null,
    structurally_repaired_sessions_affected: attempt.structurallyRepairedSessionsAffected ?? null,
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/_shared/planGenerationTelemetry.test.ts`
Expected: PASS.

- [x] **Step 5: Commit (owner)**

```bash
git add src/services/planBuilder/asyncGenerationLoop.ts netlify/functions/_shared/planGenerationTelemetry.ts netlify/functions/_shared/planGenerationTelemetry.test.ts
git commit -m "feat(plan-builder): record variant and full repair taxonomy on attempts"
```

---

### Task 5: Asamblea del job en `runAsyncPlanGeneration`

**Files:**
- Modify: `src/services/planBuilder/asyncGenerationLoop.ts`
- Test: `src/services/planBuilder/__tests__/asyncGenerationLoopJobTelemetry.test.ts`
- Create: `src/services/planBuilder/__tests__/helpers/asyncLoopTestFixtures.ts`

**Interfaces:**
- Consumes: `estimateCostUsd` (Task 1); `PlanBuilderVariantDescriptor` (Task 2); campos de attempt (Task 4); taxonomía en `meta` (Plan 1).
- Produces:
  - `PlanGenerationJobVariant = PlanBuilderVariantDescriptor & { variantId: string }`.
  - `PlanGenerationJobTelemetry` (ver Step 3).
  - `RunAsyncPlanGenerationInput` gana `enqueuedAt?: number` y `variant?: PlanGenerationJobVariant`.
  - `AsyncPlanGenerationWriter` gana `putJob?(job: PlanGenerationJobTelemetry): Promise<void>`.

- [x] **Step 1: Write the failing test**

Create `src/services/planBuilder/__tests__/asyncLoopTestFixtures.ts` helper (bajo `__tests__/helpers/`). Leer primero `asyncGenerationLoop.test.ts` y **levantar** su writer/LLM fakes en lugar de inventarlos. Debe exponer un reloj determinista (avanza un paso fijo por llamada LLM) y permitir forzar retries y usage incompleto:

```ts
export function makeRunInputForTest(options: {
  weekCount: number
  enqueuedAt?: number            // default: worker start - 2000 (cola simulada)
  concurrency?: number
  tokensPerAttempt?: { input: number; output: number } // usage completo
  omitUsage?: boolean            // simula proveedor sin usage
  attemptsPerWeek?: number       // fuerza N intentos (retry) por semana
  failAllWeeks?: boolean         // todas las semanas terminan en error
  someWeekFails?: boolean        // al menos una semana falla, el resto succeed (caso partial)
  budgetExhaust?: boolean        // agota budget dejando semanas sin generar
  cancelAfterFirstWeek?: boolean
}): { input: RunAsyncPlanGenerationInput; base: AsyncPlanGenerationWriter }
```

Create `src/services/planBuilder/__tests__/asyncGenerationLoopJobTelemetry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  runAsyncPlanGeneration,
  type AsyncPlanGenerationWriter,
  type PlanGenerationJobTelemetry,
  type PlanGenerationJobVariant,
} from '../asyncGenerationLoop'
import { makeRunInputForTest } from './helpers/asyncLoopTestFixtures'

const VARIANT: PlanGenerationJobVariant = {
  provider: 'claude', model: 'claude-sonnet-4-6', effort: 'omitted', thinkingMode: 'omitted',
  temperature: 0.25, maxTokens: 5000, promptVersion: 'v', schemaVersion: 'v',
  qualityVersion: 1, concurrency: 3, variantId: 's46-q1-abcd1234',
}

function collecting(base: AsyncPlanGenerationWriter, opts?: { rejectPutJob?: boolean }) {
  const jobs: PlanGenerationJobTelemetry[] = []
  return {
    jobs,
    writer: {
      ...base,
      async putJob(job: PlanGenerationJobTelemetry) {
        if (opts?.rejectPutJob) throw new Error('supabase down')
        jobs.push(job)
      },
    } as AsyncPlanGenerationWriter,
  }
}

describe('runAsyncPlanGeneration job telemetry', () => {
  it('emits one succeeded job with worker-relative and e2e timings', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 2, enqueuedAt: 1_000 })
    const { writer, jobs } = collecting(base)
    await runAsyncPlanGeneration({ ...input, writer, variant: VARIANT })

    expect(jobs).toHaveLength(1)
    const job = jobs[0]
    expect(job.outcome).toBe('succeeded')
    expect(job.weekCountSucceeded).toBe(2)
    expect(job.firstWeekReadyE2eMs! - job.firstWeekReadyMs!).toBe(job.workerStartedAt - job.enqueuedAt)
    expect(job.planCompleteMs).not.toBeNull()
    expect(job.planCompleteMs).toBeLessThanOrEqual(job.terminalMs)
  })

  it('sums tokens across MULTIPLE attempts and prices the run', async () => {
    const { input, base } = makeRunInputForTest({
      weekCount: 1, attemptsPerWeek: 2, tokensPerAttempt: { input: 4000, output: 1500 },
    })
    const { writer, jobs } = collecting(base)
    await runAsyncPlanGeneration({ ...input, writer, variant: VARIANT })
    expect(jobs[0].totalInputTokens).toBe(8000)
    expect(jobs[0].totalOutputTokens).toBe(3000)
    // (8000/1e6*3) + (3000/1e6*15) = 0.024 + 0.045 = 0.069
    expect(jobs[0].estimatedCostUsd).toBeCloseTo(0.069, 6)
  })

  it('nulls cost when a billable attempt reports no usage', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 1, omitUsage: true })
    const { writer, jobs } = collecting(base)
    await runAsyncPlanGeneration({ ...input, writer, variant: VARIANT })
    expect(jobs[0].estimatedCostUsd).toBeNull()
  })

  it('reports partial when some weeks fail without budget exhaustion', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 2, someWeekFails: true })
    const { writer, jobs } = collecting(base)
    await runAsyncPlanGeneration({ ...input, writer, variant: VARIANT })
    expect(jobs[0].outcome).toBe('partial')
  })

  it('reports budget_exhausted even when some weeks succeeded', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 4, budgetExhaust: true })
    const { writer, jobs } = collecting(base)
    await runAsyncPlanGeneration({ ...input, writer, variant: VARIANT })
    expect(jobs[0].outcome).toBe('budget_exhausted')
    expect(jobs[0].weekCountSucceeded).toBeGreaterThan(0)
  })

  it('reports failed when every week errors', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 2, failAllWeeks: true })
    const { writer, jobs } = collecting(base)
    await runAsyncPlanGeneration({ ...input, writer, variant: VARIANT })
    expect(jobs[0].outcome).toBe('failed')
  })

  it('marks cancelled and leaves plan_complete_ms null (weeks pending)', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 2, cancelAfterFirstWeek: true })
    const { writer, jobs } = collecting(base)
    await runAsyncPlanGeneration({ ...input, writer, variant: VARIANT })
    expect(jobs[0].outcome).toBe('cancelled')
    expect(jobs[0].planCompleteMs).toBeNull()
  })

  it('emits a failed job when the run throws, then rethrows', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 1 })
    const throwing: AsyncPlanGenerationWriter = {
      ...base,
      async putWeek() { throw new Error('writer exploded') },
    }
    const { writer, jobs } = collecting(throwing)
    await expect(runAsyncPlanGeneration({ ...input, writer, variant: VARIANT })).rejects.toThrow('writer exploded')
    expect(jobs).toHaveLength(1)
    expect(jobs[0].outcome).toBe('failed')
  })

  it('does not throw out of the run when putJob rejects', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 1 })
    const { writer } = collecting(base, { rejectPutJob: true })
    await expect(runAsyncPlanGeneration({ ...input, writer, variant: VARIANT })).resolves.toBeDefined()
  })

  it('does not throw when the writer has no putJob', async () => {
    const { input, base } = makeRunInputForTest({ weekCount: 1 })
    const noJob: AsyncPlanGenerationWriter = { ...base }
    delete (noJob as { putJob?: unknown }).putJob
    await expect(runAsyncPlanGeneration({ ...input, writer: noJob, variant: VARIANT })).resolves.toBeDefined()
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/asyncGenerationLoopJobTelemetry.test.ts`
Expected: FAIL — tipos/`putJob`/`variant` inexistentes.

- [x] **Step 3: Write minimal implementation**

Add near the top imports:

```ts
import { estimateCostUsd } from './pricing'
import type { PlanBuilderVariantDescriptor } from './telemetryVersions'
```

Add the two exported interfaces after `PlanGenerationAttemptTelemetry`:

```ts
export type PlanGenerationJobVariant = PlanBuilderVariantDescriptor & { variantId: string }

export interface PlanGenerationJobTelemetry {
  jobId: string
  athleteId: string
  planId: string
  enqueuedAt: number
  workerStartedAt: number
  weekCountRequested: number
  weekCountSucceeded: number
  weekCountFailed: number
  workerConcurrency: number
  /** Desde worker start hasta el primer putWeek con semana lista. Null si ninguna quedó lista. */
  firstWeekReadyMs: number | null
  /** Desde enqueue; incluye cola de arranque del worker. */
  firstWeekReadyE2eMs: number | null
  /** Desde worker start hasta que la ÚLTIMA semana target quedó terminal (último putWeek). Null si quedan pendientes. */
  planCompleteMs: number | null
  /** Desde worker start hasta el cierre de la corrida (siempre presente). */
  terminalMs: number
  previousWeekContextSource: 'none' | 'shell' | 'ready'
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheCreationTokens: number
  /** Null si algún intento facturable no reportó usage, o el modelo no tiene precio. */
  estimatedCostUsd: number | null
  outcome: 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'budget_exhausted'
  variant: PlanGenerationJobVariant
  createdAt: number
}
```

Extend `AsyncPlanGenerationWriter` (after `putAttempt`):

```ts
  /** Append-only, best-effort job-level observability; failures never fail generation. */
  putJob?(job: PlanGenerationJobTelemetry): Promise<void>
```

Extend `RunAsyncPlanGenerationInput` (after `budgetMs`):

```ts
  /** Cuando el cliente/enqueue encoló (identity-checked por el caller). Default: worker start. */
  enqueuedAt?: number
  variant?: PlanGenerationJobVariant
```

**Ordering is load-bearing.** Everything `finalizeJob` reads must exist before the **first `await`** (the initial `writer.putPlan`, line 614), or a failure of that first checkpoint would throw before the job could be assembled. In the current code the block that computes `targetWeekIndexes`, `deadlineAt`, `concurrency`, `targetPosition`, `stopLaunching` and `cancelled` sits just **after** that first `putPlan` (lines 616–624); move that whole block to just **before** line 614 (it only depends on `weeks`, `input.targetWeekIndexes`, `input.concurrency` and `getNow`, all available there). Then declare the accumulators and `finalizeJob` right after `let cancelled = false` — still before the first `putPlan`. The `try` (Step below) begins at that first `putPlan`.

Declare accumulators:

```ts
  let budgetExhausted = false
  let firstReadyAt: number | null = null
  let allTargetsTerminalAt: number | null = null
  const terminalTargets = new Set<number>()
  let previousWeekContextSource: PlanGenerationJobTelemetry['previousWeekContextSource'] = 'none'
  const tokenTotals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
  let anyBillableAttempt = false
  let costUsd: number | null = 0

  const observeWeekWrite = (week: TrainingPlanWeek): void => {
    if (firstReadyAt === null && isReadyWeek(week)) firstReadyAt = getNow()
    if (!targetWeekIndexes.includes(week.weekIndex)) return
    if (!terminalTargets.has(week.weekIndex) && (isReadyWeek(week) || week.status === 'error')) {
      terminalTargets.add(week.weekIndex)
      if (terminalTargets.size === targetWeekIndexes.length && allTargetsTerminalAt === null) {
        allTargetsTerminalAt = getNow()
      }
    }
  }
```

Call `observeWeekWrite(<week>)` immediately after **every** `await input.writer.putWeek(<week>)` in this function (grep `writer.putWeek(` — checkpoints for generating weeks are harmless: `observeWeekWrite` filters by ready/error). Include the errored writes inside `markRemainingBudgetErrors`, and set the budget flag there:

```ts
      await input.writer.putWeek(erroredWeek)
      observeWeekWrite(erroredWeek)
      budgetExhausted = true
```

Capture the cross-week source right after `previousWeek` is resolved (line 748), classifying the **exact object handed to the prompt** — not a re-query of `weeks`, which could observe a different week completing between the two reads:

```ts
      if (weekIndex > 0) {
        const source: PlanGenerationJobTelemetry['previousWeekContextSource'] =
          previousWeek == null ? 'none' : isReadyWeek(previousWeek) ? 'ready' : 'shell'
        if (source === 'shell') previousWeekContextSource = 'shell'
        else if (source === 'ready' && previousWeekContextSource === 'none') previousWeekContextSource = 'ready'
      }
```

Accumulate tokens and per-attempt cost on **every** attempt (independent of `putAttempt`), and pass variant/taxonomy into the attempt. Replace the `onAttemptCompleted` wiring (lines 776-811):

```ts
        onAttemptCompleted: async (attempt, attemptResult, createdAt, attemptMaxTokens) => {
          const meta = attemptResult.meta
          anyBillableAttempt = true
          const hasUsage = meta.promptTokens != null && meta.completionTokens != null
          tokenTotals.input += meta.promptTokens ?? 0
          tokenTotals.output += meta.completionTokens ?? 0
          tokenTotals.cacheRead += meta.cacheReadInputTokens ?? 0
          tokenTotals.cacheCreation += meta.cacheCreationInputTokens ?? 0
          if (costUsd !== null) {
            const model = meta.model ?? input.variant?.model ?? null
            const attemptCost = hasUsage && model
              ? estimateCostUsd({
                  model,
                  at: createdAt,
                  inputTokens: meta.promptTokens ?? 0,
                  outputTokens: meta.completionTokens ?? 0,
                  cacheReadTokens: meta.cacheReadInputTokens ?? 0,
                  cacheCreationTokens: meta.cacheCreationInputTokens ?? 0,
                })
              : null
            costUsd = attemptCost === null ? null : costUsd + attemptCost
          }
          if (!input.writer.putAttempt) return
          const qualityReview = reviewAttemptWeek(attemptResult)
          await input.writer.putAttempt({
            athleteId: plan.athleteId,
            planId: plan.id,
            jobId: input.jobId,
            weekIndex,
            attempt,
            traceId: meta.traceId,
            provider: meta.provider,
            model: meta.model,
            promptTokens: meta.promptTokens,
            completionTokens: meta.completionTokens,
            cacheCreationInputTokens: meta.cacheCreationInputTokens,
            cacheReadInputTokens: meta.cacheReadInputTokens,
            durationMs: meta.durationMs,
            finishReason: meta.finishReason,
            outcome: classifyAttemptOutcome(attemptResult),
            errorClass: meta.errorClass,
            retryUsed: attempt > 1 || Boolean(meta.retryUsed),
            maxTokens: attemptMaxTokens,
            workerConcurrency: concurrency,
            rawSessionCount: meta.rawSessionCount,
            validSessionCount: meta.validSessionCount,
            droppedSessionCount: meta.droppedSessionCount,
            repairedSessionCount: meta.repairedSessionCount,
            addedFallbackCount: meta.addedFallbackCount,
            qualityScore: qualityReview?.score,
            qualityGrade: qualityReview?.grade,
            qualityCriticalIssueCount: qualityReview?.issues.filter((i) => i.severity === 'error').length,
            qualityWarningCount: qualityReview?.issues.filter((i) => i.severity === 'warning').length,
            variantId: input.variant?.variantId,
            effort: input.variant?.effort,
            thinkingMode: input.variant?.thinkingMode,
            promptVersion: input.variant?.promptVersion,
            schemaVersion: input.variant?.schemaVersion,
            qualityVersion: input.variant?.qualityVersion,
            repairTaxonomyVersion: meta.repairTaxonomyVersion,
            correctiveActionCount: meta.correctiveActionCount,
            structuralActionCount: meta.structuralActionCount,
            hydrationActionCount: meta.hydrationActionCount,
            movedSessionCount: meta.movedSessionCount,
            filteredSportCount: meta.filteredSportCount,
            hydratedSessionsAffected: meta.hydratedSessionsAffected,
            correctedSessionsAffected: meta.correctedSessionsAffected,
            structurallyRepairedSessionsAffected: meta.structurallyRepairedSessionsAffected,
            createdAt,
          })
        },
```

Add the idempotent finalizer just above the first accumulator or right before the try wrapper, capturing all state via closure:

```ts
  let jobFinalized = false
  const finalizeJob = async (threw: boolean): Promise<void> => {
    if (jobFinalized) return
    jobFinalized = true
    if (!input.writer.putJob || !input.variant) return

    const terminalAt = getNow()
    const enqueuedAt = input.enqueuedAt ?? startedAt
    const succeeded = weeks.filter((w) => targetWeekIndexes.includes(w.weekIndex) && isReadyWeek(w)).length
    const failed = weeks.filter((w) => targetWeekIndexes.includes(w.weekIndex) && w.status === 'error').length

    const outcome: PlanGenerationJobTelemetry['outcome'] =
      cancelled ? 'cancelled'
      : budgetExhausted ? 'budget_exhausted'
      : succeeded === targetWeekIndexes.length && !threw ? 'succeeded'
      : succeeded > 0 && !threw ? 'partial'
      : 'failed'

    const job: PlanGenerationJobTelemetry = {
      jobId: input.jobId,
      athleteId: plan.athleteId,
      planId: plan.id,
      enqueuedAt,
      workerStartedAt: startedAt,
      weekCountRequested: targetWeekIndexes.length,
      weekCountSucceeded: succeeded,
      weekCountFailed: failed,
      workerConcurrency: concurrency,
      firstWeekReadyMs: firstReadyAt === null ? null : firstReadyAt - startedAt,
      firstWeekReadyE2eMs: firstReadyAt === null ? null : firstReadyAt - enqueuedAt,
      planCompleteMs: allTargetsTerminalAt === null ? null : allTargetsTerminalAt - startedAt,
      terminalMs: terminalAt - startedAt,
      previousWeekContextSource,
      totalInputTokens: tokenTotals.input,
      totalOutputTokens: tokenTotals.output,
      totalCacheReadTokens: tokenTotals.cacheRead,
      totalCacheCreationTokens: tokenTotals.cacheCreation,
      estimatedCostUsd: anyBillableAttempt ? costUsd : null,
      outcome,
      variant: input.variant,
      createdAt: terminalAt,
    }
    try {
      await input.writer.putJob(job)
    } catch (error) {
      console.warn(`[plan-builder] putJob failed jobId=${input.jobId}: ${error instanceof Error ? error.message : 'unknown'}`)
    }
  }
```

Wrap the body of `runAsyncPlanGeneration` — from the first `await input.writer.putPlan(plan)` down to and **including** both terminal `return { plan, weeks, cancelled: ... }` statements (lines ~614–938) — in `try/catch/finally`, so a single `finalizeJob` fires on normal, cancelled and thrown paths:

```ts
  let threw = false
  try {
    // ... todo el cuerpo existente, incluidos ambos `return { plan, weeks, cancelled: true/false }` ...
  } catch (error) {
    threw = true
    throw error
  } finally {
    await finalizeJob(threw)
  }
```

`finally` corre después de evaluar el `return` y antes de propagar el `throw`, así que cubre los tres caminos con una sola emisión.

> **Hard-kill sigue siendo no observable:** si el proceso del worker se termina abruptamente (OOM, timeout de plataforma) no corre `finally`. Documentado aquí y en Riesgos; una alternativa (insert al enqueue + update terminal) queda fuera de alcance de Plan 2.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/planBuilder/__tests__/asyncGenerationLoopJobTelemetry.test.ts`
Expected: PASS — 10 casos (timings, tokens multi-intento, cost null por usage, partial, budget_exhausted, failed, cancelled, throw→failed, putJob reject, sin putJob).

- [x] **Step 5: Verify the existing loop suite still passes**

Run: `npx vitest run src/services/planBuilder/__tests__/asyncGenerationLoop.test.ts`
Expected: PASS — el wrapper es behavior-preserving para `putAttempt`.

- [x] **Step 6: Commit (owner)**

```bash
git add src/services/planBuilder/asyncGenerationLoop.ts src/services/planBuilder/__tests__/asyncGenerationLoopJobTelemetry.test.ts src/services/planBuilder/__tests__/helpers/asyncLoopTestFixtures.ts
git commit -m "feat(plan-builder): finalize and emit job telemetry on every terminal path"
```

---

### Task 6: Persistencia del job en Netlify (service role)

**Files:**
- Create: `netlify/functions/_shared/planGenerationJobTelemetry.ts`
- Modify: `netlify/functions/_shared/planGenerationShared.ts:164-175`
- Modify: `netlify/functions/generate-plan-background.ts:14-19,40-87`
- Test: `netlify/functions/_shared/__tests__/planGenerationJobTelemetry.test.ts`

**Interfaces:**
- Consumes: `PlanGenerationJobTelemetry` (Task 5), `resolveEffectivePlanBuilderConfig` + `buildVariantId` (Tasks 2–3).
- Produces: `planGenerationJobToRow(job, userId)`, `upsertPlanGenerationJob(client, job, userId)`.

- [x] **Step 1: Write the failing test**

Create `netlify/functions/_shared/__tests__/planGenerationJobTelemetry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import type { PlanGenerationJobTelemetry } from '../../../../src/services/planBuilder/asyncGenerationLoop'
import { planGenerationJobToRow } from '../planGenerationJobTelemetry'

const JOB: PlanGenerationJobTelemetry = {
  jobId: 'job-1', athleteId: 'athlete-1', planId: 'plan-1',
  enqueuedAt: 1_000, workerStartedAt: 3_000,
  weekCountRequested: 4, weekCountSucceeded: 4, weekCountFailed: 0, workerConcurrency: 3,
  firstWeekReadyMs: 8_000, firstWeekReadyE2eMs: 10_000, planCompleteMs: 40_000, terminalMs: 40_000,
  previousWeekContextSource: 'ready',
  totalInputTokens: 12_000, totalOutputTokens: 4_000, totalCacheReadTokens: 0, totalCacheCreationTokens: 0,
  estimatedCostUsd: 0.096, outcome: 'succeeded',
  variant: {
    provider: 'claude', model: 'claude-sonnet-4-6', effort: 'omitted', thinkingMode: 'omitted',
    temperature: 0.25, maxTokens: 5000, promptVersion: 'v', schemaVersion: 'v',
    qualityVersion: 1, concurrency: 3, variantId: 's46-q1-abcd1234',
  },
  createdAt: 43_000,
}

describe('planGenerationJobToRow', () => {
  it('maps provider claude and every field to a snake_case column', () => {
    const row = planGenerationJobToRow(JOB, 'user-1')
    expect(row['provider']).toBe('claude')
    expect(row).toEqual({
      job_id: 'job-1', user_id: 'user-1', athlete_id: 'athlete-1', plan_id: 'plan-1',
      enqueued_at: new Date(1_000).toISOString(), worker_started_at: new Date(3_000).toISOString(),
      week_count_requested: 4, week_count_succeeded: 4, week_count_failed: 0, worker_concurrency: 3,
      first_week_ready_ms: 8_000, first_week_ready_e2e_ms: 10_000, plan_complete_ms: 40_000, terminal_ms: 40_000,
      first_week_discoverable_estimated_ms: null,
      previous_week_context_source: 'ready',
      provider: 'claude', model: 'claude-sonnet-4-6', effort: 'omitted', thinking_mode: 'omitted',
      temperature: 0.25, max_tokens: 5000, prompt_version: 'v', schema_version: 'v',
      quality_version: 1, variant_id: 's46-q1-abcd1234',
      total_input_tokens: 12_000, total_output_tokens: 4_000, total_cache_read_tokens: 0, total_cache_creation_tokens: 0,
      estimated_cost_usd: 0.096, outcome: 'succeeded', created_at: new Date(43_000).toISOString(),
    })
  })

  it('nulls timings and cost that were not observed', () => {
    const row = planGenerationJobToRow(
      { ...JOB, firstWeekReadyMs: null, firstWeekReadyE2eMs: null, planCompleteMs: null, estimatedCostUsd: null },
      'user-1',
    )
    expect(row['first_week_ready_ms']).toBeNull()
    expect(row['plan_complete_ms']).toBeNull()
    expect(row['estimated_cost_usd']).toBeNull()
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/_shared/__tests__/planGenerationJobTelemetry.test.ts`
Expected: FAIL — módulo inexistente.

- [x] **Step 3: Write minimal implementation**

Create `netlify/functions/_shared/planGenerationJobTelemetry.ts`:

```ts
import type { PlanGenerationJobTelemetry } from '../../../src/services/planBuilder/asyncGenerationLoop'

interface JobInsertClient {
  from(table: string): {
    upsert(
      row: Record<string, unknown>,
      options: { onConflict: string; ignoreDuplicates: boolean },
    ): PromiseLike<{ error: { code?: string } | null }>
  }
}

export function planGenerationJobToRow(
  job: PlanGenerationJobTelemetry,
  userId: string,
): Record<string, unknown> {
  return {
    job_id: job.jobId,
    user_id: userId,
    athlete_id: job.athleteId,
    plan_id: job.planId,
    enqueued_at: new Date(job.enqueuedAt).toISOString(),
    worker_started_at: new Date(job.workerStartedAt).toISOString(),
    week_count_requested: job.weekCountRequested,
    week_count_succeeded: job.weekCountSucceeded,
    week_count_failed: job.weekCountFailed,
    worker_concurrency: job.workerConcurrency,
    first_week_ready_ms: job.firstWeekReadyMs,
    first_week_ready_e2e_ms: job.firstWeekReadyE2eMs,
    plan_complete_ms: job.planCompleteMs,
    terminal_ms: job.terminalMs,
    first_week_discoverable_estimated_ms: null,
    previous_week_context_source: job.previousWeekContextSource,
    provider: job.variant.provider,
    model: job.variant.model,
    effort: job.variant.effort,
    thinking_mode: job.variant.thinkingMode,
    temperature: job.variant.temperature,
    max_tokens: job.variant.maxTokens,
    prompt_version: job.variant.promptVersion,
    schema_version: job.variant.schemaVersion,
    quality_version: job.variant.qualityVersion,
    variant_id: job.variant.variantId,
    total_input_tokens: job.totalInputTokens,
    total_output_tokens: job.totalOutputTokens,
    total_cache_read_tokens: job.totalCacheReadTokens,
    total_cache_creation_tokens: job.totalCacheCreationTokens,
    estimated_cost_usd: job.estimatedCostUsd,
    outcome: job.outcome,
    created_at: new Date(job.createdAt).toISOString(),
  }
}

export async function upsertPlanGenerationJob(
  client: JobInsertClient,
  job: PlanGenerationJobTelemetry,
  userId: string,
): Promise<void> {
  const { error } = await client
    .from('plan_generation_jobs')
    .upsert(planGenerationJobToRow(job, userId), { onConflict: 'job_id', ignoreDuplicates: true })
  if (!error) return
  throw Object.assign(new Error('plan generation job telemetry insert failed'), { code: error.code })
}
```

Wire `putJob` in `planGenerationShared.ts`. Add the import and extend the telemetry-gated block:

```ts
import { upsertPlanGenerationJob } from './planGenerationJobTelemetry'
```

```ts
          async putJob(job) {
            await withTimeout(
              upsertPlanGenerationJob(telemetrySupabase, job, userId),
              TELEMETRY_OP_TIMEOUT_MS,
              'putJob',
            )
          },
```

- [x] **Step 4: Pass `enqueuedAt` (identity-checked) and `variant`**

In `generate-plan-background.ts`, delete the local `resolvePlanBuilderConcurrency` (lines 14-19) and import the shared resolver + builder:

```ts
import { resolveEffectivePlanBuilderConfig } from './_shared/planBuilderRunConfig'
import { buildVariantId } from '../../src/services/planBuilder/telemetryVersions'
import type { PlanGenerationJobVariant } from '../../src/services/planBuilder/asyncGenerationLoop'
```

After `const existingPlan = await writer.getPlan(planId)` (line 46), build the variant and the identity-checked enqueue time:

```ts
    const effectiveConfig = resolveEffectivePlanBuilderConfig(process.env)
    const variant: PlanGenerationJobVariant = {
      ...effectiveConfig,
      variantId: buildVariantId(effectiveConfig),
    }
    // Solo adoptar el startedAt previo si pertenece a ESTE job; si no, es otra
    // corrida (o un plan ya completado) y usamos el worker start.
    const enqueuedAt = existingPlan?.generationSummary?.jobId === jobId
      ? existingPlan.generationSummary.startedAt
      : startedAt
```

Pass `concurrency: effectiveConfig.concurrency`, `enqueuedAt` and `variant` into the run call (replace `concurrency: resolvePlanBuilderConcurrency()`):

```ts
      concurrency: effectiveConfig.concurrency,
      enqueuedAt,
      variant,
```

- [x] **Step 5: Run tests**

Run: `npx vitest run netlify/functions/_shared/__tests__/planGenerationJobTelemetry.test.ts`
Expected: PASS — 2 tests.

- [x] **Step 6: Commit (owner)**

```bash
git add netlify/functions/_shared/planGenerationJobTelemetry.ts netlify/functions/_shared/planGenerationShared.ts netlify/functions/generate-plan-background.ts netlify/functions/_shared/__tests__/planGenerationJobTelemetry.test.ts
git commit -m "feat(plan-builder): persist job telemetry with identity-checked enqueue time"
```

---

### Task 7: Retención de `plan_generation_jobs`

**Files:**
- Modify: `netlify/functions/_shared/planGenerationTelemetryRetention.ts`
- Test: `netlify/functions/_shared/planGenerationTelemetryRetention.test.ts`

**Interfaces:**
- Produces: `deleteExpiredPlanGenerationJobs(client, now?): Promise<number>`; `runPlanGenerationTelemetryRetention` purga ambas tablas.

- [x] **Step 1: Write the failing test**

Add to `planGenerationTelemetryRetention.test.ts`:

```ts
import { deleteExpiredPlanGenerationJobs } from './planGenerationTelemetryRetention'

describe('deleteExpiredPlanGenerationJobs', () => {
  it('deletes job rows older than the retention window', async () => {
    const tables: string[] = []
    const client = {
      from(table: string) {
        tables.push(table)
        return { delete() { return { lt: async () => ({ count: 4, error: null }) } } }
      },
    }
    const deleted = await deleteExpiredPlanGenerationJobs(client as never, Date.UTC(2026, 6, 24))
    expect(deleted).toBe(4)
    expect(tables).toContain('plan_generation_jobs')
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/_shared/planGenerationTelemetryRetention.test.ts`
Expected: FAIL — `deleteExpiredPlanGenerationJobs` no exportado.

- [x] **Step 3: Write minimal implementation**

Add the job deleter mirroring the attempts one, and run both in `runPlanGenerationTelemetryRetention`:

```ts
export async function deleteExpiredPlanGenerationJobs(
  client: RetentionClient,
  now = Date.now(),
): Promise<number> {
  const cutoff = new Date(now - PLAN_GENERATION_TELEMETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await client
    .from('plan_generation_jobs')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff)
  if (error) throw new Error(error.message ?? 'telemetry retention failed')
  return count ?? 0
}
```

```ts
    const [deletedAttempts, deletedJobs] = await Promise.all([
      withTimeout(deleteExpiredPlanGenerationAttempts(client), RETENTION_TIMEOUT_MS, 'plan generation attempt retention'),
      withTimeout(deleteExpiredPlanGenerationJobs(client), RETENTION_TIMEOUT_MS, 'plan generation job retention'),
    ])
    return {
      statusCode: 200,
      body: JSON.stringify({ deleted: deletedAttempts, deletedJobs, durationMs: Date.now() - startedAt }),
    }
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/_shared/planGenerationTelemetryRetention.test.ts`
Expected: PASS.

- [x] **Step 5: Commit (owner)**

```bash
git add netlify/functions/_shared/planGenerationTelemetryRetention.ts netlify/functions/_shared/planGenerationTelemetryRetention.test.ts
git commit -m "feat(plan-builder): extend telemetry retention to job rows"
```

---

### Task 8: Migración `016` + guard de drift bidireccional

**Files:**
- Create: `supabase/016_plan_generation_jobs.sql`
- Test: `netlify/functions/_shared/__tests__/planGenerationJobSchema.test.ts`

**Migración manual.** Este task deja el `.sql` y un guard de drift **en ambos sentidos**; la aplicación en prod la confirma el owner (criterio de salida).

- [x] **Step 1: Write the bidirectional drift guard**

Create `netlify/functions/_shared/__tests__/planGenerationJobSchema.test.ts`. Compara **conjuntos** de columnas (mapper ↔ CREATE) y verifica que cada campo nuevo del attempt esté en el `ALTER`:

```ts
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { PlanGenerationJobTelemetry } from '../../../../src/services/planBuilder/asyncGenerationLoop'
import { planGenerationJobToRow } from '../planGenerationJobTelemetry'

function readMigration(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return readFileSync(join(here, '..', '..', '..', '..', 'supabase', '016_plan_generation_jobs.sql'), 'utf8')
}

const JOB: PlanGenerationJobTelemetry = {
  jobId: 'j', athleteId: 'a', planId: 'p', enqueuedAt: 1, workerStartedAt: 2,
  weekCountRequested: 1, weekCountSucceeded: 1, weekCountFailed: 0, workerConcurrency: 3,
  firstWeekReadyMs: 1, firstWeekReadyE2eMs: 1, planCompleteMs: 1, terminalMs: 1,
  previousWeekContextSource: 'none', totalInputTokens: 0, totalOutputTokens: 0,
  totalCacheReadTokens: 0, totalCacheCreationTokens: 0, estimatedCostUsd: 0, outcome: 'succeeded',
  variant: {
    provider: 'claude', model: 'claude-sonnet-4-6', effort: 'omitted', thinkingMode: 'omitted',
    temperature: 0.25, maxTokens: 5000, promptVersion: 'v', schemaVersion: 'v',
    qualityVersion: 1, concurrency: 3, variantId: 'v',
  },
  createdAt: 3,
}

describe('plan_generation_jobs schema drift guard', () => {
  it('the CREATE columns and the row mapper keys are the same set', () => {
    const sql = readMigration()
    const createBlock = sql.slice(
      sql.indexOf('create table if not exists public.plan_generation_jobs'),
      sql.indexOf('create index'),
    )
    const sqlColumns = new Set(
      [...createBlock.matchAll(/^\s{2}([a-z_]+)\s/gm)]
        .map((m) => m[1])
        .filter((name) => !['create', 'primary', 'constraint', 'check', 'references'].includes(name)),
    )
    const rowColumns = new Set(Object.keys(planGenerationJobToRow(JOB, 'user-1')))
    // Ambos sentidos: sin columnas SQL huérfanas ni claves de mapper sin columna.
    expect([...rowColumns].filter((c) => !sqlColumns.has(c))).toEqual([])
    expect([...sqlColumns].filter((c) => !rowColumns.has(c))).toEqual([])
  })

  it('declares the derived column and comments it', () => {
    const sql = readMigration()
    expect(sql).toContain('first_week_discoverable_estimated_ms')
    expect(sql).toMatch(/comment on column public\.plan_generation_jobs\.first_week_discoverable_estimated_ms/)
  })

  it('the ALTER adds every new attempt column the mapper writes', () => {
    const sql = readMigration()
    const newAttemptColumns = [
      'variant_id', 'effort', 'thinking_mode', 'prompt_version', 'schema_version', 'quality_version',
      'repair_taxonomy_version', 'corrective_action_count', 'structural_action_count', 'hydration_action_count',
      'moved_session_count', 'filtered_sport_count',
      'hydrated_sessions_affected', 'corrected_sessions_affected', 'structurally_repaired_sessions_affected',
    ]
    for (const column of newAttemptColumns) {
      expect(sql, `attempt column ${column}`).toContain(`add column if not exists ${column}`)
    }
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/_shared/__tests__/planGenerationJobSchema.test.ts`
Expected: FAIL — el `.sql` no existe.

- [x] **Step 3: Write the migration**

Create `supabase/016_plan_generation_jobs.sql`:

```sql
-- Plan/job-level observability for the async Plan Builder. One row per run,
-- grouping the append-only rows of plan_generation_attempts by job_id.
-- Server-only writes (service role); clients may read their own rows.

create table if not exists public.plan_generation_jobs (
  job_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  athlete_id text not null references public.athletes(id) on delete cascade,
  plan_id text not null references public.training_plans(id) on delete cascade,
  week_count_requested smallint not null check (week_count_requested >= 0),
  week_count_succeeded smallint not null check (week_count_succeeded >= 0),
  week_count_failed smallint not null check (week_count_failed >= 0),
  worker_concurrency smallint null check (worker_concurrency > 0),
  enqueued_at timestamptz not null,
  worker_started_at timestamptz not null,
  first_week_ready_ms integer null check (first_week_ready_ms >= 0),
  first_week_ready_e2e_ms integer null check (first_week_ready_e2e_ms >= 0),
  plan_complete_ms integer null check (plan_complete_ms >= 0),
  terminal_ms integer not null check (terminal_ms >= 0),
  first_week_discoverable_estimated_ms integer null check (first_week_discoverable_estimated_ms >= 0),
  previous_week_context_source text not null check (previous_week_context_source in ('none', 'shell', 'ready')),
  provider text not null,
  model text null,
  effort text null,
  thinking_mode text null,
  temperature real null,
  max_tokens integer null check (max_tokens > 0),
  prompt_version text not null,
  schema_version text not null,
  quality_version smallint not null check (quality_version in (1, 2)),
  variant_id text not null,
  total_input_tokens integer null check (total_input_tokens >= 0),
  total_output_tokens integer null check (total_output_tokens >= 0),
  total_cache_read_tokens integer null check (total_cache_read_tokens >= 0),
  total_cache_creation_tokens integer null check (total_cache_creation_tokens >= 0),
  estimated_cost_usd numeric(12, 6) null check (estimated_cost_usd >= 0),
  outcome text not null check (outcome in ('succeeded', 'partial', 'failed', 'cancelled', 'budget_exhausted')),
  created_at timestamptz not null default now()
);

comment on column public.plan_generation_jobs.first_week_discoverable_estimated_ms is
  'Derived and nullable (spec 5.1): only populated if a future UI test measures effective render; never modelled from the poll interval.';

create index if not exists plan_generation_jobs_user_created_idx
  on public.plan_generation_jobs (user_id, created_at desc);
create index if not exists plan_generation_jobs_variant_created_idx
  on public.plan_generation_jobs (variant_id, created_at desc);
create index if not exists plan_generation_jobs_plan_idx
  on public.plan_generation_jobs (plan_id);

alter table public.plan_generation_jobs enable row level security;

drop policy if exists plan_generation_jobs_select_own on public.plan_generation_jobs;
create policy plan_generation_jobs_select_own
  on public.plan_generation_jobs
  for select
  using (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE for authenticated clients. Service role only.

-- Variant identity + repair taxonomy on the per-attempt rows. Additive.
alter table public.plan_generation_attempts
  add column if not exists variant_id text null,
  add column if not exists effort text null,
  add column if not exists thinking_mode text null,
  add column if not exists prompt_version text null,
  add column if not exists schema_version text null,
  add column if not exists quality_version smallint null check (quality_version in (1, 2)),
  add column if not exists repair_taxonomy_version smallint null check (repair_taxonomy_version = 2),
  add column if not exists corrective_action_count smallint null check (corrective_action_count >= 0),
  add column if not exists structural_action_count smallint null check (structural_action_count >= 0),
  add column if not exists hydration_action_count smallint null check (hydration_action_count >= 0),
  add column if not exists moved_session_count smallint null check (moved_session_count >= 0),
  add column if not exists filtered_sport_count smallint null check (filtered_sport_count >= 0),
  add column if not exists hydrated_sessions_affected smallint null check (hydrated_sessions_affected >= 0),
  add column if not exists corrected_sessions_affected smallint null check (corrected_sessions_affected >= 0),
  add column if not exists structurally_repaired_sessions_affected smallint null check (structurally_repaired_sessions_affected >= 0);

create index if not exists plan_generation_attempts_variant_created_idx
  on public.plan_generation_attempts (variant_id, created_at desc);
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/_shared/__tests__/planGenerationJobSchema.test.ts`
Expected: PASS — conjuntos de columnas iguales en ambos sentidos, columna derivada comentada, ALTER completo.

> Si el guard falla por identificar como columna alguna palabra reservada dentro del `CREATE` (p. ej. `constraint`), ajusta la lista de filtrado del regex — **no** relajes la comparación de conjuntos.

- [x] **Step 5: Commit (owner)**

```bash
git add supabase/016_plan_generation_jobs.sql netlify/functions/_shared/__tests__/planGenerationJobSchema.test.ts
git commit -m "feat(supabase): add 016 plan_generation_jobs and attempt variant/taxonomy columns"
```

- [ ] **Step 6: Rollout manual en prod (owner) — ORDEN OBLIGATORIO**

`016` es aditiva, pero el nuevo mapper de attempts escribe columnas nuevas; si el código se despliega antes que la migración, PostgREST rechaza la **fila completa** de cada attempt (no solo el job) y apaga la telemetría de attempts existente. Orden:

1. Aplicar `supabase/016_plan_generation_jobs.sql` en producción.
2. Confirmar: `plan_generation_jobs` existe con RLS `select` propio y sin políticas de escritura; las columnas nuevas de `plan_generation_attempts` existen; refrescar el **schema cache** de PostgREST (Supabase: Settings → API → Reload, o `notify pgrst, 'reload schema'`).
3. Desplegar el bundle con el código de Plan 2.
4. Generación smoke: una corrida real escribe **una** fila en `plan_generation_jobs` (agrupable por `job_id` con sus attempts) y los attempts traen `variant_id`/taxonomía.

No marcar el criterio de salida hasta que el owner confirme los 4 pasos.

**Estado (2026-07-25):** el owner aplicó `016` en producción (pasos 1-2). Con la migración ya aplicada, el orden obligatorio queda satisfecho y el merge a `main` es seguro. Pendientes: paso 3 (desplegar el bundle) y paso 4 (smoke de una corrida real que escriba una fila en `plan_generation_jobs`).

---

### Task 9: Verificación completa y documentación

**Files:**
- Modify: `CLAUDE.md`, `PROJECT_REVIEW_AND_ROADMAP.md`

- [x] **Step 1: Full verification**

Run: `npm run lint && npm test && npm run build`
Expected: los tres en verde. Registrar el conteo final de archivos/tests.

- [x] **Step 2: Update docs — estado condicional al rollout**

La línea de migraciones de `CLAUDE.md` debe reflejar el estado **real** al momento del commit, no uno fijo:

- **Si el rollout de Task 8 Step 6 NO está confirmado por el owner:** "Migraciones versionadas hasta `016`; aplicadas en producción hasta `015` (`016` pendiente de aplicación manual)."
- **Si el owner confirmó el rollout (los 4 pasos de Task 8 Step 6):** "Migraciones remotas aplicadas hasta `016`."

Actualizar el conteo de suite. En `PROJECT_REVIEW_AND_ROADMAP.md`, agregar la línea de fundación de medición (job telemetry + `016`), marcando aplicada o pendiente según el mismo estado. No commitear "aplicadas hasta 016" antes de la confirmación.

- [x] **Step 3: Commit (owner)**

```bash
git add CLAUDE.md PROJECT_REVIEW_AND_ROADMAP.md
git commit -m "docs: record plan builder job telemetry and migration 016 status"
```

---

## Cobertura del spec y de la review

| Requisito | Task | Hallazgo de review |
|---|---|---|
| §3.1 tabla `plan_generation_jobs`, `job_id` único | 5, 6, 8 | — |
| §3.1 forma de la corrida (week counts, concurrency) | 5, 8 | 3 (concurrencia normalizada) |
| §3.1/§5.1 latencias con nombres finales | 5, 6, 8 | 4 (`plan_complete_ms`) |
| §3.1 variante experimental fiel a la request | 2, 3, 6 | 1 (config real), 2 (`variant_id` completo) |
| §3.1 `previous_week_context_source` | 5, 8 | — |
| §3.1/§5.4 tokens y costo fechado | 1, 5 | 8 (usage ausente ≠ 0, modelo real) |
| §3.1 outcome enum | 5, 8 | 5 (precedencia budget) |
| §3.1 RLS igual que `014` | 8 | — |
| §3.1/§3.2 columnas nuevas de attempts (incl. 3 afectadas) | 4, 8 | 9 (contadores faltantes) |
| §3.1 migración manual + rollout | 8 | 10 (orden migración→deploy) |
| enqueue identity | 6 | 6 |
| una fila en todo camino terminal | 5 | 7 (`finalizeJob` + throw) |
| guard de drift bidireccional | 8 | corrección adicional |
| test extendido, no duplicado | 4 | corrección adicional |
| orden de tasks respeta typecheck | 4 antes de 5 | corrección adicional |

**Fuera de este plan (→ Plan 3):** cross-week detallado (§3.4), loadtest (§3.6), calibración/umbral y activación de v2 (§5.3).

### Endurecimientos posteriores a la code review (2026-07-25)

- **Corrida sin fila cuando el worker falla antes del loop.** `finalizeJob` solo cubre desde el primer await de `runAsyncPlanGeneration`; una excepción en `getPlan`/`putPlan`/el lote inicial de `putWeek` de `generate-plan-background` dejaba un job ya encolado sin ninguna fila. Se agregó `emitUnstartedJobTelemetry`, cableado en el handler como fallback hasta que el loop toma la propiedad de la fila (el camino de dedupe no emite, porque no hubo corrida propia). Cubierto por `netlify/functions/__tests__/generatePlanBackground.test.ts`.
- **Handoff explícito del emisor (segunda pasada de review).** Soltar el fallback justo antes de llamar al loop dejaba una ventana: el preámbulo **síncrono** de `runAsyncPlanGeneration` (checkpoint inicial vía `buildSummary → totalAttempts`) corre fuera de su `try/finally` y puede lanzar con una semana mal formada, porque `isGeneratePlanPayload` solo valida `planId`. El loop ahora invoca `onJobFinalizerArmed` como **primera sentencia dentro del try** —con el `finally` ya armado— y recién ahí el handler suelta su fallback. La transferencia no tiene ventana en ninguna dirección.
- **`plan_complete_ms` null en corridas mixtas.** Las semanas que entran ya listas nunca reciben `putWeek`, así que `terminalTargets` no llegaba a completarse y una corrida `succeeded` reportaba `plan_complete_ms` null. `runAsyncPlanGeneration` precarga los targets ya terminales espejando exactamente el skip del loop (solo cuando no hay `targetWeekIndexes` explícito, y solo semanas `ready`: las `error` se reintentan).

---

## Riesgos

1. **La migración es manual y el orden importa.** Aplicar `016` **antes** de desplegar; si no, el mapper de attempts rompe la fila completa vía PostgREST y apaga telemetría existente. El criterio de salida exige confirmación de los 4 pasos del rollout.
2. **Precios sin verificar.** `MODEL_PRICES` usa valores Sonnet-class estándar; el owner debe verificarlos antes de confiar en `estimated_cost_usd`. Un precio errado no rompe nada pero contamina Fase 3.
3. **Hard-kill del worker no es observable.** `finalizeJob` cubre normal/cancelación/excepción vía `finally`, y las fallas *previas* al loop quedan cubiertas por `emitUnstartedJobTelemetry`, pero un OOM/timeout de plataforma no corre ninguno de los dos. Documentado; insert-al-enqueue + update-terminal queda para un incremento futuro si la pérdida de muestras importa.
4. **`quality_version` sigue el gate, no `LATEST_QUALITY_VERSION`.** Lee `PRODUCTIVE_QUALITY_VERSION` (=1). Plan 3 debe mover ambos juntos al activar v2; si divergen, la telemetría mentiría sobre qué versión puntuó.
5. **Sumar tokens/costo fuera de `putAttempt`.** El wrapper acumula aunque no haya service role. Si se rompe, el job reportaría 0 tokens; los tests de tokens multi-intento y de usage incompleto lo anclan.
6. **`observeWeekWrite` debe llamarse en cada `putWeek`.** Si un sitio de escritura terminal queda sin la llamada, `plan_complete_ms`/`firstWeekReadyMs` se subestiman. El test de timings, el de cancelación (pending → null) y los de corrida mixta lo cubren, pero revisar el grep de `putWeek(` al integrar. El preload de targets ya terminales tiene la misma condición de espejo: si cambia el skip de `takeNextWeekIndex`/`generateTargetWeek`, hay que cambiar el preload con él.

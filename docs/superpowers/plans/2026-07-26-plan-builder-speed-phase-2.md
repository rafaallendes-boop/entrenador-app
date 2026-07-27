# Plan Builder velocidad — Fase 2: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Si esas skills no existen en tu entorno**, ejecutá igual tarea por tarea y en
> orden, sin adelantar tareas, corriendo los comandos de cada paso y parando al
> final de cada tarea para revisión.

**Spec:** `docs/superpowers/specs/2026-07-26-plan-builder-speed-phase-2-design.md`
**Fecha:** 2026-07-26

**Goal:** Hacer `effort` y `thinking` configurables por entorno en el Plan Builder, medir `medium` y `low` contra un control q2 contemporáneo con comparación pareada, y decidir con una regla declarada antes de mirar los datos.

**Architecture:** Una sola resolución de entorno (`planBuilderRunConfig.ts`) alimenta **a la vez** el descriptor de telemetría y el body de la request (`buildClaudeBody`), de modo que un `variant_id` no pueda mentir sobre lo que se envió. La comparación entre corridas es puramente offline: dos módulos nuevos del loadtest emparejan artefactos por `caseId` / `(caseId, weekIndex)` y aplican un gate de elegibilidad y una regla de decisión, ambos funciones puras sin red ni credenciales.

**Tech Stack:** TypeScript (Netlify functions), Node ESM (`scripts/`), Vitest, el loadtest existente (`scripts/loadtest-plan-builder*`).

## Global Constraints

- **Sin migraciones.** Ni Dexie (queda en **v18**), ni Supabase, ni bump de versión de backup. Si una tarea parece necesitar una, está mal entendida: parar y preguntar.
- **Allowlist de Sonnet 4.6, exacta:** `effort` ∈ `low`, `medium`, `high`, `max`. `thinking` ∈ `disabled` **solamente**. `xhigh` y `adaptive` se rechazan como error local.
- **Tres estados de env, sin excepciones:** ausente → no se envía el parámetro y el descriptor dice `'omitted'`; presente y válido → se envía; presente e inválido o incompatible con el modelo → **error de configuración**, nunca un fallback silencioso.
- **Método estadístico congelado:** `percentile()` es **nearest-rank** (`ceil(p·n)`, sin interpolar). No introducir interpolación ni otra librería de percentiles.
- **Emparejamiento obligatorio:** planes por `caseId`, semanas por `(caseId, weekIndex)`. **Prohibido** restar percentiles de dos distribuciones distintas.
- **Umbrales de la regla, literales:** ratio p50 de primera semana ≤ `0.80`; ≥ `10` de 12 casos con ratio < 1; ≥ `5` de 6 escenarios con promedio de sus dos ratios < 1; ratio p50 de plan completo ≤ `1.10`; p50 de Δscore ≥ `-2`; mínimo de Δscore ≥ `-5`; Δ de reparaciones semanales con p50 ≤ `0` y p90 ≤ `0`; Δ de reparaciones por plan con p50 ≤ `0` y segundo peor ≤ `0`.
- **Los artefactos NO se versionan hasta terminar la campaña.** Las tres salidas viven en `loadtest-results/` (gitignored, `.gitignore:49`) mientras dura. Copiar C a `docs/superpowers/experiments/` antes de correr A y B ensucia el árbol, y `mergeGitState` vuelve la suciedad **monotónica**: A y B quedarían rechazadas sin forma de revertirlo salvo re-correrlas.
- **Commits: `CLAUDE.md:72` dice que los hace el owner.** Los bloques `git commit` de cada tarea son la **redacción sugerida**, no una autorización. Ejecutalos **solo si el owner autorizó explícitamente commits para este trabajo**; si no, dejá los cambios en el árbol y reportá el mensaje propuesto al cerrar la tarea.
- El árbol puede tener cambios ajenos a este plan. **No los incluyas en ningún `git add`**: usá siempre rutas explícitas, nunca `git add -A`.
- **Ritmo de verificación:** durante el ciclo TDD se corren los comandos **dirigidos** de cada paso. **Antes del paso de cierre de cada tarea** se corre `npm run lint && npm test` completo. `npm run build` se corre una sola vez, en la Task 8.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `netlify/functions/_shared/planBuilderRunConfig.ts` **(modificar)** | Allowlist por modelo + resolución de directivas de request; única fuente del descriptor y del body. |
| `netlify/functions/_shared/anthropicCaller.ts` **(modificar)** | `buildClaudeBody()` consume las directivas y se exporta para el test de acuerdo. |
| `netlify/functions/_shared/__tests__/planBuilderRunConfig.test.ts` **(modificar)** | Los tres estados y la allowlist. |
| `netlify/functions/_shared/__tests__/anthropicCallerBody.test.ts` **(crear)** | Forma del body y acuerdo descriptor ↔ body. |
| `scripts/loadtest-plan-builder/compare.mjs` **(crear)** | Emparejamiento y métricas pareadas entre dos artefactos. |
| `scripts/loadtest-plan-builder/phase2Gate.mjs` **(crear)** | `evaluatePhase2Variant()` (elegibilidad) y `evaluatePhase2Decision()` (regla). |
| `scripts/loadtest-plan-builder.mjs` **(modificar)** | `--compare` en `parseArgs` y en `main`. |
| `scripts/loadtest-plan-builder.test.js` **(modificar)** | Tests de las tres piezas nuevas. |

---

# HITO 1 — Implementación

Termina en un árbol limpio y commiteado. **Ninguna corrida pagada ocurre en este hito.**

---

## Task 1: Directivas de request y allowlist por modelo

**Files:**
- Modify: `netlify/functions/_shared/planBuilderRunConfig.ts`
- Test: `netlify/functions/_shared/__tests__/planBuilderRunConfig.test.ts`

**Interfaces:**
- Consumes: `resolvePlanBuilderModel(env)` (ya existe en el mismo archivo).
- Produces:
  - `interface PlanBuilderRequestDirectives { effort: string | null; thinking: string | null }`
  - `resolvePlanBuilderRequestDirectives(env: NodeJS.ProcessEnv): PlanBuilderRequestDirectives`
  - `resolveEffectivePlanBuilderConfig` pasa a derivar `effort` / `thinkingMode` de esa función.

**Contexto obligatorio:** leer el archivo de test existente completo. Ya cubre `resolvePlanBuilderModel` y el descriptor por defecto; esta tarea **agrega** bloques y **no** debe cambiar las aserciones existentes salvo donde se indique.

- [ ] **Step 1: Write the failing test**

Agregar al final de `netlify/functions/_shared/__tests__/planBuilderRunConfig.test.ts`, y añadir `resolvePlanBuilderRequestDirectives` al `import` existente desde `'../planBuilderRunConfig'`:

```ts
describe('resolvePlanBuilderRequestDirectives', () => {
  it('does not send anything when the vars are absent', () => {
    const directives = resolvePlanBuilderRequestDirectives({} as never)
    expect(directives).toEqual({ effort: null, thinking: null })
  })

  it('treats an empty value as absent, like the concurrency resolver does', () => {
    expect(resolvePlanBuilderRequestDirectives({
      PLAN_BUILDER_EFFORT: '   ',
    } as never).effort).toBeNull()
  })

  it('applies every effort level Sonnet 4.6 accepts', () => {
    for (const effort of ['low', 'medium', 'high', 'max']) {
      expect(resolvePlanBuilderRequestDirectives({
        PLAN_BUILDER_EFFORT: effort,
      } as never).effort).toBe(effort)
    }
  })

  it('applies thinking disabled', () => {
    expect(resolvePlanBuilderRequestDirectives({
      PLAN_BUILDER_THINKING: 'disabled',
    } as never).thinking).toBe('disabled')
  })

  // Un typo convertiría una corrida pagada en otro control high sin que nadie
  // lo note: por eso es error, no fallback.
  it('throws on a typo instead of silently falling back', () => {
    expect(() => resolvePlanBuilderRequestDirectives({
      PLAN_BUILDER_EFFORT: 'mediun',
    } as never)).toThrow(/PLAN_BUILDER_EFFORT/)
  })

  it('rejects xhigh, which arrived with Opus 4.7 and 4.6 does not accept', () => {
    expect(() => resolvePlanBuilderRequestDirectives({
      PLAN_BUILDER_EFFORT: 'xhigh',
    } as never)).toThrow(/claude-sonnet-4-6/)
  })

  // adaptive queda fuera de alcance: el caller manda temperature 0.25 y esa
  // interacción no está resuelta en esta base de código.
  it('rejects adaptive thinking while it stays out of scope', () => {
    expect(() => resolvePlanBuilderRequestDirectives({
      PLAN_BUILDER_THINKING: 'adaptive',
    } as never)).toThrow(/PLAN_BUILDER_THINKING/)
  })

  it('rejects a value for a model with no allowlist entry', () => {
    expect(() => resolvePlanBuilderRequestDirectives({
      CLAUDE_MODEL_PLAN_BUILDER_WEEK: 'claude-sonnet-5',
      PLAN_BUILDER_EFFORT: 'medium',
    } as never)).toThrow(/claude-sonnet-5/)
  })
})

describe('resolveEffectivePlanBuilderConfig with directives', () => {
  it('reports the applied values, not omitted', () => {
    const config = resolveEffectivePlanBuilderConfig({
      PLAN_BUILDER_EFFORT: 'medium',
      PLAN_BUILDER_THINKING: 'disabled',
    } as never)
    expect(config.effort).toBe('medium')
    expect(config.thinkingMode).toBe('disabled')
  })

  it('propagates the configuration error instead of describing a variant that never ran', () => {
    expect(() => resolveEffectivePlanBuilderConfig({
      PLAN_BUILDER_EFFORT: 'xhigh',
    } as never)).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/_shared/__tests__/planBuilderRunConfig.test.ts`
Expected: FAIL — `resolvePlanBuilderRequestDirectives` no está exportada.

- [ ] **Step 3: Write minimal implementation**

En `netlify/functions/_shared/planBuilderRunConfig.ts`, agregar **antes** de `resolveEffectivePlanBuilderConfig`:

```ts
/**
 * Escalones válidos por modelo. Sonnet 4.6 NO acepta `xhigh` (llegó con Opus
 * 4.7): rechazarlo acá evita que un 400 del proveedor mate una corrida pagada
 * a mitad de camino.
 */
const MODEL_EFFORT_ALLOWLIST: Record<string, readonly string[]> = {
  'claude-sonnet-4-6': ['low', 'medium', 'high', 'max'],
}

/**
 * `adaptive` queda deliberadamente fuera: `buildClaudeBody` manda
 * `temperature: 0.25` incondicionalmente y la interacción entre thinking activo
 * y sampling no-default no está resuelta en esta base de código. Habilitarlo es
 * trabajo de otra fase, no un valor más en la lista.
 */
const MODEL_THINKING_ALLOWLIST: Record<string, readonly string[]> = {
  'claude-sonnet-4-6': ['disabled'],
}

export interface PlanBuilderRequestDirectives {
  /** `null` significa: no incluir `output_config.effort` en el body. */
  effort: string | null
  /** `null` significa: no incluir `thinking` en el body. */
  thinking: string | null
}

function resolveDirective(
  env: NodeJS.ProcessEnv,
  key: string,
  model: string,
  allowlist: Record<string, readonly string[]>,
): string | null {
  const raw = env[key]
  // Vacío se trata como ausente, igual que en `resolveRawConcurrency`: una
  // variable seteada en blanco es mucho más plausiblemente "sin configurar"
  // que un typo.
  if (typeof raw !== 'string' || raw.trim().length === 0) return null

  const value = raw.trim()
  const allowed = allowlist[model] ?? []
  if (!allowed.includes(value)) {
    throw new Error(
      `${key}="${value}" no es válido para ${model}. `
      + `Valores aceptados: ${allowed.length > 0 ? allowed.join(', ') : '(ninguno para este modelo)'}.`,
    )
  }
  return value
}

/**
 * Única fuente de lo que el body envía. `resolveEffectivePlanBuilderConfig`
 * deriva su descriptor de acá, de modo que un `variant_id` no pueda decir
 * `effort=medium` sobre una request que mandó otra cosa.
 */
export function resolvePlanBuilderRequestDirectives(
  env: NodeJS.ProcessEnv,
): PlanBuilderRequestDirectives {
  const model = resolvePlanBuilderModel(env)
  return {
    effort: resolveDirective(env, 'PLAN_BUILDER_EFFORT', model, MODEL_EFFORT_ALLOWLIST),
    thinking: resolveDirective(env, 'PLAN_BUILDER_THINKING', model, MODEL_THINKING_ALLOWLIST),
  }
}
```

y reemplazar las dos líneas hardcodeadas dentro de `resolveEffectivePlanBuilderConfig`:

```ts
export function resolveEffectivePlanBuilderConfig(
  env: NodeJS.ProcessEnv,
  qualityVersion: 1 | 2 = PRODUCTIVE_QUALITY_VERSION,
): PlanBuilderVariantDescriptor {
  const directives = resolvePlanBuilderRequestDirectives(env)
  return {
    provider: 'claude',
    model: resolvePlanBuilderModel(env),
    effort: directives.effort ?? 'omitted',
    thinkingMode: directives.thinking ?? 'omitted',
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: DEFAULT_MAX_TOKENS,
    promptVersion: PLAN_BUILDER_PROMPT_VERSION,
    schemaVersion: PLAN_BUILDER_SCHEMA_VERSION,
    qualityVersion,
    concurrency: normalizePlanBuilderConcurrency(resolveRawConcurrency(env)),
  }
}
```

Actualizar además el comentario de bloque de esa función: ya no describe `'omitted'` como hardcodeado.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/_shared/__tests__/planBuilderRunConfig.test.ts`
Expected: PASS, incluidos los tests preexistentes sin modificar.

- [ ] **Step 5: Close the task**

Run: `npm run lint && npm test`

```bash
git add netlify/functions/_shared/planBuilderRunConfig.ts netlify/functions/_shared/__tests__/planBuilderRunConfig.test.ts
git commit -m "feat(plan-builder): resolve effort and thinking directives from the environment"
```

---

## Task 2: `buildClaudeBody()` consume las directivas

**Files:**
- Modify: `netlify/functions/_shared/anthropicCaller.ts`
- Test: `netlify/functions/_shared/__tests__/anthropicCallerBody.test.ts` (crear)

**Interfaces:**
- Consumes: `PlanBuilderRequestDirectives`, `resolvePlanBuilderRequestDirectives` de Task 1.
- Produces: `buildClaudeBody(request: AIRequest, model: string, directives: PlanBuilderRequestDirectives): Record<string, unknown>` — **exportada** para el test de acuerdo.

- [ ] **Step 1: Write the failing test**

Crear `netlify/functions/_shared/__tests__/anthropicCallerBody.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import type { AIRequest } from '../../../../src/services/ai/types'
import { buildClaudeBody } from '../anthropicCaller'
import {
  resolveEffectivePlanBuilderConfig,
  resolvePlanBuilderRequestDirectives,
} from '../planBuilderRunConfig'

const request = {
  systemPrompt: 'system',
  userMessage: 'user',
  maxTokens: 5000,
  temperature: 0.25,
  requestClass: 'plan_builder_week',
} as unknown as AIRequest

describe('buildClaudeBody', () => {
  it('omits both keys when there are no directives', () => {
    const body = buildClaudeBody(request, 'claude-sonnet-4-6', { effort: null, thinking: null })
    expect(body.output_config).toBeUndefined()
    expect(body.thinking).toBeUndefined()
    // El resto del body no cambia.
    expect(body.model).toBe('claude-sonnet-4-6')
    expect(body.max_tokens).toBe(5000)
    expect(body.temperature).toBe(0.25)
  })

  it('sends effort inside output_config, not at the top level', () => {
    const body = buildClaudeBody(request, 'claude-sonnet-4-6', { effort: 'medium', thinking: null })
    expect(body.output_config).toEqual({ effort: 'medium' })
    expect(body.effort).toBeUndefined()
  })

  it('sends thinking as a typed object', () => {
    const body = buildClaudeBody(request, 'claude-sonnet-4-6', { effort: null, thinking: 'disabled' })
    expect(body.thinking).toEqual({ type: 'disabled' })
  })
})

/**
 * La invariante de la Fase 0: si el descriptor dice `effort=medium`, la request
 * mandó medium. Es la única defensa contra una ventana experimental que mide
 * una cosa y reporta otra — el modo de falla que ya mordió con `serviceTier`.
 */
describe('descriptor ↔ body agreement', () => {
  const environments = [
    {},
    { PLAN_BUILDER_EFFORT: 'high', PLAN_BUILDER_THINKING: 'disabled' },
    { PLAN_BUILDER_EFFORT: 'medium', PLAN_BUILDER_THINKING: 'disabled' },
    { PLAN_BUILDER_EFFORT: 'low', PLAN_BUILDER_THINKING: 'disabled' },
    { PLAN_BUILDER_EFFORT: 'max' },
    { PLAN_BUILDER_THINKING: 'disabled' },
  ]

  it.each(environments)('agrees for %o', (env) => {
    const descriptor = resolveEffectivePlanBuilderConfig(env as never)
    const directives = resolvePlanBuilderRequestDirectives(env as never)
    const body = buildClaudeBody(request, descriptor.model as string, directives)

    if (descriptor.effort === 'omitted') {
      expect(body.output_config).toBeUndefined()
    } else {
      expect(body.output_config).toEqual({ effort: descriptor.effort })
    }

    if (descriptor.thinkingMode === 'omitted') {
      expect(body.thinking).toBeUndefined()
    } else {
      expect(body.thinking).toEqual({ type: descriptor.thinkingMode })
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run netlify/functions/_shared/__tests__/anthropicCallerBody.test.ts`
Expected: FAIL — `buildClaudeBody` no está exportada.

- [ ] **Step 3: Write minimal implementation**

En `netlify/functions/_shared/anthropicCaller.ts`, agregar al import existente de `planBuilderRunConfig`:

```ts
import {
  resolvePlanBuilderModel,
  resolvePlanBuilderRequestDirectives,
  type PlanBuilderRequestDirectives,
} from './planBuilderRunConfig'
```

Reemplazar la firma y el cuerpo de `buildClaudeBody` (sigue siendo el mismo body más dos claves condicionales):

```ts
export function buildClaudeBody(
  request: AIRequest,
  model: string,
  directives: PlanBuilderRequestDirectives,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: request.maxTokens ?? 3500,
    temperature: request.temperature ?? 0.25,
    system: request.systemPrompt,
    messages: [
      ...(request.conversation ?? []).map((message) => ({ role: message.role, content: message.content })),
      { role: 'user', content: request.userMessage },
    ],
  }

  // `effort` va DENTRO de output_config, no en la raíz.
  if (directives.effort !== null) {
    body.output_config = { effort: directives.effort }
  }
  if (directives.thinking !== null) {
    body.thinking = { type: directives.thinking }
  }

  if (request.responseSchema) {
    body.tools = [{
      name: CLAUDE_STRUCTURED_TOOL_NAME,
      description: 'Devuelve el resultado estructurado solicitado siguiendo el schema exacto.',
      input_schema: normalizeJsonSchemaForStandardProvider(request.responseSchema),
    }]
    body.tool_choice = { type: 'tool', name: CLAUDE_STRUCTURED_TOOL_NAME }
  }

  return body
}
```

En `callAnthropicForWeek`, resolver las directivas junto al modelo y pasarlas:

```ts
  const model = options?.model ?? resolvePlanBuilderModel(process.env)
  // Se resuelve una sola vez por llamada: si la config es inválida, esto lanza
  // antes de abrir el fetch, sin gastar un request pagado.
  const directives = resolvePlanBuilderRequestDirectives(process.env)
```

y en el `fetch`:

```ts
      body: JSON.stringify(buildClaudeBody(request, model, directives)),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run netlify/functions/_shared/__tests__/anthropicCallerBody.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Close the task**

Run: `npm run lint && npm test`

```bash
git add netlify/functions/_shared/anthropicCaller.ts netlify/functions/_shared/__tests__/anthropicCallerBody.test.ts
git commit -m "feat(plan-builder): send effort and thinking from the resolved directives"
```

---

## Task 3: Emparejamiento de artefactos

**Files:**
- Create: `scripts/loadtest-plan-builder/compare.mjs`
- Test: `scripts/loadtest-plan-builder.test.js` (agregar bloque)

**Interfaces:**
- Consumes: nada del código nuevo.
- Produces:
  - `pairPlans(controlArtifact, variantArtifact): { pairs: Array<{ caseId, scenarioKey, control, variant }>, onlyControl: string[], onlyVariant: string[] }`
  - `pairWeeks(controlArtifact, variantArtifact): { pairs: Array<{ caseId, weekIndex, control, variant }>, unmatched: Array<{ caseId, weekIndex, side }> }`

- [ ] **Step 1: Write the failing test**

Agregar a `scripts/loadtest-plan-builder.test.js`, con el import correspondiente:

```js
import { pairPlans, pairWeeks } from './loadtest-plan-builder/compare.mjs'

function artifactWith(plans) {
  return { artifactSchemaVersion: 1, plans }
}

function planWith(caseId, scenarioKey, weeks) {
  return { caseId, scenarioKey, weeks }
}

describe('pairPlans', () => {
  it('pairs by caseId regardless of array order', () => {
    const control = artifactWith([planWith('c2', 's2', []), planWith('c1', 's1', [])])
    const variant = artifactWith([planWith('c1', 's1', []), planWith('c2', 's2', [])])

    const { pairs, onlyControl, onlyVariant } = pairPlans(control, variant)

    expect(pairs.map((pair) => pair.caseId)).toEqual(['c1', 'c2'])
    expect(onlyControl).toEqual([])
    expect(onlyVariant).toEqual([])
  })

  it('reports caseIds present on only one side instead of dropping them', () => {
    const control = artifactWith([planWith('c1', 's1', []), planWith('c2', 's2', [])])
    const variant = artifactWith([planWith('c1', 's1', []), planWith('c3', 's3', [])])

    const { pairs, onlyControl, onlyVariant } = pairPlans(control, variant)

    expect(pairs.map((pair) => pair.caseId)).toEqual(['c1'])
    expect(onlyControl).toEqual(['c2'])
    expect(onlyVariant).toEqual(['c3'])
  })
})

describe('pairWeeks', () => {
  it('pairs by (caseId, weekIndex), never by position', () => {
    const control = artifactWith([planWith('c1', 's1', [
      { weekIndex: 1, countRepairsV2: 3 },
      { weekIndex: 0, countRepairsV2: 1 },
    ])])
    const variant = artifactWith([planWith('c1', 's1', [
      { weekIndex: 0, countRepairsV2: 2 },
      { weekIndex: 1, countRepairsV2: 4 },
    ])])

    const { pairs } = pairWeeks(control, variant)

    expect(pairs).toHaveLength(2)
    const first = pairs.find((pair) => pair.weekIndex === 0)
    expect(first.control.countRepairsV2).toBe(1)
    expect(first.variant.countRepairsV2).toBe(2)
  })

  // Aparear una semana contra su vecina inventaría un delta que no existe.
  it('reports a week with no counterpart instead of pairing it with a neighbour', () => {
    const control = artifactWith([planWith('c1', 's1', [{ weekIndex: 0 }, { weekIndex: 1 }])])
    const variant = artifactWith([planWith('c1', 's1', [{ weekIndex: 0 }])])

    const { pairs, unmatched } = pairWeeks(control, variant)

    expect(pairs).toHaveLength(1)
    expect(unmatched).toEqual([{ caseId: 'c1', weekIndex: 1, side: 'control' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: FAIL — no se puede resolver `./loadtest-plan-builder/compare.mjs`.

- [ ] **Step 3: Write minimal implementation**

Crear `scripts/loadtest-plan-builder/compare.mjs`:

```js
/**
 * Comparación PAREADA entre dos artefactos del loadtest.
 *
 * El principio está heredado del comentario de cabecera de `report.mjs`: la
 * diferencia de medianas NO es la mediana de las diferencias. Todo acá empareja
 * primero —planes por `caseId`, semanas por `(caseId, weekIndex)`— y recién
 * después resume la distribución de diferencias.
 */

function indexPlans(artifact) {
  const byCaseId = new Map()
  for (const plan of artifact.plans ?? []) byCaseId.set(plan.caseId, plan)
  return byCaseId
}

export function pairPlans(controlArtifact, variantArtifact) {
  const control = indexPlans(controlArtifact)
  const variant = indexPlans(variantArtifact)

  const pairs = []
  const onlyControl = []
  for (const [caseId, controlPlan] of control) {
    const variantPlan = variant.get(caseId)
    if (!variantPlan) {
      onlyControl.push(caseId)
      continue
    }
    pairs.push({
      caseId,
      scenarioKey: controlPlan.scenarioKey,
      control: controlPlan,
      variant: variantPlan,
    })
  }

  const onlyVariant = []
  for (const caseId of variant.keys()) {
    if (!control.has(caseId)) onlyVariant.push(caseId)
  }

  pairs.sort((a, b) => a.caseId.localeCompare(b.caseId))
  return { pairs, onlyControl: onlyControl.sort(), onlyVariant: onlyVariant.sort() }
}

export function pairWeeks(controlArtifact, variantArtifact) {
  const { pairs: planPairs } = pairPlans(controlArtifact, variantArtifact)
  const pairs = []
  const unmatched = []

  for (const planPair of planPairs) {
    const controlWeeks = new Map(
      (planPair.control.weeks ?? []).map((week) => [week.weekIndex, week]),
    )
    const variantWeeks = new Map(
      (planPair.variant.weeks ?? []).map((week) => [week.weekIndex, week]),
    )

    for (const [weekIndex, controlWeek] of controlWeeks) {
      const variantWeek = variantWeeks.get(weekIndex)
      if (!variantWeek) {
        unmatched.push({ caseId: planPair.caseId, weekIndex, side: 'control' })
        continue
      }
      pairs.push({
        caseId: planPair.caseId,
        scenarioKey: planPair.scenarioKey,
        weekIndex,
        control: controlWeek,
        variant: variantWeek,
      })
    }

    for (const weekIndex of variantWeeks.keys()) {
      if (!controlWeeks.has(weekIndex)) {
        unmatched.push({ caseId: planPair.caseId, weekIndex, side: 'variant' })
      }
    }
  }

  return { pairs, unmatched }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: PASS, 4 tests nuevos y los existentes sin cambios.

- [ ] **Step 5: Close the task**

Run: `npm run lint && npm test`

```bash
git add scripts/loadtest-plan-builder/compare.mjs scripts/loadtest-plan-builder.test.js
git commit -m "feat(loadtest): pair two plan-builder artifacts by case and week"
```

---

## Task 4: Métricas pareadas

**Files:**
- Modify: `scripts/loadtest-plan-builder/compare.mjs`
- Test: `scripts/loadtest-plan-builder.test.js` (agregar bloque)

**Interfaces:**
- Consumes: `pairPlans`, `pairWeeks` de Task 3; `percentile`, `summarizeDistribution` de `stats.mjs`; `isCompletePlan` de `artifact.mjs`.
- Produces: `buildComparison(controlArtifact, variantArtifact): Comparison`, con la forma exacta documentada en el código.

- [ ] **Step 1: Write the failing test**

```js
import { buildComparison } from './loadtest-plan-builder/compare.mjs'

// OJO: `isCompletePlan` exige, vía `isReadyWeekRow`, que `sessionCount` sea un
// número finito > 0, y vía `inspectWeekIndexes` que los índices sean
// exactamente 0..weekCount-1. Sin `sessionCount` el plan no cuenta como
// completo y los tests fallarían por la razón equivocada.
function completePlan(caseId, scenarioKey, over = {}) {
  const weeks = (over.weeks ?? [0, 1]).map((weekIndex) => ({
    weekIndex,
    status: 'draft',
    scorable: true,
    sessionCount: 4,
    repairTaxonomyVersion: 2,
    countRepairsV2: 0,
    correctiveActionCount: 0,
    structuralActionCount: 0,
    ...(over.weekOverrides ?? {}),
  }))
  return {
    caseId,
    scenarioKey,
    outcome: 'succeeded',
    weekCount: weeks.length,
    weekCountSucceeded: weeks.length,
    weekCountFailed: 0,
    firstWeekReadyMs: over.firstWeekReadyMs ?? 1000,
    planCompleteMs: over.planCompleteMs ?? 2000,
    planScore: over.planScore ?? 90,
    estimatedCostUsd: over.estimatedCostUsd ?? 0.05,
    observedModels: over.observedModels ?? ['claude-sonnet-4-6'],
    fallbackUsed: false,
    errorClass: null,
    weeks,
  }
}

describe('buildComparison', () => {
  it('computes the median of paired ratios, not the ratio of medians', () => {
    // Ratios pareados: 0,5 y 1,0 → mediana nearest-rank (ceil(0,5*2)=1) = 0,5.
    // El ratio de medianas daría 1500/2000 = 0,75.
    const control = { artifactSchemaVersion: 1, plans: [
      completePlan('c1', 's1', { firstWeekReadyMs: 1000 }),
      completePlan('c2', 's2', { firstWeekReadyMs: 2000 }),
    ] }
    const variant = { artifactSchemaVersion: 1, plans: [
      completePlan('c1', 's1', { firstWeekReadyMs: 500 }),
      completePlan('c2', 's2', { firstWeekReadyMs: 2000 }),
    ] }

    const comparison = buildComparison(control, variant)

    expect(comparison.firstWeekReady.ratios).toEqual([0.5, 1])
    expect(comparison.firstWeekReady.p50).toBe(0.5)
    expect(comparison.firstWeekReady.improvedCases).toBe(1)
  })

  it('counts a scenario as improved by the AVERAGE of its two ratios', () => {
    // 0,4 y 1,4 → promedio 0,9 < 1 → mejora, aunque un caso empeore.
    const control = { artifactSchemaVersion: 1, plans: [
      completePlan('c1', 'dobles', { firstWeekReadyMs: 1000 }),
      completePlan('c2', 'dobles', { firstWeekReadyMs: 1000 }),
    ] }
    const variant = { artifactSchemaVersion: 1, plans: [
      completePlan('c1', 'dobles', { firstWeekReadyMs: 400 }),
      completePlan('c2', 'dobles', { firstWeekReadyMs: 1400 }),
    ] }

    const comparison = buildComparison(control, variant)

    expect(comparison.firstWeekReady.byScenario.dobles.meanRatio).toBeCloseTo(0.9, 10)
    expect(comparison.firstWeekReady.improvedScenarios).toBe(1)
  })

  it('summarises score as paired deltas, keeping the minimum', () => {
    const control = { artifactSchemaVersion: 1, plans: [
      completePlan('c1', 's1', { planScore: 90 }),
      completePlan('c2', 's2', { planScore: 90 }),
    ] }
    const variant = { artifactSchemaVersion: 1, plans: [
      completePlan('c1', 's1', { planScore: 89 }),
      completePlan('c2', 's2', { planScore: 84 }),
    ] }

    const comparison = buildComparison(control, variant)

    expect(comparison.score.deltas).toEqual([-6, -1])
    expect(comparison.score.min).toBe(-6)
    expect(comparison.score.p50).toBe(-6) // nearest-rank con n=2 toma el menor
  })

  it('summarises weekly repairs as paired deltas per (caseId, weekIndex)', () => {
    const control = { artifactSchemaVersion: 1, plans: [
      completePlan('c1', 's1', { weekOverrides: { countRepairsV2: 2 } }),
    ] }
    const variant = { artifactSchemaVersion: 1, plans: [
      completePlan('c1', 's1', { weekOverrides: { countRepairsV2: 3 } }),
    ] }

    const comparison = buildComparison(control, variant)

    expect(comparison.repairs.weekCountRepairsV2.deltas).toEqual([1, 1])
    expect(comparison.repairs.weekCountRepairsV2.p90).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: FAIL — `buildComparison` no está exportada.

- [ ] **Step 3: Write minimal implementation**

Agregar a `scripts/loadtest-plan-builder/compare.mjs` (arriba del archivo, los imports):

```js
import { isCompletePlan } from './artifact.mjs'
import { percentile } from './stats.mjs'
```

y al final:

```js
function ratio(variantValue, controlValue) {
  if (typeof variantValue !== 'number' || typeof controlValue !== 'number') return null
  if (controlValue === 0) return null
  return variantValue / controlValue
}

function summarizeDeltas(values) {
  const numeric = values.filter((value) => typeof value === 'number' && Number.isFinite(value))
  return {
    n: numeric.length,
    p50: percentile(numeric, 0.5),
    // Con n=12 el p90 nearest-rank ES el segundo peor. Se expone con los dos
    // nombres para que la regla pueda citarlo por lo que mide.
    p90: percentile(numeric, 0.9),
    min: numeric.length === 0 ? null : Math.min(...numeric),
    max: numeric.length === 0 ? null : Math.max(...numeric),
    values: numeric,
  }
}

function planRepairTotal(plan) {
  return (plan.weeks ?? [])
    .filter((week) => week.scorable)
    .reduce((sum, week) => sum + (week.countRepairsV2 ?? 0), 0)
}

function weekWarningInput(week) {
  return (week.correctiveActionCount ?? 0) + (week.structuralActionCount ?? 0)
}

/**
 * Resumen pareado completo. `values` viaja en cada bloque para que el reporte
 * pueda mostrar el detalle por caso sin recomputar nada.
 */
export function buildComparison(controlArtifact, variantArtifact) {
  const { pairs: planPairs, onlyControl, onlyVariant } = pairPlans(controlArtifact, variantArtifact)
  const { pairs: weekPairs, unmatched } = pairWeeks(controlArtifact, variantArtifact)

  const completePairs = planPairs.filter(
    (pair) => isCompletePlan(pair.control) && isCompletePlan(pair.variant),
  )

  const firstWeekRatios = []
  const byScenario = {}
  for (const pair of completePairs) {
    const value = ratio(pair.variant.firstWeekReadyMs, pair.control.firstWeekReadyMs)
    if (value === null) continue
    firstWeekRatios.push(value)
    const bucket = byScenario[pair.scenarioKey] ?? (byScenario[pair.scenarioKey] = { ratios: [] })
    bucket.ratios.push(value)
  }
  for (const bucket of Object.values(byScenario)) {
    // Promedio, NO p50: con n=2 el p50 nearest-rank toma el menor de los dos y
    // declararía mejora con un solo caso favorable.
    bucket.meanRatio = bucket.ratios.reduce((sum, value) => sum + value, 0) / bucket.ratios.length
    bucket.improved = bucket.meanRatio < 1
  }

  const planCompleteRatios = completePairs
    .map((pair) => ratio(pair.variant.planCompleteMs, pair.control.planCompleteMs))
    .filter((value) => value !== null)

  const scoreDeltas = completePairs
    .map((pair) => (
      typeof pair.variant.planScore === 'number' && typeof pair.control.planScore === 'number'
        ? pair.variant.planScore - pair.control.planScore
        : null
    ))
    .filter((value) => value !== null)

  const scorableWeekPairs = weekPairs.filter(
    (pair) => pair.control.scorable && pair.variant.scorable,
  )

  return {
    planPairs: planPairs.length,
    completePairs: completePairs.length,
    weekPairs: weekPairs.length,
    onlyControl,
    onlyVariant,
    unmatchedWeeks: unmatched,
    firstWeekReady: {
      ratios: firstWeekRatios.slice().sort((a, b) => a - b),
      p50: percentile(firstWeekRatios, 0.5),
      improvedCases: firstWeekRatios.filter((value) => value < 1).length,
      totalCases: firstWeekRatios.length,
      byScenario,
      improvedScenarios: Object.values(byScenario).filter((bucket) => bucket.improved).length,
      totalScenarios: Object.keys(byScenario).length,
    },
    planComplete: {
      ratios: planCompleteRatios.slice().sort((a, b) => a - b),
      p50: percentile(planCompleteRatios, 0.5),
    },
    score: summarizeDeltas(scoreDeltas),
    repairs: {
      weekCountRepairsV2: summarizeDeltas(scorableWeekPairs.map(
        (pair) => (pair.variant.countRepairsV2 ?? 0) - (pair.control.countRepairsV2 ?? 0),
      )),
      weekWarningInput: summarizeDeltas(scorableWeekPairs.map(
        (pair) => weekWarningInput(pair.variant) - weekWarningInput(pair.control),
      )),
      planCountRepairsV2: summarizeDeltas(completePairs.map(
        (pair) => planRepairTotal(pair.variant) - planRepairTotal(pair.control),
      )),
    },
    cost: {
      control: completePairs.reduce((sum, pair) => sum + (pair.control.estimatedCostUsd ?? 0), 0),
      variant: completePairs.reduce((sum, pair) => sum + (pair.variant.estimatedCostUsd ?? 0), 0),
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: PASS, 4 tests nuevos.

- [ ] **Step 5: Close the task**

Run: `npm run lint && npm test`

```bash
git add scripts/loadtest-plan-builder/compare.mjs scripts/loadtest-plan-builder.test.js
git commit -m "feat(loadtest): summarise paired deltas and ratios between two artifacts"
```

---

## Task 5: Gate de elegibilidad de Fase 2

**Files:**
- Create: `scripts/loadtest-plan-builder/phase2Gate.mjs`
- Test: `scripts/loadtest-plan-builder.test.js` (agregar bloque)

**Interfaces:**
- Consumes: `isCompletePlan` de `artifact.mjs`.
- Produces:
  - `PHASE2_EXPECTED = { planCount: 12, weekCount: 42, model: 'claude-sonnet-4-6' }`
  - `evaluatePhase2Variant(artifact, expected = PHASE2_EXPECTED): { eligible: boolean, reasons: string[] }`

**Contexto obligatorio:** `evaluateAcceptance()` en `artifact.mjs` es **más laxa a propósito** (`MIN_COMPLETE_PLANS = 10`, `scorableWeeks` en `[30, 50]`, y no evalúa `fallbackUsed`). Esta función **no la reemplaza ni la modifica**: responde otra pregunta.

**Helper compartido:** el test de abajo usa `completePlan()`, definido en el bloque de la Task 4 dentro del mismo archivo. Si estás ejecutando fuera de orden, copiá ese helper primero — incluye `sessionCount`, que `isCompletePlan` exige.

- [ ] **Step 1: Write the failing test**

```js
import { PHASE2_EXPECTED, evaluatePhase2Variant } from './loadtest-plan-builder/phase2Gate.mjs'

function eligibleArtifact() {
  const plans = []
  for (let index = 0; index < 12; index++) {
    plans.push(completePlan(`c${index}`, `s${index % 6}`, { weeks: [0, 1, 2] }))
  }
  // 12 planes × 3 semanas = 36; el gate compara contra lo esperado, así que
  // este helper se ajusta por test cuando hace falta.
  return { artifactSchemaVersion: 1, git: { sha: 'abc', dirty: false }, plans }
}

describe('evaluatePhase2Variant', () => {
  it('accepts a run that meets every strict condition', () => {
    const artifact = eligibleArtifact()
    const result = evaluatePhase2Variant(artifact, { ...PHASE2_EXPECTED, weekCount: 36 })
    expect(result).toEqual({ eligible: true, reasons: [] })
  })

  // Este es exactamente el caso que evaluateAcceptance SÍ acepta.
  it('rejects 10 complete plans even though evaluateAcceptance allows them', () => {
    const artifact = eligibleArtifact()
    artifact.plans = artifact.plans.slice(0, 10)
    const result = evaluatePhase2Variant(artifact, { ...PHASE2_EXPECTED, weekCount: 30 })
    expect(result.eligible).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/planes completos 10/)
  })

  it('rejects a run that used a fallback, which evaluateAcceptance never checks', () => {
    const artifact = eligibleArtifact()
    artifact.plans[3].fallbackUsed = true
    const result = evaluatePhase2Variant(artifact, { ...PHASE2_EXPECTED, weekCount: 36 })
    expect(result.eligible).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/fallback/)
  })

  it('rejects a plan that observed a model other than the declared one', () => {
    const artifact = eligibleArtifact()
    artifact.plans[5].observedModels = ['claude-sonnet-4-6', 'claude-sonnet-5']
    const result = evaluatePhase2Variant(artifact, { ...PHASE2_EXPECTED, weekCount: 36 })
    expect(result.eligible).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/modelo/)
  })

  it('rejects a dirty tree', () => {
    const artifact = eligibleArtifact()
    artifact.git = { sha: 'abc', dirty: true }
    const result = evaluatePhase2Variant(artifact, { ...PHASE2_EXPECTED, weekCount: 36 })
    expect(result.eligible).toBe(false)
    expect(result.reasons.join(' ')).toMatch(/árbol sucio/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: FAIL — no se puede resolver `./loadtest-plan-builder/phase2Gate.mjs`.

- [ ] **Step 3: Write minimal implementation**

Crear `scripts/loadtest-plan-builder/phase2Gate.mjs`:

```js
import { isCompletePlan } from './artifact.mjs'

/**
 * Elegibilidad como EVIDENCIA de Fase 2. Deliberadamente más estricta que
 * `evaluateAcceptance()`, que responde otra pregunta —"¿el artefacto es
 * estructuralmente utilizable?"— y admite 10/12 planes, 30-50 semanas y no
 * evalúa `fallbackUsed`. Una corrida puede estar ACEPTADA y no ser ELEGIBLE;
 * las razones tienen que poder distinguirse.
 */

export const PHASE2_EXPECTED = {
  planCount: 12,
  weekCount: 42,
  model: 'claude-sonnet-4-6',
}

export function evaluatePhase2Variant(artifact, expected = PHASE2_EXPECTED) {
  const reasons = []
  const plans = artifact.plans ?? []
  const completePlans = plans.filter(isCompletePlan)

  if (plans.length !== expected.planCount) {
    reasons.push(`planes intentados ${plans.length} ≠ ${expected.planCount}`)
  }
  if (completePlans.length !== expected.planCount) {
    reasons.push(`planes completos ${completePlans.length} ≠ ${expected.planCount}`)
  }

  const observedWeeks = completePlans.reduce((sum, plan) => sum + (plan.weekCount ?? 0), 0)
  if (observedWeeks !== expected.weekCount) {
    reasons.push(`semanas objetivo ${observedWeeks} ≠ ${expected.weekCount}`)
  }

  const harnessFailures = plans.filter((plan) => plan.errorClass === 'harness_failure')
  if (harnessFailures.length > 0) {
    reasons.push(`fallos del harness: ${harnessFailures.map((plan) => plan.caseId).join(', ')}`)
  }

  const fallbacks = plans.filter((plan) => plan.fallbackUsed)
  if (fallbacks.length > 0) {
    reasons.push(`planes con fallback: ${fallbacks.map((plan) => plan.caseId).join(', ')}`)
  }

  // Un swap silencioso de modelo invalidaría la comparación entera.
  const wrongModel = plans.filter((plan) => {
    const models = plan.observedModels ?? []
    return models.length !== 1 || models[0] !== expected.model
  })
  if (wrongModel.length > 0) {
    reasons.push(
      `planes con modelo distinto al declarado (${expected.model}): `
      + wrongModel.map((plan) => plan.caseId).join(', '),
    )
  }

  if (artifact.git?.dirty === true) {
    reasons.push('árbol sucio durante la corrida')
  }

  return { eligible: reasons.length === 0, reasons }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: PASS, 5 tests nuevos.

- [ ] **Step 5: Close the task**

Run: `npm run lint && npm test`

```bash
git add scripts/loadtest-plan-builder/phase2Gate.mjs scripts/loadtest-plan-builder.test.js
git commit -m "feat(loadtest): add the strict phase 2 eligibility gate"
```

---

## Task 6: Regla de decisión

**Files:**
- Modify: `scripts/loadtest-plan-builder/phase2Gate.mjs`
- Test: `scripts/loadtest-plan-builder.test.js` (agregar bloque)

**Interfaces:**
- Consumes: la forma de `buildComparison` de Task 4.
- Produces:
  - `PHASE2_THRESHOLDS` (constantes literales del spec)
  - `evaluatePhase2Decision(comparison): { accepted: boolean, checks: Array<{ id, passed, observed, threshold }> }`

- [ ] **Step 1: Write the failing test**

```js
import { PHASE2_THRESHOLDS, evaluatePhase2Decision } from './loadtest-plan-builder/phase2Gate.mjs'

function passingComparison(over = {}) {
  return {
    firstWeekReady: {
      p50: 0.7,
      improvedCases: 12,
      totalCases: 12,
      improvedScenarios: 6,
      totalScenarios: 6,
      ...(over.firstWeekReady ?? {}),
    },
    planComplete: { p50: 1.0, ...(over.planComplete ?? {}) },
    score: { p50: 0, min: 0, ...(over.score ?? {}) },
    repairs: {
      weekCountRepairsV2: { p50: 0, p90: 0 },
      weekWarningInput: { p50: 0, p90: 0 },
      planCountRepairsV2: { p50: 0, p90: 0 },
      ...(over.repairs ?? {}),
    },
  }
}

function checkById(result, id) {
  return result.checks.find((check) => check.id === id)
}

describe('evaluatePhase2Decision', () => {
  it('accepts a comparison that meets every threshold', () => {
    expect(evaluatePhase2Decision(passingComparison()).accepted).toBe(true)
  })

  it('accepts exactly 0.80 and rejects just above it', () => {
    expect(evaluatePhase2Decision(passingComparison({
      firstWeekReady: { p50: PHASE2_THRESHOLDS.firstWeekRatioP50Max },
    })).accepted).toBe(true)
    expect(evaluatePhase2Decision(passingComparison({
      firstWeekReady: { p50: 0.801 },
    })).accepted).toBe(false)
  })

  it('accepts 10 of 12 improved cases and rejects 9', () => {
    expect(evaluatePhase2Decision(passingComparison({
      firstWeekReady: { improvedCases: 10 },
    })).accepted).toBe(true)
    const rejected = evaluatePhase2Decision(passingComparison({
      firstWeekReady: { improvedCases: 9 },
    }))
    expect(rejected.accepted).toBe(false)
    expect(checkById(rejected, 'improvedCases').passed).toBe(false)
  })

  it('accepts 5 of 6 improved scenarios and rejects 4', () => {
    expect(evaluatePhase2Decision(passingComparison({
      firstWeekReady: { improvedScenarios: 5 },
    })).accepted).toBe(true)
    expect(evaluatePhase2Decision(passingComparison({
      firstWeekReady: { improvedScenarios: 4 },
    })).accepted).toBe(false)
  })

  it('accepts a score median of exactly -2 and a minimum of exactly -5', () => {
    expect(evaluatePhase2Decision(passingComparison({
      score: { p50: -2, min: -5 },
    })).accepted).toBe(true)
    expect(evaluatePhase2Decision(passingComparison({
      score: { p50: -2, min: -6 },
    })).accepted).toBe(false)
  })

  it('accepts a repair delta of exactly 0 and rejects any increase', () => {
    expect(evaluatePhase2Decision(passingComparison({
      repairs: {
        weekCountRepairsV2: { p50: 0, p90: 0 },
        weekWarningInput: { p50: 0, p90: 0 },
        planCountRepairsV2: { p50: 0, p90: 0 },
      },
    })).accepted).toBe(true)

    const rejected = evaluatePhase2Decision(passingComparison({
      repairs: {
        weekCountRepairsV2: { p50: 0, p90: 1 },
        weekWarningInput: { p50: 0, p90: 0 },
        planCountRepairsV2: { p50: 0, p90: 0 },
      },
    }))
    expect(rejected.accepted).toBe(false)
    expect(checkById(rejected, 'weekCountRepairsV2.p90').passed).toBe(false)
  })

  it('rejects a plan-complete median above 1.10', () => {
    expect(evaluatePhase2Decision(passingComparison({
      planComplete: { p50: 1.1 },
    })).accepted).toBe(true)
    expect(evaluatePhase2Decision(passingComparison({
      planComplete: { p50: 1.11 },
    })).accepted).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: FAIL — `evaluatePhase2Decision` no está exportada.

- [ ] **Step 3: Write minimal implementation**

Agregar a `scripts/loadtest-plan-builder/phase2Gate.mjs`:

```js
/**
 * Umbrales declarados ANTES de la primera corrida (spec §3.6). Un criterio
 * elegido después de ver los datos no es un criterio.
 */
export const PHASE2_THRESHOLDS = {
  firstWeekRatioP50Max: 0.80,
  minImprovedCases: 10,
  minImprovedScenarios: 5,
  planCompleteRatioP50Max: 1.10,
  scoreDeltaP50Min: -2,
  scoreDeltaMin: -5,
  repairDeltaMax: 0,
}

function check(id, passed, observed, threshold) {
  return { id, passed, observed, threshold }
}

export function evaluatePhase2Decision(comparison, thresholds = PHASE2_THRESHOLDS) {
  const firstWeek = comparison.firstWeekReady
  const repairs = comparison.repairs

  const checks = [
    check(
      'firstWeekRatioP50',
      firstWeek.p50 !== null && firstWeek.p50 <= thresholds.firstWeekRatioP50Max,
      firstWeek.p50,
      `≤ ${thresholds.firstWeekRatioP50Max}`,
    ),
    check(
      'improvedCases',
      firstWeek.improvedCases >= thresholds.minImprovedCases,
      firstWeek.improvedCases,
      `≥ ${thresholds.minImprovedCases}`,
    ),
    check(
      'improvedScenarios',
      firstWeek.improvedScenarios >= thresholds.minImprovedScenarios,
      firstWeek.improvedScenarios,
      `≥ ${thresholds.minImprovedScenarios}`,
    ),
    check(
      'planCompleteRatioP50',
      comparison.planComplete.p50 !== null
        && comparison.planComplete.p50 <= thresholds.planCompleteRatioP50Max,
      comparison.planComplete.p50,
      `≤ ${thresholds.planCompleteRatioP50Max}`,
    ),
    check(
      'scoreDeltaP50',
      comparison.score.p50 !== null && comparison.score.p50 >= thresholds.scoreDeltaP50Min,
      comparison.score.p50,
      `≥ ${thresholds.scoreDeltaP50Min}`,
    ),
    // Más estricto que un p10, y a propósito: impide una regresión severa
    // aislada que la mediana escondería.
    check(
      'scoreDeltaMin',
      comparison.score.min !== null && comparison.score.min >= thresholds.scoreDeltaMin,
      comparison.score.min,
      `≥ ${thresholds.scoreDeltaMin}`,
    ),
  ]

  for (const key of ['weekCountRepairsV2', 'weekWarningInput']) {
    checks.push(check(`${key}.p50`, repairs[key].p50 <= thresholds.repairDeltaMax, repairs[key].p50, '≤ 0'))
    checks.push(check(`${key}.p90`, repairs[key].p90 <= thresholds.repairDeltaMax, repairs[key].p90, '≤ 0'))
  }
  checks.push(check(
    'planCountRepairsV2.p50',
    repairs.planCountRepairsV2.p50 <= thresholds.repairDeltaMax,
    repairs.planCountRepairsV2.p50,
    '≤ 0',
  ))
  // Con nearest-rank y n=12, este p90 ES el segundo peor total por plan.
  checks.push(check(
    'planCountRepairsV2.secondWorst',
    repairs.planCountRepairsV2.p90 <= thresholds.repairDeltaMax,
    repairs.planCountRepairsV2.p90,
    '≤ 0',
  ))

  return { accepted: checks.every((entry) => entry.passed), checks }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: PASS, 7 tests nuevos.

- [ ] **Step 5: Close the task**

Run: `npm run lint && npm test`

```bash
git add scripts/loadtest-plan-builder/phase2Gate.mjs scripts/loadtest-plan-builder.test.js
git commit -m "feat(loadtest): freeze the phase 2 decision rule as a pure function"
```

---

## Task 7: CLI `--compare`

**Files:**
- Modify: `scripts/loadtest-plan-builder.mjs`
- Modify: `scripts/loadtest-plan-builder/compare.mjs` (agregar el render)
- Test: `scripts/loadtest-plan-builder.test.js` (agregar bloque)

**Interfaces:**
- Consumes: `buildComparison` (Task 4), `evaluatePhase2Variant` y `evaluatePhase2Decision` (Tasks 5-6).
- Produces:
  - `renderComparison(control, variant, comparison, eligibility, decision): string` en `compare.mjs`
  - `parseArgs` acepta `{ mode: 'compare', controlPath, variantPath }`

**Helper compartido:** el test usa `passingComparison()`, definido en el bloque de la Task 6 dentro del mismo archivo, y `evaluatePhase2Decision`, ya importado ahí.

- [ ] **Step 1: Write the failing test**

```js
describe('parseArgs --compare', () => {
  it('parses two artifact paths', () => {
    expect(parseArgs(['--compare', 'a.json', 'b.json'])).toEqual({
      mode: 'compare',
      controlPath: 'a.json',
      variantPath: 'b.json',
    })
  })

  it('rejects --compare with a single path', () => {
    expect(() => parseArgs(['--compare', 'a.json'])).toThrow()
  })

  it('still parses the existing modes', () => {
    expect(parseArgs([])).toEqual({ mode: 'run', artifactPath: null })
    expect(parseArgs(['--report', 'a.json'])).toEqual({ mode: 'report', artifactPath: 'a.json' })
  })
})

describe('renderComparison', () => {
  it('states the verdict and every failing check by name', () => {
    const comparison = passingComparison()
    comparison.firstWeekReady.p50 = 0.95
    comparison.planPairs = 12
    comparison.completePairs = 12
    comparison.weekPairs = 42
    comparison.onlyControl = []
    comparison.onlyVariant = []
    comparison.unmatchedWeeks = []
    comparison.cost = { control: 0.9, variant: 0.8 }

    const decision = evaluatePhase2Decision(comparison)
    const text = renderComparison(
      { variant: { variantId: 'ctrl' } },
      { variant: { variantId: 'var' } },
      comparison,
      { eligible: true, reasons: [] },
      decision,
    )

    expect(text).toMatch(/RECHAZADA/)
    expect(text).toMatch(/firstWeekRatioP50/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: FAIL — `parseArgs` lanza con `--compare` y `renderComparison` no existe.

- [ ] **Step 3: Write minimal implementation**

En `scripts/loadtest-plan-builder/compare.mjs`, agregar al final:

```js
function formatValue(value) {
  if (value === null || value === undefined) return 'n/a'
  return typeof value === 'number' ? value.toFixed(4).replace(/\.?0+$/, '') : String(value)
}

export function renderComparison(controlArtifact, variantArtifact, comparison, eligibility, decision) {
  const lines = []
  lines.push('== Comparación pareada de Fase 2 ==')
  lines.push(`control: ${controlArtifact.variant?.variantId ?? 'desconocido'}`)
  lines.push(`variante: ${variantArtifact.variant?.variantId ?? 'desconocido'}`)
  lines.push(`pares de plan: ${comparison.completePairs}/${comparison.planPairs} · pares de semana: ${comparison.weekPairs}`)

  if (comparison.onlyControl.length > 0 || comparison.onlyVariant.length > 0) {
    lines.push(`casos sin contraparte — solo control: ${comparison.onlyControl.join(', ') || '—'} · solo variante: ${comparison.onlyVariant.join(', ') || '—'}`)
  }
  if (comparison.unmatchedWeeks.length > 0) {
    lines.push(`semanas sin contraparte: ${comparison.unmatchedWeeks.length}`)
  }

  lines.push('')
  lines.push(`elegibilidad: ${eligibility.eligible ? 'OK' : 'NO ELEGIBLE'}`)
  for (const reason of eligibility.reasons) lines.push(`  - ${reason}`)

  lines.push('')
  lines.push('checks de la regla:')
  for (const entry of decision.checks) {
    lines.push(`  [${entry.passed ? 'ok' : 'FALLA'}] ${entry.id}: ${formatValue(entry.observed)} (umbral ${entry.threshold})`)
  }

  lines.push('')
  lines.push(`costo estimado — control ${formatValue(comparison.cost.control)} / variante ${formatValue(comparison.cost.variant)}`)
  lines.push('')
  lines.push(`VEREDICTO: ${eligibility.eligible && decision.accepted ? 'ACEPTADA' : 'RECHAZADA'}`)
  return lines.join('\n')
}
```

En `scripts/loadtest-plan-builder.mjs`, actualizar `USAGE` y `parseArgs`:

```js
const USAGE = 'Uso: loadtest-plan-builder.mjs | loadtest-plan-builder.mjs --report <ruta> | loadtest-plan-builder.mjs --compare <control> <variante>'
```

```js
export function parseArgs(argv) {
  if (Array.isArray(argv) && argv.length === 0) {
    return { mode: 'run', artifactPath: null }
  }
  if (
    Array.isArray(argv)
    && argv.length === 2
    && argv[0] === '--report'
    && typeof argv[1] === 'string'
    && argv[1].trim().length > 0
  ) {
    return { mode: 'report', artifactPath: argv[1] }
  }
  if (
    Array.isArray(argv)
    && argv.length === 3
    && argv[0] === '--compare'
    && typeof argv[1] === 'string'
    && argv[1].trim().length > 0
    && typeof argv[2] === 'string'
    && argv[2].trim().length > 0
  ) {
    return { mode: 'compare', controlPath: argv[1], variantPath: argv[2] }
  }
  throw new Error(USAGE)
}
```

Agregar los imports:

```js
import { buildComparison, renderComparison } from './loadtest-plan-builder/compare.mjs'
import { evaluatePhase2Decision, evaluatePhase2Variant } from './loadtest-plan-builder/phase2Gate.mjs'
```

y la rama en `main`, junto a la de `report` (antes de los guards, porque tampoco necesita credenciales):

```js
  if (args.mode === 'compare') {
    const [control, variant] = await Promise.all([
      readFile(args.controlPath, 'utf8').then((raw) => JSON.parse(raw)),
      readFile(args.variantPath, 'utf8').then((raw) => JSON.parse(raw)),
    ])
    const comparison = buildComparison(control, variant)
    const eligibility = evaluatePhase2Variant(variant)
    const decision = evaluatePhase2Decision(comparison)
    console.log(renderComparison(control, variant, comparison, eligibility, decision))
    // Siempre 0: una variante rechazada es un RESULTADO, no un fallo de la
    // herramienta. Confundirlos haría ilegible un exit code en CI.
    return 0
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: PASS, 5 tests nuevos.

- [ ] **Step 5: Close the task**

Run: `npm run lint && npm test`

```bash
git add scripts/loadtest-plan-builder.mjs scripts/loadtest-plan-builder/compare.mjs scripts/loadtest-plan-builder.test.js
git commit -m "feat(loadtest): add the --compare mode with eligibility and verdict"
```

---

## Task 8: Cierre del Hito 1

**Files:** ninguno nuevo.

- [ ] **Step 1: Verificación completa**

Run: `npm run lint && npm test && npm run build`
Expected: los tres verdes. `npm run build` corre `tsc -b`, así que acá aparecen los errores de tipo que Vitest no ve en los `.mjs` ni en el borde TS/JS.

- [ ] **Step 2: Confirmar que producción no cambió**

Run: `npx vitest run netlify/functions/_shared/__tests__/planBuilderRunConfig.test.ts -t "describes the request actually sent"`
Expected: PASS. Sin variables de entorno, el descriptor sigue diciendo `omitted` en `effort` y `thinkingMode`: el default del código no cambió.

- [ ] **Step 3: Confirmar que el árbol queda limpio**

Run: `git status --short`
Expected: sin salida una vez que el owner commiteó todo. **Este es el prerrequisito del Hito 2**: `mergeGitState` vuelve la suciedad monotónica y rechazaría las tres corridas.

```bash
git status --short && git log --oneline -7
```

---

# HITO 2 — Campaña

**No empieza hasta que `git status --short` no devuelva nada.** Las tres corridas
deben compartir el mismo SHA limpio.

---

## Task 9: Preflight de la campaña

**Files:** ninguno.

- [ ] **Step 1: Registrar el SHA de la campaña**

```bash
git rev-parse HEAD && git status --short
```
Expected: un SHA y **ninguna** línea de estado. Anotar el SHA: las tres corridas deben reportarlo.

- [ ] **Step 2: Confirmar los guards de la corrida pagada**

```bash
echo "LOADTEST_PLAN_BUILDER=${LOADTEST_PLAN_BUILDER:-(sin definir)}"
echo "CLAUDE_API_KEY=${CLAUDE_API_KEY:+(definida)}"
```
Expected: `1` y `(definida)`. Si falta alguna, `assertRunGuards` corta antes de cargar Vite.

- [ ] **Step 3: Verificar que la validación de env corta antes de gastar**

```bash
PLAN_BUILDER_EFFORT=mediun npm run loadtest:plan-builder
```
Expected: **falla inmediatamente** con el mensaje de `PLAN_BUILDER_EFFORT="mediun"` y **sin** haber emitido ningún request. Confirmá que no apareció ningún archivo nuevo:

```bash
ls -t loadtest-results/ 2>/dev/null | head -3
```

- [ ] **Step 4: Confirmar el destino gitignored**

```bash
git check-ignore -v loadtest-results/
```
Expected: `.gitignore:49`. Las tres salidas se quedan acá hasta el final.

---

## Task 10: Corrida C — control contemporáneo

**Files:** ninguno versionado. Salida en `loadtest-results/`.

- [ ] **Step 1: Ejecutar C**

```bash
PLAN_BUILDER_EFFORT=high PLAN_BUILDER_THINKING=disabled npm run loadtest:plan-builder
```
Expected: 12 casos, exit code 0. Tarda del orden de decenas de minutos.

- [ ] **Step 2: Renombrar la salida a un nombre estable**

```bash
mv "loadtest-results/$(ls -t loadtest-results | head -1)" loadtest-results/phase2-C.json
```

- [ ] **Step 3: Verificar la variante y el árbol**

```bash
node -e "const a=require('./loadtest-results/phase2-C.json');console.log(a.variant.effort,a.variant.thinkingMode,a.variant.qualityVersion,a.variant.variantId,JSON.stringify(a.git))"
```
Expected: `high disabled 2 <variantId> {"sha":"<SHA de la campaña>","dirty":false}`.
**Si `dirty` es `true`, la corrida no sirve**: limpiar el árbol y repetir.

- [ ] **Step 4: Verificar elegibilidad**

```bash
npm run loadtest:plan-builder -- --phase2-check loadtest-results/phase2-C.json high
```
Expected: `RESULTADO: ELEGIBLE`. Este gate comprueba además de 12/12 y 42/42:
q2, manifest congelado, SHA limpio, modelo observado, `high + disabled`, cero
fallbacks y cero fallos de harness. Si falla, C no es elegible y hay que
repetirla antes de gastar en A y B.

- [ ] **Step 5: NO versionar nada todavía**

```bash
git status --short
```
Expected: sin salida. Copiar C a `docs/superpowers/experiments/` ahora ensuciaría el árbol y **A y B quedarían rechazadas**.

---

## Task 11: Corridas A y B

**Files:** ninguno versionado. Salidas en `loadtest-results/`.

- [ ] **Step 1: Ejecutar A (`medium`)**

```bash
PLAN_BUILDER_EFFORT=medium PLAN_BUILDER_THINKING=disabled npm run loadtest:plan-builder
mv "loadtest-results/$(ls -t loadtest-results | head -1)" loadtest-results/phase2-A.json
```

- [ ] **Step 2: Ejecutar B (`low`)**

```bash
PLAN_BUILDER_EFFORT=low PLAN_BUILDER_THINKING=disabled npm run loadtest:plan-builder
mv "loadtest-results/$(ls -t loadtest-results | head -1)" loadtest-results/phase2-B.json
```

- [ ] **Step 3: Verificar que las tres comparten SHA y variante correcta**

```bash
node -e "for (const n of ['C','A','B']) { const a=require('./loadtest-results/phase2-'+n+'.json'); console.log(n, a.variant.effort, a.variant.thinkingMode, a.variant.variantId, a.git.sha, a.git.dirty) }"
```
Expected: mismo `sha`, `dirty` en `false` en las tres, y `effort` `high` / `medium` / `low` respectivamente. **Un SHA distinto invalida la comparación** y obliga a repetir la corrida desalineada.

- [ ] **Step 4: Comparar**

```bash
npm run loadtest:plan-builder -- --compare loadtest-results/phase2-C.json loadtest-results/phase2-A.json
npm run loadtest:plan-builder -- --compare loadtest-results/phase2-C.json loadtest-results/phase2-B.json
```
Expected: dos veredictos con todos los checks listados. Guardar ambas salidas.

- [ ] **Step 5: El árbol sigue limpio**

```bash
git status --short
```
Expected: sin salida.

---

## Task 12: Veredicto, versionado y decisión

**Files:**
- Create: `docs/superpowers/experiments/plan-builder-speed-phase-2/README.md`
- Create: `docs/superpowers/experiments/plan-builder-speed-phase-2/phase2-{C,A,B}.json`

- [ ] **Step 1: Copiar los tres artefactos y calcular sus SHA-256**

```bash
mkdir -p docs/superpowers/experiments/plan-builder-speed-phase-2
cp loadtest-results/phase2-C.json loadtest-results/phase2-A.json loadtest-results/phase2-B.json \
   docs/superpowers/experiments/plan-builder-speed-phase-2/
shasum -a 256 docs/superpowers/experiments/plan-builder-speed-phase-2/phase2-*.json
```

- [ ] **Step 2: Escribir el README del experimento**

Debe contener, sin excepción:
- El SHA de git de la campaña y las tres `variant_id`.
- Los tres SHA-256 del paso anterior.
- La salida completa de los dos `--compare`.
- El **veredicto por variante**, aplicado mecánicamente sobre los checks: aceptada o rechazada, y en caso de rechazo qué check falló.
- Si A y B pasan: la ganadora por menor primera-semana pareada, con el costo como segundo criterio.
- **Si ninguna pasa: dejarlo escrito como resultado.** *"`high` se queda"* es un resultado válido de la fase, no un fracaso.
- La aclaración de que, sin repetición de C, la consistencia entre casos y escenarios es evidencia descriptiva y **no** una afirmación de que el efecto supere el ruido.

- [ ] **Step 3: Actualizar el backlog y el estado del producto**

En `PROJECT_REVIEW_AND_ROADMAP.md`, marcar la entrada 2 del backlog con el resultado y la fecha. En `CLAUDE.md`, agregar una línea a "Bloques recientes relevantes" con: `effort`/`thinking` configurables, la campaña C/A/B, el veredicto, y que no hubo migraciones.

- [ ] **Step 4: Cierre**

```bash
git add docs/superpowers/experiments/plan-builder-speed-phase-2 PROJECT_REVIEW_AND_ROADMAP.md CLAUDE.md
git commit -m "docs: record the plan builder speed phase 2 campaign and its verdict"
```

- [ ] **Step 5: Rollout, solo si hay ganadora**

1. Poner `PLAN_BUILDER_EFFORT` y `PLAN_BUILDER_THINKING` en Netlify con los valores de la ganadora.
2. **Desplegar.** Netlify congela las variables de entorno por deploy: sin deploy no aplican, y **el rollback también requiere deploy** (quitar la variable y volver a desplegar).
3. Verificar una corrida real en `plan_generation_jobs`: `variant_id`, `effort` y `thinking_mode` deben coincidir con lo configurado.
4. Seguir la distribución de `plan_score` de los primeros planes productivos.

---

## Cobertura del spec

| Sección del spec | Tarea |
|---|---|
| §3.1 punto de cambio e invariante descriptor↔request | 1, 2 |
| §3.2 tres estados y allowlist por modelo (incl. `adaptive` fuera) | 1 |
| §3.3 `thinking` explícito | 2, 10 |
| §3.4 campaña C/A/B | 9, 10, 11 |
| §3.5 comparación pareada | 3, 4, 7 |
| §3.6 regla de decisión y gate de elegibilidad | 5, 6, 12 |
| §3.7 rollout | 12 |
| §4 testing | 1-7 |
| §5 prerrequisitos operativos | 8, 9, 10, 11 |
| §7 criterios de salida | 8, 12 |

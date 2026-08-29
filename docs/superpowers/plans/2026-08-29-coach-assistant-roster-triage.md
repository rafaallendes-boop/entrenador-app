# Asistente IA del Coach — Fase 1 (triaje de roster) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la pestaña "Asistente IA" del Coach Workspace responda "¿quién de mis alumnos necesita atención esta semana?" con señales deterministas, más un único punto de IA que redacta el cuerpo de un mensaje de seguimiento.

**Architecture:** Cálculo bajo demanda desde Dexie. `coachScopedReads` gana cuatro accesos por atleta (tres por rango, uno puntual) con deduplicación scoped/legacy; `coachRosterTriage` es un módulo puro que convierte esos datos en señales; el panel las presenta y ofrece un botón que llama al proveedor con un payload allowlisted y salida estructurada validada.

**Tech Stack:** React + TypeScript + Dexie + Zustand. Proveedor vía `CoachEngine` → `ProxyProvider` → `netlify/functions/coach.ts`. Supabase sólo para el CHECK de telemetría.

**Spec:** [`docs/superpowers/specs/2026-08-29-coach-assistant-roster-triage-design.md`](../specs/2026-08-29-coach-assistant-roster-triage-design.md)

> Enmienda posterior a revisión: el cargador final usa
> `getRosterTriageData` (tres escaneos acotados, búsquedas puntuales del último
> check-in y agrupación en memoria),
> resuelve el self una sola vez, conserva borradores por atleta entre recálculos
> y pestañas, expone fallos parciales y trata `unavailable` como reintentable.
> Los bloques de pseudocódigo por-atleta más abajo documentan el ciclo RED
> original y quedan supersedidos por esta enmienda y por la spec.

## Global Constraints

- **Nunca el literal `'default'`** fuera de `activeAthlete.ts`; usar `getActiveAthleteId()` / `getSelfAthleteId()`.
- **El triaje no lee, no escribe y no cambia el atleta activo.** Todo acceso cross-atleta pasa por `coachScopedReads`.
- **Filas legacy/unscoped pertenecen SOLO al self.** Predicado obligatorio: `row.athleteId === athleteId || (!isScopedAthleteId(row.athleteId) && isSelf)`.
- **Deduplicación scoped-gana** en `dayLogs` y `weekSummaries`; `sessions` no deduplica.
- Toda aritmética de días usa `differenceInCalendarDays` sobre días calendario locales.
- **`pain.days` = cantidad de fechas calendario distintas con `painLevel >= 4` dentro de la ventana, contadas después de deduplicar.** No son días consecutivos ni número de registros.
- **Umbrales v1 en un solo lugar:** `pain >= 4` / 7 días · `overdue` 14 días · `no-check-in >= 3` días · `adherencia < 60`.
- **Payload al proveedor:** sólo `signals`, `kind`, `days`, `count`, `oldestDaysAgo`, `adherencePct`. Nunca nombres, ids, fechas absolutas, `painNotes` ni contenido de plan. Construcción campo por campo, sin spreads de objetos de dominio.
- **Parámetros de la clase:** `maxTokens` 260 · `temperature` 0.5 · `timeoutMs` 15000 · `allowFallback` **false** · retry técnico **deshabilitado** · sin streaming · `SYSTEM_PROMPT_MAX_CHARS` 8000 · thinking budget Gemini **0** (cliente y proxy) · reasoning effort OpenAI `none`/`minimal` · tier **`advanced`** · bucket propio `coach_assistant` con `{ advanced: 20 }`.
- **Migración `023` de aplicación manual**, antes del primer deploy que emita la clase.
- Los commits los hace el owner: los pasos de commit quedan escritos pero **no se ejecutan** salvo que el owner lo pida.
- Verificación de cierre de cada tarea: `npm test`, `npm run lint`, `npx tsc -b`, `npm run build`, `git diff --check`.

---

### Task 1: Migración `023` y guard del CHECK

**Files:**
- Create: `supabase/023_coach_assistant_request_class.sql`
- Modify: `netlify/functions/_shared/__tests__/coachRequestSchema.test.ts:68`

**Interfaces:**
- Consumes: nada.
- Produces: el CHECK de `coach_requests.request_class` con 8 literales, incluido `'coach_assistant_message'`.

- [ ] **Step 1: Escribir el test que falla**

En `coachRequestSchema.test.ts`, reemplazar el test `restringe request_class a las 7 clases y outcome a las 2` por:

```ts
const EXPECTED_REQUEST_CLASSES = [
  'chat_general', 'chat_action', 'weekly_summary', 'week_creator',
  'plan_builder_week', 'plan_builder_pair', 'import_extract',
  'coach_assistant_message',
] as const

function readAssistantMigration(): string {
  return readFileSync(
    resolve(__dirname, '../../../../supabase/023_coach_assistant_request_class.sql'),
    'utf8',
  )
}

it('amplía request_class a las 8 clases vigentes', () => {
  const sql = readAssistantMigration()
  for (const requestClass of EXPECTED_REQUEST_CLASSES) {
    expect(sql).toContain(`'${requestClass}'`)
  }
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run netlify/functions/_shared/__tests__/coachRequestSchema.test.ts`
Expected: FAIL — `ENOENT` porque `supabase/023_coach_assistant_request_class.sql` no existe.

- [ ] **Step 3: Escribir la migración**

```sql
-- 023_coach_assistant_request_class.sql
-- Amplía el CHECK de coach_requests.request_class para admitir la clase del
-- Asistente IA del Coach. Sin esto el insert de telemetría viola el constraint
-- y, como la escritura es best-effort sin await, la request pierde su registro
-- en silencio.
-- APLICACIÓN MANUAL, antes del primer deploy que emita la clase nueva.

alter table public.coach_requests
  drop constraint if exists coach_requests_request_class_check;

alter table public.coach_requests
  add constraint coach_requests_request_class_check
  check (request_class in (
    'chat_general', 'chat_action', 'weekly_summary', 'week_creator',
    'plan_builder_week', 'plan_builder_pair', 'import_extract',
    'coach_assistant_message'
  ));
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run netlify/functions/_shared/__tests__/coachRequestSchema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (no ejecutar sin pedido del owner)**

```bash
git add supabase/023_coach_assistant_request_class.sql netlify/functions/_shared/__tests__/coachRequestSchema.test.ts
git commit -m "feat(coach-assistant): ampliar request_class a la clase del asistente"
```

---

### Task 2: Registrar la clase en el cliente y guard de exhaustividad

**Files:**
- Modify: `src/types/index.ts:7` (`AIRequestClass`), `:33` (`AITechnicalSurface`)
- Modify: `src/services/ai/requestPolicy.ts` (`AI_REQUEST_POLICIES`)
- Modify: `src/services/entitlements/entitlementPolicy.ts:28` (`REQUEST_CLASS_MIN_TIER`)
- Modify: `src/services/entitlements/quotaBuckets.ts:17` (`QUOTA_BUCKETS`)
- Modify: `src/services/ai/providers/GeminiProvider.ts:13` (`getThinkingBudget`)
- Modify: `src/services/ai/openAIReasoning.ts:42` (`getDefaultOpenAIReasoningEffort`)
- Create: `src/services/ai/aiRequestClasses.ts`
- Create: `src/services/ai/__tests__/requestClassExhaustiveness.test.ts`

**Interfaces:**
- Consumes: Task 1 (el CHECK ya admite la clase).
- Produces: `AIRequestClass` incluye `'coach_assistant_message'`; `AITechnicalSurface` incluye `'coach_assistant'`; `ALL_AI_REQUEST_CLASSES: Record<AIRequestClass, true>` exportado desde `src/services/ai/aiRequestClasses.ts`.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/ai/__tests__/requestClassExhaustiveness.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ALL_AI_REQUEST_CLASSES } from '../aiRequestClasses'
import { AI_REQUEST_POLICIES } from '../requestPolicy'
import { REQUEST_CLASS_MIN_TIER } from '../../entitlements/entitlementPolicy'
import { bucketForClass } from '../../entitlements/quotaBuckets'

const CLASSES = Object.keys(ALL_AI_REQUEST_CLASSES) as Array<keyof typeof ALL_AI_REQUEST_CLASSES>

describe('exhaustividad de AIRequestClass', () => {
  it('incluye la clase del asistente del coach', () => {
    expect(CLASSES).toContain('coach_assistant_message')
  })

  it('toda clase tiene policy, tier y bucket', () => {
    for (const requestClass of CLASSES) {
      expect(AI_REQUEST_POLICIES[requestClass], requestClass).toBeDefined()
      expect(REQUEST_CLASS_MIN_TIER[requestClass], requestClass).toBeDefined()
      expect(bucketForClass(requestClass), requestClass).not.toBeNull()
    }
  })

  it('el asistente del coach es advanced y no comparte contador con el chat', () => {
    expect(REQUEST_CLASS_MIN_TIER.coach_assistant_message).toBe('advanced')
    expect(bucketForClass('coach_assistant_message')?.id).toBe('coach_assistant')
  })

  it('el asistente no permite fallback de proveedor', () => {
    expect(AI_REQUEST_POLICIES.coach_assistant_message.allowFallback).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/ai/__tests__/requestClassExhaustiveness.test.ts`
Expected: FAIL — no existe `../aiRequestClasses`.

- [ ] **Step 3: Implementar**

Crear `src/services/ai/aiRequestClasses.ts`:

```ts
import type { AIRequestClass } from '../../types'

/**
 * Enumeración exhaustiva y ejecutable de las clases de request. Una unión de
 * TypeScript no existe en runtime y no se puede recorrer: `satisfies` obliga a
 * que esta lista esté completa al compilar, y `Object.keys` la hace iterable
 * al testear.
 */
export const ALL_AI_REQUEST_CLASSES = {
  chat_general: true,
  chat_action: true,
  weekly_summary: true,
  week_creator: true,
  plan_builder_week: true,
  plan_builder_pair: true,
  import_extract: true,
  coach_assistant_message: true,
} satisfies Record<AIRequestClass, true>
```

En `src/types/index.ts`, agregar `| 'coach_assistant_message'` a `AIRequestClass` y `| 'coach_assistant'` a `AITechnicalSurface`.

En `requestPolicy.ts`, agregar a `AI_REQUEST_POLICIES`:

```ts
  coach_assistant_message: {
    maxTokens: 260,
    temperature: 0.5,
    timeoutMs: 15_000,
    allowFallback: false,
  },
```

En `entitlementPolicy.ts`, agregar a `REQUEST_CLASS_MIN_TIER`: `coach_assistant_message: 'advanced',`

En `quotaBuckets.ts`, agregar a `QUOTA_BUCKETS`:

```ts
  { id: 'coach_assistant', classes: ['coach_assistant_message'], limits: { advanced: 20 } },
```

En `GeminiProvider.ts:13`, agregar `case 'coach_assistant_message':` al grupo que devuelve `0`.

En `openAIReasoning.ts:47`, agregar `case 'coach_assistant_message':` al grupo que devuelve `supported.includes('none') ? 'none' : 'minimal'`.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run src/services/ai src/services/entitlements && npx tsc -b`
Expected: PASS y typecheck limpio. Si `AI_REQUEST_POLICIES` o los `switch` no compilan, falta un caso.

- [ ] **Step 5: Commit (no ejecutar sin pedido del owner)**

```bash
git add src/types/index.ts src/services/ai src/services/entitlements
git commit -m "feat(coach-assistant): registrar la clase de request en el cliente"
```

---

### Task 3: Registrar la clase en el servidor

**Files:**
- Modify: `netlify/functions/coach.ts:50` (`RequestClass`), `:210` (`SYSTEM_PROMPT_MAX_CHARS`), `:607` (`resolvePrimaryProvider`), `:630` (`shouldUseTechnicalRetry`), `:880` (`getGeminiThinkingBudget`)
- Modify: `netlify/functions/_shared/coachRequestTelemetry.ts:9` (`CoachRequestClass`)
- Modify: `dev/coachProxyMiddleware.ts:5` (`RequestClass`)
- Create: `netlify/functions/_shared/__tests__/coachAssistantClassWiring.test.ts`

**Interfaces:**
- Consumes: Task 2 (`ALL_AI_REQUEST_CLASSES`).
- Produces: `CLASS_DEFAULT_PROVIDER: Record<RequestClass, ProviderName>` exportado desde `coach.ts`.

- [ ] **Step 1: Escribir el test que falla**

Crear `netlify/functions/_shared/__tests__/coachAssistantClassWiring.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALL_AI_REQUEST_CLASSES } from '../../../src/services/ai/aiRequestClasses'

const CLASSES = Object.keys(ALL_AI_REQUEST_CLASSES)
const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8')

describe('la clase del asistente está en las tres representaciones duplicadas', () => {
  it.each([
    ['proxy', '../../coach.ts'],
    ['telemetría', '../coachRequestTelemetry.ts'],
    ['middleware de desarrollo', '../../../dev/coachProxyMiddleware.ts'],
  ])('%s enumera las 8 clases', (_name, rel) => {
    const source = read(rel)
    for (const requestClass of CLASSES) {
      expect(source, requestClass).toContain(`'${requestClass}'`)
    }
  })

  it('el proxy declara prompt máximo, thinking budget y proveedor por clase', () => {
    const source = read('../../coach.ts')
    expect(source).toMatch(/coach_assistant_message:\s*8000/)
    expect(source).toMatch(/CLASS_DEFAULT_PROVIDER/)
  })

  // `shouldUseTechnicalRetry` es una cadena de `||`, no un switch exhaustivo:
  // la clase nueva da `false` por defecto y nada rompe si alguien lo cambia.
  it('el asistente no usa retry técnico', async () => {
    const { shouldUseTechnicalRetryForTest } = await import('../../coach')
    expect(shouldUseTechnicalRetryForTest('coach_assistant_message')).toBe(false)
    expect(shouldUseTechnicalRetryForTest('chat_general')).toBe(true)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run netlify/functions/_shared/__tests__/coachAssistantClassWiring.test.ts`
Expected: FAIL — las tres fuentes no contienen `'coach_assistant_message'`.

- [ ] **Step 3: Implementar**

En las tres uniones (`coach.ts:50`, `coachRequestTelemetry.ts:9`, `dev/coachProxyMiddleware.ts:5`), agregar `| 'coach_assistant_message'`.

En `coach.ts:210`, agregar a `SYSTEM_PROMPT_MAX_CHARS`: `coach_assistant_message: 8000,`

En `coach.ts:880`, agregar `case 'coach_assistant_message':` al grupo que devuelve `0`.

Exportar el predicado de retry para poder aserverlo, sin cambiar su lógica:

```ts
/** Exportado sólo para test: fija que la clase nueva no usa retry técnico. */
export const shouldUseTechnicalRetryForTest = shouldUseTechnicalRetry
```

En `coach.ts`, reemplazar el literal `'gemini'` de `resolvePrimaryProvider` por un default declarado por clase:

```ts
/** Default de proveedor por clase. La cascada de env sigue pudiendo
 *  sobrescribirlo; lo que deja de existir es el literal implícito. */
export const CLASS_DEFAULT_PROVIDER: Record<RequestClass, ProviderName> = {
  chat_general: 'gemini',
  chat_action: 'gemini',
  weekly_summary: 'gemini',
  week_creator: 'openai',
  plan_builder_week: 'claude',
  plan_builder_pair: 'claude',
  import_extract: 'gemini',
  coach_assistant_message: 'gemini',
}

export function resolvePrimaryProvider(requestClass: RequestClass): ProviderName {
  const classKey = providerEnvKey('AI_PROVIDER', requestClass)
  const fallback = CLASS_DEFAULT_PROVIDER[requestClass]
  return parseProviderName(
    process.env[classKey] ?? process.env['AI_PROVIDER'] ?? fallback,
    classKey,
  ) ?? fallback
}
```

`shouldUseTechnicalRetry` **no se toca**: la clase nueva ya devuelve `false`, que es el valor deseado — pero **por defecto, no por decisión**, porque es una cadena de `||` y no un `switch` exhaustivo. Por eso el Step 1 de esta tarea lo fija con una aserción propia.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run netlify/ && npx tsc -b`
Expected: PASS. `SYSTEM_PROMPT_MAX_CHARS` y `getGeminiThinkingBudget` rompen la compilación si falta el caso.

- [ ] **Step 5: Commit (no ejecutar sin pedido del owner)**

```bash
git add netlify/ dev/coachProxyMiddleware.ts
git commit -m "feat(coach-assistant): registrar la clase en proxy, telemetría y dev middleware"
```

---

### Task 4: Salida estructurada en `CoachEngine`

**Files:**
- Modify: `src/services/ai/CoachEngine.ts:71-110`
- Create: `src/services/ai/__tests__/coachEngineStructuredOutput.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces: `CoachEngine.extractRaw` acepta y reenvía `responseMimeType?: 'application/json'` y `responseSchema?: Record<string, unknown>`.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, expect, it, vi } from 'vitest'

const call = vi.fn(async () => ({ text: '{"body":"ok"}' }))
vi.mock('../providerResolver', () => ({
  getProviderForRequestClass: () => ({ call, name: 'gemini' }),
}))

import { CoachEngine } from '../CoachEngine'

describe('extractRaw con salida estructurada', () => {
  it('reenvía responseMimeType y responseSchema al proveedor', async () => {
    const schema = { type: 'object', properties: { body: { type: 'string' } } }
    await CoachEngine.extractRaw('sys', 'user', {
      requestClass: 'coach_assistant_message',
      surface: 'coach_assistant',
      responseMimeType: 'application/json',
      responseSchema: schema,
    })

    expect(call).toHaveBeenCalledWith(expect.objectContaining({
      requestClass: 'coach_assistant_message',
      responseMimeType: 'application/json',
      responseSchema: schema,
    }))
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/ai/__tests__/coachEngineStructuredOutput.test.ts`
Expected: FAIL — el objeto pasado a `call` no contiene `responseMimeType` ni `responseSchema`.

- [ ] **Step 3: Implementar**

En `CoachEngine.ts:74-81`, agregar al tipo de `options`:

```ts
      responseMimeType?: 'application/json'
      responseSchema?: Record<string, unknown>
```

y en la llamada a `provider.call({ ... })`, propagar:

```ts
        responseMimeType: options?.responseMimeType,
        responseSchema: options?.responseSchema,
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/ai/__tests__/coachEngineStructuredOutput.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (no ejecutar sin pedido del owner)**

```bash
git add src/services/ai/CoachEngine.ts src/services/ai/__tests__/coachEngineStructuredOutput.test.ts
git commit -m "feat(coach-assistant): permitir salida estructurada en extractRaw"
```

---

### Task 5: Lecturas por rango con deduplicación scoped/legacy

**Files:**
- Modify: `src/services/athlete/coachScopedReads.ts`
- Create: `src/services/athlete/__tests__/coachScopedRangeReads.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `getDayLogsForAthleteRange(ownerAccountId: string, athleteId: string, fromISO: string, toISO: string): Promise<DayLog[]>`
  - `getSessionsForAthleteRange(ownerAccountId: string, athleteId: string, fromISO: string, toISO: string): Promise<Session[]>`
  - `getWeekSummariesForAthleteRange(ownerAccountId: string, athleteId: string, fromISO: string, toISO: string): Promise<WeekSummary[]>`
  - `getLatestDayLogForAthlete(ownerAccountId: string, athleteId: string): Promise<DayLog | undefined>`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/athlete/__tests__/coachScopedRangeReads.test.ts` con, como mínimo, estos casos (usar el mismo arranque de `fake-indexeddb` y los helpers que ya usan los tests existentes de `coachScopedReads`):

```ts
it('no devuelve filas de otro atleta', async () => {
  await db.dayLogs.bulkPut([
    { id: 'a', athleteId: 'ath_self', date: '2026-08-20', updatedAt: 1 },
    { id: 'b', athleteId: 'ath_otro', date: '2026-08-20', updatedAt: 1 },
  ])
  const rows = await getDayLogsForAthleteRange(OWNER, 'ath_self', '2026-08-14', '2026-08-20')
  expect(rows.map((r) => r.id)).toEqual(['a'])
})

it('un gestionado nunca ve filas legacy', async () => {
  await db.dayLogs.put({ id: 'legacy', date: '2026-08-20', updatedAt: 1 })
  const rows = await getDayLogsForAthleteRange(OWNER, MANAGED_ID, '2026-08-14', '2026-08-20')
  expect(rows).toEqual([])
})

it('ante colisión scoped/legacy del self en la misma fecha, gana la scoped', async () => {
  await db.dayLogs.bulkPut([
    { id: 'scoped', athleteId: SELF_ID, date: '2026-08-20', energyLevel: 8, updatedAt: 2 },
    { id: 'legacy', date: '2026-08-20', energyLevel: 3, updatedAt: 1 },
  ])
  const rows = await getDayLogsForAthleteRange(OWNER, SELF_ID, '2026-08-14', '2026-08-20')
  expect(rows).toHaveLength(1)
  expect(rows[0]!.id).toBe('scoped')
})

it('weekSummaries deduplica por weekStartDate con la misma precedencia', async () => {
  await db.weekSummaries.bulkPut([
    { id: 'scoped', athleteId: SELF_ID, weekStartDate: '2026-08-17', plannedSessions: 4, completedSessions: 4, totalSessions: 4, totalMinutes: 0, plannedMinutes: 0, completedMinutes: 0, squashSessions: 0, runningSessions: 0, strengthSessions: 0 },
    { id: 'legacy', weekStartDate: '2026-08-17', plannedSessions: 1, completedSessions: 0, totalSessions: 1, totalMinutes: 0, plannedMinutes: 0, completedMinutes: 0, squashSessions: 0, runningSessions: 0, strengthSessions: 0 },
  ])
  const rows = await getWeekSummariesForAthleteRange(OWNER, SELF_ID, '2026-08-17', '2026-08-17')
  expect(rows).toHaveLength(1)
  expect(rows[0]!.id).toBe('scoped')
})

it('sessions NO deduplica: dos sesiones el mismo día son dos filas', async () => {
  await db.sessions.bulkPut([
    { ...baseSession, id: 's1', athleteId: SELF_ID, date: '2026-08-20', timeBlock: 'AM' },
    { ...baseSession, id: 's2', athleteId: SELF_ID, date: '2026-08-20', timeBlock: 'PM' },
  ])
  const rows = await getSessionsForAthleteRange(OWNER, SELF_ID, '2026-08-14', '2026-08-20')
  expect(rows).toHaveLength(2)
})

it('getLatestDayLogForAthlete devuelve el último registro histórico, fuera de toda ventana', async () => {
  await db.dayLogs.bulkPut([
    { id: 'viejo', athleteId: SELF_ID, date: '2026-07-01', updatedAt: 1 },
    { id: 'menos-viejo', athleteId: SELF_ID, date: '2026-07-20', updatedAt: 1 },
  ])
  const row = await getLatestDayLogForAthlete(OWNER, SELF_ID)
  expect(row?.id).toBe('menos-viejo')
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/athlete/__tests__/coachScopedRangeReads.test.ts`
Expected: FAIL — las cuatro funciones no existen.

- [ ] **Step 3: Implementar**

En `coachScopedReads.ts`, agregar un helper de deduplicación y las cuatro funciones:

```ts
/**
 * Para el self pueden coexistir una fila scoped y una legacy con la misma
 * clave natural: `athleteScopeMigration` lo preserva a propósito. Devolver las
 * dos haría que el triaje contara el mismo día dos veces.
 * Scoped gana; legacy sólo rellena la fecha que la scoped no cubre.
 */
function dedupeByNaturalKey<T extends { athleteId?: string }>(
  rows: T[],
  keyOf: (row: T) => string,
): T[] {
  const byKey = new Map<string, T>()
  for (const row of rows) {
    const key = keyOf(row)
    const current = byKey.get(key)
    if (!current || (!isScopedAthleteId(current.athleteId) && isScopedAthleteId(row.athleteId))) {
      byKey.set(key, row)
    }
  }
  return [...byKey.values()]
}

function inScope(row: { athleteId?: string }, athleteId: string, isSelf: boolean): boolean {
  return row.athleteId === athleteId || (!isScopedAthleteId(row.athleteId) && isSelf)
}

export async function getDayLogsForAthleteRange(
  ownerAccountId: string, athleteId: string, fromISO: string, toISO: string,
): Promise<DayLog[]> {
  await assertActiveRosterAthlete(ownerAccountId, athleteId)
  const isSelf = athleteId === await resolveSelfAthleteIdForOwner(ownerAccountId)
  const rows = await db.dayLogs.where('date').between(fromISO, toISO, true, true).toArray()
  return dedupeByNaturalKey(rows.filter((row) => inScope(row, athleteId, isSelf)), (row) => row.date)
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function getSessionsForAthleteRange(
  ownerAccountId: string, athleteId: string, fromISO: string, toISO: string,
): Promise<Session[]> {
  await assertActiveRosterAthlete(ownerAccountId, athleteId)
  const isSelf = athleteId === await resolveSelfAthleteIdForOwner(ownerAccountId)
  const rows = await db.sessions.where('date').between(fromISO, toISO, true, true).toArray()
  // `sessions` no tiene clave natural por fecha: dos sesiones el mismo día son
  // legítimas. NO deduplicar acá.
  return rows.filter((row) => inScope(row, athleteId, isSelf))
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
}

export async function getWeekSummariesForAthleteRange(
  ownerAccountId: string, athleteId: string, fromISO: string, toISO: string,
): Promise<WeekSummary[]> {
  await assertActiveRosterAthlete(ownerAccountId, athleteId)
  const isSelf = athleteId === await resolveSelfAthleteIdForOwner(ownerAccountId)
  const rows = await db.weekSummaries.where('weekStartDate').between(fromISO, toISO, true, true).toArray()
  return dedupeByNaturalKey(
    rows.filter((row) => inScope(row, athleteId, isSelf)),
    (row) => row.weekStartDate,
  ).sort((a, b) => a.weekStartDate.localeCompare(b.weekStartDate))
}

export async function getLatestDayLogForAthlete(
  ownerAccountId: string, athleteId: string,
): Promise<DayLog | undefined> {
  await assertActiveRosterAthlete(ownerAccountId, athleteId)
  const isSelf = athleteId === await resolveSelfAthleteIdForOwner(ownerAccountId)
  const rows = await db.dayLogs.orderBy('date').reverse().toArray()
  const inScopeRows = rows.filter((row) => inScope(row, athleteId, isSelf))
  const latestDate = inScopeRows[0]?.date
  if (!latestDate) return undefined
  return dedupeByNaturalKey(
    inScopeRows.filter((row) => row.date === latestDate),
    (row) => row.date,
  )[0]
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/athlete/`
Expected: PASS, incluidos los tests preexistentes de `coachScopedReads`.

- [ ] **Step 5: Commit (no ejecutar sin pedido del owner)**

```bash
git add src/services/athlete/coachScopedReads.ts src/services/athlete/__tests__/coachScopedRangeReads.test.ts
git commit -m "feat(coach-assistant): lecturas por rango con deduplicación scoped/legacy"
```

---

### Task 6: Cálculo puro del triaje

**Files:**
- Create: `src/services/athlete/coachRosterTriage.ts`
- Create: `src/services/athlete/__tests__/coachRosterTriage.test.ts`

**Interfaces:**
- Consumes: los tipos `DayLog`, `Session`, `WeekSummary`, `Athlete`.
- Produces:

```ts
export type TriageSignal =
  | { kind: 'pain'; days: number }
  | { kind: 'overdue-sessions'; count: number; oldestDaysAgo: number }
  | { kind: 'no-check-in'; days: number }
  | { kind: 'low-adherence'; adherencePct: number }

export interface AthleteTriage {
  athleteId: string
  signals: TriageSignal[]
  insufficientData: boolean
}

export function computeAthleteTriage(input: {
  athlete: Pick<Athlete, 'id' | 'createdAt'>
  today: string
  dayLogsInPainWindow: DayLog[]
  latestDayLog?: DayLog
  sessionsInWindow: Session[]
  previousWeekSummary?: WeekSummary
}): AthleteTriage
```

- [ ] **Step 1: Escribir el test que falla**

Casos obligatorios en `coachRosterTriage.test.ts`, todos con `today` fijo `'2026-08-29'` y sin reloj mockeado:

```ts
it('pain.days cuenta fechas distintas, no registros', () => {
  const result = computeAthleteTriage({
    ...base,
    dayLogsInPainWindow: [
      { id: '1', date: '2026-08-27', painLevel: 5, updatedAt: 1 },
      { id: '2', date: '2026-08-27', painLevel: 6, updatedAt: 2 },
      { id: '3', date: '2026-08-25', painLevel: 4, updatedAt: 1 },
    ],
  })
  expect(result.signals).toContainEqual({ kind: 'pain', days: 2 })
})

it('painLevel 3 no dispara y 4 sí', () => { /* dos casos, borde exacto */ })

it('overdue cuenta sólo planned con fecha anterior a hoy dentro de 14 días', () => { /* día 14 sí, día 15 no */ })

it('no-check-in usa createdAt cuando nunca hubo DayLog', () => { /* día 2 no, día 3 sí */ })

it('no-check-in reporta la antigüedad real con el último registro fuera de ventana', () => {
  const result = computeAthleteTriage({ ...base, latestDayLog: { id: 'x', date: '2026-07-20', updatedAt: 1 } })
  expect(result.signals).toContainEqual({ kind: 'no-check-in', days: 40 })
})

it('low-adherence exige programación previa', () => {
  const result = computeAthleteTriage({
    ...base,
    sessionsInWindow: [],
    previousWeekSummary: { ...emptySummary, plannedSessions: 0, adherencePct: 0 },
  })
  expect(result.signals.some((s) => s.kind === 'low-adherence')).toBe(false)
  expect(result.insufficientData).toBe(true)
})

it('adherencia 59 dispara y 60 no', () => { /* borde exacto, con plannedSessions > 0 */ })

it('insufficient-data convive con no-check-in y conserva ambos', () => { /* alumno nuevo a 3 días */ })

it('un alumno con dolor y sin datos muestra las dos cosas', () => { /* prioridad conservada */ })
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/athlete/__tests__/coachRosterTriage.test.ts`
Expected: FAIL — `computeAthleteTriage` no existe.

- [ ] **Step 3: Implementar**

```ts
export const TRIAGE_THRESHOLDS = {
  painLevel: 4,
  painWindowDays: 7,
  overdueWindowDays: 14,
  noCheckInDays: 3,
  lowAdherencePct: 60,
} as const

export function computeAthleteTriage(input: { /* ver Interfaces */ }): AthleteTriage {
  const signals: TriageSignal[] = []

  const painDates = new Set(
    input.dayLogsInPainWindow
      .filter((log) => (log.painLevel ?? 0) >= TRIAGE_THRESHOLDS.painLevel)
      .map((log) => log.date),
  )
  if (painDates.size > 0) signals.push({ kind: 'pain', days: painDates.size })

  const overdue = input.sessionsInWindow.filter(
    (session) => session.status === 'planned' && session.date < input.today,
  )
  if (overdue.length > 0) {
    const oldest = overdue.reduce((a, b) => (a.date <= b.date ? a : b))
    signals.push({
      kind: 'overdue-sessions',
      count: overdue.length,
      oldestDaysAgo: calendarDaysBetween(oldest.date, input.today),
    })
  }

  const referenceDate = input.latestDayLog?.date ?? toCalendarDate(input.athlete.createdAt)
  const sinceCheckIn = calendarDaysBetween(referenceDate, input.today)
  if (sinceCheckIn >= TRIAGE_THRESHOLDS.noCheckInDays) {
    signals.push({ kind: 'no-check-in', days: sinceCheckIn })
  }

  const hasPreviousProgramming = (input.previousWeekSummary?.plannedSessions ?? 0) > 0
  const adherencePct = input.previousWeekSummary?.adherencePct
  if (hasPreviousProgramming && adherencePct != null && adherencePct < TRIAGE_THRESHOLDS.lowAdherencePct) {
    signals.push({ kind: 'low-adherence', adherencePct })
  }

  return {
    athleteId: input.athlete.id,
    signals: sortByPriority(signals),
    insufficientData: input.sessionsInWindow.length === 0 && !hasPreviousProgramming,
  }
}
```

`sortByPriority` ordena por el índice de `['pain', 'overdue-sessions', 'no-check-in', 'low-adherence']`. `calendarDaysBetween` usa `differenceInCalendarDays`. `toCalendarDate` convierte epoch a `YYYY-MM-DD` local.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/athlete/__tests__/coachRosterTriage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (no ejecutar sin pedido del owner)**

```bash
git add src/services/athlete/coachRosterTriage.ts src/services/athlete/__tests__/coachRosterTriage.test.ts
git commit -m "feat(coach-assistant): cálculo puro de señales del roster"
```

---

### Task 7: Payload allowlisted y validación de la respuesta

**Files:**
- Create: `src/services/coach/assistantMessage.ts`
- Create: `src/services/coach/__tests__/assistantMessage.test.ts`

**Interfaces:**
- Consumes: `TriageSignal` (Task 6), `CoachEngine.extractRaw` ampliado (Task 4).
- Produces:
  - `buildAssistantMessageInput(signals: TriageSignal[]): AssistantMessageInput`
  - `ASSISTANT_MESSAGE_SCHEMA`
  - `parseAssistantMessage(raw: string): { body: string } | null`
  - `ASSISTANT_MESSAGE_MAX_CHARS = 600`
  - `ASSISTANT_SYSTEM_PROMPT: string`

- [ ] **Step 1: Escribir el test que falla**

```ts
it('el payload sólo contiene las claves de la allowlist', () => {
  const input = buildAssistantMessageInput([
    { kind: 'pain', days: 2 },
    { kind: 'low-adherence', adherencePct: 45 },
  ])
  expect(Object.keys(input)).toEqual(['signals'])
  expect(new Set(input.signals.flatMap((s) => Object.keys(s))))
    .toEqual(new Set(['kind', 'days', 'adherencePct']))
  const serialized = JSON.stringify(input)
  for (const forbidden of ['name', 'athleteId', 'painNotes', 'date', 'id']) {
    expect(serialized).not.toContain(forbidden)
  }
})

it('descarta una respuesta sin body', () => {
  expect(parseAssistantMessage('{"text":"hola"}')).toBeNull()
})

it('descarta una respuesta con propiedades extra', () => {
  expect(parseAssistantMessage('{"body":"hola","advice":"baja la carga"}')).toBeNull()
})

it('descarta un body vacío y uno sobre el tope', () => {
  expect(parseAssistantMessage('{"body":""}')).toBeNull()
  expect(parseAssistantMessage(JSON.stringify({ body: 'x'.repeat(601) }))).toBeNull()
})

it('acepta una respuesta válida', () => {
  expect(parseAssistantMessage('{"body":"¿Cómo vas?"}')).toEqual({ body: '¿Cómo vas?' })
})

it('el prompt prohíbe diagnóstico, tratamiento y cambios de carga, y cabe en el tope', () => {
  expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/no (des|dar )?diagn/i)
  expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/tratamiento/i)
  expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/carga/i)
  expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/pregunta/i)
  expect(ASSISTANT_SYSTEM_PROMPT.length).toBeLessThanOrEqual(8000)
})

it('descarta JSON inválido sin lanzar', () => {
  expect(parseAssistantMessage('no es json')).toBeNull()
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/coach/__tests__/assistantMessage.test.ts`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

```ts
export const ASSISTANT_MESSAGE_MAX_CHARS = 600

export const ASSISTANT_MESSAGE_SCHEMA = {
  type: 'object',
  properties: { body: { type: 'string' } },
  required: ['body'],
  additionalProperties: false,
} as const

/**
 * Campo por campo, sin spreads de objetos de dominio: un spread arrastra
 * cualquier campo que `TriageSignal` gane después, y esta allowlist existe
 * exactamente para impedir eso.
 */
export function buildAssistantMessageInput(signals: TriageSignal[]): AssistantMessageInput {
  return {
    signals: signals.map((signal) => {
      switch (signal.kind) {
        case 'pain': return { kind: 'pain', days: signal.days }
        case 'overdue-sessions':
          return { kind: 'overdue-sessions', count: signal.count, oldestDaysAgo: signal.oldestDaysAgo }
        case 'no-check-in': return { kind: 'no-check-in', days: signal.days }
        case 'low-adherence': return { kind: 'low-adherence', adherencePct: signal.adherencePct }
      }
    }),
  }
}

/**
 * §6.5 del spec. Las prohibiciones no son exigibles por instrucción —por eso
 * existe `parseAssistantMessage`—, pero reducen el riesgo. El saludo con el
 * nombre lo agrega la app: el modelo redacta sólo el cuerpo.
 */
export const ASSISTANT_SYSTEM_PROMPT = [
  'Eres el asistente de un entrenador. Redactas el CUERPO de un mensaje breve',
  'que el entrenador enviará a su alumno. No escribas saludo ni despedida.',
  'Recibes sólo señales estructuradas: no conoces el nombre, el plan ni el historial.',
  'Prohibido: dar diagnóstico, sugerir tratamiento y proponer cambios de carga',
  'o de entrenamiento. Ante una señal de dolor puedes ÚNICAMENTE formular una',
  'pregunta de seguimiento sobre cómo se siente.',
  'Tono cercano y directo, en tuteo. Máximo 600 caracteres.',
  'Responde SOLO con un objeto JSON {"body": string}.',
].join(' ')

export function parseAssistantMessage(raw: string): { body: string } | null {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (typeof parsed !== 'object' || parsed === null) return null
  const keys = Object.keys(parsed)
  if (keys.length !== 1 || keys[0] !== 'body') return null
  const body = (parsed as { body: unknown }).body
  if (typeof body !== 'string') return null
  const trimmed = body.trim()
  if (trimmed.length === 0 || trimmed.length > ASSISTANT_MESSAGE_MAX_CHARS) return null
  return { body: trimmed }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/coach/__tests__/assistantMessage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (no ejecutar sin pedido del owner)**

```bash
git add src/services/coach/
git commit -m "feat(coach-assistant): payload allowlisted y validación de salida"
```

---

### Task 8a: Cargador del roster

**Files:**
- Create: `src/services/athlete/loadRosterTriage.ts`
- Create: `src/services/athlete/__tests__/loadRosterTriage.test.ts`

**Interfaces:**
- Consumes: Task 5 (las cuatro lecturas), Task 6 (`computeAthleteTriage`, `AthleteTriage`).
- Produces:

```ts
export interface RosterTriage {
  computedAt: number
  athletes: AthleteTriage[]
  durationMs: number
  athleteCount: number
}

export interface RosterTriageDeps {
  listRoster: (ownerAccountId: string) => Promise<Array<Pick<Athlete, 'id' | 'createdAt' | 'status'>>>
  getDayLogsForAthleteRange: (o: string, a: string, from: string, to: string) => Promise<DayLog[]>
  getLatestDayLogForAthlete: (o: string, a: string) => Promise<DayLog | undefined>
  getSessionsForAthleteRange: (o: string, a: string, from: string, to: string) => Promise<Session[]>
  getWeekSummariesForAthleteRange: (o: string, a: string, from: string, to: string) => Promise<WeekSummary[]>
  currentOwnerAccountId: () => string | null
  now: () => number
}

export function createRosterTriageLoader(deps: RosterTriageDeps): {
  load(ownerAccountId: string, today: string): Promise<RosterTriage | null>
}
```

`load` devuelve `null` cuando el resultado debe descartarse: cambió la cuenta o
ya salió un cálculo posterior.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, expect, it, vi } from 'vitest'
import { createRosterTriageLoader } from '../loadRosterTriage'

const OWNER = 'acc_1'
const TODAY = '2026-08-29' // sábado; lunes de esa semana = 2026-08-24

function makeDeps(overrides: Partial<Parameters<typeof createRosterTriageLoader>[0]> = {}) {
  return {
    listRoster: vi.fn(async () => [
      { id: 'ath_self', createdAt: Date.UTC(2026, 0, 1), status: 'active' },
      { id: 'ath_a', createdAt: Date.UTC(2026, 0, 1), status: 'active' },
    ]),
    getDayLogsForAthleteRange: vi.fn(async () => []),
    getLatestDayLogForAthlete: vi.fn(async () => undefined),
    getSessionsForAthleteRange: vi.fn(async () => []),
    getWeekSummariesForAthleteRange: vi.fn(async () => []),
    currentOwnerAccountId: () => OWNER,
    now: () => 1_000,
    ...overrides,
  }
}

describe('createRosterTriageLoader', () => {
  it('devuelve una entrada por atleta activo del roster', async () => {
    const result = await createRosterTriageLoader(makeDeps()).load(OWNER, TODAY)

    expect(result?.athletes.map((a) => a.athleteId)).toEqual(['ath_self', 'ath_a'])
    expect(result?.athleteCount).toBe(2)
  })

  it('excluye atletas archivados', async () => {
    const deps = makeDeps({
      listRoster: vi.fn(async () => [
        { id: 'ath_self', createdAt: 0, status: 'active' },
        { id: 'ath_arch', createdAt: 0, status: 'archived' },
      ]),
    })
    const result = await createRosterTriageLoader(deps).load(OWNER, TODAY)

    expect(result?.athletes.map((a) => a.athleteId)).toEqual(['ath_self'])
    expect(deps.getSessionsForAthleteRange).not.toHaveBeenCalledWith(
      OWNER, 'ath_arch', expect.anything(), expect.anything(),
    )
  })

  it('consulta cada ventana con sus límites exactos', async () => {
    const deps = makeDeps({
      listRoster: vi.fn(async () => [{ id: 'ath_a', createdAt: 0, status: 'active' }]),
    })
    await createRosterTriageLoader(deps).load(OWNER, TODAY)

    // dolor: hoy y los 6 anteriores
    expect(deps.getDayLogsForAthleteRange).toHaveBeenCalledWith(OWNER, 'ath_a', '2026-08-23', '2026-08-29')
    // sesiones: [hoy - 14, hoy)
    expect(deps.getSessionsForAthleteRange).toHaveBeenCalledWith(OWNER, 'ath_a', '2026-08-15', '2026-08-28')
    // semana completa anterior (lunes a lunes de la semana previa)
    expect(deps.getWeekSummariesForAthleteRange).toHaveBeenCalledWith(OWNER, 'ath_a', '2026-08-17', '2026-08-17')
  })

  it('incluye durationMs y athleteCount', async () => {
    let clock = 5
    const deps = makeDeps({ now: () => (clock += 10) })
    const result = await createRosterTriageLoader(deps).load(OWNER, TODAY)

    expect(result?.durationMs).toBeGreaterThanOrEqual(0)
    expect(result?.computedAt).toBeGreaterThan(0)
    expect(result?.athleteCount).toBe(result?.athletes.length)
  })

  it('descarta el resultado si cambió la cuenta durante el cálculo', async () => {
    let owner: string | null = OWNER
    const deps = makeDeps({
      currentOwnerAccountId: () => owner,
      getSessionsForAthleteRange: vi.fn(async () => { owner = 'acc_2'; return [] }),
    })
    const result = await createRosterTriageLoader(deps).load(OWNER, TODAY)

    expect(result).toBeNull()
  })

  it('sólo el cálculo más reciente publica su resultado', async () => {
    let release: (() => void) | undefined
    const slow = new Promise<void>((resolve) => { release = resolve })
    let first = true
    const deps = makeDeps({
      getSessionsForAthleteRange: vi.fn(async () => {
        if (first) { first = false; await slow }
        return []
      }),
    })
    const loader = createRosterTriageLoader(deps)

    const slowLoad = loader.load(OWNER, TODAY)
    const fastLoad = await loader.load(OWNER, TODAY)
    release!()

    expect(await slowLoad).toBeNull()
    expect(fastLoad).not.toBeNull()
  })

  it('no cambia el atleta activo', async () => {
    const deps = makeDeps()
    await createRosterTriageLoader(deps).load(OWNER, TODAY)

    // El cargador sólo puede usar las lecturas por atleta explícito.
    expect(Object.keys(deps)).not.toContain('setActiveAthleteId')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/athlete/__tests__/loadRosterTriage.test.ts`
Expected: FAIL — no existe `../loadRosterTriage`.

- [ ] **Step 3: Implementar**

```ts
export function createRosterTriageLoader(deps: RosterTriageDeps) {
  let latestGeneration = 0

  return {
    async load(ownerAccountId: string, today: string): Promise<RosterTriage | null> {
      const generation = ++latestGeneration
      const startedAt = deps.now()

      const painFrom = addCalendarDays(today, -(TRIAGE_THRESHOLDS.painWindowDays - 1))
      const sessionsFrom = addCalendarDays(today, -TRIAGE_THRESHOLDS.overdueWindowDays)
      const sessionsTo = addCalendarDays(today, -1)
      const previousWeekStart = addCalendarDays(startOfWeekMonday(today), -7)

      const roster = (await deps.listRoster(ownerAccountId))
        .filter((athlete) => athlete.status === 'active')

      const athletes: AthleteTriage[] = []
      for (const athlete of roster) {
        const [dayLogsInPainWindow, latestDayLog, sessionsInWindow, summaries] = await Promise.all([
          deps.getDayLogsForAthleteRange(ownerAccountId, athlete.id, painFrom, today),
          deps.getLatestDayLogForAthlete(ownerAccountId, athlete.id),
          deps.getSessionsForAthleteRange(ownerAccountId, athlete.id, sessionsFrom, sessionsTo),
          deps.getWeekSummariesForAthleteRange(
            ownerAccountId, athlete.id, previousWeekStart, previousWeekStart,
          ),
        ])
        athletes.push(computeAthleteTriage({
          athlete,
          today,
          dayLogsInPainWindow,
          latestDayLog,
          sessionsInWindow,
          previousWeekSummary: summaries[0],
        }))
      }

      // Se descarta el RESULTADO, nunca la pantalla: precedente del bloque
      // Whoop del chat (§24), donde un guard demasiado amplio perdía un mensaje.
      if (deps.currentOwnerAccountId() !== ownerAccountId) return null
      if (generation !== latestGeneration) return null

      const computedAt = deps.now()
      return { computedAt, athletes, durationMs: computedAt - startedAt, athleteCount: athletes.length }
    },
  }
}
```

`addCalendarDays` y `startOfWeekMonday` reutilizan los helpers de fecha que ya
usa la app; no se escriben nuevos.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/athlete/`
Expected: PASS.

- [ ] **Step 5: Commit (no ejecutar sin pedido del owner)**

```bash
git add src/services/athlete/loadRosterTriage.ts src/services/athlete/__tests__/loadRosterTriage.test.ts
git commit -m "feat(coach-assistant): cargador del triaje con descarte por cuenta y generación"
```

---

### Task 8b: Panel y acción de redacción

**Files:**
- Create: `src/services/coach/requestAssistantDraft.ts`
- Create: `src/services/coach/__tests__/requestAssistantDraft.test.ts`
- Create: `src/components/coach/CoachAssistantPanel.tsx`
- Create: `src/components/coach/CoachAssistantPanel.test.tsx`

**Interfaces:**
- Consumes: Task 7 (`buildAssistantMessageInput`, `ASSISTANT_MESSAGE_SCHEMA`, `ASSISTANT_SYSTEM_PROMPT`, `parseAssistantMessage`), Task 8a (`RosterTriage`).
- Produces:

```ts
export type DraftFailure =
  | 'quota' | 'kill-switch' | 'entitlement'   // bloqueantes: deshabilitan
  | 'timeout' | 'network' | 'invalid-response' // transitorios: reintentables

export type DraftResult =
  | { ok: true; body: string }
  | { ok: false; reason: DraftFailure }

export function requestAssistantDraft(signals: TriageSignal[]): Promise<DraftResult>

export function CoachAssistantPanel(props: {
  triage: RosterTriage | null
  loading: boolean
  selfAthleteId: string
  athleteNames: Record<string, string>
  syncLabel: string
  devToolsEnabled?: boolean
  onRefresh: () => void
  onDraft: (athleteId: string) => Promise<DraftResult>
}): JSX.Element
```

- [ ] **Step 1: Escribir los tests que fallan**

`requestAssistantDraft.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

const extractRaw = vi.fn()
vi.mock('../../ai/CoachEngine', () => ({ CoachEngine: { extractRaw } }))

import { requestAssistantDraft } from '../requestAssistantDraft'

const SIGNALS = [{ kind: 'pain', days: 2 } as const]

describe('requestAssistantDraft', () => {
  it('llama con la clase y la superficie explícitas y con salida estructurada', async () => {
    extractRaw.mockResolvedValueOnce('{"body":"¿Cómo vas?"}')
    await requestAssistantDraft(SIGNALS)

    expect(extractRaw).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        requestClass: 'coach_assistant_message',
        surface: 'coach_assistant',
        responseMimeType: 'application/json',
      }),
    )
  })

  it('no envía identificadores ni texto libre', async () => {
    extractRaw.mockResolvedValueOnce('{"body":"ok"}')
    await requestAssistantDraft(SIGNALS)
    const [, userMessage] = extractRaw.mock.calls.at(-1)!

    for (const forbidden of ['athleteId', 'painNotes', 'name', '2026-']) {
      expect(userMessage).not.toContain(forbidden)
    }
  })

  it('devuelve el cuerpo validado', async () => {
    extractRaw.mockResolvedValueOnce('{"body":"¿Cómo vas?"}')
    expect(await requestAssistantDraft(SIGNALS)).toEqual({ ok: true, body: '¿Cómo vas?' })
  })

  it('trata una respuesta inválida como fallo, no como cuerpo', async () => {
    extractRaw.mockResolvedValueOnce('{"body":"","advice":"baja la carga"}')
    expect(await requestAssistantDraft(SIGNALS)).toEqual({ ok: false, reason: 'invalid-response' })
  })

  it.each([
    ['QuotaExceededError', 'quota'],
    ['KillSwitchActiveError', 'kill-switch'],
    ['EntitlementRequiredError', 'entitlement'],
  ])('clasifica %s como %s', async (errorName, reason) => {
    const error = new Error('nope'); error.name = errorName
    extractRaw.mockRejectedValueOnce(error)
    expect(await requestAssistantDraft(SIGNALS)).toEqual({ ok: false, reason })
  })

  it('clasifica un timeout como transitorio', async () => {
    const error = new Error('timeout'); error.name = 'AbortError'
    extractRaw.mockRejectedValueOnce(error)
    expect(await requestAssistantDraft(SIGNALS)).toEqual({ ok: false, reason: 'timeout' })
  })
})
```

`CoachAssistantPanel.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CoachAssistantPanel from './CoachAssistantPanel'

const TRIAGE = {
  computedAt: Date.UTC(2026, 7, 29, 14, 30),
  durationMs: 42,
  athleteCount: 4,
  athletes: [
    { athleteId: 'ath_a', insufficientData: false, signals: [
      { kind: 'low-adherence', adherencePct: 40 }, { kind: 'pain', days: 2 },
    ] },
    { athleteId: 'ath_nuevo', insufficientData: true, signals: [] },
    { athleteId: 'ath_ok', insufficientData: false, signals: [] },
    { athleteId: 'ath_self', insufficientData: false, signals: [{ kind: 'no-check-in', days: 5 }] },
  ],
} as const

const NAMES = { ath_a: 'Ana', ath_nuevo: 'Nuevo', ath_ok: 'Ok', ath_self: 'Yo' }

function renderPanel(overrides = {}) {
  return render(
    <CoachAssistantPanel
      triage={TRIAGE}
      loading={false}
      selfAthleteId="ath_self"
      athleteNames={NAMES}
      syncLabel="Sincronizado hace 2 min"
      onRefresh={vi.fn()}
      onDraft={vi.fn(async () => ({ ok: true, body: 'borrador' }))}
      {...overrides}
    />,
  )
}

describe('CoachAssistantPanel', () => {
  it('separa con-señales, sin-datos y al-día, y no colapsa sin-datos', () => {
    renderPanel()
    expect(screen.getByTestId('group-con-senales')).toHaveTextContent('Ana')
    expect(screen.getByTestId('group-sin-datos')).toHaveTextContent('Nuevo')
    expect(screen.getByTestId('group-al-dia')).toHaveAttribute('data-collapsed', 'true')
    expect(screen.getByTestId('group-sin-datos')).toHaveAttribute('data-collapsed', 'false')
  })

  it('ordena las señales con dolor primero', () => {
    renderPanel()
    const chips = screen.getByTestId('signals-ath_a').textContent ?? ''
    expect(chips.indexOf('dolor')).toBeLessThan(chips.indexOf('adherencia'))
  })

  it('no ofrece redactar cuando el único estado es sin datos', () => {
    renderPanel()
    expect(screen.queryByTestId('draft-ath_nuevo')).toBeNull()
  })

  it('no ofrece redactar para el self', () => {
    renderPanel()
    expect(screen.queryByTestId('draft-ath_self')).toBeNull()
  })

  it('muestra cuándo se calculó y el estado de sync, sin decir tiempo real', () => {
    renderPanel()
    expect(screen.getByTestId('computed-at')).toHaveTextContent(/Calculado/)
    expect(screen.getByTestId('computed-at')).toHaveTextContent('Sincronizado hace 2 min')
    expect(document.body.textContent).not.toMatch(/tiempo real/i)
  })

  it('muestra el borrador validado sin enviarlo', async () => {
    renderPanel()
    await userEvent.click(screen.getByTestId('draft-ath_a'))
    await waitFor(() => expect(screen.getByTestId('draft-body-ath_a')).toHaveTextContent('borrador'))
    expect(screen.queryByRole('button', { name: /enviar/i })).toBeNull()
  })

  it.each(['quota', 'kill-switch', 'entitlement'] as const)(
    '%s deshabilita el botón y muestra el motivo', async (reason) => {
      renderPanel({ onDraft: vi.fn(async () => ({ ok: false, reason })) })
      await userEvent.click(screen.getByTestId('draft-ath_a'))
      await waitFor(() => expect(screen.getByTestId('draft-ath_a')).toBeDisabled())
      expect(screen.getByTestId('draft-error-ath_a')).not.toBeEmptyDOMElement()
    },
  )

  it.each(['timeout', 'network', 'invalid-response'] as const)(
    '%s muestra el motivo y deja reintentar', async (reason) => {
      renderPanel({ onDraft: vi.fn(async () => ({ ok: false, reason })) })
      await userEvent.click(screen.getByTestId('draft-ath_a'))
      await waitFor(() => expect(screen.getByTestId('draft-error-ath_a')).not.toBeEmptyDOMElement())
      expect(screen.getByTestId('draft-ath_a')).toBeEnabled()
    },
  )

  it('una respuesta inválida no renderiza cuerpo parcial', async () => {
    renderPanel({ onDraft: vi.fn(async () => ({ ok: false, reason: 'invalid-response' })) })
    await userEvent.click(screen.getByTestId('draft-ath_a'))
    await waitFor(() => expect(screen.getByTestId('draft-error-ath_a')).not.toBeEmptyDOMElement())
    expect(screen.queryByTestId('draft-body-ath_a')).toBeNull()
  })

  it('el triaje sigue visible en todos los modos de fallo de IA', async () => {
    for (const reason of ['quota', 'kill-switch', 'entitlement', 'timeout', 'network', 'invalid-response'] as const) {
      const view = renderPanel({ onDraft: vi.fn(async () => ({ ok: false, reason })) })
      await userEvent.click(screen.getByTestId('draft-ath_a'))
      await waitFor(() => expect(screen.getByTestId('group-con-senales')).toHaveTextContent('Ana'))
      view.unmount()
    }
  })

  it('las métricas sólo aparecen con dev tools', () => {
    const { unmount } = renderPanel()
    expect(screen.queryByTestId('triage-metrics')).toBeNull()
    unmount()
    renderPanel({ devToolsEnabled: true })
    expect(screen.getByTestId('triage-metrics')).toHaveTextContent('42')
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run src/services/coach/__tests__/requestAssistantDraft.test.ts src/components/coach/CoachAssistantPanel.test.tsx`
Expected: FAIL — no existen ni el servicio ni el componente.

- [ ] **Step 3: Implementar**

`requestAssistantDraft.ts` arma el payload con `buildAssistantMessageInput`, llama a
`CoachEngine.extractRaw(ASSISTANT_SYSTEM_PROMPT, JSON.stringify(input), { requestClass:
'coach_assistant_message', surface: 'coach_assistant', responseMimeType: 'application/json',
responseSchema: ASSISTANT_MESSAGE_SCHEMA })`, pasa la salida por `parseAssistantMessage`
—`null` ⇒ `invalid-response`— y clasifica los errores del gate por `error.name` en las
seis categorías de `DraftFailure`.

`CoachAssistantPanel.tsx` renderiza los tres grupos con `data-testid` y
`data-collapsed`, la línea `Calculado <hora> · <syncLabel>`, el botón de recálculo,
y por atleta `[Ver semana]` más `[Redactar mensaje]` —presente sólo si
`signals.length > 0` y `athleteId !== selfAthleteId`—. El estado de fallo se
guarda por atleta: las tres causas bloqueantes marcan el botón `disabled`, las
tres transitorias lo dejan habilitado. Las métricas van tras `devToolsEnabled`.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run src/services/coach/ src/components/coach/`
Expected: PASS.

- [ ] **Step 5: Commit (no ejecutar sin pedido del owner)**

```bash
git add src/services/coach/requestAssistantDraft.ts src/services/coach/__tests__/requestAssistantDraft.test.ts src/components/coach/CoachAssistantPanel.tsx src/components/coach/CoachAssistantPanel.test.tsx
git commit -m "feat(coach-assistant): panel de triaje y acción de redacción"
```

---

### Task 9: Cableado en el Workspace y retiro del copy que sobre-promete

**Files:**
- Modify: `src/pages/CoachWorkspacePage.tsx:283-288`
- Modify: `src/components/coach/CoachWorkspaceNav.tsx:14`
- Modify: `src/components/coach/CoachWorkspaceNav.test.tsx:48`

**Interfaces:**
- Consumes: Tasks 8a y 8b.
- Produces: la pestaña `asistente` renderiza `CoachAssistantPanel`.

- [ ] **Step 1: Escribir el test que falla**

```ts
it('la pestaña asistente ya no está marcada como "pronto"', () => {
  const html = render(<CoachWorkspaceNav … />)
  expect(html.queryByText('pronto')).toBeNull()
})

it('la pestaña asistente no promete proponer cambios de sesión, semana o plan', () => {
  const html = render(<CoachWorkspacePage … />)
  expect(html.container.textContent).not.toContain('proponer cambios de sesión, semana o plan')
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/components/coach/CoachWorkspaceNav.test.tsx src/pages/CoachWorkspacePage.test.tsx`
Expected: FAIL — `comingSoon: true` sigue puesto y el placeholder conserva su descripción.

- [ ] **Step 3: Implementar**

En `CoachWorkspaceNav.tsx:14`, quitar `comingSoon: true` de la entrada `asistente`. En `CoachWorkspacePage.tsx:283-288`, reemplazar `CoachWorkspacePlaceholderPanel` por `<CoachAssistantPanel />`.

El copy de la fase 2 se retira: la fase 1 no propone cambios de sesión, semana ni plan.

- [ ] **Step 4: Correr la suite completa**

Run: `npm test && npm run lint && npx tsc -b && npm run build && git diff --check`
Expected: todo verde.

- [ ] **Step 5: Commit (no ejecutar sin pedido del owner)**

```bash
git add src/pages/CoachWorkspacePage.tsx src/components/coach/
git commit -m "feat(coach-assistant): cablear el panel de triaje y retirar el placeholder"
```

---

## Rollout

1. Aplicar `023` a mano en producción. **Antes** de cualquier deploy que emita la clase.
2. Confirmar que entitlements y límites de uso están encendidos (§Pre-Lanzamiento, puntos 2, 3 y 4). Sin eso, un usuario `advanced` recibiría `entitlement_required` o la cuota no se contaría.
3. Desplegar.
4. Smoke: abrir `/coach` → Asistente, verificar los tres grupos, pedir un borrador, y comprobar en `coach_requests` que la fila trae `request_class = 'coach_assistant_message'` y costo estimado.

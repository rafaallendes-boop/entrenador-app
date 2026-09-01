# Separación de planes de atleta — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los tres tiers `free | weekly | advanced` sean tres productos
distinguibles y aplicados server-side, con `week_creator` y `chat_action` desde
`weekly`, cuotas recalculadas, spend cap por tier y `/pricing` diciendo la
verdad.

**Architecture:** El gate sigue viviendo entero sobre `AIRequestClass` en tres
Netlify Functions. Se agrega un módulo puro `resolveCapability` que centraliza la
decisión con contexto explícito —hoy `targetAthleteId` se ignora— para que el
Proyecto 2 (producto Coach) sea aditivo. `spendCapPolicy` pasa de un literal
único a una tabla por tier. Ningún cambio de Supabase ni de Dexie.

**Tech Stack:** TypeScript, Vitest, React, Netlify Functions, Supabase
(solo lectura de `user_entitlements`, sin migración).

**Spec:** [`docs/superpowers/specs/2026-09-01-athlete-tier-separation-design.md`](../specs/2026-09-01-athlete-tier-separation-design.md)

## Global Constraints

- **Los módulos de `src/services/entitlements/` son puros.** Sin red, sin Dexie,
  sin React. Los importan las Netlify Functions; una dependencia de navegador
  rompe el build del servidor.
- **Orden del gate, no negociable:** `auth → kill switch → entitlement → spend
  cap (lectura) → cuota (incremento atómico) → proveedor → costo (post-respuesta)`.
- **`limit: null` significa "clase no permitida", nunca cuota cero.** Un `0`
  produciría un mensaje de límite diario donde corresponde la oferta de plan.
- **Clase desconocida se deniega para todo tier, incluido `advanced`.**
- **No hay reembolso de cuota.** Ningún camino del código decrementa.
- **Las cuotas cuentan intentos del proveedor, no acciones de producto.** Nunca
  escribir copy visible que traduzca una cuota a "mensajes" o "semanas".
- **Nunca encender el cliente antes que el servidor.** `VITE_ENTITLEMENTS` es el
  último paso del rollout.
- **Antes de commitear:** `npm run lint && npm test && npm run build`.
- **Los commits los hace el owner.** Las tareas dejan el árbol listo y verificado;
  el paso "Commit" se ejecuta solo si el owner lo pide explícitamente.

### Precondición: el árbol de trabajo está sucio

Al escribir este plan hay 7 archivos modificados sin commitear que pertenecen a
la feature de **Competition Plan read-only para Free** (`CycleHistory.tsx`,
`CompetitionPlanPage.tsx`, `PlanDashboard.tsx`, sus tres tests,
`PROJECT_REVIEW_AND_ROADMAP.md` y la spec de 2026-08-15).

**Esa feature no es parte de este plan** y el spec la declara como la única
excepción preexistente al gating no-IA (§4.1). Antes de empezar la Task 2, el
owner tiene que decidir si se commitea aparte o se descarta. Trabajar encima de
un árbol sucio hace que los diffs de este plan sean irrevisables.

---

## Estructura de archivos

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `docs/superpowers/measurements/2026-09-01-ai-cost-baseline.md` | Crear — salida de Fase 0 | 1 |
| `src/services/entitlements/quotaBuckets.ts` | Modificar — invariante de bucket + cuotas nuevas | 2, 4 |
| `src/services/entitlements/entitlementPolicy.ts` | Modificar — mapa clase→tier | 4 |
| `src/services/entitlements/resolveCapability.ts` | Crear — la costura con contexto | 3 |
| `src/services/entitlements/spendCapPolicy.ts` | Modificar — cap por tier | 5 |
| `netlify/functions/_shared/usageGate.ts` | Modificar — pasar tier al cap | 5 |
| `netlify/functions/_shared/resolveEntitlement.ts` | Modificar — usar `resolveCapability` | 6 |
| `netlify/functions/coach.ts` | Modificar — usar `resolveCapability` | 6 |
| `src/hooks/useEntitlement.ts` | Modificar — exponer la decisión completa | 7 |
| `src/pages/PricingPage.tsx` | Modificar — copy alineado, sin cifras | 8 |

Orden de dependencias: 1 es independiente y bloquea solo la *congelación* de
números; 3 depende de 2; 4 depende de 2; 5 es independiente; 6 y 7 dependen de
3 y 4; 8 depende de 4.

---

### Task 1: Fase 0 — línea base de costo real

Salida de medición, no código. **No bloquea las tareas 2–7**, pero **sí bloquea
publicar o congelar cualquier número**: si esta tarea no está cerrada, las
cuotas de la Task 4 y los caps de la Task 5 se mantienen marcados como
provisionales en el código y en el roadmap.

**Files:**
- Create: `docs/superpowers/measurements/2026-09-01-ai-cost-baseline.md`

**Interfaces:**
- Consumes: nada.
- Produces: los percentiles que justifican (o refutan) las cuotas de la Task 4.

- [ ] **Step 1: Correr la agregación en el SQL Editor de producción**

Ventana de 7 días sobre `coach_requests` (`018`, aplicada). Columnas verificadas
contra `supabase/018_coach_requests.sql`.

```sql
select
  request_class,
  count(*)                                                              as filas,
  count(*) filter (where estimated_cost_usd is not null)                as filas_con_costo,
  round(100.0 * count(*) filter (where estimated_cost_usd is not null)
        / nullif(count(*), 0), 1)                                       as cobertura_filas_pct,
  sum(coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0))      as tokens_total,
  sum(coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0))
    filter (where estimated_cost_usd is not null)                       as tokens_con_costo,
  percentile_disc(0.5) within group (order by prompt_tokens)            as in_p50,
  percentile_disc(0.9) within group (order by prompt_tokens)            as in_p90,
  max(prompt_tokens)                                                    as in_max,
  percentile_disc(0.5) within group (order by completion_tokens)        as out_p50,
  percentile_disc(0.9) within group (order by completion_tokens)        as out_p90,
  max(completion_tokens)                                                as out_max,
  percentile_disc(0.5) within group (order by estimated_cost_usd)       as cost_p50,
  percentile_disc(0.9) within group (order by estimated_cost_usd)       as cost_p90,
  max(estimated_cost_usd)                                               as cost_max,
  round(100.0 * count(*) filter (where retry_used)   / nullif(count(*), 0), 1) as retry_pct,
  round(100.0 * count(*) filter (where fallback_used)/ nullif(count(*), 0), 1) as fallback_pct
from public.coach_requests
where created_at >= now() - interval '7 days'
group by request_class
order by filas desc;
```

- [ ] **Step 2: Escribir el reporte**

Crear `docs/superpowers/measurements/2026-09-01-ai-cost-baseline.md` con la
tabla cruda, la ventana exacta, y una sección **Veredicto** que responda estas
tres preguntas de forma explícita:

1. ¿La cobertura por **tokens** supera 80%? Si no, el costo agregado no es
   representativo y las cuotas siguen provisionales.
2. ¿`in_p50` del chat está cerca de los 8.000 tokens que supone el spec §7.1?
   Si `in_p90` lo duplica, recalcular §7.3 antes de congelar.
3. ¿`retry_pct` y `fallback_pct` son cercanos a cero? Es el supuesto sobre el
   que descansa la holgura 16/8 de §7 (b).

Si hay menos de 30 filas en alguna clase relevante, escribir **"muestra
insuficiente"** para esa clase y no derivar percentiles de ella. Una ventana
corta no autoriza a congelar números; autoriza a esperar otra semana.

- [ ] **Step 3: Verificar que el documento no afirma más de lo que mide**

Toda cifra estimada debe estar marcada como estimación. `estimated_cost_usd =
null` nunca se cuenta como cero: las agregaciones de costo lo excluyen y la
cobertura se reporta en dos dimensiones.

---

### Task 2: `bucketLimitForTier` deja de depender del orden del array

**Files:**
- Modify: `src/services/entitlements/quotaBuckets.ts:36`
- Test: `src/services/entitlements/__tests__/quotaBuckets.test.ts`

**Interfaces:**
- Consumes: `isClassAllowed(tier, requestClass)` de `entitlementPolicy.ts`.
- Produces: `bucketLimitForTier(bucket: QuotaBucket, tier: Tier): number | null`
  con la misma firma; cambia solo el predicado interno.

Hoy el predicado es `isClassAllowed(tier, bucket.classes[0])`. Funciona por
suerte del orden: `chat` tiene `['chat_general', 'chat_action']` y la clase menos
privilegiada quedó primera. Cuando la Task 4 suba `chat_action` a `weekly`, esa
coincidencia pasa a ser load-bearing y silenciosa.

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `src/services/entitlements/__tests__/quotaBuckets.test.ts`:

```ts
describe('bucketLimitForTier no depende del orden de bucket.classes', () => {
  it('un tier que puede usar alguna clase del bucket recibe su límite', () => {
    // Bucket sintético con la clase MENOS privilegiada en segunda posición.
    // Con el predicado posicional esto devuelve null y el test falla.
    const bucket = {
      id: 'sintetico',
      classes: ['week_creator', 'chat_general'],
      limits: { free: 7, weekly: 7, advanced: 7 },
    } as const

    expect(bucketLimitForTier(bucket, 'free')).toBe(7)
  })

  it('un tier que no puede usar ninguna clase del bucket recibe null', () => {
    const bucket = {
      id: 'sintetico-advanced',
      classes: ['plan_builder_week', 'plan_builder_pair'],
      limits: { free: 7, weekly: 7, advanced: 7 },
    } as const

    expect(bucketLimitForTier(bucket, 'free')).toBeNull()
    expect(bucketLimitForTier(bucket, 'weekly')).toBeNull()
    expect(bucketLimitForTier(bucket, 'advanced')).toBe(7)
  })
})
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run src/services/entitlements/__tests__/quotaBuckets.test.ts -t "no depende del orden"`
Expected: FAIL — el primer caso devuelve `null` porque `classes[0]` es
`week_creator`, que `free` no puede usar.

- [ ] **Step 3: Cambiar el predicado**

En `src/services/entitlements/quotaBuckets.ts`, reemplazar el cuerpo de
`bucketLimitForTier`:

```ts
/**
 * `null` significa "no aplica cuota porque el plan no permite NINGUNA clase de
 * este bucket". NO devolver 0: el mensaje correcto para ese caso es la oferta
 * de plan.
 *
 * El predicado pregunta por `some`, no por `classes[0]`: desde que
 * `chat_general` y `chat_action` tienen tiers distintos, apoyarse en la
 * posición haría que reordenar el literal cambiara el comportamiento en
 * silencio. Un tier que puede usar al menos una clase del bucket tiene cuota
 * en ese bucket; el entitlement rechaza por separado las clases que no puede.
 */
export function bucketLimitForTier(bucket: QuotaBucket, tier: Tier): number | null {
  if (!bucket.classes.some((cls) => isClassAllowed(tier, cls))) return null
  return bucket.limits[tier] ?? null
}
```

- [ ] **Step 4: Correr la suite del módulo**

Run: `npx vitest run src/services/entitlements/`
Expected: PASS, incluidos los tests preexistentes de cobertura de buckets.

- [ ] **Step 5: Commit (solo si el owner lo pide)**

```bash
git add src/services/entitlements/quotaBuckets.ts src/services/entitlements/__tests__/quotaBuckets.test.ts
git commit -m "fix(entitlements): bucketLimitForTier deja de depender del orden de classes"
```

---

### Task 3: `resolveCapability` — la costura con contexto explícito

**Files:**
- Create: `src/services/entitlements/resolveCapability.ts`
- Test: `src/services/entitlements/__tests__/resolveCapability.test.ts`

**Interfaces:**
- Consumes: `resolveTier`, `isClassAllowed`, `minTierForClass`, `EntitlementRow`,
  `Tier` de `entitlementPolicy.ts`; `bucketForClass`, `bucketLimitForTier` de
  `quotaBuckets.ts` (con el predicado de la Task 2).
- Produces: `resolveCapability(input: ResolveCapabilityInput): CapabilityDecision`
  y ambos tipos, consumidos por las tareas 6 y 7.

En esta versión `targetAthleteId` **no altera el resultado**. Es deliberado: el
objetivo es que agregar la regla de coach en Proyecto 2 sea cambiar el cuerpo de
esta función, no rastrear tiers por toda la aplicación.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/entitlements/__tests__/resolveCapability.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveCapability } from '../resolveCapability'
import type { EntitlementRow } from '../entitlementPolicy'

const NOW = Date.UTC(2026, 8, 1)
const ACTOR = 'user-actor'

function row(tier: EntitlementRow['tier'], expiresAt: number | null = null): EntitlementRow {
  return { tier, expiresAt }
}

describe('resolveCapability — decisión básica', () => {
  it('advanced puede plan_builder_week, con bucket y límite resueltos', () => {
    const decision = resolveCapability({
      actorUserId: ACTOR,
      targetAthleteId: null,
      capability: 'plan_builder_week',
      now: NOW,
      entitlement: row('advanced'),
    })

    expect(decision.allowed).toBe(true)
    expect(decision.tier).toBe('advanced')
    expect(decision.requiredTier).toBe('advanced')
    expect(decision.quotaBucketId).toBe('plan_builder_week')
    expect(decision.limit).toBeGreaterThan(0)
  })

  it('free no puede plan_builder_week y su limit es null, no 0', () => {
    const decision = resolveCapability({
      actorUserId: ACTOR,
      targetAthleteId: null,
      capability: 'plan_builder_week',
      now: NOW,
      entitlement: row('free'),
    })

    expect(decision.allowed).toBe(false)
    expect(decision.limit).toBeNull()
    expect(decision.quotaBucketId).toBeNull()
    expect(decision.requiredTier).toBe('advanced')
  })

  it('un entitlement vencido resuelve a free', () => {
    const decision = resolveCapability({
      actorUserId: ACTOR,
      targetAthleteId: null,
      capability: 'week_creator',
      now: NOW,
      entitlement: row('advanced', NOW - 1),
    })

    expect(decision.tier).toBe('free')
    expect(decision.allowed).toBe(false)
  })

  it('ausencia de fila resuelve a free', () => {
    const decision = resolveCapability({
      actorUserId: ACTOR,
      targetAthleteId: null,
      capability: 'chat_general',
      now: NOW,
      entitlement: null,
    })

    expect(decision.tier).toBe('free')
    expect(decision.allowed).toBe(true)
  })
})

describe('resolveCapability — contrato de propiedad', () => {
  it('el actor es dueño del entitlement y de la cuota', () => {
    const decision = resolveCapability({
      actorUserId: ACTOR,
      targetAthleteId: 'ath_otro',
      capability: 'chat_general',
      now: NOW,
      entitlement: row('weekly'),
    })

    expect(decision.entitlementSource).toBe('self')
    expect(decision.entitlementOwnerUserId).toBe(ACTOR)
    expect(decision.quotaOwnerUserId).toBe(ACTOR)
  })

  it('consume exactamente una unidad: la cuota cuenta intentos, no producto', () => {
    for (const capability of ['chat_general', 'plan_builder_pair', 'week_creator'] as const) {
      const decision = resolveCapability({
        actorUserId: ACTOR,
        targetAthleteId: null,
        capability,
        now: NOW,
        entitlement: row('advanced'),
      })
      expect(decision.consumptionUnits).toBe(1)
    }
  })
})

describe('resolveCapability — targetAthleteId se ignora en esta versión', () => {
  it('la decisión es idéntica con y sin atleta objetivo', () => {
    const base = {
      actorUserId: ACTOR,
      capability: 'week_creator' as const,
      now: NOW,
      entitlement: row('weekly'),
    }

    expect(resolveCapability({ ...base, targetAthleteId: null }))
      .toEqual(resolveCapability({ ...base, targetAthleteId: 'ath_gestionado' }))
  })
})

describe('resolveCapability — clase desconocida', () => {
  it('se deniega incluso para advanced', () => {
    const decision = resolveCapability({
      actorUserId: ACTOR,
      targetAthleteId: null,
      // Cadena que llegó por la red y no está en la unión.
      capability: 'clase_inventada' as never,
      now: NOW,
      entitlement: row('advanced'),
    })

    expect(decision.allowed).toBe(false)
    expect(decision.requiredTier).toBeNull()
    expect(decision.limit).toBeNull()
  })
})
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run src/services/entitlements/__tests__/resolveCapability.test.ts`
Expected: FAIL con "Failed to resolve import ../resolveCapability".

- [ ] **Step 3: Escribir el módulo**

Crear `src/services/entitlements/resolveCapability.ts`:

```ts
import type { AIRequestClass } from '../../types'
import {
  isClassAllowed,
  minTierForClass,
  resolveTier,
  type EntitlementRow,
  type Tier,
} from './entitlementPolicy'
import { bucketForClass, bucketLimitForTier } from './quotaBuckets'

/**
 * Punto único de resolución de acceso a una capacidad de IA. Módulo puro: lo
 * importan tanto las Netlify Functions como el cliente, igual que
 * `entitlementPolicy.ts`. No agregar acá lecturas de red, Dexie ni React.
 *
 * `targetAthleteId` se acepta y se IGNORA en esta versión. Existe para que el
 * Proyecto 2 —producto Coach, relación coach-atleta y delegación de cuota—
 * sea un cambio en el cuerpo de esta función y no una cacería de tiers por
 * toda la aplicación. Ver §10.1 del spec para la regla destino.
 */
export interface ResolveCapabilityInput {
  /** SIEMPRE derivado del JWT en servidor. Nunca aceptado desde el cliente. */
  actorUserId: string
  targetAthleteId: string | null
  capability: AIRequestClass
  now: number
  entitlement: EntitlementRow | null
}

export interface CapabilityDecision {
  allowed: boolean
  tier: Tier
  /** `null` = clase desconocida. El llamador la trata como denegación. */
  requiredTier: Tier | null
  /** Quién aporta la capacidad. Proyecto 2 agrega 'coach' | 'delegated'. */
  entitlementSource: 'self'
  entitlementOwnerUserId: string
  /** Contra quién se contabiliza la cuota. */
  quotaOwnerUserId: string
  /** Bucket a incrementar. `null` si la clase no está permitida. */
  quotaBucketId: string | null
  /**
   * Unidades de cuota que consume esta llamada. Hoy siempre 1, porque la cuota
   * cuenta intentos del proveedor y cada llamada es un intento. Existe desde
   * ahora para que la ponderación por producto (`week = 1`, `pair = 2`, §8 del
   * spec) se resuelva acá y no en el llamador.
   */
  consumptionUnits: number
  /** `null` = clase no permitida. NUNCA 0. */
  limit: number | null
}

export function resolveCapability(input: ResolveCapabilityInput): CapabilityDecision {
  const tier = resolveTier(input.entitlement, input.now)
  const requiredTier = minTierForClass(input.capability)
  const allowed = isClassAllowed(tier, input.capability)

  const bucket = allowed ? bucketForClass(input.capability) : null
  const limit = bucket ? bucketLimitForTier(bucket, tier) : null

  return {
    allowed,
    tier,
    requiredTier,
    entitlementSource: 'self',
    entitlementOwnerUserId: input.actorUserId,
    quotaOwnerUserId: input.actorUserId,
    quotaBucketId: bucket?.id ?? null,
    consumptionUnits: 1,
    limit,
  }
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `npx vitest run src/services/entitlements/__tests__/resolveCapability.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Verificar que el módulo es puro**

Run: `grep -nE "fetch|dexie|react|window|document|import\.meta" src/services/entitlements/resolveCapability.ts`
Expected: sin resultados.

- [ ] **Step 6: Commit (solo si el owner lo pide)**

```bash
git add src/services/entitlements/resolveCapability.ts src/services/entitlements/__tests__/resolveCapability.test.ts
git commit -m "feat(entitlements): resolveCapability con contexto explícito"
```

---

### Task 4: Mover clases de tier y recalcular cuotas

**Files:**
- Modify: `src/services/entitlements/entitlementPolicy.ts:33-44`
- Modify: `src/services/entitlements/quotaBuckets.ts:19-27`
- Test: `src/services/entitlements/__tests__/entitlementPolicy.test.ts:47,50`
- Test: `src/services/entitlements/__tests__/quotaBuckets.test.ts:25-27`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `REQUEST_CLASS_MIN_TIER` con `chat_action: 'weekly'` y
  `week_creator: 'weekly'`; `QUOTA_BUCKETS` con los límites de §7.2 del spec.
  Las tareas 6, 7 y 8 dependen de estos valores.

- [ ] **Step 1: Actualizar los tests existentes que fijan el mapa viejo**

En `src/services/entitlements/__tests__/entitlementPolicy.test.ts`, cambiar las
dos filas de la tabla:

```ts
    chat_action:       { free: false, weekly: true, advanced: true },
```

```ts
    week_creator:      { free: false, weekly: true, advanced: true },
```

En `src/services/entitlements/__tests__/quotaBuckets.test.ts`, reemplazar el
bloque `describe('bucket de chat compartido', ...)` completo:

```ts
describe('bucket de chat compartido', () => {
  it('chat_general y chat_action comparten bucket', () => {
    expect(bucketForClass('chat_general')).toBe(bucketForClass('chat_action'))
  })

  it('free conserva 15 en el bucket por chat_general, aunque no pueda chat_action', () => {
    expect(bucketLimitForTier(bucketForClass('chat_general')!, 'free')).toBe(15)
  })

  it('weekly baja a 40 y advanced conserva 120', () => {
    expect(bucketLimitForTier(bucketForClass('chat_general')!, 'weekly')).toBe(40)
    expect(bucketLimitForTier(bucketForClass('chat_general')!, 'advanced')).toBe(120)
  })
})
```

Y agregar al final del archivo:

```ts
describe('cuotas de Plan Builder llevan holgura de retry', () => {
  // MAX_WEEK_ATTEMPTS = 2, así que un plan de 12 semanas puede necesitar hasta
  // 24 intentos. 16/8 no cubre el peor caso teórico y sí el realista: dos
  // corridas de 42 semanas reportaron cero reintentos (spec §7 (b)).
  it('plan_builder_week tolera cuatro retries sobre un plan de 12 semanas', () => {
    expect(bucketLimitForTier(bucketForClass('plan_builder_week')!, 'advanced')).toBe(16)
  })

  it('plan_builder_pair tolera dos retries sobre seis pares', () => {
    expect(bucketLimitForTier(bucketForClass('plan_builder_pair')!, 'advanced')).toBe(8)
  })
})

describe('week_creator es la capacidad central de Coach Semanal', () => {
  it('weekly puede generar semanas, free no', () => {
    const bucket = bucketForClass('week_creator')!
    expect(bucketLimitForTier(bucket, 'free')).toBeNull()
    expect(bucketLimitForTier(bucket, 'weekly')).toBe(3)
    expect(bucketLimitForTier(bucket, 'advanced')).toBe(8)
  })
})
```

- [ ] **Step 2: Correr los tests y ver que fallan**

Run: `npx vitest run src/services/entitlements/`
Expected: FAIL — `chat_action` free devuelve `true` cuando se espera `false`;
`week_creator` weekly devuelve `false`; el bucket de chat weekly devuelve 120;
`plan_builder_week` advanced devuelve 12.

- [ ] **Step 3: Actualizar `REQUEST_CLASS_MIN_TIER`**

En `src/services/entitlements/entitlementPolicy.ts`, reemplazar el mapa:

```ts
export const REQUEST_CLASS_MIN_TIER: Record<AIRequestClass, Tier> = {
  chat_general: 'free',
  // "Base consulta, pagado modifica": un Free conserva el chat completo con el
  // mismo prompt y el mismo contexto de su clase; lo que pierde es que el
  // coach escriba en su calendario.
  chat_action: 'weekly',
  import_extract: 'free',
  weekly_summary: 'weekly',
  // El plan se llama "Coach Semanal": un plan semanal que no puede crear una
  // semana es una promesa rota en el nombre. La razón original para dejarlo en
  // `advanced` —no degradarlo a sesiones locales— sigue valiendo para Free, que
  // no lo recibe; Weekly recibe la versión real, no una degradada.
  week_creator: 'weekly',
  plan_builder_week: 'advanced',
  plan_builder_pair: 'advanced',
  // Deuda declarada (spec §4.3): es el Asistente del Coach Workspace, o sea
  // producto Coach. Se queda acá solo hasta que exista el rol `coach_workspace`.
  coach_assistant_message: 'advanced',
}
```

- [ ] **Step 4: Actualizar `QUOTA_BUCKETS`**

En `src/services/entitlements/quotaBuckets.ts`, reemplazar el literal:

```ts
/**
 * Un bucket agrupa clases que comparten contador. Sólo el chat lo necesita; los
 * demás son buckets de una clase.
 *
 * ATENCIÓN: estos límites cuentan INTENTOS DEL PROVEEDOR, no acciones de
 * producto. `assertUsageGate` se llama inmediatamente antes de cada llamada
 * real, así que un retry o un fallback consumen otra unidad, y un `pair`
 * produce dos semanas con una sola unidad. Nunca traducir estos números a
 * "mensajes" o "semanas" en copy visible. Ver §7 del spec.
 *
 * Provisionales hasta que cierre la Fase 0 (línea base de costo real).
 */
export const QUOTA_BUCKETS: readonly QuotaBucket[] = [
  { id: 'chat', classes: ['chat_general', 'chat_action'], limits: { free: 15, weekly: 40, advanced: 120 } },
  { id: 'import', classes: ['import_extract'], limits: { free: 3, weekly: 10, advanced: 10 } },
  { id: 'weekly_summary', classes: ['weekly_summary'], limits: { weekly: 5, advanced: 10 } },
  { id: 'week_creator', classes: ['week_creator'], limits: { weekly: 3, advanced: 8 } },
  // 16 y 8 llevan holgura de retry: con límite igual al largo del plan, la
  // semana 13 —que puede ser el segundo intento de la semana 4— rompería un
  // plan de 12 semanas.
  { id: 'plan_builder_week', classes: ['plan_builder_week'], limits: { advanced: 16 } },
  { id: 'plan_builder_pair', classes: ['plan_builder_pair'], limits: { advanced: 8 } },
  { id: 'coach_assistant', classes: ['coach_assistant_message'], limits: { advanced: 20 } },
]
```

- [ ] **Step 5: Correr toda la suite y arreglar el resto de la cascada**

Run: `npm test`
Expected: pueden fallar tests fuera de `entitlements/` que asumían el mapa
viejo — revisar en particular
`src/components/chat/__tests__/QuickActionChips.entitlement.test.tsx` y
`src/store/__tests__/`. Cada fallo se arregla actualizando la **expectativa**
del test al mapa nuevo, nunca relajando el gate.

- [ ] **Step 6: Commit (solo si el owner lo pide)**

```bash
git add src/services/entitlements src/components/chat/__tests__ src/store/__tests__
git commit -m "feat(entitlements): week_creator y chat_action desde weekly, cuotas recalculadas"
```

---

### Task 5: Spend cap por tier

**Files:**
- Modify: `src/services/entitlements/spendCapPolicy.ts`
- Modify: `netlify/functions/_shared/usageGate.ts:198`
- Test: `src/services/entitlements/__tests__/spendCapPolicy.test.ts`

**Interfaces:**
- Consumes: `Tier` de `entitlementPolicy.ts`.
- Produces: `ACCOUNT_DAILY_SPEND_CAP_USD_BY_TIER: Record<Tier, number>`,
  `resolveAccountDailySpendCapUsd(tier: Tier): number` y
  `evaluateSpendCaps(spend: SpendSnapshot, tier: Tier): SpendCapCheckResult`
  — **la firma de `evaluateSpendCaps` gana un segundo parámetro obligatorio.**

- [ ] **Step 1: Escribir el test que falla**

Reemplazar el primer `it` de
`src/services/entitlements/__tests__/spendCapPolicy.test.ts` y agregar el bloque
nuevo. El archivo empieza así:

```ts
import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_DAILY_SPEND_CAP_USD_BY_TIER,
  GLOBAL_DAILY_SPEND_CAP_USD,
  evaluateSpendCaps,
  resolveAccountDailySpendCapUsd,
} from '../spendCapPolicy'

describe('spendCapPolicy', () => {
  it('los montos por tier son los aprobados en el spec', () => {
    expect(ACCOUNT_DAILY_SPEND_CAP_USD_BY_TIER).toEqual({
      free: 0.3,
      weekly: 0.8,
      advanced: 3,
    })
    expect(GLOBAL_DAILY_SPEND_CAP_USD).toBe(5)
  })

  it('un free gasta menos antes de que dispare el breaker que un advanced', () => {
    expect(evaluateSpendCaps({ accountCostUsd: 0.5, globalCostUsd: 0 }, 'free'))
      .toEqual({ exceeded: true, scope: 'account', capUsd: 0.3 })
    expect(evaluateSpendCaps({ accountCostUsd: 0.5, globalCostUsd: 0 }, 'advanced'))
      .toEqual({ exceeded: false })
  })

  it('el cap exacto ya cuenta como alcanzado, en cada tier', () => {
    expect(evaluateSpendCaps({ accountCostUsd: 0.8, globalCostUsd: 0 }, 'weekly'))
      .toEqual({ exceeded: true, scope: 'account', capUsd: 0.8 })
  })

  it('el cap de cuenta se evalúa antes que el global', () => {
    expect(evaluateSpendCaps({ accountCostUsd: 3, globalCostUsd: 5 }, 'advanced'))
      .toEqual({ exceeded: true, scope: 'account', capUsd: 3 })
  })

  it('el global sigue siendo único para todos los tiers', () => {
    expect(evaluateSpendCaps({ accountCostUsd: 0.1, globalCostUsd: 5 }, 'free'))
      .toEqual({ exceeded: true, scope: 'global', capUsd: 5 })
  })

  it('un tier fuera de la unión cae al cap más restrictivo', () => {
    expect(resolveAccountDailySpendCapUsd('inventado' as never)).toBe(0.3)
  })
})
```

Los `it` restantes del archivo original que llamaban `evaluateSpendCaps` con un
solo argumento deben recibir `'advanced'` como segundo argumento para conservar
sus valores esperados de 3 y 5.

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run src/services/entitlements/__tests__/spendCapPolicy.test.ts`
Expected: FAIL con "does not provide an export named
'ACCOUNT_DAILY_SPEND_CAP_USD_BY_TIER'".

- [ ] **Step 3: Reescribir `spendCapPolicy.ts`**

```ts
import type { Tier } from './entitlementPolicy'

/**
 * Política pura del circuit breaker de gasto. Sin I/O, sin Dexie, sin React —
 * la importan tanto el gate server-side (netlify/functions/_shared/usageGate.ts)
 * como cualquier superficie de cliente que quiera mostrar el mismo número.
 *
 * Los montos son constantes versionadas, no env vars: Netlify captura config
 * por deploy, así que un env var no da ajuste real "en caliente" sin de todas
 * formas desplegar. Un cambio de monto queda auditable en el commit.
 *
 * QUÉ NO ES ESTO (spec §9.1): un breaker ADICIONAL, con overshoot y cobertura
 * incompleta. El costo se registra después de una respuesta exitosa y es
 * best-effort —un intento con timeout o con modelo sin precio no suma nada— y
 * varias requests concurrentes pueden leer todas un total bajo el cap. No es
 * un tope de pérdida y no reemplaza una cuota por unidad de producto.
 */
export const ACCOUNT_DAILY_SPEND_CAP_USD_BY_TIER: Record<Tier, number> = {
  free: 0.3,
  weekly: 0.8,
  advanced: 3,
}

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
 * Fail-closed: un tier que no está en la unión —una cadena que llegó por la
 * red— cae al cap más restrictivo, nunca al más permisivo.
 */
export function resolveAccountDailySpendCapUsd(tier: Tier): number {
  return ACCOUNT_DAILY_SPEND_CAP_USD_BY_TIER[tier]
    ?? ACCOUNT_DAILY_SPEND_CAP_USD_BY_TIER.free
}

/**
 * El cap por cuenta se evalúa antes que el global: es más específico y más
 * accionable para quien lo dispara. Ambos usan `>=`, no `>`: el cap es un
 * techo, no un piso — llegar exactamente a él ya cuenta como alcanzado.
 */
export function evaluateSpendCaps(spend: SpendSnapshot, tier: Tier): SpendCapCheckResult {
  const accountCap = resolveAccountDailySpendCapUsd(tier)
  if (spend.accountCostUsd >= accountCap) {
    return { exceeded: true, scope: 'account', capUsd: accountCap }
  }
  if (spend.globalCostUsd >= GLOBAL_DAILY_SPEND_CAP_USD) {
    return { exceeded: true, scope: 'global', capUsd: GLOBAL_DAILY_SPEND_CAP_USD }
  }
  return { exceeded: false }
}
```

- [ ] **Step 4: Pasar el tier en el gate**

En `netlify/functions/_shared/usageGate.ts`, dentro de `evaluateGatePreamble`,
cambiar la línea de evaluación:

```ts
  const capCheck = evaluateSpendCaps(spend, input.tier)
```

`UsageGateInput` ya tiene `tier`, así que no hace falta cambiar su firma ni la
de ningún llamador.

- [ ] **Step 5: Verificar que no quedó ningún llamador viejo**

Run: `grep -rn "evaluateSpendCaps\|ACCOUNT_DAILY_SPEND_CAP_USD\b" src netlify --include="*.ts" --include="*.tsx"`
Expected: ninguna referencia al símbolo viejo `ACCOUNT_DAILY_SPEND_CAP_USD` y
todas las llamadas a `evaluateSpendCaps` con dos argumentos.

- [ ] **Step 6: Correr typecheck y la suite**

Run: `npx tsc -b && npx vitest run src/services/entitlements/ netlify/functions/_shared/`
Expected: PASS. Si `tsc` reporta un llamador con un solo argumento, arreglarlo
—ese es exactamente el valor de haber hecho el parámetro obligatorio.

- [ ] **Step 7: Commit (solo si el owner lo pide)**

```bash
git add src/services/entitlements/spendCapPolicy.ts src/services/entitlements/__tests__/spendCapPolicy.test.ts netlify/functions/_shared/usageGate.ts
git commit -m "feat(entitlements): spend cap por tier"
```

---

### Task 6: Cablear `resolveCapability` en el servidor

**Files:**
- Modify: `netlify/functions/_shared/resolveEntitlement.ts:105-116`
- Modify: `netlify/functions/coach.ts:1918`
- Test: `netlify/functions/_shared/__tests__/resolveEntitlementCapability.test.ts` (crear)

**Interfaces:**
- Consumes: `resolveCapability`, `CapabilityDecision` de la Task 3.
- Produces: `assertPlanGenerationEntitlement(tier: Tier, actorUserId: string): void`
  — **gana un segundo parámetro obligatorio**. Los dos llamadores
  (`enqueue-plan-generation.ts:93`, `generate-plan-background.ts:206`) deben
  pasar el id de usuario que ya tienen autenticado.

El comportamiento observable **no cambia**: mismos 403, mismo `errorCode`, mismo
`detail`. Lo que cambia es que la decisión sale de un punto único con contexto.

- [ ] **Step 1: Escribir el test que falla**

Crear `netlify/functions/_shared/__tests__/resolveEntitlementCapability.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { assertPlanGenerationEntitlement } from '../resolveEntitlement'

describe('assertPlanGenerationEntitlement', () => {
  it('advanced pasa sin lanzar', () => {
    expect(() => assertPlanGenerationEntitlement('advanced', 'user-1')).not.toThrow()
  })

  it('weekly es rechazado con 403 entitlement_required', () => {
    try {
      assertPlanGenerationEntitlement('weekly', 'user-1')
      throw new Error('debió lanzar')
    } catch (error) {
      const typed = error as { statusCode?: number; errorCode?: string; detail?: unknown }
      expect(typed.statusCode).toBe(403)
      expect(typed.errorCode).toBe('entitlement_required')
      expect(typed.detail).toMatchObject({ requiredTier: 'advanced', currentTier: 'weekly' })
    }
  })

  it('free es rechazado igual que weekly', () => {
    expect(() => assertPlanGenerationEntitlement('free', 'user-1')).toThrow()
  })
})
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run netlify/functions/_shared/__tests__/resolveEntitlementCapability.test.ts`
Expected: FAIL de TypeScript por el segundo argumento, o fallo en tiempo de
ejecución si la firma vieja lo ignora.

- [ ] **Step 3: Reescribir `assertPlanGenerationEntitlement`**

En `netlify/functions/_shared/resolveEntitlement.ts`, reemplazar la función y
agregar el import:

```ts
import { resolveCapability } from '../../../src/services/entitlements/resolveCapability'
```

```ts
/**
 * Lanza un error con forma HTTP si el tier no alcanza para generar planes.
 * Compartido por enqueue y worker para que los dos rechacen idéntico.
 *
 * Delega en `resolveCapability` para que exista un solo punto de decisión: el
 * tier ya viene resuelto por `resolveEntitlementTier`, así que se pasa como una
 * fila sin vencimiento y `resolveCapability` no lo vuelve a expirar.
 */
export function assertPlanGenerationEntitlement(tier: Tier, actorUserId: string): void {
  const decision = resolveCapability({
    actorUserId,
    targetAthleteId: null,
    capability: PLAN_GENERATION_REQUEST_CLASS,
    now: Date.now(),
    entitlement: { tier, expiresAt: null },
  })
  if (decision.allowed) return

  const requiredTier = decision.requiredTier ?? 'advanced'
  const detail = buildEntitlementDetail(PLAN_GENERATION_REQUEST_CLASS, requiredTier, decision.tier)
  const error = new Error(formatEntitlementMessage(detail)) as EntitlementHttpError
  error.statusCode = 403
  error.errorCode = 'entitlement_required'
  error.detail = detail
  throw error
}
```

- [ ] **Step 4: Actualizar los dos llamadores**

En los tres archivos la identidad verificada ya existe como `auth.userId`
—verificado en `enqueue-plan-generation.ts:104`, `generate-plan-background.ts:330`
y `coach.ts:1911`—. **No introducir un id nuevo ni leerlo del body:**
`actorUserId` se deriva siempre del JWT verificado.

En `netlify/functions/enqueue-plan-generation.ts:93`:

```ts
    if (gateEnabled) assertPlanGenerationEntitlement(gateTier, auth.userId)
```

En `netlify/functions/generate-plan-background.ts:206`:

```ts
        assertPlanGenerationEntitlement(gateTier, auth.userId)
```

- [ ] **Step 5: Cablear el gate de clase de `coach.ts`**

En `netlify/functions/coach.ts:1918`, reemplazar el predicado por la decisión:

```ts
      const capabilityDecision = resolveCapability({
        actorUserId: auth.userId,
        targetAthleteId: null,
        capability: gateClass,
        now: Date.now(),
        entitlement: { tier: currentTier, expiresAt: null },
      })
      if (!capabilityDecision.allowed) {
```

Agregar el import correspondiente y **quitar** `isClassAllowed` del import de
`entitlementPolicy` si ya no queda ningún uso en el archivo. El cuerpo del `if`
no cambia: sigue construyendo el mismo 403.

- [ ] **Step 6: Verificar typecheck y suite completa**

Run: `npx tsc -b && npm test`
Expected: PASS. `tsc` es el que garantiza que no quedó un llamador con la firma
vieja.

- [ ] **Step 7: Commit (solo si el owner lo pide)**

```bash
git add netlify/functions
git commit -m "refactor(entitlements): las tres funciones deciden vía resolveCapability"
```

---

### Task 7: Cablear `resolveCapability` en el cliente

**Files:**
- Modify: `src/hooks/useEntitlement.ts:35`
- Test: `src/hooks/__tests__/useEntitlement.test.ts` (crear si no existe)

**Interfaces:**
- Consumes: `resolveCapability`, `CapabilityDecision` de la Task 3.
- Produces: `useEntitlement()` conserva `canUse(requestClass)` y agrega
  `decide(capability): CapabilityDecision`.

**La llamada del cliente es consultiva, no autoritativa.** Decide si mostrar la
oferta antes de gastar una request; el servidor sigue siendo quien rechaza. Por
eso `actorUserId` acá sale de la sesión local y **no** es una autoridad: si el
cliente miente, el servidor lo rechaza igual con su propio JWT.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/hooks/__tests__/useEntitlement.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveCapability } from '../../services/entitlements/resolveCapability'

describe('gate preventivo del cliente', () => {
  it('un free no ve week_creator habilitado', () => {
    const decision = resolveCapability({
      actorUserId: 'local',
      targetAthleteId: null,
      capability: 'week_creator',
      now: Date.now(),
      entitlement: { tier: 'free', expiresAt: null },
    })
    expect(decision.allowed).toBe(false)
    expect(decision.requiredTier).toBe('weekly')
  })

  it('un weekly sí ve week_creator habilitado', () => {
    const decision = resolveCapability({
      actorUserId: 'local',
      targetAthleteId: null,
      capability: 'week_creator',
      now: Date.now(),
      entitlement: { tier: 'weekly', expiresAt: null },
    })
    expect(decision.allowed).toBe(true)
  })

  it('un weekly NO ve plan_builder_week habilitado', () => {
    const decision = resolveCapability({
      actorUserId: 'local',
      targetAthleteId: null,
      capability: 'plan_builder_week',
      now: Date.now(),
      entitlement: { tier: 'weekly', expiresAt: null },
    })
    expect(decision.allowed).toBe(false)
    expect(decision.requiredTier).toBe('advanced')
  })
})
```

- [ ] **Step 2: Correr el test**

Run: `npx vitest run src/hooks/__tests__/useEntitlement.test.ts`
Expected: PASS ya con la Task 4 aplicada — este test fija el contrato de
producto que el cliente muestra, no una implementación nueva. Si falla, la Task 4
está incompleta.

- [ ] **Step 3: Exponer la decisión completa en el hook**

En `src/hooks/useEntitlement.ts`, conservar `canUse` para no romper llamadores y
agregar `decide`:

```ts
    canUse: (requestClass: string) => isClassAllowed(tier, requestClass),
    decide: (capability: AIRequestClass): CapabilityDecision => resolveCapability({
      // Literal a propósito. `useEntitlementStore` no expone identidad y esta
      // llamada es CONSULTIVA: sirve para decidir si mostrar la oferta antes de
      // gastar una request. El servidor decide de nuevo con su propio JWT, y
      // `actorUserId` no participa de la decisión en esta versión. Meter acá un
      // id de sesión daría la impresión falsa de que el cliente autoriza.
      actorUserId: 'local',
      targetAthleteId: null,
      capability,
      now: Date.now(),
      entitlement: { tier, expiresAt: null },
    }),
```

Agregar a `EntitlementView` el campo `decide: (capability: AIRequestClass) =>
CapabilityDecision`, y los imports de `resolveCapability`, `CapabilityDecision`
(desde `../services/entitlements/resolveCapability`) y `AIRequestClass` (desde
`../types`).

- [ ] **Step 4: Correr la suite del cliente**

Run: `npx vitest run src/hooks/ src/store/ src/components/chat/`
Expected: PASS.

- [ ] **Step 5: Commit (solo si el owner lo pide)**

```bash
git add src/hooks
git commit -m "feat(entitlements): el gate preventivo del cliente usa resolveCapability"
```

---

### Task 8: `/pricing` alineado, sin cifras de cuota

**Files:**
- Modify: `src/pages/PricingPage.tsx:491-518` (listas de features)
- Modify: `src/pages/PricingPage.tsx:660-682` (tabla comparativa)

**Interfaces:**
- Consumes: el mapa de tiers de la Task 4. Ningún import nuevo.
- Produces: nada que otra tarea consuma.

**No se publica ninguna cifra de cuota.** Las cuotas cuentan intentos del
proveedor, así que "40 mensajes al día" sería una promesa que el sistema no
cumple (spec §11).

- [ ] **Step 1: Reemplazar las tres listas de features**

```tsx
  const starterFeatures: TierFeature[] = [
    { text: 'Habla con RallyIQ Coach sobre tu entrenamiento' },
    { text: 'Crea y registra entrenamientos multideporte' },
    { text: 'Semana simple con estado de cada sesión' },
    { text: 'Check-in diario de sueño, energía y molestias' },
    { text: 'Conecta Whoop y mira tu readiness' },
    { text: 'Tu historial completo y tu análisis de carga' },
    { text: 'Funciona sin conexión y sincroniza después' },
    { text: 'El coach aplica cambios en tu calendario', dim: true },
    { text: 'Semana completa generada por IA', dim: true },
    { text: 'Plan Builder por objetivo', dim: true },
  ]

  const proFeatures: TierFeature[] = [
    { text: 'El coach aplica cambios directo en tu calendario' },
    { text: 'Una semana completa generada por IA cuando la necesitas' },
    { text: 'Squash, running, fuerza, movilidad y ciclismo' },
    { text: 'Ajustes por fatiga, sueño, alcohol o molestias' },
    { text: 'Resúmenes semanales y notas accionables' },
    { text: 'Plan Builder por objetivo', dim: true },
  ]

  const eliteFeatures: TierFeature[] = [
    { text: 'Todo lo del plan Coach Semanal' },
    { text: 'Plan Builder por carrera, torneo o bloque' },
    { text: 'Periodización por fases: base, build, peak y taper' },
    { text: 'Reparación automática de semanas incoherentes' },
    { text: 'Historial de ciclos y cierre de bloque' },
    { text: 'Soporte prioritario para preparar objetivos' },
  ]
```

- [ ] **Step 2: Reemplazar el cuerpo de la tabla comparativa**

```tsx
                <tr className="section-row"><td colSpan={4}>Planificación</td></tr>
                <tr><td>Crear y registrar entrenamientos</td><td><span className="chk">✓</span></td><td className="pro"><span className="chk brand">✓</span></td><td><span className="chk">✓</span></td></tr>
                <tr><td>El coach aplica cambios en tu calendario</td><td className="dash">—</td><td className="pro"><span className="chk brand">✓</span></td><td><span className="chk">✓</span></td></tr>
                <tr><td>Semana completa generada por IA</td><td className="dash">—</td><td className="pro"><span className="chk brand">✓</span></td><td><span className="chk">✓</span></td></tr>
                <tr><td>Plan Builder por objetivo</td><td className="dash">—</td><td className="dash">—</td><td><span className="chk">✓</span></td></tr>
                <tr><td>Consultar un plan ya creado</td><td><span className="chk">✓</span></td><td className="pro"><span className="chk brand">✓</span></td><td><span className="chk">✓</span></td></tr>
                <tr><td>Deportes soportados</td><td>5</td><td className="pro">5</td><td>5</td></tr>

                <tr className="section-row"><td colSpan={4}>RallyIQ AI</td></tr>
                <tr><td>Chat con contexto de tu semana</td><td><span className="chk">✓</span></td><td className="pro"><span className="chk brand">✓</span></td><td><span className="chk">✓</span></td></tr>
                <tr><td>Notas semanales del coach</td><td className="dash">—</td><td className="pro"><span className="chk brand">✓</span></td><td><span className="chk">✓</span></td></tr>
                <tr><td>Razonamiento transparente</td><td><span className="chk">✓</span></td><td className="pro"><span className="chk brand">✓</span></td><td><span className="chk">✓</span></td></tr>

                <tr className="section-row"><td colSpan={4}>Tus datos</td></tr>
                <tr><td>Historial</td><td>Completo</td><td className="pro">Completo</td><td>Completo</td></tr>
                <tr><td>ACWR, strain, monotonía</td><td><span className="chk">✓</span></td><td className="pro"><span className="chk brand">✓</span></td><td><span className="chk">✓</span></td></tr>
                <tr><td>Whoop: readiness y entrenamientos</td><td><span className="chk">✓</span></td><td className="pro"><span className="chk brand">✓</span></td><td><span className="chk">✓</span></td></tr>
                <tr><td>Respaldo y exportación</td><td><span className="chk">✓</span></td><td className="pro"><span className="chk brand">✓</span></td><td><span className="chk">✓</span></td></tr>

                <tr className="section-row"><td colSpan={4}>Colaboración & soporte</td></tr>
                <tr><td>Configuración inicial acompañada</td><td className="dash">—</td><td className="pro">Beta</td><td>Beta</td></tr>
                <tr><td>Soporte</td><td>Email</td><td className="pro">Email prioritario</td><td>Prioritario</td></tr>
```

- [ ] **Step 3: Agregar la nota de uso justo bajo la tabla**

Inmediatamente después del `</table>`, dentro de `.compare-shell`:

```tsx
            <p style={{ fontSize: '12px', color: INK_FAINT, marginTop: '16px', lineHeight: 1.6 }}>
              Todos los planes tienen límites diarios de uso justo en las funciones con IA,
              para que el servicio siga siendo estable para todos. Durante la beta cerrada los
              ajustamos con uso real; si alcanzas un límite, te lo decimos en el momento.
            </p>
```

- [ ] **Step 4: Verificar que no quedó ninguna cifra de cuota**

Run: `grep -nE "[0-9]+ (mensajes|semanas|solicitudes|requests) (al |por )?d[ií]a" src/pages/PricingPage.tsx`
Expected: sin resultados.

- [ ] **Step 5: Verificar que la afirmación de historial ya no miente**

Run: `grep -n "30 días" src/pages/PricingPage.tsx`
Expected: sin resultados.

- [ ] **Step 6: Correr lint, tests y build**

Run: `npm run lint && npm test && npm run build`
Expected: PASS en los tres.

- [ ] **Step 7: Commit (solo si el owner lo pide)**

```bash
git add src/pages/PricingPage.tsx
git commit -m "docs(pricing): alinear la página con lo que el código aplica"
```

---

### Task 9: Verificación final y guion de rollout

**Files:**
- Create: `docs/superpowers/smokes/2026-09-01-athlete-tiers-rollout.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: el guion que el owner ejecuta contra producción.

- [ ] **Step 1: Gate local completo**

Run: `npm run lint && npm test && npx tsc -b && npm run build && git diff --check`
Expected: los cinco verdes. Registrar el conteo de archivos y tests.

- [ ] **Step 2: Escribir el guion de rollout**

Crear `docs/superpowers/smokes/2026-09-01-athlete-tiers-rollout.md` con estos
pasos, en este orden, y espacio para registrar el resultado observado de cada uno.

**Paso 0 — verificar el estado real antes de tocar nada.** En el contexto
Production de Netlify, confirmar `ENTITLEMENTS_ENABLED=true`,
`AI_USAGE_LIMITS_ENABLED=true`, `AI_KILL_SWITCH_ENABLED=false` y
`VITE_ENTITLEMENTS` **apagada**. Si alguno no coincide, **detenerse**: el resto
del rollout supone servidor gateando.

**Paso 0b — revisar el padrón.** Antes de desplegar, listar quién queda afectado
por el cambio de `chat_action`:

```sql
select u.id, u.email, e.tier, e.expires_at
from auth.users u
left join public.user_entitlements e on e.user_id = u.id
order by u.created_at;
```

Cualquier cuenta en `free` distinta del owner pierde las propuestas aplicables
al desplegar y hay que avisarle.

**Paso 1 — desplegar con `VITE_ENTITLEMENTS` todavía apagada.** El servidor
aplica el corte nuevo; la UI todavía no tiene gate preventivo.

**Paso 2 — smoke `free`** (el owner ya está en `free`): `chat_general` responde;
`chat_action` —pedir un ajuste concreto de una sesión— da 403
`entitlement_required` con oferta, no un error técnico; "crear semana" da 403;
`/competition-plan` muestra el plan existente en solo lectura.

**Paso 3 — smoke `weekly`:**

```sql
update public.user_entitlements
set tier = 'weekly'
where user_id = '<OWNER_UUID>' and tier = 'free'
returning user_id, tier, expires_at, source, updated_at;
```

Refrescar la sesión. Verificar: `chat_action` aplica el cambio al calendario;
"crear semana" genera una semana real; Plan Builder da 403 con oferta de
Avanzado.

**Paso 4 — smoke `advanced`:** volver el tier con el mismo `update` guardado por
`and tier = 'weekly'`, y confirmar que Plan Builder genera.

**Paso 5 — encender `VITE_ENTITLEMENTS`** y **redesplegar**: Netlify fija las
variables al publicar, así que un cambio de variable no surte efecto sin
redeploy. Verificar que un `free` ve la oferta *antes* de gastar una request.

**Paso 6 — publicar `/pricing`.**

- [ ] **Step 3: Registrar los pendientes que este plan NO cierra**

Al final del guion, dejar escrito:

1. **Fase 0 (Task 1) sigue siendo el bloqueante para congelar números.** Mientras
   no esté cerrada, las cuotas y los caps son provisionales.
2. `coach_assistant_message` sigue mal clasificado como capacidad de atleta
   Advanced; migra al rol `coach_workspace` en Proyecto 2.
3. Las cuotas siguen contando intentos del proveedor. La cuota por unidad de
   producto —bucket mensual de semanas ponderadas, `week = 1`, `pair = 2`— es
   requisito antes de self-serve, no antes del piloto.
4. `GLOBAL_DAILY_SPEND_CAP_USD` sigue en US$5, dimensionado para 1–3 personas.
   Revisar antes de pasar a 10–20 cuentas.

- [ ] **Step 4: Commit (solo si el owner lo pide)**

```bash
git add docs/superpowers/smokes/2026-09-01-athlete-tiers-rollout.md
git commit -m "docs: guion de rollout de la separación de planes"
```

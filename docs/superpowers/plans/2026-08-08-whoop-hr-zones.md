# Whoop — zonas de frecuencia cardíaca por entrenamiento: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persistir las seis duraciones de zona de FC y la cobertura de medición de cada entrenamiento Whoop, y usarlas en la tarjeta de sesión, el bloque objetivo del coach y un resumen semanal.

**Architecture:** Un normalizador puro compartido (`whoopZoneDurations.ts`) es la única autoridad de forma: los tres bordes que deserializan —normalizador del servidor, pull del cliente, parser de import— solo adaptan nombres y delegan la decisión. La identidad de "zona alta" y de "cobertura" vive en `workoutMetrics.ts`, que ya es la autoridad única de elegibilidad de ritmo. Los milisegundos son la unidad de autoridad y cada superficie convierte una sola vez, en su borde de presentación. Un flag de servidor `WHOOP_ZONES_ENABLED` controla **la ingestión** y nada más.

**Tech Stack:** TypeScript, React 18, Vite, Tailwind, Dexie (sin cambio de versión), Supabase (migración `019`), Netlify Functions, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-07-whoop-hr-zones-design.md`. Cuando este plan y el spec discrepen, gana el spec — pero reportalo antes de seguir.

## Global Constraints

- **Sin Dexie v20.** `zoneDurations` y `percentRecorded` no se indexan, así que `stores()` no cambia. Si algún paso te empuja a tocar `db.ts`, pará: es señal de que el diseño se desvió.
- **Versión de backup: sigue en 4.** Los campos nuevos son opcionales y compatibles en ambos sentidos.
- **Los commits los hace el owner.** Regla del proyecto (`CLAUDE.md`): no ejecutar `git commit` ni `git add`. Cada tarea termina en un checkpoint que deja el árbol limpio y verificado, con la lista exacta de archivos y un mensaje sugerido.
- **Zona alta = Z4 + Z5.** Una sola declaración, en `src/services/readiness/workoutMetrics.ts`. Ninguna superficie recalcula la definición.
- **`LOW_HR_CAPTURE_NOTICE_THRESHOLD = 90`.** Umbral **visual y solo visual**: no descarta zonas, no excluye entrenamientos, no altera ningún agregado.
- **Milisegundos crudos en el modelo; conversión una sola vez al presentar.** Filas de detalle en `m:ss` (redondeo al segundo); titulares en minutos, redondeados **desde los milisegundos crudos**, nunca desde los segundos ya redondeados.
- **Separador decimal:** punto en el bloque del coach (`toFixed(1)`, formato existente); coma en la UI en español.
- **El flag es de ingestión, no de visibilidad.** Apagado no oculta zonas ya persistidas ni impide que un backup las traiga. Apagado, el upsert **omite** las siete claves — nunca las escribe como `null`.
- **La ingestión pertenece siempre al self de la cuenta autenticada; las superficies leen por atleta activo.** **No** agregar guards self-only a las tres superficies de la Entrega 2 —tarjeta de sesión, `DayDetail`, bloque del coach— por las dos razones de spec §2.1. La tarjeta semanal es distinta: es nueva y su spec (§7.3) sí pide `activeAthleteId === selfAthleteId`, porque ahí el chequeo evita una consulta garantizadamente vacía en vez de recortar algo ya visible.
- Copy de la app en español, tuteo. No prometer diagnóstico, prevención de lesiones ni ajuste automático.
- **`@testing-library/jest-dom` NO está instalado** (`vitest.setup.ts` solo carga `fake-indexeddb/auto`). Usá `.toBeTruthy()` / `.toBeNull()` / `.getAttribute()` / `.textContent`, como el resto de los tests de componentes del proyecto. No agregues la dependencia para esta entrega.
- Antes de cerrar cada tarea: `npm run lint` y `npx tsc --noEmit` verdes sobre lo tocado.

---

## Estructura de archivos

**Se crean:**

| Archivo | Responsabilidad |
|---|---|
| `supabase/019_whoop_workout_zones.sql` | Siete columnas + cinco `CHECK` sobre `whoop_workouts` |
| `netlify/functions/_shared/whoopZonesFlag.ts` | Lee `WHOOP_ZONES_ENABLED` del entorno del servidor |
| `src/services/readiness/whoopZoneDurations.ts` | Normalizador puro compartido: única autoridad de forma |
| `src/components/session/HrZoneDistribution.tsx` | Barra apilada + desplegable de seis filas, para la tarjeta |
| `src/services/readiness/weeklyHrZones.ts` | Agregador puro por día y por zona para la semana |
| `src/components/week/WeeklyHrZonesCard.tsx` | Tarjeta del resumen semanal |
| `src/services/legal/publications/whoop_biometric.2026-08-08.ts` | Publicación nueva, registrada y **no vigente** |
| `src/services/legal/publications/privacy.2026-08-08.ts` | Publicación nueva, registrada y **no vigente** |

**Se modifican:**

| Archivo | Cambio |
|---|---|
| `src/types/index.ts:501-517` | `WhoopZoneDurations` + dos campos opcionales en `WhoopWorkout` |
| `netlify/functions/_shared/whoopSupabase.ts:63-75, 294-316` | `WorkoutRow` gana los campos; `upsertWorkouts` omite o escribe según el flag |
| `netlify/functions/_shared/whoopNormalize.ts:245-276` | `normalizeWorkouts` delega en el normalizador compartido |
| `src/services/readiness/pullWorkouts.ts:40-63, 91` | `toWhoopWorkout` delega; el `SELECT` pide las siete columnas |
| `src/services/dataExport.ts:1130-1150` | `parseWhoopWorkout` delega (drop silencioso, no throw) |
| `src/services/readiness/workoutMetrics.ts` | `resolveHighZoneDurationMs`, `resolveHrCaptureState`, labels de zona |
| `src/components/session/WhoopWorkoutMetrics.tsx` | `flex-wrap` → grilla; métrica `Zona alta`; monta la distribución |
| `src/services/ai/whoopWorkoutContext.ts:44-77` | Segmento de zona alta + cobertura; guardia ampliada |
| `src/pages/WeeklyView.tsx:365-390` | Monta `WeeklyHrZonesCard` en la columna "Resumen semanal" |
| `src/services/legal/consentDocuments.ts` | Registra las dos publicaciones nuevas sin cambiar `currentVersion` |
| `src/services/legal/__tests__/legalPublicationIntegrity.test.ts:30-35` | Dos tripletas nuevas en `FROZEN_PUBLICATIONS` |
| `docs/legal/descargo-whoop.md`, `docs/legal/politica-de-privacidad.md` | Espejos Markdown |

---

## Task 0 (owner, fuera del plan de código): orden de rollout

No es una tarea de implementación. Está acá porque **el orden importa** y el spec §3.5 lo fija:

0. Preflight: confirmar `CONSENT_GATE_ENABLED=true` y `VITE_CONSENT_GATE=true`.
1. Aplicar `019` en producción. Columnas vacías, nada cambia.
2. Deploy 1: código de zonas + publicaciones registradas **no vigentes**, con `WHOOP_ZONES_ENABLED=false`.
3. Aprobación jurídica del paquete de dos publicaciones.
4. Deploy 2: cambiar ambos `currentVersion`. **Consecuencia esperada:** la sincronización de Whoop se detiene para quien no reacepte.
5. Reaceptación: `privacy` para todas las cuentas, `whoop_biometric` solo con Whoop conectado.
6. Deploy 3: `WHOOP_ZONES_ENABLED=true`.

`019` **antes** del primer deploy de código: `pullWorkouts.ts:91` hace un `SELECT` con lista explícita de columnas y pedir columnas inexistentes devuelve 400 en cada pull. Netlify captura las env vars de Functions por deploy: cambiar el flag exige un deploy nuevo.

---

## Task 1: Tipos y normalizador compartido

Es la base de todo lo demás: los tres bordes de la Task 3/4/5 delegan acá.

**Files:**
- Modify: `src/types/index.ts:501-517`
- Create: `src/services/readiness/whoopZoneDurations.ts`
- Test: `src/services/readiness/__tests__/whoopZoneDurations.test.ts`

**Interfaces:**
- Consumes: `WhoopWorkout` de `src/types`.
- Produces:
  - `interface WhoopZoneDurations { z0: number; z1: number; z2: number; z3: number; z4: number; z5: number }` (milisegundos)
  - `WhoopWorkout.zoneDurations?: WhoopZoneDurations`, `WhoopWorkout.percentRecorded?: number`
  - `normalizeWorkoutScoreData(input: { scoreState: unknown; zones: { z0: unknown; z1: unknown; z2: unknown; z3: unknown; z4: unknown; z5: unknown }; percentRecorded: unknown }): { zoneDurations?: WhoopZoneDurations; percentRecorded?: number }`
  - `WHOOP_WORKOUT_ZONE_COLUMNS: readonly string[]` — los siete nombres de columna de `019`. Vive **acá**, en un módulo puro de `src/`, y no en `netlify/`: lo consumen el `SELECT` del cliente (Task 4), el payload del upsert del servidor (Task 3) y el guard de la migración (Task 2). Si viviera bajo `netlify/`, el cliente no podría importarlo sin arrastrar código de Functions al bundle, y quedaría una segunda lista literal fuera del alcance de cualquier guard. La dirección `netlify/` → `src/` ya es la establecida en este plan (`normalizeWorkoutScoreData`).

- [ ] **Step 1: Agregar los tipos**

En `src/types/index.ts`, justo antes de `export interface WhoopWorkout` (línea 501):

```ts
/**
 * Milisegundos por zona de FC, tal como los publica Whoop en
 * `score.zone_durations`. Objeto opcional con seis campos REQUERIDOS: el
 * todo-o-nada deja de ser una convención que hay que recordar en cada consumidor
 * y pasa a ser una garantía del tipo. No existe forma de representar una
 * distribución parcial.
 */
export interface WhoopZoneDurations {
  z0: number
  z1: number
  z2: number
  z3: number
  z4: number
  z5: number
}
```

Y dentro de `WhoopWorkout`, entre `scoreState` y `updatedAt`:

```ts
  zoneDurations?: WhoopZoneDurations
  /** `score.percent_recorded`: float 0-100. Independiente de `zoneDurations`. */
  percentRecorded?: number
```

- [ ] **Step 2: Escribir los tests del normalizador**

Crear `src/services/readiness/__tests__/whoopZoneDurations.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeWorkoutScoreData } from '../whoopZoneDurations'

function zones(values: Partial<Record<'z0' | 'z1' | 'z2' | 'z3' | 'z4' | 'z5', unknown>> = {}) {
  return { z0: 1000, z1: 2000, z2: 3000, z3: 4000, z4: 5000, z5: 6000, ...values }
}

describe('normalizeWorkoutScoreData', () => {
  it('acepta una distribución completa con score SCORED', () => {
    expect(normalizeWorkoutScoreData({
      scoreState: 'SCORED',
      zones: zones(),
      percentRecorded: 98.5,
    })).toEqual({
      zoneDurations: { z0: 1000, z1: 2000, z2: 3000, z3: 4000, z4: 5000, z5: 6000 },
      percentRecorded: 98.5,
    })
  })

  it('descarta AMBOS campos si el estado no es SCORED', () => {
    for (const scoreState of ['PENDING_SCORE', 'UNSCORABLE', 'algo', undefined, null]) {
      expect(normalizeWorkoutScoreData({
        scoreState,
        zones: zones(),
        percentRecorded: 98.5,
      })).toEqual({})
    }
  })

  it('descarta la distribución completa si falta cualquier clave', () => {
    const result = normalizeWorkoutScoreData({
      scoreState: 'SCORED',
      zones: zones({ z3: undefined }),
      percentRecorded: 98.5,
    })
    expect(result.zoneDurations).toBeUndefined()
    expect(result.percentRecorded).toBe(98.5)
  })

  it('descarta la distribución si alguna zona no es un entero seguro', () => {
    for (const bad of [1.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 2, '1000', null]) {
      expect(normalizeWorkoutScoreData({
        scoreState: 'SCORED',
        zones: zones({ z2: bad }),
        percentRecorded: 50,
      }).zoneDurations).toBeUndefined()
    }
  })

  it('descarta la distribución si alguna zona es negativa', () => {
    expect(normalizeWorkoutScoreData({
      scoreState: 'SCORED',
      zones: zones({ z1: -1 }),
      percentRecorded: 50,
    }).zoneDurations).toBeUndefined()
  })

  it('descarta la distribución si las seis suman cero', () => {
    expect(normalizeWorkoutScoreData({
      scoreState: 'SCORED',
      zones: { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 },
      percentRecorded: 50,
    }).zoneDurations).toBeUndefined()
  })

  it('acepta ceros mientras la suma sea positiva', () => {
    expect(normalizeWorkoutScoreData({
      scoreState: 'SCORED',
      zones: { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 1 },
      percentRecorded: 50,
    }).zoneDurations).toEqual({ z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 1 })
  })

  it('valida percentRecorded por separado: finito y entre 0 y 100', () => {
    for (const bad of [-0.1, 100.1, Number.NaN, Infinity, '50', null, undefined]) {
      const result = normalizeWorkoutScoreData({
        scoreState: 'SCORED',
        zones: zones(),
        percentRecorded: bad,
      })
      expect(result.percentRecorded).toBeUndefined()
      expect(result.zoneDurations).toBeDefined()
    }
    for (const ok of [0, 100, 89.96]) {
      expect(normalizeWorkoutScoreData({
        scoreState: 'SCORED',
        zones: zones(),
        percentRecorded: ok,
      }).percentRecorded).toBe(ok)
    }
  })

  it('descartar la distribución no descarta la cobertura', () => {
    expect(normalizeWorkoutScoreData({
      scoreState: 'SCORED',
      zones: zones({ z0: -1 }),
      percentRecorded: 72.4,
    })).toEqual({ percentRecorded: 72.4 })
  })
})
```

- [ ] **Step 3: Correr los tests y confirmar que fallan**

Run: `npx vitest run src/services/readiness/__tests__/whoopZoneDurations.test.ts`
Expected: FAIL — `Failed to resolve import "../whoopZoneDurations"`.

- [ ] **Step 4: Implementar el normalizador**

Crear `src/services/readiness/whoopZoneDurations.ts`:

```ts
import type { WhoopZoneDurations } from '../../types'

const ZONE_KEYS = ['z0', 'z1', 'z2', 'z3', 'z4', 'z5'] as const

type ZoneKey = (typeof ZONE_KEYS)[number]

/**
 * Fuente única de la lista de columnas de `019`. La consumen el `SELECT` del
 * cliente, el payload del upsert del servidor y el guard de la migración.
 *
 * Vive en `src/` y no en `netlify/` para que el cliente pueda importarla sin
 * arrastrar código de Functions al bundle: si hubiera dos listas —una server-side
 * y un literal en el cliente— el guard cubriría solo una y ampliar la migración
 * sin tocar el `SELECT` pasaría inadvertido hasta un 400 en producción.
 *
 * El orden es el de la migración y el guard compara conjuntos ordenados, así que
 * agregar acá y no en el `.sql` (o al revés) rompe en CI.
 */
export const WHOOP_WORKOUT_ZONE_COLUMNS = [
  'zone_zero_milli',
  'zone_one_milli',
  'zone_two_milli',
  'zone_three_milli',
  'zone_four_milli',
  'zone_five_milli',
  'percent_recorded',
] as const

export interface WorkoutScoreDataInput {
  scoreState: unknown
  zones: Record<ZoneKey, unknown>
  percentRecorded: unknown
}

export interface WorkoutScoreData {
  zoneDurations?: WhoopZoneDurations
  percentRecorded?: number
}

/**
 * Única autoridad de forma de la distribución de zonas y de la cobertura.
 *
 * Recibe `scoreState` a propósito: el CHECK de `019` garantiza «solo con SCORED»
 * en Supabase, pero el tipo `WhoopWorkout` admite cualquier combinación, así que
 * un backup manipulado con `PENDING_SCORE` y seis zonas válidas pasaría un
 * normalizador que no mira el estado y quedaría en Dexie, donde ninguna
 * restricción lo alcanza.
 *
 * Los tres bordes que deserializan —normalizador del servidor, pull del cliente,
 * parser de import— SOLO adaptan nombres y delegan acá. Ninguno valida a mano;
 * misma doctrina que `normalizeSupersetGroups`.
 */
export function normalizeWorkoutScoreData(input: WorkoutScoreDataInput): WorkoutScoreData {
  if (input.scoreState !== 'SCORED') return {}

  return {
    ...(resolveZoneDurations(input.zones) ?? {}),
    ...(resolvePercentRecorded(input.percentRecorded) ?? {}),
  }
}

function resolveZoneDurations(
  zones: Record<ZoneKey, unknown>,
): { zoneDurations: WhoopZoneDurations } | null {
  const resolved = {} as WhoopZoneDurations
  let total = 0

  for (const key of ZONE_KEYS) {
    const value = zones[key]
    // Entero seguro, no solo número finito: el origen y la columna son int64
    // (`integer/int64` en el OpenAPI de Whoop, `bigint` en Supabase), así que un
    // 1.5 produciría un objeto válido en Dexie e incompatible con la base a la
    // que después se sincroniza.
    if (!Number.isSafeInteger(value)) return null
    const milli = value as number
    if (milli < 0) return null
    resolved[key] = milli
    total += milli
  }

  // Seis ceros son sintácticamente válidos y no describen nada. No equivalen a
  // un entrenamiento en reposo —eso sería z0 con la duración completa— sino a
  // uno del que no se midió ninguna zona.
  if (total <= 0) return null

  return { zoneDurations: resolved }
}

function resolvePercentRecorded(value: unknown): { percentRecorded: number } | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value < 0 || value > 100) return null
  return { percentRecorded: value }
}
```

- [ ] **Step 5: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/services/readiness/__tests__/whoopZoneDurations.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Verificar tipos y lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores.

- [ ] **Step 7: Checkpoint para el owner**

Archivos listos: `src/types/index.ts`, `src/services/readiness/whoopZoneDurations.ts`, `src/services/readiness/__tests__/whoopZoneDurations.test.ts`.
Mensaje sugerido: `feat(whoop): add shared HR zone normalizer and types`.

---

## Task 2: Migración `019` y su guard de columnas

**Files:**
- Create: `supabase/019_whoop_workout_zones.sql`
- Test: `netlify/functions/_shared/__tests__/whoopWorkoutZoneSchema.test.ts`

**Interfaces:**
- Consumes: `WHOOP_WORKOUT_ZONE_COLUMNS` (Task 1).
- Produces: el guard de drift entre el `.sql` y esa constante. No exporta nada nuevo.

> **Qué cubre y qué no.** Este guard cierra un solo eje: `.sql` ↔ constante. Que eso alcance depende de que la constante sea de verdad la **única** lista, y por eso la Task 3 y la Task 4 la **consumen** en vez de repetir literales. Los dos guards que cierran los ejes restantes —payload del upsert y `SELECT` del cliente— viven en sus propias tareas (Task 3 Step 5, Task 4 Step 2). Sin los tres, la migración y la constante podrían crecer juntas mientras el cliente o el upsert quedan atrás, y la suite seguiría verde.

- [ ] **Step 1: Escribir la migración**

Crear `supabase/019_whoop_workout_zones.sql`:

```sql
-- Distribución de tiempo por zona de frecuencia cardíaca y cobertura de
-- medición, por entrenamiento. Extiende `whoop_workouts` (012); no crea tablas
-- ni cambia RLS.
--
-- APLICAR ANTES del primer deploy del código: `pullWorkouts` hace un SELECT con
-- lista explícita de columnas y pedir columnas inexistentes devuelve 400.
--
-- Las cinco restricciones se agregan SIN `not valid`: todas las filas
-- existentes tienen las siete columnas en null, así que satisfacen la rama nula
-- y la validación inmediata no puede fallar.

alter table public.whoop_workouts
  add column if not exists zone_zero_milli  bigint null,
  add column if not exists zone_one_milli   bigint null,
  add column if not exists zone_two_milli   bigint null,
  add column if not exists zone_three_milli bigint null,
  add column if not exists zone_four_milli  bigint null,
  add column if not exists zone_five_milli  bigint null,
  add column if not exists percent_recorded numeric null;

-- 1. Todo o nada: las seis columnas de zona son todas nulas o todas presentes.
alter table public.whoop_workouts
  add constraint whoop_workouts_zones_all_or_none check (
    (zone_zero_milli is null and zone_one_milli is null and zone_two_milli is null
      and zone_three_milli is null and zone_four_milli is null and zone_five_milli is null)
    or
    (zone_zero_milli is not null and zone_one_milli is not null and zone_two_milli is not null
      and zone_three_milli is not null and zone_four_milli is not null and zone_five_milli is not null)
  );

-- 2. No negatividad.
alter table public.whoop_workouts
  add constraint whoop_workouts_zones_non_negative check (
    coalesce(zone_zero_milli, 0) >= 0 and coalesce(zone_one_milli, 0) >= 0
    and coalesce(zone_two_milli, 0) >= 0 and coalesce(zone_three_milli, 0) >= 0
    and coalesce(zone_four_milli, 0) >= 0 and coalesce(zone_five_milli, 0) >= 0
  );

-- 3. Suma positiva: una distribución de seis ceros no describe nada.
alter table public.whoop_workouts
  add constraint whoop_workouts_zones_positive_total check (
    zone_zero_milli is null
    or (zone_zero_milli + zone_one_milli + zone_two_milli
        + zone_three_milli + zone_four_milli + zone_five_milli) > 0
  );

-- 4. Rango de cobertura.
alter table public.whoop_workouts
  add constraint whoop_workouts_percent_recorded_range check (
    percent_recorded is null or (percent_recorded >= 0 and percent_recorded <= 100)
  );

-- 5. Solo con score: el contrato oficial dice que `WorkoutScore` solo existe
--    cuando el entrenamiento está SCORED.
alter table public.whoop_workouts
  add constraint whoop_workouts_score_data_requires_scored check (
    score_state = 'SCORED'
    or (zone_zero_milli is null and percent_recorded is null)
  );
```

- [ ] **Step 2: Escribir el guard de drift de columnas**

Este test es lo único que puede correr en CI contra una migración de aplicación manual: fija que la lista de columnas que el código usa es exactamente la que `019` crea, en ambas direcciones.

Crear `netlify/functions/_shared/__tests__/whoopWorkoutZoneSchema.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { WHOOP_WORKOUT_ZONE_COLUMNS } from '../../../../src/services/readiness/whoopZoneDurations'

const MIGRATION = readFileSync(
  new URL('../../../../supabase/019_whoop_workout_zones.sql', import.meta.url),
  'utf8',
)

/**
 * Las aserciones corren sobre el SQL SIN comentarios. El encabezado de `019`
 * explica por qué las restricciones se agregan «SIN `not valid`», así que
 * buscar esa cadena en el archivo crudo la encontraría en la prosa que
 * documenta justamente su ausencia: el guard se rompería a sí mismo.
 */
const SQL = MIGRATION.replace(/--[^\n]*/g, '')

describe('019_whoop_workout_zones', () => {
  it('crea exactamente las columnas que el código usa', () => {
    const created = [...SQL.matchAll(/add column if not exists\s+(\w+)/g)]
      .map((match) => match[1])
      .sort()
    expect(created).toEqual([...WHOOP_WORKOUT_ZONE_COLUMNS].sort())
  })

  it('declara las cinco restricciones nombradas', () => {
    for (const name of [
      'whoop_workouts_zones_all_or_none',
      'whoop_workouts_zones_non_negative',
      'whoop_workouts_zones_positive_total',
      'whoop_workouts_percent_recorded_range',
      'whoop_workouts_score_data_requires_scored',
    ]) {
      expect(SQL).toContain(`add constraint ${name}`)
    }
  })

  it('no usa `not valid`: la validación inmediata no puede fallar', () => {
    expect(SQL.toLowerCase()).not.toContain('not valid')
  })
})
```

`019` sí tiene un literal de texto —`'SCORED'`, en la quinta restricción—, pero ninguno contiene `--`, que es la condición que esta regex necesita: recorta desde `--` hasta el fin de línea sin distinguir contexto, así que un literal con guiones dobles adentro quedaría truncado. Si algún día apareciera uno, habría que acotar la búsqueda a las sentencias `alter table`.

- [ ] **Step 3: Correr el test y confirmar que pasa**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopWorkoutZoneSchema.test.ts`
Expected: PASS, 3 tests — la constante ya existe desde la Task 1 y la migración se acaba de escribir. Si falla, el `.sql` y la constante divergen: ese es exactamente el drift que el guard existe para atrapar.

Para confirmar que el guard no es vacuo, agregá temporalmente una octava columna a `WHOOP_WORKOUT_ZONE_COLUMNS`, corré el test, verificá que **falla**, y revertila.

- [ ] **Step 4: Checkpoint para el owner**

Archivos: `supabase/019_whoop_workout_zones.sql`, `netlify/functions/_shared/__tests__/whoopWorkoutZoneSchema.test.ts`.
Mensaje sugerido: `feat(whoop): add 019 HR zone columns and schema drift guard`.
**Recordarle al owner:** `019` se aplica a mano y **antes** del primer deploy que incluya la Task 4.

---

## Task 3: Servidor — normalización, flag e ingestión

**Files:**
- Create: `netlify/functions/_shared/whoopZonesFlag.ts`
- Modify: `netlify/functions/_shared/whoopNormalize.ts:245-276`
- Modify: `netlify/functions/_shared/whoopSupabase.ts:63-75, 294-316`
- Test: `netlify/functions/_shared/__tests__/whoopNormalize.test.ts` (extender **y corregir** el test exacto de línea 448)
- Test: `netlify/functions/_shared/__tests__/whoopSupabase.test.ts` (extender **y corregir** el fixture de línea 299)
- Test: `netlify/functions/_shared/__tests__/whoopSync.test.ts` (**corregir** el fixture `rows` de línea 129)

**Interfaces:**
- Consumes: `normalizeWorkoutScoreData` y `WHOOP_WORKOUT_ZONE_COLUMNS` (Task 1).

> **Esta tarea rompe tres tests existentes y hay que arreglarlos, no descubrirlos.** `WorkoutRow` gana dos campos **requeridos**, así que los tres únicos fixtures literales del repo (`whoopNormalize.test.ts:459`, `whoopSupabase.test.ts:311`, `whoopSync.test.ts:141` — los tres localizables con `grep -rn "scoreState: 'SCORED'" netlify`) dejan de compilar hasta agregarles `zoneDurations: null, percentRecorded: null`. Además el primero compara con `toEqual` contra un objeto literal completo, así que **también** falla en runtime hasta enumerar los dos campos nuevos.
- Produces:
  - `areWhoopZonesEnabled(): boolean`
  - `WorkoutRow` gana `zoneDurations: WhoopZoneDurations | null` y `percentRecorded: number | null`.

- [ ] **Step 1: Escribir los tests del normalizador del servidor**

Agregar a `netlify/functions/_shared/__tests__/whoopNormalize.test.ts`:

El archivo ya tiene `emptyRaw` (línea 431) y `makeRawWorkout` (línea 433): reusá **los dos**. `normalizeWorkouts` recibe un `WhoopRaw` completo —`recovery`, `sleep`, `cycles` y `workouts` son todos requeridos (`whoopClient.ts:19-25`)— así que un objeto con solo `workouts` no compila.

```ts
describe('normalizeWorkouts — zonas de FC', () => {
  function rawWorkout(score: Record<string, unknown> | null) {
    return {
      ...emptyRaw,
      workouts: [makeRawWorkout({
        score_state: score ? 'SCORED' : 'PENDING_SCORE',
        score: score ?? undefined,
      })],
    }
  }

  const FULL_ZONES = {
    zone_zero_milli: 60_000,
    zone_one_milli: 120_000,
    zone_two_milli: 600_000,
    zone_three_milli: 900_000,
    zone_four_milli: 700_000,
    zone_five_milli: 200_000,
  }

  it('extrae las seis zonas y la cobertura de un workout SCORED', () => {
    const [row] = normalizeWorkouts(rawWorkout({
      strain: 12.4,
      zone_durations: FULL_ZONES,
      percent_recorded: 98.5,
    }))
    expect(row.zoneDurations).toEqual({
      z0: 60_000, z1: 120_000, z2: 600_000, z3: 900_000, z4: 700_000, z5: 200_000,
    })
    expect(row.percentRecorded).toBe(98.5)
  })

  it('deja ambos en null cuando el workout no está SCORED', () => {
    const [row] = normalizeWorkouts(rawWorkout(null))
    expect(row.zoneDurations).toBeNull()
    expect(row.percentRecorded).toBeNull()
  })

  it('deja ambos en null cuando el score no trae zone_durations', () => {
    const [row] = normalizeWorkouts(rawWorkout({ strain: 12.4 }))
    expect(row.zoneDurations).toBeNull()
    expect(row.percentRecorded).toBeNull()
  })

  it('descarta la distribución inválida sin descartar el workout', () => {
    const [row] = normalizeWorkouts(rawWorkout({
      zone_durations: { ...FULL_ZONES, zone_two_milli: -1 },
      percent_recorded: 72.4,
    }))
    expect(row.workoutId).toBe('w-1')
    expect(row.zoneDurations).toBeNull()
    expect(row.percentRecorded).toBe(72.4)
  })
})
```

En el mismo paso, corregí el test exacto preexistente (línea 448, `normalizes a scored workout with duration and local date`): compara con `toEqual` contra un objeto literal, así que hay que enumerar los dos campos nuevos después de `scoreState`:

```ts
      scoreState: 'SCORED',
      zoneDurations: null,
      percentRecorded: null,
```

Ese fixture no trae `zone_durations`, así que `null` es el valor correcto y el test sigue siendo exacto. **No** lo cambies a `toMatchObject`: la exactitud es justamente lo que hace que un campo nuevo no entre sin que nadie lo mire.

- [ ] **Step 2: Correr y confirmar que fallan**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopNormalize.test.ts -t "zonas de FC"`
Expected: FAIL — `row.zoneDurations` es `undefined`, no `null`. El test exacto de línea 448 también falla hasta el Step 3.

- [ ] **Step 3: Extender `WorkoutRow` y `normalizeWorkouts`**

En `netlify/functions/_shared/whoopSupabase.ts`, dentro de `export interface WorkoutRow` (línea 63), después de `scoreState`:

```ts
  zoneDurations: WhoopZoneDurations | null
  percentRecorded: number | null
```

Agregar arriba del archivo: `import type { WhoopZoneDurations } from '../../../src/types'`.

Los dos campos son **requeridos** a propósito: `null` explícito obliga a cada productor a decidir, mientras que opcionales dejarían pasar en silencio un camino que se olvidó de poblarlos. El precio es que los tres fixtures literales del repo dejan de compilar; arreglalos ahora, en este mismo paso, agregándoles:

```ts
    zoneDurations: null,
    percentRecorded: null,
```

- `netlify/functions/_shared/__tests__/whoopSupabase.test.ts:311` (dentro de `upserts snake_case workout rows keyed by workout_id`).
- `netlify/functions/_shared/__tests__/whoopSync.test.ts:141` (el array `rows` de `persists and authoritatively reconciles a successful workout collection`).
- `netlify/functions/_shared/__tests__/whoopNormalize.test.ts:459` ya quedó cubierto en el Step 1.

En `netlify/functions/_shared/whoopNormalize.ts`, agregar el import:

```ts
import { normalizeWorkoutScoreData } from '../../../src/services/readiness/whoopZoneDurations'
```

y dentro del loop de `normalizeWorkouts`, después de `const score = ...` (línea ~260):

```ts
    const rawZones = asObject(score.zone_durations)
    const scoreData = normalizeWorkoutScoreData({
      scoreState,
      zones: {
        z0: rawZones.zone_zero_milli,
        z1: rawZones.zone_one_milli,
        z2: rawZones.zone_two_milli,
        z3: rawZones.zone_three_milli,
        z4: rawZones.zone_four_milli,
        z5: rawZones.zone_five_milli,
      },
      percentRecorded: score.percent_recorded,
    })
```

y en el objeto que va a `rows.push`, después de `scoreState`:

```ts
      zoneDurations: scoreData.zoneDurations ?? null,
      percentRecorded: scoreData.percentRecorded ?? null,
```

- [ ] **Step 4: Correr y confirmar que pasan**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopNormalize.test.ts`
Expected: PASS, incluidos los tests preexistentes.

- [ ] **Step 5: Escribir los tests del flag en el upsert**

Agregar a `netlify/functions/_shared/__tests__/whoopSupabase.test.ts`. El archivo hoy importa `beforeEach, describe, expect, it` de Vitest y solo **valores** de `../whoopSupabase` (línea 1-14), así que este bloque necesita tres imports que todavía no están:

```ts
// Sumar `afterEach` al import de vitest que ya existe en la línea 1.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Sumar los dos tipos al import de whoopSupabase que ya existe en la línea 3.
import { /* …los valores que ya estaban… */ type WhoopDb, type WorkoutRow } from '../whoopSupabase'
import { WHOOP_WORKOUT_ZONE_COLUMNS } from '../../../../src/services/readiness/whoopZoneDurations'

describe('upsertWorkouts — flag de ingestión de zonas', () => {
  // `WhoopDb` (whoopSupabase.ts:3) y `WorkoutRow` (:63) están exportados. El
  // prefijo `type` no es opcional: `tsconfig.node.json` tiene
  // `verbatimModuleSyntax: true` y su `include` abarca `netlify/functions`, así
  // que estos tests sí entran al typecheck.
  const ROW: WorkoutRow = {
    workoutId: 'w1',
    date: '2026-08-04',
    sportName: 'squash',
    startAt: '2026-08-04T10:00:00.000Z',
    endAt: '2026-08-04T11:00:00.000Z',
    durationMin: 60,
    strain: 12.4,
    avgHr: 142,
    maxHr: 181,
    distanceM: null,
    scoreState: 'SCORED',
    zoneDurations: { z0: 1, z1: 2, z2: 3, z3: 4, z4: 5, z5: 6 },
    percentRecorded: 98.5,
  }

  afterEach(() => { delete process.env['WHOOP_ZONES_ENABLED'] })

  it('con el flag apagado OMITE las siete claves, no las escribe como null', async () => {
    delete process.env['WHOOP_ZONES_ENABLED']
    const { db, captured } = makeCapturingDb()
    await upsertWorkouts(db, 'user-1', 'ath-1', [ROW])
    const payload = captured.upsert[0][0]
    for (const column of WHOOP_WORKOUT_ZONE_COLUMNS) {
      expect(Object.hasOwn(payload, column)).toBe(false)
    }
    expect(payload.strain).toBe(12.4)
  })

  it('con el flag encendido escribe las siete columnas', async () => {
    process.env['WHOOP_ZONES_ENABLED'] = 'true'
    const { db, captured } = makeCapturingDb()
    await upsertWorkouts(db, 'user-1', 'ath-1', [ROW])
    const payload = captured.upsert[0][0]
    // Segundo eje del guard de drift: el payload se construye a mano, así que
    // recorrer la constante —en vez de enumerar claves literales— es lo que hace
    // que agregar una columna a `019` sin agregarla al upsert rompa en CI.
    for (const column of WHOOP_WORKOUT_ZONE_COLUMNS) {
      expect(Object.hasOwn(payload, column)).toBe(true)
    }
    expect(payload).toMatchObject({
      zone_zero_milli: 1,
      zone_one_milli: 2,
      zone_two_milli: 3,
      zone_three_milli: 4,
      zone_four_milli: 5,
      zone_five_milli: 6,
      percent_recorded: 98.5,
    })
  })

  it('con el flag encendido y sin zonas escribe null en las siete', async () => {
    process.env['WHOOP_ZONES_ENABLED'] = 'true'
    const { db, captured } = makeCapturingDb()
    await upsertWorkouts(db, 'user-1', 'ath-1', [
      { ...ROW, zoneDurations: null, percentRecorded: null },
    ])
    const payload = captured.upsert[0][0]
    for (const column of WHOOP_WORKOUT_ZONE_COLUMNS) {
      expect(payload[column]).toBeNull()
    }
  })
})
```

`makeCapturingDb` es un helper local: si el archivo ya tiene uno equivalente, reusalo; si no, agregalo con esta forma exacta:

```ts
type CapturedRow = Record<string, unknown>

function makeCapturingDb() {
  // Tipado como `Record<string, unknown>[][]` y no `unknown[][]`: los tres tests
  // hacen `Object.hasOwn(payload, column)` y `payload[column]`, y ninguna de las
  // dos cosas compila sobre `unknown`.
  const captured: { upsert: CapturedRow[][] } = { upsert: [] }
  const db = {
    from: () => ({
      upsert: (payload: unknown) => {
        captured.upsert.push(payload as CapturedRow[])
        return Promise.resolve({ error: null })
      },
    }),
  } as unknown as WhoopDb
  return { db, captured }
}
```

- [ ] **Step 6: Correr y confirmar que fallan**

Run: `npx vitest run netlify/functions/_shared/__tests__/whoopSupabase.test.ts -t "flag de ingestión"`
Expected: FAIL — el payload no tiene las columnas en ningún caso.

- [ ] **Step 7: Implementar el flag y el upsert condicional**

Crear `netlify/functions/_shared/whoopZonesFlag.ts`:

```ts
/**
 * Flag de INGESTIÓN, no de visibilidad. El contrato es «no incorporar zonas
 * nuevas desde Whoop», y nada más: apagado no oculta zonas ya persistidas, no
 * impide que un backup importado las traiga y no apaga las superficies.
 *
 * Netlify captura las variables de entorno de Functions POR DEPLOY: cambiar el
 * valor no basta, hay que crear un deploy nuevo.
 */
export function areWhoopZonesEnabled(): boolean {
  return process.env['WHOOP_ZONES_ENABLED'] === 'true'
}
```

En `netlify/functions/_shared/whoopSupabase.ts`, importar `areWhoopZonesEnabled` y reemplazar el `payload` de `upsertWorkouts` (líneas 300-315) por:

```ts
  const zonesEnabled = areWhoopZonesEnabled()
  const payload = rows.map((row) => ({
    workout_id: row.workoutId,
    user_id: userId,
    athlete_id: athleteId,
    date: row.date,
    sport_name: row.sportName,
    start_at: row.startAt,
    end_at: row.endAt,
    duration_min: row.durationMin,
    strain: row.strain,
    avg_hr: row.avgHr,
    max_hr: row.maxHr,
    distance_m: row.distanceM,
    score_state: row.scoreState,
    updated_at: updatedAt,
    // Las siete claves se OMITEN con el flag apagado en vez de escribirse como
    // null: `upsert` pisa toda clave presente, así que un null borraría zonas ya
    // guardadas y convertiría un flag de ingestión en un destructor de datos.
    ...(zonesEnabled
      ? {
          zone_zero_milli: row.zoneDurations?.z0 ?? null,
          zone_one_milli: row.zoneDurations?.z1 ?? null,
          zone_two_milli: row.zoneDurations?.z2 ?? null,
          zone_three_milli: row.zoneDurations?.z3 ?? null,
          zone_four_milli: row.zoneDurations?.z4 ?? null,
          zone_five_milli: row.zoneDurations?.z5 ?? null,
          percent_recorded: row.percentRecorded,
        }
      : {}),
  }))
```

- [ ] **Step 8: Correr toda la suite del servidor**

Run: `npx vitest run netlify/functions`
Expected: PASS, **incluidos los tres fixtures corregidos** en los Steps 1 y 3. Si alguno sigue rojo por `WorkoutRow` incompleto, quedó uno sin tocar: `grep -rn "scoreState: 'SCORED'" netlify` los enumera todos.

- [ ] **Step 9: Verificar tipos y lint**

Run: `npx tsc --noEmit && npm run lint`

- [ ] **Step 10: Checkpoint para el owner**

Archivos: `netlify/functions/_shared/whoopZonesFlag.ts`, `whoopNormalize.ts`, `whoopSupabase.ts` y **tres** tests — `whoopNormalize.test.ts`, `whoopSupabase.test.ts` y `whoopSync.test.ts`, este último solo por el fixture que `WorkoutRow` dejó incompleto.
Mensaje sugerido: `feat(whoop): ingest HR zones behind WHOOP_ZONES_ENABLED`.

---

## Task 4: Cliente — pull e import

**Files:**
- Modify: `src/services/readiness/pullWorkouts.ts:40-63, 91`
- Modify: `src/services/dataExport.ts:1130-1150`
- Test: `src/services/readiness/__tests__/pullWorkouts.test.ts` (extender)
- Test: `src/services/__tests__/dataExportWhoopZones.test.ts` (crear)

**Interfaces:**
- Consumes: `normalizeWorkoutScoreData` y `WHOOP_WORKOUT_ZONE_COLUMNS` (Task 1).
- Produces: filas de Dexie con `zoneDurations` / `percentRecorded` poblados.

> El `SELECT` del cliente **construye** su lista desde `WHOOP_WORKOUT_ZONE_COLUMNS` en vez de repetirla literal. Por eso la constante vive en `src/` y no en `netlify/`: es la única forma de que el navegador la comparta sin importar código de Functions. Un literal acá sería una tercera lista fuera del alcance de todo guard, y ampliar `019` sin tocarla daría un 400 recién en producción.

- [ ] **Step 1: Capturar el `select` en el mock existente**

`src/services/readiness/__tests__/pullWorkouts.test.ts` ya mockea Supabase (líneas 19-38), pero su `select` descarta el argumento. Agregá arriba, junto a `supabaseRows`:

```ts
let capturedSelect = ''
```

y cambiá la línea `select: () => ({` por:

```ts
      select: (columns: string) => {
        capturedSelect = columns
        return {
```

cerrando el `return` con `}` antes del `},` que cierra `from`. El resto del mock no cambia.

- [ ] **Step 2: Escribir los tests del pull**

Agregar al final de `src/services/readiness/__tests__/pullWorkouts.test.ts`, usando los helpers que ya existen en el archivo (`remoteRow`, `supabaseRows`, `pullWorkouts`, `setActiveAthleteId` / `setSelfAthleteId`):

```ts
import { WHOOP_WORKOUT_ZONE_COLUMNS } from '../whoopZoneDurations'

describe('pullWorkouts — zonas de FC', () => {
  const ZONE_COLUMNS = {
    zone_zero_milli: 1, zone_one_milli: 2, zone_two_milli: 3,
    zone_three_milli: 4, zone_four_milli: 5, zone_five_milli: 6,
  }
  const NULL_ZONE_COLUMNS = {
    zone_zero_milli: null, zone_one_milli: null, zone_two_milli: null,
    zone_three_milli: null, zone_four_milli: null, zone_five_milli: null,
  }

  it('pide las siete columnas nuevas en el SELECT', async () => {
    supabaseRows.length = 0
    await pullWorkouts()
    const selected = capturedSelect.split(',')
    // Tercer eje del guard de drift: recorrer la constante compartida, no una
    // lista escrita a mano acá. Con `019` y la constante ya alineadas por la
    // Task 2, esto cierra el último camino por el que el cliente podía quedarse
    // atrás y pedir de menos.
    for (const column of WHOOP_WORKOUT_ZONE_COLUMNS) {
      expect(selected).toContain(column)
    }
  })

  it('mapea la distribución y la cobertura', async () => {
    supabaseRows.length = 0
    supabaseRows.push(remoteRow({ ...ZONE_COLUMNS, percent_recorded: 98.5 }))
    await pullWorkouts()
    const row = await db.whoopWorkouts.get('whoop:ath_1:w-1')
    expect(row?.zoneDurations).toEqual({ z0: 1, z1: 2, z2: 3, z3: 4, z4: 5, z5: 6 })
    expect(row?.percentRecorded).toBe(98.5)
  })

  it('deja los campos AUSENTES cuando las columnas vienen en null', async () => {
    supabaseRows.length = 0
    supabaseRows.push(remoteRow({ ...NULL_ZONE_COLUMNS, percent_recorded: null }))
    await pullWorkouts()
    const row = await db.whoopWorkouts.get('whoop:ath_1:w-1')
    // Ausentes, no `undefined` explícito: así el round-trip de backup no gana
    // claves vacías.
    expect(Object.hasOwn(row!, 'zoneDurations')).toBe(false)
    expect(Object.hasOwn(row!, 'percentRecorded')).toBe(false)
  })

  it('descarta una distribución inválida sin descartar el workout', async () => {
    supabaseRows.length = 0
    supabaseRows.push(remoteRow({ ...ZONE_COLUMNS, zone_two_milli: -1, percent_recorded: 72.4 }))
    await pullWorkouts()
    const row = await db.whoopWorkouts.get('whoop:ath_1:w-1')
    expect(row?.workoutId).toBe('w-1')
    expect(row?.zoneDurations).toBeUndefined()
    expect(row?.percentRecorded).toBe(72.4)
  })
})
```

El `beforeEach` del archivo ya fija el atleta activo en `ath_1` y limpia Dexie; si no lo hiciera, agregá `setSelfAthleteId('ath_1'); setActiveAthleteId('ath_1')` al principio de cada test.

- [ ] **Step 3: Correr y confirmar que fallan**

Run: `npx vitest run src/services/readiness/__tests__/pullWorkouts.test.ts -t "zonas de FC"`
Expected: FAIL.

- [ ] **Step 4: Extender el pull**

En `src/services/readiness/pullWorkouts.ts`, importar el normalizador y extender el tipo de fila remota con las siete columnas (`number | null`).

Dentro de `toWhoopWorkout`, antes del `return`:

```ts
  const scoreData = normalizeWorkoutScoreData({
    scoreState,
    zones: {
      z0: row.zone_zero_milli,
      z1: row.zone_one_milli,
      z2: row.zone_two_milli,
      z3: row.zone_three_milli,
      z4: row.zone_four_milli,
      z5: row.zone_five_milli,
    },
    percentRecorded: row.percent_recorded,
  })
```

y en el objeto devuelto, después de `scoreState`:

```ts
    ...scoreData,
```

`...scoreData` es deliberado: propaga solo las claves presentes, así que un workout sin zonas conserva los campos **ausentes** en Dexie en vez de `undefined` explícito, y el round-trip de backup no gana claves vacías.

En la línea 91, componer el `SELECT` desde la constante compartida en vez de agregar las siete columnas a mano:

```ts
const BASE_WORKOUT_COLUMNS = 'workout_id,athlete_id,date,sport_name,start_at,end_at,duration_min,strain,avg_hr,max_hr,distance_m,score_state,updated_at'
const WORKOUT_COLUMNS = [BASE_WORKOUT_COLUMNS, ...WHOOP_WORKOUT_ZONE_COLUMNS].join(',')
```

```ts
    .select(WORKOUT_COLUMNS)
```

Importar la constante junto al normalizador: `import { normalizeWorkoutScoreData, WHOOP_WORKOUT_ZONE_COLUMNS } from './whoopZoneDurations'`.

- [ ] **Step 5: Correr y confirmar que pasan**

Run: `npx vitest run src/services/readiness/__tests__/pullWorkouts.test.ts`

- [ ] **Step 6: Escribir los tests del parser de import**

Crear `src/services/__tests__/dataExportWhoopZones.test.ts`:

La API pública es `parseAppDataExport(value: unknown)` (`dataExport.ts:837`), que recibe el **objeto** del backup, no un string, y exige `app: 'RallyIQ' | 'Entrenador'` en el sobre (`normalizeBackupEnvelope`, `dataExport.ts:2225`) — sin ese campo lanza `El archivo no corresponde a un backup de RallyIQ.` antes de mirar ninguna tabla.

```ts
import { describe, it, expect } from 'vitest'
import { parseAppDataExport } from '../dataExport'

function backupWith(workout: Record<string, unknown>) {
  return {
    app: 'RallyIQ',
    version: 4,
    exportedAt: '2026-08-08T00:00:00.000Z',
    exportedFromAppVersion: 'test',
    tables: {
      sessions: [], dayLogs: [], readinessDaily: [], weekSummaries: [],
      trainingPlans: [], trainingPlanWeeks: [], chatMessages: [],
      coachProposals: [], athleteProfiles: [], athletes: [],
      athleteCoachNotes: [], sessionTemplates: [], athleteMemberships: [],
      whoopWorkouts: [{
        id: 'whoop:ath-1:w1', workoutId: 'w1', athleteId: 'ath-1',
        date: '2026-08-04', sportName: 'squash',
        startAt: '2026-08-04T10:00:00.000Z', endAt: '2026-08-04T11:00:00.000Z',
        durationMin: 60, scoreState: 'SCORED', updatedAt: 1,
        ...workout,
      }],
    },
  }
}

function parsedWorkout(workout: Record<string, unknown>) {
  return parseAppDataExport(backupWith(workout)).tables.whoopWorkouts[0]
}

const VALID = { z0: 1000, z1: 2000, z2: 3000, z3: 4000, z4: 5000, z5: 6000 }

describe('parseWhoopWorkout — zonas de FC', () => {
  it('conserva una distribución válida y su cobertura', () => {
    const row = parsedWorkout({ zoneDurations: VALID, percentRecorded: 98.5 })
    expect(row.zoneDurations).toEqual(VALID)
    expect(row.percentRecorded).toBe(98.5)
  })

  it.each([
    ['parcial', { ...VALID, z3: undefined }],
    ['negativa', { ...VALID, z1: -1 }],
    ['vacía', { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 }],
    ['no entera', { ...VALID, z2: 1.5 }],
    // Primitiva: es el caso que distingue `isRecord` de `ensureRecord`. Con
    // `ensureRecord` este test no vería `undefined`, vería una excepción, y el
    // backup entero quedaría rechazado por un campo opcional roto.
    ['primitiva', 5],
    ['string', 'muchas zonas'],
  ])('importa SIN zonas —no falla— una distribución %s', (_label, zoneDurations) => {
    const row = parsedWorkout({ zoneDurations, percentRecorded: 72.4 })
    expect(row.workoutId).toBe('w1')
    expect(row.zoneDurations).toBeUndefined()
    expect(row.percentRecorded).toBe(72.4)
  })

  it.each(['PENDING_SCORE', 'UNSCORABLE'])(
    'descarta AMBOS datos cuando el estado es %s, conservando el entrenamiento',
    (scoreState) => {
      const row = parsedWorkout({ scoreState, zoneDurations: VALID, percentRecorded: 98.5 })
      expect(row.workoutId).toBe('w1')
      expect(row.zoneDurations).toBeUndefined()
      expect(row.percentRecorded).toBeUndefined()
    },
  )

  it('un entrenamiento sin los campos nuevos se importa igual que antes', () => {
    const row = parsedWorkout({})
    expect(row.zoneDurations).toBeUndefined()
    expect(row.percentRecorded).toBeUndefined()
    expect(row.durationMin).toBe(60)
  })
})
```

- [ ] **Step 7: Correr y confirmar que fallan**

Run: `npx vitest run src/services/__tests__/dataExportWhoopZones.test.ts`
Expected: FAIL — el parser descarta los campos porque su allowlist no los enumera.

- [ ] **Step 8: Extender el parser de import**

En `src/services/dataExport.ts`, importar `normalizeWorkoutScoreData` y, dentro de `parseWhoopWorkout` (línea 1130), antes del `return`:

```ts
  // A diferencia del resto del parser, esto NO lanza ante un dato inválido:
  // delega en el normalizador compartido, que descarta en silencio. Un backup
  // con una distribución rota se importa sin zonas en vez de rechazar el
  // archivo entero — y sobre todo, en vez de entrar con zonas falsas.
  //
  // Por eso `isRecord` y no `ensureRecord` (`dataExport.ts:1903`): este último
  // LANZA ante lo que no sea objeto, así que un `zoneDurations: 5` manipulado
  // rechazaría el backup completo y desmentiría el comentario de arriba.
  // `row.zoneDurations ?? {}` tampoco alcanza: cubre null y undefined, no
  // primitivas. `isRecord` acepta arrays, y eso está bien: un `[]` no tiene las
  // seis claves, así que el normalizador lo descarta igual.
  // La anotación es necesaria: sin ella TS infiere `Record<string, unknown> | {}`
  // y `zones.z0` no compila sobre la rama `{}`.
  const zones: Record<string, unknown> = isRecord(row.zoneDurations) ? row.zoneDurations : {}
  const scoreData = normalizeWorkoutScoreData({
    scoreState: row.scoreState,
    zones: { z0: zones.z0, z1: zones.z1, z2: zones.z2, z3: zones.z3, z4: zones.z4, z5: zones.z5 },
    percentRecorded: row.percentRecorded,
  })
```

y en el objeto devuelto, después de `scoreState`:

```ts
    ...scoreData,
```

**Ojo con el orden:** `scoreState` se lee de `row.scoreState` **crudo** acá, mientras que la línea `scoreState: requireEnum(...)` valida el enum. Son consistentes porque `normalizeWorkoutScoreData` compara contra el literal `'SCORED'`: un estado inválido hace fallar `requireEnum` de todos modos.

- [ ] **Step 9: Correr y confirmar que pasan**

Run: `npx vitest run src/services/__tests__/dataExportWhoopZones.test.ts`
Expected: PASS, 10 tests — las cuatro variantes originales del `it.each` más `primitiva` y `string`, los dos estados no `SCORED`, y los dos casos sueltos.

- [ ] **Step 10: Agregar el round-trip real**

Los tests de los Steps 6-9 solo prueban el **parser** contra backups fabricados a mano: nunca ejercitan la exportación, así que no pueden demostrar que las zonas salgan del backup. Un filtro tipo `-t "export"` tampoco lo demuestra —solo corre tests que ya existían y que no saben de zonas—.

Agregar al mismo archivo un round-trip real, con la forma que ya usa `dataExportLibraryRef.test.ts:76`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { exportAppData, parseAppDataExport } from '../dataExport'

describe('round-trip real de zonas de FC', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    db.close()
  })

  it('exportAppData → parseAppDataExport conserva zoneDurations y percentRecorded', async () => {
    await db.whoopWorkouts.put({
      id: 'whoop:ath-1:w1', workoutId: 'w1', athleteId: 'ath-1',
      date: '2026-08-04', sportName: 'squash',
      startAt: '2026-08-04T10:00:00.000Z', endAt: '2026-08-04T11:00:00.000Z',
      durationMin: 60, scoreState: 'SCORED', updatedAt: 1,
      zoneDurations: VALID, percentRecorded: 98.5,
    } as never)

    const { json } = await exportAppData()
    const parsed = parseAppDataExport(JSON.parse(json))

    const imported = parsed.tables.whoopWorkouts.find((row) => row.workoutId === 'w1')
    expect(imported?.zoneDurations).toEqual(VALID)
    expect(imported?.percentRecorded).toBe(98.5)
  })
})
```

Run: `npx vitest run src/services/__tests__/dataExportWhoopZones.test.ts`
Expected: PASS. La exportación usa `db.whoopWorkouts.toArray()` crudo (`dataExport.ts:199`), así que **debería** arrastrar los campos nuevos sin tocar nada; este test es lo que convierte ese «debería» en un hecho verificado. Si falla, la exportación sí necesita cambios.

- [ ] **Step 11: Verificar y checkpoint**

Run: `npx tsc --noEmit && npm run lint`
Archivos: `pullWorkouts.ts`, `dataExport.ts`, `pullWorkouts.test.ts` y `dataExportWhoopZones.test.ts` (parser fabricado + round-trip real).
Mensaje sugerido: `feat(whoop): carry HR zones through pull and backup import`.

---

## Task 5: Autoridades de presentación en `workoutMetrics`

**Files:**
- Modify: `src/services/readiness/workoutMetrics.ts`
- Test: `src/services/readiness/__tests__/workoutMetrics.test.ts` (extender)

**Interfaces:**
- Consumes: `WhoopWorkout.zoneDurations` / `.percentRecorded` (Task 1).
- Produces:
  - `resolveHighZoneDurationMs(workout: WhoopWorkout): number | null`
  - `resolveHrCaptureState(workout: WhoopWorkout): HrCaptureState | null`
  - `type HrCaptureState = { kind: 'unknown' } | { kind: 'full' } | { kind: 'high'; percent: number } | { kind: 'low'; percent: number }`
  - `LOW_HR_CAPTURE_NOTICE_THRESHOLD = 90`
  - `HR_ZONE_KEYS: readonly ['z0','z1','z2','z3','z4','z5']`
  - `HR_ZONE_LABELS: Record<HrZoneKey, string>` (`'Z0'`…`'Z5'`)
  - `HR_ZONE_ACCESSIBLE_LABELS: Record<HrZoneKey, string>` (`'zona 0'`…`'zona 5'`)
  - `formatHrCapturePercent(percent: number, decimalSeparator: '.' | ','): string`

- [ ] **Step 1: Escribir los tests**

Agregar a `src/services/readiness/__tests__/workoutMetrics.test.ts`:

```ts
import {
  resolveHighZoneDurationMs,
  resolveHrCaptureState,
  formatHrCapturePercent,
} from '../workoutMetrics'

const ZONES = { z0: 60_000, z1: 120_000, z2: 600_000, z3: 900_000, z4: 700_000, z5: 200_000 }

describe('resolveHighZoneDurationMs', () => {
  it('suma z4 + z5 en milisegundos, sin redondear', () => {
    expect(resolveHighZoneDurationMs(makeWorkout({ zoneDurations: ZONES }))).toBe(900_000)
  })

  it('devuelve null sin distribución', () => {
    expect(resolveHighZoneDurationMs(makeWorkout())).toBeNull()
  })

  it('devuelve 0 cuando z4 y z5 son cero: cero medido no es ausencia', () => {
    expect(resolveHighZoneDurationMs(
      makeWorkout({ zoneDurations: { ...ZONES, z4: 0, z5: 0 } }),
    )).toBe(0)
  })
})

describe('resolveHrCaptureState', () => {
  it('devuelve null si no hay distribución, aunque haya cobertura', () => {
    expect(resolveHrCaptureState(makeWorkout({ percentRecorded: 72.4 }))).toBeNull()
  })

  it('devuelve unknown con distribución y sin cobertura', () => {
    expect(resolveHrCaptureState(makeWorkout({ zoneDurations: ZONES }))).toEqual({ kind: 'unknown' })
  })

  it.each([
    [100, { kind: 'full' }],
    [100.0, { kind: 'full' }],
    [99.9, { kind: 'high', percent: 99.9 }],
    [90, { kind: 'high', percent: 90 }],
    [89.96, { kind: 'low', percent: 89.96 }],
    [0, { kind: 'low', percent: 0 }],
  ])('clasifica %s con el valor crudo', (percentRecorded, expected) => {
    expect(resolveHrCaptureState(makeWorkout({ zoneDurations: ZONES, percentRecorded })))
      .toEqual(expected)
  })
})

describe('formatHrCapturePercent', () => {
  it('trunca a un decimal en vez de redondear', () => {
    // Redondear 89.96 daría 90,0 junto a un aviso de cobertura baja.
    expect(formatHrCapturePercent(89.96, ',')).toBe('89,9')
  })

  it('respeta el separador pedido', () => {
    expect(formatHrCapturePercent(72.45, '.')).toBe('72.4')
    expect(formatHrCapturePercent(72.45, ',')).toBe('72,4')
  })

  it('no deja decimal colgando en enteros', () => {
    expect(formatHrCapturePercent(90, ',')).toBe('90')
  })
})
```

- [ ] **Step 2: Correr y confirmar que fallan**

Run: `npx vitest run src/services/readiness/__tests__/workoutMetrics.test.ts`
Expected: FAIL — los tres símbolos no existen.

- [ ] **Step 3: Implementar**

Agregar al final de `src/services/readiness/workoutMetrics.ts`:

```ts
export const HR_ZONE_KEYS = ['z0', 'z1', 'z2', 'z3', 'z4', 'z5'] as const

export type HrZoneKey = (typeof HR_ZONE_KEYS)[number]

/** Etiqueta compacta para gráficos y leyendas. */
export const HR_ZONE_LABELS: Record<HrZoneKey, string> = {
  z0: 'Z0', z1: 'Z1', z2: 'Z2', z3: 'Z3', z4: 'Z4', z5: 'Z5',
}

/** Nombre hablado, para texto accesible. Whoop no publica nombres por zona. */
export const HR_ZONE_ACCESSIBLE_LABELS: Record<HrZoneKey, string> = {
  z0: 'zona 0', z1: 'zona 1', z2: 'zona 2',
  z3: 'zona 3', z4: 'zona 4', z5: 'zona 5',
}

/**
 * Zona alta = Z4 + Z5, es decir lo estrictamente por encima de Z3.
 *
 * ÚNICA declaración del proyecto. El precedente es `WINDOW_DAYS` declarado dos
 * veces en la Entrega 2: tres superficies con tres umbrales distintos de «duro»
 * darían tres respuestas a la misma pregunta.
 *
 * Devuelve milisegundos SIN redondear; cada superficie convierte una sola vez,
 * en su borde de presentación.
 */
export function resolveHighZoneDurationMs(workout: WhoopWorkout): number | null {
  const zones = workout.zoneDurations
  if (!zones) return null
  return zones.z4 + zones.z5
}

/** Umbral VISUAL y solo visual: no descarta zonas ni altera ningún agregado. */
export const LOW_HR_CAPTURE_NOTICE_THRESHOLD = 90

export type HrCaptureState =
  | { kind: 'unknown' }
  | { kind: 'full' }
  | { kind: 'high'; percent: number }
  | { kind: 'low'; percent: number }

/**
 * Devuelve `null` cuando no hay distribución, aunque `percentRecorded` esté
 * presente: la cobertura califica un reparto, y sin reparto no califica nada.
 * Si devolviera `unknown` ante la mera ausencia de porcentaje, todo
 * entrenamiento anterior al flag caería en esa rama y el coach le agregaría
 * «cobertura no informada» a algo que ni siquiera tiene distribución.
 */
export function resolveHrCaptureState(workout: WhoopWorkout): HrCaptureState | null {
  if (!workout.zoneDurations) return null

  const percent = workout.percentRecorded
  if (percent == null) return { kind: 'unknown' }
  if (percent >= 100) return { kind: 'full' }
  if (percent >= LOW_HR_CAPTURE_NOTICE_THRESHOLD) return { kind: 'high', percent }
  return { kind: 'low', percent }
}

/**
 * TRUNCA a un decimal; no redondea. El truncamiento es la única operación que
 * preserva la clasificación: redondear 89,96 daría «90,0» junto a un aviso de
 * cobertura baja.
 */
export function formatHrCapturePercent(percent: number, decimalSeparator: '.' | ','): string {
  const truncated = Math.floor(percent * 10) / 10
  return String(truncated).replace('.', decimalSeparator)
}
```

- [ ] **Step 4: Correr y confirmar que pasan**

Run: `npx vitest run src/services/readiness/__tests__/workoutMetrics.test.ts`

- [ ] **Step 5: Verificar y checkpoint**

Run: `npx tsc --noEmit && npm run lint`
Archivos: `workoutMetrics.ts` y su test.
Mensaje sugerido: `feat(whoop): add high-zone and HR capture authorities`.

---

## Task 6: Tarjeta de sesión

**Files:**
- Create: `src/components/session/HrZoneDistribution.tsx`
- Modify: `src/components/session/WhoopWorkoutMetrics.tsx`
- Test: `src/components/session/__tests__/whoopWorkoutMetricsZones.test.tsx`

**Interfaces:**
- Consumes: todo lo de la Task 5.
- Produces: `HrZoneDistribution({ workout }: { workout: WhoopWorkout })`.

- [ ] **Step 1: Escribir los tests**

Crear `src/components/session/__tests__/whoopWorkoutMetricsZones.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WhoopWorkout } from '../../../types'
import WhoopWorkoutMetrics from '../WhoopWorkoutMetrics'

function makeWorkout(overrides: Partial<WhoopWorkout> = {}): WhoopWorkout {
  return {
    id: 'whoop:ath-1:w1', workoutId: 'w1', athleteId: 'ath-1',
    date: '2026-08-04', sportName: 'squash',
    startAt: '2026-08-04T10:00:00.000Z', endAt: '2026-08-04T11:00:00.000Z',
    durationMin: 60, strain: 12.4, avgHr: 142, maxHr: 181,
    scoreState: 'SCORED', updatedAt: 1,
    ...overrides,
  }
}

// 4:29 + 4:29 = 8:58 → el titular dice 9 min. Es el caso que fija que el
// titular se redondea desde los MS crudos y no desde los segundos ya redondeados.
const EDGE_ZONES = { z0: 0, z1: 0, z2: 0, z3: 60_000, z4: 269_000, z5: 269_000 }

describe('WhoopWorkoutMetrics — zonas', () => {
  it('no muestra nada de zonas cuando el workout no las tiene', () => {
    render(<WhoopWorkoutMetrics workout={makeWorkout()} />)
    expect(screen.queryByText(/zona alta/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /distribución/i })).toBeNull()
    // Paridad de contenido con la Entrega 2.
    expect(screen.getByText('12.4')).toBeTruthy()
    expect(screen.getByText('60 min')).toBeTruthy()
    expect(screen.getByText('142 / 181 bpm')).toBeTruthy()
  })

  it('el titular de zona alta se redondea desde los milisegundos crudos', () => {
    render(<WhoopWorkoutMetrics workout={makeWorkout({ zoneDurations: EDGE_ZONES })} />)
    expect(screen.getByText('9 min')).toBeTruthy()
    expect(screen.getByText('Zona alta')).toBeTruthy()
  })

  it('el desplegable es un button con aria-expanded y muestra m:ss por zona', async () => {
    render(<WhoopWorkoutMetrics workout={makeWorkout({ zoneDurations: EDGE_ZONES })} />)
    const toggle = screen.getByRole('button', { name: /distribución/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    await userEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    const rows = screen.getAllByRole('listitem')
    // Orden Z5 → Z0.
    expect(within(rows[0]).getByText('Z5')).toBeTruthy()
    expect(within(rows[0]).getByText('4:29')).toBeTruthy()
    expect(within(rows[5]).getByText('Z0')).toBeTruthy()
    expect(within(rows[5]).getByText('0:00')).toBeTruthy()
  })

  it('cobertura low: aviso visible bajo la barra, truncado', () => {
    render(<WhoopWorkoutMetrics workout={makeWorkout({
      zoneDurations: EDGE_ZONES, percentRecorded: 89.96,
    })} />)
    expect(screen.getByText('Cobertura de medición Whoop: 89,9%')).toBeTruthy()
  })

  it('cobertura full: no dice nada', () => {
    render(<WhoopWorkoutMetrics workout={makeWorkout({
      zoneDurations: EDGE_ZONES, percentRecorded: 100,
    })} />)
    expect(screen.queryByText(/cobertura/i)).toBeNull()
  })

  it.each([
    [92.4, 'Cobertura de medición Whoop: 92,4%'],
    [undefined, 'Cobertura de medición no informada'],
  ])('cobertura %s: dato neutral dentro del desplegable', async (percentRecorded, text) => {
    render(<WhoopWorkoutMetrics workout={makeWorkout({
      zoneDurations: EDGE_ZONES, percentRecorded,
    })} />)
    expect(screen.queryByText(text)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /distribución/i }))
    expect(screen.getByText(text)).toBeTruthy()
  })

  it('la distribución tiene texto accesible sin depender del color', () => {
    render(<WhoopWorkoutMetrics workout={makeWorkout({ zoneDurations: EDGE_ZONES })} />)
    expect(screen.getByRole('img', { name: /zona 5: 4 minutos 29 segundos/i })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Correr y confirmar que fallan**

Run: `npx vitest run src/components/session/__tests__/whoopWorkoutMetricsZones.test.tsx`
Expected: FAIL — el primer test (paridad) pasa; los demás fallan.

- [ ] **Step 3: Escribir el componente de distribución**

Crear `src/components/session/HrZoneDistribution.tsx`:

```tsx
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { WhoopWorkout } from '../../types'
import {
  HR_ZONE_ACCESSIBLE_LABELS,
  HR_ZONE_KEYS,
  HR_ZONE_LABELS,
  formatHrCapturePercent,
  resolveHrCaptureState,
  type HrZoneKey,
} from '../../services/readiness/workoutMetrics'

/** Frío → cálido. Z4/Z5 comparten la familia del titular `Zona alta`. */
const ZONE_COLORS: Record<HrZoneKey, string> = {
  z0: 'bg-white/15',
  z1: 'bg-sky-500/50',
  z2: 'bg-teal-500/55',
  z3: 'bg-amber-500/60',
  z4: 'bg-orange-500/70',
  z5: 'bg-rose-500/75',
}

/** Redondeo al segundo. No es el dato intacto, pero conserva cada minuto entero. */
export function formatZoneDuration(milli: number): string {
  const totalSeconds = Math.round(milli / 1000)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

function accessibleDuration(milli: number): string {
  const totalSeconds = Math.round(milli / 1000)
  return `${Math.floor(totalSeconds / 60)} minutos ${totalSeconds % 60} segundos`
}

export default function HrZoneDistribution({ workout }: { workout: WhoopWorkout }) {
  const [expanded, setExpanded] = useState(false)
  const zones = workout.zoneDurations
  if (!zones) return null

  const total = HR_ZONE_KEYS.reduce((sum, key) => sum + zones[key], 0)
  const capture = resolveHrCaptureState(workout)
  const accessibleSummary = HR_ZONE_KEYS
    .map((key) => `${HR_ZONE_ACCESSIBLE_LABELS[key]}: ${accessibleDuration(zones[key])}`)
    .join(', ')

  return (
    <div className="mt-2">
      {/* La barra es decorativa: `role="img"` + `aria-label` la hacen legible
          sin ver los colores. */}
      <div
        role="img"
        aria-label={accessibleSummary}
        className="flex h-2 overflow-hidden rounded-full bg-white/5"
      >
        {HR_ZONE_KEYS.map((key) => (
          <div
            key={key}
            className={ZONE_COLORS[key]}
            style={{ width: `${(zones[key] / total) * 100}%` }}
          />
        ))}
      </div>

      {capture?.kind === 'low' && (
        <p className="mt-1.5 text-[11px] text-amber-300/80">
          Cobertura de medición Whoop: {formatHrCapturePercent(capture.percent, ',')}%
        </p>
      )}

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="mt-2 flex w-full items-center justify-between border-t border-white/5 pt-2 text-[11px] text-ink-muted transition-colors hover:text-ink"
      >
        <span>Distribución por zona</span>
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {expanded && (
        <>
          <ul className="mt-2 space-y-1">
            {[...HR_ZONE_KEYS].reverse().map((key) => (
              <li key={key} className="flex items-center gap-2">
                <span className="w-6 font-mono text-[11px] text-ink-faint">{HR_ZONE_LABELS[key]}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                  <span
                    className={`block h-full ${ZONE_COLORS[key]}`}
                    style={{ width: `${(zones[key] / total) * 100}%` }}
                  />
                </span>
                <span className="w-10 text-right font-mono text-[11px] tabular-nums text-ink-muted">
                  {formatZoneDuration(zones[key])}
                </span>
              </li>
            ))}
          </ul>
          {capture?.kind === 'high' && (
            <p className="mt-2 text-[11px] text-ink-faint">
              Cobertura de medición Whoop: {formatHrCapturePercent(capture.percent, ',')}%
            </p>
          )}
          {capture?.kind === 'unknown' && (
            <p className="mt-2 text-[11px] text-ink-faint">Cobertura de medición no informada</p>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Cablear la tarjeta**

En `src/components/session/WhoopWorkoutMetrics.tsx`:

1. Importar `HrZoneDistribution` y `resolveHighZoneDurationMs`.
2. Reemplazar `<div className="flex flex-wrap gap-x-4 gap-y-2">` por `<div className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4">`. **La grilla aplica a todas las tarjetas**, con zonas o sin ellas: la alternativa —grilla solo cuando hay zonas— dejaría dos layouts que mantener y una tarjeta que se reacomoda sola cuando Whoop termina de puntuar.
3. Antes del cierre de la grilla, agregar la métrica nueva:

```tsx
        {highZoneMs != null && (
          <div className="min-w-0">
            <p className="font-mono text-sm font-semibold tabular-nums text-orange-300">
              {Math.round(highZoneMs / 60_000)} min
            </p>
            <p className="text-[10px] uppercase tracking-[0.16em] text-orange-300/60">Zona alta</p>
          </div>
        )}
```

con `const highZoneMs = resolveHighZoneDurationMs(workout)` arriba del `return`.

4. Después de la grilla y antes del `notice`, montar `<HrZoneDistribution workout={workout} />`.

- [ ] **Step 5: Correr y confirmar que pasan**

Run: `npx vitest run src/components/session/__tests__/whoopWorkoutMetricsZones.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 6: Confirmar la paridad de contenido contra la Entrega 2**

Run: `npx vitest run src/components/session`
Expected: PASS. Los tests preexistentes de `WhoopWorkoutMetrics` son la red de paridad: si alguno falla por el cambio de `flex` a `grid`, revisá que sea una aserción de **clase CSS** y no de contenido — la paridad congelada es de métricas, valores, copy y orden, no de layout.

- [ ] **Step 7: Verificar y checkpoint**

Run: `npx tsc --noEmit && npm run lint`
Archivos: `HrZoneDistribution.tsx`, `WhoopWorkoutMetrics.tsx`, el test nuevo.
Mensaje sugerido: `feat(whoop): show HR zone distribution on session cards`.

---

## Task 7: Bloque del coach

**Files:**
- Modify: `src/services/ai/whoopWorkoutContext.ts:44-77`
- Test: `src/services/ai/__tests__/whoopWorkoutContext.test.ts` (extender o crear)

**Interfaces:**
- Consumes: `resolveHighZoneDurationMs`, `resolveHrCaptureState`, `formatHrCapturePercent` (Task 5).
- Produces: nada nuevo — la firma de `formatWhoopWorkoutBlock` no cambia.

- [ ] **Step 1: Escribir los tests**

```ts
describe('formatWhoopWorkoutBlock — zonas', () => {
  const ZONES = { z0: 0, z1: 0, z2: 600_000, z3: 900_000, z4: 500_000, z5: 100_000 }

  it('inserta la zona alta entre strain y FC', () => {
    const block = formatWhoopWorkoutBlock(
      [makeWorkout({ zoneDurations: ZONES })], [], '2026-08-04',
    )
    expect(block).toContain('60 min · strain 12.4 · 10 min zona alta · FC 142/181')
  })

  it('un entrenamiento sin zonas produce exactamente la línea de la Entrega 2', () => {
    const block = formatWhoopWorkoutBlock([makeWorkout()], [], '2026-08-04')
    expect(block).toContain('60 min · strain 12.4 · FC 142/181')
    expect(block).not.toContain('zona alta')
    expect(block).not.toContain('cobertura')
  })

  it('usa punto decimal, igual que strain', () => {
    const block = formatWhoopWorkoutBlock(
      [makeWorkout({ zoneDurations: ZONES, percentRecorded: 72.45 })], [], '2026-08-04',
    )
    expect(block).toContain('· cobertura 72.4%')
    expect(block).not.toContain('72,4')
  })

  it.each([
    [100, false], [92.4, false],
  ])('no menciona la cobertura cuando es %s', (percentRecorded) => {
    const block = formatWhoopWorkoutBlock(
      [makeWorkout({ zoneDurations: ZONES, percentRecorded })], [], '2026-08-04',
    )
    expect(block).not.toContain('cobertura')
  })

  it('dice «cobertura no informada» solo con zonas y sin porcentaje', () => {
    const withZones = formatWhoopWorkoutBlock(
      [makeWorkout({ zoneDurations: ZONES })], [], '2026-08-04',
    )
    expect(withZones).toContain('· cobertura no informada')

    // Sin zonas NO aparece, aunque falte el porcentaje: es el caso de todo
    // entrenamiento anterior al flag.
    const withoutZones = formatWhoopWorkoutBlock([makeWorkout()], [], '2026-08-04')
    expect(withoutZones).not.toContain('cobertura no informada')
  })

  it('la guardia prohíbe proponer objetivos por zona', () => {
    const block = formatWhoopWorkoutBlock(
      [makeWorkout({ zoneDurations: ZONES })], [], '2026-08-04',
    )
    expect(block).toContain('no propongas objetivos por zona')
  })
})
```

`makeWorkout` es el helper del archivo; si no existe, copiá el de `workoutMetrics.test.ts` con `sportName: 'squash'`, `strain: 12.4`, `avgHr: 142`, `maxHr: 181`, `durationMin: 60`.

- [ ] **Step 2: Correr y confirmar que fallan**

Run: `npx vitest run src/services/ai/__tests__/whoopWorkoutContext.test.ts -t "zonas"`

- [ ] **Step 3: Implementar**

En `src/services/ai/whoopWorkoutContext.ts`:

1. Importar `resolveHighZoneDurationMs`, `resolveHrCaptureState`, `formatHrCapturePercent`.
2. Reemplazar `GUARD_LINE` por:

```ts
const GUARD_LINE =
  'Strain es carga fisiologica medida (0-21), no el esfuerzo declarado por el atleta. '
  + 'Las zonas son distribucion de FC medida: no propongas objetivos por zona, '
  + 'el producto no tiene sesiones con objetivo de zona.'
```

3. En `formatWorkoutLine`, después del loop `for (const metric of metrics) parts.push(...)`, insertar los dos segmentos. **Ojo:** `LINE_ORDER` pone `strain` antes de `hr`, así que para que la zona alta caiga entre ambos hay que insertarla por posición, no por append:

```ts
  const highZoneMs = resolveHighZoneDurationMs(workout)
  if (highZoneMs != null) {
    const hrIndex = parts.findIndex((part) => part.startsWith('FC '))
    const segment = `${Math.round(highZoneMs / 60_000)} min zona alta`
    if (hrIndex === -1) parts.push(segment)
    else parts.splice(hrIndex, 0, segment)
  }

  const capture = resolveHrCaptureState(workout)
  // `full` y `high` no agregan nada: entre 90 y 100 la distribución es
  // utilizable y gastar tokens en decirlo no cambia ninguna lectura. `null`
  // tampoco: sin distribución no hay nada que calificar.
  if (capture?.kind === 'low') {
    parts.push(`cobertura ${formatHrCapturePercent(capture.percent, '.')}%`)
  } else if (capture?.kind === 'unknown') {
    parts.push('cobertura no informada')
  }
```

- [ ] **Step 4: Correr y confirmar que pasan**

Run: `npx vitest run src/services/ai/__tests__/whoopWorkoutContext.test.ts`

- [ ] **Step 5: Medir el costo del bloque**

Run: `npx vitest run scripts/audit-prompt-tokens.test.ts`
El spec presupuesta ~40 tokens sobre los ~280 actuales. Si el audit reporta un aumento sustancialmente mayor, reportalo antes de seguir en vez de ajustar el presupuesto en silencio.

- [ ] **Step 6: Verificar y checkpoint**

Run: `npx tsc --noEmit && npm run lint`
Archivos: `whoopWorkoutContext.ts` y su test.
Mensaje sugerido: `feat(whoop): feed HR zone intensity to the coach block`.

---

## Task 8: Agregador semanal (módulo puro)

**Files:**
- Create: `src/services/readiness/weeklyHrZones.ts`
- Test: `src/services/readiness/__tests__/weeklyHrZones.test.ts`

**Interfaces:**
- Consumes: `HR_ZONE_KEYS`, `resolveHighZoneDurationMs`, `resolveHrCaptureState` (Task 5).
- Produces:

```ts
export interface WeeklyHrZoneDay {
  date: string
  totalMs: number
  byZone: Record<HrZoneKey, number>
}

export interface WeeklyHrZoneSummary {
  days: WeeklyHrZoneDay[]        // exactamente 7, en orden, incluidos los vacíos
  workoutCount: number
  totalRecordedMs: number
  highZoneMs: number
  lowCaptureCount: number
  unknownCaptureCount: number
}

export function buildWeeklyHrZoneSummary(
  workouts: WhoopWorkout[],
  weekDays: string[],
): WeeklyHrZoneSummary | null
```

- [ ] **Step 1: Escribir los tests**

```ts
import { describe, it, expect } from 'vitest'
import { buildWeeklyHrZoneSummary } from '../weeklyHrZones'

const WEEK = ['2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07','2026-08-08','2026-08-09']
const ZONES = { z0: 0, z1: 0, z2: 600_000, z3: 300_000, z4: 500_000, z5: 100_000 }

function makeWorkout(overrides = {}) {
  return {
    id: 'x', workoutId: 'x', athleteId: 'ath-1', date: '2026-08-04',
    sportName: 'squash', startAt: '2026-08-04T10:00:00.000Z',
    endAt: '2026-08-04T11:00:00.000Z', durationMin: 60,
    scoreState: 'SCORED' as const, updatedAt: 1, zoneDurations: ZONES,
    ...overrides,
  }
}

describe('buildWeeklyHrZoneSummary', () => {
  it('devuelve null si ningún entrenamiento de la semana tiene zonas', () => {
    expect(buildWeeklyHrZoneSummary([makeWorkout({ zoneDurations: undefined })], WEEK)).toBeNull()
    expect(buildWeeklyHrZoneSummary([], WEEK)).toBeNull()
  })

  it('excluye de TODA cifra los workouts sin zonas o no SCORED', () => {
    const summary = buildWeeklyHrZoneSummary([
      makeWorkout({ workoutId: 'a' }),
      makeWorkout({ workoutId: 'b', zoneDurations: undefined }),
      makeWorkout({ workoutId: 'c', scoreState: 'PENDING_SCORE' }),
    ], WEEK)!
    expect(summary.workoutCount).toBe(1)
  })

  it('devuelve siempre siete días en orden, incluidos los vacíos', () => {
    const summary = buildWeeklyHrZoneSummary([makeWorkout()], WEEK)!
    expect(summary.days.map((day) => day.date)).toEqual(WEEK)
    expect(summary.days[0].totalMs).toBe(0)
    expect(summary.days[1].totalMs).toBe(1_500_000)
  })

  it('suma por zona los entrenamientos del mismo día', () => {
    const summary = buildWeeklyHrZoneSummary([
      makeWorkout({ workoutId: 'a' }),
      makeWorkout({ workoutId: 'b' }),
    ], WEEK)!
    expect(summary.days[1].byZone.z2).toBe(1_200_000)
    expect(summary.highZoneMs).toBe(1_200_000)
  })

  it('los minutos registrados salen de la suma de zonas, no de durationMin', () => {
    // durationMin dice 60; las zonas suman 25 min. Gana la suma de zonas para
    // que titular y columnas no puedan discrepar.
    const summary = buildWeeklyHrZoneSummary([makeWorkout()], WEEK)!
    expect(summary.totalRecordedMs).toBe(1_500_000)
  })

  it('cuenta cobertura baja y no informada por separado', () => {
    const summary = buildWeeklyHrZoneSummary([
      makeWorkout({ workoutId: 'a', percentRecorded: 72.4 }),
      makeWorkout({ workoutId: 'b' }),
      makeWorkout({ workoutId: 'c', percentRecorded: 99 }),
      makeWorkout({ workoutId: 'd', percentRecorded: 100 }),
    ], WEEK)!
    expect(summary.lowCaptureCount).toBe(1)
    expect(summary.unknownCaptureCount).toBe(1)
  })

  it('ignora entrenamientos fuera de la semana visible', () => {
    const summary = buildWeeklyHrZoneSummary([
      makeWorkout({ workoutId: 'a' }),
      makeWorkout({ workoutId: 'b', date: '2026-07-30' }),
    ], WEEK)!
    expect(summary.workoutCount).toBe(1)
  })
})
```

- [ ] **Step 2: Correr y confirmar que fallan**

Run: `npx vitest run src/services/readiness/__tests__/weeklyHrZones.test.ts`

- [ ] **Step 3: Implementar**

Crear `src/services/readiness/weeklyHrZones.ts`:

```ts
import type { WhoopWorkout } from '../../types'
import {
  HR_ZONE_KEYS,
  resolveHighZoneDurationMs,
  resolveHrCaptureState,
  type HrZoneKey,
} from './workoutMetrics'

export interface WeeklyHrZoneDay {
  date: string
  totalMs: number
  byZone: Record<HrZoneKey, number>
}

export interface WeeklyHrZoneSummary {
  days: WeeklyHrZoneDay[]
  workoutCount: number
  totalRecordedMs: number
  highZoneMs: number
  lowCaptureCount: number
  unknownCaptureCount: number
}

function emptyDay(date: string): WeeklyHrZoneDay {
  return {
    date,
    totalMs: 0,
    byZone: { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 },
  }
}

/**
 * Solo entrenamientos SCORED CON distribución participan de alguna cifra, ni
 * siquiera del conteo. Los minutos registrados se derivan de la suma de zonas y
 * no de `durationMin`, para que el titular y las columnas no puedan discrepar.
 */
export function buildWeeklyHrZoneSummary(
  workouts: WhoopWorkout[],
  weekDays: string[],
): WeeklyHrZoneSummary | null {
  const dayIndex = new Map(weekDays.map((date, index) => [date, index]))
  const days = weekDays.map(emptyDay)

  let workoutCount = 0
  let totalRecordedMs = 0
  let highZoneMs = 0
  let lowCaptureCount = 0
  let unknownCaptureCount = 0

  for (const workout of workouts) {
    const index = dayIndex.get(workout.date)
    if (index === undefined) continue

    const zones = workout.zoneDurations
    if (!zones || workout.scoreState !== 'SCORED') continue

    workoutCount += 1
    for (const key of HR_ZONE_KEYS) {
      days[index].byZone[key] += zones[key]
      days[index].totalMs += zones[key]
      totalRecordedMs += zones[key]
    }
    highZoneMs += resolveHighZoneDurationMs(workout) ?? 0

    const capture = resolveHrCaptureState(workout)
    if (capture?.kind === 'low') lowCaptureCount += 1
    if (capture?.kind === 'unknown') unknownCaptureCount += 1
  }

  return workoutCount === 0 ? null : {
    days, workoutCount, totalRecordedMs, highZoneMs, lowCaptureCount, unknownCaptureCount,
  }
}
```

- [ ] **Step 4: Correr y confirmar que pasan**

Run: `npx vitest run src/services/readiness/__tests__/weeklyHrZones.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verificar y checkpoint**

Run: `npx tsc --noEmit && npm run lint`
Mensaje sugerido: `feat(whoop): add weekly HR zone aggregator`.

---

## Task 9: Tarjeta del resumen semanal

**Files:**
- Create: `src/components/week/WeeklyHrZonesCard.tsx`
- Modify: `src/pages/WeeklyView.tsx:365-390`
- Test: `src/components/week/__tests__/weeklyHrZonesCard.test.tsx`

**Interfaces:**
- Consumes: `buildWeeklyHrZoneSummary` (Task 8), `getLocalWhoopWorkoutsInRange`, `getActiveAthleteId` / `getSelfAthleteId`.
- Produces: `WeeklyHrZonesCard({ weekDays }: { weekDays: string[] })`.

- [ ] **Step 1: Escribir los tests**

Crear `src/components/week/__tests__/weeklyHrZonesCard.test.tsx`. Preámbulo completo:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { WhoopWorkout } from '../../../types'

// Vitest 4 (el repo está en ^4.1.3): `vi.fn` toma UN solo parámetro de tipo, la
// firma completa de la función. La forma vieja de dos parámetros
// —`vi.fn<[string, string, string], Promise<…>>()`— es de Vitest 1/2 y no compila.
const getWorkouts = vi.fn<
  (athleteId: string, from: string, to: string) => Promise<WhoopWorkout[]>
>()
const scope = { active: 'ath-self', self: 'ath-self' }

vi.mock('../../../services/readiness/localWhoopWorkouts', () => ({
  getLocalWhoopWorkoutsInRange: (...args: [string, string, string]) => getWorkouts(...args),
}))

vi.mock('../../../services/athlete/activeAthlete', () => ({
  getActiveAthleteId: () => scope.active,
  getSelfAthleteId: () => scope.self,
}))

import WeeklyHrZonesCard from '../WeeklyHrZonesCard'

const WEEK = ['2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07','2026-08-08','2026-08-09']
const NEXT_WEEK = WEEK.map((date) => `2026-08-${String(Number(date.slice(8)) + 7).padStart(2, '0')}`)
const ZONES = { z0: 0, z1: 0, z2: 600_000, z3: 300_000, z4: 500_000, z5: 100_000 }

function makeWorkout(overrides: Partial<WhoopWorkout> = {}): WhoopWorkout {
  return {
    id: 'whoop:ath-self:w1', workoutId: 'w1', athleteId: 'ath-self',
    date: '2026-08-04', sportName: 'squash',
    startAt: '2026-08-04T10:00:00.000Z', endAt: '2026-08-04T11:00:00.000Z',
    durationMin: 60, scoreState: 'SCORED', updatedAt: 1,
    ...overrides,
  }
}

function mockWorkouts(rows: WhoopWorkout[]) {
  getWorkouts.mockResolvedValue(rows)
  return getWorkouts
}

/**
 * Deja CADA lectura colgada por separado, resoluble en cualquier orden.
 *
 * `mockReturnValue` no sirve acá: devolvería la misma promesa —y las mismas
 * filas— a las dos consultas, así que resolverla satisfaría a ambos efectos a la
 * vez y el test no podría distinguir «la lectura vieja se descartó» de «las dos
 * lecturas trajeron lo mismo».
 */
function deferWorkoutsPerCall() {
  const pending: Array<(rows: WhoopWorkout[]) => void> = []
  getWorkouts.mockImplementation(() => new Promise((resolve) => { pending.push(resolve) }))
  return {
    resolveCall: (index: number, rows: WhoopWorkout[]) => pending[index](rows),
    get callCount() { return pending.length },
  }
}

function mockScope(next: { active: string; self: string }) {
  scope.active = next.active
  scope.self = next.self
}

beforeEach(() => {
  getWorkouts.mockReset()
  mockScope({ active: 'ath-self', self: 'ath-self' })
})

describe('WeeklyHrZonesCard', () => {
  it('no se monta si ningún entrenamiento de la semana tiene zonas', async () => {
    mockWorkouts([])
    render(<WeeklyHrZonesCard weekDays={WEEK} />)
    await waitFor(() => expect(screen.queryByText(/carga medida por whoop/i)).toBeNull())
  })

  it('titula los minutos REGISTRADOS en zona alta', async () => {
    mockWorkouts([makeWorkout({ zoneDurations: ZONES })])
    render(<WeeklyHrZonesCard weekDays={WEEK} />)
    expect(await screen.findByText('10 min registrados en zona alta')).toBeTruthy()
    expect(screen.getByText(/carga medida por whoop/i)).toBeTruthy()
    // No dice "tu semana": un entrenamiento que Whoop no registró no aparece.
    expect(screen.queryByText(/tu semana/i)).toBeNull()
  })

  it('separa el conteo de cobertura baja del de no informada', async () => {
    mockWorkouts([
      makeWorkout({ workoutId: 'a', zoneDurations: ZONES, percentRecorded: 72.4 }),
      makeWorkout({ workoutId: 'b', zoneDurations: ZONES }),
    ])
    render(<WeeklyHrZonesCard weekDays={WEEK} />)
    const subtitle = await screen.findByTestId('weekly-hr-zones-subtitle')
    expect(subtitle.textContent).toContain('1 con cobertura menor a 90%')
    expect(subtitle.textContent).toContain('1 sin cobertura informada')
  })

  it('omite el segmento de cobertura si no hay ninguno', async () => {
    mockWorkouts([makeWorkout({ zoneDurations: ZONES, percentRecorded: 100 })])
    render(<WeeklyHrZonesCard weekDays={WEEK} />)
    const subtitle = await screen.findByTestId('weekly-hr-zones-subtitle')
    expect(subtitle.textContent).not.toContain('cobertura')
  })

  it('cada columna tiene texto accesible con fecha y reparto', async () => {
    mockWorkouts([makeWorkout({ date: '2026-08-04', zoneDurations: ZONES })])
    render(<WeeklyHrZonesCard weekDays={WEEK} />)
    expect(await screen.findByRole('img', { name: /2026-08-04.*zona 2/i })).toBeTruthy()
    expect(screen.getByRole('img', { name: /2026-08-03.*sin datos Whoop/i })).toBeTruthy()
  })

  it('descarta una lectura que llega después de cambiar de semana', async () => {
    const deferred = deferWorkoutsPerCall()
    const { rerender } = render(<WeeklyHrZonesCard weekDays={WEEK} />)
    rerender(<WeeklyHrZonesCard weekDays={NEXT_WEEK} />)
    await waitFor(() => expect(deferred.callCount).toBe(2))

    // La consulta VIGENTE resuelve primero, con un valor distinguible.
    deferred.resolveCall(1, [makeWorkout({
      workoutId: 'next', date: NEXT_WEEK[1],
      startAt: `${NEXT_WEEK[1]}T10:00:00.000Z`, endAt: `${NEXT_WEEK[1]}T11:00:00.000Z`,
      zoneDurations: { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 60_000 },
    })])
    expect(await screen.findByText('1 min registrados en zona alta')).toBeTruthy()

    // Recién ahora llega la vieja. Si el efecto no se cancelara, pisaría el
    // valor de arriba con los 10 min de WEEK.
    deferred.resolveCall(0, [makeWorkout({ zoneDurations: ZONES })])
    await waitFor(() => expect(screen.queryByText('10 min registrados en zona alta')).toBeNull())
    expect(screen.getByText('1 min registrados en zona alta')).toBeTruthy()
  })

  it('no consulta para un atleta gestionado', async () => {
    mockScope({ active: 'ath-managed', self: 'ath-self' })
    const spy = mockWorkouts([makeWorkout({ zoneDurations: ZONES })])
    render(<WeeklyHrZonesCard weekDays={WEEK} />)
    await waitFor(() => expect(spy).not.toHaveBeenCalled())
  })
})
```

El test de cambio de semana es el que importa más: `AppShell.tsx:17` remonta la página por `activeAthleteId`, no por semana, así que el remount **no** cubre la navegación semanal — es exactamente el hallazgo que el code review de la Entrega 2 encontró en `DayDetail`.

Por eso su orden de resolución es deliberado y no debe simplificarse. La versión ingenua —resolver una sola promesa compartida y afirmar que no aparece nada— pasa aunque la cancelación no exista: la escritura tardía de la semana vieja queda tapada por la escritura de la semana vigente, que agrega cero entrenamientos en su rango y también renderiza nada. Resolver **primero** la consulta vigente con un valor distinguible, y **después** la vieja, es lo que convierte «no aparece nada» en «el valor correcto sobrevivió».

- [ ] **Step 2: Correr y confirmar que fallan**

Run: `npx vitest run src/components/week/__tests__/weeklyHrZonesCard.test.tsx`

- [ ] **Step 3: Implementar la tarjeta**

Crear `src/components/week/WeeklyHrZonesCard.tsx`:

```tsx
import { useEffect, useState } from 'react'
import Card from '../ui/Card'
import { getActiveAthleteId, getSelfAthleteId } from '../../services/athlete/activeAthlete'
import { getLocalWhoopWorkoutsInRange } from '../../services/readiness/localWhoopWorkouts'
import {
  buildWeeklyHrZoneSummary,
  type WeeklyHrZoneSummary,
} from '../../services/readiness/weeklyHrZones'
import {
  HR_ZONE_ACCESSIBLE_LABELS,
  HR_ZONE_KEYS,
  HR_ZONE_LABELS,
  type HrZoneKey,
} from '../../services/readiness/workoutMetrics'

const ZONE_COLORS: Record<HrZoneKey, string> = {
  z0: 'bg-white/15',
  z1: 'bg-sky-500/50',
  z2: 'bg-teal-500/55',
  z3: 'bg-amber-500/60',
  z4: 'bg-orange-500/70',
  z5: 'bg-rose-500/75',
}

const DAY_INITIALS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

interface LoadedState {
  athleteId: string
  weekStart: string
  summary: WeeklyHrZoneSummary | null
}

export default function WeeklyHrZonesCard({ weekDays }: { weekDays: string[] }) {
  const [state, setState] = useState<LoadedState | null>(null)
  const weekStart = weekDays[0]

  useEffect(() => {
    let cancelled = false

    async function load() {
      const athleteId = getActiveAthleteId()
      // Solo self: la ingestión pertenece siempre al self de la cuenta, así que
      // un gestionado nunca tiene filas y la consulta sería trabajo perdido.
      if (!athleteId || athleteId !== getSelfAthleteId()) {
        if (!cancelled) setState(null)
        return
      }

      const workouts = await getLocalWhoopWorkoutsInRange(
        athleteId, weekStart, weekDays[weekDays.length - 1],
      ).catch(() => [])

      // La identidad se compara al escribir, no solo al leer: `setCurrentWeekStart`
      // no desmonta la página (`AppShell` la remonta por `activeAthleteId`, no por
      // semana), así que una lectura de la semana N que resuelve después de pasar
      // a la N+1 pintaría datos de la semana equivocada.
      if (cancelled) return
      setState({
        athleteId,
        weekStart,
        summary: buildWeeklyHrZoneSummary(workouts, weekDays),
      })
    }

    void load()
    return () => { cancelled = true }
  }, [weekStart, weekDays])

  if (!state || state.weekStart !== weekStart || state.athleteId !== getActiveAthleteId()) return null

  const summary = state.summary
  if (!summary) return null

  // Escala única para las siete columnas: normalizar cada día por separado haría
  // que un día de 20 min y uno de 90 se vieran igual de altos, ocultando la
  // diferencia de volumen que el gráfico existe para mostrar.
  const scaleMs = Math.max(...summary.days.map((day) => day.totalMs), 1)

  const coverage: string[] = []
  if (summary.lowCaptureCount > 0) {
    coverage.push(`${summary.lowCaptureCount} con cobertura menor a 90%`)
  }
  if (summary.unknownCaptureCount > 0) {
    coverage.push(`${summary.unknownCaptureCount} sin cobertura informada`)
  }

  const subtitle = [
    `${summary.workoutCount} ${summary.workoutCount === 1 ? 'entrenamiento' : 'entrenamientos'}`,
    `${Math.round(summary.totalRecordedMs / 60_000)} min registrados`,
    ...coverage,
  ].join(' · ')

  return (
    <Card variant="panel" className="px-3 py-3 md:px-4 md:py-4">
      <p className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        Carga medida por Whoop
      </p>
      <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-orange-300">
        {Math.round(summary.highZoneMs / 60_000)} min registrados en zona alta
      </p>
      <p data-testid="weekly-hr-zones-subtitle" className="mt-0.5 text-[11px] text-ink-muted">
        {subtitle}
      </p>

      <div className="mt-3 flex h-24 items-end gap-1.5">
        {summary.days.map((day, index) => (
          <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
            <div
              role="img"
              aria-label={day.totalMs === 0
                ? `${day.date}: sin datos Whoop`
                : `${day.date}: ${HR_ZONE_KEYS
                    .filter((key) => day.byZone[key] > 0)
                    .map((key) => `${HR_ZONE_ACCESSIBLE_LABELS[key]} ${Math.round(day.byZone[key] / 60_000)} min`)
                    .join(', ')}`}
              className="flex w-full flex-col-reverse overflow-hidden rounded-md bg-white/5"
              style={{ height: `${Math.max((day.totalMs / scaleMs) * 100, 3)}%` }}
            >
              {HR_ZONE_KEYS.map((key) => (
                day.byZone[key] > 0 && (
                  <div
                    key={key}
                    className={ZONE_COLORS[key]}
                    style={{ height: `${(day.byZone[key] / day.totalMs) * 100}%` }}
                  />
                )
              ))}
            </div>
            <span className="text-[10px] text-ink-faint">{DAY_INITIALS[index]}</span>
          </div>
        ))}
      </div>

      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {HR_ZONE_KEYS.map((key) => (
          <li key={key} className="flex items-center gap-1 text-[10px] text-ink-faint">
            <span className={`h-2 w-2 rounded-sm ${ZONE_COLORS[key]}`} aria-hidden="true" />
            {HR_ZONE_LABELS[key]}
          </li>
        ))}
      </ul>
    </Card>
  )
}
```

- [ ] **Step 4: Montarla en `WeeklyView`**

En `src/pages/WeeklyView.tsx`, importar el componente y agregarlo dentro del `<div className="space-y-3">` de la columna "Resumen semanal", después de `<MacroPhaseSummaryCard …/>`:

```tsx
            <WeeklyHrZonesCard weekDays={weekDays.map((day) => toISO(day))} />
```

`weekDays` ya existe en la línea 57 (`getWeekDays(fromISO(currentWeekStart))`) y `toISO` ya está importado.

- [ ] **Step 5: Correr y confirmar que pasan**

Run: `npx vitest run src/components/week/__tests__/weeklyHrZonesCard.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 6: Verificar y checkpoint**

Run: `npx tsc --noEmit && npm run lint`
Archivos: `WeeklyHrZonesCard.tsx`, `WeeklyView.tsx`, el test.
Mensaje sugerido: `feat(whoop): add weekly HR zone summary card`.

---

## Task 10: Publicaciones legales nuevas (registradas, no vigentes)

Va al final del código a propósito: los textos describen lo que las Tasks 1-9 efectivamente construyeron. **No cambia `currentVersion`** — eso es el Deploy 2 del owner, después de la aprobación jurídica.

**Files:**
- Create: `src/services/legal/publications/whoop_biometric.2026-08-08.ts`
- Create: `src/services/legal/publications/privacy.2026-08-08.ts`
- Modify: `src/services/legal/consentDocuments.ts`
- Modify: `src/services/legal/__tests__/legalPublicationIntegrity.test.ts:30-35`
- Modify: `docs/legal/descargo-whoop.md`, `docs/legal/politica-de-privacidad.md`

**Interfaces:**
- Consumes: `LegalDocumentContent` de `src/services/legal/legalDocumentContent`.
- Produces: `WHOOP_2026_08_08`, `PRIVACY_2026_08_08`.

- [ ] **Step 1: Copiar las publicaciones vigentes como base**

Copiar `whoop_biometric.2026-07-07.ts` → `whoop_biometric.2026-08-08.ts` y `privacy.2026-07-13.ts` → `privacy.2026-08-08.ts`, renombrando la constante exportada a `WHOOP_2026_08_08` / `PRIVACY_2026_08_08`.

**Las publicaciones existentes no se tocan** — son inmutables por contrato del ledger, y `legalPublicationIntegrity.test.ts` rompe si alguien las edita.

- [ ] **Step 2: Redactar los cambios de contenido**

En **ambas**, la enumeración de datos recibidos de Whoop pasa a incluir, explícitamente:

- entrenamientos, con fecha, deporte, duración, frecuencia cardíaca media y máxima, distancia;
- **distribución de tiempo por zona de frecuencia cardíaca**;
- **porcentaje de frecuencia cardíaca efectivamente registrado por Whoop durante el entrenamiento** — enumerado **aparte** de la distribución, porque es un dato persistido distinto, no un atributo de ella;
- que esos datos **se guardan en la nube y se replican localmente en el dispositivo** (las publicaciones vigentes describen el cliente como si replicara solo un resumen diario de readiness, lo cual dejó de ser cierto con `012`);
- que alimentan el contexto objetivo del coach de IA.

Copy sugerido para la viñeta nueva, en las dos publicaciones:

> Entrenamientos detectados por Whoop: fecha, deporte, duración, frecuencia cardíaca media y máxima, distancia cuando corresponde, y la distribución del tiempo entre las seis zonas de frecuencia cardíaca de Whoop. También recibimos el porcentaje de la sesión en que Whoop registró frecuencia cardíaca, para que puedas saber qué tan completa es esa distribución. Estos datos se guardan en nuestra base de datos y se copian al almacenamiento local de tu dispositivo, y forman parte del contexto objetivo que recibe el coach de IA.

**Agregar la viñeta no alcanza: hay que reemplazar las frases que la contradicen.** Las publicaciones vigentes afirman explícitamente que el cliente replica **solo** un resumen diario, algo que dejó de ser cierto con `012` y que la viñeta nueva convertiría en una contradicción interna dentro del mismo documento. Las dos frases exactas a reescribir en las copias nuevas:

- `whoop_biometric.2026-07-07.ts:66` → «La app solo replica localmente un resumen diario de readiness asociado a tu atleta activo.»
- `privacy.2026-07-13.ts:103`, al final del párrafo → «la app usa un resumen diario asociado a tu cuenta y atleta activo.»

En ambas, la redacción nueva debe decir que se replican localmente el resumen diario de readiness **y los entrenamientos detectados con sus métricas**, siempre asociados a tu cuenta y atleta activo. Lo que sigue siendo cierto y **no** hay que tocar es que los datos biométricos crudos y los tokens se procesan del lado servidor y no se exponen al cliente.

Los mismos dos reemplazos van en los espejos Markdown del Step 6: `docs/legal/descargo-whoop.md:29` y `docs/legal/politica-de-privacidad.md:82`.

- [ ] **Step 3: Registrar las publicaciones sin hacerlas vigentes**

En `src/services/legal/consentDocuments.ts`, agregar los imports y **una entrada más** al array `publications` de `privacy` y de `whoop_biometric`. **`currentVersion` no cambia** en ninguno de los dos:

```ts
      {
        version: '2026-08-08',
        sha256: '<calculado en el Step 4>',
        content: PRIVACY_2026_08_08,
      },
```

- [ ] **Step 4: Calcular los dos hashes**

Run:

```bash
npx tsx -e "
import { createHash } from 'node:crypto'
import { PRIVACY_2026_08_08 } from './src/services/legal/publications/privacy.2026-08-08'
import { WHOOP_2026_08_08 } from './src/services/legal/publications/whoop_biometric.2026-08-08'
for (const [id, content] of [['privacy', PRIVACY_2026_08_08], ['whoop_biometric', WHOOP_2026_08_08]]) {
  console.log(id, createHash('sha256').update(JSON.stringify(content), 'utf8').digest('hex'))
}
"
```

Es exactamente `canonicalize()` (`legalPublicationIntegrity.test.ts:14`): `JSON.stringify` sobre el objeto `content` **solo** — sin `version` ni `sha256` alrededor. Envolverlo produce un hash que no coincide con nada y que el test rechaza. Si aun así hay discrepancia, la fuente de verdad es `canonicalize()`: corré el test y tomá el hash del mensaje de error.

Pegar los dos hashes en `consentDocuments.ts` y en `FROZEN_PUBLICATIONS` como tripletas `privacy@2026-08-08#<hash>` y `whoop_biometric@2026-08-08#<hash>`, manteniendo el array **ordenado** (el test compara contra `.sort()`).

- [ ] **Step 5: Correr los tests de integridad**

Run: `npx vitest run src/services/legal`
Expected: PASS. Los tests verifican que el conjunto histórico solo creció, que cada hash corresponde a su contenido, que la gramática de versión es válida, que no hay versiones repetidas y que la vigente existe en el ledger.

- [ ] **Step 6: Actualizar los espejos Markdown**

Aplicar los mismos cambios de contenido a `docs/legal/descargo-whoop.md` y `docs/legal/politica-de-privacidad.md`. Son espejos de lectura, no la fuente de verdad del consentimiento.

- [ ] **Step 7: Verificar y checkpoint**

Run: `npx tsc --noEmit && npm run lint`
Mensaje sugerido: `feat(legal): register HR zone publications without making them current`.
**Recordarle al owner:** estas publicaciones quedan **registradas y no vigentes**. Cambiar `currentVersion` es el Deploy 2 y detiene la sincronización de Whoop para quien no reacepte — conviene cerrar el ciclo antes del piloto.

---

## Task 11: Verificación de cierre

**Files:** ninguno nuevo; solo se corren y se registran resultados.

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: verde. Registrar el conteo de archivos/tests para el roadmap (la línea base de la Entrega 2 es 379 archivos / 3000 tests).

- [ ] **Step 2: Typecheck, lint, build y diff limpio**

Run: `npx tsc --noEmit && npm run lint && npm run build && git diff --check`

- [ ] **Step 3: Confirmar la paridad de contenido contra `d91e21e`**

Un entrenamiento **sin** `zoneDurations` debe mostrar las mismas métricas, valores, copy y orden que antes de esta entrega, y ningún elemento de zonas. Cubierto por el primer test de la Task 6 y por el segundo de la Task 7; confirmá que ambos siguen verdes.

- [ ] **Step 4: Round-trip de backup**

Run: `npx vitest run src/services/__tests__/dataExportWhoopZones.test.ts`

Dos cosas distintas, y las dos tienen que estar verdes:

1. **Parser contra backups fabricados** — las cinco variantes manipuladas del spec §10: parcial, negativa, vacía, no entera, y `PENDING_SCORE`/`UNSCORABLE` con datos válidos. En este último caso el entrenamiento se conserva y **ambos** datos se descartan.
2. **Round-trip real** (Task 4 Step 10) — `db.whoopWorkouts.put` → `exportAppData` → `JSON.parse` → `parseAppDataExport`, con `zoneDurations` y `percentRecorded` intactos al otro lado. Es el único de los dos que demuestra que las zonas **salen** exportadas; el primero solo demuestra que entran.

- [ ] **Step 5: Escribir el documento de smoke**

Crear `docs/superpowers/smokes/2026-08-08-whoop-hr-zones-smoke.md` con los pasos que **no** cuestan API y requieren sesión real:

1. Con el flag **apagado**: un sync completo no escribe ninguna de las siete columnas ni borra las existentes. Consulta: `select count(*) from whoop_workouts where zone_zero_milli is not null;` antes y después.
2. Las cinco `CHECK` de `019` rechazan sus estados inválidos, verificado con `insert`/`update` contra la base.
3. Con el flag **encendido**, tras el primer sync: tarjeta de sesión con `Zona alta`, barra y desplegable; resumen semanal con siete columnas; bloque del coach con el segmento nuevo (mirar el payload en Beta Quality).
4. Ausencia total bajo un atleta gestionado (§2.1: verifica que no hay workouts en ese scope, no que una superficie los filtre).
5. **Consulta de auditoría post-flag**, sobre datos reales:

```sql
select sport_name,
       count(*) filter (where zone_zero_milli is null) as sin_zonas,
       count(*) as total
from whoop_workouts
where score_state = 'SCORED'
group by sport_name
order by total desc;
```

Responde de una vez si squash recibe distribución o si el valor de la entrega se concentra en running (spec §11, decisión abierta 2).

- [ ] **Step 6: Checkpoint final**

Mensaje sugerido: `docs(whoop): add HR zones smoke checklist`.
Reportar al owner: conteo de la suite, el orden de rollout de Task 0 pendiente, y que las dos publicaciones quedan registradas pero no vigentes.

---

## Fuera de alcance, declarado

Del spec §2, para que nadie lo agregue por iniciativa propia: `kilojoule` y desnivel; objetivos de zona en sesiones planificadas; comparación persistida entre semanas; backfill histórico más allá de lo que la ventana de sync rellena sola; ingerir zonas para atletas gestionados; publicar los textos legales nuevos.

También: **no** se agrega una cuarta constante `WHOOP_WORKOUT_WINDOW_DAYS` ni se renombran las tres existentes (14, 14, 7). Está anotado en el spec §8 porque es el terreno exacto donde ya apareció un bug.

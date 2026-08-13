# Harness de sync multi-dispositivo — plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development`
> o `superpowers:executing-plans` para ejecutar tarea por tarea. Los pasos usan
> checkbox (`- [ ]`) para seguimiento.

**Goal:** Un harness determinista que ejercite el `syncService` real sobre dos
estados locales divergentes contra un backend en memoria con estado, y afirme
los criterios de salida de convergencia del roadmap.

**Architecture:** Módulos de test en `src/testing/syncHarness/`: un doble de
PostgREST en memoria con traza observable y fail-fast, un gestor de snapshots por
dispositivo que aísla Dexie + `localStorage` + stores + scope + entorno, y
aserciones reutilizables. Sin cambios de comportamiento en producción.

**Tech Stack:** TypeScript, Vitest, fake-indexeddb (ya instalado), Dexie, Zustand.

Spec: `docs/superpowers/specs/2026-08-12-multi-device-sync-harness-design.md`

## Global Constraints

- **Cero cambios de comportamiento en producción.** Si snapshotear algún estado
  exigiera exponer un accessor nuevo desde un módulo de producción, detenerse y
  acordarlo antes de agregarlo.
- **Fail-fast en el doble:** toda forma de consulta no implementada lanza. Nunca
  devolver `[]` ante algo no soportado.
- **Sin migraciones.** Dexie queda en v19.
- **No ejecutar `git commit` ni `git add`.** Cada tarea termina dejando el árbol
  verde; el owner revisa y commitea.
- Semántica profunda solo para `sessions`, `day_logs` y `week_summaries`;
  gramática genérica para el resto de tablas.
- **Verificación de cierre de cada tarea:** `npm test`, `npx tsc -b`,
  `npm run lint`, `npm run build` y `git diff --check` verdes.

## Hechos del código verificados (no asumir otra cosa)

Todos comprobados contra el árbol al 2026-08-12:

| Hecho | Fuente |
|---|---|
| `runFullSync(userId: string)` — **requiere** el userId | `syncService.ts:3276` |
| `getUserId()` lee `useAuthStore.getState().user?.id`; sin user, `push*` sale sin hacer nada | `syncService.ts:775-777` |
| `isEnabled()` exige `import.meta.env.VITE_SUPABASE_URL` | `syncService.ts:779-781` |
| `getSupabase()` vive en `sync/syncSupabase.ts` y lee `supabase` de `../auth` | `syncSupabase.ts:28` |
| `pullSessionsForDateRange` escribe **solo** `db.sessions`; no toca `useTrainingStore` | `syncService.ts:2585-2588` |
| `rowToSession` hace `...data`: `weekStartDate` debe venir dentro de `row.data` | `syncService.ts:1783-1795` |
| `requestedWeekStart: string \| null` | `useTrainingStore.ts:36` |
| El backend desempata sesiones con `updatedAt` idéntico en los tres pulls | `syncService.ts:1804`, `2595`, `2656`, `3390` |
| `useAuthStore` importa `../services/auth` — mockear `auth` desde un módulo que importe el store crea un **ciclo** | `useAuthStore.ts:4` |
| El self canónico es `ath_${userId}`; otro id se trata como gestionado y exige fila en `db.athletes` | `athleteScopeMigration.ts:11-13`, `syncService.ts:2219-2222` |
| `deleteSessionForTarget` ejecuta **solo** el camino remoto; no borra de `db.sessions` | `syncService.ts:2457-2471` |

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/testing/syncHarness/fakePostgrest.ts` | Backend en memoria + traza |
| `src/testing/syncHarness/backendRegistry.ts` | Registro del fake. **Módulo puro: no importa nada de la app** |
| `src/testing/syncHarness/harnessEnv.ts` | Stub de env y de `useAuthStore` |
| `src/testing/syncHarness/deviceHarness.ts` | Snapshot/restore por dispositivo + `dispose()` |
| `src/testing/syncHarness/syncExitCriteria.ts` | Aserciones de salida |
| `src/testing/syncHarness/__tests__/*.test.ts` | Casos |

---

## Task 1: Doble de PostgREST — gramática y traza

**Files:**
- Create: `src/testing/syncHarness/fakePostgrest.ts`
- Test: `src/testing/syncHarness/__tests__/fakePostgrest.test.ts`

**Interfaces:**
- Produces:
  - `createFakePostgrest(): FakePostgrest`
  - `FakePostgrest.client` — objeto con `.from(table)`
  - `FakePostgrest.trace: FakeTraceEntry[]`
  - `FakePostgrest.rows(table: string): Record<string, unknown>[]`
  - `FakePostgrest.seed(table: string, rows: Record<string, unknown>[]): void`
  - ```ts
    type FakeFilter = { op: 'eq' | 'lt' | 'gte' | 'lte' | 'in' | 'is' | 'or'; column: string; value: unknown }
    type FakeTraceEntry = {
      op: 'select' | 'upsert' | 'update' | 'delete'
      table: string
      code?: string
      matched?: number
      columns?: string
      filters: FakeFilter[]
    }
    ```
    `filters` es una **lista tipada**, no un mapa: `assertTrace` necesita
    distinguir `eq('updated_at', x)` de `lt('updated_at', x)`, y un
    `Record<string, unknown>` colapsa ambos en la misma clave.

Gramática exacta a soportar, derivada del código:

- `from(t).upsert(payload)` — `syncService.ts:1377`
- `from(t).select('id, updated_at').eq('user_id',u).eq('athlete_id',a).eq(dateCol,d).limit(1)` — `syncService.ts:1673-1680`
- `from(t).update(body).eq('id',x).eq('user_id',u).eq('athlete_id',a).eq(dateCol,d).lt('updated_at',ts).select('id')` — `syncService.ts:1754-1764`
- `from(t).delete().eq(...)`
- `from(t).select('*').eq('user_id',u)` y variantes de rango que usan los merges de `runFullSync` — `syncService.ts:3247-3252`

**`filters` y `columns` se registran en cada entrada de traza** porque
`assertTrace` debe distinguir un select de clave natural de los muchos selects
genéricos de `runFullSync`. Contar selects a secas no sirve.

- [x] **Step 1: Escribir el test que falla**

```ts
// src/testing/syncHarness/__tests__/fakePostgrest.test.ts
import { describe, expect, it } from 'vitest'
import { createFakePostgrest } from '../fakePostgrest'

const base = { user_id: 'u1', athlete_id: 'ath-1', date: '2026-08-12' }

describe('fakePostgrest — clave natural', () => {
  it('devuelve 23505 cuando dos ids distintos ocupan [athlete_id+date]', async () => {
    const backend = createFakePostgrest()
    const first = await backend.client.from('day_logs').upsert({ ...base, id: 'a', updated_at: 100 })
    expect(first.error).toBeNull()

    const second = await backend.client.from('day_logs').upsert({ ...base, id: 'b', updated_at: 200 })
    expect(second.error).toMatchObject({ code: '23505' })
    expect(backend.rows('day_logs')).toHaveLength(1)
  })

  it('onConflict por clave natural resuelve en vez de chocar', async () => {
    const backend = createFakePostgrest()
    await backend.client.from('day_logs').upsert({ ...base, id: 'a', updated_at: 100 })
    const result = await backend.client.from('day_logs').upsert(
      { ...base, id: 'b', updated_at: 200 },
      { onConflict: 'athlete_id,date' },
    )
    expect(result.error).toBeNull()
    expect(backend.rows('day_logs')).toHaveLength(1)
  })

  it('el update condicional no afecta filas más nuevas y 0 filas no es error', async () => {
    const backend = createFakePostgrest()
    await backend.client.from('day_logs').upsert({ ...base, id: 'a', updated_at: 500 })
    const result = await backend.client.from('day_logs')
      .update({ ...base, updated_at: 400 })
      .eq('id', 'a').eq('user_id', 'u1').eq('athlete_id', 'ath-1').eq('date', '2026-08-12')
      .lt('updated_at', 400)
      .select('id')
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
  })

  it('registra filtros y columnas en la traza', async () => {
    const backend = createFakePostgrest()
    await backend.client.from('day_logs').select('id, updated_at')
      .eq('user_id', 'u1').eq('athlete_id', 'ath-1').eq('date', '2026-08-12').limit(1)
    expect(backend.trace.at(-1)).toMatchObject({
      op: 'select',
      table: 'day_logs',
      columns: 'id, updated_at',
      filters: [
        { op: 'eq', column: 'user_id', value: 'u1' },
        { op: 'eq', column: 'athlete_id', value: 'ath-1' },
        { op: 'eq', column: 'date', value: '2026-08-12' },
      ],
    })
  })

  it('lanza ante un método no soportado en vez de devolver vacío', () => {
    const backend = createFakePostgrest()
    expect(() => (backend.client.from('day_logs') as unknown as {
      textSearch: (c: string, v: string) => unknown
    }).textSearch('title', 'x')).toThrow(/unsupported query/)
  })
})
```

- [x] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/testing/syncHarness/__tests__/fakePostgrest.test.ts`
Expected: FAIL con `Cannot find module '../fakePostgrest'`

- [x] **Step 3: Implementar el doble**

Reglas no negociables:

1. `NATURAL_KEYS = { day_logs: ['athlete_id', 'date'], week_summaries: ['athlete_id', 'week_start_date'] }`.
2. `upsert` sin `onConflict`: resuelve por `id`. Si el `id` entrante difiere del
   de una fila que ya ocupa esa clave natural, devuelve
   `{ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }`.
3. `upsert` con `onConflict`: resuelve por esa clave, conservando el `id` de la
   fila existente.
4. Toda operación empuja una entrada a `trace` con `filters`, `columns`, `code`
   (si hubo error) y `matched`.
5. `update(...).lt('updated_at', ts)` afecta solo filas con `updated_at < ts`.
   Cero filas devuelve `{ data: [], error: null }` — **no es un error**
   (`syncService.ts:1766`).
6. Todo método encadenado no implementado lanza
   `new Error('fakePostgrest: unsupported query — <detalle>')`.

- [x] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/testing/syncHarness/__tests__/fakePostgrest.test.ts`
Expected: PASS (5 casos)

---

## Task 2: Wiring — conectar `syncService` al doble

Sin esta tarea todo lo demás es decorativo: `syncService` hablaría con el cliente
real (`null` en tests) y cada `push*` saldría por la puerta de atrás.

**El registro debe vivir en un módulo puro.** `useAuthStore` importa
`../services/auth` (`useAuthStore.ts:4`), así que si la factory del mock importa
un módulo que a su vez importa el store, se forma un ciclo
`auth → harnessEnv → useAuthStore → auth`. Por eso el registro se separa en
`backendRegistry.ts`, que **no importa nada de la aplicación**.

**Files:**
- Create: `src/testing/syncHarness/backendRegistry.ts`
- Create: `src/testing/syncHarness/harnessEnv.ts`
- Test: `src/testing/syncHarness/__tests__/harnessEnv.test.ts`

**Interfaces:**
- Produces:
  - `backendRegistry.ts`: `setActiveFakeBackend(backend: FakePostgrest | null): void`, `getActiveFakeBackend(): FakePostgrest | null`
  - `harnessEnv.ts`: `installSyncHarnessEnv(userId: string): void`, `restoreSyncHarnessEnv(): void`, `HARNESS_USER_ID = 'harness-user'`, `HARNESS_SELF_ATHLETE_ID = `ath_${HARNESS_USER_ID}``

- [x] **Step 1: Escribir el test que falla**

El `vi.mock` es **hoisted y por archivo**: no se hereda entre archivos de test.
Cada archivo de integración repite estas cinco líneas. No hay forma de
centralizarlo en un helper importado, porque el hoisting corre antes de los
imports.

```ts
// Cabecera obligatoria de TODO archivo de integración del harness.
vi.mock('../../../services/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { getActiveFakeBackend } = await import('../backendRegistry')
  return { ...actual, isSupabaseConfigured: true, get supabase() { return getActiveFakeBackend()?.client ?? null } }
})
```

El getter es deliberado: `setActiveFakeBackend` cambia por test, y un valor
capturado una sola vez dejaría a todos los tests hablando con el primer backend.

```ts
// src/testing/syncHarness/__tests__/harnessEnv.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakePostgrest } from '../fakePostgrest'
import { setActiveFakeBackend } from '../backendRegistry'
import { HARNESS_SELF_ATHLETE_ID, HARNESS_USER_ID, installSyncHarnessEnv, restoreSyncHarnessEnv } from '../harnessEnv'
import { useAuthStore } from '../../../store/useAuthStore'

vi.mock('../../../services/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { getActiveFakeBackend } = await import('../backendRegistry')
  return { ...actual, isSupabaseConfigured: true, get supabase() { return getActiveFakeBackend()?.client ?? null } }
})

afterEach(() => { restoreSyncHarnessEnv(); setActiveFakeBackend(null) })

describe('harnessEnv', () => {
  it('deja a syncService escribiendo contra el doble', async () => {
    const backend = createFakePostgrest()
    setActiveFakeBackend(backend)
    installSyncHarnessEnv(HARNESS_USER_ID)

    expect(useAuthStore.getState().user?.id).toBe(HARNESS_USER_ID)

    const { pushDayLog } = await import('../../../services/syncService')
    await pushDayLog({
      id: 'log-1', athleteId: HARNESS_SELF_ATHLETE_ID, date: '2026-08-12', updatedAt: 100,
    } as never)

    expect(backend.rows('day_logs')).toHaveLength(1)
  })
})
```

- [x] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/testing/syncHarness/__tests__/harnessEnv.test.ts`
Expected: FAIL con `Cannot find module '../backendRegistry'`

- [x] **Step 3: Implementar**

`backendRegistry.ts` — módulo puro, sin imports de la app:

```ts
import type { FakePostgrest } from './fakePostgrest'
let active: FakePostgrest | null = null
export function setActiveFakeBackend(backend: FakePostgrest | null): void { active = backend }
export function getActiveFakeBackend(): FakePostgrest | null { return active }
```

`installSyncHarnessEnv(userId)`:
1. `vi.stubEnv('VITE_SUPABASE_URL', 'https://harness.test')`,
   `vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'harness-anon-key')` y
   `vi.stubEnv('VITE_ATHLETE_SCOPE', 'true')` — sin la URL `isEnabled()` es
   `false` y **todo push sale sin hacer nada**; sin el scope activo, los casos de
   aislamiento por atleta pasan trivialmente.
2. `useAuthStore.setState({ user: { id: userId } as never })` — sin esto
   `getUserId()` devuelve `null` y `push*` retorna temprano.
3. `vi.useFakeTimers()` — el reintento de cola es real; `clearAllTimers()` solo
   no impide que quede vivo.

`restoreSyncHarnessEnv()`: `vi.unstubAllEnvs()`, `vi.useRealTimers()` y restaura
el estado previo de `useAuthStore` capturado al instalar.

- [x] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/testing/syncHarness/__tests__/harnessEnv.test.ts`
Expected: PASS

---

## Task 3: Snapshot por dispositivo

**Files:**
- Create: `src/testing/syncHarness/deviceHarness.ts`
- Test: `src/testing/syncHarness/__tests__/deviceHarness.test.ts`

**Interfaces:**
- Consumes: Task 1 y Task 2.
- Produces:
  - `createDeviceHarness(backend: FakePostgrest): DeviceHarness`
  - `DeviceHarness.withDevice(name: string, fn: () => Promise<void>): Promise<void>`
  - `DeviceHarness.snapshotOf(name: string): DeviceSnapshot`
  - `DeviceHarness.seedSnapshot(name: string, dexie: Record<string, unknown[]>): void`
  - `DeviceHarness.dispose(): Promise<void>`
  - `DeviceHarness.setOnline(online: boolean): void` — fija `navigator.onLine`
    del dispositivo en curso y lo persiste en su snapshot; lo usa el caso
    offline→online de Task 7
  - `DeviceHarness.ownershipOf(name: string): Map<string, string>` — `"tabla/id" → athleteId`, registrado la primera vez que se ve cada fila
  - ```ts
    type DeviceSnapshot = {
      dexie: Record<string, unknown[]>
      localStorage: Record<string, string>
      activeAthleteId: string | null
      selfAthleteId: string | null
      auth: { user: unknown; syncDetails: unknown }
      training: { requestedWeekStart: string | null; loadedWeekStart: string | null; sessions: unknown[]; currentWeekSummary: unknown }
      online: boolean
    }
    ```

**Slices, no stores completos.** Los snapshots guardan solo campos de datos y se
restauran con `setState(slice)`, que hace merge: los métodos del store
sobreviven. Serializar el store entero los borraría.

- [x] **Step 1: Escribir el test que falla**

```ts
it('aísla la cola de sync entre dispositivos', async () => {
  const harness = createDeviceHarness(createFakePostgrest())
  await harness.withDevice('A', async () => { localStorage.setItem('probe', 'de-A') })
  await harness.withDevice('B', async () => {
    expect(localStorage.getItem('probe')).toBeNull()
    localStorage.setItem('probe', 'de-B')
  })
  await harness.withDevice('A', async () => {
    expect(localStorage.getItem('probe')).toBe('de-A')
  })
  await harness.dispose()
})

it('restaura el entorno aunque el callback falle', async () => {
  const harness = createDeviceHarness(createFakePostgrest())
  const before = useTrainingStore.getState().requestedWeekStart
  await expect(harness.withDevice('A', async () => { throw new Error('boom') })).rejects.toThrow('boom')
  await harness.dispose()
  expect(useTrainingStore.getState().requestedWeekStart).toBe(before)
  expect(typeof useTrainingStore.getState().loadWeek).toBe('function')
})
```

- [x] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/testing/syncHarness/__tests__/deviceHarness.test.ts`
Expected: FAIL con `Cannot find module '../deviceHarness'`

- [x] **Step 3: Implementar**

`withDevice(name, fn)`, con `try/finally` para que un fallo del callback no
deje el entorno contaminado:

1. Guarda el snapshot del dispositivo anterior, si hubo.
2. `vi.clearAllTimers()`.
3. Restaura el snapshot de `name` (o inicializa vacío): limpia y repuebla todas
   las tablas Dexie, reemplaza `localStorage`, fija
   `activeAthleteId`/`selfAthleteId`, aplica los slices de `useAuthStore` y
   `useTrainingStore` con `setState`, y fija `navigator.onLine` con
   `Object.defineProperty`.
4. `await fn()` dentro de `try`; en `finally`, vuelve a snapshotear `name`.

`dispose()` restaura Dexie, `localStorage`, ambos stores, timers y entorno al
estado previo a crear el harness. Los tests lo llaman en `afterEach`.

`ownershipOf`: al snapshotear, registra `"tabla/id" → athleteId` para cada fila
nueva. No sobrescribe una entrada existente — así conserva el dueño original y
`assertNoScopeLeak` puede detectar un cambio de dueño.

- [x] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/testing/syncHarness/__tests__/deviceHarness.test.ts`
Expected: PASS

---

## Task 4: Aserciones de salida

**Files:**
- Create: `src/testing/syncHarness/syncExitCriteria.ts`
- Test: `src/testing/syncHarness/__tests__/syncExitCriteria.test.ts`

**Interfaces:**
- Produces:
  - `assertConverged(harness, a: string, b: string, table: string): void`
  - `assertQueuesDrained(harness, names: string[]): void`
  - `assertNoResurrection(harness, table: string, ids: string[], names: string[]): void`
  - `assertNoScopeLeak(harness, names: string[], activeAthleteId: string): void`
  - `assertTrace(backend, expected: { conflicts?: number; naturalKeySelects?: number; conditionalUpdates?: number }): void`

- [x] **Step 1: Escribir el test que falla**

```ts
it('assertConverged falla cuando los dispositivos difieren', () => {
  const harness = createDeviceHarness(createFakePostgrest())
  harness.seedSnapshot('A', { sessions: [{ id: 's1', updatedAt: 2 }] })
  harness.seedSnapshot('B', { sessions: [{ id: 's1', updatedAt: 1 }] })
  expect(() => assertConverged(harness, 'A', 'B', 'sessions')).toThrow(/no convergen/)
})

it('assertNoScopeLeak detecta que una fila cambió de dueño', () => {
  const harness = createDeviceHarness(createFakePostgrest())
  harness.seedSnapshot('A', { sessions: [{ id: 's1', athleteId: HARNESS_SELF_ATHLETE_ID }] })
  harness.seedSnapshot('A', { sessions: [{ id: 's1', athleteId: 'ath-2' }] })
  expect(() => assertNoScopeLeak(harness, ['A'], 'ath-1')).toThrow(/cambió de athleteId/)
})

it('assertTrace no cuenta los selects genéricos de runFullSync', () => {
  const backend = createFakePostgrest()
  backend.trace.push({ op: 'select', table: 'sessions', columns: '*', filters: [{ op: 'eq', column: 'user_id', value: 'u1' }] })
  expect(() => assertTrace(backend, { naturalKeySelects: 1 })).toThrow(/naturalKeySelects/)
})
```

- [x] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/testing/syncHarness/__tests__/syncExitCriteria.test.ts`
Expected: FAIL

- [x] **Step 3: Implementar**

`assertNoScopeLeak(harness, names, activeAthleteId)`: para cada dispositivo,
compara cada fila contra `ownershipOf(name)` y falla si el `athleteId` cambió
(`/cambió de athleteId/`). Además, afirma que la proyección visible
(`training.sessions`) contiene solo filas de `activeAthleteId`. **No** exige que
Dexie carezca de filas de otros atletas: cachear varios es legítimo.

`assertTrace`: cuenta por forma, no por tipo.
- `conflicts`: entradas con `code === '23505'`.
- `naturalKeySelects`: `op === 'select'` **y** `columns === 'id, updated_at'`
  **y** `filters` contiene tres `eq` sobre `user_id`, `athlete_id` y la columna
  de fecha natural.
- `conditionalUpdates`: `op === 'update'` con un filtro
  `{ op: 'lt', column: 'updated_at' }`. Distinguirlo de un `eq` sobre la misma
  columna es la razón de que `filters` sea una lista tipada.

`assertQueuesDrained`: la cola en `localStorage` de cada dispositivo está vacía.

- [x] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/testing/syncHarness/__tests__/syncExitCriteria.test.ts`
Expected: PASS

---

## Task 5: Clave natural — `day_logs` y `week_summaries`

**Files:**
- Create: `src/testing/syncHarness/__tests__/naturalKeyConflict.test.ts`

**Todos los casos normales usan `HARNESS_SELF_ATHLETE_ID`.** Un id arbitrario
como `ath-1` es tratado por `ensureRemoteAthleteOnce` como atleta **gestionado**
(`syncService.ts:2219`) y exige una fila en `db.athletes`; el caso fallaría por
el fixture y no por sync. Los tests del doble (Task 1) sí pueden usar ids libres:
no pasan por esa ruta.

Cada test empieza con `setActiveFakeBackend(backend)` +
`installSyncHarnessEnv(HARNESS_USER_ID)` y termina con
`await harness.dispose()` en `afterEach`. Todas las llamadas a sync usan
`runFullSync(HARNESS_USER_ID)` — **el argumento es obligatorio**
(`syncService.ts:3276`).

- [x] **Step 1: Escribir el caso de `day_logs`**

```ts
it('reconcilia un 23505 de day_logs y converge', async () => {
  await harness.withDevice('A', async () => {
    await db.dayLogs.put({ id: 'log-a', athleteId: HARNESS_SELF_ATHLETE_ID, date: '2026-08-12', updatedAt: 100 } as never)
    await pushDayLog(await db.dayLogs.get('log-a') as never)
  })
  await harness.withDevice('B', async () => {
    await db.dayLogs.put({ id: 'log-b', athleteId: HARNESS_SELF_ATHLETE_ID, date: '2026-08-12', updatedAt: 200 } as never)
    await pushDayLog(await db.dayLogs.get('log-b') as never)
  })

  assertTrace(backend, { conflicts: 1, naturalKeySelects: 1, conditionalUpdates: 1 })

  await harness.withDevice('B', async () => { await runFullSync(HARNESS_USER_ID) })
  await harness.withDevice('A', async () => { await runFullSync(HARNESS_USER_ID) })

  assertConverged(harness, 'A', 'B', 'dayLogs')
  assertQueuesDrained(harness, ['A', 'B'])
  assertNoScopeLeak(harness, ['A', 'B'], HARNESS_SELF_ATHLETE_ID)
})
```

- [x] **Step 2: Correr y verificar que falla por la razón correcta**

Run: `npx vitest run src/testing/syncHarness/__tests__/naturalKeyConflict.test.ts`
Expected: FAIL. Si falla con `fakePostgrest: unsupported query`, **implementar
esa forma en el doble con su propio test en `fakePostgrest.test.ts`** y volver.
Es la señal de diseño funcionando, no un problema del caso.

- [x] **Step 3: Iterar hasta verde**

- [x] **Step 4: Repetir para `week_summaries`**

Mismo caso con `db.weekSummaries`, `pushWeekSummary` y
`weekStartDate: '2026-08-10'`. Comparte el camino de reconciliación pero con
otra columna natural, y sin él la spec §2 queda cubierta a medias.

- [x] **Step 5: Verificación de cierre**

Run: `npm test && npx tsc -b && npm run lint && npm run build && git diff --check`

---

## Task 6: `sessions` — LWW y desempate remoto

**Files:**
- Create: `src/testing/syncHarness/__tests__/sessionConvergence.test.ts`

Constantes fijadas, para que los dos casos no se contaminen:

```ts
const LWW_A_UPDATED_AT = 2000   // versión ganadora
const LWW_B_UPDATED_AT = 1000   // más antigua, llega última
const TIE_UPDATED_AT = 3000     // idéntico en ambos dispositivos
const SYNC_ROUNDS = 3
```

**Los fixtures remotos necesitan `data.weekStartDate`.** `rowToSession` hace
`...data` (`syncService.ts:1783-1795`), así que una fila sin ese campo produce
una sesión inválida y el caso fallaría por el fixture, no por sync:

```ts
function remoteSessionRow(overrides: Record<string, unknown>) {
  return {
    id: 's1', user_id: HARNESS_USER_ID, athlete_id: HARNESS_SELF_ATHLETE_ID,
    date: '2026-08-12', type: 'squash', status: 'planned',
    time_block: 'AM', created_at: 1, updated_at: 1,
    data: { weekStartDate: '2026-08-10', title: 'base', durationMin: 60, timeBlock: 'AM' },
    ...overrides,
  }
}
```

- [x] **Step 1: Escribir el caso LWW con llegada fuera de orden**

```ts
it('conserva la versión más nueva aunque la más antigua llegue última', async () => {
  await harness.withDevice('A', async () => {
    await db.sessions.put({ id: 's1', athleteId: HARNESS_SELF_ATHLETE_ID, weekStartDate: '2026-08-10', date: '2026-08-12', title: 'A gana', updatedAt: LWW_A_UPDATED_AT } as never)
    await pushSession(await db.sessions.get('s1') as never)
  })
  await harness.withDevice('B', async () => {
    await db.sessions.put({ id: 's1', athleteId: HARNESS_SELF_ATHLETE_ID, weekStartDate: '2026-08-10', date: '2026-08-12', title: 'B pierde', updatedAt: LWW_B_UPDATED_AT } as never)
    await pushSession(await db.sessions.get('s1') as never)
  })

  for (let round = 0; round < SYNC_ROUNDS; round++) {
    await harness.withDevice('A', async () => { await runFullSync(HARNESS_USER_ID) })
    await harness.withDevice('B', async () => { await runFullSync(HARNESS_USER_ID) })
  }

  expect(harness.snapshotOf('A').dexie.sessions).toMatchObject([{ title: 'A gana' }])
  expect(harness.snapshotOf('B').dexie.sessions).toMatchObject([{ title: 'A gana' }])
  expect(backend.rows('sessions')).toMatchObject([{ data: expect.objectContaining({ title: 'A gana' }) }])
  assertQueuesDrained(harness, ['A', 'B'])
})
```

- [x] **Step 2: Correr, iterar sobre el doble hasta verde**

- [x] **Step 3: Caracterizar el empate y, tras aprobar el follow-up, invertirlo a convergencia**

La primera versión documentó la divergencia sin `it.fails`. Al aplicar el cambio
productivo separado, se invirtió para exigir que el backend —B, la última versión
remota aceptada— gane el empate:

```ts
it('desempata a favor de la versión remota cuando updatedAt es idéntico', async () => {
  await harness.withDevice('A', async () => {
    await db.sessions.put({ id: 's1', athleteId: HARNESS_SELF_ATHLETE_ID, weekStartDate: '2026-08-10', date: '2026-08-12', title: 'version A', updatedAt: TIE_UPDATED_AT } as never)
    await pushSession(await db.sessions.get('s1') as never)
  })
  await harness.withDevice('B', async () => {
    await db.sessions.put({ id: 's1', athleteId: HARNESS_SELF_ATHLETE_ID, weekStartDate: '2026-08-10', date: '2026-08-12', title: 'version B', updatedAt: TIE_UPDATED_AT } as never)
    await pushSession(await db.sessions.get('s1') as never)
  })

  for (let round = 0; round < SYNC_ROUNDS; round++) {
    await harness.withDevice('A', async () => { await runFullSync(HARNESS_USER_ID) })
    await harness.withDevice('B', async () => { await runFullSync(HARNESS_USER_ID) })
  }

  const a = harness.snapshotOf('A').dexie.sessions as Array<{ title: string }>
  const b = harness.snapshotOf('B').dexie.sessions as Array<{ title: string }>
  expect(a[0]?.title).toBe('version B')
  expect(b[0]?.title).toBe('version B')
  expect(backend.rows('sessions')).toMatchObject([{ data: expect.objectContaining({ title: 'version B' }) }])
  assertConverged(harness, 'A', 'B', 'sessions')
})
```

- [x] **Step 4: Correr y verificar que pasan ambos**

- [x] **Step 5: Verificación de cierre**

---

## Task 7: Delete offline→online y aislamiento entre dos atletas

Sin esta tarea, `assertNoResurrection`, `assertQueuesDrained` y
`assertNoScopeLeak` pasan trivialmente: nunca se borra nada, la cola nunca se
llena y solo existe un atleta.

**Files:**
- Create: `src/testing/syncHarness/__tests__/deleteAndScope.test.ts`

- [x] **Step 1: Escribir el caso offline→online con delete**

Tres precisiones que deciden si el caso prueba algo:

1. `deleteSessionForTarget` ejecuta **solo** el camino remoto
   (`syncService.ts:2457-2471`): hay que borrar de Dexie a mano, o el "borrado"
   nunca ocurre localmente.
2. La cola se inspecciona **después de cerrar el turno**: `snapshotOf('A')`
   dentro de `withDevice` todavía devuelve el snapshot anterior, porque el
   nuevo se toma en el `finally`.
3. La ausencia se verifica también en el backend, no solo en los dispositivos.

```ts
it('un borrado offline drena al reconectar y no resucita', async () => {
  await harness.withDevice('A', async () => {
    await db.sessions.put({ id: 's-del', athleteId: HARNESS_SELF_ATHLETE_ID, weekStartDate: '2026-08-10', date: '2026-08-12', title: 'a borrar', updatedAt: 100 } as never)
    await pushSession(await db.sessions.get('s-del') as never)
  })
  await harness.withDevice('B', async () => { await runFullSync(HARNESS_USER_ID) })
  expect(harness.snapshotOf('B').dexie.sessions).toHaveLength(1)

  // Turno offline: borra local y encola el delete remoto.
  await harness.withDevice('A', async () => {
    harness.setOnline(false)
    await db.sessions.delete('s-del')
    // `RemoteSessionTarget` exige `kind` (`sync/remoteSessionTarget.ts:4-6`).
    // Sin él, el drain descarta la op como `queue:invalid_session_target_drop`
    // (`syncService.ts:1046`) y el caso terminaría verde por el tombstone
    // posterior, sin haber ejercitado el replay de la cola.
    await deleteSessionForTarget('s-del', { kind: 'scoped', athleteId: HARNESS_SELF_ATHLETE_ID })
  })

  // Fuera del turno: recién ahora el snapshot de A refleja lo ocurrido.
  const queued = JSON.stringify(harness.snapshotOf('A').localStorage)
  expect(queued).toContain('s-del')

  // Turno online: drena.
  await harness.withDevice('A', async () => {
    harness.setOnline(true)
    await runFullSync(HARNESS_USER_ID)
  })
  await harness.withDevice('B', async () => { await runFullSync(HARNESS_USER_ID) })

  expect(backend.rows('sessions').find((row) => row.id === 's-del')).toBeUndefined()
  assertNoResurrection(harness, 'sessions', ['s-del'], ['A', 'B'])
  assertQueuesDrained(harness, ['A', 'B'])
})
```

- [x] **Step 2: Escribir el caso de dos atletas**

El segundo atleta es **gestionado**, así que necesita su fila en `db.athletes`
antes de empujar; si no, `ensureRemoteAthleteOnce` no lo reconoce. Y la
aserción real es sobre la **proyección visible** tras `loadWeek`, no sobre el
contenido de Dexie: cachear ambos atletas es legítimo.

```ts
it('con dos atletas la semana visible proyecta solo el activo', async () => {
  const managedAthleteId = 'ath-managed-1'

  await harness.withDevice('A', async () => {
    await db.athletes.bulkPut([
      { id: HARNESS_SELF_ATHLETE_ID, ownerAccountId: HARNESS_USER_ID, linkedAccountId: HARNESS_USER_ID, status: 'active', createdAt: 1, updatedAt: 1 },
      { id: managedAthleteId, ownerAccountId: HARNESS_USER_ID, status: 'active', createdAt: 1, updatedAt: 1 },
    ] as never)

    setActiveAthleteId(HARNESS_SELF_ATHLETE_ID)
    await db.sessions.put({ id: 's-1', athleteId: HARNESS_SELF_ATHLETE_ID, weekStartDate: '2026-08-10', date: '2026-08-12', title: 'del self', updatedAt: 100 } as never)
    await pushSession(await db.sessions.get('s-1') as never)

    setActiveAthleteId(managedAthleteId)
    await db.sessions.put({ id: 's-2', athleteId: managedAthleteId, weekStartDate: '2026-08-10', date: '2026-08-12', title: 'del gestionado', updatedAt: 100 } as never)
    await pushSession(await db.sessions.get('s-2') as never)

    setActiveAthleteId(HARNESS_SELF_ATHLETE_ID)
    await runFullSync(HARNESS_USER_ID)
    await useTrainingStore.getState().loadWeek('2026-08-10')
  })

  const visible = harness.snapshotOf('A').training.sessions as Array<{ id: string }>
  expect(visible.map((row) => row.id)).toContain('s-1')
  expect(visible.map((row) => row.id)).not.toContain('s-2')
  assertNoScopeLeak(harness, ['A'], HARNESS_SELF_ATHLETE_ID)
})
```

`VITE_ATHLETE_SCOPE=true` ya lo instala `installSyncHarnessEnv` (Task 2). Sin
esa flag el filtrado por scope no se aplica y el caso pasaría sin probar nada.

- [x] **Step 3: Correr, iterar hasta verde**

- [x] **Step 4: Verificación de cierre**

Run: `npm test && npx tsc -b && npm run lint && npm run build && git diff --check`

---

## Task 8: Semana visible estable durante el merge

**Files:**
- Modify: `src/testing/syncHarness/syncExitCriteria.ts`
- Create: `src/testing/syncHarness/__tests__/visibleWeekStability.test.ts`

**Interfaces:**
- Produces: `assertVisibleWeekStable(recorded: TrainingStoreTransition[]): void`
  con `type TrainingStoreTransition = { requestedWeekStart: string | null; loadedWeekStart: string | null; sessionWeekStarts: string[]; summaryWeekStart: string | null }`

**`pullSessionsForDateRange` no toca `useTrainingStore`** — escribe solo
`db.sessions` (`syncService.ts:2585-2588`). Observar solo ese pull registraría
cero transiciones y el test sería vacuo. El caso debe reproducir la **secuencia
de prioridad completa** del bootstrap (`App.tsx:254-265`): resolver el destino,
pull acotado, volver a resolver el destino y `loadWeek`.

- [x] **Step 1: Escribir el test que falla**

**El caso debe partir de una semana vieja realmente cargada.** Si el store
arranca vacío, la transición va de "nada" a "semana nueva" y la fila vieja nunca
participa: no hay forma de que aparezcan dos semanas mezcladas, y el test pasa
sin probar nada.

```ts
it('ninguna transición combina datos de semanas distintas durante el refresh', async () => {
  backend.seed('sessions', [
    remoteSessionRow({ id: 's-old', date: '2026-08-05', data: { weekStartDate: '2026-08-03', title: 'vieja', durationMin: 60, timeBlock: 'AM' } }),
    remoteSessionRow({ id: 's-new', date: '2026-08-12', data: { weekStartDate: '2026-08-10', title: 'nueva', durationMin: 60, timeBlock: 'AM' } }),
  ])

  const transitions: TrainingStoreTransition[] = []

  await harness.withDevice('A', async () => {
    // 1. Estado de partida: la semana VIEJA está cargada con sus datos.
    await db.sessions.put({ id: 's-old', athleteId: HARNESS_SELF_ATHLETE_ID, weekStartDate: '2026-08-03', date: '2026-08-05', title: 'vieja', durationMin: 60, timeBlock: 'AM', updatedAt: 10 } as never)
    await useTrainingStore.getState().loadWeek('2026-08-03')
    expect(useTrainingStore.getState().loadedWeekStart).toBe('2026-08-03')
    expect(useTrainingStore.getState().sessions).toHaveLength(1)

    // 2. El usuario pide la semana nueva; recién ahí empezamos a observar.
    useTrainingStore.setState({ requestedWeekStart: '2026-08-10' })
    const unsubscribe = useTrainingStore.subscribe((state) => {
      transitions.push({
        requestedWeekStart: state.requestedWeekStart,
        loadedWeekStart: state.loadedWeekStart,
        sessionWeekStarts: [...new Set(state.sessions.map((session) => session.weekStartDate))],
        summaryWeekStart: state.currentWeekSummary?.weekStartDate ?? null,
      })
    })

    // 3. Secuencia del bootstrap: resolver destino → pull acotado → releer → cargar.
    const target = resolveWeekStartToRefresh(useTrainingStore.getState(), '2026-08-10')
    await pullSessionsForDateRange(target, toISO(addDays(fromISO(target), 6)))
    const finalTarget = resolveWeekStartToRefresh(useTrainingStore.getState(), '2026-08-10')
    await useTrainingStore.getState().loadWeek(finalTarget)

    unsubscribe()
  })

  // Sin esto el test pasaría por no observar nada.
  expect(transitions.length).toBeGreaterThan(0)
  assertVisibleWeekStable(transitions)
})
```

- [x] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/testing/syncHarness/__tests__/visibleWeekStability.test.ts`
Expected: FAIL con `assertVisibleWeekStable is not a function`

- [x] **Step 3: Implementar la aserción**

Falla si **alguna** transición cumple cualquiera de estas:

- `sessionWeekStarts` tiene más de un valor — mezcla semanas en la misma vista;
- hay sesiones expuestas y su `weekStartDate` no es `loadedWeekStart`;
- `summaryWeekStart` no es nulo y difiere de `loadedWeekStart`.

**No** falla por `requestedWeekStart !== loadedWeekStart` a secas: durante una
transición eso es válido mientras la UI no proyecte los datos viejos, que es
exactamente lo que PR #11 dejó preparado. Lo que se prohíbe es la **proyección**
inconsistente, no el estado intermedio.

El mensaje de error incluye el índice de la transición culpable y sus cuatro
campos; sin eso, depurar una transición intermedia es adivinar.

- [x] **Step 4: Correr y verificar que pasa**

- [x] **Step 5: Verificación de cierre**

---

## Definition of done

- [x] El doble lanza ante consultas no soportadas, con test que lo demuestra.
- [x] `syncService` escribe de verdad contra el doble (Task 2 verde).
- [x] Un caso de clave natural produce `23505`, lo reconcilia y converge, con
      traza afirmada por forma —no por conteo bruto de selects—, en `day_logs`
      y en `week_summaries`.
- [x] El caso LWW conserva la versión de A en A, B y backend tras `SYNC_ROUNDS`.
- [x] El test del empate converge en la versión remota aceptada por el backend.
- [x] Un delete offline llena la cola, drena al reconectar y no resucita.
- [x] Un caso con dos atletas demuestra que ninguna fila cambia de dueño.
- [x] Alguna transición del store se registra, y ninguna combina semanas.
- [x] `dispose()` restaura Dexie, storage, stores, timers y entorno aunque el
      callback falle.
- [x] Tasks 1–8 no cambiaron producción; el desempate se aplicó después como follow-up separado.
- [x] Suite completa, `tsc -b`, lint, build y `git diff --check` verdes.

---

## Cierre — desviaciones y hallazgos (2026-08-12)

Ejecutado completo, incluido el follow-up productivo. **411 archivos / 3352
tests**, `tsc -b`, lint, build y `git diff --check` verdes. 42 tests en
`src/testing/syncHarness/`.

### Defectos del doble encontrados por sus propios casos

Los tres eran **falsos verdes silenciosos**: la consulta devolvía vacío o el
fail-fast se volvía un no-op, y el caso pasaba sin haber ejercitado nada.

1. **Identidad del proxy perdida al encadenar.** Los métodos devolvían
   `builder`, no el proxy, así que `.or` y `.range` quedaban `undefined` tras la
   primera llamada; `fetchAll` fallaba con un TypeError común que `runFullSync`
   se tragaba. Corregido devolviendo `proxied` en todos los métodos, con un test
   que ejercita el fail-fast **después** de encadenar — el test original sólo
   probaba el proxy recién creado y por eso no lo vio.
2. **Comparación numérica de fechas.** `lt`/`lte`/`gte` usaban `Number(...)`, y
   `Number('2026-08-12')` es `NaN`: toda comparación daba `false` y
   `pullSessionsForDateRange` devolvía vacío. Descubierto porque el caso de
   Task 8 registraba la semana nueva **sin sesiones**. Corregido con
   `compareValues`, que cae a comparación lexicográfica —el orden de Postgres
   para `date` y `text`, y para ISO-8601 coincide con el cronológico.
3. **Gramática de `or` validada al recorrer filas.** Con tabla vacía o
   cortocircuito de `some`, una cláusula inválida nunca se evaluaba. Ahora la
   expresión se **compila al llamar `.or()`**, y el compilador cubre `and(...)`
   anidado e `is.null`, que es la forma que usan sesiones
   (`syncService.ts:2560`) y `buildScopeFilter` (`syncSupabase.ts:94`).

### Otras correcciones del harness

- **`onConflict` sólo resuelve por clave natural si nombra esas columnas.**
  Antes cualquier valor truthy servía, así que `{ onConflict: 'id' }` —lo que
  usan sessions y athletes— habría escondido el `23505`.
- **Timers cancelados en cada frontera de `withDevice`**, no sólo al cerrar el
  test: el delete offline programa un retry real (`syncService.ts:2472`) que en
  un caso largo despertaría con el otro dispositivo restaurado.
- **`auth.user` y `useAuthStore.activeAthleteId` snapshoteados y restaurados.**
  El holder de módulo y el store pueden divergir, y el store es lo que lee la UI.
- **`assertConverged` compara canónicamente** (`canonicalJson`). Un dispositivo
  que escribió la fila y otro que la hidrató producen las mismas claves en
  distinto orden; declarar eso "no convergen" enterraría las divergencias reales.
- **Señal terminal exacta:** `syncStatus === 'idle'` y `syncError === null`.
  `!== 'error'` también admitía `offline`, `degraded` y `syncing`.

### Verificado por falsificación, no sólo por verde

Cada caso se puso rojo rompiendo deliberadamente la implementación, y el árbol
se restauró después:

| Caso | Rotura aplicada | Resultado |
|---|---|---|
| LWW fuera de orden | quitar la rama `remote.updatedAt > local.updatedAt` | rojo |
| Desempate remoto | volver de `>=` a `>` | rojo |
| Delete offline→online | `drainQueue` devolviendo `false` | rojo, en el assert del backend |
| Dos atletas | quitar el filtro de `getSessionsForWeekCore` | rojo |
| Timers en la frontera | quitar `clearTrackedTimers()` de `withDevice` | rojo |

El caso de semana visible se hizo no-vacuo con dos aserciones extra: la primera
transición debe mostrar la semana vieja con datos y la última la nueva con
datos. Sin ellas pasaba observando transiciones vacías — que es como se destapó
el defecto de fechas.

### Fixture, no hallazgo

`authoredByRole` aparecía sólo en el dispositivo que hidrataba desde el backend.
Es un artefacto del fixture: producción lo estampa al crear
(`useTrainingStore.ts:158`) y `sessionToRow` lo deriva al subir
(`syncService.ts:1571`). Los fixtures del harness lo incluyen.

### Follow-up productivo cerrado

El desempate remoto se implementó después del harness como cambio separado. La
regla `remote.updatedAt >= local.updatedAt` vive en `remoteSessionWins` y se usa
en `runFullSync`, `pullSessionsForDateRange` y `pullWeekSessionsForAthlete`, para
que los tres caminos resuelvan el mismo conflicto igual. La caracterización se
invirtió a convergencia y se agregaron casos directos para ambos pulls acotados.

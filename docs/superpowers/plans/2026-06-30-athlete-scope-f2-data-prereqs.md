# Athlete Scope — F2 Data Prerequisites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer `day_logs` y `week_summaries` seguros para multi-atleta migrando su clave natural de `fecha` → `(athleteId, fecha)`, sin cambiar el comportamiento single-athlete, como prerequisito de datos de Coach Mode F2.

**Architecture:** Dexie v14 con índice único compuesto `[athleteId+date]` (+ `date` no-único), re-backfill versionado en runtime (marker v2), estampado de `athleteId` al crear, y todas las claves naturales de lookup/merge/repair/delete pasan a usar la **effective athlete key** (`isScopedAthleteId(row.athleteId) ? row.athleteId : (activeAthleteId ?? 'legacy')` — el sentinel `'default'` cuenta como legacy). Migración SQL `008` separada como red de integridad remota.

**Tech Stack:** TypeScript, Dexie (IndexedDB), Supabase, Vitest, fake-indexeddb (test-only).

**Spec:** `docs/superpowers/specs/2026-06-30-athlete-scope-f2-data-prereqs-design.md`

## Global Constraints

- **Prerequisito de datos, NO read-scope completo de F2.** Fuera de alcance: `recalculateWeekSummary`, otros `toArray()`/rangos sin scope, `coach_athlete_links`, `account_type`, UI de coach, contract (NOT NULL / drop user_id).
- **Effective athlete key** = `isScopedAthleteId(row.athleteId) ? row.athleteId : (activeAthleteId ?? 'legacy')`. Merge, repair y dedup la usan — nunca `row.athleteId` crudo. **No** usar `row.athleteId ?? …`: `??` deja pasar el sentinel `'default'` como si fuera un id scoped.
- **Detección de legacy vía `isScopedAthleteId`, no falsy.** El default local es `ATHLETE_PROFILE_LOCAL_ID` (`'default'`), que es truthy: un `!row.athleteId` lo trataría como scoped. Toda decisión "¿es legacy / falta estampar?" usa `!isScopedAthleteId(row.athleteId)` (upsert, fallback de lookup, merge, repair, import).
- **Lookups locales incondicionales:** si hay `activeAthleteId`, las lecturas locales usan la clave compuesta aunque `VITE_ATHLETE_SCOPE` esté off. El flag solo gatea read-scoping remoto.
- **Estampar `athleteId` solo si `getActiveAthleteId()` devuelve string.** Nunca `athleteId: null` (el tipo usa `undefined` para legacy).
- **Fallback de lectura controlado:** compuesto sin match → fila legacy de esa fecha solo si su `athleteId` está ausente/legacy, nunca de otro atleta; puede reparar estampando.
- **Dexie v14** (Whoop diferido → v15). Migración SQL = `008`.
- Verificación de cierre por task: `npm run lint && npm test && npm run build` verdes.

**⚠️ Política de commits:** El owner hace los commits. **NO ejecutar `git commit`/`git add` dentro de las tasks.** Tratar los pasos "Commit" como no-op.

---

## File Structure

```
vitest.setup.ts                              [NEW: import 'fake-indexeddb/auto']
vite.config.ts                               [MODIFY: test.setupFiles]
package.json                                 [MODIFY: devDep fake-indexeddb]

src/services/athlete/
  effectiveAthleteKey.ts                     [NEW: isScopedAthleteId() + effectiveAthleteKey() + isInAthleteScope()]
  athleteScopeMigration.ts                   [MODIFY: marker v1 → v2]
  __tests__/effectiveAthleteKey.test.ts      [NEW]

src/db/
  db.ts                                      [MODIFY: v14 compound indexes]
  queries.ts                                 [MODIFY: stamp on create + athlete-aware lookups + fallback]
  __tests__/athleteScopeV14.test.ts          [NEW: real-Dexie upgrade + compound index]
  __tests__/queriesAthleteScope.test.ts      [NEW]

src/services/
  syncService.ts                             [MODIFY: merge/repair by effective key + deleteMissingLocalRows scope-aware (one captured resolveReadScope snapshot) + finders take remote athlete id (Task 6)]
  sync/syncSupabase.ts                       [MODIFY: fetchAll accepts optional pre-resolved scope so pull + delete share one snapshot (Task 8)]
  dataExport.ts                              [MODIFY: parsers preserve/stamp athleteId + coalesce by natural key (replace + merge branches) + invalidate marker (from useAuthStore) on import]
  __tests__/deleteMissingScope.test.ts       [NEW]
  __tests__/dataExportAthleteId.test.ts      [NEW]

supabase/
  008a_athlete_scope_preflight.sql           [NEW: report-only duplicates + null debt]
  008b_athlete_scope_unique.sql              [NEW: DO-block guard + partial unique index]
```

---

## Task 0: Test harness — fake-indexeddb (habilita tests reales de Dexie)

**Rationale:** los fakes a mano no validan índices únicos compuestos ni upgrades. Esta task instala IndexedDB real en el entorno de test (dev-only, sin impacto en bundle). Los tests existentes que hacen `vi.mock('.../db/db')` no se ven afectados (el mock precede).

**Aislamiento de DB (obligatorio para todo test real de Dexie).** `db` es un singleton (`db.ts:211`, DB name `'EntrenadorDB'`). Vitest aísla el registro de módulos por archivo, pero **dentro** de un archivo el estado (schema abierto + filas) se comparte y provoca flakiness. Regla para Tasks 0/2/4/5 (todo test que use el `db` real):

```typescript
import { db } from '../db'

beforeEach(async () => {
  // Estado limpio y determinista por test: cierra, borra y reabre el singleton.
  db.close()
  await db.delete()
  await db.open()
})

afterEach(async () => {
  db.close()
})
```

`db.delete()` + `db.open()` da estado limpio y valida que el **schema v14** (índices compuestos) se crea bien. **No** basta con `db.dayLogs.clear()`: no resetea schema ni markers de otras tablas. Reemplazar los `beforeEach(async () => { await db.open(); await db.<tabla>.clear() })` de los ejemplos de Tasks 2/4/5 por este patrón.

**Ojo:** borrar y reabrir crea la DB **directamente en v14** — no migra datos v13. Para probar "v13 con datos → v14 sin pérdida" hace falta un test dedicado que primero abra una Dexie declarada solo hasta v13 (mismo DB name), inserte filas, cierre, y **luego** abra la clase real (v14) para que Dexie corra el upgrade. Ese test va en Task 2, Step 4b.

**Files:**
- Modify: `package.json` (devDependencies)
- Create: `vitest.setup.ts`
- Modify: `vite.config.ts`
- Test: `src/db/__tests__/fakeIndexedDbSmoke.test.ts` (Create)

- [ ] **Step 1: Install fake-indexeddb (dev-only)**

Run: `npm install -D fake-indexeddb`
Expected: added to `devDependencies`.

- [ ] **Step 2: Create the setup file**

Create `vitest.setup.ts`:

```typescript
// Provides a real IndexedDB implementation in the Node test environment so Dexie
// schema/upgrade/index behavior can be tested. Test-only; not bundled.
import 'fake-indexeddb/auto'
```

- [ ] **Step 3: Wire setupFiles in vite.config.ts**

In `vite.config.ts`, inside `test: { ... }`, add:

```typescript
    test: {
      setupFiles: ['./vitest.setup.ts'],
      coverage: {
        // ...unchanged
```

- [ ] **Step 4: Write a smoke test that opens the real DB**

Create `src/db/__tests__/fakeIndexedDbSmoke.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../db'

describe('fake-indexeddb harness', () => {
  // Same per-test DB isolation this plan mandates for every real-Dexie test.
  beforeEach(async () => { db.close(); await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('opens the Dexie database and round-trips a row', async () => {
    const id = 'smoke-1'
    await db.dayLogs.put({ id, date: '2026-06-30', updatedAt: Date.now() })
    const row = await db.dayLogs.get(id)
    expect(row?.date).toBe('2026-06-30')
  })
})
```

- [ ] **Step 5: Run smoke + full suite (ensure no regressions)**

Run: `npx vitest run src/db/__tests__/fakeIndexedDbSmoke.test.ts && npm test`
Expected: smoke PASS; full suite still green (mocked-db tests unaffected).

- [ ] **Step 6: Commit** (no-op)

---

## Task 1: `effectiveAthleteKey` helper (puro)

**Files:**
- Create: `src/services/athlete/effectiveAthleteKey.ts`
- Test: `src/services/athlete/__tests__/effectiveAthleteKey.test.ts`

**Interfaces:**
- Produces:
  - `isScopedAthleteId(athleteId: string | null | undefined): athleteId is string` → true only for a **real scoped** id (non-empty string that is not `ATHLETE_PROFILE_LOCAL_ID`). This is the single source of truth for "is this a legacy row"; **`!isScopedAthleteId(x)` replaces every `!x.athleteId` falsy check** so that `athleteId: 'default'` (the local profile sentinel) is correctly treated as legacy, not scoped. Used in upsert stamping (Task 4), lookup fallback (Task 5), merge (Task 6), repair (Task 7), and import stamp/coalesce (Task 9).
  - `effectiveAthleteKey(rowAthleteId: string | null | undefined, activeAthleteId: string | null): string` → `rowAthleteId` if a real scoped id, else `activeAthleteId` if present, else `'legacy'`. Legacy sentinel is the `ATHLETE_PROFILE_LOCAL_ID` value treated as unscoped.
  - `isInAthleteScope(rowAthleteId: string | null | undefined, activeAthleteId: string | null): boolean` → true if the row belongs to the active athlete's scope (its own id, or legacy/unscoped when an athlete is active).
- Consumes: `ATHLETE_PROFILE_LOCAL_ID` from `../athlete/activeAthlete`.

- [ ] **Step 1: Write the failing test**

Create `src/services/athlete/__tests__/effectiveAthleteKey.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { effectiveAthleteKey, isInAthleteScope, isScopedAthleteId } from '../effectiveAthleteKey'

describe('isScopedAthleteId', () => {
  it('is true only for a real scoped id', () => {
    expect(isScopedAthleteId('ath_A')).toBe(true)
  })
  it('treats null/undefined/empty/default as legacy (not scoped)', () => {
    expect(isScopedAthleteId(null)).toBe(false)
    expect(isScopedAthleteId(undefined)).toBe(false)
    expect(isScopedAthleteId('')).toBe(false)
    expect(isScopedAthleteId('default')).toBe(false) // ATHLETE_PROFILE_LOCAL_ID
  })
})

describe('effectiveAthleteKey', () => {
  it('uses the row scoped id when present', () => {
    expect(effectiveAthleteKey('ath_A', 'ath_A')).toBe('ath_A')
    expect(effectiveAthleteKey('ath_B', 'ath_A')).toBe('ath_B')
  })
  it('falls back to the active athlete for legacy rows', () => {
    expect(effectiveAthleteKey(null, 'ath_A')).toBe('ath_A')
    expect(effectiveAthleteKey(undefined, 'ath_A')).toBe('ath_A')
    expect(effectiveAthleteKey('default', 'ath_A')).toBe('ath_A')
  })
  it('is legacy when no active athlete and no scoped id', () => {
    expect(effectiveAthleteKey(null, null)).toBe('legacy')
    expect(effectiveAthleteKey('default', null)).toBe('legacy')
  })
})

describe('isInAthleteScope', () => {
  it('active athlete owns its own rows and legacy/unscoped rows', () => {
    expect(isInAthleteScope('ath_A', 'ath_A')).toBe(true)
    expect(isInAthleteScope(null, 'ath_A')).toBe(true)
    expect(isInAthleteScope('default', 'ath_A')).toBe(true)
    expect(isInAthleteScope('ath_B', 'ath_A')).toBe(false)
  })
  it('no active athlete → everything is in (legacy) scope', () => {
    expect(isInAthleteScope('ath_A', null)).toBe(true)
    expect(isInAthleteScope(null, null)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/athlete/__tests__/effectiveAthleteKey.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `effectiveAthleteKey.ts`**

Create `src/services/athlete/effectiveAthleteKey.ts`:

```typescript
import { ATHLETE_PROFILE_LOCAL_ID } from './activeAthlete'

const LEGACY_KEY = 'legacy'

/**
 * True only for a real scoped athlete id. The single source of truth for "is this a
 * legacy row" — `!isScopedAthleteId(x)` replaces every `!x.athleteId` falsy check so the
 * local profile sentinel `ATHLETE_PROFILE_LOCAL_ID` ('default') is treated as legacy, not
 * scoped (a plain `!x.athleteId` would wrongly consider 'default' already scoped).
 */
export function isScopedAthleteId(athleteId: string | null | undefined): athleteId is string {
  return typeof athleteId === 'string' && athleteId.length > 0 && athleteId !== ATHLETE_PROFILE_LOCAL_ID
}

/** Grouping key for merge/repair/dedup. A legacy (null/'default') row falls under the active athlete. */
export function effectiveAthleteKey(
  rowAthleteId: string | null | undefined,
  activeAthleteId: string | null,
): string {
  if (isScopedAthleteId(rowAthleteId)) return rowAthleteId
  if (activeAthleteId) return activeAthleteId
  return LEGACY_KEY
}

/** Whether a row belongs to the active athlete's read scope (own id, or legacy/unscoped). */
export function isInAthleteScope(
  rowAthleteId: string | null | undefined,
  activeAthleteId: string | null,
): boolean {
  if (!activeAthleteId) return true
  if (!isScopedAthleteId(rowAthleteId)) return true // legacy/unscoped rows belong to the active athlete
  return rowAthleteId === activeAthleteId
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/athlete/__tests__/effectiveAthleteKey.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (no-op)

---

## Task 2: Dexie v14 — índice compuesto + test de upgrade real

**Files:**
- Modify: `src/db/db.ts`
- Test: `src/db/__tests__/athleteScopeV14.test.ts` (Create)

**Interfaces:**
- Produces: `dayLogs` indexed `id, date, athleteId, &[athleteId+date]`; `weekSummaries` indexed `id, weekStartDate, athleteId, &[athleteId+weekStartDate]`.

- [ ] **Step 1: Write the failing test (real Dexie)**

Create `src/db/__tests__/athleteScopeV14.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../db'

describe('Dexie v14 compound natural key', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('allows two athletes to have a day log on the same date', async () => {
    await db.dayLogs.put({ id: 'd1', athleteId: 'ath_A', date: '2026-06-30', updatedAt: 1 })
    await db.dayLogs.put({ id: 'd2', athleteId: 'ath_B', date: '2026-06-30', updatedAt: 1 })
    expect(await db.dayLogs.count()).toBe(2)
  })

  it('enforces uniqueness per (athleteId, date)', async () => {
    await db.dayLogs.put({ id: 'd1', athleteId: 'ath_A', date: '2026-06-30', updatedAt: 1 })
    await expect(
      db.dayLogs.add({ id: 'd3', athleteId: 'ath_A', date: '2026-06-30', updatedAt: 2 }),
    ).rejects.toBeTruthy()
  })

  it('supports compound-range lookups for a week', async () => {
    await db.dayLogs.bulkPut([
      { id: 'a', athleteId: 'ath_A', date: '2026-06-29', updatedAt: 1 },
      { id: 'b', athleteId: 'ath_A', date: '2026-07-01', updatedAt: 1 },
      { id: 'c', athleteId: 'ath_B', date: '2026-06-29', updatedAt: 1 },
    ])
    const rows = await db.dayLogs
      .where('[athleteId+date]')
      .between(['ath_A', '2026-06-29'], ['ath_A', '2026-07-05'], true, true)
      .toArray()
    expect(rows.map((r) => r.id).sort()).toEqual(['a', 'b'])
  })

  it('weekSummaries: two athletes share a week, uniqueness per (athleteId, weekStartDate)', async () => {
    await db.weekSummaries.put({ id: 'w1', athleteId: 'ath_A', weekStartDate: '2026-06-29', updatedAt: 1 })
    await db.weekSummaries.put({ id: 'w2', athleteId: 'ath_B', weekStartDate: '2026-06-29', updatedAt: 1 })
    expect(await db.weekSummaries.count()).toBe(2)
    await expect(
      db.weekSummaries.add({ id: 'w3', athleteId: 'ath_A', weekStartDate: '2026-06-29', updatedAt: 2 }),
    ).rejects.toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/__tests__/athleteScopeV14.test.ts`
Expected: FAIL — `[athleteId+date]` index/uniqueness not present (v13).

- [ ] **Step 3: Add the v14 store definition in `src/db/db.ts`**

After the `this.version(13).stores({...})` block, add:

```typescript
    // v14 — Athlete Scope F2 data prereqs. Natural key of day logs and week
    // summaries becomes (athleteId, date) so multiple athletes can share a date.
    // The prior `&date`/`&weekStartDate` unique becomes a non-unique lookup index,
    // plus a compound unique. Additive otherwise. Runtime re-backfill (marker v2)
    // guarantees every local row has athleteId before the compound index is relied on.
    this.version(14).stores({
      dayLogs:       'id, date, athleteId, &[athleteId+date]',
      weekSummaries: 'id, weekStartDate, athleteId, &[athleteId+weekStartDate]',
    })
```

(Only the two changed stores need to be listed; Dexie carries the rest forward.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/__tests__/athleteScopeV14.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4b: Add an explicit v13-with-data → v14 upgrade test**

The tests above open a freshly deleted DB, which Dexie **creates directly at v14** — they validate the schema/indexes but never migrate real v13 rows. Add a test that builds a v13-shaped DB (same DB name `'EntrenadorDB'`), seeds data, closes it, then opens the real `db` class (v14) so Dexie runs the in-place upgrade, and asserts **no data loss + new compound index works**. Declare the **full v13 store list** in the bare instance (copy the `this.version(13).stores({...})` block from `db.ts:192`) so no store is missing when the real class opens.

```typescript
import Dexie from 'dexie'

it('migrates v13 data to v14 with no loss and a working compound index', async () => {
  db.close()
  await db.delete() // start from nothing

  // A DB declared only up to v13, with the real v13 schema (copy from db.ts version(13)).
  const legacy = new Dexie('EntrenadorDB')
  legacy.version(13).stores({
    sessions:           'id, date, weekStartDate, type, status, completedAt, athleteId',
    dayLogs:            'id, &date, athleteId',
    weekSummaries:      'id, &weekStartDate, athleteId',
    chatMessages:       'id, timestamp, chatSessionId, athleteId',
    coachProposals:     'id, status, createdAt, resolvedAt, chatMessageId, athleteId',
    athleteProfiles:    'id, updatedAt, athleteId',
    trainingPlans:      'id, athleteId, goalEventId, status, startDate, updatedAt',
    trainingPlanWeeks:  'id, planId, weekStartDate, status, [planId+weekIndex], athleteId',
    planGenerationJobs: 'id, planId, athleteId, status, updatedAt, createdAt',
    syncDiagnostics:    '++id, timestamp, kind, entity, status',
    syncErrorLog:       '++id, timestamp, entity, errorCategory',
    aiRequestLogs:      'traceId, requestClass, surface, status, provider, startedAt, completedAt',
    coachFeedback:      'id, targetType, targetId, traceId, proposalId, chatMessageId, rating, createdAt',
    athletes:           'id, ownerAccountId, updatedAt',
  })
  await legacy.open()
  await legacy.table('dayLogs').bulkPut([
    { id: 'd1', date: '2026-06-29', athleteId: 'ath_A', updatedAt: 1, sleepHours: 7 },
    { id: 'd2', date: '2026-06-30', updatedAt: 1 }, // legacy straggler, no athleteId
  ])
  await legacy.table('weekSummaries').put({ id: 'w1', weekStartDate: '2026-06-29', athleteId: 'ath_A', updatedAt: 1 })
  legacy.close()

  // Open the real class → Dexie runs the v13→v14 upgrade on the existing data.
  await db.open()

  // No data loss.
  expect(await db.dayLogs.count()).toBe(2)
  expect((await db.dayLogs.get('d1'))?.athleteId).toBe('ath_A')
  expect((await db.dayLogs.get('d2'))?.athleteId).toBeUndefined() // straggler untouched by the schema upgrade
  expect((await db.weekSummaries.get('w1'))?.weekStartDate).toBe('2026-06-29')

  // New compound index is present and usable.
  const scoped = await db.dayLogs.where('[athleteId+date]').equals(['ath_A', '2026-06-29']).first()
  expect(scoped?.id).toBe('d1')
})
```

> Note: the straggler `d2` stays `athleteId: undefined` — the schema upgrade does **not** backfill (that is the runtime marker-v2 job, Task 3). This test only proves the index migration is lossless; put it in its **own** `describe` (or ensure the `beforeEach` delete runs first) so the manual v13 setup isn't clobbered.

- [ ] **Step 5: Run full suite + build**

Run: `npm test && npm run build`
Expected: green.

- [ ] **Step 6: Commit** (no-op)

---

## Task 3: Marker v2 — re-backfill versionado

**Files:**
- Modify: `src/services/athlete/athleteScopeMigration.ts`
- Test: `src/services/athlete/__tests__/athleteScopeMigration.test.ts` (extend)

**Interfaces:**
- Produces: `invalidateBackfillMarker(ownerAccountId: string): void` (used by import in Task 9).
- Consumes: existing `backfillLocalAthleteScope`.

- [ ] **Step 1: Write the failing test**

Add to `src/services/athlete/__tests__/athleteScopeMigration.test.ts` (uses the file's existing `installLocalStorage()` + fakes):

```typescript
describe('marker v2 forces one re-scan', () => {
  it('re-scans once for clients that completed the v1 marker', async () => {
    installLocalStorage()
    // Simulate a client that finished the OLD v1 backfill.
    localStorage.setItem('entrenador_athlete_scope_backfill_v1:user-1', 'ath_user-1')
    await fakes.db.athletes.put({
      id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1',
      status: 'active', createdAt: 1, updatedAt: 1,
    })
    await fakes.db.sessions.put({ id: 's-old', date: '2026-06-30' }) // straggler w/o athleteId
    const spy = vi.spyOn(fakes.db.sessions, 'toArray')

    await backfillLocalAthleteScope('user-1')

    expect(spy).toHaveBeenCalled() // v2 marker absent → re-scan runs
    expect((await fakes.db.sessions.get('s-old'))?.athleteId).toBe('ath_user-1')
    spy.mockRestore()
  })
})

describe('invalidateBackfillMarker', () => {
  it('clears the v2 marker so the next backfill re-scans', async () => {
    installLocalStorage()
    await backfillLocalAthleteScope('user-1')
    invalidateBackfillMarker('user-1')
    const spy = vi.spyOn(fakes.db.sessions, 'toArray')
    await backfillLocalAthleteScope('user-1')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
```

Add `invalidateBackfillMarker` to the import at the top of the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/athlete/__tests__/athleteScopeMigration.test.ts`
Expected: FAIL — v1 marker still short-circuits / `invalidateBackfillMarker` missing.

- [ ] **Step 3: Bump the marker to v2 + add invalidator**

In `src/services/athlete/athleteScopeMigration.ts`, change the prefix and add the invalidator:

```typescript
const BACKFILL_MARKER_KEY_PREFIX = 'entrenador_athlete_scope_backfill_v2'
```

Add near the other marker helpers:

```typescript
export function invalidateBackfillMarker(ownerAccountId: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(backfillMarkerKey(ownerAccountId))
  } catch {
    // ignore
  }
}
```

(The existing `isBackfillMarkedComplete` now checks the v2 key, so v1-completed clients re-scan once. The scan already covers dayLogs/weekSummaries + all scopable tables.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/athlete/__tests__/athleteScopeMigration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (no-op)

---

## Task 4: Estampar `athleteId` al crear (`queries.ts`)

**Files:**
- Modify: `src/db/queries.ts` (`upsertDayLog:27`, `upsertWeekSummary:59`)
- Test: `src/db/__tests__/queriesAthleteScope.test.ts` (Create)

**Interfaces:**
- Consumes: `getActiveAthleteId` from `../services/athlete/activeAthlete`.

- [ ] **Step 1: Write the failing test (real Dexie)**

Create `src/db/__tests__/queriesAthleteScope.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../db'
import { upsertDayLog, upsertWeekSummary } from '../queries'
import { setActiveAthleteId } from '../../services/athlete/activeAthlete'

describe('upsertDayLog stamps athleteId on create', () => {
  beforeEach(async () => { db.close(); await db.delete(); await db.open() })
  afterEach(async () => { setActiveAthleteId(null); db.close() })

  it('stamps the active athlete id when creating', async () => {
    setActiveAthleteId('ath_A')
    const log = await upsertDayLog('2026-06-30', { sleepHours: 7 })
    expect(log.athleteId).toBe('ath_A')
  })

  it('does not write athleteId when no active athlete (stays undefined, not null)', async () => {
    setActiveAthleteId(null)
    const log = await upsertDayLog('2026-06-30', { sleepHours: 7 })
    expect(log.athleteId).toBeUndefined()
    expect('athleteId' in log && log.athleteId === null).toBe(false)
  })

  it('backfills athleteId on update when a legacy row lacks it', async () => {
    // Legacy row written before scoping, no athleteId.
    await db.dayLogs.put({ id: 'legacy', date: '2026-06-30', updatedAt: 1 })
    setActiveAthleteId('ath_A')
    const log = await upsertDayLog('2026-06-30', { sleepHours: 8 })
    expect(log.id).toBe('legacy')      // updated in place, not duplicated
    expect(log.athleteId).toBe('ath_A') // stamped on update
    expect(await db.dayLogs.count()).toBe(1)
  })

  it("stamps over the legacy 'default' sentinel on update (truthy but unscoped)", async () => {
    // A 'default' athleteId is the local profile sentinel — legacy, must be re-stamped.
    await db.dayLogs.put({ id: 'legacy', athleteId: 'default', date: '2026-06-30', updatedAt: 1 })
    setActiveAthleteId('ath_A')
    const log = await upsertDayLog('2026-06-30', { sleepHours: 8 })
    expect(log.athleteId).toBe('ath_A') // isScopedAthleteId('default') === false → stamped
  })

  it('a patch cannot override the resolved athlete scope', async () => {
    setActiveAthleteId('ath_A')
    // athleteId is excluded from the patch type; a cast simulates a loose/legacy caller.
    const created = await upsertDayLog('2026-06-30', { athleteId: 'ath_B' } as never)
    expect(created.athleteId).toBe('ath_A') // active scope wins, not the patch
    // update path: existing scoped row is preserved, patch athleteId ignored
    const updated = await upsertDayLog('2026-06-30', { athleteId: 'ath_B', sleepHours: 6 } as never)
    expect(updated.athleteId).toBe('ath_A')
  })
})

describe('upsertWeekSummary stamps athleteId on create', () => {
  beforeEach(async () => { db.close(); await db.delete(); await db.open() })
  afterEach(async () => { setActiveAthleteId(null); db.close() })

  it('stamps the active athlete id when creating', async () => {
    setActiveAthleteId('ath_A')
    const summary = await upsertWeekSummary('2026-06-29', { /* minimal valid patch */ })
    expect(summary.athleteId).toBe('ath_A')
  })

  it('does not write athleteId when no active athlete (stays undefined, not null)', async () => {
    setActiveAthleteId(null)
    const summary = await upsertWeekSummary('2026-06-29', { /* minimal valid patch */ })
    expect(summary.athleteId).toBeUndefined()
  })

  it('stamps a legacy summary even when the patch changes no metrics (bypasses the no-op early return)', async () => {
    // Legacy summary, no athleteId. A metric-neutral patch must NOT early-return unstamped.
    await db.weekSummaries.put({ id: 'legacy', weekStartDate: '2026-06-29', updatedAt: 1, totalSessions: 3 })
    setActiveAthleteId('ath_A')
    const summary = await upsertWeekSummary('2026-06-29', { totalSessions: 3 }) // same value → no meaningful change
    expect(summary.id).toBe('legacy')
    expect(summary.athleteId).toBe('ath_A') // stamped despite the no-op patch
  })

  it("stamps over the legacy 'default' sentinel on update", async () => {
    await db.weekSummaries.put({ id: 'legacy', athleteId: 'default', weekStartDate: '2026-06-29', updatedAt: 1, totalSessions: 3 })
    setActiveAthleteId('ath_A')
    const summary = await upsertWeekSummary('2026-06-29', { totalSessions: 3 })
    expect(summary.athleteId).toBe('ath_A')
  })

  it('a patch cannot override the resolved athlete scope', async () => {
    setActiveAthleteId('ath_A')
    const created = await upsertWeekSummary('2026-06-29', { athleteId: 'ath_B' } as never)
    expect(created.athleteId).toBe('ath_A')
    const updated = await upsertWeekSummary('2026-06-29', { athleteId: 'ath_B', totalSessions: 9 } as never)
    expect(updated.athleteId).toBe('ath_A')
  })
})
```

> Ajustar el `patch` de `upsertWeekSummary` a la firma real de la función (revisar `queries.ts:59`); lo que importa es aseverar el estampado, no el contenido del resumen. El caso "sin cambios significativos" debe usar un `patch` que iguale los valores actuales para ejercitar `hasWeekSummaryMeaningfulChanges === false`. Los `db.weekSummaries.put({...})` de fixture y los `upsertWeekSummary(...)` de este bloque usan objetos parciales: al implementar, completarlos a un `WeekSummary` válido o castearlos deliberadamente (`as WeekSummary` / `as never`) para que TS no falle — no dejarlos incompletos sin cast.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/__tests__/queriesAthleteScope.test.ts`
Expected: FAIL — created log has no `athleteId`.

- [ ] **Step 3: Stamp on create in `queries.ts`**

In `src/db/queries.ts`, import the helpers:

```typescript
import { getActiveAthleteId } from '../services/athlete/activeAthlete'
import { isScopedAthleteId } from '../services/athlete/effectiveAthleteKey'
```

**First, keep `athleteId` out of the patch type** so a caller can never pass it (the scope is owned by this layer, not by upsert callers). Change both signatures:

```typescript
// upsertDayLog
  patch: Partial<Omit<DayLog, 'id' | 'date' | 'updatedAt' | 'athleteId'>>
// upsertWeekSummary
  patch: Partial<Omit<WeekSummary, 'id' | 'weekStartDate' | 'updatedAt' | 'athleteId'>>
```

**Second, strip `athleteId` from the patch at runtime too.** The type excludes it, but a loosely-typed/`as`-cast caller could still smuggle one in — and spreading `...patch` **last** would then override the scope. Belt-and-suspenders: drop it from the patch object and **always write the resolved `athleteId` after the spread**, so neither the spread order nor whether a stamp is "needed" can let the patch win. Add a tiny helper (or inline destructure):

```typescript
// athleteId is owned by this layer, never by callers. Drop any (cast) athleteId the patch carries.
function stripAthleteId<T extends object>(patch: T): Omit<T, 'athleteId'> {
  const { athleteId: _ignored, ...rest } = patch as T & { athleteId?: unknown }
  return rest
}
```

In `upsertDayLog`, create branch:

```typescript
  const activeAthleteId = getActiveAthleteId()
  const safePatch = stripAthleteId(patch)
  const created: DayLog = {
    id: uuid(),
    date: dateISO,
    updatedAt: now,
    ...safePatch,
    ...(activeAthleteId ? { athleteId: activeAthleteId } : {}), // resolved scope, patch can't touch it
  }
  await db.dayLogs.put(created)
  return created
```

Update branch — resolve the id (existing scoped id wins, else the active athlete via `isScopedAthleteId`, so a legacy `'default'` still gets stamped) and **always** write it last:

```typescript
  const activeAthleteId = getActiveAthleteId()
  const safePatch = stripAthleteId(patch)
  const resolvedAthleteId = isScopedAthleteId(existing.athleteId)
    ? existing.athleteId
    : activeAthleteId ?? undefined
  const updated: DayLog = {
    ...existing,
    ...safePatch,
    updatedAt: now,
    ...(resolvedAthleteId ? { athleteId: resolvedAthleteId } : {}),
  }
  await db.dayLogs.put(updated)
  return updated
```

`upsertWeekSummary` create is analogous (`stripAthleteId` + resolved-scope-last).

**Watch the no-op early return (`queries.ts:66`).** `upsertWeekSummary` returns `existing` unchanged when `!hasWeekSummaryMeaningfulChanges(...)` — so a **legacy summary + a metric-neutral patch would escape stamping**. Compute the stamp need first, compare against the **stripped** patch, and always write the resolved id last (so an already-scoped row can't be overridden by a cast patch either):

```typescript
  const activeAthleteId = getActiveAthleteId()
  const safePatch = stripAthleteId(patch)
  const resolvedAthleteId = isScopedAthleteId(existing.athleteId)
    ? existing.athleteId
    : activeAthleteId ?? undefined
  const needsAthleteStamp = !!activeAthleteId && !isScopedAthleteId(existing.athleteId)
  if (!needsAthleteStamp && !hasWeekSummaryMeaningfulChanges(existing, safePatch)) {
    return existing
  }
  const updated: WeekSummary = {
    ...existing,
    ...safePatch,
    updatedAt,
    ...(resolvedAthleteId ? { athleteId: resolvedAthleteId } : {}),
  }
  await db.weekSummaries.put(updated)
  void syncService.pushWeekSummary(updated)
  return updated
```

(When `existing.athleteId` is already scoped and the patch is a genuine no-op, `needsAthleteStamp` is false and `hasWeekSummaryMeaningfulChanges(existing, safePatch)` is false → still early-returns; the stamp only forces past the early return for legacy rows.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/__tests__/queriesAthleteScope.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (no-op)

---

## Task 5: Lookups athlete-aware + fallback defensivo

**Files:**
- Modify: `src/db/queries.ts` (`getDayLog:24`, `getWeekSummary:43`, `getDayLogsForWeek:16`)
- Test: `src/db/__tests__/queriesAthleteScope.test.ts` (extend)

**Interfaces:**
- Consumes: `getActiveAthleteId`, `isScopedAthleteId`.
- Behavior: with active athlete → compound lookup; else legacy by date; compound miss → legacy row of that date only if `!isScopedAthleteId(row.athleteId)` (stamp it), never another athlete's.
- **Out of scope here:** the sync-side finders (`findDayLogConflictByDate`/`findWeekSummaryConflictByWeekStart`) — reworked in Task 6 with the remote athlete id, not delegated to these active-athlete UI reads.

- [ ] **Step 1: Write the failing tests**

Add to `src/db/__tests__/queriesAthleteScope.test.ts`:

```typescript
import { getDayLog, getDayLogsForWeek } from '../queries'

describe('getDayLog athlete-aware', () => {
  beforeEach(async () => { db.close(); await db.delete(); await db.open() })
  afterEach(async () => { setActiveAthleteId(null); db.close() })

  it('returns the active athlete row, not another athlete same date', async () => {
    await db.dayLogs.bulkPut([
      { id: 'a', athleteId: 'ath_A', date: '2026-06-30', updatedAt: 1, sleepHours: 7 },
      { id: 'b', athleteId: 'ath_B', date: '2026-06-30', updatedAt: 1, sleepHours: 5 },
    ])
    setActiveAthleteId('ath_A')
    expect((await getDayLog('2026-06-30'))?.id).toBe('a')
  })

  it('defensive fallback: finds+stamps a legacy row, never another athlete', async () => {
    await db.dayLogs.bulkPut([
      { id: 'legacy', date: '2026-06-30', updatedAt: 1 },            // no athleteId
      { id: 'other', athleteId: 'ath_B', date: '2026-07-01', updatedAt: 1 },
    ])
    setActiveAthleteId('ath_A')
    const found = await getDayLog('2026-06-30')
    expect(found?.id).toBe('legacy')
    expect((await db.dayLogs.get('legacy'))?.athleteId).toBe('ath_A') // repaired
    // never returns another athlete's row for a different scope
    setActiveAthleteId('ath_A')
    expect(await getDayLog('2026-07-01')).toBeUndefined()
  })

  it('getDayLogsForWeek scopes to the active athlete', async () => {
    await db.dayLogs.bulkPut([
      { id: 'a', athleteId: 'ath_A', date: '2026-06-29', updatedAt: 1 },
      { id: 'b', athleteId: 'ath_B', date: '2026-06-30', updatedAt: 1 },
    ])
    setActiveAthleteId('ath_A')
    const rows = await getDayLogsForWeek('2026-06-29')
    expect(rows.map((r) => r.id)).toEqual(['a'])
  })

  it('getDayLogsForWeek coalesces a scoped + legacy row on the same date (no double count)', async () => {
    await db.dayLogs.bulkPut([
      { id: 'scoped', athleteId: 'ath_A', date: '2026-06-29', updatedAt: 2 },
      { id: 'legacy', date: '2026-06-29', updatedAt: 1 }, // same date, no athleteId
      { id: 'legacy2', date: '2026-06-30', updatedAt: 1 }, // legacy on a date w/o scoped
    ])
    setActiveAthleteId('ath_A')
    const rows = await getDayLogsForWeek('2026-06-29')
    // 2026-06-29 → only the scoped row survives; 2026-06-30 → legacy adopted+stamped.
    const byDate = new Map(rows.map((r) => [r.date, r]))
    expect(rows).toHaveLength(2)
    expect(byDate.get('2026-06-29')?.id).toBe('scoped')
    expect(byDate.get('2026-06-30')?.id).toBe('legacy2')
    expect((await db.dayLogs.get('legacy2'))?.athleteId).toBe('ath_A') // adopted
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/__tests__/queriesAthleteScope.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement athlete-aware lookups in `queries.ts`**

```typescript
export const getDayLog = async (dateISO: string): Promise<DayLog | undefined> => {
  const aid = getActiveAthleteId()
  if (!aid) return db.dayLogs.where('date').equals(dateISO).first()
  const scoped = await db.dayLogs.where('[athleteId+date]').equals([aid, dateISO]).first()
  if (scoped) return scoped
  // Defensive fallback: adopt a legacy (unscoped) row for this date; never another athlete's.
  // Use !isScopedAthleteId (not `== null`) so a legacy 'default' sentinel is adopted too.
  const candidates = await db.dayLogs.where('date').equals(dateISO).toArray()
  const legacy = candidates.find((r) => !isScopedAthleteId(r.athleteId))
  if (legacy) {
    const repaired = { ...legacy, athleteId: aid }
    await db.dayLogs.put(repaired)
    return repaired
  }
  return undefined
}

export const getDayLogsForWeek = async (weekStartISO: string): Promise<DayLog[]> => {
  const end = toISO(addDays(fromISO(weekStartISO), 6))
  const aid = getActiveAthleteId()
  if (!aid) return db.dayLogs.where('date').between(weekStartISO, end, true, true).toArray()
  const scoped = await db.dayLogs
    .where('[athleteId+date]')
    .between([aid, weekStartISO], [aid, end], true, true)
    .toArray()
  // Coalesce by date: the scoped row wins; a legacy (unscoped) row is included ONLY
  // when there is no scoped equivalent for that date, so a straggler and its scoped
  // counterpart never both feed weekly calculations. Adopt (stamp) the legacy row we
  // keep so the next read hits the compound path directly.
  const byDate = new Map<string, DayLog>(scoped.map((r) => [r.date, r]))
  const inRange = await db.dayLogs.where('date').between(weekStartISO, end, true, true).toArray()
  const adopted: DayLog[] = []
  for (const r of inRange) {
    if (byDate.has(r.date)) continue
    if (isScopedAthleteId(r.athleteId)) continue // scoped row (another athlete, or aid already in byDate) — not adoptable
    const repaired = { ...r, athleteId: aid }
    await db.dayLogs.put(repaired)
    byDate.set(r.date, repaired)
    adopted.push(repaired)
  }
  // Preserve the by-date ordering the old `.where('date').between(...)` returned:
  // adopted rows are appended out of order, so sort the merged result by date.
  return [...scoped, ...adopted].sort((a, b) => a.date.localeCompare(b.date))
}
```

Apply the same coalesce-by-key pattern to `getWeekSummary` using `[athleteId+weekStartDate]` and `where('weekStartDate')`. Use `isScopedAthleteId` (import it from `../services/athlete/effectiveAthleteKey`) for the legacy/adoptable checks instead of literal `'default'`/`ATHLETE_PROFILE_LOCAL_ID` comparisons. (Conceptually the coalesce key is `(effectiveAthleteKey(row.athleteId, aid), date)`; because scoped rows already share `aid` and only legacy/unscoped rows are adopted, deduping by `date` within the active scope is equivalent and avoids recomputing the key per row.)

> **Sync finders are NOT touched here.** The sync-side `findDayLogConflictByDate`/`findWeekSummaryConflictByWeekStart` (`syncService.ts:2531/2535`) must **not** delegate to these UI lookups: `getDayLog` resolves against the **active** athlete, so during a legacy or full-user pull it would return the wrong local row for a remote belonging to another athlete. Those finders are reworked in **Task 6** to take the **remote** athlete id and match by `effectiveAthleteKey`. This task only changes the athlete-aware UI reads (`getDayLog`/`getWeekSummary`/`getDayLogsForWeek`).

- [ ] **Step 4: Run test + full suite**

Run: `npx vitest run src/db/__tests__/queriesAthleteScope.test.ts && npm test`
Expected: green (incl. the `noDirectDefault` guard).

- [ ] **Step 5: Commit** (no-op)

---

## Task 6: Merge por effective athlete key

**Files:**
- Modify: `src/services/syncService.ts` (`mergeDayLogs:2134`, `mergeWeekSummaries:2183`, `findDayLogConflictByDate:2531`, `findWeekSummaryConflictByWeekStart:2535`)
- Test: `src/services/__tests__/syncService.test.ts` (extend, mocked db) or a focused new test

**Interfaces:**
- Consumes: `effectiveAthleteKey` (Task 1), `getActiveAthleteId`, `getRowAthleteId` (`syncService.ts:1294`).
- Behavior: dedup local↔remote by `(effectiveAthleteKey, date)`; winner stamped `athleteId = activeAthleteId` when resolving a legacy row under an active athlete.
- **Finders take the remote athlete id.** `findDayLogConflictByDate`/`findWeekSummaryConflictByWeekStart` gain a `remoteAthleteId` param and match by `effectiveAthleteKey`, so a full-user/legacy pull matches a remote row to the correct local counterpart (never the active athlete's row by accident). They are **not** delegated to the active-athlete UI lookups from Task 5.

- [ ] **Step 1: Write the failing test**

Create `src/services/__tests__/mergeEffectiveKey.test.ts` (mocks db like `syncService.test.ts`):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
// Mock db + supabase per the repo pattern (see syncService.test.ts for the shape).
// Assert: a local {athleteId:'ath_A', date:D} and a remote legacy {athlete_id:null, date:D}
// collapse to one local row stamped 'ath_A'; a local {athleteId:'ath_B', date:D} is untouched.
```

Model the test on the existing `syncService.test.ts` harness (same `vi.mock('../auth')`, `vi.mock('../../db/db')`). Seed a local `ath_A` day log and a remote legacy row for the same date; run the merge; assert one row remains with `athleteId==='ath_A'` and the `ath_B` row is intact.

Add a **finder** case for the legacy/full-user pull: with `activeAthleteId` = null (or a different athlete), seed local rows `{athleteId:'ath_A', date:D}` and `{athleteId:'ath_B', date:D}`, then merge a remote row carrying `athlete_id: 'ath_B'` for date `D`. Assert the resolver receives the **`ath_B`** local row (not `ath_A`, which a plain `.first()`-by-date would have returned).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/mergeEffectiveKey.test.ts`
Expected: FAIL — raw-key merge leaves two rows.

- [ ] **Step 3a: Make the finders effective-key aware (take the remote athlete id)**

Today `findDayLogConflictByDate(date)` returns `db.dayLogs.where('date').equals(date).first()` — the first row **for any athlete** on that date. Called from `mergeDayLogs` during a legacy/full-user pull, that can hand the resolver the **wrong athlete's** local row. Rework them to take the remote athlete id and match by effective key:

```typescript
async function findDayLogConflictByDate(
  date: string,
  remoteAthleteId: string | null | undefined,
): Promise<DayLog | undefined> {
  const aid = getActiveAthleteId()
  const targetKey = effectiveAthleteKey(remoteAthleteId, aid)
  const sameDate = await db.dayLogs.where('date').equals(date).toArray()
  return sameDate.find((r) => effectiveAthleteKey(r.athleteId, aid) === targetKey)
}
```

Same shape for `findWeekSummaryConflictByWeekStart(weekStartDate, remoteAthleteId)` using `weekStartDate`. At the call sites (`:2142`, `:2192`), pass the remote athlete id via `getRowAthleteId(remoteRow, data)` (`syncService.ts:1294`): `localById ?? await findDayLogConflictByDate(remote.date, getRowAthleteId(row, data))`.

- [ ] **Step 3b: Implement effective-key merge**

In `mergeDayLogs`/`mergeWeekSummaries`, when finding the local counterpart for a remote row, match by effective key: compute `const aid = getActiveAthleteId()` and treat a local row as the conflict when `effectiveAthleteKey(local.athleteId, aid) === effectiveAthleteKey(remoteAthleteId, aid)` and dates match. When the resolution winner is kept locally, stamp `athleteId: aid` if `aid` is set and the winner lacks a scoped id (`!isScopedAthleteId(winner.athleteId)`). Use `getRowAthleteId(remoteRow, data)` (`syncService.ts:1294`) to read the remote athlete id.

- [ ] **Step 4: Run test + full suite**

Run: `npx vitest run src/services/__tests__/mergeEffectiveKey.test.ts && npm test`
Expected: green.

- [ ] **Step 5: Commit** (no-op)

---

## Task 7: Repair por effective athlete key

**Files:**
- Modify: `src/services/syncService.ts` (`repairLocalDayLogConflicts:2591`, `repairLocalWeekSummaryConflicts:2608`)
- Test: `src/services/__tests__/repairEffectiveKey.test.ts` (Create, mocked db)

**Interfaces:**
- Consumes: `effectiveAthleteKey`, `getActiveAthleteId`.

- [ ] **Step 1: Write the failing test**

Create `src/services/__tests__/repairEffectiveKey.test.ts` (mocks db). Seed:
- `{id:'a', athleteId:'ath_A', date:D}`, `{id:'b', date:D}` (legacy), `{id:'c', athleteId:'ath_B', date:D}`.
With `activeAthleteId='ath_A'`: after repair, `a`+`b` collapse to one row stamped `ath_A`, `c` untouched. Assert `db.dayLogs` has 2 rows (the collapsed A row + c) and no delete hit `c`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/repairEffectiveKey.test.ts`
Expected: FAIL — grouping by date alone deletes `c` or `b`+`a`+`c` collapse.

- [ ] **Step 3: Implement effective-key grouping**

Change `groupRowsBy(rows, (row) => row.date)` → `groupRowsBy(rows, (row) => \`${effectiveAthleteKey(row.athleteId, aid)}::${row.date}\`)` (compute `const aid = getActiveAthleteId()` at the top of each repair fn). Same for week summaries with `row.weekStartDate`. When collapsing, stamp the winner with `athleteId: aid` when `aid` is set and `!isScopedAthleteId(winner.athleteId)`.

- [ ] **Step 4: Run test + full suite**

Run: `npx vitest run src/services/__tests__/repairEffectiveKey.test.ts && npm test`
Expected: green.

- [ ] **Step 5: Commit** (no-op)

---

## Task 8: `deleteMissingLocalRows` scope-aware (crítico)

**Files:**
- Modify: `src/services/syncService.ts` (`deleteMissingLocalRows:2502` + its `day_logs`/`week_summaries` call sites; capture the read scope once per pull)
- Modify: `src/services/sync/syncSupabase.ts` (`fetchAll:63` — accept an optional pre-resolved `scope` so the pull and the delete share one snapshot)
- Test: `src/services/__tests__/deleteMissingScope.test.ts` (Create, mocked db)

**Interfaces:**
- Consumes: `isInAthleteScope` (Task 1), `resolveReadScope`/`ReadScope` (`../athlete/readScope`).
- Change: add an optional `athleteScope?: string | null` param to `deleteMissingLocalRows` so the "missing remote → delete" only considers rows in the **current remote pull scope**.
- Change: `fetchAll` takes an optional `scope?: ReadScope` (defaulting to `resolveReadScope()`), so the merge can resolve the scope **once** and hand the same value to both fetch and delete (literal mirror; no second resolver read). Existing `fetchAll` callers keep working unchanged.
- **Critical: the delete scope must mirror the pull scope**, not `getActiveAthleteId()` unconditionally. `fetchAll` scopes by athlete only when `resolveReadScope().mode === 'athlete'` (`syncSupabase.ts:77`); if the flag is off (or no athlete hydrated) it pulls the **full user** (`user_id`), so `remoteIds` already covers every athlete's rows. Passing `activeAthleteId` in that legacy/full-user case would make the delete too conservative — it would spare another athlete's rows that are genuinely missing remote (real tombstones) and leak deleted data back. Rule: pass the athlete id **only** when `resolveReadScope().mode === 'athlete'`; otherwise pass `undefined` so the delete operates legacy/full-user (current behavior).

- [ ] **Step 1: Write the failing test**

Create `src/services/__tests__/deleteMissingScope.test.ts` (mocks db). Seed local dayLogs:
- `{id:'A1', athleteId:'ath_A'}`, `{id:'B1', athleteId:'ath_B'}`, `{id:'L1'}` (legacy).

Two cases:
- **Athlete-scoped pull** — call the delete with `athleteScope='ath_A'`, `remoteIds={}` (A had none remote), `deleteBeforeTs=Infinity`. Assert: `A1` and `L1` deleted (in scope, missing remote), **`B1` NOT deleted** (out of scope).
- **Legacy/full-user pull** — call with `athleteScope=undefined`, same `remoteIds={}`. Assert **all three** (`A1`, `B1`, `L1`) deleted: a full-user pull's `remoteIds` already covers every athlete, so a missing id is a real tombstone and scope must not spare `B1`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/deleteMissingScope.test.ts`
Expected: FAIL — current impl deletes `B1` too.

- [ ] **Step 3: Make the delete scope-aware**

In `deleteMissingLocalRows`, add a param `athleteScope?: string | null` and, when set, additionally require `isInAthleteScope(row.athleteId, athleteScope)` before a row is eligible for deletion:

```typescript
async function deleteMissingLocalRows<T extends { id: string; athleteId?: string }>(
  table: { toArray: () => Promise<T[]>; bulkDelete: (keys: string[]) => Promise<void> },
  remoteIds: Set<string>,
  getLocalUpdatedAt: (row: T) => number | null | undefined,
  deleteBeforeTs: number | null,
  athleteScope?: string | null,
): Promise<void> {
  if (deleteBeforeTs == null) return
  const localRows = await table.toArray()
  const idsToDelete = localRows
    .filter((row) => {
      if (remoteIds.has(row.id)) return false
      if (athleteScope !== undefined && !isInAthleteScope(row.athleteId, athleteScope)) return false
      const localUpdatedAt = getLocalUpdatedAt(row)
      if (typeof localUpdatedAt !== 'number' || Number.isNaN(localUpdatedAt)) return false
      return localUpdatedAt <= deleteBeforeTs
    })
    .map((row) => row.id)
  // ...rest unchanged
}
```

At the **`day_logs` and `week_summaries` call sites** (in `mergeDayLogs`/`mergeWeekSummaries`), resolve the scope **once** and hand that same snapshot to both the pull (`fetchAll`) and the delete, so they can never diverge:

```typescript
// One snapshot for the whole pull+reconcile — do NOT call resolveReadScope() twice.
const scope = resolveReadScope()
const remoteRows = await fetchAll<DayLogRow>('day_logs', userId, scope) // same snapshot into the pull
const remoteIds = new Set(remoteRows.map((r) => r.id))
// ...merge remoteRows...
const athleteScope = scope.mode === 'athlete' ? scope.athleteId : undefined
await deleteMissingLocalRows(db.dayLogs, remoteIds, getUpdatedAt, deleteBeforeTs, athleteScope)
```

`fetchAll` gains an optional `scope?: ReadScope` (defaulting to `resolveReadScope()` when omitted, so existing callers are unaffected). When `athleteScope` is `undefined` the delete keeps its current full-user/legacy behavior (the `athleteScope !== undefined` guard is skipped). Leave other call sites (sessions/chat/coach_proposals) unchanged for now (out of scope; they don't have the same-date collision, and their scope-awareness belongs to full F2) — document this in a code comment.

> **Snapshot the scope once, don't re-resolve.** `fetchAll` already calls `resolveReadScope()` internally (`syncSupabase.ts:68`) and does **not** return it, so calling `resolveReadScope()` again here is a *second* read — if the active athlete ever changed between the pull and this delete, the delete scope would no longer literally mirror the pull scope (a TOCTOU window). Today it's low-risk (no multi-athlete switcher yet), but make the mirror literal: **resolve the scope once at the top of the merge/pull, pass that same value into both `fetchAll` and `deleteMissingLocalRows`** — e.g. add an optional `scope?: ReadScope` param to `fetchAll` (falling back to `resolveReadScope()` when omitted, preserving current callers) and reuse the captured `scope` for `athleteScope`. Note this explicitly so the implementer doesn't leave the two resolver calls independent.

- [ ] **Step 4: Run test + full suite**

Run: `npx vitest run src/services/__tests__/deleteMissingScope.test.ts && npm test`
Expected: green.

- [ ] **Step 5: Commit** (no-op)

---

## Task 9: Import preserva/estampa `athleteId` + invalida marker

**Files:**
- Modify: `src/services/dataExport.ts` (`parseDayLog:627`, `parseWeekSummary:646`, `parseSession:590`; `importAppDataFromFile:355` — both the `replace` and `merge` apply branches)
- Test: `src/services/__tests__/dataExportAthleteId.test.ts` (Create)

**Interfaces:**
- Consumes: `getActiveAthleteId`, `isScopedAthleteId`, `effectiveAthleteKey`, `invalidateBackfillMarker` (Task 3), `useAuthStore` (`../store/useAuthStore`) for the owner account id.
- Apply entrypoint is `importAppDataFromFile(file: File, mode: 'replace' | 'merge')` — there is **no** `importAppData`. The coalesce + stamp + marker-invalidation apply to **both** the `replace` branch (`:362-385`) and the `merge` branch (`:386-458`).

- [ ] **Step 1: Write the failing test**

Create `src/services/__tests__/dataExportAthleteId.test.ts`. **Test through the public `parseAppDataExport`** (`dataExport.ts:497`) rather than exporting `parseDayLog`/`parseWeekSummary` — no need to widen the internal API just for tests:

```typescript
import { describe, it, expect } from 'vitest'
import { parseAppDataExport } from '../dataExport'

// Minimal valid export envelope with just the dayLogs we care about.
// Adjust the envelope fields (version, exportedAt, other tables) to the real AppDataExport shape.
function exportWith(dayLogs: unknown[]) {
  return { /* …envelope… */ tables: { /* …empty other tables… */ dayLogs } }
}

describe('import preserves athleteId', () => {
  it('keeps athleteId present in the backup row', () => {
    const parsed = parseAppDataExport(exportWith([{ id: 'd1', date: '2026-06-30', updatedAt: 1, athleteId: 'ath_A' }]))
    expect(parsed.tables.dayLogs[0].athleteId).toBe('ath_A')
  })
  it('leaves athleteId undefined when absent (old backup)', () => {
    const parsed = parseAppDataExport(exportWith([{ id: 'd1', date: '2026-06-30', updatedAt: 1 }]))
    expect(parsed.tables.dayLogs[0].athleteId).toBeUndefined()
  })
})
```

(Same for `weekSummaries`. Build the envelope from what `exportAppData` produces so `parseAppDataExport` accepts it.)

Add a real-Dexie apply-path test (isolate the DB per the Task 0 pattern: `db.close(); await db.delete(); await db.open()` in `beforeEach`) for the natural-key coalescing. The apply entrypoint is `importAppDataFromFile(file, mode)`, which takes a real `File` — build one from a JSON backup string (or, if you prefer not to construct a `File`, drive the coalesce via `parseAppDataExport` + the extracted apply helper). Use `mode: 'merge'` for the coalesce case:

```typescript
import { db } from '../../db/db'
import { importAppDataFromFile } from '../dataExport'
import { setActiveAthleteId } from '../athlete/activeAthlete'

// Wrap a backup object as the JSON File that importAppDataFromFile expects.
function backupFile(dayLogs: unknown[]): File {
  const backup = { /* real AppDataExport shape */ tables: { /* …empty tables… */ dayLogs } }
  return new File([JSON.stringify(backup)], 'backup.json', { type: 'application/json' })
}

it('coalesces an imported row onto a local row with the same (athleteId, date) but different id', async () => {
  setActiveAthleteId('ath_A')
  await db.dayLogs.put({ id: 'local-id', athleteId: 'ath_A', date: '2026-06-30', updatedAt: 1, sleepHours: 5 })
  // Backup row: SAME natural key, DIFFERENT id, newer → must update in place, not throw/duplicate.
  await importAppDataFromFile(
    backupFile([{ id: 'backup-id', date: '2026-06-30', updatedAt: 9, sleepHours: 8 }]),
    'merge',
  )
  const rows = await db.dayLogs.where('[athleteId+date]').equals(['ath_A', '2026-06-30']).toArray()
  expect(rows).toHaveLength(1)               // no duplicate, no unique-index throw
  expect(rows[0].id).toBe('local-id')        // local id reused (in-place update)
  expect(rows[0].sleepHours).toBe(8)         // newer import won
  setActiveAthleteId(null)
})
```

Adjust `backupFile` to the real `AppDataExport` shape (see `exportAppData`/`parseAppDataExport`). Add a second case for **`mode: 'replace'`**: a backup whose two rows collapse to the same `(athleteId, date)` after stamping imports without throwing on the unique index and leaves exactly one row.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/dataExportAthleteId.test.ts`
Expected: FAIL — `athleteId` dropped.

- [ ] **Step 3: Preserve athleteId in parsers**

In `parseDayLog`, `parseWeekSummary` (and `parseSession`) add:

```typescript
    athleteId: optionalString(row.athleteId, `dayLogs[${index}].athleteId`),
```

(with the matching path string per parser).

- [ ] **Step 4: Coalesce by natural key, stamp old backups + invalidate marker on import apply**

**Critical (compound-unique safety) — applies to BOTH the `merge` and the `replace` branch.** The current import merges by `id` (`dataExport.ts:403-419`, `Map` keyed by `row.id` + `bulkPut`), and the `replace` branch just `bulkPut`s the raw backup rows after clearing (`:377-383`). Under v14 both are unsafe — a backup can carry a **different `id` but the same `(athleteId, date)`** as another row (a straggler from another device, or two rows that only collide **after stamping**). `bulkPut` would then throw on the `&[athleteId+date]` unique index (or silently duplicate until the stamp fails). Even in `replace` (local table cleared) the **batch itself** can hold two rows that stamp to the same natural key, so both branches must coalesce by the **effective natural key** before writing:

1. **Stamp first, then key.** For each imported `dayLogs`/`weekSummaries` row: if `!isScopedAthleteId(raw.athleteId)` (legacy — includes `undefined`, `null`, `''`, and the `'default'` sentinel) and `getActiveAthleteId()` is set, stamp it now (so its natural key matches how local rows are keyed). Never write `athleteId: null` (undefined stays for legacy when no active athlete).
2. **Index local rows by natural key**, not id: `key = \`${effectiveAthleteKey(row.athleteId, aid)}::${row.date}\`` (use `weekStartDate` for summaries). Build `localByKey: Map<string, Row>` from `db.dayLogs.toArray()`. In the **`replace` branch** the table was just cleared, so `localByKey` is empty — the same code path still dedups the import batch by key (below), which is the part that matters there.
3. **Resolve per imported row:**
   - If a local row shares the natural key: keep the newer by `updatedAt` (summaries: `updatedAt ?? 0`). When the import wins, **reuse the local row's `id`** (`imported.id = local.id`) so the write is an in-place update and never collides with the unique index. When local wins, drop the imported row.
   - If no local row shares the key: keep the imported row as-is (its own id).
   - **Guard against two imported rows sharing one natural key** (dedup the import batch by key too, newest wins) so the batch itself can't violate the index. **This is what protects the `replace` branch**, where two just-stamped backup rows can collapse to one `(athleteId, date)`.
4. `bulkPut` the resolved set.

```typescript
// DayLogs — coalesce by (effectiveAthleteKey, date), not by id. Same helper for merge + replace.
const aid = getActiveAthleteId()
const localDayLogs = await db.dayLogs.toArray() // empty in the replace branch (table just cleared)
const keyOf = (r: DayLog) => `${effectiveAthleteKey(r.athleteId, aid)}::${r.date}`
const localByKey = new Map(localDayLogs.map((r) => [keyOf(r), r]))
const resolved = new Map<string, DayLog>()
for (const raw of backup.tables.dayLogs) {
  const bd = aid && !isScopedAthleteId(raw.athleteId) ? { ...raw, athleteId: aid } : raw
  const k = keyOf(bd)
  const local = localByKey.get(k)
  const prior = resolved.get(k)
  const incumbent = prior ?? local
  if (incumbent && incumbent.updatedAt >= bd.updatedAt) continue
  resolved.set(k, { ...bd, id: local?.id ?? prior?.id ?? bd.id }) // reuse local id → in-place update
}
if (resolved.size > 0) await db.dayLogs.bulkPut([...resolved.values()])
```

Apply the analogous branch to `weekSummaries` (key on `weekStartDate`, compare `updatedAt ?? 0`). Import `effectiveAthleteKey`, `isScopedAthleteId` and `getActiveAthleteId`. Factor this into one helper reused by both `mode === 'replace'` and `mode === 'merge'` so they can't drift (in `replace`, run it after the `.clear()` calls instead of the raw `bulkPut` at `:377-383`).

5. **After writing**, resolve the owner account id from auth and invalidate the marker **only if present** — `importAppDataFromFile` has no `userId` param, so read it from the store:

```typescript
const ownerAccountId = useAuthStore.getState().user?.id
if (ownerAccountId) invalidateBackfillMarker(ownerAccountId)
```

This makes the next `backfillLocalAthleteScope` re-scan and clean any straggler (e.g. rows imported while no athlete was hydrated). When there is no signed-in user, skip invalidation (there is no per-owner marker to clear). Add a test covering the no-user case (import succeeds, no invalidation attempted). (Both apply branches share this step; do it once after the `db.transaction(...)` completes.)

- [ ] **Step 5: Run test + full suite**

Run: `npx vitest run src/services/__tests__/dataExportAthleteId.test.ts && npm test`
Expected: green.

- [ ] **Step 6: Commit** (no-op)

---

## Task 10: Supabase `008` — preflight + índice único parcial

**Files:**
- Create: `supabase/008a_athlete_scope_preflight.sql`
- Create: `supabase/008b_athlete_scope_unique.sql`

> **⚠️ DEPLOY GATE — no aplicar `008b` hasta alinear el write path remoto.** El único parcial nuevo
> en `(athlete_id, date)` / `(athlete_id, week_start_date)` puede romper los **pushes** actuales con
> `23505` (unique violation). El write path hoy no es natural-key-safe:
> - `pushDayLog`/`pushWeekSummary` → `upsertRow` (`syncService.ts:1104`) hace `getSupabase().from(table).upsert(payload)` **sin
>   `onConflict`** (`syncService.ts:1157`), o sea resuelve por PK `id`. Si el remoto ya tiene la misma
>   clave natural con **otro `id`**, el upsert intenta insertar y viola el parcial.
> - `migrateLocalDataToCloud` usa `onConflict: 'user_id,date'` / `'user_id,week_start_date'`
>   (`syncService.ts:3025-3026`) — justo la clave que estamos dejando atrás para multi-atleta.
>
> **Ojo con el atajo `onConflict: 'athlete_id,date'`:** un índice **parcial** (`WHERE athlete_id IS
> NOT NULL`) no es un target válido de `ON CONFLICT` salvo que se incluya el predicado, y el cliente
> Supabase solo pasa nombres de columna → no puede apuntarlo. No confiar en eso.
>
> **Requisito antes de `008b` (staging/prod):** hacer el push de `day_logs`/`week_summaries`
> natural-key-safe. Opción recomendada: **resolver por clave natural remota antes/en el push**
> (select por `(athlete_id, date)` con `athlete_id.is.null` legacy-aware → si existe con otro `id`,
> `update` esa fila o `delete`+insert reusando la clave, análogo al coalesce local de Task 9), y
> actualizar `migrateLocalDataToCloud` para no usar el `onConflict` legacy por `user_id`. Se puede
> **implementar las tasks locales/Dexie/sync/import (0–9) y aplicar `008a` (solo reporta) sin este
> cambio**; `008b` queda bloqueado detrás de él. Documentarlo o convertirlo en su propia task antes
> de la ventana pre-beta.

- [ ] **Step 1: Write the preflight report + the guarded migration**

Split into **two files** so the reporting query and the mutating migration never run as one loose script (a bare `select` in a migration file reports but does not stop the later `create index`, which would then fail in a less controlled way):

**`supabase/008a_athlete_scope_preflight.sql`** — reporting only, run and read by a human first:

```sql
-- Athlete Scope F2 — PREFLIGHT (report only, mutates nothing). Read before 008b.

-- 1. Duplicates that would block the partial unique index (must be 0).
select 'day_logs dup' as check, count(*) as offending from (
  select athlete_id, date from public.day_logs
  where athlete_id is not null group by athlete_id, date having count(*) > 1
) d
union all
select 'week_summaries dup', count(*) from (
  select athlete_id, week_start_date from public.week_summaries
  where athlete_id is not null group by athlete_id, week_start_date having count(*) > 1
) w;

-- 2. Null debt (operational signal, does NOT block the partial index).
select 'day_logs null' as check, count(*) from public.day_logs where athlete_id is null
union all select 'week_summaries null', count(*) from public.week_summaries where athlete_id is null
union all select 'day_logs legacy dup by date', count(*) from (
  select date from public.day_logs where athlete_id is null group by date having count(*) > 1
) x
union all select 'week_summaries legacy dup by week', count(*) from (
  select week_start_date from public.week_summaries where athlete_id is null group by week_start_date having count(*) > 1
) y;
```

**`supabase/008b_athlete_scope_unique.sql`** — the real migration. It **re-checks and hard-aborts** in a `DO` block before creating anything, so it is safe to run unattended and cannot half-apply against dirty data:

```sql
-- Athlete Scope F2 — remote integrity net for day_logs / week_summaries.
-- Partial unique on (athlete_id, <date>) WHERE athlete_id is not null, so legacy
-- (null) rows are never blocked. Self-guarding: aborts before creating the index
-- if any duplicate (athlete_id, <date>) exists.

do $$
declare
  dup_day int;
  dup_week int;
begin
  select count(*) into dup_day from (
    select athlete_id, date from public.day_logs
    where athlete_id is not null group by athlete_id, date having count(*) > 1
  ) d;
  select count(*) into dup_week from (
    select athlete_id, week_start_date from public.week_summaries
    where athlete_id is not null group by athlete_id, week_start_date having count(*) > 1
  ) w;
  if dup_day > 0 or dup_week > 0 then
    raise exception 'Athlete scope 008b aborted: % day_logs and % week_summaries duplicate (athlete_id, date) rows. Resolve via 008a preflight before migrating.', dup_day, dup_week;
  end if;
end $$;

create unique index if not exists day_logs_athlete_date_unique
  on public.day_logs (athlete_id, date) where athlete_id is not null;
create unique index if not exists week_summaries_athlete_week_unique
  on public.week_summaries (athlete_id, week_start_date) where athlete_id is not null;
```

- [ ] **Step 2: Apply in staging — preflight, then guarded migration (after the write-path gate)**

**Precondición:** el write path remoto de `day_logs`/`week_summaries` ya es natural-key-safe (ver el
DEPLOY GATE arriba). Si no, **no** correr `008b`.

Run `008a` in staging and read section 1; confirm duplicates = 0 (resolve any first). Anotar el output (incluida la null debt) en las notas del task. Then run `008b`; the `DO` guard is a belt-and-suspenders re-check that aborts cleanly if data drifted between the two runs. Tras aplicar `008b`, hacer un smoke de push (crear/editar un day log y un week summary con atleta activo, y verificar que no aparece `23505`). Prod se aplica en la ventana pre-beta tras el mismo preflight y el mismo gate.

- [ ] **Step 3: Commit** (no-op)

---

## Self-Review Notes

- **Spec coverage:** v14 index (dayLogs + weekSummaries) → Task 2; marker v2/re-backfill → Task 3; stamp on create + backfill on update → Task 4; athlete-aware lookups + defensive fallback + compound `getDayLogsForWeek` (coalesced by natural key) → Task 5; merge effective key + effective-key finders → Task 6; repair effective key → Task 7; delete scope-aware (mirrors `resolveReadScope`) → Task 8; import preserve/stamp + **natural-key coalesce (replace + merge)** + invalidate marker → Task 9; Supabase 008a preflight + 008b guarded partial unique → Task 10; `isScopedAthleteId`/effective key helper → Task 1; real-Dexie test harness with per-test DB isolation → Task 0. All spec sections mapped.
- **Legacy detection is not falsy:** `ATHLETE_PROFILE_LOCAL_ID` (`'default'`) is truthy, so every "is this legacy / needs stamping" decision uses `!isScopedAthleteId(row.athleteId)` (Task 1), applied in upsert (Task 4), lookup fallback (Task 5), merge/repair (Tasks 6/7) and import stamp/coalesce (Task 9) — a plain `!row.athleteId` would leak `'default'` rows through unscoped.
- **Out of scope preserved:** no coach_athlete_links/account_type/UI/contract; deleteMissingLocalRows scope-awareness limited to day_logs/week_summaries (documented), other tables left for full F2.
- **Silent-corruption side windows closed:** import coalesces by natural key (not `id`) in **both** the replace and merge branches so it can't collide/duplicate against the v14 unique index even when the batch self-collides after stamping (Task 9); `getDayLogsForWeek` coalesces scoped+legacy per date **and returns rows sorted by date** so nothing is double-counted or reordered (Task 5); delete scope follows the pull scope, resolved **once** and shared between `fetchAll` and `deleteMissingLocalRows` (no TOCTOU re-resolve), so a full-user pull still tombstones every athlete while an athlete-scoped pull spares out-of-scope rows (Task 8); sync finders match by the **remote** athlete id via `effectiveAthleteKey` (Task 6), so a legacy/full-user pull can't merge a remote row onto the active athlete's local row; `upsertWeekSummary`'s no-op early return is bypassed when a legacy row still needs stamping, and neither upsert lets a `patch` override the resolved scope (Task 4).
- **Type/name consistency:** `isScopedAthleteId`/`effectiveAthleteKey`/`isInAthleteScope` (Task 1) used verbatim in Tasks 4/5/6/7/8/9; `resolveReadScope` (`../athlete/readScope`) used in Task 8; `invalidateBackfillMarker` (Task 3) used in Task 9 with the owner id from `useAuthStore.getState().user?.id`; `getActiveAthleteId`/`ATHLETE_PROFILE_LOCAL_ID` from `activeAthlete` throughout. Import apply entrypoint is `importAppDataFromFile(file, mode)` (there is no `importAppData`).
- **Test hygiene:** every real-Dexie test (Tasks 0/2/4/5/9, incl. the Task 0 smoke test) resets the `db` singleton with `db.close(); await db.delete(); await db.open()` per test to avoid shared-state flakiness.
- **Naming:** local/TS `athleteId`, Dexie compound `[athleteId+date]`; remote SQL `athlete_id`/`(athlete_id, date)`.
- **Deploy note (Task 10, two-phase gate):** `008a` (report-only) can run any time and doesn't gate the local changes (0–9). **`008b` applies in staging/prod only after BOTH (a) preflight = 0 AND (b) the remote write-path gate is satisfied** — because `008b`'s partial unique on `(athlete_id, date)`/`(athlete_id, week_start_date)` can throw `23505` against the current pushes, which `upsertRow` upserts by PK `id` (`syncService.ts:1104,1157`, no `onConflict`), and against `migrateLocalDataToCloud`'s legacy `onConflict: 'user_id,date'` (`:3025-3026`). A partial index also can't be an `ON CONFLICT` target via the client. So `008b` waits until the day/week push resolves by remote natural key (select→update or delete+insert, legacy-null-aware) and the migration drops the `user_id` conflict key (Task 10 DEPLOY GATE). Tasks 0–9 + `008a` ship first.

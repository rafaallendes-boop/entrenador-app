# Athlete Scope — Remote Write-Path Natural-Key Safety + `008b` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer los push de `day_logs`/`week_summaries` natural-key-safe con un handler reactivo de `23505` (resuelve por `(user_id, athlete_id, fecha)` con LWW atómico), y agregar la migración aditiva `008b` (índice único parcial `(athlete_id, fecha)`), sin tocar `migrateLocalDataToCloud` ni dropear los uniques viejos (scope X).

**Architecture:** Enfoque A reactivo. `upsertRow` mantiene el happy path (`.upsert(payload)` por PK `id`); solo en error `23505` sobre `day_logs`/`week_summaries` con payload válido llama a `reconcileNaturalKeyConflict`, que hace `SELECT` de la fila en conflicto, decide LWW (remoto ≥ local → skip; local > remoto → `update` condicional atómico con guarda estricta `lt(updated_at)`), y en `SELECT` vacío reintenta el upsert una vez. Si el update condicional afecta 0 filas, revalida la clave natural: si todavía existe una fila remota, skip; si desapareció/cambió de clave, reintenta el upsert una vez. El `id` local no se reconcilia en el push: lo converge el próximo merge.

**Tech Stack:** TypeScript, Supabase (postgres-js/PostgREST), Vitest. Migración SQL manual.

**Spec:** `docs/superpowers/specs/2026-07-01-athlete-scope-remote-write-path-008b-design.md`

## Global Constraints

- **Scope X:** NO dropear `day_logs_user_date` / `week_summaries_user_week`; NO tocar `migrateLocalDataToCloud`; NO adoptar filas legacy `athlete_id IS NULL` (null debt = 0).
- **Handler acotado:** reconcilia SOLO si `error.code === '23505'` **y** `table ∈ {day_logs, week_summaries}` **y** `payload.athlete_id` es string no vacío **y** la columna de fecha natural (`date`/`week_start_date`) existe en el payload. Cualquier otro caso reusa el path de error actual.
- **LWW:** remoto `≥` local (incluye empate) → skip; local `>` remoto → update condicional atómico. `updated_at` no finito (local o remoto) → path seguro (no sobrescribe).
- **No reconciliar `id` local en el push.** Lo converge `mergeDayLogs`/`mergeWeekSummaries` en el próximo pull.
- **Rollout:** deploy handler → confirmar bundle nuevo → `008a` → `008b` → smoke. `008b` NO se aplica hasta que el handler esté en prod.
- Verificación por task: `npm run lint && npm test && npm run build` verdes.

**⚠️ Política de commits:** El owner hace los commits. **NO ejecutar `git commit`/`git add` dentro de las tasks.** Tratar los pasos "Commit" como no-op.

---

## File Structure

```
src/services/
  syncService.ts                     [MODIFY: + reconcileNaturalKeyConflict (export) + isReconcilableNaturalKeyConflict; wire into upsertRow error branch]
  __tests__/syncService.test.ts      [MODIFY: extend supabase mock builder (lt/limit/select); + reconcile unit tests + upsertRow wiring test]

supabase/
  008b_athlete_scope_unique.sql      [NEW: DO-guard + partial unique indexes]
```

---

## Task 1: `reconcileNaturalKeyConflict` helper + tests

**Files:**
- Modify: `src/services/syncService.ts` (add helpers near `getRemoteRowAthleteId`/`stampAthleteIdIfLegacy`, ~`:1302-1320`)
- Modify: `src/services/__tests__/syncService.test.ts` (extend mock builder; add test block)

**Interfaces:**
- Produces:
  - `reconcileNaturalKeyConflict(table: SupabaseTable, payload: Record<string, unknown>, userId: string, error: unknown): Promise<boolean>` — `true` cuando el conflicto quedó resuelto (update in-place, skip por LWW, o retry-upsert exitoso); `false` cuando **no es reconciliable** (guardas), `updated_at` **no es finito**, o el retry **vuelve a `23505`** (→ el caller re-lanza el `23505` original). Un error real (red/auth/RLS) en select/update/retry-no-`23505` **NO** retorna `false`: hace `throw` del error real (→ el `catch` de `upsertRow` lo clasifica por el failure path retriable).
- Consumes: `getSupabase` (`./sync/syncSupabase` re-export ya importado en el archivo), `withRequestTimeout` (idem), `SupabaseTable`.

- [ ] **Step 1: Extend the test supabase mock builder to support `lt` / `limit` / `select`**

En `src/services/__tests__/syncService.test.ts`, el `createQueryBuilder` (~`:72-102`) solo soporta `eq/in/or/then`. El reconcile usa `.select('id, updated_at').eq().eq().eq().limit(1)` y `.update(body).eq().eq().lt().select('id')`. Amplía el tipo de `op` y agrega métodos encadenables.

Cambia las 3 anotaciones de tipo de filtros (`op: 'eq' | 'in' | 'or'`) a `op: 'eq' | 'in' | 'or' | 'lt'` en: el `filters` local de `createQueryBuilder` (~`:77`), `updateCalls` (~`:69`) y `selectCalls` (~`:70`).

Dentro de `createQueryBuilder`, agrega antes de `then`:

```typescript
    lt(column: string, value: unknown) {
      filters.push({ op: 'lt', column, value })
      return this
    },
    limit(_count: number) {
      return this
    },
    select(_columns?: string) {
      return this
    },
```

Y en `createSupabaseFrom` (~`:108-122`), el `select` de la tabla debe aceptar el arg de columnas (ya es `vi.fn(() => createQueryBuilder(table, 'select'))`; cambia a `vi.fn((_columns?: string) => createQueryBuilder(table, 'select'))` para claridad — opcional pero recomendado).

Como los tests de 0 filas hacen `SELECT` inicial + `SELECT` de recheck, permite respuestas secuenciales:

```typescript
type SupabaseResult = { data: unknown; error: unknown }
type SupabaseResultSource = SupabaseResult | SupabaseResult[]

let tableResults = new Map<string, SupabaseResultSource>()
let actionResults = new Map<string, SupabaseResultSource>()

function takeSupabaseResult(source: SupabaseResultSource | undefined): SupabaseResult | undefined {
  if (!Array.isArray(source)) return source
  return source.shift() ?? { data: null, error: null }
}

function getSupabaseResult(table: string, action: 'delete' | 'update' | 'select' | 'upsert' | 'insert'): SupabaseResult {
  return takeSupabaseResult(actionResults.get(`${action}:${table}`))
    ?? takeSupabaseResult(tableResults.get(table))
    ?? { data: null, error: null }
}
```

- [ ] **Step 2: Write the failing tests**

Agrega al final de `src/services/__tests__/syncService.test.ts` (dentro del `describe` principal o uno nuevo), importando el símbolo nuevo (añádelo al `import { ... } from '../syncService'` existente o usa `syncService.reconcileNaturalKeyConflict`):

```typescript
describe('reconcileNaturalKeyConflict', () => {
  const basePayload = () => ({
    id: 'local-a', user_id: 'user-1', athlete_id: 'ath_A',
    date: '2026-06-30', updated_at: 10, data: {},
  })

  it('non-23505 error is not reconciled', async () => {
    expect(await reconcileNaturalKeyConflict('day_logs', basePayload(), 'user-1', { code: '23503' })).toBe(false)
  })

  it('non day/week table is not reconciled', async () => {
    expect(await reconcileNaturalKeyConflict('sessions', basePayload(), 'user-1', { code: '23505' })).toBe(false)
  })

  it('payload without athlete_id is not reconciled', async () => {
    const { athlete_id: _drop, ...noAthlete } = basePayload()
    expect(await reconcileNaturalKeyConflict('day_logs', noAthlete, 'user-1', { code: '23505' })).toBe(false)
  })

  it('payload without the natural date column is not reconciled', async () => {
    const { date: _drop, ...noDate } = basePayload()
    expect(await reconcileNaturalKeyConflict('day_logs', noDate, 'user-1', { code: '23505' })).toBe(false)
  })

  it('local newer → atomic conditional update by remote id (id stripped from body)', async () => {
    actionResults.set('select:day_logs', { data: [{ id: 'remote-b', updated_at: 5 }], error: null })
    actionResults.set('update:day_logs', { data: [{ id: 'remote-b' }], error: null })
    expect(await reconcileNaturalKeyConflict('day_logs', basePayload(), 'user-1', { code: '23505' })).toBe(true)
    const upd = updateCalls.find((c) => c.table === 'day_logs')
    expect(upd?.filters).toEqual(expect.arrayContaining([
      { op: 'eq', column: 'id', value: 'remote-b' },
      { op: 'eq', column: 'user_id', value: 'user-1' },
      { op: 'eq', column: 'athlete_id', value: 'ath_A' },
      { op: 'eq', column: 'date', value: '2026-06-30' },
      { op: 'lt', column: 'updated_at', value: 10 },
    ]))
    expect((upd?.payload as Record<string, unknown>).id).toBeUndefined()
  })

  it('remote newer/equal (tie) → skip, no update issued', async () => {
    actionResults.set('select:day_logs', { data: [{ id: 'remote-b', updated_at: 10 }], error: null })
    expect(await reconcileNaturalKeyConflict('day_logs', basePayload(), 'user-1', { code: '23505' })).toBe(true)
    expect(updateCalls.find((c) => c.table === 'day_logs')).toBeUndefined()
  })

  it('conditional update affects 0 rows and natural key still exists → handled skip', async () => {
    actionResults.set('select:day_logs', [
      { data: [{ id: 'remote-b', updated_at: 5 }], error: null },
      { data: [{ id: 'remote-b', updated_at: 10 }], error: null },
    ])
    actionResults.set('update:day_logs', { data: [], error: null })
    expect(await reconcileNaturalKeyConflict('day_logs', basePayload(), 'user-1', { code: '23505' })).toBe(true)
    expect(upsertCalls.filter((c) => c.table === 'day_logs')).toHaveLength(0)
  })

  it('conditional update affects 0 rows and natural key disappeared → retry upsert once', async () => {
    actionResults.set('select:day_logs', [
      { data: [{ id: 'remote-b', updated_at: 5 }], error: null },
      { data: [], error: null },
    ])
    actionResults.set('update:day_logs', { data: [], error: null })
    actionResults.set('upsert:day_logs', { data: null, error: null })
    expect(await reconcileNaturalKeyConflict('day_logs', basePayload(), 'user-1', { code: '23505' })).toBe(true)
    expect(upsertCalls.filter((c) => c.table === 'day_logs')).toHaveLength(1)
  })

  it('legacy (user_id,date) 23505 same athlete reconciles like post-008b', async () => {
    // Same 23505 code, legacy unique. Handled identically.
    actionResults.set('select:day_logs', { data: [{ id: 'remote-b', updated_at: 5 }], error: null })
    actionResults.set('update:day_logs', { data: [{ id: 'remote-b' }], error: null })
    expect(await reconcileNaturalKeyConflict('day_logs', basePayload(), 'user-1', { code: '23505' })).toBe(true)
  })

  it('SELECT finds no row → retry upsert once (success → handled)', async () => {
    actionResults.set('select:day_logs', { data: [], error: null })
    actionResults.set('upsert:day_logs', { data: null, error: null })
    expect(await reconcileNaturalKeyConflict('day_logs', basePayload(), 'user-1', { code: '23505' })).toBe(true)
    expect(upsertCalls.filter((c) => c.table === 'day_logs').length).toBe(1)
  })

  it('SELECT none → retry still 23505 → not handled (no false success)', async () => {
    actionResults.set('select:day_logs', { data: [], error: null })
    actionResults.set('upsert:day_logs', { data: null, error: { code: '23505' } })
    expect(await reconcileNaturalKeyConflict('day_logs', basePayload(), 'user-1', { code: '23505' })).toBe(false)
  })

  it('SELECT fails with a non-23505 error → throws the REAL error (not the original 23505)', async () => {
    actionResults.set('select:day_logs', { data: null, error: { message: 'network down', status: 503 } })
    await expect(reconcileNaturalKeyConflict('day_logs', basePayload(), 'user-1', { code: '23505' }))
      .rejects.toMatchObject({ status: 503 })
  })

  it('retry fails with a non-23505 error → throws the REAL error', async () => {
    actionResults.set('select:day_logs', { data: [], error: null })
    actionResults.set('upsert:day_logs', { data: null, error: { message: 'jwt expired', status: 401 } })
    await expect(reconcileNaturalKeyConflict('day_logs', basePayload(), 'user-1', { code: '23505' }))
      .rejects.toMatchObject({ status: 401 })
  })

  it('conditional update fails with a non-23505 error → throws the REAL error', async () => {
    actionResults.set('select:day_logs', { data: [{ id: 'remote-b', updated_at: 5 }], error: null })
    actionResults.set('update:day_logs', { data: null, error: { message: 'rls denied', status: 403 } })
    await expect(reconcileNaturalKeyConflict('day_logs', basePayload(), 'user-1', { code: '23505' }))
      .rejects.toMatchObject({ status: 403 })
  })

  it('non-finite remote updated_at → safe path (not handled)', async () => {
    actionResults.set('select:day_logs', { data: [{ id: 'remote-b', updated_at: 'nope' }], error: null })
    expect(await reconcileNaturalKeyConflict('day_logs', basePayload(), 'user-1', { code: '23505' })).toBe(false)
  })

  it('week_summaries uses week_start_date as the natural date column', async () => {
    const wk = { id: 'local-w', user_id: 'user-1', athlete_id: 'ath_A', week_start_date: '2026-06-29', updated_at: 10, data: {} }
    actionResults.set('select:week_summaries', { data: [{ id: 'remote-w', updated_at: 5 }], error: null })
    actionResults.set('update:week_summaries', { data: [{ id: 'remote-w' }], error: null })
    expect(await reconcileNaturalKeyConflict('week_summaries', wk, 'user-1', { code: '23505' })).toBe(true)
    // The SELECT filters by week_start_date; the UPDATE re-pins id/user_id/athlete_id/week_start_date + lt(updated_at).
    const sel = selectCalls.find((c) => c.table === 'week_summaries')
    expect(sel?.filters).toEqual(expect.arrayContaining([{ op: 'eq', column: 'week_start_date', value: '2026-06-29' }]))
    const upd = updateCalls.find((c) => c.table === 'week_summaries')
    expect(upd?.filters).toEqual(expect.arrayContaining([
      { op: 'eq', column: 'id', value: 'remote-w' },
      { op: 'eq', column: 'athlete_id', value: 'ath_A' },
      { op: 'eq', column: 'week_start_date', value: '2026-06-29' },
      { op: 'lt', column: 'updated_at', value: 10 },
    ]))
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/services/__tests__/syncService.test.ts -t reconcileNaturalKeyConflict`
Expected: FAIL — `reconcileNaturalKeyConflict` no existe / mock sin `lt`.

- [ ] **Step 4: Implement the helper in `syncService.ts`**

Agrega cerca de `stampAthleteIdIfLegacy` (~`:1313`):

```typescript
const NATURAL_KEY_DATE_COLUMN: Partial<Record<SupabaseTable, 'date' | 'week_start_date'>> = {
  day_logs: 'date',
  week_summaries: 'week_start_date',
}

type NaturalKeyDateColumn = 'date' | 'week_start_date'
type NaturalKeyRemoteRow = { id: string; updated_at: unknown }

function isReconcilableNaturalKeyConflict(
  table: SupabaseTable,
  payload: Record<string, unknown>,
  error: unknown,
): boolean {
  if ((error as { code?: unknown } | null)?.code !== '23505') return false
  const dateCol = NATURAL_KEY_DATE_COLUMN[table]
  if (!dateCol) return false
  const athleteId = payload.athlete_id
  if (typeof athleteId !== 'string' || athleteId.length === 0) return false
  const dateValue = payload[dateCol]
  return typeof dateValue === 'string' && dateValue.length > 0
}

async function selectRemoteNaturalKeyRow(
  table: SupabaseTable,
  dateCol: NaturalKeyDateColumn,
  userId: string,
  athleteId: string,
  dateValue: unknown,
  label: string,
): Promise<NaturalKeyRemoteRow | undefined> {
  const { data: rows, error } = await withRequestTimeout(
    getSupabase()
      .from(table)
      .select('id, updated_at')
      .eq('user_id', userId)
      .eq('athlete_id', athleteId)
      .eq(dateCol, dateValue)
      .limit(1),
    label,
  )
  if (error) throw error
  return (rows as NaturalKeyRemoteRow[] | null)?.[0]
}

async function retryNaturalKeyUpsertOnce(
  table: SupabaseTable,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const { error } = await withRequestTimeout(
    getSupabase().from(table).upsert(payload as never),
    `${table}.reconcile.retry`,
  )
  if (!error) return true
  if ((error as { code?: unknown }).code === '23505') return false
  throw error
}

/**
 * Reactive natural-key reconciliation for a `23505` on day_logs/week_summaries.
 * Returns true when the conflict is resolved (in-place update, LWW skip, or a
 * successful retry). Returns false when not reconcilable (guards), updated_at is
 * non-finite, or the retry stays 23505 (caller rethrows the original 23505). A
 * real error (network/auth/RLS) in select/update/non-23505-retry is thrown as
 * itself, so upsertRow's catch classifies it on the correct (retriable) path.
 * The local Dexie id is NOT touched; mergeDayLogs/mergeWeekSummaries converge it
 * on the next pull (see the `merges day logs by effective athlete key during a
 * full-user pull` test).
 *
 * Exported for direct unit testing of its many branches — test-visible/internal,
 * NOT part of the public sync API. Callers outside syncService should use
 * pushDayLog/pushWeekSummary.
 */
export async function reconcileNaturalKeyConflict(
  table: SupabaseTable,
  payload: Record<string, unknown>,
  userId: string,
  error: unknown,
): Promise<boolean> {
  if (!isReconcilableNaturalKeyConflict(table, payload, error)) return false
  const dateCol = NATURAL_KEY_DATE_COLUMN[table]!
  const athleteId = payload.athlete_id as string
  const dateValue = payload[dateCol]

  // 1. Locate the remote row occupying the natural key (cross-tenant defense: also user_id).
  const remote = await selectRemoteNaturalKeyRow(
    table,
    dateCol,
    userId,
    athleteId,
    dateValue,
    `${table}.reconcile.select`,
  )

  // Race: the conflicting row vanished between the failed insert and the select → retry once.
  if (!remote) {
    return retryNaturalKeyUpsertOnce(table, payload)
  }

  // updated_at coercion: never decide LWW on a non-finite timestamp.
  const localUpdatedAt = Number(payload.updated_at)
  const remoteUpdatedAt = Number(remote.updated_at)
  if (!Number.isFinite(localUpdatedAt) || !Number.isFinite(remoteUpdatedAt)) return false

  // 2. LWW: remote newer-or-equal (tie → remote wins) → skip; the next pull converges.
  if (remoteUpdatedAt >= localUpdatedAt) return true

  // local newer → atomic conditional update guarded by lt(updated_at).
  // The WHERE also re-pins athlete_id + dateCol so a concurrent scope/date change on that row
  // (rare race or a faulty update) can't make us overwrite a row that no longer owns this natural key.
  const body = { ...payload }
  delete (body as Record<string, unknown>).id
  const { data: updatedRows, error: updateError } = await withRequestTimeout(
    getSupabase()
      .from(table)
      .update(body as never)
      .eq('id', remote.id)
      .eq('user_id', userId)
      .eq('athlete_id', athleteId)
      .eq(dateCol, dateValue)
      .lt('updated_at', localUpdatedAt)
      .select('id'),
    `${table}.reconcile.update`,
  )
  if (updateError) throw updateError // real error surfaces; 0-rows is NOT an error (data: [], error: null)
  if (Array.isArray(updatedRows) && updatedRows.length > 0) return true

  // 0 rows can mean a concurrent remote winner, or that the row vanished/changed natural key.
  // Re-check the natural key before declaring the push handled.
  const currentRemote = await selectRemoteNaturalKeyRow(
    table,
    dateCol,
    userId,
    athleteId,
    dateValue,
    `${table}.reconcile.recheck`,
  )
  if (currentRemote) return true
  return retryNaturalKeyUpsertOnce(table, payload)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/services/__tests__/syncService.test.ts -t reconcileNaturalKeyConflict`
Expected: PASS (todos los casos).

- [ ] **Step 6: Run full suite + build**

Run: `npm test && npm run build`
Expected: verdes (mock extendido no afecta tests existentes).

- [ ] **Step 7: Commit** (no-op)

---

## Task 2: Wire the handler into `upsertRow`

**Files:**
- Modify: `src/services/syncService.ts` (`upsertRow` else-branch, ~`:1156-1160`)
- Modify: `src/services/__tests__/syncService.test.ts` (wiring test)

**Interfaces:**
- Consumes: `reconcileNaturalKeyConflict` (Task 1), `getUserId`/`userId` ya disponible en `upsertRow`.

- [ ] **Step 1: Write the failing wiring test**

Agrega en `src/services/__tests__/syncService.test.ts` (usa el setup estándar del archivo: `storeState.user = { id: 'user-1' }` ya se fija en `beforeEach`; `VITE_SUPABASE_URL` está presente en el env de test):

```typescript
describe('pushDayLog reconciles a 23505 instead of throwing', () => {
  it('does not throw and issues a conditional update when local is newer', async () => {
    actionResults.set('upsert:day_logs', { data: null, error: { code: '23505' } })
    actionResults.set('select:day_logs', { data: [{ id: 'remote-b', updated_at: 1 }], error: null })
    actionResults.set('update:day_logs', { data: [{ id: 'remote-b' }], error: null })

    await expect(
      syncService.pushDayLog({ id: 'local-a', date: '2026-06-30', updatedAt: 10, athleteId: 'ath_A' } as never),
    ).resolves.not.toThrow()

    expect(updateCalls.find((c) => c.table === 'day_logs')).toBeDefined()
  })
})
```

> Si el archivo importa símbolos nombrados en vez de `syncService.*`, usa `pushDayLog(...)` directo. `pushDayLog` estampa `athlete_id` vía `withAthleteId`, así que el payload tendrá `athlete_id: 'ath_A'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/syncService.test.ts -t "reconciles a 23505"`
Expected: FAIL — hoy `upsertRow` hace `throw error` en el `23505`.

- [ ] **Step 3: Wire reconcile into the `upsertRow` else-branch**

En `src/services/syncService.ts`, reemplaza el bloque del `else` (~`:1156-1160`):

```typescript
      } else {
        const { error } = await withRequestTimeout(
          getSupabase().from(table).upsert(payload as never),
          `${table}.upsert`,
        )
        if (error) throw error
      }
```

por:

```typescript
      } else {
        const { error } = await withRequestTimeout(
          getSupabase().from(table).upsert(payload as never),
          `${table}.upsert`,
        )
        if (error) {
          const handled = await reconcileNaturalKeyConflict(table, payload, userId, error)
          if (!handled) throw error
        }
      }
```

(No cambia nada para `athlete_profiles`, ni para tablas/errores no reconciliables — `reconcileNaturalKeyConflict` devuelve `false` y se hace `throw error` como hoy.)

- [ ] **Step 4: Run test + full suite + build**

Run: `npx vitest run src/services/__tests__/syncService.test.ts -t "reconciles a 23505" && npm test && npm run build`
Expected: verdes.

- [ ] **Step 5: Commit** (no-op)

---

## Task 3: `008b` migration (partial unique, self-guarded)

**Files:**
- Create: `supabase/008b_athlete_scope_unique.sql`

- [ ] **Step 1: Write the guarded migration**

Create `supabase/008b_athlete_scope_unique.sql`:

```sql
-- Athlete Scope F2 — remote integrity net for day_logs / week_summaries.
-- Additive partial unique on (athlete_id, <date>) WHERE athlete_id is not null.
-- Coexists with the legacy (user_id, date) uniques (NOT dropped in scope X).
-- Self-guarding: aborts before creating anything if any duplicate remains.
-- PREREQUISITE: deploy the client 23505 handler BEFORE running this (see plan rollout).

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

- [ ] **Step 2: Lint/build sanity (no SQL test harness)**

Run: `npm run lint && npm run build`
Expected: verdes (el `.sql` no afecta el bundle; es de aplicación manual).

- [ ] **Step 3: Commit** (no-op)

---

## Task 4: Rollout (operacional — NO aplicar `008b` antes que el handler esté en prod)

**Files:** ninguno (checklist de despliegue; sin código).

- [ ] **Step 1: Deploy del cliente con el handler primero.** Mergear/commitear (owner) Tasks 1–2 y desplegar. Con `008b` aún sin aplicar, el handler ya repara los `23505` de los uniques legacy `(user_id, date)`.
- [ ] **Step 2: Confirmar bundle nuevo en prod / evitar PWA stale.** Hard refresh; si aplica, bump de versión de cache del service worker (`public/sw.js`) para que ningún cliente quede con el bundle viejo antes de migrar.
- [ ] **Step 3: Correr `supabase/008a_athlete_scope_preflight.sql`** en Supabase; confirmar `day_logs dup` y `week_summaries dup` = 0.
- [ ] **Step 4: Aplicar `supabase/008b_athlete_scope_unique.sql`.** El `DO`-guard aborta si aparecieron duplicados desde `008a`.
- [ ] **Step 5: Smoke.** Crear y editar un day log **y** un week summary (idealmente desde dos dispositivos/mismo usuario y misma fecha) → **sin `23505`**. Tras un **full sync local**, verificar convergencia: una sola fila por `(athlete_id, fecha)` local y remoto.
- [ ] **Step 6: Anotar resultado** del smoke en el roadmap / notas.

---

## Self-Review Notes

- **Spec coverage:** handler acotado (guardas) → Task 1 (`isReconcilableNaturalKeyConflict`); SELECT con `user_id+athlete_id+dateCol` → Task 1; LWW atómico con `lt(updated_at)` + recheck/retry en 0 filas → Task 1; retry-once en SELECT-none → Task 1; coerción `updated_at` finito → Task 1; wiring sin tocar otras tablas → Task 2; `008b` aditiva con DO-guard → Task 3; rollout handler→008a→008b→smoke → Task 4. `migrateLocalDataToCloud` y uniques viejos intactos (scope X) — no hay task que los toque, por diseño.
- **Tests (8 del spec + extras):** local newer (update), remote≥ (skip), SELECT none→retry once, retry sigue 23505→no éxito falso, tabla no day/week→actual, payload sin athlete/fecha→actual, más: 0 filas + recheck encuentra clave (skip), 0 filas + clave desaparecida (retry), `23505` legacy mismo athlete, `updated_at` no finito, week_summaries dateCol. Wiring vía `pushDayLog` (Task 2).
- **Type/name consistency:** `reconcileNaturalKeyConflict(table, payload, userId, error): Promise<boolean>` usado idéntico en Task 1 (def/tests) y Task 2 (wiring). `NATURAL_KEY_DATE_COLUMN` mapea `day_logs→date`, `week_summaries→week_start_date`. `getSupabase`/`withRequestTimeout`/`SupabaseTable` ya importados en `syncService.ts`.
- **Convergencia de `id`:** intencionalmente delegada a `mergeDayLogs`/`mergeWeekSummaries`, no en el push. **Ya cubierta por test automatizado existente:** `syncService.test.ts` → `merges day logs by effective athlete key during a full-user pull` (~`:662`) prueba local `local-b` + remoto ganador `remote-b` (misma clave, distinto id) → tras `runFullSync` queda solo `remote-b` y se borra `local-b`. El smoke de Task 4 lo re-confirma end-to-end. (No hay que escribir test nuevo para esto.)
- **Mock infra:** Task 1 Step 1 extiende el builder de test (`lt`/`limit`/`select` + respuestas secuenciales) — necesario para los tests del reconcile y del wiring.

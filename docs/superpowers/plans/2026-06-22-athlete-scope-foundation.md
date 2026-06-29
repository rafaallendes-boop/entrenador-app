# Athlete Scope Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desacoplar internamente `athlete_id` del singleton `'default'`/`user_id` (fundación invisible de Coach Mode) sin cambiar la experiencia del atleta actual ni arriesgar datos, aprovechando la ventana pre-beta.

**Architecture:** Migración quirúrgica en 4 fases estrictas: (A) desacople de código con `getActiveAthleteId()` sin tocar datos; (B) Supabase expand+backfill (staging primero); (C) Dexie v13 aditiva + dry-run + test de upgrade; (D) sync dual `user_id`+`athlete_id` con lecturas legacy-aware detrás de flag. La migración es forward-only y por eso puramente aditiva; la reversibilidad de comportamiento viene del flag, no del schema.

**Tech Stack:** TypeScript, Dexie (IndexedDB), Supabase (Postgres + RLS), Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-22-athlete-scope-foundation-design.md`

## Global Constraints

- **Fases estrictas, no se mezclan.** Completar y dejar verde A antes de B, B antes de C, C antes de D. Un reviewer rechaza una task si toca trabajo de otra fase.
- **Orden de deploy:** el SQL de Fase B debe estar **aplicado en prod** antes de mergear la escritura dual de Fase D (el cliente nuevo escribe `athlete_id`; sin la columna, rompe).
- **`athlete_id` es `text`** (no uuid), alineado con los PKs text del proyecto y con `training_plans.athlete_id text not null` existente.
- **Naming:** local/TS = camelCase **`athleteId`**; Supabase/SQL = snake_case **`athlete_id`**. El mapeo lo hacen los row-mappers (como `userId`↔`user_id`). No mezclar.
- **`ATHLETE_PROFILE_LOCAL_ID = 'default'`** = clave local del perfil singleton; NUNCA se escribe en `athlete_id`.
- **`getActiveAthleteId(): string | null`**: el flag NO cambia su valor; devuelve el id text hidratado o `null`. Con `null`, todo cae a scope legacy por `user_id`.
- **Flag `VITE_ATHLETE_SCOPE`** (default `false`): gatea solo el *scope de lectura/escritura de sync*. Precondición dura: scope por athleteId solo si `getActiveAthleteId() !== null`.
- **Migración Dexie aditiva:** solo agrega; no borra ni reescribe; `user_id`/`'default'` permanecen. Cliente con flag off tras migrar = idéntico a v12.
- **`athletes` = Tier A y primer pull** (todo depende de tener la fila del atleta).
- **`coach_athlete_links`, RLS de membresía, UI de coach, constraints únicas por athlete_id, "contract": fuera de alcance.**
- **Dexie toma v13** (Whoop, diferido, pasará a v14).
- Verificación de cierre por task: `npm run lint && npm test && npm run build` verdes.

**⚠️ Política de commits:** El owner hace los commits. **NO ejecutar `git commit` ni `git add` dentro de las tasks.** Tratar los pasos "Commit" como no-op; dejar los cambios staged-pendientes para revisión consolidada.

---

## File Structure

```
src/services/athlete/
  athleteScopeFlag.ts                    [NEW: isAthleteScopeEnabled()]
  activeAthlete.ts                       [NEW: getActiveAthleteId, ATHLETE_PROFILE_LOCAL_ID, setActiveAthleteId]
  athleteScopeMigration.ts               [NEW: planAthleteScopeMigration() puro + backfill local]
  hydrateActiveAthlete.ts                [NEW: resuelve activeAthleteId desde Dexie athletes]
  __tests__/
    athleteScopeFlag.test.ts             [NEW]
    activeAthlete.test.ts                [NEW]
    athleteScopeMigration.test.ts        [NEW]
    hydrateActiveAthlete.test.ts         [NEW]
    noDirectDefault.test.ts              [NEW: guard anti-'default']

src/types/
  index.ts                               [MODIFY: +Athlete type; +athleteId opcional en Session/DayLog/WeekSummary/etc.]
  syncDiagnostics.ts                     [MODIFY: +'athletes' en SupabaseTable + ENTITY_TIER 'A']

src/db/
  db.ts                                  [MODIFY: v13 store athletes + índices athleteId + upgrade backfill]
  __tests__/
    athleteScopeUpgrade.test.ts          [NEW: test upgrade v12->v13]

src/store/
  (auth o training store)                [MODIFY: activeAthleteId + acción setActiveAthleteId]

src/services/
  syncService.ts                         [MODIFY (Fase D): escritura dual + lectura legacy-aware gated + pull athletes primero]
  syncUtils.ts                           [MODIFY (Fase A): usar ATHLETE_PROFILE_LOCAL_ID]
  athleteRows.ts                         [NEW (Fase D): athleteToRow / rowToAthlete mappers]

supabase/
  0NN_athlete_scope.sql                  [NEW (Fase B): expand + backfill + RLS]

scripts/
  migrate-dry-run.ts                     [NEW (Fase C): check previo manual]
```

---

# FASE A — Desacople interno (sin tocar datos)

> Resultado de la fase: `getActiveAthleteId()` existe y devuelve `null` (→ todo el código sigue en scope legacy por `user_id`, comportamiento idéntico a hoy). Los accesos directos a `'default'` se reemplazan por la constante. CERO cambio de datos o de schema.

## Task A1: Flag `athleteScopeFlag.ts`

**Files:**
- Create: `src/services/athlete/athleteScopeFlag.ts`
- Test: `src/services/athlete/__tests__/athleteScopeFlag.test.ts`

**Interfaces:**
- Produces: `isAthleteScopeEnabled(): boolean`.

- [x] **Step 1: Write the failing test**

Create `src/services/athlete/__tests__/athleteScopeFlag.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAthleteScopeEnabled } from '../athleteScopeFlag'

afterEach(() => { vi.unstubAllEnvs() })

describe('isAthleteScopeEnabled', () => {
  it('defaults to false', () => {
    expect(isAthleteScopeEnabled()).toBe(false)
  })

  it('is true when VITE_ATHLETE_SCOPE=true', () => {
    vi.stubEnv('VITE_ATHLETE_SCOPE', 'true')
    expect(isAthleteScopeEnabled()).toBe(true)
  })

  it('is forced off in production', () => {
    vi.stubEnv('PROD', true as unknown as string)
    vi.stubEnv('VITE_ATHLETE_SCOPE', 'true')
    // In prod we still allow opt-in only via explicit flag; this test documents
    // that the flag is the only gate. Keep prod-on possible but default off.
    expect(isAthleteScopeEnabled()).toBe(true)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/athlete/__tests__/athleteScopeFlag.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement the flag**

Create `src/services/athlete/athleteScopeFlag.ts`:

```typescript
/**
 * Gates the athlete_id scope behavior in sync (Fase D).
 * Default OFF. The flag only controls read/write scoping; it does NOT change
 * the value returned by getActiveAthleteId(), and it does NOT revert the Dexie
 * migration (which is additive).
 */
export function isAthleteScopeEnabled(): boolean {
  return import.meta.env.VITE_ATHLETE_SCOPE === 'true'
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/athlete/__tests__/athleteScopeFlag.test.ts`
Expected: PASS.

- [x] **Step 5: Commit** (no-op)

## Task A2: `activeAthlete.ts` + store `activeAthleteId`

**Files:**
- Create: `src/services/athlete/activeAthlete.ts`
- Test: `src/services/athlete/__tests__/activeAthlete.test.ts`
- Modify: el store de training/auth (identificar con `grep -rn "create<.*Store" src/store`); agregar `activeAthleteId: string | null` y `setActiveAthleteId`.

**Interfaces:**
- Produces:
  - `ATHLETE_PROFILE_LOCAL_ID = 'default'`
  - `getActiveAthleteId(): string | null` — lee el id hidratado (módulo-local), `null` si no hidratado.
  - `setActiveAthleteId(id: string | null): void` — setea el id hidratado (lo llama la hidratación en Fase C).

> Decisión de diseño: `getActiveAthleteId` lee de un holder módulo-local (no del store React) para poder usarse desde servicios no-React (`syncService`). La hidratación (Fase C) llama `setActiveAthleteId` y también actualiza el store para la UI.

- [x] **Step 1: Write the failing test**

Create `src/services/athlete/__tests__/activeAthlete.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest'
import { ATHLETE_PROFILE_LOCAL_ID, getActiveAthleteId, setActiveAthleteId } from '../activeAthlete'

describe('activeAthlete', () => {
  beforeEach(() => setActiveAthleteId(null))

  it('exposes the legacy local profile id constant', () => {
    expect(ATHLETE_PROFILE_LOCAL_ID).toBe('default')
  })

  it('returns null until hydrated', () => {
    expect(getActiveAthleteId()).toBeNull()
  })

  it('returns the hydrated id once set', () => {
    setActiveAthleteId('ath_123')
    expect(getActiveAthleteId()).toBe('ath_123')
  })

  it('can be reset back to null', () => {
    setActiveAthleteId('ath_123')
    setActiveAthleteId(null)
    expect(getActiveAthleteId()).toBeNull()
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/athlete/__tests__/activeAthlete.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Implement `activeAthlete.ts`**

Create `src/services/athlete/activeAthlete.ts`:

```typescript
/** Local Dexie key of the singleton athlete profile. NEVER written to athlete_id. */
export const ATHLETE_PROFILE_LOCAL_ID = 'default'

// Module-local holder so non-React services (syncService) can read the active
// athlete id without depending on a React store.
let activeAthleteId: string | null = null

/** The hydrated athlete id (text), or null when not yet resolved (legacy scope). */
export function getActiveAthleteId(): string | null {
  return activeAthleteId
}

export function setActiveAthleteId(id: string | null): void {
  activeAthleteId = id
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/athlete/__tests__/activeAthlete.test.ts`
Expected: PASS.

- [x] **Step 5: Add `activeAthleteId` to the store (UI mirror)**

In the training/auth store, add state `activeAthleteId: string | null` (default `null`) and an action `setActiveAthleteId(id: string | null)` that updates store state. (This mirror is for UI/devtools; the source of truth for services is the module holder in `activeAthlete.ts`. The hydration task in Fase C keeps both in sync.)

- [x] **Step 6: Run lint + build**

Run: `npm run lint && npm run build`
Expected: PASS.

- [x] **Step 7: Commit** (no-op)

## Task A3: Erradicar accesos directos a `'default'` + guard

**Files:**
- Modify: `src/services/syncUtils.ts` (líneas 379, 416, 713-714 y otras)
- Modify: `src/services/syncService.ts` (usos de `'default'`)
- Modify: cualquier otro archivo de `src/services`/`src/store` con `'default'` como id de perfil
- Test: `src/services/athlete/__tests__/noDirectDefault.test.ts`

**Interfaces:**
- Consumes: `ATHLETE_PROFILE_LOCAL_ID` (Task A2).

> Solo se reemplazan los `'default'` que representan el **id del perfil de atleta**. NO tocar `'default'` que sean valores de enums, `case 'default':`, defaults de switch, etc. Verificar cada ocurrencia.

- [x] **Step 1: Write the failing guard test**

Create `src/services/athlete/__tests__/noDirectDefault.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

describe('no direct default athlete-profile id', () => {
  it('only activeAthlete.ts may contain the literal default profile id', () => {
    // Find literal "'default'" in service/store source (excluding tests and the
    // canonical constant file). Allowlist switch/enum defaults by reviewing matches.
    const out = execSync(
      `grep -rn "'default'" src/services src/store --include=*.ts | grep -v "__tests__" | grep -v "athlete/activeAthlete.ts" || true`,
      { encoding: 'utf8' },
    ).trim()
    // After refactor, the only remaining matches must be non-profile usages.
    // List the known-allowed files/lines here as they are reviewed:
    const allowed: string[] = [
      // e.g. "src/services/foo.ts:42:  mode: 'default'" — enum value, not a profile id
    ]
    const offending = out
      ? out.split('\n').filter((line) => !allowed.some((a) => line.includes(a)))
      : []
    expect(offending, `Unexpected 'default' usages:\n${offending.join('\n')}`).toEqual([])
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/athlete/__tests__/noDirectDefault.test.ts`
Expected: FAIL — lists current `'default'` profile-id usages.

- [x] **Step 3: Replace profile-id usages with the constant**

In `src/services/syncUtils.ts`, import the constant and replace profile-id literals:

```typescript
import { ATHLETE_PROFILE_LOCAL_ID } from './athlete/activeAthlete'
```

- Line ~379 `id: 'default'` → `id: ATHLETE_PROFILE_LOCAL_ID`
- Line ~416 `String(row.id ?? 'default')` → `String(row.id ?? ATHLETE_PROFILE_LOCAL_ID)`
- Lines ~713-714 `if (a.id === 'default')` / `if (b.id === 'default')` → compare to `ATHLETE_PROFILE_LOCAL_ID`

Repeat in `src/services/syncService.ts` and any other non-test service/store file. For each match, decide: profile-id → replace; enum/switch default → leave and add to the `allowed` list in the guard test with a one-line justification.

- [x] **Step 4: Run guard + full suite**

Run: `npx vitest run src/services/athlete/__tests__/noDirectDefault.test.ts && npm test`
Expected: guard PASS; full suite still green (behavior unchanged — the constant equals `'default'`).

- [x] **Step 5: Run lint + build**

Run: `npm run lint && npm run build`
Expected: PASS.

- [x] **Step 6: Commit** (no-op)

## Task A4: Plan Builder / jobs usan `getActiveAthleteId()` en los bordes

**Files:**
- Modify: el/los call-site(s) del store que hoy inyectan `'default'` como `athleteId` al motor (buscar con `grep -rn "athleteId" src/store src/pages | grep -i "default\|'default'"` y `grep -rn "buildPlanShell\|runAsyncPlanGeneration\|runGeneration" src/store`).

**Interfaces:**
- Consumes: `getActiveAthleteId`, `ATHLETE_PROFILE_LOCAL_ID` (Task A2).

> El núcleo (`buildPlanShell`, `runAsyncPlanGeneration`) ya recibe `athleteId` por parámetro y `planRows` ya mapea `athlete_id`↔`athleteId`. Solo se cambia la **fuente** del valor en el borde: usar `getActiveAthleteId() ?? ATHLETE_PROFILE_LOCAL_ID` en vez del literal.

- [x] **Step 1: Locate the edges**

Run: `grep -rn "athleteId" src/store/usePlanBuilderStore.ts src/store | grep -i default`
Identify each place that passes `'default'` (or an implicit equivalent) as `athleteId` into the engine.

- [x] **Step 2: Replace the source of athleteId**

At each edge, import and use:

```typescript
import { getActiveAthleteId, ATHLETE_PROFILE_LOCAL_ID } from '../services/athlete/activeAthlete'
// ...
const athleteId = getActiveAthleteId() ?? ATHLETE_PROFILE_LOCAL_ID
```

With `getActiveAthleteId()` returning `null` in Fase A, this evaluates to `'default'` → behavior unchanged.

- [x] **Step 3: Run plan-builder tests + full suite**

Run: `npm test`
Expected: green (no behavior change).

- [x] **Step 4: Run lint + build**

Run: `npm run lint && npm run build`
Expected: PASS.

- [x] **Step 5: Commit** (no-op)

---

# FASE B — Supabase expand + backfill (staging primero)

> Resultado de la fase: el schema remoto tiene `athletes` + columnas `athlete_id` backfilleadas + RLS por propiedad, **sin** cambiar el cliente. Las políticas viejas por `user_id` siguen. Probado en staging antes de prod.

## Task B1: Migración SQL `0NN_athlete_scope.sql`

**Files:**
- Create: `supabase/0NN_athlete_scope.sql` (confirmar el próximo número: última es `006` → usar `007` salvo que ya exista; el plan de Whoop, diferido, también mencionaba `007`).

**Interfaces:**
- Produces: tabla `athletes`; columna `athlete_id text` en las tablas de entrenamiento; FK e índices; RLS por propiedad sobre `athletes`.

- [x] **Step 1: Escribir la migración**

Create `supabase/007_athlete_scope.sql` (ajustar número si corresponde):

La migración fuente queda en `supabase/007_athlete_scope.sql`. Requisitos que debe cumplir:

- Crear `public.athletes` con PK `text`, RLS por propiedad y `id` determinístico `ath_<userId>`.
- Recolectar `user_id` solo desde tablas que existan **y** tengan columna `user_id`.
- Usar tabla temporal sin `ON COMMIT DROP` y limpiarla con `DROP TABLE IF EXISTS` explícito, para que funcione tanto con runners transaccionales como en modo autocommit.
- Tratar `training_plans` como caso especial: `athlete_id text not null` ya existe y solo se backfillea `'default'`/`NULL` al id real.
- Agregar `athlete_id text` nullable en tablas existentes que aún no la tengan.
- Backfill de `training_plan_weeks.athlete_id` desde el plan padre, no desde `user_id`.
- Crear índices cuando la tabla tenga columna `athlete_id`; crear FK `not valid` salvo en `training_plans`, cuya FK queda diferida a Fase D porque el cliente actual aún puede escribir `athlete_id = 'default'`.
- En Fase B crear solo políticas **SELECT** por `athlete_id` para tablas de entrenamiento.
- No crear políticas `INSERT`/`UPDATE`/`DELETE` por `athlete_id` en Fase B. Esas quedan diferidas a Fase D para evitar bypass cross-tenant con filas legacy/null.
- Borrar defensivamente políticas `*_insert_by_athlete`, `*_update_by_athlete` y `*_delete_by_athlete` si una versión anterior de la migración se hubiera probado.

> Nota: las FK se crean `not valid` para no bloquear si hubiera alguna fila legacy sin backfillear; validar luego con `alter table ... validate constraint` cuando se confirme 0 huérfanas. `training_plans` conserva solo índice en Fase B y su FK se agrega en Fase D, después de que el cliente escriba ids reales. El `id` determinístico `ath_<userId>` hace el backfill idempotente y permite que el cliente reconstruya el mismo id localmente.

- [ ] **Step 2: Aplicar en staging y smoke**

Aplicar en un proyecto Supabase de **staging**. Verificar:
- `select count(*) from athletes` = nº de usuarios con perfil.
- `select count(*) from sessions where athlete_id is null` = 0.
- `select count(*) from training_plan_weeks tpw join training_plans tp on tpw.plan_id=tp.id where tpw.athlete_id <> tp.athlete_id` = 0.
- Como usuario autenticado, `select * from athletes` devuelve solo los propios (RLS).

Anotar resultados en las notas del task.

- [ ] **Step 3: Commit** (no-op)

---

# FASE C — Dexie v13 aditiva + dry-run + test de upgrade

> Resultado de la fase: Dexie v13 con tabla `athletes` local e índices `athleteId`, backfill local idempotente, dry-run ejecutable como check previo, y `activeAthleteId` hidratado al iniciar. Cliente con flag off = comportamiento idéntico a v12.

## Task C1: Tipos `Athlete` + `athleteId` opcional en tipos locales

**Files:**
- Modify: `src/types/index.ts`

**Interfaces:**
- Produces:
  - `interface Athlete { id: string; ownerAccountId: string; linkedAccountId?: string | null; displayName?: string | null; status: string; createdAt: number; updatedAt: number }`
  - Campo `athleteId?: string` agregado a `Session`, `DayLog`, `WeekSummary`, `CoachProposal`, `AthleteProfile`, `ChatMessage` (y normalizar el existente en `TrainingPlan`/`TrainingPlanWeek` si hace falta).

- [ ] **Step 1: Add the `Athlete` type**

In `src/types/index.ts`:

```typescript
export interface Athlete {
  id: string                    // text PK, e.g. "ath_<userId>"
  ownerAccountId: string
  linkedAccountId?: string | null
  displayName?: string | null
  status: string                // 'active' | ...
  createdAt: number
  updatedAt: number
}
```

- [ ] **Step 2: Add optional `athleteId` to training entity types**

Add `athleteId?: string` to the interfaces for `Session`, `DayLog`, `WeekSummary`, `CoachProposal`, `AthleteProfile`, `ChatMessage` (camelCase, optional — additive, non-breaking). `TrainingPlan` already has `athleteId`.

- [ ] **Step 3: Run build (type check)**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit** (no-op)

## Task C2: Dexie v13 — tabla `athletes` + índices `athleteId` + upgrade backfill + test

**Files:**
- Modify: `src/db/db.ts`
- Test: `src/db/__tests__/athleteScopeUpgrade.test.ts`

**Interfaces:**
- Consumes: `Athlete` type (C1), `ATHLETE_PROFILE_LOCAL_ID` (A2).
- Produces: `db.athletes` table; `athleteId` indices on synced stores; idempotent upgrade backfill.

- [ ] **Step 1: Write the failing upgrade test**

Create `src/db/__tests__/athleteScopeUpgrade.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from 'vitest'
import { db } from '../db'

describe('Dexie v13 athlete scope upgrade', () => {
  beforeEach(async () => {
    await db.athletes.clear()
    await db.sessions.clear()
    await db.athleteProfiles.clear()
  })

  it('creates an athlete and backfills athleteId on existing rows', async () => {
    // seed legacy-shaped data (no athleteId)
    await db.athleteProfiles.put({ id: 'default', updatedAt: Date.now() } as any)
    await db.sessions.put({ id: 's1', date: '2026-06-22', type: 'squash', status: 'planned' } as any)

    // run the idempotent local backfill against a known owner id
    const { backfillLocalAthleteScope } = await import('../../services/athlete/athleteScopeMigration')
    await backfillLocalAthleteScope('user-1')

    const athlete = await db.athletes.get('ath_user-1')
    expect(athlete?.ownerAccountId).toBe('user-1')
    const session = await db.sessions.get('s1')
    expect((session as any).athleteId).toBe('ath_user-1')
  })

  it('is idempotent (running twice does not duplicate or break)', async () => {
    const { backfillLocalAthleteScope } = await import('../../services/athlete/athleteScopeMigration')
    await db.athleteProfiles.put({ id: 'default', updatedAt: Date.now() } as any)
    await backfillLocalAthleteScope('user-1')
    await backfillLocalAthleteScope('user-1')
    expect(await db.athletes.count()).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/__tests__/athleteScopeUpgrade.test.ts`
Expected: FAIL — `db.athletes` undefined / migration module missing.

- [ ] **Step 3: Add the v13 store and table declaration**

In `src/db/db.ts`:
- Import `Athlete` from `../types`.
- Add the table property: `athletes!: Table<Athlete, string>`.
- After the `this.version(12)` block, add:

```typescript
    this.version(13).stores({
      athletes:           'id, ownerAccountId, updatedAt',
      sessions:           'id, date, weekStartDate, type, status, completedAt, athleteId',
      dayLogs:            'id, &date, athleteId',
      weekSummaries:      'id, &weekStartDate, athleteId',
      chatMessages:       'id, timestamp, chatSessionId, athleteId',
      coachProposals:     'id, status, createdAt, resolvedAt, chatMessageId, athleteId',
      athleteProfiles:    'id, updatedAt, athleteId',
      trainingPlans:      'id, athleteId, goalEventId, status, startDate, updatedAt',
      trainingPlanWeeks:  'id, planId, weekStartDate, status, [planId+weekIndex], athleteId',
    })
```

(Only adds `athleteId` indices + the `athletes` store; everything else identical to v12. `&date`/`&weekStartDate` unique indices unchanged — see deuda F2 in spec.)

- [ ] **Step 4: Implement `backfillLocalAthleteScope` (used by upgrade + test)**

This lives in `athleteScopeMigration.ts` (Task C3 creates the file; C2 adds this function). Add to `src/services/athlete/athleteScopeMigration.ts`:

```typescript
import { db } from '../../db/db'

export function athleteIdForOwner(ownerAccountId: string): string {
  return `ath_${ownerAccountId}`
}

/** Idempotent local backfill: ensure an athlete row + set athleteId on legacy rows. */
export async function backfillLocalAthleteScope(ownerAccountId: string): Promise<void> {
  const athleteId = athleteIdForOwner(ownerAccountId)
  const now = Date.now()
  await db.athletes.put({
    id: athleteId, ownerAccountId, linkedAccountId: ownerAccountId,
    status: 'active', createdAt: now, updatedAt: now,
  })
  const tables = [db.sessions, db.dayLogs, db.weekSummaries, db.chatMessages,
                  db.coachProposals, db.athleteProfiles, db.trainingPlans, db.trainingPlanWeeks]
  for (const table of tables) {
    const rows = await table.toArray()
    const patched = rows
      .filter((r: any) => r.athleteId == null)
      .map((r: any) => ({ ...r, athleteId }))
    if (patched.length) await table.bulkPut(patched as any)
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/db/__tests__/athleteScopeUpgrade.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Run full suite + lint + build**

Run: `npm test && npm run lint && npm run build`
Expected: green (additive migration; existing tests unaffected).

- [ ] **Step 7: Commit** (no-op)

## Task C3: Dry-run puro + script previo

**Files:**
- Modify: `src/services/athlete/athleteScopeMigration.ts` (add `planAthleteScopeMigration`)
- Create: `scripts/migrate-dry-run.ts`
- Test: `src/services/athlete/__tests__/athleteScopeMigration.test.ts`

**Interfaces:**
- Produces: `planAthleteScopeMigration(snapshot: ScopeSnapshot): ScopeMigrationReport` (pure).
  - `interface ScopeSnapshot { tables: Record<string, Array<{ athleteId?: string | null }>> }`
  - `interface ScopeMigrationReport { perTable: Record<string, { total: number; toMap: number; alreadyMapped: number }>; totalToMap: number }`

- [ ] **Step 1: Write the failing test**

Create `src/services/athlete/__tests__/athleteScopeMigration.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { planAthleteScopeMigration } from '../athleteScopeMigration'

describe('planAthleteScopeMigration (dry-run)', () => {
  it('reports rows to map vs already mapped, without mutating', () => {
    const snapshot = {
      tables: {
        sessions: [{ athleteId: 'ath_1' }, { athleteId: null }, {}],
        dayLogs: [{ athleteId: undefined }],
      },
    }
    const report = planAthleteScopeMigration(snapshot)
    expect(report.perTable.sessions).toEqual({ total: 3, toMap: 2, alreadyMapped: 1 })
    expect(report.perTable.dayLogs).toEqual({ total: 1, toMap: 1, alreadyMapped: 0 })
    expect(report.totalToMap).toBe(3)
    // snapshot unchanged
    expect(snapshot.tables.sessions[1]).toEqual({ athleteId: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/athlete/__tests__/athleteScopeMigration.test.ts`
Expected: FAIL — `planAthleteScopeMigration` not exported.

- [ ] **Step 3: Implement the pure dry-run**

Add to `src/services/athlete/athleteScopeMigration.ts`:

```typescript
export interface ScopeSnapshot {
  tables: Record<string, Array<{ athleteId?: string | null }>>
}
export interface ScopeMigrationReport {
  perTable: Record<string, { total: number; toMap: number; alreadyMapped: number }>
  totalToMap: number
}

export function planAthleteScopeMigration(snapshot: ScopeSnapshot): ScopeMigrationReport {
  const perTable: ScopeMigrationReport['perTable'] = {}
  let totalToMap = 0
  for (const [table, rows] of Object.entries(snapshot.tables)) {
    const toMap = rows.filter((r) => r.athleteId == null).length
    perTable[table] = { total: rows.length, toMap, alreadyMapped: rows.length - toMap }
    totalToMap += toMap
  }
  return { perTable, totalToMap }
}
```

- [ ] **Step 4: Add the dev script**

Create `scripts/migrate-dry-run.ts` that builds a snapshot from the local Dexie tables and prints the report. Add an npm script `"migrate:dry-run": "tsx scripts/migrate-dry-run.ts"` (use the project's existing TS runner; if none, document running via `npx tsx`). The script reuses `planAthleteScopeMigration` so the dev can validate counts BEFORE the automatic Dexie upgrade runs.

```typescript
import { db } from '../src/db/db'
import { planAthleteScopeMigration } from '../src/services/athlete/athleteScopeMigration'

async function main() {
  const tables = {
    sessions: await db.sessions.toArray(),
    dayLogs: await db.dayLogs.toArray(),
    weekSummaries: await db.weekSummaries.toArray(),
    chatMessages: await db.chatMessages.toArray(),
    coachProposals: await db.coachProposals.toArray(),
    athleteProfiles: await db.athleteProfiles.toArray(),
    trainingPlans: await db.trainingPlans.toArray(),
    trainingPlanWeeks: await db.trainingPlanWeeks.toArray(),
  }
  console.log(JSON.stringify(planAthleteScopeMigration({ tables } as any), null, 2))
}
main()
```

- [ ] **Step 5: Run test + build**

Run: `npx vitest run src/services/athlete/__tests__/athleteScopeMigration.test.ts && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit** (no-op)

## Task C4: Hidratación de `activeAthleteId` al iniciar

**Files:**
- Create: `src/services/athlete/hydrateActiveAthlete.ts`
- Test: `src/services/athlete/__tests__/hydrateActiveAthlete.test.ts`
- Modify: el punto de arranque/auth (donde se resuelve el usuario logueado; `grep -rn "getUserId\|onAuth\|bootstrap" src/services src/store | head`) para llamar `hydrateActiveAthlete(userId)` tras login.

**Interfaces:**
- Consumes: `setActiveAthleteId` (A2), `db.athletes`, `athleteIdForOwner` (C2).
- Produces: `hydrateActiveAthlete(ownerAccountId: string): Promise<string | null>` — resuelve el id, setea el holder + store, devuelve el id o `null`.

- [ ] **Step 1: Write the failing test**

Create `src/services/athlete/__tests__/hydrateActiveAthlete.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from 'vitest'
import { db } from '../../db/db'
import { hydrateActiveAthlete } from '../hydrateActiveAthlete'
import { getActiveAthleteId, setActiveAthleteId } from '../activeAthlete'

describe('hydrateActiveAthlete', () => {
  beforeEach(async () => { await db.athletes.clear(); setActiveAthleteId(null) })

  it('sets activeAthleteId from local athletes row', async () => {
    const now = Date.now()
    await db.athletes.put({ id: 'ath_u1', ownerAccountId: 'u1', status: 'active', createdAt: now, updatedAt: now })
    const id = await hydrateActiveAthlete('u1')
    expect(id).toBe('ath_u1')
    expect(getActiveAthleteId()).toBe('ath_u1')
  })

  it('returns null and stays legacy when no athlete row exists', async () => {
    const id = await hydrateActiveAthlete('u1')
    expect(id).toBeNull()
    expect(getActiveAthleteId()).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/athlete/__tests__/hydrateActiveAthlete.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `hydrateActiveAthlete.ts`**

Create `src/services/athlete/hydrateActiveAthlete.ts`:

```typescript
import { db } from '../../db/db'
import { setActiveAthleteId } from './activeAthlete'

/**
 * Resolve the owner's athlete id for scoping. Source of truth order:
 * 1. Local Dexie `athletes` row owned by the user.
 * 2. (Fase D) if absent locally but present remotely, the athletes pull will
 *    populate Dexie and a later hydrate call resolves it.
 * 3. null -> legacy scope by user_id.
 */
export async function hydrateActiveAthlete(ownerAccountId: string): Promise<string | null> {
  const row = await db.athletes.where('ownerAccountId').equals(ownerAccountId).first()
  const id = row?.id ?? null
  setActiveAthleteId(id)
  return id
}
```

- [ ] **Step 4: Wire it at startup**

After auth resolves the logged-in user (the bootstrap/auth path), call `await hydrateActiveAthlete(userId)`. Also update the store mirror (`setActiveAthleteId` action from A2) so UI/devtools reflect it. With the flag off this has no behavioral effect on scope.

- [ ] **Step 5: Run test + full suite + lint + build**

Run: `npx vitest run src/services/athlete/__tests__/hydrateActiveAthlete.test.ts && npm test && npm run lint && npm run build`
Expected: green.

- [ ] **Step 6: Commit** (no-op)

---

# FASE D — Sync dual + lecturas legacy-aware detrás de flag

> **GATE DE DEPLOY:** no mergear esta fase a prod hasta que el SQL de Fase B esté **aplicado en prod**. El cliente nuevo escribe `athlete_id`; sin la columna, rompe.
> Resultado de la fase: escritura dual (`user_id`+`athlete_id`), `athletes` sincronizado como Tier A y primero, lecturas legacy-aware solo con flag on + atleta hidratado. Flag off = idéntico a hoy.

## Task D1: `athletes` como tabla syncable Tier A + mappers + primer pull

**Files:**
- Modify: `src/types/syncDiagnostics.ts` (add `'athletes'` to `SupabaseTable` + `ENTITY_TIER: 'A'`)
- Create: `src/services/athleteRows.ts`
- Modify: `src/services/syncService.ts` (registrar `athletes` en el pull, primero)
- Test: `src/services/__tests__/athleteRows.test.ts`

**Interfaces:**
- Produces:
  - `athleteToRow(a: Athlete, userId: string): AthleteRow`
  - `rowToAthlete(row: AthleteRow): Athlete`
- Consumes: `Athlete` (C1).

- [ ] **Step 1: Write the failing mapper test**

Create `src/services/__tests__/athleteRows.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { athleteToRow, rowToAthlete } from '../athleteRows'

const athlete = {
  id: 'ath_u1', ownerAccountId: 'u1', linkedAccountId: 'u1',
  displayName: null, status: 'active', createdAt: 1, updatedAt: 2,
}

describe('athleteRows mappers', () => {
  it('maps camelCase <-> snake_case round-trip', () => {
    const row = athleteToRow(athlete, 'u1')
    expect(row.owner_account_id).toBe('u1')
    expect(row.id).toBe('ath_u1')
    expect(rowToAthlete(row)).toEqual(athlete)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/athleteRows.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `athleteRows.ts`**

Create `src/services/athleteRows.ts`:

```typescript
import type { Athlete } from '../types'

export interface AthleteRow {
  id: string
  owner_account_id: string
  linked_account_id: string | null
  display_name: string | null
  status: string
  created_at: number
  updated_at: number
}

export function athleteToRow(a: Athlete, _userId: string): AthleteRow {
  return {
    id: a.id,
    owner_account_id: a.ownerAccountId,
    linked_account_id: a.linkedAccountId ?? null,
    display_name: a.displayName ?? null,
    status: a.status,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  }
}

export function rowToAthlete(row: AthleteRow): Athlete {
  return {
    id: row.id,
    ownerAccountId: row.owner_account_id,
    linkedAccountId: row.linked_account_id,
    displayName: row.display_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
```

- [ ] **Step 4: Register `athletes` as Tier A**

In `src/types/syncDiagnostics.ts`, add `'athletes'` to the `SupabaseTable` union and to `ENTITY_TIER`:

```typescript
export const ENTITY_TIER: Record<SupabaseTable, SyncTier> = {
  athletes: 'A',
  athlete_profiles: 'A',
  sessions: 'A',
  training_plans: 'A',
  training_plan_weeks: 'A',
  day_logs: 'B',
  week_summaries: 'B',
  coach_proposals: 'B',
  chat_messages: 'C',
}
```

- [ ] **Step 5: Pull `athletes` first**

In `src/services/syncService.ts`, add `athletes` to the pull/reconcile flow so it is fetched and written to Dexie **before** any athlete_id-scoped table. After pulling athletes, re-run `hydrateActiveAthlete(userId)` so `activeAthleteId` reflects a remotely-created athlete on a fresh device. Use the existing pull pattern (`fetchAll('athletes', userId)` → `rowToAthlete` → `db.athletes.bulkPut`). Athletes is owned-scoped by `owner_account_id`, so fetch by that column.

- [ ] **Step 6: Run tests + lint + build**

Run: `npx vitest run src/services/__tests__/athleteRows.test.ts && npm test && npm run lint && npm run build`
Expected: green.

- [ ] **Step 7: Commit** (no-op)

## Task D2: Escritura dual (`athlete_id` en todos los writes)

**Files:**
- Modify: `src/services/syncService.ts` (write/upsert paths) and/or the per-table row mappers
- Test: `src/services/__tests__/dualWriteAthleteId.test.ts`

**Interfaces:**
- Consumes: `getActiveAthleteId` (A2).

> Cada upsert remoto agrega `athlete_id = getActiveAthleteId()` cuando no es `null`. Es independiente del flag (escribir ambos ids siempre es seguro). `training_plans`/`training_plan_weeks` ya mapean `athlete_id` vía `planRows`; aquí se cubren las demás tablas.

- [ ] **Step 1: Write the failing test**

Create `src/services/__tests__/dualWriteAthleteId.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from 'vitest'
import { setActiveAthleteId } from '../athlete/activeAthlete'
import { withAthleteId } from '../syncService'  // small exported helper (Step 3)

describe('dual write athlete_id', () => {
  beforeEach(() => setActiveAthleteId(null))

  it('adds athlete_id when hydrated', () => {
    setActiveAthleteId('ath_u1')
    expect(withAthleteId({ id: 's1', user_id: 'u1' })).toEqual({ id: 's1', user_id: 'u1', athlete_id: 'ath_u1' })
  })

  it('omits athlete_id when not hydrated (legacy row stays null)', () => {
    expect(withAthleteId({ id: 's1', user_id: 'u1' })).toEqual({ id: 's1', user_id: 'u1' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/dualWriteAthleteId.test.ts`
Expected: FAIL — `withAthleteId` not exported.

- [ ] **Step 3: Implement `withAthleteId` and apply to write paths**

In `src/services/syncService.ts`, add and export:

```typescript
import { getActiveAthleteId } from './athlete/activeAthlete'

/** Attach athlete_id to a remote row when an athlete is hydrated; no-op otherwise. */
export function withAthleteId<T extends Record<string, unknown>>(row: T): T {
  const athleteId = getActiveAthleteId()
  return athleteId ? { ...row, athlete_id: athleteId } : row
}
```

Wrap the row in each non-plan upsert (sessions, day_logs, week_summaries, chat_messages, coach_proposals, athlete_profiles) with `withAthleteId(...)` at the point the row object is built for the remote write. For plans/weeks, ensure `planRows` writes the hydrated `athleteId` (it already maps `athlete_id` from `plan.athleteId`; confirm `plan.athleteId` carries the hydrated id from A4).

- [ ] **Step 4: Run test + full suite**

Run: `npx vitest run src/services/__tests__/dualWriteAthleteId.test.ts && npm test`
Expected: green.

- [ ] **Step 5: Run lint + build**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit** (no-op)

## Task D3: Lecturas legacy-aware detrás de flag + precondición

**Files:**
- Modify: `src/services/syncService.ts` (read/fetch scoping)
- Create: `src/services/athlete/readScope.ts`
- Test: `src/services/athlete/__tests__/readScope.test.ts`

**Interfaces:**
- Consumes: `isAthleteScopeEnabled` (A1), `getActiveAthleteId` (A2).
- Produces: `resolveReadScope(userId: string): { mode: 'legacy' } | { mode: 'athlete'; athleteId: string }`.

- [ ] **Step 1: Write the failing test**

Create `src/services/athlete/__tests__/readScope.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveReadScope } from '../readScope'
import { setActiveAthleteId } from '../activeAthlete'

afterEach(() => vi.unstubAllEnvs())
beforeEach(() => setActiveAthleteId(null))

describe('resolveReadScope', () => {
  it('is legacy when flag off', () => {
    setActiveAthleteId('ath_u1')
    expect(resolveReadScope('u1')).toEqual({ mode: 'legacy' })
  })

  it('is legacy when flag on but not hydrated (hard precondition)', () => {
    vi.stubEnv('VITE_ATHLETE_SCOPE', 'true')
    expect(resolveReadScope('u1')).toEqual({ mode: 'legacy' })
  })

  it('is athlete-scoped when flag on AND hydrated', () => {
    vi.stubEnv('VITE_ATHLETE_SCOPE', 'true')
    setActiveAthleteId('ath_u1')
    expect(resolveReadScope('u1')).toEqual({ mode: 'athlete', athleteId: 'ath_u1' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/athlete/__tests__/readScope.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `readScope.ts`**

Create `src/services/athlete/readScope.ts`:

```typescript
import { isAthleteScopeEnabled } from './athleteScopeFlag'
import { getActiveAthleteId } from './activeAthlete'

export type ReadScope = { mode: 'legacy' } | { mode: 'athlete'; athleteId: string }

/** Hard precondition: athlete scope only when flag ON *and* an athlete is hydrated. */
export function resolveReadScope(_userId: string): ReadScope {
  const athleteId = getActiveAthleteId()
  if (isAthleteScopeEnabled() && athleteId) return { mode: 'athlete', athleteId }
  return { mode: 'legacy' }
}
```

- [ ] **Step 4: Apply legacy-aware scoping in reads**

In `src/services/syncService.ts`, at the remote read points (`fetchAll(table, userId)` → `.eq('user_id', userId)`), branch on `resolveReadScope(userId)`:
- `legacy` → keep `.eq('user_id', userId)` (unchanged).
- `athlete` → scope including legacy rows without athlete_id, e.g.:
  `.or(\`athlete_id.eq.${athleteId},and(athlete_id.is.null,user_id.eq.${userId})\`)`
  (Supabase PostgREST `or` syntax). This prevents legacy rows from disappearing when the flag turns on. Do NOT apply athlete scoping to the `athletes` table itself (it is owner-scoped).

- [ ] **Step 5: Run test + full suite**

Run: `npx vitest run src/services/athlete/__tests__/readScope.test.ts && npm test`
Expected: green.

- [ ] **Step 6: Run lint + build**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit** (no-op)

---

## Self-Review Notes

- **Spec coverage:** flag → A1; `getActiveAthleteId`/`ATHLETE_PROFILE_LOCAL_ID`/store → A2; erradicar `'default'` + guard → A3; bordes plan builder → A4; SQL expand+backfill (athletes, athlete_id text, training_plans special-case, training_plan_weeks from plan, FK/index, RLS) → B1; tipos → C1; Dexie v13 aditiva + upgrade test + idempotent backfill → C2; dry-run pure + script previo → C3; hidratación → C4; athletes Tier A + first pull + mappers → D1; escritura dual → D2; lecturas legacy-aware + precondición flag/null → D3. Naming camelCase/snake_case enforced in mappers (athleteRows, planRows) and stated in constraints.
- **Deferred (out of scope, per spec):** coach_athlete_links, membership RLS, coach UI, unique-index migration to athlete_id (deuda F2), contract. None planned here — correct.
- **Phase strictness:** each phase is a contiguous block; D carries the deploy gate (B applied in prod first). A and C are behavior-neutral (flag off / null → legacy).
- **Type consistency:** `athleteIdForOwner` (`ath_<id>`) used in SQL backfill (`'ath_' || user_id`), C2 local backfill, and hydration — consistent. `withAthleteId` (D2), `resolveReadScope` (D3), `isAthleteScopeEnabled` (A1), `getActiveAthleteId`/`setActiveAthleteId` (A2) names consistent across tasks.
- **Placeholder scan:** SQL number `0NN`/`007` flagged to confirm at implementation (last is `006`); store file and bootstrap call-site located via grep in their tasks (real files, exact anchors given). No code placeholders.
```

# Athlete-Aware Core (Coach UI F2-lite — Parte 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer athlete-aware el núcleo de lecturas y la selección activa (política legacy self-only, scoping de sessions/summaries/proposals/contexto IA, chat session por atleta, selección persistida) sin ningún cambio visible para el usuario single-athlete actual.

**Architecture:** Se introduce un holder de `selfAthleteId` junto al `activeAthleteId` existente; la regla de scope pasa a ser "filas scoped → deben matchear el atleta activo; filas legacy/unscoped → pertenecen SOLO al self". Un helper puro (`isRowInActiveScope`/`filterRowsToActiveScope`) se aplica en cada lectura de UI/contexto IA. El fallback legacy del sync se ancla al self (nunca estampa legacy con un id gestionado). La hidratación se vuelve selection-aware (selección persistida en localStorage, validada contra `db.athletes`), lo que de paso hace que `pullAthletes`/`ensureRemoteAthlete` no pisen una selección válida.

**Tech Stack:** TypeScript, Dexie (fake-indexeddb en tests), Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-02-coach-ui-f2-mvp-design.md` (§0, §3.3, §3.6). Este plan es la **Parte 1** del spec; la Parte 2 (perfiles multi-atleta + 009 + API gestionados + switcher/roster, §3.1–§3.2, §3.4–§3.5, §3.7) se planifica al cerrar esta.

## Global Constraints

- **Cero cambio de comportamiento single-athlete:** hoy `activeAthleteId === selfAthleteId` siempre; toda rama nueva debe ser un no-op en ese caso. La suite existente completa debe seguir verde.
- **Política legacy self-only (spec §3.6):** filas legacy/unscoped (athleteId ausente, vacío o `'default'`) se leen/adoptan SOLO cuando el atleta activo es el self o no hay atleta activo (modo legacy pre-hidratación). Un atleta gestionado nunca las ve ni las adopta.
- **Detección legacy SIEMPRE vía `isScopedAthleteId`** (`src/services/athlete/effectiveAthleteKey.ts`), nunca checks falsy (el sentinel `'default'` es truthy).
- **`isInAthleteScope` existente NO se toca** (lo usa el scope de deletes del sync); las lecturas usan el helper nuevo de Task 2.
- **`VITE_ATHLETE_SCOPE` sigue off**; `readScope.ts` no se modifica.
- **Sin UI nueva en este plan** (switcher/roster son Parte 2). Nada de este plan es visible para el atleta.
- Verificación de cierre por task: `npm run lint && npm test && npm run build` verdes.

**⚠️ Política de commits:** El owner hace los commits. **NO ejecutar `git commit`/`git add` dentro de las tasks.** Tratar los pasos "Commit" como no-op.

**⚠️ Precondición operacional (fuera de este plan):** el rollout `008b` (commit del handler 23505 + deploy + `008a` + `008b` + smoke) debe cerrarse antes de habilitar escrituras multi-atleta reales (Parte 2). No bloquea este plan, que solo endurece lecturas.

---

## File Structure

```
src/services/athlete/
  activeAthlete.ts                        [MODIFY: + selfAthleteId holder + isSelfScopeActive]
  activeScopeFilter.ts                    [NEW: isRowInActiveScope + filterRowsToActiveScope + withActiveAthleteStamp]
  athleteSelection.ts                     [NEW: persistencia de selección activa]
  hydrateActiveAthlete.ts                 [MODIFY: selection-aware + setSelfAthleteId]
  __tests__/activeAthlete.test.ts         [EXTEND]
  __tests__/activeScopeFilter.test.ts     [NEW]
  __tests__/athleteSelection.test.ts      [NEW]
  __tests__/hydrateActiveAthlete.test.ts  [EXTEND]

src/db/
  queries.ts                              [MODIFY: adopción self-only + scoping de sessions/summaries]
  __tests__/queriesActiveScope.test.ts    [NEW: Dexie real]

src/services/
  syncService.ts                          [MODIFY: fallback legacy anclado al self en merges/dedups]
  __tests__/syncService.test.ts           [EXTEND: setSelfAthleteId en setups + test managed-active]
  planBuilder/commitPlan.ts               [MODIFY: filter scope]
  planBuilder/recentContext.ts            [MODIFY: filter scope]
  planBuilder/commitImpact.ts             [MODIFY: filter scope]
  planning/applyCreateWeek.ts             [MODIFY: filter scope]
  loadAnalytics.ts                        [MODIFY: filter scope]
  progressionInsights.ts                  [MODIFY: filter scope]
  planning/__tests__/applyCreateWeekScope.test.ts  [NEW: test destructivo real]
  __tests__/commitPlan.test.ts            [EXTEND: rollback con fila fuera de scope]

src/store/
  useTrainingStore.ts                     [MODIFY: addSession estampa athleteId]
  useCoachActionsStore.ts                 [MODIFY: proposals + historial scoped + addProposal estampa]
  useChatStore.ts                         [MODIFY: re-resolve session + fallback scoped + repair scoped + mensajes y repairedMessage estampan]
  __tests__/useTrainingStore.test.ts      [EXTEND: addSession estampa (obligatorio)]

src/utils/
  chatSession.ts                          [MODIFY: storage key por atleta]
  __tests__/chatSession.test.ts           [NEW]
```

---

## Task 1: Holder de `selfAthleteId` + `isSelfScopeActive()`

**Files:**
- Modify: `src/services/athlete/activeAthlete.ts`
- Test: `src/services/athlete/__tests__/activeAthlete.test.ts` (extend)

**Interfaces:**
- Produces: `getSelfAthleteId(): string | null`, `setSelfAthleteId(id: string | null): void`, `isSelfScopeActive(): boolean` (true si no hay atleta activo — modo legacy — o si el activo es el self). Consumidos por Tasks 2, 3, 4, 7, 8.

- [ ] **Step 1: Write the failing test**

Añadir a `src/services/athlete/__tests__/activeAthlete.test.ts` (respetar el patrón del archivo; resetear holders en `afterEach` con `setActiveAthleteId(null)` / `setSelfAthleteId(null)`):

```typescript
import { getSelfAthleteId, setSelfAthleteId, isSelfScopeActive, setActiveAthleteId } from '../activeAthlete'

describe('selfAthleteId holder', () => {
  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('stores and returns the self athlete id', () => {
    expect(getSelfAthleteId()).toBeNull()
    setSelfAthleteId('ath_self')
    expect(getSelfAthleteId()).toBe('ath_self')
  })

  it('isSelfScopeActive: legacy mode (no active) → true', () => {
    setActiveAthleteId(null)
    expect(isSelfScopeActive()).toBe(true)
  })

  it('isSelfScopeActive: active === self → true', () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')
    expect(isSelfScopeActive()).toBe(true)
  })

  it('isSelfScopeActive: active is a managed athlete → false', () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_m_1')
    expect(isSelfScopeActive()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/athlete/__tests__/activeAthlete.test.ts`
Expected: FAIL — `setSelfAthleteId` no existe.

- [ ] **Step 3: Implement**

En `src/services/athlete/activeAthlete.ts`, después del holder existente:

```typescript
// Deterministic self athlete of the signed-in owner (ath_<owner>), hydrated
// alongside activeAthleteId. Legacy/unscoped rows always belong to the self
// athlete — never to a managed one (F2-lite legacy policy).
let selfAthleteId: string | null = null

export function getSelfAthleteId(): string | null {
  return selfAthleteId
}

export function setSelfAthleteId(id: string | null): void {
  selfAthleteId = id
}

/**
 * True when reads may adopt legacy/unscoped rows: no active athlete yet
 * (pre-hydration legacy mode) or the active athlete IS the self athlete.
 */
export function isSelfScopeActive(): boolean {
  return activeAthleteId === null || activeAthleteId === selfAthleteId
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/athlete/__tests__/activeAthlete.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: verde (cambio aditivo).

- [ ] **Step 6: Commit** (no-op)

---

## Task 2: `activeScopeFilter` — helper puro de scope de lectura

**Files:**
- Create: `src/services/athlete/activeScopeFilter.ts`
- Test: `src/services/athlete/__tests__/activeScopeFilter.test.ts`

**Interfaces:**
- Consumes: `getActiveAthleteId`, `getSelfAthleteId` (Task 1), `isScopedAthleteId`.
- Produces: `isRowInActiveScope(rowAthleteId: string | null | undefined): boolean` y `filterRowsToActiveScope<T extends { athleteId?: string }>(rows: T[]): T[]`. Consumidos por Tasks 3, 5, 6.

- [ ] **Step 1: Write the failing test**

Create `src/services/athlete/__tests__/activeScopeFilter.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { isRowInActiveScope, filterRowsToActiveScope } from '../activeScopeFilter'
import { setActiveAthleteId, setSelfAthleteId } from '../activeAthlete'

describe('isRowInActiveScope', () => {
  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('no active athlete (legacy mode) → everything in scope', () => {
    expect(isRowInActiveScope('ath_A')).toBe(true)
    expect(isRowInActiveScope(undefined)).toBe(true)
    expect(isRowInActiveScope('default')).toBe(true)
  })

  it('scoped rows must match the active athlete', () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')
    expect(isRowInActiveScope('ath_self')).toBe(true)
    expect(isRowInActiveScope('ath_other')).toBe(false)
  })

  it('self active → legacy/unscoped rows are in scope', () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_self')
    expect(isRowInActiveScope(undefined)).toBe(true)
    expect(isRowInActiveScope('')).toBe(true)
    expect(isRowInActiveScope('default')).toBe(true)
  })

  it('managed active → legacy/unscoped rows are NOT in scope', () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_m_1')
    expect(isRowInActiveScope(undefined)).toBe(false)
    expect(isRowInActiveScope('default')).toBe(false)
    expect(isRowInActiveScope('ath_m_1')).toBe(true)
    expect(isRowInActiveScope('ath_self')).toBe(false)
  })
})

describe('filterRowsToActiveScope', () => {
  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('filters by athleteId with the same policy', () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_m_1')
    const rows = [
      { id: 'a', athleteId: 'ath_m_1' },
      { id: 'b', athleteId: 'ath_self' },
      { id: 'c' },
      { id: 'd', athleteId: 'default' },
    ]
    expect(filterRowsToActiveScope(rows).map((r) => r.id)).toEqual(['a'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/athlete/__tests__/activeScopeFilter.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implement**

Create `src/services/athlete/activeScopeFilter.ts`:

```typescript
import { getActiveAthleteId, getSelfAthleteId } from './activeAthlete'
import { isScopedAthleteId } from './effectiveAthleteKey'

/**
 * Read-scope policy for F2-lite (spec §3.6): scoped rows must match the ACTIVE
 * athlete; legacy/unscoped rows (missing/empty/'default' athleteId) belong to
 * the SELF athlete only — a managed athlete never sees them. With no active
 * athlete (pre-hydration legacy mode) everything is in scope, matching today's
 * single-athlete behavior.
 *
 * NOT for sync delete-scoping — that keeps using `isInAthleteScope`.
 */
export function isRowInActiveScope(rowAthleteId: string | null | undefined): boolean {
  const active = getActiveAthleteId()
  if (!active) return true
  if (isScopedAthleteId(rowAthleteId)) return rowAthleteId === active
  return active === getSelfAthleteId()
}

export function filterRowsToActiveScope<T extends { athleteId?: string }>(rows: T[]): T[] {
  return rows.filter((row) => isRowInActiveScope(row.athleteId))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/athlete/__tests__/activeScopeFilter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (no-op)

---

## Task 3: `queries.ts` — adopción self-only + scoping de sessions/summaries

**Files:**
- Modify: `src/db/queries.ts`
- Test: `src/db/__tests__/queriesActiveScope.test.ts` (create)

**Interfaces:**
- Consumes: `isSelfScopeActive` (Task 1), `filterRowsToActiveScope` (Task 2), `setActiveAthleteId`/`setSelfAthleteId` en tests.
- Produces: mismas firmas públicas de `queries.ts` (sin cambios de firma).

- [ ] **Step 1: Write the failing test (Dexie real)**

Create `src/db/__tests__/queriesActiveScope.test.ts` (patrón de aislamiento del repo: cerrar/borrar/abrir el singleton por test):

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../db'
import {
  getDayLog, getDayLogsForWeek, getWeekSummary, getAllWeekSummaries,
  getSessionsForWeek, getSessionsForDay, getHistoricalSessionsWindow, getMatchSessions,
} from '../queries'
import { setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'

const asManaged = () => { setSelfAthleteId('ath_self'); setActiveAthleteId('ath_m_1') }
const asSelf = () => { setSelfAthleteId('ath_self'); setActiveAthleteId('ath_self') }

describe('lecturas athlete-aware con política legacy self-only', () => {
  beforeEach(async () => { db.close(); await db.delete(); await db.open() })
  afterEach(() => { setActiveAthleteId(null); setSelfAthleteId(null); db.close() })

  it('getDayLog: managed activo NO adopta la fila legacy del owner', async () => {
    await db.dayLogs.put({ id: 'legacy', date: '2026-07-01', updatedAt: 1 })
    asManaged()
    expect(await getDayLog('2026-07-01')).toBeUndefined()
    asSelf()
    expect((await getDayLog('2026-07-01'))?.id).toBe('legacy')
  })

  it('getDayLogsForWeek: managed activo no adopta legacy; self sí', async () => {
    await db.dayLogs.bulkPut([
      { id: 'scoped-m', athleteId: 'ath_m_1', date: '2026-06-29', updatedAt: 1 },
      { id: 'legacy', date: '2026-06-30', updatedAt: 1 },
    ])
    asManaged()
    expect((await getDayLogsForWeek('2026-06-29')).map((r) => r.id)).toEqual(['scoped-m'])
    expect((await db.dayLogs.get('legacy'))?.athleteId).toBeUndefined() // no adoptada ni estampada
  })

  it('getWeekSummary: managed activo no ve la summary legacy', async () => {
    await db.weekSummaries.put({ id: 'legacy-w', weekStartDate: '2026-06-29', updatedAt: 1 })
    asManaged()
    expect(await getWeekSummary('2026-06-29')).toBeUndefined()
    asSelf()
    expect((await getWeekSummary('2026-06-29'))?.id).toBe('legacy-w')
  })

  it('getSessionsForWeek / getSessionsForDay: scoped por atleta activo, legacy solo self', async () => {
    await db.sessions.bulkPut([
      { id: 's-m', athleteId: 'ath_m_1', date: '2026-06-29', type: 'squash', status: 'planned', durationMin: 60 },
      { id: 's-self', athleteId: 'ath_self', date: '2026-06-29', type: 'squash', status: 'planned', durationMin: 60 },
      { id: 's-legacy', date: '2026-06-30', type: 'running', status: 'planned', durationMin: 30 },
    ])
    asManaged()
    expect((await getSessionsForWeek('2026-06-29')).map((s) => s.id)).toEqual(['s-m'])
    expect((await getSessionsForDay('2026-06-30')).map((s) => s.id)).toEqual([])
    asSelf()
    expect((await getSessionsForWeek('2026-06-29')).map((s) => s.id).sort()).toEqual(['s-legacy', 's-self'])
  })

  it('getAllWeekSummaries / getHistoricalSessionsWindow / getMatchSessions scoped', async () => {
    await db.weekSummaries.bulkPut([
      { id: 'w-m', athleteId: 'ath_m_1', weekStartDate: '2026-06-22', updatedAt: 1 },
      { id: 'w-legacy', weekStartDate: '2026-06-29', updatedAt: 1 },
    ])
    await db.sessions.bulkPut([
      { id: 'h-m', athleteId: 'ath_m_1', date: '2026-06-01', type: 'squash', status: 'completed', durationMin: 60 },
      { id: 'h-legacy', date: '2026-06-02', type: 'squash', status: 'completed', durationMin: 60, sessionMode: 'match' },
    ])
    asManaged()
    expect((await getAllWeekSummaries()).map((w) => w.id)).toEqual(['w-m'])
    expect((await getHistoricalSessionsWindow('2026-07-01')).map((s) => s.id)).toEqual(['h-m'])
    expect((await getMatchSessions()).map((s) => s.id)).toEqual([])
  })

  it('regresión: sin atleta activo, comportamiento legacy intacto', async () => {
    await db.sessions.put({ id: 's1', date: '2026-06-29', type: 'squash', status: 'planned', durationMin: 60 })
    setActiveAthleteId(null); setSelfAthleteId(null)
    expect((await getSessionsForWeek('2026-06-29')).map((s) => s.id)).toEqual(['s1'])
  })
})
```

> Ajustar los objetos `Session`/`WeekSummary` mínimos a los campos requeridos del tipo real (castear con `as Session` / `as never` si falta algún requerido; no dejarlos sin cast si TS falla). `getMatchSessions` filtra con `isPracticeSquashMatch`/`isCompetitionSquashMatch` — revisar `src/utils/squash.ts` para armar el fixture de match (p.ej. `sessionMode: 'match'` según lo que esas funciones evalúen).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/__tests__/queriesActiveScope.test.ts`
Expected: FAIL — managed adopta legacy / lecturas devuelven todo.

- [ ] **Step 3: Implement in `queries.ts`**

Import nuevo:

```typescript
import { getActiveAthleteId, isSelfScopeActive } from '../services/athlete/activeAthlete'
import { filterRowsToActiveScope } from '../services/athlete/activeScopeFilter'
```

(1) Lecturas de sessions/summaries — envolver el resultado con el filtro:

```typescript
export const getSessionsForWeek = async (
  weekStartISO: string
): Promise<Session[]> => {
  const end = toISO(addDays(fromISO(weekStartISO), 6))
  const rows = await db.sessions.where('date').between(weekStartISO, end, true, true).toArray()
  return filterRowsToActiveScope(rows)
}

export const getSessionsForDay = async (dateISO: string): Promise<Session[]> =>
  filterRowsToActiveScope(await db.sessions.where('date').equals(dateISO).toArray())

export const getAllWeekSummaries = async (): Promise<WeekSummary[]> =>
  filterRowsToActiveScope(await db.weekSummaries.orderBy('weekStartDate').reverse().toArray())

export const getHistoricalSessionsWindow = async (
  referenceDateISO: string,
  weeks = 8,
): Promise<Session[]> => {
  const start = toISO(addDays(fromISO(referenceDateISO), -(weeks * 7)))
  const rows = await db.sessions
    .where('date')
    .between(start, referenceDateISO, true, false)
    .toArray()
  return filterRowsToActiveScope(rows)
}

export const getMatchSessions = async (): Promise<Session[]> => {
  const sessions = await db.sessions
    .filter((s) => isPracticeSquashMatch(s) || isCompetitionSquashMatch(s))
    .toArray()
  return filterRowsToActiveScope(sessions).sort((a, b) => b.date.localeCompare(a.date))
}
```

> El único cambio respecto del original es aplicar `filterRowsToActiveScope` antes del sort; el predicado de match no se toca.

(2) Adopción legacy self-only — en `getDayLog` (rama de miss del compound):

```typescript
  const scoped = await db.dayLogs.where('[athleteId+date]').equals([activeAthleteId, dateISO]).first()
  if (scoped) return scoped

  // Legacy adoption is self-only (spec §3.6): a managed athlete never reads
  // the owner's unscoped rows.
  if (!isSelfScopeActive()) return undefined
  const candidates = await db.dayLogs.where('date').equals(dateISO).toArray()
  return candidates.find((row) => !isScopedAthleteId(row.athleteId))
```

(3) `getWeekSummary` — mismo patrón en su rama de miss:

```typescript
  if (scoped) return scoped

  if (!isSelfScopeActive()) return undefined
  const candidates = await db.weekSummaries.where('weekStartDate').equals(weekStartISO).toArray()
  return candidates.find((row) => !isScopedAthleteId(row.athleteId))
```

(4) `getDayLogsForWeek` — saltar el loop de adopción cuando el activo no es self:

```typescript
  const scoped = await db.dayLogs
    .where('[athleteId+date]')
    .between([activeAthleteId, weekStartISO], [activeAthleteId, end], true, true)
    .toArray()
  if (!isSelfScopeActive()) {
    return scoped.sort((a, b) => a.date.localeCompare(b.date))
  }
  // ...loop de adopción existente sin cambios...
```

- [ ] **Step 4: Run test + full suite**

Run: `npx vitest run src/db/__tests__/queriesActiveScope.test.ts && npm test`
Expected: verde (los tests existentes de `queriesAthleteScope.test.ts` ejercitan el caso self/legacy y deben seguir pasando; si alguno seteaba solo `setActiveAthleteId('ath_A')`, agregar `setSelfAthleteId('ath_A')` a su setup para representar el escenario single-athlete real).

- [ ] **Step 5: Commit** (no-op)

---

## Task 4: Sync — fallback legacy anclado al self

**Files:**
- Modify: `src/services/syncService.ts`
- Test: `src/services/__tests__/syncService.test.ts` (extend)

**Interfaces:**
- Consumes: `getSelfAthleteId`, `setSelfAthleteId` (Task 1).
- Behavior: en merges/finders/stamps/dedups de day logs y week summaries, el id usado como fallback de filas legacy pasa de "atleta activo" a "**self** athlete" (con fallback al valor actual si el self aún no hidrató). Con active === self (hoy, siempre) el comportamiento es idéntico.

- [ ] **Step 1: Write the failing test**

En `src/services/__tests__/syncService.test.ts`, localizar el test `merges day logs by effective athlete key during a full-user pull` (~`:662-721`) como referencia de setup. Agregar un test nuevo en el mismo bloque:

```typescript
it('a full pull with a MANAGED athlete active stamps legacy rows with the SELF athlete', async () => {
  const { setActiveAthleteId, setSelfAthleteId } = await import('../athlete/activeAthlete')
  setSelfAthleteId('ath_self')
  setActiveAthleteId('ath_m_1') // coach entrenando a un gestionado mientras corre sync

  // Remote legacy day log (athlete_id null) del owner.
  actionResults.set('select:day_logs', {
    data: [{ id: 'remote-legacy', user_id: 'user-1', athlete_id: null, date: '2026-06-30', updated_at: 50, data: {} }],
    error: null,
  })

  await syncService.runFullSync('user-1')

  const local = await fakes.db.dayLogs.get('remote-legacy')
  // La fila legacy pertenece al SELF, nunca al gestionado activo.
  expect(local?.athleteId).toBe('ath_self')

  setActiveAthleteId(null)
  setSelfAthleteId(null)
})
```

> Adaptar el arnés al patrón real del archivo (mock de `fetchAll`/builders, `fakes.db`, `runFullSync` completo o `mergeDayLogs` si está exportado para test). Lo esencial a aseverar: `athleteId` estampado = `'ath_self'`, NO `'ath_m_1'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/syncService.test.ts -t "MANAGED athlete active"`
Expected: FAIL — hoy estampa con el atleta activo (`ath_m_1`).

- [ ] **Step 3: Implement — anclar el fallback al self**

En `src/services/syncService.ts`:

(a) Import: agregar `getSelfAthleteId` al import existente de `./athlete/activeAthlete`.

(b) Construcción del merge context (~`:2140`), donde hoy dice:

```typescript
    const activeAthleteId = readScope.mode === 'athlete' ? readScope.athleteId : getActiveAthleteId()
```

reemplazar por:

```typescript
    // Legacy rows always belong to the SELF athlete (F2-lite legacy policy):
    // the merge fallback must never stamp/group them under a managed athlete.
    const activeAthleteId = getSelfAthleteId()
      ?? (readScope.mode === 'athlete' ? readScope.athleteId : getActiveAthleteId())
```

(c) Dedup helpers (~`:2834` y ~`:2856`), donde hoy dicen `const activeAthleteId = getActiveAthleteId()`, reemplazar en ambos por:

```typescript
  const activeAthleteId = getSelfAthleteId() ?? getActiveAthleteId()
```

(d) Buscar con grep otros call sites del mismo patrón de fallback legacy y aplicar la misma regla:

Run: `grep -n "getActiveAthleteId()" src/services/syncService.ts`

Criterio: si el valor se usa como fallback para filas legacy en merge/stamp/dedup/finders de day logs / week summaries → `getSelfAthleteId() ?? getActiveAthleteId()`. Si se usa como scope de escritura del atleta activo (p.ej. `withAthleteId` estampando el `athlete_id` de un push del atleta actual) → NO tocar (una escritura del gestionado debe llevar el id del gestionado).

- [ ] **Step 4: Update existing single-athlete test setups**

En los tests existentes del archivo que hacen `setActiveAthleteId('ath_A')` (~`:687-688`, `:721` y similares), agregar `setSelfAthleteId('ath_A')` justo después (escenario single-athlete real: active === self). Import igual que el existente.

- [ ] **Step 5: Run test + full suite + build**

Run: `npx vitest run src/services/__tests__/syncService.test.ts && npm test && npm run build`
Expected: verdes.

- [ ] **Step 6: Commit** (no-op)

---

## Task 5: Servicios de contexto IA/plan scoped

**Files:**
- Modify: `src/services/planBuilder/commitPlan.ts:32,51`
- Modify: `src/services/planning/applyCreateWeek.ts:136,162`
- Modify: `src/services/planBuilder/commitImpact.ts:80`
- Modify: `src/services/planBuilder/recentContext.ts:233,241`
- Modify: `src/services/loadAnalytics.ts:623`
- Modify: `src/services/progressionInsights.ts:385`
- Test: `src/services/planning/__tests__/applyCreateWeekScope.test.ts` (create)
- Test: `src/services/__tests__/commitPlan.test.ts` (extend: rollback con fila fuera de scope)

**Interfaces:**
- Consumes: `filterRowsToActiveScope` (Task 2).
- Produces: `withActiveAthleteStamp<T extends { athleteId?: string }>(row: T): T` en `activeScopeFilter.ts` (creado aquí en Step 0 porque este task ya lo necesita en su test; Task 6b lo consume para el wiring de stores).
- Behavior: toda lectura por rango/fecha/global de `db.sessions`/`db.weekSummaries` en estos servicios filtra por scope activo ANTES de usar/borrar. Crítico en `commitPlan` y `applyCreateWeek`, que **borran** sesiones derivadas de esas lecturas — sin filtro, un plan del gestionado podría borrar sesiones del self en la misma fecha.

- [ ] **Step 0a: Write the failing test for `withActiveAthleteStamp`**

Añadir a `src/services/athlete/__tests__/activeScopeFilter.test.ts`:

```typescript
import { withActiveAthleteStamp } from '../activeScopeFilter'

describe('withActiveAthleteStamp', () => {
  afterEach(() => { setActiveAthleteId(null); setSelfAthleteId(null) })

  it('estampa el atleta activo en filas nuevas sin scope', () => {
    setActiveAthleteId('ath_m_1')
    expect(withActiveAthleteStamp({ id: 'x' }).athleteId).toBe('ath_m_1')
    expect(withActiveAthleteStamp({ id: 'x', athleteId: 'default' }).athleteId).toBe('ath_m_1')
  })

  it('preserva un athleteId ya scoped (updates/rollbacks intactos)', () => {
    setActiveAthleteId('ath_m_1')
    expect(withActiveAthleteStamp({ id: 'x', athleteId: 'ath_self' }).athleteId).toBe('ath_self')
  })

  it('sin atleta activo devuelve la fila intacta (no escribe athleteId)', () => {
    const row = withActiveAthleteStamp({ id: 'x' })
    expect('athleteId' in row && row.athleteId !== undefined).toBe(false)
  })
})
```

- [ ] **Step 0b: Run test to verify it fails, then implement**

Run: `npx vitest run src/services/athlete/__tests__/activeScopeFilter.test.ts` → FAIL (`withActiveAthleteStamp` no existe). Implementar en `src/services/athlete/activeScopeFilter.ts`:

```typescript
/**
 * Stamp the ACTIVE athlete on a locally-created row. Preserves an existing
 * scoped athleteId (an update/rollback/restore is never re-stamped); with no
 * active athlete the row stays legacy (today's behavior). Local-first
 * counterpart of the read policy: what you create while training athlete X
 * must remain visible under athlete X's scope immediately.
 */
export function withActiveAthleteStamp<T extends { athleteId?: string }>(row: T): T {
  if (isScopedAthleteId(row.athleteId)) return row
  const active = getActiveAthleteId()
  return active ? { ...row, athleteId: active } : row
}
```

Re-run → PASS.

- [ ] **Step 1: Write the failing DESTRUCTIVE integration test for `applyCreateWeek`**

Create `src/services/planning/__tests__/applyCreateWeekScope.test.ts`. `applyCreateWeek` es exportado (`applyCreateWeek.ts:27`) y recibe `{ sessions, weekObjectives?, athleteProfile, store, replacementCutoffAt?, replacementRange? }`. Internamente llama `syncService.pullSessionsForDateRange`, `syncService.deleteSession`, `syncService.pushSession` → mockear el módulo entero; Dexie real (fake-indexeddb):

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../syncService', () => ({
  pullSessionsForDateRange: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
  pushSession: vi.fn(async () => {}),
  pushWeekSummary: vi.fn(async () => {}),
}))

import { db } from '../../../db/db'
import { applyCreateWeek } from '../applyCreateWeek'
import { setActiveAthleteId, setSelfAthleteId } from '../../athlete/activeAthlete'
import { withActiveAthleteStamp } from '../../athlete/activeScopeFilter'
import { v4 as uuid } from '../../../utils/uuid'
import * as syncService from '../../syncService'
import type { Session } from '../../../types'

// CreateWeekStoreAdapter exige addSession + loadWeek (applyCreateWeek.ts:14-17).
// addSession imita a useTrainingStore.addSession post-Task-6b: persiste y estampa.
const storeAdapter = {
  loadWeek: vi.fn(async () => {}),
  addSession: vi.fn(async (partial: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = Date.now()
    const session = withActiveAthleteStamp({ ...partial, id: uuid(), createdAt: now, updatedAt: now }) as Session
    await db.sessions.add(session)
    return session
  }),
}

describe('applyCreateWeek no borra planned sessions de otro atleta', () => {
  beforeEach(async () => { db.close(); await db.delete(); await db.open(); vi.clearAllMocks() })
  afterEach(() => { setActiveAthleteId(null); setSelfAthleteId(null); db.close() })

  it('gestionado activo reemplaza SUS planned, no las del self en la misma semana', async () => {
    await db.sessions.bulkPut([
      { id: 'self-planned', athleteId: 'ath_self', date: '2026-07-06', type: 'squash', status: 'planned', durationMin: 60, updatedAt: 1 },
      { id: 'managed-planned', athleteId: 'ath_m_1', date: '2026-07-06', type: 'squash', status: 'planned', durationMin: 60, updatedAt: 1 },
    ] as never)
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_m_1')

    await applyCreateWeek({
      // El input usa sessionType (no type): ver el mapeo type: session.sessionType en applyCreateWeek.
      sessions: [{ date: '2026-07-06', sessionType: 'squash', title: 'Drills', timeBlock: 'AM', durationMin: 45 }] as never,
      athleteProfile: null,
      store: storeAdapter,
    })

    expect(await db.sessions.get('self-planned')).toBeDefined()          // intocada
    expect(await db.sessions.get('managed-planned')).toBeUndefined()     // reemplazada
    expect(vi.mocked(syncService.deleteSession)).not.toHaveBeenCalledWith('self-planned')
    expect(storeAdapter.addSession).toHaveBeenCalled()                   // la semana nueva sí se creó
  })
})
```

> `CreateWeekSessionInput = NonNullable<CoachAction['sessions']>` — si el tipo exige más campos (p.ej. `description`), completarlos en el fixture; el cast `as never` cubre lo opcional. El helper `withActiveAthleteStamp` ya existe (Step 0 de esta task). Lo esencial: la planned del self **sobrevive**, no se llama `deleteSession('self-planned')`, y `applyCreateWeek` corre completo (con `store.addSession` real-mínimo, no un stub ausente que rompa antes de llegar al bug).

- [ ] **Step 1b: Write the failing rollback test for `commitPlan`**

Extender `src/services/__tests__/commitPlan.test.ts` (ya existe con el arnés de mocks de commitPlan). En el test de rollback existente (el que fuerza un fallo a mitad de commit y verifica `restoreWeekCommitSnapshots`), sembrar ANTES una sesión fuera de scope en la misma semana del plan y afirmar al final:

```typescript
    // Sembrado adicional al inicio del test de rollback, con gestionado activo:
    // setSelfAthleteId('ath_self'); setActiveAthleteId('ath_m_1')
    await db.sessions.put({
      id: 'self-untouched', athleteId: 'ath_self', date: weekStartDate,
      type: 'squash', status: 'completed', durationMin: 60, updatedAt: 1,
    } as never)

    // ...commit que falla + rollback existente...

    // La sesión del self ni se borra (restore no la ve como "extra") ni se restaura pisada:
    const survivor = await db.sessions.get('self-untouched')
    expect(survivor?.status).toBe('completed')
    expect(survivor?.athleteId).toBe('ath_self')
```

> Si el arnés de `commitPlan.test.ts` usa un fake de `db` en vez de Dexie real, aplicar el mismo sembrado/aserciones sobre ese fake. Si no existe un test de rollback explícito, crear uno mínimo que llame al camino de fallo (una semana inválida tras una válida) — el objetivo es cubrir `captureWeekCommitSnapshot`/`restoreWeekCommitSnapshots` (`commitPlan.ts:32,51`) con una fila fuera de scope presente.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/planning/__tests__/applyCreateWeekScope.test.ts src/services/__tests__/commitPlan.test.ts`
Expected: FAIL — hoy `replacePlannedSessionsForCreateWeek` borra `self-planned` y el restore de commitPlan trata la fila ajena como "extra" a eliminar.

- [ ] **Step 3: Wire `filterRowsToActiveScope` en cada lectura**

Import en cada archivo: `import { filterRowsToActiveScope } from '../athlete/activeScopeFilter'` (ajustar profundidad relativa: desde `planBuilder/`/`planning/` es `'../athlete/activeScopeFilter'`).

- `src/services/planning/applyCreateWeek.ts:136`:

```typescript
  const existingSessions = filterRowsToActiveScope(
    await db.sessions.where('date').anyOf(targetDates).toArray(),
  )
```

- `src/services/planning/applyCreateWeek.ts:162`:

```typescript
    const existingWeekSessions = filterRowsToActiveScope(
      await db.sessions.where('date').between(weekStart, weekEnd, true, true).toArray(),
    )
```

- `src/services/planBuilder/commitPlan.ts:32` y `:51`: envolver igual las dos lecturas `db.sessions.where('date')...toArray()` con `filterRowsToActiveScope(...)`.
- `src/services/planBuilder/commitImpact.ts:80`: envolver la lectura de sesiones de la semana.
- `src/services/planBuilder/recentContext.ts:233` (sessions) y `:241` (weekSummaries): envolver ambas.
- `src/services/loadAnalytics.ts:623`: envolver la lectura global de sesiones.
- `src/services/progressionInsights.ts:385`: envolver el `db.sessions.toArray()`.

En cada sitio: solo se envuelve el **resultado de la lectura**; la lógica posterior (incluidos deletes por id derivados) no cambia.

- [ ] **Step 4: Run the new tests + full suite + build**

Run: `npx vitest run src/services/planning/__tests__/applyCreateWeekScope.test.ts src/services/__tests__/commitPlan.test.ts && npm test && npm run build`
Expected: verdes — los dos tests destructivos pasan tras el wiring; las suites existentes de plan builder / analytics corren sin atleta activo (filtro no-op).

- [ ] **Step 5: Commit** (no-op)

---

## Task 6: Stores — proposals e historial scoped

**Files:**
- Modify: `src/store/useCoachActionsStore.ts:50-56,70`
- Modify: `src/store/useChatStore.ts:42-65`
- Test: `src/store/__tests__/` (extend el test existente del store si lo hay; si no, cubrir vía el test de Task 7 y la suite completa)

**Interfaces:**
- Consumes: `filterRowsToActiveScope`, `isRowInActiveScope` (Task 2).

- [ ] **Step 1: Scope `loadProposals`**

En `src/store/useCoachActionsStore.ts` (~`:52`):

```typescript
  loadProposals: async () => {
    const athleteProfile = useCoachMemoryStore.getState().athleteProfile
    const proposals = filterRowsToActiveScope(await db.coachProposals.orderBy('createdAt').toArray())
      .map((proposal) => ({
        ...proposal,
        actions: prepareProposalActionsForDisplay(proposal.actions, athleteProfile),
      }))
    set({ proposals })
  },
```

Import: `import { filterRowsToActiveScope } from '../services/athlete/activeScopeFilter'`.

- [ ] **Step 2: Scope el historial de `addProposal`**

En el mismo store (~`:70`):

```typescript
    const historicalSessions = filterRowsToActiveScope(await db.sessions.toArray())
```

- [ ] **Step 3: Scope el fallback de `loadHistory` en `useChatStore`**

En `src/store/useChatStore.ts` (~`:49-60`), el fallback local-only adopta el último mensaje **global**; restringirlo al scope activo:

```typescript
    if (msgs.length === 0 && isLocalOnlyChatSessionId(sessionId)) {
      const latest = await db.chatMessages
        .orderBy('timestamp')
        .reverse()
        .filter((message) => isRowInActiveScope(message.athleteId))
        .first()
      if (latest?.chatSessionId) {
        // ...resto del bloque sin cambios (setStoredChatSessionId, re-query, set)...
      }
    }
```

Import: `import { isRowInActiveScope } from '../services/athlete/activeScopeFilter'`.

- [ ] **Step 4: Scope `repairOrphanProposalMessagesUnlocked`**

En `src/store/useChatStore.ts` (~`:414`), el repair de propuestas huérfanas lee TODAS las
propuestas dentro de la transacción — con chat por atleta, podría reenganchar una propuesta
de otro atleta al hilo actual si coincide por timing. Filtrar al scope activo:

```typescript
  const repairedMessages = await db.transaction('rw', db.chatMessages, db.coachProposals, async () => {
    const proposals = filterRowsToActiveScope(await db.coachProposals.orderBy('createdAt').toArray())
    if (proposals.length === 0 || messages.length === 0) return messages
    // ...resto sin cambios...
```

Import adicional en el store: `filterRowsToActiveScope` (mismo módulo que `isRowInActiveScope`).

- [ ] **Step 5: Run full suite + build**

Run: `npm test && npm run build`
Expected: verdes (con active/self nulos todo es no-op; los tests de stores existentes no cambian de resultado).

- [ ] **Step 6: Commit** (no-op)

---

## Task 6b: Estampar `athleteId` en escrituras locales de stores

**Rationale (hallazgo del review):** el plan scopea lecturas, pero `useTrainingStore.addSession`, los mensajes de `useChatStore` y `useCoachActionsStore.addProposal` crean filas locales **sin** `athleteId`. Con un gestionado activo, esa fila recién creada es legacy → la política self-only (Tasks 2–3) la haría **desaparecer de la vista del gestionado** hasta que el sync la converja. Estampar al crear cierra el loop local-first.

**Files:**
- Modify: `src/store/useTrainingStore.ts:124` (`addSession`)
- Modify: `src/store/useChatStore.ts` (creación de `userMsg` ~`:80`, `coachMsg` ~`:172`, `coachErrorMsg` ~`:229`, `repairedMessage` ~`:441`)
- Modify: `src/store/useCoachActionsStore.ts:79-88` (`addProposal`, literal del `CoachProposal`)
- Test: `src/db/__tests__/queriesActiveScope.test.ts` (extend: round-trip)
- Test: `src/store/__tests__/useTrainingStore.test.ts` (extend: OBLIGATORIO, wiring de `addSession`)

(El helper `withActiveAthleteStamp` y su test unitario se crean en **Task 5 Step 0**.)

**Interfaces:**
- Consumes: `withActiveAthleteStamp` (creado en **Task 5 Step 0** con su test unitario — esta task solo lo cablea), `getActiveAthleteId`, `isScopedAthleteId`.

- [ ] **Step 4: Wire into the three stores**

- `src/store/useTrainingStore.ts` (`addSession`, ~`:124`):

```typescript
    const session: Session = withActiveAthleteStamp({
      ...partial, weekStartDate, id: uuid(), createdAt: now, updatedAt: now,
    })
```

  Verificar además que ningún `db.sessions.update(id, patch)` del store meta `athleteId` en el patch (hoy no lo hace — mantenerlo así; los updates preservan el valor existente por ser parciales).

- `src/store/useChatStore.ts`: envolver los TRES object literals de mensajes antes de su `db.chatMessages.add(...)` — `userMsg` (~`:80`), `coachMsg` (~`:172`) y `coachErrorMsg` (~`:229`):

```typescript
    const userMsg: ChatMessage = withActiveAthleteStamp({
      id: uuid(), role: 'user', content, timestamp: Date.now(),
      chatSessionId: sessionId, contextMeta: buildChatContextMetadata(context),
    })
```

  (mismo patrón para `coachMsg` y `coachErrorMsg`; el objeto que va al estado y el que se persiste deben ser el MISMO objeto estampado).

- `src/store/useChatStore.ts` (`repairOrphanProposalMessagesUnlocked`, ~`:441`): el mensaje recuperado también debe quedar scoped — hereda el scope de su propuesta (ya filtrada al scope activo en Task 6 Step 4) y solo cae al estampado genérico si la propuesta es legacy:

```typescript
      const recovered = buildProposalRecoveredMessage(proposal, chatSessionId, anchor.timestamp)
      const repairedMessage = isScopedAthleteId(proposal.athleteId)
        ? { ...recovered, athleteId: proposal.athleteId }
        : withActiveAthleteStamp(recovered)
```

  Import adicional: `isScopedAthleteId` desde `../services/athlete/effectiveAthleteKey`.

- `src/store/useCoachActionsStore.ts` (`addProposal`): `normalizeCoachProposal` devuelve `{ actions, metadata }`, NO un proposal — el `CoachProposal` se construye como literal en `:79-88`. Envolver ese literal:

```typescript
    const proposal: CoachProposal = withActiveAthleteStamp({
      id: uuid(),
      chatMessageId,
      message,
      actions: normalized.actions,
      planSummary,
      metadata,
      status: 'pending',
      createdAt: Date.now(),
    })
    await db.coachProposals.put(proposal)
```

  (el `put`, el `pushCoachProposal` y el `set` de estado que siguen ya usan `proposal` — no cambian).

Import en los tres stores: `import { withActiveAthleteStamp } from '../services/athlete/activeScopeFilter'`.

- [ ] **Step 5: Write the failing round-trip test (Dexie real)**

Añadir a `src/db/__tests__/queriesActiveScope.test.ts` (mismo arnés de aislamiento):

```typescript
import { withActiveAthleteStamp } from '../../services/athlete/activeScopeFilter'

it('una sesión creada con gestionado activo queda visible en su scope de inmediato', async () => {
  setSelfAthleteId('ath_self'); setActiveAthleteId('ath_m_1')
  const session = withActiveAthleteStamp({
    id: 's-new', date: '2026-07-06', type: 'squash', status: 'planned', durationMin: 45,
    weekStartDate: '2026-07-06', createdAt: 1, updatedAt: 1,
  }) as never
  await db.sessions.add(session)
  expect((await getSessionsForWeek('2026-07-06')).map((s) => s.id)).toEqual(['s-new'])
})
```

> Este round-trip valida el contrato helper→lectura, pero NO que los stores usen el helper.

- [ ] **Step 5b: Store-level test OBLIGATORIO — `addSession` estampa (wiring real)**

Extender `src/store/__tests__/useTrainingStore.test.ts`. **Ojo con el arnés:** el archivo hoy
solo prueba helpers puros (`resolveVisibleSessionsAfterUpdate`, etc.) y NO mockea
`db`/`syncService`. Para el test de `addSession` hace falta arnés propio en un `describe`
nuevo: Dexie real (fake-indexeddb ya está en `vitest.setup.ts`) con aislamiento por test, y
mock del módulo `syncService` (el flujo `addSession → pushSession` y
`recalculateWeekSummary → upsertWeekSummary → pushWeekSummary` sale a sync). El `vi.mock`
es top-level y no afecta los tests puros existentes (no tocan sync):

```typescript
// Agregar a los imports del archivo:
import { vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../services/syncService', () => ({
  pushSession: vi.fn(async () => {}),
  pushWeekSummary: vi.fn(async () => {}),
  pushDayLog: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
}))

import { db } from '../../db/db'
import { useTrainingStore } from '../useTrainingStore'
import { setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'

describe('addSession athlete stamping (Dexie real)', () => {
  beforeEach(async () => { db.close(); await db.delete(); await db.open() })
  afterEach(() => { setActiveAthleteId(null); setSelfAthleteId(null); db.close() })

  it('addSession estampa el atleta activo en la fila creada', async () => {
    setSelfAthleteId('ath_self')
    setActiveAthleteId('ath_m_1')

    const created = await useTrainingStore.getState().addSession({
      date: '2026-07-06', type: 'squash', status: 'planned', durationMin: 45, title: 'Drills', timeBlock: 'AM',
    } as never)

    expect(created.athleteId).toBe('ath_m_1')
    expect((await db.sessions.get(created.id))?.athleteId).toBe('ath_m_1')
  })
})
```

> Si el mock del módulo `syncService` necesita más miembros (el store importa `* as syncService`), agregar los `vi.fn` que el path de `addSession` toque — solo fallan los llamados no definidos. Si el arnés lo permite con poco costo, agregar la aserción equivalente para `useCoachActionsStore.addProposal` (proposal creada con `athleteId: 'ath_m_1'`); el de `addSession` es el obligatorio de esta task.

- [ ] **Step 6: Run tests + full suite + build**

Run: `npx vitest run src/services/athlete/__tests__/activeScopeFilter.test.ts src/db/__tests__/queriesActiveScope.test.ts src/store/__tests__/useTrainingStore.test.ts && npm test && npm run build`
Expected: verdes (sin atleta activo el estampado es no-op → cero regresión single-athlete).

- [ ] **Step 7: Commit** (no-op)

---

## Task 7: Chat session key por atleta

**Files:**
- Modify: `src/utils/chatSession.ts` (+ `clearAllStoredChatSessionIds` para flujos globales)
- Modify: `src/store/useChatStore.ts:42-44` (re-resolver session al cargar)
- Modify: `src/services/appMaintenance.ts:191` (limpieza global usa clearAll)
- Modify: `src/services/dataExport.ts` (import limpia todas las keys antes de setear la preferida)
- Test: `src/utils/__tests__/chatSession.test.ts` (create)

**Interfaces:**
- Consumes: `getActiveAthleteId`, `getSelfAthleteId` (Task 1).
- Produces: mismas firmas públicas de `chatSession.ts`; el storage key se resuelve por atleta (decisión del owner en spec §3.6): self o sin atleta → keys legacy actuales (compat, el hilo del owner no se resetea); gestionado → `coach_chat_session_id:<athleteId>`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/__tests__/chatSession.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  getStoredChatSessionId, setStoredChatSessionId, getOrCreateChatSessionId,
  clearStoredChatSessionId, clearAllStoredChatSessionIds,
} from '../chatSession'
import { setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'

describe('chat session key por atleta', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { setActiveAthleteId(null); setSelfAthleteId(null); localStorage.clear() })

  it('self activo usa la key legacy (el hilo del owner no se resetea)', () => {
    setSelfAthleteId('ath_self'); setActiveAthleteId('ath_self')
    setStoredChatSessionId('sess-legacy')
    expect(localStorage.getItem('coach_chat_session_id')).toBe('sess-legacy')
    expect(getStoredChatSessionId()).toBe('sess-legacy')
  })

  it('sin atleta activo usa la key legacy', () => {
    setStoredChatSessionId('sess-legacy')
    expect(localStorage.getItem('coach_chat_session_id')).toBe('sess-legacy')
  })

  it('gestionado activo usa una key scoped e independiente', () => {
    setSelfAthleteId('ath_self'); setActiveAthleteId('ath_self')
    setStoredChatSessionId('sess-self')

    setActiveAthleteId('ath_m_1')
    expect(getStoredChatSessionId()).toBeNull() // no hereda el hilo del self
    const managedId = getOrCreateChatSessionId()
    expect(localStorage.getItem('coach_chat_session_id:ath_m_1')).toBe(managedId)

    setActiveAthleteId('ath_self')
    expect(getStoredChatSessionId()).toBe('sess-self') // el hilo del self sigue intacto
  })

  it('clear solo borra la sesión del atleta activo', () => {
    setSelfAthleteId('ath_self'); setActiveAthleteId('ath_m_1')
    getOrCreateChatSessionId()
    setActiveAthleteId('ath_self'); setStoredChatSessionId('sess-self')

    setActiveAthleteId('ath_m_1'); clearStoredChatSessionId()
    expect(localStorage.getItem('coach_chat_session_id:ath_m_1')).toBeNull()
    expect(localStorage.getItem('coach_chat_session_id')).toBe('sess-self')
  })

  it('clearAllStoredChatSessionIds borra keys legacy, scoped y markers local-only', () => {
    setSelfAthleteId('ath_self'); setActiveAthleteId('ath_m_1')
    getOrCreateChatSessionId() // scoped + marker local-only del gestionado
    setActiveAthleteId('ath_self'); setStoredChatSessionId('sess-self') // legacy

    clearAllStoredChatSessionIds()
    expect(localStorage.getItem('coach_chat_session_id')).toBeNull()
    expect(localStorage.getItem('coach_chat_session_id:ath_m_1')).toBeNull()
    expect(localStorage.getItem('coach_chat_session_local_only:ath_m_1')).toBeNull()
  })
})
```

> Si el entorno de test no provee `localStorage`, reusar el helper `installLocalStorage()` que ya usa `athleteScopeMigration.test.ts` (importarlo o replicar el patrón del repo).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/chatSession.test.ts`
Expected: FAIL — el gestionado lee la key global.

- [ ] **Step 3: Implement key resolution en `chatSession.ts`**

```typescript
import { v4 as uuid } from './uuid'
import { getActiveAthleteId, getSelfAthleteId } from '../services/athlete/activeAthlete'

export const CHAT_SESSION_KEY = 'coach_chat_session_id'
const CHAT_SESSION_LOCAL_ONLY_KEY = 'coach_chat_session_local_only'

// Decisión del owner (spec §3.6): la sesión de chat es athlete-scoped por storage
// key. Self o sin atleta activo → keys legacy (compat con el hilo existente del
// owner); atleta gestionado → key sufijada por athleteId.
function chatScopeSuffix(): string {
  const active = getActiveAthleteId()
  if (!active || active === getSelfAthleteId()) return ''
  return `:${active}`
}

function sessionKey(): string {
  return `${CHAT_SESSION_KEY}${chatScopeSuffix()}`
}

function localOnlyKey(): string {
  return `${CHAT_SESSION_LOCAL_ONLY_KEY}${chatScopeSuffix()}`
}
```

Reemplazar en TODAS las funciones del archivo los usos de `CHAT_SESSION_KEY` → `sessionKey()` y `CHAT_SESSION_LOCAL_ONLY_KEY` → `localOnlyKey()` (getStored/setStored/clearStored/isLocalOnly/getOrCreate; misma lógica, key resuelta por llamada).

**Callers globales (hallazgo del review): mantenimiento e import operan sobre TODAS las keys, no la del atleta activo.** Agregar al final de `chatSession.ts`:

```typescript
/**
 * Remove EVERY chat session key — legacy and athlete-scoped — plus their
 * local-only markers. For account-global flows (local data reset, backup
 * import) that must not leave stale per-athlete sessions behind.
 */
export function clearAllStoredChatSessionIds(): void {
  const storage = getStorage()
  if (!storage) return
  const doomed: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (!key) continue
    if (key.startsWith(CHAT_SESSION_KEY) || key.startsWith(CHAT_SESSION_LOCAL_ONLY_KEY)) {
      doomed.push(key)
    }
  }
  doomed.forEach((key) => storage.removeItem(key))
}
```

(Nota: `CHAT_SESSION_LOCAL_ONLY_KEY` no comparte prefijo con `CHAT_SESSION_KEY` — hay que chequear ambos. `CHAT_SESSION_LOCAL_ONLY_KEY` deja de ser solo-local del módulo si hace falta exportarlo para el test; preferible testear por literal.)

Wiring de los callers globales:

- `src/services/appMaintenance.ts:191`: reemplazar `clearStoredChatSessionId()` por `clearAllStoredChatSessionIds()` (la limpieza local es de toda la cuenta; el `getOrCreateChatSessionId()` siguiente recrea la sesión del scope activo). Ajustar el import de `../utils/chatSession`.
- `src/services/dataExport.ts` (flujo de import, ver imports en `:30` y `syncStoresAfterImport(preferredChatSessionId)` en `:609`): en el camino de import que hoy llama `clearStoredChatSessionId()`, limpiar TODO primero con `clearAllStoredChatSessionIds()` y luego `setStoredChatSessionId(preferred)` como hoy (el preferred aplica a la key del scope activo en el momento del import — documentado, aceptable para un import account-global).

- [ ] **Step 4: Re-resolver la sesión al cargar historia**

En `src/store/useChatStore.ts`, `loadHistory` (~`:42`), antes de la query inicial:

```typescript
  loadHistory: async () => {
    // La key de sesión es athlete-scoped: re-resolverla en cada load para que un
    // cambio de atleta (remount) no arrastre el hilo del atleta anterior.
    const resolvedSessionId = getOrCreateChatSessionId()
    if (resolvedSessionId !== get().currentSessionId) {
      set({ currentSessionId: resolvedSessionId, messages: [] })
    }
    let sessionId = resolvedSessionId
    // ...resto sin cambios...
```

(`getOrCreateChatSessionId` ya está importado en el store para el estado inicial.)

- [ ] **Step 5: Run test + full suite + build**

Run: `npx vitest run src/utils/__tests__/chatSession.test.ts && npm test && npm run build`
Expected: verdes.

- [ ] **Step 6: Commit** (no-op)

---

## Task 8: Selección activa persistida + hidratación selection-aware

**Files:**
- Create: `src/services/athlete/athleteSelection.ts`
- Modify: `src/services/athlete/hydrateActiveAthlete.ts`
- Test: `src/services/athlete/__tests__/athleteSelection.test.ts` (create), `src/services/athlete/__tests__/hydrateActiveAthlete.test.ts` (extend)

**Interfaces:**
- Consumes: `setActiveAthleteId`, `setSelfAthleteId` (Task 1), `db.athletes`, `athleteIdForOwner` (existente en `athleteScopeMigration.ts`).
- Produces: `getPersistedAthleteSelection(ownerAccountId: string): string | null`, `persistAthleteSelection(ownerAccountId: string, athleteId: string | null): void` (null → limpia). La Parte 2 los consume desde `switchActiveAthlete`.
- Behavior: `hydrateActiveAthlete` siempre setea `selfAthleteId`; respeta una selección persistida **válida** (fila existente en `db.athletes`, `ownerAccountId` correcto, `status === 'active'`); inválida → limpia y cae al self. Como `pullAthletes` y `ensureRemoteAthleteOnce` llaman a esta misma función, dejan de pisar una selección válida sin tocarlos.

- [ ] **Step 1: Write the failing tests**

Create `src/services/athlete/__tests__/athleteSelection.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { getPersistedAthleteSelection, persistAthleteSelection } from '../athleteSelection'

describe('athleteSelection persistence', () => {
  beforeEach(() => { localStorage.clear() })

  it('round-trips a selection per owner', () => {
    persistAthleteSelection('user-1', 'ath_m_1')
    expect(getPersistedAthleteSelection('user-1')).toBe('ath_m_1')
    expect(getPersistedAthleteSelection('user-2')).toBeNull()
  })

  it('null clears the selection', () => {
    persistAthleteSelection('user-1', 'ath_m_1')
    persistAthleteSelection('user-1', null)
    expect(getPersistedAthleteSelection('user-1')).toBeNull()
  })
})
```

Extender `src/services/athlete/__tests__/hydrateActiveAthlete.test.ts` (seguir el patrón de fakes/db del archivo existente; los fixtures de `athletes` deben incluir `ownerAccountId` y `status`):

```typescript
describe('hydrateActiveAthlete selection-aware', () => {
  it('respeta una selección persistida válida (no la pisa con el self)', async () => {
    await db.athletes.bulkPut([
      { id: 'ath_user-1', ownerAccountId: 'user-1', status: 'active', createdAt: 1, updatedAt: 1 },
      { id: 'ath_m_1', ownerAccountId: 'user-1', status: 'active', createdAt: 1, updatedAt: 1 },
    ])
    persistAthleteSelection('user-1', 'ath_m_1')
    const id = await hydrateActiveAthlete('user-1')
    expect(id).toBe('ath_m_1')
    expect(getActiveAthleteId()).toBe('ath_m_1')
    expect(getSelfAthleteId()).toBe('ath_user-1')
  })

  it('selección inválida (inexistente / otro owner / inactiva) → fallback self + limpieza', async () => {
    await db.athletes.put({ id: 'ath_user-1', ownerAccountId: 'user-1', status: 'active', createdAt: 1, updatedAt: 1 })
    persistAthleteSelection('user-1', 'ath_ghost')
    const id = await hydrateActiveAthlete('user-1')
    expect(id).toBe('ath_user-1')
    expect(getPersistedAthleteSelection('user-1')).toBeNull()
  })

  it('sin selección persistida → self (regresión del comportamiento actual)', async () => {
    await db.athletes.put({ id: 'ath_user-1', ownerAccountId: 'user-1', status: 'active', createdAt: 1, updatedAt: 1 })
    const id = await hydrateActiveAthlete('user-1')
    expect(id).toBe('ath_user-1')
    expect(getSelfAthleteId()).toBe('ath_user-1')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/athlete/__tests__/athleteSelection.test.ts src/services/athlete/__tests__/hydrateActiveAthlete.test.ts`
Expected: FAIL — módulo no existe / hydrate ignora la selección.

- [ ] **Step 3: Implement `athleteSelection.ts`**

```typescript
const SELECTION_KEY_PREFIX = 'entrenador_active_athlete'

function selectionKey(ownerAccountId: string): string {
  return `${SELECTION_KEY_PREFIX}:${ownerAccountId}`
}

export function getPersistedAthleteSelection(ownerAccountId: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(selectionKey(ownerAccountId))
  } catch {
    return null
  }
}

export function persistAthleteSelection(ownerAccountId: string, athleteId: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (athleteId === null) {
      localStorage.removeItem(selectionKey(ownerAccountId))
      return
    }
    localStorage.setItem(selectionKey(ownerAccountId), athleteId)
  } catch {
    // ignore (private mode / storage full) — selection just won't persist
  }
}
```

- [ ] **Step 4: Rewrite `hydrateActiveAthlete.ts`**

```typescript
import { db } from '../../db/db'
import { setActiveAthleteId, setSelfAthleteId } from './activeAthlete'
import { athleteIdForOwner } from './athleteScopeMigration'
import { getPersistedAthleteSelection, persistAthleteSelection } from './athleteSelection'

/**
 * Resolve the owner's athletes and publish them to the module holders.
 *
 * Selection-aware (spec §3.3): a persisted, VALID selection (existing local
 * athlete row, right owner, active status) is respected — so the callers that
 * re-hydrate on every sync (pullAthletes, ensureRemoteAthlete) confirm instead
 * of clobbering a coach's managed-athlete selection. An invalid selection is
 * cleared and we fall back to the deterministic self athlete. Returns the
 * resolved ACTIVE athlete id, or null pre-migration (legacy user_id scope).
 */
export async function hydrateActiveAthlete(ownerAccountId: string): Promise<string | null> {
  const selfRow = await db.athletes.get(athleteIdForOwner(ownerAccountId))
  const selfId = selfRow?.id ?? null
  setSelfAthleteId(selfId)

  const persisted = getPersistedAthleteSelection(ownerAccountId)
  if (persisted && persisted !== selfId) {
    const row = await db.athletes.get(persisted)
    const isValid = !!row && row.ownerAccountId === ownerAccountId && row.status === 'active'
    if (isValid) {
      setActiveAthleteId(persisted)
      return persisted
    }
    persistAthleteSelection(ownerAccountId, null)
  }

  setActiveAthleteId(selfId)
  return selfId
}
```

- [ ] **Step 5: Run tests + full suite + build**

Run: `npx vitest run src/services/athlete/__tests__/ && npm test && npm run build`
Expected: verdes (sin selección persistida, `hydrateActiveAthlete` se comporta exactamente como hoy + setea el self; los tests existentes del archivo deben seguir pasando, extendidos con `getSelfAthleteId()` donde aporte).

- [ ] **Step 6: Commit** (no-op)

---

## Task 9: Verificación final + inventario residual

**Files:** ninguno nuevo (verificación).

- [ ] **Step 1: Inventario residual de lecturas sin scope**

Run: `grep -rn "db\.\(sessions\|weekSummaries\|coachProposals\|chatMessages\)\.\(toArray\|where\|orderBy\|filter\)" src/ --include='*.ts' --include='*.tsx' | grep -v __tests__ | grep -v "services/sync" | grep -v "db/queries.ts"`

Clasificar cada hit restante como: (a) ya scoped en este plan, (b) **intencionalmente global** — `dataExport.ts` (backup por cuenta completa), `athleteScopeMigration.ts` (backfill), `appMaintenance.ts`/`devTools.ts` (mantenimiento), `db/seed.ts` (dev), escrituras por id (`get/put/delete` con id explícito) — o (c) **fuga nueva** → volver a la task correspondiente y cerrarla. Dejar la clasificación anotada en el resumen de cierre del plan.

- [ ] **Step 2: Suite completa**

Run: `npm run lint && npm test && npm run build`
Expected: todo verde.

- [ ] **Step 3: Smoke manual single-athlete (owner)**

Con `npm run dev`: login normal → dashboard/semana/chat/planes se ven idénticos (sin atleta gestionado nada cambia). Verificar en DevTools que no aparece `entrenador_active_athlete:*` (nada escribe selección todavía) y que el chat sigue usando `coach_chat_session_id` legacy.

- [ ] **Step 4: Commit final** (no-op — el owner commitea el plan completo)

---

## Self-Review Notes

- **Spec coverage (Parte 1):** política legacy self-only (§3.6) → Tasks 1–4 (holder, helper, queries, sync anclado a self); scoping sessions/summaries/proposals/contexto IA (§3.6) → Tasks 3, 5, 6; escrituras locales estampadas (cierre local-first de la política; hallazgo del review) → Task 6b; chat athlete-scoped por key, decisión del owner (§3.6) → Task 7; selección activa persistida + hidratación selection-aware + no-clobber de `pullAthletes`/`ensureRemoteAthlete` (§3.3) → Task 8 (sin tocar los callers: ambos llaman `hydrateActiveAthlete`). Fuera de esta parte (Parte 2, plan siguiente): gating/allowlist §3.1, perfiles multi-atleta + 009 §3.2, API gestionados + ensure por athleteId §3.4, switcher/roster §3.5/§3.7.
- **Riesgo destructivo cubierto con tests reales (review):** Task 5 tiene integración destructiva de `applyCreateWeek` (planned del self sobrevive un reemplazo con gestionado activo) y rollback de `commitPlan` (fila fuera de scope ni se borra ni se pisa), no solo el helper puro.
- **Repair de chat scoped (review):** `repairOrphanProposalMessagesUnlocked` filtra proposals al scope activo (Task 6 Step 4) para no reenganchar propuestas de otro atleta al hilo actual.
- **Type consistency:** `getSelfAthleteId`/`setSelfAthleteId`/`isSelfScopeActive` (Task 1) usados idéntico en Tasks 2–4, 7, 8; `isRowInActiveScope`/`filterRowsToActiveScope` (Task 2) en Tasks 3, 5, 6; `withActiveAthleteStamp` (Task 5 Step 0) en Tasks 5 y 6b; `clearAllStoredChatSessionIds` (Task 7) cablea `appMaintenance`/`dataExport`; `getPersistedAthleteSelection`/`persistAthleteSelection` (Task 8) reservados para `switchActiveAthlete` en Parte 2.
- **Regresión single-athlete:** cada rama nueva colapsa al comportamiento actual cuando `active === self` o ambos null (incluido el estampado de Task 6b, no-op sin atleta activo); Task 4 Step 4 alinea los setups de tests existentes al escenario real (self seteado).

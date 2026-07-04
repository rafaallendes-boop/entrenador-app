# Coach F2-lite Parte 2a — Perfiles Multi-Atleta + 009 + Atletas Gestionados (capa datos/sync)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Romper el singleton de `athlete_profiles` de punta a punta (local, push, merge, migrate, remoto vía `009`), asegurar el atleta gestionado remoto antes de sus child rows, y exponer la API `createManagedAthlete`/`pushAthlete`/`listOwnedAthletes` — sin ninguna UI nueva.

**Architecture:** Cada perfil se agrupa por **profile group key**: filas con `athlete_id` scoped distinto del self → grupo del gestionado; todo lo demás (self, legacy null, sentinel) → grupo `self`. El id local del perfil gestionado es su propio `athleteId`; el remoto es `profile:${userId}:${athleteId}` (el self conserva `profile:${userId}` y `'default'` local — cero migración de la fila existente). Repair/persist/merge/migrate operan **dentro de cada grupo**, nunca cross-grupo. La migración `009` es mini expand/contract: preflight → unique compuesto `(user_id, athlete_id)` → deploy cliente → drop del unique viejo.

**Tech Stack:** TypeScript, Dexie (fake-indexeddb en tests), Supabase (PostgREST), Vitest. SQL manual.

**Spec:** `docs/superpowers/specs/2026-07-02-coach-ui-f2-mvp-design.md` (§3.2, §3.4). Este plan es la **Parte 2a** (datos/sync); la **Parte 2b** (gating §3.1, switcher §3.5, roster §3.7, resets de stores) se planifica cuando 2a esté cerrada — consumirá `createManagedAthlete`/`listOwnedAthletes` y `switchActiveAthlete` sobre `persistAthleteSelection` (ya existente).

## Global Constraints

- **Parte 1 (athlete-aware core) ya está implementada**; `008b` ya está aplicado en prod. **Precondición de deploy de 2a:** Parte 1 desplegada y con smoke verde en prod.
- **Profile group key:** `isScopedAthleteId(athleteId) && athleteId !== selfAthleteId` → grupo = `athleteId`; si no → grupo `'self'`. El sentinel `ATHLETE_PROFILE_LOCAL_ID`, null y el propio self caen en `'self'`. Nunca usar checks falsy.
- **Ids:** local gestionado = `athleteId` (PK de `athleteProfiles`); remoto gestionado = `` `profile:${userId}:${localId}` ``; self intacto (`'default'` local, `` `profile:${userId}` `` remoto).
- **Reset lock / full reset siguen siendo account-level:** viven en el grupo self y, cuando disparan, limpian TODOS los perfiles locales (gestionados incluidos), como hoy.
- **`onConflict` de perfiles pasa a `'user_id,athlete_id'`** — válido solo post-`009b` (expand). El deploy de este código requiere `009b` aplicada ANTES (Task 8).
- **Invariante post-009: ningún write remoto de `athlete_profiles` sale con `athlete_id` null** — un unique compuesto nullable NO deduplica NULLs, y un upsert con `athlete_id` null nunca conflictúa (insertaría fila nueva). `athleteProfileToRow` **deriva** `athlete_id` del id local (sentinel → `athleteIdForOwner(userId)`; otro → `localId`) — el campo `athleteId` del objeto NUNCA decide el scope remoto (un perfil corrupto/importado `{ id: 'default', athleteId: 'ath_m_1' }` no puede re-scopear el self). `createAthleteProfileFullResetRow` estampa el self. El perfil local legacy (sin atleta activo) puede seguir sin `athleteId`; el payload remoto no.
- **El scope de un perfil nunca viene del caller:** el patch de `upsertAthleteProfile` excluye `athleteId` (tipo + strip en runtime); el `athleteId` se deriva SIEMPRE del atleta activo.
- **Crear el SEGUNDO perfil (primer gestionado) sigue chocando `23505` con el unique viejo hasta `009c` (contract).** No crear gestionados reales hasta cerrar Task 8.
- **Managed nunca adopta legacy** (política Parte 1): un perfil gestionado inexistente NO cae al `'default'`; se crea vacío al guardar.
- Sin UI nueva; sin `account_type`; sin `coach_athlete_links`; sin tocar Dexie schema (v14 ya tiene PK `id` + índice `athleteId` en `athleteProfiles`).
- Verificación por task: `npm run lint && npm test && npm run build` verdes.

**⚠️ Política de commits:** El owner hace los commits. **NO ejecutar `git commit`/`git add` dentro de las tasks.** Tratar los pasos "Commit" como no-op.

---

## File Structure

```
src/services/
  syncUtils.ts                          [MODIFY: group key + remote id por atleta + rowToAthleteProfile group-aware]
  syncService.ts                        [MODIFY: persist/repair/upsert/merge/migrate por grupo; ensureRemoteAthlete(userId, athleteId?); pushAthlete]
  athlete/managedAthletes.ts            [NEW: createManagedAthlete + listOwnedAthletes]
  __tests__/athleteProfileGroups.test.ts   [NEW: helpers puros]
  __tests__/syncService.test.ts         [EXTEND: multi-perfil push/merge + ensure gestionado]
  __tests__/managedAthletes.test.ts     [NEW]

src/db/
  queries.ts                            [MODIFY: getAthleteProfile/upsertAthleteProfile por atleta activo]
  __tests__/queriesActiveScope.test.ts  [EXTEND: perfil por atleta]

supabase/
  009a_athlete_profiles_preflight.sql   [NEW: report-only]
  009b_athlete_profiles_expand.sql      [NEW: unique compuesto, guarded]
  009c_athlete_profiles_contract.sql    [NEW: drop unique viejo, guarded]
```

---

## Task 1: Helpers de grupo + ids por atleta en `syncUtils.ts`

**Files:**
- Modify: `src/services/syncUtils.ts` (`getAthleteProfileRemoteId` ~`:345`, `athleteProfileToRow` ~`:349`, `rowToAthleteProfile` ~`:381`)
- Test: `src/services/__tests__/athleteProfileGroups.test.ts` (create)

**Interfaces:**
- Produces:
  - `ATHLETE_PROFILE_SELF_GROUP = 'self'` (const exportada).
  - `athleteProfileGroupKey(athleteId: string | null | undefined, selfAthleteId: string | null): string` — grupo del gestionado o `'self'`.
  - `groupAthleteProfileRows(rows: AthleteProfileSyncRow[], selfAthleteId: string | null): Map<string, AthleteProfileSyncRow[]>`.
  - `athleteProfileToRow(profile, userId)` — MISMA firma; el `id` remoto ahora depende de `profile.id` (sentinel → `profile:${userId}`; otro → `profile:${userId}:${profile.id}`) y **`athlete_id` se DERIVA del id local, siempre no-null**: sentinel → `athleteIdForOwner(userId)`; otro → `localId`. `profile.athleteId` no participa — el id local es la fuente de verdad del scope (invariante post-009, ver Global Constraints).
  - `createAthleteProfileFullResetRow(userId, resetAt)` — estampa `athlete_id: athleteIdForOwner(userId)` (hoy el technical_marker sale sin `athlete_id`; post-009c su upsert compuesto con NULL nunca conflictuaría e insertaría una SEGUNDA fila del self).
  - `rowToAthleteProfile(row, selfAthleteId: string | null)` — el `id` local resuelto por grupo: grupo self → `ATHLETE_PROFILE_LOCAL_ID`; gestionado → su `athlete_id`. **Param REQUERIDO, sin default**: con default `null`, un caller que lo omita convertiría la fila self (`athlete_id: 'ath_user-1'`) en un perfil local `id = 'ath_user-1'` en vez de `'default'`; TypeScript debe forzar la revisión de cada caller (producción hoy tiene UNO: `mergeAthleteProfile` en `syncService.ts:2571`, que la Task 4 reescribe pasándolo).
- Consumes: `isScopedAthleteId` (importar desde `./athlete/effectiveAthleteKey`), `athleteIdForOwner` (importar desde `./athlete/athleteScopeMigration` — función pura; sin ciclo: ese módulo solo importa `db/db` y `effectiveAthleteKey`, y Dexie no abre la DB al construirse), `ATHLETE_PROFILE_LOCAL_ID` (ya importado).

- [ ] **Step 1: Write the failing test**

Create `src/services/__tests__/athleteProfileGroups.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  ATHLETE_PROFILE_SELF_GROUP,
  athleteProfileGroupKey,
  groupAthleteProfileRows,
  athleteProfileToRow,
  rowToAthleteProfile,
  createAthleteProfileFullResetRow,
  type AthleteProfileSyncRow,
} from '../syncUtils'
import { ATHLETE_PROFILE_LOCAL_ID } from '../athlete/activeAthlete'
import type { AthleteProfile } from '../../types'

const syncRow = (partial: Partial<AthleteProfileSyncRow>): AthleteProfileSyncRow => ({
  id: 'r1', user_id: 'user-1', athlete_id: null, coach_memory: null, updated_at: 1, data: null,
  ...partial,
})

describe('athleteProfileGroupKey', () => {
  it('self, legacy null y sentinel caen al grupo self', () => {
    expect(athleteProfileGroupKey('ath_self', 'ath_self')).toBe(ATHLETE_PROFILE_SELF_GROUP)
    expect(athleteProfileGroupKey(null, 'ath_self')).toBe(ATHLETE_PROFILE_SELF_GROUP)
    expect(athleteProfileGroupKey(undefined, 'ath_self')).toBe(ATHLETE_PROFILE_SELF_GROUP)
    expect(athleteProfileGroupKey(ATHLETE_PROFILE_LOCAL_ID, 'ath_self')).toBe(ATHLETE_PROFILE_SELF_GROUP)
  })
  it('un gestionado es su propio grupo', () => {
    expect(athleteProfileGroupKey('ath_m_1', 'ath_self')).toBe('ath_m_1')
  })
  it('sin self hidratado, cualquier scoped es su propio grupo y legacy es self', () => {
    expect(athleteProfileGroupKey('ath_x', null)).toBe('ath_x')
    expect(athleteProfileGroupKey(null, null)).toBe(ATHLETE_PROFILE_SELF_GROUP)
  })
})

describe('groupAthleteProfileRows', () => {
  it('agrupa filas remotas por grupo', () => {
    const rows = [
      syncRow({ id: 'a', athlete_id: 'ath_self' }),
      syncRow({ id: 'b', athlete_id: null }),
      syncRow({ id: 'c', athlete_id: 'ath_m_1' }),
    ]
    const groups = groupAthleteProfileRows(rows, 'ath_self')
    expect([...groups.keys()].sort()).toEqual(['ath_m_1', ATHLETE_PROFILE_SELF_GROUP])
    expect(groups.get(ATHLETE_PROFILE_SELF_GROUP)?.map((r) => r.id)).toEqual(['a', 'b'])
    expect(groups.get('ath_m_1')?.map((r) => r.id)).toEqual(['c'])
  })
})

describe('remote id + athlete_id por atleta', () => {
  it('el self conserva profile:${userId}', () => {
    const row = athleteProfileToRow({ id: ATHLETE_PROFILE_LOCAL_ID, updatedAt: 1, athleteId: 'ath_user-1' } as AthleteProfile, 'user-1')
    expect(row.id).toBe('profile:user-1')
    expect(row.athlete_id).toBe('ath_user-1')
  })
  it('el self legacy (sin athleteId local) NUNCA sale con athlete_id null: estampa athleteIdForOwner', () => {
    const row = athleteProfileToRow({ id: ATHLETE_PROFILE_LOCAL_ID, updatedAt: 1 } as AthleteProfile, 'user-1')
    expect(row.athlete_id).toBe('ath_user-1')
  })
  it('un gestionado usa profile:${userId}:${localId} y su propio athlete_id', () => {
    const row = athleteProfileToRow({ id: 'ath_m_1', updatedAt: 1, athleteId: 'ath_m_1' } as AthleteProfile, 'user-1')
    expect(row.id).toBe('profile:user-1:ath_m_1')
    expect(row.athlete_id).toBe('ath_m_1')
  })
  it('un gestionado sin athleteId explícito hereda su localId como athlete_id (nunca null)', () => {
    const row = athleteProfileToRow({ id: 'ath_m_1', updatedAt: 1 } as AthleteProfile, 'user-1')
    expect(row.athlete_id).toBe('ath_m_1')
  })
  it('mismatch: el self corrupto con athleteId de gestionado SIGUE saliendo como self', () => {
    const row = athleteProfileToRow({ id: ATHLETE_PROFILE_LOCAL_ID, updatedAt: 1, athleteId: 'ath_m_1' } as AthleteProfile, 'user-1')
    expect(row.id).toBe('profile:user-1')
    expect(row.athlete_id).toBe('ath_user-1')
  })
  it('mismatch: un gestionado con athleteId ajeno sale con SU localId', () => {
    const row = athleteProfileToRow({ id: 'ath_m_1', updatedAt: 1, athleteId: 'ath_m_2' } as AthleteProfile, 'user-1')
    expect(row.athlete_id).toBe('ath_m_1')
  })
  it('el full-reset marker también estampa el self athlete_id', () => {
    const marker = createAthleteProfileFullResetRow('user-1', 99)
    expect(marker.athlete_id).toBe('ath_user-1')
  })
})

describe('rowToAthleteProfile group-aware', () => {
  it('grupo self → id local sentinel (compat)', () => {
    const profile = rowToAthleteProfile(syncRow({ athlete_id: 'ath_self', updated_at: 5 }), 'ath_self')
    expect(profile.id).toBe(ATHLETE_PROFILE_LOCAL_ID)
    expect(profile.id).not.toBe('ath_self')
  })
  it('gestionado → id local = athleteId', () => {
    const profile = rowToAthleteProfile(syncRow({ athlete_id: 'ath_m_1', updated_at: 5 }), 'ath_self')
    expect(profile.id).toBe('ath_m_1')
    expect(profile.athleteId).toBe('ath_m_1')
  })
  it('con selfAthleteId null explícito, legacy null sigue cayendo al sentinel', () => {
    const profile = rowToAthleteProfile(syncRow({ athlete_id: null, updated_at: 5 }), null)
    expect(profile.id).toBe(ATHLETE_PROFILE_LOCAL_ID)
  })
})
```

> El guard `noDirectDefault` excluye `__tests__`, pero igual usar `ATHLETE_PROFILE_LOCAL_ID` en los asserts (evita re-introducir el literal si el guard se amplía).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/athleteProfileGroups.test.ts`
Expected: FAIL — símbolos no exportados.

- [ ] **Step 3: Implement en `syncUtils.ts`**

Imports nuevos: `import { isScopedAthleteId } from './athlete/effectiveAthleteKey'` y `import { athleteIdForOwner } from './athlete/athleteScopeMigration'` (verificar que no creen ciclo: ninguno de los dos módulos importa `syncUtils`; `athleteScopeMigration` importa `db/db`, que solo construye la instancia Dexie sin abrirla — inocuo para tests puros).

```typescript
export const ATHLETE_PROFILE_SELF_GROUP = 'self'

/**
 * Profile group key (Parte 2a): a scoped athlete_id that is NOT the self
 * athlete forms its own group; self, legacy null and the local sentinel all
 * collapse into the 'self' group. Repair/persist/merge NEVER cross groups.
 */
export function athleteProfileGroupKey(
  athleteId: string | null | undefined,
  selfAthleteId: string | null,
): string {
  if (isScopedAthleteId(athleteId) && athleteId !== selfAthleteId) return athleteId
  return ATHLETE_PROFILE_SELF_GROUP
}

export function groupAthleteProfileRows(
  rows: AthleteProfileSyncRow[],
  selfAthleteId: string | null,
): Map<string, AthleteProfileSyncRow[]> {
  const groups = new Map<string, AthleteProfileSyncRow[]>()
  for (const row of rows) {
    const key = athleteProfileGroupKey(row.athlete_id, selfAthleteId)
    const bucket = groups.get(key)
    if (bucket) bucket.push(row)
    else groups.set(key, [row])
  }
  return groups
}
```

Cambiar `getAthleteProfileRemoteId` y su uso en `athleteProfileToRow`:

```typescript
function getAthleteProfileRemoteId(userId: string, localProfileId: string): string {
  // The self singleton keeps its historic remote id (no row migration);
  // managed profiles get a per-athlete remote id.
  if (localProfileId === ATHLETE_PROFILE_LOCAL_ID) return `profile:${userId}`
  return `profile:${userId}:${localProfileId}`
}
```

En `athleteProfileToRow`, el destructuring actual descarta `id` (`const { id: _localId, ... }`); pasa a usarlo:

```typescript
export function athleteProfileToRow(profile: AthleteProfile, userId: string): Record<string, unknown> {
  const { id: localId, coachMemory, updatedAt, ...rest } = profile
  // ...cuerpo actual sin cambios...
  return {
    id: getAthleteProfileRemoteId(userId, localId),
    // The local id is the source of truth for scope: profile.athleteId never
    // decides it (a corrupt/imported { id: 'default', athleteId: 'ath_m_1' }
    // must not re-scope the self row). Post-009 invariant: never null — the
    // composite unique (user_id, athlete_id) does not deduplicate NULLs, so a
    // null upsert would insert instead of conflict.
    athlete_id: localId === ATHLETE_PROFILE_LOCAL_ID ? athleteIdForOwner(userId) : localId,
    // ...resto igual (reemplaza el `athlete_id: profile.athleteId ?? null` actual)...
  }
}
```

(El blob `data` sigue llevando el `athleteId` del objeto vía `...rest`; es inofensivo — en `rowToAthleteProfile` la columna no-null siempre gana sobre `data.athleteId`.)

En `createAthleteProfileFullResetRow` (~`:394`), agregar la columna al payload — mismo invariante (el marker es del grupo self) — y actualizar la llamada a la firma nueva:

```typescript
    id: getAthleteProfileRemoteId(userId, ATHLETE_PROFILE_LOCAL_ID),
    user_id: userId,
    athlete_id: athleteIdForOwner(userId),
```

Cambiar `rowToAthleteProfile` (param **requerido**, sin default):

```typescript
export function rowToAthleteProfile(
  row: Record<string, unknown>,
  selfAthleteId: string | null,
): AthleteProfile {
  const { data } = parseAthleteProfileData(row.data as Record<string, unknown> | null)
  const athleteIdValue = row.athlete_id ?? data.athleteId
  const athleteId = typeof athleteIdValue === 'string' ? athleteIdValue : undefined
  const groupKey = athleteProfileGroupKey(athleteId ?? null, selfAthleteId)
  const localId = groupKey === ATHLETE_PROFILE_SELF_GROUP ? ATHLETE_PROFILE_LOCAL_ID : groupKey
  return {
    id: localId,
    coachMemory: (row.coach_memory as string | null) ?? undefined,
    updatedAt: row.updated_at as number,
    ...data,
    ...(athleteId !== undefined ? { athleteId } : {}),
  } as AthleteProfile
}
```

Fix interino del único caller (para que ESTA task quede verde en lint/build): en `syncService.ts:2571`, `rowToAthleteProfile(mergedRow)` → `rowToAthleteProfile(mergedRow, getSelfAthleteId())` (`getSelfAthleteId` ya está importado). Task 4 reescribe ese flujo completo.

- [ ] **Step 4: Run test + full suite**

Run: `npx vitest run src/services/__tests__/athleteProfileGroups.test.ts && npm test`
Expected: verdes. Con un solo perfil (id `'default'`) el remote id y el local id son idénticos a hoy. Único delta remoto: un perfil local sin `athleteId` ya no puede escribir `athlete_id` null (post-`008a` el remoto ya está backfilleado, así que esto solo cierra la puerta hacia adelante). El cambio de firma de `rowToAthleteProfile` es breaking a propósito — el compilador señala cualquier caller olvidado (el único de producción quedó cubierto por el fix interino del Step 3).

- [ ] **Step 5: Commit** (no-op)

---

## Task 2: Perfil por atleta local (`queries.ts`)

**Files:**
- Modify: `src/db/queries.ts:295-323` (`ATHLETE_PROFILE_ID`, `getAthleteProfile`, `upsertAthleteProfile`)
- Test: `src/db/__tests__/queriesActiveScope.test.ts` (extend)

**Interfaces:**
- Produces: `getAthleteProfile()` misma firma; `upsertAthleteProfile(patch)` estrecha el tipo del patch a `Partial<Omit<AthleteProfile, 'id' | 'updatedAt' | 'athleteId'>>` y **strippea `athleteId` en runtime** — el scope se deriva del atleta activo, nunca del caller (un patch no puede re-scopear una fila existente). Comportamiento: self o sin atleta activo → fila `'default'` (idéntico a hoy); gestionado activo → fila con `id = activeAthleteId`, creada al primer guardado, jamás adopta la del self.
- Consumes: `getActiveAthleteId`, `isSelfScopeActive` (ya importados), `ATHLETE_PROFILE_LOCAL_ID` desde `../services/athlete/activeAthlete`.

- [ ] **Step 1: Write the failing tests**

Añadir a `src/db/__tests__/queriesActiveScope.test.ts` (mismo arnés de aislamiento; importar `getAthleteProfile, upsertAthleteProfile` desde `../queries`):

```typescript
describe('perfil por atleta', () => {
  it('self activo lee/escribe la fila default (compat)', async () => {
    asSelf()
    const created = await upsertAthleteProfile({ name: 'Rafa' })
    expect(created.id).toBe(ATHLETE_PROFILE_LOCAL_ID) // importar desde services/athlete/activeAthlete
    expect((await getAthleteProfile())?.name).toBe('Rafa')
  })

  it('gestionado activo NO ve el perfil del self y crea su propia fila', async () => {
    asSelf()
    await upsertAthleteProfile({ name: 'Rafa' })

    asManaged()
    expect(await getAthleteProfile()).toBeUndefined() // nunca adopta el default
    const managed = await upsertAthleteProfile({ name: 'Cliente 1' })
    expect(managed.id).toBe('ath_m_1')
    expect(managed.athleteId).toBe('ath_m_1')
    expect((await getAthleteProfile())?.name).toBe('Cliente 1')

    asSelf()
    expect((await getAthleteProfile())?.name).toBe('Rafa') // el self sigue intacto
    expect(await db.athleteProfiles.count()).toBe(2)
  })

  it('sin atleta activo, comportamiento legacy intacto', async () => {
    setActiveAthleteId(null); setSelfAthleteId(null)
    const created = await upsertAthleteProfile({ name: 'Legacy' })
    expect(created.id).toBe(ATHLETE_PROFILE_LOCAL_ID)
  })

  it('un patch con athleteId NO puede re-scopear el perfil (se ignora en create y update)', async () => {
    asSelf()
    const created = await upsertAthleteProfile({ name: 'Rafa', athleteId: 'ath_m_2' } as never)
    expect(created.athleteId).toBe('ath_self')

    const updated = await upsertAthleteProfile({ athleteId: 'ath_m_2' } as never)
    expect(updated.athleteId).toBe('ath_self')
    expect(updated.name).toBe('Rafa')
    expect(await db.athleteProfiles.count()).toBe(1) // nunca se creó una fila re-scopeada
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/__tests__/queriesActiveScope.test.ts`
Expected: FAIL — gestionado lee/escribe la fila `'default'`.

- [ ] **Step 3: Implement en `queries.ts`**

Reemplazar el bloque `ATHLETE_PROFILE_ID` (~`:295`) — importar la constante en vez del literal (agregar `ATHLETE_PROFILE_LOCAL_ID` al import existente de `activeAthlete`):

```typescript
// The profile row key follows the athlete scope: the owner's own profile keeps
// the historic 'default' singleton row; a managed athlete gets its own row
// keyed by its athleteId (never adopting the owner's — Parte 1 legacy policy).
function resolveProfileLocalId(): string {
  const active = getActiveAthleteId()
  if (!active || isSelfScopeActive()) return ATHLETE_PROFILE_LOCAL_ID
  return active
}

export const getAthleteProfile = async (): Promise<AthleteProfile | undefined> =>
  db.athleteProfiles.get(resolveProfileLocalId())

export const upsertAthleteProfile = async (
  patch: Partial<Omit<AthleteProfile, 'id' | 'updatedAt' | 'athleteId'>>
): Promise<AthleteProfile> => {
  const localId = resolveProfileLocalId()
  // The scope is derived from the active athlete, never from the caller: strip
  // any athleteId smuggled past the type so a patch can never re-scope a row.
  const { athleteId: _callerScope, ...safePatch } = patch as Partial<AthleteProfile>
  void _callerScope
  const existing = await db.athleteProfiles.get(localId)
  const updatedAt = Date.now()
  const activeAthleteId = getActiveAthleteId()

  if (existing) {
    const updated: AthleteProfile = {
      ...existing,
      ...safePatch,
      updatedAt,
      ...(activeAthleteId && !isScopedAthleteId(existing.athleteId) ? { athleteId: activeAthleteId } : {}),
    }
    await db.athleteProfiles.put(updated)
    return updated
  }

  const created: AthleteProfile = {
    id: localId,
    updatedAt,
    ...safePatch,
    ...(activeAthleteId ? { athleteId: activeAthleteId } : {}),
  }
  await db.athleteProfiles.put(created)
  return created
}
```

(`isScopedAthleteId` ya está importado en el archivo. El caso legacy — sin atleta activo — no escribe `athleteId` **local**, igual que hoy; el payload **remoto** igual sale no-null vía el fallback de `athleteProfileToRow` de Task 1. Si algún caller existente pasa `athleteId` en el patch y ahora falla el typecheck, quitárselo — el scope nunca fue suyo; hoy no hay ninguno en producción: solo `useCoachMemoryStore` y los tests.)

- [ ] **Step 4: Run test + full suite**

Run: `npx vitest run src/db/__tests__/queriesActiveScope.test.ts && npm test`
Expected: verdes (con self activo, `resolveProfileLocalId()` = `'default'` → idéntico a hoy; `useCoachMemoryStore` pasa por estas dos funciones y queda athlete-aware sin tocarlo).

- [ ] **Step 5: Commit** (no-op)

---

## Task 3: Push path de perfiles por grupo (`syncService.ts`)

**Files:**
- Modify: `src/services/syncService.ts` (`persistAthleteProfileRow` ~`:1730`, `upsertAthleteProfileRow` ~`:1806`, `repairRemoteAthleteProfileRows` ~`:1653`, auto-repair del drain ~`:999-1027`, `repairAthleteProfileDuplicates` ~`:3328`)
- Test: `src/services/__tests__/syncService.test.ts` (extend)

**Interfaces:**
- Consumes: `groupAthleteProfileRows`, `athleteProfileGroupKey`, `ATHLETE_PROFILE_SELF_GROUP` (Task 1; agregarlos al import de `./syncUtils`), `getSelfAthleteId` (ya importado), `athleteIdForOwner` (importar desde `./athlete/athleteScopeMigration` — hoy syncService NO lo importa).
- Behavior: TODO repair/persist/dedupe opera dentro del grupo de la fila que se escribe — incluye el auto-repair del drain de la cola (grupo de la op) y `repairAthleteProfileDuplicates` del panel diagnóstico (por bucket, solo buckets con >1 filas). `onConflict` de perfiles pasa a `'user_id,athlete_id'`. El modo `technical_marker` y los reset markers operan sobre el grupo self.

- [ ] **Step 1: Write the failing test**

Añadir a `src/services/__tests__/syncService.test.ts` (arnés estándar del archivo: `tableResults`, `upsertCalls`, `updateCalls`, `actionResults`):

```typescript
it('pushear el perfil de un gestionado no repara/borra el perfil remoto del self', async () => {
  const { setActiveAthleteId, setSelfAthleteId } = await import('../athlete/activeAthlete')
  setSelfAthleteId('ath_user-1')
  setActiveAthleteId('ath_m_1')
  try {
    // Remoto: existe SOLO el perfil del self.
    actionResults.set('select:athlete_profiles', {
      data: [{ id: 'profile:user-1', user_id: 'user-1', athlete_id: 'ath_user-1', coach_memory: null, updated_at: 5, data: { name: 'Rafa' } }],
      error: null,
    })
    const syncService = await import('../syncService')
    await syncService.pushAthleteProfile({
      id: 'ath_m_1', athleteId: 'ath_m_1', updatedAt: 10, name: 'Cliente 1',
    } as never)

    // Inserta el perfil del gestionado con onConflict compuesto…
    const profileUpsert = upsertCalls.find((c) => c.table === 'athlete_profiles')
    expect(profileUpsert?.payload).toMatchObject({ id: 'profile:user-1:ath_m_1', athlete_id: 'ath_m_1' })
    expect(profileUpsert?.options).toMatchObject({ onConflict: 'user_id,athlete_id' })
    // …y NO toca la fila del self (ni update ni delete cross-grupo).
    expect(updateCalls.find((c) => c.table === 'athlete_profiles')).toBeUndefined()
    expect(deleteCalls.find((c) => c.table === 'athlete_profiles')).toBeUndefined()
  } finally {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  }
})

it('repairAthleteProfileDuplicates NO trata self + gestionado como duplicados', async () => {
  const { setSelfAthleteId } = await import('../athlete/activeAthlete')
  setSelfAthleteId('ath_user-1')
  try {
    actionResults.set('select:athlete_profiles', {
      data: [
        { id: 'profile:user-1', user_id: 'user-1', athlete_id: 'ath_user-1', coach_memory: null, updated_at: 5, data: { name: 'Rafa' } },
        { id: 'profile:user-1:ath_m_1', user_id: 'user-1', athlete_id: 'ath_m_1', coach_memory: null, updated_at: 6, data: { name: 'Cliente 1' } },
      ],
      error: null,
    })
    const syncService = await import('../syncService')
    const result = await syncService.repairAthleteProfileDuplicates('user-1')

    // Dos grupos con una fila cada uno: nada que reparar, cero deletes.
    expect(result).toMatchObject({ remoteRowsBefore: 2, repaired: false })
    expect(deleteCalls.filter((c) => c.table === 'athlete_profiles')).toHaveLength(0)
  } finally {
    setSelfAthleteId(null)
  }
})
```

> Ajustar los nombres de colectores (`upsertCalls`/`updateCalls`/`deleteCalls`/`actionResults`) al arnés real; si `deleteCalls` no existe, agregarlo al mock builder como se hizo con `lte` en 008b. Lo esencial: el push del gestionado es un upsert compuesto de SU fila y no dispara el repair del grupo self (hoy `remoteRows.length` cuenta TODAS las filas → con 2 filas de grupos distintos dispararía `repairRemoteAthleteProfileRows` y borraría una).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/syncService.test.ts -t "no repara/borra el perfil remoto del self"`
Expected: FAIL — hoy el push cuenta filas globales y usa `onConflict: 'user_id'`.

- [ ] **Step 3: Implement — scoping por grupo en el push path**

En `src/services/syncService.ts`:

(a) Helper local (cerca de `fetchAthleteProfileRows`):

```typescript
// Self athlete id for grouping: prefer the hydrated holder, else fall back to
// the deterministic owner id ('ath_' || userId, mirrors the SQL backfill).
// Grouping must NOT depend on hydration timing: with a null self, a self row
// (athlete_id 'ath_<userId>') would form its own "managed" group and corrupt
// the merge.
function groupingSelfAthleteId(userId: string): string {
  return getSelfAthleteId() ?? athleteIdForOwner(userId)
}

function profileGroupOf(row: Record<string, unknown>, userId: string): string {
  const athleteId = (row as { athlete_id?: unknown }).athlete_id
  return athleteProfileGroupKey(typeof athleteId === 'string' ? athleteId : null, groupingSelfAthleteId(userId))
}

async function fetchAthleteProfileRowsForGroup(userId: string, groupKey: string): Promise<AthleteProfileSyncRow[]> {
  const rows = await fetchAthleteProfileRows(userId)
  return rows.filter((row) => athleteProfileGroupKey(row.athlete_id, groupingSelfAthleteId(userId)) === groupKey)
}
```

(b) `upsertAthleteProfileRow(row, userId)`: reemplazar `const remoteRows = await fetchAthleteProfileRows(userId)` por:

```typescript
  const groupKey = profileGroupOf(profileRow as unknown as Record<string, unknown>, userId)
  const remoteRows = await fetchAthleteProfileRowsForGroup(userId, groupKey)
```

El resto del cuerpo (repair si `>1`, persist) queda igual pero opera sobre las filas del grupo.

(c) `persistAthleteProfileRow(row, userId, remoteRows?, options?)`: cuando `remoteRows` viene `undefined`, resolver con `fetchAthleteProfileRowsForGroup(userId, profileGroupOf(profileRow, userId))` (no `fetchAthleteProfileRows`). Cambiar los DOS `upsert(..., { onConflict: 'user_id' })` del archivo (persist normal y technical_marker) a:

```typescript
        } as never, { onConflict: 'user_id,athlete_id' })
```

(d) `repairRemoteAthleteProfileRows`: sin cambios de lógica — ya recibe `rows` del caller; con (b)/(c) siempre recibe filas de UN grupo, así que sus deletes de "perdedores" quedan confinados al grupo. Agregar comentario:

```typescript
/**
 * Repairs duplicates WITHIN one profile group (rows must all share the same
 * athleteProfileGroupKey — callers pre-filter). Cross-group rows are never
 * winners nor losers here: a managed profile is not a "duplicate" of the self.
 */
```

(e) **Auto-repair del drain de la cola (~`:999-1027`): scoping por grupo obligatorio.** El branch actual fetchea TODAS las filas remotas y con `remoteRows.length > 1` ejecuta `repairRemoteAthleteProfileRows` sobre todas — con self + gestionado legítimos, un `23505` coalescería perfiles de grupos distintos y borraría uno. Reemplazar el fetch global:

```typescript
          const groupKey = profileGroupOf(op.payload, op.userId)
          const remoteRows = await fetchAthleteProfileRowsForGroup(op.userId, groupKey)
```

El resto del branch queda igual (repara solo si el GRUPO tiene >1 filas). El branch de upsert de cola (~`:941`) ya pasa por (b) vía `upsertAthleteProfileRow` — verificar con grep.

(f) **`repairAthleteProfileDuplicates` (~`:3328`, panel diagnóstico): reparar por bucket, nunca cross-grupo.** Hoy repara globalmente con todas las filas. Reescribir el núcleo:

```typescript
    const remoteRows = await fetchAthleteProfileRows(userId)
    const groups = groupAthleteProfileRows(remoteRows, groupingSelfAthleteId(userId))
    const dupGroups = [...groups.values()].filter((rows) => rows.length > 1)
    if (dupGroups.length === 0) {
      // ...branch actual de "repaired: false" con remoteRowsBefore: remoteRows.length...
    }
    for (const rows of dupGroups) {
      await repairRemoteAthleteProfileRows(userId, rows)
    }
    // ...branch actual de éxito: repaired: true, remoteRowsBefore: remoteRows.length...
```

- [ ] **Step 4: Run test + full suite + build**

Run: `npx vitest run src/services/__tests__/syncService.test.ts && npm test && npm run build`
Expected: verdes. Los tests existentes de perfiles (single-profile) siguen pasando: con un solo grupo, filtrar por grupo es la identidad; el `onConflict` compuesto es transparente para los mocks existentes salvo que asserten `'user_id'` literal — si alguno lo hace, actualizarlo a `'user_id,athlete_id'` (es el contrato nuevo).

- [ ] **Step 5: Commit** (no-op)

---

## Task 4: `mergeAthleteProfile` + `migrateLocalDataToCloud` por grupo

**Files:**
- Modify: `src/services/syncService.ts` (`mergeAthleteProfile` ~`:2513-2580`, bloque de perfiles de `migrateLocalDataToCloud` ~`:3298-3302`)
- Test: `src/services/__tests__/syncService.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 helpers + `rowToAthleteProfile(row, selfAthleteId)`.
- Behavior: el merge agrupa filas remotas; el grupo self conserva la lógica actual (reset lock account-level, full-reset row, repair, LWW vs `'default'`) con UNA excepción: el branch "self remoto vacío" pasa de `clear()` a borrar SOLO la fila `'default'` — `clear()` queda reservado a reset lock/full reset account-level; cada grupo gestionado hace repair-si-duplicado + LWW contra su fila local `id = athleteId`; un perfil local gestionado sin remoto se pushea **solo si es nuevo/local más reciente** — dentro de la ventana de deletes (`context.allowDeletes && local.updatedAt <= context.deleteBeforeTs`) se borra localmente en vez de resucitar un delete remoto (mismo contrato que el grupo self en `:2549-2551` y que el resto de tablas). `migrateLocalDataToCloud` coalescea por grupo, no globalmente.

- [ ] **Step 1: Write the failing test**

Añadir a `src/services/__tests__/syncService.test.ts`:

```typescript
it('un full pull con perfiles de self y gestionado converge cada uno a su fila local', async () => {
  const { setSelfAthleteId, setActiveAthleteId } = await import('../athlete/activeAthlete')
  setSelfAthleteId('ath_user-1')
  try {
    actionResults.set('select:athlete_profiles', {
      data: [
        { id: 'profile:user-1', user_id: 'user-1', athlete_id: 'ath_user-1', coach_memory: null, updated_at: 20, data: { name: 'Rafa' } },
        { id: 'profile:user-1:ath_m_1', user_id: 'user-1', athlete_id: 'ath_m_1', coach_memory: null, updated_at: 30, data: { name: 'Cliente 1' } },
      ],
      error: null,
    })
    const syncService = await import('../syncService')
    await syncService.runFullSync('user-1')

    const local = athleteProfileRows as Array<{ id: string; name?: string }>
    const self = local.find((p) => p.id === ATHLETE_PROFILE_LOCAL_ID)
    const managed = local.find((p) => p.id === 'ath_m_1')
    expect(self?.name).toBe('Rafa')
    expect(managed?.name).toBe('Cliente 1')
    // Dos grupos NO son duplicados: nadie borró filas remotas.
    expect(deleteCalls.filter((c) => c.table === 'athlete_profiles')).toHaveLength(0)
  } finally {
    setSelfAthleteId(null)
    setActiveAthleteId(null)
  }
})

it('self remoto vacío en ventana de deletes borra SOLO la fila default, nunca perfiles gestionados', async () => {
  const { setSelfAthleteId, setActiveAthleteId } = await import('../athlete/activeAthlete')
  setSelfAthleteId('ath_user-1')
  try {
    // Local: self viejo (en ventana de deletes) + gestionado fresco. Remoto: SOLO el gestionado.
    athleteProfileRows.push(
      { id: ATHLETE_PROFILE_LOCAL_ID, athleteId: 'ath_user-1', updatedAt: 5, name: 'Rafa' } as never,
      { id: 'ath_m_1', athleteId: 'ath_m_1', updatedAt: 50, name: 'Cliente 1' } as never,
    )
    actionResults.set('select:athlete_profiles', {
      data: [{ id: 'profile:user-1:ath_m_1', user_id: 'user-1', athlete_id: 'ath_m_1', coach_memory: null, updated_at: 50, data: { name: 'Cliente 1' } }],
      error: null,
    })
    // Arnés: allowDeletes true con deleteBeforeTs >= 5 (ver test anterior).
    const syncService = await import('../syncService')
    await syncService.runFullSync('user-1')

    expect(athleteProfileRows.find((p: { id: string }) => p.id === ATHLETE_PROFILE_LOCAL_ID)).toBeUndefined()
    expect(athleteProfileRows.find((p: { id: string }) => p.id === 'ath_m_1')).toBeDefined()
  } finally {
    setSelfAthleteId(null)
    setActiveAthleteId(null)
  }
})

it('un gestionado local sin remoto dentro de la ventana de deletes se borra en vez de resucitar', async () => {
  const { setSelfAthleteId, setActiveAthleteId } = await import('../athlete/activeAthlete')
  setSelfAthleteId('ath_user-1')
  try {
    // Local: perfil gestionado viejo (updatedAt 5). Remoto: SOLO el self.
    athleteProfileRows.push({ id: 'ath_m_del', athleteId: 'ath_m_del', updatedAt: 5, name: 'Ex cliente' } as never)
    actionResults.set('select:athlete_profiles', {
      data: [{ id: 'profile:user-1', user_id: 'user-1', athlete_id: 'ath_user-1', coach_memory: null, updated_at: 20, data: { name: 'Rafa' } }],
      error: null,
    })
    // Arnés: sync con cola drenada y lastSuccessfulSyncAt >= 5 →
    // context.allowDeletes = true, deleteBeforeTs cubre la fila (reusar el
    // mecanismo de los tests de delete-window existentes del archivo).
    const syncService = await import('../syncService')
    await syncService.runFullSync('user-1')

    expect(athleteProfileRows.find((p: { id: string }) => p.id === 'ath_m_del')).toBeUndefined()
    expect(upsertCalls.find((c) => c.table === 'athlete_profiles'
      && (c.payload as { id?: string }).id === 'profile:user-1:ath_m_del')).toBeUndefined()
  } finally {
    setSelfAthleteId(null)
    setActiveAthleteId(null)
  }
})
```

> El fake `db.athleteProfiles` del arnés hoy tiene `get: async () => undefined` y `put` no-op (~`:305-314` del test) — extenderlo al patrón array-backed de `dayLogRows` (`athleteProfileRows` con `get`/`put`/`bulkPut`/`toArray`/`clear`/`delete` reales sobre el array; `delete` lo necesita el test de la ventana de deletes) para poder asertar. En el assert del self usar `ATHLETE_PROFILE_LOCAL_ID` importado, no el literal.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/syncService.test.ts -t "converge cada uno a su fila local"`
Expected: FAIL — hoy `remoteRows.length > 1` dispara repair (borra el "perdedor") y todo coalescea a `'default'`.

- [ ] **Step 3: Implement — merge por grupos**

Reestructurar `mergeAthleteProfile`:

```typescript
async function mergeAthleteProfile(userId: string, context: MergeContext): Promise<void> {
  if (context.pendingRemoteWipeTables.has('athlete_profiles')) return
  let remoteRows: AthleteProfileSyncRow[]
  try {
    remoteRows = await fetchAthleteProfileRows(userId)
  } catch (error) {
    throw new Error(classifyAthleteProfileSyncError(error))
  }

  // Deterministic fallback: never group with a null self (pre-hydration a self
  // row would otherwise be treated as a managed group).
  const selfAthleteId = groupingSelfAthleteId(userId)
  const groups = groupAthleteProfileRows(remoteRows, selfAthleteId)
  const selfRows = groups.get(ATHLETE_PROFILE_SELF_GROUP) ?? []

  // Reset lock / full reset are ACCOUNT-level: they live in the self group and,
  // when active, clear every local profile (managed included), same as today.
  const profileResetLock = getProfileResetLock(userId)
  if (isProfileResetLockActive(profileResetLock)) {
    if (selfRows.length > 0) {
      const canonicalLockedRow = coalesceAthleteProfileRows(selfRows)
      const resetAt = getAthleteProfileFullResetAt(canonicalLockedRow.data)
      if (resetAt != null) {
        markProfileResetLockStatus(userId, 'awaiting_onboarding_recreation', resetAt)
      }
    }
    await db.athleteProfiles.clear()
    return
  }

  await mergeSelfProfileGroup(userId, selfRows, context)

  for (const [groupKey, rows] of groups) {
    if (groupKey === ATHLETE_PROFILE_SELF_GROUP) continue
    await mergeManagedProfileGroup(userId, groupKey, rows, context, selfAthleteId)
  }

  // Managed local profiles with no remote counterpart: push only if new/fresh.
  // Inside the delete window the missing remote row means it was deleted
  // elsewhere — delete locally instead of resurrecting it (same contract as
  // the self group and every other table).
  const localProfiles = await db.athleteProfiles.toArray()
  for (const local of localProfiles) {
    if (local.id === ATHLETE_PROFILE_LOCAL_ID) continue
    if (groups.has(local.id)) continue
    if (context.allowDeletes && context.deleteBeforeTs != null && local.updatedAt <= context.deleteBeforeTs) {
      await db.athleteProfiles.delete(local.id)
      continue
    }
    context.pendingWrites.push(() => pushAthleteProfile(local))
  }
}
```

`mergeSelfProfileGroup(userId, selfRows, context)` = el cuerpo actual desde el check `remoteRows.length > 1` hasta el final (`:2538-2579`), con TRES sustituciones:

1. Cada `remoteRows` → `selfRows`; el re-fetch post-repair → `fetchAthleteProfileRowsForGroup(userId, ATHLETE_PROFILE_SELF_GROUP)`.
2. `rowToAthleteProfile(mergedRow)` de `:2571` → `rowToAthleteProfile(mergedRow, groupingSelfAthleteId(userId))` (el param ya quedó requerido en Task 1; esto reemplaza el fix interino).
3. **El branch "self remoto vacío" (`:2548-2556`) NO puede seguir usando `db.athleteProfiles.clear()`**: en multi-perfil, que falte el perfil self remoto no autoriza borrar perfiles gestionados locales. Cambiar `:2552` a `db.athleteProfiles.delete(ATHLETE_PROFILE_LOCAL_ID)`. `clear()` queda SOLO en los paths account-level: reset lock activo y full-reset row (`:2565`), que son nucleares por diseño.

Sin otros cambios: repair, full-reset row, coalesce + LWW contra `'default'`, `pendingWrites` con `pushAthleteProfile(mergedProfile)`.

`mergeManagedProfileGroup`:

```typescript
async function mergeManagedProfileGroup(
  userId: string,
  groupKey: string,
  rows: AthleteProfileSyncRow[],
  context: MergeContext,
  selfAthleteId: string | null,
): Promise<void> {
  let groupRows = rows
  if (groupRows.length > 1) {
    const localPreferred = await db.athleteProfiles.get(groupKey)
    const preferredRow = localPreferred
      ? toAthleteProfileSyncRow(athleteProfileToRow(localPreferred, userId))
      : undefined
    await repairRemoteAthleteProfileRows(userId, groupRows, preferredRow)
    groupRows = await fetchAthleteProfileRowsForGroup(userId, groupKey)
    if (groupRows.length === 0) return
  }

  const canonicalRow = coalesceAthleteProfileRows(groupRows)
  const local = await db.athleteProfiles.get(groupKey)
  const localRow = local ? toAthleteProfileSyncRow(athleteProfileToRow(local, userId)) : null
  const mergedRow = localRow ? coalesceAthleteProfileRows([localRow, canonicalRow]) : canonicalRow
  const mergedProfile = rowToAthleteProfile(mergedRow, selfAthleteId)

  if (!localRow || !athleteProfileRowsEqual(localRow, mergedRow)) {
    await db.athleteProfiles.put({ ...mergedProfile, id: groupKey })
  }
  if (!athleteProfileRowsEqual(canonicalRow, mergedRow)) {
    context.pendingWrites.push(() => pushAthleteProfile({ ...mergedProfile, id: groupKey }))
  }
}
```

- [ ] **Step 4: Implement — migrate por grupo**

En `migrateLocalDataToCloud` (~`:3298`), reemplazar el bloque de perfiles:

```typescript
    if (profileRows.length > 0 && !getProfileResetLock(userId)) {
      const syncRows = profileRows.map(toAthleteProfileSyncRow)
      const migrateGroups = groupAthleteProfileRows(syncRows, groupingSelfAthleteId(userId))
      for (const groupRows of migrateGroups.values()) {
        const coalesced = coalesceAthleteProfileRows(groupRows)
        await persistAthleteProfileRow(coalesced as unknown as Record<string, unknown>, userId)
      }
    }
```

- [ ] **Step 5: Run test + full suite + build + grep de callers**

Run: `npx vitest run src/services/__tests__/syncService.test.ts && npm test && npm run build`
Expected: verdes (single-profile: un solo grupo → flujo idéntico al actual).

Grep final OBLIGATORIO: `rg "repairRemoteAthleteProfileRows\(" src/services/syncService.ts` — revisar CADA caller y confirmar que todos pasan filas ya filtradas por grupo (post Tasks 3–4 deben ser: `upsertAthleteProfileRow`, `persistAthleteProfileRow`, auto-repair de cola, `repairAthleteProfileDuplicates` por bucket, `mergeSelfProfileGroup`, `mergeManagedProfileGroup`). Si aparece un caller con filas globales, es un bug de esta task.

- [ ] **Step 6: Commit** (no-op)

---

## Task 5: SQL `009a`/`009b`/`009c` (preflight → expand → contract)

**Files:**
- Create: `supabase/009a_athlete_profiles_preflight.sql`
- Create: `supabase/009b_athlete_profiles_expand.sql`
- Create: `supabase/009c_athlete_profiles_contract.sql`

- [ ] **Step 1: Write `009a` (report-only)**

```sql
-- Coach F2 Parte 2a — preflight de athlete_profiles (report-only, NO escribe).
-- Gate duro para 009b/009c: null debt = 0 y duplicados (user_id, athlete_id) = 0.
select 'athlete_profiles null athlete_id' as check, count(*) as value
from public.athlete_profiles where athlete_id is null
union all
select 'athlete_profiles dup (user_id, athlete_id)', count(*) from (
  select user_id, athlete_id from public.athlete_profiles
  where athlete_id is not null
  group by user_id, athlete_id having count(*) > 1
) d
union all
select 'athlete_profiles rows total', count(*) from public.athlete_profiles;
```

- [ ] **Step 2: Write `009b` (expand, self-guarded)**

```sql
-- Coach F2 Parte 2a — EXPAND: unique compuesto (user_id, athlete_id).
-- Coexiste con athlete_profiles_user_id_unique (002) hasta 009c.
-- Aborta si hay null debt o duplicados (un unique nullable NO deduplica NULLs).
do $$
declare
  null_debt int;
  dup_count int;
begin
  select count(*) into null_debt from public.athlete_profiles where athlete_id is null;
  select count(*) into dup_count from (
    select user_id, athlete_id from public.athlete_profiles
    where athlete_id is not null
    group by user_id, athlete_id having count(*) > 1
  ) d;
  if null_debt > 0 or dup_count > 0 then
    raise exception 'athlete_profiles 009b aborted: % null athlete_id, % duplicate (user_id, athlete_id). Resolve via 009a before expanding.', null_debt, dup_count;
  end if;
end $$;

create unique index if not exists athlete_profiles_user_athlete_unique
  on public.athlete_profiles (user_id, athlete_id);
```

- [ ] **Step 3: Write `009c` (contract, self-guarded)**

```sql
-- Coach F2 Parte 2a — CONTRACT: drop del unique legacy por user_id.
-- PRERREQUISITOS (en orden): 009b aplicada; cliente nuevo (onConflict
-- 'user_id,athlete_id') desplegado y bundle confirmado (PWA stale = clientes
-- viejos con onConflict 'user_id' romperían tras este drop).
-- Después de esto ya se puede crear el segundo perfil (primer gestionado).
do $$
declare
  null_debt int;
begin
  if not exists (
    select 1 from pg_indexes
    where tablename = 'athlete_profiles' and indexname = 'athlete_profiles_user_athlete_unique'
  ) then
    raise exception 'athlete_profiles 009c aborted: composite unique missing. Apply 009b first.';
  end if;
  select count(*) into null_debt from public.athlete_profiles where athlete_id is null;
  if null_debt > 0 then
    raise exception 'athlete_profiles 009c aborted: % rows with null athlete_id.', null_debt;
  end if;
end $$;

drop index if exists public.athlete_profiles_user_id_unique;
```

- [ ] **Step 4: Sanity**

Run: `npm run lint && npm run build`
Expected: verdes (los `.sql` no afectan el bundle; aplicación manual en Task 8).

- [ ] **Step 5: Commit** (no-op)

---

## Task 6: `ensureRemoteAthlete(userId, athleteId?)` — child rows de gestionados sin `23503`

**Files:**
- Modify: `src/services/syncService.ts` (`ensureRemoteAthleteOnce`/`ensureRemoteAthlete` ~`:1859-1891`, wiring en `upsertRow` ~`:1158` **y en el drain de la cola** ~`:938-948`)
- Test: `src/services/__tests__/syncService.test.ts` (extend)

**Interfaces:**
- Produces: `ensureRemoteAthlete(userId: string, athleteId?: string): Promise<void>` — sin `athleteId`, o con el self, comportamiento actual; con un gestionado, upsertea SU fila de `athletes` (leída de `db.athletes`, validando owner) antes del child row; si no existe localmente, **lanza** (path retriable normal — jamás un child huérfano ni una fila inventada). Cacheado por `userId::athleteId` (mismo patrón de promesa dedupe actual). Cableado en los TRES paths de escritura remota: `upsertRow` (directo), drain de cola (offline/retry) y `migrateLocalDataToCloud` (primera migración).
- Consumes: `athleteIdForOwner` (importado en Task 3 desde `./athlete/athleteScopeMigration`), `athleteToRow`, `isScopedAthleteId`.

- [ ] **Step 1: Write the failing test**

```typescript
it('pushear un day log de un gestionado asegura SU fila de athletes primero (sin 23503)', async () => {
  const { setActiveAthleteId, setSelfAthleteId } = await import('../athlete/activeAthlete')
  const { db: mockedDb } = await import('../../db/db')
  setSelfAthleteId('ath_user-1')
  setActiveAthleteId('ath_m_1')
  try {
    const now = Date.now()
    await mockedDb.athletes.put({ id: 'ath_m_1', ownerAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now } as never)

    const syncService = await import('../syncService')
    await syncService.pushDayLog({ id: 'dl-1', date: '2026-07-06', updatedAt: 10, athleteId: 'ath_m_1' } as never)

    const athleteUpserts = upsertCalls.filter((c) => c.table === 'athletes')
    expect(athleteUpserts.some((c) => (c.payload as { id?: string }).id === 'ath_m_1')).toBe(true)
    // El ensure del gestionado precede al child row.
    const managedEnsureIdx = upsertCalls.findIndex((c) => c.table === 'athletes' && (c.payload as { id?: string }).id === 'ath_m_1')
    const childIdx = upsertCalls.findIndex((c) => c.table === 'day_logs')
    expect(managedEnsureIdx).toBeGreaterThanOrEqual(0)
    expect(childIdx).toBeGreaterThan(managedEnsureIdx)
  } finally {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  }
})

it('drenar una op encolada de un gestionado asegura SU fila de athletes antes del child', async () => {
  const { setSelfAthleteId } = await import('../athlete/activeAthlete')
  const { db: mockedDb } = await import('../../db/db')
  setSelfAthleteId('ath_user-1')
  try {
    const now = Date.now()
    await mockedDb.athletes.put({ id: 'ath_m_1', ownerAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now } as never)
    // Op encolada (offline/retry) — mismo formato que los tests de cola existentes.
    localStorageState.set('entrenador_sync_queue_v1', JSON.stringify([
      { table: 'day_logs', action: 'upsert', userId: 'user-1', enqueuedAt: 1, attempts: 0,
        payload: { id: 'dl-q1', user_id: 'user-1', date: '2026-07-06', updated_at: 10, athlete_id: 'ath_m_1' } },
    ]))

    const syncService = await import('../syncService')
    await syncService.drainQueue()

    const managedEnsureIdx = upsertCalls.findIndex((c) => c.table === 'athletes' && (c.payload as { id?: string }).id === 'ath_m_1')
    const childIdx = upsertCalls.findIndex((c) => c.table === 'day_logs')
    expect(managedEnsureIdx).toBeGreaterThanOrEqual(0)
    expect(childIdx).toBeGreaterThan(managedEnsureIdx)
  } finally {
    setSelfAthleteId(null)
  }
})

it('un gestionado inexistente localmente NO escribe el child row (falla al path retriable)', async () => {
  const { setActiveAthleteId, setSelfAthleteId } = await import('../athlete/activeAthlete')
  setSelfAthleteId('ath_user-1')
  setActiveAthleteId('ath_ghost')
  try {
    const syncService = await import('../syncService')
    await syncService.pushDayLog({ id: 'dl-2', date: '2026-07-06', updatedAt: 10, athleteId: 'ath_ghost' } as never)
    // pushDayLog no lanza (encola/reintenta), pero el child no debe haberse upserteado.
    expect(upsertCalls.find((c) => c.table === 'day_logs')).toBeUndefined()
  } finally {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  }
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/__tests__/syncService.test.ts -t "gestionado"`
Expected: FAIL — hoy el ensure solo upsertea el self; el day log del gestionado se escribe sin su fila padre / el fantasma se escribe igual.

- [ ] **Step 3: Implement**

```typescript
async function ensureRemoteManagedAthleteOnce(userId: string, athleteId: string): Promise<void> {
  if (!isEnabled()) return
  const local = await db.athletes.get(athleteId)
  if (!local || local.ownerAccountId !== userId) {
    // Never invent the parent row nor let a child hit the FK: fail into the
    // caller's retriable path until the local athletes row exists.
    throw new Error(`managed athlete ${athleteId} not found locally; deferring child push`)
  }
  const { error } = await getSupabase()
    .from('athletes')
    .upsert(athleteToRow(local) as never, { onConflict: 'id' })
  if (error) throw error
}

async function ensureRemoteAthlete(userId: string, athleteId?: string): Promise<void> {
  const isManaged = typeof athleteId === 'string'
    && isScopedAthleteId(athleteId)
    && athleteId !== athleteIdForOwner(userId)
  const cacheKey = isManaged ? `${userId}::${athleteId}` : userId

  const existing = remoteAthleteEnsurePromises.get(cacheKey)
  if (existing) return existing

  const promise = (isManaged
    ? ensureRemoteManagedAthleteOnce(userId, athleteId)
    : ensureRemoteAthleteOnce(userId)
  ).finally(() => {
    remoteAthleteEnsurePromises.delete(cacheKey)
  })
  remoteAthleteEnsurePromises.set(cacheKey, promise)
  return promise
}
```

(Se elimina la versión vieja de `ensureRemoteAthlete`; `athleteIdForOwner` viene de `./athlete/athleteScopeMigration` — verificar el import. `remoteAthleteEnsurePromises` ya existe.)

Wiring en `upsertRow` (~`:1158`):

```typescript
      if (table !== 'athletes' && payload.athlete_id != null) {
        await withRequestTimeout(
          ensureRemoteAthlete(userId, typeof payload.athlete_id === 'string' ? payload.athlete_id : undefined),
          'athletes.ensure',
        )
      }
```

Wiring en el **drain de la cola** (~`:938`, dentro del callback de `withSerializedEntityMutation`, ANTES del branch de `athlete_profiles` y del upsert genérico) — una op encolada offline/retry hace upsert directo sin pasar por `upsertRow`, y sin esto un child de gestionado drenado pegaría `23503`:

```typescript
        if (op.action === 'upsert' && op.table !== 'athletes' && op.payload.athlete_id != null) {
          await withRequestTimeout(
            ensureRemoteAthlete(op.userId, typeof op.payload.athlete_id === 'string' ? op.payload.athlete_id : undefined),
            'athletes.ensure',
          )
        }
```

(Si el ensure lanza — gestionado sin fila local — la op cae al `catch` existente del drain y sigue el ciclo de retry/expiración normal de la cola; exactamente el mismo contrato que el path directo.)

Wiring en `migrateLocalDataToCloud` (~`:3237`) — la migración hace batch upserts directos (no pasa por `upsertRow`) y hoy solo asegura el self; datos locales de gestionados previos a la primera migración subirían child rows sin padre remoto. Después del `await ensureRemoteAthlete(userId)` existente:

```typescript
    // Managed athletes must exist remotely before their child rows migrate.
    const localAthletes = await db.athletes.toArray()
    for (const athlete of localAthletes) {
      if (athlete.ownerAccountId !== userId) continue
      if (athlete.id === athleteIdForOwner(userId)) continue
      await ensureRemoteAthlete(userId, athlete.id)
    }
```

(Itera filas locales existentes, así que el throw de "not found locally" no aplica aquí; un child con `athleteId` scoped huérfano — sin fila en `db.athletes` — seguiría fallando su upsert con `23503`, que es el fail-loud correcto: jamás inventar el padre.)

- [ ] **Step 4: Run tests + full suite + build**

Run: `npx vitest run src/services/__tests__/syncService.test.ts && npm test && npm run build`
Expected: verdes (self/legacy: `isManaged` false → flujo idéntico).

- [ ] **Step 5: Commit** (no-op)

---

## Task 7: API de atletas gestionados (`managedAthletes.ts` + `pushAthlete`)

**Files:**
- Create: `src/services/athlete/managedAthletes.ts`
- Modify: `src/services/syncService.ts` (+ `pushAthlete`, junto a `pushSession` ~`:1893`)
- Test: `src/services/__tests__/managedAthletes.test.ts` (create)

**Interfaces:**
- Produces:
  - `createManagedAthlete(ownerAccountId: string, displayName: string): Promise<Athlete>` — id `ath_m_<uuid>`, `linkedAccountId: null`, `status: 'active'`; persiste local y encola push (Tier A: `athletes` ya está en `ENTITY_TIER`).
  - `listOwnedAthletes(ownerAccountId: string): Promise<Athlete[]>` — atletas activos del owner, self primero, luego por `displayName`.
  - `pushAthlete(athlete: Athlete): Promise<void>` en syncService — `upsertRow('athletes', athleteToRow(athlete))` (PK `id`; cola/retry estándar; el branch de ensure se salta porque `table === 'athletes'`).
- Consumes: `db.athletes`, `uuid`, `athleteIdForOwner`, `getUserId` (interno de syncService).
- La Parte 2b consume `createManagedAthlete`/`listOwnedAthletes` desde el roster.

- [ ] **Step 1: Write the failing tests**

Create `src/services/__tests__/managedAthletes.test.ts` (Dexie real + mock de syncService):

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../syncService', () => ({
  pushAthlete: vi.fn(async () => {}),
}))

import { db } from '../../db/db'
import { createManagedAthlete, listOwnedAthletes } from '../athlete/managedAthletes'
import * as syncService from '../syncService'

describe('managedAthletes', () => {
  beforeEach(async () => { db.close(); await db.delete(); await db.open(); vi.clearAllMocks() })
  afterEach(() => db.close())

  it('createManagedAthlete persiste local y encola el push', async () => {
    const athlete = await createManagedAthlete('user-1', '  Cliente 1  ')
    expect(athlete.id.startsWith('ath_m_')).toBe(true)
    expect(athlete).toMatchObject({
      ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Cliente 1', status: 'active',
    })
    expect(await db.athletes.get(athlete.id)).toBeDefined()
    expect(vi.mocked(syncService.pushAthlete)).toHaveBeenCalledWith(expect.objectContaining({ id: athlete.id }))
  })

  it('rechaza displayName vacío', async () => {
    await expect(createManagedAthlete('user-1', '   ')).rejects.toThrow()
    expect(await db.athletes.count()).toBe(0)
  })

  it('listOwnedAthletes: solo activos del owner, self primero', async () => {
    const now = Date.now()
    await db.athletes.bulkPut([
      { id: 'ath_m_b', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Bruno', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_m_a', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Ana', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_other', ownerAccountId: 'user-2', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_m_x', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'X', status: 'archived', createdAt: now, updatedAt: now },
    ] as never)
    const list = await listOwnedAthletes('user-1')
    expect(list.map((a) => a.id)).toEqual(['ath_user-1', 'ath_m_a', 'ath_m_b'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/managedAthletes.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implement `managedAthletes.ts`**

```typescript
import { db } from '../../db/db'
import type { Athlete } from '../../types'
import { v4 as uuid } from '../../utils/uuid'
import { athleteIdForOwner } from './athleteScopeMigration'
import * as syncService from '../syncService'

/**
 * Create a coach-managed athlete (no login: linkedAccountId stays null).
 * Persists locally first (local-first) and queues the remote push (Tier A).
 * NOTE: creating the managed PROFILE remotely requires migration 009c applied
 * (see plan Task 8); the athletes row itself has no such gate.
 */
export async function createManagedAthlete(ownerAccountId: string, displayName: string): Promise<Athlete> {
  const name = displayName.trim()
  if (!name) throw new Error('El nombre del atleta no puede estar vacío')
  const now = Date.now()
  const athlete: Athlete = {
    id: `ath_m_${uuid()}`,
    ownerAccountId,
    linkedAccountId: null,
    displayName: name,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.athletes.put(athlete)
  void syncService.pushAthlete(athlete)
  return athlete
}

/** Active athletes owned by this account: self first, then by display name. */
export async function listOwnedAthletes(ownerAccountId: string): Promise<Athlete[]> {
  const selfId = athleteIdForOwner(ownerAccountId)
  const rows = await db.athletes.toArray()
  return rows
    .filter((row) => row.ownerAccountId === ownerAccountId && row.status === 'active')
    .sort((a, b) => {
      if (a.id === selfId) return -1
      if (b.id === selfId) return 1
      return (a.displayName ?? '').localeCompare(b.displayName ?? '')
    })
}
```

- [ ] **Step 4: Implement `pushAthlete` en `syncService.ts`**

Junto a `pushSession` (~`:1893`):

```typescript
export async function pushAthlete(athlete: Athlete): Promise<void> {
  const userId = getUserId()
  if (!userId || athlete.ownerAccountId !== userId) return
  await upsertRow('athletes', athleteToRow(athlete) as unknown as Record<string, unknown>)
}
```

(Import de `Athlete` ya existe vía types; `athleteToRow` ya está importado. `upsertRow` para `athletes` usa el path genérico `.upsert(payload)` por PK `id` y hereda cola/retry; el ensure se salta por `table === 'athletes'`.)

- [ ] **Step 5: Run tests + full suite + build**

Run: `npx vitest run src/services/__tests__/managedAthletes.test.ts && npm test && npm run build`
Expected: verdes.

- [ ] **Step 6: Commit** (no-op)

---

## Task 8: Rollout operacional (orden estricto — sin código)

**Files:** ninguno (checklist).

- [ ] **Step 1:** Deploy de **Parte 1** (athlete-aware core) + smoke single-athlete en prod (prioridad 1 del CLAUDE.md). Sin esto, NO seguir.
- [ ] **Step 2:** Correr `supabase/009a_athlete_profiles_preflight.sql` → null debt = 0 y duplicados = 0. Si hay deuda, resolverla antes (backfill manual del `athlete_id` faltante).
- [ ] **Step 3:** Aplicar `supabase/009b_athlete_profiles_expand.sql` (unique compuesto; el viejo sigue vivo).
- [ ] **Step 4:** Commit (owner) + deploy de **Parte 2a** (Tasks 1–7). El cliente nuevo usa `onConflict: 'user_id,athlete_id'`, que requiere 009b ya aplicada.
- [ ] **Step 5:** Confirmar bundle nuevo en prod (hard refresh; bump del SW si aplica). Smoke: **editar y guardar el perfil self** sin error (el upsert compuesto matchea la fila existente).
- [ ] **Step 6:** Aplicar `supabase/009c_athlete_profiles_contract.sql` (`athlete_id not null` + drop del unique viejo; el DO-guard verifica 009b + null debt antes del `alter column`).
- [ ] **Step 7:** Smoke post-contract: crear un atleta gestionado vía consola dev (`createManagedAthlete(...)` + `switch` manual con `persistAthleteSelection` + reload) y guardar su perfil → **sin `23505`**, dos filas en `athlete_profiles` remoto, la del self intacta. Este smoke se vuelve trivial con la UI de la Parte 2b; si se prefiere, diferirlo al cierre de 2b.
- [ ] **Step 8:** Anotar resultado en el roadmap. Recién aquí queda habilitado crear gestionados reales.

> **Gate heredado para la Parte 2b — day/week uniques legacy.** `008b` fue ADITIVO: los uniques legacy `(user_id, date)` / `(user_id, week_start_date)` siguen vivos (y `migrateLocalDataToCloud` aún usa esos `onConflict`). Con dos atletas bajo la misma cuenta, el SEGUNDO day log de una misma fecha (o week summary de una misma semana) choca `23505` remoto. `009` solo destraba PERFILES multi-atleta; **no habilitar check-ins/week summaries multi-atleta reales** hasta cerrar el contract equivalente para `day_logs`/`week_summaries` (mini expand/contract análogo a 009, fuera del scope de 2a). Anotarlo en el roadmap como prerequisito de la 2b operativa.

---

## Self-Review Notes

- **Spec coverage (§3.2, §3.4):** pipeline de perfiles en 4 capas → Tasks 1 (mappers/ids), 2 (local), 3 (push por grupo + onConflict compuesto), 4 (merge + migrate por grupo); `009` mini expand/contract con preflight como gate duro → Tasks 5 y 8; `ensureRemoteAthlete(userId, athleteId?)` con fail-sin-child → Task 6; `createManagedAthlete`/`pushAthlete`/`listOwnedAthletes` con cola Tier A → Task 7 (`athletes` ya está en `SupabaseTable`/`ENTITY_TIER` — verificado, no hay que extender tipos). Fuera de 2a (van en 2b): allowlist §3.1, `switchActiveAthlete` + resets §3.5, roster/switcher UI §3.5/§3.7.
- **Riesgo mayor cubierto:** el repair per-usuario que borra "perdedores" queda confinado por grupo en TODOS sus callers (`upsertAthleteProfileRow`, `persistAthleteProfileRow`, `mergeAthleteProfile`, `migrateLocalDataToCloud`) — Tasks 3–4, con tests que asertan cero deletes cross-grupo.
- **Reset lock account-level:** decisión explícita (spec §3.2 "dentro de cada grupo" se interpreta para dedup/repair; el full reset sigue siendo nuclear por cuenta) — documentada en el código de Task 4.
- **Type consistency:** `athleteProfileGroupKey(athleteId, selfAthleteId)`, `groupAthleteProfileRows(rows, selfAthleteId)`, `ATHLETE_PROFILE_SELF_GROUP`, `rowToAthleteProfile(row, selfAthleteId)` (requerido), `groupingSelfAthleteId(userId)`, `fetchAthleteProfileRowsForGroup(userId, groupKey)`, `ensureRemoteAthlete(userId, athleteId?)`, `createManagedAthlete(ownerAccountId, displayName)`, `listOwnedAthletes(ownerAccountId)`, `pushAthlete(athlete)` — usados idéntico entre tasks.
- **Regresión single-athlete:** un solo grupo (`self`) hace de cada cambio la identidad del flujo actual; el remote id del self no cambia; `onConflict` compuesto matchea la fila única existente post-009b.
- **Ajustes de review (2026-07-03):** (1) el patch de `upsertAthleteProfile` ya no puede re-scopear — `athleteId` fuera del tipo + strip runtime + test; (2) invariante remoto `athlete_id` no-null en `athleteProfileToRow` Y en `createAthleteProfileFullResetRow` (el marker con NULL insertaría una segunda fila self post-009c en vez de conflictuar); (3) `rowToAthleteProfile(row, selfAthleteId)` requerido, sin default — y el grouping en syncService usa `groupingSelfAthleteId(userId)` (`getSelfAthleteId() ?? athleteIdForOwner(userId)`) para no depender del timing de hidratación; (4) un gestionado local sin remoto respeta `allowDeletes`/`deleteBeforeTs` antes de pushearse (no resucita deletes); (5) snippet del test de Task 1 con `ATHLETE_PROFILE_LOCAL_ID` directo.
- **Ajustes de review, ronda 3 (2026-07-03):** (1) el auto-repair del drain de cola (~`:999-1027`) y `repairAthleteProfileDuplicates` (~`:3328`) dejan de ser cross-grupo — la cola filtra por `profileGroupOf(op.payload, op.userId)` y el repair manual agrupa y repara solo buckets con >1 filas, con test (self + gestionado ≠ duplicados, cero deletes); (2) el branch "self remoto vacío" de `mergeSelfProfileGroup` pasa de `db.athleteProfiles.clear()` a `delete(ATHLETE_PROFILE_LOCAL_ID)` — `clear()` queda solo en reset lock/full reset account-level, con test; (3) gate heredado documentado en Task 8: los uniques legacy de `day_logs`/`week_summaries` (aditivos en `008b`) bloquean check-ins multi-atleta reales hasta su propio contract (prerequisito de la 2b operativa, fuera del scope de 2a).
- **Ajustes de review, ronda 4 (2026-07-04):** (1) `009c` deja de ser solo contract de índice: después del guard de null debt aplica `alter column athlete_id set not null`, evitando que clientes stale/manuales vuelvan a insertar perfiles con `NULL` tras eliminar el unique legacy; (2) backup/import pasa a incluir `athletes` con merge por `updatedAt`, preview/counts en Settings y compatibilidad con backups v1-v3 sin esa tabla (`athletes: []`); (3) parser de `athleteProfiles` conserva `athleteId`, `onboardingDeferredAt`, `planWizardConfig` y `goalEvents.eventType/objective/competitiveLevel`; (4) el patch del onboarding se extrae a helper puro testeado para torneo/evento, disponibilidad, lesiones y fuerza/1RM.
- **Ajustes de review, ronda 2 (2026-07-03):** (1) el ensure de gestionados se cablea en los TRES paths de escritura remota — `upsertRow`, drain de cola (~`:938`; el drain hace upsert directo y sin ensure un child encolado pegaría `23503`) y `migrateLocalDataToCloud` (hoy solo asegura el self; se asegura cada atleta local del owner antes de los batch upserts) — con test de cola que aserta el orden ensure→child; (2) `athleteProfileToRow` deriva `athlete_id` SOLO del id local (sentinel → `athleteIdForOwner`; otro → `localId`) — `profile.athleteId` ya no participa, con tests de mismatch (`default`+`ath_m_1` sale self; `ath_m_1`+`ath_m_2` sale `ath_m_1`); (3) snippet del reset marker actualizado a la firma nueva `getAthleteProfileRemoteId(userId, ATHLETE_PROFILE_LOCAL_ID)`.

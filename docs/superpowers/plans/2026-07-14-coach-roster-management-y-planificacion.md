# Coach Roster Management + Tab Planificación — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Rev. 5** — cierra la cobertura de pulls fuera de `syncService.ts`: la auditoría de leases abarca TODOS los módulos que combinan lectura remota + escritura Dexie (`pollPlanGeneration`, `pullReadiness`, `pullWorkouts`), primitiva plural `withAthleteWriteLeases` para el reemplazo atómico multi-atleta de `replaceMembershipCache`, ciclo de vida explícito del espejo en memoria (reset para tests y para `clearAllAppLocalStorage`), validación runtime de la precondición de `deleteManagedAthleteRemote`, y limpieza de la nota obsoleta de Task 6.
(Rev. 4: key-por-intento, contrato de precondición, auditoría de pulls en syncService, `opTarget` en drain, `readKey` discriminado, spec alineado. Rev. 3: lease TOCTOU, single-tab declarado, `fetchAll` real. Rev. 2: durabilidad verificada, barrera exclusiva, abort acotado, `scopeAthleteId`, tests de dominio.)

**Goal:** Archivar/restaurar/eliminar definitivamente atletas gestionados no reclamados, y darle contenido real al tab Planificación de `/coach` (vista semanal read-only multi-atleta con hidratación remota explícita).

**Architecture:** Tombstones durables por clave individual (localStorage, escritura verificada) + entry-guards en syncService (upsertRow / session-completion / pulls) + barrera exclusiva por atleta con espera de ops en vuelo + API pública `deleteManagedAthleteRemote` (`deleted | durably_queued | failed`, sin drain interno, enqueue verificado). El dominio (`managedAthletes.ts`) orquesta dos fases (A reversible / B destructiva post-éxito). Planificación usa `coachScopedReads.ts`: lecturas Dexie por `athleteId` explícito + pull remoto on-demand, sin tocar `activeScopeFilter` ni el contexto activo.

**Tech Stack:** React + TypeScript + Vite, Dexie (v17, sin bump), Supabase, Zustand, Vitest (fake-indexeddb + `renderToStaticMarkup`), date-fns.

**Spec:** `docs/superpowers/specs/2026-07-14-coach-roster-management-y-planificacion-design.md` (rev. 3 aprobada).

## Global Constraints

- **Commits los hace el owner.** Al final de cada task, detenerse y pedir el commit; NUNCA ejecutar `git add`/`git commit` sin pedido explícito. Los pasos "Commit" muestran el mensaje sugerido.
- Nunca el literal `'default'` fuera de `activeAthlete.ts` (hay guard test).
- Ninguna migración Supabase nueva; Dexie queda en v17 (sin bump). `scopeAthleteId` en `OfflineOp` es metadata local de la cola (localStorage), NO un cambio de schema.
- Las lecturas nuevas de `coachScopedReads` NO pasan por `activeScopeFilter` por diseño explícito del spec.
- Filas legacy/unscoped pertenecen SOLO al self.
- No tocar `promptBuilder.ts`. No agregar dependencias.
- Copy de UI en español, tuteo, sin promesas médicas.
- Elegibilidad archivar/restaurar/borrar: owner + no-self + `linkedAccountId == null` + (para borrar) `status === 'archived'`.
- **Invariantes de cola y guards (rev. 2):**
  - Los guards de tombstone viven en las FUNCIONES DE ENTRADA (`upsertRow`, entrada de session-completion, pulls): ninguna op athlete-scoped NUEVA comienza con tombstone presente.
  - `enqueue` NO tiene guard de tombstone: todos sus call sites son paths de retry/offline de ops ya admitidas, que DEBEN poder re-encolarse (con `failed` ese retry persiste; con éxito la Fase B lo suprime).
  - El delete canónico (`table='athletes'`, `action='delete'`, `payload.id === athleteId`) siempre puede encolarse y drenar; la supresión de Fase B lo preserva; el drain exitoso lo consume pero conserva el tombstone.
  - **Ownership del tombstone:** lo crea y lo limpia EXCLUSIVAMENTE el dominio (`deleteManagedAthletePermanently`, Fase A, con su token). `deleteManagedAthleteRemote` tiene como PRECONDICIÓN un tombstone verificado ya creado por el caller y NUNCA crea ni limpia tombstones — `failed` garantiza cero cambio de estado de tombstones por parte de la función. (Excepción acotada: el drain, al consumir el delete canónico, registra su propio tombstone-por-intento vía `rememberDeleteTombstoneForTable` — nunca se limpia, por diseño.)
  - `durably_queued` solo se devuelve si la op en cola quedó VERIFICADA en storage (read-back); si no, `failed` y cero Fase B.
  - **Alcance de las garantías de concurrencia: SINGLE-TAB.** La barrera exclusiva, el tracking en vuelo y los leases viven en memoria de la pestaña; la cola de sync ya es una sola key de localStorage con read-modify-write entre pestañas (trade-off preexistente de todo el sistema). Dos pestañas operando el borrado a la vez es un edge documentado y aceptado, mitigado en su peor caso por el tombstone **key-por-intento** (el rollback de un intento elimina solo SU key; el tombstone de un delete activo en otra pestaña sobrevive). No se introduce Web Locks en este incremento.
  - **Todo write local proveniente de un pull** pasa por `withAthleteWriteLease`: chequeo de tombstone + registro en vuelo SIN ceder control antes de iniciar la escritura — cierra la carrera chequeo→await→put frente a un delete que arranca entremedio. La cobertura es EXHAUSTIVA por auditoría mecánica sobre TODOS los módulos que combinan lectura remota + escritura Dexie (grep de `.put(`/`.bulkPut(`/`replaceMembershipCache(`), no por enumeración ni limitada a syncService: incluye merges core, coach notes, plans/weeks, `pullSessionsForDateRange`, `pullAthletes`, `pullMemberships` (batch plural), el polling de generación (`fetchPlanGenerationSnapshot`), `pullReadiness`, `pullWorkouts` y `pullWeekSessionsForAthlete` (Task 5f + Task 11).
- Tests: correr el archivo afectado con `npx vitest run <path>`; al cerrar cada task, el archivo debe pasar completo. Los tests SIEMPRE se escriben y se ven fallar antes de implementar.
- Verificación final: `npm run lint && npm test && npm run build`.

---

### Task 1: Tombstones durables de borrado de atleta (clave individual, escritura verificada)

**Files:**
- Create: `src/services/sync/athleteDeleteTombstones.ts`
- Modify: `src/services/appMaintenance.ts` — `clearAllAppLocalStorage` llama `clearAllAthleteDeleteTombstones()` (las keys son durables y el wipe por prefijos no resetea el espejo)
- Test: `src/services/sync/__tests__/athleteDeleteTombstones.test.ts`

**Interfaces:**
- Consumes: nada (módulo puro sobre localStorage).
- Produces:
  - `rememberAthleteDeleteTombstone(userId: string, athleteId: string): string` — crea una key NUEVA **por intento** y devuelve su **token**; **lanza** si la escritura no se pudo verificar (read-back). Dos intentos (dos pestañas, o dominio+drain) generan keys distintas: nadie comparte token.
  - `clearAthleteDeleteTombstone(userId: string, athleteId: string, token: string): boolean` — token **requerido**: elimina exclusivamente SU key (`<prefix>:<userId>:<athleteId>:<token>`), verificado con read-back. `true` solo si esa key quedó realmente fuera; `false` si el remove falló, quedó fantasma, o la lectura de verificación no fue posible.
  - `hasAthleteDeleteTombstone(userId: string, athleteId: string): boolean` — `true` mientras exista CUALQUIER key del par user/atleta.
  - `hasAthleteDeleteTombstoneForAthlete(athleteId: string): boolean`
  - `clearAllAthleteDeleteTombstones(): boolean` — **ciclo de vida explícito del espejo**: recorre las keys con el prefijo, elimina cada una VERIFICADA y solo entonces la retira del espejo; las no verificables permanecen en ambos lados (fail-safe). `true` si todo quedó fuera. La usan los tests (`beforeEach`, junto a `localStorage.clear()`) y `clearAllAppLocalStorage` (limpieza local/logout/import).
  - `ATHLETE_DELETE_TOMBSTONE_PREFIX = 'entrenador_athlete_delete_tombstone_v1'`
- **Diseño (key-por-intento):** cada intento de borrado escribe SU PROPIA key `<prefix>:<userId>:<athleteId>:<token>` (token sin `:`, p. ej. `<timestamp>-<base36>`). No hay `getItem→setItem` compartido que pueda pisarse entre pestañas, y el rollback de un intento elimina solo su key: si la pestaña A tiene un delete activo y la B hace rollback, el tombstone de A sigue presente (test explícito). Ningún componente de la key se deriva de leer el estado previo.
- **Espejo en memoria (fail-open de storage):** el módulo mantiene un `Set` en memoria con las keys recordadas por esta pestaña (y las retira solo en un clear VERIFICADO). Los `has*` consultan PRIMERO el espejo. Comportamiento definido: con storage ilegible Y tombstone puesto por OTRA sesión, `has*` degrada a `false` — fail-open cross-sesión, edge aceptado coherente con la garantía single-tab.

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/sync/__tests__/athleteDeleteTombstones.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ATHLETE_DELETE_TOMBSTONE_PREFIX,
  clearAllAthleteDeleteTombstones,
  clearAthleteDeleteTombstone,
  hasAthleteDeleteTombstone,
  hasAthleteDeleteTombstoneForAthlete,
  rememberAthleteDeleteTombstone,
} from '../athleteDeleteTombstones'

describe('athleteDeleteTombstones', () => {
  beforeEach(() => {
    vi.restoreAllMocks() // los mocks de Storage deben caer ANTES de limpiar
    localStorage.clear()
    clearAllAthleteDeleteTombstones() // resetea también el espejo en memoria
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('remember + has por user y atleta, con key por intento', () => {
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(false)
    const token = rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(true)
    expect(hasAthleteDeleteTombstone('user-2', 'ath_m_a')).toBe(false)
    expect(localStorage.getItem(`${ATHLETE_DELETE_TOMBSTONE_PREFIX}:user-1:ath_m_a:${token}`)).toBeTruthy()
  })

  it('cada intento crea SU key: dos remembers → dos tokens distintos y dos keys vivas', () => {
    const tokenA = rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    const tokenB = rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    expect(tokenA).not.toBe(tokenB)
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(true)
  })

  it('cross-attempt: el rollback de B NO retira el tombstone del delete activo de A', () => {
    rememberAthleteDeleteTombstone('user-1', 'ath_m_a')           // intento A (activo)
    const tokenB = rememberAthleteDeleteTombstone('user-1', 'ath_m_a') // intento B (fallará)
    expect(clearAthleteDeleteTombstone('user-1', 'ath_m_a', tokenB)).toBe(true)
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(true) // la key de A sigue viva
  })

  it('hasAthleteDeleteTombstoneForAthlete ignora el userId', () => {
    rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    expect(hasAthleteDeleteTombstoneForAthlete('ath_m_a')).toBe(true)
    expect(hasAthleteDeleteTombstoneForAthlete('ath_m_b')).toBe(false)
  })

  it('clear retira solo la key de su intento y atleta', () => {
    const tokenA = rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    rememberAthleteDeleteTombstone('user-1', 'ath_m_b')
    expect(clearAthleteDeleteTombstone('user-1', 'ath_m_a', tokenA)).toBe(true)
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(false)
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_b')).toBe(true)
  })

  it('remember LANZA si el storage no persiste (quota/bloqueado)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => rememberAthleteDeleteTombstone('user-1', 'ath_m_a')).toThrow()
  })

  it('remember LANZA si el read-back no devuelve el valor (persistencia fantasma)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})
    expect(() => rememberAthleteDeleteTombstone('user-1', 'ath_m_a')).toThrow()
  })

  it('clear con token inexistente devuelve false sin tocar nada', () => {
    rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    expect(clearAthleteDeleteTombstone('user-1', 'ath_m_a', 'token-ajeno')).toBe(false)
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(true)
  })

  it('clear devuelve false si removeItem falla silenciosamente (read-back)', () => {
    const token = rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {})
    expect(clearAthleteDeleteTombstone('user-1', 'ath_m_a', token)).toBe(false)
  })

  it('clear devuelve false si la LECTURA de verificación falla, y conserva el espejo', () => {
    const token = rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(clearAthleteDeleteTombstone('user-1', 'ath_m_a', token)).toBe(false)
    // el espejo sigue: los guards de esta pestaña ven el tombstone aunque el storage esté roto
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(true)
  })

  it('espejo en memoria: con storage ilegible, has* sigue viendo tombstones de ESTA sesión', () => {
    rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(true)
    expect(hasAthleteDeleteTombstoneForAthlete('ath_m_a')).toBe(true)
  })

  it('clearAll elimina keys y espejo verificados: has* queda en false', () => {
    rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    rememberAthleteDeleteTombstone('user-2', 'ath_m_b')
    expect(clearAllAthleteDeleteTombstones()).toBe(true)
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(false)
    expect(hasAthleteDeleteTombstoneForAthlete('ath_m_b')).toBe(false)
  })

  it('clearAll conserva el espejo de lo que NO pudo verificar', () => {
    rememberAthleteDeleteTombstone('user-1', 'ath_m_a')
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {})
    expect(clearAllAthleteDeleteTombstones()).toBe(false)
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(true) // espejo intacto
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/sync/__tests__/athleteDeleteTombstones.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Write the implementation**

```typescript
// src/services/sync/athleteDeleteTombstones.ts
/**
 * Tombstones durables de borrado de atleta (spec rev.3 §Barrera; plan rev.4).
 * - KEY POR INTENTO: cada intento de borrado escribe su propia key
 *   `<prefix>:<userId>:<athleteId>:<token>`. Nada se deriva de leer el estado
 *   previo (sin getItem→setItem compartido), y el rollback de un intento borra
 *   SOLO su key: el tombstone de un delete activo en otra pestaña sobrevive.
 * - `remember` VERIFICA la escritura (read-back) y lanza si no persistió:
 *   `durably_queued` no puede apoyarse en un tombstone fantasma.
 * - Lecturas distinguen "ausente" de "ilegible" ({ok,value}): `clear` NUNCA
 *   afirma éxito si no pudo verificar; ante storage ilegible conserva el espejo.
 * - Espejo en memoria: los guards de esta pestaña ven sus tombstones aunque el
 *   storage se vuelva ilegible. Tombstones de OTRA sesión con storage ilegible
 *   degradan a false (edge single-tab aceptado).
 * El tombstone persiste tras el borrado exitoso (hace el retry idempotente).
 */
export const ATHLETE_DELETE_TOMBSTONE_PREFIX = 'entrenador_athlete_delete_tombstone_v1'

const memoryMirror = new Set<string>()

function pairPrefix(userId: string, athleteId: string): string {
  return `${ATHLETE_DELETE_TOMBSTONE_PREFIX}:${userId}:${athleteId}:`
}

type ReadResult = { ok: true; value: string | null } | { ok: false }

function readKey(key: string): ReadResult {
  try {
    return { ok: true, value: localStorage.getItem(key) }
  } catch {
    return { ok: false }
  }
}

export function rememberAthleteDeleteTombstone(userId: string, athleteId: string): string {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}` // sin ':' — la key se parsea por segmentos
  const key = `${pairPrefix(userId, athleteId)}${token}`
  localStorage.setItem(key, '1') // si lanza (quota), propaga
  const check = readKey(key)
  if (!check.ok || check.value == null) {
    throw new Error('No se pudo persistir el tombstone de borrado del atleta.')
  }
  memoryMirror.add(key)
  return token
}

/**
 * Retira exclusivamente la key de ESTE intento (token requerido), verificado.
 * false si la key no existe, el remove falló/quedó fantasma, o no se pudo
 * verificar la lectura — en ese caso el espejo se conserva (fail-safe).
 */
export function clearAthleteDeleteTombstone(userId: string, athleteId: string, token: string): boolean {
  const key = `${pairPrefix(userId, athleteId)}${token}`
  const before = readKey(key)
  if (!before.ok) return false        // storage ilegible: no afirmar nada
  if (before.value == null) return false // este intento no tiene tombstone
  try {
    localStorage.removeItem(key)
  } catch {
    return false // dejarlo puesto es seguro: bloquea escrituras
  }
  const after = readKey(key)
  if (!after.ok || after.value != null) return false // no verificable o removeItem silencioso
  memoryMirror.delete(key)
  return true
}

export function hasAthleteDeleteTombstone(userId: string, athleteId: string): boolean {
  const prefix = pairPrefix(userId, athleteId)
  for (const key of memoryMirror) {
    if (key.startsWith(prefix)) return true
  }
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (key?.startsWith(prefix)) return true
    }
    return false
  } catch {
    return false
  }
}

export function hasAthleteDeleteTombstoneForAthlete(athleteId: string): boolean {
  const matches = (key: string) => {
    if (!key.startsWith(ATHLETE_DELETE_TOMBSTONE_PREFIX)) return false
    // key = <prefix>:<userId>:<athleteId>:<token> — segmentos sin ':' internos
    return key.split(':')[2] === athleteId
  }
  for (const key of memoryMirror) {
    if (matches(key)) return true
  }
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (key && matches(key)) return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Ciclo de vida del espejo: elimina TODAS las keys de tombstone (verificadas
 * una a una) y retira del espejo solo las verificadas. Para tests (beforeEach)
 * y para la limpieza local completa (clearAllAppLocalStorage / logout / import).
 */
export function clearAllAthleteDeleteTombstones(): boolean {
  let allCleared = true
  const doomed: string[] = []
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (key?.startsWith(ATHLETE_DELETE_TOMBSTONE_PREFIX)) doomed.push(key)
    }
  } catch {
    return false // storage ilegible: no afirmar nada, espejo intacto
  }
  for (const key of new Set([...doomed, ...memoryMirror])) {
    try {
      localStorage.removeItem(key)
    } catch {
      allCleared = false
      continue
    }
    const after = readKey(key)
    if (after.ok && after.value == null) {
      memoryMirror.delete(key)
    } else {
      allCleared = false
    }
  }
  return allCleared
}
```

Integración en `appMaintenance.ts`: `clearAllAppLocalStorage` llama `clearAllAthleteDeleteTombstones()` además de su limpieza por prefijos (las keys de tombstone tienen prefijo propio y el espejo en memoria no se resetea solo). Nota para el resto del plan: TODO test que haga `localStorage.clear()` y toque tombstones (Tasks 4-6, 9) debe llamar también `clearAllAthleteDeleteTombstones()` en su `beforeEach`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/sync/__tests__/athleteDeleteTombstones.test.ts src/services/__tests__/appMaintenance.test.ts`
Expected: PASS (13 tests nuevos + la suite de appMaintenance en verde, que ahora llama `clearAllAthleteDeleteTombstones` desde `clearAllAppLocalStorage`).

- [ ] **Step 5: Commit (lo hace el owner)**

Mensaje sugerido: `feat(coach): tombstones durables de borrado de atleta con escritura verificada`

---

### Task 2: `scopeAthleteId` en OfflineOp + supresión de cola por atleta

**Files:**
- Modify: `src/services/syncUtils.ts` (campo opcional en `OfflineOp`)
- Modify: `src/services/sync/syncQueue.ts` (`clearQueuedOpsForAthlete`)
- Modify: `src/services/syncService.ts` (los dos enqueues de `session_completion` — L2019/L2036 — estampan `scopeAthleteId`)
- Test: `src/services/sync/__tests__/syncQueue.athleteSuppression.test.ts`

**Interfaces:**
- Consumes: `loadQueue()`, `saveQueue()`, `OfflineOp`.
- Produces:
  - `OfflineOp.scopeAthleteId?: string` — metadata local: atleta al que pertenece la op cuando el payload no lo trae (`session_completion` solo guarda `p_session_id`).
  - `clearQueuedOpsForAthlete(userId: string, athleteId: string): void` — elimina ops del user que matcheen `payload.athlete_id === athleteId` **o** `scopeAthleteId === athleteId` **o** (`table='athletes'` con `payload.id === athleteId`), EXCEPTO el delete canónico.
- **Exclusión documentada:** ops `delete` de tablas hijas (payload `{id}` sin athlete_id ni scope) no se suprimen — son inocuas: borran remotamente filas que el cascade eliminará igual.

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/sync/__tests__/syncQueue.athleteSuppression.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { clearQueuedOpsForAthlete, loadQueue, saveQueue } from '../syncQueue'
import type { OfflineOp } from '../../syncUtils'

function op(partial: Partial<OfflineOp>): OfflineOp {
  return {
    userId: 'user-1',
    table: 'sessions',
    action: 'upsert',
    payload: {},
    enqueuedAt: Date.now(),
    ...partial,
  } as OfflineOp
}

describe('clearQueuedOpsForAthlete', () => {
  beforeEach(() => { localStorage.clear() })

  it('elimina ops del atleta (payload y scope) pero preserva delete canónico y ops ajenas', () => {
    saveQueue([
      op({ payload: { id: 's1', athlete_id: 'ath_m_a' } }),                                          // fuera
      op({ action: 'session_completion', payload: { p_session_id: 's1' }, scopeAthleteId: 'ath_m_a' }), // fuera
      op({ table: 'athletes', action: 'upsert', payload: { id: 'ath_m_a' } }),                       // fuera
      op({ table: 'athletes', action: 'delete', payload: { id: 'ath_m_a' } }),                       // QUEDA (canónico)
      op({ payload: { id: 's2', athlete_id: 'ath_m_b' } }),                                          // queda
      op({ userId: 'user-2', payload: { id: 's3', athlete_id: 'ath_m_a' } }),                        // queda (otro user)
      op({ action: 'delete', payload: { id: 's-old' } }),                                            // queda (delete hijo sin scope: inocuo)
    ])

    clearQueuedOpsForAthlete('user-1', 'ath_m_a')

    const rest = loadQueue()
    expect(rest).toHaveLength(4)
    expect(rest.some((item) => item.table === 'athletes' && item.action === 'delete' && item.payload.id === 'ath_m_a')).toBe(true)
    expect(rest.some((item) => item.action === 'session_completion')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/sync/__tests__/syncQueue.athleteSuppression.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

(a) En `syncUtils.ts`, agregar a `OfflineOp`:

```typescript
export interface OfflineOp {
  userId: string
  table: SupabaseTable
  action: 'upsert' | 'delete' | 'session_completion'
  payload: Record<string, unknown>
  enqueuedAt: number
  retryCount?: number
  lastErrorCategory?: SyncErrorCategory
  /**
   * Atleta dueño de la op cuando el payload no lo trae (p. ej. session_completion
   * solo guarda p_session_id). Metadata local de la cola; NO viaja a Supabase.
   * Lo usa clearQueuedOpsForAthlete (borrado duro de atleta, plan 2026-07-14).
   */
  scopeAthleteId?: string
}
```

(b) En `syncQueue.ts`:

```typescript
/**
 * Fase B del borrado duro (spec rev.3): elimina de la cola toda op del atleta,
 * EXCEPTO el delete canónico de `athletes` — con `durably_queued` esa op ES el
 * borrado remoto; suprimirla dejaría el atleta vivo en Supabase para siempre.
 * Los deletes hijos sin scope no se suprimen: son inocuos (el cascade los cubre).
 */
export function clearQueuedOpsForAthlete(userId: string, athleteId: string): void {
  const queue = loadQueue()
  const remaining = queue.filter((op) => {
    if (op.userId !== userId) return true
    const isCanonicalDelete = op.table === 'athletes' && op.action === 'delete' && op.payload.id === athleteId
    if (isCanonicalDelete) return true
    if (op.payload.athlete_id === athleteId) return false
    if (op.scopeAthleteId === athleteId) return false
    if (op.table === 'athletes' && op.payload.id === athleteId) return false
    return true
  })
  if (remaining.length !== queue.length) saveQueue(remaining)
}
```

(c) En `syncService.ts`, los dos `enqueue({ userId, table: 'sessions', action: 'session_completion', ... })` (L2019/L2036) agregan `scopeAthleteId: session.athleteId` (la variable `session` está en scope en ambos call sites; verificar el nombre local exacto).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/sync/__tests__/syncQueue.athleteSuppression.test.ts`
Expected: PASS. También: `npx vitest run src/services/sync/` — verde (loadQueue valida shape; `scopeAthleteId` opcional no rompe el filter).

- [ ] **Step 5: Commit (lo hace el owner)**

Mensaje sugerido: `feat(sync): scopeAthleteId en OfflineOp y supresión de cola por atleta`

---

### Task 3: Limpieza de chat session por atleta explícito

**Files:**
- Modify: `src/utils/chatSession.ts`
- Test: `src/utils/__tests__/chatSession.forAthlete.test.ts`

**Interfaces:**
- Produces: `clearStoredChatSessionIdForAthlete(athleteId: string): void` — borra `coach_chat_session_id:<athleteId>` y `coach_chat_session_local_only:<athleteId>`. NO toca las keys legacy del self.

**Contexto del bug (spec rev.2 hallazgo 6):** `clearStoredChatSessionId()` deriva la key del atleta ACTIVO; el flujo de borrado ya hizo switch al self, así que usarla borraría la key legacy del owner.

- [ ] **Step 1: Write the failing test**

```typescript
// src/utils/__tests__/chatSession.forAthlete.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/athlete/activeAthlete', () => ({
  getActiveAthleteId: vi.fn(() => null),
  getSelfAthleteId: vi.fn(() => null),
}))

import { clearStoredChatSessionIdForAthlete, CHAT_SESSION_KEY } from '../chatSession'

describe('clearStoredChatSessionIdForAthlete', () => {
  beforeEach(() => { localStorage.clear() })

  it('borra solo las keys sufijadas del atleta pedido', () => {
    localStorage.setItem(CHAT_SESSION_KEY, 'legacy-self')
    localStorage.setItem(`${CHAT_SESSION_KEY}:ath_m_a`, 'chat-a')
    localStorage.setItem('coach_chat_session_local_only:ath_m_a', '1')
    localStorage.setItem(`${CHAT_SESSION_KEY}:ath_m_b`, 'chat-b')

    clearStoredChatSessionIdForAthlete('ath_m_a')

    expect(localStorage.getItem(CHAT_SESSION_KEY)).toBe('legacy-self')
    expect(localStorage.getItem(`${CHAT_SESSION_KEY}:ath_m_a`)).toBeNull()
    expect(localStorage.getItem('coach_chat_session_local_only:ath_m_a')).toBeNull()
    expect(localStorage.getItem(`${CHAT_SESSION_KEY}:ath_m_b`)).toBe('chat-b')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/chatSession.forAthlete.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation** (después de `clearStoredChatSessionId`)

```typescript
/**
 * Borra la sesión de chat de UN atleta gestionado por id explícito.
 * `clearStoredChatSessionId()` deriva la key del atleta ACTIVO; en el borrado
 * duro el flujo ya volvió al self y esa función borraría la key legacy del
 * owner. Esta calcula la key sufijada desde el parámetro.
 */
export function clearStoredChatSessionIdForAthlete(athleteId: string): void {
  const storage = getStorage()
  if (!storage) return
  storage.removeItem(`${CHAT_SESSION_KEY}:${athleteId}`)
  storage.removeItem(`${CHAT_SESSION_LOCAL_ONLY_KEY}:${athleteId}`)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/chatSession.forAthlete.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (lo hace el owner)**

Mensaje sugerido: `feat(chat): limpieza de chat session por atleta explícito`

---

### Task 4: syncService — drain de `athletes` + tombstone + filtrado de TODOS los pulls

**Files:**
- Create: `src/services/sync/remoteRowAthleteId.ts` — helper puro compartido (extraído de `getRemoteRowAthleteId`, hoy privado de syncService)
- Modify: `src/services/sync/syncSupabase.ts` — **`fetchAll` vive acá (L101)**, no en syncService: filtro por página SIN romper la paginación
- Modify: `src/services/syncService.ts`:
  - drain delete branch (~L982): `owner_account_id` para `athletes`
  - `rememberDeleteTombstoneForTable` (~L3414): caso `athletes`
  - `getRemoteRowAthleteId` pasa a reexportar/usar el helper compartido
  - `pullAthletes` (~L2325): filtro de atletas tombstoned
  - `pullMemberships` / merge de `athlete_profiles` / `athlete_coach_notes`: mismo filtro
- Test: `src/services/__tests__/syncServiceAthleteDelete.test.ts` (nuevo archivo enfocado) + test de paginación en `src/services/sync/__tests__/` si el harness de syncSupabase lo permite

**Interfaces:**
- Consumes: Task 1 (`rememberAthleteDeleteTombstone`, `hasAthleteDeleteTombstone`, `hasAthleteDeleteTombstoneForAthlete`).
- Produces (comportamiento):
  - El drain de un delete encolado de `athletes` filtra por `owner_account_id`.
  - Borrar `athletes` registra tombstone.
  - **Ningún pull re-materializa datos de un atleta tombstoned**: ni la fila `athletes`, ni hijos (sessions/dayLogs/weekSummaries/chat/proposals vía `fetchAll`), ni perfiles/memberships/notes.

- [ ] **Step 1: Write the failing tests**

Crear `src/services/__tests__/syncServiceAthleteDelete.test.ts`. Replicar el harness mínimo de `syncService.test.ts` (mocks de `../auth`, `../appMaintenance`, `../../store/useAuthStore`, `../../db/db` y el fake supabase con registro de `deleteCalls`/`selectCalls` y filtros — copiar el patrón, no importar sus helpers). Tests (contratos exactos a verificar):

```typescript
it('drain de un delete encolado de athletes filtra por owner_account_id y conserva tombstone', async () => {
  // seed cola: { userId:'user-1', table:'athletes', action:'delete', payload:{ id:'ath_m_a' } }
  // online; disparar drain
  // assert: deleteCalls contiene { table:'athletes', filtro owner_account_id='user-1' } y NINGÚN filtro user_id
  // assert: hasAthleteDeleteTombstone('user-1','ath_m_a') === true
  // assert: cola vacía (delete consumido)
})

it('pullAthletes no re-materializa un atleta con tombstone', async () => {
  // tombstone user-1/ath_m_a; select athletes devuelve [ath_m_a, ath_m_b]
  // assert: db.athletes recibe solo ath_m_b
})

it('mergeSessions (y merges hijos vía fetchAll) descartan filas remotas de un atleta tombstoned', async () => {
  // tombstone ath_m_a; remoto sessions devuelve una fila athlete_id='ath_m_a' y otra 'ath_m_b'
  // correr el sync de sesiones
  // assert: db.sessions NO contiene la de ath_m_a; SÍ la de ath_m_b
})

it('el merge de athlete_profiles y el pull de memberships descartan filas de atleta tombstoned', async () => {
  // mismo patrón para athlete_profiles y athlete_memberships
})

it('fetchAll: el filtro por página NO rompe la paginación', async () => {
  // página 1: FETCH_PAGE_SIZE filas, mayoría del atleta tombstoned (quedan pocas vivas);
  // página 2: filas vivas restantes (< FETCH_PAGE_SIZE)
  // assert: se pidieron DOS ranges (la paginación se decidió con el tamaño sin filtrar)
  // assert: el resultado contiene exactamente las filas vivas de ambas páginas
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/__tests__/syncServiceAthleteDelete.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

(a) Drain delete branch:

```typescript
const payload = op.payload as { id: string; userId?: string }
const targetUserId = payload.userId ?? op.userId
const deleteQuery = op.table === 'athletes'
  ? getSupabase().from(op.table).delete().eq('id', payload.id).eq('owner_account_id', targetUserId)
  : getSupabase().from(op.table).delete().eq('id', payload.id).eq('user_id', targetUserId)
const { error } = await withRequestTimeout(deleteQuery, `${op.table}.delete`)
if (error) throw error
rememberDeleteTombstoneForTable(op.table, op.userId, payload.id)
```

(b) `rememberDeleteTombstoneForTable`:

```typescript
function rememberDeleteTombstoneForTable(table: SupabaseTable, userId: string, id: string): void {
  if (table === 'sessions') rememberSessionDeleteTombstone(userId, id)
  if (table === 'coach_proposals') rememberCoachProposalDeleteTombstone(userId, id)
  if (table === 'athletes') {
    try {
      rememberAthleteDeleteTombstone(userId, id)
    } catch {
      // El delete remoto YA corrió: sin tombstone el pull puede re-materializar
      // hasta el próximo sync, pero el remoto quedó borrado. Log y seguir.
      syncLog('rememberDeleteTombstoneForTable:athletes_tombstone_failed', { id }, 'warn')
    }
  }
}
```

(c) Helper puro compartido:

```typescript
// src/services/sync/remoteRowAthleteId.ts
/** athlete_id de una fila remota: columna directa o data.athleteId (extraído de syncService). */
export function getRemoteRowAthleteId(row: Record<string, unknown>): string | undefined {
  const data = (row.data as Record<string, unknown>) ?? {}
  return ((row.athlete_id as string | null | undefined) ?? (data.athleteId as string | undefined)) || undefined
}
```

(`syncService.ts` elimina su copia privada e importa esta; verificar que la semántica es idéntica.)

(d) Filtro central de hijos — en `fetchAll` (**`src/services/sync/syncSupabase.ts` L101**), DENTRO del loop de paginación. Dos reglas duras: la paginación se decide con el tamaño de la página SIN filtrar (una página de 1000 filas puede quedar en 20 tras el filtro y aún haber más páginas), y al acumulador entran solo las filas vivas:

```typescript
import { hasAthleteDeleteTombstone } from './athleteDeleteTombstones'
import { getRemoteRowAthleteId } from './remoteRowAthleteId'

// dentro del for de paginación, reemplazando `rows.push(...page)`:
const page = (data ?? []) as T[]
const alive = page.filter((row) => {
  const rowAthleteId = getRemoteRowAthleteId(row as Record<string, unknown>)
  return !rowAthleteId || !hasAthleteDeleteTombstone(userId, rowAthleteId)
})
rows.push(...alive)
if (!supportsRange || page.length < FETCH_PAGE_SIZE) break // tamaño SIN filtrar
```

(Esto cubre todos los merges que consumen `fetchAll`: sessions, day_logs, week_summaries, chat_messages, coach_proposals y athlete_profiles — L1627 también pasa por `fetchAll`. `pullMemberships` y `athlete_coach_notes`, si no usan `fetchAll`, aplican el mismo filtro por `row.athlete_id` antes de escribir Dexie.)

(e) `pullAthletes`:

```typescript
} else if (data && data.length) {
  const alive = (data as AthleteRow[]).filter((row) => !hasAthleteDeleteTombstone(userId, row.id))
  if (alive.length) await db.athletes.bulkPut(alive.map(rowToAthlete))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/__tests__/syncServiceAthleteDelete.test.ts src/services/__tests__/syncService.test.ts`
Expected: PASS ambos (la suite existente protege el path compartido).

- [ ] **Step 5: Commit (lo hace el owner)**

Mensaje sugerido: `fix(sync): drain de athletes por owner_account_id + tombstone + filtrado de pulls hijos`

---

### Task 5: syncService — entry-guards, barrera exclusiva y ops en vuelo

**Files:**
- Modify: `src/services/syncService.ts` (`upsertRow` ~L1143, `pushSessionCompletion` ~L2015, `ensureRemoteManagedAthleteOnce` ~L1966, drain ~L949, merges/pulls del paso f)
- Modify: `src/services/planBuilder/pollPlanGeneration.ts` — `fetchPlanGenerationSnapshot` (~L120): su transacción de escritura (~L161) bajo lease
- Modify: `src/services/readiness/pullReadiness.ts` — `bulkPut` (~L40) bajo lease
- Modify: `src/services/readiness/pullWorkouts.ts` — reconciliación + `bulkPut` (~L68) bajo lease
- Modify: `src/services/athlete/membershipCache.ts` o su caller `pullMemberships` — reemplazo atómico bajo `withAthleteWriteLeases` (plural)
- Test: `src/services/__tests__/syncServiceAthleteDelete.test.ts` (ampliar); `src/services/planBuilder/__tests__/pollPlanGeneration.test.ts` y `src/services/readiness/__tests__/pullWorkouts.test.ts` (ampliar con interleaving); `src/services/readiness/__tests__/pullReadiness.test.ts` (crear)

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `export function acquireAthleteDeletionBarrier(athleteId: string): (() => void) | null` — mutex exclusivo en memoria por atleta (garantía single-tab, ver Global Constraints); `null` si ya está tomado. El release es idempotente.
  - `export async function waitForInFlightAthleteOps(athleteId: string): Promise<void>` — itera hasta que no queden ops en vuelo (converge porque los entry-guards impiden comienzos nuevos).
  - `export function withAthleteWriteLease<T>(athleteId: string | null, run: () => Promise<T>): Promise<T> | null` — **cierra el TOCTOU de los pulls**: chequea el tombstone y registra la operación en `inFlightAthleteOps` SIN ceder control (mismo tick síncrono), y recién entonces inicia `run()`. Devuelve `null` si el atleta está tombstoned (el caller no escribe). Invariante resultante: o el lease se adquirió ANTES del tombstone (y la barrera del delete lo espera), o el tombstone ya era visible (y la escritura se rechaza) — no existe ventana intermedia.
  - `export function withAthleteWriteLeases<T>(athleteIds: string[], run: () => Promise<T>): Promise<T> | null` — variante **plural para escrituras batch multi-atleta** (el reemplazo atómico de `replaceMembershipCache`): chequea TODOS los tombstones y registra la MISMA operación bajo TODOS los atletas, ambos pasos sin `await`, y recién entonces inicia el reemplazo transaccional. `null` si CUALQUIER atleta del batch está tombstoned.
  - Entry-guards: `upsertRow` y las entradas de session-completion rechazan (skip + log) ops de atletas tombstoned; `ensureRemote*` no recrea atletas tombstoned; el drain descarta ops upsert/session_completion rezagadas de atletas tombstoned.
  - **SIN guard en `enqueue`** (constraint global rev. 2): los retries de ops admitidas deben fluir.
  - Tracking en vuelo: `upsertRow`, **`pushSessionCompletion`** y la ejecución de ops en `drainQueue` registran su promesa por atleta (un RPC iniciado antes del tombstone que falla después de Fase B y se re-encola violaría el contrato de "cola limpia" si la barrera no lo esperó).
  - **Writes de pulls con lease:** TODOS los paths que escriben Dexie/cache desde un pull envuelven su fase de escritura en `withAthleteWriteLease` — cobertura exhaustiva por auditoría en el paso (f), no por enumeración. El filtro de `fetchAll` (Task 4) reduce el volumen, pero solo el lease cierra la carrera entre el chequeo y el `put`.

- [ ] **Step 1: Write the failing tests (ampliar el archivo de Task 4)**

```typescript
it('acquireAthleteDeletionBarrier es exclusivo por atleta y el release lo libera', () => {
  const release = acquireAthleteDeletionBarrier('ath_m_a')
  expect(release).not.toBeNull()
  expect(acquireAthleteDeletionBarrier('ath_m_a')).toBeNull()   // segundo intento: busy
  expect(acquireAthleteDeletionBarrier('ath_m_b')).not.toBeNull() // otro atleta: libre
  release!()
  expect(acquireAthleteDeletionBarrier('ath_m_a')).not.toBeNull() // liberado
})

it('upsertRow de un atleta tombstoned no llega a red ni a la cola', async () => {
  // tombstone ath_m_a; push athlete-scoped (via export público que use upsertRow)
  // assert: 0 upserts a supabase; cola vacía
})

it('el retry de una op admitida SÍ se encola con tombstone presente (sin guard en enqueue)', async () => {
  // op admitida antes del tombstone (deferred), tombstone puesto, la op falla retriable
  // assert: la op reaparece en la cola (retry preservado — se pierde solo en Fase B post-éxito)
})

it('el delete canónico de athletes se encola y drena con tombstone presente', async () => {})

it('waitForInFlightAthleteOps espera TODAS las ops en vuelo, incluidas las del drain', async () => {
  // 1 upsert directo deferred + 1 op de cola ejecutándose deferred (drain en curso)
  // waitForInFlightAthleteOps no resuelve hasta liberar ambas
})

it('un upsert encolado de la PROPIA fila athletes queda registrado bajo el atleta', async () => {
  // op { table:'athletes', action:'upsert', payload:{ id:'ath_m_a' } } SIN athlete_id, ejecutándose deferred en el drain
  // waitForInFlightAthleteOps('ath_m_a') NO resuelve hasta liberarla
  // (sin esto: empieza antes del tombstone, la barrera no la espera y recrea la fila tras el delete remoto)
})

it('push en vuelo intercalado con delete: la op admitida termina sin recrear al atleta', async () => {
  // upsert en vuelo (ya pasó ensureRemoteAthlete) → tombstone → wait → liberar con error retriable
  // assert: retry en cola; NINGÚN upsert a 'athletes' posterior al tombstone (ensure respeta tombstone)
})

it('withAthleteWriteLease cierra el TOCTOU: tombstone puesto entre el fetch y el put', async () => {
  // 1. run() con lectura Dexie diferida (deferred db.get) que termina en un put
  // 2. adquirir el lease ANTES del tombstone → tombstone → delete llama waitForInFlightAthleteOps
  // 3. la barrera NO resuelve hasta que el lease termine (el put corre antes de la purga, no después)
  // 4. caso inverso: tombstone primero → withAthleteWriteLease devuelve null y NADA se escribe
})

it('session_completion en vuelo intercalado con delete: la barrera lo espera y su retry no ensucia la cola final', async () => {
  // RPC deferred iniciado antes del tombstone → tombstone + wait (no resuelve hasta liberar)
  // liberar con error retriable → re-enqueue permitido → la Fase B (supresión por scopeAthleteId) lo elimina
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/__tests__/syncServiceAthleteDelete.test.ts`
Expected: FAIL en los nuevos.

- [ ] **Step 3: Write the implementation**

(a) Barrera exclusiva + registro en vuelo (junto a `entityMutationLanes`):

```typescript
/** Borrados de atleta en curso (mutex exclusivo, memoria de módulo). */
const athleteDeletionBarriers = new Set<string>()

/**
 * Mutex exclusivo por atleta para el borrado duro. Devuelve el release o null
 * si otro borrado del mismo atleta está en curso (el dominio aborta con mensaje).
 * Release idempotente.
 */
export function acquireAthleteDeletionBarrier(athleteId: string): (() => void) | null {
  if (athleteDeletionBarriers.has(athleteId)) return null
  athleteDeletionBarriers.add(athleteId)
  let released = false
  return () => {
    if (released) return
    released = true
    athleteDeletionBarriers.delete(athleteId)
  }
}

/** Ops athlete-scoped en vuelo (upsertRow directo Y ejecución de ops del drain). */
const inFlightAthleteOps = new Map<string, Set<Promise<unknown>>>()

function trackInFlightAthleteOp<T>(athleteId: string | null, run: Promise<T>): Promise<T> {
  if (!athleteId) return run
  let bucket = inFlightAthleteOps.get(athleteId)
  if (!bucket) {
    bucket = new Set()
    inFlightAthleteOps.set(athleteId, bucket)
  }
  const owner = bucket
  const tracked = run.finally(() => {
    owner.delete(tracked)
    if (owner.size === 0 && inFlightAthleteOps.get(athleteId) === owner) {
      inFlightAthleteOps.delete(athleteId)
    }
  })
  owner.add(tracked)
  return tracked
}

/**
 * Espera a que NO queden ops en vuelo del atleta. Itera hasta vaciar: converge
 * porque los entry-guards (tombstone) impiden que comiencen ops nuevas.
 */
export async function waitForInFlightAthleteOps(athleteId: string): Promise<void> {
  for (;;) {
    const bucket = inFlightAthleteOps.get(athleteId)
    if (!bucket || bucket.size === 0) return
    await Promise.allSettled([...bucket])
  }
}

/**
 * Lease de escritura por atleta para writes provenientes de pulls (plan rev.3).
 * Chequeo de tombstone + registro en vuelo + inicio de run() en el MISMO tick
 * síncrono — sin await entre medio. Así, o el lease existe antes del tombstone
 * (la barrera del delete lo espera), o el tombstone es visible y se devuelve
 * null (el caller no escribe). Cierra la carrera chequeo→await→put.
 */
export function withAthleteWriteLease<T>(
  athleteId: string | null,
  run: () => Promise<T>,
): Promise<T> | null {
  if (athleteId && hasAthleteDeleteTombstoneForAthlete(athleteId)) return null
  return trackInFlightAthleteOp(athleteId, Promise.resolve().then(run))
}

/**
 * Variante plural para escrituras batch multi-atleta (p. ej. el reemplazo
 * atómico de replaceMembershipCache): chequea TODOS los tombstones (batch SIN
 * filtrar, deduplicado) y registra la MISMA operación bajo TODOS los atletas;
 * run() arranca en una microtask POSTERIOR al registro, así el código coincide
 * con el contrato registro→inicio. null si cualquier atleta está en borrado.
 */
export function withAthleteWriteLeases<T>(
  athleteIds: string[],
  run: () => Promise<T>,
): Promise<T> | null {
  const unique = [...new Set(athleteIds)]
  for (const athleteId of unique) {
    if (hasAthleteDeleteTombstoneForAthlete(athleteId)) return null
  }
  const started = Promise.resolve().then(run) // inicia DESPUÉS del registro síncrono de abajo
  let tracked: Promise<T> = started
  for (const athleteId of unique) {
    tracked = trackInFlightAthleteOp(athleteId, tracked)
  }
  return tracked
}
```

(La versión singular `withAthleteWriteLease` usa el mismo patrón `Promise.resolve().then(run)` por consistencia registro→inicio; en single-tab ambas formas son equivalentes dentro del mismo stack, pero código y contrato deben coincidir.)

(b) Entry-guard + tracking en `upsertRow` (al inicio, antes de cualquier enqueue/red):

```typescript
const payloadAthleteId = typeof payload.athlete_id === 'string' ? payload.athlete_id : null
const guardTarget = table === 'athletes' && typeof payload.id === 'string' ? payload.id as string : payloadAthleteId
if (guardTarget && hasAthleteDeleteTombstoneForAthlete(guardTarget)) {
  syncLog('upsertRow:athlete_tombstoned_skip', { table }, 'warn')
  return
}
return trackInFlightAthleteOp(guardTarget, withSerializedEntityMutation(userId, table, payload, async () => {
  // ... cuerpo existente sin cambios ...
}))
```

(c) Entry-guard + tracking en `pushSessionCompletion` (única entrada del RPC; encola en L2019/L2036): al inicio,

```typescript
if (session.athleteId && hasAthleteDeleteTombstoneForAthlete(session.athleteId)) {
  syncLog('sessionCompletion:athlete_tombstoned_skip', { sessionId: session.id }, 'warn')
  return
}
```

y el cuerpo completo (RPC + posibles re-enqueues) queda envuelto en tracking, para que la barrera lo espere:

```typescript
async function pushSessionCompletion(session: Session, userId: string): Promise<void> {
  if (!isEnabled()) return
  if (session.athleteId && hasAthleteDeleteTombstoneForAthlete(session.athleteId)) {
    syncLog('sessionCompletion:athlete_tombstoned_skip', { sessionId: session.id }, 'warn')
    return
  }
  return trackInFlightAthleteOp(session.athleteId ?? null, pushSessionCompletionInner(session, userId))
}
// pushSessionCompletionInner = cuerpo actual sin cambios (offline enqueue / rpc / retry enqueue)
```

(d) `ensureRemoteManagedAthleteOnce` y el path self de `ensureRemoteAthlete`, primer statement:

```typescript
if (hasAthleteDeleteTombstoneForAthlete(athleteId)) {
  throw new Error(`athlete ${athleteId} is being deleted; refusing to recreate`)
}
```

(e) Drain: descartar rezagadas + tracking. En el loop, ANTES del `try` (junto al chequeo de expiradas que hace `continue`):

```typescript
if (op.action !== 'delete') {
  const opAthleteId = (typeof op.payload.athlete_id === 'string' ? op.payload.athlete_id : null)
    ?? op.scopeAthleteId ?? null
  const opTarget = op.table === 'athletes' && typeof op.payload.id === 'string' ? op.payload.id as string : opAthleteId
  if (opTarget && hasAthleteDeleteTombstoneForAthlete(opTarget)) {
    syncLog('drain:athlete_tombstoned_drop', { table: op.table, action: op.action }, 'warn')
    continue // consumida sin ejecutar (no se re-guarda en la cola resultante)
  }
}
```

Y envolver la ejecución de cada op con tracking, **reutilizando el mismo `opTarget` del guard** (incluye el caso `table='athletes'` por `payload.id` — un upsert encolado de la fila `athletes` no trae `athlete_id` y aun así debe quedar registrado bajo el atleta, o la barrera no lo espera y puede recrear la fila después del delete remoto):

```typescript
function queuedOpAthleteTarget(op: OfflineOp): string | null {
  const opAthleteId = (typeof op.payload.athlete_id === 'string' ? op.payload.athlete_id : null)
    ?? op.scopeAthleteId ?? null
  return op.table === 'athletes' && typeof op.payload.id === 'string'
    ? op.payload.id as string
    : opAthleteId
}

// guard (solo ops que no son el delete canónico) y tracking usan el MISMO target:
const opTarget = queuedOpAthleteTarget(op)
await trackInFlightAthleteOp(opTarget, executeQueuedOp(op)) // executeQueuedOp = cuerpo existente del loop
```

(Integrar según la estructura real del loop: lo esencial es que la promesa de ejecución de la op quede registrada bajo el atleta correcto, también para ops de la propia tabla `athletes`.)

(f) Writes de pulls con lease — **auditoría exhaustiva**: TODA escritura Dexie/cache originada en un pull queda envuelta. El método de auditoría es mecánico: grep de `.put(`, `.bulkPut(` y `replaceMembershipCache(` en todos los paths de pull/merge de `syncService.ts`, y cada hit se envuelve. Lista conocida al escribir este plan (el ejecutor verifica que no haya más):

- `mergeSessions`, `mergeDayLogs`, `mergeWeekSummaries`, `mergeChatMessages`, `mergeCoachProposals`, merge de `athlete_profiles`
- `mergeCoachNotes` (~L2781), `mergeTrainingPlans` (~L2907), `mergeTrainingPlanWeeks` (~L2964)
- `pullSessionsForDateRange` (~L2052, exportada — mismo patrón de puts por fila)
- `pullAthletes` (~L2325): el `bulkPut` se reemplaza por puts por fila con lease sobre `row.id` (la fila `athletes` ES el atleta)
- `pullMemberships` (~L2306): `replaceMembershipCache` es un reemplazo ATÓMICO multi-atleta (delete de todas las memberships de la cuenta + un `bulkPut`), así que el lease por fila no aplica. Orden obligatorio: (1) obtener y **deduplicar TODOS los `athlete_id` del batch remoto SIN filtrar**; (2) `withAthleteWriteLeases(allBatchAthleteIds, ...)` — cualquier atleta tombstoned cancela el batch COMPLETO (`null`); (3) dentro del lease, ejecutar el reemplazo transaccional. Nunca filtrar tombstoned antes del chequeo plural: eso ocultaría al helper exactamente el tombstone que debe vetar el batch
- **Módulos externos a syncService** (misma auditoría, mismos patrones):
  - `fetchPlanGenerationSnapshot` (`src/services/planBuilder/pollPlanGeneration.ts` ~L120): la transacción `db.transaction('rw', trainingPlans, trainingPlanWeeks, ...)` (~L161) se envuelve en `withAthleteWriteLease(plan.athleteId, ...)` — un polling cuyo fetch quedó en vuelo durante el borrado no puede reinsertar plan/semanas tras la purga
  - `pullReadiness` (`src/services/readiness/pullReadiness.ts` ~L40): el `bulkPut` de `readinessDaily` bajo lease del atleta
  - `pullWorkouts` (`src/services/readiness/pullWorkouts.ts` ~L68): la reconciliación local + `bulkPut` de `whoopWorkouts` bajo lease del atleta (además de su guard de `switchEpoch` existente)

```typescript
// patrón dentro del loop de cada merge/pull, reemplazando el put directo:
const write = withAthleteWriteLease(remote.athleteId ?? null, async () => {
  await db.sessions.put(remote) // (la tabla que corresponda)
})
if (write) await write // null ⇒ atleta en borrado: se salta la fila
```

(Las filas legacy — `athleteId` undefined — pasan con lease nulo sin chequeo: pertenecen al self, que nunca se borra. El filtro de `fetchAll` en Task 4 reduce el volumen; el lease cierra la carrera filtro/lectura → await → put.)

Tests diferidos representativos (además del TOCTOU genérico), todos con el patrón "lease adquirido antes del tombstone ⇒ la barrera espera; tombstone primero ⇒ cero escritura":

- roster (`pullAthletes` con put diferido de la fila del atleta), sesiones por rango (`pullSessionsForDateRange`), coach notes y plans/weeks (en `syncServiceAthleteDelete.test.ts`);
- **memberships batch multi-atleta**: `replaceMembershipCache` con memberships de DOS atletas, borrando uno entre el fetch y el reemplazo → cero escritura del batch completo (`withAthleteWriteLeases` devuelve null); y el caso lease-antes-del-tombstone → la barrera espera el reemplazo entero;
- **polling de generación**: `fetchPlanGenerationSnapshot` con fetch remoto diferido; tombstone puesto entre el fetch y la transacción → plan/semanas NO se reinsertan (test junto a los del módulo `pollPlanGeneration`);
- **readiness y workouts**: `pullReadiness`/`pullWorkouts` con respuesta remota diferida; tombstone entre fetch y `bulkPut` → cero escritura (tests junto a los de `src/services/readiness/`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/__tests__/syncServiceAthleteDelete.test.ts src/services/__tests__/syncService.test.ts src/services/planBuilder/__tests__/pollPlanGeneration.test.ts src/services/readiness/__tests__/pullWorkouts.test.ts src/services/readiness/__tests__/pullReadiness.test.ts`
Expected: PASS todos — incluye los interleaving nuevos en `pollPlanGeneration.test.ts` y `pullWorkouts.test.ts` (archivos existentes, se amplían) y el archivo NUEVO `pullReadiness.test.ts`.

- [ ] **Step 5: Commit (lo hace el owner)**

Mensaje sugerido: `feat(sync): entry-guards de tombstone, barrera exclusiva y tracking de ops en vuelo`

---

### Task 6: syncService — `deleteManagedAthleteRemote` (durabilidad verificada)

**Files:**
- Modify: `src/services/syncService.ts`
- Test: `src/services/__tests__/syncServiceAthleteDelete.test.ts` (ampliar)

**Interfaces:**
- Consumes: `getSupabase`, `classifySyncError`, `enqueue` local, `loadQueue` (de `./sync/syncQueue`, para verificar), `withRequestTimeout`, y `hasAthleteDeleteTombstone` (Task 1) SOLO para validar la precondición en runtime — la función jamás crea ni limpia tombstones.
- Produces:
  - `export type ManagedAthleteRemoteDeleteResult = 'deleted' | 'durably_queued' | 'failed'`
  - `export async function deleteManagedAthleteRemote(ownerAccountId: string, athleteId: string): Promise<ManagedAthleteRemoteDeleteResult>`
  - **PRECONDICIÓN documentada en el JSDoc y VALIDADA en runtime:** el caller ya creó un tombstone VERIFICADO para este atleta (Fase A del dominio); si falta, la función devuelve `failed` sin tocar red ni cola (la firma pública no puede impedir la llamada, así que se defiende sola). La función **nunca crea ni limpia tombstones** — el ownership es del caller (ver Global Constraints). `failed` garantiza cero cambio de estado de tombstones por parte de la función.
  - Propiedades: NO drena la cola; `durably_queued` SOLO si la op en cola quedó verificada en storage (read-back); `failed` ante fallo de durabilidad de la cola o error no-retriable.
  - El read-back de la op en cola es una verificación single-tab (otra pestaña puede reescribir la key después — edge aceptado, ver Global Constraints).

- [ ] **Step 1: Write the failing tests**

```typescript
// PRECONDICIÓN en todos los tests: el tombstone ya fue creado por el "dominio"
// (beforeEach del describe: rememberAthleteDeleteTombstone('user-1', athleteId)).

it('online: borra por id+owner_account_id y devuelve deleted; cola intacta (sin drain interno)', async () => {})

it('offline: encola el delete canónico VERIFICADO y devuelve durably_queued', async () => {
  // navigator.onLine=false → 'durably_queued'
  // cola contiene exactamente { table:'athletes', action:'delete', payload:{ id } }
})

it('error retriable: encola verificado y devuelve durably_queued', async () => {})

it('error no-retriable: failed, sin op en cola', async () => {})

it('la función NUNCA toca tombstones: ni failed ni deleted alteran las keys existentes', async () => {
  // snapshot de keys de tombstone antes/después en los casos deleted, durably_queued y failed
  // assert: idénticas (el ownership es del caller)
})

it('precondición violada (sin tombstone): failed inmediato, sin red ni cola', async () => {
  // NO crear tombstone en este test → 'failed'; 0 deleteCalls; cola vacía; syncLog de precondición
})

it('si la cola no persiste (saveQueue silencioso por quota): failed', async () => {
  // mock storage: setItem del QUEUE_KEY no escribe → loadQueue() no contiene la op → failed
})

it('durably_queued end-to-end: el drain consume el delete, el atleta remoto queda ausente y el tombstone persiste', async () => {})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/__tests__/syncServiceAthleteDelete.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```typescript
import { loadQueue } from './sync/syncQueue'

export type ManagedAthleteRemoteDeleteResult = 'deleted' | 'durably_queued' | 'failed'

/**
 * Borrado remoto de un atleta gestionado (spec rev.3; plan rev.4).
 * PRECONDICIÓN: el caller ya creó un tombstone VERIFICADO para este atleta
 * (Fase A del dominio). Esta función NUNCA crea ni limpia tombstones — el
 * ownership (token incluido) es del caller. Contrato:
 * - 'deleted': el delete corrió (FK cascade de 007/011/012/013b limpia hijos).
 * - 'durably_queued': offline/error retriable Y la op en cola quedó VERIFICADA
 *   en storage (read-back, garantía single-tab). Si no persiste → 'failed'.
 * - 'failed': el caller NO purga local; cero cambio de tombstones por esta función.
 * NO drena la cola internamente (ops hijas dispararían ensureRemoteAthlete).
 */
export async function deleteManagedAthleteRemote(
  ownerAccountId: string,
  athleteId: string,
): Promise<ManagedAthleteRemoteDeleteResult> {
  // Validación runtime de la PRECONDICIÓN (la firma pública no puede impedir
  // llamadas sin tombstone; el JSDoc solo no basta): sin tombstone no hay
  // protección anti-resurrección, así que no se intenta nada.
  if (!hasAthleteDeleteTombstone(ownerAccountId, athleteId)) {
    syncLog('deleteManagedAthleteRemote:missing_tombstone_precondition', { athleteId }, 'warn')
    return 'failed'
  }

  if (!isEnabled()) return 'deleted' // sin backend, lo local es canónico

  const queueCanonicalDelete = (): ManagedAthleteRemoteDeleteResult => {
    enqueue({ userId: ownerAccountId, table: 'athletes', action: 'delete', payload: { id: athleteId }, enqueuedAt: Date.now() })
    const landed = loadQueue().some((op) =>
      op.userId === ownerAccountId && op.table === 'athletes' && op.action === 'delete' && op.payload.id === athleteId)
    if (!landed) {
      syncLog('deleteManagedAthleteRemote:queue_not_durable', { athleteId }, 'warn')
      return 'failed' // el caller decide el rollback de SU tombstone
    }
    return 'durably_queued'
  }

  if (!navigator.onLine) return queueCanonicalDelete()

  try {
    const { error } = await withRequestTimeout(
      getSupabase().from('athletes').delete().eq('id', athleteId).eq('owner_account_id', ownerAccountId),
      'athletes.delete',
    )
    if (error) throw error
    return 'deleted'
  } catch (error) {
    const errorInfo = classifySyncError(error, 'athletes')
    if (errorInfo.retriable || errorInfo.autoRepairable) return queueCanonicalDelete()
    syncLog('deleteManagedAthleteRemote:failed', { category: errorInfo.category }, 'warn')
    return 'failed'
  }
}
```


- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/__tests__/syncServiceAthleteDelete.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificación de cascades (evidencia, sin código)**

Run: `grep -n "references public.athletes" supabase/007_athlete_scope.sql supabase/011_whoop_integration.sql supabase/012_whoop_workouts.sql supabase/013b_two_sided_expand.sql`
Expected: cada match acompaña `on delete cascade`. Si alguna tabla NO cascadea, agregar su delete explícito dentro de `deleteManagedAthleteRemote` y un test.

- [ ] **Step 6: Commit (lo hace el owner)**

Mensaje sugerido: `feat(sync): deleteManagedAthleteRemote con durabilidad verificada`

---

### Task 7: generationJobRunner — abort acotado + guards exhaustivos de escritura

**Files:**
- Modify: `src/services/planBuilder/generationJobRunner.ts`
- Test: `src/services/planBuilder/__tests__/generationJobRunner.abort.test.ts`

**Interfaces:**
- Consumes: Task 1 (`hasAthleteDeleteTombstoneForAthlete`), `runningJobs`, `ACTIVE_JOB_STATUSES`.
- Produces: `export async function abortPlanGenerationForAthlete(athleteId: string, opts?: { waitMs?: number }): Promise<void>`
- **Decisión (spec rev.3 opción B, elegida en review del plan):** NO se propaga `AbortSignal` hasta la llamada LLM (cambio transversal al provider). Se marca cancelado, se espera la promesa en vuelo con timeout acotado (default 4000ms) y se continúa confiando en guards **exhaustivos** de escritura: TODA escritura Dexie del run (`db.trainingPlanWeeks.put`, `db.trainingPlans.put`, `db.planGenerationJobs.put`), incluidas las de checkpoints, del post-generación y del `catch`, se protege con el guard de tombstone.

- [ ] **Step 1: Write the failing tests**

```typescript
// fake-indexeddb + vi.mock de generatePlanWeeks con deferred
it('cancela jobs activos del atleta y espera la promesa en vuelo hasta waitMs', async () => {
  // deferred que NUNCA resuelve; abortPlanGenerationForAthlete('ath_m_a', { waitMs: 50 })
  // assert: resuelve en <1s (no bloquea indefinidamente); job status 'cancelled'
})

it('si el run termina dentro del waitMs, espera real (no timeout)', async () => {
  // deferred liberado a los 10ms; abort con waitMs 5000 resuelve apenas termina
})

it('ninguna escritura del run llega a Dexie con tombstone presente: onWeekUpdate, checkpoint, catch', async () => {
  // tombstone ath_m_a; simular run que (a) invoca onWeekUpdate, (b) llega al put post-generación,
  // (c) lanza y pasa por el catch que persiste lastError
  // assert: db.trainingPlanWeeks/trainingPlans/planGenerationJobs sin escrituras nuevas del run
})

it('no toca jobs de otros atletas', async () => {})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/planBuilder/__tests__/generationJobRunner.abort.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```typescript
import { hasAthleteDeleteTombstoneForAthlete } from '../sync/athleteDeleteTombstones'

/** Guard central: NINGUNA escritura del runner para un atleta en borrado. */
function canWriteForAthlete(athleteId: string): boolean {
  return !hasAthleteDeleteTombstoneForAthlete(athleteId)
}

/**
 * Fase A del borrado duro (spec rev.3; plan rev.2 opción B): cancela los jobs
 * activos del atleta y espera sus promesas con timeout acotado — la llamada LLM
 * no es abortable sin plumbing transversal, así que un run zombie puede seguir
 * corriendo, pero TODAS sus escrituras Dexie están protegidas por
 * canWriteForAthlete. Pérdida aceptada: la generación abortada es relanzable.
 */
export async function abortPlanGenerationForAthlete(athleteId: string, opts?: { waitMs?: number }): Promise<void> {
  const waitMs = opts?.waitMs ?? 4000
  const jobs = await db.planGenerationJobs.where('athleteId').equals(athleteId).toArray()
  const timestamp = now()
  await Promise.all(jobs
    .filter((job) => ACTIVE_JOB_STATUSES.has(job.status))
    .map((job) => db.planGenerationJobs.put({
      ...job,
      status: 'cancelled' as const,
      completedAt: timestamp,
      heartbeatAt: timestamp,
      updatedAt: timestamp,
      lastError: 'Cancelado: el atleta está siendo eliminado.',
    })))
  const inFlight = jobs
    .map((job) => runningJobs.get(job.id))
    .filter((run): run is Promise<void> => Boolean(run))
  if (inFlight.length === 0) return
  await Promise.race([
    Promise.allSettled(inFlight),
    new Promise((resolve) => setTimeout(resolve, waitMs)),
  ])
}
```

Auditoría de escrituras del run (`runPlanGenerationJob` y sus helpers internos): anteponer el guard a CADA `db.*.put(...)` cuyo dato pertenezca al atleta del job. Enumerar en la implementación real (revisar el cuerpo completo):

```typescript
// patrón en cada punto de escritura del run:
if (!canWriteForAthlete(job.athleteId)) return   // o `continue`/skip según el bloque
await db.trainingPlanWeeks.put(...)
```

Puntos conocidos: callback `onWeekUpdate` (L271), put post-generación (L296), checkpoints de plan/job posteriores, y las escrituras del bloque `catch`/finalización que persisten `lastError`/estado del job. El test (c) del Step 1 falla si alguno queda sin guard.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/planBuilder/`
Expected: PASS (los nuevos + la suite existente del plan builder).

- [ ] **Step 5: Commit (lo hace el owner)**

Mensaje sugerido: `feat(planBuilder): abort acotado por atleta + guards exhaustivos de escritura`

---

### Task 8: managedAthletes — elegibilidad + archivar/restaurar/listar

**Files:**
- Modify: `src/services/athlete/managedAthletes.ts`
- Test: `src/services/__tests__/managedAthletes.test.ts` (ampliar)

**Interfaces:**
- Consumes: `athleteIdForOwner`, `pushAthlete`, `db.athletes`.
- Produces:
  - `archiveManagedAthlete(ownerAccountId: string, athleteId: string): Promise<Athlete>`
  - `restoreManagedAthlete(ownerAccountId: string, athleteId: string): Promise<Athlete>`
  - `listArchivedAthletes(ownerAccountId: string): Promise<Athlete[]>`
  - `assertEligibleManagedAthlete(ownerAccountId: string, athlete: Athlete): void` (exportada; la reusa Task 9)

- [ ] **Step 1: Write the failing tests (ampliar `managedAthletes.test.ts`)**

```typescript
describe('archive/restore/listArchived', () => {
  const now = Date.now()
  const managed = { id: 'ath_m_a', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Ana', status: 'active', createdAt: now, updatedAt: now }
  const self = { id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now }
  const claimed = { id: 'ath_m_c', ownerAccountId: 'user-1', linkedAccountId: 'user-9', displayName: 'Carla', status: 'active', createdAt: now, updatedAt: now }

  it('archiveManagedAthlete archiva y pushea', async () => {
    await db.athletes.bulkPut([managed, self] as never)
    const result = await archiveManagedAthlete('user-1', 'ath_m_a')
    expect(result.status).toBe('archived')
    expect((await db.athletes.get('ath_m_a'))?.status).toBe('archived')
    expect(vi.mocked(syncService.pushAthlete)).toHaveBeenCalledWith(expect.objectContaining({ id: 'ath_m_a', status: 'archived' }))
  })

  it('rechaza self, reclamado, otro owner e inexistente (archive y restore)', async () => {
    await db.athletes.bulkPut([managed, self, claimed] as never)
    await expect(archiveManagedAthlete('user-1', 'ath_user-1')).rejects.toThrow()
    await expect(archiveManagedAthlete('user-1', 'ath_m_c')).rejects.toThrow()
    await expect(archiveManagedAthlete('user-2', 'ath_m_a')).rejects.toThrow()
    await expect(archiveManagedAthlete('user-1', 'ath_missing')).rejects.toThrow()
    await expect(restoreManagedAthlete('user-1', 'ath_m_c')).rejects.toThrow()
  })

  it('restoreManagedAthlete vuelve a active', async () => {
    await db.athletes.bulkPut([{ ...managed, status: 'archived' }, self] as never)
    expect((await restoreManagedAthlete('user-1', 'ath_m_a')).status).toBe('active')
  })

  it('listArchivedAthletes: solo archivados del owner, orden por nombre', async () => {
    await db.athletes.bulkPut([
      { ...managed, status: 'archived' },
      { ...managed, id: 'ath_m_b', displayName: 'Beto', status: 'archived' },
      self,
      { id: 'ath_other', ownerAccountId: 'user-2', status: 'archived', createdAt: now, updatedAt: now },
    ] as never)
    expect((await listArchivedAthletes('user-1')).map((athlete) => athlete.id)).toEqual(['ath_m_a', 'ath_m_b'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/__tests__/managedAthletes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation (agregar a `managedAthletes.ts`)**

```typescript
/**
 * Elegibilidad dura (spec rev.3): owner + no-self + NO reclamado.
 * `linkedAccountId === null` es exacto HOY (no existe flujo de claim en prod);
 * SP1b debe migrar este gate a un chequeo server-authoritative antes de
 * habilitar claim_self (la RLS de memberships no deja ver el self de otra cuenta).
 */
export function assertEligibleManagedAthlete(ownerAccountId: string, athlete: Athlete): void {
  if (athlete.ownerAccountId !== ownerAccountId) throw new Error('El atleta no pertenece a esta cuenta.')
  if (athlete.id === athleteIdForOwner(ownerAccountId)) throw new Error('No puedes archivar ni eliminar tu propio perfil.')
  if (athlete.linkedAccountId != null) throw new Error('Este atleta tiene una cuenta vinculada; no se puede archivar ni eliminar desde acá.')
}

async function getEligibleManagedAthlete(ownerAccountId: string, athleteId: string): Promise<Athlete> {
  const athlete = await db.athletes.get(athleteId)
  if (!athlete) throw new Error('Atleta no encontrado.')
  assertEligibleManagedAthlete(ownerAccountId, athlete)
  return athlete
}

async function setManagedAthleteStatus(ownerAccountId: string, athleteId: string, status: 'active' | 'archived'): Promise<Athlete> {
  const athlete = await getEligibleManagedAthlete(ownerAccountId, athleteId)
  const next: Athlete = { ...athlete, status, updatedAt: Date.now() }
  await db.athletes.put(next)
  void syncService.pushAthlete(next)
  return next
}

/** Archiva (reversible): sale del roster/switcher; datos intactos. */
export async function archiveManagedAthlete(ownerAccountId: string, athleteId: string): Promise<Athlete> {
  return setManagedAthleteStatus(ownerAccountId, athleteId, 'archived')
}

/** Restaura un atleta archivado al roster. */
export async function restoreManagedAthlete(ownerAccountId: string, athleteId: string): Promise<Athlete> {
  return setManagedAthleteStatus(ownerAccountId, athleteId, 'active')
}

/** Espejo de listOwnedAthletes para status 'archived' (sin self: el self nunca se archiva). */
export async function listArchivedAthletes(ownerAccountId: string): Promise<Athlete[]> {
  const rows = await db.athletes.toArray()
  return rows
    .filter((row) => row.ownerAccountId === ownerAccountId && row.status === 'archived')
    .sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/__tests__/managedAthletes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit (lo hace el owner)**

Mensaje sugerido: `feat(coach): archivar/restaurar/listar atletas gestionados con elegibilidad dura`

---

### Task 9: managedAthletes — `deleteManagedAthletePermanently` (Fase A/B, barrera exclusiva)

**Files:**
- Modify: `src/services/athlete/managedAthletes.ts`
- Test: `src/services/__tests__/managedAthletes.delete.test.ts` (nuevo)

**Interfaces:**
- Consumes: Tasks 1-8 — `acquireAthleteDeletionBarrier`, `deleteManagedAthleteRemote`, `waitForInFlightAthleteOps` (syncService), `clearQueuedOpsForAthlete` (syncQueue), `abortPlanGenerationForAthlete` (generationJobRunner), tombstones (Task 1), `clearStoredChatSessionIdForAthlete` (Task 3), `assertEligibleManagedAthlete` (Task 8).
- Produces: `deleteManagedAthletePermanently(ownerAccountId: string, athleteId: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/services/__tests__/managedAthletes.delete.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../syncService', () => ({
  pushAthlete: vi.fn(async () => {}),
  deleteManagedAthleteRemote: vi.fn(async () => 'deleted' as const),
  waitForInFlightAthleteOps: vi.fn(async () => {}),
  acquireAthleteDeletionBarrier: vi.fn(() => vi.fn()),
}))
vi.mock('../planBuilder/generationJobRunner', () => ({
  abortPlanGenerationForAthlete: vi.fn(async () => {}),
}))

import { db } from '../../db/db'
import * as syncService from '../syncService'
import { abortPlanGenerationForAthlete } from '../planBuilder/generationJobRunner'
import { deleteManagedAthletePermanently } from '../athlete/managedAthletes'
import { clearAllAthleteDeleteTombstones, hasAthleteDeleteTombstone } from '../sync/athleteDeleteTombstones'
import { loadQueue, saveQueue } from '../sync/syncQueue'
import { CHAT_SESSION_KEY } from '../../utils/chatSession'

const now = Date.now()
const archived = { id: 'ath_m_a', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Ana', status: 'archived', createdAt: now, updatedAt: now }

async function seedAthleteData(athleteId: string) {
  await db.sessions.put({ id: `s-${athleteId}`, athleteId, date: '2026-07-13', timeBlock: 'am', type: 'squash', status: 'planned', title: 'x', durationMin: 60, createdAt: now, updatedAt: now } as never)
  await db.dayLogs.put({ id: `d-${athleteId}`, athleteId, date: '2026-07-13', updatedAt: now } as never)
  await db.weekSummaries.put({ id: `w-${athleteId}`, athleteId, weekStartDate: '2026-07-13', updatedAt: now } as never)
  await db.chatMessages.put({ id: `c-${athleteId}`, athleteId, timestamp: now } as never)
  await db.coachProposals.put({ id: `p-${athleteId}`, athleteId, status: 'pending', createdAt: now } as never)
  await db.athleteProfiles.put({ id: `prof-${athleteId}`, athleteId, updatedAt: now } as never)
  await db.trainingPlans.put({ id: `tp-${athleteId}`, athleteId, status: 'active', startDate: '2026-07-01', updatedAt: now } as never)
  await db.trainingPlanWeeks.put({ id: `tpw-${athleteId}`, planId: `tp-${athleteId}`, athleteId, weekIndex: 0, weekStartDate: '2026-07-13', status: 'ready' } as never)
  await db.planGenerationJobs.put({ id: `job-${athleteId}`, planId: `tp-${athleteId}`, athleteId, status: 'cancelled', createdAt: now, updatedAt: now } as never)
  await db.readinessDaily.put({ id: `r-${athleteId}`, athleteId, date: '2026-07-13', source: 'whoop', updatedAt: now } as never)
  await db.whoopWorkouts.put({ id: `ww-${athleteId}`, athleteId, workoutId: `wk-${athleteId}`, date: '2026-07-13', updatedAt: now } as never)
  await db.athleteMemberships.put({ athleteId, accountId: 'user-1', role: 'coach', createdAt: now, updatedAt: now } as never)
  await db.athleteCoachNotes.put({ athleteId, updatedAt: now } as never)
}

describe('deleteManagedAthletePermanently', () => {
  beforeEach(async () => {
    db.close(); await db.delete(); await db.open()
    localStorage.clear()
    clearAllAthleteDeleteTombstones() // resetea también el espejo en memoria (Task 1)
    vi.clearAllMocks()
    vi.mocked(syncService.deleteManagedAthleteRemote).mockResolvedValue('deleted')
    vi.mocked(syncService.acquireAthleteDeletionBarrier).mockImplementation(() => vi.fn())
  })
  afterEach(() => { db.close() })

  it('orden Fase A: barrera → tombstone → abort → wait → delete remoto; luego Fase B', async () => {
    await db.athletes.put(archived as never)
    const calls: string[] = []
    vi.mocked(syncService.acquireAthleteDeletionBarrier).mockImplementation(() => { calls.push('barrier'); return vi.fn() })
    vi.mocked(abortPlanGenerationForAthlete).mockImplementation(async () => { calls.push('abort') })
    vi.mocked(syncService.waitForInFlightAthleteOps).mockImplementation(async () => { calls.push('wait') })
    vi.mocked(syncService.deleteManagedAthleteRemote).mockImplementation(async () => { calls.push('remote'); return 'deleted' })

    await deleteManagedAthletePermanently('user-1', 'ath_m_a')

    expect(calls).toEqual(['barrier', 'abort', 'wait', 'remote'])
    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(true)
  })

  it('purga TODAS las tablas athlete-keyed en éxito y limpia el chat del atleta', async () => {
    await db.athletes.put(archived as never)
    await seedAthleteData('ath_m_a')
    await db.athletes.put({ ...archived, id: 'ath_m_b', status: 'active' } as never)
    await seedAthleteData('ath_m_b') // control
    localStorage.setItem(`${CHAT_SESSION_KEY}:ath_m_a`, 'chat-a')

    await deleteManagedAthletePermanently('user-1', 'ath_m_a')

    for (const table of [db.sessions, db.dayLogs, db.weekSummaries, db.chatMessages, db.coachProposals,
      db.athleteProfiles, db.trainingPlans, db.trainingPlanWeeks, db.planGenerationJobs,
      db.readinessDaily, db.whoopWorkouts] as const) {
      expect(await table.filter((row: { athleteId?: string }) => row.athleteId === 'ath_m_a').count()).toBe(0)
      expect(await table.filter((row: { athleteId?: string }) => row.athleteId === 'ath_m_b').count()).toBe(1)
    }
    expect(await db.athleteMemberships.where('athleteId').equals('ath_m_a').count()).toBe(0)
    expect(await db.athleteCoachNotes.get('ath_m_a')).toBeUndefined()
    expect(await db.athletes.get('ath_m_a')).toBeUndefined()
    expect(localStorage.getItem(`${CHAT_SESSION_KEY}:ath_m_a`)).toBeNull()
  })

  it('failed: rollback — tombstone fuera, cola intacta, cero purga, barrera liberada', async () => {
    await db.athletes.put(archived as never)
    await seedAthleteData('ath_m_a')
    saveQueue([{ userId: 'user-1', table: 'sessions', action: 'upsert', payload: { id: 's-ath_m_a', athlete_id: 'ath_m_a' }, enqueuedAt: now }] as never)
    const release = vi.fn()
    vi.mocked(syncService.acquireAthleteDeletionBarrier).mockReturnValue(release)
    vi.mocked(syncService.deleteManagedAthleteRemote).mockResolvedValue('failed')

    await expect(deleteManagedAthletePermanently('user-1', 'ath_m_a')).rejects.toThrow()

    expect(hasAthleteDeleteTombstone('user-1', 'ath_m_a')).toBe(false)
    expect(loadQueue()).toHaveLength(1)
    expect(await db.sessions.get('s-ath_m_a')).toBeDefined()
    expect(await db.athletes.get('ath_m_a')).toBeDefined()
    expect(release).toHaveBeenCalled()
  })

  it('si el tombstone no persiste, aborta ANTES de abort/wait/remote: cero purga', async () => {
    await db.athletes.put(archived as never)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    await expect(deleteManagedAthletePermanently('user-1', 'ath_m_a')).rejects.toThrow()
    expect(vi.mocked(abortPlanGenerationForAthlete)).not.toHaveBeenCalled()
    expect(await db.athletes.get('ath_m_a')).toBeDefined()
    vi.restoreAllMocks()
  })

  it('rollback con clear fallido: lanza el mensaje de atleta bloqueado, sin purga', async () => {
    await db.athletes.put(archived as never)
    await seedAthleteData('ath_m_a')
    vi.mocked(syncService.deleteManagedAthleteRemote).mockResolvedValue('failed')
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {}) // clear silencioso → read-back false
    await expect(deleteManagedAthletePermanently('user-1', 'ath_m_a')).rejects.toThrow(/desbloquear/)
    expect(await db.sessions.get('s-ath_m_a')).toBeDefined() // cero purga
    vi.restoreAllMocks()
  })

  it('durably_queued: Fase B corre y la cola conserva SOLO el delete canónico entre las ops del atleta', async () => {
    await db.athletes.put(archived as never)
    await seedAthleteData('ath_m_a')
    saveQueue([
      { userId: 'user-1', table: 'sessions', action: 'upsert', payload: { id: 's-ath_m_a', athlete_id: 'ath_m_a' }, enqueuedAt: now },
      { userId: 'user-1', table: 'athletes', action: 'delete', payload: { id: 'ath_m_a' }, enqueuedAt: now },
    ] as never)
    vi.mocked(syncService.deleteManagedAthleteRemote).mockResolvedValue('durably_queued')

    await deleteManagedAthletePermanently('user-1', 'ath_m_a')

    const rest = loadQueue()
    expect(rest).toHaveLength(1)
    expect(rest[0]).toMatchObject({ table: 'athletes', action: 'delete', payload: { id: 'ath_m_a' } })
    expect(await db.athletes.get('ath_m_a')).toBeUndefined()
  })

  it('fallo a mitad de la transacción: rollback completo (ninguna tabla purgada)', async () => {
    await db.athletes.put(archived as never)
    await seedAthleteData('ath_m_a')
    const spy = vi.spyOn(db.whoopWorkouts, 'where').mockImplementation(() => { throw new Error('boom') })
    await expect(deleteManagedAthletePermanently('user-1', 'ath_m_a')).rejects.toThrow('boom')
    spy.mockRestore()
    // Dexie aborta la transacción entera: las tablas purgadas antes del fallo vuelven.
    expect(await db.sessions.get('s-ath_m_a')).toBeDefined()
    expect(await db.athletes.get('ath_m_a')).toBeDefined()
  })

  it('doble delete concurrente: el segundo aborta por barrera ocupada sin tocar nada', async () => {
    await db.athletes.put(archived as never)
    vi.mocked(syncService.acquireAthleteDeletionBarrier).mockReturnValueOnce(vi.fn()).mockReturnValueOnce(null)
    const first = deleteManagedAthletePermanently('user-1', 'ath_m_a')
    await expect(deleteManagedAthletePermanently('user-1', 'ath_m_a')).rejects.toThrow(/en curso/)
    await first
  })

  it('exige status archived y elegibilidad', async () => {
    await db.athletes.put({ ...archived, status: 'active' } as never)
    await expect(deleteManagedAthletePermanently('user-1', 'ath_m_a')).rejects.toThrow(/archivado/)
    await db.athletes.put({ ...archived, id: 'ath_m_c', linkedAccountId: 'user-9' } as never)
    await expect(deleteManagedAthletePermanently('user-1', 'ath_m_c')).rejects.toThrow()
  })

  it('idempotente: repetir sobre un atleta ya borrado (tombstone presente) no falla', async () => {
    await db.athletes.put(archived as never)
    await deleteManagedAthletePermanently('user-1', 'ath_m_a')
    await expect(deleteManagedAthletePermanently('user-1', 'ath_m_a')).resolves.toBeUndefined()
    expect(vi.mocked(syncService.deleteManagedAthleteRemote)).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/__tests__/managedAthletes.delete.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation (agregar a `managedAthletes.ts`)**

```typescript
import { clearQueuedOpsForAthlete } from '../sync/syncQueue'
import {
  clearAthleteDeleteTombstone,
  hasAthleteDeleteTombstone,
  rememberAthleteDeleteTombstone,
} from '../sync/athleteDeleteTombstones'
import { abortPlanGenerationForAthlete } from '../planBuilder/generationJobRunner'
import { clearStoredChatSessionIdForAthlete } from '../../utils/chatSession'

/**
 * Borrado duro en dos fases (spec rev.3; plan rev.2 §Secuencia).
 * Fase A (reversible): barrera exclusiva → tombstone VERIFICADO → abortar runner
 *   (acotado) → esperar ops en vuelo → delete remoto.
 *   'failed' o cualquier throw ⇒ rollback: tombstone fuera, cola intacta, cero purga.
 *   Única pérdida aceptada: una generación en curso queda abortada (relanzable).
 * Fase B (solo 'deleted'/'durably_queued'): suprimir cola (preserva el delete
 * canónico) → purga Dexie en UNA transacción (athletes al final) → chat del atleta.
 */
export async function deleteManagedAthletePermanently(ownerAccountId: string, athleteId: string): Promise<void> {
  const athlete = await db.athletes.get(athleteId)
  if (!athlete) {
    if (hasAthleteDeleteTombstone(ownerAccountId, athleteId)) return // ya borrado: idempotente
    throw new Error('Atleta no encontrado.')
  }
  assertEligibleManagedAthlete(ownerAccountId, athlete)
  if (athlete.status !== 'archived') throw new Error('Solo se puede eliminar un atleta archivado.')

  const releaseBarrier = syncService.acquireAthleteDeletionBarrier(athleteId)
  if (!releaseBarrier) throw new Error('Ya hay un borrado de este atleta en curso.')

  try {
    // ── Fase A (reversible) ──
    const tombstoneToken = rememberAthleteDeleteTombstone(ownerAccountId, athleteId) // lanza si no persiste

    const rollbackTombstone = () => {
      // Con token: no puede pisar el tombstone de un delete de otra pestaña.
      // Verificado: si el clear falla, el atleta queda bloqueado para escritura
      // hasta reintentar el borrado — decirlo, no fingir un rollback limpio.
      if (!clearAthleteDeleteTombstone(ownerAccountId, athleteId, tombstoneToken)) {
        throw new Error(
          'El borrado falló y además no se pudo desbloquear al atleta en este dispositivo. ' +
          'Sus datos están intactos; reintenta el borrado para destrabarlo.',
        )
      }
    }

    let result: Awaited<ReturnType<typeof syncService.deleteManagedAthleteRemote>>
    try {
      await abortPlanGenerationForAthlete(athleteId)
      await syncService.waitForInFlightAthleteOps(athleteId)
      result = await syncService.deleteManagedAthleteRemote(ownerAccountId, athleteId)
    } catch (error) {
      rollbackTombstone()
      throw error
    }
    if (result === 'failed') {
      rollbackTombstone()
      throw new Error('No se pudo eliminar el atleta en el servidor. No se borró nada local; intenta de nuevo.')
    }

    // ── Fase B (destructiva) ──
    clearQueuedOpsForAthlete(ownerAccountId, athleteId)
    await db.transaction('rw', [
      db.sessions, db.dayLogs, db.weekSummaries, db.chatMessages, db.coachProposals,
      db.athleteProfiles, db.trainingPlans, db.trainingPlanWeeks, db.planGenerationJobs,
      db.readinessDaily, db.whoopWorkouts, db.athleteMemberships, db.athleteCoachNotes,
      db.athletes,
    ], async () => {
      await db.sessions.where('athleteId').equals(athleteId).delete()
      await db.dayLogs.where('athleteId').equals(athleteId).delete()
      await db.weekSummaries.where('athleteId').equals(athleteId).delete()
      await db.chatMessages.where('athleteId').equals(athleteId).delete()
      await db.coachProposals.where('athleteId').equals(athleteId).delete()
      await db.athleteProfiles.where('athleteId').equals(athleteId).delete()
      await db.trainingPlans.where('athleteId').equals(athleteId).delete()
      await db.trainingPlanWeeks.where('athleteId').equals(athleteId).delete()
      await db.planGenerationJobs.where('athleteId').equals(athleteId).delete()
      await db.readinessDaily.where('athleteId').equals(athleteId).delete()
      await db.whoopWorkouts.where('athleteId').equals(athleteId).delete()
      await db.athleteMemberships.where('athleteId').equals(athleteId).delete()
      await db.athleteCoachNotes.delete(athleteId) // PK = athleteId
      await db.athletes.delete(athleteId) // al final
    })
    clearStoredChatSessionIdForAthlete(athleteId)
  } finally {
    releaseBarrier()
  }
}
```

Nota: si la transacción de Fase B lanza, el tombstone QUEDA puesto (correcto: el remoto ya está borrado/encolado; reintentar el delete es idempotente y la purga vuelve a correr entera).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/__tests__/managedAthletes.delete.test.ts src/services/__tests__/managedAthletes.test.ts`
Expected: PASS ambos.

- [ ] **Step 5: Commit (lo hace el owner)**

Mensaje sugerido: `feat(coach): borrado duro de atleta en dos fases con barrera exclusiva y rollback`

---

### Task 10: coachScopedReads — lectura pura por atleta

**Files:**
- Create: `src/services/athlete/coachScopedReads.ts`
- Test: `src/services/athlete/__tests__/coachScopedReads.test.ts`

**Interfaces:**
- Consumes: `db.sessions`, `db.athletes`, `athleteIdForOwner`.
- Produces: `getWeekSessionsForAthlete(ownerAccountId: string, athleteId: string, weekStartDate: string): Promise<Session[]>` — valida roster/owner; legacy (`athleteId` ausente) SOLO para el self; orden por `date` y luego `timeBlock`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/services/athlete/__tests__/coachScopedReads.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../db/db'
import { getWeekSessionsForAthlete } from '../coachScopedReads'

const now = Date.now()
function session(partial: Record<string, unknown>) {
  return { timeBlock: 'am', type: 'squash', status: 'planned', title: 'x', durationMin: 60, createdAt: now, updatedAt: now, ...partial }
}

describe('getWeekSessionsForAthlete', () => {
  beforeEach(async () => {
    db.close(); await db.delete(); await db.open()
    await db.athletes.bulkPut([
      { id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', status: 'active', createdAt: now, updatedAt: now },
      { id: 'ath_m_a', ownerAccountId: 'user-1', linkedAccountId: null, status: 'active', createdAt: now, updatedAt: now },
    ] as never)
    await db.sessions.bulkPut([
      session({ id: 's-managed', athleteId: 'ath_m_a', date: '2026-07-14' }),
      session({ id: 's-managed-out', athleteId: 'ath_m_a', date: '2026-07-21' }),
      session({ id: 's-legacy', date: '2026-07-15' }),
      session({ id: 's-self', athleteId: 'ath_user-1', date: '2026-07-16' }),
    ] as never)
  })
  afterEach(() => { db.close() })

  it('gestionado: solo sus filas de la semana, jamás legacy', async () => {
    const rows = await getWeekSessionsForAthlete('user-1', 'ath_m_a', '2026-07-13')
    expect(rows.map((row) => row.id)).toEqual(['s-managed'])
  })

  it('self: incluye sus filas y las legacy de la semana', async () => {
    const rows = await getWeekSessionsForAthlete('user-1', 'ath_user-1', '2026-07-13')
    expect(rows.map((row) => row.id)).toEqual(['s-legacy', 's-self'])
  })

  it('valida roster/owner: atleta ajeno o inexistente lanza', async () => {
    await expect(getWeekSessionsForAthlete('user-2', 'ath_m_a', '2026-07-13')).rejects.toThrow()
    await expect(getWeekSessionsForAthlete('user-1', 'ath_missing', '2026-07-13')).rejects.toThrow()
  })

  it('no escribe: el conteo de sessions no cambia tras leer', async () => {
    const before = await db.sessions.count()
    await getWeekSessionsForAthlete('user-1', 'ath_m_a', '2026-07-13')
    expect(await db.sessions.count()).toBe(before)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/athlete/__tests__/coachScopedReads.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```typescript
// src/services/athlete/coachScopedReads.ts
/**
 * Lecturas multi-atleta por athleteId EXPLÍCITO para el Coach Workspace
 * (spec 2026-07-14). Excepción deliberada y documentada a activeScopeFilter
 * (como sync/export): este módulo NUNCA usa getActiveAthleteId(). Regla legacy
 * idéntica al scope activo: filas unscoped pertenecen SOLO al self.
 */
import { addDays, parseISO, format } from 'date-fns'
import { db } from '../../db/db'
import type { Athlete, Session } from '../../types'
import { athleteIdForOwner } from './athleteScopeMigration'

async function assertRosterAthlete(ownerAccountId: string, athleteId: string): Promise<Athlete> {
  const athlete = await db.athletes.get(athleteId)
  if (!athlete || athlete.ownerAccountId !== ownerAccountId) {
    throw new Error('El atleta no pertenece a tu roster.')
  }
  return athlete
}

function weekEndISO(weekStartDate: string): string {
  return format(addDays(parseISO(weekStartDate), 6), 'yyyy-MM-dd')
}

/** Lectura pura Dexie de las sesiones de una semana de un atleta del roster. */
export async function getWeekSessionsForAthlete(
  ownerAccountId: string,
  athleteId: string,
  weekStartDate: string,
): Promise<Session[]> {
  await assertRosterAthlete(ownerAccountId, athleteId)
  const isSelf = athleteId === athleteIdForOwner(ownerAccountId)
  const rows = await db.sessions
    .where('date')
    .between(weekStartDate, weekEndISO(weekStartDate), true, true)
    .toArray()
  return rows
    .filter((row) => row.athleteId === athleteId || (row.athleteId == null && isSelf))
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeBlock.localeCompare(b.timeBlock))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/athlete/__tests__/coachScopedReads.test.ts` y `npx vitest run src/services/athlete/` (guard test de `'default'`).
Expected: PASS.

- [ ] **Step 5: Commit (lo hace el owner)**

Mensaje sugerido: `feat(coach): lectura semanal por atleta explícito (coachScopedReads)`

---

### Task 11: Hidratación remota de semana por atleta (regla real de tombstones)

**Files:**
- Modify: `src/services/syncService.ts` (extraer helper de tombstone de sesión + `pullWeekSessionsForAthlete`)
- Modify: `src/services/athlete/coachScopedReads.ts` (`hydrateWeekForAthlete`)
- Test: `src/services/__tests__/pullWeekSessionsForAthlete.test.ts` (nuevo); ampliar `coachScopedReads.test.ts`

**Interfaces:**
- Consumes: `getSupabase`, `rowToSession`, tombstones de sesión (privados de syncService — por eso la función vive ahí), Task 1 (`hasAthleteDeleteTombstone`), `assertRosterAthlete` (Task 10).
- Produces:
  - syncService: helper interno `resolveSessionAgainstTombstone(userId, remote): 'skip' | 'accept'` — extrae de `mergeSessions` (L2500) la decisión skip/accept: `deletedAt >= remote.updatedAt` ⇒ `'skip'`; remoto más nuevo ⇒ `clearSessionDeleteTombstone` y `'accept'`. **El re-push del delete remoto NO es parte del helper** — es responsabilidad del caller: `mergeSessions` lo conserva (su `pendingWrites.push(() => deleteRow(...))` en el caso `'skip'`), la hidratación NO re-pushea — solo respeta el tombstone local. Decisión deliberada: la hidratación es una lectura on-demand de UI; disparar deletes remotos desde ahí mezclaría responsabilidades y el full sync ya lo hace.
  - syncService: `export async function pullWeekSessionsForAthlete(ownerAccountId: string, athleteId: string, weekStartDate: string, weekEndDate: string, opts: { includeLegacy: boolean }): Promise<void>`
  - coachScopedReads: `export async function hydrateWeekForAthlete(ownerAccountId: string, athleteId: string, weekStartDate: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/services/__tests__/pullWeekSessionsForAthlete.test.ts — harness fake-supabase de Task 4
it('gestionado: consulta por user_id + athlete_id + rango de fechas y hace LWW en Dexie', async () => {
  // remoto: s1 (updated_at nuevo), s2 (updated_at viejo); local: s2 más nuevo
  // assert selectCalls: eq user_id, eq athlete_id, gte date, lte date
  // assert: s1 remoto insertado; s2 conserva la versión local
})

it('self con includeLegacy: usa or(athlete_id.eq...,athlete_id.is.null) e inserta filas legacy', async () => {})

it('tombstone de sesión: remoto MÁS VIEJO que el tombstone se salta; remoto MÁS NUEVO limpia el tombstone y entra', async () => {
  // misma regla que mergeSessions (deletedAt >= remote.updatedAt ⇒ skip)
})

it('atleta con tombstone de borrado: no escribe NADA aunque el pull ya estuviera en vuelo', async () => {
  // poner tombstone de atleta entre el fetch y el put (mock del select con hook) → 0 escrituras
})

it('sin backend configurado (isEnabled false) retorna sin tocar Dexie', async () => {})
```

En `coachScopedReads.test.ts`:

```typescript
it('hydrateWeekForAthlete valida roster antes de delegar', async () => {
  await expect(hydrateWeekForAthlete('user-2', 'ath_m_a', '2026-07-13')).rejects.toThrow()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/services/__tests__/pullWeekSessionsForAthlete.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

(a) Extraer el helper en syncService (y usarlo en `mergeSessions` sin cambiar semántica):

```typescript
/**
 * Regla única de tombstones de sesión (extraída de mergeSessions):
 * tombstone >= remote.updatedAt ⇒ 'skip' (el caller decide si re-pushea el delete);
 * remoto más nuevo ⇒ limpia el tombstone y 'accept'.
 */
function resolveSessionAgainstTombstone(userId: string, remote: Session): 'skip' | 'accept' {
  const tombstones = getSessionDeleteTombstones(userId)
  const deletedAt = tombstones[remote.id]
  if (typeof deletedAt === 'number') {
    if (deletedAt >= remote.updatedAt) return 'skip'
    clearSessionDeleteTombstone(userId, remote.id)
  }
  return 'accept'
}
```

(b) `pullWeekSessionsForAthlete`:

```typescript
/**
 * Pull remoto explícito de las sesiones de UNA semana de UN atleta (Planificación,
 * spec 2026-07-14). No usa resolveReadScope() ni toca el contexto activo.
 * `includeLegacy` (solo self) trae también athlete_id IS NULL del owner.
 * Respeta la regla REAL de tombstones de sesión (helper compartido) y el
 * tombstone de borrado de atleta (por si el pull termina después de un borrado).
 */
export async function pullWeekSessionsForAthlete(
  ownerAccountId: string,
  athleteId: string,
  weekStartDate: string,
  weekEndDate: string,
  opts: { includeLegacy: boolean },
): Promise<void> {
  if (!isEnabled()) return
  let query = getSupabase().from('sessions').select('*')
    .eq('user_id', ownerAccountId)
    .gte('date', weekStartDate)
    .lte('date', weekEndDate)
  query = opts.includeLegacy
    ? query.or(`athlete_id.eq.${athleteId},athlete_id.is.null`)
    : query.eq('athlete_id', athleteId)
  const { data, error } = await withRequestTimeout(query, 'sessions.pull_week_for_athlete')
  if (error) {
    syncLog('pullWeekSessionsForAthlete:error', { error: error.message }, 'warn')
    throw error
  }
  if (!data?.length) return
  for (const row of data as Record<string, unknown>[]) {
    const remote = rowToSession(row)
    if (resolveSessionAgainstTombstone(ownerAccountId, remote) === 'skip') continue
    // Lease por escritura (Task 5): chequeo de tombstone de atleta + registro en
    // vuelo + inicio del put SIN ceder control — cierra la ventana pull-tardío
    // (un delete que arranca entre el fetch y el put espera este lease o lo veta).
    const write = withAthleteWriteLease(athleteId, async () => {
      const local = await db.sessions.get(remote.id)
      if (!local || remote.updatedAt > (local.updatedAt ?? 0)) {
        await db.sessions.put(remote)
      }
    })
    if (!write) return // atleta en borrado: no escribir nada más de este pull
    await write
  }
}
```

(c) `hydrateWeekForAthlete` en coachScopedReads:

```typescript
import { pullWeekSessionsForAthlete } from '../syncService'

/** Hidratación on-demand: solo escribe `sessions` de ese atleta (pull LWW). */
export async function hydrateWeekForAthlete(
  ownerAccountId: string,
  athleteId: string,
  weekStartDate: string,
): Promise<void> {
  await assertRosterAthlete(ownerAccountId, athleteId)
  const isSelf = athleteId === athleteIdForOwner(ownerAccountId)
  await pullWeekSessionsForAthlete(ownerAccountId, athleteId, weekStartDate, weekEndISO(weekStartDate), {
    includeLegacy: isSelf,
  })
}
```

Verificar que no se cree ciclo de imports (syncService NO importa coachScopedReads).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/__tests__/pullWeekSessionsForAthlete.test.ts src/services/athlete/__tests__/coachScopedReads.test.ts src/services/__tests__/syncService.test.ts`
Expected: PASS (incluida la suite existente: el refactor del helper no cambia `mergeSessions`).

- [ ] **Step 5: Commit (lo hace el owner)**

Mensaje sugerido: `feat(coach): hidratación remota de semana por atleta con regla real de tombstones`

---

### Task 12: UI de gestión de roster (archivar / archivados / eliminar)

**Files:**
- Modify: `src/components/coach/coachWorkspaceTypes.ts`
- Create: `src/components/coach/deleteConfirmation.ts` (+ test)
- Modify: `src/components/coach/CoachRosterPanel.tsx` (+ ampliar test)
- Modify: `src/pages/CoachWorkspacePage.tsx` (+ ampliar test)

**Interfaces:**
- Consumes: Task 8/9, lock existente, `switchActiveAthlete`, `getSelfAthleteId`.
- Produces:
  - `type PendingAthleteAction = { kind: 'week' | 'plan' | 'trainAs' | 'archive' | 'restore' | 'delete'; athleteId: string } | { kind: 'create'; athleteId: null }`
  - `isDeleteConfirmed(input: string, displayName: string | null | undefined): boolean`
  - Props nuevas de `CoachRosterPanel`: `archivedAthletes: Athlete[]`, `onArchive/onRestore/onDelete(athleteId)`, test-only `initialDeleteTargetId?: string`.
  - **Elegibilidad en UI:** Archivar solo para no-self con `linkedAccountId == null`; en Archivados, Restaurar/Eliminar SOLO para `linkedAccountId == null` (defensa: un atleta podría quedar archivado y reclamado después).

- [ ] **Step 1: Write the failing test de la función pura**

```typescript
// src/components/coach/__tests__/deleteConfirmation.test.ts
import { describe, expect, it } from 'vitest'
import { isDeleteConfirmed } from '../deleteConfirmation'

describe('isDeleteConfirmed', () => {
  it('exige el nombre exacto (trim + case-insensitive)', () => {
    expect(isDeleteConfirmed('Ana', 'Ana')).toBe(true)
    expect(isDeleteConfirmed('  ana  ', 'Ana')).toBe(true)
    expect(isDeleteConfirmed('An', 'Ana')).toBe(false)
    expect(isDeleteConfirmed('', 'Ana')).toBe(false)
  })
  it('sin displayName nunca habilita', () => {
    expect(isDeleteConfirmed('', null)).toBe(false)
    expect(isDeleteConfirmed('', undefined)).toBe(false)
    expect(isDeleteConfirmed('   ', '   ')).toBe(false)
  })
})
```

- [ ] **Step 2: Implement `deleteConfirmation.ts` y verificar**

```typescript
// src/components/coach/deleteConfirmation.ts
/** Habilitación del borrado definitivo: el usuario debe escribir el nombre del atleta. */
export function isDeleteConfirmed(input: string, displayName: string | null | undefined): boolean {
  const expected = (displayName ?? '').trim().toLowerCase()
  if (!expected) return false
  return input.trim().toLowerCase() === expected
}
```

Run: `npx vitest run src/components/coach/__tests__/deleteConfirmation.test.ts` → PASS.

- [ ] **Step 3: Extender tipos**

```typescript
export type PendingAthleteAction =
  | { kind: 'week' | 'plan' | 'trainAs' | 'archive' | 'restore' | 'delete'; athleteId: string }
  | { kind: 'create'; athleteId: null }
```

- [ ] **Step 4: CoachRosterPanel — markup tests primero, luego UI**

Tests a ampliar (renderToStaticMarkup):

```typescript
it('muestra Archivar solo en gestionados no reclamados (no self, no vinculados)', () => {
  // self + gestionado (linkedAccountId null) + reclamado (linkedAccountId 'user-9') → exactamente 1 "Archivar"
})

it('sección Archivados (N) con Restaurar y Eliminar definitivamente solo para no vinculados', () => {
  // archivedAthletes: 1 no vinculado + 1 vinculado → 'Archivados (2)', 1 'Restaurar', 1 'Eliminar definitivamente',
  // y el vinculado muestra texto 'Cuenta vinculada' sin acciones
})

it('modal de confirmación: estructura con input y botón deshabilitado', () => {
  // initialDeleteTargetId → nombre del atleta + <input> + botón confirmar disabled
})

it('sin archivados: la sección no aparece', () => {})
```

Implementación (esqueleto de agregados; mantener clases/estilos del panel):

```tsx
// Props nuevas: archivedAthletes, onArchive, onRestore, onDelete, initialDeleteTargetId?
const [deleteTargetId, setDeleteTargetId] = useState<string | null>(initialDeleteTargetId ?? null)
const [deleteInput, setDeleteInput] = useState('')
const deleteTarget = archivedAthletes.find((athlete) => athlete.id === deleteTargetId) ?? null
const canManage = (athlete: Athlete) => athlete.id !== selfId && athlete.linkedAccountId == null

// Fila del roster activo:
{canManage(athlete) && (
  <button type="button" disabled={isLocked} onClick={() => onArchive(athlete.id)}
    className="text-xs text-ink-muted underline">Archivar</button>
)}

// Sección Archivados:
{archivedAthletes.length > 0 && (
  <details className="mt-6">
    <summary className="cursor-pointer text-sm font-semibold text-ink-muted">
      Archivados ({archivedAthletes.length})
    </summary>
    <div className="mt-3 space-y-3">
      {archivedAthletes.map((athlete) => (
        <div key={athlete.id} data-archived-row={athlete.id}
          className="flex items-center justify-between rounded-2xl border border-ink/10 px-4 py-3">
          <span className="text-sm text-ink-muted">{athlete.displayName ?? 'Atleta'}</span>
          {athlete.linkedAccountId == null ? (
            <div className="flex gap-3">
              <button type="button" disabled={isLocked} onClick={() => onRestore(athlete.id)}
                className="text-xs underline">Restaurar</button>
              <button type="button" disabled={isLocked}
                onClick={() => { setDeleteTargetId(athlete.id); setDeleteInput('') }}
                className="text-xs text-rose-300 underline">Eliminar definitivamente</button>
            </div>
          ) : (
            <span className="text-xs text-ink-muted">Cuenta vinculada</span>
          )}
        </div>
      ))}
    </div>
  </details>
)}

// Modal:
{deleteTarget && (
  <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div className="w-full max-w-sm rounded-2xl border border-rose-500/25 bg-surface p-5">
      <h3 className="font-display text-lg font-bold text-ink">Eliminar definitivamente</h3>
      <p className="mt-2 text-sm text-ink-muted">
        Vas a borrar todos los datos de <strong>{deleteTarget.displayName ?? 'este atleta'}</strong>,
        locales y del servidor. Esto no se puede deshacer. Escribe el nombre para confirmar.
      </p>
      <input value={deleteInput} onChange={(event) => setDeleteInput(event.target.value)}
        placeholder={deleteTarget.displayName ?? ''}
        className="mt-3 w-full rounded-xl border border-ink/15 bg-transparent px-3 py-2 text-sm" />
      <div className="mt-4 flex justify-end gap-3">
        <button type="button" onClick={() => setDeleteTargetId(null)} className="text-sm underline">Cancelar</button>
        <button type="button"
          disabled={isLocked || !isDeleteConfirmed(deleteInput, deleteTarget.displayName)}
          onClick={() => { onDelete(deleteTarget.id); setDeleteTargetId(null) }}
          className="rounded-xl bg-rose-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">
          Eliminar
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 5: CoachWorkspacePage — wiring (test de markup con `initialArchivedAthletes` primero)**

```tsx
const [archivedAthletes, setArchivedAthletes] = useState<Athlete[]>(initialArchivedAthletes ?? [])
// En el useEffect del roster: listArchivedAthletes(user.id) → setArchivedAthletes

async function withRosterAction(
  athleteId: string,
  kind: 'archive' | 'restore' | 'delete',
  run: () => Promise<unknown>,
  failureMessage: string,
) {
  if (!user?.id) return
  if (!acquireAthleteActionLock()) return
  setActionMessage(null)
  setPendingAthleteAction({ athleteId, kind })
  try {
    // Nunca archivar/borrar al atleta ACTIVO: switch al self primero; si falla, se aborta.
    if ((kind === 'archive' || kind === 'delete') && athleteId === activeAthleteId) {
      const selfId = getSelfAthleteId()
      if (!selfId || !(await switchActiveAthlete(user.id, selfId))) {
        setActionMessage('No se pudo volver a tu perfil antes de la acción. Intenta de nuevo.')
        return
      }
    }
    await run()
    setAthletes(await listOwnedAthletes(user.id))
    setArchivedAthletes(await listArchivedAthletes(user.id))
  } catch (error) {
    setActionMessage(error instanceof Error ? error.message : failureMessage)
  } finally {
    releaseAthleteActionLock()
    setPendingAthleteAction(null)
  }
}

<CoachRosterPanel
  {/* props existentes */}
  archivedAthletes={archivedAthletes}
  onArchive={(athleteId) => void withRosterAction(athleteId, 'archive', () => archiveManagedAthlete(user.id, athleteId), 'No se pudo archivar.')}
  onRestore={(athleteId) => void withRosterAction(athleteId, 'restore', () => restoreManagedAthlete(user.id, athleteId), 'No se pudo restaurar.')}
  onDelete={(athleteId) => void withRosterAction(athleteId, 'delete', () => deleteManagedAthletePermanently(user.id, athleteId), 'No se pudo eliminar.')}
/>
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/components/coach/ src/pages/CoachWorkspacePage.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit (lo hace el owner)**

Mensaje sugerido: `feat(coach): UI de archivar/restaurar/eliminar atletas en el tab Alumnos`

---

### Task 13: Tab Planificación (panel + helpers + nav)

**Files:**
- Create: `src/components/coach/planningWeek.ts` (+ test)
- Create: `src/components/coach/CoachPlanningPanel.tsx` (+ test)
- Modify: `src/components/coach/coachWorkspaceTypes.ts` (`planificacion` deja de ser `comingSoon`)
- Modify: `src/pages/CoachWorkspacePage.tsx`
- Modify: tests existentes (`pronto` 3 → 2; placeholder de Planificación → panel real)

**Interfaces:**
- Consumes: Task 10/11, helpers de `src/utils/date.ts` (`currentWeekStartISO`, `toISO`, `fromISO`, `nextWeek`, `prevWeek`, `formatWeekRange`, `formatDay`, `formatDayNum`).
- Produces:
  - `sessionStatusLabel(status: SessionStatus): string` — `planned→'Planificada'`, `completed→'Completada'`, `adjusted→'Ajustada'`, `skipped→'Saltada'`.
  - `groupSessionsByDay(sessions: Session[], weekStartISO: string): Array<{ date: string; sessions: Session[] }>` — 7 entradas.
  - `CoachPlanningPanel` con props `{ athletes, selfId, activeAthleteId, ownerAccountId, pendingAction, onTrainAs, initialSessions?, initialPhase?, initialNotice? }` (las `initial*` son test-only).
- **Comportamiento requerido (spec + review):** navegación anterior / **Hoy** / siguiente; sin cache + hidratación inicial en curso ⇒ "cargando" (no empty state); hidratación fallida CON cache ⇒ datos locales + **aviso discreto**; respuestas tardías descartadas invalidando el epoch en el **cleanup del useEffect** (no recién al próximo load).

- [ ] **Step 1: Write the failing tests de helpers**

```typescript
// src/components/coach/__tests__/planningWeek.test.ts
import { describe, expect, it } from 'vitest'
import { groupSessionsByDay, sessionStatusLabel } from '../planningWeek'
import type { Session } from '../../../types'

describe('sessionStatusLabel', () => {
  it('cubre los 4 estados reales', () => {
    expect(sessionStatusLabel('planned')).toBe('Planificada')
    expect(sessionStatusLabel('completed')).toBe('Completada')
    expect(sessionStatusLabel('adjusted')).toBe('Ajustada')
    expect(sessionStatusLabel('skipped')).toBe('Saltada')
  })
})

describe('groupSessionsByDay', () => {
  it('devuelve 7 días y agrupa por fecha', () => {
    const sessions = [
      { id: 'a', date: '2026-07-14', timeBlock: 'am' },
      { id: 'b', date: '2026-07-14', timeBlock: 'pm' },
      { id: 'c', date: '2026-07-19', timeBlock: 'am' },
    ] as Session[]
    const grouped = groupSessionsByDay(sessions, '2026-07-13')
    expect(grouped).toHaveLength(7)
    expect(grouped[0]).toMatchObject({ date: '2026-07-13', sessions: [] })
    expect(grouped[1].sessions.map((session) => session.id)).toEqual(['a', 'b'])
    expect(grouped[6].sessions.map((session) => session.id)).toEqual(['c'])
  })
})
```

- [ ] **Step 2: Implement helpers y verificar**

```typescript
// src/components/coach/planningWeek.ts
import { addDays, format, parseISO } from 'date-fns'
import type { Session, SessionStatus } from '../../types'

const STATUS_LABELS: Record<SessionStatus, string> = {
  planned: 'Planificada',
  completed: 'Completada',
  adjusted: 'Ajustada',
  skipped: 'Saltada',
}

export function sessionStatusLabel(status: SessionStatus): string {
  return STATUS_LABELS[status] ?? status
}

export function groupSessionsByDay(
  sessions: Session[],
  weekStartISO: string,
): Array<{ date: string; sessions: Session[] }> {
  const start = parseISO(weekStartISO)
  return Array.from({ length: 7 }, (_, index) => {
    const date = format(addDays(start, index), 'yyyy-MM-dd')
    return { date, sessions: sessions.filter((session) => session.date === date) }
  })
}
```

Run: `npx vitest run src/components/coach/__tests__/planningWeek.test.ts` → PASS.

- [ ] **Step 3: Write the failing markup tests del panel**

```typescript
// src/components/coach/__tests__/CoachPlanningPanel.test.tsx — renderToStaticMarkup
it('muestra selector, botones anterior/Hoy/siguiente, rango de semana y sesiones con estado', () => {
  // initialSessions con una planned y una completed → 'Planificada' y 'Completada'; aria-labels de nav + 'Hoy'
})

it('sin cache y con hidratación en curso muestra cargando, NO el empty state', () => {
  // initialPhase 'loading' + [] → 'Cargando' presente; 'sin sesiones' ausente
})

it('semana vacía ya hidratada muestra empty state honesto', () => {
  // initialPhase 'ready' + [] → 'sin sesiones'
})

it('hidratación fallida con cache: datos visibles + aviso discreto', () => {
  // initialPhase 'ready' + initialSessions no vacío + initialNotice → aviso 'No se pudo actualizar' presente
})

it('error sin cache muestra banner con Reintentar', () => {})

it('CTA Entrenar como este atleta presente', () => {})
```

- [ ] **Step 4: Implement `CoachPlanningPanel.tsx`**

```tsx
// src/components/coach/CoachPlanningPanel.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Athlete, Session } from '../../types'
import type { PendingAthleteAction } from './coachWorkspaceTypes'
import { getWeekSessionsForAthlete, hydrateWeekForAthlete } from '../../services/athlete/coachScopedReads'
import { currentWeekStartISO, fromISO, toISO, nextWeek, prevWeek, formatWeekRange, formatDay, formatDayNum } from '../../utils/date'
import { groupSessionsByDay, sessionStatusLabel } from './planningWeek'

type Phase = 'loading' | 'ready' | 'error'

interface CoachPlanningPanelProps {
  athletes: Athlete[]
  selfId: string | null
  activeAthleteId: string | null
  ownerAccountId: string
  pendingAction: PendingAthleteAction | null
  onTrainAs: (athleteId: string) => void
  /** Solo tests (renderToStaticMarkup no ejecuta efectos). */
  initialSessions?: Session[]
  initialPhase?: Phase
  initialNotice?: boolean
}

export default function CoachPlanningPanel({
  athletes, selfId, activeAthleteId, ownerAccountId, pendingAction, onTrainAs,
  initialSessions, initialPhase, initialNotice,
}: CoachPlanningPanelProps) {
  const isTestMode = initialSessions !== undefined || initialPhase !== undefined
  const [selectedId, setSelectedId] = useState<string | null>(activeAthleteId ?? selfId)
  const [weekStart, setWeekStart] = useState<string>(currentWeekStartISO())
  const [sessions, setSessions] = useState<Session[]>(initialSessions ?? [])
  const [phase, setPhase] = useState<Phase>(initialPhase ?? 'loading')
  const [staleNotice, setStaleNotice] = useState<boolean>(initialNotice ?? false)
  // Epoch de selección: el CLEANUP del useEffect lo invalida al cambiar atleta/semana
  // o al desmontar, de modo que una respuesta tardía nunca pise la selección nueva.
  const epochRef = useRef(0)

  const load = useCallback(async (athleteId: string, week: string, epoch: number) => {
    const isCurrent = () => epochRef.current === epoch
    try {
      const cached = await getWeekSessionsForAthlete(ownerAccountId, athleteId, week)
      if (!isCurrent()) return
      setSessions(cached)
      setStaleNotice(false)
      // Sin cache + hidratación en curso ⇒ seguimos en 'loading' (no afirmar semana vacía).
      setPhase(cached.length > 0 ? 'ready' : 'loading')
      try {
        await hydrateWeekForAthlete(ownerAccountId, athleteId, week)
        if (!isCurrent()) return
        setSessions(await getWeekSessionsForAthlete(ownerAccountId, athleteId, week))
        setPhase('ready')
      } catch {
        if (!isCurrent()) return
        if (cached.length > 0) {
          setStaleNotice(true) // aviso discreto: datos locales, sin actualizar
          setPhase('ready')
        } else {
          setPhase('error')
        }
      }
    } catch {
      if (isCurrent()) setPhase('error')
    }
  }, [ownerAccountId])

  useEffect(() => {
    if (isTestMode) return
    if (!selectedId) return
    const epoch = ++epochRef.current
    setPhase('loading')
    setStaleNotice(false)
    void load(selectedId, weekStart, epoch)
    return () => { epochRef.current++ } // invalida respuestas tardías al cambiar selección/desmontar
  }, [selectedId, weekStart, load, isTestMode])

  const grouped = groupSessionsByDay(sessions, weekStart)
  const selected = athletes.find((athlete) => athlete.id === selectedId) ?? null
  const isLocked = pendingAction !== null
  const isEmpty = phase === 'ready' && sessions.length === 0

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label htmlFor="planning-athlete" className="text-sm text-ink-muted">Atleta</label>
        <select id="planning-athlete" value={selectedId ?? ''} disabled={isLocked}
          onChange={(event) => setSelectedId(event.target.value)}
          className="rounded-xl border border-ink/15 bg-transparent px-3 py-2 text-sm">
          {athletes.map((athlete) => (
            <option key={athlete.id} value={athlete.id}>
              {athlete.id === selfId ? 'Tú' : (athlete.displayName ?? 'Atleta')}
            </option>
          ))}
        </select>
        {selected && selected.id !== activeAthleteId && (
          <button type="button" disabled={isLocked} onClick={() => onTrainAs(selected.id)}
            className="text-sm underline">Entrenar como este atleta</button>
        )}
      </div>

      <div className="mb-4 flex items-center gap-3">
        <button type="button" aria-label="Semana anterior"
          onClick={() => setWeekStart(toISO(prevWeek(fromISO(weekStart))))} className="text-sm underline">←</button>
        <span className="text-sm font-semibold text-ink">{formatWeekRange(fromISO(weekStart))}</span>
        <button type="button" aria-label="Semana siguiente"
          onClick={() => setWeekStart(toISO(nextWeek(fromISO(weekStart))))} className="text-sm underline">→</button>
        {weekStart !== currentWeekStartISO() && (
          <button type="button" onClick={() => setWeekStart(currentWeekStartISO())}
            className="text-sm underline">Hoy</button>
        )}
      </div>

      {staleNotice && (
        <p className="mb-3 text-xs text-amber-200/80">
          No se pudo actualizar desde el servidor; estás viendo los datos guardados en este dispositivo.
        </p>
      )}

      {phase === 'error' && (
        <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          No pudimos cargar la semana.
          <button type="button" className="ml-2 font-semibold underline"
            onClick={() => {
              if (!selectedId) return
              const epoch = ++epochRef.current
              setPhase('loading')
              void load(selectedId, weekStart, epoch)
            }}>
            Reintentar
          </button>
        </div>
      )}

      {phase === 'loading' && <p className="text-sm text-ink-muted">Cargando la semana…</p>}

      {isEmpty && <p className="text-sm text-ink-muted">Esta semana no tiene sesiones planificadas.</p>}

      {phase === 'ready' && sessions.length > 0 && (
        <div className="space-y-4">
          {grouped.map(({ date, sessions: daySessions }) => daySessions.length > 0 && (
            <div key={date}>
              <h3 className="mb-2 text-xs font-semibold uppercase text-ink-muted">
                {formatDay(fromISO(date))} {formatDayNum(fromISO(date))}
              </h3>
              <div className="space-y-2">
                {daySessions.map((session) => (
                  <div key={session.id} className="rounded-2xl border border-ink/10 px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-ink">{session.title}</span>
                      <span className="text-xs text-ink-muted">{sessionStatusLabel(session.status)}</span>
                    </div>
                    <p className="text-xs text-ink-muted">{session.type} · {session.durationMin} min</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Nav + page wiring + tests existentes**

- `coachWorkspaceTypes.ts`: `{ key: 'planificacion', label: 'Planificación', comingSoon: false }`.
- `CoachWorkspacePage.tsx`:

```tsx
{activeTab === 'planificacion' && user?.id && (
  <CoachPlanningPanel
    athletes={athletes}
    selfId={selfId}
    activeAthleteId={activeAthleteId}
    ownerAccountId={user.id}
    pendingAction={pendingAthleteAction}
    onTrainAs={(athleteId) => void handleAthleteAction(athleteId, 'trainAs', ROUTES.HOME)}
  />
)}
```

- Tests existentes: `CoachWorkspaceNav` — conteo de `pronto` pasa de 3 a **2**; `CoachWorkspacePage.test.tsx` — el tab planificación asserta el panel real (`id="planning-athlete"`); Biblioteca/Asistente conservan placeholder.

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/components/coach/ src/pages/CoachWorkspacePage.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit (lo hace el owner)**

Mensaje sugerido: `feat(coach): tab Planificación con vista semanal read-only multi-atleta`

---

### Task 14: Smoke e2e + verificación final

**Files:**
- Modify: `scripts/e2e-coach-test.mjs`

- [ ] **Step 1: Extender el smoke (archivar→restaurar, robusto)**

En el bloque `--apply` existente, después del paso de creación/switch:

- Identificar la fila del atleta creado por su id (`data-athlete-row="<id>"`), NO por conteos.
- Click "Archivar" → esperar que `data-athlete-row="<id>"` desaparezca del roster y aparezca `data-archived-row="<id>"` (sin asumir `Archivados (1)`: puede haber archivados previos).
- Click "Restaurar" → esperar que vuelva `data-athlete-row="<id>"`.
- **Envolver en `try/finally`:** si cualquier assert falla después de archivar, el `finally` intenta restaurar al atleta (si sigue archivado) antes de propagar el error — el smoke no debe dejar el roster mutado.
- NO smokear el borrado duro (destruiría datos remotos reales); queda cubierto por unit tests.

- [ ] **Step 2: Verificación completa**

Run: `npm run lint && npm test && npm run build`
Expected: lint OK, suite completa verde, build OK. Si `npm test` revela regresiones en suites no tocadas (p. ej. `syncService.test.ts` por el tracking nuevo), arreglarlas antes de cerrar.

- [ ] **Step 3: Actualizar documentación de estado**

- `CLAUDE.md`: agregar a "Bloques recientes relevantes" la gestión de roster (archivar/restaurar/borrado duro con tombstone+barrera) + tab Planificación read-only (`coachScopedReads`); corregir la referencia del modelo local a Dexie **v17**.
- `PROJECT_REVIEW_AND_ROADMAP.md`: sección breve con el cierre de esta pieza (patrón de las secciones 7/8).

- [ ] **Step 4: Commit final (lo hace el owner)**

Mensaje sugerido: `feat(coach): roster management + Planificación — smoke e2e y docs`

---

## Notas de ejecución

- Orden estricto: Tasks 1→9 en cadena (infra sync → dominio); 10-11 (lecturas) solo dependen de convenciones; 12 depende de 8-9; 13 depende de 10-11; 14 al final.
- Si el harness de mocks de `syncService.test.ts` resulta difícil de replicar en los archivos nuevos, es aceptable agregar los tests de sync al archivo existente respetando su estructura — el contrato a verificar es el de cada test listado, no el nombre del archivo.
- Riesgos a vigilar:
  - Task 5: el tracking envuelve `upsertRow`, `pushSessionCompletion` y el drain; verificar que no cambie el tipo de retorno ni el manejo de errores observable (la suite existente lo protege). El lease en los merges (paso f) toca el hot path del pull: sin tombstones presentes debe ser un no-op de costo despreciable (un `has*` + un wrap de promesa por fila escrita).
  - Task 4: el filtro en `fetchAll` (en `syncSupabase.ts`, no en syncService) toca TODOS los merges hijos y NO debe alterar el corte de paginación (tamaño de página sin filtrar); correr la suite completa de sync tras implementarlo.
  - Task 11: el refactor de la decisión skip/accept a helper compartido NO debe cambiar la semántica de `mergeSessions` — en particular su re-push del delete remoto en `'skip'` queda intacto (sus tests existentes lo verifican).
  - Garantías de concurrencia: exclusividad de barrera, tracking y `durably_queued` son single-tab por diseño declarado (Global Constraints); no "arreglar" esto con Web Locks durante la ejecución sin decisión del owner.

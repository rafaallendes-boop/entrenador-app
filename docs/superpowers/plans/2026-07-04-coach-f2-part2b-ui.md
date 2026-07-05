# Coach F2-lite Parte 2b — Switcher, Roster y Multi-Atleta Operativo — Implementation Plan

> **Ejecución:** task-by-task, en orden. Cada task: test rojo primero → implementación → test verde → lint → commit. Steps con checkboxes (`- [ ]`) para tracking.

**Goal:** Hacer operable la capa multi-atleta de 2a: allowlist coach, switch seguro (sin contaminación por promesas tardías), roster `/coach`, onboarding athlete-aware y migración `010` para check-ins multi-atleta.

**Architecture:** Un `switchEpoch` en el holder (`activeAthlete.ts`) actúa como guard común: toda operación async captura el epoch al inicio y descarta su resultado si cambió. Cada store expone `resetForAthleteSwitch()` (abort + invalidación + estado limpio) llamado por el servicio `switchActiveAthlete` ANTES de mover el holder; el remount por `key={activeAthleteId}` en `AppShell` es la segunda red. La UI (CoachContextBar + roster) va al final, gated por `VITE_COACH_ACCOUNTS`.

**Tech Stack:** React + TS + Zustand + Dexie (fake-indexeddb en tests) + vitest (`renderToStaticMarkup` para componentes) + Supabase (SQL manual).

**Spec:** `docs/superpowers/specs/2026-07-04-coach-f2-part2b-ui-design.md`

## Global Constraints

- **Commits por el ejecutor, autorizados explícitamente por el owner para este plan (2026-07-04):** cada task cierra con verificación (`npm run lint` + tests del task) y luego commit convencional (`feat:`/`fix:`/`test:` en español, un commit por task). Sin `git push` salvo pedido explícito del owner.
- Nunca el literal `'default'` fuera de `activeAthlete.ts`; usar `ATHLETE_PROFILE_LOCAL_ID` / `getActiveAthleteId()` / `getSelfAthleteId()` (hay guard test).
- Lecturas de sessions/dayLogs/weekSummaries/proposals/chat fuera de sync/export → `filterRowsToActiveScope`/`isRowInActiveScope`; creaciones locales → `withActiveAthleteStamp`. Legacy/unscoped pertenece SOLO al self.
- Patrón de test Dexie: `db.close(); await db.delete(); await db.open()` por test (fake-indexeddb instalado).
- Copys de UI en español humano (roadmap G): nada de jerga técnica visible.
- No tocar `promptBuilder.ts`. No duplicar lógica de sync.
- Orden del plan = orden de ejecución: **contaminación primero (Tasks 1–5), UI después (Tasks 6–9)**, sync/SQL al final (10–11), rollout manual (12).
- Verificación final de cada task: `npm run lint && npx vitest run <archivos del task>`. Antes del cierre total: `npm run lint && npm test && npm run build`.

---

### Task 1: Switch epoch en el holder

**Files:**
- Modify: `src/services/athlete/activeAthlete.ts`
- Test: `src/services/__tests__/athleteSwitchEpoch.test.ts`

**Interfaces:**
- Produces: `getSwitchEpoch(): number`, `bumpSwitchEpoch(): number` (exportadas desde `activeAthlete.ts`). Tasks 3, 4 y 5 las consumen.

- [ ] **Step 1: Test que falla**

```ts
// src/services/__tests__/athleteSwitchEpoch.test.ts
import { describe, expect, it } from 'vitest'
import { bumpSwitchEpoch, getSwitchEpoch } from '../athlete/activeAthlete'

describe('switch epoch', () => {
  it('bumpSwitchEpoch incrementa y getSwitchEpoch lo refleja', () => {
    const before = getSwitchEpoch()
    const bumped = bumpSwitchEpoch()
    expect(bumped).toBe(before + 1)
    expect(getSwitchEpoch()).toBe(bumped)
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/services/__tests__/athleteSwitchEpoch.test.ts`
Expected: FAIL — `bumpSwitchEpoch` no exportada.

- [ ] **Step 3: Implementación mínima**

Agregar al final de `src/services/athlete/activeAthlete.ts`:

```ts
// Switch epoch (spec 2b §3.1): guard común para promesas tardías. Toda
// operación async captura el epoch al inicio y descarta su resultado si
// cambió — switchActiveAthlete lo bumpea ANTES de resetear stores.
let switchEpoch = 0

export function getSwitchEpoch(): number {
  return switchEpoch
}

export function bumpSwitchEpoch(): number {
  return ++switchEpoch
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/services/__tests__/athleteSwitchEpoch.test.ts`
Expected: PASS

- [ ] **Step 5: Lint**

Run: `npm run lint` → OK. Commit: `feat: switch epoch en el holder de atleta activo`

---

### Task 2: `resetForAthleteSwitch()` por store + tokens en loads sin guard

**Files:**
- Modify: `src/store/useChatStore.ts` (token en `loadHistory` + reset)
- Modify: `src/store/useTrainingStore.ts` (reset; bumpea tokens existentes)
- Modify: `src/store/usePlanBuilderStore.ts` (reset; aborta polling)
- Modify: `src/store/useCoachActionsStore.ts` (token en `loadProposals` + reset)
- Modify: `src/store/useCoachMemoryStore.ts` (reset; bumpea token existente)
- Test: `src/store/__tests__/athleteSwitchResets.test.ts`

**Interfaces:**
- Produces: acción `resetForAthleteSwitch(): void` en los CINCO stores (mismo nombre exacto). Task 5 las consume vía `useXStore.getState().resetForAthleteSwitch()`.

- [ ] **Step 1: Tests que fallan**

```ts
// src/store/__tests__/athleteSwitchResets.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/syncService', () => ({
  pushCoachProposal: vi.fn(async () => {}),
  pushSession: vi.fn(async () => {}),
  pushDayLog: vi.fn(async () => {}),
  pushWeekSummary: vi.fn(async () => {}),
  pushChatMessage: vi.fn(async () => {}),
  pushAthleteProfile: vi.fn(async () => {}),
  canWriteAthleteProfileLocally: vi.fn(() => true),
}))

import { db } from '../../db/db'
import { ATHLETE_PROFILE_LOCAL_ID, setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'
import { useCoachActionsStore } from '../useCoachActionsStore'
import { useCoachMemoryStore } from '../useCoachMemoryStore'
import { useTrainingStore } from '../useTrainingStore'
import { useChatStore } from '../useChatStore'
import { usePlanBuilderStore } from '../usePlanBuilderStore'
import type { WeekSummary } from '../../types'

// WeekSummary tiene varios contadores obligatorios — helper para seeds válidos.
function makeWeekSummary(overrides: Partial<WeekSummary> & Pick<WeekSummary, 'id' | 'weekStartDate'>): WeekSummary {
  return {
    totalSessions: 0,
    totalMinutes: 0,
    plannedSessions: 0,
    completedSessions: 0,
    plannedMinutes: 0,
    completedMinutes: 0,
    squashSessions: 0,
    runningSessions: 0,
    strengthSessions: 0,
    ...overrides,
  }
}

describe('resetForAthleteSwitch', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_user-1')
    localStorage.clear()
  })

  afterEach(() => {
    db.close()
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('useCoachMemoryStore: reset limpia el perfil cacheado y descarta un loadMemory tardío', async () => {
    await db.athleteProfiles.put({ id: ATHLETE_PROFILE_LOCAL_ID, updatedAt: 1, name: 'Atleta Anterior' })
    const memory = useCoachMemoryStore.getState()
    const load = memory.loadMemory()
    memory.resetForAthleteSwitch()
    await load
    expect(useCoachMemoryStore.getState().athleteProfile).toBeNull()
    expect(useCoachMemoryStore.getState().hasLoaded).toBe(false)
  })

  it('useCoachActionsStore: un loadProposals tardío se descarta tras el reset', async () => {
    await db.coachProposals.put({
      id: 'p1', createdAt: 1, status: 'pending', message: 'm', actions: [], athleteId: 'ath_user-1',
    })
    const actions = useCoachActionsStore.getState()
    const load = actions.loadProposals()
    actions.resetForAthleteSwitch()
    await load
    expect(useCoachActionsStore.getState().proposals).toEqual([])
  })

  it('useTrainingStore: un loadAllSummaries tardío se descarta tras el reset', async () => {
    await db.weekSummaries.put(makeWeekSummary({ id: 'w1', weekStartDate: '2026-06-29', athleteId: 'ath_user-1' }))
    const training = useTrainingStore.getState()
    const load = training.loadAllSummaries()
    training.resetForAthleteSwitch()
    await load
    expect(useTrainingStore.getState().allWeekSummaries).toEqual([])
  })

  it('useChatStore: un loadHistory tardío se descarta tras el reset', async () => {
    useChatStore.setState({ messages: [{ id: 'seed' } as never] })
    const chat = useChatStore.getState()
    const load = chat.loadHistory()
    chat.resetForAthleteSwitch()
    await load
    expect(useChatStore.getState().messages).toEqual([])
  })

  it('usePlanBuilderStore: reset vuelve a estado idle', () => {
    usePlanBuilderStore.setState({ status: 'generating', lastError: 'x', completedWeeks: 3 })
    usePlanBuilderStore.getState().resetForAthleteSwitch()
    const state = usePlanBuilderStore.getState()
    expect(state.status).toBe('idle')
    expect(state.plan).toBeNull()
    expect(state.completedWeeks).toBe(0)
    expect(state.lastError).toBeNull()
  })
})
```

Nota: si algún campo obligatorio de los tipos (`WeekSummary`, `CoachProposal`) falta en los seeds, completar con valores mínimos válidos del tipo — no cambiar el tipo.

- [ ] **Step 2: Verificar que fallan**

Run: `npx vitest run src/store/__tests__/athleteSwitchResets.test.ts`
Expected: FAIL — `resetForAthleteSwitch` no existe.

- [ ] **Step 3: Implementar los cinco resets + tokens**

`src/store/useChatStore.ts`:
1. Junto a `let activeChatAbortController` agregar: `let latestHistoryLoadRequestId = 0`.
2. En `loadHistory`, primera línea: `const requestId = ++latestHistoryLoadRequestId`. Antes de CADA `set(...)` del método (el inicial de `currentSessionId`, el del thread adoptado y el final de `messages`) agregar `if (requestId !== latestHistoryLoadRequestId) return`.
3. Agregar a la interface `ChatState`: `resetForAthleteSwitch: () => void` y al store:

```ts
resetForAthleteSwitch: () => {
  activeChatAbortController?.abort()
  activeChatAbortController = null
  latestHistoryLoadRequestId += 1
  set({ messages: [], isLoading: false, streamingText: '', responsePhase: 'idle', error: null })
  // currentSessionId NO se toca aquí: loadHistory re-resuelve la key
  // athlete-scoped en el remount (ya lo hace hoy).
},
```

`src/store/useTrainingStore.ts` — agregar a la interface y al store:

```ts
resetForAthleteSwitch: () => {
  latestWeekLoadRequestId += 1
  latestAllSummariesLoadRequestId += 1
  set({ sessions: [], dayLogs: {}, currentWeekSummary: null, allWeekSummaries: [], isLoading: false, loadedWeekStart: null })
},
```

`src/store/usePlanBuilderStore.ts` — agregar a la interface `PlanBuilderState` y al store:

```ts
resetForAthleteSwitch: () => {
  generationPollingController?.abort()
  generationPollingController = null
  set({
    plan: null, weeks: [], issues: [], status: 'idle', currentWeekIndex: null,
    completedWeeks: 0, failedWeekIndexes: [], streamingTextByWeekIndex: {},
    generationJob: null, lastError: null,
  })
},
```

`src/store/useCoachActionsStore.ts`:
1. Junto a `activeAcceptProposalPromises` agregar: `let latestProposalsLoadRequestId = 0`.
2. En `loadProposals`, primera línea: `const requestId = ++latestProposalsLoadRequestId`; antes del `set({ proposals })`: `if (requestId !== latestProposalsLoadRequestId) return`.
3. Interface + store:

```ts
resetForAthleteSwitch: () => {
  latestProposalsLoadRequestId += 1
  activeAcceptProposalPromises.clear()
  set({ proposals: [] })
},
```

`src/store/useCoachMemoryStore.ts` — interface + store:

```ts
resetForAthleteSwitch: () => {
  latestMemoryLoadRequestId += 1
  set({ coachMemory: '', athleteProfile: null, isSaving: false, hasLoaded: false, lastLoadedAt: null })
},
```

- [ ] **Step 4: Verificar que pasan**

Run: `npx vitest run src/store/__tests__/athleteSwitchResets.test.ts`
Expected: PASS

- [ ] **Step 5: Suite de stores + lint**

Run: `npm run lint && npx vitest run src/store/`
Expected: verde (sin regresiones en tests existentes de stores).

---

### Task 3: Guard de epoch en `acceptProposal` (in-flight switch)

**Files:**
- Modify: `src/store/useCoachActionsStore.ts` (`acceptProposal`)
- Test: `src/store/__tests__/acceptProposalSwitchGuard.test.ts`

**Interfaces:**
- Consumes: `getSwitchEpoch()` (Task 1).
- Produces: comportamiento — un switch durante el accept aborta la aplicación, rollbackea lo aplicado y deja la proposal `pending`.

- [ ] **Step 1: Test que falla**

```ts
// src/store/__tests__/acceptProposalSwitchGuard.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/syncService', () => ({
  pushCoachProposal: vi.fn(async () => {}),
  pushSession: vi.fn(async () => {}),
  pushDayLog: vi.fn(async () => {}),
  pushWeekSummary: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
  canWriteAthleteProfileLocally: vi.fn(() => true),
}))

import { db } from '../../db/db'
import { bumpSwitchEpoch, setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'
import { useCoachActionsStore } from '../useCoachActionsStore'
import { useTrainingStore } from '../useTrainingStore'

describe('acceptProposal — guard de switch', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_user-1')
  })

  afterEach(() => {
    db.close()
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('un switch antes de aplicar acciones aborta el accept y deja la proposal pending', async () => {
    await db.coachProposals.put({
      id: 'p1', createdAt: Date.now(), status: 'pending', message: 'm',
      athleteId: 'ath_user-1',
      actions: [{ type: 'insert_recovery', targetDate: '2026-07-06', reason: 'test' }],
    })
    await useCoachActionsStore.getState().loadProposals()

    // Interceptar addSession para simular el switch a mitad del accept:
    const originalAddSession = useTrainingStore.getState().addSession
    useTrainingStore.setState({
      addSession: async (partial) => {
        bumpSwitchEpoch() // el coach cambió de atleta mientras corría el accept
        return originalAddSession(partial)
      },
    })

    const result = await useCoachActionsStore.getState().acceptProposal('p1')

    expect(result.errors.length).toBeGreaterThan(0)
    const stored = await db.coachProposals.get('p1')
    expect(stored?.status).toBe('pending') // NO rejected, NO accepted
    const sessions = await db.sessions.toArray()
    expect(sessions).toEqual([]) // la sesión creada fue rollbackeada
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/store/__tests__/acceptProposalSwitchGuard.test.ts`
Expected: FAIL — hoy el accept completa y marca `accepted` (y la sesión queda estampada bajo el atleta activo del momento del write).

- [ ] **Step 3: Implementar el guard**

En `src/store/useCoachActionsStore.ts`:

1. Importar `getSwitchEpoch` desde `'../services/athlete/activeAthlete'` (el store vive en `src/store/`).
2. Constante de módulo:

```ts
const ATHLETE_SWITCH_ABORT_MESSAGE =
  'Cambiaste de atleta mientras se aplicaba la propuesta. La propuesta quedó pendiente; revísala con el atleta correcto activo.'
```

3. Dentro del IIFE async de `acceptProposal`, primera línea: `const switchEpochAtStart = getSwitchEpoch()`.
4. En el loop de acciones (`for (let i = 0; i < workingProposal.actions.length; i++)`), agregar como PRIMERA instrucción de cada iteración:

```ts
if (getSwitchEpoch() !== switchEpochAtStart) {
  errors.push(ATHLETE_SWITCH_ABORT_MESSAGE)
  break
}
```

5. Inmediatamente DESPUÉS del loop (y ANTES del bloque de rollback), cubrir el switch ocurrido **durante la última acción** — no tiene siguiente iteración que lo detecte, la acción termina "OK" y sin este check la proposal se marcaría `accepted` con la sesión estampada bajo el atleta nuevo:

```ts
if (getSwitchEpoch() !== switchEpochAtStart && !errors.includes(ATHLETE_SWITCH_ABORT_MESSAGE)) {
  // Switch durante la última acción aplicada: forzar el path de rollback.
  errors.push(ATHLETE_SWITCH_ABORT_MESSAGE)
}
```

(Con esto, el rollback existente `if (errors.length > 0 && appliedResults.length > 0)` revierte también lo aplicado en esa última acción.)

6. Después del bloque de rollback, cortar ANTES del write de estado final cuando el motivo fue el switch:

```ts
if (getSwitchEpoch() !== switchEpochAtStart) {
  // El switch abortó el accept: lo aplicado ya se revirtió arriba; la
  // proposal queda pending y NO se marca rejected (no fue un fallo real).
  return { errors, warnings }
}
```

(El `nextProposal`/`db.coachProposals.put`/`set` existentes quedan intactos para el flujo normal.)

Nota: el rollback existente (`rollbackAppliedActions`) borra por session id → es seguro bajo cualquier atleta activo.

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/store/__tests__/acceptProposalSwitchGuard.test.ts`
Expected: PASS

- [ ] **Step 5: Regresión de proposals + lint**

Run: `npm run lint && npx vitest run src/store/`
Expected: verde (los tests existentes de accept/reject no cambian: sin switch, `getSwitchEpoch()` es constante).

---

### Task 4: Guard de epoch en callbacks de generación local de planes

**Files:**
- Modify: `src/store/usePlanBuilderStore.ts` (`buildRunnerCallbacks`)
- Test: `src/store/__tests__/planBuilderSwitchGuard.test.ts`

**Interfaces:**
- Consumes: `getSwitchEpoch()` (Task 1).
- Produces: `buildRunnerCallbacks` pasa a export nombrado (para test); callbacks no-op tras un switch.

- [ ] **Step 1: Test que falla**

```ts
// src/store/__tests__/planBuilderSwitchGuard.test.ts
import { describe, expect, it } from 'vitest'
import { bumpSwitchEpoch } from '../../services/athlete/activeAthlete'
import { buildRunnerCallbacks, usePlanBuilderStore } from '../usePlanBuilderStore'

describe('plan generation callbacks — guard de switch', () => {
  it('onError tardío tras un switch NO escribe estado', () => {
    usePlanBuilderStore.setState({ status: 'idle', lastError: null })
    const callbacks = buildRunnerCallbacks(
      usePlanBuilderStore.setState,
      usePlanBuilderStore.getState,
    )
    bumpSwitchEpoch()
    callbacks.onError?.('fallo tardío del atleta anterior')
    expect(usePlanBuilderStore.getState().lastError).toBeNull()
    expect(usePlanBuilderStore.getState().status).toBe('idle')
  })

  it('sin switch, onError sí escribe estado', () => {
    usePlanBuilderStore.setState({ status: 'idle', lastError: null, plan: null })
    const callbacks = buildRunnerCallbacks(
      usePlanBuilderStore.setState,
      usePlanBuilderStore.getState,
    )
    callbacks.onError?.('fallo real')
    expect(usePlanBuilderStore.getState().lastError).toBe('fallo real')
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/store/__tests__/planBuilderSwitchGuard.test.ts`
Expected: FAIL — `buildRunnerCallbacks` no exportada (y sin guard).

- [ ] **Step 3: Implementar**

En `src/store/usePlanBuilderStore.ts`:

1. Importar `getSwitchEpoch` desde `'../services/athlete/activeAthlete'` (agregar al import existente de `ATHLETE_PROFILE_LOCAL_ID, getActiveAthleteId`).
2. Cambiar `function buildRunnerCallbacks(` a `export function buildRunnerCallbacks(`.
3. Al inicio del cuerpo, capturar el epoch y definir el wrapper:

```ts
export function buildRunnerCallbacks(
  set: PlanBuilderSet,
  get: () => PlanBuilderState,
) {
  // Un job local sigue corriendo tras un switch de atleta: sus writes a Dexie
  // van keyed por su plan original (seguros), pero sus callbacks NO deben
  // escribir el estado del store del atleta nuevo (spec 2b §3.1).
  const epochAtBuild = getSwitchEpoch()
  const guarded = <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A): void => {
      if (getSwitchEpoch() !== epochAtBuild) return
      fn(...args)
    }
  return {
    onJobUpdate: guarded((job: PlanGenerationJob) => { /* cuerpo existente sin cambios */ }),
    onPlanUpdate: guarded((plan: TrainingPlan, weeks: TrainingPlanWeek[]) => { /* cuerpo existente sin cambios */ }),
    onWeekUpdate: guarded((next: TrainingPlanWeek) => { /* cuerpo existente sin cambios */ }),
    onError: guarded((message: string) => { /* cuerpo existente sin cambios */ }),
  }
}
```

Los cuatro cuerpos existentes NO cambian — solo se envuelven en `guarded(...)`. El tipado de `PlanBuilderSet`/`usePlanBuilderStore.setState` es compatible (`setState` de Zustand acepta partials).

4. Si el test no compila porque `usePlanBuilderStore.setState` no matchea `PlanBuilderSet` exactamente, castear en el test: `usePlanBuilderStore.setState as never` — NO cambiar la firma de producción.

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/store/__tests__/planBuilderSwitchGuard.test.ts src/store/__tests__/usePlanBuilderStore.test.ts`
Expected: PASS (incluida la suite existente del store).

- [ ] **Step 5: Lint**

Run: `npm run lint` → OK.

---

### Task 5: Servicio `switchActiveAthlete`

**Files:**
- Create: `src/services/athlete/switchActiveAthlete.ts`
- Test: `src/services/__tests__/switchActiveAthlete.test.ts`

**Interfaces:**
- Consumes: `bumpSwitchEpoch`, `getSelfAthleteId`, `setActiveAthleteId` (holder); `persistAthleteSelection`; `resetForAthleteSwitch` de los 5 stores (Task 2); `useAuthStore.getState().setActiveAthleteId`.
- Produces: `switchActiveAthlete(ownerAccountId: string, athleteId: string): Promise<boolean>` — `true` si el switch se aplicó. Tasks 8 y 9 la consumen.

Nota de diseño: el spec §3.3 la ubica "en useAuthStore"; se implementa como **servicio** para evitar import circular (`usePlanBuilderStore` ya importa `useAuthStore`). El estado Zustand se actualiza vía `useAuthStore.getState().setActiveAthleteId`.

- [ ] **Step 1: Test que falla**

```ts
// src/services/__tests__/switchActiveAthlete.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../syncService', () => ({
  pushAthlete: vi.fn(async () => {}),
  pushCoachProposal: vi.fn(async () => {}),
  canWriteAthleteProfileLocally: vi.fn(() => true),
}))

import { db } from '../../db/db'
import {
  ATHLETE_PROFILE_LOCAL_ID,
  getActiveAthleteId,
  getSwitchEpoch,
  setActiveAthleteId,
  setSelfAthleteId,
} from '../athlete/activeAthlete'
import { getPersistedAthleteSelection } from '../athlete/athleteSelection'
import { switchActiveAthlete } from '../athlete/switchActiveAthlete'
import { useAuthStore } from '../../store/useAuthStore'
import { useCoachMemoryStore } from '../../store/useCoachMemoryStore'

const OWNER = 'user-1'
const SELF = 'ath_user-1'
const MANAGED = 'ath_m_abc'

function seedAthletes() {
  return db.athletes.bulkPut([
    { id: SELF, ownerAccountId: OWNER, linkedAccountId: OWNER, displayName: 'Rafa', status: 'active', createdAt: 1, updatedAt: 1 },
    { id: MANAGED, ownerAccountId: OWNER, linkedAccountId: null, displayName: 'Cliente 1', status: 'active', createdAt: 1, updatedAt: 1 },
  ])
}

describe('switchActiveAthlete', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    localStorage.clear()
    setSelfAthleteId(SELF)
    setActiveAthleteId(SELF)
  })

  afterEach(() => {
    db.close()
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('switch a gestionado: bumpea epoch, resetea stores, persiste selección y mueve el holder', async () => {
    await seedAthletes()
    useCoachMemoryStore.setState({ athleteProfile: { id: ATHLETE_PROFILE_LOCAL_ID, updatedAt: 1, name: 'Rafa' }, hasLoaded: true })
    const epochBefore = getSwitchEpoch()

    const ok = await switchActiveAthlete(OWNER, MANAGED)

    expect(ok).toBe(true)
    expect(getSwitchEpoch()).toBe(epochBefore + 1)
    expect(useCoachMemoryStore.getState().athleteProfile).toBeNull() // reset corrió
    expect(getPersistedAthleteSelection(OWNER)).toBe(MANAGED)
    expect(getActiveAthleteId()).toBe(MANAGED)
    expect(useAuthStore.getState().activeAthleteId).toBe(MANAGED)
  })

  it('volver al self limpia la selección persistida', async () => {
    await seedAthletes()
    await switchActiveAthlete(OWNER, MANAGED)
    const ok = await switchActiveAthlete(OWNER, SELF)

    expect(ok).toBe(true)
    expect(getPersistedAthleteSelection(OWNER)).toBeNull()
    expect(getActiveAthleteId()).toBe(SELF)
  })

  it('target inválido (inexistente / otro owner / inactive) es no-op', async () => {
    await seedAthletes()
    await db.athletes.put({ id: 'ath_m_off', ownerAccountId: OWNER, linkedAccountId: null, displayName: 'Baja', status: 'archived', createdAt: 1, updatedAt: 1 })
    const epochBefore = getSwitchEpoch()

    expect(await switchActiveAthlete(OWNER, 'ath_m_missing')).toBe(false)
    expect(await switchActiveAthlete(OWNER, 'ath_m_off')).toBe(false)
    expect(getSwitchEpoch()).toBe(epochBefore) // sin bump
    expect(getActiveAthleteId()).toBe(SELF)
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/services/__tests__/switchActiveAthlete.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementación**

```ts
// src/services/athlete/switchActiveAthlete.ts
import { db } from '../../db/db'
import { bumpSwitchEpoch, getSelfAthleteId, setActiveAthleteId } from './activeAthlete'
import { persistAthleteSelection } from './athleteSelection'
import { useAuthStore } from '../../store/useAuthStore'
import { useChatStore } from '../../store/useChatStore'
import { useTrainingStore } from '../../store/useTrainingStore'
import { usePlanBuilderStore } from '../../store/usePlanBuilderStore'
import { useCoachActionsStore } from '../../store/useCoachActionsStore'
import { useCoachMemoryStore } from '../../store/useCoachMemoryStore'

/**
 * Cambia el atleta activo (spec 2b §3.3). Orden estricto:
 * validar → bump epoch → teardown de stores → persistir selección → holder →
 * Zustand. El remount por key en AppShell es la segunda red, no la primera.
 * Volver al self LIMPIA la selección persistida (path single-athlete prístino).
 */
export async function switchActiveAthlete(ownerAccountId: string, athleteId: string): Promise<boolean> {
  const row = await db.athletes.get(athleteId)
  const isValid = !!row && row.ownerAccountId === ownerAccountId && row.status === 'active'
  if (!isValid) return false

  bumpSwitchEpoch()
  useChatStore.getState().resetForAthleteSwitch()
  useTrainingStore.getState().resetForAthleteSwitch()
  usePlanBuilderStore.getState().resetForAthleteSwitch()
  useCoachActionsStore.getState().resetForAthleteSwitch()
  useCoachMemoryStore.getState().resetForAthleteSwitch()

  const isSelf = athleteId === getSelfAthleteId()
  persistAthleteSelection(ownerAccountId, isSelf ? null : athleteId)
  setActiveAthleteId(athleteId)
  useAuthStore.getState().setActiveAthleteId(athleteId)
  return true
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/services/__tests__/switchActiveAthlete.test.ts`
Expected: PASS

- [ ] **Step 5: Lint + regresión athlete scope**

Run: `npm run lint && npx vitest run src/services/__tests__/ src/db/__tests__/`
Expected: verde.

---

### Task 6: Allowlist `coachAccess`

**Files:**
- Create: `src/services/athlete/coachAccess.ts`
- Test: `src/services/__tests__/coachAccess.test.ts`

**Interfaces:**
- Produces: `isCoachAccount(user: { email?: string | null } | null | undefined, rawAllowlist?: string): boolean` y `parseCoachAllowlist(raw: string | null | undefined): string[]`. Tasks 8 y 9 consumen `isCoachAccount(user)` (el segundo parámetro tiene default al env — solo tests lo inyectan).

- [ ] **Step 1: Test que falla**

```ts
// src/services/__tests__/coachAccess.test.ts
import { describe, expect, it } from 'vitest'
import { isCoachAccount, parseCoachAllowlist } from '../athlete/coachAccess'

describe('coachAccess', () => {
  it('parseCoachAllowlist normaliza (trim, lowercase, vacíos fuera)', () => {
    expect(parseCoachAllowlist(' Rafa.Allendes@Gmail.com , otro@x.cl ,, ')).toEqual([
      'rafa.allendes@gmail.com',
      'otro@x.cl',
    ])
    expect(parseCoachAllowlist('')).toEqual([])
    expect(parseCoachAllowlist(undefined)).toEqual([])
  })

  it('isCoachAccount matchea por email case-insensitive', () => {
    const user = { email: 'Rafa.Allendes@gmail.com' }
    expect(isCoachAccount(user, 'rafa.allendes@gmail.com')).toBe(true)
    expect(isCoachAccount(user, 'otra@persona.cl')).toBe(false)
  })

  it('default vacío → nadie es coach', () => {
    expect(isCoachAccount({ email: 'rafa.allendes@gmail.com' }, undefined)).toBe(false)
    expect(isCoachAccount({ email: 'rafa.allendes@gmail.com' }, '')).toBe(false)
    expect(isCoachAccount(null, 'rafa.allendes@gmail.com')).toBe(false)
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/services/__tests__/coachAccess.test.ts` → FAIL (módulo no existe).

- [ ] **Step 3: Implementación**

```ts
// src/services/athlete/coachAccess.ts

/**
 * Gate de UI del modo coach (spec 2b §2). NO es una barrera de seguridad:
 * la barrera real es la RLS por user_id. Default vacío → nadie ve la UI coach.
 */
export function parseCoachAllowlist(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

export function isCoachAccount(
  user: { email?: string | null } | null | undefined,
  rawAllowlist: string | undefined = import.meta.env.VITE_COACH_ACCOUNTS as string | undefined,
): boolean {
  const email = user?.email?.trim().toLowerCase()
  if (!email) return false
  return parseCoachAllowlist(rawAllowlist).includes(email)
}
```

Si `import.meta.env.VITE_COACH_ACCOUNTS` no tipa, agregar a `src/vite-env.d.ts` (o donde estén declaradas las env existentes como `VITE_ATHLETE_SCOPE`): `readonly VITE_COACH_ACCOUNTS?: string`.

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/services/__tests__/coachAccess.test.ts` → PASS

- [ ] **Step 5: Lint** → `npm run lint` OK.

---

### Task 7: Onboarding athlete-aware (skip key + chip de contexto)

**Files:**
- Modify: `src/utils/onboarding.ts` (key con sufijo de atleta — mismo patrón que `utils/chatSession.ts`)
- Modify: `src/pages/OnboardingPage.tsx` (título/chip cuando hay gestionado activo)
- Test: `src/utils/__tests__/onboardingScope.test.ts`

**Interfaces:**
- Consumes: `getActiveAthleteId`, `getSelfAthleteId` (holder).
- Produces: `hasSkippedOnboarding`/`markOnboardingSkipped`/`clearOnboardingSkipped` mantienen su firma (`userId?: string | null`) — el scope de atleta se resuelve INTERNAMENTE, así los callers existentes (`App.tsx:120`, `SettingsPage`, `OnboardingPage`) no cambian.

- [ ] **Step 1: Test que falla**

```ts
// src/utils/__tests__/onboardingScope.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'
import { clearOnboardingSkipped, hasSkippedOnboarding, markOnboardingSkipped } from '../onboarding'

describe('onboarding skip — scope por atleta', () => {
  beforeEach(() => {
    localStorage.clear()
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_user-1')
  })

  afterEach(() => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('el skip del self NO bloquea el onboarding de un gestionado', () => {
    markOnboardingSkipped('user-1') // self activo → key legacy
    setActiveAthleteId('ath_m_abc') // switch a gestionado
    expect(hasSkippedOnboarding('user-1')).toBe(false)
  })

  it('el skip de un gestionado es propio y se limpia por atleta', () => {
    setActiveAthleteId('ath_m_abc')
    markOnboardingSkipped('user-1')
    expect(hasSkippedOnboarding('user-1')).toBe(true)

    setActiveAthleteId('ath_user-1') // self intacto
    expect(hasSkippedOnboarding('user-1')).toBe(false)

    setActiveAthleteId('ath_m_abc')
    clearOnboardingSkipped('user-1')
    expect(hasSkippedOnboarding('user-1')).toBe(false)
  })

  it('sin atleta activo (legacy) usa la key actual — compat con el flag ya persistido', () => {
    setActiveAthleteId(null)
    setSelfAthleteId(null)
    localStorage.setItem('entrenador:onboarding:skipped:user-1', '1') // flag pre-2b
    expect(hasSkippedOnboarding('user-1')).toBe(true)
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/utils/__tests__/onboardingScope.test.ts`
Expected: FAIL — primer test: el skip del self bloquea al gestionado.

- [ ] **Step 3: Implementar la key scoped**

En `src/utils/onboarding.ts` (espejo del patrón de `utils/chatSession.ts`):

```ts
import { getActiveAthleteId, getSelfAthleteId } from '../services/athlete/activeAthlete'

// Self o sin atleta activo → key legacy (compat con el flag existente del
// owner); atleta gestionado → key sufijada por athleteId (spec 2b §6).
function onboardingScopeSuffix(): string {
  const active = getActiveAthleteId()
  if (!active || active === getSelfAthleteId()) return ''
  return `:${active}`
}

function buildKey(userId?: string | null): string {
  const base = userId ? `${ONBOARDING_SKIP_KEY_PREFIX}:${userId}` : ONBOARDING_SKIP_KEY_PREFIX
  return `${base}${onboardingScopeSuffix()}`
}
```

(`hasSkippedOnboarding`/`markOnboardingSkipped`/`clearOnboardingSkipped` no cambian — ya delegan en `buildKey`.)

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/utils/__tests__/onboardingScope.test.ts` → PASS

- [ ] **Step 5: Chip de contexto en OnboardingPage**

En `src/pages/OnboardingPage.tsx` (está fuera de `AppShell` → sin CoachContextBar; spec §6):

1. Imports nuevos: `import { db } from '../db/db'` y `import { getActiveAthleteId, isSelfScopeActive } from '../services/athlete/activeAthlete'`. **Además**, el import de React de la línea 1 hoy es `import { useEffect, useMemo } from 'react'` → agregar `useState`.
2. Estado + efecto dentro del componente. `/onboarding` está FUERA de `AppShell` → sin remount por key: el efecto debe depender de `activeAthleteId` (el componente ya usa `useAuthStore`, línea 82):

```tsx
const activeAthleteId = useAuthStore((state) => state.activeAthleteId)
const [managedAthleteName, setManagedAthleteName] = useState<string | null>(null)

useEffect(() => {
  const active = getActiveAthleteId()
  if (!active || isSelfScopeActive()) {
    setManagedAthleteName(null)
    return
  }
  let cancelled = false
  void db.athletes.get(active).then((row) => {
    if (!cancelled && row?.displayName) setManagedAthleteName(row.displayName)
  })
  return () => { cancelled = true }
}, [activeAthleteId])
```

3. Título del paso 1: donde hoy dice `'Cuéntame quién eres'`, usar:

```tsx
managedAthleteName ? `Perfil de ${managedAthleteName}` : 'Cuéntame quién eres'
```

4. Descripción del paso 1: donde hoy dice `'RallyIQ usará esta información para personalizar tus recomendaciones desde el primer día.'`:

```tsx
managedAthleteName
  ? `Estás completando el perfil de ${managedAthleteName}. RallyIQ usará esta información para personalizar su plan.`
  : 'RallyIQ usará esta información para personalizar tus recomendaciones desde el primer día.'
```

- [ ] **Step 6: Verificación**

Run: `npm run lint && npx vitest run src/utils/ src/pages/`
Expected: verde.

---

### Task 8: `CoachContextBar` + `coachScopeGuard` + remount por key en `AppShell`

**Files:**
- Create: `src/services/athlete/coachScopeGuard.ts`
- Create: `src/components/layout/CoachScopeGuard.tsx` (global, solo efecto)
- Create: `src/components/layout/CoachContextBar.tsx` (solo UI)
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/App.tsx` (montar `<CoachScopeGuard />` dentro de `AuthGate`, ANTES de `OnboardingGuard`)
- Test: `src/services/__tests__/coachScopeGuard.test.ts`
- Test: `src/components/layout/CoachContextBar.test.tsx`

**Interfaces:**
- Consumes: `isCoachAccount` (Task 6), `switchActiveAthlete` (Task 5), `listOwnedAthletes` (2a, `src/services/athlete/managedAthletes.ts`), `getSelfAthleteId`, `useAuthStore` (`user`, `activeAthleteId`), `ROUTES.COACH` (Task 9 lo define; usar el string `'/coach'` vía `ROUTES.COACH` — si Task 8 se ejecuta antes que Task 9, agregar `COACH: '/coach'` a `src/constants/routes.ts` aquí mismo).
- Produces: `<CoachContextBar />` (default export, solo UI) renderizado por `AppShell`; `null` para cuentas no-coach. `enforceCoachScopeGuard(user, rawAllowlist?): Promise<boolean>` (servicio) + `<CoachScopeGuard />` (default export, solo efecto) montado en `App.tsx` dentro de `AuthGate`.

**Por qué el guard:** `hydrateActiveAthlete` (`hydrateActiveAthlete.ts:25-33`) respeta cualquier selección persistida válida SIN consultar la allowlist. Si se quita `VITE_COACH_ACCOUNTS` (rollback) con un gestionado activo persistido en el navegador, el usuario rehidrataría como gestionado sin banner ni switcher visibles. El guard cierra ese gap.

**Por qué global y no en CoachContextBar:** `CoachContextBar` solo monta dentro de `AppShell`, pero `/onboarding` vive FUERA (`App.tsx`: `AuthGate > OnboardingGuard > Routes`, con la ruta de onboarding fuera del layout). Un hard refresh en `/onboarding` con gestionado activo no montaría el guard. Por eso `CoachScopeGuard` (componente solo-efecto, render `null`) se monta dentro de `AuthGate` ANTES de `OnboardingGuard` — corre en TODA ruta autenticada. `CoachContextBar` queda solo para UI.

- [ ] **Step 0: Test del guard que falla**

```ts
// src/services/__tests__/coachScopeGuard.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../syncService', () => ({
  pushAthlete: vi.fn(async () => {}),
  canWriteAthleteProfileLocally: vi.fn(() => true),
}))

import { db } from '../../db/db'
import { getActiveAthleteId, setActiveAthleteId, setSelfAthleteId } from '../athlete/activeAthlete'
import { getPersistedAthleteSelection, persistAthleteSelection } from '../athlete/athleteSelection'
import { enforceCoachScopeGuard } from '../athlete/coachScopeGuard'

const OWNER = 'user-1'
const SELF = 'ath_user-1'
const MANAGED = 'ath_m_abc'
const COACH_USER = { id: OWNER, email: 'rafa@x.cl' }

describe('enforceCoachScopeGuard', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    localStorage.clear()
    await db.athletes.bulkPut([
      { id: SELF, ownerAccountId: OWNER, linkedAccountId: OWNER, displayName: 'Rafa', status: 'active', createdAt: 1, updatedAt: 1 },
      { id: MANAGED, ownerAccountId: OWNER, linkedAccountId: null, displayName: 'Cliente 1', status: 'active', createdAt: 1, updatedAt: 1 },
    ])
    setSelfAthleteId(SELF)
  })

  afterEach(() => {
    db.close()
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('cuenta FUERA de allowlist con gestionado activo: vuelve al self y limpia la selección', async () => {
    setActiveAthleteId(MANAGED)
    persistAthleteSelection(OWNER, MANAGED)

    const enforced = await enforceCoachScopeGuard(COACH_USER, '') // allowlist vacía

    expect(enforced).toBe(true)
    expect(getActiveAthleteId()).toBe(SELF)
    expect(getPersistedAthleteSelection(OWNER)).toBeNull()
  })

  it('coach allowlisted con gestionado activo: no interviene', async () => {
    setActiveAthleteId(MANAGED)
    persistAthleteSelection(OWNER, MANAGED)

    const enforced = await enforceCoachScopeGuard(COACH_USER, 'rafa@x.cl')

    expect(enforced).toBe(false)
    expect(getActiveAthleteId()).toBe(MANAGED)
  })

  it('self activo o holder sin resolver: no-op', async () => {
    setActiveAthleteId(SELF)
    expect(await enforceCoachScopeGuard(COACH_USER, '')).toBe(false)

    setActiveAthleteId(null)
    setSelfAthleteId(null)
    expect(await enforceCoachScopeGuard(COACH_USER, '')).toBe(false)
  })
})
```

Run: `npx vitest run src/services/__tests__/coachScopeGuard.test.ts` → FAIL (módulo no existe).

- [ ] **Step 0b: Implementar el guard**

```ts
// src/services/athlete/coachScopeGuard.ts
import { getActiveAthleteId, getSelfAthleteId } from './activeAthlete'
import { isCoachAccount } from './coachAccess'
import { switchActiveAthlete } from './switchActiveAthlete'

/**
 * Defensa de rollback (spec 2b §2): hydrateActiveAthlete respeta una selección
 * persistida válida sin consultar la allowlist. Si la cuenta dejó de ser coach
 * (VITE_COACH_ACCOUNTS removida) con un gestionado activo, este guard fuerza
 * el retorno al self y limpia la selección. Retorna true si intervino.
 */
export async function enforceCoachScopeGuard(
  user: { id: string; email?: string | null } | null | undefined,
  rawAllowlist?: string,
): Promise<boolean> {
  if (!user?.id) return false
  if (isCoachAccount(user, rawAllowlist)) return false

  const active = getActiveAthleteId()
  const selfId = getSelfAthleteId()
  if (!selfId || !active || active === selfId) return false

  // switchActiveAthlete limpia la selección persistida al volver al self.
  return switchActiveAthlete(user.id, selfId)
}
```

Run: `npx vitest run src/services/__tests__/coachScopeGuard.test.ts` → PASS

- [ ] **Step 0c: Componente global `CoachScopeGuard` + montaje en `App.tsx`**

```tsx
// src/components/layout/CoachScopeGuard.tsx
import { useEffect } from 'react'
import { useAuthStore } from '../../store/useAuthStore'
import { enforceCoachScopeGuard } from '../../services/athlete/coachScopeGuard'

/**
 * Guard global de scope coach (solo efecto, sin UI). Montado dentro de
 * AuthGate y FUERA de AppShell para cubrir también /onboarding: un hard
 * refresh ahí con gestionado activo y cuenta ya no-coach debe volver al self.
 */
export default function CoachScopeGuard() {
  const user = useAuthStore((state) => state.user)
  const activeAthleteId = useAuthStore((state) => state.activeAthleteId)

  useEffect(() => {
    if (!user?.id) return
    void enforceCoachScopeGuard(user)
  }, [user, activeAthleteId])

  return null
}
```

Montaje en `src/App.tsx` — dentro de `AuthGate`, ANTES de `OnboardingGuard` (estructura actual en el return final de `App`):

```tsx
<AuthGate>
  <CoachScopeGuard />
  <OnboardingGuard>
    <Routes>
      ...
```

(Import: `import CoachScopeGuard from './components/layout/CoachScopeGuard'` junto a los demás imports de componentes.)

- [ ] **Step 1: Tests que fallan** (gating por render estático, patrón `PlanQualityBadge.test.tsx`)

```tsx
// src/components/layout/CoachContextBar.test.tsx
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import CoachContextBar from './CoachContextBar'
import { useAuthStore } from '../../store/useAuthStore'
import { setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'
import type { User } from '@supabase/supabase-js'

import type { Athlete } from '../../types'

const ROSTER: Athlete[] = [
  { id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', displayName: 'Rafa', status: 'active', createdAt: 1, updatedAt: 1 },
  { id: 'ath_m_abc', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Cliente 1', status: 'active', createdAt: 1, updatedAt: 1 },
]

// renderToStaticMarkup no ejecuta efectos → initialAthletes inyecta el roster
// que en runtime carga el useEffect (listOwnedAthletes).
function render(allowlist: string, initialAthletes: Athlete[] = []) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <CoachContextBar allowlistOverride={allowlist} initialAthletes={initialAthletes} />
    </MemoryRouter>,
  )
}

describe('CoachContextBar', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'user-1', email: 'rafa@x.cl' } as User, activeAthleteId: 'ath_user-1' })
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_user-1')
  })

  afterEach(() => {
    useAuthStore.setState({ user: null, activeAthleteId: null })
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('cuenta fuera de la allowlist: no renderiza nada', () => {
    expect(render('otra@persona.cl')).toBe('')
  })

  it('coach allowlisted con solo self: renderiza el pill "Tú" (bootstrap del primer gestionado)', () => {
    const html = render('rafa@x.cl')
    expect(html).toContain('Tú')
  })

  it('gestionado activo: renderiza el banner con el nombre real + "Volver a ti"', () => {
    useAuthStore.setState({ activeAthleteId: 'ath_m_abc' })
    setActiveAthleteId('ath_m_abc')
    const html = render('rafa@x.cl', ROSTER)
    expect(html).toContain('Entrenando a Cliente 1')
    expect(html).toContain('Volver a ti')
  })
})
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx vitest run src/components/layout/CoachContextBar.test.tsx` → FAIL (módulo no existe).

- [ ] **Step 3: Implementar `CoachContextBar`**

```tsx
// src/components/layout/CoachContextBar.tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Users, Zap } from 'lucide-react'
import { useAuthStore } from '../../store/useAuthStore'
import { isCoachAccount } from '../../services/athlete/coachAccess'
import { getSelfAthleteId } from '../../services/athlete/activeAthlete'
import { listOwnedAthletes } from '../../services/athlete/managedAthletes'
import { switchActiveAthlete } from '../../services/athlete/switchActiveAthlete'
import { ROUTES } from '../../constants/routes'
import type { Athlete } from '../../types'

interface CoachContextBarProps {
  /** Solo tests: inyecta la allowlist sin depender de import.meta.env. */
  allowlistOverride?: string
  /** Solo tests: roster inicial (renderToStaticMarkup no ejecuta efectos). */
  initialAthletes?: Athlete[]
}

export default function CoachContextBar({ allowlistOverride, initialAthletes }: CoachContextBarProps) {
  const user = useAuthStore((state) => state.user)
  const activeAthleteId = useAuthStore((state) => state.activeAthleteId)
  const [athletes, setAthletes] = useState<Athlete[]>(initialAthletes ?? [])
  const [isOpen, setIsOpen] = useState(false)
  const navigate = useNavigate()

  const isCoach = allowlistOverride !== undefined
    ? isCoachAccount(user, allowlistOverride)
    : isCoachAccount(user)

  // Nota: el guard de scope (enforceCoachScopeGuard) NO vive aquí — este
  // componente solo monta dentro de AppShell y /onboarding queda fuera.
  // Vive en CoachScopeGuard (global, Step 0c). Aquí solo UI.
  useEffect(() => {
    if (!isCoach || !user?.id) return
    let cancelled = false
    void listOwnedAthletes(user.id).then((rows) => {
      if (!cancelled) setAthletes(rows)
    })
    return () => { cancelled = true }
  }, [isCoach, user?.id, activeAthleteId])

  if (!isCoach || !user?.id) return null

  const selfId = getSelfAthleteId()
  const isManagedActive = activeAthleteId != null && selfId != null && activeAthleteId !== selfId
  const activeAthlete = athletes.find((athlete) => athlete.id === activeAthleteId)
  const activeLabel = isManagedActive ? (activeAthlete?.displayName ?? 'Atleta') : 'Tú'

  async function handleSwitch(athleteId: string) {
    setIsOpen(false)
    if (!user?.id || athleteId === activeAthleteId) return
    await switchActiveAthlete(user.id, athleteId)
  }

  if (isManagedActive) {
    return (
      <div className="sticky top-0 z-40 flex items-center justify-between gap-2 border-b border-[#ff5a1f]/30 bg-[linear-gradient(135deg,rgba(255,90,31,0.22),rgba(14,14,14,0.97))] px-4 py-2">
        <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[#ffd2bf]">
          <Zap size={14} className="flex-shrink-0 text-[#ff7a33]" />
          <span className="truncate">Entrenando a {activeLabel}</span>
        </span>
        <button
          type="button"
          onClick={() => { if (selfId) void handleSwitch(selfId) }}
          className="flex-shrink-0 rounded-lg border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/10"
        >
          Volver a ti
        </button>
      </div>
    )
  }

  return (
    <div className="relative z-40 flex justify-end px-4 pt-2">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-ink-muted transition-colors hover:text-ink"
      >
        <Users size={13} />
        <span>{activeLabel}</span>
        <ChevronDown size={13} />
      </button>
      {isOpen && (
        <div className="absolute right-4 top-9 w-52 rounded-xl border border-white/10 bg-[#161616] p-1.5 shadow-xl">
          {athletes.map((athlete) => (
            <button
              key={athlete.id}
              type="button"
              onClick={() => void handleSwitch(athlete.id)}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-white/5"
            >
              <span className="truncate">{athlete.id === selfId ? 'Tú' : (athlete.displayName ?? 'Atleta')}</span>
              {athlete.id === activeAthleteId && <span className="text-xs text-brand">activo</span>}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setIsOpen(false); navigate(ROUTES.COACH) }}
            className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-white/5 px-3 py-2 text-left text-sm text-ink-muted transition-colors hover:text-ink"
          >
            Gestionar atletas
          </button>
        </div>
      )}
    </div>
  )
}
```

Si `ROUTES.COACH` aún no existe (Task 9), agregarlo ahora en `src/constants/routes.ts`: `COACH: '/coach',` (una sola vez — Task 9 lo verifica, no lo duplica).

- [ ] **Step 4: Wiring en `AppShell`**

`src/components/layout/AppShell.tsx` completo tras el cambio:

```tsx
import { Outlet, useLocation } from 'react-router-dom'
import BottomNav from './BottomNav'
import CoachContextBar from './CoachContextBar'
import { ROUTES } from '../../constants/routes'
import { useAuthStore } from '../../store/useAuthStore'

export default function AppShell() {
  const { pathname } = useLocation()
  const isChatRoute = pathname === ROUTES.CHAT
  const activeAthleteId = useAuthStore((state) => state.activeAthleteId)

  return (
    <div className="min-h-screen bg-surface flex flex-col w-full max-w-5xl mx-auto md:px-4 lg:px-6">
      <CoachContextBar />
      {/* Remount coordinado (spec 2b §3.3): cambiar de atleta desmonta y
          remonta las páginas, que releen Dexie con los lookups scoped. */}
      <main
        key={activeAthleteId ?? 'legacy'}
        className={isChatRoute ? 'flex-1 overflow-hidden' : 'flex-1 overflow-y-auto pb-24 md:pb-28'}
      >
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
```

- [ ] **Step 5: Verificar**

Run: `npx vitest run src/services/__tests__/coachScopeGuard.test.ts src/components/layout/CoachContextBar.test.tsx && npm run lint && npm run build`
Expected: PASS + lint OK + build OK (el build valida el montaje de `CoachScopeGuard` en `App.tsx`, `ROUTES.COACH` si se agregó aquí, y errores de TypeScript que lint no cubre).

---

### Task 9: Roster `/coach` (`CoachRosterPage`) + ruta

**Files:**
- Modify: `src/constants/routes.ts` (`COACH: '/coach'` — si Task 8 ya lo agregó, verificar y seguir)
- Create: `src/pages/CoachRosterPage.tsx`
- Modify: `src/App.tsx` (reemplazar el redirect legacy `/coach → CHAT` de la línea ~313 por la ruta real, dentro de `AppShell`)
- Test: `src/pages/CoachRosterPage.test.tsx`

**Interfaces:**
- Consumes: `isCoachAccount` (Task 6), `listOwnedAthletes`/`createManagedAthlete` (2a), `switchActiveAthlete` (Task 5), `getSelfAthleteId`, `ROUTES`.
- Produces: página default-export `CoachRosterPage`; no-coach → `<Navigate to={ROUTES.HOME} replace />`.

- [ ] **Step 1: Tests que fallan**

```tsx
// src/pages/CoachRosterPage.test.tsx
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import CoachRosterPage from './CoachRosterPage'
import { useAuthStore } from '../store/useAuthStore'
import { setActiveAthleteId, setSelfAthleteId } from '../services/athlete/activeAthlete'
import type { User } from '@supabase/supabase-js'

import type { Athlete } from '../types'

const ROSTER: Athlete[] = [
  { id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', displayName: 'Rafa', status: 'active', createdAt: 1, updatedAt: 1 },
  { id: 'ath_m_abc', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Cliente 1', status: 'active', createdAt: 1, updatedAt: 1 },
]

// renderToStaticMarkup no ejecuta efectos → initialAthletes inyecta el roster
// que en runtime carga el useEffect (listOwnedAthletes).
function render(allowlist: string, initialAthletes: Athlete[] = []) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/coach']}>
      <Routes>
        <Route path="/coach" element={<CoachRosterPage allowlistOverride={allowlist} initialAthletes={initialAthletes} />} />
        <Route path="/" element={<p>HOME</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('CoachRosterPage', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'user-1', email: 'rafa@x.cl' } as User, activeAthleteId: 'ath_user-1' })
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_user-1')
  })

  afterEach(() => {
    useAuthStore.setState({ user: null, activeAthleteId: null })
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('no-coach entrando manualmente a /coach: redirige a home', () => {
    // renderToStaticMarkup no sigue el redirect, pero el markup del roster no debe aparecer
    const html = render('otra@persona.cl')
    expect(html).not.toContain('Mis atletas')
  })

  it('coach allowlisted con solo self: ve su card "Tú" y el CTA de crear', () => {
    const html = render('rafa@x.cl', [ROSTER[0]])
    expect(html).toContain('Mis atletas')
    expect(html).toContain('Tú')
    expect(html).toContain('Entrenando ahora') // self activo, sin botón de switch
    expect(html).toContain('Crear atleta')
  })

  it('con gestionado en el roster: card con nombre real y botón de switch', () => {
    const html = render('rafa@x.cl', ROSTER)
    expect(html).toContain('Cliente 1')
    expect(html).toContain('Entrenar como este atleta')
  })
})
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx vitest run src/pages/CoachRosterPage.test.tsx` → FAIL (módulo no existe).

- [ ] **Step 3: Implementar `CoachRosterPage`**

```tsx
// src/pages/CoachRosterPage.tsx
import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Plus, Users } from 'lucide-react'
import { useAuthStore } from '../store/useAuthStore'
import { isCoachAccount } from '../services/athlete/coachAccess'
import { getSelfAthleteId } from '../services/athlete/activeAthlete'
import { createManagedAthlete, listOwnedAthletes } from '../services/athlete/managedAthletes'
import { switchActiveAthlete } from '../services/athlete/switchActiveAthlete'
import { ROUTES } from '../constants/routes'
import type { Athlete } from '../types'

interface CoachRosterPageProps {
  /** Solo tests: inyecta la allowlist sin depender de import.meta.env. */
  allowlistOverride?: string
  /** Solo tests: roster inicial (renderToStaticMarkup no ejecuta efectos). */
  initialAthletes?: Athlete[]
}

export default function CoachRosterPage({ allowlistOverride, initialAthletes }: CoachRosterPageProps) {
  const user = useAuthStore((state) => state.user)
  const activeAthleteId = useAuthStore((state) => state.activeAthleteId)
  const [athletes, setAthletes] = useState<Athlete[]>(initialAthletes ?? [])
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const isCoach = allowlistOverride !== undefined
    ? isCoachAccount(user, allowlistOverride)
    : isCoachAccount(user)

  useEffect(() => {
    if (!isCoach || !user?.id) return
    let cancelled = false
    void listOwnedAthletes(user.id).then((rows) => {
      if (!cancelled) setAthletes(rows)
    })
    return () => { cancelled = true }
  }, [isCoach, user?.id, activeAthleteId])

  if (!isCoach || !user?.id) return <Navigate to={ROUTES.HOME} replace />

  const selfId = getSelfAthleteId()

  async function handleCreate() {
    if (!user?.id) return
    setError(null)
    try {
      const athlete = await createManagedAthlete(user.id, newName)
      setNewName('')
      setIsCreating(false)
      await switchActiveAthlete(user.id, athlete.id)
      // Completar el perfil del gestionado con el flujo guiado (spec 2b §6).
      navigate(ROUTES.ONBOARDING)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'No se pudo crear el atleta.')
    }
  }

  async function handleTrainAs(athleteId: string) {
    if (!user?.id || athleteId === activeAthleteId) return
    const ok = await switchActiveAthlete(user.id, athleteId)
    if (ok) navigate(ROUTES.HOME)
  }

  return (
    <div className="mx-auto max-w-md px-4 pb-8 pt-12">
      <div className="mb-6 flex items-center gap-2">
        <Users size={20} className="text-brand" />
        <h1 className="font-display text-2xl font-bold text-ink">Mis atletas</h1>
      </div>

      <div className="space-y-3">
        {athletes.map((athlete) => {
          const isSelf = athlete.id === selfId
          const isActive = athlete.id === activeAthleteId
          return (
            <div
              key={athlete.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {isSelf ? 'Tú' : (athlete.displayName ?? 'Atleta')}
                </p>
                {isActive && <p className="text-xs text-brand">Entrenando ahora</p>}
              </div>
              {!isActive && (
                <button
                  type="button"
                  onClick={() => void handleTrainAs(athlete.id)}
                  className="flex-shrink-0 rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-white/10"
                >
                  Entrenar como este atleta
                </button>
              )}
            </div>
          )
        })}
      </div>

      {isCreating ? (
        <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-ink-muted">Nombre del atleta</span>
            <input
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Ej. Juan Pérez"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-ink outline-none"
            />
          </label>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setIsCreating(false); setError(null) }}
              className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-semibold text-ink-muted"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!newName.trim()}
              onClick={() => void handleCreate()}
              className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              Crear y completar perfil
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/20 py-3 text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
        >
          <Plus size={16} />
          Crear atleta
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Ruta en `App.tsx`**

1. Import lazy junto a las demás páginas (seguir el patrón de imports existente del archivo, lazy o directo según estén las otras): `const CoachRosterPage = lazy(() => import('./pages/CoachRosterPage'))` o import directo si el resto es directo.
2. Reemplazar la línea `<Route path="/coach" element={<Navigate to={ROUTES.CHAT} replace />} />` (App.tsx:313) por:

```tsx
<Route path={ROUTES.COACH} element={<RouteBoundary><CoachRosterPage /></RouteBoundary>} />
```

3. Verificar que `ROUTES.COACH: '/coach'` existe en `src/constants/routes.ts` (Task 8 pudo haberlo agregado; si no, agregarlo).

- [ ] **Step 5: Verificar**

Run: `npx vitest run src/pages/CoachRosterPage.test.tsx && npm run lint && npm run build`
Expected: PASS + lint OK + build OK (el build valida el wiring de rutas).

---

### Task 10: `migrateLocalDataToCloud` → onConflict compuesto por atleta

**Files:**
- Modify: `src/services/syncService.ts:3436-3437`
- Modify: `src/services/__tests__/syncService.test.ts:504-505` (expectativa existente)

**Interfaces:**
- Consumes: filas ya estampadas por `withAthleteId(row, entity.athleteId)` (verificado: `syncService.ts:3412-3414`; el backfill corre antes del migrate en el flujo de App).
- Produces: comportamiento — el migrate deduplica por `(athlete_id, date)` / `(athlete_id, week_start_date)`. **Requiere `010b` aplicada en remoto** (full unique); ver Task 11/12.

- [ ] **Step 1: Actualizar el test existente (falla primero)**

En `src/services/__tests__/syncService.test.ts` líneas 504-505, cambiar:

```ts
expect(upsertCalls.find((call) => call.table === 'day_logs')?.options).toEqual({ onConflict: 'athlete_id,date' })
expect(upsertCalls.find((call) => call.table === 'week_summaries')?.options).toEqual({ onConflict: 'athlete_id,week_start_date' })
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/services/__tests__/syncService.test.ts`
Expected: FAIL en ese test (el código aún manda `user_id,date`).

- [ ] **Step 3: Implementar**

En `src/services/syncService.ts` (~3436-3437), cambiar:

```ts
      upsertMigrationRows('day_logs', dayLogRows, { onConflict: 'athlete_id,date' }),
      upsertMigrationRows('week_summaries', weekRows, { onConflict: 'athlete_id,week_start_date' }),
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/services/__tests__/syncService.test.ts`
Expected: PASS completo (sin otras regresiones en el archivo).

- [ ] **Step 5: Lint + suite completa de services**

Run: `npm run lint && npx vitest run src/services/`
Expected: verde.

---

### Task 11: SQL `010a` / `010b` / `010c` (day/week expand → contract)

**Files:**
- Create: `supabase/010a_day_week_preflight.sql`
- Create: `supabase/010b_day_week_expand.sql`
- Create: `supabase/010c_day_week_contract.sql`

**Interfaces:**
- Produces: migraciones de aplicación manual (Task 12 define el orden). No afectan el bundle ni los tests.

- [ ] **Step 1: `010a` — preflight report-only (incluye descubrimiento de nombres legacy)**

```sql
-- supabase/010a_day_week_preflight.sql
-- Coach F2 Parte 2b — preflight day_logs/week_summaries (report-only, NO escribe).
-- Gate duro para 010b/010c: null debt = 0 y duplicados por (athlete_id, <fecha>) = 0.

-- 1. Duplicados que bloquearían el full unique (deben ser 0).
select 'day_logs dup (athlete_id, date)' as check, count(*) as value from (
  select athlete_id, date from public.day_logs
  where athlete_id is not null group by athlete_id, date having count(*) > 1
) d
union all
select 'week_summaries dup (athlete_id, week_start_date)', count(*) from (
  select athlete_id, week_start_date from public.week_summaries
  where athlete_id is not null group by athlete_id, week_start_date having count(*) > 1
) w
union all
-- 2. Null debt (bloquea el SET NOT NULL de 010b).
select 'day_logs null athlete_id', count(*) from public.day_logs where athlete_id is null
union all
select 'week_summaries null athlete_id', count(*) from public.week_summaries where athlete_id is null;

-- 3. Descubrimiento de uniques existentes (los nombres legacy NO están en el
--    repo — el schema pre-007 fue manual). 010c los dropea dinámicamente;
--    este reporte es para verificación visual previa.
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('day_logs', 'week_summaries')
  and indexdef ilike '%unique%'
order by tablename, indexname;
```

- [ ] **Step 2: `010b` — expand (NOT NULL + full uniques)**

```sql
-- supabase/010b_day_week_expand.sql
-- Coach F2 Parte 2b — EXPAND: athlete_id not null + full unique (athlete_id, <fecha>).
-- Los índices parciales de 008b NO sirven como target de onConflict de PostgREST
-- (no infiere índices parciales) — por eso el full unique con nombre nuevo.
-- Coexiste con los uniques legacy (user_id, <fecha>) hasta 010c.
do $$
declare
  day_null int;
  week_null int;
  day_dup int;
  week_dup int;
begin
  select count(*) into day_null from public.day_logs where athlete_id is null;
  select count(*) into week_null from public.week_summaries where athlete_id is null;
  select count(*) into day_dup from (
    select athlete_id, date from public.day_logs
    where athlete_id is not null group by athlete_id, date having count(*) > 1
  ) d;
  select count(*) into week_dup from (
    select athlete_id, week_start_date from public.week_summaries
    where athlete_id is not null group by athlete_id, week_start_date having count(*) > 1
  ) w;
  if day_null > 0 or week_null > 0 or day_dup > 0 or week_dup > 0 then
    raise exception '010b aborted: day_logs(null=%, dup=%), week_summaries(null=%, dup=%). Resolver vía 010a antes de expandir.',
      day_null, day_dup, week_null, week_dup;
  end if;
end $$;

alter table public.day_logs alter column athlete_id set not null;
alter table public.week_summaries alter column athlete_id set not null;

create unique index if not exists day_logs_athlete_date_unique_full
  on public.day_logs (athlete_id, date);
create unique index if not exists week_summaries_athlete_week_unique_full
  on public.week_summaries (athlete_id, week_start_date);
```

- [ ] **Step 3: `010c` — contract (drop dinámico de legacy + parciales 008b)**

```sql
-- supabase/010c_day_week_contract.sql
-- Coach F2 Parte 2b — CONTRACT: drop de uniques legacy (user_id, <fecha>) +
-- parciales 008b (redundantes con el full unique de 010b).
-- PRERREQUISITOS (orden estricto): 010b aplicada; bundle 2b confirmado en prod
-- (migrate usa onConflict 'athlete_id,date' — un cliente PWA stale con
-- 'user_id,date' rompería su migrate tras este drop; el write path normal
-- NO usa esos onConflict, así que el riesgo queda acotado al migrate).
-- Los nombres legacy no están en el repo → descubrimiento dinámico por columnas.
do $$
declare
  r record;
begin
  -- Guard: el full unique de 010b debe existir antes de dropear nada.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'day_logs_athlete_date_unique_full'
  ) or not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'week_summaries_athlete_week_unique_full'
  ) then
    raise exception '010c aborted: full uniques de 010b no encontrados. Aplicar 010b primero.';
  end if;

  -- Drop de UNIQUE CONSTRAINTS legacy por columnas exactas (user_id, <fecha>).
  for r in
    select c.conname, t.relname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and c.contype = 'u'
      and (
        (t.relname = 'day_logs' and (
          select array_agg(a.attname::text order by k.ord)
          from unnest(c.conkey) with ordinality as k(attnum, ord)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        ) = array['user_id', 'date'])
        or
        (t.relname = 'week_summaries' and (
          select array_agg(a.attname::text order by k.ord)
          from unnest(c.conkey) with ordinality as k(attnum, ord)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        ) = array['user_id', 'week_start_date'])
      )
  loop
    execute format('alter table public.%I drop constraint %I', r.relname, r.conname);
    raise notice '010c: dropped unique constraint %.%', r.relname, r.conname;
  end loop;

  -- Drop de UNIQUE INDEXES legacy sin constraint asociado (mismas columnas).
  for r in
    select i.relname as indexname, t.relname as tablename
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and x.indisunique
      and t.relname in ('day_logs', 'week_summaries')
      and not exists (select 1 from pg_constraint c where c.conindid = x.indexrelid)
      and x.indpred is null -- los parciales 008b se dropean abajo por nombre
      and i.relname not in ('day_logs_athlete_date_unique_full', 'week_summaries_athlete_week_unique_full')
      and (
        (t.relname = 'day_logs' and (
          select array_agg(a.attname::text order by k.ord)
          from unnest(x.indkey::int2[]) with ordinality as k(attnum, ord)
          join pg_attribute a on a.attrelid = x.indrelid and a.attnum = k.attnum
        ) = array['user_id', 'date'])
        or
        (t.relname = 'week_summaries' and (
          select array_agg(a.attname::text order by k.ord)
          from unnest(x.indkey::int2[]) with ordinality as k(attnum, ord)
          join pg_attribute a on a.attrelid = x.indrelid and a.attnum = k.attnum
        ) = array['user_id', 'week_start_date'])
      )
  loop
    execute format('drop index public.%I', r.indexname);
    raise notice '010c: dropped unique index %', r.indexname;
  end loop;
end $$;

-- Parciales 008b: redundantes con los full uniques de 010b (nombres SÍ en repo).
drop index if exists public.day_logs_athlete_date_unique;
drop index if exists public.week_summaries_athlete_week_unique;
```

- [ ] **Step 4: Verificación estática**

Run: `npm run lint && npm test && npm run build`
Expected: verde (los `.sql` no afectan bundle/tests; esto valida que nada quedó roto en el cierre del plan).

---

### Task 12: Rollout operacional (manual, owner — sin código)

**Orden estricto** (spec §10; mismo patrón expand/contract que `009`):

- [ ] **Step 1:** Confirmar bundle 2a estable en prod (hard refresh en todos los dispositivos usados; sin PWA stale escribiendo sin `athlete_id`).
- [ ] **Step 2:** Correr `supabase/010a_day_week_preflight.sql` → duplicados = 0 y null debt = 0. Si hay deuda, backfillear `athlete_id` manualmente (`update ... set athlete_id = 'ath_<user_id>' where athlete_id is null`) y re-correr.
- [ ] **Step 3:** Aplicar `supabase/010b_day_week_expand.sql` (NOT NULL + full uniques; los legacy siguen vivos).
- [ ] **Step 4:** Configurar `VITE_COACH_ACCOUNTS=<email del owner>` en Netlify. Push + deploy del bundle 2b (ejecutor, con OK del owner — los commits por task ya existen). **Gate duro: NO push/deploy antes de que 010b esté aplicada** — Task 10 cambió el `onConflict` del migrate a `'athlete_id,date'`/`'athlete_id,week_start_date'`, que requiere los full uniques de 010b (sin ellos, el migrate de un dispositivo nuevo falla con "no unique or exclusion constraint matching the ON CONFLICT specification"). Hard refresh y confirmar bundle nuevo.
- [ ] **Step 5:** Smoke pre-contract: dashboard/semana/check-in/chat del self funcionan igual; el pill "Tú" aparece; `/coach` carga con tu card.
- [ ] **Step 6:** Aplicar `supabase/010c_day_week_contract.sql`.
- [ ] **Step 7:** Smoke multi-atleta completo: crear gestionado desde `/coach` → onboarding del gestionado → generarle plan → check-in del gestionado **en la misma fecha** que un check-in tuyo → sin `23505` → "Volver a ti" → tu semana/chat/plan intactos → hard refresh → persistencia OK.
- [ ] **Step 8:** Re-correr `010a` y `008a`: duplicados en 0. Actualizar `PROJECT_REVIEW_AND_ROADMAP.md` (gates F cerrados).

Rollback de emergencia (solo si el smoke multi-atleta falla de forma grave):

1. **Rollback primario (siempre seguro):** quitar `VITE_COACH_ACCOUNTS` de Netlify + redeploy. La UI coach desaparece y `CoachScopeGuard` (global en `AuthGate`, Task 8) fuerza el retorno al self en la próxima carga aunque el navegador tuviera un gestionado activo persistido (`hydrateActiveAthlete` respeta la selección sin consultar allowlist — el guard cierra ese gap) — **incluida `/onboarding`**, que vive fuera de `AppShell`. Fallback manual si hiciera falta: "Volver a ti" antes de quitar la allowlist, o `localStorage.removeItem('entrenador_active_athlete:<ownerId>')` + hard refresh. Los full uniques de `010b` quedan — no molestan al mundo single-athlete.
   Smoke de rollback obligatorio: con gestionado activo, quedarse en `/onboarding`, quitar la allowlist (o simular con env local), hard refresh → debe volver al self.
2. **Restaurar uniques legacy — SOLO si es imprescindible y CON limpieza previa.** Después del smoke del Step 7 ya pueden existir dos atletas del owner con check-in en la misma fecha → recrear `(user_id, date)` fallaría con duplicados. Detectar primero:

```sql
-- Filas que bloquearían la restauración del unique legacy:
select user_id, date, count(*) from public.day_logs
group by user_id, date having count(*) > 1;
select user_id, week_start_date, count(*) from public.week_summaries
group by user_id, week_start_date having count(*) > 1;
```

Si hay filas, borrar/mergear manualmente las de atletas gestionados (`athlete_id like 'ath_m_%'`) antes de:

```sql
create unique index if not exists day_logs_user_date_legacy_restore
  on public.day_logs (user_id, date);
create unique index if not exists week_summaries_user_week_legacy_restore
  on public.week_summaries (user_id, week_start_date);
```

En la práctica, el paso 1 basta para cualquier emergencia realista; el paso 2 es solo para revertir la arquitectura completa.

---

## Self-Review Notes

- **Spec coverage:** §2 gating → Task 6 (+ guards de render en Tasks 8-9); §3.1 epoch + 3 vectores → Tasks 1, 3, 4 (+ tokens de loads en Task 2); §3.2 resets → Task 2; §3.3 secuencia switch → Task 5; §4 CoachContextBar/remount → Task 8; §5 roster → Task 9; §6 onboarding → Task 7; §7 migración 010 + cliente → Tasks 10-11; §10 rollout → Task 12. §8 (errores) queda cubierto por diseño en Tasks 3/5 (rollback id-scoped, validación de target, selección corrupta ya resuelta en Parte 1).
- **Type consistency:** `resetForAthleteSwitch(): void` idéntico en los 5 stores (Task 2) y consumido con ese nombre en Task 5. `switchActiveAthlete(ownerAccountId, athleteId): Promise<boolean>` (Task 5) consumida en Tasks 8-9. `isCoachAccount(user, rawAllowlist?)` (Task 6) con `allowlistOverride` prop solo-tests en Tasks 8-9. `getSwitchEpoch`/`bumpSwitchEpoch` (Task 1) consumidas en Tasks 3-5.
- **Decisión documentada:** `switchActiveAthlete` como servicio (no acción de `useAuthStore`) para evitar import circular — desviación consciente del spec §3.3, anotada en Task 5.
- **Riesgo conocido:** los tests de componentes usan `renderToStaticMarkup` (patrón del repo) → no ejecutan efectos; el gating se testea por render estático y la lógica de datos por servicios. El smoke de Task 12 cubre la interacción real.
- **Commits:** un commit por task por el ejecutor (autorización explícita del owner, 2026-07-04); sin push salvo pedido. Cierre total: `npm run lint && npm test && npm run build` en Task 11 Step 4.
- **Ajustes de review del plan (2026-07-04):** (1) guard de `acceptProposal` cubre el switch durante la ÚLTIMA acción (check post-loop que fuerza el path de rollback — sin él, la proposal se marcaba `accepted` con la sesión contaminada y el propio test del Task 3 habría fallado); (2) rollback SQL legacy deja de ser universal: primero ocultar UI vía allowlist, restaurar uniques legacy solo tras detectar/limpiar duplicados multi-atleta; (3) fixtures válidos: `ATHLETE_PROFILE_LOCAL_ID` en vez del literal prohibido y `makeWeekSummary()` con los contadores obligatorios; (4) OnboardingPage: `useState` agregado al import de React y efecto dependiente de `activeAthleteId` (fuera de AppShell no hay remount por key); (5) `initialAthletes` prop solo-tests en CoachContextBar/CoachRosterPage (renderToStaticMarkup no ejecuta efectos) con asserts de nombre real y CTAs; (6) ejecución task-by-task sin dependencia de sub-skills externas.
- **Ajustes de review del plan, ronda 2 (2026-07-04):** (1) `enforceCoachScopeGuard` (Task 8) — quitar la allowlist NO forzaba volver al self: `hydrateActiveAthlete` respeta la selección persistida sin consultarla; el guard fuerza el retorno + limpieza de selección, con tests propios; el rollback del Task 12 lo referencia con fallback manual; (2) Task 12 Step 4 consistente con la constraint de commits (push/deploy por el ejecutor con OK del owner) + gate duro explícito: NO deploy del bundle 2b antes de 010b (el migrate con onConflict compuesto lo requiere); (3) P3 del review (import duplicado de `useTrainingStore` en Task 2) NO se reprodujo: las tres apariciones son de tres archivos de test distintos (Tasks 2/3/5), una por snippet.
- **Ajustes de review del plan, ronda 3 (2026-07-04):** el guard de scope pasó de efecto en `CoachContextBar` a componente global `CoachScopeGuard` montado en `AuthGate` ANTES de `OnboardingGuard` — `CoachContextBar` solo monta dentro de `AppShell` y `/onboarding` vive fuera: un hard refresh ahí con gestionado activo y allowlist removida no habría corrido el guard. `CoachContextBar` queda solo-UI. Smoke de rollback nuevo: hard refresh en `/onboarding` con gestionado activo → vuelve al self.

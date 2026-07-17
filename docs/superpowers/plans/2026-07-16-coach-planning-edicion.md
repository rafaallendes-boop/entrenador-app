# Coach Planning Edición — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El coach crea, edita y borra sesiones de cualquier atleta de su roster desde `/coach` → Planificación, sin cambiar el atleta activo, con recálculo de resúmenes correcto y sync remoto athlete-scoped.

**Architecture:** Espejo de escritura de `coachScopedReads`: scope explícito `{athleteId, includeLegacy}` resuelto una vez (link-aware), núcleo puro de recálculo dentro de una transacción Dexie, pushes post-commit con target remoto discriminado (`scoped`/`legacySelf`), e hidratación (sesiones + day logs + summary) como precondición del servicio.

**Tech Stack:** React + TypeScript + Vite, Dexie v17 (fake-indexeddb en tests), Supabase (cliente mockeado en tests de sync), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-16-coach-planning-edicion-design.md` (rev. 5, aprobada). Ante cualquier ambigüedad del plan, la spec manda.

## Revisión técnica verificada — 2026-07-16

Estado: **corregido en este documento; todavía no implementado**. Los hallazgos se contrastaron contra la spec rev. 5 y el código actual (`queries.ts`, `syncService.ts`, `syncUtils.ts`, `coachScopedReads.ts`, `AddSessionModal.tsx`, `CoachPlanningPanel.tsx`, `dataExport.ts`, los tipos y los tests existentes). Las correcciones ya están incorporadas en las tasks correspondientes; esta tabla queda como índice para la revisión del owner.

| ID | Severidad | Hallazgo verificado | Corrección incorporada |
|---|---|---|---|
| R1 | Alta | Task 3 dejaba los wrappers públicos con sus cuerpos actuales. `getSessionsForWeek` filtra el atleta activo **después** de un `await`, y `upsertWeekSummary` vuelve a leerlo; por lo tanto no cumplía el invariante de capturar scope una vez. | Los cinco wrappers capturan `{ athleteId, includeLegacy }` sincrónicamente una vez; el branch `activeAthleteId === null` usa helpers legacy privados que no releen holders. |
| R2 | Alta | Task 4 no permitía borrar campos opcionales: `Partial<T>` + checks `!== undefined` confunde “clave ausente” con “limpiar a undefined”. Además, el cambio de tipo a running/cycling no creaba `runningDetails` y la re-derivación de ciclismo pisaba `executionNotes`. | El patch usa presencia de clave (`hasOwn`), se agregan tests de limpieza, los defaults por tipo incluyen `runningDetails` y solo se re-derivan los campos deportivos declarados por la spec. |
| R3 | Alta | Los pulls de Task 5 retornaban `void` y salían silenciosamente sin backend, offline o por veto/tombstone. Task 8 los interpretaba como éxito y marcaba la semana hidratada. | Los tres pulls retornan un outcome discriminado (`completed`/`unavailable`/`vetoed`); solo tres `completed` habilitan la marca. |
| R4 | Alta | Los pulls nuevos de day logs/summaries buscaban solo por `id`; con otro `id` y la misma clave natural Dexie v14 (`[athleteId+date]` / `[athleteId+weekStartDate]`) podían lanzar `ConstraintError` o dejar un ganador incorrecto. | Se exige reconciliación LWW por clave natural, incluyendo la equivalencia legacy-self, dentro del lease/transacción. |
| R5 | Alta | El registro de Task 8 retornaba temprano si ya había marca, por lo que el test “refresh fallido invalida marca previa” nunca ejecutaba el refresh. Su epoch global tampoco impedía que un refresh viejo marcara después de uno nuevo fallido. | `ensureWeekHydrated` acepta `force`, el panel fuerza refresh, los writes reutilizan marca, y hay generación por clave + deduplicación de in-flight. |
| R6 | Alta | Las operaciones nuevas de sesión omitían piezas críticas del sync actual: serialización por entidad, tracking de in-flight para la barrera de borrado, `ensureRemoteAthlete` antes de insert y limpieza de ops viejas tras éxito. También se proponía declarar dos veces `rememberSessionDeleteTombstone`. | El executor athlete-scoped conserva esas garantías; la función privada existente se convierte en export y se valida el target deserializado. |
| R7 | Alta | La op offline de `pushWeekSummaryForAthlete` no tenía discriminante. El drain genérico habría ejecutado `.upsert(payload)` sin `user_id`, perdiendo update-first, filtro athlete-scoped y reconciliación LWW. | Se agrega metadata serializable de replay y una rama de drain específica que reutiliza el mismo executor athlete-scoped. |
| R8 | Alta | La reconciliación inmediata de summaries podía sobrescribir un edit local más nuevo ocurrido mientras esperaba la red; la recursión de carrera no estaba realmente acotada. | Bajo el lease se relee el natural key local antes de aplicar al ganador remoto; el retry es un loop acotado y, al agotarse, reencola. |
| R9 | Alta | Task 9 resolvía self/scope varias veces y usaba `resolveAuthoredByRole`, que depende del holder global. Con holder `null` clasifica incluso un gestionado como `self`. Además construía updates desde una fila leída **antes** de hidratar. | Cada operación resuelve un scope una vez, deriva autoría desde `scope.includeLegacy`, pasa ese scope a hidratación, y relee/aplica el patch dentro de la transacción con retry si cambió una semana afectada. |
| R10 | Media | El update siempre re-derivaba `weekStartDate`, aunque la spec exige preservarlo si `date` no cambia; `Date.now()` tampoco garantiza un `updatedAt` estrictamente nuevo en el mismo milisegundo. | Solo se re-deriva al cambiar fecha y se usa timestamp monotónico `max(Date.now(), previo + 1)`. |
| R11 | Media | La invalidación de import estaba asignada a `appMaintenance.ts`, pero el reemplazo/merge real vive en `src/services/dataExport.ts`. El plan tampoco cubría cambios de cuenta vía `onAuthStateChange`, y el holder self no está account-scoped. | Task 8 modifica `dataExport.ts`; logout/transición de cuenta limpian registro y holders antes de reutilizarlos. |
| R12 | Alta | El repo no tiene `@testing-library/react` ni un environment DOM; `renderToStaticMarkup` no puede probar submit, doble click, backdrop ni errores stateful de Tasks 10–13. | Se agregan dependencias **solo dev** de Testing Library + jsdom y los tests interactivos usan environment jsdom; el bundle de producción se verifica sin cambios. |
| R13 | Media | La extracción propuesta perdía `defaultDate`; además `SessionForm` se montaba con fallback squash antes de que llegara el perfil y no adoptaba el deporte async. El default real hoy prioriza `sportContext.primarySport`. | `SessionForm` recibe `defaultDate`; el modal espera el lookup antes de montar en create y resuelve `sportContext.primarySport ?? primarySport ?? 'squash'`. Los cierres consultan el ref síncrono, no solo state. |
| R14 | Media | `getAthleteProfileForAthlete` omitía el fallback por `id` para gestionados que sí exige la spec; el fixture de membresía de Task 1 omitía `createdAt`, requerido por `AthleteMembership`. | Se corrigen implementación y fixtures/tests. |
| R15 | Alta | Importar estáticamente `coachPlanningHydration.ts` desde `useAuthStore` o `managedAthletes` crea un ciclo: hydration → `syncService` → `useAuthStore`, y managed ya importa sync. | El estado/invalidación se separa en un módulo registry sin dependencias de sync; hydration lo consume y re-exporta la API pública. |
| R16 | Media | Task 11 movía solo desde el primer campo, pero el wrapper de ejemplo tampoco conservaba el header/X; `onCancel` podía quedar sin UI concreta y se perdía “Nueva sesion”. | `SessionForm` incluye header + X + campos + submit; solo overlay/contenedor quedan en cada modal. El X es el control cancel y se deshabilita durante submit. |
| R17 | Alta | Reencolar desde dentro de `drainQueue` se perdería: al final el drain hace `saveQueue([...otherUsersQueue, ...remaining])` y sobrescribe lo agregado concurrentemente por `enqueue`. | El executor devuelve `retry`; push online encola, pero replay registra en `remaining` el reemplazo con retryCount incrementado y el payload del candidato local más nuevo para que el commit por delta de R30 lo reconcilie contra la versión persistida. |
| R18 | Alta | El pseudocódigo de Task 9 lanzaba `HydrationScopeChangedError`, pero no mostraba el wrapper que lo captura; create tampoco revalidaba la marca dentro de la transacción. Una invalidación concurrente podía quedar como error interno o permitir recalcular después de vaciar/importar datos. | Las tres operaciones revalidan las marcas dentro de la transacción y su fase preparación→hidratación→write vive en un loop de máximo tres intentos; el error interno nunca llega a UI. |
| R19 | Media | La tabla de derivados de Task 4 exigía `objective → squashDetails.trainingFocus`, pero el pseudocódigo solo actualizaba `subtype` y running/cycling. | Se agrega la rama same-type para objetivo —incluida su limpieza— preservando `drills`/`blocks`/`sessionMode`, más su regresión. |
| R20 | Alta | `upsertWeekSummaryCore` usaba `Date.now()` directo. Dos recálculos con cambios dentro del mismo milisegundo podían conservar el mismo `updatedAt`; D7 interpreta el empate como victoria remota y podía perder el segundo cambio local. | Los updates del summary usan timestamp monotónico `max(Date.now(), existing.updatedAt + 1)` y hay regresión con reloj congelado. |

Segunda pasada verificada — 2026-07-17 (contrastada contra `syncQueue.ts`, `athleteWriteLease.ts`, `planningWeek.ts`, `ensureRemoteAthlete`, el modal y los fixtures de tests reales):

| ID | Severidad | Hallazgo verificado | Corrección incorporada |
|---|---|---|---|
| R21 | Alta | `draftToPatch` (solo claves que difieren) combinado con la rama de cambio de `type` (que regenera defaults SOLO desde el patch) pierde datos visibles idénticos: cycling→running con los mismos paces los borra (`runningTargets` omitido ⇒ `runningDetails` regenerado vacío); strength↔mobility con los mismos ejercicios los elimina (`patch.exercises` ausente ⇒ `exercises: undefined`). | Cuando `draft.type !== original.type`, `draftToPatch` emite el draft COMPLETO (todas las claves visibles), y la rama de cambio de tipo documenta esa precondición. Tests nuevos en Tasks 4 y 12. |
| R22 | Alta | El path online de `pushWeekSummaryForAthlete` (Task 7) omitía las garantías que R6 exigió para sesiones: sin precheck de tombstone, sin `trackInFlightAthleteOp`/`withSerializedEntityMutation` (la barrera del borrado duro no lo espera y dos pushes del mismo summary pueden intercalarse) y sin `clearQueuedOpsForEntityOlderThan` tras éxito (una op encolada vieja puede pisar después un summary más nuevo ya subido). | El push online envuelve la ejecución con los mismos puntos 1–5 de Task 6 y limpia ops viejas tras éxito; tests de barrera y de compactación agregados. |
| R23 | Media | `ensureWeekHydrated` escribía filas remotas en Dexie para cualquier `athleteId` sin validar roster; hoy solo la cubre de rebote el `getWeekSessionsForAthlete` previo del panel. | Al iniciar una hidratación real (no al reutilizar marca) valida `assertActiveRosterAthlete`; los tests de Task 8 siembran `db.athletes` y agregan el caso fuera de roster/archivado. Sin ciclo: `coachScopedReads` no importa hydration. |
| R24 | Media | Task 5 convertía offline en retorno `unavailable` silencioso; `hydrateWeekForAthlete` (único consumidor del panel hasta Task 13) lo trataría como éxito y el panel mostraría una semana sin hidratar como fresca entre los commits de Task 5 y Task 13. | `hydrateWeekForAthlete` lanza cuando el outcome no es `completed` (misma semántica visible que hoy); Task 13 la retira si queda sin consumidores. |
| R25 | Media | Task 6 nombraba el replay `executeSessionReplayUpsert` y el snippet de drain de Task 7 llamaba `executeSessionTargetReplay(op)` — identificadores inconsistentes entre tasks para la misma función. | Task 6 define `executeSessionTargetReplay(op)` (despacha upsert y delete + tombstone) y Task 7 lo consume con ese nombre. |
| R26 | Media | Task 7 usaba `findLocalWeekSummaryForAthleteWeek` sin definirla en ninguna task. | Definición agregada en Task 7 (lookup por `[athleteId+weekStartDate]`; los summaries de D2 siempre están scoped). |
| R27 | Media | El borrado directo (sin `ConfirmDialog`) del panel solo se guardaba con el state `deleting`; dos clicks en el mismo tick disparan dos `deleteSessionForAthlete` y el segundo pinta un banner de error confuso ("La sesión no pertenece a este atleta."). | `performDelete` usa guard síncrono por ref (además del state visual), con test de doble click. |
| R28 | Media | `draft.exercises = []` es truthy: create almacenaba `exercises: []` donde el modal actual guarda `undefined`; además el serializer perdía el default de reps (`reps.trim() \|\| '10'`) del modal actual. | Create y cambio de tipo usan `?.length` para caer a `undefined`; `SessionForm` conserva el default de reps al construir el draft. En edit same-type, `[]` explícito sigue eliminando todos. |

Tercera pasada — review del owner (2026-07-17), verificada contra `syncService.ts` (drain), `syncQueue.ts`, `package.json` y la spec:

| ID | Severidad | Hallazgo verificado | Corrección incorporada |
|---|---|---|---|
| R29 | Alta | La rama de cambio de `type` llamaba `draftExercisesToExercises(patch.exercises, undefined)`: en strength↔mobility los `id` de ejercicios sobreviven al cambio y el merge contra `undefined` perdía `completed`, `warmupSets`, `group` y targets, contradiciendo la spec (D4, ejercicios — merge por `id` sin restricción de modo). | La rama de cambio de tipo mergea contra `existing.exercises`; los tests (Tasks 4 y 12) verifican la metadata completa, no solo nombres. |
| R30 | Alta | R22 no cubría la carrera push-online↔`drainQueue`: el drain snapshotea la cola (`loadQueue()`, syncService.ts:914) y al final la sobrescribe entera (`saveQueue([...otherUsersQueue, ...remaining])`, :1131). Una op limpiada por un push online durante el drain igual se ejecutaba desde el snapshot, y un enqueue concurrente se perdía en el commit final. Dos precisiones de la review del owner: (a) el estado/retorno del drain (`markSyncRecovered`/`markSyncHealthy`/`return`, :1146) también se calculaba desde `remaining` del snapshot — podía retornar `true` y marcar saludable con una op concurrente sobreviviendo; (b) `offlineOpsShareIdentity` usa `enqueuedAt` de `Date.now()` — `compactQueue` reemplaza la op del mismo entity y en el mismo milisegundo la versión nueva comparte identidad con la vieja, así que el drain podía ejecutar el payload viejo y consumir el nuevo. | Dentro de la lane se revalida que la op siga en la cola persistida exigiendo **identidad + equivalencia estricta con la versión del snapshot** (payload, `scopeAthleteId`, `sessionTarget`, `replayKind`; no retry metadata); identidad presente pero contenido distinto = superseded: se salta y se preserva. El commit final es un delta sobre `loadQueue()` actual. Las ops finales del usuario determinan pending/healthy/return; el progreso y los errores se derivan de los resultados de las versiones del snapshot que realmente sobrevivieron como retry. Tests concurrentes cubren enqueue sobreviviente, cierre del intento, colisión de identidad, progreso con cambio de cardinalidad y no-regresión. |
| R31 | Media | El assert de roster de R23 quedaba ambiguo: como `await` antes de registrar el in-flight, un `ensure` concurrente durante ese await no vería in-flight y dispararía pulls duplicados (rompe la deduplicación). | `assertActiveRosterAthlete` corre como primer `await` DENTRO de la promesa registrada como in-flight (dentro del try → su fallo pasa por `failHydration`). |
| R32 | Media | Tasks 11/12 anotaban retornos `JSX.Element`; el proyecto usa React 19.2 + @types/react 19.2 (sin namespace global `JSX`) y cero usos de `JSX.Element` en `src/` — no compilaría y rompe el estilo del repo (inferencia). | Se quitan las anotaciones de retorno; los componentes usan inferencia como el resto del codebase. |
| R33 | Media | R28 dejaba el default/trim de reps y notes solo en `SessionForm`; el serializer seguía aceptando valores crudos, dependiendo de un único caller para el invariante. | `draftExercisesToExercises` centraliza `reps.trim() \|\| '10'` y `notes.trim() \|\| undefined` en ambas ramas; el default de `SessionForm` queda como comodidad de UI, no como única defensa. |

## Global Constraints

- **NO ejecutar `git commit` ni `git add`** — los commits los hace el owner (regla de CLAUDE.md). Cada task termina con verificación y un aviso de checkpoint.
- Nunca el literal `'default'` fuera de `activeAthlete.ts` — usar `ATHLETE_PROFILE_LOCAL_ID`, `getActiveAthleteId()` o `getSelfAthleteId()` (hay guard test `noDirectDefault.test.ts`).
- Sin cambios de schema: Dexie queda en v17, Supabase sin migraciones nuevas.
- No mutar los paths genéricos de sync (`upsertRow`/`deleteRow`): las operaciones athlete-scoped son funciones NUEVAS.
- Copys de UI en español, tuteo ("restauralo", "Actualizá").
- Patrón de test Dexie: `db.close(); await db.delete(); await db.open()` en `beforeEach`, `db.close()` en `afterEach` (ver `src/services/athlete/__tests__/coachScopedReads.test.ts`).
- Comandos: tests `npx vitest run <path>`, suite `npm test`, lint `npm run lint`, build `npm run build`.

## File Structure

| Archivo | Rol |
|---|---|
| `src/services/athlete/athleteWeekScope.ts` (create) | D0: `AthleteWeekScope`, `resolveSelfAthleteIdForOwner`, `resolveAthleteWeekScope` |
| `src/services/athlete/coachScopedReads.ts` (modify) | D0 fix self link-aware; D3 `assertActiveRosterAthlete`; `getAthleteProfileForAthlete` |
| `src/db/queries.ts` (modify) | D1: cores con scope explícito + wrappers compatibles |
| `src/services/athlete/coachSessionSerializer.ts` (create) | D4: `CoachSessionDraft`/`CoachSessionPatch`, serializer por modo, helpers de details movidos desde `AddSessionModal` |
| `src/utils/sessionRecordedWork.ts` (create) | D5: `hasRecordedWork(session)` pura |
| `src/services/sync/remoteSessionTarget.ts` (create) | D7: `RemoteSessionTarget` + `captureRemoteSessionTarget` |
| `src/services/syncService.ts` (modify) | D7: pulls de hidratación, `pushSessionForTarget`, `deleteSessionForTarget`, `pushWeekSummaryForAthlete`, `rememberSessionDeleteTombstone`, drain con target |
| `src/services/syncUtils.ts` (modify) | `OfflineOp.sessionTarget?` + discriminante de replay de summary |
| `src/services/sync/syncQueue.ts` (modify) | R30: equivalencia de versión de ops y commit del drain sin perder cambios concurrentes |
| `src/services/athlete/coachPlanningHydration.ts` (create) | D1: orquestador de los tres pulls; re-exporta API del registry |
| `src/services/athlete/coachPlanningHydrationRegistry.ts` (create) | Estado/generaciones/clear del registro, sin imports de sync (evita ciclos) |
| `src/services/athlete/coachScopedWrites.ts` (create) | D2: `createSessionForAthlete` / `updateSessionForAthlete` / `deleteSessionForAthlete` |
| `src/components/session/SessionForm.tsx` (create) | D4: form presentacional extraído |
| `src/components/session/AddSessionModal.tsx` (modify) | Queda como wrapper del atleta activo |
| `src/components/coach/CoachSessionModal.tsx` (create) | D6: modal coach con guard de doble submit |
| `src/components/coach/CoachPlanningPanel.tsx` (modify) | D6: siete días, CTAs, borrar/editar, banner |
| `src/store/useAuthStore.ts` (modify) | Invalidación en signOut y transición de cuenta; reset de holders |
| `src/services/appMaintenance.ts` (modify) | Invalidación al limpiar training data local |
| `src/services/dataExport.ts` (modify) | Invalidación en import replace/merge (el import real vive aquí) |
| `src/services/athlete/managedAthletes.ts` (modify) | Invalidación en borrado duro |
| `package.json`, `package-lock.json` (modify) | Infra de tests de interacción: Testing Library + jsdom, solo dev |

---

### Task 1: D0 — Scope resolver link-aware + fix de `coachScopedReads`

**Files:**
- Create: `src/services/athlete/athleteWeekScope.ts`
- Modify: `src/services/athlete/coachScopedReads.ts`
- Test: `src/services/athlete/__tests__/athleteWeekScope.test.ts`
- Test (modify): `src/services/athlete/__tests__/coachScopedReads.test.ts`

**Interfaces:**
- Consumes: `getSelfAthleteId()` (`activeAthlete.ts`), `getSelfMembership(accountId)` (`membershipCache.ts`, devuelve `Promise<AthleteMembership | undefined>` con `.athleteId`), `athleteIdForOwner(ownerAccountId)` (`athleteScopeMigration.ts`).
- Produces:
  ```typescript
  export interface AthleteWeekScope { athleteId: string; includeLegacy: boolean }
  export async function resolveSelfAthleteIdForOwner(ownerAccountId: string): Promise<string>
  export async function resolveAthleteWeekScope(ownerAccountId: string, athleteId: string): Promise<AthleteWeekScope>
  ```

- [ ] **Step 1: Test que falla**

```typescript
// src/services/athlete/__tests__/athleteWeekScope.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../db/db'
import { setSelfAthleteId } from '../activeAthlete'
import { resolveSelfAthleteIdForOwner, resolveAthleteWeekScope } from '../athleteWeekScope'

describe('athleteWeekScope', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
    setSelfAthleteId(null)
  })
  afterEach(() => {
    setSelfAthleteId(null)
    db.close()
  })

  it('prefiere el holder cuando está seteado (post-hidratación, link-aware)', async () => {
    setSelfAthleteId('ath_claimed_other')
    expect(await resolveSelfAthleteIdForOwner('user-1')).toBe('ath_claimed_other')
  })

  it('sin holder, resuelve por membresía self (ID distinto de ath_<owner>)', async () => {
    await db.athleteMemberships.put({
      accountId: 'user-1', athleteId: 'ath_claimed', role: 'self',
      createdAt: Date.now(), updatedAt: Date.now(),
    })
    expect(await resolveSelfAthleteIdForOwner('user-1')).toBe('ath_claimed')
  })

  it('fallback determinístico a athleteIdForOwner sin holder ni membresía', async () => {
    expect(await resolveSelfAthleteIdForOwner('user-1')).toBe('ath_user-1')
  })

  it('includeLegacy true solo cuando el athleteId ES el self resuelto', async () => {
    setSelfAthleteId('ath_claimed')
    expect(await resolveAthleteWeekScope('user-1', 'ath_claimed'))
      .toEqual({ athleteId: 'ath_claimed', includeLegacy: true })
    expect(await resolveAthleteWeekScope('user-1', 'ath_managed'))
      .toEqual({ athleteId: 'ath_managed', includeLegacy: false })
    // el shorthand ath_<owner> NO adopta legacy si el self real es otro
    expect(await resolveAthleteWeekScope('user-1', 'ath_user-1'))
      .toEqual({ athleteId: 'ath_user-1', includeLegacy: false })
  })
})
```

Shape verificado: `AthleteMembership` exige `athleteId`, `accountId`, `role`, `createdAt` y `updatedAt`; `getSelfMembership` discrimina con `role === 'self'` y la PK Dexie es `[athleteId+accountId]`.

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/athlete/__tests__/athleteWeekScope.test.ts`
Expected: FAIL — módulo `athleteWeekScope` no existe.

- [ ] **Step 3: Implementación**

```typescript
// src/services/athlete/athleteWeekScope.ts
import { getSelfAthleteId } from './activeAthlete'
import { getSelfMembership } from './membershipCache'
import { athleteIdForOwner } from './athleteScopeMigration'

/** Scope resuelto UNA vez por operación; nunca se re-lee entre awaits (spec D0/D1). */
export interface AthleteWeekScope {
  athleteId: string
  includeLegacy: boolean
}

/**
 * Self link-aware del owner: holder (ya hidratado) → membresía self reclamada →
 * fallback determinístico ath_<owner>. `athleteIdForOwner` a secas es incorrecto
 * cuando el self viene de una membresía reclamada con otro ID (spec D0).
 */
export async function resolveSelfAthleteIdForOwner(ownerAccountId: string): Promise<string> {
  const holder = getSelfAthleteId()
  if (holder) return holder
  const membership = await getSelfMembership(ownerAccountId)
  return membership?.athleteId ?? athleteIdForOwner(ownerAccountId)
}

/** Las filas legacy/unscoped pertenecen SOLO al self (regla dura del proyecto). */
export async function resolveAthleteWeekScope(
  ownerAccountId: string,
  athleteId: string,
): Promise<AthleteWeekScope> {
  const selfId = await resolveSelfAthleteIdForOwner(ownerAccountId)
  return { athleteId, includeLegacy: athleteId === selfId }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/services/athlete/__tests__/athleteWeekScope.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix del bug heredado en `coachScopedReads.ts`**

En `getWeekSessionsForAthlete` (línea 37) y `hydrateWeekForAthlete` (línea 60), reemplazar `athleteId === athleteIdForOwner(ownerAccountId)` por el resolver:

```typescript
// arriba: import { resolveSelfAthleteIdForOwner } from './athleteWeekScope'
// en getWeekSessionsForAthlete:
  const isSelf = athleteId === await resolveSelfAthleteIdForOwner(ownerAccountId)
// en hydrateWeekForAthlete:
  { includeLegacy: athleteId === await resolveSelfAthleteIdForOwner(ownerAccountId) },
```

Eliminar el import de `athleteIdForOwner` si queda sin uso.

- [ ] **Step 6: Test de regresión del fix (agregar a `coachScopedReads.test.ts`)**

```typescript
it('self reclamado por membresía (ID ≠ ath_<owner>) adopta legacy', async () => {
  setSelfAthleteId('ath_claimed')
  await db.athletes.put({
    id: 'ath_claimed', ownerAccountId: 'user-1', linkedAccountId: 'user-1',
    status: 'active', createdAt: now, updatedAt: now,
  })
  await db.sessions.put(session({ id: 's-for-claimed', athleteId: 'ath_claimed', date: '2026-07-14' }))
  const rows = await getWeekSessionsForAthlete('user-1', 'ath_claimed', '2026-07-13')
  // adopta las legacy de la semana además de las propias
  expect(rows.map((r) => r.id)).toContain('s-legacy')
  expect(rows.map((r) => r.id)).toContain('s-for-claimed')
})
```

Importar `setSelfAthleteId` y resetearlo a `null` en `afterEach` del archivo.

- [ ] **Step 7: Verificar suite del área**

Run: `npx vitest run src/services/athlete/`
Expected: PASS completo (los tests existentes de `coachScopedReads` siguen verdes: sin holder ni membresía el fallback es `ath_<owner>`, mismo comportamiento).

- [ ] **Step 8: Checkpoint** — avisar al owner que Task 1 está lista para commit (`feat: athlete week scope resolver link-aware`).

---

### Task 2: D3 — `assertActiveRosterAthlete` + `getAthleteProfileForAthlete`

**Files:**
- Modify: `src/services/athlete/coachScopedReads.ts`
- Test (modify): `src/services/athlete/__tests__/coachScopedReads.test.ts`

**Interfaces:**
- Consumes: `assertRosterAthlete(ownerAccountId, athleteId): Promise<Athlete>` (existente), `ATHLETE_PROFILE_LOCAL_ID` (`activeAthlete.ts`), `resolveSelfAthleteIdForOwner` (Task 1), `db.athleteProfiles` (índices `id, updatedAt, athleteId`).
- Produces:
  ```typescript
  export async function assertActiveRosterAthlete(ownerAccountId: string, athleteId: string): Promise<Athlete>
  export async function getAthleteProfileForAthlete(ownerAccountId: string, athleteId: string): Promise<AthleteProfile | undefined>
  ```

- [ ] **Step 1: Tests que fallan (agregar describes a `coachScopedReads.test.ts`)**

```typescript
describe('assertActiveRosterAthlete', () => {
  // beforeEach igual al del archivo, más un atleta archivado:
  // { id: 'ath_archived', ownerAccountId: 'user-1', linkedAccountId: null,
  //   status: 'archived', createdAt: now, updatedAt: now }

  it('acepta atleta activo del roster', async () => {
    await expect(assertActiveRosterAthlete('user-1', 'ath_m_a')).resolves.toMatchObject({ id: 'ath_m_a' })
  })

  it('rechaza archivado con copy propio', async () => {
    await expect(assertActiveRosterAthlete('user-1', 'ath_archived'))
      .rejects.toThrow('Este atleta está archivado; restauralo para editar su semana.')
  })

  it('rechaza fuera del roster', async () => {
    await expect(assertActiveRosterAthlete('user-1', 'ath_ajeno'))
      .rejects.toThrow('El atleta no pertenece a tu roster.')
  })

  it('assertRosterAthlete (sin variante activa) sigue aceptando archivados', async () => {
    await expect(assertRosterAthlete('user-1', 'ath_archived')).resolves.toMatchObject({ id: 'ath_archived' })
  })
})

describe('getAthleteProfileForAthlete', () => {
  it('self resuelto: encuentra la fila default sin athleteId estampado', async () => {
    setSelfAthleteId('ath_user-1')
    await db.athleteProfiles.put({ id: ATHLETE_PROFILE_LOCAL_ID, updatedAt: now, primarySport: 'running' } as never)
    const profile = await getAthleteProfileForAthlete('user-1', 'ath_user-1')
    expect(profile?.primarySport).toBe('running')
  })

  it('gestionado: encuentra por índice athleteId y NUNCA la fila default', async () => {
    await db.athleteProfiles.put({ id: ATHLETE_PROFILE_LOCAL_ID, updatedAt: now, primarySport: 'running' } as never)
    await db.athleteProfiles.put({ id: 'p-managed', athleteId: 'ath_m_a', updatedAt: now, primarySport: 'squash' } as never)
    expect((await getAthleteProfileForAthlete('user-1', 'ath_m_a'))?.primarySport).toBe('squash')
    await db.athleteProfiles.delete('p-managed')
    expect(await getAthleteProfileForAthlete('user-1', 'ath_m_a')).toBeUndefined()
  })
})
```

Importar `ATHLETE_PROFILE_LOCAL_ID` también en el test; aunque el guard actual excluye `__tests__`, la restricción del proyecto aplica al código nuevo completo.

- [ ] **Step 2: Correr y verificar que fallan** — `npx vitest run src/services/athlete/__tests__/coachScopedReads.test.ts`

- [ ] **Step 3: Implementación en `coachScopedReads.ts`**

```typescript
import { ATHLETE_PROFILE_LOCAL_ID } from './activeAthlete'
import type { AthleteProfile } from '../../types'

/** Variante para escrituras y lecturas de Planificación: roster + status active (spec D3). */
export async function assertActiveRosterAthlete(
  ownerAccountId: string,
  athleteId: string,
): Promise<Athlete> {
  const athlete = await assertRosterAthlete(ownerAccountId, athleteId)
  if (athlete.status !== 'active') {
    throw new Error('Este atleta está archivado; restauralo para editar su semana.')
  }
  return athlete
}

/**
 * Perfil por atleta explícito. El self puede seguir usando la fila singleton local
 * sin athleteId estampado (incluida una membresía reclamada) — spec D4.
 */
export async function getAthleteProfileForAthlete(
  ownerAccountId: string,
  athleteId: string,
): Promise<AthleteProfile | undefined> {
  const selfId = await resolveSelfAthleteIdForOwner(ownerAccountId)
  if (athleteId === selfId) {
    const defaultRow = await db.athleteProfiles.get(ATHLETE_PROFILE_LOCAL_ID)
    if (defaultRow) return defaultRow
    return db.athleteProfiles.where('athleteId').equals(athleteId).first()
  }
  return (await db.athleteProfiles.where('athleteId').equals(athleteId).first())
    ?? db.athleteProfiles.get(athleteId)
}
```

Agregar un caso para el fallback gestionado por PK histórica: fila `{ id: 'ath_m_a', athleteId: undefined }` devuelve ese perfil, pero nunca adopta `ATHLETE_PROFILE_LOCAL_ID`. Al consumir el perfil en el modal, resolver el deporte en este orden: `profile.sportContext?.primarySport ?? profile.primarySport ?? 'squash'` (el modal actual usa `sportContext.primarySport`).

Además: cambiar `getWeekSessionsForAthlete` y `hydrateWeekForAthlete` para que llamen `assertActiveRosterAthlete` en lugar de `assertRosterAthlete` (Planificación solo lista activos; spec D3).

- [ ] **Step 4: Correr y verificar que pasan** — `npx vitest run src/services/athlete/`

- [ ] **Step 5: Checkpoint** — Task 2 lista para commit del owner.

---

### Task 3: D1 — Núcleo de queries con scope explícito + wrappers

**Files:**
- Modify: `src/db/queries.ts`
- Test: `src/db/__tests__/weekSummaryCore.test.ts` (create; si `src/db/__tests__/` no existe, crearlo — vitest lo levanta por glob)

**Interfaces:**
- Consumes: `AthleteWeekScope` (Task 1), `isScopedAthleteId` (`effectiveAthleteKey.ts`), `hasWeekSummaryMeaningfulChanges` (existente en queries.ts).
- Produces (exports nuevos de `queries.ts`):
  ```typescript
  export const getSessionsForWeekCore: (scope: AthleteWeekScope, weekStartISO: string) => Promise<Session[]>
  export const getDayLogsForWeekCore: (scope: AthleteWeekScope, weekStartISO: string) => Promise<DayLog[]>
  export const getWeekSummaryCore: (scope: AthleteWeekScope, weekStartISO: string) => Promise<WeekSummary | undefined>
  export const upsertWeekSummaryCore: (
    scope: AthleteWeekScope,
    weekStartISO: string,
    patch: Partial<Omit<WeekSummary, 'id' | 'weekStartDate' | 'updatedAt' | 'athleteId'>>,
  ) => Promise<{ summary: WeekSummary; changed: boolean }>
  export const recalculateWeekSummaryCore: (
    scope: AthleteWeekScope,
    dateISO: string,
  ) => Promise<{ summary: WeekSummary; changed: boolean }>
  ```
- Los wrappers públicos (`getSessionsForWeek`, `getDayLogsForWeek`, `getWeekSummary`, `upsertWeekSummary`, `recalculateWeekSummary`) **conservan firma y efectos**, pero no sus cuerpos: cada uno captura el scope activo una sola vez antes del primer `await`. El branch legacy con activo `null` se conserva mediante helpers privados que tampoco releen holders.

- [ ] **Step 1: Tests que fallan**

```typescript
// src/db/__tests__/weekSummaryCore.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db'
import * as syncService from '../../services/syncService'
import { setActiveAthleteId, setSelfAthleteId } from '../../services/athlete/activeAthlete'
import {
  getSessionsForWeekCore, getDayLogsForWeekCore, getWeekSummaryCore,
  upsertWeekSummaryCore, recalculateWeekSummaryCore, recalculateWeekSummary,
} from '../queries'
import type { Session } from '../../types'

const now = Date.now()
const WEEK = '2026-07-13'

function session(partial: Partial<Session>): Session {
  return {
    id: 'session', date: '2026-07-14', timeBlock: 'AM', type: 'squash',
    status: 'completed', title: 'Sesión', durationMin: 60,
    createdAt: now, updatedAt: now, ...partial,
  } as Session
}

describe('recálculo con scope explícito', () => {
  beforeEach(async () => {
    db.close(); await db.delete(); await db.open()
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_user-1')
    vi.spyOn(syncService, 'pushWeekSummary').mockResolvedValue()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    setActiveAthleteId(null); setSelfAthleteId(null)
    db.close()
  })

  it('el núcleo actualiza el resumen del gestionado y NO toca el del coach (activo distinto)', async () => {
    await db.sessions.put(session({ id: 's-m', athleteId: 'ath_m', durationMin: 45 }))
    await db.sessions.put(session({ id: 's-self', athleteId: 'ath_user-1', durationMin: 90 }))
    const { summary, changed } = await recalculateWeekSummaryCore(
      { athleteId: 'ath_m', includeLegacy: false }, '2026-07-14',
    )
    expect(changed).toBe(true)
    expect(summary.athleteId).toBe('ath_m')
    expect(summary.completedMinutes).toBe(45)
    const selfSummary = await db.weekSummaries
      .where('[athleteId+weekStartDate]').equals(['ath_user-1', WEEK]).first()
    expect(selfSummary).toBeUndefined() // no se recalculó de más
  })

  it('el núcleo NO emite pushes', async () => {
    await db.sessions.put(session({ id: 's-m', athleteId: 'ath_m' }))
    await recalculateWeekSummaryCore({ athleteId: 'ath_m', includeLegacy: false }, '2026-07-14')
    expect(syncService.pushWeekSummary).not.toHaveBeenCalled()
  })

  it('legacy solo se adopta con includeLegacy (scope self)', async () => {
    await db.sessions.put(session({ id: 's-legacy', athleteId: undefined, durationMin: 30 }))
    const selfRows = await getSessionsForWeekCore({ athleteId: 'ath_user-1', includeLegacy: true }, WEEK)
    expect(selfRows.map((r) => r.id)).toContain('s-legacy')
    const managedRows = await getSessionsForWeekCore({ athleteId: 'ath_m', includeLegacy: false }, WEEK)
    expect(managedRows).toHaveLength(0)
  })

  it('upsertWeekSummaryCore devuelve changed=false sin cambios significativos', async () => {
    const first = await upsertWeekSummaryCore({ athleteId: 'ath_m', includeLegacy: false }, WEEK, { totalSessions: 1 })
    expect(first.changed).toBe(true)
    const second = await upsertWeekSummaryCore({ athleteId: 'ath_m', includeLegacy: false }, WEEK, { totalSessions: 1 })
    expect(second.changed).toBe(false)
  })

  it('un segundo cambio en el mismo milisegundo renueva updatedAt de forma monotónica', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    const first = await upsertWeekSummaryCore(
      { athleteId: 'ath_m', includeLegacy: false }, WEEK, { totalSessions: 1 },
    )
    const second = await upsertWeekSummaryCore(
      { athleteId: 'ath_m', includeLegacy: false }, WEEK, { totalSessions: 2 },
    )
    expect(second.summary.updatedAt).toBeGreaterThan(first.summary.updatedAt!)
  })

  it('wrapper recalculateWeekSummary conserva comportamiento y push (regresión)', async () => {
    await db.sessions.put(session({ id: 's-self', athleteId: 'ath_user-1' }))
    await recalculateWeekSummary('2026-07-14')
    const row = await db.weekSummaries
      .where('[athleteId+weekStartDate]').equals(['ath_user-1', WEEK]).first()
    expect(row?.completedSessions).toBe(1)
    expect(syncService.pushWeekSummary).toHaveBeenCalled()
  })

  it('wrappers con activo null conservan el comportamiento legacy actual', async () => {
    setActiveAthleteId(null)
    // Cubrir getSessions/getDayLogs/getWeekSummary/upsert/recalculate contra
    // las expectativas ya existentes de queriesActiveScope.test.ts.
    // Importante: una activación tardía durante un await no cambia este scope capturado.
  })
})
```

- [ ] **Step 2: Verificar que fallan** — `npx vitest run src/db/__tests__/weekSummaryCore.test.ts` → FAIL (exports no existen).

- [ ] **Step 3: Implementación en `queries.ts`**

Patrón: cada core toma `scope` como dato; el wrapper captura el activo **una vez** y delega (o usa su helper legacy privado con activo `null`). No dejar llamadas a `filterRowsToActiveScope`/`isSelfScopeActive` después de un `await` dentro de estos cinco wrappers: hoy esas funciones releen holders globales y reintroducen la carrera que D1 elimina.

```typescript
import type { AthleteWeekScope } from '../services/athlete/athleteWeekScope'

export const getSessionsForWeekCore = async (
  scope: AthleteWeekScope,
  weekStartISO: string,
): Promise<Session[]> => {
  const end = toISO(addDays(fromISO(weekStartISO), 6))
  const rows = await db.sessions.where('date').between(weekStartISO, end, true, true).toArray()
  return rows.filter((row) =>
    row.athleteId === scope.athleteId || (scope.includeLegacy && !isScopedAthleteId(row.athleteId)))
}

export const getDayLogsForWeekCore = async (
  scope: AthleteWeekScope,
  weekStartISO: string,
): Promise<DayLog[]> => {
  const end = toISO(addDays(fromISO(weekStartISO), 6))
  const scoped = await db.dayLogs
    .where('[athleteId+date]')
    .between([scope.athleteId, weekStartISO], [scope.athleteId, end], true, true)
    .toArray()
  if (!scope.includeLegacy) return scoped.sort((a, b) => a.date.localeCompare(b.date))
  const byDate = new Map<string, DayLog>(scoped.map((row) => [row.date, row]))
  const inRange = await db.dayLogs.where('date').between(weekStartISO, end, true, true).toArray()
  for (const row of inRange) {
    if (byDate.has(row.date)) continue
    if (isScopedAthleteId(row.athleteId)) continue
    byDate.set(row.date, row)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export const getWeekSummaryCore = async (
  scope: AthleteWeekScope,
  weekStartISO: string,
): Promise<WeekSummary | undefined> => {
  const scoped = await db.weekSummaries
    .where('[athleteId+weekStartDate]')
    .equals([scope.athleteId, weekStartISO])
    .first()
  if (scoped) return scoped
  if (!scope.includeLegacy) return undefined
  const candidates = await db.weekSummaries.where('weekStartDate').equals(weekStartISO).toArray()
  return candidates.find((row) => !isScopedAthleteId(row.athleteId))
}

/** Núcleo puro-local: escribe Dexie, jamás llama a syncService (spec D1). */
export const upsertWeekSummaryCore = async (
  scope: AthleteWeekScope,
  weekStartISO: string,
  patch: Partial<Omit<WeekSummary, 'id' | 'weekStartDate' | 'updatedAt' | 'athleteId'>>,
): Promise<{ summary: WeekSummary; changed: boolean }> => {
  const existing = await getWeekSummaryCore(scope, weekStartISO)
  const safePatch = stripAthleteId(patch)
  if (existing) {
    const needsAthleteStamp = !isScopedAthleteId(existing.athleteId)
    if (!needsAthleteStamp && !hasWeekSummaryMeaningfulChanges(existing, safePatch)) {
      return { summary: existing, changed: false }
    }
    const updatedAt = Math.max(Date.now(), (existing.updatedAt ?? 0) + 1)
    const updated: WeekSummary = { ...existing, ...safePatch, updatedAt, athleteId: scope.athleteId }
    await db.weekSummaries.put(updated)
    return { summary: updated, changed: true }
  }
  const updatedAt = Date.now()
  const created: WeekSummary = {
    id: uuid(), weekStartDate: weekStartISO, updatedAt,
    totalSessions: 0, totalMinutes: 0, plannedSessions: 0, completedSessions: 0,
    plannedMinutes: 0, completedMinutes: 0, squashSessions: 0, runningSessions: 0,
    strengthSessions: 0, ...safePatch, athleteId: scope.athleteId,
  }
  await db.weekSummaries.put(created)
  return { summary: created, changed: true }
}
```

`recalculateWeekSummaryCore(scope, dateISO)`: mover el cuerpo actual de `recalculateWeekSummary` (queries.ts:221-295) reemplazando `getSessionsForWeek(weekStart)` → `getSessionsForWeekCore(scope, weekStart)`, `getDayLogsForWeek` → `getDayLogsForWeekCore`, y el `upsertWeekSummary(...)` final → `return upsertWeekSummaryCore(scope, weekStart, { ...mismo objeto de métricas... })`. El algoritmo de métricas (líneas 225-293) se copia SIN cambios.

Captura activa única:

```typescript
import { getSelfAthleteId } from '../services/athlete/activeAthlete'

function captureActiveWeekScope(): AthleteWeekScope | null {
  const athleteId = getActiveAthleteId()
  if (!athleteId) return null
  const selfId = getSelfAthleteId()
  return { athleteId, includeLegacy: athleteId === selfId }
}
```

Wrappers (reemplazan los cuerpos actuales, misma firma y efectos):

```typescript
export const recalculateWeekSummary = async (dateISO: string): Promise<void> => {
  const scope = captureActiveWeekScope()
  if (!scope) {
    await recalculateWeekSummaryLegacy(dateISO)
    return
  }
  const { summary, changed } = await recalculateWeekSummaryCore(scope, dateISO)
  if (changed) void syncService.pushWeekSummary(summary)
}
```

Implementar el mismo patrón en los otros cuatro wrappers:

- `getSessionsForWeek`: scope no-null → core; null → `getSessionsForWeekLegacy`, que conserva exactamente la lectura actual pre-hidratación.
- `getDayLogsForWeek`: scope no-null → core; null → lectura por rango actual.
- `getWeekSummary`: scope no-null → core; null → `pickLegacyOrOnlyRow` actual.
- `upsertWeekSummary`: scope no-null → core + push solo si `changed`; null → helper local legacy con el mismo stamping/push actual.
- `recalculateWeekSummaryLegacy` usa **solo** los helpers legacy capturados, no vuelve a llamar los wrappers públicos: si el holder cambia a mitad del cálculo, toda la operación debe seguir en el scope null que capturó al comenzar.

Agregar una regresión de carrera usando una promesa controlada/spy en la lectura Dexie: cambiar `setActiveAthleteId` mientras el wrapper está esperando y comprobar que lee y escribe el scope capturado, nunca “sesiones de A/resumen de B”. Mantener verdes `queriesActiveScope.test.ts` y `queriesAthleteScope.test.ts` sin cambiar sus expectativas de modo null.

- [ ] **Step 4: Verificar que pasan** — `npx vitest run src/db/__tests__/weekSummaryCore.test.ts` → PASS.

- [ ] **Step 5: Red de seguridad** — `npx vitest run src/store src/services/planning src/db` (los consumidores `useTrainingStore`/`applyCreateWeek` no cambian). Expected: PASS.

- [ ] **Step 6: Checkpoint** — Task 3 lista para commit del owner.

---

### Task 4: D4/D5 — Serializer por modo + `hasRecordedWork`

**Files:**
- Create: `src/services/athlete/coachSessionSerializer.ts`
- Create: `src/utils/sessionRecordedWork.ts`
- Modify: `src/components/session/AddSessionModal.tsx` (importa los helpers movidos; sin cambio de comportamiento)
- Test: `src/services/athlete/__tests__/coachSessionSerializer.test.ts`
- Test: `src/utils/__tests__/sessionRecordedWork.test.ts` (si `src/utils/__tests__` no existe, crear; hay tests de utils — seguir la convención que encuentres en `src/utils/`)

**Interfaces:**
- Consumes: `generateDefaultProtocols` (`src/services/trainingProtocols`), tipos de `src/types`.
- Produces:
  ```typescript
  export interface CoachSessionDraft {
    date: string
    timeBlock: TimeBlock
    type: SessionType
    title: string
    durationMin: number
    objective?: string
    location?: string
    rpe?: number
    notes?: string
    subtype?: SquashSubtype
    opponent?: string
    matchResult?: MatchResult
    gamesWon?: number
    gamesLost?: number
    runningTargets?: {
      runningType: RunningType
      targetPaceMin?: string
      targetPaceMax?: string
      targetHrMin?: number
      targetHrMax?: number
    }
    exercises?: Array<{ id: string; name: string; sets: number; reps: string; weight?: number; notes?: string }>
  }
  export type CoachSessionPatch = Partial<CoachSessionDraft>
  // create: campos de Session listos para estampar (sin id/athleteId/authoredByRole/createdAt/updatedAt)
  export function draftToNewSessionFields(draft: CoachSessionDraft): Omit<Session, 'id' | 'athleteId' | 'authoredByRole' | 'createdAt' | 'updatedAt'>
  // edit: merge sobre la fila existente; NUNCA toca id/athleteId/createdAt/authoredByRole/source/weekStartDate/completación
  export function applyCoachSessionPatch(existing: Session, patch: CoachSessionPatch): Session
  // movidos desde AddSessionModal (mismo cuerpo, ahora exportados):
  export function buildCyclingDetailsDraft(runningType: RunningType, objective: string): CyclingDetails
  export function buildMobilityDetailsDraft(objective: string): MobilityDetails
  export function buildSquashDetailsDraft(subtype: SquashSubtype, objective: string): SquashDetails
  // src/utils/sessionRecordedWork.ts
  export function hasRecordedWork(session: Session): boolean
  ```

**Semántica verificada del patch:** una clave ausente significa “no editar”; una clave presente con `undefined` significa “limpiar el valor opcional”. Implementar los escalares con `Object.prototype.hasOwnProperty.call(patch, key)`, no con `patch.key !== undefined`. Esto es necesario para que el form pueda borrar objetivo, lugar, RPE, notas y datos de partido/targets existentes.

- [ ] **Step 1: Tests que fallan — `hasRecordedWork`**

```typescript
// src/utils/__tests__/sessionRecordedWork.test.ts
import { describe, expect, it } from 'vitest'
import { hasRecordedWork } from '../sessionRecordedWork'
import type { Session } from '../../types'

const base = {
  id: 's', date: '2026-07-14', timeBlock: 'AM', type: 'squash', status: 'planned',
  title: 'S', durationMin: 60, createdAt: 1, updatedAt: 1,
} as Session

describe('hasRecordedWork', () => {
  it('planned limpia → false', () => expect(hasRecordedWork(base)).toBe(false))
  it('status completed/adjusted → true', () => {
    expect(hasRecordedWork({ ...base, status: 'completed' })).toBe(true)
    expect(hasRecordedWork({ ...base, status: 'adjusted' })).toBe(true)
  })
  it('valores cero cuentan (!= null, no truthiness)', () => {
    expect(hasRecordedWork({ ...base, actualDurationMin: 0 })).toBe(true)
  })
  it('cada señal individual dispara', () => {
    expect(hasRecordedWork({ ...base, completedAt: 1 })).toBe(true)
    expect(hasRecordedWork({ ...base, actualRpe: 5 })).toBe(true)
    expect(hasRecordedWork({ ...base, sessionFeedback: { rating: 3, energyDuringSession: 3, capturedAt: 1 } })).toBe(true)
    expect(hasRecordedWork({ ...base, completionNotes: 'hecho' })).toBe(true)
    expect(hasRecordedWork({ ...base, completionNotes: '  ' })).toBe(false)
  })
  it('autoCompletion sobrevive a planned → true', () => {
    expect(hasRecordedWork({ ...base, autoCompletion: { source: 'whoop_workout', workoutId: 'w', completedAt: 'x' } })).toBe(true)
  })
  it('algún exercise.completed → true', () => {
    expect(hasRecordedWork({ ...base, exercises: [{ id: 'e', name: 'x', sets: 3, reps: '10', completed: true }] })).toBe(true)
    expect(hasRecordedWork({ ...base, exercises: [{ id: 'e', name: 'x', sets: 3, reps: '10', completed: false }] })).toBe(false)
  })
})
```

Implementación:

```typescript
// src/utils/sessionRecordedWork.ts
import type { Session } from '../types'

/** Señales de trabajo registrado (spec D5). Comparaciones != null: los ceros cuentan. */
export function hasRecordedWork(session: Session): boolean {
  if (session.status === 'completed' || session.status === 'adjusted') return true
  if (session.completedAt != null) return true
  if (session.actualDurationMin != null) return true
  if (session.actualRpe != null) return true
  if (session.sessionFeedback != null) return true
  if (session.completionNotes != null && session.completionNotes.trim() !== '') return true
  if (session.autoCompletion != null) return true
  return session.exercises?.some((exercise) => exercise.completed === true) ?? false
}
```

- [ ] **Step 2: Tests que fallan — serializer** (los críticos; escribir TODOS):

```typescript
// src/services/athlete/__tests__/coachSessionSerializer.test.ts
import { describe, expect, it } from 'vitest'
import { applyCoachSessionPatch, draftToNewSessionFields } from '../coachSessionSerializer'
import type { CoachSessionDraft } from '../coachSessionSerializer'
import type { Session } from '../../../types'

const draft: CoachSessionDraft = {
  date: '2026-07-14', timeBlock: 'AM', type: 'squash', title: 'Drills', durationMin: 60,
  subtype: 'training', objective: 'volea',
}

const planBuilderSession = {
  id: 'pb-1', athleteId: 'ath_m', date: '2026-07-14', timeBlock: 'AM', type: 'squash',
  status: 'planned', title: 'PB Squash', durationMin: 75, source: 'coach',
  authoredByRole: 'coach', createdAt: 1, updatedAt: 1, subtype: 'training',
  weekStartDate: '2026-07-13',
  squashDetails: {
    trainingFocus: 'technical', sessionMode: 'drill_session',
    drills: [{ name: 'boast-drive' }], blocks: [{ label: 'bloque 1' }],
  },
  warmup: { title: 'W', durationMin: 10, note: '', tone: 'general', steps: [], source: 'base' },
  cooldown: { title: 'C', durationMin: 5, note: '', tone: 'general', steps: [], source: 'base' },
  exercises: [
    { id: 'e1', name: 'Sentadilla', sets: 5, reps: '5', completed: true, warmupSets: [{ reps: 5 }], group: 'A' },
  ],
} as unknown as Session

describe('draftToNewSessionFields (create)', () => {
  it('genera defaults: protocolos, details y status planned', () => {
    const fields = draftToNewSessionFields(draft)
    expect(fields.status).toBe('planned')
    expect(fields.warmup).toBeDefined()
    expect(fields.cooldown).toBeDefined()
    expect(fields.squashDetails?.sessionMode).toBe('drill_session')
  })
  it('ejercicios nuevos nacen completed:false', () => {
    const fields = draftToNewSessionFields({
      ...draft, type: 'strength', subtype: undefined,
      exercises: [{ id: 'e1', name: 'Press', sets: 3, reps: '8' }],
    })
    expect(fields.exercises?.[0].completed).toBe(false)
  })
  it('exercises vacío cae a undefined en create, como el modal actual (R28)', () => {
    const fields = draftToNewSessionFields({ ...draft, type: 'strength', subtype: undefined, exercises: [] })
    expect(fields.exercises).toBeUndefined()
  })
})

describe('applyCoachSessionPatch (edit sin cambio de type)', () => {
  it('preserva drills, blocks, protocolos, completación y weekStartDate', () => {
    const result = applyCoachSessionPatch(planBuilderSession, { title: 'PB editada', durationMin: 60 })
    expect(result.title).toBe('PB editada')
    expect(result.squashDetails?.drills).toHaveLength(1)
    expect(result.squashDetails?.blocks).toHaveLength(1)
    expect(result.warmup?.title).toBe('W')
    expect(result.weekStartDate).toBe('2026-07-13')
    expect(result.authoredByRole).toBe('coach')
    expect(result.source).toBe('coach')
  })
  it('merge de ejercicios por id: existente conserva completed/warmupSets/group', () => {
    const result = applyCoachSessionPatch(planBuilderSession, {
      exercises: [
        { id: 'e1', name: 'Sentadilla pausada', sets: 4, reps: '6' }, // editado
        { id: 'e2', name: 'Peso muerto', sets: 3, reps: '5' },        // nuevo
      ],
    })
    const e1 = result.exercises?.find((e) => e.id === 'e1')
    expect(e1?.name).toBe('Sentadilla pausada')
    expect(e1?.sets).toBe(4)
    expect(e1?.completed).toBe(true)          // preservado
    expect(e1?.warmupSets).toHaveLength(1)    // preservado
    expect(e1?.group).toBe('A')               // preservado
    const e2 = result.exercises?.find((e) => e.id === 'e2')
    expect(e2?.completed).toBe(false)
  })
  it('ejercicio ausente del patch se elimina', () => {
    const result = applyCoachSessionPatch(planBuilderSession, { exercises: [] })
    expect(result.exercises).toHaveLength(0)
  })
  it('cambio de subtype re-deriva sessionMode preservando drills/blocks', () => {
    const result = applyCoachSessionPatch(planBuilderSession, { subtype: 'competitive' })
    expect(result.squashDetails?.sessionMode).toBe('competition_match')
    expect(result.squashDetails?.drills).toHaveLength(1)
    expect(result.squashDetails?.blocks).toHaveLength(1)
  })
  it('runningTargets mergea shallow dentro de runningDetails preservando otros subcampos', () => {
    const withRunning = {
      ...planBuilderSession, type: 'running', squashDetails: undefined, subtype: undefined,
      runningDetails: { runningType: 'z2', targetPaceMin: '5:30', extraCue: 'cadencia' },
    } as unknown as Session
    const result = applyCoachSessionPatch(withRunning, {
      runningTargets: { runningType: 'tempo', targetPaceMin: '4:50' },
    })
    expect(result.runningDetails?.runningType).toBe('tempo')
    expect(result.runningDetails?.targetPaceMin).toBe('4:50')
    expect((result.runningDetails as Record<string, unknown>).extraCue).toBe('cadencia')
  })
  it('el patch NUNCA toca campos de completación ni identidad', () => {
    const completed = { ...planBuilderSession, status: 'completed', actualRpe: 7, completedAt: 99 } as Session
    const result = applyCoachSessionPatch(completed, { title: 'X' })
    expect(result.status).toBe('completed')
    expect(result.actualRpe).toBe(7)
    expect(result.completedAt).toBe(99)
    expect(result.id).toBe('pb-1')
    expect(result.athleteId).toBe('ath_m')
    expect(result.createdAt).toBe(1)
  })
  it('una clave opcional presente con undefined limpia el valor', () => {
    const withOptionals = {
      ...planBuilderSession, objective: 'Anterior', location: 'Club', rpe: 7,
      opponent: 'Rival', matchResult: 'win', gamesWon: 3, gamesLost: 1,
    } as Session
    const result = applyCoachSessionPatch(withOptionals, {
      objective: undefined, location: undefined, rpe: undefined,
      opponent: undefined, matchResult: undefined, gamesWon: undefined, gamesLost: undefined,
    })
    expect(result).toMatchObject({ objective: undefined, location: undefined, rpe: undefined })
    expect(result.opponent).toBeUndefined()
  })
})

describe('applyCoachSessionPatch (cambio de type)', () => {
  it('squash → strength limpia campos squash y genera defaults del tipo nuevo', () => {
    const result = applyCoachSessionPatch(planBuilderSession, { type: 'strength', title: 'Fuerza' })
    expect(result.type).toBe('strength')
    expect(result.subtype).toBeUndefined()
    expect(result.opponent).toBeUndefined()
    expect(result.matchResult).toBeUndefined()
    expect(result.gamesWon).toBeUndefined()
    expect(result.gamesLost).toBeUndefined()
    expect(result.squashDetails).toBeUndefined()
    expect(result.warmup).toBeDefined() // regenerado para el tipo nuevo
  })
  it('cycling → squash limpia runningDetails/cyclingDetails', () => {
    const cycling = {
      ...planBuilderSession, type: 'cycling', squashDetails: undefined, subtype: undefined,
      runningDetails: { runningType: 'z2' }, cyclingDetails: { sessionCategory: 'x', targetStructure: 'y' },
    } as unknown as Session
    const result = applyCoachSessionPatch(cycling, { type: 'squash', subtype: 'training' })
    expect(result.runningDetails).toBeUndefined()
    expect(result.cyclingDetails).toBeUndefined()
    expect(result.squashDetails).toBeDefined()
  })
  it('squash → running/cycling crea runningDetails desde runningTargets', () => {
    const result = applyCoachSessionPatch(planBuilderSession, {
      type: 'running', runningTargets: { runningType: 'tempo', targetPaceMin: '4:50' },
    })
    expect(result.runningDetails).toMatchObject({ runningType: 'tempo', targetPaceMin: '4:50' })
  })
  it('strength → mobility conserva TODA la metadata de ejercicios con id existente (R29)', () => {
    const strength = {
      ...planBuilderSession, type: 'strength', squashDetails: undefined, subtype: undefined,
    } as unknown as Session // exercises de planBuilderSession: e1 con completed/warmupSets/group
    const result = applyCoachSessionPatch(strength, {
      type: 'mobility',
      exercises: [{ id: 'e1', name: 'Sentadilla', sets: 5, reps: '5' }], // mismo id, sin tocar
    })
    const e1 = result.exercises?.find((e) => e.id === 'e1')
    expect(e1?.completed).toBe(true)
    expect(e1?.warmupSets).toHaveLength(1)
    expect(e1?.group).toBe('A')
  })
  it('reps y notes se normalizan en el serializer, no en el form (R33)', () => {
    const fields = draftToNewSessionFields({
      ...draft, type: 'strength', subtype: undefined,
      exercises: [{ id: 'e1', name: ' Press ', sets: 3, reps: '  ', notes: '  ' }],
    })
    expect(fields.exercises?.[0]).toMatchObject({ name: 'Press', reps: '10', notes: undefined })
  })
  it('cambiar zona de cycling preserva executionNotes enriquecidas', () => {
    // Solo cambian sessionCategory/targetStructure/intensityReference.
  })
})
```

- [ ] **Step 3: Verificar que fallan** — `npx vitest run src/services/athlete/__tests__/coachSessionSerializer.test.ts src/utils/__tests__/sessionRecordedWork.test.ts`

- [ ] **Step 4: Implementación del serializer**

Mover `buildCyclingDetailsDraft`, `buildMobilityDetailsDraft`, `resolveSquashTrainingFocus`, `buildSquashDetailsDraft` desde `AddSessionModal.tsx` (líneas 77-151) a `coachSessionSerializer.ts` **sin cambiar sus cuerpos**, exportarlos, y en `AddSessionModal.tsx` importarlos desde el módulo nuevo (borrar las copias locales).

Núcleo del serializer:

```typescript
// src/services/athlete/coachSessionSerializer.ts
import { generateDefaultProtocols } from '../trainingProtocols'
import type {
  CyclingDetails, Exercise, MatchResult, MobilityDetails, RunningDetails, RunningType,
  Session, SessionType, SquashDetails, SquashSubtype, TimeBlock,
} from '../../types'
import { toISO, getWeekStart, fromISO } from '../../utils/date'

// ... (interfaces CoachSessionDraft / CoachSessionPatch como en Interfaces) ...
// ... (build*Draft movidos) ...

const SQUASH_ONLY_FIELDS = ['subtype', 'opponent', 'matchResult', 'gamesWon', 'gamesLost', 'squashDetails'] as const
const RUNNING_CYCLING_FIELDS = ['runningDetails', 'cyclingDetails'] as const
const EXERCISE_TYPES: SessionType[] = ['strength', 'mobility']

function buildTypeDefaults(draft: Pick<CoachSessionDraft, 'type' | 'subtype' | 'rpe' | 'objective' | 'runningTargets'>) {
  const protocols = generateDefaultProtocols({
    type: draft.type,
    subtype: draft.type === 'squash' ? draft.subtype : undefined,
    rpe: draft.rpe,
    runningType: draft.type === 'running' || draft.type === 'cycling' ? draft.runningTargets?.runningType ?? 'z2' : undefined,
  })
  return {
    warmup: protocols.warmup,
    cooldown: protocols.cooldown,
    runningDetails: draft.type === 'running' || draft.type === 'cycling'
      ? {
          runningType: draft.runningTargets?.runningType ?? 'z2',
          targetPaceMin: draft.runningTargets?.targetPaceMin,
          targetPaceMax: draft.runningTargets?.targetPaceMax,
          targetHrMin: draft.runningTargets?.targetHrMin,
          targetHrMax: draft.runningTargets?.targetHrMax,
        }
      : undefined,
    squashDetails: draft.type === 'squash'
      ? buildSquashDetailsDraft(draft.subtype ?? 'training', draft.objective ?? '') : undefined,
    cyclingDetails: draft.type === 'cycling'
      ? buildCyclingDetailsDraft(draft.runningTargets?.runningType ?? 'z2', draft.objective ?? '') : undefined,
    mobilityDetails: draft.type === 'mobility' ? buildMobilityDetailsDraft(draft.objective ?? '') : undefined,
  }
}

function draftExercisesToExercises(
  drafts: NonNullable<CoachSessionDraft['exercises']>,
  existing: Exercise[] | undefined,
): Exercise[] {
  const byId = new Map((existing ?? []).map((exercise) => [exercise.id, exercise]))
  return drafts
    .filter((draft) => draft.name.trim())
    .map((draft) => {
      // Defaults/trim centralizados acá (R33): mismo contrato que buildExercises actual,
      // sin depender de que cada caller (SessionForm u otro) los aplique.
      const reps = draft.reps.trim() || '10'
      const notes = draft.notes?.trim() || undefined
      const prior = byId.get(draft.id)
      if (prior) {
        // merge por id: solo campos editables; completed/warmupSets/group/targets intactos
        return { ...prior, name: draft.name.trim(), sets: draft.sets, reps, weight: draft.weight, notes }
      }
      return { id: draft.id, name: draft.name.trim(), sets: draft.sets, reps, weight: draft.weight, notes, completed: false }
    })
}

export function draftToNewSessionFields(
  draft: CoachSessionDraft,
): Omit<Session, 'id' | 'athleteId' | 'authoredByRole' | 'createdAt' | 'updatedAt'> {
  const defaults = buildTypeDefaults(draft)
  return {
    date: draft.date,
    weekStartDate: toISO(getWeekStart(fromISO(draft.date))),
    timeBlock: draft.timeBlock,
    type: draft.type,
    status: 'planned',
    source: 'coach',
    title: draft.title.trim(),
    objective: draft.objective?.trim() || undefined,
    durationMin: draft.durationMin,
    location: draft.location?.trim() || undefined,
    rpe: draft.rpe,
    notes: draft.notes?.trim() || undefined,
    subtype: draft.type === 'squash' ? draft.subtype : undefined,
    opponent: draft.opponent?.trim() || undefined,
    matchResult: draft.matchResult,
    gamesWon: draft.gamesWon,
    gamesLost: draft.gamesLost,
    ...defaults,
    // ?.length: una lista vacía cae a undefined, como el modal actual (R28)
    exercises: draft.exercises?.length && EXERCISE_TYPES.includes(draft.type)
      ? draftExercisesToExercises(draft.exercises, undefined)
      : undefined,
  } as Omit<Session, 'id' | 'athleteId' | 'authoredByRole' | 'createdAt' | 'updatedAt'>
}

export function applyCoachSessionPatch(existing: Session, patch: CoachSessionPatch): Session {
  const has = (key: keyof CoachSessionPatch) => Object.prototype.hasOwnProperty.call(patch, key)
  const typeChanged = patch.type !== undefined && patch.type !== existing.type
  if (typeChanged) {
    // limpiar explícitamente lo incompatible y regenerar defaults del tipo nuevo (spec D4)
    const merged: Record<string, unknown> = { ...existing }
    for (const field of [...SQUASH_ONLY_FIELDS, ...RUNNING_CYCLING_FIELDS, 'mobilityDetails', 'exercises']) {
      delete merged[field]
    }
    const draftLike = {
      type: patch.type!,
      subtype: patch.subtype,
      rpe: has('rpe') ? patch.rpe : existing.rpe,
      objective: has('objective') ? patch.objective : existing.objective,
      runningTargets: patch.runningTargets,
    }
    const defaults = buildTypeDefaults(draftLike)
    return {
      ...(merged as unknown as Session),
      ...scalarPatch(patch),
      type: patch.type!,
      subtype: patch.type === 'squash' ? patch.subtype : undefined,
      ...defaults,
      // R29: merge contra existing.exercises — en strength↔mobility los ids
      // sobreviven al cambio de tipo y conservan completed/warmupSets/group/targets
      // (spec D4, merge por id sin restricción de modo). Para tipos sin ejercicios
      // previos, existing.exercises es undefined y el merge es un no-op.
      exercises: patch.exercises?.length && EXERCISE_TYPES.includes(patch.type!)
        ? draftExercisesToExercises(patch.exercises, existing.exercises)
        : undefined,
    } as Session
  }

  const next: Session = { ...existing, ...scalarPatch(patch) }
  // derivados puntuales dentro del mismo type (spec D4)
  if (existing.type === 'squash' && patch.subtype !== undefined && patch.subtype !== existing.subtype) {
    next.subtype = patch.subtype
    if (next.squashDetails) {
      next.squashDetails = {
        ...next.squashDetails,
        sessionMode: patch.subtype === 'competitive' ? 'competition_match'
          : patch.subtype === 'match' ? 'practice_match' : 'drill_session',
      }
    }
  }
  if (existing.type === 'squash' && has('objective') && patch.objective !== existing.objective
      && next.squashDetails) {
    next.squashDetails = {
      ...next.squashDetails,
      trainingFocus: resolveSquashTrainingFocus(
        next.subtype ?? 'training', patch.objective ?? '',
      ),
      // drills, blocks y sessionMode enriquecidos se preservan.
    }
  }
  if ((existing.type === 'running' || existing.type === 'cycling') && patch.runningTargets) {
    next.runningDetails = { ...existing.runningDetails, ...patch.runningTargets }
    if (existing.type === 'cycling' && patch.runningTargets.runningType !== undefined
        && patch.runningTargets.runningType !== existing.runningDetails?.runningType) {
      const regenerated = buildCyclingDetailsDraft(patch.runningTargets.runningType, patch.objective ?? existing.objective ?? '')
      next.cyclingDetails = {
        ...existing.cyclingDetails,
        sessionCategory: regenerated.sessionCategory,
        targetStructure: regenerated.targetStructure,
        intensityReference: regenerated.intensityReference,
        // executionNotes enriquecidas se preservan en edit same-type.
      }
    }
  }
  if (patch.exercises !== undefined) {
    next.exercises = draftExercisesToExercises(patch.exercises, existing.exercises)
  }
  return next
}

/** Solo escalares visibles; jamás identidad, autoría, source, weekStartDate ni completación. */
function scalarPatch(patch: CoachSessionPatch): Partial<Session> {
  const out: Partial<Session> = {}
  const has = (key: keyof CoachSessionPatch) => Object.prototype.hasOwnProperty.call(patch, key)
  if (has('date') && patch.date !== undefined) out.date = patch.date
  if (has('timeBlock') && patch.timeBlock !== undefined) out.timeBlock = patch.timeBlock
  if (has('title') && patch.title !== undefined) out.title = patch.title.trim()
  if (has('durationMin') && patch.durationMin !== undefined) out.durationMin = patch.durationMin
  if (has('objective')) out.objective = patch.objective?.trim() || undefined
  if (has('location')) out.location = patch.location?.trim() || undefined
  if (has('rpe')) out.rpe = patch.rpe
  if (has('notes')) out.notes = patch.notes?.trim() || undefined
  if (has('opponent')) out.opponent = patch.opponent?.trim() || undefined
  if (has('matchResult')) out.matchResult = patch.matchResult
  if (has('gamesWon')) out.gamesWon = patch.gamesWon
  if (has('gamesLost')) out.gamesLost = patch.gamesLost
  return out
}
```

La misma regla de presencia aplica a `runningTargets` y `exercises`: `runningTargets` ausente preserva; presente mergea y permite limpiar sus claves internas; `exercises` ausente preserva y `[]` elimina todos. Al cambiar de subtipo match/competitive a otro, `draftToPatch` debe emitir las claves de partido presentes con `undefined`, para que se limpien.

Tabla mínima de derivados same-type a probar y documentar junto al serializer:

| Campo visible que cambia | Derivados que cambian | Datos enriquecidos que se preservan |
|---|---|---|
| `subtype` squash | `squashDetails.sessionMode` | `drills`, `blocks`, `trainingFocus` salvo que también cambie `objective` |
| `objective` squash | `squashDetails.trainingFocus` | `drills`, `blocks`, `sessionMode` |
| `runningTargets.runningType` cycling | `sessionCategory`, `targetStructure`, `intensityReference` | `executionNotes` y cualquier clave extra |

`buildTypeDefaults` es la única fuente para cambio de `type` y create; debe incluir `runningDetails`, además de protocolos y details, para que squash→running/cycling no deje una sesión deportiva incompleta.

**Precondición de la rama de cambio de `type` (R21):** esa rama reconstruye la sesión desde el patch (`patch.subtype`, `patch.runningTargets`, `patch.exercises` — estos últimos mergeados contra `existing.exercises`, R29), así que el caller debe garantizar que un patch con cambio de tipo trae TODAS las claves visibles del draft, aunque su valor no haya cambiado respecto del original. `draftToPatch` (Task 12) implementa esa garantía: con `draft.type !== original.type` emite el draft completo. Sin esto, cycling→running con los mismos paces los perdería y strength↔mobility con los mismos ejercicios los eliminaría.

Agregar una regresión same-type donde cambia —y luego se limpia— `objective`: `trainingFocus` se actualiza en ambos casos y `drills`/`blocks`/`sessionMode` quedan idénticos.

Nota: `applyCoachSessionPatch` NO setea `updatedAt` ni `weekStartDate` — eso lo administra `coachScopedWrites` (Task 9, spec D2).

- [ ] **Step 5: Verificar que pasan** — mismos comandos del Step 3. Además `npx vitest run src/components` para confirmar que mover los helpers no rompió nada del modal.

- [ ] **Step 6: Checkpoint** — Task 4 lista para commit del owner.

---

### Task 5: D7 — Pulls athlete-scoped (sesiones sin anchor `user_id` + day logs + summary)

**Files:**
- Modify: `src/services/syncService.ts`
- Test: extender el describe existente de `pullWeekSessionsForAthlete` en `src/services/__tests__/syncService.test.ts` (localizable con `rg -n "pullWeekSessionsForAthlete" src --glob '*.test.ts'`).

**Interfaces:**
- Consumes: `runAthleteWrite` (`athleteWriteLease.ts`), `hasAthleteDeleteTombstone`, `getSupabase`, `withRequestTimeout`, `rowToSession`/`rowToDayLog`/`rowToWeekSummary` (existentes).
- Produces:
  ```typescript
  export type AthleteWeekPullOutcome = 'completed' | 'unavailable' | 'vetoed'
  // firma existente, filtro nuevo:
  export async function pullWeekSessionsForAthlete(ownerAccountId, athleteId, weekStartDate, weekEndDate, opts: { includeLegacy: boolean }): Promise<AthleteWeekPullOutcome>
  // nuevas, mismo shape:
  export async function pullWeekDayLogsForAthlete(ownerAccountId: string, athleteId: string, weekStartDate: string, weekEndDate: string, opts: { includeLegacy: boolean }): Promise<AthleteWeekPullOutcome>
  export async function pullWeekSummaryRowForAthlete(ownerAccountId: string, athleteId: string, weekStartDate: string, opts: { includeLegacy: boolean }): Promise<AthleteWeekPullOutcome>
  ```

Outcome obligatorio: sin backend configurado o `navigator.onLine === false` → `unavailable`; tombstone previo o veto de `runAthleteWrite` durante el merge → `vetoed`; fetch y merge completos (aunque vengan cero filas) → `completed`. Los errores de red/query siguen lanzando. Task 8 **solo marca** si los tres outcomes son `completed`.

- [ ] **Step 1: Test que falla — el anchor deja de ser `user_id`**

Con el patrón de mock de Supabase del archivo de tests existente, cubrir:

```typescript
it('pull scoped filtra por athlete_id sin user_id (atleta vinculado)', async () => {
  // mock: query builder registra .eq/.or; simular fila con user_id 'otro-usuario'
  await pullWeekSessionsForAthlete('owner-1', 'ath_linked', '2026-07-13', '2026-07-19', { includeLegacy: false })
  // asserts sobre el builder: .eq('athlete_id', 'ath_linked') presente,
  // .eq('user_id', ...) AUSENTE en el branch scoped
  // y la fila con user_id ajeno quedó en db.sessions
})

it('pull legacy usa or(athlete_id.eq.X, and(user_id.eq.owner, athlete_id.is.null))', async () => {
  await pullWeekSessionsForAthlete('owner-1', 'ath_self', '2026-07-13', '2026-07-19', { includeLegacy: true })
  // assert: .or(`athlete_id.eq.ath_self,and(user_id.eq.owner-1,athlete_id.is.null)`)
})

it('distingue completed de unavailable/vetoed para no crear marcas falsas', async () => {
  // backend off/offline => unavailable; tombstone o veto durante merge => vetoed.
})

it('day log/summary reconcilian por clave natural aunque el id remoto difiera', async () => {
  // Sembrar local con mismo athlete+date/week y otro id; verificar LWW y ausencia de ConstraintError.
})
```

Actualizar las expectativas existentes del describe `pullWeekSessionsForAthlete` en `src/services/__tests__/syncService.test.ts`: hoy afirman primero `.eq('user_id', owner)`. No duplicar tests con un mock nuevo; extender ese builder, que ya registra `eq/or/gte/lte` y cubre tombstone durante fetch.

- [ ] **Step 2: Verificar que falla** (el filtro actual arranca con `.eq('user_id', ownerAccountId)`).

- [ ] **Step 3: Implementación**

En `pullWeekSessionsForAthlete` (syncService.ts:2260-2268) reemplazar la construcción de la query:

```typescript
  let query = getSupabase()
    .from('sessions')
    .select('*')
    .gte('date', weekStartDate)
    .lte('date', weekEndDate)
  query = opts.includeLegacy
    ? query.or(`athlete_id.eq.${athleteId},and(user_id.eq.${ownerAccountId},athlete_id.is.null)`)
    : query.eq('athlete_id', athleteId)
```

Antes de construirla: `if (!isEnabled() || (typeof navigator !== 'undefined' && !navigator.onLine)) return 'unavailable'`; tombstone previo → `vetoed`. Después de procesar todas las filas → `completed`; si cualquier `runAthleteWrite` retorna `false` → `vetoed`.

`pullWeekDayLogsForAthlete`: misma estructura sobre `day_logs` (rango por `date`), fila via `rowToDayLog`, escritura LWW dentro de `runAthleteWrite(athleteId, ...)`:

```typescript
export async function pullWeekDayLogsForAthlete(
  ownerAccountId: string, athleteId: string,
  weekStartDate: string, weekEndDate: string,
  opts: { includeLegacy: boolean },
): Promise<AthleteWeekPullOutcome> {
  if (!isEnabled() || (typeof navigator !== 'undefined' && !navigator.onLine)) return 'unavailable'
  if (hasAthleteDeleteTombstone(ownerAccountId, athleteId)) return 'vetoed'
  let query = getSupabase().from('day_logs').select('*')
    .gte('date', weekStartDate).lte('date', weekEndDate)
  query = opts.includeLegacy
    ? query.or(`athlete_id.eq.${athleteId},and(user_id.eq.${ownerAccountId},athlete_id.is.null)`)
    : query.eq('athlete_id', athleteId)
  const { data, error } = await withRequestTimeout(query, 'day_logs.pull_week_for_athlete')
  if (error) throw error
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const remote = rowToDayLog(row)
    const wrote = await runAthleteWrite(athleteId, () => mergePulledDayLogForScope(remote, {
      athleteId, includeLegacy: opts.includeLegacy,
    }))
    if (!wrote) return 'vetoed'
  }
  return 'completed'
}
```

`pullWeekSummaryRowForAthlete`: igual sobre `week_summaries` con `.eq('week_start_date', weekStartDate)` en lugar del rango. Verificado: no existen tombstones por fila para day logs/week summaries; el contrato es LWW.

**`hydrateWeekForAthlete` propaga el outcome (R24):** su único consumidor productivo es `CoachPlanningPanel`, que hoy trata el throw como "semana no hidratada" (stale/error). Con el retorno `unavailable` silencioso, offline pasaría a verse como semana fresca entre los commits de esta task y Task 13. En esta task, `hydrateWeekForAthlete` pasa a lanzar cuando el pull no devuelve `completed`:

```typescript
  const outcome = await pullWeekSessionsForAthlete(/* ...args actuales... */)
  if (outcome !== 'completed') {
    throw new Error('No se pudo hidratar la semana. Actualizá e intentá de nuevo.')
  }
```

Agregar su test (offline ⇒ rejects) junto a los del outcome. Task 13 la retira si queda sin consumidores.

`mergePulledDayLogForScope` / `mergePulledWeekSummaryForScope` no pueden hacer solo `db.table.get(remote.id)`. Dentro de una transacción de la tabla deben:

1. buscar por `id` **y** por la clave natural efectiva del scope (`athleteId+date/weekStartDate`; para self con `includeLegacy`, considerar también candidatos unscoped de esa fecha/semana);
2. elegir por `updatedAt` y usar el mismo desempate determinístico que el merge global existente;
3. si cambia el `id` ganador, borrar primero el perdedor y luego hacer `put`, evitando el UNIQUE compuesto de Dexie v14;
4. no pushear desde estos pulls read-only; si gana local, conservarlo y dejar que el write path/cola existente lo sincronice.

Reutilizar o extraer los helpers privados existentes `findDayLogConflictByDate`, `findWeekSummaryConflictByWeekStart`, `resolveDayLogConflict` y `resolveWeekSummaryConflict`; no crear una segunda semántica LWW.

- [ ] **Step 4: Verificar** — tests nuevos PASS + `npx vitest run src/services/__tests__/` completo verde.

- [ ] **Step 5: Checkpoint** — Task 5 lista para commit del owner.

---

### Task 6: D7 — `RemoteSessionTarget` + push/delete por target + cola/drain + adopción

**Files:**
- Create: `src/services/sync/remoteSessionTarget.ts`
- Modify: `src/services/syncUtils.ts` (OfflineOp)
- Modify: `src/services/sync/syncQueue.ts` (`isSameQueuedOpVersion`)
- Modify: `src/services/syncService.ts`
- Test: `src/services/sync/__tests__/remoteSessionTarget.test.ts`, tests puros de `syncQueue` + casos en el archivo de tests de syncService

**Interfaces:**
- Consumes: `isScopedAthleteId`, `runAthleteWrite`, `enqueue`/`loadQueue` (syncQueue), `sessionToRow` (privada — el push por target construye su propia fila, ver abajo).
- Produces:
  ```typescript
  // remoteSessionTarget.ts
  export type RemoteSessionTarget =
    | { kind: 'scoped'; athleteId: string }
    | { kind: 'legacySelf'; ownerAccountId: string; selfAthleteId: string }
  export function captureRemoteSessionTarget(localRow: Session, ownerAccountId: string, selfAthleteId: string): RemoteSessionTarget
  export function isRemoteSessionTarget(value: unknown): value is RemoteSessionTarget
  // syncUtils.ts — OfflineOp gana:
  //   sessionTarget?: RemoteSessionTarget
  //   replayKind?: 'weekSummaryForAthlete'   (Task 7)
  // (scopeAthleteId ya existe en OfflineOp; las ops nuevas SIEMPRE lo setean)
  // syncService.ts
  export async function pushSessionForTarget(session: Session, target: RemoteSessionTarget): Promise<void>
  export async function deleteSessionForTarget(sessionId: string, target: RemoteSessionTarget): Promise<void>
  export function rememberSessionDeleteTombstone(userId: string, sessionId: string): void
  ```

- [ ] **Step 1: Test del capture (puro)**

```typescript
// src/services/sync/__tests__/remoteSessionTarget.test.ts
import { describe, expect, it } from 'vitest'
import { captureRemoteSessionTarget } from '../remoteSessionTarget'
import type { Session } from '../../../types'

const row = (athleteId?: string) => ({ id: 's', athleteId } as Session)

describe('captureRemoteSessionTarget', () => {
  it('fila scoped → target scoped', () => {
    expect(captureRemoteSessionTarget(row('ath_m'), 'owner', 'ath_self'))
      .toEqual({ kind: 'scoped', athleteId: 'ath_m' })
  })
  it('fila unscoped → legacySelf con selfAthleteId resuelto', () => {
    expect(captureRemoteSessionTarget(row(undefined), 'owner', 'ath_self'))
      .toEqual({ kind: 'legacySelf', ownerAccountId: 'owner', selfAthleteId: 'ath_self' })
  })
})
```

Implementación:

```typescript
// src/services/sync/remoteSessionTarget.ts
import type { Session } from '../../types'
import { isScopedAthleteId } from '../athlete/effectiveAthleteKey'

export type RemoteSessionTarget =
  | { kind: 'scoped'; athleteId: string }
  | { kind: 'legacySelf'; ownerAccountId: string; selfAthleteId: string }

/** Capturado ANTES de mutar, desde la fila local (spec D7). */
export function captureRemoteSessionTarget(
  localRow: Session,
  ownerAccountId: string,
  selfAthleteId: string,
): RemoteSessionTarget {
  if (isScopedAthleteId(localRow.athleteId)) {
    return { kind: 'scoped', athleteId: localRow.athleteId as string }
  }
  return { kind: 'legacySelf', ownerAccountId, selfAthleteId }
}

export function isRemoteSessionTarget(value: unknown): value is RemoteSessionTarget {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return row.kind === 'scoped'
    ? typeof row.athleteId === 'string' && row.athleteId.length > 0
    : row.kind === 'legacySelf'
      && typeof row.ownerAccountId === 'string' && row.ownerAccountId.length > 0
      && typeof row.selfAthleteId === 'string' && row.selfAthleteId.length > 0
}
```

En `syncUtils.ts`, agregar a `OfflineOp`:

```typescript
  /** Target remoto discriminado de sesiones del workspace (spec D7). Serializable. */
  sessionTarget?: import('./sync/remoteSessionTarget').RemoteSessionTarget
  /** Replays athlete-scoped no cubiertos por el drain genérico (Task 7). */
  replayKind?: 'weekSummaryForAthlete'
```

Usar `import type` arriba para `RemoteSessionTarget`. Al cargar/drenar la cola, validar `sessionTarget` con `isRemoteSessionTarget`; una op corrupta con target inválido se descarta con diagnóstico, nunca cae al upsert genérico con filtros distintos.

- [ ] **Step 2: Tests de push/delete por target (mock Supabase, patrón del archivo existente)** — escribir estos casos:

1. `deleteSessionForTarget` scoped → `.delete().eq('id', id).eq('athlete_id', athleteId)`; 0 filas afectadas NO lanza.
2. `deleteSessionForTarget` legacySelf → primer intento `.eq('id').eq('user_id', owner).is('athlete_id', null)`; si 0 filas, segundo intento `.eq('id').eq('athlete_id', selfAthleteId)`.
3. `pushSessionForTarget` scoped: update por `id + athlete_id` con fila SIN `user_id` y con `updated_by_account_id = actor`; si 0 filas → insert con `user_id = actor`.
4. `pushSessionForTarget` legacySelf: update por `id + user_id + athlete_id IS NULL` estampando `athlete_id = selfAthleteId` en el SET; 0 filas → fallback update por `id + athlete_id = selfAthleteId`; 0 filas en ambos → insert scoped.
5. Adopción confirmada (update afectó filas) → la fila local Dexie queda con `athleteId = selfAthleteId` **solo si** sigue existiendo y sigue unscoped; con la sesión borrada localmente entre push y confirmación → no-op (no resucita); con la sesión editada localmente → solo cambia `athleteId` (assert de que `title`/`updatedAt` locales no cambian).
6. Offline: la op encolada lleva `action`, `scopeAthleteId` y `sessionTarget`; `clearQueuedOpsForAthlete(owner, athleteId)` la suprime.
7. Drain: op con `sessionTarget` se replays con el mismo filtro (spy sobre el builder); replay repetido tras adopción no lanza ni duplica.
8. Una op vieja encolada seguida por un push online exitoso de la misma sesión se elimina; no puede re-aplicar el snapshot viejo en el próximo drain.
9. El push queda visible para `waitForInFlightAthleteOps(athleteId)` y un tombstone iniciado antes del executor remoto impide insertar/recrear al atleta.

Para el update condicional con Supabase, usar `.update(row).eq(...).select('id')` y decidir por `data.length` (0 filas = no match). El insert usa `.insert(row)`.

- [ ] **Step 3: Implementación en `syncService.ts`**

```typescript
import { type RemoteSessionTarget } from './sync/remoteSessionTarget'

// Ya existe una función privada con este nombre cerca de los helpers de
// tombstone (~línea 3610): convertir ESA declaración en export. No agregar
// un segundo wrapper/declaración con el mismo identificador.

/** Fila para update athlete-scoped: como sessionToRow pero SIN user_id (no reparenta, spec D7). */
function sessionToRowWithoutUser(session: Session, actorId: string): Record<string, unknown> {
  const row = sessionToRow(session, actorId)
  delete row.user_id
  return row
}

async function updateSessionRow(
  filterApply: (q: ReturnType<ReturnType<typeof getSupabase>['from']>['update']) => unknown,
  ...
): Promise<number> { /* helper local: update + select('id') → data.length */ }

export async function pushSessionForTarget(session: Session, target: RemoteSessionTarget): Promise<void> {
  const userId = getUserId()
  if (!userId || !isEnabled()) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueueSessionTargetOp('upsert', session, target, userId)
    return
  }
  try {
    await executeSessionPush(session, target, userId)
  } catch (error) {
    const info = classifySyncError(error, 'sessions')
    if (info.retriable || info.autoRepairable) enqueueSessionTargetOp('upsert', session, target, userId)
    else applySyncFailure(error, info.userMessage, 'sessions')
  }
}

async function executeSessionPush(session: Session, target: RemoteSessionTarget, userId: string): Promise<void> {
  if (target.kind === 'scoped') {
    const row = sessionToRowWithoutUser({ ...session, athleteId: target.athleteId }, userId)
    const updated = await supabaseUpdateCount(
      getSupabase().from('sessions').update(row as never)
        .eq('id', session.id).eq('athlete_id', target.athleteId).select('id'),
      'sessions.update_scoped',
    )
    if (updated === 0) {
      const insertRow = { ...row, user_id: userId, athlete_id: target.athleteId }
      const { error } = await withRequestTimeout(
        getSupabase().from('sessions').insert(insertRow as never), 'sessions.insert_scoped')
      if (error) throw error
    }
    return
  }
  // legacySelf: update adopta estampando athlete_id (spec D7, transición sticky)
  const row = { ...sessionToRowWithoutUser(session, userId), athlete_id: target.selfAthleteId }
  const adopted = await supabaseUpdateCount(
    getSupabase().from('sessions').update(row as never)
      .eq('id', session.id).eq('user_id', target.ownerAccountId).is('athlete_id', null).select('id'),
    'sessions.update_legacy',
  )
  const confirmed = adopted > 0 || (await supabaseUpdateCount(
    getSupabase().from('sessions').update(row as never)
      .eq('id', session.id).eq('athlete_id', target.selfAthleteId).select('id'),
    'sessions.update_adopted',
  )) > 0
  if (!confirmed) {
    const insertRow = { ...row, user_id: userId }
    const { error } = await withRequestTimeout(
      getSupabase().from('sessions').insert(insertRow as never), 'sessions.insert_after_legacy')
    if (error) throw error
  }
  await stampLocalSessionAdopted(session.id, target.selfAthleteId)
}

/** Patch-only bajo lease: no resucita, no pisa edits, no toca updatedAt (spec D7 rev.5). */
async function stampLocalSessionAdopted(sessionId: string, selfAthleteId: string): Promise<void> {
  await runAthleteWrite(selfAthleteId, async () => {
    const current = await db.sessions.get(sessionId)
    if (!current) return
    if (isScopedAthleteId(current.athleteId)) return
    await db.sessions.update(sessionId, { athleteId: selfAthleteId })
  })
}

export async function deleteSessionForTarget(sessionId: string, target: RemoteSessionTarget): Promise<void> {
  const userId = getUserId()
  if (!userId || !isEnabled()) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    enqueueSessionTargetOp('delete', { id: sessionId } as Session, target, userId)
    return
  }
  try {
    await executeSessionDelete(sessionId, target)
  } catch (error) {
    const info = classifySyncError(error, 'sessions')
    if (info.retriable || info.autoRepairable) enqueueSessionTargetOp('delete', { id: sessionId } as Session, target, userId)
    else applySyncFailure(error, 'No se pudo eliminar en sync sessions.', 'sessions')
  }
}

async function executeSessionDelete(sessionId: string, target: RemoteSessionTarget): Promise<void> {
  if (target.kind === 'scoped') {
    const { error } = await withRequestTimeout(
      getSupabase().from('sessions').delete().eq('id', sessionId).eq('athlete_id', target.athleteId),
      'sessions.delete_scoped')
    if (error) throw error
    return
  }
  const first = await supabaseDeleteCount(
    getSupabase().from('sessions').delete()
      .eq('id', sessionId).eq('user_id', target.ownerAccountId).is('athlete_id', null).select('id'),
    'sessions.delete_legacy')
  if (first === 0) {
    // fila adoptada entremedio: segundo intento scoped (spec D7 — sin esto queda viva bajo tombstone)
    const { error } = await withRequestTimeout(
      getSupabase().from('sessions').delete().eq('id', sessionId).eq('athlete_id', target.selfAthleteId),
      'sessions.delete_adopted')
    if (error) throw error
  }
}

function enqueueSessionTargetOp(action: 'upsert' | 'delete', session: Session, target: RemoteSessionTarget, userId: string): void {
  const scopeAthleteId = target.kind === 'scoped' ? target.athleteId : target.selfAthleteId
  enqueue({
    userId, table: 'sessions', action,
    payload: action === 'delete'
      ? { id: session.id, userId }
      : sessionToRowWithoutUser(session, userId),
    enqueuedAt: Date.now(),
    scopeAthleteId,
    sessionTarget: target,
  })
}
```

La implementación esquemática anterior debe integrarse con las garantías que hoy ofrece `upsertRow`; no llamar al executor “a pelo”. Tanto push como delete:

1. calculan `scopeAthleteId` desde el target y cortan si existe `hasAthleteDeleteTombstoneForAthlete(scopeAthleteId)`;
2. capturan `requestedAt = Date.now()`;
3. ejecutan dentro de `trackInFlightAthleteOp(scopeAthleteId, withSerializedEntityMutation(userId, 'sessions', identityPayload, ...))`, para que el borrado duro pueda esperar y dos mutaciones del mismo ID no se adelanten;
4. antes del insert-fallback llaman `ensureRemoteAthlete(userId, scopeAthleteId)`;
5. tras éxito llaman `clearQueuedOpsForEntityOlderThan(userId, 'sessions', { id: session.id }, requestedAt)`;
6. al encolar conservan `scopeAthleteId`, `sessionTarget` y programan/registran retry con el mismo patrón del sync actual.

Sin los puntos 3–5, un hard delete puede correr mientras el push sigue en vuelo y una op offline vieja puede sobrescribir un edit que sí subió online.

`supabaseUpdateCount`/`supabaseDeleteCount`: helpers locales que ejecutan la query con `withRequestTimeout`, tiran en error, devuelven `data?.length ?? 0`.

**Drain (syncService.ts, dentro del `for` de `drainQueue`, ~línea 1010):** antes de las ramas genéricas:

```typescript
        if (op.table === 'sessions' && op.sessionTarget) {
          await executeSessionTargetReplay(op)
        } else if (op.action === 'upsert') { ... resto igual ... }
```

`executeSessionTargetReplay(op)` (nombre único, también referenciado en Task 7 — R25) despacha por `op.action`: delete → `executeSessionDelete(op.payload.id, op.sessionTarget)` + `rememberDeleteTombstoneForTable('sessions', op.userId, op.payload.id)`; upsert → misma lógica que `executeSessionPush` pero partiendo de la fila serializada del payload (que ya viene sin `user_id`): scoped → update `id+athlete_id`, insert-fallback con `user_id: op.userId`; legacySelf → las dos ramas + insert + `stampLocalSessionAdopted`. Extraer la parte común de `executeSessionPush` para no duplicarla (la función que opera sobre `row: Record<string, unknown>` es la compartida; `executeSessionPush` solo agrega la conversión de `Session` a fila).

El branch especial del drain ya está dentro de `trackInFlightAthleteOp` + `withSerializedEntityMutation`; debe validar el target antes de usarlo y llamar `ensureRemoteAthlete` antes de cualquier insert-fallback. No volver a envolverlo en otra lane con la misma key (evita auto-deadlock).

**Carrera push-online ↔ drain (R30).** El drain trabaja sobre un snapshot (`const queue = loadQueue()`, syncService.ts:914) y hoy termina con `saveQueue([...otherUsersQueue, ...remaining])` (:1131), que sobrescribe la cola persistida. Dos fallas concretas con las ops nuevas: (a) un push online que ejecuta `clearQueuedOpsForEntityOlderThan` durante el drain no impide que el drain ejecute después la op vieja que aún tiene en memoria — como los updates athlete-scoped no llevan guard de `updated_at`, el snapshot viejo pisa el dato recién subido; (b) un `enqueue` concurrente durante el drain se pierde en el commit final. Correcciones (usan `offlineOpsShareIdentity` de `syncQueue.ts`, que ya define identidad estable `userId+table+action+enqueuedAt+entityId` — no agregar un `opId` nuevo):

1. **Revalidación en lane — identidad + equivalencia:** dentro del callback de `withSerializedEntityMutation`, antes de ejecutar la op (aplica a TODAS las ramas del drain, genéricas y nuevas), buscar en `loadQueue()` la op con `offlineOpsShareIdentity(queued, op)`. Si no existe → limpiada por un push online más nuevo: superseded, `return` (contabilizar como progreso del snapshot, no como error). Si existe pero **no es estrictamente equivalente a la versión del snapshot** → también superseded, `return`, y la versión actual **se preserva** en el commit. Extraer `isSameQueuedOpVersion(a, b)` junto a `offlineOpsShareIdentity`: exige identidad y deep-equal de `payload`, `scopeAthleteId`, `sessionTarget` y `replayKind`; excluye deliberadamente `retryCount`/`lastErrorCategory`, que son estado mutable del retry. La identidad puede colisionar porque `enqueuedAt` sale de `Date.now()` y `compactQueue` reemplaza la op del mismo entity dentro del mismo milisegundo; sin el chequeo de versión el drain ejecutaría el payload viejo y consumiría el nuevo. La lane serializa contra el push online del mismo entity id, así que tras el `return` no hay ejecución parcial.
2. **Commit final por delta, no por snapshot — resultado final y progreso separados:** reemplazar `saveQueue([...otherUsersQueue, ...remaining])` por: `const current = loadQueue()`; quitar de `current` toda op idéntica a una versión consumida (ejecutada ok, dropped, expirada); reemplazar solo la versión original de cada retry por su versión actualizada; dejar intacto todo lo demás. Una versión superseded por contenido distinto no entra al set consumido. Persistir `finalQueue` y calcular `finalUserOps = finalQueue.filter((op) => op.userId === userId)`. `finalUserOps` decide si quedan pendientes, si puede llamarse `markSyncRecovered`/`markSyncHealthy` y el retorno normal del drain. **No** calcular `madeProgress` comparando cardinalidades: registrar progreso desde los outcomes del snapshot (éxito, repair, drop o superseded frente a una op que sigue como retry/pending), porque un enqueue concurrente puede cambiar el largo final. Asociar el error a su retry original y llamar `applySyncFailure` solo si esa versión fue realmente reemplazada/conservada en `finalQueue`; un error de una versión luego superseded no se reporta como bloqueo vigente. Si `finalUserOps` contiene únicamente ops concurrentes/pending sin error retenido, cerrar explícitamente el intento (`syncAttemptInFlight=false`) sin marcar healthy/recovered y conservar diagnóstico/retry para el próximo ciclo. Se mantiene la excepción existente: `expiredOps` aplica `applyExpiredQueueFailure` y retorna `false` aunque el delta deje la cola vacía. `keepQueuedOpForRetry` (Task 7) produce los reemplazos reconciliados por este criterio.
3. **Tests concurrentes** (sesiones y summaries): (i) op encolada + `drainQueue` en curso + push online que limpia esa op antes de que su lane la ejecute → el drain no la re-aplica y el remoto conserva el dato nuevo; (ii) `enqueue` concurrente mientras el drain corre → la op sobrevive, `drainQueue()` retorna `false`, no se llama healthy/recovered y `syncAttemptInFlight` termina en `false`; (iii) **reloj congelado** (`vi.spyOn(Date, 'now')`): reemplazar durante el drain por una versión con el MISMO `enqueuedAt` → no ejecuta el payload viejo y la nueva sobrevive; casos puros confirman que `scopeAthleteId`/target/replay distinguen versiones y retry metadata no; (iv) una op exitosa + una retry + un enqueue concurrente mantiene `madeProgress=true` aunque la cardinalidad final no disminuya, y un error superseded no se reporta; (v) suite existente sin cambios, incluido recovered/healthy y el retorno `false` de expiradas.

Este es el único punto del incremento que toca el commit compartido del drain; el cambio es semánticamente equivalente sin concurrencia (test v lo fija) y las ramas ejecutoras genéricas siguen intactas. Alcance confirmado por el owner: el delta aplica a la cola COMPLETA (no solo a ops con `sessionTarget`/`replayKind`) — limitarlo dejaría la misma pérdida de encolados concurrentes en ops genéricas y dos semánticas de commit; modifica la reconciliación de la cola, no los ejecutores remotos genéricos, así que no contradice la Global Constraint.

- [ ] **Step 4: Verificar** — casos del Step 2 PASS; `npx vitest run src/services/` completo verde (el drain genérico intacto: test de no-regresión = suite existente de syncService).

- [ ] **Step 5: Checkpoint** — Task 6 lista para commit del owner.

---

### Task 7: D7 — `pushWeekSummaryForAthlete` con LWW y reconciliación inmediata

**Files:**
- Modify: `src/services/syncService.ts`
- Test: casos nuevos en el archivo de tests de syncService

**Interfaces:**
- Consumes: `weekSummaryToRow` (privada), `runAthleteWrite`, `rowToWeekSummary`.
- Produces:
  ```typescript
  export async function pushWeekSummaryForAthlete(summary: WeekSummary): Promise<void> // exige summary.athleteId; si falta, delega a pushWeekSummary genérico con log warn
  ```

- [ ] **Step 1: Tests (mock Supabase):**

1. Update-first por `id + athlete_id` con fila sin `user_id`; 0 filas → insert con `user_id = actor`.
2. Insert devuelve `23505` → busca por `athlete_id + week_start_date` (sin filtro `user_id`).
3. LWW local más nuevo → update condicional `eq('id', remote.id).eq('athlete_id').eq('week_start_date').lt('updated_at', local.updatedAt)`; si afecta 0 filas → re-fetch y re-evaluación.
4. LWW remoto más nuevo **y empate** → no sobrescribe y **reconcilia Dexie ya**: `db.weekSummaries` queda con la fila remota (bajo `runAthleteWrite`), borrando la fila local con otro `id` si difiere.
5. Si durante la espera remota aparece un summary local más nuevo para el mismo natural key, la reconciliación vieja NO lo pisa; se reencola/pushea el candidato local nuevo.
6. Offline/error retriable → enqueue con `scopeAthleteId = summary.athleteId` y `replayKind = 'weekSummaryForAthlete'`.
7. Drain de esa op usa update-first + reconciliación athlete-scoped (nunca `.upsert` genérico) y vuelve a agregar `user_id` solo en insert.
8. Carrera repetida de update condicional agota un máximo acotado y conserva la op en cola; no hay recursión ilimitada ni `enqueue()` desde dentro del drain.
9. Si el retry descubrió un summary local más nuevo, el payload conservado/reencolado es ese candidato, no el snapshot viejo; también se preserva si el siguiente intento falla por red.
10. **(R22)** El push online queda visible para `waitForInFlightAthleteOps(summary.athleteId)`: un borrado duro iniciado durante el push espera a que termine; con tombstone previo, el push corta sin tocar la red.
11. **(R22)** Tras un push online exitoso, una op encolada más vieja del mismo `summary.id` se elimina (`clearQueuedOpsForEntityOlderThan`) y el próximo drain no re-aplica el snapshot viejo.

- [ ] **Step 2: Implementación**

```typescript
function weekSummaryQueuePayload(summary: WeekSummary, actorId: string): Record<string, unknown> {
  const row = weekSummaryToRow(summary, actorId)
  delete row.user_id
  return { ...row, athlete_id: summary.athleteId }
}

export async function pushWeekSummaryForAthlete(summary: WeekSummary): Promise<void> {
  const userId = getUserId()
  if (!userId || !isEnabled()) return
  if (!summary.athleteId) {
    syncLog('pushWeekSummaryForAthlete:unscoped_fallback', { id: summary.id }, 'warn')
    await pushWeekSummary(summary)
    return
  }
  const athleteId = summary.athleteId
  const row = weekSummaryQueuePayload(summary, userId)
  // No trae user_id: no reparenta. updated_by_account_id sí registra al actor.

  const enqueueOp = (candidate: WeekSummary = summary) => enqueue({
    userId, table: 'week_summaries', action: 'upsert',
    payload: weekSummaryQueuePayload(candidate, userId), enqueuedAt: Date.now(),
    scopeAthleteId: athleteId, replayKind: 'weekSummaryForAthlete',
  })
  if (typeof navigator !== 'undefined' && !navigator.onLine) { enqueueOp(); return }

  try {
    const updated = await supabaseUpdateCount(
      getSupabase().from('week_summaries').update(row as never)
        .eq('id', summary.id).eq('athlete_id', athleteId).select('id'),
      'week_summaries.update_for_athlete')
    if (updated > 0) return
    await ensureRemoteAthlete(userId, athleteId)
    const { error } = await withRequestTimeout(
      getSupabase().from('week_summaries').insert({ ...row, user_id: userId, athlete_id: athleteId } as never),
      'week_summaries.insert_for_athlete')
    if (!error) return
    if ((error as { code?: string }).code !== '23505') throw error
    const outcome = await reconcileWeekSummaryNaturalKey(summary, athleteId, userId)
    if (outcome.status === 'retry') enqueueOp(outcome.summary)
  } catch (error) {
    const info = classifySyncError(error, 'week_summaries')
    if (info.retriable || info.autoRepairable) {
      const latest = await findLocalWeekSummaryForAthleteWeek(athleteId, summary.weekStartDate)
      enqueueOp(latest ?? summary)
    }
    else applySyncFailure(error, info.userMessage, 'week_summaries')
  }
}

type WeekSummaryExecutionOutcome =
  | { status: 'done' }
  | { status: 'retry'; summary: WeekSummary }

async function reconcileWeekSummaryNaturalKey(
  summary: WeekSummary, athleteId: string, userId: string,
): Promise<WeekSummaryExecutionOutcome> {
  let candidate = summary
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const outcome = await reconcileWeekSummaryNaturalKeyAttempt(candidate, athleteId, userId)
    if (outcome.status === 'done') return outcome
    candidate = outcome.summary
  }
  return { status: 'retry', summary: candidate }
}

async function reconcileWeekSummaryNaturalKeyAttempt(
  summary: WeekSummary, athleteId: string, userId: string,
): Promise<WeekSummaryExecutionOutcome> {
  // 1. localizar SIN filtro user_id (spec D7: la búsqueda por actor no encuentra la fila del atleta vinculado)
  const { data, error } = await withRequestTimeout(
    getSupabase().from('week_summaries').select('*')
      .eq('athlete_id', athleteId).eq('week_start_date', summary.weekStartDate).limit(1),
    'week_summaries.reconcile_select')
  if (error) throw error
  const remoteRow = (data as Record<string, unknown>[] | null)?.[0]
  if (!remoteRow) return { status: 'retry', summary } // desapareció entre insert/select
  const remoteUpdatedAt = (remoteRow.updated_at as number) ?? 0
  const localUpdatedAt = summary.updatedAt ?? 0

  if (remoteUpdatedAt >= localUpdatedAt) {
    // remoto gana (empate incluido): reconciliar Dexie YA, bajo lease (spec D7 rev.5 —
    // el próximo pull desempataría con deterministicTiebreaker y podría revertirlo)
    const winner = rowToWeekSummary(remoteRow)
    const retry = { candidate: undefined as WeekSummary | undefined }
    const wrote = await runAthleteWrite(athleteId, async () => {
      await db.transaction('rw', db.weekSummaries, async () => {
        const current = await findLocalWeekSummaryForAthleteWeek(athleteId, summary.weekStartDate)
        // La respuesta se comparó contra `summary`, pero el usuario pudo editar
        // localmente mientras esperaba la red. Nunca pisar ese candidato nuevo.
        if ((current?.updatedAt ?? 0) > remoteUpdatedAt) {
          retry.candidate = current
          return
        }
        if (winner.id !== summary.id) await db.weekSummaries.delete(summary.id)
        if (current && current.id !== winner.id) await db.weekSummaries.delete(current.id)
        await db.weekSummaries.put(winner)
      })
    })
    if (!wrote) return { status: 'done' } // hard delete/tombstone: no recrear ni reencolar
    return retry.candidate
      ? { status: 'retry', summary: retry.candidate }
      : { status: 'done' }
  }
  // local más nuevo: update condicional sobre la fila remota ganadora del natural key
  const row = weekSummaryToRow({ ...summary, id: remoteRow.id as string }, userId)
  delete row.user_id
  const updated = await supabaseUpdateCount(
    getSupabase().from('week_summaries').update(row as never)
      .eq('id', remoteRow.id as string).eq('athlete_id', athleteId)
      .eq('week_start_date', summary.weekStartDate).lt('updated_at', localUpdatedAt).select('id'),
    'week_summaries.reconcile_update')
  if (updated === 0) return { status: 'retry', summary }
  // el id local difiere del remoto: adoptar el id remoto localmente bajo lease
  if ((remoteRow.id as string) !== summary.id) {
    const retry = { candidate: undefined as WeekSummary | undefined }
    const wrote = await runAthleteWrite(athleteId, async () => {
      await db.transaction('rw', db.weekSummaries, async () => {
        const current = await findLocalWeekSummaryForAthleteWeek(athleteId, summary.weekStartDate)
        if ((current?.updatedAt ?? 0) > localUpdatedAt) {
          retry.candidate = current
          return
        }
        if (current && current.id !== remoteRow.id) await db.weekSummaries.delete(current.id)
        await db.weekSummaries.put({ ...summary, id: remoteRow.id as string })
      })
    })
    if (!wrote) return { status: 'done' }
    if (retry.candidate) return { status: 'retry', summary: retry.candidate }
  }
  return { status: 'done' }
}
```

**Garantías del sync actual también en el path online (R22, espejo de los puntos 1–5 de Task 6):** el snippet anterior es esquemático; la ejecución online debe:

1. cortar temprano si `hasAthleteDeleteTombstoneForAthlete(summary.athleteId)` (además del `ensureRemoteAthlete` pre-insert, que solo cubre el insert);
2. capturar `requestedAt = Date.now()` antes de ejecutar;
3. envolver el bloque try (update-first + insert + reconciliación) en `trackInFlightAthleteOp(summary.athleteId, withSerializedEntityMutation(userId, 'week_summaries', { id: summary.id }, ...))` — sin esto la barrera del borrado duro no espera el push y dos pushes del mismo summary pueden intercalarse;
4. tras éxito (status `done` sin reencolar), llamar `clearQueuedOpsForEntityOlderThan(userId, 'week_summaries', { id: summary.id }, requestedAt)` — `getEntityIdFromPayload` resuelve por `payload.id`, verificado;
5. al encolar, conservar `scopeAthleteId` + `replayKind` como ya especifica esta task.

Definición faltante (R26) — los summaries de D2 siempre están scoped, alcanza el índice compuesto:

```typescript
async function findLocalWeekSummaryForAthleteWeek(
  athleteId: string, weekStartDate: string,
): Promise<WeekSummary | undefined> {
  return db.weekSummaries.where('[athleteId+weekStartDate]').equals([athleteId, weekStartDate]).first()
}
```

Extraer el closure `enqueueOp` como `enqueueWeekSummaryForAthlete(summary, userId)` para el caller online; siempre agrega `athlete_id`, `scopeAthleteId` y `replayKind`. `weekSummaryQueuePayload` serializa el **candidato retornado**, sin `user_id` y con `athlete_id`. El executor/reconciliador devuelve el candidato en `retry` y **no encola por sí mismo**.

Cada `0 rows` re-fetch/re-evalúa en el siguiente intento. Si los tres intentos chocan, reencolar explícitamente la op especial. No usar recursión abierta ni depender de que `classifySyncError` reconozca un error interno inventado.

Extraer un `executeWeekSummaryForAthleteRow(summary, athleteId, userId)` compartido por el push online y el replay. En `drainQueue`, **antes** del upsert genérico:

```typescript
const replay = { outcome: { status: 'done' } as WeekSummaryExecutionOutcome }
await trackInFlightAthleteOp(opTarget,
  withSerializedEntityMutation(op.userId, op.table, op.payload, async () => {
    if (op.table === 'week_summaries' && op.action === 'upsert'
        && op.replayKind === 'weekSummaryForAthlete' && op.scopeAthleteId) {
      replay.outcome = await executeWeekSummaryForAthleteRow(
        rowToWeekSummary(op.payload), op.scopeAthleteId, op.userId,
      )
      return
    }
    if (op.table === 'sessions' && op.sessionTarget) {
      await executeSessionTargetReplay(op)
      return
    }
    // ... ramas genéricas actuales exactamente como están ...
  }))

// Ya fuera del callback/lane, por lo que `continue` sí pertenece al for del drain.
if (replay.outcome.status === 'retry') {
  const retryOp = {
    ...op,
    payload: weekSummaryQueuePayload(replay.outcome.summary, op.userId),
  }
  keepQueuedOpForRetry(remaining, retryOp, opRetryCount, 'reconcile_race')
  continue
}
```

El executor especial corre dentro de la lane/track que ya envuelve cada op del drain, llama `ensureRemoteAthlete` antes del insert y nunca incluye `user_id` en un update. Evaluar `replay.outcome` **antes** de registrar el `trackSyncEvent(status: 'ok')`. El branch no puede inferirse solo de `table === 'week_summaries'`: deben seguir funcionando las ops históricas/genéricas que no traen `replayKind`. No llamar `enqueue()` desde ese branch: el executor devuelve `retry` y `keepQueuedOpForRetry` registra el reemplazo que el commit por delta reconcilia; encolar abriría un segundo path de compactación y una carrera innecesaria. Al conservar la op, reemplazar el payload por el candidato más nuevo retornado; retener el snapshot viejo perdería el edit que disparó el retry. Extraer `keepQueuedOpForRetry` para no duplicar la actualización de `retryCount`/diagnósticos; no falsificar `network_error` si se agrega una categoría interna explícita. Con R30, el reemplazo se reconcilia por **identidad + equivalencia de versión** (`isSameQueuedOpVersion`) contra la cola actual: si un push online limpió la versión del snapshot o un enqueue la reemplazó entre medio, el retry se descarta (la versión más nueva lo superó). El replay de summaries también aplica la revalidación en lane de R30 antes de ejecutar.

Al adoptar un `id` remoto o aplicar un ganador remoto, re-leer dentro del lease por natural key (`[athleteId+weekStartDate]`) y comparar timestamps contra el estado **actual**, no solo contra el snapshot que inició el request. Borrar los IDs perdedores y hacer `put` en una sola transacción `db.weekSummaries` para respetar el UNIQUE compuesto.

- [ ] **Step 3: Verificar** — casos PASS + suite de services verde.

- [ ] **Step 4: Checkpoint** — Task 7 lista para commit del owner.

---

### Task 8: D1 — Registro de hidratación + invalidación

**Files:**
- Create: `src/services/athlete/coachPlanningHydration.ts`
- Create: `src/services/athlete/coachPlanningHydrationRegistry.ts` (cycle-free)
- Modify: `src/store/useAuthStore.ts` (signOut + transición de cuenta), `src/services/appMaintenance.ts` (limpieza de training data), `src/services/dataExport.ts` (import replace/merge real), `src/services/athlete/managedAthletes.ts` (borrado duro)
- Test: `src/services/athlete/__tests__/coachPlanningHydration.test.ts`

**Interfaces:**
- Consumes: `pullWeekSessionsForAthlete`, `pullWeekDayLogsForAthlete`, `pullWeekSummaryRowForAthlete` (Task 5), `resolveAthleteWeekScope` (Task 1), `weekEndISO` y `assertActiveRosterAthlete` (coachScopedReads — sin ciclo: `coachScopedReads` no importa hydration).
- Produces:
  ```typescript
  export function isWeekHydrated(ownerAccountId: string, athleteId: string, weekStartDate: string): boolean
  export async function ensureWeekHydrated(
    ownerAccountId: string,
    scope: AthleteWeekScope,
    weekStartDate: string,
    options?: { force?: boolean },
  ): Promise<void> // lanza si algún pull falla/no completa; force refresca e invalida marca previa si falla
  export function clearCoachPlanningHydrationRegistry(athleteId?: string): void
  ```

El caller resuelve `AthleteWeekScope` una sola vez y lo pasa al registro. El panel usa `{ force: true }` al cargar/reintentar; `coachScopedWrites` omite `force` y reutiliza una marca válida. Esto evita que hidratación y mutación resuelvan self de nuevo entre awaits.

- [ ] **Step 1: Tests que fallan**

```typescript
// src/services/athlete/__tests__/coachPlanningHydration.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as syncService from '../../syncService'
import {
  clearCoachPlanningHydrationRegistry, ensureWeekHydrated, isWeekHydrated,
} from '../coachPlanningHydration'

describe('coachPlanningHydration', () => {
  beforeEach(() => {
    clearCoachPlanningHydrationRegistry()
    vi.spyOn(syncService, 'pullWeekSessionsForAthlete').mockResolvedValue('completed')
    vi.spyOn(syncService, 'pullWeekDayLogsForAthlete').mockResolvedValue('completed')
    vi.spyOn(syncService, 'pullWeekSummaryRowForAthlete').mockResolvedValue('completed')
  })
  afterEach(() => vi.restoreAllMocks())

  it('marca solo tras completar los TRES pulls', async () => {
    await ensureWeekHydrated('o', { athleteId: 'ath_m', includeLegacy: false }, '2026-07-13')
    expect(isWeekHydrated('o', 'ath_m', '2026-07-13')).toBe(true)
    expect(syncService.pullWeekDayLogsForAthlete).toHaveBeenCalled()
    expect(syncService.pullWeekSummaryRowForAthlete).toHaveBeenCalled()
  })

  it('un pull fallido: lanza, no marca, e invalida marca previa de la clave', async () => {
    await ensureWeekHydrated('o', { athleteId: 'ath_m', includeLegacy: false }, '2026-07-13')
    vi.mocked(syncService.pullWeekDayLogsForAthlete).mockRejectedValueOnce(new Error('net'))
    await expect(ensureWeekHydrated(
      'o', { athleteId: 'ath_m', includeLegacy: false }, '2026-07-13', { force: true },
    )).rejects.toThrow('net')
    expect(isWeekHydrated('o', 'ath_m', '2026-07-13')).toBe(false)
  })

  it('la marca no se comparte entre claves', async () => {
    await ensureWeekHydrated('o', { athleteId: 'ath_m', includeLegacy: false }, '2026-07-13')
    expect(isWeekHydrated('o', 'ath_m', '2026-07-20')).toBe(false)
    expect(isWeekHydrated('o', 'ath_otro', '2026-07-13')).toBe(false)
  })

  it('clear total y clear por atleta', async () => {
    await ensureWeekHydrated('o', { athleteId: 'ath_m', includeLegacy: false }, '2026-07-13')
    await ensureWeekHydrated('o', { athleteId: 'ath_x', includeLegacy: false }, '2026-07-13')
    clearCoachPlanningHydrationRegistry('ath_m')
    expect(isWeekHydrated('o', 'ath_m', '2026-07-13')).toBe(false)
    expect(isWeekHydrated('o', 'ath_x', '2026-07-13')).toBe(true)
    clearCoachPlanningHydrationRegistry()
    expect(isWeekHydrated('o', 'ath_x', '2026-07-13')).toBe(false)
  })

  it('epoch: un clear DURANTE la hidratación impide marcar (veto/limpieza concurrente)', async () => {
    vi.mocked(syncService.pullWeekSummaryRowForAthlete).mockImplementationOnce(async () => {
      clearCoachPlanningHydrationRegistry()
    })
    await ensureWeekHydrated('o', { athleteId: 'ath_m', includeLegacy: false }, '2026-07-13')
    expect(isWeekHydrated('o', 'ath_m', '2026-07-13')).toBe(false)
  })

  it('clear por atleta no invalida un in-flight de otro atleta', async () => {
    // Promesas controladas para ath_m/ath_x: clear('ath_m') impide la marca de M,
    // pero X completa y conserva su marca.
  })

  it('un outcome unavailable/vetoed no marca aunque no haya excepción de red', async () => {
    vi.mocked(syncService.pullWeekDayLogsForAthlete).mockResolvedValueOnce('unavailable')
    await expect(ensureWeekHydrated(
      'o', { athleteId: 'ath_m', includeLegacy: false }, '2026-07-13', { force: true },
    )).rejects.toThrow('No se pudo hidratar la semana')
    expect(isWeekHydrated('o', 'ath_m', '2026-07-13')).toBe(false)
  })

  it('refresh viejo no puede marcar después de que un refresh nuevo falló', async () => {
    // Dos force concurrentes con promesas controladas: el más nuevo falla y
    // deja la clave sin marca aunque el viejo complete más tarde.
  })

  it('sin force reutiliza marca e in-flight de la misma clave', async () => {
    // Dos ensures simultáneos disparan una sola terna de pulls.
  })
})
```

- [ ] **Step 2: Verificar que fallan.**

- [ ] **Step 3: Implementación**

```typescript
// src/services/athlete/coachPlanningHydration.ts
import {
  pullWeekSessionsForAthlete, pullWeekDayLogsForAthlete, pullWeekSummaryRowForAthlete,
} from '../syncService'
import type { AthleteWeekScope } from './athleteWeekScope'
import { assertActiveRosterAthlete, weekEndISO } from './coachScopedReads'
import {
  beginHydration, completeHydration, failHydration, finishHydration,
  getHydrationInFlight, hasHydrationMark, setHydrationInFlight,
} from './coachPlanningHydrationRegistry'
export {
  clearCoachPlanningHydrationRegistry, isWeekHydrated,
} from './coachPlanningHydrationRegistry'

/**
 * Registro service-owned de semanas hidratadas (spec D1). Singleton de módulo:
 * vive lo que la sesión de app. Clave: owner + athleteId + weekStart.
 * Sin marca, "no hay logs" y "logs no cacheados" son indistinguibles y el
 * recálculo escribiría promedios undefined.
 */
// Los Sets/Maps y clear viven en coachPlanningHydrationRegistry.ts, que no
// importa syncService. Este archivo orquesta pulls usando sus helpers internos.

export async function ensureWeekHydrated(
  ownerAccountId: string, scope: AthleteWeekScope, weekStartDate: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const athleteId = scope.athleteId
  if (!options.force && hasHydrationMark(ownerAccountId, athleteId, weekStartDate)) return
  const current = getHydrationInFlight(ownerAccountId, athleteId, weekStartDate)
  if (!options.force && current) return current
  const ticket = beginHydration(ownerAccountId, athleteId, weekStartDate)
  const opts = { includeLegacy: scope.includeLegacy }
  const end = weekEndISO(weekStartDate)
  const operation = (async () => {
    try {
      // R23/R31: primer await DEL IIFE — nunca antes de registrar el in-flight.
      await assertActiveRosterAthlete(ownerAccountId, athleteId)
      const outcomes = [
        await pullWeekSessionsForAthlete(ownerAccountId, athleteId, weekStartDate, end, opts),
        await pullWeekDayLogsForAthlete(ownerAccountId, athleteId, weekStartDate, end, opts),
        await pullWeekSummaryRowForAthlete(ownerAccountId, athleteId, weekStartDate, opts),
      ]
      if (outcomes.some((outcome) => outcome !== 'completed')) {
        throw new Error('No se pudo hidratar la semana completa. Actualizá e intentá de nuevo.')
      }
    } catch (error) {
      failHydration(ticket)
      throw error
    }
    completeHydration(ticket)
  })()
  setHydrationInFlight(ticket, operation)
  try { await operation } finally {
    finishHydration(ticket, operation)
  }
}

// clear/isWeekHydrated se re-exportan desde el registry cycle-free.
```

`coachPlanningHydrationRegistry.ts` implementa `HydrationTicket { key, registryEpoch, keyGeneration }`. `beginHydration` incrementa la generación de la clave y quita su marca; `completeHydration`/`failHydration` solo actúan si ticket y epochs siguen vigentes; `finishHydration` solo borra `inFlight` si la promesa aún es la de ese ticket. El clear total incrementa `registryEpoch`; el clear por atleta incrementa solo las generaciones de sus claves conocidas/in-flight y borra sus marcas, sin invalidar hidrataciones concurrentes de otros atletas. El módulo no importa `syncService`, stores ni leases.

Como defensa rápida y para un copy específico, antes de iniciar los pulls mantener el chequeo:

```typescript
import { hasAthleteDeleteTombstoneForAthlete } from '../sync/athleteDeleteTombstones'
if (hasAthleteDeleteTombstoneForAthlete(athleteId)) {
  throw new Error('Este atleta está siendo eliminado.')
}
```

**Validación de roster al hidratar (R23/R31):** `await assertActiveRosterAthlete(ownerAccountId, athleteId)` corre como **primer await DENTRO del IIFE `operation`** (dentro del `try`, antes de los tres pulls), nunca como await previo a `setHydrationInFlight`: si el assert se espera antes de registrar el in-flight, un `ensure` concurrente durante ese await no ve in-flight y dispara una segunda terna de pulls (rompe la deduplicación). Al vivir en el `try`, su fallo pasa por `failHydration(ticket)` y no deja marca. Los pulls escriben filas remotas en Dexie para el `athleteId` que reciban; sin este assert, la única defensa era el `getWeekSessionsForAthlete` previo del panel. Impacto en los tests de esta task: el `beforeEach` siembra `db.athletes` (patrón Dexie del proyecto: `db.close(); await db.delete(); await db.open()` + `bulkPut` de `ath_m`/`ath_x` activos con `ownerAccountId: 'o'`), y se agrega:

```typescript
it('rechaza athleteId fuera del roster o archivado sin iniciar pulls', async () => {
  await expect(ensureWeekHydrated('o', { athleteId: 'ath_ajeno', includeLegacy: false }, '2026-07-13'))
    .rejects.toThrow('El atleta no pertenece a tu roster.')
  expect(syncService.pullWeekSessionsForAthlete).not.toHaveBeenCalled()
})
```

**Wiring de invalidación** (todos importan `clearCoachPlanningHydrationRegistry` desde `coachPlanningHydrationRegistry.ts`, nunca desde el orquestador que importa sync):
- `useAuthStore.ts` → `signOut`: limpiar el registro **antes** del await remoto para no conservar marcas si `supabase.auth.signOut()` falla; limpiar también `setActiveAthleteId(null)`/`setSelfAthleteId(null)`. En `onAuthStateChange`, comparar el user id previo con el nuevo y repetir la limpieza cuando cambie la cuenta (incluido logout externo/refresh de sesión a otra cuenta).
- `appMaintenance.ts` → en `clearSelectedLocalAppData`, limpiar solo si `selection.trainingData` y antes de vaciar tablas.
- `dataExport.ts` → el import real es `importAppDataFromFile` (no vive en `appMaintenance`). Tras validar/leer el backup y antes de la transacción de **replace o merge**, limpiar el registro: ambos modos pueden cambiar sessions/dayLogs/summaries bajo una marca existente.
- `managedAthletes.ts` → en el flujo de borrado duro, junto a donde se registra el tombstone: `clearCoachPlanningHydrationRegistry(athleteId)`.

Agregar tests de wiring en `appMaintenance.test.ts`, `dataExportAthleteId.test.ts` (o el test de import existente), tests de auth para transición de cuenta, y `managedAthletes.delete.test.ts`; no basta con probar el singleton aislado.

- [ ] **Step 4: Verificar** — tests PASS; `npx vitest run src/store/__tests__ src/services` sin regresiones (si `useAuthStore` tiene tests de signOut, siguen verdes).

- [ ] **Step 5: Checkpoint** — Task 8 lista para commit del owner.

---

### Task 9: D2 — `coachScopedWrites.ts`

**Files:**
- Create: `src/services/athlete/coachScopedWrites.ts`
- Modify: `src/db/queries.ts` (agregar `recalculateWeekSummaryForAthlete`)
- Test: `src/services/athlete/__tests__/coachScopedWrites.test.ts`

**Interfaces:**
- Consumes: `assertActiveRosterAthlete` (Task 2), `resolveAthleteWeekScope` (Task 1; **una vez por operación**), `recalculateWeekSummaryCore` (Task 3), `draftToNewSessionFields`/`applyCoachSessionPatch` (Task 4), `runAthleteWrite`, `captureRemoteSessionTarget` (Task 6), `pushSessionForTarget`/`deleteSessionForTarget`/`rememberSessionDeleteTombstone`/`pushWeekSummaryForAthlete` (Tasks 6-7), `ensureWeekHydrated`/`isWeekHydrated` (Task 8; reciben/verifican el scope ya resuelto). No usar `resolveAuthoredByRole`: depende del holder global; la autoría sale de `scope.includeLegacy`.
- Produces:
  ```typescript
  export async function createSessionForAthlete(ownerAccountId: string, athleteId: string, values: CoachSessionDraft): Promise<Session>
  export async function updateSessionForAthlete(ownerAccountId: string, athleteId: string, sessionId: string, patch: CoachSessionPatch): Promise<Session>
  export async function deleteSessionForAthlete(ownerAccountId: string, athleteId: string, sessionId: string): Promise<void>
  // queries.ts:
  export const recalculateWeekSummaryForAthlete: (ownerAccountId: string, athleteId: string, dateISO: string) => Promise<void>
  ```

- [ ] **Step 1: Tests que fallan** (mockear `syncService` completo con `vi.mock`; Dexie real con fake-indexeddb; `ensureWeekHydrated` se puentea marcando las semanas via mock de los pulls o `vi.mock` de `coachPlanningHydration` — elegí mockear `coachPlanningHydration` para que los tests de writes no dependan de sync):

Casos obligatorios (spec Tests §1):

```typescript
// setup común: owner 'user-1', self 'ath_user-1' (holder seteado), gestionado 'ath_m' activo,
// archivado 'ath_arch', vi.mock('../coachPlanningHydration', ...) con
// ensureWeekHydrated resuelto e isWeekHydrated=true para las claves preparadas.

it('create estampa el athleteId del parámetro con OTRO atleta activo', async () => {
  setActiveAthleteId('ath_user-1') // activo = self del coach
  const created = await createSessionForAthlete('user-1', 'ath_m', draft)
  expect(created.athleteId).toBe('ath_m')
  expect((await db.sessions.get(created.id))?.athleteId).toBe('ath_m')
})

it('authoredByRole coach para gestionado, self para el self', async () => { /* derivado del scope */ })

it('authoredByRole sigue correcto con holder self null y membresía self reclamada', async () => {
  // Gestionado => coach; self reclamado => self. El servicio no relee el holder global.
})

it('create deriva weekStartDate y setea source coach', async () => {
  const created = await createSessionForAthlete('user-1', 'ath_m', { ...draft, date: '2026-07-15' })
  expect(created.weekStartDate).toBe('2026-07-13')
  expect(created.source).toBe('coach')
})

it('update preserva authoredByRole y rechaza campos prohibidos', async () => {
  // patch con (as never) id/athleteId/status → la fila resultante los ignora
})

it('update/delete rechazan sessionId de otro atleta del roster', async () => {
  await expect(updateSessionForAthlete('user-1', 'ath_m', idDeSesionDelSelf, { title: 'x' }))
    .rejects.toThrow()
  // y cero writes: la sesión del self quedó intacta
})

it('rechaza archivado, fuera de roster y tombstoned', async () => { /* 3 asserts, cero writes */ })

it('revalidación dentro de la tx: archivar entre el precheck y la escritura falla', async () => {
  // mock de assertActiveRosterAthlete NO — en cambio: escribir status archived en db.athletes
  // desde un hook en ensureWeekHydrated mockeado (corre después del precheck) → rejects, sesión no existe
})

it('update con cambio de fecha recalcula AMBAS semanas y re-deriva weekStartDate', async () => {
  const created = await createSessionForAthlete('user-1', 'ath_m', { ...draft, date: '2026-07-14' })
  await updateSessionForAthlete('user-1', 'ath_m', created.id, { date: '2026-07-21' })
  const row = await db.sessions.get(created.id)
  expect(row?.weekStartDate).toBe('2026-07-20')
  const w1 = await db.weekSummaries.where('[athleteId+weekStartDate]').equals(['ath_m', '2026-07-13']).first()
  const w2 = await db.weekSummaries.where('[athleteId+weekStartDate]').equals(['ath_m', '2026-07-20']).first()
  expect(w1?.plannedSessions).toBe(0)
  expect(w2?.plannedSessions).toBe(1)
})

it('update sin cambio de fecha preserva weekStartDate y renueva updatedAt', async () => { ... })

it('update puede limpiar opcionales con claves presentes en undefined', async () => { ... })

it('hidratación que reemplaza la sesión obliga a aplicar el patch sobre la fila nueva', async () => {
  // El pull cambia title/details/updatedAt; el update conserva esos datos no editados.
})

it('si la fecha original cambia durante hidratación, hidrata la nueva semana o reintenta sin mutar', async () => { ... })

it('dos updates locales concurrentes no reconstruyen desde snapshots previos al lease', async () => { ... })

it('fallo inyectado en el recálculo → rollback total, cero pushes', async () => {
  // vi.spyOn sobre recalculateWeekSummaryCore vía import * as queries → mockRejectedValueOnce
  // assert: db.sessions no tiene la fila; pushSessionForTarget no llamado
})

it('delete: tombstone ANTES del push remoto', async () => {
  // spy sobre rememberSessionDeleteTombstone y deleteSessionForTarget:
  // assert de orden con mock.invocationCallOrder
})

it('los pushes post-commit usan el target capturado y solo summaries changed', async () => { ... })

it('precondición: ensureWeekHydrated rechazado → no muta', async () => {
  vi.mocked(hydration.ensureWeekHydrated).mockRejectedValueOnce(new Error('offline'))
  await expect(createSessionForAthlete('user-1', 'ath_m', draft)).rejects.toThrow('offline')
  expect(await db.sessions.count()).toBe(0)
})

it('invalidación concurrente de la marca antes de la tx rehidrata; nunca recalcula a ciegas', async () => {
  // Tras resolver el primer ensure, limpiar la clave antes de que abra la tx.
  // El primer intento aborta con HydrationScopeChangedError, el segundo vuelve
  // a hidratar y solo entonces escribe. Si los tres intentos pierden la marca,
  // rechaza con copy público y db.sessions sigue sin cambios.
})

it('update con cambio de fecha exige hidratación de la semana DESTINO además de la original', async () => {
  // assert: ensureWeekHydrated llamado con owner + MISMO scope resuelto + ambas semanas.
})
```

- [ ] **Step 2: Verificar que fallan.**

- [ ] **Step 3: Implementación**

```typescript
// src/services/athlete/coachScopedWrites.ts
import { db } from '../../db/db'
import type { Session, WeekSummary } from '../../types'
import { toISO, getWeekStart, fromISO } from '../../utils/date'
import { assertActiveRosterAthlete } from './coachScopedReads'
import { resolveAthleteWeekScope, type AthleteWeekScope } from './athleteWeekScope'
import { recalculateWeekSummaryCore } from '../../db/queries'
import { applyCoachSessionPatch, draftToNewSessionFields } from './coachSessionSerializer'
import type { CoachSessionDraft, CoachSessionPatch } from './coachSessionSerializer'
import { isScopedAthleteId } from './effectiveAthleteKey'
import { runAthleteWrite } from '../sync/athleteWriteLease'
import { captureRemoteSessionTarget, type RemoteSessionTarget } from '../sync/remoteSessionTarget'
import {
  deleteSessionForTarget, pushSessionForTarget, pushWeekSummaryForAthlete,
  rememberSessionDeleteTombstone,
} from '../syncService'
import { ensureWeekHydrated, isWeekHydrated } from './coachPlanningHydration'
import { v4 as uuid } from '../../utils/uuid'

const weekOf = (dateISO: string) => toISO(getWeekStart(fromISO(dateISO)))
const nextUpdatedAt = (previous: number | undefined) => Math.max(Date.now(), (previous ?? 0) + 1)

const LEASE_VETO_MESSAGE = 'Este atleta está siendo eliminado.'

/** Revalida dentro del lease/tx: cierra la carrera precheck→await→write (spec D2). */
async function revalidateActiveAthleteInTx(ownerAccountId: string, athleteId: string): Promise<void> {
  const row = await db.athletes.get(athleteId)
  if (!row || row.ownerAccountId !== ownerAccountId) throw new Error('El atleta no pertenece a tu roster.')
  if (row.status !== 'active') throw new Error('Este atleta está archivado; restauralo para editar su semana.')
}

class HydrationScopeChangedError extends Error {}

async function loadOwnedSession(scope: AthleteWeekScope, sessionId: string): Promise<Session> {
  const row = await db.sessions.get(sessionId)
  const owned = row && (
    row.athleteId === scope.athleteId ||
    (scope.includeLegacy && !isScopedAthleteId(row.athleteId))
  )
  if (!owned) throw new Error('La sesión no pertenece a este atleta.')
  return row
}

export async function createSessionForAthlete(
  ownerAccountId: string, athleteId: string, values: CoachSessionDraft,
): Promise<Session> {
  await assertActiveRosterAthlete(ownerAccountId, athleteId)
  const scope = await resolveAthleteWeekScope(ownerAccountId, athleteId)
  const now = Date.now()
  const session: Session = {
    ...draftToNewSessionFields(values),
    id: uuid(),
    athleteId,
    authoredByRole: scope.includeLegacy ? 'self' : 'coach',
    createdAt: now,
    updatedAt: now,
  } as Session

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await ensureWeekHydrated(ownerAccountId, scope, weekOf(values.date))
    let changedSummaries: WeekSummary[] = []
    try {
      const wrote = await runAthleteWrite(athleteId, async () => {
        await db.transaction('rw', db.sessions, db.dayLogs, db.weekSummaries, db.athletes, async () => {
          await revalidateActiveAthleteInTx(ownerAccountId, athleteId)
          if (!isWeekHydrated(ownerAccountId, athleteId, weekOf(values.date))) {
            throw new HydrationScopeChangedError()
          }
          await db.sessions.add(session)
          const result = await recalculateWeekSummaryCore(scope, session.date)
          changedSummaries = result.changed ? [result.summary] : []
        })
      })
      if (!wrote) throw new Error(LEASE_VETO_MESSAGE)

      void pushSessionForTarget(
        session,
        captureRemoteSessionTarget(session, ownerAccountId, scope.athleteId),
      )
      for (const summary of changedSummaries) void pushWeekSummaryForAthlete(summary)
      return session
    } catch (error) {
      if (!(error instanceof HydrationScopeChangedError)) throw error
      if (attempt === 2) {
        throw new Error('La semana cambió mientras guardábamos. Actualizá e intentá de nuevo.')
      }
    }
  }
  throw new Error('La semana cambió mientras guardábamos. Actualizá e intentá de nuevo.')
}

// El bloque de update representa el cuerpo de UN intento. La función pública
// lo envuelve con el mismo loop acotado detallado después del snippet.
export async function updateSessionForAthlete(
  ownerAccountId: string, athleteId: string, sessionId: string, patch: CoachSessionPatch,
): Promise<Session> {
  await assertActiveRosterAthlete(ownerAccountId, athleteId)
  const scope = await resolveAthleteWeekScope(ownerAccountId, athleteId)
  let existing = await loadOwnedSession(scope, sessionId)
  const originalWeek = weekOf(existing.date)
  await ensureWeekHydrated(ownerAccountId, scope, originalWeek)
  // El pull puede haber actualizado la fila: re-leer antes de derivar destino/target.
  existing = await loadOwnedSession(scope, sessionId)
  const hydratedOriginalWeek = weekOf(existing.date)
  if (hydratedOriginalWeek !== originalWeek) {
    await ensureWeekHydrated(ownerAccountId, scope, hydratedOriginalWeek)
    existing = await loadOwnedSession(scope, sessionId)
  }
  const nextDate = patch.date ?? existing.date
  const targetWeek = weekOf(nextDate)
  if (targetWeek !== hydratedOriginalWeek) await ensureWeekHydrated(ownerAccountId, scope, targetWeek)

  let target: RemoteSessionTarget | null = null
  let updated: Session | null = null

  let changedSummaries: WeekSummary[] = []
  const wrote = await runAthleteWrite(athleteId, async () => {
    await db.transaction('rw', db.sessions, db.dayLogs, db.weekSummaries, db.athletes, async () => {
      await revalidateActiveAthleteInTx(ownerAccountId, athleteId)
      const current = await loadOwnedSession(scope, sessionId)
      const currentOriginalWeek = weekOf(current.date)
      if (!isWeekHydrated(ownerAccountId, athleteId, currentOriginalWeek)
          || !isWeekHydrated(ownerAccountId, athleteId, weekOf(patch.date ?? current.date))) {
        throw new HydrationScopeChangedError()
      }
      target = captureRemoteSessionTarget(current, ownerAccountId, scope.athleteId)
      const dateChanged = patch.date !== undefined && patch.date !== current.date
      updated = {
        ...applyCoachSessionPatch(current, patch),
        weekStartDate: dateChanged ? weekOf(patch.date!) : current.weekStartDate,
        updatedAt: nextUpdatedAt(current.updatedAt),
      }
      await db.sessions.put(updated)
      const results = [await recalculateWeekSummaryCore(scope, current.date)]
      if (dateChanged && weekOf(patch.date!) !== currentOriginalWeek) {
        results.push(await recalculateWeekSummaryCore(scope, patch.date!))
      }
      changedSummaries = results.filter((r) => r.changed).map((r) => r.summary)
    })
  })
  if (!wrote) throw new Error(LEASE_VETO_MESSAGE)

  void pushSessionForTarget(updated!, target!)
  for (const summary of changedSummaries) void pushWeekSummaryForAthlete(summary)
  return updated!
}

// Igual que update: este es el cuerpo de un intento; HydrationScopeChangedError
// se captura en el loop público y nunca se expone al modal.
export async function deleteSessionForAthlete(
  ownerAccountId: string, athleteId: string, sessionId: string,
): Promise<void> {
  await assertActiveRosterAthlete(ownerAccountId, athleteId)
  const scope = await resolveAthleteWeekScope(ownerAccountId, athleteId)
  const existing = await loadOwnedSession(scope, sessionId)
  await ensureWeekHydrated(ownerAccountId, scope, weekOf(existing.date))

  let target: RemoteSessionTarget | null = null

  let changedSummaries: WeekSummary[] = []
  const wrote = await runAthleteWrite(athleteId, async () => {
    await db.transaction('rw', db.sessions, db.dayLogs, db.weekSummaries, db.athletes, async () => {
      await revalidateActiveAthleteInTx(ownerAccountId, athleteId)
      const current = await loadOwnedSession(scope, sessionId)
      if (!isWeekHydrated(ownerAccountId, athleteId, weekOf(current.date))) {
        throw new HydrationScopeChangedError()
      }
      target = captureRemoteSessionTarget(current, ownerAccountId, scope.athleteId)
      await db.sessions.delete(sessionId)
      const result = await recalculateWeekSummaryCore(scope, current.date)
      changedSummaries = result.changed ? [result.summary] : []
    })
  })
  if (!wrote) throw new Error(LEASE_VETO_MESSAGE)

  // Orden del tombstone (spec D2 rev.5): commit local → tombstone → recién push remoto.
  rememberSessionDeleteTombstone(ownerAccountId, sessionId)
  void deleteSessionForTarget(sessionId, target!)
  for (const summary of changedSummaries) void pushWeekSummaryForAthlete(summary)
}
```

**Control de carrera obligatorio para create/update/delete:** create muestra el loop completo; los bloques de update/delete muestran qué ocurre en un intento. Envolver su preparación + fase local en el mismo loop acotado (máximo 3). `HydrationScopeChangedError` es interno y nunca se expone al modal:

1. leer la fila actual y calcular semanas original/destino;
2. hidratar las faltantes con el **mismo** `scope`;
3. entrar al lease/transacción, re-leer la fila cuando corresponda y verificar `isWeekHydrated` para **todas** las semanas que el intento exige (create incluida);
4. si cambió alguna semana, abortar esa transacción con `HydrationScopeChangedError`, hidratar la nueva clave fuera de la transacción y reintentar;
5. después de 3 cambios/invalidationes consecutivos, fallar con copy estable y público (`La sesión cambió mientras la actualizábamos. Volvé a intentarlo.` para update/delete; el copy de semana de create mostrado arriba) sin mutación parcial.

El target remoto, el patch y la fecha a recalcular se capturan desde `current` **dentro del intento que hace commit**. No reutilizar `existing` leído antes de hidratación. Esta estructura también evita lost updates entre dos llamadas locales: cada transacción aplica el patch acotado sobre la fila que existe al obtener el turno Dexie.

Para update sin cambio de fecha, preservar `current.weekStartDate` literalmente (incluido `undefined` legacy); solo al cambiar `date` usar `weekOf(patch.date)`. `updatedAt` usa `nextUpdatedAt(current.updatedAt)`.

`recalculateWeekSummaryForAthlete` en `queries.ts` (consumidor standalone, spec D1):

```typescript
export const recalculateWeekSummaryForAthlete = async (
  ownerAccountId: string, athleteId: string, dateISO: string,
): Promise<void> => {
  const scope = await resolveAthleteWeekScope(ownerAccountId, athleteId)
  const { summary, changed } = await recalculateWeekSummaryCore(scope, dateISO)
  if (changed) void syncService.pushWeekSummaryForAthlete(summary)
}
```

(cuidado con el ciclo de imports queries↔athleteWeekScope: `athleteWeekScope` no importa queries, así que no hay ciclo).

- [ ] **Step 4: Verificar** — `npx vitest run src/services/athlete/__tests__/coachScopedWrites.test.ts` PASS; luego `npx vitest run src/services src/db` verde.

- [ ] **Step 5: Checkpoint** — Task 9 lista para commit del owner.

---

### Task 10: Regresión de `AddSessionModal` ANTES de extraer

**Files:**
- Modify: `package.json`, `package-lock.json` (dev-only test infra)
- Test: `src/components/session/AddSessionModal.test.tsx` (create)

**Interfaces:**
- Consumes: `AddSessionModal` actual (props `{ defaultDate?, onClose }`), `useTrainingStore`.

- [ ] **Step 1: Infra de interacción verificada.** El repo solo tiene tests SSR con `renderToStaticMarkup`; no hay jsdom ni Testing Library, y SSR no puede disparar submit/doble click/backdrop ni observar errores stateful. Instalar como **devDependencies** (no entran al bundle de producción):

Run: `npm install -D @testing-library/react @testing-library/user-event jsdom`

Los archivos interactivos nuevos usan `// @vitest-environment jsdom`. Mantener los tests SSR existentes donde alcancen. Verificar en Task 14 que el bundle de producción no incorpora estos paquetes.

- [ ] **Step 2: Escribir la regresión sobre el componente ACTUAL** (spec Riesgos: se escribe antes de extraer y debe pasar sin cambios después), usando Testing Library + `userEvent`:

```tsx
// Casos mínimos:
// 1. render: título "Sesion de squash" (defaultType squash sin perfil), inputs presentes
//    y defaultDate se refleja en el input date
// 2. submit con título → addSession llamado con { source: 'manual', status: 'planned', type: 'squash', ... }
//    (mock de useTrainingStore con addSession espía; mock de useCoachMemoryStore devolviendo {})
// 3. submit sin título → addSession NO llamado
// 4. cambio de tipo a running → addSession recibe runningDetails con runningType
```

La revisión de impacto queda documentada: son dependencias dev-only y no se importan desde `src/` productivo. No reemplazar estos casos por assertions estáticas; no verificarían la regresión de submit que mitiga el riesgo de extraer 705 líneas.

- [ ] **Step 3: Verificar que PASA sobre el componente actual** — `npx vitest run src/components/session/AddSessionModal.test.tsx`

- [ ] **Step 4: Checkpoint** — Task 10 lista para commit del owner.

---

### Task 11: D4 — Extracción de `SessionForm` + `AddSessionModal` wrapper

**Files:**
- Create: `src/components/session/SessionForm.tsx`
- Modify: `src/components/session/AddSessionModal.tsx`
- Test: `src/components/session/SessionForm.test.tsx` (create); `AddSessionModal.test.tsx` debe pasar SIN cambios

**Interfaces:**
- Consumes: `CoachSessionDraft` (Task 4), `SESSION_TYPE_CONFIG`, constantes visuales del modal actual.
- Produces:
  ```typescript
  interface SessionFormProps {
    initialValues?: CoachSessionDraft
    defaultSport: SessionType
    defaultDate?: string
    heading: string
    submitLabel: string
    /** async: el caller espera el resultado; el form deshabilita submit mientras tanto */
    onSubmit: (values: CoachSessionDraft) => Promise<void>
    onCancel: () => void
  }
  // Sin anotación de retorno (R32): React 19 no tiene namespace global JSX y el
  // repo usa inferencia en todos los componentes.
  export default function SessionForm(props: SessionFormProps)
  ```

- [ ] **Step 1: Extraer.** Mover TODO el contenido interno del contenedor: **header actual con título/X**, estados (líneas 158-181), handlers (187-254) y campos/botón. Solo overlay y caja scrollable quedan en los wrappers. El header usa `heading`; el X llama `onCancel`, tiene `type="button"`, `aria-label="Cerrar"` y queda disabled mientras `isSubmitting`. Así `onCancel` no es una prop muerta y `AddSessionModal` conserva su header exacto.
  - Estado inicial desde `initialValues` cuando existe (modo edición): mapear `CoachSessionDraft` → estados (`type`, `title`, `date`, `timeBlock`, `duration`, `rpe`, `objective`, `notes`, `location`, `runningType`+targets desde `runningTargets`, `squashSubtype`/`opponent`/`matchResult`/`gamesWon`/`gamesLost`, `exercises` con `sets`/`weight` a string). En create, fecha = `defaultDate ?? todayISO()`; esta prop es necesaria para no perder el contrato actual de `AddSessionModal`.
  - `handleSubmit` construye un `CoachSessionDraft` (NO una Session): los campos visibles tal cual, `exercises` con `sets: Number(...) || 3` **y `reps: reps.trim() || '10'`** (mismo default del `buildExercises` actual — R28; el serializer re-aplica trim/default de reps y notes como autoridad, R33), `runningTargets` solo para running/cycling. **No** llama `generateDefaultProtocols` ni `build*Draft` — eso es del serializer (Task 4).
  - `await onSubmit(draft)` dentro de try/catch: en error, mostrar `<p role="alert">` con el mensaje y NO cerrar; deshabilitar botón mientras `isSubmitting`.
  - Sin stores adentro. Sin `onClose` directo: `onCancel`.
- [ ] **Step 2: `AddSessionModal` queda como wrapper** (comportamiento idéntico):

```tsx
export default function AddSessionModal({ defaultDate, onClose }: Props) {
  const { addSession } = useTrainingStore()
  const { athleteProfile } = useCoachMemoryStore()
  const defaultType = (athleteProfile?.sportContext?.primarySport as SessionType | undefined) ?? 'squash'

  return (
    <div /* shell del modal: overlay + contenedor, líneas 304-310 actuales */>
      <SessionForm
        defaultSport={defaultType}
        defaultDate={defaultDate}
        heading="Nueva sesion"
        submitLabel="Agregar sesion" /* copy actual exacto */
        onCancel={onClose}
        onSubmit={async (draft) => {
          await addSession({ ...draftToNewSessionFields(draft), source: 'manual' })
          onClose()
        }}
      />
    </div>
  )
}
```

`draftToNewSessionFields` setea `source: 'coach'`; el wrapper lo pisa con `'manual'` para conservar el comportamiento actual del modal del atleta (línea 268 actual).

- [ ] **Step 3: Verificar la regresión intacta** — `npx vitest run src/components/session/` → `AddSessionModal.test.tsx` PASS **sin ediciones**. Si necesitó cambios, la extracción rompió comportamiento: arreglar la extracción, no el test.

- [ ] **Step 4: Tests de `SessionForm`**: render con `initialValues` (modo edición) precarga campos; submit produce draft acotado (sin `warmup`/`squashDetails`/`status` — assert de las keys del draft); error de `onSubmit` deja el form abierto con el mensaje.

Agregar además: `defaultDate` se usa en create; limpiar objetivo/RPE/datos de partido produce un draft con `undefined` que luego `draftToPatch` conserva como **clave presente**; durante submit los controles de submit/cancel están disabled. Estos son tests jsdom interactivos, no SSR.

- [ ] **Step 5: Verificar** — `npx vitest run src/components` verde; `npm run lint`.

- [ ] **Step 6: Checkpoint** — Task 11 lista para commit del owner.

---

### Task 12: D6 — `CoachSessionModal` con guard de doble submit

**Files:**
- Create: `src/components/coach/CoachSessionModal.tsx`
- Test: `src/components/coach/CoachSessionModal.test.tsx`

**Interfaces:**
- Consumes: `SessionForm` (Task 11), `createSessionForAthlete`/`updateSessionForAthlete` (Task 9), `getAthleteProfileForAthlete` (Task 2), `CoachSessionDraft`.
- Produces:
  ```typescript
  interface CoachSessionModalProps {
    ownerAccountId: string
    athleteId: string
    defaultDate: string
    session?: Session          // presente = modo edición
    onClose: () => void
    onSaved: () => void        // el panel recarga la semana
  }
  // Sin anotación de retorno (R32): inferencia, como el resto del codebase.
  export default function CoachSessionModal(props: CoachSessionModalProps)
  ```

- [ ] **Step 1: Tests que fallan:**

```tsx
// 1. doble click en submit → createSessionForAthlete llamado UNA vez (guard de ref síncrono)
// 2. error del servicio → modal sigue montado, mensaje visible, botón re-habilitado
// 3. modo edición: sessionToDraft(session) precarga el form; submit llama updateSessionForAthlete
//    con SOLO los campos del patch (nunca una Session completa)
// 4. defaultSport sale de getAthleteProfileForAthlete (mock), fallback 'squash'
//    y prioriza sportContext.primarySport sobre primarySport legacy
// 5. backdrop/cancel deshabilitados durante submit, incluido un click en el mismo tick
// 6. create conserva defaultDate al montar el form
```

Para el caso 1 usar dos `fireEvent.click(button)` consecutivos sin `await` entre medio y mantener la promesa del servicio pendiente; `userEvent.dblClick` puede serializar eventos después del rerender disabled y no ejercitar la reentrada en el mismo tick.

- [ ] **Step 2: Implementación**

```tsx
export default function CoachSessionModal({ ownerAccountId, athleteId, defaultDate, session, onClose, onSaved }: CoachSessionModalProps) {
  const [defaultSport, setDefaultSport] = useState<SessionType | null>(session?.type ?? null)
  const submittingRef = useRef(false)          // guard SÍNCRONO (spec D6: el lease no es mutex)

  useEffect(() => {
    if (session) return
    let cancelled = false
    void getAthleteProfileForAthlete(ownerAccountId, athleteId).then((profile) => {
      if (!cancelled) {
        setDefaultSport((profile?.sportContext?.primarySport ?? profile?.primarySport ?? 'squash') as SessionType)
      }
    }).catch(() => {
      if (!cancelled) setDefaultSport('squash')
    })
    return () => { cancelled = true }
  }, [ownerAccountId, athleteId, session])

  const handleSubmit = async (draft: CoachSessionDraft) => {
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      if (session) await updateSessionForAthlete(ownerAccountId, athleteId, session.id, draftToPatch(draft, session))
      else await createSessionForAthlete(ownerAccountId, athleteId, draft)
      onSaved()
      onClose()
    } finally {
      submittingRef.current = false
    }
    // `finally` no traga el error: la promesa sigue rechazada y SessionForm lo muestra.
  }

  const requestClose = () => {
    if (submittingRef.current) return // ref, no state: cubre reentrada en el mismo tick
    onClose()
  }

  if (!defaultSport) return <p role="status">Preparando formulario…</p>

  return (
    <div className="fixed inset-0 z-50 ..."> {/* mismo shell visual que AddSessionModal */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm"
           onClick={requestClose} />
      <div className="relative ...">
        <SessionForm
          initialValues={session ? sessionToDraft(session) : undefined}
          defaultSport={defaultSport}
          defaultDate={defaultDate}
          heading={session ? 'Editar sesion' : 'Nueva sesion'}
          submitLabel={session ? 'Guardar cambios' : 'Agregar sesión'}
          onSubmit={handleSubmit}
          onCancel={requestClose}
        />
      </div>
    </div>
  )
}
```

En create, no montar `SessionForm` hasta resolver el perfil/fallback: `useState(defaultSport)` del form solo se evalúa al montar y no adoptaría un valor async posterior. `initialValues` se usa únicamente en edit; en create alcanzan `defaultSport` + `defaultDate` (eliminar `emptyDraftDefaults` si no existe realmente).

`sessionToDraft(session: Session): CoachSessionDraft` y `draftToPatch(draft, original): CoachSessionPatch` van en `coachSessionSerializer.ts` — agregar sus tests allí: `sessionToDraft` mapea `runningDetails` → `runningTargets` y ejercicios → drafts con sus `id`s; `draftToPatch` de un draft idéntico al original → `{}`. La comparación de `runningTargets`/`exercises` es estructural y determinística. Si un valor opcional existía y el draft lo limpió, el resultado contiene la clave con `undefined` (no la omite), en línea con R2.

**Regla de `draftToPatch` (R21):** el diff "solo claves cuyo valor difiere" aplica únicamente cuando `draft.type === original.type`. Si el tipo cambió, `draftToPatch` devuelve el **draft completo** (todas las claves visibles, aunque su valor coincida con el original): la rama de cambio de tipo del serializer regenera la sesión solo desde el patch, y un patch diffeado perdería paces idénticos (cycling→running) o eliminaría ejercicios idénticos (strength↔mobility). Tests:

```typescript
it('draftToPatch con cambio de tipo emite el draft completo (R21)', () => {
  const original = sessionToDraft(cyclingSession) // runningTargets { runningType: 'z2', targetPaceMin: '4:50' }
  const patch = draftToPatch({ ...original, type: 'running' }, cyclingSession)
  expect(patch.type).toBe('running')
  expect(patch.runningTargets).toEqual(original.runningTargets) // idénticos pero presentes
})

it('cambio strength→mobility conserva los ejercicios con TODA su metadata (R21+R29, end-to-end)', () => {
  const patch = draftToPatch({ ...sessionToDraft(strengthSession), type: 'mobility' }, strengthSession)
  expect(patch.exercises).toHaveLength(strengthSession.exercises!.length)
  const result = applyCoachSessionPatch(strengthSession, patch)
  // No alcanza comparar nombres: el merge por id debe conservar la metadata no editable.
  for (const original of strengthSession.exercises!) {
    const after = result.exercises?.find((e) => e.id === original.id)
    expect(after).toMatchObject({
      name: original.name,
      completed: original.completed,
      warmupSets: original.warmupSets,
      group: original.group,
      targetPercent1RM: original.targetPercent1RM,
    })
  }
})
```

- [ ] **Step 3: Verificar** — tests del modal PASS.

- [ ] **Step 4: Checkpoint** — Task 12 lista para commit del owner.

---

### Task 13: D6 — Panel: siete días, CTAs, borrar con confirmación, banner, gate

**Files:**
- Modify: `src/components/coach/CoachPlanningPanel.tsx`
- Modify: `src/pages/CoachWorkspacePage.tsx` (solo si hace falta pasar props nuevas — el panel ya recibe `ownerAccountId`)
- Test (modify): el test existente del panel (buscar `CoachPlanningPanel` en `src/components/coach/*.test.tsx`)

**Interfaces:**
- Consumes: `CoachSessionModal` (Task 12), `deleteSessionForAthlete` (Task 9), `hasRecordedWork` (Task 4), `ConfirmDialog` (`src/components/ui/ConfirmDialog.tsx`, props `{ open, title, message, confirmLabel?, cancelLabel?, destructive?, isLoading?, onConfirm, onCancel }`), `ensureWeekHydrated`/`isWeekHydrated` (Task 8), `getWeekSessionsForAthlete`.

- [ ] **Step 1: Tests que fallan.** Mantener SSR para estructura simple, pero usar Testing Library/jsdom para clicks, delete async y estado del diálogo. Agregar prop solo-test `initialCanMutate?: boolean` (análoga a `initialSessions`/`initialPhase`) para que SSR no dependa de efectos ni de un singleton global sembrado:

```tsx
// 1. semana vacía con phase 'ready' → SIETE encabezados de día visibles, cada uno con "+ Agregar sesión"
// 2. cache stale (`initialPhase='ready'`, `initialNotice=true`, `initialCanMutate=false`)
//    → CTAs con disabled + hint "Actualizá la semana para editar."
// 3. sesión con hasRecordedWork → click borrar abre ConfirmDialog con el copy
//    "Esta sesión tiene trabajo registrado del atleta; se borrará también ese registro."
// 4. sesión planned limpia → borrar NO abre ConfirmDialog (borrado directo)
// 5. fallo del delete local → banner role="alert" en el panel; ConfirmDialog sigue open con isLoading false
// 6. (R27, jsdom) doble click en "Borrar" de una sesión planned limpia en el mismo tick,
//    con la promesa del servicio pendiente → deleteSessionForAthlete llamado UNA vez
```

- [ ] **Step 2: Implementación.** Cambios en `CoachPlanningPanel.tsx`:

1. **Hidratación con marca:** en `load()`, reemplazar `hydrateWeekForAthlete` por el resolver + `ensureWeekHydrated(ownerAccountId, scope, week, { force: true })` (que ya incluye el pull de sesiones); mantener el manejo actual de fases. Estado nuevo `const [canMutate, setCanMutate] = useState(initialCanMutate ?? false)`, seteado a `isWeekHydrated(ownerAccountId, athleteId, week)` tras cada load (éxito o fallo).
   - Resolver `scope = await resolveAthleteWeekScope(ownerAccountId, athleteId)` una vez por load y llamar `ensureWeekHydrated(ownerAccountId, scope, week, { force: true })`.
   - Inicializar `canMutate` con `initialCanMutate ?? false` en test mode.
   - Hacer `setCanMutate(false)` al comenzar load/retry/selección; una marca previa no puede dejar CTAs activos mientras el refresh forzado está en curso.
   - Un error sin cache puede seguir mostrando solo el bloque de error/retry; el caso “CTAs visibles pero disabled” es el cache stale, no `phase='error'`.
2. **Siete días:** en el render `phase === 'ready'`, quitar el filtro `daySessions.length > 0 &&` y el bloque `isEmpty`; cada día renderiza su encabezado + sesiones + botón:
   ```tsx
   <button type="button" disabled={isLocked || !canMutate}
           onClick={() => setModal({ mode: 'create', date })}
           className="mt-1 text-xs font-semibold text-brand underline disabled:opacity-50">
     + Agregar sesión
   </button>
   {!canMutate && <span className="text-xs text-ink-muted">Actualizá la semana para editar.</span>}
   ```
   (el hint una sola vez arriba de la grilla, no por día — elegí arriba de la grilla).
3. **Por sesión:** botones "Editar" (abre `setModal({ mode: 'edit', session })`) y "Borrar". Borrar:
   ```tsx
   function requestDelete(session: Session) {
     if (hasRecordedWork(session)) setConfirmTarget(session)
     else void performDelete(session)
   }
   async function performDelete(session: Session) {
     // Guard síncrono (R27): `deleting` es state y no cubre dos clicks en el
     // mismo tick — el segundo delete fallaría con un banner confuso.
     if (deletingRef.current) return
     deletingRef.current = true
     setDeleteError(null)
     setDeleting(true)
     try {
       await deleteSessionForAthlete(ownerAccountId, selectedId!, session.id)
       setConfirmTarget(null)
       await reload()
     } catch (error) {
       setDeleteError(error instanceof Error ? error.message : 'No se pudo borrar la sesión.')
       // ConfirmDialog permanece abierto (spec D6 rev.5); isLoading vuelve a false
     } finally {
       deletingRef.current = false
       setDeleting(false)
     }
   }
   ```
   (`const deletingRef = useRef(false)` junto al resto del estado del panel.)
   `ConfirmDialog` con `destructive`, `isLoading={deleting}`, `message="Esta sesión tiene trabajo registrado del atleta; se borrará también ese registro."`.
   Los botones Editar/Borrar llevan el mismo `disabled={isLocked || !canMutate}` que Agregar.
4. **Banner de error de delete:** `{deleteError && <div role="alert" className=/* mismo patrón visual del error de carga */>{deleteError}</div>}`.
5. **Modal:** estado `modal: { mode: 'create'; date: string } | { mode: 'edit'; session: Session } | null`; render de `CoachSessionModal` con `onSaved={reload}` donde `reload()` re-lee `getWeekSessionsForAthlete` y refresca `canMutate`.
   `reload()` post-mutación es local-only: no fuerza un pull remoto inmediatamente antes de que termine el push fire-and-forget.
6. `pendingAction` sigue deshabilitando todo, pero agregar lock local: `isLocked = pendingAction !== null || deleting || modal !== null` (ajustar el botón que cierra/usa el propio modal). Sin esto se pueden iniciar dos deletes porque las mutaciones del panel no actualizan `pendingAction` del workspace.
7. Al cambiar atleta/semana y al comenzar un retry, limpiar `deleteError`, `confirmTarget` y modal para que un error de A no aparezca bajo B.
8. **(R24)** Con el panel migrado a `ensureWeekHydrated`, `hydrateWeekForAthlete` queda sin consumidores productivos: eliminar el export y su import en el panel; migrar/retirar sus tests hacia los de `ensureWeekHydrated` (Task 8). Si algún otro consumidor apareció entre medio, conservarla — ya propaga outcome desde Task 5.

- [ ] **Step 3: Verificar** — tests del panel PASS; `npx vitest run src/components src/pages` verde.

- [ ] **Step 4: Checkpoint** — Task 13 lista para commit del owner.

---

### Task 14: Verificación final

- [ ] **Step 1:** `npm run lint` → 0 errores.
- [ ] **Step 2:** `npm test` → suite completa verde (sin skips nuevos).
- [ ] **Step 3:** `npm run build` → OK; inspeccionar el output para confirmar que `jsdom`/Testing Library (dev-only) no entraron al bundle.
- [ ] **Step 4:** Verificación manual mínima en dev (`npm run dev`): `/coach` → Planificación → semana vacía muestra 7 días; crear sesión para un gestionado; editarla; moverla a otra semana; borrar una limpia y una con trabajo; confirmar que el dashboard del atleta activo NO cambió de scope en ningún paso.
- [ ] **Step 5:** Smoke de invariantes de esta review: atleta vinculado con `user_id` distinto se hidrata/edita sin reparentar; offline/cache stale deja CTAs read-only; volver online + Actualizar habilita; un day log existente conserva `avgSleep`/`avgEnergy`/`avgBodyWeight` tras mutación; import replace/merge y logout obligan a rehidratar.
- [ ] **Step 6:** Avisar al owner: implementación completa, lista para commit/deploy/smoke según su flujo.

---

## Estado de implementación — 2026-07-17

- Tasks 1–13 implementadas en orden: scope link-aware, reads/writes athlete-scoped, resumen semanal transaccional, serializer, pulls dirigidos, cola concurrent-safe, replay de summaries, hidratación/invalidation, formulario reutilizable, modal y panel de planificación.
- R29–R33 verificados también en código y cubiertos por tests. R30 incluye los tres candados concurrentes: enqueue durante drain, reemplazo con el mismo `enqueuedAt` y `madeProgress` con retry retenido.
- Review posterior corregida: la semana vacía muestra únicamente la grilla de siete días; el retry interno de week-summary programa un nuevo intento solo si la versión sigue retenida; cambiar de tipo conserva títulos personalizados; y `reload()` se veta mediante epoch si cambia atleta/semana durante su await.
- Infra interactiva instalada como dev-only (`@testing-library/react`, `@testing-library/user-event`, `jsdom`); ningún paquete aparece en los chunks de producción.
- Verificación automática final: `npm run lint` PASS; `npm test` PASS (243 archivos, 1623 tests); `npm run build` PASS.
- Smoke visual manual pendiente únicamente porque esta sesión no tenía un navegador conectado. La ruta `/coach` quedó cubierta por tests jsdom de siete días, create/edit/delete, cache stale read-only, errores, confirmación y doble submit.
- No se ejecutó `git add` ni se crearon commits; el checkpoint sigue perteneciendo al owner.

---

## Notas de ejecución

- **Orden estricto:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 (cada task consume interfaces de las anteriores).
- Los tests de sync (Tasks 5-7) deben seguir el patrón de mocks del archivo de tests de syncService existente — leerlo ANTES de escribir los tests nuevos; los shapes de mock del builder de Supabase ya están resueltos ahí.
- Si un shape asumido acá no coincide con el código real (nombres de campos de membresía, helpers privados de syncService), manda el código real: ajustar el plan al código, no al revés, y anotar la diferencia en el checkpoint.
- La spec rev. 5 es la autoridad para cualquier decisión de contrato: `docs/superpowers/specs/2026-07-16-coach-planning-edicion-design.md`.

# Edición en Planificación del Coach Workspace — Design Spec

**Fecha:** 2026-07-16
**Estado:** rev. 5 — **aprobada para planificación**; incorpora las salvaguardas de la cuarta review como invariantes obligatorios del plan (invalidación del registro de hidratación, estampado post-adopción patch-only, tombstone antes del primer await remoto, reconciliación local inmediata cuando gana remoto). Rev. 4-2 cerraron las reviews técnicas previas; rev. 1, la review del owner.
**Contexto previo:** `docs/superpowers/specs/2026-07-14-coach-roster-management-y-planificacion-design.md` (lecturas read-only por atleta explícito, ya en `main`).

## Objetivo

Que el coach pueda **crear, editar y borrar sesiones de cualquier atleta de su roster desde `/coach` → Planificación**, sin cambiar el atleta activo y sin remontar la app. Es el espejo de escritura de `coachScopedReads`: mismo principio (athleteId explícito, scope activo intocado), aplicado al path de mutación.

## No-objetivos

- Edición de planes/semanas de Plan Builder desde el workspace (solo sesiones sueltas).
- Biblioteca y Asistente IA (siguen como placeholders).
- Cambios de schema: Dexie queda en v17, Supabase sin migraciones nuevas. La RLS de `013b` ya autoriza sesiones por membresía/atleta; lo que cambia es el **cliente de sync**, que hoy no la aprovecha (ver D7).
- Multi-tab: se hereda la garantía single-tab existente del sistema de leases/tombstones.

## Decisiones de arquitectura

### D0 — Resolución de scope link-aware (compartida por lecturas y escrituras)

El self del owner **no** se puede resolver con `athleteIdForOwner(ownerAccountId)` a secas: con `013` el self real puede venir de una membresía reclamada y tener otro ID (`hydrateActiveAthlete.ts:22-24` ya lo hace bien; `coachScopedReads.ts:37,60` heredó el atajo incorrecto y hay que corregirlo en este incremento).

Se extrae un resolver único, usado por `coachScopedReads` y `coachScopedWrites`:

```typescript
// src/services/athlete/resolveSelfAthleteId.ts (o dentro de coachScopedReads)
resolveSelfAthleteIdForOwner(ownerAccountId: string): Promise<string>
```

- Orden determinístico: `getSelfAthleteId()` del holder si está seteado (ya es link-aware post-hidratación) → `getSelfMembership(ownerAccountId)?.athleteId` → fallback `athleteIdForOwner(ownerAccountId)`.
- Se resuelve **una sola vez por operación** y el resultado viaja dentro del scope resuelto; nunca se re-lee entre `await`s.
- El scope resuelto es `{ athleteId: string, includeLegacy: boolean }` — el mismo shape que ya usa `pullWeekSessionsForAthlete`. `includeLegacy = (athleteId === selfId resuelto)`: las filas legacy/unscoped pertenecen SOLO al self (regla dura del proyecto).
- **Caso `activeAthleteId === null` (pre-hidratación):** el núcleo de recálculo (D1) exige `athleteId: string` y nunca se invoca sin scope. El comportamiento actual con atleta activo `null` (queries unscoped legacy) vive únicamente en los wrappers públicos, que lo conservan tal cual; los tests existentes de ese caso son la red de seguridad y no cambian.

### D1 — Recálculo semanal: núcleo puro con scope explícito + wrappers compatibles

`recalculateWeekSummary` hoy está atado al atleta activo de punta a punta: `getSessionsForWeek` filtra por `filterRowsToActiveScope` y `upsertWeekSummary` estampa con `getActiveAthleteId()`. Si el coach crea una sesión para un gestionado y se llama tal cual, el resumen del gestionado queda stale y el del coach se recalcula de más.

Se generaliza **un único algoritmo** de resumen con el scope como dato, no como estado global:

- El scope se resuelve UNA sola vez al comenzar el recálculo (via D0) y se pasa ya resuelto al núcleo. Nunca se re-lee el atleta activo entre `await`s: eso dejaría la carrera "leer sesiones de A, escribir resumen de B" si el activo cambia a mitad del recálculo.
- Funciones que pasan a tener variante de núcleo con scope explícito (la firma pública actual queda como wrapper que captura el activo una vez, incluido su branch legacy con activo `null`):
  - `getSessionsForWeek`
  - `getDayLogsForWeek`
  - `getWeekSummary`
  - `upsertWeekSummary`

**Contrato del núcleo de resúmenes — sin efectos remotos.** `upsertWeekSummary` hoy pushea adentro de la operación local (`void syncService.pushWeekSummary`, `queries.ts:197,217`). Reutilizarla desde la transacción violaría la frontera "push después del commit" (D2). Por eso el núcleo es explícitamente puro-local:

```typescript
// núcleo, sin push, invocable dentro de una transacción Dexie
upsertWeekSummaryCore(
  scope: { athleteId: string; includeLegacy: boolean },
  weekStartISO: string,
  patch: WeekSummaryPatch,
): Promise<{ summary: WeekSummary; changed: boolean }>

recalculateWeekSummaryCore(
  scope: { athleteId: string; includeLegacy: boolean },
  dateISO: string,
): Promise<{ summary: WeekSummary; changed: boolean }>
```

- El núcleo escribe solo Dexie y devuelve `{ summary, changed }` (`changed` sale de `hasWeekSummaryMeaningfulChanges` + estampado de athleteId). No llama a `syncService`.
- El servicio que orquesta (D2) acumula los summaries con `changed === true` y los pushea **después del commit** de la transacción.
- Los wrappers públicos actuales (`upsertWeekSummary(weekStartISO, patch)`, `recalculateWeekSummary(date)`) conservan firma **y efectos** (siguen pusheando ellos mismos), implementados sobre el núcleo. Los consumidores actuales (`useTrainingStore`, `applyCreateWeek`) no cambian.
- Nueva `recalculateWeekSummaryForAthlete(ownerAccountId, athleteId, date)`: resuelve el scope via D0 y delega al núcleo.

**Política de day logs — hidratar antes de mutar, no recalcular a ciegas.** El recálculo no deriva solo de sesiones: también promedia sueño, energía, peso y el fallback de esfuerzo desde `dayLogs` (`queries.ts`, `avgSleep`/`avgEnergy`/`avgBodyWeight`/`collectActualRpeValues`). Si el dispositivo del coach tiene el summary pero no los day logs del atleta seleccionado, recalcular escribiría esos promedios como `undefined` — y sin una marca de hidratación, "no hay logs" y "los logs no están cacheados" son indistinguibles. Decisión:

- **La hidratación es una precondición del SERVICIO, no solo un gate de UI.** `coachScopedWrites` mantiene un registro service-owned de semanas hidratadas, con clave `ownerAccountId + athleteId + weekStartDate` (singleton de módulo, vive lo que la sesión de app). El gate del panel (D6) es la capa de UX sobre este registro; la autoridad es el servicio, porque el form permite mover una sesión a una semana que el panel nunca mostró.
- Hidratar una semana = completar los pulls de **sesiones + day logs + week summary** del atleta/semana (contrato de filtro de D7, solo lectura).
- **Semanas exigidas por operación:** create exige la semana de `values.date`; update exige la semana original **y** la semana destino (si el patch cambia `date`); delete exige la semana original.
- Si a la operación le falta alguna semana afectada, el servicio la **hidrata primero** (antes de abrir la transacción); si esa hidratación falla, la operación falla sin mutar nada y el modal queda abierto con el error.
- **Ciclo de la marca:** la marca se registra solo cuando los tres pulls completaron bajo el mismo epoch de la operación de hidratación; un refresh fallido invalida la marca anterior de esa clave; un veto de lease/tombstone durante el pull NO cuenta como hidratación exitosa; la clave completa (`owner + athleteId + weekStart`) impide reutilizar una marca de otro atleta u otra semana.
- **Invalidación del registro (invariante obligatorio):** el registro expone `clearCoachPlanningHydrationRegistry()` (total o por atleta), invocado en: cierre de sesión / cambio de cuenta (`signOut` de `useAuthStore` hoy no tiene dónde colgarlo — hay que agregar el hook), limpieza/restauración de datos locales (`clearSelectedLocalAppData` y el path de import que reemplaza sesiones/day logs/summaries en `appMaintenance`), y el borrado duro de un atleta (por su clave). Sin esto, una marca vieja permitiría recalcular sobre tablas recién vaciadas y escribir promedios `undefined` — exactamente lo que la marca existe para impedir.
- El núcleo de recálculo se mantiene con un solo modo (recalcula todas las métricas): la alternativa de un modo `sessionsOnly` que preserve métricas de day logs se descartó porque bifurca el algoritmo compartido y deja promedios permanentemente stale. También se descartó restringir `date` a la semana visible: contradice el soporte explícito de mover sesiones entre semanas.

Un solo algoritmo de métricas; la compatibilidad con el flujo actual vive únicamente en los wrappers.

### D2 — `coachScopedWrites.ts`: mutaciones por atleta explícito

Nuevo `src/services/athlete/coachScopedWrites.ts`, hermano de `coachScopedReads.ts`. No toca `useTrainingStore` (que es del atleta activo por definición) ni `withActiveAthleteStamp`.

API:

```typescript
createSessionForAthlete(ownerAccountId, athleteId, values: CoachSessionDraft): Promise<Session>
updateSessionForAthlete(ownerAccountId, athleteId, sessionId, patch: CoachSessionPatch): Promise<Session>
deleteSessionForAthlete(ownerAccountId, athleteId, sessionId): Promise<void>
```

Reglas comunes:

- **Validación de roster:** `assertActiveRosterAthlete(ownerAccountId, athleteId)` (D3).
- **Precondición de hidratación (D1):** antes de abrir la transacción, el servicio verifica en su registro las semanas afectadas por la operación (create: semana de `values.date`; update: original + destino; delete: original) e hidrata las que falten. Falla de hidratación → la operación no muta.
- **Pertenencia de la sesión:** `update`/`delete` cargan la sesión de Dexie y verifican que pertenece al atleta explícito (por `athleteId` de la fila, con adopción legacy solo si el scope es el self resuelto via D0). Validar solo el roster no impide pasar el ID de una sesión de otro atleta del mismo roster.
- **Lease de escritura + revalidación adentro:** la fase local (mutación Dexie + recálculo de resúmenes) corre dentro de `runAthleteWrite(athleteId, ...)` de `athleteWriteLease.ts`. Si devuelve veto (`false`), la operación falla con mensaje ("Este atleta está siendo eliminado.") y no escribe nada. **El lease no es un mutex** — solo trackea operaciones en vuelo y veta por tombstone — así que:
  - La validación de estado del atleta (`db.athletes`: existencia, owner, `status === 'active'`) se **repite dentro del lease/transacción**, no solo antes: cierra la carrera chequeo→await→write frente a un archivado/borrado que arranca entremedio.
  - La protección contra doble submit NO viene del lease; es responsabilidad del modal (D6): dos submits rápidos generarían dos UUID y dos sesiones si no se guardea en la UI.
- **Frontera atómica local:** dentro del lease, la mutación de la sesión y los `upsertWeekSummaryCore` de los resúmenes afectados se confirman en **una transacción Dexie** (`db.transaction('rw', db.sessions, db.dayLogs, db.weekSummaries, db.athletes, ...)`). Los pushes remotos (D7) se disparan **después del commit**, fire-and-forget vía la maquinaria de sync (que ya encola en fallo), usando los summaries `changed` que devolvió el núcleo. Así, si falla el recálculo, no queda una sesión insertada con push disparado y un reintento del modal no puede duplicar.

Reglas por operación:

- **Create:** estampa `athleteId` del parámetro, `weekStartDate` derivado, `id`/`createdAt`/`updatedAt` nuevos, `source: 'coach'` (valor ya existente en `SessionSource`), `authoredByRole: resolveAuthoredByRole(athleteId)`. El draft se materializa con el serializer de modo create (D4).
- **Update:** el patch se aplica con el serializer de modo edit (D4) — nunca acepta `id`, `athleteId`, `createdAt`, `authoredByRole`, `source`, `weekStartDate` ni campos de completación (`status`, `completedAt`, `actualDurationMin`, `actualRpe`, `sessionFeedback`, `completionNotes`, `autoCompletion`). `authoredByRole` se preserva de la fila existente: representa al autor original, no al último editor, y Supabase lo trata como inmutable. **`weekStartDate` nunca viene del patch:** si el patch cambia `date`, el servicio lo re-deriva de la fecha nueva; si no cambia, se preserva el existente. `updatedAt` se renueva siempre. Si cambia `date`, se recalculan **ambas** semanas (la anterior y la nueva) dentro de la misma transacción.
- **Delete:** borra la fila y recalcula la semana de la fecha borrada. La política de confirmación es de UI (D5); el servicio borra lo que le pidan una vez validada la pertenencia. El delete remoto es athlete-scoped (D7). **Orden del tombstone (invariante obligatorio):** (1) commit del delete local, (2) registro **inmediato** del tombstone de sesión, (3) recién entonces delete remoto o enqueue. El `deleteRow` genérico registra el tombstone después del delete remoto exitoso (o al caer a offline/error), y en esa ventana un pull concurrente reinserta la fila ausente; el delete explícito del workspace no hereda ese orden.

### D3 — Aserciones de roster: dos funciones, contrato inequívoco

- `assertRosterAthlete(ownerAccountId, athleteId)`: valida **existencia + owner**. Acepta atletas archivados. Es la que usan las lecturas que necesiten ver archivados.
- `assertActiveRosterAthlete(ownerAccountId, athleteId)`: llama a la anterior y además exige `status === 'active'`. Mensaje propio para el caso archivado: "Este atleta está archivado; restauralo para editar su semana."
- **Planificación (lecturas: `getWeekSessionsForAthlete`, `hydrateWeekForAthlete`) y todas las escrituras de D2 usan la variante activa.** Planificación solo lista atletas activos, así que no cambia comportamiento visible.

### D4 — `SessionForm` compartido + serializer por modo

El cuerpo del formulario de `AddSessionModal` (705 líneas, acoplado a `useTrainingStore` + `useCoachMemoryStore`) se extrae a `src/components/session/SessionForm.tsx`, presentacional puro:

- Props: `initialValues?` (para edición), `defaultSport`, `onSubmit(values)` **async** (D6), `onCancel`, `submitLabel`.
- Sin stores adentro. `AddSessionModal` queda como wrapper que inyecta `useTrainingStore().addSession` y el deporte del perfil activo; su comportamiento no cambia.
- Nuevo `CoachSessionModal` (en `src/components/coach/`) envuelve `SessionForm` con `coachScopedWrites`. Para `defaultSport` **no** lee `useCoachMemoryStore` (apunta al atleta activo): usa `getAthleteProfileForAthlete(ownerAccountId, athleteId)`, con fallback `'squash'` si no hay perfil.

**Lookup de perfil por atleta.** Consultar `db.athleteProfiles` por `athleteId` a secas falla para el self: el perfil self puede seguir siendo la fila `id: 'default'` (`ATHLETE_PROFILE_LOCAL_ID`) sin `athleteId` estampado, especialmente con una membresía reclamada. Se agrega:

```typescript
getAthleteProfileForAthlete(ownerAccountId, athleteId): Promise<AthleteProfile | undefined>
```

- Si `athleteId` es el self resuelto (D0): fila `'default'`, con fallback por el índice `athleteId` (Dexie v17 lo tiene en `athleteProfiles`).
- Gestionado: fila por índice `athleteId` (fallback por `id` si aplica).

**Tipos del submit.** El form devuelve solo los campos que realmente representa, nunca una `Session` completa reconstruida:

```typescript
// Campos visibles del form, y nada más.
interface CoachSessionDraft {
  date: string
  timeBlock: TimeBlock
  type: SessionType
  title: string
  durationMin: number
  objective?: string
  location?: string
  rpe?: number
  notes?: string
  // squash
  subtype?: SquashSubtype
  opponent?: string
  matchResult?: MatchResult
  gamesWon?: number
  gamesLost?: number
  // running/cycling: SOLO los targets que el form muestra
  runningTargets?: {
    runningType: RunningType
    targetPaceMin?: string
    targetPaceMax?: string
    targetHrMin?: number
    targetHrMax?: number
  }
  // ejercicios: campos editables + id para merge
  exercises?: Array<{
    id: string          // nuevo => uuid generado por el form
    name: string
    sets: number
    reps: string
    weight?: number
    notes?: string
  }>
}

type CoachSessionPatch = Partial<CoachSessionDraft>
```

**Serializer por modo** (`src/services/athlete/coachSessionSerializer.ts` o junto a writes; función pura, testeable sin Dexie):

- **Create:** genera defaults como hoy — `generateDefaultProtocols` (warmup/cooldown), `squashDetails`/`cyclingDetails`/`mobilityDetails` derivados, ejercicios nuevos con `completed: false`.
- **Edit sin cambio de `type`:** mergea **solo los campos visibles** sobre la fila existente. Se preservan intactos: `warmup`, `cooldown`, la subestructura/notas enriquecidas de `squashDetails` (`drills` **y** `blocks` — `SquashDetails.blocks` sí existe), `cyclingDetails` (`targetStructure`/`executionNotes` — este tipo no tiene "blocks"), `mobilityDetails` y todos los campos de completación. `runningTargets` se mergea shallow dentro del `runningDetails` existente (solo las claves de target), preservando cualquier otro subcampo. `weekStartDate` no lo toca el serializer: lo administra el servicio (D2 — re-derivado solo si cambia `date`).
- **Campos derivados dentro del mismo `type`:** preservar la subestructura rica no significa congelar los derivados. Cuando cambia el campo visible que alimenta un derivado, el serializer actualiza **ese derivado puntual** manteniendo drills y notas enriquecidas: `subtype` → `squashDetails.sessionMode` (training→competitive no puede conservar `drill_session`); `runningTargets.runningType` → los campos de `cyclingDetails` que dependen de la zona (`sessionCategory`/`targetStructure`/`intensityReference` — Z2→intervalos no puede conservar un detalle que dice Z1–Z2). La lista exacta campo-visible → derivados vive en el serializer con test propio.
- **Edit con cambio de `type`:** limpia **explícitamente** los campos incompatibles del tipo anterior (p. ej. `subtype`/`opponent`/`matchResult`/`gamesWon`/`gamesLost` al salir de squash; `runningDetails` al salir de running/cycling; `squashDetails`/`cyclingDetails`/`mobilityDetails` según corresponda) y genera los defaults del tipo nuevo como en create. La lista exacta de clear-por-tipo vive en el serializer con test propio.
- **Ejercicios — merge por `id`:** un ejercicio cuyo `id` existe en la fila conserva `completed`, `warmupSets`, `group`, targets y cualquier subcampo no editable; solo se aplican `name`/`sets`/`reps`/`weight`/`notes`. Los `id` nuevos nacen con `completed: false`. Los ejercicios ausentes del form se eliminan (el coach los quitó explícitamente).

Sin este serializer, editar una sesión de Plan Builder vaciaría drills y detalles deportivos, reemplazaría protocolos y perdería `completed`/`warmupSets` — el bug que motivó separar draft/patch de `Session`.

### D5 — Borrado con confirmación proporcional al trabajo registrado

Borrar es siempre posible (bloquear obliga a convivir con duplicados o cargas erróneas); la fricción responde a "¿hay trabajo registrado?", no solo al estado.

Se extrae una función pura `hasRecordedWork(session: Session): boolean` (testeable con valores cero — comparaciones con `!= null`, nunca truthiness):

- `status ∈ {completed, adjusted}`, o
- `completedAt != null`, o
- `actualDurationMin != null`, o
- `actualRpe != null`, o
- `sessionFeedback != null`, o
- `completionNotes` no vacío, o
- `autoCompletion != null` (sobrevive explícitamente a volver la sesión a `planned` — `types/index.ts`), o
- algún `exercise.completed === true`.

UI:

- **Confirmación** (via `ConfirmDialog` existente en `src/components/ui/`) cuando `hasRecordedWork(session)`.
- **Borrado directo** en caso contrario.
- El copy de la confirmación explica la consecuencia ("Esta sesión tiene trabajo registrado del atleta; se borrará también ese registro.").

### D6 — Panel de Planificación y contrato del modal

**Días y CTAs.** Hoy el panel solo renderiza días que contienen sesiones; en una semana vacía no habría dónde colgar el CTA. Decisión: **se renderizan siempre los siete días de la semana**, cada uno con su encabezado y su botón "+ Agregar sesión"; un día sin sesiones muestra solo el CTA. El empty state global actual ("Esta semana no tiene sesiones planificadas.") se elimina — la grilla de siete días con CTAs lo reemplaza. Por sesión: "Editar" / borrar.

**Gate de hidratación para mutar (D1).** El gate visible del panel se apoya en el registro service-owned de D1 (no en estado propio): los CTAs de agregar/editar/borrar solo se habilitan con la marca de la semana visible presente; en fase `stale`/`error`/offline la semana es read-only, con hint junto a los CTAs deshabilitados ("Actualizá la semana para editar."). La autoridad real es la precondición del servicio (D1/D2), que además cubre la semana **destino** cuando el form mueve la sesión a una semana que el panel nunca hidrató: el submit hidrata lo que falte y, si no puede, el modal queda abierto con el error.

**Errores de delete.** Create/edit muestran el error dentro del modal, pero el borrado directo no tiene modal y `ConfirmDialog` no tiene prop de error. El panel agrega un **banner de error** (mismo patrón visual del error de carga) como canal para fallas de borrado; si había `ConfirmDialog`, permanece abierto con `isLoading` reseteado cuando el delete local falla, y el banner explica la causa. El fallo del delete remoto no genera banner (lo maneja la cola de sync, como el resto de los pushes).

**Guard de doble submit (responsabilidad del modal, no del lease):**

- `onSubmit` es async; el modal `await`ea el resultado.
- Guard **síncrono** de reentrada vía `useRef` (se setea antes del primer `await`), además del estado visual `isSubmitting`.
- Botones de submit/cancel y el cierre por backdrop quedan deshabilitados durante el submit.
- Errores de mutación se muestran en el modal sin cerrarlo (no se pierde lo tipeado).

Tras cada mutación exitosa el panel recarga la semana vía `getWeekSessionsForAthlete` (lectura ya existente). Las acciones respetan el `pendingAction` lock existente del workspace para navegación/cambios de atleta, pero ese lock **no** sustituye el guard del modal (representa acciones del workspace, no la mutación del form).

### D7 — Protocolo de sync remoto athlete-scoped (incluye cola offline)

El sync actual está anclado a `user_id` y rompe con atletas vinculados (membresías `013`): `pullWeekSessionsForAthlete` filtra `.eq('user_id', ownerAccountId)`, `deleteRow` borra por `id + user_id` del actor, y `sessionToRow` reescribe `user_id` al actor en cada upsert. Para un atleta vinculado que creó sus propias sesiones: el coach no las hidrata, el delete afecta cero filas sin error (y aun así registra éxito/tombstone), y un update reparenta el `user_id` original. La RLS de `013b` ya autoriza por membresía; son los filtros del cliente los que impiden aprovecharla. No requiere migración SQL.

**Target remoto discriminado.** Las sesiones que este flujo puede mutar son de dos clases remotas distintas: las scoped (con `athlete_id`) y las legacy adoptadas por el self (`athlete_id IS NULL` remoto). Mutar siempre por `id + athlete_id` rompería las legacy: delete en cero filas declarado exitoso (con tombstone ocultando para siempre una fila viva), y update-first cayendo a un insert que choca con el mismo PK. Antes de la mutación, el servicio captura el target desde la fila local:

```typescript
type RemoteSessionTarget =
  | { kind: 'scoped'; athleteId: string }   // fila local con athleteId scoped
  | { kind: 'legacySelf'; ownerAccountId: string; selfAthleteId: string }
    // fila unscoped adoptada (solo scope self); lleva el self resuelto (D0)
    // para poder completar la adopción y para los fallbacks post-adopción
```

Contrato de las operaciones remotas de sesiones usadas por este incremento:

- **Pull (`pullWeekSessionsForAthlete`):** el anchor deja de ser `user_id`. Branch scoped: `.eq('athlete_id', athleteId)` sin filtro de `user_id` (la RLS acota). Branch legacy (solo cuando `includeLegacy`): `athlete_id.is.null` **y** `user_id = ownerAccountId` — las filas legacy no tienen athlete_id y pertenecen solo al self del owner. Combinado: `athlete_id.eq.X` OR `and(user_id.eq.owner, athlete_id.is.null)`. El mismo contrato de filtro se reutiliza para los pulls read-only de day logs y week summary que exige la política de hidratación (D1).
- **Delete athlete-scoped:** para target `scoped`, borra por `id + athlete_id` (`.eq('id', id).eq('athlete_id', athleteId)`); para `legacySelf`, por `id + user_id = owner + athlete_id IS NULL`. Nunca por `user_id` del actor a secas. Cero filas afectadas es éxito idempotente (la fila ya no estaba). El tombstone de sesión se registra como hoy.
- **Push/update sin reparentar:** el update remoto de una sesión existente **no reescribe `user_id`** (preserva al creador original); `updated_by_account_id` sí registra al actor. **Update-first es la estrategia canónica** (el wrapper `upsertRow` actual no soporta columnas insert-only): update por el filtro del target con la fila sin `user_id`, e insert con `user_id = actor` solo si el update no afectó filas.
- **Cola offline:** las operaciones de sesión de este flujo se encolan con las acciones existentes (`upsert`/`delete`) más dos campos: `scopeAthleteId` **obligatorio** (es la clave que `clearQueuedOpsForAthlete` ya usa para suprimir trabajo pendiente en el borrado duro — un `payload.athleteId` suelto no se suprimiría) y el `RemoteSessionTarget` serializado en la op, que el drain usa para replay con el mismo filtro. El target no altera la identidad de entidad (`payload.id`), así que la compactación existente (`clearQueuedOpsForEntityOlderThan`) aplica sin cambios.

**Transición `legacySelf → scoped` — idempotente en las dos direcciones.** La adopción remota (estampar `athlete_id` en una fila legacy) puede ocurrir antes, después o entre medio de operaciones encoladas: dos edits offline se compactan por el mismo `payload.id`, un edit puede preceder a un delete antes del drain, y un replay puede repetirse tras la adopción. Reglas:

- El target `legacySelf` es **sticky**: la fila local no cambia de target (ni se estampa `athleteId` local) hasta que una operación remota **confirma** la adopción. Toda op encolada mientras el target es legacy conserva `kind: 'legacySelf'`, incluida la que compacta a una anterior.
- **Update `legacySelf`:** filtra `id + user_id = owner + athlete_id IS NULL` y estampa `athlete_id = selfAthleteId` en el SET (la adopción). Si afecta cero filas, **antes de insertar** prueba el mismo update por `id + athlete_id = selfAthleteId` (la fila ya fue adoptada por una op anterior o por otro flujo). Solo si ambas ramas afectan cero filas, inserta — ya scoped, con `user_id = actor`. Sin este fallback, el insert choca con el PK de la fila adoptada.
- **Delete `legacySelf`:** borra por `id + user_id = owner + athlete_id IS NULL`; si afecta cero filas, reintenta por `id + athlete_id = selfAthleteId`. Cero filas en ambas ramas = éxito idempotente real (la fila no existe en ninguna forma); sin el segundo intento, un delete post-adopción "exitoso" dejaría viva la fila scoped bajo un tombstone.
- **Post-adopción confirmada** (update que afectó filas en cualquiera de sus dos ramas): se estampa `athleteId = selfAthleteId` en la fila local, y las operaciones futuras capturan target `scoped`. **El estampado es patch-only (invariante obligatorio):** la adopción remota puede confirmarse después de que la sesión fue editada o borrada localmente, así que nunca se hace `put` con el snapshot capturado antes del push. Contrato: re-leer la sesión dentro de `runAthleteWrite`; si ya no existe → no-op (no resucitar); si sigue sin scope → `update(id, { athleteId })` y nada más — sin tocar `updatedAt` ni ningún otro campo. Si el estampado no ocurre (crash, veto), no hay corrupción: el próximo push vuelve a salir `legacySelf` y sus fallbacks lo resuelven.
- **Replay repetido es seguro por construcción:** cada rama es un update/delete condicionado por filtros que solo matchean el estado que pretende transformar.

**Summaries producidos por este flujo — `pushWeekSummaryForAthlete`.** El `pushWeekSummary` genérico no puede quedar en el path del workspace: `weekSummaryToRow` construye la fila con `user_id` del actor (reparentaría el summary que un atleta vinculado creó desde su cuenta) y la reconciliación de `23505` por clave natural busca la fila remota con `.eq('user_id', actor)`, así que un conflicto con el summary del atleta ni siquiera se encuentra. Se agrega una operación athlete-scoped, **limitada a los summaries que emite D2** (siempre estampados con `athlete_id`):

- Update-first por `id + athlete_id` con la fila sin `user_id`; insert con `user_id = actor` si no afectó filas.
- La reconciliación de `23505` busca la fila remota por `athlete_id + week_start_date` (sin filtro de `user_id`), y resuelve con la **misma semántica LWW del write path `008b`**:
  - Remoto más nuevo **o empate** (`remote.updated_at >= local.updatedAt`): gana el remoto, no se sobrescribe. **La reconciliación local es inmediata (invariante obligatorio):** la operación devuelve la fila remota ganadora y actualiza Dexie bajo el lease en ese momento — no se delega al "próximo pull", porque el merge genérico desempata con `deterministicTiebreaker` y podría volver a elegir el candidato local en un empate, dejando un ping-pong entre push y pull.
  - Local más nuevo: update **condicional** por `remote.id + athlete_id + week_start_date` con guard `updated_at < local.updatedAt` (sin `user_id` en el SET).
  - Update condicional en cero filas (carrera: alguien escribió entremedio): re-fetch de la fila remota y re-evaluación antes de dar la reconciliación por resuelta.
- Su op encolada lleva `scopeAthleteId` como las de sesiones.

Alcance: este contrato aplica a las operaciones que usa el workspace (`pullWeekSessionsForAthlete` + pulls de hidratación de D1, push/delete de sesiones y `pushWeekSummaryForAthlete` desde `coachScopedWrites`). El pull global ya es membership-aware vía `buildPullFilter` (`syncSupabase.ts`); lo que queda para SP1a son los **paths genéricos de escritura y reconciliación** (`upsertRow`/`deleteRow`/`reconcileNaturalKeyConflict` anclados al `user_id` del actor, day logs de escritura, el `pushWeekSummary` de los wrappers del atleta activo), no este incremento.

## Flujo de datos (create)

```
Planificación (semana hidratada: sesiones + day logs + summary, D1)
  → [+ Agregar en día D] → CoachSessionModal (athleteId del selector)
  → guard de doble submit (ref) → createSessionForAthlete(ownerId, athleteId, draft)
      ├─ assertActiveRosterAthlete(ownerId, athleteId)
      ├─ precondición D1: semana de draft.date hidratada (hidrata si falta; falla ⇒ no muta)
      ├─ scope = { athleteId, includeLegacy: athleteId === resolveSelfAthleteIdForOwner(ownerId) }
      ├─ runAthleteWrite(athleteId, tx:
      │    ├─ revalida db.athletes (owner + status active) dentro de la tx
      │    ├─ db.sessions.add(serializerCreate(draft) estampada con athleteId param,
      │    │                   source 'coach', authoredByRole resuelto)
      │    └─ recalculateWeekSummaryCore(scope, date) → { summary, changed }
      │  )
      ├─ post-commit: void pushSession(target D7) / void pushWeekSummaryForAthlete (solo changed)
      └─ return session
  → panel recarga getWeekSessionsForAthlete
```

El atleta activo no se lee ni se escribe en ningún punto del flujo.

## Manejo de errores

| Falla | Comportamiento |
|---|---|
| Atleta tombstoned (lease veta) | Error con mensaje; cero escrituras |
| Atleta archivado / fuera de roster (pre-chequeo o revalidación en tx) | `assertActiveRosterAthlete` lanza con copy en español |
| Sesión no pertenece al atleta | Error explícito; cero escrituras |
| Doble submit | Guard de reentrada del modal; una sola mutación llega al servicio |
| Semana visible sin hidratar (stale/error/offline) | CTAs de mutación deshabilitados con hint; semana read-only |
| Semana afectada sin hidratar en el submit (p. ej. semana destino de un cambio de fecha) | El servicio hidrata primero; si falla, no muta y el modal queda abierto con el error |
| Falla dentro de la transacción | Rollback Dexie completo (sesión + resúmenes); modal abierto, valores conservados |
| Falla del delete local (sin modal) | Banner de error en el panel; `ConfirmDialog` (si estaba abierto) permanece abierto con `isLoading` reseteado |
| Falla del push remoto | Maquinaria de sync existente (enqueue/retry con `scopeAthleteId` + target serializado); no afecta la UX del modal |
| Delete remoto afecta 0 filas | Éxito idempotente (fila ya ausente); tombstone se registra igual — válido porque el filtro del target sí alcanza filas legacy (`legacySelf`) |

## Tests

1. **`coachScopedWrites`** (núcleo del incremento):
   - create estampa el `athleteId` del parámetro con OTRO atleta activo (la regresión de fondo).
   - `authoredByRole === 'coach'` en create para gestionado; `'self'` para el self.
   - update preserva `authoredByRole` y rechaza campos prohibidos del patch (incluidos los de completación).
   - update/delete rechazan `sessionId` de otro atleta del roster.
   - rechaza atleta archivado, fuera del roster y tombstoned (lease veta, cero writes); revalidación dentro de la tx cubre el archivado que ocurre entre el pre-chequeo y la escritura.
   - update con cambio de fecha recalcula ambas semanas y **re-deriva `weekStartDate`**; sin cambio de fecha lo preserva; `updatedAt` se renueva siempre; el patch nunca puede setear `weekStartDate`.
   - precondición de hidratación: create/update/delete rechazan (sin mutar) cuando la hidratación de una semana afectada falla; update con cambio de fecha exige la semana **destino** además de la original; una operación con las semanas ya marcadas no re-hidrata.
   - ciclo de la marca: solo se registra con los tres pulls completos bajo el mismo epoch; refresh fallido invalida la marca previa; veto de lease/tombstone no marca; la marca de un atleta/semana no habilita otra clave.
   - invalidación del registro: marca → `clearCoachPlanningHydrationRegistry()` (logout, limpieza local, import, borrado duro) → la siguiente escritura rehidrata en vez de reutilizar la marca vieja.
   - orden del tombstone en delete: con delete remoto demorado y un pull concurrente de la misma semana, la sesión borrada no se reinserta (el tombstone ya existía al momento del pull).
   - fallo inyectado en el recálculo → rollback: la sesión no queda en Dexie y no se pushea nada.
   - doble invocación rápida de create → una sola sesión (guard del modal, test a nivel de componente en 4).
2. **Recálculo con scope explícito:** crear sesión para el gestionado actualiza SU resumen y no toca el del coach; el núcleo no emite pushes (spy sobre `syncService`); wrappers `recalculateWeekSummary(date)`/`upsertWeekSummary` conservan comportamiento y efectos actuales, incluido el caso atleta activo `null` (regresión); legacy solo se adopta cuando el scope es el self **resuelto por membresía** (caso self reclamado con ID distinto de `athleteIdForOwner`).
3. **Serializer por modo:** edit sin cambio de tipo preserva drills/blocks/protocolos/`completed`/`warmupSets`; cambio de `subtype`/`runningType` dentro del mismo tipo re-deriva los campos derivados puntuales (`squashDetails.sessionMode`, zona de `cyclingDetails`) sin tocar drills/blocks/notas; edit con cambio de tipo limpia exactamente la lista de campos incompatibles; merge de ejercicios por `id` (existente conserva subcampos, nuevo nace `completed: false`, ausente se elimina); `hasRecordedWork` con valores cero (`actualDurationMin: 0` cuenta como registrado) y con `autoCompletion` presente en sesión `planned`.
4. **`SessionForm` / `AddSessionModal` / `CoachSessionModal`:** `AddSessionModal` no tiene tests hoy — se agrega una regresión del wrapper (render + submit crea vía store) además de los tests del form extraído (patch acotado en edición); doble click en submit del `CoachSessionModal` produce una sola llamada al servicio; botones/cierre deshabilitados durante submit.
5. **Sync athlete-scoped (D7):** pull hidrata sesiones de un atleta vinculado con `user_id` distinto del owner; delete remoto de target `scoped` usa `id + athlete_id` y trata 0 filas como éxito; **target `legacySelf`: delete alcanza la fila `athlete_id IS NULL` por `id + user_id + athlete_id IS NULL`, y update la adopta estampando el self resuelto**; update no reparenta `user_id` y sí actualiza `updated_by_account_id`; replay de la cola offline conserva el target serializado; op encolada con `scopeAthleteId` se suprime en `clearQueuedOpsForAthlete` durante el borrado duro.
   - **Transición `legacySelf → scoped`:** dos edits offline compactados drenan correctamente contra una fila ya adoptada (fallback update por `id + selfAthleteId` antes de insertar, sin choque de PK); edit→delete encolados antes del drain (el delete post-adopción alcanza la fila scoped vía su segundo intento); replay repetido tras adopción es no-op limpio; crash antes del estampado local → próximo push `legacySelf` resuelve por fallbacks.
   - **Estampado post-adopción patch-only:** adopción demorada seguida de delete local → no resucita la sesión; seguida de edit local → solo cambia `athleteId`, sin pisar el edit ni `updatedAt`.
   - **`pushWeekSummaryForAthlete`:** no reparenta `user_id`; reconcilia `23505` buscando por `athlete_id + week_start_date` aunque el `id` local difiera; LWW — local más nuevo hace update condicional (`updated_at < local`), remoto más nuevo y **empate** ganan y reconcilian Dexie inmediatamente bajo el lease (el empate no rebota en el próximo pull contra `deterministicTiebreaker`), y update condicional en cero filas re-fetchea antes de dar por resuelto (carrera durante la reconciliación).
6. **Panel:** semana vacía renderiza los siete días con CTA; CTAs deshabilitados sin marca de hidratación (stale/error/offline) y habilitados tras hidratar sesiones + day logs + summary; recálculo tras mutación conserva `avgSleep`/`avgEnergy`/`avgBodyWeight` porque los day logs están hidratados; confirmación solo cuando `hasRecordedWork`; borrado directo de `planned` limpio; fallo de delete local muestra banner y no cierra el `ConfirmDialog`; recarga tras mutación.
7. **Perfil por atleta:** `getAthleteProfileForAthlete` resuelve el self con fila `'default'` sin `athleteId` estampado (caso membresía reclamada incluido) y el gestionado por índice `athleteId`.

## Riesgos

- **Extracción del form (705 líneas sin tests previos):** el riesgo más alto del incremento. Mitigación: la regresión de `AddSessionModal` se escribe ANTES de extraer, sobre el componente actual, y debe pasar sin cambios tras la extracción.
- **Generalización de `queries.ts`:** los wrappers conservan las firmas y efectos actuales; la suite existente que pasa por `useTrainingStore`/`applyCreateWeek` es la red de seguridad.
- **Cambio del contrato de push/delete de sesiones y summaries (D7):** `upsertRow`/`deleteRow` son compartidos por todas las tablas. Mitigación: el contrato athlete-scoped (update-first + target discriminado) se implementa como operaciones nuevas junto a las existentes — el path genérico no se muta y conserva un test de no-regresión; solo sesiones y los summaries de D2 lo adoptan en este incremento.
- **Hidratación ampliada (sesiones + day logs + summary):** agrega dos pulls read-only nuevos, tanto al cargar la semana visible como on-demand en el submit (semana destino de un cambio de fecha). Mitigación: reutilizan el filtro de D7 y el patrón de `pullWeekSessionsForAthlete` (lease por fila, tombstones); si un pull falla, la operación no muta y la semana queda read-only — nunca se recalcula con datos parciales.

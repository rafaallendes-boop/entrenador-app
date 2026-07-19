# Coach Biblioteca — Plantillas de Sesión (Design)

**Fecha:** 2026-07-17
**Estado:** aprobado por el owner (brainstorming 2026-07-17)
**Contexto previo:** `docs/superpowers/plans/2026-07-16-coach-planning-edicion.md` (CRUD de Planificación implementado en `676e47b`).

## Objetivo

Que el coach planifique más rápido: guardar sesiones tipo como plantillas reutilizables y aplicarlas a cualquier día/atleta desde Planificación. La tab Biblioteca del Coach Workspace deja de ser placeholder.

La unidad de reutilización es la **sesión**. El diseño deja la puerta abierta a **semanas plantilla** como incremento futuro (discriminante `kind`), pero este incremento no las implementa.

## Alcance

- Nueva entidad `SessionTemplate`: Dexie v18 + Supabase `015_session_templates.sql`, sync per-fila multi-dispositivo.
- Biblioteca: listar, crear, editar, eliminar (soft-delete) plantillas.
- Planificación: "Guardar como plantilla" desde una sesión y "Desde plantilla" para crear una sesión prellenada.

**Fuera de alcance:** semanas plantilla; edición rica de drills/bloques en Biblioteca; grupo selectivo `library` en Settings (`LocalDataGroup`); purga física de tombstones; búsqueda/filtros en la lista.

---

## D1 — Modelo de datos

```ts
interface SessionTemplate {
  id: string                      // uuid
  name: string                    // etiqueta de Biblioteca (independiente de payload.title)
  kind: 'session'                 // discriminante para futuras 'week'
  payloadVersion: 1               // versiona el JSON interno del payload
  payload: SessionTemplatePayload
  createdAt: number
  updatedAt: number
  deletedAt?: number              // soft-delete (D4)
}
```

**`SessionTemplatePayload`** — subset planificable de `Session`, construido por **allowlist explícita con copia profunda** (futuros campos de ejecución en `Session` no entran solos):

- **Incluye:** `type`, `timeBlock`, `title`, `durationMin`, `objective`, `location`, `rpe` (objetivo), `notes`, `subtype`, `squashDetails` completo (drills, blocks, sessionMode, trainingFocus), `runningDetails`, `cyclingDetails`, `mobilityDetails`, `warmup`, `cooldown`, `exercises`.
- **Excluye:** `id`, `athleteId`, `date`, `weekStartDate`, `status`, `completedAt`, `actualDurationMin`, `actualRpe`, `sessionFeedback`, `completionNotes`, `autoCompletion`, `source`, `authoredByRole`, `createdAt`/`updatedAt`, **`metadata`** (contiene `starLift.weekProgression`, ligado al bloque del Plan Builder; los targets útiles ya viven en cada ejercicio como `targetPercent1RM`/`targetRpe`), y los datos de partido: `opponent` (contextual a una asignación concreta), `matchResult`, `gamesWon`, `gamesLost` (ejecución).

**Ejercicios sin identidad ni estado:**

```ts
type SessionTemplateExercise = Omit<Exercise, 'id' | 'completed'>
```

Al materializar una sesión, cada ejercicio recibe UUID nuevo y `completed: false`, siempre.

**Compatibilidad forward — tipo raw discriminado:** una fila con `payloadVersion` o `kind` desconocidos no puede castearse a `SessionTemplatePayload`:

```ts
type StoredSessionTemplate =
  | SupportedSessionTemplate      // kind: 'session', payloadVersion: 1, payload tipado
  | UnsupportedSessionTemplate    // payload: unknown (raw); conserva TODOS los campos del
                                  // registro: id, name, kind, payloadVersion, payload raw,
                                  // createdAt, updatedAt, deletedAt — necesarios para poder
                                  // eliminarla vía upsert y para round-trip de backup
```

Una `UnsupportedSessionTemplate` se lista con nombre + "Formato no compatible"; aplicar/editar deshabilitados, **eliminar sigue disponible**. Nunca se materializa con heurísticas.

El type guard de filas soportadas valida también el shape mínimo del payload v1
(`type`, `timeBlock`, `title`, `durationMin` y contenedores opcionales). Una fila
client-writable con discriminantes conocidos pero `data` malformado se conserva raw
como incompatible; nunca se materializa mediante un cast.

**`name` vs `payload.title`:** al crear, `name` sigue al título hasta que el usuario lo edita manualmente; al editar una plantilla existente quedan independientes. `name` con trim vacío cae al título del draft/sesión.

## D2 — Supabase `015_session_templates.sql`

```sql
create table session_templates (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind text not null check (btrim(kind) <> ''),
  payload_version smallint not null default 1 check (payload_version > 0),
  data jsonb not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint null,
  check (deleted_at is null or deleted_at = updated_at)
);
create index on session_templates (user_id, kind, updated_at desc);
```

`kind` acepta discriminantes futuros no vacíos para que clientes anteriores
puedan conservarlos, sincronizarlos y borrarlos como filas opacas. La UI v1 solo
materializa `kind = 'session'`; los demás valores son `UnsupportedSessionTemplate`.

- **RLS owner-only** en select/insert/update/delete (`auth.uid() = user_id`); `UPDATE` con `USING` **y** `WITH CHECK`. Client-writable (como `sessions`; a diferencia de las tablas Whoop server-only).
- **Guard `BEFORE UPDATE`** (trigger): permite conservar el `upsertRow` genérico y la cola ciega sin RPC nuevo:
  1. rechaza `NEW.updated_at < OLD.updated_at` (stale write);
  2. en empate `NEW.updated_at = OLD.updated_at` con estados distintos, gana la versión borrada (delete-wins); en empates live/live o deleted/deleted, gana explícitamente la fila remota existente (`OLD`);
  3. **tombstone versionado ante intento de resurrección:** si `OLD.deleted_at is not null` y `NEW` llega live con `NEW.updated_at > OLD.updated_at` (típico: un dispositivo viejo drena una op encolada anterior al borrado), el trigger **no** conserva el tombstone en su timestamp viejo — preserva el contenido borrado (`OLD`) pero avanza `deleted_at = updated_at = NEW.updated_at`. Sin esto, el pull siguiente vería al live local más nuevo como ganador LWW en cada ciclo y nunca convergería; con el tombstone versionado, el próximo pull empata y delete-wins converge en todos los dispositivos. Una restauración futura será una operación explícita, no un upsert.
- **Smoke SQL:** receta `BEGIN … ROLLBACK` comentada al final de `015` (o doc aparte) que verifica: RLS owner-only, stale update rechazado, empate delete-wins, y que una actualización viva más nueva sobre un tombstone produce un tombstone versionado (`deleted_at = updated_at` avanzados, contenido borrado preservado), nunca una fila live. `008a` es preflight ejecutable; este smoke es receta manual, no preflight.

## D3 — Dexie v18 y lifecycle local

```ts
this.version(18).stores({
  sessionTemplates: 'id, kind, updatedAt, name',
})
```

**Conjuntos de lifecycle** (nueva separación explícita):

```text
account-scoped: sessionTemplates
athlete-scoped: stores actuales de datos de entrenamiento
all-local:      unión de ambos
```

- Reset total, import replace y limpieza por cambio efectivo de cuenta usan `all-local` (incluyen plantillas). El manifiesto Dexie expone por separado `getAccountScopedTables()` y `getAllLocalTables()` para que toda transacción declare las tablas account-scoped que toca.
- El borrado **selectivo** de `trainingData` conserva la Biblioteca. Como el grupo selectivo `library` está fuera de alcance, en este incremento solo los flujos all-local pueden limpiarla.
- `purgeAthleteScopedRows` / borrado duro de un atleta gestionado usa `athlete-scoped` y **nunca** toca `sessionTemplates`.
- `signOut` conserva su semántica actual (resetea estado, no borra Dexie): el logout oculta la Biblioteca; la limpieza ocurre al cambiar efectivamente a otra cuenta.
- `activeScopeFilter` / estampado de atleta **no aplican**: la entidad es per-cuenta, sin dimensión atleta. No existe guard central de cobertura; la protección son tests negativos (D8).

## D4 — Sync

- `'session_templates'` se agrega a: union `SupabaseTable` (`syncUtils.ts`), `REMOTE_WIPE_ORDER`, y `ENTITY_TIER` con tier **`'B'`** (`syncDiagnostics.ts` es un `Record<SupabaseTable, SyncTier>` exhaustivo — no compila sin la entrada).
- **Pull:** `pullSessionTemplates(userId)` como paso de `pullRemoteAndMerge`, vía `fetchAll` con una **rama temprana `session_templates → eq_user` en `buildPullFilter`** (mantiene la paginación existente). Excepción explícita y comentada: esta tabla jamás filtra por `athlete_id`, aunque el coach tenga memberships.
- **Merge:** compara **todas** las filas —vivas y borradas— con LWW por `updatedAt`; en empate con estados distintos, delete-wins. En empate con el mismo estado gana la versión canónica ya persistida en el destino: en pull es la fila remota (`OLD`, coherente con el trigger SQL) y en merge de backup es la local. Así un empate live/live no deja dos dispositivos divergentes. Un tombstone remoto ganador se guarda en Dexie (la UI lo filtra), no se elimina físicamente. Toda versión local que gane sobre una remota distinta —viva o tombstone, por timestamp o delete-wins— se agenda en `MergeContext.pendingWrites`; nunca se lanza con `void` dentro del merge. Un live local más nuevo que un tombstone remoto es convertido por el trigger de D2 en tombstone versionado y el pull siguiente converge.
- **Reconciliación de ausentes:** tras recorrer el remoto completo, una fila local **ausente** remotamente jamás se borra por ausencia; se **re-pushea** cuando la cola esté drenada y no haya wipe remoto pendiente (cubre importaciones de backup y pushes perdidos). El reset total ya tiene su protocolo propio.
- **Push:** `pushSessionTemplate(template)` vía el patrón `upsertRow` genérico con payload `{ id, user_id, name, kind, payload_version, data, created_at, updated_at, deleted_at }` y la cola offline existente. Sin `ensureRemoteAthlete` ni serialización por atleta.
- **Borrado = upsert, nunca `deleteRow`:** guardar localmente `deletedAt = updatedAt = max(Date.now(), previo.updatedAt + 1)` (mismo valor en ambos, por el check SQL; timestamp monotónico) y `pushSessionTemplate(tombstone)`. En la cola solo existen operaciones `action: 'upsert'` para esta tabla; una op vieja encolada que se drene antes del pull no puede pisar un tombstone gracias al guard `BEFORE UPDATE`.
- **`updatedAt` monotónico** en edit/delete: `max(Date.now(), previous.updatedAt + 1)`.
- **Backup v4:** el envelope pasa a versión 4 e incluye `sessionTemplates` **con tombstones**. Backups v3 y anteriores importan con `sessionTemplates ?? []`. Un envelope con versión **superior** a 4 se rechaza completo (la compatibilidad forward de `UnsupportedSessionTemplate` aplica principalmente a filas remotas, no al envelope). Replace y merge usan el mismo comparador LWW delete-wins.

## D5 — Transformaciones puras (serializer)

Nuevo módulo junto a `coachSessionSerializer.ts`. La semántica de contenido planificable se extrae a helpers compartidos; **no** se llama `applyCoachSessionPatch` con sesiones ficticias. Cuatro transformaciones:

| Función | Uso | Contrato |
|---|---|---|
| `sessionToTemplatePayload(session)` | "Guardar como plantilla" | Allowlist D1 con copia profunda; descarta ejecutados, `metadata` y partido; ejercicios sin `id`/`completed`. Acepta sesiones planificadas o completadas. |
| `templateDraftToPayload(draft)` | Crear desde Biblioteca | Draft del form → payload. **Sí** genera protocolos y defaults deportivos (warmup/cooldown, details por tipo) como el create actual; "sin contenido rico" significa sin enriquecimiento del Plan Builder (drills/bloques curados), no sin defaults. `exercises: []` cae a `undefined` (R28). |
| `applyTemplateDraft(existing, draft)` | Editar plantilla | Pisa solo lo que el form edita; preserva contenido opaco (drills, blocks, warmup/cooldown). Si cambia `type`: recibe el draft visible **completo** (R21), regenera defaults del deporte nuevo y descarta el rico del deporte anterior. |
| `materializeTemplateSession(payload, { date, overlayDraft })` | Aplicar a un atleta | Campos base del payload (rico incluido) + overlay de lo editado en el form. En mismo deporte preserva contenido opaco (`intervalStructure`, drills/blocks, protocolos y metadata de ejercicios) y deriva de nuevo los details afectados por campos visibles (`subtype`, `objective`, `runningTargets`). Si el coach cambió `type`, regeneración R21 y el rico anterior no viaja. UUIDs nuevos por ejercicio, `completed: false`, `status: 'planned'`. |

**Edición y ejercicios sin `id` persistido:** el form de edición construye un mapa efímero `draftExerciseId → ejercicio original del payload` para preservar `warmupSets`, `group` y targets del ejercicio editado. Los ejercicios nuevos no tienen origen. El mapa vive solo en el estado del modal.

## D6 — UI

**Tab Biblioteca** (`CoachWorkspacePage`; `biblioteca.comingSoon: false` en `CoachWorkspaceNav`):

- Lista de plantillas ordenadas por `updatedAt` desc, filtrando tombstones. Fila: nombre, tipo/deporte y duración (las incompatibles: nombre + "Formato no compatible"). Sin filtros/búsqueda en v1.
- Empty state en tuteo: invita a crear la primera o guardar una desde Planificación.
- **Crear:** modal con `SessionForm` en modo plantilla + campo "Nombre de plantilla" (default: sigue al título).
- **Editar:** mismo form prellenado desde el payload; contenido opaco preservado (D5). Deshabilitado para incompatibles.
- **Eliminar:** confirmación con copy que aclara que las sesiones ya asignadas no se modifican; aplica soft-delete; guard síncrono por ref contra doble submit. Disponible también para incompatibles.
- Recarga tras cada CRUD y cuando cambia `lastSuccessfulSyncAt` (no hay `useLiveQuery`).
- **Fallo de pull:** se muestra el contenido Dexie (incluso empty state) con un aviso de que no pudo actualizarse; crear y guardar siguen habilitados (Dexie-first).

**`SessionForm` — prop discriminada `mode: 'session' | 'template'`:** en modo plantilla oculta fecha **y** rival/resultado/games (el payload los descarta; mostrarlos sería engañoso) y adapta mensajes de error.

**Planificación (`CoachPlanningPanel`):**

- **"Desde plantilla"** junto a "Agregar sesión" en cada día, **bajo `canMutate`** (crea sesión y recalcula la semana). Abre un picker simple (con empty state si no hay plantillas) → `CoachSessionModal` prellenado (`payload` → draft, fecha = día elegido) → al confirmar, **`createSessionFromTemplateForAthlete(...)`**: `createSessionForAthlete` actual solo acepta `CoachSessionDraft` y no puede recibir el contenido rico materializado, así que se extrae un **core compartido** (hidratación, roster, lease, transacción, estampado, recálculo de summary) que ambos caminos consumen sin duplicar nada; el camino plantilla le entrega los campos de `materializeTemplateSession`.
- **"Guardar como plantilla"** como acción del `<article>` propio del panel (no del `SessionCard` global de Weekly/Day). **No** depende de la hidratación ni de `canMutate`: no muta datos del atleta y debe funcionar offline. Dialog de nombre (default: título) → `sessionToTemplatePayload` → save + push.
- Errores: banner del patrón actual del panel; copys en tuteo.

## D7 — Casos borde

- **Picker abierto y borrado remoto concurrente:** aplicar usa la copia local viva de Dexie; si el pull ya trajo el tombstone, el refresh del picker la filtra. Materializar desde la copia local que el coach estaba viendo es aceptable.
- **Edición abierta durante un borrado remoto:** a diferencia del picker, guardar podría resucitar localmente. Al submit se **relee Dexie**: si la fila está borrada o es incompatible, se rechaza con mensaje; si sigue viva pero cambió, se calcula un patch de los campos visibles comparando el draft enviado con `openedVersion` y se aplica sobre la versión local más reciente. Un campo visible concurrente que el usuario no tocó se preserva. Los cambios **opacos** a nivel sesión (drills/bloques/warmup/cooldown) concurrentes se preservan; para el **array de ejercicios** la promesa es más limitada: al no persistir IDs, el mapa efímero solo preserva metadata de la versión que el modal abrió — ante una edición concurrente del array, la lista visible resultante es last-writer-wins.
- **Conflicto edit-vs-delete entre dispositivos:** LWW; un live más nuevo que un tombstone termina igualmente en tombstone versionado (D2/D4) y todos los dispositivos convergen; empate exacto → delete-wins. Sin resurrección.
- **`kind`/`payloadVersion` desconocidos:** tratamiento `UnsupportedSessionTemplate` (D1).

## D8 — Testing

- **Transformaciones (unit):** allowlist con copia profunda (mutar la sesión origen no altera el payload); descarte de ejecutados + `metadata` + partido; ejercicios sin `id`/`completed`; `materializeTemplateSession` con UUIDs nuevos, `completed: false`, `status: 'planned'`; conserva `runningDetails.intervalStructure`; cambios visibles de squash/ciclismo regeneran sus details sin borrar lo opaco; `applyTemplateDraft` preserva opaco y aplica R21; `exercises: []` → `undefined` (R28); `updatedAt` monotónico con reloj congelado.
- **Dexie:** upgrade real v17→v18 siguiendo `dbV17Upgrade.test.ts` (crear base v17, cerrarla y abrirla con `EntrenadorDB`; **no** borrar entre aperturas). Lifecycle negativo: borrado duro de un atleta gestionado conserva la Biblioteca; cambio efectivo de cuenta la limpia.
- **Sync:** pull filtra solo `user_id` (test negativo con memberships presentes); merge LWW de vivas+borradas con delete-wins en empate; tombstone remoto se persiste, no se borra; un empate live/live adopta la fila remota canónica; **convergencia simétrica**: local viva o tombstone ganadora se re-pushea mediante `pendingWrites`, incluido local tombstone vs remoto vivo; un live local más nuevo que un tombstone remoto termina convergiendo a tombstone versionado tras push+pull; **fila local ausente remotamente se re-pushea** (cola drenada, sin wipe pendiente) y nunca se borra por ausencia; replay de cola para create/edit/delete verificando `action: 'upsert'` siempre — **nunca** una op `delete` para `session_templates`; `ENTITY_TIER` exhaustivo (garantía de compilación).
- **Servicio:** aplicar plantilla conserva las garantías de `createSessionForAthlete` — hidratación previa, validación de roster, `athleteId` correcto, fecha destino, `status: 'planned'`, autoría y recálculo del summary.
- **Backup:** import v3 → `sessionTemplates` `[]`; round-trip v4 con tombstones y una fila incompatible raw; merge con delete-wins; envelope > v4 rechazado completo.
- **UI (jsdom + Testing Library):** lista/empty/incompatible; eliminar con confirmación y guard de doble submit; form en modo plantilla oculta fecha/rival/resultado; editar preserva opaco y relee Dexie al submit; picker con empty state; aplicar prellenado + materialización; guardar como plantilla sin hidratación (offline).
- **SQL:** smoke manual `BEGIN … ROLLBACK` de D2 (RLS, stale rechazado, delete-wins, tombstone inmutable).
- **Regresión:** `npm run lint && npm test && npm run build`.

## Extensiones futuras (no en este incremento)

- Semanas plantilla (`kind: 'week'`) con el mismo patrón de entidad y sync.
- Grupo selectivo `library` en `LocalDataGroup` + `mapSelectionToRemoteTables` si Settings ofrece borrar la Biblioteca.
- Restauración explícita de plantillas borradas (hoy el tombstone es terminal).
- Purga física de tombstones antiguos.
- Edición rica de drills/bloques en Biblioteca.

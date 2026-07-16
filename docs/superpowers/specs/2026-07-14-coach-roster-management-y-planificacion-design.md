# Coach Workspace: gestión de roster (archivar/eliminar) + tab Planificación — Design

**Fecha:** 2026-07-14 (rev. 3 tras segunda revisión del owner)
**Estado:** aprobado en brainstorming; rev. 2 incorporó 6 hallazgos de la primera
revisión; rev. 3 resuelve rollback del borrado, visibilidad de membership y operaciones
en vuelo.

## Contexto

`/coach` (Coach Workspace v0) tiene Resumen y Alumnos con contenido real; Planificación,
Biblioteca y Asistente IA son placeholders. No existe ninguna forma de archivar ni
eliminar un atleta gestionado: el roster solo crece. El modelo de datos ya contempla
`status: 'archived'` (`listOwnedAthletes` filtra `status === 'active'`; los tests ya usan
filas archivadas), pero no hay API ni UI.

Estado real del repo (más avanzado que el roadmap): Dexie está en **v17**
(`athleteMemberships`, `athleteCoachNotes`) y las migraciones `013a/b/c` de SP1a existen
en `supabase/`. Este spec asume ese estado y no depende de si `013` está aplicada remota.

Este spec cubre **dos incrementos** decididos en brainstorming:

1. **Gestión de roster:** archivar, restaurar y eliminar definitivamente atletas
   gestionados propios **no reclamados**.
2. **Tab Planificación v1:** vista semanal **read-only** de cualquier atleta del roster,
   sin hacer switch de contexto, con hidratación remota explícita.

Biblioteca y Asistente IA quedan explícitamente fuera (specs futuros).

## Objetivo

- El coach puede sacar del roster a un atleta que ya no entrena (archivar, reversible) y
  borrar del todo sus datos cuando corresponda (eliminar definitivamente, irreversible).
- El coach puede revisar la semana de cualquier atleta desde `/coach` sin cambiar su
  contexto activo, y saltar a "entrenar como" ese atleta solo cuando necesita editar.
- De paso queda construida la **capa de lectura multi-atleta** (lectura pura +
  hidratación explícita) que el roadmap marcó como prerequisito de las señales
  computadas de Resumen.

## No-alcance

- Biblioteca y Asistente IA (siguen como placeholders).
- Escritura cross-atleta (editar sesiones de un atleta no activo).
- Señales computadas en Resumen (la capa de lectura las habilita, pero no se construyen).
- Cambios de schema: **ninguna migración Supabase nueva ni bump de Dexie** (queda en v17).
- Archivar/eliminar atletas **reclamados** (con login propio): fuera de alcance hasta
  que SP1 defina semántica por membresía (ver Decisiones y Restricción forward).

## Decisiones de diseño

| Decisión | Elección |
|---|---|
| Semántica de eliminación | Dos niveles: archivar (reversible) + borrado duro (irreversible, solo desde archivados) |
| Elegibilidad | **Solo atletas no reclamados**, determinado por `linkedAccountId === null` (ver Restricción forward SP1b). `status` es global del atleta y el cascade de `013b` borra memberships: archivar/borrar un reclamado afectaría al login del atleta. Los servicios (archivar, restaurar y borrar) rechazan inelegibles; la UI ni ofrece la acción. |
| Archivados visibles | Sí: sección colapsada "Archivados" en tab Alumnos con Restaurar y Eliminar definitivamente |
| Capa de lectura multi-atleta | Servicio nuevo por `athleteId` explícito, separado en **lectura pura Dexie** + **hidratación remota on-demand**; no se generaliza `activeScopeFilter` ni se hace switch temporal |
| Borrado remoto | API pública nueva en syncService con contrato `deleted \| durably_queued \| failed`, **sin drain interno de la cola**, + FK cascade de `007`/`011`/`012`/`013b`; no se borra tabla por tabla desde el cliente |
| Orden del borrado | Nada destructivo sobre la cola antes de conocer el resultado remoto; supresión de ops y descarte de jobs son **post-éxito** (ver Secuencia) |
| Planificación v1 | Read-only; editar = CTA "Entrenar como este atleta" (switch existente) |

### Restricción forward (SP1b) — elegibilidad y claims

La RLS de `athlete_memberships` (`013b`) solo deja leer filas con
`account_id = auth.uid()`: el coach **no puede** ver la membership `self` de otra
cuenta, y el futuro `redeem_claim_self` crea la membership **sin** actualizar
`linked_account_id`. Por lo tanto:

- **Este incremento:** elegibilidad = `linkedAccountId === null` (más owner y no-self).
  Hoy es exacto: no existe ningún flujo de claim en producción.
- **Obligación para SP1b:** antes de habilitar `claim_self`, SP1b debe introducir un
  chequeo server-authoritative (p. ej. RPC `is_managed_athlete_claimed(athlete_id)` o
  que el claim también estampe `linked_account_id`), y este gate de elegibilidad debe
  migrar a ese chequeo. Queda anotado como dependencia dura en el spec de SP1.

## Diseño — Parte 1: gestión de roster

### Prerequisito: el path de borrado de `athletes` en sync hoy no es offline-safe

Hallazgos verificados que este spec exige corregir (no asumir):

- `deleteRow` es privado en `syncService.ts` y su error no-reintentable se loguea sin
  propagarse al caller — un servicio no puede saber si el delete remoto ocurrió.
- El drain de la cola ejecuta **todos** los deletes con `.eq('user_id', ...)`;
  `athletes` no tiene `user_id` (usa `owner_account_id`) → un delete de `athletes`
  encolado offline falla siempre.
- `rememberDeleteTombstoneForTable` solo cubre `sessions` y `coach_proposals`; no hay
  tombstone de `athletes`.

### Nueva API pública de sync: `deleteManagedAthleteRemote`

`syncService` expone `deleteManagedAthleteRemote(ownerAccountId, athleteId)` con
resultado explícito:

- `'deleted'` — el delete remoto corrió (o el atleta ya no existía remotamente).
- `'durably_queued'` — offline o error reintentable: quedó en cola **con path de drain
  correcto para `athletes`** (delete por `owner_account_id`, no `user_id`) y tombstone
  durable de `athletes`.
- `'failed'` — error no-reintentable: **se propaga al caller**; el servicio de dominio
  NO purga local en este caso.

Propiedades:

- **No drena la cola internamente** (a diferencia del `deleteRow` privado actual, que
  llama `drainQueue()` tras el éxito). El drain con ops hijas del atleta dispararía
  `ensureRemoteAthlete` y podría recrear al atleta recién borrado; acá la supresión de
  esas ops ocurre después, en la secuencia del dominio.
- Tombstone de `athletes` en `rememberDeleteTombstoneForTable`, respetado por
  `pullAthletes`/merge para no re-materializar al atleta desde remoto.

### Barrera de borrado por atleta (operaciones en vuelo)

Suprimir la cola solo cubre ops **pendientes**; no cubre un upsert que ya pasó por
`ensureRemoteAthlete` y está esperando red, ni las escrituras Dexie que
`onWeekUpdate` del generation runner hace mientras `generatePlanWeeks` corre (su
chequeo de cancelación es posterior). El spec exige una **barrera exclusiva por
`athleteId`**:

- Mientras exista el tombstone `deleting` de un atleta, **ningún upsert/enqueue
  athlete-scoped NUEVO de ese atleta puede comenzar**. Los guards viven en las
  **funciones de entrada** (`upsertRow`, la entrada de session-completion, y los
  writes de pulls vía lease de escritura); `enqueue` **no** tiene guard propio:
  todos sus call sites son paths de retry/offline de ops ya admitidas, que deben
  poder re-encolarse. `ensureRemoteAthlete`/`ensureRemoteManagedAthleteOnce`
  rechazan recrear un atleta tombstoned. Invariantes explícitas:
  - El **delete canónico** (`table='athletes'`, `action='delete'`,
    `payload.id === athleteId`) siempre puede encolarse y drenar — es el mecanismo de
    `durably_queued`, no una op del atleta a suprimir.
  - Una op **admitida antes de adquirir la barrera** puede terminar y, si falla
    reintentable, **encolar su retry** (los guards bloquean comienzos, no finales).
    Ese retry sobrevive a un `failed` y lo elimina la Fase B en caso de éxito.
- Antes del delete remoto, la barrera **espera a que terminen las ops de sync en
  vuelo** de ese atleta (integrándose con la serialización por entidad existente,
  `withSerializedEntityMutation`; detalle en el plan).
- El generation runner del atleta se **aborta y se espera su promesa** antes del
  delete; además sus callbacks (`onWeekUpdate` y el put posterior) quedan protegidos
  con un guard de tombstone para que un run zombie no escriba Dexie de un atleta en
  borrado.

### Secuencia del borrado duro (`deleteManagedAthletePermanently`)

Precondiciones (validadas en servicio, no solo UI): atleta existe, es del owner, **no es
el self**, **no está reclamado** (`linkedAccountId === null`), y `status === 'archived'`.

Fase A — reversible (nada de la cola se pierde):

1. Adquirir la **barrera de borrado** + tombstone durable `deleting`.
2. Abortar el generation runner del atleta y **esperar su promesa**. (Único efecto no
   restaurable de esta fase: una generación en curso queda abortada. Se documenta como
   pérdida aceptada — un job es relanzable; no son datos del atleta.)
3. Esperar a que las ops de sync en vuelo del atleta terminen (barrera).
4. **Delete remoto** vía `deleteManagedAthleteRemote`.
   - `'failed'` → **rollback:** retirar tombstone, liberar barrera, mensaje al usuario.
     La cola quedó intacta (no se suprimió nada) y no se purgó nada local.

Fase B — solo con `'deleted'` o `'durably_queued'`:

5. **Suprimir la cola:** eliminar toda op cuyo `payload.athlete_id` (o entidad
   equivalente) pertenezca al atleta, **excepto el delete canónico pendiente de
   `athletes`** (con `durably_queued`, esa op ES el borrado remoto: suprimirla dejaría
   el atleta vivo en Supabase para siempre). El drain exitoso consume ese delete de la
   cola pero **conserva el tombstone** de borrado.
6. **Descartar definitivamente** los `planGenerationJobs` del atleta.
7. **Purga local en UNA transacción Dexie**, tablas athlete-scoped completas:
   `sessions`, `dayLogs`, `weekSummaries`, `chatMessages`, `coachProposals`,
   `athleteProfiles`, `trainingPlans`, `trainingPlanWeeks`, `planGenerationJobs`,
   `readinessDaily`, `whoopWorkouts`, `athleteMemberships`, `athleteCoachNotes`, y la
   fila `athletes` **al final**. La transacción hace la idempotencia trivial: o corre
   entera o no corre.
8. **Limpieza de chat storage** con helper nuevo por atleta explícito:
   `clearStoredChatSessionIdForAthlete(athleteId)` — la limpieza actual
   (`clearStoredChatSessionId`) deriva la key del **atleta activo**, y como el flujo ya
   hizo switch al self, borraría la key legacy del owner. El helper nuevo calcula la
   key sufijada desde el parámetro.
9. Liberar la barrera. El tombstone durable persiste (protege contra re-materialización
   y hace el retry idempotente).
10. Idempotente: repetir sobre un atleta ya borrado (tombstone presente, filas
    ausentes) devuelve éxito sin fallar.

### Archivar / restaurar

- `archiveManagedAthlete(ownerAccountId, athleteId)` — precondiciones de elegibilidad
  (owner, no-self, no reclamado); set `status: 'archived'`, `updatedAt`, push remoto
  (reusa `pushAthlete`).
- `restoreManagedAthlete(ownerAccountId, athleteId)` — **mismas precondiciones de
  elegibilidad**; vuelve a `active` + push.
- `listArchivedAthletes(ownerAccountId)` — espejo de `listOwnedAthletes` con
  `status === 'archived'`.
- Servicios en `src/services/athlete/managedAthletes.ts`.

### Flujo cuando el atleta afectado es el activo

Antes de archivar (o eliminar) al atleta activo, la UI hace switch automático al self
vía `switchActiveAthlete`, bajo el **mismo lock de módulo** de `coachWorkspaceActions`
(archivar/eliminar entran a la misma serialización que switch/crear). Si el switch
falla, la acción se aborta con mensaje; nunca se archiva/borra al atleta activo.

### UI (tab Alumnos)

- Cada atleta gestionado no-self y no reclamado: acción secundaria **Archivar** con
  confirmación ligera (inline o confirm simple).
- Sección colapsada **"Archivados (N)"** al final del tab: por atleta, **Restaurar** y
  **Eliminar definitivamente**.
- Eliminar definitivamente abre confirmación fuerte: el usuario debe **escribir el
  nombre del atleta** para habilitar el botón. La regla de habilitación vive en una
  **función pura exportada** (p. ej. `isDeleteConfirmed(input, displayName)`) testeada
  directo — `renderToStaticMarkup` no puede ejercitar el typing. Copy honesto: borra
  datos locales y remotos, irreversible.
- Estados pending/disabled y banner de error siguen el patrón existente
  (`PendingAthleteAction` se extiende con `kind: 'archive' | 'restore' | 'delete'`).

## Diseño — Parte 2: tab Planificación (read-only)

### Capa de lectura — `src/services/athlete/coachScopedReads.ts` (nuevo)

Dos funciones con responsabilidades separadas, ambas con `ownerAccountId` explícito y
validación de acceso (el atleta debe pertenecer al roster del owner; si no, error):

- `getWeekSessionsForAthlete(ownerAccountId, athleteId, weekStartDate)` — **lectura
  pura Dexie** por la semana (índices existentes `weekStartDate`/`date`) filtrada por
  `athleteId` explícito.
- `hydrateWeekForAthlete(ownerAccountId, athleteId, weekStartDate)` — **pull remoto
  explícito** de las sesiones de esa semana/atleta hacia Dexie, sin tocar el contexto
  activo ni `resolveReadScope()` (que depende de `getActiveAthleteId()`; el sync normal
  solo baja datos del atleta activo, así que un atleta no visitado en un dispositivo
  nuevo tendría semana vacía sin este pull). **Para el self, el pull remoto incluye
  también las filas legacy (`athlete_id IS NULL`) del owner** — misma política que la
  lectura local. Merge conservador: upsert por id con LWW `updatedAt`, respetando
  tombstones de sesión.

- **Regla legacy idéntica a `activeScopeFilter`:** filas unscoped (`athleteId` ausente)
  se incluyen **solo** si el atleta pedido es el self. Un gestionado jamás ve filas
  legacy. Cubierta por test.
- Contrato del módulo: `getWeekSessionsForAthlete` nunca escribe;
  `hydrateWeekForAthlete` solo escribe `sessions` de ese atleta; ninguna llama
  `getActiveAthleteId()` ni importa `activeScopeFilter`.
- Este módulo es la base declarada para futuras señales computadas de Resumen.

### UI (tab Planificación)

- Selector de atleta (roster activo, self incluido; preseleccionado el atleta activo).
- Navegación de semana: anterior / actual / siguiente.
- Al seleccionar atleta/semana: render inmediato desde Dexie + `hydrateWeekForAthlete`
  en background con re-render al llegar (stale-while-revalidate simple). Dos reglas:
  - **Sin cache local y con hidratación inicial en curso → estado "cargando"**, no el
    empty state definitivo ("semana sin sesiones" solo se afirma con la hidratación
    resuelta o fallida).
  - **Respuestas tardías se descartan** si el usuario cambió de atleta o semana
    mientras la hidratación estaba en vuelo (guard por token/epoch de selección).
- Lista read-only agrupada por día: título, deporte, duración y estado — los **cuatro**
  estados reales de `Session.status`: `planned`, `completed`, `adjusted`, `skipped`.
  Empty state honesto para semanas sin sesiones (ya hidratadas).
- CTA **"Entrenar como este atleta"** (reusa `handleAthleteAction` + lock) para editar.
- Carga/error con el patrón `RosterStatus` + banner existente.
- Se elimina el placeholder de Planificación; Biblioteca y Asistente IA conservan el suyo
  (los tests que cuentan `pronto` pasan de 3 a 2).

## Manejo de errores

- Archivar/restaurar: una sola escritura Dexie + push best-effort (patrón
  `createManagedAthlete`); si Dexie falla, mensaje y sin cambio de estado.
- Borrado duro: `'failed'` remoto → rollback de Fase A (tombstone fuera, barrera
  liberada, cola intacta, cero purga; única pérdida aceptada: la generación en curso
  abortada). `'durably_queued'` continúa Fase B (tombstone + supresión protegen la
  ventana). Purga local transaccional.
- Lecturas de Planificación: error de hidratación remota degrada a datos locales con
  aviso discreto; error de lectura local → banner + reintentar, sin romper el resto del
  workspace.

## Edge conocido (aceptado y documentado)

Con delete `durably_queued`, otro dispositivo puede pushear datos del atleta antes de
que el delete remoto corra; el tombstone durable de `athletes` en este dispositivo evita
re-materializarlo localmente, y el delete remoto (cascade) limpia lo pusheado al drenar.
La ventana multi-dispositivo restante es el mismo trade-off del resto del sistema de
deletes.

## Testing

- **Servicios** (fake-indexeddb, patrón existente):
  - self y atletas reclamados (`linkedAccountId` presente) no archivables /
    restaurables / eliminables (servicio lanza);
  - delete exige `archived`;
  - purga local cubre TODAS las tablas athlete-keyed (incl. `trainingPlans`,
    `trainingPlanWeeks`, `planGenerationJobs`) en una transacción;
  - idempotencia del delete (segunda corrida no falla);
  - **rollback en `failed`:** la cola conserva sus ops, el tombstone se retira y no se
    purga nada;
  - `delete offline → drain`: el delete encolado de `athletes` corre con
    `owner_account_id` y tombstone;
  - ops hijas pendientes suprimidas post-éxito: el drain no re-upsertea al atleta
    borrado (`ensureRemoteAthlete` respeta tombstone);
  - **`durably_queued` end-to-end:** tras la Fase B offline, la cola contiene
    exactamente el delete canónico de `athletes`; al drenar, la op desaparece de la
    cola, el atleta remoto queda ausente y el tombstone persiste;
  - **push en vuelo intercalado con delete:** un upsert athlete-scoped ya iniciado
    termina (o se re-encola) sin recrear al atleta ni colarse tras la purga — la
    barrera lo espera y el tombstone bloquea nuevos comienzos;
  - generación activa: runner abortado y esperado antes del delete; un callback
    zombie de `onWeekUpdate` no escribe Dexie con tombstone presente;
  - `clearStoredChatSessionIdForAthlete` borra la key del atleta correcto tras el
    switch al self;
  - `listArchivedAthletes`;
  - `coachScopedReads`: legacy self-only (local y en el pull del self), validación de
    roster/owner, no-escritura de la lectura pura, hidratación en dispositivo "nuevo"
    (Dexie vacío + remoto con sesiones → semana visible).
- **UI** (`renderToStaticMarkup`, convención del proyecto): sección Archivados, modal de
  confirmación (estructura), selector + semana read-only con 4 estados, loading vs
  empty state (sin cache + hidratación en curso ≠ semana vacía), contador `pronto`
  actualizado a 2. La habilitación por nombre se testea vía la función pura
  `isDeleteConfirmed`; el descarte de respuestas tardías se testea vía la función/guard
  de selección extraída (patrón de funciones inyectables de `coachWorkspaceActions`).
- **Smoke Playwright** (`scripts/e2e-coach-test.mjs`): paso destructivo
  archivar→restaurar detrás de `--apply`.
- Reglas del proyecto respetadas: nada de `'default'` literal; lecturas nuevas no pasan
  por `activeScopeFilter` **por diseño explícito de este spec** (módulo read-only por
  `athleteId`, documentado como excepción junto a sync/export).

## Riesgos

- **Cascade remoto:** `007` define FK cascade para las tablas core; `011`/`012`/`013b`
  para Whoop y memberships. El plan verifica cada FK antes de confiar en el cascade; si
  alguna tabla remota no lo tiene, se agrega delete remoto explícito para esa tabla
  dentro de `deleteManagedAthleteRemote` (sin migración).
- **Tocar syncService:** el fix del drain (`owner_account_id` para `athletes`), el
  tombstone nuevo y la barrera tocan el path compartido de deletes/upserts; los tests
  existentes de `syncService.test.ts` deben seguir en verde y se agregan casos
  específicos.
- **Lock compartido:** archivar/eliminar reusan el lock de módulo existente; el gap
  documentado con `CoachContextBar` (lock no compartido) se mantiene igual que en v0.

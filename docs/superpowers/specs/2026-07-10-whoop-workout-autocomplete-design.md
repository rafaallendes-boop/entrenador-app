# Whoop Workout Auto-Complete — Design

Fecha: 2026-07-10
Estado: aprobado (brainstorming con el owner)

## Objetivo

Cuando Whoop registra un entrenamiento, RallyIQ debe detectar si existe una sesión
planificada del mismo deporte ese día y marcarla automáticamente como completada,
para que la adherencia se actualice sin intervención manual. El usuario siempre
puede editar la sesión después.

## Decisiones de producto (cerradas con el owner)

- **Ventana:** últimos 7 días (ventana del sync Whoop → Supabase). El pull
  cliente usa 14 días (espejo de `pullReadiness`); si un workout más viejo quedó
  sin procesar porque la app no se abrió, se procesa igual — mismo espíritu de
  la decisión. Una sesión aún `planned` de hace días se completa si aparece su
  workout.
- **Datos reales:** al completar se rellena solo `actualDurationMin` (duración
  del workout). `actualRpe` queda **vacío**: el invariante existente del
  codebase (`dayLogPrefillSave.ts` / `collectActualRpeValues`) establece que un
  esfuerzo objetivo de Whoop nunca debe sembrar `Session.actualRpe`, porque
  alimenta ACWR/carga (`sessionWeightedLoad` usa `actualRpe ?? rpe`). El strain
  del workout queda disponible en la fila de `whoop_workouts`, y el esfuerzo
  diario lo sigue manejando el prefill existente de check-in.
- **Comentario de cierre:** al auto-completar, si la sesión no tiene
  `completionNotes` manuales, se agrega un comentario corto generado por sistema
  con los últimos 3 workouts Whoop del atleta self disponibles en la ventana
  local, ordenados por `start_at desc`. Debe incluir el workout matcheado cuando
  esté dentro de esos 3. Ejemplo:
  `Whoop: ultimos entrenamientos: 2026-07-10 squash 48 min; 2026-07-08 strength 62 min; 2026-07-06 running 35 min.`
  No escribe `actualRpe`, no pisa notas existentes y queda editable por el
  usuario.
- **Mapeo de deportes (conservador ampliado),** por `sport_name` de Whoop v2
  **normalizado** (lowercase, trim, espacios/guiones bajos colapsados):
  - `squash` → `squash`
  - `running` → `running`
  - `cycling` → `cycling`
  - `weightlifting`, `functional fitness`, `strength trainer`, `hiit`,
    `powerlifting` → `strength`
  - `yoga`, `pilates`, `stretching` → `mobility`
  - Cualquier otro (incl. `box fitness`, tenis, padel, caminata) → sin match
    (se registra `unmapped_sport`, solo log). La tabla es una constante de una
    línea por deporte, trivial de extender.
- **Reconexión por scope nuevo:** `read:workout` se agrega a `WHOOP_SCOPES`.
  Conexiones existentes sin ese scope siguen sincronizando readiness sin error;
  Settings muestra aviso "Reconecta Whoop para sincronizar entrenamientos".
- **Arquitectura:** pipeline espejo de readiness (opción A): servidor → tabla
  Supabase client-read → pull a Dexie → matcher cliente sobre `updateSession()`.

## Reglas duras del matching

1. No completar workouts de menos de **15 minutos** (duración `end - start`).
2. Solo se completan sesiones con `status === 'planned'`. `completed`,
   `adjusted` y `skipped` quedan excluidas por construcción.
3. Si hay **2+ sesiones planned del mismo deporte el mismo día**: no elegir
   arbitrariamente. Se registra `skipped_multiple` y no se hace nada. El matcher
   delega en `resolveAmbiguousMatch(workout, candidates)`, que hoy devuelve
   `null` siempre — punto de extensión para la futura resolución (p. ej. por
   `timeBlock` vs hora de inicio del workout).
4. Un workout completa **una sola vez**, con idempotencia durable
   cross-device: el marcador es `session.autoCompletion.workoutId`, que viaja
   en el sync de sessions. El set de `workoutId` bloqueados se construye
   escaneando **todas** las sesiones locales que llevan `autoCompletion`
   (cualquier fecha, cualquier status), **no** solo las del día de los
   workouts — así, si el usuario mueve la sesión auto-completada a otra fecha
   o la revierte a `planned`, su marcador sigue bloqueando ese workout en
   cualquier dispositivo: la edición manual gana. El estado local
   `whoopWorkouts.autoComplete` es caché/telemetría, no fuente de verdad.
5. Whoop es self-only: solo se auto-completan sesiones del atleta self, y el
   matcher solo corre cuando el atleta activo es el self (mismo gating que el
   prefill de check-in). Al volver al self se procesan los pendientes.

## Fuente de datos (API Whoop v2)

Endpoint `GET /v2/activity/workout` (scope `read:workout`), colección paginada
igual que recovery/sleep/cycles. Campos relevantes del `WorkoutV2`:

- `id` (uuid) — identificador estable del workout.
- `sport_name` (string, requerido) — fuente del deporte. `sport_id` está
  deprecado (no existe desde 09/2025) y **no** se usa.
- `start` / `end` / `timezone_offset` — fecha local y duración.
- `score_state` — `SCORED | PENDING_SCORE | UNSCORABLE`.
- `score` (solo `SCORED`) — `strain`, `average_heart_rate`, `max_heart_rate`,
  `kilojoule`, `distance_meter?`.

El matching solo necesita deporte + timestamps, así que workouts `PENDING_SCORE`
y `UNSCORABLE` también pueden completar sesiones. Las métricas de score (strain,
HR) se persisten en `whoop_workouts` cuando existen, pero no alimentan campos de
la sesión.

## Arquitectura

### Servidor (Netlify functions `_shared`)

- **`whoopOAuth.ts`:** `WHOOP_SCOPES` agrega `read:workout`.
- **`whoopClient.ts`:** `fetchWhoopData` gana la opción `includeWorkouts` y,
  cuando es true, agrega `/v2/activity/workout` al `Promise.all` (misma
  `getCollection`, misma ventana `days`). `WhoopRaw` gana
  `workouts: unknown[] | null`: **`null` = colección NO obtenida** (omitida, o
  401/403), **`[]` = obtenida y vacía**. Esta distinción es crítica: habilita la
  reconciliación autoritativa del server sin borrar por falta de autorización.
  Defensa en profundidad: un 401/403 **específico de la colección de workouts**
  devuelve `null` sin romper readiness (cubre scopes guardados desactualizados).
- **`whoopSync.ts`:** `WhoopSyncDeps` gana `upsertWorkouts` y `reconcileWorkouts`;
  `runWhoopSync` calcula `includeWorkouts` desde `conn.scopes` (contiene
  `read:workout`), lo pasa a `fetchWhoopData` y, **solo si `raw.workouts !== null`**,
  persiste (`upsertWorkouts`) y **reconcilia la ventana consultada**
  (`reconcileWorkouts`) — el **cron** alimenta workouts sin orquestación nueva.
  **Reconciliación autoritativa server-side (WHOOP no expone borrados):** un
  workout eliminado upstream simplemente deja de venir en el fetch; como el
  upsert nunca borraría esa fila de Supabase, `reconcileWorkouts` borra de la
  ventana las filas ausentes del set recién obtenido. **Ventana única y
  autoritativa, por instante:** tanto el cliente (pull + matcher) como el server
  filtran por **`startAt`/`start_at` (INSTANTE ISO)**, nunca por `date` completa
  — así un workout con la fecha local del corte pero instante anterior queda
  fuera en ambos lados (antes el cliente filtraba por `date` y podía descargarlo/
  matchearlo aunque el server no lo reconciliara). El cliente procesa
  `WHOOP_WORKOUT_WINDOW_DAYS` (14); el server **obtiene y reconcilia una ventana
  más ancha, `14 + WHOOP_WORKOUT_RECONCILE_MARGIN_DAYS` (margen ≥ 1 intervalo de
  cron)**, no por el `days=7` de readiness. El margen cubre el desfase del cron:
  los datos de Supabase pueden estar ~1 intervalo desactualizados respecto al
  "ahora" del cliente, así que el borde viejo que un cliente puede descargar debe
  seguir dentro de lo reconciliado (sin margen, un workout borrado hace 14-16
  días quedaría stale y el matcher podría consumirlo). `runWhoopSync` computa un
  **único instante ISO** de inicio de ventana y lo pasa tanto a `fetchWhoopData`
  como a `reconcileWorkouts`; la reconciliación filtra por **`start_at >=
  windowStartIso`** (timestamp, espejo del filtro temporal de WHOOP). Tres casos: (a) **fetch exitoso** →
  upsert + borrar ausentes; (b) **colección omitida / 401/403**
  (`raw.workouts === null`) → no borrar nada; (c) **error general de fetch** →
  `runWhoopSync` falla antes de tocar workouts. Sin esta capa, el cliente (que
  compara Dexie contra Supabase) nunca vería el borrado, porque Supabase
  conservaría la fila stale. `reconcileWorkouts` requiere extender el
  `QueryBuilder` productivo con `gte`/`not` (hoy solo `eq`/`in`/`lt`). Fix
  necesario en el
  merge del refresh: hoy `{ ...conn, ...refreshed }` pisa `scopes` con
  `undefined` cuando WHOOP no devuelve `scope` en la respuesta de refresh (y
  `upsertConnection` lo persiste como `null`); el merge debe **preservar los
  scopes existentes** cuando el refresh no los trae. Para el refresh en sí: con
  scopes concedidos guardados los reenvía tal cual, y **sin** scopes guardados
  **omite** el parámetro `scope` (OAuth2 conserva los del grant original).
  Pedir solo `offline` es innecesario y arriesga estrechar el access token en
  algunas implementaciones OAuth; reenviar los scopes guardados es lo seguro.
  **Caveat de validación:** la doc oficial de WHOOP muestra refresh con
  `scope=offline` conservando los demás scopes, así que la afirmación de que
  `offline` *necesariamente* estrecha no está plenamente confirmada — el camino
  legado que **omite** `scope` debe probarse contra WHOOP real antes del rollout
  (ver checklist operativo).
- **`whoopNormalize.ts`:** nueva `normalizeWorkouts(raw)` con el mismo rigor v2:
  fecha local anclada por `start` + `timezone_offset` (patrón de cycles; un
  workout que cruza medianoche pertenece a la fecha local de su `start`),
  `sport_name` crudo, `duration_min` desde timestamps, tri-estado `score_state`,
  y métricas de score solo si `SCORED`. Registros malformados se descartan.
- **`supabase/012_whoop_workouts.sql`:** tabla `whoop_workouts`:
  `user_id`, `athlete_id` (first-class), `workout_id` UNIQUE (clave de
  idempotencia del upsert), `date`, `sport_name`, `start_at`, `end_at`,
  `duration_min`, `strain`, `avg_hr`, `max_hr`, `distance_m`, `score_state`,
  `updated_at`. RLS idéntica a `readiness_daily`: escritura server-only,
  lectura client del propio `athlete_id`. SP1 la migrará al helper
  `auth_athlete_ids()` igual que `readiness_daily`, sin mover datos.
- **Lifecycle:** desconexión/borrado completo incluye `whoop_workouts`
  (service-role, tolerancia a 404/tabla ausente); export/backup y wipe local
  también la incluyen.

### Cliente

- **Dexie v16:** tabla `whoopWorkouts` — índices `id, date, athleteId,
  &workoutId`. La fila guarda datos del workout + estado de matching:
  `autoComplete?: { status: 'completed' | 'skipped_short' | 'skipped_multiple'
  | 'no_session' | 'unmapped_sport'; sessionId?: string; processedAt: number }`.
  Estados **terminales**: `completed`, `skipped_short`, `unmapped_sport`,
  `skipped_multiple`. `no_session` es **re-evaluable**: se reintenta en cada
  corrida mientras el workout esté en ventana (cubre sesiones remotas que
  llegan a Dexie después del primer intento). `skipped_multiple` queda
  terminal a propósito: la desambiguación tardía es trabajo del futuro
  `resolveAmbiguousMatch`, no de una re-evaluación silenciosa días después.
  Test de upgrade real v15→v16 (fake-indexeddb, patrón del proyecto).
- **`pullWorkouts()`** (espejo de `pullReadiness`, ventana 14 días **por
  `start_at`/`startAt` INSTANTE ISO — no por `date`**, filtrado por `athlete_id`
  activo) con **merge-put**: preserva `autoComplete` local al refrescar filas
  desde Supabase (nunca `bulkPut` ciego). El query remoto usa `.gte('start_at', sinceIso)`
  y el reconcile local `row.startAt >= sinceIso`, alineados con el filtro por
  instante del server. **Canonicalización:** el mapeo Supabase→Dexie normaliza
  `start_at`/`end_at` con `new Date(...).toISOString()` (forma `Z`) — Supabase
  `timestamptz` puede devolver `+00:00`, y como la comparación de ventana local
  es **lexical** (`row.startAt >= sinceIso`, con `sinceIso` en `.000Z`), para el
  mismo instante `+00:00` ordena **antes** de `.000Z` (ASCII `+` < `.`) y un
  workout en el corte podría quedar excluido por error. Timestamp inválido →
  fila descartada. **Rechaza** ante
  `error`/`data` nulo — no traga el error como el `pullReadiness` original —
  para que el matcher encadenado con `.then(...)` no corra sobre caché stale.
  Captura `getSwitchEpoch()` al entrar y **rechaza** si el atleta cambió durante
  el await de Supabase (no reconciliar/escribir contra el atleta equivocado).
  Tras un pull exitoso **reconcilia la ventana** (capa cliente): borra las filas
  locales in-window ausentes de la respuesta remota. Esto cubre dos orígenes:
  (1) **restore desde un backup viejo** (fila local que el remoto ya no tiene) y
  (2) **borrado upstream en WHOOP**, que es autoritativo en el server — la
  reconciliación server-side ya quitó la fila de Supabase, así que la respuesta
  remota no la trae y el cliente espeja la baja. La idempotencia durable vive en
  `session.autoCompletion`, no en la fila del workout, así que borrarla es seguro.
  Las llamadas concurrentes a `pullWorkouts` se serializan a nivel de módulo:
  dos snapshots remotos no pueden intercalar sus reconciliaciones y borrar una
  fila recién incorporada por el pull más nuevo.
- **`autoCompleteFromWorkouts()`** en `src/services/readiness/`: se dispara en
  tres puntos — (a) tras un sync manual (`useWhoopSync`), (b) en el arranque
  post `runFullSync` (`App.tsx`) y (c) al **volver al atleta self**
  (`switchActiveAthlete`, import dinámico para evitar ciclo readiness↔athlete) —
  y en los tres corre solo después de un `pullWorkouts` **exitoso** — si el pull
  rechaza (red caída, error remoto), el matcher **no** corre, para nunca
  matchear contra un caché stale. En el arranque corre además solo **después de que el pull remoto
  de sesiones haya terminado** (post `runFullSync`), para no marcar `no_session`
  contra un Dexie todavía incompleto. Ejecución **serializada** con
  single-flight a nivel de módulo (una corrida a la vez; las llamadas
  concurrentes se encadenan) y workouts procesados en orden determinista
  `(start_at, workout_id)`. Solo considera workouts dentro de la **ventana de
  14 días por `startAt` (instante ISO, no `date`)** (`WHOOP_WORKOUT_WINDOW_DAYS`,
  la misma de `pullWorkouts`): el pull no borra filas viejas, así que sin este
  filtro un `no_session` antiguo se re-evaluaría indefinidamente; ese mismo set
  acotado alimenta `completionNotes`.
  Captura `getSwitchEpoch()` al inicio y comprueba `scopeStillSelf()`
  (`epoch` sin cambios **y** atleta activo === self) en **cada punto donde, tras
  un await, se lee el scope activo o se escribe** (siete en total): antes de leer
  el set durable, **tras leer el set durable (justo antes de
  `filterRowsToActiveScope`, que lee el scope activo mutable)**, antes de cada
  `processWorkout`, tras leer las sesiones candidatas (justo antes de
  `filterRowsToActiveScope`), justo antes de `updateSession`, **tras
  `updateSession`** y **tras el `get()` de confirmación, antes de marcar
  telemetría** (un switch durante esas escrituras/lecturas no debe dejar marca
  mientras ya se navega otro scope; el marcador durable en la sesión ya cubre la
  idempotencia). El scope activo
  es mutable: sin re-chequear después de esos awaits, un switch a un atleta
  gestionado podría hacer que `filterRowsToActiveScope` matchee o complete
  sesiones del scope equivocado. Antes de iterar, construye el set de `workoutId`
  ya referenciados por `session.autoCompletion` escaneando las sesiones con
  marcador **de todas las fechas/status pero restringidas al scope self vía
  `filterRowsToActiveScope`** (nunca lee sesiones fuera de scope) — idempotencia
  durable cross-device, resistente a mover la sesión de fecha. Por cada workout
  restante sin `autoComplete` terminal (cada uno aislado en su propio try/catch:
  un fallo de Dexie al marcar estado loguea y sigue, no aborta el batch):
  1. Mapear `sport_name` → `SupportedSport` (tabla conservadora ampliada).
     Desconocido → `unmapped_sport`.
  2. Duración real `endAt - startAt` < 15 min → `skipped_short` (no usa solo
     `durationMin` redondeado; 14:59 sigue siendo corto).
  3. Candidatas: sesiones del scope self (athleteId self o legacy `undefined`,
     vía la política de scope existente), misma fecha local, mismo `type`,
     `status === 'planned'`.
  4. 0 candidatas → `no_session`.
  5. 2+ candidatas → `resolveAmbiguousMatch(...)` (hoy `null`) →
     `skipped_multiple`.
  6. 1 candidata → `updateSession(id, { status: 'completed', actualDurationMin,
     completionNotes: existingNotesOrGeneratedWhoopSummary, autoCompletion })`.
     **No** se toca `actualRpe` (ver invariante en Decisiones de producto).
     `updateSession` ya maneja `completedAt`,
     recálculo de WeekSummary, push de sync y estadísticas — **cero lógica
     duplicada**. **Verify-before-mark:** `updateSession` retorna en silencio si
     la sesión desapareció (borrado/sync concurrente: `if (!previous) return`),
     así que después de llamarla se relee la sesión y solo se marca el workout
     `completed` si quedó `status === 'completed'` con ese `workoutId`; si no, no
     se marca → reintento natural en la próxima corrida.
  - Dos workouts del mismo deporte + una sesión planned: por el orden
    determinista y la serialización, el primero completa y el segundo cae en
    `no_session`. Una carrera residual multi-tab es inofensiva: la segunda
    corrida ve la sesión ya no-`planned` y el set durable de `workoutId`.
  - Si `updateSession` lanza (o no surte efecto) para un workout, se loguea y
    **no** se marca `autoComplete` (reintento natural en el próximo pull); el
    try/catch por-workout garantiza que los demás siguen procesándose.
- **`SessionBase`:** nuevo campo opcional
  `autoCompletion?: { source: 'whoop_workout'; workoutId: string; completedAt: string }`
  — viaja en el jsonb `data` de `sessionToRow`, sin migración del contrato de
  sessions. **Export/import:** el parser de sesiones de `dataExport.ts`
  (`parseSession`) enumera campos explícitamente, así que debe ganar un
  validador `autoCompletion` (p. ej. `optionalSessionAutoCompletion`) o el
  marcador durable se pierde en un restore y la idempotencia cross-device se
  rompe. La tabla `whoop_workouts` (con su `autoComplete` local) también entra
  a export/import/wipe, espejo de `readiness_daily`.

### Logs

Prefijo `[whoop:auto-complete]`, textos:

- `Whoop workout detected`
- `Matching planned session...`
- `Session matched`
- `Session auto-completed`
- `No planned session found`
- `Multiple candidate sessions. Skipping auto completion`

## UX

- **SessionCard:** con `session.autoCompletion?.source === 'whoop_workout'` y
  `status === 'completed'`, junto al badge "Realizado ✓" se muestra un mini
  icono Whoop (SVG inline monocromo, sin dependencia nueva) y un badge pequeño
  **"Sincronizado desde Whoop"** (estilo consistente con la etiqueta
  "desde Whoop" de DayDetail). Si el usuario cambia el estado, el badge
  desaparece con él; la sesión sigue siendo totalmente editable.
- **WhoopConnection (Settings):** si `connected`, `scopes` no incluye
  `read:workout` y el atleta activo es el self, aviso "Reconecta Whoop para
  sincronizar entrenamientos" con botón. El botón **reusa el mismo launcher
  OAuth que la conexión** (`Browser.open` en iOS, redirect en web) — no
  `window.location.href` pelado, que rompería el flujo nativo de Capacitor.
  `whoop-status` ya expone `scopes`.
- **Desconexión (self-only):** el botón Desconectar está disponible aun con un
  atleta gestionado activo, así que la limpieza local de readiness **y**
  workouts apunta a `getSelfAthleteId()`, no al atleta activo — desconectar
  desde un perfil gestionado no debe dejar la caché Whoop del self.

## Manejo de errores

- Fetch de workouts con 429/error → manejo existente de `runWhoopSync`
  (rate limit propagado, estado `error`); el upsert por `workout_id` es
  idempotente, sin estados parciales.
- Sin scope `read:workout` o sin self athlete → no-op silencioso.
- Matcher: fallos por-workout aislados, sin abortar el batch.

## Testing

- `normalizeWorkouts`: anclaje por `timezone_offset`, duración, tri-estado,
  registros malformados, normalización de `sport_name` (casing/espacios).
- Matcher: un test por regla — mapeo desconocido, <15 min, 0/1/2+ candidatas,
  solo `planned`, scope self vs gestionado, dos workouts/una sesión,
  `actualRpe` nunca se escribe.
- Frontera de duración: 14:59 queda `skipped_short` aunque `durationMin` se haya
  redondeado a 15.
- Pull concurrente: dos llamadas se serializan y nunca ejecutan queries/reconcile
  simultáneos.
- Backup merge: un backup antiguo no pisa una fila local más nueva ni su
  `autoComplete` terminal.
- Matcher: agrega `completionNotes` con los últimos 3 workouts Whoop cuando la
  sesión no tiene notas, y preserva `completionNotes` si el usuario ya escribió
  algo.
- Idempotencia durable: un workout referenciado por `session.autoCompletion`
  no se reprocesa aunque la sesión esté revertida a `planned` y el estado
  Dexie local no exista (simula otro dispositivo/restore).
- Idempotencia durable resistente a mover fecha: si la sesión auto-completada
  se movió a otra fecha (y se revirtió a `planned`), su marcador sigue
  bloqueando el workout y una segunda sesión del mismo deporte hoy **no** se
  completa con él.
- Ventana del matcher: un workout fuera de los 14 días no se procesa (ni marca
  `autoComplete`), aunque exista sesión `planned` en su fecha.
- Ventana por instante (frontera): un workout con la **fecha local del corte**
  pero `startAt` **anterior al instante de corte** no se procesa (prueba que el
  filtro es por `startAt` ISO, no por `date`).
- Re-evaluación: `no_session` se reintenta cuando la sesión aparece después
  (pull remoto tardío); estados terminales no se reprocesan.
- Gating por pull exitoso: si `pullWorkouts` rechaza, el matcher no corre
  (no matchea contra caché stale).
- Verify-before-mark: si `updateSession` no surte efecto (sesión desaparecida),
  el workout **no** queda marcado `completed` y la sesión sigue `planned`.
- Aislamiento por-workout: un fallo de Dexie al marcar un workout no aborta el
  batch; los demás se procesan.
- Serialización: corridas concurrentes del matcher se encadenan; orden
  `(start_at, workout_id)` estable.
- Switch-to-self: al volver al self se dispara pull + matcher; al cambiar a un
  atleta gestionado no.
- Dexie v15→v16: **upgrade real** — abrir la DB a nivel v15, sembrar
  `readinessDaily`, cerrar y reabrir con v16 (patrón de `athleteScopeV14.test.ts`),
  no un simple `delete()`+`open()` del esquema actual.
- `pullWorkouts`: el merge preserva `autoComplete` local; **rechaza** ante error
  Supabase; **reconcilia** la ventana (una respuesta exitosa vacía borra las
  filas locales in-window ausentes del remoto); **canonicaliza** timestamps
  offset-form (`+00:00`) a `Z` para que la comparación lexical de ventana sea
  correcta en la frontera.
- `SessionCard`: badge solo con `autoCompletion` + `completed`.
- `whoopSync.test.ts`: dep `upsertWorkouts` + `reconcileWorkouts`,
  `includeWorkouts` según `conn.scopes`; **fetch exitoso → upsert + reconcile**
  de la ventana con los IDs obtenidos; **`raw.workouts === null` → no upsert ni
  reconcile** (no borrar por 401/403/omisión); el merge del refresh preserva
  `scopes` cuando WHOOP no los devuelve; refresh no estrecha el token a `offline`
  solamente.
- `whoopSupabase.test.ts`: `reconcileWorkouts` filtra por **`start_at >=
  windowStartIso`** (nunca por `date`: test de frontera horaria), borra las filas
  de la ventana ausentes del set (`not in`), y borra **toda** la ventana cuando
  el set es vacío (fetched-but-empty) — sin cláusula `not`.
- `whoopSync.test.ts`: fetch y reconcile usan el **mismo instante ISO** de
  ventana, ~16 días atrás (14 + margen de cron, no 7) — cubre el caso "workout
  borrado hace 14-16 días" que el server debe seguir reconciliando para el
  cliente.
- Matcher — switch durante la **lectura del set durable** (`db.sessions.filter`,
  antes de `filterRowsToActiveScope`): aborta sin procesar (séptimo guard,
  distinto del de lectura de candidatas).
- Matcher — switch durante `updateSession`: la sesión self se completa pero el
  workout **no** queda marcado (telemetría) mientras ya se navega otro scope.
- `whoopClient.test.ts`: 401/403 de la colección de workouts devuelve **`null`**
  (no `[]`) sin romper readiness; colección obtenida pero vacía → `[]`; la URL de
  `/v2/activity/workout` usa el `workoutWindowStartIso` (ventana de workouts), no
  el `start` de 7 días de readiness.
- Matcher — switch mid-run: un cambio de atleta **durante la lectura de
  candidatas** aborta sin completar ni tocar el scope gestionado (test
  obligatorio, no una nota). El escaneo durable solo incluye sesiones del scope
  self.
- `pullWorkouts`: rechaza si el atleta cambia durante el await de Supabase.
- `whoopDataLifecycle.test.ts`: borrado remoto de `whoop_workouts`, wipe local,
  export/backup, y **`session.autoCompletion` sobrevive un ciclo
  export→clear→import** (marcador durable intacto tras restore).

## Fuera de alcance

- Crear sesiones nuevas desde workouts sin sesión planificada.
- Resolución de ambigüedad por `timeBlock` (solo queda la interfaz
  `resolveAmbiguousMatch`).
- Auto-completar sesiones de atletas gestionados (Whoop es self-only).
- Cualquier ajuste automático del plan a partir de workouts.

## Notas de numeración y docs

- Esta feature toma la migración `012` y Dexie **v16**; la reserva de SP1 corre
  a `013+` / v17+. Actualizar `PROJECT_REVIEW_AND_ROADMAP.md` y las referencias
  del spec SP1 al implementar.
- Requisito operativo post-deploy: aplicar `012` en prod y **reconectar Whoop**
  (el owner) para otorgar `read:workout`.

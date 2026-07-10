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
- **Datos reales:** al completar se rellenan `actualDurationMin` (duración del
  workout) y `actualRpe` estimado desde el strain del workout (solo si `SCORED`),
  con la fórmula existente `clamp(round(strain / 2.1), 1, 10)` de `prefillDayLog`.
- **Mapeo de deportes (conservador ampliado),** por `sport_name` exacto de Whoop v2:
  - `squash` → `squash`
  - `running` → `running`
  - `cycling` → `cycling`
  - `weightlifting`, `functional fitness` → `strength`
  - `yoga`, `pilates`, `stretching` → `mobility`
  - Cualquier otro → sin match (se registra `unmapped_sport`, solo log).
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
4. Un workout se procesa **una sola vez** (idempotencia persistida). Si el
   usuario revierte la sesión a `planned`, no se vuelve a completar: la edición
   manual gana.
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
y `UNSCORABLE` también pueden completar sesiones; el RPE estimado solo se
rellena si el score está `SCORED` al momento de procesar.

## Arquitectura

### Servidor (Netlify functions `_shared`)

- **`whoopOAuth.ts`:** `WHOOP_SCOPES` agrega `read:workout`.
- **`whoopClient.ts`:** `fetchWhoopData` agrega `/v2/activity/workout` al
  `Promise.all` (misma `getCollection`, misma ventana `days`). `WhoopRaw` gana
  `workouts: unknown[]`. Si la conexión guardada no incluye el scope
  `read:workout`, el fetch de workouts se **omite sin error** (readiness sigue).
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
- **`whoopSync.ts`:** `WhoopSyncDeps` gana `upsertWorkouts`; `runWhoopSync`
  persiste workouts junto a readiness/readings. El **cron** alimenta workouts
  sin orquestación nueva.
- **Lifecycle:** desconexión/borrado completo incluye `whoop_workouts`
  (service-role, tolerancia a 404/tabla ausente); export/backup y wipe local
  también la incluyen.

### Cliente

- **Dexie v16:** tabla `whoopWorkouts` — índices `id, date, athleteId,
  &workoutId`. La fila guarda datos del workout + estado de matching:
  `autoComplete?: { status: 'completed' | 'skipped_short' | 'skipped_multiple'
  | 'no_session' | 'unmapped_sport'; sessionId?: string; processedAt: number }`.
  Test de upgrade real v15→v16 (fake-indexeddb, patrón del proyecto).
- **`pullWorkouts()`** (espejo de `pullReadiness`, ventana 14 días, filtrado por
  `athlete_id` activo) con **merge-put**: preserva `autoComplete` local al
  refrescar filas desde Supabase (nunca `bulkPut` ciego).
- **`autoCompleteFromWorkouts()`** en `src/services/readiness/`: corre después
  de cada `pullWorkouts` (sync manual y pull de arranque). Por cada workout sin
  `autoComplete`:
  1. Mapear `sport_name` → `SupportedSport` (tabla conservadora ampliada).
     Desconocido → `unmapped_sport`.
  2. Duración < 15 min → `skipped_short`.
  3. Candidatas: sesiones del scope self (athleteId self o legacy `undefined`,
     vía la política de scope existente), misma fecha local, mismo `type`,
     `status === 'planned'`.
  4. 0 candidatas → `no_session`.
  5. 2+ candidatas → `resolveAmbiguousMatch(...)` (hoy `null`) →
     `skipped_multiple`.
  6. 1 candidata → `updateSession(id, { status: 'completed', actualDurationMin,
     actualRpe?, autoCompletion })`. `updateSession` ya maneja `completedAt`,
     recálculo de WeekSummary, push de sync y estadísticas — **cero lógica
     duplicada**.
  - Dos workouts del mismo deporte + una sesión planned: el primero completa,
    el segundo cae en `no_session`. Determinista.
  - Si `updateSession` falla para un workout, se loguea y **no** se marca
    `autoComplete` (reintento natural en el próximo pull); los demás workouts
    siguen procesándose.
- **`SessionBase`:** nuevo campo opcional
  `autoCompletion?: { source: 'whoop'; workoutId: string; at: number }` —
  viaja en el jsonb `data` de `sessionToRow`, sin migración del contrato de
  sessions.

### Logs

Prefijo `[whoop:auto-complete]`, textos:

- `Whoop workout detected`
- `Matching planned session...`
- `Session matched`
- `Session auto-completed`
- `No planned session found`
- `Multiple candidate sessions. Skipping auto completion`

## UX

- **SessionCard:** con `session.autoCompletion?.source === 'whoop'` y
  `status === 'completed'`, junto al badge "Realizado ✓" se muestra un mini
  icono Whoop (SVG inline monocromo, sin dependencia nueva) y un badge pequeño
  **"Sincronizado desde Whoop"** (estilo consistente con la etiqueta
  "desde Whoop" de DayDetail). Si el usuario cambia el estado, el badge
  desaparece con él; la sesión sigue siendo totalmente editable.
- **WhoopConnection (Settings):** si `connected` y `scopes` no incluye
  `read:workout`, aviso "Reconecta Whoop para sincronizar entrenamientos" con
  botón que reusa `startWhoopConnect`. `whoop-status` ya expone `scopes`.

## Manejo de errores

- Fetch de workouts con 429/error → manejo existente de `runWhoopSync`
  (rate limit propagado, estado `error`); el upsert por `workout_id` es
  idempotente, sin estados parciales.
- Sin scope `read:workout` o sin self athlete → no-op silencioso.
- Matcher: fallos por-workout aislados, sin abortar el batch.

## Testing

- `normalizeWorkouts`: anclaje por `timezone_offset`, duración, tri-estado,
  registros malformados.
- Matcher: un test por regla — mapeo desconocido, <15 min, 0/1/2+ candidatas,
  solo `planned`, scope self vs gestionado, idempotencia tras revert manual,
  dos workouts/una sesión, RPE solo si `SCORED`.
- Dexie v15→v16: upgrade real con fake-indexeddb.
- `pullWorkouts`: el merge preserva `autoComplete` local.
- `SessionCard`: badge solo con `autoCompletion` + `completed`.
- `whoopSync.test.ts`: dep `upsertWorkouts`, skip de fetch sin scope.
- `whoopDataLifecycle.test.ts`: borrado remoto de `whoop_workouts`, wipe local,
  export/backup.

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

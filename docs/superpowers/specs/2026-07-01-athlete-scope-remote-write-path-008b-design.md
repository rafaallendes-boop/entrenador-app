# Athlete Scope — Remote Write-Path Natural-Key Safety + `008b` — Diseño

**Fecha:** 2026-07-01
**Autor:** Rafael Allendes (con asistencia técnica)
**Estado:** Aprobado para plan de implementación
**Base:** continúa `docs/superpowers/specs/2026-06-30-athlete-scope-f2-data-prereqs-design.md` (F2 data prereqs, ya en prod con `6e33926`). Cierra el **DEPLOY GATE de `008b`** documentado allí.

## Qué es y qué NO es

**Es** el puente de write-path remoto que permite aplicar el índice único parcial `008b`
(`(athlete_id, date)` / `(athlete_id, week_start_date)`) **sin romper los push con `23505`**.
Añade un handler reactivo de conflicto por clave natural en el push de `day_logs`/`week_summaries`,
más la migración `008b` (aditiva). El handler además **repara conflictos que los uniques legacy
`(user_id, date)` ya pueden producir hoy** (cross-device, mismo `athlete_id`), así que aporta valor
desde el deploy, antes de `008b`.

**NO es** el cierre completo de F2 remoto. **Scope X (tight):** no se dropean todavía los uniques
viejos `day_logs_user_date` `(user_id, date)` ni `week_summaries_user_week` `(user_id, week_start_date)`,
ni se reescribe `migrateLocalDataToCloud`.

### Límite explícito (condición 1)

Mientras el unique viejo `(user_id, date)` / `(user_id, week_start_date)` siga vivo, **el caso
multi-atleta remoto donde dos atletas gestionados comparten el mismo `user_id` (owner) sigue
BLOQUEADO** a nivel DB: ese unique impide dos filas del mismo `user_id` en la misma fecha,
independientemente del `athlete_id`. X es un **puente seguro + integrity net**, no el cierre de F2.
Dropear el unique viejo + rework de `migrateLocalDataToCloud` pertenece al **diseño de F2 real**,
cuando se decida si los atletas gestionados comparten el `owner user_id` o usan cuentas/`user_id`
propios. Ese es el punto que determina si (y cómo) muere el unique viejo.

## Estado remoto verificado (2026-07-01)

Índices actuales en prod (query a `pg_indexes`):

- `day_logs_pkey` UNIQUE `(id)`
- `day_logs_user_date` UNIQUE `(user_id, date)`
- `day_logs_athlete_idx` (no único) `(athlete_id)`
- `week_summaries_pkey` UNIQUE `(id)`
- `week_summaries_user_week` UNIQUE `(user_id, week_start_date)`
- `week_summaries_athlete_idx` (no único) `(athlete_id)`

`008a` reportado por el usuario: **0 nulls y 0 duplicados** en `day_logs`/`week_summaries`. Por lo
tanto el índice parcial de `008b` se crea limpio y no hay deuda de `athlete_id IS NULL` que
reconciliar remotamente.

## El problema concreto

`pushDayLog`/`pushWeekSummary` → `upsertRow` → `getSupabase().from(table).upsert(payload)`
(`syncService.ts:1157`) resuelve conflicto por **PK `id`**. Con dos dispositivos (desktop + mobile)
que crean un day log para la misma fecha con `id` (uuid) distinto antes de sincronizar, tras aplicar
`008b` el segundo push intenta **insertar** una fila que viola el único `(athlete_id, date)` →
`23505`. Hoy eso convergería vía merge; con el índice, el push crashea.

## Decisiones tomadas

1. **Enfoque A (reactivo, client-side).** Happy path intacto; solo en `23505` se reconcilia por
   clave natural. El conflicto real solo ocurre en la colisión cross-device rara, así que el costo
   se paga solo cuando pasa.
2. **No reconciliar el `id` local en el push.** El push converge la fila **remota**; el `id` local
   lo converge el próximo `mergeDayLogs`/`mergeWeekSummaries` (delete-before-put, LWW) — lógica ya
   probada. Mantiene el cambio chico (condición 6).
3. **Scope X:** añadir `008b`, mantener los uniques viejos, no tocar `migrateLocalDataToCloud`.

## Cambios (alcance)

### 1. Handler de `23505` en `upsertRow` (muy acotado — condición 2)

En `upsertRow` (`src/services/syncService.ts`), en el punto del `.upsert(payload)` para tablas
distintas de `athlete_profiles`: si el resultado trae error con `code === '23505'`, intentar
reconciliar **solo** cuando **todas** estas condiciones se cumplen:

- `table` es `day_logs` **o** `week_summaries`;
- `payload.athlete_id` es un string no vacío;
- la columna de fecha natural existe en el payload (`payload.date` para `day_logs`,
  `payload.week_start_date` para `week_summaries`).

Si **cualquiera** falla (otra tabla, payload incompleto, o `athlete_id`/fecha ausentes), **no se
reconcilia**: se reusa el failure path actual (`throw error` → `classifySyncError`/enqueue/retry).
El handler nunca cambia el comportamiento de tablas que no sean day/week ni de payloads incompletos.

### 2. `reconcileNaturalKeyConflict(table, payload, userId): Promise<boolean>`

Helper enfocado. Config: `{ day_logs: 'date', week_summaries: 'week_start_date' }`.

**Paso 1 — SELECT de la fila en conflicto (condición 3, cross-tenant defense):**
```
select id, updated_at
from <table>
where user_id = <current user>
  and athlete_id = <payload.athlete_id>
  and <dateCol> = <payload.<dateCol>>
limit 1
```
Se incluye `user_id = current user` además de `athlete_id + <dateCol>` por defensa cross-tenant y
porque el modelo remoto todavía vive con `user_id` (los uniques viejos siguen activos). `updated_at`
remoto se lee para la decisión LWW.

**Coerción de `updated_at` (nit):** comparar `local.updated_at` y `remote.updated_at` como **números
finitos** (`week_summaries.updated_at` es opcional → tratar ausente/inválido como no-finito). Si
**cualquiera** de los dos no es finito, **no** sobrescribir remoto: caer al path seguro
(retornar `false` → rethrow/enqueue). Nunca se decide LWW con un `updated_at` inválido.

**Paso 2 — LWW (condición 5), atómico:**
- remoto **≥** local (incluye el **empate**, que gana remoto para evitar churn) → **skip** del push;
  el próximo pull baja la versión remota y el merge converge. Retornar `true`.
- local `updated_at` **>** remoto → **update condicional atómico** de la fila remota por su `id`,
  con guarda de concurrencia (no un `upsert({...id})`, que no es atómico y podría pisar una versión
  más nueva escrita por otro dispositivo entre el SELECT y el write):
  ```
  update <columnas del payload sin id>
  from <table>
  where id = <remote.id>
    and user_id = <current user>
    and athlete_id = <payload.athlete_id>   -- re-pin de la clave natural
    and <dateCol> = <payload.<dateCol>>      -- re-pin de la clave natural
    and updated_at < <localUpdatedAt>        -- guarda estricta: empate concurrente gana remoto
  returning id
  -- .eq('id',…).eq('user_id',…).eq('athlete_id',…).eq(dateCol,…).lt('updated_at', localUpdatedAt).select('id')
  ```
  Los `eq('athlete_id')` + `eq(<dateCol>)` re-pinnean la clave natural: si entre el SELECT y el update
  otra escritura cambió el scope/fecha de esa fila (carrera rara o update defectuoso), la guarda no
  matchea y no se sobrescribe una fila que ya no ocupa esta clave natural.
  - devuelve **≥1 fila** → update in-place OK (la guarda `lt` sostuvo el LWW atómicamente) →
    retornar `true`.
  - devuelve **0 filas** → re-chequear la clave natural:
    - si existe una fila remota para `(user_id, athlete_id, fecha)` → **skip**, remoto ganó o empató
      concurrentemente; el próximo pull converge → retornar `true`.
    - si no existe fila remota para esa clave natural → retry único del upsert original; retry OK →
      `true`, retry `23505` → `false`, otro error → `throw` real.

  *(Nota: la guarda `updated_at < localUpdatedAt` chequea el valor remoto **actual** antes del SET;
  Postgres evalúa el WHERE con el valor viejo. El `id` no va en el body del update — se matchea por
  `eq('id', …)`. La desigualdad estricta mantiene el contrato: empate concurrente gana remoto.)*

**Paso 3 — SELECT sin fila (carrera; condición 4):** si el **SELECT del Paso 1** no encuentra fila,
reintentar el `.upsert(payload)` original **una sola vez**:
- retry OK → `true`.
- retry con `23505` → `false` (conflicto genuino no resuelto; el caller re-lanza el `23505`). Sin
  éxito silencioso.
- retry con error **distinto de `23505`** (red/auth) → **throw** ese error real (failure path
  correcto).

**Errores reales dentro del reconcile → lanzar el error real, no `false`.** Si el `SELECT` o el
`UPDATE` fallan con un error (red/auth/RLS), o el retry del Paso 3 falla con un error **distinto de
`23505`**, el reconcile **lanza ese error real** (`throw selectError` / `throw updateError` /
`throw retryError`). **No** retornar `false` en esos casos: `false` haría que `upsertRow` re-lance el
`23505` **original** y clasifique un fallo retriable (red/auth) como conflicto no-retriable. Solo el
retry que vuelve con `23505` retorna `false` (conflicto genuino no resuelto → el caller re-lanza el
`23505`).

Contrato:
- `true` → conflicto resuelto (update in-place, skip por LWW, o retry exitoso).
- `false` → no reconciliable (guardas), `updated_at` no finito, o retry que sigue en `23505`. El
  caller re-lanza el `23505` original.
- **throw** → error real (red/auth/RLS) durante select/update/retry-no-`23505`. El caller lo
  clasifica por el failure path correcto (retriable).

### 3. `migrateLocalDataToCloud` — sin cambios (scope X)

Se deja intacto (`onConflict: 'user_id,date'` / `'user_id,week_start_date'`). Es seguro bajo `008b`
porque el índice local Dexie v14 garantiza que las filas locales ya son únicas por
`(athleteId, date)`; su bulk upsert no puede violar el parcial nuevo, y el target `onConflict`
(los uniques viejos) sigue existiendo. Su rework pertenece a F2 real (cuando se dropee el unique
viejo).

### 4. Migración `supabase/008b_athlete_scope_unique.sql` (aditiva, auto-guardada)

Bloque `DO $$ … RAISE EXCEPTION … $$` que **re-verifica duplicados = 0** (belt-and-suspenders por si
los datos cambiaron desde `008a`) y aborta antes de crear nada si quedan > 0; luego:
```sql
create unique index if not exists day_logs_athlete_date_unique
  on public.day_logs (athlete_id, date) where athlete_id is not null;
create unique index if not exists week_summaries_athlete_week_unique
  on public.week_summaries (athlete_id, week_start_date) where athlete_id is not null;
```
Parcial (`where athlete_id is not null`) para no romper filas legacy (aunque hoy null debt = 0).
Coexiste con los uniques viejos `(user_id, date)`.

## Rollout (condición 8)

Orden estricto. **El handler es seguro antes de `008b` y además ya repara conflictos existentes:**
prod hoy tiene `day_logs_user_date` `(user_id, date)` y `week_summaries_user_week`
`(user_id, week_start_date)`, así que un conflicto cross-device mismo `user_id`/fecha **ya puede
producir `23505` hoy** (antes de `008b`). El handler reconcilia esos conflictos por los uniques
legacy cuando corresponden al **mismo `athlete_id`** (que es la realidad actual single-athlete: toda
fila del usuario tiene el mismo `athlete_id`). Un conflicto `(user_id, date)` contra una fila remota
legacy `athlete_id IS NULL` cae al path seguro (rethrow), pero con null debt = 0 no existe.

1. Deploy del cliente con el handler **primero** (empieza a reparar `23505` de los uniques legacy
   de inmediato).
2. Confirmar que el bundle nuevo cargó / evitar service worker o PWA stale (hard refresh / bump de
   versión de cache si aplica) antes de migrar.
3. Correr `008a` otra vez (confirmar dups = 0).
4. Aplicar `008b` en Supabase (el `DO`-guard aborta si algo cambió).
5. Smoke: crear/editar un day log **y** un week summary → sin `23505`; y tras un **full sync local**
   verificar que queda **convergido** (un solo row por `(athlete_id, fecha)` local y remoto,
   condición 6).

## Testing (condición 7)

Unit tests del handler sobre el mock de Supabase de `syncService.test.ts`:

- **local newer** → reconcile emite un **update condicional** por el `id` remoto con guarda
  `lt('updated_at', localUpdatedAt)` (no inserta, no `upsert`).
- **remote newer/equal** (incluye empate) → skip del push, sin escritura.
- **update condicional devuelve 0 filas + recheck encuentra natural key** → skip, `true`, sin clobber.
- **update condicional devuelve 0 filas + recheck no encuentra natural key** → retry upsert once.
- **`23505` por unique legacy `(user_id, date)` mismo `athlete_id`** (realidad actual de prod, **antes**
  de `008b`) → se reconcilia igual (protege el estado actual, no solo el post-`008b`).
- **SELECT sin fila** → reintenta el upsert original **una vez**.
- **retry sigue `23505`** → sin éxito falso: `upsertRow` hace rethrow/enqueue por el path actual.
- **`updated_at` no finito** (local o remoto, p.ej. `week_summaries` sin `updated_at`) → path seguro,
  no sobrescribe remoto.
- **`23505` en tabla no day/week** → comportamiento actual (rethrow), sin reconcile.
- **`23505` con payload sin `athlete_id`/fecha** → comportamiento actual (rethrow), sin reconcile.

`008b` SQL se aplica/verifica manualmente en Supabase (no unit-test).

Verificación por task: `npm run lint && npm test && npm run build` verdes.

## Fuera de alcance (explícito)

- Dropear `day_logs_user_date` / `week_summaries_user_week` `(user_id, …)`.
- Rework de `migrateLocalDataToCloud`.
- Adopción de filas legacy `athlete_id IS NULL` en el push (null debt = 0; el parcial no las cubre y
  el merge las converge — YAGNI).
- Multi-atleta remoto completo bajo un mismo `owner user_id` (bloqueado por el unique viejo; ver
  Límite explícito). Todo esto pertenece al diseño de **F2 real (coach mode)**.

## Riesgos y mitigaciones

- **Aplicar `008b` antes de desplegar el handler → pushes con `23505`.** Mitigación: orden de
  rollout (handler primero, luego `008b`).
- **Carrera entre el insert fallido y el SELECT de reconcile** (la fila en conflicto se borró en el
  medio) → retry único del upsert; si vuelve a fallar, path de error normal (sin éxito silencioso).
- **Handler demasiado amplio corrompe otras tablas** → guardas estrictas (solo day/week + payload
  con `athlete_id` y fecha); cualquier otro caso reusa el failure path.
- **Clobber de datos remotos más nuevos (carrera SELECT→write)** → el update es **condicional y
  atómico**: `update … where id = remote.id and user_id = me and updated_at < localUpdatedAt`. Si
  otro dispositivo bumpeó o empató `updated_at` remoto entre el SELECT y el update, la guarda `lt` no
  matchea. Luego se re-chequea la clave natural: si existe remoto, se difiere a remoto (skip); si la
  fila desapareció o cambió de clave natural, se reintenta el upsert una vez. Cierra el TOCTOU que
  tendría un `upsert({...id})` no atómico. `updated_at` no-finito (local o remoto) → path seguro, no
  se sobrescribe.
- **Divergencia de `id` local vs remoto tras el reconcile** → intencional; `mergeDayLogs`/
  `mergeWeekSummaries` la convergen en el próximo pull. **Cubierto por test automatizado existente:**
  `src/services/__tests__/syncService.test.ts` → `merges day logs by effective athlete key during a
  full-user pull` (~`:662`) siembra local `local-b` + remoto ganador `remote-b` (misma clave natural,
  distinto id, remoto más nuevo) y, tras `runFullSync`, deja una sola fila `remote-b` y borra
  `local-b`. El smoke de rollout lo re-confirma end-to-end, pero la convergencia ya está aseverada.

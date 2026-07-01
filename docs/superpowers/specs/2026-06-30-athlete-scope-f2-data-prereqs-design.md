# Athlete Scope — F2 Data Prerequisites — Diseño

**Fecha:** 2026-06-30
**Autor:** Rafael Allendes (con asistencia técnica)
**Estado:** Aprobado para plan de implementación
**Base:** continúa `docs/superpowers/specs/2026-06-22-athlete-scope-foundation-design.md` (F0+F1, ya en prod con `VITE_ATHLETE_SCOPE=true` y FKs validadas).

## Qué es y qué NO es

**Es** el prerequisito **de datos** para Coach Mode F2: hacer que `day_logs` y `week_summaries`
sean seguros para **multi-atleta**, migrando su clave natural de `fecha` →
`(athleteId, fecha)`. Trabajo invisible para el atleta individual.

**NO es** el read-scope completo de F2. Este plan arregla la **clave natural**; no vuelve
multi-atleta a toda la app. Quedan fuera (y deben abordarse en F2 propiamente):
`recalculateWeekSummary` (depende de sesiones por semana sin scope), y varios
`toArray()`/consultas por rango sin filtro de atleta. El spec lo deja explícito para no
crear falsa sensación de "F2 listo".

## Por qué ahora (pre-beta)

Es una migración sensible (cambia un índice **único**). Mismo principio que la fundación:
pagar lo riesgoso mientras hay un solo usuario y los datos son chicos, no con atletas
reales en la beta.

## El problema concreto (verificado en código)

- Dexie hoy: `dayLogs: 'id, &date, athleteId'` y `weekSummaries: 'id, &weekStartDate, athleteId'`
  (`src/db/db.ts:194-195`). El `&` = índice **único**: la fecha es la clave natural global.
- `upsertDayLog(fecha)` (`src/db/queries.ts:27`) hace get-by-fecha → update/create; el `id`
  es `uuid()` aleatorio, así que la unicidad la garantiza el índice por fecha.
- Con 2+ atletas, dos check-ins el mismo día colisionan: el único por fecha rechaza el
  segundo, o `getDayLog(fecha)` del atleta B devuelve/pisa el del atleta A → pérdida silenciosa.

## Decisiones tomadas

1. **Lookups locales incondicionales** cuando hay `activeAthleteId` hidratado: las lecturas
   locales de `dayLogs`/`weekSummaries` usan `(athleteId, fecha)` aunque el flag esté **off**.
   El flag `VITE_ATHLETE_SCOPE` controla read-scoping **remoto/F2 visible**, **no** la
   integridad de la clave natural local.
2. **Supabase `008` separado, pero antes de la beta.** Índice único parcial remoto como red
   de integridad. Migración propia con preflight de duplicados. No bloquea el cambio local.
3. **Dexie v14** (la rama de Whoop, diferida, pasa a **v15**).

## Cambios (alcance)

### 1. Dexie v14 — índice compuesto
- `dayLogs: 'id, date, athleteId, &[athleteId+date]'` — quita el único por `date`, mantiene
  `date` **no-único** (lo usa `getDayLogsForWeek` con `.where('date').between`), agrega único
  compuesto `(athleteId, date)`.
- `weekSummaries: 'id, weekStartDate, athleteId, &[athleteId+weekStartDate]'`.
- El `.upgrade()` de v14 es **solo la definición de schema** (Dexie reindexa). **No** corre
  backfill ahí (el upgrade no tiene usuario autenticado). Como el `&date` previo era único,
  no pueden existir duplicados `(athleteId, date)` para datos single-athlete → el índice
  compuesto único se crea limpio.

### 2. Re-backfill versionado en runtime (no en el upgrade)
- **Bump del marker a v2:** `entrenador_athlete_scope_backfill_v1` → `..._v2`
  (`src/services/athlete/athleteScopeMigration.ts:4,97`). Así, al desplegar v14, **todos los
  clientes re-corren el scan una vez** aunque tuvieran el marker v1 completo, estampando
  cualquier fila sin `athleteId` (las stragglers que vimos en prod) **antes** de depender del
  índice compuesto.
- Idempotente, corre hasta 0 `athleteId` pendiente; sigue ejecutándose en runtime vía el
  `backfillLocalAthleteScope` ya cableado en `App.tsx`/`syncSignedInUser`.
- **Ordering seguro:** entre `db.open()` (schema v14) y la finalización del backfill, los
  lookups usan el camino legacy (activeAthleteId aún null → búsqueda por `date` no-único), así
  que ninguna fila "desaparece" durante la ventana.

### 3. Estampar `athleteId` al crear
`upsertDayLog`/`upsertWeekSummary` (`src/db/queries.ts:27,59`) setean `athleteId` al **crear**
(y lo completan en update si falta). **Solo si `getActiveAthleteId()` devuelve un string** —
nunca escribir `athleteId: null`; el tipo local usa `undefined` para legacy. Cierra el agujero
que generó las 4 filas null en prod.

**"Falta" = `!isScopedAthleteId(row.athleteId)`, no `!row.athleteId`.** El default local es
`ATHLETE_PROFILE_LOCAL_ID` (`'default'`), que es **truthy**: un chequeo falsy dejaría esas filas
sin re-estampar y contaminaría la clave natural. Se introduce un helper compartido
`isScopedAthleteId(athleteId): athleteId is string` (true solo para un id scoped real) que es la
única fuente de verdad de "es legacy": se usa en el estampado (update), el fallback de lectura
(#4), merge (#5), repair (#6) e import (#8). Ningún path decide legacy por falsy.

**El patch no manda sobre el scope, y el early-return no debe saltarse el estampado.** `athleteId`
sale del tipo del `patch` (lo dueña esta capa) **y** se elimina en runtime del objeto (`stripAthleteId`,
por si un caller casteado lo cuela). El `athleteId` **resuelto** se escribe siempre al final:
`resolvedAthleteId = isScopedAthleteId(existing.athleteId) ? existing.athleteId : (activeAthleteId ??
undefined)`. Esto protege también a una fila **ya scoped** (`ath_A`) de un patch casteado con
`ath_B`: no basta con estampar "solo cuando falta", porque ahí `needsAthleteStamp` sería false y el
spread del patch ganaría. Además `upsertWeekSummary` tiene un early-return cuando el patch no cambia
métricas (`queries.ts:66`): si la fila es legacy hay que estampar igual, así que la condición pasa a
`if (!needsAthleteStamp && !hasWeekSummaryMeaningfulChanges(existing, safePatch)) return existing`,
con `needsAthleteStamp = activeAthleteId && !isScopedAthleteId(existing.athleteId)`.

### 4. Lookups athlete-aware (con fallback legacy controlado)
Aplica a los lookups de UI `getDayLog`, `getWeekSummary`, `getDayLogsForWeek`
(`src/db/queries.ts:16,24,43`). Estos resuelven contra el **atleta activo**.

**Los finders de sync no delegan en estos lookups de UI.** `findDayLogConflictByDate`/
`findWeekSummaryConflictByWeekStart` (`src/services/syncService.ts:2531,2535`) **no** deben
llamar a `getDayLog`/`getWeekSummary`: en un pull legacy/full-user una fila remota puede ser de
**otro** atleta, y el lookup por atleta activo devolvería la fila local equivocada. En su lugar,
reciben el `athleteId` **remoto** (vía `getRowAthleteId`) y matchean por `effectiveAthleteKey`
(parte de merge, #5). Los lookups de UI de esta sección:
- Si hay `activeAthleteId`: consultar por compuesto. `getDayLog`/`getWeekSummary` por
  `[athleteId+date]`/`[athleteId+weekStartDate]`; **`getDayLogsForWeek` usa rango compuesto
  `[athleteId+date]` entre `[aid, weekStart]` y `[aid, weekEnd]`** (no `date` + filtro en JS).
  **Coalescer por fecha:** si además existe una fila legacy de la misma fecha, la scoped gana y
  la legacy se incluye **solo** cuando no hay scoped equivalente (adoptándola/estampándola). Así
  nunca devuelve dos filas de la misma fecha que contaminen cálculos semanales.
- Si es null: búsqueda por fecha (legacy).
- **Fallback defensivo:** si el lookup compuesto no encuentra nada, buscar una fila legacy de
  esa fecha **solo si su `athleteId` está ausente/legacy** (nunca si pertenece a otro atleta);
  cubre stragglers, imports viejos, pulls legacy o carreras antes/después del backfill. El
  fallback puede **reparar** estampando `athleteId` en esa fila al encontrarla.
- Single-athlete → misma fila de siempre.

### 5. Merge y repair usan la **effective athlete key** (no `row.athleteId` crudo)
Helper conceptual compartido (nota: `??` no basta porque `'default'` es un valor real; hay que
excluir el sentinel legacy con `isScopedAthleteId`):
```
effectiveAthleteKey(row) = isScopedAthleteId(row.athleteId) ? row.athleteId
                                                            : (activeAthleteId ?? 'legacy')
```
Con `activeAthleteId` presente, una **fila legacy remota `athlete_id = null`** cae dentro del
scope legacy-aware del atleta activo, así que debe **competir contra** la fila local de ese
atleta — no quedar como una fila aparte. Si dedupláramos por `row.athleteId` crudo:
- Local `{ athleteId: 'ath_A', date: D }` vs remoto legacy `{ athlete_id: null, date: D }` no
  se verían como conflicto → **quedarían dos filas** (una scoped, una legacy). Bug.

**`mergeDayLogs`/`mergeWeekSummaries`** deduplican por `(effectiveAthleteKey, fecha)`; el
`winner` se **estampa con `athleteId = activeAthleteId`** al resolverse (repara la fila legacy).

### 6. Reparación de conflictos por effective athlete key (crítico)
`repairLocalDayLogConflicts`/`repairLocalWeekSummaryConflicts`
(`src/services/syncService.ts:2591,2608`) agrupan hoy solo por `date`/`weekStartDate`. Deben
agrupar por `(effectiveAthleteKey, date)` / `(effectiveAthleteKey, weekStartDate)`; así:
- No borran filas válidas de **otro atleta** en la misma fecha (clave distinta).
- **Sí** colapsan una fila scoped + una legacy null del atleta activo (misma effective key), y
  estampan `athleteId` en el `winner`.
- Sin `activeAthleteId`, las filas legacy null agrupan por fecha sola (comportamiento actual).

### 7. Delete "missing remote" scope-aware (crítico)
`deleteMissingLocalRows` (`src/services/syncService.ts:2502`) hoy recorre **toda** la tabla
local y borra lo que no esté en `remoteIds`. Pero `fetchAll` (`src/services/sync/syncSupabase.ts:77`)
con `resolveReadScope().mode === 'athlete'` trae **solo el atleta activo** → al sincronizar el
atleta A, las filas locales del atleta B se borrarían por "missing remote". **Requisito:** el
scope del delete debe **espejar el scope real del pull**, no `getActiveAthleteId()` de forma
incondicional:
- Si `resolveReadScope().mode === 'athlete'`: filtrar `localRows` a ese `athleteId` (más las
  legacy `athleteId` null, que sí están en el scope legacy-aware) antes de evaluar el borrado.
- Si el pull fue **legacy/full-user** (flag off o sin atleta hidratado → `fetchAll` trae todo
  por `user_id`): `remoteIds` ya cubre a todos los atletas, así que un id ausente es un
  tombstone real. Pasar `activeAthleteId` ahí haría el borrado **demasiado conservador**
  (perdonaría filas de otro atleta genuinamente borradas y las reintroduciría). En ese caso el
  delete opera legacy/full-user (comportamiento actual).

Aplica a `day_logs` y `week_summaries`. Sin esto, la integración **no es "F2-data-safe"**.

**Snapshot único del scope (mirror literal).** `fetchAll` ya resuelve `resolveReadScope()`
internamente y no lo devuelve; llamar `resolveReadScope()` otra vez en el delete es una segunda
lectura y abre un TOCTOU si el atleta activo cambiara entre pull y delete. Resolver el scope **una
vez** por pull y pasar ese mismo valor a `fetchAll` y a `deleteMissingLocalRows` (p.ej. `fetchAll`
acepta un `scope?` opcional con fallback a `resolveReadScope()`). Hoy es low-risk (no hay switcher
multi-atleta), pero deja el espejo literal.

### 8. Import/export preservan `athleteId`
`exportAppData` exporta filas completas (incluye `athleteId`), pero los parsers de import
reconstruyen campo a campo y lo **descartan**: `parseSession` (`src/services/dataExport.ts:590`),
`parseDayLog` (`:627`), `parseWeekSummary` (`:646`). **Requisito mínimo:** preservar
`athleteId` en `dayLogs` y `weekSummaries` (`athleteId: optionalString(row.athleteId, …)`);
**ideal** también en `sessions`.

**Escribir por `id` es inseguro bajo v14 (coalescer por clave natural) — en `merge` Y en
`replace`:** el import por `merge` mergea por `row.id` (`src/services/dataExport.ts:403-419`) y el
`replace` hace `bulkPut` directo de las filas del backup tras limpiar la tabla (`:377-383`). Con el
único compuesto `&[athleteId+date]`, un backup viejo/scoped/de otro dispositivo puede traer **el
mismo `(athleteId, date)` con un `id` distinto** al de una fila local existente, o **dos filas del
batch que solo colisionan tras estampar** → `bulkPut` rompe contra el índice único o duplica hasta
que el estampado falla. La rama `replace` no está a salvo por limpiar la tabla: el **propio batch**
puede auto-colisionar. **Requisito (ambas ramas):** antes de escribir, coalescer
`dayLogs`/`weekSummaries` por la **effective natural key** (`(effectiveAthleteKey, date)` /
`(…, weekStartDate)`): estampar primero el `athleteId` cuando `!isScopedAthleteId(row.athleteId)`,
indexar las filas locales por clave natural (no por id; en `replace` ese índice queda vacío),
deduplicar el batch importado por clave (newest-wins) y por cada fila importada quedarse con la más
nueva por `updatedAt`; cuando gana la importada, **reutilizar el `id` de la fila local** para que sea
un update in-place y nunca colisione con el índice. Un solo helper compartido por `replace` y
`merge` para que no diverjan.

**Backups viejos sin `athleteId` (preservar no basta):** un backup previo a esta fase no trae
`athleteId`; importarlo **después** de que el marker v2 quedó completo reintroduce filas legacy
y el backfill no necesariamente vuelve a correr. Decisión: **al importar una fila sin
`athleteId`, si hay `activeAthleteId`, estamparlo en el momento del import** (antes de calcular
la clave natural); y además **invalidar el marker v2 tras un import** (para que el re-backfill
vuelva a correr y limpie cualquier straggler). El fallback de lectura ayuda pero no limpia todo
el dataset por sí solo.

**Origen del `userId` para invalidar el marker.** `importAppDataFromFile(file, mode)` no recibe
`userId`. Tras aplicar el import, leer `useAuthStore.getState().user?.id` e invalidar **solo si
existe** (`invalidateBackfillMarker(ownerAccountId)`); sin usuario logueado no hay marker por-owner
que limpiar, así que se omite. Testear ese caso (import sin usuario → no se intenta invalidar).

### 9. Supabase `008` (migración separada, antes de beta)
- **Separar preflight de migración.** Como archivo de migración, un `select` de reporte no
  detiene el `create index` que viene después; el índice fallaría igual pero de forma menos
  controlada. Dos archivos:
  - `008a_athlete_scope_preflight.sql` — **solo reporta** (no muta): duplicados
    `(athlete_id, date)` non-null en `day_logs` y `(athlete_id, week_start_date)` en
    `week_summaries` → si > 0, resolver antes de migrar; más **null debt** (cantidad de filas
    con `athlete_id is null` y duplicados legacy por fecha; señal operativa, no bloquea el índice
    parcial).
  - `008b_athlete_scope_unique.sql` — migración real, **auto-guardada**: un bloque
    `DO $$ … RAISE EXCEPTION … $$` re-verifica los duplicados y **aborta** antes de crear nada si
    quedan > 0 (belt-and-suspenders por si los datos cambiaron entre 008a y 008b), luego crea los
    índices parciales.
- Índices: `create unique index ... on day_logs (athlete_id, date) where athlete_id is not null`
  y análogo para `week_summaries`. Parcial (solo no-null) para no romper filas legacy.
- No bloquea el cambio local; es la red de integridad a nivel DB.
- **DEPLOY GATE — `008b` requiere un write path remoto natural-key-safe.** El único parcial nuevo
  puede lanzar `23505` contra los **pushes** actuales: `pushDayLog`/`pushWeekSummary` → `upsertRow`
  (`syncService.ts:1104`) hace `upsert(payload)` **sin `onConflict`** (`syncService.ts:1157`), o sea por PK `id` — si el
  remoto ya tiene la misma clave natural con otro `id`, el insert viola el parcial; y
  `migrateLocalDataToCloud` usa `onConflict: 'user_id,date'` / `'user_id,week_start_date'`
  (`:3025-3026`), la clave que estamos abandonando. Además un índice **parcial** no es target válido
  de `ON CONFLICT` desde el cliente Supabase (no se puede pasar el `WHERE`), así que `onConflict:
  'athlete_id,date'` no sirve como atajo. **Requisito antes de `008b` (staging/prod):** el push de
  day/week resuelve por clave natural remota (select legacy-null-aware por `(athlete_id, date)` →
  update de esa fila o delete+insert reusando la clave, análogo al coalesce local) y
  `migrateLocalDataToCloud` deja de usar el `onConflict` por `user_id`. Tasks locales 0–9 y `008a`
  (solo reporta) pueden ir antes; `008b` queda detrás de este gate. Smoke de push tras aplicar
  `008b` (crear/editar day log + week summary con atleta activo → sin `23505`).

## Riesgos y mitigaciones

- **Dexie ignora filas con componente de keypath `undefined` en índice compuesto** → si hay
  filas sin `athleteId`, desaparecen de los lookups compuestos. Mitigación: re-backfill
  versionado (#2) hasta 0 pendiente + estampar al crear (#3) + ventana segura por el camino
  legacy.
- **Repair/merge por fecha sola borra o duplica filas** → effective athlete key (#5, #6):
  merge/repair usan `effectiveAthleteKey` (`isScopedAthleteId(row.athleteId) ? row.athleteId :
  (activeAthleteId ?? 'legacy')`), así una fila legacy null/`'default'` y la scoped del atleta
  activo colapsan (y se estampan), sin tocar filas de otro atleta.
- **Delete "missing remote" borra filas de otro atleta** → delete scope-aware que espeja el
  scope real del pull (`resolveReadScope`), no `getActiveAthleteId()` incondicional (#7).
- **Import (replace y merge) colisiona/duplica contra el único compuesto** → coalescer por clave
  natural reusando el id local en **ambas** ramas, con dedupe del batch por clave (#8).
- **Push remoto viola el parcial de `008b` (`23505`)** → gate de despliegue: no aplicar `008b`
  hasta que el push de day/week resuelva por clave natural remota y `migrateLocalDataToCloud` deje
  el `onConflict` legacy por `user_id` (#9). El atajo `onConflict: 'athlete_id,date'` no sirve
  contra un índice parcial.
- **Legacy detectado por falsy deja pasar `'default'`** → todo chequeo "es legacy" usa
  `!isScopedAthleteId(row.athleteId)` (#3), no `!row.athleteId`.
- **Finder de sync devuelve la fila del atleta equivocado en pull legacy/full-user** → los finders
  reciben el `athleteId` remoto y matchean por `effectiveAthleteKey`, sin delegar en los lookups de
  UI por atleta activo (#4).
- **Import de backup viejo reintroduce filas legacy** → estampar al import + invalidar marker (#8).
- **Marker viejo salta el scan** → bump a v2 fuerza la re-ejecución única (#2).
- **Creación del índice único compuesto falla si hay duplicados** → imposible en datos
  single-athlete (el `&date` previo era único); el preflight remoto (#9) cubre el lado DB.

## Coordinación de versiones
- Dexie **v14** = este plan. Whoop (diferido) → **v15**. Migración SQL = `008`.

## Fuera de alcance (explícito)
- `coach_athlete_links`, `account_type` (van con la UI de F2).
- UI de coach (roster, switcher, atleta gestionado).
- Read-scope completo de F2: `recalculateWeekSummary` y otros `toArray()`/rangos sin scope.
- "Contract" (athlete_id NOT NULL / dejar de depender de user_id).

## Testing
- `upsertDayLog` crea **una** fila por `(atleta, fecha)`; dos atletas misma fecha → dos filas.
  Al crear con atleta hidratado estampa `athleteId`; sin atleta no escribe la clave (undefined).
- `getDayLog`/`getWeekSummary` devuelven la fila del atleta activo; null → legacy por fecha.
- **Fallback defensivo:** compuesto sin match + fila legacy (athleteId ausente) misma fecha →
  la encuentra y la repara; pero **no** devuelve una fila de otro atleta.
- `getDayLogsForWeek` con atleta activo usa rango compuesto y no trae filas de otro atleta; una
  fila scoped + una legacy de la misma fecha colapsan en una (la scoped gana, la legacy se
  adopta solo si no hay scoped) → sin doble conteo semanal.
- `mergeDayLogs`/`mergeWeekSummaries` deduplican por effective key: una fila local scoped
  (`ath_A`) y una remota legacy (`null`) misma fecha **colapsan** en una, con `winner` estampado
  `ath_A`; filas de `ath_B` misma fecha no se tocan.
- `repairLocal*Conflicts` colapsan scoped+legacy-null del atleta activo (estampan winner) y
  **no** borran filas de atletas distintos en la misma fecha.
- **Import de backup viejo (sin `athleteId`)** con atleta activo → filas quedan estampadas; el
  marker v2 se invalida y el re-backfill deja 0 pendientes.
- **`deleteMissingLocalRows` scope-aware:** con pull athlete-scoped (remoteIds solo de A) NO
  borra filas locales del atleta B; sí borra las del scope actual ausentes en remoto. Con pull
  legacy/full-user (`athleteScope` undefined) borra todo id ausente, incluidas filas de B.
- **Import preserva `athleteId`** en dayLogs/weekSummaries (round-trip export→import).
- **Import coalescing por clave natural:** una fila de backup con el mismo `(athleteId, date)`
  pero `id` distinto a una fila local existente hace update in-place (reusa el id local), sin
  romper el índice único compuesto ni duplicar; gana la más nueva por `updatedAt`. **En `replace`,**
  un backup con dos filas que colapsan al mismo `(athleteId, date)` tras estampar importa sin
  romper el índice y deja una sola fila.
- **Estampado no-falsy:** una fila legacy con `athleteId: 'default'` se re-estampa en update/import
  (porque `isScopedAthleteId('default') === false`); una fila ya scoped no se toca.
- **`upsertWeekSummary` legacy + patch sin cambios:** aunque `hasWeekSummaryMeaningfulChanges` sea
  false, si la fila es legacy se estampa `athleteId` (no early-return); una fila ya scoped con patch
  neutro sí conserva el early-return.
- **El patch no pisa el scope:** `upsertDayLog`/`upsertWeekSummary` con un `patch` casteado que trae
  `athleteId` de otro atleta devuelven la fila con el `athleteId` del scope activo, no el del patch.
- **`getDayLogsForWeek` ordenado por fecha:** tras coalescer scoped+legacy, el resultado queda
  ordenado por `date` (igual que el `.between` por índice de fecha original).
- **Finder de sync effective-key:** con pull legacy/full-user, una remota de `ath_B` en la misma
  fecha que una local de `ath_A` matchea la fila local de `ath_B`, no la de `ath_A`.
- **Invalidación de marker sin usuario:** import sin `useAuthStore` user → aplica sin intentar
  invalidar el marker (no rompe); con usuario → invalida por `user.id`.
- **Aislamiento de DB en tests reales:** cada test de Dexie resetea el singleton
  (`db.close()/delete()/open()`) para evitar flakiness por estado compartido.
- Upgrade v13→v14 + re-backfill v2: 0 pérdida, backfill completo, idempotente.
- Verificación por tarea: `npm run lint && npm test && npm run build` verdes.

## Bug de repo a corregir (de paso)
`supabase/007_athlete_scope.sql` ya fue corregido (creaba 7/8 FKs, saltaba `training_plans`).
Prod ya está convergido manualmente (8 FKs validadas). Sin acción adicional aquí.

# Athlete Scope Foundation — Diseño

**Fecha:** 2026-06-22
**Autor:** Rafael Allendes (con asistencia técnica)
**Estado:** Aprobado para plan de implementación
**Base estratégica:** `docs/rfc/2026-06-16-coach-mode-architecture.md` (F0 mínimo + F1, §14.1)

## Qué es y qué NO es

Este trabajo **NO construye la página de entrenador.** Construye la **fundación** para que
esa página (plan siguiente) no quede montada sobre el supuesto viejo `usuario = atleta`.
Es trabajo **invisible** para el atleta actual: misma experiencia, mismos datos, cero
cambios de UX. Su valor es reducir drásticamente el riesgo futuro de Coach Mode pagando el
desacople de `athlete_id` **ahora, en ventana pre-beta**, cuando los únicos datos en riesgo
son los del owner.

Nombre del track: **Athlete Scope Foundation** (no "página de entrenador").

## Decisiones tomadas

1. **Alcance:** F0-mínimo + F1 (fundación + re-scope a `athlete_id`). La UI de coach
   (roster/switcher/atletas gestionados) es el plan siguiente, fuera de alcance.
2. **Ventana:** pre-beta. Se ejecuta antes de invitar atletas a la beta privada, con
   backup verificado. El re-scope de sync no se hace con beta activa.
3. **Migración Dexie es forward-only y por eso ADITIVA/no-destructiva:** el flag NO deshace
   una migración local; la seguridad viene de que la migración solo **agrega** (`athlete_id`
   nullable) sin tocar/borrar nada y manteniendo `user_id`.
4. **Sync dual durante transición:** toda escritura mantiene `user_id` Y `athlete_id`;
   toda lectura con flag on es **legacy-aware** (incluye filas sin `athlete_id`).
5. **`coach_athlete_links` se difiere** a F2/F3 (sin coaches, sería schema + RLS muerto).
   Este plan crea solo `athletes`.
6. **No "contract":** `user_id` y políticas RLS viejas se mantienen. `athlete_id NOT NULL`
   y limpieza quedan para una fase posterior.
7. **Versión Dexie:** este trabajo toma **v13**. El piloto Whoop (diferido) pasa a **v14**
   (ya anotado en sus docs).

## Contexto del código (verificado 2026-06-22)

- **Singleton `'default'`:** ~65 usos de `'default'` en `src/`, concentrados en
  `src/services/syncService.ts` y `src/services/syncUtils.ts` (más muchos tests). Es el
  perfil de atleta cableado (`db.athleteProfiles.get('default')`, merges, reset).
- **`getActiveAthleteId()` NO existe** todavía.
- **El motor ya está parametrizado:** `buildPlanShell`, `generationJobRunner`, `planRows`,
  `buildPlanShell` y el background job ya usan `athleteId`. El acoplamiento al singleton
  vive en los **bordes** (el store carga `'default'`, el writer scopea por `user_id`).
- **`TrainingPlan.athleteId` existe** pero en la práctica vale `'default'`.
- **Sync:** lecturas remotas vía `fetchAll(table, userId)` → `.eq('user_id', userId)`.
  Tiers A/B/C; bug histórico de "reset total" ya corregido → zona de alto riesgo.
- **Dexie:** v12 (`src/db/db.ts:170`). Tablas que sincronizan (scope `user_id`):
  `sessions`, `day_logs`, `week_summaries`, `chat_messages`, `coach_proposals`,
  `athlete_profiles`, `training_plans`, `training_plan_weeks`.
- **Supabase:** patrón de migración en `supabase/00X_*.sql`; RLS por `user_id`.
- **Backup/export** existe (`src/services/dataExport.ts`) — se usa como red de seguridad.

## Arquitectura por fases

Migración **quirúrgica con checkpoints verdes**, no un "F1 completo" de una vez. Cada fase
es desplegable, reversible en comportamiento, y deja la suite verde.

```
Fase A: getActiveAthleteId() + erradicar accesos directos a 'default'   [sin tocar datos]
Fase B: Supabase expand (athlete_id nullable) + tabla athletes + backfill   [staging first]
Fase C: Dexie v13 aditiva + dry-run + test de upgrade v12→v13            [forward-only seguro]
Fase D: sync dual (user_id + athlete_id) detrás de flag, lecturas legacy-aware
Fase E: (plan siguiente) spec de roster / página de entrenador          [fuera de alcance]
```

### Fase A — Desacople interno (sin tocar datos)

**Distinción central (resuelve la confusión `'default'` vs `athlete_id`):** hay DOS ids
distintos que hoy ambos valen `'default'` y deben separarse conceptualmente:

- **`ATHLETE_PROFILE_LOCAL_ID = 'default'`** — la **clave local del perfil singleton** en
  Dexie (`db.athleteProfiles.get('default')`). NO cambia y NO se escribe nunca en la
  columna `athlete_id`. Cubre la mayoría de los ~65 usos actuales.
- **athlete_id (text)** — la **clave de scope de los datos de entrenamiento**, que apunta a
  `athletes.id` (text PK). Es lo que devuelve `getActiveAthleteId()`.

Componentes:

- **`getActiveAthleteId(): string | null`** — única fuente de verdad del athlete_id activo.
  - Helper nuevo en `src/services/athlete/activeAthlete.ts`.
  - Devuelve el **id (text) del atleta del owner** hidratado en el store (ver "Hidratación").
  - Devuelve `null` si todavía no está hidratado (pre-migración / sin fila `athlete`); los
    consumidores tratan `null` como "scope legacy por `user_id`".
  - El **flag NO cambia el valor que devuelve** (siempre el id si existe); el flag solo
    controla si el *scope de lectura/escritura de sync* usa athleteId (Fase D). Así el
    id está disponible para la escritura dual aunque el flag de lectura esté off.
- **`ATHLETE_PROFILE_LOCAL_ID`** — constante exportada para el id local del perfil.
- **Hidratación de `activeAthleteId`** (crítico): al iniciar la app, el store lee la fila
  del atleta del owner desde **Dexie `athletes`** (poblada por el backfill v13, Fase C) y
  setea `activeAthleteId = athlete.id`. Orden de resolución:
  1. Dexie `athletes` → fila con `owner_account_id = usuario` (fuente primaria, local-first).
  2. Si Dexie aún no la tiene pero Supabase sí (multi-dispositivo recién migrado), se
     hidrata del pull de `athletes` y se persiste local.
  3. Si ninguna existe (pre-migración) → `null` → comportamiento legacy por `user_id`.
- **`athletes` es Tier A y se sincroniza PRIMERO (de la review):** como `activeAthleteId`
  (y por ende el scope de todo lo demás) depende de tener la fila `athlete`, `athletes`
  entra al `ENTITY_TIER` como **Tier A** y su **pull precede** al de planes/sesiones/logs.
  En el orden de drenado/pull, `athletes` se resuelve antes que cualquier tabla scopeada
  por `athlete_id`, para no leer datos con un `activeAthleteId` aún sin hidratar.
- **Erradicar accesos directos:** reemplazar los ~65 `'default'` por la constante (perfil)
  o por `getActiveAthleteId()` (scope), según corresponda. Regla de cierre: un test/grep
  guard que falla si reaparece `'default'` literal fuera de `activeAthlete.ts` y sus tests.
- **Store:** agregar `activeAthleteId: string | null` al store de auth/training. Sin
  selector visible.
- **Plan Builder / jobs:** auditar bordes para que `athleteId` provenga de
  `getActiveAthleteId()` (con fallback legacy si `null`), no de `'default'` implícito.

### Fase B — Supabase expand + backfill (staging primero)

Migración `supabase/0NN_athlete_scope.sql` siguiendo **expand → backfill** (sin contract).
**Reservar el próximo número de migración real al implementar** (la última es `006`; este
spec usaba `007` pero confirmar contra `supabase/` en el momento — el plan de Whoop también
mencionaba `007`, aunque está diferido).

- **Tabla `athletes`:** `id` (**text PK**, generado client-side como el resto de los PKs
  del proyecto — `training_plans.id`, `sessions.id`, etc. son todos `text`),
  `owner_account_id` (uuid → auth.users), `linked_account_id` (uuid nullable),
  `display_name` (text), `status` (text), timestamps. RLS: acceso por propiedad
  (`owner_account_id = auth.uid()` o `linked_account_id = auth.uid()`).
- **Tipo de `athlete_id`: `text`** (no `uuid`). Razones (verificado 2026-06-22): (a) el
  proyecto usa **PKs `text`** en todas las tablas (local-first, ids generados en cliente);
  (b) `training_plans.athlete_id` **ya existe como `text not null`** (`supabase/003`);
  (c) evita una conversión `text→uuid` riesgosa sobre una columna sincronizada durante la
  migración sensible. La FK `athlete_id → athletes(id)` es `text→text`, joins/RLS limpios.
- **Dos casos distintos** (el schema real difiere por tabla):
  - **`training_plans`**: la columna `athlete_id text not null` **ya existe** y hoy vale
    `'default'`. Solo se **backfillea el valor** (`'default'` → `athletes.id` real). No hay
    ALTER de tipo ni columna temporal. Como es `not null`, el backfill debe correr en la
    misma transacción que el INSERT del `athlete` para no violar la constraint.
  - **`training_plan_weeks`**: **agregar** columna `athlete_id text` (nullable) + índice,
    pero el backfill **deriva `athlete_id` desde su `training_plans.plan_id`** (join al
    plan padre), **no** desde `user_id`. Razón (de la review): evita drift cuando exista
    más de un atleta — una semana siempre pertenece al atleta de su plan.
  - **Resto** (`sessions`, `day_logs`, `week_summaries`, `chat_messages`,
    `coach_proposals`, `athlete_profiles`): **agregar** columna `athlete_id text`
    (nullable) + índice + backfill desde el `athlete` del `user_id` (1:1 hoy).
- **FK e índice:** agregar `athlete_id → athletes(id)` e índice por `athlete_id` una vez
  backfilleado (para `training_plans`, la FK se agrega después del backfill de valor).
- El valor local legacy `'default'` no se escribe en `athlete_id` del resto de tablas; el
  backfill puebla el id real y las filas legacy sin backfillear quedan `NULL` (recuperadas
  por lecturas legacy-aware en Fase D).
- **Backfill:** por cada `user_id` distinto en `athlete_profiles`, crear un `athlete` con
  `owner_account_id = linked_account_id = user_id`; setear `athlete_id` de todas sus filas
  a ese `athlete.id`.
- **RLS transicional:** mantener políticas actuales por `user_id`. Agregar política que
  permite acceso cuando la fila pertenece a un `athlete` propio. **No** se borran las viejas.
- **NO `coach_athlete_links`** en este plan.
- Probar en proyecto Supabase de **staging** antes de prod del owner.

### Fase C — Dexie v13 aditiva + dry-run + test de upgrade

- **Convención de nombres (de la review):** **local/TS usa camelCase `athleteId`**
  (como `trainingPlans: '...athleteId...'` ya en `db.ts`); **Supabase usa snake_case
  `athlete_id`**. El mapeo lo hacen los row-mappers de sync (igual que `userId`↔`user_id`
  hoy). Quien implemente NO debe mezclar: en Dexie/tipos/stores es `athleteId`; en SQL y
  filas remotas es `athlete_id`.
- **v13 aditiva:** agregar índice `athleteId` a las tablas locales que sincronizan; crear
  tabla local `athletes`. **No** se borra ni reescribe nada existente. `user_id`/`'default'`
  permanecen. Un cliente con flag off tras la migración funciona idéntico a v12.
- **Backfill local en el upgrade:** mapear `'default'` → el `athlete.id` del owner; setear
  `athleteId` en filas locales. Idempotente.
- **Dry-run:** función pura `planAthleteScopeMigration(snapshot)` que recibe un snapshot de
  las tablas y **reporta** conteos (filas a mapear, huérfanas, ya migradas) **sin escribir**.
  Recordatorio (de la review): el upgrade Dexie corre **automáticamente** al abrir la app,
  así que para validar *antes* el dry-run debe ser ejecutable como **check previo manual**,
  no depender del runtime. Se expone como:
  - un script dev (`npm run migrate:dry-run` o similar) que lee la Dexie local del owner y
    reporta, y/o
  - un test que corre el dry-run sobre un fixture v12 representativo.
  La función de upgrade real reusa la misma lógica pura para garantizar consistencia.
- **Test de upgrade serio:** test que arranca una DB con datos representativos en v12,
  corre el upgrade a v13, y verifica: 0 filas perdidas, `athleteId` (camelCase local)
  poblado correctamente, datos legacy intactos, idempotencia (correr dos veces no
  duplica/rompe).

### Fase D — Sync dual detrás de flag, legacy-aware

- **Orden de deploy obligatorio (de la review):** **primero** correr el SQL expand
  (`athlete_id` nullable + `athletes`) en staging y luego prod; **después** desplegar el
  cliente que escribe `athlete_id`. Si el cliente nuevo llega antes que el schema, la
  escritura dual rompería contra una columna inexistente. El plan debe ordenar las tasks
  de forma que el SQL (Fase B) esté aplicado antes de mergear la escritura dual (Fase D).
- **Escritura dual:** toda escritura remota incluye `user_id` (como hoy, auditoría) **y**
  `athlete_id` (el id text de `getActiveAthleteId()`, si está hidratado). Independiente del
  flag de lectura. Si `getActiveAthleteId()` es `null` (pre-migración), se omite
  `athlete_id` (queda `NULL`, recuperable por lecturas legacy-aware).
- **Lectura legacy-aware (solo con flag on):** el scope de lectura pasa de
  `.eq('user_id', userId)` a "filas del `athlete` activo **incluyendo** filas legacy sin
  `athlete_id` que pertenecen al usuario" — p.ej. `athlete_id = X OR (athlete_id IS NULL AND
  user_id = userId)`. Esto evita que activar el flag haga desaparecer datos viejos.
- **Flag `VITE_ATHLETE_SCOPE`** como kill-switch del *comportamiento* de scope. Recordatorio
  explícito (de la review): el flag NO revierte la migración Dexie; la reversibilidad real
  viene de que la migración es aditiva y la escritura dual mantiene `user_id`.
- **Precondición dura para activar el flag (de la review):** el scope por `athlete_id` solo
  se habilita si **`getActiveAthleteId() !== null`** (atleta hidratado). Si el flag está on
  pero `activeAthleteId` es `null`, el código **cae a scope legacy por `user_id`** (no
  produce un estado raro ni queries con `athlete_id = null`). Es decir: flag on es
  *condición necesaria pero no suficiente*; la suficiente es flag on **y** atleta hidratado.
  Un test cubre el caso flag-on + `null` → comportamiento legacy.
- El motor de cola/tiers/recovery **no se reescribe**; solo cambia la resolución de scope en
  los puntos de lectura/escritura.

## Componentes / unidades

| Unidad | Responsabilidad | Depende de |
|---|---|---|
| `activeAthlete.ts` | `getActiveAthleteId()`, `ATHLETE_PROFILE_LOCAL_ID`, hidratación | store |
| `athleteScopeFlag.ts` | leer `VITE_ATHLETE_SCOPE` (default false; gatea solo scope de sync) | `import.meta.env` |
| `0NN_athlete_scope.sql` | expand + backfill Supabase (text + FK) | — |
| Dexie v13 (`db.ts`) | índices `athleteId` + tabla `athletes` local | tipos |
| `athleteScopeMigration.ts` | `planAthleteScopeMigration()` (puro, dry-run) + backfill local | db |
| `syncService`/`syncUtils` | escritura dual + lectura legacy-aware (gated) | activeAthlete |

## Error handling / seguridad de datos

- **Backup obligatorio** antes de la migración real (export verificado).
- **Idempotencia** en todo backfill (local y remoto).
- **Flag default off** en prod; un test estilo-lint falla si queda `'true'` con `PROD`.
- **Sin pérdida de datos:** la migración nunca borra; las lecturas legacy-aware nunca
  ocultan filas; la escritura dual nunca abandona `user_id`.

## Testing

- `getActiveAthleteId()`: hidratado→id (text) del owner; sin hidratar→`null` (scope legacy).
- Flag on + `activeAthleteId === null` → cae a scope legacy (no produce queries raras).
- Guard anti-`'default'` directo (grep/test) fuera de `activeAthlete.ts`.
- Migración Supabase: smoke en staging (athletes creado; `training_plans.athlete_id` con
  valor backfilleado; resto con columna `athlete_id` text + FK backfilleada; RLS por
  propiedad funciona).
- **Test de upgrade Dexie v12→v13**: 0 pérdida, backfill correcto, idempotente.
- Dry-run (puro): conteos correctos sin escritura, sobre fixture v12.
- Sync: escritura incluye ambos ids cuando hay `athleteId`; lectura con flag on incluye
  filas legacy (`athlete_id IS NULL`); con flag off comportamiento idéntico a hoy.
- Hidratación: `activeAthleteId` se resuelve desde Dexie `athletes` al iniciar; fallback a
  pull de Supabase; `null` si no existe.
- Cierre por fase: `npm run lint && npm test && npm run build` verdes.

## Fuera de alcance (explícito)

- Toda UI de entrenador: roster, switcher, "vista como atleta X" (plan siguiente, F2).
- Tabla `coach_athlete_links` y RLS de membresía coach↔atleta (F2/F3).
- `account_type = coach`, invitaciones, roles, claim/transfer.
- "Contract" de la migración (drop de `user_id` como clave de propiedad).
- Integración Whoop (diferida; toma Dexie v14).

## Riesgos y mitigaciones

- **Dexie es forward-only** → migración puramente aditiva + test de upgrade serio + dry-run.
  El flag no revierte schema; la reversibilidad viene del diseño aditivo.
- **Re-scope de sync = zona de pérdida de datos** (bug histórico) → escritura dual, lectura
  legacy-aware, flag kill-switch, backup previo, ventana pre-beta.
- **Confusión `'default'` vs `athlete_id`** → centralizado en `activeAthlete.ts`, guard
  anti acceso directo.
- **Colisión de versión Dexie con Whoop** → Coach v13, Whoop v14 (anotado en docs Whoop).
- **Código muerto de autorización** → `coach_athlete_links` y RLS de membresía diferidos.
- **Constraints únicas por `user_id` (deuda para F2, de la review):** hoy `day_logs` y
  `week_summaries` son únicas por `user_id + date/week` (Dexie: `&date`, `&weekStartDate`).
  Para esta fase está **bien** (un atleta por usuario). **Antes de la UI multi-atleta**
  habrá que pasarlas a único por `athlete_id + date/week`. Documentado como deuda; NO se
  toca en este plan (cambiar un índice único es justo la zona de riesgo que evitamos ahora).

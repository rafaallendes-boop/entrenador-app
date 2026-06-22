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

- **`getActiveAthleteId()`** — única fuente de verdad para el id de atleta activo.
  - Helper nuevo en `src/services/athlete/activeAthlete.ts`.
  - Con flag `VITE_ATHLETE_SCOPE` **off** (default): devuelve `'default'` → cero cambio.
  - Con flag **on**: devuelve `activeAthleteId` del store (resuelto del backfill).
- **`ATHLETE_PROFILE_LOCAL_ID`** — constante para el id local del perfil (`'default'`),
  para distinguir conceptualmente "id local del perfil singleton" de "athlete_id real".
  Centraliza el mapping y evita confundir `athlete_profiles.id = 'default'` con
  `athlete_id = uuid`.
- **Erradicar accesos directos:** reemplazar los ~65 `'default'` por el helper/constante.
  Regla de cierre: un test/grep guard que falla si reaparece `'default'` literal fuera de
  `activeAthlete.ts` y sus tests.
- **Store:** agregar `activeAthleteId` (string) al store de auth/training, inicializado al
  id local hasta que el flag/backfill lo cambie. Sin selector visible.
- **Plan Builder / jobs:** auditar bordes para que `athleteId` provenga de
  `getActiveAthleteId()`, no de `'default'` implícito.

### Fase B — Supabase expand + backfill (staging primero)

Migración `supabase/007_athlete_scope.sql` siguiendo **expand → backfill** (sin contract):

- **Tabla `athletes`:** `id` (uuid PK), `owner_account_id` (uuid → auth.users),
  `linked_account_id` (uuid nullable), `display_name` (text), `status` (text), timestamps.
  RLS: acceso por propiedad (`owner_account_id = auth.uid()` o
  `linked_account_id = auth.uid()`).
- **Columna `athlete_id` (text, nullable)** en: `sessions`, `day_logs`, `week_summaries`,
  `chat_messages`, `coach_proposals`, `athlete_profiles`, `training_plans` (normalizar el
  existente), `training_plan_weeks`. Índice por `athlete_id`.
- **Backfill:** por cada `user_id` distinto en `athlete_profiles`, crear un `athlete` con
  `owner_account_id = linked_account_id = user_id`; setear `athlete_id` de todas sus filas
  a ese `athlete.id`.
- **RLS transicional:** mantener políticas actuales por `user_id`. Agregar política que
  permite acceso cuando la fila pertenece a un `athlete` propio. **No** se borran las viejas.
- **NO `coach_athlete_links`** en este plan.
- Probar en proyecto Supabase de **staging** antes de prod del owner.

### Fase C — Dexie v13 aditiva + dry-run + test de upgrade

- **v13 aditiva:** agregar índice `athlete_id` a las tablas locales que sincronizan; crear
  tabla local `athletes`. **No** se borra ni reescribe nada existente. `user_id`/`'default'`
  permanecen. Un cliente con flag off tras la migración funciona idéntico a v12.
- **Backfill local en el upgrade:** mapear `'default'` → el `athlete.id` del owner; setear
  `athlete_id` en filas locales. Idempotente.
- **Dry-run:** función `planAthleteScopeMigration()` que recorre Dexie y **reporta** conteos
  (filas a mapear, huérfanas, ya migradas) **sin escribir**. Permite validar antes de migrar.
- **Test de upgrade serio:** test que arranca una DB con datos representativos en v12,
  corre el upgrade a v13, y verifica: 0 filas perdidas, `athlete_id` poblado correctamente,
  datos legacy intactos, idempotencia (correr dos veces no duplica/rompe).

### Fase D — Sync dual detrás de flag, legacy-aware

- **Escritura dual:** toda escritura remota incluye `user_id` (como hoy, auditoría) **y**
  `athlete_id`. Independiente del flag (escribir ambos siempre es seguro y prepara el corte).
- **Lectura legacy-aware (solo con flag on):** el scope de lectura pasa de
  `.eq('user_id', userId)` a "filas del `athlete` activo **incluyendo** filas legacy sin
  `athlete_id` que pertenecen al usuario" — p.ej. `athlete_id = X OR (athlete_id IS NULL AND
  user_id = userId)`. Esto evita que activar el flag haga desaparecer datos viejos.
- **Flag `VITE_ATHLETE_SCOPE`** como kill-switch del *comportamiento* de scope. Recordatorio
  explícito (de la review): el flag NO revierte la migración Dexie; la reversibilidad real
  viene de que la migración es aditiva y la escritura dual mantiene `user_id`.
- El motor de cola/tiers/recovery **no se reescribe**; solo cambia la resolución de scope en
  los puntos de lectura/escritura.

## Componentes / unidades

| Unidad | Responsabilidad | Depende de |
|---|---|---|
| `activeAthlete.ts` | `getActiveAthleteId()`, `ATHLETE_PROFILE_LOCAL_ID`, flag read | store, flag |
| `athleteScopeFlag.ts` | leer `VITE_ATHLETE_SCOPE` (default false) | `import.meta.env` |
| `007_athlete_scope.sql` | expand + backfill Supabase | — |
| Dexie v13 (`db.ts`) | índices `athlete_id` + tabla `athletes` local | tipos |
| `athleteScopeMigration.ts` | `planAthleteScopeMigration()` (dry-run) + backfill local | db |
| `syncService`/`syncUtils` | escritura dual + lectura legacy-aware (gated) | activeAthlete |

## Error handling / seguridad de datos

- **Backup obligatorio** antes de la migración real (export verificado).
- **Idempotencia** en todo backfill (local y remoto).
- **Flag default off** en prod; un test estilo-lint falla si queda `'true'` con `PROD`.
- **Sin pérdida de datos:** la migración nunca borra; las lecturas legacy-aware nunca
  ocultan filas; la escritura dual nunca abandona `user_id`.

## Testing

- `getActiveAthleteId()`: off→`'default'`, on→`activeAthleteId`.
- Guard anti-`'default'` directo (grep/test).
- Migración Supabase: smoke en staging (athletes creado, athlete_id backfilleado, RLS).
- **Test de upgrade Dexie v12→v13**: 0 pérdida, backfill correcto, idempotente.
- Dry-run: conteos correctos sin escritura.
- Sync: escritura incluye ambos ids; lectura con flag on incluye filas legacy; con flag off
  comportamiento idéntico a hoy.
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

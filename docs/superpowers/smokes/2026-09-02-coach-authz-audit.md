# Evidencia de autorización Coach — Entrega 1a

Estado: **pendiente de ejecución en producción**.

Este documento recibe evidencia, no estimaciones. No habilita `031` mientras
alguna sección siga pendiente o contenga diferencias sin explicar.

## 1. Precondición 013b (`pg_policies`)

- Fecha/hora: 2026-09-05 (dump), 2026-09-06 (comparación nominal).
- Ejecutado por: sesión asistida (SQL Editor, proyecto `entrenador-app`, rama
  `main PRODUCTION`) para el dump; comparación nominal resuelta offline contra
  el CSV archivado, que es el mismo objeto que produciría el `LEFT JOIN`.
- Resultado: **APROBADO — 25/25 policies de 013b instaladas.** La comparación es
  nombre por nombre y además compara `cmd`, `qual`, `with_check`, `permissive` y
  `roles` contra el texto que crea `013b`, normalizando sólo lo que agrega
  `pg_get_expr` (alias de sublink, prefijo `public.`, espaciado). **Cero
  faltantes, cero diferencias de predicado.** `readiness_daily_select` tiene el
  predicado v2 `athlete_id in (select auth_athlete_ids())`, que es la fila que
  esta sección existía para verificar.
- Las 25 esperadas se derivan del texto de `013b`: 3 de las tablas nuevas (§7),
  8 `*_select_membership` (§8a), 3 de `athletes` (§8b), 4 `*_write_membership`
  (§8c), 3 `*_write_coach` (§8d), 3 de `sessions` (§8e) y
  `readiness_daily_select` (§8f).
- Conciliación con §2: 78 policies instaladas = 25 de `013b` + 4 de `030`
  (`coach_proposals`/`training_plans`/`training_plan_weeks` `_write_member` y
  `whoop_workouts_select_membership`) + 49 legacy. El conteo V2 de §2 da 28 y no
  29 porque clasifica `athlete_memberships_select_own` como `OTRO`; es la misma
  población, contada distinto. **No hay ninguna policy instalada que no provenga
  de una migración del repo.**
- **Confirmado contra producción viva el 2026-09-06**, no sólo contra el dump,
  con el §1 de
  [`supabase/queries/2026-09-06-policy-equivalence-per-command.sql`](../../../supabase/queries/2026-09-06-policy-equivalence-per-command.sql):
  `esperadas = 29`, `instaladas = 29`, `cmd_distinto = 0`, `forma_rara = 0`,
  `faltantes = ninguna`, y `readiness_qual =
  (athlete_id IN ( SELECT auth_athlete_ids() AS auth_athlete_ids))`.

## 2. Inventario completo de policies

Dump completo de `pg_policies` sobre las 13 tablas del alcance, 2026-09-05,
proyecto `entrenador-app` rama `main PRODUCTION`. CSV crudo archivado en
[`evidence/2026-09-05-pg-policies-produccion.csv`](evidence/2026-09-05-pg-policies-produccion.csv).

| Clase | Policies |
|---|---:|
| `V2` — membresía (`auth_athlete_ids` / `auth_coach_athlete_ids` / `auth_coach_note_athlete_ids`) | 28 |
| `LEG-UID` — legacy por `user_id` | 36 |
| `LEG-OL` — legacy por `owner_account_id` / `linked_account_id` | 13 |
| `OTRO` — `athlete_memberships_select_own` (`account_id = auth.uid()`) | 1 |
| **Total** | **78** |

**49 de 78 policies siguen siendo legacy** y conviven con las 28 de membresía.
Es el estado que 1a define a propósito —la membresía es decorativa mientras las
legacy existan (pendiente 1 del runbook)—, pero dimensiona 1b: el corte debe
justificar el retiro de 49 policies, no de unas pocas.

Nota de método: una clasificación previa hecha en SQL dio 26/3 porque su
predicado no contemplaba `auth_coach_note_athlete_ids`. El conteo válido es el
de esta tabla, derivado del CSV.

| Tabla | Cmd | Policy | Clase | Predicado (recortado) |
|---|---|---|---|---|
| `athlete_coach_notes` | ALL | `athlete_coach_notes_write` | V2 | `(athlete_id IN (auth_coach_note_athlete_ids()))` |
| `athlete_coach_notes` | SELECT | `athlete_coach_notes_select` | V2 | `(athlete_id IN (auth_coach_note_athlete_ids()))` |
| `athlete_memberships` | SELECT | `athlete_memberships_select_own` | OTRO | `(account_id = auth.uid())` |
| `athlete_profiles` | ALL | `athlete_profiles_write_membership` | V2 | `(athlete_id IN (auth_athlete_ids()))` |
| `athlete_profiles` | DELETE | `athlete_profiles: delete own` | LEG-UID | `(auth.uid() = user_id)` |
| `athlete_profiles` | INSERT | `athlete_profiles: insert own` | LEG-UID | `(auth.uid() = user_id)` |
| `athlete_profiles` | SELECT | `athlete_profiles: read own` | LEG-UID | `(auth.uid() = user_id)` |
| `athlete_profiles` | SELECT | `athlete_profiles_select_by_athlete` | LEG-OL | `(athlete_id IN (athletes.id FROM athletes WHERE ((athletes.owner_account_id = …` |
| `athlete_profiles` | SELECT | `athlete_profiles_select_membership` | V2 | `(athlete_id IN (auth_athlete_ids()))` |
| `athlete_profiles` | UPDATE | `athlete_profiles: update own` | LEG-UID | `(auth.uid() = user_id)` |
| `athletes` | DELETE | `athletes_delete` | LEG-OL | `(auth.uid() = owner_account_id)` |
| `athletes` | INSERT | `athletes_insert` | LEG-OL | `(auth.uid() = owner_account_id)` |
| `athletes` | SELECT | `athletes_select` | LEG-OL | `((auth.uid() = owner_account_id) OR (auth.uid() = linked_account_id))` |
| `athletes` | SELECT | `athletes_select_membership` | V2 | `(id IN (auth_athlete_ids()))` |
| `athletes` | UPDATE | `athletes_update` | LEG-OL | `(auth.uid() = owner_account_id)` |
| `athletes` | UPDATE | `athletes_update_self` | V2 | `(id IN (auth_athlete_ids()))` |
| `athletes` | UPDATE | `athletes_write_coach` | V2 | `(id IN (auth_coach_athlete_ids()))` |
| `chat_messages` | ALL | `chat_messages_write_membership` | V2 | `(athlete_id IN (auth_athlete_ids()))` |
| `chat_messages` | DELETE | `chat_messages: delete own` | LEG-UID | `(auth.uid() = user_id)` |
| `chat_messages` | DELETE | `chat_messages_delete_own` | LEG-UID | `(auth.uid() = user_id)` |
| `chat_messages` | INSERT | `chat_messages: insert own` | LEG-UID | `(auth.uid() = user_id)` |
| `chat_messages` | INSERT | `chat_messages_insert_own` | LEG-UID | `(auth.uid() = user_id)` |
| `chat_messages` | SELECT | `chat_messages: read own` | LEG-UID | `(auth.uid() = user_id)` |
| `chat_messages` | SELECT | `chat_messages_select_by_athlete` | LEG-OL | `(athlete_id IN (athletes.id FROM athletes WHERE ((athletes.owner_account_id = …` |
| `chat_messages` | SELECT | `chat_messages_select_membership` | V2 | `(athlete_id IN (auth_athlete_ids()))` |
| `chat_messages` | SELECT | `chat_messages_select_own` | LEG-UID | `(auth.uid() = user_id)` |
| `chat_messages` | UPDATE | `chat_messages: update own` | LEG-UID | `(auth.uid() = user_id)` |
| `chat_messages` | UPDATE | `chat_messages_update_own` | LEG-UID | `(auth.uid() = user_id)` |
| `coach_proposals` | ALL | `coach_proposals_write_coach` | V2 | `(athlete_id IN (auth_coach_athlete_ids()))` |
| `coach_proposals` | ALL | `coach_proposals_write_member` | V2 | `(athlete_id IN (auth_athlete_ids()))` |
| `coach_proposals` | DELETE | `coach_proposals: delete own` | LEG-UID | `(auth.uid() = user_id)` |
| `coach_proposals` | INSERT | `coach_proposals: insert own` | LEG-UID | `(auth.uid() = user_id)` |
| `coach_proposals` | SELECT | `coach_proposals: read own` | LEG-UID | `(auth.uid() = user_id)` |
| `coach_proposals` | SELECT | `coach_proposals_select_by_athlete` | LEG-OL | `(athlete_id IN (athletes.id FROM athletes WHERE ((athletes.owner_account_id = …` |
| `coach_proposals` | SELECT | `coach_proposals_select_membership` | V2 | `(athlete_id IN (auth_athlete_ids()))` |
| `coach_proposals` | UPDATE | `coach_proposals: update own` | LEG-UID | `(auth.uid() = user_id)` |
| `day_logs` | ALL | `day_logs_write_membership` | V2 | `(athlete_id IN (auth_athlete_ids()))` |
| `day_logs` | DELETE | `day_logs: delete own` | LEG-UID | `(auth.uid() = user_id)` |
| `day_logs` | INSERT | `day_logs: insert own` | LEG-UID | `(auth.uid() = user_id)` |
| `day_logs` | SELECT | `day_logs: read own` | LEG-UID | `(auth.uid() = user_id)` |
| `day_logs` | SELECT | `day_logs_select_by_athlete` | LEG-OL | `(athlete_id IN (athletes.id FROM athletes WHERE ((athletes.owner_account_id = …` |
| `day_logs` | SELECT | `day_logs_select_membership` | V2 | `(athlete_id IN (auth_athlete_ids()))` |
| `day_logs` | UPDATE | `day_logs: update own` | LEG-UID | `(auth.uid() = user_id)` |
| `readiness_daily` | SELECT | `readiness_daily_select` | V2 | `(athlete_id IN (auth_athlete_ids()))` |
| `sessions` | DELETE | `sessions: delete own` | LEG-UID | `(auth.uid() = user_id)` |
| `sessions` | DELETE | `sessions_delete_membership` | V2 | `((athlete_id IN (auth_coach_athlete_ids())) OR ((athlete_id IN (auth_athlete_i…` |
| `sessions` | INSERT | `sessions: insert own` | LEG-UID | `(auth.uid() = user_id)` |
| `sessions` | INSERT | `sessions_insert_membership` | V2 | `(athlete_id IN (auth_athlete_ids()))` |
| `sessions` | SELECT | `sessions: read own` | LEG-UID | `(auth.uid() = user_id)` |
| `sessions` | SELECT | `sessions_select_by_athlete` | LEG-OL | `(athlete_id IN (athletes.id FROM athletes WHERE ((athletes.owner_account_id = …` |
| `sessions` | SELECT | `sessions_select_membership` | V2 | `(athlete_id IN (auth_athlete_ids()))` |
| `sessions` | UPDATE | `sessions: update own` | LEG-UID | `(auth.uid() = user_id)` |
| `sessions` | UPDATE | `sessions_update_membership` | V2 | `((athlete_id IN (auth_coach_athlete_ids())) OR ((athlete_id IN (auth_athlete_i…` |
| `training_plan_weeks` | ALL | `training_plan_weeks_write_coach` | V2 | `(athlete_id IN (auth_coach_athlete_ids()))` |
| `training_plan_weeks` | ALL | `training_plan_weeks_write_member` | V2 | `(athlete_id IN (auth_athlete_ids()))` |
| `training_plan_weeks` | DELETE | `training_plan_weeks_delete_own` | LEG-UID | `(auth.uid() = user_id)` |
| `training_plan_weeks` | INSERT | `training_plan_weeks_insert_own` | LEG-UID | `(auth.uid() = user_id)` |
| `training_plan_weeks` | SELECT | `training_plan_weeks_select_by_athlete` | LEG-OL | `(athlete_id IN (athletes.id FROM athletes WHERE ((athletes.owner_account_id = …` |
| `training_plan_weeks` | SELECT | `training_plan_weeks_select_membership` | V2 | `(athlete_id IN (auth_athlete_ids()))` |
| `training_plan_weeks` | SELECT | `training_plan_weeks_select_own` | LEG-UID | `(auth.uid() = user_id)` |
| `training_plan_weeks` | UPDATE | `training_plan_weeks_update_own` | LEG-UID | `(auth.uid() = user_id)` |
| `training_plans` | ALL | `training_plans_write_coach` | V2 | `(athlete_id IN (auth_coach_athlete_ids()))` |
| `training_plans` | ALL | `training_plans_write_member` | V2 | `(athlete_id IN (auth_athlete_ids()))` |
| `training_plans` | DELETE | `training_plans_delete_own` | LEG-UID | `(auth.uid() = user_id)` |
| `training_plans` | INSERT | `training_plans_insert_own` | LEG-UID | `(auth.uid() = user_id)` |
| `training_plans` | SELECT | `training_plans_select_by_athlete` | LEG-OL | `(athlete_id IN (athletes.id FROM athletes WHERE ((athletes.owner_account_id = …` |
| `training_plans` | SELECT | `training_plans_select_membership` | V2 | `(athlete_id IN (auth_athlete_ids()))` |
| `training_plans` | SELECT | `training_plans_select_own` | LEG-UID | `(auth.uid() = user_id)` |
| `training_plans` | UPDATE | `training_plans_update_own` | LEG-UID | `(auth.uid() = user_id)` |
| `week_summaries` | ALL | `week_summaries_write_membership` | V2 | `(athlete_id IN (auth_athlete_ids()))` |
| `week_summaries` | DELETE | `week_summaries: delete own` | LEG-UID | `(auth.uid() = user_id)` |
| `week_summaries` | INSERT | `week_summaries: insert own` | LEG-UID | `(auth.uid() = user_id)` |
| `week_summaries` | SELECT | `week_summaries: read own` | LEG-UID | `(auth.uid() = user_id)` |
| `week_summaries` | SELECT | `week_summaries_select_by_athlete` | LEG-OL | `(athlete_id IN (athletes.id FROM athletes WHERE ((athletes.owner_account_id = …` |
| `week_summaries` | SELECT | `week_summaries_select_membership` | V2 | `(athlete_id IN (auth_athlete_ids()))` |
| `week_summaries` | UPDATE | `week_summaries: update own` | LEG-UID | `(auth.uid() = user_id)` |
| `whoop_workouts` | SELECT | `whoop_workouts_select` | LEG-OL | `(EXISTS (1 FROM athletes a WHERE ((a.id = whoop_workouts.athlete_id) AND ((a.o…` |
| `whoop_workouts` | SELECT | `whoop_workouts_select_membership` | V2 | `(athlete_id IN (auth_athlete_ids()))` |

Para cada policy legacy, la pareja de consultas de equivalencia por
`(tabla, comando)` quedó **derivada del dump el 2026-09-06** y sigue pendiente
de **ejecución**; §6 y §6bis registran el alcance exacto.

### 2bis-pre. Comandos que el corte dejaría sin ninguna policy

Expandiendo cada policy `ALL` a sus cuatro comandos, la matriz
`(tabla, comando)` sobre las 13 tablas tiene **dos celdas cubiertas sólo por
legacy**:

| Tabla | Cmd | Policy legacy | Reemplazo v2 |
|---|---|---|---|
| `athletes` | INSERT | `athletes_insert` (`auth.uid() = owner_account_id`) | **ninguno** |
| `athletes` | DELETE | `athletes_delete` (`auth.uid() = owner_account_id`) | **ninguno** |

Confirmado en producción el 2026-09-06: `pg_policies` sobre `athletes` devuelve
exactamente `INSERT = 1` y `DELETE = 1`, y por el dump se sabe que esas dos son
las legacy.

**HALLAZGO — bloquea el diseño de `031`.** Ninguna migración crea *policy* de
membresía para INSERT o DELETE sobre `athletes`: `013b` §8b sólo cubre SELECT y
UPDATE, y `030` no agrega policies a la tabla. Los dos comandos se usan desde el
cliente autenticado —`ensureRemoteAthlete` (`src/services/syncService.ts:2296`),
`ensureRemoteManagedAthleteOnce` (`:2313`) y `pushAthlete` (`:2605`) hacen
`upsert(…, { onConflict: 'id' })`, y `deleteManagedAthleteRemote` (`:1602`) hace
`delete().eq('id',…).eq('owner_account_id',…)`—, así que retirar las 49 sin más
rompería el alta de atletas y el borrado duro del roster. Peor: como
`ensureRemoteAthlete` es la reparación que corre dentro del drenaje de cola,
la falla no sería un error puntual sino una cola agotada.

**Matiz que corrige una primera lectura de este hallazgo.** `030` **sí** escribió
los reemplazos, pero como RPC `security definer` y **sin cablear ninguno**:
`create_self_athlete(text)` (concedida a `authenticated`),
`admin_create_managed_athlete(uuid,text,text)` y `admin_delete_athlete(uuid,text)`
(sólo `service_role`). Lo que falta no es autoridad en la base, son los tres call
sites del cliente. Y `admin_create_managed_athlete` exige
`account_role = 'coach'`, que producción no tiene, así que retirar el INSERT
arrastra la regla «gestionado sólo bajo cuenta coach» que `030` postergó — es
Entrega 2, no 1b.

**Cerrado el 2026-09-06:** `034` y `031` fueron aplicadas y verificadas
—`policies_totales = 31`, `athletes_policies = 5`, `legacy_restantes = 1`,
`columnas_aun_nullable = 0`, helper instalado—. Evidencia en
[`smokes/2026-09-06-031-cut-runbook.md`](2026-09-06-031-cut-runbook.md).

La decisión resultante está en
[`specs/2026-09-06-migration-031-cut-design.md`](../specs/2026-09-06-migration-031-cut-design.md):
`031` retira **48** policies, conserva y re-declara sólo la de INSERT de
`athletes` como bootstrap del modelo, y reemplaza la de DELETE por una policy de
membresía con helper `security definer` propio —conservarla es el único riesgo
destructivo nuevo que aparece con el primer atleta reclamado—. El corte queda
además condicionado a que `athlete_id` deje de poder ser null, porque
`withAthleteId` no es total y tres productores de plan pueden emitirlo vacío.

## 2bis. Padrón de producción (2026-09-05)

Evidencia previa al backfill, obtenida antes de aplicar `028`/`029`/`030`.

| Métrica | Valor |
|---|---:|
| `auth.users` | 7 |
| Cuentas que poseen atletas | 7 |
| `athletes` totales | 8 |
| Self (`linked_account_id = owner_account_id`) | 7 |
| Gestionados (`linked_account_id is null`) | 1 |
| Reclamados (`linked <> owner`, no nulo) | 0 |
| `athlete_memberships` totales | 8 |
| — de ellas `role = 'self'` | 7 |
| — de ellas `role = 'coach'` | 1 |

Lecturas que se derivan de estos números:

1. **El trigger `athletes_seed_membership` de `013b` viene operando**: 8
   membresías para 8 atletas, sin reclamados. El backfill de la sección 3
   debería insertar **0 filas**; una inserción distinta de cero indicaría un
   caso que el trigger no cubrió y hay que explicarlo antes de 1b.
2. **Existe exactamente una cuenta híbrida**: 7 cuentas poseen 8 atletas, así
   que una de ellas tiene su self y además el único gestionado. Es el caso que
   la decisión transitoria de `030` acomoda a propósito —impone «un coach nunca
   tiene self» y posterga el recíproco a 1b—.
3. **El trigger de invariantes de `030` actúa desde el momento en que se
   aplica**, no desde el backfill: las membresías `self` ya existen para las 7
   cuentas. Por eso la verificación de idempotencia del upsert self
   (`insert ... on conflict (id) do update` dos veces seguidas) va inmediatamente
   después de aplicar `030` y antes de desplegar el bundle.
4. **La ventana de auditoría de la sección 6 será delgada**: las cuentas están
   invitadas pero sin uso, así que los contadores `wouldGrant`/`wouldDeny`
   dependerán casi por completo del tráfico del owner. La evidencia que habilita
   1b es la equivalencia por `(tabla, comando)` de la sección 2, que es estática
   y no requiere tráfico.

## 3. Backfill de memberships

Ejecutado 2026-09-05. Precedido por una corrida en seco que contó los candidatos
de los cuatro casos del script: **0, 0, 0, 0**.

- Filas insertadas: **0**. Estado posterior idéntico al padrón previo —
  `memberships_totales = 8`, `self_rows = 7`, `coach_rows = 1`.
- Verificación A, roles que no coinciden con 013b: **0**
- Verificación B, pares legacy sin membership: **0**
- Verificación C, linked reclamado sin rol `self`: **0**
- Resultado: **APROBADO.** Confirma la lectura 1 de §2bis: el trigger
  `athletes_seed_membership` de `013b` venía operando y no dejó huecos.

## 4. Filas sin `athlete_id`

Medido 2026-09-05.

| Tabla | Conteo |
|---|---:|
| sessions | 0 |
| day_logs | 0 |
| week_summaries | 0 |
| chat_messages | 0 |
| coach_proposals | 0 |
| athlete_profiles | 0 |
| training_plans | 0 |
| **training_plan_weeks** | **12** |
| whoop_workouts | 0 |

**HALLAZGO — bloquea 031.** `training_plan_weeks` tiene 12 filas sin
`athlete_id`. No es una regresión de 1a: es deuda preexistente que esta
auditoría destapó. Diagnóstico de recuperabilidad:

| Métrica | Valor |
|---|---:|
| Filas nulas | 12 |
| Con plan padre | 12 |
| Padres con `athlete_id` | 12 |
| Planes distintos | 2 |
| Huérfanas | 0 |

Las 12 son **totalmente derivables** desde `training_plans.athlete_id`. La
corrección corresponde a una migración numerada propia (no se aplicó a mano en
el editor, para no saltarse la disciplina de migraciones manuales del
proyecto). Volver a medir esta tabla después de aplicarla.

Criterio para 031: todos los conteos deben ser cero. Si se necesita una
migración, se ejecuta y esta tabla se vuelve a medir antes del corte; una
migración sólo aprobada no sustituye evidencia.

## 5. Cobertura Whoop

`readiness_daily` tiene equivalencia `SELECT` propia en la consulta. Para
`whoop_workouts`, `030` agrega `whoop_workouts_select_membership` sin retirar
la policy legacy por owner/linked de `012`.

- Estado de `whoop_workouts/select/membership_policy`: **efectiva** (2026-09-05).
  Un sync manual del owner leyó 3 workouts reales desde `whoop_workouts` con la
  policy de `030` instalada junto a la legacy `whoop_workouts_select`, sin
  ningún 403. `readiness_daily` también visible (tarjeta de readiness y prefill
  «DESDE WHOOP»), lo que ejercita su predicado v2 de `013b`.
- Migración de Etapa A: `030_athlete_role_invariants.sql`.
- Equivalencia bidireccional posterior: **pendiente**. Lo observado prueba que
  la lectura del self no se rompió; no prueba equivalencia de conjuntos entre la
  policy legacy y la de membresía, que es lo que exige el corte a 1b.

Mientras esta sección no sea verde, **1b queda bloqueada**: hay que confirmar
la policy efectiva y documentar equivalencia antes de retirar la legacy.

## 6. Equivalencia por `(tabla, comando)`

Diagnóstico ejecutado 2026-09-05, posterior al backfill. **Las nueve
direcciones dieron cero**, en ambos sentidos:

| Tabla / comando | Dirección | Filas |
|---|---|---:|
| athletes + hijas / SELECT | legacy_only | 0 |
| athletes + hijas / SELECT | membership_only | 0 |
| athletes / UPDATE | legacy_only | 0 |
| athletes / UPDATE | membership_only | 0 |
| sessions / SELECT (`user_id`) | legacy_only | 0 |
| day_logs / SELECT (`user_id`) | legacy_only | 0 |
| week_summaries / SELECT (`user_id`) | legacy_only | 0 |
| chat_messages / SELECT (`user_id`) | legacy_only | 0 |
| coach_proposals / SELECT (`user_id`) | legacy_only | 0 |

Sobre los datos de producción, el conjunto de acceso legacy y el de membresía
son **idénticos**.

**Alcance honesto de esta evidencia.** Es el diagnóstico agrupado que el propio
archivo declara insuficiente para acreditar el corte: prueba que los conjuntos
coinciden con los datos de HOY (8 atletas, 8 membresías, un solo caso híbrido),
no que los predicados sean equivalentes en general.

### 6bis. Par por `(tabla, comando)` — derivado y EJECUTADO 2026-09-06

El par que faltaba está **generado desde el dump**, no escrito a mano:
[`supabase/queries/2026-09-06-policy-equivalence-per-command.sql`](../../../supabase/queries/2026-09-06-policy-equivalence-per-command.sql)
§2 contiene **44 pares = 88 consultas**, una por `(tabla, comando, dirección)`.

Tres decisiones de método, para que el resultado signifique algo:

1. **Los predicados salen del `qual`/`with_check` real**, traducidos uno a uno
   desde el CSV; el generador falla si aparece una forma que no sabe traducir, así
   que ninguna policy queda silenciosamente fuera. Las 12 formas distintas del
   dump están cubiertas.
2. **Cuantifica sobre `auth.users` en vez de impersonar**: los helpers
   `auth_*_ids()` quedan inlineados con su cuerpo de `013b` §6. Así una sola
   corrida cubre las 7 cuentas en vez de 7 sesiones.
3. **`UPDATE` se parte en `using` y `check`.** Postgres los evalúa por separado y
   en `sessions` divergen a propósito: el `USING` v2 filtra por
   `authored_by_role` y el `WITH CHECK` no. Colapsarlos habría vuelto a esconder
   exactamente el caso que §6 declaraba sin cubrir. El par
   `sessions / UPDATE/using` es el que modela
   `coalesce(authored_by_role,'self') = 'self'`, y existe también para DELETE.

**Y el resultado ya se puede anticipar por derivación, no por corrida.**
Clasificando los 44 pares por la forma de sus dos lados, sólo hay **dos**
condiciones bajo las cuales cualquiera de ellos puede dar distinto de cero:

| Condición de divergencia | Pares afectados | Estado en producción |
|---|---:|---|
| Existe un **atleta reclamado** (`linked_account_id <> owner_account_id`), así que el `user_id` estampado en la fila y la cuenta con membresía `self` sobre su atleta son distintas | 40 | **0 reclamados** (§2bis) |
| Una **membresía desacoplada** de `owner_account_id`/`linked_account_id` | 12 | **0 divergencias** (§3, verificaciones A/B/C) |

(Los conjuntos se solapan: 8 pares dependen de ambas.) Los dos pares de
`sessions` UPDATE/DELETE con `authored_by_role` caen en la primera fila: para que
`legacy_only` sea distinto de cero hace falta una sesión con
`authored_by_role = 'coach'` cuyo atleta sea alcanzable sólo por membresía
`self` — otra vez, un atleta reclamado. La cuenta híbrida de hoy no sirve:
alcanza al gestionado por membresía `coach`, así que las dos ramas conceden.

**Resultado de la corrida (producción, 2026-09-06):** `consultas = 88`,
`no_cero = 0`, `detalle = TODAS EN CERO`. Las 44 direcciones `legacy_only` y las
44 `membership_only` dan cero, incluidas `sessions / UPDATE/using` y
`sessions / DELETE`, que son las que modelan `authored_by_role`.

Los tres hechos que sostienen la derivación se re-midieron en la misma sesión:
`atletas_reclamados = 0`, `reclamado_sin_membresia_self = 0` y
`membresias_vs_owner_linked_divergentes = 0`. También se recontaron las filas sin
`athlete_id` en las nueve tablas: **ninguna tabla tiene una sola**, lo que
revalida §4 después de `033`.

**Consecuencia para la planificación, y es el punto de esta sección:** la corrida
confirma el cero que ya se derivaba de §2bis y §3, así que deja evidencia
directa, pero **no cierra el argumento general** y ninguna consulta adicional
sobre producción lo va a cerrar mientras no exista un atleta reclamado. Es el
mismo sujeto ausente que deja a R3 (§7) sin aislar y a la ventana de auditoría
(§8) sin capacidad de discriminar. Los tres se desbloquean con el mismo hecho
—el primer atleta reclamado, que produce la Entrega 2— y no con más SQL.

## 7. Restricciones intencionales de INSERT/DELETE

Ejercitadas en producción el 2026-09-05, cada una dentro de `begin … rollback`,
así que ninguna dejó fila.

| ID | Restricción | Evidencia observada | Aprobación |
|---|---|---|---|
| R1 | Una cuenta coach no puede crear un atleta self | `ERROR P0001: athletes: a coach account cannot own a self athlete` (`enforce_athlete_role_invariants` línea 14), con `account_role='coach'` fijado dentro de la transacción. Prueba de paso que el trigger lee la columna de `028`. | **Verificada** |
| R2 | Una cuenta no puede crear un segundo atleta self | `ERROR P0001: athletes: account already has a self athlete` (línea 31) | **Verificada** |
| R3 | El borrado de roster rechaza atletas con membership self | **No aislada.** `admin_delete_athlete` rechazó, pero con el guard anterior: `actor has no coach membership over athlete` (línea 8). El guard que R3 nombra (línea 178) exige un actor con membresía coach sobre un atleta que además tenga membresía self —es decir, un atleta **reclamado**— y producción tiene 0. Construirlo sintéticamente requería borrar y recrear membresías, y el editor lo marcó como operación destructiva: **no se forzó**. Queda cubierto sólo por el test de contrato. | Pendiente |
| R4 | Managed bajo cuenta athlete sigue permitido en 1a | Inserción de un atleta gestionado (`linked_account_id is null`) bajo la cuenta athlete del owner: **1 fila**, permitida. Revertida. | **Verificada** |

Nota sobre R3: el rechazo se produjo igual, así que no hay riesgo abierto; lo
que falta es la evidencia de que rechaza **por la razón correcta**. Se cierra
solo cuando exista el primer atleta reclamado, que es tráfico de 1b.

## 8. Auditoría de decisiones del servidor

Leída el 2026-09-05 vía `netlify logs --source functions --function coach
--since 24h`, con el sitio enlazado por CLI.

- Inicio de ventana: 2026-09-05 (deploy de `6a02d32`, `COACH_AUTHZ_MODE=audit`
  confirmado por `netlify env:get` en contexto Production).
- Fin de ventana: 2026-09-05, primera lectura.
- Versión desplegada: `6a02d32` (= `origin/main`).
- Muestra `wouldDeny`: **0**.
- Muestra `wouldGrant`: **0**.
- Clases y superficies cubiertas: `chat_general` (cuenta `free`) y
  `chat_action` (cuenta `advanced`); **2 requests**, ambas `outcome: ok`.
- Errores `unreadable`/503 observados: **0**.

**Lectura correcta del cero.** `[coach-authz]` se emite sólo ante divergencia
entre legacy y sombra (`coachAuthzMode.ts:87`), no por request. El silencio es
evidencia positiva de acuerdo, pero sólo vale porque se acreditó por separado,
en los mismos logs, que hubo dos requests que atravesaron ese punto.

**Lo que este cero NO acredita.** La única cuenta de producción tiene
`account_role = athlete`, cero membresías y cero atletas reclamados, así que la
sombra recibe entradas casi idénticas a la legacy. Queda demostrado que no
diverge de forma espuria; no que discrimine bien. La rama que 1b hace efectiva
sigue sin tráfico real.

Los registros pegados aquí no deben contener identificadores de cuenta o
atleta.

## 9. Decisión de salida

- [x] Las 25 policies de 013b esperadas están instaladas y `readiness_daily_select` tiene el predicado v2. — cerrado el 2026-09-06: 25/25 nombre por nombre, con `cmd`/`qual`/`with_check`/`permissive`/`roles` idénticos al texto de `013b`; las 4 policies v2 restantes provienen de `030` (§1).
- [x] `whoop_workouts_select_membership` de 030 está instalada sin retirar la legacy. — verificado por efecto (§5).
- [x] Se inventariaron todas las policies efectivas de producción. — dump completo con `qual`/`with_check` archivado en `evidence/2026-09-05-pg-policies-produccion.csv` (78 filas; 49 legacy, 28 V2, 1 otro).
- [x] El backfill dejó cero pares legacy sin membership. — 0 inserciones, A/B/C en cero (§3).
- [x] No quedan filas sin `athlete_id` en las nueve tablas medidas. — cerrado el 2026-09-05: migración `033` aplicada (0 restantes, guard fail-closed sin excepción) y corregido el productor en `asyncGenerationLoop.ts`, que era quien las creaba (§4).
- [ ] `whoop_workouts` tiene policy membership y equivalencia SELECT documentada. — policy sí; equivalencia bidireccional pendiente.
- [x] Cada tabla/comando tiene ambas direcciones comparadas. — ejecutadas en producción el 2026-09-06: **88 consultas, 0 distintas de cero**, incluidas `sessions` UPDATE/DELETE con `authored_by_role` (§6bis). Acredita el cero con los datos de hoy; la equivalencia general sigue dependiendo de que exista un atleta reclamado.
- [x] Toda diferencia observada coincide con un caso enumerado y firmado. — no se observó ninguna diferencia.
- [ ] Todo caso enumerado aparece en la evidencia o se justificó como no aplicable. — R1, R2 y R4 verificados en transacciones revertidas; **R3 pendiente**: el borrado se rechazó por el guard anterior (actor sin membresía coach), no por el que R3 nombra, y aislarlo exige un atleta reclamado, que producción no tiene (§7).
- [ ] La ventana audit cubrió las capacidades objetivo. — leída: 2 requests, cero divergencias, cero `unreadable`. Cobertura **insuficiente** y con el límite de §8: una sola cuenta athlete sin membresías.
- [x] No se habilitó `COACH_AUTHZ_MODE=enforce`.

Conclusión: **NO APROBADO todavía para 031.** Nueve casillas cerradas.

El trabajo de evidencia que podía hacerse sin producción y sin API está hecho:
el `LEFT JOIN` nominal de §1 cerró 25/25 y el par por `(tabla, comando)` de
§6bis está derivado del dump, listo para pegar. Lo que queda ya no es
consulta:

1. ✅ **Las 88 consultas de §6bis se ejecutaron** el 2026-09-06: todas en cero.
2. **Resolver el hallazgo de §2bis-pre**: `athletes` INSERT y DELETE no tienen
   reemplazo v2, así que `031` no puede ser «retirar las 49 legacy». Es una
   decisión de diseño de 1b, previa a escribir la migración.
3. **Conseguir el sujeto que falta.** Un atleta reclamado es lo único que puede
   volver informativos, a la vez, la equivalencia general de §6bis, el guard R3
   de §7 y la ventana de auditoría de §8. Lo produce la Entrega 2, no 1b: sin él
   `enforce` cortaría con una regla que nunca se ejerció contra su caso.

Actualización del 2026-09-06: **Plan Builder volvió a funcionar** sobre
`411aac3` tras el deploy del arreglo de logging y un reset de caché del
navegador (2 semanas, `succeeded`, US$0,053). La corrida real dejó **0 semanas
sin `athlete_id`** y la tabla completa sigue en **0**, lo que verifica en
producción no sólo la migración `033` sino el arreglo del productor que las
generaba. La causa del fallo original quedó **sin nombre**: el reset reconstruyó
el borrador y destruyó la evidencia. Ver el Paso 7 del runbook de rollout.

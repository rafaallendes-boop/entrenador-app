# `031` — qué retira el corte de policies legacy

Fecha: 2026-09-06. Estado: **escrita, sin aplicar.**
Evidencia de producción incorporada el mismo día: §3.2 y §6 pasos 1–2.

Implementación:
[`034_athlete_id_not_null.sql`](../../../supabase/034_athlete_id_not_null.sql) →
[`031_retire_legacy_policies.sql`](../../../supabase/031_retire_legacy_policies.sql),
con [`032_restore_legacy_policies.sql`](../../../supabase/032_restore_legacy_policies.sql)
como rollback y `supabase/__tests__/migration031Contract.test.ts` fijando el
contrato de las tres. **`034` se aplica antes que `031`** pese al número mayor.
Insumo: el dump `docs/superpowers/smokes/evidence/2026-09-05-pg-policies-produccion.csv`
y las consultas derivadas en
[`supabase/queries/2026-09-06-policy-equivalence-per-command.sql`](../../../supabase/queries/2026-09-06-policy-equivalence-per-command.sql).
Cero llamadas a producción y cero API para producirlo.

## 1. La pregunta

La auditoría 1a dejó `031` descrita como «retirar las 49 policies legacy». La
matriz `(tabla, comando)` del dump muestra que esa descripción es incorrecta y
que el corte, tal como está enunciado, rompería producción.

## 2. Hallazgo: dos comandos sin reemplazo declarativo

Expandiendo cada policy `ALL` a sus cuatro comandos, **47 de las 49 legacy tienen
una policy de membresía que cubre su misma celda**. Las dos excepciones son:

| Tabla | Cmd | Policy legacy | Policy v2 |
|---|---|---|---|
| `athletes` | INSERT | `athletes_insert` (`auth.uid() = owner_account_id`) | **ninguna** |
| `athletes` | DELETE | `athletes_delete` (`auth.uid() = owner_account_id`) | **ninguna** |

`013b` §8b sólo cubre SELECT y UPDATE de `athletes`; `030` no agrega policies a
esa tabla.

**Corrección a una lectura anterior:** decir «ninguna migración creó el
reemplazo» es falso. `030` **sí** escribió los tres reemplazos, como RPC
`security definer`, y ninguno está cableado:

| RPC de `030` | Grant | Cubre | Cableada |
|---|---|---|---|
| `create_self_athlete(text)` | `authenticated` | alta del atleta self | **no** |
| `admin_create_managed_athlete(uuid,text,text)` | `service_role` | alta de gestionado | **no** |
| `admin_delete_athlete(uuid,text)` | `service_role` | borrado duro de roster | **no** |

Lo que falta no es la autoridad en la base: son los tres call sites del cliente.

## 3. Qué depende hoy de esas dos policies

Tres caminos del cliente escriben `athletes` con `upsert(..., { onConflict: 'id' })`:

| Camino | Ubicación | Qué crea |
|---|---|---|
| `ensureRemoteAthlete` / `ensureRemoteAthleteOnce` | `src/services/syncService.ts:2296` | el atleta **self** (owner = linked = uid) |
| `ensureRemoteManagedAthleteOnce` | `src/services/syncService.ts:2313` | la fila del atleta **gestionado** |
| `pushAthlete` | `src/services/syncService.ts:2605` | cualquier atleta del roster |

y uno borra: `deleteManagedAthleteRemote`
(`src/services/syncService.ts:1602`, `delete().eq('id',…).eq('owner_account_id',…)`).

Dos consecuencias que elevan la severidad por encima de «no se pueden crear
atletas nuevos»:

1. **`ensureRemoteAthlete` es la reparación que corre dentro del drenaje de
   cola** —la regla del proyecto dice que `pullAthletes` va antes de
   `drainQueue` precisamente porque una escritura encolada puede recrear el
   padre por esta vía—. Si el insert queda sin policy, la reparación falla y la
   cola del atleta se agota: el mismo modo de falla del incidente de §34, con
   otra causa.
2. **Sin ninguna policy permisiva de INSERT, un `INSERT … ON CONFLICT DO UPDATE`
   se rechaza incluso cuando la fila ya existe**, porque el `WITH CHECK` de
   INSERT se evalúa sobre la fila propuesta antes de resolver el conflicto. El
   corte no rompería sólo el alta: rompería **todo** push de `athletes`,
   incluido el estado estacionario.

   **Medido en producción el 2026-09-06**, sin tocar ninguna tabla real: una
   tabla `temp` con RLS, policies de SELECT y UPDATE y **sin** policy de INSERT,
   dentro de `begin … rollback` y con `set local role authenticated`. Sobre una
   fila que **ya existía**, el upsert devolvió
   `new row violates row-level security policy`, mientras el `update` directo
   sobre la misma fila pasó. Deja de ser semántica citada y pasa a ser resultado
   observado.

## 4. Decisión

### 4.1 `athletes` INSERT — se conserva, y se re-declara

`031` **conserva** la policy de INSERT y la renombra para que deje de leerse
como deuda (`athletes_insert` → `athletes_insert_bootstrap_owner`), con el mismo
`with check (owner_account_id = auth.uid())`.

Razón estructural, no de conveniencia: **la membresía no puede autorizar el
insert que la siembra.** El trigger `athletes_seed_membership` de `013b` crea la
membresía *desde* la fila de `athletes`, así que en el instante del insert no
existe ninguna membresía sobre la que predicar. Cualquier policy de INSERT sobre
esta tabla tiene que hablar de `owner_account_id`.

No es un agujero del modelo two-sided: sólo permite crear una fila que el propio
actor posee, y los invariantes de rol de `030` (un coach no posee self, una
cuenta no tiene dos selfs) actúan por trigger sobre cualquier camino de
inserción, incluida esta policy — `030` lo declara explícitamente.

Retirarla algún día exige las dos puntas:

- self → el cliente llama `create_self_athlete`, que ya está concedida a
  `authenticated` y no necesita policy;
- gestionado → un endpoint con service role que llame
  `admin_create_managed_athlete`, **que exige `account_role = 'coach'`**.

Producción no tiene ninguna cuenta coach y el owner es `athlete`, que hoy crea
gestionados de forma deliberadamente permitida (R4 de la auditoría). Por lo
tanto retirar el INSERT **es Entrega 2, no 1b**: obliga la regla «gestionado
sólo bajo cuenta coach» que `030` postergó a propósito.

### 4.2 `athletes` DELETE — se reemplaza en `031`

`031` **retira** `athletes_delete` y crea su equivalente por membresía. Es el
único de los dos casos que sí pertenece al corte, porque conservarlo es el único
riesgo destructivo **nuevo** que aparece con el primer atleta reclamado:

en un atleta reclamado el owner sigue siendo el coach, así que
`auth.uid() = owner_account_id` le permitiría borrar la fila del atleta
directamente desde el cliente y cascadear todos sus datos por el FK
`athlete_profiles_athlete_fk … on delete cascade` de `007`, **saltándose el
guard que `030` ya escribió** (`admin_delete_athlete` rechaza un atleta con
membresía `self`).

Forma propuesta, siguiendo el patrón anti-recursión de `013b` §6:

```sql
create or replace function public.auth_deletable_athlete_ids()
returns setof text
language sql stable security definer
set search_path = public
as $$
  select m.athlete_id
  from public.athlete_memberships m
  join public.athletes a on a.id = m.athlete_id
  where m.account_id = auth.uid()
    and m.role = 'coach'
    -- sin membresía self de nadie…
    and not exists (
      select 1 from public.athlete_memberships s
      where s.athlete_id = m.athlete_id and s.role = 'self'
    )
    -- …y sin forma de reclamado tampoco, aunque le falte la membresía
    and (a.linked_account_id is null
         or a.linked_account_id = a.owner_account_id)
$$;

create policy athletes_delete_membership on public.athletes
  for delete using (id in (select public.auth_deletable_athlete_ids()));
```

La segunda condición no es redundante. `030` **no** restringe
`linked_account_id`: su rama `else` es un `null` explícito, decisión transitoria
de 1a. Así que hoy un insert del cliente puede fijar
`linked_account_id = <otra cuenta>` —la policy sólo exige `owner = auth.uid()`—
y `athletes_seed_membership` sembraría **sólo** `coach`, sin `self`, porque el
consentimiento de reclamo pertenece a los RPC de invitación de SP1b. Esa fila
tiene forma de reclamada y no tiene membresía `self`, de modo que un guard basado
sólo en membresías la dejaría borrable. La verificación C de la auditoría contó
**0** filas así, pero nada lo impide.

**El helper es obligatorio, no cosmético.** `athlete_memberships` tiene RLS con
policy `account_id = auth.uid()`, así que una subconsulta escrita en línea
dentro de la policy sólo vería las membresías del propio actor: la membresía
`self` de *otra* cuenta sería invisible y el guard no dispararía nunca. Es
exactamente la trampa que `013b` resolvió con `security definer`.

Impacto hoy: **ninguno**. El único borrado remoto de `athletes` que hace el
cliente es de gestionados, y un gestionado tiene membresía `coach` para su owner
y no tiene `self` (`013b` la siembra como `coach` cuando `linked_account_id` es
null). El reset de cuenta no borra filas de `athletes` a propósito
(`syncService.ts:3157`). El cambio estrecha el acceso sin quitar nada en uso, lo
que es la definición de un corte seguro.

### 4.3 Precondición de datos: `athlete_id` tiene que dejar de poder ser null

`033` cerró las 12 filas existentes y arregló su productor, pero **no** agregó
`not null`, y lo dejó anotado como decisión de 1b. Esta es esa decisión, y la
respuesta es que **`031` no puede aplicarse sin ella o sin su equivalente en el
cliente**.

Toda policy v2 predica `athlete_id in (…)`, que es falso cuando la columna es
null. Con las legacy vivas, una fila sin `athlete_id` entra igual por
`auth.uid() = user_id`; después del corte se convierte en un 403 permanente
sobre una operación encolada, que es cómo se agota una cola. Y nada impide
producir filas nuevas así:

- `withAthleteId` **no es total**: si no hay `athleteId` de la entidad ni atleta
  activo, devuelve la fila *sin* la clave (`syncService.ts:2267`);
- `trainingPlanWeekToRow` emite `athlete_id: week.athleteId ?? null` explícito
  (`planBuilder/planRows.ts:62`);
- `pushTrainingPlan` no pasa por `withAthleteId` y `trainingPlanToRow` emite
  `plan.athleteId` sin defensa (`planRows.ts:16`);
- `rowToTrainingPlan` castea `row.athlete_id as string` sin validar
  (`planRows.ts:39`), así que un plan legacy puede reintroducir el null en un
  round-trip — el mismo defecto que §28 ya registró.

Medir cero, como pide §C del plan de 1a, no alcanza: acredita el pasado, no
impide el futuro. Se resolvió con **las dos** capas, no eligiendo una:

- **(a) `athlete_id not null` en las nueve tablas** — `034`, escrita, pendiente
  de aplicar. Es la autoridad: falla en el writer con un constraint, no en RLS.
- **(b) el cliente dejó de poder emitirlas** — hecho el 2026-09-06.
  `withAthleteId` cae al atleta self antes de rendirse; `upsertRow` rechaza una
  fila scoped sin `athlete_id` **antes de tocar la red**, con un mensaje que
  `classifySyncError` reconoce como `validation_error` no reintentable, de modo
  que no se encola ni gasta intentos; el drenaje de cola **repara** una
  operación vieja en vez de descartarla; y `pushTrainingPlan` se estampa igual
  que sus semanas. Guard en
  `src/services/__tests__/athleteScopeWriteGuard.test.ts`.

(b) sin (a) dejaría la garantía en el cliente, que es la capa que el corte deja
de proteger; (a) sin (b) convertiría el defecto en un 400 tardío sobre una
escritura ya intentada. Juntas, el caso no ocurre y, si ocurriera, se corta
temprano y sin ruido.

### 4.4 Cerrar por construcción la segunda clase de divergencia

El análisis de equivalencia (§6bis de la auditoría) deja **dos** condiciones bajo
las que legacy y membresía pueden diferir: un atleta reclamado, y una membresía
desacoplada de `owner_account_id`/`linked_account_id`. Las dos están en cero hoy,
pero sólo la primera está estructuralmente contenida (nada crea reclamos todavía).
La segunda no: el mismo insert del párrafo anterior la produce.

Eso importa para el corte, porque retirar `athletes_select` deja sin lectura a
una cuenta que sea `linked_account_id` sin membresía. Mismo patrón que §4.3:
medir cero acredita el pasado y no impide el futuro.

`031` —o su precondición— debería **rechazar la creación directa de filas con
`linked_account_id` distinto de null y del owner**, ampliando la rama `else` de
`enforce_athlete_role_invariants`, ya que ese camino existe únicamente para los
RPC de invitación que todavía no existen. Con eso la segunda condición pasa de
«cero medido» a «imposible por construcción», y la equivalencia deja de depender
del padrón del día.

## 5. Alcance resultante de `031`

| Acción | Cantidad |
|---|---:|
| Policies legacy retiradas | **48** |
| Policies legacy conservadas y re-declaradas | **1** (`athletes` INSERT) |
| Policies v2 nuevas | **1** (`athletes_delete_membership`) |
| Helpers `security definer` nuevos | **1** (`auth_deletable_athlete_ids`) |
| Triggers endurecidos | **1** (`enforce_athlete_role_invariants`, rama `else`) |

`032` (rollback) recrea las 48 con su texto exacto del dump archivado, que es la
razón por la que ese CSV se conserva en el repo.

## 6. Orden de precedencia

1. ✅ **Hecho (2026-09-06).** Las 88 consultas de equivalencia dieron
   `no_cero = 0`. En el mismo lote: `atletas_reclamados = 0`,
   `reclamado_sin_membresia_self = 0`,
   `membresias_vs_owner_linked_divergentes = 0`, cero filas sin `athlete_id` en
   las nueve tablas, y `athletes` con exactamente una policy de INSERT y una de
   DELETE.
2. ✅ **Hecho (2026-09-06).** El comportamiento del `upsert` sin policy de
   INSERT quedó medido con una tabla temporal en transacción revertida (§3.2).
3. Resolver la precondición de datos (§4.3), con migración propia si es la
   opción (a).
4. Recién entonces escribir `031` con el alcance de §5, y `032` desde el dump.
5. `COACH_AUTHZ_MODE=enforce` sigue después de la Entrega 2: sin un atleta
   reclamado, la regla que `enforce` hace efectiva nunca se ejerció contra su
   caso, y ni la equivalencia general ni el guard R3 ni la ventana de auditoría
   pueden volverse informativos.

## 7. Lo que este documento no resuelve

- Los pasos 1 y 2 de §6 se ejecutaron el 2026-09-06; siguen pendientes el 3
  (precondición de datos) y el 4 (escribir `031`/`032`).
- No decide si el alta de gestionados se mueve a `admin_create_managed_athlete`;
  sólo establece que hacerlo pertenece a la Entrega 2 porque exige la cuenta
  coach.

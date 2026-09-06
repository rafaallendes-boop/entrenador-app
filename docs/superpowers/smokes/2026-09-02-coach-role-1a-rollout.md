# Rollout — separación de rol Coach, Entrega 1a

Estado: **no ejecutado**. Este guion no habilita `enforce` ni aplica `031`.

## Gate local

- Commit/build: sin commit (lo realiza el owner); build local verificado.
- Fecha: 2026-09-02.
- `npm run lint`: PASS.
- `npm test`: PASS.
- `npx tsc -b`: PASS.
- `npm run build`: PASS (8 rutas públicas generadas).
- `git diff --check`: PASS.
- Archivos de test: 534.
- Tests: 4283.
- Línea base: 515 archivos / 4145 tests.

## Orden de migraciones — degradación verificada

El bundle **ya no exige** que `028`, `013b` ni `029` estén aplicadas para
funcionar. Aplicarlas antes sigue siendo el orden correcto, pero desplegar en
el orden equivocado degrada de forma acotada en vez de responder 503 a cada
request. Fijado por `netlify/functions/_shared/__tests__/migrationTolerance.test.ts`.

| Migración ausente | Comportamiento | Alcance de la degradación |
|---|---|---|
| `028` | El select con `account_role` responde `42703`; servidor y cliente reintentan con el contrato anterior y resuelven rol `athlete` | El tier se conserva. Ninguna cuenta puede resolver `coach`, así que `enforce` denegaría las clases de coach — es la razón por la que `enforce` no se enciende en 1a |
| `013b` | La lectura de `athlete_memberships` responde `42P01`/`PGRST205` y se interpreta como ausencia CONFIRMADA de membresía | Fail-closed: la delegación se deniega. En `audit` no cambia nada, porque la sombra no decide |
| `029` | `reserve_ai_usage` responde `PGRST202` y la cuota cae a `increment_ai_usage_if_under_limit`; el preflight cae al select sin `subject_athlete_id` | Equivalente **sólo sin tope por atleta**. Con `quotaSubject` presente falla cerrado con 503: la reserva dual es justamente lo que `029` agrega y no hay sustituto |

Un `400`/`404` que **no** sea columna o tabla ausente sigue siendo `unreadable`
o 503. La tolerancia es al esquema viejo, no a errores en general.

Resultado: pendiente.

## Paso 0 — confirmar 013b en producción

Ejecutar en el SQL Editor esta consulta y guardar la salida completa en
`2026-09-02-coach-authz-audit.md`:

```sql
with expected(tablename, policyname) as (values
  ('athletes','athletes_select_membership'),
  ('athletes','athletes_write_coach'),
  ('athletes','athletes_update_self'),
  ('sessions','sessions_select_membership'),
  ('sessions','sessions_insert_membership'),
  ('sessions','sessions_update_membership'),
  ('sessions','sessions_delete_membership'),
  ('day_logs','day_logs_select_membership'),
  ('day_logs','day_logs_write_membership'),
  ('week_summaries','week_summaries_select_membership'),
  ('week_summaries','week_summaries_write_membership'),
  ('chat_messages','chat_messages_select_membership'),
  ('chat_messages','chat_messages_write_membership'),
  ('athlete_profiles','athlete_profiles_select_membership'),
  ('athlete_profiles','athlete_profiles_write_membership'),
  ('coach_proposals','coach_proposals_select_membership'),
  ('coach_proposals','coach_proposals_write_coach'),
  ('training_plans','training_plans_select_membership'),
  ('training_plans','training_plans_write_coach'),
  ('training_plan_weeks','training_plan_weeks_select_membership'),
  ('training_plan_weeks','training_plan_weeks_write_coach'),
  ('athlete_memberships','athlete_memberships_select_own'),
  ('athlete_coach_notes','athlete_coach_notes_select'),
  ('athlete_coach_notes','athlete_coach_notes_write'),
  ('readiness_daily','readiness_daily_select')
)
select
  e.tablename,
  e.policyname,
  case
    when p.policyname is null then 'FALTA'
    when e.tablename = 'readiness_daily'
      and coalesce(p.qual, '') not ilike '%auth_athlete_ids%'
      then 'FALTA_V2'
    else 'ok'
  end as status,
  p.cmd,
  p.qual
from expected e
left join pg_policies p
  on p.schemaname = 'public'
 and p.tablename = e.tablename
 and p.policyname = e.policyname
order by status desc, e.tablename, e.policyname;
```

Si cualquier fila dice `FALTA` o `FALTA_V2`, detener el rollout. El caso
`FALTA_V2` evita el falso positivo de `readiness_daily_select`: el mismo nombre
existía con el predicado legacy.

Resultado: pendiente.

## Paso 0b — dimensionar cuentas híbridas

Ejecutar la consulta de cuentas no-coach que poseen atletas gestionados incluida
en el plan. Se espera al menos la cuenta híbrida actual: no es un bloqueo para
030, pero sí evidencia obligatoria para diseñar 1b.

```sql
select
  a.id,
  a.owner_account_id,
  coalesce(e.account_role, 'athlete') as current_role
from public.athletes a
left join public.user_entitlements e on e.user_id = a.owner_account_id
where (a.linked_account_id is null or a.linked_account_id <> a.owner_account_id)
  and coalesce(e.account_role, 'athlete') <> 'coach';
```

No cambiar ninguna cuenta existente a rol `coach` durante este paso.

Resultado: pendiente.

## Paso 1 — aplicar migraciones

Aplicar manualmente y en orden:

1. `028_user_entitlement_account_role.sql`
2. `029_ai_usage_daily_subject.sql`
3. `030_athlete_role_invariants.sql`

Después de cada una, comprobar columnas/constraints, firmas y grants de RPC,
policies creadas y recarga de esquema de PostgREST. No desplegar el bundle si
alguna comprobación falla.

Después de 030, confirmar expresamente que existe
`whoop_workouts_select_membership` y que `whoop_workouts_select` legacy sigue
presente durante auditoría.

Resultado: pendiente.

## Paso 2 — desplegar en auditoría

- Mantener `COACH_AUTHZ_MODE` ausente o exactamente `audit`.
- Confirmar los valores vigentes de `ENTITLEMENTS_ENABLED` y
  `AI_USAGE_LIMITS_ENABLED`; no cambiarlos en este rollout.
- Confirmar que `031` y `032` no existen ni fueron aplicadas.

Resultado: pendiente.

## Paso 3 — smoke de no regresión

Ejecutado 2026-09-05 sobre `6a02d32` desplegado (bundle verificado: la cadena
`coach-access` de esta entrega vive en `CoachWorkspacePage-1ESd8c25.js` y
`CoachEngine-BbyGQ5z0.js`). Cuenta del owner, tier `free`.

- [x] Chat general responde. Respuesta con contexto real (lesión lumbar y fase
      taper), tildes correctas y sin caracteres corruptos; ruteó a
      `chat_general`, no a acción.
- [x] Una acción de chat se aplica. **Verificado con tier `advanced`** el
      2026-09-05: la petición produjo propuesta, se aplicó y las sesiones
      quedaron escritas y visibles en el día. En `free` la misma petición había
      devuelto la oferta «Esta función está en el plan Coach Semanal» como
      upsell, no como error técnico — o sea el gate distingue correctamente.
      **Hallazgo de calidad, ajeno a esta entrega:** la propuesta trajo DOS
      sesiones para una petición de una sola («domingo por la mañana»); la
      segunda venía rotulada «Se reparó una solicitud con múltiples
      días/deportes» y se materializó como una sesión PM extra el mismo día. El
      repair infirió multiplicidad donde no la había. Ambas sesiones de prueba
      fueron borradas después.
- [~] Plan Builder puede encolar y el preflight no produce rechazo espurio.
      **Preflight verificado con `advanced`:** `/plans/builder` abre el wizard
      («2 semanas · Evento 11 sep 2026») en vez de redirigir a
      `/competition-plan` como hacía en `free`. Sin upsell ni rechazo espurio.
      **El encolado real NO se disparó:** cuesta API y crea un plan borrador a 6
      días del torneo del owner. Pendiente de su autorización explícita.
- [x] El costo se suma sólo en la fila global (`subject_athlete_id = ''`).
      Verificado **físicamente**: tras la request de chat, `ai_usage_daily` del
      día contiene **una sola fila**, `chat | GLOBAL | 1 | 0.000688`, que
      coincide con el costo síncrono de `/ops`.
- [~] Las filas subject mantienen costo cero. **Vacuamente cierto y por tanto
      no verificado por observación:** no existe ninguna fila subject en
      producción. Es lo esperado — la dimensión subject sólo se puebla cuando un
      coach actúa sobre un atleta ajeno, que es tráfico de 1b. La propiedad
      queda garantizada por estructura (la acumulación de costo filtra
      `subject_athlete_id = ''`), no por evidencia. Volver a medirlo cuando
      exista tráfico coach real.
- [x] `/ops` no duplica requests ni costo.
- [x] `/ops` conserva `coach.safetyBlocked`. Presente y con valor **1** en la
      ventana de 7 días, no sólo el campo vacío.
- [x] WHOOP workouts y readiness siguen visibles para self y vínculos válidos.
      `readiness_daily` visible en la tarjeta del dashboard y en el prefill
      «DESDE WHOOP» del día; `whoop_workouts` leyó **3** workouts reales
      (`[whoop:auto-complete] Whoop workout detected` ×3), sin ningún 403, con
      la policy `whoop_workouts_select_membership` de `030` conviviendo con la
      legacy.
- [ ] Un SQLSTATE desconocido sigue exponiéndose como 503. Pendiente: cubierto
      por tests unitarios, no observado en producción.
- [~] Los rechazos `45001/account` y `45001/subject` se exponen como 429.
      **Mitad productor confirmada en producción**, mitad consumidor por tests.
      `reserve_ai_usage` emitió en producción, dentro de transacciones
      revertidas, `ERROR 45001 / DETAIL: account` y `ERROR 45001 / DETAIL:
      subject` — exactamente los dos valores sobre los que hace pivote
      `parseQuotaRejection` (`usageGate.ts:126`) antes de llamar a
      `makeQuotaExceededError`, que devuelve 429. Lo **no** observado end-to-end
      es la serialización de PostgREST (`DETAIL` → campo `details`) y el mapeo
      a 429 en la Function; eso sigue cubierto sólo por tests unitarios.

### Instrumento: ventana de 24 h en cero

La ventana de 24 h estaba en cero antes de empezar, así que **una sola** request
de chat separa el conteo correcto del duplicado.

| Métrica (24 h) | Antes | Después de 1 chat |
|---|---:|---:|
| Requests de coach | 0 | 1 |
| Cobertura | 0/0 filas | 1/1 filas · 2036/2036 tokens |
| Costo IA síncrona | US$0.0000 | US$0.0007 |
| Costo total IA | US$0.0000 | US$0.0007 |
| Requests con cuota | 0 | 1 |
| Costo registrado | US$0.0000 | US$0.0007 |

El costo registrado en `ai_usage_daily` es **idéntico** al costo síncrono. Si la
dimensión `subject_athlete_id` de `029` estuviera sumando también en la fila
subject, se vería US$0.0014 y cuota 2.

### Orden del gate, verificado de paso

El rechazo por entitlement de la acción de chat dejó los contadores intactos
(requests 1, cuota 1, costo US$0.0007): **una cuenta rechazada por entitlement
no consumió cuota ni llegó al proveedor**, que es el orden no negociable
`auth → kill switch → entitlement → spend cap → cuota → proveedor`.

### Evidencia adicional fuera del guion

1. **El arranque con rol `unknown` no aborta.** La sesión completó
   frontera → rol → memberships → backfill → scope → sync y el dashboard
   renderizó completo. Es la corrección de `sessionBootstrap.ts`.
2. **`POST /rest/v1/athletes?on_conflict=id` → 200.** Es el upsert self de
   `ensureRemoteAthlete` corriendo contra el trigger `BEFORE INSERT` de `030`
   con una membresía `self` presente. Cierra la ambigüedad que había dejado la
   verificación manual de idempotencia («Success, no rows returned»): acá el
   upsert se ejecutó sobre una fila real y el trigger no lo bloqueó.
3. **Lectura coach-scoped del gestionado.** Planificación mostró la semana de
   «Juan perez» con sus propias sesiones, **sin** filas del self y **sin**
   cambiar el scope activo (el indicador siguió en «Tú»). No apareció la copia
   `coach-access`: la membresía autorizó.
4. **Sin sangrado legacy.** Ninguna fila legacy/unscoped del self apareció bajo
   el atleta gestionado.
5. **Competition Plan** renderiza en modo solo lectura con el plan real íntegro.

### Consultas SQL ejecutadas (2026-09-05)

| Consulta | Propósito | Resultado |
|---|---|---|
| S1 | Fila global vs subject | Una sola fila: `chat / GLOBAL / 1 / 0.000688` |
| S2a | Forzar `45001` rama account | `ERROR 45001, DETAIL: account` |
| S2b | Forzar `45001` rama subject | `ERROR 45001, DETAIL: subject` |

S2a y S2b corrieron dentro de `begin … rollback`, así que no consumieron cuota
real ni dejaron filas.

Resultado: **APROBADO PARCIAL.** Siete checks verdes, dos verdes a medias y
declarados como tales, dos no ejercitables con una cuenta `free`. Ninguna
regresión observada. Esto no habilita `031`: la equivalencia por
`(tabla, comando)` sigue pendiente y es independiente del tráfico.

## Paso 4 — lectura de rol y decisión sombra

Usar exclusivamente una cuenta de prueba:

- Coach Free + `coach_assistant_message`: visible 403 legacy y registro
  `wouldGrant`.
- Athlete Advanced + `coach_assistant_message`: visible 200 legacy y registro
  `wouldDeny`.
- Lectura de rol ilegible: 503 antes del proveedor y sin consumo de cuota.
- Target sin membership o discordante: sombra denegada.

No modificar el rol de la cuenta híbrida del owner.

Resultado: pendiente.

## Paso 5 — backfill y equivalencia

Ejecutar, en este orden:

1. `supabase/queries/2026-09-02-membership-backfill.sql`
2. `supabase/queries/2026-09-02-membership-equivalence.sql`

El segundo archivo es un diagnóstico inicial. Antes de aprobar 1b se completa
contra el dump real con un par por cada `(tabla, comando)` y por cada
`qual`/`with_check`. Los bloques agrupados no sustituyen esa evidencia;
`sessions UPDATE/DELETE` debe modelar además `authored_by_role`.

Completar todas las secciones del documento de evidencia. Las filas sin
`athlete_id` y las diferencias no enumeradas bloquean 1b. Para WHOOP se debe
confirmar la policy membership agregada por 030 y registrar su equivalencia
SELECT bidireccional antes de retirar la legacy.

Resultado: pendiente.

## Paso 6 — ventana de auditoría

Abierta el 2026-09-05 con `netlify login` + `netlify link` al sitio
`entrenadoralph`. Env de Production confirmadas por CLI:
`COACH_AUTHZ_MODE=audit`, `ENTITLEMENTS_ENABLED=true`,
`AI_USAGE_LIMITS_ENABLED=true`, `AI_KILL_SWITCH_ENABLED=false`.

**Cómo se lee el silencio.** `reconcileDecision` (`coachAuthzMode.ts:87`) sólo
emite `[coach-authz]` cuando legacy y sombra **difieren** en `allowed` o en la
forma de cuota. No es un log por request: es un log de divergencia. Por eso la
ausencia de líneas es evidencia positiva —`enforce` no habría cambiado nada—
siempre que se acredite que hubo requests que sí pasaron por ese punto.

- Inicio/fin: 2026-09-05 (primera lectura sobre las 24 h previas).
- Requests acreditadas en el punto de decisión: **2**, ambas `outcome: ok` en
  `netlify logs --source functions --function coach`:
  `chat_general` 14:52 UTC (cuenta en `free`) y `chat_action` 15:37 UTC
  (cuenta en `advanced`).
- `wouldDeny`: 0. `wouldGrant`: 0. `quotaDivergence`: 0.
- Fallos de lectura/membership (`shadowUnavailable`): 0 — tampoco se emitió
  esa rama, que es la que registraría `entitlement_unreadable` o
  `membership_unreadable`.
- Cobertura suficiente: **no**.

**Límite honesto de esta ventana.** Dos requests de una sola cuenta, con
`account_role = athlete`, cero membresías y cero atletas reclamados. En esa
configuración la decisión sombra recibe casi las mismas entradas que la legacy,
así que el cero acredita **que la sombra no diverge de forma espuria**, no que
discrimine correctamente. Producción no tiene ninguna cuenta coach, de modo que
la rama que 1b va a hacer efectiva sigue sin ejercitarse con tráfico real.

No habilitar `enforce`. El plan de 1b se escribe con esta evidencia completa.

## Paso 7 — Plan Builder con `advanced`: **FALLA REPRODUCIBLE**

Ejecutado el 2026-09-05 con autorización explícita del owner para gastar API.
El gasto real fue **US$0**: nunca se llegó al proveedor.

`/plans/builder` abrió el wizard (preflight `advanced` correcto) y `CREAR PLAN`
falló dos veces seguidas con **HTTP 500** sobre
`POST /.netlify/functions/enqueue-plan-generation`, mostrando
«No pudimos preparar tu plan ahora».

```
17:42:46Z ERROR [enqueue-plan] error planId=dfe73b77-…-c44a04b99377: [object Object]
17:43:54Z ERROR [enqueue-plan] error planId=dfe73b77-…-c44a04b99377: [object Object]
```

### Defecto 1 — el log destruye el diagnóstico (corregido)

`postgrest-js` sólo construye un `PostgrestError` (que extiende `Error`) cuando
se pidió `throwOnError`. En el camino que usa el proyecto devuelve el cuerpo de
PostgREST **parseado como objeto plano**, así que los cuatro
`if (error) throw error` de `planGenerationShared.ts` propagan algo que no es
`Error`, y el `catch` del enqueue lo formatea con
`error instanceof Error ? error.message : String(error)` → `[object Object]`.

Corregido con `_shared/supabaseError.ts` (`supabaseOperationError`), cableado en
los cuatro puntos (`checkCancelled`, `getPlan`, `putPlan`, `putWeek`). Conserva
`code`/`details`/`hint`, nombra la operación y nunca puede degradar a
`[object Object]`. Cinco tests escritos en RED antes de la implementación.
**Afecta también al worker de fondo**, que comparte el mismo writer.

### Defecto 2 — la causa raíz sigue abierta

Acotado por eliminación, sin poder nombrarlo todavía:

- Falla **antes de cualquier escritura durable**: no hay log
  `[enqueue-plan] enqueued`, `durableWrite` sigue en `null` (por eso la
  respuesta es 500 y no 502) y **no existe fila** para ese `planId` en
  `training_plans` tras los dos intentos.
- Por tanto está en `writer.getPlan` o en `writer.putPlan`. Auth pasó
  (un fallo ahí daría 401 con mensaje legible) y el gate de cuota/entitlement
  también (sus errores son `Error` con `statusCode`, y darían 403/503).
- **La base de datos queda excluida.** Reproducidas a mano bajo RLS con
  `set local role authenticated` y las claims del owner, dentro de
  transacciones revertidas: el `select` sobre `training_plans` devuelve 0 filas
  sin error, y tanto el `insert` en `training_plans` como el de
  `training_plan_weeks` se aceptan. Schema verificado columna por columna
  contra `planRows.ts`: ninguna falta y ninguna obligatoria queda sin escribir.
  Triggers y constraints de ambas tablas revisados
  (`reject_athlete_reparent`, `enforce_plan_week_athlete`,
  `preserve_active_plan_cancel_requested`): ninguno aplica a este insert.
- El writer **sí** manda el token del usuario
  (`global.headers.Authorization`), así que tampoco es una degradación a anon.

**Siguiente paso, barato:** desplegar el arreglo de logging y repetir. La
próxima línea trae mensaje, `code` y operación exacta.

**Consecuencia de rollout:** el check 3 queda **FALLIDO**, no pendiente.
`enqueue-plan-generation` y `generate-plan-background` son las dos únicas
funciones del gate que esta ronda no pudo ejercitar, y hoy Plan Builder está
caído en producción para una cuenta `advanced`.

## Pendientes que 1a no cierra

1. Membership sigue siendo decorativa mientras las policies legacy existan.
2. La cuota sigue contando intentos del proveedor.
3. `GLOBAL_DAILY_SPEND_CAP_USD` sigue sin dimensionarse para una cartera coach.
4. No existe consentimiento in-app del atleta para otorgar acceso.
5. Rutas, cuenta coach y transferencia de roster pertenecen a Entrega 2.
6. La invariante “sólo coach posee managed” queda para 1b/Entrega 2.
7. La frontera de bootstrap sólo se serializa dentro de una pestaña.

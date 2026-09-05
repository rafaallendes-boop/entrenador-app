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

- [ ] Chat general responde.
- [ ] Una acción de chat se aplica.
- [ ] Plan Builder puede encolar y el preflight no produce rechazo espurio.
- [ ] El costo se suma sólo en la fila global (`subject_athlete_id = ''`).
- [ ] Las filas subject mantienen costo cero.
- [ ] `/ops` no duplica requests ni costo.
- [ ] `/ops` conserva `coach.safetyBlocked`.
- [ ] WHOOP workouts y readiness siguen visibles para self y vínculos válidos.
- [ ] Un SQLSTATE desconocido sigue exponiéndose como 503.
- [ ] Los rechazos `45001/account` y `45001/subject` se exponen como 429.

Resultado: pendiente.

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

- Inicio/fin:
- Duración mínima acordada:
- Volumen por capability:
- `wouldDeny` por capability:
- `wouldGrant` por capability:
- Fallos de lectura/membership:
- Cobertura suficiente: pendiente.

No habilitar `enforce`. El plan de 1b se escribe con esta evidencia completa.

## Pendientes que 1a no cierra

1. Membership sigue siendo decorativa mientras las policies legacy existan.
2. La cuota sigue contando intentos del proveedor.
3. `GLOBAL_DAILY_SPEND_CAP_USD` sigue sin dimensionarse para una cartera coach.
4. No existe consentimiento in-app del atleta para otorgar acceso.
5. Rutas, cuenta coach y transferencia de roster pertenecen a Entrega 2.
6. La invariante “sólo coach posee managed” queda para 1b/Entrega 2.
7. La frontera de bootstrap sólo se serializa dentro de una pestaña.

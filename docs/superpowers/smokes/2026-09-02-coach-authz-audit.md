# Evidencia de autorización Coach — Entrega 1a

Estado: **pendiente de ejecución en producción**.

Este documento recibe evidencia, no estimaciones. No habilita `031` mientras
alguna sección siga pendiente o contenga diferencias sin explicar.

## 1. Precondición 013b (`pg_policies`)

- Fecha/hora:
- Ejecutado por:
- Proyecto/entorno:
- Resultado del `LEFT JOIN` de policies esperadas:
- Policies faltantes o con predicado legacy (`FALTA`/`FALTA_V2`):

## 2. Inventario completo de policies

Pegar la salida de la sección 0 de
`supabase/queries/2026-09-02-membership-equivalence.sql`.

Para cada policy legacy observada, registrar su pareja de consultas de
equivalencia por `(tabla, comando)`:

| Tabla | Comando | Policy legacy | Policy membership/RPC | Evidencia completa |
|---|---|---|---|---|
| Pendiente | Pendiente | Pendiente | Pendiente | No |

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

- Filas insertadas:
- Verificación A, roles que no coinciden con 013b:
- Verificación B, pares legacy sin membership:
- Verificación C, linked reclamado sin rol `self`:
- Resultado: pendiente.

## 4. Filas sin `athlete_id`

| Tabla | Conteo |
|---|---:|
| sessions | Pendiente |
| day_logs | Pendiente |
| week_summaries | Pendiente |
| chat_messages | Pendiente |
| coach_proposals | Pendiente |
| athlete_profiles | Pendiente |
| training_plans | Pendiente |
| training_plan_weeks | Pendiente |
| whoop_workouts | Pendiente |

Criterio para 031: todos los conteos deben ser cero. Si se necesita una
migración, se ejecuta y esta tabla se vuelve a medir antes del corte; una
migración sólo aprobada no sustituye evidencia.

## 5. Cobertura Whoop

`readiness_daily` tiene equivalencia `SELECT` propia en la consulta. Para
`whoop_workouts`, `030` agrega `whoop_workouts_select_membership` sin retirar
la policy legacy por owner/linked de `012`.

- Estado de `whoop_workouts/select/membership_policy`:
- Migración de Etapa A: `030_athlete_role_invariants.sql`.
- Equivalencia bidireccional posterior:

Mientras esta sección no sea verde, **1b queda bloqueada**: hay que confirmar
la policy efectiva y documentar equivalencia antes de retirar la legacy.

## 6. Equivalencia por `(tabla, comando)`

| Tabla | Comando | Dirección | Filas | Explicación/caso firmado |
|---|---|---|---:|---|
| Pendiente | Pendiente | legacy_only | Pendiente | Pendiente |
| Pendiente | Pendiente | membership_only | Pendiente | Pendiente |

## 7. Restricciones intencionales de INSERT/DELETE

| ID | Restricción | Evidencia observada | Aprobación |
|---|---|---|---|
| R1 | Una cuenta coach no puede crear un atleta self | Pendiente | Pendiente |
| R2 | Una cuenta no puede crear un segundo atleta self | Pendiente | Pendiente |
| R3 | El borrado de roster rechaza atletas con membership self | Pendiente | Pendiente |
| R4 | Managed bajo cuenta athlete sigue permitido en 1a | Pendiente | Pendiente |

## 8. Auditoría de decisiones del servidor

- Inicio de ventana:
- Fin de ventana:
- Versión desplegada:
- Muestra `wouldDeny`:
- Muestra `wouldGrant`:
- Clases y superficies cubiertas:
- Errores `unreadable`/503 observados:

Los registros pegados aquí no deben contener identificadores de cuenta o
atleta.

## 9. Decisión de salida

- [ ] Las 25 policies de 013b esperadas están instaladas y `readiness_daily_select` tiene el predicado v2.
- [ ] `whoop_workouts_select_membership` de 030 está instalada sin retirar la legacy.
- [ ] Se inventariaron todas las policies efectivas de producción.
- [ ] El backfill dejó cero pares legacy sin membership.
- [ ] No quedan filas sin `athlete_id` en las nueve tablas medidas.
- [ ] `whoop_workouts` tiene policy membership y equivalencia SELECT documentada.
- [ ] Cada tabla/comando tiene ambas direcciones comparadas.
- [ ] Toda diferencia observada coincide con un caso enumerado y firmado.
- [ ] Todo caso enumerado aparece en la evidencia o se justificó como no aplicable.
- [ ] La ventana audit cubrió las capacidades objetivo.
- [ ] No se habilitó `COACH_AUTHZ_MODE=enforce`.

Conclusión: **NO APROBADO todavía para 031**.

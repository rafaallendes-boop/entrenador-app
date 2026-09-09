# Evidencia — `035` y `036` aplicadas en producción

Fecha: 2026-09-08
Proyecto: `entrenador-app` / `main` (PRODUCTION)
Query: [`2026-09-08-035-036-applied-checks.sql`](../../../supabase/queries/2026-09-08-035-036-applied-checks.sql)
Ejecutado en el SQL editor del dashboard, sólo lectura.

**Motivo.** `PROJECT_REVIEW_AND_ROADMAP.md` §17 y el runbook B2 daban `035` como
«escrita, no ejecutada», y `036` no tenía ninguna verificación escrita. El owner
no recordaba si las había aplicado. Se midió en vez de asumir.

**Resultado: ambas aplicadas y completas.**

## 1. Presencia

| Chequeo | Esperado | Medido |
|---|---|---|
| `t035_tabla` | true | **true** |
| `p035_policies` | 1 | **1** |
| `i035_indices` | 4 (PK + los 3 de `035`) | **4** |
| `f035_insert` | 1 | **1** |
| `f036_metrics` | 1 | **1** |
| `f036_retention` | 1 | **1** |

## 2. RLS, policy y EXECUTE

| Clave | Medido |
|---|---|
| `rls_activa` | **true** |
| `policy` | **`client_error_events_select_own / SELECT`** (única) |
| `exec_insert_client_error_event` | anon:false, authenticated:false, **service_role:true** |
| `exec_read_client_error_metrics` | anon:false, authenticated:false, **service_role:true** |
| `exec_read_client_error_retention_health` | anon:false, authenticated:false, **service_role:true** |
| `security_definer` | las tres en **true** |
| `filas_total` | **0** |

`filas_total = 0` es coherente con la ingesta apagada: `CLIENT_ERROR_INGESTION_ENABLED`
sigue sin definir o en `false`. La tabla existe y está vacía, que es exactamente
el estado que el rollout previsto describe antes del paso 4 del runbook B2.

## 3 y 4. Grants

| Rol | Grants de tabla | `has_table_privilege(select)` | Columnas con SELECT |
|---|---|---:|---:|
| `anon` | SIN GRANTS | false | **0** (ausente) |
| `authenticated` | SIN GRANTS | false | **14** |
| `service_role` | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | true | — |

**Trampa registrada.** Que `authenticated` dé `SIN GRANTS` y
`has_table_privilege(...) = false` **no es un hallazgo**: `035` otorga SELECT
**por columna**, y ni `information_schema.role_table_grants` ni
`has_table_privilege` ven grants de columna. La verificación válida es
`role_column_grants`, que devuelve las **14 columnas** que `035` enumera —
ni una más. Durante esta medición se llegó a formular el falso positivo antes
de mirar el `.sql`; queda anotado para que no se repita.

## Lo que esto **no** acredita

- La RLS efectiva con dos cuentas reales (caso A ve lo suyo, B no lo ajeno):
  eso es [`2026-09-06-035-rls-checks.sql`](../../../supabase/queries/2026-09-06-035-rls-checks.sql)
  y sigue **sin ejecutar**, porque necesita dos UUID de cuentas reales.
- La ausencia de carrera en el techo de frecuencia (runner de concurrencia del
  runbook B2, paso 2).
- La atribución de identidad sobre una request HTTP real (paso 3).
- El comportamiento de `/ops` contra `read_client_error_metrics`, que hoy no
  tiene filas que agregar.

## Consecuencia documental

`PROJECT_REVIEW_AND_ROADMAP.md` §17 dice «Implementación pendiente» y el
runbook B2 dice «escrito, no ejecutado» en sus precondiciones. Ambas frases
quedan desactualizadas respecto del esquema: lo aplicado es el esquema, no la
activación. Lo que sigue pendiente es la ingesta encendida y la revisión
jurídica, no la migración.

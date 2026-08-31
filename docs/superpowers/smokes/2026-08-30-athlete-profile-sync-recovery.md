# Smoke de recuperación — `athlete_profiles` 409

Fecha: 2026-08-30  
Migración: `supabase/026_fix_athlete_profiles_sync_contract.sql`  
Objetivo: cerrar el 409 de `on_conflict=athlete_id` y recuperar perfiles locales
sin borrar IndexedDB.

## Regla de seguridad

No borrar datos del navegador, no limpiar IndexedDB y no eliminar perfiles o
atletas antes de verificar que las filas locales llegaron a Supabase. Si `026`
aborta, conservar el mensaje y revisar las filas ambiguas; no borrar duplicados
a ciegas.

## 1. Captura previa de sólo lectura

```sql
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'athlete_profiles'
order by indexname;

select
  count(*) filter (where athlete_id is null) as null_profiles,
  count(*) as total_profiles,
  count(distinct athlete_id) as distinct_athletes
from public.athlete_profiles;

select athlete_id, count(*)
from public.athlete_profiles
group by athlete_id
having athlete_id is null or count(*) > 1;
```

Guardar la salida. La evidencia esperada del incidente es la presencia de un
unique monocolumna sobre `user_id`.

## 2. Aplicación

Ejecutar completo `supabase/026_fix_athlete_profiles_sync_contract.sql` en SQL
Editor, en una ventana de bajo tráfico. Debe terminar sin excepción. El script es
transaccional: un guard fallido revierte todos sus cambios.

## 3. Contrato remoto posterior

```sql
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'athlete_profiles'
order by indexname;

select
  count(*) filter (where athlete_id is null) as null_profiles,
  count(*) as total_profiles,
  count(distinct athlete_id) as distinct_athletes
from public.athlete_profiles;
```

Done SQL:

- existe un unique cuyo target exacto es `(athlete_id)`;
- no existe un unique cuyo target único sea `(user_id)`;
- `null_profiles = 0`;
- `total_profiles = distinct_athletes`.

## 4. Recuperación desde el cliente

1. Recargar completamente `app.rallyiq.cl` sin limpiar almacenamiento.
2. Abrir Ajustes → diagnóstico de sincronización.
3. Pulsar `Sincronizar ahora` y esperar a que termine.
4. Confirmar cola pendiente `0`, sin `queue:op_failed` ni
   `queue:op_expired` nuevos.
5. En Network, confirmar que no vuelve a aparecer un 409 para
   `athlete_profiles?on_conflict=athlete_id`.
6. Abrir el perfil self y el perfil gestionado, guardar un cambio inocuo en cada
   uno y volver a sincronizar.
7. Recargar la aplicación y confirmar que ambos cambios sobreviven.

## 5. Verificación remota final

```sql
select id, user_id, athlete_id, updated_at
from public.athlete_profiles
order by user_id, athlete_id;
```

Debe existir una fila diferente por cada atleta guardado. Una cuenta puede
aparecer en varias filas mediante `user_id`; lo que no puede repetirse es
`athlete_id`.

## Resultado

- Estado: **PENDIENTE DE EJECUCIÓN**.
- Cerrar sólo con captura previa/posterior, cola cero y persistencia self +
  gestionado confirmada tras recarga.

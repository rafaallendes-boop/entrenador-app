-- 036_client_error_metrics.sql
-- Agregados de `client_error_events` para `/ops` (Entrega B, bloque B4).
-- Ver docs/superpowers/specs/2026-09-06-client-error-reporting-design.md §8 y §9.2.
-- Aplicación manual, como todas las anteriores. Requiere `035` aplicada.
--
-- Van en una RPC **separada** de `read_operations_metrics` a propósito: si esta
-- tabla o esta función no existieran, `/ops` debe mostrar esa tarjeta como
-- ausente sin romper el resto del panel.
--
-- Ninguna consulta de acá devuelve `user_id`, email ni filas individuales.
-- «Cuentas afectadas» es un `count(distinct)`, no una lista.
--
-- La severidad NO se calcula acá: se deriva en TypeScript con `deriveSeverity`,
-- para que recalibrar el criterio no exija migración ni reescriba historia.

-- ─────────────────────────────────────────────────────────────────────────────
-- Agregados de una ventana.
create or replace function public.read_client_error_metrics(p_since timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_unknown_total integer;
  v_groups jsonb;
  v_breakdown jsonb;
begin
  select count(*) into v_total
    from public.client_error_events
   where created_at >= p_since;

  select count(*) into v_unknown_total
    from public.client_error_events
   where created_at >= p_since and diagnostic_code = 'unknown';

  -- El `limit` es un tope de payload, no el top-N del panel: el top-N se
  -- resuelve en TypeScript **después** de ordenar por severidad, para no
  -- excluir un error grave de poco volumen. Con el techo de 30 eventos/hora
  -- por cuenta, llegar a 500 firmas distintas en una semana sería en sí mismo
  -- la señal de que algo anda mal.
  select coalesce(jsonb_agg(g order by g.count desc), '[]'::jsonb) into v_groups
    from (
      select
        fingerprint,
        release,
        source,
        diagnostic_code,
        error_name,
        component,
        route,
        count(*)::integer as count,
        count(distinct user_id)::integer as accounts,
        min(created_at) as first_seen,
        max(created_at) as last_seen
      from public.client_error_events
      where created_at >= p_since
      group by fingerprint, release, source, diagnostic_code, error_name, component, route
      order by count(*) desc
      limit 500
    ) g;

  -- Triage de `unknown`: agregado por source/error_name/ruta/release, nunca
  -- caso por caso. Es el instrumento de la gobernanza de la taxonomía.
  select coalesce(jsonb_agg(b order by b.count desc), '[]'::jsonb) into v_breakdown
    from (
      select
        source,
        error_name,
        route,
        release,
        count(*)::integer as count
      from public.client_error_events
      where created_at >= p_since and diagnostic_code = 'unknown'
      group by source, error_name, route, release
      order by count(*) desc
      limit 100
    ) b;

  return jsonb_build_object(
    'total', v_total,
    'groups', v_groups,
    'unknown', jsonb_build_object(
      'total', v_unknown_total,
      'share', case when v_total = 0 then 0 else round(v_unknown_total::numeric / v_total, 4) end,
      'breakdown', v_breakdown
    )
  );
end;
$$;

revoke all on function public.read_client_error_metrics(timestamptz)
  from public, anon, authenticated;
grant execute on function public.read_client_error_metrics(timestamptz) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Salud de la retención.
--
-- Consulta **sin** el filtro de edad que aplican la policy de RLS y los
-- agregados. Ese filtro sostiene la promesa de 30 días aunque el cron muera,
-- pero por eso mismo **esconde** que murió: esta función es la que lo ve.
--
-- Límites declarados: detecta acumulación, pero no demuestra que el cron esté
-- vivo cuando no hay filas que borrar. No es un heartbeat, y no certifica el
-- borrado en backups.
create or replace function public.read_client_error_retention_health(p_cutoff_days integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz;
  v_remaining integer;
  v_oldest timestamptz;
begin
  if p_cutoff_days is null or p_cutoff_days < 1 then
    raise exception 'p_cutoff_days inválido';
  end if;

  v_cutoff := now() - make_interval(days => p_cutoff_days);

  select count(*)::integer, min(created_at)
    into v_remaining, v_oldest
    from public.client_error_events
   where created_at < v_cutoff;

  return jsonb_build_object(
    'expiredRemaining', v_remaining,
    'oldestExpiredAt', v_oldest,
    'checkedAt', now()
  );
end;
$$;

revoke all on function public.read_client_error_retention_health(integer)
  from public, anon, authenticated;
grant execute on function public.read_client_error_retention_health(integer) to service_role;

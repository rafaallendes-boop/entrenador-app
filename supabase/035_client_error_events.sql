-- 035_client_error_events.sql
-- Reporter de errores de cliente — Entrega B, bloque B2 (roadmap §17).
-- Ver docs/superpowers/specs/2026-09-06-client-error-reporting-design.md
-- Aplicación manual, como todas las anteriores.
--
-- Qué contiene esta tabla y qué no:
--   * SÍ: identidad de cuenta, contexto self/managed, categorías cerradas, ruta
--     normalizada, release, plataforma y ubicaciones de código ya validadas
--     contra el manifiesto del build.
--   * NO: mensajes, `cause`, componentStack crudo, URLs completas, query,
--     identificadores de atleta, ni contenido deportivo o biométrico.
--
-- La fila **está asociada a una cuenta**: no se describe como anónima. La
-- consulta jurídica correspondiente (§10 del spec) es requisito para activar la
-- captura, no para aplicar esta migración.
--
-- Escritura: sólo `service_role`, y sólo a través de la RPC de abajo, que aplica
-- el techo de frecuencia en la misma transacción. Lectura: la cuenta ve lo suyo.

create table public.client_error_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  scope_kind text not null check (scope_kind in ('self', 'managed')),
  source text not null check (source in (
    'window_error', 'unhandled_rejection', 'react_boundary', 'sync_failure'
  )),
  -- Append-only. Ampliar esta lista es una migración nueva; quitar un valor
  -- rompería la validación de las filas ya persistidas con él.
  diagnostic_code text not null check (diagnostic_code in (
    'chunk_load', 'network_failure', 'timeout', 'render_failure',
    'storage_failure', 'data_parse_failure', 'third_party_failure',
    'unknown', 'sync_contract_failure'
  )),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{16}$'),
  error_name text not null check (error_name ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'),
  -- Líneas canónicas `asset.js:línea:columna`, una por renglón, ya revalidadas
  -- contra el manifiesto del release. El CHECK es la tercera barrera.
  stack_frames text null check (
    stack_frames is null
    or (
      length(stack_frames) <= 2000
      and stack_frames ~ '^[A-Za-z0-9][A-Za-z0-9._-]*\.js:[1-9][0-9]*:[1-9][0-9]*(\n[A-Za-z0-9][A-Za-z0-9._-]*\.js:[1-9][0-9]*:[1-9][0-9]*){0,9}$'
    )
  ),
  component text null check (component is null or component ~ '^[A-Za-z][A-Za-z0-9]{0,63}$'),
  route text not null check (length(route) <= 120),
  request_class text null check (request_class is null or request_class in (
    'chat_general', 'chat_action', 'weekly_summary', 'week_creator',
    'plan_builder_week', 'plan_builder_pair', 'import_extract',
    'coach_assistant_message'
  )),
  release text not null check (release ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  platform text not null check (platform in ('web', 'ios')),
  created_at timestamptz not null default now()
);

comment on table public.client_error_events is
  'Errores de cliente categorizados. Sin mensajes ni stacks crudos: sólo ubicaciones validadas contra el manifiesto del release.';
comment on column public.client_error_events.scope_kind is
  'Contexto del evento (self/managed). No concede permisos ni participa de RLS.';
comment on column public.client_error_events.stack_frames is
  'Líneas canónicas asset:línea:columna. Nunca contiene la línea de mensaje del error.';
comment on column public.client_error_events.fingerprint is
  'sha256 truncado de (error_name, diagnostic_code, component, route, primer frame). No agrupa entre releases: mostrar siempre release al leer.';

create index client_error_events_user_created_idx
  on public.client_error_events (user_id, created_at desc);
create index client_error_events_fingerprint_created_idx
  on public.client_error_events (fingerprint, created_at desc);
create index client_error_events_created_idx
  on public.client_error_events (created_at desc);

alter table public.client_error_events enable row level security;

-- El cliente no escribe nunca: ni INSERT, ni UPDATE, ni DELETE. Si pudiera
-- insertar directo, los CHECK protegerían la forma pero no la veracidad — podría
-- forjar fingerprints o inundar la tabla con su propio user_id y anular el techo.
revoke all on public.client_error_events from anon, authenticated;
grant select (
  id, user_id, scope_kind, source, diagnostic_code, fingerprint, error_name,
  stack_frames, component, route, request_class, release, platform, created_at
) on public.client_error_events to authenticated;

-- Lectura propia, acotada a la misma ventana que promete la retención. El filtro
-- de edad sostiene la promesa aunque el cron falle; la salud de la retención se
-- observa aparte, con service_role y sin este filtro (§9.2 del spec).
create policy client_error_events_select_own
  on public.client_error_events
  for select
  using (auth.uid() = user_id and created_at > now() - interval '30 days');

-- ─────────────────────────────────────────────────────────────────────────────
-- Ingesta con techo de frecuencia atómico.
--
-- Cuenta e inserta **en la misma transacción**, serializando por cuenta con un
-- lock de transacción. Un `count` desde Netlify seguido de un INSERT tiene
-- carrera: N requests concurrentes leerían todas un valor bajo el techo y
-- después insertarían las N. El lock es por `user_id`, así que dos cuentas
-- distintas no se bloquean entre sí.
--
-- Devuelve `inserted = false` cuando el techo está alcanzado. El endpoint
-- traduce ese caso a 204: el cliente no debe reaccionar a su propio cupo.
create or replace function public.insert_client_error_event(
  p_user_id uuid,
  p_scope_kind text,
  p_source text,
  p_diagnostic_code text,
  p_fingerprint text,
  p_error_name text,
  p_stack_frames text,
  p_component text,
  p_route text,
  p_request_class text,
  p_release text,
  p_platform text,
  p_limit integer,
  p_window_seconds integer
)
returns table (inserted boolean, used integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
  v_window interval;
begin
  if p_user_id is null or p_limit < 1 or p_window_seconds < 1 then
    return query select false, 0;
    return;
  end if;

  v_window := make_interval(secs => p_window_seconds);

  -- Serialización por cuenta. `pg_advisory_xact_lock` se libera solo al terminar
  -- la transacción, así que no hay camino en que quede tomado.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select count(*) into v_used
    from public.client_error_events
   where user_id = p_user_id
     and created_at > now() - v_window;

  if v_used >= p_limit then
    return query select false, v_used;
    return;
  end if;

  insert into public.client_error_events (
    user_id, scope_kind, source, diagnostic_code, fingerprint, error_name,
    stack_frames, component, route, request_class, release, platform
  ) values (
    p_user_id, p_scope_kind, p_source, p_diagnostic_code, p_fingerprint,
    p_error_name, p_stack_frames, p_component, p_route, p_request_class,
    p_release, p_platform
  );

  return query select true, v_used + 1;
end;
$$;

revoke all on function public.insert_client_error_event(
  uuid, text, text, text, text, text, text, text, text, text, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.insert_client_error_event(
  uuid, text, text, text, text, text, text, text, text, text, text, text, integer, integer
) to service_role;

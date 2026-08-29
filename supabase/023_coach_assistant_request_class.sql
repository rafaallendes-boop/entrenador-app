-- Amplía el CHECK de coach_requests.request_class para admitir la clase del
-- Asistente IA del Coach. Sin esto el insert de telemetría viola el constraint
-- y, como la escritura es best-effort sin await, la request pierde su registro
-- en silencio.
-- APLICACIÓN MANUAL, antes del primer deploy que emita la clase nueva.

do $$
declare
  constraint_row record;
  matching_count integer := 0;
begin
  if to_regclass('public.coach_requests') is null then
    raise exception '023 aborted: public.coach_requests does not exist. Apply 018 first.';
  end if;

  -- No depende del nombre autogenerado: identifica cualquier CHECK que incluya
  -- la columna request_class. Si una aplicación anterior dejó dos constraints,
  -- los elimina ambos antes de crear la autoridad única y nombrada.
  for constraint_row in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.coach_requests'::regclass
      and c.contype = 'c'
      and exists (
        select 1
        from unnest(c.conkey) as key_column(attnum)
        join pg_attribute a
          on a.attrelid = c.conrelid
         and a.attnum = key_column.attnum
        where a.attname = 'request_class'
      )
  loop
    matching_count := matching_count + 1;
    execute format(
      'alter table public.coach_requests drop constraint %I',
      constraint_row.conname
    );
  end loop;

  if matching_count = 0 then
    raise exception '023 aborted: no CHECK constraint for coach_requests.request_class was found.';
  end if;
end $$;

alter table public.coach_requests
  add constraint coach_requests_request_class_check
  check (request_class in (
    'chat_general', 'chat_action', 'weekly_summary', 'week_creator',
    'plan_builder_week', 'plan_builder_pair', 'import_extract',
    'coach_assistant_message'
  ));

do $$
declare
  matching_count integer;
  includes_assistant boolean;
begin
  select
    count(*),
    bool_and(pg_get_constraintdef(c.oid) like '%coach_assistant_message%')
  into matching_count, includes_assistant
  from pg_constraint c
  where c.conrelid = 'public.coach_requests'::regclass
    and c.contype = 'c'
    and exists (
      select 1
      from unnest(c.conkey) as key_column(attnum)
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = key_column.attnum
      where a.attname = 'request_class'
    );

  if matching_count <> 1 or includes_assistant is not true then
    raise exception '023 verification failed: expected one request_class CHECK containing coach_assistant_message, found %.', matching_count;
  end if;
end $$;

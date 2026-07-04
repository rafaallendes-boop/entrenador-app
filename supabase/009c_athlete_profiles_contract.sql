-- Coach F2 Parte 2a — CONTRACT: athlete_id not null + drop del unique legacy por user_id.
-- PRERREQUISITOS (en orden): 009b aplicada; cliente nuevo (onConflict
-- 'user_id,athlete_id') desplegado y bundle confirmado (PWA stale = clientes
-- viejos con onConflict 'user_id' romperían tras este drop).
-- Después de esto ya se puede crear el segundo perfil (primer gestionado);
-- ninguna fila nueva puede volver a entrar con athlete_id null.
do $$
declare
  null_debt int;
begin
  if not exists (
    select 1 from pg_indexes
    where tablename = 'athlete_profiles' and indexname = 'athlete_profiles_user_athlete_unique'
  ) then
    raise exception 'athlete_profiles 009c aborted: composite unique missing. Apply 009b first.';
  end if;
  select count(*) into null_debt from public.athlete_profiles where athlete_id is null;
  if null_debt > 0 then
    raise exception 'athlete_profiles 009c aborted: % rows with null athlete_id.', null_debt;
  end if;
end $$;

alter table public.athlete_profiles
  alter column athlete_id set not null;

drop index if exists public.athlete_profiles_user_id_unique;

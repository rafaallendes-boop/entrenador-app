-- SP1a two-sided -- CONTRACT (diferido; aplicar SOLO tras deploy del bundle SP1a).
-- Los bundles pre-SP1a no envían authored_by_role: endurecer antes rompería sus upserts.

-- Guard: no debe quedar deuda (el bundle nuevo estampa siempre).
do $$
declare pending int;
begin
  select count(*) into pending from public.sessions where authored_by_role is null;
  if pending > 0 then
    raise exception '013c aborted: % sessions sin authored_by_role. Backfill de seguridad primero.', pending;
  end if;
end $$;

alter table public.sessions alter column authored_by_role set not null;

-- Reconciliar por LWW cualquier escritura de un bundle viejo ocurrida en la
-- ventana 013b -> deploy. Nunca borrar una versión más nueva sin migrarla.
insert into public.athlete_coach_notes
  (athlete_id, coach_memory, updated_by_account_id, updated_at)
select p.athlete_id, p.coach_memory, p.updated_by_account_id, p.updated_at
from public.athlete_profiles p
where p.coach_memory is not null and p.athlete_id is not null
on conflict (athlete_id) do update
set coach_memory = excluded.coach_memory,
    updated_by_account_id = excluded.updated_by_account_id,
    updated_at = excluded.updated_at
where excluded.updated_at >= public.athlete_coach_notes.updated_at;

update public.athlete_profiles set coach_memory = null where coach_memory is not null;

-- NOTA: el contract de owner_account_id/linked_account_id en athletes queda
-- diferido más allá de SP1 (el código aún las lee; spec §3.5).

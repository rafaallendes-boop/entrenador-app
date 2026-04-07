-- Sync hardening for athlete_profiles singleton-per-user model.
-- Apply in Supabase SQL editor or migration pipeline before relying on
-- onConflict: 'user_id' from the client.

alter table athlete_profiles
  add column if not exists data jsonb;

create unique index if not exists athlete_profiles_user_id_unique
  on athlete_profiles (user_id);

-- Optional cleanup for legacy duplicates before enabling the client repair flow.
-- Keeps the newest / most recently updated row per user.
with ranked as (
  select
    ctid,
    row_number() over (
      partition by user_id
      order by updated_at desc, id asc
    ) as rn
  from athlete_profiles
)
delete from athlete_profiles ap
using ranked r
where ap.ctid = r.ctid
  and r.rn > 1;

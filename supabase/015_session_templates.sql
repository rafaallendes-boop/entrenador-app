-- 015_session_templates.sql — Coach Library: session templates.
-- Account-scoped (user_id), client-writable and convergent through soft delete.
-- Spec: docs/superpowers/specs/2026-07-17-coach-biblioteca-plantillas-design.md

create table if not exists public.session_templates (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind text not null,
  payload_version smallint not null default 1 check (payload_version > 0),
  data jsonb not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint null,
  check (deleted_at is null or deleted_at = updated_at)
);

-- Unknown discriminants must round-trip through older clients as opaque rows.
-- Keeping only a non-empty invariant preserves forward compatibility for
-- future template kinds without allowing malformed empty values.
alter table public.session_templates
  drop constraint if exists session_templates_kind_check;
alter table public.session_templates
  drop constraint if exists session_templates_kind_nonempty;
alter table public.session_templates
  add constraint session_templates_kind_nonempty check (btrim(kind) <> '');

create index if not exists session_templates_user_kind_updated
  on public.session_templates (user_id, kind, updated_at desc);

alter table public.session_templates enable row level security;

drop policy if exists session_templates_select on public.session_templates;
create policy session_templates_select on public.session_templates
  for select using (auth.uid() = user_id);
drop policy if exists session_templates_insert on public.session_templates;
create policy session_templates_insert on public.session_templates
  for insert with check (auth.uid() = user_id);
drop policy if exists session_templates_update on public.session_templates;
create policy session_templates_update on public.session_templates
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists session_templates_delete on public.session_templates;
create policy session_templates_delete on public.session_templates
  for delete using (auth.uid() = user_id);

-- LWW guard with delete-wins and versioned tombstones. Keeping this logic in a
-- BEFORE UPDATE trigger lets every client use the generic upsert path:
--   1. an older write keeps the current row;
--   2. at equal timestamps a deleted row wins, otherwise OLD is canonical;
--   3. a newer live write cannot resurrect a tombstone: it only advances the
--      tombstone version, so the next pull converges on deletion.
create or replace function public.session_templates_guard()
returns trigger
language plpgsql
as $$
begin
  if new.updated_at < old.updated_at then
    return old;
  end if;

  if old.deleted_at is not null then
    if new.deleted_at is not null and new.updated_at > old.updated_at then
      return new;
    end if;
    if new.updated_at = old.updated_at then
      return old;
    end if;
    old.updated_at := new.updated_at;
    old.deleted_at := new.updated_at;
    return old;
  end if;

  if new.updated_at = old.updated_at then
    if new.deleted_at is not null then
      return new;
    end if;
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists session_templates_guard_trigger on public.session_templates;
create trigger session_templates_guard_trigger
  before update on public.session_templates
  for each row execute function public.session_templates_guard();

-- Tombstone retention. The client prunes local tombstones older than its
-- TOMBSTONE_TTL_MS (180 days, syncService.ts) during merge, which bounds Dexie
-- growth and stops pointless re-pushes, but it never hard-deletes remotely: a
-- delete issued from one device could otherwise resurrect a row still held live
-- by a device that has not synced. Server-side pruning is therefore a scheduled
-- job, and must use the SAME horizon so both sides expire together:
--
--   delete from public.session_templates
--   where deleted_at is not null
--     and deleted_at < (extract(epoch from now()) * 1000)::bigint
--                      - (180 * 24 * 60 * 60 * 1000);
--
-- Until that job exists, deleted rows accumulate remotely; they are still
-- filtered from every read surface, so this is a storage concern, not a
-- correctness one.

-- Manual smoke recipe (run in the Supabase SQL editor; do not commit data).
-- It needs at least two auth.users so owner-only RLS can be checked:
-- begin;
--   select set_config('app.template_owner_a', (select id::text from auth.users order by id limit 1), true);
--   select set_config('app.template_owner_b', (select id::text from auth.users order by id offset 1 limit 1), true);
--   insert into public.session_templates (id, user_id, name, kind, data, created_at, updated_at)
--   values ('00000000-0000-0000-0000-000000000001', current_setting('app.template_owner_a')::uuid,
--           'smoke', 'session', '{}'::jsonb, 100, 100);
--   insert into public.session_templates (id, user_id, name, kind, data, created_at, updated_at)
--   values ('00000000-0000-0000-0000-000000000002', current_setting('app.template_owner_b')::uuid,
--           'foreign future kind', 'future-session', '{"opaque":true}'::jsonb, 100, 100);
--   update public.session_templates set name = 'stale', updated_at = 50
--     where id = '00000000-0000-0000-0000-000000000001';
--   select updated_at = 100 as stale_rejected from public.session_templates
--     where id = '00000000-0000-0000-0000-000000000001';
--   update public.session_templates set deleted_at = 100, updated_at = 100
--     where id = '00000000-0000-0000-0000-000000000001';
--   select deleted_at = 100 as equal_delete_wins from public.session_templates
--     where id = '00000000-0000-0000-0000-000000000001';
--   update public.session_templates set deleted_at = null, name = 'resurrected', updated_at = 200
--     where id = '00000000-0000-0000-0000-000000000001';
--   select deleted_at = 200 and updated_at = 200 and name = 'smoke' as versioned_tombstone
--     from public.session_templates where id = '00000000-0000-0000-0000-000000000001';
--   -- (d) RLS owner-only. As owner A, owner B is invisible and immutable.
--   select set_config(
--     'request.jwt.claims',
--     json_build_object('sub', current_setting('app.template_owner_a'), 'role', 'authenticated')::text,
--     true
--   );
--   set local role authenticated;
--   select count(*) = 1 as rls_select_owner_only from public.session_templates;
--   update public.session_templates set name = 'forbidden', updated_at = 300
--     where id = '00000000-0000-0000-0000-000000000002'; -- UPDATE 0
--   delete from public.session_templates
--     where id = '00000000-0000-0000-0000-000000000002'; -- DELETE 0
--   reset role;
--   select name = 'foreign future kind' as rls_update_delete_blocked from public.session_templates
--     where id = '00000000-0000-0000-0000-000000000002';
--   set local role authenticated;
--   -- WITH CHECK: owner A cannot insert for owner B. The exception block lets
--   -- the smoke continue and fails loudly if the forbidden insert ever lands.
--   do $rls$
--   begin
--     insert into public.session_templates (id, user_id, name, kind, data, created_at, updated_at)
--     values ('00000000-0000-0000-0000-000000000003', current_setting('app.template_owner_b')::uuid,
--             'forbidden', 'session', '{}'::jsonb, 100, 100);
--     raise exception 'session_templates RLS insert check unexpectedly succeeded';
--   exception
--     when insufficient_privilege then null; -- expected SQLSTATE 42501
--   end
--   $rls$;
--   reset role;
-- rollback;

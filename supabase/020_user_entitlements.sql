-- 020_user_entitlements.sql — Entitlements por plan.
--
-- Una fila por cuenta. La ausencia de fila significa `free`: no hay backfill y
-- un registro nuevo no escribe nada. Sin políticas de insert/update/delete —
-- solo el service role asigna, así nadie se auto-asciende.
-- Spec: docs/superpowers/specs/2026-08-15-entitlements-design.md

create table if not exists public.user_entitlements (
  user_id    uuid primary key,
  tier       text not null check (tier in ('free','weekly','advanced')),
  expires_at timestamptz,
  source     text not null default 'manual',
  note       text,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- `updated_at` no puede depender de que quien escribe se acuerde.
create or replace function public.touch_user_entitlements() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists user_entitlements_touch on public.user_entitlements;
create trigger user_entitlements_touch
  before update on public.user_entitlements
  for each row execute function public.touch_user_entitlements();

alter table public.user_entitlements enable row level security;

drop policy if exists user_entitlements_select_own on public.user_entitlements;
create policy user_entitlements_select_own on public.user_entitlements
  for select using (auth.uid() = user_id);

-- Deliberadamente no se declaran políticas de insert, update ni delete.

-- `note` es comentario operacional interno y NO se expone al cliente. RLS
-- filtra filas, no columnas: la restricción por columna tiene que ser un grant.
revoke all on public.user_entitlements from anon, authenticated;
grant select (user_id, tier, expires_at, source, granted_at, updated_at)
  on public.user_entitlements to authenticated;

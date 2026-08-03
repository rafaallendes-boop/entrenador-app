-- 017_user_consents.sql — Consentimiento in-app versionado.
--
-- Log append-only por cuenta. Sin políticas de update/delete: lo que no está
-- permitido por RLS no ocurre. No hay FK a auth.users a propósito: el alcance
-- del borrado de cuenta es una decisión legal abierta, y fijar `cascade` acá la
-- respondería por adelantado.
-- Spec: docs/superpowers/specs/2026-08-02-in-app-consent-design.md

create table if not exists public.user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  document text not null,
  version text not null,
  accepted_at timestamptz not null default now(),
  unique (user_id, document, version)
);

create index if not exists user_consents_user_document_idx
  on public.user_consents (user_id, document);

-- `default now()` solo aplica si el cliente omite la columna. El trigger la
-- sobrescribe siempre: el registro legal no puede quedar fechado por quien
-- consiente.
create or replace function public.force_consent_timestamp() returns trigger as $$
begin
  new.accepted_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists user_consents_force_timestamp on public.user_consents;
create trigger user_consents_force_timestamp
  before insert on public.user_consents
  for each row execute function public.force_consent_timestamp();

alter table public.user_consents enable row level security;

drop policy if exists user_consents_select_own on public.user_consents;
create policy user_consents_select_own on public.user_consents
  for select using (auth.uid() = user_id);

drop policy if exists user_consents_insert_own on public.user_consents;
create policy user_consents_insert_own on public.user_consents
  for insert with check (auth.uid() = user_id);

-- Deliberadamente no se declaran políticas de update ni delete.

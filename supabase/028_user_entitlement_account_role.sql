-- 028_user_entitlement_account_role.sql — Rol de cuenta explícito.
--
-- Rol de cuenta explícito (spec §5). El rol NO es un plan: `account_role` dice
-- qué producto usa la cuenta, `tier` dice cuánto puede hacer.
-- Aplicación manual.

begin;

alter table public.user_entitlements
  add column if not exists account_role text not null default 'athlete';

alter table public.user_entitlements
  drop constraint if exists user_entitlements_account_role_check;
alter table public.user_entitlements
  add constraint user_entitlements_account_role_check
  check (account_role in ('athlete','coach'));

-- Nunca `select *`: el grant es la lista exacta. `note` sigue fuera a propósito.
grant select (user_id, tier, expires_at, account_role)
  on public.user_entitlements to authenticated;

commit;

notify pgrst, 'reload schema';

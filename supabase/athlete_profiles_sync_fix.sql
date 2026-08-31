-- DEPRECATED — NO APLICAR.
--
-- Este script pertenecía al modelo singleton-per-user y recreaba el índice
-- athlete_profiles_user_id_unique. Ese índice rompe los perfiles gestionados:
-- una cuenta coach necesita varias filas, una por athlete_id, y PostgREST
-- responde 409 al intentar crear la segunda.
--
-- La migración canónica es:
--   supabase/026_fix_athlete_profiles_sync_contract.sql
--
-- Fallamos de forma explícita para que una ejecución manual accidental no
-- reintroduzca silenciosamente el incidente de producción.
do $$
begin
  raise exception
    'athlete_profiles_sync_fix.sql is deprecated; apply 026_fix_athlete_profiles_sync_contract.sql instead';
end $$;

import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const FIXTURE = 'supabase/__tests__/pglite/schemaFixture.sql'

/** Base embebida con el fixture y las migraciones indicadas, en orden. */
export async function createMigratedDb(migrations: string[]): Promise<PGlite> {
  const db = new PGlite()
  await db.exec(readFileSync(FIXTURE, 'utf8'))
  // Ejecutar las funciones reales: el fixture no debe inventar otra siembra
  // ni omitir las invariantes vigentes de producción.
  for (const [path, name] of [
    ['supabase/013b_two_sided_expand.sql', 'seed_membership_for_new_athlete'],
    ['supabase/013b_two_sided_expand.sql', 'reject_athlete_access_reparent'],
    ['supabase/031_retire_legacy_policies.sql', 'enforce_athlete_role_invariants'],
    ['supabase/013b_two_sided_expand.sql', 'auth_athlete_ids'],
    ['supabase/013b_two_sided_expand.sql', 'auth_coach_athlete_ids'],
    ['supabase/031_retire_legacy_policies.sql', 'auth_deletable_athlete_ids'],
  ]) {
    const source = readFileSync(path, 'utf8')
    const start = source.indexOf(`create or replace function public.${name}(`)
    if (start < 0) throw new Error(`No existe ${name} en ${path}`)
    const end = source.indexOf('$$;', source.indexOf('as $$', start))
    if (end < 0) throw new Error(`No termina ${name} en ${path}`)
    await db.exec(source.slice(start, end + 3))
  }
  await db.exec(`
    create trigger athletes_seed_membership after insert on public.athletes
      for each row execute function public.seed_membership_for_new_athlete();
    create trigger athletes_no_access_reparent before update on public.athletes
      for each row execute function public.reject_athlete_access_reparent();
    create trigger athletes_enforce_role_invariants before insert on public.athletes
      for each row execute function public.enforce_athlete_role_invariants();
  `)
  for (const [path, names] of [
    ['supabase/007_athlete_scope.sql', ['athletes_insert']],
    ['supabase/013b_two_sided_expand.sql', ['athlete_memberships_select_own', 'athletes_select_membership', 'athletes_write_coach', 'athletes_update_self']],
    ['supabase/031_retire_legacy_policies.sql', ['athletes_delete_membership']],
  ] as const) {
    const source = readFileSync(path, 'utf8')
    for (const name of names) {
      const start = source.indexOf(`create policy ${name} on `)
      if (start < 0) throw new Error(`No existe la policy ${name}`)
      await db.exec(source.slice(start, source.indexOf(';', start) + 1))
    }
  }
  await db.exec(`
    alter policy athletes_insert on public.athletes rename to athletes_insert_bootstrap_owner;
    alter table public.athletes enable row level security;
    alter table public.athlete_memberships enable row level security;
    grant usage on schema public, auth to authenticated;
    grant select, insert, update, delete on public.athletes to authenticated;
    grant select on public.athlete_memberships to authenticated;
  `)
  for (const path of migrations) {
    const sql = readFileSync(path, 'utf8').replace(/notify pgrst,\s*'reload schema';/g, '')
    await db.exec(sql)
  }
  return db
}

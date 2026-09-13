import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createMigratedDb } from './pglite/createPglite'

const HYBRID = '11111111-1111-4111-8111-111111111111'
const COACH = '22222222-2222-4222-8222-222222222222'
const STRANGER = '33333333-3333-4333-8333-333333333333'
const MANAGED = 'ath_m_transfer'

let db: PGlite

async function memberships(athleteId: string) {
  const { rows } = await db.query<{ account_id: string; role: string }>(
    'select account_id, role from public.athlete_memberships where athlete_id = $1 order by role, account_id',
    [athleteId],
  )
  return rows
}

beforeEach(async () => {
  db = await createMigratedDb(['supabase/037_coach_account_provisioning.sql'])
  await db.query('insert into auth.users (id, email) values ($1, $2), ($3, $4), ($5, $6)', [
    HYBRID, 'hybrid@x.cl', COACH, 'coach@x.cl', STRANGER, 'stranger@x.cl',
  ])
  // Cuenta híbrida: self + un gestionado (el trigger de 013b siembra ambas membresías).
  await db.query(
    'insert into public.athletes (id, owner_account_id, linked_account_id, display_name, created_at, updated_at) values ($1, $2, $2, $3, 1, 1)',
    [`ath_${HYBRID}`, HYBRID, 'Rafa'],
  )
  await db.query(
    'insert into public.athletes (id, owner_account_id, linked_account_id, display_name, created_at, updated_at) values ($1, $2, null, $3, 1, 1)',
    [MANAGED, HYBRID, 'Transferido'],
  )
})

afterEach(async () => {
  await db.close()
})

describe('admin_set_account_role', () => {
  it('provisiona coach + tier sobre una cuenta sin fila de entitlements', async () => {
    await db.query("select public.admin_set_account_role($1, 'coach', 'advanced')", [COACH])

    const { rows } = await db.query<{ account_role: string; tier: string }>(
      'select account_role, tier from public.user_entitlements where user_id = $1', [COACH],
    )
    expect(rows).toEqual([{ account_role: 'coach', tier: 'advanced' }])
  })

  it('con p_tier null conserva el tier existente', async () => {
    await db.query("select public.admin_set_account_role($1, 'athlete', 'weekly')", [COACH])
    await db.query("select public.admin_set_account_role($1, 'coach')", [COACH])

    const { rows } = await db.query<{ tier: string }>('select tier from public.user_entitlements where user_id = $1', [COACH])
    expect(rows).toEqual([{ tier: 'weekly' }])
  })

  it('rechaza coach para una cuenta con membresía self (la híbrida)', async () => {
    await expect(db.query("select public.admin_set_account_role($1, 'coach')", [HYBRID]))
      .rejects.toThrow(/account has a self athlete; cannot become coach/)
  })

  it('rechaza rol, tier y usuario inválidos', async () => {
    await expect(db.query("select public.admin_set_account_role($1, 'admin')", [COACH])).rejects.toThrow(/invalid role/)
    await expect(db.query("select public.admin_set_account_role($1, 'coach', 'gold')", [COACH])).rejects.toThrow(/invalid tier/)
    await expect(db.query("select public.admin_set_account_role('44444444-4444-4444-8444-444444444444', 'coach')"))
      .rejects.toThrow(/user does not exist/)
  })
})

describe('admin_transfer_coach_membership', () => {
  beforeEach(async () => {
    await db.query("select public.admin_set_account_role($1, 'coach', 'advanced')", [COACH])
  })

  it('mueve la membresía coach y NO toca owner/linked del atleta', async () => {
    expect(await memberships(MANAGED)).toEqual([{ account_id: HYBRID, role: 'coach' }])

    await db.query('select public.admin_transfer_coach_membership($1, $2, $3)', [MANAGED, HYBRID, COACH])

    expect(await memberships(MANAGED)).toEqual([{ account_id: COACH, role: 'coach' }])
    const { rows } = await db.query<{ owner_account_id: string; linked_account_id: string | null }>(
      'select owner_account_id, linked_account_id from public.athletes where id = $1', [MANAGED],
    )
    expect(rows).toEqual([{ owner_account_id: HYBRID, linked_account_id: null }])
  })

  it('repetir una transferencia ya aplicada se rechaza sin duplicar el destino', async () => {
    await db.query('select public.admin_transfer_coach_membership($1, $2, $3)', [MANAGED, HYBRID, COACH])
    await expect(db.query('select public.admin_transfer_coach_membership($1, $2, $3)', [MANAGED, HYBRID, COACH]))
      .rejects.toThrow(/source has no coach membership/)
    expect(await memberships(MANAGED)).toEqual([{ account_id: COACH, role: 'coach' }])
  })

  it('rechaza un destino que no es coach', async () => {
    await expect(db.query('select public.admin_transfer_coach_membership($1, $2, $3)', [MANAGED, HYBRID, STRANGER]))
      .rejects.toThrow(/destination is not a coach account/)
    expect(await memberships(MANAGED)).toEqual([{ account_id: HYBRID, role: 'coach' }])
  })

  it('rechaza un atleta con membresía self (eso es SP1b)', async () => {
    await db.query('insert into public.athlete_memberships values ($1, $2, $3, 1, 1)', [`ath_${HYBRID}`, STRANGER, 'coach'])
    await expect(db.query('select public.admin_transfer_coach_membership($1, $2, $3)', [`ath_${HYBRID}`, STRANGER, COACH]))
      .rejects.toThrow(/athlete has a self membership/)
  })

  it('rechaza argumentos inválidos y origen = destino', async () => {
    await expect(db.query('select public.admin_transfer_coach_membership($1, $2, $2)', [MANAGED, COACH]))
      .rejects.toThrow(/invalid arguments/)
  })

  it('la RPC es atómica: si el borrado fallara, la inserción no queda a medias', async () => {
    // Simular fallo tardío: un trigger que aborta el DELETE de memberships.
    await db.exec(`
      create or replace function public.__abort_delete() returns trigger language plpgsql as $$
      begin raise exception 'simulated'; end $$;
      create trigger __abort before delete on public.athlete_memberships for each row execute function public.__abort_delete();
    `)
    await expect(db.query('select public.admin_transfer_coach_membership($1, $2, $3)', [MANAGED, HYBRID, COACH]))
      .rejects.toThrow(/simulated/)
    expect(await memberships(MANAGED)).toEqual([{ account_id: HYBRID, role: 'coach' }])
  })
})

describe('grants de 037', () => {
  it('sólo service_role ejecuta las dos RPC', async () => {
    const { rows } = await db.query<{ proname: string; svc: boolean; auth: boolean; anon: boolean }>(`
      select p.proname,
             has_function_privilege('service_role', p.oid, 'execute') as svc,
             has_function_privilege('authenticated', p.oid, 'execute') as auth,
             has_function_privilege('anon', p.oid, 'execute') as anon
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('admin_set_account_role', 'admin_transfer_coach_membership')
      order by p.proname
    `)
    expect(rows).toEqual([
      { proname: 'admin_set_account_role', svc: true, auth: false, anon: false },
      { proname: 'admin_transfer_coach_membership', svc: true, auth: false, anon: false },
    ])
  })
})


describe('invariantes y permisos ejecutados', () => {
  it('una cuenta coach no puede insertar un self por el trigger vigente', async () => {
    await db.query("select public.admin_set_account_role($1, 'coach')", [COACH])
    await expect(db.query('insert into public.athletes values ($1, $2, $2, null, $3, 1, 1)', ['ath_coach', COACH, 'active']))
      .rejects.toThrow(/a coach account cannot own a self athlete/)
  })

  it.each(['anon', 'authenticated'])('%s no puede invocar ninguna RPC', async (role) => {
    await db.exec(`set role ${role}`)
    await expect(db.query("select public.admin_set_account_role($1, 'coach')", [COACH]))
      .rejects.toThrow(/permission denied/)
    await expect(db.query('select public.admin_transfer_coach_membership($1, $2, $3)', [MANAGED, HYBRID, COACH]))
      .rejects.toThrow(/permission denied/)
    await db.exec('reset role')
  })

  it('service_role puede provisionar y transferir sin ser propietario de tablas', async () => {
    await db.exec('set role service_role')
    await db.query("select public.admin_set_account_role($1, 'coach')", [COACH])
    await db.query('select public.admin_transfer_coach_membership($1, $2, $3)', [MANAGED, HYBRID, COACH])
    await db.exec('reset role')
    expect(await memberships(MANAGED)).toEqual([{ account_id: COACH, role: 'coach' }])
  })
})

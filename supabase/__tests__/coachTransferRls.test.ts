import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createMigratedDb } from './pglite/createPglite'

const OWNER = '11111111-1111-4111-8111-111111111111'
const COACH = '22222222-2222-4222-8222-222222222222'
let db: PGlite

beforeEach(async () => {
  db = await createMigratedDb(['supabase/037_coach_account_provisioning.sql'])
  await db.query('insert into auth.users (id) values ($1), ($2)', [OWNER, COACH])
  await db.query("select public.admin_set_account_role($1, 'coach')", [COACH])
  await db.query("insert into public.athletes values ('managed', $1, null, 'Transferido', 'active', 1, 1)", [OWNER])
  await db.query("select public.admin_transfer_coach_membership('managed', $1, $2)", [OWNER, COACH])
})

afterEach(async () => { await db.close() })

async function actAs(accountId: string) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [accountId])
  await db.exec('set role authenticated')
}

describe('RLS real de athletes tras transferir', () => {
  it('rechaza el upsert ajeno, pero permite UPDATE y DELETE RETURNING por membresía', async () => {
    await actAs(COACH)
    await expect(db.query(`
      insert into public.athletes values ('managed', $1, null, 'Transferido', 'archived', 1, 2)
      on conflict (id) do update set status = excluded.status
    `, [OWNER])).rejects.toThrow(/row-level security/)
    expect((await db.query("update public.athletes set status = 'archived' where id = 'managed' returning id")).rows)
      .toEqual([{ id: 'managed' }])
    expect((await db.query("delete from public.athletes where id = 'managed' returning id")).rows)
      .toEqual([{ id: 'managed' }])
    // El reintento idempotente no ve ninguna fila.
    expect((await db.query("delete from public.athletes where id = 'managed' returning id")).rows).toEqual([])
    expect((await db.query("select id from public.athletes where id = 'managed'")).rows).toEqual([])
  })

  it('el owner revocado ya no ve ni borra la fila: gone local conserva el remoto', async () => {
    await actAs(OWNER)
    expect((await db.query("delete from public.athletes where id = 'managed' returning id")).rows).toEqual([])
    expect((await db.query("select id from public.athletes where id = 'managed'")).rows).toEqual([])
    await db.exec('reset role')
    expect((await db.query("select id from public.athletes where id = 'managed'")).rows).toEqual([{ id: 'managed' }])
  })

  it('un atleta self es visible pero no borrable: denied', async () => {
    await db.query("insert into public.athletes values ('self', $1, $1, null, 'active', 1, 1)", [OWNER])
    await actAs(OWNER)
    expect((await db.query("delete from public.athletes where id = 'self' returning id")).rows).toEqual([])
    expect((await db.query("select id from public.athletes where id = 'self'")).rows).toEqual([{ id: 'self' }])
  })
})

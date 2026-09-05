import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SQL = readFileSync('supabase/030_athlete_role_invariants.sql', 'utf8')

function fnBody(sql: string, name: string): string {
  const start = sql.indexOf(`function public.${name}(`)
  if (start < 0) return ''
  const open = sql.indexOf('as $$', start)
  const close = sql.indexOf('$$;', open)
  return open < 0 || close < 0 ? '' : sql.slice(open, close)
}

describe('030 cierra los huecos de comando de 013b', () => {
  it('amplía la escritura self a las tres tablas coach-only', () => {
    for (const table of ['coach_proposals', 'training_plans', 'training_plan_weeks']) {
      expect(SQL).toContain(`'${table}'`)
    }
    expect(SQL).toContain("tbl || '_write_member'")
    expect(SQL).toContain('auth_athlete_ids()')
  })

  it('agrega la lectura por membresía que 013b omitió para whoop_workouts', () => {
    expect(SQL).toContain('whoop_workouts_select_membership')
    expect(SQL).toMatch(
      /create policy whoop_workouts_select_membership[\s\S]*?athlete_id in \(select public\.auth_athlete_ids\(\)\)/i,
    )
  })
})

describe('030 respeta el trigger de membresía de 013b', () => {
  it('el alta self estampa linked_account_id, timestamps y no crea memberships a mano', () => {
    const body = fnBody(SQL, 'create_self_athlete')
    expect(body).toContain('linked_account_id')
    expect(body).toContain('created_at')
    expect(body).toContain('updated_at')
    expect(body).not.toMatch(/insert\s+into\s+public\.athlete_memberships/i)
  })

  it('un id existente falla: no tolera conflictos en las RPC de alta', () => {
    const withoutComments = (body: string) => body.replace(/--.*$/gm, '')
    expect(withoutComments(fnBody(SQL, 'create_self_athlete'))).not.toMatch(/on\s+conflict/i)
    expect(withoutComments(fnBody(SQL, 'admin_create_managed_athlete'))).not.toMatch(/on\s+conflict/i)
  })
})

describe('030 impone las invariantes por trigger, no sólo por RPC', () => {
  it('existe el trigger before insert que cubre athletes_insert legacy', () => {
    expect(SQL).toContain('athletes_enforce_role_invariants')
    expect(SQL).toMatch(/before insert on public\.athletes/i)
  })

  it('una cuenta coach no puede crear un atleta self y ninguna cuenta duplica self', () => {
    const body = fnBody(SQL, 'enforce_athlete_role_invariants')
    expect(body).toContain('account_role')
    expect(body).toContain('a coach account cannot own a self athlete')
    expect(body).toContain('account already has a self athlete')
  })

  /**
   * `ensureRemoteAthlete` (`syncService.ts`) hace `upsert` del atleta self con
   * `onConflict: 'id'` antes de empujar cualquier fila con `athlete_id`.
   * PostgreSQL dispara los triggers BEFORE INSERT también en el camino
   * `INSERT ... ON CONFLICT DO UPDATE`, ANTES de resolver el conflicto, así que
   * un chequeo de "ya existe un self" que no exima a la MISMA fila rechaza cada
   * upsert repetido y rompe el push de sync apenas corra el backfill de
   * membresías.
   */
  it('el chequeo de self duplicado exime al propio atleta que se está reinsertando', () => {
    const body = fnBody(SQL, 'enforce_athlete_role_invariants')
    const duplicateCheck = body.slice(body.indexOf("role = 'self'"))
    expect(duplicateCheck).toMatch(/athlete_id\s+is\s+distinct\s+from\s+new\.id/i)
  })

  it('el trigger transitorio no exige coach para managed', () => {
    expect(fnBody(SQL, 'enforce_athlete_role_invariants'))
      .not.toContain('only a coach account can own a managed athlete')
  })

  it('pero admin_create_managed_athlete exige owner coach y rechaza ausencia de entitlement', () => {
    const body = fnBody(SQL, 'admin_create_managed_athlete')
    expect(body).toContain('owner is not a coach account')
    expect(body).toMatch(/coalesce\(v_role,\s*'athlete'\)/)
  })
})

describe('030 borra con veto sobre self', () => {
  it('el borrado veta atletas con membresía self', () => {
    expect(fnBody(SQL, 'admin_delete_athlete')).toMatch(/role\s*=\s*'self'/)
  })
})

describe('030 no retira nada legacy: eso es 031', () => {
  it('no toca las policies legacy', () => {
    expect(SQL).not.toMatch(/drop\s+policy\s+if\s+exists\s+athletes_select\b/i)
    expect(SQL).not.toMatch(/drop\s+policy\s+if\s+exists\s+\w+_select_by_athlete/i)
    expect(SQL).not.toMatch(/drop\s+policy\s+if\s+exists\s+athletes_insert\b/i)
    expect(SQL).not.toMatch(/drop\s+policy\s+if\s+exists\s+whoop_workouts_select\s+on/i)
  })
})

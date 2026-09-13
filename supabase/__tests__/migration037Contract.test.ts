import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SQL = readFileSync('supabase/037_coach_account_provisioning.sql', 'utf8')

function fnBody(sql: string, name: string): string {
  const start = sql.indexOf(`function public.${name}(`)
  if (start < 0) return ''
  const open = sql.indexOf('as $$', start)
  const close = sql.indexOf('$$;', open)
  return open < 0 || close < 0 ? '' : sql.slice(open, close)
}

const withoutComments = (body: string) => body.replace(/--.*$/gm, '')

describe('037 provisiona el rol de cuenta', () => {
  const body = fnBody(SQL, 'admin_set_account_role')

  it('existe, es security definer y sólo la ejecuta service_role', () => {
    expect(body.length).toBeGreaterThan(0)
    expect(SQL).toMatch(/revoke all on function public\.admin_set_account_role\(uuid, text, text\) from public, anon, authenticated/)
    expect(SQL).toMatch(/grant execute on function public\.admin_set_account_role\(uuid, text, text\) to service_role/)
  })

  it('valida rol y tier contra las mismas uniones de 020/028', () => {
    expect(body).toContain("('athlete','coach')")
    expect(body).toContain("('free','weekly','advanced')")
  })

  it('rechaza convertir en coach una cuenta con membresía self (invariante de 030)', () => {
    expect(body).toContain("role = 'self'")
    expect(body).toContain('account has a self athlete; cannot become coach')
  })

  it('escribe por upsert sobre user_id y conserva el tier si no se pasa uno', () => {
    expect(withoutComments(body)).toMatch(/on conflict \(user_id\) do update/i)
    expect(body).toContain('coalesce(p_tier, public.user_entitlements.tier)')
  })
})

describe('037 transfiere la membresía coach', () => {
  const body = fnBody(SQL, 'admin_transfer_coach_membership')

  it('existe y sólo la ejecuta service_role', () => {
    expect(body.length).toBeGreaterThan(0)
    expect(SQL).toMatch(/revoke all on function public\.admin_transfer_coach_membership\(text, uuid, uuid\) from public, anon, authenticated/)
    expect(SQL).toMatch(/grant execute on function public\.admin_transfer_coach_membership\(text, uuid, uuid\) to service_role/)
  })

  it('exige destino coach y membresía coach en el origen', () => {
    expect(body).toContain('destination is not a coach account')
    expect(body).toContain('source has no coach membership')
  })

  it('rechaza un atleta con membresía self: eso es SP1b', () => {
    expect(body).toContain('athlete has a self membership')
  })

  it('inserta la membresía nueva ANTES de borrar la vieja: el atleta nunca queda sin coach', () => {
    const clean = withoutComments(body)
    const insertAt = clean.search(/insert\s+into\s+public\.athlete_memberships/i)
    const deleteAt = clean.search(/delete\s+from\s+public\.athlete_memberships/i)
    expect(insertAt).toBeGreaterThan(-1)
    expect(deleteAt).toBeGreaterThan(insertAt)
  })

  it('nunca reparenta owner/linked', () => {
    expect(withoutComments(body)).not.toMatch(/update\s+public\.athletes/i)
    expect(withoutComments(body)).not.toMatch(/owner_account_id\s*=/i)
  })
})

describe('037 es transaccional y recarga PostgREST', () => {
  it('abre con begin, cierra con commit y notifica pgrst', () => {
    expect(SQL.trimStart().startsWith('-- 037_coach_account_provisioning.sql')).toBe(true)
    expect(SQL).toMatch(/\nbegin;\n/)
    expect(SQL).toMatch(/\ncommit;\n/)
    expect(SQL).toContain("notify pgrst, 'reload schema'")
  })
})

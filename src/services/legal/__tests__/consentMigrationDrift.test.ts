import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const MIGRATION = readFileSync('supabase/017_user_consents.sql', 'utf-8')

describe('017_user_consents', () => {
  it('no declara políticas de update ni delete', () => {
    expect(MIGRATION).not.toMatch(/for\s+update/i)
    expect(MIGRATION).not.toMatch(/for\s+delete/i)
  })

  it('fuerza el timestamp con trigger, no solo con default', () => {
    expect(MIGRATION).toMatch(/before insert on public\.user_consents/i)
    expect(MIGRATION).toMatch(/new\.accepted_at\s*:=\s*now\(\)/i)
  })

  it('no ata el borrado de cuenta con una FK', () => {
    expect(MIGRATION).not.toMatch(/references\s+auth\.users/i)
  })

  it('impide duplicados por reintento', () => {
    expect(MIGRATION).toMatch(/unique \(user_id, document, version\)/i)
  })

  it('habilita RLS y solo permite select e insert propios', () => {
    expect(MIGRATION).toMatch(/enable row level security/i)
    expect(MIGRATION).toMatch(/for select using \(auth\.uid\(\) = user_id\)/i)
    expect(MIGRATION).toMatch(/for insert with check \(auth\.uid\(\) = user_id\)/i)
  })
})

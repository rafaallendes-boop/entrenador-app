import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SQL = readFileSync(
  resolve(process.cwd(), 'supabase/026_fix_athlete_profiles_sync_contract.sql'),
  'utf8',
)
const DEPRECATED_SYNC_FIX = readFileSync(
  resolve(process.cwd(), 'supabase/athlete_profiles_sync_fix.sql'),
  'utf8',
)

describe('026 athlete_profiles sync contract', () => {
  it('establishes the exact athlete_id unique target used by PostgREST', () => {
    expect(SQL).toMatch(
      /create unique index if not exists athlete_profiles_one_per_athlete\s+on public\.athlete_profiles \(athlete_id\)/i,
    )
    expect(SQL).toMatch(/alter column athlete_id set not null/i)
    expect(SQL).toContain("notify pgrst, 'reload schema'")
  })

  it('fails closed on ambiguous data before changing the uniqueness contract', () => {
    const guardPosition = SQL.indexOf('026 aborted:')
    const uniquePosition = SQL.indexOf('create unique index if not exists athlete_profiles_one_per_athlete')

    expect(guardPosition).toBeGreaterThan(0)
    expect(uniquePosition).toBeGreaterThan(guardPosition)
    expect(SQL).toContain('null_profiles')
    expect(SQL).toContain('orphan_profiles')
    expect(SQL).toContain('duplicate_athletes')
  })

  it('removes every single-column user_id unique and never deletes profile rows', () => {
    expect(SQL).toContain("user_column.attname = 'user_id'")
    expect(SQL).toContain('index_meta.indnkeyatts = 1')
    expect(SQL).toContain('drop constraint')
    expect(SQL).toContain('drop index')
    expect(SQL).not.toMatch(/delete\s+from\s+public\.athlete_profiles/i)
  })

  it('is transactional and verifies the final contract before commit', () => {
    expect(SQL.trimStart().indexOf('begin;')).toBeGreaterThan(0)
    expect(SQL).toContain('026 verification failed:')
    expect(SQL.indexOf('026 verification failed:')).toBeLessThan(SQL.lastIndexOf('commit;'))
  })

  it('the legacy helper cannot recreate the one-profile-per-user index', () => {
    expect(DEPRECATED_SYNC_FIX).toContain('DEPRECATED — NO APLICAR')
    expect(DEPRECATED_SYNC_FIX).toContain('apply 026_fix_athlete_profiles_sync_contract.sql instead')
    expect(DEPRECATED_SYNC_FIX).not.toMatch(/create\s+unique\s+index[^;]+\(user_id\)/i)
  })
})

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { USER_ENTITLEMENT_SELECT_COLUMNS } from '../entitlementColumns'

const MIGRATION = readFileSync(
  resolve(process.cwd(), 'supabase/020_user_entitlements.sql'),
  'utf8',
)

const MIGRATIONS = [
  'supabase/020_user_entitlements.sql',
  'supabase/028_user_entitlement_account_role.sql',
]

function grantedColumns(): string[] {
  const granted = new Set<string>()
  for (const file of MIGRATIONS) {
    const sql = readFileSync(resolve(process.cwd(), file), 'utf8')
    // Un archivo puede traer más de un `grant select (...)`: se toman todos, y
    // el último gana en Postgres, así que la UNIÓN es la cota superior segura.
    for (const match of sql.matchAll(/grant select \(([^)]+)\)/gi)) {
      for (const col of match[1].split(',')) granted.add(col.trim())
    }
  }
  return [...granted]
}

describe('guard de drift entre codigo y migraciones 020/028', () => {
  it('toda columna que el codigo pide existe en el grant de alguna migracion', () => {
    const granted = grantedColumns()
    for (const column of USER_ENTITLEMENT_SELECT_COLUMNS) {
      expect(granted).toContain(column)
    }
  })

  it('`note` NO esta en el grant: es comentario operacional interno', () => {
    const granted = grantedColumns()
    expect(granted).not.toContain('note')
  })

  it('el codigo nunca pide `note`', () => {
    expect(USER_ENTITLEMENT_SELECT_COLUMNS).not.toContain('note')
  })

  it('la migracion revoca los permisos por defecto antes de otorgar columnas', () => {
    expect(MIGRATION).toMatch(/revoke all on public\.user_entitlements from anon, authenticated/i)
  })

  it('la migracion no declara politicas de escritura', () => {
    expect(MIGRATION).not.toMatch(/for\s+(insert|update|delete)/i)
  })

  it('el CHECK del tier cubre exactamente los tres valores', () => {
    expect(MIGRATION).toMatch(/check \(tier in \('free','weekly','advanced'\)\)/i)
  })

  it('la policy es idempotente', () => {
    expect(MIGRATION).toMatch(/drop policy if exists user_entitlements_select_own/i)
  })
})

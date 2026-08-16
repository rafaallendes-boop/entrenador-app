import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { USER_ENTITLEMENT_SELECT_COLUMNS } from '../entitlementColumns'

const MIGRATION = readFileSync(
  resolve(process.cwd(), 'supabase/020_user_entitlements.sql'),
  'utf8',
)

describe('guard de drift entre codigo y migracion 020', () => {
  it('toda columna que el codigo pide existe en el grant de la migracion', () => {
    const grantMatch = /grant select \(([^)]+)\)/i.exec(MIGRATION)
    expect(grantMatch).not.toBeNull()
    const granted = grantMatch![1].split(',').map((c) => c.trim())
    for (const column of USER_ENTITLEMENT_SELECT_COLUMNS) {
      expect(granted).toContain(column)
    }
  })

  it('`note` NO esta en el grant: es comentario operacional interno', () => {
    const grantMatch = /grant select \(([^)]+)\)/i.exec(MIGRATION)
    const granted = grantMatch![1].split(',').map((c) => c.trim())
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

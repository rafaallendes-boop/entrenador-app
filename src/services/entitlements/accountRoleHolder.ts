import type { ResolvedAccountRole } from './entitlementPolicy'

// Los servicios no React leen este holder. Arranca cerrado: hasta que el
// bootstrap confirme identidad, ninguna lectura puede adoptar filas legacy.
let accountRole: ResolvedAccountRole = 'unknown'

export function getAccountRole(): ResolvedAccountRole {
  return accountRole
}

export function setAccountRole(role: ResolvedAccountRole): void {
  accountRole = role
}

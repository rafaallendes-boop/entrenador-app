/**
 * Registro del backend activo del harness.
 *
 * **Módulo puro a propósito: no importa nada de la aplicación.** La factory de
 * `vi.mock('../services/auth')` lo importa, y `useAuthStore` importa
 * `services/auth` (`useAuthStore.ts:4`); si el registro importara el store se
 * formaría el ciclo `auth → registro → useAuthStore → auth`.
 */
import type { FakePostgrest } from './fakePostgrest'

let activeBackend: FakePostgrest | null = null

export function setActiveFakeBackend(backend: FakePostgrest | null): void {
  activeBackend = backend
}

export function getActiveFakeBackend(): FakePostgrest | null {
  return activeBackend
}

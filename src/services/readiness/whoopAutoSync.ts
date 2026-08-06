/** Ventana por defecto tras la cual un sync de Whoop se considera viejo. */
export const WHOOP_AUTO_SYNC_STALE_AFTER_MS = 1_800_000 // 30 min

export interface WhoopAutoSyncInput {
  connected: boolean
  lastSyncAt: string | null | undefined
  lastSyncStatus: 'ok' | 'error' | null | undefined
  now: number
  staleAfterMs?: number
}

/**
 * Decide si conviene disparar un sync automatico de Whoop al abrir la app.
 *
 * La regla es asimetrica a proposito: devuelve `false` solo cuando puede
 * *probar* que los datos estan frescos. Cualquier incertidumbre sincroniza.
 *
 * `lastSyncStatus` no es opcional para esa prueba: el servidor escribe
 * `lastSyncAt` tambien en el camino de error (whoopSync.ts:139-142), asi que un
 * timestamp reciente con status 'error' significa que el intento fallo y no que
 * haya datos frescos.
 */
export function shouldAutoSyncWhoop(input: WhoopAutoSyncInput): boolean {
  if (!input.connected) return false
  if (input.lastSyncStatus !== 'ok') return true
  if (input.lastSyncAt == null) return true

  const lastSyncMs = new Date(input.lastSyncAt).getTime()
  if (!Number.isFinite(lastSyncMs)) return true

  const elapsed = input.now - lastSyncMs
  if (elapsed < 0) return true

  return elapsed >= (input.staleAfterMs ?? WHOOP_AUTO_SYNC_STALE_AFTER_MS)
}

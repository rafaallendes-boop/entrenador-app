import type { DraftFailure } from '../../services/coach/requestAssistantDraft'

export type BlockingDraftFailure = Extract<
  DraftFailure,
  'quota' | 'kill-switch' | 'entitlement'
>

/**
 * Bloquear la superficie completa se reserva a rechazos DETERMINISTAS, donde
 * reintentar no puede cambiar el resultado. `unavailable` no califica: cubre
 * cualquier error no reintentable del proveedor, incluido el 503 de
 * infraestructura del gate de uso, que es típicamente transitorio. Dejarlo
 * bloqueante hacía que un solo hipo de PostgREST deshabilitara la redacción
 * para todo el roster hasta recargar la página.
 */
export function isBlockingFailure(reason: DraftFailure): reason is BlockingDraftFailure {
  return reason === 'quota'
    || reason === 'kill-switch'
    || reason === 'entitlement'
}

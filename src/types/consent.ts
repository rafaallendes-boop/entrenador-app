/** Identificador estable del documento legal aceptado. */
export type ConsentDocumentId = 'terms' | 'privacy' | 'health' | 'whoop_biometric'

/**
 * Espejo local de una aceptación confirmada por el servidor. Nunca se
 * construye en el cliente: siempre proviene de una fila devuelta por Supabase.
 */
export interface ConsentAcceptance {
  /** `id` remoto: hace el espejo trazable fila a fila. */
  id: string
  userId: string
  document: ConsentDocumentId
  version: string
  /** ISO del servidor, tal como vino. */
  acceptedAt: string
}

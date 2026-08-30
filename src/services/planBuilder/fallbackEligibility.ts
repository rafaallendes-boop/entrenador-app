/**
 * Errores de calidad que no pueden convertirse en una semana local: hacerlo
 * ocultaría una candidata rechazada por una postcondición estricta.
 */
export const NON_FALLBACK_ELIGIBLE_ERROR_CLASSES = new Set([
  'quality.squash.signature_uniqueness_unresolved',
  'quality.strength.safety_blocked',
])

/**
 * La candidata parseó y validó; la rechazó una postcondición de calidad. Es el
 * mismo conjunto visto desde la telemetría: sirve para no contarla en el bucket
 * de fallas de schema.
 */
export function isQualityFailClosedRejection(errorClass: string | undefined): boolean {
  return NON_FALLBACK_ELIGIBLE_ERROR_CLASSES.has(errorClass ?? '')
}

export function isLocalFallbackEligible(errorClass: string | undefined): boolean {
  return !isQualityFailClosedRejection(errorClass)
}

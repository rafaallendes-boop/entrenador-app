/**
 * Adaptador de servidor. Las variables `VITE_*` solo existen en el bundle del
 * cliente, por lo que las funciones de Netlify usan su propia bandera.
 */
export function isConsentEnforcementEnabled(): boolean {
  return process.env['CONSENT_GATE_ENABLED'] === 'true'
}

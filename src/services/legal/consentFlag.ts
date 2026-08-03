/**
 * Adaptador de entorno del cliente. El manifiesto legal permanece como datos
 * puros e importables por las funciones de Netlify.
 */
export function isConsentEnforcementEnabled(): boolean {
  return import.meta.env.VITE_CONSENT_GATE === 'true'
}

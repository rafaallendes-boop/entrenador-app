/**
 * Gatea solo el ocultamiento proactivo de affordances. El manejo reactivo del
 * 403 queda siempre encendido, de modo que servidor activo + cliente apagado
 * sigue siendo un estado de rollout seguro y muestra la oferta correcta.
 */
export function isProactiveEntitlementUiEnabled(): boolean {
  return import.meta.env.VITE_ENTITLEMENTS === 'true'
}

/**
 * Canal único de contacto del prelanzamiento. Mientras no exista cobro ni
 * gate de entitlements activo, toda superficie pública que ofrezca un plan
 * pagado tiene que llegar acá: responde una persona y decide quién entra.
 *
 * Vive en un módulo propio porque la dirección estaba repetida entre
 * `/coaches` y `/pricing`, y una copia que se quede atrás manda correo a una
 * casilla que nadie lee.
 */
export const PRELAUNCH_CONTACT_EMAIL = 'hola@rallyiq.cl'

/** `mailto:` con el asunto codificado; un asunto crudo rompe el enlace. */
export function buildPrelaunchMailto(subject: string): string {
  return `mailto:${PRELAUNCH_CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`
}

/** Asunto del pedido de acceso a un plan que todavía no se cobra. */
export function buildBetaAccessMailto(planName: string): string {
  return buildPrelaunchMailto(`Quiero acceso a la beta de RallyIQ — plan ${planName}`)
}

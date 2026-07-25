/**
 * Cadencia de polling del cliente para la generación de planes. Vive en un
 * módulo puro (sin imports) porque además del cliente la consume el driver de
 * loadtest, que mide el lag de descubrimiento contra este mismo intervalo. Si
 * el literal se duplicara, el loadtest podría medir una cadencia que producción
 * ya no usa.
 */
export const PLAN_GENERATION_POLL_INTERVAL_MS = 4_000

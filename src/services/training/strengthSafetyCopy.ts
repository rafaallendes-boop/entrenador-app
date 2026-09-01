/**
 * Copy determinista de bloqueo por restricción de seguridad.
 *
 * Vive en su propio módulo, sin dependencias, porque lo emiten cuatro
 * productores distintos —chat, aceptación de acciones, Week Creator y
 * `applyCreateWeek`— y antes cada uno lo repetía como literal. El plan lo
 * declara verbatim: una sola fuente evita que una edición futura desincronice
 * lo que ve el usuario según por dónde haya entrado.
 *
 * Nunca debe decir "segura": el producto no afirma seguridad, afirma que no
 * pudo verificar compatibilidad con la restricción registrada.
 */
export const BLOCKED_STRENGTH_COPY =
  'No pude verificar una sesión de fuerza compatible con la restricción registrada.'

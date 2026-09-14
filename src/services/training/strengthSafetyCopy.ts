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

/**
 * Copy de decline por contexto de entrenamiento, no por restricción médica.
 *
 * Existe porque la ventana competitiva, la fatiga aguda y la duración mínima de
 * un finisher retiran ejercicios sin que haya ninguna restricción registrada.
 * Reusar `BLOCKED_STRENGTH_COPY` ahí le decía a un atleta sano que su lesión
 * impedía la sesión.
 */
export const BLOCKED_STRENGTH_TRAINING_CONTEXT_COPY =
  'No pude armar esta sesión de fuerza con el trabajo de impacto o el finisher propuestos para este momento del calendario. Ajusta la duración o pídela sin ese bloque.'

/** Aviso cuando se recortó impacto o finisher sin que exista restricción alguna. */
export const STRENGTH_TRAINING_CONTEXT_TRIM_WARNING =
  'Saqué el trabajo de impacto o el finisher por el momento del calendario y la duración de la sesión, no por una restricción.'

/**
 * Copy de bloqueo por restricción sin zona identificable.
 *
 * El genérico no decía qué faltaba. Sin zona el filtro no puede elegir
 * ejercicios compatibles, y lo único que destraba la sesión es precisarla.
 */
export const BLOCKED_STRENGTH_UNRESOLVED_COPY =
  'No pude identificar la zona de la lesión o restricción, así que no incluí trabajo de fuerza. Dime qué zona es (por ejemplo: espalda baja, rodilla u hombro) o regístrala en tu perfil.'

/** Copy único por razón de bloqueo: productores y consumidores comparten módulo. */
export function blockedStrengthCopy(reason?: string): string {
  if (reason === 'training_context_unavailable') return BLOCKED_STRENGTH_TRAINING_CONTEXT_COPY
  if (reason === 'unresolved_medical_restriction') return BLOCKED_STRENGTH_UNRESOLVED_COPY
  return BLOCKED_STRENGTH_COPY
}

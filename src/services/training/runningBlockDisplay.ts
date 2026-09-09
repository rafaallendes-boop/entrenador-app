/**
 * Cómo se lee la duración de un bloque de running.
 *
 * Autoridad única: la tarjeta de sesión y el preview del picker de plantillas
 * mostraban lo mismo de dos formas distintas —«10 min» y «600 s» para el mismo
 * calentamiento—, así que ambos consumen esto.
 *
 * La regla es cómo lo dice un entrenador, no cómo está guardado: una serie de
 * 400 m se prescribe en segundos («113 s»), un rodaje continuo en minutos («10
 * min»). El corte está en 3 minutos porque cubre las recuperaciones (60-120 s)
 * y las series cortas sin arrastrar los bloques de volumen.
 */
export const RUNNING_BLOCK_SECONDS_THRESHOLD = 180

export function formatRunningBlockDuration(
  durationMin: number,
  basis?: 'total' | 'per_repetition',
): string {
  const seconds = Math.round(durationMin * 60)
  if (basis === 'per_repetition' || seconds < RUNNING_BLOCK_SECONDS_THRESHOLD) return `${seconds} s`
  // Un decimal: 7,7 min es información real; 7,6666 es ruido.
  return `${Number(durationMin.toFixed(1))} min`
}

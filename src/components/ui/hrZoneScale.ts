import { HIGH_ZONE_KEYS, HR_ZONE_KEYS, type HrZoneKey } from '../../services/readiness/workoutMetrics'

/**
 * Escala de zonas de FC. **Única autoridad de color** de la distribución: la
 * consumen la tarjeta de sesión y la del resumen semanal, que antes llevaban
 * cada una su copia y podían derivar.
 *
 * Es una rampa **secuencial de un solo tono**, no una paleta categórica. Las
 * zonas son ordinales —cambiar su orden cambia el significado—, así que el orden
 * tiene que verse en el color; un arcoíris obliga a mirar la leyenda para saber
 * cuál es «más». El tono es el de `brand` (#ff4d00, H 37° en OKLCH) y el paso
 * más alto es exactamente ese color, para que el titular «zona alta» y el tramo
 * encendido de la barra sean visiblemente lo mismo.
 *
 * Generada por cálculo, no a ojo: luminosidad OKLCH monótona 0.34 → 0.668 y
 * croma 0.028 → 0.224. La curva de croma sube despacio y salta al final, así que
 * **solo Z4 y Z5 llevan croma pleno**: lo que se ve encendido es, literalmente,
 * lo que cuenta el titular.
 *
 * Contraste contra la superficie de tarjeta (#181818): 1.49 · 1.97 · 2.62 · 3.47
 * · 4.38 · 5.34. Los tres primeros pasos quedan por debajo de 3:1 a propósito —
 * una zona en la que casi no se estuvo debe retroceder— y el alivio que eso
 * exige es la tabla de duraciones exactas del desplegable.
 */
export const HR_ZONE_RAMP: Record<HrZoneKey, string> = {
  z0: '#45332e',
  z1: '#624137',
  z2: '#834d3d',
  z3: '#a85740',
  z4: '#d35732',
  z5: '#ff4d00',
}

/** Extremos de la escala. No son nombres de zona: Whoop no publica ninguno. */
export const HR_ZONE_SCALE_ENDS = { low: 'suave', high: 'máxima' } as const

export function isHighZone(key: HrZoneKey): boolean {
  return HIGH_ZONE_KEYS.includes(key)
}

/** Reparto en porcentaje sobre el total registrado, para la tabla del desplegable. */
export function zoneShare(milli: number, total: number): string {
  if (total <= 0) return '0%'
  return `${Math.round((milli / total) * 100)}%`
}

export { HIGH_ZONE_KEYS, HR_ZONE_KEYS }
export type { HrZoneKey }

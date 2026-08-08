import {
  HIGH_ZONE_KEYS,
  HR_ZONE_KEYS,
  HR_ZONE_RAMP,
  HR_ZONE_SCALE_ENDS,
  isHighZone,
} from './hrZoneScale'
import { HR_ZONE_LABELS } from '../../services/readiness/workoutMetrics'

/**
 * Leyenda de la escala de zonas — y, a la vez, la definición de «zona alta».
 *
 * Las dos superficies titulan en «zona alta» sin que nada en la UI diga qué
 * cuenta esa cifra. El corchete bajo los dos últimos pasos lo dice una vez, en
 * el mismo lugar donde se aprende el orden del color, en vez de repartir la
 * explicación en un tooltip por tarjeta.
 *
 * Las seis zonas se rotulan `Z0`–`Z5`. No es opcional: el resumen semanal no
 * tiene desplegable, así que sin esta fila cuatro de los seis segmentos quedan
 * sin identificar — exactamente el defecto del mockup que el spec §7.3 mandó
 * corregir. `Z0`–`Z5` son los rótulos que el producto ya usa en todas partes; no
 * atribuyen a Whoop ningún nombre de zona, que es lo único que sí habría que
 * evitar inventar.
 *
 * Los extremos se etiquetan «suave» y «máxima» porque describen la dirección de
 * la rampa, que el número de zona por sí solo no comunica a quien la ve por
 * primera vez.
 */
export default function HrZoneScaleLegend({ className = '' }: { className?: string }) {
  return (
    <div className={className}>
      <div className="grid grid-cols-6 gap-[2px]" aria-hidden="true">
        {HR_ZONE_KEYS.map((key) => (
          <span
            key={key}
            className="h-1.5 rounded-[2px]"
            style={{ backgroundColor: HR_ZONE_RAMP[key] }}
          />
        ))}
      </div>

      <div className="mt-1 grid grid-cols-6 gap-[2px]" aria-hidden="true">
        {HR_ZONE_KEYS.map((key) => (
          <span
            key={key}
            className={`text-center font-mono text-[9px] leading-none ${
              isHighZone(key) ? 'text-ink-muted' : 'text-ink-faint'
            }`}
          >
            {HR_ZONE_LABELS[key]}
          </span>
        ))}
      </div>

      {/* El corchete ocupa exactamente las dos últimas columnas de la grilla, así
          que su extensión ES el umbral, no una decoración al lado del texto.

          Sin rótulos de extremo: con Z0–Z5 arriba y una rampa que va de oscuro a
          encendido, la dirección ya se lee, y poner «suave» sin su «máxima»
          dejaba la fila desbalanceada. La dirección se enuncia igual en el texto
          para lectores de pantalla, que es donde no se puede ver ni el orden de
          los números ni el de los colores. */}
      <div className="mt-1 grid grid-cols-6 gap-[2px]" aria-hidden="true">
        <span className="col-span-4" />
        <span className="col-span-2 border-t border-brand/40 pt-1 text-center font-sans text-[9px] leading-none text-ink-muted">
          zona alta
        </span>
      </div>

      <p className="sr-only">
        Escala de intensidad de {HR_ZONE_SCALE_ENDS.low} a {HR_ZONE_SCALE_ENDS.high},
        de {HR_ZONE_LABELS.z0} a {HR_ZONE_LABELS.z5}. Se cuenta como zona alta el
        tiempo en {HIGH_ZONE_KEYS.map((key) => HR_ZONE_LABELS[key]).join(' y ')}.
      </p>
    </div>
  )
}

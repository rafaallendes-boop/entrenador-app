import { describe, expect, it } from 'vitest'

import { findSquashDrillByName, SQUASH_DRILL_LIBRARY } from '../drillLibrary'

/**
 * El matcher difuso resuelve nombres libres que no están en el catálogo: texto
 * escrito a mano en una sesión, contenido de un plan viejo, salida del modelo.
 * Estas pruebas fijan que sean los **tokens con contenido** los que deciden, no
 * las preposiciones compartidas ni el orden de declaración del catálogo.
 */
describe('matcher difuso de drills de squash', () => {
  it('una consulta que empata entre varios drills no resuelve', () => {
    // "Drives paralelos con recuperación al T" empata en 0,5 con tres drills
    // distintos: los tokens que comparte no discriminan. Resolver a cualquiera
    // de ellos sería adivinar, y adivinar mal prescribe contenido equivocado en
    // silencio. La misma política la fija el validador del Week Creator, que
    // rechaza los drills que el modelo inventa comprobando que no resuelvan.
    expect(findSquashDrillByName('Drives paralelos con recuperación al T')).toBeUndefined()
    expect(findSquashDrillByName('Drives paralelos en recuperación al T')).toBeUndefined()
  })

  it('las palabras función no deciden el match cuando hay un ganador claro', () => {
    // Antes del filtro esta consulta caía en el drill de boast por compartir
    // `de`. Ahora el único candidato que queda arriba es el de drives paralelos
    // desde el fondo, que es lo que la consulta describe.
    expect(findSquashDrillByName('Drives paralelos de recuperación al fondo')?.id)
      .toBe('solo_100_parallels_back')
  })

  it('la zona que nombra la consulta manda sobre el drill genérico', () => {
    // Contraparte del caso anterior: acá la consulta sí dice "fondo", así que
    // el drill de fondo es la respuesta correcta y no un falso positivo.
    expect(findSquashDrillByName('Drives paralelos hacia el fondo')?.id)
      .toBe('solo_100_parallels_back')
  })

  it('un nombre anterior resuelve por fragmento aunque no sea exacto', () => {
    expect(findSquashDrillByName('Tiros paralelos')?.id).toBe('drive_parallel_depth')
    expect(findSquashDrillByName('Ataque en tres cuartos')?.id).toBe('pressure_three_quarters_court')
  })

  it('un texto sin relación con el catálogo no resuelve', () => {
    expect(findSquashDrillByName('Circuito experimental alfa')).toBeUndefined()
    expect(findSquashDrillByName('Secuencia libre de rebotes a la pared trasera')).toBeUndefined()
  })

  it('una consulta de solo palabras función no resuelve por vaciarse de tokens', () => {
    // El respaldo a tokens crudos existe para que estas consultas no cambien de
    // comportamiento por el filtro; siguen sin describir ningún drill.
    expect(findSquashDrillByName('de la con el')).toBeUndefined()
  })

  it('todo nombre canónico se resuelve a sí mismo', () => {
    // Guard de determinismo: si el desempate dependiera del orden de
    // declaración, agregar un drill podría desviar el nombre de otro.
    for (const drill of SQUASH_DRILL_LIBRARY) {
      expect(findSquashDrillByName(drill.name)?.id, drill.id).toBe(drill.id)
    }
  })
})

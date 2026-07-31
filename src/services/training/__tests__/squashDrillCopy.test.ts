import { describe, expect, it } from 'vitest'

import { findSquashDrillByName, SQUASH_DRILL_LIBRARY } from '../drillLibrary'

/**
 * Términos que se glosan en el primer uso, con el fragmento que prueba la
 * glosa. Spec 2026-07-31 §2.
 */
const GLOSSES: Array<{ term: string; pattern: RegExp; proof: string; exemptIds: string[] }> = [
  { term: 'boast', pattern: /\bboasts?\b/i, proof: 'pared lateral', exemptIds: [] },
  // El plural importa: `solo_100_drops` y `mid_court_drops` solo dicen "drops".
  { term: 'drop', pattern: /\bdrops?\b/i, proof: 'pared frontal', exemptIds: [] },
  { term: 'nick', pattern: /\bnicks?\b/i, proof: 'unión baja', exemptIds: [] },
  { term: 'tin', pattern: /\btin\b/i, proof: 'placa metálica', exemptIds: [] },
  { term: 'ghosting', pattern: /\bghosting\b/i, proof: 'sin pelota', exemptIds: [] },
  { term: 'split-step', pattern: /\bsplit-steps?\b/i, proof: 'salto de ajuste', exemptIds: [] },
  // La mención de `lob` en el consejo final de este drill es incidental: el
  // drill entrena el boast, y glosar los dos vuelve la descripción ilegible.
  // Exención deliberada, spec §2 "Alcance de la glosa".
  {
    term: 'lob',
    pattern: /\blobs?\b/i,
    proof: 'alta y profunda',
    exemptIds: ['attacking_boast_from_back_court'],
  },
]

describe('reglas de copy de la librería de squash', () => {
  it('ningún texto de usuario usa RSA, chapa ni game', () => {
    const offenders: string[] = []
    for (const drill of SQUASH_DRILL_LIBRARY) {
      // Única excepción de la spec §5: el nombre —no la descripción— de este
      // drill, porque está hardcodeado en cinco consumidores.
      const texts: Array<[string, string]> = [['description', drill.description]]
      if (drill.id !== 'match_sim_points_short_sets') texts.push(['name', drill.name])

      for (const [field, text] of texts) {
        if (/\bRSA\b/.test(text) || /\bchapas?\b/i.test(text) || /\bgames?\b/i.test(text)) {
          offenders.push(`${drill.id}.${field}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('la descripción del game a 11 sí cumple la regla', () => {
    const drill = SQUASH_DRILL_LIBRARY.find((item) => item.id === 'match_sim_points_short_sets')
    expect(drill?.name).toBe('Game a 11 con marcador real')
    expect(drill?.description).not.toMatch(/\bgames?\b/i)
  })

  it.each(GLOSSES)('glosa $term en el primer uso', ({ pattern, proof, exemptIds }) => {
    const missing = SQUASH_DRILL_LIBRARY
      .filter((drill) => !exemptIds.includes(drill.id))
      .filter((drill) => pattern.test(drill.description))
      .filter((drill) => !drill.description.includes(proof))
      .map((drill) => drill.id)
    expect(missing).toEqual([])
  })

  it('la T es femenino en todo texto de usuario', () => {
    const offenders = SQUASH_DRILL_LIBRARY
      .filter((drill) => /\bel T\b/.test(`${drill.name} ${drill.description}`))
      .map((drill) => drill.id)
    expect(offenders).toEqual([])
  })

  it('el tag rsa sobrevive aunque el nombre pierda la sigla', () => {
    const drill = SQUASH_DRILL_LIBRARY.find((item) => item.id === 'rsa_short_bursts')
    expect(drill?.tags).toContain('rsa')
    expect(drill?.name).not.toMatch(/\bRSA\b/)
  })

  it('cada nombre canónico resuelve a su propio drill', () => {
    // Detecta colisiones por cualquiera de los dos caminos: el mapa privado
    // DRILL_NAME_ALIASES —46 claves, consultado ANTES de la coincidencia
    // exacta— y los `aliases` nuevos de cada definición.
    const offenders = SQUASH_DRILL_LIBRARY
      .filter((drill) => findSquashDrillByName(drill.name)?.id !== drill.id)
      .map((drill) => `${drill.id} → ${findSquashDrillByName(drill.name)?.id ?? 'sin resolver'}`)
    expect(offenders).toEqual([])
  })
})

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { SQUASH_DRILL_LIBRARY } from '../drillLibrary'

const SPEC_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/superpowers/specs/2026-07-31-squash-drill-copy-design.md',
)

/**
 * Lee la tabla de §3bis. La spec es la fuente de verdad del copy aprobado;
 * duplicarlo acá crearía exactamente la deriva que este guard existe para
 * impedir.
 */
function readSpecDescriptions(): Map<string, string> {
  const spec = readFileSync(SPEC_PATH, 'utf8')
  const section = spec.split('## 3bis')[1]?.split('`match_sim_points_short_sets` aparece')[0]
  if (!section) throw new Error(`No se encontró la sección §3bis en ${SPEC_PATH}`)

  const entries = new Map<string, string>()
  for (const line of section.split('\n')) {
    if (!line.startsWith('| `')) continue
    const cells = line.split('|')
    // 4 celdas por el pipe inicial y el final. Si alguna descripción llegara a
    // contener un `|`, el parseo sería silenciosamente incorrecto.
    if (cells.length !== 4) throw new Error(`Fila mal formada en §3bis: ${line.slice(0, 60)}`)
    entries.set(cells[1]!.trim().replace(/`/g, ''), cells[2]!.trim())
  }
  return entries
}

describe('paridad de copy con la spec §3bis', () => {
  const specDescriptions = readSpecDescriptions()

  it('la spec declara exactamente 21 descripciones', () => {
    expect(specDescriptions.size).toBe(21)
  })

  it.each([...specDescriptions.entries()])(
    '%s tiene la descripción aprobada, carácter por carácter',
    (id, expected) => {
      const drill = SQUASH_DRILL_LIBRARY.find((item) => item.id === id)
      expect(drill, `la spec nombra un id inexistente: ${id}`).toBeDefined()
      expect(drill?.description).toBe(expected)
    },
  )
})

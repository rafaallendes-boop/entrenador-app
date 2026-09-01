import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : walk(path)
    return /\.tsx?$/.test(entry) ? [path] : []
  })
}

/**
 * Una etapa sólo se registra cuando se llama `end()`. Si entre `stage()` y su
 * `end()` hay un `await` sin `catch`, un fallo del proveedor no deja ninguna
 * fila: es exactamente lo que impidió atribuir el fallo intermitente del chat
 * en producción (§35). `trackStage` cierra la etapa aunque la llamada lance.
 */
describe('cierre de etapas ante fallo', () => {
  it('ninguna etapa envuelve un await sin catch ni trackStage', () => {
    const offenders: string[] = []

    // `stageLogger.ts` define `trackStage`: su propio `handle` es la
    // implementación correcta, no una infracción.
    for (const path of walk('src').filter((file) => !file.endsWith('stageLogger.ts'))) {
      const lines = readFileSync(path, 'utf8').split('\n')
      lines.forEach((line, index) => {
        const match = /const (\w+) = \w+\.stage\(/.exec(line)
        if (!match) return
        const variable = match[1]
        const endIndex = lines.findIndex(
          (candidate, position) => position > index && candidate.includes(`${variable}.end(`),
        )
        if (endIndex === -1) {
          offenders.push(`${path}:${index + 1} — ${variable} nunca se cierra`)
          return
        }
        const body = lines.slice(index + 1, endIndex).join('\n')
        // Cerrar con `ok: false` en cualquier punto del archivo demuestra que la
        // rama de fallo está contemplada, aunque el `catch` viva después del
        // `end()` del camino feliz.
        const closesOnFailure = lines.some((candidate) => (
          candidate.includes(`${variable}.end({ ok: false`)
        ))
        if (body.includes('await') && !body.includes('catch') && !closesOnFailure) {
          offenders.push(`${path}:${index + 1} — ${variable} envuelve un await sin catch`)
        }
      })
    }

    expect(offenders, `usar trackStage en: ${offenders.join(', ')}`).toEqual([])
  })
})

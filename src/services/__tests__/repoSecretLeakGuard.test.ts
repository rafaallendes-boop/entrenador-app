import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * El escaneo de secretos de Netlify falla el build si encuentra el valor de
 * `SUPABASE_URL` —o de cualquier env var marcada como secreta— en un archivo
 * del repo. Ya ocurrió una vez: un smoke pegó una traza de red completa con el
 * host del proyecto y el deploy de `main` quedó caído en la etapa de escaneo,
 * con `npm run build` perfectamente verde.
 *
 * Este guard corre sobre los archivos TRACKEADOS, que es exactamente lo que
 * Netlify hace checkout. No reemplaza al escáner: sólo atrapa el patrón que ya
 * nos costó un deploy, antes de commitear.
 */
const FORBIDDEN_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  // Host real de un proyecto Supabase. El ref tiene 20 caracteres; los
  // placeholders (`<SUPABASE_PROJECT>`, `example`) no lo alcanzan.
  ['host de proyecto Supabase', /https:\/\/[a-z0-9]{15,}\.supabase\.co/],
  // Tokens con prefijo reconocible.
  ['JWT (anon/service_role)', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
  ['clave de OpenAI', /\bsk-[A-Za-z0-9]{32,}/],
  ['clave de Google/Gemini', /\bAIza[A-Za-z0-9_-]{30,}/],
]

const TEXT_FILE = /\.(md|ts|tsx|js|mjs|cjs|json|sql|toml|yml|yaml|html|css|txt)$/
/** Un binario grande no es donde alguien pega una traza a mano. */
const MAX_BYTES = 2_000_000

function trackedTextFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return output.split('\0').filter((path) => path && TEXT_FILE.test(path))
}

describe('ningún archivo trackeado filtra un secreto de producción', () => {
  it('no contiene hosts ni tokens que el escaneo de Netlify rechaza', () => {
    const offenders: string[] = []

    for (const path of trackedTextFiles()) {
      // Este propio archivo declara los patrones; excluirlo evita el falso
      // positivo trivial sin debilitar el guard para el resto del repo.
      if (path.endsWith('repoSecretLeakGuard.test.ts')) continue
      let content: string
      try {
        if (statSync(path).size > MAX_BYTES) continue
        content = readFileSync(path, 'utf8')
      } catch {
        continue
      }
      for (const [label, pattern] of FORBIDDEN_PATTERNS) {
        const line = content.split('\n').findIndex((candidate) => pattern.test(candidate))
        // Se reporta la ubicación, nunca el valor: un mensaje de test viaja a
        // logs de CI y no debe reimprimir lo que se está tratando de proteger.
        if (line !== -1) offenders.push(`${path}:${line + 1} — ${label}`)
      }
    }

    expect(offenders, `redactar antes de commitear: ${offenders.join(', ')}`).toEqual([])
  })

  // Un guard que no recorre nada pasa siempre. Estas dos aserciones fijan que
  // el recorrido ve el repo real y que los patrones reconocen el caso que ya
  // tumbó un deploy, sin escribir un valor real en el árbol.
  it('el recorrido y los patrones no son vacuos', () => {
    const files = trackedTextFiles()
    expect(files.length).toBeGreaterThan(500)
    expect(files).toContain('src/services/chatRouting.ts')

    const samples = [
      'POST https://abcdefghijklmnopqrst.supabase.co/rest/v1/week_summaries → 400',
      'apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlhdCI6MH0',
      `sk-${'A1b2C3d4'.repeat(4)}`,
      `AIza${'B2c3D4e5'.repeat(4)}`,
    ]
    samples.forEach((sample, index) => {
      expect(FORBIDDEN_PATTERNS[index]![1].test(sample)).toBe(true)
    })

    // Y no dispara sobre los placeholders que sí deben poder escribirse.
    for (const [, pattern] of FORBIDDEN_PATTERNS) {
      expect(pattern.test('https://<SUPABASE_PROJECT>.supabase.co/rest/v1/week_summaries')).toBe(false)
    }
  })
})

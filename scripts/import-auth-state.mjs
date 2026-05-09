/**
 * Importa el estado de auth desde el clipboard/stdin y genera el archivo
 * .e2e-auth-state.json que usa el test E2E.
 *
 * Uso: node scripts/import-auth-state.mjs
 */

import { createInterface } from 'readline'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { chromium } from 'playwright'

const __dirname = dirname(fileURLToPath(import.meta.url))
const AUTH_STATE_PATH = resolve(__dirname, '.e2e-auth-state.json')
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

const rl = createInterface({ input: process.stdin, output: process.stdout })

console.log('\nPegá el JSON que copiaste del browser (y presiona Enter + Ctrl+D cuando termines):\n')

let input = ''
rl.on('line', (line) => { input += line + '\n' })

rl.on('close', async () => {
  let parsed
  try {
    // Limpiar si viene con markers
    const cleaned = input
      .replace(/AUTH_STATE_START\n?/, '')
      .replace(/AUTH_STATE_END\n?/, '')
      .trim()
    parsed = JSON.parse(cleaned)
  } catch {
    console.error('❌ JSON inválido. Asegurate de copiar solo el JSON del console.')
    process.exit(1)
  }

  console.log('\n⏳ Creando contexto de Playwright con tu sesión...')

  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()

    // Ir a la app para que el dominio esté activo
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15_000 })

    // Inyectar localStorage
    if (parsed.localStorage) {
      await page.evaluate((ls) => {
        for (const [key, value] of Object.entries(ls)) {
          try { localStorage.setItem(key, value) } catch {}
        }
      }, parsed.localStorage)
      console.log(`✅ ${Object.keys(parsed.localStorage).length} entradas de localStorage inyectadas`)
    }

    // Inyectar cookies de sesión de Supabase (si hay)
    const supabaseKeys = Object.keys(parsed.localStorage || {}).filter(k =>
      k.includes('supabase') || k.includes('sb-')
    )
    console.log(`   Claves de Supabase encontradas: ${supabaseKeys.length > 0 ? supabaseKeys.join(', ') : 'ninguna'}`)

    // Guardar el estado
    await context.storageState({ path: AUTH_STATE_PATH })
  } finally {
    await browser.close()
  }

  console.log(`\n✅ Sesión guardada en ${AUTH_STATE_PATH}`)
  console.log('   Ahora puedes correr: npm run e2e:dev\n')
})

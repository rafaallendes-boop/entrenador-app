#!/usr/bin/env node
/**
 * E2E dev suite for Entrenador.
 *
 * Default mode is non-destructive: it verifies proposals open, but does not
 * apply them. Use --apply when you intentionally want to mutate local/dev data.
 *
 * Usage:
 *   npm run dev
 *   npm run e2e:dev:headed  # first run, log in manually if needed
 *   npm run e2e:dev
 *   npm run e2e:dev:quick
 *   npm run e2e:dev:apply
 *   npm run e2e:dev:quality
 */

import { chromium } from 'playwright'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const AUTH_STATE_PATH = resolve(__dirname, '.e2e-auth-state.json')
const ARTIFACT_DIR = resolve(__dirname, 'e2e-artifacts')
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

const args = new Set(process.argv.slice(2))
const OPTIONS = {
  apply: args.has('--apply'),
  headed: args.has('--headed'),
  skipWeek: args.has('--skip-week'),
  quick: args.has('--quick'),
  exportQuality: args.has('--export-quality'),
  debug: args.has('--debug'),
}
if (OPTIONS.quick) OPTIONS.skipWeek = true

const TIMEOUTS = {
  navigation: 20_000,
  auth: 180_000,
  chatResponse: 90_000,
  proposalAppear: 60_000,
  weekGeneration: 120_000,
}

let passed = 0
let failed = 0
const results = []
const browserEvents = []

function log(message) {
  console.log(`  ${message}`)
}

function step(name) {
  console.log(`\n▶ ${name}`)
}

function ok(name, detail = '') {
  passed += 1
  results.push({ status: 'PASS', name, detail })
  console.log(`  ✅ PASS: ${name}${detail ? ` — ${detail}` : ''}`)
}

function fail(name, detail = '') {
  failed += 1
  results.push({ status: 'FAIL', name, detail })
  console.log(`  ❌ FAIL: ${name}${detail ? ` — ${detail}` : ''}`)
}

async function safeCheck(name, fn) {
  try {
    await fn()
  } catch (error) {
    fail(name, error instanceof Error ? error.message : String(error))
  }
}

function chatInput(page) {
  return page.locator('textarea[placeholder="Escríbele al coach..."]').first()
}

async function goto(page, path) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.navigation })
  await assertNoRouteCrash(page, path)
}

async function assertNoRouteCrash(page, path) {
  const body = await page.locator('body').innerText({ timeout: 10_000 })
  if (body.includes('No se pudo cargar esta vista')) {
    throw new Error(`Route boundary rendered on ${path}`)
  }
}

async function waitForChatReady(page, timeout = 30_000) {
  const input = chatInput(page)
  await input.waitFor({ state: 'visible', timeout })
  await page.waitForFunction(() => {
    const textarea = document.querySelector('textarea[placeholder="Escríbele al coach..."]')
    return textarea instanceof HTMLTextAreaElement && !textarea.disabled
  }, { timeout })
}

async function sendChatMessage(page, message, timeout = TIMEOUTS.chatResponse) {
  await waitForChatReady(page)
  const beforeText = await page.locator('main').innerText().catch(() => '')
  const input = chatInput(page)
  await input.fill(message)
  await input.press('Enter')
  log(`Mensaje enviado: "${message}"`)

  await page.waitForFunction(() => {
    const textarea = document.querySelector('textarea[placeholder="Escríbele al coach..."]')
    return textarea instanceof HTMLTextAreaElement && textarea.disabled
  }, { timeout: 10_000 }).catch(() => undefined)

  await waitForChatReady(page, timeout)
  await page.waitForTimeout(900)

  const afterText = await page.locator('main').innerText().catch(() => '')
  return { beforeText, afterText }
}

async function findLatestProposalButton(page, timeout = TIMEOUTS.proposalAppear) {
  const button = page.getByRole('button', { name: /ver propuesta/i }).last()
  await button.waitFor({ state: 'visible', timeout })
  return button
}

async function openLatestProposal(page) {
  const button = await findLatestProposalButton(page)
  await button.click()
  await page.getByText(/Propuesta del coach|Semana propuesta/i).waitFor({ state: 'visible', timeout: 10_000 })
  ok('Drawer de propuesta abierto')
}

async function closeProposalDrawer(page) {
  const drawerTitle = page.getByText(/Propuesta del coach|Semana propuesta/i).first()
  if (!(await drawerTitle.isVisible().catch(() => false))) return

  const drawer = drawerTitle.locator('xpath=ancestor::div[contains(@class,"relative")][1]')
  const closeButton = drawer.getByRole('button').first()
  await closeButton.click().catch(() => undefined)

  if (await drawerTitle.isVisible().catch(() => false)) {
    fail('Drawer de propuesta no se cerró')
  }
}

async function rateVisibleCoachResponse(page) {
  const usefulButton = page.getByTitle('Respuesta útil').last()
  if (await usefulButton.isVisible().catch(() => false)) {
    await usefulButton.click()
    ok('Feedback en respuesta del coach registrado')
  } else {
    fail('No se encontró botón de feedback en respuesta del coach')
  }
}

async function verifySettingsQuality(page) {
  await goto(page, '/settings')
  const body = await page.locator('body').innerText()
  if (body.includes('Beta quality local') && body.includes('Debug IA')) {
    ok('Settings muestra panel Beta Quality')
  } else {
    fail('Settings no muestra panel Beta Quality')
  }

  if (/chat_(general|action)|week_creator|plan_builder/.test(body)) {
    ok('Settings muestra trazas de requestClass')
  } else {
    fail('Settings no muestra requestClass en trazas')
  }

  if (body.includes('El coach no está configurado correctamente') || body.includes('misconfigured')) {
    fail('Settings muestra error de configuración del coach')
  } else {
    ok('Settings sin error de configuración visible')
  }
}

async function exportBetaQualityIfRequested(page) {
  if (!OPTIONS.exportQuality) return
  step('Export Beta Quality JSON')
  await goto(page, '/settings')
  const betaQualityTitle = page.getByText('Beta quality local').first()
  await betaQualityTitle.waitFor({ state: 'visible', timeout: 10_000 })
  const betaQualityPanel = betaQualityTitle.locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
  const exportButton = betaQualityPanel.getByRole('button', { name: /exportar/i })
  const downloadPromise = page.waitForEvent('download', { timeout: 15_000 })
  await exportButton.click()
  const download = await downloadPromise
  ok('Export Beta Quality descarga JSON', download.suggestedFilename())
}

async function verifyAuth(page, context, hasStoredAuth) {
  step('2. Autenticación')
  await goto(page, '/chat')
  await page.waitForTimeout(1_000)

  const hasChat = await chatInput(page).isVisible().catch(() => false)
  if (hasChat) {
    ok('Usuario autenticado y chat accesible', page.url())
    return
  }

  if (!OPTIONS.headed && hasStoredAuth) {
    fail('Auth state guardado no autenticó la sesión', 'Regenera scripts/.e2e-auth-state.json')
    throw new Error('Auth state inválido')
  }

  console.log('\n  ⚠️  No hay sesión activa. Inicia sesión en el navegador abierto.')
  console.log('  El test continuará cuando la app salga de login/onboarding.\n')

  await page.waitForFunction(() => {
    return document.querySelector('textarea[placeholder="Escríbele al coach..."]') != null
  }, { timeout: TIMEOUTS.auth })

  await context.storageState({ path: AUTH_STATE_PATH })
  ok('Login manual completado y storageState guardado')
}

async function runNavigationSmoke(page) {
  step('3. Navegación base')
  const routes = [
    ['Dashboard', '/'],
    ['Semana', '/week'],
    ['Chat', '/chat'],
    ['Ajustes', '/settings'],
  ]

  for (const [name, path] of routes) {
    await safeCheck(`Ruta ${name} carga`, async () => {
      await goto(page, path)
      ok(`Ruta ${name} carga`)
    })
  }
}

async function runGenericChat(page) {
  step('4. Chat general')
  await goto(page, '/chat')
  const { beforeText, afterText } = await sendChatMessage(page, 'E2E dev: dime en 2 frases como ves mi semana actual.')
  if (afterText.length > beforeText.length + 80) {
    ok('Coach respondió al mensaje general')
  } else {
    fail('Respuesta general ausente o demasiado corta')
  }
  await rateVisibleCoachResponse(page)
}

async function runActionProposal(page) {
  step('5. Chat action → propuesta')
  await goto(page, '/chat')
  await sendChatMessage(page, 'E2E dev: agrega una sesión de movilidad suave para mañana PM, 25 minutos, RPE 2.')
  await openLatestProposal(page)

  const drawerText = await page.locator('body').innerText()
  if (drawerText.includes('Movilidad') || drawerText.includes('movilidad') || drawerText.includes('25')) {
    ok('Drawer muestra contenido coherente para la propuesta')
  } else {
    fail('Drawer no muestra contenido esperado de movilidad')
  }

  const proposalUseful = page.getByTitle('Propuesta útil').first()
  if (await proposalUseful.isVisible().catch(() => false)) {
    await proposalUseful.click()
    ok('Feedback en propuesta registrado')
  }

  if (OPTIONS.apply) {
    await page.getByRole('button', { name: /aplicar cambios/i }).click()
    await page.waitForTimeout(2_000)
    ok('Propuesta aplicada en modo --apply')
  } else {
    ok('Propuesta revisada sin aplicar', 'usa --apply para probar aceptación')
    await closeProposalDrawer(page)
  }
}

async function runWeekCreator(page) {
  if (OPTIONS.skipWeek) {
    step('6. Week creator')
    ok('Week creator omitido por flag', '--skip-week/--quick')
    return
  }

  step('6. Week creator → propuesta semanal')
  await goto(page, '/chat')
  await sendChatMessage(
    page,
    'E2E dev: créame una próxima semana razonable de entrenamiento, con sesiones claras y sin sobrecargar.',
    TIMEOUTS.weekGeneration,
  )
  await openLatestProposal(page)

  const body = await page.locator('body').innerText()
  const hasWeekShape =
    body.includes('Semana propuesta') ||
    body.includes('Crear semana') ||
    /squash|running|fuerza|movilidad|sesiones/i.test(body)

  if (hasWeekShape) {
    ok('Propuesta semanal contiene sesiones')
  } else {
    fail('Propuesta semanal no muestra estructura esperada')
  }

  if (OPTIONS.apply) {
    await page.getByRole('button', { name: /aplicar cambios/i }).click()
    await page.waitForTimeout(4_000)
    ok('Semana aplicada en modo --apply')
  } else {
    ok('Semana generada sin aplicar', 'usa --apply para probar commit de semana')
    await closeProposalDrawer(page)
  }
}

async function runWeeklyViewVerification(page) {
  step('7. WeeklyView')
  await goto(page, '/week')
  const body = await page.locator('body').innerText()
  if (/lunes|martes|miércoles|jueves|viernes|sábado|domingo|sesión|squash|running|fuerza|movilidad/i.test(body)) {
    ok('WeeklyView muestra estructura semanal')
  } else {
    fail('WeeklyView no muestra estructura semanal reconocible')
  }
}

async function saveFailureArtifacts(page) {
  if (failed === 0) return
  mkdirSync(ARTIFACT_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const screenshotPath = resolve(ARTIFACT_DIR, `failure-${stamp}.png`)
  const htmlPath = resolve(ARTIFACT_DIR, `failure-${stamp}.html`)
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined)
  const html = await page.content().catch(() => '')
  writeFileSync(htmlPath, html)
  log(`Artifacts: ${screenshotPath}`)
  log(`Artifacts: ${htmlPath}`)
}

function printSummary() {
  const total = passed + failed
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  Resultado: ${passed}/${total} checks pasaron`)
  console.log(`  Modo: ${OPTIONS.apply ? 'apply' : 'review-only'} · ${OPTIONS.skipWeek ? 'sin week_creator' : 'con week_creator'}`)

  if (browserEvents.length > 0 && OPTIONS.debug) {
    console.log('\n  Browser events:')
    browserEvents.slice(-12).forEach((event) => console.log(`    ${event}`))
  }

  if (failed > 0) {
    console.log('\n  Fallos:')
    results.filter((result) => result.status === 'FAIL').forEach((result) => {
      console.log(`    ❌ ${result.name}${result.detail ? `: ${result.detail}` : ''}`)
    })
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  E2E Dev Suite — Entrenador App')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  Base URL: ${BASE_URL}`)
  console.log(`  Auth state: ${existsSync(AUTH_STATE_PATH) ? AUTH_STATE_PATH : 'no guardado'}`)
  console.log(`  Flags: ${[...args].join(' ') || 'default'}\n`)

  const hasStoredAuth = existsSync(AUTH_STATE_PATH)
  const headed = OPTIONS.headed || !hasStoredAuth
  const browser = await chromium.launch({ headless: !headed })
  const context = await browser.newContext({
    storageState: hasStoredAuth ? AUTH_STATE_PATH : undefined,
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  })

  const page = await context.newPage()
  page.setDefaultTimeout(15_000)
  page.on('pageerror', (error) => browserEvents.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') browserEvents.push(`console.error: ${message.text()}`)
  })

  try {
    step('1. Carga de la app')
    await goto(page, '/')
    const title = await page.title()
    if (/Entrenador/i.test(title)) ok('App cargó correctamente', title)
    else fail('Título inesperado', title)

    await verifyAuth(page, context, hasStoredAuth)
    await runNavigationSmoke(page)
    await runGenericChat(page)
    await runActionProposal(page)
    await runWeekCreator(page)
    await runWeeklyViewVerification(page)
    await verifySettingsQuality(page)
    await exportBetaQualityIfRequested(page)
  } finally {
    await saveFailureArtifacts(page)
    await browser.close()
    printSummary()
  }

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error('Error fatal:', error)
  process.exit(1)
})

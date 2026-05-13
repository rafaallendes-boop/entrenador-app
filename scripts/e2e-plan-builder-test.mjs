#!/usr/bin/env node
/**
 * E2E dev suite for Plan Builder.
 *
 * Default mode is non-destructive: it walks the wizard to the summary and
 * verifies existing builder/dashboard surfaces without saving a new plan.
 *
 * Usage:
 *   npm run dev
 *   npm run e2e:plan:headed
 *   npm run e2e:plan
 *   npm run e2e:plan:generate
 *   npm run e2e:plan:accept
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
  generate: args.has('--generate') || args.has('--accept'),
  accept: args.has('--accept'),
  headed: args.has('--headed'),
  debug: args.has('--debug'),
}

const TIMEOUTS = {
  navigation: 20_000,
  routeReady: 45_000,
  auth: 180_000,
  generation: 10 * 60_000,
  save: 60_000,
}

let passed = 0
let failed = 0
const results = []
const browserEvents = []

function step(name) {
  console.log(`\n▶ ${name}`)
}

function log(message) {
  console.log(`  ${message}`)
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

async function getBodyText(page) {
  return (await page.locator('body').textContent({ timeout: 10_000 }).catch(() => '')) ?? ''
}

async function waitForBodyText(page, pattern, timeout = TIMEOUTS.routeReady) {
  await page.waitForFunction(
    ({ source, flags }) => {
      const bodyText = document.body.textContent ?? ''
      return new RegExp(source, flags).test(bodyText)
    },
    { source: pattern.source, flags: pattern.flags },
    { timeout },
  )
}

async function goto(page, path) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.navigation })
  const body = await getBodyText(page)
  if (body.includes('No se pudo cargar esta vista')) {
    throw new Error(`Route boundary rendered on ${path}`)
  }
}

async function verifyAuth(page, context, hasStoredAuth) {
  step('2. Autenticación')
  await goto(page, '/chat')

  const chatVisible = await chatInput(page)
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true)
    .catch(() => false)

  if (chatVisible) {
    ok('Usuario autenticado y chat accesible', page.url())
    return
  }

  if (!OPTIONS.headed && hasStoredAuth) {
    fail('Auth state guardado no autenticó la sesión', 'Regenera scripts/.e2e-auth-state.json con una corrida headed')
    throw new Error('Auth state inválido')
  }

  console.log('\n  ⚠️  No hay sesión activa. Inicia sesión en el navegador abierto.')
  console.log('  El test continuará cuando el chat esté accesible.\n')

  await page.waitForFunction(() => {
    return document.querySelector('textarea[placeholder="Escríbele al coach..."]') != null
  }, undefined, { timeout: TIMEOUTS.auth })

  await context.storageState({ path: AUTH_STATE_PATH })
  ok('Login manual completado y storageState guardado')
}

function futureDateISO(weeksAhead = 5) {
  const date = new Date()
  date.setUTCHours(12, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() + weeksAhead * 7)
  return date.toISOString().slice(0, 10)
}

async function clickButton(page, name, timeout = 15_000) {
  const button = page.getByRole('button', { name }).first()
  await button.waitFor({ state: 'visible', timeout })
  await button.click()
}

async function maybeClickButton(page, name) {
  const button = page.getByRole('button', { name }).first()
  if (await button.isVisible().catch(() => false)) {
    await button.click()
    return true
  }
  return false
}

async function runRouteSmoke(page) {
  step('3. Rutas Plan Builder')

  await safeCheck('Ruta legacy /plan-builder redirige o carga builder', async () => {
    await goto(page, '/plan-builder')
    await waitForBodyText(page, /Plan Builder|Necesitás completar|Necesitas completar/i)
    if (page.url().includes('/plans/builder')) ok('Legacy redirect hacia builder')
    else ok('Legacy route carga sin crash', page.url())
  })

  await safeCheck('Ruta /competition-plan carga', async () => {
    await goto(page, '/competition-plan')
    await waitForBodyText(page, /Plan de competencia|Tu plan|Qué tipo de evento|Que tipo de evento/i)
    ok('Competition Plan carga')
  })
}

async function openWizardForReview(page) {
  await goto(page, '/competition-plan')
  await waitForBodyText(page, /Plan de competencia|Tu plan|Qué tipo de evento|Que tipo de evento/i)
  const body = await getBodyText(page)

  if (/Tu plan/i.test(body) && await page.getByRole('button', { name: /editar/i }).first().isVisible().catch(() => false)) {
    ok('Dashboard de plan existente carga')
    await clickButton(page, /editar/i)
    await waitForBodyText(page, /Qué tipo de evento|Que tipo de evento/i)
    ok('Wizard editable abre desde dashboard')
    return { hadExistingPlan: true }
  }

  ok('Wizard de competencia disponible')
  return { hadExistingPlan: false }
}

async function runWizardToSummary(page) {
  step('4. Wizard de competencia')
  const { hadExistingPlan } = await openWizardForReview(page)
  const eventTitle = `E2E Plan Builder ${new Date().toISOString().slice(0, 16)}`
  const eventDate = futureDateISO(5)

  await clickButton(page, /Torneo de squash/i)
  await page.locator('input[placeholder^="Ej:"]').fill(eventTitle)
  await clickButton(page, /continuar/i)
  await waitForBodyText(page, /Cuándo es el evento|Cuando es el evento/i)
  ok('Paso 1 completo', eventTitle)

  await page.locator('input[type="date"]').fill(eventDate)
  await waitForBodyText(page, /semana|Fases estimadas/i)
  await clickButton(page, /continuar/i)
  await waitForBodyText(page, /Qué quieres lograr|Que quieres lograr/i)
  ok('Paso 2 completo', eventDate)

  await clickButton(page, /Rendir al máximo/i)
  await clickButton(page, /Jugador Intermedio|Competitivo amateur/i)
  await clickButton(page, /continuar/i)
  await waitForBodyText(page, /Cuándo y cuánto|Cuando y cuanto/i)
  ok('Paso 3 completo')

  await clickButton(page, /^L-V$/i)
  await clickButton(page, /^5$/)
  await clickButton(page, /1 hora/i)
  await clickButton(page, /continuar/i)
  await waitForBodyText(page, /deportes complementarios/i)
  ok('Paso 4 completo')

  await maybeClickButton(page, /^Running$/i)
  await maybeClickButton(page, /^Fuerza$/i)
  await maybeClickButton(page, /^Movilidad$/i)
  await clickButton(page, /continuar/i)
  await waitForBodyText(page, /Cómo estás ahora|Como estas ahora/i)
  ok('Paso 5 completo')

  await clickButton(page, /Normal, base sólida|Normal, base solida/i)
  await clickButton(page, /^Normal$/i)
  await page.locator('textarea[placeholder^="Ej: molestia"]').fill('E2E: sin molestias relevantes, validar plan conservador.')
  await clickButton(page, /continuar/i)
  await waitForBodyText(page, /Tu plan de competencia/i)
  ok('Paso 6 completo')

  const summary = await getBodyText(page)
  if (summary.includes(eventTitle) && /Squash|5|1 hora|Jugador Intermedio|Competitivo amateur/i.test(summary)) {
    ok('Resumen del wizard coherente')
  } else {
    fail('Resumen del wizard no refleja datos esperados', summary.slice(0, 220).replace(/\s+/g, ' '))
  }

  if (!OPTIONS.generate) {
    ok('Wizard revisado sin guardar', hadExistingPlan ? 'plan existente no modificado' : 'sin persistir nuevo plan')
    return { eventTitle, eventDate, generated: false }
  }

  await clickButton(page, /Generar mi plan/i, TIMEOUTS.save)
  await page.waitForURL(/\/plans\/builder/, { timeout: TIMEOUTS.save })
  await waitForBodyText(page, /Plan Builder|Preparando el plan|Initialize Protocol|Semanas/i, TIMEOUTS.save)
  ok('Wizard guardó y abrió Plan Builder')
  return { eventTitle, eventDate, generated: true }
}

async function runBuilderSmoke(page, generatedThisRun) {
  step('5. Builder shell / dashboard')
  await goto(page, '/plans/builder')
  await waitForBodyText(page, /Plan Builder|Necesitás completar|Necesitas completar|Initialize Protocol|Semana|Sem /i)
  const body = await getBodyText(page)

  if (/Necesitás completar|Necesitas completar/i.test(body)) {
    if (generatedThisRun) {
      fail('Builder pide wizard después de generar', body.slice(0, 220).replace(/\s+/g, ' '))
    } else {
      ok('Builder bloquea correctamente si no hay wizard guardado')
    }
    return { canGenerate: false }
  }

  if (/Initialize Protocol|Preparando el plan|Semana|Sem |Validación|Validacion/i.test(body)) {
    ok('Builder carga shell o semanas generadas')
  } else {
    fail('Builder no muestra shell reconocible', body.slice(0, 220).replace(/\s+/g, ' '))
  }

  if (/Plan Builder/i.test(body)) ok('Header Plan Builder visible')
  else fail('Header Plan Builder no visible')

  return { canGenerate: true }
}

async function initializeAndWaitForGeneration(page) {
  if (!OPTIONS.generate) return
  step('6. Generación de semanas')

  const initializeClicked = await maybeClickButton(page, /Initialize Protocol/i)
  if (initializeClicked) ok('Initialize Protocol ejecutado')
  else ok('Plan Builder ya estaba inicializado')

  await page.waitForFunction(
    () => {
      const body = document.body.textContent ?? ''
      return /Aceptar plan|Plan aceptado|La generación no produjo|Error técnico|Reintentar completo|Regenerar fallidas/i.test(body)
    },
    undefined,
    { timeout: TIMEOUTS.generation },
  )

  const body = await getBodyText(page)
  if (/La generación no produjo|Error técnico/i.test(body)) {
    fail('Generación terminó en error', body.slice(0, 260).replace(/\s+/g, ' '))
    return
  }

  if (/Aceptar plan|Plan aceptado/i.test(body)) {
    ok('Generación completó plan aceptable')
  } else if (/Reintentar completo|Regenerar fallidas/i.test(body)) {
    fail('Generación quedó parcial o con semanas fallidas', body.slice(0, 260).replace(/\s+/g, ' '))
  } else {
    fail('Estado final de generación no reconocido', body.slice(0, 260).replace(/\s+/g, ' '))
  }
}

async function verifyGeneratedPlanShape(page) {
  if (!OPTIONS.generate) return
  step('7. Validación de plan generado')
  const body = await getBodyText(page)

  if (/Semana 1|Sem 1/i.test(body)) ok('Plan muestra semanas')
  else fail('Plan no muestra semanas')

  if (/Validación|Validacion|Sin alertas|alertas/i.test(body)) ok('Panel de validación visible')
  else fail('Panel de validación no visible')

  if (/squash|running|fuerza|movilidad|strength|mobility/i.test(body)) ok('Plan contiene sesiones deportivas')
  else fail('Plan no muestra sesiones deportivas reconocibles')

  if (/min/i.test(body)) ok('Sesiones muestran duración')
  else fail('Sesiones no muestran duración')
}

async function acceptGeneratedPlan(page) {
  if (!OPTIONS.accept) return
  step('8. Aceptar plan')
  await clickButton(page, /Aceptar plan/i, 30_000)
  await page.waitForURL(/\/week/, { timeout: TIMEOUTS.save })
  await waitForBodyText(page, /Semana|Weekly planner|sesión|sesiones|Día libre|Dia libre/i, TIMEOUTS.routeReady)
  ok('Plan aceptado y redirigido a WeeklyView')
}

async function verifySettingsTelemetry(page) {
  step(OPTIONS.generate ? '9. Telemetría Plan Builder' : '6. Telemetría Plan Builder')
  await goto(page, '/settings')
  await waitForBodyText(page, /Ajustes|Configuracion local|Configuración local/i)
  const body = await getBodyText(page)

  if (OPTIONS.generate) {
    if (/plan_builder_week|plan_builder_pair/i.test(body)) ok('Settings registra requestClass de Plan Builder')
    else fail('Settings no registra requestClass de Plan Builder', body.slice(0, 220).replace(/\s+/g, ' '))
  } else if (/Debug IA|Beta quality local/i.test(body)) {
    ok('Settings muestra panel de debug IA')
  } else {
    fail('Settings no muestra panel de debug IA', body.slice(0, 220).replace(/\s+/g, ' '))
  }
}

async function saveFailureArtifacts(page) {
  if (failed === 0) return
  mkdirSync(ARTIFACT_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const screenshotPath = resolve(ARTIFACT_DIR, `plan-builder-failure-${stamp}.png`)
  const htmlPath = resolve(ARTIFACT_DIR, `plan-builder-failure-${stamp}.html`)
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
  console.log(`  Modo: ${OPTIONS.accept ? 'generate+accept' : OPTIONS.generate ? 'generate' : 'review-only'}`)

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
  console.log('  E2E Plan Builder Suite — Entrenador App')
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
    await runRouteSmoke(page)
    const wizardResult = await runWizardToSummary(page)
    const builderResult = await runBuilderSmoke(page, wizardResult.generated)
    if (builderResult.canGenerate) {
      await initializeAndWaitForGeneration(page)
      await verifyGeneratedPlanShape(page)
      await acceptGeneratedPlan(page)
    }
    await verifySettingsTelemetry(page)
  } catch (error) {
    fail('Error fatal del runner', error instanceof Error ? error.message : String(error))
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

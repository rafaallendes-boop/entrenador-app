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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
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
  routeReady: 45_000,
  auth: 180_000,
  chatResponse: 90_000,
  proposalAppear: 60_000,
  weekGeneration: 120_000,
}

let passed = 0
let failed = 0
const results = []
const browserEvents = []

function getStoredAuthInfo() {
  if (!existsSync(AUTH_STATE_PATH)) return { exists: false }

  try {
    const storageState = JSON.parse(readFileSync(AUTH_STATE_PATH, 'utf8'))
    const origins = Array.isArray(storageState.origins) ? storageState.origins : []
    for (const origin of origins) {
      const localStorage = Array.isArray(origin.localStorage) ? origin.localStorage : []
      for (const item of localStorage) {
        if (typeof item?.value !== 'string' || !item.value.includes('expires_at')) continue

        const parsed = JSON.parse(item.value)
        const session = parsed.currentSession ?? parsed.session ?? parsed
        if (!session?.access_token || typeof session.expires_at !== 'number') continue

        const expiresAtMs = session.expires_at * 1000
        return {
          exists: true,
          expiresAtMs,
          expiresAtIso: new Date(expiresAtMs).toISOString(),
          expired: expiresAtMs <= Date.now(),
        }
      }
    }
  } catch (error) {
    return {
      exists: true,
      parseError: error instanceof Error ? error.message : String(error),
    }
  }

  return { exists: true }
}

function formatAuthRecoveryDetail(authInfo) {
  if (authInfo.expired && authInfo.expiresAtIso) {
    return `Expiró ${authInfo.expiresAtIso}; corre npm run e2e:dev:headed`
  }
  if (authInfo.parseError) {
    return `No se pudo leer auth state (${authInfo.parseError}); corre npm run e2e:dev:headed`
  }
  return 'Regenera scripts/.e2e-auth-state.json con npm run e2e:dev:headed'
}

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
  const body = await getBodyText(page)
  if (body.includes('No se pudo cargar esta vista')) {
    throw new Error(`Route boundary rendered on ${path}`)
  }
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

async function hasBodyTextAfterWait(page, pattern, timeout = 15_000) {
  try {
    await waitForBodyText(page, pattern, timeout)
    return true
  } catch {
    return false
  }
}

async function waitForChatReady(page, timeout = 30_000) {
  const input = chatInput(page)
  await input.waitFor({ state: 'visible', timeout })
  await page.waitForFunction(() => {
    const textarea = document.querySelector('textarea[placeholder="Escríbele al coach..."]')
    return textarea instanceof HTMLTextAreaElement && !textarea.disabled
  }, undefined, { timeout })
}

async function sendChatMessage(page, message, timeout = TIMEOUTS.chatResponse) {
  await waitForChatReady(page)
  const beforeText = await page.locator('main').innerText().catch(() => '')
  const beforeUsefulCount = await page.getByTitle('Respuesta útil').count().catch(() => 0)
  const input = chatInput(page)
  await input.fill(message)
  await input.press('Enter')
  log(`Mensaje enviado: "${message}"`)

  await page.waitForFunction(() => {
    const textarea = document.querySelector('textarea[placeholder="Escríbele al coach..."]')
    return textarea instanceof HTMLTextAreaElement && textarea.disabled
  }, undefined, { timeout: 10_000 }).catch(() => undefined)

  await waitForChatReady(page, timeout)
  await page.waitForTimeout(900)

  const afterText = await page.locator('main').textContent().catch(() => '') ?? ''
  const afterUsefulCount = await page.getByTitle('Respuesta útil').count().catch(() => 0)
  return { beforeText, afterText, beforeUsefulCount, afterUsefulCount }
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
  await waitForBodyText(page, /Ajustes|Configuracion local|Configuración local/i)
  const hasBetaPanel = await hasBodyTextAfterWait(page, /Beta quality local|Debug IA/i)
  const body = await getBodyText(page)
  if (hasBetaPanel && body.includes('Beta quality local') && body.includes('Debug IA')) {
    ok('Settings muestra panel Beta Quality')
  } else {
    fail('Settings no muestra panel Beta Quality', body.slice(0, 180).replace(/\s+/g, ' '))
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

async function verifyAuth(page, context, authInfo) {
  step('2. Autenticación')
  await goto(page, '/chat')
  await page.waitForTimeout(1_000)

  const hasChat = await chatInput(page).isVisible().catch(() => false)
  if (hasChat) {
    ok('Usuario autenticado y chat accesible', page.url())
    return
  }

  if (!OPTIONS.headed && authInfo.exists) {
    fail('Auth state guardado no autenticó la sesión', formatAuthRecoveryDetail(authInfo))
    throw new Error('Auth state inválido')
  }

  console.log('\n  ⚠️  No hay sesión activa. Inicia sesión en el navegador abierto.')
  console.log('  El test continuará cuando la app salga de login/onboarding.\n')

  await page.waitForFunction(() => {
    return document.querySelector('textarea[placeholder="Escríbele al coach..."]') != null
  }, undefined, { timeout: TIMEOUTS.auth })

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
  const { beforeText, afterText, beforeUsefulCount, afterUsefulCount } = await sendChatMessage(
    page,
    'E2E dev: dime en 2 frases como ves mi semana actual.',
  )
  const hasNewCoachResponse = afterUsefulCount > beforeUsefulCount
  const hasSubstantialTextChange = afterText.length > beforeText.length + 80
  if (hasNewCoachResponse || hasSubstantialTextChange) {
    ok('Coach respondió al mensaje general')
  } else {
    fail('Respuesta general ausente', `delta texto: ${afterText.length - beforeText.length}`)
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
  await waitForBodyText(page, /Semana|Weekly planner|Sin sesiones planificadas|Día libre|Dia libre/i)
  const body = await getBodyText(page)
  if (/Semana|Weekly planner|lunes|martes|miércoles|jueves|viernes|sábado|domingo|sesión|sesiones|Día libre|Dia libre|squash|running|fuerza|movilidad/i.test(body)) {
    ok('WeeklyView muestra estructura semanal')
  } else {
    fail('WeeklyView no muestra estructura semanal reconocible', body.slice(0, 180).replace(/\s+/g, ' '))
  }
}

async function runCoachWorkspaceSmoke(page) {
  step('8. Coach workspace (/coach)')
  await goto(page, '/coach')
  const isCoachUi = await hasBodyTextAfterWait(page, /Workspace de coach/i, 5_000)
  if (!isCoachUi) {
    // Sin este gate, una regresion que rompa el render de /coach se reportaria
    // como "cuenta no allowlisted" y el smoke pasaria en verde.
    if (process.env.E2E_EXPECT_COACH_WORKSPACE === 'true') {
      fail('Coach workspace no renderizó', 'E2E_EXPECT_COACH_WORKSPACE=true pero /coach no mostró el workspace')
      return
    }
    ok('Coach workspace omitido', 'la cuenta autenticada no está en VITE_COACH_ACCOUNTS; corre con E2E_EXPECT_COACH_WORKSPACE=true para exigirlo')
    return
  }

  await safeCheck('Tab Resumen es el default y muestra CTAs', async () => {
    await waitForBodyText(page, /Ver semana/i)
    ok('Tab Resumen es el default y muestra CTAs')
  })

  await safeCheck('Tab Alumnos muestra el roster y el CTA de crear', async () => {
    await page.getByRole('tab', { name: /Alumnos/i }).click()
    await waitForBodyText(page, /Crear atleta/i)
    ok('Tab Alumnos muestra el roster y el CTA de crear')
  })

  await safeCheck('Planificación carga la vista semanal y los otros tabs conservan su placeholder', async () => {
    await page.getByRole('tab', { name: /Planificación/i }).click()
    await page.locator('#planning-athlete').waitFor({ state: 'visible', timeout: 10_000 })
    await page.getByRole('tab', { name: /Biblioteca/i }).click()
    await waitForBodyText(page, /Vas a poder guardar tus ejercicios/i)
    await page.getByRole('tab', { name: /Asistente IA/i }).click()
    await waitForBodyText(page, /revisas y confirmas/i)
    ok('Planificación y placeholders restantes renderizan correctamente')
  })

  await safeCheck('Ver semana del atleta ACTIVO no cambia el scope', async () => {
    await page.getByRole('tab', { name: /^Resumen/i }).click()
    // Anclar al atleta activo, nunca a .first(): self va primero en el roster
    // aunque el activo sea un gestionado, y clickearlo persistiria un switch.
    const activeCard = page.locator('[data-athlete-card][data-athlete-active="true"]')
    await activeCard.waitFor({ timeout: 10_000 })
    await activeCard.getByRole('button', { name: /Ver semana/i }).click()
    // Esperar la URL, no el texto: el texto puede estar en la pantalla anterior.
    await page.waitForURL((url) => url.pathname === '/week', { timeout: 15_000 })
    await waitForBodyText(page, /Semana|Weekly planner|Sin sesiones planificadas|Día libre|Dia libre/i)
    ok('CTA "Ver semana" del atleta activo navega a /week sin switch')
  })

  if (!OPTIONS.apply) {
    ok('Crear atleta + switch omitidos', 'son destructivos; corre con --apply para ejercitarlos')
    return
  }

  // --- Desde acá: destructivo. Crea un atleta real y cambia el scope. ---
  const createdName = `E2E ${new Date().toISOString().slice(0, 19)}`
  let activeBeforeSwitch = null
  let createdAthleteId = null

  await safeCheck('Crear atleta desde el tab Alumnos (submit con Enter)', async () => {
    await goto(page, '/coach')
    await page.getByRole('tab', { name: /Alumnos/i }).click()
    activeBeforeSwitch = await page.locator('[data-athlete-row][data-athlete-active="true"]')
      .getAttribute('data-athlete-row')

    await page.getByRole('button', { name: /^Crear atleta/i }).click()
    await page.getByPlaceholder(/Juan Pérez/i).fill(createdName)
    // Enter, no click: verifica el <form onSubmit> de Task 5.
    await page.getByPlaceholder(/Juan Pérez/i).press('Enter')

    // Esperar la URL, NUNCA texto: el propio boton dice "Crear y completar perfil",
    // asi que un /Perfil/i matchearia sin que el redirect haya ocurrido y el check
    // pasaria en verde con la creacion rota.
    await page.waitForURL((url) => url.pathname === '/onboarding', { timeout: 20_000 })
    ok('Crear atleta submitea con Enter y activa al nuevo atleta', createdName)
  })

  await safeCheck('Omitir onboarding del atleta recien creado', async () => {
    // El atleta recien creado no tiene perfil: needsOnboarding() da true y
    // hasSkippedOnboarding() (scopeado por atleta) da false, asi que el guard
    // global redirige CUALQUIER navegacion de vuelta a /onboarding mientras
    // esto no se resuelva. Sin este paso, el proximo goto('/coach') rebota,
    // los checks de roster/switch/restore fallan en cadena, y el atleta E2E
    // queda activo sin que el ultimo paso (restaurar) llegue a ejecutarse.
    await page.getByRole('button', { name: /Omitir/i }).click()
    await page.waitForURL((url) => url.pathname === '/', { timeout: 20_000 })
    ok('Onboarding omitido: needsOnboarding() ya no bloquea la navegacion')
  })

  await safeCheck('El atleta creado aparece en el roster', async () => {
    await goto(page, '/coach')
    await page.getByRole('tab', { name: /Alumnos/i }).click()
    await waitForBodyText(page, new RegExp(createdName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
    const createdRow = page.locator('[data-athlete-row]').filter({ hasText: createdName }).first()
    createdAthleteId = await createdRow.getAttribute('data-athlete-row')
    if (!createdAthleteId) throw new Error('La fila creada no expone data-athlete-row')
    ok('El atleta creado aparece en el roster', createdAthleteId)
  })

  await safeCheck('"Entrenar como este atleta" cambia el atleta activo', async () => {
    if (!createdAthleteId) throw new Error('No se capturó el id del atleta creado')
    const row = page.locator(`[data-athlete-row="${createdAthleteId}"]`)
    const targetId = createdAthleteId
    await row.getByRole('button', { name: /Entrenar como este atleta/i }).click()
    // onTrainAs navega a ROUTES.HOME ('/') recien cuando el switch resolvio.
    // Sin esperar esa navegacion, el goto() de abajo competiria con ella.
    await page.waitForURL((url) => url.pathname === '/', { timeout: 20_000 })
    await goto(page, '/coach')
    await page.getByRole('tab', { name: /Alumnos/i }).click()
    const nowActive = await page.locator('[data-athlete-row][data-athlete-active="true"]')
      .getAttribute('data-athlete-row')
    if (nowActive === targetId) ok('Switch de atleta aplicado', targetId)
    else fail('Switch de atleta no se aplicó', `esperaba ${targetId}, quedó ${nowActive}`)
  })

  await safeCheck('Restaurar el atleta activo original', async () => {
    if (!activeBeforeSwitch) {
      fail('No se pudo restaurar el atleta activo', 'no se capturó el atleta activo inicial')
      return
    }
    const original = page.locator(`[data-athlete-row="${activeBeforeSwitch}"]`)
    const restoreButton = original.getByRole('button', { name: /Entrenar como este atleta/i })
    if (await restoreButton.count() > 0) {
      await restoreButton.click()
      await page.waitForURL((url) => url.pathname === '/', { timeout: 20_000 })
    }
    await goto(page, '/coach')
    await page.getByRole('tab', { name: /Alumnos/i }).click()
    const nowActive = await page.locator('[data-athlete-row][data-athlete-active="true"]')
      .getAttribute('data-athlete-row')
    if (nowActive === activeBeforeSwitch) ok('Atleta activo original restaurado', activeBeforeSwitch)
    else fail('El smoke dejó otro atleta activo', `esperaba ${activeBeforeSwitch}, quedó ${nowActive}`)
  })

  await safeCheck('Archivar y restaurar el atleta creado por id', async () => {
    if (!createdAthleteId) throw new Error('No se capturó el id del atleta creado')
    const activeRow = page.locator(`[data-athlete-row="${createdAthleteId}"]`)
    const archivedRow = page.locator(`[data-archived-row="${createdAthleteId}"]`)
    let remainsArchived = false

    const revealArchivedRows = async () => {
      if (await archivedRow.isVisible().catch(() => false)) return
      const summary = page.locator('summary').filter({ hasText: /Archivados/i }).first()
      if (await summary.isVisible().catch(() => false)) await summary.click()
    }

    try {
      await activeRow.getByRole('button', { name: /^Archivar$/i }).click()
      await activeRow.waitFor({ state: 'detached', timeout: 10_000 })
      remainsArchived = true
      await revealArchivedRows()
      await archivedRow.waitFor({ state: 'visible', timeout: 10_000 })

      await archivedRow.getByRole('button', { name: /^Restaurar$/i }).click()
      remainsArchived = false
      await activeRow.waitFor({ state: 'visible', timeout: 10_000 })
      ok('Atleta creado archivado y restaurado', createdAthleteId)
    } finally {
      if (remainsArchived) {
        await revealArchivedRows().catch(() => undefined)
        if (await archivedRow.isVisible().catch(() => false)) {
          await archivedRow.getByRole('button', { name: /^Restaurar$/i }).click().catch(() => undefined)
          await activeRow.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined)
        }
      }
    }
  })
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

  const authInfo = getStoredAuthInfo()
  const hasStoredAuth = authInfo.exists
  if (authInfo.expiresAtIso) {
    console.log(`  Auth vence: ${authInfo.expiresAtIso}${authInfo.expired ? ' (vencido)' : ''}`)
  } else if (authInfo.parseError) {
    console.log(`  Auth state warning: no se pudo leer (${authInfo.parseError})`)
  }

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

    await verifyAuth(page, context, authInfo)
    await runNavigationSmoke(page)
    await runGenericChat(page)
    await runActionProposal(page)
    await runWeekCreator(page)
    await runWeeklyViewVerification(page)
    await runCoachWorkspaceSmoke(page)
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

import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

// Caracterización para la revisión; no afirma que estos resultados sean correctos.
// node docs/reviews/fixtures/coaching-refactor-2026-09-08/probe.mjs [copia_del_repo]
const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../../../../', import.meta.url)))
const networkAttempts = []
const originalFetch = globalThis.fetch
globalThis.fetch = (...args) => {
  networkAttempts.push(String(args[0]))
  throw new Error('La revisión no permite llamadas de red.')
}
const server = await createServer({
  root, configFile: false, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true, watch: null, hmr: false },
})
try {
  const [squash, running, finalizer, routing, optimizer] = await Promise.all([
    server.ssrLoadModule('/src/services/training/squashSessionHydrator.ts'),
    server.ssrLoadModule('/src/services/training/runningTemplateMaterializer.ts'),
    server.ssrLoadModule('/src/services/training/sessionDoseFinalizer.ts'),
    server.ssrLoadModule('/src/services/chatRouting.ts'),
    server.ssrLoadModule('/src/services/ai/contextOptimizer.ts'),
  ])
  const squashCases = ['technical', 'control'].map(kind => {
    const result = squash.hydrateSquashSession({
      kind, durationMin: 15, phase: 'base', fatigueLevel: 3, goal: '',
      recentDrills: [], competitionSoon: false,
      withShadowsAccessory: true, partnerAvailability: 'either',
    })
    return { requestedKind: kind, returnedKind: result.details.sessionKind,
      blocks: result.details.blocks.map(block => block.kind), warnings: result.warnings }
  })
  const profile = {
    id: 'review-athlete', updatedAt: 0, sportContext: { primarySport: 'squash' },
    runningProfile: { z2PaceMin: '6:00', z2PaceMax: '6:30', thresholdPace: '4:50' },
  }
  const tempo = running.materializeRunningTemplate({
    template: 'tempo_continuo', durationMin: 45, profile: profile.runningProfile,
  })
  if (!tempo.ok) throw new Error(tempo.message)
  const converted = finalizer.finalizeSessionDose({
    date: '2026-09-07', timeBlock: 'AM', sessionType: 'running', title: 'Tempo',
    durationMin: 45, runningType: 'tempo', targetPaceMin: '4:50', targetPaceMax: '5:00',
    runningTemplateRef: tempo.templateRef, intervalStructure: tempo.structure,
  }, profile, { neighboringHardSession: true, phase: 'base', fatigueLevel: 4 })
  const repetitionCases = ['progress', undefined].map(intent => {
    const result = running.materializeRunningTemplate({
      template: 'repeats_400', durationMin: 60, profile: { fiveKTime: '25:00' }, intent,
    })
    if (!result.ok) throw new Error(result.message)
    return { intent: intent ?? 'submit_default',
      repetitions: result.structure.blocks.filter(block => block.distanceKm === 0.4)
        .reduce((total, block) => total + (block.repetitions ?? 1), 0) }
  })
  const messages = [
    '¿Cómo estuvo mi sesión del lunes?', 'Dame feedback de mi sesión del lunes',
    'Créame una sesión de pesas',
    '¿Cómo me prepararías para tres semanas de vacaciones?',
    'Genera un plan completo hasta el torneo',
  ]
  const routeCases = messages.map(message => ({ message,
    uiClass: optimizer.inferRequestClassFromIntent(optimizer.detectChatIntent(message)),
    effectiveRoute: routing.resolveChatRoute(message).kind,
  }))
  const sessions = Array.from({ length: 14 }, (_, index) => ({
    id: `session-${index}`, date: `2030-01-${String(index + 1).padStart(2, '0')}`,
    timeBlock: 'AM', type: 'running', status: 'planned', title: 'Z2', durationMin: 30,
  }))
  const trimmed = optimizer.optimizeChatContext({
    recentSessions: sessions, plannedSessions: sessions, historicalSessions: [],
  }, 'chat_action')
  if (networkAttempts.length) throw new Error('Se intentó usar la red durante el probe.')
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1, networkAttempts, squashCases,
    runningConversion: converted.ok ? {
      ok: true, type: converted.session.runningType,
      targetPaceMin: converted.session.targetPaceMin,
      targetPaceMax: converted.session.targetPaceMax,
      blockPaces: converted.session.intervalStructure.blocks.map(block => block.targetPace ?? null),
    } : converted,
    repetitionCases, routeCases,
    retainedSessionIds: trimmed.plannedSessions.map(session => session.id),
  }, null, 2)}\n`)
} finally {
  await server.close()
  globalThis.fetch = originalFetch
}

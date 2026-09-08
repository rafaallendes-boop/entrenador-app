import { createServer } from 'vite'

/**
 * Carga el TypeScript de `src/` mediante Vite en middleware mode, igual que los
 * demás drivers standalone del repositorio.
 *
 * El probe no debe tocar la red ni el reloj: los selectores son puros y el
 * artefacto tiene que ser idéntico entre corridas. `installNetworkGuard` no es
 * decorativo — si algún módulo importado abriera una conexión, el probe dejaría
 * de ser reproducible y el fallo tiene que ser ruidoso, no silencioso.
 */

export function installNetworkGuard() {
  const attempts = []
  const deny = (kind) => (...args) => {
    const target = String(args[0] ?? '')
    attempts.push({ kind, target })
    throw new Error(`probe-selectors: llamada de red bloqueada (${kind} → ${target})`)
  }

  const originals = { fetch: globalThis.fetch, XMLHttpRequest: globalThis.XMLHttpRequest }
  globalThis.fetch = deny('fetch')
  if (typeof globalThis.XMLHttpRequest === 'function') {
    globalThis.XMLHttpRequest = class BlockedXHR {
      open(...args) { deny('xhr')(...args) }
    }
  }

  return {
    attempts,
    restore() {
      globalThis.fetch = originals.fetch
      globalThis.XMLHttpRequest = originals.XMLHttpRequest
    },
  }
}

export async function loadRuntime(createServerFactory = createServer) {
  const vite = await createServerFactory({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })

  try {
    const [
      drillLibrary,
      drillSelector,
      squashHydrator,
      squashWeekPlanner,
      runningLibrary,
      runningSelector,
      repairWeek,
      actionPostProcessor,
    ] = await Promise.all([
      vite.ssrLoadModule('/src/services/training/drillLibrary.ts'),
      vite.ssrLoadModule('/src/services/training/drillSelector.ts'),
      vite.ssrLoadModule('/src/services/training/squashSessionHydrator.ts'),
      vite.ssrLoadModule('/src/services/training/squashWeekPlanner.ts'),
      vite.ssrLoadModule('/src/services/training/runningSessionLibrary.ts'),
      vite.ssrLoadModule('/src/services/training/runningSelector.ts'),
      vite.ssrLoadModule('/src/services/planBuilder/repairWeek.ts'),
      vite.ssrLoadModule('/src/services/ai/actionPostProcessor.ts'),
    ])

    return {
      vite,
      SQUASH_DRILL_LIBRARY: drillLibrary.SQUASH_DRILL_LIBRARY,
      findSquashDrillByName: drillLibrary.findSquashDrillByName,
      resolveSquashDrillKind: drillLibrary.resolveSquashDrillKind,
      getSquashDrillFamily: drillLibrary.getSquashDrillFamily,
      selectSquashDrills: drillSelector.selectSquashDrills,
      deriveSquashProgressionState: drillSelector.deriveSquashProgressionState,
      filterByPhase: drillSelector.filterByPhase,
      filterByExecutionMode: drillSelector.filterByExecutionMode,
      extractRecentSquashDrills: drillSelector.extractRecentSquashDrills,
      hydrateSquashSession: squashHydrator.hydrateSquashSession,
      planSquashWeek: squashWeekPlanner.planSquashWeek,
      extractRecentSquashKinds: squashWeekPlanner.extractRecentSquashKinds,
      RUNNING_SESSION_LIBRARY: runningLibrary.RUNNING_SESSION_LIBRARY,
      selectRunningSession: runningSelector.selectRunningSession,
      deriveRunningProgressionState: runningSelector.deriveRunningProgressionState,
      extractRecentRunningSessions: runningSelector.extractRecentRunningSessions,
      filterByProfile: runningSelector.filterByProfile,
      repairGeneratedWeek: repairWeek.repairGeneratedWeek,
      postProcessCoachActions: actionPostProcessor.postProcessCoachActions,
      close: () => vite.close(),
    }
  } catch (error) {
    try {
      await vite.close()
    } catch {
      // El fallo de cierre es secundario: conservar la causa de carga.
    }
    throw error
  }
}

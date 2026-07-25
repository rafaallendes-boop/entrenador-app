# Plan Builder Loadtest — Entrega 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el driver de loadtest del Plan Builder y su reporte de distribuciones, para que el owner pueda correr el control pagado que habilita la calibración de quality v2.

**Architecture:** Un driver Node standalone (`scripts/loadtest-plan-builder.mjs`) que levanta un dev server de Vite en middleware mode para cargar TypeScript de `src/`, corre `runAsyncPlanGeneration` contra el proveedor real con un writer en memoria, y emite un artefacto JSON allowlisted. La lógica pura (manifest, estadística, artefacto, reporte) vive en módulos separados bajo `scripts/loadtest-plan-builder/` y se testea sin llamadas reales.

**Tech Stack:** Node ESM (`.mjs`), Vite `ssrLoadModule`, Vitest para los tests puros, TypeScript existente en `src/`.

Spec: `docs/superpowers/specs/2026-07-25-plan-builder-loadtest-and-quality-v2-activation.md` (Entrega 1, §3.1–§3.6).

**Entrega 2 (calibración congelada + activación de v2) NO entra en este plan.** Sus constantes dependen de la distribución que produce esta entrega; escribirlas ahora sería inventar números. Se planifica por separado cuando exista el artefacto de control.

## Resultado de implementación y revisión

Implementado el 2026-07-25. Los bloques TDD de cada task se conservaron como
trazabilidad del diseño original; la suite focal final creció a **94 tests** por
los hardenings encontrados durante las revisiones cruzadas:

- Los escenarios se declaran explícitamente como estímulos sintéticos
  congelados, con GoalEvent coherente, bloques de fase contiguos y procedencia
  suficiente para reconstruir fases, cargas, perfil y wizard config.
- La aceptación rechaza duplicados, escenarios mal atribuidos, semanas fuera de
  rango y planes `succeeded` contradictorios; un fallo del harness nunca puede
  aprovechar la tolerancia reservada a fallos normales del proveedor.
- Las allowlists cubren semanas, planes, Git y variante. La instrumentación
  contabiliza inputs fallidos, valida el `traceId` real y no retiene contenido.
- La corrida guarda checkpoints atómicos por caso y uno final, relee Git para
  volver `dirty` monotónico, cierra Vite preservando el error primario y atiende
  la primera `SIGINT`/`SIGTERM` entre casos.
- `runPaid` vuelve a comprobar los guards contra `process.env`; ni la API
  inyectable de tests ni argumentos desconocidos permiten eludir el opt-in.

Validación final: lint, **293 archivos / 2116 tests**, build y smoke del loader
en verde. No se ejecutó la corrida pagada.

## Global Constraints

- El driver **no** puede ser un `.test.ts`: vitest lo descubriría en `npm test` y heredaría el `testTimeout` global de 10s (`vite.config.ts:20`).
- `npm test` no ejecuta llamadas reales al proveedor y no gana archivos omitidos por el loadtest.
- Aislamiento total: writer en memoria. Sin Dexie, sin Supabase. Las corridas de loadtest no escriben en `plan_generation_jobs` de producción.
- El artefacto no contiene prompts ni respuestas. Allowlist explícita por campo, nunca lista negra.
- Método de percentil congelado: **nearest-rank**, `ceil(p × n)` sobre la muestra ordenada, sin interpolación.
- Los tres timings de primera semana se miden desde el **mismo** `workerStartedAt`.
- Ningún `n` hardcodeado en reporte, artefacto ni salida: siempre el conteo real de la corrida.
- Matriz congelada: 6 escenarios × 2 planes = 12 casos; semanas por escenario 4/3/4/3/4/3 → 42 semanas objetivo.
- Aceptación = las cuatro condiciones juntas: `attemptedPlans === 12`, `observedTargetWeeks === 42`, `completePlans >= 10`, `scorableWeeks ∈ [30, 50]`.
- Planes secuenciales. La concurrencia interna de semanas queda en el valor productivo.
- ESLint solo cubre `**/*.{ts,tsx}` (`eslint.config.js:15`): los `.mjs` y el `.test.js` de este plan **no** se lintean. Solo el módulo `.ts` de la Task 1 pasa por `npm run lint`.
- Los commits los hace el owner. Los pasos de commit se dejan listos pero no se ejecutan sin pedido explícito.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/services/planBuilder/pollingConfig.ts` | **Crear.** Constante compartida `PLAN_GENERATION_POLL_INTERVAL_MS`. |
| `src/services/planBuilder/pollPlanGeneration.ts` | **Modificar.** Consume la constante en vez de definirla. |
| `scripts/loadtest-plan-builder/manifest.mjs` | **Crear.** Los 6 escenarios congelados y el builder de los 12 casos. |
| `scripts/loadtest-plan-builder/stats.mjs` | **Crear.** Percentil nearest-rank, resumen de distribución, histograma. |
| `scripts/loadtest-plan-builder/artifact.mjs` | **Crear.** Mappers allowlisted, ensamblado del artefacto, evaluación de aceptación. |
| `scripts/loadtest-plan-builder/report.mjs` | **Crear.** Render del bloque de latencia y del bloque de reparación. |
| `scripts/loadtest-plan-builder/runtime.mjs` | **Crear.** Loader de Vite, writer en memoria, poller en memoria. |
| `scripts/loadtest-plan-builder.mjs` | **Crear.** CLI: guards, orquestación secuencial, escritura del artefacto, exit code. |
| `scripts/loadtest-plan-builder.test.js` | **Crear.** Tests puros, sin proveedor. |
| `package.json` | **Modificar.** Script `loadtest:plan-builder`. |

---

### Task 1: Intervalo de polling compartido

Hoy `DEFAULT_INTERVAL_MS` es privado en `pollPlanGeneration.ts:25`. El driver debe imitar el intervalo real sin duplicar el literal.

**Files:**
- Create: `src/services/planBuilder/pollingConfig.ts`
- Modify: `src/services/planBuilder/pollPlanGeneration.ts:25`
- Test: `src/services/planBuilder/__tests__/pollingConfig.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `PLAN_GENERATION_POLL_INTERVAL_MS: number` (valor `4000`), importable desde `src/services/planBuilder/pollingConfig.ts`.

- [ ] **Step 1: Write the failing test**

Crear `src/services/planBuilder/__tests__/pollingConfig.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

import { PLAN_GENERATION_POLL_INTERVAL_MS } from '../pollingConfig'
import { pollPlanGeneration } from '../pollPlanGeneration'

describe('PLAN_GENERATION_POLL_INTERVAL_MS', () => {
  it('is the 4s cadence the client already used', () => {
    expect(PLAN_GENERATION_POLL_INTERVAL_MS).toBe(4_000)
  })

  it('is the default the poller sleeps for between snapshots', async () => {
    vi.useFakeTimers()
    try {
      const fetched: number[] = []
      const controller = new AbortController()
      const run = pollPlanGeneration({
        planId: 'plan-1',
        signal: controller.signal,
        _fetchFn: async () => {
          fetched.push(Date.now())
          if (fetched.length >= 2) controller.abort()
          return null
        },
      })

      // Primera consulta inmediata, luego duerme el intervalo compartido.
      await vi.advanceTimersByTimeAsync(PLAN_GENERATION_POLL_INTERVAL_MS - 1)
      expect(fetched).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(fetched).toHaveLength(2)
      await run
    } finally {
      vi.useRealTimers()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/pollingConfig.test.ts`
Expected: FAIL — `Failed to resolve import "../pollingConfig"`.

- [ ] **Step 3: Write the shared module**

Crear `src/services/planBuilder/pollingConfig.ts`:

```ts
/**
 * Cadencia de polling del cliente para la generación de planes. Vive en un
 * módulo puro (sin imports) porque además del cliente la consume el driver de
 * loadtest, que mide el lag de descubrimiento contra este mismo intervalo. Si
 * el literal se duplicara, el loadtest podría medir una cadencia que producción
 * ya no usa.
 */
export const PLAN_GENERATION_POLL_INTERVAL_MS = 4_000
```

- [ ] **Step 4: Consume it from the poller**

En `src/services/planBuilder/pollPlanGeneration.ts`, borrar la línea `const DEFAULT_INTERVAL_MS = 4_000` y agregar el import junto a los existentes:

```ts
import { PLAN_GENERATION_POLL_INTERVAL_MS } from './pollingConfig'
```

Reemplazar el único uso (`const intervalMs = input.intervalMs ?? DEFAULT_INTERVAL_MS`) por:

```ts
  const intervalMs = input.intervalMs ?? PLAN_GENERATION_POLL_INTERVAL_MS
```

Verificar que no quedan usos: `grep -n "DEFAULT_INTERVAL_MS" src/services/planBuilder/pollPlanGeneration.ts` debe salir vacío.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/services/planBuilder/__tests__/pollingConfig.test.ts src/services/planBuilder/__tests__/pollPlanGeneration.test.ts`
Expected: PASS en ambos archivos.

- [ ] **Step 6: Commit (owner)**

```bash
git add src/services/planBuilder/pollingConfig.ts src/services/planBuilder/pollPlanGeneration.ts src/services/planBuilder/__tests__/pollingConfig.test.ts
git commit -m "refactor(plan-builder): share the poll interval as a pure module"
```

---

### Task 2: Manifest congelado de escenarios

**Files:**
- Create: `scripts/loadtest-plan-builder/manifest.mjs`
- Test: `scripts/loadtest-plan-builder.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `SCENARIOS`: objeto con 6 claves; cada valor `{ key, weekCount, startDate, primarySport, sportDetails, targetLoadBySport, phaseForWeek(index, weekCount), buildProfile(), buildWizardConfig() }`.
  - `MANIFEST_VERSION: 1`.
  - `buildManifest(): Array<{ caseId, scenarioKey, planIndex, weekCount, startDate }>` — 12 entradas en orden congelado.
  - `buildPlanFixture(manifestCase): { plan, weeks, profile, wizardConfig }` — objetos listos para `runAsyncPlanGeneration`.
  - `mondayOf(isoDate): string` — lunes de la semana que contiene esa fecha.
  - `describeManifest(): object` — snapshot serializable (casos + perfil + wizard config) para embeber en el artefacto.
  - `TARGET_WEEK_TOTAL: 42`, `ATTEMPTED_PLAN_TOTAL: 12`.

**Contratos del dominio que este manifest debe respetar** (verificados en código; violarlos produce un control no calibrable):

- `injuryNotes` vive en `PlanWizardConfig`, **no** en `AthleteProfile` (`types/index.ts:678`).
- `currentFitnessLevel ∈ {'fit','normal','returning','low'}`; `currentFatigue ∈ {'fresh','normal','loaded','overloaded'}` (`types/index.ts:661-662`). Cualquier otro valor es un escenario inválido silencioso.
- `getAllowedSports` = `macroSnapshot.sportDetails` ∪ `wizardConfig.complementarySports` ∪ `{mobility, recovery, nutrition}` (`repairWeek.ts:2660`). Un escenario de running cuyo `sportDetails` diga squash hace que `filterDisallowedSports` **descarte todas las sesiones de running**.
- `weekStartDate` es **lunes** (`planBuilder.ts:132`). `plan.startDate` puede caer a mitad de semana; la semana parcial se construye con esa combinación, no metiendo un miércoles en `weekStartDate`.
- `MacroPlanPhase ∈ {'base','build','peak','taper','race','transition'}` (`types/index.ts:689`). Un escenario de taper necesita fases de taper/race reales, o mide lo mismo que build.

- [ ] **Step 1: Write the failing test**

Crear `scripts/loadtest-plan-builder.test.js`:

```js
import { describe, expect, it } from 'vitest'

import {
  ATTEMPTED_PLAN_TOTAL,
  MANIFEST_VERSION,
  SCENARIOS,
  TARGET_WEEK_TOTAL,
  buildManifest,
  buildPlanFixture,
} from './loadtest-plan-builder/manifest.mjs'

describe('loadtest manifest', () => {
  it('freezes six scenarios and twelve cases', () => {
    expect(Object.keys(SCENARIOS)).toEqual([
      'squash_build',
      'squash_taper_medico',
      'running',
      'ciclismo',
      'dobles',
      'semana_parcial',
    ])
    const manifest = buildManifest()
    expect(manifest).toHaveLength(ATTEMPTED_PLAN_TOTAL)
    expect(ATTEMPTED_PLAN_TOTAL).toBe(12)
  })

  it('totals the frozen 42 target weeks', () => {
    const total = buildManifest().reduce((sum, item) => sum + item.weekCount, 0)
    expect(total).toBe(TARGET_WEEK_TOTAL)
    expect(TARGET_WEEK_TOTAL).toBe(42)
  })

  it('runs two plans per scenario in a stable order', () => {
    const manifest = buildManifest()
    expect(manifest.map((item) => item.caseId)).toEqual([
      'squash_build#1', 'squash_build#2',
      'squash_taper_medico#1', 'squash_taper_medico#2',
      'running#1', 'running#2',
      'ciclismo#1', 'ciclismo#2',
      'dobles#1', 'dobles#2',
      'semana_parcial#1', 'semana_parcial#2',
    ])
    expect(buildManifest().map((item) => item.caseId)).toEqual(manifest.map((item) => item.caseId))
  })

  it('builds deterministic fixtures with frozen dates', () => {
    const [first] = buildManifest()
    const a = buildPlanFixture(first)
    const b = buildPlanFixture(first)
    expect(a.plan.startDate).toBe(b.plan.startDate)
    expect(a.weeks).toHaveLength(first.weekCount)
    expect(a.weeks.map((week) => week.weekStartDate)).toEqual(b.weeks.map((week) => week.weekStartDate))
    expect(a.plan.id).not.toBe('')
  })

  it('exposes the manifest version so artifacts stay comparable', () => {
    expect(MANIFEST_VERSION).toBe(1)
  })

  it('starts every week on a Monday even when the plan starts mid-week', () => {
    for (const manifestCase of buildManifest()) {
      const { weeks } = buildPlanFixture(manifestCase)
      for (const week of weeks) {
        expect(new Date(`${week.weekStartDate}T00:00:00.000Z`).getUTCDay()).toBe(1)
      }
    }
  })

  it('keeps the partial-week scenario starting mid-week on a Monday-anchored week', () => {
    const partial = buildManifest().find((item) => item.scenarioKey === 'semana_parcial')
    const { plan, weeks } = buildPlanFixture(partial)
    // startDate es miércoles: la primera semana es parcial de verdad.
    expect(new Date(`${plan.startDate}T00:00:00.000Z`).getUTCDay()).toBe(3)
    expect(weeks[0].weekStartDate).toBe('2026-09-07')
  })

  it('only uses wizard enum values the engine understands', () => {
    const fitness = new Set(['fit', 'normal', 'returning', 'low'])
    const fatigue = new Set(['fresh', 'normal', 'loaded', 'overloaded'])
    for (const scenario of Object.values(SCENARIOS)) {
      const wizardConfig = scenario.buildWizardConfig()
      expect(fitness.has(wizardConfig.currentFitnessLevel)).toBe(true)
      expect(fatigue.has(wizardConfig.currentFatigue)).toBe(true)
    }
  })

  it('puts injury notes where the engine reads them', () => {
    const taper = SCENARIOS.squash_taper_medico
    expect(taper.buildWizardConfig().injuryNotes).toMatch(/rodilla/)
    expect(taper.buildProfile().injuryNotes).toBeUndefined()
  })

  it('allows each scenario primary sport through getAllowedSports', () => {
    // allowed = macroSnapshot.sportDetails ∪ complementarySports ∪ {mobility, recovery, nutrition}
    for (const manifestCase of buildManifest()) {
      const { plan, wizardConfig } = buildPlanFixture(manifestCase)
      const allowed = new Set([
        ...plan.macroSnapshot.sportDetails.map((detail) => detail.sport),
        ...wizardConfig.complementarySports,
        'mobility', 'recovery', 'nutrition',
      ])
      expect(allowed.has(SCENARIOS[manifestCase.scenarioKey].primarySport)).toBe(true)
    }
  })

  it('keeps every scenario reproducible from the wizard UI', () => {
    // La UI ofrece complementarios = enabledSports menos el primario, y el
    // motor deriva los permitidos de sportDetails ∪ complementarySports. Si
    // divergen, el control mide una configuración que ningún usuario puede
    // producir.
    for (const scenario of Object.values(SCENARIOS)) {
      const enabled = new Set(scenario.buildProfile().sportContext.enabledSports)
      const wizardConfig = scenario.buildWizardConfig()
      expect(enabled.has(scenario.primarySport)).toBe(true)
      for (const sport of wizardConfig.complementarySports) {
        expect(enabled.has(sport)).toBe(true)
        expect(sport).not.toBe(scenario.primarySport)
      }
      for (const detail of scenario.sportDetails) {
        expect(enabled.has(detail.sport)).toBe(true)
      }
      for (const sport of Object.keys(scenario.targetLoadBySport)) {
        expect(enabled.has(sport)).toBe(true)
      }
    }
  })

  it('gives the taper scenario real taper and race phases', () => {
    const taper = buildManifest().find((item) => item.scenarioKey === 'squash_taper_medico')
    const { plan, weeks } = buildPlanFixture(taper)
    const phases = weeks.map((week) => week.phase)
    expect(phases).toContain('taper')
    expect(phases[phases.length - 1]).toBe('race')
    expect(plan.phases.map((phase) => phase.phase)).toEqual(phases)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: FAIL — no se resuelve `./loadtest-plan-builder/manifest.mjs`.

- [ ] **Step 3: Write the manifest module**

Crear `scripts/loadtest-plan-builder/manifest.mjs`:

```js
/**
 * Matriz experimental CONGELADA del control (spec §3.3). Cambiar cualquier
 * valor de este archivo invalida la comparabilidad con controles anteriores:
 * comparar variantes exige repetir exactamente el mismo manifest.
 */

export const MANIFEST_VERSION = 1
export const ATTEMPTED_PLAN_TOTAL = 12
export const TARGET_WEEK_TOTAL = 42

const PLANS_PER_SCENARIO = 2

function addDaysISO(startDate, days) {
  const date = new Date(`${startDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Lunes de la semana que contiene `isoDate`. `weekStartDate` es lunes por contrato. */
export function mondayOf(isoDate) {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  const weekday = date.getUTCDay()
  const offset = weekday === 0 ? -6 : 1 - weekday
  return addDaysISO(isoDate, offset)
}

function baseProfile(overrides) {
  return {
    id: 'loadtest-athlete',
    updatedAt: 1,
    sportContext: { enabledSports: ['squash', 'strength'], primarySport: 'squash' },
    ...overrides,
  }
}

function baseWizardConfig(overrides) {
  return {
    goalEventId: 'loadtest-event',
    trainingDays: ['monday', 'wednesday', 'friday'],
    sessionsPerWeek: 3,
    sessionDurationMins: 60,
    allowDoubleSession: false,
    // La UI solo ofrece complementarios dentro de `enabledSports` menos el
    // primario (`CompetitionPlanPage.tsx:381`). Declarar running acá con un
    // perfil que no lo habilita produce una config irreproducible desde la app,
    // y encima lo cuela en getAllowedSports sin carga objetivo ni sportDetails.
    complementarySports: ['strength'],
    currentFitnessLevel: 'normal',
    currentFatigue: 'fresh',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function sportDetail(sport, role) {
  return {
    sport,
    role,
    phaseFocus: '',
    weeklyIntent: '',
    volumeBias: 'hold',
    intensityBias: 'hold',
    notes: '',
  }
}

/** Todas las semanas en `build` salvo que el escenario diga otra cosa. */
const buildEveryWeek = () => 'build'

export const SCENARIOS = {
  squash_build: {
    key: 'squash_build',
    weekCount: 4,
    startDate: '2026-08-03',
    primarySport: 'squash',
    sportDetails: [sportDetail('squash', 'primary'), sportDetail('strength', 'support')],
    targetLoadBySport: { squash: 50, strength: 25 },
    phaseForWeek: buildEveryWeek,
    buildProfile: () => baseProfile({}),
    buildWizardConfig: () => baseWizardConfig({}),
  },
  squash_taper_medico: {
    key: 'squash_taper_medico',
    weekCount: 3,
    startDate: '2026-08-10',
    primarySport: 'squash',
    sportDetails: [sportDetail('squash', 'primary'), sportDetail('strength', 'support')],
    targetLoadBySport: { squash: 40, strength: 15 },
    // Escenario de taper de verdad: sin fases taper/race mediría lo mismo que build.
    phaseForWeek: (index, weekCount) => {
      if (index === weekCount - 1) return 'race'
      if (index === weekCount - 2) return 'taper'
      return 'peak'
    },
    buildProfile: () => baseProfile({}),
    buildWizardConfig: () => baseWizardConfig({
      // `injuryNotes` vive en el wizard config, que es lo que lee el motor.
      injuryNotes: 'Molestia de rodilla derecha en control, sin dolor agudo.',
      currentFitnessLevel: 'fit',
      currentFatigue: 'loaded',
      complementarySports: ['strength'],
    }),
  },
  running: {
    key: 'running',
    weekCount: 4,
    startDate: '2026-08-17',
    primarySport: 'running',
    // El primary DEBE estar en sportDetails o filterDisallowedSports descarta
    // todas las sesiones del deporte del escenario.
    sportDetails: [sportDetail('running', 'primary'), sportDetail('strength', 'support')],
    targetLoadBySport: { running: 60, strength: 20 },
    phaseForWeek: buildEveryWeek,
    buildProfile: () => baseProfile({
      sportContext: { enabledSports: ['running', 'strength'], primarySport: 'running' },
    }),
    buildWizardConfig: () => baseWizardConfig({
      complementarySports: ['strength'],
      trainingDays: ['monday', 'tuesday', 'thursday', 'saturday'],
      sessionsPerWeek: 4,
    }),
  },
  ciclismo: {
    key: 'ciclismo',
    weekCount: 3,
    startDate: '2026-08-24',
    primarySport: 'cycling',
    sportDetails: [sportDetail('cycling', 'primary'), sportDetail('strength', 'support')],
    targetLoadBySport: { cycling: 60, strength: 20 },
    phaseForWeek: buildEveryWeek,
    buildProfile: () => baseProfile({
      sportContext: { enabledSports: ['cycling', 'strength'], primarySport: 'cycling' },
    }),
    buildWizardConfig: () => baseWizardConfig({
      complementarySports: ['strength'],
      sessionDurationMins: 90,
      trainingDays: ['tuesday', 'thursday', 'sunday'],
    }),
  },
  dobles: {
    key: 'dobles',
    weekCount: 4,
    startDate: '2026-08-31',
    primarySport: 'squash',
    sportDetails: [sportDetail('squash', 'primary'), sportDetail('strength', 'support')],
    targetLoadBySport: { squash: 70, strength: 30 },
    phaseForWeek: buildEveryWeek,
    buildProfile: () => baseProfile({}),
    buildWizardConfig: () => baseWizardConfig({
      allowDoubleSession: true,
      sessionsPerWeek: 5,
      trainingDays: ['monday', 'tuesday', 'wednesday', 'friday', 'saturday'],
    }),
  },
  semana_parcial: {
    key: 'semana_parcial',
    weekCount: 3,
    // Fecha congelada: MIÉRCOLES. `plan.startDate` cae a mitad de semana y la
    // primera `weekStartDate` es el lunes anterior (2026-09-07). Así la semana
    // parcial es real; meter el miércoles en `weekStartDate` produciría una
    // semana miércoles-martes que el prompt describiría como lunes.
    startDate: '2026-09-09',
    primarySport: 'squash',
    sportDetails: [sportDetail('squash', 'primary'), sportDetail('strength', 'support')],
    targetLoadBySport: { squash: 40, strength: 20 },
    phaseForWeek: buildEveryWeek,
    buildProfile: () => baseProfile({}),
    buildWizardConfig: () => baseWizardConfig({ sessionsPerWeek: 3 }),
  },
}

const SCENARIO_ORDER = [
  'squash_build',
  'squash_taper_medico',
  'running',
  'ciclismo',
  'dobles',
  'semana_parcial',
]

export function buildManifest() {
  const cases = []
  for (const scenarioKey of SCENARIO_ORDER) {
    const scenario = SCENARIOS[scenarioKey]
    for (let planIndex = 1; planIndex <= PLANS_PER_SCENARIO; planIndex++) {
      cases.push({
        caseId: `${scenarioKey}#${planIndex}`,
        scenarioKey,
        planIndex,
        weekCount: scenario.weekCount,
        startDate: scenario.startDate,
      })
    }
  }
  return cases
}

export function buildPlanFixture(manifestCase) {
  const scenario = SCENARIOS[manifestCase.scenarioKey]
  const wizardConfig = scenario.buildWizardConfig()
  const planId = `loadtest-${manifestCase.caseId.replace('#', '-')}`
  // La primera semana se ancla al lunes de la semana que contiene startDate.
  // Cuando startDate cae a mitad de semana, esa primera semana es parcial.
  const firstMonday = mondayOf(manifestCase.startDate)
  const endDate = addDaysISO(firstMonday, manifestCase.weekCount * 7 - 1)
  const phases = Array.from({ length: manifestCase.weekCount }, (_, index) =>
    scenario.phaseForWeek(index, manifestCase.weekCount))

  const plan = {
    id: planId,
    athleteId: 'loadtest-athlete',
    goalEventId: 'loadtest-event',
    status: 'draft',
    generationState: 'shell',
    title: `Loadtest ${manifestCase.caseId}`,
    startDate: manifestCase.startDate,
    endDate,
    totalWeeks: manifestCase.weekCount,
    phases: phases.map((phase, index) => ({
      phase,
      startWeekIndex: index,
      endWeekIndex: index,
      blockFocus: '',
      intentBySport: {},
    })),
    wizardConfig,
    macroSnapshot: {
      goalEventId: 'loadtest-event',
      goalEventDate: endDate,
      currentPhase: phases[0],
      weeksRemaining: manifestCase.weekCount,
      blockFocus: '',
      headline: '',
      timeline: [],
      sportDetails: scenario.sportDetails,
      secondaryEvents: [],
      computedAt: 0,
    },
    createdAt: 1,
    updatedAt: 1,
  }

  const weeks = Array.from({ length: manifestCase.weekCount }, (_, index) => ({
    id: `${planId}-week-${index}`,
    planId,
    weekIndex: index,
    weekStartDate: addDaysISO(firstMonday, index * 7),
    phase: phases[index],
    status: 'pending',
    sessions: [],
    weekObjectives: [],
    targetLoadBySport: scenario.targetLoadBySport,
    validationIssues: [],
    generationMeta: { attempts: 0 },
    createdAt: 1,
    updatedAt: 1,
  }))

  return { plan, weeks, profile: scenario.buildProfile(), wizardConfig }
}

/**
 * Snapshot serializable y AUTOCONTENIDO del manifest. Es lo único que Entrega 2
 * puede leer de un artefacto histórico: si algo no está acá, esa corrida deja de
 * ser reconstruible en cuanto este archivo cambie.
 */
export function describeManifest() {
  return {
    manifestVersion: MANIFEST_VERSION,
    attemptedPlanTotal: ATTEMPTED_PLAN_TOTAL,
    targetWeekTotal: TARGET_WEEK_TOTAL,
    cases: buildManifest().map((manifestCase) => {
      const scenario = SCENARIOS[manifestCase.scenarioKey]
      const { plan, weeks, profile, wizardConfig } = buildPlanFixture(manifestCase)
      return {
        ...manifestCase,
        primarySport: scenario.primarySport,
        sportDetails: scenario.sportDetails,
        targetLoadBySport: scenario.targetLoadBySport,
        planStartDate: plan.startDate,
        planEndDate: plan.endDate,
        // Descriptor efectivo por semana: sin esto no se puede saber qué se
        // pidió realmente en cada una.
        weeks: weeks.map((week) => ({
          weekIndex: week.weekIndex,
          weekStartDate: week.weekStartDate,
          phase: week.phase,
          targetLoadBySport: week.targetLoadBySport,
        })),
        profile,
        wizardConfig,
      }
    }),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit (owner)**

```bash
git add scripts/loadtest-plan-builder/manifest.mjs scripts/loadtest-plan-builder.test.js
git commit -m "test(loadtest): freeze the plan builder control manifest"
```

---

### Task 3: Estadística con percentil congelado

**Files:**
- Create: `scripts/loadtest-plan-builder/stats.mjs`
- Modify: `scripts/loadtest-plan-builder.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `percentile(values, p): number | null` — nearest-rank sobre valores ya filtrados.
  - `summarizeLatency(values): { n, nullCount, p50, p95 }` — excluye `null`/`undefined` y los cuenta.
  - `summarizeDistribution(values): { n, p50, p90, p99, max, histogram }`.

- [ ] **Step 1: Write the failing test**

Agregar a `scripts/loadtest-plan-builder.test.js`:

```js
import {
  percentile,
  summarizeDistribution,
  summarizeLatency,
} from './loadtest-plan-builder/stats.mjs'

describe('loadtest stats', () => {
  it('uses nearest-rank without interpolation', () => {
    const values = [10, 20, 30, 40]
    // ceil(0.5 * 4) = 2 → segundo valor ordenado.
    expect(percentile(values, 0.5)).toBe(20)
    // ceil(0.95 * 4) = 4 → cuarto valor.
    expect(percentile(values, 0.95)).toBe(40)
  })

  it('returns null for an empty sample instead of zero', () => {
    expect(percentile([], 0.5)).toBeNull()
  })

  it('excludes nulls from latency and reports how many there were', () => {
    const summary = summarizeLatency([100, null, 300, undefined, 200])
    expect(summary.n).toBe(3)
    expect(summary.nullCount).toBe(2)
    expect(summary.p50).toBe(200)
  })

  it('never treats a null latency as zero', () => {
    expect(summarizeLatency([500, null]).p50).toBe(500)
  })

  it('summarizes a repair distribution with a histogram', () => {
    const summary = summarizeDistribution([0, 0, 1, 2, 5])
    expect(summary.n).toBe(5)
    expect(summary.max).toBe(5)
    expect(summary.p50).toBe(1)
    expect(summary.histogram).toEqual({ 0: 2, 1: 1, 2: 1, 5: 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: FAIL — no se resuelve `./loadtest-plan-builder/stats.mjs`.

- [ ] **Step 3: Write the stats module**

Crear `scripts/loadtest-plan-builder/stats.mjs`:

```js
/**
 * Estadística del loadtest. El método de percentil es NEAREST-RANK y está
 * congelado en el spec: comparar variantes con métodos distintos produciría
 * diferencias que no existen.
 */

/** Nearest-rank: ceil(p * n) sobre la muestra ordenada, sin interpolar. */
export function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const rank = Math.ceil(p * sorted.length)
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1]
}

function numericOnly(values) {
  return values.filter((value) => typeof value === 'number' && Number.isFinite(value))
}

/**
 * Los `null` (por ejemplo `plan_complete_ms` de una corrida que no completó) se
 * excluyen y se cuentan aparte. Tratarlos como cero inventaría latencias de 0ms.
 */
export function summarizeLatency(values) {
  const numeric = numericOnly(values)
  return {
    n: numeric.length,
    nullCount: values.length - numeric.length,
    p50: percentile(numeric, 0.5),
    p95: percentile(numeric, 0.95),
  }
}

export function summarizeDistribution(values) {
  const numeric = numericOnly(values)
  const histogram = {}
  for (const value of numeric) {
    histogram[value] = (histogram[value] ?? 0) + 1
  }
  return {
    n: numeric.length,
    p50: percentile(numeric, 0.5),
    p90: percentile(numeric, 0.9),
    p99: percentile(numeric, 0.99),
    max: numeric.length === 0 ? null : Math.max(...numeric),
    histogram,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit (owner)**

```bash
git add scripts/loadtest-plan-builder/stats.mjs scripts/loadtest-plan-builder.test.js
git commit -m "test(loadtest): add nearest-rank stats for the plan builder loadtest"
```

---

### Task 4: Artefacto allowlisted y criterio de aceptación

**Files:**
- Create: `scripts/loadtest-plan-builder/artifact.mjs`
- Modify: `scripts/loadtest-plan-builder.test.js`

**Interfaces:**
- Consumes: `MANIFEST_VERSION`, `ATTEMPTED_PLAN_TOTAL`, `TARGET_WEEK_TOTAL`, `buildManifest`, `describeManifest` (Task 2).
- Produces:
  - `ARTIFACT_SCHEMA_VERSION: 1`.
  - `toWeekRow(week, context): object` — allowlist por semana.
  - `toPlanRow(runResult): object` — allowlist por plan.
  - `evaluateAcceptance(artifact): { accepted, reasons, attemptedPlans, observedTargetWeeks, completePlans, scorableWeeks }`.
  - `buildArtifact(input): object` — embebe el manifest descrito, el caveat y los resúmenes de latencia.

**Contrato clave:** `evaluateAcceptance` **deriva** lo esperado del manifest embebido en el artefacto y lo compara contra los casos realmente observados. No cuenta filas: doce copias del mismo `caseId`, o un `observedTargetWeeks` declarado a mano, deben ser rechazados.

- [ ] **Step 1: Write the failing test**

Agregar a `scripts/loadtest-plan-builder.test.js`:

```js
import {
  ARTIFACT_SCHEMA_VERSION,
  buildArtifact,
  evaluateAcceptance,
  toPlanRow,
  toWeekRow,
} from './loadtest-plan-builder/artifact.mjs'

/** Construye filas que corresponden 1:1 con el manifest congelado. */
function planRowsFromManifest(overrides = () => ({})) {
  return buildManifest().map((manifestCase, index) => ({
    caseId: manifestCase.caseId,
    scenarioKey: manifestCase.scenarioKey,
    weekCount: manifestCase.weekCount,
    outcome: 'succeeded',
    weekCountSucceeded: manifestCase.weekCount,
    weekCountFailed: 0,
    firstWeekReadyMs: 1000,
    firstWeekReadyE2eMs: 1200,
    firstWeekDetectedMs: 4000,
    firstWeekDetectionLagMs: 3000,
    planCompleteMs: 8000,
    terminalMs: 9000,
    weeks: Array.from({ length: manifestCase.weekCount }, (_, weekIndex) => ({
      weekIndex,
      scorable: true,
      countRepairsV2: 2,
      correctiveActionCount: 1,
      structuralActionCount: 1,
    })),
    ...overrides(manifestCase, index),
  }))
}

function artifactFrom(plans) {
  return buildArtifact({
    plans,
    variant: { provider: 'claude', model: 'm', qualityVersion: 1, variantId: 'v' },
    git: { sha: 'abc', dirty: false },
  })
}

describe('loadtest artifact', () => {
  it('allowlists week rows and never carries sessions or prompts', () => {
    const row = toWeekRow({
      weekIndex: 2,
      status: 'draft',
      sessions: [{ title: 'secreto' }],
      generationMeta: {
        attempts: 1,
        repairTaxonomyVersion: 2,
        qualityVersion: 1,
        correctiveActionCount: 3,
        structuralActionCount: 2,
        movedSessionCount: 1,
        droppedSessionCount: 0,
      },
    }, { scenarioKey: 'squash_build', countRepairsV2: 6, score: 88, grade: 'good' })

    expect(row.sessions).toBeUndefined()
    expect(JSON.stringify(row)).not.toContain('secreto')
    expect(row).toMatchObject({
      weekIndex: 2,
      status: 'draft',
      countRepairsV2: 6,
      correctiveActionCount: 3,
      structuralActionCount: 2,
      scorable: true,
    })
  })

  it('marks a week without v2 taxonomy as not scorable', () => {
    const row = toWeekRow(
      { weekIndex: 0, status: 'draft', sessions: [], generationMeta: { attempts: 1 } },
      { scenarioKey: 'running', countRepairsV2: 0 },
    )
    expect(row.scorable).toBe(false)
  })

  it('marks an errored week as not scorable', () => {
    const row = toWeekRow(
      { weekIndex: 0, status: 'error', sessions: [], generationMeta: { attempts: 2, repairTaxonomyVersion: 2 } },
      { scenarioKey: 'running', countRepairsV2: 0 },
    )
    expect(row.scorable).toBe(false)
  })

  it('accepts a run that covers the frozen manifest', () => {
    const verdict = evaluateAcceptance(artifactFrom(planRowsFromManifest()))
    expect(verdict.accepted).toBe(true)
    expect(verdict.attemptedPlans).toBe(12)
    expect(verdict.observedTargetWeeks).toBe(42)
    expect(verdict.scorableWeeks).toBe(42)
  })

  it('rejects twelve copies of the same case even if the counts add up', () => {
    const [first] = planRowsFromManifest()
    // Doce filas, doce "planes", pero un solo caso del manifest cubierto.
    const plans = Array.from({ length: 12 }, () => ({ ...first }))
    const verdict = evaluateAcceptance(artifactFrom(plans))
    expect(verdict.accepted).toBe(false)
    expect(verdict.reasons.join(' ')).toMatch(/casos del manifest/)
  })

  it('derives observed target weeks from the rows instead of trusting a declared total', () => {
    const plans = planRowsFromManifest((manifestCase) =>
      manifestCase.caseId === 'running#1' ? { weekCount: 2, weeks: [] } : {})
    const verdict = evaluateAcceptance(artifactFrom(plans))
    expect(verdict.observedTargetWeeks).toBe(40)
    expect(verdict.accepted).toBe(false)
    expect(verdict.reasons.join(' ')).toMatch(/semanas objetivo/)
  })

  it('rejects a run that stopped after ten successful plans', () => {
    const plans = planRowsFromManifest().slice(0, 10)
    const verdict = evaluateAcceptance(artifactFrom(plans))
    expect(verdict.accepted).toBe(false)
    expect(verdict.reasons.join(' ')).toMatch(/casos del manifest/)
  })

  it('rejects when too few plans completed even with the full manifest attempted', () => {
    const plans = planRowsFromManifest((_, index) =>
      index >= 9 ? { outcome: 'failed', weekCountSucceeded: 0, weeks: [] } : {})
    const verdict = evaluateAcceptance(artifactFrom(plans))
    expect(verdict.attemptedPlans).toBe(12)
    expect(verdict.completePlans).toBe(9)
    expect(verdict.accepted).toBe(false)
  })

  it('embeds the manifest, the caveat and the latency summaries for Entrega 2', () => {
    const artifact = artifactFrom(planRowsFromManifest())
    expect(artifact.artifactSchemaVersion).toBe(ARTIFACT_SCHEMA_VERSION)
    expect(artifact.git).toEqual({ sha: 'abc', dirty: false })
    expect(artifact.manifest.cases).toHaveLength(12)
    // Sin perfil y wizard config no se puede reconstruir qué produjo la muestra.
    expect(artifact.manifest.cases[0].wizardConfig.sessionsPerWeek).toBeGreaterThan(0)
    expect(artifact.manifest.cases[0].profile.id).toBe('loadtest-athlete')
    expect(artifact.caveat).toContain('n=12')
    expect(artifact.latencySummary.completePlans.terminalMs.p95).toBe(9000)
  })

  it('re-applies the plan allowlist at the artifact boundary', () => {
    const [first] = planRowsFromManifest()
    const artifact = artifactFrom([{ ...first, apiKey: 'secreto', promptText: 'no' }])
    expect(artifact.plans[0].apiKey).toBeUndefined()
    expect(JSON.stringify(artifact)).not.toContain('secreto')
  })

  it('re-applies the allowlist inside weeks, not only at the plan root', () => {
    const [first] = planRowsFromManifest()
    const artifact = artifactFrom([{
      ...first,
      weeks: [{ ...first.weeks[0], promptText: 'secreto-semanal', sessions: [{ title: 'x' }] }],
    }])
    expect(artifact.plans[0].weeks[0].promptText).toBeUndefined()
    expect(artifact.plans[0].weeks[0].sessions).toBeUndefined()
    expect(JSON.stringify(artifact)).not.toContain('secreto-semanal')
  })

  it('evaluates a historical artifact against its own embedded manifest', () => {
    const artifact = artifactFrom(planRowsFromManifest())
    // Un manifest embebido más chico define un control distinto y válido.
    artifact.manifest = {
      ...artifact.manifest,
      cases: artifact.manifest.cases.slice(0, 11),
    }
    const verdict = evaluateAcceptance(artifact)
    expect(verdict.accepted).toBe(false)
    expect(verdict.reasons.join(' ')).toContain('12/11')
  })

  it('keeps an error class instead of raw provider text', () => {
    const row = toPlanRow({ caseId: 'a#1', errorClass: 'timeout', error: 'Anthropic dijo cualquier cosa' })
    expect(row.errorClass).toBe('timeout')
    expect(JSON.stringify(row)).not.toContain('cualquier cosa')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: FAIL — no se resuelve `./loadtest-plan-builder/artifact.mjs`.

- [ ] **Step 3: Write the artifact module**

Crear `scripts/loadtest-plan-builder/artifact.mjs`:

```js
import { ATTEMPTED_PLAN_TOTAL, MANIFEST_VERSION, TARGET_WEEK_TOTAL, buildManifest, describeManifest } from './manifest.mjs'
import { summarizeLatency } from './stats.mjs'

export const ARTIFACT_SCHEMA_VERSION = 1

const LATENCY_METRICS = ['firstWeekReadyMs', 'firstWeekDetectedMs', 'planCompleteMs', 'terminalMs']

const MIN_COMPLETE_PLANS = 10
const MIN_SCORABLE_WEEKS = 30
const MAX_SCORABLE_WEEKS = 50

/**
 * Allowlist EXPLÍCITA por semana. Nunca copiar la semana entera ni excluir por
 * lista negra: un campo nuevo del dominio no debe poder filtrarse al artefacto
 * por olvido, y `sessions` contiene contenido generado.
 */
export function toWeekRow(week, context) {
  const meta = week.generationMeta ?? {}
  const scorable = week.status === 'draft' || week.status === 'accepted'
    ? meta.repairTaxonomyVersion === 2
    : false
  return {
    weekIndex: week.weekIndex,
    scenarioKey: context.scenarioKey,
    status: week.status,
    scorable,
    attempts: meta.attempts ?? 0,
    errorClass: meta.errorClass ?? null,
    repairTaxonomyVersion: meta.repairTaxonomyVersion ?? null,
    qualityVersion: meta.qualityVersion ?? null,
    countRepairsV2: context.countRepairsV2 ?? null,
    correctiveActionCount: meta.correctiveActionCount ?? 0,
    structuralActionCount: meta.structuralActionCount ?? 0,
    movedSessionCount: meta.movedSessionCount ?? 0,
    droppedSessionCount: meta.droppedSessionCount ?? 0,
    hydrationActionCount: meta.hydrationActionCount ?? 0,
    addedFallbackCount: meta.addedFallbackCount ?? 0,
    filteredSportCount: meta.filteredSportCount ?? 0,
    sessionCount: Array.isArray(week.sessions) ? week.sessions.length : 0,
    // Tamaños, no contenido (spec §3.5). `*Chars` se instrumenta alrededor de
    // `callLLM`; `durationMs` acumula todos los intentos de la semana y
    // `wallClockMs` sale de las marcas de tiempo del writer.
    promptChars: context.promptChars ?? null,
    responseChars: context.responseChars ?? null,
    promptTokens: context.promptTokens ?? null,
    completionTokens: context.completionTokens ?? null,
    durationMs: context.durationMs ?? null,
    wallClockMs: context.wallClockMs ?? null,
    score: context.score ?? null,
    grade: context.grade ?? null,
  }
}

/** Claves permitidas en una fila de semana ya construida. */
const WEEK_ROW_KEYS = Object.keys(toWeekRow(
  { weekIndex: 0, status: 'pending', sessions: [], generationMeta: {} },
  { scenarioKey: '' },
))

/**
 * Segunda pasada de allowlist sobre semanas ya materializadas. `toPlanRow`
 * recibe `weeks` de un caller: sin este pick, un `weeks[0].promptText` entraría
 * intacto al artefacto aunque la raíz del plan esté saneada.
 */
function pickWeekRow(week) {
  const picked = {}
  for (const key of WEEK_ROW_KEYS) picked[key] = week[key] ?? null
  return picked
}

/** Allowlist explícita por plan. Mismo criterio que `toWeekRow`. */
export function toPlanRow(runResult) {
  return {
    caseId: runResult.caseId,
    scenarioKey: runResult.scenarioKey,
    weekCount: runResult.weekCount,
    outcome: runResult.outcome,
    weekCountSucceeded: runResult.weekCountSucceeded,
    weekCountFailed: runResult.weekCountFailed,
    firstWeekReadyMs: runResult.firstWeekReadyMs ?? null,
    firstWeekReadyE2eMs: runResult.firstWeekReadyE2eMs ?? null,
    firstWeekDetectedMs: runResult.firstWeekDetectedMs ?? null,
    firstWeekDetectionLagMs: runResult.firstWeekDetectionLagMs ?? null,
    planCompleteMs: runResult.planCompleteMs ?? null,
    terminalMs: runResult.terminalMs ?? null,
    totalInputTokens: runResult.totalInputTokens ?? 0,
    totalOutputTokens: runResult.totalOutputTokens ?? 0,
    totalCacheReadTokens: runResult.totalCacheReadTokens ?? 0,
    totalCacheCreationTokens: runResult.totalCacheCreationTokens ?? 0,
    estimatedCostUsd: runResult.estimatedCostUsd ?? null,
    retryCount: runResult.retryCount ?? 0,
    fallbackUsed: Boolean(runResult.fallbackUsed),
    observedModels: runResult.observedModels ?? [],
    qualityVersion: runResult.qualityVersion ?? null,
    planScore: runResult.planScore ?? null,
    planGrade: runResult.planGrade ?? null,
    issueCodes: runResult.issueCodes ?? [],
    // Código, no texto: el mensaje crudo del proveedor puede citar contenido.
    errorClass: runResult.errorClass ?? null,
    promptChars: runResult.promptChars ?? null,
    responseChars: runResult.responseChars ?? null,
    weeks: (runResult.weeks ?? []).map(pickWeekRow),
  }
}

function latencyCohortSummary(plans) {
  const cohort = {}
  for (const metric of LATENCY_METRICS) {
    cohort[metric] = summarizeLatency(plans.map((plan) => plan[metric]))
  }
  return cohort
}

export function buildArtifact(input) {
  // La allowlist se re-aplica SIEMPRE en la frontera final: un caller no puede
  // colar campos por traer un objeto que ya parezca una fila.
  const plans = input.plans.map((plan) => toPlanRow(plan))
  const completePlans = plans.filter((plan) => plan.outcome === 'succeeded')

  return {
    artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
    manifestVersion: MANIFEST_VERSION,
    createdAt: new Date().toISOString(),
    git: input.git,
    variant: input.variant,
    attemptedPlanTarget: ATTEMPTED_PLAN_TOTAL,
    targetWeekTarget: TARGET_WEEK_TOTAL,
    // El manifest embebido —con perfil y wizard config— es lo que permite a
    // Entrega 2 reconstruir qué configuración produjo la muestra. Una versión
    // numérica sola no alcanza.
    manifest: describeManifest(),
    latencySummary: {
      allAttempts: latencyCohortSummary(plans),
      completePlans: latencyCohortSummary(completePlans),
    },
    caveat: `Caveat estadístico: con n=${completePlans.length} planes completos, p95 y p99 de plan son prácticamente el máximo observado. Baseline inicial conservadora, no un p95 estable.`,
    plans,
  }
}

/**
 * Las cuatro condiciones van juntas (spec §3.3). Las dos primeras existen para
 * que una interrupción tras 10 planes exitosos no apruebe un control que jamás
 * intentó los doce casos del manifest: tolerar fallos del proveedor no es lo
 * mismo que tolerar una muestra sesgada por casos nunca intentados.
 */
export function evaluateAcceptance(artifact) {
  const attemptedPlans = artifact.plans.length
  const completePlans = artifact.plans.filter((plan) => plan.outcome === 'succeeded').length
  const scorableWeeks = artifact.plans
    .filter((plan) => plan.outcome === 'succeeded')
    .reduce((sum, plan) => sum + plan.weeks.filter((week) => week.scorable).length, 0)
  // Derivado de las filas, nunca de un total declarado por el caller.
  const observedTargetWeeks = artifact.plans.reduce((sum, plan) => sum + (plan.weekCount ?? 0), 0)

  // SIEMPRE del manifest embebido en el artefacto, nunca del checkout actual:
  // un control histórico debe evaluarse contra el manifest con el que corrió.
  const embeddedCases = artifact.manifest?.cases
  if (!Array.isArray(embeddedCases)) {
    return {
      accepted: false,
      reasons: ['el artefacto no embebe su manifest; no es evaluable'],
      attemptedPlans,
      observedTargetWeeks,
      completePlans,
      scorableWeeks,
    }
  }
  const expectedCases = new Map(embeddedCases.map((item) => [item.caseId, item.weekCount]))
  const observedCases = new Set(artifact.plans.map((plan) => plan.caseId))
  const missing = [...expectedCases.keys()].filter((caseId) => !observedCases.has(caseId))
  const unexpected = [...observedCases].filter((caseId) => !expectedCases.has(caseId))
  const wrongWeekCount = artifact.plans.filter((plan) =>
    expectedCases.has(plan.caseId) && expectedCases.get(plan.caseId) !== plan.weekCount)

  const expectedTargetWeeks = embeddedCases.reduce((sum, item) => sum + item.weekCount, 0)

  const reasons = []
  if (attemptedPlans !== embeddedCases.length) {
    reasons.push(`manifest incompleto: se intentaron ${attemptedPlans}/${embeddedCases.length} planes`)
  }
  if (missing.length > 0 || unexpected.length > 0 || observedCases.size !== expectedCases.size) {
    reasons.push(`casos del manifest no cubiertos exactamente (faltan ${missing.length}, sobran ${unexpected.length}, únicos ${observedCases.size}/${expectedCases.size})`)
  }
  if (wrongWeekCount.length > 0) {
    reasons.push(`casos con weekCount distinto al manifest: ${wrongWeekCount.map((plan) => plan.caseId).join(', ')}`)
  }
  if (observedTargetWeeks !== expectedTargetWeeks) {
    reasons.push(`semanas objetivo observadas ${observedTargetWeeks}/${expectedTargetWeeks}`)
  }
  if (completePlans < MIN_COMPLETE_PLANS) {
    reasons.push(`planes completos ${completePlans} < ${MIN_COMPLETE_PLANS}`)
  }
  if (scorableWeeks < MIN_SCORABLE_WEEKS || scorableWeeks > MAX_SCORABLE_WEEKS) {
    reasons.push(`semanas puntuables ${scorableWeeks} fuera de [${MIN_SCORABLE_WEEKS}, ${MAX_SCORABLE_WEEKS}]`)
  }

  return {
    accepted: reasons.length === 0,
    reasons,
    attemptedPlans,
    observedTargetWeeks,
    completePlans,
    scorableWeeks,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: PASS, 33 tests.

- [ ] **Step 5: Commit (owner)**

```bash
git add scripts/loadtest-plan-builder/artifact.mjs scripts/loadtest-plan-builder.test.js
git commit -m "test(loadtest): allowlist the loadtest artifact and freeze acceptance"
```

---

### Task 5: Reporte de distribuciones

**Files:**
- Create: `scripts/loadtest-plan-builder/report.mjs`
- Modify: `scripts/loadtest-plan-builder.test.js`

**Interfaces:**
- Consumes: `summarizeLatency`, `summarizeDistribution` (Task 3); artefacto de Task 4.
- Produces: `buildReport(artifact): { latency, repair, caveat }` y `renderReport(report): string`.

- [ ] **Step 1: Write the failing test**

Agregar a `scripts/loadtest-plan-builder.test.js`:

```js
import { buildReport, renderReport } from './loadtest-plan-builder/report.mjs'

function artifactStub() {
  const weeks = [
    { weekIndex: 0, scorable: true, countRepairsV2: 2, correctiveActionCount: 1, structuralActionCount: 1, durationMs: 3000, wallClockMs: 5000 },
    { weekIndex: 1, scorable: true, countRepairsV2: 4, correctiveActionCount: 2, structuralActionCount: 1, durationMs: 7000, wallClockMs: 9000 },
    { weekIndex: 2, scorable: false, countRepairsV2: null, correctiveActionCount: 0, structuralActionCount: 0, durationMs: null, wallClockMs: null },
  ]
  return {
    artifactSchemaVersion: 1,
    plans: [
      {
        caseId: 'a#1', scenarioKey: 'squash_build', outcome: 'succeeded',
        firstWeekReadyMs: 1000, firstWeekDetectedMs: 4000, planCompleteMs: 8000, terminalMs: 9000,
        weeks,
      },
      {
        caseId: 'a#2', scenarioKey: 'squash_build', outcome: 'failed',
        firstWeekReadyMs: 2000, firstWeekDetectedMs: 5000, planCompleteMs: null, terminalMs: 11000,
        weeks: [],
      },
    ],
  }
}

describe('loadtest report', () => {
  it('splits latency into all-attempts and complete-plans cohorts', () => {
    const report = buildReport(artifactStub())
    expect(report.latency.allAttempts.terminalMs.n).toBe(2)
    expect(report.latency.completePlans.terminalMs.n).toBe(1)
  })

  it('counts excluded nulls instead of scoring them as zero', () => {
    const report = buildReport(artifactStub())
    expect(report.latency.allAttempts.planCompleteMs.nullCount).toBe(1)
    expect(report.latency.allAttempts.planCompleteMs.p50).toBe(8000)
  })

  it('reports the three repair distributions over scorable weeks only', () => {
    const report = buildReport(artifactStub())
    expect(report.repair.weekCountRepairsV2.n).toBe(2)
    expect(report.repair.planCountRepairsV2.n).toBe(1)
    expect(report.repair.weekWarningInput.n).toBe(2)
    // El warning suma solo corrective + structural: 1+1 y 2+1.
    expect(report.repair.weekWarningInput.max).toBe(3)
  })

  it('emits the caveat with the real n, never a hardcoded one', () => {
    const report = buildReport(artifactStub())
    expect(report.caveat).toContain('n=1')
    expect(report.caveat).not.toContain('n=12')
  })

  it('breaks every repair distribution down by scenario, not just the weekly one', () => {
    const report = buildReport(artifactStub())
    const scenario = report.byScenario.squash_build
    expect(scenario.weekCountRepairsV2.n).toBe(2)
    expect(scenario.planCountRepairsV2.n).toBe(1)
    expect(scenario.weekWarningInput.n).toBe(2)
  })

  it('emits the secondary weekly latency breakdown with real values', () => {
    const report = buildReport(artifactStub())
    // Dos semanas con duración, una en null; el null se excluye y se cuenta.
    expect(report.weeklyLatency.durationMs.n).toBe(2)
    expect(report.weeklyLatency.durationMs.nullCount).toBe(1)
    expect(report.weeklyLatency.durationMs.p50).toBe(3000)
    expect(report.weeklyLatency.wallClockMs.p95).toBe(9000)
  })

  it('refuses an artifact written by a different schema version', () => {
    const artifact = { ...artifactStub(), artifactSchemaVersion: 2 }
    expect(() => buildReport(artifact)).toThrow(/artifactSchemaVersion/)
  })

  it('renders both blocks as text', () => {
    const text = renderReport(buildReport(artifactStub()))
    expect(text).toContain('Latencia por plan')
    expect(text).toContain('Distribuciones de reparación')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: FAIL — no se resuelve `./loadtest-plan-builder/report.mjs`.

- [ ] **Step 3: Write the report module**

Crear `scripts/loadtest-plan-builder/report.mjs`:

```js
import { ARTIFACT_SCHEMA_VERSION } from './artifact.mjs'
import { summarizeDistribution, summarizeLatency } from './stats.mjs'

const LATENCY_METRICS = [
  'firstWeekReadyMs',
  'firstWeekDetectedMs',
  'planCompleteMs',
  'terminalMs',
]

function latencyCohort(plans) {
  const cohort = {}
  for (const metric of LATENCY_METRICS) {
    cohort[metric] = summarizeLatency(plans.map((plan) => plan[metric]))
  }
  return cohort
}

function repairBlock(completePlans) {
  const scorableWeeks = completePlans.flatMap((plan) => plan.weeks.filter((week) => week.scorable))
  return {
    weekCountRepairsV2: summarizeDistribution(scorableWeeks.map((week) => week.countRepairsV2)),
    planCountRepairsV2: summarizeDistribution(completePlans.map((plan) => plan.weeks
      .filter((week) => week.scorable)
      .reduce((sum, week) => sum + (week.countRepairsV2 ?? 0), 0))),
    weekWarningInput: summarizeDistribution(scorableWeeks.map((week) =>
      (week.correctiveActionCount ?? 0) + (week.structuralActionCount ?? 0))),
  }
}

/**
 * El reporte DESCRIBE, no propone: no emite divisor ni umbral calculado. §5.3
 * prohíbe recalibrar por variante y una derivación automática invita a eso.
 */
export function buildReport(artifact) {
  // Interpretar un artefacto de otro schema en silencio produciría números que
  // parecen comparables y no lo son.
  if (artifact.artifactSchemaVersion !== ARTIFACT_SCHEMA_VERSION) {
    throw new Error(`artifactSchemaVersion ${artifact.artifactSchemaVersion} incompatible; este reporte lee ${ARTIFACT_SCHEMA_VERSION}.`)
  }

  const completePlans = artifact.plans.filter((plan) => plan.outcome === 'succeeded')
  // Todas las semanas escritas, no solo las de planes completos: una semana de
  // un plan que después falló igual tiene latencia real que medir.
  const allWeeks = artifact.plans.flatMap((plan) => plan.weeks)

  return {
    latency: {
      allAttempts: latencyCohort(artifact.plans),
      completePlans: latencyCohort(completePlans),
    },
    /** Desglose secundario: latencia por semana, no por plan. */
    weeklyLatency: {
      durationMs: summarizeLatency(allWeeks.map((week) => week.durationMs)),
      wallClockMs: summarizeLatency(allWeeks.map((week) => week.wallClockMs)),
    },
    repair: repairBlock(completePlans),
    byScenario: Object.fromEntries(
      [...new Set(artifact.plans.map((plan) => plan.scenarioKey))].map((scenarioKey) => [
        scenarioKey,
        repairBlock(completePlans.filter((plan) => plan.scenarioKey === scenarioKey)),
      ]),
    ),
    caveat: `Caveat estadístico: con n=${completePlans.length} planes completos, p95 y p99 de plan son prácticamente el máximo observado. Baseline inicial conservadora, no un p95 estable. Comparar variantes exige repetir el mismo manifest congelado.`,
  }
}

function formatLatency(label, summary) {
  const nulls = summary.nullCount > 0 ? ` (nulls excluidos: ${summary.nullCount})` : ''
  return `    ${label}: n=${summary.n} p50=${summary.p50 ?? '—'} p95=${summary.p95 ?? '—'}${nulls}`
}

function formatDistribution(label, summary) {
  return `    ${label}: n=${summary.n} p50=${summary.p50 ?? '—'} p90=${summary.p90 ?? '—'} p99=${summary.p99 ?? '—'} max=${summary.max ?? '—'} hist=${JSON.stringify(summary.histogram)}`
}

export function renderReport(report) {
  const lines = ['=== Latencia por plan (ms) ===']
  for (const [cohort, metrics] of Object.entries(report.latency)) {
    lines.push(`  ${cohort}:`)
    for (const [metric, summary] of Object.entries(metrics)) {
      lines.push(formatLatency(metric, summary))
    }
  }

  lines.push('', '=== Distribuciones de reparación ===')
  lines.push(formatDistribution('countRepairsV2 por semana puntuable', report.repair.weekCountRepairsV2))
  lines.push(formatDistribution('countRepairsV2 por plan completo', report.repair.planCountRepairsV2))
  lines.push(formatDistribution('corrective+structural por semana (warning)', report.repair.weekWarningInput))

  lines.push('', '  Latencia por semana (secundario):')
  lines.push(formatLatency('durationMs (proveedor, todos los intentos)', report.weeklyLatency.durationMs))
  lines.push(formatLatency('wallClockMs (escritura a escritura)', report.weeklyLatency.wallClockMs))

  lines.push('', '  Por escenario:')
  for (const [scenarioKey, block] of Object.entries(report.byScenario)) {
    lines.push(`    ${scenarioKey}:`)
    lines.push(formatDistribution('  semana countRepairsV2', block.weekCountRepairsV2))
    lines.push(formatDistribution('  plan countRepairsV2', block.planCountRepairsV2))
    lines.push(formatDistribution('  semana corrective+structural', block.weekWarningInput))
  }

  lines.push('', report.caveat)
  return lines.join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: PASS, 41 tests.

- [ ] **Step 5: Commit (owner)**

```bash
git add scripts/loadtest-plan-builder/report.mjs scripts/loadtest-plan-builder.test.js
git commit -m "test(loadtest): report latency cohorts and repair distributions"
```

---

### Task 6: Runtime — loader, writer en memoria y poller

**Files:**
- Create: `scripts/loadtest-plan-builder/runtime.mjs`
- Modify: `scripts/loadtest-plan-builder.test.js`

**Interfaces:**
- Consumes: nada de tasks previas.
- Produces:
  - `createMemoryWriter(now?): { writer, snapshot() }` — `writer` implementa `AsyncPlanGenerationWriter`; `snapshot()` devuelve `{ plan, weeks, attempts, job, weekWrites }`, con una marca de tiempo por escritura de semana.
  - `instrumentCallLLM(callLLM): { wrapped, sizesFor(weekIndex) }` — mide tamaños de entrada/salida por semana sin retener contenido.
  - `createDetectionPoller({ snapshot, isReadyWeek, workerStartedAt, intervalMs, now }): { start(), stop(), result() }`.
  - `loadRuntime(): Promise<{ vite, runAsyncPlanGeneration, callAnthropicForWeek, resolveEffectivePlanBuilderConfig, buildVariantId, countRepairsV2, reviewPlanQuality, isReadyWeek, pollIntervalMs, close() }>`.

- [ ] **Step 1: Write the failing test**

Agregar a `scripts/loadtest-plan-builder.test.js`. **Solo se testean las piezas puras del runtime** — `loadRuntime` levanta Vite y se ejercita en la corrida real:

```js
import {
  createDetectionPoller,
  createMemoryWriter,
  instrumentCallLLM,
} from './loadtest-plan-builder/runtime.mjs'

const readyWeek = (week) => week.status === 'draft' && week.sessions.length > 0

describe('loadtest memory writer', () => {
  it('keeps plan, weeks, attempts and job in memory', async () => {
    const { writer, snapshot } = createMemoryWriter()
    await writer.putPlan({ id: 'p1', generationState: 'generating' })
    await writer.putWeek({ weekIndex: 0, status: 'draft', sessions: [{}] })
    await writer.putAttempt({ weekIndex: 0, attempt: 1 })
    await writer.putJob({ jobId: 'j1', terminalMs: 10 })

    const state = snapshot()
    expect(state.plan.id).toBe('p1')
    expect(state.weeks).toHaveLength(1)
    expect(state.attempts).toHaveLength(1)
    expect(state.job.jobId).toBe('j1')
    expect(await writer.getPlan('p1')).toEqual(state.plan)
  })

  it('replaces a week in place instead of appending duplicates', async () => {
    const { writer, snapshot } = createMemoryWriter()
    await writer.putWeek({ weekIndex: 0, status: 'generating', sessions: [] })
    await writer.putWeek({ weekIndex: 0, status: 'draft', sessions: [{}] })
    expect(snapshot().weeks).toHaveLength(1)
    expect(snapshot().weeks[0].status).toBe('draft')
  })

  it('timestamps every week write so weekly latency is measurable', async () => {
    let clock = 1_000
    const { writer, snapshot } = createMemoryWriter(() => clock)
    await writer.putWeek({ weekIndex: 0, status: 'generating', sessions: [] })
    clock = 7_500
    await writer.putWeek({ weekIndex: 0, status: 'draft', sessions: [{}] })

    const writes = snapshot().weekWrites
    expect(writes).toHaveLength(2)
    expect(writes[1].at - writes[0].at).toBe(6_500)
  })
})

describe('loadtest callLLM instrumentation', () => {
  it('records sizes per week without keeping any content', async () => {
    const { wrapped, sizesFor } = instrumentCallLLM(async () => ({ text: '12345' }))
    await wrapped({ traceId: 'job-week-2', messages: [{ role: 'user', content: 'hola' }] })

    const sizes = sizesFor(2)
    expect(sizes.responseChars).toBe(5)
    expect(sizes.promptChars).toBeGreaterThan(0)
    expect(JSON.stringify(sizes)).not.toContain('hola')
  })

  it('accumulates retries of the same week', async () => {
    const { wrapped, sizesFor } = instrumentCallLLM(async () => ({ text: 'ab' }))
    await wrapped({ traceId: 'job-week-1', messages: [] })
    await wrapped({ traceId: 'job-week-1-attempt-2', messages: [] })
    expect(sizesFor(1).responseChars).toBe(4)
  })

  it('keeps the input size when the provider attempt throws', async () => {
    const { wrapped, sizesFor } = instrumentCallLLM(async () => {
      throw new Error('provider unavailable')
    })

    await expect(wrapped({
      traceId: 'job-week-3',
      messages: [{ role: 'user', content: 'contenido sensible' }],
    })).rejects.toThrow('provider unavailable')

    const sizes = sizesFor(3)
    expect(sizes.promptChars).toBeGreaterThan(0)
    expect(sizes.responseChars).toBe(0)
    expect(JSON.stringify(sizes)).not.toContain('contenido sensible')
  })
})

describe('loadtest detection poller', () => {
  it('checks immediately and measures detection from workerStartedAt', async () => {
    let clock = 1_000
    const state = { weeks: [] }
    const poller = createDetectionPoller({
      snapshot: () => state,
      isReadyWeek: readyWeek,
      workerStartedAt: 1_000,
      intervalMs: 0,
      now: () => clock,
    })

    poller.start()
    await Promise.resolve()
    expect(poller.result().firstWeekDetectedMs).toBeNull()

    clock = 5_000
    state.weeks = [{ weekIndex: 0, status: 'draft', sessions: [{}] }]
    await poller.waitForNextCheck()
    poller.stop()

    expect(poller.result().firstWeekDetectedMs).toBe(4_000)
  })

  it('reports a null lag when no week ever became ready', async () => {
    const poller = createDetectionPoller({
      snapshot: () => ({ weeks: [] }),
      isReadyWeek: readyWeek,
      workerStartedAt: 0,
      intervalMs: 0,
      now: () => 10,
    })
    poller.start()
    await poller.settle()
    expect(poller.result().firstWeekDetectedMs).toBeNull()
  })

  it('still detects a week that became ready during the last sleep', async () => {
    // Flujo real: el plan termina mientras el poller duerme. Si `settle()` solo
    // marcara stopped, un plan exitoso registraría firstWeekDetectedMs null.
    let clock = 1_000
    const state = { weeks: [] }
    const poller = createDetectionPoller({
      snapshot: () => state,
      isReadyWeek: readyWeek,
      workerStartedAt: 1_000,
      intervalMs: 50,
      now: () => clock,
    })

    poller.start()
    state.weeks = [{ weekIndex: 0, status: 'draft', sessions: [{}] }]
    clock = 3_000
    await poller.settle()

    expect(poller.result().firstWeekDetectedMs).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: FAIL — no se resuelve `./loadtest-plan-builder/runtime.mjs`.

- [ ] **Step 3: Write the runtime module**

Crear `scripts/loadtest-plan-builder/runtime.mjs`:

```js
import { createServer } from 'vite'

/**
 * Writer en memoria: el loadtest NO toca Dexie ni Supabase, así que sus
 * corridas no contaminan `plan_generation_jobs` de producción, que es la tabla
 * contra la que después se miran los datos reales.
 */
export function createMemoryWriter(now = Date.now) {
  const state = { plan: null, weeks: [], attempts: [], job: null, weekWrites: [] }

  const writer = {
    async getPlan() {
      return state.plan
    },
    async putPlan(plan) {
      state.plan = plan
    },
    async putWeek(week) {
      // Marca de tiempo por escritura (spec §3.2): es lo que permite medir la
      // latencia real de una semana, incluidos sus reintentos, sin depender de
      // la duración de un único intento.
      state.weekWrites.push({ weekIndex: week.weekIndex, status: week.status, at: now() })
      const index = state.weeks.findIndex((candidate) => candidate.weekIndex === week.weekIndex)
      if (index >= 0) state.weeks[index] = week
      else state.weeks.push(week)
    },
    async putAttempt(attempt) {
      state.attempts.push(attempt)
    },
    async putJob(job) {
      state.job = job
    },
  }

  return {
    writer,
    snapshot: () => ({
      plan: state.plan,
      weeks: [...state.weeks],
      attempts: [...state.attempts],
      job: state.job,
      weekWrites: [...state.weekWrites],
    }),
  }
}

/**
 * Envuelve `callLLM` para medir TAMAÑOS de entrada y salida por semana sin
 * guardar contenido. La clave es el índice de semana del traceId, que el loop
 * construye como `${jobId}-week-${weekIndex}` (`asyncGenerationLoop.ts:986`),
 * con sufijo `-attempt-N` en los reintentos.
 */
export function instrumentCallLLM(callLLM) {
  const sizesByWeek = new Map()

  const wrapped = async (request) => {
    const weekIndex = Number(/week-(\d+)/.exec(request.traceId)?.[1] ?? -1)
    const promptChars = JSON.stringify(request.messages ?? request).length
    const entry = sizesByWeek.get(weekIndex) ?? { promptChars: 0, responseChars: 0 }
    // Registrar la entrada ANTES de esperar al proveedor: timeouts, 429, 5xx y
    // errores de red también son intentos reales y pueden provocar reintentos.
    entry.promptChars += promptChars
    sizesByWeek.set(weekIndex, entry)

    const response = await callLLM(request)
    entry.responseChars += (response?.text ?? '').length
    return response
  }

  return { wrapped, sizesFor: (weekIndex) => sizesByWeek.get(weekIndex) ?? null }
}

/**
 * Poller en memoria que imita la secuencia real del cliente: consulta primero y
 * DESPUÉS duerme el intervalo (`pollPlanGeneration.ts`). Mide descubrimiento,
 * no visibilidad: `first_week_visible_ms` queda reservado para una medición con
 * UI real.
 */
export function createDetectionPoller(input) {
  const now = input.now ?? Date.now
  let detectedAt = null
  let stopped = false
  let pending = Promise.resolve()

  const check = () => {
    if (detectedAt !== null) return
    const weeks = input.snapshot().weeks ?? []
    if (weeks.some((week) => input.isReadyWeek(week))) detectedAt = now()
  }

  const loop = async () => {
    while (!stopped) {
      check()
      if (detectedAt !== null) return
      await new Promise((resolve) => setTimeout(resolve, input.intervalMs))
    }
  }

  return {
    start() {
      pending = loop()
    },
    stop() {
      stopped = true
    },
    /** Para los tests: espera a que el ciclo actual haga una consulta más. */
    async waitForNextCheck() {
      await new Promise((resolve) => setTimeout(resolve, input.intervalMs))
      check()
    },
    /**
     * Cierra el poller SIN perder una detección de último momento: la semana
     * puede haber quedado lista mientras el ciclo dormía, y el plan terminar
     * antes del siguiente tick. Sin esta consulta final, un plan exitoso
     * registraría `firstWeekDetectedMs: null`.
     */
    async settle() {
      stopped = true
      await pending
      check()
    },
    result() {
      return {
        firstWeekDetectedMs: detectedAt === null ? null : detectedAt - input.workerStartedAt,
      }
    },
  }
}

/**
 * Carga el TypeScript de `src/` y de `netlify/` sin transpilarlo aparte, con el
 * mismo truco que `loadtest-week-creator.mjs`: un dev server de Vite en
 * middleware mode. No requiere tsx ni un runtime extra que mantener alineado.
 */
export async function loadRuntime() {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })

  const [loopModule, callerModule, runConfigModule, versionsModule, qualityModule, weekUtilsModule, pollingModule] =
    await Promise.all([
      vite.ssrLoadModule('/src/services/planBuilder/asyncGenerationLoop.ts'),
      vite.ssrLoadModule('/netlify/functions/_shared/anthropicCaller.ts'),
      vite.ssrLoadModule('/netlify/functions/_shared/planBuilderRunConfig.ts'),
      vite.ssrLoadModule('/src/services/planBuilder/telemetryVersions.ts'),
      vite.ssrLoadModule('/src/services/planBuilder/qualityReview.ts'),
      vite.ssrLoadModule('/src/services/planBuilder/weekUtils.ts'),
      vite.ssrLoadModule('/src/services/planBuilder/pollingConfig.ts'),
    ])

  return {
    vite,
    runAsyncPlanGeneration: loopModule.runAsyncPlanGeneration,
    callAnthropicForWeek: callerModule.callAnthropicForWeek,
    resolveEffectivePlanBuilderConfig: runConfigModule.resolveEffectivePlanBuilderConfig,
    buildVariantId: versionsModule.buildVariantId,
    countRepairsV2: qualityModule.countRepairsV2,
    reviewPlanQuality: qualityModule.reviewPlanQuality,
    isReadyWeek: weekUtilsModule.isReadyWeek,
    pollIntervalMs: pollingModule.PLAN_GENERATION_POLL_INTERVAL_MS,
    close: () => vite.close(),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: PASS, 50 tests.

- [ ] **Step 5: Commit (owner)**

```bash
git add scripts/loadtest-plan-builder/runtime.mjs scripts/loadtest-plan-builder.test.js
git commit -m "test(loadtest): add in-memory writer and detection poller"
```

---

### Task 7: CLI del driver

**Files:**
- Create: `scripts/loadtest-plan-builder.mjs`
- Modify: `package.json`, `scripts/loadtest-plan-builder.test.js`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: `parseArgs(argv)`, `assertRunGuards(env)`, `defaultArtifactPath(now)` — exportados para test; `main()` no se exporta.

- [ ] **Step 1: Write the failing test**

Agregar a `scripts/loadtest-plan-builder.test.js`:

```js
import {
  assertRunGuards,
  defaultArtifactPath,
  parseArgs,
} from './loadtest-plan-builder.mjs'

describe('loadtest CLI', () => {
  it('routes --report to the pure path', () => {
    expect(parseArgs(['--report', 'loadtest-results/x.json'])).toEqual({
      mode: 'report',
      artifactPath: 'loadtest-results/x.json',
    })
  })

  it('defaults to the paid run mode', () => {
    expect(parseArgs([])).toEqual({ mode: 'run', artifactPath: null })
  })

  it('fails the run mode without the enabling env', () => {
    expect(() => assertRunGuards({ CLAUDE_API_KEY: 'k' })).toThrow(/LOADTEST_PLAN_BUILDER/)
  })

  it('fails the run mode without an API key', () => {
    expect(() => assertRunGuards({ LOADTEST_PLAN_BUILDER: '1' })).toThrow(/CLAUDE_API_KEY/)
  })

  it('passes when both guards are set', () => {
    expect(() => assertRunGuards({ LOADTEST_PLAN_BUILDER: '1', CLAUDE_API_KEY: 'k' })).not.toThrow()
  })

  it('names artifacts by timestamp under loadtest-results', () => {
    expect(defaultArtifactPath(new Date('2026-09-01T10:20:30.000Z')))
      .toBe('loadtest-results/plan-builder-2026-09-01T10-20-30-000Z.json')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: FAIL — no se resuelve `./loadtest-plan-builder.mjs`.

- [ ] **Step 3: Write the CLI**

Crear `scripts/loadtest-plan-builder.mjs`:

```js
/**
 * Driver de loadtest del Plan Builder (spec §3.1). Corre el proveedor REAL y
 * cuesta dinero: exige `LOADTEST_PLAN_BUILDER=1` y `CLAUDE_API_KEY`.
 *
 *   npm run loadtest:plan-builder                       # corrida pagada
 *   npm run loadtest:plan-builder -- --report <ruta>    # solo lee un artefacto
 *
 * El modo `--report` es puro: no llama al proveedor ni exige credenciales.
 */
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { buildManifest, buildPlanFixture } from './loadtest-plan-builder/manifest.mjs'
import { buildArtifact, evaluateAcceptance, toPlanRow, toWeekRow } from './loadtest-plan-builder/artifact.mjs'
import { buildReport, renderReport } from './loadtest-plan-builder/report.mjs'
import { createDetectionPoller, createMemoryWriter, instrumentCallLLM, loadRuntime } from './loadtest-plan-builder/runtime.mjs'

export function parseArgs(argv) {
  const reportIndex = argv.indexOf('--report')
  if (reportIndex >= 0) {
    return { mode: 'report', artifactPath: argv[reportIndex + 1] ?? null }
  }
  return { mode: 'run', artifactPath: null }
}

export function assertRunGuards(env) {
  if (env.LOADTEST_PLAN_BUILDER !== '1') {
    throw new Error('Corrida pagada bloqueada: exporta LOADTEST_PLAN_BUILDER=1 para confirmar.')
  }
  if (!env.CLAUDE_API_KEY) {
    throw new Error('CLAUDE_API_KEY no configurada; el loadtest usa el proveedor real.')
  }
}

export function defaultArtifactPath(now) {
  return `loadtest-results/plan-builder-${now.toISOString().replace(/[:.]/g, '-')}.json`
}

function readGit() {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()
  return { sha, dirty: status.length > 0 }
}

async function runCase(runtime, manifestCase, variant) {
  const { plan, weeks, profile, wizardConfig } = buildPlanFixture(manifestCase)
  const { writer, snapshot } = createMemoryWriter()
  const { wrapped: callLLM, sizesFor } = instrumentCallLLM(runtime.callAnthropicForWeek)
  const workerStartedAt = Date.now()
  const jobId = `loadtest-job-${manifestCase.caseId}`

  const seededPlan = {
    ...plan,
    generationState: 'generating',
    generationSummary: {
      startedAt: workerStartedAt,
      jobId,
      strategy: 'single',
      completedWeeks: 0,
      failedWeeks: [],
      totalAttempts: 0,
      heartbeatAt: workerStartedAt,
    },
  }

  // El poller arranca ANTES del loop: si arrancara después, el lag de
  // descubrimiento quedaría subestimado por construcción.
  const poller = createDetectionPoller({
    snapshot,
    isReadyWeek: runtime.isReadyWeek,
    workerStartedAt,
    intervalMs: runtime.pollIntervalMs,
  })
  poller.start()

  let errorClass = null
  try {
    await runtime.runAsyncPlanGeneration({
      plan: seededPlan,
      weeks,
      profile,
      wizardConfig,
      jobId,
      writer,
      callLLM,
      concurrency: variant.concurrency,
      enqueuedAt: workerStartedAt,
      variant,
    })
  } catch (caught) {
    // Solo la clase, nunca el mensaje: el texto del proveedor puede citar
    // contenido generado y el artefacto no lleva contenido.
    errorClass = caught?.code ?? caught?.name ?? 'run_threw'
  } finally {
    await poller.settle()
  }

  const state = snapshot()
  const job = state.job ?? {}
  const detection = poller.result()
  const review = state.plan
    ? runtime.reviewPlanQuality(state.plan, state.weeks, { profile })
    : null

  const weekRows = state.weeks.map((week) => {
    const attempts = state.attempts.filter((attempt) => attempt.weekIndex === week.weekIndex)
    const writes = state.weekWrites.filter((entry) => entry.weekIndex === week.weekIndex)
    const sizes = sizesFor(week.weekIndex)
    return toWeekRow(week, {
      scenarioKey: manifestCase.scenarioKey,
      countRepairsV2: runtime.countRepairsV2(week),
      // Tamaños, no contenido.
      promptChars: sizes?.promptChars ?? null,
      responseChars: sizes?.responseChars ?? null,
      promptTokens: attempts.reduce((sum, attempt) => sum + (attempt.promptTokens ?? 0), 0) || null,
      completionTokens: attempts.reduce((sum, attempt) => sum + (attempt.completionTokens ?? 0), 0) || null,
      // Suma de TODOS los intentos: con retry, la duración del último subestima
      // lo que costó la semana.
      durationMs: attempts.reduce((sum, attempt) => sum + (attempt.durationMs ?? 0), 0) || null,
      // De marca de escritura a marca de escritura: incluye reintentos y la
      // espera real, que es lo que un atleta percibe.
      wallClockMs: writes.length > 1 ? writes[writes.length - 1].at - writes[0].at : null,
      score: review?.weeks.find((entry) => entry.weekIndex === week.weekIndex)?.score ?? null,
      grade: review?.weeks.find((entry) => entry.weekIndex === week.weekIndex)?.grade ?? null,
    })
  })

  return toPlanRow({
    caseId: manifestCase.caseId,
    scenarioKey: manifestCase.scenarioKey,
    weekCount: manifestCase.weekCount,
    outcome: job.outcome ?? 'failed',
    weekCountSucceeded: job.weekCountSucceeded ?? 0,
    weekCountFailed: job.weekCountFailed ?? 0,
    firstWeekReadyMs: job.firstWeekReadyMs ?? null,
    firstWeekReadyE2eMs: job.firstWeekReadyE2eMs ?? null,
    firstWeekDetectedMs: detection.firstWeekDetectedMs,
    firstWeekDetectionLagMs: detection.firstWeekDetectedMs === null || job.firstWeekReadyMs == null
      ? null
      : detection.firstWeekDetectedMs - job.firstWeekReadyMs,
    planCompleteMs: job.planCompleteMs ?? null,
    terminalMs: job.terminalMs ?? null,
    totalInputTokens: job.totalInputTokens ?? 0,
    totalOutputTokens: job.totalOutputTokens ?? 0,
    totalCacheReadTokens: job.totalCacheReadTokens ?? 0,
    totalCacheCreationTokens: job.totalCacheCreationTokens ?? 0,
    estimatedCostUsd: job.estimatedCostUsd ?? null,
    retryCount: state.attempts.filter((attempt) => attempt.retryUsed).length,
    fallbackUsed: state.weeks.some((week) => (week.generationMeta?.addedFallbackCount ?? 0) > 0),
    observedModels: [...new Set(state.attempts.map((attempt) => attempt.model).filter(Boolean))],
    qualityVersion: review?.qualityVersion ?? null,
    planScore: review?.score ?? null,
    planGrade: review?.grade ?? null,
    issueCodes: review ? [...new Set(review.issues.map((issue) => issue.code))] : [],
    errorClass,
    promptChars: weekRows.reduce((sum, week) => sum + (week.promptChars ?? 0), 0) || null,
    responseChars: weekRows.reduce((sum, week) => sum + (week.responseChars ?? 0), 0) || null,
    weeks: weekRows,
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.mode === 'report') {
    if (!args.artifactPath) throw new Error('Uso: --report <ruta-al-artefacto>')
    const artifact = JSON.parse(await readFile(args.artifactPath, 'utf8'))
    console.log(renderReport(buildReport(artifact)))
    return 0
  }

  assertRunGuards(process.env)

  const runtime = await loadRuntime()
  const effectiveConfig = runtime.resolveEffectivePlanBuilderConfig(process.env)
  const variant = { ...effectiveConfig, variantId: runtime.buildVariantId(effectiveConfig) }
  const manifest = buildManifest()
  const artifactPath = defaultArtifactPath(new Date())
  const plans = []

  try {
    // Planes SECUENCIALES: paralelizarlos convertiría capacidad y rate limits
    // en otra variable. La concurrencia interna de semanas queda en la productiva.
    for (const [index, manifestCase] of manifest.entries()) {
      process.stdout.write(`[${index + 1}/${manifest.length}] ${manifestCase.caseId} `)
      const planRow = await runCase(runtime, manifestCase, variant)
      plans.push(planRow)
      console.log(`${planRow.outcome} terminalMs=${planRow.terminalMs ?? '—'}`)
    }
  } finally {
    // El artefacto se escribe AUNQUE la corrida falle a mitad: conserva toda la
    // evidencia parcial de una corrida pagada. `observedTargetWeeks` lo deriva
    // `evaluateAcceptance` de las filas, no se declara acá.
    const artifact = buildArtifact({ plans, variant, git: readGit() })
    await mkdir(dirname(artifactPath), { recursive: true })
    await writeFile(artifactPath, JSON.stringify(artifact, null, 2))
    console.log(`\nArtefacto: ${artifactPath}`)
    console.log(renderReport(buildReport(artifact)))

    const verdict = evaluateAcceptance(artifact)
    if (!verdict.accepted) {
      console.error('\nControl NO aceptable:')
      for (const reason of verdict.reasons) console.error(`  - ${reason}`)
    } else {
      console.log('\nControl aceptable para calibración.')
    }
    await runtime.close()
    process.exitCode = verdict.accepted ? 0 : 1
  }
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('loadtest-plan-builder.mjs')
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
```

- [ ] **Step 4: Add the npm script**

En `package.json`, junto a `loadtest:week-creator`:

```json
    "loadtest:plan-builder": "node scripts/loadtest-plan-builder.mjs",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run scripts/loadtest-plan-builder.test.js`
Expected: PASS, 94 tests.

- [ ] **Step 6: Verify the guards without spending a token**

Run: `env -u LOADTEST_PLAN_BUILDER npm run loadtest:plan-builder`
Expected: sale con error `Corrida pagada bloqueada: exporta LOADTEST_PLAN_BUILDER=1 para confirmar.` y exit code 1. No debe abrir Vite ni llamar al proveedor.

**Cuidado:** la segunda verificación arranca la corrida pagada si `CLAUDE_API_KEY` ya está exportada en el shell. Removerla explícitamente:

Run: `env -u CLAUDE_API_KEY LOADTEST_PLAN_BUILDER=1 npm run loadtest:plan-builder`
Expected: `CLAUDE_API_KEY no configurada; el loadtest usa el proveedor real.` y exit code 1.

Run: `npm run loadtest:plan-builder -- --report loadtest-results/no-existe.json`
Expected: falla por archivo inexistente, **sin** pedir credenciales — confirma que el modo reporte no pasa por los guards.

- [ ] **Step 7: Commit (owner)**

```bash
git add scripts/loadtest-plan-builder.mjs scripts/loadtest-plan-builder.test.js package.json
git commit -m "feat(loadtest): add the plan builder loadtest driver"
```

---

### Task 8: Verificación completa y documentación

**Files:**
- Modify: `CLAUDE.md`, `PROJECT_REVIEW_AND_ROADMAP.md`

- [ ] **Step 1: Confirm the suite gained no skipped loadtest file**

Run: `npm test 2>&1 | tail -6`
Expected: todos los archivos pasan, ninguno omitido. El conteo sube por `pollingConfig.test.ts` y `loadtest-plan-builder.test.js`; registrar el número final.

Run: `grep -rn "loadtest-plan-builder.mjs" --include="*.test.*" src scripts | grep -v "loadtest-plan-builder.test.js"`
Expected: sin resultados — nadie más importa el driver.

- [ ] **Step 2: Full verification**

Run: `npm run lint && npm test && npm run build`
Expected: los tres en verde. Recordar que ESLint solo cubre `**/*.{ts,tsx}`: de este plan solo se lintea `pollingConfig.ts`.

- [ ] **Step 3: Update docs**

En `CLAUDE.md`, actualizar el conteo de suite y agregar al bloque de Plan Builder:

```
- **Plan Builder loadtest — Plan 3 Entrega 1** (2026-07-25): `scripts/loadtest-plan-builder.mjs` corre `runAsyncPlanGeneration` contra el proveedor real con writer en memoria (sin Dexie ni Supabase), sobre un manifest congelado de 6 escenarios × 2 planes / 42 semanas. Emite artefacto allowlisted en `loadtest-results/` y un reporte de latencia por plan + tres distribuciones de reparación. `npm run loadtest:plan-builder` exige `LOADTEST_PLAN_BUILDER=1` y `CLAUDE_API_KEY`; `-- --report <ruta>` es puro. Pendiente: corrida de control del owner y Entrega 2 (calibración + activación de v2).
```

En `PROJECT_REVIEW_AND_ROADMAP.md`, agregar la entrada equivalente en la sección de Plan Builder measurement foundation.

- [ ] **Step 4: Commit (owner)**

```bash
git add CLAUDE.md PROJECT_REVIEW_AND_ROADMAP.md
git commit -m "docs: record the plan builder loadtest driver"
```

---

## Handoff al owner (fuera del plan)

Después de la Task 8, la corrida de control es del owner:

```bash
LOADTEST_PLAN_BUILDER=1 CLAUDE_API_KEY=... npm run loadtest:plan-builder
```

Costo esperado ≈ US$1,95; techo ≈ US$3,90. Dura del orden de 20–40 minutos (12 planes secuenciales).

El árbol debe estar **limpio** al correrlo: el artefacto registra `git.dirty`, y la Entrega 2 rechaza un control con `git.dirty === true` porque un SHA por sí solo no identifica el código que produjo la muestra. El nombre contractual es `git: { sha, dirty }` en el artefacto; el registro de calibración de Entrega 2 lo aplana a `gitSha` / `gitDirty`.

Con el artefacto aceptado, se planifica la Entrega 2: copia sanitizada a `docs/superpowers/calibrations/`, `qualityCalibrationV2.ts` con los tres contratos congelados, guard de procedencia y activación efectiva de v2.

---

## Cobertura del spec

| Requisito del spec | Task |
|---|---|
| §3.1 driver `.mjs` + `.test.js`, guards de env | 7 |
| §3.1 `npm test` sin llamadas reales ni archivos omitidos | 8 |
| §3.2 writer en memoria, sin Dexie ni Supabase | 6 |
| §3.3 manifest congelado 6×2 / 42 semanas | 2 |
| §3.3 escenarios fieles al motor (sports permitidos, fases, enums, injuryNotes) | 2 |
| §3.3 semana parcial real (startDate a mitad de semana, `weekStartDate` lunes) | 2 |
| §3.3 cuatro condiciones de aceptación, derivadas del manifest embebido | 4 |
| §3.3 caveat con n real | 4, 5 |
| §3.5 manifest embebido con perfil y wizard config (procedencia de Entrega 2) | 4 |
| §3.4 intervalo compartido, no duplicado | 1 |
| §3.4 tres timings desde el mismo `workerStartedAt`, lag null | 6, 7 |
| §3.4 p50/p95 por plan en dos cohortes, nulls excluidos | 3, 5 |
| §3.4 nearest-rank congelado | 3 |
| §3.5 artefacto allowlisted, `artifactSchemaVersion`, `weeks[]` | 4 |
| §3.5 allowlist re-aplicada en la frontera final; `errorClass`, no texto crudo | 4, 7 |
| §3.5 tamaños de entrada/salida por semana y por plan (instrumentados, no null) | 4, 6, 7 |
| §3.2 marca de tiempo por escritura en el writer | 6 |
| §3.5 procedencia autocontenida: el manifest embebido incluye sportDetails y descriptor por semana | 2, 4 |
| §3.5 artefacto escrito aunque falle; exit code | 7 |
| §3.6 reporte puro `--report`, describe y no propone | 5, 7 |
| §3.6 tres distribuciones también por escenario; latencia semanal secundaria | 5 |
| §3.6 el reporte valida `artifactSchemaVersion` | 5 |
| §3.7–§3.10 (Entrega 2) | fuera de este plan |

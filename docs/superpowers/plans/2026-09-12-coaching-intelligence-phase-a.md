# Fase A — correcciones acotadas e identidad · Plan de implementación

> Estado 2026-09-13: las 11 tareas están implementadas y revisadas. La revisión
> adicional corrigió los hallazgos del cierre; suite completa 5406/5406, lint y
> build verdes. Ver [informe de cierre](../../reviews/2026-09-13-coaching-phase-a-review.md).
> Los checklists y snippets siguientes se conservan como plan histórico; el
> informe documenta las correcciones posteriores y las precondiciones del smoke.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar F02, F03, F05, F07 y F01 con evidencia de recorrido real, dejar la telemetría existente honesta (parte de F15) y proteger F04, sin migraciones ni cambios de esquema Dexie.

**Architecture:** Cada tarea parte de un caso rojo tomado del probe del 8 de septiembre y termina con un test que atraviesa el recorrido productivo (hidratación → propuesta aplicable; dosificación → reparación → serializador; formulario → patch → sesión; página → store → engine → persistencia). No se crean contratos compartidos nuevos salvo tres módulos pequeños: señales de ejecución del Week Creator, scope de request e intención pendiente. `repairWeek.ts` y `actionPostProcessor.ts` no se reestructuran.

**Tech Stack:** React 18 + TypeScript + Vite + Vitest (jsdom para componentes) + Zustand + Dexie. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-09-12-coaching-intelligence-refactor-design.md` (secciones 4 y 8).

## Global Constraints

- **Los commits los hace el owner.** Ninguna tarea ejecuta `git add` ni `git commit`. Cada tarea termina en un *checkpoint*: suite del área verde, `npm run lint` verde, y un resumen de archivos tocados para que el owner commitee.
- Sin migraciones remotas ni cambio de versión de Dexie (hoy **v20**). Los campos nuevos viajan dentro de `sessions.data` (jsonb) y son opcionales.
- `promptBuilder.ts` se toca sólo con el contexto completo revisado; en esta fase el único cambio de prompt es el bloque de ofertas estructuradas de la Tarea 8, y va en `prompt/packs/quality/generalChat.ts`, no en `promptBuilder.ts`.
- El normalizador de respuestas **no** admite que el modelo emita identidad de contenido (`libraryRef`, `supersetGroup`, ids de drills). Los eventos conversacionales de la Tarea 8 no transportan identidad.
- Nunca el literal `'default'` fuera de `activeAthlete.ts`.
- Toda lectura de `sessions`/`dayLogs`/`weekSummaries`/`coachProposals`/`chatMessages` fuera de sync pasa por `filterRowsToActiveScope`/`isRowInActiveScope`; toda creación local se estampa con `withActiveAthleteStamp`.
- Comandos: tests `npx vitest run <ruta>`; suite completa `npm test`; lint `npm run lint`; tipos `npx tsc -b --pretty false`; build `npm run build`.
- Textos visibles al usuario en español; "la T" en femenino si aparece squash.

## Mapa de dependencias

```
Carril "motor" (aislado, paralelizable entre sí):
  T1 A1 señales
  T2 A2 squash accesorio
  T3 A3.1 procedencia running ─► T4 A3.2 formulario

Carril "chat" (SECUENCIAL: todas tocan useChatStore, ChatCoach o los tipos de IA):
  T5 A5 identidad ─► T6 A4.1 corpus+engine ─► T7 A4.2 UI ─► T8 A4.3 eventos ─► T9 A4.4 intención ─► T10 A6 medición

T11 A7 guard F04 + probes: al final, cuando ambos carriles cerraron.
```

Sólo el carril "motor" admite trabajo paralelo, con una salvedad: **T3 toca
`src/types/index.ts`, igual que T9 (`ChatContext.pendingOperation`) y T10
(`ChatContextMetadata`)**. Regla: T3 se integra (checkpoint del owner) **antes**
de que empiece T9; mientras T3 esté abierta, ese archivo tiene un solo
propietario. El carril "chat" se ejecuta en orden y con revisión al cerrar cada
tarea: T10 modifica un test creado en T5 y usa tipos de T8; T9 usa el scope de
T5, el corpus de T6, la proyección de UI de T7 y los eventos de T8.

**Orden de arranque recomendado:** T1 y T2 primero (aislados, sin `types`),
T3→T4 en paralelo con el inicio del carril de chat (T5, T6, T7, T8), integrar
T3 antes de T9, y cerrar con T9, T10 y T11.

---

### Task 1: A1 — las señales de ejecución llegan al hidratador del Week Creator (F02)

**Files:**
- Create: `src/services/weekCreator/weekCreatorExecutionSignals.ts`
- Modify: `src/services/weekCreator/WeekCreatorPromptBuilder.ts` (función `buildLoadDirective`, ~línea 572, y `computeRecentRpeStats`, ~línea 603)
- Modify: `src/services/weekCreator/WeekCreatorLocalHydrator.ts` (función `buildWeekCreatorHydrationRepairContext`, return ~línea 518)
- Test: `src/services/weekCreator/__tests__/weekCreatorExecutionSignals.test.ts`
- Test: `src/services/weekCreator/__tests__/WeekCreatorLocalHydrator.test.ts` (agregar casos)

**Interfaces:**
- Produces: `buildWeekCreatorExecutionSignals(config: Pick<WeekCreatorEffectiveConfig, 'currentFatigue'>, sessions: ChatContext['historicalSessions'], logs: ChatContext['weekDayLogs']): ExecutionSignals` y `computeRecentRpeStats(sessions): { average: number; count: number }`.
- Consumes: `ExecutionSignals`, `decideLoadDirective` de `src/services/training/loadDirectivePolicy.ts`; `isWhoopPrefilled` de `src/services/readiness/dayLogPrefillSave.ts`; `RepairContext.executionSignals` ya existe en `repairWeek.ts`.

- [ ] **Step 1: Escribir el test unitario rojo del módulo nuevo**

```ts
// src/services/weekCreator/__tests__/weekCreatorExecutionSignals.test.ts
import { describe, expect, it } from 'vitest'
import { decideLoadDirective } from '../../training/loadDirectivePolicy'
import { buildWeekCreatorExecutionSignals } from '../weekCreatorExecutionSignals'

describe('buildWeekCreatorExecutionSignals', () => {
  it('transporta dolor declarado y la directiva resuelve reduce', () => {
    const signals = buildWeekCreatorExecutionSignals(
      { currentFatigue: 'normal' },
      [],
      [{ id: 'log-1', date: '2026-07-19', painLevel: 8, updatedAt: 0 }],
    )
    expect(signals.latestPainLevel).toBe(8)
    expect(signals.declaredFatigue).toBe('normal')
    expect(decideLoadDirective(signals).verdict).toBe('reduce')
  })

  it('excluye energía prellenada por Whoop pero conserva el dolor', () => {
    const signals = buildWeekCreatorExecutionSignals(
      { currentFatigue: 'normal' },
      [],
      [{ id: 'log-1', date: '2026-07-19', energyLevel: 3, painLevel: 2, prefillSource: { energyLevel: 'whoop' }, updatedAt: 0 }],
    )
    expect(signals.latestEnergyLevel).toBeUndefined()
    expect(signals.latestPainLevel).toBe(2)
    expect(decideLoadDirective(signals).verdict).toBe('no_signal')
  })

  it('cuenta sólo RPE reales de sesiones ejecutadas', () => {
    const signals = buildWeekCreatorExecutionSignals(
      { currentFatigue: 'normal' },
      [
        { id: 's1', date: '2026-07-13', weekStartDate: '2026-07-13', timeBlock: 'AM', type: 'squash', status: 'completed', title: 'A', durationMin: 60, actualRpe: 9, createdAt: 0, updatedAt: 0 },
        { id: 's2', date: '2026-07-14', weekStartDate: '2026-07-13', timeBlock: 'AM', type: 'squash', status: 'planned', title: 'B', durationMin: 60, actualRpe: 9, createdAt: 0, updatedAt: 0 },
      ],
      [],
    )
    expect(signals.rpeSampleCount).toBe(1)
    expect(signals.avgActualRpe).toBe(9)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/weekCreator/__tests__/weekCreatorExecutionSignals.test.ts`
Expected: FAIL — `Cannot find module '../weekCreatorExecutionSignals'`.

- [ ] **Step 3: Crear el módulo**

```ts
// src/services/weekCreator/weekCreatorExecutionSignals.ts
import type { ChatContext } from '../../types'
import { isWhoopPrefilled } from '../readiness/dayLogPrefillSave'
import type { ExecutionSignals } from '../training/loadDirectivePolicy'
import type { WeekCreatorEffectiveConfig } from './WeekCreatorConfig'

/**
 * Única construcción de `ExecutionSignals` del Week Creator. La consumen el
 * prompt (`buildLoadDirective`) y el contexto de reparación del hidratador,
 * para que la señal que ve el modelo sea la misma que ve la composición local.
 *
 * `logs[0]` es el registro más reciente: el mismo criterio que usaba el prompt.
 */
export function buildWeekCreatorExecutionSignals(
  config: Pick<WeekCreatorEffectiveConfig, 'currentFatigue'>,
  sessions: ChatContext['historicalSessions'],
  logs: ChatContext['weekDayLogs'],
): ExecutionSignals {
  const rpeStats = computeRecentRpeStats(sessions)
  const latestLog = logs?.[0]
  return {
    declaredFatigue: config.currentFatigue,
    latestEnergyLevel: latestLog && !isWhoopPrefilled(latestLog, 'energyLevel')
      ? latestLog.energyLevel ?? undefined
      : undefined,
    latestPainLevel: latestLog?.painLevel ?? undefined,
    avgActualRpe: rpeStats.count > 0 ? rpeStats.average : undefined,
    rpeSampleCount: rpeStats.count,
  }
}

export function computeRecentRpeStats(
  sessions: ChatContext['historicalSessions'],
): { average: number; count: number } {
  const values = (sessions ?? [])
    .filter((session) => session.status === 'completed' || session.status === 'adjusted')
    .map((session) => session.actualRpe)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (values.length === 0) return { average: 0, count: 0 }
  return {
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    count: values.length,
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/weekCreator/__tests__/weekCreatorExecutionSignals.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Hacer que el prompt use el módulo**

En `WeekCreatorPromptBuilder.ts`:
1. Agregar al import: `import { buildWeekCreatorExecutionSignals, computeRecentRpeStats } from './weekCreatorExecutionSignals'`.
2. Borrar la función local `computeRecentRpeStats` (queda la importada; misma firma).
3. Reemplazar el cuerpo de `buildLoadDirective` para que la decisión salga del módulo:

```ts
function buildLoadDirective(
  config: WeekCreatorEffectiveConfig,
  sessions: ChatContext['historicalSessions'],
  logs: ChatContext['weekDayLogs'],
): string {
  const decision = decideLoadDirective(buildWeekCreatorExecutionSignals(config, sessions, logs))
  const rendered = renderLoadDirective(decision)
  if (rendered) return rendered

  // Caminos propios de Week Creator que el policy no cubre porque son de
  // arranque, no de ejecución.
  if (!sessions || sessions.length === 0) {
    return 'INICIAR CON CARGA CONSERVADORA — sin historial previo. RPE 6-7.'
  }
  return 'MANTENER PROGRESIÓN NORMAL — fatiga normal, sin señales de alerta.'
}
```

4. En `buildProgressionContext`, la llamada pasa a `buildLoadDirective(config, sessions, logs)` (sin `rpeStats`); `rpeStats` sigue calculándose ahí para la línea "RPE promedio reciente".

- [ ] **Step 6: Correr los tests del prompt builder para confirmar que no cambió el comportamiento**

Run: `npx vitest run src/services/weekCreator/__tests__/WeekCreatorPromptBuilder.test.ts`
Expected: PASS, mismo número de tests que antes.

- [ ] **Step 7: Escribir el test rojo del hidratador (unidad + recorrido)**

Agregar al final de `src/services/weekCreator/__tests__/WeekCreatorLocalHydrator.test.ts` (reutiliza `makeContext`, `makeConfig`, `session`, `response`, `TARGET_WEEK` del archivo):

```ts
import { buildWeekCreatorHydrationRepairContext } from '../WeekCreatorLocalHydrator'
import { decideLoadDirective } from '../../training/loadDirectivePolicy'
import { hasSquashCompetitiveExposureContent } from '../../training/squashMatchRole'

describe('A1 — señales de ejecución en el contexto de reparación', () => {
  it('transporta el dolor declarado al RepairContext', () => {
    const context = makeContext()
    context.weekDayLogs = [{ id: 'log-1', date: '2026-07-19', painLevel: 8, updatedAt: 0 }]
    const repairContext = buildWeekCreatorHydrationRepairContext({
      context,
      config: makeConfig(),
      targetWeekStart: TARGET_WEEK,
    })
    expect(repairContext.executionSignals?.latestPainLevel).toBe(8)
    expect(decideLoadDirective(repairContext.executionSignals ?? {}).verdict).toBe('reduce')
  })

  it('con dolor 8/10 la semana hidratada no materializa la meta de partidos duros', () => {
    // Fase build a ~5 semanas del evento; el test imprime la fase resuelta
    // para que quien lo ejecute confirme `build` antes de leer el resultado.
    const buildContext = (painLevel?: number) => {
      const context = makeContext()
      context.athleteProfile!.goalEvents = [{
        id: 'squash-event', title: 'Open objetivo', date: '2026-08-22', sport: 'squash',
        priority: 'primary', competitiveLevel: 'competitive',
      }]
      context.athleteProfile!.planWizardConfig = {
        goalEventId: 'squash-event', trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
        sessionsPerWeek: 6, sessionDurationMins: 60, allowDoubleSession: false,
        currentFitnessLevel: 'fit', currentFatigue: 'normal', partnerAvailability: 'partner',
        targetHardPrimaryMatches: 3, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
      }
      context.weekDayLogs = painLevel != null ? [{ id: 'log-1', date: '2026-07-19', painLevel, updatedAt: 0 }] : []
      return context
    }
    const config = makeConfig({
      trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
      sessionsPerWeek: 6, maxSessionsPerWeek: 6, targetHardPrimaryMatches: 3,
    })
    const skeleton: WeekCreatorSkeleton = {
      type: 'create_week', reason: 'Semana build', targetDate: TARGET_WEEK,
      sessions: [
        { ...session('2026-07-20', 'AM', 'squash', 'Squash técnico'), focusKey: 'squash_technical' },
        { ...session('2026-07-21', 'AM', 'squash', 'Squash control', undefined, 'control'), focusKey: 'squash_control' },
        { ...session('2026-07-22', 'AM', 'strength', 'Fuerza base'), focusKey: 'strength_lower' },
        { ...session('2026-07-23', 'AM', 'squash', 'Squash técnico 2'), focusKey: 'squash_technical' },
      ],
    }
    const hydrate = (painLevel?: number) => hydrateWeekCreatorSkeleton({
      skeleton, response: response(), context: buildContext(painLevel), config, targetWeekStart: TARGET_WEEK,
    })
    const phase = buildWeekCreatorHydrationRepairContext({ context: buildContext(), config, targetWeekStart: TARGET_WEEK }).week.phase
    expect(phase, 'el caso dirigido necesita fase build; ajusta la fecha del evento si cambia el calendario de fases').toBe('build')

    const countMatches = (result: WeekCreatorHydrationResult) => (result.response.actions?.[0]?.sessions ?? [])
      .filter((candidate) => candidate.sessionType === 'squash' && hasSquashCompetitiveExposureContent(candidate.squashDetails))
      .length
    const withoutPain = countMatches(hydrate())
    const withPain = countMatches(hydrate(8))
    expect(withoutPain).toBeGreaterThanOrEqual(2)
    expect(withPain).toBeLessThan(withoutPain)
    expect(withPain).toBeLessThanOrEqual(1)
  })
})
```

- [ ] **Step 8: Correr el test del hidratador y verificar que falla en los dos casos nuevos**

Run: `npx vitest run src/services/weekCreator/__tests__/WeekCreatorLocalHydrator.test.ts`
Expected: FAIL — `executionSignals` es `undefined` en el primero; en el segundo `withPain` no es menor que `withoutPain`.

Si el `expect(phase)` falla con `base` o `peak`, mover la fecha del evento (`2026-08-22`) una semana hacia adelante o atrás hasta obtener `build`. No cambiar el `TARGET_WEEK` compartido.

- [ ] **Step 9: Propagar las señales en el hidratador**

En `WeekCreatorLocalHydrator.ts`, importar `buildWeekCreatorExecutionSignals` desde `./weekCreatorExecutionSignals` y cambiar el `return` de `buildWeekCreatorHydrationRepairContext`:

```ts
  const historicalSessions = input.context.historicalSessions ?? input.context.recentSessions
  return {
    plan,
    week,
    profile,
    wizardConfig,
    planWeekDescriptors: [{ weekIndex: week.weekIndex, phase: week.phase }],
    historicalSessions,
    executionSignals: buildWeekCreatorExecutionSignals(
      input.config,
      historicalSessions,
      input.context.weekDayLogs,
    ),
  }
```

- [ ] **Step 10: Correr el test del hidratador y verificar que pasa**

Run: `npx vitest run src/services/weekCreator/__tests__/WeekCreatorLocalHydrator.test.ts`
Expected: PASS.

- [ ] **Step 11: Suite del área, tipos y lint**

Run: `npx vitest run src/services/weekCreator src/services/training/__tests__/loadDirectivePolicy.test.ts && npx tsc -b --pretty false && npm run lint`
Expected: todo verde.

- [ ] **Step 12: Checkpoint para el owner**

Archivos: `weekCreatorExecutionSignals.ts` (nuevo), `WeekCreatorPromptBuilder.ts`, `WeekCreatorLocalHydrator.ts`, dos tests. Mensaje sugerido: `fix(week-creator): las señales de ejecución llegan al contexto de reparación (F02)`.

---

### Task 2: A2 — el objetivo principal de squash se dosifica antes que el accesorio (F03)

**Files:**
- Modify: `src/services/training/squashSessionDose.ts` (reescritura completa; 60 líneas)
- Modify: `src/services/training/squashSessionHydrator.ts` (tipo `SquashHydrationWarningCode` y bloque final de `hydrateSquashSession`, ~línea 196)
- Test: `src/services/training/__tests__/sessionDose.test.ts` (agregar casos; ajustar el de idempotencia)
- Test: `src/services/training/__tests__/squashMainBlockSurvives.test.ts` (nuevo, recorrido)

**Interfaces:**
- Produces: `doseSquashSession(details, durationMin): { ok: true; details: SquashDetails; warnings: string[] } | { ok: false; message: string }`. Nuevo código de warning del hidratador: `'accessory_dropped'`.
- Consumes: `sessionBudget`, `splitSeconds`, `SESSION_COMPOSITION_MINUTES` de `sessionTimeBudget.ts`; `hydrateSquashSession`; `repairGeneratedWeek` de `repairWeek.ts`; `buildWeekCreatorHydrationRepairContext` de la Tarea 1 (ya exportada antes de A1); `sessionToTemplatePayload`, `templateToDraft` de `sessionTemplateSerializer.ts`.

- [ ] **Step 1: Escribir los tests rojos de dosificación**

Agregar a `src/services/training/__tests__/sessionDose.test.ts`:

```ts
describe('A2: el objetivo principal se dosifica antes que el accesorio', () => {
  it.each(['technical', 'control'] as const)('%s a 15 min con sombras accesorias conserva el bloque principal y avisa', (kind) => {
    const result = hydrateSquashSession({
      kind, durationMin: 15, phase: 'base', fatigueLevel: 3, goal: '', recentDrills: [],
      competitionSoon: false, withShadowsAccessory: true, partnerAvailability: 'either',
    })
    const kinds = result.details.blocks?.map(block => block.kind) ?? []
    expect(kinds).toContain(kind)
    expect(kinds).not.toContain('shadows')
    expect(result.warnings.some(warning => warning.code === 'accessory_dropped')).toBe(true)
    expect(result.details.drills.reduce((n, d) => n + (d.durationMin ?? 0), 0)).toBe(15)
  })

  it('a 45 min entran el bloque principal y las sombras', () => {
    const result = hydrateSquashSession({
      kind: 'technical', durationMin: 45, phase: 'base', fatigueLevel: 3, goal: '', recentDrills: [],
      competitionSoon: false, withShadowsAccessory: true, partnerAvailability: 'either',
    })
    const kinds = result.details.blocks?.map(block => block.kind) ?? []
    expect(kinds).toContain('technical')
    expect(kinds).toContain('shadows')
    expect(result.warnings.some(warning => warning.code === 'accessory_dropped')).toBe(false)
  })

  it.each(['technical', 'control', 'shadows', 'match'] as const)('%s en su duración mínima conserva su modalidad', (kind) => {
    const result = hydrateSquashSession({
      kind, durationMin: SESSION_COMPOSITION_MINUTES[kind], phase: 'build', fatigueLevel: 4, goal: '', recentDrills: [],
      competitionSoon: false, partnerAvailability: 'partner',
    })
    expect(result.details.sessionKind).toBe(kind)
    expect(result.details.blocks?.some(block => block.kind === kind)).toBe(true)
  })

  it('el ciclo trabajo/pausa se resuelve por bloque, no por la modalidad global', () => {
    const result = hydrateSquashSession({
      kind: 'technical', durationMin: 45, phase: 'base', fatigueLevel: 3, goal: '', recentDrills: [],
      competitionSoon: false, withShadowsAccessory: true, partnerAvailability: 'either',
    })
    const shadows = result.details.blocks?.find(block => block.kind === 'shadows')
    const technical = result.details.blocks?.find(block => block.kind === 'technical')
    expect(shadows?.drills[0]?.notes).toContain('hasta 30 s de trabajo')
    expect(technical?.drills[0]?.notes).toContain('hasta 120 s de trabajo')
  })
})
```

Importar `SESSION_COMPOSITION_MINUTES` desde `'../sessionTimeBudget'` al inicio del archivo si no está.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/services/training/__tests__/sessionDose.test.ts`
Expected: FAIL — los bloques a 15 min son `['shadows']` y `warnings` no contiene `accessory_dropped`.

- [ ] **Step 3: Reescribir `doseSquashSession`**

```ts
// src/services/training/squashSessionDose.ts
import type { SquashDetails, SquashDrill, SquashSessionBlock, SquashSessionBlockKind } from '../../types'
import { sessionBudget, SESSION_COMPOSITION_MINUTES, splitSeconds } from './sessionTimeBudget'

export type SquashDoseResult =
  | { ok: true; details: SquashDetails; warnings: string[] }
  | { ok: false; message: string }

const DOSE_MARKER = '\nDosis por tiempo: '
/** Tres minutos de práctica más pausas por drill; debajo de eso no hay drill viable. */
const MIN_DRILL_SEC = 180

/** durationMin includes the complete slot, including rests and the assigned
 * warmup/cooldown. Blocks and drills are two projections, never additive.
 * The timed instruction overrides catalog repetition examples explicitly.
 *
 * El bloque cuyo `kind` coincide con `sessionKind` recibe su dosis primero;
 * los accesorios entran sólo si queda al menos un drill viable, y si no caben
 * se retiran con advertencia. El accesorio cede antes que el objetivo.
 */
export function doseSquashSession(details: SquashDetails, durationMin: number): SquashDoseResult {
  const kind = resolveMainKind(details)
  const min = SESSION_COMPOSITION_MINUTES[kind]
  if (!Number.isFinite(durationMin) || durationMin < min || !details.drills.length) {
    return { ok: false, message: `No cabe una sesión de ${kind} en ${durationMin} min con contenido ejecutable; mínimo de composición ${min} min.` }
  }
  if (kind === 'match') {
    const drills = details.drills.map(drill => ({ ...drill,
      notes: `${(drill.notes ?? '').split(DOSE_MARKER)[0]}${DOSE_MARKER}Duración estimada por marcador; calentamiento y cierre incluidos en la reserva. El partido puede terminar antes o después.` }))
    return { ok: true, details: projectSingleBlock(details, kind, drills), warnings: [] }
  }

  const budget = sessionBudget(durationMin)
  const maxDrills = Math.max(1, Math.floor(budget.workSec / MIN_DRILL_SEC))
  const allocation = allocateDrillsByBlock(details, kind, maxDrills)
  const count = allocation.blocks.reduce((n, block) => n + block.drills.length, 0)
  const practice = splitSeconds(budget.workSec, count)

  let index = 0
  const blocks: SquashSessionBlock[] = allocation.blocks.map(block => {
    const drills = block.drills.map(drill => {
      const i = index++
      const warmup = i === 0 ? budget.warmupSec : 0
      const cooldown = i === count - 1 ? budget.cooldownSec : 0
      const roundWork = block.kind === 'shadows' ? 30 : 120
      const roundRest = 30
      const cycles = Math.floor(practice[i] / (roundWork + roundRest))
      const rest = Math.max(0, cycles * roundRest)
      const work = practice[i] - rest
      const parts = [
        warmup ? `Calentamiento progresivo ${warmup / 60} min` : '',
        `práctica ${work} s + pausas ${rest} s: alternar hasta ${roundWork} s de trabajo con ${roundRest} s suaves; terminar al cumplir el tiempo asignado`,
        cooldown ? `Enfriamiento suave ${cooldown / 60} min` : '',
      ].filter(Boolean)
      return { ...drill, durationMin: (practice[i] + warmup + cooldown) / 60,
        notes: `${(drill.notes ?? '').split(DOSE_MARKER)[0]}${DOSE_MARKER}${parts.join('; ')}. Todo incluido; las repeticiones del catálogo son referencias, no volumen adicional obligatorio.` }
    })
    return { ...block, drills, durationMin: drills.reduce((n, d) => n + (d.durationMin ?? 0), 0) }
  })
  const drills = blocks.flatMap(block => block.drills)
  return { ok: true, details: { ...details, drills, blocks }, warnings: allocation.warnings }
}

function resolveMainKind(details: SquashDetails): SquashSessionBlockKind {
  return details.sessionKind === 'mixed' ? 'technical' : details.sessionKind ?? 'technical'
}

/**
 * Reparte el cupo de drills por bloque: primero los bloques de la modalidad
 * principal, después los accesorios. Conserva el orden original de los
 * bloques en la salida (las sombras siguen yendo antes si el hidratador las
 * ordenó así), pero la RESERVA se decide por rol.
 */
function allocateDrillsByBlock(
  details: SquashDetails,
  mainKind: SquashSessionBlockKind,
  maxDrills: number,
): { blocks: Array<{ kind: SquashSessionBlockKind; drills: SquashDrill[] }>; warnings: string[] } {
  const source = details.blocks?.length
    ? details.blocks.map(block => ({ kind: block.kind, drills: block.drills }))
    : [{ kind: mainKind, drills: details.drills }]
  const hasMain = source.some(block => block.kind === mainKind)
  // Sin bloque principal declarado (contenido legacy con blocks de otra
  // modalidad), no hay accesorio que ceder: todo se trata como principal.
  const order = source
    .map((block, position) => ({ block, position, main: !hasMain || block.kind === mainKind }))
    .sort((a, b) => Number(b.main) - Number(a.main) || a.position - b.position)

  const warnings: string[] = []
  let remaining = maxDrills
  const chosen = order.map(({ block, position, main }) => {
    if (remaining <= 0) {
      if (!main) warnings.push(`Se retiró el bloque de ${block.kind}: no queda tiempo para un drill viable de ${MIN_DRILL_SEC / 60} min sin recortar el objetivo principal (${mainKind}).`)
      return { position, kind: block.kind, drills: [] as SquashDrill[] }
    }
    const drills = block.drills.slice(0, remaining)
    remaining -= drills.length
    if (!main && drills.length < block.drills.length) {
      warnings.push(`El bloque de ${block.kind} quedó recortado a ${drills.length} drill(s) para conservar el objetivo principal (${mainKind}).`)
    }
    return { position, kind: block.kind, drills }
  })

  return {
    blocks: chosen
      .filter(block => block.drills.length > 0)
      .sort((a, b) => a.position - b.position)
      .map(({ kind, drills }) => ({ kind, drills })),
    warnings,
  }
}

function projectSingleBlock(details: SquashDetails, kind: SquashSessionBlockKind, drills: SquashDrill[]): SquashDetails {
  const durationMin = drills.reduce((n, d) => n + (d.durationMin ?? 0), 0)
  return { ...details, drills, blocks: [{ kind, drills, durationMin }] }
}
```

- [ ] **Step 4: Exponer las advertencias en el hidratador**

En `squashSessionHydrator.ts`:
1. Agregar `'accessory_dropped'` a la unión `SquashHydrationWarningCode` (buscar su declaración con `grep -n "SquashHydrationWarningCode =" src/services/training/squashSessionHydrator.ts`).
2. Reemplazar el bloque final de `hydrateSquashSession`:

```ts
  const dose = doseSquashSession(details, input.durationMin)
  if (!dose.ok) warnings.push({ code: 'duration_infeasible', message: dose.message })
  else for (const message of dose.warnings) warnings.push({ code: 'accessory_dropped', message })
  return { subtype: projectSquashSubtype(kind, input.competitive), details: dose.ok ? dose.details : { ...details, drills: [], blocks: [] }, warnings, fallback }
```

- [ ] **Step 5: Ajustar el test de idempotencia existente**

En `sessionDose.test.ts`, el test que hace `expect(doseSquashSession(first.details, 20)).toEqual(first)` compara también `warnings`. La segunda dosificación ya no tiene accesorio que retirar, así que la comparación pasa a `.details`:

```ts
    const first = doseSquashSession(details, 20)
    if (!first.ok) throw new Error('composición factible')
    const second = doseSquashSession(first.details, 20)
    if (!second.ok) throw new Error('composición factible')
    expect(second.details).toEqual(first.details)
```

- [ ] **Step 6: Correr los tests de dosis y del hidratador**

Run: `npx vitest run src/services/training/__tests__/sessionDose.test.ts src/services/training/__tests__/squashSessionHydrator.test.ts`
Expected: PASS.

- [ ] **Step 7: Escribir el test de recorrido (reparación + serializador)**

```ts
// src/services/training/__tests__/squashMainBlockSurvives.test.ts
import { describe, expect, it } from 'vitest'
import type { ChatContext, CoachSessionProposal, Session } from '../../../types'
import { repairGeneratedWeek } from '../../planBuilder/repairWeek'
import { buildWeekCreatorHydrationRepairContext } from '../../weekCreator/WeekCreatorLocalHydrator'
import type { WeekCreatorEffectiveConfig } from '../../weekCreator/WeekCreatorConfig'
import { sessionToTemplatePayload, templateToDraft } from '../../athlete/sessionTemplateSerializer'
import { hydrateSquashSession } from '../squashSessionHydrator'

const TARGET_WEEK = '2026-07-20'

const context: ChatContext = {
  recentSessions: [],
  athleteProfile: { id: 'athlete-1', updatedAt: 0, sportContext: { primarySport: 'squash' } },
}

const config: WeekCreatorEffectiveConfig = {
  trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  doubleSessionDays: [], sessionsPerWeek: 1, maxSessionsPerWeek: 5, sessionDurationMins: 15,
  allowDoubleSession: false, allowedSports: ['squash'], primarySport: 'squash',
  currentFitnessLevel: 'fit', currentFatigue: 'normal', fromWizard: true, configSource: 'wizard',
}

function technicalWithShadows(): CoachSessionProposal {
  const hydrated = hydrateSquashSession({
    kind: 'technical', durationMin: 15, phase: 'base', fatigueLevel: 3, goal: '', recentDrills: [],
    competitionSoon: false, withShadowsAccessory: true, partnerAvailability: 'either',
  })
  return {
    date: TARGET_WEEK, timeBlock: 'AM', sessionType: 'squash', title: 'Squash técnico', durationMin: 15,
    objective: 'Técnica', squashKind: 'technical', subtype: hydrated.subtype, squashDetails: hydrated.details,
  }
}

describe('A2 — el bloque principal sobrevive al recorrido', () => {
  it('sigue presente después de repairGeneratedWeek', () => {
    const repairContext = buildWeekCreatorHydrationRepairContext({ context, config, targetWeekStart: TARGET_WEEK })
    const result = repairGeneratedWeek([technicalWithShadows()], repairContext)
    expect(result.failure).toBeUndefined()
    const squash = result.sessions.find(session => session.sessionType === 'squash')
    expect(squash?.squashDetails?.blocks?.some(block => block.kind === 'technical')).toBe(true)
  })

  it('sigue presente después de serializar a plantilla y volver a borrador', () => {
    const proposal = technicalWithShadows()
    const session: Session = {
      id: 's-1', date: proposal.date, weekStartDate: TARGET_WEEK, timeBlock: 'AM', type: 'squash',
      status: 'planned', source: 'coach', title: proposal.title, durationMin: 15,
      subtype: proposal.subtype, squashDetails: proposal.squashDetails, createdAt: 0, updatedAt: 0,
    }
    const payload = sessionToTemplatePayload(session)
    expect(payload.squashDetails?.blocks?.map(block => block.kind)).toContain('technical')
    const { draft } = templateToDraft(payload, TARGET_WEEK)
    expect(draft.squashKind).toBe('technical')
  })
})
```

- [ ] **Step 8: Correr el recorrido**

Run: `npx vitest run src/services/training/__tests__/squashMainBlockSurvives.test.ts`
Expected: PASS. Si `repairGeneratedWeek` devuelve `failure` por cupo (`sessionsPerWeek`), subir `sessionsPerWeek` a 2 en `config`; el test no debe relajar la aserción sobre el bloque.

- [ ] **Step 9: Suite del área, tipos y lint**

Run: `npx vitest run src/services/training src/services/planBuilder/__tests__/repairWeek.test.ts && npx tsc -b --pretty false && npm run lint`
Expected: verde. Si algún snapshot de squash cambia porque ahora el accesorio se retira, revisar fila a fila: el cambio esperado es que aparezca el bloque principal donde antes sólo había sombras.

- [ ] **Step 10: Checkpoint para el owner**

Archivos: `squashSessionDose.ts`, `squashSessionHydrator.ts`, `sessionDose.test.ts`, `squashMainBlockSurvives.test.ts` (nuevo). Mensaje sugerido: `fix(squash): el objetivo principal se dosifica antes que el accesorio (F03)`.

---

### Task 3: A3.1 — procedencia de la materialización de running

**Files:**
- Modify: `src/types/index.ts` (interfaz `RunningDetails`, ~línea 224)
- Modify: `src/services/training/runningTemplateMaterializer.ts` (firma y `return` de `materializeRunningTemplate`)
- Modify: `src/components/session/RunningTemplatePicker.tsx` (`onChange` del `<select>`)
- Modify: `src/services/dataExport.ts` (función `optionalRunningDetails`, ~línea 1709)
- Test: `src/services/training/__tests__/runningMaterialization.test.ts` (nuevo)

**Interfaces:**
- Produces: `RunningMaterializationIntent`, `RunningMaterialization { intent; recipeVersion; materializerVersion; profileRevision?; at }`, `RunningDetails.materialization?`, `RUNNING_MATERIALIZER_VERSION = 1`, `materializeRunningTemplate` acepta `profileRevision?: number` y devuelve `materialization` en el camino `ok`.
- Consumes: `sessionToTemplatePayload`/`templateToDraft` (structuredClone y spread: pasan el campo sin cambios), `applyCoachSessionPatch` (spread de `runningTargets`), `parseAppDataExport`.

- [ ] **Step 1: Test rojo de procedencia y de round-trips**

```ts
// src/services/training/__tests__/runningMaterialization.test.ts
import { describe, expect, it } from 'vitest'
import type { Session } from '../../../types'
import { materializeRunningTemplate, RUNNING_MATERIALIZER_VERSION } from '../runningTemplateMaterializer'
import { sessionToTemplatePayload, templateToDraft } from '../../athlete/sessionTemplateSerializer'
import { applyCoachSessionPatch, draftToPatch, sessionToDraft } from '../../athlete/coachSessionSerializer'
import { parseAppDataExport } from '../../dataExport'

function materialize(intent?: 'progress' | 'hold' | 'deload' | 'rotate') {
  const dose = materializeRunningTemplate({ template: 'repeats_400', durationMin: 60, profile: { fiveKTime: '25:00' }, intent, profileRevision: 42 })
  if (!dose.ok) throw new Error(dose.message)
  return dose
}

describe('A3.1 — procedencia de la materialización', () => {
  it('estampa intención, versiones y revisión de perfil', () => {
    const dose = materialize('progress')
    expect(dose.materialization).toMatchObject({
      intent: 'progress', recipeVersion: dose.templateRef.version,
      materializerVersion: RUNNING_MATERIALIZER_VERSION, profileRevision: 42,
    })
    expect(typeof dose.materialization.at).toBe('number')
  })

  it('sin intención declarada la procedencia dice hold y la dosis es la de hold', () => {
    const implicit = materialize()
    const explicitHold = materialize('hold')
    expect(implicit.materialization.intent).toBe('hold')
    expect(implicit.structure).toEqual(explicitHold.structure)
  })

  it('sobrevive a plantilla, patch de edición y backup', () => {
    const dose = materialize('progress')
    const session: Session = {
      id: 'run-1', date: '2026-08-10', weekStartDate: '2026-08-10', timeBlock: 'AM', type: 'running',
      status: 'planned', source: 'coach', title: '400s', durationMin: 60, createdAt: 0, updatedAt: 0,
      runningDetails: { runningType: 'intervals', templateRef: dose.templateRef, intervalStructure: dose.structure, materialization: dose.materialization },
    }
    const payload = sessionToTemplatePayload(session)
    expect(payload.runningDetails?.materialization).toEqual(dose.materialization)
    expect(templateToDraft(payload, '2026-08-17').draft.runningTargets?.materialization).toEqual(dose.materialization)

    const edited = applyCoachSessionPatch(session, draftToPatch({ ...sessionToDraft(session), title: 'Otro título' }, session))
    expect(edited.runningDetails?.materialization).toEqual(dose.materialization)
    expect(edited.runningDetails?.intervalStructure).toEqual(dose.structure)

    // Sobre del backup v4 tal como lo produce `exportAppData`; `parseAppDataExport`
    // recibe el objeto ya parseado, no el string. Las tablas ausentes se tratan
    // como vacías.
    const envelope = {
      app: 'RallyIQ', version: 4, exportedAt: '2026-09-12T12:00:00.000Z', exportedFromAppVersion: 'test',
      tables: { sessions: [session] },
    }
    const parsed = parseAppDataExport(JSON.parse(JSON.stringify(envelope)))
    expect(parsed.tables.sessions[0]?.runningDetails?.materialization).toEqual(dose.materialization)
  })
})
```

Si `parseAppDataExport` exige otras tablas presentes (lanza "no incluye tablas" para alguna ausente), agregarlas vacías al `tables` del sobre; la aserción sobre `materialization` no cambia.

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/runningMaterialization.test.ts`
Expected: FAIL — `RUNNING_MATERIALIZER_VERSION` no existe; `materialization` es `undefined`.

- [ ] **Step 3: Tipos**

En `src/types/index.ts`, antes de `RunningDetails`:

```ts
export type RunningMaterializationIntent = 'progress' | 'hold' | 'deload' | 'rotate'

/**
 * Procedencia de la dosis materializada. Permite explicar un recalculado
 * (qué cambió: duración, perfil, receta o materializador) y conservar la
 * intención al rematerializar. Registros anteriores no la tienen: se muestran
 * como "versión original desconocida" y se recalculan con `hold`.
 */
export interface RunningMaterialization {
  intent: RunningMaterializationIntent
  recipeVersion: number
  materializerVersion: number
  /** `AthleteProfile.updatedAt` con el que se resolvieron los ritmos. */
  profileRevision?: number
  at: number
}
```

Y dentro de `RunningDetails`: `materialization?: RunningMaterialization`.

- [ ] **Step 4: Materializador**

En `runningTemplateMaterializer.ts`:

```ts
export const RUNNING_MATERIALIZER_VERSION = 1

export function materializeRunningTemplate(input: {
  template: string | RunningSessionDefinition
  durationMin: number
  profile?: RunningProfile
  intent?: RunningMaterializationIntent
  profileRevision?: number
}) {
```

(importar `RunningMaterializationIntent` desde `'../../types'`). El `return` final pasa a:

```ts
  return { ok: true as const, structure: { blocks }, durationMin: input.durationMin,
    templateRef: { source: 'running_template' as const, id: definition.id, version: definition.version },
    materialization: {
      intent: input.intent ?? 'hold',
      recipeVersion: definition.version,
      materializerVersion: RUNNING_MATERIALIZER_VERSION,
      ...(input.profileRevision != null ? { profileRevision: input.profileRevision } : {}),
      at: Date.now(),
    } }
```

`'hold'` como default es fiel al comportamiento actual: con `intent` omitido, las repeticiones usan el factor `0.85`, que es la rama de `hold`.

- [ ] **Step 5: Picker**

En `RunningTemplatePicker.tsx`, el `onChange` del `<select>` incluye la procedencia:

```ts
      if (dose.ok) onChange({ runningType: definition.runningType, templateRef: dose.templateRef, intervalStructure: dose.structure, materialization: dose.materialization, selectionReason: `Elección manual: ${definition.description}` })
```

- [ ] **Step 6: Backup**

En `dataExport.ts`, `optionalRunningDetails` conserva el campo validándolo:

```ts
    materialization: optionalRunningMaterialization(row.materialization, `${path}.materialization`),
```

y agregar debajo:

```ts
const RUNNING_MATERIALIZATION_INTENTS = ['progress', 'hold', 'deload', 'rotate'] as const

function optionalRunningMaterialization(value: unknown, path: string): NonNullable<Session['runningDetails']>['materialization'] {
  if (value == null) return undefined
  const row = ensureRecord(value, path)
  return {
    intent: requireEnum(row.intent, RUNNING_MATERIALIZATION_INTENTS, `${path}.intent`) as RunningMaterializationIntent,
    recipeVersion: requireFiniteNumber(row.recipeVersion, `${path}.recipeVersion`),
    materializerVersion: requireFiniteNumber(row.materializerVersion, `${path}.materializerVersion`),
    profileRevision: optionalFiniteNumber(row.profileRevision, `${path}.profileRevision`),
    at: requireFiniteNumber(row.at, `${path}.at`),
  }
}
```

(importar `RunningMaterializationIntent` desde `'../types'`; `requireFiniteNumber`, `optionalFiniteNumber`, `requireEnum` y `ensureRecord` ya existen en `dataExport.ts`).

- [ ] **Step 7: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/training/__tests__/runningMaterialization.test.ts`
Expected: PASS.

- [ ] **Step 8: Suite de running, serializadores y export; tipos; lint**

Run: `npx vitest run src/services/training src/services/athlete src/services/__tests__/dataExport* src/components/session && npx tsc -b --pretty false && npm run lint`
Expected: verde. Si un snapshot de `templateRef`/estructura falla porque ahora `materialization` viaja al lado, la expectativa se amplía con el campo; no se quita el campo.

- [ ] **Step 9: Checkpoint para el owner**

Archivos: `types/index.ts`, `runningTemplateMaterializer.ts`, `RunningTemplatePicker.tsx`, `dataExport.ts`, test nuevo. Mensaje sugerido: `feat(running): procedencia de la materialización con intención y versiones (A3.1)`.

---

### Task 4: A3.2 — creación, edición y recalculado en `SessionForm` (F05)

Depende de la Tarea 3.

**Files:**
- Create: `src/services/training/runningDoseDiff.ts`
- Test: `src/services/training/__tests__/runningDoseDiff.test.ts`
- Modify: `src/components/session/SessionForm.tsx` (props, estado, submit ~línea 447, bloque de running ~línea 630)
- Modify: `src/components/session/AddSessionModal.tsx`
- Modify: `src/components/coach/CoachSessionModal.tsx`
- Modify: `src/components/coach/CoachLibraryPanel.tsx` (~línea 224)
- Test: `src/components/session/SessionFormRunningTemplates.test.tsx` (agregar casos)
- Test: `src/components/session/__tests__/SessionFormRunningPersistence.test.tsx` (nuevo, Dexie real con fake-indexeddb)

**Interfaces:**
- Produces: props `origin?: 'new' | 'template' | 'existing'` (default `'new'`) y `sessionStatus?: SessionStatus` en `SessionFormProps`. Módulo puro `runningDoseDiff.ts` con `describeRunningDoseDiff(before, after): string[]` (cambios concretos de dosis: repeticiones, minutos de trabajo, ritmos, bloques) y `validateManualPaceAgainstStructure(paceMin, paceMax, structure): { ok: true } | { ok: false; message: string }`. En el formulario: **toda** rematerialización de una sesión existente pasa por un preview con diff; "Aplicar recálculo" guarda una receta **aprobada** que el submit persiste tal cual, sin volver a materializar.
- Consumes: `materializeRunningTemplate` con `intent` y `profileRevision` (Tarea 3), `RUNNING_MATERIALIZER_VERSION`, `findRunningSessionById` de `runningSessionLibrary.ts`, `isExecutedStatus` de `services/training/executedSessions.ts`, `sumTimedBlocks` de `sessionTimeBudget.ts`.

- [ ] **Step 0: Módulo puro de diff y validación de ritmos, con su test**

```ts
// src/services/training/__tests__/runningDoseDiff.test.ts
import { describe, expect, it } from 'vitest'
import { materializeRunningTemplate } from '../runningTemplateMaterializer'
import { describeRunningDoseDiff, validateManualPaceAgainstStructure } from '../runningDoseDiff'

const dose = (durationMin: number, profile = { fiveKTime: '25:00' }) => {
  const result = materializeRunningTemplate({ template: 'repeats_400', durationMin, profile, intent: 'progress' })
  if (!result.ok) throw new Error(result.message)
  return result.structure
}

describe('describeRunningDoseDiff', () => {
  it('nombra el cambio de repeticiones y de minutos de trabajo', () => {
    const lines = describeRunningDoseDiff(dose(60), dose(45))
    expect(lines.some(line => /repeticiones: 11 → \d+/.test(line))).toBe(true)
    expect(lines.some(line => /trabajo: \d+ → \d+ min/.test(line))).toBe(true)
  })
  it('nombra el cambio de ritmo cuando cambia el perfil', () => {
    const lines = describeRunningDoseDiff(dose(60), dose(60, { fiveKTime: '23:00' }))
    expect(lines.some(line => /ritmo de trabajo: .* → .*/.test(line))).toBe(true)
  })
  it('sin cambios devuelve una sola línea que lo dice', () => {
    expect(describeRunningDoseDiff(dose(60), dose(60))).toEqual(['la dosis resultante es la misma'])
  })
})

describe('validateManualPaceAgainstStructure', () => {
  it('acepta un rango que se solapa con los ritmos de trabajo de los bloques', () => {
    const structure = dose(60)
    const work = structure.blocks.find(block => block.distanceKm === 0.4)!.targetPace! // p.ej. "4:36 /km"
    const [min, sec] = work.replace(' /km', '').split(':').map(Number)
    const faster = `${min}:${String(Math.max(0, sec - 10)).padStart(2, '0')}`
    const slower = `${min}:${String(sec + 10).padStart(2, '0')}`
    expect(validateManualPaceAgainstStructure(faster, slower, structure).ok).toBe(true)
  })
  it('rechaza un rango incompatible con los bloques', () => {
    const result = validateManualPaceAgainstStructure('6:30', '7:00', dose(60))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('no corresponden a los bloques')
  })
  it('sin ritmos manuales no opina', () => {
    expect(validateManualPaceAgainstStructure(undefined, undefined, dose(60)).ok).toBe(true)
  })
})
```

```ts
// src/services/training/runningDoseDiff.ts
import type { RunningIntervalStructure } from '../../types'
import { sumTimedBlocks } from './sessionTimeBudget'

type Block = RunningIntervalStructure['blocks'][number]

const EASY_ROLES = new Set(['warmup', 'cooldown', 'recovery', 'technique'])
const isWorkBlock = (block: Block) => !EASY_ROLES.has(block.role ?? '')

function paceToSeconds(pace: string | undefined): number | undefined {
  if (!pace) return undefined
  const match = /^(\d{1,2}):(\d{2})/.exec(pace.trim())
  if (!match) return undefined
  return Number(match[1]) * 60 + Number(match[2])
}

function workRepetitions(structure: RunningIntervalStructure): number {
  return structure.blocks.filter(isWorkBlock).reduce((n, block) => n + (block.repetitions ?? 1), 0)
}

function workMinutes(structure: RunningIntervalStructure): number {
  const total = sumTimedBlocks(structure.blocks.filter(isWorkBlock)) ?? 0
  return Math.round(total / 60)
}

function workPaces(structure: RunningIntervalStructure): string[] {
  return [...new Set(structure.blocks.filter(isWorkBlock).map(block => block.targetPace).filter((p): p is string => Boolean(p)))]
}

/** Diferencias CONCRETAS de dosis entre dos estructuras; para el preview de recalculado. */
export function describeRunningDoseDiff(before: RunningIntervalStructure, after: RunningIntervalStructure): string[] {
  const lines: string[] = []
  const repsBefore = workRepetitions(before), repsAfter = workRepetitions(after)
  if (repsBefore !== repsAfter) lines.push(`repeticiones: ${repsBefore} → ${repsAfter}`)
  const minBefore = workMinutes(before), minAfter = workMinutes(after)
  if (minBefore !== minAfter) lines.push(`trabajo: ${minBefore} → ${minAfter} min`)
  const pacesBefore = workPaces(before).join(', '), pacesAfter = workPaces(after).join(', ')
  if (pacesBefore !== pacesAfter) lines.push(`ritmo de trabajo: ${pacesBefore || 'sin ritmo'} → ${pacesAfter || 'sin ritmo'}`)
  if (before.blocks.length !== after.blocks.length) lines.push(`bloques: ${before.blocks.length} → ${after.blocks.length}`)
  return lines.length > 0 ? lines : ['la dosis resultante es la misma']
}

/**
 * Los ritmos escritos a mano son instrucción explícita del usuario; se guardan,
 * pero tienen que describir la misma sesión que los bloques. Tolerancia: 15 s/km
 * a cada lado del rango de ritmos de trabajo de la estructura.
 */
export function validateManualPaceAgainstStructure(
  paceMin: string | undefined,
  paceMax: string | undefined,
  structure: RunningIntervalStructure | undefined,
): { ok: true } | { ok: false; message: string } {
  const manual = [paceToSeconds(paceMin), paceToSeconds(paceMax)].filter((v): v is number => v != null)
  if (manual.length === 0 || !structure) return { ok: true }
  const work = workPaces(structure).map(paceToSeconds).filter((v): v is number => v != null)
  if (work.length === 0) return { ok: true }
  const lo = Math.min(...work) - 15, hi = Math.max(...work) + 15
  const overlaps = Math.min(...manual) <= hi && Math.max(...manual) >= lo
  return overlaps
    ? { ok: true }
    : { ok: false, message: `Los ritmos que escribiste (${paceMin ?? '—'}–${paceMax ?? '—'}) no corresponden a los bloques de la receta (${workPaces(structure).join(', ')}). Ajusta los ritmos o recalcula la dosis.` }
}
```

Run: `npx vitest run src/services/training/__tests__/runningDoseDiff.test.ts` → FAIL antes del módulo, PASS después. Si `role` no incluye `'technique'` en el tipo `Block`, quitarlo del `Set` y filtrar los bloques de técnica por `label` que empiece con "Marcha", "Skipping" o "Apoyos".

- [ ] **Step 1: Tests rojos**

Agregar a `SessionFormRunningTemplates.test.tsx`:

```ts
import type { CoachSessionDraft } from '../../services/athlete/coachSessionSerializer'
import { materializeRunningTemplate } from '../../services/training/runningTemplateMaterializer'

const profile = { id: 'ath', updatedAt: 100, runningProfile: { fiveKTime: '25:00', z2PaceMax: '6:30' } }

function existingRepeats(): CoachSessionDraft {
  const dose = materializeRunningTemplate({ template: 'repeats_400', durationMin: 60, profile: profile.runningProfile, intent: 'progress', profileRevision: 100 })
  if (!dose.ok) throw new Error(dose.message)
  return {
    date: '2026-08-10', timeBlock: 'AM', type: 'running', title: 'Series 400', durationMin: 60,
    runningTargets: { runningType: 'intervals', templateRef: dose.templateRef, intervalStructure: dose.structure, materialization: dose.materialization },
  }
}

const countReps = (draft: CoachSessionDraft) => draft.runningTargets!.intervalStructure!.blocks
  .filter(block => block.distanceKm === 0.4).reduce((n, block) => n + (block.repetitions ?? 1), 0)

it('A3: editar el título de una sesión existente conserva la estructura byte a byte', async () => {
  const submit = vi.fn(async () => {})
  const initial = existingRepeats()
  render(<SessionForm origin="existing" initialValues={initial} defaultSport="running" athleteProfile={profile} heading="Editar" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Titulo'), { target: { value: 'Series 400 (martes)' } })
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  const draft = submit.mock.calls[0][0] as CoachSessionDraft
  expect(countReps(initial)).toBe(11)
  expect(draft.runningTargets!.intervalStructure).toEqual(initial.runningTargets!.intervalStructure)
  expect(draft.runningTargets!.materialization).toEqual(initial.runningTargets!.materialization)
})

it('A3: cambiar la duración exige revisar el diff antes de guardar y persiste exactamente lo aprobado', async () => {
  const submit = vi.fn(async () => {})
  const initial = existingRepeats()
  render(<SessionForm origin="existing" initialValues={initial} defaultSport="running" athleteProfile={profile} heading="Editar" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Duracion (min)'), { target: { value: '45' } })
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  // Primer intento: no guarda, muestra el diff con cambios concretos de dosis.
  expect(submit).not.toHaveBeenCalled()
  const diff = screen.getByTestId('running-recalc-diff').textContent ?? ''
  expect(diff).toMatch(/repeticiones: 11 → \d+/)
  expect(diff).toContain('duración: 60 → 45 min')
  await userEvent.click(screen.getByRole('button', { name: 'Aplicar recálculo' }))
  const approved = (screen.getByTestId('running-approved-structure') as HTMLElement).dataset.signature
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  const draft = submit.mock.calls[0][0] as CoachSessionDraft
  expect(JSON.stringify(draft.runningTargets!.intervalStructure)).toBe(approved)
  expect(draft.runningTargets!.materialization?.intent).toBe('progress')
  expect(sumTimedBlocks(draft.runningTargets!.intervalStructure!.blocks)).toBe(45 * 60)
})

it('A3: cambiar la duración después de aprobar invalida la aprobación', async () => {
  const submit = vi.fn(async () => {})
  render(<SessionForm origin="existing" initialValues={existingRepeats()} defaultSport="running" athleteProfile={profile} heading="Editar" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Duracion (min)'), { target: { value: '45' } })
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  await userEvent.click(screen.getByRole('button', { name: 'Aplicar recálculo' }))
  fireEvent.change(screen.getByLabelText('Duracion (min)'), { target: { value: '50' } })
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  expect(submit).not.toHaveBeenCalled()
  expect(screen.getByTestId('running-recalc-diff').textContent).toContain('duración: 60 → 50 min')
})

it('A3: un recálculo aprobado caduca si el perfil cambia antes de guardar', async () => {
  const submit = vi.fn(async () => {})
  const initial = existingRepeats()
  const newerProfile = { ...profile, updatedAt: 200, runningProfile: { fiveKTime: '23:00', z2PaceMax: '6:00' } }
  const view = render(<SessionForm origin="existing" initialValues={initial} defaultSport="running" athleteProfile={newerProfile} heading="Editar" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: 'Recalcular dosis' }))
  await userEvent.click(screen.getByRole('button', { name: 'Aplicar recálculo' }))
  // El perfil vuelve a cambiar (p. ej. otro dispositivo sincronizó) antes de guardar.
  view.rerender(<SessionForm origin="existing" initialValues={initial} defaultSport="running" athleteProfile={{ ...newerProfile, updatedAt: 300, runningProfile: { fiveKTime: '22:00', z2PaceMax: '5:50' } }} heading="Editar" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  expect(submit).not.toHaveBeenCalled()
  expect(screen.getByTestId('running-recalc-diff').textContent).toContain('ritmos de referencia del perfil')
  expect(screen.queryByTestId('running-approved-structure')).toBeNull()
})

it('A3: ritmos manuales incompatibles con los bloques no se guardan', async () => {
  const submit = vi.fn(async () => {})
  render(<SessionForm origin="existing" initialValues={existingRepeats()} defaultSport="running" athleteProfile={profile} heading="Editar" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Ritmo min (min/km)'), { target: { value: '6:30' } })
  fireEvent.change(screen.getByLabelText('Ritmo max (min/km)'), { target: { value: '7:00' } })
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  expect(submit).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('no corresponden a los bloques')
})

it('A3: una sesión completada rechaza cambiar duración o plantilla', async () => {
  const submit = vi.fn(async () => {})
  render(<SessionForm origin="existing" sessionStatus="completed" initialValues={existingRepeats()} defaultSport="running" athleteProfile={profile} heading="Editar" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Duracion (min)'), { target: { value: '45' } })
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  expect(submit).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('ya fue realizada')
  expect(screen.queryByRole('button', { name: 'Recalcular dosis' })).toBeNull()
})

it('A3: recalcular muestra qué cambió y sólo aplica al confirmar', async () => {
  const submit = vi.fn(async () => {})
  const initial = existingRepeats()
  const newerProfile = { ...profile, updatedAt: 200, runningProfile: { fiveKTime: '23:00', z2PaceMax: '6:00' } }
  render(<SessionForm origin="existing" initialValues={initial} defaultSport="running" athleteProfile={newerProfile} heading="Editar" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: 'Recalcular dosis' }))
  const diff = screen.getByTestId('running-recalc-diff').textContent ?? ''
  expect(diff).toContain('ritmos de referencia del perfil')
  expect(diff).toContain('intención: progress')
  expect(diff).toMatch(/ritmo de trabajo: .* → .*/)
  await userEvent.click(screen.getByRole('button', { name: 'Aplicar recálculo' }))
  const approved = (screen.getByTestId('running-approved-structure') as HTMLElement).dataset.signature
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  const draft = submit.mock.calls[0][0] as CoachSessionDraft
  expect(JSON.stringify(draft.runningTargets!.intervalStructure)).toBe(approved)
  expect(draft.runningTargets!.materialization?.profileRevision).toBe(200)
  expect(draft.runningTargets!.intervalStructure).not.toEqual(initial.runningTargets!.intervalStructure)
})

it('A3: editar el nombre de una plantilla existente no rematerializa su receta', async () => {
  const submit = vi.fn(async () => {})
  const initial = existingRepeats()
  render(<SessionForm origin="existing" mode="template" initialName="Series 400" initialValues={initial} defaultSport="running" athleteProfile={profile} heading="Editar plantilla" submitLabel="Guardar cambios" onSubmit={submit} onCancel={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Nombre de plantilla'), { target: { value: 'Series 400 v2' } })
  await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
  const draft = submit.mock.calls[0][0] as CoachSessionDraft
  expect(draft.runningTargets!.intervalStructure).toEqual(initial.runningTargets!.intervalStructure)
})

it('A3: una receta antigua sin procedencia se recalcula con hold y lo declara', async () => {
  const submit = vi.fn(async () => {})
  const initial = existingRepeats()
  delete initial.runningTargets!.materialization
  render(<SessionForm origin="existing" initialValues={initial} defaultSport="running" athleteProfile={profile} heading="Editar" submitLabel="Guardar" onSubmit={submit} onCancel={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: 'Recalcular dosis' }))
  const diff = screen.getByTestId('running-recalc-diff').textContent ?? ''
  expect(diff).toContain('versión original desconocida')
  expect(diff).toContain('intención asumida: mantener')
})

```

La prueba de **persistencia real** va en un archivo aparte porque abre Dexie con
`fake-indexeddb` (mismo patrón que `src/db/__tests__/dexieV20Upgrade.test.ts`):

```tsx
// src/components/session/__tests__/SessionFormRunningPersistence.test.tsx
// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Session } from '../../../types'
import type { CoachSessionDraft } from '../../../services/athlete/coachSessionSerializer'
import { applyCoachSessionPatch, draftToPatch, sessionToDraft } from '../../../services/athlete/coachSessionSerializer'
import { materializeRunningTemplate } from '../../../services/training/runningTemplateMaterializer'
import { db } from '../../../db/db'
import SessionForm from '../SessionForm'

afterEach(cleanup)

it('A3: la fila de Dexie conserva estructura y procedencia tras editar el título', async () => {
  const profile = { id: 'ath', updatedAt: 100, runningProfile: { fiveKTime: '25:00', z2PaceMax: '6:30' } }
  const dose = materializeRunningTemplate({ template: 'repeats_400', durationMin: 60, profile: profile.runningProfile, intent: 'progress', profileRevision: 100 })
  if (!dose.ok) throw new Error(dose.message)
  const session: Session = {
    id: 'run-1', athleteId: 'ath', date: '2026-08-10', weekStartDate: '2026-08-10', timeBlock: 'AM', type: 'running',
    status: 'planned', source: 'coach', title: 'Series 400', durationMin: 60, createdAt: 0, updatedAt: 0,
    runningDetails: { runningType: 'intervals', templateRef: dose.templateRef, intervalStructure: dose.structure, materialization: dose.materialization },
  }
  await db.sessions.put(session)

  let submitted: CoachSessionDraft | undefined
  render(<SessionForm origin="existing" initialValues={sessionToDraft(session)} defaultSport="running" athleteProfile={profile} heading="Editar" submitLabel="Guardar" onSubmit={async draft => { submitted = draft }} onCancel={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Titulo'), { target: { value: 'Series 400 (martes)' } })
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

  // Mismo camino que CoachSessionModal → updateSessionForAthlete → applyCoachSessionPatch → Dexie.
  const next = applyCoachSessionPatch(session, draftToPatch(submitted!, session))
  await db.sessions.put(next)
  const reread = await db.sessions.get('run-1')
  expect(reread?.title).toBe('Series 400 (martes)')
  expect(reread?.runningDetails?.intervalStructure).toEqual(session.runningDetails?.intervalStructure)
  expect(reread?.runningDetails?.materialization).toEqual(session.runningDetails?.materialization)
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/components/session/SessionFormRunningTemplates.test.tsx`
Expected: FAIL — hoy el título editado rematerializa (9 repeticiones ≠ 11), no existe `origin`, ni el botón.

- [ ] **Step 3: Props y estado en `SessionForm`**

En `SessionFormProps` agregar:

```ts
  /**
   * `new`: alta manual. `template`: alta desde plantilla. `existing`: edición de
   * una sesión persistida. `initialValues` NO distingue alta de edición
   * (crear desde plantilla también lo usa), por eso el origen es explícito.
   */
  origin?: 'new' | 'template' | 'existing'
  /** Estado de la sesión editada; `completed`/`adjusted` bloquean cambios de dosis. */
  sessionStatus?: SessionStatus
```

Importar `SessionStatus` desde `'../../types'`, `isExecutedStatus` desde `'../../services/training/executedSessions'`, `findRunningSessionById` desde `'../../services/training/runningSessionLibrary'` y `RUNNING_MATERIALIZER_VERSION` desde `'../../services/training/runningTemplateMaterializer'`.

Desestructurar `origin = 'new'` y `sessionStatus` en el componente. Agregar estado y helpers:

```ts
  const isExecuted = sessionStatus != null && isExecutedStatus(sessionStatus)
  const initialRunning = initialValues?.runningTargets
  /** Receta elegida en el picker durante esta edición (rematerializa al guardar sólo en alta). */
  const [pickerTouched, setPickerTouched] = useState(false)
  /** Preview pendiente de aprobación: qué cambia y la receta resultante. */
  const [recalcPreview, setRecalcPreview] = useState<{ lines: string[]; recipe: RunningDetails; key: string } | null>(null)
  /** Receta aprobada por el usuario; el submit la persiste TAL CUAL mientras `key` siga vigente. */
  const [approvedRecipe, setApprovedRecipe] = useState<{ recipe: RunningDetails; key: string } | null>(null)

  /** Identifica las entradas de una materialización: si cambia, la aprobación caduca. */
  const rematerializationKey = (recipe: RunningDetails | undefined) =>
    `${recipe?.templateRef?.id ?? ''}|${Number(duration)}|${athleteProfile?.updatedAt ?? ''}|${recipe?.materialization?.intent ?? 'hold'}`

  const buildRecalcPreview = (recipe: RunningDetails): { lines: string[]; recipe: RunningDetails; key: string } | { error: string } => {
    const profile = runningProfileWithRestrictions(athleteProfile)
    if (profile.impactRestriction === 'no_running' || profile.impactRestriction === 'no_fast_running' && ['tempo', 'intervals'].includes(runningType)) {
      return { error: 'Plantilla incompatible con las restricciones activas.' }
    }
    const previous = recipe.materialization
    const dose = materializeRunningTemplate({
      template: recipe.templateRef!.id, durationMin: Number(duration), profile,
      intent: previous?.intent ?? 'hold', profileRevision: athleteProfile?.updatedAt,
    })
    if (!dose.ok) return { error: dose.message }
    const causes: string[] = []
    if (Number(duration) !== initialValues?.durationMin) causes.push(`duración: ${initialValues?.durationMin} → ${Number(duration)} min`)
    if (recipe.templateRef!.id !== initialRunning?.templateRef?.id) causes.push(`plantilla: ${initialRunning?.templateRef?.id ?? 'ninguna'} → ${recipe.templateRef!.id}`)
    if (!previous) causes.push('versión original desconocida: la receta no guardó su procedencia')
    if (previous && previous.profileRevision !== athleteProfile?.updatedAt) causes.push('ritmos de referencia del perfil: cambiaron desde la última materialización')
    if (!previous && athleteProfile?.updatedAt != null) causes.push('ritmos de referencia del perfil: se usan los vigentes')
    if (previous && previous.recipeVersion !== dose.materialization.recipeVersion) causes.push(`versión de la receta: ${previous.recipeVersion} → ${dose.materialization.recipeVersion}`)
    if (previous && previous.materializerVersion !== RUNNING_MATERIALIZER_VERSION) causes.push(`versión del materializador: ${previous.materializerVersion} → ${RUNNING_MATERIALIZER_VERSION}`)
    causes.push(previous ? `intención: ${previous.intent}` : 'intención asumida: mantener')
    const doseLines = recipe.intervalStructure
      ? describeRunningDoseDiff(recipe.intervalStructure, dose.structure)
      : ['la receta no tenía bloques guardados; se materializa completa']
    const next = { ...recipe, intervalStructure: dose.structure, materialization: dose.materialization }
    return { lines: [...causes, ...doseLines], recipe: next, key: rematerializationKey(next) }
  }
```

Importar `describeRunningDoseDiff` y `validateManualPaceAgainstStructure` desde `'../../services/training/runningDoseDiff'`.

En el `onChange` del picker:

```tsx
          {type === 'running' && <RunningTemplatePicker durationMin={Number(duration)} athleteProfile={athleteProfile} value={runningRecipe} onChange={value => {
            setRunningRecipe(value)
            setPickerTouched(true)
            setRecalcPreview(null)
            setApprovedRecipe(null)
            if (value) setRunningType(value.runningType)
          }} />}
```

- [ ] **Step 4: Reglas del submit**

Reemplazar el bloque `let submittedRunning = runningRecipe ... }` del submit por:

```ts
    let submittedRunning = runningRecipe
    if (type === 'running' && runningRecipe?.templateRef) {
      const definition = findRunningSessionById(runningRecipe.templateRef.id)
      if (definition && definition.runningType !== runningType) {
        setError('El tipo de running elegido no corresponde a la plantilla. Elige otra plantilla o vuelve al tipo de la receta.')
        return
      }
      if (origin !== 'existing') {
        // Alta manual o desde plantilla: se materializa al slot y duración elegidos,
        // conservando la intención de la plantilla si la trae.
        const profile = runningProfileWithRestrictions(athleteProfile)
        if (profile.impactRestriction === 'no_running' || profile.impactRestriction === 'no_fast_running' && ['tempo', 'intervals'].includes(runningType)) { setError('Plantilla incompatible con las restricciones activas.'); return }
        const dose = materializeRunningTemplate({
          template: runningRecipe.templateRef.id, durationMin: Number(duration), profile,
          intent: runningRecipe.materialization?.intent ?? 'hold', profileRevision: athleteProfile?.updatedAt,
        })
        if (!dose.ok) { setError(dose.message); return }
        submittedRunning = { ...runningRecipe, intervalStructure: dose.structure, materialization: dose.materialization }
      } else {
        const durationChanged = Number(duration) !== initialValues?.durationMin
        const templateChanged = runningRecipe.templateRef.id !== initialRunning?.templateRef?.id
        // Un recálculo aprobado también cuenta como intención de rematerializar,
        // aunque duración y plantilla sigan siendo las originales (p. ej. cambió el perfil).
        const wantsRematerialize = pickerTouched || templateChanged || durationChanged || approvedRecipe != null
        if (isExecuted && wantsRematerialize) {
          setError('Esta sesión ya fue realizada: se puede corregir lo ejecutado, pero no cambiar su duración ni su receta.')
          return
        }
        if (wantsRematerialize) {
          // La vigencia de la aprobación se comprueba SIEMPRE que exista una,
          // no sólo cuando cambió duración o plantilla: si el perfil cambió
          // después de aprobar, la receta aprobada ya no describe la dosis actual.
          const currentKey = rematerializationKey(runningRecipe)
          if (!approvedRecipe || approvedRecipe.key !== currentKey) {
            setApprovedRecipe(null)
            const preview = buildRecalcPreview(runningRecipe)
            if ('error' in preview) { setError(preview.error); return }
            setRecalcPreview(preview)
            setError('Revisa qué cambia en la dosis y confirma el recálculo antes de guardar.')
            return
          }
          // Se persiste EXACTAMENTE lo aprobado; no se vuelve a materializar.
          submittedRunning = approvedRecipe.recipe
        }
        // Edición de metadatos: `runningRecipe` es el objeto de `initialValues` y
        // viaja byte a byte. No se toca la estructura ni la procedencia.
      }
    }
    if (type === 'running' && origin === 'existing') {
      const paceChanged = paceMin.trim() !== (initialRunning?.targetPaceMin ?? '') || paceMax.trim() !== (initialRunning?.targetPaceMax ?? '')
      if (paceChanged) {
        const check = validateManualPaceAgainstStructure(paceMin.trim() || undefined, paceMax.trim() || undefined, submittedRunning?.intervalStructure)
        if (!check.ok) { setError(check.message); return }
      }
    }
```

- [ ] **Step 5: Botón de recalculado con diff**

Debajo del `RunningTemplatePicker`, dentro del bloque `type === 'running'`:

```tsx
          {type === 'running' && origin === 'existing' && !isExecuted && runningRecipe?.templateRef && (
            <div className="space-y-2 rounded-xl border border-surface-border p-3">
              <button type="button" className="text-sm underline" onClick={() => {
                const preview = buildRecalcPreview(runningRecipe)
                if ('error' in preview) { setError(preview.error); return }
                setRecalcPreview(preview)
              }}>Recalcular dosis</button>
              {recalcPreview && (
                <div data-testid="running-recalc-diff" className="space-y-1 text-xs text-ink-muted">
                  <p>Qué cambia al recalcular:</p>
                  <ul className="list-disc pl-4">{recalcPreview.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
                  <div className="flex gap-2 pt-1">
                    <button type="button" className="rounded border px-2 py-1" onClick={() => {
                      // Aprobar NO vuelve a materializar: guarda la receta ya calculada.
                      setApprovedRecipe({ recipe: recalcPreview.recipe, key: recalcPreview.key })
                      setRunningRecipe(recalcPreview.recipe)
                      setPickerTouched(false)
                      setRecalcPreview(null)
                      setError(null)
                    }}>Aplicar recálculo</button>
                    <button type="button" className="rounded border px-2 py-1" onClick={() => setRecalcPreview(null)}>Descartar</button>
                  </div>
                </div>
              )}
              {approvedRecipe && (
                <p data-testid="running-approved-structure" data-signature={JSON.stringify(approvedRecipe.recipe.intervalStructure)} className="text-xs text-ink-muted">
                  Recálculo aprobado; se guardará al confirmar.
                </p>
              )}
            </div>
          )}
```

- [ ] **Step 6: Cablear los tres callers**

`AddSessionModal.tsx`: agregar `origin="new"` al `<SessionForm>`.

`CoachSessionModal.tsx`:

```tsx
        <SessionForm
          athleteProfile={athleteProfile}
          origin={template ? 'template' : session ? 'existing' : 'new'}
          sessionStatus={session?.status}
          initialValues={templateDraftState?.draft ?? (session ? sessionToDraft(session) : undefined)}
```

`CoachLibraryPanel.tsx`: `origin={editor.mode === 'edit' ? 'existing' : 'new'}`. Editar una plantilla guardada es edición: cambiar sólo el nombre no rematerializa su receta; crear una plantilla nueva es alta. (`'template'` queda reservado para **crear una sesión desde una plantilla**, que es lo que hace `CoachSessionModal`.)

- [ ] **Step 7: Correr los tests del formulario y la persistencia**

Run: `npx vitest run src/components/session/SessionFormRunningTemplates.test.tsx src/components/session/SessionForm.test.tsx src/components/session/__tests__ src/components/session/AddSessionModal.test.tsx`
Expected: PASS. Los dos tests preexistentes del archivo de running templates (alta con plantilla y cambio de duración en alta) siguen pasando porque `origin` default es `'new'`. `SessionFormRunningPersistence.test.tsx` abre Dexie real vía `fake-indexeddb`.

- [ ] **Step 8: Tipos y lint**

Run: `npx tsc -b --pretty false && npm run lint`
Expected: verde.

- [ ] **Step 9: Checkpoint para el owner**

Archivos: `SessionForm.tsx`, `AddSessionModal.tsx`, `CoachSessionModal.tsx`, `CoachLibraryPanel.tsx`, test. Mensaje sugerido: `fix(session-form): editar metadatos no rematerializa la receta de running; recalcular es explícito (F05)`.

---

### Task 5: A5 — identidad del atleta en cada frontera asíncrona (F01)

**Files:**
- Create: `src/services/athlete/requestScope.ts`
- Modify: `src/pages/ChatCoach.tsx` (`submitMessage`, ~líneas 278–335)
- Modify: `src/store/useChatStore.ts` (firma de `sendMessage` ~línea 63 y 264; persistencia del mensaje del coach ~línea 396 y de la propuesta ~línea 408)
- Modify: `src/services/ai/CoachEngine.ts` (`CoachSendOptions` y `targetAthleteId` en `sendTrackedCoachRequest`)
- Modify: `src/services/weekCreator/WeekCreatorEngine.ts` (`WeekCreatorOptions.targetAthleteId`, llamada al proveedor ~línea 389)
- Test: `src/services/weekCreator/__tests__/WeekCreatorEngine.test.ts` (agregar caso)
- Modify: `src/db/queries.ts` (`upsertWeekSummary` acepta `scope` opcional)
- Modify: `src/store/useTrainingStore.ts` (`generateCoachNote`)
- Test: `src/services/athlete/__tests__/requestScope.test.ts` (nuevo)
- Test: `src/pages/__tests__/chatCoachWhoopBlockScope.test.tsx` (agregar aserción)
- Test: `src/store/__tests__/useChatStoreRequestScope.test.ts` (nuevo)
- Test: `src/store/__tests__/useTrainingStoreCoachNoteScope.test.ts` (nuevo)

**Interfaces:**
- Produces: `RequestScope { athleteId: string | null; epoch: number; conversationId?: string; requestId: string }`, `captureRequestScope(conversationId?)`, `isRequestScopeCurrent(scope)`. `sendMessage(content, context?, scope?)`. `CoachSendOptions.targetAthleteId?: string | null`. `upsertWeekSummary(weekStartISO, patch, scope?)`.
- Consumes: `getActiveAthleteId`, `getSwitchEpoch` de `activeAthlete.ts`; `resolveRequestTargetAthleteId` de `requestTarget.ts`; `upsertWeekSummaryCore`, `captureActiveWeekScope` (hoy privada) de `queries.ts`; `uuid` de `utils/uuid`.

- [ ] **Step 1: Test rojo del módulo de scope**

```ts
// src/services/athlete/__tests__/requestScope.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ athleteId: null as string | null, epoch: 0 }))
vi.mock('../activeAthlete', () => ({
  getActiveAthleteId: () => h.athleteId,
  getSwitchEpoch: () => h.epoch,
}))

import { captureRequestScope, isRequestScopeCurrent } from '../requestScope'

describe('requestScope', () => {
  beforeEach(() => { h.athleteId = 'ath_a'; h.epoch = 3 })

  it('captura atleta, epoch, conversación y un requestId único', () => {
    const a = captureRequestScope('conv-1')
    const b = captureRequestScope('conv-1')
    expect(a).toMatchObject({ athleteId: 'ath_a', epoch: 3, conversationId: 'conv-1' })
    expect(a.requestId).not.toBe(b.requestId)
  })

  it('deja de ser vigente si cambia la identidad aunque el epoch no se mueva', () => {
    const scope = captureRequestScope()
    h.athleteId = 'ath_b'
    expect(isRequestScopeCurrent(scope)).toBe(false)
  })

  it('deja de ser vigente si cambia el epoch', () => {
    const scope = captureRequestScope()
    h.epoch = 4
    expect(isRequestScopeCurrent(scope)).toBe(false)
  })

  it('la hidratación inicial null → self no cuenta como cambio', () => {
    h.athleteId = null
    h.selfId = 'ath_a'
    const scope = captureRequestScope()
    h.athleteId = 'ath_a'
    expect(isRequestScopeCurrent(scope)).toBe(true)
  })

  it('null → un atleta que NO es el self sí cuenta como cambio', () => {
    h.athleteId = null
    h.selfId = 'ath_a'
    const scope = captureRequestScope()
    h.athleteId = 'ath_managed'
    expect(isRequestScopeCurrent(scope)).toBe(false)
  })
})
```

El mock de `activeAthlete` del test debe exponer también `getSelfAthleteId: () => h.selfId` y el `hoisted` incluir `selfId: 'ath_a' as string | null`.

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/athlete/__tests__/requestScope.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Crear el módulo**

```ts
// src/services/athlete/requestScope.ts
import { v4 as uuid } from '../../utils/uuid'
import { getActiveAthleteId, getSelfAthleteId, getSwitchEpoch } from './activeAthlete'

/**
 * Identidad capturada ANTES del primer `await` de una operación del coach y
 * comprobada antes de escribir. Mismo patrón que `pullWorkouts.ts`: se
 * comparan epoch E identidad porque `hydrateActiveAthlete` publica el atleta
 * sin tocar el epoch.
 */
export interface RequestScope {
  athleteId: string | null
  epoch: number
  conversationId?: string
  requestId: string
}

export function captureRequestScope(conversationId?: string): RequestScope {
  return {
    athleteId: getActiveAthleteId(),
    epoch: getSwitchEpoch(),
    ...(conversationId ? { conversationId } : {}),
    requestId: uuid(),
  }
}

/**
 * `null → self` con el mismo epoch es la hidratación inicial, no un switch: se
 * acepta. `null → cualquier otro atleta` es un cambio real aunque el epoch no
 * se haya movido. Cualquier otro cambio de identidad, o un epoch distinto,
 * invalida.
 */
export function isRequestScopeCurrent(scope: RequestScope): boolean {
  if (getSwitchEpoch() !== scope.epoch) return false
  const current = getActiveAthleteId()
  if (scope.athleteId == null) return current == null || current === getSelfAthleteId()
  return current === scope.athleteId
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/services/athlete/__tests__/requestScope.test.ts`
Expected: PASS (4).

- [ ] **Step 5: `CoachEngine` acepta el atleta objetivo capturado**

En `CoachEngine.ts`, `CoachSendOptions` gana:

```ts
  /** Atleta capturado al inicio de la operación; evita leer el holder global tras un await. */
  targetAthleteId?: string | null
```

y en `sendTrackedCoachRequest`, la request usa `targetAthleteId: resolveRequestTargetAthleteId(options?.targetAthleteId)`.

- [ ] **Step 6: El store recibe el scope y lo comprueba antes de persistir**

En `useChatStore.ts`:
1. `import { captureRequestScope, isRequestScopeCurrent, type RequestScope } from '../services/athlete/requestScope'`.
2. Firma en `ChatState`: `sendMessage: (content: string, context?: ChatContext, scope?: RequestScope) => Promise<{ route: ChatRouteKind }>`.
3. En la implementación `sendMessage: async (content, context, scope) => {`, justo después de `const requestStartedAt = Date.now()`: `const requestScope = scope ?? captureRequestScope(get().currentSessionId)`.
4. **Antes de construir y persistir el mensaje del usuario** (antes de `const userMsg = withActiveAthleteStamp<ChatMessage>(…)`), cortar si el scope ya no es vigente. Hoy `withActiveAthleteStamp` estampa con el atleta activo del momento, así que un cambio A→B durante las lecturas de la página guardaría en B un mensaje escrito para A:

```ts
    if (!isRequestScopeCurrent(requestScope)) {
      // La operación se inició para otro atleta. No se persiste nada en el
      // scope nuevo; la página conserva el borrador para que el usuario decida.
      return { route: route.kind, droppedForScopeChange: true }
    }
```

   `sendMessage` devuelve ahora `{ route: ChatRouteKind; droppedForScopeChange?: boolean }` (actualizar la firma en `ChatState`). El mensaje del usuario se estampa con `athleteId: requestScope.athleteId ?? undefined` de forma explícita además del stamp activo, para que ambos coincidan por construcción.
5. En las **cuatro** llamadas al engine (`sendChat`, `sendAction`, `send` y `WeekCreatorEngine.sendWeekCreate`) agregar `targetAthleteId: requestScope.athleteId,` a las opciones. Para el Week Creator, en `WeekCreatorEngine.ts`:
   - `WeekCreatorOptions` gana `/** Atleta capturado al inicio de la operación. */ targetAthleteId?: string | null`.
   - La llamada `provider.call({ … targetAthleteId: resolveRequestTargetAthleteId(), … })` (~línea 389) pasa a `resolveRequestTargetAthleteId(options.targetAthleteId)`.
   - Test en `WeekCreatorEngine.test.ts`: con `provider` inyectado y `targetAthleteId: 'ath_managed'` en las opciones, la request recibida por el provider trae `targetAthleteId: 'ath_managed'` aunque el holder global apunte a otro atleta (mockear `getActiveAthleteId` para devolver `'ath_other'`).
6. Antes de `const coachMsg = buildCoachMessage(response, sessionId)`:

```ts
      if (!isRequestScopeCurrent(requestScope)) {
        // El atleta activo cambió mientras el proveedor respondía. El texto
        // pertenece al atleta original: no se persiste en el scope nuevo.
        if (isCurrentChatRequestOwner(get().currentSessionId, sessionId, abortController)) {
          set({ isLoading: false, streamingText: '', responsePhase: 'idle' })
        }
        return { route: route.kind }
      }
```

7. En la condición de `shouldCreateProposal(...)`, agregar `&& isRequestScopeCurrent(requestScope)`.

- [ ] **Step 7: La página captura el scope, no envía si cambió y conserva el borrador**

En `ChatCoach.tsx`:

1. Estado nuevo: `const [restoredDraft, setRestoredDraft] = useState<string | null>(null)` y `const [scopeNotice, setScopeNotice] = useState<string | null>(null)`.
2. En `submitMessage`, reemplazar la captura:

```ts
    const requestScope = captureRequestScope(useChatStore.getState().currentSessionId)
    const athleteIdAtStart = requestScope.athleteId
```

(borrar `epochAtStart`; importar `captureRequestScope, isRequestScopeCurrent` desde `'../services/athlete/requestScope'`), y reemplazar el envío:

```ts
    if (!isRequestScopeCurrent(requestScope)) {
      // Cambió el atleta mientras se preparaba el contexto. El texto era para el
      // atleta anterior: no se envía a nadie. Se devuelve al compositor para que
      // el usuario decida a quién va.
      setRestoredDraft(message)
      setScopeNotice('Cambió el atleta activo mientras preparaba tu mensaje. Revisa a quién va y vuelve a enviarlo.')
      return
    }
    setScopeNotice(null)
    const result = await sendMessage(
      message,
      buildContext(message, planningSessions, whoopWorkoutBlock ?? undefined),
      requestScope,
    )
    if (result.droppedForScopeChange) {
      setRestoredDraft(message)
      setScopeNotice('Cambió el atleta activo mientras preparaba tu mensaje. Revisa a quién va y vuelve a enviarlo.')
      return
    }
```

3. El compositor recibe el borrador restaurado: `<ChatInput key={restoredDraft ? `restored:${restoredDraft}` : composerDraftKey} onSend={handleSend} disabled={isLoading} initialValue={restoredDraft ?? composerDraft} />`, y `handleSend` hace `setRestoredDraft(null)` antes de `submitMessage`. `scopeNotice` se renderiza con `role="status"` encima del compositor.

Quitar el import de `getSwitchEpoch` si queda sin uso. El `whoopWorkoutBlock` ya no necesita descartarse aparte: si el scope cambió, no se envía nada. Ajustar el mock de `activeAthlete` del test `chatCoachWhoopBlockScope.test.tsx` si el módulo nuevo lo requiere: como `requestScope.ts` importa `getActiveAthleteId` y `getSwitchEpoch` del mismo módulo mockeado, no hace falta un mock adicional.

- [ ] **Step 8: Tests de la página**

En `chatCoachWhoopBlockScope.test.tsx`:

1. El mock de `activeAthlete` agrega `getSelfAthleteId: () => h.athleteId ?? 'ath_a'` (el módulo `requestScope.ts` lo importa).
2. En el caso que envía con scope estable, agregar:

```ts
    const scopeArg = h.sendMessage.mock.calls[0][2]
    expect(scopeArg).toMatchObject({ athleteId: h.athleteId, epoch: h.switchEpoch })
    expect(typeof scopeArg.requestId).toBe('string')
```

3. El caso que hoy simula el cambio de scope dentro de `loadWhoopWorkoutBlock` **cambia de expectativa**: antes verificaba que se enviaba sin bloque Whoop; ahora verifica que **no se envía** y que el borrador vuelve al compositor:

```ts
    expect(h.sendMessage).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('Cambió el atleta activo')
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('¿cómo va mi semana?')
```

   (usar el texto que ese caso envía). Renombrar el caso a `no envía y conserva el borrador si el atleta cambia durante las lecturas`.

- [ ] **Step 9: Test rojo del store con cambio de atleta durante la IA**

```ts
// src/store/__tests__/useChatStoreRequestScope.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../types'

const mocks = vi.hoisted(() => ({
  athleteId: 'ath_a' as string | null,
  epoch: 1,
  chatMessages: [] as ChatMessage[],
  addProposal: vi.fn(),
  sendAction: vi.fn(),
}))

vi.mock('../../services/athlete/activeAthlete', () => ({
  getActiveAthleteId: () => mocks.athleteId,
  getSelfAthleteId: () => 'ath_a',
  getSwitchEpoch: () => mocks.epoch,
  ATHLETE_PROFILE_LOCAL_ID: 'default',
}))
vi.mock('../../db/db', () => ({
  db: {
    chatMessages: {
      add: vi.fn(async (m: ChatMessage) => { mocks.chatMessages.push(m) }),
      update: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    },
    coachProposals: { delete: vi.fn(async () => undefined) },
  },
}))
vi.mock('../../services/syncService', () => ({
  pushChatMessage: vi.fn(), deleteChatMessages: vi.fn(), deleteCoachProposals: vi.fn(), pushCoachProposal: vi.fn(),
}))
vi.mock('../../services/ai/CoachEngine', () => ({
  CoachEngine: {
    sendChat: vi.fn(), send: vi.fn(),
    sendAction: (...args: unknown[]) => mocks.sendAction(...args),
  },
}))
vi.mock('../../services/weekCreator/WeekCreatorEngine', () => ({ WeekCreatorEngine: { sendWeekCreate: vi.fn() } }))
vi.mock('../../services/ai/contextOptimizer', () => ({ optimizeChatContext: (c: unknown) => c }))
vi.mock('../../services/chatRouting', () => ({ resolveChatRoute: () => ({ kind: 'chat_action' }) }))
vi.mock('../useCoachActionsStore', () => ({
  useCoachActionsStore: { getState: () => ({ addProposal: mocks.addProposal, loadProposals: vi.fn() }) },
}))
vi.mock('../useAIDebugStore', () => ({
  useAIDebugStore: { getState: () => ({ completeRequest: vi.fn(), failRequest: vi.fn(), updateRequest: vi.fn(), markFirstChunk: vi.fn() }) },
}))
vi.mock('../useEntitlementStore', () => ({ getEntitlementTier: () => 'advanced' }))
vi.mock('../../utils/chatSession', () => ({
  getOrCreateChatSessionId: () => 'session-1', isLocalOnlyChatSessionId: () => false, setStoredChatSessionId: vi.fn(),
}))

import { useChatStore } from '../useChatStore'

describe('A5 — el scope capturado gobierna la persistencia', () => {
  beforeEach(() => {
    mocks.athleteId = 'ath_a'
    mocks.epoch = 1
    mocks.chatMessages.length = 0
    mocks.addProposal.mockReset()
    mocks.sendAction.mockReset()
    useChatStore.setState({ messages: [], isLoading: false, currentSessionId: 'session-1' })
  })

  it('no persiste el mensaje del coach ni la propuesta si el atleta cambió durante la IA', async () => {
    mocks.sendAction.mockImplementation(async () => {
      mocks.athleteId = 'ath_b'
      mocks.epoch = 2
      return {
        message: 'Te propongo mover la sesión', provider: 'mock', traceId: 't', requestClass: 'chat_action', timestamp: 0,
        actions: [{ type: 'move_session', sessionId: 's1', targetDate: '2026-08-14', reason: 'x' }],
        meta: { hadActionsMarkup: true, actionParseFailed: false, likelyTruncated: false },
      }
    })
    await useChatStore.getState().sendMessage('mueve la sesión al viernes', undefined)
    expect(mocks.chatMessages.filter(m => m.role === 'coach')).toHaveLength(0)
    expect(mocks.addProposal).not.toHaveBeenCalled()
    expect(useChatStore.getState().isLoading).toBe(false)
  })

  it('pasa el atleta capturado al engine como targetAthleteId', async () => {
    mocks.sendAction.mockResolvedValue({
      message: 'ok', provider: 'mock', traceId: 't', requestClass: 'chat_action', timestamp: 0,
      meta: { hadActionsMarkup: false, actionParseFailed: false, likelyTruncated: false },
    })
    await useChatStore.getState().sendMessage('mueve la sesión al viernes', undefined)
    const options = mocks.sendAction.mock.calls[0][2] as { targetAthleteId?: string | null }
    expect(options.targetAthleteId).toBe('ath_a')
  })

  it('con un scope capturado que ya no es vigente no persiste ni el mensaje del usuario', async () => {
    // La página capturó para A; antes de llegar al store el holder ya apunta a B.
    const stale = { athleteId: 'ath_a', epoch: 1, conversationId: 'session-1', requestId: 'r1' }
    mocks.athleteId = 'ath_b'
    const result = await useChatStore.getState().sendMessage('mueve la sesión al viernes', undefined, stale)
    expect(result.droppedForScopeChange).toBe(true)
    expect(mocks.chatMessages).toHaveLength(0)
    expect(mocks.sendAction).not.toHaveBeenCalled()
    expect(useChatStore.getState().isLoading).toBe(false)
  })
})
```

Si el grafo de imports de `useChatStore.ts` exige mockear otro módulo (por ejemplo `../../services/chat/dailyRotation` o `../../services/chat/conversationIndex`), copiar el `vi.mock` correspondiente desde `src/store/__tests__/useChatStore.test.ts`, que ya los resuelve.

- [ ] **Step 10: Correr y verificar que falla, implementar (Step 6), correr y verificar que pasa**

Run: `npx vitest run src/store/__tests__/useChatStoreRequestScope.test.ts`
Expected: FAIL antes del Step 6 (el mensaje del coach se persiste y `addProposal` se llama); PASS después.

- [ ] **Step 11: La nota semanal usa el scope capturado**

En `queries.ts`:

```ts
export const upsertWeekSummary = async (
  weekStartISO: string,
  patch: WeekSummaryPatch,
  explicitScope?: AthleteWeekScope | null,
): Promise<WeekSummary> => {
  const scope = explicitScope ?? captureActiveWeekScope()
  const result = scope
    ? await upsertWeekSummaryCore(scope, weekStartISO, patch)
    : await upsertWeekSummaryLegacy(weekStartISO, patch)
  if (result.changed) void syncService.pushWeekSummary(result.summary)
  return result.summary
}
```

y exportar `captureActiveWeekScope` (`export function captureActiveWeekScope(...)`).

En `useTrainingStore.ts`, `generateCoachNote`:
1. Importar `captureRequestScope, isRequestScopeCurrent` desde `'../services/athlete/requestScope'` y `captureActiveWeekScope` desde `'../db/queries'`.
2. Tras `set({ isLoading: true })`, antes de las lecturas: `const requestScope = captureRequestScope()` y `const weekScope = captureActiveWeekScope()`.
3. Después de obtener `coachNote` y antes de `upsertWeekSummary`:

```ts
      if (!isRequestScopeCurrent(requestScope)) {
        throw new Error('El atleta activo cambió mientras se generaba la nota. No se guardó nada; vuelve a generarla.')
      }
      const summary = await upsertWeekSummary(weekStart, {
        coachNote,
        coachNoteGeneratedAt: Date.now(),
        ...(currentWeekSummary ? { coachNoteSnapshot: buildWeeklyCoachNoteSnapshot(currentWeekSummary) } : {}),
      }, weekScope)
```

- [ ] **Step 12: Test rojo de la nota semanal**

```ts
// src/store/__tests__/useTrainingStoreCoachNoteScope.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  athleteId: 'ath_a' as string | null, epoch: 1,
  upsertWeekSummary: vi.fn(), send: vi.fn(),
}))

vi.mock('../../services/athlete/activeAthlete', () => ({
  getActiveAthleteId: () => mocks.athleteId, getSelfAthleteId: () => 'ath_a', getSwitchEpoch: () => mocks.epoch,
  ATHLETE_PROFILE_LOCAL_ID: 'default', isSelfScopeActive: () => true,
}))
vi.mock('../../db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db/queries')>()
  return {
    ...actual,
    getSessionsForWeek: vi.fn(async () => []),
    getDayLogsForWeek: vi.fn(async () => []),
    getWeekSummary: vi.fn(async () => undefined),
    getAthleteProfile: vi.fn(async () => undefined),
    recalculateWeekSummary: vi.fn(async () => undefined),
    upsertWeekSummary: (...args: unknown[]) => mocks.upsertWeekSummary(...args),
    captureActiveWeekScope: () => ({ athleteId: 'ath_a', includeLegacy: true }),
  }
})
vi.mock('../../services/athlete/coachNotes', () => ({ getCoachMemoryText: vi.fn(async () => undefined) }))
vi.mock('../../services/ai/CoachEngine', () => ({ CoachEngine: { send: (...args: unknown[]) => mocks.send(...args) } }))
vi.mock('../../services/weeklyReviewWindow', () => ({ isWeeklyReviewWindowOpen: () => true }))

import { useTrainingStore } from '../useTrainingStore'
import { currentWeekStartISO } from '../../utils/date'

describe('A5 — nota semanal y scope', () => {
  beforeEach(() => { mocks.athleteId = 'ath_a'; mocks.epoch = 1; mocks.upsertWeekSummary.mockReset(); mocks.send.mockReset() })

  it('no escribe la nota si el atleta cambió durante la IA', async () => {
    mocks.send.mockImplementation(async () => { mocks.athleteId = 'ath_b'; mocks.epoch = 2; return { message: 'Nota para A' } })
    await expect(useTrainingStore.getState().generateCoachNote(currentWeekStartISO())).rejects.toThrow('atleta activo cambió')
    expect(mocks.upsertWeekSummary).not.toHaveBeenCalled()
  })

  it('escribe con el scope capturado al inicio', async () => {
    mocks.send.mockResolvedValue({ message: 'Nota' })
    mocks.upsertWeekSummary.mockResolvedValue({ id: 'w', weekStartDate: currentWeekStartISO(), updatedAt: 0 })
    await useTrainingStore.getState().generateCoachNote(currentWeekStartISO())
    expect(mocks.upsertWeekSummary.mock.calls[0][2]).toEqual({ athleteId: 'ath_a', includeLegacy: true })
  })
})
```

La ruta `../../services/weeklyReviewWindow` es la que importa `useTrainingStore.ts` (línea 24).

- [ ] **Step 13: Correr todo lo de A5**

Run: `npx vitest run src/services/athlete/__tests__/requestScope.test.ts src/store/__tests__/useChatStoreRequestScope.test.ts src/store/__tests__/useTrainingStoreCoachNoteScope.test.ts src/pages/__tests__/chatCoachWhoopBlockScope.test.tsx src/store/__tests__/useChatStore.test.ts && npx tsc -b --pretty false && npm run lint`
Expected: verde.

- [ ] **Step 14: Checkpoint para el owner**

Mensaje sugerido: `fix(scope): identidad capturada y verificada en chat y nota semanal (F01)`.

---

### Task 6: A4.1 — corpus de interpretación esperada y corrección del router del engine (F07)

**Files:**
- Create: `src/services/chatRoutingCorpus.ts`
- Modify: `src/services/chatRouting.ts`
- Test: `src/services/__tests__/chatRoutingCorpus.test.ts` (nuevo)

**Interfaces:**
- Produces: `CHAT_ROUTING_CORPUS: ChatRoutingCorpusCase[]` con `{ id, message, expected: ChatRouteKind, why, recentMessages? }`; `mapChatRouteToRequestClass(kind): AIRequestClass` exportado desde `chatRouting.ts` (movido desde el store).
- Consumes: `resolveChatRoute`.

- [ ] **Step 1: Escribir el corpus**

```ts
// src/services/chatRoutingCorpus.ts
import type { ChatRouteKind } from './chatRouting'

export interface ChatRoutingCorpusCase {
  id: string
  message: string
  expected: ChatRouteKind
  /** Por qué ésta es la interpretación correcta. Cambiarla exige cambiar el motivo. */
  why: string
  recentMessages?: Array<{ role: 'user' | 'coach'; content: string }>
}

/**
 * Interpretación esperada de frases canónicas. UI, store y engine se prueban
 * contra ESTE archivo, no entre sí: dos capas alineadas pueden equivocarse
 * igual. Acordado con el owner el 2026-09-12 (spec §4, A4).
 */
export const CHAT_ROUTING_CORPUS: ChatRoutingCorpusCase[] = [
  { id: 'hist-1', message: '¿Cómo estuvo mi sesión del lunes?', expected: 'chat_general', why: 'Consulta sobre historial; la recuperación de hechos llega en B4.' },
  { id: 'hist-2', message: 'Dame feedback de mi sesión del lunes', expected: 'chat_general', why: '`dame` no es verbo de creación con objeto definido (`mi sesión`).' },
  { id: 'create-1', message: 'Créame una sesión de pesas', expected: 'chat_action', why: 'Creación con objeto indefinido.' },
  { id: 'advice-1', message: '¿Cómo me prepararías para tres semanas de vacaciones?', expected: 'chat_general', why: 'Asesoría en condicional; un horizonte temporal no es una petición de plan.' },
  { id: 'plan-1', message: 'Genera un plan completo hasta el torneo', expected: 'plan_builder_redirect', why: 'Verbo de creación más plan completo.' },
  // Frases que ya fijaban los tests de chatRouting, revisadas una a una.
  { id: 'week-1', message: 'Créame la semana para esta semana', expected: 'week_creator', why: 'Verbo de creación con objeto semana.' },
  { id: 'week-2', message: 'Créame la semana para la próxima semana', expected: 'week_creator', why: 'Idem, próxima semana.' },
  { id: 'day-1', message: 'Armame el lunes con running suave', expected: 'chat_action', why: 'Día más deporte sin scope de semana.' },
  { id: 'day-2', message: 'Agrega squash el jueves PM', expected: 'chat_action', why: 'Verbo de ajuste con día.' },
  { id: 'bypass-1', message: 'pon descanso el lunes', expected: 'chat_action', why: 'Mutación con día.' },
  { id: 'bypass-2', message: 'borra el entreno del jueves', expected: 'chat_action', why: 'Borrado con día.' },
  { id: 'plural-1', message: 'cámbiame una de las sesiones de fuerza', expected: 'chat_action', why: 'Cambio sobre una sesión.' },
  { id: 'colloq-1', message: 'quiero squash mañana', expected: 'chat_action', why: 'Creación coloquial con día.' },
  { id: 'colloq-2', message: 'Dame la sesión de pesas para mañana lunes', expected: 'chat_action', why: '`dame` con día y objeto de sesión: pedido de contenido para agendar.' },
  { id: 'qualifier-1', message: 'Créame una sesión de fuerza con superseries para el lunes de la próxima semana', expected: 'chat_action', why: 'La semana es calificador temporal.' },
  { id: 'general-1', message: 'cómo va mi semana', expected: 'chat_general', why: 'Conversación.' },
  { id: 'general-2', message: '¿Qué debería priorizar hoy antes de mis sesiones?', expected: 'chat_general', why: 'Asesoría; nombra sesión y día pero pide criterio.' },
  { id: 'general-3', message: '¿Cuánto debería bajar la carga esta semana?', expected: 'chat_general', why: 'Asesoría.' },
  { id: 'summary-1', message: 'Resumeme la semana y dejame un balance corto', expected: 'weekly_summary', why: 'Resumen semanal explícito.' },
  { id: 'fullplan-1', message: 'Hazme el plan hasta el evento', expected: 'plan_builder_redirect', why: 'Plan completo hasta el evento.' },
  { id: 'multiweek-1', message: 'Arma las próximas tres semanas de entrenamiento', expected: 'plan_builder_redirect', why: 'Verbo de creación más varias semanas.' },
  // Anáforas y confirmaciones: en A, sin intención pendiente estructurada, son conversación.
  { id: 'anaphora-1', message: 'Muévela al viernes', expected: 'chat_general', why: 'Anáfora sin referente ni intención pendiente: se pide aclaración (A). B4 la resuelve.' },
  { id: 'confirm-1', message: 'sí', expected: 'chat_general', why: 'Confirmación corta sin oferta estructurada vigente es conversación (A4.4).',
    recentMessages: [{ role: 'user', content: 'Quiero una sesión de fuerza el lunes.' }, { role: 'coach', content: 'Te propongo una sesión de fuerza para el lunes.' }] },
]
```

Los dos últimos casos (`anaphora-1`, `confirm-1`) quedan en el corpus pero **se marcan pendientes hasta la Tarea 9** (ver Step 2): describen el contrato final de A.

- [ ] **Step 2: Test del corpus (engine)**

```ts
// src/services/__tests__/chatRoutingCorpus.test.ts
import { describe, expect, it } from 'vitest'
import { resolveChatRoute } from '../chatRouting'
import { CHAT_ROUTING_CORPUS } from '../chatRoutingCorpus'

/** Casos cuyo contrato depende de la intención pendiente (Tarea 9). */
export const PENDING_INTENT_CASES = new Set(['anaphora-1', 'confirm-1'])

describe('corpus de interpretación — engine', () => {
  for (const testCase of CHAT_ROUTING_CORPUS) {
    const run = PENDING_INTENT_CASES.has(testCase.id) ? it.skip : it
    run(`${testCase.id}: "${testCase.message}" → ${testCase.expected}`, () => {
      const context = testCase.recentMessages
        ? { recentSessions: [], plannedSessions: [], historicalSessions: [], recentMessages: testCase.recentMessages }
        : undefined
      expect(resolveChatRoute(testCase.message, context).kind, testCase.why).toBe(testCase.expected)
    })
  }
})
```

- [ ] **Step 3: Correr y ver qué falla**

Run: `npx vitest run src/services/__tests__/chatRoutingCorpus.test.ts`
Expected: FAIL en `hist-1`, `hist-2` (hoy `chat_action`) y `advice-1` (hoy `plan_builder_redirect`). Los demás pasan.

- [ ] **Step 4: Corregir el engine**

En `chatRouting.ts`:

1. Nuevos patrones junto a los existentes:

```ts
// Preguntas sobre lo que YA pasó: nombran sesión y día, pero no piden cambiar
// nada. Sin este desvío, "¿cómo estuvo mi sesión del lunes?" exigía una
// propuesta estructurada que no existe.
const HISTORY_QUESTION_PATTERN = /\b(estuvo|fue|salio|anduvo|me fue|resulto|rindio)\b/
// Pedidos de valoración. `dame feedback de mi sesión` comparte verbo con
// `dame una sesión`, pero el objeto es DEFINIDO y el sustantivo es evaluativo.
const FEEDBACK_REQUEST_PATTERN = /\b(feedback|opinion|analisis|evaluacion|comentarios?|valoracion|retroalimentacion)\b/
// Condicionales de asesoría: piden un criterio hipotético, no una acción.
const CONDITIONAL_ADVISORY_PATTERN = /\b(prepararias|planificarias|organizarias|armarias|harias|recomendarias|priorizarias|ajustarias|cambiarias)\b/
```

2. Ampliar `ADVISORY_QUESTION_PATTERN` para aceptar también los condicionales: reemplazar su `(?:deberia|recomiendas?|priorizar|conviene|mejor)` por `(?:deberia|recomiendas?|priorizar|conviene|mejor|prepararias|planificarias|organizarias|armarias|harias|recomendarias|priorizarias|ajustarias|cambiarias)`.

3. En `resolveChatRoute`, reemplazar el bloque de plan completo:

```ts
  if (
    FULL_PLAN_PATTERN.test(normalized)
    || (MULTI_WEEK_PATTERN.test(normalized) && WEEK_PLANNING_VERB_PATTERN.test(normalized) && !CONDITIONAL_ADVISORY_PATTERN.test(normalized))
  ) {
    return { kind: 'plan_builder_redirect', targetWeekStart }
  }
```

4. Inmediatamente después del desvío `ADVISORY_QUESTION_PATTERN`, agregar:

```ts
  const asksAboutHistory = /^[¿?\s]*(?:como|que\s+tal|que)\b/.test(normalized) && HISTORY_QUESTION_PATTERN.test(normalized)
  const asksForFeedback = FEEDBACK_REQUEST_PATTERN.test(normalized) && /\b(mi|mis|la|el|del|de\s+la)\s+(?:\w+\s+){0,2}(?:sesion|entreno|entrenamiento|semana|partido)\b/.test(normalized)
  if ((asksAboutHistory || asksForFeedback) && !MUTATION_INTENT_PATTERN.test(normalized)) {
    return { kind: 'chat_general' }
  }
```

5. Mover `mapChatRouteToRequestClass` desde `useChatStore.ts` a `chatRouting.ts` como `export function mapChatRouteToRequestClass(route: ChatRouteKind): AIRequestClass` (importar `AIRequestClass` de `'../types'`); en el store, importarla desde `'../services/chatRouting'` y borrar la copia local.

- [ ] **Step 5: Correr corpus y tests existentes del router**

Run: `npx vitest run src/services/__tests__/chatRoutingCorpus.test.ts src/services/__tests__/chatRouting.test.ts src/services/__tests__/CoachEngine.test.ts src/store/__tests__/useChatStore.test.ts`
Expected: PASS (con los dos `skip` del corpus). Si alguna frase de `chatRouting.test.ts` cambia de ruta, agregarla al corpus con su `why` antes de ajustar el test; si no hay `why` defendible, el cambio de código es incorrecto.

- [ ] **Step 6: Tipos y lint; checkpoint**

Run: `npx tsc -b --pretty false && npm run lint`
Mensaje sugerido: `fix(routing): corpus de interpretación y desvío de consultas históricas y asesoría (F07, engine)`.

---

### Task 7: A4.2 — la UI enruta con el mismo router que el engine (F07)

Depende de la Tarea 6.

**Files:**
- Modify: `src/services/ai/contextOptimizer.ts` (`detectChatIntent`, ~línea 48)
- Modify: `src/pages/ChatCoach.tsx` (`buildContext` `intent`, `submitMessage` `requestClass`)
- Test: `src/services/__tests__/contextOptimizer.test.ts` (ajustar expectativas ~líneas 67–74)
- Test: `src/services/__tests__/chatRoutingCorpus.test.ts` (segundo bloque: proyección de UI)

**Interfaces:**
- Produces: `intentFromRoute(kind: ChatRouteKind): ChatContext['intent']`; `detectChatIntent(message, context?)` como proyección.
- Consumes: `resolveChatRoute`, `mapChatRouteToRequestClass` (Tarea 6).

- [ ] **Step 1: Test rojo de paridad UI–corpus**

Agregar a `chatRoutingCorpus.test.ts`:

```ts
import { detectChatIntent, inferRequestClassFromIntent } from '../ai/contextOptimizer'
import { mapChatRouteToRequestClass } from '../chatRouting'

describe('corpus de interpretación — proyección de la UI', () => {
  for (const testCase of CHAT_ROUTING_CORPUS) {
    const run = PENDING_INTENT_CASES.has(testCase.id) ? it.skip : it
    run(`${testCase.id}: la clase de request de la UI coincide con la ruta esperada`, () => {
      const context = testCase.recentMessages
        ? { recentSessions: [], plannedSessions: [], historicalSessions: [], recentMessages: testCase.recentMessages }
        : undefined
      const uiClass = inferRequestClassFromIntent(detectChatIntent(testCase.message, context))
      const expectedClass = testCase.expected === 'plan_builder_redirect'
        ? 'chat_general' // la UI navega; el gate de chat_action no aplica
        : mapChatRouteToRequestClass(testCase.expected)
      expect(uiClass, testCase.why).toBe(expectedClass)
    })
  }
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/__tests__/chatRoutingCorpus.test.ts`
Expected: FAIL en `create-1` (UI dice `chat_general`), `week-*` (UI dice `chat_action` vía `plan_week`) y otros.

- [ ] **Step 3: `detectChatIntent` como proyección**

En `contextOptimizer.ts`, reemplazar la función completa:

```ts
import { resolveChatRoute, type ChatRouteKind } from '../chatRouting'

/** Proyección del router único hacia el `intent` legacy de `ChatContext`. */
export function intentFromRoute(kind: ChatRouteKind): ChatContext['intent'] {
  switch (kind) {
    case 'weekly_summary': return 'weekly_summary'
    case 'week_creator': return 'plan_week'
    case 'chat_action': return 'adjust_session'
    case 'plan_builder_redirect':
    case 'chat_general':
    default:
      return 'general_chat'
  }
}

/**
 * Ya no tiene regex propias: es una proyección de `resolveChatRoute`, que es
 * la autoridad. Se conserva por compatibilidad con `ChatContext.intent`.
 */
export function detectChatIntent(message: string, context?: ChatContext): ChatContext['intent'] {
  return intentFromRoute(resolveChatRoute(message, context).kind)
}
```

y ajustar `inferRequestClassFromIntent`: `plan_week` pasa a `'week_creator'` (antes `'chat_action'`):

```ts
export function inferRequestClassFromIntent(intent: ChatContext['intent'] | undefined): AIRequestClass {
  switch (intent) {
    case 'plan_week': return 'week_creator'
    case 'adjust_session': return 'chat_action'
    case 'weekly_summary': return 'weekly_summary'
    default: return 'chat_general'
  }
}
```

- [ ] **Step 4: La página resuelve la ruta con los mensajes recientes**

En `ChatCoach.tsx`:
1. Reemplazar el import `detectChatIntent, inferRequestClassFromIntent` por `import { intentFromRoute } from '../services/ai/contextOptimizer'` y `import { mapChatRouteToRequestClass, resolveChatRoute } from '../services/chatRouting'`.
2. En `buildContext`, el campo `intent` pasa a:

```ts
      intent: intentFromRoute(resolveChatRoute(message, {
        recentSessions: [], plannedSessions: [], historicalSessions: [],
        recentMessages: messages.map((item) => ({ role: item.role, content: item.content })),
      }).kind),
```

y agregar `messages` a las dependencias del `useCallback`.
3. En `submitMessage`, la primera línea pasa a:

```ts
    const route = resolveChatRoute(message, {
      recentSessions: [], plannedSessions: [], historicalSessions: [],
      recentMessages: messages.map((item) => ({ role: item.role, content: item.content })),
    })
    const requestClass = mapChatRouteToRequestClass(route.kind)
```

y agregar `messages` a las dependencias del `useCallback` de `submitMessage`.

- [ ] **Step 5: Ajustar expectativas del test del optimizador**

En `contextOptimizer.test.ts`, el bloque `detects broader plan and summary intents`:

```ts
    expect(detectChatIntent('Hazme un plan para esta semana')).toBe('plan_week')
    expect(detectChatIntent('Armame el lunes con running suave')).toBe('adjust_session')
    expect(detectChatIntent('cámbiame una de las sesiones de fuerza')).toBe('adjust_session')
    expect(detectChatIntent('pon descanso el lunes')).toBe('adjust_session')
    expect(detectChatIntent('borra el entreno del jueves')).toBe('adjust_session')
    expect(detectChatIntent('Resumeme la semana y dejame un balance corto')).toBe('weekly_summary')
    // A4.2: la UI ya no clasifica por su cuenta.
    expect(detectChatIntent('Créame una sesión de pesas')).toBe('adjust_session')
    expect(detectChatIntent('¿Cómo estuvo mi sesión del lunes?')).toBe('general_chat')
```

y en `maps weekly summary intent`: `expect(inferRequestClassFromIntent('plan_week')).toBe('week_creator')`.

- [ ] **Step 6: Correr todo lo de routing y la página**

Run: `npx vitest run src/services/__tests__/chatRoutingCorpus.test.ts src/services/__tests__/contextOptimizer.test.ts src/pages/__tests__ && npx tsc -b --pretty false && npm run lint`
Expected: verde. El test `chatCoachWhoopBlockScope` mockea `useChatStore` sin `messages` reales: `messages: []` ya está en su mock.

- [ ] **Step 7: Checkpoint**

Mensaje sugerido: `fix(chat-ui): la página enruta con resolveChatRoute; detectChatIntent es proyección (F07, UI)`.

---

### Task 8: A4.3 — eventos conversacionales estructurados, separados de las acciones

**Files:**
- Modify: `src/services/ai/types.ts` (`CoachConversationEvent`, `CoachNormalizedResponse.conversationEvents`)
- Modify: `src/services/ai/responseNormalizer.ts` (`parseActionsBlock`, `unwrapActionCandidates`, `normalizeResponse`)
- Modify: `src/services/ai/coachRecovery.ts` (`shouldRetryAction`)
- Modify: `src/services/ai/CoachEngine.ts` (rechazo por "sin acciones" en `sendTrackedCoachRequest`, ~línea 262)
- Modify: `src/services/ai/prompt/packs/quality/generalChat.ts` (contrato de ofertas)
- Test: `src/services/__tests__/responseNormalizer.test.ts` (agregar)
- Test: `src/services/__tests__/CoachEngine.test.ts` (agregar)
- Test: `src/services/__tests__/coachEngineConversationEvents.test.ts` (nuevo, recorrido por `sendAction`)
- Test: `src/store/__tests__/useChatStoreRequestScope.test.ts` (agregar caso: aclaración sin propuesta)

**Interfaces:**
- Produces:

```ts
export type CoachConversationEvent =
  | { kind: 'offer_generation'; route: 'week_creator' | 'plan_builder_redirect'; targetWeekStart?: string; summary: string }
  | {
      kind: 'ask_clarification'
      operation: 'move_session' | 'update_session' | 'delete_session' | 'add_session'
      missing: string[]
      known: Record<string, string | number>
      summary: string
    }
```

  y `CoachNormalizedResponse.conversationEvents?: CoachConversationEvent[]`.
- Consumes: bloque `<actions>` existente como transporte.

- [ ] **Step 1: Tests rojos del normalizador**

Agregar a `responseNormalizer.test.ts`:

```ts
describe('A4.3 — eventos conversacionales', () => {
  const raw = (text: string, requestClass: 'chat_general' | 'chat_action' = 'chat_general') => ({
    text, provider: 'mock' as const, requestClass, traceId: 't',
  })

  it('extrae offer_generation a conversationEvents y no lo cuenta como acción', () => {
    const response = normalizeResponse(raw(
      'Puedo armarte la semana completa.\n<actions>[{"type":"offer_generation","route":"week_creator","targetWeekStart":"2026-09-14","summary":"Armar la semana del 14"}]</actions>',
    ))
    expect(response.actions).toBeUndefined()
    expect(response.conversationEvents).toEqual([
      { kind: 'offer_generation', route: 'week_creator', targetWeekStart: '2026-09-14', summary: 'Armar la semana del 14' },
    ])
    expect(response.meta?.outcome).toBe('ok')
    expect(response.meta?.invalidActionCount).toBe(0)
    expect(response.message).toBe('Puedo armarte la semana completa.')
  })

  it('extrae ask_clarification con datos conocidos y faltantes', () => {
    const response = normalizeResponse(raw(
      '¿Qué sesión quieres mover?\n<actions>[{"type":"ask_clarification","operation":"move_session","missing":["sessionId"],"known":{"targetDate":"2026-09-18"},"summary":"Mover una sesión al viernes"}]</actions>',
      'chat_action',
    ))
    expect(response.actions).toBeUndefined()
    expect(response.conversationEvents?.[0]).toMatchObject({ kind: 'ask_clarification', operation: 'move_session', missing: ['sessionId'], known: { targetDate: '2026-09-18' } })
    expect(response.meta?.actionParseFailed).toBe(false)
  })

  it('convive con acciones reales sin mezclarse', () => {
    const response = normalizeResponse(raw(
      'Listo.\n<actions>[{"type":"move_session","sessionId":"s1","targetDate":"2026-09-18","reason":"pedido"},{"type":"offer_generation","route":"week_creator","summary":"Después te armo la semana"}]</actions>',
      'chat_action',
    ))
    expect(response.actions).toHaveLength(1)
    expect(response.conversationEvents).toHaveLength(1)
  })

  it('descarta eventos malformados sin contaminar el conteo de acciones inválidas', () => {
    const response = normalizeResponse(raw('<actions>[{"type":"offer_generation","route":"otra_cosa","summary":"x"}]</actions>'))
    expect(response.conversationEvents).toBeUndefined()
    expect(response.meta?.invalidActionCount).toBe(0)
    expect(response.meta?.outcome).toBe('ok')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/__tests__/responseNormalizer.test.ts`
Expected: FAIL — `conversationEvents` es `undefined`; el evento cuenta como acción inválida y `outcome` no es `ok`.

- [ ] **Step 3: Tipos**

En `src/services/ai/types.ts`, después de `CreateWeekNormalizationDiagnostic`, agregar el tipo `CoachConversationEvent` del bloque *Interfaces*, y en `CoachNormalizedResponse`, debajo de `actions?`:

```ts
  /**
   * Eventos conversacionales estructurados (ofertas, aclaraciones). Viajan en
   * el bloque <actions> sólo como transporte: NUNCA son acciones de
   * entrenamiento, no entran al postprocesador ni crean propuestas.
   */
  conversationEvents?: CoachConversationEvent[]
```

- [ ] **Step 4: Normalizador**

En `responseNormalizer.ts`:

1. Constantes junto a `VALID_ACTION_TYPES`:

```ts
const CONVERSATION_EVENT_TYPES = new Set(['offer_generation', 'ask_clarification'])
const VALID_OFFER_ROUTES = new Set(['week_creator', 'plan_builder_redirect'])
const VALID_CLARIFICATION_OPERATIONS = new Set(['move_session', 'update_session', 'delete_session', 'add_session'])
```

2. `unwrapActionCandidates`: en las dos comprobaciones de objeto único, aceptar también eventos:

```ts
    if (typeof record.type === 'string' && (VALID_ACTION_TYPES.has(record.type as CoachActionType) || CONVERSATION_EVENT_TYPES.has(record.type))) {
      return [record]
    }
```

3. Nueva función:

```ts
function validateConversationEvent(obj: unknown): CoachConversationEvent | null {
  if (!obj || typeof obj !== 'object') return null
  const record = obj as Record<string, unknown>
  const summary = typeof record.summary === 'string' ? record.summary.trim() : ''
  if (!summary) return null
  if (record.type === 'offer_generation') {
    if (typeof record.route !== 'string' || !VALID_OFFER_ROUTES.has(record.route)) return null
    return {
      kind: 'offer_generation',
      route: record.route as 'week_creator' | 'plan_builder_redirect',
      ...(isValidDate(record.targetWeekStart) ? { targetWeekStart: record.targetWeekStart } : {}),
      summary,
    }
  }
  if (record.type === 'ask_clarification') {
    if (typeof record.operation !== 'string' || !VALID_CLARIFICATION_OPERATIONS.has(record.operation)) return null
    const missing = Array.isArray(record.missing) ? record.missing.filter((item): item is string => typeof item === 'string') : []
    const known: Record<string, string | number> = {}
    if (record.known && typeof record.known === 'object') {
      for (const [key, value] of Object.entries(record.known as Record<string, unknown>)) {
        if (typeof value === 'string' || typeof value === 'number') known[key] = value
      }
    }
    return {
      kind: 'ask_clarification',
      operation: record.operation as 'move_session' | 'update_session' | 'delete_session' | 'add_session',
      missing, known, summary,
    }
  }
  return null
}

function isConversationEventCandidate(item: unknown): boolean {
  return Boolean(item) && typeof item === 'object'
    && typeof (item as Record<string, unknown>).type === 'string'
    && CONVERSATION_EVENT_TYPES.has((item as Record<string, unknown>).type as string)
}
```

(`isValidDate` ya existe en el archivo; importar `CoachConversationEvent` desde `'./types'`.)

4. `parseActionsBlock`: separar candidatos **antes** de validar acciones. Su tipo de retorno gana `conversationEvents: CoachConversationEvent[]` (agregar `conversationEvents: []` a los tres `return` de fallo y al de `recoverPartialCreateWeekActions`), y el cuerpo final pasa a:

```ts
  const eventCandidates = actionCandidates.filter(isConversationEventCandidate)
  const actionOnlyCandidates = actionCandidates.filter((item) => !isConversationEventCandidate(item))
  const conversationEvents = eventCandidates
    .map(validateConversationEvent)
    .filter((event): event is CoachConversationEvent => event != null)

  const createWeekDiagnostics: CreateWeekNormalizationDiagnostic[] = []
  const actions = actionOnlyCandidates.reduce<CoachAction[]>((acc, item) => {
    const result = validateAction(item)
    if (result.action) acc.push(result.action)
    if (result.createWeekDiagnostic) createWeekDiagnostics.push(result.createWeekDiagnostic)
    return acc
  }, [])
  const invalidActionCount = actionOnlyCandidates.length - actions.length
  const droppedCreateWeekSessions = createWeekDiagnostics.some((diagnostic) => diagnostic.droppedSessions > 0)

  return {
    actions,
    conversationEvents,
    parseFailed: actions.length === 0 && actionOnlyCandidates.length > 0,
    likelyTruncated: invalidActionCount > 0 || droppedCreateWeekSessions || isLikelyTruncatedJson(jsonText),
    invalidActionCount,
    createWeekDiagnostics,
  }
```

5. `normalizeResponse`: declarar `let conversationEvents: CoachConversationEvent[] = []`, asignar `conversationEvents = parseResult.conversationEvents` en las tres ramas que llaman a `parseActionsBlock`, y en el objeto devuelto: `conversationEvents: conversationEvents.length > 0 ? conversationEvents : undefined,`.

- [ ] **Step 5: Correr el normalizador**

Run: `npx vitest run src/services/__tests__/responseNormalizer.test.ts`
Expected: PASS.

- [ ] **Step 6: La recuperación no reintenta por "faltan acciones" cuando hay eventos**

En `coachRecovery.ts`:

```ts
export function shouldRetryAction(response: CoachNormalizedResponse): boolean {
  return (
    response.meta?.actionParseFailed === true
    || response.meta?.likelyTruncated === true
    || ((response.actions?.length ?? 0) === 0 && (response.conversationEvents?.length ?? 0) === 0)
  )
}
```

Test en `CoachEngine.test.ts`:

```ts
  it('no reintenta una respuesta que sólo trae una aclaración estructurada', () => {
    const response = makeResponse({
      requestClass: 'chat_action',
      message: '¿Qué sesión quieres mover?',
      conversationEvents: [{ kind: 'ask_clarification', operation: 'move_session', missing: ['sessionId'], known: {}, summary: 'Mover' }],
      meta: { hadActionsMarkup: true, actionParseFailed: false, likelyTruncated: false },
    })
    expect(shouldRetry(response)).toBe(false)
  })
```

Run: `npx vitest run src/services/__tests__/CoachEngine.test.ts` → PASS.

- [ ] **Step 6b: El engine no rechaza una aclaración válida (recorrido por `sendAction`)**

`sendTrackedCoachRequest` lanza `parse_error` cuando un `chat_action` termina sin acciones (línea ~262), aunque traiga un evento válido. Cambiar la condición:

```ts
      const hasConversationEvents = (finalResult.conversationEvents?.length ?? 0) > 0
      if (requestClass === 'chat_action' && !safetyBlocked && !hasConversationEvents && (finalResult.actions?.length ?? 0) === 0) {
```

y en el `updateRequest` de telemetría agregar `conversationEventCount: finalResult.conversationEvents?.length ?? 0` (agregar el campo opcional al tipo del patch en `useAIDebugStore` si su tipo es estricto).

Test de recorrido, con el proveedor real de la clase mockeado en el resolver:

```ts
// src/services/__tests__/coachEngineConversationEvents.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AIProvider } from '../ai/types'

const mocks = vi.hoisted(() => ({ text: '' }))
const provider: AIProvider = {
  name: 'mock',
  call: async (request) => ({ text: mocks.text, provider: 'mock', requestClass: request.requestClass, traceId: request.traceId }),
}
vi.mock('../ai/providerResolver', () => ({
  getProviderForRequestClass: () => provider,
  getActiveProvider: () => provider,
  isRealProviderConfigured: () => false,
}))
vi.mock('../ai/aiTelemetry', () => ({ assertDailyAIRequestLimit: vi.fn(async () => undefined), recordCoachFeedback: vi.fn() }))
vi.mock('../athlete/activeAthlete', () => ({ getActiveAthleteId: () => 'ath_a', getSelfAthleteId: () => 'ath_a', getSwitchEpoch: () => 0, ATHLETE_PROFILE_LOCAL_ID: 'default' }))

import { CoachEngine } from '../ai/CoachEngine'

describe('A4.3 — sendAction con eventos conversacionales', () => {
  beforeEach(() => { mocks.text = '' })

  it('una aclaración estructurada llega sin error, sin acciones y sin reintento', async () => {
    mocks.text = '¿Qué sesión quieres mover?\n<actions>[{"type":"ask_clarification","operation":"move_session","missing":["sessionId"],"known":{"targetDate":"2026-09-18"},"summary":"Mover una sesión al viernes"}]</actions>'
    const response = await CoachEngine.sendAction('muévela al viernes', { recentSessions: [], plannedSessions: [], historicalSessions: [] })
    expect(response.actions).toBeUndefined()
    expect(response.conversationEvents?.[0]).toMatchObject({ kind: 'ask_clarification', operation: 'move_session' })
    expect(response.retryUsed).not.toBe(true)
    expect(response.message).toBe('¿Qué sesión quieres mover?')
  })

  it('una respuesta sin acciones ni eventos sigue rechazándose', async () => {
    mocks.text = 'Claro, te cuento cómo hacerlo.'
    await expect(CoachEngine.sendAction('muévela al viernes', { recentSessions: [], plannedSessions: [], historicalSessions: [] }))
      .rejects.toThrow('No pude crear una propuesta aplicable')
  })
})
```

Si `CoachEngine.ts` importa módulos con efectos de Dexie que el test no necesita (`safetyOutcomeTelemetry`, `useAIDebugStore`), mockearlos con `vi.mock` devolviendo funciones vacías, igual que hace `CoachEngine.telemetry.test.ts`.

Test en el store (`useChatStoreRequestScope.test.ts`): una respuesta de `sendAction` con sólo `conversationEvents` persiste el mensaje del coach, **no** llama a `addProposal` y deja `error: null`:

```ts
  it('una aclaración estructurada llega al hilo sin propuesta deportiva ni error', async () => {
    mocks.sendAction.mockResolvedValue({
      message: '¿Qué sesión quieres mover?', provider: 'mock', traceId: 't', requestClass: 'chat_action', timestamp: 0,
      conversationEvents: [{ kind: 'ask_clarification', operation: 'move_session', missing: ['sessionId'], known: { targetDate: '2026-09-18' }, summary: 'Mover' }],
      meta: { hadActionsMarkup: true, actionParseFailed: false, likelyTruncated: false },
    })
    await useChatStore.getState().sendMessage('muévela al viernes', undefined)
    expect(mocks.chatMessages.filter(m => m.role === 'coach')).toHaveLength(1)
    expect(mocks.addProposal).not.toHaveBeenCalled()
    expect(useChatStore.getState().error).toBeNull()
  })
```

Run: `npx vitest run src/services/__tests__/coachEngineConversationEvents.test.ts src/store/__tests__/useChatStoreRequestScope.test.ts` → PASS.

- [ ] **Step 7: Contrato en el prompt de chat general**

Leer completo `src/services/ai/prompt/packs/quality/generalChat.ts` y `buildLitePromptResult` en `promptBuilder.ts` (sección `response_instructions`) antes de editar. En `buildGeneralChatInstructionsSection`, agregar después de la línea `- Si el usuario pide explícitamente crear o ajustar el plan, entonces responde con acciones estructuradas.`:

```ts
- Si detectas que lo que el usuario necesita es una semana completa o un plan, NO la generes acá: ofrécela con un evento estructurado en un bloque <actions>: [{"type":"offer_generation","route":"week_creator","targetWeekStart":"YYYY-MM-DD","summary":"<qué ofreces en una frase>"}]. Usa "plan_builder_redirect" si son varias semanas. Un evento no es una acción: no crea nada hasta que el usuario confirme.
- Si te falta un dato indispensable para una acción (qué sesión, qué día), pídelo con [{"type":"ask_clarification","operation":"move_session","missing":["sessionId"],"known":{"targetDate":"YYYY-MM-DD"},"summary":"<qué falta>"}] en lugar de adivinar.
```

Correr `npx vitest run src/services/__tests__/promptBuilder* src/services/ai` para confirmar que ningún snapshot del prompt lite falla; si uno falla exclusivamente por estas dos líneas, actualizarlo.

- [ ] **Step 8: Tipos, lint, checkpoint**

Run: `npx tsc -b --pretty false && npm run lint`
Mensaje sugerido: `feat(chat): eventos conversacionales estructurados separados de las acciones (A4.3)`.

---

### Task 9: A4.4 — intención pendiente tipada y confirmaciones ligadas a algo concreto

Depende de las Tareas 5, 6 y 8.

**Files:**
- Create: `src/services/chat/pendingIntent.ts`
- Modify: `src/services/chatRouting.ts` (`resolveChatRoute` con `options`, retiro de la confirmación por regex)
- Modify: `src/store/useChatStore.ts` (estado `pendingIntent`, consumo en `sendMessage`, propuesta determinista para move/delete, alta al recibir respuesta, reset)
- Modify: `src/types/index.ts` (`ChatContext.pendingOperation`)
- Modify: `src/services/ai/contextOptimizer.ts` (conserva `pendingOperation`)
- Modify: `src/services/ai/promptBuilder.ts` (sección `pending_operation` en `buildAdjustActionPromptResult`; leer el builder completo antes)
- Modify: `src/pages/ChatCoach.tsx` (el gate de la página pasa `pendingIntent` y `scope` al router)
- Modify: `src/services/chatRoutingCorpus.ts` (quitar el `skip` de `anaphora-1`/`confirm-1`; agregar casos con intención)
- Test: `src/services/chat/__tests__/pendingIntent.test.ts` (nuevo)
- Test: `src/services/__tests__/chatRouting.test.ts` (dos casos de confirmación cambian de expectativa)
- Test: `src/store/__tests__/useChatStorePendingIntent.test.ts` (nuevo)

**Interfaces:**
- Produces:

```ts
export interface PendingIntent {
  id: string
  kind: 'generation_offer' | 'clarification'
  athleteId: string | null
  conversationId: string
  createdAt: number
  expiresAt: number
  status: 'open' | 'consumed' | 'cancelled'
  route: 'week_creator' | 'plan_builder_redirect' | 'chat_action'
  operation:
    | { type: 'create_week'; targetWeekStart?: string }
    | { type: 'move_session' | 'update_session' | 'delete_session' | 'add_session'; known: Record<string, string | number>; missing: string[] }
  summary: string
}
export const PENDING_INTENT_TTL_MS = 10 * 60_000
export function pendingIntentFromEvents(events, scope: { athleteId: string | null; conversationId: string }, now: number): PendingIntent | null
export type PendingIntentDecision =
  | { kind: 'consume'; route: PendingIntent['route']; targetWeekStart?: string }
  | { kind: 'already_consumed' }
  | { kind: 'cancel' }
  | { kind: 'fill'; missing: string[] }
  | { kind: 'none' }
export function resolvePendingIntentDecision(normalizedMessage, intent, scope, now): PendingIntentDecision
```

  `resolveChatRoute(message, context?, options?: { pendingIntent?: PendingIntent | null; scope?: { athleteId: string | null; conversationId: string }; now?: number })`; `ChatRouteResolution.consumedIntentId?: string`.
- Consumes: `CoachConversationEvent` (Tarea 8), `RequestScope` (Tarea 5), `CHAT_ROUTING_CORPUS` (Tarea 6).

- [ ] **Step 1: Test rojo del módulo puro**

```ts
// src/services/chat/__tests__/pendingIntent.test.ts
import { describe, expect, it } from 'vitest'
import { PENDING_INTENT_TTL_MS, pendingIntentFromEvents, resolvePendingIntentDecision } from '../pendingIntent'

const scope = { athleteId: 'ath_a', conversationId: 'conv-1' }
const now = 1_000_000

const offer = () => pendingIntentFromEvents(
  [{ kind: 'offer_generation', route: 'week_creator', targetWeekStart: '2026-09-14', summary: 'Armar la semana' }], scope, now,
)!
const clarification = () => pendingIntentFromEvents(
  [{ kind: 'ask_clarification', operation: 'move_session', missing: ['sessionId'], known: { targetDate: '2026-09-18' }, summary: 'Mover' }], scope, now,
)!

describe('pendingIntent', () => {
  it('crea una oferta abierta con vencimiento y pertenencia', () => {
    expect(offer()).toMatchObject({ kind: 'generation_offer', status: 'open', route: 'week_creator', athleteId: 'ath_a', conversationId: 'conv-1', expiresAt: now + PENDING_INTENT_TTL_MS })
  })

  it('"dale" consume la oferta y conserva su semana objetivo', () => {
    expect(resolvePendingIntentDecision('dale', offer(), scope, now + 1)).toEqual({ kind: 'consume', route: 'week_creator', targetWeekStart: '2026-09-14' })
  })

  it('una confirmación de otro atleta o conversación no consume', () => {
    expect(resolvePendingIntentDecision('si', offer(), { athleteId: 'ath_b', conversationId: 'conv-1' }, now + 1)).toEqual({ kind: 'none' })
    expect(resolvePendingIntentDecision('si', offer(), { athleteId: 'ath_a', conversationId: 'conv-2' }, now + 1)).toEqual({ kind: 'none' })
  })

  it('vencida no consume', () => {
    expect(resolvePendingIntentDecision('si', offer(), scope, now + PENDING_INTENT_TTL_MS + 1)).toEqual({ kind: 'none' })
  })

  it('"no, solo explicame" cancela', () => {
    expect(resolvePendingIntentDecision('no, solo explicame', offer(), scope, now + 1)).toEqual({ kind: 'cancel' })
  })

  it('una oferta consumida no se vuelve a consumir', () => {
    const consumed = { ...offer(), status: 'consumed' as const }
    expect(resolvePendingIntentDecision('si', consumed, scope, now + 1)).toEqual({ kind: 'already_consumed' })
  })

  it('"sí" cuando falta la sesión vuelve a pedirla', () => {
    expect(resolvePendingIntentDecision('si', clarification(), scope, now + 1, [])).toMatchObject({ kind: 'fill', missing: ['sessionId'], candidates: [] })
  })

  it('conversación en dos turnos: "la del lunes" deja candidatos y "PM" basta para resolver', () => {
    const planned = [session('s-am', '2026-09-14', 'AM', 'Squash'), session('s-pm', '2026-09-14', 'PM', 'Fuerza')]
    const monday = new Date('2026-09-13T12:00:00').getTime()
    const first = resolvePendingIntentDecision('la del lunes', clarification(), scope, monday, planned)
    expect(first).toMatchObject({ kind: 'fill', missing: ['sessionId'] })
    if (first.kind !== 'fill') throw new Error('esperaba fill')
    expect(first.operation).toMatchObject({ candidates: [{ id: 's-am' }, { id: 's-pm' }] })
    // El store guarda `first.operation`; el turno siguiente parte de ahí.
    const second = resolvePendingIntentDecision('pm', { ...clarification(), operation: first.operation }, scope, monday + 1, planned)
    expect(second).toMatchObject({ kind: 'consume', route: 'chat_action', operation: { known: { sessionId: 's-pm', targetDate: '2026-09-18' }, missing: [] } })
  })

  it('un dato parcialmente resuelto no se pierde entre turnos', () => {
    const askBoth = { ...clarification(), operation: { type: 'move_session' as const, known: {}, missing: ['sessionId', 'targetDate'] } }
    const monday = new Date('2026-09-13T12:00:00').getTime()
    const first = resolvePendingIntentDecision('al viernes', askBoth, scope, monday, [])
    if (first.kind !== 'fill') throw new Error('esperaba fill')
    expect(first.operation).toMatchObject({ known: { targetDate: '2026-09-18' }, missing: ['sessionId'] })
  })

  it('"la del lunes" resuelve el referente si hay exactamente una sesión ese día y consume la operación completa', () => {
    const planned = [
      session('s-mon', '2026-09-14', 'AM', 'Squash técnico'),
      session('s-tue', '2026-09-15', 'AM', 'Fuerza'),
    ]
    const decision = resolvePendingIntentDecision('la del lunes', clarification(), scope, now + 1, planned)
    expect(decision).toEqual({ kind: 'consume', route: 'chat_action', operation: { type: 'move_session', known: { targetDate: '2026-09-18', sessionId: 's-mon' }, missing: [] } })
  })

  it('"la del lunes" con dos sesiones ese día pide la franja y devuelve candidatos', () => {
    const planned = [session('s-am', '2026-09-14', 'AM', 'Squash'), session('s-pm', '2026-09-14', 'PM', 'Fuerza')]
    const decision = resolvePendingIntentDecision('la del lunes', clarification(), scope, now + 1, planned)
    expect(decision).toMatchObject({ kind: 'fill', missing: ['sessionId'] })
    if (decision.kind === 'fill') expect(decision.candidates.map(c => c.id)).toEqual(['s-am', 's-pm'])
  })

  it('"la del lunes PM" desambigua por franja', () => {
    const planned = [session('s-am', '2026-09-14', 'AM', 'Squash'), session('s-pm', '2026-09-14', 'PM', 'Fuerza')]
    const decision = resolvePendingIntentDecision('la del lunes pm', clarification(), scope, now + 1, planned)
    expect(decision).toMatchObject({ kind: 'consume', operation: { known: { sessionId: 's-pm' } } })
  })

  it('una aclaración ya completa sólo se consume ante una respuesta compatible', () => {
    const complete = { ...clarification(), operation: { type: 'move_session' as const, known: { targetDate: '2026-09-18', sessionId: 's1' }, missing: [] } }
    expect(resolvePendingIntentDecision('si', complete, scope, now + 1, [])).toMatchObject({ kind: 'consume', route: 'chat_action' })
    expect(resolvePendingIntentDecision('muevela al viernes', complete, scope, now + 1, [])).toMatchObject({ kind: 'consume', route: 'chat_action' })
    // Una pregunta nueva no consume: sigue su ruta normal y la intención queda abierta.
    expect(resolvePendingIntentDecision('cuanto deberia dormir esta semana', complete, scope, now + 1, [])).toEqual({ kind: 'none' })
  })
})

function session(id: string, date: string, timeBlock: 'AM' | 'PM', title: string) {
  return { id, date, weekStartDate: '2026-09-14', timeBlock, type: 'squash' as const, status: 'planned' as const, title, durationMin: 60, createdAt: 0, updatedAt: 0 }
}
```

`resolvePendingIntentDecision` recibe un quinto argumento: las sesiones planificadas del contexto, para resolver referentes. La resolución en A cubre **día de la semana, "hoy"/"mañana" y franja AM/PM**; referencias por título o por deporte ("la de squash") son B4 y devuelven `fill` con candidatos.

- [ ] **Step 2: Correr y verificar que falla; crear el módulo**

Run: `npx vitest run src/services/chat/__tests__/pendingIntent.test.ts` → FAIL (módulo inexistente).

```ts
// src/services/chat/pendingIntent.ts
import type { CoachConversationEvent } from '../ai/types'
import { v4 as uuid } from '../../utils/uuid'

export const PENDING_INTENT_TTL_MS = 10 * 60_000

export interface PendingIntent {
  id: string
  kind: 'generation_offer' | 'clarification'
  athleteId: string | null
  conversationId: string
  createdAt: number
  expiresAt: number
  status: 'open' | 'consumed' | 'cancelled'
  route: 'week_creator' | 'plan_builder_redirect' | 'chat_action'
  operation:
    | { type: 'create_week'; targetWeekStart?: string }
    | {
        type: 'move_session' | 'update_session' | 'delete_session' | 'add_session'
        known: Record<string, string | number>
        missing: string[]
        /** Candidatos del turno anterior (p. ej. dos sesiones el lunes); permiten que "PM" baste en el turno siguiente. */
        candidates?: PlannedRef[]
      }
  summary: string
}

export interface PendingIntentScope {
  athleteId: string | null
  conversationId: string
}

export type PendingIntentDecision =
  | { kind: 'consume'; route: PendingIntent['route']; targetWeekStart?: string; operation?: PendingIntent['operation'] }
  | { kind: 'already_consumed' }
  | { kind: 'cancel' }
  /** `operation` es la operación PARCIALMENTE completada: el store la guarda para el turno siguiente. */
  | { kind: 'fill'; missing: string[]; candidates: PlannedRef[]; operation: PendingIntent['operation'] }
  | { kind: 'none' }

export type PlannedRef = Pick<Session, 'id' | 'date' | 'timeBlock' | 'title'>

const CONFIRMATION_PATTERN = /^\s*(si|sí|ok|okay|dale|confirmo|correcto|hazlo|hacelo|procede|adelante|va|listo|de una)\b[\s!.]*$/
const NEGATION_PATTERN = /\b(no|nop|mejor no|dejalo|olvidalo|todavia no|aun no|solo explicame|explicame|cancela)\b/
/** Verbos que hacen a un mensaje COMPATIBLE con la operación pendiente. */
const OPERATION_VERBS: Record<Exclude<PendingIntent['operation'], { type: 'create_week' }>['type'], RegExp> = {
  move_session: /\b(mueve|muevela|muevelo|pasa|pasala|pasalo|cambia(?:la|lo)? de dia|reprograma)\b/,
  update_session: /\b(cambia|cambiala|cambialo|modifica|ajusta|acorta|alarga|baja|sube|reemplaza)\b/,
  delete_session: /\b(borra|borrala|borralo|elimina|eliminala|saca|sacala|quita|quitala)\b/,
  add_session: /\b(agrega|agregala|pon|ponla|ponme|crea|creala|arma|armala|programa)\b/,
}
const WEEKDAY_INDEX: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 }
const MISSING_LABELS: Record<string, string> = { sessionId: 'qué sesión', targetDate: 'qué día', timeBlock: 'qué franja (AM o PM)', newDurationMin: 'cuántos minutos' }

export function describeMissing(missing: string[]): string {
  return missing.map(key => MISSING_LABELS[key] ?? key).join(', ')
}

/**
 * Resuelve el dato faltante a partir de la respuesta del usuario. En A cubre
 * día de la semana, hoy/mañana y franja AM/PM contra las sesiones planificadas.
 * Referencias por título o deporte son B4: devuelven candidatos sin resolver.
 */
function resolveClarificationReply(
  normalizedMessage: string,
  operation: Exclude<PendingIntent['operation'], { type: 'create_week' }>,
  planned: PlannedRef[],
  now: number,
): { operation: typeof operation; candidates: PlannedRef[] } {
  const known = { ...operation.known }
  const missing = [...operation.missing]
  const dayToken = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|hoy|manana)\b/.exec(normalizedMessage)?.[1]
  const block = /\b(am|pm)\b/.exec(normalizedMessage)?.[1]?.toUpperCase() as 'AM' | 'PM' | undefined
  // Punto de partida: los candidatos que dejó el turno anterior, si los hubo.
  let candidates: PlannedRef[] = operation.candidates ?? []
  if (dayToken) {
    const date = resolveDateToken(dayToken, now)
    if (missing.includes('targetDate') && date) {
      known.targetDate = date
      missing.splice(missing.indexOf('targetDate'), 1)
    } else if (missing.includes('sessionId')) {
      candidates = planned.filter(s => s.date === date)
    }
  }
  if (missing.includes('sessionId') && candidates.length > 0) {
    // Con o sin día en este turno, la franja acota los candidatos acumulados.
    const narrowed = block ? candidates.filter(s => s.timeBlock === block) : candidates
    if (narrowed.length === 1) {
      known.sessionId = narrowed[0].id
      missing.splice(missing.indexOf('sessionId'), 1)
      candidates = []
    } else {
      candidates = narrowed.length > 0 ? narrowed : candidates
    }
  }
  return { operation: { ...operation, known, missing, ...(candidates.length > 0 ? { candidates } : {}) }, candidates }
}

function resolveDateToken(token: string, now: number): string | undefined {
  const base = new Date(now)
  const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (token === 'hoy') return toIso(base)
  if (token === 'manana') { base.setDate(base.getDate() + 1); return toIso(base) }
  const target = WEEKDAY_INDEX[token]
  if (target == null) return undefined
  // Próxima ocurrencia del día nombrado, contando hoy.
  const delta = (target - base.getDay() + 7) % 7
  base.setDate(base.getDate() + delta)
  return toIso(base)
}

/** La primera oferta o aclaración gana; una respuesta con varias no abre varias intenciones. */
export function pendingIntentFromEvents(
  events: CoachConversationEvent[] | undefined,
  scope: PendingIntentScope,
  now: number,
): PendingIntent | null {
  const event = events?.[0]
  if (!event) return null
  const base = { id: uuid(), athleteId: scope.athleteId, conversationId: scope.conversationId, createdAt: now, expiresAt: now + PENDING_INTENT_TTL_MS, status: 'open' as const, summary: event.summary }
  if (event.kind === 'offer_generation') {
    return { ...base, kind: 'generation_offer', route: event.route, operation: { type: 'create_week', targetWeekStart: event.targetWeekStart } }
  }
  return { ...base, kind: 'clarification', route: 'chat_action', operation: { type: event.operation, known: event.known, missing: event.missing } }
}

function belongsTo(intent: PendingIntent, scope: PendingIntentScope): boolean {
  return intent.athleteId === scope.athleteId && intent.conversationId === scope.conversationId
}

export function resolvePendingIntentDecision(
  normalizedMessage: string,
  intent: PendingIntent | null | undefined,
  scope: PendingIntentScope,
  now: number,
  plannedSessions: PlannedRef[],
): PendingIntentDecision {
  if (!intent || !belongsTo(intent, scope)) return { kind: 'none' }
  if (intent.status === 'cancelled' || now > intent.expiresAt) return { kind: 'none' }
  const confirms = CONFIRMATION_PATTERN.test(normalizedMessage)
  if (intent.status === 'consumed') return confirms ? { kind: 'already_consumed' } : { kind: 'none' }
  if (NEGATION_PATTERN.test(normalizedMessage)) return { kind: 'cancel' }
  if (intent.operation.type === 'create_week') {
    return confirms
      ? { kind: 'consume', route: intent.route, ...(intent.operation.targetWeekStart ? { targetWeekStart: intent.operation.targetWeekStart } : {}) }
      : { kind: 'none' }
  }
  // Aclaración: primero intentar completar el dato con la respuesta.
  const resolved = resolveClarificationReply(normalizedMessage, intent.operation, plannedSessions, now)
  if (resolved.operation.missing.length > 0) {
    // Se devuelve la operación parcial (con lo que sí se resolvió y los
    // candidatos) para que el store la guarde y el turno siguiente parta de ahí.
    return { kind: 'fill', missing: resolved.operation.missing, candidates: resolved.candidates, operation: resolved.operation }
  }
  // Completa: se consume sólo ante una respuesta COMPATIBLE (confirmación, el
  // dato que faltaba, o el verbo de la operación). Una pregunta nueva no la
  // dispara; la intención queda abierta y el mensaje sigue su ruta normal.
  const filledSomething = resolved.operation.missing.length < intent.operation.missing.length
  const compatible = confirms || filledSomething || OPERATION_VERBS[intent.operation.type].test(normalizedMessage)
  return compatible
    ? { kind: 'consume', route: 'chat_action', operation: resolved.operation }
    : { kind: 'none' }
}
```

(importar `type Session` desde `'../../types'`).

Run: `npx vitest run src/services/chat/__tests__/pendingIntent.test.ts` → PASS.

- [ ] **Step 3: El router consume la intención y deja de adivinar confirmaciones**

En `chatRouting.ts`:

1. `import { resolvePendingIntentDecision, type PendingIntent, type PendingIntentScope } from './chat/pendingIntent'`.
2. `ChatRouteResolution` gana `consumedIntentId?: string`, `pendingOperation?: PendingIntent['operation']` (la operación completada que el ejecutor debe usar) y `pendingDecision?: Extract<PendingIntentDecision, { kind: 'fill' | 'cancel' | 'already_consumed' }>` (la decisión completa, con `missing` y `candidates` cuando es `fill`).
3. Firma: `export function resolveChatRoute(message: string, context?: ChatContext, options?: { pendingIntent?: PendingIntent | null; scope?: PendingIntentScope; now?: number }): ChatRouteResolution`.
4. Reemplazar el bloque `if (isActionConfirmation(normalized) && hasRecentActionDiscussion(context)) { return { kind: 'chat_action' } }` por:

```ts
  if (options?.pendingIntent && options.scope) {
    const decision = resolvePendingIntentDecision(
      normalized, options.pendingIntent, options.scope, options.now ?? Date.now(), context?.plannedSessions ?? [],
    )
    if (decision.kind === 'consume') {
      return {
        kind: decision.route,
        targetWeekStart: decision.targetWeekStart ?? targetWeekStart,
        consumedIntentId: options.pendingIntent.id,
        ...(decision.operation ? { pendingOperation: decision.operation } : {}),
      }
    }
    if (decision.kind === 'fill' || decision.kind === 'cancel' || decision.kind === 'already_consumed') {
      return { kind: 'chat_general', pendingDecision: decision }
    }
  }
  // Sin intención pendiente estructurada, una confirmación corta es conversación:
  // no hay nada concreto que confirmar. (Antes: regex sobre los últimos ocho
  // mensajes; retirada en A4.4.)
```

5. Borrar `isActionConfirmation`, `hasRecentActionDiscussion`, `ACTION_CONFIRMATION_PATTERN` y `RECENT_ACTION_DISCUSSION_PATTERN` si quedan sin uso.

- [ ] **Step 4: Corpus con intención pendiente y expectativas de confirmación**

En `chatRoutingCorpus.test.ts`, borrar `PENDING_INTENT_CASES` y los `it.skip` (todos los casos corren). Agregar casos con intención en un tercer bloque:

```ts
import { pendingIntentFromEvents } from '../chat/pendingIntent'

describe('corpus — intención pendiente', () => {
  const scope = { athleteId: 'ath_a', conversationId: 'conv-1' }
  const now = 5_000_000
  const offer = pendingIntentFromEvents([{ kind: 'offer_generation', route: 'week_creator', targetWeekStart: '2026-09-14', summary: 'Semana' }], scope, now)
  const askSession = pendingIntentFromEvents([{ kind: 'ask_clarification', operation: 'move_session', missing: ['sessionId'], known: { targetDate: '2026-09-18' }, summary: 'Mover' }], scope, now)
  const resolved = askSession && { ...askSession, operation: { type: 'move_session' as const, known: { targetDate: '2026-09-18', sessionId: 's1' }, missing: [] } }

  it('"dale" tras una oferta de semana → week_creator con su semana', () => {
    const route = resolveChatRoute('dale', undefined, { pendingIntent: offer, scope, now: now + 1 })
    expect(route).toMatchObject({ kind: 'week_creator', targetWeekStart: '2026-09-14', consumedIntentId: offer!.id })
  })
  it('"sí" cuando falta la sesión → se vuelve a pedir', () => {
    expect(resolveChatRoute('sí', undefined, { pendingIntent: askSession, scope, now: now + 1 })).toMatchObject({ kind: 'chat_general', pendingDecision: { kind: 'fill', missing: ['sessionId'] } })
  })
  it('"la del lunes" con una sola sesión ese día → chat_action con la operación completa', () => {
    const context = { recentSessions: [], historicalSessions: [], plannedSessions: [
      { id: 's-mon', date: '2026-09-14', weekStartDate: '2026-09-14', timeBlock: 'AM' as const, type: 'squash' as const, status: 'planned' as const, title: 'Squash', durationMin: 60, createdAt: 0, updatedAt: 0 },
    ] }
    // `now` debe caer en la semana del 14 de septiembre de 2026 para que "lunes" resuelva al 14.
    const monday = new Date('2026-09-13T12:00:00').getTime()
    const route = resolveChatRoute('la del lunes', context, { pendingIntent: askSession, scope, now: monday })
    expect(route).toMatchObject({ kind: 'chat_action', consumedIntentId: askSession!.id, pendingOperation: { type: 'move_session', known: { sessionId: 's-mon', targetDate: '2026-09-18' }, missing: [] } })
  })
  it('"muévela al viernes" con referente identificado → chat_action', () => {
    expect(resolveChatRoute('Muévela al viernes', undefined, { pendingIntent: resolved, scope, now: now + 1 }).kind).toBe('chat_action')
  })
  it('una pregunta nueva con una aclaración completa abierta NO la consume', () => {
    expect(resolveChatRoute('¿cuánto debería dormir esta semana?', undefined, { pendingIntent: resolved, scope, now: now + 1 })).toMatchObject({ kind: 'chat_general' })
    expect(resolveChatRoute('¿cuánto debería dormir esta semana?', undefined, { pendingIntent: resolved, scope, now: now + 1 }).consumedIntentId).toBeUndefined()
  })
  it('"muévela al viernes" con una intención de OTRO tipo no habilita la acción', () => {
    expect(resolveChatRoute('Muévela al viernes', undefined, { pendingIntent: offer, scope, now: now + 1 }).kind).toBe('chat_general')
  })
  it('"no, sólo explícame" cancela', () => {
    expect(resolveChatRoute('no, sólo explícame', undefined, { pendingIntent: offer, scope, now: now + 1 })).toMatchObject({ kind: 'chat_general', pendingDecision: { kind: 'cancel' } })
  })
  it('oferta consumida + otro "sí" → no se vuelve a generar', () => {
    expect(resolveChatRoute('sí', undefined, { pendingIntent: { ...offer!, status: 'consumed' }, scope, now: now + 1 })).toMatchObject({ kind: 'chat_general', pendingDecision: { kind: 'already_consumed' } })
  })
})
```

En `chatRouting.test.ts`, los dos tests `routes short confirmations…` y `routes "créala"…` cambian su expectativa a `chat_general` y su título a `…sin intención pendiente estructurada es conversación`, citando `chatRoutingCorpus.ts#confirm-1`.

Run: `npx vitest run src/services/__tests__/chatRoutingCorpus.test.ts src/services/__tests__/chatRouting.test.ts` → PASS.

- [ ] **Step 5: El store guarda, consume y cancela la intención**

En `useChatStore.ts`:

1. Import: `import { pendingIntentFromEvents, type PendingIntent } from '../services/chat/pendingIntent'`.
2. `ChatState` gana `pendingIntent: PendingIntent | null` (inicial `null`); `resetForAthleteSwitch` lo pone en `null`.
3. En `sendMessage`, la resolución de ruta pasa a (la línea `const requestScope = …` de la Tarea 5 se mueve acá, antes de la ruta; el corte por scope del Step 4 de la Tarea 5 sigue **antes** de persistir el mensaje del usuario):

```ts
    const requestScope = scope ?? captureRequestScope(get().currentSessionId)
    const intentScope = { athleteId: requestScope.athleteId, conversationId: get().currentSessionId }
    const route = resolveChatRoute(content, routeContext, { pendingIntent: get().pendingIntent, scope: intentScope })
    const decision = route.pendingDecision
    if (decision?.kind === 'already_consumed') {
      await appendLocalCoachMessage(get, set, requestScope, 'Esa generación ya quedó en marcha con tu confirmación anterior; no la repito. Si quieres otra, pídemela con el cambio que necesitas.')
      return { route: route.kind }
    }
    if (decision?.kind === 'fill' && get().pendingIntent) {
      const intent = get().pendingIntent!
      // Guardar el avance parcial: lo resuelto y los candidatos quedan en la
      // intención para que el turno siguiente ("PM") parta de ahí.
      set({ pendingIntent: { ...intent, operation: decision.operation } })
      const candidates = decision.candidates.length > 0
        ? ` Ese día tienes: ${decision.candidates.map(c => `${c.title} (${c.timeBlock})`).join(', ')}. Dime cuál.`
        : ''
      await appendLocalCoachMessage(get, set, requestScope, `Todavía me falta un dato para ${intent.summary.toLowerCase()}: ${describeMissing(decision.missing)}.${candidates}`)
      return { route: route.kind }
    }
    if (decision?.kind === 'cancel') set({ pendingIntent: null })
    if (route.consumedIntentId) {
      set(state => ({ pendingIntent: state.pendingIntent?.id === route.consumedIntentId ? { ...state.pendingIntent, status: 'consumed' } : state.pendingIntent }))
    } else if (route.kind !== 'chat_general' && get().pendingIntent?.status === 'open') {
      // Empezó otra operación: la oferta anterior deja de estar vigente.
      set({ pendingIntent: null })
    }
```

4. **Entrega de la operación completada al ejecutor.** Después de persistir el mensaje del usuario y antes de llamar al engine:

```ts
    if (route.pendingOperation && route.pendingOperation.type !== 'create_week') {
      const local = buildDeterministicActionFromOperation(route.pendingOperation)
      if (local) {
        // move_session / delete_session con todos sus datos: no hace falta IA.
        // Se crea la PROPUESTA (nunca se aplica): la tarjeta sigue siendo la aceptación.
        // Misma disciplina que la ruta con IA: comprobar scope Y conversación
        // después de CADA await, y deshacer lo escrito si cambió. `addProposal`
        // estampa con el atleta activo del momento, así que sin esta
        // comprobación mensaje y propuesta podrían quedar en scopes distintos.
        const stillOwns = () => isRequestScopeCurrent(requestScope) && isActiveChatRequest(get().currentSessionId, sessionId, abortController)
        if (!stillOwns()) return { route: route.kind, droppedForScopeChange: true }
        const coachMsg = buildCoachMessage({ ...emptyNormalizedResponse('chat_action'), message: local.message }, sessionId)
        await db.chatMessages.add(coachMsg)
        if (!stillOwns()) { await discardLateCoachArtifacts(coachMsg); return { route: route.kind, droppedForScopeChange: true } }
        const proposal = await useCoachActionsStore.getState().addProposal(local.message, [local.action], coachMsg.id, { source: 'chat' })
        if (!stillOwns()) { await discardLateCoachArtifacts(coachMsg, proposal.id); return { route: route.kind, droppedForScopeChange: true } }
        coachMsg.proposalId = proposal.id
        await db.chatMessages.update(coachMsg.id, { proposalId: proposal.id })
        if (!stillOwns()) { await discardLateCoachArtifacts(coachMsg, proposal.id); return { route: route.kind, droppedForScopeChange: true } }
        void syncService.pushChatMessage(coachMsg)
        set(state => ({ messages: [...state.messages, coachMsg], isLoading: false, streamingText: '', responsePhase: 'idle', conversationsDirty: true }))
        return { route: route.kind }
      }
      // update_session / add_session: necesitan IA. La operación viaja en el contexto
      // como dato estructurado, no como texto libre.
      enrichedContext.pendingOperation = route.pendingOperation
    }
```

   `ChatContext` gana `pendingOperation?: { type: 'update_session' | 'add_session' | 'move_session' | 'delete_session'; known: Record<string, string | number>; missing: string[] }` (opcional, no persistido). En `promptBuilder.ts`, dentro de `buildAdjustActionPromptResult`, se agrega una sección `pending_operation` **sólo cuando `context.pendingOperation` existe** — leer completo el builder de acciones antes de tocarlo:

```ts
function buildPendingOperationSection(context: ChatContext): string {
  const op = context.pendingOperation
  if (!op) return ''
  const known = Object.entries(op.known).map(([key, value]) => `${key}=${String(value)}`).join(', ')
  return `═══ OPERACIÓN CONFIRMADA POR EL USUARIO ═══\n- Tipo: ${op.type}\n- Datos ya resueltos: ${known || 'ninguno'}\n- Emite exactamente UNA acción de ese tipo usando esos datos; no pidas de nuevo lo que ya está resuelto.`
}
```

   y `optimizeChatContext` **no** recorta `pendingOperation` (es un objeto pequeño; copiarlo tal cual en el resultado).

5. Al persistir la respuesta del engine (después de `set({ conversationsDirty: true })` del mensaje del coach):

```ts
      const nextIntent = pendingIntentFromEvents(response.conversationEvents, intentScope, Date.now())
      if (nextIntent) set({ pendingIntent: nextIntent })
```

6. Helpers al final del archivo:

```ts
function buildDeterministicActionFromOperation(
  op: Exclude<PendingIntent['operation'], { type: 'create_week' }>,
): { action: CoachAction; message: string } | null {
  const sessionId = typeof op.known.sessionId === 'string' ? op.known.sessionId : undefined
  const targetDate = typeof op.known.targetDate === 'string' ? op.known.targetDate : undefined
  if (op.type === 'move_session' && sessionId && targetDate) {
    return { action: { type: 'move_session', sessionId, targetDate, reason: 'Confirmado por el atleta en el chat.' }, message: `Propongo mover la sesión al ${targetDate}. Revisa y aplica cuando quieras.` }
  }
  if (op.type === 'delete_session' && sessionId) {
    return { action: { type: 'delete_session', sessionId, reason: 'Confirmado por el atleta en el chat.' }, message: 'Propongo eliminar esa sesión. Revisa y aplica cuando quieras.' }
  }
  return null
}

function emptyNormalizedResponse(requestClass: AIRequestClass): CoachNormalizedResponse {
  return { message: '', provider: 'mock', traceId: `local-${uuid()}`, requestClass, timestamp: Date.now(), filteredCreateWeek: false }
}

/** Respuesta local (sin IA). Conserva las garantías de scope y de conversación. */
async function appendLocalCoachMessage(
  get: () => ChatState,
  set: (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void,
  requestScope: RequestScope,
  content: string,
): Promise<void> {
  const owns = () => isRequestScopeCurrent(requestScope)
    && (!requestScope.conversationId || requestScope.conversationId === get().currentSessionId)
  if (!owns()) return
  const message = withActiveAthleteStamp<ChatMessage>({
    id: uuid(), role: 'coach', content, timestamp: Date.now(), chatSessionId: get().currentSessionId, provider: 'mock',
  })
  await db.chatMessages.add(message)
  // El await pudo cruzarse con un cambio de atleta o de hilo: volver a comprobar
  // antes de tocar la UI, y deshacer la escritura si ya no somos dueños.
  if (!owns()) { await db.chatMessages.delete(message.id); return }
  void syncService.pushChatMessage(message)
  set(state => ({ messages: [...state.messages, message], conversationsDirty: true }))
}
```

   `describeMissing` se importa desde `pendingIntent.ts`. `'mock'` es un `AIProviderName` válido y ya se usa para mensajes sin proveedor.

7. **El gate de la página usa los mismos insumos.** En `ChatCoach.tsx` (Tarea 7), las dos llamadas a `resolveChatRoute` pasan también `{ pendingIntent: useChatStore.getState().pendingIntent, scope: { athleteId: getActiveAthleteId(), conversationId: useChatStore.getState().currentSessionId } }` como tercer argumento. Sin esto, la UI clasificaría "dale" como `chat_general` mientras el store lo ejecuta como `week_creator`, y el gate de entitlement volvería a divergir. El test de `chatCoachWhoopBlockScope` agrega `pendingIntent: null` al mock del store.

- [ ] **Step 6: Test del store**

```ts
// src/store/__tests__/useChatStorePendingIntent.test.ts
// Mismo andamiaje que useChatStoreRequestScope.test.ts, pero el router
// (`../../services/chatRouting`) se deja REAL: acá se prueba la intención.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../types'

const mocks = vi.hoisted(() => ({
  athleteId: 'ath_a' as string | null,
  epoch: 1,
  chatMessages: [] as ChatMessage[],
  addProposal: vi.fn(),
  sendAction: vi.fn(),
  sendChat: vi.fn(),
  sendWeekCreate: vi.fn(),
}))

vi.mock('../../services/athlete/activeAthlete', () => ({
  getActiveAthleteId: () => mocks.athleteId,
  getSelfAthleteId: () => 'ath_a',
  getSwitchEpoch: () => mocks.epoch,
  ATHLETE_PROFILE_LOCAL_ID: 'default',
}))
vi.mock('../../db/db', () => ({
  db: {
    chatMessages: {
      add: vi.fn(async (m: ChatMessage) => { mocks.chatMessages.push(m) }),
      update: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      put: vi.fn(async () => undefined),
    },
    coachProposals: { delete: vi.fn(async () => undefined) },
  },
}))
vi.mock('../../services/syncService', () => ({
  pushChatMessage: vi.fn(), deleteChatMessages: vi.fn(), deleteCoachProposals: vi.fn(), pushCoachProposal: vi.fn(),
}))
vi.mock('../../services/ai/CoachEngine', () => ({
  CoachEngine: {
    sendChat: (...args: unknown[]) => mocks.sendChat(...args),
    sendAction: (...args: unknown[]) => mocks.sendAction(...args),
    send: vi.fn(),
  },
}))
vi.mock('../../services/weekCreator/WeekCreatorEngine', () => ({
  WeekCreatorEngine: { sendWeekCreate: (...args: unknown[]) => mocks.sendWeekCreate(...args) },
}))
vi.mock('../../services/ai/contextOptimizer', () => ({ optimizeChatContext: (c: unknown) => c }))
vi.mock('../useCoachActionsStore', () => ({
  useCoachActionsStore: { getState: () => ({ addProposal: mocks.addProposal, loadProposals: vi.fn() }) },
}))
vi.mock('../useAIDebugStore', () => ({
  useAIDebugStore: { getState: () => ({ completeRequest: vi.fn(), failRequest: vi.fn(), updateRequest: vi.fn(), markFirstChunk: vi.fn() }) },
}))
vi.mock('../useEntitlementStore', () => ({ getEntitlementTier: () => 'advanced' }))
vi.mock('../../utils/chatSession', () => ({
  getOrCreateChatSessionId: () => 'session-1', isLocalOnlyChatSessionId: () => false, setStoredChatSessionId: vi.fn(),
}))

import { useChatStore } from '../useChatStore'

describe('A4.4 — intención pendiente en el store', () => {
  beforeEach(() => {
    mocks.athleteId = 'ath_a'; mocks.epoch = 1; mocks.chatMessages.length = 0
    mocks.sendChat.mockReset(); mocks.sendWeekCreate.mockReset()
    useChatStore.setState({ messages: [], isLoading: false, currentSessionId: 'session-1', pendingIntent: null })
  })

  it('una oferta estructurada deja una intención abierta y "dale" la consume hacia week_creator', async () => {
    mocks.sendChat.mockResolvedValue({
      message: 'Puedo armarte la semana.', provider: 'mock', traceId: 't', requestClass: 'chat_general', timestamp: 0,
      conversationEvents: [{ kind: 'offer_generation', route: 'week_creator', targetWeekStart: '2026-09-14', summary: 'Armar la semana' }],
      meta: { hadActionsMarkup: true, actionParseFailed: false, likelyTruncated: false },
    })
    await useChatStore.getState().sendMessage('¿me conviene planificar la semana?')
    expect(useChatStore.getState().pendingIntent).toMatchObject({ status: 'open', route: 'week_creator' })

    mocks.sendWeekCreate.mockResolvedValue({ message: 'Semana lista', provider: 'mock', traceId: 't2', requestClass: 'week_creator', timestamp: 0, actions: [], meta: { hadActionsMarkup: true, actionParseFailed: false, likelyTruncated: false } })
    const result = await useChatStore.getState().sendMessage('dale')
    expect(result.route).toBe('week_creator')
    expect(mocks.sendWeekCreate.mock.calls[0][2]).toMatchObject({ targetWeekStart: '2026-09-14' })
    expect(useChatStore.getState().pendingIntent?.status).toBe('consumed')
  })

  it('un segundo "sí" no vuelve a generar', async () => {
    useChatStore.setState({ pendingIntent: {
      id: 'i1', kind: 'generation_offer', athleteId: 'ath_a', conversationId: 'session-1', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
      status: 'consumed', route: 'week_creator', operation: { type: 'create_week', targetWeekStart: '2026-09-14' }, summary: 'Armar la semana',
    } })
    await useChatStore.getState().sendMessage('sí')
    expect(mocks.sendWeekCreate).not.toHaveBeenCalled()
    expect(mocks.sendChat).not.toHaveBeenCalled()
    expect(mocks.chatMessages.at(-1)?.content).toContain('ya quedó en marcha')
  })

  it('una aclaración completada con "la del lunes" crea la propuesta sin llamar a la IA y no la aplica', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T12:00:00'))
    useChatStore.setState({ pendingIntent: {
      id: 'i2', kind: 'clarification', athleteId: 'ath_a', conversationId: 'session-1', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
      status: 'open', route: 'chat_action', operation: { type: 'move_session', known: { targetDate: '2026-09-18' }, missing: ['sessionId'] }, summary: 'Mover una sesión al viernes',
    } })
    mocks.addProposal.mockResolvedValue({ id: 'p1' })
    const context = { recentSessions: [], historicalSessions: [], plannedSessions: [
      { id: 's-mon', date: '2026-09-14', weekStartDate: '2026-09-14', timeBlock: 'AM' as const, type: 'squash' as const, status: 'planned' as const, title: 'Squash', durationMin: 60, createdAt: 0, updatedAt: 0 },
    ] }
    const result = await useChatStore.getState().sendMessage('la del lunes', context)
    expect(result.route).toBe('chat_action')
    expect(mocks.sendAction).not.toHaveBeenCalled()
    expect(mocks.addProposal).toHaveBeenCalledTimes(1)
    expect(mocks.addProposal.mock.calls[0][1]).toEqual([{ type: 'move_session', sessionId: 's-mon', targetDate: '2026-09-18', reason: 'Confirmado por el atleta en el chat.' }])
    expect(useChatStore.getState().pendingIntent?.status).toBe('consumed')
    vi.useRealTimers()
  })

  it('"la del lunes" con dos sesiones ese día pide la franja y no llama a la IA', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T12:00:00'))
    useChatStore.setState({ pendingIntent: {
      id: 'i3', kind: 'clarification', athleteId: 'ath_a', conversationId: 'session-1', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
      status: 'open', route: 'chat_action', operation: { type: 'move_session', known: { targetDate: '2026-09-18' }, missing: ['sessionId'] }, summary: 'Mover una sesión al viernes',
    } })
    const planned = (id: string, timeBlock: 'AM' | 'PM', title: string) => ({ id, date: '2026-09-14', weekStartDate: '2026-09-14', timeBlock, type: 'squash' as const, status: 'planned' as const, title, durationMin: 60, createdAt: 0, updatedAt: 0 })
    await useChatStore.getState().sendMessage('la del lunes', { recentSessions: [], historicalSessions: [], plannedSessions: [planned('a', 'AM', 'Squash'), planned('b', 'PM', 'Fuerza')] })
    expect(mocks.sendAction).not.toHaveBeenCalled()
    expect(mocks.chatMessages.at(-1)?.content).toContain('Squash (AM), Fuerza (PM)')
    expect(useChatStore.getState().pendingIntent?.status).toBe('open')
    vi.useRealTimers()
  })

  it('conversación en dos turnos: "la del lunes" guarda candidatos y "PM" crea la propuesta', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T12:00:00'))
    useChatStore.setState({ pendingIntent: {
      id: 'i4', kind: 'clarification', athleteId: 'ath_a', conversationId: 'session-1', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
      status: 'open', route: 'chat_action', operation: { type: 'move_session', known: { targetDate: '2026-09-18' }, missing: ['sessionId'] }, summary: 'Mover una sesión al viernes',
    } })
    mocks.addProposal.mockResolvedValue({ id: 'p2' })
    const planned = (id: string, timeBlock: 'AM' | 'PM', title: string) => ({ id, date: '2026-09-14', weekStartDate: '2026-09-14', timeBlock, type: 'squash' as const, status: 'planned' as const, title, durationMin: 60, createdAt: 0, updatedAt: 0 })
    const context = { recentSessions: [], historicalSessions: [], plannedSessions: [planned('a', 'AM', 'Squash'), planned('b', 'PM', 'Fuerza')] }
    await useChatStore.getState().sendMessage('la del lunes', context)
    expect(useChatStore.getState().pendingIntent?.operation).toMatchObject({ candidates: [{ id: 'a' }, { id: 'b' }] })
    await useChatStore.getState().sendMessage('PM', context)
    expect(mocks.sendAction).not.toHaveBeenCalled()
    expect(mocks.addProposal.mock.calls[0][1]).toEqual([{ type: 'move_session', sessionId: 'b', targetDate: '2026-09-18', reason: 'Confirmado por el atleta en el chat.' }])
    expect(useChatStore.getState().pendingIntent?.status).toBe('consumed')
    vi.useRealTimers()
  })

  it('si el atleta cambia mientras se crea la propuesta determinista, se deshace todo', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-13T12:00:00'))
    useChatStore.setState({ pendingIntent: {
      id: 'i5', kind: 'clarification', athleteId: 'ath_a', conversationId: 'session-1', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
      status: 'open', route: 'chat_action', operation: { type: 'move_session', known: { targetDate: '2026-09-18', sessionId: 's-mon' }, missing: [] }, summary: 'Mover',
    } })
    mocks.addProposal.mockImplementation(async () => { mocks.athleteId = 'ath_b'; mocks.epoch = 2; return { id: 'p3' } })
    const result = await useChatStore.getState().sendMessage('sí', undefined)
    expect(result.droppedForScopeChange).toBe(true)
    expect(mocks.chatMessages.filter(m => m.role === 'coach')).toHaveLength(0)
    // discardLateCoachArtifacts borra la propuesta recién creada.
    expect(useChatStore.getState().isLoading).toBe(false)
    vi.useRealTimers()
  })

  it('una respuesta local no se publica si el hilo cambió durante la escritura', async () => {
    useChatStore.setState({ pendingIntent: {
      id: 'i6', kind: 'generation_offer', athleteId: 'ath_a', conversationId: 'session-1', createdAt: Date.now(), expiresAt: Date.now() + 60_000,
      status: 'consumed', route: 'week_creator', operation: { type: 'create_week' }, summary: 'Semana',
    } })
    const originalAdd = (await import('../../db/db')).db.chatMessages.add as ReturnType<typeof vi.fn>
    originalAdd.mockImplementationOnce(async (m: ChatMessage) => { mocks.chatMessages.push(m); useChatStore.setState({ currentSessionId: 'session-2' }) })
    await useChatStore.getState().sendMessage('sí', undefined)
    expect(useChatStore.getState().messages.some(m => m.content.includes('ya quedó en marcha'))).toBe(false)
  })

  it('el cambio de atleta borra la intención', () => {
    useChatStore.setState({ pendingIntent: { id: 'i1', kind: 'generation_offer', athleteId: 'ath_a', conversationId: 'session-1', createdAt: 0, expiresAt: 1, status: 'open', route: 'week_creator', operation: { type: 'create_week' }, summary: 'x' } })
    useChatStore.getState().resetForAthleteSwitch()
    expect(useChatStore.getState().pendingIntent).toBeNull()
  })
})
```

Run: `npx vitest run src/store/__tests__/useChatStorePendingIntent.test.ts src/store/__tests__/useChatStore.test.ts` → PASS. Si `useChatStore.test.ts` fija una confirmación por regex (`routeKind` mockeado), no se ve afectado porque mockea `chatRouting`.

- [ ] **Step 7: Tipos, lint, checkpoint**

Run: `npx tsc -b --pretty false && npm run lint`
Mensaje sugerido: `feat(chat): intención pendiente tipada; las confirmaciones sólo confirman algo concreto (A4.4)`.

---

### Task 10: A6 — medición mínima honesta (parte de F15)

**Files:**
- Modify: `src/services/planBuilder/generateWeek.ts` (~líneas 308–356)
- Modify: `src/services/planBuilder/generateWeekCore.ts` (`GenerateWeekCoreInput.stageTracker?` y las tres fronteras reales: `callLLM` ~línea 384, `normalizeResponse` ~línea 395, `repairGeneratedWeek` ~línea 255)
- Modify: `src/services/ai/coachRecovery.ts` (`callWithTransientRetry`, `sendWithRecovery`)
- Modify: `src/services/ai/types.ts` (`CoachNormalizedResponse.transientAttempts?`, `AIProviderError.transientAttempts?`)
- Modify: `src/types/index.ts` (`ChatContextMetadata.route?`, `contextVersion: 1 | 2`)
- Modify: `src/store/useChatStore.ts` (`buildChatContextMetadata(context, route)`)
- Test: `src/services/__tests__/CoachEngine.test.ts` (agregar), `src/services/planBuilder/__tests__/generateWeekChunkCount.test.ts` (agregar aserción), `src/store/__tests__/useChatStoreRequestScope.test.ts` (agregar aserción)

- [ ] **Step 1: Test rojo de reintentos transitorios**

En `CoachEngine.test.ts`:

```ts
  it('marca retryUsed y cuenta intentos cuando hubo timeouts transitorios', async () => {
    let calls = 0
    const provider: AIProvider = {
      name: 'mock',
      call: async () => {
        calls += 1
        if (calls < 3) throw new AIProviderError('mock', 'timeout', 'timeout', true)
        return { text: 'ok <actions>[{"type":"skip_session","sessionId":"s1","reason":"x"}]</actions>', provider: 'mock', requestClass: 'chat_action' }
      },
    }
    const response = await sendWithRecovery(provider, { systemPrompt: '', userMessage: 'salta la sesión', requestClass: 'chat_action', traceId: 't' })
    expect(calls).toBe(3)
    expect(response.retryUsed).toBe(true)
    expect(response.transientAttempts).toBe(3)
  })
```

(importar `AIProviderError` desde `'../ai/types'`). Run → FAIL (`retryUsed` es `undefined`).

- [ ] **Step 2: Implementar**

`types.ts`: en `CoachNormalizedResponse`, junto a `retryUsed?`: `/** Llamadas al proveedor en esta solicitud lógica, contando la que respondió. */ transientAttempts?: number`. En `AIProviderError` agregar la propiedad pública opcional `transientAttempts?: number` (se asigna después de construir el error; el constructor no cambia).

`coachRecovery.ts`, `callWithTransientRetry`:

```ts
      const raw = await provider.call(request)
      const normalized = normalizeResponse(raw)
      return { ...normalized, retryUsed: normalized.retryUsed || attempt > 0, transientAttempts: attempt + 1 }
```

En `sendWithRecovery`, el retry de formato **cuenta aunque falle**: el objeto devuelto tras el retry gana `transientAttempts: (firstNormalized.transientAttempts ?? 1) + 1,` y `retryUsed: true`; y en la rama `shouldRejectAfterRetry`, antes de lanzar:

```ts
    const error = createProviderError(provider.name, 'parse_error', 'No pude crear la propuesta de forma segura. Intenta de nuevo.', true)
    error.transientAttempts = (firstNormalized.transientAttempts ?? 1) + 1
    throw error
```

`CoachEngine.sendTrackedCoachRequest` propaga `transientAttempts` a la telemetría en ambos caminos: en `updateRequest` del camino exitoso (`transientAttempts: finalResult.transientAttempts`) y en el `catch`, cuando el error es `AIProviderError`, llamando `useAIDebugStore.getState().updateRequest(traceId, { transientAttempts: error.transientAttempts })` antes de relanzar (agregar el campo opcional al tipo del patch del debug store).

Test adicional en `CoachEngine.test.ts`:

```ts
  it('cuenta el intento de formato aunque falle', async () => {
    let calls = 0
    const provider: AIProvider = {
      name: 'mock',
      call: async () => { calls += 1; return { text: 'sin acciones <actions>{no es json</actions>', provider: 'mock', requestClass: 'chat_action' } },
    }
    await expect(sendWithRecovery(provider, { systemPrompt: '', userMessage: 'salta la sesión', requestClass: 'chat_action', traceId: 't' }))
      .rejects.toMatchObject({ code: 'parse_error', transientAttempts: 2 })
    expect(calls).toBe(2)
  })
```

Run → PASS.

- [ ] **Step 3: Etapas en las fronteras reales del core**

Hoy `provider_call` envuelve todo `generateWeekCore` (prompt, llamada, normalización, validación y reparación), así que atribuye al proveedor tiempo que es CPU local. Se mueve la medición adentro:

1. `GenerateWeekCoreInput` gana `stageTracker?: StageTracker` (importar el tipo desde `'../ai/stageLogger'`).
2. En `generateWeekCore`, envolver las tres fronteras. Con `const tracker = input.stageTracker`:
   - la construcción del prompt (desde el inicio de la función hasta antes de `input.callLLM`) en `prompt_build`;
   - `const raw = await input.callLLM({...})` → `const raw = tracker ? await trackStage(tracker, 'provider_call', () => input.callLLM({...})) : await input.callLLM({...})`;
   - `const normalized = normalizeResponse(raw)` más `pickCreateWeekAction`/`validateGeneratedWeekAction` en `normalize` (abrir con `tracker?.stage('normalize')` y cerrar con `end({ ok: !!action })`);
   - `const repairResult = repairGeneratedWeek(action.sessions, context)` en `repair` (cerrar con `end({ ok: !repairResult.failure, error: repairResult.failure?.message })`).
   Si el core tiene un bucle de intentos, cada intento vuelve a abrir `provider_call` y `normalize`: los `stageTimings` conservan una entrada por intento, en orden.
3. En `generateWeek.ts`: borrar las etapas vacías `prompt_build`, `normalize` y `repair` y **dejar de envolver** `generateWeekCore` en `provider_call`; pasar `stageTracker: tracker` en el input del core. `stageTimings: tracker.timings()` queda como estaba.

En `generateWeekChunkCount.test.ts`, agregar al caso existente que ya obtiene un `result`:

```ts
    const stages = result.meta.stageTimings?.map((timing) => timing.stage) ?? []
    expect(stages.slice(0, 3)).toEqual(['prompt_build', 'provider_call', 'normalize'])
    expect(stages).toContain('repair')
    const providerCall = result.meta.stageTimings?.find((timing) => timing.stage === 'provider_call')
    const total = result.meta.stageTimings?.reduce((n, timing) => n + timing.durationMs, 0) ?? 0
    expect(providerCall!.durationMs).toBeLessThanOrEqual(total)
```

Run: `npx vitest run src/services/planBuilder/__tests__/generateWeekChunkCount.test.ts src/services/planBuilder/__tests__/generateWeek.structuredOutput.test.ts src/services/planBuilder/__tests__/generateWeekCore.test.ts` → PASS (ajustar cualquier aserción previa sobre etapas citando este paso). Si el proveedor simulado del test devuelve una semana que no llega a `repair` (falla en normalización), afirmar sólo sobre las tres primeras etapas.

- [ ] **Step 4: `ChatContextMetadata` registra la ruta**

`src/types/index.ts`:

```ts
export interface ChatContextMetadata {
  contextVersion: 1 | 2
  intent?: ChatContext['intent']
  /** Ruta resuelta por `resolveChatRoute` al enviar (v2). */
  route?: 'chat_general' | 'chat_action' | 'week_creator' | 'weekly_summary' | 'plan_builder_redirect'
  …resto igual
```

`useChatStore.ts`: `buildChatContextMetadata(context?: ChatContext, route?: ChatRouteKind)` devuelve `contextVersion: route ? 2 : 1, route, …`; la llamada en `sendMessage` pasa `route.kind`.

En `useChatStoreRequestScope.test.ts`, en el segundo caso: `expect(mocks.chatMessages.find(m => m.role === 'user')?.contextMeta).toMatchObject({ contextVersion: 2, route: 'chat_action' })`.

Run: `npx vitest run src/store/__tests__` → PASS.

- [ ] **Step 5: Tipos, lint, checkpoint**

Run: `npx tsc -b --pretty false && npm run lint`
Mensaje sugerido: `chore(telemetry): etapas reales, reintentos contados y ruta en contextMeta (A6)`.

---

### Task 11: A7 — guard de F04 y probes como regresión

Depende de todas las anteriores.

**Files:**
- Test: `src/services/training/__tests__/sessionDoseFinalizerZ2.test.ts` (nuevo)
- Test: `src/services/__tests__/coachingRefactorProbes.test.ts` (nuevo)

- [ ] **Step 1: Guard de F04**

```ts
// src/services/training/__tests__/sessionDoseFinalizerZ2.test.ts
import { describe, expect, it } from 'vitest'
import { materializeRunningTemplate } from '../runningTemplateMaterializer'
import { finalizeSessionDose } from '../sessionDoseFinalizer'

describe('F04 — convertir tempo a Z2 deja tarjeta y bloques coherentes', () => {
  it('objetivos de la tarjeta y ritmos de los bloques describen la misma sesión', () => {
    const profile = { id: 'review-athlete', updatedAt: 0, sportContext: { primarySport: 'squash' as const },
      runningProfile: { z2PaceMin: '6:00', z2PaceMax: '6:30', thresholdPace: '4:50' } }
    const tempo = materializeRunningTemplate({ template: 'tempo_continuo', durationMin: 45, profile: profile.runningProfile })
    if (!tempo.ok) throw new Error(tempo.message)
    const converted = finalizeSessionDose({
      date: '2026-09-07', timeBlock: 'AM', sessionType: 'running', title: 'Tempo', durationMin: 45,
      runningType: 'tempo', targetPaceMin: '4:50', targetPaceMax: '5:00',
      runningTemplateRef: tempo.templateRef, intervalStructure: tempo.structure,
    }, profile, { neighboringHardSession: true, phase: 'base', fatigueLevel: 4 })
    if (!converted.ok) throw new Error(converted.message)
    expect(converted.session.runningType).toBe('z2')
    expect(converted.session.targetPaceMin).toBe('6:00')
    expect(converted.session.targetPaceMax).toBe('6:30')
    const paces = converted.session.intervalStructure?.blocks.map(block => block.targetPace) ?? []
    expect(paces.length).toBeGreaterThan(0)
    for (const pace of paces) expect(['6:00 /km', '6:30 /km', undefined]).toContain(pace)
    expect(paces).not.toContain('4:50 /km')
    expect(paces).not.toContain('5:00 /km')
  })
})
```

Run → PASS (F04 ya está corregido; si falla, es una regresión real).

- [ ] **Step 2: Probes del 8 de septiembre como regresión**

```ts
// src/services/__tests__/coachingRefactorProbes.test.ts
/**
 * Casos del probe docs/reviews/fixtures/coaching-refactor-2026-09-08/probe.mjs,
 * con las expectativas CORREGIDAS por la Fase A. El script y sus salidas se
 * conservan como evidencia histórica; este archivo es el contrato vigente.
 *
 * F06 (recorte a seis sesiones) NO se fija acá: cambia en B4.
 */
import { describe, expect, it } from 'vitest'
import { hydrateSquashSession } from '../training/squashSessionHydrator'
import { materializeRunningTemplate } from '../training/runningTemplateMaterializer'
import { resolveChatRoute } from '../chatRouting'
import { detectChatIntent, inferRequestClassFromIntent } from '../ai/contextOptimizer'
import { CHAT_ROUTING_CORPUS } from '../chatRoutingCorpus'

describe('probes 2026-09-08 → Fase A', () => {
  it.each(['technical', 'control'] as const)('F03: %s a 15 min conserva el bloque principal', (kind) => {
    const result = hydrateSquashSession({ kind, durationMin: 15, phase: 'base', fatigueLevel: 3, goal: '', recentDrills: [],
      competitionSoon: false, withShadowsAccessory: true, partnerAvailability: 'either' })
    expect(result.details.blocks?.map(block => block.kind)).toContain(kind)
  })

  it('F05: progress y hold son intenciones distintas y ambas siguen siendo correctas', () => {
    const count = (intent?: 'progress' | 'hold') => {
      const result = materializeRunningTemplate({ template: 'repeats_400', durationMin: 60, profile: { fiveKTime: '25:00' }, intent })
      if (!result.ok) throw new Error(result.message)
      return result.structure.blocks.filter(block => block.distanceKm === 0.4).reduce((n, block) => n + (block.repetitions ?? 1), 0)
    }
    expect(count('progress')).toBe(11)
    expect(count('hold')).toBe(9)
    expect(count(undefined)).toBe(9)
    // La conservación al editar el título está en SessionFormRunningTemplates.test.tsx.
  })

  it('F07: las cinco frases del probe coinciden en UI y engine con el corpus', () => {
    const probeIds = ['hist-1', 'hist-2', 'create-1', 'advice-1', 'plan-1']
    for (const id of probeIds) {
      const testCase = CHAT_ROUTING_CORPUS.find(candidate => candidate.id === id)!
      expect(resolveChatRoute(testCase.message).kind, id).toBe(testCase.expected)
      const uiClass = inferRequestClassFromIntent(detectChatIntent(testCase.message))
      const expectedUi = testCase.expected === 'chat_action' ? 'chat_action' : testCase.expected === 'week_creator' ? 'week_creator' : 'chat_general'
      expect(uiClass, id).toBe(expectedUi)
    }
  })
})
```

Run: `npx vitest run src/services/__tests__/coachingRefactorProbes.test.ts src/services/training/__tests__/sessionDoseFinalizerZ2.test.ts` → PASS.

- [ ] **Step 3: Volver a correr el probe original y anotar la evidencia**

Run: `node docs/reviews/fixtures/coaching-refactor-2026-09-08/probe.mjs > /private/tmp/claude-501/-Users-rafaallendes-Projects-entrenador-app/fb0940d3-63b6-4ffd-ac0e-f880eb9df001/scratchpad/probe-after-phase-a.json`
Expected en la salida: `squashCases[*].blocks` contiene `technical`/`control`; `routeCases[*].uiClass` coincide con la clase esperada del corpus; `repetitionCases` sigue `11` y `9` (correcto por diseño); `runningConversion` sigue `6:00–6:30`. Copiar el archivo a `docs/reviews/fixtures/coaching-refactor-2026-09-08/probe-after-phase-a.json` y agregar una línea en la sección 2 del spec indicando la fecha de cierre de A y la ruta del archivo.

- [ ] **Step 4: Cierre de la fase**

Run: `npm run lint && npm test && npm run build && git diff --check`
Expected: suite completa verde, build OK, sin espacios colgantes.

Registrar en `PROJECT_REVIEW_AND_ROADMAP.md`, sección "Motor de entrenamiento", una entrada breve: Fase A cerrada localmente con fecha, pendiente deploy y smoke del formulario de running y del chat con oferta estructurada. Checkpoint final para el owner con la lista completa de archivos.

---

## Self-review del plan contra el spec

**Cobertura de §4 del spec:** A1 → Tarea 1; A2 → Tarea 2; A3 (tabla de operaciones, procedencia, sesión ejecutada bloqueada ante duración/plantilla, diff obligatorio con cambios concretos de dosis, receta aprobada persistida tal cual, validación de ritmos manuales, fallback `hold`) → Tareas 3 y 4; A4 (corpus, router único, eventos estructurados fuera de `actions` y aceptados por el engine, intención pendiente con resolución de referente, consumo sólo ante respuesta compatible, entrega de la operación al ejecutor, gate de UI con los mismos insumos, propuestas nunca aplicadas por texto) → Tareas 6, 7, 8, 9; A5 (captura antes del primer `await`, corte antes de persistir el mensaje del usuario, borrador conservado en la página, `null→self` estricto, Week Creator con destino capturado, nota semanal) → Tarea 5; A6 (etapas en fronteras reales del core, intento de formato contado aunque falle, ruta en `contextMeta`) → Tarea 10; A7 → Tarea 11.

**Fuera de este plan y registrado en §10 del spec:** `resolveMessageTargets` por título o deporte (B4); el umbral de objetivos por lote (B4); instrumentación de etapas del Week Creator más allá de las existentes.

**Garantías declaradas y su test:** A1 → hidratador con dolor 8 hasta la propuesta aplicable; A2 → `squashMainBlockSurvives` (reparación y serializador); A3 → `SessionFormRunningPersistence` (Dexie real con `fake-indexeddb`) más diff-antes-de-guardar y receta aprobada; A4 → corpus en tres capas, `coachEngineConversationEvents` por `sendAction`, y `useChatStorePendingIntent` con propuesta determinista sin IA; A5 → página que no envía y restaura el borrador, store que no persiste con scope caduco, Week Creator con `targetAthleteId` capturado, nota semanal; A6 → `transientAttempts` en éxito y fallo, `stageTimings` en las fronteras del core.

**Tests sobre-declarados corregidos en esta revisión:** "fila persistida" ahora escribe y relee Dexie; la aprobación del recalculado se verifica comparando la firma de la estructura aprobada con la persistida; el test de `sendAction` atraviesa el engine real con el proveedor mockeado en el resolver.

**Consistencia de nombres:** `buildWeekCreatorExecutionSignals` (T1), `RunningMaterialization`/`materialization`/`RUNNING_MATERIALIZER_VERSION` (T3→T4), `origin`/`sessionStatus` (T4), `captureRequestScope`/`isRequestScopeCurrent`/`RequestScope` (T5→T9), `mapChatRouteToRequestClass` movida a `chatRouting.ts` (T6→T7), `intentFromRoute` (T7→T11), `CoachConversationEvent`/`conversationEvents` (T8→T9), `PendingIntent`/`pendingIntentFromEvents`/`resolvePendingIntentDecision`/`consumedIntentId`/`pendingDecision` (T9), `transientAttempts` (T10).

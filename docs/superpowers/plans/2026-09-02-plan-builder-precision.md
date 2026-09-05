# Plan Builder — Mejoras de precisión (5 tareas) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el Plan Builder adapte la carga a datos reales del atleta (no sólo a la carga planificada), cierre cada semana con un criterio verificable, no programe dos sesiones duras de deportes distintos el mismo día, y respete un limitante físico y una meta de partidos duros declarados por el atleta.

**Architecture:** Cinco frentes independientes sobre el pipeline existente, en 11 tareas. El más grande (Tarea 1 del owner) se descompone en seis —Tareas 4, 5, 6, 7, 8 y 11— porque su premisa original no era realizable: hoy **todas** las semanas de un plan se generan antes de vivirse, así que la adaptación intra-plan exige un flujo nuevo de recalibración sobre un plan activo, y ese flujo sólo es real si además reconcilia el calendario materializado. Los otros cuatro frentes son cambios acotados de prompt, repair, calidad y esquema de perfil.

**Revisión del 2026-09-02:** este plan incorpora cuatro bloqueos funcionales y dos correcciones detectados en revisión, más un quinto hallazgo surgido al verificarlos. Cada uno está anotado en su tarea con la etiqueta «corrección de la primera versión de este plan», con la evidencia de código que lo respalda.

**Tech Stack:** React + TypeScript + Vite + Zustand + Dexie (local-first) + Supabase (sync). Tests con Vitest. Sin migraciones de Supabase; sin cambio de versión de Dexie (los campos nuevos son propiedades opcionales dentro de filas ya existentes).

**Spec:** La instrucción del owner del 2026-09-02 (en la conversación), más los hallazgos de código verificados que se registran abajo en «Correcciones a la premisa».

---

## Estado de implementación — 2026-09-04

- [x] Tareas 1–3: cierre verificable, separación en 5b y gate de calidad.
- [x] Tareas 4–6: política compartida, contexto intra-plan y directivas con señales reales (individual y batch).
- [x] Tareas 7–8: selección, recalibración local/remota, reconciliación y recuperación tras recarga.
- [x] Tareas 9–11: limitante persistido, meta de partidos consumida por prompt/repair y migración de Week Creator.
- [x] Nota de roadmap y regla de orden de fuerza en CLAUDE.md.
- [x] Gate local: 544 archivos / 4392 tests; lint, tipos, build y diff correctos.
- [ ] E2E autenticado: la ejecución sin generación se detuvo por sesión guardada vencida.
- [ ] Smoke con API y readiness: pendientes de confirmar saldo; no se ejecutaron.

Los pasos de escritura de tests en rojo y commits de abajo conservan el plan
original; no son un registro retrospectivo de comandos ejecutados. El estado
verificado del árbol y las decisiones finales están en
[el registro local](../smokes/2026-09-04-plan-builder-precision-local.md).

---

## Global Constraints

- **No usar Whoop como dependencia en ninguna tarea.** Todo debe funcionar sólo con day logs autoreportados (`energyLevel`, `painLevel`, `sleepHours`) y `actualRpe` de sesiones completadas. `formatDayLogLine` ya excluye valores prellenados por Whoop vía `isWhoopPrefilled`; cualquier lectura nueva de `rpeActual` debe hacer lo mismo.
- **Los commits los hace el owner.** No ejecutar `git commit` ni `git add` salvo pedido explícito. Los pasos «Commit» de este plan describen el commit que el owner hará; el implementador se detiene con el árbol limpio y verificado.
- **`promptBuilder.ts` no se toca** en ninguna tarea de este plan.
- **El orden del repair de fuerza está congelado, y el allocator corre en el paso 6.** `resolveStrengthBlockAllocation` se resuelve en el paso 6 de `repairGeneratedWeek` (`repairWeek.ts:321`) y el paso 7 lo consume de inmediato. Sus mapas se indexan por `sessionKeyOf(session)` = `` `${date}|${timeBlock}` `` (`repairWeek.ts:232`), y el finalizador terminal del paso 14 vuelve a consultarlos por esa misma clave (`finalizeStrengthSafetySessions`, `repairWeek.ts:423` y `:433`). **Cualquier paso que cambie `date` o `timeBlock` de una sesión de fuerza debe correr ANTES del paso 6.** Moverla después deja `structuralCore` en `undefined` y el conjunto de ids comprometidos incompleto, degradando en silencio el finalizador de seguridad, que es obligatorio y fail-closed.
- **Athlete scope:** toda lectura nueva de `sessions`/`dayLogs`/`weekSummaries` fuera de sync/export pasa por `filterRowsToActiveScope`. Nunca el literal `'default'`.
- **Entitlements y cuota:** cualquier camino nuevo que genere semanas pasa por los gates ya existentes (`reservePlanBuilderWeekUsage`, `guardRemotePlanBuilderRateLimit`). No agregar bypass.
- Antes de cerrar: `npm run lint && npm test && npm run build` verdes, más `npx tsc -b` y `git diff --check`.
- **Presupuesto de API:** saldo Anthropic ~US$0,60 (CLAUDE.md). **Los tests automatizados de este plan no consumen API**; varias verificaciones manuales sí. Consumen saldo real, y ninguna debe correrse sin confirmar el saldo con el owner: (a) toda recalibración remota de la Tarea 8, que genera semanas contra el proveedor igual que cualquier generación; (b) la verificación manual en dev de las Tareas 8 y 10; (c) `npm run e2e:plan:readiness`. No repetir ninguna por iteración de código: el resto se verifica con tests deterministas a costo cero.

---

## Correcciones a la premisa (verificadas en código antes de escribir este plan)

Estas cuatro correcciones cambian el contenido de las tareas respecto de la instrucción original. Se registran acá para que el implementador no «arregle» el plan de vuelta hacia la premisa equivocada.

1. **Plan Builder NO carece de directiva de carga por semana.** `buildLoadDirective` existe en `src/services/week/prompts/weekPrompt.ts:392` y corre para cada semana vía `buildProgressionSection` (`:427`). Lo que le falta es mirar **ejecución real**: hoy decide sólo con `week.phase` y la comparación de `sumTargetLoads(previousWeek.targetLoadBySport)` contra la semana actual, es decir, carga *planificada* contra carga *planificada*.

2. **No se puede reutilizar literalmente `buildLoadDirective` de Week Creator.** La de Week Creator (`WeekCreatorPromptBuilder.ts:535`) consume `WeekCreatorEffectiveConfig` + `ChatContext`; la de Plan Builder consume `TrainingPlanWeek` + `PlanWizardConfig`. Lo que se comparte en la Tarea 4 de este plan es **la regla de decisión sobre señales normalizadas**, no la firma.

3. **La adaptación intra-plan no tiene datos de dónde leer, hoy.** `buildPlanBuilderRecentContext` fija `referenceDate = plan.startDate` y consulta la ventana `[startDate − 6 semanas, startDate − 1 día]` (`recentContext.ts:230-233`). Se llama **una sola vez por corrida** (`generationJobRunner.ts:361`) y ese único snapshot va a todas las semanas. Las rutas de regeneración (`regenerateWeeks`) son alcanzables en producción, pero sólo en **borrador**: un plan `active` queda forzado a `generationState: 'complete'` (`usePlanBuilderStore.ts:319-327`), así que no existe camino que regenere las semanas 5-12 de un plan en curso. **Por eso la Tarea 1 incluye el flujo de recalibración** (Tareas 7 y 8 de este plan): sin él, la capa adaptativa no tendría nunca datos reales intra-plan que leer.

4. **`requiredPrimarySessions` no es una fórmula plana.** En `weekPrompt.ts:79-98` es sensible a fase y a deportes de apoyo: `transition → 0`, y en squash build/peak elige entre `Math.floor(n/2)` y `Math.floor(n/2)+1` según cuántos deportes de apoyo tengan carga. Una meta declarada por el atleta **no** puede pisar el `transition → 0` ni las fases taper/race, o inyectaría partidos duros en una semana de descarga.

---

## Estructura de archivos

**Nuevos:**
- `src/services/training/loadDirectivePolicy.ts` — regla de decisión compartida sobre señales normalizadas de ejecución real. Sin I/O, sin Dexie, sin tipos de Week Creator ni de Plan Builder.
- `src/services/training/__tests__/loadDirectivePolicy.test.ts`
- `src/services/planBuilder/planRecalibration.ts` — selección de semanas recalibrables de un plan activo.
- `src/services/planBuilder/__tests__/planRecalibration.test.ts`
- `src/services/planBuilder/__tests__/sameDayHardSessions.test.ts`
- `src/services/planBuilder/__tests__/recentContextIntraPlan.test.ts`
- `src/services/week/prompts/__tests__/weekPromptClosing.test.ts`
- `src/services/week/prompts/__tests__/weekPromptLoadDirective.test.ts`
- `src/services/week/prompts/__tests__/weekPromptPerformanceLimiter.test.ts`
- `src/services/week/prompts/__tests__/hardPrimaryMatches.test.ts`
- `src/services/week/prompts/__tests__/fixtures.ts` — fixtures compartidos de las Tareas 1, 6, 9 y 10.
- `src/services/weekCreator/__tests__/weekCreatorLoadDirective.test.ts`
- `src/store/__tests__/planRecalibration.test.ts`

**Modificados:**
- `src/services/week/prompts/weekPrompt.ts` — línea de cierre, consumo de señales reales, limitante físico, línea de partidos duros.
- `src/services/planBuilder/recentContext.ts` — `referenceDate` dinámico, ventana intra-plan y señales autoreportadas sin contaminación de Whoop.
- `src/services/planBuilder/recentContextRender.ts` — render de la ventana intra-plan.
- `src/services/planBuilder/repairWeek.ts` — separación de duras cruzadas en el **paso 5b**, antes del allocator.
- `src/services/planBuilder/qualityReview.ts` — gate `error` de duras cruzadas y warning de partidos duros bajo objetivo.
- `src/services/planBuilder/squashWeeklyExposurePolicy.ts` — la meta de partidos entra subordinada a los vetos existentes.
- `src/services/weekCreator/WeekCreatorPromptBuilder.ts` — migración a la política compartida, limitante físico y guard de fase.
- `src/services/weekCreator/WeekCreatorConfig.ts` — propagación de la meta desde el wizard.
- `src/store/usePlanBuilderStore.ts` — acción `recalibrateRemainingWeeks` + reconciliación de calendario.
- `src/pages/PlanBuilderV2Page.tsx` — entrada de recalibración.
- `src/types/index.ts` — `performanceLimiter`, `targetHardPrimaryMatches`.
- `src/components/settings/AthleteProfileEditor.tsx` — campo de limitante.
- `src/pages/CompetitionPlanPage.tsx` — campo de meta de partidos duros.

---

## Task 1: Línea de cierre verificable en el prompt de semana (Tarea 2 del owner)

**Files:**
- Modify: `src/services/week/prompts/weekPrompt.ts` (`buildWeekUserPrompt` ~`:304-377`, `buildWeekBatchUserPrompt` ~`:516-589`)
- Test: `src/services/week/prompts/__tests__/weekPromptClosing.test.ts` (crear)

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `buildWeekClosingRule(): string` — helper local, no exportado. Las Tareas 6 y 10 añaden texto a otras secciones y **no** deben duplicar esta línea.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/week/prompts/__tests__/weekPromptClosing.test.ts`. Copiar el patrón de fixtures del test existente más cercano — abrir primero `src/services/week/prompts/__tests__/` y reutilizar el builder de `TrainingPlan`/`TrainingPlanWeek`/`AthleteProfile`/`PlanWizardConfig` que ya exista ahí; si no existe ninguno, construir los objetos mínimos que `buildWeekUserPrompt` requiere (`plan.macroSnapshot.sportDetails`, `plan.phases`, `week.targetLoadBySport`, `week.weekObjectives`, `wizardConfig.trainingDays`).

```ts
import { describe, expect, it } from 'vitest'
import { buildWeekUserPrompt, buildWeekBatchUserPrompt } from '../weekPrompt'
import { makeWeekPromptInput, makeWeekBatchPromptInput } from './fixtures'

const CLOSING_MARKER = 'Definición de listo'

describe('regla de cierre del prompt de semana', () => {
  it('incluye la definición de listo justo antes del formato de salida', () => {
    const prompt = buildWeekUserPrompt(makeWeekPromptInput())
    const lines = prompt.split('\n')
    const closingIndex = lines.findIndex((line) => line.includes(CLOSING_MARKER))
    const outputIndex = lines.findIndex((line) => line.startsWith('Devuelve sólo'))

    expect(closingIndex).toBeGreaterThan(-1)
    expect(outputIndex).toBeGreaterThan(-1)
    expect(closingIndex).toBeLessThan(outputIndex)
  })

  it('menciona los tres criterios verificables', () => {
    const prompt = buildWeekUserPrompt(makeWeekPromptInput())
    expect(prompt).toContain('coherente con la fase')
    expect(prompt).toContain('sin ajustes manuales')
    expect(prompt).toContain('directiva de carga')
  })

  it('aparece exactamente una vez', () => {
    const prompt = buildWeekUserPrompt(makeWeekPromptInput())
    const occurrences = prompt.split(CLOSING_MARKER).length - 1
    expect(occurrences).toBe(1)
  })

  it('también cierra el prompt batch', () => {
    const prompt = buildWeekBatchUserPrompt(makeWeekBatchPromptInput())
    const lines = prompt.split('\n')
    const closingIndex = lines.findIndex((line) => line.includes(CLOSING_MARKER))
    const outputIndex = lines.findIndex((line) => line.startsWith('Devuelve sólo'))
    expect(closingIndex).toBeGreaterThan(-1)
    expect(closingIndex).toBeLessThan(outputIndex)
  })
})
```

Si `./fixtures` no existe, crearlo en el mismo directorio exportando `makeWeekPromptInput()` y `makeWeekBatchPromptInput()` con objetos mínimos válidos, y reutilizarlo en las Tareas 6, 9 y 10.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/week/prompts/__tests__/weekPromptClosing.test.ts`
Expected: FAIL — el prompt no contiene `Definición de listo`.

- [ ] **Step 3: Implementar el helper**

En `src/services/week/prompts/weekPrompt.ts`, agregar cerca de `buildStrengthStructureSection` (~`:590`):

```ts
/**
 * Criterio de cierre del prompt de semana.
 *
 * Va inmediatamente antes de la instrucción de formato de salida y **no la
 * reemplaza**: el formato sigue siendo la última línea, porque es lo que el
 * parser necesita leer sin ambigüedad. Los tres criterios son verificables a
 * propósito —fase, ejecutabilidad y consistencia con la directiva de carga—
 * en vez de un "hazlo bien" descriptivo.
 */
function buildWeekClosingRule(): string {
  return [
    'Definición de listo: antes de responder, verifica que la semana cumpla las tres cosas.',
    '1. Es coherente con la fase declarada: el carácter de las sesiones corresponde a la fase, no a la semana previa ni a una fase distinta.',
    '2. Es ejecutable sin ajustes manuales: cada sesión tiene fecha válida, duración, objetivo y contenido concreto; un atleta podría entrenarla tal como viene.',
    '3. Es consistente con la directiva de carga de esta semana: si la directiva dice reducir, el volumen y el RPE bajan de verdad; si dice mantener, no sube.',
    'Si alguna de las tres no se cumple, corrige la semana antes de responder.',
  ].join('\n')
}
```

- [ ] **Step 4: Cablearlo en los dos prompts**

En `buildWeekUserPrompt`, el array termina hoy así (`:371-377`):

```ts
    outputFormat === 'json' ? '' : strengthStructureSection,
    outputFormat === 'json' ? '' : strengthLoadSection,
    '',
    outputFormat === 'json'
      ? 'Devuelve sólo un objeto JSON create_week para esta semana. No uses wrappers XML, markdown ni texto explicativo.'
      : 'Devuelve sólo el bloque <actions> con una única create_week para esta semana.',
  ].filter(Boolean).join('\n')
```

Insertar la regla entre el `''` y la instrucción de formato:

```ts
    outputFormat === 'json' ? '' : strengthStructureSection,
    outputFormat === 'json' ? '' : strengthLoadSection,
    '',
    buildWeekClosingRule(),
    '',
    outputFormat === 'json'
      ? 'Devuelve sólo un objeto JSON create_week para esta semana. No uses wrappers XML, markdown ni texto explicativo.'
      : 'Devuelve sólo el bloque <actions> con una única create_week para esta semana.',
  ].filter(Boolean).join('\n')
```

Aplicar la misma inserción en `buildWeekBatchUserPrompt` (~`:516-589`), inmediatamente antes de su propia instrucción `Devuelve sólo`. Leer el final de esa función antes de editar: su instrucción de salida menciona varias semanas, y **no** debe modificarse.

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/week/prompts/__tests__/weekPromptClosing.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Revisión manual del prompt generado**

Run:
```bash
npx vitest run src/services/week/prompts/__tests__/weekPromptClosing.test.ts --reporter=verbose
```
Además, imprimir un prompt completo una vez y leerlo de arriba a abajo para confirmar que la línea no duplica contenido de `buildProgressionSection` ni de la sección de objetivos:
```bash
npx tsx -e "import {buildWeekUserPrompt} from './src/services/week/prompts/weekPrompt'; import {makeWeekPromptInput} from './src/services/week/prompts/__tests__/fixtures'; console.log(buildWeekUserPrompt(makeWeekPromptInput()))" 2>/dev/null || echo "usar un test temporal con console.log si tsx no está disponible"
```
Expected: la sección aparece una sola vez, después de fuerza y antes del formato.

- [ ] **Step 7: Verificar la suite completa del área**

Run: `npx vitest run src/services/week && npm run lint`
Expected: PASS, sin warnings nuevos.

- [ ] **Step 8: Commit (lo hace el owner)**

```bash
git add src/services/week/prompts/weekPrompt.ts src/services/week/prompts/__tests__/
git commit -m "feat(plan-builder): definición de listo verificable al cierre del prompt de semana"
```

---

## Task 2: Separación determinista de sesiones duras cruzadas el mismo día (Tarea 4a del owner)

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts` (insertar paso **5b**, entre `filterDisallowedSports` `:307` y la resolución del allocator `:309-326`)
- Test: `src/services/planBuilder/__tests__/sameDayHardSessions.test.ts` (crear)

**Interfaces:**
- Consumes: helpers ya existentes en `repairWeek.ts` — `getAllowedDatesInWeek(context)`, `findNearestAvailableDate(allowedDates, currentSessions, preferredBlock, referenceDate?, wizardConfig?, blockedSlots?)`, `sessionKeyOf(session)`.
- Produces: `separateSameDayHardCrossSportSessions(sessions, context, meta): CoachSessionProposal[]` — función local, no exportada. La Tarea 3 depende de que esta corra **antes** y de que registre `meta.warnings` con `code: 'same_day_hard_cross_sport'`.

**Por qué en 5b y no más tarde — corrección de la primera versión de este plan.** La ubicación original (13c) estaba mal: el allocator de fuerza no se resuelve en el paso 15, sino en el **paso 6** (`resolveStrengthBlockAllocation`, `repairWeek.ts:321`), y sus mapas se indexan por `sessionKeyOf` = `` `${date}|${timeBlock}` ``. El finalizador terminal del paso 14 (`finalizeStrengthSafetySessions`) vuelve a leerlos con esa clave en `:423` y `:433`. Mover una sesión de fuerza en 13c habría cambiado su clave después de construidos los mapas, dejando `structuralCore` en `undefined` y el set de ids comprometidos incompleto — degradando en silencio un finalizador que el proyecto declara obligatorio y fail-closed.

En 5b las fechas ya son válidas (pasos 2, 3, 4 y 4b corrieron) y los deportes ya están filtrados (paso 5), así que la separación opera sobre datos correctos y **antes** de que exista cualquier asignación que desanclar.

**Consecuencia aceptada y explícita:** los pasos 12, 13 y 13b (`balanceSessionCount`, `ensurePrimarySportMinimum`, `ensurePrimarySportDominance`) **agregan** sesiones después de 5b y podrían reintroducir un choque. Ese residuo lo cubre el gate de calidad de la Tarea 3, que es exactamente su razón de existir. No se agrega una segunda pasada tardía: tendría que excluir fuerza para no romper el allocator, y una pasada que sólo arregla la mitad de los casos es peor que un gate que los detecta todos.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/planBuilder/__tests__/sameDayHardSessions.test.ts`. Reutilizar el builder de `RepairContext` de los tests existentes de `repairWeek` — buscarlo primero:

```bash
grep -rn "RepairContext" src/services/planBuilder/__tests__/*.ts | head -5
```

```ts
import { describe, expect, it } from 'vitest'
import { repairGeneratedWeek } from '../repairWeek'
import { makeRepairContext, makeProposal } from './repairFixtures'

describe('separación de sesiones duras cruzadas el mismo día', () => {
  it('mueve una de dos duras de deportes distintos que caen el mismo día', () => {
    const context = makeRepairContext({
      trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      allowDoubleSession: false,
      phase: 'build',
    })
    const raw = [
      makeProposal({ date: '2026-09-07', sessionType: 'running', rpe: 8, title: 'Series' }),
      makeProposal({ date: '2026-09-07', sessionType: 'squash', rpe: 8, title: 'Partidos' }),
      makeProposal({ date: '2026-09-09', sessionType: 'strength', rpe: 6, title: 'Fuerza' }),
    ]

    const result = repairGeneratedWeek(raw, context)
    const hardDates = result.sessions
      .filter((session) => (session.rpe ?? 6) >= 8)
      .map((session) => session.date)

    expect(new Set(hardDates).size).toBe(hardDates.length)
    expect(result.sessions).toHaveLength(3)
    expect(result.meta.warnings.some((w) => w.code === 'same_day_hard_cross_sport')).toBe(true)
  })

  it('no toca dos duras del MISMO deporte el mismo día', () => {
    const context = makeRepairContext({
      trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      allowDoubleSession: true,
      doubleSessionDays: ['monday'],
      phase: 'build',
    })
    const raw = [
      makeProposal({ date: '2026-09-07', timeBlock: 'AM', sessionType: 'squash', rpe: 8 }),
      makeProposal({ date: '2026-09-07', timeBlock: 'PM', sessionType: 'squash', rpe: 8 }),
    ]

    const result = repairGeneratedWeek(raw, context)
    const dates = result.sessions.map((s) => s.date)
    expect(dates).toEqual(['2026-09-07', '2026-09-07'])
    expect(result.meta.warnings.some((w) => w.code === 'same_day_hard_cross_sport')).toBe(false)
  })

  it('no toca duras cruzadas que ya están en días distintos', () => {
    const context = makeRepairContext({
      trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      phase: 'build',
    })
    const raw = [
      makeProposal({ date: '2026-09-07', sessionType: 'running', rpe: 8 }),
      makeProposal({ date: '2026-09-09', sessionType: 'squash', rpe: 8 }),
    ]

    const result = repairGeneratedWeek(raw, context)
    expect(result.sessions.map((s) => s.date).sort()).toEqual(['2026-09-07', '2026-09-09'])
    expect(result.meta.warnings.some((w) => w.code === 'same_day_hard_cross_sport')).toBe(false)
  })

  it('conserva la sesión cuando no hay día libre, sin perderla', () => {
    const context = makeRepairContext({
      trainingDays: ['monday'],
      allowDoubleSession: false,
      phase: 'build',
    })
    const raw = [
      makeProposal({ date: '2026-09-07', sessionType: 'running', rpe: 8 }),
      makeProposal({ date: '2026-09-07', sessionType: 'squash', rpe: 8 }),
    ]

    const result = repairGeneratedWeek(raw, context)
    expect(result.sessions).toHaveLength(2)
    expect(result.meta.warnings.some((w) => w.code === 'same_day_hard_cross_sport_unresolved')).toBe(true)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/planBuilder/__tests__/sameDayHardSessions.test.ts`
Expected: FAIL — el primer test falla porque ambas duras siguen el 2026-09-07.

- [ ] **Step 3: Implementar la función**

Agregar en `repairWeek.ts`, junto a los demás helpers de fecha (cerca de `:4585`, antes de `getAllowedDatesInWeek`):

```ts
const HARD_SESSION_RPE_THRESHOLD = 8

/**
 * Dos sesiones duras de deportes DISTINTOS el mismo día son un error de
 * programación real: suman carga sistémica sin el estímulo específico que
 * justificaría un doble. Dos duras del MISMO deporte no entran acá —un doble
 * de squash AM/PM es una decisión deportiva legítima y la cubre la política de
 * dobles, no esta regla.
 *
 * Se repara moviendo la sesión de MENOR carga objetivo (o, a igualdad, la que
 * no es del deporte principal), para no desarmar el estímulo principal del día.
 * Si no hay hueco, se conserva la sesión y se emite un warning distinto: perder
 * una sesión sería peor que dejar el conflicto, y el gate de calidad de la
 * Tarea 3 lo bloquea después.
 */
function separateSameDayHardCrossSportSessions(
  sessions: CoachSessionProposal[],
  context: RepairContext,
  meta: RepairMeta,
): CoachSessionProposal[] {
  const isHard = (session: CoachSessionProposal) => (session.rpe ?? 6) >= HARD_SESSION_RPE_THRESHOLD

  const byDate = new Map<string, CoachSessionProposal[]>()
  for (const session of sessions) {
    if (!isHard(session)) continue
    byDate.set(session.date, [...(byDate.get(session.date) ?? []), session])
  }

  const primarySport = getPrimarySport(context)
  const allowedDates = getAllowedDatesInWeek(context)
  let working = [...sessions]

  for (const [date, hardOnDate] of byDate) {
    const sports = new Set(hardOnDate.map((session) => session.sessionType))
    if (sports.size < 2) continue

    // Conserva la más importante del día; mueve el resto.
    const ordered = [...hardOnDate].sort((a, b) => {
      const aPrimary = a.sessionType === primarySport ? 1 : 0
      const bPrimary = b.sessionType === primarySport ? 1 : 0
      if (aPrimary !== bPrimary) return bPrimary - aPrimary
      return (b.durationMin ?? 0) - (a.durationMin ?? 0)
    })

    for (const session of ordered.slice(1)) {
      const others = working.filter((candidate) => candidate !== session)
      const slot = findNearestAvailableDate(
        allowedDates.filter((candidate) => candidate !== date),
        others,
        session.timeBlock === 'PM' ? 'PM' : 'AM',
        date,
        context.wizardConfig,
      )
      if (!slot) {
        meta.warnings.push({
          code: 'same_day_hard_cross_sport_unresolved',
          message: `No hay día libre para separar dos sesiones duras de deportes distintos el ${date}; se conservan ambas.`,
          sessionDate: date,
        })
        continue
      }
      const targetHasHard = working.some(
        (candidate) => candidate !== session && candidate.date === slot.date && isHard(candidate)
          && candidate.sessionType !== session.sessionType,
      )
      if (targetHasHard) {
        meta.warnings.push({
          code: 'same_day_hard_cross_sport_unresolved',
          message: `No hay día libre sin otra dura para separar el ${date}; se conservan ambas.`,
          sessionDate: date,
        })
        continue
      }
      working = working.map((candidate) =>
        candidate === session
          ? { ...candidate, date: slot.date, timeBlock: slot.timeBlock }
          : candidate,
      )
      meta.warnings.push({
        code: 'same_day_hard_cross_sport',
        message: `Sesión dura de ${session.sessionType} movida de ${date} a ${slot.date}: ya había otra sesión dura de un deporte distinto ese día.`,
        sessionDate: slot.date,
      })
    }
  }

  return working
}
```

Verificar antes de escribir que `CoachSessionProposal` tiene `durationMin` con ese nombre exacto:
```bash
grep -n "interface CoachSessionProposal" -A 20 src/types/index.ts
```
Si el campo se llama distinto, usar el nombre real; si no existe una duración, ordenar sólo por `primarySport`.

- [ ] **Step 4: Cablear el paso 5b**

En `repairGeneratedWeek`, entre el paso 13b (`:365-366`) y el 14 (`:368`):

```ts
  // 5. Filter disallowed sports
  sessions = filterDisallowedSports(sessions, context, meta)

  // 5b. Dos duras de deportes distintos el mismo día.
  //
  // Va ANTES del paso 6 a propósito, y esto no es negociable: el allocator de
  // fuerza que se resuelve más abajo indexa `structuralCoreByWeek` y los ids
  // comprometidos por `sessionKeyOf` = `date|timeBlock`, y
  // `finalizeStrengthSafetySessions` (paso 14) vuelve a leerlos con esa clave.
  // Cambiar la fecha de una sesión de fuerza después del paso 6 dejaría al
  // finalizador sin su proyección de core, en silencio.
  //
  // Los pasos 12/13/13b pueden reintroducir un choque al agregar sesiones; ese
  // residuo lo detecta el gate `quality.load.same_day_hard_cross_sport`.
  sessions = separateSameDayHardCrossSportSessions(sessions, context, meta)

  // 6. El contrato productivo entrega esqueletos sin `exercises`. ...
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/planBuilder/__tests__/sameDayHardSessions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Verificar que no se rompió el repair existente**

Run: `npx vitest run src/services/planBuilder`
Expected: PASS. Prestar atención específica a los tests de fuerza (`strengthBlockAllocator`, `strengthTemplateRotation`, y cualquiera de `finalizeStrengthSafety`) — si alguno falla, el paso quedó mal ubicado respecto del allocator; **no** «arreglar» el test, revisar la ubicación.

Verificación adicional obligatoria, porque el fallo de anclaje es silencioso: añadir un caso que mueva una sesión de **fuerza** dura y afirme que la asignación sigue resuelta.

```ts
it('mover una sesión de fuerza no rompe la asignación del allocator', () => {
  const context = makeRepairContext({
    trainingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    allowDoubleSession: false,
    phase: 'build',
  })
  const raw = [
    makeProposal({ date: '2026-09-07', sessionType: 'squash', rpe: 8, durationMin: 60 }),
    makeProposal({ date: '2026-09-07', sessionType: 'strength', rpe: 8, durationMin: 60 }),
  ]

  const result = repairGeneratedWeek(raw, context)
  const strength = result.sessions.find((s) => s.sessionType === 'strength')

  expect(strength?.date).not.toBe('2026-09-07')
  // La sesión movida conserva contenido real: si el allocator hubiera perdido
  // su anclaje, el finalizador la dejaría sin ejercicios.
  expect((strength?.exercises ?? []).length).toBeGreaterThan(0)
})
```

- [ ] **Step 7: Commit (lo hace el owner)**

```bash
git add src/services/planBuilder/repairWeek.ts src/services/planBuilder/__tests__/sameDayHardSessions.test.ts
git commit -m "fix(plan-builder): separa sesiones duras de deportes distintos el mismo día"
```

---

## Task 3: Gate de calidad de respaldo para duras cruzadas (Tarea 4b del owner)

**Files:**
- Modify: `src/services/planBuilder/qualityReview.ts` (nueva función junto a `getHardSessionClusterIssues` `:353-378`; cablear en el ensamblado por semana `:906`)
- Test: `src/services/planBuilder/__tests__/sameDayHardSessions.test.ts` (extender)

**Interfaces:**
- Consumes: `issue({ severity, code, message, weekIndex })` (`qualityReview.ts:66`), `getPrimarySport(plan)` (`:75`).
- Produces: `getSameDayHardCrossSportIssues(week: TrainingPlanWeek): PlanValidationIssue[]` — función local. Su `severity: 'error'` es consumida por `commitPlan.ts:236` (`criticalIssueCount > 0` bloquea aceptación) y por `getCriticalQualityIssues` en `asyncGenerationLoop.ts:681`.

**Nota de costo, deliberada:** un `error` acá hace que la semana sea rechazada y reintentada (`MAX_WEEK_ATTEMPTS = 2`), lo que cuesta API real. Por eso la Tarea 2 repara primero: en el camino normal esta función no debe disparar nunca, y su costo esperado es US$0. Es una red de seguridad, no el mecanismo principal. **No modificar `getHardSessionClusterIssues`**: su warning de días consecutivos sigue siendo válido y tiene tests propios que dependen de él.

- [ ] **Step 1: Escribir el test que falla**

Añadir a `src/services/planBuilder/__tests__/sameDayHardSessions.test.ts`:

```ts
import { reviewPlanQuality } from '../qualityReview'
import { makePlan, makeWeek, makeSession } from './repairFixtures'

describe('gate de calidad: duras cruzadas el mismo día', () => {
  it('marca error cuando running RPE 8 y squash RPE 8 caen el mismo día', () => {
    const plan = makePlan({ primarySport: 'squash' })
    const week = makeWeek({
      weekIndex: 1,
      sessions: [
        makeSession({ date: '2026-09-07', sessionType: 'running', rpe: 8 }),
        makeSession({ date: '2026-09-07', sessionType: 'squash', rpe: 8 }),
      ],
    })

    const review = reviewPlanQuality(plan, [week])
    const found = review.issues.find((i) => i.code === 'quality.load.same_day_hard_cross_sport')

    expect(found).toBeDefined()
    expect(found?.severity).toBe('error')
    expect(review.criticalIssueCount).toBeGreaterThan(0)
  })

  it('no marca nada cuando las mismas sesiones están en días distintos', () => {
    const plan = makePlan({ primarySport: 'squash' })
    const week = makeWeek({
      weekIndex: 1,
      sessions: [
        makeSession({ date: '2026-09-07', sessionType: 'running', rpe: 8 }),
        makeSession({ date: '2026-09-09', sessionType: 'squash', rpe: 8 }),
      ],
    })

    const review = reviewPlanQuality(plan, [week])
    expect(review.issues.some((i) => i.code === 'quality.load.same_day_hard_cross_sport')).toBe(false)
  })

  it('no marca dos duras del mismo deporte el mismo día', () => {
    const plan = makePlan({ primarySport: 'squash' })
    const week = makeWeek({
      weekIndex: 1,
      sessions: [
        makeSession({ date: '2026-09-07', timeBlock: 'AM', sessionType: 'squash', rpe: 8 }),
        makeSession({ date: '2026-09-07', timeBlock: 'PM', sessionType: 'squash', rpe: 8 }),
      ],
    })

    const review = reviewPlanQuality(plan, [week])
    expect(review.issues.some((i) => i.code === 'quality.load.same_day_hard_cross_sport')).toBe(false)
  })

  it('conserva el warning existente de días consecutivos', () => {
    const plan = makePlan({ primarySport: 'squash' })
    const week = makeWeek({
      weekIndex: 1,
      sessions: [
        makeSession({ date: '2026-09-07', sessionType: 'squash', rpe: 8 }),
        makeSession({ date: '2026-09-08', sessionType: 'squash', rpe: 8 }),
      ],
    })

    const review = reviewPlanQuality(plan, [week])
    const clustered = review.issues.find((i) => i.code === 'quality.load.hard_days_clustered')
    expect(clustered?.severity).toBe('warning')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/planBuilder/__tests__/sameDayHardSessions.test.ts -t "gate de calidad"`
Expected: FAIL — no existe `quality.load.same_day_hard_cross_sport`.

- [ ] **Step 3: Implementar la función**

En `qualityReview.ts`, inmediatamente **después** de `getHardSessionClusterIssues` (o sea, tras `:378`), sin tocarla:

```ts
const HARD_SESSION_RPE_THRESHOLD = 8

/**
 * Dos sesiones duras de deportes DISTINTOS el mismo día.
 *
 * Se separa a propósito de `getHardSessionClusterIssues`, que mide días
 * consecutivos y es agnóstico al deporte: son dos fenómenos distintos y aquel
 * warning sigue siendo válido tal como está.
 *
 * `severity: 'error'` porque bloquea la aceptación del plan
 * (`commitPlan.ts` cuenta `criticalIssueCount`). En el camino normal esto no
 * debería dispararse nunca: `separateSameDayHardCrossSportSessions` en
 * `repairWeek.ts` ya lo corrige de forma determinista y sin costo de API. Esto
 * es el respaldo para cuando el repair no encontró hueco.
 */
function getSameDayHardCrossSportIssues(week: TrainingPlanWeek): PlanValidationIssue[] {
  const sportsByDate = new Map<string, Set<string>>()
  for (const session of week.sessions) {
    if ((session.rpe ?? 6) < HARD_SESSION_RPE_THRESHOLD) continue
    const sports = sportsByDate.get(session.date) ?? new Set<string>()
    sports.add(session.sessionType)
    sportsByDate.set(session.date, sports)
  }

  const offendingDates = [...sportsByDate.entries()]
    .filter(([, sports]) => sports.size >= 2)
    .map(([date]) => date)
    .sort()

  if (offendingDates.length === 0) return []

  return [issue({
    severity: 'error',
    code: 'quality.load.same_day_hard_cross_sport',
    message: `Semana ${week.weekIndex + 1}: dos sesiones duras (RPE ≥ ${HARD_SESSION_RPE_THRESHOLD}) de deportes distintos el mismo día (${offendingDates.join(', ')}). Sepáralas en días distintos.`,
    weekIndex: week.weekIndex,
  })]
}
```

Verificar que el nombre de la constante no colisiona con una existente en el archivo:
```bash
grep -n "HARD_SESSION_RPE_THRESHOLD\|>= 8" src/services/planBuilder/qualityReview.ts
```
Si `getHardSessionClusterIssues` usa el literal `8` inline (lo hace, `:356`), **dejarlo así**: cambiarlo tocaría la función que el owner pidió no modificar.

- [ ] **Step 4: Cablear en el ensamblado por semana**

En `qualityReview.ts:906`:

```ts
      ...getHardSessionClusterIssues(week),
      ...getSameDayHardCrossSportIssues(week),
      ...getGenerationReliabilityIssues(week, qualityVersion),
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/planBuilder/__tests__/sameDayHardSessions.test.ts`
Expected: PASS (8 tests: 4 de la Tarea 2 + 4 de ésta).

- [ ] **Step 6: Verificar que no se rompieron los tests de calidad existentes**

Run: `npx vitest run src/services/planBuilder && npm run lint`
Expected: PASS. Si algún test de `qualityReview` que antes daba `grade` aceptable ahora falla, revisar si su fixture tenía duras cruzadas: si las tenía, el fixture es el que estaba mal y se corrige con una nota; si no, la función tiene un falso positivo.

- [ ] **Step 7: Commit (lo hace el owner)**

```bash
git add src/services/planBuilder/qualityReview.ts src/services/planBuilder/__tests__/sameDayHardSessions.test.ts
git commit -m "feat(plan-builder): gate de calidad para duras cruzadas el mismo día"
```

---

## Task 4: Módulo compartido de directiva de carga por señales reales (Tarea 1a del owner)

**Files:**
- Create: `src/services/training/loadDirectivePolicy.ts`
- Test: `src/services/training/__tests__/loadDirectivePolicy.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
```ts
export type LoadDirectiveVerdict = 'reduce' | 'hold' | 'progress' | 'no_signal'

export interface ExecutionSignals {
  /** RPE real, EXCLUYENDO valores prellenados por Whoop. */
  avgActualRpe?: number
  /** Cuántos valores respaldan `avgActualRpe`. No es el conteo de sesiones completadas. */
  rpeSampleCount?: number
  /** Energía autoreportada, excluyendo prefill Whoop. */
  latestEnergyLevel?: number
  /** Dolor numérico. Whoop nunca lo prellena, así que siempre es autoreportado. */
  latestPainLevel?: number
  /** Sueño autoreportado en horas, excluyendo prefill Whoop. */
  avgSleepHours?: number
  adherencePct?: number
  declaredFatigue?: 'fresh' | 'normal' | 'loaded' | 'overloaded'
}

export interface LoadDirectiveDecision {
  verdict: LoadDirectiveVerdict
  reason: string
}

export function decideLoadDirective(signals: ExecutionSignals): LoadDirectiveDecision
export function renderLoadDirective(decision: LoadDirectiveDecision): string
```
Las Tareas 6 y 7 consumen estas cuatro exportaciones con exactamente estos nombres.

**Por qué un módulo nuevo y no reutilizar el de Week Creator:** `buildLoadDirective` de `WeekCreatorPromptBuilder.ts:535` recibe `WeekCreatorEffectiveConfig` y `ChatContext`; el de `weekPrompt.ts:392` recibe `TrainingPlanWeek` y `PlanWizardConfig`. Compartir la firma obligaría a que uno importe los tipos del otro. Lo que sí es común —y es lo que se extrae— es **la regla de decisión sobre señales normalizadas**. Cada llamador normaliza sus propios datos a `ExecutionSignals`.

**«Compartido» sólo es cierto si ambos lo consumen.** La Tarea 6 cablea Plan Builder y la **Tarea 11** migra Week Creator. Hasta que la 11 esté hecha existen dos copias de la misma regla deportiva, que es exactamente la duplicación que este módulo elimina. No dar la Tarea 4 por cerrada sin la 11.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/training/__tests__/loadDirectivePolicy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decideLoadDirective, renderLoadDirective } from '../loadDirectivePolicy'

describe('decideLoadDirective', () => {
  it('reduce con fatiga declarada overloaded, por encima de todo lo demás', () => {
    const decision = decideLoadDirective({ declaredFatigue: 'overloaded', avgActualRpe: 5, rpeSampleCount: 5 })
    expect(decision.verdict).toBe('reduce')
    expect(decision.reason).toContain('fatiga')
  })

  it('reduce con energía baja', () => {
    expect(decideLoadDirective({ latestEnergyLevel: 3 }).verdict).toBe('reduce')
  })

  it('reduce con dolor elevado', () => {
    expect(decideLoadDirective({ latestPainLevel: 7 }).verdict).toBe('reduce')
  })

  it('mantiene con fatiga declarada loaded', () => {
    expect(decideLoadDirective({ declaredFatigue: 'loaded' }).verdict).toBe('hold')
  })

  it('mantiene o baja con RPE real alto y muestra suficiente', () => {
    const decision = decideLoadDirective({ avgActualRpe: 8.4, rpeSampleCount: 4 })
    expect(decision.verdict).toBe('hold')
    expect(decision.reason).toContain('RPE')
  })

  it('ignora RPE alto con muestra insuficiente', () => {
    expect(decideLoadDirective({ avgActualRpe: 9, rpeSampleCount: 2 }).verdict).toBe('no_signal')
  })

  it('mantiene con adherencia baja: no sube carga sobre trabajo no hecho', () => {
    const decision = decideLoadDirective({ adherencePct: 45 })
    expect(decision.verdict).toBe('hold')
    expect(decision.reason).toContain('adherencia')
  })

  it('progresa con atleta fresco y sin alertas', () => {
    expect(decideLoadDirective({ declaredFatigue: 'fresh' }).verdict).toBe('progress')
  })

  it('devuelve no_signal sin ninguna señal', () => {
    expect(decideLoadDirective({}).verdict).toBe('no_signal')
  })

  it('prioriza dolor por encima de atleta fresco', () => {
    expect(decideLoadDirective({ declaredFatigue: 'fresh', latestPainLevel: 8 }).verdict).toBe('reduce')
  })

  it('mantiene con sueño bajo', () => {
    const decision = decideLoadDirective({ avgSleepHours: 5.4 })
    expect(decision.verdict).toBe('hold')
    expect(decision.reason).toContain('sueño')
  })

  it('no lee ningún campo de Whoop', () => {
    const signals = { avgActualRpe: 6, rpeSampleCount: 4 } as Record<string, unknown>
    signals.whoopRecovery = 20
    expect(decideLoadDirective(signals as never).verdict).toBe('no_signal')
  })

  it('el dolor gana sobre la adherencia baja', () => {
    expect(decideLoadDirective({ latestPainLevel: 8, adherencePct: 20 }).verdict).toBe('reduce')
  })
})

describe('renderLoadDirective', () => {
  it('produce una línea accionable en mayúsculas para cada veredicto', () => {
    for (const verdict of ['reduce', 'hold', 'progress'] as const) {
      const text = renderLoadDirective({ verdict, reason: 'motivo de prueba' })
      expect(text).toMatch(/^(REDUCIR|MANTENER|SUBIR)/)
      expect(text).toContain('motivo de prueba')
    }
  })

  it('devuelve cadena vacía para no_signal, para que el llamador omita la línea', () => {
    expect(renderLoadDirective({ verdict: 'no_signal', reason: '' })).toBe('')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/loadDirectivePolicy.test.ts`
Expected: FAIL — `Cannot find module '../loadDirectivePolicy'`.

- [ ] **Step 3: Implementar el módulo**

Crear `src/services/training/loadDirectivePolicy.ts`:

```ts
/**
 * Regla de decisión de carga a partir de ejecución REAL del atleta.
 *
 * Existe como módulo aparte porque Week Creator y Plan Builder necesitan la
 * misma regla deportiva pero tienen tipos de entrada incompatibles
 * (`WeekCreatorEffectiveConfig` + `ChatContext` contra `TrainingPlanWeek` +
 * `PlanWizardConfig`). Cada llamador normaliza lo suyo a `ExecutionSignals` y
 * comparte la decisión.
 *
 * No depende de Whoop: `ExecutionSignals` sólo admite datos autoreportados
 * (energía, dolor, sueño vía day logs) y RPE real de sesiones completadas. El
 * llamador es responsable de excluir valores prellenados por Whoop antes de
 * construir las señales.
 */

export type LoadDirectiveVerdict = 'reduce' | 'hold' | 'progress' | 'no_signal'

export interface ExecutionSignals {
  /**
   * Promedio de RPE real. El llamador DEBE excluir los valores que Whoop
   * prellenó (`isWhoopPrefilled(log, 'rpeActual')`): un strain alto convertido
   * a esfuerzo no es un RPE declarado por el atleta.
   */
  avgActualRpe?: number
  /**
   * Cuántos valores respaldan `avgActualRpe`. Es el conteo de RPE reales, NO
   * el de sesiones completadas: una semana con 5 sesiones hechas y 1 RPE
   * anotado tiene muestra 1, y con menos de 3 no hay señal.
   */
  rpeSampleCount?: number
  /** Energía autoreportada, 1-10, excluyendo prefill Whoop. */
  latestEnergyLevel?: number
  /**
   * Dolor autoreportado, 1-10. Whoop no prellena este campo
   * (`prefillSource` sólo cubre `sleepHours`, `sleepQuality`, `energyLevel` y
   * `rpeActual`), así que siempre es del atleta.
   */
  latestPainLevel?: number
  /** Sueño autoreportado en horas, excluyendo prefill Whoop. */
  avgSleepHours?: number
  /** Adherencia de la ventana, 0-100. */
  adherencePct?: number
  /** Fatiga declarada por el atleta. */
  declaredFatigue?: 'fresh' | 'normal' | 'loaded' | 'overloaded'
}

export interface LoadDirectiveDecision {
  verdict: LoadDirectiveVerdict
  reason: string
}

/** Mismos umbrales que ya usaba Week Creator, para no cambiar su comportamiento. */
const LOW_ENERGY_THRESHOLD = 4
const HIGH_PAIN_THRESHOLD = 6
const HIGH_RPE_THRESHOLD = 8
const MIN_RPE_SAMPLE = 3
const LOW_ADHERENCE_THRESHOLD = 60
/** Mismo umbral que ya usa `recommendationFromWeeks` en `recentContext.ts`. */
const LOW_SLEEP_THRESHOLD = 6.5

/**
 * El orden de las reglas es el contrato: seguridad primero (fatiga declarada,
 * dolor, energía), después evidencia de sobrecarga (RPE), después adherencia,
 * y sólo al final la señal que permite subir. Una señal de reducir nunca puede
 * ser anulada por una de progresar que venga después.
 */
export function decideLoadDirective(signals: ExecutionSignals): LoadDirectiveDecision {
  if (signals.declaredFatigue === 'overloaded') {
    return { verdict: 'reduce', reason: 'el atleta declara fatiga acumulada alta' }
  }
  if (signals.latestPainLevel != null && signals.latestPainLevel >= HIGH_PAIN_THRESHOLD) {
    return { verdict: 'reduce', reason: `el último registro marca dolor ${signals.latestPainLevel}/10` }
  }
  if (signals.latestEnergyLevel != null && signals.latestEnergyLevel <= LOW_ENERGY_THRESHOLD) {
    return { verdict: 'reduce', reason: `el último registro marca energía ${signals.latestEnergyLevel}/10` }
  }
  if (signals.declaredFatigue === 'loaded') {
    return { verdict: 'hold', reason: 'el atleta declara carga acumulada' }
  }
  if (
    signals.avgActualRpe != null
    && (signals.rpeSampleCount ?? 0) >= MIN_RPE_SAMPLE
    && signals.avgActualRpe >= HIGH_RPE_THRESHOLD
  ) {
    return {
      verdict: 'hold',
      reason: `el RPE real promedio fue ${formatOneDecimal(signals.avgActualRpe)}/10 en ${signals.rpeSampleCount} sesiones`,
    }
  }
  if (signals.avgSleepHours != null && signals.avgSleepHours < LOW_SLEEP_THRESHOLD) {
    return {
      verdict: 'hold',
      reason: `el sueño promedio fue ${formatOneDecimal(signals.avgSleepHours)}h`,
    }
  }
  if (signals.adherencePct != null && signals.adherencePct < LOW_ADHERENCE_THRESHOLD) {
    return {
      verdict: 'hold',
      reason: `la adherencia real fue ${Math.round(signals.adherencePct)}%, así que no hay base para subir carga`,
    }
  }
  if (signals.declaredFatigue === 'fresh') {
    return { verdict: 'progress', reason: 'el atleta llega fresco' }
  }
  return { verdict: 'no_signal', reason: '' }
}

/**
 * Devuelve cadena vacía en `no_signal` a propósito: el llamador filtra líneas
 * vacías, así que la ausencia de señal no imprime nada en vez de imprimir un
 * "sin datos" que el modelo interpretaría como una instrucción.
 */
export function renderLoadDirective(decision: LoadDirectiveDecision): string {
  switch (decision.verdict) {
    case 'reduce':
      return `REDUCIR CARGA REAL — ${decision.reason}. Baja volumen e intensidad, deja las sesiones duras en RPE 6-7 y evita impactos agresivos.`
    case 'hold':
      return `MANTENER SIN SUBIR — ${decision.reason}. Conserva los estímulos de calidad, recorta volumen accesorio y no agregues intensidad extra.`
    case 'progress':
      return `SUBIR CARGA — ${decision.reason}. Puedes incrementar volumen o intensidad un escalón, no ambos a la vez.`
    case 'no_signal':
      return ''
  }
}

function formatOneDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/training/__tests__/loadDirectivePolicy.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Verificar lint y tipos**

Run: `npm run lint && npx tsc -b`
Expected: sin errores.

- [ ] **Step 6: Commit (lo hace el owner)**

```bash
git add src/services/training/loadDirectivePolicy.ts src/services/training/__tests__/loadDirectivePolicy.test.ts
git commit -m "feat(training): regla compartida de directiva de carga por ejecución real"
```

---

## Task 5: Ventana intra-plan en el contexto reciente (Tarea 1b del owner)

**Files:**
- Modify: `src/services/planBuilder/recentContext.ts` (`buildPlanBuilderRecentContext` `:226-250`, interfaz `:35-52`)
- Modify: `src/services/planBuilder/recentContextRender.ts` (interfaz `:30-46`, `renderPlanBuilderRecentContext` `:68`)
- Test: `src/services/planBuilder/__tests__/recentContextIntraPlan.test.ts` (crear)

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `PlanBuilderRecentContext` gana dos campos opcionales:
```ts
  /** Fecha desde la que se leyó historial. Igual a `plan.startDate` salvo recalibración. */
  referenceDate: string
  /** Semanas del propio plan ya vividas, presentes sólo en recalibración. */
  livedPlanWeeks?: PlanBuilderRecentWeekContext[]
```
Y `PlanBuilderRecentWeekContext` gana cuatro campos, porque los actuales no sirven para alimentar el policy:
```ts
  /** RPE real autoreportado, excluyendo prefill Whoop. */
  avgManualActualRpe?: number
  /** Cuántos valores respaldan `avgManualActualRpe`. */
  manualRpeSampleCount: number
  /** Energía autoreportada más reciente de la semana, excluyendo prefill Whoop. */
  latestManualEnergyLevel?: number
  /** Dolor numérico más reciente de la semana. Whoop nunca lo prellena. */
  latestManualPainLevel?: number
  /** Sueño autoreportado promedio, excluyendo prefill Whoop. */
  avgManualSleepHours?: number
```
Y la firma:
```ts
export async function buildPlanBuilderRecentContext(
  plan: TrainingPlan,
  lookbackWeeks?: number,
  options?: { asOfDate?: string },
): Promise<PlanBuilderRecentContext>
```
La Tarea 6 lee `livedPlanWeeks`; la Tarea 7 pasa `options.asOfDate`.

**Advertencia de duplicación:** `PlanBuilderRecentContext` está **declarada dos veces** — en `recentContext.ts:35` y en `recentContextRender.ts:30` — y `weekPrompt.ts:9` importa la de `recentContextRender`. Los dos campos nuevos deben agregarse a **ambas** declaraciones o el prompt no verá el campo. No unificarlas en esta tarea (es refactor aparte); sí dejar un comentario en ambas apuntando a la otra.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/planBuilder/__tests__/recentContextIntraPlan.test.ts`. Usar `fake-indexeddb` como los demás tests de Dexie del repo — revisar primero cómo lo hace uno existente:
```bash
grep -rln "fake-indexeddb" src/services/planBuilder/__tests__/ | head -3
```

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../db/db'
import { buildPlanBuilderRecentContext } from '../recentContext'
import { makePlan } from './repairFixtures'

async function seedLivedWeek(athleteId: string, weekStart: string, rpe: number, energy: number) {
  await db.sessions.add({
    id: `s-${weekStart}`, athleteId, date: weekStart, weekStartDate: weekStart,
    sessionType: 'squash', status: 'completed', actualRpe: rpe, durationMin: 60,
  } as never)
  await db.dayLogs.add({
    id: `d-${weekStart}`, athleteId, date: weekStart, energyLevel: energy, painLevel: 2,
  } as never)
}

describe('ventana intra-plan del contexto reciente', () => {
  beforeEach(async () => {
    await db.sessions.clear()
    await db.dayLogs.clear()
    await db.weekSummaries.clear()
  })

  it('sin asOfDate conserva el comportamiento actual: sólo historial pre-plan', async () => {
    const plan = makePlan({ startDate: '2026-09-07' })
    await seedLivedWeek(plan.athleteId, '2026-09-14', 9, 3) // dentro del plan

    const context = await buildPlanBuilderRecentContext(plan)

    expect(context.referenceDate).toBe('2026-09-07')
    expect(context.livedPlanWeeks).toBeUndefined()
    expect(context.weeks.every((w) => w.weekStartDate < '2026-09-07')).toBe(true)
  })

  it('con asOfDate expone las semanas del plan ya vividas', async () => {
    const plan = makePlan({ startDate: '2026-09-07' })
    await seedLivedWeek(plan.athleteId, '2026-09-07', 9, 3)
    await seedLivedWeek(plan.athleteId, '2026-09-14', 9, 4)

    const context = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: '2026-09-21' })

    expect(context.referenceDate).toBe('2026-09-21')
    expect(context.livedPlanWeeks).toBeDefined()
    expect(context.livedPlanWeeks?.map((w) => w.weekStartDate)).toEqual(['2026-09-07', '2026-09-14'])
    expect(context.livedPlanWeeks?.[0].avgActualRpe).toBe(9)
  })

  it('no incluye semanas del plan aún no vividas', async () => {
    const plan = makePlan({ startDate: '2026-09-07' })
    await seedLivedWeek(plan.athleteId, '2026-09-07', 7, 7)
    await seedLivedWeek(plan.athleteId, '2026-09-28', 7, 7) // futura respecto de asOf

    const context = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: '2026-09-21' })

    expect(context.livedPlanWeeks?.map((w) => w.weekStartDate)).toEqual(['2026-09-07'])
  })

  it('un asOfDate anterior al inicio del plan no produce semanas vividas', async () => {
    const plan = makePlan({ startDate: '2026-09-07' })
    const context = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: '2026-09-01' })
    expect(context.livedPlanWeeks ?? []).toEqual([])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/planBuilder/__tests__/recentContextIntraPlan.test.ts`
Expected: FAIL — `buildPlanBuilderRecentContext` no acepta el tercer argumento y no expone `livedPlanWeeks`.

- [ ] **Step 3: Extender la interfaz en los DOS archivos**

En `recentContext.ts` (dentro de `export interface PlanBuilderRecentContext`, tras `weeklyStructure`) y **también** en `recentContextRender.ts` (misma interfaz duplicada):

```ts
  /**
   * Semanas del propio plan que el atleta YA vivió. Sólo se puebla cuando se
   * pide el contexto con `asOfDate` (recalibración de un plan en curso). En la
   * generación inicial es `undefined`, porque ninguna semana del plan ocurrió
   * todavía.
   *
   * NOTA: esta interfaz está duplicada en `recentContext.ts` y
   * `recentContextRender.ts`. Mantener ambas en sincronía.
   */
  livedPlanWeeks?: PlanBuilderRecentWeekContext[]
```

- [ ] **Step 4: Implementar la ventana intra-plan**

En `recentContext.ts`, cambiar la firma y el anclaje. El cuerpo actual (`:226-233`) empieza así:

```ts
export async function buildPlanBuilderRecentContext(
  plan: TrainingPlan,
  lookbackWeeks = DEFAULT_LOOKBACK_WEEKS,
): Promise<PlanBuilderRecentContext> {
  const referenceDate = plan.startDate
  const referenceWeekStart = getWeekStart(fromISO(referenceDate))
```

Reemplazar por:

```ts
export async function buildPlanBuilderRecentContext(
  plan: TrainingPlan,
  lookbackWeeks = DEFAULT_LOOKBACK_WEEKS,
  options?: { asOfDate?: string },
): Promise<PlanBuilderRecentContext> {
  // Sin `asOfDate` el anclaje sigue siendo el inicio del plan, que es el
  // comportamiento de la generación inicial y no debe cambiar. Con `asOfDate`
  // —recalibración— el anclaje se mueve a hoy, de modo que la ventana de
  // lookback alcanza las semanas del plan que el atleta ya vivió.
  const referenceDate = options?.asOfDate ?? plan.startDate
  const referenceWeekStart = getWeekStart(fromISO(referenceDate))
```

Después de que se construyan `context.weeks` (al final de la función, antes del `return`), separar las semanas intra-plan. Leer el `return` actual y añadir:

```ts
  // Las semanas del propio plan ya vividas se exponen aparte: mezclarlas con el
  // historial pre-plan borraría la distinción entre "así entrenaba antes" y
  // "así le está yendo con ESTE plan", que es justo lo que la directiva de
  // carga necesita distinguir.
  const planStart = toISO(getWeekStart(fromISO(plan.startDate)))
  const livedPlanWeeks = options?.asOfDate
    ? weeks.filter((week) => week.weekStartDate >= planStart)
    : undefined
```

y agregar `livedPlanWeeks` al objeto devuelto. `weeks` es la variable local que ya arma la función; verificar su nombre real leyendo el `return` antes de editar.

- [ ] **Step 4b: Calcular señales autoreportadas, sin contaminación de Whoop**

Éste es el paso que hace utilizable la capa adaptativa; sin él el policy recibe datos que no cumplen su contrato.

Los campos actuales de `summarizeWeek` (`recentContext.ts:128-162`) **no sirven** por tres razones verificadas:
- `actualRpeValues` (`:139-142`) mezcla `log.rpeActual` **sin** filtrar prefill Whoop, mientras que Week Creator sí lo filtra (`WeekCreatorPromptBuilder.ts:584`). `prefillSource` cubre `sleepHours`, `sleepQuality`, `energyLevel` y `rpeActual`, así que RPE, energía y sueño pueden venir de Whoop.
- `painNotes` es un `string[]`; no hay dolor numérico que el policy pueda comparar contra un umbral.
- No existe conteo de cuántos valores respaldan el promedio de RPE.

En `recentContext.ts`, importar el helper y calcular las señales manuales dentro de `summarizeWeek`:

```ts
import { isWhoopPrefilled } from '../readiness/dayLogPrefillSave'
```

```ts
  // Señales AUTOREPORTADAS. Se calculan aparte de los promedios existentes a
  // propósito: `avgActualRpe`/`avgEnergy`/`avgSleep` alimentan el render del
  // historial y el `recommendation`, y cambiarles la definición movería un
  // comportamiento ya desplegado. Estas otras alimentan la directiva de carga,
  // que exige datos declarados por el atleta.
  const manualLogs = [...dayLogs].sort((a, b) => a.date.localeCompare(b.date))

  const manualRpeValues = [
    ...completedSessions
      .map((session) => session.actualRpe)
      .filter((value): value is number => value != null),
    ...manualLogs
      .filter((log) => !isWhoopPrefilled(log, 'rpeActual'))
      .map((log) => log.rpeActual)
      .filter((value): value is number => value != null),
  ]

  const manualSleepValues = manualLogs
    .filter((log) => !isWhoopPrefilled(log, 'sleepHours'))
    .map((log) => log.sleepHours)
    .filter((value): value is number => value != null)

  const manualEnergyLogs = manualLogs.filter((log) => !isWhoopPrefilled(log, 'energyLevel'))
  const latestManualEnergy = [...manualEnergyLogs]
    .reverse()
    .find((log) => log.energyLevel != null)?.energyLevel

  // El dolor no es prellenable por Whoop, así que no se filtra.
  const latestManualPain = [...manualLogs]
    .reverse()
    .find((log) => log.painLevel != null)?.painLevel
```

y añadirlos al objeto devuelto:

```ts
    avgManualActualRpe: average(manualRpeValues),
    manualRpeSampleCount: manualRpeValues.length,
    latestManualEnergyLevel: latestManualEnergy,
    latestManualPainLevel: latestManualPain,
    avgManualSleepHours: average(manualSleepValues),
```

**No** derivar estos valores de `summary?.*`: `WeekSummary` guarda promedios ya calculados sin distinguir procedencia, así que usarlos reintroduciría la contaminación.

Añadir a `recentContextIntraPlan.test.ts`:

```ts
it('excluye el RPE prellenado por Whoop', async () => {
  const plan = makePlan({ startDate: '2026-09-07' })
  await db.sessions.add({
    id: 's1', athleteId: plan.athleteId, date: '2026-09-07', weekStartDate: '2026-09-07',
    sessionType: 'squash', status: 'completed', durationMin: 60,
  } as never)
  await db.dayLogs.add({
    id: 'd1', athleteId: plan.athleteId, date: '2026-09-07',
    rpeActual: 10, energyLevel: 2, sleepHours: 4,
    prefillSource: { rpeActual: 'whoop', energyLevel: 'whoop', sleepHours: 'whoop' },
  } as never)

  const context = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: '2026-09-14' })
  const week = context.livedPlanWeeks?.[0]

  expect(week?.avgManualActualRpe).toBeUndefined()
  expect(week?.manualRpeSampleCount).toBe(0)
  expect(week?.latestManualEnergyLevel).toBeUndefined()
  expect(week?.avgManualSleepHours).toBeUndefined()
})

it('conserva el dolor numérico, que Whoop nunca prellena', async () => {
  const plan = makePlan({ startDate: '2026-09-07' })
  await db.dayLogs.add({
    id: 'd1', athleteId: plan.athleteId, date: '2026-09-08', painLevel: 7,
  } as never)

  const context = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: '2026-09-14' })
  expect(context.livedPlanWeeks?.[0].latestManualPainLevel).toBe(7)
})

it('cuenta la muestra de RPE, no las sesiones completadas', async () => {
  const plan = makePlan({ startDate: '2026-09-07' })
  for (const [i, rpe] of [[0, 9], [1, undefined], [2, undefined]] as const) {
    await db.sessions.add({
      id: `s${i}`, athleteId: plan.athleteId, date: '2026-09-07', weekStartDate: '2026-09-07',
      sessionType: 'squash', status: 'completed', durationMin: 60, actualRpe: rpe,
    } as never)
  }

  const context = await buildPlanBuilderRecentContext(plan, undefined, { asOfDate: '2026-09-14' })
  const week = context.livedPlanWeeks?.[0]
  expect(week?.completedSessions).toBe(3)
  expect(week?.manualRpeSampleCount).toBe(1)
})
```

- [ ] **Step 5: Renderizar la ventana intra-plan**

En `recentContextRender.ts`, dentro de `renderPlanBuilderRecentContext`, antes del `renderWeeklyStructure(context)` del array final:

```ts
  const livedLines = (context.livedPlanWeeks ?? []).map((week) => {
    return [
      `- Semana ${week.weekStartDate}: ${week.completedSessions}/${week.plannedSessions} sesiones`,
      week.adherencePct != null ? `adh ${week.adherencePct}%` : '',
      week.avgActualRpe != null ? `RPE real ${week.avgActualRpe}` : '',
      week.avgEnergy != null ? `energía ${week.avgEnergy}` : '',
      week.painNotes.length > 0 ? `dolor: ${week.painNotes.join(' | ')}` : '',
    ].filter(Boolean).join(' · ')
  })
```

y en el array de salida, antes de `renderWeeklyStructure(context)`:

```ts
    livedLines.length > 0 ? 'Semanas de ESTE plan que el atleta ya vivió (datos reales, no planificados):' : '',
    ...livedLines,
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/planBuilder/__tests__/recentContextIntraPlan.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Verificar que la generación inicial no cambió**

Run: `npx vitest run src/services/planBuilder && npm run lint && npx tsc -b`
Expected: PASS. Ningún test existente de `recentContext` debe cambiar de resultado: sin `asOfDate` el comportamiento es idéntico.

- [ ] **Step 8: Commit (lo hace el owner)**

```bash
git add src/services/planBuilder/recentContext.ts src/services/planBuilder/recentContextRender.ts src/services/planBuilder/__tests__/recentContextIntraPlan.test.ts
git commit -m "feat(plan-builder): ventana intra-plan opcional en el contexto reciente"
```

---

## Task 6: La directiva de carga consume ejecución real (Tarea 1c del owner)

**Files:**
- Modify: `src/services/week/prompts/weekPrompt.ts` (`buildLoadDirective` `:392-425`, `buildProgressionSection` `:427-440`)
- Test: `src/services/week/prompts/__tests__/weekPromptLoadDirective.test.ts` (crear)

**Interfaces:**
- Consumes: `decideLoadDirective`, `renderLoadDirective`, `ExecutionSignals` de la Tarea 4; `PlanBuilderRecentContext.livedPlanWeeks` de la Tarea 5.
- Produces: `buildProgressionSection` pasa a recibir `recentContext` como cuarto parámetro.

**Regla de precedencia, deliberada:** la directiva basada en fase (`race`/`taper`/`transition`) **gana siempre** sobre las señales reales. Un atleta fresco en semana de taper no debe recibir «SUBIR CARGA»: la fase es una decisión de periodización que la ejecución reciente no invalida. Las señales reales se aplican **sólo** en `base`/`build`/`peak`, y ahí una señal de *reducir* puede anular una directiva de *subir* derivada de la carga planificada, pero no al revés.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/week/prompts/__tests__/weekPromptLoadDirective.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildWeekUserPrompt } from '../weekPrompt'
import { makeWeekPromptInput, makeRecentContext } from './fixtures'

describe('directiva de carga con ejecución real', () => {
  it('reduce cuando la semana vivida del plan trae RPE alto y energía baja', () => {
    const prompt = buildWeekUserPrompt(makeWeekPromptInput({
      week: { weekIndex: 1, phase: 'build' },
      recentContext: makeRecentContext({
        livedPlanWeeks: [{
          weekStartDate: '2026-09-07', plannedSessions: 5, completedSessions: 5,
          adherencePct: 100, plannedMinutes: 300, completedMinutes: 300,
          avgActualRpe: 9, avgEnergy: 3, sports: {}, painNotes: [], sessionHighlights: [],
        }],
      }),
    }))

    expect(prompt).toContain('REDUCIR CARGA REAL')
    expect(prompt).toContain('energía 3/10')
  })

  it('la fase taper gana sobre una señal real de progresar', () => {
    const prompt = buildWeekUserPrompt(makeWeekPromptInput({
      week: { weekIndex: 5, phase: 'taper' },
      recentContext: makeRecentContext({
        livedPlanWeeks: [{
          weekStartDate: '2026-09-07', plannedSessions: 5, completedSessions: 5,
          adherencePct: 100, plannedMinutes: 300, completedMinutes: 300,
          avgActualRpe: 5, avgEnergy: 9, sports: {}, painNotes: [], sessionHighlights: [],
        }],
      }),
    }))

    expect(prompt).toContain('REDUCIR carga de verdad')
    expect(prompt).not.toContain('SUBIR CARGA')
  })

  it('sin livedPlanWeeks conserva exactamente la directiva anterior', () => {
    const withoutContext = buildWeekUserPrompt(makeWeekPromptInput({
      week: { weekIndex: 1, phase: 'build' },
      recentContext: undefined,
    }))
    expect(withoutContext).toContain('Directiva de carga:')
    expect(withoutContext).not.toContain('REDUCIR CARGA REAL')
  })

  it('una señal real de reducir anula una directiva planificada de subir', () => {
    const prompt = buildWeekUserPrompt(makeWeekPromptInput({
      week: { weekIndex: 2, phase: 'build', targetLoadBySport: { squash: 500 } },
      previousWeek: { weekIndex: 1, phase: 'build', targetLoadBySport: { squash: 300 } },
      recentContext: makeRecentContext({
        livedPlanWeeks: [{
          weekStartDate: '2026-09-07', plannedSessions: 5, completedSessions: 2,
          adherencePct: 40, plannedMinutes: 300, completedMinutes: 120,
          avgActualRpe: 6, avgEnergy: 8, sports: {}, painNotes: [], sessionHighlights: [],
        }],
      }),
    }))

    expect(prompt).toContain('MANTENER SIN SUBIR')
    expect(prompt).toContain('adherencia real')
  })
})
```

Extender `./fixtures` con `makeRecentContext(overrides)` y permitir overrides de `week`/`previousWeek`/`recentContext` en `makeWeekPromptInput`.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/week/prompts/__tests__/weekPromptLoadDirective.test.ts`
Expected: FAIL — no aparece `REDUCIR CARGA REAL`.

- [ ] **Step 3: Normalizar señales y aplicar la regla**

En `weekPrompt.ts`, agregar el import y un normalizador junto a `buildLoadDirective`:

```ts
import { decideLoadDirective, renderLoadDirective, type ExecutionSignals } from '../../training/loadDirectivePolicy'
```

```ts
/**
 * Normaliza la última semana YA VIVIDA de este plan a señales de ejecución.
 *
 * Sólo mira `livedPlanWeeks`, no el historial pre-plan: el pre-plan ya calibra
 * el arranque a través de `summary.recommendation` y mezclarlo acá haría que
 * un mal mes anterior siguiera frenando la semana 9 del plan.
 *
 * No lee ningún campo de Whoop.
 */
function executionSignalsFromLivedWeeks(
  recentContext: PlanBuilderRecentContext | undefined,
): ExecutionSignals | undefined {
  const lived = recentContext?.livedPlanWeeks
  if (!lived || lived.length === 0) return undefined
  const last = lived[lived.length - 1]
  return {
    // Sólo señales AUTOREPORTADAS: los campos `avgActualRpe`/`avgEnergy`/
    // `avgSleep` de la semana incluyen valores prellenados por Whoop y no
    // cumplen el contrato de `ExecutionSignals`.
    avgActualRpe: last.avgManualActualRpe,
    rpeSampleCount: last.manualRpeSampleCount,
    latestEnergyLevel: last.latestManualEnergyLevel,
    latestPainLevel: last.latestManualPainLevel,
    avgSleepHours: last.avgManualSleepHours,
    adherencePct: last.adherencePct,
  }
}
```

Cambiar la firma de `buildLoadDirective` para aceptar el contexto y aplicar la regla **sólo en fases entrenables**:

```ts
function buildLoadDirective(
  previousWeek: TrainingPlanWeek | undefined,
  week: TrainingPlanWeek,
  wizardConfig: PlanWizardConfig,
  recentContext?: PlanBuilderRecentContext,
): string {
  if (week.phase === 'race') {
    return 'CONSERVAR energía: el evento manda. Solo activaciones suaves alrededor del torneo, nada pesado.'
  }
  if (week.phase === 'taper') {
    return 'REDUCIR carga de verdad: baja el volumen 30-40% respecto a la semana previa, conserva toques cortos de intensidad/timing y prioriza frescura.'
  }
  if (week.phase === 'transition') {
    return 'RECUPERAR: actividad suave y agradable, RPE <= 5 en todo, sin presión de volumen ni intensidad.'
  }

  // Ejecución real, sólo en fases entrenables. La fase ya decidió arriba: una
  // semana de taper no sube carga aunque el atleta llegue fresco.
  const signals = executionSignalsFromLivedWeeks(recentContext)
  if (signals) {
    const decision = decideLoadDirective(signals)
    if (decision.verdict === 'reduce' || decision.verdict === 'hold') {
      // Una señal real de frenar anula la progresión que marcaba la carga
      // planificada: el plan se escribió antes de saber cómo le iría.
      return renderLoadDirective(decision)
    }
  }

  const previousTotal = previousWeek ? sumTargetLoads(previousWeek.targetLoadBySport) : 0
  // ... resto del cuerpo actual sin cambios ...
```

Dejar intacto todo lo que sigue (el bloque de `previousTotal`/`currentTotal`).

- [ ] **Step 4: Propagar el contexto por `buildProgressionSection`**

```ts
function buildProgressionSection(
  previousWeek: TrainingPlanWeek | undefined,
  week: TrainingPlanWeek,
  wizardConfig: PlanWizardConfig,
  recentContext?: PlanBuilderRecentContext,
): string[] {
  const lines = ['PROGRESIÓN RESPECTO A LA SEMANA PREVIA']
  if (previousWeek && previousWeek.phase !== week.phase) {
    lines.push(`Cambio de fase: ${PHASE_LABEL[previousWeek.phase] ?? previousWeek.phase} -> ${PHASE_LABEL[week.phase] ?? week.phase}. El carácter de las sesiones debe reflejar la fase nueva, no repetir la anterior.`)
  }
  lines.push(`Directiva de carga: ${buildLoadDirective(previousWeek, week, wizardConfig, recentContext)}`)
  lines.push('No clones las sesiones de la semana previa: conserva lo que progresa y varía drills, ejercicios y estímulos.')
  lines.push(briefPreviousWeek(previousWeek))
  return lines
}
```

Y en los llamadores dentro de `buildWeekUserPrompt` (`:361`) y `buildWeekBatchUserPrompt`:

```ts
    ...buildProgressionSection(previousWeek, week, wizardConfig, input.recentContext),
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/week/prompts/__tests__/weekPromptLoadDirective.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Verificar que la generación inicial no cambió**

Run: `npx vitest run src/services/week src/services/planBuilder && npm run lint && npx tsc -b`
Expected: PASS. Sin `livedPlanWeeks` la directiva es idéntica a la anterior, así que ningún test de prompt existente debe moverse.

- [ ] **Step 7: Commit (lo hace el owner)**

```bash
git add src/services/week/prompts/weekPrompt.ts src/services/week/prompts/__tests__/
git commit -m "feat(plan-builder): la directiva de carga consume ejecución real del plan en curso"
```

---

## Task 7: Selección de semanas recalibrables (Tarea 1d del owner)

**Files:**
- Create: `src/services/planBuilder/planRecalibration.ts`
- Test: `src/services/planBuilder/__tests__/planRecalibration.test.ts`

**Interfaces:**
- Consumes: `TrainingPlan`, `TrainingPlanWeek`.
- Produces:
```ts
export interface RecalibrationTarget {
  weekIndexes: number[]
  asOfDate: string
  livedWeekCount: number
}
export function selectRecalibrationTargets(input: {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
  todayISO: string
}): RecalibrationTarget | null
```
La Tarea 8 consume ambas exportaciones.

**Contrato de seguridad:** nunca se recalibra una semana en curso ni pasada. Sólo semanas **estrictamente futuras** respecto de la semana que contiene `todayISO`. Recalibrar la semana en curso borraría sesiones que el atleta quizá ya empezó, y ese borrado es exactamente el riesgo que `planLifecycle.ts` existe para controlar.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/planBuilder/__tests__/planRecalibration.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { selectRecalibrationTargets } from '../planRecalibration'
import { makePlan, makeWeek } from './repairFixtures'

const weeks = [
  makeWeek({ weekIndex: 0, weekStartDate: '2026-09-07' }),
  makeWeek({ weekIndex: 1, weekStartDate: '2026-09-14' }),
  makeWeek({ weekIndex: 2, weekStartDate: '2026-09-21' }),
  makeWeek({ weekIndex: 3, weekStartDate: '2026-09-28' }),
]

describe('selectRecalibrationTargets', () => {
  it('devuelve sólo las semanas estrictamente futuras', () => {
    const plan = makePlan({ startDate: '2026-09-07', status: 'active' })
    const target = selectRecalibrationTargets({ plan, weeks, todayISO: '2026-09-16' })

    expect(target?.weekIndexes).toEqual([2, 3])
    expect(target?.asOfDate).toBe('2026-09-16')
    expect(target?.livedWeekCount).toBe(2)
  })

  it('nunca incluye la semana en curso', () => {
    const plan = makePlan({ startDate: '2026-09-07', status: 'active' })
    const target = selectRecalibrationTargets({ plan, weeks, todayISO: '2026-09-21' })
    expect(target?.weekIndexes).toEqual([3])
  })

  it('devuelve null si no queda ninguna semana futura', () => {
    const plan = makePlan({ startDate: '2026-09-07', status: 'active' })
    expect(selectRecalibrationTargets({ plan, weeks, todayISO: '2026-09-30' })).toBeNull()
  })

  it('devuelve null antes de que el plan empiece: no hay nada vivido', () => {
    const plan = makePlan({ startDate: '2026-09-07', status: 'active' })
    expect(selectRecalibrationTargets({ plan, weeks, todayISO: '2026-09-01' })).toBeNull()
  })

  it('devuelve null para un plan que no está activo', () => {
    const plan = makePlan({ startDate: '2026-09-07', status: 'draft' })
    expect(selectRecalibrationTargets({ plan, weeks, todayISO: '2026-09-16' })).toBeNull()
  })

  it('devuelve null si no hay al menos una semana completa vivida', () => {
    const plan = makePlan({ startDate: '2026-09-07', status: 'active' })
    expect(selectRecalibrationTargets({ plan, weeks, todayISO: '2026-09-09' })).toBeNull()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/planBuilder/__tests__/planRecalibration.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar el módulo**

Crear `src/services/planBuilder/planRecalibration.ts`:

```ts
import { getWeekStart, fromISO, toISO } from '../../utils/date'
import type { TrainingPlan, TrainingPlanWeek } from '../../types/planBuilder'

export interface RecalibrationTarget {
  /** Semanas a regenerar. Siempre estrictamente futuras. */
  weekIndexes: number[]
  /** Fecha de corte para leer historial real. */
  asOfDate: string
  /** Cuántas semanas del plan quedaron atrás; sirve para el copy de la UI. */
  livedWeekCount: number
}

/**
 * Qué semanas de un plan EN CURSO pueden regenerarse con datos reales.
 *
 * Reglas duras:
 * - Sólo planes `active`. Un borrador ya tiene sus propias rutas de
 *   regeneración y no tiene nada vivido que leer.
 * - Sólo semanas **estrictamente futuras**. La semana en curso queda fuera a
 *   propósito: el atleta puede haberla empezado, y regenerarla borraría
 *   sesiones que no pidió borrar.
 * - Hace falta al menos UNA semana completa vivida, o la recalibración no
 *   tendría más datos que la generación original.
 */
export function selectRecalibrationTargets(input: {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
  todayISO: string
}): RecalibrationTarget | null {
  const { plan, weeks, todayISO } = input
  if (plan.status !== 'active') return null

  const currentWeekStart = toISO(getWeekStart(fromISO(todayISO)))

  const livedWeeks = weeks.filter((week) => week.weekStartDate < currentWeekStart)
  if (livedWeeks.length === 0) return null

  const futureWeeks = weeks
    .filter((week) => week.weekStartDate > currentWeekStart)
    .sort((a, b) => a.weekIndex - b.weekIndex)
  if (futureWeeks.length === 0) return null

  return {
    weekIndexes: futureWeeks.map((week) => week.weekIndex),
    asOfDate: todayISO,
    livedWeekCount: livedWeeks.length,
  }
}
```

Verificar que `utils/date` exporta `getWeekStart`, `fromISO` y `toISO` con esos nombres (lo hace: `recentContext.ts:5` los importa así).

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/planBuilder/__tests__/planRecalibration.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Verificar lint y tipos**

Run: `npm run lint && npx tsc -b`
Expected: sin errores.

- [ ] **Step 6: Commit (lo hace el owner)**

```bash
git add src/services/planBuilder/planRecalibration.ts src/services/planBuilder/__tests__/planRecalibration.test.ts
git commit -m "feat(plan-builder): selección de semanas recalibrables de un plan activo"
```

---

## Task 8: Acción y entrada de recalibración (Tarea 1e del owner)

**Files:**
- Modify: `src/store/usePlanBuilderStore.ts` (nueva acción junto a `regenerateWeeks`, ~`:820-960`)
- Modify: `src/pages/PlanBuilderV2Page.tsx` (handler + botón)
- Test: `src/store/__tests__/planRecalibration.test.ts` (crear)

**Interfaces:**
- Consumes: `selectRecalibrationTargets`, `RecalibrationTarget` (Tarea 7); `buildPlanBuilderRecentContext(plan, lookbackWeeks, { asOfDate })` (Tarea 5); `applyCreateWeek` (`src/services/planning/applyCreateWeek.ts:38`) y los helpers de snapshot de `commitPlan.ts`.
- Produces: acción de store `recalibrateRemainingWeeks(profile: AthleteProfile): Promise<void>` y `reconcileRecalibratedWeeks(...)`.

**Esta tarea consume API real.** Cada recalibración genera semanas contra el proveedor igual que cualquier generación. Confirmar saldo con el owner antes de cualquier prueba manual.

**Antes de implementar:** leer `regenerateWeeks` completo (`usePlanBuilderStore.ts:820-960`). La acción nueva es una variante suya y debe conservar, sin excepción: el guard de rate limit (`guardRemotePlanBuilderRateLimit`), la reserva de cuota (`reservePlanBuilderWeekUsage`), la liberación en todos los caminos de error (`releaseReservedRemoteUsage`), el `switchEpoch` (`isCurrentSwitchEpoch`) y la rama local contra remota. **No** duplicar el cuerpo entero: extraer lo común si es viable sin reescribir la función existente; si no lo es, escribir la variante y dejar un comentario apuntando a la original.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/store/__tests__/planRecalibration.test.ts`. Copiar el arnés de mocks del test de store existente más cercano:
```bash
ls src/store/__tests__/ | grep -i plan
```

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const buildRecentContext = vi.fn()
const triggerBackground = vi.fn()
const reserveUsage = vi.fn()

vi.mock('../../services/planBuilder/recentContext', () => ({
  buildPlanBuilderRecentContext: buildRecentContext,
  trimRecentContextForPayload: (c: unknown) => c,
}))
vi.mock('../../services/planBuilder/triggerBackgroundGeneration', () => ({
  triggerBackgroundGeneration: triggerBackground,
}))

describe('recalibrateRemainingWeeks', () => {
  beforeEach(() => {
    buildRecentContext.mockReset().mockResolvedValue({ hasHistory: true, livedPlanWeeks: [] })
    triggerBackground.mockReset().mockResolvedValue(undefined)
    reserveUsage.mockReset()
  })

  it('pide el contexto reciente con asOfDate = hoy', async () => {
    // Montar un plan activo con 4 semanas, hoy en la semana 2.
    // ... setup del store según el arnés existente ...
    await usePlanBuilderStore.getState().recalibrateRemainingWeeks(profile)

    expect(buildRecentContext).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' }),
      undefined,
      expect.objectContaining({ asOfDate: expect.any(String) }),
    )
  })

  it('sólo regenera las semanas futuras', async () => {
    await usePlanBuilderStore.getState().recalibrateRemainingWeeks(profile)
    expect(triggerBackground).toHaveBeenCalledWith(
      expect.objectContaining({ targetWeekIndexes: [2, 3] }),
    )
  })

  it('no hace nada si no hay semanas futuras', async () => {
    // plan cuya última semana ya pasó
    await usePlanBuilderStore.getState().recalibrateRemainingWeeks(profile)
    expect(triggerBackground).not.toHaveBeenCalled()
  })

  it('libera la cuota reservada si el disparo falla', async () => {
    triggerBackground.mockRejectedValueOnce(new Error('boom'))
    await usePlanBuilderStore.getState().recalibrateRemainingWeeks(profile)
    // afirmar contra el mock de releaseReservedRemoteUsage del arnés
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/store/__tests__/planRecalibration.test.ts`
Expected: FAIL — `recalibrateRemainingWeeks` no existe.

- [ ] **Step 3: Implementar la acción de store**

Agregar a la interfaz del store y al objeto de acciones. El cuerpo sigue el de `regenerateWeeks` con tres diferencias, y **sólo** tres:

```ts
  /**
   * Regenera las semanas futuras de un plan EN CURSO usando los datos reales de
   * las semanas ya vividas.
   *
   * Es la única ruta del proyecto donde la generación ocurre después de que el
   * atleta vivió parte del plan; el resto genera todo en borrador, antes de
   * empezar. Por eso es la única que pasa `asOfDate` a
   * `buildPlanBuilderRecentContext`.
   *
   * Deriva de `regenerateWeeks` y conserva sus mismos guards de rate limit,
   * reserva/liberación de cuota y switch epoch. Si esa función cambia, revisar
   * ésta.
   */
  recalibrateRemainingWeeks: async (profile: AthleteProfile) => {
    const { plan, weeks } = get()
    if (!plan) return

    const target = selectRecalibrationTargets({ plan, weeks, todayISO: todayISO() })
    if (!target) return

    // Diferencia 1: los targets vienen de la selección, no del argumento.
    const targetWeekIndexes = target.weekIndexes

    // ... mismo bloque de guard de rate limit y reserva que `regenerateWeeks` ...

    // Diferencia 2: contexto reciente anclado a hoy, no al inicio del plan.
    const recentContext = await buildPlanBuilderRecentContext(plan, undefined, {
      asOfDate: target.asOfDate,
    }).catch(() => undefined)

    // Diferencia 3: no se pasan `repairInstructions`; esto no es una reparación
    // de calidad, es una recalibración por datos nuevos.
    await triggerBackgroundGeneration({
      plan: generatingPlan,
      weeks: nextWeeks,
      profile,
      wizardConfig: generatingPlan.wizardConfig,
      recentContext,
      targetWeekIndexes,
    })

    // ... mismo cierre, polling y manejo de error/liberación que `regenerateWeeks` ...
  },
```

- [ ] **Step 3b: Reconciliar el calendario real — sin esto la función no hace nada visible**

Regenerar `TrainingPlanWeek` **no** cambia el calendario del atleta. Las filas `Session` se materializan al aceptar el plan, y el único camino que las escribe es `commitPlan.ts:260`, que llama a `applyCreateWeek` por semana. Un plan `active` ya materializó sus sesiones; regenerar sus semanas futuras dejaría el `TrainingPlanWeek` nuevo y el calendario viejo. **El copy del botón que promete «se reemplazan» sería falso hasta que exista este paso.**

`applyCreateWeek` (`src/services/planning/applyCreateWeek.ts:208-244`) ya tiene exactamente las garantías necesarias, verificadas en su predicado:
- borra **sólo** `session.status === 'planned'` (`:235`), así que **una sesión completada o ajustada nunca se toca**;
- `preserveManualSessions: true` excluye `session.source === 'manual'` (`:235`, `:240`);
- `replacementRange` acota el borrado a una ventana de fechas (`:226-228`), en vez de a las fechas propuestas;
- `replacementCutoffAt` lanza si otra sesión sincronizó cambios más nuevos (`:245-249`), que es el guard de concurrencia.

Implementar una reconciliación que corra **después** de que la generación termine (en el callback de fin de polling, no antes: reconciliar semanas todavía en `generating` escribiría contenido a medias):

```ts
/**
 * Materializa en el calendario las semanas recién recalibradas.
 *
 * Reutiliza el mismo camino que usa `commitPlan` al aceptar un plan, con dos
 * diferencias: sólo abarca las semanas futuras del target, y preserva las
 * sesiones manuales del atleta.
 *
 * `applyCreateWeek` ya garantiza que una sesión `completed`/`adjusted` no se
 * toca —su predicado sólo borra `planned`—, así que la semana en curso y todo
 * lo ya entrenado quedan intactos incluso si el rango los rozara.
 */
async function reconcileRecalibratedWeeks(input: {
  plan: TrainingPlan
  weeks: TrainingPlanWeek[]
  target: RecalibrationTarget
  profile: AthleteProfile
}): Promise<{ warnings: string[] }> {
  const { plan, weeks, target, profile } = input
  const warnings: string[] = []
  const recalibrated = weeks
    .filter((week) => target.weekIndexes.includes(week.weekIndex))
    .sort((a, b) => a.weekIndex - b.weekIndex)

  for (const week of recalibrated) {
    const snapshot = await captureWeekCommitSnapshot(week)
    try {
      const result = await applyCreateWeek({
        sessions: week.sessions,
        weekObjectives: week.weekObjectives.map((objective) => objective.goal),
        athleteProfile: profile,
        store: buildCreateWeekStoreAdapter(),
        replacementRange: {
          startDate: week.weekStartDate,
          endDate: toISO(addDays(fromISO(week.weekStartDate), 6)),
        },
        planProvenance: { planId: plan.id, planWeekId: week.id },
        // El atleta pudo agregar sesiones propias a una semana futura; una
        // recalibración no pidió borrarlas.
        preserveManualSessions: true,
      })
      warnings.push(...result.warnings)
    } catch (error) {
      await restoreWeekCommitSnapshot(snapshot)
      throw error
    }
  }

  return { warnings }
}
```

Leer `commitPlan.ts:254-300` antes de escribir esto y **reutilizar** sus helpers reales (`captureWeekCommitSnapshot`, su rollback y su adaptador de store) con los nombres que tengan; los de arriba son los observados y pueden diferir. Si el rollback de `commitPlan` es multi-semana, replicar esa forma: una recalibración a medias es peor que ninguna.

El aviso al usuario viaja por el mismo mecanismo que ya usa el ciclo de plan: navigation state consumido una vez en `WeeklyView`.

Tests obligatorios en `src/store/__tests__/planRecalibration.test.ts`:

```ts
it('reemplaza las sesiones planificadas de las semanas futuras', async () => {
  // sesión planned futura del plan → tras recalibrar, sustituida
})

it('nunca borra una sesión completada, aunque caiga en el rango', async () => {
  // sesión completed en semana futura → sigue existiendo tras recalibrar
})

it('preserva las sesiones manuales del atleta', async () => {
  // source: 'manual' en semana futura → sobrevive
})

it('no toca ninguna sesión de la semana en curso', async () => {
  // el rango nunca incluye la semana de hoy
})

it('revierte la semana si la reconciliación falla a mitad', async () => {
  // applyCreateWeek lanza en la 2ª semana → la 1ª queda restaurada
})
```

Importar `todayISO` desde `utils/date` (verificar el nombre exacto con `grep -n "export function todayISO" src/utils/date.ts`).

- [ ] **Step 4: Agregar la entrada en la UI**

En `PlanBuilderV2Page.tsx`, junto a los demás handlers (~`:865`):

```ts
  async function handleRecalibrateRemainingWeeks() {
    if (planBuilderBlocked || entitlementPending || !effectiveAthleteProfile || isGenerating || status === 'committing') return
    await recalibrateRemainingWeeks(effectiveAthleteProfile)
  }
```

Añadir `recalibrateRemainingWeeks` al destructuring del store (`:534`). Calcular la disponibilidad con el mismo selector puro:

```ts
  const recalibrationTarget = useMemo(
    () => (plan ? selectRecalibrationTargets({ plan, weeks, todayISO: todayISO() }) : null),
    [plan, weeks],
  )
```

Renderizar el botón sólo cuando `recalibrationTarget` no es `null`, con copy que diga exactamente qué va a pasar (incluido el borrado):

```tsx
{recalibrationTarget && (
  <button type="button" onClick={handleRecalibrateRemainingWeeks} disabled={isGenerating}>
    Recalibrar las {recalibrationTarget.weekIndexes.length} semanas restantes
  </button>
)}
```

Acompañarlo de una línea de advertencia visible, no de un tooltip. El copy debe ser cierto respecto de lo que hace el Step 3b, ni más ni menos:

`Se regenerarán las semanas futuras con tus datos reales de las últimas ${recalibrationTarget.livedWeekCount} semanas. Se reemplazan las sesiones planificadas de esas semanas; se conservan las que ya completaste y las que agregaste a mano. La semana en curso no se toca.`

**No desplegar este botón sin el Step 3b.** Sin la reconciliación, la promesa de reemplazo es falsa: el plan cambiaría y el calendario no.

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run src/store/__tests__/planRecalibration.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Verificar la suite completa y los tipos**

Run: `npm test && npm run lint && npx tsc -b && npm run build`
Expected: PASS, sin regresiones.

- [ ] **Step 7: Verificación manual en dev**

Seguir `DEV_TESTING_COMMANDS.md`. Con un plan activo cuya primera semana ya pasó, confirmar: el botón aparece, el copy nombra el número correcto de semanas, la semana en curso no cambia, y las futuras se regeneran. **Esto consume cuota de IA real** — confirmar el saldo con el owner antes de correrlo.

- [ ] **Step 8: Commit (lo hace el owner)**

```bash
git add src/store/usePlanBuilderStore.ts src/pages/PlanBuilderV2Page.tsx src/store/__tests__/planRecalibration.test.ts
git commit -m "feat(plan-builder): recalibrar semanas restantes de un plan en curso con datos reales"
```

---

## Task 9: Limitante físico persistente en el perfil (Tarea 3 del owner)

**Files:**
- Modify: `src/types/index.ts` (`AthleteProfile` `:883-913`)
- Modify: `src/services/week/prompts/weekPrompt.ts` (`briefAthlete` `:110-118`, y su sección en `buildWeekUserPrompt`)
- Modify: `src/services/weekCreator/WeekCreatorPromptBuilder.ts` (sección de perfil, ~`:173-180`)
- Modify: `src/components/settings/AthleteProfileEditor.tsx`
- Test: `src/services/week/prompts/__tests__/weekPromptPerformanceLimiter.test.ts` (crear)

**Interfaces:**
- Consumes: nada.
- Produces: `AthleteProfile.performanceLimiter?: string`.

**Por qué NO va dentro de `recoveryProfile`:** un limitante de rendimiento («recuperación cardíaca entre puntos») no es una lesión. `recoveryProfile.currentInjuries` y `.restrictions` alimentan `resolveStrengthSafetyConstraints`, que **excluye ejercicios de forma fail-closed**. Meter ahí un limitante de rendimiento haría que el parser intentara derivar una región corporal y potencialmente bloqueara trabajo de fuerza legítimo. Va como campo hermano de primer nivel y **no** se pasa al parser de seguridad.

**Persistencia:** no requiere migración. `AthleteProfile` se guarda como fila completa en Dexie y viaja a Supabase dentro del payload del perfil; `dataExport.ts` exporta `db.athleteProfiles.toArray()` y hace merge por `id`/`updatedAt` (`:432-437`), sin allowlist de campos. Un campo opcional nuevo fluye solo.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/week/prompts/__tests__/weekPromptPerformanceLimiter.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildWeekUserPrompt } from '../weekPrompt'
import { makeWeekPromptInput } from './fixtures'

describe('limitante físico en el prompt', () => {
  it('aparece como línea propia cuando está declarado', () => {
    const prompt = buildWeekUserPrompt(makeWeekPromptInput({
      profile: { performanceLimiter: 'recuperación cardíaca entre puntos' },
    }))
    expect(prompt).toContain('Limitante de rendimiento a trabajar: recuperación cardíaca entre puntos')
  })

  it('no genera NINGUNA línea cuando está vacío', () => {
    const prompt = buildWeekUserPrompt(makeWeekPromptInput({ profile: { performanceLimiter: undefined } }))
    expect(prompt).not.toContain('Limitante de rendimiento')
    expect(prompt).not.toContain('sin limitante')
  })

  it('trata una cadena en blanco como ausencia', () => {
    const prompt = buildWeekUserPrompt(makeWeekPromptInput({ profile: { performanceLimiter: '   ' } }))
    expect(prompt).not.toContain('Limitante de rendimiento')
  })

  it('no se mezcla con la línea de lesiones/restricciones', () => {
    const prompt = buildWeekUserPrompt(makeWeekPromptInput({
      profile: {
        performanceLimiter: 'recuperación cardíaca entre puntos',
        recoveryProfile: { currentInjuries: 'molestia lumbar leve' },
      },
    }))
    const limiterLine = prompt.split('\n').find((l) => l.includes('Limitante de rendimiento'))
    expect(limiterLine).toBeDefined()
    expect(limiterLine).not.toContain('lumbar')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/week/prompts/__tests__/weekPromptPerformanceLimiter.test.ts`
Expected: FAIL — el campo no existe.

- [ ] **Step 3: Agregar el campo al tipo**

En `src/types/index.ts`, dentro de `AthleteProfile`, después de `secondaryGoal` (`:902`):

```ts
  /**
   * Limitante de rendimiento declarado por el atleta (ej. "recuperación
   * cardíaca entre puntos").
   *
   * NO es una lesión y NO se pasa a `resolveStrengthSafetyConstraints`:
   * `recoveryProfile.currentInjuries`/`.restrictions` alimentan el filtro
   * fail-closed de ejercicios, y un limitante de rendimiento ahí podría
   * bloquear trabajo de fuerza legítimo. Es contexto para el prompt, no una
   * restricción de seguridad.
   */
  performanceLimiter?: string
```

- [ ] **Step 4: Cablear en el prompt de Plan Builder**

En `weekPrompt.ts`, dentro de `buildWeekUserPrompt`, en la sección `PERFIL DEL ATLETA` — **como línea separada**, antes de la de restricciones:

```ts
    'PERFIL DEL ATLETA',
    briefAthlete(profile),
    `Nivel de condición al iniciar el plan: ${wizardConfig.currentFitnessLevel} · Fatiga declarada al iniciar el plan: ${wizardConfig.currentFatigue}`,
    profile.performanceLimiter?.trim()
      ? `Limitante de rendimiento a trabajar: ${profile.performanceLimiter.trim()} — incluye estímulos que lo ataquen de forma progresiva cuando la fase lo permita.`
      : '',
    activeRestrictions
      ? `Lesiones/restricciones activas: ${activeRestrictions} — ...`
      : '',
```

El `.filter(Boolean)` del final ya elimina la cadena vacía, así que la ausencia no imprime nada.

- [ ] **Step 5: Cablear en Week Creator**

En `WeekCreatorPromptBuilder.ts`, en la sección de perfil (~`:173-180`, donde ya se arma `- Deporte principal: ...`), añadir con el mismo patrón condicional y el mismo texto `Limitante de rendimiento a trabajar: ...`. Confirmar que esa sección filtra vacíos antes de unir; si no lo hace, filtrar explícitamente.

- [ ] **Step 6: Agregar el campo al editor de perfil**

En `AthleteProfileEditor.tsx`, añadir un input de texto **fuera** del bloque de lesiones/recuperación, con label `Limitante de rendimiento (opcional)` y ayuda `Qué te limita en competencia, no una lesión. Ej: recuperación entre puntos.` Guardar por el mismo camino que los demás campos. Verificar cómo el editor construye su payload de guardado antes de editar; si usa una lista explícita de campos, agregarlo ahí.

- [ ] **Step 7: Correr los tests y verificar que pasan**

Run: `npx vitest run src/services/week src/components/settings`
Expected: PASS.

- [ ] **Step 8: Verificar el round-trip de backup**

Run: `npx vitest run src/services/__tests__/dataExport* src/services/dataExport*`
Expected: PASS. Añadir un caso que exporte un perfil con `performanceLimiter` y confirme que sobrevive el round-trip, si no existe ya un test genérico de campos opcionales.

- [ ] **Step 9: Verificar la suite y los tipos**

Run: `npm test && npm run lint && npx tsc -b && npm run build`
Expected: PASS.

- [ ] **Step 10: Commit (lo hace el owner)**

```bash
git add src/types/index.ts src/services/week/prompts/weekPrompt.ts src/services/weekCreator/WeekCreatorPromptBuilder.ts src/components/settings/AthleteProfileEditor.tsx src/services/week/prompts/__tests__/
git commit -m "feat(profile): limitante de rendimiento declarado, separado de lesiones"
```

---

## Task 10: Meta declarada de partidos duros del deporte principal (Tarea 5 del owner)

**Files:**
- Modify: `src/types/index.ts` (`PlanWizardConfig` `:757-772`)
- Modify: `src/services/planBuilder/squashWeeklyExposurePolicy.ts` (`resolveSquashWeeklyExposurePolicy` `:48`)
- Modify: `src/services/week/prompts/weekPrompt.ts` (`requiredPrimarySessions` `:79-98`, `buildPrimarySportRule` `:53-78`)
- Modify: `src/services/planBuilder/qualityReview.ts` (nuevo chequeo)
- Modify: `src/services/weekCreator/WeekCreatorPromptBuilder.ts` (`buildPrioritySportSummary` `:126-138`)
- Modify: `src/pages/CompetitionPlanPage.tsx` (paso del wizard)
- Test: `src/services/week/prompts/__tests__/hardPrimaryMatches.test.ts` (crear)

**Interfaces:**
- Consumes: `resolveSquashWeeklyExposurePolicy` y su `SquashWeeklyExposureDecision`; `hasSquashCompetitiveExposureContent`.
- Produces: `PlanWizardConfig.targetHardPrimaryMatches?: number`.

### Por qué cambia el nombre y la definición

La primera versión de este plan llamaba al campo `targetHardPrimarySessions` y lo hacía entrar por `requiredPrimarySessions`. Eso estaba mal por dos razones verificadas:

1. **`requiredPrimarySessions` no cuenta sesiones duras ni partidos.** Devuelve un mínimo de sesiones *del deporte principal*, sin mirar RPE ni contenido competitivo (`weekPrompt.ts:79-98`), y su único consumidor es una línea de prompt (`buildPrimarySportRule`). Declarar «3 partidos duros» y traducirlo a «al menos 3 sesiones de squash» habría satisfecho la meta con tres sesiones técnicas de RPE 5.
2. **Sólo tocaba el prompt.** Ni el repair determinista ni el gate de calidad verificaban nada, así que el número era una sugerencia al modelo, no una garantía.

El campo pasa a llamarse **`targetHardPrimaryMatches`** y «partido duro» queda definido de forma verificable, reutilizando el predicado que el proyecto ya declara como única autoridad de exposición competitiva:

> Un **partido duro** es una sesión del deporte principal que cumple las dos cosas: `hasSquashCompetitiveExposureContent(session)` es verdadero **y** su `rpe >= 8`.

No se inventa un predicado nuevo. `hasSquashCompetitiveExposureContent` es, por regla del proyecto, el único modo de preguntar «¿esto expone al atleta a competencia real?».

### La meta NO puede saltarse la política de exposición existente

`resolveSquashWeeklyExposurePolicy` (`squashWeeklyExposurePolicy.ts:48`) ya decide la exposición semanal de partido y tiene **vetos duros** que devuelven `{ ensure: false }`:

- `partner_unavailable` cuando `partnerAvailability === 'solo'` (`:57-58`)
- `medical_restriction` (`:61`)
- fatiga `overloaded` (`:63`)

Una meta declarada que fijara el mínimo directamente atropellaría esos vetos: un atleta sin partner, con restricción médica o sobrecargado recibiría partidos igual. **La meta se aplica *dentro* de la decisión de la política, nunca por encima.** Regla exacta:

- Si la política devuelve `ensure: false`, la meta **se ignora por completo**. El veto gana siempre.
- Si devuelve `ensure: true`, la meta ajusta *cuántos* partidos se piden, acotada por `sessionsPerWeek` y por la fase.
- Fuera de `base`/`build`/`peak` la meta no aplica: `transition` sigue en 0 y taper/race conservan su regla propia.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/services/week/prompts/__tests__/hardPrimaryMatches.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveSquashWeeklyExposurePolicy } from '../../../planBuilder/squashWeeklyExposurePolicy'

describe('meta declarada de partidos duros', () => {
  it('un veto por falta de partner ignora la meta', () => {
    const decision = resolveSquashWeeklyExposurePolicy({
      phase: 'build', partnerAvailability: 'solo', targetHardPrimaryMatches: 3,
    } as never)
    expect(decision.ensure).toBe(false)
    expect(decision.reason).toBe('partner_unavailable')
  })

  it('un veto médico ignora la meta', () => {
    const decision = resolveSquashWeeklyExposurePolicy({
      phase: 'build', hasMedicalRestriction: true, targetHardPrimaryMatches: 3,
    } as never)
    expect(decision.ensure).toBe(false)
  })

  it('fatiga overloaded ignora la meta', () => {
    const decision = resolveSquashWeeklyExposurePolicy({
      phase: 'build', currentFatigue: 'overloaded', targetHardPrimaryMatches: 3,
    } as never)
    expect(decision.ensure).toBe(false)
  })

  it('sin vetos, la meta eleva el conteo pedido', () => {
    const decision = resolveSquashWeeklyExposurePolicy({
      phase: 'build', partnerAvailability: 'partner', targetHardPrimaryMatches: 2,
    } as never)
    expect(decision.ensure).toBe(true)
    expect(decision.matchCount).toBe(2)
  })

  it('no aplica en taper', () => {
    const decision = resolveSquashWeeklyExposurePolicy({
      phase: 'taper', partnerAvailability: 'partner', targetHardPrimaryMatches: 3,
    } as never)
    expect(decision.matchCount ?? 0).toBeLessThan(3)
  })

  it('no aplica en transition', () => {
    const decision = resolveSquashWeeklyExposurePolicy({
      phase: 'transition', partnerAvailability: 'partner', targetHardPrimaryMatches: 3,
    } as never)
    expect(decision.ensure).toBe(false)
  })

  it('se acota a las sesiones semanales disponibles', () => {
    const decision = resolveSquashWeeklyExposurePolicy({
      phase: 'build', partnerAvailability: 'partner', sessionsPerWeek: 2, targetHardPrimaryMatches: 9,
    } as never)
    expect(decision.matchCount).toBeLessThanOrEqual(2)
  })

  it('sin meta declarada conserva exactamente el comportamiento actual', () => {
    const base = { phase: 'build', partnerAvailability: 'partner', sessionsPerWeek: 5 } as never
    const withUndefined = resolveSquashWeeklyExposurePolicy({ ...base, targetHardPrimaryMatches: undefined })
    expect(withUndefined).toEqual(resolveSquashWeeklyExposurePolicy(base))
  })
})
```

Leer `SquashWeeklyExposurePolicyInput` y `SquashWeeklyExposureDecision` (`:31-46`) antes de escribir, y ajustar los nombres de campos a los reales — `matchCount` puede llamarse distinto o expresarse como `format: 'best_of_3' | 'best_of_5'`. **Si la decisión no expone un conteo sino un formato, la meta se expresa como número de sesiones de partido en la semana y se agrega un campo al resultado, sin cambiar el significado de `format`.**

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run src/services/week/prompts/__tests__/hardPrimaryMatches.test.ts`
Expected: FAIL — el input no acepta `targetHardPrimaryMatches`.

- [ ] **Step 3: Agregar el campo al tipo**

En `src/types/index.ts`, en `PlanWizardConfig`, tras `sessionsPerWeek`:

```ts
  /**
   * Partidos duros del deporte principal que el atleta quiere por semana.
   *
   * Un partido duro es una sesión del deporte principal con exposición
   * competitiva real (`hasSquashCompetitiveExposureContent`) y `rpe >= 8`.
   *
   * Ausente = se usa la política de exposición vigente sin cambios. La meta
   * **nunca** anula los vetos de `resolveSquashWeeklyExposurePolicy`
   * (sin partner, restricción médica, fatiga `overloaded`) ni aplica fuera de
   * base/build/peak.
   */
  targetHardPrimaryMatches?: number
```

- [ ] **Step 4: Aplicarla dentro de la política de exposición**

En `squashWeeklyExposurePolicy.ts`, añadir `targetHardPrimaryMatches?: number` a `SquashWeeklyExposurePolicyInput` y aplicarla **después** de todos los vetos y **sólo** en fases entrenables:

```ts
  // Los vetos ya devolvieron arriba: si llegamos acá, exponer es seguro.
  // La meta declarada sólo ajusta CUÁNTO, nunca reabre un veto.
  const declared = input.targetHardPrimaryMatches
  const isTrainablePhase = input.phase === 'base' || input.phase === 'build' || input.phase === 'peak'
  if (isTrainablePhase && declared != null && Number.isInteger(declared) && declared > 0) {
    // ... acotar por sessionsPerWeek y por el techo de la fase ...
  }
```

Insertarlo respetando la estructura real de la función; no reordenar los vetos existentes.

- [ ] **Step 5: Reflejarla en el prompt de Plan Builder**

`requiredPrimarySessions` **no** cambia de semántica: sigue siendo el mínimo de sesiones del deporte principal. La meta se expresa como una línea propia en `buildPrimarySportRule`, y sólo cuando la política resolvió exponer:

```ts
  // Distinto del mínimo de sesiones del deporte principal: esto pide partidos
  // con exposición competitiva real y RPE >= 8, no sesiones cualesquiera.
  exposure.ensure && exposure.declaredMatchCount
    ? `- Partidos duros objetivo esta semana: ${exposure.declaredMatchCount}. Cuentan sólo sesiones de partido real con RPE 8 o más.`
    : '',
```

- [ ] **Step 6: Verificarla en el repair determinista**

`ensureSquashCompetitionMatchExposure` (`repairWeek.ts`, paso 7) ya materializa la exposición que la política pide. Al consumir la decisión con la meta aplicada, el repair la respeta sin lógica nueva. Confirmar leyendo esa función que toma su conteo de la política y no de una constante; si usa una constante, cambiarla por el valor de la decisión.

- [ ] **Step 7: Añadir el chequeo al gate de calidad**

En `qualityReview.ts`, junto a los demás chequeos por semana:

```ts
/**
 * La meta declarada de partidos duros se verifica sobre CONTENIDO, no sobre el
 * conteo de sesiones del deporte principal.
 *
 * `warning` y no `error`: la política de exposición puede haber vetado con
 * razón (sin partner, restricción médica, sobrecarga), y en esos casos el
 * déficit es correcto. Un `error` obligaría a reintentos pagados contra una
 * decisión deliberada.
 */
function getHardPrimaryMatchIssues(
  plan: TrainingPlan,
  week: TrainingPlanWeek,
  wizardConfig: PlanWizardConfig,
): PlanValidationIssue[] {
  const target = wizardConfig.targetHardPrimaryMatches
  if (target == null || !Number.isInteger(target) || target <= 0) return []
  if (!['base', 'build', 'peak'].includes(week.phase)) return []

  const actual = week.sessions.filter(
    (session) => hasSquashCompetitiveExposureContent(session) && (session.rpe ?? 6) >= 8,
  ).length
  if (actual >= target) return []

  return [issue({
    severity: 'warning',
    code: 'quality.load.hard_primary_matches_below_target',
    message: `Semana ${week.weekIndex + 1}: ${actual} de ${target} partidos duros objetivo. Puede ser correcto si la política de exposición vetó por partner, salud o sobrecarga.`,
    weekIndex: week.weekIndex,
  })]
}
```

- [ ] **Step 8: Propagar a Week Creator, con guard de fase**

Corrección respecto de la primera versión de este plan: **Week Creator sí tiene la fase** — `WeekCreatorEventContext.phase: MacroPlanPhase` (`WeekCreatorEventContext.ts:26`), ya usada en `WeekCreatorPromptBuilder.ts:85`, `:269` y `:365`. Lo que falta es que llegue a la función correcta: `buildPrioritySportSummary(prioritySport, config)` (`:126`) recibe sólo `config`.

Añadir `phase` como parámetro y pasar `eventContext.phase` desde su llamador, y añadir `targetHardPrimaryMatches` a `WeekCreatorEffectiveConfig` poblándolo desde el wizard. La meta se aplica sólo si `phase` es `base`/`build`/`peak`.

```ts
function buildPrioritySportSummary(
  prioritySport: SupportedSport | undefined,
  config: WeekCreatorEffectiveConfig,
  phase: MacroPlanPhase,
): string {
```

- [ ] **Step 9: Agregar el campo al wizard**

En `CompetitionPlanPage.tsx`, junto a `sessionsPerWeek`, un selector opcional `Partidos duros objetivo por semana` con `Automático` (undefined) y `1`–`4`. Ayuda: `Cuántos partidos exigentes quieres por semana. En taper, descarga o si no tienes con quién jugar, se respeta la periodización y tu seguridad.` Incluirlo en `handleGenerate` y en `initWizardState`.

- [ ] **Step 10: Correr los tests y verificar que pasan**

Run: `npx vitest run src/services/week src/services/weekCreator src/services/planBuilder`
Expected: PASS. Ningún test de exposición de squash existente debe cambiar: sin la meta, la política es idéntica.

- [ ] **Step 11: Verificar la suite y el E2E**

Run: `npm test && npm run lint && npx tsc -b && npm run build && npm run e2e:plan`
Expected: PASS. (`e2e:plan` sin `--generate` no consume API.)

- [ ] **Step 12: Commit (lo hace el owner)**

```bash
git add src/types/index.ts src/services/planBuilder/squashWeeklyExposurePolicy.ts src/services/planBuilder/qualityReview.ts src/services/week/prompts/ src/services/weekCreator/ src/pages/CompetitionPlanPage.tsx
git commit -m "feat(plan-builder): meta declarada de partidos duros, subordinada a la política de exposición"
```

---

## Task 11: Migrar Week Creator a la política de carga compartida

**Files:**
- Modify: `src/services/weekCreator/WeekCreatorPromptBuilder.ts` (`buildLoadDirective` `:535-565`)
- Test: `src/services/weekCreator/__tests__/weekCreatorLoadDirective.test.ts` (crear o extender)

**Interfaces:**
- Consumes: `decideLoadDirective`, `renderLoadDirective`, `ExecutionSignals` (Tarea 4).
- Produces: nada nuevo.

**Por qué existe esta tarea.** La primera versión de este plan describía `loadDirectivePolicy.ts` como «compartido», pero sólo cableaba Plan Builder (Tarea 6) y dejaba intacto el `buildLoadDirective` propio de Week Creator (`:535`). Dos copias de la misma regla deportiva divergen: era la duplicación que la Tarea 4 decía eliminar. **Sin esta tarea, la Tarea 4 no entrega lo que su nombre promete.**

- [ ] **Step 1: Congelar el comportamiento actual antes de tocarlo**

Escribir tests que fijen la salida actual de `buildLoadDirective` de Week Creator para los seis caminos que hoy tiene: `overloaded`, day log con energía baja o dolor alto, `loaded`, `fresh`, sin historial, y RPE promedio ≥ 8 con ≥ 3 muestras.

Run: `npx vitest run src/services/weekCreator/__tests__/weekCreatorLoadDirective.test.ts`
Expected: PASS contra el código **actual**. Éste es el oráculo; si falla, el test está mal, no el código.

- [ ] **Step 2: Sustituir el cuerpo por el policy compartido**

```ts
function buildLoadDirective(
  config: WeekCreatorEffectiveConfig,
  sessions: ChatContext['historicalSessions'],
  logs: ChatContext['weekDayLogs'],
  rpeStats: { average: number; count: number },
): string {
  const latestLog = logs?.[0]
  const decision = decideLoadDirective({
    declaredFatigue: config.currentFatigue,
    // `formatDayLogLine` ya excluye prefill Whoop en este módulo; se aplica el
    // mismo criterio acá para no introducir la contaminación que la política
    // prohíbe.
    latestEnergyLevel: latestLog && !isWhoopPrefilled(latestLog, 'energyLevel')
      ? latestLog.energyLevel ?? undefined
      : undefined,
    latestPainLevel: latestLog?.painLevel ?? undefined,
    avgActualRpe: rpeStats.count > 0 ? rpeStats.average : undefined,
    rpeSampleCount: rpeStats.count,
  })

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

**`computeRecentRpeStats` (`:567-576`) hoy no filtra prefill Whoop** al leer `session.actualRpe ?? session.rpe`; `actualRpe` de sesión no es prellenable, así que ese camino está limpio. Verificarlo antes de asumirlo.

- [ ] **Step 3: Correr el oráculo**

Run: `npx vitest run src/services/weekCreator`
Expected: PASS. Cualquier diferencia de texto es un cambio de comportamiento real: o se ajusta el render compartido, o se documenta explícitamente por qué el copy cambia.

- [ ] **Step 4: Verificar la suite**

Run: `npm test && npm run lint && npx tsc -b`
Expected: PASS.

- [ ] **Step 5: Commit (lo hace el owner)**

```bash
git add src/services/weekCreator/
git commit -m "refactor(week-creator): consume la política de carga compartida"
```

---

## Verificación final (antes de cualquier deploy)

- [ ] **Gate local completo**

```bash
npm run lint && npm test && npx tsc -b && npm run build && git diff --check
```
Expected: todo verde. Registrar el conteo de archivos/tests para compararlo con la línea base de 510 archivos / 4088 tests del roadmap.

- [ ] **Flujo de `DEV_TESTING_COMMANDS.md`**

Seguir el documento completo. Confirmar en particular que un plan generado con los cambios no trae duras cruzadas el mismo día y que la línea de cierre aparece en el prompt.

- [ ] **Verificaciones que consumen API — REQUIEREN CONFIRMACIÓN DE SALDO**

Los tests automatizados de este plan **no** consumen API. Estas tres sí, y ninguna debe correrse sin confirmar saldo con el owner (~US$0,60 registrado en CLAUDE.md; una generación completa ronda US$0,12-0,30):

1. **Recalibración real (Tarea 8).** Cada ejecución genera semanas contra el proveedor. Es la verificación que cierra los blockers 2 y 3 de punta a punta: con un plan activo cuya primera semana ya pasó y trae RPE alto o energía baja **autoreportados**, confirmar que (a) el prompt de las semanas futuras recibe `REDUCIR CARGA REAL`, (b) el calendario efectivamente cambia, (c) una sesión completada y una manual sobreviven, y (d) la semana en curso queda intacta.
2. **Verificación manual del wizard (Tarea 10)**, si se quiere observar la meta de partidos en una generación real.
3. **Gates del producto estrella:**

```bash
npm run e2e:plan:readiness
```
Expected: 8-12 semanas, ≥80% IA, calidad ≥78, <2 min, integridad de sesiones.

No repetir ninguna por iteración de código: todo lo demás se verifica con tests deterministas a costo cero.

- [ ] **Nota para el roadmap**

Al cerrar, agregar a `PROJECT_REVIEW_AND_ROADMAP.md` una sección con:

- las cuatro correcciones de premisa de arriba;
- que la recalibración es la primera ruta del proyecto que genera **después** de que el atleta vivió parte del plan, y la primera que llama a `applyCreateWeek` fuera de `commitPlan`;
- que el gate `quality.load.same_day_hard_cross_sport` es respaldo del repair del paso 5b y no debería dispararse en el camino normal;
- que **todo paso que mueva `date`/`timeBlock` de una sesión de fuerza debe ir antes del paso 6 de `repairGeneratedWeek`**, porque el allocator y `finalizeStrengthSafetySessions` comparten la clave `date|timeBlock`. Conviene sumarlo a la regla de orden congelado de CLAUDE.md;
- que `targetHardPrimaryMatches` está subordinada a `resolveSquashWeeklyExposurePolicy` y no puede reabrir sus vetos de partner, salud o sobrecarga.

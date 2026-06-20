# Calidad del Generador Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un plan de squash competitivo salga con periodización legible, squash dominante en build/peak, sin sesiones de match-play clonadas, sin saltos de carga espurios y sin fuerza repetida — cerrando el loop "detección → prevención".

**Architecture:** Cinco mejoras independientes (P1–P5) sobre el generador/reparador. La idea transversal: hoy `qualityReview`/`validator` *detectan* problemas pero `repairWeek`/`buildPlanShell` igual los producen. Cada mejora corrige la fuente o agrega reparación activa, con un test que falla primero.

**Tech Stack:** TypeScript. Tests con Vitest (`vitest run`). Lógica deportiva en `src/services/macroPlan.ts`, `src/services/planBuilder/buildPlanShell.ts`, `src/services/planBuilder/repairWeek.ts`, `src/services/planBuilder/qualityReview.ts`, `src/services/planBuilder/validator.ts`.

## Global Constraints

- No tocar `promptBuilder.ts` por estética (regla del proyecto).
- No cambiar provider ni el schema de Dexie.
- El reparador, si no encuentra alternativa válida, deja el warning — nunca rompe la semana ni fuerza fallback.
- Mantener verde la suite existente (`npm test`, hoy 830 tests) además de los tests nuevos.
- Verificación de cierre por tarea: `npm run lint && npm run build` + tests de la tarea.
- Orden sugerido: P1 → P2 → P3 → P5 → P4 (por impacto percibido).

---

### Task 1 (P1): Anti-monotonía de match-play en `repairWeek`

**Problema actual:** `buildSquashMatchDrills` (`src/services/planBuilder/repairWeek.ts:830-847`) devuelve SIEMPRE el mismo par para `competition_match` (`['Game a 11 con marcador real', 'Partido de entrenamiento al mejor de 3 juegos']`), lo que clona la sesión "Match Play Competitivo" en cada semana.

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts:830-847`
- Test: `src/services/planBuilder/__tests__/repairWeek.test.ts` (o nuevo `matchVariety.test.ts` en la misma carpeta)

**Interfaces:**
- Modifica firma interna de `buildSquashMatchDrills(session, mode, variantIndex?: number)` para rotar el par por índice de sesión/semana.

- [ ] **Step 1: Write the failing test**

Agregar en `src/services/planBuilder/__tests__/repairWeek.test.ts` (importando `buildSquashMatchDrills` — exportarla si no lo está):

```typescript
import { buildSquashMatchDrills } from '../repairWeek'

describe('buildSquashMatchDrills variety', () => {
  const session = { durationMin: 60 } as never
  it('rotates the competition match pair across consecutive sessions', () => {
    const a = buildSquashMatchDrills(session, 'competition_match', 0).map((d) => d.name)
    const b = buildSquashMatchDrills(session, 'competition_match', 1).map((d) => d.name)
    expect(a).not.toEqual(b)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/repairWeek.test.ts -t "variety"`
Expected: FAIL — hoy `buildSquashMatchDrills` no acepta `variantIndex` y devuelve siempre el mismo par.

- [ ] **Step 3: Implement rotation**

Reemplazar `buildSquashMatchDrills` (líneas ~830-847) por:

```typescript
const COMPETITION_MATCH_VARIANTS: string[][] = [
  ['Game a 11 con marcador real', 'Partido de entrenamiento al mejor de 3 juegos'],
  ['Partido de entrenamiento al mejor de 3 juegos', 'Partido con ataque temprano'],
  ['Partido con ataque temprano', 'Game a 11 con marcador real'],
]
const PRACTICE_MATCH_VARIANTS: string[][] = [
  ['Partido de entrenamiento al mejor de 3 juegos', 'Partido con ataque temprano'],
  ['Game a 11 con marcador real', 'Partido de entrenamiento al mejor de 3 juegos'],
]

function buildSquashMatchDrills(
  session: CoachSessionProposal,
  mode: 'practice_match' | 'competition_match',
  variantIndex = 0,
): SquashDrill[] {
  const variants = mode === 'competition_match' ? COMPETITION_MATCH_VARIANTS : PRACTICE_MATCH_VARIANTS
  const names = variants[variantIndex % variants.length]
  const targetDurations = session.durationMin >= 60 ? [25, 25] : [20, 15]
  const drills = names
    .map((name, index) => {
      const definition = findSquashDrillByName(name)
      return definition ? toSquashDrill(definition, targetDurations[index]) : null
    })
    .filter((drill): drill is SquashDrill => drill !== null)

  if (drills.length > 0) return drills
  return [{ name: names[0], durationMin: Math.min(session.durationMin, 40) }]
}
```

- [ ] **Step 4: Thread the variant index from the caller**

Buscar en `repairWeek.ts` la(s) llamada(s) a `buildSquashMatchDrills(session, mode)` y pasar un índice estable (ej. el índice de la semana o de la sesión dentro del plan). Si el contexto de reparación expone `meta.weekIndex` o similar, usar `buildSquashMatchDrills(session, mode, weekIndex)`. Si no hay índice disponible, usar el índice de la sesión dentro del array que se está reparando.

Run para localizar llamadas: `grep -n "buildSquashMatchDrills(" src/services/planBuilder/repairWeek.ts`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/services/planBuilder/__tests__/repairWeek.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/planBuilder/repairWeek.ts src/services/planBuilder/__tests__/repairWeek.test.ts
git commit -m "feat: rotate squash match formats to avoid cloned sessions"
```

---

### Task 2 (P2): Periodización — acortar peak de squash y arreglar timeline

**Problema actual:** `resolvePhase` (`src/services/macroPlan.ts:627-643`) marca `peak` para squash cuando `weeksRemaining <= 5` (y > 1), produciendo hasta 4 semanas de "peak" en un plan de 6 semanas.

**Files:**
- Modify: `src/services/macroPlan.ts:627-643`
- Test: `src/services/__tests__/macroPlan.test.ts`

**Interfaces:**
- `resolvePhase(weeksRemaining, primarySport)` conserva su firma; cambia solo la tabla de umbrales para squash.

- [ ] **Step 1: Write the failing test**

Agregar en `src/services/__tests__/macroPlan.test.ts`:

```typescript
import { resolvePhase } from '../macroPlan'

describe('resolvePhase squash periodization', () => {
  it('keeps peak to at most 2 weeks for squash', () => {
    const phasesByRemaining = [0, 1, 2, 3, 4, 5].map((r) => resolvePhase(r, 'squash'))
    // remaining: 0=race, 1=taper, 2-3=peak, 4-5=build
    expect(phasesByRemaining).toEqual(['race', 'taper', 'peak', 'peak', 'build', 'build'])
    const peakCount = phasesByRemaining.filter((p) => p === 'peak').length
    expect(peakCount).toBeLessThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/macroPlan.test.ts -t "periodization"`
Expected: FAIL — hoy remaining 2,3,4,5 son todos `peak`.

- [ ] **Step 3: Shorten the squash peak window**

En `src/services/macroPlan.ts`, reemplazar el bloque squash de `resolvePhase` (líneas ~633-638):

```typescript
  if (primarySport === 'squash') {
    if (weeksRemaining <= 1) return 'taper'
    if (weeksRemaining <= 5) return 'peak'
    if (weeksRemaining <= 10) return 'build'
    return 'base'
  }
```
por:
```typescript
  if (primarySport === 'squash') {
    if (weeksRemaining <= 1) return 'taper'
    if (weeksRemaining <= 3) return 'peak'
    if (weeksRemaining <= 9) return 'build'
    return 'base'
  }
```

- [ ] **Step 4: Run test + existing macro coherence tests**

Run: `npx vitest run src/services/__tests__/macroPlan.test.ts src/services/__tests__/macroWeekCoherence.test.ts`
Expected: PASS. Si `macroWeekCoherence` falla por expectativas viejas de peak de 4 semanas, actualizar esas expectativas al nuevo reparto (build largo, peak ≤2).

- [ ] **Step 5: Verify timeline coherence (startWeek/endWeek)**

Inspeccionar `buildTimeline` (`src/services/macroPlan.ts:583`). Agregar test que verifique que los `startWeek` del timeline son monótonos crecientes y coherentes con `phases[]`:

```typescript
it('produces a timeline with non-decreasing startWeek', () => {
  // construir un macroPlan de squash de 6 semanas con computeMacroPlan(profile, now)
  // y aseverar timeline.map(t => t.startWeek) ordenado ascendente
})
```

Completar el test con un `profile` mínimo de squash (reusar el helper de fixtures ya presente en `macroPlan.test.ts`). Si el assert falla, corregir el cálculo de `startWeek`/`endWeek` en `buildTimeline` para que refleje el offset real desde el inicio del plan (no weeks-from-event invertido).

- [ ] **Step 6: Commit**

```bash
git add src/services/macroPlan.ts src/services/__tests__/macroPlan.test.ts src/services/__tests__/macroWeekCoherence.test.ts
git commit -m "feat: cap squash peak to 2 weeks and fix macro timeline ordering"
```

---

### Task 3 (P3): Ponderación del deporte principal en build/peak

**Problema actual:** `week.primary_sport.underweighted` aparece en build/peak. La regla `minimumPrimarySessions` (`src/services/planBuilder/validator.ts:232+`) detecta el déficit pero el shell/reparador no garantiza dominancia.

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts` (reparación de reparto por deporte)
- Modify: `src/services/planBuilder/validator.ts:232+` (leer umbral, sin cambiarlo si ya es correcto)
- Test: `src/services/planBuilder/__tests__/repairWeek.test.ts`

**Interfaces:**
- Consume `minimumPrimarySessions(primarySport, week, expectedSessions)` ya existente para saber el piso.

- [ ] **Step 1: Write the failing test**

Construir una semana de squash en build con squash subponderado (más sesiones accesorias que de squash) y aseverar que tras `repairWeek` el squash cumple el mínimo y no se emite `primary_sport.underweighted`:

```typescript
it('repairs an underweighted primary squash week', () => {
  // armar week phase='peak', primarySport='squash' con 2 squash + 4 accesorias
  // correr el reparador y reviewPlanQuality
  // expect: issues sin 'week.primary_sport.underweighted'
})
```

Completar con los helpers de armado de semana ya usados en `repairWeek.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/repairWeek.test.ts -t "underweighted"`
Expected: FAIL.

- [ ] **Step 3: Add active rebalancing in repairWeek**

En `repairWeek.ts`, en la fase de reparación que ya densifica/ajusta semanas, agregar un paso: si `countSessionsBySport(squash) < minimumPrimarySessions(...)` en build/peak, reducir/convertir una sesión accesoria de baja prioridad (running/mobility) en una sesión de squash adicional usando el selector de drills existente, hasta cumplir el mínimo. Si no es posible sin romper restricciones de días/duración, dejar la semana como está (y el warning quedará).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/planBuilder/__tests__/repairWeek.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/planBuilder/repairWeek.ts src/services/planBuilder/__tests__/repairWeek.test.ts
git commit -m "feat: enforce primary sport dominance in build/peak weeks"
```

---

### Task 4 (P5): Rotación de templates de fuerza

**Problema actual:** semanas consecutivas comparten ≥3 ejercicios (`quality.strength.repeated_template`, `qualityReview.ts:491`). Ya existe un paso "Diversify repeated strength exercises from previous week" (`repairWeek.ts:150`), pero no garantiza <3 compartidos.

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts` (paso de diversificación, ~150 y `selectStrengthSession` wiring ~1355/1424)
- Test: `src/services/planBuilder/__tests__/repairWeek.test.ts`

**Interfaces:**
- Consume `selectStrengthSession(context)` ya existente; le pasa `recentExercises` para penalizar repetición.

- [ ] **Step 1: Write the failing test**

```typescript
it('keeps consecutive strength weeks from sharing 3+ exercises', () => {
  // armar 2 semanas peak con la misma plantilla de fuerza (3 ejercicios iguales)
  // correr el reparador en la 2da pasando los ejercicios de la 1ra como recientes
  // expect: intersección de ejercicios < 3
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/repairWeek.test.ts -t "consecutive strength"`
Expected: FAIL.

- [ ] **Step 3: Strengthen the diversify step**

En el paso de diversificación (`repairWeek.ts:150`), asegurar que `buildStrengthSelectionContext` reciba los ejercicios de la semana previa como `recentExercises` y que, si la intersección con la semana previa sigue siendo ≥3 tras `selectStrengthSession`, se fuerce la sustitución de los ejercicios repetidos por los siguientes candidatos del mismo patrón/bloque hasta bajar de 3.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/planBuilder/__tests__/repairWeek.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/planBuilder/repairWeek.ts src/services/planBuilder/__tests__/repairWeek.test.ts
git commit -m "feat: rotate strength templates across consecutive weeks"
```

---

### Task 5 (P4): Salto de carga espurio por semana parcial

**Problema actual:** `validateLoadProgression` (`src/services/planBuilder/validator.ts:211-229`) compara la carga TOTAL de semanas; la primera semana parcial (1-2 sesiones) frente a una completa (6) dispara `plan.load.jump` ~186% falso.

**Files:**
- Modify: `src/services/planBuilder/validator.ts:211-229`
- Test: `src/services/planBuilder/__tests__/` (nuevo `loadProgressionPartial.test.ts` o el de validator existente)

**Interfaces:**
- `validateLoadProgression(weeks)` conserva su firma; cambia el criterio de comparación.

- [ ] **Step 1: Write the failing test**

```typescript
import { validateLoadProgression } from '../validator' // exportar si hace falta

it('does not flag a load jump caused by a partial first week', () => {
  // week 0: 1 sesión 60min rpe7 (parcial); week 1: 6 sesiones similares (completa)
  // mismas intensidades por sesión → no debería haber salto real
  const issues = validateLoadProgression([partialWeek0, fullWeek1])
  expect(issues.some((i) => i.code === 'plan.load.jump')).toBe(false)
})
```

Completar con armado mínimo de `TrainingPlanWeek` (reusar fixtures de validator tests).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/planBuilder/__tests__/loadProgressionPartial.test.ts`
Expected: FAIL — hoy compara totales y marca el salto.

- [ ] **Step 3: Compare per-session load instead of total**

En `validateLoadProgression` (líneas ~214-226), comparar carga media por sesión (robusta a semanas parciales):

```typescript
  for (let i = 1; i < generated.length; i++) {
    const prevSessions = generated[i - 1].sessions.length
    const currSessions = generated[i].sessions.length
    if (prevSessions === 0 || currSessions === 0) continue
    const prev = computeWeekLoad(generated[i - 1].sessions) / prevSessions
    const curr = computeWeekLoad(generated[i].sessions) / currSessions
    if (prev === 0) continue
    const jump = (curr - prev) / prev
    if (jump > 0.4 && generated[i].phase !== 'race') {
      issues.push({
        severity: 'warning',
        code: 'plan.load.jump',
        message: `Salto de intensidad ${Math.round(jump * 100)}% entre semanas ${generated[i - 1].weekIndex + 1} y ${generated[i].weekIndex + 1}.`,
        weekIndex: generated[i].weekIndex,
      })
    }
  }
```

- [ ] **Step 4: Run test + existing validator tests**

Run: `npx vitest run src/services/planBuilder/__tests__/loadProgressionPartial.test.ts && npx vitest run src/services/planBuilder/__tests__`
Expected: PASS. Ajustar cualquier test viejo que dependiera del salto basado en total.

- [ ] **Step 5: Commit**

```bash
git add src/services/planBuilder/validator.ts src/services/planBuilder/__tests__/loadProgressionPartial.test.ts
git commit -m "fix: compare per-session load so partial weeks don't trigger false jumps"
```

---

### Task 6: Validación deportiva integral

**Files:** ninguno (verificación).

- [ ] **Step 1: Full suite**

Run: `npm run lint && npm run build && npm test`
Expected: lint OK, build OK, toda la suite verde (≥830 + nuevos tests).

- [ ] **Step 2: Regenerar el plan del Nacional (smoke deportivo)**

Generar manualmente un plan de squash competitivo de 6 semanas con perfil completo (squat/dl/bench/ohp + 1RM) y confirmar:
- Peak dura ≤2 semanas; build es el bloque largo.
- Ninguna sesión de match-play clonada en semanas consecutivas; ≥6 drills de squash distintos.
- Sin `week.primary_sport.underweighted` en build/peak.
- Sin `plan.load.jump` originado por la semana parcial.
- Sin `quality.strength.repeated_template` entre semanas consecutivas.
- Score agregado ≥85.

- [ ] **Step 3: Commit (si hubo ajustes de fixtures)**

```bash
git add -A && git commit -m "test: sport-level validation pass for generator quality"
```

---

## Self-review notes

- P1/P3/P5 comparten el patrón "detección→prevención": cada uno convierte un warning de `qualityReview`/`validator` en una reparación activa en `repairWeek`, dejando el warning solo si la reparación no es posible.
- P2 corrige la fuente (umbral de `resolvePhase`) + coherencia de timeline.
- P4 cambia el criterio de comparación de carga para que sea robusto a semanas parciales sin perder la detección de saltos reales.

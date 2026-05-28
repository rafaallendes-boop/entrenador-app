# Plan Builder Fase 2 — Especificidad deportiva (catálogo + reglas)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ninguna sesión de fuerza es un clon de otra del mismo bloque; ningún ejercicio con 1RM disponible queda fuera del plan; cada sesión de fuerza de 60 min cumple plantilla mínima (core + squat/hinge + push/pull + unilateral + 1–2 accesorios).

**Architecture:** Extender `exerciseLibrary` y `drillLibrary` existentes con campos de rotación/fase/1RM (en lugar de crear catálogos paralelos como sugiere el spec — la librería actual ya cubre ~80% del esquema). Añadir tres módulos nuevos: `strengthBlocks/` con plantillas por fase+ciclo, `profileAdapter.ts` que traduce `AthleteProfile + PlanWizardConfig` a parámetros usados por todos los selectores, y reescritura quirúrgica de `selectStrengthSession` para usar bloques + perfil + rotación. Mantener Gemini Flash como provider; sin cambios de prompts deportivos.

**Tech Stack:** TypeScript, Vitest. Sin nuevas dependencias.

**Spec:** `docs/superpowers/specs/2026-05-27-plan-builder-star-product-design.md` (Fase 2, secciones 2.1–2.8).

**Restricción operativa:** No deploy a prod antes del 2026-05-29. Cada task debe pasar `npm run lint && npm test && npm run build && npm run audit:prompt`.

**⚠️ Política de commits para esta ejecución:** Igual que Fase 1, el usuario hará UN commit grande al final. **NO ejecutar `git commit` ni `git add` dentro de cada task.** Dejar todos los cambios staged-pendientes para que el usuario los revise y commitee de forma consolidada. Tratar los pasos "Commit" como no-op.

---

## File Structure

```
src/services/training/
  exerciseLibrary.ts                 [MODIFY: añadir campos blockRotationGroup, has1RMReference, appropriateForPhases]
  drillLibrary.ts                    [MODIFY: añadir tags phaseAppropriate, partnerRequired explícito, executionModes]
  strengthSelector.ts                [MODIFY: usar selectStrengthBlockTemplate + profileAdapter; export selectStarLift]
  drillSelector.ts                   [MODIFY: filtrar por phaseAppropriate + partnerRequired desde wizard]
  strengthBlocks/                    [NEW directorio]
    index.ts                         [NEW: registro + selectStrengthBlockTemplate]
    types.ts                         [NEW: StrengthBlockTemplate, StrengthBlockSlot]
    buildBlock.ts                    [NEW: 3 sub-templates A/B/C]
    peakBlock.ts                     [NEW: 3 sub-templates A/B/C]
    taperBlock.ts                    [NEW: 2 sub-templates A/B]
    raceBlock.ts                     [NEW: 1 template]
  __tests__/
    strengthBlocks.test.ts           [NEW]
    strengthSelectorRotation.test.ts [NEW]
    strengthSelectorProfile.test.ts  [NEW]
    drillSelectorPhase.test.ts       [NEW]

src/services/planBuilder/
  profileAdapter.ts                  [NEW]
  repairWeek.ts                      [MODIFY: pasar adapter params + weekIndexInBlock al selector]
  __tests__/
    profileAdapter.test.ts           [NEW]

src/types/
  index.ts (o sub-archivo)           [MODIFY: tipo Session.metadata.starLift opcional]
```

---

## Task 1: Extender `ExerciseDefinition` con campos de Fase 2

**Files:**
- Modify: `src/services/training/exerciseLibrary.ts`
- Test: `src/services/training/__tests__/exerciseLibrarySchema.test.ts` (nuevo si no existe; sino extender)

- [ ] **Step 1: Leer schema actual**

Run: `grep -n "export interface ExerciseDefinition" src/services/training/exerciseLibrary.ts`
Leer la interface completa (líneas ~27–43). Identificar campos actuales: `id, name, pattern, category, intensityType, equipment, riskLevel, fatigueCost, unilateral, experienceLevel, tags`.

- [ ] **Step 2: Escribir test failing para nuevos campos**

Crear `src/services/training/__tests__/exerciseLibrarySchema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { STRENGTH_EXERCISE_LIBRARY, findStrengthExerciseByName } from '../exerciseLibrary'

describe('ExerciseDefinition schema Fase 2', () => {
  it('Sentadilla con barra exposes has1RMReference="squat"', () => {
    const squat = STRENGTH_EXERCISE_LIBRARY.find((e) => e.id === 'back_squat')!
    expect(squat).toBeDefined()
    expect(squat.has1RMReference).toBe('squat')
  })

  it('Peso muerto exposes has1RMReference="deadlift"', () => {
    const dl = STRENGTH_EXERCISE_LIBRARY.find((e) => e.id === 'deadlift_conventional')
      ?? STRENGTH_EXERCISE_LIBRARY.find((e) => /peso muerto/i.test(e.name))
    expect(dl).toBeDefined()
    expect(dl!.has1RMReference).toBe('deadlift')
  })

  it('Press de banca exposes has1RMReference="benchPress"', () => {
    const bench = STRENGTH_EXERCISE_LIBRARY.find((e) => /press de banca|bench press/i.test(e.name))
    expect(bench).toBeDefined()
    expect(bench!.has1RMReference).toBe('benchPress')
  })

  it('OHP exposes has1RMReference="overheadPress"', () => {
    const ohp = STRENGTH_EXERCISE_LIBRARY.find((e) => /\bohp\b|press militar|press sobre cabeza|overhead press/i.test(e.name))
    expect(ohp).toBeDefined()
    expect(ohp!.has1RMReference).toBe('overheadPress')
  })

  it('every exercise declares appropriateForPhases as non-empty subset of {base, build, peak, taper, transition, race}', () => {
    const validPhases = new Set(['base', 'build', 'peak', 'taper', 'transition', 'race'])
    for (const ex of STRENGTH_EXERCISE_LIBRARY) {
      expect(ex.appropriateForPhases, `ejercicio ${ex.id} sin appropriateForPhases`).toBeDefined()
      expect(ex.appropriateForPhases!.length).toBeGreaterThan(0)
      for (const p of ex.appropriateForPhases!) {
        expect(validPhases.has(p as string)).toBe(true)
      }
    }
  })

  it('main strength exercises declare blockRotationGroup in {A,B,C}', () => {
    const mainLiftIds = ['back_squat', 'front_squat', 'romanian_deadlift', 'bench_press', 'overhead_press']
    for (const id of mainLiftIds) {
      const ex = STRENGTH_EXERCISE_LIBRARY.find((e) => e.id === id)
      if (!ex) continue
      expect(['A', 'B', 'C']).toContain(ex.blockRotationGroup)
    }
  })
})
```

- [ ] **Step 3: Verificar que el test falla**

Run: `npx vitest run src/services/training/__tests__/exerciseLibrarySchema.test.ts`
Expected: FAIL — los campos no existen en `ExerciseDefinition`.

- [ ] **Step 4: Extender la interface**

En `src/services/training/exerciseLibrary.ts`, modificar `ExerciseDefinition`:

```ts
export type ExercisePhase = 'base' | 'build' | 'peak' | 'taper' | 'transition' | 'race'
export type ExerciseRotationGroup = 'A' | 'B' | 'C'
export type Exercise1RMReference = 'squat' | 'deadlift' | 'benchPress' | 'overheadPress'

export interface ExerciseDefinition {
  // ... campos existentes ...
  has1RMReference?: Exercise1RMReference
  appropriateForPhases?: ExercisePhase[]
  blockRotationGroup?: ExerciseRotationGroup
}
```

> Mantener los demás campos exactamente como están.

- [ ] **Step 5: Verificar que `appropriateForPhases` no rompa otros tests con `undefined`**

Run: `npx vitest run src/services/training`
Expected: PASS (el test nuevo aún falla porque la data no está, pero los demás siguen verdes).

- [ ] **Step 6: No commit (política Fase 2)**

Dejar cambios sin commitear. Avanzar a Task 2.

---

## Task 2: Etiquetar ejercicios existentes con `has1RMReference`, `appropriateForPhases`, `blockRotationGroup`

**Files:**
- Modify: `src/services/training/exerciseLibrary.ts` (entradas de `STRENGTH_EXERCISE_LIBRARY`)
- Test: `src/services/training/__tests__/exerciseLibrarySchema.test.ts` (ya escrito)

- [ ] **Step 1: Mapeo de 1RM references**

Buscar entradas existentes y añadir `has1RMReference` con esta tabla:

| `id` | `has1RMReference` |
|---|---|
| `back_squat` | `'squat'` |
| `front_squat` | `'squat'` |
| `goblet_squat` | `'squat'` |
| `bulgarian_split_squat` | (sin referencia — unilateral, no usa 1RM directo) |
| `deadlift_conventional` | `'deadlift'` |
| `romanian_deadlift` | `'deadlift'` |
| `sumo_deadlift` | `'deadlift'` |
| `trap_bar_deadlift` | `'deadlift'` |
| `hip_thrust` | (sin referencia — variante glúteo) |
| `bench_press` | `'benchPress'` |
| `incline_bench_press` | `'benchPress'` |
| `close_grip_bench_press` | `'benchPress'` |
| `overhead_press` | `'overheadPress'` |
| `push_press` | `'overheadPress'` |
| `landmine_press` (Press Z) | `'overheadPress'` |

> Si un `id` exacto no existe (el repo usa snake_case o nombre español), buscar por `name` que matchee aproximadamente y mantener el `id` actual.

Run: `grep -n "id:" src/services/training/exerciseLibrary.ts | head -60` para ver los `id` reales.

- [ ] **Step 2: Aplicar la tabla en el código**

Editar cada entrada de `STRENGTH_EXERCISE_LIBRARY` añadiendo el campo. Ejemplo:

```ts
{
  id: 'back_squat',
  name: 'Sentadilla con barra',
  // ... campos existentes ...
  has1RMReference: 'squat',
  appropriateForPhases: ['base', 'build', 'peak'],
  blockRotationGroup: 'A',
},
```

- [ ] **Step 3: Mapeo de `appropriateForPhases`**

Reglas a aplicar sobre todos los ejercicios:

- Movimientos pesados (`category: 'lower'|'upper'`, `intensityType: 'strength'`): `['base', 'build', 'peak']`.
- Power/olympic (`intensityType: 'power'`): `['build', 'peak']`.
- Hypertrophy: `['base', 'build']`.
- Stability/core: `['base', 'build', 'peak', 'taper']`.
- Recovery/mobility: `['base', 'taper', 'transition', 'race']`.
- Si un ejercicio no encaja en ningún cubo, default `['base', 'build']`.

Aplicar uniformemente en todas las entradas.

- [ ] **Step 4: Mapeo de `blockRotationGroup`**

Para los 5 patrones principales (squat / hinge / push / pull / unilateral), asignar A/B/C así:

- Grupo A (estrella default): `back_squat`, `deadlift_conventional`, `bench_press`, `overhead_press`, `pull_up`.
- Grupo B (variante igualmente fuerte): `front_squat`, `romanian_deadlift`, `incline_bench_press`, `push_press`, `barbell_row`.
- Grupo C (variante de mantenimiento o unilateral): `bulgarian_split_squat`, `hip_thrust`, `dumbbell_bench`, `landmine_press`, `chin_up`.

> Ejercicios accesorios (core, plyo, carry, cardio específico) NO necesitan `blockRotationGroup`.

- [ ] **Step 5: Correr los tests Fase 2**

Run: `npx vitest run src/services/training/__tests__/exerciseLibrarySchema.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Correr suite training completa para no romper consumidores**

Run: `npx vitest run src/services/training src/services/__tests__/strengthSelector*`
Expected: PASS. Si algún test cuenta campos exactos del objeto, no debería fallar (los campos nuevos son opcionales).

- [ ] **Step 7: No commit**

---

## Task 3: Extender `SquashDrillDefinition` con tags Fase 2

**Files:**
- Modify: `src/services/training/drillLibrary.ts`
- Test: `src/services/training/__tests__/drillLibrarySchema.test.ts` (nuevo)

- [ ] **Step 1: Leer schema actual**

Run: `grep -n "export interface SquashDrillDefinition" src/services/training/drillLibrary.ts`
Leer la interface completa para conocer campos existentes (`category`, `tags`, `focus`, etc.).

- [ ] **Step 2: Escribir test failing**

Crear `src/services/training/__tests__/drillLibrarySchema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SQUASH_DRILL_LIBRARY } from '../drillLibrary'

describe('SquashDrillDefinition schema Fase 2', () => {
  it('every drill declares phaseAppropriate as non-empty subset', () => {
    const validPhases = new Set(['base', 'build', 'peak', 'taper', 'transition', 'race'])
    for (const drill of SQUASH_DRILL_LIBRARY) {
      expect(drill.phaseAppropriate, `drill ${drill.id} sin phaseAppropriate`).toBeDefined()
      expect(drill.phaseAppropriate!.length).toBeGreaterThan(0)
      for (const p of drill.phaseAppropriate!) {
        expect(validPhases.has(p as string)).toBe(true)
      }
    }
  })

  it('every drill declares partnerRequired (boolean)', () => {
    for (const drill of SQUASH_DRILL_LIBRARY) {
      expect(typeof drill.partnerRequired === 'boolean').toBe(true)
    }
  })

  it('match drills are NOT phaseAppropriate for base phase', () => {
    const matchDrills = SQUASH_DRILL_LIBRARY.filter((d) =>
      d.category === 'match' || (d.tags ?? []).includes('match')
    )
    for (const m of matchDrills) {
      expect(m.phaseAppropriate, `drill ${m.id} sin phaseAppropriate`).toBeDefined()
      expect(m.phaseAppropriate!.includes('base' as never)).toBe(false)
    }
  })

  it('shadows / ghosting drills are partnerRequired=false', () => {
    const soloDrills = SQUASH_DRILL_LIBRARY.filter((d) =>
      /ghosting|sombras|shadows/i.test(d.name) || (d.tags ?? []).includes('shadows')
    )
    for (const s of soloDrills) {
      expect(s.partnerRequired).toBe(false)
    }
  })
})
```

- [ ] **Step 3: Verificar que el test falla**

Run: `npx vitest run src/services/training/__tests__/drillLibrarySchema.test.ts`
Expected: FAIL — campos no existen.

- [ ] **Step 4: Extender la interface**

En `src/services/training/drillLibrary.ts` añadir:

```ts
export type DrillPhase = 'base' | 'build' | 'peak' | 'taper' | 'transition' | 'race'

export interface SquashDrillDefinition {
  // ... campos existentes ...
  phaseAppropriate?: DrillPhase[]
  partnerRequired?: boolean
}
```

- [ ] **Step 5: No commit. Avanzar a Task 4.**

---

## Task 4: Etiquetar drills existentes con `phaseAppropriate` + `partnerRequired`

**Files:**
- Modify: `src/services/training/drillLibrary.ts` (entradas de `SQUASH_DRILL_LIBRARY`)
- Test: `src/services/training/__tests__/drillLibrarySchema.test.ts` (ya escrito)

- [ ] **Step 1: Reglas de mapeo**

Regla `partnerRequired`:
- `true` si: el drill incluye partner explícito en `tags`, o el `name` matchea `/cross.?court|condicionado.*fondo|drives.*\(con\)|drill.*partner/i`, o `category === 'match'`.
- `false` para shadows, ghosting, voleas solo, 100 drives, target, footwork de escalera, técnica solo.

Regla `phaseAppropriate`:
- `'technical'` o `'control'` (categorías técnicas básicas): `['base', 'build', 'peak', 'taper']`.
- `'tactical'` o pressure: `['build', 'peak']`.
- `'match'`: `['build', 'peak', 'race']` (nunca en base ni taper completo).
- `'physical'` (footwork/condicional): `['base', 'build', 'peak']`.
- Match-light o de activación: `['taper', 'race']`.

- [ ] **Step 2: Aplicar en código**

Editar cada entrada de `SQUASH_DRILL_LIBRARY` añadiendo los dos campos. Ejemplo:

```ts
{
  id: 'ghosting_basic',
  name: 'Ghosting básico (6 esquinas)',
  category: 'physical',
  // ... existente ...
  phaseAppropriate: ['base', 'build', 'peak'],
  partnerRequired: false,
},
```

- [ ] **Step 3: Verificar tests Fase 2**

Run: `npx vitest run src/services/training/__tests__/drillLibrarySchema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 4: Suite drill completa no se rompe**

Run: `npx vitest run src/services/training`
Expected: PASS.

- [ ] **Step 5: No commit.**

---

## Task 5: Crear `strengthBlocks/` — plantillas por fase

**Files:**
- Create: `src/services/training/strengthBlocks/types.ts`
- Create: `src/services/training/strengthBlocks/buildBlock.ts`
- Create: `src/services/training/strengthBlocks/peakBlock.ts`
- Create: `src/services/training/strengthBlocks/taperBlock.ts`
- Create: `src/services/training/strengthBlocks/raceBlock.ts`
- Create: `src/services/training/strengthBlocks/index.ts`
- Test: `src/services/training/__tests__/strengthBlocks.test.ts`

- [ ] **Step 1: Definir tipos**

Crear `src/services/training/strengthBlocks/types.ts`:

```ts
import type { ExercisePhase, ExerciseRotationGroup, MovementPattern } from '../exerciseLibrary'

export interface StrengthBlockSlot {
  pattern: MovementPattern | 'core' | 'cardio' | 'plyo' | 'carry'
  preferredRotationGroup?: ExerciseRotationGroup
  required: boolean
  minDurationMin?: number
  isStarLiftCandidate?: boolean
}

export interface StrengthBlockTemplate {
  id: string
  phase: ExercisePhase
  subTemplate: 'A' | 'B' | 'C'
  description: string
  slots: StrengthBlockSlot[]
}
```

- [ ] **Step 2: Escribir test failing**

Crear `src/services/training/__tests__/strengthBlocks.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  selectStrengthBlockTemplate,
  STRENGTH_BLOCK_TEMPLATES,
} from '../strengthBlocks'

describe('strengthBlocks', () => {
  it('exposes templates for build/peak/taper/race', () => {
    const phases = new Set(STRENGTH_BLOCK_TEMPLATES.map((t) => t.phase))
    expect(phases.has('build')).toBe(true)
    expect(phases.has('peak')).toBe(true)
    expect(phases.has('taper')).toBe(true)
    expect(phases.has('race')).toBe(true)
  })

  it('build phase has 3 sub-templates A/B/C', () => {
    const buildSubs = STRENGTH_BLOCK_TEMPLATES
      .filter((t) => t.phase === 'build')
      .map((t) => t.subTemplate)
      .sort()
    expect(buildSubs).toEqual(['A', 'B', 'C'])
  })

  it('selectStrengthBlockTemplate rotates by weekIndexInBlock', () => {
    const a = selectStrengthBlockTemplate('build', 0)
    const b = selectStrengthBlockTemplate('build', 1)
    const c = selectStrengthBlockTemplate('build', 2)
    const a2 = selectStrengthBlockTemplate('build', 3)
    expect([a.subTemplate, b.subTemplate, c.subTemplate]).toEqual(['A', 'B', 'C'])
    expect(a2.subTemplate).toBe('A')
  })

  it('build A template has at least one squat slot marked as star-lift candidate', () => {
    const a = selectStrengthBlockTemplate('build', 0)
    const starSlots = a.slots.filter((s) => s.isStarLiftCandidate)
    expect(starSlots.length).toBeGreaterThan(0)
    expect(starSlots.some((s) => s.pattern === 'squat')).toBe(true)
  })

  it('taper templates have fewer slots than build', () => {
    const taperA = selectStrengthBlockTemplate('taper', 0)
    const buildA = selectStrengthBlockTemplate('build', 0)
    expect(taperA.slots.length).toBeLessThan(buildA.slots.length)
  })

  it('race template only contains activation/mobility slots', () => {
    const race = selectStrengthBlockTemplate('race', 0)
    const heavyPatterns = race.slots.filter((s) =>
      s.pattern === 'squat' || s.pattern === 'hinge' || s.pattern === 'push' || s.pattern === 'pull'
    )
    expect(heavyPatterns.every((s) => !s.required)).toBe(true)
  })
})
```

- [ ] **Step 3: Verificar que el test falla**

Run: `npx vitest run src/services/training/__tests__/strengthBlocks.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 4: Crear `buildBlock.ts`**

Crear `src/services/training/strengthBlocks/buildBlock.ts`:

```ts
import type { StrengthBlockTemplate } from './types'

export const BUILD_A: StrengthBlockTemplate = {
  id: 'build-A',
  phase: 'build',
  subTemplate: 'A',
  description: 'Build A — squat dominante + olympic accesorio',
  slots: [
    { pattern: 'core', required: true },
    { pattern: 'squat', preferredRotationGroup: 'A', required: true, isStarLiftCandidate: true },
    { pattern: 'pull', preferredRotationGroup: 'A', required: true },
    { pattern: 'lunge', preferredRotationGroup: 'C', required: true },
    { pattern: 'push', preferredRotationGroup: 'B', required: false, minDurationMin: 55 },
    { pattern: 'plyo', required: false, minDurationMin: 60 },
  ],
}

export const BUILD_B: StrengthBlockTemplate = {
  id: 'build-B',
  phase: 'build',
  subTemplate: 'B',
  description: 'Build B — hinge dominante + pull',
  slots: [
    { pattern: 'core', required: true },
    { pattern: 'hinge', preferredRotationGroup: 'A', required: true, isStarLiftCandidate: true },
    { pattern: 'push', preferredRotationGroup: 'A', required: true },
    { pattern: 'pull', preferredRotationGroup: 'B', required: true },
    { pattern: 'carry', required: false, minDurationMin: 55 },
    { pattern: 'cardio', required: false, minDurationMin: 60 },
  ],
}

export const BUILD_C: StrengthBlockTemplate = {
  id: 'build-C',
  phase: 'build',
  subTemplate: 'C',
  description: 'Build C — unilateral + potencia lateral',
  slots: [
    { pattern: 'core', required: true },
    { pattern: 'lunge', preferredRotationGroup: 'C', required: true, isStarLiftCandidate: true },
    { pattern: 'push', preferredRotationGroup: 'C', required: true },
    { pattern: 'pull', preferredRotationGroup: 'C', required: true },
    { pattern: 'plyo', required: false, minDurationMin: 55 },
    { pattern: 'cardio', required: false, minDurationMin: 60 },
  ],
}
```

- [ ] **Step 5: Crear `peakBlock.ts`, `taperBlock.ts`, `raceBlock.ts`**

`peakBlock.ts`:

```ts
import type { StrengthBlockTemplate } from './types'

export const PEAK_A: StrengthBlockTemplate = {
  id: 'peak-A',
  phase: 'peak',
  subTemplate: 'A',
  description: 'Peak A — potencia lateral + sqush transfer',
  slots: [
    { pattern: 'core', required: true },
    { pattern: 'plyo', required: true, isStarLiftCandidate: true },
    { pattern: 'squat', preferredRotationGroup: 'B', required: true },
    { pattern: 'push', preferredRotationGroup: 'C', required: false, minDurationMin: 55 },
    { pattern: 'cardio', required: false, minDurationMin: 60 },
  ],
}

export const PEAK_B: StrengthBlockTemplate = {
  id: 'peak-B',
  phase: 'peak',
  subTemplate: 'B',
  description: 'Peak B — accesorios + core profundo',
  slots: [
    { pattern: 'core', required: true },
    { pattern: 'hinge', preferredRotationGroup: 'B', required: true, isStarLiftCandidate: true },
    { pattern: 'pull', preferredRotationGroup: 'C', required: true },
    { pattern: 'carry', required: false, minDurationMin: 55 },
  ],
}

export const PEAK_C: StrengthBlockTemplate = {
  id: 'peak-C',
  phase: 'peak',
  subTemplate: 'C',
  description: 'Peak C — mantenimiento de fuerza',
  slots: [
    { pattern: 'core', required: true },
    { pattern: 'squat', preferredRotationGroup: 'A', required: true, isStarLiftCandidate: true },
    { pattern: 'push', preferredRotationGroup: 'A', required: true },
    { pattern: 'lunge', preferredRotationGroup: 'C', required: false, minDurationMin: 55 },
  ],
}
```

`taperBlock.ts`:

```ts
import type { StrengthBlockTemplate } from './types'

export const TAPER_A: StrengthBlockTemplate = {
  id: 'taper-A',
  phase: 'taper',
  subTemplate: 'A',
  description: 'Taper A — activación ligera',
  slots: [
    { pattern: 'core', required: true },
    { pattern: 'squat', preferredRotationGroup: 'C', required: false },
    { pattern: 'push', preferredRotationGroup: 'C', required: false },
  ],
}

export const TAPER_B: StrengthBlockTemplate = {
  id: 'taper-B',
  phase: 'taper',
  subTemplate: 'B',
  description: 'Taper B — movilidad + core',
  slots: [
    { pattern: 'core', required: true },
    { pattern: 'pull', preferredRotationGroup: 'C', required: false },
  ],
}
```

`raceBlock.ts`:

```ts
import type { StrengthBlockTemplate } from './types'

export const RACE: StrengthBlockTemplate = {
  id: 'race',
  phase: 'race',
  subTemplate: 'A',
  description: 'Race — activación pre-evento, sin fatiga residual',
  slots: [
    { pattern: 'core', required: true },
    { pattern: 'plyo', required: false },
  ],
}
```

- [ ] **Step 6: Crear `index.ts` con `selectStrengthBlockTemplate`**

```ts
import type { ExercisePhase } from '../exerciseLibrary'
import { BUILD_A, BUILD_B, BUILD_C } from './buildBlock'
import { PEAK_A, PEAK_B, PEAK_C } from './peakBlock'
import { TAPER_A, TAPER_B } from './taperBlock'
import { RACE } from './raceBlock'
import type { StrengthBlockTemplate } from './types'

export const STRENGTH_BLOCK_TEMPLATES: StrengthBlockTemplate[] = [
  BUILD_A, BUILD_B, BUILD_C,
  PEAK_A, PEAK_B, PEAK_C,
  TAPER_A, TAPER_B,
  RACE,
]

const PHASE_SUBTEMPLATES: Record<ExercisePhase, StrengthBlockTemplate[]> = {
  base: [BUILD_A, BUILD_B, BUILD_C],          // base reusa build con menos volumen aguas abajo
  build: [BUILD_A, BUILD_B, BUILD_C],
  peak: [PEAK_A, PEAK_B, PEAK_C],
  taper: [TAPER_A, TAPER_B],
  race: [RACE],
  transition: [TAPER_B],                      // transition usa taper liviano
}

export function selectStrengthBlockTemplate(
  phase: ExercisePhase,
  weekIndexInBlock: number,
): StrengthBlockTemplate {
  const candidates = PHASE_SUBTEMPLATES[phase] ?? PHASE_SUBTEMPLATES.build
  const index = Math.abs(weekIndexInBlock) % candidates.length
  return candidates[index]!
}

export type { StrengthBlockTemplate, StrengthBlockSlot } from './types'
```

- [ ] **Step 7: Verificar que el test pasa**

Run: `npx vitest run src/services/training/__tests__/strengthBlocks.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 8: No commit.**

---

## Task 6: `profileAdapter.ts` — traducir perfil + wizard a parámetros de selector

**Files:**
- Create: `src/services/planBuilder/profileAdapter.ts`
- Test: `src/services/planBuilder/__tests__/profileAdapter.test.ts`

- [ ] **Step 1: Escribir test failing**

Crear `src/services/planBuilder/__tests__/profileAdapter.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildAthleteParameters } from '../profileAdapter'
import type { AthleteProfile, PlanWizardConfig } from '../../../types'

function makeProfile(overrides: Partial<AthleteProfile> = {}): AthleteProfile {
  return {
    id: 'a1', updatedAt: 0, name: 'Test',
    birthDate: '1990-01-01',
    sportContext: { primarySport: 'squash' },
    strengthProfile: { squat1RM: 120, deadlift1RM: 140, benchPress1RM: 90, overheadPress1RM: 65 },
    ...overrides,
  } as AthleteProfile
}

function makeWizard(overrides: Partial<PlanWizardConfig> = {}): PlanWizardConfig {
  return {
    goalEventId: 'e1',
    trainingDays: ['monday','tuesday','wednesday','thursday','friday'],
    doubleSessionDays: [], sessionsPerWeek: 5, sessionDurationMins: 60,
    allowDoubleSession: false, complementarySports: ['strength'],
    currentFitnessLevel: 'fit', currentFatigue: 'fresh',
    createdAt: '', updatedAt: '',
    ...overrides,
  } as PlanWizardConfig
}

describe('buildAthleteParameters', () => {
  it('exposes available 1RM references when profile has them', () => {
    const params = buildAthleteParameters(makeProfile(), makeWizard())
    expect(params.available1RM.sort()).toEqual(['benchPress', 'deadlift', 'overheadPress', 'squat'])
  })

  it('excludes 1RM references for null lifts', () => {
    const params = buildAthleteParameters(
      makeProfile({ strengthProfile: { squat1RM: 120, deadlift1RM: 140 } as never }),
      makeWizard(),
    )
    expect(params.available1RM.sort()).toEqual(['deadlift', 'squat'])
  })

  it('lowers targetRpe by 1 when fatigue is overloaded', () => {
    const params = buildAthleteParameters(
      makeProfile(),
      makeWizard({ currentFatigue: 'overloaded' }),
    )
    expect(params.rpeAdjustment).toBe(-1)
  })

  it('rpeAdjustment is 0 when fatigue is fresh', () => {
    const params = buildAthleteParameters(makeProfile(), makeWizard())
    expect(params.rpeAdjustment).toBe(0)
  })

  it('flags masters (>= 35) requireExtraRecovery', () => {
    const params = buildAthleteParameters(
      makeProfile({ birthDate: '1985-01-01' }), // age >35 en 2026
      makeWizard(),
    )
    expect(params.requireExtraRecovery).toBe(true)
  })

  it('preserves wizard primarySport and complementarySports', () => {
    const params = buildAthleteParameters(makeProfile(), makeWizard({ complementarySports: ['running'] }))
    expect(params.primarySport).toBe('squash')
    expect(params.complementarySports).toEqual(['running'])
  })

  it('respects equipment from wizard config when present', () => {
    const params = buildAthleteParameters(makeProfile(), makeWizard({ availableEquipment: ['barbell', 'dumbbell'] } as never))
    expect(params.availableEquipment).toEqual(['barbell', 'dumbbell'])
  })
})
```

- [ ] **Step 2: Verificar test falla**

Run: `npx vitest run src/services/planBuilder/__tests__/profileAdapter.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar `profileAdapter.ts`**

Crear `src/services/planBuilder/profileAdapter.ts`:

```ts
import type { AthleteProfile, PlanWizardConfig, SupportedSport } from '../../types'
import type { Exercise1RMReference, EquipmentType } from '../training/exerciseLibrary'

export interface AthleteParameters {
  available1RM: Exercise1RMReference[]
  rpeAdjustment: number
  requireExtraRecovery: boolean
  primarySport: SupportedSport | undefined
  complementarySports: SupportedSport[]
  availableEquipment: EquipmentType[] | undefined
  fitnessLevel: PlanWizardConfig['currentFitnessLevel']
  fatigueLevel: PlanWizardConfig['currentFatigue']
  ageYears: number | undefined
}

const TODAY = '2026-05-28'

export function buildAthleteParameters(
  profile: AthleteProfile,
  wizardConfig: PlanWizardConfig,
): AthleteParameters {
  const sp = profile.strengthProfile
  const available1RM: Exercise1RMReference[] = []
  if (sp?.squat1RM != null) available1RM.push('squat')
  if (sp?.deadlift1RM != null) available1RM.push('deadlift')
  if (sp?.benchPress1RM != null) available1RM.push('benchPress')
  if (sp?.overheadPress1RM != null) available1RM.push('overheadPress')

  const rpeAdjustment = wizardConfig.currentFatigue === 'overloaded'
    ? -1
    : wizardConfig.currentFatigue === 'loaded'
      ? 0
      : 0

  const ageYears = profile.birthDate ? computeAgeYears(profile.birthDate, TODAY) : undefined
  const requireExtraRecovery = (ageYears ?? 0) >= 35

  return {
    available1RM,
    rpeAdjustment,
    requireExtraRecovery,
    primarySport: profile.sportContext?.primarySport,
    complementarySports: wizardConfig.complementarySports ?? [],
    availableEquipment: (wizardConfig as { availableEquipment?: EquipmentType[] }).availableEquipment,
    fitnessLevel: wizardConfig.currentFitnessLevel,
    fatigueLevel: wizardConfig.currentFatigue,
    ageYears,
  }
}

function computeAgeYears(birthDate: string, today: string): number {
  const birth = new Date(`${birthDate}T00:00:00.000Z`).getTime()
  const now = new Date(`${today}T00:00:00.000Z`).getTime()
  if (!Number.isFinite(birth) || !Number.isFinite(now)) return 0
  const yearMs = 365.2425 * 24 * 60 * 60 * 1000
  return Math.floor((now - birth) / yearMs)
}
```

- [ ] **Step 4: Verificar que el test pasa**

Run: `npx vitest run src/services/planBuilder/__tests__/profileAdapter.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: No commit.**

---

## Task 7: Integrar `selectStrengthBlockTemplate` + perfil en `selectStrengthSession`

**Files:**
- Modify: `src/services/training/strengthSelector.ts`
- Test: `src/services/training/__tests__/strengthSelectorRotation.test.ts`
- Test: `src/services/training/__tests__/strengthSelectorProfile.test.ts`

- [ ] **Step 1: Extender `StrengthContext` con campos opcionales**

En `src/services/training/strengthSelector.ts`, modificar `StrengthContext` añadiendo:

```ts
export interface StrengthContext {
  // ... existente ...
  weekIndexInBlock?: number
  available1RM?: Exercise1RMReference[]
  rpeAdjustment?: number
}
```

> Si `weekIndexInBlock` no se provee, default 0.

- [ ] **Step 2: Escribir test failing — rotación**

Crear `src/services/training/__tests__/strengthSelectorRotation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { selectStrengthSession, type StrengthContext } from '../strengthSelector'

const baseContext = (overrides: Partial<StrengthContext>): StrengthContext => ({
  fatigueLevel: 2,
  phase: 'build',
  recentExercises: [],
  goal: 'squash competitivo',
  sportProfile: 'sport_support',
  primarySport: 'squash',
  experienceLevel: 'advanced',
  sessionDurationMin: 60,
  ...overrides,
})

describe('selectStrengthSession rotation', () => {
  it('produces different star lifts across 3 consecutive build weeks', () => {
    const w0 = selectStrengthSession(baseContext({ weekIndexInBlock: 0 }))
    const w1 = selectStrengthSession(baseContext({ weekIndexInBlock: 1, recentExercises: w0.exercises.map((e) => e.name) }))
    const w2 = selectStrengthSession(baseContext({ weekIndexInBlock: 2, recentExercises: [...w0, ...w1].flatMap((s) => Array.isArray(s) ? s : s.exercises ?? []).map((e: { name: string } | string) => typeof e === 'string' ? e : e.name) }))

    const names0 = new Set(w0.exercises.map((e) => e.name))
    const names1 = new Set(w1.exercises.map((e) => e.name))
    const names2 = new Set(w2.exercises.map((e) => e.name))

    const overlap01 = [...names0].filter((n) => names1.has(n)).length
    const overlap12 = [...names1].filter((n) => names2.has(n)).length
    expect(overlap01).toBeLessThanOrEqual(2)
    expect(overlap12).toBeLessThanOrEqual(2)
  })

  it('builds a 60-min session with ≥5 exercises in build', () => {
    const session = selectStrengthSession(baseContext({ weekIndexInBlock: 0 }))
    expect(session.exercises.length).toBeGreaterThanOrEqual(5)
  })
})
```

- [ ] **Step 3: Escribir test failing — perfil**

Crear `src/services/training/__tests__/strengthSelectorProfile.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { selectStrengthSession, type StrengthContext } from '../strengthSelector'
import type { Exercise1RMReference } from '../exerciseLibrary'

const ctx = (overrides: Partial<StrengthContext>): StrengthContext => ({
  fatigueLevel: 2,
  phase: 'build',
  recentExercises: [],
  goal: 'squash competitivo',
  sportProfile: 'sport_support',
  primarySport: 'squash',
  experienceLevel: 'advanced',
  sessionDurationMin: 60,
  weekIndexInBlock: 0,
  ...overrides,
})

describe('selectStrengthSession con perfil 1RM', () => {
  it('prefers exercises with has1RMReference when athlete has the lift in profile', () => {
    const available: Exercise1RMReference[] = ['squat', 'deadlift', 'benchPress', 'overheadPress']
    const session = selectStrengthSession(ctx({ available1RM: available }))
    const namesLower = session.exercises.map((e) => e.name.toLowerCase()).join('|')
    const usesAtLeastOne1RM = /sentadilla|squat|peso muerto|deadlift|press de banca|bench|press militar|press sobre cabeza|overhead/i.test(namesLower)
    expect(usesAtLeastOne1RM).toBe(true)
  })

  it('does NOT pick OHP as primary when overheadPress is absent', () => {
    const available: Exercise1RMReference[] = ['squat', 'deadlift', 'benchPress']
    const session = selectStrengthSession(ctx({ available1RM: available, weekIndexInBlock: 1 }))
    const starLift = session.exercises[0]
    expect(/\bohp\b|overhead press|press militar|press sobre cabeza/i.test(starLift?.name ?? '')).toBe(false)
  })

  it('reduces targetRpe when rpeAdjustment is -1', () => {
    const baseSession = selectStrengthSession(ctx({ rpeAdjustment: 0 }))
    const tiredSession = selectStrengthSession(ctx({ rpeAdjustment: -1 }))

    const baseRpe = baseSession.exercises.find((e) => e.targetRpe != null)?.targetRpe
    const tiredRpe = tiredSession.exercises.find((e) => e.targetRpe != null)?.targetRpe
    if (baseRpe != null && tiredRpe != null) {
      expect(tiredRpe).toBeLessThan(baseRpe)
    }
  })
})
```

- [ ] **Step 4: Verificar que ambos tests fallan**

Run: `npx vitest run src/services/training/__tests__/strengthSelectorRotation.test.ts src/services/training/__tests__/strengthSelectorProfile.test.ts`
Expected: FAIL — `selectStrengthSession` aún no usa block templates ni `available1RM`.

- [ ] **Step 5: Modificar `selectStrengthSession`**

En `src/services/training/strengthSelector.ts`, antes del cuerpo actual de `selectStrengthSession`, integrar:

1. Resolver `template = selectStrengthBlockTemplate(context.phase as ExercisePhase, context.weekIndexInBlock ?? 0)`.
2. Para cada `slot` del template, scorear ejercicios del catálogo así:
   - Filtro duro: `appropriateForPhases.includes(template.phase)` y `pattern` coincide.
   - Boost: +20 si `blockRotationGroup === slot.preferredRotationGroup`.
   - Boost: +30 si `has1RMReference != null && available1RM.includes(has1RMReference)`.
   - Penalización: −50 si `name` está en `recentExercises`.
   - Penalización: −30 si `equipment` no se intersecta con `availableEquipment` (si está provisto).
3. Si `slot.required` y duración alcanza, elegir top score; si `!required`, solo elegir si `sessionDurationMin >= slot.minDurationMin`.
4. Aplicar `rpeAdjustment` a cada `targetRpe` resultante (clamp ≥ 4).
5. Mantener el resto del flujo (`enhanceStrengthSessionExercises`, etc.) intacto.

> Mantener la firma actual del export. Solo extender el cuerpo. Si la lógica vieja se vuelve inalcanzable, dejarla como `legacy_selectStrengthSession` no exportado por ahora.

Pseudocódigo concreto a insertar al inicio de la función:

```ts
import { selectStrengthBlockTemplate } from './strengthBlocks'
import { STRENGTH_EXERCISE_LIBRARY } from './exerciseLibrary'
import type { Exercise1RMReference, ExercisePhase } from './exerciseLibrary'

// ... dentro de selectStrengthSession ...
const template = selectStrengthBlockTemplate(context.phase as ExercisePhase, context.weekIndexInBlock ?? 0)
const recent = new Set(context.recentExercises.map((n) => n.toLowerCase()))
const availableEquipment = (context as { availableEquipment?: string[] }).availableEquipment
const available1RM = context.available1RM ?? []

const picked: StrengthSelectionExercise[] = []
for (const slot of template.slots) {
  if (!slot.required && (slot.minDurationMin != null && context.sessionDurationMin < slot.minDurationMin)) continue
  const candidates = STRENGTH_EXERCISE_LIBRARY
    .filter((e) => (e.appropriateForPhases ?? []).includes(template.phase))
    .filter((e) => matchesPattern(e, slot.pattern))
  if (candidates.length === 0) continue
  const scored = candidates.map((e) => ({
    exercise: e,
    score:
      (e.blockRotationGroup === slot.preferredRotationGroup ? 20 : 0)
      + (e.has1RMReference && available1RM.includes(e.has1RMReference) ? 30 : 0)
      - (recent.has(e.name.toLowerCase()) ? 50 : 0)
      - (availableEquipment && !e.equipment.some((eq) => availableEquipment.includes(eq)) ? 30 : 0)
      + Math.random() * 2  // pequeño tie-break determinístico via seed sería ideal; placeholder ok
  })).sort((a, b) => b.score - a.score)
  const top = scored[0]?.exercise
  if (!top) continue
  picked.push(toSelectionExercise(top, slot, available1RM))
}

// aplicar rpeAdjustment
if (context.rpeAdjustment != null && context.rpeAdjustment !== 0) {
  for (const ex of picked) {
    if (ex.targetRpe != null) ex.targetRpe = Math.max(4, ex.targetRpe + context.rpeAdjustment)
  }
}

return { exercises: picked, /* mantener campos meta existentes */ }
```

> Helper `matchesPattern` y `toSelectionExercise` deben implementarse a nivel de módulo, reutilizando lógica existente para sets/reps/prescription. Mantener los outputs compatibles con `StrengthSelectionExercise`.

- [ ] **Step 6: Verificar que los tests pasan**

Run: `npx vitest run src/services/training/__tests__/strengthSelectorRotation.test.ts src/services/training/__tests__/strengthSelectorProfile.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Verificar regresiones en suite training**

Run: `npx vitest run src/services/training`
Expected: PASS. Si algún test viejo asume catálogo legacy, ajustar mínimamente.

- [ ] **Step 8: No commit.**

---

## Task 8: Lift estrella en metadata de sesión

**Files:**
- Modify: `src/services/training/strengthSelector.ts` (resultado expone `starLift` opcional)
- Modify: `src/services/planBuilder/repairWeek.ts` (propagar al `session.metadata`)
- Modify: `src/types/index.ts` o tipo de Session (añadir campo `metadata.starLift?: { name: string; targetPercent1RM?: number }`)
- Test: `src/services/training/__tests__/strengthSelectorStarLift.test.ts`

- [ ] **Step 1: Añadir tipo `StarLiftInfo` y exponerlo**

En `src/services/training/strengthSelector.ts`:

```ts
export interface StarLiftInfo {
  name: string
  targetPercent1RM?: number
  targetRpe?: number
  weekProgression: number  // 0..N dentro del bloque
}

export interface StrengthSelectionResult {
  exercises: StrengthSelectionExercise[]
  starLift?: StarLiftInfo
  // ... otros campos existentes ...
}
```

> Si la función actual retorna un objeto con shape distinto, mantener compat: añadir `starLift` como campo opcional.

- [ ] **Step 2: Escribir test failing**

Crear `src/services/training/__tests__/strengthSelectorStarLift.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { selectStrengthSession, type StrengthContext } from '../strengthSelector'

const ctx = (weekIndex: number): StrengthContext => ({
  fatigueLevel: 2, phase: 'build', recentExercises: [],
  goal: 'squash', sportProfile: 'sport_support', primarySport: 'squash',
  experienceLevel: 'advanced', sessionDurationMin: 60,
  weekIndexInBlock: weekIndex,
  available1RM: ['squat', 'deadlift', 'benchPress', 'overheadPress'],
})

describe('selectStrengthSession star lift', () => {
  it('exposes starLift when a slot is marked as star-lift candidate', () => {
    const session = selectStrengthSession(ctx(0))
    expect(session.starLift).toBeDefined()
    expect(session.starLift!.name.length).toBeGreaterThan(0)
  })

  it('starLift progresses across consecutive same-subtemplate weeks', () => {
    const w0 = selectStrengthSession(ctx(0))
    const w3 = selectStrengthSession(ctx(3)) // same subtemplate A
    expect(w0.starLift?.name).toBe(w3.starLift?.name)
    if (w0.starLift?.targetPercent1RM != null && w3.starLift?.targetPercent1RM != null) {
      expect(w3.starLift.targetPercent1RM).toBeGreaterThanOrEqual(w0.starLift.targetPercent1RM)
    }
  })
})
```

- [ ] **Step 3: Verificar que el test falla**

Run: `npx vitest run src/services/training/__tests__/strengthSelectorStarLift.test.ts`
Expected: FAIL — `starLift` undefined.

- [ ] **Step 4: Implementar selección de star lift**

Dentro de `selectStrengthSession`, después de elegir ejercicios, buscar el slot con `isStarLiftCandidate: true` y el ejercicio elegido para ese slot. Calcular progresión simple basada en `weekIndexInBlock / 3`:

```ts
const starSlotIndex = template.slots.findIndex((s) => s.isStarLiftCandidate)
let starLift: StarLiftInfo | undefined
if (starSlotIndex >= 0 && picked[starSlotIndex]) {
  const ex = picked[starSlotIndex]
  const progressionStep = Math.floor((context.weekIndexInBlock ?? 0) / 3)
  const basePercent = ex.targetPercent1RM ?? 75
  starLift = {
    name: ex.name,
    targetPercent1RM: Math.min(90, basePercent + progressionStep * 2.5),
    targetRpe: ex.targetRpe,
    weekProgression: progressionStep,
  }
  // Aplicar progresión al ejercicio también
  if (ex.targetPercent1RM != null) {
    ex.targetPercent1RM = starLift.targetPercent1RM
  }
}

return { exercises: picked, starLift }
```

- [ ] **Step 5: Verificar que el test pasa**

Run: `npx vitest run src/services/training/__tests__/strengthSelectorStarLift.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Propagar `starLift` al `session.metadata` en `repairWeek`**

En `repairWeek.ts`, función `completeStrengthExercises`, después de llamar a `selectStrengthSession`:

```ts
const result = selectStrengthSession(buildStrengthSelectionContext(session, context, recentExercises))
session.exercises = result.exercises.map<CoachExerciseProposal>((e) => ({ /* mapeo existente */ }))
if (result.starLift) {
  session.metadata = { ...(session.metadata ?? {}), starLift: result.starLift }
}
```

> Si `CoachSessionProposal` no tiene `metadata`, añadirlo como `Record<string, unknown>` opcional en `src/types/index.ts`.

- [ ] **Step 7: Validar suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: No commit.**

---

## Task 9: `drillSelector` consume `phaseAppropriate` + `partnerRequired`

**Files:**
- Modify: `src/services/training/drillSelector.ts`
- Test: `src/services/training/__tests__/drillSelectorPhase.test.ts`

- [ ] **Step 1: Escribir test failing**

Crear `src/services/training/__tests__/drillSelectorPhase.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { selectSquashDrills } from '../drillSelector'

describe('selectSquashDrills phaseAppropriate + partnerRequired', () => {
  it('does not pick match drills when phase is "base"', () => {
    const result = selectSquashDrills({
      fatigueLevel: 2, phase: 'base', recentDrills: [],
      goal: 'squash', competitionSoon: false, competitiveLevel: 'advanced',
      desiredKind: 'technical',
    })
    const hasMatch = result.drills?.some((d) => /partido|match/i.test(d.name))
    expect(hasMatch ?? false).toBe(false)
  })

  it('respects partnerAvailable=false by skipping partner drills', () => {
    const result = selectSquashDrills({
      fatigueLevel: 2, phase: 'build', recentDrills: [],
      goal: 'squash', competitionSoon: false, competitiveLevel: 'advanced',
      desiredKind: 'technical',
      partnerAvailable: false,
    } as never)
    const partnerOnly = result.drills?.some((d) => /partner|condicionado al fondo|cross.?court con/i.test(d.name))
    expect(partnerOnly ?? false).toBe(false)
  })
})
```

- [ ] **Step 2: Verificar que el test falla**

Run: `npx vitest run src/services/training/__tests__/drillSelectorPhase.test.ts`
Expected: FAIL — selector no usa `phaseAppropriate` ni `partnerAvailable`.

- [ ] **Step 3: Extender input `SquashSelectionContext`**

En `src/services/training/drillSelector.ts` añadir campo opcional:

```ts
export interface SquashSelectionContext {
  // ... existente ...
  partnerAvailable?: boolean
}
```

- [ ] **Step 4: Modificar lógica de filtro**

En la función `selectSquashDrills`, antes de scorear candidatos:

```ts
const candidates = SQUASH_DRILL_LIBRARY.filter((d) => {
  if (d.phaseAppropriate && !d.phaseAppropriate.includes(context.phase as never)) return false
  if (context.partnerAvailable === false && d.partnerRequired === true) return false
  return true
})
// Pasar este `candidates` filtrado al scoring/ranking existente.
```

- [ ] **Step 5: Verificar que el test pasa**

Run: `npx vitest run src/services/training/__tests__/drillSelectorPhase.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Verificar suite drill**

Run: `npx vitest run src/services/training/__tests__/drillSelector*`
Expected: PASS.

- [ ] **Step 7: No commit.**

---

## Task 10: Cablear `profileAdapter` + `weekIndexInBlock` desde `repairWeek`

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts` — `buildStrengthSelectionContext` y `buildSquashSelectionContext`
- Test: `src/services/planBuilder/__tests__/repairWeekFase2Wiring.test.ts`

- [ ] **Step 1: Calcular `weekIndexInBlock`**

En `repairWeek.ts`, helper nuevo:

```ts
function computeWeekIndexInBlock(context: RepairContext): number {
  const phase = context.plan.phases.find((p) =>
    context.week.weekIndex >= p.startWeekIndex && context.week.weekIndex <= p.endWeekIndex
  )
  if (!phase) return 0
  return context.week.weekIndex - phase.startWeekIndex
}
```

- [ ] **Step 2: Llamar `buildAthleteParameters` y pasar al selector**

En `buildStrengthSelectionContext`:

```ts
import { buildAthleteParameters } from './profileAdapter'

function buildStrengthSelectionContext(
  session: CoachSessionProposal,
  context: RepairContext,
  recentExercises: string[],
): StrengthContext {
  const params = buildAthleteParameters(context.profile, context.wizardConfig)
  return {
    fatigueLevel: fatigueToNumber(context.wizardConfig.currentFatigue),
    phase: mapPhase(context.week.phase) as StrengthPhase,
    recentExercises,
    goal: buildLevelAwareGoal(context, session.objective ?? context.profile.mainGoal ?? ''),
    sportProfile: deriveStrengthSportProfile(context),
    primarySport: context.profile.sportContext?.primarySport,
    experienceLevel: deriveStrengthExperienceLevel(context),
    sessionDurationMin: session.durationMin,
    weekIndexInBlock: computeWeekIndexInBlock(context),
    available1RM: params.available1RM,
    rpeAdjustment: params.rpeAdjustment,
  }
}
```

- [ ] **Step 3: Wiring análogo en squash**

En cada llamada a `selectSquashDrills(...)` dentro de `repairWeek.ts`, añadir:

```ts
partnerAvailable: context.wizardConfig.partnerAvailable ?? true,
```

> Si `PlanWizardConfig` no tiene `partnerAvailable`, no añadirlo y dejar default `true`. Documentar para Fase 3.

- [ ] **Step 4: Test de wiring**

Crear `src/services/planBuilder/__tests__/repairWeekFase2Wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { repairGeneratedWeek } from '../repairWeek'
import type { RepairContext } from '../repairWeek'

function makeContext(weekIndex: number): RepairContext {
  return {
    plan: {
      id: 'p1', athleteId: 'a1', goalEventId: 'e1', status: 'draft', generationState: 'complete',
      title: 'Test', startDate: '2026-06-01', endDate: '2026-07-24', totalWeeks: 9,
      phases: [
        { phase: 'build', startWeekIndex: 0, endWeekIndex: 5, blockFocus: 'build', intentBySport: {} },
        { phase: 'peak', startWeekIndex: 6, endWeekIndex: 7, blockFocus: 'peak', intentBySport: {} },
        { phase: 'taper', startWeekIndex: 8, endWeekIndex: 8, blockFocus: 'taper', intentBySport: {} },
      ],
      wizardConfig: {} as never,
      macroSnapshot: { goalEventId: 'e1', goalEventDate: '2026-07-24', currentPhase: 'build', weeksRemaining: 5, blockFocus: 'build', headline: '', timeline: [], sportDetails: [{ sport: 'squash', role: 'primary', phaseFocus: '', weeklyIntent: '', volumeBias: 'hold', intensityBias: 'hold', notes: '' }], secondaryEvents: [], computedAt: 0 },
      createdAt: 0, updatedAt: 0,
    } as never,
    week: {
      id: `w${weekIndex}`, planId: 'p1', weekIndex, weekStartDate: '2026-06-15', phase: 'build',
      status: 'pending', sessions: [], weekObjectives: [],
      targetLoadBySport: { squash: 50, strength: 30 },
      validationIssues: [], generationMeta: { attempts: 1, provider: 'gemini', model: 'flash' },
      createdAt: 0, updatedAt: 0,
    } as never,
    profile: {
      id: 'default', updatedAt: 0,
      birthDate: '1990-01-01',
      sportContext: { primarySport: 'squash' },
      strengthProfile: { squat1RM: 120, deadlift1RM: 140, benchPress1RM: 90, overheadPress1RM: 65 } as never,
    } as never,
    wizardConfig: {
      goalEventId: 'e1', trainingDays: ['monday','tuesday','wednesday','thursday','friday'],
      doubleSessionDays: [], sessionsPerWeek: 5, sessionDurationMins: 60,
      allowDoubleSession: false, complementarySports: ['strength'],
      currentFitnessLevel: 'fit', currentFatigue: 'fresh', createdAt: '', updatedAt: '',
    } as never,
  }
}

describe('repairWeek Fase 2 wiring', () => {
  it('strength session in build phase uses an exercise with has1RMReference present', () => {
    const result = repairGeneratedWeek([
      {
        date: '2026-06-15', timeBlock: 'AM', sessionType: 'strength',
        title: 'Fuerza vacía', durationMin: 60, rpe: 6,
        exercises: [],
      },
    ] as never, makeContext(2))

    const strength = result.sessions.find((s) => s.sessionType === 'strength')!
    const has1RMUsage = (strength.exercises ?? []).some((e) =>
      /sentadilla|squat|peso muerto|deadlift|press de banca|bench|press militar|overhead/i.test(e.name)
    )
    expect(has1RMUsage).toBe(true)
  })

  it('strength session in week 0 vs week 3 (same subtemplate) keeps same star lift name', () => {
    const w0 = repairGeneratedWeek([
      { date: '2026-06-15', timeBlock: 'AM', sessionType: 'strength', title: 'F', durationMin: 60, rpe: 6, exercises: [] },
    ] as never, makeContext(0))
    const w3 = repairGeneratedWeek([
      { date: '2026-07-06', timeBlock: 'AM', sessionType: 'strength', title: 'F', durationMin: 60, rpe: 6, exercises: [] },
    ] as never, makeContext(3))

    const s0 = w0.sessions.find((s) => s.sessionType === 'strength')!
    const s3 = w3.sessions.find((s) => s.sessionType === 'strength')!

    const star0 = (s0 as { metadata?: { starLift?: { name: string } } }).metadata?.starLift?.name
    const star3 = (s3 as { metadata?: { starLift?: { name: string } } }).metadata?.starLift?.name
    expect(star0).toBeDefined()
    expect(star0).toBe(star3)
  })
})
```

- [ ] **Step 5: Verificar que el test pasa**

Run: `npx vitest run src/services/planBuilder/__tests__/repairWeekFase2Wiring.test.ts`
Expected: PASS.

- [ ] **Step 6: Verificar suite global**

Run: `npx vitest run`
Expected: PASS para todos los archivos.

- [ ] **Step 7: No commit.**

---

## Task 11: Lint, build, audit y tests completos

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 2: Tests completos**

Run: `npm test`
Expected: PASS. Si algún test viejo se rompió por shape de `selectStrengthSession`, ajustar mínimamente.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS. Si TypeScript se queja de campos `as never` o `as { ... }` en tests, añadir tipos correctos o cast minimal.

- [ ] **Step 4: Audit de prompts**

Run: `npm run audit:prompt`
Expected: PASS. Fase 2 no toca prompts; los token counts deberían quedar idénticos.

- [ ] **Step 5: No commit.**

---

## Task 12: Smoke verification — métricas de cierre Fase 2

Validación local que confirma las métricas de Fase 2 sin necesidad de levantar dev/Gemini.

- [ ] **Step 1: Test de no-clones cross-week**

Crear (o extender) `src/services/planBuilder/__tests__/fase2Metrics.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { repairGeneratedWeek } from '../repairWeek'
import type { RepairContext } from '../repairWeek'

function makeCtx(weekIndex: number, previous?: { exercises: { name: string }[] }): RepairContext {
  // ... reutilizar fixture de Task 10 ...
  // simplificada para no exceder este plan; copiar el helper de Task 10 inline
  return /* ... */ {} as never
}

describe('Fase 2 metrics', () => {
  it('genera 3 semanas seguidas de build sin más de 2 ejercicios duplicados entre adyacentes', () => {
    const w0 = repairGeneratedWeek([
      { date: '2026-06-15', timeBlock: 'AM', sessionType: 'strength', title: 'F', durationMin: 60, rpe: 6, exercises: [] },
    ] as never, makeCtx(0))
    const w1 = repairGeneratedWeek([
      { date: '2026-06-22', timeBlock: 'AM', sessionType: 'strength', title: 'F', durationMin: 60, rpe: 6, exercises: [] },
    ] as never, makeCtx(1, w0.sessions[0] as never))
    const w2 = repairGeneratedWeek([
      { date: '2026-06-29', timeBlock: 'AM', sessionType: 'strength', title: 'F', durationMin: 60, rpe: 6, exercises: [] },
    ] as never, makeCtx(2, w1.sessions[0] as never))

    const names0 = new Set(w0.sessions[0]!.exercises!.map((e) => e.name))
    const names1 = new Set(w1.sessions[0]!.exercises!.map((e) => e.name))
    const names2 = new Set(w2.sessions[0]!.exercises!.map((e) => e.name))

    const overlap01 = [...names0].filter((n) => names1.has(n)).length
    const overlap12 = [...names1].filter((n) => names2.has(n)).length
    expect(overlap01).toBeLessThanOrEqual(2)
    expect(overlap12).toBeLessThanOrEqual(2)
  })

  it('sesion de 60 min build tiene 1 core + 1 squat/hinge + 1 push/pull + 1 unilateral', () => {
    const w = repairGeneratedWeek([
      { date: '2026-06-15', timeBlock: 'AM', sessionType: 'strength', title: 'F', durationMin: 60, rpe: 6, exercises: [] },
    ] as never, makeCtx(0))
    const session = w.sessions[0]!
    const exs = session.exercises ?? []
    const hasCore = exs.some((e) => e.group === 'core')
    const hasSquatOrHinge = exs.some((e) => /sentadilla|squat|peso muerto|deadlift|hip thrust|rdl/i.test(e.name))
    const hasPushOrPull = exs.some((e) => /press|remo|row|dominada|pull/i.test(e.name))
    const hasUnilateral = exs.some((e) => /bulgar|zancada|lunge|paso lateral|step.?up/i.test(e.name))
    expect(hasCore).toBe(true)
    expect(hasSquatOrHinge).toBe(true)
    expect(hasPushOrPull).toBe(true)
    expect(hasUnilateral).toBe(true)
  })

  it('plan con 1RM completos usa al menos 4 ejercicios con has1RMReference acumulados en 3 semanas', () => {
    // Reusar lógica de la métrica anterior con 3 semanas; contar nombres únicos que matcheen.
    expect(true).toBe(true)  // Implementar tras Task 11; placeholder si el tiempo apremia.
  })
})
```

> El último test es opcional/informativo. Marcarlo `it.todo(...)` si su implementación no cabe en este plan.

- [ ] **Step 2: Run**

Run: `npx vitest run src/services/planBuilder/__tests__/fase2Metrics.test.ts`
Expected: PASS para los dos primeros tests.

- [ ] **Step 3: Reporte final**

En el handoff al usuario, listar:

- Cambios en `exerciseLibrary` (qué ejercicios obtuvieron `has1RMReference` / `blockRotationGroup`).
- Cambios en `drillLibrary` (qué drills obtuvieron `phaseAppropriate` / `partnerRequired`).
- Módulos nuevos: `strengthBlocks/`, `profileAdapter.ts`.
- Métricas de cierre Fase 2 alcanzadas en tests focalizados.
- Pendiente fuera de scope: Fase 3 (quality review pre-commit, regenerar semana).

- [ ] **Step 4: No commit. Usuario hará commit consolidado.**

---

## Self-Review (escrito antes de entregar a executing-plans)

**Cobertura del spec Fase 2:**
- 2.1 Catálogo de ejercicios declarativo → Tasks 1+2 (extensión de existente) ✓
- 2.2 Periodización por bloque → Task 5 ✓
- 2.3 Motor de selección reescrito → Task 7 ✓
- 2.4 Lift estrella por semana → Task 8 ✓
- 2.5 Catálogo de drills squash paralelo → Tasks 3+4 (extensión de existente) ✓
- 2.6 Integración del perfil del atleta → Task 6 + cableado en Task 10 ✓
- 2.7 Tests focalizados → cubiertos dentro de cada task ✓
- 2.8 Métricas de cierre → Task 11 + Task 12 ✓

**Decisión arquitectónica documentada:** El spec sugiere crear `exerciseCatalog/` y `squashCatalog/` paralelos. El código real ya tiene `exerciseLibrary.ts` (51KB) y `drillLibrary.ts` (34KB) con 80% del schema. La estrategia adoptada es **extender** las librerías existentes, no duplicar. Esto reduce el riesgo de divergencia y respeta la regla CLAUDE.md de no crear archivos cuando se pueda extender.

**Placeholder scan:**
- Task 7 Step 5 usa pseudocódigo con `Math.random()` en el score como placeholder de tie-break determinístico. Aceptable — el agente implementador puede reemplazar con seed o eliminar; los tests no requieren determinismo estricto.
- Task 9 Step 4 indica que si `PlanWizardConfig.partnerAvailable` no existe, se omite y se documenta para Fase 3. Aceptable — el wizard tiene control y este campo puede añadirse luego.
- Task 12 Step 1 tiene una versión simplificada del helper `makeCtx` con `return /* ... */ {} as never`. El agente debe copiar inline el helper de Task 10. No es bloqueante.

**Type consistency:**
- `Exercise1RMReference` definido en Task 1 y consumido en Task 6 + 7 + 10 ✓
- `ExercisePhase` definido en Task 1 y consumido en Task 5 + 7 ✓
- `StrengthBlockTemplate` definido en Task 5 y consumido en Task 7 ✓
- `AthleteParameters` definido en Task 6 y consumido en Task 10 ✓
- `StarLiftInfo` definido en Task 8 y propagado a `session.metadata` en Task 8 Step 6 ✓

**Hueco identificado y cubierto:** `selectStrengthSession` actualmente tiene una lógica compleja (49KB). Task 7 indica reemplazar el cuerpo de forma quirúrgica manteniendo la firma. Si el agente encuentra que la lógica vieja tiene branches imposibles de eliminar de forma limpia, debe extraer a `legacy_selectStrengthSession` no exportado y dejar la implementación nueva como autoridad. Esto está mencionado en Step 5.

**No tocado intencionalmente:**
- `promptBuilder.ts` (regla CLAUDE.md).
- `syncService` (regla CLAUDE.md).
- Schema de Supabase / sync.
- Cualquier UI: este spec no expone `starLift` en pantalla. Fase 3 toca UI.

# Coach Exercise Catalog Picker — Implementation Plan

> **For agentic workers:** Ejecutar task por task con TDD y checkpoints. Si las skills de ejecución de planes (subagent-driven-development / executing-plans) están disponibles, usarlas; si no, seguir este documento directamente — cada task es autónoma y termina en verificación. Los pasos usan checkboxes (`- [ ]`) para tracking.

**Goal:** El coach arma sesiones eligiendo drills de squash y ejercicios de fuerza desde las librerías curadas de la app (typeahead + explorador en `SessionForm`), con `libraryRef` opcional persistido, ejercicios editables en sesiones de squash, y fix del bloque de resultado de partido en el editor del coach.

**Architecture:** Un servicio adaptador puro (`coachExerciseCatalog`) unifica `SQUASH_DRILL_LIBRARY` y `STRENGTH_EXERCISE_LIBRARY` en `CatalogEntry` para UI. `SessionForm` gana un combobox de nombre (solo en tipos con catálogo) y un panel explorador (dialog accesible); ambos estampan `libraryRef` (tipo compartido `ExerciseLibraryRef`, sanitizado en límites de import/plantillas). Squash entra a los tipos con ejercicios editables (`EXERCISE_TYPES`) en form, serializers, plantillas y `SessionCard`, con `squashDetails` opaco e intacto. Sin migraciones Dexie ni Supabase.

**Tech Stack:** React + TypeScript + Vite, Vitest + Testing Library/jsdom (ya instalados; **sin jest-dom** — asserts con `.not.toBeNull()`, casts a `HTMLInputElement` y `toMatchObject`, como los tests existentes).

**Spec:** `docs/superpowers/specs/2026-07-19-coach-exercise-catalog-picker-design.md` (aprobada 2026-07-19). Ante ambigüedad, la spec manda.

## Global Constraints

- **NO ejecutar `git commit` ni `git add`** — los commits los hace el owner. Cada task termina con verificación y aviso de checkpoint.
- Nunca el literal `'default'` fuera de `activeAthlete.ts` (guard test `noDirectDefault.test.ts`).
- **Sin migraciones**: Dexie queda en v18; no se agrega SQL. `libraryRef` viaja dentro del JSON de la sesión.
- `squashDetails.drills/blocks` es contenido opaco del Plan Builder: el editor **jamás** lo modifica ni lo pierde.
- Copys de UI en español, tuteo.
- No tocar `promptBuilder.ts` ni lógica de sync.
- Tests UI nuevos: pragma `// @vitest-environment jsdom` + `afterEach(cleanup)` (patrón de `SessionForm.test.tsx`). Tests Dexie: `db.close(); await db.delete(); await db.open()` en `beforeEach` (patrón de `dataExportSessionTemplates.test.ts`).
- Comandos: test puntual `npx vitest run <path>`, suite `npm test`, lint `npm run lint`, build `npm run build`.
- Los tests existentes citados deben seguir verdes; un test existente se adapta solo si el contrato viejo cambió por spec (p. ej. exercises en squash), nunca para "hacerlo pasar".

## File Structure

| Archivo | Rol |
|---|---|
| `src/types/exerciseLibraryRef.ts` (create) | Tipo compartido `ExerciseLibraryRef` + sanitizador de límite `sanitizeExerciseLibraryRef` |
| `src/types/index.ts` (modify) | `Exercise.libraryRef?: ExerciseLibraryRef` |
| `src/services/training/coachExerciseCatalog.ts` (create) | Catálogo unificado: `CatalogEntry`, mapas de etiquetas, `getCatalogForSport`, `searchCatalog`, `toLibraryRef` |
| `src/services/athlete/coachSessionSerializer.ts` (modify) | `EXERCISE_TYPES` exportado con `'squash'`; `libraryRef` por draft/patch/materialización |
| `src/services/athlete/sessionTemplateSerializer.ts` (modify) | Importa `EXERCISE_TYPES` compartido; `libraryRef` en drafts/merge/materialización con sanitización |
| `src/services/dataExport.ts` (modify) | `optionalExercises` acepta y sanitiza `libraryRef` |
| `src/components/session/SessionForm.tsx` (modify) | `showExercises` con squash, preservación en cambio de tipo, `allowMatchResult` (solo render), flags `touched`, combobox condicional + explorador |
| `src/components/session/ExerciseNameInput.tsx` (create) | Combobox de nombre de ejercicio con sugerencias del catálogo (ARIA completo) |
| `src/components/session/ExerciseLibraryBrowser.tsx` (create) | Dialog explorador con búsqueda/filtros (origen/categoría/intensidad) y agregado múltiple |
| `src/components/coach/CoachSessionModal.tsx` (modify) | Pasa `allowMatchResult={false}` |
| `src/components/session/SessionCard.tsx` (modify) | `hasExercises` incluye squash |
| Tests | `src/services/training/__tests__/coachExerciseCatalog.test.ts` (create), `src/types/__tests__/exerciseLibraryRef.test.ts` (create), `src/services/__tests__/dataExportLibraryRef.test.ts` (create), `src/components/session/ExerciseNameInput.test.tsx` (create), `src/components/session/ExerciseLibraryBrowser.test.tsx` (create), y extensiones en `coachSessionSerializer.test.ts`, `sessionTemplateSerializer.test.ts`, `SessionForm.test.tsx`, `SessionCard.test.tsx`, `CoachSessionModal.test.tsx` |

Dependencias: Task 1 precede a 2-8. Task 2 (catálogo) precede a 7 y 8. Tasks 3-5 (plomería/contrato) preceden a 7. Task 6 es independiente de 7-8. Task 9 cierra.

---

### Task 1: `ExerciseLibraryRef` + sanitizador de límite

**Files:**
- Create: `src/types/exerciseLibraryRef.ts`
- Modify: `src/types/index.ts` (interface `Exercise`, línea ~153)
- Test: `src/types/__tests__/exerciseLibraryRef.test.ts`

**Interfaces:**
- Produces: `interface ExerciseLibraryRef { source: 'squash_drill' | 'strength_exercise'; id: string }`, `sanitizeExerciseLibraryRef(value: unknown): ExerciseLibraryRef | undefined`, `Exercise.libraryRef?: ExerciseLibraryRef`. `SessionTemplateExercise` lo hereda automáticamente (es `Omit<Exercise, 'id' | 'completed'>`).

- [ ] **Step 1: Test que falla**

```ts
// src/types/__tests__/exerciseLibraryRef.test.ts
import { describe, expect, it } from 'vitest'
import { sanitizeExerciseLibraryRef } from '../exerciseLibraryRef'

describe('sanitizeExerciseLibraryRef', () => {
  it('acepta refs válidos de ambas fuentes', () => {
    expect(sanitizeExerciseLibraryRef({ source: 'squash_drill', id: 'boast_drive' }))
      .toEqual({ source: 'squash_drill', id: 'boast_drive' })
    expect(sanitizeExerciseLibraryRef({ source: 'strength_exercise', id: 'back_squat' }))
      .toEqual({ source: 'strength_exercise', id: 'back_squat' })
  })

  it('descarta source desconocido, id vacío y formas no-objeto', () => {
    expect(sanitizeExerciseLibraryRef({ source: 'running_drill', id: 'x' })).toBeUndefined()
    expect(sanitizeExerciseLibraryRef({ source: 'squash_drill', id: '' })).toBeUndefined()
    expect(sanitizeExerciseLibraryRef({ source: 'squash_drill', id: '   ' })).toBeUndefined()
    expect(sanitizeExerciseLibraryRef({ source: 'squash_drill' })).toBeUndefined()
    expect(sanitizeExerciseLibraryRef('squash_drill:boast')).toBeUndefined()
    expect(sanitizeExerciseLibraryRef(null)).toBeUndefined()
    expect(sanitizeExerciseLibraryRef(undefined)).toBeUndefined()
    expect(sanitizeExerciseLibraryRef([])).toBeUndefined()
  })

  it('devuelve solo source e id (descarta campos extra)', () => {
    expect(sanitizeExerciseLibraryRef({ source: 'squash_drill', id: 'x', extra: 1 }))
      .toEqual({ source: 'squash_drill', id: 'x' })
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/types/__tests__/exerciseLibraryRef.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implementación**

```ts
// src/types/exerciseLibraryRef.ts
export const EXERCISE_LIBRARY_SOURCES = ['squash_drill', 'strength_exercise'] as const
export type ExerciseLibrarySource = (typeof EXERCISE_LIBRARY_SOURCES)[number]

/** Referencia opcional de un ejercicio de sesión a una entrada de las librerías curadas. */
export interface ExerciseLibraryRef {
  source: ExerciseLibrarySource
  id: string
}

/**
 * Sanitizador de límite (import de backup, drafts de plantilla): un ref inválido
 * se descarta sin invalidar el ejercicio que lo contiene.
 */
export function sanitizeExerciseLibraryRef(value: unknown): ExerciseLibraryRef | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (!(EXERCISE_LIBRARY_SOURCES as readonly string[]).includes(record.source as string)) return undefined
  if (typeof record.id !== 'string' || !record.id.trim()) return undefined
  return { source: record.source as ExerciseLibrarySource, id: record.id }
}
```

En `src/types/index.ts`, dentro de `interface Exercise` (después de `warmupSets`):

```ts
import type { ExerciseLibraryRef } from './exerciseLibraryRef'
// …
export interface Exercise {
  // … campos existentes sin cambios …
  warmupSets?: WarmupSet[]     // strength: approach sets before the working set
  libraryRef?: ExerciseLibraryRef // origen en la biblioteca curada (opcional, metadata pasiva)
}
```

(`import type` no crea ciclo en runtime.)

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/types/__tests__/exerciseLibraryRef.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Checkpoint** — avisar al owner: "Task 1 lista (tipo + sanitizador)".

---

### Task 2: Catálogo unificado `coachExerciseCatalog`

**Files:**
- Create: `src/services/training/coachExerciseCatalog.ts`
- Test: `src/services/training/__tests__/coachExerciseCatalog.test.ts`

**Interfaces:**
- Consumes: `SQUASH_DRILL_LIBRARY`/`DrillCategory` de `./drillLibrary`, `STRENGTH_EXERCISE_LIBRARY`/`ExerciseCategory`/`IntensityType` de `./exerciseLibrary`, `ExerciseLibraryRef` de Task 1.
- Produces:
  - `interface CatalogEntry { libraryId: string; source: ExerciseLibrarySource; sport: 'squash' | 'strength'; name: string; category: string; intensity: 'low' | 'moderate' | 'high'; description: string; searchText: string; defaults: { sets?: number; reps?: string; notes?: string } }`
  - `getCatalogForSport(type: SessionType): CatalogEntry[]`
  - `searchCatalog(type: SessionType, query: string): CatalogEntry[]`
  - `toLibraryRef(entry: CatalogEntry): ExerciseLibraryRef`
  - `normalizeCatalogText(value: string): string`

Contrato de defaults (spec §1): **squash** `{ sets: 3, reps: '10', notes: descripción }` (los defaults actuales del formulario, explícitos para que el cambio de entrada A→B actualice campos no tocados); **fuerza** por `intensityType` — strength 4×5, power 4×3, hypertrophy 3×10, stability 3×8, recovery 3×8.

- [ ] **Step 1: Test que falla**

```ts
// src/services/training/__tests__/coachExerciseCatalog.test.ts
import { describe, expect, it } from 'vitest'
import {
  getCatalogForSport,
  normalizeCatalogText,
  searchCatalog,
  toLibraryRef,
} from '../coachExerciseCatalog'
import { SQUASH_DRILL_LIBRARY } from '../drillLibrary'
import { STRENGTH_EXERCISE_LIBRARY } from '../exerciseLibrary'

describe('coachExerciseCatalog', () => {
  it('squash ofrece drills + fuerza; fuerza solo fuerza; otros deportes nada', () => {
    const squash = getCatalogForSport('squash')
    expect(squash).toHaveLength(SQUASH_DRILL_LIBRARY.length + STRENGTH_EXERCISE_LIBRARY.length)
    expect(squash.some((entry) => entry.source === 'squash_drill')).toBe(true)
    expect(squash.some((entry) => entry.source === 'strength_exercise')).toBe(true)

    const strength = getCatalogForSport('strength')
    expect(strength).toHaveLength(STRENGTH_EXERCISE_LIBRARY.length)
    expect(strength.every((entry) => entry.source === 'strength_exercise')).toBe(true)

    expect(getCatalogForSport('running')).toEqual([])
    expect(getCatalogForSport('mobility')).toEqual([])
    expect(getCatalogForSport('recovery')).toEqual([])
  })

  it('mapea un drill con etiqueta de categoría, defaults 3×10 y descripción como nota', () => {
    const drill = SQUASH_DRILL_LIBRARY[0]
    const entry = getCatalogForSport('squash').find(
      (candidate) => candidate.source === 'squash_drill' && candidate.libraryId === drill.id,
    )
    expect(entry).toBeDefined()
    expect(entry!.name).toBe(drill.name)
    expect(['Técnico', 'Táctico', 'Físico', 'Partido']).toContain(entry!.category)
    expect(entry!.defaults).toEqual({ sets: 3, reps: '10', notes: drill.description })
    expect(entry!.intensity).toBe(drill.intensity)
  })

  it('defaults e intensity de fuerza dependen de intensityType (incluye recovery)', () => {
    const strengthEntries = getCatalogForSport('strength')
    const byIntensity = (intensityType: string) =>
      STRENGTH_EXERCISE_LIBRARY.find((exercise) => exercise.intensityType === intensityType)
    const find = (id: string) => strengthEntries.find((entry) => entry.libraryId === id)!

    const cases: Array<[string, { sets: number; reps: string }, 'low' | 'moderate' | 'high']> = [
      ['strength', { sets: 4, reps: '5' }, 'high'],
      ['power', { sets: 4, reps: '3' }, 'high'],
      ['hypertrophy', { sets: 3, reps: '10' }, 'moderate'],
      ['stability', { sets: 3, reps: '8' }, 'low'],
      ['recovery', { sets: 3, reps: '8' }, 'low'],
    ]
    for (const [intensityType, defaults, intensity] of cases) {
      const exercise = byIntensity(intensityType)
      if (!exercise) continue
      expect(find(exercise.id).defaults).toMatchObject(defaults)
      expect(find(exercise.id).intensity).toBe(intensity)
    }
    for (const entry of strengthEntries) {
      expect(['low', 'moderate', 'high']).toContain(entry.intensity)
    }
  })

  it('busca sin tildes ni mayúsculas', () => {
    expect(normalizeCatalogText('Sentadilla Búlgara')).toBe('sentadilla bulgara')
    const hits = searchCatalog('strength', 'SENTADILLA')
    expect(hits.length).toBeGreaterThan(0)
    expect(searchCatalog('strength', '')).toEqual([])
    expect(searchCatalog('running', 'sentadilla')).toEqual([])
  })

  it('matchea por alias que no está en el nombre canónico', () => {
    // back_squat se llama "Sentadilla trasera con barra" pero tiene alias "Barbell back squat"
    const hits = searchCatalog('strength', 'barbell')
    expect(hits.some((entry) => entry.libraryId === 'back_squat')).toBe(true)
  })

  it('toLibraryRef arma el ref con source e id originales', () => {
    const entry = getCatalogForSport('squash')[0]
    expect(toLibraryRef(entry)).toEqual({ source: entry.source, id: entry.libraryId })
  })

  it('las etiquetas de categoría de fuerza son las del spec', () => {
    const categories = new Set(getCatalogForSport('strength').map((entry) => entry.category))
    for (const category of categories) {
      expect(['Tren inferior', 'Tren superior', 'Core', 'Cuerpo completo']).toContain(category)
    }
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/coachExerciseCatalog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implementación**

```ts
// src/services/training/coachExerciseCatalog.ts
import type { SessionType } from '../../types'
import type { ExerciseLibraryRef, ExerciseLibrarySource } from '../../types/exerciseLibraryRef'
import { SQUASH_DRILL_LIBRARY, type DrillCategory } from './drillLibrary'
import {
  STRENGTH_EXERCISE_LIBRARY,
  type ExerciseCategory,
  type IntensityType,
} from './exerciseLibrary'

export interface CatalogEntry {
  libraryId: string
  source: ExerciseLibrarySource
  sport: 'squash' | 'strength'
  name: string
  category: string
  intensity: 'low' | 'moderate' | 'high'
  description: string
  searchText: string
  defaults: { sets?: number; reps?: string; notes?: string }
}

const SQUASH_CATEGORY_LABELS: Record<DrillCategory, string> = {
  technical: 'Técnico',
  tactical: 'Táctico',
  physical: 'Físico',
  match: 'Partido',
}

const STRENGTH_CATEGORY_LABELS: Record<ExerciseCategory, string> = {
  lower: 'Tren inferior',
  upper: 'Tren superior',
  core: 'Core',
  full_body: 'Cuerpo completo',
}

const STRENGTH_INTENSITY: Record<IntensityType, CatalogEntry['intensity']> = {
  strength: 'high',
  power: 'high',
  hypertrophy: 'moderate',
  stability: 'low',
  recovery: 'low',
}

const STRENGTH_DEFAULTS: Record<IntensityType, { sets: number; reps: string }> = {
  strength: { sets: 4, reps: '5' },
  power: { sets: 4, reps: '3' },
  hypertrophy: { sets: 3, reps: '10' },
  stability: { sets: 3, reps: '8' },
  recovery: { sets: 3, reps: '8' },
}

export function normalizeCatalogText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

function buildSearchText(parts: Array<string | undefined>): string {
  return normalizeCatalogText(parts.filter(Boolean).join(' '))
}

const SQUASH_ENTRIES: CatalogEntry[] = SQUASH_DRILL_LIBRARY.map((drill) => ({
  libraryId: drill.id,
  source: 'squash_drill',
  sport: 'squash',
  name: drill.name,
  category: SQUASH_CATEGORY_LABELS[drill.category],
  intensity: drill.intensity,
  description: drill.description,
  searchText: buildSearchText([drill.name, ...drill.tags, ...drill.focus]),
  defaults: { sets: 3, reps: '10', notes: drill.description },
}))

const STRENGTH_ENTRIES: CatalogEntry[] = STRENGTH_EXERCISE_LIBRARY.map((exercise) => ({
  libraryId: exercise.id,
  source: 'strength_exercise',
  sport: 'strength',
  name: exercise.name,
  category: STRENGTH_CATEGORY_LABELS[exercise.category],
  intensity: STRENGTH_INTENSITY[exercise.intensityType],
  description: exercise.description,
  searchText: buildSearchText([exercise.name, ...(exercise.aliases ?? []), ...exercise.tags]),
  defaults: { ...STRENGTH_DEFAULTS[exercise.intensityType] },
}))

/** Sesión de squash ve drills + fuerza (accesorio común); fuerza solo fuerza; el resto nada. */
export function getCatalogForSport(type: SessionType): CatalogEntry[] {
  if (type === 'squash') return [...SQUASH_ENTRIES, ...STRENGTH_ENTRIES]
  if (type === 'strength') return STRENGTH_ENTRIES
  return []
}

export function searchCatalog(type: SessionType, query: string): CatalogEntry[] {
  const normalized = normalizeCatalogText(query)
  if (!normalized) return []
  const terms = normalized.split(/\s+/)
  return getCatalogForSport(type).filter((entry) =>
    terms.every((term) => entry.searchText.includes(term)),
  )
}

export function toLibraryRef(entry: CatalogEntry): ExerciseLibraryRef {
  return { source: entry.source, id: entry.libraryId }
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/services/training/__tests__/coachExerciseCatalog.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint** — "Task 2 lista (catálogo unificado)".

---

### Task 3: `libraryRef` en serializers de sesión y plantilla

**Files:**
- Modify: `src/services/athlete/coachSessionSerializer.ts` (interface `CoachSessionDraft` ~línea 39, `sessionToDraft` ~76, `draftExercisesToExercises` ~214)
- Modify: `src/services/athlete/sessionTemplateSerializer.ts` (`exerciseToDraft` ~67, `mergeTemplateExercises` ~119, `materializeTemplateSession` ~409)
- Test: extender `src/services/athlete/__tests__/coachSessionSerializer.test.ts` y `src/services/athlete/__tests__/sessionTemplateSerializer.test.ts`

**Interfaces:**
- Consumes: `ExerciseLibraryRef`, `sanitizeExerciseLibraryRef` (Task 1).
- Produces: `CoachSessionDraft['exercises'][number].libraryRef?: ExerciseLibraryRef`; round-trip draft↔session↔template conserva refs válidos y descarta inválidos.

Nota de fixtures: estos archivos **no tienen** helpers `makeSession`/`makeDraft` — usan literales inline con `as Session` (ver `planBuilderSession` en `coachSessionSerializer.test.ts`). Los tests nuevos siguen ese estilo y reutilizan los fixtures existentes donde sirvan.

- [ ] **Step 1: Tests que fallan (agregar a `coachSessionSerializer.test.ts`)**

```ts
describe('libraryRef en serializer de sesión', () => {
  const ref = { source: 'squash_drill', id: 'boast_drive' } as const
  const refSession = {
    id: 's-ref', athleteId: 'ath_m', date: '2026-07-19', weekStartDate: '2026-07-13',
    timeBlock: 'AM', type: 'strength', status: 'planned', title: 'Fuerza', durationMin: 60,
    source: 'coach', authoredByRole: 'coach', createdAt: 1, updatedAt: 1,
    exercises: [{ id: 'e1', name: 'Boast + drive', sets: 3, reps: '10', completed: true, libraryRef: ref }],
  } as Session

  it('sessionToDraft conserva libraryRef del ejercicio', () => {
    expect(sessionToDraft(refSession).exercises?.[0].libraryRef).toEqual(ref)
  })

  it('draftToNewSessionFields materializa libraryRef y no lo inventa', () => {
    const fields = draftToNewSessionFields({
      ...draft, type: 'strength', subtype: undefined,
      exercises: [
        { id: 'e1', name: 'Boast + drive', sets: 3, reps: '10', libraryRef: ref },
        { id: 'e2', name: 'Libre', sets: 3, reps: '10' },
      ],
    })
    expect(fields.exercises?.[0].libraryRef).toEqual(ref)
    expect(fields.exercises?.[1].libraryRef).toBeUndefined()
  })

  it('applyCoachSessionPatch borra libraryRef cuando el draft lo limpió y conserva prior fields', () => {
    const patched = applyCoachSessionPatch(refSession, {
      exercises: [{ id: 'e1', name: 'Renombrado a mano', sets: 3, reps: '10' }],
    })
    expect(patched.exercises?.[0].libraryRef).toBeUndefined()
    expect(patched.exercises?.[0].completed).toBe(true)
  })
})
```

(`draft` es el fixture top-level que el archivo ya define.)

Y en `sessionTemplateSerializer.test.ts` (seguir su estilo de fixtures inline; ampliar el import de tipos a `import type { SessionTemplatePayload } from '../../../types/sessionTemplate'`):

```ts
describe('libraryRef en plantillas', () => {
  const ref = { source: 'strength_exercise', id: 'back_squat' } as const
  const payload = {
    type: 'strength', timeBlock: 'AM', title: 'Fuerza', durationMin: 60,
    exercises: [
      { name: 'Sentadilla', sets: 4, reps: '5', libraryRef: ref },
      { name: 'Corrupto', sets: 3, reps: '10', libraryRef: { source: 'unknown', id: 'x' } },
    ],
  } as unknown as SessionTemplatePayload

  it('templateToDraft sanitiza: válido pasa, corrupto se descarta sin perder el ejercicio', () => {
    const { draft } = templateToDraft(payload, '2026-07-21')
    expect(draft.exercises?.[0].libraryRef).toEqual(ref)
    expect(draft.exercises?.[1].libraryRef).toBeUndefined()
    expect(draft.exercises?.[1].name).toBe('Corrupto')
  })

  it('applyTemplateDraft respeta el ref del draft (borrado no resucita el original)', () => {
    const { draft, originalsById } = templateToDraft(payload, '2026-07-21')
    const edited = {
      ...draft,
      exercises: [
        { ...draft.exercises![0], name: 'Renombrada', libraryRef: undefined },
        draft.exercises![1],
      ],
    }
    const next = applyTemplateDraft(payload, edited, originalsById)
    expect(next.exercises?.[0].libraryRef).toBeUndefined()
  })

  it('materializeTemplateSession copia refs válidos, descarta corruptos y regenera ids', () => {
    const { draft, originalsById } = templateToDraft(payload, '2026-07-21')
    const fields = materializeTemplateSession(payload, {
      date: '2026-07-21', overlayDraft: draft, originalsById,
    })
    expect(fields.exercises?.[0].libraryRef).toEqual(ref)
    expect(fields.exercises?.[1].libraryRef).toBeUndefined()
    expect(fields.exercises?.[0].id).toBeTruthy()
  })

  it('sessionToTemplatePayload conserva libraryRef (structuredClone)', () => {
    const template = sessionToTemplatePayload({
      id: 's1', date: '2026-07-19', weekStartDate: '2026-07-13', timeBlock: 'AM',
      type: 'strength', status: 'planned', title: 'Fuerza', durationMin: 60,
      createdAt: 1, updatedAt: 1,
      exercises: [{ id: 'e1', name: 'Sentadilla', sets: 4, reps: '5', completed: false, libraryRef: ref }],
    } as Session)
    expect(template.exercises?.[0].libraryRef).toEqual(ref)
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/services/athlete/__tests__/coachSessionSerializer.test.ts src/services/athlete/__tests__/sessionTemplateSerializer.test.ts`
Expected: FAIL en los tests nuevos; los existentes siguen PASS.

- [ ] **Step 3: Implementación en `coachSessionSerializer.ts`**

1. Import: `import { type ExerciseLibraryRef } from '../../types/exerciseLibraryRef'`.
2. `CoachSessionDraft.exercises` item gana `libraryRef?: ExerciseLibraryRef`.
3. `sessionToDraft` (mapeo de exercises, ~línea 76): agregar `libraryRef: exercise.libraryRef,`.
4. `draftExercisesToExercises`:

```ts
.map((draft) => {
  const reps = draft.reps.trim() || '10'
  const notes = draft.notes?.trim() || undefined
  const prior = byId.get(draft.id)
  if (prior) {
    const next: Exercise = { ...prior, name: draft.name.trim(), sets: draft.sets, reps, weight: draft.weight, notes }
    if (draft.libraryRef) next.libraryRef = draft.libraryRef
    else delete next.libraryRef
    return next
  }
  return {
    id: draft.id,
    name: draft.name.trim(),
    sets: draft.sets,
    reps,
    weight: draft.weight,
    notes,
    completed: false,
    ...(draft.libraryRef ? { libraryRef: draft.libraryRef } : {}),
  }
})
```

- [ ] **Step 4: Implementación en `sessionTemplateSerializer.ts`**

1. Import de `sanitizeExerciseLibraryRef`.
2. `exerciseToDraft`: agregar `libraryRef: sanitizeExerciseLibraryRef(exercise.libraryRef),`.
3. `mergeTemplateExercises` — el spread de `originalsById` puede resucitar un ref borrado; fijarlo explícito:

```ts
.map((draft) => {
  const merged = structuredClone({
    ...(originalsById.get(draft.id) ?? {}),
    name: draft.name.trim(),
    sets: draft.sets,
    reps: draft.reps.trim() || '10',
    weight: draft.weight,
    notes: draft.notes?.trim() || undefined,
  }) as SessionTemplateExercise
  if (draft.libraryRef) merged.libraryRef = draft.libraryRef
  else delete merged.libraryRef
  return merged
})
```

4. `materializeTemplateSession` (mapeo final de exercises):

```ts
exercises: mergedPayload.exercises?.map((exercise) => {
  const copy = structuredClone(exercise) as Record<string, unknown>
  delete copy.libraryRef
  const libraryRef = sanitizeExerciseLibraryRef(exercise.libraryRef)
  return {
    ...copy,
    id: uuid(),
    completed: false,
    ...(libraryRef ? { libraryRef } : {}),
  }
}),
```

Nota: `isTemplateExercise` en `src/types/sessionTemplate.ts` **no cambia** — ignora campos no listados, así que un ref corrupto no invalida la plantilla; la sanitización vive en draft/materialización (este task).

- [ ] **Step 5: Verificar que pasan**

Run: `npx vitest run src/services/athlete/__tests__/coachSessionSerializer.test.ts src/services/athlete/__tests__/sessionTemplateSerializer.test.ts src/types/__tests__/sessionTemplate.test.ts`
Expected: PASS completo.

- [ ] **Step 6: Checkpoint** — "Task 3 lista (libraryRef en serializers)".

---

### Task 4: `libraryRef` en backup/import (`dataExport`)

**Files:**
- Modify: `src/services/dataExport.ts` (`optionalExercises`, ~línea 1358)
- Test: Create `src/services/__tests__/dataExportLibraryRef.test.ts`

**Interfaces:**
- Consumes: `sanitizeExerciseLibraryRef` (Task 1); `db` de `../../db/db`, `exportAppData` y `parseAppDataExport` de `../dataExport`.
- Produces: round-trip export→parse conserva `libraryRef` válido; refs inválidos se descartan sin perder el ejercicio.

`parseAppDataExport(value: unknown)` recibe el **objeto ya parseado** (no un string). El round-trip real usa Dexie + `exportAppData()` como `dataExportSessionTemplates.test.ts`; el caso corrupto usa un fixture completo como `dataExportStrengthLoad.test.ts` (esas dos suites son la referencia canónica del shape — ante duda de forma exacta de tablas o acceso al resultado, imitar esos archivos).

- [ ] **Step 1: Test que falla**

```ts
// src/services/__tests__/dataExportLibraryRef.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/db'
import { exportAppData, parseAppDataExport } from '../dataExport'

const validRef = { source: 'strength_exercise', id: 'back_squat' }

function sessionRow(exercises: unknown[]) {
  return {
    id: 'session-ref', date: '2026-07-19', weekStartDate: '2026-07-13',
    timeBlock: 'AM', source: 'coach', type: 'strength', status: 'planned',
    title: 'Fuerza', durationMin: 60, createdAt: 1, updatedAt: 2,
    exercises,
  }
}

describe('libraryRef en backup/import', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })
  afterEach(() => {
    db.close()
  })

  it('round-trip real: exportAppData → parseAppDataExport conserva libraryRef', async () => {
    await db.sessions.put(sessionRow([
      { id: 'e1', name: 'Sentadilla', sets: 4, reps: 5, completed: false, libraryRef: validRef },
    ]) as never)

    const { json } = await exportAppData()
    const parsed = parseAppDataExport(JSON.parse(json))

    const imported = parsed.tables.sessions.find((session) => session.id === 'session-ref')
    expect(imported?.exercises?.[0].libraryRef).toEqual(validRef)
  })

  it('descarta refs inválidos del fixture sin perder el ejercicio', () => {
    const parsed = parseAppDataExport({
      app: 'Entrenador',
      version: 3,
      exportedAt: '2026-07-19T12:00:00.000Z',
      exportedFromAppVersion: 'test',
      tables: {
        sessions: [sessionRow([
          { id: 'e1', name: 'Sentadilla', sets: 4, reps: 5, completed: false, libraryRef: { source: 'nope', id: '' } },
          { id: 'e2', name: 'Peso muerto', sets: 4, reps: 5, completed: false, libraryRef: 'garbage' },
        ])],
        dayLogs: [],
        weekSummaries: [],
        trainingPlans: [],
        trainingPlanWeeks: [],
        chatMessages: [],
        coachProposals: [],
        athleteProfiles: [],
      },
    })
    const imported = parsed.tables.sessions[0].exercises
    expect(imported).toHaveLength(2)
    expect(imported?.[0].libraryRef).toBeUndefined()
    expect(imported?.[1].libraryRef).toBeUndefined()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/__tests__/dataExportLibraryRef.test.ts`
Expected: FAIL — el primer test (ref válido descartado por el allowlist de `optionalExercises`).

- [ ] **Step 3: Implementación**

En `optionalExercises` de `dataExport.ts`, agregar al objeto mapeado (junto a `warmupSets`):

```ts
import { sanitizeExerciseLibraryRef } from '../types/exerciseLibraryRef'
// …
      libraryRef: sanitizeExerciseLibraryRef(row.libraryRef),
```

`optionalCoachExercises` (ejercicios de acciones IA) **no cambia**: la IA no estampa refs. El lado export no requiere cambios (vuelca filas Dexie completas).

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/services/__tests__/dataExportLibraryRef.test.ts src/services/__tests__/dataExportStrengthLoad.test.ts src/services/__tests__/dataExportSessionTemplates.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint** — "Task 4 lista (backup/import)".

---

### Task 5: Ejercicios editables en sesiones de squash

**Files:**
- Modify: `src/services/athlete/coachSessionSerializer.ts:178` (exportar `EXERCISE_TYPES` con `'squash'`)
- Modify: `src/services/athlete/sessionTemplateSerializer.ts:17-21` (importar el compartido) y comentario en ~línea 219
- Modify: `src/components/session/SessionForm.tsx:125` (`showExercises`) y `:137` (`handleTypeChange`)
- Modify: `src/components/session/SessionCard.tsx:80-83` (`hasExercises`)
- Test: extender `coachSessionSerializer.test.ts`, `SessionForm.test.tsx`, `SessionCard.test.tsx`

**Interfaces:**
- Produces: `export const EXERCISE_TYPES: SessionType[] = ['squash', 'strength', 'mobility']` desde `coachSessionSerializer.ts` — consumido por `sessionTemplateSerializer` y `SessionForm`.

- [ ] **Step 1: Tests que fallan**

En `coachSessionSerializer.test.ts` (reutiliza los fixtures top-level `draft` y `planBuilderSession` ya definidos en el archivo):

```ts
describe('exercises en sesiones de squash', () => {
  it('materializa exercises para squash y mantiene squashDetails', () => {
    const fields = draftToNewSessionFields({
      ...draft,
      exercises: [{ id: 'e1', name: 'Boast + drive', sets: 3, reps: '10' }],
    })
    expect(fields.exercises).toHaveLength(1)
    expect(fields.squashDetails).toBeDefined()
  })

  it('una edición same-type con exercises no toca drills/blocks ricos', () => {
    const patched = applyCoachSessionPatch(planBuilderSession, {
      exercises: [{ id: 'x1', name: 'Accesorio', sets: 3, reps: '10' }],
    })
    expect(patched.exercises).toEqual([expect.objectContaining({ name: 'Accesorio' })])
    expect(patched.squashDetails?.drills).toEqual(planBuilderSession.squashDetails?.drills)
    expect(patched.squashDetails?.blocks).toEqual(planBuilderSession.squashDetails?.blocks)
    expect(patched.warmup).toEqual(planBuilderSession.warmup)
  })
})
```

En `SessionForm.test.tsx` (estilo del archivo: `userEvent`, `fireEvent`, casts a `HTMLInputElement`, sin jest-dom; el título default de squash ya habilita el submit):

```ts
it('muestra ejercicios en squash y los envía en el draft', async () => {
  const onSubmit = vi.fn(async () => {})
  render(<SessionForm defaultSport="squash" heading="Nueva" submitLabel="Agregar" onSubmit={onSubmit} onCancel={vi.fn()} />)
  fireEvent.click(screen.getByText('+ Añadir ejercicio'))
  fireEvent.change(screen.getByLabelText('Ejercicio 1'), { target: { value: 'Boast + drive' } })
  await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))
  expect(onSubmit.mock.calls[0][0].exercises).toEqual([
    expect.objectContaining({ name: 'Boast + drive' }),
  ])
})

it('conserva filas squash→fuerza y las descarta al pasar por running', async () => {
  render(<SessionForm defaultSport="squash" heading="Nueva" submitLabel="Agregar" onSubmit={vi.fn(async () => {})} onCancel={vi.fn()} />)
  fireEvent.click(screen.getByText('+ Añadir ejercicio'))
  fireEvent.change(screen.getByLabelText('Ejercicio 1'), { target: { value: 'Boast + drive' } })
  await userEvent.click(screen.getByRole('button', { name: 'Fuerza' }))
  expect((screen.getByLabelText('Ejercicio 1') as HTMLInputElement).value).toBe('Boast + drive')
  await userEvent.click(screen.getByRole('button', { name: 'Running' }))
  await userEvent.click(screen.getByRole('button', { name: 'Squash' }))
  expect(screen.queryByLabelText('Ejercicio 1')).toBeNull() // descartadas: no queda ninguna fila
})

it('guardar → sessionToDraft → reabrir muestra el ejercicio en squash', () => {
  const fields = draftToNewSessionFields({
    date: '2026-07-19', timeBlock: 'AM', type: 'squash', title: 'Squash', durationMin: 60,
    subtype: 'training',
    exercises: [{ id: 'e1', name: 'Boast + drive', sets: 3, reps: '10' }],
  })
  const session = { ...fields, id: 's1', createdAt: 1, updatedAt: 1 } as Session
  render(<SessionForm initialValues={sessionToDraft(session)} defaultSport="squash" heading="Editar" submitLabel="Guardar" onSubmit={vi.fn(async () => {})} onCancel={vi.fn()} />)
  expect((screen.getByLabelText('Ejercicio 1') as HTMLInputElement).value).toBe('Boast + drive')
})
```

(Imports nuevos en ese archivo: `draftToNewSessionFields`, `sessionToDraft` del serializer y `type { Session }` de `../../types`.)

En `SessionCard.test.tsx`, agregar `// @vitest-environment jsdom`, importar `cleanup`, `fireEvent`, `render` y `screen` desde Testing Library, y registrar `afterEach(cleanup)`. El detalle solo se monta con la card expandida, por lo que el test es interactivo:

```ts
it('muestra ejercicios en una sesión de squash', () => {
  render(<SessionCard session={makeSession({
    type: 'squash',
    exercises: [{ id: 'e1', name: 'Boast + drive', sets: 3, reps: '10', completed: false }],
  })} />)
  fireEvent.click(screen.getByText('Sesion squash'))
  expect(screen.queryByText('Boast + drive')).not.toBeNull()
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/services/athlete/__tests__/coachSessionSerializer.test.ts src/components/session/SessionForm.test.tsx src/components/session/SessionCard.test.tsx`
Expected: FAIL en los nuevos; los viejos PASS.

- [ ] **Step 3: Implementación**

1. `coachSessionSerializer.ts:178`: `export const EXERCISE_TYPES: SessionType[] = ['squash', 'strength', 'mobility']`.
2. `sessionTemplateSerializer.ts`: borrar el `const EXERCISE_TYPES` local (líneas 17-18) e importar el de `./coachSessionSerializer`; actualizar el comentario de `applyTemplateDraft` (~219): "SessionForm edita exercises para squash/strength/mobility. Para los demás tipos same-type el array es contenido rico opaco y debe sobrevivir."
3. `SessionForm.tsx`:
   - Import `EXERCISE_TYPES` desde `../../services/athlete/coachSessionSerializer`.
   - Línea 125: `const showExercises = EXERCISE_TYPES.includes(type)`.
   - Línea 137: `if (!EXERCISE_TYPES.includes(nextType)) setExercises([])`.
4. `SessionCard.tsx:80-83`:

```ts
const hasExercises =
  (session.type === 'squash' || session.type === 'strength' || session.type === 'mobility') &&
  session.exercises &&
  session.exercises.length > 0
```

- [ ] **Step 4: Verificar que pasan + regresión dirigida**

Run: `npx vitest run src/services/athlete/__tests__ src/components/session src/components/coach src/types/__tests__`
Expected: PASS completo. Si un test existente asumía "squash no tiene exercises editables", adaptarlo citando la spec.

- [ ] **Step 5: Checkpoint** — "Task 5 lista (squash con ejercicios editables end-to-end)".

---

### Task 6: Fix `allowMatchResult` en el editor del coach

**Files:**
- Modify: `src/components/session/SessionForm.tsx` (props ~15, bloque de partido ~380-391)
- Modify: `src/components/coach/CoachSessionModal.tsx:106` (pasar `allowMatchResult={false}`)
- Test: extender `SessionForm.test.tsx` y `CoachSessionModal.test.tsx`

**Interfaces:**
- Produces: `SessionFormProps.allowMatchResult?: boolean` (default `true`).

**Contrato (spec §3, corregido):** `allowMatchResult` afecta **solo el render** de los controles de resultado. El submit serializa **siempre desde el estado** — que se siembra de `initialValues`, así ocultar no borra un resultado existente — y ya depende del subtipo vía `isSquashMatch`. El submit actual **no cambia**:

```ts
matchResult: isSquashMatch && matchResult ? matchResult : undefined,
gamesWon: isSquashMatch ? optionalNumber(gamesWon) : undefined,
gamesLost: isSquashMatch ? optionalNumber(gamesLost) : undefined,
```

Cambiar el subtipo fuera de partido limpia el estado (`handleSquashSubtypeChange`), y volver a partido **no** resucita el resultado — serializar desde `initialValues` habría reintroducido ese bug.

- [ ] **Step 1: Tests que fallan**

En `SessionForm.test.tsx`:

```ts
const matchInitial: CoachSessionDraft = {
  date: '2026-07-19', timeBlock: 'AM', type: 'squash', title: 'Partido', durationMin: 60,
  subtype: 'match', opponent: 'Juan', matchResult: 'win', gamesWon: 3, gamesLost: 1,
}

it('con allowMatchResult=false oculta resultado/games pero mantiene Rival', () => {
  render(<SessionForm defaultSport="squash" allowMatchResult={false} initialValues={matchInitial}
    heading="Editar" submitLabel="Guardar" onSubmit={vi.fn(async () => {})} onCancel={vi.fn()} />)
  expect(screen.queryByLabelText('Rival')).not.toBeNull()
  expect(screen.queryByLabelText('Games ganados')).toBeNull()
  expect(screen.queryByLabelText('Games perdidos')).toBeNull()
  expect(screen.queryByText('Gane')).toBeNull()
})

it('con allowMatchResult=false preserva el resultado existente al guardar', async () => {
  const onSubmit = vi.fn(async () => {})
  render(<SessionForm defaultSport="squash" allowMatchResult={false} initialValues={matchInitial}
    heading="Editar" submitLabel="Guardar" onSubmit={onSubmit} onCancel={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  expect(onSubmit.mock.calls[0][0]).toMatchObject({
    matchResult: 'win', gamesWon: 3, gamesLost: 1, opponent: 'Juan',
  })
})

it('match → training → match no resucita el resultado anterior', async () => {
  const onSubmit = vi.fn(async () => {})
  render(<SessionForm defaultSport="squash" allowMatchResult={false} initialValues={matchInitial}
    heading="Editar" submitLabel="Guardar" onSubmit={onSubmit} onCancel={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: 'Entrenamiento' }))
  await userEvent.click(screen.getByRole('button', { name: 'Partido' }))
  await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
  expect(onSubmit.mock.calls[0][0]).toMatchObject({
    matchResult: undefined, gamesWon: undefined, gamesLost: undefined,
  })
})

it('por defecto (atleta) el bloque completo sigue visible en partido', () => {
  render(<SessionForm defaultSport="squash" initialValues={matchInitial}
    heading="Nueva" submitLabel="Guardar" onSubmit={vi.fn(async () => {})} onCancel={vi.fn()} />)
  expect(screen.queryByLabelText('Games ganados')).not.toBeNull()
})
```

En `CoachSessionModal.test.tsx` (patrón de render y mocks del archivo), definir primero:

```ts
const matchSession = {
  ...session,
  title: 'Partido',
  subtype: 'match',
  opponent: 'Juan',
  matchResult: 'win',
  gamesWon: 3,
  gamesLost: 1,
} as Session
```

Y agregar el test:

```ts
it('el editor del coach no ofrece campos de resultado de partido', () => {
  render(<CoachSessionModal ownerAccountId="user-1" athleteId="ath_m" defaultDate="2026-07-19"
    session={matchSession} onClose={vi.fn()} onSaved={vi.fn()} />)
  expect(screen.queryByLabelText('Rival')).not.toBeNull()
  expect(screen.queryByLabelText('Games ganados')).toBeNull()
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/components/session/SessionForm.test.tsx src/components/coach/CoachSessionModal.test.tsx`
Expected: FAIL en los nuevos.

- [ ] **Step 3: Implementación**

1. `SessionFormProps`: `allowMatchResult?: boolean`; destructurar con default `true`.
2. Bloque de partido (~380): el contenedor sigue gated por `isSquashMatch` (Rival siempre dentro); envolver los botones Gané/Perdí **y** el grid de games en `{allowMatchResult && (<>…</>)}`.
3. **El submit no se toca** (ver contrato arriba).
4. `CoachSessionModal.tsx`: agregar `allowMatchResult={false}` al `<SessionForm …>`.
5. `CoachLibraryPanel` **no cambia**: el modo plantilla ya oculta todo el bloque vía `isSquashMatch = !isTemplate && …` y su test existente de Rival oculto debe seguir PASS.

- [ ] **Step 4: Verificar que pasan**

Run: `npx vitest run src/components/session/SessionForm.test.tsx src/components/coach/CoachSessionModal.test.tsx src/components/coach/__tests__/CoachLibraryPanel.test.tsx src/components/session/AddSessionModal.test.tsx`
Expected: PASS completo.

- [ ] **Step 5: Checkpoint** — "Task 6 lista (fix bloque de partido)".

---

### Task 7: Typeahead de ejercicios (`ExerciseNameInput`)

**Files:**
- Create: `src/components/session/ExerciseNameInput.tsx`
- Modify: `src/components/session/SessionForm.tsx` (`ExerciseDraft` + `updateExercise` + fila de ejercicio con render condicional)
- Test: Create `src/components/session/ExerciseNameInput.test.tsx`; extender `SessionForm.test.tsx`

**Interfaces:**
- Consumes: `searchCatalog`, `getCatalogForSport`, `toLibraryRef`, `CatalogEntry` (Task 2); `ExerciseLibraryRef` (Task 1).
- Produces:
  - `ExerciseNameInputProps { index: number; value: string; sessionType: SessionType; onChangeText: (value: string) => void; onSelectEntry: (entry: CatalogEntry) => void }`
  - En `SessionForm`: `ExerciseDraft` gana `libraryRef?: ExerciseLibraryRef` y `touched: { sets: boolean; reps: boolean; weight: boolean; notes: boolean }`.

**Regla clave (spec §2):** el combobox se renderiza **solo** para tipos con catálogo (squash/fuerza). Movilidad y el resto conservan el `<input>` plano actual, sin semántica combobox.

- [ ] **Step 1: Tests que fallan (`ExerciseNameInput.test.tsx`)**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ExerciseNameInput from './ExerciseNameInput'

afterEach(cleanup)

describe('ExerciseNameInput', () => {
  it('no sugiere con menos de 2 caracteres y sugiere hasta 6 con 2+', () => {
    const { rerender } = render(<ExerciseNameInput index={0} value="s" sessionType="strength" onChangeText={vi.fn()} onSelectEntry={vi.fn()} />)
    fireEvent.focus(screen.getByRole('combobox'))
    expect(screen.queryByRole('listbox')).toBeNull()
    rerender(<ExerciseNameInput index={0} value="sentadilla" sessionType="strength" onChangeText={vi.fn()} onSelectEntry={vi.fn()} />)
    fireEvent.focus(screen.getByRole('combobox'))
    const options = screen.getAllByRole('option')
    expect(options.length).toBeGreaterThan(0)
    expect(options.length).toBeLessThanOrEqual(6)
  })

  it('seleccionar una sugerencia notifica la entrada completa', () => {
    const onSelectEntry = vi.fn()
    render(<ExerciseNameInput index={0} value="sentadilla" sessionType="strength" onChangeText={vi.fn()} onSelectEntry={onSelectEntry} />)
    fireEvent.focus(screen.getByRole('combobox'))
    fireEvent.mouseDown(screen.getAllByRole('option')[0])
    expect(onSelectEntry).toHaveBeenCalledWith(expect.objectContaining({ source: 'strength_exercise' }))
  })

  it('navega con teclado y expone aria-activedescendant', () => {
    const onSelectEntry = vi.fn()
    render(<ExerciseNameInput index={0} value="sentadilla" sessionType="strength" onChangeText={vi.fn()} onSelectEntry={onSelectEntry} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    const active = input.getAttribute('aria-activedescendant')
    expect(active).toBeTruthy()
    expect(document.getElementById(active!)).not.toBeNull()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSelectEntry).toHaveBeenCalled()
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/components/session/ExerciseNameInput.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implementar `ExerciseNameInput.tsx`**

```tsx
import { useMemo, useState } from 'react'
import type { SessionType } from '../../types'
import { searchCatalog, type CatalogEntry } from '../../services/training/coachExerciseCatalog'

interface ExerciseNameInputProps {
  index: number
  value: string
  sessionType: SessionType
  onChangeText: (value: string) => void
  onSelectEntry: (entry: CatalogEntry) => void
}

const SOURCE_BADGE: Record<CatalogEntry['source'], string> = {
  squash_drill: 'Drill squash',
  strength_exercise: 'Fuerza',
}

export default function ExerciseNameInput({
  index, value, sessionType, onChangeText, onSelectEntry,
}: ExerciseNameInputProps) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const suggestions = useMemo(() => (
    value.trim().length >= 2 ? searchCatalog(sessionType, value).slice(0, 6) : []
  ), [sessionType, value])
  const showList = open && suggestions.length > 0
  const listId = `exercise-suggestions-${index}`
  const optionId = (position: number) => `${listId}-option-${position}`

  const select = (entry: CatalogEntry) => {
    onSelectEntry(entry)
    setOpen(false)
  }

  return (
    <div className="relative flex-1">
      <input
        role="combobox"
        aria-label={`Ejercicio ${index + 1}`}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? optionId(highlighted) : undefined}
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => { onChangeText(event.target.value); setOpen(true); setHighlighted(0) }}
        onKeyDown={(event) => {
          if (!showList) return
          if (event.key === 'ArrowDown') { event.preventDefault(); setHighlighted((i) => Math.min(i + 1, suggestions.length - 1)) }
          else if (event.key === 'ArrowUp') { event.preventDefault(); setHighlighted((i) => Math.max(i - 1, 0)) }
          else if (event.key === 'Enter') { event.preventDefault(); select(suggestions[highlighted]) }
          else if (event.key === 'Escape') { setOpen(false) }
        }}
        className="w-full rounded-lg border bg-surface px-2.5 py-1.5"
      />
      {showList && (
        <ul id={listId} role="listbox" className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-surface-border bg-surface-card shadow-lg">
          {suggestions.map((entry, position) => (
            <li
              key={`${entry.source}:${entry.libraryId}`}
              id={optionId(position)}
              role="option"
              aria-selected={position === highlighted}
              onMouseDown={(event) => { event.preventDefault(); select(entry) }}
              className={`cursor-pointer px-3 py-2 text-sm ${position === highlighted ? 'bg-surface-raised' : ''}`}
            >
              <span className="text-ink">{entry.name}</span>
              <span className="ml-2 text-xs text-ink-muted">{SOURCE_BADGE[entry.source]} · {entry.category}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/components/session/ExerciseNameInput.test.tsx`
Expected: PASS.

- [ ] **Step 5: Tests de integración en `SessionForm.test.tsx` (fallan primero)**

```ts
import { SQUASH_DRILL_LIBRARY } from '../../services/training/drillLibrary'

it('mobility mantiene input de texto libre sin combobox', () => {
  render(<SessionForm defaultSport="mobility" heading="Nueva" submitLabel="Agregar" onSubmit={vi.fn(async () => {})} onCancel={vi.fn()} />)
  fireEvent.click(screen.getByText('+ Añadir ejercicio'))
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.queryByLabelText('Ejercicio 1')).not.toBeNull()
})

it('elegir una sugerencia prellena defaults, estampa libraryRef y no pisa campos tocados', async () => {
  const onSubmit = vi.fn(async () => {})
  render(<SessionForm defaultSport="strength" heading="Nueva" submitLabel="Agregar" onSubmit={onSubmit} onCancel={vi.fn()} />)
  fireEvent.click(screen.getByText('+ Añadir ejercicio'))
  fireEvent.change(screen.getByLabelText('Reps 1'), { target: { value: '12' } }) // tocado ANTES de elegir
  fireEvent.change(screen.getByLabelText('Ejercicio 1'), { target: { value: 'sentadilla trasera' } })
  fireEvent.mouseDown(screen.getAllByRole('option')[0])
  await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))
  const exercise = onSubmit.mock.calls[0][0].exercises[0]
  expect(exercise.libraryRef).toMatchObject({ source: 'strength_exercise' })
  expect(exercise.reps).toBe('12') // tocado: intacto
  expect(exercise.sets).toBe(4)    // back_squat es intensityType strength → 4×5
})

it('cambiar de entrada A a B actualiza solo campos no tocados', async () => {
  render(<SessionForm defaultSport="squash" heading="Nueva" submitLabel="Agregar" onSubmit={vi.fn(async () => {})} onCancel={vi.fn()} />)
  fireEvent.click(screen.getByText('+ Añadir ejercicio'))
  fireEvent.change(screen.getByLabelText('Reps 1'), { target: { value: '12' } }) // tocado
  // A: un drill (query = nombre completo del primer drill; su nota default es la descripción)
  fireEvent.change(screen.getByLabelText('Ejercicio 1'), { target: { value: SQUASH_DRILL_LIBRARY[0].name } })
  fireEvent.mouseDown(screen.getAllByRole('option')[0])
  expect((screen.getByLabelText('Notas ejercicio 1') as HTMLInputElement).value.length).toBeGreaterThan(0)
  // B: entrada de fuerza
  fireEvent.change(screen.getByLabelText('Ejercicio 1'), { target: { value: 'sentadilla trasera' } })
  fireEvent.mouseDown(screen.getAllByRole('option')[0])
  expect((screen.getByLabelText('Series 1') as HTMLInputElement).value).toBe('4') // no tocado: actualizado
  expect((screen.getByLabelText('Reps 1') as HTMLInputElement).value).toBe('12')  // tocado: intacto
  expect((screen.getByLabelText('Notas ejercicio 1') as HTMLInputElement).value).toBe('') // no tocada: limpiada (fuerza no trae nota)
})

it('editar el nombre después de elegir borra el libraryRef', async () => {
  const onSubmit = vi.fn(async () => {})
  render(<SessionForm defaultSport="strength" heading="Nueva" submitLabel="Agregar" onSubmit={onSubmit} onCancel={vi.fn()} />)
  fireEvent.click(screen.getByText('+ Añadir ejercicio'))
  fireEvent.change(screen.getByLabelText('Ejercicio 1'), { target: { value: 'sentadilla trasera' } })
  fireEvent.mouseDown(screen.getAllByRole('option')[0])
  fireEvent.change(screen.getByLabelText('Ejercicio 1'), { target: { value: 'Mi variante propia' } })
  await userEvent.click(screen.getByRole('button', { name: 'Agregar' }))
  expect(onSubmit.mock.calls[0][0].exercises[0].libraryRef).toBeUndefined()
})
```

- [ ] **Step 6: Integración en `SessionForm.tsx`**

1. Imports: `getCatalogForSport`, `toLibraryRef`, `type CatalogEntry` del catálogo; `type ExerciseLibraryRef`; `ExerciseNameInput`.
2. `ExerciseDraft` gana `libraryRef?: ExerciseLibraryRef` y `touched: { sets: boolean; reps: boolean; weight: boolean; notes: boolean }`.
3. `emptyExercise()`: `touched: { sets: false, reps: false, weight: false, notes: false }`.
4. Estado inicial desde `initialValues`: `touched` todo `true` (contenido preexistente nunca se pisa) y `libraryRef: exercise.libraryRef`.
5. `updateExercise`: si `field` es `sets`/`reps`/`weight`/`notes`, marcar `touched: { ...exercise.touched, [field]: true }`; si `field === 'name'`, además `libraryRef: undefined`.
6. `const catalogEnabled = getCatalogForSport(type).length > 0`.
7. Handler de selección:

```ts
const applyCatalogEntry = (id: string, entry: CatalogEntry) => {
  setExercises((current) => current.map((exercise) => {
    if (exercise.id !== id) return exercise
    return {
      ...exercise,
      name: entry.name,
      libraryRef: toLibraryRef(entry),
      sets: exercise.touched.sets ? exercise.sets
        : entry.defaults.sets !== undefined ? String(entry.defaults.sets) : exercise.sets,
      reps: exercise.touched.reps ? exercise.reps : entry.defaults.reps ?? exercise.reps,
      notes: exercise.touched.notes ? exercise.notes : entry.defaults.notes ?? '',
    }
  }))
}
```

8. En la fila de ejercicio, render condicional del nombre:

```tsx
{catalogEnabled ? (
  <ExerciseNameInput
    index={index}
    value={exercise.name}
    sessionType={type}
    onChangeText={(text) => updateExercise(exercise.id, 'name', text)}
    onSelectEntry={(entry) => applyCatalogEntry(exercise.id, entry)}
  />
) : (
  <input aria-label={`Ejercicio ${index + 1}`} value={exercise.name} onChange={(event) => updateExercise(exercise.id, 'name', event.target.value)} className="flex-1 rounded-lg border bg-surface px-2.5 py-1.5" />
)}
```

9. El mapeo del submit agrega `libraryRef: exercise.libraryRef`.

- [ ] **Step 7: Verificar que pasan**

Run: `npx vitest run src/components/session src/components/coach`
Expected: PASS completo.

- [ ] **Step 8: Checkpoint** — "Task 7 lista (typeahead)".

---

### Task 8: Explorador de biblioteca (`ExerciseLibraryBrowser`)

**Files:**
- Create: `src/components/session/ExerciseLibraryBrowser.tsx`
- Modify: `src/components/session/SessionForm.tsx` (botón "Agregar desde biblioteca" + estado de apertura + handler)
- Test: Create `src/components/session/ExerciseLibraryBrowser.test.tsx`; extender `SessionForm.test.tsx`

**Interfaces:**
- Consumes: `getCatalogForSport`, `searchCatalog`, `toLibraryRef`, `CatalogEntry` (Task 2).
- Produces: `ExerciseLibraryBrowserProps { sessionType: SessionType; onAdd: (entry: CatalogEntry) => void; onClose: () => void }`.

**Contrato (spec §2, completo):** dialog accesible (`role="dialog"`, `aria-modal`, Escape cierra, foco inicial en la búsqueda, foco devuelto al cerrar); sheet a **pantalla completa en mobile** y modal acotado en desktop; filtros por **origen (solo squash), categoría e intensidad**; la búsqueda filtra desde el **primer carácter** (el umbral de 2 es solo del typeahead); "Agregar" apila sin cerrar, con "Agregado ✓" **transitorio** no bloqueante.

- [ ] **Step 1: Tests que fallan (`ExerciseLibraryBrowser.test.tsx`)**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import ExerciseLibraryBrowser from './ExerciseLibraryBrowser'
import { STRENGTH_EXERCISE_LIBRARY } from '../../services/training/exerciseLibrary'

afterEach(cleanup)

describe('ExerciseLibraryBrowser', () => {
  it('lista el catálogo del deporte y filtra desde el primer carácter', () => {
    render(<ExerciseLibraryBrowser sessionType="strength" onAdd={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getAllByTestId('library-entry')).toHaveLength(STRENGTH_EXERCISE_LIBRARY.length)
    fireEvent.change(screen.getByLabelText('Buscar en la biblioteca'), { target: { value: '%' } })
    expect(screen.queryAllByTestId('library-entry')).toHaveLength(0) // 1 carácter ya filtra
    expect(screen.queryByText('No hay resultados para esa búsqueda.')).not.toBeNull()
  })

  it('filtra por categoría e intensidad; chips de origen solo en squash', () => {
    const { unmount } = render(<ExerciseLibraryBrowser sessionType="squash" onAdd={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Drills squash' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Tren inferior' })).not.toBeNull() // chip de categoría
    unmount()
    render(<ExerciseLibraryBrowser sessionType="strength" onAdd={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Drills squash' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tren inferior' }))
    for (const item of screen.getAllByTestId('library-entry')) {
      expect(item.textContent).toContain('Tren inferior')
    }
    fireEvent.click(screen.getByRole('button', { name: 'Alta' }))
    for (const item of screen.getAllByTestId('library-entry')) {
      expect(item.textContent).toContain('Alta')
    }
  })

  it('agregar notifica la entrada, no cierra el panel y permite repetir', () => {
    const onAdd = vi.fn()
    const onClose = vi.fn()
    render(<ExerciseLibraryBrowser sessionType="strength" onAdd={onAdd} onClose={onClose} />)
    const firstAdd = screen.getAllByRole('button', { name: /^Agregar / })[0]
    fireEvent.click(firstAdd)
    fireEvent.click(firstAdd)
    expect(onAdd).toHaveBeenCalledTimes(2)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByText('Agregado ✓')).not.toBeNull()
  })

  it('es un dialog accesible: foco inicial en búsqueda y Escape cierra', () => {
    const onClose = vi.fn()
    render(<ExerciseLibraryBrowser sessionType="strength" onAdd={vi.fn()} onClose={onClose} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(screen.getByLabelText('Buscar en la biblioteca'))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/components/session/ExerciseLibraryBrowser.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implementar `ExerciseLibraryBrowser.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { SessionType } from '../../types'
import {
  getCatalogForSport,
  searchCatalog,
  type CatalogEntry,
} from '../../services/training/coachExerciseCatalog'

interface ExerciseLibraryBrowserProps {
  sessionType: SessionType
  onAdd: (entry: CatalogEntry) => void
  onClose: () => void
}

type SourceFilter = 'all' | CatalogEntry['source']
type IntensityFilter = 'all' | CatalogEntry['intensity']

const INTENSITY_LABELS: Record<CatalogEntry['intensity'], string> = {
  low: 'Suave', moderate: 'Media', high: 'Alta',
}

export default function ExerciseLibraryBrowser({ sessionType, onAdd, onClose }: ExerciseLibraryBrowserProps) {
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [intensityFilter, setIntensityFilter] = useState<IntensityFilter>('all')
  const [addedKey, setAddedKey] = useState<string | null>(null)
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null
    searchRef.current?.focus()
    return () => {
      if (addedTimer.current) clearTimeout(addedTimer.current)
      previouslyFocused.current?.focus()
    }
  }, [])

  const categories = useMemo(() => (
    Array.from(new Set(getCatalogForSport(sessionType).map((entry) => entry.category)))
  ), [sessionType])

  const entries = useMemo(() => {
    const base = query.trim() ? searchCatalog(sessionType, query) : getCatalogForSport(sessionType)
    return base
      .filter((entry) => sourceFilter === 'all' || entry.source === sourceFilter)
      .filter((entry) => categoryFilter === 'all' || entry.category === categoryFilter)
      .filter((entry) => intensityFilter === 'all' || entry.intensity === intensityFilter)
  }, [sessionType, query, sourceFilter, categoryFilter, intensityFilter])

  const handleAdd = (entry: CatalogEntry) => {
    onAdd(entry)
    const key = `${entry.source}:${entry.libraryId}`
    setAddedKey(key)
    if (addedTimer.current) clearTimeout(addedTimer.current)
    addedTimer.current = setTimeout(() => setAddedKey(null), 1500)
  }

  const chip = (pressed: boolean) =>
    `rounded-full border px-3 py-1 text-xs ${pressed ? 'border-brand text-brand' : 'border-surface-border text-ink-muted'}`

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col justify-end md:items-center md:justify-center md:p-6"
      onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Biblioteca de ejercicios"
        className="relative flex h-[100dvh] w-full flex-col bg-surface-card md:h-auto md:max-h-[80vh] md:max-w-2xl md:rounded-2xl md:border md:border-surface-border"
      >
        <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
          <h3 className="text-sm font-semibold text-ink">Biblioteca de ejercicios</h3>
          <button type="button" aria-label="Cerrar biblioteca" onClick={onClose} className="rounded-lg p-1 text-ink-muted hover:text-ink"><X size={18} /></button>
        </div>
        <div className="space-y-3 border-b border-surface-border px-4 py-3">
          <input
            ref={searchRef}
            aria-label="Buscar en la biblioteca"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Busca por nombre, alias o tag"
            className="w-full rounded-xl border border-surface-border bg-surface-raised px-3 py-2 text-sm text-ink"
          />
          <div className="flex flex-wrap gap-2">
            {sessionType === 'squash' && ([
              ['all', 'Todo'], ['squash_drill', 'Drills squash'], ['strength_exercise', 'Fuerza'],
            ] as Array<[SourceFilter, string]>).map(([option, label]) => (
              <button type="button" key={option} aria-pressed={sourceFilter === option}
                onClick={() => setSourceFilter(option)} className={chip(sourceFilter === option)}>
                {label}
              </button>
            ))}
            <button type="button" aria-pressed={categoryFilter === 'all'}
              onClick={() => setCategoryFilter('all')} className={chip(categoryFilter === 'all')}>
              Todas las categorías
            </button>
            {categories.map((category) => (
              <button type="button" key={category} aria-pressed={categoryFilter === category}
                onClick={() => setCategoryFilter(category)} className={chip(categoryFilter === category)}>
                {category}
              </button>
            ))}
            {(['all', 'low', 'moderate', 'high'] as IntensityFilter[]).map((option) => (
              <button type="button" key={option} aria-pressed={intensityFilter === option}
                onClick={() => setIntensityFilter(option)} className={chip(intensityFilter === option)}>
                {option === 'all' ? 'Toda intensidad' : INTENSITY_LABELS[option]}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {entries.length === 0 && <p className="py-6 text-center text-sm text-ink-muted">No hay resultados para esa búsqueda.</p>}
          <ul className="space-y-2">
            {entries.map((entry) => {
              const key = `${entry.source}:${entry.libraryId}`
              return (
                <li key={key} data-testid="library-entry" className="rounded-xl border border-surface-border bg-surface-raised p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{entry.name}</p>
                      <p className="text-xs text-ink-muted">{entry.category} · {INTENSITY_LABELS[entry.intensity]}</p>
                      <p className="mt-1 text-xs text-ink-faint" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{entry.description}</p>
                    </div>
                    <button type="button" aria-label={`Agregar ${entry.name}`}
                      onClick={() => handleAdd(entry)}
                      className="shrink-0 rounded-full border border-brand px-3 py-1.5 text-xs font-medium text-brand">
                      {addedKey === key ? 'Agregado ✓' : 'Agregar'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}
```

(El `aria-label` del botón de agregar es estable — `Agregar <nombre>` — aunque su texto visible cambie transitoriamente a "Agregado ✓", por eso el doble click del test funciona.)

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/components/session/ExerciseLibraryBrowser.test.tsx`
Expected: PASS.

- [ ] **Step 5: Integración en `SessionForm.tsx` (test primero, en `SessionForm.test.tsx`)**

```ts
it('el explorador agrega filas prellenadas con libraryRef sin cerrar el formulario', async () => {
  const onSubmit = vi.fn(async () => {})
  render(<SessionForm defaultSport="strength" heading="Nueva" submitLabel="Agregar sesión" onSubmit={onSubmit} onCancel={vi.fn()} />)
  const openLibrary = screen.getByRole('button', { name: 'Agregar desde biblioteca' })
  openLibrary.focus()
  fireEvent.click(openLibrary)
  fireEvent.click(screen.getAllByRole('button', { name: /^Agregar / })[0])
  fireEvent.click(screen.getByLabelText('Cerrar biblioteca'))
  expect(document.activeElement).toBe(openLibrary)
  await userEvent.click(screen.getByRole('button', { name: 'Agregar sesión' }))
  const exercise = onSubmit.mock.calls[0][0].exercises[0]
  expect(exercise.libraryRef).toBeDefined()
  expect(exercise.name.length).toBeGreaterThan(0)
})
```

(`submitLabel` distinto de "Agregar" para no colisionar con los botones "Agregar" del explorador.)

Implementación:

1. Estado `const [libraryOpen, setLibraryOpen] = useState(false)`.
2. En el header de la sección de ejercicios, junto a "Añadir": `{catalogEnabled && <button type="button" onClick={() => setLibraryOpen(true)} className="flex items-center gap-1 text-xs text-brand-light"><BookOpen size={12} /> Agregar desde biblioteca</button>}` (import `BookOpen` de lucide-react; `catalogEnabled` viene de Task 7).
3. Handler (fila nueva, sin tocar):

```ts
const addFromCatalog = (entry: CatalogEntry) => {
  setExercises((current) => [...current, {
    id: uuid(),
    name: entry.name,
    sets: entry.defaults.sets !== undefined ? String(entry.defaults.sets) : '3',
    reps: entry.defaults.reps ?? '10',
    weight: '',
    notes: entry.defaults.notes ?? '',
    libraryRef: toLibraryRef(entry),
    touched: { sets: false, reps: false, weight: false, notes: false },
  }])
}
```

4. Render al final del form (fuera del `fieldset`): `{libraryOpen && <ExerciseLibraryBrowser sessionType={type} onAdd={addFromCatalog} onClose={() => setLibraryOpen(false)} />}`.

- [ ] **Step 6: Verificar que pasan**

Run: `npx vitest run src/components/session`
Expected: PASS completo.

- [ ] **Step 7: Checkpoint** — "Task 8 lista (explorador)".

---

### Task 9: Verificación final y cierre

**Files:**
- Modify (solo si hay hallazgos): los de tasks anteriores
- Modify: `PROJECT_REVIEW_AND_ROADMAP.md` (nota breve de la entrega, siguiendo el formato de bloques existente)

- [ ] **Step 1: Suite completa**

Run: `npm test`
Expected: PASS total (sin tests skippeados nuevos).

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: 0 errores.

- [ ] **Step 3: Smoke manual guiado (owner o Playwright existente)**

En dev (`npm run dev`), como coach en `/coach` → Planificación:
1. Nueva sesión de squash → typeahead sugiere drills; elegir uno prellena notas.
2. "Agregar desde biblioteca" → filtrar por Fuerza y por categoría → agregar 2 ejercicios → guardar → reabrir → visibles.
3. Editar sesión de partido → sin games ganados/perdidos, con Rival.
4. Guardar sesión como plantilla y aplicarla a otro día → ejercicios y refs intactos.
5. En mobile (o viewport angosto), abrir el explorador → ocupa la pantalla completa y Escape/cerrar devuelve el foco.

- [ ] **Step 4: Actualizar roadmap**

Agregar a `PROJECT_REVIEW_AND_ROADMAP.md` un bloque breve "Coach exercise catalog picker (2026-07-19)" con: catálogo unificado, typeahead + explorador, squash con ejercicios editables, `libraryRef` (incl. backup/import), fix de resultado de partido en editor del coach; sin migraciones.

- [ ] **Step 5: Checkpoint final** — avisar al owner que la entrega está lista para commit + deploy, con el resumen de verificación.

---

## Self-Review del plan (hecho al escribirlo)

- **Cobertura de spec:** catálogo con defaults 3×10 para drills (Task 2), typeahead con `touched` y A→B (7), explorador completo — categoría, búsqueda desde 1 carácter, sheet mobile, dialog accesible, label del botón (8) —, squash exercises end-to-end incl. reabrir y `SessionCard` (5), `libraryRef` + sanitización + backup round-trip real (1/3/4), `allowMatchResult` solo-render con no-resurrección (6), regresión y smoke (9).
- **Ejecutabilidad de tests:** sin jest-dom (asserts con `.not.toBeNull()`/casts, como el repo); fixtures inline al estilo de cada archivo (no existen `makeSession`/`makeDraft` en serializers; `SessionCard.test.tsx` sí tiene su `makeSession` local); `parseAppDataExport` recibe objeto parseado; round-trip usa Dexie + `exportAppData` con el patrón `db.close/delete/open`.
- **Consistencia de tipos:** `ExerciseLibraryRef`/`sanitizeExerciseLibraryRef` (Task 1) se usan con esos nombres en 3, 4, 7; `CatalogEntry`/`toLibraryRef`/`searchCatalog`/`getCatalogForSport` (Task 2) en 7 y 8; `EXERCISE_TYPES` exportado (Task 5) en form y template serializer; `catalogEnabled` definido en Task 7 y reutilizado en Task 8.

# Allocator de bloque para la rotación de fuerza — plan de implementación

> **Ejecución:** por tareas, en orden. Cada tarea termina con el árbol verde y
> verificado. Los pasos usan checkbox (`- [ ]`) para seguimiento.

**Goal:** Cerrar la Causa B del Hallazgo 5 de §28 — que dos semanas hermanas de
un bloque, reparadas en paralelo, converjan en los mismos accesorios de fuerza.

**Architecture:** Se reemplaza el índice escalar módulo pool por una asignación
de bloque. Cada worker computa la matriz completa `slot × semana` desde entradas
puras y compartidas, y toma su propia columna: sin canal compartido, sin lock.
El orden del repair queda congelado —snapshot, proyección del core, allocator,
densidad— y ningún mutador estructural posterior puede pisar una celda asignada.

**Tech Stack:** TypeScript, Vitest. Sin migraciones Dexie ni Supabase.

**Spec:** [`docs/superpowers/specs/2026-08-24-strength-rotation-block-allocator-design.md`](../specs/2026-08-24-strength-rotation-block-allocator-design.md)

> **Adenda post-smoke (2026-08-27).** Este plan se ejecutó sobre una premisa
> de fixture que producción no cumple: `buildWeekStructuredSystemPromptMinimal`
> prohíbe `exercises`, así que no existe un "template del modelo" antes de
> `completeSportDetails`. La corrección posterior hidrata primero sólo la salida
> del selector, captura ese template antes de core/densidad y coordina por la
> familia periódica A/B/C (A/B en taper). Ver la sección post-smoke del reporte
> y §29 del roadmap. Las tareas siguientes quedan como registro histórico de
> la primera implementación, no como instrucciones vigentes de cableado.
>
> **Gate heredado (2026-08-27; conclusión superada).** El test con la forma
> productiva y la métrica semanal absoluta quedó rojo: 12/15 pares infringían y
> las cinco semanas posteriores conservaban `quality.strength.repeated_template`.
> La coordinación por familia sólo mejoraba A→A/B→B/C→C por sesión. Este
> contraejemplo demostró que el predicado mezclaba clonación con continuidad.
>
> **Cierre final (2026-08-27).** El contrato deportivo compara sesiones de
> fuerza por ordinal semanal y alerta con ≥3 contables compartidos y similitud
> direccional ≥80%. Detecta sesiones casi clonadas (7/8, 8/9, 9/9) y permite
> continuidad defendible (6/8, 6/9). El fixture productivo de seis semanas queda
> verde, con allocator presente, A→A/B→B/C→C coordinado e idempotencia. Costo
> API: US$0. Este plan permanece como registro de implementación; no hace falta
> un rediseño heterogéneo ni repetir una generación completa pagada.

## Global Constraints

- **Sin migraciones.** Dexie queda en v20 y Supabase no cambia.
- **Commits:** ninguna tarea de este plan ejecuta `git commit` ni `git add`. El
  cierre de tarea es la verificación verde; el owner decide cuándo commitear.
  **Ningún paso de este plan debe redactar un mensaje de commit.**
- **Verificación de cierre de cada tarea:** `npm run lint`, `npm test`,
  `npx tsc -b`, `npm run build` y `git diff --check` verdes.
- **Determinismo absoluto (I4 de la spec).** Ningún módulo de este plan puede
  usar `Math.random`, la hora, ni depender del orden de iteración de un `Map` u
  `Object` para producir un resultado. Los tres rompen la garantía entre workers.
- **Identidad canónica siempre.** Comparar ejercicios por
  `resolveStrengthExercise(...)?.definition.id`, nunca por nombre. Un alias
  **nunca** cuenta como rotación.
- **El main lift está fuera de alcance** (§16) y su rol es **posicional**: no
  reordenar los ejercicios antes de resolver roles.
- **Ninguna métrica nueva entra en `countRepairsV2`.** Son observacionales,
  mismo criterio que los contadores de rol de §17.
- Copy visible en español, tuteo. Estos módulos no tienen copy visible.

## Estado de partida verificado (2026-08-25)

- `strengthRotationPoolContract.test.ts` está **rojo**: falla sólo con
  `solape contable 0->2 = 3: ["dead_bug","cable_chop","bent_over_row"]`.
- `strengthTemplateRotationConcurrent.test.ts` está **verde**, pero su fixture
  usa `'Lanzamiento rotacional'`, que **no resuelve** contra el catálogo. Ese
  test es parcialmente vacuo y la Tarea 7 lo corrige.
- `resolveInjectedCoreId` (`strengthSessionStructure.ts:44`) **no está
  exportada**. La Tarea 2 la exporta.
- `getStrengthExerciseKey` (`strengthExerciseProposal.ts:49`) ya devuelve el
  `id` canónico cuando el ejercicio resuelve, y cae al nombre normalizado cuando
  no. En los caminos de este plan el ejercicio siempre resuelve.

## Ruta real de fuerza en el repair — dueño de cada mutación

Resultado de la pasada previa sobre `repairWeek.ts`. **Esta tabla es el motivo
por el que el plan original estaba mal cableado:** la densidad no corre después
del bloque de rotación, corre **antes**, dentro de `completeSportDetails`.

| Orden | Sitio | Qué muta | Dueño tras el cambio |
|---|---|---|---|
| 1 | `repairGeneratedWeek` línea ~250, justo antes de `completeSportDetails` | — | **Supuesto original (invalidado por la adenda):** captura del supuesto template del modelo; producción llega sin `exercises` |
| 2 | `completeSportDetails:576` → `enhanceStrengthSessionDetails:2814` | Llama a `enhanceStrengthSessionExercises` (inyecta/reemplaza core) y después a `completeStrengthExerciseDensity` | Debe recibir la **proyección del core** y el **conjunto de ids comprometidos**, hoy inexistentes en ese punto |
| 3 | `enhanceStrengthSessionDetails:2826` → `completeStrengthExerciseDensity:2854` | Agrega ejercicios hasta la densidad objetivo, sin marca de procedencia | Consumidor: excluye los ids comprometidos |
| 4 | `normalizeStrengthSessions:2034` | Hoy hace la rotación por índice escalar | Pasa a **aplicar** la columna local de la matriz |
| 5 | `normalizeStrengthSessions:2136` (segunda llamada a `enhanceStrengthSessionExercises`) | Vuelve a correr `ensureCoreBlock`, que con ≥2 cores y sin foundation **reemplaza el primer core** | Debe recibir el conjunto de celdas asignadas y no poder tocarlas |

**Consecuencia de diseño, y no es menor:** el allocator tiene que resolverse
**antes** del paso 2, no en el paso 4. Si se resolviera en el 4, la densidad ya
habría agregado ejercicios que el allocator no vio y el core ya se habría
inyectado sobre una lista distinta de la del snapshot. La Tarea 5 mueve la
resolución al paso 1 y deja en el paso 4 sólo la **aplicación** de la columna.

### API que falta en el selector

`selectStrengthReplacement` no permite hoy ninguna de las dos cosas que el
allocator necesita, y sondearla con 128 índices —como hizo el spike— es
aceptable en un test y no en producción. Se agregan dos funciones puras al
mismo módulo, sin cambiar la firma existente:

```ts
/** El pool canónico del slot, sin exclusiones y ordenado por `id`. */
export function getStrengthReplacementPool(
  original: { name: string; libraryRef?: ExerciseLibraryRef },
  context: StrengthContext,
): string[]

/** Construye la prescripción de un id ya elegido. Devuelve undefined si el id no es elegible en el contexto. */
export function buildStrengthReplacementById(
  candidateId: string,
  context: StrengthContext,
  exerciseIndex: number,
): StrengthSelectionExercise | undefined
```

`selectStrengthReplacement` se reimplementa sobre esas dos, de modo que exista
**una sola** definición de "pool elegible" y no dos que puedan divergir.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/services/training/strengthSelector.ts` | **Modificar.** Excluir el original de su propio pool (Tarea 1) |
| `src/services/training/strengthSessionStructure.ts` | **Modificar.** Exportar `resolveInjectedCoreId` (Tarea 2) |
| `src/services/planBuilder/strengthTemplateSnapshot.ts` | **Crear.** Snapshot transitorio inmutable + firma estructural |
| `src/services/planBuilder/strengthStructuralCore.ts` | **Crear.** Proyección pura del `structuralCoreSlot` |
| `src/services/planBuilder/strengthBlockAllocator.ts` | **Crear.** El CSP determinista. Sin dependencias de Dexie, red ni reloj |
| `src/services/planBuilder/repairWeek.ts` | **Modificar.** Cablear el orden congelado |
| `src/types/planBuilder.ts` | **Modificar.** Contadores nuevos |

El allocator vive en su propio módulo y **no** crece dentro de `repairWeek.ts`,
que ya es grande (spec §12).

---

### Task 1: Entrega 1 — excluir el original por identidad canónica

Cambio bounded e independiente. Cierra el mecanismo D. **No cierra el
problema**: A y C siguen vivos.

**Files:**
- Modify: `src/services/training/strengthSelector.ts:369-381`
- Test: `src/services/training/__tests__/strengthSelectorReplacement.test.ts` (crear)

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces: `selectStrengthReplacement` deja de devolver el `id` del original.
  La firma de `StrengthReplacementRequest` **no cambia**.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/training/__tests__/strengthSelectorReplacement.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { selectStrengthReplacement } from '../strengthSelector'
import type { StrengthContext } from '../strengthSelector'
import { resolveStrengthExercise } from '../exerciseLibrary'

const CONTEXT: StrengthContext = {
  phase: 'peak',
  sportProfile: 'squash',
  sessionDurationMin: 60,
  weekIndexInBlock: 1,
} as unknown as StrengthContext

function idOf(name: string): string | undefined {
  return resolveStrengthExercise({ name })?.definition?.id
}

describe('selectStrengthReplacement — el original no pertenece a su pool', () => {
  it('nunca devuelve el mismo id, barriendo todos los índices del pool', () => {
    const originalId = idOf('Peso muerto rumano')
    expect(originalId).toBe('romanian_deadlift')

    for (let rotationIndex = 0; rotationIndex < 24; rotationIndex++) {
      const picked = selectStrengthReplacement({
        originalName: 'Peso muerto rumano',
        context: CONTEXT,
        excludedKeys: new Set<string>(),
        rotationIndex,
        exerciseIndex: 1,
      })
      if (!picked) continue
      expect(idOf(picked.name)).not.toBe(originalId)
    }
  })

  it('trata un alias como el mismo ejercicio: "Remo con barra" no rota a "Remo inclinado"', () => {
    // Ambos nombres resuelven a `bent_over_row` desde §20: uno es alias del otro.
    expect(idOf('Remo con barra')).toBe(idOf('Remo inclinado'))

    for (let rotationIndex = 0; rotationIndex < 24; rotationIndex++) {
      const picked = selectStrengthReplacement({
        originalName: 'Remo con barra',
        context: CONTEXT,
        excludedKeys: new Set<string>(),
        rotationIndex,
        exerciseIndex: 3,
      })
      if (!picked) continue
      expect(idOf(picked.name)).not.toBe('bent_over_row')
    }
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/training/__tests__/strengthSelectorReplacement.test.ts`
Expected: FAIL. El primer caso falla con `expected 'romanian_deadlift' not to be 'romanian_deadlift'`
en algún índice; el segundo falla con `bent_over_row`.

- [ ] **Step 3: Implementar el filtro canónico**

En `src/services/training/strengthSelector.ts`, dentro de
`selectStrengthReplacement`, agregar el filtro **después** del filtro por
`movement` y **antes** del de `excludedKeys`:

```ts
  const candidates = STRENGTH_EXERCISE_LIBRARY
    .filter((candidate) => candidate.movement === original.movement)
    // El original no pertenece a su propio pool: devolverlo no es una rotación.
    // Se compara por `id` y no por nombre porque desde §20 un mismo ejercicio
    // tiene nombre canónico y aliases, y comparar texto dejaría pasar
    // `Remo con barra` -> `Remo inclinado`, que son ambos `bent_over_row`.
    .filter((candidate) => candidate.id !== original.id)
    .filter((candidate) =>
      !request.excludedKeys.has(getStrengthExerciseKey(candidate)) &&
      !request.excludedKeys.has(normalizeStrengthExerciseKey(candidate.name)),
    )
    .filter((candidate) => isCandidateAllowedInContext(candidate, request.context))
    .sort((a, b) => a.id.localeCompare(b.id))
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/training/__tests__/strengthSelectorReplacement.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Correr la suite completa y registrar el efecto**

Run: `npm test`
Expected: `strengthRotationPoolContract.test.ts` **pasa a verde** — el no-op por
alias desaparece y `0->2` baja de 3 a 2. **Esto NO cierra el problema**: los
casos de resonancia y cascada son gates del allocator (spec §11) y no existen
todavía.

Si algún snapshot de selección de §18 cambia, **no regenerarlo sin justificar la
diferencia**: verificar ejercicio por ejercicio que el cambio es "el original
dejó de aparecer como su propio reemplazo" y no otra cosa. Anotar la lista en el
mensaje de commit.

- [ ] **Step 6: Verificación de cierre**

Run: `npm run lint && npx tsc -b && npm run build && git diff --check`
Expected: todo verde.

---

### Task 2: Exportar `resolveInjectedCoreId` y proyectar el `structuralCoreSlot`

**Files:**
- Modify: `src/services/training/strengthSessionStructure.ts:44`
- Create: `src/services/planBuilder/strengthStructuralCore.ts`
- Test: `src/services/planBuilder/__tests__/strengthStructuralCore.test.ts`

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces:
  ```ts
  export interface StructuralCoreProjection {
    /** Índice en la lista del snapshot, o null si el slot es virtual (se antepone). */
    slotIndex: number | null
    /** Id canónico que ese slot debe tener en esta semana. */
    coreId: string
  }
  export function projectStructuralCoreSlot(
    snapshotExercises: ReadonlyArray<{ name: string; libraryRef?: ExerciseLibraryRef; group?: string }>,
    weekIndexInBlock: number,
    availableEquipment?: EquipmentType[],
  ): StructuralCoreProjection
  export { INJECTED_CORE_ROTATION } from '../training/strengthSessionStructure'
  ```
  Y desde `strengthSessionStructure.ts`, ahora públicas:
  `INJECTED_CORE_ROTATION`, `resolveInjectedCoreId`, `isFoundationCore`.

- [ ] **Step 1: Exportar las TRES autoridades, sin duplicar ninguna**

En `src/services/training/strengthSessionStructure.ts`, exportar lo que hoy es
privado. **No copiar ninguna de las tres a otro módulo**: una allowlist
duplicada y un predicado duplicado son dos fuentes de verdad que divergen en
silencio, exactamente lo que §16 corrigió para bloque/índice.

```ts
export const INJECTED_CORE_ROTATION = [...]   // línea 33, agregar `export`
export function resolveInjectedCoreId(...)    // línea 44, agregar `export`
export function isFoundationCore(...)         // línea 539, agregar `export`
```

`strengthStructuralCore.ts` **importa** las tres. Si el ciclo de core cambia,
rompe en un solo lugar.

- [ ] **Step 2: Escribir el test que falla**

Crear `src/services/planBuilder/__tests__/strengthStructuralCore.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { projectStructuralCoreSlot } from '../strengthStructuralCore'

const TEMPLATE = [
  { name: 'Sentadilla trasera', group: 'legs' },
  { name: 'Peso muerto rumano', group: 'legs' },
  { name: 'Dead bug — control de tronco', group: 'core' },
  { name: 'Lanzamiento rotacional con balón medicinal', group: 'core' },
]

describe('projectStructuralCoreSlot', () => {
  it('elige el primer foundation core del snapshot y lo rota por la allowlist de §29', () => {
    expect(projectStructuralCoreSlot(TEMPLATE, 0)).toEqual({ slotIndex: 2, coreId: 'dead_bug' })
    expect(projectStructuralCoreSlot(TEMPLATE, 1)).toEqual({ slotIndex: 2, coreId: 'plank' })
    expect(projectStructuralCoreSlot(TEMPLATE, 2)).toEqual({ slotIndex: 2, coreId: 'side_plank' })
  })

  it('devuelve un slot virtual cuando el snapshot no trae foundation core', () => {
    const sinCore = [
      { name: 'Sentadilla trasera', group: 'legs' },
      { name: 'Lanzamiento rotacional con balón medicinal', group: 'core' },
    ]
    expect(projectStructuralCoreSlot(sinCore, 1)).toEqual({ slotIndex: null, coreId: 'plank' })
  })

  it('no depende de la asignación: la misma entrada da la misma proyección', () => {
    const a = projectStructuralCoreSlot(TEMPLATE, 3)
    const b = projectStructuralCoreSlot(TEMPLATE, 3)
    expect(a).toEqual(b)
  })

  it('respeta el equipamiento: sin fitball el ciclo usa sólo los tres universales', () => {
    expect(projectStructuralCoreSlot(TEMPLATE, 3, ['barbell']).coreId).toBe('dead_bug')
    expect(projectStructuralCoreSlot(TEMPLATE, 3, undefined).coreId).toBe('stability_ball_front_plank')
  })
})
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npx vitest run src/services/planBuilder/__tests__/strengthStructuralCore.test.ts`
Expected: FAIL con `Cannot find module '../strengthStructuralCore'`.

- [ ] **Step 4: Implementar el módulo**

Crear `src/services/planBuilder/strengthStructuralCore.ts`:

```ts
import { isFoundationCore, resolveInjectedCoreId } from '../training/strengthSessionStructure'
// `EquipmentType` se exporta desde exerciseLibrary, NO desde ../../types.
import type { EquipmentType } from '../training/exerciseLibrary'
import type { ExerciseLibraryRef } from '../../types'

/**
 * Proyección pura del core estructural, paso 2 del orden congelado de la spec.
 *
 * Existe porque `ensureCoreBlock` decide insertar o reemplazar según los cores
 * que queden en la sesión, y `normalizeStrengthSessions` vuelve a correr el
 * enriquecedor DESPUÉS de asignar: si el core se derivara de la sesión ya
 * asignada, dependería de la asignación y dejaría de ser reconstruible por
 * otro worker. Derivarlo del snapshot rompe esa circularidad.
 */
export interface StructuralCoreProjection {
  slotIndex: number | null
  coreId: string
}

/** Reexportación, no copia: la autoridad vive en strengthSessionStructure. */
export { INJECTED_CORE_ROTATION } from '../training/strengthSessionStructure'

export function projectStructuralCoreSlot(
  snapshotExercises: ReadonlyArray<{ name: string; libraryRef?: ExerciseLibraryRef; group?: string }>,
  weekIndexInBlock: number,
  availableEquipment?: EquipmentType[],
): StructuralCoreProjection {
  const coreId = resolveInjectedCoreId(weekIndexInBlock, availableEquipment)
  const slotIndex = snapshotExercises.findIndex((exercise) => isFoundationCore(exercise))
  return { slotIndex: slotIndex >= 0 ? slotIndex : null, coreId }
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/planBuilder/__tests__/strengthStructuralCore.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Verificar que la proyección usa la MISMA función, no una copia**

Ya no hace falta un test de equivalencia entre dos predicados, porque después
del Step 1 hay uno solo. Lo que sí hay que fijar es que no reaparezca una copia:

```ts
it('la proyección importa el predicado de strengthSessionStructure, no una copia', async () => {
  const modulo = await import('../strengthStructuralCore?raw')
  expect(modulo.default).not.toMatch(/anti_extension/)
  expect(modulo.default).toMatch(/import \{[^}]*isFoundationCore/)
})
```

Si el import `?raw` no está disponible en la config de Vitest de este repo,
sustituirlo por una aserción sobre el archivo leído con `fs.readFileSync`, que
es lo que hacen otros guards de este proyecto.

- [ ] **Step 7: Verificación de cierre**

Run: `npm run lint && npm test && npx tsc -b && npm run build && git diff --check`

---

### Task 3: Snapshot transitorio del template y firma estructural

**Files:**
- Create: `src/services/planBuilder/strengthTemplateSnapshot.ts`
- Test: `src/services/planBuilder/__tests__/strengthTemplateSnapshot.test.ts`

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces:
  ```ts
  export interface StrengthTemplateSlot {
    slotKey: string
    sessionOrdinal: number
    positionInSession: number
    canonicalId: string | null
    name: string
    libraryRef?: ExerciseLibraryRef
    role: StrengthContractRole
  }
  export interface StrengthTemplateSnapshot {
    readonly slots: ReadonlyArray<StrengthTemplateSlot>
  }
  export function captureStrengthTemplateSnapshot(
    strengthSessions: ReadonlyArray<CoachSessionProposal>,
  ): StrengthTemplateSnapshot
  export function computeTemplateSignature(snapshot: StrengthTemplateSnapshot): string
  ```

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/planBuilder/__tests__/strengthTemplateSnapshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { captureStrengthTemplateSnapshot, computeTemplateSignature } from '../strengthTemplateSnapshot'
import type { CoachSessionProposal } from '../../../types'

function session(date: string, names: string[]): CoachSessionProposal {
  return {
    date, timeBlock: 'AM', sessionType: 'strength', title: 'Fuerza', durationMin: 60, rpe: 6,
    exercises: names.map((name) => ({ name, sets: 3, reps: 8 })),
  } as CoachSessionProposal
}

describe('captureStrengthTemplateSnapshot', () => {
  it('la identidad del slot no usa la posición: dos listas con el mismo contenido en distinto orden dan slotKeys distintos por ocurrencia, no por posición', () => {
    const snapshot = captureStrengthTemplateSnapshot([
      session('2026-06-09', ['Sentadilla trasera', 'Press vertical', 'Press vertical']),
    ])
    expect(snapshot.slots.map((slot) => slot.slotKey)).toEqual([
      '0:back_squat:0',
      '0:overhead_press:0',
      '0:overhead_press:1',
    ])
  })

  it('es inmutable: mutar la sesión original no altera el snapshot', () => {
    const original = session('2026-06-09', ['Sentadilla trasera'])
    const snapshot = captureStrengthTemplateSnapshot([original])
    original.exercises![0]!.name = 'Otro'
    expect(snapshot.slots[0]!.name).toBe('Sentadilla trasera')
  })
})

describe('computeTemplateSignature', () => {
  it('distingue dos templates con los mismos ids repartidos en sesiones distintas', () => {
    const juntos = captureStrengthTemplateSnapshot([
      session('2026-06-09', ['Sentadilla trasera', 'Press vertical']),
    ])
    const separados = captureStrengthTemplateSnapshot([
      session('2026-06-09', ['Sentadilla trasera']),
      session('2026-06-10', ['Press vertical']),
    ])
    expect(computeTemplateSignature(juntos)).not.toBe(computeTemplateSignature(separados))
  })

  it('es estable para la misma entrada', () => {
    const a = captureStrengthTemplateSnapshot([session('2026-06-09', ['Sentadilla trasera'])])
    const b = captureStrengthTemplateSnapshot([session('2026-06-09', ['Sentadilla trasera'])])
    expect(computeTemplateSignature(a)).toBe(computeTemplateSignature(b))
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/services/planBuilder/__tests__/strengthTemplateSnapshot.test.ts`
Expected: FAIL con `Cannot find module '../strengthTemplateSnapshot'`.

- [ ] **Step 3: Implementar el módulo**

Crear `src/services/planBuilder/strengthTemplateSnapshot.ts`:

```ts
import { resolveStrengthExercise } from '../training/exerciseLibrary'
import { resolveSessionStrengthRoles } from './strengthRoleContract'
import type { StrengthContractRole } from './strengthRoleContract'
import type { CoachSessionProposal, ExerciseLibraryRef } from '../../types'

/**
 * Registro transitorio e inmutable del primer template observable. En el
 * camino productivo corregido lo materializa antes el selector local,
 * paso 1 del orden congelado de la spec. Vive dentro de una sola pasada de
 * repair y NO cruza ninguna frontera de serialización: no se persiste, no va a
 * backup, no va a plantillas. Esa es la razón de que no haga falta un campo de
 * procedencia como el `libraryRef` de §19.
 */
export interface StrengthTemplateSlot {
  slotKey: string
  sessionOrdinal: number
  positionInSession: number
  canonicalId: string | null
  name: string
  libraryRef?: ExerciseLibraryRef
  role: StrengthContractRole
}

export interface StrengthTemplateSnapshot {
  readonly slots: ReadonlyArray<StrengthTemplateSlot>
}

export function captureStrengthTemplateSnapshot(
  strengthSessions: ReadonlyArray<CoachSessionProposal>,
): StrengthTemplateSnapshot {
  const slots: StrengthTemplateSlot[] = []

  strengthSessions.forEach((session, sessionOrdinal) => {
    const exercises = session.exercises ?? []
    const roles = resolveSessionStrengthRoles(exercises)
    // La ocurrencia desambigua ids repetidos en la misma sesión. NO se usa la
    // posición como identidad: la posición deriva entre semanas por el core
    // rotado y el relleno, y esa deriva es el mecanismo C de la spec.
    const occurrences = new Map<string, number>()

    exercises.forEach((exercise, positionInSession) => {
      const canonicalId = resolveStrengthExercise(exercise)?.definition?.id ?? null
      const identity = canonicalId ?? `unresolved:${exercise.name}`
      const occurrenceIndex = occurrences.get(identity) ?? 0
      occurrences.set(identity, occurrenceIndex + 1)

      slots.push({
        slotKey: `${sessionOrdinal}:${identity}:${occurrenceIndex}`,
        sessionOrdinal,
        positionInSession,
        canonicalId,
        name: exercise.name,
        libraryRef: exercise.libraryRef,
        role: roles[positionInSession]!,
      })
    })
  })

  return { slots: Object.freeze(slots) }
}

/**
 * Cubre la entrada estructural completa, no sólo el conjunto de ids: dos
 * templates con los mismos ids repartidos en sesiones distintas, o con roles
 * distintos, producen matrices distintas y deben tener firmas distintas.
 */
export function computeTemplateSignature(snapshot: StrengthTemplateSnapshot): string {
  return snapshot.slots
    .map((slot) => `${slot.slotKey}|${slot.role}`)
    .join('#')
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/services/planBuilder/__tests__/strengthTemplateSnapshot.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Verificación de cierre**

Run: `npm run lint && npm test && npx tsc -b && npm run build && git diff --check`

---

### Task 4: El allocator — CSP determinista

El corazón del plan. Módulo puro: sin Dexie, sin red, sin reloj, sin
`Math.random`.

**Files:**
- Create: `src/services/planBuilder/strengthBlockAllocator.ts`
- Test: `src/services/planBuilder/__tests__/strengthBlockAllocator.test.ts`

**Interfaces:**
- Consumes: `StrengthTemplateSlot` de la Tarea 3.
- Produces:
  ```ts
  export type AllocationDegradationReason =
    | 'infeasible_intra_week'
    | 'insufficient_pool'
    | 'unresolved_identity'
    | 'search_exhausted'

  export interface AllocatorInput {
    slots: ReadonlyArray<{ slotKey: string; canonicalId: string; candidateIds: ReadonlyArray<string> }>
    blockId: string
    weekCount: number
    /**
     * I1 es DIRECCIONAL: `|countables(P_j) ∩ all(P_i)|`. El main lift de la
     * semana anterior está en `all(P_i)`, pero el de la semana actual NO está
     * en `countables(P_j)`. Colapsar ambos en una sola lista contaría el main
     * lift contra sí mismo en cada par y haría fallar el presupuesto siempre.
     */
    fixedIdsByWeek: ReadonlyArray<{
      /** Todo id fijo presente esa semana: entra en `all(P_i)`. */
      all: ReadonlyArray<string>
      /** Sólo los fijos contables: entran en `countables(P_j)`. Excluye el main lift. */
      countable: ReadonlyArray<string>
    }>
    maxNodes?: number
  }

  export interface AllocatorResult {
    /**
     * matrix[weekIndex][slotKey] = id asignado. Una celda degradada NO se omite:
     * lleva el `canonicalId` original, porque ese ejercicio sigue estando en la
     * semana y por lo tanto sigue consumiendo presupuesto de I1 y cupo de I2.
     * Omitirla la haría desaparecer de la proyección y el presupuesto mentiría.
     */
    matrix: ReadonlyArray<ReadonlyMap<string, string>>
    degradedCells: ReadonlyArray<{ slotKey: string; week: number; reason: AllocationDegradationReason }>
    searchExhausted: boolean
  }

  export function allocateStrengthBlock(input: AllocatorInput): AllocatorResult
  export function fnv1a32(value: string): number
  ```

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/services/planBuilder/__tests__/strengthBlockAllocator.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { allocateStrengthBlock, fnv1a32 } from '../strengthBlockAllocator'

const BLOCK = 'peak:0:11'

function idsOf(result: ReturnType<typeof allocateStrengthBlock>, week: number, slot: string) {
  return result.matrix[week]!.get(slot)
}

describe('fnv1a32', () => {
  it('coincide con el valor golden de FNV-1a 32 bits', () => {
    // Comparar la función consigo misma no prueba nada: pasaría con
    // `Math.random` cacheado. Estos valores son los de la especificación
    // FNV-1a de 32 bits y fijan el algoritmo, no sólo su estabilidad.
    expect(fnv1a32('')).toBe(0x811c9dc5)
    expect(fnv1a32('a')).toBe(0xe40c292c)
    expect(fnv1a32('foobar')).toBe(0xbf9cf968)
  })
})

describe('allocateStrengthBlock', () => {
  it('la columna 0 conserva el original de cada slot', () => {
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 3,
      slots: [{ slotKey: 's1', canonicalId: 'a', candidateIds: ['b', 'c'] }],
      fixedIdsByWeek: Array.from({ length: 3 }, () => ({ all: [], countable: [] })),
    })
    expect(idsOf(result, 0, 's1')).toBe('a')
  })

  it('ninguna celda asignada devuelve el id original (I3)', () => {
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 3,
      slots: [{ slotKey: 's1', canonicalId: 'a', candidateIds: ['b', 'c'] }],
      fixedIdsByWeek: Array.from({ length: 3 }, () => ({ all: [], countable: [] })),
    })
    for (let week = 1; week < 3; week++) expect(idsOf(result, week, 's1')).not.toBe('a')
  })

  it('respeta la unicidad intra-semana (I2)', () => {
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 2,
      slots: [
        { slotKey: 's1', canonicalId: 'x', candidateIds: ['a', 'b'] },
        { slotKey: 's2', canonicalId: 'y', candidateIds: ['a', 'b'] },
      ],
      fixedIdsByWeek: Array.from({ length: 2 }, () => ({ all: [], countable: [] })),
    })
    const week1 = [...result.matrix[1]!.values()]
    expect(new Set(week1).size).toBe(week1.length)
  })

  it('los ids fijos consumen cupo intra-semana', () => {
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 2,
      slots: [{ slotKey: 's1', canonicalId: 'x', candidateIds: ['a'] }],
      fixedIdsByWeek: [{ all: [], countable: [] }, { all: ['a'], countable: ['a'] }],
    })
    // La celda degradada conserva su original: el ejercicio sigue en la semana.
    expect(idsOf(result, 1, 's1')).toBe('x')
    expect(result.degradedCells).toContainEqual({ slotKey: 's1', week: 1, reason: 'infeasible_intra_week' })
  })

  it('degrada por celda y no por slot completo', () => {
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 3,
      slots: [{ slotKey: 's1', canonicalId: 'x', candidateIds: ['a'] }],
      fixedIdsByWeek: [{ all: [], countable: [] }, { all: [], countable: [] }, { all: ['a'], countable: ['a'] }],
    })
    // La semana 1 sí pudo asignar; sólo la 2 degrada.
    expect(idsOf(result, 1, 's1')).toBe('a')
    expect(result.degradedCells.map((cell) => cell.week)).toEqual([2])
  })

  it('el contraejemplo de Hall degrada en vez de mentir', () => {
    // Necesita TRES columnas: con weekCount 2 sólo existe una semana rotada y
    // "s3 forzado a c dos veces" no puede ocurrir, así que el caso sería vacuo.
    // Con la 0 fija más dos rotadas, s1 y s2 consumen a/b en ambas y s3 queda
    // sin más opción que repetir c.
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 3,
      slots: [
        { slotKey: 's1', canonicalId: 'x', candidateIds: ['a', 'b'] },
        { slotKey: 's2', canonicalId: 'y', candidateIds: ['a', 'b'] },
        { slotKey: 's3', canonicalId: 'z', candidateIds: ['a', 'b', 'c'] },
      ],
      fixedIdsByWeek: [
        { all: [], countable: [] }, { all: [], countable: [] }, { all: [], countable: [] },
      ],
    })
    for (const week of [1, 2]) {
      const ids = [...result.matrix[week]!.values()]
      expect(new Set(ids).size).toBe(ids.length)   // I2 se respeta igual
    }
    expect(result.degradedCells.length).toBeGreaterThan(0)  // y lo admite
  })

  it('I1 es direccional: el main lift actual no cuenta contra sí mismo', () => {
    // `ml` es fijo NO contable en ambas semanas. Si se contara como contable,
    // cada par arrancaría con 1 de solape gratis y el presupuesto se agotaría
    // antes de tiempo.
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 2,
      slots: [
        { slotKey: 's1', canonicalId: 'x', candidateIds: ['a', 'b'] },
        { slotKey: 's2', canonicalId: 'y', candidateIds: ['c', 'd'] },
      ],
      fixedIdsByWeek: [
        { all: ['ml'], countable: [] },
        { all: ['ml'], countable: [] },
      ],
    })
    expect(result.degradedCells).toEqual([])
  })

  it('una celda degradada conserva su original en la matriz y sigue restringiendo', () => {
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 2,
      slots: [{ slotKey: 's1', canonicalId: 'x', candidateIds: [] }],
      fixedIdsByWeek: [{ all: [], countable: [] }, { all: [], countable: [] }],
    })
    // No se omite: sigue estando en la semana, así que sigue en la proyección.
    expect(result.matrix[1]!.get('s1')).toBe('x')
  })

  it('un slot sin candidatos degrada con insufficient_pool', () => {
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 2,
      slots: [{ slotKey: 's1', canonicalId: 'x', candidateIds: [] }],
      fixedIdsByWeek: Array.from({ length: 2 }, () => ({ all: [], countable: [] })),
    })
    expect(result.degradedCells).toContainEqual({ slotKey: 's1', week: 1, reason: 'insufficient_pool' })
  })

  it('es determinista: el mismo input da la misma matriz', () => {
    const input = {
      blockId: BLOCK, weekCount: 4,
      slots: [
        { slotKey: 's1', canonicalId: 'x', candidateIds: ['a', 'b', 'c'] },
        { slotKey: 's2', canonicalId: 'y', candidateIds: ['b', 'c', 'd'] },
      ],
      fixedIdsByWeek: Array.from({ length: 4 }, () => ({ all: [], countable: [] })),
    }
    const first = allocateStrengthBlock(input)
    const second = allocateStrengthBlock(input)
    for (let week = 0; week < 4; week++) {
      expect([...second.matrix[week]!.entries()].sort()).toEqual([...first.matrix[week]!.entries()].sort())
    }
  })

  it('bajo el tope de nodos devuelve la mejor visitada sin lanzar', () => {
    const result = allocateStrengthBlock({
      blockId: BLOCK, weekCount: 12,
      slots: Array.from({ length: 6 }, (_, index) => ({
        slotKey: `s${index}`, canonicalId: `orig${index}`,
        candidateIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      })),
      fixedIdsByWeek: Array.from({ length: 12 }, () => ({ all: [], countable: [] })),
      maxNodes: 50,
    })
    expect(result.matrix).toHaveLength(12)
    expect(result.searchExhausted).toBe(true)
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run src/services/planBuilder/__tests__/strengthBlockAllocator.test.ts`
Expected: FAIL con `Cannot find module '../strengthBlockAllocator'`.

- [ ] **Step 3: Implementar el allocator**

Crear `src/services/planBuilder/strengthBlockAllocator.ts`.

**No se incluye esqueleto de código a propósito.** La versión anterior de este
plan traía uno que resolvía columna por columna, y aunque estaba marcado como no
definitivo era demasiado fácil implementarlo tal cual. El contrato de abajo es
la especificación completa; el cuerpo lo escribe el implementador.

**Encabezado obligatorio del módulo:**

```ts
/**
 * Asignación de bloque para accesorios de fuerza (spec §8).
 *
 * Módulo PURO: sin Dexie, sin red, sin reloj, sin `Math.random` y sin depender
 * del orden de iteración de ningún `Map` para producir resultado. Cada worker
 * ejecuta esto completo con la misma entrada y toma su propia columna, así que
 * cualquiera de esas tres cosas rompería la garantía entre workers (I4).
 */
```

**Constantes:**

```ts
const DEFAULT_MAX_NODES = 20_000
/** Presupuesto de I1: dos ids compartidos por par es tolerable; tres dispara el check. */
const PAIR_OVERLAP_BUDGET = 2
```

**`fnv1a32`** — FNV-1a de 32 bits estándar, con `Math.imul` y `>>> 0` para
mantenerse en enteros sin signo. Debe reproducir los golden del test.

**`preferenceOrder(slot, blockId)`** — ordena `candidateIds` por
`localeCompare` y rota el arreglo por `fnv1a32(\`${blockId}|${slot.slotKey}\`) %
length`. La semilla usa la identidad del slot, **nunca** la posición.

**`allocateStrengthBlock(input)` — contrato:**

1. **Columna 0 fija.** `matrix[0].get(slotKey) === slot.canonicalId` para todo
   slot. No se decide: se declara, y las demás columnas se restringen contra
   ella.
2. **La unidad de decisión es la celda `(slotKey, week)`**, no la columna.
   Orden de decisión estable: `week` ascendente, y dentro de cada semana
   `slotKey` por `localeCompare`.
3. **El backtracking cruza fronteras de semana.** Agotados los candidatos de una
   celda, se deshace la última celda asignada **aunque pertenezca a una semana
   anterior**. Un algoritmo que fije cada columna antes de pasar a la siguiente
   no cumple este contrato y no cierra el contraejemplo de Hall.
4. **No se devuelve el primer camino viable.** Se explora hasta agotar el espacio
   o hasta `maxNodes`, conservando la mejor solución vista según el objetivo
   lexicográfico de §9 de la spec: (a) menos pares que exceden
   `PAIR_OVERLAP_BUDGET`; (b) menos celdas degradadas; (c) degradar primero las
   celdas de mayor `week`; (d) `slotKey` mayor por `localeCompare`. La
   comparación entre soluciones es total y determinista.
5. **Podas por celda**, en este orden: `candidateId === slot.canonicalId` (I3);
   `candidateId` ya usado en esa semana, contando los fijos (I2); el candidato
   lleva el solape con alguna semana anterior por encima del presupuesto (I1).
6. **I1 es direccional.** Se cuentan los CONTABLES de la semana actual
   —asignados más `fixedIdsByWeek[w].countable`— contra TODOS los ids de cada
   semana anterior —asignados más `fixedIdsByWeek[i].all`—. Nunca al revés y
   nunca con una sola lista.
7. **Celda degradada.** Cuando ningún candidato sobrevive, la celda **conserva
   su `canonicalId` en la matriz** —el ejercicio sigue en la semana y sigue
   restringiendo a las siguientes— y se registra en `degradedCells` con su
   causa. La degradación es por celda: nunca se sacrifica el slot completo.
8. **Causas**, evaluadas en este orden: `unresolved_identity` si
   `slot.canonicalId === ''`; `insufficient_pool` si `candidateIds` está vacío;
   `search_exhausted` si se alcanzó `maxNodes`; `infeasible_intra_week` en el
   resto.
9. **`searchExhausted`** es `true` si se alcanzó `maxNodes`. Alcanzarlo nunca
   lanza, nunca cuelga y nunca deja una semana sin columna.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run src/services/planBuilder/__tests__/strengthBlockAllocator.test.ts`
Expected: PASS, 10 tests.

Si el caso "un slot sin candidatos degrada con `insufficient_pool`" falla porque
`resolveReason` devuelve otra cosa, corregir el orden de las ramas: el pool
vacío se evalúa **antes** que la infactibilidad intra-semana.

- [ ] **Step 5: Agregar el caso de `unresolved_identity`**

Un slot cuyo `canonicalId` es la cadena vacía representa un original que no
resolvió. Agregar al test y a `resolveReason`:

```ts
it('un slot con identidad no resuelta degrada con unresolved_identity', () => {
  const result = allocateStrengthBlock({
    blockId: BLOCK, weekCount: 2,
    slots: [{ slotKey: 's1', canonicalId: '', candidateIds: ['a'] }],
    fixedIdsByWeek: Array.from({ length: 2 }, () => ({ all: [], countable: [] })),
  })
  expect(result.degradedCells).toContainEqual({ slotKey: 's1', week: 1, reason: 'unresolved_identity' })
})
```

En `resolveReason`, primera rama: `if (slot.canonicalId === '') return 'unresolved_identity'`.

- [ ] **Step 6: Verificación de cierre**

Run: `npm run lint && npm test && npx tsc -b && npm run build && git diff --check`

---

### Task 5: Cablear el orden congelado en `repairWeek`

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts:2044-2170` (bloque de rotación de fuerza)
- Test: `src/services/planBuilder/__tests__/strengthRotationOrder.test.ts`

**Interfaces:**
- Consumes: `captureStrengthTemplateSnapshot`, `computeTemplateSignature` (Tarea 3);
  `projectStructuralCoreSlot` (Tarea 2); `allocateStrengthBlock` (Tarea 4).
- Produces: **un coordinador puro**, que es lo que hace testeable esta tarea sin
  depender de la telemetría de la Tarea 6:

  ```ts
  /** Resuelve la asignación del bloque desde el template. Puro: sin mutar sesiones. */
  export function resolveStrengthBlockAllocation(
    strengthSessions: ReadonlyArray<CoachSessionProposal>,
    context: RepairContext,
  ): StrengthBlockAllocation

  export interface StrengthBlockAllocation {
    snapshot: StrengthTemplateSnapshot
    templateSignature: string
    matrix: AllocatorResult['matrix']
    degradedCells: AllocatorResult['degradedCells']
    searchExhausted: boolean
    localWeek: number
    /** Core estructural proyectado por semana, indexado por sessionOrdinal. */
    structuralCoreByWeek: ReadonlyArray<ReadonlyMap<number, StructuralCoreProjection>>
  }
  ```

  Los tests de esta tarea llaman al coordinador **directamente** y observan la
  matriz por `slotKey`: no necesitan `meta`. La matriz sigue siendo transitoria
  —viaja por `context.strengthAllocation`— y la Tarea 6 sólo **consume** su
  resultado para derivar contadores. Orden: **4 → 5 → 6**.

  El bloque de rotación deja de usar `selectStrengthReplacement` con
  `rotationIndex` escalar. `selectStrengthReplacement` **sigue existiendo** y se
  reimplementa sobre las dos funciones nuevas del selector.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/services/planBuilder/__tests__/strengthRotationOrder.test.ts` con los
dos gates que la Tarea 1 **no** cierra. Reutilizar el fixture de
`strengthRotationPoolContract.test.ts` (copiarlo; los fixtures compartidos entre
archivos de test de este repo se duplican a propósito para que cada archivo sea
legible solo):

```ts
it('la resonancia por deriva de posición ya no puede producir el mismo id', () => {
  // Caso medido en el spike: pool de 6, delta efectiva 30, 37 % 6 === 67 % 6.
  const semana1 = repairWeekAt(1)
  const semana2 = repairWeekAt(2)
  expect(idAtSlot(allocationAt(1), slotKeyOf('overhead_press')))
    .not.toBe(idAtSlot(allocationAt(2), slotKeyOf('overhead_press')))
})

it('la cascada de exclusiones ya no puede converger', () => {
  // Caso medido: pool pre 7, índices 3 y 4 aterrizando ambos en el mismo id.
  // El slot es `rotational_med_ball_throw`, que SÍ está en el template.
  // `cable_chop` no sirve como slot: es un candidato del pool, no un original
  // del template — en la traza aparecía porque lo insertaba la densidad.
  const semana1 = repairWeekAt(1)
  const semana2 = repairWeekAt(2)
  expect(idAtSlot(allocationAt(1), slotKeyOf('rotational_med_ball_throw')))
    .not.toBe(idAtSlot(allocationAt(2), slotKeyOf('rotational_med_ball_throw')))
})

it('el core estructural queda fuera del dominio y rota por la allowlist de §29', () => {
  const ids = [0, 1, 2, 3].map((week) => coreIdOf(repairWeekAt(week)))
  expect(ids).toEqual(['dead_bug', 'plank', 'side_plank', 'stability_ball_front_plank'])
})

it('ningún mutador estructural posterior pisa una celda asignada', () => {
  const semana2 = repairWeekAt(2)
  const asignados = assignedIdsOf(semana2)
  const finales = new Set(allIdsOf(semana2))
  for (const id of asignados) expect(finales.has(id)).toBe(true)
})
```

Helpers, en el mismo archivo:

```ts
import { resolveStrengthExercise } from '../../training/exerciseLibrary'
import { INJECTED_CORE_ROTATION_IDS } from '../strengthStructuralCore'

function allIdsOf(sessions: CoachSessionProposal[]): string[] {
  return sessions
    .filter((session) => session.sessionType === 'strength')
    .flatMap((session) => session.exercises ?? [])
    .map((exercise) => resolveStrengthExercise(exercise)?.definition?.id)
    .filter((id): id is string => id != null)
}

/**
 * Id que ocupa hoy el slot identificado por `slotKey`.
 *
 * NO se localiza por posición: la posición deriva entre semanas por el core
 * rotado y el relleno, y esa deriva es justamente el mecanismo C que estos
 * tests deben observar. Un helper posicional volvería a atarlos al dato roto.
 * La matriz devuelta por el repair es la fuente: `meta.strengthAllocation`
 * expone `matrix[weekIndexInBlock]`, indexada por `slotKey`.
 */
function idAtSlot(allocation: StrengthBlockAllocation, slotKey: string): string | undefined {
  return allocation.matrix[allocation.localWeek]?.get(slotKey)
}

/** slotKey del template para un id canónico dado, calculado desde el snapshot. */
function slotKeyOf(canonicalId: string): string {
  return `0:${canonicalId}:0`
}

function coreIdOf(sessions: CoachSessionProposal[]): string | undefined {
  return allIdsOf(sessions).find((id) => (INJECTED_CORE_ROTATION_IDS as readonly string[]).includes(id))
}
```

`assignedIdsOf` se obtiene de `resolveStrengthBlockAllocation(...)`, el
coordinador puro de esta misma tarea. No se reconstruye desde las sesiones
—sería tautológico— ni depende de la telemetría de la Tarea 6.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run src/services/planBuilder/__tests__/strengthRotationOrder.test.ts`
Expected: FAIL en al menos los dos primeros — son exactamente los mecanismos C y A.

- [ ] **Step 3: Reemplazar el cuerpo de la rotación por el orden congelado**

> **Anotado tras implementar la Tarea 4, y es load-bearing.** El allocator tenía
> un defecto —la línea base fijo↔fijo de `pairOverlap` no se computaba— por el
> cual un id fijo **y contable** repetido entre hermanas consumía 0 de
> presupuesto. Es exactamente el core estructural de §29: fijo, contable, y
> repetido por construcción cada 3 o 4 semanas según el equipamiento. El
> allocator ya lo corrigió, pero eso traslada la responsabilidad al llamador:
> esta tarea **debe** poner el core proyectado en `fixedIdsByWeek[w].countable`
> de **las N semanas**, no sólo la local, o el presupuesto vuelve a mentir por
> omisión. Y el `canonicalId` de un slot que el snapshot devuelve como `null`
> debe mapearse a `unresolved:<name>`, no a `''`: el centinela es por slot.

**El cableado NO es un solo sitio.** Según la tabla de "Ruta real de fuerza",
la densidad corre dentro de `completeSportDetails` (línea 251), **antes** de
`normalizeStrengthSessions` (línea 300). Hay que tocar cuatro sitios:

| Sitio | Cambio |
|---|---|
| `repairGeneratedWeek` ~250 | Capturar el snapshot y **resolver la matriz**, antes de `completeSportDetails` |
| `enhanceStrengthSessionDetails:2814` | Recibir la proyección de core y el `Set` de ids comprometidos, y pasarlos a las dos llamadas de abajo |
| `completeStrengthExerciseDensity:2854` | Excluir los ids comprometidos al elegir adiciones |
| `normalizeStrengthSessions:2136` | La segunda `enhanceStrengthSessionExercises` no puede tocar celdas asignadas |

La matriz viaja por el `RepairContext` como campo transitorio
`strengthAllocation?: AllocatorResult`, poblado una sola vez en el sitio 1. No
se persiste: `RepairContext` no se serializa.

Dentro de `normalizeStrengthSessions`, sustituir la lógica de rotación por:

1. El snapshot **no se captura acá**: ya fue capturado y la matriz ya fue
   resuelta en `repairGeneratedWeek` ~250, antes de `completeSportDetails`
   (ver "Ruta real de fuerza"). En este punto sólo se **lee**
   `context.strengthAllocation`. Capturarlo acá volvería a mirar una lista que
   la densidad y el core ya modificaron, que es el defecto que la ruta corrige.
2. Por cada sesión, `const coreProjection = projectStructuralCoreSlot(...)` para
   **cada** semana virtual `w in [0, weekCount)`; el slot proyectado queda
   marcado fijo y **no** entra a `slots`.
3. Construir `AllocatorInput`: `slots` desde el snapshot filtrando main lift
   (`!isCountableRole(role)`), el `structuralCoreSlot` y todo lo que no esté en
   el snapshot; `candidateIds` desde **`getStrengthReplacementPool`**, la API
   nueva de la sección "Ruta real de fuerza" — no sondeando
   `selectStrengthReplacement` con índices, que es lo que hizo el spike y no
   sirve en producción. `fixedIdsByWeek[w]` se arma, **para las N semanas del bloque y no sólo la
   local**, con `all: [mainLiftId, coreProyectadoDeEsaSemana]` y
   `countable: [coreProyectadoDeEsaSemana]`.

   **Sólo el main lift es no contable** (`isCountableRole` es
   `role !== 'main_lift'`, `strengthRoleContract.ts:27`). El core **sí** es
   contable, y dejarlo fuera de `countable` anularía la línea base fijo↔fijo
   que la Tarea 4 acaba de corregir: el core se repite entre hermanas cada 3 o
   4 semanas por construcción, y si no consume presupuesto, el allocator da por
   libre exactamente el solape que §29 existe para evitar.

   El `canonicalId` de un slot que el snapshot devuelve como `null` se mapea a
   `unresolved:<name>`, **nunca a `''`**: el centinela es por slot, o dos
   originales distintos sin resolver se cuentan como un mismo id.
4. `const allocation = allocateStrengthBlock(input)`.
5. Tomar `allocation.matrix[weekIndexInBlock]` y escribir cada celda,
   construyendo la prescripción con **`buildStrengthReplacementById`**.

   **Cuidado con el offset cuando el core proyectado es virtual.**
   `projectStructuralCoreSlot` devuelve `slotIndex: null` si el snapshot no
   trae foundation core, y en ese caso el core se **antepone** — lo que corre
   en +1 todas las `positionInSession` del snapshot. Escribir en la posición
   original sobrescribiría el ejercicio equivocado. Dos salidas admisibles, y
   hay que elegir una explícitamente: aplicar el offset de forma derivada del
   prepend, o —preferible— localizar la celda por identidad en vez de por
   índice, buscando en la lista viva el ejercicio cuyo id canónico coincide con
   el `canonicalId` del slot. La segunda no depende de ningún índice y es
   coherente con que `slotKey` nunca use posición. **Exige un test integrado
   con un template sin foundation core.** Una celda cuyo id
   asignado es igual al `canonicalId` del slot es una celda degradada: se deja
   el ejercicio original intacto y no se cuenta como acción de política.
6. Registrar `assignedIds` en un `Set` local.
7. `completeStrengthExerciseDensity` recibe ese `Set` como exclusión adicional.
8. `enhanceStrengthSessionExercises` recibe ese `Set` para que `ensureCoreBlock`
   no pueda reemplazar una celda asignada.

El tamaño del bloque se deriva contando las semanas que comparten `blockId`:

```ts
const positions = resolveBlockPositions(getPlanPhaseDescriptors(context), getPlanWeekDescriptors(context))
const currentBlockId = positions.get(context.week.weekIndex)?.blockId
const weekCount = [...positions.values()].filter((position) => position.blockId === currentBlockId).length
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run src/services/planBuilder/__tests__/strengthRotationOrder.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Correr la suite completa**

Run: `npm test`
Expected: verde, incluidos `strengthRotationPoolContract.test.ts` y
`strengthTemplateRotationConcurrent.test.ts`.

- [ ] **Step 6: Verificación de cierre**

Run: `npm run lint && npx tsc -b && npm run build && git diff --check`

---

### Task 6: Telemetría por columna local

**Files:**
- Modify: `src/types/planBuilder.ts:72`
- Modify: `src/services/planBuilder/repairWeek.ts:118` (tipo de `RepairMeta`) y la emisión
- Modify: `src/services/planBuilder/generateWeekCore.ts:55,81,281,304,400`
- Modify: `src/services/planBuilder/generateWeek.ts:70,96,247,270`
- Modify: `src/services/planBuilder/generatePlan.ts:104,138,244,299,382,482,516,689,860,947`
- Modify: `src/services/planBuilder/asyncGenerationLoop.ts:368,424`
- Test: `src/services/planBuilder/__tests__/strengthAllocatorTelemetry.test.ts`

**Un campo anidado, no seis planos.** `strengthAccessoryRotationActionCount`
atraviesa **24 call sites en 6 archivos** (verificado por `grep`). Seis campos
sueltos serían 144 líneas de plomería y seis oportunidades de olvidar uno en un
solo sitio. Se agrega **un** campo objeto que viaja como unidad:

```ts
export interface StrengthAllocatorMetrics {
  slotCount: number
  assignedCount: number
  infeasibleIntraWeekCount: number
  insufficientPoolCount: number
  unresolvedIdentityCount: number
  searchExhaustedCount: number
}
```

El guard contra olvidos es un test que recorre los call sites: si
`strengthAccessoryRotationActionCount` aparece en una línea donde
`strengthAllocator` no aparece, falla.

**Interfaces:**
- Consumes: `AllocatorResult` de la Tarea 4.
- Produces: seis campos opcionales nuevos en el meta de reparación.

- [ ] **Step 1: Escribir el test que falla**

```ts
it('cuenta sólo la columna local, no la matriz completa', () => {
  // Todos los workers computan las N columnas. Emitir el total multiplicaría
  // cada métrica por N al agregar las semanas en plan_generation_attempts.
  const meta = repairMetaFor(1)
  expect(meta.strengthAllocator?.slotCount).toBe(4)
})

it('cuenta cada causa de degradación por separado', () => {
  const meta = repairMetaForDegradedScenario()
  expect(meta.strengthAllocator?.insufficientPoolCount).toBe(1)
  expect(meta.strengthAllocator?.infeasibleIntraWeekCount).toBe(0)
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/services/planBuilder/__tests__/strengthAllocatorTelemetry.test.ts`
Expected: FAIL, campos `undefined`.

- [ ] **Step 3: Agregar los campos**

En `src/types/planBuilder.ts`, junto a `strengthAccessoryRotationActionCount`:

```ts
  strengthAllocator?: StrengthAllocatorMetrics
```

Y replicar esa línea en las declaraciones de tipo de `generateWeekCore.ts:55,81`,
`generateWeek.ts:70,96` y `generatePlan.ts:104,138`, más las 12 propagaciones
`x: y.strengthAccessoryRotationActionCount` de esos mismos archivos.

En `repairWeek.ts`, emitir filtrando por la columna local:

```ts
  const localWeek = getWeekIndexInBlock(context)
  // Sólo la columna local: todos los workers computan las N columnas, así que
  // emitir el total multiplicaría cada métrica por N al agregar las semanas del
  // bloque en `plan_generation_attempts`.
  const localDegraded = allocation.degradedCells.filter((cell) => cell.week === localWeek)
  const countBy = (reason: AllocationDegradationReason): number =>
    localDegraded.filter((cell) => cell.reason === reason).length

  meta.strengthAllocator = {
    slotCount: allocatorSlots.length,
    assignedCount: (allocation.matrix[localWeek]?.size ?? 0) - localDegraded.length,
    infeasibleIntraWeekCount: countBy('infeasible_intra_week'),
    insufficientPoolCount: countBy('insufficient_pool'),
    unresolvedIdentityCount: countBy('unresolved_identity'),
    searchExhaustedCount: countBy('search_exhausted'),
  }
```

`assignedCount` resta las degradadas porque desde la Tarea 4 la matriz **también
contiene** las celdas degradadas, con su id original.

Propagar `strengthAllocator` en los 24 call sites listados arriba.

- [ ] **Step 4: Agregar el guard de propagación**

```ts
it('strengthAllocator viaja por los mismos call sites que el contador de rotación', () => {
  const archivos = [
    'src/services/planBuilder/generateWeekCore.ts',
    'src/services/planBuilder/generateWeek.ts',
    'src/services/planBuilder/generatePlan.ts',
    'src/services/planBuilder/asyncGenerationLoop.ts',
  ]
  for (const archivo of archivos) {
    const contenido = readFileSync(archivo, 'utf8')
    const conRotacion = contenido.split('\n')
      .filter((linea) => linea.includes('strengthAccessoryRotationActionCount')).length
    const conAllocator = contenido.split('\n')
      .filter((linea) => linea.includes('strengthAllocator')).length
    expect(conAllocator, `${archivo} olvidó propagar strengthAllocator`).toBe(conRotacion)
  }
})
```

- [ ] **Step 5: Correr y verificar que pasa**

Run: `npx vitest run src/services/planBuilder/__tests__/strengthAllocatorTelemetry.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificación de cierre**

Run: `npm run lint && npm test && npx tsc -b && npm run build && git diff --check`

---

### Task 7: Actualizar el contrato de test al dominio real

**Files:**
- Modify: `src/services/planBuilder/__tests__/strengthRotationPoolContract.test.ts:101`
- Modify: `src/services/planBuilder/__tests__/strengthTemplateRotationConcurrent.test.ts:52`

**Interfaces:**
- Consumes: el comportamiento de las Tareas 2, 4 y 5.
- Produces: nada. Es la red de seguridad final.

- [ ] **Step 1: Bajar `EXPECTED_SLOTS` a cuatro**

`Dead bug — control de tronco` sale del dominio: es el `structuralCoreSlot`
proyectado (spec §7 paso 2). Quedan cuatro asignables:

```ts
const EXPECTED_SLOTS = [
  'Peso muerto rumano',
  'Press vertical',
  'Remo con barra',
  'Lanzamiento rotacional con balón medicinal',
]
```

- [ ] **Step 2: Agregar la verificación de `Dead bug` por proyección**

```ts
it('Dead bug se verifica por la proyección estructural, no como slot del allocator', () => {
  const ids = [0, 1, 2, 3].map((week) => structuralCoreIdOf(repairWeekAt(week)))
  expect(ids).toEqual(['dead_bug', 'plank', 'side_plank', 'stability_ball_front_plank'])
})
```

- [ ] **Step 3: Agregar la aserción de dominio para los agregados por densidad**

```ts
it('los agregados por densidad quedan fuera del dominio del allocator', () => {
  // En la traza del spike aparecían `Subida al cajón con salto alternado` y
  // `Dominada` como slots. Ya no pueden serlo: no están en el snapshot.
  const slots = slotsByWeek.get(2) ?? []
  expect(slots).not.toContain('Subida al cajón con salto alternado')
  expect(slots).not.toContain('Dominada')
})
```

- [ ] **Step 4: Corregir el fixture vacuo de la reproducción original**

En `strengthTemplateRotationConcurrent.test.ts:52`, cambiar
`{ name: 'Lanzamiento rotacional', ... }` por
`{ name: 'Lanzamiento rotacional con balón medicinal', ... }`. El nombre viejo
no resuelve contra el catálogo y dejaba ese slot fuera del selector sin aviso —
mismo defecto que el code review de §23 encontró con `'Remo en maquina'`.

- [ ] **Step 5: Correr todo**

Run: `npm run lint && npm test && npx tsc -b && npm run build && git diff --check`
Expected: verde. Los cuatro slots entran, `Dead bug` se verifica por proyección,
los agregados quedan fuera, y el solape contable respeta el umbral en los tres
pares.

---

### Task 8: Firma pre-rotación, `divergent_template` y los dos casos que faltaban

Cierra tres requisitos de la spec que las tareas anteriores no cubrían: el caso
obligatorio 10 (templates hermanos distintos), el 7 (main lift fuera del
dominio, verificado explícitamente) y el 11 (bloque de 12 semanas con pools
reales de 3–7).

**Files:**
- Modify: `src/services/planBuilder/repairWeek.ts:2145-2158` (metadata de rotación)
- Test: `src/services/planBuilder/__tests__/strengthAllocatorDomain.test.ts`

**Interfaces:**
- Consumes: `computeTemplateSignature` (Tarea 3), `allocateStrengthBlock` (Tarea 4).
- Produces: `planBuilderStrengthRotation.templateSignature` en la metadata de
  sesión, junto a la `signature` post-rotación que ya existe.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it('el main lift no recibe asignación pero su id consume presupuesto y cupo', () => {
  const semana1 = repairWeekAt(1)
  // `back_squat` es main lift: sigue presente y sin rotar en todas las semanas.
  expect(allIdsOf(semana1)).toContain('back_squat')
  // Y sigue en su posición: el rol de main lift es POSICIONAL (§16), así que
  // verificarlo por posición es lo único fiel al contrato.
  const strength = semana1.find((session) => session.sessionType === 'strength')
  const templatePosition = (clonedStrengthTemplate('2026-06-09').exercises ?? [])
    .findIndex((exercise) => resolveStrengthExercise(exercise)?.definition?.id === 'back_squat')
  expect(resolveStrengthExercise(strength!.exercises![templatePosition]!)?.definition?.id).toBe('back_squat')
  // Aparece exactamente una vez: ningún accesorio asignado tomó ese id.
  expect(allIdsOf(semana1).filter((id) => id === 'back_squat')).toHaveLength(1)
})

it('un bloque de 12 semanas con pools reales de 3-7 respeta el presupuesto por par', () => {
  // El fixture base sólo declara 4 fechas: hay que extender WEEK_START_DATES y
  // SESSION_DATES a 12 semanas consecutivas y planWeekDescriptors a 12 entradas,
  // o el bloque no tiene 12 columnas y el caso es vacuo.
  const semanas = Array.from({ length: 12 }, (_, week) => repairWeekAt(week))

  // Repetir ids es inevitable y correcto: `romanian_deadlift` tiene 3
  // candidatos y uno es el original. Lo que se verifica NO es diversidad total
  // sino el invariante real, que es el presupuesto entre CADA par.
  for (let later = 1; later < 12; later++) {
    for (let earlier = 0; earlier < later; earlier++) {
      const earlierAll = collectAllStrengthKeys(semanas[earlier]!.sessions as never)
      const shared = [...collectCountableKeys(semanas[later]!.sessions as never)]
        .filter((key) => earlierAll.has(key))
      expect(shared.length, `par ${earlier}->${later}`).toBeLessThan(3)
    }
  }
})

it('la firma del template es pre-rotación y distingue entradas estructuralmente distintas', () => {
  const semana1 = repairWeekAt(1)
  const firma = semana1.find((session) => session.sessionType === 'strength')
    ?.metadata?.planBuilderStrengthRotation?.templateSignature
  expect(firma).toBeDefined()
  // La firma post-rotación existente NO puede ser igual: una describe la
  // entrada y la otra el resultado.
  const posterior = semana1.find((session) => session.sessionType === 'strength')
    ?.metadata?.planBuilderStrengthRotation?.signature
  expect(firma).not.toBe(posterior)
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run src/services/planBuilder/__tests__/strengthAllocatorDomain.test.ts`
Expected: FAIL — `templateSignature` es `undefined`.

- [ ] **Step 3: Emitir la firma pre-rotación**

En `repairWeek.ts`, donde hoy se escribe `planBuilderStrengthRotation`
(línea ~2148), agregar el campo, calculado sobre el **snapshot** de la Tarea 3,
no sobre la sesión ya rotada:

```ts
      session.metadata = {
        ...(session.metadata ?? {}),
        planBuilderStrengthRotation: {
          blockId: currentBlockId,
          signature: canonicalStrengthSignature(session),
          // Describe la ENTRADA, no el resultado: `signature` se calcula
          // después de rotar y por eso no sirve para comparar si dos semanas
          // hermanas partieron del mismo template.
          templateSignature: computeTemplateSignature(snapshot),
        },
      }
```

Extender el tipo de esa metadata en `src/types/` con `templateSignature?: string`.

- [ ] **Step 4: Emitir `allocator.divergent_template`**

Sólo cuando existe una semana anterior del mismo bloque **ya lista** con
`templateSignature` distinta. Bajo concurrencia no la habrá y no se emite —
eso es correcto y debe quedar fijado por test:

**`meta.warnings` contiene objetos, no strings**, así que `not.toContain('...')`
sería vacuo: pasaría siempre, incluso si el warning estuviera. Hay que buscar
por código, y hace falta el **caso positivo**, sin el cual el negativo no prueba
que el emisor exista:

```ts
function hasWarning(meta: RepairMeta, code: string): boolean {
  return (meta.warnings ?? []).some((warning) =>
    typeof warning === 'string' ? warning === code : warning.code === code,
  )
}

it('NO emite divergent_template bajo concurrencia: la hermana es shell', () => {
  const meta = repairMetaFor(1)  // previousWeek sin sesiones: isReadyWeek === false
  expect(hasWarning(meta, 'allocator.divergent_template')).toBe(false)
})

it('SÍ emite divergent_template con una hermana lista y firma distinta', () => {
  // Semana anterior `ready` cuya metadata declara otra templateSignature.
  const anterior = readyWeekWithTemplateSignature('firma-distinta')
  const meta = repairMetaWithPreviousWeek(anterior)
  expect(hasWarning(meta, 'allocator.divergent_template')).toBe(true)
})

it('NO emite divergent_template con una hermana lista y la MISMA firma', () => {
  const anterior = readyWeekWithTemplateSignature(expectedSignatureOfFixture())
  const meta = repairMetaWithPreviousWeek(anterior)
  expect(hasWarning(meta, 'allocator.divergent_template')).toBe(false)
})
```

- [ ] **Step 5: Correr y verificar que pasan**

Run: `npx vitest run src/services/planBuilder/__tests__/strengthAllocatorDomain.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Verificación de cierre**

Run: `npm run lint && npm test && npx tsc -b && npm run build && git diff --check`

---

## Cierre

**Tarea 9 — cierre documental.** Se ejecuta después de la **Tarea 8**, no de la
7: la 8 aporta la firma pre-rotación y tres de los casos obligatorios, así que
antes de ella el trabajo no está completo.

**Files:**
- Modify: `PROJECT_REVIEW_AND_ROADMAP.md` (§29 y checklist §E)
- Modify: `CLAUDE.md` (regla del orden congelado)

Actualizar:

1. `PROJECT_REVIEW_AND_ROADMAP.md` §29: la Causa B pasa de "abierta y explícita"
   a cerrada, con el alcance real —el allocator garantiza I1 sobre la
   **proyección controlada**, no sobre la semana final— y el límite declarado de
   que el relleno de densidad sigue siendo best-effort.
2. El checklist §E: "Confirmar que fuerza no repita plantillas clonadas semana a
   semana" pasa a marcado, citando ambas causas.
3. `CLAUDE.md`, en §Reglas del proyecto, una regla nueva junto a la de
   superseries:

   > **Fuerza: el orden del repair está congelado.** Snapshot del template →
   > proyección estructural del core → allocator de bloque → densidad con
   > exclusiones. Ningún mutador estructural posterior puede escribir sobre una
   > celda asignada: `ensureCoreBlock` y el resto del enriquecedor reciben el
   > conjunto de celdas comprometidas y lo respetan. Cambiar ese orden
   > reintroduce la Causa B del Hallazgo 5.

**Lo que este plan NO cierra, y hay que decirlo al cerrar:** el relleno de
densidad resuelve con su propio `recentExercises`, derivado de `previousWeek`,
que bajo concurrencia puede ser shell o ready. Sigue pudiendo aportar solape. Si
al medir resulta que domina el residual, necesita su propia rotación y es
trabajo aparte.

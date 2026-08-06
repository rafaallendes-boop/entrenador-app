# Superseries de fuerza — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Representar superseries/triseries/circuitos de fuerza como estructura real en las sesiones, editables a mano y generables por el motor determinista, sin migraciones y sin gasto de API.

**Architecture:** Un campo opcional `supersetGroup` (id opaco) en una lista de ejercicios que sigue siendo plana y sigue siendo la única fuente de verdad. Un normalizador aislado corrige tags y rondas; el sort de fuerza aprende a ordenar unidades en vez de ejercicios; los roles posicionales aprenden que un seguidor nunca es `main_lift`; y una política determinista arma los grupos automáticos.

**Tech Stack:** TypeScript, React, Vitest, Dexie (sin cambios de schema), Supabase (sin cambios de schema).

**Spec:** `docs/superpowers/specs/2026-08-05-strength-supersets-design.md` (commit `899ded7`)

## Global Constraints

- **Sin migraciones.** Dexie sigue en v19 y Supabase no cambia. `sessions.data` es `jsonb` y el campo viaja dentro (`syncService.ts:1560-1574`). Si una tarea parece necesitar una migración, está mal planteada — detenerse y consultar.
- **Sin gasto de API.** Ningún paso llama a un proveedor. No ejecutar `npm run loadtest:plan-builder` (~US$0,90); saldo al 2026-07-30 ≈ US$0,60.
- **Los commits los hace el owner.** Regla del proyecto (`CLAUDE.md`). Los pasos de commit muestran el comando exacto, pero el agente **no ejecuta `git add` ni `git commit`**: deja el árbol listo y reporta el comando sugerido.
- **No existe script `typecheck`.** Usar `npx tsc -b --pretty false`, o `npm run build`, que corre `tsc -b` primero.
- **Comandos de verificación:** `npm test` (vitest run), `npm run lint` (eslint .), `npm run build`.
- **Nunca el literal `'default'`** fuera de `activeAthlete.ts` (hay guard test).
- **Identidad de fuerza por `libraryRef`.** Los consumidores que reciben el ejercicio entero resuelven con `resolveStrengthExercise`, nunca por nombre.
- **Regla de rondas:** dentro de un grupo, todos los ejercicios comparten `sets`; gana el `sets` del **primer** ejercicio del grupo.
- **Orden de reglas del normalizador:** contigüidad **antes** que cardinalidad. Caso congelado `A, X, A, A` → ambos segmentos pierden el tag.
- **La política automática solo agrupa candidatos cuyo `sets` ya coincide.** Sin esta restricción deja de ser cierto que solo cambia orden y tags.
- **Entregas 1 y 2 se despliegan juntas** (ver «Despliegue» al final).

---

## File Structure

**Se crean:**

| Archivo | Responsabilidad |
|---|---|
| `src/services/training/supersetGroups.ts` | Contratos de tipo, normalizador y layout. Sin dependencias del motor. |
| `src/services/training/supersetPolicy.ts` | Predicados, `planSupersetGroups`, `shouldApplySupersetPolicy`, `detectSupersetPreference`. |
| `src/services/training/__tests__/supersetGroups.test.ts` | Normalizador: contigüidad, cardinalidad, rondas, idempotencia, fronteras. |
| `src/services/training/__tests__/supersetLayout.test.ts` | Layout y segmentación para render. |
| `src/services/training/__tests__/supersetSerializers.test.ts` | Round-trip de export/import, plantilla, materialización. |
| `src/services/training/__tests__/supersetPolicy.test.ts` | Tabla total de modos, predicados, `detectSupersetPreference`. |
| `src/services/training/__tests__/supersetPolicyAudit.test.ts` | Auditoría del corpus vía `decisions`. |
| `src/services/planBuilder/__tests__/supersetRoleInvariant.test.ts` | Test de propiedad de `main_lift`. |
| `src/services/planBuilder/__tests__/supersetRepairWiring.test.ts` | Cableado del Plan Builder vía `repairGeneratedWeek`. |
| `src/services/__tests__/dataExportSupersetGroup.test.ts` | Round-trip real de export/import. |
| `src/services/training/__tests__/supersetSortParity.test.ts` | Barrido pareado: sesiones sin grupos ordenan igual que hoy. |

**Se modifican:**

| Archivo | Cambio |
|---|---|
| `src/types/index.ts:190-205, 968-980` | `supersetGroup?: string` en `Exercise` y `CoachExerciseProposal`. |
| `src/types/sessionTemplate.ts:184` | `isTemplateExercise` acepta el campo y rechaza no-`string`. |
| `src/services/athlete/coachSessionSerializer.ts:40-48, 81-85, 242-259` | Campo en `CoachSessionDraft` y en las dos conversiones. |
| `src/services/athlete/sessionTemplateSerializer.ts:74-79, 132-141, 414-427` | Allowlists y re-emisión de ids por `Map`. |
| `src/services/dataExport.ts:1370-1381, 1474-1485` | Las dos allowlists de ejercicios. |
| `src/services/planBuilder/strengthRoleContract.ts:24-40` | Roles group-aware. |
| `src/services/training/strengthSessionStructure.ts:19-40` | Sort por unidades. |
| `src/components/session/ExerciseChecklist.tsx` | Render de grupos. |
| `src/components/session/SessionCard.tsx` | Resumen `N ejercicios · M grupos`. |
| `src/components/session/SessionForm.tsx:137-150, 200-232, 262-285, 473-512` | Toggle, flechas, `sets` de solo lectura. |
| `src/services/ai/actionPostProcessor.ts` | Cableado de la política. |
| `src/services/planBuilder/repairWeek.ts:1646, 2246, 2266` | Cableado de la política. |
| `src/services/ai/promptModules/strengthPrompt.ts:157` | Retiro de la regla `A1/A2`. |

---

# ENTREGA 1 — Fundación

## Task 1: Normalizador de grupos

**Files:**
- Create: `src/services/training/supersetGroups.ts`
- Test: `src/services/training/__tests__/supersetGroups.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type SupersetMember = { sets: number; supersetGroup?: string }`
  - `type SupersetCandidate = SupersetMember & { name: string; group?: ExerciseGroup; libraryRef?: ExerciseLibraryRef }`
  - `function normalizeSupersetGroups<T extends SupersetMember>(exercises: readonly T[]): T[]`
  - `function normalizeSupersetGroupId(value: unknown): string | undefined`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/services/training/__tests__/supersetGroups.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { normalizeSupersetGroups, normalizeSupersetGroupId } from '../supersetGroups'

type Row = { name: string; sets: number; supersetGroup?: string }

const row = (name: string, sets: number, supersetGroup?: string): Row => ({ name, sets, supersetGroup })

describe('normalizeSupersetGroups', () => {
  it('conserva un grupo contiguo de dos y no toca a los sueltos', () => {
    const result = normalizeSupersetGroups([
      row('Clean', 4, 'g1'),
      row('Dominadas', 4, 'g1'),
      row('Plancha', 3),
    ])

    expect(result.map((r) => r.supersetGroup)).toEqual(['g1', 'g1', undefined])
    expect(result.map((r) => r.sets)).toEqual([4, 4, 3])
  })

  it('disuelve un segmento de un solo miembro', () => {
    const result = normalizeSupersetGroups([row('Clean', 4, 'g1'), row('Plancha', 3)])

    expect(result[0]!.supersetGroup).toBeUndefined()
  })

  it('propaga los sets del primer ejercicio del grupo', () => {
    const result = normalizeSupersetGroups([
      row('Clean', 5, 'g1'),
      row('Dominadas', 3, 'g1'),
      row('Saltos', 2, 'g1'),
    ])

    expect(result.map((r) => r.sets)).toEqual([5, 5, 5])
  })

  it('disuelve el segundo segmento cuando un id reaparece separado', () => {
    const result = normalizeSupersetGroups([
      row('A1', 4, 'g1'),
      row('A2', 4, 'g1'),
      row('X', 3),
      row('A3', 4, 'g1'),
      row('A4', 4, 'g1'),
    ])

    expect(result.map((r) => r.supersetGroup)).toEqual(['g1', 'g1', undefined, undefined, undefined])
  })

  it('congela el caso A, X, A, A: contigüidad antes que cardinalidad', () => {
    const result = normalizeSupersetGroups([
      row('A', 4, 'g1'),
      row('X', 3),
      row('A', 4, 'g1'),
      row('A', 4, 'g1'),
    ])

    expect(result.map((r) => r.supersetGroup)).toEqual([undefined, undefined, undefined, undefined])
  })

  it('es idempotente', () => {
    const input = [row('A', 5, 'g1'), row('B', 3, 'g1'), row('C', 2, 'g2')]
    const once = normalizeSupersetGroups(input)
    const twice = normalizeSupersetGroups(once)

    expect(twice).toEqual(once)
  })

  it('no muta la entrada', () => {
    const input = [row('A', 5, 'g1'), row('B', 3, 'g1')]
    const snapshot = JSON.parse(JSON.stringify(input))
    normalizeSupersetGroups(input)

    expect(input).toEqual(snapshot)
  })

  it('no reordena, no inserta y no borra', () => {
    const input = [row('A', 4, 'g1'), row('B', 4, 'g1'), row('C', 3)]
    const result = normalizeSupersetGroups(input)

    expect(result.map((r) => r.name)).toEqual(['A', 'B', 'C'])
  })

  it('trata ids vacios o no-string como ausencia de grupo', () => {
    const result = normalizeSupersetGroups([
      { name: 'A', sets: 4, supersetGroup: '   ' },
      { name: 'B', sets: 4, supersetGroup: '   ' },
      { name: 'C', sets: 4, supersetGroup: 7 as unknown as string },
      { name: 'D', sets: 4, supersetGroup: 7 as unknown as string },
    ])

    expect(result.map((r) => r.supersetGroup)).toEqual([undefined, undefined, undefined, undefined])
  })
})

describe('normalizeSupersetGroupId', () => {
  it('recorta y descarta vacios y no-strings', () => {
    expect(normalizeSupersetGroupId('  g1 ')).toBe('g1')
    expect(normalizeSupersetGroupId('')).toBeUndefined()
    expect(normalizeSupersetGroupId('   ')).toBeUndefined()
    expect(normalizeSupersetGroupId(undefined)).toBeUndefined()
    expect(normalizeSupersetGroupId(42)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run src/services/training/__tests__/supersetGroups.test.ts`
Expected: FAIL — `Failed to resolve import "../supersetGroups"`

- [ ] **Step 3: Implementar el módulo**

Crear `src/services/training/supersetGroups.ts`:

```ts
import type { ExerciseGroup } from '../../types'
import type { ExerciseLibraryRef } from '../../types/exerciseLibraryRef'

/** Estructura pura: alcanza para agrupar, validar y renderizar. */
export type SupersetMember = {
  sets: number
  supersetGroup?: string
}

/** Estructura + identidad deportiva: lo que la politica necesita para decidir. */
export type SupersetCandidate = SupersetMember & {
  name: string
  group?: ExerciseGroup
  libraryRef?: ExerciseLibraryRef
}

/**
 * Frontera runtime: un id vacio, en blanco o no-string es AUSENCIA de grupo,
 * nunca un grupo invalido. Se aplica en todo borde de deserializacion.
 */
export function normalizeSupersetGroupId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

interface RawSegment {
  groupId: string | undefined
  start: number
  length: number
}

function splitIntoRawSegments<T extends SupersetMember>(exercises: readonly T[]): RawSegment[] {
  const segments: RawSegment[] = []

  exercises.forEach((exercise, index) => {
    const groupId = normalizeSupersetGroupId(exercise.supersetGroup)
    const previous = segments[segments.length - 1]

    if (groupId != null && previous && previous.groupId === groupId) {
      previous.length += 1
      return
    }
    segments.push({ groupId, start: index, length: 1 })
  })

  return segments
}

/**
 * Corrige tags y `sets`. NO reordena, NO inserta y NO borra: eso mantiene
 * intactos los contratos posicionales de fuerza.
 *
 * Reglas, EN ESTE ORDEN:
 *   1. Contiguidad — el PRIMER segmento reclama el id; una reaparicion posterior
 *      del mismo id se disuelve.
 *   2. Cardinalidad — un segmento de 1 miembro pierde el tag.
 *   3. Rondas — todo el segmento adopta el `sets` de su primer miembro.
 *
 * El orden importa: con `A, X, A, A` el primer segmento reserva `A` aunque
 * despues se disuelva por singleton, asi que el segundo tambien lo pierde.
 */
export function normalizeSupersetGroups<T extends SupersetMember>(exercises: readonly T[]): T[] {
  const segments = splitIntoRawSegments(exercises)
  const claimed = new Set<string>()
  const result: T[] = []

  for (const segment of segments) {
    const members = exercises.slice(segment.start, segment.start + segment.length)
    let groupId = segment.groupId

    if (groupId != null) {
      if (claimed.has(groupId)) groupId = undefined   // regla 1
      else claimed.add(groupId)
    }
    if (groupId != null && members.length < 2) groupId = undefined   // regla 2

    const anchorSets = members[0]!.sets   // regla 3

    for (const member of members) {
      const nextSets = groupId == null ? member.sets : anchorSets
      if (member.supersetGroup === groupId && member.sets === nextSets) {
        result.push(member)
        continue
      }
      const next = { ...member, sets: nextSets } as T
      if (groupId == null) delete (next as { supersetGroup?: string }).supersetGroup
      else (next as { supersetGroup?: string }).supersetGroup = groupId
      result.push(next)
    }
  }

  return result
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/services/training/__tests__/supersetGroups.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Dejar listo para commit**

No ejecutar. Comando sugerido para el owner:

```bash
git add src/services/training/supersetGroups.ts src/services/training/__tests__/supersetGroups.test.ts
git commit -m "feat(strength): add superset group normalizer"
```

---

## Task 2: Layout para render

**Files:**
- Modify: `src/services/training/supersetGroups.ts`
- Test: `src/services/training/__tests__/supersetLayout.test.ts`

**Interfaces:**
- Consumes: `normalizeSupersetGroups`, `SupersetMember` (Task 1).
- Produces:
  - `interface SupersetSegment<T> { groupId?: string; members: T[] }`
  - `function resolveSupersetLayout<T extends SupersetMember>(exercises: readonly T[]): SupersetSegment<T>[]`
  - `function describeSupersetSegment(memberCount: number): 'Superserie' | 'Triserie' | 'Circuito'`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/services/training/__tests__/supersetLayout.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { describeSupersetSegment, resolveSupersetLayout } from '../supersetGroups'

type Row = { name: string; sets: number; supersetGroup?: string }

const row = (name: string, sets: number, supersetGroup?: string): Row => ({ name, sets, supersetGroup })

describe('resolveSupersetLayout', () => {
  it('devuelve un segmento por grupo y singletons para los sueltos', () => {
    const layout = resolveSupersetLayout([
      row('Plancha', 4, 'g1'),
      row('Abs ruso', 4, 'g1'),
      row('Sentadilla', 3),
    ])

    expect(layout).toHaveLength(2)
    expect(layout[0]!.groupId).toBe('g1')
    expect(layout[0]!.members.map((m) => m.name)).toEqual(['Plancha', 'Abs ruso'])
    expect(layout[1]!.groupId).toBeUndefined()
    expect(layout[1]!.members.map((m) => m.name)).toEqual(['Sentadilla'])
  })

  it('normaliza defensivamente: nunca expone un grupo corrupto', () => {
    const layout = resolveSupersetLayout([
      row('A', 4, 'g1'),
      row('X', 3),
      row('B', 4, 'g1'),
      row('C', 4, 'g1'),
    ])

    expect(layout.every((segment) => segment.groupId === undefined)).toBe(true)
    expect(layout).toHaveLength(4)
  })

  it('preserva el orden de entrada', () => {
    const layout = resolveSupersetLayout([row('A', 3), row('B', 4, 'g1'), row('C', 4, 'g1')])

    expect(layout.flatMap((s) => s.members.map((m) => m.name))).toEqual(['A', 'B', 'C'])
  })
})

describe('describeSupersetSegment', () => {
  it('deriva la etiqueta de la cardinalidad', () => {
    expect(describeSupersetSegment(2)).toBe('Superserie')
    expect(describeSupersetSegment(3)).toBe('Triserie')
    expect(describeSupersetSegment(4)).toBe('Circuito')
    expect(describeSupersetSegment(7)).toBe('Circuito')
  })
})
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `npx vitest run src/services/training/__tests__/supersetLayout.test.ts`
Expected: FAIL — `resolveSupersetLayout is not a function`

- [ ] **Step 3: Implementar**

Agregar al final de `src/services/training/supersetGroups.ts`:

```ts
export interface SupersetSegment<T> {
  groupId?: string
  members: T[]
}

/**
 * Para consumidores de RENDER. Normaliza internamente, de modo que la UI nunca
 * interprete como valida una estructura corrupta. El EDITOR no la usa: alli un
 * grupo de 1 en construccion es un estado intermedio legitimo.
 */
export function resolveSupersetLayout<T extends SupersetMember>(
  exercises: readonly T[],
): SupersetSegment<T>[] {
  const normalized = normalizeSupersetGroups(exercises)

  return splitIntoRawSegments(normalized).map((segment) => ({
    groupId: segment.groupId,
    members: normalized.slice(segment.start, segment.start + segment.length),
  }))
}

export function describeSupersetSegment(memberCount: number): 'Superserie' | 'Triserie' | 'Circuito' {
  if (memberCount <= 2) return 'Superserie'
  if (memberCount === 3) return 'Triserie'
  return 'Circuito'
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/services/training/__tests__/supersetLayout.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Dejar listo para commit**

```bash
git add src/services/training/supersetGroups.ts src/services/training/__tests__/supersetLayout.test.ts
git commit -m "feat(strength): add superset layout resolver"
```

---

## Task 3: Propagar el campo por la cadena de tipos

**Files:**
- Modify: `src/types/index.ts:190-205` (`Exercise`), `src/types/index.ts:968-980` (`CoachExerciseProposal`)
- Modify: `src/types/sessionTemplate.ts:184` (`isTemplateExercise`)
- Modify: `src/services/athlete/coachSessionSerializer.ts:40-48` (`CoachSessionDraft`)
- Test: `src/services/training/__tests__/supersetSerializers.test.ts` (se crea acá, se amplía en Task 4)

**Interfaces:**
- Consumes: `normalizeSupersetGroupId` (Task 1).
- Produces: `Exercise.supersetGroup`, `CoachExerciseProposal.supersetGroup`, `CoachSessionDraft['exercises'][number].supersetGroup`. `SessionTemplateExercise` lo hereda automáticamente por ser `Omit<Exercise, 'id' | 'completed'>`.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/services/training/__tests__/supersetSerializers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { isSessionTemplatePayloadV1 } from '../../../types/sessionTemplate'

describe('isTemplateExercise', () => {
  const base = { type: 'strength', timeBlock: 'AM', title: 'Fuerza', durationMin: 60 }

  it('acepta un ejercicio con supersetGroup string', () => {
    expect(isSessionTemplatePayloadV1({
      ...base,
      exercises: [{ name: 'Clean', sets: 4, reps: '3', supersetGroup: 'g1' }],
    })).toBe(true)
  })

  it('acepta un ejercicio sin supersetGroup', () => {
    expect(isSessionTemplatePayloadV1({
      ...base,
      exercises: [{ name: 'Clean', sets: 4, reps: '3' }],
    })).toBe(true)
  })

  it('rechaza un supersetGroup no-string', () => {
    expect(isSessionTemplatePayloadV1({
      ...base,
      exercises: [{ name: 'Clean', sets: 4, reps: '3', supersetGroup: 7 }],
    })).toBe(false)
  })
})
```

> `isTemplateExercise` no se exporta a propósito; se ejercita a través de
> `isSessionTemplatePayloadV1` (`src/types/sessionTemplate.ts:203`), que es el
> guard público.

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `npx vitest run src/services/training/__tests__/supersetSerializers.test.ts`
Expected: FAIL — el caso no-string devuelve `true` porque el guard ignora el campo.

- [ ] **Step 3: Agregar el campo a los tres tipos**

En `src/types/index.ts`, dentro de `interface Exercise` (después de `libraryRef`):

```ts
  supersetGroup?: string   // id opaco y estable de superserie; la etiqueta visible se deriva
```

En `src/types/index.ts`, dentro de `interface CoachExerciseProposal` (después de `libraryRef`):

```ts
  supersetGroup?: string   // id opaco de superserie; la politica corre antes de materializar
```

En `src/services/athlete/coachSessionSerializer.ts`, dentro de `exercises?: Array<{ … }>`:

```ts
    supersetGroup?: string
```

- [ ] **Step 4: Endurecer el type guard**

En `src/types/sessionTemplate.ts`, dentro de `isTemplateExercise`, agregar a la
condición de rechazo (junto a `!isOptionalString(value.notes)`):

```ts
    || !isOptionalString(value.supersetGroup)
```

- [ ] **Step 5: Correr los tests y el typecheck**

Run: `npx vitest run src/services/training/__tests__/supersetSerializers.test.ts`
Expected: PASS — 3 tests.

Run: `npx tsc -b --pretty false`
Expected: sin salida (éxito).

- [ ] **Step 6: Dejar listo para commit**

```bash
git add src/types/index.ts src/types/sessionTemplate.ts \
        src/services/athlete/coachSessionSerializer.ts \
        src/services/training/__tests__/supersetSerializers.test.ts
git commit -m "feat(strength): thread supersetGroup through exercise types"
```

---

## Task 4: Allowlists de serializers y re-emisión de ids

**Files:**
- Modify: `src/services/athlete/sessionTemplateSerializer.ts:74-79, 132-141, 414-427`
- Modify: `src/services/athlete/coachSessionSerializer.ts:81-85, 242-259`
- Modify: `src/services/dataExport.ts:1370-1381, 1474-1485`
- Test: `src/services/training/__tests__/supersetSerializers.test.ts` (ampliar)

**Interfaces:**
- Consumes: `Exercise.supersetGroup`, `CoachExerciseProposal.supersetGroup` (Task 3).
- Produces: `materializeTemplateSession` re-emite ids de grupo por aplicación, usando un `Map<string, string>` local.

- [ ] **Step 1: Escribir los tests de round-trip que fallan**

Agregar a `src/services/training/__tests__/supersetSerializers.test.ts`:

```ts
import {
  materializeTemplateSession,
  sessionToTemplatePayload,
  templateToDraft,
} from '../../athlete/sessionTemplateSerializer'
import { normalizeSupersetGroups } from '../supersetGroups'

// materializeTemplateSession(payload, { date, overlayDraft, originalsById })
// -- sessionTemplateSerializer.ts:383. El draft y el mapa de originales salen
// de templateToDraft, que es como lo llama la UI.

const templateExercise = (name: string, supersetGroup?: string) => ({
  name,
  sets: 4,
  reps: '8',
  ...(supersetGroup ? { supersetGroup } : {}),
})

describe('plantillas y superseries', () => {
  const payload = {
    type: 'strength' as const,
    timeBlock: 'AM' as const,
    title: 'Fuerza',
    durationMin: 60,
    exercises: [
      templateExercise('Clean', 'g1'),
      templateExercise('Dominadas', 'g1'),
      templateExercise('Plancha'),
    ],
  }

  const materializeOnce = (date: string) => {
    const { draft, originalsById } = templateToDraft(payload, date)
    return materializeTemplateSession(payload, { date, overlayDraft: draft, originalsById })
  }

  it('materializar conserva la relacion interna con ids nuevos', () => {
    const session = materializeOnce('2026-08-10')
    const groups = session.exercises!.map((e) => e.supersetGroup)

    expect(groups[0]).toBeDefined()
    expect(groups[0]).toBe(groups[1])
    expect(groups[0]).not.toBe('g1')
    expect(groups[2]).toBeUndefined()
  })

  it('aplicar dos veces la misma plantilla no colisiona', () => {
    const first = materializeOnce('2026-08-10')
    const second = materializeOnce('2026-08-10')

    expect(first.exercises![0]!.supersetGroup).not.toBe(second.exercises![0]!.supersetGroup)
  })

  it('materializar repara un grupo corrupto de la plantilla', () => {
    const corrupto = {
      ...payload,
      exercises: [
        templateExercise('Clean', 'g1'),
        templateExercise('Plancha', 'g2'),      // singleton: debe disolverse
        templateExercise('Dominadas', 'g1'),    // reaparicion: debe disolverse
      ],
    }

    const { draft, originalsById } = templateToDraft(corrupto, '2026-08-10')
    const session = materializeTemplateSession(corrupto, {
      date: '2026-08-10', overlayDraft: draft, originalsById,
    })

    expect(session.exercises!.every((e) => e.supersetGroup == null)).toBe(true)
  })

  it('materializar iguala sets divergentes dentro de un grupo', () => {
    const divergente = {
      ...payload,
      exercises: [
        { ...templateExercise('Clean', 'g1'), sets: 5 },
        { ...templateExercise('Dominadas', 'g1'), sets: 3 },
      ],
    }

    const { draft, originalsById } = templateToDraft(divergente, '2026-08-10')
    const session = materializeTemplateSession(divergente, {
      date: '2026-08-10', overlayDraft: draft, originalsById,
    })

    expect(session.exercises!.map((e) => e.sets)).toEqual([5, 5])
  })

  it('datos antiguos sin el campo permanecen identicos', () => {
    const legacy = [
      { id: 'a', name: 'Clean', sets: 4, reps: '3', completed: false },
      { id: 'b', name: 'Dominadas', sets: 4, reps: '8', completed: false },
    ]

    const normalized = normalizeSupersetGroups(legacy)

    expect(normalized).toEqual(legacy)
    expect(normalized.every((e) => !('supersetGroup' in e))).toBe(true)
  })

  it('guardar una sesion como plantilla conserva sus grupos', () => {
    const saved = sessionToTemplatePayload({
      ...payload,
      exercises: payload.exercises.map((e, index) => ({ ...e, id: `e${index}`, completed: false })),
    } as never)

    expect(saved.exercises!.map((e) => e.supersetGroup)).toEqual(['g1', 'g1', undefined])
  })
})
```

> Nombres reales verificados: `sessionToTemplatePayload`
> (`sessionTemplateSerializer.ts:31`) y `materializeTemplateSession` (`:383`,
> cuyo `map` de ejercicios está en `:414-427`).

- [ ] **Step 2: Correr y confirmar que fallan**

Run: `npx vitest run src/services/training/__tests__/supersetSerializers.test.ts`
Expected: FAIL — `supersetGroup` llega `undefined` porque los allowlists lo descartan.

- [ ] **Step 3: Agregar el campo a los cuatro allowlists**

En `sessionTemplateSerializer.ts:74-79` (sesión → payload), junto a `libraryRef`:

```ts
    supersetGroup: normalizeSupersetGroupId(exercise.supersetGroup),
```

En `sessionTemplateSerializer.ts:132-141` (borrador → payload), replicando el
patrón de `libraryRef`:

```ts
      const supersetGroup = normalizeSupersetGroupId(draft.supersetGroup)
      if (supersetGroup) mergedExercise.supersetGroup = supersetGroup
      else delete mergedExercise.supersetGroup
```

En `coachSessionSerializer.ts:81-85` y `:242-259`, agregar en cada construcción
de ejercicio, con el mismo patrón condicional que usa `libraryRef`:

```ts
      supersetGroup: normalizeSupersetGroupId(exercise.supersetGroup),
```

En `dataExport.ts:1370-1381` y `:1474-1485`, junto a `libraryRef`:

```ts
      supersetGroup: normalizeSupersetGroupId(row.supersetGroup),
```

**Sanitizar el id no alcanza.** §5.1 exige que import/restore pase por el
normalizador **completo**: un backup puede traer un grupo con contigüidad rota,
un singleton o `sets` divergentes, y ninguna de esas tres cosas la arregla
`normalizeSupersetGroupId`. Envolver el `return` de las dos funciones —
`optionalExercises` (`dataExport.ts:1359`) y `optionalCoachExercises` (`:1466`):

```ts
  return normalizeSupersetGroups(rows)
```

donde `rows` es el arreglo que hoy devuelven directamente.

Importar en cada archivo **ambas** funciones (el paso 4 y el envoltorio de los
bordes usan `normalizeSupersetGroups`, no solo el sanitizador de id):

```ts
import { normalizeSupersetGroupId, normalizeSupersetGroups } from '../training/supersetGroups'
```

(desde `dataExport.ts` la ruta es `./training/supersetGroups`).

- [ ] **Step 4: Re-emitir ids de grupo al materializar una plantilla**

En `sessionTemplateSerializer.ts:414-427`, reemplazar el `map` de ejercicios por
uno que comparta un `Map` por aplicación:

```ts
    exercises: (() => {
      const groupIds = new Map<string, string>()
      return mergedPayload.exercises?.map((exercise) => {
        const copy = structuredClone(exercise) as Record<string, unknown>
        delete copy.libraryRef
        delete copy.supersetGroup
        const libraryRef = sanitizeExerciseLibraryRef(exercise.libraryRef)
        const sourceGroup = normalizeSupersetGroupId(exercise.supersetGroup)
        let supersetGroup: string | undefined
        if (sourceGroup) {
          if (!groupIds.has(sourceGroup)) groupIds.set(sourceGroup, uuid())
          supersetGroup = groupIds.get(sourceGroup)
        }
        return {
          ...copy,
          id: uuid(),
          completed: false,
          ...(libraryRef ? { libraryRef } : {}),
          ...(supersetGroup ? { supersetGroup } : {}),
        }
      })
    })(),
```

Todos los miembros del mismo grupo reciben el mismo UUID nuevo; dos aplicaciones
reciben UUIDs distintos. **Import/export normal conserva el id**: el remapeo
ocurre únicamente acá.

Y envolver la lista ya remapeada en el normalizador, por el mismo motivo que en
`dataExport`: una plantilla guardada por una versión anterior puede tener grupos
inconsistentes. **`mergedPayload.exercises` puede ser `undefined`**, y
`normalizeSupersetGroups` exige un arreglo, así que hay que materializar primero
y envolver después — no encadenar sobre el opcional:

```ts
  const materializedExercises = (() => {
    const groupIds = new Map<string, string>()
    return mergedPayload.exercises?.map((exercise) => {
      /* …el cuerpo del map de arriba… */
    })
  })()

  // …y en el objeto devuelto:
    exercises: materializedExercises ? normalizeSupersetGroups(materializedExercises) : undefined,
```

- [ ] **Step 5: Escribir el round-trip real de export/import**

Crear `src/services/__tests__/dataExportSupersetGroup.test.ts` **espejando
`dataExportLibraryRef.test.ts`**, que ya hace exactamente este round-trip
(`exportAppData` → `JSON.parse` → `parseAppDataExport`) con el setup de Dexie
correspondiente. Copiar ese archivo, y cambiar únicamente el campo bajo prueba:

```ts
  it('round-trip real: exportAppData → parseAppDataExport conserva supersetGroup', async () => {
    // …mismo setup de Dexie que dataExportLibraryRef.test.ts, pero sembrando
    // una sesion de fuerza con dos ejercicios agrupados y uno suelto:
    //   { name: 'Clean', sets: 4, reps: '3', supersetGroup: 'g1' }
    //   { name: 'Dominadas', sets: 4, reps: '8', supersetGroup: 'g1' }
    //   { name: 'Plancha frontal', sets: 3, reps: '30s' }
    const { json } = await exportAppData()
    const parsed = parseAppDataExport(JSON.parse(json))

    const exercises = parsed.sessions[0]!.exercises!
    expect(exercises.map((e) => e.supersetGroup)).toEqual(['g1', 'g1', undefined])
  })
```

Import/export normal **conserva** el id: acá no se remapea nada.

Y un segundo test en el mismo archivo, que es el que de verdad prueba el borde
—falla si `optionalExercises` no está envuelta en el normalizador—, usando
`parseAppDataExport` directamente sobre un export con un grupo **corrupto**:

```ts
  it('parseAppDataExport repara un grupo corrupto del backup', () => {
    // Partir del mismo export valido del test anterior y ensuciar la sesion:
    //   [{ name: 'Clean', supersetGroup: 'g1', sets: 5 },
    //    { name: 'Plancha frontal' },                      // corta la contiguidad
    //    { name: 'Dominadas', supersetGroup: 'g1', sets: 3 }]  // id reaparecido
    const parsed = parseAppDataExport(corruptedExport)

    const exercises = parsed.sessions[0]!.exercises!
    expect(exercises.every((e) => e.supersetGroup == null)).toBe(true)
  })
```

- [ ] **Step 6: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/services/training/__tests__/supersetSerializers.test.ts src/services/__tests__/dataExportSupersetGroup.test.ts`
Expected: PASS — 8 tests de plantillas + 2 de export/import.

Run: `npx vitest run src/services/__tests__ src/services/athlete/__tests__`
Expected: PASS — sin regresiones en export/import ni plantillas.

- [ ] **Step 7: Dejar listo para commit**

```bash
git add src/services/athlete/sessionTemplateSerializer.ts \
        src/services/athlete/coachSessionSerializer.ts \
        src/services/dataExport.ts \
        src/services/training/__tests__/supersetSerializers.test.ts \
        src/services/__tests__/dataExportSupersetGroup.test.ts
git commit -m "feat(strength): persist superset groups across serializers"
```

---

## Task 5: Roles group-aware y test de propiedad

**Files:**
- Modify: `src/services/planBuilder/strengthRoleContract.ts:24-40`
- Test: `src/services/planBuilder/__tests__/supersetRoleInvariant.test.ts`

**Interfaces:**
- Consumes: `normalizeSupersetGroups` (Task 1).
- Produces: `resolveSessionStrengthRoles` acepta `supersetGroup` y aplica la precedencia con seguidores. Firma nueva:
  `resolveSessionStrengthRoles(exercises: ReadonlyArray<{ name: string; libraryRef?: ExerciseLibraryRef; supersetGroup?: string }>): StrengthContractRole[]`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/services/planBuilder/__tests__/supersetRoleInvariant.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { resolveSessionStrengthRoles } from '../strengthRoleContract'

const ex = (name: string, supersetGroup?: string) => ({ name, ...(supersetGroup ? { supersetGroup } : {}) })

describe('resolveSessionStrengthRoles con grupos', () => {
  it('un seguidor nunca es main_lift', () => {
    const roles = resolveSessionStrengthRoles([
      ex('Clean', 'g1'),
      ex('Dominadas', 'g1'),
      ex('Peso muerto con trap bar'),
    ])

    expect(roles[1]).toBe('accessory')
    expect(roles[2]).toBe('main_lift')
  })

  it('un core dentro de un grupo sigue siendo trunk', () => {
    const roles = resolveSessionStrengthRoles([
      ex('Sentadilla trasera con barra'),
      ex('Plancha frontal', 'g1'),
      ex('Pallof press', 'g1'),
    ])

    expect(roles[1]).toBe('trunk')
    expect(roles[2]).toBe('trunk')
  })

  it('un power dentro de un grupo sigue siendo power', () => {
    const roles = resolveSessionStrengthRoles([
      ex('Peso muerto con trap bar'),
      ex('Remo con pecho apoyado', 'g1'),
      ex('Salto al cajon', 'g1'),
    ])

    expect(roles[2]).toBe('power')
  })

  it('sin grupos el comportamiento es identico al anterior', () => {
    const roles = resolveSessionStrengthRoles([
      ex('Plancha frontal'),
      ex('Clean'),
      ex('Peso muerto con trap bar'),
      ex('Remo con pecho apoyado'),
    ])

    expect(roles).toEqual(['trunk', 'power', 'main_lift', 'accessory'])
  })
})

describe('elegibilidad de lider', () => {
  it('solo el primer miembro de un segmento es elegible para main_lift', () => {
    const roles = resolveSessionStrengthRoles([
      ex('Clean', 'g1'),
      ex('Dominadas', 'g1'),
      ex('Peso muerto con trap bar'),
      ex('Remo con pecho apoyado'),
    ])

    expect(roles).toEqual(['power', 'accessory', 'main_lift', 'accessory'])
  })
})

// La invariante COMPLETA -- main_lift(entrada) === main_lift(salida de la
// politica, ya con reflow) -- se prueba en supersetPolicy.test.ts (Task 10),
// que es donde la politica existe. Acá solo se fija la regla de elegibilidad
// sobre la que esa invariante se apoya.

- [ ] **Step 2: Correr y confirmar que fallan**

Run: `npx vitest run src/services/planBuilder/__tests__/supersetRoleInvariant.test.ts`
Expected: FAIL — el primer test da `main_lift` en `Dominadas` (índice 1).

- [ ] **Step 3: Implementar los roles group-aware**

En `src/services/planBuilder/strengthRoleContract.ts`, reemplazar
`resolveSessionStrengthRoles` por:

```ts
/**
 * Precedencia, en orden:
 *   unknown -> unknown | core -> trunk | power -> power
 *   seguidor de un grupo -> accessory (pierde elegibilidad para main_lift)
 *   primer lider restante -> main_lift (EXENTO) | resto -> accessory
 *
 * Un core o un power dentro de un grupo CONSERVAN su rol: la regla de seguidor
 * solo bloquea la elegibilidad para main_lift, asi que no se abre un agujero de
 * exencion.
 */
export function resolveSessionStrengthRoles(
  exercises: ReadonlyArray<{ name: string; libraryRef?: ExerciseLibraryRef; supersetGroup?: string }>,
): StrengthContractRole[] {
  let mainLiftTaken = false
  const isLeader = resolveLeaderFlags(exercises)

  return exercises.map((exercise, index) => {
    const definition = resolveStrengthExercise(exercise)?.definition
    if (!definition) return 'unknown'
    if (definition.category === 'core') return 'trunk'
    if (definition.intensityType === 'power') return 'power'
    if (!isLeader[index]) return 'accessory'
    if (!mainLiftTaken) {
      mainLiftTaken = true
      return 'main_lift'
    }
    return 'accessory'
  })
}

/**
 * Un ejercicio es lider si no tiene grupo, o si es el primer miembro de su
 * segmento normalizado. Se normaliza primero para que un tag corrupto no
 * fabrique seguidores fantasma.
 */
function resolveLeaderFlags(
  exercises: ReadonlyArray<{ supersetGroup?: string }>,
): boolean[] {
  const normalized = normalizeSupersetGroups(
    exercises.map((exercise) => ({ sets: 1, supersetGroup: exercise.supersetGroup })),
  )

  return normalized.map((exercise, index) => {
    if (!exercise.supersetGroup) return true
    return normalized[index - 1]?.supersetGroup !== exercise.supersetGroup
  })
}
```

Agregar el import:

```ts
import { normalizeSupersetGroups } from '../training/supersetGroups'
```

- [ ] **Step 4: Agregar el gate de `countableKeys` antes/después**

El spec §9 exige comparación directa de lo que alimenta `qualityReview` y
`countRepairsV2`, además del razonamiento. Agregar al mismo archivo:

```ts
import { collectCountableKeys } from '../strengthRoleContract'

describe('no regresion de calidad', () => {
  const SESSION = {
    sessionType: 'strength',
    exercises: [
      { name: 'Plancha frontal' },
      { name: 'Clean' },
      { name: 'Peso muerto con trap bar' },
      { name: 'Remo con pecho apoyado' },
      { name: 'Press vertical' },
    ],
  }

  it('agrupar accesorios no cambia el conjunto contable', () => {
    const before = collectCountableKeys([SESSION as never])

    const grouped = {
      sessionType: 'strength',
      exercises: SESSION.exercises.map((exercise, index) => (
        index >= 3 ? { ...exercise, supersetGroup: 'g1' } : exercise
      )),
    }
    const after = collectCountableKeys([grouped as never])

    expect([...after].sort()).toEqual([...before].sort())
  })
})
```

El `main_lift` sigue siendo `Peso muerto con trap bar` en ambos casos, así que el
conjunto exento no se mueve y el contable queda idéntico. Si este test falla, la
invariante de §6.3 se rompió.

- [ ] **Step 5: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/services/planBuilder/__tests__/supersetRoleInvariant.test.ts`
Expected: PASS — 6 tests.

Run: `npx vitest run src/services/planBuilder src/services/training`
Expected: PASS — sin regresiones en `qualityReview` ni `repairWeek`.

- [ ] **Step 6: Dejar listo para commit**

```bash
git add src/services/planBuilder/strengthRoleContract.ts \
        src/services/planBuilder/__tests__/supersetRoleInvariant.test.ts
git commit -m "feat(strength): make strength role contract superset-aware"
```

---

# ENTREGA 2 — Ordenamiento por unidades

## Task 6: Sort de unidades y barrido pareado

**Files:**
- Modify: `src/services/training/strengthSessionStructure.ts:19-40`
- Test: `src/services/training/__tests__/supersetSortParity.test.ts`

**Interfaces:**
- Consumes: `normalizeSupersetGroups`, `resolveSupersetLayout` (Tasks 1-2).
- Produces: `normalizeStrengthSessionExercises` mantiene su firma pública; ordena unidades cuando hay grupos.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/services/training/__tests__/supersetSortParity.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { normalizeStrengthSessionExercises } from '../strengthSessionStructure'

const ex = (name: string, sets: number, supersetGroup?: string) => ({
  name,
  sets,
  reps: 8,
  ...(supersetGroup ? { supersetGroup } : {}),
})

describe('orden con superseries', () => {
  it('mantiene juntos los miembros de un grupo cross-block', () => {
    const result = normalizeStrengthSessionExercises([
      ex('Plancha frontal', 4),
      ex('Clean', 4, 'g1'),
      ex('Dominadas', 4, 'g1'),
      ex('Peso muerto con trap bar', 4),
    ], { durationMin: 60 })!

    const names = result.map((e) => e.name)
    const cleanIndex = names.indexOf('Clean')

    expect(names[cleanIndex + 1]).toBe('Dominadas')
  })

  it('ordena la unidad por el bloque de su lider', () => {
    const result = normalizeStrengthSessionExercises([
      ex('Peso muerto con trap bar', 4),
      ex('Clean', 4, 'g1'),
      ex('Dominadas', 4, 'g1'),
    ], { durationMin: 60 })!

    // olympic (lider del grupo) precede a legs en BLOCK_ORDER
    expect(result.map((e) => e.name)).toEqual(['Clean', 'Dominadas', 'Peso muerto con trap bar'])
  })

  it('no vuelve a correr un sort individual despues de agrupar', () => {
    const result = normalizeStrengthSessionExercises([
      ex('Clean', 4, 'g1'),
      ex('Dominadas', 4, 'g1'),
      ex('Salto al cajon', 4, 'g1'),
    ], { durationMin: 60 })!

    expect(result.map((e) => e.name)).toEqual(['Clean', 'Dominadas', 'Salto al cajon'])
  })
})

describe('paridad sin grupos', () => {
  const CORPUS: Array<Array<ReturnType<typeof ex>>> = [
    [ex('Peso muerto con trap bar', 4), ex('Plancha frontal', 3), ex('Remo con pecho apoyado', 3)],
    [ex('Dominadas', 4), ex('Clean', 3), ex('Sentadilla trasera con barra', 4)],
    [ex('Pallof press', 3), ex('Salto al cajon', 4), ex('Press vertical', 3)],
  ]

  it('una sesion sin grupos produce el mismo orden que el comparador plano', () => {
    for (const session of CORPUS) {
      const result = normalizeStrengthSessionExercises(session, { durationMin: 60 })!

      expect(result.every((e) => e.supersetGroup === undefined)).toBe(true)
      // Se compara contra el snapshot congelado abajo, no contra una reimplementacion.
      expect(result.map((e) => e.name)).toMatchSnapshot()
    }
  })
})
```

- [ ] **Step 2: Congelar el snapshot ANTES de tocar el sort**

Este paso es el gate de paridad y **debe correrse sobre el código actual**:

Correr **solo el bloque de paridad**, con `-t`, para que los tres tests de
«orden con superseries» —que a esta altura fallan a propósito— no contaminen la
corrida ni bloqueen la escritura del snapshot:

Run: `npx vitest run src/services/training/__tests__/supersetSortParity.test.ts -t "paridad sin grupos" -u`
Expected: PASS — 1 test, y se escribe `__snapshots__/supersetSortParity.test.ts.snap`.

Confirmar que el snapshot quedó escrito antes de seguir:

Run: `git status --short src/services/training/__tests__/__snapshots__/`
Expected: aparece el archivo `.snap` como no rastreado.

- [ ] **Step 3: Extraer el comparador y bifurcar el sort**

En `src/services/training/strengthSessionStructure.ts`, reemplazar el `return`
de `normalizeStrengthSessionExercises` (líneas 35-39) por:

```ts
  return sortStrengthSessionUnits(withCore)
```

Y agregar, junto a `groupRank` y `coreRank`:

```ts
function compareStrengthExercises(a: StrengthExerciseLike, b: StrengthExerciseLike): number {
  const groupDelta = groupRank(a.group) - groupRank(b.group)
  if (groupDelta !== 0) return groupDelta
  return coreRank(a) - coreRank(b)
}

/**
 * Dos caminos, decididos ANTES de ordenar:
 *   - Sin grupos: sort actual, ejercicio por ejercicio. Identico a hoy.
 *   - Con grupos: se ordenan UNIDADES con el mismo comparador, evaluado sobre
 *     el lider; los miembros lo siguen.
 * El comparador no cambia; cambia la unidad. Tras agrupar NO vuelve a correr
 * ningun sort individual.
 */
function sortStrengthSessionUnits<T extends StrengthExerciseLike>(exercises: T[]): T[] {
  const normalized = normalizeSupersetGroups(exercises)
  const hasGroups = normalized.some((exercise) => exercise.supersetGroup != null)

  if (!hasGroups) return [...normalized].sort(compareStrengthExercises)

  return resolveSupersetLayout(normalized)
    .slice()
    .sort((a, b) => compareStrengthExercises(a.members[0]!, b.members[0]!))
    .flatMap((segment) => segment.members)
}
```

Agregar el import:

```ts
import { normalizeSupersetGroups, resolveSupersetLayout } from './supersetGroups'
```

> `Array.prototype.sort` es estable en V8, así que los empates conservan el orden
> de entrada — tanto en el camino plano como en el de unidades. El comportamiento
> actual ya depende de esa estabilidad.

- [ ] **Step 4: Correr los tests y confirmar que pasan sin regenerar el snapshot**

Run: `npx vitest run src/services/training/__tests__/supersetSortParity.test.ts`
Expected: PASS — 4 tests. **El snapshot NO debe reescribirse.** Si vitest reporta
snapshots obsoletos o actualizados, el camino sin grupos cambió de comportamiento
y la tarea está mal: revisar antes de continuar.

- [ ] **Step 5: Suite completa de fuerza y Plan Builder**

Run: `npx vitest run src/services/training src/services/planBuilder src/services/ai`
Expected: PASS — sin regresiones.

- [ ] **Step 6: Dejar listo para commit**

```bash
git add src/services/training/strengthSessionStructure.ts \
        src/services/training/__tests__/supersetSortParity.test.ts \
        src/services/training/__tests__/__snapshots__/supersetSortParity.test.ts.snap
git commit -m "feat(strength): order strength sessions by superset units"
```

> **Gate de despliegue:** las Entregas 1 y 2 se publican en el mismo bundle. No
> desplegar después de la Task 4 sin la Task 6: los serializers ya aceptarían
> grupos que el sort todavía partiría.

---

# ENTREGA 3 — Editor y render

## Task 7: Render de grupos en `ExerciseChecklist`

**Files:**
- Modify: `src/components/session/ExerciseChecklist.tsx`
- Test: `src/components/session/__tests__/ExerciseChecklistSupersets.test.tsx`

**Interfaces:**
- Consumes: `resolveSupersetLayout`, `describeSupersetSegment` (Task 2).
- Produces: nada que consuman tareas posteriores.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/components/session/__tests__/ExerciseChecklistSupersets.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import ExerciseChecklist from '../ExerciseChecklist'
import type { Exercise } from '../../../types'

afterEach(cleanup)

vi.mock('../../../store/useTrainingStore', () => ({
  useTrainingStore: (selector: (state: { toggleExercise: () => void }) => unknown) =>
    selector({ toggleExercise: () => undefined }),
}))

const ex = (id: string, name: string, supersetGroup?: string): Exercise => ({
  id,
  name,
  sets: 4,
  reps: 8,
  completed: false,
  ...(supersetGroup ? { supersetGroup } : {}),
})

describe('ExerciseChecklist con superseries', () => {
  it('muestra el encabezado del grupo con letra, tipo y rondas', () => {
    render(
      <ExerciseChecklist
        sessionId="s1"
        sessionType="strength"
        exercises={[ex('1', 'Clean', 'g1'), ex('2', 'Dominadas', 'g1')]}
      />,
    )

    expect(screen.getByText(/A · Superserie × 4 rondas/)).not.toBeNull()
  })

  it('deriva Triserie para tres miembros', () => {
    render(
      <ExerciseChecklist
        sessionId="s1"
        sessionType="strength"
        exercises={[ex('1', 'Clean', 'g1'), ex('2', 'Dominadas', 'g1'), ex('3', 'Salto al cajon', 'g1')]}
      />,
    )

    expect(screen.getByText(/A · Triserie × 4 rondas/)).not.toBeNull()
  })

  it('no muestra encabezado para ejercicios sueltos', () => {
    render(
      <ExerciseChecklist sessionId="s1" sessionType="strength" exercises={[ex('1', 'Clean')]} />,
    )

    expect(screen.queryByText(/Superserie/)).toBeNull()
  })

  it('no parte un grupo que cruza bloques visuales', () => {
    render(
      <ExerciseChecklist
        sessionId="s1"
        sessionType="strength"
        exercises={[
          ex('1', 'Plancha frontal', 'g1'),          // bloque visual: core
          ex('2', 'Peso muerto con trap bar', 'g1'), // bloque visual: strength
        ]}
      />,
    )

    // Un solo encabezado de grupo: el segmento entero vive en el bloque de su
    // lider (core), no se reparte en dos secciones.
    expect(screen.getAllByText(/· Superserie ×/)).toHaveLength(1)
    expect(screen.getByText('Peso muerto con trap bar')).not.toBeNull()
  })

  it('no repite la palabra reps en un target de tiempo', () => {
    render(
      <ExerciseChecklist
        sessionId="s1"
        sessionType="strength"
        exercises={[
          { id: '1', name: 'Plancha frontal', sets: 4, reps: '30s', completed: false, supersetGroup: 'g1' },
          ex('2', 'Pallof press', 'g1'),
        ]}
      />,
    )

    expect(screen.getByText('30s')).not.toBeNull()
    expect(screen.queryByText('30s reps')).toBeNull()
  })

  it('mantiene un check por ejercicio dentro del grupo', () => {
    render(
      <ExerciseChecklist
        sessionId="s1"
        sessionType="strength"
        exercises={[ex('1', 'Clean', 'g1'), ex('2', 'Dominadas', 'g1')]}
      />,
    )

    expect(screen.getByText('Clean')).not.toBeNull()
    expect(screen.getByText('Dominadas')).not.toBeNull()
  })
})
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `npx vitest run src/components/session/__tests__/ExerciseChecklistSupersets.test.tsx`
Expected: FAIL — no existe el encabezado del grupo.

- [ ] **Step 3: Reescribir el agrupado del componente**

En `ExerciseChecklist.tsx`, reemplazar `groupStrengthExercises` por una versión
que respete el pipeline **lista plana → layout → segmentos → bloque del líder**:

```tsx
interface RenderSection {
  block: DisplayBlock
  segments: SupersetSegment<Exercise>[]
}

function groupStrengthExercises(exercises: Exercise[]): RenderSection[] {
  const segments = resolveSupersetLayout(exercises)
  const byBlock = new Map<DisplayBlock, SupersetSegment<Exercise>[]>()

  for (const segment of segments) {
    // El segmento entero va al bloque de su LIDER: nunca se parte.
    const block = toDisplayBlock(resolveStrengthExerciseBlock(segment.members[0]!))
    byBlock.set(block, [...(byBlock.get(block) ?? []), segment])
  }

  return BLOCK_ORDER
    .map((block) => ({ block, segments: byBlock.get(block) ?? [] }))
    .filter((section) => section.segments.length > 0)
}
```

En el render, iterar segmentos y numerar las letras **globalmente** sobre el
orden final:

```tsx
export default function ExerciseChecklist({ sessionId, exercises, sessionType }: ExerciseChecklistProps) {
  const toggleExercise = useTrainingStore(s => s.toggleExercise)
  const sections = sessionType === 'strength'
    ? groupStrengthExercises(exercises)
    : [{ block: undefined, segments: [{ groupId: undefined, members: exercises }] }]

  let groupLetterIndex = 0

  return (
    <div className="mt-3 space-y-3">
      {sections.map((section) => (
        <div key={section.block ?? 'flat'} className={section.block ? `rounded-lg border p-2 ${BLOCK_TONE[section.block]}` : 'space-y-3'}>
          {section.block && (
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wider">{BLOCK_LABEL[section.block]}</p>
          )}
          <div className="space-y-3">
            {section.segments.map((segment) => {
              const letter = segment.groupId ? String.fromCharCode(65 + groupLetterIndex++) : undefined
              return (
                <div key={segment.groupId ?? segment.members[0]!.id} className={segment.groupId ? 'rounded-lg border border-surface-border/60 p-2 space-y-2' : 'space-y-3'}>
                  {letter && (
                    <p className="text-[10px] font-medium uppercase tracking-wider text-ink-muted">
                      {`${letter} · ${describeSupersetSegment(segment.members.length)} × ${segment.members[0]!.sets} rondas`}
                    </p>
                  )}
                  {segment.members.map(ex => (
                    <ExerciseRow
                      key={ex.id}
                      exercise={ex}
                      grouped={segment.groupId != null}
                      onToggle={() => toggleExercise(sessionId, ex.id)}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
```

En `ExerciseRow`, aceptar `grouped` y omitir las series cuando el ejercicio está
en un grupo (las rondas ya viven en el encabezado):

```tsx
function ExerciseRow({ exercise: ex, grouped, onToggle }: { exercise: Exercise; grouped?: boolean; onToggle: () => void }) {
```

y dentro, cambiar la celda de target por:

```tsx
        <div className="text-xs text-ink-muted flex-shrink-0">
          {grouped ? formatGroupedTargetSet(ex) : formatTargetSet(ex)}
        </div>
```

Agregar el formateador nuevo, sin tocar `formatTargetSet`:

```tsx
function formatGroupedTargetSet(ex: Exercise): string {
  // Un target de tiempo ya se lee solo ("30s"); anexarle "reps" produce
  // "30s reps". Solo los targets numericos llevan la unidad.
  const base = typeof ex.reps === 'number' ? `${ex.reps} reps` : `${ex.reps}`
  if (ex.weight != null) {
    const pct = ex.targetPercent1RM != null ? ` (${Math.round(ex.targetPercent1RM)}% 1RM)` : ''
    return `${base} · ${ex.weight}kg${pct}`
  }
  if (ex.targetRpe != null) return `${base} · RPE ${ex.targetRpe}`
  return base
}
```

Agregar los imports:

```tsx
import { describeSupersetSegment, resolveSupersetLayout, type SupersetSegment } from '../../services/training/supersetGroups'
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/components/session/__tests__/ExerciseChecklistSupersets.test.tsx`
Expected: PASS — 6 tests.

Run: `npx vitest run src/components/session`
Expected: PASS — sin regresiones en `SessionCard.test.tsx` ni `SessionForm.test.tsx`.

- [ ] **Step 5: Dejar listo para commit**

```bash
git add src/components/session/ExerciseChecklist.tsx \
        src/components/session/__tests__/ExerciseChecklistSupersets.test.tsx
git commit -m "feat(strength): render superset groups in exercise checklist"
```

---

## Task 8: Resumen de grupos en `SessionCard`

**Files:**
- Modify: `src/components/session/SessionCard.tsx`
- Test: `src/components/session/SessionCard.test.tsx` (ampliar)

**Interfaces:**
- Consumes: `resolveSupersetLayout` (Task 2).
- Produces: nada.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `src/components/session/SessionCard.test.tsx`:

```tsx
describe('SessionCard superseries', () => {
  it('resume la cantidad de grupos de una sesion de fuerza', () => {
    render(
      <SessionCard
        session={makeSession({
          type: 'strength',
          exercises: [
            { id: '1', name: 'Clean', sets: 4, reps: 3, completed: false, supersetGroup: 'g1' },
            { id: '2', name: 'Dominadas', sets: 4, reps: 8, completed: false, supersetGroup: 'g1' },
            { id: '3', name: 'Plancha frontal', sets: 3, reps: '30s', completed: false },
          ],
        })}
      />,
    )

    expect(screen.getByText(/3 ejercicios · 1 grupo/)).not.toBeNull()
  })
})
```

Usa el helper `makeSession` que el archivo ya define (`SessionCard.test.tsx:23`)
y el mock de `useTrainingStore` que ya está montado arriba. No agregar helpers
nuevos ni un segundo mock.

- [ ] **Step 2: Correr y confirmar que falla**

Run: `npx vitest run src/components/session/SessionCard.test.tsx`
Expected: FAIL — el resumen actual no menciona grupos.

- [ ] **Step 3: Implementar el resumen**

**`SessionCard` hoy no muestra ningún conteo de ejercicios**: sólo usa
`session.exercises.length > 0` como condición (`SessionCard.tsx:80-83`). El
resumen es superficie nueva, no la edición de una existente.

Agregar el helper a nivel de módulo:

```tsx
function summarizeExercises(exercises: Exercise[]): string {
  const groupCount = resolveSupersetLayout(exercises).filter((segment) => segment.groupId != null).length
  const base = `${exercises.length} ejercicios`
  if (groupCount === 0) return base
  return `${base} · ${groupCount} ${groupCount === 1 ? 'grupo' : 'grupos'}`
}
```

«Grupos» y no «superseries», porque el conteo puede incluir superseries,
triseries y circuitos.

Y **renderizarlo**. En el `<div>` de metadatos de la **cabecera colapsada** —el
mismo que ya muestra duración y RPE— agregar, después de esos metadatos:

```tsx
      {hasExercises && (
        <span className="text-xs text-ink-muted">
          {summarizeExercises(session.exercises!)}
        </span>
      )}
```

Debe ir en la cabecera y **no** dentro del panel expandido: el objetivo es ver la
forma de la sesión sin abrirla. `hasExercises` ya está calculado en `:80-83`.

Agregar el import:

```tsx
import { resolveSupersetLayout } from '../../services/training/supersetGroups'
```

- [ ] **Step 4: Correr y confirmar que pasa**

Run: `npx vitest run src/components/session/SessionCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Dejar listo para commit**

```bash
git add src/components/session/SessionCard.tsx src/components/session/SessionCard.test.tsx
git commit -m "feat(strength): summarize superset groups in session card"
```

---

## Task 9: Editor de grupos en `SessionForm`

**Files:**
- Modify: `src/components/session/SessionForm.tsx:37-52, 137-150, 200-232, 262-285, 473-512`
- Test: `src/components/session/__tests__/SessionFormSupersets.test.tsx`

**Interfaces:**
- Consumes: `normalizeSupersetGroups` (Task 1).
- Produces: nada.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/components/session/__tests__/SessionFormSupersets.test.tsx`:

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import SessionForm from '../SessionForm'
import type { CoachSessionDraft } from '../../../services/athlete/coachSessionSerializer'

afterEach(cleanup)

const initialValues: CoachSessionDraft = {
  date: '2026-08-10',
  timeBlock: 'AM',
  type: 'strength',
  title: 'Fuerza',
  durationMin: 60,
  exercises: [
    { id: 'a', name: 'Clean', sets: 5, reps: '3' },
    { id: 'b', name: 'Dominadas', sets: 3, reps: '8' },
    { id: 'c', name: 'Plancha frontal', sets: 3, reps: '30s' },
  ],
}

/** `SessionFormProps` exige defaultSport, heading y submitLabel (SessionForm.tsx:24-35). */
const renderForm = (onSubmit = vi.fn()) => render(
  <SessionForm
    initialValues={initialValues}
    defaultSport="strength"
    heading="Editar sesion"
    submitLabel="Guardar"
    onSubmit={onSubmit}
    onCancel={vi.fn()}
  />,
)

describe('SessionForm — grupos', () => {
  it('agrupar con el anterior propaga los sets del lider', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByLabelText('Agrupar ejercicio 2 con el anterior'))

    expect(screen.getByLabelText('Series 2')).toHaveValue(5)
    expect(screen.getByLabelText('Series 2')).toHaveAttribute('readonly')
  })

  it('editar los sets del lider actualiza a sus miembros', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByLabelText('Agrupar ejercicio 2 con el anterior'))
    await user.clear(screen.getByLabelText('Series 1'))
    await user.type(screen.getByLabelText('Series 1'), '6')

    expect(screen.getByLabelText('Series 2')).toHaveValue(6)
  })

  it('desagrupar conserva el valor y lo vuelve editable', async () => {
    const user = userEvent.setup()
    renderForm()

    await user.click(screen.getByLabelText('Agrupar ejercicio 2 con el anterior'))
    await user.click(screen.getByLabelText('Agrupar ejercicio 2 con el anterior'))

    expect(screen.getByLabelText('Series 2')).toHaveValue(5)
    expect(screen.getByLabelText('Series 2')).not.toHaveAttribute('readonly')
  })

  it('cortar un grupo de tres asigna un id nuevo al segmento derecho', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm(onSubmit)

    await user.click(screen.getByLabelText('Agrupar ejercicio 2 con el anterior'))
    await user.click(screen.getByLabelText('Agrupar ejercicio 3 con el anterior'))
    await user.click(screen.getByLabelText('Agrupar ejercicio 2 con el anterior'))
    await user.click(screen.getByRole('button', { name: /guardar/i }))

    const saved = onSubmit.mock.calls[0]![0].exercises
    // El corte deja [Clean] solo y [Dominadas, Plancha] como grupo nuevo.
    expect(saved[0].supersetGroup).toBeUndefined()
    expect(saved[1].supersetGroup).toBeDefined()
    expect(saved[1].supersetGroup).toBe(saved[2].supersetGroup)
  })

  it('mover un lider arrastra su grupo completo', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    renderForm(onSubmit)

    await user.click(screen.getByLabelText('Agrupar ejercicio 2 con el anterior'))
    await user.click(screen.getByLabelText('Bajar ejercicio 1'))
    await user.click(screen.getByRole('button', { name: /guardar/i }))

    const saved = onSubmit.mock.calls[0]![0].exercises
    expect(saved.map((e: { name: string }) => e.name)).toEqual(['Plancha frontal', 'Clean', 'Dominadas'])
  })
})
```

- [ ] **Step 2: Correr y confirmar que fallan**

Run: `npx vitest run src/components/session/__tests__/SessionFormSupersets.test.tsx`
Expected: FAIL — no existen los controles.

- [ ] **Step 3: Extender `ExerciseDraft` y el estado inicial**

En `SessionForm.tsx:37-52`, agregar al `interface ExerciseDraft`:

```ts
  supersetGroup?: string
```

En el `useState` inicial (`:137-150`), mapear el campo:

```ts
      supersetGroup: exercise.supersetGroup,
```

- [ ] **Step 4: Implementar toggle, flechas y propagación**

Agregar estos helpers dentro del componente:

```ts
  const groupBoundaryToggle = (index: number) => {
    setExercises((current) => {
      if (index === 0) return current
      const previous = current[index - 1]!
      const target = current[index]!
      const joined = target.supersetGroup != null && target.supersetGroup === previous.supersetGroup

      if (!joined) {
        // UNIR: se fusionan los segmentos completos y prevalece el id IZQUIERDO.
        const leftId = previous.supersetGroup ?? uuid()
        const rightId = target.supersetGroup
        const leaderSets = current[leaderIndexOf(current, index - 1)]!.sets
        return current.map((exercise, i) => {
          if (i === index - 1 || exercise.supersetGroup === previous.supersetGroup && previous.supersetGroup != null) {
            return { ...exercise, supersetGroup: leftId, sets: leaderSets }
          }
          if (i === index || (rightId != null && exercise.supersetGroup === rightId)) {
            return { ...exercise, supersetGroup: leftId, sets: leaderSets }
          }
          return exercise
        })
      }

      // CORTAR: el segmento derecho recibe un ID NUEVO si conserva >= 2 miembros.
      // No puede quedarse con el mismo id: el normalizador lo disolveria como
      // corrupcion (id repetido en segmentos separados).
      const groupId = target.supersetGroup!
      const rightMembers = current.filter((e, i) => i >= index && e.supersetGroup === groupId)
      const rightId = rightMembers.length >= 2 ? uuid() : undefined
      const leftMembers = current.filter((e, i) => i < index && e.supersetGroup === groupId)
      const leftId = leftMembers.length >= 2 ? groupId : undefined

      return current.map((exercise, i) => {
        if (exercise.supersetGroup !== groupId) return exercise
        return { ...exercise, supersetGroup: i < index ? leftId : rightId }
      })
    })
  }

  const moveExercise = (index: number, direction: -1 | 1) => {
    setExercises((current) => reorderSupersetUnits(current, index, direction))
  }
```

Y estos helpers a nivel de módulo:

```ts
function leaderIndexOf(exercises: ExerciseDraft[], index: number): number {
  const groupId = exercises[index]?.supersetGroup
  if (groupId == null) return index
  let cursor = index
  while (cursor > 0 && exercises[cursor - 1]!.supersetGroup === groupId) cursor -= 1
  return cursor
}

function unitBoundsOf(exercises: ExerciseDraft[], index: number): { start: number; end: number } {
  const groupId = exercises[index]?.supersetGroup
  if (groupId == null) return { start: index, end: index }
  let start = index
  let end = index
  while (start > 0 && exercises[start - 1]!.supersetGroup === groupId) start -= 1
  while (end < exercises.length - 1 && exercises[end + 1]!.supersetGroup === groupId) end += 1
  return { start, end }
}

/**
 * Un lider o un ejercicio suelto mueve la UNIDAD completa. Un seguidor solo se
 * mueve DENTRO de su grupo y no atraviesa sus limites: para volverlo lider, se
 * lo sube hasta la primera posicion del grupo.
 */
function reorderSupersetUnits(exercises: ExerciseDraft[], index: number, direction: -1 | 1): ExerciseDraft[] {
  const { start, end } = unitBoundsOf(exercises, index)
  const isLeader = index === start

  if (!isLeader || (exercises[index]!.supersetGroup != null && index !== start)) {
    const target = index + direction
    if (target < start || target > end) return exercises
    const next = [...exercises]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    return next
  }

  if (direction === -1) {
    if (start === 0) return exercises
    const previous = unitBoundsOf(exercises, start - 1)
    const unit = exercises.slice(start, end + 1)
    const before = exercises.slice(previous.start, start)
    return [
      ...exercises.slice(0, previous.start),
      ...unit,
      ...before,
      ...exercises.slice(end + 1),
    ]
  }

  if (end === exercises.length - 1) return exercises
  const next = unitBoundsOf(exercises, end + 1)
  const unit = exercises.slice(start, end + 1)
  const after = exercises.slice(end + 1, next.end + 1)
  return [
    ...exercises.slice(0, start),
    ...after,
    ...unit,
    ...exercises.slice(next.end + 1),
  ]
}
```

En `updateExercise` (`:200-211`), propagar `sets` del líder a sus miembros:

```ts
      if (field === 'sets') {
        const groupId = exercise.supersetGroup
        const leaderIndex = leaderIndexOf(current, current.indexOf(exercise))
        if (groupId != null && current.indexOf(exercise) !== leaderIndex) return exercise
      }
```

Más simple y sin `indexOf`: reemplazar el cuerpo de `updateExercise` para `sets`
por un map que actualice al líder y a todo su grupo:

```ts
  const updateExercise = (id: string, field: EditableExerciseField, value: string) => {
    setExercises((current) => {
      const index = current.findIndex((exercise) => exercise.id === id)
      if (index === -1) return current
      const target = current[index]!

      if (field === 'sets') {
        const groupId = target.supersetGroup
        if (groupId != null && index !== leaderIndexOf(current, index)) return current
        return current.map((exercise) => (
          exercise.id === id || (groupId != null && exercise.supersetGroup === groupId)
            ? { ...exercise, sets: value, touched: { ...exercise.touched, sets: true } }
            : exercise
        ))
      }

      return current.map((exercise) => {
        if (exercise.id !== id) return exercise
        if (field === 'name') return { ...exercise, name: value, libraryRef: undefined }
        return { ...exercise, [field]: value, touched: { ...exercise.touched, [field]: true } }
      })
    })
  }
```

- [ ] **Step 5: Agregar los controles al render**

Dentro de la tarjeta de cada ejercicio (`:485-508`), agregar:

```tsx
                    {/* Los grupos son un concepto de FUERZA: no ofrecer los
                        controles en movilidad ni en squash. */}
                    <div className="flex items-center gap-2">
                      {type === 'strength' && index > 0 && (
                        <button
                          type="button"
                          aria-label={`Agrupar ejercicio ${index + 1} con el anterior`}
                          aria-pressed={exercise.supersetGroup != null && exercise.supersetGroup === exercises[index - 1]?.supersetGroup}
                          onClick={() => groupBoundaryToggle(index)}
                          className="text-[10px] uppercase tracking-wide text-brand-light"
                        >
                          Agrupar
                        </button>
                      )}
                      <button type="button" aria-label={`Subir ejercicio ${index + 1}`} onClick={() => moveExercise(index, -1)}><ChevronUp size={14} /></button>
                      <button type="button" aria-label={`Bajar ejercicio ${index + 1}`} onClick={() => moveExercise(index, 1)}><ChevronDown size={14} /></button>
                    </div>
```

Y marcar `sets` como solo lectura en los seguidores:

```tsx
                      <input
                        aria-label={`Series ${index + 1}`}
                        type="number"
                        value={exercise.sets}
                        readOnly={type === 'strength' && exercise.supersetGroup != null && exercise.supersetGroup === exercises[index - 1]?.supersetGroup}
                        onChange={(event) => updateExercise(exercise.id, 'sets', event.target.value)}
                        className="rounded-lg border bg-surface px-2 py-1.5"
                      />
```

Importar los íconos:

```tsx
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
```

- [ ] **Step 6: Normalizar al guardar**

En `onSubmit` (`:268-279`), envolver el resultado:

```ts
      exercises: showExercises
        ? normalizeSupersetGroups(
            exercises
              .filter((exercise) => exercise.name.trim())
              .map((exercise) => ({
                id: exercise.id,
                name: exercise.name.trim(),
                sets: Number(exercise.sets) || 3,
                reps: exercise.reps.trim() || '10',
                weight: optionalNumber(exercise.weight),
                notes: exercise.notes.trim() || undefined,
                libraryRef: exercise.libraryRef,
                supersetGroup: exercise.supersetGroup,
              })),
          )
        : undefined,
```

Importar:

```ts
import { normalizeSupersetGroups } from '../../services/training/supersetGroups'
```

El editor **no** usa `resolveSupersetLayout`: mantiene la pertenencia como estado
de borrador explícito, donde un grupo de 1 en construcción es legítimo. Normaliza
solo acá.

- [ ] **Step 7: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/components/session`
Expected: PASS — los 5 tests nuevos más `SessionForm.test.tsx` sin regresiones.

- [ ] **Step 8: Dejar listo para commit**

```bash
git add src/components/session/SessionForm.tsx \
        src/components/session/__tests__/SessionFormSupersets.test.tsx
git commit -m "feat(strength): edit superset groups in session form"
```

---

# ENTREGA 4 — Política determinista

## Task 10: Predicados y `planSupersetGroups`

**Files:**
- Create: `src/services/training/supersetPolicy.ts`
- Test: `src/services/training/__tests__/supersetPolicy.test.ts`

**Interfaces:**
- Consumes: `SupersetCandidate`, `normalizeSupersetGroups` (Task 1); `resolveSessionStrengthRoles` (Task 5).
- Produces:
  - `type SupersetPolicyMode = 'off' | 'permissive' | 'full'`
  - `interface SupersetPolicyDecision { rule: SupersetRule; outcome: SupersetOutcome; anchorIndex: number; memberIndexes: number[]; groupId?: string }`
  - `function planSupersetGroups<T extends SupersetCandidate>(exercises: readonly T[], mode: SupersetPolicyMode): { exercises: T[]; decisions: SupersetPolicyDecision[] }`
  - `function isPlyometricExercise(exercise: SupersetCandidate): boolean`
  - `function isOlympicPowerExercise(exercise: SupersetCandidate): boolean`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/services/training/__tests__/supersetPolicy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { resolveSessionStrengthRoles } from '../../planBuilder/strengthRoleContract'
import { normalizeSupersetGroups } from '../supersetGroups'
import { isOlympicPowerExercise, isPlyometricExercise, planSupersetGroups } from '../supersetPolicy'

const ex = (name: string, sets: number) => ({ name, sets })

describe('predicados', () => {
  it('reconoce power olimpico por el tag olympic_power', () => {
    expect(isOlympicPowerExercise({ name: 'Clean', sets: 4 })).toBe(true)
    expect(isOlympicPowerExercise({ name: 'Push press', sets: 4 })).toBe(false)
  })

  it('reconoce pliometricos por allowlist de ids, no por intensityType', () => {
    expect(isPlyometricExercise({ name: 'Salto al cajon', sets: 4 })).toBe(true)
    expect(isPlyometricExercise({ name: 'Sentadilla con salto', sets: 4 })).toBe(true)
    // intensityType 'power' pero NO pliometrico de baja dosis
    expect(isPlyometricExercise({ name: 'Push press', sets: 4 })).toBe(false)
    expect(isPlyometricExercise({ name: 'Sentadilla con salto y barra', sets: 4 })).toBe(false)
  })
})

describe('planSupersetGroups', () => {
  it('en off no crea grupos y no elimina los existentes', () => {
    const input = [
      { name: 'Clean', sets: 4, supersetGroup: 'g1' },
      { name: 'Dominadas', sets: 4, supersetGroup: 'g1' },
      { name: 'Plancha frontal', sets: 3 },
      { name: 'Pallof press', sets: 3 },
    ]
    const { exercises } = planSupersetGroups(input, 'off')

    expect(exercises[0]!.supersetGroup).toBe('g1')
    expect(exercises[2]!.supersetGroup).toBeUndefined()
  })

  it('en permissive arma el circuito de zona media', () => {
    const { exercises } = planSupersetGroups([
      ex('Plancha frontal', 3),
      ex('Pallof press', 3),
      ex('Peso muerto con trap bar', 4),
    ], 'permissive')

    expect(exercises[0]!.supersetGroup).toBeDefined()
    expect(exercises[0]!.supersetGroup).toBe(exercises[1]!.supersetGroup)
    expect(exercises[2]!.supersetGroup).toBeUndefined()
  })

  it('en permissive NO empareja potencia ni main_lift', () => {
    const { exercises } = planSupersetGroups([
      ex('Peso muerto con trap bar', 4),
      ex('Salto al cajon', 4),
    ], 'permissive')

    expect(exercises.every((e) => e.supersetGroup === undefined)).toBe(true)
  })

  it('descarta candidatos con sets distintos y lo registra', () => {
    const { exercises, decisions } = planSupersetGroups([
      ex('Peso muerto con trap bar', 5),
      ex('Salto al cajon', 3),
    ], 'full')

    expect(exercises.every((e) => e.supersetGroup === undefined)).toBe(true)
    expect(decisions.some((d) => d.outcome === 'sets_mismatch')).toBe(true)
  })

  it('no cambia ningun campo salvo el orden y supersetGroup', () => {
    const input = [
      { name: 'Plancha frontal', sets: 3, reps: '30s', weight: undefined },
      { name: 'Pallof press', sets: 3, reps: '10', weight: 12 },
    ]
    const { exercises } = planSupersetGroups(input as never, 'permissive')

    expect(exercises.map((e) => ({ ...e, supersetGroup: undefined })))
      .toEqual(input.map((e) => ({ ...e, supersetGroup: undefined })))
  })

  it('reaplicar la politica conserva ids y es estable', () => {
    const first = planSupersetGroups([ex('Plancha frontal', 3), ex('Pallof press', 3)], 'permissive')
    const second = planSupersetGroups(first.exercises, 'permissive')

    expect(second.exercises).toEqual(first.exercises)
  })

  it('el main_lift nunca participa como seguidor', () => {
    const { exercises } = planSupersetGroups([
      ex('Peso muerto con trap bar', 4),
      ex('Clean', 4),
      ex('Dominadas', 4),
    ], 'full')

    const trapIndex = exercises.findIndex((e) => e.name === 'Peso muerto con trap bar')
    const group = exercises[trapIndex]!.supersetGroup
    if (group != null) {
      expect(exercises.findIndex((e) => e.supersetGroup === group)).toBe(trapIndex)
    }
  })

  it('elige otro companero cuando el primero tiene sets distintos', () => {
    const { exercises } = planSupersetGroups([
      ex('Peso muerto con trap bar', 4),
      ex('Salto horizontal', 3),        // sets distintos: se descarta
      ex('Salto al cajon', 4),     // compatible: debe elegirse este
    ], 'full')

    const trapIndex = exercises.findIndex((e) => e.name === 'Peso muerto con trap bar')
    expect(exercises[trapIndex + 1]!.name).toBe('Salto al cajon')
    expect(exercises[trapIndex]!.supersetGroup).toBe(exercises[trapIndex + 1]!.supersetGroup)
  })

  it('arma el circuito de core con la cohorte de sets mas grande', () => {
    const { exercises } = planSupersetGroups([
      ex('Plancha frontal', 5),    // cohorte de 1: no debe anclar el circuito
      ex('Pallof press', 3),
      ex('Plancha lateral', 3),
      ex('Dead bug — control de tronco', 3),
    ], 'permissive')

    const grouped = exercises.filter((e) => e.supersetGroup != null)
    expect(grouped).toHaveLength(3)
    expect(grouped.every((e) => e.sets === 3)).toBe(true)
  })

  it('el olympic_pull no consume un pull que sea main_lift', () => {
    const { exercises, decisions } = planSupersetGroups([
      ex('Clean', 4),
      ex('Dominadas', 4),   // unico no-core/no-power: es el main_lift
    ], 'full')

    expect(exercises.every((e) => e.supersetGroup === undefined)).toBe(true)
    expect(decisions.some((d) => d.rule === 'olympic_pull' && d.outcome === 'no_eligible_partner')).toBe(true)
  })

  it('CASO POSITIVO olympic_pull: empareja el clean con un pull accesorio', () => {
    const { exercises, decisions } = planSupersetGroups([
      ex('Clean', 4),
      ex('Peso muerto con trap bar', 4),   // absorbe el main_lift
      ex('Dominadas', 4),                  // queda como pull ACCESORIO
    ], 'full')

    expect(decisions.some((d) => d.rule === 'olympic_pull' && d.outcome === 'grouped')).toBe(true)

    const cleanIndex = exercises.findIndex((e) => e.name === 'Clean')
    expect(exercises[cleanIndex]!.supersetGroup).toBeDefined()
    expect(exercises[cleanIndex + 1]!.name).toBe('Dominadas')
    expect(exercises[cleanIndex + 1]!.supersetGroup).toBe(exercises[cleanIndex]!.supersetGroup)
  })

  it('CASO POSITIVO push_pull: empareja accesorios de empuje y traccion', () => {
    const { exercises, decisions } = planSupersetGroups([
      ex('Peso muerto con trap bar', 4),   // main_lift
      ex('Press vertical', 3),             // push accesorio
      ex('Remo con pecho apoyado', 3),            // pull accesorio
    ], 'permissive')

    expect(decisions.some((d) => d.rule === 'push_pull' && d.outcome === 'grouped')).toBe(true)

    const pressIndex = exercises.findIndex((e) => e.name === 'Press vertical')
    expect(exercises[pressIndex + 1]!.name).toBe('Remo con pecho apoyado')
    expect(exercises[pressIndex]!.supersetGroup).toBe(exercises[pressIndex + 1]!.supersetGroup)
  })

  it('cardio y movilidad se descartan bajo la regla eligibility, no core_circuit', () => {
    const { exercises, decisions } = planSupersetGroups([
      ex('Plancha frontal', 3),
      ex('Pallof press', 3),
      ex('Bici de asalto 30/30', 1),
    ], 'permissive')

    const blocked = decisions.filter((d) => d.outcome === 'blocked_kind')
    expect(blocked.length).toBeGreaterThan(0)
    expect(blocked.every((d) => d.rule === 'eligibility')).toBe(true)
    expect(exercises.find((e) => e.name === 'Bici de asalto 30/30')!.supersetGroup).toBeUndefined()
  })
})

describe('reflow', () => {
  const CROSS_BLOCK = [
    ex('Peso muerto con trap bar', 4),
    ex('Press vertical', 4),
    ex('Remo con pecho apoyado', 4),
    ex('Salto al cajon', 4),
  ]

  it('deja a los miembros contiguos y al lider primero', () => {
    const { exercises } = planSupersetGroups(CROSS_BLOCK, 'full')

    for (const groupId of new Set(exercises.map((e) => e.supersetGroup).filter(Boolean))) {
      const indexes = exercises
        .map((e, index) => ({ e, index }))
        .filter(({ e }) => e.supersetGroup === groupId)
        .map(({ index }) => index)

      expect(indexes[indexes.length - 1]! - indexes[0]!).toBe(indexes.length - 1)
    }
  })

  it('sobrevive al normalizador: ningun grupo se disuelve', () => {
    const { exercises } = planSupersetGroups(CROSS_BLOCK, 'full')
    const groupsBefore = exercises.filter((e) => e.supersetGroup != null).length

    const renormalized = normalizeSupersetGroups(exercises)

    expect(renormalized.filter((e) => e.supersetGroup != null)).toHaveLength(groupsBefore)
  })

  it.each([
    ['core_circuit', [ex('Plancha frontal', 3), ex('Pallof press', 3), ex('Plancha lateral', 3)]],
    ['main_lift_plyo', [ex('Peso muerto con trap bar', 4), ex('Salto al cajon', 4)]],
    ['olympic_pull', [ex('Clean', 4), ex('Peso muerto con trap bar', 4), ex('Dominadas', 4)]],
    ['push_pull', [ex('Peso muerto con trap bar', 4), ex('Press vertical', 3), ex('Remo con pecho apoyado', 3)]],
  ])('es idempotente para la regla %s', (rule, fixture) => {
    const first = planSupersetGroups(fixture, 'full')
    expect(first.decisions.some((d) => d.rule === rule && d.outcome === 'grouped')).toBe(true)

    const second = planSupersetGroups(first.exercises, 'full')
    expect(second.exercises).toEqual(first.exercises)
  })

  it('PROPIEDAD: la politica nunca mueve la identidad del main_lift', () => {
    const mainLiftOf = (list: ReadonlyArray<{ name: string; supersetGroup?: string }>) => {
      const roles = resolveSessionStrengthRoles(list)
      const index = roles.indexOf('main_lift')
      return index === -1 ? undefined : list[index]!.name
    }

    const POOL = [
      ex('Plancha frontal', 3),
      ex('Pallof press', 3),
      ex('Plancha lateral', 3),
      ex('Clean', 4),
      ex('Peso muerto con trap bar', 4),
      ex('Salto al cajon', 4),
      ex('Dominadas', 4),
      ex('Press vertical', 3),
      ex('Remo con pecho apoyado', 3),
    ]

    // Multiples ordenes ALCANZABLES: rotaciones del pool. No hace falta excluir
    // construcciones imposibles, porque es la propia politica la que forma los
    // grupos y ya tiene prohibido usar al main_lift como seguidor.
    let regrouped = 0

    for (let offset = 0; offset < POOL.length; offset += 1) {
      for (const mode of ['permissive', 'full'] as const) {
        const input = [...POOL.slice(offset), ...POOL.slice(0, offset)]
        const normalized = normalizeSupersetGroups(input)
        const before = mainLiftOf(normalized)

        const { exercises, decisions } = planSupersetGroups(normalized, mode)
        if (decisions.some((d) => d.outcome === 'grouped')) regrouped += 1

        expect(mainLiftOf(exercises), `offset ${offset} / ${mode}`).toBe(before)
      }
    }

    // Sin agrupaciones reales la propiedad seria trivialmente cierta.
    expect(regrouped).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Correr y confirmar que fallan**

Run: `npx vitest run src/services/training/__tests__/supersetPolicy.test.ts`
Expected: FAIL — `Failed to resolve import "../supersetPolicy"`

- [ ] **Step 3: Implementar predicados y política**

Crear `src/services/training/supersetPolicy.ts`:

```ts
import type { ExerciseGroup } from '../../types'
import { v4 as uuid } from '../../utils/uuid'
import { resolveSessionStrengthRoles } from '../planBuilder/strengthRoleContract'
import { resolveStrengthExercise } from './exerciseLibrary'
import { resolveStrengthExerciseBlock } from './strengthSessionStructure'
import { normalizeSupersetGroups, type SupersetCandidate } from './supersetGroups'

export type SupersetPolicyMode = 'off' | 'permissive' | 'full'

export type SupersetRule = 'eligibility' | 'core_circuit' | 'push_pull' | 'main_lift_plyo' | 'olympic_pull'

export type SupersetOutcome =
  | 'grouped'
  | 'sets_mismatch'
  | 'no_eligible_partner'
  | 'blocked_kind'

/**
 * `anchorIndex` y `memberIndexes` son indices en la lista NORMALIZADA DE
 * ENTRADA (pre-reflow), no en la salida. Un consumidor que quiera nombres debe
 * indexar el arreglo que le paso a la funcion, no el que recibio de vuelta.
 */
export interface SupersetPolicyDecision {
  rule: SupersetRule
  outcome: SupersetOutcome
  anchorIndex: number
  memberIndexes: number[]
  groupId?: string
}

interface SupersetUnit {
  anchorIndex: number
  memberIndexes: number[]
  groupId?: string
}

/**
 * Pliometricos de baja dosis, por ALLOWLIST EXPLICITA de ids.
 *
 * `intensityType === 'power'` NO sirve como predicado: abarca desde `clean`
 * hasta `push_press`, `kettlebell_swing`, los lanzamientos de balon medicinal y
 * `assault_bike_30_30`. El catalogo no tiene un tag de pliometria, asi que se
 * enumeran los ids, igual que `squashMatchRole.ts` con los drills competitivos.
 *
 * `barbell_jump_squat` queda FUERA a proposito pese a ser un salto: es cargado
 * (`equipment: ['barbell']`, `riskLevel: 'high'`, `fatigueCost: 'high'`).
 *
 * Gate append-only, igual que los 77 ids de la §19 del roadmap: agregar un id
 * es deliberado y visible en el diff.
 */
const PLYOMETRIC_EXERCISE_IDS: ReadonlySet<string> = new Set([
  'box_jump',
  'jump_squat',
  'broad_jump',
  'single_leg_broad_jump',
  'drop_jump',
  'depth_jump',
  'half_kneeling_lateral_jump',
  'lateral_skater_jumps',
  'alternating_step_up_jump',
  'pogo_jumps',
])

export function isPlyometricExercise(exercise: SupersetCandidate): boolean {
  const definition = resolveStrengthExercise(exercise)?.definition
  return definition != null && PLYOMETRIC_EXERCISE_IDS.has(definition.id)
}

export function isOlympicPowerExercise(exercise: SupersetCandidate): boolean {
  const definition = resolveStrengthExercise(exercise)?.definition
  return definition?.tags.includes('olympic_power') === true
}

function isNeverGroupable(block: ExerciseGroup): boolean {
  return block === 'cardio' || block === 'mobility'
}

/**
 * Nucleo unico. Los caminos productivos descartan `decisions`; la auditoria del
 * corpus consume el MISMO resultado, de modo que audita la politica real.
 *
 * Los grupos existentes son AUTORITATIVOS: solo se consideran candidatos los
 * ejercicios sin grupo. `off` significa «no crear grupos», no «eliminar los
 * existentes».
 */
export function planSupersetGroups<T extends SupersetCandidate>(
  exercises: readonly T[],
  mode: SupersetPolicyMode,
): { exercises: T[]; decisions: SupersetPolicyDecision[] } {
  const normalized = normalizeSupersetGroups(exercises)
  if (mode === 'off') return { exercises: normalized, decisions: [] }

  const roles = resolveSessionStrengthRoles(normalized)
  // `SupersetCandidate.group` es OPCIONAL y en la practica suele venir ausente
  // (los candidatos llegan por nombre + libraryRef). Resolver el bloque una vez
  // acá es lo que hace que `push_pull` y `olympic_pull` puedan dispararse.
  const blocks = normalized.map((exercise) => resolveStrengthExerciseBlock(exercise))
  const decisions: SupersetPolicyDecision[] = []
  const reserved = new Set<number>()

  // Unidades preexistentes: los grupos ya presentes son AUTORITATIVOS y entran
  // al reflow tal cual, sin reconstruirse.
  const units: SupersetUnit[] = []
  let cursor = 0
  while (cursor < normalized.length) {
    const groupId = normalized[cursor]!.supersetGroup
    if (groupId == null) {
      units.push({ anchorIndex: cursor, memberIndexes: [cursor] })
      cursor += 1
      continue
    }
    let end = cursor
    while (end + 1 < normalized.length && normalized[end + 1]!.supersetGroup === groupId) end += 1
    const memberIndexes = Array.from({ length: end - cursor + 1 }, (_, offset) => cursor + offset)
    for (const index of memberIndexes) reserved.add(index)
    units.push({ anchorIndex: cursor, memberIndexes, groupId })
    cursor = end + 1
  }

  // Elegibilidad: cardio, movilidad y footwork nunca se agrupan. Se registra
  // bajo la regla `eligibility` y NO bajo `core_circuit`, que no fue quien los
  // descarto: atribuirselo produciria un diagnostico falso en la auditoria.
  for (const index of normalized.keys()) {
    if (reserved.has(index)) continue
    if (isNeverGroupable(blocks[index]!)) {
      reserved.add(index)
      decisions.push({ rule: 'eligibility', outcome: 'blocked_kind', anchorIndex: index, memberIndexes: [index] })
    }
  }

  const unitOf = (index: number) => units.find((unit) => unit.memberIndexes.includes(index))!

  const freeIndexes = (predicate: (exercise: T, index: number) => boolean): number[] =>
    normalized
      .map((exercise, index) => ({ exercise, index }))
      .filter(({ exercise, index }) => !reserved.has(index) && predicate(exercise, index))
      .map(({ index }) => index)

  /**
   * Busca compañero entre TODOS los candidatos con `sets` compatibles, no solo
   * el primero: abandonar ante el primer desajuste descartaria pares validos.
   */
  const pairWith = (rule: SupersetRule, anchorIndex: number, candidates: number[]) => {
    if (candidates.length === 0) {
      decisions.push({ rule, outcome: 'no_eligible_partner', anchorIndex, memberIndexes: [anchorIndex] })
      return
    }
    const anchorSets = normalized[anchorIndex]!.sets
    const partner = candidates.find((index) => normalized[index]!.sets === anchorSets)
    if (partner == null) {
      decisions.push({ rule, outcome: 'sets_mismatch', anchorIndex, memberIndexes: [anchorIndex, ...candidates] })
      return
    }
    // El ancla es SIEMPRE el primer miembro; el compañero se retira de su
    // posicion original y se reubica detras del ancla en el reflow.
    const anchorUnit = unitOf(anchorIndex)
    anchorUnit.memberIndexes.push(partner)
    anchorUnit.groupId = uuid()
    const partnerUnit = unitOf(partner)
    units.splice(units.indexOf(partnerUnit), 1)
    reserved.add(anchorIndex)
    reserved.add(partner)
    decisions.push({ rule, outcome: 'grouped', anchorIndex, memberIndexes: [anchorIndex, partner], groupId: anchorUnit.groupId })
  }

  // Prioridad fija. Cada ejercicio se RESERVA al asignarlo y no vuelve al pool,
  // asi que `olympic_pull` no puede consumir el salto de `main_lift_plyo`.

  // 1. Circuito de zona media. Se agrupa la COHORTE DE SETS MAS GRANDE, no la
  // del primer ejercicio: anclarse al primero descartaria un circuito valido
  // solo porque ese ejercicio no tiene pareja de series.
  const trunk = freeIndexes((_, index) => roles[index] === 'trunk')
  if (trunk.length >= 2) {
    const cohorts = new Map<number, number[]>()
    for (const index of trunk) {
      cohorts.set(normalized[index]!.sets, [...(cohorts.get(normalized[index]!.sets) ?? []), index])
    }
    const best = [...cohorts.values()].sort((a, b) => b.length - a.length || a[0]! - b[0]!)[0]!
    if (best.length >= 2) {
      const anchorIndex = best[0]!
      const anchorUnit = unitOf(anchorIndex)
      anchorUnit.groupId = uuid()
      for (const index of best.slice(1)) {
        anchorUnit.memberIndexes.push(index)
        units.splice(units.indexOf(unitOf(index)), 1)
      }
      for (const index of best) reserved.add(index)
      decisions.push({ rule: 'core_circuit', outcome: 'grouped', anchorIndex, memberIndexes: best, groupId: anchorUnit.groupId })
    } else {
      decisions.push({ rule: 'core_circuit', outcome: 'sets_mismatch', anchorIndex: trunk[0]!, memberIndexes: trunk })
    }
  }

  if (mode === 'full') {
    // 2. main_lift + pliometrico. El main_lift es SIEMPRE el ancla.
    const mainLift = freeIndexes((_, index) => roles[index] === 'main_lift')[0]
    if (mainLift != null) {
      pairWith('main_lift_plyo', mainLift, freeIndexes((exercise, index) => (
        index !== mainLift && isPlyometricExercise(exercise)
      )))
    }

    // 3. Power olimpico + pull ACCESORIO. Exigir el rol impide consumir un pull
    // que sea main_lift y mover la exencion de rotacion.
    const olympic = freeIndexes((exercise) => isOlympicPowerExercise(exercise))[0]
    if (olympic != null) {
      pairWith('olympic_pull', olympic, freeIndexes((_, index) => (
        index !== olympic && blocks[index] === 'pull' && roles[index] === 'accessory'
      )))
    }
  }

  // 4. Push accesorio + pull accesorio.
  const push = freeIndexes((_, index) => blocks[index] === 'push' && roles[index] === 'accessory')[0]
  if (push != null) {
    pairWith('push_pull', push, freeIndexes((_, index) => (
      index !== push && blocks[index] === 'pull' && roles[index] === 'accessory'
    )))
  }

  // REFLOW. Las unidades conservan su orden relativo por `anchorIndex`, y cada
  // seguidor se emite inmediatamente despues de su ancla. Eso garantiza
  // contiguidad y lider-primero, y preserva el main_lift: los anclajes no se
  // reordenan entre si y un seguidor nunca es elegible.
  const ordered = [...units].sort((a, b) => a.anchorIndex - b.anchorIndex)

  const result = ordered.flatMap((unit) => unit.memberIndexes.map((index) => {
    const exercise = normalized[index]!
    if (unit.groupId == null) {
      if (exercise.supersetGroup == null) return exercise
      const next = { ...exercise } as T
      delete (next as { supersetGroup?: string }).supersetGroup
      return next
    }
    if (exercise.supersetGroup === unit.groupId) return exercise
    return { ...exercise, supersetGroup: unit.groupId } as T
  }))

  return { exercises: result, decisions }
}
```

> **`sets` iguales es obligatorio.** Sin esa restricción la regla de ancla del
> normalizador convertiría a la política en un cambio de prescripción, y dejaría
> de ser cierto que solo cambia el orden y `supersetGroup`.

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `npx vitest run src/services/training/__tests__/supersetPolicy.test.ts`
Expected: PASS — todos los tests del archivo, incluidos los casos positivos de las cuatro reglas, los cuatro de reflow y la propiedad del `main_lift`.

- [ ] **Step 5: Dejar listo para commit**

```bash
git add src/services/training/supersetPolicy.ts \
        src/services/training/__tests__/supersetPolicy.test.ts
git commit -m "feat(strength): add deterministic superset grouping policy"
```

---

## Task 11: `shouldApplySupersetPolicy` — tabla total

**Files:**
- Modify: `src/services/training/supersetPolicy.ts`
- Test: `src/services/training/__tests__/supersetPolicyMode.test.ts`

**Interfaces:**
- Consumes: `SupersetPolicyMode` (Task 10).
- Produces: `function shouldApplySupersetPolicy(context: SupersetPolicyContext): SupersetPolicyMode`

- [ ] **Step 1: Escribir el test exhaustivo que falla**

Crear `src/services/training/__tests__/supersetPolicyMode.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { shouldApplySupersetPolicy } from '../supersetPolicy'
import type { StrengthPhase, StrengthSportProfile } from '../strengthSelector'

const PHASES: StrengthPhase[] = ['base', 'build', 'peak', 'taper', 'transition', 'race']
const PROFILES: StrengthSportProfile[] = ['strength_primary', 'hybrid', 'sport_support']
const DURATIONS = [30, 44, 45, 54, 55, 60, 90]

describe('shouldApplySupersetPolicy', () => {
  it('R0 es off absoluto: contexto incompleto no sube ni con preferencia', () => {
    expect(shouldApplySupersetPolicy({ prefersSupersets: true })).toBe('off')
    expect(shouldApplySupersetPolicy({ phase: 'base', prefersSupersets: true })).toBe('off')
    expect(shouldApplySupersetPolicy({ phase: 'base', sportProfile: 'hybrid', prefersSupersets: true })).toBe('off')
    expect(shouldApplySupersetPolicy({
      phase: 'nope' as StrengthPhase, sportProfile: 'hybrid', sessionDurationMin: 60, prefersSupersets: true,
    })).toBe('off')
  })

  it('peak tiene techo permissive incluso con preferencia', () => {
    for (const profile of PROFILES) {
      expect(shouldApplySupersetPolicy({
        phase: 'peak', sportProfile: profile, sessionDurationMin: 90, prefersSupersets: true,
      })).toBe('permissive')
    }
  })

  it('taper, race y transition parten de off y llegan a permissive con preferencia', () => {
    for (const phase of ['taper', 'race', 'transition'] as StrengthPhase[]) {
      expect(shouldApplySupersetPolicy({ phase, sportProfile: 'hybrid', sessionDurationMin: 60 })).toBe('off')
      expect(shouldApplySupersetPolicy({
        phase, sportProfile: 'hybrid', sessionDurationMin: 60, prefersSupersets: true,
      })).toBe('permissive')
    }
  })

  it('full automatico solo para strength_primary en base o build desde 55 min', () => {
    expect(shouldApplySupersetPolicy({ phase: 'base', sportProfile: 'strength_primary', sessionDurationMin: 55 })).toBe('full')
    expect(shouldApplySupersetPolicy({ phase: 'build', sportProfile: 'strength_primary', sessionDurationMin: 54 })).toBe('permissive')
    expect(shouldApplySupersetPolicy({ phase: 'base', sportProfile: 'hybrid', sessionDurationMin: 90 })).toBe('permissive')
  })

  it('un hibrido llega a full via preferencia', () => {
    expect(shouldApplySupersetPolicy({
      phase: 'base', sportProfile: 'hybrid', sessionDurationMin: 60, prefersSupersets: true,
    })).toBe('full')
  })

  it('menos de 45 min es off', () => {
    expect(shouldApplySupersetPolicy({ phase: 'base', sportProfile: 'strength_primary', sessionDurationMin: 44 })).toBe('off')
  })

  it('coincide con un oracle independiente en TODO el producto cartesiano', () => {
    // Oracle escrito desde la tabla del spec, no desde la implementacion.
    // Si ambos derivaran del mismo codigo, el test no probaria nada.
    const RANK = { off: 0, permissive: 1, full: 2 } as const
    const CAP: Record<StrengthPhase, 'off' | 'permissive' | 'full'> = {
      base: 'full', build: 'full', peak: 'permissive',
      taper: 'permissive', race: 'permissive', transition: 'permissive',
    }

    const oracle = (
      phase: StrengthPhase,
      profile: StrengthSportProfile,
      duration: number,
      prefers: boolean,
    ): 'off' | 'permissive' | 'full' => {
      let base: 'off' | 'permissive' | 'full'
      if (phase === 'taper' || phase === 'race' || phase === 'transition') base = 'off'
      else if (duration < 45) base = 'off'
      else if (profile === 'strength_primary' && (phase === 'base' || phase === 'build') && duration >= 55) base = 'full'
      else base = 'permissive'

      const requested = prefers
        ? (['off', 'permissive', 'full'] as const)[Math.min(RANK[base] + 1, 2)]!
        : base

      return RANK[requested] <= RANK[CAP[phase]] ? requested : CAP[phase]
    }

    for (const phase of PHASES) {
      for (const sportProfile of PROFILES) {
        for (const sessionDurationMin of DURATIONS) {
          for (const prefersSupersets of [false, true]) {
            expect(
              shouldApplySupersetPolicy({ phase, sportProfile, sessionDurationMin, prefersSupersets }),
              `${phase}/${sportProfile}/${sessionDurationMin}/${prefersSupersets}`,
            ).toBe(oracle(phase, sportProfile, sessionDurationMin, prefersSupersets))
          }
        }
      }
    }
  })

  it('rechaza duraciones no positivas', () => {
    expect(shouldApplySupersetPolicy({ phase: 'base', sportProfile: 'hybrid', sessionDurationMin: 0 })).toBe('off')
    expect(shouldApplySupersetPolicy({ phase: 'base', sportProfile: 'hybrid', sessionDurationMin: -60 })).toBe('off')
    expect(shouldApplySupersetPolicy({ phase: 'base', sportProfile: 'hybrid', sessionDurationMin: NaN })).toBe('off')
  })

  it('nunca salta dos niveles con la preferencia', () => {
    const RANK = { off: 0, permissive: 1, full: 2 } as const
    for (const phase of PHASES) {
      for (const sportProfile of PROFILES) {
        for (const sessionDurationMin of DURATIONS) {
          const base = shouldApplySupersetPolicy({ phase, sportProfile, sessionDurationMin })
          const boosted = shouldApplySupersetPolicy({ phase, sportProfile, sessionDurationMin, prefersSupersets: true })
          expect(RANK[boosted] - RANK[base]).toBeLessThanOrEqual(1)
          expect(RANK[boosted] - RANK[base]).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })
})
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `npx vitest run src/services/training/__tests__/supersetPolicyMode.test.ts`
Expected: FAIL — `shouldApplySupersetPolicy is not a function`

- [ ] **Step 3: Implementar la función total**

Agregar a `src/services/training/supersetPolicy.ts`:

```ts
import type { StrengthPhase, StrengthSportProfile } from './strengthSelector'

export interface SupersetPolicyContext {
  phase?: StrengthPhase
  sportProfile?: StrengthSportProfile
  sessionDurationMin?: number
  prefersSupersets?: boolean
}

const MODE_RANK: Record<SupersetPolicyMode, number> = { off: 0, permissive: 1, full: 2 }
const RANK_MODE: SupersetPolicyMode[] = ['off', 'permissive', 'full']

/**
 * Techo por fase. `peak` no puede subir a `full` ni con preferencia explicita:
 * intensidad alta no se combina con densidad alta.
 */
const PHASE_MODE_CAP: Record<StrengthPhase, SupersetPolicyMode> = {
  base: 'full',
  build: 'full',
  peak: 'permissive',
  taper: 'permissive',
  race: 'permissive',
  transition: 'permissive',
}

const VALID_PROFILES: ReadonlySet<string> = new Set<StrengthSportProfile>([
  'strength_primary',
  'hybrid',
  'sport_support',
])

function hasInvalidInput(context: SupersetPolicyContext): boolean {
  // `Object.hasOwn` y no `in`: `in` tambien acepta claves del prototipo
  // ('toString', 'constructor'), que colarian una fase invalida.
  if (context.phase == null || !Object.hasOwn(PHASE_MODE_CAP, context.phase)) return true
  if (context.sportProfile == null || !VALID_PROFILES.has(context.sportProfile)) return true
  const duration = context.sessionDurationMin
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return true
  return false
}

/** Primera regla que matchea gana. Tras R0-R3 solo queda base/build/peak >= 45. */
function resolveBaseMode(context: SupersetPolicyContext): SupersetPolicyMode {
  const phase = context.phase!
  const duration = context.sessionDurationMin!

  if (phase === 'taper' || phase === 'race') return 'off'          // R1
  if (phase === 'transition') return 'off'                          // R2
  if (duration < 45) return 'off'                                   // R3
  if (
    context.sportProfile === 'strength_primary'
    && (phase === 'base' || phase === 'build')
    && duration >= 55
  ) return 'full'                                                   // R4
  return 'permissive'                                               // R5
}

function upgradeOneLevel(mode: SupersetPolicyMode): SupersetPolicyMode {
  return RANK_MODE[Math.min(MODE_RANK[mode] + 1, MODE_RANK.full)]!
}

function minMode(a: SupersetPolicyMode, b: SupersetPolicyMode): SupersetPolicyMode {
  return MODE_RANK[a] <= MODE_RANK[b] ? a : b
}

/**
 * Funcion TOTAL. Senales: solo las tres comparables entre chat y Plan Builder.
 * `fatigueLevel`, `experienceLevel` y `recentExercises` quedan EXCLUIDAS: en el
 * chat son constantes hardcodeadas (`actionPostProcessor.ts:917`), asi que
 * usarlas divergiria los dos caminos en silencio.
 *
 * `prefersSupersets` significa «preferir superseries y subir un nivel dentro del
 * limite seguro», no «forzar full».
 */
export function shouldApplySupersetPolicy(context: SupersetPolicyContext): SupersetPolicyMode {
  if (hasInvalidInput(context)) return 'off'   // R0, off absoluto: antes del upgrade

  const baseMode = resolveBaseMode(context)
  const requestedMode = context.prefersSupersets ? upgradeOneLevel(baseMode) : baseMode

  return minMode(requestedMode, PHASE_MODE_CAP[context.phase!])
}
```

- [ ] **Step 4: Correr y confirmar que pasa**

Run: `npx vitest run src/services/training/__tests__/supersetPolicyMode.test.ts`
Expected: PASS — 9 tests, incluido el contraste completo contra el oracle.

- [ ] **Step 5: Dejar listo para commit**

```bash
git add src/services/training/supersetPolicy.ts \
        src/services/training/__tests__/supersetPolicyMode.test.ts
git commit -m "feat(strength): add total superset policy mode resolver"
```

---

## Task 12: `detectSupersetPreference`

**Files:**
- Modify: `src/services/training/supersetPolicy.ts`
- Test: `src/services/training/__tests__/supersetPreference.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `function detectSupersetPreference(intentText: string): boolean`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/services/training/__tests__/supersetPreference.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { detectSupersetPreference } from '../supersetPolicy'

describe('detectSupersetPreference', () => {
  it('reconoce las formas positivas', () => {
    expect(detectSupersetPreference('armamelo en superseries')).toBe(true)
    expect(detectSupersetPreference('quiero los ejercicios agrupados')).toBe(true)
    expect(detectSupersetPreference('hacelo en circuito')).toBe(true)
    expect(detectSupersetPreference('meteme una triserie')).toBe(true)
  })

  it('devuelve false cuando no se menciona nada', () => {
    expect(detectSupersetPreference('armame la sesion de fuerza del martes')).toBe(false)
  })

  it('respeta las negaciones', () => {
    expect(detectSupersetPreference('sin superseries por favor')).toBe(false)
    expect(detectSupersetPreference('nada de circuitos')).toBe(false)
    expect(detectSupersetPreference('no los agrupes')).toBe(false)
  })

  it('prevalece la ultima mencion explicita, no la negacion', () => {
    expect(detectSupersetPreference('no quiero superseries. dale, armamelo en superseries')).toBe(true)
    expect(detectSupersetPreference('armamelo en superseries. mejor sin superseries')).toBe(false)
  })

  it('reconoce las conjugaciones de agrupar como mencion real', () => {
    // Este es el caso que distingue una negacion reconocida de un simple
    // «no se menciono nada»: si el patron no matchea «agrupes», el primer
    // expect pasa por el motivo equivocado y el segundo falla.
    expect(detectSupersetPreference('no los agrupes')).toBe(false)
    expect(detectSupersetPreference('en superseries; finalmente no los agrupes')).toBe(false)
    expect(detectSupersetPreference('no los agrupes; mejor si, en superseries')).toBe(true)
  })

  it('tolera mayusculas y tildes', () => {
    expect(detectSupersetPreference('ARMÁMELO EN SUPERSERIES')).toBe(true)
  })
})
```

- [ ] **Step 2: Correr y confirmar que falla**

Run: `npx vitest run src/services/training/__tests__/supersetPreference.test.ts`
Expected: FAIL — `detectSupersetPreference is not a function`

- [ ] **Step 3: Implementar**

Agregar a `src/services/training/supersetPolicy.ts`:

```ts
// `agrup\\w*` y NO `agrupa\\w*`: este ultimo no matchea «agrupes» ni «agrupen»,
// asi que «no los agrupes» no se reconocia como mencion y caia en `false` por
// ausencia, no por negacion — con el resultado correcto por el motivo
// equivocado, y con «en superseries; finalmente no los agrupes» devolviendo
// `true`.
const SUPERSET_TERM = '(?:superserie|superseries|super\\s?serie|triserie|triseries|circuito|circuitos|agrup\\w*)'
const POSITIVE_PATTERN = new RegExp(`\\b${SUPERSET_TERM}\\b`, 'g')
const NEGATIVE_PATTERN = new RegExp(`\\b(?:sin|nada\\s+de|no)\\s+(?:\\w+\\s+){0,3}?${SUPERSET_TERM}\\b`, 'g')

function normalizeIntentText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

interface Span { start: number; end: number }

function collectSpans(text: string, pattern: RegExp): Span[] {
  return [...text.matchAll(pattern)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }))
}

/**
 * Opera sobre `actionIntentText`, no sobre el ultimo mensaje crudo: ese texto ya
 * incorpora el contexto de la accion reciente, asi que un «si, dale» posterior a
 * «armamelo en superseries» sigue detectandose.
 *
 * Cuando hay menciones en ambos sentidos PREVALECE LA ULTIMA. Evaluar la
 * negacion primero invertiria justamente el caso de confirmacion contextual que
 * este helper existe para soportar.
 */
export function detectSupersetPreference(intentText: string): boolean {
  const text = normalizeIntentText(intentText)
  const negatives = collectSpans(text, NEGATIVE_PATTERN)
  // Un positivo contenido dentro de un negativo NO cuenta como mencion propia:
  // «sin superseries» no es una peticion de superseries.
  const positives = collectSpans(text, POSITIVE_PATTERN)
    .filter((span) => !negatives.some((neg) => span.start >= neg.start && span.end <= neg.end))

  const lastNegative = negatives[negatives.length - 1]
  const lastPositive = positives[positives.length - 1]

  if (lastPositive == null) return false
  if (lastNegative == null) return true
  return lastPositive.start > lastNegative.start
}
```

- [ ] **Step 4: Correr y confirmar que pasa**

Run: `npx vitest run src/services/training/__tests__/supersetPreference.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Dejar listo para commit**

```bash
git add src/services/training/supersetPolicy.ts \
        src/services/training/__tests__/supersetPreference.test.ts
git commit -m "feat(strength): detect explicit superset preference from intent text"
```

---

## Task 13: Cableado, retiro del hack A1/A2 y auditoría del corpus

**Files:**
- Modify: `src/services/ai/actionPostProcessor.ts` (donde se llama `enhanceStrengthSessionExercises`, `:788-795` y `:806`)
- Modify: `src/services/planBuilder/repairWeek.ts:1646, 2246, 2266`
- Modify: `src/services/ai/promptModules/strengthPrompt.ts:157`
- Test: `src/services/training/__tests__/supersetPolicyAudit.test.ts`
- Test: `src/services/ai/__tests__/supersetWiring.test.ts`
- Test: `src/services/planBuilder/__tests__/supersetRepairWiring.test.ts`

**Interfaces:**
- Consumes: `planSupersetGroups`, `shouldApplySupersetPolicy`, `detectSupersetPreference` (Tasks 10-12).
- Produces: nada.

- [ ] **Step 1: Escribir el test de integración que falla**

Crear `src/services/ai/__tests__/supersetWiring.test.ts`. **Prueba los caminos
públicos**, no una recomposición del pipeline en el test:

```ts
import { describe, expect, it } from 'vitest'

import { postProcessCoachActions } from '../actionPostProcessor'

describe('cableado del chat', () => {
  it('una peticion explicita de superseries produce grupos', () => {
    const response = {
      requestClass: 'chat_action' as const,
      message: 'Listo',
      actions: [{
        type: 'add_session' as const,
        date: '2026-08-10',
        sessionType: 'strength' as const,
        title: 'Fuerza',
        durationMin: 60,
        exercises: [
          { name: 'Plancha frontal', sets: 3, reps: '30s' },
          { name: 'Pallof press', sets: 3, reps: '10' },
          { name: 'Peso muerto con trap bar', sets: 4, reps: '5' },
        ],
      }],
    }

    // Las CUATRO señales validas: sin `sportContext.primarySport`, R0 recibe
    // `sportProfile: undefined` y devuelve `off`, y el test pasaria en verde
    // sin probar nada.
    const processed = postProcessCoachActions(
      response as never,
      {
        athleteProfile: {
          macroPlan: { currentPhase: 'base' },
          sportContext: { primarySport: 'squash' },
        },
      } as never,
      'armame la sesion de fuerza del lunes en superseries',
    )

    // A 60 min el densificador puede agregar accesorios y producir mas de un
    // grupo legitimamente. Se afirma la relacion concreta, no el conteo.
    const exercises = processed.actions![0]!.exercises!
    const plancha = exercises.find((e) => e.name === 'Plancha frontal')!
    const pallof = exercises.find((e) => e.name === 'Pallof press')!

    expect(plancha.supersetGroup).toBeDefined()
    expect(plancha.supersetGroup).toBe(pallof.supersetGroup)
  })

  it('a 30 min la preferencia explicita es lo que habilita el agrupamiento', () => {
    // base + 30 min cae en R3 -> `off`. Con `prefersSupersets` sube UN nivel a
    // `permissive`, que es exactamente lo que este test demuestra: la misma
    // entrada cambia de resultado solo por la intencion.
    const build = (durationMin: number) => ({
      requestClass: 'chat_action' as const,
      message: 'Listo',
      actions: [{
        type: 'add_session' as const,
        date: '2026-08-10',
        sessionType: 'strength' as const,
        title: 'Fuerza',
        durationMin,
        exercises: [
          { name: 'Plancha frontal', sets: 3, reps: '30s' },
          { name: 'Pallof press', sets: 3, reps: '10' },
        ],
      }],
    })

    const profile = {
      athleteProfile: {
        macroPlan: { currentPhase: 'base' },
        sportContext: { primarySport: 'squash' },
      },
    }

    const sinIntencion = postProcessCoachActions(
      build(30) as never, profile as never, 'armame la sesion de fuerza del lunes',
    )
    expect(sinIntencion.actions![0]!.exercises!.every((e) => e.supersetGroup == null)).toBe(true)

    const conIntencion = postProcessCoachActions(
      build(30) as never, profile as never, 'armame la sesion de fuerza del lunes en superseries',
    )
    const grouped = conIntencion.actions![0]!.exercises!.filter((e) => e.supersetGroup != null)
    expect(grouped).toHaveLength(2)
  })

  it('sin peticion explicita en taper no agrupa', () => {
    const response = {
      requestClass: 'chat_action' as const,
      message: 'Listo',
      actions: [{
        type: 'add_session' as const,
        date: '2026-08-10',
        sessionType: 'strength' as const,
        title: 'Fuerza',
        durationMin: 60,
        exercises: [
          { name: 'Plancha frontal', sets: 3, reps: '30s' },
          { name: 'Pallof press', sets: 3, reps: '10' },
        ],
      }],
    }

    const processed = postProcessCoachActions(
      response as never,
      {
        athleteProfile: {
          macroPlan: { currentPhase: 'taper' },
          sportContext: { primarySport: 'squash' },
        },
      } as never,
      'armame la sesion de fuerza del lunes',
    )

    expect(processed.actions![0]!.exercises!.every((e) => e.supersetGroup == null)).toBe(true)
  })
})
```

Y el del Plan Builder, contra el camino público real —**`repairGeneratedWeek`
(`repairWeek.ts:164`)**, no `repairWeek`, que no existe como export—, en
`src/services/planBuilder/__tests__/supersetRepairWiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  buildRepairContextForTest,
  buildSkeletonSessionForTest,
} from './helpers/repairTestFixtures'
import { repairGeneratedWeek } from '../repairWeek'
import { resolveSessionStrengthRoles } from '../strengthRoleContract'

const context = buildRepairContextForTest({
  primarySport: 'strength',
  phase: 'base',
  sessionsPerWeek: 1,
})

const rawSessions = [
  buildSkeletonSessionForTest({
    sessionType: 'strength',
    date: '2026-08-03',
    title: 'Fuerza',
    durationMin: 60,
    exercises: [
      { name: 'Plancha frontal', sets: 3, reps: '30s' },
      { name: 'Pallof press', sets: 3, reps: '10' },
      { name: 'Peso muerto con trap bar', sets: 4, reps: '5' },
    ],
  }),
]

const mainLiftOf = (exercises: ReadonlyArray<{ name: string; supersetGroup?: string }>) => {
  const roles = resolveSessionStrengthRoles(exercises)
  const index = roles.indexOf('main_lift')
  return index === -1 ? undefined : exercises[index]!.name
}

describe('cableado del Plan Builder', () => {
  it('la semana reparada trae el circuito de zona media agrupado', () => {
    const { sessions, failure } = repairGeneratedWeek(rawSessions, context)
    expect(failure).toBeUndefined()

    const strength = sessions.filter((session) => session.sessionType === 'strength')
    expect(strength.length).toBeGreaterThan(0)

    const groupIds = new Set(
      strength.flatMap((session) => (session.exercises ?? []).map((e) => e.supersetGroup)).filter(Boolean),
    )
    // Sin esta asercion el test pasaria aunque la politica no estuviera cableada.
    expect(groupIds.size).toBeGreaterThan(0)

    const exercises = strength[0]!.exercises!
    const plancha = exercises.findIndex((e) => e.name === 'Plancha frontal')
    const pallof = exercises.findIndex((e) => e.name === 'Pallof press')

    // Par esperado, contiguo y con el lider primero.
    expect(exercises[plancha]!.supersetGroup).toBeDefined()
    expect(exercises[plancha]!.supersetGroup).toBe(exercises[pallof]!.supersetGroup)
    expect(Math.abs(plancha - pallof)).toBe(1)

    // Identidad del main_lift: se compara el NOMBRE contra la linea base, no
    // solo que exista alguno.
    expect(mainLiftOf(exercises)).toBe('Peso muerto con trap bar')
  })

  it('cada grupo queda contiguo: ningun id reaparece separado', () => {
    const { sessions } = repairGeneratedWeek(rawSessions, context)

    for (const session of sessions.filter((s) => s.sessionType === 'strength')) {
      const seen = new Set<string>()
      let previous: string | undefined

      for (const exercise of session.exercises ?? []) {
        const group = exercise.supersetGroup
        if (group != null && group !== previous) {
          expect(seen.has(group)).toBe(false)
          seen.add(group)
        }
        previous = group
      }
    }
  })
})
```

> Si `repairGeneratedWeek` mueve o renombra la sesión de fuerza con estas
> fixtures, ajustar el filtro — pero **no** relajar `groupIds.size > 0` ni la
> comparación del `main_lift` por nombre: son las dos aserciones que hacen que
> este test valga algo.


- [ ] **Step 2: Correr y confirmar que fallan**

Run: `npx vitest run src/services/ai/__tests__/supersetWiring.test.ts src/services/planBuilder/__tests__/supersetRepairWiring.test.ts`
Expected: FAIL — la politica todavia no esta cableada en ninguno de los dos
caminos, asi que no aparece ningun `supersetGroup`.

- [ ] **Step 3: Cablear el chat**

En `src/services/ai/actionPostProcessor.ts`, donde hoy se asigna el resultado de
`enrichStrengthExercises` (`:788-795` y `:806`), envolver la salida:

```ts
        exercises: applySupersetPolicy(
          enrichStrengthExercises(action.exercises, { … }),
          context,
          actionIntentText,
          resolveActionDurationMin(action),
        ),
```

Y agregar el helper de módulo:

```ts
/**
 * La duracion NO se lee de un campo unico: `add_session` la trae en
 * `durationMin`, `update_session` en `newDurationMin`, y en `create_week` vive
 * en cada sesion propuesta. Por eso el helper la recibe ya resuelta.
 */
function resolveActionDurationMin(action: CoachAction): number | undefined {
  if (action.type === 'update_session') return action.newDurationMin
  return action.durationMin
}

function applySupersetPolicy(
  exercises: CoachExerciseProposal[] | undefined,
  context: ChatContext,
  actionIntentText: string,
  durationMin: number | undefined,
): CoachExerciseProposal[] | undefined {
  if (!exercises || exercises.length === 0) return exercises

  // NO usar `buildStrengthSelectionContextForAction`: rellena fase ausente con
  // 'base' y duracion ausente con 60, lo que anularia R0 y agruparia sesiones
  // sobre las que en realidad no sabemos nada. Sus defaults sirven para elegir
  // ejercicios, no para decidir una politica cuyo modo seguro es `off`.
  const rawPhase = context.athleteProfile?.macroPlan?.currentPhase
  const primarySport = context.athleteProfile?.sportContext?.primarySport

  const mode = shouldApplySupersetPolicy({
    phase: rawPhase as StrengthPhase | undefined,
    sportProfile: primarySport ? deriveActionStrengthSportProfile(primarySport) : undefined,
    sessionDurationMin: durationMin,
    prefersSupersets: detectSupersetPreference(actionIntentText),
  })

  return planSupersetGroups(exercises, mode).exercises   // `decisions` se descarta
}
```

Fase, perfil y duración se pasan **tal como vienen**, sin defaults. Una fase
desconocida o una duración ausente caen en R0 → `off`, que es el comportamiento
correcto: sin señales no se cambia el estímulo.

En la rama de `create_week` (`:806`), pasar `session.durationMin` de cada sesión
propuesta en vez de `resolveActionDurationMin(action)`: ahí la duración vive en
la sesión, no en la acción.

**Cambio de firma explícito.** Hoy `completeStrengthLoads(action, context)`
(`actionPostProcessor.ts:780`) se invoca sin ningún objeto de opciones
(`:119`). Pasa a:

```ts
function completeStrengthLoads(action: CoachAction, context: ChatContext, actionIntentText: string): CoachAction
```

y su único call site (`:119`) pasa a:

```ts
    const loadAligned = completeStrengthLoads(runningAligned, context, actionIntentText)
```

`actionIntentText` ya está en scope ahí — la línea inmediatamente anterior
(`:118`) se lo pasa a `completeRunningZone2Details`.

Importar:

```ts
import { detectSupersetPreference, planSupersetGroups, shouldApplySupersetPolicy } from '../training/supersetPolicy'
```

- [ ] **Step 4: Cablear el Plan Builder — un solo punto**

`repairWeek.ts:255` llama a `normalizeStrengthSessions(sessions, context, meta)`
y su propio comentario lo declara «Una única proyección canónica de fuerza [que]
evita que dos mutadores se deshagan entre sí». **Ese es el único punto de
cableado.** No tocar `:1646`, `:2246` ni `:2266`: aplicar la política tres veces
la haría correr antes del orden final y sobre listas intermedias.

Al **final** del cuerpo de `normalizeStrengthSessions` (`:1548`), después de toda
la rotación y sustitución, agregar:

```ts
  for (const session of strengthSessions) {
    const mode = shouldApplySupersetPolicy({
      // `context.week.phase` CRUDA, sin `mapStrengthPhase`: esa funcion
      // convierte `transition` en `base` (repairWeek.ts:3146), lo que dejaria a
      // una semana de transicion elegible para `full` y romperia su techo.
      phase: context.week.phase as StrengthPhase,
      sportProfile: deriveStrengthSportProfile(context),
      sessionDurationMin: session.durationMin,
      prefersSupersets: false,   // v1: no hay campo del wizard que lo exprese
    })
    session.exercises = planSupersetGroups(session.exercises ?? [], mode).exercises
  }
```

`strengthSessions`, `context` y `deriveStrengthSportProfile` ya están en scope en
esa función — no hay ningún `selectionContext` disponible acá, y usarlo sería un
error de compilación. Si `context.week.phase` trae un valor fuera del dominio de
`StrengthPhase`, R0 lo captura y devuelve `off`, que es el modo seguro.

**`prefersSupersets` es siempre `false`.** No reutilizar un campo existente del
wizard con un significado que no tiene.

Importar:

```ts
import { planSupersetGroups, shouldApplySupersetPolicy } from '../training/supersetPolicy'
```

- [ ] **Step 5: Retirar la regla A1/A2 del prompt**

En `src/services/ai/promptModules/strengthPrompt.ts:157`, **borrar** la línea
completa:

```
· Etiquetado por bloques: en el campo notes de cada ejercicio, prefija una letra+indice que indique agrupacion: A1/A2 para activacion pareada, B1/B2 para potencia + traccion, C1/C2 para fuerza principal + pliometrico, D para fuerza secundaria, E para coordinacion/footwork. Ejercicios solitarios usan la letra sin indice. Esto comunica supersets implicitos sin requerir cambio de schema.
```

La agrupación ya no es una convención de texto libre. La línea siguiente («Notas
tecnicas: … en notes despues del prefijo de bloque») menciona el prefijo:
reescribirla sin esa referencia:

```
· Notas tecnicas: cada ejercicio principal de fuerza debe incluir una nota corta tipo cue en notes. Usa solo estos patrones: "Control y amplitud en el descenso", "Salir explosivo", "Peso considera mancuernas (2)", "No subir carga si se pierde postura", "Control posicion de la cadera".
```

- [ ] **Step 6: Escribir la auditoría del corpus**

Crear `src/services/training/__tests__/supersetPolicyAudit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { normalizeStrengthSessionExercises } from '../strengthSessionStructure'
import type { StrengthPhase, StrengthSportProfile } from '../strengthSelector'
import { planSupersetGroups, shouldApplySupersetPolicy } from '../supersetPolicy'

type Scenario = {
  label: string
  durationMin: number
  phase: StrengthPhase
  sportProfile: StrengthSportProfile
  exercises: Array<{ name: string; sets: number; reps: string }>
}

const CORPUS: Scenario[] = [
  {
    label: 'squash sport_support 60min',
    durationMin: 60,
    phase: 'base',
    sportProfile: 'sport_support',
    exercises: [
      { name: 'Plancha frontal', sets: 3, reps: '30s' },
      { name: 'Pallof press', sets: 3, reps: '10' },
      { name: 'Peso muerto con trap bar', sets: 4, reps: '5' },
      { name: 'Remo con pecho apoyado', sets: 3, reps: '10' },
      { name: 'Press vertical', sets: 3, reps: '8' },
      { name: 'Bici de asalto 30/30', sets: 1, reps: '4 min' },
    ],
  },
  {
    label: 'strength_primary 70min con potencia',
    durationMin: 70,
    phase: 'build',
    sportProfile: 'strength_primary',
    exercises: [
      { name: 'Plancha lateral', sets: 3, reps: '30s' },
      { name: 'Dead bug — control de tronco', sets: 3, reps: '10' },
      { name: 'Clean', sets: 4, reps: '3' },
      { name: 'Dominadas', sets: 4, reps: '6' },
      { name: 'Sentadilla trasera con barra', sets: 4, reps: '5' },
      { name: 'Salto al cajon', sets: 4, reps: '4' },
    ],
  },
  {
    label: 'sets divergentes',
    durationMin: 60,
    phase: 'base',
    sportProfile: 'strength_primary',
    exercises: [
      { name: 'Peso muerto con trap bar', sets: 5, reps: '3' },
      { name: 'Salto al cajon', sets: 3, reps: '4' },
      { name: 'Plancha frontal', sets: 3, reps: '30s' },
      { name: 'Pallof press', sets: 4, reps: '10' },
    ],
  },
]

describe('auditoria del corpus', () => {
  it('produce un reporte legible de pares y descartes', () => {
    const report = CORPUS.map(({ label, durationMin, phase, sportProfile, exercises }) => {
      const sorted = normalizeStrengthSessionExercises(exercises, { durationMin })!
      // Cada escenario usa SU perfil y SU fase declarados: correrlos todos como
      // strength_primary/base ocultaria justamente lo que la auditoria mira.
      const mode = shouldApplySupersetPolicy({ phase, sportProfile, sessionDurationMin: durationMin })
      const { exercises: grouped, decisions } = planSupersetGroups(sorted, mode)

      // `memberIndexes` indexa la lista PRE-REFLOW (`sorted`), no la salida.
      const nameOf = (index: number) => sorted[index]!.name

      return {
        label,
        mode,
        groups: decisions
          .filter((d) => d.outcome === 'grouped')
          .map((d) => ({ rule: d.rule, members: d.memberIndexes.map(nameOf) })),
        discarded: decisions
          .filter((d) => d.outcome !== 'grouped')
          .map((d) => ({ rule: d.rule, reason: d.outcome, members: d.memberIndexes.map(nameOf) })),
        finalOrder: grouped.map((e) => `${e.name}${e.supersetGroup ? ' *' : ''}`),
      }
    })

    // El snapshot es el ARTEFACTO de la auditoria: se revisa a ojo cuando cambia.
    expect(report).toMatchSnapshot()
  })

  it('registra blocked_kind para cardio y movilidad, bajo la regla eligibility', () => {
    const sorted = normalizeStrengthSessionExercises(CORPUS[0]!.exercises, { durationMin: 60 })!
    const { decisions } = planSupersetGroups(sorted, 'permissive')

    const blocked = decisions.filter((d) => d.outcome === 'blocked_kind')
    expect(blocked.length).toBeGreaterThan(0)
    expect(blocked.every((d) => d.rule === 'eligibility')).toBe(true)
  })

  it('registra sets_mismatch cuando las series divergen', () => {
    const { decisions } = planSupersetGroups(
      normalizeStrengthSessionExercises(CORPUS[2]!.exercises, { durationMin: 60 })!,
      'full',
    )

    expect(decisions.some((d) => d.outcome === 'sets_mismatch')).toBe(true)
  })
})
```

- [ ] **Step 7: Generar el artefacto de auditoría y revisarlo**

Run: `npx vitest run src/services/training/__tests__/supersetPolicyAudit.test.ts -u`
Expected: PASS, y se escribe el snapshot.

**Leer el snapshot generado** y verificar a ojo, con criterio deportivo:
- ningún grupo mezcla cardio, movilidad o footwork;
- el `main_lift` aparece siempre como primer miembro de su grupo, nunca como seguidor;
- los descartes por `sets_mismatch` corresponden a series realmente distintas.

Si algo no cuadra, es la política la que está mal, no el snapshot.

- [ ] **Step 8: Suite completa**

Run: `npm test`
Expected: PASS — todos los archivos.

Run: `npm run lint`
Expected: sin errores.

Run: `npm run build`
Expected: build OK (incluye `tsc -b`).

Run: `git diff --check`
Expected: sin salida.

- [ ] **Step 9: Dejar listo para commit**

```bash
git add src/services/ai/actionPostProcessor.ts \
        src/services/ai/promptModules/strengthPrompt.ts \
        src/services/planBuilder/repairWeek.ts \
        src/services/ai/__tests__/supersetWiring.test.ts \
        src/services/planBuilder/__tests__/supersetRepairWiring.test.ts \
        src/services/training/__tests__/supersetPolicyAudit.test.ts \
        src/services/training/__tests__/__snapshots__/supersetPolicyAudit.test.ts.snap
git commit -m "feat(strength): wire superset policy into chat and plan builder"
```

---

## Despliegue

| Bundle | Entregas | Gate previo |
|---|---|---|
| 1 | **1 + 2** (Tasks 1-6) | Barrido pareado en verde; snapshot de orden sin regenerar |
| 2 | 3 (Tasks 7-9) | Suite de componentes en verde |
| 3 | 4 (Tasks 10-13) | Auditoría del corpus revisada a ojo |

**Las Entregas 1 y 2 no se despliegan por separado.** Si los serializers aceptan
grupos (Task 4) antes de que el sort los trate como unidades (Task 6), una
plantilla o una importación podría persistir un grupo que después se rompe.

## Verificación post-despliegue

Sin costo de API, con una sesión real:

1. Abrir una sesión de fuerza vieja (sin grupos) y confirmar que se ve igual que antes.
2. Crear una superserie a mano en el editor y guardarla; recargar y confirmar que persiste.
3. Guardarla como plantilla, aplicarla dos veces en el mismo día y confirmar que los dos grupos son independientes.
4. Exportar el backup, borrar datos locales, importar y confirmar que los grupos vuelven.
5. Pedirle al chat una sesión de fuerza «en superseries» y revisar el resultado.

## Fuera de alcance

Declarado en el spec §2 y no se implementa acá: carga por serie, descanso entre
rondas, tríos automáticos, backfill de sesiones existentes, limpieza de prefijos
`A1/A2` históricos, superseries fuera de fuerza, y `prefersSupersets` en Plan
Builder.

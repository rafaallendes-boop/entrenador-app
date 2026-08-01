# Fuerza — desacople del nombre, Entrega 1: determinismo — Plan

**Spec:** `docs/superpowers/specs/2026-07-31-strength-name-decoupling-design.md` §3
**Inventario:** `docs/superpowers/specs/2026-07-31-strength-name-coupling-inventory.md`

**Ejecución:** manual, por el owner. Los pasos usan checkbox (`- [ ]`).

**Goal:** Que ni la selección de ejercicios ni la resolución de nombres dependan
del texto visible ni del orden de declaración del catálogo.

**Architecture:** Se congela primero, se cambia después. Las dos primeras tareas
no tocan código productivo: construyen los dos artefactos basales que el spec §7
exige, y son los que después atribuyen cada diferencia a su causa. Recién con
esos en verde se cambian el desempate del selector y la prioridad de resolución,
uno por vez, para que cada diferencia tenga un único culpable posible.

**Tech Stack:** TypeScript, Vitest 4, ESLint. Sin dependencias nuevas.

> **Nota de cierre (2026-08-01):** la ejecución real no conservó un snapshot
> pre-cambio: el archivo se generó después del desempate y luego se actualizó
> durante la migración de metadata. Para no presentarlo falsamente como basal,
> el artefacto final se llama `strengthBehaviorContract` y congela el estado
> posterior a las Entregas 1–3. El traslado histórico de los 25
> `loadReference` se protege por un ledger literal e independiente en
> `exerciseLibrary1RMCoverage.test.ts`. Los pasos de Task 1 debajo describen la
> intención original, no un basal histórico que siga existiendo.

## Global Constraints

- **Esta entrega no cambia metadata ni contenido, salvo aliases de
  compatibilidad justificados.** No se toca `category`, `equipment`, `tags`,
  `intensityType` ni ningún nombre. La única excepción admitida es agregar
  `aliases` a una definición cuando la Tarea 5 revele que un nombre legítimo
  dejó de resolver; cada alias agregado se enumera aparte en la entrega.
- **No se borra ningún regex.** Eso es Entrega 2 y 3.
- **`REFERENCE_TABLE` no se toca.** Es Entrega 3.
- El snapshot guarda las **dos** referencias de 1RM en columnas separadas —la
  explícita del selector y la derivada por regex—. Fusionarlas escondería la
  divergencia que la Entrega 3 tiene que resolver (spec §7.1).
- Prioridad de resolución, con la ambigüedad **solo en el último escalón**:
  `id o nombre canónico exacto → alias exacto → único candidato por substring → undefined`.
- Sin migraciones Dexie ni Supabase. Sin dependencias nuevas.
- **Los commits los hace el owner.** Este plan no incluye pasos de `git`.

## File Structure

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `src/services/training/__tests__/strengthBehaviorBaseline.test.ts` | Snapshot por `id` de los 77 (spec §7.1) | Crear |
| `src/services/training/__tests__/__snapshots__/strengthBehaviorBaseline.json` | Estado congelado | Crear (generado) |
| `src/services/training/__tests__/strengthSelectionFixtures.test.ts` | Fixtures de `selectStrengthSession` (spec §7.2) | Crear |
| `src/services/training/__tests__/__snapshots__/strengthSelectionFixtures.json` | Selección congelada | Crear (generado) |
| `src/services/training/strengthSelector.ts` | Desempate por `id` | Modificar (1 línea) |
| `src/services/training/exerciseLibrary.ts` | Prioridad de resolución + ambigüedad | Modificar |
| `src/services/training/__tests__/strengthNameResolution.test.ts` | Contrato de resolución | Crear |

---

### Task 1: Snapshot basal por ejercicio

No toca código productivo. Su entregable es el guard que hace atribuibles a las
Tareas 3 y 4.

**Files:**
- Create: `src/services/training/__tests__/strengthBehaviorBaseline.test.ts`
- Create (generado): `src/services/training/__tests__/__snapshots__/strengthBehaviorBaseline.json`

**Interfaces:**
- Consumes: `STRENGTH_EXERCISE_LIBRARY`, `findStrengthExerciseByName` de
  `../exerciseLibrary`; `enhanceStrengthSessionExercises`,
  `resolveStrengthExerciseBlock` de `../strengthSessionStructure`;
  `mapExerciseTo1RMReference` de `../strengthLoadPrescription`.
- Produces: el snapshot que las Tareas 3 y 4 deben mantener intacto.

- [x] **Step 1: Escribir el test basal**

Crear `src/services/training/__tests__/strengthBehaviorBaseline.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import type { CoachExerciseProposal, StrengthProfile } from '../../../types'
import { findStrengthExerciseByName, STRENGTH_EXERCISE_LIBRARY } from '../exerciseLibrary'
import { mapExerciseTo1RMReference } from '../strengthLoadPrescription'
import { enhanceStrengthSessionExercises, resolveStrengthExerciseBlock } from '../strengthSessionStructure'

/**
 * Basal de comportamiento del pipeline de fuerza (spec 2026-07-31 §7.1).
 *
 * Se congela ANTES de cualquier cambio de las Entregas 1 a 3. Todo lo que se
 * mueva acá después es una diferencia que hay que atribuir y declarar.
 *
 * NO correr `vitest -u` sobre este archivo.
 */

/** Perfil fijo: números redondos para que el peso derivado sea legible. */
const PROFILE: StrengthProfile = {
  squat1RM: 100,
  deadlift1RM: 120,
  benchPress1RM: 80,
  overheadPress1RM: 50,
  pullUpMaxReps: 10,
}

/** 3 repeticiones fuerza el tramo de porcentaje más alto: expone el factor. */
const REPS = 3

function proposalFor(name: string): CoachExerciseProposal {
  return { name, sets: 3, reps: REPS }
}

describe('basal de comportamiento de fuerza', () => {
  it('los 77 ejercicios producen el mismo grupo, unidad, carga y referencias', async () => {
    const rows = STRENGTH_EXERCISE_LIBRARY
      .map((definition) => {
        // `durationMin: 30` es obligatorio. Con 45 o más,
        // `normalizeStrengthSessionExercises:24` llama a `ensureCoreBlock`, que
        // antepone un "Control de tronco dead bug" cuando hay 0 o 1 ejercicios
        // de core — o sea, siempre en este basal. El resultado sería medir
        // `dead_bug` 77 veces. Buscar por nombre tampoco salva el caso, porque
        // el propio `dead_bug` quedaría duplicado.
        const enhanced = enhanceStrengthSessionExercises(
          [proposalFor(definition.name)],
          { durationMin: 30, strengthProfile: PROFILE },
        ) ?? []

        // Guard explícito: si una futura inyección vuelve a agregar ejercicios,
        // este test falla en vez de medir el equivocado en silencio.
        if (enhanced.length !== 1) {
          throw new Error(`${definition.id}: se esperaba 1 ejercicio, llegaron ${enhanced.length}`)
        }
        const [result] = enhanced

        // Las dos referencias van SEPARADAS a propósito (spec §7.1): fusionarlas
        // escondería la divergencia que la Entrega 3 tiene que resolver.
        const regexReference = mapExerciseTo1RMReference(definition.name, PROFILE)

        return {
          id: definition.id,
          resolvedBlock: resolveStrengthExerciseBlock({ name: definition.name, group: undefined }),
          reps: result?.reps ?? null,
          weight: result?.weight ?? null,
          targetPercent1RM: result?.targetPercent1RM ?? null,
          targetRpe: result?.targetRpe ?? null,
          group: result?.group ?? null,
          selectorReference: definition.has1RMReference ?? null,
          regexReferenceLift: regexReference?.lift ?? null,
          regexReferenceFactor: regexReference?.factor ?? null,
        }
      })
      .sort((left, right) => left.id.localeCompare(right.id))

    expect(rows).toHaveLength(77)
    // Guard de que el basal mide algo: si nadie recibe peso, el snapshot no
    // protegería la prescripción de carga, que es lo que más importa.
    expect(rows.filter((row) => row.weight != null).length).toBeGreaterThan(10)

    await expect(`${JSON.stringify(rows, null, 2)}\n`)
      .toMatchFileSnapshot('./__snapshots__/strengthBehaviorBaseline.json')
  })

  it('cada nombre canónico resuelve a su propio id', () => {
    const offenders = STRENGTH_EXERCISE_LIBRARY
      .filter((definition) => findStrengthExerciseByName(definition.name)?.id !== definition.id)
      .map((definition) => definition.id)
    expect(offenders).toEqual([])
  })
})
```

- [x] **Step 2: Generar el snapshot**

Correr: `npx vitest run src/services/training/__tests__/strengthBehaviorBaseline.test.ts`

Esperado: PASS. Se crea
`src/services/training/__tests__/__snapshots__/strengthBehaviorBaseline.json` con
77 filas. Abrirlo y confirmar tres cosas: que hay filas con `weight` no nulo, que
`selectorReference` y `regexReferenceLift` **difieren** en varias filas —esa
divergencia es el hallazgo del inventario y tiene que quedar registrada—, y que
`bodyweight_squat` aparece con `weight: 82.5`.

Si el segundo test falla, hay nombres canónicos que no se resuelven a sí mismos:
eso es un bug preexistente y hay que reportarlo antes de seguir, no arreglarlo
acá.

- [x] **Step 3: Comprobar que el basal muerde**

Editar temporalmente `src/services/training/exerciseLibrary.ts` y cambiar en
`EXERCISE_LOAD_REFERENCES` el `lift` de `front_squat` de `squat` a `deadlift`.

Correr: `npx vitest run src/services/training/__tests__/strengthBehaviorBaseline.test.ts`

Esperado: **FAIL**, con diferencia en `selectorReference` de `front_squat`.

- [x] **Step 4: Revertir la mutación de prueba**

Dejar la línea exactamente como estaba:

```ts
  front_squat: { lift: 'squat', factor: 0.85, selectorEligible: true },
```

Correr: `npx vitest run src/services/training/__tests__/strengthBehaviorBaseline.test.ts`

Esperado: PASS.

---

### Task 2: Fixtures de selección

Tampoco toca código productivo. Es el artefacto que el snapshot por ejercicio
**no** puede sustituir: congela qué elige el selector, no qué propiedades tiene
cada ejercicio.

**Files:**
- Create: `src/services/training/__tests__/strengthSelectionFixtures.test.ts`
- Create (generado): `src/services/training/__tests__/__snapshots__/strengthSelectionFixtures.json`

**Interfaces:**
- Consumes: `selectStrengthSession` y el tipo `StrengthContext` de
  `../strengthSelector`.
- Produces: el snapshot de selección que la Tarea 3 debe explicar.

- [x] **Step 1: Escribir los fixtures**

Crear `src/services/training/__tests__/strengthSelectionFixtures.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { findStrengthExerciseByName } from '../exerciseLibrary'
import { selectStrengthSession, type StrengthContext } from '../strengthSelector'

/**
 * Fixtures de selección (spec 2026-07-31 §7.2).
 *
 * El snapshot por ejercicio congela propiedades de cada definición; esto congela
 * la **elección**.
 *
 * `selectStrengthSession` tiene dos caminos y hay que cubrir los dos por
 * separado. `shouldUseBlockTemplateSelection:139` desvía a la selección por
 * plantilla si el contexto trae `weekIndexInBlock`, `available1RM` no vacío o
 * `rpeAdjustment`. El desempate que cambia la Tarea 3 —`scoreExercises:1006`—
 * vive en el camino **sin** plantilla, así que los escenarios normales no deben
 * traer ninguno de esos tres campos.
 *
 * NO correr `vitest -u` sobre este archivo.
 */

/** Sin `as`: si un campo deja de ser válido, TypeScript lo dice acá. */
function contextFor(overrides: Partial<StrengthContext>): StrengthContext {
  return {
    fatigueLevel: 4,
    phase: 'build',
    recentExercises: [],
    goal: 'ganar fuerza para squash',
    sportProfile: 'sport_support',
    primarySport: 'squash',
    experienceLevel: 'intermediate',
    sessionDurationMin: 50,
    ...overrides,
  }
}

/** Camino sin plantilla: es el que recorre el desempate de la Tarea 3. */
const SCORED_SCENARIOS: Array<{ name: string; context: StrengthContext }> = [
  { name: 'base', context: contextFor({ phase: 'base' }) },
  { name: 'build', context: contextFor({ phase: 'build' }) },
  { name: 'peak', context: contextFor({ phase: 'peak' }) },
  { name: 'taper', context: contextFor({ phase: 'taper' }) },
  { name: 'fatiga alta', context: contextFor({ fatigueLevel: 8 }) },
  { name: 'fatiga baja', context: contextFor({ fatigueLevel: 1 }) },
  { name: 'solo peso corporal', context: contextFor({ availableEquipment: ['bodyweight'] }) },
  { name: 'gimnasio completo', context: contextFor({ availableEquipment: ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight'] }) },
  { name: 'competencia cercana', context: contextFor({ competitionSoon: true, daysToCompetition: 3 }) },
  { name: 'principiante', context: contextFor({ experienceLevel: 'beginner' }) },
]

/** Camino por plantilla: se congela igual, pero no cubre el desempate. */
const TEMPLATE_SCENARIOS: Array<{ name: string; context: StrengthContext }> = [
  { name: 'plantilla semana 0', context: contextFor({ weekIndexInBlock: 0 }) },
  { name: 'plantilla semana 1', context: contextFor({ weekIndexInBlock: 1 }) },
  { name: 'plantilla con 1RM completo', context: contextFor({ available1RM: ['squat', 'deadlift', 'benchPress', 'overheadPress'] }) },
  { name: 'plantilla con 1RM solo squat', context: contextFor({ available1RM: ['squat'] }) },
]

/**
 * La firma va por `id`, no por nombre. El selector solo expone `name`
 * (`strengthSelector.ts:49` y `:75`), pero esos nombres son canónicos y
 * resuelven por el primer escalón del matcher, así que guardarlos como `id`
 * desacopla este snapshot de la futura entrega de copy.
 */
/** Único punto de conversión nombre→id. Rompe en vez de degradar a `null`. */
function idForCanonicalName(name: string): string {
  const id = findStrengthExerciseByName(name)?.id
  if (!id) throw new Error(`nombre no resuelto en la selección: "${name}"`)
  return id
}

function signatureOf(names: string[]): string {
  return names.map(idForCanonicalName).join(' | ')
}

function rowsFor(scenarios: typeof SCORED_SCENARIOS, path: string) {
  return scenarios.map(({ name, context }) => {
    const session = selectStrengthSession(context)
    return {
      path,
      scenario: name,
      focus: session.focus,
      // Mismo helper que la firma: un starLift sin resolver debe romper, no
      // convertirse en `null` en silencio.
      starLift: session.starLift ? idForCanonicalName(session.starLift.name) : null,
      signature: signatureOf(session.exercises.map((exercise) => exercise.name)),
    }
  })
}

describe('fixtures de selección de fuerza', () => {
  it('la selección es estable por escenario', async () => {
    const rows = [
      ...rowsFor(SCORED_SCENARIOS, 'scored'),
      ...rowsFor(TEMPLATE_SCENARIOS, 'template'),
    ]

    expect(rows).toHaveLength(SCORED_SCENARIOS.length + TEMPLATE_SCENARIOS.length)
    expect(rows.every((row) => row.signature.length > 0)).toBe(true)
    // Los escenarios del camino puntuado tienen que producir selecciones
    // distintas entre sí; si no, no discriminan y no servirían de detector.
    expect(new Set(rows.filter((row) => row.path === 'scored').map((row) => row.signature)).size)
      .toBeGreaterThan(1)

    await expect(`${JSON.stringify(rows, null, 2)}\n`)
      .toMatchFileSnapshot('./__snapshots__/strengthSelectionFixtures.json')
  })
})
```

- [x] **Step 2: Generar el snapshot**

Correr: `npx vitest run src/services/training/__tests__/strengthSelectionFixtures.test.ts`

Esperado: PASS, con el snapshot creado y 14 escenarios (10 `scored` + 4 `template`). Revisar que las firmas no
sean todas idénticas: si lo fueran, los escenarios no discriminan y hay que
variarlos más antes de seguir.

---

### Task 3: Desempate del selector por `id`

**Files:**
- Modify: `src/services/training/strengthSelector.ts:1006`
- Modify: `src/services/training/__tests__/strengthSelectionFixtures.test.ts`

**Interfaces:**
- Consumes: los dos snapshots de las Tareas 1 y 2.

El cambio es de una línea y el riesgo es que quede **sin cobertura**. Encontrar
un empate no alcanza: los dos ejercicios empatados podrían entrar ambos a la
sesión, o quedar ambos fuera, y entonces el desempate no cambia nada observable y
un test `toContain` nacería verde. Por eso la secuencia es: encontrar empates,
**probar el comparator nuevo y ver qué cambia en la salida pública**, revertir,
escribir ese cambio como test rojo, y recién ahí implementar.

`scoreExercises` es privada (`strengthSelector.ts:867`), así que todo esto va con
instrumentación temporal y su reversión explícita.

- [x] **Step 1: Instrumentar el escenario y los empates**

Dos ediciones temporales.

En `src/services/training/__tests__/strengthSelectionFixtures.test.ts`, dentro de
`rowsFor`, antes de la llamada a `selectStrengthSession`:

```ts
    // TEMPORAL — Tarea 3. Atribuye cada log de empate a su escenario.
    // eslint-disable-next-line no-console
    console.log(`ESCENARIO ${path}/${name}`)
```

En `src/services/training/strengthSelector.ts`, **debajo** de la línea 1006,
agregar este bloque, que no cambia el orden y solo reporta:

```ts
    .map((entry, index, all) => {
      if (index !== 0) return entry
      const byScore = new Map<number, string[]>()
      for (const item of all) {
        byScore.set(item.score, [...(byScore.get(item.score) ?? []), item.exercise.id])
      }
      for (const [score, ids] of byScore) {
        if (ids.length < 2) continue
        const winnerByName = ids[0]
        const winnerById = [...ids].sort((left, right) => left.localeCompare(right))[0]
        if (winnerByName !== winnerById) {
          // eslint-disable-next-line no-console
          console.log(`EMPATE score=${score} nombre→${winnerByName} id→${winnerById} (${ids.join(',')})`)
        }
      }
      return entry
    })
```

`ids` conserva el orden del `sort` de arriba, que hoy es por nombre; por eso
`ids[0]` es el ganador actual y el `sort` por `localeCompare` del `id` da el
ganador futuro.

- [x] **Step 2: Capturar los empates, atribuidos a su escenario**

Correr: `npx vitest run src/services/training/__tests__/strengthSelectionFixtures.test.ts --silent=false`

Cada línea `EMPATE` pertenece al último `ESCENARIO` impreso antes. Anotar la
lista: escenario, `score`, ganador por nombre, ganador por `id`.

Si no aparece ninguna, agregar escenarios a `SCORED_SCENARIOS` —variando `goal`,
`recentExercises` y `experienceLevel`, que son los que más mueven el puntaje—
hasta que alguno la produzca.

- [x] **Step 3: Probar el comparator nuevo y ver qué cambia de verdad**

Con la instrumentación todavía puesta, aplicar **temporalmente** el cambio en la
línea 1006:

```ts
    .sort((a, b) => b.score - a.score || a.exercise.id.localeCompare(b.exercise.id))
```

Correr: `npx vitest run src/services/training/__tests__/strengthSelectionFixtures.test.ts`

El test del snapshot **debe fallar**, y su diff dice exactamente qué escenarios
cambiaron de selección. Anotar, para cada uno: el escenario, el `id` que salió y
el que entró.

**Si el snapshot no falla**, ningún empate llega a afectar la salida pública: el
cambio no es observable con estos escenarios. Entonces hay que ampliar
`SCORED_SCENARIOS` y repetir desde el Step 2. Si tras ampliar sigue sin ser
observable, **parar y consultar**: hace falta otro punto de prueba —por ejemplo
exportar `scoreExercises` bajo un nombre explícito de test— y esa es una decisión
de diseño, no del plan.

- [x] **Step 4: Revertir las tres ediciones temporales**

Dejar la línea 1006 exactamente como estaba:

```ts
    .sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name))
```

Borrar el bloque `.map(...)` del Step 1 y el `console.log` de `ESCENARIO` en
`rowsFor`.

Correr: `npx vitest run src/services/training/__tests__/strengthSelectionFixtures.test.ts`

Esperado: PASS, sin ninguna salida `EMPATE` ni `ESCENARIO`.

- [x] **Step 5: Escribir el test del desempate, en rojo**

Usar un escenario del Step 3 —uno cuya **selección haya cambiado**, no solo cuyo
empate se haya detectado—. Agregar al final de
`strengthSelectionFixtures.test.ts`, reemplazando los tres marcadores por los
valores anotados:

```ts
describe('desempate del selector', () => {
  it('ante puntajes iguales gana el id menor, no el nombre', () => {
    const session = selectStrengthSession(contextFor({ /* <escenario del Step 3> */ }))
    const ids = session.exercises.map((exercise) => idForCanonicalName(exercise.name))

    // Estos dos empatan en `score` y solo uno entra a la sesión. Con desempate
    // por nombre entraba `<idQueSalio>`; con desempate por id entra
    // `<idQueEntro>`. El Step 3 verificó que la diferencia es observable acá.
    expect(ids).toContain('<idQueEntro>')
    expect(ids).not.toContain('<idQueSalio>')
  })
})
```

- [x] **Step 6: Verificar que el test arranca rojo**

Correr: `npx vitest run src/services/training/__tests__/strengthSelectionFixtures.test.ts`

Esperado: **FAIL** en ese caso concreto, porque todavía gana el nombre. Si pasa
en verde, el escenario elegido no es observable y hay que volver al Step 3 con
otro.

- [x] **Step 7: Aplicar el cambio definitivo**

En `src/services/training/strengthSelector.ts:1006`, reemplazar:

```ts
    .sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name))
```

por:

```ts
    // El desempate va por `id`, que es estable y nunca es texto de usuario. Con
    // `name` un renombre cambiaba qué ejercicio se prescribe.
    .sort((a, b) => b.score - a.score || a.exercise.id.localeCompare(b.exercise.id))
```

- [x] **Step 8: Correr el test del desempate y los dos snapshots**

Correr: `npx vitest run src/services/training/__tests__/strengthBehaviorBaseline.test.ts src/services/training/__tests__/strengthSelectionFixtures.test.ts`

Esperado: el test del desempate **PASS**. El basal por ejercicio **PASS sin
cambios**: este cambio no toca propiedades de ejercicios, así que cualquier
movimiento ahí es una regresión. El snapshot de selección falla con exactamente
las mismas diferencias que el Step 3.

- [x] **Step 9: Clasificar cada diferencia de selección**

Contrastar el diff contra lo anotado en los Steps 2 y 3. Un cambio entre dos
ejercicios que figuraban empatados es el efecto buscado. **Un cambio en un
escenario que no aparecía en la lista de empates no lo es**, y hay que
investigarlo —reinstrumentando si hace falta— antes de aceptar el snapshot.

Los escenarios de `path: 'template'` **no deberían moverse**: no pasan por
`scoreExercises`. Si alguno se mueve, la premisa de separación de caminos está
mal y hay que revisarla antes de seguir.

- [x] **Step 10: Aceptar el nuevo estado de los fixtures**

Solo si todas las diferencias quedaron clasificadas como empates: borrar
`src/services/training/__tests__/__snapshots__/strengthSelectionFixtures.json` y
volver a correr el test.

Correr: `npx vitest run src/services/training/__tests__/strengthSelectionFixtures.test.ts`

Esperado: PASS.

---

### Task 4: Prioridad de resolución y ambigüedad

**Files:**
- Modify: `src/services/training/exerciseLibrary.ts` (`findStrengthExerciseByName`)
- Create: `src/services/training/__tests__/strengthNameResolution.test.ts`

**Interfaces:**
- Produces: el contrato de resolución que la Entrega 3 asume al retirar
  `REFERENCE_TABLE`.

- [x] **Step 1: Escribir el test del contrato**

Crear `src/services/training/__tests__/strengthNameResolution.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { findStrengthExerciseByName, STRENGTH_EXERCISE_LIBRARY } from '../exerciseLibrary'

/**
 * Contrato de resolución (spec 2026-07-31 §3.2).
 *
 *   id o nombre canónico exacto
 *     → alias exacto
 *       → único candidato por substring
 *         → undefined
 *
 * La ambigüedad rechaza SOLO en el último escalón. Un alias declarado nunca
 * queda sin resolver por ser ambiguo, porque no llega a esa rama.
 */
describe('resolución de nombres de ejercicios', () => {
  it('cada nombre canónico resuelve a su propio id', () => {
    const offenders = STRENGTH_EXERCISE_LIBRARY
      .filter((definition) => findStrengthExerciseByName(definition.name)?.id !== definition.id)
      .map((definition) => definition.id)
    expect(offenders).toEqual([])
  })

  it('cada alias declarado resuelve a su propio id', () => {
    const offenders: string[] = []
    for (const definition of STRENGTH_EXERCISE_LIBRARY) {
      for (const alias of definition.aliases ?? []) {
        if (findStrengthExerciseByName(alias)?.id !== definition.id) {
          offenders.push(`${definition.id} ← "${alias}"`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('un alias exacto gana sobre la ambigüedad por substring', () => {
    // "Sentadilla" está en `back_squat.aliases` y en el aliasMap interno, y a la
    // vez es substring de 8 ejercicios. Resuelve por alias, no se rechaza.
    expect(findStrengthExerciseByName('Sentadilla')?.id).toBe('back_squat')
    expect(findStrengthExerciseByName('Dominadas')?.id).toBe('pull_up')
  })

  it('un fragmento que empata entre varios ejercicios no resuelve', () => {
    expect(findStrengthExerciseByName('press')).toBeUndefined()
    expect(findStrengthExerciseByName('remo')).toBeUndefined()
  })

  it('un texto sin relación con el catálogo no resuelve', () => {
    expect(findStrengthExerciseByName('Circuito experimental alfa')).toBeUndefined()
  })
})
```

- [x] **Step 2: Correr el test y verificar qué falla**

Correr: `npx vitest run src/services/training/__tests__/strengthNameResolution.test.ts`

Esperado: pasan los tres primeros; **falla el cuarto**, porque hoy `"press"`
devuelve `bench_press` y `"remo"` devuelve `bent_over_row` por orden de
declaración.

- [x] **Step 3: Aplicar la ambigüedad al escalón de substring**

En `src/services/training/exerciseLibrary.ts`, reemplazar el `return` final de
`findStrengthExerciseByName`:

```ts
  return STRENGTH_EXERCISE_LIBRARY.find((exercise) =>
    normalized.includes(normalizeStrengthExerciseKey(exercise.name)) ||
    normalizeStrengthExerciseKey(exercise.name).includes(normalized) ||
    exercise.aliases?.some((alias) =>
      normalized.includes(normalizeStrengthExerciseKey(alias)) ||
      normalizeStrengthExerciseKey(alias).includes(normalized),
    ),
  )
}
```

por:

```ts
  const substringCandidates = STRENGTH_EXERCISE_LIBRARY.filter((exercise) =>
    normalized.includes(normalizeStrengthExerciseKey(exercise.name)) ||
    normalizeStrengthExerciseKey(exercise.name).includes(normalized) ||
    exercise.aliases?.some((alias) =>
      normalized.includes(normalizeStrengthExerciseKey(alias)) ||
      normalizeStrengthExerciseKey(alias).includes(normalized),
    ),
  )

  // Varios ejercicios igual de plausibles significa que el fragmento no
  // discrimina. Se prefiere no resolver: adivinar mal prescribe carga sobre el
  // ejercicio equivocado, y además el resultado dependía del orden de
  // declaración del catálogo.
  return substringCandidates.length === 1 ? substringCandidates[0] : undefined
}
```

Los escalones anteriores —`exact`, `aliasExact` y el `aliasMap` interno— **no se
tocan**: son los que garantizan que un alias declarado nunca caiga acá.

- [x] **Step 4: Correr el test y verificar que pasa**

Correr: `npx vitest run src/services/training/__tests__/strengthNameResolution.test.ts`

Esperado: PASS los cinco.

- [x] **Step 5: Correr los dos snapshots**

Correr: `npx vitest run src/services/training/__tests__/strengthBehaviorBaseline.test.ts src/services/training/__tests__/strengthSelectionFixtures.test.ts`

Esperado: **PASS los dos, sin diferencias.** Los 77 nombres canónicos resuelven
por el primer escalón, así que este cambio no puede afectarlos. Si alguno se
mueve, hay un nombre canónico que dependía del substring y eso es un hallazgo:
anotarlo y consultar antes de seguir.

---

### Task 5: Verificación completa

**Files:** ninguno. Solo verificación.

- [x] **Step 1: Suite completa**

Correr: `npm test`

Esperado: PASS. Si fallan tests preexistentes, casi siempre será por la Tarea 4:
un fixture que usaba un nombre libre que hoy resolvía por substring. Para cada
uno, clasificarlo:

- **El nombre identifica un ejercicio y falta un alias** → agregar el alias a la
  definición. Es la salida esperada en la mayoría de los casos.
- **El nombre es legítimamente ambiguo** → corregir el fixture para que use un
  nombre que identifique algo.

Nunca ampliar la tolerancia del matcher para hacer pasar un test.

- [x] **Step 2: Lint**

Correr: `npm run lint`

Esperado: sin salida.

- [x] **Step 3: Build**

Correr: `npm run build`

Esperado: `✓ built in …` y `Generated metadata for 8 public routes`.

- [x] **Step 4: Higiene del diff**

Correr: `git diff --check`

Esperado: sin salida.

- [x] **Step 5: Confirmar el alcance del diff**

Correr: `git diff --stat`

Esperado: exactamente dos archivos productivos modificados —
`strengthSelector.ts` con una línea y `exerciseLibrary.ts` con el bloque final de
`findStrengthExerciseByName`— más los archivos de test nuevos y sus snapshots.
**Ninguna definición de ejercicio puede aparecer en el diff**, salvo aliases
agregados en el Step 1 de esta tarea, que hay que enumerar aparte.

- [x] **Step 6: Confirmar que los snapshots son nuevos**

Correr: `git status --short src/services/training/__tests__/__snapshots__/`

Esperado: los dos aparecen como archivos nuevos (`??`). El de selección puede
aparecer modificado si se regeneró en la Tarea 3 Step 4; el basal por ejercicio
**no puede aparecer modificado nunca** en esta entrega.

---

## Entrega

El owner hace un commit intencional con la spec, el inventario, este plan y el
código. Este plan no ejecuta `git add` ni `git commit`.

Diferencias que el commit debe declarar, según spec §7:

- `"press"` y `"remo"` pasan a `undefined`.
- Los cambios de los fixtures de selección, si los hubo, con su clasificación de
  empate.
- Los aliases agregados durante la Tarea 5 Step 1, si los hubo.

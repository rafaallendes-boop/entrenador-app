# Librería de squash — lenguaje de cara al usuario (Entrega 1) — Plan de implementación

**Spec:** `docs/superpowers/specs/2026-07-31-squash-drill-copy-design.md` (aprobada)

**Ejecución:** manual, en esta sesión, por el owner. Los pasos usan checkbox
(`- [ ]`) para seguimiento.

**Goal:** Dejar los 43 drills de squash en español neutro y con vocabulario
consistente de cara al usuario, sin mover ni un milímetro del planificador.

**Architecture:** Se congela primero, se edita después. La Tarea 1 crea un
snapshot de **todo** el estado actual de la librería: los campos que no son texto
de usuario, más los 29 nombres y las 22 descripciones que esta entrega **no**
toca. Las tareas siguientes editan solo `name`, `description` y el nuevo
`aliases` de los ids listados, y ese snapshot es el que prueba que nada más se
movió. Los nombres viejos sobreviven como `aliases` dentro de cada definición,
lo que mantiene la resolución de datos históricos y los devuelve al buscador del
catálogo del coach.

**Tech Stack:** TypeScript, Vitest 4, ESLint. Sin dependencias nuevas.

## Global Constraints

- **Los únicos campos editables son `name`, `description` y `aliases`**, y solo
  en los ids listados en las Tareas 2, 3 y 4. Todo lo demás —`category`,
  `focus`, `tags`, `intensity`, `intent`, `constraints`, `progressionLevel`—
  queda idéntico.
- **Nombres de partido congelados**, por estar hardcodeados en cinco
  consumidores (spec §5): `match_sim_points_short_sets`,
  `practice_match_five_games`, `practice_match_best_of_3`. Sus **descripciones**
  sí pueden cambiar. Los otros 26 nombres estables no son un caso especial: no
  están en la lista de renombres y el snapshot los cubre.
- Español neutro: tuteo, `cancha` (no "pista"), `pelota` (no "bola"), sin voseo,
  sin regionalismos. `la T` siempre femenino.
- Toda descripción conserva el andamio `Objetivo:` y `Clave:` y **≥ 120
  caracteres** (test existente en `drillLibrarySchema.test.ts`).
- Prohibidos en texto de usuario: `RSA`, `chapa`, `game`. Única excepción:
  `match_sim_points_short_sets.name`.
- El **tag** `rsa` se conserva: `getSquashDrillFamily` (`drillLibrary.ts:755`)
  ramifica sobre él.
- Sin migraciones Dexie ni Supabase. Sin dependencias nuevas.
- **Los commits los hace el owner.** Este plan no incluye pasos de `git`: cada
  tarea cierra con verificación, y el owner hace un único commit intencional al
  final con spec, plan y código.

## File Structure

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `src/services/training/drillLibrary.ts` | Definiciones de los 43 drills, campo `aliases`, resolución por nombre | Modificar |
| `src/services/training/coachExerciseCatalog.ts` | Índice de búsqueda del picker del coach | Modificar (1 línea) |
| `src/services/training/__tests__/squashDrillInvariants.test.ts` | Guard: nada fuera de lo listado cambia | Crear |
| `src/services/training/__tests__/__snapshots__/squashDrillInvariants.json` | Estado congelado, generado antes de editar | Crear (generado) |
| `src/services/training/__tests__/squashDrillAliases.test.ts` | Renombres, aliases y buscador | Crear |
| `src/services/training/__tests__/squashDrillCopyParity.test.ts` | Guard: las 21 descripciones son exactamente las de la spec §3bis | Crear |
| `src/services/training/__tests__/squashDrillCopy.test.ts` | Guards de contenido y de colisión de nombres | Crear |
| `src/services/planBuilder/__tests__/squashDrillRenameStability.test.ts` | Estabilidad de firma en repair y Week Creator | Crear |

---

### Task 1: Congelar el estado actual antes de tocar nada

Va **primera** y no edita ningún drill. Su entregable es el guard que hace
seguras a todas las demás.

**Files:**
- Create: `src/services/training/__tests__/squashDrillInvariants.test.ts`
- Create (generado): `src/services/training/__tests__/__snapshots__/squashDrillInvariants.json`

**Interfaces:**
- Consumes: `SQUASH_DRILL_LIBRARY`, `resolveDrillExecutionMode`,
  `resolveSquashDrillKind`, `getSquashDrillFamily`, todos ya exportados desde
  `../drillLibrary`.
- Produces: el snapshot que las Tareas 2, 3 y 4 deben mantener intacto, y las
  constantes `RENAMED_IDS` y `REWRITTEN_DESCRIPTION_IDS`, que la Tarea 3 y la
  Tarea 4 usan como lista de trabajo.

- [ ] **Step 1: Escribir el test de invariantes**

Crear `src/services/training/__tests__/squashDrillInvariants.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  getSquashDrillFamily,
  resolveDrillExecutionMode,
  resolveSquashDrillKind,
  SQUASH_DRILL_LIBRARY,
} from '../drillLibrary'

/** Los 14 ids cuyo `name` cambia en esta entrega. Spec §3. */
const RENAMED_IDS = new Set([
  'drive_parallel_depth',
  'drive_crosscourt_length',
  'drive_switch_parallel_cross',
  'boast_to_straight_drive',
  'solo_100_drops',
  'solo_100_mid_court_shots',
  'solo_100_service_box',
  'solo_100_parallels_back',
  'pressure_three_quarters_court',
  'conditioned_boast_start',
  'rsa_short_bursts',
  'continuous_squash_movement_base',
  'extensive_aerobic_movement_intervals',
  'technical_recovery_length',
])

/** Los 21 ids cuya `description` cambia en esta entrega. Spec §3bis. */
const REWRITTEN_DESCRIPTION_IDS = new Set([
  'drive_parallel_depth',
  'drive_crosscourt_length',
  'drive_switch_parallel_cross',
  'boast_to_straight_drive',
  'drop_and_counter_drop',
  'solo_100_drops',
  'mid_court_drops',
  'solo_volleys_only',
  'attack_from_t_first_ball',
  'conditioned_boast_start',
  'ghosting_4_corners',
  'ghosting_6_points',
  'split_step_t_recovery',
  'rsa_short_bursts',
  'defensive_high_lob_recovery',
  'attacking_lob_change_of_pace',
  'attacking_boast_from_mid_court',
  'attacking_boast_from_back_court',
  'continuous_squash_movement_base',
  'match_sim_points_short_sets',
  'practice_match_best_of_3',
])

/**
 * Guard de la entrega de copy (spec 2026-07-31).
 *
 * Congela todo lo que esta entrega NO puede tocar: los campos que no son texto
 * de usuario, más los 29 nombres y las 22 descripciones que quedan estables.
 * Solo `name` de los 14 renombrados, `description` de los 21 reescritos y el
 * campo `aliases` quedan fuera del snapshot.
 *
 * NO correr `vitest -u` sobre este archivo. Si el snapshot cambia, una edición
 * se salió de su carril — que es exactamente el bug que este guard atrapa.
 */
describe('invariantes de la librería de squash', () => {
  it('solo cambian los nombres, descripciones y aliases previstos', async () => {
    const table = SQUASH_DRILL_LIBRARY
      .map((drill) => ({
        id: drill.id,
        category: drill.category,
        focus: [...drill.focus],
        tags: [...drill.tags],
        intensity: drill.intensity,
        intent: drill.intent ?? null,
        constraints: drill.constraints ? [...drill.constraints] : null,
        progressionLevel: drill.progressionLevel ?? null,
        phaseAppropriate: [...(drill.phaseAppropriate ?? [])],
        partnerRequired: drill.partnerRequired ?? null,
        executionMode: resolveDrillExecutionMode(drill),
        family: getSquashDrillFamily(drill),
        blockKind: resolveSquashDrillKind(drill),
        // Los que la entrega no renombra ni reescribe quedan congelados acá.
        stableName: RENAMED_IDS.has(drill.id) ? null : drill.name,
        stableDescription: REWRITTEN_DESCRIPTION_IDS.has(drill.id) ? null : drill.description,
      }))
      .sort((left, right) => left.id.localeCompare(right.id))

    expect(table).toHaveLength(43)
    expect(table.filter((row) => row.stableName !== null)).toHaveLength(29)
    expect(table.filter((row) => row.stableDescription !== null)).toHaveLength(22)

    await expect(`${JSON.stringify(table, null, 2)}\n`)
      .toMatchFileSnapshot('./__snapshots__/squashDrillInvariants.json')
  })
})
```

- [ ] **Step 2: Generar el snapshot**

Correr: `npx vitest run src/services/training/__tests__/squashDrillInvariants.test.ts`

Esperado: PASS. Vitest crea
`src/services/training/__tests__/__snapshots__/squashDrillInvariants.json`.
Abrirlo y confirmar que tiene 43 objetos, que 29 traen `stableName` con texto y
14 lo traen en `null`, y que 22 traen `stableDescription` con texto y 21 en
`null`.

- [ ] **Step 3: Comprobar que el guard muerde**

Un guard que nunca falla no protege nada. Editar temporalmente
`src/services/training/drillLibrary.ts` y agregar `'pressure'` al array `tags` de
`attacking_lob_change_of_pace`.

Correr: `npx vitest run src/services/training/__tests__/squashDrillInvariants.test.ts`

Esperado: **FAIL**, con diferencias en `tags` y **además** en `phaseAppropriate`
—porque `inferDrillPhaseAppropriate` ramifica sobre el tag `pressure` y lo movería
de `['base','build','peak','taper']` a `['build','peak']`—. Esa doble diferencia
es justamente el ripple que la spec §4 describe.

- [ ] **Step 4: Revertir la mutación de prueba**

Volver a quitar `'pressure'` del array `tags` de `attacking_lob_change_of_pace`,
dejando la línea exactamente como estaba:

```ts
    tags: ['lob', 'attack', 'build', 'peak', 'variation'],
```

Correr: `npx vitest run src/services/training/__tests__/squashDrillInvariants.test.ts`

Esperado: PASS.

---

### Task 2: Campo `aliases`, resolución y buscador, probados con el primer renombre

**Files:**
- Modify: `src/services/training/drillLibrary.ts` (interface, `findSquashDrillByName`, definición de `drive_parallel_depth`)
- Modify: `src/services/training/coachExerciseCatalog.ts:72`
- Create: `src/services/training/__tests__/squashDrillAliases.test.ts`

**Interfaces:**
- Produces: `SquashDrillDefinition.aliases?: string[]`, consumido por
  `findSquashDrillByName` y por `buildSearchText` en el catálogo. Las Tareas 3, 5
  y 6 dependen de que este campo exista.

- [ ] **Step 1: Escribir el test que falla**

El test afirma el estado final directamente. No sirve apoyarse en
`findSquashDrillByName('Drives paralelos profundos')`: el matcher difuso por
tokens ya lo resuelve hoy, así que ese caso pasaría en verde sin haber
implementado nada.

Crear `src/services/training/__tests__/squashDrillAliases.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { SQUASH_DRILL_LIBRARY } from '../drillLibrary'
import { searchCatalog } from '../coachExerciseCatalog'

describe('aliases de nombres anteriores', () => {
  const drill = () => SQUASH_DRILL_LIBRARY.find((item) => item.id === 'drive_parallel_depth')

  it('el drill adopta su nombre nuevo', () => {
    expect(drill()?.name).toBe('Drives paralelos profundos')
  })

  it('el drill conserva su nombre anterior como alias', () => {
    expect(drill()?.aliases).toContain('Tiros paralelos profundos')
  })

  it('el buscador del catálogo encuentra el drill por su nombre anterior', () => {
    const results = searchCatalog('squash', 'Tiros paralelos profundos')
    expect(results.map((entry) => entry.libraryId)).toContain('drive_parallel_depth')
  })
})
```

- [ ] **Step 2: Correr el test y verificar el estado inicial**

Correr: `npx vitest run src/services/training/__tests__/squashDrillAliases.test.ts`

Esperado: **fallan los dos primeros** —el nombre sigue siendo "Tiros paralelos
profundos" y el campo `aliases` no existe—. **El tercero pasa**, y todavía no
significa nada: "Tiros paralelos profundos" es hoy el nombre canónico, así que ya
está en `searchText` por la vía normal. Se vuelve significativo recién después
del renombre, en el Step 6.

- [ ] **Step 3: Agregar el campo `aliases` a la interfaz**

En `src/services/training/drillLibrary.ts`, dentro de
`export interface SquashDrillDefinition`, después de `partnerRequired?: boolean`:

```ts
  /**
   * Nombres canónicos anteriores. Resuelven al drill y entran al índice de
   * búsqueda del catálogo del coach. Ver spec 2026-07-31 §6.
   */
  aliases?: string[]
```

- [ ] **Step 4: Consumir `aliases` en `findSquashDrillByName`**

En `findSquashDrillByName`, insertar el bloque **después** del `exactMatch` y
**antes** del matcher difuso por tokens:

```ts
  const aliasMatch = SQUASH_DRILL_LIBRARY.find((drill) =>
    (drill.aliases ?? []).some((alias) => normalizeSquashDrillKey(alias) === normalizedName),
  )
  if (aliasMatch) return aliasMatch
```

El orden es deliberado (spec §6): un nombre canónico vigente siempre gana sobre
el alias viejo de otro drill, y el alias siempre gana sobre la coincidencia
difusa. El mapa privado `DRILL_NAME_ALIASES` conserva su posición actual.

- [ ] **Step 5: Aplicar el primer renombre**

El renombre va **antes** de indexar los aliases en el buscador, a propósito: es
lo que pone en rojo al tercer test.

En la definición de `drive_parallel_depth`, cambiar `name` y agregar `aliases`:

```ts
    name: 'Drives paralelos profundos',
    aliases: ['Tiros paralelos profundos'],
```

- [ ] **Step 6: Correr el test y verificar que el buscador quedó rojo**

Correr: `npx vitest run src/services/training/__tests__/squashDrillAliases.test.ts`

Esperado: **los dos primeros pasan** y **el tercero falla**. Ese fallo es la
demostración de que el índice de búsqueda no conoce los aliases: el drill ya se
llama "Drives paralelos profundos" y su nombre anterior desapareció de
`searchText`. Sin este paso intermedio, el Step 7 se implementaría sin una prueba
que lo justifique.

- [ ] **Step 7: Indexar `aliases` en el buscador del catálogo**

En `src/services/training/coachExerciseCatalog.ts:72`, reemplazar:

```ts
  searchText: buildSearchText([drill.name, ...drill.tags, ...drill.focus]),
```

por:

```ts
  searchText: buildSearchText([drill.name, ...(drill.aliases ?? []), ...drill.tags, ...drill.focus]),
```

- [ ] **Step 8: Correr los tests y verificar que pasan**

Correr: `npx vitest run src/services/training/__tests__/squashDrillAliases.test.ts src/services/training/__tests__/squashDrillInvariants.test.ts`

Esperado: PASS los dos archivos. El snapshot **no** cambia: `drive_parallel_depth`
está en `RENAMED_IDS`, así que su `stableName` ya era `null`.

---

### Task 3: Los 13 renombres restantes

**Files:**
- Modify: `src/services/training/drillLibrary.ts` (13 definiciones)
- Modify: `src/services/training/__tests__/squashDrillAliases.test.ts`

**Interfaces:**
- Consumes: `aliases` de la Tarea 2.

- [ ] **Step 1: Escribir el test de los 14 pares**

Reemplazar el contenido de `src/services/training/__tests__/squashDrillAliases.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { findSquashDrillByName, SQUASH_DRILL_LIBRARY } from '../drillLibrary'
import { searchCatalog } from '../coachExerciseCatalog'

/** [id, nombre anterior, nombre nuevo] — spec 2026-07-31 §3. */
const RENAMES: Array<[string, string, string]> = [
  ['drive_parallel_depth', 'Tiros paralelos profundos', 'Drives paralelos profundos'],
  ['drive_crosscourt_length', 'Tiros cruzados profundos', 'Drives cruzados profundos'],
  ['drive_switch_parallel_cross', 'Cambio de paralelo a cruzado', 'Alternar drive paralelo y cruzado'],
  ['boast_to_straight_drive', 'Boast y drive paralelo de salida', 'Boast y salida con drive paralelo'],
  ['solo_100_drops', '100 drops en solitario (50 por lado)', 'Drops en solitario — 100 (50 por lado)'],
  ['solo_100_mid_court_shots', '100 drives desde media cancha', 'Drives desde media cancha — 100'],
  ['solo_100_service_box', '100 drives al cuadro de saque', 'Drives al cuadro de saque — 100'],
  ['solo_100_parallels_back', '100 drives paralelos desde el fondo', 'Drives paralelos desde el fondo — 100'],
  ['pressure_three_quarters_court', 'Ataque desde tres cuartos de cancha', 'Ataque antes del fondo'],
  ['conditioned_boast_start', 'Punto que inicia con pared lateral', 'Juego condicionado: el punto abre con boast'],
  ['rsa_short_bursts', 'RSA – sprints repetidos de 10-15 segundos', 'Series cortas de velocidad en cancha (10-15 s)'],
  ['continuous_squash_movement_base', 'Movimiento continuo de base aeróbica', 'Movimiento continuo en cancha a ritmo sostenido'],
  ['extensive_aerobic_movement_intervals', 'Intervalos aeróbicos en cancha', 'Intervalos largos de movimiento en cancha'],
  ['technical_recovery_length', 'Largo controlado de baja carga', 'Peloteo profundo suave de recuperación'],
]

/** Nombres de partido congelados por estar hardcodeados en cinco consumidores (spec §5). */
const FROZEN_MATCH_NAMES: Array<[string, string]> = [
  ['match_sim_points_short_sets', 'Game a 11 con marcador real'],
  ['practice_match_five_games', 'Partido de entrenamiento al mejor de 5 juegos'],
  ['practice_match_best_of_3', 'Partido de entrenamiento al mejor de 3 juegos'],
]

describe('renombres y aliases', () => {
  it.each(RENAMES)('%s adopta su nombre nuevo', (id, _previous, next) => {
    expect(SQUASH_DRILL_LIBRARY.find((drill) => drill.id === id)?.name).toBe(next)
  })

  it.each(RENAMES)('%s conserva su nombre anterior como alias', (id, previous) => {
    expect(SQUASH_DRILL_LIBRARY.find((drill) => drill.id === id)?.aliases).toContain(previous)
  })

  it.each(RENAMES)('%s resuelve por su nombre anterior', (id, previous) => {
    expect(findSquashDrillByName(previous)?.id).toBe(id)
  })

  it.each(RENAMES)('%s aparece en el buscador por su nombre anterior', (id, previous) => {
    expect(searchCatalog('squash', previous).map((entry) => entry.libraryId)).toContain(id)
  })

  it.each(FROZEN_MATCH_NAMES)('%s mantiene su nombre congelado', (id, name) => {
    expect(SQUASH_DRILL_LIBRARY.find((drill) => drill.id === id)?.name).toBe(name)
  })

  it('solo 14 drills tienen aliases', () => {
    expect(SQUASH_DRILL_LIBRARY.filter((drill) => (drill.aliases ?? []).length > 0)).toHaveLength(14)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Correr: `npx vitest run src/services/training/__tests__/squashDrillAliases.test.ts`

Esperado: FAIL en los 13 renombres pendientes. `drive_parallel_depth` ya pasa
desde la Tarea 2, y los tres nombres de partido también.

- [ ] **Step 3: Aplicar los 13 renombres**

En `src/services/training/drillLibrary.ts`, para cada uno de los 13 ids restantes,
cambiar `name` al nombre nuevo y agregar `aliases` con el anterior. Ejemplo del
patrón sobre `rsa_short_bursts`:

```ts
    name: 'Series cortas de velocidad en cancha (10-15 s)',
    aliases: ['RSA – sprints repetidos de 10-15 segundos'],
```

Los 14 pares exactos están en la constante `RENAMES` del Step 1. Copiar de ahí,
respetando el guion largo `—` de los nombres nuevos y el guion corto `–` del
nombre viejo de `rsa_short_bursts`.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Correr: `npx vitest run src/services/training/__tests__/squashDrillAliases.test.ts src/services/training/__tests__/squashDrillInvariants.test.ts`

Esperado: PASS. El snapshot sigue sin cambiar.

---

### Task 4: Las 21 descripciones

**Files:**
- Modify: `src/services/training/drillLibrary.ts` (21 `description`)
- Create: `src/services/training/__tests__/squashDrillCopyParity.test.ts`

**Interfaces:**
- Consumes: `SQUASH_DRILL_LIBRARY` de `../drillLibrary`, y la spec como fuente de
  verdad del copy.

- [ ] **Step 1: Escribir el guard de paridad con la spec**

El copy no se duplica en el plan ni en el test: el guard **lee la tabla §3bis de
la spec** y compara por `id`. Así no puede haber deriva entre lo aprobado y lo
implementado.

Crear `src/services/training/__tests__/squashDrillCopyParity.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { SQUASH_DRILL_LIBRARY } from '../drillLibrary'

const SPEC_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/superpowers/specs/2026-07-31-squash-drill-copy-design.md',
)

/**
 * Lee la tabla de §3bis. La spec es la fuente de verdad del copy aprobado;
 * duplicarlo acá crearía exactamente la deriva que este guard existe para
 * impedir.
 */
function readSpecDescriptions(): Map<string, string> {
  const spec = readFileSync(SPEC_PATH, 'utf8')
  const section = spec.split('## 3bis')[1]?.split('`match_sim_points_short_sets` aparece')[0]
  if (!section) throw new Error(`No se encontró la sección §3bis en ${SPEC_PATH}`)

  const entries = new Map<string, string>()
  for (const line of section.split('\n')) {
    if (!line.startsWith('| `')) continue
    const cells = line.split('|')
    // 4 celdas por el pipe inicial y el final. Si alguna descripción llegara a
    // contener un `|`, el parseo sería silenciosamente incorrecto.
    if (cells.length !== 4) throw new Error(`Fila mal formada en §3bis: ${line.slice(0, 60)}`)
    entries.set(cells[1]!.trim().replace(/`/g, ''), cells[2]!.trim())
  }
  return entries
}

describe('paridad de copy con la spec §3bis', () => {
  const specDescriptions = readSpecDescriptions()

  it('la spec declara exactamente 21 descripciones', () => {
    expect(specDescriptions.size).toBe(21)
  })

  it.each([...specDescriptions.entries()])(
    '%s tiene la descripción aprobada, carácter por carácter',
    (id, expected) => {
      const drill = SQUASH_DRILL_LIBRARY.find((item) => item.id === id)
      expect(drill, `la spec nombra un id inexistente: ${id}`).toBeDefined()
      expect(drill?.description).toBe(expected)
    },
  )
})
```

- [ ] **Step 2: Correr el guard y verificar que falla**

Correr: `npx vitest run src/services/training/__tests__/squashDrillCopyParity.test.ts`

Esperado: el primer caso PASA (la spec ya tiene sus 21 filas) y **fallan los 21
restantes**, porque ninguna descripción está aplicada todavía.

- [ ] **Step 3: Leer el copy autoritativo**

El texto exacto vive en la spec §3bis y es la fuente de verdad; no está duplicado
acá para que no puedan divergir.

Correr:

```bash
sed -n '/^## 3bis/,/^`match_sim_points_short_sets` aparece/p' \
  docs/superpowers/specs/2026-07-31-squash-drill-copy-design.md
```

Y para confirmar el conteo:

```bash
sed -n '/^## 3bis/,/^`match_sim_points_short_sets` aparece/p' \
  docs/superpowers/specs/2026-07-31-squash-drill-copy-design.md | grep -c '^| `'
```

Esperado: `21`.

- [ ] **Step 4: Aplicar las 21 descripciones**

Reemplazar el `description` de cada uno de esos 21 ids por el texto de la tabla,
literalmente. Los 22 restantes no se tocan.

Dos detalles del copy: usa rayas `—` para los incisos, y
`match_sim_points_short_sets` empieza con "Disputa", no con "Juega".

- [ ] **Step 5: Correr los tres guards**

Correr: `npx vitest run src/services/training/__tests__/squashDrillCopyParity.test.ts src/services/training/__tests__/drillLibrarySchema.test.ts src/services/training/__tests__/squashDrillInvariants.test.ts`

Esperado: PASS los tres. Cada uno cubre una cosa distinta:

- **paridad** — las 21 descripciones nuevas son exactamente las aprobadas en la
  spec.
- **schema** — las 43 siguen teniendo `Objetivo:`, `Clave:` y ≥ 120 caracteres.
- **invariantes** — vía `stableDescription`, las **22 no listadas quedaron
  intactas**: si al editar se tocó una de más, el snapshot falla acá.

Si el guard de paridad falla por un carácter, revisar rayas `—` contra guiones
`-`, comillas y espacios dobles. El mensaje de vitest muestra el diff exacto.

---

### Task 5: Guards de contenido y de colisión de nombres

**Files:**
- Create: `src/services/training/__tests__/squashDrillCopy.test.ts`

**Interfaces:**
- Consumes: `SQUASH_DRILL_LIBRARY` y `findSquashDrillByName` de `../drillLibrary`.

- [ ] **Step 1: Escribir los guards**

Crear `src/services/training/__tests__/squashDrillCopy.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { findSquashDrillByName, SQUASH_DRILL_LIBRARY } from '../drillLibrary'

/**
 * Términos que se glosan en el primer uso, con el fragmento que prueba la
 * glosa. Spec 2026-07-31 §2.
 */
const GLOSSES: Array<{ term: string; pattern: RegExp; proof: string; exemptIds: string[] }> = [
  { term: 'boast', pattern: /\bboasts?\b/i, proof: 'pared lateral', exemptIds: [] },
  // El plural importa: `solo_100_drops` y `mid_court_drops` solo dicen "drops".
  { term: 'drop', pattern: /\bdrops?\b/i, proof: 'pared frontal', exemptIds: [] },
  { term: 'nick', pattern: /\bnicks?\b/i, proof: 'unión baja', exemptIds: [] },
  { term: 'tin', pattern: /\btin\b/i, proof: 'placa metálica', exemptIds: [] },
  { term: 'ghosting', pattern: /\bghosting\b/i, proof: 'sin pelota', exemptIds: [] },
  { term: 'split-step', pattern: /\bsplit-steps?\b/i, proof: 'salto de ajuste', exemptIds: [] },
  // La mención de `lob` en el consejo final de este drill es incidental: el
  // drill entrena el boast, y glosar los dos vuelve la descripción ilegible.
  // Exención deliberada, spec §2 "Alcance de la glosa".
  { term: 'lob', pattern: /\blobs?\b/i, proof: 'alta y profunda', exemptIds: ['attacking_boast_from_back_court'] },
]

describe('reglas de copy de la librería de squash', () => {
  it('ningún texto de usuario usa RSA, chapa ni game', () => {
    const offenders: string[] = []
    for (const drill of SQUASH_DRILL_LIBRARY) {
      // Única excepción de la spec §5: el nombre —no la descripción— de este
      // drill, porque está hardcodeado en cinco consumidores.
      const texts: Array<[string, string]> = [['description', drill.description]]
      if (drill.id !== 'match_sim_points_short_sets') texts.push(['name', drill.name])

      for (const [field, text] of texts) {
        if (/\bRSA\b/.test(text) || /\bchapas?\b/i.test(text) || /\bgames?\b/i.test(text)) {
          offenders.push(`${drill.id}.${field}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('la descripción del game a 11 sí cumple la regla', () => {
    const drill = SQUASH_DRILL_LIBRARY.find((item) => item.id === 'match_sim_points_short_sets')
    expect(drill?.name).toBe('Game a 11 con marcador real')
    expect(drill?.description).not.toMatch(/\bgames?\b/i)
  })

  it.each(GLOSSES)('glosa $term en el primer uso', ({ pattern, proof, exemptIds }) => {
    const missing = SQUASH_DRILL_LIBRARY
      .filter((drill) => !exemptIds.includes(drill.id))
      .filter((drill) => pattern.test(drill.description))
      .filter((drill) => !drill.description.includes(proof))
      .map((drill) => drill.id)
    expect(missing).toEqual([])
  })

  it('la T es femenino en todo texto de usuario', () => {
    const offenders = SQUASH_DRILL_LIBRARY
      .filter((drill) => /\bel T\b/.test(`${drill.name} ${drill.description}`))
      .map((drill) => drill.id)
    expect(offenders).toEqual([])
  })

  it('el tag rsa sobrevive aunque el nombre pierda la sigla', () => {
    const drill = SQUASH_DRILL_LIBRARY.find((item) => item.id === 'rsa_short_bursts')
    expect(drill?.tags).toContain('rsa')
    expect(drill?.name).not.toMatch(/\bRSA\b/)
  })

  it('cada nombre canónico resuelve a su propio drill', () => {
    // Detecta colisiones por cualquiera de los dos caminos: el mapa privado
    // DRILL_NAME_ALIASES —46 claves, consultado ANTES de la coincidencia
    // exacta— y los `aliases` nuevos de cada definición.
    const offenders = SQUASH_DRILL_LIBRARY
      .filter((drill) => findSquashDrillByName(drill.name)?.id !== drill.id)
      .map((drill) => `${drill.id} → ${findSquashDrillByName(drill.name)?.id ?? 'sin resolver'}`)
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Correr los guards**

Correr: `npx vitest run src/services/training/__tests__/squashDrillCopy.test.ts`

Esperado: PASS todos.

Si falla el guard de glosas en un drill que **no** está en `exemptIds`, es un
hueco real de copy: agregar la glosa a esa descripción, no ampliar la exención.

Si falla el último caso, un nombre nuevo colisiona con una clave de
`DRILL_NAME_ALIASES` o con el alias de otro drill. Se arregla cambiando el nombre
nuevo, nunca borrando la clave vieja: esa clave existe para resolver datos
históricos.

---

### Task 6: Estabilidad de firma por comportamiento público

Prueba que una semana escrita con nombres viejos y la misma semana con nombres
nuevos toman las mismas decisiones, en los **dos** consumidores que la spec §7
nombra: el repair del Plan Builder y el validador del Week Creator.

Los escenarios están elegidos para que la comparación no sea vacua: una semana
con una sola sesión y sin duplicados no activa deduplicación, así que comparar
contadores en cero contra cero no probaría nada. Cada caso usa **dos sesiones con
la misma firma**, que es lo que dispara la corrección.

**No es igualdad profunda:** el repair no reescribe un `drill.name` que ya
resuelve, así que los nombres viejos siguen siendo viejos y comparar las
estructuras completas fallaría por diseño.

**Files:**
- Create: `src/services/planBuilder/__tests__/squashDrillRenameStability.test.ts`

**Interfaces:**
- Consumes: `repairGeneratedWeek` de `../repairWeek`,
  `validateWeekCreatorResponse` de `../../weekCreator/validateWeekCreatorResponse`,
  `buildRepairContextForTest` y `buildSkeletonSessionForTest` de
  `./helpers/repairTestFixtures`.

- [ ] **Step 1: Escribir el test**

Crear `src/services/planBuilder/__tests__/squashDrillRenameStability.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import type { CoachSessionProposal } from '../../../types'
import { findSquashDrillByName } from '../../training/drillLibrary'
import { validateWeekCreatorResponse } from '../../weekCreator/validateWeekCreatorResponse'
import { repairGeneratedWeek } from '../repairWeek'
import { buildRepairContextForTest, buildSkeletonSessionForTest } from './helpers/repairTestFixtures'

const OLD_NAMES = [
  'Tiros paralelos profundos',
  'Tiros cruzados profundos',
  '100 drives desde media cancha',
  'Largo controlado de baja carga',
]

const NEW_NAMES = [
  'Drives paralelos profundos',
  'Drives cruzados profundos',
  'Drives desde media cancha — 100',
  'Peloteo profundo suave de recuperación',
]

function squashSession(date: string, names: string[]): CoachSessionProposal {
  return buildSkeletonSessionForTest({
    date,
    timeBlock: 'AM',
    sessionType: 'squash',
    subtype: 'training',
    title: 'Squash técnico',
    objective: 'Construir largo y control con ejecución limpia.',
    durationMin: 60,
    rpe: 6,
    squashDetails: {
      trainingFocus: 'technical',
      sessionMode: 'drill_session',
      sessionKind: 'technical',
      drills: names.map((name) => ({ name, durationMin: 15 })),
    },
  })
}

/** Dos sesiones con la misma firma: dispara la corrección por duplicado. */
function duplicateWeek(names: string[]): CoachSessionProposal[] {
  return [squashSession('2026-08-03', names), squashSession('2026-08-05', names)]
}

/** Misma normalización por id que usan las firmas de repair y Week Creator. */
function idsOf(session: CoachSessionProposal | undefined): string[] {
  return (session?.squashDetails?.drills ?? [])
    .map((drill) => findSquashDrillByName(drill.name)?.id ?? drill.name)
}

describe('estabilidad ante el renombre de drills', () => {
  it('los nombres viejos y los nuevos resuelven a los mismos ids', () => {
    expect(OLD_NAMES.map((name) => findSquashDrillByName(name)?.id))
      .toEqual(NEW_NAMES.map((name) => findSquashDrillByName(name)?.id))
  })

  it('el repair toma las mismas decisiones de deduplicación', () => {
    const context = () => buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 2 })
    const withOld = repairGeneratedWeek(duplicateWeek(OLD_NAMES), context())
    const withNew = repairGeneratedWeek(duplicateWeek(NEW_NAMES), context())

    expect(withOld.failure?.errorClass).toBe(withNew.failure?.errorClass)
    expect(withOld.sessions).toHaveLength(withNew.sessions.length)

    // La corrección por firma duplicada efectivamente se activó: sin esto la
    // comparación de abajo sería vacua.
    expect(withOld.meta.warnings.map((warning) => warning.code))
      .toContain('squash_duplicate_drills_repaired')

    // Mismas decisiones, sesión por sesión, normalizadas por id.
    expect(withOld.sessions.map(idsOf)).toEqual(withNew.sessions.map(idsOf))
    expect(withOld.meta.repairedSessionCount).toBe(withNew.meta.repairedSessionCount)
    expect(withOld.meta.warnings.map((warning) => warning.code))
      .toEqual(withNew.meta.warnings.map((warning) => warning.code))
  })

  it('el repair no reescribe un nombre viejo que ya resuelve', () => {
    const repaired = repairGeneratedWeek(
      [squashSession('2026-08-03', OLD_NAMES)],
      buildRepairContextForTest({ primarySport: 'squash', sessionsPerWeek: 1 }),
    )
    const names = (repaired.sessions[0]?.squashDetails?.drills ?? []).map((drill) => drill.name)
    expect(names).toContain('Tiros paralelos profundos')
  })

  it('el validador del Week Creator detecta el duplicado igual con nombres viejos y nuevos', () => {
    const validate = (names: string[]) => validateWeekCreatorResponse({
      targetWeekStart: '2026-08-03',
      context: { recentSessions: [], plannedSessions: [], historicalSessions: [] },
      config: {
        allowedSports: ['squash'],
        primarySport: 'squash',
        sessionsPerWeek: 2,
        maxSessionsPerWeek: 2,
        sessionDurationMins: 60,
        trainingDays: ['monday', 'wednesday'],
        allowDoubleSession: false,
        currentFitnessLevel: 'normal',
        currentFatigue: 'normal',
        fromWizard: true,
        configSource: 'wizard',
      },
      response: {
        message: 'Semana lista',
        provider: 'test',
        timestamp: 0,
        traceId: 'rename-stability',
        requestClass: 'week_creator',
        actions: [{
          type: 'create_week',
          reason: 'Dos sesiones con la misma firma',
          targetDate: '2026-08-03',
          sessions: duplicateWeek(names),
        }],
      },
    })

    const withOld = validate(OLD_NAMES)
    const withNew = validate(NEW_NAMES)

    expect(withOld.ok).toBe(false)
    expect(withOld.code).toBe('duplicate_squash_content')
    expect(withNew.code).toBe(withOld.code)
    expect(withNew.ok).toBe(withOld.ok)
  })
})
```

- [ ] **Step 2: Correr el test**

Correr: `npx vitest run src/services/planBuilder/__tests__/squashDrillRenameStability.test.ts`

Esperado: PASS.

Tres lecturas de un fallo, según el caso:

- Si falla el aserto de `squash_duplicate_drills_repaired`, el fixture dejó de
  disparar la corrección y el resto de la comparación quedó vacía. Ajustar el
  fixture hasta que la dispare **antes** de confiar en los demás asertos.
- Si falla el tercer caso, algún paso del repair sí reescribe nombres que ya
  resuelven. No es un bug de esta entrega, pero invalida la premisa de la spec §6
  sobre datos históricos: anotarlo y consultar antes de seguir.
- Si falla el cuarto, `buildSquashDrillSignature` de
  `validateWeekCreatorResponse.ts:273` no está resolviendo por id: falta un alias.

---

### Task 7: Verificación completa

**Files:** ninguno. Solo verificación.

- [ ] **Step 1: Suite completa**

Correr: `npm test`

Esperado: PASS. La suite pasa de 324 archivos / 2425 tests a **329 archivos** con
los cinco archivos de test nuevos.

Si falla algún test preexistente que compare nombres de drills literalmente,
revisarlo caso por caso: si afirmaba el nombre viejo como texto de UI,
actualizarlo al nuevo; si lo usaba solo para resolver el drill, debería seguir
pasando por los aliases, y si no pasa, el alias falta.

- [ ] **Step 2: Lint**

Correr: `npm run lint`

Esperado: sin salida.

- [ ] **Step 3: Build**

Correr: `npm run build`

Esperado: `✓ built in …` y `Generated metadata for 8 public routes`.

- [ ] **Step 4: Higiene del diff**

Correr: `git diff --check`

Esperado: sin salida (ni espacios en blanco al final ni marcadores de conflicto).

- [ ] **Step 5: Confirmar que el snapshot es nuevo, no modificado**

Correr: `git status --short src/services/training/__tests__/__snapshots__/`

Esperado: el snapshot aparece como **archivo nuevo** (`??`), nunca como
modificado (` M`). Si aparece modificado, alguien corrió `vitest -u` y el guard
perdió su valor: hay que restaurarlo y volver a correr la Tarea 1 Step 3.

- [ ] **Step 6: Revisión manual del diff**

Correr: `git diff src/services/training/`

Leer el diff completo. Toda línea cambiada en `drillLibrary.ts` debe ser un
`name:`, un `description:`, un `aliases:`, el bloque `aliasMatch` de la Tarea 2
Step 4 o el campo nuevo de la interfaz. En `coachExerciseCatalog.ts` debe haber
exactamente una línea cambiada, la de `searchText`.

El guard automático de que nada más se movió es el snapshot de la Tarea 1; esta
lectura es la verificación humana que lo acompaña.

---

## Entrega

El owner hace **un solo commit intencional** con la spec, este plan y el código.
Este plan no ejecuta `git add` ni `git commit`.

Archivos que entran en el commit:
- `docs/superpowers/specs/2026-07-31-squash-drill-copy-design.md`
- `docs/superpowers/plans/2026-07-31-squash-drill-copy.md`
- `src/services/training/drillLibrary.ts`
- `src/services/training/coachExerciseCatalog.ts`
- `src/services/training/__tests__/squashDrillInvariants.test.ts`
- `src/services/training/__tests__/__snapshots__/squashDrillInvariants.json`
- `src/services/training/__tests__/squashDrillAliases.test.ts`
- `src/services/training/__tests__/squashDrillCopyParity.test.ts`
- `src/services/training/__tests__/squashDrillCopy.test.ts`
- `src/services/planBuilder/__tests__/squashDrillRenameStability.test.ts`

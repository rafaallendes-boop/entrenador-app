# Librería de fuerza — copy por `id` — Plan de implementación

**Spec:** `docs/superpowers/specs/2026-08-01-strength-exercise-copy-design.md`

**Estado:** pendiente aprobación editorial del spec.

**Goal:** mejorar nombres y descripciones de la librería de fuerza sin cambiar
selección, prescripción, estructura, roles ni calidad, y sin dejar productores
deterministas con copy duplicado.

**Base de trabajo:** el working tree posterior a la Entrega 4
`libraryRef`-first. No usar `git stash`; spec, plan y código de esa entrega aún
no están commiteados.

## Restricciones globales

- Solo cambian `name`, `description` y `aliases` de los ids enumerados en el
  spec.
- Los 12 nombres anteriores se agregan como aliases del mismo id.
- El selector y todos los contratos se comparan por id, nunca por copy.
- Sin backfill, migraciones, dependencias ni cambios de prompt global.
- Los commits los hace el owner: no ejecutar `git add` ni `git commit`.
- No actualizar snapshots después de editar el catálogo. Si fallan, revisar el
  cambio que salió de alcance.

## Archivos previstos

| Archivo | Acción |
|---|---|
| `src/services/training/exerciseLibrary.ts` | nombres, descripciones, aliases y helper de identidad por id |
| `src/services/training/strengthSessionStructure.ts` | retirar cuatro nombres canónicos duplicados |
| `src/services/weekCreator/WeekCreatorEngine.ts` | construir los 13 fallbacks de fuerza por id |
| `src/services/training/__tests__/strengthExerciseCopyInvariants.test.ts` | guard de campos no editables y texto fuera de alcance |
| `src/services/training/__tests__/__snapshots__/strengthExerciseCopyInvariants.json` | baseline pre-copy |
| `src/services/training/__tests__/strengthExerciseCopy.test.ts` | copy exacto, aliases, colisiones y vocabulario |
| `src/services/training/__tests__/strengthCopyProducerIdentity.test.ts` | productores por id y refs |
| tests existentes con copy literal | actualizar solo expectativas de nombres renombrados |
| `CLAUDE.md`, `PROJECT_REVIEW_AND_ROADMAP.md` | estado y medición final |

---

## Task 1 — Congelar el catálogo antes de editar

### 1.1 Test de invariantes

Crear `strengthExerciseCopyInvariants.test.ts` con dos sets literales:

```ts
export const RENAMED_STRENGTH_IDS = new Set([
  'air_treadmill_20_20',
  'copenhagen_side_plank',
  'dead_bug',
  'half_kneeling_diagonal_plate_chop',
  'half_kneeling_lateral_jump',
  'half_kneeling_row',
  'ladder_bipodal_front_2',
  'ladder_bipodal_lateral_3',
  'landmine_press',
  'overhead_press',
  'push_press',
  'split_squat',
])
```

El segundo set contiene los 31 ids de la tabla §5 del spec.

Para cada definición, serializar y ordenar por id:

```ts
{
  id,
  category,
  movement,
  intensityType,
  equipment,
  unilateral,
  tags,
  difficulty,
  sportsTransfer,
  squashTransfer,
  riskLevel,
  fatigueCost,
  loadReference,
  prescriptionUnit,
  appropriateForPhases,
  blockRotationGroup,
  stableName: RENAMED_STRENGTH_IDS.has(id) ? null : name,
  stableDescription: REWRITTEN_DESCRIPTION_IDS.has(id) ? null : description,
}
```

Asserts obligatorios:

- 77 filas;
- 12 `stableName: null` y 65 congelados;
- 31 `stableDescription: null` y 46 congelados;
- snapshot generado con `toMatchFileSnapshot` antes de tocar copy.

Generar además, antes de cualquier edición, los archivos temporales de salida
del barrido de Task 5 (`.tmp-strength-copy-base-*.txt`). Son la base pareada del
working tree actual y evitan necesitar un commit o un stash para reconstruirla.

### 1.2 Verificación

```bash
npx vitest run src/services/training/__tests__/strengthExerciseCopyInvariants.test.ts
```

Debe pasar. Desde este punto está prohibido regenerar el snapshot.

---

## Task 2 — Retirar copy duplicado de los productores

### 2.1 Helper único por id

En `exerciseLibrary.ts`, agregar:

```ts
export function getStrengthExerciseIdentityById(id: string): {
  name: string
  libraryRef: ExerciseLibraryRef
} {
  const definition = getExerciseById(id)
  if (!definition) throw new Error(`Ejercicio de fuerza inexistente: ${id}`)
  return {
    name: definition.name,
    libraryRef: { source: 'strength_exercise', id: definition.id },
  }
}
```

El throw es deliberado: todos los call sites usan ids de código y el gate de
permanencia impide que desaparezcan en silencio.

### 2.2 Estructura de sesión

En `strengthSessionStructure.ts`:

- `makeCoreExercise` recibe solo el id y toma `name`/`libraryRef` del helper;
- las tres filas de footwork toman la identidad de:
  `ladder_bipodal_lateral_1`, `ladder_bipodal_front_2` y
  `ladder_coordinativo_front_4`;
- no queda ninguno de esos cuatro nombres como literal productivo.

### 2.3 Fallback del Week Creator

Crear un helper local:

```ts
function fallbackStrengthExercise(
  id: string,
  prescription: Omit<CoachExerciseProposal, 'name' | 'libraryRef'>,
): CoachExerciseProposal {
  return { ...getStrengthExerciseIdentityById(id), ...prescription }
}
```

Reemplazar las 14 filas literales —13 ids únicos— de las dos variantes por ids.
Los sets, reps y grupos permanecen idénticos.

### 2.4 Tests

Crear `strengthCopyProducerIdentity.test.ts`:

- el core inyectado usa `dead_bug` y el nombre canónico actual;
- las tres escaleras usan sus ids y nombres canónicos;
- el fallback local del Week Creator estampa refs vivos en todos sus ejercicios;
- la firma de prescripción del fallback excluye `libraryRef` y se conserva por
  snapshot antes/después de migrar el productor.

Verificar:

```bash
npx vitest run \
  src/services/training/__tests__/strengthCopyProducerIdentity.test.ts \
  src/services/weekCreator/__tests__/WeekCreatorEngine.test.ts \
  src/services/__tests__/strengthSessionStructure.test.ts
npx tsc --noEmit
```

---

## Task 3 — Aplicar los 12 renombres y aliases

### 3.1 Test rojo de tabla exacta

En `strengthExerciseCopy.test.ts`, declarar una tabla literal
`RENAMES: Record<string, { previous: string; next: string }>` copiada del spec.

Por fila:

```ts
expect(definition.name).toBe(next)
expect(definition.aliases).toContain(previous)
expect(findStrengthExerciseByName(previous)?.id).toBe(id)
expect(findStrengthExerciseByName(next)?.id).toBe(id)
expect(searchCatalog('strength', previous)).toContainEqual(
  expect.objectContaining({ libraryId: id }),
)
```

Agregar:

- exactamente 12 ids renombrados;
- ningún nombre o alias normalizado pertenece a dos ids;
- los 77 nombres canónicos resuelven a su propio id.

### 3.2 Edición

Aplicar literalmente la tabla §4 del spec en `exerciseLibrary.ts`. Preservar
aliases existentes y agregar el nombre anterior una sola vez.

### 3.3 Expectativas literales

Actualizar únicamente tests que afirmen el copy visible de uno de los 12 ids.
No cambiar snapshots por id ni expectativas de comportamiento.

Verificar:

```bash
npx vitest run \
  src/services/training/__tests__/strengthExerciseCopy.test.ts \
  src/services/training/__tests__/strengthNameResolution.test.ts \
  src/services/training/__tests__/coachExerciseCatalog.test.ts \
  src/services/__tests__/strengthSelector.test.ts
```

---

## Task 4 — Aplicar las 31 descripciones

### 4.1 Paridad exacta

En `strengthExerciseCopy.test.ts`, declarar `FINAL_DESCRIPTIONS` con las 31
filas del spec §5 y exigir igualdad exacta por id.

### 4.2 Guard de lenguaje

Sobre `name + description` —nunca sobre aliases ni tags internos— comprobar:

```ts
const bannedDescriptionTerms = [
  /\bstance\b/i,
  /\bsetup\b/i,
  /\btracking\b/i,
  /\bbracing\b/i,
  /\bsnap\b/i,
  /cachad/i,
  /\brepeat sprint\b/i,
  /\breps\b/i,
  /\boverhead\b/i,
  /\blunge\b/i,
  /\bfootwork\b/i,
  /\bstep-up\b/i,
]
```

El test también congela que los 46 ids restantes mantienen su descripción del
snapshot de Task 1.

### 4.3 Edición y verificación

Aplicar literalmente la tabla §5 y correr:

```bash
npx vitest run \
  src/services/training/__tests__/strengthExerciseCopyInvariants.test.ts \
  src/services/training/__tests__/strengthExerciseCopy.test.ts \
  src/services/__tests__/strengthSelector.test.ts
```

---

## Task 5 — Estabilidad deportiva y barrido pareado

### 5.1 Contratos existentes

Estos archivos deben pasar sin actualizar snapshots:

```bash
npx vitest run \
  src/services/training/__tests__/strengthBehaviorContract.test.ts \
  src/services/training/__tests__/strengthSelectionFixtures.test.ts \
  src/services/training/__tests__/strengthCatalogIdPermanence.test.ts \
  src/services/training/__tests__/strengthFreeNameLoadMatrix.test.ts \
  src/services/planBuilder/__tests__/strengthRoleContractLibraryRef.test.ts \
  src/services/__tests__/qualityReview.test.ts
```

Si un snapshot por id cambia, es regresión; no regenerarlo.

### 5.2 Barrido base/nuevo

Comparar contra los archivos `.tmp-strength-copy-base-*.txt` generados en Task
1 sobre el working tree previo al copy. No usar `git stash` ni depender de que
la Entrega 4 esté commiteada.

Como Task 2 migra productores a identidad por id después de capturar esa base,
cualquier diferencia puede provenir de esa migración y debe clasificarse antes
de atribuirla a los cambios de copy.

El barrido cubre:

- 77 ids × reps 3/8/12;
- resolución por nombre anterior, nombre nuevo y ref;
- ambas ramas del selector;
- fallback del Week Creator.

Compara solamente:

```ts
{
  weight,
  targetPercent1RM,
  targetRpe,
  reps,
  group,
  warmupSets,
}
```

Expected: cero diferencias. `name`, `description`, `aliases` y `libraryRef` se
reportan aparte y no cuentan como prescripción.

Tras registrar el resultado, borrar los archivos `.tmp-strength-copy-*` con
`apply_patch` o moverlos a la Papelera; no forman parte de la entrega.

---

## Task 6 — Cierre y documentación

### 6.1 Gate completo

```bash
npx tsc -b
npm run lint
npm test
npm run build
git diff --check
```

### 6.2 Estado de proyecto

Actualizar `CLAUDE.md` y `PROJECT_REVIEW_AND_ROADMAP.md` con:

- 12 renombres / 31 descripciones;
- aliases legacy y productores por id;
- cero cambios de prescripción medidos;
- conteo final de tests;
- limitación: el texto ya persistido no se reescribe.

No ejecutar comandos de commit o staging.

---

## Decisión antes de ejecutar

La mecánica está cerrada; la única aprobación necesaria es editorial: revisar
las tablas §4 y §5 del spec. Una vez aprobadas, las seis tareas se pueden
ejecutar en esta sesión sin decisiones adicionales.

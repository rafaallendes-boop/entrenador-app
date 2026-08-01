# Fuerza — `libraryRef`-first

Fecha: 2026-08-01
Base: `3d480b3` (Entregas 1–3 del desacople del nombre, ya commiteadas)
Migraciones: ninguna, ni Dexie ni Supabase

## 1. Qué resuelve y qué no

Las Entregas 1–3 sacaron el nombre visible de las decisiones de **carga**. Queda
un eslabón: la **identidad** del ejercicio sigue derivándose del texto. Hoy
`strengthSelector` construye un ejercicio *desde* una definición de biblioteca y
emite solo `name` (`strengthSelector.ts:1196`), y río abajo el pipeline
re-deduce el `id` a partir de ese texto.

Este bloque hace que el productor que ya conoce el `id` lo estampe, y que el
resolver lo prefiera.

**Lo que no resuelve, y hay que decirlo de frente.** Con estampado solo en
rutas deterministas, el ref existe únicamente en contenido creado **después** de
que esto salga. Todo lo ya guardado —sesiones del historial, plantillas de la
Biblioteca, planes vivos— sigue sin ref y sigue resolviendo por nombre. Un
renombre posterior le pega igual a ese contenido, y lo que lo protege no es
`libraryRef`: son los `aliases`, exactamente como en squash (`21af7f8`).

`libraryRef`-first hace que la deuda **deje de crecer**. No cura la existente.
La entrega de copy que viene después hereda la obligación de agregar cada
nombre viejo a `aliases`.

## 2. Decisiones tomadas

| Decisión | Resuelto |
|---|---|
| Alcance del estampado | Solo rutas deterministas: los tres productores del §4 (`buildSelectionExercise`, `makeCoreExercise`, expansión de footwork) más el picker del coach, que ya lo hace. El modelo sigue devolviendo nombres libres |
| `promptBuilder.ts` y contrato de la herramienta | **No se tocan.** Sin cambio de schema, sin mover `variant_id` ni la telemetría del plan builder |
| Nombre visible | Se lee siempre del campo guardado. Una sesión ya hecha no cambia de texto retroactivamente |
| Backfill | No. Ni migración ni escritura implícita sobre filas existentes |
| Contenido legacy | Cubierto por `aliases` al renombrar, no por este bloque |

## 3. Resolución

Un tier nuevo arriba de la escalera existente:

```
libraryRef vivo          → matchKind: 'ref'          ← nuevo
  → id o nombre canónico → 'exact'
    → alias exacto       → 'alias'
      → único substring  → 'substring'
        → varios         → 'ambiguous'
```

`resolveStrengthExerciseName(name)` pasa a `resolveStrengthExercise({ name, libraryRef })`.
Los tipos se renombran a `StrengthExerciseResolution` y
`StrengthExerciseMatchKind`: con `ref` ya no son exclusivamente resoluciones de
nombre. `resolveStrengthExerciseName(name)` se conserva como wrapper de
compatibilidad sobre `resolveStrengthExercise({ name })`.

Condiciones del tier:

- Exige `source: 'strength_exercise'`. Un ref de `squash_drill` se ignora.
- Exige `id` vivo en `STRENGTH_EXERCISE_LIBRARY`.
- `ref` entra a `isAuthoritativeResolution` junto a `exact` y `alias`, así que
  hereda las cuatro salvaguardas ya cerradas: sin regex de protocolo, unidad por
  `prescriptionUnit`, potencia por `intensityType`, tope y `%1RM` por metadata.

**El ref manda sobre el nombre, aunque el texto no coincida.** Es una decisión
válida porque el nombre pasa a ser exclusivamente copy y el `id` es la
identidad, pero puede mover carga y clasificación, así que va congelada por test
explícito y no queda implícita en la precedencia.

### Identidad para rotación y deduplicación

```ts
resolveStrengthExercise(exercise)?.definition?.id
  ?? normalizeStrengthExerciseKey(exercise.name)
```

Un fragmento `ambiguous` no tiene `definition`, así que cae al nombre
normalizado — mismo comportamiento que hoy. Las dos copias de
`getStrengthExerciseKey` (`actionPostProcessor.ts:941`, `repairWeek.ts:2357`) se
consolidan en una, y su firma se ensancha de `Pick<CoachExerciseProposal, 'name'>`
a incluir `libraryRef`.

## 4. Transporte y estampado

Dos campos opcionales, aditivos:

| Tipo | Estado |
|---|---|
| `Exercise` | ya lo tiene (`types/index.ts:202`) |
| `CoachExerciseProposal` | lo gana |
| `StrengthSelectionExercise` | lo gana |

`CoachExerciseProposal` viaja dentro de `CoachProposal.actions`, que se persiste
en Dexie y sincroniza. No es cambio de schema: es un campo opcional dentro de un
blob JSON que ya existe, misma clase que `libraryRef` sobre `Exercise`.

### Los tres productores deterministas

`buildSelectionExercise` no es el único código que crea ejercicios cuyo `id` ya
se conoce. Si no se estampan los tres, la afirmación "la deuda deja de crecer"
es falsa.

| Productor | Qué crea | Ref a estampar |
|---|---|---|
| `buildSelectionExercise` (`strengthSelector.ts:1196`) | toda la selección; es el constructor compartido — el reemplazo focalizado de rotación pasa por ahí a propósito (comentario en la línea 60) | el `id` de la definición seleccionada |
| `makeCoreExercise` (`strengthSessionStructure.ts:410`) | `'Control de tronco dead bug'`, nombre que existe en el catálogo (`exerciseLibrary.ts:452`) | `dead_bug`, fijo |
| `buildFootworkSeriesFromGenericBlock` (`strengthSessionStructure.ts:112`) | tres escaleras cuyos nombres son literalmente entradas del catálogo (`exerciseLibrary.ts:964`, `1012`, `1028`) | el `id` de cada escalera, uno por entrada |

**En la expansión de footwork el ref se reemplaza, no se hereda.** `base` se
construye como `{ ...exercise, … }` y propaga todos los campos del bloque
genérico. Sin una sobrescritura explícita, las tres escaleras heredarían el ref
del bloque original —que es otro ejercicio— y el tier `ref` prescribiría sobre
la definición equivocada con autoridad máxima. Es el único lugar del diseño
donde el ref puede hacer daño activo en vez de solo faltar.

**Cuándo se expande, entonces.** `isGenericFootworkBlock` pasa a ser
`ref`-aware en §6, y eso define la política completa:

| Ref del bloque | Efecto |
|---|---|
| Vivo | Identifica el ejercicio: **no** es genérico y **no** se expande |
| Muerto, de otra librería, o ausente | No identifica nada: sigue genérico, se expande, y cada escalera recibe su propio ref |

Las dos mitades se prueban por separado. Un test que le dé un ref **vivo** a un
bloque genérico y espere expansión sería contradictorio con §6 y va a romper en
cuanto ese consumidor migre.

El picker del coach (`SessionForm.tsx:218`) ya estampa y no se toca.

## 5. Consolidación de las seis conversiones

`StrengthSelectionExercise → CoachExerciseProposal` ocurre en **seis** lugares.
Solo dos son funciones con nombre; las otras cuatro son literales inline, que es
por qué un grep por `toCoachExerciseProposal` las pasa por alto:

| # | Sitio | Forma | `notes` | `targetPercent1RM` / `targetRpe` |
|---|---|---|---|---|
| 1 | `actionPostProcessor.ts:597` | literal inline | crudas | **no** |
| 2 | `actionPostProcessor.ts:828` | literal inline | crudas | **no** |
| 3 | `actionPostProcessor.ts:862` | literal inline | crudas | **no** |
| 4 | `repairWeek.ts:2230` | literal inline | crudas | sí |
| 5 | `repairWeek.ts:2333` | función | crudas | sí |
| 6 | `strengthPrompt.ts:113` | función | agrega `[intensity]` | **no** |

Entra al alcance porque es la superficie que hay que modificar: estampar el ref
obliga a tocar las seis, y omitir una deja esa ruta name-only en silencio.

**Requisito de cierre:** las seis pasan a usar el convertidor canónico, su
proyección pre-enrichment (1–3) o el envoltorio model-facing (6). Ningún literal
inline sobrevive. Un test enumera los sitios y falla si aparece una séptima
conversión ad-hoc.

Queda **un convertidor canónico** con la unión de campos, incluido `libraryRef`.
Encima, dos envoltorios explícitos:

- **Prompt** (`strengthPrompt.ts`): proyecta únicamente los campos model-facing
  y **excluye `libraryRef`**. No conviene enseñarle al modelo un campo que el
  normalizador después va a rechazar; sería contradicción de contrato.
- **Pre-enrichment** (`actionPostProcessor.ts`, conversiones 1–3): conserva
  `libraryRef`, pero excluye `targetPercent1RM` y `targetRpe`. Esas rutas pasan
  inmediatamente por `enhanceStrengthSessionExercises`; adelantar los targets
  del selector cambia la derivación histórica de peso y warmups.
- La anotación `[intensity]` es formato de prompt, no conversión: queda en ese
  mismo envoltorio.

## 6. Matriz de consumidores `libraryRef`-aware

Estampar sin migrar a los consumidores deja el ref decorativo. La regla es:

> **Todo consumidor que ya recibe `{ name, libraryRef? }` usa
> `resolveStrengthExercise`. Solo las APIs realmente string-only conservan el
> wrapper por nombre.**

Los seis que hoy resuelven por nombre teniendo el objeto a mano:

| Consumidor | Qué decide | Cambio |
|---|---|---|
| `resolveSessionStrengthRoles` (`strengthRoleContract.ts:31`) | roles y claves de rotación | su parámetro es literalmente `ReadonlyArray<{ name: string }>`: se ensancha a incluir `libraryRef?` |
| `getProfileStrengthCoverageIssues` (`qualityReview.ts:635`) | cobertura de 1RM en calidad | itera `session.exercises`, que llevan el ref |
| `extractRecentStrengthExercises` (`strengthSelector.ts:432`) | historial reciente para evitar repetición | lee `Session.exercises`; ya es id-first con fallback al nombre — misma identidad del §3 |
| `deriveStrengthProgressionState` (`strengthSelector.ts:1013`, resuelve en `:1029`) | frecuencia por patrón, `mainPattern`, `lastExerciseId` e intención de progresión | recorre `Session.exercises` completos. **No queda cubierto por el anterior**: uno produce claves de recencia, este calcula progresión. Además hace `if (!definition) return`, así que un nombre no resuelto se salta en silencio y degrada la intención |
| `isGenericFootworkBlock` / `isFoundationCore` (`strengthSessionStructure.ts:103`, `:420`) | expansión de footwork y core de fundación | reciben el ejercicio entero |
| `completeStrengthLoads` (`actionPostProcessor.ts:754`) | si un update del coach es de fuerza | recibe `CoachExerciseProposal`, que gana el ref |

**Caso aparte — `selectStrengthReplacement` (`strengthSelector.ts:356`).** Su
request expone `originalName: string`, así que es string-only *de verdad*. Pero
el llamador sí tiene el ejercicio, así que el arreglo correcto es ensanchar
`StrengthReplacementRequest` con un `originalRef?`, no envolver por nombre. Es
la única de las seis que cambia forma de API en vez de solo tipo de parámetro.

La cobertura de este bloque no se agota en campos de prescripción: tiene que
comprobar **roles, claves de rotación, cobertura de calidad, progresión y
reemplazo** resueltos por ref.

## 7. Fronteras

Las cuatro ya son allowlists campo por campo. La decisión es en cuál se agrega
la línea, explícitamente:

| Frontera | Decisión |
|---|---|
| `validateExerciseProposal` (respuesta del modelo, `responseNormalizer.ts:663`) | **No** gana la línea. Un ref emitido por la IA se descarta. Congelado por test, no por disciplina |
| `optionalExercises` (import de sesiones) | Ya lo sanitiza (`dataExport.ts:1379`) |
| `sessionTemplateSerializer` | Ya lo sanitiza |
| `optionalCoachExercises` (import de propuestas) | **Sí** gana la línea: `libraryRef: sanitizeExerciseLibraryRef(row.libraryRef)` |

Sobre la última: una propuesta `pending` puede exportarse, importarse y
aceptarse después. La aceptación usa directamente `action.exercises` y no puede
reconstruir un ref eliminado durante el import. Descartarlo ahí perdería el ref
justo en el camino que lo necesita.

La frontera segura resultante:

- **Respuesta del modelo:** descarta `libraryRef`.
- **Import de sesiones, plantillas y propuestas:** lo sanitiza y preserva.
- **Resolver:** exige `source: 'strength_exercise'` e `id` vivo.

## 8. Modos de fallo

Todos caen hacia el nombre, que es el camino legacy ya sancionado:

| Fallo | Efecto |
|---|---|
| `id` muerto (ejercicio retirado del catálogo) | Sigue la escalera por nombre. Un ref viejo no puede dejar peor al ejercicio que no tener ninguno |
| `source: 'squash_drill'` en un ejercicio de fuerza | Se ignora |
| Ref malformado | `sanitizeExerciseLibraryRef` lo descarta en el borde |
| Ref vivo que contradice al nombre | **Gana el ref** (§3), con test explícito |

**Un ref muerto no se limpia solo.** Los serializers preservan `libraryRef` al
guardar, así que reescribir la fila por cualquier otro motivo lo conserva. Queda
**inerte** —ignorado por el resolver, que sigue por nombre— hasta una edición
del nombre (`SessionForm.tsx:203` borra el ref al tipear encima) o una limpieza
explícita. No hay un momento en que "se arregle" por uso.

### Invariante del catálogo: los `id` son permanentes

Un `id` retirado de `STRENGTH_EXERCISE_LIBRARY` **nunca se reutiliza para otro
ejercicio.** Sin esta regla, un ref muerto que hoy es inerte podría quedar
retargeteado en silencio a un ejercicio distinto por una edición futura del
catálogo — y el tier `ref` lo prescribiría con autoridad máxima, sin ninguna
señal. Es la contrapartida obligatoria de "el ref le gana al nombre": el ref solo
es más confiable que el texto si el `id` significa siempre lo mismo.

**Cómo se comprueba, y qué alcanza a comprobar.** Congelar la lista de `id`
activos detecta altas y bajas, pero *no* demuestra que un `id` activo no haya
sido reasignado a otro ejercicio. Así que son dos piezas:

1. **La lista congelada funciona como gate de cambios**, no como prueba de
   identidad: cualquier alta o baja obliga a tocar el test a propósito, y esa
   edición es el momento de decidir si el `id` significa lo mismo.
2. **Un registro de `id` retirados**, cuya intersección con los activos debe ser
   vacía. Eso impide que un `id` eliminado reaparezca más adelante apuntando a
   otro ejercicio — que es el caso peligroso, porque los refs muertos de §8
   sobreviven en las filas y volverían a resolver.

Lo que ninguna de las dos cubre es un renombre semántico dentro del mismo `id`
sin tocar la lista. Eso queda a criterio de quien edita el catálogo, y por eso el
gate existe: para que esa edición nunca sea silenciosa.

## 9. Criterio de aceptación

**Cero cambios de prescripción.** La única diferencia esperada es la presencia
del metadata `libraryRef` en contenido nuevo.

Para que eso sea verificable y no una frase, el barrido compara **solo campos de
prescripción y clasificación** — `weight`, `targetPercent1RM`, `targetRpe`,
`reps`, `group`, `warmupSets` — y reporta `libraryRef` en una columna aparte.
Un diff que consista únicamente en el campo nuevo no es una diferencia; uno que
toque cualquier campo de prescripción sí lo es.

No se declara de antemano ninguna excepción de prescripción. `selectStrengthSession`
usa `buildSelectionExercise`, que **no** asigna `targetPercent1RM` ni
`targetRpe`; esos campos viven en `buildPrescribedExercise`, y `repairWeek` ya
los conserva. Si el barrido encuentra una diferencia real, se declara entonces,
con su medición — no antes.

**Resultado de implementación.** El primer `sweep-convert` detectó 47/92 filas
distintas: 31 en RPE, 27 en porcentaje, 24 en peso y 16 en cantidad de warmups.
No era una excepción de metadata: transportar targets antes del enriquecimiento
cambiaba prescripción. Se introdujo la proyección pre-enrichment del §5 y el
barrido final quedó en cero diferencias, sin excepción declarada.

### El barrido tiene que cubrir las dos ramas

`selectStrengthSession` se bifurca (`strengthSelector.ts:107`):

- rama normal → `buildSelectionExercise` (sin porcentaje ni RPE);
- `selectBlockStrengthSession` → `buildPrescribedExercise` (**con** ambos),
  activa cuando `shouldUseBlockTemplateSelection` es verdadero, es decir cuando
  hay `weekIndexInBlock`, `available1RM` no vacío o `rpeAdjustment`.

`available1RM` no vacío es el caso normal de un atleta con 1RMs cargados. Un
barrido que solo ejercite la rama normal **no vería** una eventual diferencia de
porcentaje al consolidar el convertidor. Cubrir ambas ramas es requisito, no
detalle.

### Método

Worktree desprendido en `3d480b3`, barrido pareado sobre nombres del catálogo ×
decoraciones × tramos de reps, clasificando cada diferencia por tipo
(`load-lost`, `load-gained`, `percent-gained`, `group:x->y`, …) — el mismo
método de las dos rondas anteriores. Se agrega una cohorte con `libraryRef`
estampado, para verificar que el tier nuevo produce exactamente lo mismo que
resolver ese ejercicio por su nombre canónico.

### Cobertura unitaria

- Precedencia del tier `ref` sobre `exact`/`alias`/`substring`.
- Fallback por `id` muerto.
- `source` ajeno ignorado.
- Ref vivo contradictorio: gana el ref.
- `validateExerciseProposal` descarta un `libraryRef` emitido por el modelo.
- El envoltorio de prompt no incluye `libraryRef`.
- `optionalCoachExercises` preserva un ref válido y descarta uno malformado.
- Identidad de rotación resuelta por ref.
- Los tres productores estampan; la expansión de footwork **reemplaza** el ref
  del bloque genérico en vez de heredarlo.
- Ninguna de las seis conversiones del §5 queda como literal inline.
- Los seis consumidores del §6 resuelven por ref: roles, claves de rotación,
  cobertura de calidad, historial reciente, progresión y reemplazo.
- Los `id` del catálogo son permanentes: lista activa congelada como gate, y
  registro de retirados con intersección vacía contra los activos.

## 10. Fuera de alcance

- Squash. `squash_drill` existe como `source`, pero la resolución de drills es
  otro camino y otro trabajo.
- Cualquier cambio de copy visible. Es la entrega siguiente.
- Backfill de contenido existente, en cualquier forma.
- Que el modelo emita ids.

## 11. Deuda que este bloque deja anotada

- El contenido creado antes de esta entrega queda sin ref para siempre, salvo
  que se decida un backfill más adelante. La entrega de copy debe asumirlo.
- `sanitizeExerciseLibraryRef` valida forma, no existencia. La verificación de
  `id` vivo ocurre en el resolver, no en el borde — deliberado, porque el borde
  no debe depender del catálogo. La consecuencia es que un ref sintácticamente
  válido y semánticamente muerto **persiste indefinidamente** en la fila (§8):
  los serializers lo preservan, así que solo desaparece con una edición del
  nombre o una limpieza explícita, que este bloque no construye.
- No existe herramienta para auditar cuántos refs muertos hay en datos reales.
  Si el catálogo llegara a retirar ejercicios con frecuencia, haría falta.

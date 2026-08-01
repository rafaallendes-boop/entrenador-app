# Fuerza — inventario de acoplamiento al nombre

Fecha: 2026-07-31
Estado: inventario corregido, insumo para el spec de desacople
Alcance: los 77 ejercicios de `exerciseLibrary.ts` y las reglas que derivan
clasificación o carga a partir del **texto del nombre**.

## 0. Método, y qué se corrigió de la primera versión

La primera versión de este inventario contaba **coincidencias de patrón**, no
caminos ejecutados. Eso produjo cuatro afirmaciones falsas y varios conteos
malos. Esta versión sigue la ejecución real.

Errores corregidos, para que no se repita el método:

- `REFERENCE_TABLE` se leyó desde la línea 30 y se perdieron las primeras
  entradas. Tiene **21** patrones, no 13, y **sí** incluye press de banca y press
  sobre cabeza. La conclusión de que "toda la familia de empuje superior es
  invisible para la carga" era un artefacto de esa lectura truncada.
- Tres de los cuatro bugs reportados no ocurren en ejecución, porque el flujo
  sale antes por campos explícitos. Se retiran abajo, nombrados.

Lo que este inventario sigue sin hacer: no ejecuta el planificador completo. Las
afirmaciones de ejecución se derivan de leer los guardas de cada función, no de
correr un plan.

## 1. Hay tres rutas, no dos

Esta es la distinción que la primera versión no hizo, y sin ella el inventario no
sirve para decidir qué se puede borrar.

| Ruta | Cuándo | Qué usa |
|---|---|---|
| **A. Resuelto, solo campos** | `findStrengthExerciseByName` resuelve | `getStrengthBlockForDefinition` → `equipment`, `tags`, `category` |
| **B. Resuelto, pero el nombre gana** | resuelve, y aun así el regex corre primero | `shouldExposePercent1RM:243`, `getImplementableMaxWeight:269-272` |
| **C. No resuelto** | nombre libre inventado por el modelo | `inferExerciseGroup:135` y el resto de los regex |

**Consecuencia para el spec:** borrar un regex de la ruta C **no conserva
comportamiento**. Es la única lógica que atiende ejercicios inventados. El spec
tiene que decidir explícitamente qué hacer con ellos —rechazarlos, mapearlos, o
tratarlos como genéricos— antes de tocar nada.

Y las rutas B y C **no son dos regex distintos**: son el mismo regex corriendo
sin comprobar si la definición existe. Por eso un regex de la ruta B se puede
retirar del camino resuelto —el `definition` está en el mismo scope y ya tiene la
información— pero **no se puede borrar del archivo**, porque el mismo código es
el que atiende la ruta C.

## 2. Hallazgo 1: dos fuentes de verdad para el 1RM

Conviven dos mecanismos para anclar un ejercicio a un levantamiento de
referencia, sin fuente común:

| | Explícito | Por nombre |
|---|---|---|
| Dónde | `EXERCISE_1RM_REFERENCES` (`exerciseLibrary.ts:1237`), por `id` | `mapExerciseTo1RMReference` (`strengthLoadPrescription.ts:38`), 21 patrones + dominadas |
| Campo | `has1RMReference` | ninguno |
| Ejercicios | **15** | **29** |
| Quién lo lee | `strengthSelector.ts:294, 329, 377` | `strengthSessionStructure.ts:186`, `qualityReview.ts:634` |

Intersección: **14**. Dentro de ella no hay ninguna discrepancia de `lift`.

**Solo el regex** los reconoce (15): `bulgarian_split_squat`, `walking_lunge`,
`hip_thrust`, `pull_up`, `assisted_pull_up`, `jump_squat`, `barbell_jump_squat`,
`bb_reverse_lunge`, `bb_side_lunge`, `single_leg_hip_thrust`, `mixed_grip_pull_up`,
`weighted_pull_up`, `half_kneeling_row`, `bodyweight_squat`, `split_squat`.

**Solo el mapa explícito** lo reconoce (1): `landmine_press`.

El problema no es que uno cubra menos: es que el `factor` —el multiplicador que
convierte el 1RM de referencia en carga del ejercicio— **solo existe en la tabla
regex**. El campo `has1RMReference` guarda el lift pero no el factor, así que el
selector no puede prescribir carga derivada sin pasar por el nombre.

## 3. Hallazgo 2: el matcher resuelve por orden de catálogo

`findStrengthExerciseByName` (`exerciseLibrary.ts:1317`) termina en un
`.find()` que acepta contención de substring **en ambas direcciones**, sin
puntaje ni desempate. Devuelve el primero del array.

Medido:

| Consulta | Candidatos por substring | Devuelve |
|---|---|---|
| `"press"` | **10** | `bench_press` |
| `"sentadilla"` | 8 | `back_squat` |
| `"remo"` | 8 | `bent_over_row` |

Es la misma clase de fragilidad que se corrigió en squash, con dos agravantes:
el fan-out es mayor y acá no hay puntaje que morder. Agregar un ejercicio al
catálogo puede desviar en silencio la resolución de nombres libres ajenos.

## 4. Hallazgo 3: desempate por nombre en el selector

`strengthSelector.ts:1006` ordena candidatos con
`b.score - a.score || a.exercise.name.localeCompare(b.exercise.name)`. Es
exactamente el bug que se corrigió en squash y que el roadmap §16 ya había
documentado en `normalizeStrengthSessions`: ante puntajes iguales decide el orden
alfabético del **texto visible**, así que renombrar cambia qué ejercicio se
prescribe. Debe pasar a `id` antes de cualquier trabajo de copy.

## 5. Inventario de reglas, por ruta

| Regla | Ubicación | Qué decide | Ruta | Ejercicios del catálogo | Campo que la reemplaza |
|---|---|---|---|---|---|
| R1 cardio | `strengthSessionStructure.ts:136` | grupo `cardio` | **C** | 9 (la ruta A no lo usa) | ya cubierto por `equipment`/`tags` |
| R2 core | `:137` | grupo `core` | **C** | 12 | ya cubierto por `category` |
| R3 footwork | `:78-79` | expandir bloque genérico | **C** | — | ninguno: un definido nunca se expande |
| R4 plancha→seg | `:125` | reps en segundos | B/C | 5 | **`prescriptionUnit` (falta)** |
| R5 protocolo | `:215-217` | excluir del cálculo de carga | **B/C** | **0** | ver aviso abajo |
| R6 salto 60% | `:227` | carga 60% vs 82,5% | B/C | 10 | `intensityType` |
| R7 mancuerna | `:244` | no exponer %1RM | B/C | 2 | `hasBarbellReference` + `unilateral`, en la misma función |
| R8 goblet 40 | `:269` | tope 40 kg | B/C | 1 | ya chequea `id` primero |
| R9 unilateral 50 | `:270` | tope 50 kg | B/C | 5 | `unilateral` (ya chequea antes) |
| R10 remo manc 45 | `:271` | tope 45 kg | B/C | **0** | — |
| R11 press manc 50 | `:272` | tope 50 kg | B/C | 1 | `equipment` (ya está debajo) |
| R12 core de base | `:340` | **orden** de core (`isFoundationCore` → `coreRank`) | **C** | — | ya cubierto por `tags`/`id` |
| R13 1RM | `strengthLoadPrescription.ts:38` | lift + factor | B/C | 29 | **`loadReference` (falta el factor)** |

Ninguna de R4 a R11 es exclusivamente ruta B: sus regex corren sobre el nombre
sin comprobar si la definición existe, así que también son la única lógica que
atiende nombres inventados.

**R3 y R12 son las excepciones, y ya están bien separadas.** Ambas cortan con un
guarda de resolución antes de llegar a su regex: `isGenericFootworkBlock:75`
devuelve `false` apenas `findStrengthExerciseByName` resuelve, e
`isFoundationCore` envuelve su lógica en `if (definition)`. No hay nada que
mover en ellas.

### Eliminables **de la ruta resuelta** — no borrables enteros

La distinción importa: retirar estos regex del camino de un ejercicio del
catálogo no cambia nada, pero **borrarlos del archivo sí**, porque hoy son lo
único que atiende un nombre libre. La forma segura es moverlos detrás de
`if (definition)` —o dejarlos como rama `else`— hasta que el spec decida la
política de la ruta C.

- **R9, R10, R11**: `getImplementableMaxWeight` ya tiene debajo las ramas
  `equipment.includes('kettlebell'|'dumbbell'|'medball'|'plate')` y
  `definition?.unilateral`, que cubren los mismos casos y **más**: 21 ejercicios
  declaran mancuerna o kettlebell en `equipment` contra 2 que lo dicen en el
  nombre. Los regex son un atajo redundante que corre antes.
- **R7**: vive en otra función y su reemplazo también. Dentro de
  `shouldExposePercent1RM`, las dos líneas siguientes al regex ya deciden lo
  mismo por campos: `hasBarbellReference` —`equipment` con `barbell`, `trap_bar`
  o `machine`— y `!definition.unilateral`. No lo cubre
  `getImplementableMaxWeight`.
- **R6**: `intensityType` acierta en los 10.
- **R1, R2**: en la ruta resuelta el cardio ya sale de
  `equipment: ladder | assault_bike | air_treadmill` y de `tags: court_footwork |
  court_conditioning | cardio_specific`, y el core de `category === 'core'`.

### Aviso: R5 puede eliminar un ejercicio del catálogo

`isProtocolExercise` corre **primero** dentro de `isLoadBearingStrengthExercise`,
**antes** de resolver la definición, y no tiene guarda alguna. Hoy tiene cero
coincidencias, pero es un patrón sobre texto libre aplicado también a ejercicios
definidos: **un renombre que introduzca "activación", "movilidad" o
"calentamiento" sacaría a ese ejercicio de la prescripción de carga por
completo**, en silencio. Es el riesgo más directo que el trabajo de copy
introduciría si se hace antes del desacople.

Para ejercicios definidos la política segura es devolver `false` —un ejercicio
del catálogo no es un protocolo—; el regex queda solo para no resueltos.

## 6. El único bug que sobrevive a la verificación

**`bodyweight_squat` recibe carga externa.** El patrón
`/(sentadilla|back[\s-]+squat|\bsquat\b)/i` captura "Sentadilla con peso
corporal" con `factor: 1.0`. El factor multiplica el **porcentaje prescrito**, no
el 1RM crudo: con sentadilla de 100 kg y 3 repeticiones el porcentaje es 82,5% y
el resultado son **82,5 kg** sobre un ejercicio cuyo `equipment` es
`['bodyweight']` y cuyo `intensityType` es `recovery`. El mapa explícito,
correctamente, lo omite.

### Bugs retirados

Los tres restantes de la primera versión **no ocurren**, y conviene dejar escrito
por qué, porque cada uno muestra un guarda que el spec debe preservar:

1. **Jump squats al 100% del 1RM** — no ocurre.
   `isLoadBearingStrengthExercise:206` devuelve `false` cuando
   `definition?.intensityType === 'power'` sin peso ni porcentaje explícito, así
   que nunca llegan a `mapExerciseTo1RMReference`.
2. **Drill de escalera tratado como potencia** — no ocurre.
   `resolveStrengthExerciseBlock` usa `getStrengthBlockForDefinition`, que lo
   marca `cardio` por `equipment: ladder`, y `isLoadBearingStrengthExercise`
   descarta `cardio` antes de cualquier prescripción de carga. El regex de
   "salto" solo alcanza nombres no resueltos.
3. **19 ejercicios con mancuerna mal tratados** — no ocurre. Caen en las ramas
   de `equipment` de `getImplementableMaxWeight`. La baja cobertura del regex es
   redundancia, no un defecto de tratamiento.

## 7. Campos: qué falta y qué no

| Campo | ¿Necesario? | Evidencia |
|---|---|---|
| `prescriptionUnit: 'reps' \| 'seconds'` | **Sí**, por R4 | Hay **12** ejercicios `category: 'core'`, **11** de ellos `intensityType: 'stability'`. De esos 11, **5** convierten sus números a segundos —las planchas— y **6** no: `pallof_press`, `dead_bug`, `cable_chop`, `farmer_carry`, `bird_dog_renegade_row`, `half_kneeling_diagonal_plate_chop`. Comparten categoría, tipo de intensidad y tags: `pallof_press` comparte hasta `anti_rotation` con `side_plank_plate_press`. Lo único que hoy separa a los 5 de los 6 es la palabra "plancha" en el nombre |
| `isConditioning` | **No** | `getExerciseGroupForDefinition` ya deriva `cardio` de `equipment` (`ladder`, `assault_bike`, `air_treadmill`) y `tags` (`court_footwork`, `court_conditioning`, `cardio_specific`). Los 9 ejercicios ya se distinguen |
| `loadReference: { lift, factor }` | **Sí** | Unifica los dos sistemas del §2. Hoy el `lift` vive en `has1RMReference` y el `factor` solo en la tabla regex, así que ninguna de las dos fuentes basta sola |

**Dominadas aparte.** `mapExerciseTo1RMReference` trata `pullUp` como caso
especial: devuelve `referenceKg` = repeticiones máximas, no kilos, y el
consumidor descarta el resultado (`strengthSessionStructure.ts:187` retorna
antes si `reference.lift === 'pullUp'`). Es una señal de disponibilidad
disfrazada de carga. `loadReference` no debería heredar esa deuda: la política de
dominadas va en su propio campo o su propia función.

## 8. Lectura para el spec de desacople

Tres tramos, de menor a mayor riesgo:

1. **Determinismo, sin tocar contenido.** Pasar el desempate de
   `strengthSelector.ts:1006` a `id`, y darle a `findStrengthExerciseByName` un
   criterio que no dependa del orden de declaración. Es prerrequisito de todo lo
   demás: sin esto, cualquier renombre posterior mueve prescripciones.
2. **Separar las rutas sin borrar nada.** Mover R6, R7, R9, R10, R11 y las partes
   de R4 y R8 que ya tienen campo detrás de `if (definition)`, dejándolos como
   rama de no resuelto. R3 y R12 no entran: ya tienen su guarda de resolución.
   Para ejercicios del catálogo el comportamiento debe quedar idéntico salvo el
   bug de `bodyweight_squat`; hay que verificar caso por caso que el orden de las
   ramas no cambie ningún resultado. **R5 entra acá con prioridad**, porque es la
   que puede eliminar un ejercicio del catálogo con un simple renombre.
3. **Los dos cambios de fondo:** `loadReference` unificado con su factor —que
   corrige el bug de `bodyweight_squat` al dejar de derivar del texto— y
   `prescriptionUnit`.

La dirección de fondo, que el spec debe fijar antes de tocar código: **metadata
explícita para el ejercicio resuelto, y una política aparte para el nombre
libre**. Para la carga derivada esa política conviene que sea *fail-closed* —sin
metadata no se prescribe carga— porque el costo de los dos errores no es
simétrico: no prescribir carga es una molestia visible, y prescribirla mal a
partir de una coincidencia de texto es lo que hoy pone 82,5 kg sobre una
sentadilla con peso corporal.

Recién con eso el copy de fuerza se vuelve verificable con el método de squash:
congelar invariantes, renombrar con aliases, y que el snapshot pruebe que nada se
movió.

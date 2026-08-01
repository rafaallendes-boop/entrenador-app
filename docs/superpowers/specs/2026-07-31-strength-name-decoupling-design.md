# Fuerza — desacople del nombre (diseño)

Fecha: 2026-07-31
Estado: entregas 1–3 implementadas en working tree, pendientes de commit
Inventario base: `docs/superpowers/specs/2026-07-31-strength-name-coupling-inventory.md`
Alcance: `strengthSessionStructure.ts`, `strengthLoadPrescription.ts`,
`strengthSelector.ts`, `exerciseLibrary.ts`.

## 1. Por qué

El copy de fuerza no se puede tocar hoy. El inventario documentó que la
clasificación y la carga de un ejercicio se derivan en varios puntos del **texto
de su nombre**, así que un renombre mueve el planificador. Tres consecuencias
concretas:

- `strengthSelector.ts:1006` desempata candidatos con
  `a.exercise.name.localeCompare(b.exercise.name)`: ante puntajes iguales decide
  el orden alfabético del texto visible.
- `findStrengthExerciseByName` termina en un `.find()` por substring
  bidireccional sin puntaje: `"press"` tiene **10** candidatos y devuelve
  `bench_press` por orden de declaración.
- `isProtocolExercise` corre **antes** de resolver la definición y sin guarda, así
  que un renombre que introduzca "activación", "movilidad" o "calentamiento"
  sacaría a ese ejercicio de la prescripción de carga en silencio.

Y hay un bug vivo independiente del copy: **`bodyweight_squat` recibe 82,5 kg**
con sentadilla de 100 kg y 3 repeticiones, porque el patrón
`/(sentadilla|back[\s-]+squat|\bsquat\b)/i` lo captura con `factor: 1.0` y
`computeWeightFromPercent` calcula `referenceKg * factor * percent / 100`. Su
`equipment` es `['bodyweight']`.

## 2. Principio rector

**Para el ejercicio resuelto, metadata explícita. Para el nombre libre, una
política aparte y declarada.**

La política del nombre libre es **fail-closed para la carga derivada**: sin
metadata no se prescribe peso. El costo de los dos errores no es simétrico. No
prescribir carga es una omisión visible que el usuario corrige; prescribirla mal
a partir de una coincidencia de texto es lo que hoy pone 82,5 kg sobre una
sentadilla con peso corporal.

**La clasificación no es fail-closed.** `inferExerciseGroup` se conserva como
fallback: mandar todo nombre libre a `'other'` degradaría la estructura de sesión
sin ganar seguridad, porque clasificar mal un bloque no lesiona a nadie.

## 3. Entrega 1 — Determinismo

Prerrequisito de todo lo demás: sin esto, cualquier renombre posterior mueve
prescripciones y no hay forma de distinguir un cambio de copy de una regresión.

**1.1 Desempate del selector.** `strengthSelector.ts:1006` pasa a
`a.exercise.id.localeCompare(b.exercise.id)`. Mismo cambio que ya se aplicó en
`drillSelector.ts` para squash.

**1.2 Resolución determinista de nombres.** La regla de **ganador único o
`undefined`** aplica **solo al último escalón**, el de substring. El orden de
prioridad queda explícito:

```
id o nombre canónico exacto
  → alias exacto (campo `aliases` y `aliasMap` interno)
    → único candidato por substring
      → undefined
```

Esa precedencia es la que evita una contradicción: `"sentadilla"` está declarado
en `back_squat.aliases` **y** en el `aliasMap` de `findStrengthExerciseByName`,
así que resuelve en el segundo escalón y nunca llega al substring. Lo mismo
`"dominadas"`. La ambigüedad solo puede rechazar consultas que no son alias de
nadie: `"press"` y `"remo"` son los dos casos medidos.

**Riesgo a medir, no a suponer:** la suite tiene tests que dependen de la
resolución por substring. Si alguno falla, hay que decidir caso por caso si el
nombre del fixture era legítimamente ambiguo o si falta un alias — nunca
ampliando la tolerancia del matcher.

**1.3 Fixtures de selección, no solo de resolución.** El cambio de desempate a
`id` **puede cambiar qué ejercicio se prescribe**, y un snapshot por ejercicio no
lo detecta: congela propiedades de cada definición, no la salida del selector.
Es exactamente lo que pasó en squash, donde el desempate por `id` movió la
selección y lo detectó un test preexistente, no el guard.

Antes de tocar el desempate hay que congelar **fixtures públicos de
`selectStrengthSession`** —los `id` y la firma de la sesión resultante— para un
conjunto fijo de contextos que cubra fase, fatiga, equipamiento y 1RM
disponibles. Cualquier diferencia posterior se revisa y se declara una por una.
Esta entrega **no puede afirmar** que sus únicas diferencias son las consultas
ambiguas sin esa medición.

**Verificación:** los 77 nombres canónicos resuelven a su propio `id`; todos los
alias declarados resuelven a su `id`; `"press"` y `"remo"` devuelven `undefined`;
y los fixtures de selección quedan verdes o con diferencias revisadas.

## 4. Entrega 2 — Separar rutas sin borrar nada

Congela comportamiento para el ejercicio resuelto y deja los regex vivos como
rama de no resuelto. **No borra ningún regex**: hoy son la única lógica que
atiende nombres inventados.

**Corrección posterior al code review (2026-08-01):** “resuelto” en esta
sección significa identidad estable por `id`, nombre canónico o alias exacto.
Un ganador único por substring sigue siendo texto libre para las redes
estructurales R4–R11. La resolución ahora expone `matchKind`; solo `exact` y
`alias` pueden omitir esos regex. La definición encontrada por substring aún
puede aportar grupo y `loadReference`, pero nunca desactiva una salvaguarda que
el nombre largo sí activa.

**2.1 `isProtocolExercise` (R5), con prioridad.** Pasa a recibir el `definition`
ya resuelto. Para un ejercicio del catálogo devuelve `false` — un ejercicio
definido no es un protocolo. El regex queda solo para el no resuelto. Es el
cambio que elimina el riesgo de que un renombre saque un ejercicio de la
prescripción.

**2.2 Reglas de `strengthSessionStructure` que ya tienen campo.** Se mueven
detrás de `if (definition)`, conservándose como rama `else`:

| Regla | Reemplazo para el resuelto |
|---|---|
| R6 salto 60% | `intensityType === 'power'` — acierta en los 10 |
| R7 mancuerna | `hasBarbellReference` + `!definition.unilateral`, ya presentes dos líneas más abajo en `shouldExposePercent1RM` |
| R8 goblet | `definition.id === 'goblet_squat'`, ya chequeado antes |
| R9 unilateral | `definition.unilateral`, ya chequeado antes |
| R10, R11 | las ramas de `equipment` que ya existen debajo en `getImplementableMaxWeight` |

R1 y R2 (`inferExerciseGroup`) **ya** están en la rama de no resuelto, y R3 y R12
ya cortan con su propio guarda de resolución. No se tocan.

**Invariante de esta entrega:** para los 77 ejercicios del catálogo, el grupo
resuelto, la unidad de reps, el tope de peso y la exposición de %1RM deben ser
idénticos antes y después. La única diferencia admitida es la de §2.1 para
ejercicios cuyo nombre contenga las palabras de protocolo — hoy son cero.

## 5. Entrega 3 — Metadata explícita

### 5.1 `loadReference`

Reemplaza las dos fuentes de verdad del inventario §2 por una sola:

```ts
export interface StrengthLoadReference {
  /** Levantamiento del perfil contra el que se calcula la carga. */
  lift: Exercise1RMReference
  /**
   * Multiplicador sobre la carga derivada del porcentaje. Ausente significa
   * que el ejercicio no recibe peso derivado, aunque declare `lift`.
   */
  factor?: number
  /**
   * Si el selector puede puntuar este ejercicio por tener 1RM disponible y
   * asignarle `targetPercent1RM`. Hoy lo cumplen solo los 15 del mapa
   * explícito; los que existían únicamente por regex no eran elegibles.
   */
  selectorEligible: boolean
}
```

**`selectorEligible` no es un adorno: sin él la unificación cambia el selector.**
Hoy los dos sistemas no solo cubren conjuntos distintos, sino que alimentan
dimensiones distintas. Los 15 del mapa explícito afectan **scoring** (`+35` en
`strengthSelector.ts:294`) y el gate de `targetPercent1RM` (`:329`, `:377`). Los
15 que existen solo por regex **no llegan al selector en absoluto**: solo
intervienen en el cálculo de peso de `strengthSessionStructure`.

Colapsar ambos en un único `lift` y apuntar el selector ahí volvería elegibles a
`jump_squat`, `walking_lunge`, `hip_thrust`, `bb_reverse_lunge` y compañía: los
puntuaría `+35` y les asignaría porcentaje. Sería un cambio de selección no
declarado, encima de una entrega que se presenta como congelada.

Se declara por `id`, como ya hace `EXERCISE_1RM_REFERENCES`, y reemplaza tanto a
ese mapa como a `REFERENCE_TABLE`.

**Los dos sistemas usan hoy vocabularios distintos**, y unificarlos es parte del
trabajo, no un detalle de implementación:

| Tipo | Valores | Dónde |
|---|---|---|
| `Exercise1RMReference` | `squat`, `deadlift`, **`benchPress`**, `overheadPress` | `exerciseLibrary.ts:28`, lo consume el selector |
| `ReferenceLift` | `squat`, `deadlift`, **`bench`**, `overheadPress`, `pullUp` | `strengthLoadPrescription.ts:3`, lo consume la carga |

`loadReference.lift` adopta **`Exercise1RMReference`**: son los cuatro valores que
el selector ya compara contra `available1RM`, y no incluye `pullUp`, que la
decisión 3 saca del contrato de carga. Dos consecuencias a ejecutar:

- `qualityReview.ts` mapea sus etiquetas con
  `NUMERIC_REFERENCE_LABELS: Record<Exclude<ReferenceLift, 'pullUp'>, string>`,
  cuya clave `bench` pasa a `benchPress`.
- Los tres consumidores del selector —`strengthSelector.ts:294, 329, 377`— pasan
  de `exercise.has1RMReference` a exigir **las dos condiciones**, no solo el
  `lift`:

  ```ts
  const reference = exercise.loadReference
  reference?.selectorEligible && available1RM.has(reference.lift)
  ```

  Vale para el `+35` de scoring y para los dos gates de `targetPercent1RM`.
  Quedarse en `loadReference?.lift` es exactamente el error que
  `selectorEligible` existe para impedir. El campo `has1RMReference` se retira.

Tres decisiones de contrato:

1. **`factor` opcional, y su ausencia significa "sin peso derivado".** Eso
   preserva exactamente el comportamiento actual de `landmine_press`, que hoy
   tiene `has1RMReference: 'overheadPress'` para el scoring del selector pero
   nunca recibe peso porque ningún patrón lo captura.
2. **`bodyweight_squat` no lleva `loadReference`.** Es la corrección del bug: sin
   metadata no hay carga derivada. Mismo criterio para cualquier ejercicio cuyo
   `equipment` sea solo `bodyweight`.
3. **Las dominadas salen del contrato de carga.** Hoy
   `mapExerciseTo1RMReference` devuelve para ellas un `referenceKg` que son
   repeticiones, no kilos, y **los dos consumidores lo descartan**
   (`strengthSessionStructure.ts:187` y `qualityReview.ts:635` cortan con
   `lift === 'pullUp'`). Quitar el caso especial y no declararles `loadReference`
   es equivalente en comportamiento y saca una señal de disponibilidad disfrazada
   de carga. `pullUpMaxReps` sigue en el perfil, intacto.

**`factor` ausente excluye explícitamente dos cosas**, y hay que escribirlas
porque una de ellas no sale sola: el peso derivado, y la **cobertura de 1RM de
`qualityReview`**. Ese consumidor filtra hoy con
`factor < COVERAGE_MIN_FACTOR || factor > 1` (`qualityReview.ts:637`); con
`factor` indefinido ninguna de las dos comparaciones es verdadera, así que el
ejercicio **contaría como cobertura** sin prescribir carga. La condición tiene
que rechazar `factor == null` de forma explícita.

**Quitar `pullUp` es un cambio observable de API.** `ReferenceLift` es un tipo
exportado y `mapExerciseTo1RMReference` es una función exportada con tests
propios. Que los dos consumidores productivos descarten `pullUp` hace el cambio
inocuo en comportamiento, **no** en superficie: hay que actualizar el tipo, sus
tests y `NUMERIC_REFERENCE_LABELS`, y declararlo como diferencia esperada.

**Migración de valores: 25 declaraciones, no 30.** Partiendo de los 29 que hoy
resuelven por regex:

| | |
|---|---|
| Base por regex | 29 |
| − 4 dominadas (`pull_up`, `assisted_pull_up`, `mixed_grip_pull_up`, `weighted_pull_up`) | decisión 3 |
| − `bodyweight_squat` | decisión 2 |
| + `landmine_press` | único del mapa explícito |
| **Total** | **25** |

Los factores se trasladan literalmente desde `REFERENCE_TABLE` por `id`. Ninguno
cambia de `lift`: la intersección de 14 ya coincide entre ambas fuentes.

Esas 25 declaraciones se reparten así, y el reparto es verificable contra el
inventario:

- **15 con `selectorEligible: true`** — los que hoy están en
  `EXERCISE_1RM_REFERENCES`: los 14 de la intersección más `landmine_press`.
- **10 con `selectorEligible: false`** — los que hoy existen solo por regex, una
  vez descontadas las 4 dominadas y `bodyweight_squat`.

De los 15 elegibles, `landmine_press` es el único sin `factor`, que es lo que
preserva su comportamiento actual: puntúa en el selector y no recibe peso.

### 5.2 `prescriptionUnit`

```ts
/** Cómo se prescribe el volumen. Ausente equivale a 'reps'. */
prescriptionUnit?: 'reps' | 'seconds'
```

Hay 12 ejercicios `category: 'core'`, 11 de ellos `intensityType: 'stability'`.
De esos 11, cinco convierten sus números a segundos —las planchas— y seis no:
`pallof_press`, `dead_bug`, `cable_chop`, `farmer_carry`,
`bird_dog_renegade_row`, `half_kneeling_diagonal_plate_chop`. Comparten
categoría, tipo de intensidad y tags; `pallof_press` comparte hasta
`anti_rotation` con `side_plank_plate_press`. Lo único que hoy los separa es la
palabra "plancha" en el nombre.

Reciben `prescriptionUnit: 'seconds'`: `plank`, `side_plank`,
`copenhagen_side_plank`, `side_plank_plate_press`, `stability_ball_front_plank`.
El resto queda sin declarar. R4 pasa a leer el campo para el resuelto y conserva
su regex para el no resuelto.

## 6. Qué no entra

- **El copy de fuerza.** Es la entrega siguiente y depende de esta.
- **Borrar los regex estructurales.** R1–R12 se mueven o se envuelven; ninguno
  desaparece mientras la ruta de nombre libre exista. **R13 es la excepción
  deliberada:** la política fail-closed de §2 significa que sin metadata no hay
  carga derivada, así que `REFERENCE_TABLE` **se retira** en la Entrega 3. Los
  regex estructurales sobreviven como fallback; los de carga desaparecen a
  propósito, porque son justamente los que prescriben peso adivinando.
- **Revisar `isConditioning`.** Descartado en el inventario:
  `getExerciseGroupForDefinition` ya deriva `cardio` de `equipment` y `tags`.
- **Tocar `strengthBlocks/`, la periodización o el scoring del selector**, con
  una única excepción: el desempate determinista de la Entrega 1, que cambia el
  criterio de orden y no las reglas de puntaje.
- **Migraciones Dexie o Supabase.** Ninguna entrega las necesita.

## 7. Verificación

El método es el que funcionó en squash, con una diferencia que importa: acá el
snapshot se congela **antes** de la Entrega 1, no antes del copy, porque son las
entregas de desacople las que tienen que demostrar que no mueven nada.

Hacen falta **dos** artefactos, y el segundo es el que el inventario no podía
sustituir.

**7.1 Snapshot por `id`**, para los 77 ejercicios: grupo resuelto,
`prescriptionUnit` efectiva, tope de peso implementable, exposición de %1RM, y el
peso calculado para un perfil de prueba fijo con un número de repeticiones fijo.
Ese último campo es el que atrapa una regresión de carga.

**Resultado real de ejecución:** no quedó disponible ese snapshot histórico.
El archivo se generó después del desempate y luego se actualizó durante la
migración, por lo que presentarlo como basal sería incorrecto. Se reemplazó por
dos redes honestas y complementarias:

- `strengthBehaviorContract.test.ts` congela el comportamiento actual de los 77
  ejercicios después de las Entregas 1–3.
- `exerciseLibrary1RMCoverage.test.ts` contiene un ledger literal, independiente
  del código productivo, con los 25 objetos `{ lift, factor,
  selectorEligible }`. Ese cruce es el que falla si un factor se edita o se
  traslada mal en el futuro.

**7.2 Fixtures de selección.** `selectStrengthSession` sobre un conjunto fijo de
contextos, congelando los `id` elegidos y la firma de la sesión. Sin esto la
Entrega 1 no puede afirmar nada sobre su impacto, porque el desempate por `id`
actúa sobre la elección y no sobre las propiedades de cada ejercicio.

**Nota de ejecución (2026-08-01):** el fixture de selección se generó después de
cambiar el desempate, por lo que no constituye por sí solo un artefacto
histórico pre-cambio. La diferencia observada quedó aislada en un test explícito:
en el escenario puntuado `build`, el empate que antes elegía
`trap_bar_deadlift` por nombre ahora elige `back_squat` por `id`. El snapshot sí
queda como contrato de regresión del comportamiento determinista resultante.

**7.3 Matriz de nombres libres.** Retirar `REFERENCE_TABLE` cambia más superficie
que el tipo `pullUp`: hay nombres que **hoy resuelve el regex de carga y no
resuelve `findStrengthExerciseByName`**. Con metadata por definición, esos
pierden la carga derivada. El snapshot de los 77 no los cubre, porque no son
entradas del catálogo.

Medido sobre el código actual, aparecen tres clases:

| Clase | Ejemplo | Hoy | Después |
|---|---|---|---|
| **A. Pierde carga** | `"Press de banca"` | `def=NULL`, regex `bench ×1` | sin carga |
| **A. Pierde carga** | `"Búlgaras con mancuernas"` | `def=NULL`, regex `squat ×0.35` | sin carga |
| **B. Definición equivocada** | `"Sentadilla búlgara con mancuernas"` | `def=back_squat` (**incorrecto**), regex `squat ×0.35` | `undefined` por ambigüedad |
| **C. Coinciden** | `"Press banca"`, `"Front squat"`, `"Press militar"` | `def` correcto | sin cambio |

La clase B es la que justifica el orden de las entregas, y conviene enunciarla
con precisión porque **hoy no hay bug**: `mapExerciseTo1RMReference` recibe el
**nombre original**, no la definición, así que aplica correctamente `squat ×0.35`
aunque `findStrengthExerciseByName` haya resuelto `back_squat`. Las dos vías
divergen sin que se note.

El riesgo es contrafactual: **si la Entrega 3 ocurriera antes que la 1**, el
factor pasaría a leerse de la definición, que es `back_squat` con `1.0`, y recién
ahí la carga se triplicaría. La regla de ambigüedad de la Entrega 1 manda esa
consulta a `undefined` antes de que exista la oportunidad de consolidar el error.

**La matriz hay que construirla, no suponerla.** Se arma con los nombres reales
que aparezcan en sesiones y plantillas guardadas, más una lista curada de
variantes plausibles, y cada entrada de clase A se decide caso por caso:

- **Variante legítima → alias.** Es la salida recomendada: `"Press de banca"` es
  el mismo ejercicio que `"Press banca"`, y que uno resuelva y el otro no es un
  alias faltante, no una decisión de diseño.
- **Nombre que no identifica un ejercicio → sin carga.** Ahí la política
  fail-closed es la respuesta correcta.

La matriz entra a los tests y a la tabla de diferencias de abajo. Cerrarla es
prerrequisito de la Entrega 3, no trabajo posterior.

**Diferencias admitidas, declaradas una por una:**

| Entrega | Diferencia esperada |
|---|---|
| 1 | `"press"` y `"remo"` pasan a `undefined`. `"sentadilla"` y `"dominadas"` **no cambian**: son alias exactos |
| 1 | En el fixture puntuado `build`, `trap_bar_deadlift` sale y `back_squat` entra por el nuevo desempate por `id` |
| 2 | Ninguna sobre el catálogo actual — R5 tiene cero coincidencias hoy |
| 3 | `bodyweight_squat` pasa de 82,5 kg a sin carga derivada |
| 3 | `ReferenceLift` pierde `pullUp`: cambio de tipo exportado y de sus tests, sin cambio de comportamiento |
| 3 | Se agregan aliases exactos para `"Press de banca"`, `"Press inclinado"`, `"Press de hombros"` y `"Búlgaras con mancuernas"`; conservan la carga mediante metadata |
| 3 | `"Press declinado con barra"`, `"Pendlay row"` y `"Remo con barra"` dejan de recibir carga derivada; el último sigue resolviendo a `bent_over_row`, que deliberadamente no declara referencia |
| 3 | `"Fondos en paralelas"` deja de recibir carga: no hay entrada de fondos en el catálogo, y el `bench ×0.7` del regex era una equivalencia inventada |
| 3 | `REFERENCE_TABLE` y `mapExerciseTo1RMReference` se retiran; la matriz ejecutable queda en `strengthFreeNameLoadMatrix.test.ts` |

**La regla general, que la tabla de arriba no puede enumerar.** Todo nombre
libre que no identifique una referencia única deja de recibir carga derivada.
Eso alcanza a cualquier decoración de un nombre canónico multi-palabra cuyo
fragmento empate con dos referencias de factor distinto — `"Peso muerto rumano
con mancuernas"` (`deadlift` 1 vs `romanian_deadlift` 0,8), `"Press de banca con
mancuerna"`, `"Sentadilla búlgara con mancuernas"` (§6, caso B). Un barrido
pareado de 1.714 variantes contra el estado previo devuelve **solo pérdidas de
carga**: cero cargas nuevas, cero porcentajes nuevos y cero degradaciones de
bloque. Los casos concretos verificados viven en
`strengthFreeNameLoadMatrix.test.ts`.

Cualquier diferencia que **no** sea una pérdida de carga por nombre no
identificable es una regresión, no un efecto.

**Ambigüedad: fail-closed para la carga, no para la clasificación.** La regla
del §2 —clasificar mal un bloque no lesiona a nadie, mandar todo a `other`
degrada la sesión— obliga a que un fragmento ambiguo conserve sus candidatos.
`resolveStrengthExerciseName` devuelve `matchKind: 'ambiguous'` **sin**
`definition` y **con** `candidates` ordenados por `id`. Sin eso, una
`"Dominada lastrada progresiva"` caía a `other` y mostraba un `80 % 1RM` que
nunca tuvo.

Cada decisión elige el resultado más seguro, que no siempre es el mismo
cuantificador:

| Decisión | Regla sobre `candidates` | Por qué |
|---|---|---|
| Bloque de la sesión | primer candidato por `id` | clasificar no es fail-closed; `other` degrada la sesión y el orden por `id` no depende de la declaración |
| Exponer `%1RM` | **todos** deben exponer | basta una lectura a peso corporal para que el porcentaje sea falso |
| Tratar como potencia | **todos** deben ser `power` | un salto sin carga declarada no debe recibir porcentaje |
| Tope de implemento | **el mínimo** de los topes declarados | un tope es una cota de seguridad: nunca sube un peso, y que un candidato no declare tope significa que la tabla no tiene regla para su implemento, no que aguante cualquier carga |

El tope solo actúa sobre pesos **explícitos**, porque un nombre ambiguo nunca
recibe carga derivada. Efecto medido sobre 462 variantes con 200 kg
declarados: 30 pasan a acotarse (dominada lastrada, empuje de cadera a una
pierna, salto horizontal a una pierna, sentadilla búlgara y las dos sentadillas
con salto), todas a la baja. `"Sentadilla con salto y barra"` se acota por
`jump_squat` aunque `barbell_jump_squat` no declare tope; se acepta porque un
salto con 200 kg es absurdo en cualquiera de las dos lecturas.

## 8. Riesgos

**El mayor: la Entrega 3 cambia números deportivos.** Trasladar 21 patrones a 25
declaraciones por `id` es donde un error se traduce en carga mal prescrita. Se
mitiga con el contrato de peso calculado y el ledger literal de los 25 factores,
no con revisión visual del diff.

**El segundo: retirar `REFERENCE_TABLE` deja sin carga a nombres libres que hoy
sí la reciben.** Es el precio explícito de la política fail-closed, y hay que
pagarlo con los ojos abiertos y con la matriz de §7.3 en la mano.

**La Entrega 1 puede romper tests existentes** que dependen de la resolución por
substring. Es señal, no ruido: cada fallo hay que clasificarlo como fixture
legítimamente ambiguo o como alias faltante, y resolverlo en esa dirección, nunca
ampliando la tolerancia del matcher.

**El orden no es negociable.** Hacer la Entrega 3 antes de la 1 significa cambiar
la metadata de carga mientras el selector todavía desempata por nombre, y las dos
diferencias se mezclan en el mismo snapshot.

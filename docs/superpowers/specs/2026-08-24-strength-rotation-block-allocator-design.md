# Allocator de bloque para la rotación de accesorios de fuerza — diseño

Fecha: 2026-08-24
Estado: **implementación y contrato deportivo cerrados localmente el
2026-08-27; pendiente deploy y observación del primer bloque real.** La
aprobación histórica del 2026-08-25 no cubría el camino productivo.
No se modificó producción.

> **Adenda post-smoke (2026-08-27).** La premisa "template de fuerza del
> modelo" de §7 era falsa para Plan Builder: desde el 2026-07-12 el prompt
> productivo prohíbe `exercises`. La Corrida 3 demostró que el snapshot quedaba
> vacío y el allocator no se ejecutaba. El orden corregido es: hidratar sólo
> `selectStrengthSession` cuando llega un esqueleto vacío → snapshot → core →
> allocator → densidad. Como el selector alterna subtemplates, la matriz se
> coordina por familia repetida (A/B/C; A/B en taper). Esta adenda reemplaza
> las afirmaciones incompatibles de §7 y "Templates hermanos distintos"; el
> resto del diseño sigue describiendo el allocator de plantillas provistas.
>
> **Segunda revisión post-smoke (2026-08-27).** La partición por familia no
> satisfacía el contrato observable heredado, que comparaba semanas completas
> sin distinguir A/B/C. Al subir el fixture productivo a ese predicado,
> `quality.strength.repeated_template`, 12/15 pares quedan con 3+ accesorios y
> las cinco semanas posteriores siguen marcadas. La prehidratación se desacopla
> de `previousWeek`, los payloads mixtos dejan de fingirse selector-owned y los
> markers legacy cicatrizan como `provided`; nada de eso cierra la coordinación
> cruzada. Esta conclusión queda como registro del contraejemplo que obligó a
> revisar el contrato.
>
> **Contrato final (2026-08-27; reemplaza la conclusión de la segunda
> revisión).** La métrica semanal absoluta confundía clonación con continuidad
> deportiva y su `≤2` no era factible con el catálogo elegible sin degradar la
> selección. El gate compara ahora sesiones por ordinal semanal dentro del
> bloque. Alerta cuando la sesión posterior comparte al menos 3 contables y al
> menos 80% de su contenido contable con la sesión anclada anterior. Así captura
> 7/8, 8/9 y 9/9, y permite 6/8 o 6/9 con progresión. El fixture productivo de
> seis semanas queda verde y conserva allocator, telemetría e idempotencia.
> Costo API: US$0. La Causa B queda cerrada en código; no se repite un plan
> completo pagado sólo para este smoke.
>
> **Límite deliberado del detector.** El anclaje por ordinal no busca clones
> cruzados: D2 de una semana que copie D1 de otra no se compara. Si dos semanas
> tienen distinta cantidad de sesiones de fuerza, sólo se emparejan los
> ordinales presentes en ambas. Es una decisión de dominio —seguir D1↔D1 y
> D2↔D2 sin agregar la semana completa—, no cobertura total de cualquier par
> posible de sesiones.

Cierra la **Causa B** del Hallazgo 5 de §28, que §29 dejó explícitamente
abierta. Reemplaza la decorrelación por una asignación coordinada entre las
semanas hermanas de un bloque.

## 1. El problema, medido

El spike del 2026-08-24 instrumentó la reproducción concurrente y midió, por
slot y por semana, el `rotationIndex`, el pool **antes** y **después** de
exclusiones, las claves excluidas y el candidato elegido. La medición en dos
momentos fue lo que permitió distinguir las hipótesis: con sólo el pool final,
una cascada es indistinguible de un pool chico.

**La hipótesis "pool chico" queda refutada** donde ocurren las colisiones: los
pools pre-exclusión miden 7, 6, 4 y 3 candidatos, no 1 ni 2.

Se identificaron **tres** mecanismos independientes, no uno:

### Mecanismo A — cascada de exclusiones

Slot `Corte diagonal en polea`, semanas 1 y 2. Pool pre idéntico (7, mismos
miembros). Pool post de 6 en ambas, **con miembros distintos**: la semana 1
excluyó `…contra pared` y la semana 2 excluyó `…con balón medicinal`, porque el
slot anterior de cada semana eligió distinto. Al quitar un elemento diferente,
el arreglo ordenado por `id` (`strengthSelector.ts:376`) se corre, y los
índices 3 y 4 aterrizan ambos en `Golpe al suelo con balón medicinal`.

### Mecanismo C — resonancia entre el paso y el tamaño del pool

Slot `Press vertical`. Semana 1: `rotationIndex` 37. Semana 2: 67. Pool idéntico
de 6, sin exclusiones efectivas. `37 % 6 = 1` y `67 % 6 = 1`: el mismo índice.

La delta es **30, no 31**. El multiplicador primo de
`weekIndexInBlock * 31 + sessionOrdinal * 7 + position`
(`repairWeek.ts:2105`) **no compra nada, porque 31 no es el paso efectivo**:
`position` se corre entre semanas — el `Press vertical` está en posición 6 en
una y 5 en otra — porque la rotación del core inyectado de §29 cambia la
composición de la lista. Cualquier deriva de posición que deje la delta múltiplo
del tamaño del pool produce una colisión garantizada.

### Mecanismo D — el original pertenece a su propio pool

En el loop de `repairWeek.ts:2071`, sólo los slots **sin** `reason` entran a
`assignedKeys`; un slot rotable nunca excluye su propia clave. Entonces
`candidates[rotationIndex % candidates.length]` puede devolver el ejercicio que
se está reemplazando: medido en `Peso muerto rumano → Peso muerto rumano`
(semana 1) y `Lanzamiento rotacional con balón medicinal → sí mismo` (semana 1).

Peor: `Remo con barra → Remo inclinado` (semana 2) **cambia el nombre visible y
conserva el id** `bent_over_row`, porque el primero es alias del segundo desde
§20. Parece rotación y no lo es.

Como la semana 0 de un bloque nunca rota (`applyPolicy = weekIndexInBlock > 0`,
`repairWeek.ts:2059`), cada no-op de este tipo es un ejercicio compartido
garantizado con ella.

### Estado real del invariante

La reproducción existente (`strengthTemplateRotationConcurrent.test.ts`) estaba
verde **por un fixture vacuo**: usaba `'Lanzamiento rotacional'`, que no resuelve
contra el catálogo (el nombre vivo es `'Lanzamiento rotacional con balón
medicinal'` → `rotational_med_ball_throw`), así que
`selectStrengthReplacement` devolvía `undefined` en su primera línea y ese slot
nunca entraba al selector. Es la misma clase de defecto que el code review de
§23 encontró con `'Remo en maquina'`.

Con el nombre corregido, el invariante **se viola**: el par `0→2` da exactamente
**3** contables compartidos (`dead_bug`, `cable_chop`, `bent_over_row`), que es
el umbral en que `quality.strength.repeated_template` dispara. Causa B es peor
de lo que §29 registró.

## 2. Alcance

**Dentro.** La asignación de reemplazos de accesorios contables de fuerza entre
las semanas de un mismo bloque, bajo `DEFAULT_CONCURRENCY = 3`.

**Fuera, y declarado.**

- El **main lift**: sigue fuera de alcance por §16, y el rol es **posicional**
  (no reordenar antes de resolverlo).
- Los roles no contables según `isCountableRole`.
- El **core estructural** de §29: queda fuera de la **asignación** y **sí entra
  como restricción**, porque su id ocupa cupo de I2 y consume presupuesto de I1.
  No se lo asume puro: se lo vuelve puro mediante la proyección del paso 2 de §7,
  que es donde se define exactamente qué slot es y cómo rota.
- La rotación de squash, que tiene su propio eje y su propio fail-closed.
- Ampliar la elegibilidad del catálogo. Si un pool no alcanza, este diseño lo
  **reporta**; no lo agranda.

## 3. Entrega 1, separable y previa: excluir el original por identidad canónica

**Es un cambio bounded e independiente, y no cierra el problema.**

`selectStrengthReplacement` debe excluir de su pool el ejercicio que reemplaza,
comparando por **identidad canónica** (`resolveStrengthExercise(...)?.definition.id`),
no por nombre. Sin la comparación canónica, `Remo con barra` seguiría pudiendo
"rotar" a `Remo inclinado`.

Cierra el mecanismo D por completo y elimina dos de los tres solapes actuales de
`0→2`. **No** cierra A ni C. El test rojo de repetición no debe darse por
resuelto con esta entrega.

## 4. Identidad canónica

**Ejercicio.** El `id` del catálogo, resuelto con `resolveStrengthExercise`. Dos
nombres que resuelven al mismo `id` son el mismo ejercicio a todo efecto:
diversidad, unicidad y conteo. **Un alias nunca cuenta como rotación.** Un
ejercicio que no resuelve no entra al allocator y se reporta (§9).

**Slot.** Debe ser estable entre semanas hermanas, así que **no puede usar la
posición en la lista**: la deriva de `position` es el mecanismo C. Se define como

```
slotKey = `${sessionOrdinal}:${canonicalOriginalId}:${occurrenceIndex}`
```

donde `sessionOrdinal` es el índice de la sesión de fuerza dentro de la semana
ordenada por fecha y `timeBlock`, y `occurrenceIndex` desambigua repeticiones
del mismo `id` en la misma sesión. Además, el snapshot conserva `sessionKey =
date|timeBlock` como **ancla de materialización**: entre el snapshot y el
reemplazo, otros pasos pueden recortar o reordenar la lista viva. El ordinal
sólo pertenece a la matriz virtual; nunca se usa para volver a buscar una
sesión. La posición sirve para ordenar las ocurrencias congeladas, pero todas se
localizan contra la lista viva antes de mutar la primera.

## 5. Dominio temporal: qué es `N`

**Corrección respecto de la primera versión de esta spec, que lo dejaba
indefinido.** `resolveBlockPositions` (`blockIdentity.ts:26`) devuelve `blockId`
e `indexInBlock`, **no** el tamaño del bloque; hay que derivarlo contando las
semanas que comparten `blockId` sobre `planWeekDescriptors`, que todos los
workers tienen idénticos.

`N` es **el bloque completo**, no la ventana de concurrencia. No es una
elección: `quality.strength.repeated_template` compara cada semana contra
**todas las anteriores del mismo bloque** (`qualityReview.ts:529`, bucle
`for i = 0; i < j`), quedándose con el peor solape. Acotar el allocator a las 3
semanas en vuelo dejaría sin cubrir exactamente los pares que el check sí mira.

**Consecuencia dura, y obliga a cambiar el invariante.** En el escenario medido
el bloque abarca 12 semanas y los pools van de 3 a 7 candidatos. Exigir que un
slot tome un id distinto en cada una de las 12 semanas es **imposible por
conteo**, no difícil. La primera versión de esta spec afirmaba esa garantía y
era inalcanzable.

## 6. Invariantes

Sobre la matriz `A[slot][week] → canonicalId`, con `week ∈ [0, N)`.

**La columna 0 es fija y forma parte de la matriz.** La semana con
`indexInBlock = 0` no rota (`repairWeek.ts:2059`), así que
`A[slot][0] = canonicalOriginalId(slot)` por definición. Modelarla explícitamente
—en vez de excluirla— es lo que permite que las demás columnas se restrinjan
contra ella; su omisión es la causa de dos de los tres solapes medidos en
`0→2`.

- **I1 — presupuesto de solape por par, sobre la proyección controlada.** Para
  todo par `i < j` del bloque, `|countables(P_j) ∩ all(P_i)| ≤ 2`, donde `P_w`
  es la **proyección del allocator** de la semana `w`: el template, las celdas
  asignadas, el main lift y el core estructural. **No** es la semana final.

  La distinción no es un tecnicismo. §7 admite que el relleno de densidad puede
  sumar solape después de la asignación, y una garantía enunciada sobre la
  semana final sería falsa por construcción: el allocator no controla lo que se
  agrega después de él. Las dos afirmaciones no pueden ser ciertas a la vez, y
  la que se sostiene es ésta.

  El predicado real de `qualityReview.ts:520-540` sobre la semana **final** es
  el **criterio de aceptación** de esta entrega —se verifica por test y es lo
  que decide si el trabajo sirve— pero **no es una garantía del allocator**.
  Confundir criterio de aceptación con invariante es lo que produjo las dos
  versiones anteriores de esta sección.
- **I2 — unicidad intra-semana.** Los ids asignados en una semana son distintos
  entre sí y distintos de los ids no asignables presentes esa semana.
- **I3 — no-op prohibido.** `A[slot][w] ≠ canonicalOriginalId(slot)` para toda
  celda **asignada** con `w > 0`. Una celda degradada (§8) no recibe asignación,
  así que conservar el original no viola I3.
- **I4 — determinismo.** Misma entrada, misma matriz, en cualquier worker y en
  cualquier orden.

La distinción entre `countables` y `all` importa: el main lift no es countable,
pero sí está en `all` de la semana anterior, así que un accesorio asignado que
coincida con el main lift de otra semana **sí consume presupuesto**. El allocator
debe contarlo.

## 7. Entradas reconstruibles, y el límite real

La garantía exige que las N columnas se computen desde entradas idénticas sin
que los workers se hablen. Hoy **eso no se cumple**, y es un bloqueo
arquitectónico, no un detalle:

| Entrada | ¿Pura y compartida? |
|---|---|
| `blockId`, `indexInBlock`, tamaño del bloque | **Sí.** `resolveBlockPositions` sobre datos del plan |
| Template de fuerza | **Sí tras hidratar localmente el selector**; el modelo productivo no emite `exercises` |
| Core estructural de §29 | **No, tal como está hoy.** Ver abajo |
| Relleno de densidad | **No.** Ver abajo |
| `previousWeek` | **No.** Shell o ready según timing |

`completeStrengthExerciseDensity` (`repairWeek.ts:2854`) llama a
`selectStrengthSession` con un contexto que incluye `recentExercises`, derivado
de `previousWeek`. Sus adiciones se hacen `push` **sin marca de procedencia**,
así que después de `completeSportDetails` un ejercicio del modelo y uno agregado
son indistinguibles, e `isSelectedInjectedCore` decide sólo por id. Un worker no
puede reconstruir qué agregará el relleno de otra columna.

**El core tampoco es hoy una entrada independiente.** `ensureCoreBlock`
(`strengthSessionStructure.ts:261`) decide **insertar o reemplazar** según los
cores que queden en la sesión: con cero cores antepone; con uno que no coincide
antepone; con dos o más y sin foundation core **mapea y reemplaza el primer
core**. Y `normalizeStrengthSessions` vuelve a correr el enriquecedor
**después** de asignar (`repairWeek.ts:2136`). En la traza medida, la celda
`Dead bug → Golpe al suelo` puede quedar pisada por el core estructural
posterior. Es decir: el core real depende de `template + asignación +
weekIndex`, no de `weekIndex + equipamiento`. La versión anterior de esta spec
lo daba por puro y estaba mal.

**Resolución: congelar el orden e invertir la dependencia, sin procedencia
persistida.** El repair fija esta secuencia, y ningún paso puede adelantarse:

1. **Snapshot transitorio del template**, inmutable durante el resto del repair.
   Es la entrada canónica del allocator y de la firma de §9.
2. **Proyección estructural pura del core**: para cada sesión de fuerza y cada
   semana virtual `w` se proyecta **exactamente un** `structuralCoreSlot`
   **desde el snapshot**, antes de cualquier asignación. Al no depender de la
   asignación, vuelve a ser puro y compartido.

   **Cuál es el slot.** El primer ejercicio del snapshot que satisface
   `isFoundationCore` (`strengthSessionStructure.ts:539`) en orden de la lista;
   si no hay ninguno, el slot es virtual y se antepone, igual que hoy hace la
   rama de cero cores de `ensureCoreBlock`.

   **Qué id toma.** Si el foundation core existente pertenece a
   `INJECTED_CORE_ROTATION`, o si el slot es virtual, toma el de la allowlist
   según `weekIndexInBlock` y equipamiento. Si el core existente resuelve a un
   id válido **fuera** de esa allowlist, se conserva ese id prescrito: Copenhagen
   y el trabajo de disco no son huecos que la rotación pueda sobrescribir. En
   ambos casos queda fijo por proyección, nunca por el allocator.

   **Queda fijo y fuera del dominio.** El allocator no puede asignarle una
   celda ni desplazarlo. En el fixture medido eso significa que
   `Dead bug — control de tronco` —que es foundation core por id explícito
   (`strengthSessionStructure.ts:548`) y que hoy ya actúa como tal, porque con
   dos cores y foundation presente `ensureCoreBlock` devuelve la sesión
   intacta— **sale del dominio**: el allocator pasa a tener **cuatro** slots
   asignables, no cinco.

   **Los demás cores del template siguen siendo asignables.**
   `Lanzamiento rotacional con balón medicinal` no es foundation core y entra al
   dominio con normalidad.

   La alternativa —dejar `Dead bug` asignable— exigiría meter una restricción de
   cobertura de foundation core dentro del CSP, porque el allocator podría
   reemplazarlo y, con el paso 5 prohibiendo mutadores estructurales
   posteriores, **nadie lo restauraría**. Eso contradice el alcance de §2 y se
   descarta explícitamente.
3. **Allocator** sobre los slots supervivientes, con la restricción explícita de
   **conservar el core estructural proyectado** — no puede asignarle una celda ni
   desplazarlo.
4. **Relleno de densidad coordinado**, que corre después y recibe como exclusión
   los ids ya comprometidos por la asignación de esa semana. Reconstruye para
   las N columnas un plan determinista de extras elegibles, reparte primero el
   mínimo operativo y después el target; cada worker materializa sólo su
   columna. Si el primer lote del selector no tiene margen I1, reintenta con
   esos ids como recientes para obtener alternativas elegibles. No hay reserva
   FNV por id/semana.
5. **Ningún mutador estructural posterior puede sobreescribir la asignación.**
   `ensureCoreBlock` y el resto del enriquecedor operan sobre un conjunto del que
   las celdas asignadas están explícitamente excluidas.

Esto no exige un campo de procedencia persistido —que habría que serializar y
sanear en backup, plantillas e import, al costo que §19 pagó por `libraryRef`—
pero **sí exige registros transitorios inmutables durante el repair**: el
snapshot del paso 1 y el conjunto de celdas asignadas del paso 3. Viven en
memoria, dentro de una sola pasada, y no cruzan ninguna frontera de
serialización.

Así las entradas del allocator sí son idénticas entre workers, sin introducir un
campo de procedencia que habría que persistir, serializar y sanear en backup,
plantillas e import.

**Límite declarado y no disimulado:** el relleno de densidad sigue siendo
best-effort cuando los templates difieren, una sesión desaparece o el catálogo
no ofrece cobertura. Para templates hermanos iguales, el plan coordinado entra
en I1 y no puede añadir el tercer id compartido a una sesión final. Si no puede
cubrir el mínimo, conserva la mejor densidad factible y no inventa ejercicios.

## 8. Algoritmo y factibilidad

### Hall es necesaria, no suficiente

**Corrección respecto de la primera versión.** Hall por columna es condición
necesaria para I2, y sirve como diagnóstico barato de infactibilidad, pero **no
es suficiente para I1+I2 juntos**. Contraejemplo con dos semanas y pools
`s1={a,b}`, `s2={a,b}`, `s3={a,b,c}`: cada columna satisface Hall por separado,
pero `s1` y `s2` consumen `a` y `b` en ambas semanas, forzando `s3→c` dos veces
y agotando el presupuesto de I1. Un emparejamiento por columna
—Hopcroft–Karp, húngaro— **no puede ver esa interacción**, porque optimiza cada
columna en aislamiento.

La matriz es un problema de satisfacción de restricciones sobre las ternas
`(slot, week, candidate)`, no una secuencia de emparejamientos independientes.

### Búsqueda determinista con poda

El tamaño lo permite: `S ≤ ~6` slots asignables, `N ≤ 12` semanas, pools de
hasta ~16. Búsqueda en profundidad sobre las columnas en orden `w = 1..N-1`
(la 0 está fija), y dentro de cada columna sobre los slots en orden de
`slotKey`:

1. Orden de valores por slot: rotación determinista de su lista de candidatos
   ordenada por `id`, sembrada por `hash(blockId, slotKey)` — nunca por
   `position`, que es el mecanismo C. El hash se declara en el módulo como
   función pura sobre string (FNV-1a de 32 bits) y queda **congelado por test**:
   no puede usar `Math.random`, la hora, ni el orden de iteración de un `Map` u
   `Object`, porque cualquiera de las tres rompe I4 entre workers.
2. Poda al asignar cada celda: descartar el valor si viola I2 en su columna, si
   viola I3, o si agota el presupuesto de I1 contra **alguna columna ya fijada**,
   incluida la 0.
3. Tope de exploración explícito y determinista (nodos visitados). Alcanzado el
   tope, se corta y se degrada por §9 — nunca se lanza ni se cuelga. **Bajo el
   tope, la búsqueda devuelve la mejor solución visitada, no el óptimo global**:
   sólo agotar el espacio permitiría afirmar optimalidad, y el tope existe
   justamente para no agotarlo. El orden de visita es determinista, así que "la
   mejor visitada" es reproducible entre workers, que es lo que I4 necesita.
4. Desempates, en orden fijo: menor índice en la secuencia de preferencia del
   slot; luego `id` menor por `localeCompare`.

Cada worker ejecuta la búsqueda completa y **toma la columna de su
`indexInBlock`**. Sin canal compartido, sin lock, sin promesas.

## 9. Degradación

La degradación es **por celda**, no por slot completo: sacrificar las 11 celdas
de un slot porque una es infactible tira diversidad que sí existía.

Cuando la búsqueda no completa la matriz, el objetivo determinista es, en este
orden estricto:

1. minimizar el número de pares `(i, j)` que exceden el presupuesto de I1;
2. entre empates, minimizar el total de celdas degradadas;
3. entre empates, degradar las celdas de mayor `week` primero — las semanas
   tardías del bloque están más cerca del evento y su contenido importa menos
   que el del grueso del bloque;
4. entre empates, mayor `slotKey` por `localeCompare`.

Una celda degradada **conserva su ejercicio original**. Nunca queda vacía y
nunca rompe la semana: §17 ya fijó que un slot sin recambio no puede anular el
nivel completo. La degradación **no** habilita el fallback local ni cuenta como
falla de schema.

### Templates hermanos distintos

Si un consumidor provee templates diferentes entre hermanas, cada worker computa
una matriz distinta y **la garantía desaparece: pasa a best-effort**. Es
aceptable y se documenta. En el camino productivo, las familias distintas del
selector son variación intencional y se coordinan por separado; no se reportan
como drift entre templates.

Para que sea observable hace falta una **firma pre-rotación nueva**: la metadata
actual (`planBuilderStrengthRotation.signature`, `repairWeek.ts:2153`) guarda
`canonicalStrengthSignature` calculada **después** de rotar, así que no sirve
para comparar entradas. Se agrega `templateSignature`, calculada sobre el snapshot del paso 1 de §7 y
cubriendo **la entrada estructural completa** —`slotKey`, rol resuelto, sesión a
la que pertenece e ids fijos (main lift y core estructural proyectado)—, no sólo
el conjunto de ids. Dos templates con los mismos ids repartidos en sesiones
distintas, o con roles distintos, producen matrices distintas y deben tener
firmas distintas. `allocator.divergent_template`
se emite sólo cuando hay una semana anterior del mismo bloque ya lista con firma
distinta. Bajo concurrencia no la habrá, y entonces simplemente no se emite.

## 10. Telemetría

Extiende el patrón allowlisted existente (`strengthAccessoryRotationActionCount`
/ `…SessionsAffected`, `types/planBuilder.ts:72-73`, propagados en
`asyncGenerationLoop.ts:368-369` y `:424-425`). Contadores, no payloads:

- `strengthAllocatorSlotCount` — celdas dentro del dominio.
- `strengthAllocatorAssignedCount` — celdas de la columna local que se
  materializaron; la columna 0 es referencia y cuenta cero.
- `strengthAllocatorUnmaterializedCount` — celdas cuya matriz local cambió,
  pero cuya sesión u ocurrencia ya no existe al materializar.
- **Un contador por causa de degradación**, no un único motivo "más frecuente":
  `strengthAllocatorInfeasibleIntraWeekCount`,
  `strengthAllocatorInsufficientPoolCount`,
  `strengthAllocatorUnresolvedIdentityCount`,
  `strengthAllocatorSearchExhaustedCount`. Este último sólo corresponde a
  celdas no exploradas al terminar el presupuesto: no puede tapar una causa
  `infeasible_intra_week` que ya se conocía.
  Colapsarlos en un solo campo perdería las demás causas, que es justo lo que
  hay que distinguir para saber si el problema es catálogo, restricciones o
  presupuesto de búsqueda.

**Cada worker cuenta únicamente su propia columna**, nunca la matriz completa.
Todos los workers computan las N columnas, así que emitir el total multiplicaría
cada métrica por `N` al agregar las semanas del bloque en
`plan_generation_attempts`.

Ninguno entra en `countRepairsV2`: son observacionales, mismo criterio que los
contadores de rol de §17.

## 11. Casos obligatorios

Cada uno debe fallar contra el código actual antes de pasar.

1. **No-op por ejercicio original** — un slot no puede conservar su propio id.
2. **No-op por alias** — `Remo con barra` no puede "rotar" a `Remo inclinado`:
   ambos son `bent_over_row`.
3. **Resonancia por `position`** — dos semanas cuyo slot equivalente quedó en
   posiciones distintas no pueden recibir el mismo id. Caso medido: pool 6,
   delta efectiva 30.
4. **Cascada por exclusiones distintas** — dos semanas con el mismo pool pre y
   exclusiones distintas no pueden converger. Caso medido: pool pre 7, índices
   3 y 4.
5. **Determinismo bajo concurrencia** — resolver las columnas en orden directo,
   inverso e intercalado produce matrices idénticas.
6. **Pools insuficientes y restricciones cruzadas imposibles** — incluido el
   contraejemplo de Hall (`s1={a,b}`, `s2={a,b}`, `s3={a,b,c}`): el allocator
   degrada por celda, conserva originales, emite el contador correcto, no lanza
   y no habilita el fallback local.
7. **Main lifts y roles no contables fuera del dominio** — no reciben
   asignación, y sus ids **sí** consumen presupuesto de I1 y cupo de I2.
8. **Agregados fuera del dominio** — los ejercicios que hoy inserta el relleno
   de densidad (`Subida al cajón con salto alternado`, `Dominada` en la traza
   medida) no reciben asignación, y el relleno corre después excluyendo los ids
   ya comprometidos.
9. **Columna 0 fija** — la semana `indexInBlock = 0` conserva el template y las
   demás columnas se restringen contra ella.
10. **Templates hermanos distintos** — best-effort documentado, sin promesa de
    I1, con `allocator.divergent_template` sólo si hay una hermana ya lista.
11. **Bloque de 12 semanas con pools de 3–7** — el caso que hace inalcanzable la
    diversidad total: el allocator debe respetar el presupuesto de I1 sin
    pretender ids distintos en las 12 columnas.

El contrato de `strengthRotationPoolContract.test.ts` ya exige los **cinco**
slots que hoy entran al selector, incluidos `Dead bug — control de tronco` y
`Lanzamiento rotacional con balón medicinal`.

**Al aterrizar el allocator ese contrato cambia a cuatro.** `Dead bug` sale del
dominio por ser el `structuralCoreSlot` proyectado (§7 paso 2), y pasa a
verificarse **por la proyección estructural** —que su id siga la allowlist de
§29 por semana— y no como slot del allocator. Hay que agregar además la aserción
de que los agregados por densidad quedan fuera del dominio. Ese test **está rojo hoy**, pero **ya no alcanza como criterio de cierre**: la
Entrega 1 elimina el no-op por alias `Remo con barra → Remo inclinado`, con lo
que `0→2` baja de 3 a 2 y el test queda verde **sin que A ni C estén
resueltos**. Los casos 3 (resonancia) y 4 (cascada) son gates propios del
allocator y deben seguir rojos hasta que aterrice.

## 12. Riesgos

- **Cambia la salida determinista del selector.** §18 dejó un snapshot de
  selección congelado; hay que identificar qué tests lo fijan y decidir
  explícitamente cuáles se regeneran y cuáles son regresiones reales. No
  regenerar un snapshot sin justificar la diferencia.
- **El emparejamiento es más caro que un módulo.** El costo es por semana y
  sobre pools de decenas de candidatos; irrelevante frente a la latencia del
  proveedor, pero no debe correr dentro de un bucle por ejercicio.
- **Superficie nueva.** El allocator merece su propio módulo, al lado de
  `strengthRoleContract.ts`, y no debe crecer dentro de `repairWeek.ts`, que ya
  es grande.

## 13. Fuera de alcance

Ampliar el catálogo, backfill de planes existentes, aplicar el allocator a
squash, y unificar los dos caminos de `max_tokens`/temperatura del Plan Builder.

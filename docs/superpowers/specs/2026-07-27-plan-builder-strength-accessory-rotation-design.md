# Plan Builder — repetición de fuerza: rol en el check + rotación determinista de accesorios

**Fecha:** 2026-07-27
**Estado:** diseño aprobado, pendiente de plan de implementación
**Origen:** hallazgo lateral de la campaña de velocidad Fase 2
(`docs/superpowers/experiments/plan-builder-speed-phase-2/`)

## 1. Problema

La campaña de Fase 2 generó 36 planes (12 por cada una de las tres corridas C/A/B)
bajo el manifest congelado. Bajo la configuración **productiva** (`high`), el
control C dio:

| Frecuencia | Código |
|---|---|
| **10/12** | `quality.strength.repeated_template` |
| **6/12** | `quality.squash.low_drill_variety` |
| 2/12 | `squash.race_day.missing_event`, `quality.generation.high_repair_count`, `plan.load.jump`, `quality.load.progression_jump` |

Seis de los doce planes salen `needs_review`, y los seis son de familia squash
(`squash_build` 69/70, `dobles` 65/67, `semana_parcial` 73/73). Running y
ciclismo salen `good`; taper sale `excellent`.

`quality.strength.repeated_template` aparece en **exactamente 10/12 en las tres
corridas** (C, A y B). Es sistémico y no es un efecto de `effort`.

Esto cubre dos casillas que el roadmap ya tenía abiertas por intuición y ahora
tienen evidencia:

```
- [ ] Revisar warnings de variedad de drills en build/peak.
- [ ] Confirmar que fuerza no repita plantillas clonadas semana a semana.
```

### 1.1 Causa raíz — fuerza

Tres piezas que no están de acuerdo:

1. **El repair queda inerte.** `repairDuplicateStrengthExercises`
   (`repairWeek.ts:1379`) construye `recentKeys` desde
   `context.previousWeek.sessions` y sale con `if (recentKeys.size === 0) return`.
2. **El review mira todo el bloque.** `getRepeatedStrengthTemplateIssues`
   (`qualityReview.ts:485`) compara cada semana contra **todas** las anteriores
   del mismo bloque, quedándose con el solape máximo.
3. **La concurrencia impide que exista la semana previa.**
   `asyncGenerationLoop.ts:996` toma la semana previa *ready* y, si no existe,
   cae al **shell** — que conserva fase y carga objetivo pero **no tiene
   sesiones**. Con concurrencia 3 y planes de 3-4 semanas, la primera oleada
   cubre casi el plan entero.

Resultado: para la mayoría de las semanas, `recentKeys` queda vacío y el repair
anti-repetición no corre. El review, en cambio, sí compara.

Verificación operativa parcial disponible sin escribir código:
`plan_generation_jobs.previous_week_context_source` (`'none' | 'shell' | 'ready'`)
ya está instrumentada en producción. Es **indicativa, no concluyente**: al ser un
agregado por corrida, el valor `shell` demuestra que **al menos una** semana usó
shell, pero no cuántas. Por eso §6.1 la estampa además por semana.

### 1.2 El check no distingue roles

`getStrengthExerciseKeys` (`qualityReview.ts:475`) construye un `Set` de nombres
a nivel semana: pierde sesión, posición y rol. `StrengthExerciseRole`
(`'main_lift' | 'accessory' | 'trunk' | 'power'`) existe desde siempre en
`exerciseLibrary.ts:51` y el check no lo usa.

Deportivamente eso está mal: **dentro de un bloque, los lifts principales deben
persistir** mientras progresa la carga. Penalizarlos es penalizar periodización
correcta.

### 1.3 Squash es un problema distinto — fuera de alcance

`diversifyDuplicateSquashSessions` (`repairWeek.ts:1269`) **no** depende de
`previousWeek` para funcionar: el `Set` de firmas es local a la semana y
`usedDrills` se acumula dentro de la semana. La semana previa solo enriquece la
elección de reemplazos.

El desajuste real es otro:

- **Repair:** duplicados intra-semana.
- **Check:** diversidad acumulada de todo el bloque (`qualityReview.ts:532`).

Eso exige un diseño propio de rotación determinista de drills por semana/sesión.
**Va en spec separado.** Este documento no lo aborda.

## 2. Alcance

**Entra:** el contrato de rol para el check de fuerza como **helper puro
compartido** (§3), la rotación determinista de accesorios (§4), el
**refactor del repair antiguo dependiente de `previousWeek`** en una única
normalización de dos razones (§4.5), la **API de reemplazo completo** del
selector (§4.6), el **resolvedor compartido de identidad e índice de bloque**
(§4.4), su modelado de taxonomía (§5), la telemetría derivada (§6) y sus tests
(§7).

**No entra:** rotación de drills de squash (spec propio, aunque su telemetría sí
entra en §6.2); cambio del umbral ≥3; cambio de `getStrengthExerciseRole` ni del
comportamiento de `strengthSelector` en su camino actual; cualquier migración
Dexie o Supabase (no hay ninguna).

## 3. Contrato de rol (congelado)

### 3.1 Resolución por sesión

Por cada sesión de fuerza, en orden de aparición:

1. `category === 'core'` → `trunk`, **contable**.
2. `intensityType === 'power'` → `power`, **contable**.
3. El **primer ejercicio restante reconocido por catálogo** → `main_lift`,
   **exento**.
4. Los siguientes → `accessory`, **contables**.
5. Ejercicio **desconocido** por catálogo → **contable**. Nunca puede obtener la
   exención por accidente.

Consecuencia buscada: core o power al principio **no consumen el cupo de
`main_lift`**. Una sesión compuesta solo por core/power no tiene ninguna
exención.

### 3.1.1 Propiedad del contrato

Esta resolución **no puede pertenecer al review**. La rotación (§4) necesita
exactamente la misma resolución para saber qué `main_lift` preservar, y dos
implementaciones de la misma definición divergen tarde o temprano.

Vive en un **helper puro compartido**, consumido por `qualityReview` y por
`repairWeek`. Sin estado, sin dependencias de contexto de generación: entra una
lista de ejercicios de una sesión, sale la lista de roles.

`getStrengthExerciseRole` (`exerciseLibrary.ts:1302`) es posicional
(`index === 0`) y la consume `strengthSelector.ts:981`. **No se toca ni se
reemplaza**: el objetivo es no arrastrar al selector en un cambio de scoring. Las
dos definiciones coexisten con dueños distintos y el spec lo declara explícito
para que nadie las "unifique" después por parecer duplicadas.

### 3.2 Comparación entre semanas

Para comparar una semana posterior contra una anterior del mismo bloque:

- **Conjunto anterior:** todos los nombres de fuerza de esa semana, sin
  distinción de rol.
- **Conjunto contable posterior:** nombres que aparezcan **al menos una vez**
  como `accessory`, `trunk`, `power` o desconocido.
- **Solape:** `posteriorContable ∩ anteriorTodos`.
- Principal en la anterior y accesorio en la posterior → **cuenta**.
- Principal y accesorio en dos sesiones de la posterior → **cuenta una vez**.
- **Warning con ≥3 nombres distintos compartidos.**

### 3.3 Umbral

Se mantiene en **≥3**, sin cambios. Ahora significa *tres accesorios
compartidos*, no tres ejercicios cualesquiera: una definición menos sensible
pero con evidencia más fuerte. Cambiar umbral y definición en la misma entrega
haría la corrida de verificación imposible de interpretar.

## 4. Rotación determinista de accesorios (congelado)

**Nombre correcto: rotación determinista que reduce colisiones.** No es una
garantía de cero warnings, y el spec no debe describirla como tal.

### 4.1 Por qué no hay garantía

Una función pura de `(weekIndexInBlock, sesión, posición)` garantiza
**reproducibilidad**, no **disjunción**. Dos semanas pueden seleccionar
conjuntos distintos pero muy solapados —por ejemplo, dos ventanas desplazadas
sobre el mismo pool—, y el solape sobrevive cuando hay varios accesorios del
mismo movimiento por semana y los filtros recortan el pool efectivo.

### 4.2 Contrato

- **Semana 0 del bloque (`weekIndexInBlock === 0`): se preservan los accesorios
  del LLM.** Sin excepciones.
- **Semanas 1+: se aplica dispersión determinista por movimiento.**
- **El `main_lift` no se toca nunca.**
- Se mantiene `movement`, compatibilidad de equipamiento, fase y riesgo. El
  filtrado **reusa `strengthSelector`**, no se reimplementa.
- Se evitan duplicados dentro de la misma sesión **y entre sesiones de la misma
  semana**: un accesorio rotado no puede reintroducir un ejercicio ya presente
  en otra sesión de esa semana.
- Los **desconocidos** se conservan y se contabilizan: no tienen `movement`, así
  que no se pueden rotar. Pueden sostener un warning por sí solos; es un límite
  real y aceptado.
- **Idempotencia obligatoria** (§7).

### 4.3 Por qué la variante conservadora

Rotar desde la semana 0 tendría tres costos que no compensan:

1. Sustituye **todos** los accesorios elegidos por el LLM, incluso los buenos.
2. Convierte tokens ya generados en trabajo descartado.
3. Registrada honestamente, inflaría el volumen de reparación y podría cambiar
   un warning por otro.

Además conserva la semana más importante para el usuario —la primera que ve, a
los ~24 s— y permite **medir cuánto del 10/12 proviene realmente de accesorios
repetidos**.

Si en el futuro se quisiera una garantía real, el alcance cambia: el código pasa
a ser dueño de todos los accesorios desde la semana 0, el LLM solo define
intención y patrones, y haría falta una **asignación para todo el bloque** que
considere todos los slots del mismo `movement` en conjunto, no elecciones
independientes por tupla. Es una arquitectura razonable, pero **no debe entrar
camuflada como un repair**.

### 4.4 Ubicación

Paso nuevo en el pipeline de reparación normal, **incondicional**: no detrás de
`previousWeek` ni de "falta densidad".

**Frontera de bloque: hoy no son equivalentes, y no alcanza con testearlo.**

- `computeWeekIndexInBlock` (`repairWeek.ts:2687`) hace `if (!containingPhase)
  return 0`. En un plan **sin `plan.phases`**, o en semanas fuera de los rangos
  declarados, **todas** las semanas quedan en índice 0.
- `getPlanPhaseForWeek` (`qualityReview.ts:467`), **en el caso sin `phases`**,
  agrupa todas las semanas de la misma fase bajo `${week.phase}:legacy` y **las
  compara entre sí**. Las semanas fuera de rango con `phases` declaradas son otro
  caso: forman grupos unitarios y no se comparan con nada.

Consecuencia: **en planes legacy** la rotación considera que todas son "semana 0"
y no rota nunca, mientras el review sí las compara. El defecto sobrevive intacto
justo en el caso peor.

**Resolvedor compartido.** Identidad de bloque e índice dentro del bloque salen
de la **misma** función, consumida por review y rotación. El review tiene **tres**
ramas y las tres se congelan explícitamente:

| Caso | Identidad de bloque | Índice dentro del bloque |
|---|---|---|
| `plan.phases.length === 0` | `${week.phase}:legacy` | **posición ordinal** dentro del grupo (0, 1, 2, …) |
| Semana dentro de una fase declarada | `${phase}:${start}:${end}` | `weekIndex − startWeekIndex`, como hoy |
| Fases declaradas pero semana **fuera** de rango | `${week.phase}:${weekIndex}:${weekIndex}` | siempre `0` |

La tercera fila es un matiz del review que conviene dejar escrito: al usar
`weekIndex` como inicio **y** fin, produce un **grupo unitario por semana**. Un
grupo unitario no tiene semana anterior, así que el check no puede disparar y la
rotación no debe aplicarse. Índice `0` es la respuesta correcta ahí, y es
autoconsistente — no es el mismo caso que legacy.

Fases legacy **no contiguas pero con el mismo nombre** pertenecen al **mismo
grupo**, exactamente como hace hoy el review: el agrupamiento es por nombre de
fase, no por contigüidad de índices.

**Plomería nueva (no es gratis).** El resolvedor **no puede** calcular la
posición ordinal recibiendo solo `plan` y `week`: `RepairContext`
(`repairWeek.ts:47`) contiene `plan`, `week`, `profile`, `wizardConfig` y
`previousWeek`, pero **no la lista de semanas del plan**. Por lo tanto:

- El resolvedor recibe los **descriptores ordenados de todas las semanas**
  (`weekIndex` y `phase` bastan; no necesita sesiones ni contenido).
- Esos descriptores se **propagan hasta `RepairContext`**.
- Un test explícito verifica la equivalencia con el review en las **tres** filas
  de la tabla.

**Determinismo estricto.** La función de selección debe ser estable entre
procesos: sin `Math.random`, sin `Date`, y sin depender del orden de iteración
de un `Map`/`Set` que no esté ordenado explícitamente. Dos corridas del mismo
input deben producir el mismo output byte a byte.

### 4.5 Una sola normalización, dos razones

El repair antiguo dependiente de `previousWeek` **conserva su comportamiento
correctivo pero se refactoriza**. Hoy contradice directamente "el main lift no se
toca nunca":

- `completeStrengthExercises()` **regenera la sesión entera**.
- `rotateRepeatedStrengthExercises` (`repairWeek.ts:1408`) después reemplaza
  ejercicios desde el final y **puede alcanzar los principales** — su propio
  comentario dice que los principales sobreviven *"when possible"*, que no es
  una garantía.

Dos pasos independientes mutando los mismos ejercicios además **se deshacen
mutuamente** y rompen la idempotencia exigida en §7.

Por eso: **un único paso de normalización determinista** que produce el estado
final de los ejercicios contables de la sesión y reporta **dos razones
separadas** por cada sustitución:

| Razón | Cuándo | Dónde se cuenta |
|---|---|---|
| **Política** | dispersión determinista de §4.2 | `strengthAccessoryRotationActionCount` (§5) |
| **Colisión observada** | solape real contra `previousWeek` cuando esa semana **sí** está `ready` | `corrective`, como hoy |

Restricciones que hereda del contrato:

- Trabaja **solo sobre ejercicios contables**. El `main_lift` resuelto por §3.1
  queda fuera de su alcance, en las dos razones.
- **No reconstruye la sesión completa.** La sustitución es uno-a-uno.
- Una misma sustitución no puede contarse en las dos razones: si la colisión
  observada y la política eligen el mismo cambio, prevalece **`corrective`**, que
  es la más conservadora para el reporte de reparación.

**Condiciones de la razón correctiva.** §4.2 preserva la semana 0 del bloque
*sin excepciones*, y sin estas condiciones la razón correctiva la corregiría
igual contra la última semana del bloque **anterior**, contradiciendo el
contrato. Se exige, todas:

1. `previousWeek` está **`ready`** (no shell, no ausente).
2. `previousWeek` pertenece al **mismo bloque resuelto** por §4.4. Si es del
   bloque anterior, no hay colisión que corregir.
3. La colisión se calcula con el contrato de §3.2 —`actualContable ∩
   anteriorTodos`, **≥3 nombres distintos**, a nivel semana— y no con el conteo
   por sesión de hoy.
4. Se mide **sobre la entrada original de la semana**, antes de aplicar
   política. Medir después haría que el desempate `corrective` dependiera del
   orden de aplicación y dejaría de ser estable.

**Unidad de cada contador.** Hoy el repair registra **una** corrección por
sesión aunque cambie varios ejercicios. Cambiar esa unidad alteraría en silencio
una taxonomía calibrada, así que se congela:

| Contador | Unidad |
|---|---|
| Razón interna de sustitución | por **ejercicio** sustituido |
| `correctiveActionCount` y `repairedSessionCount` | **una vez por sesión afectada**, como hoy |
| `strengthAccessoryRotationActionCount` | por **ejercicio** sustituido |
| `strengthAccessoryRotationSessionsAffected` | **una vez por sesión afectada** |

### 4.6 Qué significa "reemplazar un ejercicio"

El repair actual cambia **solo `exercise.name`** (`repairWeek.ts:1364`) y deja
intacta la prescripción del ejercicio anterior. Eso puede dejar un accesorio sin
referencia de 1RM cargando `targetPercent1RM`, notas que describen otro
movimiento, o un `group` incompatible.

El reemplazo debe construirse **completo**. `strengthSelector` expone una API
enfocada que arma el ejercicio de reemplazo con sus filtros y su prescripción
normales, y la normalización la consume en vez de parchear campos a mano.

Campos que **no se heredan** del ejercicio sustituido: `weight`, `notes`,
`group`, `targetPercent1RM`, `targetRpe`, `warmupSets`.

Campos que **sí se preservan**, porque son la forma de la sesión y no del
ejercicio: la **posición** en la lista y la densidad (`sets` y `reps` se
prescriben para el ejercicio nuevo, pero la sustitución sigue siendo uno-a-uno,
así que el conteo de ejercicios de la sesión no cambia).

## 5. Modelado de taxonomía (congelado)

La rotación es **política determinista del producto aplicada a una salida
válida**, no recuperación de una salida incorrecta. Precedente en el código:
`hydrationActionCount` es hidratación determinista y **ya está excluida** de
`countRepairsV2`, que es
`corrective + structural + moved + dropped` (`qualityReview.ts:750`).

**No se agrega una cuarta categoría a `RepairTaxonomyV2`**: eso cambiaría una
taxonomía calibrada. Se modela en paralelo:

- `strengthAccessoryRotationActionCount` — ejercicios efectivamente sustituidos.
- `strengthAccessoryRotationSessionsAffected` — sesiones únicas modificadas.

**No incrementa** `repairedSessionCount`, `correctiveActionCount`,
`structuralActionCount` ni `countRepairsV2`.

Esto vale **solo para la razón "política"** de §4.5. La razón "colisión
observada" sigue siendo `corrective` y sigue entrando en `countRepairsV2`, como
hoy: no se esconden reparaciones genuinas detrás del contador nuevo.

## 6. Telemetría derivada

Números y enums acotados; **cero contenido**. Entra por allowlist **explícita**
en `toWeekRow` (`scripts/loadtest-plan-builder/artifact.mjs:83`), que hoy
excluye `sessions` a propósito.

Hay **dos familias distintas** y mezclarlas sería un error de diseño: unas se
conocen mientras la semana se genera, otras exigen el plan entero terminado.

### 6.1 Estampadas en `generationMeta` durante la generación

| Campo | Tipo | Significado |
|---|---|---|
| `previousWeekContextSource` | `'none' \| 'shell' \| 'ready'` | hoy se calcula en `asyncGenerationLoop.ts:1001` y solo sobrevive **agregado a nivel job**; hay que estamparlo en la semana |
| `strengthAccessoryRotationActionCount` | número \| `null` | §5 |
| `strengthAccessoryRotationSessionsAffected` | número \| `null` | §5 |

### 6.2 Derivadas al cerrar el plan

`strengthCountableOverlapMax` **no puede estamparse durante la generación**:
depende de todas las semanas del bloque, y bajo concurrencia 3 las otras
todavía no existen. Se deriva en `buildWeekRows()`
(`scripts/loadtest-plan-builder.mjs:168`), que ya es proyección pura de las
semanas finales.

**Plomería:** `buildWeekRows()` hoy **no recibe el plan**, así que no puede
resolver bloques. Hay que pasarle `plan: state.plan` —o entregarle las
mediciones ya derivadas— antes de que pueda calcular nada de esta sección.

| Campo | Tipo | Significado |
|---|---|---|
| `strengthCountableOverlapMax` | número \| `null` | solape contable máximo contra cualquier semana anterior del bloque (§3.2) |

**Métricas de bloque de squash.** Son del **bloque**, no de la semana: se
registran en la **última semana del bloque**, que es donde el check emite su
issue (`qualityReview.ts:560`). En el resto de las semanas van `null`.

Las tres que había propuesto son insuficientes para auditar el check, porque
este decide con **dos** condiciones —`varietyRatio > 0.45` **y**
`topSessionRatio < 0.75` (`qualityReview.ts:545-558`)— más dos compuertas de
tamaño. El conjunto mínimo auditable es:

| Campo | Tipo |
|---|---|
| `squashSessionCount` | número \| `null` |
| `squashDrillUseCount` | número \| `null` |
| `squashUniqueDrillCount` | número \| `null` |
| `squashDrillVarietyRatio` | número \| `null` |
| `squashTopDrillUseCount` | número \| `null` |
| `squashTopSessionRatio` | número \| `null` |

Con eso las dos condiciones y las dos compuertas son recomputables desde el
artefacto, sin contenido. Se agregan **ahora** para que el spec de squash nazca
con medición, aunque su corrección llegue después.

### 6.3 Regla de nulos

`null` significa **"no aplica"**. `0` significa **"se midió y dio cero"**. No son
intercambiables, y ningún consumidor puede tratarlos como equivalentes.

"Semana sin bloque" **no es un caso**: el resolvedor de §4.4 siempre produce un
bloque, declarado o legacy. Las fronteras reales son:

| Situación | Valor |
|---|---|
| Semana **con** contables de fuerza y **sin** semana anterior comparable en su bloque | `strengthCountableOverlapMax = 0` |
| Semana **sin** contables de fuerza | `strengthCountableOverlapMax = null` |
| Plan de squash con **cero** sesiones de squash en el bloque | `squashSessionCount = 0`, **no** `null` — si no, la compuerta `< 3` no es recomputable |
| Denominador cero (sin usos de drill) | conteos en `0`, **ratios en `null`** |
| Plan **no** squash, o semana que **no** es la última del bloque | todas las métricas de squash en `null` |

## 7. Tests

Fixtures **deterministas, sin LLM**. La aceptación funcional vive acá.

**Contrato de rol (§3.1):** las cinco reglas, incluidas sesión que arranca con
core, sesión que arranca con power, sesión solo de core/power (sin exención) y
ejercicio desconocido (nunca exento).

**Comparación (§3.2):** principal→accesorio cuenta; principal y accesorio en dos
sesiones de la posterior cuenta una vez; warning exactamente en ≥3 distintos.

**Helper compartido (§3.1.1):** `qualityReview` y `repairWeek` consumen la
**misma** función. Un test que recorra la librería y compare las dos rutas de
consumo falla si alguien reimplementa la resolución en un lado.

**Rotación (§4.2):** preservación de `movement`; preservación del `main_lift`;
preservación total en la semana 0 del bloque; sin duplicados dentro de la sesión
**ni entre sesiones de la semana**; respeto de equipamiento, fase y riesgo;
desconocidos intactos.

**Resolvedor de bloque (§4.4):** equivalencia entre review y rotación en las tres
filas de la tabla. El caso legacy debe dar índices ordinales crecientes, **no `0`
para todas** —ese es el bug que el resolvedor existe para cerrar—; el caso fuera
de rango debe dar grupo unitario e índice `0`; y fases legacy no contiguas con el
mismo nombre deben caer en el mismo grupo.

**Condiciones de la razón correctiva (§4.5):** no corrige contra una
`previousWeek` de **otro** bloque; no corrige con `previousWeek` en shell; usa el
umbral de ≥3 distintos a nivel semana; y mide sobre la **entrada original**, de
modo que aplicar política antes no cambia el desempate.

**Normalización de dos razones (§4.5):**

- El `main_lift` no se toca en **ninguna** de las dos razones, ni siquiera cuando
  hay colisión observada contra una `previousWeek` que sí está `ready`.
- La sesión **no** se reconstruye entera: la sustitución es uno-a-uno y el
  conteo de ejercicios no cambia.
- Cuando colisión y política eligen el mismo cambio, se cuenta **una sola vez y
  como `corrective`**.

**Reemplazo completo (§4.6):** el ejercicio sustituto **no hereda** `weight`,
`notes`, `group`, `targetPercent1RM`, `targetRpe` ni `warmupSets`. Caso testigo
explícito: accesorio **sin** referencia de 1RM que reemplaza a uno **con**
`targetPercent1RM` no puede quedar con ese campo.

**Invariantes de idempotencia y taxonomía:**

- Segunda ejecución sobre una sesión ya normalizada: **mismo resultado y
  `strengthAccessoryRotationActionCount = 0`**.
- Una semana con **solo** rotación de política conserva **exactamente el mismo
  `countRepairsV2`** y **no puede** crear `quality.generation.high_repair_count`.

**Telemetría (§6.3):** `null` y `0` no son intercambiables. Un test por frontera
real de la tabla de §6.3:

- Semana con contables de fuerza y sin anterior comparable en su bloque →
  `strengthCountableOverlapMax = 0`.
- Semana sin contables de fuerza → `strengthCountableOverlapMax = null`.
- **Bloque de squash sin sesiones de squash → conteos en `0` y ratios en
  `null`.** Es el caso que hace recomputable la compuerta `< 3`.
- Plan no squash, o semana que no es la última del bloque → métricas de squash en
  `null`.

**Regresión:** `strengthSelectorPhase2.test.ts` y `repairWeekPhase2Wiring.test.ts`
siguen verdes.

## 8. Verificación en generación real

Los artefactos existentes **no se pueden re-scorear**: la allowlist de
`artifact.mjs:83` excluye `sessions` y `exercises` a propósito. Hacen falta
fixtures deterministas (§7) y después una corrida nueva.

Una sola corrida `high`, compartida con el spec de squash cuando ambos aterricen,
para no pagar dos.

**No es un gate mecánico.** En particular, **no** se usa "post-fix < 10/12": la
definición de `repeated_template` cambia en esta misma entrega, así que una caída
se explicaría sola por el check nuevo sin decir nada sobre la rotación. El 10/12
repetido en C/A/B es evidencia fuerte de que el defecto viejo era estructural,
pero **no es una línea base directamente comparable**.

La corrida es un **smoke conjunto** que reporta:

- Incidencia de `repeated_template`, esperablemente menor.
- Solape contable máximo por semana (§6.2).
- Rotaciones aplicadas (§6.1).
- `countRepairsV2` y `high_repair_count` **sin inflación atribuible a la
  política**.
- **Deltas descriptivos** de score y latencia.

**Lo que la corrida no puede verificar.** El artefacto excluye `sessions` y
`exercises` a propósito, así que **main lifts preservados, `movement` conservado
y densidad válida no son observables desde ahí**. Esas invariantes viven en los
tests deterministas de §7. Si en algún momento se quisieran vigilar en
generación real, la única forma admisible es un **contador derivado de
violaciones** —cuántas veces se rompió la invariante— sin contenido; este spec
no lo incluye.

**Por qué "deltas descriptivos" y no "sin regresión".** El score **cambia
mecánicamente** porque cambia la definición del warning: comparar el score
post-fix contra el de C mide la nueva definición, no la calidad. Y una sola
corrida en otro commit no estima regresión de latencia — es exactamente el
problema de piso de ruido que dejó abierta la Fase 2. Se reportan como
descripción, no como gate.

La corrección **no depende** de que esa muestra dé cero.

## 9. Riesgos y límites

- **Los desconocidos pueden sostener un warning solos.** No son rotables. Límite
  aceptado.
- **La rotación reduce colisiones, no las elimina.** §4.1.
- **El pool efectivo es menor que el crudo.** Crudo por patrón: locomotion 23,
  pull 13, push 10, hinge 10, squat 8, rotation 7, carry 6. Equipamiento, fase y
  riesgo lo recortan; `carry` es el más ajustado.
- **`blockRotationGroup` cubre solo 19 ejercicios** (A=5, B=7, C=7), así que la
  dispersión **no puede apoyarse solo en grupos**: necesita orden determinista
  dentro del `movement`.
- **Squash queda sin corregir en esta entrega.** Su telemetría se agrega ahora;
  su rotación va en spec propio.
- **El refactor toca un repair en producción.** §4.5 no es aditivo: cambia el
  camino correctivo existente. El riesgo se acota con la regresión de
  `repairWeekPhase2Wiring.test.ts` y con la invariante de que el `main_lift` no
  se toca en ninguna razón — que hoy **no se cumple**.
- **Los planes legacy cambian de comportamiento.** Hoy no rotan nunca porque
  `computeWeekIndexInBlock` los deja todos en índice 0. Con el resolvedor
  compartido pasan a rotar. Es la corrección buscada, pero es un cambio de
  comportamiento en planes existentes y hay que decirlo en voz alta.
- **Las invariantes de contenido no son observables en producción.** Main lifts,
  `movement` y densidad solo se verifican en tests (§8).

## 10. No-objetivos

- No se cambia el umbral ≥3.
- No se cambia `getStrengthExerciseRole` ni el comportamiento de
  `strengthSelector`.
- No se cambia la concurrencia (3) ni ninguna directiva de request: la Fase 2
  cerró con `high` productiva.
- No se agrega una categoría a `RepairTaxonomyV2`.
- No hay migración Dexie (sigue en v18) ni Supabase, ni bump de backup.

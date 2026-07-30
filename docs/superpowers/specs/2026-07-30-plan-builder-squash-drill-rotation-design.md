# Plan Builder — variedad de squash: rotación determinista de drills por sesión

**Fecha:** 2026-07-30
**Estado:** diseño aprobado, pendiente de plan de implementación
**Spec hermano:** `docs/superpowers/specs/2026-07-27-plan-builder-strength-accessory-rotation-design.md`
**Origen:** hallazgo lateral de la campaña de velocidad Fase 2
(`docs/superpowers/experiments/plan-builder-speed-phase-2/`)

Este spec **hereda** del spec de fuerza el resolvedor compartido de bloque
(§4.4), el patrón de normalización única con dos razones (§4.5), la regla de
medir sobre la entrada original, y las seis métricas de telemetría de squash
(§6.2). No los redefine: los consume.

## 1. Problema

Bajo la configuración productiva (`high`), `quality.squash.low_drill_variety`
apareció en **6/12 planes** del control C — que son **6 de los 8 planes de familia
squash**. Los seis planes que salen `needs_review` son exactamente los de squash.

### 1.1 El desajuste no es el mismo que en fuerza

`diversifyDuplicateSquashSessions` (`repairWeek.ts:1269`) **funciona** sin
`previousWeek`: el `Set` de firmas es local a la semana y `usedDrills` se acumula
dentro de la semana. La semana previa solo enriquece la elección de reemplazos.

El desajuste real es de **unidad de medida**:

| Capa | Qué mira |
|---|---|
| Repair | firmas **duplicadas exactas** entre sesiones de la **misma semana** |
| Check (`qualityReview.ts:532`) | **variedad acumulada de todo el bloque** |

Una semana con tres sesiones de squash cuyas firmas difieren aunque compartan dos
de tres drills **nunca dispara el repair**, y el bloque completo puede quedar con
variedad pésima. Son dos preguntas distintas, no una reparación que falla.

### 1.2 Dos condiciones, y no sabemos cuál ata

`qualityReview.ts:558` continúa —es decir, **no** marca— solo si se cumplen las
dos:

```ts
if (varietyRatio > 0.45 && topSessionRatio < 0.75) continue
```

Por lo tanto marca cuando **cualquiera** falla:

- **A — pocos drills distintos:** `únicos / usos ≤ 0,45`.
- **B — un drill domina:** `topCount / squashSessions.length ≥ 0,75`.

Más dos compuertas de tamaño: `squashSessions.length >= 3` y
`drillKeys.length >= 8`.

**Precisión sobre B.** `topCount` es `Math.max(...counts.values())` sobre el
conteo de **usos** (`qualityReview.ts:549-557`), **no** la cantidad de sesiones
distintas que contienen el drill. La fórmula real es entonces
**`usos del drill más usado / cantidad de sesiones`**, y **puede exceder 1** si un
drill aparece dos veces en la misma sesión. La lectura intuitiva —"aparece en
≥75% de las sesiones"— coincide con la fórmula **solo si no hay drills repetidos
dentro de una misma sesión**. Esa deduplicación intra-sesión la hace
`sanitizeSquashDrillSets` vía `dedupeSquashDrillsByName` (`repairWeek.ts:670`)
—no `diversifyDuplicateSquashSessions`, que diversifica **firmas entre sesiones**—,
pero **no es una precondición garantizada** y el diseño no debe asumirla.

**Con los datos de la campaña no se puede saber cuál venía fallando.** El mensaje
del issue trae los números (`${uniqueCount} drills únicos sobre
${drillKeys.length} usos`), pero el artefacto guarda **solo `issueCodes`**, no
mensajes.

Consecuencia de diseño, no accidente: **este spec ataca las dos condiciones**, y
las seis métricas del spec de fuerza (§6.2) dirán *después* cuál era la que
ataba. Queda escrito para no descubrirlo al leer el resultado.

### 1.3 La metadata disponible es pobre

44 drills en `SQUASH_DRILL_LIBRARY`. Del `interface SquashDrillDefinition`:
`partnerRequired` y `executionMode` **nunca se declaran**, y `phaseAppropriate`
aparece **una sola vez**. Los filtros del selector funcionan por `tags` y por
derivación (`resolveDrillExecutionMode`), no por esos campos.

Cobertura real sobre 44: `category` 44 (**technical 20**, tactical 12, physical 7,
match 5), `progressionLevel` 44, `focus` 44, `tags` 44, `intensity` 44, e
`intent` solo **23**.

Los conteos son de literales **dentro de `SQUASH_DRILL_LIBRARY`**: contar
`category:` sobre el archivo completo da 22 technical porque incluye dos objetos
fallback de `orderSquashDrillsForSession` (`drillLibrary.ts:77`), que no son
drills seleccionables.

No hay análogo de `movement`. El eje de preservación hay que elegirlo, y no puede
ser `intent` porque cubre la mitad de la librería.

## 2. Alcance

**Entra:** el contrato de rotación determinista de drills (§3), incluida la
**normalización única de contenido** que absorbe `diversifyDuplicateSquashSessions`
y `enforceSquashSignatureUniqueness` (§3.3); la semántica de reemplazo (§4); la
invariante `drills` ↔ `blocks` (§5); la API enfocada sin válvula y su contador de
omisiones (§6); la taxonomía paralela (§7); la telemetría propia (§8) y sus tests
(§9).

**No entra:** cambio de los umbrales del check (`0.45`, `0.75`) ni de sus
compuertas (`>= 3`, `>= 8`); cambio de `selectSquashDrills` en su camino actual;
ampliación de `category` cuando el pool aprieta (§6 lo deja como follow-up
medible); cualquier migración Dexie o Supabase (no hay ninguna).

## 3. Contrato de rotación (congelado)

Igual que en fuerza: **rotación determinista que reduce colisiones**, no garantía
de cero warnings (§11).

### 3.1 Eje preservado: dos condiciones, no una

Preservar `sessionKind` **no alcanza**, por dos razones concretas:

1. `inferSquashKindFromProposalDetails` (`repairWeek.ts:1238`) **devuelve el
   `sessionKind` almacenado tal cual** cuando existe y no es `match`
   (`if (details.sessionKind && details.sessionKind !== 'match') return
   details.sessionKind`). No siempre lo deriva de los drills, así que dejarlo
   intacto **no prueba** que la estructura de la sesión se conservó.
2. `category` y `resolveSquashDrillKind()` son **ejes distintos**. Un drill
   `technical` puede resolver como `control` por sus `tags`. Sustituirlo por otro
   `technical` que resuelva como `technical` cambia los `blocks` y puede convertir
   una sesión `mixed` en otra cosa, aunque §4 deje `sessionKind` sin tocar.

Por eso el candidato de reemplazo debe cumplir, **todas**:

- Misma **`category`** que el drill original.
- Mismo **`resolveSquashDrillKind()`** que el drill original.
- Compatibilidad con **fase, fatiga, exposición competitiva y disponibilidad de
  partner**, usando los filtros existentes del selector.

**Postcondición estructural, redactada con precisión.** "Multiconjunto de tipos de
bloque" es incorrecto: `buildSquashBlocksFromDrills` (`repairWeek.ts:650`) agrupa
en un `Map<SquashSessionBlockKind, SquashDrill[]>`, así que produce **como máximo
un bloque por kind**. Lo que se preserva es:

1. El **multiconjunto de `resolveSquashDrillKind()` por drill/slot** — esto es lo
   que impide que a una sesión `mixed` le desaparezca una de sus partes.
2. Como consecuencia directa de (1), el **conjunto** (no multiconjunto) de `kind`
   de `blocks`.
3. El **`sessionKind` efectivo**, definido explícitamente: si tras la sustitución
   queda **un solo** kind entre los drills, ese kind; si queda **más de uno**,
   `mixed`.

**Esta postcondición aplica solo a la razón de política.** La razón correctiva con
relajación (§6.1) puede alterarla —hoy ya lo hace, reconstruyendo una segunda
sesión de match como no-match— y exigírsela la volvería irrealizable.

Si con las restricciones estrictas el pool queda vacío, entra la **omisión** de §6.

**`focus`** entra como **preferencia de scoring**, no como filtro duro: filtrarlo
colapsaría el pool a uno o dos candidatos, que es exactamente donde la válvula del
selector se rinde.
- **Semana 0 del bloque: se desactiva la razón de política, y solo esa.** Mismo
  argumento que en fuerza para la política: es la primera semana que el usuario ve
  (~24 s) y no se le reescriben los drills. Pero **la razón correctiva sigue
  activa**, porque las firmas duplicadas son **intra-semana** y pueden existir
  precisamente ahí; hoy se corrigen y desactivarlas sería una regresión silenciosa.
  En semana 0: contadores de política en **`null`**, y la corrección de firmas
  sigue entrando en `corrective` y `repairedSessionCount` como hoy.
- **Semanas 1+:** se aplica dispersión determinista.

### 3.2 Coordenada determinista y conjunto de exclusión

La coordenada congelada tiene **tres** componentes:

```
(weekIndexInBlock, squashSessionOrdinal, drillOrdinal)
```

- `squashSessionOrdinal` **no es cosmético**: el check cuenta **sesiones del
  bloque**, no semanas. Sin él, la condición B queda fuera de alcance por
  construcción.
- `drillOrdinal` tampoco: sin él, **dos drills de la misma `category` dentro de
  una misma sesión consultarían el mismo pool con el mismo offset** y podrían
  resolver al mismo candidato.

**Orden total del pool.** Los candidatos se ordenan de forma **total y estable**
antes de indexar —criterio explícito y documentado, con `id` como desempate
final—, de modo que el mismo pool produzca siempre la misma secuencia. Sin orden
total, el índice no es determinista aunque la coordenada lo sea.

**Conjunto de exclusión.** "No repetir" se congela como la unión de:

1. El **drill original** que se está sustituyendo.
2. Los **demás drills originales de esa semana** (todas sus sesiones de squash).
3. Los **sustitutos ya elegidos en esa misma sesión**.
4. Los **sustitutos ya elegidos en otras sesiones de esa semana**.

Regla mínima e irrenunciable: **la normalización no puede introducir un nombre que
ya esté presente en el resultado final de esa semana.** Eso incluye lo que dejó
intacto y lo que ella misma sustituyó.

Nótese que el conjunto es **de semana**, no de bloque: las semanas anteriores no
están disponibles bajo concurrencia (es la misma limitación que §11 declara para
la ausencia de garantía).

**Determinismo estricto**, con el mismo contrato que fuerza: sin `Math.random`,
sin `Date`, sin depender del orden de iteración de un `Map`/`Set` no ordenado
explícitamente.

### 3.3 Una sola normalización de contenido, dos razones

El pipeline actual encadena **cinco** mutadores de squash (`repairWeek.ts:194-200`):

```
13.  diversifyDuplicateSquashSessions
     normalizeSquashSemanticMetadata
     normalizeLateTaperSquashMatchPlay
     ensureSquashCompetitionMatchExposure
13b. enforceSquashSignatureUniqueness        (declarada en repairWeek.ts:1511)
```

`enforceSquashSignatureUniqueness` **puede reconstruir sesiones completas**, así
que agregar un paso de rotación sin definir la propiedad del estado final dejaría
dos reconstructores capaces de deshacerse mutuamente — y con eso se cae la
idempotencia de §9.

**Contrato congelado.** Existe **una sola normalización de contenido de squash**,
que es la **única dueña del estado final de los drills**:

- **Se ejecuta después** de los cambios semánticos y de exposición competitiva
  (`normalizeSquashSemanticMetadata`, `normalizeLateTaperSquashMatchPlay`,
  `ensureSquashCompetitionMatchExposure`), para ver el estado semántico definitivo.
  Esos tres **no se integran** y conservan su comportamiento.
- **Absorbe** `diversifyDuplicateSquashSessions` y
  `enforceSquashSignatureUniqueness`: son los dos mutadores de **contenido**, y
  pasan a ser aspectos de la normalización única.
- La **unicidad de firmas es una postcondición absoluta** de esa misma
  normalización, no un paso posterior que pueda deshacerla. Se sostiene
  fail-closed: si no se alcanza, la candidata se rechaza (§6.3).

**Dos razones**, con la misma semántica que §4.5 del spec de fuerza:

| Razón | Cuándo | Dónde se cuenta |
|---|---|---|
| **Política de rotación** | dispersión determinista de §3.2 | `squashDrillRotationActionCount` (§7) |
| **Firma duplicada exacta observada** | duplicado real medido **sobre la entrada original** | `corrective`, como hoy |

Hereda de §4.5 del spec hermano, sin reinterpretación: se mide **sobre la entrada
original** (antes de aplicar política, para que el desempate sea estable), en el
empate prevalece **`corrective`**, y las **unidades** son las de §7 —`corrective`
y `repairedSessionCount` una vez por sesión afectada; contadores de política por
drill.

**Costo aceptado de preservar la semana 0:** sus sesiones de squash cuentan para
la condición B y quedan fuera de la dispersión. En bloques cortos eso limita
cuánto puede mejorar el ratio de dominancia. Es el precio de no reescribir la
primera semana, y se elige a sabiendas.

## 4. Qué significa reemplazar un drill

`SquashDrill` es `{ name, durationMin?, notes?, executionMode? }`
(`src/types/index.ts:265`).

| Campo | Qué pasa |
|---|---|
| `name` | **se reemplaza** |
| `durationMin` | **se preserva** — es forma de la sesión, no del drill; mantiene el presupuesto de tiempo |
| `notes` | **no se hereda** — describe el drill anterior |
| `executionMode` | **no se hereda** — sale del drill nuevo vía `resolveDrillExecutionMode`, porque determina viabilidad solo/partner |

`SquashDetails.trainingFocus` y `SquashDetails.sessionKind` son de **sesión** y no
se tocan.

La sustitución es **uno-a-uno**: el conteo de drills de la sesión no cambia.

## 5. Invariante `drills` ↔ `blocks`

`blocks` es una **proyección** de `drills`:
`details.blocks = buildSquashBlocksFromDrills(details.drills)` aparece en
`repairWeek.ts:581`, `603`, `700` y `1005`.

Y `getSquashDrillKeys` (`qualityReview.ts:210`) lee `details.drills` cuando tiene
elementos, cayendo a `details.blocks[].drills` **solo si `drills` está vacío**.

Por lo tanto la rotación **no** rota dos estructuras, pero sí debe cerrar el
ciclo: **tras rotar `drills`, `blocks` se reconstruye con
`buildSquashBlocksFromDrills`.** Omitirlo deja al check leyendo una cosa y a la
UI/PDF otra, sin que ningún test lo note.

## 6. La API enfocada no tiene válvula

`selectSquashDrills` (`drillSelector.ts:109`) se rinde bajo presión de pool:

```ts
const basePool = withoutRecent.length >= 3 ? withoutRecent : byExecutionMode
```

Si evitar lo reciente deja menos de 3 candidatos, **readmite los recientes**.
Reusar esa ruta haría que la rotación reportara "roté" habiendo devuelto un drill
repetido: la telemetría mentiría justo en el caso que hace falta entender.

Por eso, igual que el selector de fuerza en §4.6 del spec hermano,
`drillSelector` expone una **API enfocada para la rotación, sin válvula**:

- Si existe candidato que cumpla **todas** las restricciones de §3.1 y no caiga en
  el **conjunto de exclusión de §3.2**, lo devuelve.
- Si **no** existe, devuelve explícitamente "no pude". El drill **queda como
  estaba** y se contabiliza en `squashDrillRotationOmittedCount`.

El warning puede sobrevivir en ese caso, y está bien: se sabe **por qué** y es
**medible**.

**Ampliar `category` queda fuera de alcance a propósito.** El contador de
omisiones convierte esa decisión en una pregunta medible: si la corrida muestra
omisiones altas, ampliar pasa a ser un follow-up con evidencia; si son cero, se
evita un eje difuso para siempre.

### 6.1 La omisión estricta no puede regir a la razón correctiva

Omisión estricta y unicidad de firmas como postcondición (§3.3) **no siempre
pueden cumplirse juntas**: ante una firma duplicada exacta con pool estricto
vacío, una de las dos cede.

No es hipotético. `COMPETITION_MATCH_VARIANTS` y `PRACTICE_MATCH_VARIANTS`
(`repairWeek.ts:1069-1074`) contienen **una sola variante cada uno**, así que dos
sesiones de match en la misma semana comparten firma **por construcción** y no
existe alternativa dentro de `category: 'match'`. El comportamiento actual resuelve
eso reconstruyendo la segunda sesión como **no-match** (`repairWeek.ts:1555`).

Por eso las dos razones tienen **reglas de agotamiento distintas**:

| | Política | Correctiva por firma duplicada |
|---|---|---|
| Filtros | **estrictos** (§3.1 completo) | conserva los **hard constraints**: seguridad, partner y exposición competitiva |
| Si no hay candidato | **omite**, deja el original, suma `squashDrillRotationOmittedCount` | **relaja** según jerarquía explícita |
| Postcondición estructural §3.1 | obligatoria | no exigible |

### 6.2 Jerarquía de relajación de la correctiva (congelada)

Se aplica en orden y se detiene en el primer nivel que produzca firma única:

1. Misma `category` **y** mismo kind.
2. Mismo kind, **relajando `category`**.
3. Misma `category`, **relajando kind**.
4. Cualquier `category`/kind permitido por los hard constraints, **reconstruyendo
   la identidad semántica** de la sesión (título, objetivo, `subtype`,
   `sessionKind`). Es el nivel donde hoy cae la segunda sesión de match
   (`repairWeek.ts:1555`).
5. Si tampoco hay resultado único → **fallo correctivo fail-closed** (§6.3).

**Nunca se relajan:** seguridad, fase/fatiga, disponibilidad de partner y
exposición competitiva.

**La exposición competitiva se evalúa sobre la semana final**, no sobre la sesión
aislada: convertir la segunda sesión de match en no-match es válido **solo si la
exposición requerida permanece** en la semana resultante.

### 6.3 Fallo correctivo: fail-closed (congelado)

Si la jerarquía se agota sin firma única, la normalización **no acepta** la
semana:

- Rechaza la candidata **antes** de persistirla como lista, y entra al **flujo de
  retry existente**.
- Si se agotan los intentos, la semana **termina en error**.
- **Nunca** se acepta silenciosamente una firma duplicada.

Código estable para el fallo: **`quality.squash.signature_uniqueness_unresolved`**.

Reglas duras sobre ese código:

- **No** incrementa `squashDrillRotationOmittedCount` — contaminaría la decisión de
  ampliar `category` que §6 existe para dejar medible.
- Es **distinguible** en la telemetría de retry/error, no se mezcla con otras
  clases de fallo.
- No es un warning de calidad tolerado: es un rechazo de la candidata.

**Fail-closed no ocurre solo: hay que apagar el fallback.** El loop ejecuta
`buildLocalFallbackWeek` cuando el resultado no tiene sesiones
(`asyncGenerationLoop.ts:1112`, `if (result.sessions.length === 0)`). Sin tocar
eso, "se agotan los intentos → semana en error" **no sucede**: se produciría una
semana de fallback en silencio, que es exactamente el resultado que §6.3 quiere
impedir. Por lo tanto se congela que este código:

1. **Conserva su `errorClass` específico** y **no** se colapsa a `validation`.
2. Es **no-fallback-eligible**.
3. Tras agotar los reintentos, **salta el fallback local** y persiste la semana
   como **error**.

Tests obligatorios: propaga el código exacto sin colapsarlo; **consume** los
reintentos; **no** invoca `buildLocalFallbackWeek`; y la semana termina en error.

Con esto, la unicidad de firmas de §3.3 es postcondición **absoluta**, sin
condicionales, y §9 y §11 pueden exigirla sin matices.

## 7. Taxonomía

Por simetría con lo congelado en el spec de fuerza (§5), y con el mismo
argumento arquitectónico —política determinista sobre salida válida, no
recuperación de salida incorrecta; precedente de `hydrationActionCount` excluida
de `countRepairsV2`—:

| Contador | Unidad |
|---|---|
| `squashDrillRotationActionCount` | por **drill** sustituido |
| `squashDrillRotationSessionsAffected` | **una vez por sesión afectada** |
| `squashDrillRotationOmittedCount` | por **drill** que no se pudo rotar (§6) |

**No incrementan** `repairedSessionCount`, `correctiveActionCount`,
`structuralActionCount` ni `countRepairsV2`.

**La razón correctiva que hoy implementan `diversifyDuplicateSquashSessions` y
`enforceSquashSignatureUniqueness` se conserva** —aunque §3.3 absorba las dos
funciones—: cuando corrige un duplicado exacto realmente observado sigue siendo
`corrective` y sigue entrando en `countRepairsV2`. No se esconden reparaciones
genuinas detrás de los contadores nuevos.

El **fallo correctivo** de §6.3 se reporta aparte y **nunca** como omisión de
política.

**No se agrega una cuarta categoría a `RepairTaxonomyV2`.**

## 8. Telemetría

Las **seis métricas de bloque** (`squashSessionCount`, `squashDrillUseCount`,
`squashUniqueDrillCount`, `squashDrillVarietyRatio`, `squashTopDrillUseCount`,
`squashTopSessionRatio`) ya están especificadas en el spec de fuerza §6.2, con su
regla de nulos, y se registran en la **última semana del bloque**. Este spec las
**consume**; no las redefine.

Agrega, estampados en `generationMeta` durante la generación:

| Campo | Tipo |
|---|---|
| `squashDrillRotationActionCount` | número \| `null` |
| `squashDrillRotationSessionsAffected` | número \| `null` |
| `squashDrillRotationOmittedCount` | número \| `null` |

Misma regla de nulos que el spec hermano: `null` es **"no aplica"** (semana sin
sesiones de squash, semana 0 del bloque); `0` es **"se midió y dio cero"**.

### 8.1 Derivada al cerrar el plan: incidencia del fallo fail-closed

Sin esto, **la corrida no puede medir §6.3**. Los intentos guardan `errorClass`,
pero el artefacto **no conserva errores por intento**: si el primer intento falla
por unicidad y el segundo funciona, el evento **desaparece del reporte** y el
riesgo operativo de §11 queda invisible justo cuando más importa observarlo.

Campo derivado en `buildWeekRows()` (`scripts/loadtest-plan-builder.mjs:168`), que
ya agrega todos los intentos de cada semana:

| Campo | Tipo | Cálculo |
|---|---|---|
| `squashSignatureUniquenessFailureAttemptCount` | número \| `null` | intentos de esa semana cuyo `errorClass` sea `quality.squash.signature_uniqueness_unresolved` |

Semántica en el artefacto:

- **`0`** — telemetría de intentos disponible y **ningún** intento afectado.
- **`null`** — telemetría de intentos **no disponible**. No es lo mismo que cero.

Entra en la **allowlist de `toWeekRow`** (`artifact.mjs:83`), como todo lo demás:
es un número, no contenido.

El **reporte** agrega por **intentos**, **semanas** y **planes** afectados. Los
tres, no uno: sin esa separación no se distingue un retry repetido sobre una misma
semana de una incidencia extendida sobre varios planes, que son problemas de
tamaño muy distinto.

## 9. Tests

Fixtures **deterministas, sin LLM**. La aceptación funcional vive acá.

**Eje preservado (§3.1):** el sustituto conserva `category` **y**
`resolveSquashDrillKind()` del original; `focus` influye en el orden pero **no**
excluye candidatos. Postcondición **de la razón de política**: se conserva el
**multiconjunto de `resolveSquashDrillKind()` por drill/slot**, y en consecuencia
el **conjunto** de kinds de `blocks` y el **`sessionKind` efectivo** (un solo kind
→ ese kind; más de uno → `mixed`). Caso testigo obligatorio: sesión `mixed` cuyas
partes deben seguir todas presentes.

**Semana 0 (§3):** dos casos, no uno.

- Semana 0 **sin** firmas duplicadas → drills intactos y contadores de política en
  `null`.
- Semana 0 **con** firmas duplicadas → **sí se corrige**, entra en `corrective` y
  `repairedSessionCount`, y **no** genera contadores de política.

**Filtros duros (§3.1):** preservar `category` y kind **no** cubre las
restricciones de contexto, así que van sus propios tests.

- Contexto `solo` **nunca** selecciona un drill que requiera partner o sea de
  match.
- Taper, fatiga y exposición competitiva **nunca** reintroducen un candidato que
  los filtros actuales habían excluido.

**Agotamiento y fallo (§6.1-6.3):** con pool estricto vacío, la política **omite** y
suma `squashDrillRotationOmittedCount`; la correctiva **relaja** siguiendo los
cinco niveles de §6.2 en orden. Caso testigo obligatorio: **dos sesiones de match
en la misma semana**, donde la única variante disponible hace la firma única
imposible dentro de `category: 'match'` y el nivel 4 reconstruye la segunda como
no-match.

**Fail-closed (§6.3):** cuando la jerarquía se agota, la candidata se **rechaza**
—no se persiste como lista— con
`quality.squash.signature_uniqueness_unresolved`, y **no** incrementa
`squashDrillRotationOmittedCount`. Test explícito de que una firma duplicada
**nunca** sobrevive a la normalización, que es precisamente lo que hoy sí puede
pasar.

**No-fallback-eligible (§6.3):** el código se propaga **exacto**, sin colapsar a
`validation`; **consume** reintentos; **no** invoca `buildLocalFallbackWeek`; y la
semana termina en **error**. Sin este test, fail-closed degrada a "semana de
fallback silenciosa".

**Contador de incidencia (§8.1):** un fallo **recuperado por retry** —primer
intento falla, segundo funciona— **sí** incrementa
`squashSignatureUniquenessFailureAttemptCount`. Y `0` (medido, sin incidencia) se
distingue de `null` (telemetría de intentos ausente).

**Exposición competitiva sobre la semana final (§6.2):** el nivel 4 no puede
eliminar la exposición requerida; test con una semana donde convertir la segunda
sesión de match dejaría la semana sin la exposición mínima.

**Coordenada y exclusión (§3.2):** dos sesiones de squash de la misma semana, y
dos drills de la misma `category` dentro de una misma sesión, producen
**resultados distintos** cuando el pool alcanza — no basta con verificar que los
*offsets* difieren, porque offsets distintos pueden resolver al mismo candidato.
Y ningún nombre introducido puede ya existir en el resultado final de esa semana.
Es el test que protege la condición B.

**Normalización única (§3.3):** la unicidad de firmas se cumple **a la salida de la
normalización**, y ningún paso posterior reescribe drills. Test de que política y
razón correctiva no se deshacen mutuamente sobre la misma sesión.

**Reemplazo (§4):** `durationMin` se preserva; `notes` y `executionMode` **no** se
heredan; el conteo de drills de la sesión no cambia.

**Invariante `drills` ↔ `blocks` (§5):** tras rotar, `blocks` reconstruido y
consistente con `drills`. Caso testigo: sesión que llega con `blocks` poblado y
`drills` poblado.

**API sin válvula (§6):** con un pool artificialmente reducido a cero candidatos
válidos, la rotación **no** devuelve un drill repetido: deja el original e
incrementa `squashDrillRotationOmittedCount`.

**Idempotencia:** segunda ejecución sobre una sesión ya normalizada da el mismo
resultado y `squashDrillRotationActionCount = 0`.

**Taxonomía (§7):** una semana con **solo** rotación de política conserva
exactamente el mismo `countRepairsV2` y **no puede** crear
`quality.generation.high_repair_count`.

**Regresión:** los tests existentes de `diversifyDuplicateSquashSessions` y del
selector de drills siguen verdes.

## 10. Verificación en generación real

**Una sola corrida `high`, compartida con el spec de fuerza**, ejecutada cuando
ambas implementaciones estén en el mismo commit limpio. No se paga una por spec.

Los artefactos existentes **no se pueden re-scorear**: la allowlist de
`artifact.mjs:83` excluye `sessions` y `exercises` a propósito.

**No es un gate mecánico** — pero por razones que hay que separar, porque no son
las mismas que en fuerza:

- **La incidencia de `low_drill_variety` sí es descriptivamente comparable.** Este
  spec **no cambia** la definición del check: los umbrales `0.45` / `0.75` y las
  compuertas quedan intactos (§12). Así que el 6/8 de planes de squash del control
  es una referencia legítima para contrastar, a diferencia de lo que pasa con
  `repeated_template` en el spec de fuerza, donde la definición sí cambia.
- **El score global no es comparable limpiamente**, porque el spec de fuerza
  cambia su propia definición de warning y las dos entregas viajan en el mismo
  commit.
- **La latencia de una sola corrida no estima regresión.** Es el problema de piso
  de ruido que dejó abierta la Fase 2.

Sigue sin ser gate: la aceptación funcional vive en §9. Pero la comparación
descriptiva de incidencia acá vale más que en el spec hermano.

La corrida reporta:

- Incidencia de `low_drill_variety`, esperablemente menor.
- **Las seis métricas de bloque**, que revelan por fin **cuál de las dos
  condiciones** ataba (§1.2).
- Rotaciones aplicadas y **omitidas** (§6), que deciden si hace falta el
  follow-up de ampliar `category`.
- **Incidencia de `quality.squash.signature_uniqueness_unresolved`** (§8.1),
  agregada por intentos, semanas y planes. **Un fallo recuperado por retry debe
  aparecer igual en el contador**: es el caso que hoy se perdería, y el que decide
  si tolerar vs rechazar vuelve a estar sobre la mesa (§11).
- `countRepairsV2` y `high_repair_count` **sin inflación atribuible a la
  política**.
- **Deltas descriptivos** de score y latencia.

**Lo que la corrida no puede verificar:** el artefacto no contiene drills ni
sesiones, así que "`category` preservada" y "`blocks` consistente con `drills`"
**no son observables** desde ahí. Viven en §9. Si alguna vez se quisieran vigilar
en generación real, la única forma admisible es un contador derivado de
violaciones, sin contenido; este spec no lo incluye.

## 11. Riesgos y límites

- **Reduce colisiones, no las elimina.** La condición B es una propiedad **global
  del bloque** y la semana 0 queda **preservada de la razón de política** —la
  correctiva sí opera ahí—: el mecanismo no puede garantizar que ningún drill
  alcance el 75%.
- **Fail-closed crea una invariante que hoy no existe.** El código actual hace
  `if (nextSignature) seen.add(nextSignature)` **sin comprobar** que la firma no
  estuviera ya en `seen` (`repairWeek.ts:1557-1559`), así que hoy una firma
  duplicada **puede sobrevivir en silencio**. Adoptar §6.3 no formaliza una
  invariante vigente: la establece por primera vez, y puede hacer fallar semanas
  que hoy se entregan con firmas duplicadas. Es el riesgo de mayor impacto
  operativo del spec, y la corrida compartida debe reportar la incidencia de
  `quality.squash.signature_uniqueness_unresolved`.
- **Ataca dos condiciones a ciegas.** Hasta la corrida no sabremos cuál ataba
  (§1.2). Es posible que una de las dos ya estuviera holgada y el esfuerzo se
  concentre donde no hacía falta.
- **El pool efectivo es desconocido por fase.** 44 drills crudos, pero
  `filterByPhase` recorta por `tags` y `taper` es el más restrictivo (excluye
  `rsa`, `multiball`, `match_play` y `intensity: 'high'`). El contador de
  omisiones es el que lo va a revelar.
- **La metadata de la librería es pobre** (§1.3). Si `category` resulta demasiado
  gruesa para preservar el carácter de la sesión, el arreglo correcto es
  enriquecer la librería —backlog 4, "librerías entendibles"— y no afinar el
  rotador.
- **`intent` no se usa** aunque parezca el eje natural: cubre 23 de 44 drills.
- **Toca dos repairs en producción, no uno.** §3.3 no es aditivo: absorbe
  `diversifyDuplicateSquashSessions` y `enforceSquashSignatureUniqueness` en una
  sola normalización. Es el cambio de mayor riesgo del spec, y lo que lo acota es
  que la unicidad de firmas pasa a ser **postcondición verificada** en vez de un
  paso posterior.
- **El conjunto de exclusión es de semana, no de bloque** (§3.2). Las semanas
  anteriores no están disponibles bajo concurrencia, así que un drill puede
  reaparecer entre semanas distintas del mismo bloque. Es la misma raíz por la que
  no hay garantía.

## 12. No-objetivos

- No se cambian los umbrales `0.45` / `0.75` ni las compuertas `>= 3` / `>= 8`.
- No se cambia `selectSquashDrills` en su camino actual, ni se le quita la
  válvula: la rotación usa una API nueva y acotada.
- No se amplía `category` cuando el pool aprieta (§6).
- No se enriquece la librería de drills: eso es backlog 4.
- No se cambia la concurrencia (3) ni ninguna directiva de request.
- No se agrega una categoría a `RepairTaxonomyV2`.
- No hay migración Dexie (sigue en v18) ni Supabase, ni bump de backup.

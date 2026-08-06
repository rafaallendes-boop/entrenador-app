# Superseries de fuerza — diseño

Fecha: 2026-08-05
Estado: aprobado, sin implementar
Migraciones: **ninguna** (Dexie y Supabase sin cambios)
Costo de API: **cero** — todo lo verificable acá se verifica local

## 1. Problema

Las sesiones de fuerza se representan como una lista plana de ejercicios 1 a 1.
Un entrenamiento real de sala se estructura en grupos que se rotan por rondas:

```
4 series de:  plancha frontal + abs ruso con balón + puente de glúteo
4 series de:  clean + dominadas + saltos al cajón
4 series de:  trapbar deadlift + remo máquina + saltos largos
4 series de:  sentadilla + saltos verticales
finisher:     4 × 30s on / 30s off en trotadora
```

Hoy eso se registra como diez ejercicios sueltos y se pierde la estructura.

Existe ya un reconocimiento explícito del problema en el código, resuelto como
hack de prompt (`src/services/ai/promptModules/strengthPrompt.ts:157`):

> «Etiquetado por bloques: en el campo `notes` de cada ejercicio, prefija una
> letra+indice… Esto comunica supersets implicitos sin requerir cambio de
> schema.»

El resultado es agrupación como texto libre dentro de `notes`, que la UI ignora
por completo y que el Plan Builder ni siquiera produce, porque no pasa por ese
prompt. Este proyecto convierte esa convención en estructura y retira el hack.

## 2. Alcance

**Dentro:** agrupación de ejercicios de fuerza en superseries/triseries/
circuitos, en los tres caminos — editor manual, chat y Plan Builder.

**Fuera, declarado:**

- **Carga por serie** (`Clean 40-45-50-50 kg`). Hoy `Exercise.weight` es un solo
  número y `warmupSets` es aproximación, no series de trabajo. Es un proyecto
  independiente y toca el cálculo de carga estabilizado en §18–§19 del roadmap.
- Descanso entre rondas: no se modela.
- Tríos automáticos: el modelo de datos y el editor los admiten sin límite de
  cardinalidad; la heurística no los genera en v1.
- Backfill de sesiones existentes y limpieza de los prefijos `A1/A2` históricos
  que quedan en `notes`.
- Superseries fuera de fuerza (squash, movilidad).
- `intent` en Plan Builder: cableado, siempre ausente en v1.

## 3. Decisiones de producto

| Decisión | Valor |
|---|---|
| Completado | Un check por ejercicio, como hoy. Sin estado nuevo. |
| Quién agrupa automáticamente | El motor determinista, no el modelo. |
| Editor manual | Crear, romper y reordenar grupos. |
| Rondas dentro de un grupo | Invariante dura: todos los miembros comparten `sets`. |
| Regla de desempate de rondas | Gana el primer ejercicio del grupo (ancla). |

Justificación de «el motor, no el modelo»: el selector determinista ya es el
productor común de los dos caminos. El Plan Builder no permite que el modelo
emita ejercicios (`planBuilderResponseSchema.ts` es `additionalProperties:false`
y no declara `exercises`; se hidratan en `repairWeek`), y en el chat
`actionPostProcessor.ts:631` y `:858` reemplazan lo propuesto por
`selectStrengthSession(...)`. Hay un solo lugar donde poner la política, y no
cuesta tokens.

## 4. Modelo de datos

```ts
export interface Exercise {
  // …campos actuales, sin cambios
  supersetGroup?: string   // id opaco y estable; NO es la etiqueta visible
}
```

El campo debe viajar por **toda la cadena**, no solo por la entidad persistida.
La política corre sobre `CoachExerciseProposal[]`, antes de materializar
`Exercise[]`, así que también lo llevan:

- `CoachExerciseProposal` (`src/types/index.ts:968`).
- El ejercicio de `CoachSessionDraft` (`coachSessionSerializer.ts:40-48`).
- El ejercicio de plantilla (`SessionTemplateExercise`).
- Las conversiones sesión ↔ borrador y plantilla ↔ borrador, en ambos sentidos.

En consecuencia son **genéricos**, pero sobre **dos contratos distintos**, porque
no todos los consumidores necesitan lo mismo:

```ts
/** Estructura pura: alcanza para agrupar, validar y renderizar. */
type SupersetMember = {
  sets: number
  supersetGroup?: string
}

/** Estructura + identidad deportiva: lo que la política necesita para decidir. */
type SupersetCandidate = SupersetMember & {
  name: string
  group?: ExerciseGroup
  libraryRef?: ExerciseLibraryRef
}
```

| Función | Contrato | Por qué |
|---|---|---|
| `normalizeSupersetGroups` | `SupersetMember` | Solo toca tags y `sets`; no resuelve identidad |
| `resolveSupersetLayout` | `SupersetMember` | Devuelve segmentos; el bloque visual lo asigna el consumidor a partir del líder (§8.1) |
| `planSupersetGroups` | **`SupersetCandidate`** | Debe resolver roles y predicados |

`SupersetMember` **no alcanza** para la política: `resolveSessionStrengthRoles`
exige `{ name, libraryRef }` (`strengthRoleContract.ts:24-26`) y
`resolveStrengthExerciseBlock` exige `{ name, group, libraryRef }`
(`strengthSessionStructure.ts:73-75`). Tipar la política sobre el contrato mínimo
obligaría a castear dentro del cuerpo, que es exactamente la clase de acoplamiento
por nombre que §18 y §19 sacaron del código de fuerza.

Ambos contratos los satisfacen `Exercise`, `CoachExerciseProposal`, el ejercicio
de `CoachSessionDraft` y `SessionTemplateExercise`, así que las tres funciones
operan igual sobre entidades persistidas y sobre propuestas, sin duplicar lógica
ni acoplarse a `Exercise`.

`session.exercises` sigue siendo **la única fuente de verdad** y sigue siendo una
lista plana. Se descartó la alternativa anidada (`exerciseBlocks` con `exercises`
como proyección) porque obligaría a mantener dos fuentes sincronizadas y a
auditar cada mutación de `repairWeek` (3292 líneas), justo sobre los contratos
posicionales de fuerza. Si A muestra límites reales, se puede migrar por dentro
sin cambiar el contrato que consume el motor.

`A`/`B`/`C` son **etiquetas derivadas por la UI** según el orden final de render,
globalmente. Mover un grupo no renombra ni reescribe el dato, y por lo tanto no
genera diffs espurios en `sessions.data` ni reescrituras de sync.

Compatibilidad: un ejercicio sin `supersetGroup` recorre exactamente el camino
actual. Sin backfill, igual que `libraryRef` en §19.

## 5. Normalizador

Módulo nuevo `src/services/training/supersetGroups.ts`, sin dependencias del
motor, al estilo de `blockIdentity.ts` y `strengthRoleContract.ts`.

```ts
normalizeSupersetGroups<T extends SupersetMember>(exercises: readonly T[]): T[]
resolveSupersetLayout<T extends SupersetMember>(exercises: readonly T[]): SupersetSegment<T>[]
```

Genéricas sobre `SupersetMember` (§4), no sobre `Exercise`: la política corre
sobre `CoachExerciseProposal[]` antes de materializar. La entrada es `readonly`
para que el compilador respalde la inmutabilidad en vez de dejarla como
convención — una mutación in-place no compila.

`normalizeSupersetGroups` es **inmutable** (devuelve una lista nueva, no muta la
entrada) e **idempotente**. Se aplica **solo sobre sesiones completas**: correrlo
mientras se agregan ejercicios de a uno disolvería por cardinalidad el primer
miembro de una superserie en construcción.

Reglas, en este orden:

1. **Contigüidad.** Se recorren segmentos por id. El **primer** segmento reclama
   el id; si el mismo id reaparece en un segmento posterior, ese segundo segmento
   se **disuelve** (pierde el tag). No se reasigna a un id nuevo: la corrupción
   debe verse como «dejó de ser superserie», nunca como «apareció un grupo
   fantasma».
2. **Cardinalidad.** Un segmento de 1 ejercicio pierde el tag. Un grupo válido
   tiene ≥ 2 miembros contiguos.
3. **Rondas.** Todo el segmento adopta el `sets` de su primer ejercicio.

El orden importa y está fijado por test: **contigüidad antes que cardinalidad**.
Consecuencia documentada, con `A, X, A, A` como caso congelado: el primer
segmento reserva el id `A` aunque después se disuelva por ser singleton, así que
el segundo segmento también pierde `A`. Ambos quedan sin grupo. Es determinista y
conservador.

Lo que el normalizador **no** hace: no reordena, no inserta, no borra. Solo
corrige tags y `sets`. Eso lo mantiene seguro frente a los contratos posicionales
de fuerza.

`resolveSupersetLayout` normaliza internamente de forma defensiva, de modo que un
consumidor de render nunca interprete como válida una estructura corrupta.

### 5.1 Puntos de aplicación

| Camino | Dónde |
|---|---|
| Generación determinista | salida de la política de agrupación |
| Chat / post-proceso | `actionPostProcessor`, al armar la sesión |
| Plan Builder | hidratación de fuerza en `repairWeek` |
| Editor manual | al guardar (`SessionForm.onSubmit`) |
| Import / restore | `dataExport` |
| Aplicar plantilla | `sessionTemplateSerializer` |

### 5.2 Serializers

`dataExport.ts` (dos allowlists de ejercicios), `sessionTemplateSerializer.ts` y
`coachSessionSerializer.ts` son **allowlists**: un campo desconocido se descarta
en silencio. `supersetGroup` debe agregarse explícitamente a cada uno.

`templateToSession` (`sessionTemplateSerializer.ts:416`) hoy re-emite `id: uuid()`
por ejercicio pero clonaría `supersetGroup` tal cual. Aplicar la misma plantilla
dos veces en un día produciría el mismo id de grupo en segmentos separados, y el
normalizador disolvería el segundo. Corrección: **`Map<oldGroupId, newGroupId>`
por aplicación de plantilla** — todos los miembros del mismo grupo reciben el
mismo UUID nuevo, y dos aplicaciones reciben UUIDs distintos.

Import/export normal **conserva** el id. El remapeo ocurre únicamente al
materializar una plantilla.

El type guard `isTemplateExercise` (`src/types/sessionTemplate.ts:184`) debe
aceptar el campo opcional; hoy valida campo por campo y una plantilla con grupos
no cambiaría de veredicto, pero un `supersetGroup` no-`string` debe rechazarse ahí
y no llegar al normalizador. Ver §7.2.1 para el tratamiento de valores vacíos.

## 6. Ordenamiento y roles

### 6.1 El conflicto

`normalizeStrengthSessionExercises` (`strengthSessionStructure.ts:35-39`)
reordena toda sesión de fuerza por bloque:

```
BLOCK_ORDER = core → olympic → legs → push → pull → other → cardio → mobility
```

Corre en ambos caminos: chat vía `enhanceStrengthSessionExercises` en
`actionPostProcessor`, y Plan Builder en `repairWeek.ts:1646`.

Dos de los cuatro grupos del entrenamiento de referencia son **cross-block**
(`olympic + pull + legs`, `legs + pull + legs`). Con contigüidad como base del
contrato, el sort actual los partiría antes de que la política pueda
preservarlos, y lo mismo haría con un grupo llegado por edición manual, plantilla
o import.

### 6.2 Ordenamiento en dos caminos

`normalizeStrengthSessionExercises` bifurca **antes** de ordenar:

- **Sin grupos** → sort actual, ejercicio por ejercicio. Idéntico a hoy.
- **Con grupos** → normaliza segmentos, arma unidades y ordena **unidades** con
  el comparador actual evaluado sobre el líder. Los miembros siguen al líder.

El comparador no cambia; cambia la unidad que se ordena. Tras formar grupos
nuevos **no vuelve a ejecutarse ningún sort individual**.

### 6.3 Roles group-aware

`resolveSessionStrengthRoles` es posicional (`core→trunk`, `power→power`, primer
restante→`main_lift`, resto→`accessory`) y `main_lift` está **exento de rotación
y de `countRepairsV2`**. Ordenar por unidades mueve esa asignación: en el ejemplo
de referencia, `dominadas` le robaría el `main_lift` al `trapbar`. Es la misma
clase de bug de §16.

Precedencia nueva, preservando la actual:

```
unknown                → unknown
core                   → trunk
power                  → power
seguidor de un grupo   → accessory
primer líder restante  → main_lift
resto                  → accessory
```

Un `core` o un `power` dentro de un grupo **conservan su rol**; la regla de
seguidor solo bloquea la elegibilidad para `main_lift`. Ambos siguen siendo
contables, así que no se abre un agujero de exención.

Los roles se calculan **antes del reflow**. La política cumple dos invariantes:

1. El `main_lift` existente nunca se usa como seguidor de otro grupo.
2. El mismo ejercicio resuelve `main_lift` antes y después del reflow.

(1) es la restricción de construcción; (2) es la propiedad que lo verifica, y
requiere **test de propiedad**, no de ejemplos: la regla del líder por sí sola no
la garantiza para un orden arbitrario. La preservación se sostiene sobre tres
condiciones juntas — `main_lift` nunca como seguidor, orden estable de unidades, y
ningún otro líder elegible adelantándose. La línea base se captura sobre **la
lista ya normalizada que recibe la política**.

Alcance: `resolveSessionStrengthRoles` y `collectCountableKeys` viven en
`strengthRoleContract.ts` (75 líneas) y los consumen solo `qualityReview.ts:512` y
`repairWeek.ts:1568,1578`. `getStrengthExerciseRole` de `exerciseLibrary.ts`
**no se toca**: lo usa únicamente `strengthSelector.ts:1043`, que corre antes de
agrupar.

## 7. Política determinista

Módulo nuevo `src/services/training/supersetPolicy.ts`, ejecutado **después** del
último sort de la sesión.

```ts
shouldApplySupersetPolicy(context): SupersetPolicyMode   // 'off' | 'permissive' | 'full'

planSupersetGroups<T extends SupersetCandidate>(exercises: readonly T[], mode): {
  exercises: T[]
  decisions: SupersetPolicyDecision[]
}
```

`planSupersetGroups` es el **núcleo único**. Devuelve, junto a la lista agrupada,
un canal de diagnósticos con una decisión por candidato evaluado: regla que
aplicó, miembros asignados, o descarte con motivo (`sets_mismatch`,
`no_eligible_partner`, `blocked_kind`). Un ejercicio ya reservado por una regla
anterior simplemente no vuelve al pool: no genera un diagnóstico propio, porque
el motivo real ya quedó registrado en la regla que se lo llevó.

A las cuatro reglas de §7.2 se suma una quinta etiqueta, **`eligibility`**, que
no agrupa: es la que registra los descartes por tipo (cardio, movilidad,
footwork). Existe para que `blocked_kind` no se atribuya a `core_circuit`, que
no fue quien los descartó — un diagnóstico falso en la auditoría es peor que no
tenerlo.

Los caminos productivos descartan `decisions` y se quedan con `exercises`. La
auditoría del corpus (§9) consume el **mismo** resultado, de modo que audita la
política real y no una reimplementación paralela.

### 7.1 Los grupos existentes son autoritativos

`planSupersetGroups` **no reconstruye** grupos manuales, importados o
provenientes de plantillas:

- Normaliza y conserva los grupos válidos existentes.
- Solo considera candidatos a los ejercicios **sin** grupo.
- `off` significa «no crear grupos», **no** «eliminar los existentes».
- Las prohibiciones de la tabla (footwork, cardio, movilidad, warm-up) aplican a
  la generación automática; no invalidan decisiones manuales.
- Reaplicar la política conserva ids y produce el mismo resultado.

### 7.2 Orden de asignación

`power` incluye levantamientos olímpicos y pliometría, así que sin un orden
explícito `power + pull` podría consumir el salto destinado a
`main_lift + pliométrico`. Prioridad fija:

1. Circuito de zona media (`trunk`, ≥2 ejercicios).
2. `main_lift` + pliométrico.
3. Power olímpico (`group === 'olympic'`) + pull accesorio.
4. Push accesorio + pull accesorio.

Cada ejercicio se **reserva** al asignarlo y no vuelve al pool. Así
`power + pull` no significa accidentalmente «salto + dominadas», y el `main_lift`
nunca participa como accesorio de otro grupo.

Nunca se agrupan: footwork, cardio específico, movilidad y warm-up.

Cardinalidad automática en v1: **pares, más el circuito de zona media**. Los
tríos son representables y editables, pero la heurística no los reconstruye.

### 7.2.1 Predicados de selección

**Power olímpico.** `group === 'olympic'`, que por `exerciseLibrary.ts:1500`
equivale exactamente a `tags.includes('olympic_power')`. Hoy son tres ejercicios
(`clean`, `clean_high_pull`, `split_jerk`). El predicado se escribe sobre el tag,
no sobre la lista.

**Pliométrico.** `intensityType === 'power'` **no sirve**: abarca desde `clean`
hasta `push_press`, `kettlebell_swing`, los lanzamientos de balón medicinal y
`assault_bike_30_30`. No existe un tag de pliometría en el catálogo, así que el
predicado es una **allowlist explícita de ids**, con el mismo criterio de
enumeración que usa `squashMatchRole.ts` para los drills competitivos:

```
box_jump · jump_squat · broad_jump · single_leg_broad_jump · drop_jump
depth_jump · half_kneeling_lateral_jump · lateral_skater_jumps
alternating_step_up_jump · pogo_jumps
```

Diez ids. `barbell_jump_squat` queda **fuera** a propósito pese a ser un salto:
`equipment: ['barbell']`, `riskLevel: 'high'`, `fatigueCost: 'high'` y
`difficulty: 'advanced'` lo hacen un ejercicio cargado, no el pliométrico de baja
dosis que la regla `main_lift + pliométrico` busca poner después del lift.

Queda bajo el mismo gate append-only que los 77 ids de §19: agregar un id es
deliberado y visible en el diff; nunca se infiere del nombre ni de `intensityType`.

**Desempate.** Cuando hay varios pulls o varios pliométricos elegibles, gana el
**primer candidato elegible según el orden ya normalizado**. Determinista, sin
scoring nuevo y sin dependencia del orden de declaración del catálogo.

**Fronteras runtime.** Un `supersetGroup` que sea `''`, no-`string`, o solo
espacios se trata como **ausencia de grupo**, no como grupo inválido. Aplica en
todo borde de deserialización: `dataExport`, los serializers, y el type guard
`isTemplateExercise` (`src/types/sessionTemplate.ts:184`), que debe actualizarse
para aceptar el campo opcional y rechazar valores no-string.

### 7.3 Restricción de `sets` iguales

**La política automática solo puede agrupar candidatos cuyo `sets` ya coincide.**
Si no coinciden, quedan sin agrupar y se registra el motivo `sets_mismatch`.

Sin esta restricción la regla de ancla convertiría a la política en un cambio de
prescripción: emparejar un ejercicio de 5 series con uno de 3 altera volumen e
intensidad, sobre todo en `power + pull` y `main_lift + pliométrico`.

Con ella vale la garantía verificable: **salvo el orden y el campo
`supersetGroup`, todos los campos de cada ejercicio permanecen idénticos.**

El editor manual **sí** puede armonizar `sets` usando el líder, porque ahí es una
decisión visible del usuario. El normalizador conserva la regla de ancla para
reparar datos importados o inconsistentes.

### 7.4 `shouldApplySupersetPolicy` — función total

Señales, **solo las tres comparables entre ambos caminos**: `phase`,
`sessionDurationMin`, `sportProfile`. Más `intent`, con **tres** estados:

| `intent` | Significado | Efecto |
|---|---|---|
| `undefined` | no se mencionó | decide el contexto |
| `'requested'` | pidió superseries | sube **un** nivel dentro del límite seguro; no fuerza `full` |
| `'declined'` | pidió que no | `off`, mande lo que mande el contexto |

**Tres estados y no un booleano.** Con un booleano, `false` significaba a la vez
«no lo mencionó» y «lo rechazó», así que un contexto que ya resolvía
`permissive` por fase y duración agrupaba igual después de que el atleta pidiera
explícitamente lo contrario. El rechazo tiene que poder **mandar hacia abajo**,
no solo dejar de subir.

Quedan **excluidas** por no ser comparables:

| Señal | Chat (`actionPostProcessor.ts:917`) | Plan Builder (`repairWeek.ts:2270`) |
|---|---|---|
| `fatigueLevel` | **`5` hardcodeado** | `fatigueToNumber(wizardConfig.currentFatigue)` |
| `experienceLevel` | **`'intermediate'` hardcodeado** | `deriveStrengthExperienceLevel(context)` |
| `recentExercises` | **`[]` hardcodeado** | real |

En el chat la fatiga no es una señal débil: es una constante. Usarla haría que el
chat agrupe siempre como «fatiga media» mientras el Plan Builder varía.

Estructura:

```ts
if (intent === 'declined') return 'off'            // el rechazo manda sobre el contexto
if (hasInvalidInput(context)) return 'off'          // off absoluto, antes del upgrade

const baseMode = resolveBaseMode(context)
const requestedMode = intent === 'requested' ? upgradeOneLevel(baseMode) : baseMode

return minMode(requestedMode, PHASE_MODE_CAP[phase])
```

Modo base, primera regla que matchea:

| # | Condición | Modo base |
|---|---|---|
| R−1 | `intent === 'declined'` | `off` (absoluto, no depende del resto del contexto) |
| R0 | `phase`, `sportProfile` o `sessionDurationMin` ausentes o fuera de dominio | `off` (absoluto) |
| R1 | `phase ∈ {taper, race}` | `off` |
| R2 | `phase === 'transition'` | `off` |
| R3 | `sessionDurationMin < 45` | `off` |
| R4 | `strength_primary` · `phase ∈ {base, build}` · `≥ 55 min` | `full` |
| R5 | resto (`phase ∈ {base, build, peak}` · `≥ 45 min`) | `permissive` |

`full` **automático** queda reservado a `strength_primary` en v1. Un perfil
`hybrid` o `sport_support` puede llegar igual a `full` mediante
`intent: 'requested'`, así que no se pierde capacidad: solo se evita activar
emparejamientos de potencia y de `main_lift` sin señales comparables de fatiga o
experiencia entre los dos caminos.

`upgradeOneLevel`: `off → permissive`, `permissive → full`, `full → full`. Nunca
salta dos niveles.

Techo por fase:

```ts
PHASE_MODE_CAP = {
  base:       'full',
  build:      'full',
  peak:       'permissive',
  taper:      'permissive',
  race:       'permissive',
  transition: 'permissive',
}
```

Lecturas que esto garantiza:

- `taper`/`race`/`transition` parten de `off` y solo llegan a `permissive` con
  intención explícita: circuito de zona media y pares accesorios sí,
  emparejamientos de potencia o de `main_lift` no.
- `peak` parte de `permissive` y **no puede** subir a `full` ni con intención
  explícita: intensidad alta no se combina con densidad alta.
- R0 es `off` absoluto por construcción, porque sale antes del upgrade.

`permissive` habilita circuito de zona media y pares accesorios. `full` agrega
los emparejamientos de potencia y de `main_lift`.

El default es no agrupar salvo que las señales lo justifiquen: agrupar cambia el
estímulo — densidad, descanso, fatiga acumulada — y no es una decisión neutra.

### 7.5 Detección de `intent`

Helper local y testeable, sin llamadas al modelo:

```ts
detectSupersetIntent(intentText: string): 'requested' | 'declined' | undefined
```

Contrato:

- Opera sobre **`actionIntentText`**, no sobre el último mensaje crudo
  (`actionPostProcessor.ts:38-45`). Ese texto ya incorpora el contexto de la
  acción reciente cuando la respuesta es una confirmación, así que «sí, dale»
  después de «armámelo en superseries» sigue detectándose.
- Reconoce las formas de uso real: «en superseries», «superserie», «agrupado(s)»,
  «en circuito», «triserie», sobre texto ya normalizado (minúsculas, sin tildes),
  que es como llega `actionIntentText`.
- **Respeta negaciones**: «sin superseries», «nada de circuitos», «no los
  agrupes» devuelven `'declined'` — un rechazo explícito, distinto de la ausencia
  de mención, que devuelve `undefined`.
- Cuando el texto contiene menciones en ambos sentidos, **prevalece la última
  mención explícita**, no la negación. `actionIntentText` concatena el contexto de
  la acción reciente con el mensaje nuevo, así que «no quiero superseries» seguido
  de «dale, armámelo en superseries» debe resolver `true`: lo último que dijo el
  usuario es lo que quiere. Evaluar la negación primero invertiría exactamente el
  caso que este helper existe para soportar.
- Es **siempre `false` en Plan Builder v1**: el helper no se cablea ahí. No hay
  hoy un campo del wizard que exprese esta preferencia, y no se reutiliza uno
  existente con un significado que no tiene.

Se testea por tabla de frases, positivas y negadas, junto a la tabla de modos.

## 8. UI

### 8.1 Render read-only

`toDisplayBlock` (`ExerciseChecklist.tsx:108`) colapsa
`olympic|legs|push|pull|other` en un único bloque visual `strength`, así que los
grupos cross-block del ejemplo caen enteros dentro de «Trabajo de fuerza». El
caso a cubrir es un grupo manual que cruce bloques visuales.

Pipeline obligatorio: **lista plana → `resolveSupersetLayout` → segmentos →
asignación del segmento al bloque visual de su líder → render**. Un grupo se
renderiza completo en el bloque de su líder y **nunca se parte**. Las letras se
derivan del orden final de render, globalmente.

Etiqueta derivada por cardinalidad, sin dato nuevo:

```
A · Superserie × 4 rondas      (2 ejercicios)
B · Triserie × 4 rondas        (3)
C · Circuito × 4 rondas        (4+)
```

Las rondas se muestran **una vez** en el encabezado del grupo; las filas pasan de
`4×10 · 60kg` a `10 reps · 60kg`. Los ejercicios sin grupo mantienen
`formatTargetSet` intacto. El check sigue siendo uno por ejercicio.

### 8.2 Editor

Hoy `SessionForm` **no permite reordenar ejercicios en absoluto**
(`SessionForm.tsx:485-509`): es una lista plana con añadir y eliminar. Reordenar
es funcionalidad nueva.

Sin drag-and-drop. Dos controles por tarjeta:

- **«Agrupar con el anterior»** — toggle que representa la **frontera con el
  ejercicio anterior**. Al unir dos grupos se fusionan los segmentos completos y
  prevalece el id del grupo **izquierdo**. Al cortar, el editor asigna un **id
  nuevo** al segmento derecho si conserva ≥2 miembros; no puede dejar el mismo id
  y delegarlo al normalizador, que lo disolvería como corrupción.
- **Subir / bajar** — flechas que operan sobre **unidades**. Un líder o un
  ejercicio individual mueve la unidad completa; un seguidor solo se mueve dentro
  de su grupo y no atraviesa sus límites. Para convertir a otro miembro en líder,
  se lo sube dentro del grupo.

Propagación de `sets` en el borrador, inmediata y visible:

- Al crear o fusionar un grupo, los `sets` del líder izquierdo se propagan.
- Editar los `sets` del líder actualiza a todos sus miembros.
- Al desagrupar, cada ejercicio conserva ese valor y vuelve a ser editable.
- `onSubmit` (`SessionForm.tsx:268`) vuelve a normalizar como defensa final.

`sets` de un miembro no-líder es **solo lectura**, mostrando el valor del grupo.

El editor **no** usa `resolveSupersetLayout`: mantiene la pertenencia a grupo como
estado de borrador explícito, donde un grupo de 1 en construcción es un estado
intermedio legítimo. Normaliza solo al guardar.

### 8.3 `SessionCard`

El resumen colapsado pasa a `6 ejercicios · 2 grupos`. «Grupos» y no
«superseries», porque el conteo puede incluir superseries, triseries y circuitos.

### 8.4 Copy

«Superserie» es el término de sala. La regla `A1/A2` se retira de
`strengthPrompt.ts:157`. Las sesiones ya generadas conservan esos prefijos en
`notes` porque no hay backfill; van a convivir un tiempo con la etiqueta nueva.
Deuda cosmética aceptada y separada.

## 9. Verificación

Sin migraciones y sin gasto de API.

| Gate | Qué prueba |
|---|---|
| Barrido pareado por `id` (como §19/§20) | Sesiones **sin** grupos producen orden y prescripción byte a byte idénticos a hoy |
| Test de propiedad `main_lift` | La identidad se preserva tras agrupar y reflow, sobre la lista normalizada |
| `qualityReview` / `countRepairsV2` antes/después | Comparación directa sobre el corpus, aunque la invariancia esté razonada |
| Tabla exhaustiva | 6 fases × 3 perfiles × bandas de duración × 3 de `intent`, enumerada completa |
| Round-trip de serializers | Los 5 escenarios de §9.1 |
| Idempotencia | `normalize(normalize(x)) === normalize(x)`; reaplicar la política conserva ids |
| Contigüidad | Inserción, eliminación, separación, reordenamiento y el caso `A, X, A, A` |
| Integración | Chat y Plan Builder aplican la política **después** del último sort |
| UI | Fusionar, cortar y mover grupos; propagación de `sets`; render de un grupo cross-block |
| Auditoría local del corpus | Consume `decisions` de `planSupersetGroups`: pares generados, ejercicios descartados y motivo — incluido `sets_mismatch` |
| Suite completa | `npm test`, `npm run lint`, `npm run build` |

**Nota de comandos:** no existe un script `typecheck` en `package.json`. El
chequeo de tipos se obtiene con `npx tsc -b --pretty false`, o bien implícito en
`npm run build`, que corre `tsc -b && vite build && …`.

### 9.1 Round-trip de serializers

1. Exportar/importar una sesión conserva `supersetGroup`.
2. Guardar/cargar una plantilla conserva sus grupos.
3. Materializar una plantilla conserva la relación interna con ids nuevos.
4. Aplicar dos veces la misma plantilla en una sesión no produce colisiones.
5. Datos antiguos sin el campo permanecen idénticos.

### 9.2 No regresión de calidad

Con la restricción de `sets` iguales, la política automática cambia únicamente el
orden y el campo `supersetGroup`. El único riesgo sobre `collectCountableKeys`
sería que un ejercicio pasara de `main_lift` (exento) a contable o viceversa, y
eso es exactamente lo que el test de propiedad prohíbe. La comparación directa de
`qualityReview` y `countRepairsV2` antes/después queda igualmente como gate.

### 9.3 Riesgo que no cierra local

Los gates prueban que no se rompe nada. **No** prueban que las superseries
automáticas sean buenas deportivamente. Se cubre con la auditoría determinista
del corpus (§9) e inspección en dev al cerrar la Entrega 4. **No** se ejecuta el
loadtest (~US$0,90): mide principalmente selección de ejercicios, que este
proyecto no altera.

## 10. Entregas

**1 — Fundación.** El campo en toda la cadena de tipos — `Exercise`,
`CoachExerciseProposal`, el ejercicio de `CoachSessionDraft`,
`SessionTemplateExercise` y sus conversiones; `supersetGroups.ts` (normalizador +
`resolveSupersetLayout`, genéricos sobre `SupersetMember`); roles group-aware en
`strengthRoleContract.ts`; los allowlists de serializers, el guard
`isTemplateExercise` y la re-emisión de ids por `Map` en `templateToSession`.
Sin UI, sin política.

**2 — Ordenamiento por unidades.** Bifurcación en
`normalizeStrengthSessionExercises` y reflow anclado al líder. Gate: barrido
pareado en verde.

> **Las Entregas 1 y 2 se despliegan juntas.** Son pasos de implementación
> separados, pero si los serializers aceptan grupos antes de que el sort los trate
> como unidades, una plantilla o una importación podría persistir un grupo que
> después se rompe.

**3 — Editor y render.** `ExerciseChecklist`, `SessionCard`, `SessionForm` con
toggle, flechas y `sets` de solo lectura. Al cerrar esta entrega ya se puede
registrar a mano el entrenamiento completo de referencia: el valor llega antes
que la automatización.

**4 — Política determinista.** `supersetPolicy.ts` con `planSupersetGroups` y su
canal de `decisions`, la tabla total, `detectSupersetIntent`, la auditoría
del corpus, el cableado en `actionPostProcessor` y `repairWeek`, y el retiro de la
regla `A1/A2` de `strengthPrompt.ts`.

El orden pone primero lo riesgoso y verificable sin costo, y deja para el final
lo que cambia el estímulo de entrenamiento generado.

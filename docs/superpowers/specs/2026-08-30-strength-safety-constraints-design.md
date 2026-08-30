# Restricciones de seguridad en fuerza — diseño

Fecha: 2026-08-30
Estado: aprobado para plan de implementación
Ámbito: `src/services/training/`, `src/services/ai/`, `src/services/weekCreator/`,
`src/services/planBuilder/`, `src/store/useCoachActionsStore.ts`,
`src/store/useChatStore.ts`, `src/services/planning/applyCreateWeek.ts`,
`src/types/index.ts` (uniones de outcome y `generationOutcome`),
`src/services/dataExport.ts` (invalidación del sello en import/backup, §7.1),
`src/pages/OnboardingPage.tsx`, `src/components/settings/AthleteProfileEditor.tsx`,
`src/pages/CompetitionPlanPage.tsx` (feedback de lectura del parser, §9.3), y la
superficie `/ops` que agrega outcomes (§8.3.1)

## 1. Problema

Un atleta con `recoveryProfile.currentInjuries = "Lesión espalda baja, cuadrado
lumbar"` pidió por chat dos sesiones de pesas y recibió una sesión encabezada por
`side_plank_plate_press` y `half_kneeling_diagonal_plate_chop`: dos ejercicios que
cargan directamente el cuadrado lumbar y la rotación lumbar.

### 1.1 Evidencia

Reproducción sobre el camino productivo real (`postProcessCoachActions`), sin IA:

| Perfil | Ejercicios devueltos |
|---|---|
| Sin lesión, base 60 min | `side_plank_plate_press`, `half_kneeling_diagonal_plate_chop`, `pallof_press`, `bb_side_lunge`, `z_press`, `landmine_press`, `half_kneeling_row`, `air_treadmill_20_20` |
| **Lumbar, base 60 min** | `side_plank_plate_press`, `half_kneeling_diagonal_plate_chop`, `lateral_band_walk`, `bb_side_lunge`, `half_kneeling_row` |
| **Rodilla (`tendinitis rotuliana`), build** | `side_plank_plate_press`, `half_kneeling_diagonal_plate_chop`, `half_kneeling_lateral_jump`, `back_squat`, `lateral_skater_jumps`, `z_press`, `landmine_press`, `air_treadmill_20_20` |

### 1.2 Causa raíz

**No existe ningún modelo de zona corporal en el sistema.** `grep -rn
"injur\|lesion\|contraindic\|restriction" src/services/training/` no devuelve
nada: el motor determinista que elige cada ejercicio no tiene noción de lesión.

Lo único que existe hoy:

1. Prosa blanda en el prompt (`promptBuilder.ts:758`).
2. `hasActiveMedicalRestrictions` (`WeekCreatorLocalHydrator.ts:383`) y
   `hasActiveSquashMedicalRestriction` (`repairWeek.ts:1503`): booleanos
   «hay texto» usados **solo** para vetar exposición de partido en squash.
3. `hasPainOrInjurySignal` (`actionPostProcessor.ts`, worktree actual): un regex
   que sube `fatigueLevel` a 8 y fuerza `phase: 'transition'`.

El punto 3 es la falla de diseño que produjo el bug: **hace la sesión más liviana,
no más segura**, y es ciego a la zona. Su regex no cubre `rodilla`, `hombro`,
`tendinitis`, `tobillo` ni `isquiotibial`, de modo que una tendinitis rotuliana
no activó siquiera la heurística y recibió sentadilla trasera más tres ejercicios
pliométricos de salto.

### 1.3 Por qué no se puede derivar de la metadata existente

Derivar la contraindicación de `movement` / `category` / `tags` es **incorrecto en
ambas direcciones**, verificado contra la biblioteca real:

- `side_plank_plate_press` es `core/carry/stability`, metadata **idéntica** a
  `plank`, que sí es apropiado. Cualquier regla derivada o pierde el cargado o
  prohíbe ambos.
- `dead_bug` y `pallof_press` son `core/rotation`, **igual que**
  `half_kneeling_diagonal_plate_chop`. Una regla por `movement: 'rotation'`
  prohibiría justo el trabajo de control lumbo-pélvico.

Precedente del proyecto (CLAUDE.md §23): «Los pliométricos van por allowlist
explícita de ids … `intensityType: 'power'` … no sirve como predicado».

## 2. Decisiones de producto

| Decisión | Valor |
|---|---|
| Captura de la lesión | Texto libre existente + parser determinista. Sin campo estructurado nuevo. |
| Corrección del parser | Feedback de lectura («Entendí: zona lumbar»). Sin override persistido. |
| Rigor | **Exclusión dura, fail-closed.** Nunca penalización de score. |
| Alcance deportivo | **Fuerza** en las tres superficies. Squash/running/movilidad fuera. |
| Degradación | Sesión reparada desde el pool permitido; si no es viable, **bloqueada**. Nunca sesión silenciosamente incompleta. |
| Contenido ya guardado | Fuera de alcance, declarado. |

## 3. Modelo de restricciones

### 3.1 Regiones (17)

`lumbar` · `thoracic` · `cervical` · `trunk_core` · `chest_ribs` ·
`pelvis_sacroiliac` · `shoulder` · `elbow` · `wrist` · `hip` · `groin` ·
`hamstring` · `knee` · `calf` · `achilles` · `ankle` · `foot`

`calf` y `achilles` van separados por el mismo argumento que separa `elbow` y
`wrist`: distinguirlas no cuesta código y evita atribuir mal una lesión.

**No existe tabla de implicación entre regiones.** Se evaluó
`lumbar → {trunk_core, pelvis_sacroiliac}` y se descartó: reintroduce inferencia
prescriptiva detrás de una tabla de apariencia anatómica y produce exclusiones
inexplicables. La regla auditable es:

> Si una restricción debe excluir un ejercicio, la región o el patrón
> correspondiente tiene que aparecer **directamente** en el perfil del ejercicio.

Un ejercicio marcado solo `trunk_core` que debería caer ante una restricción
lumbar tiene metadata incompleta: debe declarar ambas.

### 3.2 Patrones de carga (7)

`axial_load` · `loaded_hinge` · `impact` · `deep_flexion` · `overhead` ·
`rotation` · `grip_demand`

Existen porque las restricciones reales del repositorio no son solo regiones:
«sin impacto ni carga axial», «evitar flexión profunda de rodilla».

### 3.3 La restricción

```ts
type ConstraintSource =
  | 'current_injuries'
  | 'restrictions'
  | 'injury_notes'
  | 'user_message'
  | 'training_priority'

type ConstraintSources = readonly [ConstraintSource, ...ConstraintSource[]]

type StrengthConstraint =
  | { kind: 'region'; region: BodyRegion; sources: ConstraintSources }
  | { kind: 'load_pattern'; pattern: LoadPattern; sources: ConstraintSources }
  | {
      kind: 'unresolved_medical_restriction'
      sources: ConstraintSources
      reason:
        | 'medical_marker_without_supported_constraint'
        | 'structured_priority_without_detail'
    }

type UnresolvedConstraintReason =
  | 'medical_marker_without_supported_constraint'
  | 'structured_priority_without_detail'

/** Clave estable para telemetría, reporte y fingerprint. */
type ConstraintKey =
  | `region:${BodyRegion}`
  | `pattern:${LoadPattern}`
  | `unresolved:${UnresolvedConstraintReason}`
```

`ConstraintKey` incluye la variante `unresolved` porque
`strength.safety.blocked` (§9.5) promete transportar una clave y el bloqueo más
importante es justamente el no resuelto.

`sources` es plural y no vacío en las tres variantes: la misma restricción puede
llegar de varias fuentes y perder procedencia al deduplicar sería perder
información (§3.6). `structured_priority_without_detail` existe porque
`return_to_play` no proviene de un marcador textual y no puede reportarse como si
lo fuera.

**Sin `sourceText`.** La procedencia es estructurada para que texto médico del
atleta no llegue nunca a un objeto persistible ni a telemetría. El texto original
puede sostenerse efímeramente para UX, jamás dentro de la restricción.

### 3.4 Fuentes confiables

Participan: `recoveryProfile.currentInjuries`, `recoveryProfile.restrictions`,
`planWizardConfig.injuryNotes`, el mensaje actual del usuario, y
`trainingPriority === 'return_to_play'` como procedencia estructurada — que sin
región ni patrón produce `unresolved_medical_restriction`, preservando el veto
que hoy aplica `WeekCreatorLocalHydrator.ts:383`.

**No participan:**

- `recoveryProfile.previousInjuries` — historial, no restricción activa.
- El `objective` del modelo. Hoy se cuela en
  `buildStrengthSelectionContextForAction` y en `buildLevelAwareGoal`
  (`repairWeek.ts:4421`). Es una inversión de autoridad: el modelo no puede
  crear ni relajar una restricción de seguridad.
- Mensajes del coach. `buildRecentActionIntentText`
  (`actionPostProcessor.ts:228`) concatena `recentMessages` **sin filtrar rol**;
  el resolver solo puede recibir entradas con `role === 'user'`.

`buildLevelAwareGoal` conserva `session.objective` para `goal`: aporta nivel y
fitness al ordenamiento del selector y no interpreta restricciones. La regla es
que **ningún texto de `goal` pueda producir ni relajar una restricción**, no que
`goal` desaparezca.

### 3.5 Parser

Determinista y por cláusula. Cada cláusula se clasifica en **uno de cuatro modos**;
solo los dos primeros emiten restricciones.

| Modo | Definición | Efecto |
|---|---|---|
| `active_medical` | Contiene marcador médico activo (`lesión`, `dolor`, `duele`, `molestia`, `tendinitis`, `esguince`, `rotura`, `hernia`, `operad*`, `cirugía`, indicación profesional) **no negado**. | Emite las regiones y patrones que resuelva. Si no resuelve ninguno → `unresolved_medical_restriction`. |
| `prohibitive` | Directiva de evitación (`sin`, `evitar` y sus formas `evita`/`evite`/`evito`, `no`, `nada de`) cuyo **objeto es mecánico** y resuelve a región o patrón. | Emite esas regiones y patrones. |
| `resolved_absence` | Directiva de evitación cuyo **objeto es un síntoma médico** (`sin dolor`, `sin lesiones`, `sin molestias`, `ya recuperad*`, `no tengo dolor`). | No emite. Suprime las coincidencias dentro de esa cláusula. |
| `neutral` | Ni marcador médico ni directiva que resuelva. | Se ignora. |

**La ambigüedad de `sin` la resuelve su objeto, no la palabra.** `sin` + sustantivo
de síntoma → `resolved_absence`; `sin` + sustantivo mecánico → `prohibitive`. Por
eso `sin dolor lumbar` desactiva y `sin carga axial` activa `axial_load`, sin
contradicción.

`neutral` es indispensable: el placeholder real de `restrictions` en
`AthleteProfileEditor` es *«no fuerza pesada el dia previo a partido»* — una
directiva de evitación cuyo objeto (`fuerza pesada el día previo`) no resuelve a
región ni patrón. Sin `neutral`, ese texto bloquearía toda sesión de fuerza para
siempre.

**Segmentación.** Corte primario por `[,.;\n]`. La conjunción ` y ` **no** corta
a ciegas: solo corta cuando el fragmento derecho inicia por sí mismo un modo —
lleva su propia directiva de evitación o su propio marcador médico. En cualquier
otro caso es enumeración coordinada y hereda el modo de la cláusula izquierda.
Sin esta regla se rompen `dolor de rodilla y tobillo` y `sin impacto y carga
axial`.

**El campo de origen puede aportar el marcador médico.** `current_injuries` e
`injury_notes` son campos *médicamente acotados* — sus etiquetas son «Molestias
actuales» y «Lesión o molestia actual»—, así que toda cláusula no negada de esas
fuentes es `active_medical` aunque no contenga un marcador léxico.
`restrictions` y `user_message` son de contenido mixto y sí exigen marcador
explícito. `training_priority` no se parsea como texto en absoluto: se resuelve
estructuralmente desde `trainingPriority === 'return_to_play'`.

Sin esta regla, escribir solo `cuadrado lumbar` o `rodilla` en el campo de
lesiones —la entrada más natural que existe— produciría **cero** restricciones:
un fail-open en el campo cuyo propósito entero es declarar una lesión. Es
también lo que resuelve la segunda cláusula de la fila 1.

**Manda la fuente persistida original, nunca el nombre del campo transportador.**
`WeekCreatorEffectiveConfig.injuryNotes` **no** es prueba de procedencia: ambos
constructores de `WeekCreatorConfig.ts` le asignan
`profile.recoveryProfile?.restrictions` —la línea 274 lo prefiere por sobre el
valor del wizard, y la 307 lo usa en exclusiva—. Tratar ese campo como
médicamente acotado promovería contenido de `restrictions` por accidente.

Por eso `resolveStrengthSafetyConstraints` recibe entradas discretas y etiquetadas
con su procedencia real, leídas del perfil y del wizard, y **nunca** el
`injuryNotes` efectivo de Week Creator.

**Sentinelas de ausencia.** En los campos médicamente acotados, un valor que solo
diga `ninguna`, `ninguno`, `no aplica`, `N/A`, `nada` o `sin restricciones` es
`resolved_absence`, no una restricción no resuelta.

**`fatiga` es neutral.** El placeholder actual de «Molestias actuales» invita
literalmente a escribirla (`OnboardingPage.tsx:576`). `fatiga`, `fatiga general`,
`cansancio` y `agotamiento` no son restricciones mecánicas ni identifican zona:
se clasifican `neutral` y **no** producen `unresolved_medical_restriction`, que
bloquearía sesiones por un dato de carga. Además se retira la palabra «fatiga»
de ese placeholder, que ya tiene su propio canal en el check-in diario.

Ejemplos congelados (14). La columna «Fuente» importa por la regla de campo
acotado de arriba:

| Texto | Fuente | Modo | Resultado |
|---|---|---|---|
| `Lesión espalda baja, cuadrado lumbar` | `current_injuries` | `active_medical` ×2 (la 2.ª por campo acotado) | `{lumbar}` |
| `tendinitis rotuliana rodilla izquierda` | `current_injuries` | `active_medical` | `{knee}` |
| `manguito rotador` | `current_injuries` | `active_medical` (por campo acotado) | `{shoulder}` |
| `pubalgia` | `current_injuries` | `active_medical` (por campo acotado) | `{groin}` |
| `fascitis plantar` | `current_injuries` | `active_medical` (por campo acotado) | `{foot}` |
| `sin carga axial` | `restrictions` | `prohibitive` | `{axial_load}` |
| `evitar flexión profunda de rodilla` | `restrictions` | `prohibitive` | `{deep_flexion, knee}` |
| `dolor de rodilla y tobillo` | `user_message` | `active_medical` (sin corte en ` y `) | `{knee, ankle}` |
| `sin impacto y carga axial` | `restrictions` | `prohibitive` (sin corte en ` y `) | `{impact, axial_load}` |
| `molestia lumbar, sin dolor de rodilla` | `current_injuries` | `active_medical` + `resolved_absence` | `{lumbar}` |
| `no fuerza pesada el día previo al partido` | `restrictions` | `neutral` | ninguna |
| `me operaron hace dos semanas` | `user_message` | `active_medical` sin resolución | `unresolved_medical_restriction` (`medical_marker_without_supported_constraint`) |
| `no pesado antes del partido; sigo con dolor raro al moverme` | `restrictions` | `neutral` + `active_medical` sin resolución | `unresolved_medical_restriction` |
| *(sin texto)* `trainingPriority === 'return_to_play'` | `training_priority` | — | `unresolved_medical_restriction` (`structured_priority_without_detail`) |

### 3.6 Deduplicación y procedencia

La misma restricción puede llegar del perfil, de las notas del wizard y del
mensaje. Se deduplica por `(kind, region|pattern)`, y las no resueltas por
`(kind, reason)`, **conservando toda la procedencia**, nunca eligiendo una fuente
y descartando el resto:

```ts
sources: readonly [ConstraintSource, ...ConstraintSource[]]
```

Orden canónico: las fuentes se ordenan según el orden de declaración de
`ConstraintSource`; las restricciones por su `ConstraintKey`, siguiendo el orden
de declaración de `BodyRegion`, luego `LoadPattern`, luego
`UnresolvedConstraintReason`. Ese orden es también el del
`constraintFingerprint` de §7.1, de modo que las restricciones no resueltas
entran en el sello y un cambio en ellas lo invalida.

## 4. Clasificación de la biblioteca

### 4.1 Campo obligatorio

```ts
type NonEmptyRegions = readonly [BodyRegion, ...BodyRegion[]]

interface ExerciseSafetyProfile {
  /** Zonas que el ejercicio DESAFÍA. Nunca «zonas para las que es seguro». */
  loadsRegions: NonEmptyRegions
  loadPatterns: readonly LoadPattern[]
}
```

`ExerciseDefinition` incorpora `safety: ExerciseSafetyProfile` **obligatorio**.
TypeScript impide agregar un ejercicio sin la clasificación: la exhaustividad es
del compilador, no de un test que alguien pueda saltarse.

`NonEmptyRegions` hace `[]` irrepresentable. Un ejercicio universalmente seguro
no existe; si alguna vez entra contenido no físico (un protocolo respiratorio),
se clasifica como otra clase de entrada del catálogo, no como ejercicio con
perfil vacío.

No hay `UNIVERSALLY_SAFE_EXERCISE_IDS`.

### 4.2 Definición congelada de «carga significativa»

Se fija **antes** de clasificar los 77 ejercicios, para no terminar marcando
`lumbar` en todo movimiento compuesto. Una región entra si:

1. mueve la carga;
2. es articulación o tejido que recibe carga, tensión o impacto relevante;
3. su estabilización es un objetivo deliberado del ejercicio.

**No entra** la participación postural incidental.

### 4.3 Consecuencia registrada

Bajo el criterio 3, los cuatro ids de `INJECTED_CORE_ROTATION` — `dead_bug`,
`plank`, `side_plank`, `stability_ball_front_plank` — declaran `lumbar`. Ante una
restricción lumbar **no hay core inyectable**, y el paso de core debe poder
omitirse y liberar su cuota (§7.3).

`dead_bug` declara `['lumbar','trunk_core']`. Que sea prescribible en ciertos
procesos de rehabilitación no lo vuelve universalmente seguro; esa decisión es
individual y del profesional tratante, no del motor.

## 5. Autoridades

| Módulo | Autoridad |
|---|---|
| `exerciseLibrary.ts` | Hechos declarativos de cada ejercicio, incluido `safety`. |
| `strengthSafetyConstraints.ts` | **Única** autoridad que interpreta texto y aplica política. |

Ningún consumidor lee `loadsRegions` ni `loadPatterns` directamente: llama a la
autoridad. Se congela con un guard test en el estilo del guard del literal
`'default'`, que falla si cualquiera de los dos identificadores aparece fuera de
esos dos módulos.

El nombre es `strengthSafetyConstraints.ts`, no «contraindications»:
«contraindicación» sugiere decisión clínica y esto es una restricción de
programación.

## 6. Enforcement de dos capas

### 6.1 Capa 1 — selección

`StrengthContext` incorpora:

```ts
safetyConstraints: readonly StrengthConstraint[]   // OBLIGATORIO
```

Obligatorio, no opcional: un campo opcional reintroduce un camino fail-open. Los
contextos sin restricciones pasan `[]`, y TypeScript obliga a chat, Week Creator,
Plan Builder y a todos los tests a decidir explícitamente.

`buildStrengthCandidatePool` aplica `filterBySafetyConstraints` como **primer**
filtro, antes de experiencia, fatiga y fase: una restricción dura no se negocia
contra una blanda. `isCandidateAllowedInContext` ya pasa por ese pool, así que
`getStrengthReplacementPool` y `buildStrengthReplacementById` lo heredan — y con
ellos el allocator de bloque del Plan Builder, sin tocarlo.

### 6.2 Capa 2 — finalizador

```ts
type BlockedReason =
  | 'unresolved_medical_restriction'
  | 'insufficient_safe_pool'
  | 'unresolvable_exercise_identity'

type StrengthSafetyFinalization =
  | { status: 'ok'; exercises: CoachExerciseProposal[]; removed: RemovedExercise[]; replaced: ReplacedExercise[] }
  | { status: 'blocked'; reason: BlockedReason; removed: RemovedExercise[] }
```

Orden:

1. Cualquier `unresolved_medical_restriction` → `blocked` de inmediato.
2. Resolver identidad de cada ejercicio con `resolveStrengthExercise`.
3. Retirar los incompatibles y los de identidad desconocida o `ambiguous`.
4. Reemplazar por **mismo `MovementPattern`** cuando exista sustituto permitido,
   vía `getStrengthReplacementPool` (que ya hereda el filtro de la capa 1). Se
   dice `MovementPattern` y no «mismo patrón» para no confundirlo con
   `LoadPattern` de §3.2.
5. Completar densidad **solo** desde el pool permitido. Como el selector
   devuelve orden de ejecución y puede ubicar core primero, el relleno satisface
   primero `getMinimumStrengthWorkCount` con trabajo de fuerza real y después
   completa el target total; core/cardio no pueden consumir la cuota y provocar
   un falso `insufficient_safe_pool` cuando sí existen candidatos.

   **Integración con Plan Builder:** allí la densidad mínima no se agrega como
   una mutación local previa o posterior. Se proyecta como slots virtuales en la
   misma matriz del allocator de bloque, con los candidatos ya filtrados por
   seguridad, para que esos ejercicios también consuman el presupuesto global
   I1 y sean idénticos entre workers. El finalizador terminal corre con
   `densityCompletion: 'preserve'`: revalida identidad, restricciones, mínimo de
   trabajo real y densidad, pero no reemplaza la asignación coordinada. Un déficit
   sigue bloqueando; `preserve` no es un camino fail-open.
6. `planSupersetGroups` con el modo que resuelva `shouldApplySupersetPolicy`, y
   `normalizeSupersetGroups` sobre su salida. **Después** de reemplazar y
   rellenar, para que los ejercicios agregados queden agrupados y validados.

   `normalizeSupersetGroups` **no crea ni recompone** superseries: solo corrige
   contigüidad, cardinalidad y rondas de tags existentes (`supersetGroups.ts:63`).
   Quien forma grupos es `planSupersetGroups` (`supersetPolicy.ts:76`), que
   normaliza internamente como primer acto. Llamar solo al normalizador dejaría
   sin agrupar todo lo que el paso 5 acaba de agregar.
7. Revalidar identidad y restricciones sobre la **salida**. Si algo persiste →
   `blocked`.
8. Validar viabilidad.

El paso 7 es aserción sobre el resultado, no sobre la intención. Ningún paso
relaja una restricción para cumplir un conteo. El finalizador es idempotente
sobre su propia salida.

### 6.3 Viabilidad

No basta `density.min`: se exige además el **mínimo de trabajo de fuerza real**
(`getMinimumStrengthWorkCount`). Sin eso, core, cardio y movilidad podrían
satisfacer el conteo de una sesión nominalmente de pesas.

### 6.3.1 Precedencia de bloqueos

Cuando concurren varias causas, el estado se resuelve en este orden fijo:

1. `unresolved_medical_restriction`
2. identidad desconocida **fijada por el usuario**
3. identidad final inválida tras la revalidación del paso 7
4. `insufficient_safe_pool`

### 6.3.2 Formas de reporte

```ts
interface RemovedExercise {
  exerciseId?: string                  // id canónico si resolvía
  libraryRef?: ExerciseLibraryRef
  reason: 'constraint_intersection' | 'unresolvable_identity' | 'ambiguous_identity'
  matchedConstraints: readonly ConstraintKey[]   // p. ej. 'region:lumbar'
}

interface ReplacedExercise {
  fromExerciseId: string
  toExerciseId: string
  movementPattern: MovementPattern
  matchedConstraints: readonly ConstraintKey[]
}
```

Solo ids canónicos y claves de restricción. **Nunca nombres visibles ni texto
médico** — esto viaja a telemetría (§9.5).

### 6.4 Identidad desconocida

Retirar ≠ bloquear. Un nombre no resoluble se retira, se registra como
`removed: unresolvable_identity` y se intenta rellenar desde el catálogo
permitido; si el resultado final es verificable y viable, el estado es `ok`.

`unresolvable_exercise_identity` bloquea **únicamente** cuando la identidad es
imprescindible: un ejercicio fijado explícitamente por el usuario, detectado
porque su nombre aparece en el mensaje normalizado.

Una identidad no fijada nunca bloquea por sí misma: se retira, y si después falta
pool el motivo correcto es `insufficient_safe_pool`, según la precedencia de
§6.3.1.

### 6.5 Propiedad y orden

El finalizador **posee la orquestación y la última palabra** de reparación y
densidad. Delega en el selector y en las funciones de densidad existentes; no
duplica sus algoritmos. **Después del finalizador no puede correr ningún mutador
de ejercicios.**

## 7. El sello y el cuarto borde

### 7.1 Sello ligado al contenido

```ts
strengthSafetyFinalization: {
  policyVersion: 1
  exerciseFingerprint: string
  constraintFingerprint: string
  /** Restricciones derivadas del mensaje del usuario, §7.1.1. Sin texto. */
  userMessageConstraints: readonly StrengthConstraint[]
}
```

Cualquier `policyVersion` distinta de la vigente **invalida el sello y fuerza
refinalización**. No hay migración: un bump nunca conserva autorización previa.

Un booleano no alcanza: modificar los ejercicios conservando `metadata` permitiría
saltarse la validación. El fingerprint nunca cubre texto médico.

**El sello detecta cambios; no autentica.** Un hash local no puede demostrar que
no fue falsificado, así que nunca sustituye al enforcement:

- El normalizador de respuestas **elimina cualquier sello recibido del provider**.
  Mismo precedente que `supersetGroup`, que está fuera de su allowlist: el modelo
  no puede emitir identidad de grupo ni certificado de seguridad.
- Solo el finalizador local puede emitirlo.
- Aceptación **siempre** vuelve a resolver restricciones y ejecuta la validación
  no mutante.
- Un `exerciseFingerprint` coincidente puede evitar **enriquecimiento**, jamás
  evitar **enforcement**.
- Importación y backups invalidan el sello y fuerzan refinalización.

Un sello viejo no es autorización permanente: si las restricciones cambian entre
generar y aceptar, el borde de aceptación vuelve a resolver y a finalizar.

**Payload canónico del `exerciseFingerprint`:** el array de ejercicios **en su
orden de ejecución** —no alfabético—, con las claves de cada objeto serializadas
canónicamente: `id` canónico, `sets`, `reps`, `weight`, `targetPercent1RM`,
`targetRpe`, `warmupSets`, `supersetGroup`, `group`; más `sessionType` y
`durationMin` de la sesión.

El orden de ejecución es parte del payload porque reordenar ejercicios cambia las
superseries y la ejecución real; un fingerprint alfabético no lo detectaría y el
sello sobreviviría a una mutación significativa. `durationMin` entra porque
determina la viabilidad de §6.3: cambiarla sin invalidar el sello dejaría pasar
una sesión que ya no cumple el mínimo.

### 7.1.1 Restricciones originadas en el mensaje del usuario

`addProposal` recibe `coachMsg.id` (`useChatStore.ts:402`), de modo que
`CoachProposal.chatMessageId` apunta al mensaje **del coach**; y la aceptación
normaliza `proposal.message` (`useCoachActionsStore.ts:169`), no la solicitud
original. Una instrucción como *«sin carga axial»* escrita solo en el chat
**desaparece entre generación y aceptación**.

Por eso el sello persiste `userMessageConstraints: readonly StrengthConstraint[]`
—estructurado, sin texto original— y la aceptación **combina** ese conjunto con
las restricciones vigentes de perfil y wizard antes de validar. La unión se
deduplica y ordena por §3.6.

Ubicación: las sesiones anidadas de `create_week` usan `session.metadata`
(`CoachSessionProposal` ya lo tiene). `add_session` y `update_session` son planos,
así que reciben un campo interno `strengthSafetyFinalization` en la acción.

### 7.2 El cuarto borde: materialización y aceptación

Las propuestas se vuelven a enriquecer al mostrarse y al persistirse:

- `useCoachActionsStore.ts:291` (`prepareProposalActionsForDisplay`)
- `useCoachActionsStore.ts:755` (`add_session` en aceptación)
- `applyCreateWeek.ts:81`

Además `enhanceStrengthSessionExercises` (`strengthSessionStructure.ts:151`)
recibe **solo el array**, no la sesión ni su metadata, de modo que `ensureCoreBlock`
no puede observar el sello.

Solución:

- Un **wrapper de nivel sesión** que conoce metadata y es el punto de entrada
  público; los helpers de arrays pasan a internos.
- En display y aceptación, una sesión sellada con fingerprint válido **no** se
  vuelve a enriquecer.
- Una sesión sin sello, con sello inválido o con restricciones nuevas se
  finaliza otra vez.
- Un fallo en aceptación **bloquea la escritura**; no devuelve el array intacto.

### 7.3 Core opcional

`StructuralCoreProjection.coreId` es hoy obligatorio y alimenta allocator,
committed ids y métricas (`strengthStructuralCore.ts:20`). Sin core permitido la
proyección debe estar **ausente**, no `{ coreId: undefined }`:

```ts
projectStructuralCoreSlot(...): StructuralCoreProjection | undefined
```

Así no se agrega entrada al mapa, no cuenta como `fixedId`, no consume cuota y no
aparece como identidad comprometida. La reasignación de cuota es real, no visual:
sin esto, una sesión con cinco ejercicios superiores permitidos reportaría un
falso `insufficient_safe_pool`.

## 8. Cableado

Un solo resolver, `resolveStrengthSafetyConstraints({ profile, wizardConfig,
userMessages })`, lee las fuentes de §3.4. Se resuelve **una vez** al entrar en
cada superficie y el mismo conjunto inmutable recorre todo el pipeline.

### 8.1 Eliminaciones

- `hasPainOrInjurySignal` y su coerción `fatigueLevel: 8` / `phase: 'transition'`.
  Una restricción no puede disfrazarse de fatiga.
- El `objective` del modelo como entrada de seguridad, en chat y en Plan Builder.

### 8.2 Chat (`actionPostProcessor.ts`)

Resuelve restricciones desde perfil + mensajes con `role === 'user'`, las pasa a
`buildStrengthSelectionContextForAction` y corre el finalizador como último paso
de `add_session`, `update_session` y de cada sesión de `create_week`.
`completeStrengthLoads` y `applySupersetPolicy` pasan a ser entradas del
finalizador, no la última palabra.

### 8.2.1 `update_session` se finaliza sobre la sesión efectiva completa

`update_session` es un **patch**: la aceptación aplica campo por campo sobre la
sesión existente y reutiliza los ejercicios actuales cuando el patch no los trae
(`useCoachActionsStore.ts:829`). Finalizar solo el patch dejaría sin verificar los
ejercicios heredados. Contrato:

1. Leer la sesión base.
2. Materializar la **sesión prospectiva completa** aplicando el patch sobre ella.
3. Finalizar esa sesión completa.
4. Sellar su **resultado efectivo**, no el patch.
5. En aceptación, rematerializar y **bloquear si la base cambió** desde la
   propuesta.

Casos cubiertos obligatoriamente: conversión a `strength` mediante
`newType` **sin** ejercicios en el patch; cambio solo de `newDurationMin` —que
altera la viabilidad y por tanto invalida el sello, §7.1—; y edición concurrente
de la sesión base posterior a la propuesta.

### 8.3 Week Creator

`hasActiveMedicalRestrictions` deja de ser booleano y devuelve el conjunto de
restricciones; el veto de squash existente se conserva como pregunta derivada
(`constraints.length > 0`).

Las variantes literales de `buildFallbackSession` —incluido `romanian_deadlift`
en `WeekCreatorEngine.ts:1476`, un hinge cargado— pasan por el finalizador. Una
variante que no sobrevive no se emite; si ninguna sobrevive, el fallback reporta
bloqueo por una **salida instrumentada nueva, `safety_blocked`**, con copy
determinista.

`failFallback` no se reutiliza: registra `outcome: 'schema_invalid'`
(`WeekCreatorEngine.ts:618`), y un bloqueo de seguridad no es un fallo de schema.
Confundirlos corrompería la telemetría con la que se observa esta función.

### 8.3.1 Dónde vive `safety_blocked`

Se agrega a las cinco superficies, porque las uniones actuales no lo admiten:

| Superficie | Ubicación |
|---|---|
| `CoachOutcome` | `stageLogger.ts:22` |
| `AITechnicalResult.outcome` | `types/index.ts:96` |
| `CoachNormalizedResponse.meta.outcome` | tipo de respuesta normalizada |
| `WeekCreatorFailure.outcome` | Week Creator |
| Telemetría persistida y debug | `coach_requests`, `useAIDebugStore` |

**Semántica congelada: `safety_blocked` es una respuesta segura sin propuesta, no
una solicitud fallida.** El request se completó y el sistema declinó
correctamente. No debe contarse como fallo de proveedor ni inflar tasas de error
en los agregados de `/ops`.

Es el mismo precedente que `quality_rejected`, cuyo comentario en
`stageLogger.ts:16-21` explica por qué se mantiene separado de `invalid_schema`:
colapsarlos vuelve indistinguibles las regresiones de schema y los rechazos
deliberados.

**Ciclo terminal congelado.** `WeekCreatorFailure` exige además `code`, `category`
y `decision`, y sus decisiones actuales solo permiten reintentar o caer al
fallback (`WeekCreatorFailurePolicy.ts:37`) — las tres incorrectas para un bloqueo
de seguridad, que no debe reintentarse ni degradarse a un fallback igualmente
inseguro:

```ts
code:              'safety_blocked'
category:          'unsafe_or_ambiguous'   // ya existe, no se agrega
decision:          'safe_decline'          // NUEVO en WeekCreatorFailureDecision
outcome:           'safety_blocked'        // NUEVO en WeekCreatorFailure.outcome
status:            'completed'
proposalCreated:   false
generationOutcome: 'safe_decline'          // NUEVO en types/index.ts:93
```

`generationOutcome` hoy admite solo `model_success | local_fallback | failed`;
sin `safe_decline` un bloqueo tendría que reportarse como `failed` e inflaría la
tasa de error, contradiciendo la semántica congelada arriba.

### 8.4 Plan Builder

`AthleteParameters` incorpora `safetyConstraints`, poblado en `profileAdapter`
desde perfil + `wizardConfig.injuryNotes`. `buildStrengthSelectionContext` lo
propaga. La densidad mínima se proyecta como slots virtuales dentro del allocator
global de bloque, no mediante `completeStrengthExerciseDensity`; así sigue bajo
el filtro duro y conserva I1/I4. Después de balancear el conteo se reconstruye el
guard global para cualquier extra opcional. El finalizador corre en
`enhanceStrengthSessionDetails` como fase terminal con
`densityCompletion: 'preserve'`, después de todas las pasadas de mutación, y
bloquea si la sesión coordinada no es viable.

`quality.strength.safety_blocked` actúa como **tombstone**, no como warning:
ninguna pasada posterior de densidad ni de conteo rellena el hueco, y la semana
queda marcada parcial/degradada. No se publica como semana completa sin informar
la omisión.

## 9. Comportamiento visible

### 9.1 Bloqueo

La sesión no se propone. No se improvisa una rutina de rehabilitación.

- `add_session` / `update_session` bloqueada → la acción se elimina.
- `create_week` con una sesión bloqueada → **se bloquea la acción completa**. No
  hay aplicación parcial silenciosa. Acciones hermanas independientes de running
  o squash sobreviven.
- Copy determinista que **reemplaza** cualquier afirmación previa del modelo del
  tipo «te preparé la semana»:

  > No pude verificar una sesión de fuerza compatible con la restricción
  > registrada.

  Se evita «sesión segura»: la comprobación garantiza compatibilidad con la
  taxonomía, no seguridad clínica individual.

Aplicación parcial explícita con confirmación queda como follow-up declarado.

### 9.2 Reparación

Cuando el finalizador reconstruye la sesión, esta se propone. El aviso «Se
excluyeron o reemplazaron ejercicios por tu restricción» se muestra **solo si**
`removed.length > 0 || replaced.length > 0`: una sesión que ya era compatible no
debe anunciar una intervención que no ocurrió.

### 9.3 Feedback del parser

Bajo el campo de lesión, en `OnboardingPage.tsx`, `AthleteProfileEditor.tsx` y
`CompetitionPlanPage.tsx` —donde `injury_notes` se captura como «Molestias o
restricciones» (`CompetitionPlanPage.tsx:1314`)—:
«Entendí: zona lumbar». Solo lectura, sin control de edición. **Ambas superficies
están dentro del alcance de esta entrega**: son la única forma de que el atleta
audite lo que el parser entendió, y sin ellas la exclusión dura es invisible
hasta que una sesión se bloquea.

Estados congelados del feedback:

| Estado | Copy |
|---|---|
| Resuelto | «Entendí: zona lumbar» |
| Varias | «Entendí: zona lumbar, rodilla» |
| Patrón | «Entendí: evitar carga axial» |
| `unresolved_medical_restriction` | «Detecté una restricción, pero no pude identificar la zona» |
| Sentinela de ausencia | sin línea |
| Sin restricción | sin línea |

El estado `unresolved` es el más importante de mostrar: es el que bloqueará las
sesiones, y sin esta línea el atleta no tendría forma de saber por qué.

**Limitación declarada:** no se puede desactivar una zona detectada sin cambiar
el texto.

### 9.4 Prompt

Recibe regiones y patrones resueltos para que el modelo proponga mejor contenido.
**Nunca es el punto de enforcement**: el finalizador corre pase lo que pase,
igual que hoy `supersetGroup` está fuera del allowlist del normalizador de
respuestas.

### 9.5 Telemetría

`strength.safety.exercise_removed`, `strength.safety.exercise_replaced`,
`strength.safety.blocked`. Llevan `ConstraintKey` y `sources` (plural, §3.3).
**Nunca el texto del atleta.**

## 10. Verificación

### 10.1 Parser
Las **14** filas congeladas de §3.5 con su columna de fuente, incluyendo los
cuatro modos de cláusula, la desambiguación de `sin` por su objeto, los dos casos
coordinados con ` y ` que no deben cortarse, la regla de campo médicamente
acotado —`cuadrado lumbar` solo, en `current_injuries`, **sí** emite `{lumbar}`;
el mismo texto en `restrictions` **no**— y `return_to_play` con
`structured_priority_without_detail`.

Regresiones específicas de procedencia y sentinelas:

- `rodilla` en `recoveryProfile.restrictions` → **neutral**; el mismo texto en
  `planWizardConfig.injuryNotes` → `{knee}`. Fija que manda la fuente persistida
  y no el campo transportador de Week Creator (`WeekCreatorConfig.ts:274,307`).
- `ninguna` / `no aplica` / `sin restricciones` en un campo médicamente acotado →
  `resolved_absence`, no `unresolved`.
- `fatiga general` → `neutral`, **nunca** `unresolved_medical_restriction`. Más: los mensajes del coach nunca llegan al
resolver, y la deduplicación con orden canónico de §3.6.

### 10.2 Biblioteca
Toda definición con `loadsRegions` no vacío (compilador). Toda región alcanzable.
Guard de lectura directa fuera de las dos autoridades.

### 10.3 Matriz de taxonomía
Para **cada una de las 17 regiones y cada `LoadPattern`**: al menos un ejercicio
que debe excluir, al menos uno que debe conservar, una frase positiva del parser
y, cuando aplique, una negada. «Cada región es alcanzable» no demuestra que la
clasificación sea correcta.

### 10.4 Finalizador
Retiro; reemplazo por **mismo `MovementPattern`**; densidad solo desde el pool
permitido; agrupación **después** del relleno, verificando que un ejercicio
agregado en el paso 5 sí queda agrupado por `planSupersetGroups` —lo que falla si
alguien llama solo al normalizador—; revalidación; idempotencia sobre la propia
salida. Superserie que pierde un miembro se disuelve por cardinalidad vía
`normalizeSupersetGroups`. Identidad desconocida → retirada y rellenada → `ok`.
Identidad fijada por el usuario → `blocked`. Pool insuficiente → `blocked`, nunca
sesión corta. Precedencia de §6.3.1 con causas concurrentes.

### 10.5 Sello
Fingerprint cambia ante modificación de ejercicios, de restricciones, de
`durationMin` y de `policyVersion`. Un sello emitido por el provider es eliminado
por el normalizador. Un sello falsificado desde entrada no confiable nunca evita
enforcement. Import/backup invalidan el sello. Fingerprint estable al atravesar
productores, display y persistencia. `userMessageConstraints` sobrevive de
generación a aceptación y se combina con las restricciones vigentes.

### 10.6 Orden
El wrapper de sesión rechaza mutación posterior. Producción no puede llamar a los
helpers internos de arrays. Probado en los tres productores **y** en los bordes de
display y aceptación.

### 10.7 Superficies
`add_session`; `update_session` sobre la sesión efectiva completa —conversión por
`newType: 'strength'` sin ejercicios en el patch, cambio solo de duración, edición
concurrente de la base, y bloqueo en aceptación si las restricciones cambiaron—;
`create_week` con bloqueo atómico y supervivencia de hermanas; Week Creator; Plan
Builder. Más la precedencia de bloqueos de §6.3.1 con causas concurrentes.

### 10.7.1 Ciclo terminal de `safety_blocked`
Un bloqueo produce `status: 'completed'`, `proposalCreated: false`,
`generationOutcome: 'safe_decline'` y `decision: 'safe_decline'`; **no** dispara
reintento de proveedor ni fallback local, y **no** cuenta como error en los
agregados de `/ops`.

### 10.8 Core
Sin core permitido → proyección `undefined`, cuota reasignada, y **no** un falso
`insufficient_safe_pool` cuando existen cinco ejercicios superiores permitidos.

### 10.9 Regresiones del caso reportado

**Camino reparado** — perfil `"Lesión espalda baja, cuadrado lumbar"` +
«Creame 2 sesiones de pesas para la próxima semana»:

- se conservan las dos sesiones de fuerza;
- todos sus ejercicios resuelven contra la biblioteca;
- ninguno intersecta `lumbar` ni patrones prohibidos;
- no aparece ningún core inyectado;
- `side_plank_plate_press`, `half_kneeling_diagonal_plate_chop` y `bb_side_lunge`
  están ausentes;
- ambas sesiones llevan fingerprint válido;
- el copy visible deriva día y fecha de la acción estructurada, nunca de la prosa
  del modelo (§11.1).

**Caminos de bloqueo**, separados:

- `return_to_play` sin detalle, y «me operaron hace dos semanas» → acción
  eliminada y copy determinista.
- Fixture con pool permitido realmente insuficiente → `insufficient_safe_pool`.
- Week Creator con RDL y pool viable → RDL **reemplazado**, no `safety_blocked`.
- Week Creator sin pool viable → `safety_blocked`, nunca `schema_invalid`.

### 10.10 Gate
`npm run lint && npm test && npm run build` en verde (`build` ya ejecuta `tsc -b`).

## 11. No-objetivos y límites declarados

- **Esto no es criterio clínico.** Es una restricción de programación. Excluir un
  ejercicio no significa que el resto de la sesión sea apropiado, y el camino
  bloqueado no inventa un protocolo de rehabilitación: declina y remite al
  descargo de salud existente.
- Contenido ya guardado antes de registrar la lesión no se modifica ni se audita.
- Squash, running, ciclismo y movilidad quedan fuera: la librería de drills no
  tiene metadata de zona corporal.
- Sin severidad: cualquier región reconocida excluye duro.
- Sin override persistido de zonas.
- Aplicación parcial de `create_week` con confirmación: follow-up.
- Restricciones a nivel de ejercicio en texto libre («evitar sentadilla pesada»)
  no se modelan; solo regiones y patrones.
- El sello **no es un mecanismo de autenticación**. Detecta cambios y evita
  reenriquecimiento redundante; la garantía de seguridad la da el enforcement,
  que corre siempre (§7.1).

### 11.1 El defecto de día de semana del ticket original

El reporte original traía un segundo defecto: el coach escribió «jueves 4» para
`2026-09-04`, que es viernes. **Queda fuera del alcance de esta especificación**
y ya está corregido en el worktree por `alignMessageWeekdayToActionDate`
(`actionPostProcessor.ts`), que deriva el día de la acción estructurada en vez de
la prosa del modelo.

Se declara aquí por trazabilidad y porque §9.1 lo toca: el copy determinista de
bloqueo **reemplaza** la prosa del modelo, así que no puede reintroducir una
fecha o un día de semana escritos por el proveedor. §10.9 incluye esa aserción
sobre el mensaje de bloqueo.

# Spec — Roles de partido de squash: standalone y finisher

**Fecha:** 2026-07-30
**Estado:** propuesto, pendiente de aprobación
**Origen:** smoke de rotación coordinada (`docs/superpowers/experiments/plan-builder-rotation/`), hallazgo `low_drill_depth` 0 → 8
**Backlog:** punto 3, "Plan Builder — calidad deportiva"

**Alcance:** separar la categoría `match` de squash en dos roles explícitos por
contenido, con un predicado único de exposición competitiva, protección de rol
frente a la rotación, y eliminación total del drill "Partido con ataque
temprano".

**Fuera de alcance, explícito:** que el repair **componga** finishers (ver §4),
**cambios en las reglas o instrucciones de autoría del prompt**, migraciones
Dexie o Supabase, y la biblioteca de drills de cara al usuario (punto 4 del
backlog). El prompt recibe una única actualización **factual** —el resumen de
exposición pasa a incluir finishers (§3.2)—, que no cambia qué se le pide
componer al modelo.

---

## 1. Por qué existe

El smoke de rotación dejó `quality.squash.low_drill_depth` en 8 de 12 planes. El
A/B entre `ac01830` y `2ea9b53` mostró la causa: `COMPETITION_MATCH_VARIANTS` y
`PRACTICE_MATCH_VARIANTS` tienen **una sola** entrada cada uno, y es la misma
(`practice_match_five_games`). Cualquier semana con dos partidos produce firmas
duplicadas por construcción. Este spec **no** lo resuelve agregando variantes de
partido standalone —sigue habiendo una sola— sino sacando a los standalone de la
regla de unicidad, porque compartir formato no es repetir una prescripción
(§5.1).

Investigar el arreglo destapó algo más grande: la categoría `match` mezcla dos
cosas deportivamente distintas.

- **Un partido al mejor de 5** es una sesión completa. La sesión *es* el partido.
- **Un best-of-3 o un Game a 11** es un **finisher**: cómo se termina una sesión
  de drills o condicionado. Igual que en físico un finisher es un 4×30 s en bici
  para liquidarte. No es una sesión de partido.

El código no distingue estos roles, así que colapsa todo a partido standalone.
`normalizeSquashSemanticMetadata` reescribe a `[practice_match_five_games]` toda
sesión de partido que no sea exactamente eso (`hasCanonicalFiveGameMatch`), de
modo que un finisher propuesto por el modelo **nunca sobrevive**.

Tres reglas del propio código además se contradicen sobre cuántos drills lleva un
partido de 60 min: `getMinimumSquashDrillCount` dice 4, `buildSquashMatchDrills`
produce 1, y `low_drill_depth` exige ≥2.

## 2. Modelo de contenido

El rol se deriva del **contenido**, con IDs estables, nunca de `sessionMode`.
Módulo nuevo: `src/services/training/squashMatchRole.ts`. Va en `training/` y no
en `planBuilder/` porque `utils/squash.ts` lo consume (§3), y ese archivo ya
importa de `services/training/drillLibrary`; ponerlo en `planBuilder/` crearía
una dependencia nueva de `utils/` hacia el plan builder.

### 2.0 Contenido competitivo match

**`isSquashMatchDrill` no sirve para decidir el rol.** Devuelve `true` para todo
`category === 'match'`, y eso incluye `pre_match_activation_timing`, que es una
**activación de taper** de intensidad `low`, no contenido competitivo. Tratarla
como match proyectaría una activación aislada a un best-of-5 completo, que es
exactamente lo contrario de lo que esa sesión debe ser a 48 h de competir.

Este spec define **contenido competitivo match** por enumeración de los tres IDs
de rol, y solo esos:

```
practice_match_five_games        → standalone
practice_match_best_of_3         → finisher
match_sim_points_short_sets      → finisher
```

`pre_match_activation_timing` **no** es contenido competitivo. Una sesión que
solo lo contiene tiene rol `none` y **no se proyecta a standalone**: se deja
como está.

| Rol | Condición |
|---|---|
| `standalone` | `drills` == `[practice_match_five_games]`, exactamente |
| `finisher` | ver reglas abajo |
| `none` | todo lo demás. Incluye combinaciones no canónicas de **contenido competitivo match** (§2.1 las normaliza) y sesiones sin contenido competitivo, como una activación aislada (§2.1 no las toca) |

**Finisher canónico** exige las cuatro condiciones, todas:

1. El último bloque es de kind `match`.
2. Ese bloque contiene **exactamente uno** de `practice_match_best_of_3` o
   `match_sim_points_short_sets`.
3. Hay **al menos un bloque previo** que no es `match`.
4. **No hay ningún otro drill `match`** en la sesión.

**Contrato `blocks` / `drills[]`:** si la sesión **tiene** `blocks`, el flatten de
sus drills por **ID y orden** debe coincidir exactamente con `drills[]`. Si
divergen, la sesión no es canónica y se normaliza como `none`.

Si la sesión **no tiene** `blocks`:

- un **standalone** sí puede reconocerse por el array plano, porque su condición
  es de contenido total (`drills == [practice_match_five_games]`) y no depende
  de posición;
- un **finisher no puede ser canónico**, porque sin bloques no hay forma de
  demostrar que el partido es el último bloque ni que existe un bloque previo
  no-match. Cae en `none`.

Una sesión finisher se normaliza a `sessionMode = 'drill_session'` y
`sessionKind = 'mixed'`. El carácter competitivo pertenece al contenido, no al
modo global de la sesión.

**Drills de partido después de este spec:**

| ID | Rol |
|---|---|
| `practice_match_five_games` | standalone |
| `practice_match_best_of_3` | finisher |
| `match_sim_points_short_sets` | finisher |
| `pre_match_activation_timing` | sin cambios (activación de taper, no es partido) |
| ~~`practice_match_short_points_attack`~~ | **eliminado** |

### 2.1 Normalización de `none`

**La normalización nunca crea un finisher.** Componer no es su trabajo (§4).

- Sesión **enteramente contenido competitivo** (§2.0) y no canónica → se proyecta
  al standalone canónico.
- Sesión **mixta con contenido competitivo no canónico** → se conserva la parte
  no-match y ese contenido se elimina o reemplaza por la reparación contextual
  normal (`repairUnresolvedSquashDrills` / `densifySparseSquashDetails`).
- Sesión sin contenido competitivo —por ejemplo, solo
  `pre_match_activation_timing`— **no se toca**. "Enteramente match" significa
  enteramente contenido competitivo, nunca simplemente `kind === 'match'`.

## 3. Exposición competitiva

Predicado único nuevo: `hasSquashCompetitiveExposure(session)`. Devuelve `true`
para un standalone canónico —en modo `practice_match` **o**
`competition_match`— y para un finisher canónico.

Decisión deportiva del owner, literal: **ambos roles cuentan**. Jugar un partido
antes de un torneo da ritmo; una sesión de drills cerrada con un best-of-3
también sirve, y despeja la cabeza.

Consumidores:

| Punto | Cambio |
|---|---|
| `ensureSquashCompetitionMatchExposure` (`repairWeek.ts:896`) | No agrega ni convierte otra sesión si ya hay exposición en fecha segura, de cualquiera de los dos roles |
| `normalizeLateTaperSquashMatchPlay` (`repairWeek.ts:996`) | Ver §3.1 |
| `preservesCompetitiveExposure` (`repairWeek.ts:1727`) | Evalúa con el predicado único |
| `getRecentSquashCompetitiveExposure` (`utils/squash.ts:101`) | Ver §3.2 |

**`isCompetitionSquashMatch` no se toca.** Tiene 31 call sites en 13 archivos,
incluidos `nutritionEngine` (nutrición pre-competencia), `protocolEngine` (qué
warmup/cooldown se arma), `loadAnalytics`, `alertAdjustmentEngine` y nueve
puntos de `promptBuilder` y sus módulos. Todos lo interpretan como "la sesión
entera es un partido real". Ampliarlo cambiaría silenciosamente nutrición,
protocolos, contabilidad de carga y el prompt del coach.

### 3.1 Taper tardío

`normalizeLateTaperSquashMatchPlay` retira carga competitiva intensa dentro de
las últimas 48 h. Con dos roles, actúa distinto según el rol:

- **Standalone** → se convierte en activación, como hoy.
- **Finisher** → se retira **solo el bloque final**, conservando los bloques
  previos y aplicando los límites de duración y RPE.

Sin esta distinción, el paso destruiría una sesión mixta válida entera para
retirar su último bloque.

### 3.2 Resumen histórico

`SquashCompetitiveExposureSummary` gana `finisherCount`, y las dos derivadas
quedan definidas explícitamente:

```
totalMatchCount = practiceMatchCount + competitionMatchCount + finisherCount
exposureScore   = practiceMatchCount + competitionMatchCount + finisherCount
```

`exposureScore` arranca como la misma suma; si más adelante conviene ponderar un
finisher distinto de un partido completo, ese es un cambio deliberado y medido,
no un efecto lateral de este spec.

La línea informativa que lleva esta exposición al prompt (`squashPrompt.ts`)
también debe mostrar finishers. No es una regla de autoría nueva: es evitar que
el modelo reciba una historia incompleta y vuelva a pedir exposición que el
atleta ya tuvo.

## 4. Alcance deliberado: habilitar y preservar, no componer

**El repair no inyecta finishers.** Lo que cambia es que deja de destruirlos.

Inyectarlos obligaría al repair a decidir qué sesión modificar, cuánto tiempo
reservar, qué drill desplazar, si hay partner disponible y qué carga residual
queda. Eso es autoría de entrenamiento, no reparación.

Si la medición (§6) muestra que aparecen pocos, la lectura correcta es que el
prompt o el selector no los favorecen — no que el repair deba empezar a
autorarlos. Forzarlos sería un incremento posterior, con datos.

## 5. Rotación que respeta el rol

El loop de política de `normalizeSquashSessionContent` (`repairWeek.ts:1470`)
puede hoy reemplazar cualquier drill `match` por otro de la misma categoría. Sin
protección convertiría un finisher en best-of-5, o un standalone en otro drill de
partido, **después** de la última normalización semántica.

| Caso | Regla |
|---|---|
| Standalone | **No rota.** Ningún slot suyo entra a la política |
| Finisher | Rota **solo** entre los dos IDs de finisher |
| Corrección de duplicados | Conserva rol **y** exposición |

Si no existe un reemplazo finisher elegible por fase, fatiga o partner, se
**conserva el original y se registra omisión** en
`squashDrillRotationOmittedCount`. Nunca se relaja hacia best-of-5 ni hacia otro
drill `match`.

Actualizar solo `preservesCompetitiveExposure` no alcanza: ese chequeo se usa en
la rama correctiva, no en la rotación normal.

### 5.1 Standalone queda fuera de la unicidad de firmas

Las dos reglas anteriores —standalone no rota, la corrección conserva el rol— más
el hecho de que existe **un solo** standalone canónico dejan dos partidos de la
misma semana sin salida: firmas idénticas, ningún reemplazo permitido. El repair
terminaría en `quality.squash.signature_uniqueness_unresolved` y descartaría la
semana. Eso convertiría en un modo de falla vivo el mismo camino fail-closed que
el smoke midió en **0 sobre 42 semanas**.

**Los standalone canónicos se excluyen del chequeo de unicidad de firmas**, en
los dos lugares que lo aplican:

| Punto | Cambio |
|---|---|
| `normalizeSquashSessionContent` (`repairWeek.ts:1470`) | Los standalone no entran al conjunto de firmas ni a la rama correctiva |
| `validateDuplicateSquashSessions` (`validateWeekCreatorResponse.ts:253`) | No falla con `duplicate_squash_content` por dos standalone |

La justificación es deportiva, no de conveniencia: **dos partidos comparten
formato, y eso no es repetir una prescripción de drills.** Jugar dos veces al
mejor de 5 en una semana **puede** ser legítimo según fase y contexto;
compartir formato no basta para declararlo inválido. En taper o race, dos
best-of-5 no son necesariamente defendibles — pero esa es una decisión de carga y
fase, no de deduplicación de firmas, y la regla de unicidad no es el lugar donde
tomarla (§10.1).

La unicidad sigue aplicando entre finishers y entre sesiones de drills.

## 6. Medición

Tres contadores nuevos en el artefacto allowlisted del loadtest y en
`PlanGenerationMeta`:

| Campo | Qué cuenta |
|---|---|
| `squashFinisherProposedCount` | Sesiones que **entran a `repairGeneratedWeek`** con un finisher canónico. El punto de observación es la entrada del repair, **después** del `responseNormalizer` — no la respuesta cruda del modelo, que el repair no ve |
| `squashFinisherPreservedCount` | Sesiones que **salen** del repair con rol finisher canónico, aunque el ID haya rotado entre best-of-3 y Game a 11 |
| `squashStandaloneMatchCount` | Sesiones del **resultado final** con rol standalone canónico |

`squashStandaloneMatchCount` existe para hacer medible el riesgo residual de
§10.1. Sumado a `squashFinisherPreservedCount` da la **exposición competitiva
total por semana**, de modo que la próxima corrida pagada pueda mostrar la
distribución de semanas con 0, 1, 2 o 3+ exposiciones:

```
exposiciones(semana) = squashStandaloneMatchCount + squashFinisherPreservedCount
```

`PreservedCount` cuenta **rol**, no ID: §5 permite explícitamente que un finisher
rote entre sus dos IDs, así que exigir "intacto" contradiría la política de
rotación y haría que una rotación legítima se leyera como pérdida.

Son **observacionales**: no incrementan `repairedSessionCount` ni la taxonomía de
reparación, y por lo tanto no entran en `countRepairsV2`. La brecha entre
propuestos y preservados es la señal de si el repair sigue destruyendo finishers.

## 7. Otros cambios acoplados

**`getMinimumSquashDrillCount` (`repairWeek.ts:637`)** devuelve 1 para contenido
standalone. Detecta el rol por **contenido**, no por `sessionMode`. Hoy devuelve
4 para cualquier sesión de ≥60 min, así que densifica un partido standalone en el
paso 6 que el paso 13 después descarta.

**`low_drill_depth`** conserva la exención de sesiones de partido ya aplicada
(`qualityReview.ts`). Queda alineada con la regla anterior: las tres opiniones
contradictorias de §1 pasan a ser una.

**`hasCanonicalFiveGameMatch` (`repairWeek.ts:1126`)** se generaliza a
`isCanonicalMatchContent(session)`, apoyada en el rol. Es el chequeo de
idempotencia de la normalización: sin generalizarla, una sesión con finisher se
reescribiría a standalone, y como el repair corre **dos veces** en el contrato
skeleton, las dos pasadas se pelearían entre sí.

**Eliminación total de `practice_match_short_points_attack`:** su definición
(`drillLibrary.ts:573`), su alias de nombre (`drillLibrary.ts:703`), y un barrido
de tests, docs y del manifest del loadtest.

## 8. Compatibilidad

Eliminar un drill deja huérfanos los planes, sesiones y plantillas guardados que
lo referencien por nombre. La red ya existe: `hasUnresolvedSquashDrills` →
`repairUnresolvedSquashDrills` remapea o completa drills fuera de catálogo en vez
de fallar. El spec **no asume** que funcione: lo fija con un test (§9).

Sin migraciones Dexie ni Supabase. Los campos de telemetría son aditivos y
opcionales. El prompt no cambia sus reglas de autoría; solo el resumen factual de
exposición (§3.2).

## 9. Tests mínimos

1. En un contexto **sin política de rotación activa** (semana 0 de bloque), un
   best-of-3 y un Game a 11 canónicos **conservan su ID y sus bloques** a través
   de las dos pasadas de repair.
2. **No se agrega ni convierte** otra sesión cuando ya existe un finisher en
   fecha segura.
3. Un finisher dentro de las **últimas 48 h** no sobrevive como exposición
   intensa, y sus bloques previos sí.
4. **Con política activa**, la rotación conserva el **rol**: standalone no rota,
   finisher solo rota entre los dos IDs de finisher, y sin candidato elegible
   conserva el original y suma omisión.
5. **Dos standalone en fechas distintas** conviven: ni el repair falla con
   `signature_uniqueness_unresolved` ni el validador del Week Creator con
   `duplicate_squash_content` (§5.1). La semana reporta
   `squashStandaloneMatchCount = 2`, que es lo que hace medible el riesgo de
   §10.1.
6. Tras la primera proyección completa, una **segunda ejecución es igualdad
   exacta** (punto fijo, sin acciones nuevas).
7. Un **plan legado con `practice_match_short_points_attack`**, tanto suelto como
   dentro de una sesión mixta, termina con drills resueltos y **sin** `failure`.
8. Una sesión con **solo `pre_match_activation_timing`** conserva su contenido:
   no se proyecta a standalone (§2.0).

Los tests 1 y 4 se separan a propósito: "sin mutación" solo es exigible donde la
política de rotación no corre; donde sí corre, el invariante es el rol.

Más los de contrato del módulo de rol: las cuatro condiciones del finisher
canónico por separado, la divergencia `blocks` / `drills[]`, y el caso sin
`blocks` (standalone reconocible, finisher no).

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| La generalización de la idempotencia introduce inestabilidad entre las dos pasadas | Test 6 es punto fijo explícito; test 1 fija conservación de ID y bloques sin política |
| Ampliar la exposición hace que taper deje de garantizar partido largo | Decisión explícita del owner (§3); ambos roles cuentan a propósito |
| Los finishers casi no aparecen y el modelo queda inerte | Medido por §6; la respuesta sería prompt o selector, no autoría en repair |
| Un consumidor de `isCompetitionSquashMatch` esperaba ver finishers | No se toca ese predicado; el nuevo es aditivo y de uso acotado |
| Excluir standalone de la unicidad deja pasar una semana con partidos repetidos de más | **Riesgo residual aceptado, sin mitigación completa.** Ver §10.1 |

### 10.1 Riesgo residual: no existe tope de partidos por semana

Verificado sobre `repairWeek.ts`, `qualityReview.ts` y `validator.ts`: **no hay
ninguna regla que limite cuántas sesiones de partido puede tener una semana.**
`ensurePrimarySportDominance` regula deporte primario contra accesorio, no
formato dentro del squash.

Hoy la unicidad de firmas actúa como freno **incidental**: dos standalone
idénticos hacen fallar la semana entera —`duplicate_squash_content` en el Week
Creator, `signature_uniqueness_unresolved` en el plan builder—. Es un freno malo,
porque rechaza en vez de acotar, pero existe. §5.1 lo retira.

Después de este spec, nada impide una semana con tres o cuatro partidos al mejor
de 5 si el modelo los propone. Se acepta a conciencia por dos razones: el spec
resuelve un modo de falla real y presente, y ese freno nunca fue un tope
deportivo sino un efecto lateral de una regla de deduplicación.

**El riesgo queda medido, no solo declarado.** `getRecentSquashCompetitiveExposure`
(§3.2) informa al selector en runtime, pero no deja rastro en el artefacto del
loadtest, que guarda métricas allowlisted y **no** conserva contenido de sesión.
Por eso §6 agrega `squashStandaloneMatchCount`: con él, la próxima corrida pagada
puede mostrar cuántas semanas terminan con 0, 1, 2 o 3+ exposiciones competitivas,
que es exactamente la forma del riesgo.

**Follow-up sugerido, fuera de alcance:** un tope explícito de exposición
competitiva por semana, sensible a fase, como regla deportiva de primera clase.
Se deja fuera a conciencia porque imponerlo ahora exigiría diseñar **dos** cosas,
no una: el número por fase, y **qué hacer con el excedente** —descartar, degradar
a finisher, mover de semana—. Además `race` necesita distinguir el evento real de
una exposición previa. Eso amplía el alcance materialmente y merece su propio
ciclo.

## 11. Verificación

`npm run lint && npm test && npm run build`. **Sin corrida de loadtest**: el saldo
de API al 2026-07-30 es ~US$0,60 y una corrida cuesta ~US$0,90. La medición de §6
queda instrumentada para la próxima corrida pagada, cuando haya presupuesto.

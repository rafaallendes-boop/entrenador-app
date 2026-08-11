# Librería de squash — lenguaje de cara al usuario (Entrega 1)

Fecha: 2026-07-31
Estado: diseño aprobado, pendiente plan de implementación
Alcance: `src/services/training/drillLibrary.ts` (nombres y descripciones), más el
índice de búsqueda del catálogo del coach.

## 1. Problema

Los 43 drills de squash son el contenido que el usuario lee en la tarjeta de
sesión, en el plan y en el PDF (`toSquashDrill` copia `name` y `description` a
`SquashDrill.name` / `.notes`). La prosa está bien escrita, pero el vocabulario
es inconsistente y en algunos casos es jerga de entrenador, no lenguaje de
jugador.

Defectos verificados:

- **El mismo golpe, dos tratamientos.** `drive_parallel_depth` se llama "Tiros
  paralelos profundos" y `solo_100_mid_court_shots` "100 drives desde media
  cancha".
- **`boast` traducido en un nombre y sin traducir en su propia descripción.**
  `conditioned_boast_start` se llama "Punto que inicia con pared lateral" y su
  descripción dice "Cada punto empieza con un boast".
- **`game` y `juego` conviven dentro del mismo drill.**
  `practice_match_best_of_3` se llama "al mejor de 3 juegos" y su descripción
  dice "cada inicio de game".
- **Jerga de fisiología en un título.** `rsa_short_bursts` se llama
  "RSA – sprints repetidos de 10-15 segundos". `RSA` es *Repeated Sprint
  Ability*; no significa nada para un jugador.
- **Regionalismo donde el objetivo es español neutro.** `solo_volleys_only` dice
  "por encima de la chapa". El término del deporte es **tin**; "chapa" es de
  Chile y Argentina.
- **Lenguaje de entrenador en nombres.** "Movimiento continuo de base aeróbica",
  "Intervalos aeróbicos en cancha", "Largo controlado de baja carga".

Lo que ya está bien y **no** se toca: el andamio `Objetivo:` / `Clave:` (fijado
por test), el tuteo, `cancha` y `pelota` como vocabulario neutro, el cuadro de
saque como referencia visual concreta de profundidad, y `nick_pressure_closure`,
que es el único drill que glosa su término al usarlo — ese es el patrón que se
generaliza.

## 2. Audiencia y política de terminología

**Audiencia: jugador de club que compite.** Conoce `boast`, `drop`, `lob`,
`nick`, `volea`, `la T`. Traducir esos términos sería incorrecto además de
condescendiente: son el vocabulario real del deporte.

Regla: **conservar el término técnico y usarlo de forma consistente.** La glosa
no es universal: se aplica a la matriz cerrada de abajo, y se repite en cada
drill que use el término, porque las descripciones se leen aisladas como notas de
sesión y no en secuencia.

**Matriz de glosas.** Se glosa el término que nombra un golpe o recurso cuyo
significado **no** se deduce del contexto de la propia descripción. No se glosa
el que es transparente en español, el que el propio texto ya sitúa por dirección
y zona, o el que es vocabulario base ineludible para quien compite.

**Alcance de la glosa: el término que el drill entrena, no toda aparición.** Una
mención incidental dentro de `Clave:` no se glosa, porque duplicar glosas en una
misma descripción la vuelve ilegible. Caso concreto y único en esta entrega:
`attacking_boast_from_back_court` glosa `boast` —que es su objeto— y menciona
`lob` sin glosar en el consejo final ("si estás muy tarde, mejor lob alto y
recupera"). Es deliberado, y el test de glosas debe permitirlo.

| Se glosa en el primer uso | Glosa |
|---|---|
| `boast` | el golpe que va primero a la pared lateral |
| `drop` | pelota corta y suave a la pared frontal |
| `lob` | pelota alta y profunda |
| `nick` | la unión baja entre pared lateral y frontal |
| `tin` | la placa metálica inferior |
| `ghosting` | desplazamientos sin pelota |
| `split-step` | el pequeño salto de ajuste justo antes de que el rival golpee |

| No se glosa | Por qué |
|---|---|
| `drive` | Vocabulario base; la propia descripción lo sitúa por dirección y zona ("drives paralelos desde el fondo") |
| `volea`, `paralela`, `cruzada` | Transparentes en español |
| `la T` | Vocabulario base ineludible para quien compite |
| `multibola`, `juego condicionado` | El propio texto describe el formato |

| Término | Decisión |
|---|---|
| `drive` | Sustantivo, con la dirección de adjetivo: "drive paralelo", "drive cruzado". Reemplaza "tiro", que es genérico |
| `boast`, `drop`, `lob`, `volea`, `nick` | Se conservan siempre, en todos los nombres y descripciones |
| `chapa` | → **`tin`**. La glosa está en la matriz de arriba |
| `ghosting` | Se conserva en texto de usuario. El tipo de bloque interno sigue llamándose `shadows`; la divergencia es deliberada y queda documentada en el código |
| `game` | → **`juego`** en descripciones. Ver la excepción de §5 |
| `RSA`, "base aeróbica", "intervalos aeróbicos extensivos" | Se eliminan del texto de usuario |
| `la T` | Femenino, siempre |

Español neutro: tuteo, `cancha` (no "pista"), `pelota` (no "bola"), sin voseo y
sin regionalismos rioplatenses ni chilenos.

## 3. Convención de nombres

`[golpe o acción] + [zona o condición]`.

Dos reglas que la acotan:

1. **Un nombre no es una instrucción.** La explicación larga vive en
   `description`. "Ataque tomando la pelota antes de que se meta al fondo" es
   difícil de escanear y se trunca en las superficies angostas; el nombre correcto
   es "Ataque antes del fondo".
2. **El volumen entra en el nombre solo cuando define el protocolo.** El modelo
   no tiene repeticiones estructuradas —`SquashDrill` es `name`, `durationMin`,
   `notes`, `executionMode`—, así que la familia de 100 repeticiones en solitario
   y el intervalo de 10-15 s son excepciones justificadas, no la regla.

### Renombres

| id | Hoy | Propuesto |
|---|---|---|
| `drive_parallel_depth` | Tiros paralelos profundos | Drives paralelos profundos |
| `drive_crosscourt_length` | Tiros cruzados profundos | Drives cruzados profundos |
| `drive_switch_parallel_cross` | Cambio de paralelo a cruzado | Alternar drive paralelo y cruzado |
| `boast_to_straight_drive` | Boast y drive paralelo de salida | Boast y salida con drive paralelo |
| `solo_100_drops` | 100 drops en solitario (50 por lado) | Drops en solitario — 100 (50 por lado) |
| `solo_100_mid_court_shots` | 100 drives desde media cancha | Drives desde media cancha — 100 |
| `solo_100_service_box` | 100 drives al cuadro de saque | Drives al cuadro de saque — 100 |
| `solo_100_parallels_back` | 100 drives paralelos desde el fondo | Drives paralelos desde el fondo — 100 |
| `pressure_three_quarters_court` | Ataque desde tres cuartos de cancha | Ataque antes del fondo |
| `conditioned_boast_start` | Punto que inicia con pared lateral | Juego condicionado: el punto abre con boast |
| `rsa_short_bursts` | RSA – sprints repetidos de 10-15 segundos | Series cortas de velocidad en cancha (10-15 s) |
| `continuous_squash_movement_base` | Movimiento continuo de base aeróbica | Movimiento continuo en cancha a ritmo sostenido |
| `extensive_aerobic_movement_intervals` | Intervalos aeróbicos en cancha | Intervalos largos de movimiento en cancha |
| `technical_recovery_length` | Largo controlado de baja carga | Peloteo profundo suave de recuperación |

Los 29 nombres restantes se conservan literalmente.

## 3bis. Descripciones finales

Cambian **21** descripciones. Las **22** restantes se conservan **literalmente**,
carácter por carácter. El plan ejecuta este copy; no lo diseña.

| id | Descripción final |
|---|---|
| `drive_parallel_depth` | Juega drives paralelos desde el fondo hacia la esquina profunda del mismo lado. Objetivo: que la pelota viaje larga, pegada a la pared lateral, y obligue al rival a golpear desde atrás. Clave: no busques potencia; busca altura, largo y repetir el mismo contacto. |
| `drive_crosscourt_length` | Juega drives cruzados hacia la esquina profunda contraria. Objetivo: cambiar de lado sin regalar una pelota corta en media cancha. Clave: apunta alto en la pared frontal y termina el golpe hacia la esquina de fondo, no hacia el centro. |
| `drive_switch_parallel_cross` | Alterna un drive paralelo y uno cruzado desde el fondo o media cancha. Objetivo: cambiar de dirección manteniendo profundidad y control de la T. Clave: prepara igual ambos golpes para que el rival no lea demasiado pronto hacia dónde vas a jugar. |
| `boast_to_straight_drive` | Juega un boast —el golpe que va primero a la pared lateral— y después sal con un drive paralelo profundo. Objetivo: practicar cómo salir del rincón sin quedar atrapado. Clave: después del boast recupera rápido a la T y juega la paralela con largo antes de pensar en atacar. |
| `drop_and_counter_drop` | Desde la zona delantera, juega un drop —pelota corta y suave a la pared frontal— y responde con otro drop del mismo lado o cruzado. Objetivo: mejorar toque, control de altura y paciencia cerca de la pared frontal. Clave: mano suave, pelota baja y segundo bote antes del cuadro de saque. |
| `solo_100_drops` | Sin rival: completa 100 drops —pelotas cortas y suaves a la pared frontal— desde la zona delantera, 50 por lado. Objetivo: construir sensación de mano y control fino sin fatiga alta. Clave: cuenta solo los drops que quedan bajos y mueren antes del cuadro de saque; si empiezas a apurar el brazo, baja el ritmo. |
| `mid_court_drops` | Desde media cancha, juega drops —pelotas cortas y suaves a la pared frontal— hacia la esquina delantera del mismo lado. Objetivo: convertir una pelota cómoda en presión al frente sin avisar. Clave: misma preparación que un drive, menos velocidad al impacto y pelota baja después del bote. |
| `solo_volleys_only` | Volea paralela sin dejar botar la pelota, manteniéndola frente a ti y por encima del tin (la placa metálica inferior). Objetivo: ganar timing y confianza tomando la pelota temprano. Clave: contactos limpios, cortos y controlados; no conviertas el ejercicio en pegar fuerte. |
| `attack_from_t_first_ball` | Desde la T, espera una pelota cómoda en media cancha y atácala hacia una esquina o con un drop claro —pelota corta y suave a la pared frontal—. Objetivo: reconocer cuándo la pelota sí merece ataque. Clave: ataca equilibrado y temprano; si llegas forzado, juega profundo y reconstruye el punto. |
| `conditioned_boast_start` | Cada punto empieza con un boast, el golpe que va primero a la pared lateral. Objetivo: practicar cómo resolver una pelota que abre la cancha y después ordenar el punto. Clave: no admires el boast; sal, recupera a la T y prepárate para la respuesta corta o cruzada. |
| `ghosting_4_corners` | Ghosting, es decir desplazamientos sin pelota: muévete desde la T hacia las cuatro esquinas simulando un golpe real en cada llegada. Objetivo: grabar rutas limpias de movimiento sin depender de la pelota. Clave: llega equilibrado, golpea imaginario y vuelve a la T con el mismo ritmo. |
| `ghosting_6_points` | Ghosting, es decir desplazamientos sin pelota: muévete desde la T hacia seis zonas —frente, media cancha y fondo por ambos lados—. Objetivo: mejorar cobertura completa y cambios de dirección. Clave: rápido no significa desordenado; mantén postura baja y vuelve al centro en cada repetición. |
| `split_step_t_recovery` | Haz un split-step —el pequeño salto de ajuste justo antes de que el rival golpee—, sal hacia la esquina indicada y vuelve a la T. Objetivo: entrenar el primer paso después de leer la dirección. Clave: el split-step es pequeño y reactivo; no saltes alto ni te quedes clavado después del golpe simulado. |
| `rsa_short_bursts` | Haz bloques de 10 a 15 segundos moviéndote explosivo entre la T y las esquinas, con pausa completa entre bloques. Objetivo: repetir esfuerzos cortos e intensos como en los rallies más exigentes. Clave: si la técnica se rompe, corta el bloque; la calidad de pies importa más que sufrir por sufrir. |
| `defensive_high_lob_recovery` | Desde una posición incómoda, juega un lob —pelota alta y profunda— hacia el fondo para ganar tiempo. Objetivo: salir de defensa sin regalar una pelota fácil. Clave: altura primero, profundidad después; vuelve a la T antes de que el rival golpee. |
| `attacking_lob_change_of_pace` | Desde media cancha o el frente, juega un lob —pelota alta y profunda— cuando el rival espera una pelota rápida. Objetivo: cambiar el ritmo y sacarlo de la T. Clave: usa la misma preparación que para una pelota corta y prepárate para atacar la respuesta. |
| `attacking_boast_from_mid_court` | Desde media cancha, juega un boast —el golpe que va primero a la pared lateral— para que la pelota llegue baja al frente. Objetivo: abrir la cancha y obligar al rival a correr hacia adelante. Clave: después del golpe avanza; la ventaja está en tomar temprano la siguiente pelota. |
| `attacking_boast_from_back_court` | Desde el fondo, juega un boast —el golpe que va primero a la pared lateral— con intención ofensiva para llevar la pelota al frente. Objetivo: transformar una defensa larga en una oportunidad de ataque. Clave: úsalo solo si llegas con espacio suficiente; si estás muy tarde, mejor lob alto y recupera. |
| `continuous_squash_movement_base` | Muévete de forma continua desde la T hacia distintas zonas de la cancha, sin acelerar al máximo en ningún momento. Objetivo: sostener movimiento específico de squash durante mucho tiempo sin convertirlo en sprint. Clave: respiración estable, postura limpia y vuelta a la T en cada movimiento. |
| `match_sim_points_short_sets` | Disputa un juego a 11 puntos con diferencia de 2, marcador real y servicio como en competencia. Objetivo: sentir presión real en formato corto. Clave: usa tu rutina entre puntos, juega el primer tiro con intención y observa cómo cierras cuando el marcador pesa. |
| `practice_match_best_of_3` | Juega un partido al mejor de 3 juegos con marcador normal. Objetivo: competir con intensidad sin acumular la carga de un mejor de 5. Clave: trata cada inicio de juego como competencia real y revisa si mantienes tu plan bajo presión. |

`match_sim_points_short_sets` aparece acá aunque su **nombre** esté congelado por
§5: la excepción alcanza al nombre, no a la descripción.

## 4. Qué NO entra en esta entrega

Esta entrega es **copy puro**. No cambia `category`, `focus`, `tags`,
`phaseAppropriate`, `partnerRequired`, `executionMode`, `intensity` ni
`progressionLevel` de ningún drill.

La razón es que ninguno de esos campos es una etiqueta:

- **`category`** interviene en `inferDrillPhaseAppropriate`
  (`drillLibrary.ts:582-583`): `tactical → ['build','peak']` contra
  `technical → ['base','build','peak','taper']`. Mover `attacking_lob_change_of_pace`
  a `tactical` lo sacaría de base y taper. También interviene en `matchesAxis`
  (`drillSelector.ts:171`), que en relajación `strict` exige
  `candidate.category === original.category`: cambiar una categoría cambia el
  pool de rotación.
- **`focus`** alimenta `scoreByFocusOverlap`, que ordena los candidatos de
  rotación. Como el candidato elegido es `candidates[rotationIndex % length]`,
  cambiar el vocabulario de `focus` cambia qué drill sale.
- **`tags`** alimentan `filterByFatigue`, `isControlDrill`, `isShadowsDrill` y la
  rama de respaldo de `isPhaseAllowed`.

Todo eso modifica el planificador. Va en una entrega posterior, separada y
medible.

### Deuda registrada, con su ripple exacto

1. **Vocabulario de `focus` partido.** `mid_court` (`pressure_three_quarters_court`,
   `attacking_boast_from_mid_court`) contra `midcourt` (`solo_100_mid_court_shots`,
   `volley_control_midcourt`), y `target` contra `targets`. Como `focus` alimenta
   `searchText` (`coachExerciseCatalog.ts:72`), buscar "midcourt" en el picker
   encuentra dos drills de media cancha y se pierde los otros dos.
2. **`category` mal asignadas.** Los drills de selección de golpe están en
   `technical` aunque su objetivo declarado es una decisión táctica:
   `attacking_lob_change_of_pace`, `attacking_boast_from_mid_court`,
   `attacking_boast_from_back_court` —los **dos** boasts ofensivos—,
   `nick_pressure_closure` y `front_court_angle_finish`.
   `multiball_pressure_finishes` está en `physical`; moverlo a `tactical` lo
   sacaría de la fase base por `inferDrillPhaseAppropriate`.
3. **`pre_match_activation_timing` está en `category: 'match'`** siendo una
   activación de intensidad baja. Es la causa de que `squashMatchRole.ts` tenga
   que enumerar los IDs competitivos a mano. Sacarlo de `match` cambia dos cosas
   a la vez: el bloque pasa de `match` a `technical`, y `inferPartnerRequired`
   pasa de `true` a `false` —la rama `category === 'match'` es la que lo hacía
   true—, lo que altera el filtrado para jugadores sin partner en taper.

## 5. Excepción documentada: los drills de partido

Los tres drills de partido **conservan su nombre actual**, incluido
`match_sim_points_short_sets` = "Game a 11 con marcador real", que contradice la
regla `game → juego` de §2.

La excepción existe porque esos nombres están hardcodeados como literales en
**cinco consumidores, además de la definición canónica en `drillLibrary.ts:544`**,
y porque `resolveSquashMatchRole` define
`standalone` por el `id` de `practice_match_five_games`. Renombrarlos agrega
superficie de rotura sobre el predicado de rol de §17, que todavía no está
desplegado ni medido.

Consumidores con el literal, sin contar tests ni la propia definición:

| Archivo | Líneas |
|---|---|
| `src/services/ai/promptModules/squashPrompt.ts` | 246, 350 |
| `src/services/ai/responseNormalizer.ts` | 885 |
| `src/services/ai/prompt/packs/sports/squash.ts` | 15 |
| `src/services/weekCreator/WeekCreatorEngine.ts` | 1521, 1570, 1602 |
| `src/services/planBuilder/repairWeek.ts` | 1312, 1315 |

La regla `game → juego` **sí** aplica a las descripciones: la de
`practice_match_best_of_3` pasa de "cada inicio de game" a "cada inicio de
juego".

Deuda: centralizar esos tres nombres por `id` en vez de literales, y renombrarlos
en una entrega aparte.

## 6. Compatibilidad

`SquashDrill.name` es un string denormalizado dentro de cada sesión guardada, así
que los nombres viejos viven en Dexie, en las plantillas de la Biblioteca, en los
planes guardados y en los backups.

**`aliases` pasa a ser un campo de la definición**, no un mapa suelto:

```ts
export interface SquashDrillDefinition {
  // ...
  /** Nombres canónicos anteriores. Resuelven al drill y entran a la búsqueda. */
  aliases?: string[]
}
```

Se consume en dos lugares:

1. **`findSquashDrillByName`**, **después** de la coincidencia exacta por nombre
   canónico y **antes** de la difusa por tokens. El orden no es arbitrario: un
   nombre canónico vigente tiene que ganarle siempre al alias viejo de otro
   drill, y el alias tiene que ganarle a la coincidencia difusa. El mapa privado
   `DRILL_NAME_ALIASES` conserva su posición actual, previa a la exacta, porque
   moverlo cambiaría la resolución de nombres históricos que hoy funciona.
2. **`searchText` en `coachExerciseCatalog.ts:72`**, que hoy solo indexa
   `name`, `tags` y `focus`. Sin esto, un coach que busca el nombre viejo en el
   picker no encuentra el drill.

**Límite aceptado, no resuelto:** una sesión histórica seguirá mostrando el
nombre viejo, porque la interfaz renderiza el `drill.name` guardado en la fila.
Reescribir datos almacenados queda fuera de alcance: sería una migración con
riesgo desproporcionado para una mejora de copy.

## 7. Invariantes congeladas por `id`

Un test recorre los 43 drills y compara contra una tabla fija por `id`, de modo
que una edición de copy no pueda mover el planificador.

**Campos crudos congelados.** `name`, `description` y el nuevo `aliases` son las
**únicas** excepciones; todo lo demás debe quedar idéntico:

1. `category`
2. `focus`
3. `tags`
4. `intensity`
5. `intent`
6. `constraints`
7. `progressionLevel`

Congelar el campo crudo y no solo su derivado importa porque una edición
accidental en `focus`, `tags` o `intent` puede no mover la familia ni el bloque
de inmediato y aparecer más tarde como una diferencia de rotación.

**Derivados congelados**, porque cada uno tiene su propia función de resolución:

8. `phaseAppropriate` resuelto (`inferDrillPhaseAppropriate`)
9. `partnerRequired` resuelto (`inferPartnerRequired`)
10. `executionMode` resuelto (`resolveDrillExecutionMode`)
11. La familia que devuelve `getSquashDrillFamily` (`drillLibrary.ts:749`)
12. El bloque que devuelve `resolveSquashDrillKind`

**Compatibilidad:**

13. Cada nombre canónico anterior resuelve por `findSquashDrillByName` al **mismo
    `id`**, y **cada nombre canónico vigente resuelve a su propio drill**:
    `findSquashDrillByName(drill.name)?.id === drill.id` para los 43. Este
    segundo recorrido es el que detecta una colisión, venga del mapa privado
    `DRILL_NAME_ALIASES` —46 claves, consultadas antes de la coincidencia
    exacta— o de los `aliases` nuevos.
14. `searchCatalog('squash', <nombre anterior>)` devuelve una entrada cuyo
    `libraryId` es el `id` esperado. Se prueba por la API pública
    (`coachExerciseCatalog.ts:95`) y no inspeccionando `searchText`, que está
    normalizado por `normalizeCatalogText`.
15. **Estabilidad de firma.** Las firmas resuelven vía
    `findSquashDrillByName(...)?.id`, así que con aliases completos el renombre
    no las mueve. Es lo que protege la metadata `planBuilderSquashRotation` y
    `hasCanonicalSquashRotation`. Hay **dos** implementaciones privadas de
    `buildSquashDrillSignature` —`repairWeek.ts:2027` y
    `validateWeekCreatorResponse.ts:273`— más `canonicalSquashSignature`
    (`repairWeek.ts:1985`). Se prueban **por comportamiento público**: una semana
    con nombres viejos y la misma semana con nombres nuevos deben producir la
    **misma firma**, las **mismas decisiones de rotación y deduplicación** y el
    **mismo resultado semántico al normalizar los drills por `id`**, tanto en
    `repairGeneratedWeek` como en la validación del Week Creator.
    **No es igualdad profunda**: los nombres viejos siguen siendo viejos, porque
    el repair no reescribe un `drill.name` que ya resuelve. Comparar las
    estructuras completas fallaría por diseño. No se exportan internos solo para
    el test.

Tests adicionales de contenido:

- Se mantiene el andamio `Objetivo:` / `Clave:` y el mínimo de 120 caracteres
  (test existente en `drillLibrarySchema.test.ts`).
- Ningún nombre ni descripción contiene `RSA`, `chapa` ni `game`. La **única**
  excepción es `match_sim_points_short_sets.name`, fijada así de estrecha a
  propósito: la descripción de ese mismo drill sí debe cumplir la regla.
- La prohibición alcanza solo al texto de usuario: el **tag** `rsa` se conserva,
  porque `getSquashDrillFamily` ramifica sobre él (`drillLibrary.ts:755`) y
  borrarlo cambiaría la familia de progresión de `rsa_short_bursts`.
- Ningún texto contiene "el T"; `la T` es femenino.

## 8. Criterio de aceptación

- Los 14 renombres de §3 y las 21 descripciones de §3bis quedan aplicados
  literalmente; los 29 nombres y las 22 descripciones restantes quedan idénticos.
- Las 15 invariantes de §7 pasan.
- `npm run lint`, `npm test` y `npm run build` en verde.
- Cero cambios en `category`, `focus`, `tags` y metadata de fase.
- Sin migraciones Dexie ni Supabase.

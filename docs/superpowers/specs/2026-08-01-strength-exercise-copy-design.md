# Librería de fuerza — copy por `id` y español de gimnasio

Fecha: 2026-08-01
Estado: diseño propuesto, pendiente revisión editorial
Base: `3d480b3` + Entrega 4 `libraryRef`-first del mismo día

## 1. Problema

La librería de 77 ejercicios ya decide selección, carga y estructura por
metadata e identidad estable. El texto visible todavía mezcla tres registros:

- español claro: `Sentadilla trasera con barra`, `Jalón al pecho`;
- términos técnicos habituales del gimnasio: `dead bug`, `goblet`, `Pallof`,
  `trap bar`;
- conectores o jerga interna innecesaria: `stance`, `setup`, `tracking`,
  `bracing`, `snap`, `cachado`, `repeat sprint`, `reps`, `overhead`, `lunge` y
  `footwork` dentro de descripciones en español.

También hay nombres gramaticalmente duros (`Remo medio arrodillado`, `Control
de tronco dead bug`) y patrones de escalera que mezclan inglés sin explicar el
movimiento.

El objetivo no es traducir todo. Es dejar nombres escaneables y descripciones
entendibles para un deportista que entrena fuerza, conservando los términos que
realmente se usan en un gimnasio.

## 2. Audiencia y política de terminología

**Audiencia:** deportista de club que conoce una sala de pesas, pero no tiene
por qué conocer jerga de programación o biomecánica en inglés.

Se conservan como términos técnicos:

- `bird dog`, `Copenhagen`, `dead bug`, `fitball`, `goblet`;
- `Icky shuffle`, `kettlebell`, `landmine`, `Pallof`;
- `push press`, `split-step`, `trap bar`, `TRX`.

La primera descripción que dependa de uno de ellos explica la ejecución; no se
traduce el nombre con una expresión que nadie usa en el gimnasio.

Se retiran de las descripciones:

| Hoy | Copy final |
|---|---|
| `stance` | posición / separación de pies |
| `setup` | posición inicial |
| `tracking` | alineación |
| `bracing` | tensión del tronco |
| `snap` | extensión explosiva |
| `cachado` / `catch` | recepción |
| `repeat sprint` | esfuerzos intensos repetidos |
| `reps` | repeticiones |
| `overhead` | vertical / por encima de la cabeza |
| `lunge` | zancada |
| `footwork` | juego de pies |
| `step-up` | subida al cajón |

Reglas de estilo:

- español neutro, tuteo; sin voseo ni regionalismos;
- una primera frase explica qué hacer; la siguiente declara el objetivo o la
  clave técnica útil;
- nada de promesas de prevención de lesiones ni equivalencias médicas;
- `name`, `description` y `aliases` son los únicos campos editables.

## 3. Precondición descubierta: hay un cuarto productor

La Entrega 4 inventarió selector, core inyectado y expansión de footwork como
productores deterministas. El barrido de copy encontró otro:
`buildFallbackSession` (`WeekCreatorEngine.ts`) construye dos variantes de
fuerza con 14 filas literales —13 ids únicos, porque `dead_bug` se repite— y sin
`libraryRef`.

Antes de renombrar:

1. esos ejercicios se construyen por `id` mediante un helper único;
2. el helper lee el nombre actual desde `getExerciseById`;
3. estampa `{ source: 'strength_exercise', id }`;
4. un test congela que solo aparece el campo nuevo: peso, porcentaje, RPE,
   repeticiones, grupo y warmups quedan iguales.

`strengthSessionStructure.ts` también deja de repetir los cuatro nombres que
genera (`dead_bug` y tres escaleras): recibe el `id` y toma el copy del
catálogo. Así un renombre no vuelve a desincronizar productor y definición.

## 4. Renombres cerrados

Cambian **12 de 77** nombres. Los 65 restantes se conservan literalmente.

| id | Nombre actual | Nombre final |
|---|---|---|
| `air_treadmill_20_20` | Trotadora de aire 20/20 | Trotadora curva 20/20 |
| `copenhagen_side_plank` | Plancha lateral Copenhagen | Plancha Copenhagen |
| `dead_bug` | Control de tronco dead bug | Dead bug — control de tronco |
| `half_kneeling_diagonal_plate_chop` | Corte diagonal con disco medio arrodillado | Corte diagonal con disco en media rodilla |
| `half_kneeling_lateral_jump` | Salto lateral medio arrodillado | Salto lateral desde media rodilla |
| `half_kneeling_row` | Remo medio arrodillado | Remo en media rodilla |
| `ladder_bipodal_front_2` | Escalera frontal – in-in-out-out | Escalera frontal – dentro-dentro-fuera-fuera |
| `ladder_bipodal_lateral_3` | Escalera lateral – shuffle in-in-out | Escalera lateral – dentro-dentro-fuera |
| `landmine_press` | Landmine press | Press con barra en landmine |
| `overhead_press` | Press sobre cabeza | Press vertical |
| `push_press` | Push press con impulso | Push press |
| `split_squat` | Sentadilla en zancada | Zancada estática |

Cada nombre anterior se agrega a `aliases` del mismo `id`, aunque ese ejercicio
ya tenga otros aliases. Los aliases se incluyen en el buscador del picker desde
la entrega del 19 de julio, así que nombre nuevo y viejo encuentran la misma
entrada.

## 5. Descripciones finales

Cambian **31 de 77** descripciones. Las otras 46 se congelan carácter por
carácter.

| id | Descripción final |
|---|---|
| `air_treadmill_20_20` | Completa 4 minutos en una trotadora curva alternando 20 segundos fuertes y 20 segundos suaves. Busca aceleraciones cortas y una técnica rápida sin prolongar el esfuerzo. |
| `alternating_step_up_jump` | Sube de forma explosiva al cajón y cambia de pierna en el aire antes de aterrizar. Entrena potencia unilateral y ritmo; prioriza una recepción estable. |
| `assault_bike_30_30` | Completa 4 minutos en bici de asalto alternando 30 segundos fuertes y 30 segundos suaves. Mantén potencia alta y una postura estable durante cada esfuerzo. |
| `barbell_jump_squat` | Haz una sentadilla con barra y termina cada repetición con un salto. Usa una carga ligera —como máximo 30% de tu sentadilla trasera— y aterriza con control. |
| `bb_reverse_lunge` | Da una zancada hacia atrás con la barra en posición alta. Entrena desaceleración, control de cadera y fuerza en posiciones amplias de cancha. |
| `clean` | Lleva la barra desde el piso hasta los hombros mediante un tirón explosivo y una recepción estable. Es un movimiento avanzado: aprende la técnica antes de aumentar la carga. |
| `clean_high_pull` | Extiende cadera, rodillas y tobillos para realizar un tirón alto explosivo, sin recibir la barra en los hombros. Desarrolla potencia mientras se aprende la cargada completa. |
| `close_grip_bench_press` | Haz press banca con un agarre más cerrado que el habitual. Mantiene el patrón de empuje y aumenta el trabajo de tríceps sin cambiar el levantamiento principal. |
| `copenhagen_side_plank` | Mantén una plancha lateral con la pierna superior apoyada en un banco. Entrena aductores y estabilidad lateral; comienza con apoyo de rodilla antes de progresar al tobillo. |
| `dead_bug` | Acuéstate boca arriba y extiende de forma alternada un brazo y la pierna contraria sin perder la posición de la pelvis. Coordina la respiración con el control del tronco. |
| `depth_jump` | Déjate caer desde un cajón y enlaza el aterrizaje con un salto vertical alto. Es una pliometría avanzada de alta intensidad: usa muy pocas repeticiones y prioriza la calidad. |
| `farmer_carry` | Camina sosteniendo una mancuerna o kettlebell en cada mano. Mantén el tronco firme, los hombros estables y una marcha natural durante todo el recorrido. |
| `goblet_squat` | Sostén una mancuerna o kettlebell frente al pecho y realiza la sentadilla con el tronco estable. Es una opción accesible para practicar técnica o sumar volumen. |
| `half_kneeling_diagonal_plate_chop` | Desde media rodilla, mueve un disco en diagonal sin perder la posición de la pelvis. Mantén caderas y pies estables para que el control nazca del tronco. |
| `half_kneeling_lateral_jump` | Desde media rodilla, impulsa la cadera y salta lateralmente hasta una recepción estable. Entrena potencia en el plano frontal desde una posición baja. |
| `half_kneeling_row` | Desde media rodilla, tira de la polea, banda o mancuerna hacia el cuerpo. Mantén la pelvis estable y evita girar la cadera durante el remo. |
| `hip_thrust` | Apoya la espalda en un banco y extiende la cadera con la barra sobre la pelvis. Entrena fuerza de glúteos con transferencia a aceleraciones y saltos. |
| `kettlebell_swing` | Lleva la kettlebell hasta la altura del pecho mediante una extensión explosiva de cadera. El impulso nace de la bisagra, no de levantar el peso con los brazos. |
| `ladder_bipodal_front_2` | Entra con ambos pies en un cuadro y sácalos a los lados del siguiente antes de volver a entrar. Repite la secuencia dentro-dentro-fuera-fuera con ritmo y precisión. |
| `ladder_bipodal_lateral_3` | Avanza de costado entrando ambos pies en el cuadro y sacando uno antes del siguiente paso. Mantén la cadera baja y un ritmo lateral preciso. |
| `ladder_coordinativo_front_4` | Ejecuta el patrón Icky shuffle: dos apoyos dentro y uno fuera mientras avanzas en diagonal. Aumenta la velocidad solo cuando puedas conservar la precisión. |
| `landmine_press` | Empuja la barra en diagonal desde el hombro usando el anclaje landmine. Permite entrenar un press fuerte con menor demanda vertical y buen control del tronco. |
| `lateral_band_walk` | Da pasos laterales cortos con una banda en las rodillas o los tobillos. Mantén el tronco quieto y las rodillas alineadas con los pies. |
| `overhead_press` | Empuja la barra o las mancuernas en vertical hasta extender los brazos por encima de la cabeza. Mantén el tronco firme y controla la posición de los hombros. |
| `pallof_press` | Con una polea o banda tirando desde un costado, extiende los brazos al frente sin dejar que el tronco gire. Mantén tensión abdominal durante toda la repetición. |
| `pogo_jumps` | Encadena saltos verticales bajos usando principalmente los tobillos. Mantén poco tiempo de contacto con el suelo y una flexión mínima de rodillas para mejorar la respuesta del split-step. |
| `push_press` | Inicia el press con una flexión corta de piernas y transmite ese impulso a la barra o las mancuernas. Busca velocidad y una recepción estable por encima de la cabeza. |
| `split_squat` | Desde una zancada fija, baja y sube sin mover los pies de su posición inicial. Es un patrón unilateral accesible para aprender control y sumar volumen. |
| `stability_ball_front_plank` | Apoya los antebrazos sobre un fitball y mantén una plancha frontal estable. Controla la relación entre hombros y tronco; agrega círculos pequeños para aumentar la dificultad. |
| `sumo_deadlift` | Realiza el peso muerto con una separación amplia de pies y el agarre por dentro de las piernas. La variante aumenta la participación de aductores sin dejar de ser una bisagra pesada. |
| `z_press` | Sentado en el piso con las piernas extendidas, empuja la barra o las mancuernas en vertical. Mantén el tronco erguido para exponer y entrenar el control de hombros y zona media. |

## 6. Invariantes

Un snapshot generado **antes** de editar congela por `id`:

- `category`, `movement`, `intensityType`, `equipment`, `unilateral`, `tags`;
- `difficulty`, `sportsTransfer`, `squashTransfer`, `riskLevel`, `fatigueCost`;
- `loadReference`, `prescriptionUnit`, `appropriateForPhases`,
  `blockRotationGroup`;
- los 65 nombres y las 46 descripciones fuera de alcance.

Quedan fuera del snapshot únicamente:

- `name` de los 12 ids de §4;
- `description` de los 31 ids de §5;
- `aliases`, que gana el nombre anterior en los 12 renombres.

No se actualiza el snapshot después de editar. Si cambia, la entrega salió del
carril de copy.

## 7. Compatibilidad y fronteras

- contenido legacy sin ref: resuelve por el alias del nombre anterior;
- contenido con ref: resuelve por `id`, aunque conserve el texto guardado;
- editar el nombre manualmente sigue borrando el ref;
- el picker busca tanto nombre nuevo como anterior;
- no hay backfill ni reescritura automática de sesiones existentes;
- un renombre cambia copy futuro, no el texto ya persistido en una sesión.

## 8. Criterio de aceptación

1. Los 12 nombres y 31 descripciones coinciden exactamente con las tablas.
2. Cada nombre anterior resuelve y busca el mismo `id`.
3. Los 77 nombres canónicos siguen siendo unívocos.
4. Selector, comportamiento de carga, roles y calidad producen las mismas
   firmas por `id` que antes del copy.
5. Los fallbacks del Week Creator y los ejercicios estructurales toman el
   nombre desde el catálogo y estampan ref.
6. Un barrido base/nuevo compara `weight`, `targetPercent1RM`, `targetRpe`,
   `reps`, `group` y `warmupSets`: cero diferencias.
7. TypeScript, lint, suite completa, build y `git diff --check` quedan verdes.

## 9. Fuera de alcance

- Cambiar tags, categorías, equipamiento, factores o prescripción.
- Fusionar los dos lanzamientos rotacionales con balón medicinal; parecen
  duplicados, pero resolver esa diferencia es contenido deportivo, no copy.
- Backfill de sesiones, plantillas o planes existentes.
- Traducir ids, aliases técnicos o tags internos.
- Hacer que una sesión persistida cambie su nombre visible al leerla.

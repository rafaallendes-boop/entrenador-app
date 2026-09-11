Ampliación de potencia, escalera y finishers — 10 de septiembre de 2026

El catálogo pasa de 108 a 117 ejercicios. Se conservan las identidades de salto horizontal, salto horizontal a una pierna, saltos de patinador, pogo y los siete patrones de escalera existentes. Se añade una prescripción específica compartida entre el selector automático y la biblioteca manual.

**Ejercicios nuevos y dosis iniciales**

| Ejercicio | Dosis | Recuperación | Nivel |
|---|---|---|---|
| Tres saltos horizontales encadenados | 3 series de una secuencia de 3 saltos | 120 s entre series | Avanzado |
| Saltos horizontales alternados | 3 × 6 apoyos, 3 por pierna | 120 s | Avanzado |
| Saltos laterales rápidos sobre mini valla | 3 × 6 contactos, 3 por dirección | 90 s | Intermedio |
| Saltos laterales a una pierna sobre mini valla | 3 × 4 contactos por pierna | 120 s | Avanzado |
| Escalera lateral con paso cruzado | 2 × 2 pasadas por dirección | 45 s | Intermedio |
| Escalera lateral con Icky shuffle | 2 × 2 pasadas por dirección | 45 s | Intermedio |
| Escalera con split-step y salida de 3 m | 2 × 2 pasadas con salida | 60 s | Intermedio |
| Cinta 30/30 | 1 bloque de 4 rondas: 30 s fuerte + 30 s suave | Incluida en cada ronda; 4 min totales | Intermedio |
| Bici de asalto 15/45 | 1 bloque de 6 rondas: 15 s fuerte + 45 s suave | Incluida en cada ronda; 6 min totales | Intermedio |

Las dosis son decisiones iniciales de programación, con poco volumen de saltos y recuperación explícita; no constituyen umbrales validados para todos los deportistas. Se priorizan distancia o rapidez de contacto sólo mientras se conserva el control de la recepción. La NSCA distingue las diferentes demandas de la pliometría y recomienda elegir su objetivo dentro de la carga total de entrenamiento. [NSCA: ejercicios pliométricos](https://www.nsca.com/education/articles/kinetic-select/plyometric-exercises/).

El salto horizontal existente queda en 3 × 3 con 120 s de descanso y el unilateral en 3 × 3 por pierna. Pogo y patinador reciben dosis por contactos o lado. Los patrones de escalera usan pasadas, con instrucciones para alternar la dirección o el pie de inicio. Se mantiene su función de coordinación; la aplicación no equipara completar patrones prefijados con entrenar toda la agilidad de un deporte de raqueta. La transferencia depende de las características de la tarea. [NSCA: transferencia del entrenamiento de agilidad](https://www.nsca.com/education/articles/kinetic-select/transfer-of-training-for-agility/).

**Qué cambia en la selección y el uso**

- Los objetivos que **nombran el salto** —«saltos horizontales», «saltar más lejos», «bounding», «multisaltos»— priorizan esa familia. `distancia` y `metros` sueltos no bastan: pertenecen al vocabulario de carrera («correr 10 mil metros») y ascendían pliometría en una sesión de apoyo a un fondista. Los objetivos que mencionan mini vallas priorizan sus variantes, siempre dentro del nivel y material disponible. El intervalo de un finisher se elige por su grafía —«30/30», «30 seg in 30 seg out»—, nunca por un número suelto como «30 min».
- Ambas rutas de selección usan la misma decisión de coordinación/finisher. Se puede pedir escalera y cinta en una sesión suficientemente larga.
- El relleno de las plantillas ya no añade cardio por puntuación, tiene tope de core por `getTargetCoreCount` y garantiza un compuesto de tren inferior antes del relleno genérico. El selector limita a dos ejercicios de potencia ajenos al acondicionamiento y a un finisher. El finalizador también limita a un finisher, incluso si recibe varios del modelo.
- Los finishers quedan al cierre del grupo de cardio, después de la escalera. Se conserva el orden general de los grupos de fuerza de la aplicación; la revisión integral del orden activación/potencia/fuerza sigue en el informe anterior.
- La dosis de cinta es un bloque de cuatro minutos: dos minutos fuertes y dos suaves. No son cuatro bloques de cuatro minutos. «Out» se traduce como recuperación suave reduciendo velocidad, con una indicación de no saltar a los laterales de la cinta en movimiento.
- No se añaden finishers con fatiga de 7 o más, recuperación extra, señal de riesgo de carga, competición cercana —incluidos los cuatro días previos cuando se informa la distancia— ni sesiones de menos de 45 minutos. Son límites conservadores del producto, no una prescripción individual universal.
- **El freno agudo es transversal, no depende de tener tabla de dosis.** `isImpactPowerExercise` clasifica por `safety.loadPatterns` en la biblioteca: cubre los 19 ejercicios de impacto del catálogo, incluidos `depth_jump`, `drop_jump`, `barbell_jump_squat` y `jump_squat`, que antes quedaban fuera del filtro por no haber recibido `athleticPrescription`. La fase permitida la sigue declarando cada ejercicio en `appropriateForPhases`. La potencia cargada sin recepción —`push_press`, `clean_high_pull`, `kettlebell_swing`— no entra en esta regla.
- **Un retiro por contexto no se reporta como restricción.** `BlockedReason` incorpora `training_context_unavailable` con copy y aviso propios; reusar el copy de restricción le decía a un atleta sin lesión declarada que su restricción impedía la sesión.
- Los saltos y finishers nuevos tienen regiones y patrones de carga explícitos. La restricción de impacto excluye los saltos y la carrera; la bici conserva su elegibilidad si las demás restricciones lo permiten.
- La biblioteca manual recibe la misma dosis inicial y las notas de recuperación que el selector. Los isométricos declarados por segundos también tienen un valor temporal en esa biblioteca.

**Equipo y reemplazos**

Se incorporan `mini_hurdles` y `treadmill` con etiquetas visibles «Mini vallas» y «Cinta de correr», y el preset «Gimnasio completo» los declara: sin eso los dos ejercicios de mini valla eran inalcanzables para todos los presets mientras el inventario ausente sí los alcanzaba.

La cinta convencional se distingue de la curva en el vocabulario, con dos precauciones. En un **nombre de ejercicio**, `cinta` a secas no nombra equipamiento: en español de Chile «cinta elástica» es una banda, y el token suelto dejaba sin resolver 79 ejercicios cuyo nombre la menciona. Sólo la secuencia completa `cinta de correr` nombra la máquina. En un **inventario declarado**, «trotadora» o «cinta» a secas acreditan tanto `treadmill` como `air_treadmill`: antes de esta ampliación significaban la curva, y reasignarlos sólo a la convencional le habría quitado en silencio un ejercicio al atleta que ya lo tenía. El texto preciso —«cinta de correr», «trotadora curva»— no se vuelve ambiguo.

Los finishers nuevos exigen su equipo real. Se añadió `requiredEquipment` para corregir las siete escaleras existentes y los dos intervalos antiguos: peso corporal ya no acredita una escalera y máquinas de fuerza ya no acreditan bici de asalto o trotadora curva. El mismo predicado se aplica en selección y finalización.

En los reemplazos que involucran estas familias se conserva la distinción entre coordinación, potencia y finisher. Un salto, una zancada o un ejercicio de escalera no se cambia por un intervalo de cinta por compartir `locomotion`. Esta regla específica no resuelve todavía todas las equivalencias de fuerza descritas en la revisión integral, como press frente a aperturas.

Los finishers antiguos 30/30 de bici y 20/20 de curva quedan explícitamente habilitados en base/build/peak, separando su uso de acondicionamiento de las fases inferidas para potencia.

**Validación**

Se añadieron pruebas de identidad y alias de las nueve altas, coherencia entre biblioteca manual y selección, equipo, preferencias en las cuatro configuraciones del selector, volumen, restricciones, reemplazos, orden del finisher y finalización de propuestas de IA.

Los snapshots del catálogo se ampliaron con nueve filas, comprobando que las 108 anteriores conservaran sus valores salvo la ampliación explícita a fase base de los dos finishers antiguos. Se revisaron tres cambios de selección sin inventario declarado, en los que ahora puede aparecer la mini valla. Los IDs históricos permanecen intactos.

Verificación final: **5.166 pruebas aprobadas en 593 archivos**, incluidas las 46 de esta ampliación y las 36 del endurecimiento posterior (`athleticTrainingHardening.test.ts`). **Build completo, TypeScript y lint global aprobados.** La auditoría cruza ahora **720 sesiones** —se añadió el inventario no declarado— y valida el equipamiento con `hasExerciseEquipment`, el mismo predicado de producción, así que también comprueba `requiredEquipment`. Sin violaciones. No se aumentaron timeouts ni se hizo despliegue.

Los catorce defectos que encontró la revisión posterior, y su corrección, están en la §9 del [informe del selector](2026-09-10-strength-selector-review.md).

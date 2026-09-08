# Revisión de bibliotecas y selección: squash y running

Fecha: 7 de septiembre de 2026. Objetivo: mejorar una app cuyo deporte principal es squash, con running como complemento salvo objetivo explícito de carrera.

Alcance: inventario completo, selectores, progresión, composición, contexto de prompts y reparación de sesiones. Se ejecutaron comprobaciones sobre módulos reales con Vite SSR, sin proveedor IA. Este documento propone cambios; no implementa altas ni modifica código funcional. Los fallos locales no implican que todas las rutas de la app los dejen llegar al calendario: algunas tienen reparaciones posteriores.

## Conclusión

Squash tiene una biblioteca sustancial de **60 drills**, pero faltan dosis adaptables, progresión basada en resultados y una selección más específica al problema del jugador. Running tiene **27 plantillas en 8 familias**, pero sus filtros y su materialización no garantizan duración, adaptación al nivel ni baja interferencia con squash.

La prioridad es hacer que se elijan y dosifiquen bien los contenidos existentes. Después, ampliar con problemas de juego y variantes de running de apoyo, evitando aumentar el catálogo con duplicados.

## 1. Cobertura de squash

| Modalidad | Cantidad | Cobertura |
|---|---:|---|
| technical | 37 | Drives, voleas, drops, boasts, lobs, resto, T, transiciones, juegos condicionados y multibola. Incluye táctica además de técnica. |
| control | 14 | Práctica individual de golpes, saques, patrones de volumen y activación. |
| shadows | 6 | Ghosting, split-step, velocidad repetida y movimiento aeróbico en cancha. |
| match | 3 | Game a 11, partido al mejor de 3 y al mejor de 5. |

Ejecución declarada: 37 con compañero, 20 individuales y 3 de partido. Intensidad: 14 baja, 33 moderada, 13 alta.

### Lo que ya funciona como base

- Identidades, alias y modalidad explícita; no es necesario adivinar por el título si un drill es partido o control.
- Compositor compartido (`squashSessionHydrator`) y reglas de compatibilidad entre modalidad principal y accesorios.
- Filtros por fatiga, fase y disponibilidad de compañero; reemplazo de drills con exclusiones.
- Señales de exposición competitiva y una política semanal dedicada, además de plantillas semanales por fase.
- Biblioteca con saque/resto, ambos lados, defensa, ataque y decisión. No hace falta agregar esas familias como si estuvieran ausentes.

### Problemas confirmados y mejoras

**S1. La duración solicitada no gobierna la composición.** Con fase build, fatiga 4, compañero y objetivo «mejorar squash», `hydrateSquashSession` devuelve los mismos 3 drills y 52 minutos para solicitudes de 20, 45 y 60 minutos. Para 60 añade una advertencia de que faltan drills. El tiempo se usa para exigir una cantidad mínima, pero no se reparte entre ejercicios ni se ajustan dosis. Propuesta: presupuesto total que incluya calentamiento, trabajo, pausas y cierre; cantidad de drills subordinada a ese presupuesto.

**S2. La progresión acepta sesiones no realizadas.** `deriveSquashProgressionState` produce la misma recomendación con un drill en estado completed, planned o skipped. Filtra tipo y drills, pero no estado. Filtrar realizadas y distinguir «planificado» de «ejecutado»; revisar también `extractRecentSquashKinds`, que no filtra estado.

**S3. Rotar puede desplazar el aprendizaje.** Dos sesiones consecutivas con la misma familia disparan rotación; también tres apariciones en las últimas seis. La frecuencia cuenta drills, no necesariamente sesiones distintas. Además, todos los drills solo/volume_reps caen en `solo_control_volume`, mezclando saque, drop y paralelas. Separar familia técnica de modalidad de ejecución y progresar por aciertos/calidad/esfuerzo, no por mera aparición.

**S4. Selección de propósito amplio, con poca información del problema real.** El contexto tiene goal y competitiveLevel, pero no lateralidad dominante, lado débil, consistencia, errores frecuentes ni objetivo medible del bloque. Introducir una intención como «resto de revés bajo presión» que seleccione fundamento, variación y aplicación. Evitar elegir varios drills parecidos solo porque empatan en puntuación.

**S5. Compañero: la capacidad existe pero no todos los productores la transmiten.** Chat y reparación sí leen partnerAvailability; `getSquashSelectionContext` del prompt no lo transmite. La búsqueda en componentes/páginas no encontró captura de ese campo. No asumir que está ausente del modelo de datos: el campo existe. Capturarlo por sesión y distinguir compañero de alimentador/entrenador; multibola no tiene las mismas necesidades que peloteo.

**S6. La vía genérica puede relajar fase.** Sin desiredKind, el fallback de `selectSquashDrills` usa un pool filtrado por fatiga y ejecución, pero no fase. La vía con modalidad explícita sí conserva fase. Unificar el comportamiento y relajar solo preferencias como recencia.

**S7. Políticas semanales en varias capas.** `planSquashWeek`, selección local y `squashWeeklyExposurePolicy` tienen reglas diferentes. La rotación semanal ocurre después de los ajustes por fatiga y puede reintroducir technical donde se había cambiado por shadows. Esto no demuestra por sí solo intensidad indebida: los drills finales también se filtran. Sí justifica validar nuevamente las restricciones al terminar y compartir una decisión semanal explícita.

### Ampliación propuesta para squash

Son propuestas de cobertura, no protocolos clínicos ni una afirmación de que nunca aparezcan en texto libre de la IA.

| Prioridad | Contenido | Alta o mejora | Medición propuesta |
|---|---|---|---|
| Alta | Salida de pelota pegada a pared lateral/de fondo | Alta explícita | Salidas profundas y errores por intento. |
| Alta | Lectura del rebote en pared de fondo | Alta explícita | Contactos controlados y calidad de salida. |
| Alta | Resto ante saque alto, al cuerpo y rápido | Variantes del resto existente | Restos profundos por lado y tipo de saque. |
| Alta | Defensa → neutralización → ataque | Variante de lobs/transiciones | Decisiones adecuadas según pelota recibida. |
| Alta | Ghosting reactivo con señal externa | Variante de split-step/ghosting | Reacción, equilibrio y vuelta a la T. |
| Alta | Frenado y salida de zancada por esquina | Alta con dosis propia | Ejecuciones estables por lado. |
| Media | Rallies que empiezan en 8–8 o con desventaja | Variante de juego condicionado | Plan táctico y errores en puntos de presión. |
| Media | Elegir volea o dejar pasar según altura/profundidad | Variante de voleas con decisión | Lecturas adecuadas, no solo golpes acertados. |
| Media | Consistencia del lado débil por zonas objetivo | Parametrizar paralelas existentes | Porcentaje de aciertos comparable entre sesiones. |
| Media | Preparación de golpe y punto de contacto para iniciación | Alta/regresión explícita | Criterios simples de ejecución antes de aumentar complejidad. |

Conservar las secuencias de 100 golpes como opciones, pero convertir dosis y dificultad en parámetros. No hace falta una entrada nueva por cada número de repeticiones o por cada lado. Cada drill debería declarar material, número/rol de participantes, dificultad, errores habituales, criterio de éxito, regresión y progresión.

Los recursos de [Squash Canada para entrenadores](https://squash.ca/coaches-2/) cubren fundamentos, drives, voleas, saque/resto y juego. Su [marco de desarrollo](https://squash.ca/long-term-development/) diferencia etapas de aprendizaje y necesidades de entrenamiento. Se usan como contraste de cobertura; la tabla anterior es una propuesta de diseño para la app.

## 2. Cobertura de running

| Familia | Cantidad |
|---|---:|
| Aeróbico fácil | 4 |
| Fondo | 3 |
| Tempo/umbral | 4 |
| Intervalos VO2 | 4 |
| Velocidad/economía | 3 |
| Cuestas | 2 |
| Específico de carrera | 4 |
| Recuperación/retorno | 3 |

Intensidad: 10 low, 4 moderate, 7 moderate-high y 6 high. Hay rodajes, strides, series de 400/800/1000 m, fartlek, cuestas, media maratón/maratón, activación y run-walk. La brecha principal no es falta de variedad de carreras.

### Problemas confirmados y mejoras

**R1. Parámetros declarados pero no usados.** sessionDurationMin, experienceLevel, weeklyRunCount y runningWeeklyLoad no participan en la selección efectiva. En contexto sport_support, build, fatiga 4 y objetivo «base aeróbica para squash», pedir 15 o 60 minutos devuelve `easy_longer`: 55–70 minutos. Cambiar beginner por advanced tampoco cambia la salida. Hacer estos datos condiciones reales y ajustar la estructura a la disponibilidad.

**R2. sport_support no equivale a una política específica de squash.** primarySport está en el contexto pero no se usa en las decisiones del selector. No conoce partidos duros vecinos, ghosting/RSA, carga de piernas ni una necesidad explícita de descanso. Añadir un presupuesto semanal compartido y la proximidad de sesiones clave, no solo la fase y competitionSoon.

**R3. Intensidad incompleta en filtros.** Varias reglas excluyen solo high, dejando moderate-high. El filtro sport_support admite tempo_continuo, cruise_intervals y threshold_blocks; también admite short_hill_sprints por pertenecer a speed_economy. No significa que siempre se seleccionen. Definir techos ordenados de intensidad y carga por propósito; separar fatiga metabólica de exigencia neuromuscular/impacto.

**R4. La progresión se expresa en notas, no en dosis.** El resultado entrega typicalStructure sin cambios aunque la recomendación sea progress/deload. La rotación después de dos exposiciones de una familia puede desalentar rodajes fáciles repetidos. Repetir base aeróbica puede ser una intención del plan; variar solo cuando corresponde.

**R5. Se pierde la identidad de la plantilla.** RunningSelectionResult devuelve nombre y familia, pero no ID. El historial reconstruye familia con runningType y palabras del título/objetivo. Por ejemplo, un sprint en cuesta puede caer en hill aunque la biblioteca lo defina como speed_economy; una sesión específica de 10K con intervals puede caer en intervals_vo2. Persistir templateId, versión y bloques realizados. La referencia compartida de biblioteca actualmente solo contempla fuerza y squash.

**R6. La reparación puede contradecir la plantilla.** En `repairWeek`, buildRunningIntervalStructure crea 4 o 5 repeticiones de 800 m para cualquier runningType=intervals y coloca la estructura seleccionada en notes. Una plantilla de 400 m o de cuestas no se convierte realmente en esos bloques. Tempo también se convierte en un bloque continuo aunque la plantilla diga intervalos de umbral. Materializar desde una estructura tipada única.

**R7. Ritmos de calentamiento y trabajo se igualan.** `formatPaceTarget` devuelve `{main, z2: main}`. Por esa ruta, el calentamiento/enfriamiento de tempo o intervalos usa el objetivo del bloque exigente. Además, sin perfil se fijan ritmos como 5:30–6:00/km para Z2 y frecuencias absolutas. Separar objetivos por bloque y no inventar personalización cuando faltan datos; ofrecer esfuerzo conversacional/RPE claramente etiquetado. [England Athletics](https://www.englandathletics.org/news/simplifying-the-running-jargon-training-pace-2/) distingue ritmos/esfuerzos según el propósito de la sesión.

**R8. Coherencia de duración también falla en la reparación.** Un tempo de 20 minutos produce calentamiento 5 + principal mínimo 15 + cierre 5 = 25. Las recuperaciones de intervalos no son bloques explícitos. Validar el total después de materializar trabajo y descansos.

**R9. No hay restricciones de lesión en RunningContext.** No hay parámetro equivalente a una restricción de impacto. No concluir que la app entera carezca de controles: el hallazgo se refiere al selector local. Conectar la autoridad de restricciones a todos sus productores. Revisar copy absoluto como «Z2 puede ir cualquier día», «sin fatiga» y «low impact return»; describir el estímulo sin garantizar tolerancia por el nombre.

**R10. La biblioteca de running no está en el catálogo manual compartido.** `getCatalogForSport` devuelve entradas para squash/fuerza, no running. Agregar un selector de plantillas de sesión, con duración y esfuerzo editables, en vez de forzarlas al modelo de ejercicio de pesas.

### Running que incorporaría o adaptaría para apoyar squash

| Prioridad | Plantilla/variante | Propósito y condición |
|---|---|---|
| Alta | Rodaje fácil corto ajustable | Adaptar easy_z2_base al tiempo real; no generar automáticamente 55–70 min. |
| Alta | Run-walk por nivel | Convertir run_walk_return en etapas y criterios de avance; no tratarlo como rehabilitación automática. |
| Alta | Aeróbico fácil fraccionado | Opción de bloques suaves para quien aún no sostiene continuo; dosis según historial. |
| Alta | Técnica de carrera dosificada | Desglosar speed_support: drills explícitos, dosis, ejecución y requisitos. |
| Media | Rodaje con aceleraciones controladas | Parametrizar strides existentes, con esfuerzo y recuperación diferenciados. |
| Media | Fartlek breve por tiempo | Alternativa sin depender de un ritmo de 5K conocido; habilitar solo si la carga de squash lo permite. |
| Media | Intervalos aeróbicos controlados de apoyo | Plantilla propia por objetivo, sin importar una sesión de corredor de 10K por defecto. |
| Media | Activación breve antes de squash | Propósito distinto a race_activation de una carrera; alternativa opcional, no obligación adicional. |

No priorizar más variantes de maratón para este producto. Mantenerlas disponibles cuando exista un objetivo de running explícito. Una decisión válida también puede ser no agregar running si desplaza recuperación o sesiones principales de squash.

## 3. Cómo deberían escogerse los contenidos

1. **Resolver intención:** deporte principal, objetivo de la sesión, modalidad y cantidad solicitadas.
2. **Aplicar restricciones reales:** tiempo, compañero, cancha/material, nivel, restricciones registradas y proximidad de competición. Si no hay opción válida, explicar; no relajar silenciosamente.
3. **Asignar el propósito semanal:** sesión clave de squash, aprendizaje técnico, práctica de partido, base aeróbica de apoyo o descarga. Usar las decisiones de carga ya existentes como autoridad compartida, sin crear otro motor competidor.
4. **Elegir contenido por problema:** en squash fundamento → variación → aplicación; en running plantilla que corresponda al propósito y experiencia.
5. **Dosificar:** bloques de trabajo/pausa tipados, total de minutos comprobable y esfuerzos diferenciados.
6. **Progresar con ejecución real:** aciertos, completitud y esfuerzo; conservar continuidad cuando el estímulo sigue siendo útil.
7. **Explicar la elección:** una frase visible, por ejemplo «Trabajo de resto de revés porque fue tu foco pendiente; hoy sin velocidad extra por el partido de mañana».
8. **Guardar identidad y resultados:** IDs/versiones de plantilla y drill, dosis propuesta/realizada y motivos de selección o descarte.

No se propone eliminar la IA: usarla para interpretar el pedido y explicar, mientras el catálogo y los validadores controlan identidad, ejecutabilidad, dosis y restricciones.

## 4. Orden recomendado

| Prioridad | Entrega | Criterio verificable |
|---|---|---|
| P0 | Duraciones reales en squash/running y objetivos por bloque | Pedidos de 20/30/45/60 min producen totales coherentes; el calentamiento no hereda ritmo de intervalos. |
| P0 | Historial ejecutado y restricciones que no se relajan | planned/skipped no producen progresión; fase, compañía y restricciones sobreviven a fallbacks. |
| P1 | Running de apoyo conectado a semana de squash | Cambiar partido vecino, experiencia o tiempo cambia elegibilidad/dosis cuando corresponde. |
| P1 | Familias e identidad estables | Renombrar/traducir un título no cambia familia ni historial; plantilla y bloques coinciden. |
| P1 | Progresión útil de squash | Repetir una familia no obliga a abandonarla; se usa resultado medible. |
| P2 | Ampliaciones de contenido propuestas | Altas con dosis, variantes, requisitos, regresión/progresión y búsqueda. |
| P2 | Explicación y catálogo manual de running | El usuario entiende la elección y puede elegir una alternativa equivalente. |

## Evidencia y límites

Se cargaron directamente las bibliotecas y funciones con `createServer({server:{middlewareMode:true},appType:'custom'})` y `ssrLoadModule` de Vite. Se contaron todas las entradas y se ejecutaron matrices de duración, nivel, fatiga, perfil e historial. Ver el archivo de evidencia adyacente para inventario y casos reproducidos. No se ejecutó una generación completa de IA ni se consultó telemetría personal; las observaciones sobre frecuencia de elección son hipótesis de producto salvo los casos concretos descritos.

Archivos revisados: drillLibrary.ts, drillSelector.ts, squashSessionHydrator.ts, squashWeekPlanner.ts, runningSessionLibrary.ts, runningSelector.ts, coachExerciseCatalog.ts, squashPrompt.ts, runningPrompt.ts, actionPostProcessor.ts, repairWeek.ts, squashWeeklyExposurePolicy.ts y exerciseLibraryRef.ts.

## Seguimiento del 2026-09-08

La implementación de E1–E3 y el backlog autorizado, su verificación y sus límites están en el [informe de cierre](2026-09-08-squash-running-implementation.md). Este documento conserva el diagnóstico y los resultados históricos de su fecha.

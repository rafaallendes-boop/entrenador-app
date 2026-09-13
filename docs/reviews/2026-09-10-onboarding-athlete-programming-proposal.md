**Propuesta de selección inteligente para distintos atletas, con onboarding breve y contexto progresivo**

Fecha: 10 de septiembre de 2026. Estado: análisis y propuesta, sin implementación de aplicación en esta revisión.

Actualización de alcance: 12 de septiembre de 2026. El usuario confirma que los PDF son únicamente una referencia de estructura. La propuesta prioriza una entrada rápida, el aprovechamiento de la biblioteca amplia de fuerza y la selección según el equipamiento de cada persona. La captura detallada se ofrece después y sólo cuando mejora una decisión. Los hallazgos y sondas del 10 de septiembre son evidencia histórica de esa revisión y deben contrastarse con el código vigente antes de implementar.

La mejora prioritaria es conectar un perfil deportivo suficiente con decisiones consistentes de dosis, continuidad y distribución semanal. El onboarding es una parte de ese trabajo. Sus respuestas deben producir cambios verificables en el entrenamiento generado por chat, Week Creator y Plan Builder.

El producto debe servir a atletas distintos. Rafael aporta un caso de squash profesional, sesiones variables con partner, juegos condicionados y partidos, running habitualmente 2-3 veces por semana y posibilidad de dobles jornadas. Estos datos son una referencia de uso; no se convierten en valores predeterminados para otros atletas ni en una nueva semana prescrita.

**Evidencia y alcance**

Se extrajo el texto de los siete PDF y se renderizaron sus 42 páginas mediante PDFKit de macOS, contrastando tablas, columnas y notas visualmente. Los archivos contienen 26 entradas fechadas de entrenamiento, contando una vez cada día dentro de cada documento. No constituyen 26 ejecuciones verificadas. Los PDF originales permanecen intactos y no se importaron a la aplicación.

La revisión técnica comprende onboarding, edición de perfil, wizard de competición, contexto de selectores, estructura de fuerza, superseries, política de running, resumen semanal de squash y registros de ejecución. Se ejecutaron sondas locales con perfiles ficticios, sin proveedor de IA ni datos de producción. Los resultados describen las funciones comprobadas; no miden la frecuencia de problemas en planes reales. El árbol compartido contiene cambios de otros trabajos y las referencias describen los fuentes leídos durante esta revisión.

| Documento | Fechas internas de las sesiones | Páginas / días | Observación relevante |
|---|---|---|---|
| [Semana3.pdf](</Users/rafaallendes/Downloads/entrenamientos/Semana3.pdf>) | 21-25 julio 2025 | 8 / 4 | Fuerza y potencia agrupadas por letras; jueves con ocho series por ejercicio en el grupo B; viernes con técnica y 3 × 1000 m, descanso 240 s entre series. |
| [Semana 2 agosto.pdf](</Users/rafaallendes/Downloads/entrenamientos/Semana 2 agosto.pdf>) | 11-15 agosto 2025 | 8 / 4 | Clean, split jerk, pogo, depth jump con mini vallas, saltos laterales y jump squat. Incluye estructura de ocho series el jueves y 3 × 1000 m el viernes. |
| [Semana 4 Agosto.pdf](</Users/rafaallendes/Downloads/entrenamientos/Semana 4 Agosto.pdf>) | 18-22 agosto 2025 | 6 / 4 | Tres días de preparación con pesas y complementos; airbike 3 × 4 min de 30/30; viernes 4 × 1000 m con 240 s entre series. El nombre del archivo no basta para fechar la semana. |
| [Semana 1 Septiembre.pdf](</Users/rafaallendes/Downloads/entrenamientos/Semana 1 Septiembre.pdf>) | 1-5 septiembre 2025 | 5 / 4 | Conserva gran parte de la estructura anterior. Trap bar: cuatro series de seis con cargas consignadas de 85, 90, 95 y 100; airbike 3 × 4 min de 30/30. |
| [Semana 3 Septiembre.pdf](</Users/rafaallendes/Downloads/entrenamientos/Semana 3 Septiembre.pdf>) | 22-26 septiembre 2025 | 6 / 4 | Repite principales, agrupaciones y numerosas dosis de septiembre. Continuidad visible, sin evidencia suficiente para atribuir una mejora de rendimiento. |
| [Semana 2 Octubre.pdf](</Users/rafaallendes/Downloads/entrenamientos/Semana 2 Octubre.pdf>) | 6-10 octubre 2025 | 6 / 4 | Conserva la estructura de clean, trap bar, sentadilla, unilateral, escalera, airbike y carrera. Las semanas no son una colección de ejercicios completamente nuevos. |
| [Semana 1 acumulación.pdf](</Users/rafaallendes/Downloads/entrenamientos/Semana 1 acumulación.pdf>) | 2 y 4 febrero 2026 | 3 / 2 | Dos días incluidos, front squat, high pull, trap bar, recepciones estabilizadas, isometrías y unilateral/lateral. No permite concluir que sólo se entrenó dos veces esa semana. |

Las instrucciones de ejecución dentro de los documentos se analizaron como contenido del coach. No son instrucciones para modificar código, actualizar marcas ni aplicar sesiones actuales.

**Qué enseñan las semanas**

1. **Hay una estructura que permanece.** Los bloques por letras combinan fuerza, tirones, control del tronco, saltos y coordinación. Se distinguen aproximaciones de series de trabajo. Las letras indican agrupación; los PDF no explicitan todas las pausas o transiciones, por lo que no demuestran por sí solos un protocolo de contraste o potenciación.
2. **La dosis pertenece a la serie y al bloque.** Un único campo de carga no representa cuatro cargas distintas del mismo ejercicio. Tampoco una etiqueta de finisher representa por sí sola cuántos bloques contiene.
3. **Se diferencia el trabajo lateral, unilateral, reactivo y de recepción.** Un salto horizontal con recepción estable, un rebote sobre valla y un salto cargado tienen requisitos y objetivos diferentes. Clasificarlos simplemente como potencia pierde información útil.
4. **La sesión incluye preparación y seguimiento.** Aparecen movilidad, aproximaciones, preguntas de sueño, fatiga, molestias musculares y estrés, además del esfuerzo al finalizar. Los campos de wellness son preguntas, no respuestas registradas visibles.
5. **La intensidad requiere contexto.** Los 1000 m incluyen distancia y recuperación, pero no un ritmo o resultado cumplimentado que permita clasificarlos con certeza como umbral, VO2máx o rodaje. La dosis de carrera debe resolver ese objetivo explícitamente.

La airbike muestra una diferencia especialmente útil para el diseño: **3 bloques × 4 ciclos × (30 s fuertes + 30 s suaves) = 720 s**, es decir, 12 minutos de intervalos, con 6 minutos fuertes y 6 suaves. El PDF no indica una pausa adicional entre bloques. El catálogo actual prescribe un bloque de 4 minutos para `assault_bike_30_30`; ambas son dosis distintas de la misma modalidad. El nuevo 4 × 30/30 de cinta también dura cuatro minutos y no sustituye automáticamente la receta de doce.

Hay ambigüedades que deben conservarse como tales. Por ejemplo, el reverse Nordic de acumulación muestra cargas en las columnas y una nota que pide realizarlo sin peso. «Dorsal Ruso» y «SPEED exercise» no contienen una descripción suficiente para crear equivalencias técnicas seguras sólo por su nombre. La columna Max/PR tampoco acredita una marca actual. La propuesta no calcula tonelaje semanal, contactos totales de todas las tareas ni duración completa cuando faltan esas definiciones.

Desde la preparación física, conservaría la continuidad de estímulos, la variedad de direcciones y el seguimiento. Revisaría el volumen total y la ubicación de potencia y acondicionamiento junto con la cancha. El listado aislado no permite juzgar la tolerancia, recuperación o eficacia del plan original.

El squash combina esfuerzos intermitentes y desplazamientos cortos con cambios de dirección; la literatura específica también tiene limitaciones importantes de calidad y actualidad. Eso apoya individualizar y medir, sin atribuir validación científica a una plantilla concreta. [Revisión de squash de élite](https://link.springer.com/article/10.1007/s42978-024-00313-9).

**Qué ya existe en la aplicación**

| Área | Capacidad existente | Mejora que corresponde |
|---|---|---|
| Onboarding | Cinco pasos: deportes, principal, prioridad, días/dobles y contexto adicional; evento, restricciones y cuatro 1RM opcionales. | Mantener una entrada breve, reutilizar lo capturado y trasladar el detalle al perfil progresivo. |
| Perfil y wizard | Edad/peso, referencias de running, experiencia de running, equipamiento, nivel competitivo del evento, duración global, frecuencia global, estado físico/fatiga, partner y objetivo de partidos duros. | Separar datos estables del atleta de decisiones de un ciclo y disponibilidad de una semana. Evitar respuestas duplicadas. |
| Squash | Modalidad, foco, disponibilidad por sesión, intención técnica y resultados; catálogo y validación de dosis. | Relacionar esos campos con la agenda recurrente y con el objetivo y la intensidad real de cada sesión. |
| Running | Recetas estructuradas, identidad/versionado, recuperación, presupuesto de tiempo e historial ejecutado. | Personalizar su función y frecuencia como complemento, revisando límites uniformes de producto. |
| Fuerza | Referencias de biblioteca, aproximaciones, %1RM/RPE, superseries, triseries y circuitos mediante `supersetGroup`. | Extender dosis y resultados por serie y descansos de bloque. No reconstruir superseries desde cero. |
| Seguimiento | Check-in diario, sueño/energía/dolor, `actualRpe`, `actualDurationMin`, feedback y carga por duración × RPE. | Añadir lo que falta y asegurar que llega al selector; no crear otro seguimiento paralelo. |

Fuentes: [onboarding](../../src/hooks/useOnboardingForm.ts), [guardado del onboarding](../../src/utils/onboardingProfilePatch.ts), [tipos de perfil y sesión](../../src/types/index.ts), [wizard](../../src/pages/CompetitionPlanPage.tsx), [editor de perfil](../../src/components/settings/AthleteProfileEditor.tsx), [superseries](../../src/services/training/supersetGroups.ts), [carga](../../src/services/loadAnalytics.ts).

**Hallazgos técnicos que condicionan la propuesta**

| Prioridad | Hallazgo confirmado | Consecuencia y propuesta |
|---|---|---|
| P1 | [El contexto de fuerza de una ruta del chat](../../src/services/ai/actionPostProcessor.ts) fija fatiga 5, nivel intermedio e historial reciente vacío. | Un formulario más completo no basta si sus datos se pierden después. Unificar la resolución del contexto antes de ampliar preguntas. |
| P1 | [strengthContext](../../src/services/training/strengthContext.ts) deduce experiencia contando 1RM. [repairWeek](../../src/services/planBuilder/repairWeek.ts) usa nivel competitivo/estado físico y trata elite o masters como avanzado, salvo returning/low. | Experiencia en fuerza, categoría competitiva, edad y disponibilidad de marcas deben ser variables distintas. Ser profesional de squash no acredita técnica de clean o saltos cargados. |
| P1 | [profileAdapter](../../src/services/planBuilder/profileAdapter.ts) activa `requireExtraRecovery` a partir de 35 años; [athleticTraining](../../src/services/training/athleticTraining.ts) usa esa señal como exclusión. | Una regla demográfica termina excluyendo trabajo atlético independientemente de la experiencia o respuesta actual. Separar necesidad aguda de recuperar de factores de contexto como edad. |
| P1 | [Exercise](../../src/types/index.ts) tiene un número de series y una carga, sin colección de series efectivas y sus resultados. El finisher lleva parte de su receta en texto. | La representación debe distinguir series, repeticiones, unidades, cargas, rondas y descansos, preservando separado lo planificado y ejecutado. |
| P1 | [strengthSelector](../../src/services/training/strengthSelector.ts) conserva rutas de selección diferentes y usa cantidad de ejercicios como aproximación de duración. | Resolver composición por propósito y presupuesto real de tiempo. La continuidad del bloque debe prevalecer sobre sustituciones motivadas sólo por variedad. |
| P2 | [RunningSupportPolicy](../../src/services/training/runningPolicy.ts) fija 120 min semanales de apoyo, 75 en taper, e intensidad baja en build/peak/taper aunque el atleta esté fresco y sin sesión dura vecina. | Son límites de producto, no necesidades individuales universales. Introducir propósito y presupuesto individual, conservando controles de carga y calendario. No habilitar calidad automáticamente por marcar «elite». |
| P2 | [ScheduleProfile](../../src/types/index.ts) tiene días/dobles/frecuencia total y texto; [scheduleConstraints](../../src/services/weekCreator/scheduleConstraints.ts) interpreta expresiones acotadas como sólo AM/PM o no disponible. | Capturar minutos y recursos por franja y restricciones recurrentes como datos. «Martes 45 minutos con partner» no debe depender sólo de interpretar una nota. |
| P2 | [WeekCreatorConfig](../../src/services/weekCreator/WeekCreatorConfig.ts) puede incrementar la frecuencia inferida al declarar dobles. | Separar capacidad máxima, frecuencia deseada y carga habitual. Poder hacer dobles no significa querer llenar esas franjas. |
| P2 | [planSquashWeek](../../src/services/training/squashWeekPlanner.ts) limita su patrón a cuatro slots. Se consume en [el resumen del prompt](../../src/services/ai/promptModules/squashPrompt.ts). | Extender el patrón de apoyo para frecuencias mayores si el perfil las justifica. Esto no demuestra un límite de cuatro sesiones en toda la aplicación. |
| P2 | La estructura de fuerza ordena por grupo muscular y el selector limita el número de ejercicios de potencia; no equivale a controlar contactos o dosis de potencia. | Conservar filtros actuales hasta reemplazarlos por presupuestos de exposición y orden por objetivo, probados con sesiones completas. |

Sondas locales reproducidas con perfiles ficticios:

| Caso | Resultado observado |
|---|---|
| Mismo perfil, cero referencias 1RM frente a cuatro | `deriveStrengthExperienceLevel`: beginner frente a advanced. No se modificó ningún dato de experiencia. |
| Mismo contexto build, fatiga 2, avanzado, 60 min; edad 34 frente a 35 | El adaptador pasa de extraRecovery=false a true; broad jump, drop jump y finisher de airbike pasan de permitidos a excluidos por el predicado atlético. Es composición de funciones, no un plan generado de principio a fin. |
| Running de apoyo, build, fatiga 2, sin vecino duro | lowOnly=true, máximo 40 min por sesión, presupuesto semanal 120 min. |
| Seis slots pedidos directamente al helper de squash | Devuelve cuatro. Se verificó su consumidor en el resumen del prompt. |

No se vuelve a publicar como vigente la tasa de observaciones del audit de fuerza anterior: se ejecutó sobre otro estado del catálogo y no se repitió aquí.

**Propuesta de onboarding y perfil**

El onboarding debe permitir llegar pronto a una primera propuesta útil. Como objetivo de diseño, buscar 1-2 minutos y medirlo con usuarios; no es un tiempo demostrado. Reutilizar y compactar los pasos actuales. El contexto avanzado se ofrece después, sin convertirlo en una segunda barrera obligatoria antes de entrenar.

La entrada inicial recoge deporte(s)/principal, objetivo, experiencia general autodeclarada, disponibilidad aproximada y una comprobación breve de limitaciones actuales. Equipamiento puede resolverse con una selección rápida en ese flujo o justo antes de la primera sesión de fuerza. Si ya está declarado, se reutiliza. Las dobles jornadas quedan como opción de disponibilidad, nunca como obligación de añadir sesiones.

La opción «no lo sé» conserva desconocimiento; no equivale a cero capacidad ni a experiencia acreditada. Los 1RM, las marcas de carrera, los tests físicos, el historial detallado y el dominio de ejercicios avanzados quedan fuera del recorrido obligatorio. Tampoco hay que configurar un torneo para recibir una sesión útil.

| Momento | Datos | Decisiones que deben cambiar |
|---|---|---|
| Onboarding breve | Deportes/principal, objetivo y experiencia general declarada. | Elegir un punto de partida y la prioridad entre deportes. |
| Onboarding breve | Días y tiempo aproximado, limitaciones actuales; reutilizar los campos existentes. | Proponer algo realizable y compatible con las restricciones conocidas. |
| Onboarding o primera sesión de fuerza | Selección rápida de equipamiento, con posibilidad de editar. | Formar el conjunto de ejercicios realizables antes de seleccionar. |
| Perfil opcional | Experiencia por deporte y familiaridad con pesas, levantamientos olímpicos y pliometría; referencias de carga y ritmo. | Afinar elegibilidad y dosis. Preguntar un requisito técnico específico sólo si se contempla una tarea que lo necesita. |
| Perfil opcional o preparación de una semana exigente | Volumen habitual por deporte e interrupciones recientes; dar prioridad al historial registrado cuando exista. | Evitar confundir disponibilidad con carga tolerada, sin exigir reconstruir todo el historial. |
| Cuando se programa una semana | Frecuencia deseada como rango y compromisos fijos. Detallar horarios, partner o lugar sólo si condicionan esa semana. | Distribuir las sesiones sin ocupar automáticamente toda la disponibilidad. |
| Cuando se crea un ciclo competitivo | Competencias y ventanas de torneo ya soportadas; confirmar cambios relevantes. | Ajustar preparación y calendario competitivo. |
| Cuando hay cambios | Excepciones de partner, match, viaje, gimnasio o tiempo. | Modificar lo afectado sin repetir el onboarding. |
| Al entrenar | Check-in y resultados breves reutilizando lo existente; ampliar sólo si aporta decisiones. | Aprender de ejecución y respuesta, con datos fechados. |

El perfil puede completarse desde ajustes o mediante preguntas puntuales del coach, con una opción clara de posponer. El sistema registra las respuestas confirmadas y reutiliza resultados de entrenamiento; no convierte preferencias inferidas en restricciones permanentes. Cada nueva pregunta debe tener un consumidor concreto: explicar qué decisión cambia gracias a esa respuesta.

Para squash, conservar e integrar los ejes existentes: **con quién** se entrena, **formato** (drills, juegos condicionados, partido), **objetivo técnico/táctico/físico** e **intensidad/dosis**. Partner no significa partido duro; un juego condicionado puede ser físicamente exigente; una sesión solo no implica recuperación. `either` expresa flexibilidad y no confirma un compañero para un día concreto.

Las referencias opcionales incluirían fecha, variante, equipo y procedencia: marcas de carrera o ritmos, series recientes de fuerza, pruebas de salto/cambio de dirección y objetivos técnicos. No heredar cargas automáticamente entre máquinas diferentes ni tratar asistencia como resistencia externa. Reutilizar `performanceLimiter` para limitantes declaradas, sin enviarlas al filtro de lesiones.

**Equipamiento y aprovechamiento de la biblioteca de fuerza**

La amplitud de la biblioteca permite resolver un mismo objetivo para personas con recursos, experiencia y preferencias distintos. El generador debe escoger por la función del ejercicio dentro de la sesión y del bloque. La cantidad de ejercicios del catálogo no obliga a rotarlos todos ni a añadir más tareas a una sesión.

Ya existen presets e inventario normalizado en [equipmentPresets](../../src/services/training/equipmentPresets.ts) y [equipmentVocabulary](../../src/services/training/equipmentVocabulary.ts). Reutilizarlos como base de una selección rápida: peso corporal, casa, pesos libres, gimnasio o personalizado. Los presets deben mostrar qué incluyen y permitir quitar material. «Gimnasio» no confirma por sí mismo escalera, mini vallas, airbike o cada máquina de fuerza. El modelo actual agrupa máquinas por familia; la identificación de máquinas concretas es una ampliación propuesta, no una capacidad que se dé por implementada.

Permitir guardar un inventario habitual y cambiarlo para una sesión, por ejemplo al entrenar de viaje. Los perfiles por lugar son una comodidad posterior, no un requisito para empezar. Distinguir equipamiento desconocido de material confirmado y de material no disponible. Si no se conoce, limitar la propuesta a lo confirmado o pedir la aclaración mínima que la sesión necesita, sin asumir un gimnasio completo.

El selector y la opción «reemplazar ejercicio» deben compartir este recorrido:

1. Filtrar por equipamiento imprescindible, alternativas reales, restricciones y experiencia conocida.
2. Identificar la función que falta en la sesión: principal, accesorio, potencia, coordinación o acondicionamiento, según su objetivo.
3. Ordenar los candidatos por adecuación al deporte/objetivo, continuidad del bloque, respuesta registrada y preferencias.
4. Ajustar dosis, descansos y combinación al tiempo y al resto de la semana; volver a validar la sesión resultante.
5. Mostrar un motivo breve y ofrecer sustitutos que conserven la función. Cambiar de ejercicio o máquina requiere recalibrar carga, sin heredar kilos automáticamente.

Por ejemplo, un bloque de tirón horizontal puede disponer de opciones con polea, mancuerna o banda. El motor elige una alternativa compatible y adapta su dosis; no las trata como cargas numéricamente intercambiables. Si no hay alternativa válida, explica qué falta y propone ajustar la composición.

Como criterio de aceptación, comparar el mismo objetivo con peso corporal, mancuernas/bandas y un inventario de gimnasio confirmado. Cada resultado debe ser realizable con ese material, mantener la intención cuando sea posible y explicitar las limitaciones. Un cambio de inventario por sesión no modifica el inventario habitual ni las sesiones históricas.

**Propuesta de motor y representación**

Un único constructor de contexto efectivo debe combinar perfil, objetivo del ciclo, restricciones, disponibilidad de la sesión, agenda, historial anterior a la fecha objetivo y estado reciente. Chat, Week Creator y Plan Builder deben consumir ese mismo resultado; el prompt usa una proyección legible y el validador conserva el contexto completo. Cada dato relevante necesita procedencia y fecha. Una excepción de agenda de la semana reemplaza esa disponibilidad puntual, sin anular restricciones vigentes.

Sobre los modelos existentes, incorporar bloques de sesión con finalidad y orden: preparación, potencia/coordinación, fuerza principal, complementos y acondicionamiento. Las agrupaciones A/B/C pueden conservar superseries o circuitos existentes, añadiendo recuperación entre ejercicios y rondas. Un bloque de activación del tronco no es equivalente a un bloque exigente de core. El orden depende del objetivo prioritario y permite agrupaciones intencionales; no impone que todo core esté al inicio ni que cualquier combinación fuerza-salto sea un protocolo de potenciación.

La dosis de fuerza necesita series de trabajo con objetivos propios y resultados separados; aproximaciones ya existen y se conservan. Los ejercicios temporales usan segundos, los unilaterales declaran por lado/total, la escalera especifica pasadas, los saltos explicitan intentos/contactos y los intervalos expresan bloques, rondas, trabajo y recuperación. El total de tiempo incluye entrada, ejecución, pausas y transiciones. Cuando una pausa no está definida, el sistema solicita o propone un valor visible antes de afirmar que la receta cabe.

Programar la semana primero por prioridades y sesiones comprometidas, luego por dosis y recuperación, y finalmente seleccionar ejercicios compatibles. El acondicionamiento dentro de fuerza participa de la carga semanal y no debe contabilizarse otra vez como una sesión adicional. La carga por duración × RPE se conserva como una señal; se complementa con exposiciones específicas como trabajo intenso de carrera, series de piernas y contactos de salto. No sumar esas unidades diferentes en un supuesto indicador validado de riesgo.

Running 2-3 veces por semana, en el caso aportado, sería una combinación de historial y preferencia a resolver dentro de la semana. El objetivo del bloque puede justificar rodajes, calidad específica o una dosis menor. Los finishers pueden aportar una dosis de acondicionamiento prevista o ser omitidos si esa necesidad ya está cubierta. La app debe explicar qué objetivo cumplen y qué carga añaden.

Las dobles jornadas deben considerar el contenido, la prioridad y el tiempo real entre sesiones. Un meta-análisis encontró posible atenuación de la mejora explosiva cuando fuerza y resistencia se realizan en la misma sesión; no implica incompatibilidad general de correr y hacer fuerza ni valida una separación horaria universal para squash. La propuesta es hacer esa combinación deliberada y evaluable. [Entrenamiento concurrente, Schumann et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC8891239/).

La progresión mantiene principales durante un bloque mientras el objetivo, la técnica y la respuesta lo justifiquen. Las sustituciones conservan función y requisitos. Los resultados pueden justificar aumentar carga, repetir dosis, reducir volumen o cambiar variante. El simple número de repeticiones de un ejercicio en semanas distintas no demuestra estancamiento. El seguimiento debe relacionar carga externa y respuesta individual, sin presentar un wearable o ACWR aislado como decisión suficiente. [Consenso de seguimiento de carga](https://pubmed.ncbi.nlm.nih.gov/28463642/).

**Entregas propuestas y criterios de aceptación**

| Orden | Entrega | Criterio verificable |
|---|---|---|
| E1 | Contexto compartido, onboarding breve, perfil progresivo e inventario reutilizado para selección y reemplazos. | Se obtiene una primera propuesta sin 1RM, tests o historial detallado. El equipo confirmado limita todas las rutas. Mismo atleta, fecha y objetivo producen contexto coherente. Registrar otro 1RM no cambia experiencia; la edad por sí sola no se interpreta como fatiga aguda. |
| E2 | Dosis y resultados por serie/bloque; extensión compatible de superseries, descansos y unidades. | Preservar 85/90/95/100 × 6 como cuatro series; aproximaciones separadas; 3 × 4 min de 30/30 suma 12 min y añade sólo las pausas explícitas. Guardar y reabrir conserva dosis y grupos. |
| E3 | Agenda y composición semanal por objetivos; continuidad y reemplazos del bloque. | Respetar partner por día, sesiones fijas, minutos y dobles opcionales; conservar principales; un finisher cuenta en la carga y el tiempo; una semana inviable explica qué objetivo se reduce. |
| E4 | Evaluación deportiva y de producto con semanas completas y perfiles distintos. | Probar principiante, profesional, masters con experiencia, pocos recursos y sin historial; semana normal, alta carga, torneo y cambio de disponibilidad. Comparar decisiones, viabilidad y respuesta registrada, además de tests técnicos. |

E1 debe mejorar la selección con pocos datos y permitir enriquecerlos después; no termina al añadir campos a los tipos ni necesita implementar todos los módulos opcionales del perfil. Medir tiempo de onboarding, abandono y llegada a una primera propuesta útil, además de coherencia de contexto y compatibilidad de equipo. E2 debe cubrir aceptación, edición, plantillas, exportación/importación y sincronización antes de considerarse cerrada. Los campos nuevos pueden ser opcionales, pero no se presupone que la persistencia los conservará: revisar serializadores y contratos. Las sesiones históricas conservan su contenido y no reciben resultados inventados.

Para evaluar la fidelidad de E2, usar ejemplos pequeños de estos PDF: rampa de trap bar, airbike multinivel, Copenhagen por segundos/lado y un circuito con ocho series. Eso prueba representación y cálculo; no autoriza asignar automáticamente ese circuito a otro atleta. Para E3/E4, usar escenarios anónimos derivados de los requisitos, incluyendo la cancelación de partner y la conversión de un juego condicionado a match exigente.

La primera implementación recomendada es E1, seguida de E2 y E3. El catálogo disponible permite avanzar. Las nuevas altas deberían responder a funciones realmente ausentes y contar con ejecución, dosis, material y equivalencias claros; no se propone clonar todas las variantes de los PDF ni convertir la semana de Rafael en plantilla universal.

**Límites de esta entrega**

Se completó lectura documental, inspección técnica y sondas de funciones con datos ficticios. Se creó únicamente este documento dentro del proyecto; no se modificó código de aplicación, no se importaron entrenamientos o marcas, no se ejecutó generación con un proveedor ni se publicó una versión. No se ejecutó una nueva suite completa porque esta entrega no implementa cambios. La programación original tampoco se declara validada o incorrecta: faltan cancha, esfuerzos reales, descansos no escritos, calendario competitivo y respuesta del atleta para evaluarla de forma completa.

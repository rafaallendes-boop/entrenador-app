# Revisión integral y propuesta de refactor del coaching y la planificación

**Fecha del documento:** 8 de septiembre de 2026.  
**Alcance:** chat general, acciones de chat, Weekly/Week Creator, Plan Builder, selección y edición de sesiones, aceptación y persistencia.  
**Referencia revisada:** árbol de trabajo sobre `b82a603905a690daf4fab82c3de6c8a59c201637`, con cambios sin commit. Se fijó una copia el **7 de septiembre de 2026, 22:15:49 −03**.  
**Entrega:** diagnóstico y diseño de refactor; no se implementaron cambios en la aplicación.

## 1. Decisión recomendada

El refactor debe establecer **un contexto de atleta y unas reglas de planificación compartidos por todas las rutas**, con adaptadores especializados por deporte. El producto ya tiene catálogos, selectores, composición local, restricciones, propuestas, generación en segundo plano y telemetría. La principal debilidad aparece al conectar esas piezas: distintas rutas suministran información diferente, algunas transformaciones pierden intención y ciertos controles se ejecutan después de haber construido contenido incompatible.

La prioridad es que una petición equivalente produzca decisiones compatibles en chat, creación semanal, Plan Builder y edición manual. Después se debe reducir trabajo repetido y llamadas de recuperación, midiendo el tiempo hasta una propuesta **válida y aplicable**. Elegir otro modelo queda como experimento posterior, con contexto y evaluación ya corregidos.

Resultados que debe producir el refactor:

| Objetivo | Comportamiento esperado |
|---|---|
| Velocidad | Respuesta útil temprana, un presupuesto total por solicitud, procesamiento local medido y ausencia de regeneraciones innecesarias. |
| Inteligencia | Entender consulta frente a acción, recuperar el entrenamiento al que se refiere el usuario, conservar restricciones y aplicar las mismas señales de ejecución al texto y al contenido. |
| Selección | Ejercicios y sesiones compatibles con objetivo, experiencia, equipamiento, disponibilidad, tiempo, fase y exposición de la semana. |
| Continuidad | Progresar o repetir con motivo; conservar identidad, dosis e historial al editar y al recalibrar. |
| Confianza | Una propuesta pertenece siempre al mismo atleta; el resumen coincide con los bloques; cualquier cambio de estímulo queda explicado. |

## 2. Método, evidencia y límites

La revisión combinó lectura de rutas completas, tres revisiones paralelas con razonamiento ultra, ejecución de la suite existente y probes locales sin proveedor de IA. Los hallazgos finales se contrastaron con la copia fijada. La evidencia y las huellas de los archivos están en [evidence.json](fixtures/coaching-refactor-2026-09-08/evidence.json); los casos reproducibles principales, en [probe.mjs](fixtures/coaching-refactor-2026-09-08/probe.mjs) y [probe-output.json](fixtures/coaching-refactor-2026-09-08/probe-output.json). Las sondas F02/F08 se ejecutaron antes de fijar la copia y se contrastaron después por inspección de los mismos fuentes; no forman parte del script adjunto.

Se distingue entre **demostrado por ejecución**, **confirmado por inspección** y **riesgo alcanzable**. Un fallo de un selector aislado no demuestra que una semana defectuosa se haya aplicado en producción. Tampoco una suite verde demuestra que las rutas tengan contextos equivalentes.

El árbol cambió mientras se revisaba. En particular, se corrigieron controles de running y expectativas de pruebas antes de fijar la copia. Por eso no se publican como pendientes los primeros casos de bypass de recetas ni el lote de cuatro sesiones de 60 minutos que ya quedó rechazado. Los informes anteriores de fuerza y squash/running son antecedentes, no una lista vigente de defectos.

**Actualización al cierre del 8 de septiembre:** una corrección posterior al corte resuelve el caso dirigido de **F04**: la conversión a Z2 devuelve objetivos `6:00–6:30`, coherentes con sus bloques. También se retiró el mock incompleto de `repairWeek.test.ts`; su suite volvió a ejecutarse en el árbol actualizado y pasó **18/18**. F04 queda como regresión a proteger, no como corrección pendiente. El resto de los casos del probe conservó su comportamiento. Los resultados posteriores están separados en [probe-current-output.json](fixtures/coaching-refactor-2026-09-08/probe-current-output.json) y en la evidencia; no sustituyen la suite completa de referencia.

No se consultaron métricas productivas actuales, configuración secreta de despliegue, proveedores externos ni datos reales de atletas. No se ejecutó un smoke autenticado, sincronización entre dispositivos ni pruebas de carga pagadas. Las referencias de línea corresponden a la copia fijada; pueden desplazarse si continúa el desarrollo.

## 3. Funcionamiento actual

| Superficie | Ruta principal | Decisión/composición | Persistencia |
|---|---|---|---|
| Chat general | `ChatCoach → useChatStore → CoachEngine.sendChat` | Prompt ligero, proveedor y normalización. | Mensajes locales y sincronización. |
| Acción de chat | `ChatCoach → useChatStore → CoachEngine.sendAction` | Recuperación, normalización, `postProcessCoachActions`, selectores y finalización. | Propuesta; aceptación por `useCoachActionsStore`. |
| Crear semana desde chat | `resolveChatRoute → WeekCreatorEngine` | Preflight de configuración/agenda, esqueleto o contrato detallado, hidratación, reparación y validación. | Propuesta `create_week → applyCreateWeek`. |
| Weekly | `WeeklyView → useWeeklySnapshot/useTrainingStore` | Alertas, carga, check-in, accesos al coach y nota semanal. Weekly y Week Creator son piezas diferentes. | Sesiones y resúmenes por semana. |
| Plan Builder remoto | `usePlanBuilderStore → enqueue → generate-plan-background → runAsyncPlanGeneration` | Semanas en paralelo, `generateWeekCore`, reparación, revisión de calidad y checkpoints. | Supabase, polling local y aceptación mediante `commitPlan`. |
| Plan Builder local | `generationJobRunner → generatePlanWeeks` | Generación por objetivos locales, con contratos parcialmente distintos del worker. | Dexie y checkpoints locales. |
| Alta/edición manual y plantillas | `SessionForm`, pickers y serializadores | Selección o receta elegida por el usuario; materialización y conversión de campos. | Sesión local, exportación y sincronización. |

Los archivos extensos concentran responsabilidades, pero su tamaño no prueba lentitud. La revisión se centra en los límites entre contexto, decisión, materialización, validación y escritura.

### Bases que se deben conservar

- Separación entre conversación y acciones, propuestas explícitas y aceptación del usuario.
- Restricciones de fuerza, equipamiento normalizado, `libraryRef`, resolución de ambigüedad, asignación por bloque y rechazo cuando no hay solución válida.
- Modalidad y disponibilidad de squash, hidratador común, historial ejecutado y dosis por tiempo.
- Recetas de running con ID/versión, bloques con duración, distancias y recuperaciones, ritmos de entrada/cierre y rechazo de composiciones inviables.
- Contrato semanal compacto, reparación dirigida, límites de intentos y tratamiento terminal de ciertos rechazos de calidad.
- Recalibración de semanas futuras, conservación del historial, versiones de calidad/taxonomía, cuotas, cancelación y guards ya existentes de cambio de atleta.
- Validación antes de aplicar, reversión de aplicación parcial y barrera de publicación del nuevo ciclo en [commitPlan.ts](../../src/services/planBuilder/commitPlan.ts#L225).
- Índices de fuerza ya incorporados. El [benchmark previo de fuerza](2026-09-07-strength-pending-completion.md) midió una mejora local al indexar nombres; no corresponde volver a proponer esa indexación como trabajo pendiente ni trasladar su porcentaje a toda la app.

## 4. Hallazgos priorizados

**P1:** resolver antes de extender el motor o ampliar su uso; puede alterar atleta, intención, contenido o consistencia de una operación. **P2:** siguiente etapa del refactor; afecta calidad, cobertura, continuidad, velocidad o capacidad de medir. La prioridad no equivale a un incidente productivo observado.

| ID | Prioridad | Hallazgo | Evidencia |
|---|---|---|---|
| F01 | P1 | El contexto y el destino pueden pertenecer a atletas diferentes tras un `await`. | Flujo de código y test existente de cambio de scope. |
| F02 | P1 | Week Creator usa señales reales en el prompt y las pierde al reparar. | Probe de adaptador y política. |
| F03 | P1 | Una sesión técnica/control de squash puede quedar sólo con sombras accesorias. | Probe reproducible. |
| F04 | P1 en el corte; caso corregido al cierre | Convertir tempo a Z2 conservaba ritmos del estímulo anterior. | Probes antes/después; conservar contrato de regresión. |
| F05 | P1 | Editar metadatos puede volver a dosificar una sesión de running. | Probe del materializador y lectura del submit. |
| F06 | P1 | El recorte del prompt también elimina datos necesarios para ejecutar acciones. | Probe de contexto y lectura de consumidores. |
| F07 | P1 | UI y motor enrutan la misma frase de manera diferente. | Probe reproducible. |
| F08 | P1 | El allocator recibe horizontes distintos en generación local y remota. | Probe de descriptores. |
| F09 | P1 | Reentregar un mismo job puede ejecutar y escribir sin un propietario exclusivo. | Riesgo alcanzable por inspección. |
| F10 | P2 | Chat general omite hechos de sesiones pasadas necesarios para responder. | Probe de prompt. |
| F11 | P2 | Los contextos de fuerza, experiencia e historial no tienen una autoridad común. | Inspección y probes temporales. |
| F12 | P2 | Cycling y movilidad no participan del contrato común de dosis. | API, consumidor y probe de cycling. |
| F13 | P2 | Parte de la continuidad depende del orden de resolución de las semanas. | Inspección del loop concurrente. |
| F14 | P2 | Week Creator ejecuta dos reparaciones deportivas completas. | Ruta alcanzable confirmada. |
| F15 | P2 | Recuperación y tiempos por etapa no describen fielmente el trabajo realizado. | Probe de retries e instrumentación inspeccionada. |

### F01. Identidad del atleta durante operaciones asíncronas

[ChatCoach.tsx:295](../../src/pages/ChatCoach.tsx#L295) captura contexto del render, espera lecturas y detecta si cambió el atleta, pero descarta solamente `whoopWorkoutBlock`. Perfil, memoria, sesiones y propuestas capturados pueden seguir siendo de A. [CoachEngine.ts:196](../../src/services/ai/CoachEngine.ts#L196) resuelve el destino desde el atleta global vigente, que podría ser B. El test de scope Whoop permite continuar el envío, pero usa perfil nulo y sesiones vacías y no acredita el aislamiento del resto del contexto.

Hay una segunda ruta: [useTrainingStore.ts:278](../../src/store/useTrainingStore.ts#L278) genera la nota semanal sin fijar/verificar el atleta alrededor de la respuesta; [queries.ts:322](../../src/db/queries.ts#L322) vuelve a capturar el scope al guardar. Un cambio A→B durante la IA permite escribir en B una nota elaborada para A. Son carreras alcanzables; no se observó una filtración productiva.

**Refactor y aceptación:** capturar `{athleteId, epoch, conversationId, requestId}` antes del primer `await`, pasarlo a lecturas, proveedor y escritura y comprobar propiedad al finalizar. Preservar el borrador de A si cambia el atleta. Tratar por separado la hidratación inicial `null→self`. Probar cambios de atleta en cada frontera asíncrona con perfiles y sesiones diferentes, verificando tanto el payload como Dexie y la UI.

### F02. Señales de ejecución perdidas en Week Creator

[WeekCreatorPromptBuilder.ts:577](../../src/services/weekCreator/WeekCreatorPromptBuilder.ts#L577) considera dolor, energía y RPE real. [WeekCreatorLocalHydrator.ts:518](../../src/services/weekCreator/WeekCreatorLocalHydrator.ts#L518) devuelve un `RepairContext` con historial, pero sin `executionSignals`. [repairWeek.ts:1691](../../src/services/planBuilder/repairWeek.ts#L1691) evalúa entonces `decideLoadDirective({})`.

En la sonda, dolor declarado 8/10 produce `no_signal` después del adaptador; al transportar esa señal produce `reduce`. En el caso dirigido de build, fatiga normal, partner y objetivo de tres partidos duros, esa diferencia mantiene o retira la meta dura de la política. El prompt y la composición local pueden contradecirse. Se demostró la pérdida y la decisión resultante, no una semana completa aplicada.

**Refactor y aceptación:** construir `ExecutionSignals` una vez, conservando fuente, fecha, muestra y exclusión de prefill Whoop. Prompt, selector y reparación deben consumir la misma decisión. Una señal de reducción debe sobrevivir a hidratación, fallback y aceptación. Los umbrales citados son comportamiento del código actual, no una nueva recomendación clínica.

### F03. El accesorio desplaza al objetivo principal de squash

[squashSessionDose.ts:25](../../src/services/training/squashSessionDose.ts#L25) corta la lista con `slice(0, count)`. Las sombras se ordenan primero y [squashSessionHydrator.ts:176](../../src/services/training/squashSessionHydrator.ts#L176) conserva la modalidad declarada tras dosificar.

Entrada: `kind:'technical'` o `'control'`, 15 minutos, fase base, fatiga 3, `withShadowsAccessory:true`. Resultado: modalidad técnica/control, bloques `['shadows']`, sin advertencias. El tiempo cuadra, pero desaparece el trabajo principal. Además, los intervalos de práctica usan la modalidad global aunque el bloque sobreviviente sea de otro tipo.

**Refactor y aceptación:** reservar primero una dosis viable del objetivo principal y después asignar accesorios. Si no cabe el accesorio, retirarlo con motivo. Validar presencia del estímulo principal después de dosificar y derivar trabajo/pausa por bloque. Probar todas las modalidades en sus duraciones límite.

### F04. Conversión a Z2 con objetivos contradictorios

**Estado al cierre:** el caso reproducible de este apartado está corregido en el árbol actualizado. Se conserva el diagnóstico de la referencia para justificar el contrato y evitar regresiones al extraer el finalizador.

La corrección reciente en [sessionDoseFinalizer.ts:48](../../src/services/training/sessionDoseFinalizer.ts#L48) convierte recetas conocidas de calidad a Z2 cuando la política lo exige. Sin embargo, el spread conserva `targetPaceMin/Max`, que luego tienen prioridad en la construcción de objetivos.

Con perfil Z2 `6:00–6:30`, tempo `4:50–5:00`, receta de 45 minutos y una sesión dura vecina, la copia fijada devuelve `runningType:'z2'`, objetivos generales `4:50–5:00` y bloques con `6:30 /km`. El árbol actualizado devuelve objetivos generales `6:00–6:30` para ese mismo caso.

**Refactor y aceptación:** invalidar valores derivados del estímulo anterior al cambiar familia/esfuerzo y generar tipo, título, objetivos y bloques desde una sola prescripción. Distinguir valores calculados de instrucciones explícitas del usuario; estas últimas requieren resolver su compatibilidad. La prueba debe comparar la tarjeta, los bloques, la propuesta y la sesión persistida.

### F05. Edición de texto que reescribe una receta

[SessionForm.tsx:439](../../src/components/session/SessionForm.tsx#L439) rematerializa cualquier receta de running con `templateRef` en cada submit. No exige cambio de duración o plantilla ni conserva el `intent` original. El serializador acepta la nueva estructura como parte de la edición.

La sonda sobre `repeats_400`, 60 minutos y `fiveKTime:'25:00'` produce 11 repeticiones con `intent:'progress'` y 9 con los argumentos por defecto usados al guardar. El formulario se utiliza también para sesiones existentes: una edición de título puede sustituir la dosis. El mecanismo se ejecutó en el materializador; falta automatizar el recorrido completo de UI con esa receta.

**Refactor y aceptación:** una edición de metadatos conserva estructura y referencia byte a byte. Rematerializar sólo ante cambios explícitos de prescripción, con diff visible. El historial conserva los valores con que se ejecutó la sesión, aunque cambien el perfil o el catálogo. Probar título, notas, ubicación y cambios de perfil frente a dosis progresada y sesión completada.

### F06. Contexto de ejecución limitado por el presupuesto del prompt

[useChatStore.ts:327](../../src/store/useChatStore.ts#L327) entrega el contexto optimizado al engine; [CoachEngine.ts:240](../../src/services/ai/CoachEngine.ts#L240) entrega ese mismo objeto al postprocesador. [contextOptimizer.ts:219](../../src/services/ai/contextOptimizer.ts#L219) limita `chat_action` a seis sesiones planificadas, ordenadas por fecha y sin fijar el objeto del mensaje.

Un fixture con 14 sesiones conserva sólo `session-0` a `session-5`; `session-12` desaparece. Una referencia posterior a los primeros 260 caracteres de un turno anterior también se pierde. La aceptación relee sesiones de persistencia en algunas rutas, pero eso no recupera una intención o propuesta mal construida antes.

**Refactor y aceptación:** mantener un `DomainContext` completo y generar aparte un `PromptContext` reducido. Resolver primero los IDs y fechas afectados; fijar en el prompt objetivo, vecinos y restricciones relevantes. Los límites de tokens nunca deben definir el universo de colisiones o de validación. Probar acciones sobre una sesión fuera de las primeras seis sin ampliar todo el historial enviado al modelo.

### F07. Dos routers y falsos positivos de acción

[ChatCoach.tsx:279](../../src/pages/ChatCoach.tsx#L279) usa `detectChatIntent` para el gate; [useChatStore.ts:279](../../src/store/useChatStore.ts#L279) usa `resolveChatRoute`. Las reglas no son equivalentes.

| Mensaje | Clase de UI | Ruta efectiva |
|---|---|---|
| ¿Cómo estuvo mi sesión del lunes? | `chat_general` | `chat_action` |
| Dame feedback de mi sesión del lunes | `chat_general` | `chat_action` |
| Créame una sesión de pesas | `chat_general` | `chat_action` |
| ¿Cómo me prepararías para tres semanas de vacaciones? | `chat_general` | `plan_builder_redirect` |
| Genera un plan completo hasta el torneo | `chat_action` | `plan_builder_redirect` |

Esto puede provocar ofertas de acceso equivocadas, redirecciones o recuperación por falta de acciones en una consulta legítima. No equivale a aplicación automática: las propuestas siguen requiriendo aceptación.

**Refactor y aceptación:** una resolución tipada consumida por UI, store y engine. Separar verbo de modificación, objeto y horizonte temporal. Las confirmaciones deben apuntar a una propuesta o intención pendiente concreta. Mantener reglas locales para casos claros y reservar clarificación o clasificación adicional para ambigüedad real.

### F08. Horizonte de bloque diferente en la ruta local

[generationJobRunner.ts:411](../../src/services/planBuilder/generationJobRunner.ts#L411) pasa `weeks:[generatingWeek]` a `generatePlanWeeks`. Este deriva los descriptores a partir de ese array. [repairWeek.ts:2341](../../src/services/planBuilder/repairWeek.ts#L2341) calcula con ellos el tamaño del bloque.

Para la primera semana de una fase de cuatro semanas, el contexto completo produce `blockWeekIndices:[0,1,2,3]`; la entrada local de una sola semana produce `[0]`. En el caso legacy sin fases, un singleton puede reiniciar también el ordinal. Se demostró la diferencia de dominio, no la tasa de planes con ejercicios diferentes.

**Refactor y aceptación:** separar `targetWeekIndexes` de los descriptores completos e inmutables del plan. Generación inicial, regeneración parcial, local, remota y fallback deben compartir horizonte e identidad. Comparar resultados con respuestas del proveedor fijas y regenerar sólo la semana 2 de un bloque de cuatro.

### F09. Falta de propiedad exclusiva del job remoto

[activeGeneration.ts:34](../../src/services/planBuilder/activeGeneration.ts#L34) permite continuar si el job activo tiene el mismo ID. Eso permite el primer arranque posterior al enqueue, pero también una reentrega. [generate-plan-background.ts:269](../../netlify/functions/generate-plan-background.ts#L269) no reclama atómicamente una ejecución exclusiva; [planGenerationShared.ts:159](../../netlify/functions/_shared/planGenerationShared.ts#L159) escribe checkpoints mediante upserts sin token de propietario.

Dos invocaciones del mismo job pueden continuar, duplicar llamadas y sobrescribir checkpoints. El enqueue además escribe padre e hijos por separado y marca `durableWrite` después de las semanas: una falla intermedia requiere recuperación explícita. Es un riesgo alcanzable por inspección; no se observó un job duplicado productivo.

**Refactor y aceptación:** claim atómico con estado, vencimiento y versión de ejecución; cada checkpoint debe acreditar propiedad. Un worker antiguo no puede escribir después de cancelación, recuperación o reemplazo. Probar entrega duplicada, caída tras escribir el padre, recuperación de lease y cancelación durante una llamada. Conservar idempotencia del enqueue y las barreras del commit del ciclo.

### F10. Historial omitido en conversación general y memoria limitada

[promptBuilder.ts:178](../../src/services/ai/promptBuilder.ts#L178) construye chat general con sesiones futuras, pero omite el render de feedback disponible en acciones y resumen semanal. Una sonda de «¿Cómo me fue ayer?» con título y feedback únicos de una sesión completada no incluyó ninguno en el prompt. Puede haber agregados de fatiga; faltan los hechos necesarios para responder esa pregunta.

Existe memoria persistida por atleta en [coachNotes.ts](../../src/services/athlete/coachNotes.ts). En el flujo revisado se edita desde Settings. El optimizador conserva sólo los primeros 500 caracteres y el historial conversacional cuatro turnos muy recortados. Una restricción al final de una nota larga puede desaparecer de esa representación, aunque otras restricciones estructuradas del perfil sigan disponibles.

**Refactor y aceptación:** recuperar historial por la fecha, sesión o patrón consultado; mantener hechos tipados con procedencia, vigencia y posibilidad de corrección. Conservar las notas libres existentes. Fijar las restricciones activas fuera del truncado de texto y mantener estado explícito de las referencias conversacionales. Evitar convertir texto inferido por IA en una restricción permanente sin validación.

### F11. Contextos, experiencia y progresión de fuerza

El contexto del prompt de fuerza usa fatiga, competencia, historial y ACWR; [actionPostProcessor.ts:1717](../../src/services/ai/actionPostProcessor.ts#L1717) usa fatiga 5, nivel intermedio y ejercicios recientes vacíos en su constructor; [repairWeek.ts:3637](../../src/services/planBuilder/repairWeek.ts#L3637) usa wizard/bloque pero no todas las mismas señales. Equipo y restricciones ya tienen controles compartidos; la personalización restante no es equivalente.

[strengthSelector.ts:1114](../../src/services/training/strengthSelector.ts#L1114), cycling y movilidad filtran estado sin un corte temporal propio. Una sesión completada del 15 de septiembre puede afectar una selección dirigida al día 7 si el llamador la entrega. El probe produjo progresión de sentadilla en fuerza y de intervalos en cycling. La exposición de fuerza cuenta ejercicios por patrón, aunque algunos umbrales se describen como número de sesiones.

Además, [strengthContext.ts:32](../../src/services/training/strengthContext.ts#L32) deriva experiencia contando referencias 1RM: cuatro valores presentes significan avanzado, dos intermedio. Tener datos de carga y tener experiencia técnica son señales diferentes.

**Refactor y aceptación:** contexto canónico por atleta/deporte/slot, fecha de referencia obligatoria, experiencia independiente de referencias de carga, contadores separados por ejercicio/sesión/volumen. Los datos posteriores al slot no pueden cambiar progresión. Informar un 1RM adicional sólo debe cambiar aquello que dependa de esa referencia. Validar la divergencia de productores mediante pruebas integradas antes de atribuirle una tasa de mala selección.

### F12. Cycling y movilidad fuera de la composición verificable

Sus interfaces de selección no reciben duración, restricciones ni disponibilidad equivalentes a las de running/squash. [repairWeek.ts:3778](../../src/services/planBuilder/repairWeek.ts#L3778) pasa `recentSessionIds:[]` y copia estructuras textuales. [sessionDoseFinalizer.ts:33](../../src/services/training/sessionDoseFinalizer.ts#L33) devuelve sin comprobar dosis para estas disciplinas.

La selección de cycling base, primario, fatiga 4 y sin historial devuelve «Long ride progresivo», con estructura de 80–120 minutos. Esa API no puede distinguir un slot de 20, 45 o 120 minutos. La incompatibilidad de contrato está confirmada; no se ejecutó el recorrido completo de esa sesión hasta el calendario.

**Refactor y aceptación:** adaptar ambas disciplinas al mismo contrato de intención, recursos, exposición y dosis estructurada. Incluirlas en finalización y pruebas de persistencia. Ante restricciones no interpretables, devolver una limitación explícita; ningún fallback debe omitirlas. La ampliación del catálogo debe venir después de cubrir este contrato.

### F13. Continuidad dependiente del orden de llegada

[asyncGenerationLoop.ts:1207](../../src/services/planBuilder/asyncGenerationLoop.ts#L1207) toma la semana previa desde el array mutable al lanzar cada tarea: usa contenido listo si existe y, en caso contrario, el shell. Esa diferencia llega al prompt y a reparación. También se revisa calidad sobre el conjunto de semanas visible en ese momento.

Hay una protección específica que estabiliza la plantilla base de fuerza. No corresponde afirmar que todo el allocator dependa del orden. Sí quedan consumidores de contenido previo en squash, running y otras correcciones.

**Refactor y aceptación:** fijar contexto y reservas por bloque antes de las llamadas concurrentes. Resolver después, en orden de semana, las dependencias que realmente requieran contenido generado. Mantener el paralelismo y publicar una semana cuando estén validadas sus dependencias. Probar las mismas respuestas con órdenes de resolución distintos y comparar decisiones, contenido normalizado y advertencias.

### F14. Doble reparación completa de la semana

Con esqueleto, [WeekCreatorEngine.ts:423](../../src/services/weekCreator/WeekCreatorEngine.ts#L423) llama al hidratador; éste repara en [WeekCreatorLocalHydrator.ts:158](../../src/services/weekCreator/WeekCreatorLocalHydrator.ts#L158). El engine vuelve a reparar a través de `repairWeekCreatorResponse`, en [WeekCreatorEngine.ts:1149](../../src/services/weekCreator/WeekCreatorEngine.ts#L1149). Ambas pasadas pueden recorrer agenda, asignación de fuerza, squash, balance, seguridad y dosis.

**Refactor y aceptación:** separar normalización de agenda, hidratación, corrección y validación final. La segunda etapa debe ejecutar únicamente las garantías todavía necesarias. No basta con borrar la segunda llamada: existen realineaciones y metadatos de los que dependen otras ramas. Exigir idempotencia y equivalencia por cohorte. El ahorro de tiempo debe medirse; dos llamadas no implican automáticamente reducir a la mitad la latencia total.

### F15. Recuperación y medición incompletas

[coachRecovery.ts:153](../../src/services/ai/coachRecovery.ts#L153) puede realizar tres llamadas transitorias y devolver el último resultado sin marcar `retryUsed`. La sonda de dos timeouts y éxito devolvió tres llamadas, `retryUsed:false` y `durationMs:25`, correspondientes al último intento. `ProxyProvider` puede repetir transporte sin streaming y existe otro intento de formato. El backend actual no hace retry técnico de `chat_action`; no se debe atribuir una multiplicación inexistente de tres por tres.

En Plan Builder, [generateWeek.ts:308](../../src/services/planBuilder/generateWeek.ts#L308) abre/cierra `prompt_build` sin construir; `provider_call` envuelve el core completo y luego `normalize` y `repair` abren/cierra etapas sin ejecutar ese trabajo. Los tiempos del proveedor tampoco incluyen necesariamente reparación y escritura. Sí existen métricas útiles de job y un timing de recuperación completa; el problema es interpretarlos como etapas equivalentes.

**Refactor y aceptación:** un presupuesto total desde submit, intentos hijos identificados y métricas en las fronteras reales del core. Medir lecturas previas, proveedor, materialización, validación, propuesta y aceptación. Registrar intentos fallidos y consumo conocido; mantener desconocido lo que el proveedor no informa. Comparar streaming, tiempo hasta propuesta y tiempo total por separado.

## 5. Arquitectura objetivo

### Un contexto completo y una proyección para el modelo

El contexto de dominio debe ser inmutable durante la generación, incluir una fecha explícita y pertenecer a un atleta concreto. La representación del prompt se deriva de él y puede recortarse sin perder datos para las reglas locales.

Contrato orientativo; los nombres son propuesta, no tipos ya implementados:

```ts
type PlanningContextSnapshot = {
  athleteId: string
  requestId: string
  switchEpoch: number
  referenceDate: string
  contextVersion: string
  profileRevision: string
  executedHistory: ExecutedSession[]
  plannedExposure: PlannedSession[]
  executionSignals: SourcedExecutionSignals
  constraints: ResolvedConstraint[]
  resources: AvailableResources
  planDescriptors: PlanWeekDescriptor[]
  catalogVersion: string
  policyVersion: string
}

type SelectionResult =
  | { status: 'ready'; identity: ContentReference; dose: StructuredDose;
      contextHash: string; reasons: DecisionReason[] }
  | { status: 'infeasible'; reasons: DecisionReason[];
      alternatives: FeasibleAlternative[] }
```

`referenceDate` debe definir el corte de conocimiento. La exposición ya ejecutada, la ya planificada y la que se está proponiendo se contabilizan por separado. Una actualización excluye la dosis anterior del slot antes de calcular su reemplazo. La exposición de un lote se acumula de forma determinista.

Las restricciones requieren fuente y alcance: perfil vigente, petición del usuario, slot, semana o bloque. Una preferencia blanda no puede anular una restricción dura. El orden de precedencia debe ser explícito y comprobable, evitando defaults escondidos en cada constructor.

### Cadena de decisiones y responsabilidades

| Etapa | Responsabilidad única | Salida verificable |
|---|---|---|
| Capturar solicitud | Fijar atleta, conversación, fecha y presupuesto. | Solicitud identificada. |
| Resolver intención | Distinguir consulta, alta, cambio, semana o plan; resolver objetos. | Intención tipada y objetivos afectados. |
| Construir contexto | Leer datos del mismo scope y conservar su procedencia. | Snapshot de dominio y proyección de prompt. |
| Planificar agenda | Resolver días, slots, competición y presupuestos entre deportes. | Slots y reservas por semana/bloque. |
| Seleccionar | Filtrar elegibilidad; ordenar candidatos compatibles. | Identidad y razones de selección. |
| Materializar | Convertir intención/receta en dosis estructurada. | Bloques, duración, carga y objetivos coherentes. |
| Validar | Comprobar invariantes sin volver a inventar el entrenamiento. | Propuesta válida o rechazo tipado. |
| Explicar | Renderizar la decisión final y sus cambios. | Texto consistente con el contenido. |
| Aceptar | Verificar vigencia y propiedad, aplicar la propuesta revisada. | Escritura y reversión controladas. |
| Observar | Relacionar propuesta, aceptación y ejecución real. | Métricas y feedback con versión. |

Cada disciplina conserva su selector y materializador especializado. Se comparte el contrato y la autoridad de políticas. La validación final debe considerar el contenido completo, tanto si llegó del modelo como de una receta o de una edición manual.

La aceptación revalida restricciones que pudieron cambiar después de generar. Si el contexto ya no permite la propuesta, se presenta el cambio necesario o se solicita regenerar; no se sustituyen ejercicios silenciosamente después de haber mostrado un resultado concreto.

### Papel de la IA

- Conversación: explicar y responder usando hechos recuperados para la pregunta.
- Acciones simples con objeto resuelto: traducir una intención ya clara a operaciones locales; una fecha o duración no necesita regenerar todo el plan.
- Semana/plan: proponer intención, distribución y prioridades dentro de un contrato compacto. Los catálogos y políticas producen la dosis ejecutable.
- El contrato compacto de Week Creator sólo se usa en cohortes elegibles. Se conserva la ruta detallada cuando existen restricciones activas o texto de restricciones sin resolver; los selectores locales no deben inferir adaptaciones médicas arbitrarias.
- Ambigüedad: pedir el dato que cambia la decisión o devolver una interpretación revisable; no convertir una pregunta en una mutación por mencionar un día.
- Recuperación: otro intento sólo si puede resolver el fallo y queda presupuesto. No comprar otro intento para una incompatibilidad local determinista.

Comparar proveedores/modelos después de estabilizar los fixtures y el contrato. No fijar una nueva recomendación de modelo a partir de comentarios antiguos, nombres por defecto del repositorio o tiempos sintéticos. Las capacidades y precios reales del despliegue requieren una verificación separada antes de ese experimento.

## 6. Selección a todos los niveles

| Nivel | Información necesaria | Regla de diseño |
|---|---|---|
| Atleta | Experiencia por disciplina, objetivos, recursos, restricciones y referencias de carga. | Ausencia de un dato no equivale a incapacidad ni a permiso. |
| Macrociclo/bloque | Evento, fases, progresión, reservas y rol de cada deporte. | Planificar continuidad antes de añadir variedad. |
| Semana | Agenda, sesiones realizadas, propuestas, dosis acumulada y vecinos duros. | Recalcular el lote completo ante cambios que alteren exposición. |
| Sesión | Objetivo principal, modalidad, tiempo real y recursos del día. | El accesorio cede antes que el objetivo principal. |
| Ejercicio/receta | Identidad, elegibilidad, patrón, esfuerzo, dosis y alternativas. | Elegir por ID; conservar versión y procedencia. |
| Sustitución | Motivo del reemplazo y estímulo que debe mantenerse. | Recalcular prescripción compatible; no reemplazar sólo el nombre. |
| Edición/historial | Campos realmente cambiados y estado de ejecución. | Metadatos no reescriben dosis; historia no se recalcula con el catálogo nuevo. |

El ranking debe dejar razones legibles: compatibilidad con intención, fase y recursos; dosis factible; continuidad o rotación justificada; penalizaciones por exposición. Guardar una selección pequeña de razones estructuradas, sin almacenar razonamiento interno del modelo ni duplicar todo el perfil en logs.

La variedad no debe ser el objetivo dominante. Repetir un estímulo puede ser correcto para progresar; rotar por nombre o por un contador que confunde ejercicios con sesiones puede perjudicar esa continuidad. La evaluación debe premiar **repetición justificada** y detectar repetición accidental.

## 7. Velocidad: orden de las optimizaciones

1. **Instrumentar correctamente.** Corregir F15 y separar tiempo de proveedor, CPU local, lecturas, cola, polling y persistencia. Incluir fallos y abandonos.
2. **Evitar trabajo que cambia el resultado equivocadamente.** Resolver routing y contexto antes de generar; esto también reduce recuperaciones y solicitudes repetidas del usuario.
3. **Compartir cálculos por solicitud.** Construir una sola vista de historial/exposición y reutilizar índices y candidatos dentro del mismo snapshot. Incluir versión de perfil, catálogo y políticas en las claves de caché.
4. **Descomponer la doble reparación.** Medir cada paso, conservar los que aportan garantías y retirar repeticiones comprobadas.
5. **Acotar llamadas y salida.** Usar esquemas compactos con IDs/objetivos; generar texto explicativo desde el resultado final cuando sea suficiente. Consolidar deadline e intentos.
6. **Conservar concurrencia con dependencias explícitas.** El valor por defecto del loop es 3 y el máximo 6; aumentar ese límite sin resolver F13/F09 puede aumentar incoherencia o gasto.
7. **Mejorar tiempo percibido.** Estado visible durante lecturas, chunks agrupados si un perfil de render demuestra costo, primera semana válida disponible y actualización incremental de progreso.
8. **Optimizar transporte sólo con datos.** El polling actual es de 4 segundos. Medir su demora de descubrimiento antes de sustituirlo por suscripciones o polling adaptativo. Distinguir semana lista en servidor de semana visible en cliente.

No hay evidencia suficiente para prometer un porcentaje de aceleración. Los experimentos históricos de [ruido del Plan Builder](../superpowers/experiments/plan-builder-noise-floor-2026-08-09/README.md) ya documentan variabilidad y diferencias entre harness y uso real; sus números no son una línea base actual.

## 8. Inteligencia, feedback y memoria

El producto ya tiene RPE, dolor/energía, adherencia, carga, resultados técnicos, notas y recalibración de semanas futuras. La mejora consiste en convertir esas señales en decisiones coherentes entre rutas y conservar evidencia de su origen.

Guardar por decisión: qué intención resolvió, qué señales utilizó, qué datos faltaban, por qué eligió o sustituyó contenido y qué versión de política aplicó. Al ejecutar la sesión, asociar feedback a esa identidad y dosis. Diferenciar falta de adherencia por agenda de incapacidad para completar la prescripción; requieren ajustes distintos.

Las preferencias aprendidas deben ser editables y tener vigencia. Una frase circunstancial como «hoy no tengo compañero» pertenece al slot o a la fecha indicada; no debe transformarse en una restricción permanente. Las limitaciones importantes confirmadas deben sobrevivir al recorte de conversación.

La nota semanal tiene una caché basada en agregados de `WeekSummary`, en [weeklyCoachNote.ts](../../src/services/weeklyCoachNote.ts). Al ampliar su inteligencia, la clave debe cubrir también revisiones de las fuentes usadas: feedback, restricciones, perfil y versión de prompt. Un resumen numérico idéntico no implica que todo el contexto interpretado siga vigente. Es una evolución del contrato de frescura, no un incidente de nota incorrecta demostrado aquí.

## 9. Entregas y orden de implementación

El tamaño indica alcance relativo: **S** acotado; **M** varias rutas; **L** contratos/persistencia compartidos. No son estimaciones de calendario: faltan responsables y capacidad del equipo.

| Entrega | Trabajo concreto | Tamaño | Dependencia | Criterio de salida |
|---|---|---|---|---|
| E0 — Referencia y contratos | Congelar fixtures, reparar mocks obsoletos, incorporar repros y métricas reales. | M | Ninguna | Tests relevantes verdes, evidencia reproducible y distinción entre hidratación/corrección. |
| E1 — Correcciones de contenido | F02/F03/F05: señales, modalidad principal y edición sin redosificar; preservar la corrección de F04. | M | Fixtures de E0 | Mismo resultado en propuesta, formulario, aceptación y persistencia. |
| E2 — Identidad y contexto | F01/F06/F07/F10: snapshot de atleta, router único y proyección de prompt separada. | L | E0 | Sin mezcla de atletas; consulta histórica responde con hechos; target fuera del recorte sigue resolviéndose. |
| E3 — Contrato de selección | F11/F12: adaptadores por deporte, experiencia separada, corte temporal y dosis cycling/movilidad. | L | E1/E2 | Paridad de reglas en las cinco disciplinas y todos los productores. |
| E4 — Generación durable | F08/F09: horizonte completo, claim del job y checkpoints condicionados. | L | E0; contrato de contexto acordado | Entrega duplicada no duplica generación; equivalencia local/remota y recuperación parcial. |
| E5 — Motor por etapas | F13/F14: reservas deterministas, dependencias ordenadas y una materialización canónica. | L | E1/E3/E4 | Invariantes e idempotencia con distintos órdenes de resolución. |
| E6 — Rendimiento | F15 completo, reutilización de cálculos, presupuesto de intentos y UX de progreso. | M | Instrumentación desde E0; comparación estable tras E5 | Mejora medida sin regresión de calidad, costo ni proporción de rechazos. |
| E7 — Feedback y evaluación de IA | Hechos con vigencia, razones persistidas, evaluación humana y experimentos de modelo. | M/L | E2/E3 y baseline estable | Mejora de utilidad y aceptación en casos equivalentes, con límites explícitos. |

E1, E2 y el claim de E4 pueden avanzar en paralelo con propietarios claros. No deben editar simultáneamente el mismo finalizador sin coordinar el contrato. La instrumentación empieza en E0; E6 recoge optimizaciones validadas, no pospone la medición.

### Migración y compatibilidad

- Introducir contratos nuevos mediante adaptadores de las interfaces actuales; migrar una ruta por vez y comparar resultados localmente con las mismas entradas.
- Mantener campos nuevos opcionales para lectura de datos legacy. Versionar prescripción y políticas; no rematerializar sesiones históricas como efecto lateral de una migración.
- Conservar ID, origen manual/IA/plantilla y motivos de cambios. Separar corrección de metadatos de modificación de dosis.
- Activar cambios por ruta/deporte con reversión independiente. Un rollback de orquestación no puede desactivar las postcondiciones de restricciones o permitir writes de un worker obsoleto.
- Antes de retirar una implementación anterior, exigir cobertura del adaptador, aceptación, serializadores, exportación/importación y sincronización. La comparación en sombra no necesita una segunda llamada de IA.
- Mantener validación y reversión multisemana de `commitPlan`; no paralelizar indiscriminadamente esa operación para ganar velocidad.

## 10. Evaluación y criterios de aceptación

### Matriz de escenarios

| Dimensión | Casos mínimos |
|---|---|
| Ruta | Chat general, acción, Week Creator esqueleto/detallado/fallback, Plan Builder local/remoto/parcial, manual, plantilla y sustitución. |
| Disciplina y rol | Fuerza, squash, running, cycling y movilidad; deporte principal, híbrido y apoyo cuando corresponda. |
| Experiencia/datos | Principiante/intermedio/avanzado; perfil incompleto; referencias válidas/ausentes; historial vacío y longitudinal. |
| Tiempo | Mínimo viable, debajo del mínimo, 20/30/45/60 minutos; partido con duración estimada. |
| Recursos | Equipamiento disponible/restrictivo/desconocido; squash solo/partner; recursos distintos por sesión. |
| Calendario | Doble sesión, vecino duro, semana parcial, evento, taper, cambio de disponibilidad y presupuesto agotado. |
| Historia | Completed/adjusted, planned/skipped, datos posteriores al slot, feedback manual frente a prefill. |
| Operación | Cambio de atleta, cancelación, respuesta tardía, reentrega del job, retry, escritura parcial, edición tras cambio de perfil. |

No hace falta ejecutar el producto cartesiano completo. Usar cobertura por pares y casos dirigidos para los límites; ampliar donde aparezcan interacciones. Conservar fixtures legibles y evitar mocks que omitan campos obligatorios del contrato.

### Invariantes que bloquean una entrega

- Atleta de contexto, petición, propuesta y escritura coinciden.
- Consulta informativa no termina en mutación o redirección injustificada.
- La sesión objetivo y sus restricciones no desaparecen al recortar el prompt.
- La modalidad principal sobrevive a dosificación, reparación y serialización.
- Tipo, nombre, objetivos, bloques y duración describen la misma sesión.
- La dosis cumple las políticas vigentes de recursos, restricciones, fase y exposición; un rechazo determinista no se elude con fallback.
- Editar metadatos no cambia entrenamiento ni historial ejecutado.
- Repetir finalización sobre el mismo snapshot conserva contenido; excluir de la comparación sólo IDs/timestamps no semánticos, manteniendo las relaciones de superseries y bloques.
- Misma entrada y respuestas fijas producen decisiones equivalentes entre rutas y al permutar el orden de llegada.
- Cada job tiene un propietario autorizado para escribir; cancelación y borrado son terminales para trabajadores anteriores.

### Métricas de producto y rendimiento

| Métrica | Definición y uso |
|---|---|
| Tiempo a primera respuesta útil | Desde submit, no desde que empieza el proveedor; separar texto y estado de procesamiento. |
| Tiempo a propuesta válida | Hasta que el usuario puede revisar/aplicar contenido que pasó las postcondiciones. |
| Primera semana visible / plan completo | Incluir cola, generación, persistencia y descubrimiento por cliente; segmentar por número de semanas. |
| Trabajo local | Tiempo de contexto, selección, materialización, corrección, calidad y aplicación; p50/p95 en equipo de referencia. |
| Intentos y costo | Intentos HTTP/modelo por solicitud lógica, causa, tokens conocidos, consumo de caché y costo estimado versionado. |
| Calidad técnica | Violaciones duras, preservación de intención, identidad, dosis, cambios estructurales y paridad entre rutas. |
| Utilidad | Propuestas aceptadas, editadas o rechazadas, motivo, cambios manuales posteriores y abandono. |
| Continuidad | Progresión explicable, repetición justificada, cumplimiento y feedback asociado a la receta realmente ejecutada. |

Primero medir la línea base por cohorte y fijar umbrales antes de comparar variantes. Como meta de planificación para E6 se puede evaluar una reducción de al menos 20% en tiempo a propuesta/primera semana sobre los casos representativos, **sujeta al ruido medido y sin regresiones de invariantes**. Es un objetivo candidato, no un resultado ni SLA. No declarar p95 confiable a partir de una docena de planes.

La evaluación de inteligencia debe incluir revisión ciega por un entrenador de casos pareados: fidelidad al pedido, compatibilidad, progresión, explicación y utilidad. El score automático de `qualityReview` valida reglas del producto, pero por sí solo no acredita calidad deportiva ni que el modelo entendió al usuario. No cambiar los umbrales después de observar una variante para hacerla aprobar.

## 11. Verificación realizada

| Comprobación | Referencia | Resultado |
|---|---|---|
| Suite completa `npm test -- --maxWorkers=4` | Árbol vivo antes de fijar copia | 586 archivos; 4.985 pruebas aprobadas, 15 fallidas; 95,10 s. |
| Suite focalizada de 13 archivos | Copia fijada | 171 pruebas; 158 aprobadas, 13 fallidas; 8,76 s. |
| TypeScript `npx tsc -b --pretty false` | Copia fijada | Aprobado. |
| Lint `npm run lint` | Copia fijada | Aprobado. |
| Probes de routing, contexto, squash y running | Copia fijada | Resultados guardados; sin llamadas al proveedor. |
| Repetición del probe adjunto | Segundo runtime sobre la copia fijada | Salida idéntica byte a byte. |
| Reprobes al cierre | Árbol actualizado | F04 devuelve ritmos Z2; los restantes casos adjuntos mantienen el resultado de referencia. |
| `repairWeek.test.ts` al cierre | Árbol actualizado, después de actualizar su mock/expectativas | 18/18 aprobadas; 2,23 s. |

Los 13 fallos de la copia fijada se concentran en dos archivos:

- **12 en `src/services/__tests__/repairWeek.test.ts`:** en el corte, el mock de running devuelve sólo `session:{runningType:'z2'}`. El consumidor requiere duración, estructura y referencia; recibe campos ausentes y la finalización rechaza la semana. Era evidencia de fixtures incompatibles, no de doce regresiones productivas distintas. **Resuelto al cierre:** se usa el selector real y las 18 pruebas de ese archivo pasan.
- **1 en `recentContextIntraPlan.test.ts`:** el fixture introduce mediante `as never` sesiones sin `timeBlock`; el nuevo helper ordena por ese campo. No demuestra que existan filas productivas así. Completar el fixture y decidir explícitamente el tratamiento de datos legacy incompletos en su frontera de lectura.

Los dos fallos adicionales de Week Creator y los ocho errores de lint observados inicialmente ya no aparecen en la copia fijada. No se mezclan esos resultados para afirmar que se repitió una suite completa verde: **la suite completa no se volvió a ejecutar sobre la copia**. La validación focalizada tampoco es un smoke de navegador o multidispositivo.

Para repetir los casos adjuntos sobre el árbol actual:

```bash
node docs/reviews/fixtures/coaching-refactor-2026-09-08/probe.mjs
```

El script admite como argumento la ruta de otra copia del repositorio. `evidence.json` conserva el comando exacto usado sobre la referencia fijada, los 13 archivos de la suite focalizada, huellas y logs. Los resultados del probe son caracterización de defectos, no expectativas que haya que conservar tras corregirlos.

## 12. Punto de partida para la implementación

Comenzar con los repros de F02/F03/F05, conservar la corrección de F04 y abordar el snapshot de identidad de F01 y la separación entre contexto de dominio y prompt de F06. Estas entregas corrigen diferencias de contenido y crean límites claros para el resto del refactor. En paralelo, fijar el presupuesto y la instrumentación real de F15 y el contrato de job de F09.

La primera revisión de implementación debe mostrar casos antes/después, resultados de las rutas afectadas, efectos en persistencia y cambios medidos en tiempo. La aceptación del refactor depende de decisiones coherentes y sesiones aplicables en toda la app, además de velocidad.

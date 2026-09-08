# Squash y running: cierre de implementación

Fecha: 2026-09-08. Alcance autorizado: E1, E2a, E2b, E3 y el backlog separado del [plan](../superpowers/plans/2026-09-07-squash-running-selection.md). Conserva el [audit original](2026-09-07-squash-running-library-audit.md) y la [revisión histórica de E1](2026-09-07-squash-running-e1.md).

## Resultado

Las rutas locales de chat, Plan Builder y Week Creator comparten validación de dosis antes de aceptar. Running se construye desde recetas tipadas con referencia ID/versión; squash usa disponibilidad, intención técnica y resultados ejecutados. Se incorporó el selector manual de running y se amplió el catálogo de 60 a 76 drills de squash y de 27 a 31 plantillas de running.

La segunda reparación de una semana completa conserva el contenido, incluida la identidad de squash. Se corrigió el contraejemplo documentado en E1: la firma de rotación queda en todos los bloques, evita volver a densificar sesiones ya reparadas y se refresca después de dosificar.

## Trazabilidad

| Hallazgos / entrega | Implementación | Evidencia local |
|---|---|---|
| S1, R7, R8 / E1 | `sessionTimeBudget`, `squashSessionDose`, `sessionDoseFinalizer` y `coachActionDose`: presupuesto, pausas, objetivos por bloque y rechazo de dosis inviables antes de escribir | `sessionDose.test.ts`, `sessionDosePersistence.test.ts`, `selector-dose-routes.test.js` |
| S2, S6 / E2a | `executedSessions`: completed/adjusted anteriores a la fecha objetivo; planned/skipped separados. Fallbacks conservan restricciones; pool vacío explícito | `executedSessions.test.ts`, `drillSelector.test.ts`, `runningTemplates.test.ts` |
| S3 / E2a y backlog | Familia técnica separada de modalidad; una exposición por familia/sesión. Progreso requiere aciertos y esfuerzo de ejecución real | `squashTrainingContext.test.ts`, `drillSelector.test.ts`, invariantes del catálogo |
| S4, S5 / E2b y backlog | Wizard captura solo/partner/either; override por sesión, entrenador, alimentador, cancha y material; intención por familia/lado, meta y aciertos/intentos | `CompetitionPlanNewCycle.test.tsx`, `squashTrainingContext.test.ts`, serializadores y backup |
| S7, R2 / política semanal | Planner de squash consume `resolveSquashWeeklyExposurePolicy`; running comparte presupuesto, techo por fase y veto de intensidad por sesión vecina/fatiga | `runningTemplates.test.ts`, suites de reparación semanal y exposición de squash |
| R1, R3, R4 / E2b | Tiempo y experiencia afectan elegibilidad/dosis; continuidad de rodajes fáciles; intensidad filtrada antes del scoring; progress/hold/deload modifica dosis | `runningTemplates.test.ts`, `runningSelector.test.ts` |
| R5, R6 / E3 | `runningPrescriptions` y `runningTemplateMaterializer`: 31 recetas, ID/versión, bloques de trabajo y recuperación, distancia por repetición y duración estimada | Materialización de todas las recetas, identidad editada, preview, aceptación y round-trips |
| R9 / E2b y backlog | Perfil de impacto explícito y adaptación conservadora de restricciones estructuradas existentes; selector, reparación, aceptación y catálogo manual consumen el perfil | Casos no_running/no_fast_running, restricciones y pool vacío en `runningTemplates.test.ts` |
| R10 / backlog | `RunningTemplatePicker` en SessionForm: búsqueda, preview al tiempo actual, incompatibilidad visible, selección y persistencia | `SessionFormRunningTemplates.test.tsx`, `sessionTemplateSerializer.test.ts` |
| N1, N2 | Los productores automáticos usan recetas canónicas; el finalizador verifica la identidad y retira una referencia que ya no corresponde a los bloques | Tests de recetas, repair y serialización |
| N3 | Reparación semanal idempotente, sin duplicar sesiones al repetirla | Comparación de `second.sessions` con `first.sessions` en `selector-dose-routes.test.js` |

El historial ejecutado se filtra en Settings, ChatCoach, ambos stores y el helper compartido del prompt. Plan Builder carga ejecuciones del atleta antes de su fecha de referencia; Week Creator las transmite al contexto de reparación. La exposición planificada sirve para distribución/carga, no acredita aprendizaje.

## Backlog incorporado

- **Squash:** salida de pared/fondo, lado débil, preparación inicial de raqueta, transición delante/detrás, ghosting reactivo con señal, frenado, presión 8–8, decisión de volea, drive con pausa, alimentación a zona delantera, progresión de volea con entrenador, resto de saque alto/al cuerpo/rápido y defensa→neutralización→ataque. Las 16 altas declaran requisitos, dosis, errores, éxito y regresión/progresión. Los 60 drills previos reciben metadatos compatibles sin sustituir sus instrucciones originales.
- **Running:** rodaje fácil fraccionado, fartlek breve, umbral breve de apoyo y activación para squash. Las variantes existentes incorporan run-walk por nivel y resultados, aceleraciones con recuperación explícita y técnica desglosada en marcha A, skipping bajo y apoyos cortos.
- **Aprendizaje:** familia, lado, meta de precisión y resultado medido se guardan separados de la dosis. Sin dos ejecuciones con resultado suficiente y esfuerzo tolerado se mantiene el nivel; las sesiones planificadas no producen progreso.
- **Explicación:** tarjetas muestran motivos de selección y contexto técnico. Una incompatibilidad no se resuelve escogiendo una plantilla global que incumpla las restricciones.

## Decisiones de dosis y carga

Los mínimos de composición de E1 siguen documentados en su revisión: squash técnico/control 15 min, sombras/partido 20 min; running genérico fácil 15 min y calidad 20 min. **Una receta concreta puede exigir más tiempo**: el mínimo de cada identidad está declarado en `runningPrescriptions.ts` (p. ej., rodaje largo 60 min, 400 m 25 min). Elegir manualmente una receta que no cabe produce incompatibilidad; el selector automático puede escoger otra elegible. Las pruebas materializan las 31 recetas y comprueban sus presupuestos.

La extensión aditiva del contrato que el plan asignaba a E1 se completó en E3; la entrega histórica E1 usaba bloques planos compatibles. El cálculo usa segundos; bloques guardan minutos fraccionarios cuando hace falta y campos opcionales de rol, recuperación, base de duración y estimación. Los descansos entre repeticiones no añaden una pausa después de la última. Protocolos de entrada/cierre forman parte del presupuesto. Distancias requieren una referencia de ritmo del atleta para estimar tiempo; sin ella se ofrece una opción por tiempo. Cuestas, esfuerzo de maratón sin referencia específica y perfiles incompletos no reciben ritmos planos inventados.

La política compartida de running de apoyo fija 120 min semanales, 75 en taper; máximo por sesión 60 en base, 40 en build/peak y 25 en taper, limitado además por el presupuesto restante. Fatiga ≥6, riesgo de carga o sesión dura el mismo día o el adyacente fuerzan intensidad baja. Son valores explícitos de producto, revisables; no umbrales clínicos ni una validación experimental de interferencia. Para running principal no se aplica este presupuesto de apoyo. La autoridad semanal existente de squash sigue gobernando sus exposiciones.

La adaptación de restricciones utiliza la autoridad estructurada existente, sin reinterpretar texto médico con otra lista de palabras. Ante restricción de impacto, región de miembro inferior o restricción médica no resuelta bloquea running automático. Es deliberadamente conservadora: no estima tolerancia individual ni convierte run-walk en rehabilitación. El perfil permite declarar no_running/no_fast_running. Disponibilidad desconocida se conserva como desconocida; either significa flexible, no compañero confirmado.

## Persistencia y compatibilidad

`RunningDetails.templateRef` guarda source/id/version; `selectionReason` guarda el motivo. Los bloques y el contexto de squash sobreviven normalización, acciones/propuestas, borrador, plantilla reutilizable, exportación/importación y sync. Cambiar el título conserva la referencia; cambiar tipo o receta la elimina si deja de corresponder. Los registros históricos con referencias desconocidas se pueden leer sin inventar una identidad nueva.

Se revisaron Dexie, la carga JSON de sync, el parser de backup y los serializadores. Los campos nuevos son opcionales y no cambian claves ni índices de Dexie ni columnas remotas: no requieren DDL. Se corrigió el parser que descartaba estructuras de running. Hay pruebas con escritura/lectura en Dexie, backup/import y push/pull con transporte simulado. Esto no acredita una migración ni una sincronización contra producción.

Las sesiones históricas no se recalculan por actualizar el catálogo. Se mantiene compatibilidad con bloques manuales/legacy sin referencia canónica; la validación prospectiva no les atribuye una procedencia ficticia.

## Verificación final

Gate final completado:

| Comando | Resultado |
|---|---|
| `npm test -- --maxWorkers=4` | **587 archivos, 5007/5007 tests**, 97,76 s |
| `npm run lint` | OK |
| `npm run build` | TypeScript y build OK |
| `npm run probe:selectors` | Dos construcciones idénticas, cero intentos fetch/XHR |
| `npm run probe:selectors:check` | Sin deriva en proceso posterior |
| `git diff --check` | Limpio |

El gate final no tuvo el timeout del allocator de fuerza observado en E0. El build local informa release `dev`, esperable sin identificador de despliegue; no se publicó.

Los artefactos E0 y E1 se conservan intactos; el resultado final vive en `fixtures/squash-running-selection/e3/`. `npm run probe:selectors` y `npm run probe:selectors:check` apuntan ahora a E3. SHA-256 normalizado final: `6a7f98a2856f3b0997faebc2f84b8e3e7aa9e25c0d0d7e6a2ce0faa019bf1810`. Cada corrida compara dos construcciones normalizadas y el check posterior compara con el artefacto congelado. El probe intercepta fetch/XHR; no es un aislamiento general de todas las APIs de red de Node. La cobertura de persistencia procede de las pruebas de integración, no del probe de selectores.

Las expectativas modificadas corresponden a cambios intencionales: familias técnicas de 11 entradas legacy, ghosting reactivo que requiere señal de otra persona, progreso condicionado a resultados y cero reparaciones en una segunda pasada ya normalizada. Se retiró un mock de running que devolvía un resultado incompleto para ejercitar el selector real. La prueba de detección del deporte para una sesión próxima usa ahora fechas posteriores al reloj simulado, coherentes con el filtro de planificación futura. No se regeneraron snapshots masivamente.

El gate se ejecuta sobre el árbol compartido, que incluye el frente de fuerza/equipamiento del usuario; la procedencia del probe registra revisión y archivos modificados. No constituye un commit aislado. No se realizaron llamadas pagadas de generación, deploy ni cambios remotos. Quedan fuera de esta verificación local una prueba con proveedor real, la operación en producción y la validación deportiva con atletas.

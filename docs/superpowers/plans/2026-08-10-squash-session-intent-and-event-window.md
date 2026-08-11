# Squash: modalidad explícita y eventos multijornada — plan de implementación

Fecha: 2026-08-10  
Estado: borrador para aprobación; no ejecutar todavía  
Spec: `docs/superpowers/specs/2026-08-10-squash-session-intent-and-event-window-design.md`

## Estrategia de entrega

El trabajo se divide en dos proyectos independientes. El Proyecto A corrige la
modalidad de squash en todas las superficies. El Proyecto B agrega la ventana
del evento. Cada tarea debe terminar con tests focalizados; cada PR debe poder
revertirse sin afectar al otro proyecto.

Orden:

1. A0 — congelar la regresión;
2. A1 — modelo e invariantes del catálogo;
3. A1.5 — ampliar el pool de control;
4. A2 — hidratador compartido;
5. A3 — Plan Builder;
6. A4 — Crear semana;
7. A5 — chat;
8. A6 — formulario manual y plantillas;
9. A7 — prueba cruzada y rollout;
10. B0–B6 — evento multijornada;
11. C — ampliación de los otros pools, con spec de contenido separado.

## Proyecto A — modalidad de squash en todos los flujos

### Task A0 — Congelar la regresión actual

**Objetivo:** demostrar el bug antes de cambiar contratos.

**Archivos:**

- Test: `src/services/planBuilder/__tests__/squashNormalization.test.ts`
- Test: `src/services/weekCreator/__tests__/WeekCreatorLocalHydrator.test.ts`
- Fixture nuevo, si hace falta, bajo el directorio de tests correspondiente.

**Pasos:**

- [ ] Crear una propuesta squash con intención técnica, título de puntos
  condicionados y objetivo que incluya literalmente "control de longitud".
- [ ] Confirmar que el comportamiento actual selecciona control/solo; el test
  debe fallar contra la expectativa nueva.
- [ ] Crear el mismo caso compacto para Crear semana.
- [ ] No copiar el backup completo al repositorio; usar un fixture mínimo sin
  datos personales.

### Task A1 — Convertir el catálogo en autoridad explícita

**Objetivo:** que ningún drill derive modalidad desde texto, categoría o tags.

**Archivos principales:**

- Modify: `src/services/training/drillLibrary.ts`
- Modify: `src/types/index.ts`
- Test: `src/services/training/__tests__/squashDrillInvariants.test.ts`
- Test: `src/services/planBuilder/__tests__/squashNormalization.test.ts`
- Test: `src/services/training/__tests__/squashDrillReplacementApi.test.ts`

**Pasos:**

- [ ] Agregar `sessionKind` y hacer explícito `executionMode` en
  `SquashDrillDefinition`.
- [ ] Auditar todas las definiciones, una por una, contra la matriz del spec.
- [ ] Reclasificar los tres drills cooperativos identificados como
  `technical/partner`.
- [ ] Reclasificar técnicos `either` a `partner` cuando sus instrucciones
  requieren rotación o alimentación de otra persona.
- [ ] Separar los tipos: `SquashDrillExecutionMode` acepta sólo
  `solo|partner|match`; `either` queda únicamente en
  `SquashPartnerAvailability`.
- [ ] Agregar un invariant que prohíba `executionMode='either'` en toda
  definición del catálogo.
- [ ] Clasificar acondicionamiento sin pelota como `shadows/solo`.
- [ ] Habilitar explícitamente los tres drills de sombras en taper mediante
  `phaseAppropriate`/metadata canónica y comprobar que pasan `isPhaseAllowed`.
- [ ] Hacer que `resolveSquashDrillKind` y `resolveDrillExecutionMode` lean los
  campos explícitos.
- [ ] Mantener temporalmente `partnerRequired`, con invariant que impida una
  contradicción con `executionMode`.
- [ ] Agregar test de tabla que cubra el 100% del catálogo y conteos esperados
  por modalidad.
- [ ] Correr tests de selector, reemplazo, normalización y copy del catálogo.

**Salida:** catálogo coherente sin agregar drills nuevos.

### Task A1.5 — Ampliar el pool de control antes de endurecer el selector

**Objetivo:** evitar que la separación solo/partner agote el catálogo y tumbe
semanas por unicidad de firma.

**Archivos principales:**

- Modify: `src/services/training/drillLibrary.ts`
- Modify: `src/services/training/__tests__/squashDrillInvariants.test.ts`
- Modify: `src/services/__tests__/drillSelector.test.ts`
- Test: `src/services/planBuilder/__tests__/controlPoolCapacity.test.ts`
- Modify, si corresponde: tests de copy/búsqueda del catálogo.

**Pasos:**

- [ ] Documentar el conteo ejecutable por fase después de A1; ese conteo es el
  baseline de capacidad.
- [ ] Preparar y aprobar una tabla acotada de drills control/solo nuevos con
  nombre, instrucciones, protocolo, familia, intensidad y fases.
- [ ] Cubrir como mínimo drives paralelos de derecha y revés, drops, media
  cancha, voleas y variaciones de volumen/objetivo sin duplicar sólo el nombre.
- [ ] Alcanzar al menos nueve opciones control elegibles en build y peak y seis
  seguras para taper.
- [ ] Verificar que todos los drills nuevos declaran `sessionKind=control` y
  `executionMode=solo` y que ninguno usa `either`.
- [ ] Simular planes de 4, 8 y 12 semanas con control recurrente y comprobar que
  no repiten firmas consecutivas ni producen
  `quality.squash.signature_uniqueness_unresolved` por agotamiento del pool.
- [ ] Confirmar que la selección sigue respetando fase, fatiga y rotación.

**Salida:** pool de control suficiente para aplicar A2 sin depender de mezcla de
modalidades o reutilización inmediata.

### Task A2 — Crear el hidratador compartido y endurecer el selector

**Objetivo:** una sola composición para cualquier origen.

**Archivos principales:**

- Create: `src/services/training/squashSessionHydrator.ts`
- Test: `src/services/training/__tests__/squashSessionHydrator.test.ts`
- Modify: `src/services/training/drillSelector.ts`
- Modify: `src/services/training/__tests__/drillSelectorPhase.test.ts`
- Modify: `src/services/__tests__/drillSelector.test.ts`

**Pasos:**

- [ ] Definir la entrada pura: `kind`, duración, objetivo/foco, fase, fatiga,
  historial, nivel competitivo y disponibilidad conocida.
- [ ] Devolver `subtype`, `squashDetails`, advertencias y metadata de fallback.
- [ ] Mantener `sessionKind` como modalidad principal aunque exista un accesorio
  `shadows`.
- [ ] Eliminar fallbacks `control -> technical` y `technical -> control` del
  selector cuando existe intención explícita.
- [ ] Permitir reuso reciente de la misma modalidad antes que cruzar modalidad.
- [ ] Formalizar las combinaciones de bloques permitidas y validarlas.
- [ ] Probar control+shadows en ambos órdenes.
- [ ] Probar técnico con partner, técnico+shadows, match y restricciones de
  fase/fatiga.
- [ ] Probar pool insuficiente y advertencia sin mezcla silenciosa.

### Task A2.5 — Exposición competitiva semanal (pendiente, tras A2)

**Objetivo:** garantizar una exposición competitiva por semana cuando squash es
el deporte principal y es ejecutable. Es composición semanal, no modalidad de
drill: por eso va después del hidratador y reutiliza
`hasSquashCompetitiveExposureContent` en vez de crear un segundo predicado.

**Entrada de datos medida al cerrar A1/A1.5 — el pool no alcanza hoy:**

| fase | drills de match elegibles |
|---|---:|
| base | **0** |
| build | 3 |
| peak | 3 |
| taper | **0** |

`base = 0` está congelado por `drillLibrarySchema.test.ts`
(*match drills are not phaseAppropriate for base phase*) y documentado como
deliberado en `CLAUDE.md`. `taper = 0` es consecuencia de A1: la activación
pre-partido dejó de contarse como partido, porque no lo es.

**Esta escasez NO se compensa dentro del hidratador.** Un fallback de modalidad
que rellene el hueco reintroduciría exactamente el cruce silencioso que A2
elimina. La decisión es de contenido y de política semanal:

- reconocer mejor de 3 y mejor de 5 como `standalone` cuando son el único
  contenido — **ya implementado** al cerrar A1.5, porque era la causa raíz de la
  regresión de taper;
- permitir que el mejor de 3 también funcione como finisher;
- base: mejor de 3; build/peak: mejor de 5 o mejor de 3 según carga;
- taper: sólo a tres o más días del evento;
- race: el evento real cumple la exposición, sin match adicional;
- fatiga normal modifica formato y duración; lesión, restricción médica,
  `partnerAvailability=solo` o sobrecarga severa siguen siendo vetos de
  seguridad.

`resolveSquashMatchRole` debe seguir siendo un predicado puro de contenido: no
puede volverse dependiente de la fase.

### Task A3 — Integrar Plan Builder

**Objetivo:** cerrar la causa original en planes completos.

**Archivos principales:**

- Modify: `src/types/index.ts` (`CoachSessionProposal`)
- Modify: `src/services/planBuilder/planBuilderResponseSchema.ts`
- Modify: `src/services/week/prompts/weekPrompt.ts`
- Modify: `src/services/planBuilder/repairWeek.ts`
- Modify: `src/services/planBuilder/telemetryVersions.ts`
- Test: `src/services/planBuilder/__tests__/generateWeek.structuredOutput.test.ts`
- Test: `src/services/planBuilder/__tests__/squashNormalization.test.ts`
- Test: `src/services/planBuilder/__tests__/repairWeekPartnerWiring.test.ts`

**Pasos:**

- [ ] Agregar `squashKind` al contrato compacto y documentar sus cuatro valores
  en el prompt.
- [ ] Validar que toda sesión squash lo declare; mantener fallback compatible
  para respuestas viejas o truncadas.
- [ ] Sustituir la selección local duplicada por el hidratador compartido.
- [ ] Eliminar `inferSquashDesiredKind` y búsquedas de palabras equivalentes.
- [ ] Definir precedencia ante `squashDetails` detallado contradictorio: la
  intención estructurada reconstruye detalles y genera warning.
- [ ] Alinear título genérico sólo cuando el sistema lo creó; no reescribir copy
  explícito del usuario por substrings.
- [ ] Incrementar versiones de schema/repair y agregar telemetría de fallback,
  conflicto y pool insuficiente.
- [ ] Tratar la tasa alta de fallback `missing squashKind -> technical` como
  alerta de contrato/prompt; el fallback es resiliencia, no una ruta normal.
- [ ] Hacer pasar la regresión "control de longitud" como `technical/partner`.
- [ ] Correr los tests focalizados de Plan Builder y el set determinista de
  squash.

### Task A4 — Integrar Crear semana con skeleton v2

**Objetivo:** preservar la modalidad a través del borde compacto propio de
Crear semana.

**Archivos principales:**

- Modify: `src/services/weekCreator/weekCreatorSkeleton.ts`
- Modify: `src/services/weekCreator/weekCreatorSkeletonSchema.ts`
- Modify: `src/services/weekCreator/parseWeekCreatorSkeletonResponse.ts`
- Modify: `src/services/weekCreator/WeekCreatorSkeletonPromptBuilder.ts`
- Modify: `src/services/weekCreator/WeekCreatorLocalHydrator.ts`
- Modify: `src/services/weekCreator/weekCreatorContractStrategy.ts`
- Modify: `src/services/weekCreator/WeekCreatorEngine.ts`
- Tests: `src/services/weekCreator/__tests__/*Skeleton*`
- Test: `src/services/weekCreator/__tests__/WeekCreatorLocalHydrator.test.ts`
- Test: `src/services/weekCreator/__tests__/WeekCreatorEnginePhase3.test.ts`

**Pasos:**

- [ ] Versionar `WeekCreatorSkeleton` a v2 y agregar `squashKind`.
- [ ] Exigirlo para squash en parser/runtime y rechazarlo para otros deportes.
- [ ] Mantener `focusKey` como foco semántico, no identidad.
- [ ] Eliminar el mapeo de `focusKey` a subtype/modalidad de squash.
- [ ] Delegar al hidratador compartido antes de descartar el skeleton tipado.
- [ ] Aplicar las mismas invariantes a la ruta `detailed`.
- [ ] Mantener `WEEK_CREATOR_CONTRACT=detailed` como rollback.
- [ ] Actualizar tests de schema, parser, prompt, estrategia, engine e
  hidratación.

### Task A5 — Integrar creación individual por chat

**Objetivo:** que `add_session` y `update_session` no creen una quinta semántica.

**Archivos principales:**

- Modify: `src/types/index.ts` (`CoachAction`)
- Modify: `src/services/ai/prompt/core/outputContract.ts`
- Modify: `src/services/ai/promptBuilder.ts`
- Modify: `src/services/ai/responseNormalizer.ts`
- Modify: `src/services/ai/actionPostProcessor.ts`
- Modify, si corresponde: ejecutor de `add_session`/`update_session`
- Test: `src/services/__tests__/responseNormalizer.test.ts`
- Test: `src/services/__tests__/actionPostProcessor.test.ts`
- Test: `src/services/__tests__/CoachEngine.test.ts`

**Pasos:**

- [ ] Agregar `squashKind` a ambos contratos y a tipos/normalización.
- [ ] Exigirlo en runtime para nuevas sesiones squash.
- [ ] Hidratar localmente cuando el proveedor entrega sólo intención compacta.
- [ ] Preservar drills concretos pedidos por el usuario cuando son conocidos y
  compatibles.
- [ ] Emitir advertencia accionable ante un drill explícito incompatible; no
  reemplazarlo silenciosamente.
- [ ] Asegurar que convertir un `add_session` a `update_session` preserve la
  modalidad.
- [ ] Probar frases ambiguas y las cuatro modalidades.

### Task A6 — Integrar formulario manual y plantillas

**Objetivo:** hacer explícita la modalidad también cuando no participa IA.

**Archivos principales:**

- Modify: `src/components/session/SessionForm.tsx`
- Modify: `src/services/athlete/coachSessionSerializer.ts`
- Modify: `src/services/athlete/sessionTemplateSerializer.ts`
- Modify: `src/components/session/ExerciseLibraryBrowser.tsx` o filtro de
  catálogo equivalente
- Test: `src/components/session/SessionForm.test.tsx`
- Tests de serializers bajo `src/services/athlete/__tests__/`

**Pasos:**

- [ ] Reemplazar la etiqueta genérica de squash por el selector Modalidad:
  Control (solo), Técnico (con partner), Sombras y Partido.
- [ ] Separar el contexto práctica/competencia cuando se elige Partido.
- [ ] Filtrar los drills conocidos por modalidad.
- [ ] Persistir la elección en `squashDetails.sessionKind` y proyectar un
  `subtype` compatible.
- [ ] Para sesiones nuevas e históricas, advertir siempre ante drills conocidos
  incompatibles, permitir guardar y no borrar/reclasificar contenido.
- [ ] Aceptar ejercicios personalizados sin metadata bajo la modalidad elegida.
- [ ] Cubrir creación, edición y plantillas en tests.

### Task A7 — Verificación cruzada y rollout

**Objetivo:** comprobar paridad y desplegar con señales observables.

**Pasos:**

- [ ] Crear una matriz de integración con las cuatro modalidades por Plan
  Builder, Crear semana, chat y formulario.
- [ ] Afirmar para cada salida `sessionKind`, tipos de bloque y
  `executionMode`.
- [ ] Ejecutar tests focalizados, suite completa, typecheck y build.
- [ ] Revisar import/export de sesiones y backups con `mixed` histórico.
- [ ] Desplegar primero catálogo+hidratador, después los bordes versionados.
- [ ] Monitorear fallback por falta de `squashKind`, contradicciones y pools
  insuficientes.
- [ ] Ejecutar la simulación de control de 4, 8 y 12 semanas junto con quality
  review para detectar regresiones de capacidad.
- [ ] No eliminar compatibilidad heredada hasta que la telemetría muestre que
  los contratos nuevos son estables.

## Proyecto B — evento multijornada

### Task B0 — Fixtures de calendario

**Objetivo:** fijar semántica antes de tocar el shell.

**Casos mínimos:**

- evento de un día;
- evento lunes–domingo con día clave jueves;
- evento que cruza dos semanas calendario;
- hoy dentro del evento;
- hoy después del término;
- término anterior al inicio y día clave fuera de rango.

### Task B1 — Modelo y resolver único de ventana

**Archivos principales:**

- Modify: `src/types/index.ts` (`GoalEvent`, `MacroPlan`, markers)
- Create: `src/services/goalEventWindow.ts`
- Modify: `src/services/dataExport.ts`
- Modify: validadores/importadores de perfil y backup
- Test: `src/services/__tests__/goalEventWindow.test.ts`
- Test: tests de `dataExport`

**Pasos:**

- [ ] Agregar `GoalEvent.endDate?` y `GoalEvent.keyDate?`.
- [ ] Implementar resolver/validador inclusivo con fallback de evento de un día.
- [ ] Agregar campos de snapshot macro manteniendo `goalEventDate` compatible.
- [ ] Preservar campos en export/import y rechazar rangos inválidos.
- [ ] Confirmar que datos viejos no requieren migración material.

### Task B2 — Captura y presentación del rango

**Archivos principales:**

- Modify: `src/pages/CompetitionPlanPage.tsx`
- Modify: `src/utils/onboardingProfilePatch.ts`
- Modify: `src/hooks/useOnboardingForm.ts`
- Modify: `src/pages/OnboardingPage.tsx`
- Modify: `src/pages/PlanBuilderV2Page.tsx`
- Modify: `src/pages/PlanDashboard.tsx`
- Modify: `src/components/planBuilder/CycleHistory.tsx`
- Tests de páginas y componentes asociados.

**Pasos:**

- [ ] Capturar Inicio, Término y Día clave con validación inline.
- [ ] Mantener la creación simple de un día cuando término está vacío.
- [ ] Hacer que Onboarding preserve `endDate/keyDate` aunque inicialmente no
  exponga los controles avanzados.
- [ ] Mostrar rango y día clave en resumen, builder, dashboard e historial.
- [ ] Incluir las tres fechas en la firma del draft para evitar autoload stale.
- [ ] Preservar `endDate/keyDate` al editar desde cualquier superficie.

### Task B3 — MacroPlan, shell y ciclo

**Archivos principales:**

- Modify: `src/services/macroPlan.ts`
- Modify: `src/services/planBuilder/buildPlanShell.ts`
- Modify: `src/services/planBuilder/dateRange.ts`
- Modify: `src/services/planBuilder/planCycle.ts`
- Modify: `src/store/usePlanBuilderStore.ts` si requiere nueva firma/snapshot
- Test: `src/services/__tests__/macroPlan.test.ts`
- Test: `src/services/__tests__/planBuilder.test.ts`
- Test: `src/services/planBuilder/__tests__/planCycle.test.ts`

**Pasos:**

- [ ] Calcular countdown/taper contra inicio.
- [ ] Mantener `race` durante toda la ventana y `transition` sólo después del
  término.
- [ ] Hacer que el shell termine en `endDate` y que toda semana intersectada sea
  `race`.
- [ ] Exportar `resolveCompetitionPlanCalendarWindow` o moverla a un módulo
  compartido para que preview y shell usen la misma implementación; no forkear
  la lógica al agregar el rango.
- [ ] Usar `endDate` para cierre/CTA post-evento.
- [ ] Actualizar capacidad y truncamiento de última semana sin romper evento de
  un día.

### Task B4 — Prompt, fallback, repair y validación de semana de evento

**Archivos principales:**

- Modify: `src/services/week/prompts/weekPrompt.ts`
- Modify: `src/services/planBuilder/fallbackWeek.ts`
- Modify: `src/services/planBuilder/repairWeek.ts`
- Modify: `src/services/planBuilder/validator.ts`
- Modify: `src/services/planBuilder/qualityReview.ts`
- Tests focalizados bajo `src/services/planBuilder/__tests__/`

**Pasos:**

- [ ] Reemplazar reglas de "día de evento" por reglas de ventana inclusiva.
- [ ] Insertar un único ancla competitiva en `keyDate ?? startDate`.
- [ ] Evitar duplicar el ancla cuando el rango cruza semanas.
- [ ] Permitir máximo dos apoyos semanales compatibles dentro del evento.
- [ ] Impedir fuerza pesada, running de calidad, cycling de carga y match-play
  extra en toda la ventana.
- [ ] Aplicar caps de duración/RPE de activación, toque técnico y recuperación.
- [ ] Alinear repair, validator y quality review con el mismo resolver de
  ventana.
- [ ] Probar fallback determinista, no sólo respuestas del proveedor.

### Task B5 — Contexto de chat y resúmenes

**Archivos principales:**

- Modify: `src/services/ai/promptBuilder.ts`
- Modify: `src/services/ai/promptModules/shared.ts`
- Modify: `src/services/planGenerationSummary.ts`
- Modify: `src/services/weekCreator/WeekCreatorPromptBuilder.ts`
- Modify: `src/services/weekCreator/WeekCreatorLocalHydrator.ts`
- Modify: otros consumidores encontrados por búsqueda de `goalEventDate`.

**Pasos:**

- [ ] Mostrar rango, timing activo y día clave en contexto del coach.
- [ ] Evitar que el coach llame "post-evento" a un día dentro del campeonato.
- [ ] Pasar inicio, término, timing activo y día clave al prompt de Crear semana
  y resolver su fase local con la misma ventana.
- [ ] Actualizar copy de resumen y recomendaciones de semana race.
- [ ] Auditar todos los accesos directos a `.date`/`goalEventDate` y clasificarlos
  como inicio, término, ancla o display.

### Task B6 — Verificación y rollout

**Pasos:**

- [ ] Ejecutar la matriz B0 en macro, shell, validator, repair, fallback y UI.
- [ ] Ejecutar suite completa, typecheck y build.
- [ ] Probar manualmente evento de un día y multijornada desde creación hasta
  aceptación del plan.
- [ ] Verificar import/export de un backup viejo y uno con rango.
- [ ] Desplegar con lectura compatible; monitorear sesiones fuera de rango,
  anclas duplicadas y cargas prohibidas durante `race`.

## Proyecto C — ampliación de los otros pools (posterior)

Después de ampliar control en A1.5, crear un spec de contenido para técnico,
sombras y match con:

- cantidad objetivo de drills por modalidad y familia;
- nombres, instrucciones, duración/protocolo y progresión;
- modalidad de ejecución y requisitos de partner;
- revisión de lenguaje de cara al jugador;
- pruebas de rotación para planes de 4, 8 y 12 semanas.

Este proyecto no bloquea A2–A7 porque esos pools conservan capacidad suficiente
para la corrección. Cualquier ampliación debe mantener la prohibición de
`executionMode='either'`.

## Definition of done global

- [ ] Las decisiones de ancla y advertencia no bloqueante permanecen reflejadas
  en implementación y tests.
- [ ] No existe inferencia de modalidad desde prosa en ninguna superficie.
- [ ] Ninguna definición de drill usa `executionMode='either'`.
- [ ] El pool de control cumple la capacidad de A1.5 sin fallos de unicidad.
- [ ] Sombras tiene opciones ejecutables en taper.
- [ ] Las cuatro superficies comparten hidratador e invariantes.
- [ ] Eventos de un día mantienen comportamiento y compatibilidad.
- [ ] Eventos multijornada usan inicio para preparación y término para cierre.
- [ ] Crear semana y Onboarding preservan/entienden la ventana multijornada.
- [ ] Tests focalizados, suite completa, typecheck y build pasan.
- [ ] Telemetría y rollback están documentados antes de desplegar.

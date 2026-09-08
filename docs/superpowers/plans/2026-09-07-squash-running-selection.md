# Selección deportiva: contexto efectivo y dosis coherentes

Fecha: 2026-09-07. Estado: **E0–E3 y backlog implementados**; cierre local del 2026-09-08 documentado abajo.

Fuente: [audit de squash y running](../../reviews/2026-09-07-squash-running-library-audit.md) y revisión crítica aportada por el owner. El audit conserva la evidencia original; este documento define las entregas y sus límites.

## Estado al cierre del 2026-09-08

E0–E3 y el backlog separado están implementados por instrucción posterior del owner. La idempotencia semanal pendiente en E1 está corregida. Los baselines E0/E1 se conservan; el probe vigente apunta a E3.

Ver [cierre de implementación, decisiones, pruebas y límites](../../reviews/2026-09-08-squash-running-implementation.md). Las descripciones de defectos y tablas de «predicado actual» más abajo son el diagnóstico de partida, no el comportamiento final.

## Decisión de alcance

Alcance original: corregir selección, dosificación y materialización de los contenidos existentes. El owner amplió explícitamente el alcance a la ampliación del catálogo, el catálogo manual de running y el modelo de aprendizaje de squash. Estas entregas también se implementaron; su trazabilidad está en el cierre enlazado arriba.

La crítica es acertada en exigir trazabilidad por ruta, regresiones reproducibles y separación de proyectos. Se ajustan cuatro puntos:

- Historial ejecutado y fallback de fase son fixes acotados: van antes de la captura de nuevos datos de perfil.
- R3 y R4 se trabajan juntos como política de continuidad/intensidad, pero mantienen pruebas independientes. Que el scoring amortigüe una plantilla no garantiza que nunca pueda seleccionarse.
- E1 necesita bloques y recuperaciones computables. La identidad persistida puede esperar; el contrato mínimo de dosis no puede esperar hasta E3.
- «Cambiar una entrada cambia la salida» se sustituye por «cambia elegibilidad o dosis cuando corresponde». Un input irrelevante debe dejar la salida estable; repetir base aeróbica puede ser correcto.

Una segunda revisión sobre el código incorporó tres correcciones más, todas verificadas con archivo y línea: la extensión de tipos que E1 necesita deja de estar reservada a E3, la aceptación de E1 depende de una tabla de mínimos que hay que publicar, y el historial ejecutado tiene cuatro estados y cinco productores, no un filtro en el selector. Están integradas en las entregas correspondientes.

No se modifica el orden del roadmap con esta propuesta. Legal sigue siendo el P0 del piloto. Se recomienda completar E0, E1 y E2a antes de utilizar la generación automática con el primer cliente; E2b–E3 pueden entregarse después. La prioridad interna del audit no implica una nueva clasificación P0 de negocio.

## Restricciones de implementación

- Tests y fixtures locales, sin proveedor IA. El saldo registrado en `CLAUDE.md` es histórico, no una comprobación de saldo actual.
- Respetar el orden congelado de fuerza en `repairGeneratedWeek`; no mover sesiones de fuerza después del allocator del paso 6.
- Reutilizar la autoridad de restricciones y carga existente; no crear un segundo motor semanal.
- Mantener athlete scope, cuotas, aceptación atómica y finalizadores existentes.
- No recalcular ni sobrescribir sesiones completadas o manuales como efecto de una actualización de catálogo.
- No hacer commits, deploy ni migraciones remotas en estas entregas sin una instrucción específica del owner.
- Los archivos citados abajo describen la planificación original; el informe de cierre identifica los módulos implementados.

## E0 — Baseline reproducible y alcance por ruta ✅

**Dependencias:** ninguna. **Riesgo:** bajo. **Estado: entregada el 2026-09-07.**

Resultados, clasificación por hallazgo y límites en
[`2026-09-07-squash-running-route-map.md`](../../reviews/2026-09-07-squash-running-route-map.md).
Artefacto congelado en `docs/reviews/fixtures/squash-running-selection/`;
`npm run probe:selectors:check` falla si el comportamiento se mueve. Gate local
ejecutado: lint OK, 4890/4891 tests (la falla es el timeout esporádico conocido
del allocator de fuerza, que pasa aislado), build OK, `git diff --check` limpio.

Lo que E0 cambió respecto de lo que este plan suponía:

- **S1 vive en el chat, no en Plan Builder.** Por chat, una sesión de squash de
  30 min declarados contiene 52 min de drills; por la ruta de repair el mismo
  pedido sale cuadrado.
- **R6 y R7 sólo se alcanzan en fase `base`.** En `build`, `peak` y `taper` con
  squash primario, `normalizeSquashSupportAerobicLoad` fuerza `z2` y recorta la
  duración antes de materializar.
- **S6 no se reprodujo** con ninguno de los seis casos: cero violaciones de fase
  sobre la salida. El camino existe en el código; falta la entrada que lo dispare.
- **R4 reproducido, con una corrección**: la expulsión del rodaje fácil no
  escala la intensidad (la salida fue siempre `low`). El daño es monotonía, no
  carga.
- **Tres hallazgos nuevos** (N1 nota que contradice el bloque, N2 tres
  productores de estructura de running, N3 el repair agrega sesiones).
- **Week Creator quedó sin ejercitar**: es el hueco declarado de E0.

Mapa inicial confirmado por lectura; falta verificar la salida persistida con fixtures:

| Ruta | Puntos confirmados | Qué debe demostrar E0 |
|---|---|---|
| Chat | `runningPrompt.ts` selecciona para el prompt; `actionPostProcessor.ts` hidrata squash y tiene `completeRunningZone2Details` | Distinguir recomendación en prompt de contenido ejecutado para altas y actualizaciones; seguir hasta su escritura real |
| Plan Builder | `generateWeekCore.ts` y `generateWeek.ts` llaman a `repairGeneratedWeek`; `completeRunningDetails` selecciona running; `commitPlan.ts` acepta vía `applyCreateWeek` | Cubrir ruta activa, compatibilidad y fallback; comparar preview y sesión guardada |
| Week Creator | `WeekCreatorLocalHydrator.ts` y `WeekCreatorEngine.ts` llaman a `repairGeneratedWeek` | Cubrir skeleton y respuesta completa; comprobar idempotencia cuando se repara dos veces y seguir aceptación |

No basta contar tres llamadas al hidratador y dos al selector: existen estructuras provistas que evitan la hidratación, reparaciones repetidas y caminos legacy.

- [x] Crear `scripts/probe-selectors.mjs` con Vite SSR, cierre del servidor en `finally`, fecha fija, orden estable y cero llamadas de red.
- [x] Versionar fixtures y JSON esperado bajo `docs/reviews/fixtures/squash-running-selection/`; registrar revisión Git, cambios locales relevantes y SHA-256 de entradas/salidas normalizadas. Un hash acredita integridad, no corrección.
- [x] Cubrir duraciones 15/20/30/45/60, fases, fatiga baja/alta, nivel, perfil deportivo, compañero e historial. Usar casos dirigidos y pares relevantes; evitar un producto cartesiano innecesario.
- [x] Añadir completed/planned/skipped, fecha futura, múltiples drills de una familia en una sesión, dos rodajes fáciles consecutivos y pool vacío tras restricciones.
- [x] Capturar selección, dosis, total, objetivos, advertencias y procedencia; marcar duración desconocida explícitamente.
- [~] Respuestas sintéticas del proveedor en **dos** de las tres rutas (chat y Plan Builder), hasta la acción post-procesada y la semana reparada, **no** hasta la persistencia local. Week Creator sin ejercitar. Clasificación por hallazgo completa en el mapa de rutas.
- [x] Fijar los comportamientos actuales como caracterización. En cada entrega posterior escribir primero la expectativa corregida y comprobar que falla por el defecto concreto.

**Aceptación:** dos ejecuciones sobre las mismas entradas producen el mismo resultado normalizado; cada regresión relevante tiene input exacto y ruta identificada. No presentar el probe de selector como prueba de calendario.

## E1 — Duración y objetivos por bloque

**Dependencias:** E0. **Cubre:** S1, R7, R8 y contrato mínimo de R6. **Riesgo:** medio.

**Archivos principales:** `training/squashSessionHydrator.ts`, `training/drillSelector.ts`, `planBuilder/repairWeek.ts`, tipos de bloques en `src/types/index.ts`; módulos nuevos propuestos `training/sessionTimeBudget.ts` y `training/runningSessionMaterializer.ts`. Cablear también los bordes de chat y Week Creator identificados en E0.

### Decisión de unidad y persistencia

El modelo persistido no puede expresar hoy lo que esta entrega promete, así que la extensión de tipos entra en E1 y deja de estar reservada a E3:

- `RunningIntervalBlock` (`src/types/index.ts:256`) tiene `label`, `repetitions`, `durationMin`, `distanceKm`, `targetPace`, `targetHrMax` y `notes`. **No tiene campo de recuperación** —hoy «recupera 2-3 min trotando» viaja como texto libre en `notes`— ni distingue valor por repetición de valor total. Un bloque `repetitions: 4, distanceKm: 0.8` no tiene duración computable sin ritmo.
- Squash y running persisten en minutos enteros (`SquashDrill.durationMin`, `SquashSessionBlock.durationMin`). `durationSec` existe sólo en ejercicios de fuerza (`src/types/index.ts:208`), así que un residuo menor a un minuto no es representable en el bloque guardado.

**Decisión:** el presupuesto **calcula** en segundos y **persiste** en la unidad del bloque, con extensión aditiva y lectura tolerante. Alternativa descartada: acotar E1 a squash y a running por tiempo, dejando las series por distancia con duración estimada hasta E3 — se descarta porque excluye justamente los `intervals` que R6 señala, que son el caso que hoy se materializa mal.

- [x] Extender `RunningIntervalBlock` de forma aditiva: recuperación explícita entre repeticiones y marca de valor por repetición frente a total. Campos opcionales; un bloque legacy sin ellos se lee sin perder contenido y su recuperación en `notes` se conserva tal cual, sin reinterpretar el texto. Registrar el impacto en `dataExport.ts` y en `athlete/sessionTemplateSerializer.ts`.
- [x] Publicar la tabla literal de duración mínima ejecutable por deporte y modalidad (squash: technical, control, shadows, match; running: por familia). Es el predicado del que depende la aceptación: sin ella «factible» no es comprobable y cualquier fallo del total puede reclasificarse como sesión inviable.
- [x] Definir semántica común en segundos: calentamiento + trabajo + recuperaciones + cierre. Aclarar si duración/distancia es por repetición; contar descansos entre repeticiones sin añadir automáticamente uno después de la última.
- [x] Diferenciar tiempo prescrito de estimación. Distancia sin ritmo no tiene duración exacta; no asignarle cero ni inventar ritmo para cerrar una suma. Preferir bloques por tiempo cuando el límite sea de tiempo y falten datos.
- [x] Dosificar squash por presupuesto y mínimos ejecutables, con número de drills subordinado al tiempo. Evitar contar dos veces calentamientos ya incluidos en protocolos de partido.
- [x] Extraer la materialización de running a una función pura y explicitar recuperaciones. Corregir el mínimo de tempo que convierte 20 minutos en 25.
- [x] Separar objetivos de trabajo y de entrada/cierre; con perfil incompleto usar esfuerzo descriptivo, sin ritmos ni frecuencias absolutas presentadas como personalización.
- [x] Añadir comprobación compartida después de la última mutación y antes de aceptar las propuestas en las tres rutas, incluyendo estructuras ya provistas. Reparar localmente o devolver incompatibilidad visible; no disparar reintentos pagados para corregir aritmética.

**Aceptación:** para sesiones por tiempo que la tabla de mínimos declara factibles en 20/30/45/60 minutos, el total calculado queda dentro de ±60 segundos por redondeo, sin exceder un máximo explícito del usuario, y el bloque persistido conserva ese total dentro del redondeo de su propia unidad. Si no caben dosis mínimas, devolver alternativa o imposibilidad explícita **según esa tabla**; no deformar el estímulo. Un bloque legacy sin los campos nuevos se sigue leyendo y produce el mismo contenido que antes de la entrega. Sin minutos negativos, descansos ocultos ni calentamiento que copie automáticamente el ritmo de umbral. Los partidos por puntuación declaran duración estimada; no prometen exactitud ficticia. Doble reparación produce el mismo contenido.

**Límite:** hasta E3 las plantillas complejas todavía pueden perder fidelidad. E1 debe reportar esa limitación y no adjudicarles una identidad canónica si los bloques no corresponden.

## E2a — Historial válido y restricciones conservadas

**Dependencias:** E0; puede implementarse antes de E1 si sus fixtures ya están disponibles. **Cubre:** S2, S6 y parte de S3/S7. **Riesgo:** bajo a medio.

**Archivos:** `training/drillSelector.ts`, `squashWeekPlanner.ts`, `training/runningSelector.ts` y los cinco productores del historial listados abajo (`pages/SettingsPage.tsx`, `store/useTrainingStore.ts`, `pages/ChatCoach.tsx`, `store/useCoachActionsStore.ts`). Crear helper compartido sólo para el contrato efectivamente común.

- [x] Separar exposición planificada de ejecución real. El plan semanal puede evitar duplicaciones previstas; no puede tratarlas como progreso logrado.
- [x] Definir el predicado de ejecución sobre los **cuatro** estados de `SessionStatus` (`planned | completed | adjusted | skipped`, `src/types/index.ts:188`). `adjusted` es ejecución real y `skipped` no lo es: «filtrar completed» no alcanza y deja fuera sesiones efectivamente realizadas.
- [x] Unificar los productores del historial detrás de ese predicado. Hoy conviven cinco definiciones distintas, así que corregir sólo el selector deja que el defecto vuelva a entrar por el store:

| Productor | Predicado actual | Qué admite de más |
|---|---|---|
| `SettingsPage.tsx:1630` | `completed \|\| adjusted` | nada — es el correcto |
| `useTrainingStore.ts:303` | `status !== 'planned'` | `skipped` |
| `ChatCoach.tsx:248` | `status !== 'planned' \|\| date < hoy` | planificadas vencidas |
| `useCoachActionsStore.ts:127` | sin filtro | todo, incluidas futuras |
| `runningSelector.ts:371` | filtro propio dentro del selector | duplica la autoridad |

- [x] Aplicar el filtro con fecha de referencia explícita, anterior a la sesión objetivo; preservar orden determinista y scope del atleta.
- [x] Contar una familia como máximo una vez por sesión para frecuencia. No rediseñar todavía la taxonomía de familias.
- [x] Mantener fase, fatiga, ejecución y restricciones en todos los fallbacks. Revisar también running: hoy su fallback vuelve a `byFatigue`, descartando filtros posteriores.
- [x] Definir resultado de pool vacío y propagarlo a consumidores; no seleccionar una entrada global incompatible.
- [x] Revalidar las restricciones después de la rotación semanal.

**Aceptación:** planned/skipped y registros futuros no alteran progresión, y `adjusted` sí cuenta como ejecutado; unos y otros pueden informar planificación por su canal propio. Los cinco productores comparten el predicado y ninguno lo vuelve a definir por su cuenta. Múltiples drills de una familia no simulan múltiples sesiones. Ningún fallback reabre un veto. Cubrir tanto modalidad explícita como genérica.

## E2b — Contexto efectivo y continuidad del running de apoyo

**Dependencias:** E1 y E2a. **Cubre:** S5, R1, R3, R4; integración acotada de R2/R9. **Riesgo:** medio.

**Archivos:** `CompetitionPlanPage.tsx`, tipos/configuración de perfil, `squashPrompt.ts`, `runningPrompt.ts`, productores de Week Creator, `repairWeek.ts`, ambos selectores y serializadores correspondientes.

- [x] Usar como primera entrega la disponibilidad por defecto del plan/perfil, porque ya existe `planWizardConfig.partnerAvailability`. Capturar solo/partner/either y explicar que either significa disponibilidad flexible, no compañero confirmado. Mantener undefined como dato desconocido para compatibilidad. El override por sesión y rol alimentador se completaron con el backlog autorizado.
- [x] Probar captura → persistencia → recarga → contexto → selección → calendario. Lectores existentes no equivalen a un productor funcional.
- [x] Inventariar productor y consumidor de duración, nivel, frecuencia y carga semanal de running. Conectar sólo fuentes reales; documentar precedencia entre duración pedida y configuración general. Retirar campos internos sin propósito definido tras revisar compatibilidad.
- [x] Evitar que la recencia excluya rodajes fáciles necesarios en sport_support. Establecer techo explícito de intensidad antes del scoring, con tabla de casos por propósito/fatiga/fase; probar moderate-high además de high.
- [x] Hacer que progress/hold/deload tenga efecto verificable en dosis dentro del presupuesto, sin progresar por mera repetición.
- [x] Transmitir decisiones existentes de restricciones y sesiones vecinas. Si la autoridad actual no representa impacto de running, registrar ese límite y especificar la extensión antes de declarar R9 resuelto; no extrapolar automáticamente reglas de fuerza.

**Aceptación:** dos rodajes fáciles no expulsan easy_aerobic por recencia; una preferencia de variedad no supera restricciones. Menor disponibilidad reduce dosis o cambia elegibilidad cuando corresponde. Cambiar un dato irrelevante mantiene estabilidad. Sin datos suficientes no se fabrica experiencia ni carga realizada.

## E3 — Identidad y fidelidad de las plantillas de running

**Dependencias:** E1–E2b. **Cubre:** R5, R6 y parte restante de R4. **Riesgo:** alto por persistencia y consumidores.

**Archivos:** `training/runningSessionLibrary.ts`, `training/runningSelector.ts`, materializador de E1, `src/types/exerciseLibraryRef.ts`, tipos de running, `dataExport.ts`, `athlete/sessionTemplateSerializer.ts`, normalizadores y conversores identificados en E0.

- [x] Añadir ID/versión al resultado del selector y bloques tipados a las 27 plantillas existentes; las cuatro altas adicionales pertenecen al backlog autorizado.
- [x] Materializar desde esos bloques: 400 m sigue siendo 400 m, cuestas conservan su estructura y umbral fraccionado conserva sus pausas.
- [x] Persistir referencia de plantilla a nivel de sesión/detalles de running. Extender `running_template` sólo tras revisar todos los switches/allowlists de `ExerciseLibraryRef`; una plantilla de sesión no es un ejercicio de pesas.
- [x] Derivar familia desde ID conocido; conservar inferencia textual únicamente como compatibilidad de registros legacy, sin inventar procedencia exacta.
- [x] Probar guardar/cargar, sync, backup/import, plantilla reutilizable y preview/aceptación. Mantener dosis prescrita separada de resultados realizados.
- [x] Determinar necesidad de migración a partir del esquema y serialización reales, ahora sólo para la identidad persistida (ID y versión): la forma de los bloques y su recuperación ya se extendieron en E1. No afirmar «sin migraciones» sólo porque parte de la sesión viaje como JSON.

**Aceptación:** renombrar o traducir título no cambia familia; ID, versión y bloques sobreviven round-trip; una sesión manual sin plantilla sigue siendo válida. Todas las plantillas tienen prueba de materialización. Duración, objetivos e idempotencia de E1 permanecen verdes.

## Regresiones y cierre por entrega

Suites existentes que revisar antes de modificar expectativas:

- `training/__tests__/squashSessionHydrator.test.ts`, `services/__tests__/squashWeekPlanner.test.ts`, `services/__tests__/runningSelector.test.ts` y `runningPrompt.test.ts`.
- `planBuilder/__tests__/repairWeek*.test.ts`, `squashModalityBoundaryMatrix.test.ts`, `squashNormalization.test.ts`, `squashWeeklyExposureRepair.test.ts`, `deterministicPrimarySquashPlan.test.ts`; también `services/__tests__/repairWeek.test.ts`.
- `services/__tests__/actionPostProcessor*.test.ts`, suites de Week Creator y aceptación/persistencia local identificadas en E0.
- `types/__tests__/exerciseLibraryRef.test.ts`, `services/__tests__/dataExportLibraryRef.test.ts` y `athlete/__tests__/sessionTemplateSerializer.test.ts` para E3.

La lista identifica superficies de regresión; no afirma que todos sus snapshots deban cambiar. Inventariar snapshots reales en E0. Nunca actualizar expectativas masivamente para hacer pasar la suite: cada diferencia debe corresponder a un criterio de esta entrega. Conservar baseline original y registrar deltas esperados.

Cada entrega sigue: caso rojo específico → cambio mínimo → prueba focalizada → fixtures por ruta → gate local. Al cerrar cambios funcionales: `npm run lint`, `npm test`, `npm run build` y `git diff --check`; build ya ejecuta TypeScript. Registrar resultados reales, riesgos residuales y archivos afectados. Verificación con proveedor/producción queda separada de los tests locales y se documenta como pendiente hasta ejecutarla.

## Backlog separado — implementado por ampliación de alcance

| Hallazgo | Entrega completada |
|---|---|
| S3 | Familia técnica separada de modalidad; progresión condicionada a resultados/aciertos y esfuerzo |
| S4 | Intención técnica, lado, meta y resultados medibles en formulario y persistencia |
| S5 | Override por sesión, entrenador/alimentador, cancha y material |
| S7 / R2 | Consumo de autoridad semanal de squash; presupuesto compartido de running de apoyo y sesiones vecinas |
| R9 | Restricción de impacto explícita y adaptación conservadora de restricciones estructuradas a selección/aceptación |
| R10 | Selector manual de plantillas con preview y comprobación de dosis |
| Ampliaciones S/R | 16 drills de squash y 4 plantillas de running; adaptación de run-walk y técnica |
| Explicación visible | Motivos y contexto técnico en tarjetas; incompatibilidades visibles |

Ver las pruebas y límites del [informe final](../../reviews/2026-09-08-squash-running-implementation.md). Los huecos históricos de E0 se cubren con pruebas locales de Week Creator y persistencia; no se reescribe el baseline antiguo como si ya hubiera ejercitado esas rutas.

# Entrenador App - Review and Roadmap

Actualizado: 2026-05-01

## Resumen ejecutivo

El roadmap anterior estaba demasiado largo y ya mezclaba trabajo cerrado con trabajo pendiente. Hoy la base del producto ya es claramente usable:

- app React + TypeScript + Vite con superficies reales de semana, día, chat, onboarding, competition plan, import y settings
- local-first con Dexie + Zustand + sync a Supabase
- auth con Supabase + Google OAuth
- coach con proposals persistidas, aplicables y reversibles
- macroplan, analytics de carga, nutrición contextual y weekly loop visibles
- plan builder separado del chat
- Plan Builder V2 con capa de repair pre-validación, prompts mínimos y telemetría de generación
- `week_creator` ya operativo y enrutable desde chat
- `responseNormalizer` ya recupera `add_session` incompletos cuando faltan campos reparables

La lectura honesta hoy es esta:

- el producto ya no está en fase prototipo
- Plan Builder ya no depende de que el modelo devuelva semanas perfectas
- el mayor riesgo técnico sigue siendo sync/convergencia
- el mayor vacío de producto sigue siendo observabilidad, medición de utilidad y cierre del loop de activación
- monetización todavía no existe como sistema real

## Ya implementado y fuera del backlog principal

Esto ya existe en código y no debería volver como bloque grande:

- chat del coach con proposals ejecutables
- athlete profile estructurado y persistido
- onboarding guiado
- wizard de plan de competencia
- `plan_builder_redirect` desde chat para planes largos
- Plan Builder V2 Fase 1: prompt minimal, repair local y validación post-repair
- repair de semanas generadas: fechas inválidas, sesiones fuera de semana, días no permitidos, colisiones, deportes no permitidos, detalles faltantes y balance de conteo
- selectors deportivos integrados en repair para squash, running, strength, mobility y cycling
- telemetría de repair persistida en `generationMeta`: reparadas, movidas, fallback, filtradas y warnings
- estrategia de generación configurable con default `single`, `pairs` explícito y modo `auto`
- `week_creator` como flujo separado para crear una sola semana
- guardrails recientes para que `chat_action` no emita `create_week`
- defaults conservadores en week creator cuando el perfil viene incompleto
- validación de deportes permitidos en planning flow
- macroplan V2 con timeline y sport details
- ACWR e insights por disciplina principales
- nutrición contextual estructurada compartida entre dashboard, día y chat
- notifications + weekly action loop + alertas accionables
- backup/import/export

## Pendiente real por prioridad

### Crítico

1. Blindar `syncService` y mantener build verde.
   Estado actual:
   - `build` volvió a estar en verde.
   - Plan Builder V2 también compila con `npm run build`.
   - sync sigue siendo el riesgo principal para beta multi-dispositivo, pero ya no por un rojo inmediato de compilación.
   Falta:
   - revalidar convergencia entre desktop/móvil y colas retenidas
   - documentar mejor deletes, tombstones y recovery

2. Validación operativa real de sync.
   Falta:
   - pruebas manuales y semi-automatizadas de conflictos concurrentes
   - mejor UX cuando la cola queda atascada o hay divergencia
   - decidir si realtime es realmente necesario para beta o si recovery actual alcanza

### Alto

1. Medición del loop coach -> propuesta -> aceptación -> impacto.
   Ya existe:
   - proposals persistidas
   - alertas accionables
   - weekly action loop
   Falta:
   - instrumentación visible para saber qué CTA se usan
   - aceptación/rechazo por tipo de propuesta
   - trazabilidad de reactivación y retención semanal

2. Cerrar mejor automatización del weekly loop.
   Falta:
   - disparar ajustes más directos desde alertas y feedback real
   - usar `sessionFeedback` y `DayLog` para proponer cambios más prescriptivos
   - medir qué alertas realmente generan retorno al producto

3. Verificación manual end-to-end de los flows nuevos de planificación.
   Ya existe:
   - `week_creator`
   - redirect a plan builder
   - guardrails de `create_week`
   - hardening de `add_session` en `responseNormalizer` para no perder propuestas reparables
   - Plan Builder V2 Fase 1 con repair local y métricas de salud de generación
   Falta:
   - QA manual de usuario nuevo sin perfil completo
   - QA de chat_action para asegurar que no cree semanas y que sí persista `add_session` reparados
   - QA del redirect a plan builder para requests de plan largo
   - QA de generación real en UI revisando repair telemetry en semanas generadas
   - resolver decisión de prompt genérico: hoy un test espera omitir `MACRO PLAN`, pero el prompt actual lo incluye

### Medio

1. Seguir desacoplando piezas grandes y sensibles.
   Foco:
   - `syncService`
   - bloques puros del prompt builder / lógica del coach
   - helpers de contexto selector en Plan Builder repair si empieza a crecer

2. Convertir analytics en decisiones, no solo visualización.
   Falta:
   - más traducción de macroplan y carga a sugerencias concretas
   - umbrales refinados con uso real
   - mejor lectura de tendencias, no solo snapshots

3. Afinar disciplina-specific coaching en bordes.
   Foco:
   - squash competitivo
   - cycling
   - mobility
   - nutrición en días mixtos o conflictivos

4. Tests focalizados de UI en superficies críticas.
   Foco:
   - SessionCard expandido
   - WeeklyView / ProposalDrawer
   - estados visibles del sync

### Bajo

1. Packaging comercial.
   Falta:
   - narrativa de plan pago
   - definición premium/free
   - valor empaquetado de nutrición y coach

2. Monetización real.
   Falta:
   - billing
   - paywall
   - entitlements
   - tracking de conversión

3. Refinamientos futuros no urgentes.
   Ejemplos:
   - más riqueza semántica en squash (`sessionFamily` u otra taxonomía) solo si aparece un límite real
   - más profundidad cuantitativa para cycling
   - mejoras cosméticas o de copy en settings y superficies secundarias

## Estado por área

### Planificación y coach

Estado: fuerte

- propuestas ejecutables y persistidas
- chat, week creator y plan builder ya están desacoplados
- macroplan y semana ya conversan razonablemente bien
- el normalizador ya es más tolerante a respuestas parciales del modelo en `add_session`
- Plan Builder V2 repara localmente respuestas parciales antes de validar
- WeekCreator y Coach Chat siguen usando schema completo; Plan Builder usa schema minimal
- batch pairs usa prompt minimal y degrada a single cuando el batch falla

Pendiente:

- más automatización desde alertas y feedback
- más medición de aceptación y utilidad real
- QA manual con modelos reales y semanas largas
- decidir si las métricas de repair se muestran como UI visible o quedan como metadata técnica

### Sync

Estado: sensible

- la arquitectura existe
- el riesgo principal sigue abierto

Pendiente:

- endurecer pruebas y recovery de sync más allá del build verde actual
- validar convergencia real y recovery duro

### Nutrición contextual

Estado: fuerte

- ya es capa de producto real, no texto genérico

Pendiente:

- medir impacto en engagement y retención
- decidir rol comercial dentro del producto pago

### Monetización

Estado: pendiente

- no hay sistema real todavía

## Próximos pasos recomendados

1. Hacer una ronda corta de QA manual de `chat_action` + `week_creator` + redirect a Plan Builder V2, incluyendo casos de `add_session` reparado y semanas con repair telemetry.
2. Decidir y corregir el contrato de prompt genérico respecto a `MACRO PLAN` para recuperar suite completa verde.
3. Agregar instrumentación mínima para proposals, alertas, generación de planes, repair telemetry y aceptación.
4. Validar sync en escenarios de conflicto y recovery multi-dispositivo.
5. Recién después abrir trabajo comercial de billing/paywall.

## Plan Builder V2 — Generación robusta

### Fase 1 — Repair pre-validación — completada

Objetivo cumplido: pasar de “el modelo debe generar una semana perfecta” a “el modelo genera intención semanal compacta y la app completa/repara antes de validar”.

Implementado:

- Prompt minimal para Plan Builder single-week.
- Prompt minimal para generación batch/pairs.
- Schema completo conservado para `WeekCreatorPromptBuilder` y Coach Chat.
- `repairGeneratedWeek()` como capa pre-validación.
- Reparación de fechas inválidas, sesiones fuera de semana, días no permitidos y colisiones.
- Respeto de `allowDoubleSession=false` al resolver colisiones.
- Filtrado de deportes no permitidos.
- Hidratación de detalles con selectors existentes:
  - `selectSquashDrills`
  - `selectRunningSession`
  - `selectStrengthSession`
  - `selectMobilitySession`
  - `selectCyclingSession`
- Balance de conteo con recorte priorizado y fallback máximo de 2 sesiones.
- `count_mismatch` post-repair como warning si la diferencia es menor o igual a 1; error si es mayor.
- Post-repair solo `severity: error` es retryable.
- Telemetría propagada a `TrainingPlanWeek.generationMeta`.
- Strategy default `single`, con `pairs` explícito y `auto` para planes largos.

Validación automatizada:

- `npm run build`: verde.
- `npm test -- --run src/services/__tests__/repairWeek.test.ts src/services/__tests__/planBuilder.test.ts src/store/__tests__/usePlanBuilderStore.test.ts`: verde, 37 tests.
- `npm test`: 368/369 tests verdes. Falla pendiente ajena a Plan Builder V2: `promptBuilderContextReduction.test` espera que chat genérico no incluya `MACRO PLAN`, pero el prompt actual sí lo incluye.

Pendientes menores de Fase 1:

- Decidir si exportar los schema blocks o mantenerlos privados.
- Centralizar helpers de contexto selector si `repairWeek.ts` sigue creciendo.
- Ampliar `repairWeek.test.ts` hacia los 14 casos propuestos originalmente si se quiere cobertura más granular.
- Hacer QA manual de UI con modelos reales revisando las métricas de repair.

### Fase 2 — Observabilidad y ajuste fino — pendiente

Foco recomendado:

- Mostrar repair telemetry de forma comprensible en UI o panel debug.
- Métricas por generación: ratio de sesiones reparadas, movidas, filtradas y fallback.
- Diagnóstico de repair en retry instructions solo si producción muestra patrones repetidos.
- Separar `repairDiagnostics.ts` si la metadata empieza a crecer.
- Medir si el prompt minimal mejora tasa de éxito, latencia y costo frente al schema completo.

## Plan de estabilización del Coach

### Fase 1 — Estabilización del flujo chat — completada

- Propagar respuestas truncadas desde backend a `responseNormalizer` con `meta.likelyTruncated`.
- Endurecer `extractInlineActionsJson` para preferir bloques `<actions>` y evitar capturar JSON ajeno.
- Mostrar warnings cuando `create_week` dropee sesiones inválidas.
- Evitar reintentos de formato cuando el modelo respondió coherentemente sin acciones.
- Endurecer parsing de chunks SSE corruptos sin cortar todo el stream.
- Mover el lock visual de envío antes de persistir el mensaje de usuario.

### Fase 2 — Propuestas y sync — completada

- Hacer `acceptProposal` idempotente frente a doble click con guard local y mutex en store.
- Reforzar `coach_proposals` en sync: Tier B, serialización por entidad y tombstones de borrado.
- Decisión explícita: `coach_proposals` es durable; `chat_messages` queda efímero/Tier C en multi-device.

### Fase 3 — Routing e intención — completada

- Unificar detectores de intención de chat en un solo módulo testeado.
- Cubrir frases reales de `chat_general`, `chat_action`, `week_creator` y redirect a plan builder.
- Eliminar heurísticas literales poco probables en `inferCoachActionIntent`.

### Fase 4 — UX y bordes operativos — completada

- Mejorar experiencia de usuario nuevo con perfil incompleto antes de generar semana.
- Persistir auto-submit keys del plan builder en `sessionStorage`.
- Refinar falsos positivos de detección deportiva en notas y memoria.
- Seguir desacoplando bloques puros de `promptBuilder` y superficies sensibles de `syncService`.

## Nota de revisión

Este roadmap intencionalmente deja fuera features ya cerradas. La prioridad real ya no es “sumar más módulos”, sino volver confiable, medible y operable lo que ya existe.

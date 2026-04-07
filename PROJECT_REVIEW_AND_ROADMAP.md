# Entrenador App - Review and Roadmap

Actualizado: 2026-04-07 (progresión multi-semana Fase 2 de squash y fuerza — implementada)

## Estado actual del producto

Entrenador ya es un producto early-stage usable, no solo un prototipo. Hoy la app ya entrega valor real para atletas híbridos y tiene una base suficientemente sólida para iterar hacia algo vendible.

Estado resumido:

- planificación semanal, vista diaria, historial y ajustes ya operativos
- coach AI con propuestas ejecutables y mejor contexto deportivo
- perfil estructurado del atleta con multi-deporte, prioridades, running, fuerza, recuperación, disponibilidad y nutrición
- onboarding de 4 pasos para configurar deporte principal, objetivo y disponibilidad
- dashboard con contexto útil: próximas sesiones, carga por disciplina, nutrición, sync y macroplan
- sync multi-dispositivo, backup/import-export y recuperación offline ya implementados
- MVP de macroplan por evento principal ya activo: fase, semanas restantes y foco del bloque

## Lo que ya está implementado

No debería volver a aparecer como backlog principal:

- coach con chat multi-sesión, streaming y proposals persistidas
- especialización modular por deporte habilitado
- lectura de fatiga, taper competitivo y contexto híbrido multi-deporte
- athlete profile estructurado persistido en ajustes
- onboarding wizard + guard para usuarios nuevos
- nutrición integrada al coach y visible en UI
- analytics de carga por disciplina en dashboard + prompt
- sync base con Supabase, Google OAuth, cola pendiente y recovery offline visible
- endurecimiento reciente de sync: dedupe por clave natural en `dayLogs`/`weekSummaries`, tombstones de delete para `sessions`, compactación de cola, reintento automático al volver online/foco y mejor clasificación de errores (`offline` vs `error`)
- backup JSON con preview, merge/replace y validación
- borrado selectivo de entrenamientos creados por el coach
- reset total local + nube para reiniciar el usuario desde cero cuando el sync quedó contaminado o se quiere limpiar todo el entorno
- macroplan MVP por evento principal con awareness del coach vía prompt
- primera versión de `Plan Builder` separada del chat: ruta propia, inputs guiados base y handoff al coach con prompt estructurado
- ACWR (Acute:Chronic Workload Ratio) calculado en `loadAnalytics.ts` y visible en dashboard con semáforo verde/amarillo/rojo
- nutrición personalizada al perfil: hidratación calculada desde peso del atleta, proteína objetivo según carga del día, notas dietéticas del perfil visibles en UI
- sync eliminado del dashboard — visible solo en Ajustes donde tiene acciones disponibles
- nudge de perfil incompleto en dashboard: detecta qué faltan (ritmos, 1RMs) y navega a Ajustes
- **wizard "Plan de competencia"** (`/competition-plan`): 7 pasos guiados para definir evento, objetivo, nivel, disponibilidad semanal, deportes complementarios y estado físico actual; genera `PlanWizardConfig` persistido en perfil y prompt rico al coach; accesible desde dashboard (card de bienvenida si no hay evento, botón "Editar" en MacroPlanCard) y desde Ajustes; reemplaza la configuración de GoalEvent que vivía en el formulario de perfil
- **arquitectura estructurada de running — Fase 1**: nuevo catálogo `runningSessionLibrary.ts` con ~27 sesiones clasificadas en 8 familias (easy_aerobic, long_run, tempo_threshold, intervals_vo2, speed_economy, hill, race_specific, recovery); nuevo selector `runningSelector.ts` con reglas por fase, fatiga, perfil deportivo (running_primary / hybrid / sport_support), competencia cercana, evitación de repetición y progresión multi-semana (progress / hold / deload / rotate); integrado en `promptBuilder.ts` con sección dinámica análoga a squash y fuerza; compatible con `RunningDetails` y `runningType` actuales sin cambios de tipos
- **progresión multi-semana Fase 2 — squash y fuerza**: `deriveSquashProgressionState` implementa 4-state model (progress/hold/rotate/deload) con detección de familias consecutivas en últimas 2 sesiones; `deriveProgressionIntent` en fuerza ahora es profile-aware (strength_primary/hybrid/sport_support) con detección de sobreentreno por patrón; `selectMainLiftWithProgression` rota a patrón diferente en modo rotate; señales ricas en prompt ("patrón squat sobreentrenado — rotar") que ayudan al coach a mantener coherencia; compatible completamente con `session.exercises` y `squashDetails.drills`

## Posicionamiento actual

Hoy el producto ya se siente como:

- planner de entrenamiento personal
- coach AI que adapta recomendaciones al perfil del atleta
- tracker ligero para carga, recuperación y adherencia

Todavía no se siente completamente “premium” por tres razones:

- sync y reconciliación siguen siendo la zona más sensible
- el valor diferencial del macroplan y los protocolos aún está en MVP
- la progresión multi-semana todavía debe sentirse más continua y menos aislada

## Roadmap por fases

### Fase 1 — MVP vendible

**Objetivo**

Cerrar confiabilidad y UX base para que el producto se pueda mostrar, usar y cobrar sin miedo.

**Features principales**

1. Endurecer sync y reconciliación entre dispositivos
2. Consolidar progresión multi-semana real en squash y fuerza
3. Mejorar UX del coach y feedback de acciones
4. Cerrar gaps de perfil incompleto con nudges claros
5. Limpiar messaging de producto y flujo de valor principal

**Impacto en usuario**

- más confianza en que sus datos no se rompen
- mejor experiencia diaria con el coach
- percepción de producto serio, no experimental

### Fase 2 — Crecimiento

**Objetivo**

Aumentar retención y valor percibido sin sobrearquitectura.

**Features principales**

1. Macroplan Fase 2: timeline visual + templates por fase
2. Protocolos reutilizables e interactivos de warmup/cooldown
3. Mejorar profundidad de cycling y mobility
4. Dashboard más accionable con alertas y recomendaciones cortas
5. Mejorar importación inicial y recuperación de datos

**Impacto en usuario**

- más claridad sobre qué entrenar y por qué
- sensación de coach más completo
- más adherencia y retorno a la app

### Fase 3 — Monetización

**Objetivo**

Empaquetar el producto para convertirlo en algo claramente vendible.

**Features principales**

1. Planes y límites claros
2. Historial y analytics premium
3. Coach más profundo en plan pago
4. Export/share de planes o resúmenes
5. Integraciones premium solo si ayudan a cerrar ventas

**Impacto en usuario**

- diferencia clara entre gratis y pago
- mayor percepción de valor por personalización y seguimiento
- modelo fácil de entender y comprar

## Observaciones técnicas del código (2026-04-06)

Hallazgos concretos de revisión del código que no estaban explícitos en el backlog anterior:

### ✓ Nutrición personalizada al perfil
`getDayNutrition(sessions, profile?)` ya lee `weightKg`, `proteinTargetG` y `nutritionProfile.notes`. Hidratación calculada por peso, proteína estimada por carga del día, notas dietéticas visibles en UI. Pendiente: ajustar menú de comidas según restricciones del perfil.

### ✓ ACWR calculado y conectado al coach
`loadAnalytics.ts` calcula ratio agudo/crónico con zona `undertrained / optimal / risk / limited`. Visible en dashboard con semáforo y métricas. `promptBuilder.ts` ya incluye el ACWR con reglas accionables de progresión/descarga. Ahora también existe capa explícita de running con `getRunningWeeklyLoads()` y `calculateRunningAcwr()`, integrada en dashboard, prompt y selector sin romper el ACWR global. Pendiente: validación de umbrales en uso real; extender el mismo patrón cuantitativo a squash y fuerza.

### ✓ Progresión de fuerza en el prompt del coach
`buildStrengthProgressionSection` en `promptBuilder.ts` agrupa ejercicios completados por nombre y muestra la progresión de carga de las últimas 4 ocurrencias. El coach ahora ve `Sentadilla: 4×6@80kg → 4×6@82.5kg → 4×5@85kg` y puede proponer la siguiente carga concreta. Los 1RM del perfil ya estaban y se acompañan de porcentajes de referencia (75%, 85%). Pendiente: surface de progresión en UI de analytics.

### ✓ Historial de partidos de squash en el prompt del coach
`buildSquashMatchHistorySection` en `promptBuilder.ts` expone los últimos 6 partidos completados con resultado, oponente, score de games y RPE real. El coach ajusta foco técnico según racha (negativa → control y táctica; positiva → mantener estímulos). Pendiente: UI de historial de partidos para el atleta.

### ✓ ProtocolEngine con UX en DayDetail
`protocolEngine.ts` ya está expuesto en `DayDetail.tsx`: warm-up y cooldown se muestran por sesión antes de iniciar y al completar. La observación original estaba desactualizada.

### Sync: merge last-write-wins es frágil
La estrategia de sync mejoró: dedupe por clave natural, tombstones de delete, compactación y recovery automático. El gap abierto es el merge de **ediciones concurrentes del mismo registro**: dos dispositivos offline editando el mismo objeto → gana el último timestamp silenciosamente. Requiere cambio de arquitectura (vector clocks o CRDTs). No tiene solución rápida.

### MacroPlan sin diferenciación por deporte
Las fases (base/build/peak/taper) son genéricas. En un atleta multi-deporte, “peak de squash” y “peak de running” implican énfasis distintos. Pendiente para Fase 2 del roadmap.

### ICS export parcialmente implementado
`utils/ics.ts` existe en el proyecto — sugiere que la exportación a calendario fue planeada o está parcialmente lista. No se ve activamente expuesta en la UI.

### ✓ Arquitectura estructurada de running — Fase 2 cuantitativa inicial
`runningSessionLibrary.ts` mantiene ~27 sesiones en 8 familias (easy_aerobic, long_run, tempo_threshold, intervals_vo2, speed_economy, hill, race_specific, recovery) con campo `runningType` compatible con `RunningDetails` existente. Sobre esa base, `loadAnalytics.ts` ahora expone `getRunningWeeklyLoads()` y `calculateRunningAcwr()` para tracking semanal de running solo con sesiones de running, usando carga ponderada por minutos/RPE y distancia estimada cuando existe señal suficiente (km en notas/título/objetivo o pace objetivo). `runningSelector.ts` consume `runningAcwr` como señal objetiva simple: `risk -> deload`, `undertrained -> puede progresar`, `limited -> cae a lógica contextual`. `promptBuilder.ts` y dashboard ya muestran la señal cuantitativa corta. Pendiente: cálculo fino de ritmos por historial real, extensión completa a squash/fuerza, tests unitarios y UI histórica más rica.

---

## Backlog unificado

### Ahora

Items de mayor prioridad para las próximas iteraciones:

1. **Sync y reconciliación**
   - validar en dispositivos reales la convergencia completa de sesiones borradas
   - seguir endureciendo cola offline, recovery y diagnósticos
   - mejorar copy cuando la cola queda retenida mucho tiempo
   - **nuevo:** detectar y avisar cuando hay ediciones concurrentes en lugar de sobrescribir silenciosamente
   - **ya implementado en código:** dedupe natural key, tombstones de delete, compactación de cola, reintento automático al volver online/foco y reset total local+nube

2. **Progresión multi-semana de squash y fuerza** ✓ Fase 2 implementada
   - ✓ 4-state model para squash (progress/hold/rotate/deload) con detección de familias consecutivas
   - ✓ 4-state intent para fuerza (progress/hold/deload/rotate) con reglas por perfil deportivo (strength_primary/hybrid/sport_support)
   - ✓ selectMainLiftWithProgression rota a patrón diferente en modo rotate
   - ✓ señales claras al coach en prompt ("familia drive_control entrenada suficiente — rotar")
   - pendiente Fase 3: progresión cuantitativa por kg, periodización completa (microciclos de 4 semanas), rotación semanal explícita

3. **Coach UX**
   - respuestas más consistentes y menos ambiguas
   - mejor feedback después de aceptar propuestas
   - reducir fricción entre “chat útil” y “acción ejecutable”
   - **nuevo:** resumen de contexto enviado al coach (“el coach sabe esto de ti”) para generar confianza
   - **avance reciente:** mejor copy de sync/error y entrada guiada hacia planificación semanal

4. **Perfil incompleto** ✓ nudge implementado
   - card en dashboard detecta estado `partial` / `missing_sports` y muestra qué falta con link a Ajustes
   - pendiente: pedir datos específicos dentro del flujo (ritmos, 1RMs) sin depender solo del nudge pasivo

5. **Creador de plan como feature separada**
   - separar el flujo de `create_week` del chat general
   - convertirlo en una experiencia dedicada y más enriquecida
   - permitir inputs más claros: objetivo de semana, fase, disponibilidad, competencia cercana, foco principal
   - mantener el chat como coach conversacional y el creador como herramienta estructurada

6. **Arquitectura estructurada de sesiones squash** ✓ Fase 1 implementada
   - nuevo catálogo `drillLibrary.ts` con drills reutilizables y clasificables
   - nuevo selector `drillSelector.ts` con reglas por fase, fatiga, competencia cercana y repetición reciente
   - `promptBuilder.ts` ya consume selección dinámica como base de sesiones squash y reemplaza los ejemplos estáticos principales por bloques guiados desde el selector
   - pendiente: progresión multi-semana real, metadata visible en UI

7. **Arquitectura estructurada de sesiones de fuerza** ✓ Fase 1 implementada
   - nuevo catálogo `exerciseLibrary.ts` con ejercicios clasificados por patrón, intensidad y equipamiento
   - nuevo selector `strengthSelector.ts` con reglas por fase, fatiga, perfil (`strength_primary`, `hybrid`, `sport_support`) y recencia
   - `promptBuilder.ts` ya consume selección dinámica de fuerza manteniendo `session.exercises` como formato canónico
   - pendiente: progresión multi-semana por familia, equipamiento persistido en perfil, scoring más fino por nivel y metadata visible en UI

8. **Arquitectura estructurada de sesiones de running** ✓ Fase 1 implementada
   - nuevo catálogo `runningSessionLibrary.ts` con ~27 sesiones en 8 familias y compatibilidad con `RunningType` existente
   - nuevo selector `runningSelector.ts` con reglas por fase, fatiga, perfil deportivo (`running_primary`, `hybrid`, `sport_support`), competencia cercana, evitación de repetición y progresión multi-semana (progress / hold / deload / rotate)
   - `promptBuilder.ts` integra selección dinámica de running análoga a squash y fuerza, con reglas claras de perfil deportivo en el prompt
   - avance reciente: tracking cuantitativo semanal de running + `runningAcwr` explícito integrados en analytics, dashboard, prompt y selector
   - pendiente: cálculo fino de ritmos por historial real, extensión completa a squash/fuerza, tests unitarios y UI de historial de sesiones de running

### Siguiente

Items de alto valor después de cerrar confiabilidad:

1. **Macroplan Fase 2**
   - timeline visual
   - plantillas `create_week` por fase
   - reglas de taper/peak más visibles
   - **nuevo:** diferenciación de énfasis por deporte dentro de cada fase (squash vs running peak no son iguales)
   - **nuevo:** eventos secundarios (ej. torneos de preparación) visibles en el timeline

2. **Nutrición personalizada** ✓ implementado
   - hidratación calculada desde `weightKg` (33ml/kg base) + adición por carga del día
   - proteína objetivo desde `proteinTargetG` del perfil o estimada por peso × factor de carga (1.6–2.0 g/kg)
   - notas dietéticas del perfil visibles en card expandido
   - pendiente: ajustar menú del día según restricciones alimentarias del perfil (actualmente el template es fijo)

3. **ACWR + alertas de carga** ✓ implementado
   - ratio agudo/crónico calculado en `loadAnalytics.ts` usando baseline previa
   - baseline corta visible cuando aún no hay suficiente historia para una alerta fuerte
   - semáforo visible en dashboard con carga aguda, crónica y semanas usadas
   - ACWR enviado al prompt del coach con reglas accionables de progresión / descarga
   - pendiente: tests unitarios de cálculo y extensión futura del patrón cuantitativo a squash y fuerza

4. **Squash y fuerza personalizados al historial** ✓ implementado en prompt
   - `buildSquashMatchHistorySection`: últimos 6 partidos (resultado, oponente, score, RPE) → el coach adapta foco técnico según racha
   - `buildStrengthProgressionSection`: progresión de carga por ejercicio de las últimas sesiones → el coach propone cargas concretas
   - 1RM del perfil + % de referencia ya estaban y se mantienen
   - pendiente (UI): surface de historial de partidos y gráfico de progresión de carga para el atleta

5. **Variabilidad real de sesiones squash** ✓ Fase 1 implementada
   - drills hardcodeados dejan de ser la base principal del contenido
   - el selector evita repetición reciente y ajusta intensidad por fatiga / taper
   - compatible con `squashDetails.drills` actual en UI
   - pendiente: rotación semanal explícita y progresión por nivel/constraints

6. **Variabilidad real de sesiones de fuerza** ✓ Fase 1 implementada
   - ejercicios hardcodeados dejan de ser la base principal de las sesiones de fuerza
   - el selector diferencia `strength_primary`, `hybrid` y `sport_support`
   - compatible con `session.exercises` actual en UI y stores
   - pendiente: progresión explícita multi-semana, periodización avanzada y explicación visible del porqué de la selección

7. **Protocolos previos y posteriores** ✓ UX implementada en DayDetail
   - warm-up y cooldown visibles por sesión en vista diaria
   - pendiente: guardar protocolo como favorito por disciplina

8. **Dashboard accionable**
   - mejores alertas
   - recomendaciones cortas de coach
   - señales claras cuando hay riesgo de fatiga, taper o huecos de planificación
   - **avance reciente:** ACWR ya visible como señal de alerta con baseline explícita

9. **Depth improvements**
   - cycling más profundo para usuarios cycling-first
   - mobility más útil como disciplina real, no solo complemento

10. **Plan de competencia V2** ✓ MVP implementado
   - ✓ wizard de 7 pasos con inputs guiados (evento, objetivo, nivel, disponibilidad, deportes, estado físico)
   - ✓ `PlanWizardConfig` persistido en perfil del atleta
   - ✓ prompt rico estructurado al coach con toda la configuración
   - ✓ acceso desde dashboard (CTA si no hay evento, botón "Editar" en MacroPlanCard)
   - ✓ GoalEvent removido de formulario de Ajustes — ahora vive en el wizard
   - **pendiente V2**: pantalla de resumen visual con timeline de fases antes de abrir el coach
   - **pendiente V2**: soporte para eventos secundarios (`priority: 'secondary'`)
   - **pendiente V2**: edición del wizard con datos pre-populados y navegación entre pasos sin perder estado
   - **pendiente V2**: preview del plan del coach antes de aceptar
   - **pendiente V3**: plan week-by-week con sesiones clave visibles en vista de calendario
   - **pendiente V3**: adaptive plan (re-ejecutar wizard parcialmente cuando cambia fecha o condición)
   - **pendiente V3**: export del plan (ICS ya existe en `utils/ics.ts`, PDF posible)
   - **pendiente V3**: soporte multi-evento con detección de conflictos

### Después

Items valiosos, pero no críticos para esta etapa:

1. **Realtime sync opcional**
   - solo si aparece uso simultáneo real y recurrente

2. **Exportación a calendario (ICS)**
   - `utils/ics.ts` ya existe — evaluar qué tan completo está y si vale la pena exponer en UI
   - útil para usuarios que quieren ver sus sesiones en Google Calendar / Apple Calendar

3. **Integraciones externas**
   - WHOOP
   - Apple Health
   - Garmin solo exploratorio

4. **Eventos secundarios**
   - útiles para macroplan fase 2 y timeline visual

## Priorización simple

Si hubiera que resumir todo en orden real:

1. ~~confiabilidad de sync~~ — base sólida; pendiente validación en dispositivos reales
2. notificaciones móviles reales — sin avance en código, requiere prueba en dispositivo
3. ~~UX del coach — nudge de perfil incompleto~~ ✓ implementado
4. ~~nutrición personalizada al perfil~~ ✓ implementado (hidratación, proteína, notas)
5. ~~ACWR en dashboard~~ ✓ implementado y conectado al coach
6. ~~squash personalizado: contexto de partidos, taper y foco técnico en el prompt~~ ✓ implementado
7. ~~arquitectura estructurada de fuerza~~ ✓ implementado en Fase 1
8. ~~extender arquitectura estructurada a running~~ ✓ implementado en Fase 1
9. **progresión multi-semana y rotación explícita de drills squash** ← foco siguiente
10. **progresión multi-semana y periodización base de fuerza** ← mismo frente
11. ~~progresión cuantitativa por volumen semanal + ACWR por disciplina para running~~ ✓ fase inicial implementada
12. tests de ACWR + validación de umbrales en uso real
13. macroplan fase 2 con diferenciación por deporte
13. protocolos interactivos en flujo de sesión
14. notificaciones móviles reales
15. monetización

## Monetización viable

### 1. Suscripción simple

Gratis para planificación base. Pago mensual para:

- coach AI completo
- sync sólido multi-dispositivo
- macroplan avanzado
- analytics e historial premium

### 2. Freemium por límites

Gratis con:

- 1 deporte principal
- funciones base
- 1 evento principal

Pago para:

- multi-deporte completo
- más contexto del coach
- más historial
- más personalización

### 3. Coaching premium

Plan superior con:

- análisis más profundo
- resúmenes semanales premium
- recomendaciones más completas
- eventualmente capa humana liviana

## Features clave para habilitar monetización

Antes de cobrar, estas piezas tienen que sentirse fuertes:

- sync confiable
- notificaciones móviles confiables
- coach AI consistente y útil
- macroplan visible y entendible
- perfil del atleta bien aprovechado
- diferencia clara entre valor gratis y valor pago

## Checklist beta privada

| Área | Estado | Nota |
|------|--------|------|
| Planificación semanal, vista diaria, historial y ajustes | OK | Base de producto ya usable |
| Coach AI con proposals ejecutables | OK | Ya entrega valor real |
| Perfil estructurado + onboarding | OK | Bueno para arranque, pero aún mejorable |
| Dashboard con carga, nutrición y macroplan | OK | Ya muestra valor visible |
| Backup/import-export base | OK | Funcional para recovery |
| Sync multi-dispositivo | En progreso | Dedupe, cola compactada y recovery automático ya implementados; falta validación fuerte en móvil/PC real |
| Deletes y reconciliación completa | En progreso | Tombstones y convergencia base implementados; falta blindar ediciones concurrentes |
| Notificaciones móviles/PWA reales | En progreso | Falta validación en uso real |
| Manejo de errores visible y claro | En progreso | Mejoró el copy de sync; falta extenderlo a más flujos |
| Perfil incompleto con nudges específicos | En progreso | Mejora calidad del coach |
| Flujo principal del coach pulido | En progreso | Ya existe handoff desde Plan Builder; falta enriquecerlo |
| Offline básico confiable | En progreso | Recovery automático y mejor clasificación de errores ya implementados; falta validación en uso real |
| Nutrición personalizada al perfil | OK | Hidratación por peso, proteína por carga del día, notas dietéticas del perfil visibles en UI |
| ACWR / indicador de riesgo de carga | OK | Calculado en loadAnalytics.ts, visible en dashboard con semáforo (verde/amarillo/rojo), enviado al prompt del coach |
| Progresión multi-semana Fase 2 (squash/fuerza) | OK | 4-state model en squash y fuerza, detección de sobreentreno, señales ricas al coach |
| Analytics de progresión de fuerza | En progreso | Data disponible en Dexie, señales de progresión en prompt; falta UI de historial/gráfico |
| Progresión de running cuantitativa por volumen | OK | Tracking semanal de running, `runningAcwr` explícito, integración en selector, prompt y dashboard; falta refinamiento fino de ritmos/tests/UI histórica |
| Protocolos warmup/cooldown en UX | En progreso | Motor implementado, UX en DayDetail; falta guardar favoritos por disciplina |
| Plan de competencia (wizard) | OK | Wizard 7 pasos implementado; GoalEvent movido de Ajustes al wizard; PlanWizardConfig persistido; prompt rico al coach |

## Próximas 3 tareas de implementación

1. **Validar y blindar sync entre móvil y escritorio**
   - probar deletes, edits y recovery offline en dos dispositivos reales
   - revisar si todavía reaparece alguna `session`
   - cerrar cualquier caso restante de convergencia incompleta
   - **contexto:** sync es todavía la zona más sensible del producto; validación en dispositivo real es crítica antes de beta

2. **Progresión cuantitativa de running + ACWR por disciplina**
   - ✓ running Fase 2 inicial implementada: tracking semanal solo de running, `runningAcwr` explícito y consumo en selector/prompt/dashboard
   - ✓ permite deload de running independiente de squash o fuerza sin tocar el ACWR global existente
   - backlog: extender el mismo patrón cuantitativo a squash/fuerza, validar umbrales en uso real, tests unitarios y UI histórica más rica
   - **impacto:** atleta hybrid (squash + running) ya puede ver señal separada cuando solo running está sobrecargado

3. **UI de progresión multi-semana visible para el atleta**
   - historial de partidos de squash en tab de analytics (últimos 10 con resultado, RPE, oponente)
   - gráfico de progresión de carga por ejercicio (últimas 4 sesiones: ejercicio, series, reps, carga)
   - recomendación clara: "familia drive_control en progresion" vs "patrón squat necesita rotación"
   - **impacto:** atleta entiende la continuidad del entrenamiento, genera confianza en el coach

**Criterio para beta privada**

La beta privada está lista cuando:

- `sync` crea, edita y borra sin reaparecer datos
- móvil y escritorio convergen con la misma cuenta
- errores de sync, import y coach son entendibles
- onboarding lleva al usuario al primer valor sin ayuda manual
- offline básico se siente controlado y no roto

## Criterio de producto

La regla para próximas iteraciones debería ser simple:

- primero construir algo confiable
- luego construir algo que el usuario quiera abrir seguido
- recién después empaquetar y cobrar

Evitar por ahora:

- features complejas que no mejoran retención
- integraciones externas tempranas
- overengineering de arquitectura sin impacto comercial directo

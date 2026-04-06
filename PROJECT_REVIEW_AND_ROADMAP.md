# Entrenador App - Review and Roadmap

Actualizado: 2026-04-06 (revisión técnica del código)

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
- macroplan MVP por evento principal con awareness del coach vía prompt
- primera versión de `Plan Builder` separada del chat: ruta propia, inputs guiados base y handoff al coach con prompt estructurado

## Posicionamiento actual

Hoy el producto ya se siente como:

- planner de entrenamiento personal
- coach AI que adapta recomendaciones al perfil del atleta
- tracker ligero para carga, recuperación y adherencia

Todavía no se siente completamente “premium” por tres razones:

- sync y reconciliación siguen siendo la zona más sensible
- notificaciones móviles/PWA no están validadas del todo en uso real
- el valor diferencial del macroplan y los protocolos aún está en MVP

## Roadmap por fases

### Fase 1 — MVP vendible

**Objetivo**

Cerrar confiabilidad y UX base para que el producto se pueda mostrar, usar y cobrar sin miedo.

**Features principales**

1. Endurecer sync y reconciliación entre dispositivos
2. Validar notificaciones reales en móvil/PWA
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

### Nutrición sin personalización real
`nutritionEngine.ts` usa una tabla lookup 100% estática por tipo de carga. No lee el perfil del atleta en absoluto: ni peso, ni restricciones alimentarias, ni objetivos de macros, ni timing de entrenamientos. El gap entre “tenemos perfil del atleta” y “lo usamos para nutrición” es completo.

### LoadAnalytics sin ACWR
`loadAnalytics.ts` calcula carga ponderada (min × RPE) y tendencias por disciplina — buena base. Pero no calcula el **Acute:Chronic Workload Ratio** (carga semana actual / promedio 4 semanas), que es el indicador estándar de ciencias del deporte para riesgo de lesión. El dato está ahí para calcularlo.

### Fuerza sin progresión acumulada
El tipo `Exercise` ya guarda `weight`, `sets`, `reps`. La data existe para trazar progresión de carga en fuerza (ej. evolución de peso en sentadilla), pero no hay ningún surface de esto en analytics ni en el prompt del coach.

### ProtocolEngine implementado, sin suficiente UX
`protocolEngine.ts` tiene lógica rica: calcula días consecutivos de entrenamiento, proximidad a competencia, señales del `DayLog` (energía, dolor). El motor existe pero no está suficientemente expuesto en la UI post-sesión ni en vista diaria.

### Sync: merge last-write-wins es frágil
La estrategia de sync ya mejoró bastante: se corrigieron conflictos por clave natural (`date`, `weekStartDate`), deletes de `sessions` con tombstones, compactación de cola y recovery automático. El gap que sigue abierto es el merge de **ediciones concurrentes del mismo registro**: si dos dispositivos editan el mismo objeto offline, todavía gana el último timestamp silenciosamente.

### MacroPlan sin diferenciación por deporte
Las fases (base/build/peak/taper) son genéricas. En un atleta multi-deporte como squash + running, “peak de squash” y “peak de running” implican énfasis distintos (skills técnicos vs volumen aeróbico). El macroplan no hace esa distinción.

### ICS export parcialmente implementado
`utils/ics.ts` existe en el proyecto — sugiere que la exportación a calendario fue planeada o está parcialmente lista. No se ve activamente expuesta en la UI.

---

## Backlog unificado

### Ahora

Items de mayor prioridad para las próximas iteraciones:

1. **Sync y reconciliación**
   - validar en dispositivos reales la convergencia completa de sesiones borradas
   - seguir endureciendo cola offline, recovery y diagnósticos
   - mejorar copy cuando la cola queda retenida mucho tiempo
   - **nuevo:** detectar y avisar cuando hay ediciones concurrentes en lugar de sobrescribir silenciosamente
   - **ya implementado en código:** dedupe natural key, tombstones de delete, compactación de cola y reintento automático al volver online/foco

2. **Notificaciones móviles reales**
   - validar suspensión real en iPhone/Android/PWA
   - aviso visible cuando permiso está bloqueado
   - errores de scheduling más claros para el usuario

3. **Coach UX**
   - respuestas más consistentes y menos ambiguas
   - mejor feedback después de aceptar propuestas
   - reducir fricción entre “chat útil” y “acción ejecutable”
   - **nuevo:** resumen de contexto enviado al coach (“el coach sabe esto de ti”) para generar confianza
   - **avance reciente:** mejor copy de sync/error y entrada guiada hacia planificación semanal

4. **Perfil incompleto**
   - nudges específicos por deporte
   - pedir ritmos de running, 1RM de fuerza y disponibilidad cuando falten
   - usar eso para mejorar la calidad del coach más rápido

5. **Creador de plan como feature separada**
   - separar el flujo de `create_week` del chat general
   - convertirlo en una experiencia dedicada y más enriquecida
   - permitir inputs más claros: objetivo de semana, fase, disponibilidad, competencia cercana, foco principal
   - mantener el chat como coach conversacional y el creador como herramienta estructurada

### Siguiente

Items de alto valor después de cerrar confiabilidad:

1. **Macroplan Fase 2**
   - timeline visual
   - plantillas `create_week` por fase
   - reglas de taper/peak más visibles
   - **nuevo:** diferenciación de énfasis por deporte dentro de cada fase (squash vs running peak no son iguales)
   - **nuevo:** eventos secundarios (ej. torneos de preparación) visibles en el timeline

2. **Nutrición personalizada — gap técnico crítico**
   - conectar `nutritionEngine` al perfil del atleta: usar peso, preferencias y timing de entrenamiento
   - reemplazar lookup estático por lógica que adapte macros al volumen real semanal
   - no requiere LLM — es lógica determinista que ya puede mejorar mucho con el perfil que tenemos
   - mostrar diferencia entre días de doble sesión en diferentes deportes (squash-fuerza vs squash-running)

3. **ACWR y alertas de carga — dato ya disponible**
   - `loadAnalytics.ts` ya tiene todo lo necesario para calcular Acute:Chronic Workload Ratio
   - añadir ACWR al dashboard como indicador de riesgo de lesión (semáforo: verde/amarillo/rojo)
   - enviar ACWR al prompt del coach para que informe sus propuestas
   - umbral de alerta: ACWR > 1.5 = riesgo alto, < 0.8 = desentrenamiento

4. **Progresión de fuerza**
   - los datos de peso/series/reps ya se guardan en `Exercise`
   - mostrar evolución de carga por ejercicio (ej. “tu sentadilla subió 12% en 4 semanas”)
   - enviar tendencia de fuerza al prompt del coach para propuestas de progresión
   - calcular 1RM estimado automáticamente desde el historial

5. **Protocolos previos y posteriores — UX pendiente**
   - `protocolEngine.ts` ya está implementado con contexto rico
   - surfacear el protocol recomendado en la vista de sesión del día antes de empezar
   - mostrar cooldown recomendado en la pantalla de completar sesión
   - reutilización: guardar protocolo como favorito por disciplina

6. **Dashboard accionable**
   - mejores alertas
   - recomendaciones cortas de coach
   - señales claras cuando hay riesgo de fatiga, taper o huecos de planificación
   - **nuevo:** integrar ACWR como señal de alerta visual

7. **Depth improvements**
   - cycling más profundo para usuarios cycling-first
   - mobility más útil como disciplina real, no solo complemento

8. **Plan Builder enriquecido**
   - base ya implementada con ruta propia y draft estructurado al coach
   - permitir revisar borrador antes de aplicar
   - explicar por qué se generó cada sesión
   - servir como base para una futura feature premium

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

1. confiabilidad de sync (incluyendo merge de ediciones concurrentes)
2. notificaciones móviles reales
3. UX del coach y perfil incompleto
4. nutrición personalizada al perfil del atleta (alto impacto, implementación simple)
5. ACWR como indicador de carga en dashboard (alto impacto, dato ya disponible)
6. macroplan fase 2 con diferenciación por deporte
7. progresión de fuerza visible
8. protocolos interactivos en flujo de sesión
9. monetización

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
| Nutrición personalizada al perfil | Pendiente | Motor estático — no usa datos del perfil del atleta |
| Analytics de progresión de fuerza | Pendiente | Data disponible en Dexie, sin surface en UI |
| ACWR / indicador de riesgo de carga | Pendiente | Base de datos lista para calcularlo, no implementado aún |
| Protocolos warmup/cooldown en UX | En progreso | Motor implementado, falta integración en flujo de sesión |
| Plan Builder separado del chat | En progreso | Primera versión lista; falta enriquecer inputs, preview y explicación del plan |

## Próximas 3 tareas de implementación

1. **Validar y blindar sync entre móvil y escritorio**
   - probar deletes, edits y recovery offline en dos dispositivos reales
   - revisar si todavía reaparece alguna `session`
   - cerrar cualquier caso restante de convergencia incompleta

2. **Mejorar UX de errores y estado de sync**
   - copy más claro en Dashboard y Ajustes
   - diferenciar mejor “sin conexión”, “error de servidor” y “cola retenida”
   - dejar acciones sugeridas visibles para el usuario

3. **Separar el creador de plan del chat**
   - base ya creada con `Plan Builder`
   - enriquecer inputs estructurados en vez de depender solo del mensaje libre
   - mantener el chat para conversación y ajustes, y el plan builder para planificación guiada

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

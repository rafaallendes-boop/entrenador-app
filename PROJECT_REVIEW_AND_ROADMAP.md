# Entrenador App - Review and Roadmap

Actualizado: 2026-04-08
Ultimo hito relevante: Macroplan V2 por deporte y protocolos/flows de sesion mas profundos integrados en motor, prompt y UI

## Estado actual del producto

Entrenador ya no esta en modo prototipo. Hoy existe una base usable y relativamente solida para atletas hibridos:

- planificacion semanal, vista diaria, historial y ajustes operativos
- coach AI con propuestas ejecutables y persistidas
- perfil estructurado del atleta con multi-deporte, recovery, schedule y nutricion
- onboarding y wizard de plan de competencia funcionando
- macroplan V2 por deporte ya visible
- sync multi-dispositivo, backup/import-export y recovery offline implementados
- analytics de carga, ACWR y progresion ya visibles
- protocolos de sesion mas ejecutables: intervalos running, warmup/cooldown checkables y feedback por sesion

## Lo ya implementado

Esto ya no deberia volver al backlog principal salvo refinamientos:

- chat del coach con proposals ejecutables
- athlete profile estructurado y persistido
- onboarding guiado
- wizard de plan de competencia
- plan builder separado del chat
- ACWR global y ACWR especifico de running
- selectors estructurados para squash, strength y running
- progresion multi-semana visible para el atleta en History
- validacion de deportes permitidos en planning flow, prompt y persistencia
- resumen estructurado del plan generado (`planSummary`)
- validacion visible del plan generado
- coherencia macroplan <-> semana visible en ProposalDrawer y WeeklyView
- macroplan V2 con timeline, sportDetails y eventos secundarios visibles
- protocolos de sesion mas profundos en SessionCard y prompt del coach
- tests unitarios ampliados para logica critica

## Lo que ya entrega valor real

Hoy el producto ya logra tres cosas importantes:

1. El atleta entiende que entrenar y por que.
2. El coach AI tiene mas contexto y menos margen para contradicciones obvias.
3. La planificacion multi-deporte es bastante mas segura que antes.

## Limitaciones principales actuales

Las brechas mas importantes siguen siendo estas:

1. Sync en uso real sigue siendo la zona mas sensible.
2. Falta retencion real: notificaciones, reactivacion y loops semanales.
3. Analytics y alertas todavia no cierran bien el loop de accion.
4. La propuesta comercial aun no esta empaquetada para vender.

## Roadmap vigente

### Fase 1 - Solidez vendible

Objetivo:
cerrar confiabilidad, coherencia y claridad visible para que el producto se pueda cobrar sin miedo.

Bloques:

1. Sync y reconciliacion reales entre dispositivos
2. Continuidad entre macroplan, semana e historial
3. UX del coach y feedback de acciones
4. Activacion y uso recurrente

### Fase 2 - Profundidad de coaching

Objetivo:
hacer que el producto se sienta claramente mejor que una planificacion semanal aislada.

Bloques:

1. Analytics y alertas mas accionables
2. Mejoras en cycling y mobility
3. Explicabilidad y continuidad del coach sobre historial real
4. Refinamientos de templates por disciplina

### Fase 3 - Monetizacion

Objetivo:
empaquetar el producto con pricing, valor percibido y limites claros.

Bloques:

1. modelo gratis vs pago
2. features premium de coach y analytics
3. packaging comercial y onboarding de conversion
4. soporte / recovery / confiabilidad nivel producto

## Estado por area

### Planificacion y coach

Estado: fuerte

- proposals persistidas y ejecutables
- deportes permitidos blindados en varias capas
- resumen del plan generado ya visible
- coherencia macroplan <-> semana ya visible y validable

Pendiente:

- explicar mejor el "por que" de la propuesta usando historial y feedback real
- pulir templates por disciplina en casos edge
- mejor explicacion del "por que" en cada semana

### Macroplan

Estado: fuerte

- fase actual, semanas restantes y block focus ya existen
- timeline visible del bloque
- diferencias por deporte dentro de cada fase
- eventos secundarios visibles como moduladores
- ahora la semana refleja la fase y genera warnings de incoherencia

Pendiente:

- comparacion entre semana esperada y semana propuesta en mas detalle
- mas profundidad en cycling y mobility

### Progression y carga

Estado: fuerte

- progresion multi-semana en squash y fuerza
- running con tracking semanal y ACWR especifico
- insights visibles para el atleta
- selectors y reglas ya con buena base de tests

Pendiente:

- extender capa cuantitativa completa a squash y fuerza
- validar umbrales de ACWR en uso real
- refinar UI historica de running

### Sync

Estado: implementado pero sensible

- cola offline
- retry automatico
- dedupe
- tombstones
- repair de athlete_profiles
- backup/import/export

Pendiente:

- validacion fuerte movil + escritorio real
- conflictos concurrentes mejor resueltos o al menos mejor explicados
- mensajes mas accionables cuando la cola queda retenida

### Protocolos y ejecucion de sesion

Estado: fuerte

- running con intervalStructure para sesiones mas ejecutables
- warmup y cooldown checkables desde SessionCard
- feedback por sesion persistido y visible para el coach
- prompt reforzado para exigir warmup/cooldown y drills con timing

Pendiente:

- tests UI puntuales de SessionCard expandido
- usar sessionFeedback para recomendaciones y ajustes mas explicitos
- mejorar templates de intervalos para cycling

### Tests y deuda tecnica

Estado: mucho mejor que antes

- suite de tests ampliada
- coverage operativa
- selectors, ACWR, macroplan, protocol engine y utilidades puras ya cubiertos

Pendiente:

- seguir desacoplando syncService
- extraer bloques puros de promptBuilder
- mantener deuda tecnica incremental, no como proyecto separado

## Ultimos hitos implementados

### 1. Running Fase 2 cuantitativa inicial

- tracking semanal de running
- ACWR separado de running
- integracion en selector, prompt y dashboard

### 2. UI de progresion multi-semana para el atleta

- historial de partidos squash
- progresion de fuerza por familias
- recomendaciones visibles por disciplina

### 3. Blindaje de deportes permitidos en planning flow

- el plan actual manda sobre defaults del perfil
- filtro defensivo final antes de persistir/renderizar
- tests de regresion para deportes no permitidos

### 4. Validacion y explicabilidad del plan generado

- `planSummary` estructurado
- allowed/excluded sports
- sessionsBySport
- estimatedLoadBySport
- weeklyIntent
- validationStatus e issues

### 5. Coherencia macroplan <-> semana

- currentPhase
- blockGoal
- weeklyRule
- targetDistributionBySport
- actualDistributionBySport
- coherenceStatus e issues
- bloque visible en WeeklyView

### 6. Macroplan V2 por deporte

- headline, timeline y sportDetails en macroplan
- fase global gobernada por evento principal
- squash, running y strength con foco distinto por fase
- eventos secundarios visibles sin romper la prioridad principal
- integracion en dashboard, coherencia semanal y prompt del coach

### 7. Protocolos y flows de sesion mas profundos

- running con bloques explicitos para intervalos/tempo
- warmup y cooldown checkables paso a paso
- feedback a nivel sesion persistido
- prompt y normalizacion alineados con el nuevo contrato

## Siguientes pasos recomendados

### Prioridad 1

**Validar y blindar sync entre movil y escritorio**

Alcance:

- create/edit/delete en dos dispositivos reales
- recovery offline
- cola retenida
- convergencia despues de volver online

Por que:

- sigue siendo el mayor riesgo de producto
- es la principal barrera para cobrar con confianza

### Prioridad 2

**Notificaciones y activacion semanal**

Alcance:

- recordatorio de sesion del dia
- nudge de check-in
- aviso de semana vacia o sin coach note
- aviso cuando hay warning importante de carga o coherencia

Por que:

- sin esto la app puede ser buena pero abrirse poco
- es clave para retencion real

### Prioridad 3

**Analytics y alertas mas accionables**

Alcance:

- usar ACWR, coherencia y feedback de sesion para detectar riesgo o necesidad de ajuste
- mensajes mas claros de por que una semana esta bien o mal calibrada
- alertas concretas por disciplina, no solo globales

Por que:

- cierra el loop entre datos, decision y accion
- hace que el coach se sienta menos descriptivo y mas util

## Priorizacion simple

Si hubiera que resumir el orden real de trabajo desde hoy:

1. validar sync en dispositivos reales
2. notificaciones y activacion semanal
3. analytics y alertas mas accionables
4. extensiones cuantitativas de carga a squash y fuerza
5. mejoras en cycling y mobility
6. monetizacion y packaging comercial

## Que falta para hacer la app vendible

La app ya tiene base para ser vendible, pero todavia faltan estas piezas para que se sienta lista comercialmente:

### 1. Confiabilidad operativa

- sync validado en uso real
- recovery claro cuando algo falla
- menos miedo a perder o duplicar datos

### 2. Retencion real

- notificaciones
- loops semanales
- razones claras para volver a abrir la app

### 3. Macroplan mas premium

- timeline
- diferenciacion por deporte
- sensacion de continuidad de verdad

Esta capa ya dio un salto importante. Lo pendiente aqui no es "hacer macroplan V2", sino seguir refinando disciplinas secundarias y explicabilidad.

### 4. Packaging comercial

- pricing claro
- plan gratis vs pago
- value prop muy facil de entender
- landing / onboarding orientado a conversion

### 5. Pulido final de UX

- menos friccion entre wizard, coach y aceptacion del plan
- mejor copy
- estados vacios y warnings mas consistentes

## Criterio para beta privada fuerte

La beta privada esta realmente lista cuando:

- sync converge bien en movil y escritorio
- el usuario entiende su semana y su fase sin ayuda manual
- el coach no propone deportes o cargas incoherentes con facilidad
- los errores importantes son explicables
- existe al menos una razon fuerte para volver cada semana

## Criterio de producto

Regla para las siguientes iteraciones:

1. primero, confiabilidad
2. despues, continuidad visible del coaching
3. despues, retencion
4. recien ahi, monetizacion fuerte

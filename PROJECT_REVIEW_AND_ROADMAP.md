# Entrenador App - Review and Roadmap

Actualizado: 2026-04-07
Ultimo hito relevante: coherencia macroplan <-> semana, validacion visible del plan y resumen persistido del plan generdo

## Estado actual del producto

Entrenador ya no esta en modo prototipo. Hoy existe una base usable y relativamente solida para atletas hibridos:

- planificacion semanal, vista diaria, historial y ajustes operativos
- coach AI con propuestas ejecutables y persistidas
- perfil estructurado del atleta con multi-deporte, recovery, schedule y nutricion
- onboarding y wizard de plan de competencia funcionando
- macroplan MVP por evento principal ya visible
- sync multi-dispositivo, backup/import-export y recovery offline implementados
- analytics de carga, ACWR y progresion ya visibles

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
- tests unitarios ampliados para logica critica

## Lo que ya entrega valor real

Hoy el producto ya logra tres cosas importantes:

1. El atleta entiende que entrenar y por que.
2. El coach AI tiene mas contexto y menos margen para contradicciones obvias.
3. La planificacion multi-deporte es bastante mas segura que antes.

## Limitaciones principales actuales

Las brechas mas importantes siguen siendo estas:

1. Sync en uso real sigue siendo la zona mas sensible.
2. Macroplan todavia es generico por fase; falta profundidad por deporte.
3. Falta retencion real: notificaciones, reactivacion y loops semanales.
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

1. Macroplan V2 por deporte
2. Protocolos y flows de sesion mas profundos
3. Analytics y alertas mas accionables
4. Mejoras en cycling y mobility

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

- templates por fase mas ricos
- diferencias por deporte dentro de cada fase
- mejor explicacion del "por que" en cada semana

### Macroplan

Estado: MVP bueno

- fase actual, semanas restantes y block focus ya existen
- ahora la semana refleja la fase y genera warnings de incoherencia

Pendiente:

- timeline visual
- reglas por deporte dentro de base/build/peak/taper
- eventos secundarios
- comparacion entre semana esperada y semana propuesta en mas detalle

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

**Macroplan V2 por deporte**

Alcance:

- squash peak != running peak != cycling peak
- reglas por disciplina dentro de cada fase
- timeline simple del bloque
- week templates por fase

Por que:

- el macroplan ya es visible; ahora toca hacerlo realmente diferencial
- aumenta mucho la sensacion de coach premium

### Prioridad 3

**Notificaciones y activacion semanal**

Alcance:

- recordatorio de sesion del dia
- nudge de check-in
- aviso de semana vacia o sin coach note
- aviso cuando hay warning importante de carga o coherencia

Por que:

- sin esto la app puede ser buena pero abrirse poco
- es clave para retencion real

## Priorizacion simple

Si hubiera que resumir el orden real de trabajo desde hoy:

1. validar sync en dispositivos reales
2. macroplan V2 por deporte
3. notificaciones y activacion semanal
4. extensiones cuantitativas de carga a squash y fuerza
5. protocolos y flows de sesion mas profundos
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

# Entrenador App - Review and Roadmap

Actualizado: 2026-04-09
Ultimo hito relevante: profundizacion de cycling y mobility con contrato explicito de sesion, selector mas maduro, mejor prompt del coach y mejor visibilidad en SessionCard

## Estado actual del producto

Entrenador ya no esta en fase de prototipo. Hoy existe una base bastante seria para atletas hibridos, especialmente en squash + running + fuerza:

- planificacion semanal, vista diaria, historial y ajustes operativos
- coach AI con propuestas ejecutables y persistidas
- perfil estructurado del atleta con multi-deporte, recovery, schedule y nutricion
- onboarding y wizard de plan de competencia funcionando
- macroplan V2 por deporte ya visible y coherente con la semana
- sync multi-dispositivo, backup/import-export y recovery offline implementados
- analytics de carga, ACWR y progresion visibles
- protocolos de sesion mas ejecutables con warmup/cooldown y feedback por sesion
- notificaciones operativas con reglas por contexto
- alertas accionables en dashboard con CTA reales a semana, chat o check-in
- cycling y mobility ahora con mejor criterio de coaching, continuidad y estructura visible

## Lo ya implementado

Esto ya no deberia volver al backlog principal salvo refinamientos:

- chat del coach con proposals ejecutables
- athlete profile estructurado y persistido
- onboarding guiado
- wizard de plan de competencia
- plan builder separado del chat
- ACWR global y ACWR especifico por running, squash y fuerza
- selectors estructurados para squash, strength, running, cycling y mobility
- progresion multi-semana visible para el atleta en History
- validacion de deportes permitidos en planning flow, prompt y persistencia
- resumen estructurado del plan generado (`planSummary`)
- validacion visible del plan generado
- coherencia macroplan <-> semana visible en ProposalDrawer y WeeklyView
- macroplan V2 con timeline, sportDetails y eventos secundarios visibles
- protocolos de sesion mas profundos en SessionCard y prompt del coach
- notificaciones locales con preferencias, scheduling y debug
- alertas accionables en dashboard priorizadas por severidad
- contrato explicito para sesiones de cycling y mobility
- prompt del coach reforzado para emitir `cyclingDetails` y `mobilityDetails`
- tests unitarios ampliados para logica critica

## Lo que ya entrega valor real

Hoy el producto ya logra cinco cosas importantes:

1. El atleta entiende que entrenar y por que.
2. El coach AI tiene mas contexto y menos margen para contradicciones obvias.
3. La planificacion multi-deporte es bastante mas segura que antes.
4. El usuario ya recibe señales concretas cuando una semana se desordena.
5. Existe una base razonable para retencion semanal, no solo para generacion de planes.

## Lectura honesta del producto

### Lo fuerte hoy

- continuidad visible entre macroplan, semana, sesion y feedback
- coach AI cada vez mas util para ejecutar, no solo explicar
- analytics suficientemente buenos para empezar a guiar decisiones
- capa offline/sync ya mucho mas madura que la mayoria de apps tempranas

### Lo debil hoy

- sync sigue siendo el mayor riesgo comercial porque falta validacion en uso real duro
- notificaciones y alertas existen, pero todavia no estan unificadas en un solo loop de activacion
- el coach todavia explica mejor de lo que reajusta automaticamente
- el packaging comercial sigue incompleto

## Estado por area

### Planificacion y coach

Estado: fuerte

- proposals persistidas y ejecutables
- deportes permitidos blindados en varias capas
- resumen del plan generado ya visible
- coherencia macroplan <-> semana ya visible y validable
- alertas accionables ya ayudan a decidir cuando revisar semana o pedir ajuste

Pendiente:

- usar alertas y feedback para disparar ajustes mas directos del coach
- explicar mejor el "por que" de la propuesta usando historial y feedback real
- pulir templates por disciplina en casos edge

### Macroplan

Estado: fuerte

- fase actual, semanas restantes y block focus ya existen
- timeline visible del bloque
- diferencias por deporte dentro de cada fase
- eventos secundarios visibles como moduladores
- la semana refleja la fase y genera warnings de incoherencia

Pendiente:

- comparacion mas detallada entre semana esperada y semana propuesta
- cerrar mejor la traduccion de macroplan a sugerencias concretas de ajuste
- afinar como macroplan modula especificamente cycling de soporte y mobility de descarga

### Progression y carga

Estado: fuerte

- progresion multi-semana en squash y fuerza
- running con tracking semanal y ACWR separado
- squash y fuerza ya tienen ACWR propio
- insights visibles para el atleta
- selectors y reglas con buena base de tests

Pendiente:

- convertir mas analytics en decisiones ejecutables, no solo visualizacion
- refinar thresholds con uso real
- mejorar lectura historica para que explique tendencia, no solo la muestre
- sumar capa cuantitativa mejor para cycling y decidir si mobility queda solo como soporte cualitativo

### Cycling y mobility

Estado: mucho mejor, ya no basico

- biblioteca de sesiones mas profunda para cycling
- movilidad ya no actua solo como relleno generico
- selectores mas sensibles a fase, fatiga, continuidad y rol dentro del atleta hibrido
- contrato de sesion explicito con `cyclingDetails` y `mobilityDetails`
- SessionCard muestra mejor contexto, estructura e intencion
- el prompt del coach ya empuja al modelo a emitir esos campos explicitamente

Pendiente:

- refinar ejemplos de `create_week` para que usen todavia mas el detalle dinamico real
- medir si el coach efectivamente usa estos campos de forma consistente en produccion
- integrar mejor cycling y mobility con alertas y ajustes automaticos del coach

### Alertas y activacion

Estado: intermedio-fuerte

- notificaciones locales operativas
- preferencias por categoria
- resync/debug de notificaciones
- alertas accionables ya visibles en dashboard
- CTA reales a chat, semana y check-in

Pendiente:

- reutilizar el mismo motor de alertas en WeeklyView y notificaciones
- cerrar el loop semanal completo con mas reactivacion automatica
- medir que alertas realmente hacen volver al usuario

### Sync

Estado: implementado pero sensible

- cola offline
- retry automatico
- dedupe
- tombstones
- repair de athlete_profiles
- backup/import/export
- mejor visibilidad de estado y cola pendiente

Pendiente:

- validacion fuerte movil + escritorio real
- conflictos concurrentes mejor resueltos o al menos mejor explicados
- mensajes todavia mas accionables cuando la cola queda retenida
- pruebas manuales y semi-automatizadas de convergencia

### Protocolos y ejecucion de sesion

Estado: fuerte

- running con intervalStructure para sesiones mas ejecutables
- warmup y cooldown checkables desde SessionCard
- feedback por sesion persistido y visible para el coach
- prompt reforzado para exigir warmup/cooldown y drills con timing

Pendiente:

- usar sessionFeedback para recomendaciones y ajustes mas explicitos
- tests UI puntuales de SessionCard expandido
- seguir refinando templates de intervalos para cycling en casos edge

### Tests y deuda tecnica

Estado: mucho mejor que antes

- suite de tests ampliada
- coverage operativa
- selectors, ACWR, macroplan, protocol engine, notificaciones y alertas ya cubiertos en logica critica
- selectors de cycling y mobility y contrato dinamico de prompt ya cubiertos en tests focalizados

Pendiente:

- seguir desacoplando syncService
- extraer mas bloques puros de promptBuilder
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

### 8. Notificaciones operativas

- permisos, scheduling y preferencias
- reglas para recordatorio de sesion, check-in, semana vacia, coach note y warning de coherencia
- panel de debug y resync en settings

### 9. Alertas accionables en dashboard

- motor puro de alertas
- priorizacion por severidad
- lectura unificada de coherencia, ACWR, adherencia y cierre de check-in
- CTA reales hacia accion concreta

### 10. Profundizacion de cycling y mobility

- `cyclingDetails` y `mobilityDetails` agregados como contrato explicito y compatible
- selector de cycling mas rico para soporte, build, taper/race y recovery
- selector de mobility mas util para reset post-deporte, activacion y mantenimiento de rango
- SessionCard ahora muestra mejor estructura, contexto e intensidad para estas disciplinas
- prompt del coach reforzado para emitir estos detalles en acciones

## Que hay hoy

Resumen simple del producto actual:

- una app usable para planificar, ejecutar y revisar entrenamiento hibrido
- un coach con contexto razonable y propuestas accionables
- un macroplan que ya se siente como sistema, no como texto decorativo
- una capa inicial de retencion y reactivacion
- una base casi lista para beta privada fuerte

## Que falta de verdad

Las brechas mas importantes no son tantas, pero si son profundas:

1. Validar sync en uso real entre dispositivos.
2. Convertir alertas y notificaciones en un loop semanal consistente.
3. Hacer que el coach ajuste mejor la semana usando historial y feedback.
4. Completar packaging de monetizacion y posicionamiento comercial.
5. Convertir mejoras recientes de disciplinas secundarias en comportamiento estable del coach.

## Roadmap vigente

### Fase 1 - Confiabilidad y loop semanal

Objetivo:
dejar la app lista para una beta privada fuerte, con menos riesgo operativo y una razon clara para volver cada semana.

Bloques:

1. Validacion real de sync y reconciliacion
2. Unificacion de alertas y notificaciones
3. Ajustes del coach guiados por alertas y feedback
4. Pulido de UX entre semana, chat y check-in

### Fase 2 - Coaching mas premium

Objetivo:
hacer que el producto se sienta claramente mejor que una planificacion semanal con dashboards.

Bloques:

1. Analytics mas prescriptivos por disciplina
2. Consolidacion y refinamiento de cycling y mobility
3. Continuidad del coach sobre historial real
4. Templates y recomendaciones mas finas por contexto

### Fase 3 - Monetizacion

Objetivo:
empaquetar el producto con pricing, valor percibido y limites claros.

Bloques:

1. modelo gratis vs pago
2. features premium de coach y analytics
3. packaging comercial y onboarding de conversion
4. soporte / recovery / confiabilidad nivel producto
5. instrumentacion minima de activacion y retencion

## Siguientes pasos recomendados

### Prioridad 1

**Validar y blindar sync entre movil y escritorio**

Alcance:

- create/edit/delete en dos dispositivos reales
- recovery offline
- cola retenida
- convergencia despues de volver online
- conflictos de edicion simultanea del mismo objeto

Por que:

- sigue siendo el mayor riesgo de producto
- es la principal barrera para cobrar con confianza

### Prioridad 2

**Unificar alertas accionables y notificaciones**

Alcance:

- reutilizar el motor de alertas en WeeklyView
- conectar notificaciones a la misma fuente de decision
- reducir duplicacion de reglas entre dashboard y notifications
- definir top alert semanal y top alert diaria

Por que:

- ya existe la infraestructura
- ahora el mayor retorno esta en cerrar el loop, no en crear otra capa nueva
- esto mejora retencion y coherencia del producto al mismo tiempo

### Prioridad 3

**Hacer que el coach ajuste, no solo explique**

Alcance:

- usar alertas, adherencia y feedback para sugerir acciones concretas
- convertir ciertos warnings en propuestas del coach
- priorizar deload, reordenamiento o recorte de soporte cuando haga sentido

Por que:

- esta es la diferencia entre un coach “inteligente” y un dashboard con texto
- aumenta mucho el valor percibido

### Prioridad 4

**Consolidar cycling y mobility**

Alcance:

- refinar ejemplos del coach para que usen siempre el detalle nuevo
- integrar mejor estas disciplinas con macroplan, alertas y ajustes automaticos
- revisar uso real para detectar salidas todavia genericas

Por que:

- el salto base ya esta dado
- ahora conviene consolidar comportamiento y no solo sumar mas biblioteca

## Priorizacion simple

Si hubiera que resumir el orden real desde hoy:

1. validar sync en dispositivos reales
2. unificar alertas + notificaciones + weekly loop
3. hacer que el coach proponga ajustes guiados por alertas
4. profundizar cycling y mobility
5. instrumentar activacion, retencion y monetizacion
6. abrir beta privada pagada

## Mejoras concretas posibles desde aqui

### Mejora 1 - Action center semanal

Una vista simple en dashboard o weekly view con:

- alerta principal de la semana
- 2 acciones recomendadas
- estado de adherencia
- estado de check-in pendiente

Impacto:

- alto
- bajo riesgo
- reutiliza mucho de lo ya construido

### Mejora 2 - Coach adjustment proposals

Cuando una alerta sea fuerte:

- generar sugerencia concreta del coach
- permitir aceptar ajuste rapido
- guardar razon del ajuste

Impacto:

- muy alto
- sube mucho el valor percibido

### Mejora 3 - Sync test matrix visible

Documento o panel interno con:

- casos cubiertos
- casos fallidos
- ultima fecha de validacion real

Impacto:

- alto para producto y confianza
- poco glamoroso pero necesario

### Mejora 4 - Weekly reactivation loop

- lunes: semana vacia
- mitad de semana: adherencia baja
- fin de dia: check-in pendiente
- warning fuerte: ajuste sugerido

Impacto:

- alto en retencion
- ya hay muchas piezas construidas

## Roadmap de monetizacion

### Posicionamiento recomendado

No vender "IA para entrenar" en general.

La propuesta mas defendible hoy es:

- coach digital para atleta hibrido
- especialmente fuerte en squash + running + fuerza
- con continuidad entre macroplan, semana, sesion y feedback real

### Modelo gratis vs pago recomendado

Gratis:

- registro de sesiones y check-ins
- vista semanal y dashboard base
- 1 deporte principal
- coach limitado para consultas simples
- notificaciones basicas

Pago:

- planificacion multi-deporte completa
- coach con propuestas ejecutables
- macroplan por evento y coherencia macroplan <-> semana
- analytics y alertas accionables
- protocolos de sesion avanzados
- historial y progresion por disciplina
- sync multi-dispositivo y recovery prioritario

### Packaging comercial inicial

Oferta recomendada para empezar:

- beta privada pagada, no lanzamiento abierto
- 1 solo plan de pago al principio
- evitar demasiados tiers en la primera iteracion

Hipotesis simple:

- free = utilidad basica y tracking
- paid = coach + plan + continuidad + multi-dispositivo

### Dependencias tecnicas minimas para cobrar

Antes de monetizar de verdad faltan estas piezas:

1. sync validado en movil y escritorio reales
2. metricas basicas de activacion y retencion
3. gating de features premium
4. estado de suscripcion o flag de acceso
5. paywall simple y claro
6. flujo minimo de alta / upgrade / restore

### Dependencias de producto minimas para cobrar

1. value proposition visible en onboarding
2. explicacion clara de por que pagar
3. una razon semanal fuerte para volver
4. feedback de beta privada con usuarios reales
5. definicion de para quien SI es y para quien NO es el producto

## Que falta para hacer la app vendible

La app ya tiene base para ser vendible, pero todavia faltan estas piezas para que se sienta lista comercialmente:

### 1. Confiabilidad operativa

- sync validado en uso real
- recovery claro cuando algo falla
- menos miedo a perder o duplicar datos

### 2. Retencion real

- loop semanal unificado
- notificaciones consistentes con alertas
- razones claras para volver a abrir la app

### 3. Coaching mas ejecutivo

- menos descripcion pasiva
- mas acciones y reajustes utiles
- mejor uso del feedback real

### 4. Packaging comercial

- pricing claro
- plan gratis vs pago
- value prop muy facil de entender
- onboarding orientado a conversion

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

## Criterio para empezar a monetizar

Se puede empezar a monetizar cuando se cumplan estas condiciones minimas:

1. sync validado en uso real con baja tasa de incidentes
2. loop semanal de uso ya visible en datos
3. paywall y acceso premium implementados
4. modelo gratis vs pago ya decidido y entendible
5. al menos 5-10 usuarios de beta privada usando el producto sin romperlo

Recomendacion:

- primero beta privada pagada
- despues recien apertura mas amplia

## Criterio de producto

Regla para las siguientes iteraciones:

1. primero, confiabilidad
2. despues, loop semanal y continuidad visible
3. despues, coaching mas ejecutivo
4. recien ahi, monetizacion fuerte

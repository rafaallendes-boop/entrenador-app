# Entrenador App - Review and Roadmap

Actualizado: 2026-04-09
Ultimo hito relevante: endurecimiento tecnico del weekly loop y propuestas del coach, con rollback mas seguro y confirm dialogs compartidos en flujos criticos

## Estado actual del producto

Entrenador ya no esta en fase de prototipo. Hoy existe una base seria para atletas hibridos, especialmente en squash + running + fuerza:

- planificacion semanal, vista diaria, historial y ajustes operativos
- coach AI con propuestas ejecutables y persistidas
- perfil estructurado del atleta con multi-deporte, recovery, schedule y nutricion
- onboarding y wizard de plan de competencia funcionando
- macroplan V2 por deporte ya visible y coherente con la semana
- sync multi-dispositivo, backup/import-export y recovery offline implementados
- analytics de carga, ACWR y progresion visibles
- protocolos de sesion mas ejecutables con warmup/cooldown y feedback por sesion
- notificaciones operativas con reglas por contexto
- alertas accionables en dashboard con CTA reales
- cycling y mobility ahora con mejor criterio de coaching, continuidad y estructura visible
- weekly action loop unificado visible en WeeklyView y reutilizado en dashboard y notificaciones
- squash ya distingue mejor partido de entrenamiento vs partido competitivo real
- rollback de propuestas del coach mas robusto para altas, updates y deletes
- confirm dialogs compartidos en los flujos criticos mas visibles

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
- weekly action engine compartido entre WeeklyView, dashboard y notificaciones
- WeeklyView elevado a superficie principal para actuar sobre la semana
- squashDetails ahora soporta `sessionMode` para distinguir drill, practice match y competition match
- tests unitarios ampliados para logica critica

## Lo que ya entrega valor real

Hoy el producto ya logra seis cosas importantes:

1. El atleta entiende que entrenar y por que.
2. El coach AI tiene mas contexto y menos margen para contradicciones obvias.
3. La planificacion multi-deporte es bastante mas segura que antes.
4. El usuario ya recibe senales concretas cuando una semana se desordena.
5. La semana ya tiene un centro de accion claro, no solo visualizacion.
6. Existe una base razonable para retencion semanal, no solo para generacion de planes.

## Lectura honesta del producto

### Lo fuerte hoy

- continuidad visible entre macroplan, semana, sesion y feedback
- coach AI cada vez mas util para ejecutar, no solo explicar
- analytics suficientemente buenos para empezar a guiar decisiones
- capa offline/sync ya mucho mas madura que la mayoria de apps tempranas
- loop semanal visible y accionable con una superficie principal clara

### Lo debil hoy

- sync sigue siendo el mayor riesgo comercial porque falta validacion en uso real duro
- el loop semanal ya existe, pero todavia falta volverlo mas automatico, medible y coherente con el coach
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
- CTA de ajuste semanal ya conectados con WeeklyView, chat y check-in

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
- afinar analytics de squash para distinguir mejor match-play de entrenamiento vs partido real sin romper historico

### Squash competitivo

Estado: mas fuerte y mas realista

- libreria squash ya soporta match-play de entrenamiento
- el planner puede proponer `subtype: match` con `sessionMode: practice_match`
- SessionCard distingue partido de entrenamiento vs partido real
- varias capas criticas ya no tratan automaticamente todo `match` como competencia real

Pendiente:

- enriquecer formatos de match-play con mas contexto y familias
- decidir si en el futuro conviene `sessionFamily` o subtype mas rico
- consolidar semantica competitiva en analytics e historial fino sin tocar demasiado el modelo

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

Estado: fuerte

- notificaciones locales operativas
- preferencias por categoria
- resync/debug de notificaciones
- alertas accionables ya visibles en dashboard
- loop semanal unificado con action center visible en WeeklyView
- dashboard y notificaciones ya reutilizan el mismo motor de decision

Pendiente:

- cerrar el loop semanal completo con mas reactivacion automatica
- hacer que el coach proponga ajustes mas precisos desde cada CTA del loop
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
- weekly action loop ya cubierto con tests de prioridad y estados base
- estado semanal blindado mejor frente a carreras de carga y errores silenciosos
- normalizacion AI mas estricta para evitar acciones malformadas

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

### 11. Weekly action loop unificado

- `weeklyActionLoop` como motor puro compartido
- WeeklyView convertido en action center de la semana
- dashboard reducido a resumen del mismo estado semanal
- notificaciones conectadas a la misma fuente de decision para semana vacia, coherencia, check-in y coach note
- CTA semanticos a `plan_builder`, `chat_adjust_week`, `today_checkin`, `today_detail` y `generate_coach_note`

### 12. Match-play de entrenamiento en squash

- `SquashDetails.sessionMode` agregado como semantica minima compatible
- `practice_match` habilitado como modalidad de entrenamiento en planner y prompt
- libreria squash ampliada con formatos base de partido de entrenamiento
- guards minimos para no tratar `practice_match` como competencia real en capas criticas
- badge especifico en SessionCard para distinguir partido de entrenamiento

### 13. Hardening tecnico del loop semanal

- `useTrainingStore` ya no mezcla semanas visibles ni deja datos viejos cuando falla `loadWeek`
- proposals del coach ahora guardan snapshots suficientes para rollback mas seguro de create, update y delete
- notifications ya reutiliza un solo `weeklyActionSummary` por sync
- `chatSession` usa acceso a storage mas defensivo
- confirmaciones criticas pasan a un modal compartido en vez de `window.confirm`

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
2. Hacer que el coach ajuste mejor la semana usando historial, feedback y el loop semanal ya unificado.
3. Convertir el loop semanal en reactivacion mas automatica y medible.
4. Completar packaging de monetizacion y posicionamiento comercial.
5. Convertir mejoras recientes de disciplinas secundarias en comportamiento estable del coach.
6. Consolidar mejor la semantica de squash competitivo entre planner, historial y analytics finos.
7. Completar rollback verdaderamente transaccional para propuestas complejas multi-accion con objetivos y week summaries.

## Roadmap vigente

### Fase 1 - Confiabilidad y loop semanal

Objetivo:
dejar la app lista para una beta privada fuerte, con menos riesgo operativo y una razon clara para volver cada semana.

Bloques:

1. Validacion real de sync y reconciliacion
2. Ajustes del coach guiados por alertas y feedback
3. Reactivacion semanal mas automatica y medible
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

**Hacer que el coach ajuste, no solo explique**

Alcance:

- usar alertas, adherencia y feedback para sugerir acciones concretas
- convertir ciertos warnings en propuestas del coach
- priorizar deload, reordenamiento o recorte de soporte cuando haga sentido

Por que:

- esta es la diferencia entre un coach "inteligente" y un dashboard con texto
- aumenta mucho el valor percibido

### Prioridad 3

**Medir y endurecer el weekly action loop**

Alcance:

- cerrar reactivacion automatica de lunes, mitad de semana y fin de dia
- medir que CTA se usan y cuales no
- reducir mas la duplicacion entre superficies y builders de notificaciones

Por que:

- el loop ya existe y ahora hay que volverlo confiable y medible
- esto define si la retencion semanal es real o solo potencial

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
2. hacer que el coach proponga ajustes guiados por alertas
3. endurecer y medir el weekly loop
4. profundizar cycling y mobility
5. consolidar squash competitivo y match-play
6. instrumentar activacion, retencion y monetizacion
7. abrir beta privada pagada

## Mejoras concretas posibles desde aqui

### Mejora 1 - Coach adjustment proposals

Cuando una alerta sea fuerte:

- generar sugerencia concreta del coach
- permitir aceptar ajuste rapido
- guardar razon del ajuste

Impacto:

- muy alto
- sube mucho el valor percibido

### Mejora 2 - Sync test matrix visible

Documento o panel interno con:

- casos cubiertos
- casos fallidos
- ultima fecha de validacion real

Impacto:

- alto para producto y confianza
- poco glamoroso pero necesario

### Mejora 3 - Weekly loop instrumentation

- monday empty-week trigger
- mid-week adherence trigger
- end-of-day check-in trigger
- uso de CTA por superficie

Impacto:

- alto en retencion
- convierte intuicion de producto en una senal medible

### Mejora 4 - Refactor UX-critical

Refactors de codigo con impacto directo en usabilidad:

- navegacion semantica de CTA semanales
- hooks compartidos para carga de semana y analytics
- contrato mas robusto para lanzar intents al chat

Impacto:

- medio-alto
- reduce friccion y deuda al mismo tiempo

## Revision tecnica de usabilidad

### Hallazgos prioritarios

1. Duplicacion de navegacion por CTA semanal.
2. Carga repetida de semana y analytics en varias pantallas.
3. Acoplamiento fragil con `location.state.composerDraft`.
4. Builders de notificaciones que recalculan el mismo resumen varias veces.
5. `DailyCheckInCard` mezcla panel, estado y edicion en un solo componente.
6. Uso disperso de `window.confirm`.
7. `promptBuilder.ts` sigue siendo un hotspot de complejidad estructural.

### Refactors recomendados

**Corto plazo**

- extraer un `weeklyActionNavigator` o hook equivalente para resolver CTA semanales desde una sola capa
- crear hooks compartidos para `loadWeek` y snapshots de analytics
- calcular `weeklyActionSummary` una sola vez dentro de notifications
- separar el panel reusable de check-in del contenedor especifico de "hoy"

**Medio plazo**

- reemplazar `composerDraft` libre por un contrato explicito de `chatLaunchIntent`
- reemplazar `window.confirm` por un modal compartido testeable
- extraer bloques puros de `promptBuilder` por disciplina y por accion
- seguir aislando rollback de proposals en una capa transaccional reusable

### Lectura final de la revision

- no hace falta una reescritura grande de stores
- si hace falta reducir acoplamientos de navegacion, carga y lanzamiento de intents
- el refactor con mejor retorno inmediato es centralizar la navegacion del weekly loop

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
2. reactivacion semanal estable y medible
3. coach con capacidad real de reajuste, no solo de explicacion
4. experiencia suficientemente consistente entre dashboard, semana y chat

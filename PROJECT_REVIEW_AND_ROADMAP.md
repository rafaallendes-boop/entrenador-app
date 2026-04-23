# Entrenador App - Review and Roadmap

Actualizado: 2026-04-23

## Resumen ejecutivo

El roadmap anterior estaba demasiado largo y ya mezclaba trabajo cerrado con trabajo pendiente. Hoy la base del producto ya es claramente usable:

- app React + TypeScript + Vite con superficies reales de semana, día, chat, onboarding, competition plan, import y settings
- local-first con Dexie + Zustand + sync a Supabase
- auth con Supabase + Google OAuth
- coach con proposals persistidas, aplicables y reversibles
- macroplan, analytics de carga, nutrición contextual y weekly loop visibles
- plan builder separado del chat
- `week_creator` ya operativo y enrutable desde chat

La lectura honesta hoy es esta:

- el producto ya no está en fase prototipo
- el mayor riesgo técnico sigue siendo sync/convergencia
- el mayor vacío de producto sigue siendo observabilidad y cierre del loop de activación
- monetización todavía no existe como sistema real

## Ya implementado y fuera del backlog principal

Esto ya existe en código y no debería volver como bloque grande:

- chat del coach con proposals ejecutables
- athlete profile estructurado y persistido
- onboarding guiado
- wizard de plan de competencia
- `plan_builder_redirect` desde chat para planes largos
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

1. Blindar `syncService` y recuperar build verde.
   Estado actual:
   - `tsc -b` sigue fallando por errores en `src/services/__tests__/syncService.test.ts` sobre `auth.supabase` posiblemente nulo.
   - sync sigue siendo el riesgo principal para beta multi-dispositivo.
   Falta:
   - corregir el contrato nulo en tests y helpers de auth/sync
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
   Falta:
   - QA manual de usuario nuevo sin perfil completo
   - QA de chat_action para asegurar que no cree semanas
   - QA del redirect a plan builder para requests de plan largo

### Medio

1. Seguir desacoplando piezas grandes y sensibles.
   Foco:
   - `syncService`
   - bloques puros del prompt builder / lógica del coach

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

Pendiente:

- más automatización desde alertas y feedback
- más medición de aceptación y utilidad real

### Sync

Estado: sensible

- la arquitectura existe
- el riesgo principal sigue abierto

Pendiente:

- corregir errores actuales de build/test
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

1. Dejar `tsc -b` y `build` en verde atacando primero `syncService.test.ts`.
2. Hacer una ronda corta de QA manual de sync + week creator + redirect a plan builder.
3. Agregar instrumentación mínima para proposals, alertas y aceptación.
4. Recién después abrir trabajo comercial de billing/paywall.

## Nota de revisión

Este roadmap intencionalmente deja fuera features ya cerradas. La prioridad real ya no es “sumar más módulos”, sino volver confiable, medible y operable lo que ya existe.

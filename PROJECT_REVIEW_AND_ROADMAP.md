# Entrenador App - Review and Roadmap

Generado: 2026-04-01
Actualizado: 2026-04-04

Base de revision:

- codigo del repo
- `npm run lint`
- `npm run build`

## Resumen ejecutivo

Entrenador ya esta en etapa de producto usable, no de prototipo base.

Hoy ya existen:

- plan semanal y vista diaria
- coach AI con propuestas ejecutables
- especializacion base del coach en squash, running y preparacion fisica aplicada
- coach con lectura mejorada de fatiga acumulada y taper competitivo
- coach con mejor jerarquia competitiva y reglas para bloques hibridos squash + running
- coach con inferencia implicita de prioridad competitiva desde memoria, mensajes y calendario
- propuestas de squash estructuradas con `squashDetails`
- UI de proposals con drills, focos de squash y mejor detalle visible
- chat multi-sesion con streaming
- Dexie local-first
- backup JSON con import/export, preview y modos `replace` / `merge`
- importacion PDF con carga diferida
- notificaciones reforzadas con recuperacion dentro de ventana de gracia y estado visible
- sync multi-dispositivo con Supabase + Google OAuth
- indicador visible de sync en navegacion

El foco real ya no es agregar features basicas. Las prioridades abiertas son:

- mejorar confiabilidad y UX de notificaciones
- seguir endureciendo sync y mantenimiento
- hacer mas usable el backup/restore
- pulir detalles puntuales de UX del coach y bajar respuestas genericas residuales
- preparar integraciones externas viables a futuro
- refinar analitica contextual y prioridad competitiva implicita del coach

## Estado verificado

Salud tecnica:

- `npm run lint`: OK
- `npm run build`: OK

Observaciones de build:

- `pdf.worker.min` sigue siendo el asset mas pesado
- el flujo PDF ya esta mejor aislado, pero sigue siendo la parte mas cara cuando esa pantalla se usa
- el resto del core esta razonablemente contenido

## Lo que ya esta cerrado

Estos temas ya no deberian seguir listados como roadmap principal:

- planner base del coach
- proposals persistidas
- chat multi-sesion
- streaming
- memoria del coach
- export/import JSON base
- sync multi-dispositivo base
- reload de stores post-sync
- indicador de sync en navegacion
- especializacion base del coach
- propuestas de squash estructuradas
- UX visible de proposals del coach
- backup versionado base
- preview de importacion y modos `replace` / `merge`
- lectura base de fatiga acumulada para taper
- jerarquia competitiva explicita y bloques hibridos base
- inferencia implicita de prioridad competitiva
- optimizacion principal del chunk de PDF
- limpieza principal de docs base

## Prioridades reales

### P1. Notificaciones mas confiables

La base ya esta bastante mejor, pero no equivale todavia a scheduling verdaderamente persistente del sistema.

Objetivo minimo:

- documentar limites reales por navegador
- seguir reduciendo misses en escenarios limite
- exponer mejor errores y reintentos, no solo estado programado

### P2. Sync UX y reglas de dominio

La base de sync ya esta mejor cerrada, pero aun puede crecer:

- evaluar realtime solo si aparece uso simultaneo real
- revisar visualmente estados de error, cola pendiente y recovery offline
- seguir endureciendo operaciones destructivas y reconciliacion

### P3. UX del coach y proposals

La parte importante del refinamiento del coach ya quedo cerrada. La UI de proposals muestra mejor el detalle, el taper considera senales base de fatiga y el prompt ya protege mejor la competencia objetivo inmediata incluso cuando el usuario no la explicita.

- queda solo como mejora incremental seguir reduciendo respuestas demasiado generales
- revisar visualmente ejemplos reales de semanas mixtas para detectar casos borde
- si se quiere un salto extra, el siguiente nivel ya no es prompt sino analitica mas estructurada

### P4. Backup mas avanzado — COMPLETADO (base)

Implementado 2026-04-04.

- se agrego comparacion tabla backup vs local en el preview (sesiones, check-ins, resumenes, mensajes, proposals)
- fecha del backup ahora formateada en espanol legible (antes era ISO crudo)
- se agrego rango de fechas de sesiones del backup en el preview

Pendiente a futuro:
- conflictos visibles en `merge` cuando lo local es mas nuevo
- migraciones futuras de backup mas alla de v1 -> v2

### P5. Integraciones externas de rendimiento y recuperacion

Es una linea de producto de largo plazo, no una prioridad inmediata del core.

Lectura actual:

- WHOOP si es una integracion realista para esta app
- Garmin existe, pero su acceso oficial esta mucho mas orientado a partners/business developers
- para un roadmap costo 0, WHOOP es claramente mejor candidato que Garmin

Objetivo minimo:

- definir modelo `external_metrics` separado del dato manual
- preparar OAuth backend con Supabase
- mapear `sleep`, `recovery`, `workout` y `body_measurement`
- usarlo primero como autocompletado o sugerencia, no como reemplazo del flujo manual

## Backlog priorizado

| Item | Impacto | Esfuerzo | Estado |
|------|---------|----------|--------|
| Robustecer notificaciones | Alto | Medio | Parcial |
| Reglas competitivas del coach | Alto | Medio | Cerrado base |
| Backup conflict-aware merge | Alto | Medio | Backlog |
| Realtime sync opcional | Medio | Medio | Backlog |
| Integracion WHOOP futura | Medio | Medio | Backlog |
| Integracion Garmin futura | Bajo | Alto | Exploracion |
| Modo torneo | Medio | Alto | Backlog |
| Analitica deportiva mas rica | Medio | Medio | Backlog |

## Riesgos actuales

### Notificaciones web

La plataforma web sigue imponiendo limites de persistencia y scheduling segun navegador.

### Experiencia visible del coach

El coach ya propone y muestra mejor el detalle, interpreta mejor fatiga acumulada, protege mejor la competencia objetivo inmediata y ya usa memoria y calendario para inferir prioridad competitiva. El riesgo restante es mas de calidad fina de respuestas que de vacio funcional.

### Backup futuro

El restore actual es seguro para el schema vigente y ya tiene preview y modos de importacion, pero aun faltan conflictos visibles en merge y migraciones futuras mas completas.

### Integraciones externas

WHOOP parece viable para una futura integracion low-cost. Garmin puede terminar bloqueado por acceso o aprobacion comercial antes que por complejidad tecnica.

## Recomendacion de ejecucion

Orden recomendado:

1. robustez adicional de notificaciones
2. merge conflict-aware en backup
3. analitica deportiva mas rica
4. robustez adicional del sync segun uso real
5. diseno tecnico de integracion WHOOP

## Referencias revisadas

- `src/services/syncService.ts`
- `src/services/auth.ts`
- `src/store/useAuthStore.ts`
- `src/store/useChatStore.ts`
- `src/store/useCoachActionsStore.ts`
- `src/store/useTrainingStore.ts`
- `src/services/dataExport.ts`
- `src/services/notifications.ts`
- `src/services/pdfImport.ts`
- `src/services/ai/promptBuilder.ts`
- `src/components/chat/ProposalDrawer.tsx`
- `src/pages/ImportPDF.tsx`
- `src/pages/SettingsPage.tsx`
- `src/App.tsx`
- `public/sw.js`

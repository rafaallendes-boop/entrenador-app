# Entrenador App - Review and Roadmap

Generado: 2026-04-01  
Actualizado: 2026-04-02

Base de revision:

- codigo del repo
- `npm run lint`
- `npm run build`

## Resumen ejecutivo

Entrenador ya esta en una etapa de producto usable, no de prototipo base.

Hoy ya existen:

- plan semanal y vista diaria
- coach AI con propuestas ejecutables
- chat multi-sesion con streaming
- Dexie local-first
- backup JSON con import/export
- importacion PDF
- notificaciones basicas
- sync multi-dispositivo con Supabase + Google OAuth

El trabajo prioritario ya no es agregar features basicas. El foco real es:

- bajar peso del flujo PDF
- seguir endureciendo sync y mantenimiento
- mejorar notificaciones
- pulir UX de producto ya existente

## Estado verificado

Salud tecnica:

- `npm run lint`: OK
- `npm run build`: OK

Observaciones de build:

- `pdf.worker.min` sigue siendo el asset mas pesado
- `ImportPDF` sigue siendo el chunk mas caro de la app
- el resto del core esta razonablemente contenido

## Lo que ya esta cerrado

Estos temas ya no deberian seguir listados como roadmap principal:

- planner base del coach
- proposals persistidas
- chat multi-sesion
- streaming
- memoria del coach
- export/import JSON
- sync multi-dispositivo base
- reload de stores post-sync
- limpieza principal de docs base

## Prioridades reales

### P1. Reducir peso del modulo PDF

Es el frente con mejor retorno tecnico inmediato.

Objetivo minimo:

- separar `pdfjs-dist` del chunk principal de `ImportPDF`
- cargar worker y libreria solo bajo demanda
- revisar si el parsing puede seguir partiendose en chunks dedicados

### P2. Notificaciones mas confiables

La base existe, pero no equivale todavia a scheduling verdaderamente persistente del sistema.

Objetivo minimo:

- mejor reprogramacion al volver a foco
- documentar limites reales por navegador
- seguir reduciendo duplicados o misses

### P3. Sync UX y reglas de dominio

La base de sync ya esta mejor cerrada, pero quedan decisiones de producto:

- indicador visible de sync fuera de Settings
- decidir que pasa con `coachProposals` cuando se borra una conversacion
- evaluar realtime solo si aparece uso simultaneo real

### P4. Backup mas avanzado

La importacion actual ya es util y endurecida, pero aun puede crecer:

- preview antes de restaurar
- opcion `merge` vs `replace`
- versionado y migraciones futuras de backup

## Backlog priorizado

| Item | Impacto | Esfuerzo | Estado |
|------|---------|----------|--------|
| Reducir peso de PDF import | Alto | Medio | En curso |
| Robustecer notificaciones | Alto | Medio | Parcial |
| Indicador sync en nav principal | Medio | Bajo | Pendiente |
| Politica de proposals al borrar chat | Medio | Bajo | Pendiente |
| Backup versionado + preview | Alto | Medio | Parcial |
| Realtime sync opcional | Medio | Medio | Backlog |
| Modo torneo | Medio | Alto | Backlog |
| Analitica deportiva mas rica | Medio | Medio | Backlog |

## Riesgos actuales

### Peso del flujo PDF

Sigue siendo la parte mas cara del bundle y del tiempo de carga asociado a esa pantalla.

### Notificaciones web

La plataforma web sigue imponiendo limites de persistencia y scheduling segun navegador.

### Reglas de borrado de chat/proposals

La semantica de dominio todavia puede generar dudas si se quiere que el borrado de una conversacion arrastre propuestas asociadas.

## Recomendacion de ejecucion

Orden recomendado:

1. optimizacion del flujo PDF
2. robustez adicional de notificaciones
3. indicador de sync en navegacion
4. definicion de reglas de proposals y mantenimiento

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
- `src/pages/ImportPDF.tsx`
- `src/pages/SettingsPage.tsx`
- `src/App.tsx`
- `public/sw.js`

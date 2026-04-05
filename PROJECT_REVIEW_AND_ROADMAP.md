# Entrenador App - Review and Roadmap

Generado: 2026-04-01
Actualizado: 2026-04-05

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
- coach con lectura mejorada de fatiga acumulada, taper competitivo y bloques hibridos squash + running
- coach con inferencia implicita de prioridad competitiva desde memoria, mensajes y calendario
- athlete profile estructurado para running, fuerza, recuperacion, nutricion y disponibilidad
- athlete profile explotado en el coach con ritmos y cargas de fuerza concretas desde el perfil
- personalizacion real por usuario en nombre visible, deporte principal y onboarding contextual
- propuestas de squash estructuradas con `squashDetails`
- UI de proposals con drills, focos de squash y mejor detalle visible
- chat multi-sesion con streaming
- Dexie local-first
- backup JSON con import/export, preview, versionado base y modos `replace` / `merge`
- importacion PDF con carga diferida
- notificaciones reforzadas con recuperacion dentro de ventana de gracia, estado visible y controles manuales
- sync multi-dispositivo con Supabase + Google OAuth
- indicador visible de sync en navegacion

El foco real ya no es agregar features basicas. Las prioridades abiertas son:

- mejorar confiabilidad y UX de notificaciones en escenarios reales de navegador
- seguir endureciendo sync y mantenimiento
- robustecer el modelo de nutricion e integrarlo mejor al coach
- preparar personalizacion real por usuario para uso compartido/comercial
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
- persiste la advertencia conocida de `INEFFECTIVE_DYNAMIC_IMPORT` en `src/db/db.ts`

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
- merge conflict-aware base
- lectura base de fatiga acumulada para taper
- jerarquia competitiva explicita y bloques hibridos base
- inferencia implicita de prioridad competitiva
- athlete profile estructurado persistido en ajustes
- explotacion del athlete profile en propuestas: paces y cargas reales inyectados en el prompt
- fuerza lower en semana base del coach
- personalizacion real por usuario: coach adaptado al deporte principal, seed anonimizado, login neutral y nudge de onboarding
- optimizacion principal del chunk de PDF
- limpieza principal de docs base
- limpieza del bloque duplicado de semana base en el prompt del coach

## Prioridades reales

### P1. Notificaciones mas confiables

La base ya esta claramente mejor, pero no equivale todavia a scheduling verdaderamente persistente del sistema.

Implementado recientemente:

- limpieza del estado del worker cuando no hay permiso o no hay sesiones para hoy
- debug visible con permiso, ultima reprogramacion y ultima limpieza
- botones manuales `Reprogramar hoy` y `Limpiar estado`
- handshake con `MessageChannel` para esperar confirmacion real del service worker antes de refrescar la UI
- limpieza de `localStorage` para no dejar tags enviados bloqueando nuevas notificaciones del mismo dia
- refresco automatico del permiso al volver a foco/visibilidad y, si el navegador lo soporta, via `navigator.permissions`

Pendiente a futuro:

- documentar limites reales por navegador con mas detalle
- validar comportamiento en suspension real de movil/PWA
- exponer mejor errores y estados limite, no solo estado programado
- decidir si conviene un aviso visible en Dashboard cuando el permiso esta bloqueado

### P2. Sync UX y reglas de dominio

La base de sync ya esta mejor cerrada, pero aun puede crecer:

- evaluar realtime solo si aparece uso simultaneo real
- revisar visualmente estados de error, cola pendiente y recovery offline
- seguir endureciendo operaciones destructivas y reconciliacion
- mejorar mensajes visibles cuando hubo recovery offline o sync atrasado

### P3. Nutricion mas robusta e integrada al coach

La capa actual de nutricion cumple como MVP, pero todavia esta menos madura que el resto del sistema.

Objetivo minimo:

- enriquecer el modelo de nutricion segun perfil, carga del dia y objetivo principal
- integrar mejor nutricion con el coach para sugerencias mas contextuales
- ajustar mejor comidas segun squash, running, fuerza, recuperacion y composicion corporal
- preparar recomendaciones mas personalizadas sin perder simplicidad de uso

### P4. Personalizacion real por usuario

La base ya esta, pero falta endurecerla pensando en terceros:

- separar configuracion de cuenta vs perfil deportivo si la app se ofrece a terceros
- mejorar onboarding para deportes que no sean squash ni running
- personalizar mejor saludo inicial y estados vacios segun objetivo principal del atleta
- revisar textos todavia demasiado ligados a tu caso de uso original

### P5. Integraciones externas de rendimiento y recuperacion

Es una linea de producto de largo plazo, no una prioridad inmediata del core.

Lectura actual:

- WHOOP si es una integracion realista para esta app
- Apple Health entra como integracion deseable si se quiere capturar datos de salud y actividad desde iPhone/Apple Watch
- Garmin existe, pero su acceso oficial esta mucho mas orientado a partners/business developers

Objetivo minimo:

- definir modelo `external_metrics` separado del dato manual
- preparar OAuth backend con Supabase
- mapear `sleep`, `recovery`, `workout` y `body_measurement`
- usarlo primero como autocompletado o sugerencia, no como reemplazo del flujo manual

### P6. Analitica deportiva mas rica

No como una pantalla de graficos por si misma, sino como mejor contexto para decisiones del coach.

Objetivo minimo:

- carga por disciplina
- tendencia de sueno, energia, dolor y adherencia
- lectura competitiva de squash
- consistencia y progresion de running
- contexto cuantitativo util para recomendaciones del coach

## Backlog priorizado

| Item | Impacto | Esfuerzo | Estado |
|------|---------|----------|--------|
| Robustecer notificaciones | Alto | Medio | Parcial |
| Nutricion mas robusta e integrada al coach | Alto | Medio | Backlog |
| Sync UX y recovery offline | Alto | Medio | Backlog |
| Personalizacion real por usuario | Alto | Medio | Parcial |
| Realtime sync opcional | Medio | Medio | Backlog |
| Integracion WHOOP futura | Medio | Medio | Backlog |
| Integracion Apple Health futura | Medio | Alto | Backlog |
| Integracion Garmin futura | Bajo | Alto | Exploracion |
| Analitica deportiva mas rica | Medio | Medio | Backlog |

## Riesgos actuales

### Notificaciones web

La plataforma web sigue imponiendo limites de persistencia y scheduling segun navegador. La app ya reacciona mejor a cambios de permiso y limpieza de estado, pero eso no equivale a triggers nativos del sistema operativo.

### Experiencia visible del coach

El coach ya propone y muestra mejor el detalle, usa memoria, calendario, contexto competitivo y athlete profile estructurado. El riesgo restante es principalmente calidad variable cuando el perfil esta incompleto o cuando el contexto nutricional todavia no se integra de forma fuerte.

### Backup futuro

El restore actual es seguro para el schema vigente y ya tiene preview, merge y conflictos base, pero aun faltan conflictos visibles a nivel de campo y migraciones futuras mas completas.

### Integraciones externas

WHOOP parece viable para una futura integracion low-cost. Apple Health pasa a ser candidato fuerte si el uso real aparece en iPhone/Apple Watch. Garmin puede terminar bloqueado por acceso o aprobacion comercial antes que por complejidad tecnica.

## Recomendacion de ejecucion

Orden recomendado:

1. nutricion mas robusta e integrada al coach
2. robustez adicional de notificaciones en movil real
3. sync UX y recovery offline
4. personalizacion real por usuario para uso compartido
5. analitica deportiva mas rica

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
- `src/services/nutritionEngine.ts`
- `src/components/chat/ProposalDrawer.tsx`
- `src/pages/ImportPDF.tsx`
- `src/pages/SettingsPage.tsx`
- `src/pages/ChatCoach.tsx`
- `src/App.tsx`
- `public/sw.js`

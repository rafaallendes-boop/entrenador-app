# Entrenador App - Review and Roadmap

Generado: 2026-04-01
Actualizado: 2026-04-05 (x6)

Base de revision:

- codigo del repo
- `npm run lint`
- `npm run build`

## Resumen ejecutivo

Entrenador ya esta en etapa de producto usable para atletas hibriditos con 5 deportes. La app paso de estar diseñada exclusivamente para Rafael a ser personalizable para cualquier atleta que combine squash, running, fuerza, movilidad y/o ciclismo.

Hoy ya existen:

- plan semanal y vista diaria
- coach AI con propuestas ejecutables
- especializacion modular del coach por deporte: squash (profundo), running, fuerza, movilidad, ciclismo
- reglas del coach solo se activan para deportes habilitados en el perfil del atleta
- coach con lectura mejorada de fatiga acumulada, taper competitivo y bloques hibridos multi-deporte
- coach con inferencia implicita de prioridad competitiva desde memoria, mensajes y calendario
- deteccion competitiva generalizada a cualquier sesion con subtype `match` o `competitive`
- athlete profile estructurado: running, fuerza, recuperacion, disponibilidad, nutricion, sportContext
- sportContext tipado: enabledSports, primarySport, secondarySports, trainingPriority
- helpers `getEnabledSports`, `getPrimarySportNormalized`, `getSportPrioritySummary` como fuente de verdad
- athlete profile explotado en el coach: paces de running, cargas de fuerza y contexto nutricional desde el perfil
- nutricion integrada al coach: seccion de prompt con carga del dia, timing, protocolo competitivo y composicion corporal
- onboarding wizard de 4 pasos (disciplinas → deporte principal → objetivo → disponibilidad)
- OnboardingGuard con escape hatch para usuarios legacy
- AthleteProfileEditor con UI estructurada de sportContext (chips de deporte + prioridad)
- 5 tipos de sesion: squash, running, cycling, strength, mobility (+ recovery, nutrition)
- cycling como SessionType real con campos de pace/HR compartidos con running
- templates de semana base para cycling-first y strength-first en el coach
- propuestas de squash estructuradas con `squashDetails`
- UI de proposals con drills, focos de squash y mejor detalle visible
- chat multi-sesion con streaming
- Dexie local-first
- backup JSON con import/export, preview, versionado base y modos `replace` / `merge` conflict-aware
- importacion PDF con carga diferida
- notificaciones reforzadas con recuperacion dentro de ventana de gracia, estado visible y controles manuales
- sync multi-dispositivo con Supabase + Google OAuth
- indicador visible de sync en navegacion

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
- banner de perfil incompleto en ChatCoach
- nutricion integrada al coach: contexto dinamico por carga del dia, protocolo competitivo, composicion corporal desde perfil
- NutritionProfile en AthleteProfile con seccion en el editor de ajustes
- optimizacion principal del chunk de PDF
- limpieza principal de docs base
- limpieza del bloque duplicado de semana base en el prompt del coach
- apertura multi-deporte: SupportedSport, TrainingPriority, sportContext tipado en AthleteProfile
- helpers de deporte: normalizeSport, getEnabledSports, getSportPrioritySummary
- onboarding wizard de 4 pasos con OnboardingGuard y escape hatch legacy
- promptBuilder modular: 5 secciones por deporte, solo activas si el deporte esta habilitado, defaults squash eliminados
- deteccion competitiva generalizada (subtype match/competitive, no solo type squash)
- cycling como SessionType con campos pace/HR en modal y store
- templates de semana base cycling-first y strength-first en el coach
- AthleteProfileEditor con sportContext UI (chips de deporte + prioridad, reemplaza free-text legacy)
- profundidad tactica cycling: Z2/tempo-sweetspot/intervalos/long ride, cadencia, indoor vs outdoor, cruce de fatiga con running
- profundidad tactica mobility: focos articulares por zona (cadera/tobillo/hombro/toracica), cuando programar, regla movilidad estatica vs fuerza
- buildCompetitionSection y buildCompetitionLoadSection generalizados por deporte: "partido" / "carrera" / "evento de ciclismo" segun sesion real
- nutritionEngine: deteccion de match generalizada a cualquier subtype match/competitive (no solo squash)
- card de nutricion en vista diaria (DayDetail): carga del dia, foco nutricional, pre/post-entreno e hidratacion — sin abrir el chat

## Prioridades reales

### P1. Notificaciones mas confiables

La base ya esta claramente mejor, pero no equivale todavia a scheduling verdaderamente persistente del sistema.

Implementado:

- limpieza del estado del worker cuando no hay permiso o no hay sesiones para hoy
- debug visible con permiso, ultima reprogramacion y ultima limpieza
- botones manuales `Reprogramar hoy` y `Limpiar estado`
- handshake con `MessageChannel` para esperar confirmacion real del service worker
- limpieza de `localStorage` para no dejar tags enviados bloqueando nuevas notificaciones del mismo dia
- refresco automatico del permiso al volver a foco/visibilidad via `navigator.permissions`

Pendiente:

- validar comportamiento en suspension real de movil/PWA
- aviso visible en Dashboard cuando el permiso esta bloqueado
- exponer errores de scheduling de forma mas clara para el usuario

### P2. Sync UX y reglas de dominio

La base de sync ya esta cerrada, pero aun puede crecer:

- estados de error y cola pendiente visibles en la UI
- mensajes cuando hubo recovery offline o sync atrasado
- endurecimiento de operaciones destructivas y reconciliacion
- evaluar realtime solo si aparece uso simultaneo real

### P3. Analytics: carga acumulada por disciplina

No como una pantalla de graficos separada, sino como contexto cuantitativo directo para el coach y para el usuario.

Objetivo minimo viable:

- carga semanal y mensual por tipo de sesion (squash, running, cycling, strength)
- tendencia de adherencia (sesiones planificadas vs completadas)
- consistencia de running por semana (km/tiempo acumulado)
- contexto inyectable en el prompt del coach cuando lo necesite

Esto puede vivir como una funcion de `promptBuilder.ts` que lee el historico de sesiones, sin necesidad de una pagina de analytics nueva.

### P4. Personalizacion profunda por usuario (para terceros)

La base ya esta, pero si la app se abre a terceros:

- separar configuracion de cuenta (email, login) vs perfil deportivo
- saludo inicial y estados vacios personalizados por deporte principal (no solo "hola, veo que entrenas squash...")
- textos del coach que todavia asumen squash como deporte implicito
- evaluar si el onboarding debe ser obligatorio o skipable con perfil minimal

### P5. Integraciones externas de rendimiento y recuperacion

Linea de producto de largo plazo:

- WHOOP: via OAuth backend + Supabase, mapear sleep/recovery/strain
- Apple Health: integracion deseable para datos de salud e iPhone/Apple Watch
- Garmin: bloqueado probablemente por acceso comercial
- Modelo `external_metrics` separado del dato manual para no mezclar fuentes

## Backlog priorizado

| Item | Impacto | Esfuerzo | Estado |
|------|---------|----------|--------|
| Profundidad tactica cycling + mobility | Alto | Bajo | Cerrado |
| buildCompetitionSection por deporte | Alto | Bajo | Cerrado |
| Nutricion en vista diaria | Medio | Bajo | Cerrado |
| Robustecer notificaciones | Alto | Medio | Parcial |
| Analytics carga por disciplina | Alto | Medio | Backlog |
| Sync UX y recovery offline | Alto | Medio | Backlog |
| Personalizacion profunda para terceros | Alto | Medio | Parcial |
| Realtime sync opcional | Medio | Medio | Backlog |
| Integracion WHOOP futura | Medio | Medio | Backlog |
| Integracion Apple Health futura | Medio | Alto | Backlog |
| Integracion Garmin futura | Bajo | Alto | Exploracion |

## Riesgos actuales

### Coach con perfil incompleto

El coach es mucho mas util con sportContext completo. Si el usuario completo onboarding solo con deporte principal pero sin datos de running (paces) o fuerza (cargas), las propuestas caen a estimaciones genericas. El aviso en ChatCoach ayuda, pero no fuerza el llenado.

### Cycling y mobility como ciudadanos de segunda

Las secciones de reglas de cycling y mobility son MVP. Si un usuario de cycling como deporte principal usa intensamente el coach, va a notar que el conocimiento es mas superficial que el de squash o running.

### Notificaciones web

La plataforma web sigue imponiendo limites de persistencia segun navegador. La app ya reacciona mejor, pero en suspension real de movil/PWA el comportamiento no esta validado.

### Backup futuro

El restore tiene preview, merge conflict-aware y panel de conflictos estimados, pero aun faltan conflictos visibles a nivel de campo y migraciones futuras mas completas.

### Integraciones externas

WHOOP parece viable low-cost. Apple Health candidato fuerte para iPhone/Watch. Garmin puede quedar bloqueado por aprobacion comercial.

## Recomendacion de ejecucion

Orden recomendado para proximas iteraciones:

1. ~~Profundidad tactica cycling + mobility~~ — COMPLETADO 2026-04-05
2. ~~buildCompetitionSection generalizado por deporte~~ — COMPLETADO 2026-04-05
3. ~~Nutricion en vista diaria~~ — COMPLETADO 2026-04-05
4. Analytics carga por disciplina (esfuerzo medio, alta utilidad para el coach y el usuario)
5. Notificaciones en movil real (requiere validacion manual en dispositivo fisico)
6. Sync UX y recovery offline
7. Personalizacion profunda para terceros

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
- `src/services/nutritionEngine.ts`
- `src/services/ai/promptBuilder.ts`
- `src/utils/athlete.ts`
- `src/components/chat/ProposalDrawer.tsx`
- `src/components/settings/AthleteProfileEditor.tsx`
- `src/pages/OnboardingPage.tsx`
- `src/pages/ImportPDF.tsx`
- `src/pages/SettingsPage.tsx`
- `src/pages/ChatCoach.tsx`
- `src/App.tsx`
- `src/constants/sessionTypes.ts`
- `src/constants/routes.ts`
- `public/sw.js`

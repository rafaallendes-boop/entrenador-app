# Entrenador App

Entrenador es una PWA para planificar, registrar y ajustar entrenamiento deportivo con apoyo de un coach AI.

La app nacio para uso personal en squash, running, fuerza, movilidad y recuperacion, pero hoy ya esta evolucionando hacia una base multiusuario y potencialmente comercial.

## Que hace el proyecto

Entrenador reune en una sola app:

- planificacion semanal y vista diaria de sesiones
- seguimiento real de carga, adherencia y sensaciones
- check-ins de sueno, energia, dolor, peso y comentarios post sesion
- coach AI con propuestas ejecutables sobre el plan
- perfil estructurado del atleta para personalizar recomendaciones
- backup JSON local con import/export
- sincronizacion multi-dispositivo con Supabase
- PWA instalable en celular y escritorio
- notificaciones web para sesiones del dia

No es solo un chat. El foco del producto es que el coach pueda:

- entender el contexto del atleta
- leer la semana actual
- proponer cambios concretos
- aplicar esos cambios al plan usando acciones estructuradas

## Casos de uso principales

- crear una semana de entrenamiento desde cero
- ajustar la semana por fatiga, dolor, competencia o falta de tiempo
- registrar que se hizo realmente
- revisar adherencia y volumen semanal
- mantener contexto persistente del atleta
- respaldar o restaurar la informacion
- usar la misma cuenta en mas de un dispositivo

## Estado actual del producto

Hoy el proyecto ya tiene una base funcional bastante completa:

- React + TypeScript + Vite
- Zustand para estado local de UI y dominio
- Dexie / IndexedDB como base local-first
- Supabase para auth y sync multi-dispositivo
- service worker y modo instalable tipo app
- importacion PDF con carga diferida
- coach AI con providers intercambiables
- backup versionado con `preview`, `merge` y `replace`
- notificaciones con estado visible y reprogramacion manual

Tambien ya existen:

- proposals del coach persistidas
- reglas competitivas y taper para squash
- soporte para `athleteProfile` con running, fuerza, recuperacion, nutricion y disponibilidad
- nombre visible del atleta configurable
- semana base del coach adaptada al deporte principal del perfil

## Stack tecnico

### Frontend

- `React 19`
- `TypeScript`
- `Vite`
- `React Router`
- `Zustand`
- `Tailwind CSS`
- `Lucide React`

### Persistencia y datos

- `Dexie` sobre `IndexedDB` para almacenamiento local
- `Supabase` para autenticacion y sincronizacion

### IA

Arquitectura de coach con providers normalizados:

- `mock`
- `gemini`
- `openai`
- `claude`
- `proxy`

En produccion la ruta recomendada es `proxy` via Netlify Functions para no exponer API keys en el cliente.

### Otros componentes relevantes

- `pdfjs-dist` para importacion de PDFs
- `date-fns` para manejo de fechas
- service worker para PWA y notificaciones

## Arquitectura general

Flujo simplificado:

```text
UI React
  -> Zustand stores
  -> Dexie / IndexedDB
  -> servicios de dominio (coach, backup, sync, notificaciones, nutricion)
  -> Supabase / AI provider / service worker
```

Principios del proyecto:

- local-first
- la app debe seguir siendo usable sin red
- el coach no responde solo texto: puede generar acciones aplicables
- el modelo de dominio importa mas que una UI de demo

## Modulos importantes

### 1. Planificacion y seguimiento

Permite:

- crear sesiones manualmente o desde el coach
- editar duracion, RPE, objetivo y ejercicios
- marcar sesiones como `planned`, `completed`, `adjusted` o `skipped`
- revisar resumen semanal con adherencia y volumen

### 2. Coach AI

El coach construye prompts a partir de:

- sesiones recientes y futuras
- resumen semanal
- logs diarios
- memoria libre del atleta
- `athleteProfile` estructurado
- contexto competitivo

Puede sugerir acciones como:

- `create_week`
- `add_session`
- `update_session`
- `move_session`
- `skip_session`
- `insert_recovery`

Las propuestas se guardan y luego pueden aceptarse o rechazarse desde la UI.

### 3. Athlete Profile

El `AthleteProfile` agrega contexto persistente mas util que una simple nota libre.

Hoy soporta:

- nombre visible
- deporte principal y secundarios
- objetivos
- marcas y ritmos de running
- 1RM de fuerza y referencias
- lesiones, restricciones y disponibilidad semanal
- datos base de nutricion

Esto permite que el coach empiece a dar recomendaciones mas personalizadas.

### 4. Nutricion

Existe una capa MVP de nutricion que entrega recomendaciones segun la carga del dia.

Hoy sirve como base para:

- foco diario
- hidratacion
- sugerencias pre/post entrenamiento
- estructura general de comidas

Sigue siendo una parte menos madura que el coach principal y es una de las prioridades abiertas.

### 5. Backup y restore

La app puede exportar e importar un backup JSON con:

- sesiones
- check-ins
- resumenes semanales
- mensajes
- proposals
- memoria y perfil del atleta

El restore soporta:

- `replace`
- `merge`
- preview antes de importar
- validacion estructural
- versionado base del formato
- resolucion base de conflictos por `updatedAt`

### 6. Sync multi-dispositivo

La app ya no depende solo del navegador local.

Con Supabase puedes:

- iniciar sesion
- mantener datos asociados al usuario
- sincronizar entre dispositivos

La estrategia sigue siendo `local-first`, con sync posterior.

### 7. Notificaciones

La app puede programar notificaciones para sesiones del dia.

Hoy ya incluye:

- reprogramacion automatica al volver a foco
- recuperacion de avisos recientes dentro de una ventana de gracia
- estado visible en Ajustes
- reprogramacion y limpieza manual
- refresco del permiso al volver a la app

Importante: en web esto sigue dependiendo de las limitaciones del navegador y del service worker.

## Estructura aproximada del repo

Rutas importantes:

- `src/pages/`
  pantallas principales como dashboard, semana, dia, coach, ajustes e importacion PDF
- `src/components/`
  componentes visuales y de dominio
- `src/store/`
  stores Zustand
- `src/services/`
  logica de IA, backup, notificaciones, sync, nutricion y mantenimiento
- `src/db/`
  Dexie, queries y seed
- `netlify/functions/`
  proxy serverless para IA en produccion
- `public/sw.js`
  service worker

## Como correrlo en local

Requisitos:

- Node.js 18+
- npm

Instalacion:

```bash
npm install
```

Desarrollo:

```bash
npm run dev
```

Lint:

```bash
npm run lint
```

Build:

```bash
npm run build
```

Preview local del build:

```bash
npm run preview
```

## Variables de entorno

La app puede funcionar en modo local/mock, pero para IA real y sync necesitas variables de entorno.

### Frontend

Dependiendo de tu configuracion, puedes necesitar variables tipo:

- `VITE_AI_PROVIDER`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Produccion segura con Netlify

Para no exponer keys del proveedor AI en el bundle del cliente, la estrategia recomendada es:

- frontend en Netlify
- llamadas del cliente a `/.netlify/functions/coach`
- provider real resuelto en la function

Variables tipicas del lado servidor:

- `AI_PROVIDER=gemini`
- `GEMINI_API_KEY=...`

o equivalentes para OpenAI / Claude.

Mas detalle en:

- [NETLIFY_PRODUCTION_READY.md](/c:/Users/RafaelAllendesPerez/.gemini/antigravity/scratch/Entrenador_App/NETLIFY_PRODUCTION_READY.md)

## Uso como PWA

La app puede instalarse como aplicacion:

### Android

1. Abrir en Chrome.
2. Elegir `Instalar app` o `Agregar a pantalla principal`.

### iPhone

1. Abrir en Safari.
2. Compartir.
3. Elegir `Agregar a pantalla de inicio`.

## Que datos guarda

Localmente:

- sesiones
- day logs
- resumenes semanales
- historial de chat
- proposals
- athlete profile

Remotamente, si activas sync:

- las mismas entidades de dominio, asociadas a la cuenta autenticada

## Limitaciones actuales

Estas son las mas importantes hoy:

- las notificaciones web dependen de limites del navegador
- el scheduling no equivale a notificaciones nativas del sistema operativo
- el flujo PDF sigue siendo la parte mas pesada del build cuando se usa
- la nutricion sigue en estado MVP comparada con el coach principal
- el sync esta bastante solido, pero todavia puede endurecerse mas en casos borde
- persiste la advertencia conocida de `INEFFECTIVE_DYNAMIC_IMPORT` en `src/db/db.ts`

## Roadmap resumido

Las lineas abiertas mas relevantes hoy son:

- robustecer notificaciones en escenarios reales de navegador
- enriquecer el modulo de nutricion e integrarlo mejor al coach
- seguir avanzando en personalizacion real por usuario
- mejorar UX de sync y recovery offline
- evaluar integraciones externas como WHOOP y Apple Health
- construir una analitica deportiva mas rica

Roadmap completo:

- [PROJECT_REVIEW_AND_ROADMAP.md](/c:/Users/RafaelAllendesPerez/.gemini/antigravity/scratch/Entrenador_App/PROJECT_REVIEW_AND_ROADMAP.md)

## Documentos utiles del repo

- [PROJECT_REVIEW_AND_ROADMAP.md](/c:/Users/RafaelAllendesPerez/.gemini/antigravity/scratch/Entrenador_App/PROJECT_REVIEW_AND_ROADMAP.md)
- [NETLIFY_PRODUCTION_READY.md](/c:/Users/RafaelAllendesPerez/.gemini/antigravity/scratch/Entrenador_App/NETLIFY_PRODUCTION_READY.md)
- [MULTI_DEVICE_SYNC_FOR_NETLIFY_APP.md](/c:/Users/RafaelAllendesPerez/.gemini/antigravity/scratch/Entrenador_App/MULTI_DEVICE_SYNC_FOR_NETLIFY_APP.md)
- [AI_INTEGRATION_PLAN.md](/c:/Users/RafaelAllendesPerez/.gemini/antigravity/scratch/Entrenador_App/AI_INTEGRATION_PLAN.md)
- [COACH_PLANNER_IMPROVEMENTS.md](/c:/Users/RafaelAllendesPerez/.gemini/antigravity/scratch/Entrenador_App/COACH_PLANNER_IMPROVEMENTS.md)
- [COACH_STABILITY_AND_PLANNER_FIXES.md](/c:/Users/RafaelAllendesPerez/.gemini/antigravity/scratch/Entrenador_App/COACH_STABILITY_AND_PLANNER_FIXES.md)

## En que etapa esta el proyecto

No esta en fase de idea ni en MVP vacio.

Tampoco esta todavia en producto comercial totalmente endurecido.

La mejor forma de describirlo hoy es:

- producto usable
- base tecnica ya seria
- con foco actual en robustez, personalizacion y preparacion para uso por terceros

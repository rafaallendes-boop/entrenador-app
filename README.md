# RallyIQ

RallyIQ es una PWA local-first para planificar, ajustar y registrar entrenamiento deportivo con apoyo de un coach AI. Nacio para uso personal en squash, running, fuerza, movilidad y recuperacion, y hoy esta evolucionando hacia un piloto cerrado con foco en robustez real antes de abrirla a mas usuarios.

El producto no es solo un chat: el coach entiende contexto, propone cambios estructurados y puede convertirlos en acciones aplicables sobre la semana o sobre un plan de competencia.

## Estado Actual

La app esta en una fase de **piloto interno avanzado**:

- usable en dev con Gemini via proxy o provider local
- con sync multi-dispositivo sobre Supabase
- con almacenamiento local en IndexedDB
- con propuestas del coach aceptables/rechazables
- con Plan Builder por evento competitivo
- con telemetria local de calidad beta y export
- con suites E2E para coach, week creator y Plan Builder
- con soporte para atletas gestionados, roster y cambio de atleta activo
- con integracion opcional de Whoop para readiness, sueno, strain y prefill editable del check-in

No esta lista todavia para una beta abierta o pagada. Antes de eso hay que cerrar el smoke operativo y el consentimiento biometrico de Whoop, seguir endureciendo la calidad del coach y realizar pruebas multi-dispositivo reales.

## Funcionalidades Principales

- Planificacion semanal y vista diaria de sesiones.
- Registro de sesiones completadas, ajustadas u omitidas.
- Check-ins diarios de energia, sueno, dolor, peso y comentarios.
- Coach AI con respuestas conversacionales y propuestas aplicables.
- Creacion de semanas completas desde el coach.
- Plan Builder para eventos competitivos.
- Perfil estructurado del atleta.
- Deportes soportados: squash, running, fuerza, movilidad, cycling y recuperacion.
- Nutricion contextual segun carga del dia.
- Import/export de backup JSON.
- Importacion de planificaciones desde PDF.
- Sync multi-dispositivo con Supabase.
- Roster de atletas gestionados y selector de atleta activo para cuentas coach autorizadas.
- Integracion opcional de Whoop: recovery, sueno y strain; prefill editable y contexto pasivo para el coach.
- PWA instalable en desktop y mobile.
- Notificaciones web para sesiones del dia.
- Panel local de debug/quality para revisar requests AI, feedback y limites.

## Stack

### Frontend

- React 19
- TypeScript
- Vite
- React Router
- Zustand
- Tailwind CSS
- Lucide React

### Datos

- Dexie sobre IndexedDB para persistencia local-first.
- Supabase para auth y sincronizacion remota.
- JSON export/import para backup y restore.

### AI

Providers soportados por contrato comun:

- `mock`
- `gemini`
- `openai`
- `claude`
- `proxy`

En produccion, la ruta recomendada es `proxy` mediante Netlify Functions para no exponer API keys en el bundle del cliente.

## Arquitectura

Flujo simplificado:

```text
UI React
  -> Zustand stores
  -> Dexie / IndexedDB
  -> servicios de dominio
  -> Supabase / Netlify Function / AI provider / Service Worker
```

Principios de diseno:

- Local-first: la app debe seguir siendo usable aunque la red falle.
- AI asistida, no AI sin control: los outputs pasan por normalizadores, validaciones y reparaciones.
- Acciones estructuradas: el coach no solo responde texto, tambien propone cambios aplicables.
- Dominio deportivo primero: selectors y planners deterministas sostienen parte importante de la calidad.
- Observabilidad beta: cada request importante debe dejar senales revisables.

## Modulos Importantes

### Coach AI

El coach usa contexto de:

- semana actual
- sesiones recientes y futuras
- day logs
- memoria libre del coach
- perfil estructurado del atleta
- deportes habilitados
- contexto competitivo
- restricciones, fatiga y disponibilidad

Puede producir acciones como:

- `create_week`
- `add_session`
- `update_session`
- `move_session`
- `skip_session`
- `insert_recovery`

Las acciones se muestran como propuestas antes de aplicarse. El flujo tiene prevalidacion y rollback si algo falla durante la aplicacion.

### Week Creator

El week creator genera semanas completas y combina:

- prompt especializado
- normalizacion de respuesta
- reparacion de sesiones
- selectors deportivos deterministas
- fallback local si el provider no entrega una semana valida

La meta es que una semana generada sea razonable para usarla, no solo una lista bonita de sesiones.

### Plan Builder

El Plan Builder crea planes por evento competitivo:

- wizard de evento en `/competition-plan`
- builder en `/plans/builder`
- shell de semanas por fases
- generacion semanal con AI
- validaciones por semana
- regeneracion de semanas fallidas
- aceptacion del plan hacia la vista semanal

Comandos E2E dedicados permiten probarlo sin guardar, generando o aceptando el plan.

### Fuerza y Preparacion Fisica

La seleccion de fuerza considera:

- duracion objetivo
- fase del plan
- fatiga
- competencia cercana
- progresion
- historial
- perfil deportivo

Para sesiones de 45-60 minutos, la app busca una densidad razonable y evita que una preparacion fisica quede reducida a 3 ejercicios salvo caso extremo.

### Squash

El squash transporta una modalidad estructural de sesión, independiente del
título, el objetivo y el foco deportivo:

- `control`: pelota en solitario;
- `technical`: trabajo cooperativo o condicionado con partner;
- `shadows`: desplazamientos sin pelota;
- `match`: juego con rival y marcador.

Cada drill del catálogo declara además cómo se ejecuta:

- `solo`
- `partner`
- `match`

`either` no es una modalidad de drill: sólo representa que la disponibilidad de
partner todavía no está definida. Plan Builder, Crear semana, chat, formulario
y plantillas preservan la misma modalidad sin inferirla desde texto. Un partido
puede ser una sesión dedicada o un bloque final, según su composición.

### Athlete Profile

El perfil estructurado guarda:

- nombre visible
- deporte principal y secundarios
- objetivo deportivo
- eventos objetivo
- disponibilidad semanal
- historial y preferencias
- ritmos y marcas de running
- referencias de fuerza
- lesiones y restricciones
- preferencias nutricionales

Esto alimenta al coach, week creator y plan builder.

### Nutricion

La capa de nutricion clasifica el dia segun carga:

- `rest`
- `light`
- `moderate`
- `high`
- `double_session`
- `competition`
- `recovery`

Entrega foco, accion clave, timing, hidratacion y nota de recuperacion cuando aplica.

### Sync Multi-Dispositivo

La app usa Supabase para sincronizar entidades del dominio entre dispositivos, manteniendo IndexedDB como fuente local operativa. El sync incluye diagnostico visible en Ajustes y herramientas manuales para reintentar o limpiar cola.

### Coach y Multi-Atleta

Las cuentas coach autorizadas pueden crear atletas gestionados, alternar el atleta activo y operar el mismo flujo de planificación sin mezclar datos. El alcance por atleta se aplica tanto a las lecturas locales como al sync remoto.

### Whoop Readiness

Whoop es opcional. La conexión OAuth y los datos crudos se procesan solo en servidor; el cliente consume un resumen diario de readiness. Recovery, sueño y strain pueden precargar el check-in de forma editable y aportar contexto pasivo al coach; no ajustan planes automáticamente ni sustituyen consejo médico.

### Backup y Restore

El backup JSON cubre:

- sesiones
- day logs
- resumenes semanales
- mensajes de chat
- propuestas
- memoria del coach
- athlete profile
- datos relacionados al plan

El restore soporta preview, merge, replace y validacion estructural.

## Estructura del Repo

```text
src/
  components/       Componentes visuales y de dominio
  constants/        Rutas y constantes compartidas
  db/               Dexie, schema local y seed
  hooks/            Hooks de UI/dominio
  pages/            Pantallas principales
  services/         Coach, AI, sync, backup, plan builder, training, nutricion
  store/            Stores Zustand
  types/            Tipos centrales del dominio
  utils/            Fechas, schedule, UUID, helpers

netlify/functions/  Proxy serverless para AI
public/             Assets, manifest y service worker
scripts/            E2E, load tests y audit de prompts
```

## Instalacion

Requisitos:

- Node.js 20.19+ (o 22.12+)
- npm

Instalar dependencias:

```bash
npm install
```

Levantar dev server:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Preview del build:

```bash
npm run preview
```

### iOS con Capacitor

El proyecto incluye un contenedor iOS Capacitor que empaqueta el mismo build React/Vite sin reemplazar la PWA ni migrar Dexie. Para requisitos de Xcode, deep links Supabase, notificaciones, comandos y checklist de TestFlight, consulta [docs/ios-capacitor.md](docs/ios-capacitor.md).

```bash
npm run ios:sync
npm run ios:open
```

## Variables de Entorno

La app puede correr en modo mock/local, pero para IA real, auth y sync necesitas variables.

### Entitlements por plan

| Variable | Ámbito | Default | Qué hace |
|---|---|---|---|
| `ENTITLEMENTS_ENABLED` | Servidor (runtime) | apagado | Enciende el gate en `coach.ts`, `enqueue-plan-generation` y `generate-plan-background`. Sólo la cadena exacta `true`. |
| `VITE_ENTITLEMENTS` | Cliente (build-time) | apagado | Enciende sólo el ocultamiento proactivo de affordances. El manejo del 403 va siempre encendido. |

**Orden de rollout, no negociable:**

1. Aplicar `supabase/020_user_entitlements.sql` a mano en producción.
2. **Asignarse `advanced`**, o al encender el gate se pierde Plan Builder en la
   propia cuenta (ausencia de fila = `free`, y eso vale para el owner).
3. Desplegar con las dos flags apagadas: comportamiento idéntico al previo.
4. Encender `ENTITLEMENTS_ENABLED` (runtime, sin redeploy).
5. Redesplegar con `VITE_ENTITLEMENTS=true`.

**Nunca el cliente antes que el servidor:** con el cliente gateando y el
servidor permisivo, la UI oculta el botón pero una llamada directa pasa.

SQL de asignación manual (service role):

```sql
insert into public.user_entitlements (user_id, tier, source, note)
values ('<uuid>', 'advanced', 'manual', 'transferencia <fecha>, <nombre>')
on conflict (user_id) do update
  set tier = excluded.tier, source = excluded.source, note = excluded.note;
```

### Frontend

Variables habituales:

```bash
VITE_AI_PROVIDER=proxy
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_AUTH_REDIRECT_URL=http://localhost:5173
VITE_COACH_ACCOUNTS=correo-del-coach@ejemplo.com # opcional; habilita roster/switcher
```

Providers directos en dev:

```bash
VITE_AI_PROVIDER=gemini
VITE_GEMINI_API_KEY=...
VITE_GEMINI_MODEL=gemini-2.5-flash
```

Tambien existen providers directos para OpenAI y Claude en dev:

```bash
VITE_AI_PROVIDER=openai
VITE_OPENAI_API_KEY=...
VITE_OPENAI_MODEL=...

VITE_AI_PROVIDER=claude
VITE_CLAUDE_API_KEY=...
VITE_CLAUDE_MODEL=...
```

Plan Builder usa generacion deterministica por defecto. Para probar el modelo hibrido
IA primero + fallback local usando el provider principal:

```bash
VITE_PLAN_BUILDER_GENERATION_MODE=hybrid
VITE_AI_PROVIDER=gemini
VITE_AI_PROVIDER_WEEK_CREATOR=openai
```

En produccion, el cliente fuerza `proxy`.

### Netlify Function

Variables servidor habituales:

```bash
AI_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=...

SUPABASE_URL=...
SUPABASE_ANON_KEY=...
COACH_PROXY_REQUIRE_AUTH=true
COACH_RATE_LIMIT_WINDOW_MS=60000
COACH_RATE_LIMIT_MAX=20
```

El proxy permite rutear providers por `requestClass` sin cambiar todo el coach:

```bash
AI_PROVIDER_WEEK_CREATOR=openai
AI_PROVIDER_PLAN_BUILDER_WEEK=gemini
AI_FALLBACK_PROVIDER_PLAN_BUILDER_WEEK=gemini
OPENAI_API_KEY=...
OPENAI_MODEL=...
OPENAI_MODEL_WEEK_CREATOR=...

# Experimentos OpenAI de Fase 4 (opcionales; el override por clase gana al global)
OPENAI_SERVICE_TIER_WEEK_CREATOR=default # auto | default | flex | priority
OPENAI_REASONING_EFFORT_WEEK_CREATOR=low # valores incompatibles con el modelo se ignoran

# Plan Builder async/background
CLAUDE_API_KEY=...
CLAUDE_MODEL_PLAN_BUILDER_WEEK=claude-sonnet-4-6 # opcional; permite A/B por modelo sin cambiar el default
PLAN_BUILDER_WEEK_CONCURRENCY=3 # opcional; semanas en paralelo en generate-plan-background

# Whoop (opcional; solo servidor)
WHOOP_CLIENT_ID=...
WHOOP_CLIENT_SECRET=...
WHOOP_REDIRECT_URI=...
WHOOP_TOKEN_ENC_KEY=... # base64 de 32 bytes
SUPABASE_SERVICE_ROLE_KEY=...
```

Para load tests locales contra Netlify dev se puede usar:

```bash
COACH_PROXY_REQUIRE_AUTH=false
```

solo en dev.

## Comandos

### Desarrollo

```bash
npm run dev
npm run build
npm run preview
```

### Calidad

```bash
npm run lint
npm run test
npm run test:coverage
npm run audit:prompt
```

### Coach E2E

```bash
npm run e2e:dev:headed
npm run e2e:dev:quick
npm run e2e:dev
npm run e2e:dev:apply
npm run e2e:dev:quality
```

Notas:

- `e2e:dev` prueba el flujo completo del coach y week creator sin aplicar propuestas.
- `e2e:dev:quick` omite week creator para iterar rapido.
- `e2e:dev:apply` aplica propuestas y modifica datos dev/locales.
- `e2e:dev:quality` valida export de Beta Quality.

### Plan Builder E2E

```bash
npm run e2e:plan
npm run e2e:plan:headed
npm run e2e:plan:generate
npm run e2e:plan:generate:headed
npm run e2e:plan:generate:quality
npm run e2e:plan:readiness
npm run e2e:plan:accept
```

Notas:

- `e2e:plan` es seguro: recorre wizard hasta resumen y no guarda plan nuevo.
- `e2e:plan:generate` genera un plan con Gemini en Playwright headless y modifica draft/perfil.
- `e2e:plan:generate:headed` hace lo mismo con navegador visible, útil para login.
- `e2e:plan:generate:quality` genera y guarda el export Beta Quality en `scripts/e2e-artifacts/`.
- `e2e:plan:readiness` apunta por defecto a Netlify Dev (`http://localhost:8888`), genera un plan real y exige los gates del producto estrella: 8-12 semanas, ≥80% IA, calidad ≥78, menos de 2 minutos, integridad de sesiones, uso de 1RM y rotación de fuerza. Guarda un reporte timestamped y actualiza `scripts/e2e-artifacts/plan-builder-readiness-latest.json`.
- `e2e:plan:accept` genera y acepta el plan; modifica datos dev/locales.

### Load Test

```bash
npm run loadtest:week-creator
```

Por defecto apunta a:

```text
http://localhost:8888/.netlify/functions/coach
```

Puedes cambiarlo con:

```bash
COACH_ENDPOINT=http://localhost:8888/.netlify/functions/coach npm run loadtest:week-creator
LOADTEST_N=20 npm run loadtest:week-creator
```

## Flujo Recomendado de Pruebas

1. Levantar dev:

```bash
npm run dev
```

2. Ver el coach en vivo:

```bash
npm run e2e:dev:headed
```

3. Validar suite completa del coach:

```bash
npm run e2e:dev
```

4. Validar Plan Builder sin guardar:

```bash
npm run e2e:plan
```

5. Probar generacion real del Plan Builder:

```bash
npm run e2e:plan:generate
```

Para generar y exportar el reporte Beta Quality automáticamente:

```bash
npm run e2e:plan:generate:quality
```

6. Levantar Netlify Dev (`npx netlify dev`) y ejecutar el gate del producto estrella con un evento configurado a 8-12 semanas:

```bash
npm run e2e:plan:readiness
```

7. Antes de cualquier deploy:

```bash
npm run lint
npm run test
npm run build
```

Mas detalle en [DEV_TESTING_COMMANDS.md](DEV_TESTING_COMMANDS.md).

## PWA

La app puede instalarse como PWA.

Android:

1. Abrir en Chrome.
2. Usar `Instalar app` o `Agregar a pantalla principal`.

iPhone:

1. Abrir en Safari.
2. Compartir.
3. Elegir `Agregar a pantalla de inicio`.

Limitaciones:

- las notificaciones dependen del navegador
- iOS y Android no se comportan igual
- el service worker no equivale a un scheduler nativo

## Datos Guardados

Localmente:

- sesiones
- day logs
- resumenes semanales
- chat
- propuestas
- memoria del coach
- athlete profile
- planes y semanas del Plan Builder
- roster local y alcance del atleta activo
- resumen diario de readiness de Whoop, si el usuario lo conecta
- logs locales de AI/quality

Remotamente, si el usuario esta autenticado y el sync esta activo:

- entidades principales del dominio asociadas al usuario
- datos necesarios para continuidad multi-dispositivo
- credenciales Whoop cifradas y datos biométricos crudos, solo en servidor; el cliente no los lee

No se deberian persistir prompts completos ni respuestas completas del provider como telemetria operacional de beta.

## Beta Quality y Observabilidad

La app incluye un panel local en Ajustes para revisar:

- requestClass
- provider/model
- duracion
- outcome
- retries/fallback
- feedback positivo/negativo
- limites locales por clase

Esto sirve para pruebas personales y beta interna. Para una beta externa, el siguiente paso importante es persistir telemetria resumida por usuario/request en backend, sin guardar prompts completos ni datos sensibles.

## Limitaciones Conocidas

- El proyecto todavia esta orientado a beta interna, no a beta abierta.
- La calidad del coach debe seguir midiendose con E2E + uso real.
- La telemetria persistente resumida sigue pendiente para una beta externa.
- El sync requiere QA real multi-dispositivo antes de usuarios externos.
- Whoop readiness/workouts y las zonas de FC ya están operativos en producción (`019` aplicada y flag activo). Permanecen las auditorías de consentimiento/reaceptación, paridad y datos para exponer esa capa a terceros.
- Los providers directos en browser son solo para dev; produccion debe usar proxy.
- PDF import sigue siendo una parte pesada cuando se usa.
- Notificaciones web tienen limites propios del navegador.

## Roadmap Corto

Prioridad actual:

1. Desplegar el harness de sync multi-dispositivo y probar convergencia real entre desktop y mobile con una misma cuenta.
2. Cerrar las verificaciones pendientes de Whoop: consentimiento/reaceptación, auditoría SQL, paridad y contexto del coach.
3. Desplegar y observar los contratos `squashKind` v2 y A2.5, ya cerrados técnicamente, antes de retirar compatibilidad legacy.
4. Smokear Biblioteca, Planificación y la semana visible autenticadas sobre el bundle actual.
5. Consolidar tres planes arquetipo y la calidad deportiva del coach.
6. Onboardear el primer cliente acompañado antes de construir pagos self-serve.

## Documentos Utiles

- [DEV_TESTING_COMMANDS.md](DEV_TESTING_COMMANDS.md)
- [PROJECT_REVIEW_AND_ROADMAP.md](PROJECT_REVIEW_AND_ROADMAP.md)
- [OPTIMIZATION_AND_COSTS.md](OPTIMIZATION_AND_COSTS.md)
- [DESIGN.md](DESIGN.md)

## Estado en Una Frase

RallyIQ ya es una app deportiva real y usable, con soporte multi-atleta y readiness opcional de Whoop; el foco ahora es comprobar estabilidad, calidad del coach, Plan Builder, sync y los gates operativos antes de abrir el piloto.

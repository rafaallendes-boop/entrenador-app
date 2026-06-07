# Async Plan Builder — Diseño

Fecha: 2026-06-06
Estado: aprobado para implementación
Autor: Rafael Allendes (con Claude)

## Motivación

La generación del plan (producto estrella) requiere modelos de calidad, pero **ningún
proveedor síncrono entra en el límite de 26s de las Netlify Functions** para generar
una semana completa. Evidencia real recolectada en prod:

- **Claude Sonnet 4.6:** timeout consistente a los 18-22s.
- **Claude Haiku 4.5:** marginal — algunas semanas 17-19s (ok), otras >22s (timeout). ~40-60% de fallos.
- **OpenAI gpt-5-mini y gpt-5:** ambos timeout para plan_builder.
- **Solo modelos rápidos (gemini-2.5-flash, gpt-5-mini en cargas chicas) entran fiable**, pero su calidad no satisface para el producto estrella.

Conclusión: la generación síncrona bajo el cap de 26s es inviable para esta carga con
cualquier modelo decente. La solución de fondo es **generación asíncrona**: el cliente
encola, un worker server-side genera sin cap de tiempo, y el cliente escucha el progreso.

Cuando el plan se abra a público, el async también es la arquitectura correcta: no
depende de que el browser quede abierto, centraliza rate-limiting/costo y escala.

## Objetivos

- Generar planes completos con modelos de calidad (Claude Sonnet 4.6) sin el cap de 26s.
- Orquestación server-side: sobrevive a que el usuario cierre la pestaña.
- Progreso visible: las semanas aparecen a medida que se generan.
- Poder **detener** una generación en curso (hoy no se puede — bug conocido).
- Reusar la lógica de generación existente sin duplicarla.

## No-objetivos (fuera de este spec)

- Migrar week_creator / chat a async (siguen síncronos; entran en el cap).
- Worker dedicado con cola (Fly/Railway) — sigue siendo la opción para público masivo, no ahora.
- Supabase Realtime (se usa polling; Realtime queda como mejora futura opcional).
- Telemetría remota persistida (fuera de alcance).

## Decisiones tomadas

- **Worker:** Netlify Background Function (presupuesto 15 min, mismo stack, reusa CLAUDE_API_KEY).
- **Entrega al cliente:** polling cada ~4s sobre Supabase (sin Realtime).
- **Modelo:** Claude Sonnet 4.6 (sin cap, la calidad vale la latencia).
- **Fuente de verdad durante la generación:** Supabase (el worker escribe ahí; el cliente reconcilia hacia Dexie).
- **Enfoque A:** el background hace todo (orquestación + LLM + escritura); el cliente dispara y hace polling.

## Arquitectura y componentes

### Nuevo: `netlify/functions/generate-plan-background.ts`
Background Function. Recibe el POST de disparo, responde 202 al instante, corre el loop
de generación completo server-side hasta 15 min. Escribe cada semana en Supabase.

### Nuevo: `generateWeekCore` (módulo puro compartido)
Se extrae de `generateWeek.ts` el pipeline puro `prompt → normalize → validate → repair`,
recibiendo la **llamada al LLM como dependencia inyectada**:

```
generateWeekCore({ plan, week, previousWeek, profile, wizardConfig, recentContext,
                   retryInstruction, callLLM }): GenerateWeekResult
```

- `generateWeek.ts` (cliente) pasa a usar el core inyectando el proxy provider — sin cambio de comportamiento observable.
- `generate-plan-background.ts` usa el mismo core inyectando una llamada **directa a Anthropic**.

Las funciones puras ya existen y no tocan Dexie/stores: `validator`, `repairWeek`,
`weekPrompt`, `responseNormalizer`, `dateRange`, `shared`, `streamingActionsParser`.
La extracción solo separa la orquestación (telemetría/debug-store) de la lógica pura.

### Nuevo: llamada Anthropic server-side
Reusa `buildClaudeBody`/`callClaude` de `coach.ts` (o se extraen a un módulo compartido
`netlify/functions/_shared/`). Sin streaming necesario (el worker no devuelve al cliente
en vivo); llamada bloqueante con timeout generoso por semana (~60s).

### Nuevo: escritor Supabase server-side
La función escribe en `training_plan_weeks` y actualiza `training_plans.generationState`
usando el shape de `trainingPlanWeekToRow` / `trainingPlanToRow`. Esos mappers se
extraen de `syncService.ts` a un módulo compartido reutilizable por el server.

### Cambios en cliente
- `usePlanBuilderStore.runGeneration`: deja de correr `runPlanGenerationJob` local;
  ahora **dispara la background function + arranca el polling**.
- Nuevo servicio de polling (`pollPlanGeneration`) que lee Supabase cada ~4s y reconcilia hacia Dexie.
- Nuevo botón "Detener" en `PlanBuilderV2Page`.
- `generationJobRunner` client-side se retira para la generación inicial; se conserva la
  lógica de estados/validación (`derivePlanGenerationState`, etc.) que sigue siendo útil.

## Flujo de datos

1. Cliente: `buildPlanShell` (existente) → persiste Dexie + sync → `training_plans` +
   `training_plan_weeks` (status `pending`) en Supabase.
2. Cliente: `buildPlanBuilderRecentContext` (existente, lee Dexie local).
3. Cliente: `POST /.netlify/functions/generate-plan-background` con
   `{ planId, plan, weeks, profile, wizardConfig, recentContext }` + JWT de Supabase.
   El servidor valida el JWT, obtiene `user_id`, responde **202** y sigue corriendo.
4. Servidor: loop secuencial semana por semana (cada una usa la previa como contexto de
   progresión). Sonnet directo, sin cap. Escribe cada semana en Supabase
   (`generating` → `draft`/`error`) y actualiza `generationState`.
5. Cliente: estado local `generating`, arranca polling cada ~4s.
6. Cliente: cada poll trae semanas + `generationState`; escribe en Dexie y actualiza la
   UI progresivamente.
7. Servidor: al terminar marca `generationState` = `complete` (o `partial` si hubo fallos).
8. Cliente: detecta `complete`/`partial`/`cancelled`/`stalled` → para polling → review/accept (flujo actual).

**Fuente de verdad durante la generación:** Supabase. El cliente reconcilia hacia Dexie
en cada poll para evitar conflictos con el sync normal.

## Manejo de errores y resiliencia

- **Fallo de una semana** (timeout LLM / inválida tras reintentos): se marca `status: error`
  y el loop continúa. Plan termina `partial`. Cliente permite regenerar (async, misma
  función con `targetWeekIndexes`).
- **Reintentos por semana:** 2 intentos por semana, timeout ~60s por intento. Sin fallback
  local determinístico server-side: se prefiere un hueco explícito (`error`) a un template silencioso.
- **Crash/timeout del worker:** cada semana actualiza `generationSummary.heartbeatAt`. El
  cliente, si detecta sin progreso > 3 min, deriva un estado **`stalled` solo en UI**
  (no persistido) y ofrece "Reintentar". Cubre también el caso de cerrar la pestaña: al
  volver, polling/sync detecta el estado real y ofrece continuar/reintentar.
- **Idempotencia:** un `generationSummary.startedAt` / job id; un disparo nuevo supersede al anterior.

## Cancelación

- Botón "Detener" → el cliente escribe `generationSummary.cancelRequested=true` en
  Supabase (el `generationSummary` es un blob JSON ya sincronizado; **sin migración de schema**).
- El loop server-side re-lee el plan y chequea `cancelRequested` **al inicio de cada
  semana**; si está activo, corta limpio: conserva las semanas ya generadas y marca
  `generationState='cancelled'`.
- La semana en curso termina antes de cortar (~30s máx con Sonnet, aceptable).
- `cancelled` es un nuevo valor de `generationState` (cambio menor de tipo +
  `derivePlanGenerationState`). `stalled` NO se persiste (es solo UI derivada del heartbeat).
- Esto reemplaza el comportamiento actual donde no hay forma de frenar.

## Seguridad

- La función usa la **service-role key de Supabase** (env var en Netlify, nunca en bundle) +
  verifica el JWT del usuario para obtener `user_id` y escribir filas **solo de ese usuario**.
- `CLAUDE_API_KEY` ya está en Netlify.
- Validación de payload (tamaño/forma) antes de procesar, igual que `coach.ts`.
- Rate-limiting básico por usuario (patrón de `coach.ts`) para evitar disparos múltiples.

## Testing

- **`generateWeekCore`:** tests unitarios con LLM mock (ok / inválida / timeout). Reusa
  tests existentes de validator/repair.
- **Background function:** orquestación con LLM mock + escritor Supabase mock (loop secuencial,
  escritura por semana, marca error y continúa, respeta cancelación, heartbeat).
- **Cliente:** reducer de polling (semanas que llegan, transición a complete/partial/stalled).

## Fases de implementación

1. Extraer `generateWeekCore` (DI) y los row mappers compartidos; `generateWeek.ts` cliente
   pasa a usar el core (sin cambio de comportamiento). Tests.
2. `generate-plan-background.ts`: generación full-plan, Sonnet, escritura Supabase. Tests con mocks.
3. Cliente: servicio de polling + cambio de `runGeneration` a disparo+polling. Tests.
4. Cancelación + detección de stalled + regeneración async (`targetWeekIndexes`).

## Variables de entorno (Netlify)

- `CLAUDE_API_KEY` (ya existe).
- `CLAUDE_MODEL_PLAN_BUILDER_WEEK=claude-sonnet-4-6` (o el default `CLAUDE_MODEL`).
- `SUPABASE_SERVICE_ROLE_KEY` (nueva; scope Functions/Runtime).
- `SUPABASE_URL` (server-side).
- Provider routing síncrono (`AI_PROVIDER_PLAN_BUILDER_*`) deja de aplicar al plan builder
  una vez que la generación va por la background function.

**Provisión de Supabase server-side (`SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_URL`) es un
paso pre-prod**, lo agrega el owner antes del deploy. Toda la implementación y los tests
usan un escritor Supabase mockeado, así que no bloquean el desarrollo.

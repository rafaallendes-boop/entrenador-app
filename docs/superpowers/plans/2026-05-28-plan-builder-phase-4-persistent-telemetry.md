# Plan Builder Fase 4 — Telemetría persistida de generación

> **Para implementación:** ejecutar las tareas en orden, con tests antes y después de cada cambio. Mantener cada bloque de implementación en un commit separado para facilitar code review.

**Estado:** implementación local completada; pendientes migración y smoke en staging/producción.

**Objetivo:** medir el camino real y costoso del Plan Builder —la generación asíncrona de semanas con Claude en Netlify— para conocer costo, latencia, truncamientos, reintentos y calidad por intento sin bloquear al usuario ni persistir contenido sensible.

**Spec relacionado:** `docs/superpowers/specs/2026-05-27-plan-builder-star-product-design.md`.

**Decisión principal:** Fase 4 deja de ser un espejo cliente-first de `db.aiRequestLogs`. La fuente canónica será una tabla server-side, append-only, `plan_generation_attempts`, escrita al terminar cada intento de generación. La telemetría genérica del Coach, el feedback remoto y el dashboard cross-user quedan postergados hasta que exista volumen de beta que justifique su costo operativo.

---

## Por qué cambia el plan anterior

La generación de producción ocurre en `generate-plan-background.ts`, que invoca Claude directamente mediante `callAnthropicForWeek`. Ese camino no pasa por `src/services/ai/aiTelemetry.ts`; por lo tanto, instrumentar sólo Dexie o hooks del cliente no permite observar los tokens ni los reintentos que realmente cuestan dinero.

El diseño anterior además tenía problemas que no deben reaparecer:

- modelaba un trace mutable `started → completed` aunque RLS no permitía `update`;
- una cola cliente podía borrar una actualización nueva del mismo trace durante un flush;
- el feedback supuestamente no bloqueante hacía una escritura remota directa;
- no capturaba `usage` de Anthropic;
- confundía `service_role` con un rol admin de usuario.

Esta fase usa eventos finales e inmutables. Un intento genera una sola fila cuando ya conocemos su resultado. No hay estados parciales, upserts cliente ni dependencia de la sesión del navegador.

---

## Alcance

### Incluido

- Captura de `usage` y `stop_reason` desde la respuesta de Anthropic.
- Propagación tipada de tokens a través de `AIRawResponse` y `GenerateWeekResult.meta`.
- Un evento por cada intento real, incluidos reintentos y errores del proveedor.
- Persistencia append-only en Supabase desde Netlify Functions.
- Resultado estructural y de calidad de la semana generada.
- RLS estricto, retención de 90 días y pruebas con dos usuarios.
- Consultas operativas para calcular costo, latencia y calidad.

### Fuera de alcance

- Replicar `db.aiRequestLogs` o `db.coachFeedback` en Supabase.
- Subir prompts, respuestas, nombres de atleta, sesiones completas o mensajes de error libres.
- Toggle de opt-out en Settings para telemetría técnica imprescindible del producto.
- Dashboard admin en la aplicación.
- Cambiar de modelo, aumentar concurrencia o reducir límites de tokens antes de observar datos suficientes.
- Prompt caching continúa postergado. El schema compacto del esqueleto semanal se implementa como cambio independiente y reversible, apoyado en la hidratación determinística existente; no forma parte del contrato de persistencia.

---

## Arquitectura

```text
generate-plan-background
        │ userId, planId, athleteId, jobId, weekIndex
        ▼
runAsyncPlanGeneration ── intenta generar semana (máximo 2 intentos)
        │                         │
        │                         └─ callAnthropicForWeek
        │                              └─ usage + stop_reason + duration
        ▼
normalización + repair + validación + quality review de la semana
        │
        ├─ persiste checkpoint de training_plan_weeks
        └─ insert best-effort de un evento final
                    ▼
          plan_generation_attempts
          (append-only, sin contenido generado)
```

La generación no debe fallar si la escritura de telemetría falla. El evento se escribe server-side después de resolver el intento y se registra un warning estructurado si Supabase no responde. No se reintenta indefinidamente: la observabilidad nunca puede consumir el presupuesto del worker necesario para terminar el plan.

**Implementado el 2026-07-12:** captura de usage, evento append-only por intento, writer service-role idempotente, retención programada, fallback determinístico, quality gate y schema compacto de Plan Builder. Las tareas operativas de staging y los tres planes arquetipo siguen abiertas.

### Semántica de un intento

Un intento corresponde exactamente a una llamada al proveedor, identificada por `trace_id`. El primer intento usa `attempt = 1`; el retry usa `attempt = 2`. Errores previos a llamar al proveedor —cancelación, presupuesto agotado o semana inexistente— no crean una fila porque no consumieron tokens de Claude.

La fila se inserta sólo cuando el intento terminó:

- `succeeded`: produjo al menos una sesión válida después de normalización y repair;
- `validation_failed`: hubo respuesta, pero no produjo una semana utilizable;
- `truncated`: `stop_reason` indica límite de tokens;
- `provider_failed`: timeout, rate limit, red o 5xx;
- `cancelled` no se usa para intentos que nunca comenzaron.

---

## Contrato de datos

Crear `supabase/014_plan_generation_attempts.sql` (usar el siguiente número libre si otra migración aterriza primero):

```sql
create table public.plan_generation_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  athlete_id text not null references public.athletes(id) on delete cascade,
  plan_id text not null references public.training_plans(id) on delete cascade,
  job_id text not null,
  week_index integer not null check (week_index >= 0),
  attempt integer not null check (attempt between 1 and 10),
  trace_id text not null,

  provider text not null,
  model text null,
  input_tokens integer null check (input_tokens >= 0),
  output_tokens integer null check (output_tokens >= 0),
  cache_creation_input_tokens integer null check (cache_creation_input_tokens >= 0),
  cache_read_input_tokens integer null check (cache_read_input_tokens >= 0),
  duration_ms integer null check (duration_ms >= 0),
  stop_reason text null,

  outcome text not null check (outcome in (
    'succeeded', 'validation_failed', 'truncated', 'provider_failed'
  )),
  error_class text null,
  retry_used boolean not null default false,
  max_tokens integer null check (max_tokens > 0),
  worker_concurrency integer null check (worker_concurrency > 0),

  raw_session_count integer null check (raw_session_count >= 0),
  valid_session_count integer null check (valid_session_count >= 0),
  repaired_session_count integer null check (repaired_session_count >= 0),
  dropped_session_count integer null check (dropped_session_count >= 0),
  added_fallback_count integer null check (added_fallback_count >= 0),

  quality_score integer null check (quality_score between 0 and 100),
  quality_grade text null check (quality_grade in (
    'excellent', 'good', 'needs_review', 'poor'
  )),
  quality_critical_issue_count integer null check (quality_critical_issue_count >= 0),
  quality_warning_count integer null check (quality_warning_count >= 0),

  created_at timestamptz not null default now(),

  unique (job_id, week_index, attempt),
  unique (trace_id)
);

create index plan_generation_attempts_user_created_idx
  on public.plan_generation_attempts (user_id, created_at desc);
create index plan_generation_attempts_plan_week_idx
  on public.plan_generation_attempts (plan_id, week_index, attempt);
create index plan_generation_attempts_outcome_created_idx
  on public.plan_generation_attempts (outcome, created_at desc);

alter table public.plan_generation_attempts enable row level security;

create policy "plan_generation_attempts_select_own"
  on public.plan_generation_attempts
  for select
  using (auth.uid() = user_id);
```

No crear políticas de `insert`, `update` ni `delete` para `authenticated` o `anon`. Las escrituras y la retención usan exclusivamente `SUPABASE_SERVICE_ROLE_KEY` en Netlify. `service_role` omite RLS; no representa a un usuario administrador ni debe exponerse al cliente.

### Privacidad y minimización

No persistir:

- `systemPrompt`, `userMessage` o `responseSchema`;
- texto devuelto por Claude;
- contenido de sesiones, objetivos o warnings;
- nombre, email, métricas clínicas o perfil del atleta;
- `lastError` libre.

`athlete_id`, `plan_id`, `job_id` y `trace_id` son identificadores técnicos necesarios para correlación. `error_class` debe usar un conjunto controlado (`timeout`, `rate_limit`, `truncated`, `validation`, `quality_gate`, `server_error`, `unknown`) y nunca el mensaje original.

Los `ON DELETE CASCADE` son deliberados: una solicitud de borrado de atleta o plan prima sobre conservar la línea base analítica. La retención máxima de 90 días no debe impedir el borrado inmediato de datos relacionados.

### Idempotencia

La tabla continúa siendo append-only aunque tenga constraints únicas. Un replay de la misma invocación no crea otra fila. El writer debe usar `insert`, tratar PostgreSQL `23505` como éxito idempotente y no ejecutar `upsert`: un evento previo nunca se modifica.

La misma migración instala un trigger pequeño sobre `training_plans`: mientras un job sigue en estado `generating`, `cancelRequested=true` es sticky. Así un checkpoint background no puede borrar atómicamente una cancelación escrita por el cliente; un job posterior puede limpiarla una vez que el estado anterior ya es terminal.

---

## Task 1 — Capturar usage de Anthropic

**Archivos:**

- `src/services/ai/types.ts`
- `netlify/functions/_shared/anthropicCaller.ts`
- `netlify/functions/_shared/anthropicCaller.test.ts`
- `src/services/planBuilder/generateWeekCore.ts`
- tests de `generateWeekCore`

- [x] Añadir a `AIRawResponse` métricas opcionales de input, output y prompt cache.
- [x] Leer `data.usage` de Anthropic y mapear nombres snake_case al contrato TypeScript.
- [x] Mantener `finishReason`, `durationMs` y `model` incluso cuando algún campo de usage no venga informado.
- [x] Propagar y acumular tokens en `GenerateWeekResult.meta` y `PlanGenerationMeta`.
- [x] No estimar tokens desde caracteres y no convertir un campo ausente en cero; `undefined` significa “proveedor no informó”.

**Tests mínimos:** respuesta completa, usage sin cache, usage con cache, truncamiento por `max_tokens` y compatibilidad con respuestas sin `usage`.

**Criterio:** una generación real deja `promptTokens` y `completionTokens` en `training_plan_weeks.generation_meta`, además del evento persistido en la Task 4.

---

## Task 2 — Emitir un evento por intento

**Archivos:**

- `src/services/planBuilder/asyncGenerationLoop.ts`
- `src/services/planBuilder/__tests__/asyncGenerationLoop.test.ts`
- nuevo tipo/helper de telemetría dentro de `src/services/planBuilder/`

- [x] Introducir un writer opcional `putAttempt(event)` en el contrato del worker.
- [x] Emitirlo una vez al terminar cada intento, no sólo al resolver la semana completa.
- [x] Incluir contexto técnico: `jobId`, `planId`, `athleteId`, `weekIndex`, `attempt`, `traceId`, max tokens solicitado, concurrencia efectiva, meta estructurada y outcome.
- [x] Para intentos exitosos, construir el `TrainingPlanWeek` candidato y ejecutar quality review. Persistir sólo score, grade y conteos.
- [ ] El quality score del evento es el score de esa semana dentro del contexto disponible en ese momento. El quality review final del plan sigue viviendo en `generation_summary`; no reemplazarlo ni presentar ambos scores como equivalentes.
- [ ] Capturar excepciones técnicas y emitir `provider_failed` con una clase controlada. Si la llamada termina por tokens, emitir `truncated` aunque el normalizador haya devuelto cero sesiones.
- [x] Envolver el writer en `try/catch` con warning estructurado y timeout corto; nunca modifica retry o resultado.

**Tests mínimos:**

- éxito en primer intento → un evento `attempt=1`;
- validación falla y retry funciona → dos eventos distintos;
- truncamiento → primer evento con `truncated` y max tokens inicial; retry con cap ampliado;
- timeout/rate limit → evento clasificado sin mensaje libre;
- callback falla → el plan igualmente termina;
- concurrencia 3 → cada evento conserva el week index y trace correctos.

**Criterio:** la cantidad de eventos del `jobId` coincide con las llamadas al proveedor efectivamente iniciadas por ese job. En una generación inicial también coincide con `generationSummary.totalAttempts`; en regeneraciones este summary puede incluir intentos históricos de la semana.

---

## Task 3 — Migración, RLS e índices

**Archivo:** `supabase/014_plan_generation_attempts.sql`.

- [x] Crear el schema definido arriba.
- [x] Añadir comentarios SQL que documenten append-only y datos prohibidos.
- [ ] Aplicar primero en Supabase staging.
- [ ] Verificar con dos cuentas: A sólo puede leer filas de A; B sólo las de B.
- [ ] Confirmar que ambos usuarios reciben error al intentar `insert`, `update` o `delete` desde un cliente con anon key.
- [ ] Confirmar que service role puede insertar y borrar, pero que la key no aparece en ningún bundle `VITE_*`.

**Criterio:** RLS evita lectura cross-user y el navegador no puede fabricar ni modificar métricas.

---

## Task 4 — Writer server-side append-only

**Archivos:**

- nuevo `netlify/functions/_shared/planGenerationTelemetry.ts`
- tests unitarios del writer/mapeo
- `netlify/functions/generate-plan-background.ts`

- [x] Crear un cliente Supabase aislado con `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`, sin persistencia de sesión.
- [x] Mapear el evento tipado a columnas SQL mediante una función pura y testeable.
- [x] Recibir `userId` exclusivamente de `resolveAuthContext`; nunca confiar en un `user_id` enviado en el payload.
- [x] Conectar el writer al evento `putAttempt` de la Task 2.
- [x] Usar `insert`; ignorar sólo error `23505`. Loguear otros fallos con identificadores técnicos y código, sin payload sensible.
- [x] Limitar cada escritura con timeout corto. No agregar cola cliente, timers globales ni retries que sobrevivan al worker.
- [x] Si falta service role key, degradar explícitamente con warning y continuar la generación. En producción, el smoke test de deploy debe considerar esa configuración obligatoria.

**Tests mínimos:** mapeo completo, nulos correctos, `userId` autenticado, duplicate como éxito, error de Supabase no aborta el Plan Builder y ausencia de campos prohibidos.

**Criterio:** cada intento de un plan generado en staging aparece en menos de 10 segundos desde que termina, sin aumentar perceptiblemente la latencia crítica del plan.

---

## Task 5 — Retención de 90 días

**Archivos:**

- nuevo `netlify/functions/plan-generation-telemetry-retention.ts`
- tests de la función

- [x] Implementar una scheduled function diaria con service role.
- [x] Borrar sólo filas con `created_at` estrictamente anterior al cutoff de 90 días.
- [x] Responder/loguear cantidad borrada y duración, sin IDs de usuario o plan.
- [x] Fallar de forma visible cuando falten secrets.
- [x] Probar el cutoff estricto y errores de Supabase.
- [x] Documentar la schedule junto al código usando el patrón de `whoop-cron.ts`.

**Criterio:** una ejecución manual en staging elimina sólo fixtures expirados y una segunda ejecución es idempotente.

---

## Task 6 — Consultas operativas y runbook

No crear todavía un dashboard. Documentar consultas SQL de sólo lectura para los últimos 7, 30 y 90 días:

- intentos, planes y semanas generadas;
- input/output/cache tokens totales y promedio por semana;
- p50/p95 de `duration_ms`;
- tasa de retry, truncamiento, rate limit y validación fallida;
- score promedio y porcentaje `needs_review/poor`;
- comparación por modelo, max token cap y concurrencia configurada;
- planes con semanas faltantes mediante correlación con `training_plan_weeks`.

Las consultas cross-user se ejecutan sólo con acceso operativo server-side o SQL editor autorizado. No agregar una política “admin” basada únicamente en email ni permitir select global a `authenticated`.

Consulta base de los últimos 30 días:

```sql
select
  model,
  count(*) as attempts,
  count(distinct plan_id) as plans,
  sum(input_tokens) as input_tokens,
  sum(output_tokens) as output_tokens,
  sum(cache_read_input_tokens) as cache_read_tokens,
  percentile_cont(0.5) within group (order by duration_ms) as p50_ms,
  percentile_cont(0.95) within group (order by duration_ms) as p95_ms,
  round(100.0 * count(*) filter (where retry_used) / nullif(count(*), 0), 2) as retry_pct,
  round(100.0 * count(*) filter (where outcome = 'truncated') / nullif(count(*), 0), 2) as truncated_pct,
  round(avg(quality_score), 1) as avg_quality
from public.plan_generation_attempts
where created_at >= now() - interval '30 days'
group by model
order by attempts desc;
```

Para 7 o 90 días se cambia únicamente el intervalo. Los nulos de tokens se mantienen como desconocidos; no usar `coalesce(..., 0)` al calcular costo promedio.

**Criterio:** el equipo puede responder cuánto cuesta y cuánto demora un plan, qué porcentaje requiere retry y si menor costo empeora la calidad.

---

## Task 7 — Validación end-to-end

- [ ] Ejecutar `npm run lint`.
- [ ] Ejecutar `npm test`.
- [ ] Ejecutar `npm run build`.
- [ ] Ejecutar `npm run audit:prompt`.
- [ ] Aplicar la migración en staging.
- [ ] Generar los tres arquetipos de QA: squash competitivo con 1RM, masters ≥35 con fatiga/restricción y multideporte.
- [ ] Confirmar correlación `plan → job → week → attempt` y que el número de filas coincide con los intentos reales.
- [ ] Confirmar que ningún registro contiene prompt, respuesta, sesión, nombre ni error libre.
- [ ] Simular fallo de telemetría y comprobar que la generación y los checkpoints terminan normalmente.
- [ ] Validar RLS con dos usuarios y retención con fixtures de frontera.

### Métricas de cierre

Fase 4 queda completa cuando:

1. El 100% de los intentos iniciados por el worker deja evento o un warning operacional identificable.
2. Tokens, duración, stop reason y outcome están presentes cuando Anthropic los entrega.
3. Reintentos y truncamientos pueden calcularse sin inferir desde logs de texto.
4. La calidad por semana se puede correlacionar con tokens/modelo sin guardar contenido deportivo.
5. Un fallo de persistencia no altera el plan ni agrega intentos Claude.
6. RLS y retención están verificadas en staging.
7. La suite completa queda verde.

No fijar todavía objetivos rígidos de costo o p95: la primera función de esta fase es construir la línea base. Después de al menos 30 planes completos o dos semanas de beta, registrar baseline y decidir si corresponde compactar output, habilitar prompt caching o ajustar el cap inicial.

---

## Estrategia de commits para code review

Mantener cambios separables y reversibles:

1. `feat(plan-builder): capture Anthropic token usage`
2. `feat(plan-builder): emit per-attempt generation outcomes`
3. `feat(db): add append-only plan generation telemetry`
4. `feat(plan-builder): persist generation attempts server-side`
5. `chore(telemetry): enforce 90-day attempt retention`
6. `docs(plan-builder): add telemetry operations runbook`
7. `fix(plan-builder): recover failed async weeks locally`
8. `perf(plan-builder): compact structured week output`

No mezclar telemetría, fallback determinístico y output compacto en un mismo commit. Prompt caching y cambios de concurrencia siguen postergados hasta tener línea base.

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| La telemetría hace fallar o ralentiza el plan | Callback best-effort, timeout corto y sin retries costosos. Tests explícitos de fallo. |
| Doble invocación del background duplica filas | Uniques por trace y por job/week/attempt; error `23505` tratado como replay exitoso. |
| Se filtra información del atleta | Allowlist de campos, sin texto libre, test que rechaza campos prohibidos. |
| Métricas fabricadas desde el navegador | Sin policy de insert/update/delete para clientes; escritura sólo con service role. |
| Service role key llega al bundle | Sólo variable server-side `SUPABASE_SERVICE_ROLE_KEY`; auditoría del build. |
| Usage ausente se interpreta como cero | Columnas nullable y contrato opcional; las consultas distinguen desconocido de cero. |
| Quality score de semana se confunde con score global | Nombres y runbook documentan que es outcome local; el review global permanece en `generation_summary`. |
| Retención borra datos recientes por zona horaria | `timestamptz`, `now()` de Postgres y prueba exacta del cutoff. |
| Cardinalidad/costo crece | Máximo práctico de dos intentos por semana y retención de 90 días; monitorear filas/mes. |

---

## Telemetría genérica postergada

Reevaluar persistencia remota de chat y feedback sólo cuando haya una pregunta de producto concreta que la telemetría local no pueda responder y se cumplan ambas condiciones:

1. al menos dos semanas de beta privada con tres o más usuarios reales;
2. volumen suficiente para analizar feedback cross-session.

Si se retoma, debe diseñarse como un sistema independiente, con consentimiento/opt-out, minimización de contenido y eventos inmutables. No reutilizar automáticamente `plan_generation_attempts`, no engancharlo al worker y no resucitar la cola mutable del plan anterior.

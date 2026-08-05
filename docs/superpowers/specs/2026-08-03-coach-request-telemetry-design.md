# Telemetría persistida de las requests del coach (`018`)

Fecha: 2026-08-03 (nota de secuencia de §9 actualizada el 2026-08-05)
Estado: **diseño aprobado por el owner**, pendiente plan de implementación
Migración: `018_coach_requests.sql` (**de aplicación manual**, como todas)
Dexie: sin cambios. Backup/export: sin cambios.

## 1. Problema

`OPTIMIZATION_AND_COSTS.md` no puede proyectar el costo mensual de la app
porque el camino de mayor volumen —el chat, con tope de 80 requests/día— no
tiene cifra. Eso bloquea fijar el precio del piloto.

La entrada 6 del backlog decía que el chat «no tiene instrumentación». **Es
falso, y se corrigió el 2026-08-03.** `logCoachRequest`
(`netlify/functions/coach.ts:591`) ya emite por request: duración de proveedor
y de servidor, duración de auth, tokens de prompt/completion/reasoning/cache,
`requestClass`, `provider`, `model`, `finishReason`, `outcome`, `retryUsed`,
`fallbackUsed`, `serviceTier`, `reasoningEffort`, `responseCharCount` y
`errorCode`.

Lo que falta es **persistencia**: es un `console.info` que muere en los logs de
Netlify. No se puede sumar un mes ni separar `chat_general` de `chat_action`.

El trabajo es el mismo patrón que `016` aplicó al Plan Builder —tabla, row
mapper, guard de drift bidireccional, retención— sobre campos que ya están
calculados. No es una Fase 0 desde cero.

## 2. Alcance

**Las 7 clases de `RequestClass`** (`coach.ts:26`): `chat_general`,
`chat_action`, `weekly_summary`, `week_creator`, `plan_builder_week`,
`plan_builder_pair`, `import_extract`. El costo marginal de persistir todas es
cero porque los campos ya se calculan para todas.

Por eso la tabla se llama `coach_requests` y no `chat_*`: describe lo que
realmente contiene.

**Fuera de alcance por construcción:** el Plan Builder **async** no pasa por
`coach.ts` —llama a Anthropic directo— y ya está cubierto por `016`
(`plan_generation_jobs` + `plan_generation_attempts`). Las filas
`plan_builder_week` / `plan_builder_pair` de esta tabla corresponden al camino
**síncrono** vía `coach.ts`. No mezclar las dos fuentes al analizar.

## 3. Identidad de la fila

```sql
user_id uuid not null references auth.users(id) on delete cascade
```

**Decisión y su consecuencia.** Una versión anterior de este diseño proponía
`user_id` nullable con anónimo→`null`. Es incompatible con escribir usando el
token del usuario: sin token no hay cliente capaz de satisfacer
`with check (auth.uid() = user_id)`, así que una request anónima **no puede
escribir fila por construcción**. `not null` es lo coherente.

Quedan deliberadamente **sin persistir**:

- Requests en modo dev con `COACH_PROXY_REQUIRE_AUTH=false`, donde el contexto
  usa el literal `'anonymous'` (`coach.ts:656-659`).
- Requests rechazadas durante la autenticación (call site `coach.ts:1544`): no
  hay usuario al que asociarlas.

Ambas siguen visibles en los `console.info`, que **no se tocan**. De los 6 call
sites de `logCoachRequest`, 5 persisten.

El rechazo por rate limit ocurre **después** de resolver la autenticación y sí
se persiste con `outcome = error` / `error_code = rate_limit`; no forma parte de
las exclusiones anteriores.

`on delete cascade` mantiene la telemetría consistente al borrar la cuenta.
Nota deliberada: esto difiere de `user_consents` (`017`), que **no** lleva FK
porque su default legal es conservar evidencia. Acá no hay obligación
equivalente.

## 4. Esquema

Una fila por request, con PK técnica `id bigint generated always as identity`.
`trace_id` **no es único**: el cliente puede reutilizarlo cuando reintenta una
request streaming como no-streaming, y ambas requests deben persistirse. Sin
contenido de mensajes: solo conteos y metadata.

| Grupo | Columnas |
|---|---|
| Identidad | `id` (pk generada), `trace_id`, `user_id`, `generation_id`, `logical_attempt`, `request_class`, `streamed` |
| Resultado | `outcome` (`ok`/`error`), `error_code`, `finish_reason`, `retry_used`, `fallback_used` |
| Latencia | `auth_duration_ms`, `provider_duration_ms`, `server_duration_ms` |
| Proveedor | `provider`, `model`, `service_tier`, `reasoning_effort` |
| Consumo | `prompt_tokens`, `completion_tokens`, `reasoning_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `response_char_count` |
| Costo | `estimated_cost_usd` |
| Tiempo | `created_at` |

`request_class` lleva `check` con las 7 clases; `outcome` con las 2. Los
contadores llevan `check >= 0`. Índices: `(user_id, created_at desc)`,
`(request_class, created_at desc)` y `(trace_id, created_at desc)`.

La PK no puede ser `trace_id`: además del fallback de transporte, su unicidad
global permitiría que un usuario autenticado bloqueara el identificador de
otro usuario. El guard de drift excluye únicamente `id`, porque la genera
PostgreSQL y no forma parte del payload de inserción.

### 4.0 `streamed`: por qué es una columna y no algo derivable

**`request_class` no permite segmentar streaming de no-streaming.** Quien decide
el transporte es `req.stream`, un campo de la request: la misma clase puede
llegar por los dos caminos según lo que pida el cliente. Ninguna columna
existente lo captura.

Hay **dos** bifurcaciones sobre `req.stream`, no una: la del camino normal
(`coach.ts:1618`) y una propia dentro del bloque del bypass determinista
(`coach.ts:1603`), que construye su propio `ReadableStream`. Es decir, **el
bypass también respeta `req.stream`** y puede responder en streaming.

Contrato de la columna: **`streamed` registra el transporte efectivo.** Hoy eso
coincide con `Boolean(req.stream)` en todas las requests persistibles, incluido
el bypass. Se define por el transporte y no por el flag para que la semántica
no cambie si en el futuro algún camino deja de respetar lo pedido; mientras eso
no ocurra, la implementación es directamente `Boolean(req.stream)`.

Se agrega también al payload de `logCoachRequest`, para que el contraste del
rollout segmente por la misma dimensión en ambos lados.

Sin esta columna, la verificación de §6.2 —que exige medir pérdida y latencia
**por separado** en cada camino— no sería ejecutable sobre datos reales; habría
que recurrir a probes controlados identificables por `trace_id`, que miden un
tráfico sintético en vez del real.

### 4.1 RLS

```sql
alter table public.coach_requests enable row level security;

-- select propio
create policy coach_requests_select_own on public.coach_requests
  for select using (auth.uid() = user_id);

-- insert propio: la escritura va con el token del usuario, no service role
create policy coach_requests_insert_own on public.coach_requests
  for insert with check (auth.uid() = user_id);
```

**Sin `update` ni `delete` para clientes.** El borrado lo hace la retención con
service role, desde una función distinta.

Trade-off aceptado explícitamente: un cliente podría insertar filas falsas. Se
acepta porque es telemetría de costo de la propia app con 1-3 usuarios de
confianza, y la alternativa —meter `SUPABASE_SERVICE_ROLE_KEY` en la función de
mayor tráfico del proyecto, que hoy deliberadamente no la tiene— es peor
intercambio. **Revisar si alguna vez hay self-serve real (Nivel 4).**

## 5. Costo: qué se puede y qué no responder al terminar esto

`estimated_cost_usd` se calcula al escribir con la tabla fechada existente
(`src/services/planBuilder/pricing.ts`), igual que `016`, con una única
excepción codificada: el bypass determinista (§5.1).

**Limitación central, conocida de antemano:** `MODEL_PRICES` contiene
únicamente `claude-sonnet-4-6` (`pricing.ts:22-24`), mientras
`resolvePrimaryProvider()` (`coach.ts:527`) puede resolver Gemini u OpenAI
según env vars cuyos valores de producción **no están documentados**
(`OPTIMIZATION_AND_COSTS.md` §8). Si el chat corre sobre otro proveedor,
`estimated_cost_usd` saldrá `null`.

Mitigación por diseño: **se persiste todo el usage reportado**, junto al modelo
y el timestamp. Las requests con usage suficiente quedan recalculables sin
haber perdido datos. Es deliberadamente más débil que «siempre»: los call sites
de error no siempre tienen modelo ni usage, y una fila sin tokens no se vuelve
recalculable por guardarla.

### 5.1 Semántica de `estimated_cost_usd`

Tres estados, no dos:

| Valor | Significado |
|---|---|
| numérico | Costo estimado con la tabla fechada vigente |
| `0` | **Bypass determinista**: no hubo llamada a proveedor, el costo real es cero |
| `null` | Precio no disponible (modelo ausente de `MODEL_PRICES`) **o** usage insuficiente |

El caso `0` es una excepción real y hay que codificarla: el bypass determinista
responde sin llamar a ningún proveedor pero registra
`model: 'local_regex (deterministic_bypass)'` (`coach.ts:1571`), que no existe
en `MODEL_PRICES`. Sin una regla explícita, el mapper produciría `null` para
algo cuyo costo se conoce con certeza y es cero. El bypass es alcanzable solo
desde `chat_action` (`shouldUseDeterministicBypass`, `coach.ts:327-329`).

`null` significa **«precio no disponible», nunca «costo cero»**. Cualquier
consulta que sume costos debe excluir los nulls y reportar la cobertura en
**dos** dimensiones:

- **% de filas** con costo conocido, y
- **% de tokens** cubiertos por esas filas.

Reportar solo el porcentaje de filas puede ser muy engañoso: las requests caras
suelen ser pocas, así que una cobertura alta en filas puede convivir con una
cobertura baja en tokens, y viceversa.

**Nota de contaminación preexistente:** el bypass registra `provider: 'gemini'`
(`coach.ts:1573`) aunque no llamó a ningún proveedor. Todo análisis agrupado
por `provider` debe excluir el modelo del bypass, o atribuirá tráfico y latencia
a Gemini que nunca existieron. No se corrige acá —es un cambio de
comportamiento en un camino ajeno a esta entrega— pero queda anotado.

Trabajo previo separado, necesario para responder «cuánto cuesta el chat»:
confirmar con el owner los `AI_PROVIDER_*` reales de producción y poblar
`MODEL_PRICES` con esos modelos. **No es parte de esta entrega.**

## 6. Escritura

`void insertCoachRequestRow(...)` junto a cada `logCoachRequest`, **sin
`await`**, con un cliente Supabase construido sobre el bearer token del
usuario, y con aborto real a los 3 s.

No esperar la escritura es **necesario** para no bloquear la respuesta (§6.1),
pero **no es suficiente** para afirmar que no agrega latencia: eso depende del
runtime y queda como hipótesis a medir (§6.2).

### 6.1 Por qué no se puede esperar la escritura

El cliente consume el stream con `while (true) { reader.read(); if (done) break }`
(`ProxyProvider.ts:211-213`): espera a que el **stream cierre**, no al evento
`done`. Cualquier `await` antes de `controller.close()` le suma latencia real
al usuario en cada request del coach. Peor: el `serverDurationMs` registrado se
calcula antes de la escritura, así que la métrica **no mostraría** la
degradación que habríamos causado. Descartado.

### 6.2 Durabilidad y latencia: esta versión es best-effort

**Esta primera versión se define explícitamente como persistencia
best-effort.** No garantiza que toda request produzca fila. Cualquier análisis
sobre la tabla debe interpretarse contra la cobertura medida en el rollout, no
suponiendo completitud.

**Verificado en las definiciones de tipos:** `waitUntil` **no existe** en este
wrapper. `@netlify/functions` v5 usa la API estilo Lambda v1, y
`HandlerContext` (`node_modules/@netlify/functions/dist/main.d.ts:5-25`) expone
`callbackWaitsForEmptyEventLoop`, `awsRequestId` y `getRemainingTimeInMillis()`,
pero no `waitUntil`. Ese método pertenece a la API v2 de Netlify
(`Request`/`Response` + `Context`), que este proyecto no usa.

**Mecanismo candidato, no una solución demostrada.**
`callbackWaitsForEmptyEventLoop` existe y su default en Lambda es `true`, lo que
hace que el runtime espere a que el event loop se drene antes de congelar el
entorno. Pero eso corta para los dos lados y **no se puede afirmar que resuelva
la durabilidad**:

- Si *no* aplica en este runtime, el insert en vuelo se pierde al terminar la
  función → problema de **durabilidad**.
- Si *sí* aplica, en el camino **no-streaming** puede retrasar la entrega de la
  respuesta hasta que el event loop se drene → problema de **latencia**.

Es decir: «sin `await`» **no demuestra por sí solo** «sin latencia observable».
Las dos propiedades son hipótesis, y apuntan en direcciones opuestas.

**Cancelación real, no solo un race.** `withTimeout`
(`netlify/functions/_shared/promiseTimeout.ts:1-9`) **no cancela nada**: hace
`Promise.race` contra un `setTimeout` y deja de esperar, pero el `fetch`
subyacente de Supabase sigue vivo y sigue ocupando el event loop —justo lo que
determina si la función se extiende—. Por eso el mecanismo de corte es el
aborto real de la request:

- `.abortSignal(AbortSignal.timeout(3_000))` sobre el insert de supabase-js,
  que sí aborta el `fetch`.
- **Manejo del fallo sin depender de la forma del error.** supabase-js
  normalmente **no rechaza**: transforma el aborto en un resultado
  `{ error, status: 0 }`. Y `AbortSignal.timeout()` produce `TimeoutError`, no
  `AbortError`. Así que el contrato es: *cualquier* error devuelto o lanzado por
  el insert se traga. Nada puede depender del nombre `AbortError`, salvo que se
  use explícitamente `.throwOnError()` y se pruebe ese comportamiento.
- `withTimeout` puede conservarse como defensa adicional, pero **nunca** como
  el mecanismo de cancelación.

**Verificación en el rollout, separada por camino.** Se miden las dos
propiedades, y por separado para streaming y no-streaming, porque el mecanismo
las afecta distinto:

La segmentación usa la columna `streamed` (§4.0), no `request_class`.

| Camino (`streamed`) | Pérdida | Latencia |
|---|---|---|
| `true` | filas persistidas vs eventos `coach.request.completed` en logs, filtrando por `streamed` | **end-to-end observado por el cliente**, p50/p90, antes vs después |
| `false` | ídem | ídem |

El contraste de pérdida usa el conteo de eventos `coach.request.completed`
(`coach.ts:617`) en los logs de Netlify, que también llevan `streamed`. Los
`console.info` siguen existiendo justamente para permitirlo.

**La latencia no se mide con `serverDurationMs`.** Ese campo se calcula *antes*
de la escritura, así que por construcción no puede capturar un retraso causado
por el drenado del event loop: mostraría "sin cambios" incluso si el usuario
espera más. La medición válida es el tiempo end-to-end observado del lado del
cliente, comparando p50 y p90 contra la línea base previa al deploy. La fuente
existe: `useAIDebugStore` conserva `startedAt` y fija `completedAt` al completar
o fallar, así que el end-to-end es `completedAt - startedAt`. Además,
`AITechnicalResult.streamed` conserva el **transporte terminal efectivo** que
reporta `ProxyProvider`: una caída streaming→JSON queda clasificada como
`false`, aunque haya existido un primer intento streaming fallido. Ese campo se
propaga en Coach Engine, Week Creator y los caminos single/pair del Plan Builder;
el fallback local determinista de Week Creator se registra como `false`.

**Escalada si hay pérdida material o impacto de latencia en cualquiera de los
dos caminos:** endpoint dedicado de telemetría invocado por el cliente tras el
`done` (todos los campos ya viajan en ese evento). No se implementa ahora;
queda documentada como salida.

### 6.3 Plomería necesaria

`streamResponse` hoy recibe solo `{ requestReceivedAt, authDurationMs }`
(`coach.ts:1434-1437`). Hay que pasarle también el `userId` resuelto y el
bearer token. Mismo cambio en los call sites no-streaming.

### 6.4 Fallo de escritura

Un fallo de inserción **nunca altera el payload ni el status** de la respuesta
del coach: se atrapa —tanto un `error` devuelto como una excepción—, se loguea
con `console.warn` y se descarta. No hay reintento: una fila de telemetría
perdida no justifica arriesgar el camino caliente.

Sobre latencia, la afirmación es más débil a propósito, para no contradecir
§6.2: **el impacto de latencia está acotado por el aborto a los 3 s y se valida
en el rollout.** No se afirma que sea nulo.

## 7. Contrato reusado de `016`

- **Row mapper** propio (`netlify/functions/_shared/coachRequestTelemetry.ts`),
  espejo de `planGenerationJobTelemetry.ts`.
- **Guard de drift bidireccional**: un test parsea el bloque `create table` de
  `018_coach_requests.sql` y compara el conjunto de columnas contra las claves
  del mapper, en ambos sentidos. Copia del patrón de
  `planGenerationJobSchema.test.ts`.
- **Retención a 90 días**, agregando `coach_requests` al cron existente
  (`planGenerationTelemetryRetention.ts`), que pasa a limpiar tres tablas. Se
  reusa `PLAN_GENERATION_TELEMETRY_RETENTION_DAYS`; no se inventa un segundo
  número.

## 8. Testing

1. **Row mapper**: mapea todos los campos; `estimated_cost_usd` numérico para
   `claude-sonnet-4-6`.
2. **Los tres estados del costo**, uno por test: `0` para el bypass
   determinista (`local_regex (deterministic_bypass)`), `null` para un modelo
   ausente de `MODEL_PRICES`, y `null` para usage insuficiente aunque el modelo
   sí tenga precio.
3. **Guard de drift**: columnas del `.sql` == claves del mapper, en ambos
   sentidos.
4. **`AUTH_REQUIRED=false`**: una request en modo dev **no** intenta escribir
   fila, y la respuesta del coach es idéntica.
5. **Auth fallida**: el call site de `coach.ts:1544` loguea pero no persiste.
6. **Fallo de Supabase**: un insert que rechaza no altera la respuesta del
   coach ni lanza.
7. **Aborto del insert**, tres aserciones separadas, ninguna dependiente del
   nombre del error:
   - se adjunta un `AbortSignal` al insert (no basta con que el race termine
     —esa es exactamente la diferencia entre abortar y dejar el `fetch`
     colgado—);
   - el signal efectivamente aborta al vencer el plazo;
   - cualquier error resultante se traga, tanto en la forma
     `{ error, status: 0 }` que devuelve supabase-js como en la de excepción
     lanzada.
8. **`streamed` refleja el transporte real**, con los dos casos gemelos del
   bypass: `stream: true` persiste `streamed = true` (el bypass tiene su propia
   rama de streaming en `coach.ts:1603`), y `stream: false` persiste
   `streamed = false`.
9. **Retención**: borra filas de `coach_requests` más viejas que el corte y
   respeta las recientes. Cada tabla reporta su resultado de forma independiente:
   que `coach_requests` todavía no exista no invalida los deletes exitosos de
   attempts/jobs.
10. **Transporte terminal cliente**: NDJSON produce `streamed = true`; JSON y
    el fallback streaming→JSON producen `streamed = false` en
    `useAIDebugStore`, también para Week Creator y Plan Builder.
11. **Rate limit autenticado**: el 429 persiste una fila con el usuario resuelto
    y `error_code = rate_limit`; auth fallida sigue sin intentar escritura.

**No cubierto por tests unitarios, y por eso va al rollout:** que la escritura
sin `await` efectivamente persista, y que no agregue latencia observable. Son
propiedades del runtime de Netlify (§6.2), no del código; un test local con
Supabase mockeado no puede demostrarlas.

Verificación de cierre: `npm run lint && npm test && npm run build` + typecheck.

## 9. Rollout

1. ✅ Aplicar `018_coach_requests.sql` en la Supabase de producción
   (**completado 2026-08-05**).
2. ⏳ Confirmar el bundle desplegado.
3. ⏳ Ejecutar el contraste de §6.2 sobre una ventana real —**pérdida y latencia,
   separadas por camino streaming y no-streaming**— antes de confiar en los
   agregados. Si cualquiera de las dos falla, ejecutar la escalada al endpoint
   dedicado antes de seguir.
4. ⏳ Recién entonces, poblar `MODEL_PRICES` (trabajo separado) y agregar la
   sección medida del chat a `OPTIMIZATION_AND_COSTS.md`, reportando la
   cobertura en filas **y** en tokens (§5.1).

Nota de secuencia (actualizada 2026-08-05): `017` fue aplicada el 2026-08-03 y
`018` fue aplicada el 2026-08-05. La prueba de producción de `018` sigue
pendiente, por lo que todavía no se confía en los agregados ni se da por
validado el impacto de latencia.

## 10. Referencias

- `netlify/functions/coach.ts:26` (clases), `:591` (`logCoachRequest`),
  `:617` (evento `coach.request.completed`), `:527` (`resolvePrimaryProvider`),
  `:656-659` (anónimo), `:327-329` (`shouldUseDeterministicBypass`, solo
  `chat_action`), `:1571` (modelo del bypass), `:1573` (`provider: 'gemini'`
  espurio del bypass), `:1603` y `:1618` (las **dos** bifurcaciones sobre
  `req.stream`: la del bypass y la del camino normal), `:1434-1437`
  (`streamResponse`), y los 6 call sites en
  `:1457 :1484 :1544 :1586 :1626 :1653`.
- `netlify/functions/_shared/promiseTimeout.ts:1-9` — `withTimeout` hace race,
  **no cancela**.
- `src/services/ai/providers/ProxyProvider.ts:211-213` — el loop que obliga a
  no bloquear el cierre del stream.
- `src/services/planBuilder/pricing.ts:22` — cobertura real de `MODEL_PRICES`.
- `supabase/016_plan_generation_jobs.sql` — contrato de tabla que se replica.
- `netlify/functions/_shared/planGenerationTelemetryRetention.ts` — retención.
- `netlify/functions/_shared/__tests__/planGenerationJobSchema.test.ts` — guard
  de drift a copiar.
- `OPTIMIZATION_AND_COSTS.md` §1 y §8 — estado de medición y el pendiente de
  proveedores.

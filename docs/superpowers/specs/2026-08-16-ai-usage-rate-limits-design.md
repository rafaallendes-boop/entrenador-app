# Límites durables de uso y gasto de IA — diseño

Fecha: 2026-08-16
Estado: aprobado para plan de implementación
Roadmap: §Pre-Lanzamiento, punto 3 (blocker P0)

## 1. Problema

Los límites diarios actuales viven en Dexie (`aiRequestLogs`). Sirven como
feedback local, pero no son una barrera de costo: se recuperan borrando los
datos del navegador, no se comparten entre dispositivos y no cubren llamadas
directas a las funciones Netlify. Plan Builder además reserva semanas en el
cliente y las reembolsa ante ciertos fallos, aunque el proveedor ya pueda haber
recibido y cobrado la llamada.

El gate de entitlements del bloque anterior responde **quién puede usar cada
clase**, no cuánto puede consumir. Este bloque agrega la autoridad durable
server-side para las dos preguntas que faltan:

1. ¿Esta cuenta agotó hoy el bucket de la clase?
2. ¿El gasto estimado acumulado alcanzó el techo de la cuenta o del beta?

Los números medidos en `OPTIMIZATION_AND_COSTS.md` cambian la calibración del
circuit breaker. Un usuario `advanced` agotando chat, Week Creator y Plan
Builder puede llegar a aproximadamente **US$1,35–1,40 por día**. Por eso el
techo diario queda en **US$3 por cuenta** y **US$5 global**: deja margen sobre
uso legítimo máximo, pero una sola cuenta no puede consumir por sí sola todo el
presupuesto diario del beta.

## 2. Decisiones tomadas

| Decisión | Valor | Por qué |
|---|---|---|
| Autoridad de cuota | Supabase, server-side | Dexie no es una barrera durable ni multi-dispositivo |
| Unidad consumida | Un intento que está a punto de invocar al proveedor | Es la unidad que puede generar costo; retry y fallback son llamadas reales |
| Momento del incremento | Última operación antes de cada llamada al proveedor | Auth, entitlement, validación y preparación fallidas no consumen cuota |
| Reembolso | Ninguno una vez consumido el contador | Si el proveedor fue invocado, el intento fue real aunque la respuesta falle |
| Buckets y límites | `QUOTA_BUCKETS` existente | Una sola fuente para tiers, clases y cantidades |
| Techo diario por cuenta | US$3 | Margen holgado sobre el máximo legítimo medido |
| Techo diario global | US$5 | Protege al beta completo y no queda anulable por una cuenta |
| Naturaleza del techo de costo | Circuit breaker sobre gasto ya registrado | El costo de la llamada actual solo se conoce después del proveedor |
| Kill switch | Flag independiente | Permite cortar toda IA sin depender del rollout de cuotas |
| Día contable | `usage_date` devuelto por Postgres (`current_date`) | Contador y costo de un intento conservan el mismo día incluso si la respuesta cruza medianoche |
| Outcome nuevo del worker | `quota_exhausted` | No mezcla cuota de uso con `budget_exhausted`, que significa wallclock |

`current_date` usa la zona horaria configurada en Postgres —UTC en el proyecto—.
La UX no promete una hora local exacta de renovación; dice que el cupo se
renueva al siguiente día contable.

## 3. Modelo de datos

### 3.1 Migración `supabase/021_ai_usage_daily.sql`

```sql
create table public.ai_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null,
  bucket_id text not null,
  request_count integer not null default 0 check (request_count >= 0),
  estimated_cost_usd numeric(12,6) not null default 0
    check (estimated_cost_usd >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date, bucket_id)
);

alter table public.ai_usage_daily enable row level security;

create policy ai_usage_daily_select_own
  on public.ai_usage_daily
  for select
  using (auth.uid() = user_id);

-- Sin INSERT/UPDATE/DELETE para clientes. Service role es el único escritor.
revoke all on public.ai_usage_daily from anon, authenticated;
grant select (user_id, usage_date, bucket_id, request_count,
              estimated_cost_usd, updated_at)
  on public.ai_usage_daily to authenticated;
```

Una fila representa el agregado de una cuenta, un día contable y un bucket.
`bucket_id` reutiliza literalmente los ids de `quotaBuckets.ts`: `chat`,
`import`, `weekly_summary`, `week_creator`, `plan_builder_week` y
`plan_builder_pair`. La base no duplica ni conoce los límites por tier.

La PK cubre la consulta por cuenta y día. El total global por fecha no recibe un
índice separado en este bloque: con 10–20 usuarios el scan diario es pequeño.
Si las mediciones muestran que deja de serlo, se agrega un índice por
`usage_date`; no se agrega cache de proceso antes de medir.

### 3.2 Incremento atómico

El check-and-increment vive en una función SQL invocable solo con service role.
Su operación central es una única sentencia:

```sql
insert into public.ai_usage_daily (
  user_id, usage_date, bucket_id, request_count
)
values (p_user_id, current_date, p_bucket_id, 1)
on conflict (user_id, usage_date, bucket_id)
do update
   set request_count = ai_usage_daily.request_count + 1,
       updated_at = now()
 where ai_usage_daily.request_count + 1 <= p_limit
returning usage_date, request_count;
```

Todos los límites actuales son enteros positivos y cada invocación consume
exactamente `1`, por lo que el camino de insert inicial también respeta el
límite. La función rechaza parámetros inválidos (`p_limit < 1`, `user_id` o
bucket ausentes), revoca `execute` de `public`, `anon` y `authenticated`, y lo
concede solamente a `service_role`.

El contrato RPC distingue dos resultados:

- una fila: consumo aceptado; devuelve `usageDate` y el nuevo `requestCount`;
- cero filas: el incremento excedería el límite; nada fue modificado.

No existe una ventana de "leer y después escribir": dos requests concurrentes
serializan sobre la misma fila y solo las que caben obtienen retorno.

### 3.3 Lecturas de gasto y escritura post-respuesta

Una segunda función SQL, también solo para `service_role`, devuelve en una sola
lectura:

```sql
select
  coalesce(sum(estimated_cost_usd)
    filter (where user_id = p_user_id), 0) as account_cost_usd,
  coalesce(sum(estimated_cost_usd), 0) as global_cost_usd
from public.ai_usage_daily
where usage_date = current_date;
```

El gate rechaza si el valor ya acumulado es `>=` al cap. No intenta predecir el
costo de la llamada que sigue.

Después de una respuesta con usage y precio conocidos, el servidor suma el
costo estimado de **ese intento** sobre la fila que acaba de consumir cuota. La
actualización recibe el `usage_date` devuelto por el incremento; no vuelve a
usar `current_date`, porque una llamada que cruza medianoche debe cargar contador
y costo al mismo día.

El costo se calcula con la tabla fechada de `pricing.ts`, incluyendo
`serviceTier`, cache tokens y demás metadata disponible. Si el proveedor no
reporta usage o el modelo no tiene precio, el intento conserva su contador, se
registra una advertencia operacional y no se agrega un delta; por lo tanto, el
acumulador representa **costo conocido**, no una afirmación de que los intentos
sin usage costaron cero. Como en `coach_requests` y `plan_generation_jobs`, el
campo es una estimación basada en telemetría, no una factura del proveedor.

Una falla al registrar costo ocurre después del gasto y no puede deshacerse. Se
registra en logs, pero no convierte una respuesta correcta del modelo en error
para el usuario —eso induciría un retry y más costo—. En cambio, si la lectura o el
incremento del gate fallan **antes** del proveedor con limits encendidos, el
sistema falla cerrado y no llama al modelo.

### 3.4 Taxonomía de jobs

La misma migración reemplaza el check de
`plan_generation_jobs.outcome` para admitir:

```text
succeeded | partial | failed | cancelled | budget_exhausted | quota_exhausted
```

`quota_exhausted` se usa cuando el incremento atómico de
`plan_builder_week` rechaza. `budget_exhausted` conserva su significado actual:
presupuesto de wallclock insuficiente. Un rechazo por spend cap o kill switch
termina como `failed`; su `errorCode` queda en la semana/log. No se lo etiqueta
como cuota diaria porque son causas distintas.

## 4. Política pura y helper de servidor

### 4.1 Constantes y evaluación

Un módulo puro nuevo, junto a la política de entitlements, define:

```ts
export const ACCOUNT_DAILY_SPEND_CAP_USD = 3
export const GLOBAL_DAILY_SPEND_CAP_USD = 5
```

También expone la evaluación total del spend cap y la construcción/validación de
sus detalles tipados. Los límites de cantidad **no** se copian ahí: se resuelven
con `bucketForClass` y `bucketLimitForTier` sobre `QUOTA_BUCKETS`.

Los montos son constantes versionadas, no env vars. Netlify captura la
configuración por deploy; cambiar un número ya requiere desplegar y el commit
deja auditable el cambio de política.

### 4.2 Flags

El helper de servidor sigue el patrón exacto de `ENTITLEMENTS_ENABLED`: solo la
cadena `true` enciende una flag.

- `AI_USAGE_LIMITS_ENABLED`: activa cuota durable y spend caps.
- `AI_KILL_SWITCH_ENABLED`: corta la funcionalidad de IA aún cuando la flag de
  limits este apagada.

El kill switch es la primera comprobación de toda la cadena — antes incluso
que el entitlement — y no hace I/O. Durante un incidente, un usuario `free`
pidiendo una clase que ni siquiera tiene permitida ve el mismo
`503 kill_switch_active` que un `advanced`: el corte es operacional, no de
plan, y el mensaje debe reflejar eso en vez de mostrar `entitlement_required`
por casualidad de orden. En `coach.ts` también se comprueba antes del bypass
determinista; "corte total" significa que no queda una ruta funcional por
fuera del switch. En el enqueue se comprueba antes de crear el job, para no
encolar trabajo que el worker ya sabe que rechazará.

### 4.3 Orden no negociable

Para una llamada que llega al punto de proveedor:

```text
1. auth
2. kill switch
3. entitlement
4. spend cap acumulado de cuenta/global       (lectura, si limits = true)
5. cuota del bucket                            (incremento atómico, si limits = true)
6. proveedor
7. costo conocido del intento                  (suma post-respuesta)
```

El kill switch corta antes que cualquier otra cosa porque no depende del tier
ni de la clase pedida — es un apagado total, no una regla de negocio. Con el
switch apagado, la clase se valida y se autoriza antes de buscar bucket o
cuota: una clase no permitida sigue produciendo `403 entitlement_required`,
nunca una cuota cero.

El helper usa `SUPABASE_SERVICE_ROLE_KEY`. Con `AI_USAGE_LIMITS_ENABLED=true`,
una key ausente, RPC inexistente, timeout o respuesta ilegible es un fallo
cerrado (`503 server_error`) y se verifica que el proveedor no fue llamado. Con
la flag apagada no se inicializa el cliente ni se hace I/O de usage.

## 5. Puntos de inyección

### 5.1 `coach.ts`

`coach.ts` cubre `chat_general`, `chat_action`, `weekly_summary`,
`week_creator`, `import_extract` y `plan_builder_pair` (y cualquier clase
síncrona que pase por el proxy).

El check-and-increment no se coloca una sola vez después de auth. Envuelve
`invokeProvider` dentro de `runAttempt`, inmediatamente antes de cada llamada
real. De esta forma:

- validación, auth, entitlement y preparación fallidas no cuentan;
- un retry técnico consume su propia unidad;
- un fallback a otro proveedor consume su propia unidad;
- un error del gate no entra en la política de retry del proveedor.

La lectura de spend y el incremento se hacen con `auth.userId`, el tier ya
resuelto y el bucket de `requestClass`. El contexto autenticado tiene que llegar
hasta `executeWithPolicy/runAttempt`; no se vuelve a derivar la identidad desde
el payload.

El kill switch se consulta también antes del bypass local para cumplir el corte
total. El bypass no incrementa cuota ni costo porque no invoca proveedor.

### 5.2 `enqueue-plan-generation.ts`

El enqueue **no reserva ni incrementa** `plan_builder_week`: escribir un job no
es una llamada al proveedor.

Después de auth, el kill switch se comprueba primero — mismo motivo que en
`coach.ts`: es un apagado total, independiente del tier. Recién después va el
entitlement (ya existente). Y antes de `createSupabaseWriter`/`putPlan`, un
preflight de solo lectura:

- spend cap ya alcanzado;
- contador actual de `plan_builder_week` ya en el límite.

Si alguno ya está agotado, devuelve el mismo error contractual sin crear ni
modificar el job. Si todavía hay espacio, el job se crea aunque varias semanas
puedan competir por el último cupo: el preflight es solo una optimización de UX,
no una reserva ni una promesa. La autoridad real se ejecuta intento por intento
en el worker.

### 5.3 `generate-plan-background.ts` y `asyncGenerationLoop.ts`

El worker conserva su gate de entitlement para la invocación directa, con el
kill switch comprobado primero — mismo orden que en `coach.ts` y en el
enqueue. La función que entrega como `callLLM` al loop queda envuelta por el
gate de usage:
cada `attempt 1` o `attempt 2` de cada semana consume atómica e inmediatamente
antes de `callAnthropicForWeek`.

`generateWeekCoreWithRetry` reconoce los errores tipados del gate y los vuelve
a lanzar. No los convierte en `provider_failed`, no ejecuta el segundo attempt
y no construye fallback local como si el modelo hubiera fallado.

Al recibir uno de estos rechazos, el loop:

1. marca la semana actual en error con el `errorCode` correspondiente;
2. activa `stopLaunching`, por lo que no toma nuevas semanas del mismo job;
3. marca terminales las semanas target todavía no iniciadas, sin consumirlas;
4. permite terminar a los intentos paralelos que ya habían consumido cuota y
   estaban en vuelo;
5. persiste el plan terminal y emite una sola fila de job.

Si la causa fue `quota_exceeded`, el job usa `quota_exhausted`. Spend cap y kill
switch usan `failed`. Esta salida no usa
`terminalizeRejectedJob`: ese helper pertenece al rechazo temprano de
entitlement, antes de que el loop haya armado su propio `finally`. Una vez
armado `finalizeJob`, el loop es el único dueño de la terminalizacion.

## 6. Contrato de errores

Los errores llevan código y detalle estructurado; el cliente nunca decide por
texto.

| HTTP | `errorCode` | `detail` | Retry automático |
|---|---|---|---|
| 429 | `quota_exceeded` | `{ bucketId, limit, remaining }` | No; esperar al siguiente día contable |
| 429 | `spend_cap_exceeded` | `{ scope: 'account' \| 'global', capUsd }` | No; esperar al siguiente día contable |
| 503 | `kill_switch_active` | Sin detalle obligatorio | No; depende de reactivación operacional |

El rechazo atómico tiene `remaining: 0`. El preflight del enqueue calcula
`remaining` desde la lectura, también sin reservar.

Los tres códigos se agregan a `TechnicalErrorCode` y `AIErrorCode`. Igual que
ocurrió con entitlements, hay dos aplanados que deben corregirse juntos:

- `coach.normalizeError` preserva estos códigos y `detail` antes de convertir
  todo `429` a `rate_limit` o todo `503` a `timeout`;
- `classifyProxyHttpError` los reconoce antes de sus ramas genéricas de
  `429`/`503`, crea errores no reintentables y conserva el detalle valido.

`enqueue-plan-generation` devuelve la misma forma. `PlanEnqueueRejectedError`
conserva el `errorCode` de usage para que Plan Builder muestre el mismo mensaje
que el chat, sin confundirlo con entitlement ni caer al polling de un job que no
existe.

## 7. Cliente

El servidor pasa a ser la única autoridad de seguridad. Los checks locales de
`assertDailyAIRequestLimit` y las reservas/reembolsos de
`plan_builder_week` pueden seguir como preflight de UX y para alimentar el
snapshot de calidad, pero no se confía en ellos: una llamada que los evite igual
encuentra el gate server-side. Borrar IndexedDB puede reiniciar el indicador
local, pero no recupera cupo real.

El reembolso que hoy hace `releasePlanBuilderWeekReservations` solo modifica
telemetría local. Nunca decrementa `ai_usage_daily` ni crea una operación de
compensación server-side. Retirar o rediseñar esas reservas locales no es
requisito de este bloque.

La UI agrega copy seguro por `errorCode`:

- `quota_exceeded`: se alcanzó el cupo diario de esa función;
- `spend_cap_exceeded`: el servicio alcanzó su presupuesto diario;
- `kill_switch_active`: la IA está temporalmente pausada por el owner.

Ninguno abre `UpsellCard` ni ofrece upgrade: pagar otro tier no resuelve el
rechazo. El mensaje indica esperar al siguiente día o a que el servicio sea
reactivado, según corresponda. El texto técnico del servidor no se imprime
crudo en chat ni en Plan Builder.

## 8. Rollout

1. Aplicar manualmente `supabase/021_ai_usage_daily.sql`.
2. Desplegar el código con `AI_USAGE_LIMITS_ENABLED=false` y
   `AI_KILL_SWITCH_ENABLED=false`. No cambia el comportamiento.
3. Confirmar con service role que las RPC existen, que clientes autenticados
   solo pueden leer sus filas y que no pueden insertar/actualizar.
4. Encender `AI_USAGE_LIMITS_ENABLED` mediante el deploy/configuración de
   Netlify correspondiente.
5. Ejecutar smoke dirigido con una cuenta de prueba: llevar temporalmente un
   límite de test al borde, confirmar una aceptación y luego el `429` con
   `errorCode/detail` correctos en coach, enqueue y worker.
6. Restaurar el límite productivo y confirmar que el costo conocido incrementa
   la misma fila/fecha que el contador.
7. Dejar `AI_KILL_SWITCH_ENABLED=false`, documentado y listo para un incidente.

Activar el kill switch no requiere que usage limits esté activo. Desactivarlo
tampoco activa automáticamente los límites: son controles independientes.

## 9. Verificación automatizada

Se sigue el patrón de entitlements: policy pura y handlers con Supabase/fetch
mockeados. No se levanta Postgres real en la suite del repositorio.

No negociables:

- policy de spend: debajo del cap permite; igualdad y exceso rechazan; cuenta y
  global devuelven el scope correcto;
- flags: solo `true` enciende; kill switch funciona con limits apagado;
- gate atómico mockeado: una fila permite y conserva `usageDate`; cero filas
  produce `429 quota_exceeded`;
- error/timeout/RPC ausente con limits encendido falla cerrado y no llama al
  proveedor;
- `coach.ts`: el gate ocurre por intento real; retry y fallback vuelven a
  consumir; un rechazo no dispara retry;
- bypass determinista: kill switch lo bloquea, pero con switch apagado no
  consume cuota ni costo;
- enqueue: un preflight rechazado no crea writer/job; uno aceptado no incrementa
  contador;
- worker: attempt 1 rechazado no llama a `callLLM`, no ejecuta attempt 2, detiene
  nuevas semanas y emite `quota_exhausted`;
- worker paralelo: intentos ya admitidos pueden terminar, pero no se lanzan
  semanas nuevas después del rechazo;
- un intento fallido después de invocar al proveedor conserva la unidad y no se
  reembolsa;
- costo: respuesta con usage suma una vez; costo desconocido no suma un cero
  ficticio; una llamada que cruza medianoche actualiza el `usageDate` reservado;
- `normalizeError` y `classifyProxyHttpError` preservan cada código/detail y los
  tres errores son no reintentables;
- chat y Plan Builder muestran copy específico y nunca `UpsellCard`;
- compatibilidad: con ambas flags apagadas no se consulta ni escribe
  `ai_usage_daily` y la conducta previa queda intacta.

Los tests de wiring siguen los precedentes
`coachEntitlementGate.test.ts`, `enqueuePlanEntitlement.test.ts` y
`backgroundPlanEntitlement.test.ts`. La policy usa
`spendCapPolicy.test.ts`, en paralelo a `entitlementPolicy.test.ts`.

## 10. Límites conocidos

El spend cap es deliberadamente un circuit breaker, no una transacción de
presupuesto:

- la llamada que cruza el cap ya fue realizada;
- varias llamadas concurrentes pueden leer un total inferior al cap y quedar en
  vuelo al mismo tiempo;
- usage o pricing ausentes pueden dejar costo no estimable;
- el agregado server-side no reemplaza la factura/dashboard del proveedor.

La cuota de cantidad si es estricta bajo concurrencia, porque su incremento y
comparación ocurren en la misma sentencia SQL.

## 11. Fuera de alcance

- panel de admin para consultar gasto en vivo;
- límites o caps editables sin commit/deploy;
- cache de proceso para el total global;
- alertas automáticas de gasto o incidentes;
- reconciliación contra facturas del proveedor;
- auditoría append-only de cada movimiento de cuota/costo;
- cambios al mapa de tiers o precios.

Panel, alertas y observabilidad operacional ampliada pertenecen al punto 5/10
del roadmap y se especifican por separado.

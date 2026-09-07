# Observabilidad de lanzamiento — dashboard de operación y errores de cliente

Fecha: 2026-08-23
Estado: **decisiones cerradas** (§3) — listo para plan de implementación
> Actualización 2026-09-06: la **Entrega B** se rige por
> [la definición revisada del reporter](2026-09-06-client-error-reporting-design.md),
> que modifica identidad, frames y captura de sync. Este documento conserva
> el diseño original y el contrato de Entrega A.

Roadmap: §Pre-Lanzamiento, punto 10 (P1, necesario durante beta). Solapa
parcialmente con el punto 12 (funnel), que queda fuera de alcance.

## 1. Problema

La instrumentación por fila ya existe y está en producción: `coach_requests`
(`018`), `plan_generation_jobs` (`016`), `plan_generation_attempts` (`014`) y,
cuando se aplique `021`, `ai_usage_daily`. Lo que no existe es **agregación**:
responder "cuánto se gastó hoy", "qué proporción de requests falló" o "apareció
un error nuevo" hoy exige abrir el SQL editor y escribir la consulta a mano.

Y falta una fuente entera: **los errores de JavaScript en el dispositivo del
usuario son invisibles**. No hay ningún reporter en el repositorio. Hoy
`AppRouteBoundary` (`src/App.tsx:67`) captura el error de render, lo escribe con
`console.error` y le muestra al usuario el `error.message` crudo
(`src/App.tsx:97`) — que nadie más ve y que además expone texto interno.

El objetivo declarado por el roadmap es poder responder, en menos de cinco
minutos y sin abrir el código: cuántas cuentas estuvieron activas, cuántas
requests fallaron y por qué, cuánto se gastó, y si apareció un error nuevo.

## 2. Decisiones tomadas

| Decisión | Valor | Por qué |
|---|---|---|
| Proveedor externo | Ninguno (ni Sentry ni equivalente) | Para 10–20 usuarios el costo de integración y el de exponer datos a un tercero superan el beneficio; toda la telemetría ya vive en Supabase |
| Autorización del dashboard | `OPERATIONS_ADMIN_USER_IDS` (UUID de Supabase), env server-only | Una allowlist `VITE_*` viaja en el bundle público; el precedente de `VITE_COACH_ACCOUNTS` es exactamente el error a no repetir. Nunca emails |
| Guard de cliente | Ninguno | La ruta `/ops` llama y trata el `403` como estado. No duplicar la autoridad en el cliente |
| Agregación | En SQL, vía RPC `security definer` sólo para `service_role` | Postgres no expone percentiles por REST, y así la función Netlify nunca manipula filas por usuario: recibe agregados |
| Texto libre persistido | **Ninguno.** Ni mensaje, ni mensaje saneado, ni stack | Ver §3 D1: el código interpola ids y datos en mensajes de error, y una regex es mitigación, no anonimización |
| Diagnóstico persistido | `error_name` validado + `diagnostic_code` de conjunto cerrado | Categorías fijas escritas por nosotros; no pueden contener nada que no hayamos escrito antes |
| Evolución de la taxonomía | Expansión controlada y **append-only**, nunca dinámica | Ocho códigos desde el primer deploy; `unknown` es una métrica de calidad del clasificador, no un cajón permanente. Ver §6.2 |
| Ruta del evento | Normalizada contra una allowlist de patrones | `/day/2026-08-23` lleva una fecha; el patrón `/day/:date` no lleva nada |
| Identidad en eventos de cliente | Ninguna. Se exige sesión, se descarta el `user_id` antes de persistir | Impide que el dashboard se convierta en herramienta de seguimiento individual |
| Retención de errores | 30 días, dentro del cron ya existente | `plan-generation-telemetry-retention.ts` ya corre `0 4 * * *` con service role sobre tres tablas |
| Entrega | Dos bloques independientes (A y B) | A no depende de ninguna decisión legal y entrega valor sin telemetría nueva |
| Boundary en producción | Deja de mostrar `error.message` al usuario | Es una mejora de producto por sí sola, independiente del reporter |

## 3. Decisiones cerradas (2026-08-23)

### D1 — No se guardan mensajes de error, ni saneados

Se persiste `error_name` (validado), `diagnostic_code` de una lista cerrada,
ruta normalizada, componente opcional y fingerprint derivado de esos campos.

**Razón:** el código interpola identificadores y datos en los mensajes —
`Ejercicio de fuerza inexistente: <id>` (roadmap §21) es un caso real ya
documentado, y los errores de Supabase y Dexie arrastran fragmentos de fila. Una
lista de regex reduce la probabilidad de fuga; no la elimina, y no se puede
auditar contra mensajes que todavía no se escribieron.

**Consecuencia declarada:** el dashboard dirá *"`react_render_error` /
`TypeError` en `/plan-builder`, componente `PlanBuilderV2Page`, release `a1b2c3`,
14 veces"*. Eso ubica el error y su deploy, pero **no lo explica**: para
reproducirlo hay que ir al código o pedirle el paso al beta tester. Es
suficiente para el criterio de Done del roadmap —saber que apareció uno nuevo y
dónde—, no para diagnosticar sin salir del dashboard.

### D2 — No se usa `last_sign_in_at`; las métricas se nombran por lo que miden

En una SPA con sesión persistida puede haber semanas de actividad sin un login
nuevo, así que `last_sign_in_at` sobreestimaría inactividad. El dashboard
publica dos métricas con nombre preciso, ambas desde la telemetría que ya
existe:

- **Cuentas con uso de IA** — `count(distinct user_id)` de `coach_requests`.
- **Cuentas con planificación** — `count(distinct user_id)` de
  `plan_generation_jobs`.

**Consecuencia declarada, y es la más importante de esta sección:** las dos
salen de telemetría de IA, así que **una cuenta que entra, registra
entrenamientos y completa sesiones sin tocar la IA es invisible para el
dashboard**. Ninguna de las dos métricas es "usuarios activos" y la UI no debe
llamarlas así. Si durante la beta hace falta cubrir ese hueco, la vía sin costo
legal es un `count(distinct user_id)` agregado sobre `sessions`/`day_logs` por
`updated_at` —sólo `COUNT`, sin leer contenido— y queda anotada como ampliación
posible, no como parte de esta entrega.

### D3 — Los eventos de cliente no llevan `user_id`

La función exige sesión válida —es control de acceso al endpoint— y **descarta
el identificador antes de persistir**. La tabla no contiene ningún dato
personal.

**Consecuencia declarada:** no existe límite de frecuencia durable por cuenta.
El control queda en el cap por sesión de navegador y la deduplicación del
cliente, más un `Map` en memoria del servidor que es best-effort — el mismo
límite que `enforceRateLimit` (`netlify/functions/coach.ts:848`) ya demuestra:
no cuenta entre instancias de Netlify. Aceptado para el piloto.

### D4 — Sólo usuarios autenticados en v1

**Consecuencia declarada:** los errores de landing, registro y login quedan
fuera, y son justamente los del embudo de entrada. Aceptar eventos anónimos
exigiría control antiabuso por IP y una revisión de privacidad aparte.
Reevaluar si la beta reporta problemas de login que el dashboard no vio.

## 4. Alcance en dos entregas

**Entrega A — dashboard sobre lo que ya existe.** Migración `022` con el RPC de
agregación, función Netlify, ruta `/ops`. Sin telemetría nueva, sin cambios en
el consentimiento, sin decisiones legales pendientes. Cubre `coach_requests`,
`plan_generation_jobs`, `plan_generation_attempts` y `ai_usage_daily`.

**Entrega B — reporter de errores de cliente.** Migración `023`, endpoint de
ingesta, captura en el cliente detrás de flag, y la tarjeta de errores en el
dashboard.

> **Numeración:** `021` es la última migración escrita. Como A ahora trae su
> propio `.sql`, **A toma `022` y la tabla de errores pasa a `023`**. Las dos
> son de aplicación manual, como todas las anteriores.

A se puede desplegar y usar sin que B exista. B no tiene sentido sin A.

## 5. Modelo de datos

### 5.1 `supabase/022_operations_metrics.sql` (Entrega A)

Sólo un RPC. No crea tablas ni toca las existentes.

```sql
create or replace function public.read_operations_metrics(p_since timestamptz)
returns jsonb
language sql
security definer
set search_path = public
as $$ ... $$;

revoke all on function public.read_operations_metrics(timestamptz)
  from public, anon, authenticated;
grant execute on function public.read_operations_metrics(timestamptz) to service_role;
```

Devuelve **sólo agregados**: conteos, `count(distinct user_id)`,
`percentile_cont` sobre latencias, sumas de costo y tokens con su cobertura.
Nunca filas individuales, nunca un `user_id`. Esto no es adorno: es lo que hace
que la función Netlify no tenga acceso a datos por usuario ni aunque alguien la
modifique después.

> **Regla heredada de `OPTIMIZATION_AND_COSTS.md`:** `estimated_cost_usd = null`
> no es cero. Toda suma de costo excluye nulls y **reporta cobertura en dos
> dimensiones** — porcentaje de filas y porcentaje de tokens —, porque las
> requests caras suelen ser pocas.

### 5.2 `supabase/023_client_error_events.sql` (Entrega B)

```sql
create table public.client_error_events (
  id bigint generated always as identity primary key,
  -- Sin user_id: D3. La ausencia de esta columna es la garantía, no una policy.
  source text not null check (source in ('window_error', 'unhandled_rejection', 'react_boundary')),
  -- Append-only: ver §6.2. Ampliar esta lista es una migración nueva; quitar un
  -- valor rompería la validación de las filas ya persistidas.
  diagnostic_code text not null check (diagnostic_code in (
    'chunk_load', 'network_failure', 'timeout', 'render_failure',
    'storage_failure', 'data_parse_failure', 'third_party_failure', 'unknown'
  )),
  fingerprint text not null,
  error_name text not null,
  component text null,
  route text not null,
  release text not null,
  platform text not null check (platform in ('web', 'ios')),
  created_at timestamptz not null default now()
);

create index client_error_events_fingerprint_created_idx
  on public.client_error_events (fingerprint, created_at desc);
create index client_error_events_created_idx
  on public.client_error_events (created_at desc);

alter table public.client_error_events enable row level security;
-- Sin políticas: ni select ni insert para clientes. service_role escribe y lee.
revoke all on public.client_error_events from anon, authenticated;
```

**`source` y `diagnostic_code` son ejes independientes a propósito.** `source`
es de dónde llegó el evento (`window_error`, `unhandled_rejection`,
`react_boundary`); `diagnostic_code` es qué lo causó. Una promesa rechazada por
un chunk que no cargó es `source = unhandled_rejection` y
`diagnostic_code = chunk_load`. Colapsarlos perdería la mitad de la señal, que
es exactamente el tipo de error que más importa después de un deploy. Por eso
`unhandled_rejection` **no** es un `diagnostic_code`: un rechazo sin causa
reconocible es `unknown`, y eso es información — dice que hay que mejorar el
clasificador.

## 6. Reporter de cliente (Entrega B)

Tres fuentes: `window.addEventListener('error')`,
`window.addEventListener('unhandledrejection')` y `componentDidCatch` de
`AppRouteBoundary` (`src/App.tsx:80`).

**Flag:** `VITE_CLIENT_ERROR_REPORTING_ENABLED`, apagada por defecto.

### 6.1 Clasificación

El clasificador es **la única pieza que toca el error crudo, y su salida nunca
sale del dispositivo**: mira el error en memoria y emite un `diagnostic_code` de
la lista cerrada. El mensaje no se envía, no se almacena y no se registra.

Las reglas se evalúan **en orden fijo y la primera que matchea gana**. El orden
queda congelado por test, igual que el normalizador de superseries.

| # | Regla | Código |
|---|---|---|
| 0 | `error instanceof AIProviderError` → mapear `.code` (unión tipada, sin leer texto): `timeout` → `timeout`; `parse_error`/`truncated` → `data_parse_failure`; `server_error`/`misconfigured`/`unauthorized` → `network_failure` | según mapeo |
| 1 | `ChunkLoadError`, fallo de import dinámico o de carga de script del propio origen | `chunk_load` |
| 2 | `TimeoutError` (incluido el `DOMException` de `AbortSignal.timeout`) | `timeout` |
| 3 | Error de IndexedDB/Dexie: `QuotaExceededError`, `DatabaseClosedError`, `VersionError`, `InvalidStateError`, o `AbortError` con marca de transacción Dexie | `storage_failure` |
| 4 | `SyntaxError` de `JSON.parse` o fallo de deserialización | `data_parse_failure` |
| 5 | `filename` con esquema de extensión (`chrome-extension://`, `moz-extension://`, `safari-web-extension://`) | `third_party_failure` |
| 6 | `TypeError` de `fetch` fallido o error de red sin respuesta | `network_failure` |
| 7 | `source === 'react_boundary'` y ninguna regla anterior matcheó | `render_failure` |
| 8 | Todo lo demás | `unknown` |

Tres cosas que el orden resuelve y que conviene no reordenar sin pensarlo:

- **La regla 0 va primera porque no adivina.** `AIErrorCode`
  (`src/services/ai/types.ts:165-177`) ya es una unión tipada de 12 valores
  expuesta por `AIProviderError.code`. Es el único input del clasificador que no
  depende de inspeccionar texto, y por eso manda.
- **La causa gana sobre la superficie.** Un `import()` perezoso que falla dentro
  de `Suspense` estalla en el boundary: es `chunk_load` (regla 1), no
  `render_failure`. `render_failure` es el fallback del boundary, no su
  etiqueta por defecto.
- **`third_party_failure` casi no debería dispararse.** El CSP de `netlify.toml`
  fija `script-src 'self'`, así que no hay terceros legítimos: lo que queda son
  extensiones del navegador. Se conserva la categoría porque "la extensión del
  beta tester rompe la app" es un caso de soporte real, y distinguirlo de un bug
  propio ahorra una tarde.

### 6.2 Gobernanza de la taxonomía — expansión controlada

La lista es **cerrada por release y validada en las tres capas**: clasificador
del cliente, allowlist de la función y `CHECK` de la base. No se agregan códigos
sobre la marcha ni mirando errores individuales.

Reglas:

1. Se revisa semanalmente el volumen de `unknown` **agregado** por `source`,
   `error_name`, ruta y release. Nunca caso por caso.
2. Un código nuevo se justifica sólo si la clase es **recurrente, técnicamente
   segura y accionable**. Un error de un único usuario no funda una categoría.
3. Agregar un código es migración + tests + despliegue, en ese orden:
   **`CHECK` de la base → allowlist de la función → clasificador del cliente.**
   Nunca el cliente primero — mismo invariante que entitlements y cuotas.
4. **La lista es append-only.** Quitar un valor rompería la validación de las
   filas ya persistidas con él, igual que el gate append-only de los 77 ids de
   fuerza. Un código que deja de usarse se deja de emitir; no se borra.
5. **El clasificador sí puede mejorar libremente su mapeo hacia códigos que ya
   existen** — eso no toca el esquema y no necesita migración. Es el camino
   preferido: la mayoría de las bajas de `unknown` deberían venir de acá, no de
   códigos nuevos.

`unknown` es un indicador de calidad del clasificador y se publica como tal en
el dashboard (§8), con su tendencia. Un `unknown` que baja release a release es
la señal de que la regla 5 está funcionando.

### 6.3 `error_name`


Se envía `error.name`, **validado contra `^[A-Za-z][A-Za-z0-9_]{0,63}$`**. Es un
nombre de clase (`TypeError`, `ChunkLoadError`, subclases propias), pero `name`
es una propiedad escribible y nada impide que algún día alguien le asigne un
valor dinámico. Un `name` que no valide se persiste como `InvalidName`, no se
descarta el evento. La validación corre en cliente **y** en servidor; la del
servidor es la barrera.

### 6.4 Ruta

Se compara `location.pathname` contra los patrones de
`src/constants/routes.ts`. Si no matchea ninguno, `unknown`. Nunca se envía la
ruta cruda, ni `search`, ni `hash`.

### 6.5 Allowlist de ignorados

Sin esto el canal se ahoga en ruido que no es un bug:

- **Abortos deliberados de red:** `AbortError` proveniente de `fetch` (el sync y
  Whoop abortan a propósito). **Ojo con la colisión:** Dexie también lanza
  `AbortError` al abortar una transacción, y eso **sí** es un fallo real que la
  regla 3 clasifica como `storage_failure`. La regla de ignorados debe
  discriminar por origen, no por `name` — si no, el ignorado se traga el error
  de almacenamiento. Es la única inspección donde equivocarse pierde señal en
  vez de agregar ruido.
- `ResizeObserver loop completed with undelivered notifications`.
- `Script error.` **sin `filename`** (cross-origin no atribuible). Con
  `filename` de extensión sí se reporta, como `third_party_failure`.
- **Rechazos de negocio esperados:** `entitlement_required`, `quota_exceeded`,
  `spend_cap_exceeded`, `kill_switch_active` y `rate_limit` de
  `AIProviderError`. Tienen su propia UI y su propia telemetría server-side; son
  estados del producto, no fallos del cliente. Reportarlos inundaría el
  dashboard con no-bugs justo cuando se enciendan las cuotas.

`ChunkLoadError` **no** se ignora: es la señal de bundle stale tras un deploy y
es de las más útiles en una beta.

### 6.6 Cap y dedupe

- máximo **10 eventos por sesión de pestaña**;
- dedupe por fingerprint local dentro de la sesión (el segundo idéntico no se
  envía);
- envío best-effort con `keepalive`; si falla, la app sigue y no reintenta.

### 6.7 Boundary en producción

Deja de renderizar `this.state.message` (`src/App.tsx:97`) cuando
`import.meta.env.PROD`. En dev se conserva.

### 6.8 `release`

**No existe todavía y hay que crearlo.** `vite.config.ts` no define ninguna
constante de versión. Se agrega `__APP_RELEASE__` desde `COMMIT_REF` de Netlify
(fallback `'dev'`). Sin esto el campo es constante y se pierde lo único que de
verdad importa en una beta: distinguir "esto lo rompió el deploy de ayer".

## 7. Endpoint `report-client-error` (Entrega B)

- Requiere sesión autenticada (D4). **El `user_id` se usa para autorizar y se
  descarta antes de construir la fila** (D3); no se loguea.
- Valida un payload **allowlisted** campo por campo: conjuntos cerrados para
  `source`, `diagnostic_code`, `route` y `platform`; regex para `error_name`,
  `component` y `release`; largos máximos. Cualquier campo extra se descarta;
  cualquier campo inválido devuelve `400` sin persistir.
- **El fingerprint lo calcula el servidor**, no el cliente:
  `sha256(error_name | diagnostic_code | component | route)` truncado a 16 hex.
  Si lo calculara el cliente, dos versiones del bundle podrían producir hashes
  distintos para el mismo error.
- Escribe con `service_role`.
- **Límite de frecuencia:** cap de sesión y dedupe del cliente, más un `Map` en
  memoria del servidor. Best-effort por construcción (D3).

## 8. Endpoint `operations-dashboard` (Entrega A)

Autoriza contra `OPERATIONS_ADMIN_USER_IDS` (lista de UUID separada por comas,
server-only). Cualquier otra cuenta autenticada recibe `403`. Sin sesión, `401`.

Ventanas: 24 h y 7 días. Métricas:

| Bloque | Fuente | Métricas |
|---|---|---|
| Actividad | `coach_requests`, `plan_generation_jobs` | Cuentas con uso de IA; cuentas con planificación (D2 — no son "usuarios activos") |
| Coach | `coach_requests` | Requests, tasa de error, top `error_code`, latencia p50/p90/p95, costo y tokens + cobertura |
| Plan Builder | `plan_generation_jobs` | Corridas por `outcome`, p50/p90/p95 de `first_week_ready_ms` y `plan_complete_ms`, costo + cobertura |
| Reparación | `plan_generation_attempts` | Distribución de outcome por intento |
| Cuotas | `ai_usage_daily` | Requests y costo por bucket; cuentas que tocaron techo |
| Errores (B) | `client_error_events` | Top-N por fingerprint con `error_name`, `diagnostic_code`, ruta y release; tendencia por release |
| Triage (B) | `client_error_events` | **Volumen de `unknown` agregado por `source`, `error_name`, ruta y release**, con su proporción sobre el total |

**Percentiles:** se calculan p50, p90 y p95. El p90 se conserva porque es el que
usan el roadmap y `OPTIMIZATION_AND_COSTS.md`, y comparar contra la línea base
existente exige la misma medida; p95 se agrega porque la cola es lo que se siente
en uso real. En SQL las tres salen de la misma pasada.

**El panel de triage no es decorativo:** es el instrumento de la regla 1 de
§6.2. Sin él la gobernanza de la taxonomía no tiene con qué ejecutarse y la
revisión semanal degenera en mirar errores sueltos, que es justamente lo que la
regla prohíbe.

**Degradación por tabla:** `021` todavía no está aplicada en producción. La
ausencia de `ai_usage_daily` (y de `client_error_events` antes de la Entrega B)
debe mostrar "sin datos" en su tarjeta, **no** romper la vista completa. Mismo
criterio que la tolerancia a tabla ausente que ya tiene el borrado de Whoop.

## 9. Ruta `/ops` (Entrega A)

- `lazy()` como el resto de las páginas (`src/App.tsx:37-45`), para no engordar
  el bundle de todos los usuarios.
- Sin entrada en navegación.
- Estados: cargando, `403` ("no autorizado"), error de red, y ausencia de datos.
- Indexado: el catch-all de `netlify.toml` sirve `spa-fallback.html`, que
  conserva `noindex,nofollow`. No hace falta nada más.
- CSP: **no hay que tocarla.** `connect-src 'self' https://*.supabase.co` ya
  cubre `/.netlify/functions/*` por ser mismo origen.

## 10. Retención

`client_error_events` se agrega al cron existente
(`netlify/functions/plan-generation-telemetry-retention.ts`, `0 4 * * *`), con
constante propia de **30 días** frente a los 90 de
`PLAN_GENERATION_TELEMETRY_RETENTION_DAYS`. Se extienden el mapa de tablas y su
test de cobertura. Consecuencia declarada: cualquier comparación histórica de
más de 30 días no puede cruzar errores con telemetría de IA.

## 11. Legal

`privacy@2026-08-08` ya declara como *Datos técnicos* "información mínima
necesaria para operar, autenticar, sincronizar y **diagnosticar errores del
servicio**"
(`src/services/legal/publications/privacy.2026-08-08.ts:62-66`).

Con D1 y D3 cerradas, esta entrega queda dentro de esa cláusula con holgura y
**no requiere publicación nueva ni reaceptación**: la tabla no contiene identidad
ni texto libre, sólo categorías que escribimos nosotros.

Esa holgura depende de las restricciones de §5.2 y §6. Si en el futuro se
guardan mensajes, stacks, URLs con query o `user_id`, cambia la categoría de
dato y §25 del roadmap obliga a una publicación nueva con reaceptación. Es un
costo real: hay que decidirlo antes, no descubrirlo después.

## 12. Rollout

1. Aplicar `022` y setear `OPERATIONS_ADMIN_USER_IDS` con el UUID de Supabase
   del owner.
2. Entrega A: desplegar `operations-dashboard` + `/ops`. Verificar `403` desde
   una segunda cuenta real y validar el dashboard contra datos reales ya
   existentes.
3. Entrega B: aplicar `023`, desplegar con
   `VITE_CLIENT_ERROR_REPORTING_ENABLED=false`.
4. Encender la flag sólo tras una prueba sintética controlada.
5. Confirmar que el evento aparece agregado en `/ops`, que la ruta está
   normalizada, que no hay ningún texto libre persistido y que el usuario no vio
   texto técnico.

Ningún paso consume API de IA.

## 13. Verificación automatizada

- Autorización: sin sesión → 401; cuenta no listada → 403; cuenta listada → 200.
- Forma de respuesta del dashboard: contrato estable con tablas presentes y
  ausentes.
- **Ningún campo de texto libre alcanza la fila**: un error cuyo mensaje
  contiene un email y un UUID produce una fila sin rastro de ninguno de los dos.
- **Ningún `user_id` alcanza la fila** — verificado sobre el payload construido,
  no sólo sobre el schema.
- Clasificación: un caso por cada uno de los ocho `diagnostic_code`, más el
  orden de reglas congelado por snapshot.
- Precedencia verificada en los tres cruces que importan: `AIProviderError`
  gana sobre inspección de forma; un `import()` fallido dentro del boundary es
  `chunk_load` y no `render_failure`; un `AbortError` de Dexie es
  `storage_failure` y **no** cae en la allowlist de ignorados.
- Rechazos de negocio (`entitlement_required`, `quota_exceeded`,
  `spend_cap_exceeded`, `kill_switch_active`, `rate_limit`) no producen
  escritura.
- Taxonomía: las tres capas —clasificador, allowlist de la función y `CHECK`—
  declaran exactamente el mismo conjunto; un código presente en una y ausente en
  otra rompe en CI. Mismo patrón que el guard de drift de las columnas de zonas
  de FC.
- `error_name`: un `name` con caracteres fuera del patrón se persiste como
  `InvalidName` y el evento no se pierde.
- Normalización de ruta: `/day/2026-08-23` → `/day/:date`; ruta desconocida →
  `unknown`.
- Ignorados: los tres patrones de §6.4 no producen escritura; `ChunkLoadError`
  sí.
- Cap de sesión: el evento 11 no se envía; el duplicado no se envía.
- Fallo del endpoint: la app sigue funcionando y no reintenta.
- Degradación: con `ai_usage_daily` ausente, el dashboard responde 200 con esa
  tarjeta vacía.
- Costo: la suma excluye nulls y reporta cobertura en filas y tokens.
- Boundary: en `PROD` no se renderiza `error.message`.
- Retención: `client_error_events` entra en el mapa de tablas del cron y su
  cutoff es 30 días.

## 14. Límites conocidos

- **El dashboard ubica errores, no los explica** (D1). Reproducir uno exige ir
  al código o preguntarle al beta tester.
- **`unknown` será alto en los primeros releases** y esa es la expectativa, no
  una falla: es la métrica que guía la mejora del clasificador (§6.2). Lo que
  sería un problema es que no baje.
- **Ninguna métrica es "usuarios activos"** (D2). Una cuenta que usa la app sin
  tocar la IA no aparece.
- **No hay límite de frecuencia durable** para el reporter (D3).
- **Los errores previos a la autenticación no se ven** (D4): landing, registro y
  login quedan fuera.
- **No hay alertas.** El dashboard hay que mirarlo. Para 10–20 usuarios es
  suficiente; automatizar avisos es trabajo posterior con datos que justifiquen
  el umbral.
- **El dashboard no observa sync.** Su diagnóstico es local y el track
  multi-dispositivo sigue siendo un proyecto separado (roadmap §Que Hacer
  Primero, punto 6).
- Los agregados no reemplazan la factura del proveedor.

## 15. Fuera de alcance

- Sentry o cualquier proveedor externo.
- Alertas por email/Slack.
- Funnel de producto (roadmap punto 12), aunque `/ops` sea el lugar natural
  donde vivirá después.
- Subida de sourcemaps.
- Guardar prompts, respuestas, mensajes, stacks o datos biométricos.
- Monitoreo remoto de la cola de sync.

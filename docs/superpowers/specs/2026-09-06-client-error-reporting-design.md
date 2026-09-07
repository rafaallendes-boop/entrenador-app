# Reporter de errores de cliente — definición de Entrega B

Fecha: 2026-09-06
Estado: decisiones de producto confirmadas; seis hallazgos de revisión resueltos en la definición. Lista para B1.
Roadmap: §17. Implementación y rollout pendientes.

## 1. Objetivo y precedencia

Detectar errores nuevos del cliente, ubicar el área y release afectados y priorizar
su investigación desde `/ops`, sin abrir SQL ni recopilar mensajes de usuario.
El panel debe permitir ese primer diagnóstico en menos de cinco minutos.

Este documento actualiza **sólo la Entrega B** del
[diseño del 23 de agosto](2026-08-23-operations-dashboard-and-client-errors-design.md).
Prevalece sobre sus restricciones de identidad, stacks y ausencia de observación
de sync. La Entrega A conserva su contrato y autorización actuales.

## 2. Decisiones confirmadas por el usuario

| Tema | Definición |
|---|---|
| Identidad | `user_id` de la sesión validada por el servidor; revierte D3 |
| Atleta | Sólo `scope_kind: self \| managed`; sin `athlete_id` |
| Error | Frames normalizados del stack, sin mensaje; modifica D1 |
| Severidad | Función pura compartida, derivada al leer; no se persiste |
| Escritura | Sólo endpoint autenticado con `service_role`; cliente sin INSERT |
| Lectura propia | SELECT bajo RLS `auth.uid() = user_id`; sin pantalla nueva |
| Retención | 30 días mediante el cron existente |
| Triage | Agregación de `unknown` incluida en v1 |
| Sourcemaps | Archivo privado por release, fuera del sitio publicado |

Las primeras cuatro decisiones vienen del intercambio adjunto. Las últimas cinco
fueron confirmadas en esta conversación como paquete de cierre de v1.
Las especificaciones siguientes concretan esas decisiones; no implican que ya
existan código, migración aplicada, archivo privado o aprobación jurídica.

## 3. Base verificada en el repositorio

- `034` es la última migración numerada. Usar `035_client_error_events.sql`,
  comprobando nuevamente disponibilidad al implementarla; `023` ya está ocupada.
- `AppRouteBoundary` y `RouteBoundary` existen en `src/App.tsx` y cubren Coach,
  Chat, Plan Builder y `/ops`. Se instrumentan; no se duplican.
- `syncLog` recibe los tres eventos `upsertRow:non_retriable`,
  `deleteRow:non_retriable` y `runFullSync:non_retriable`.
- La ruta real de Plan Builder V2 es `/plans/builder`, según
  `src/constants/routes.ts`; `/plan-builder-v2` no es una ruta vigente.
- `AIErrorCode` contiene 13 valores, incluido `coach_access_required`.
- No existe todavía el reporter ni `__APP_RELEASE__`. Vite no genera sourcemaps
  en la configuración actual. El build publica `dist`.

## 4. Contrato de datos y acceso

Tabla `client_error_events`:

| Campo | Contrato |
|---|---|
| `id` | bigint identity, PK |
| `user_id` | UUID NOT NULL, FK a auth.users con ON DELETE CASCADE |
| `scope_kind` | `self` o `managed` |
| `source` | `window_error`, `unhandled_rejection`, `react_boundary`, `sync_failure` |
| `diagnostic_code` | Uno de los nueve códigos de §6 |
| `fingerprint` | 16 hex, calculados por servidor |
| `error_name` | Nombre de allowlist; forma inválida → `InvalidName`; forma válida no listada → `UnlistedName` |
| `stack_frames` | Texto canónico opcional, máximo 10 frames y 2.000 caracteres |
| `component` | Etiqueta de integración de allowlist o null; nunca componentStack crudo |
| `route` | Patrón reconocido por ROUTES; sin query/hash; fallback `unknown` |
| `request_class` | Valor de AIRequestClass o null; sólo si lo conoce el emisor |
| `release` | Identificador de build validado, máximo 64 caracteres; `dev` en desarrollo |
| `platform` | `web` o `ios` |
| `created_at` | Timestamp UTC asignado por servidor |

Índices: `(user_id, created_at desc)`, `(fingerprint, created_at desc)` y
`(created_at desc)`. RLS activada; authenticated tiene SELECT propio; anon no
tiene acceso y authenticated no tiene INSERT, UPDATE ni DELETE. Las RPC de
escritura y agregación sólo conceden EXECUTE a service_role, con search_path
fijo y revocación explícita de PUBLIC, anon y authenticated.

`scope_kind` describe el contexto del evento, no concede permisos. En sync debe
salir de la operación que falló, no del atleta visible al terminar una tarea
asíncrona. Si no se conoce el scope de la operación, no inventarlo: omitir el
evento y cubrir esa limitación en pruebas. Nunca transmitir `details` de syncLog.

Para window_error, unhandled_rejection y react_boundary tomar una instantánea
de getActiveAthleteId() y getSelfAthleteId() al capturar, antes de cualquier await:
ambos resueltos y diferentes → managed; iguales o alguno sin resolver → self.
Este self de arranque significa contexto de cuenta por defecto, no demuestra que
la operación haya afectado un atleta self. Es sólo una convención de telemetría:
no modifica RLS ni habilita lectura/adopción de filas legacy. El código actual de
isSelfScopeActive también considera el rol y falla cerrado para coach/unknown;
no se reemplaza por esta comparación. Un evento sin sesión sigue descartándose,
pero uno autenticado no se pierde sólo por falta de hidratación del atleta.
Los ids se usan localmente para resolver scope_kind y nunca se adjuntan al evento.

## 5. Qué significa guardar frames sin mensajes

Cortar la línea cero no garantiza privacidad: el mensaje puede tener varias
líneas, las URLs pueden contener query y `Error.stack` se puede sobrescribir.
Tampoco una regex de `error_name` demuestra que el nombre no sea un dato dinámico.

Por eso cliente y servidor reconstruyen frames desde una gramática cerrada,
con manifiestos entregados según §9 (sin consultar el archivo privado en ingesta):

- Aceptar formatos de ubicación de Chromium y Safari/Firefox, incluso stacks
  sin encabezado. No eliminar ciegamente el primer frame válido.
- Conservar sólo `asset-del-build.js:línea:columna`, con línea y columna enteras
  positivas y asset verificado contra el manifiesto del release.
- Descartar nombres de funciones, texto del encabezado y líneas desconocidas;
  excluir eval, data, blob, extensiones, paths locales y orígenes externos.
- Eliminar query/hash antes de validar la ubicación. No guardar URLs completas.
- Admitir únicamente assets presentes en manifiestos de releases conocidos;
  incluir releases anteriores todavía soportados, no sólo el release de la función.
  Release sin manifiesto disponible conserva las categorías, con frames null.
- Si ningún frame es válido, guardar null y conservar el evento categórico.

El endpoint nunca recibe deliberadamente el error crudo. No se serializan message,
cause, componentStack ni objetos de Dexie/Supabase. En cliente y servidor aplicar
primero `^[A-Za-z][A-Za-z0-9_]{0,63}$` a error_name: si falla, `InvalidName`;
si pasa y pertenece a la allowlist, conservarlo; si pasa pero no está listado,
`UnlistedName`. Ambos fallbacks son valores canónicos reservados y la normalización
es idempotente. No transportar el nombre original junto a UnlistedName.
El regex limita la forma, pero también acepta nombres personales e identificadores
alfanuméricos; no demuestra por sí solo ausencia de contenido personal.
UnlistedName indica forma admisible no reconocida, no prueba una subclase legítima;
InvalidName tampoco prueba intención de forjar. Estas medidas minimizan contenido incidental;
la fila **sí contiene datos asociados a una cuenta**, no se describe como anónima.

Contrato puro de B1:

```ts
normalizeStackFrames(
  stack: unknown,
  knownAssets: ReadonlySet<string> | null,
  allowedOrigins: ReadonlySet<string>,
): string | null
```

knownAssets corresponde al release del evento, no al release actual del servidor.
null significa manifiesto no disponible y devuelve null; un set vacío no admite
ningún asset. La decisión de §9 conserva esa validación en v1. allowedOrigins se
inyecta desde la configuración confiable de web/nativo, nunca desde el payload.
La función no importa manifiestos ni consulta window, red, entorno o estado global.
El adaptador extrae las ubicaciones del stack y el servidor revalida las líneas
canónicas con la misma política de assets; ambos caminos usan funciones puras.

## 6. Clasificación y severidad

Códigos cerrados y append-only: `chunk_load`, `network_failure`, `timeout`,
`render_failure`, `storage_failure`, `data_parse_failure`, `third_party_failure`,
`unknown`, `sync_contract_failure`.

Conservar orden y mapeos de §6.1 del diseño original para las fuentes de navegador.
Cubrir exhaustivamente la unión AIErrorCode actual. Ignorar también
`coach_access_required`, junto con `entitlement_required`, `quota_exceeded`,
`spend_cap_exceeded`, `kill_switch_active` y `rate_limit`: son estados con UI propia.
Mantener ignorados ResizeObserver loop, Script error sin filename y abortos
deliberados de red. Un AbortError desconocido no demuestra cancelación deliberada.
AbortError de Dexie sigue siendo storage_failure; un import fallido dentro del
boundary sigue siendo chunk_load.

El descarte de `Script error.` es por **no atribuible**, no por «no ser una
extensión»: se ignora únicamente cuando no hay `filename`. Con `filename` de
extensión es `third_party_failure`; con `filename` propio se conserva y se
clasifica por las reglas siguientes. Descartarlo por tener archivo propio
perdería errores ubicables.

`ROUTES.HOME` **no** es una ruta pública a efectos de severidad. Dentro de
`AuthGate` esa ruta renderiza el Dashboard y v1 sólo captura autenticados (D4),
así que tratarla como pública rebajaría a `baja` los errores de la pantalla
principal del producto.

**`vite:preloadError` no acredita fallo de descarga.** El helper de Vite termina
en `baseModule().catch(handlePreloadError)`, de modo que el mismo evento se
dispara cuando el módulo se descargó bien y lanzó al evaluarse. Convertir ese
evento en `chunk_load` etiquetaría un bug de inicialización como problema de
bundle, y contaminaría justo la métrica que se mira después de un deploy. Por
eso el clasificador separa dos entradas:

- `chunkLoadSignal` afirma que **la descarga del asset falló** y sí resuelve
  `chunk_load` en la regla 1.
- `moduleLoadEventFired` registra que el evento se disparó, es ambiguo por
  construcción y **no clasifica por sí solo**.

Ambos casos quedan congelados por pruebas: con el evento disparado y sin
descarga confirmada, un `TypeError` es `unknown` fuera del boundary y
`render_failure` dentro.

**Pendiente de B3, declarado:** quién puede afirmar `chunkLoadSignal`. El evento
no alcanza y el discriminador candidato es la entrada de
`performance.getEntriesByType('resource')` del asset. Mientras no se resuelva,
B3 emite sólo `moduleLoadEventFired` y esos eventos se leen como `unknown`; es
una subcuenta explícita de `unknown`, no una categoría perdida.

El clasificador **nunca lanza**. `error.name` puede ser un getter que lanza y el
valor de rechazo puede ser un `Proxy` con traps hostiles, así que tanto la
lectura del nombre como el `instanceof` van protegidos: un fallo de lectura
resuelve `unknown`. Y la rama de sync se resuelve **antes** de tocar el error
crudo, porque ya tiene su respuesta en la categoría tipada. Si el clasificador
propagara, se perdería el evento y también el siguiente.

Sync usa categoría tipada: schema_mismatch → sync_contract_failure;
validation_error/duplicate_remote_profile → data_parse_failure;
network_error/auth_error/rls_error/supabase_not_configured → network_failure;
unknown_error → unknown. Sólo se emiten los tres eventos terminales indicados.
El contexto de sync es una entrada explícita del clasificador, no una heurística
sobre el mensaje. Los mapeos quedan congelados por casos de prueba.

Severidad, primera regla aplicable:

1. Alta: source sync_failure, storage_failure en cualquier ruta, o área Coach,
   Chat y Plan Builder (`/coach`, `/chat`, `/plan-builder`, `/plans/builder`,
   `/competition-plan`).
2. Baja: third_party_failure fuera de los casos anteriores, o unknown en rutas
   públicas reconocidas.
3. Media: resto, incluida ruta unknown. Una ruta desconocida no se presume pública.

Se recalcula con la misma función en servidor y panel, también para datos
históricos; cambiar la regla cambia su lectura histórica, sin reescribir filas.

## 7. Ingesta y reporter

`report-client-error.ts`: POST y OPTIONS, auth obligatoria; 401 sin sesión,
405 para métodos no admitidos, 400 para contrato inválido, 413 sobre 8 KiB.
Campos extra descartados; user_id, id, fingerprint y timestamp nunca se aceptan
como autoridad del payload. Normalizaciones previstas —InvalidName, UnlistedName, route unknown,
frames null— no son motivo de 400. Éxito y descarte por cupo devuelven 204.
Errores de infraestructura devuelven 5xx genérico, sin loguear payload o user_id.

Fingerprint: SHA-256 de una tupla JSON canónica
`[error_name, diagnostic_code, component, route, primer_frame]`, truncado a 16 hex.
La centralización fija una sola implementación; **no garantiza agrupar entre
releases**, porque cambian assets y posiciones. Siempre mostrar release al leer.

Límite durable: 30 eventos por cuenta en ventana móvil de una hora. Una RPC
serializa por cuenta con bloqueo transaccional, cuenta e inserta en la misma
transacción. Un count seguido de INSERT desde Netlify tiene carrera y no cumple
el techo. El Map en memoria es sólo un prefiltro best-effort, nunca la autoridad.
Si el control durable falla, no insertar por una vía alternativa.

`src/services/observability/` contiene reporter, contrato, clasificador, severidad
y normalización de frames/rutas. Instalación idempotente con limpieza de listeners.
Flag `VITE_CLIENT_ERROR_REPORTING_ENABLED` false por defecto. Sin sesión, descartar
sin cola ni almacenamiento local; no enviar eventos antiguos al iniciar sesión.

Máximo 10 intentos de envío por sesión de pestaña y dedupe por firma canónica
local, reservados antes del await. Fetch best-effort con keepalive y timeout de
3 segundos; nunca lanza al consumidor, nunca reenvía el evento ni captura sus
propios fallos. Primer fallo de transporte/5xx: pausa 30 segundos para eventos
nuevos; segundo fallo consecutivo: cerrar canal durante esa sesión. Éxito reinicia
el contador de fallos. 4xx descarta sin retry. Logout limpia datos transitorios y
evita atribuir un evento previo a otra cuenta; no reinicia el cap de la pestaña.

Boundary: enviar desde componentDidCatch con etiqueta estática y mantener mensaje
amigable en PROD. Sync: propagar sólo categoría, scope y etiqueta de origen al
hook; comprobar que una misma falla no se duplique al recorrer capas superiores.
Un fallo sintético elegible debe producir exactamente una fila; en general la
entrega es best-effort y deduplicada, **no existe garantía de una fila por fallo**.

## 8. Panel y operación

Agregar RPC `read_client_error_metrics`, sin modificar read_operations_metrics.
La función operations-dashboard conserva auth y allowlist antes de toda consulta.
Ventanas 24 h y 7 días. Agregar contrato independiente para la tarjeta de errores:
`ready`, `not_installed` y `unavailable`; ready con total cero significa sin eventos.
Sólo una ausencia reconocida de RPC/tabla produce not_installed; timeout o permisos
no se disfrazan de cero. El resto de `/ops` sigue disponible si este bloque falla.

Top 10 por severidad descendente, volumen descendente y última aparición; agrupar
por fingerprint, release y dimensiones necesarias para derivar severidad. Ordenar
antes de recortar el top, para no excluir errores graves de poco volumen. Mostrar
primera/última aparición y cantidad de cuentas afectadas, sin email ni user_id.
Triage unknown: volumen y proporción global, desglosados por source/error_name/
ruta/release. Su lectura semanal guía mejoras del clasificador.
Conservar separados InvalidName y UnlistedName en el desglose de error_name.

V1 conserva el panel agregado. Persistir user_id permite límites y lectura propia,
pero **no agrega una ficha para identificar o contactar al afectado en `/ops`**.
Una vista administrativa individual sería alcance posterior explícito.

Política inicial: revisión manual diaria durante el piloto y tras cada deploy;
alta se investiga ese día, media en la revisión semanal y baja si es recurrente.
Sin alertas automáticas ni envíos a Slack/email en v1.

## 9. Releases, sourcemaps y retención

Definir __APP_RELEASE__ desde COMMIT_REF; fallback dev sólo en desarrollo.
Los builds de distribución deben tener un identificador trazable. No dar por
hecho que un build nativo recibe COMMIT_REF: permitir un identificador explícito.

### 9.1 Entrega de manifiestos para v1

Decisión técnica tras la revisión: mantener la pertenencia al manifiesto como
validación. Una gramática de basename puede aceptar `MariaPerez.js` o un UUID;
la autenticación no convierte ese contenido en una ubicación de código conocida.
La validación cubre releases anteriores mediante un catálogo acumulado; no se
agrega una excepción de sólo regex para ellos.

- Mantener manifiestos históricos revisados en
  `observability/release-manifests/<release>.json` dentro del repositorio. Son
  metadatos de assets publicados: versión de formato, release y lista de basenames
  JS, sin rutas locales, fuentes, mapas, credenciales ni datos de usuarios.
- Tras generar los assets, un paso de build produce el manifiesto actual y une
  los históricos en un catálogo generado. Rechaza releases duplicados con distinto
  inventario y basenames ambiguos dentro del mismo release. Ejecutar este paso
  antes de empaquetar las Functions.
- La función importa estáticamente el catálogo generado como parte de su bundle;
  en tiempo de request valida en memoria. No usa red, almacenamiento privado ni
  credenciales adicionales para obtener manifiestos.
- El mismo paso publica copias de los manifiestos en
  `/observability/releases/<release>.json`, también para versiones anteriores.
  El cliente carga una vez el de su propio __APP_RELEASE__, con validación de
  contrato y timeout de 3 segundos. No se demora el arranque de la app: hasta
  disponer del manifiesto envía sólo categorías, sin encolar ni reenviar eventos.
  Un fallo de esa carga no se reporta recursivamente. El servidor vuelve a validar
  cada frame, sin confiar en el manifiesto ni en la validación del cliente.
- Esa ruta depende de que el catch-all de `netlify.toml` (`/*` → `/spa-fallback.html`,
  200) siga **sin** `force = true`: es la única regla del archivo que no lo lleva, y
  por eso un archivo estático real gana sobre el redirect. Si alguien le agrega
  `force`, o el paso de build no emite el `.json` dentro de `dist/`, la carga recibe
  **HTML con status 200**, no un 404. Por eso la validación de contrato del cliente
  comprueba `content-type` de JSON además del status, y B3/B5 lo verifican
  explícitamente. El resultado de esa degradación es el estado interino conocido:
  categorías sin frames.
- El manifiesto del build efectivamente distribuido se conserva como artefacto y
  se incorpora al directorio histórico antes de distribuir su sucesor. Es requisito
  del rollout, no una escritura automática a git. El preflight de deploy compara
  el inventario de releases soportados con el catálogo y falla si falta alguno.
  El inventario incluye builds nativos distribuidos y candidatos de rollback.
- V1 no poda automáticamente el catálogo. Retirar un release exige declararlo
  fuera de soporte; sus eventos siguen siendo categóricos. Los bundles anteriores
  a la introducción del reporter no emiten esta telemetría.

Así, una pestaña del release A conserva frames válidos tras desplegar B si A está
soportado. Un chunk ausente aún puede identificarse en un frame si figura en el
manifiesto de A; no se fabrica un frame a partir del mensaje del error.

B1 recibe el manifiesto como entrada explícita de sus funciones puras y usa
fixtures. B2 incluye generación y empaquetado del catálogo; B3 incluye la carga
del manifiesto propio. No se aceptan esos bloques con una dependencia de entrega
sin implementar. El archivo privado de sourcemaps se completa en B4: sin él los
frames validados ubican el bundle, pero todavía no permiten resolver el código
fuente. Sin manifiesto disponible, el estado interino es categorías sin frames;
no equivale a haber completado la captura de frames de v1.

### 9.2 Archivo privado y retención

Generar sourcemaps, archivar mapas, bundles exactos y manifiesto por release en
almacenamiento privado y excluir los .map de dist publicado. Sourcemaps hidden
por sí solos no hacen privados los archivos. Verificar que la URL pública del
mapa no entrega su contenido. Resolver un frame de prueba con el archivo privado.

Pendiente operativo para B4: elegir destino privado, credenciales y
mecanismo de archivo de bundles y mapas. Esto no condiciona la lectura de
manifiestos en B2/B3. El repositorio no los define hoy; no se declara gratuito
ni resuelto. Retener artefactos mientras el release siga distribuido y al menos
30 días tras retirarlo, para cubrir eventos tardíos de clientes antiguos.

Agregar client_error_events al cron existente de las 04:00 UTC, con cutoff propio
de 30 días, sin cambiar los 90 días de IA. Documentar que la limpieza diaria puede
eliminar filas hasta aproximadamente 24 h después del cutoff si el cron funciona;
un fallo exige recuperación. RLS y agregados excluyen filas de más de 30 días.
Backups y su expiración se verifican por separado; no prometer borrado físico
exacto a los 30 días sólo por agregar un cron.

El cron reporta al terminar `expired_remaining`, `checked_at` y un estado de
éxito/error, sin filas ni identidades; un fallo no se informa como cero. Además,
read_client_error_metrics consulta directamente, con service_role y sin el filtro
de edad de los agregados, el conteo de filas físicas anteriores al cutoff y el
timestamp de la más antigua. `/ops` muestra ese bloque de salud de retención aun
si no hay eventos recientes; no depende de que el cron haya emitido un reporte.
Si falla la consulta, el estado es unavailable, no saludable. Marcar atraso cuando
existan filas de más de 31 días (ventana de 30 días más cadencia diaria de limpieza).
El conteo detecta acumulación aunque el cron no arranque; no demuestra que el cron
esté vivo cuando no hay filas que borrar. No presentarlo como heartbeat ni como
certificación del borrado de backups.

## 10. Consulta jurídica y activación

Pregunta para incorporar al paquete legal existente, aún sin enviar:

> Queremos registrar errores técnicos asociados al identificador de la cuenta
> autenticada, con contexto self/managed, categorías, ruta normalizada, release,
> plataforma y ubicaciones de código verificadas contra el build, sin mensajes,
> identificadores de atleta ni contenido deportivo o biométrico. La cuenta puede
> leer sus eventos; el panel de operación muestra agregados. La ventana de consulta
> es de 30 días y hay limpieza diaria, además de la política de backups por validar.
> ¿La publicación de privacidad vigente cubre este tratamiento y sus accesos?
> ¿Requiere nueva publicación, reaceptación o ajustes de retención/borrado?

No se afirma cobertura legal ni se modifica una publicación vigente en esta
definición. Resolver la consulta antes de capturar datos reales. Si requiere
publicación/reaceptación, completar ese flujo antes de activar el reporter.

## 11. Secuencia de implementación y aceptación

| Bloque | Resultado revisable | Validación necesaria |
|---|---|---|
| B1 — contrato | Tipos, normalizadores, clasificador y severidad puros | Casos adversariales de stack; knownAssets null/vacío/actual/anterior; Chromium/Safari; InvalidName vs UnlistedName e idempotencia; scope de navegador sin hidratar y snapshot antes de await; todos los códigos y precedencias; rutas reales; severidad exhaustiva |
| B2 — servidor | Migración 035, RLS, RPC atómica, catálogo de releases empaquetado e ingesta | Frames del release actual y anterior admitidos; asset no listado descartado; ningún fetch de manifiestos en request; JWT de A no forja B; A no lee B; cliente no escribe; 31 peticiones concurrentes insertan como máximo 30; límites y errores de contrato |
| B3 — captura | Reporter, carga de manifiesto, boundary y sync, flag apagada | Pestaña de A tras deploy B conserva frames; ausencia/timeout de manifiesto conserva categorías; dedupe concurrente, cap, timeouts, circuit breaker, cambio de cuenta/scope y falla terminal sintética sin duplicado |
| B4 — operación | Tarjetas /ops, triage, retención y archivo de builds | Segunda cuenta recibe 403; cero vs ausencia vs fallo; orden antes de top-N; cutoff; filas vencidas invisibles a RLS pero visibles en salud de retención aun sin ejecutar cron; frame resuelto y mapas privados |
| B5 — rollout | Smoke y registro de activación | Migración aplicada; servidor antes que cliente; revisión legal; captura sintética controlada; evento visible en /ops |

Mantener pruebas de no fuga en payload y fila con mensajes multilínea, email,
UUID, query con token, stack falsificado y nombre dinámico. El único UUID esperado
en la fila es el user_id autenticado. Probar taxonomía idéntica entre TypeScript,
validación de endpoint y CHECK SQL. Verificar que un fallo de telemetría no cambia
el resultado ni la experiencia de la operación principal.

Cada bloque se verifica localmente; antes de integrar ejecutar lint, tests y build
según la guía del repositorio. Para B2 se adopta el precedente de supabase/queries,
sin asumir que ya exista un harness de PostgreSQL:

- Crear `supabase/queries/2026-09-06-035-rls-checks.sql` con casos nombrados,
  precondiciones, resultados esperados y rollback de fixtures. Verificar grants y
  policies efectivos como authenticated A/B y anon, mediante roles y claims de
  prueba: A no lee B, A lee lo propio vigente, no lee lo vencido, cliente sin
  INSERT/UPDATE/DELETE ni EXECUTE de las RPC privilegiadas. Una consulta realizada
  solamente como administrador no demuestra RLS.
- Crear un runbook de smoke 035 con una prueba HTTP autenticada: JWT real de A
  y payload que intenta atribuir user_id B; inspección privilegiada verifica que
  la fila queda en A. Ese caso pertenece al endpoint, no se demuestra sólo con SQL.
- B2 agrega un pequeño runner manual de concurrencia con `psql` como requisito
  explícito, sin agregar una biblioteca de base de datos a la app. Lanza 31
  conexiones/transacciones independientes hacia la RPC de ingesta, con una
  barrera común de inicio, la misma cuenta sintética sin eventos previos en la
  hora y fixtures válidos. Verificar 30 aceptaciones y un descarte por cupo, sin
  fallos de infraestructura, y exactamente 30 filas; así no pasa por insertar cero.
  También verificar el vencimiento de la ventana y la independencia entre cuentas.
  Un SQL secuencial o 31 peticiones al reporter con cap 10 no prueba la carrera.
- Ejecutar manualmente sobre un proyecto Supabase de pruebas con 035 aplicada.
  Registrar entorno, revisión, resultados, errores y limpieza de fixtures en el
  smoke. Credenciales sólo mediante configuración local, sin volcarlas al reporte.
  La elección/provisión de ese proyecto es un prerrequisito operativo de B2,
  no se afirma que exista hoy. No usar cuentas ni filas reales del piloto.

Los scripts escritos y los mocks no equivalen a estas pruebas ejecutadas. Si falta
el entorno, B2 queda pendiente de validación real, con el motivo registrado.
Ninguna de estas comprobaciones requiere consumo de API de IA.

Rollout: aplicar migración → desplegar servidor y cliente con flag apagada →
smoke sintético en entorno controlado → completar requisitos legales/operativos →
activar por build → comprobar captura y agregación. La flag VITE se resuelve en
build: desactivarla exige rebuild/deploy y no apaga pestañas antiguas. Incluir
también un interruptor server-only CLIENT_ERROR_INGESTION_ENABLED (false por
defecto; apagado responde 204 sin persistir) para cortar ingesta de esos clientes.

Revisión 2026-09-06: seis hallazgos incorporados — entrega de manifiestos con
históricos, fallbacks de nombre distintos, scope de navegador explícito,
normalizador con inputs inyectados, validación manual real de B2 y visibilidad
de retención independiente del cron. El siguiente trabajo es B1. La entrega
estará terminada cuando B1–B5 tengan evidencia; este documento no la acredita.

# Integración Whoop — Diseño (athlete_id first)

**Fecha:** 2026-06-21
**Autor:** Rafael Allendes (con asistencia técnica)
**Estado:** Aprobado, **ACTUALIZADO 2026-07-06** (prioridad de producto antes de SP1)

> ⚠️ **Coordinación Dexie (actualizada 2026-07-05):** Athlete Scope Foundation ya tomó
> Dexie **v13** y F2 day/week tomó **v14**. Whoop debe implementarse como **v15**.
> No usar `version(13)`/`version(14)` para `readinessDaily`.

## Decisiones tomadas

1. **Modelo de datos:** `athlete_id` first-class desde v1. La conexión OAuth pertenece a
   la cuenta (`user_id`), pero los datos fisiológicos se escriben contra el atleta self
   de esa cuenta (`athlete_id = ath_<user_id>` o el self resuelto desde `athletes`).
2. **Whoop vs check-in manual:** prefill editable. Whoop precarga el `dayLog` del día;
   el usuario puede sobreescribir. `painLevel`/notas siguen siendo siempre manuales.
3. **Ingesta:** poll diario (Netlify scheduled function, cron **UTC** + sync idempotente
   de últimos 7 días, ya que no hay fuente de timezone del atleta) + botón "Sincronizar
   ahora" con throttle. Sin webhooks en v1.
4. **Coach:** contexto pasivo. El readiness entra al prompt del coach y a alertas
   livianas, pero NO modifica el plan automáticamente.
5. **Prioridad de producto:** Whoop se adelanta como siguiente track porque el owner usa
   la app al 100% y necesita señal fisiológica real para validar el loop diario/semanal.
   No es un adorno ni una promesa de marketing: es input objetivo para operar mejor el
   propio entrenamiento y para que la futura oferta "Coach Semanal" tenga contexto real.

**Base estratégica:** `docs/rfc/2026-06-16-coach-mode-architecture.md` §9 (Wearables, F4).
Este spec adelanta Whoop para uso real personal sin crear deuda nueva: el acceso visible
queda por atleta, aunque las credenciales sigan viviendo por cuenta.

## API confirmada (2026-07-05, OpenAPI oficial `Api Whoop`)

WHOOP **API v2**. Base `https://api.prod.whoop.com/developer`. OAuth authorize
`https://api.prod.whoop.com/oauth/oauth2/auth`, token `.../oauth/oauth2/token`.
Scopes: `read:recovery`, `read:sleep`, `read:cycles`, `read:profile`. Colecciones
`GET /v2/recovery`, `GET /v2/activity/sleep`, `GET /v2/cycle` (params `limit,start,end,nextToken`;
envelope `{records,next_token}`). Recovery **no** trae `id` → dedupe por `cycle_id`.
Revocación: `DELETE /v2/user/access`. Los strings viven solo en el plan (Tasks 5-9).

## Coordinación con SP1 (Coach dos-lados, va DESPUÉS)

Orden de ejecución: **Whoop primero → SP1 después**. Puntos de acople y reservas:

- **Números reservados:** Whoop = migración `011` + Dexie `v15`; SP1 = `012+` / `v16+`.
- **Resolución de "self":** hoy Whoop resuelve el atleta self como `ath_<user_id>`
  (server: `resolveSelfAthleteId`; cliente: `getSelfAthleteId`). SP1 cambia "self" a la
  **membresía `role='self'`**. Sigue siendo correcto para la cuenta-coach (self = `ath_<uid>`);
  SP1 debe reescribir ese único seam. No inlinear `ath_<uid>` fuera de él.
- **RLS de `readiness_daily`/`biometric_readings`:** hoy por `owner_account_id`/`linked_account_id`;
  SP1 la barre al predicado por `athlete_memberships` (`auth_athlete_ids()`) junto con las demás.
- **Emergente sin trabajo extra:** post-SP1, si un atleta con login conecta su Whoop, el coach
  ve su readiness por membresía (ya scoped por `athlete_id`); el CTA de conectar sigue gateado
  al self. Compatible sin cambios de diseño.
- **Contrato con la futura landing/oferta coach:** la superficie pública puede hablar de
  "contexto objetivo de recuperación y sueño vía Whoop" solo como señal opcional y
  consentida del atleta. No prometer ajuste automático, diagnóstico, prevención de lesiones
  ni que el coach conecte el wearable por el atleta. El CTA de conexión vive en Settings
  del self; el coach solo visualiza readiness de atletas que ya dieron acceso.
- **SP2 dashboard coach:** cuando exista dashboard sin suplantación, `readiness_daily`
  debe leerse como métrica del atleta seleccionado/listado, no como estado de la cuenta
  del coach. Eso evita retrabajo entre `ReadinessCard` del atleta y tarjetas futuras del
  roster.

## Contexto del código (verificado)

- **Check-in diario hoy** = tabla Dexie `dayLogs` con llave natural por atleta en v14
  (`[athleteId+date]`) y tipo `DayLog` (`src/types/index.ts:342`): `sleepHours`,
  `sleepQuality` (1-5), `energyLevel` (1-10), `painLevel` (0-10), `painNotes`,
  `rpeActual`, `bodyWeight`, etc.
- **`recoveryProfile`** (`src/types/index.ts:461`) es solo texto libre
  (lesiones/restricciones), NO métricas diarias. No se toca.
- **El prompt del coach ya consume `dayLog`** (`src/services/ai/promptBuilder.ts:879`,
  agregación de `weekDayLogs` en `:1192-1200`). El prefill del `dayLog` fluye
  automáticamente al coach; el readiness solo agrega una línea de contexto.
- **Plataforma:** web PWA en Netlify. Whoop (OAuth + fetch server-side) es viable sin
  shell nativo (a diferencia de HealthKit).
- **Athlete scope activo:** `athletes` existe en Supabase/Dexie; legacy local usa
  `ATHLETE_PROFILE_LOCAL_ID = 'default'`, pero las nuevas tablas Whoop no deben usarlo.
- **Dexie schema actual:** v14 (`src/db/db.ts`). Esta integración agrega v15.
- **Netlify functions hoy:** `coach.ts`, `enqueue-plan-generation.ts`,
  `generate-plan-background.ts`. No hay scheduled functions todavía; se agrega la primera.
- **Patrón de sync:** `src/services/syncService.ts` + `supabase/*.sql` ya combinan
  `user_id` y `athlete_id`. Whoop usa functions server-side para escribir remoto y un
  pull cliente de `readiness_daily` filtrado por `athlete_id` activo.

## Prerequisito (Track 0) — Whoop Developer App + verificación de API

**Bloqueante.** No hay Whoop Developer App creada todavía. Antes de implementar OAuth:

1. **Verificar la documentación oficial vigente de Whoop antes de codear** (la API
   evoluciona): scopes exactos, endpoints, paginación, rate limits y comportamiento del
   refresh token. Registrar los hallazgos en el plan; los nombres de scope/endpoint de
   este spec son la intención de diseño, no un contrato — se confirman contra los docs.
2. Crear app en el [Whoop Developer Dashboard](https://developer.whoop.com/).
3. Configurar scopes (confirmar nombres vigentes): recovery, sleep, cycles, profile.
4. Registrar redirect URI del callback **separado dev y prod** (allowlist).
5. Obtener `client_id` y `client_secret`.
6. Generar clave de cifrado de tokens: **base64 de 32 bytes** (256-bit) para AES-256-GCM.
7. Configurar variables de entorno **server-side** en Netlify (nunca `VITE_*`):
   - `WHOOP_CLIENT_ID`
   - `WHOOP_CLIENT_SECRET`
   - `WHOOP_REDIRECT_URI` (puede ser uno por entorno; usar allowlist dev/prod)
   - `WHOOP_TOKEN_ENC_KEY` (base64, 32 bytes)
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (para upsert server-side; verificar si ya existen).
8. **Copy legal mínimo** redactado (consentimiento biométrico + texto de privacidad),
   ver sección Legal — es gate antes de exponer a usuarios reales.

El plan de implementación debe empezar con este Track 0, y los tasks de OAuth no se
cierran hasta que las env vars existan en un entorno de prueba.

## Arquitectura general

```
Whoop OAuth (cuenta) ──▶ tokens cifrados (server-side, whoop_connections)
                              │
                              ▼ resuelve atleta self
   ┌──────────────────────────┴───────────────────────┐
   ▼ (cron diario AM)                    ▼ (botón "Sincronizar ahora")
  netlify/functions/whoop-sync ──▶ fetch recovery/sleep/cycles (Whoop API v2)
                              │
                  normalize ──▶ biometric_readings (raw por métrica, athlete_id)
                              └──▶ readiness_daily (resumen por día, athlete_id)
                                          │
                  ┌───────────────────────┼────────────────────────┐
                  ▼                        ▼                         ▼
        prefill editable de        tarjeta resumen           contexto pasivo
        dayLogs (sleep/energy)     en Dashboard              en prompt coach + alertas
```

**Principio de aislamiento:** todo lo de Whoop (OAuth, fetch, normalización, tokens)
vive server-side en `netlify/functions/`. El cliente nunca ve tokens ni secretos.
El frontend solo lee `readiness_daily` del atleta activo (replicada a Dexie) y escribe el
prefill al `dayLog` del mismo `athlete_id`.

## Modelo de datos

### Supabase (nuevas tablas, RLS por `athlete_id`)

**`whoop_connections`** — credenciales de la cuenta conectada (server-only):
- `user_id` (uuid → auth.users, PK)
- `access_token` (text, cifrado AES-256-GCM, formato iv.tag.ciphertext)
- `refresh_token` (text, cifrado AES-256-GCM)
- `key_version` (smallint) — versión de `WHOOP_TOKEN_ENC_KEY` usada (rotación futura)
- `expires_at` (timestamptz)
- `whoop_user_id` (text)
- `scopes` (text)
- `connected_at` (timestamptz)
- `last_sync_at` (timestamptz, nullable)
- `last_manual_sync_at` (timestamptz, nullable) — para cooldown del sync manual
- `last_sync_status` (text, nullable: 'ok' | 'error')
- RLS: **deniega TODA operación al cliente** (sin políticas para `authenticated`/`anon`).
  Solo el service-role (functions) lee/escribe. El estado para la UI se expone vía el
  endpoint `whoop-status` (ver Backend), nunca por lectura directa de la tabla.

**`whoop_oauth_states`** — nonces OAuth efímeros (tabla separada, server-only):
- `state` (text, PK) — nonce crypto-random single-use
- `user_id` (uuid → auth.users) — binding al usuario que inició el flujo
- `expires_at` (timestamptz) — expiración corta (~10 min)
- `created_at` (timestamptz)
- RLS: **deniega TODA operación al cliente**. Solo el service-role escribe (en `start`) y
  lee+borra (en `callback`). Tabla separada de `whoop_connections` para no ensuciar el
  schema de credenciales cuando aún no hay tokens, y para limpiar nonces vencidos sin
  tocar conexiones. Los nonces vencidos se barren oportunísticamente o en el sync diario.

**`biometric_readings`** — lecturas crudas por métrica (**server-only estricto**):
- `id` (text, PK)
- `user_id` (uuid → auth.users) — cuenta dueña de la conexión Whoop, para borrado completo
- `athlete_id` (text → athletes.id) — atleta self al que pertenecen las métricas
- `source` (text, 'whoop')
- `metric` (text: 'recovery' | 'hrv' | 'rhr' | 'strain' | 'sleep_hours' | 'sleep_performance')
- `value` (numeric)
- `recorded_at` (timestamptz)
- `raw_id` (text, id del registro Whoop — dedupe idempotente)
- RLS: **deniega TODA operación al cliente** (sin políticas para `authenticated`/`anon`).
  Solo el service-role (functions) lee/escribe. **No se replica a Dexie.** El cliente
  nunca accede a la data biométrica cruda; solo ve el resumen `readiness_daily`. Esta
  tabla existe para auditoría/normalización/futuro, no para consumo de la UI.

**`readiness_daily`** — resumen por día (replicado a Dexie, lo que consume la UI):
- `user_id` (uuid → auth.users) — cuenta dueña de la conexión Whoop
- `athlete_id` (text → athletes.id)
- `date` (text 'YYYY-MM-DD')
- `recovery_score` (numeric, 0-100, nullable)
- `hrv_ms` (numeric, nullable)
- `rhr_bpm` (numeric, nullable)
- `strain` (numeric, nullable)
- `sleep_hours` (numeric, nullable)
- `sleep_performance` (numeric, 0-100, nullable)
- `source` (text, 'whoop')
- `updated_at` (bigint, epoch ms)
- PK: `[athlete_id+date+source]`
- RLS: **solo SELECT cliente** cuando `auth.uid()` tiene acceso al atleta vía
  `athletes.owner_account_id`/`linked_account_id` en la etapa actual. Cuando SP1 aterrice,
  este predicado debe migrar a `athlete_memberships`. Insert/update/delete remotos quedan
  solo para service-role; el cliente no escribe `readiness_daily` remoto.

### Dexie (migración v15)

- Agregar store `readinessDaily: 'id, date, athleteId, source, updatedAt, &[athleteId+date+source]'`
  (id sintético `whoop:<athleteId>:<date>`). Solo `readiness_daily` se replica local.
- La llave natural queda preparada para multi-atleta y una futura segunda fuente wearable.
- `biometric_readings`, `whoop_connections` y `whoop_oauth_states` son server-only — no
  entran a Dexie.
- Tipo nuevo `ReadinessDaily` en `src/types/index.ts`.
- Extender el tipo `DayLog` con metadata de procedencia del prefill (ver Prefill):
  `prefillSource?` indicando qué campos provienen de Whoop. Campo aditivo, no breaking
  (Dexie/Supabase aceptan el nuevo campo sin migración de datos).
- Cualquier cambio de schema Dexie requiere migración (regla del proyecto): la v15 agrega
  el store sin tocar los existentes.

## Backend — OAuth + ingesta

Archivos nuevos en `netlify/functions/`:

- `whoop-oauth-start.ts` — el cliente lo invoca **vía `fetch` con el header
  `Authorization: Bearer <supabase access_token>`** (mismo patrón que `coach.ts` /
  `enqueue-plan-generation.ts`: validar con `auth.getUser(token)`). La function NO es un
  redirect directo del navegador: valida el usuario, genera el `state` bindeado a su
  `user_id`, y **devuelve la URL de autorización de Whoop**; el cliente hace
  `window.location = url`. Así el `start` tiene identidad confiable sin depender de cookies.
- `whoop-oauth-callback.ts` — es el redirect de Whoop (`?code&state`), llega **sin bearer
  token**. Por eso la identidad del usuario se recupera **exclusivamente del `state`**:
  busca la fila en `whoop_oauth_states`, valida que exista, no esté expirada y la borra
  (single-use); de ahí obtiene el `user_id`. Luego intercambia `code` → tokens, cifra y
  hace upsert en `whoop_connections` para ese `user_id`. Los datos se escribirán más tarde
  contra el atleta self resuelto en sync. Redirige a Settings con estado (éxito/error) en
  query param de una ruta de la allowlist.
- `whoop-status.ts` — el cliente lo invoca con `Bearer` (valida `getUser`); devuelve el
  estado de conexión (ver "Estado de conexión"). NO devuelve tokens.
- `_shared/whoopClient.ts` — wrapper de Whoop API: `getRecovery`, `getSleep`,
  `getCycles`, con refresh automático de access token cuando expira. **Puro/testeable**
  (fetch inyectable). Endpoints/paginación confirmados contra docs en Track 0.
- `_shared/whoopNormalize.ts` — **lógica pura**: mapea respuestas Whoop →
  `biometric_readings[]` + `readiness_daily` sin decidir `user_id`/`athlete_id`; el sync
  inyecta esas claves. Maneja días sin dato (campos nullable).
- `_shared/tokenCrypto.ts` — encrypt/decrypt **AES-256-GCM** con `WHOOP_TOKEN_ENC_KEY`.
  Testeable. Detalles abajo.
- `whoop-sync.ts` — handler invocable por:
  - **cron diario** (vía `schedule` en `netlify.toml`, en **UTC**, madrugada);
  - **manual** (POST desde el botón "Sincronizar ahora", con throttle).
  Recorre los últimos **7 días** (idempotente), resuelve el atleta self de la cuenta,
  normaliza, upsert por `raw_id` / `[athlete_id+date+source]`, actualiza `last_sync_at`.
  Degrada con gracia si no hay conexión Whoop o si falta atleta self local/remoto.

### OAuth state (anti-CSRF + binding)

- `state` = nonce aleatorio (crypto-random) con **expiración corta** (~10 min).
- **Binding al usuario autenticado**: en `whoop-oauth-start` (que sí tiene bearer válido),
  se inserta una fila en **`whoop_oauth_states`** `{ state, user_id, expires_at }`. El
  `callback` (que no tiene bearer) recupera el `user_id` desde esa fila — es el único
  vínculo entre el redirect de Whoop y el usuario. Validación en callback: existe + no
  expirado + se borra al usarse (single-use). Si falta/expiró/duplicado → rechaza y
  redirige a Settings con error.
- **Redirect allowlist**: solo redirect URIs registradas (dev y prod separadas). El
  callback nunca redirige a un destino derivado de input no confiable.
- Manejo separado dev/prod por env var (`WHOOP_REDIRECT_URI`).

### Cifrado de tokens (`tokenCrypto.ts`)

- Algoritmo: **AES-256-GCM**. Clave: `WHOOP_TOKEN_ENC_KEY` (base64, 32 bytes).
- **IV único por token** (12 bytes random) y **auth tag** por token, almacenados junto
  al ciphertext (formato `base64(iv).base64(tag).base64(ciphertext)` o JSON equivalente).
- Campo **`key_version`** (smallint) en `whoop_connections` para permitir rotación de
  clave futura sin migración destructiva (decrypt elige la clave por versión).
- Round-trip cubierto por tests; nunca loggear tokens ni claves.

### Sync programado y zona horaria

- No existe fuente de timezone del atleta en el modelo actual. Por eso el cron corre en
  **UTC** (madrugada) y el sync de **últimos 7 días idempotente** garantiza que cada día
  se complete aunque la hora local no coincida. No se promete "mañana hora local" en v1.

### Throttle del sync manual

- **Cooldown server-side** (p.ej. mínimo 5 min entre syncs manuales por usuario),
  evaluado en `whoop-sync.ts` contra `last_sync_at` / un `last_manual_sync_at`.
- Si está en cooldown o Whoop devuelve rate-limit: respuesta con error **amable** y
  `retry_after`; la UI muestra estado ("Sincronizado hace X", "Espera N s", "Whoop limitó,
  reintenta luego") sin lenguaje técnico.
- Reusar la filosofía del rate limit del Plan Builder (`src/services/planBuilder/rateLimit.ts`):
  estado visible, degradación amable, nunca romper el flujo.

Seguridad: tokens siempre cifrados en reposo; refresh server-side; ninguna credencial
en `VITE_*`. Respetar rate limits / cuotas de Whoop.

### Estado de conexión para la UI (`whoop-status`)

Como `whoop_connections` no es legible por el cliente (RLS deniega SELECT), el frontend
obtiene el estado vía el endpoint `whoop-status.ts`, que devuelve un objeto seguro:
`{ connected: boolean, lastSyncAt: string|null, lastSyncStatus: 'ok'|'error'|null, scopes: string[] }`.
Nunca expone tokens. Este estado es **de la cuenta autenticada**, no del atleta abierto.
La `ReadinessCard` solo muestra CTA de conectar cuando el atleta activo es el self; si el
coach mira otro atleta, puede mostrar readiness existente o un estado "sin datos", pero no
debe invitar al coach a conectar Whoop por ese atleta.

## Frontend — tarjeta resumen + prefill

- `src/components/readiness/ReadinessCard.tsx` — tarjeta estilo del mockup aprobado
  (estética oscura, números grandes con acento de color). Muestra del día:
  - **Recovery %** con banda de color (rojo <34, amarillo 34-66, verde ≥67),
  - **Sleep** (horas + performance %),
  - **Strain**.
  Estados: conectado-con-dato / conectado-sin-dato-hoy / desconectado (CTA a conectar).
  Se ubica en el Dashboard.
- `src/components/settings/WhoopConnection.tsx` — sección en Settings:
  conectar (→ `whoop-oauth-start`) / desconectar (borra `whoop_connections` + datos
  Whoop) / botón "Sincronizar ahora" (→ `whoop-sync`) / muestra `last_sync_at`.
  Esta sección solo se muestra/activa para el atleta self. En contexto coach/gestionado,
  la UI puede mostrar el estado de readiness existente, pero no ofrece conectar.
- **Prefill editable** en `DayDetail` / check-in:
  - `src/services/readiness/prefillDayLog.ts` — **reducer puro e idempotente**: dado
    `readiness_daily` del día y el `dayLog` existente, devuelve valores sugeridos SOLO
    para campos sin valor manual:
    - `sleepHours` ← `sleep_hours`
    - `sleepQuality` (1-5) ← `sleep_performance` (0-100, escalado)
    - `energyLevel` (1-10) ← `recovery_score` (0-100, escalado)
  - **Definición explícita de "vacío"** (para no pisar edición manual): un campo se
    considera prellenable solo si es `undefined` o `null`. `0` y string vacío cuentan
    como valor presente y NO se sobreescriben.
  - **Metadata de procedencia**: el `dayLog` registra qué campos vinieron de Whoop
    (p.ej. `prefillSource: { sleepHours: 'whoop', energyLevel: 'whoop' }` o un set de
    campos). Esto permite: (a) que la UI muestre "desde Whoop" sin adivinar, (b) que el
    prefill sea idempotente (no re-sugiere un campo ya editado a mano), y (c) que el
    coach sepa que el dato es objetivo vs declarado. Requiere extender el tipo `DayLog`.
  - `painLevel` / `painNotes` / comentarios: nunca se autocompletan.
  - UI: indicador sutil "desde Whoop" en campos prefilled; siempre editables. Si el
    usuario edita un campo prefilled, se quita su marca de procedencia Whoop.

## Coach pasivo

- El `readiness_daily` del día se inyecta como contexto en el prompt del coach,
  sumándose al `dayLog` que ya consume `promptBuilder.ts`. Formato breve, p.ej.:
  *"Readiness Whoop: recovery 28% (bajo), sueño 5.2h, strain 14.1."*
- Alerta liviana en `actionAlerts` / `alertAdjustmentEngine` cuando recovery cae en banda
  roja: sugiere considerar bajar intensidad. **No** modifica el plan ni las sesiones.

## Legal / privacidad (GATE OBLIGATORIO)

Datos biométricos = sensibles. Esto es un **gate bloqueante**: no se expone la conexión
Whoop a usuarios reales hasta cumplir TODO lo siguiente:

- **Consentimiento biométrico explícito** antes de conectar Whoop (registrar versión y
  fecha de aceptación, como el consentimiento del onboarding).
- Texto claro de tratamiento de datos biométricos en **política de privacidad y términos**
  (conecta con el branch `client-readiness-legal` y `docs/legal/politica-de-privacidad.md`).
- **Desconexión** disponible en cualquier momento (revoca acceso, conserva o borra dato
  según elija el usuario — ver abajo).

### Borrado y ciclo de vida del dato

"Desconectar y borrar mis datos de Whoop" debe limpiar **todas** las superficies donde el
dato puede vivir, no solo la tabla principal:

1. **Servidor (Supabase, vía function con service-role):** borra `whoop_connections`,
   `whoop_oauth_states` (nonces colgados), `biometric_readings` y `readiness_daily` de la
   cuenta (`user_id`) y sus filas Whoop asociadas al atleta self.
2. **Dexie local:** limpia el store `readinessDaily`. El `prefillSource` ya escrito en
   `dayLogs` históricos NO se borra (es dato del check-in, propiedad del usuario), pero se
   deja de prellenar; el valor numérico ya editado/aceptado queda como dato propio del log.
3. **Cola/estado de sync:** evitar que el wipe local re-aparezca por un pull posterior.
   Reusar el mecanismo existente de `pending_remote_wipe` de `syncService` (el mismo
   patrón que `athlete_profiles`/`sessions`) para que el borrado remoto + local converja y
   no rehidrate desde el otro dispositivo. Agregar `readiness_daily` a la lista de tablas
   syncables (`syncService.ts:469`) y a la lógica de wipe.
4. **Export/backup:** incluir `readinessDaily` en el export/backup (`dataExport.ts`) por
   completitud y portabilidad; documentar que un backup viejo puede contener readiness y
   que restaurarlo lo re-introduce (consistente con cómo ya se comporta el resto del backup).
5. **Wipe total de cuenta:** `clearAllLocalAppData` (`appMaintenance.ts`) debe incluir el
   nuevo store para que "borrar cuenta y datos" siga siendo completo.

El copy legal mínimo se redacta en Track 0; la revisión legal profesional sigue el mismo
criterio que el resto de `client-readiness` antes de cobro/exposición pública.

## Testing

Foco en lógica pura y aislada:

- `whoopNormalize` — mapeo Whoop → tablas, incluido días sin dato.
- `tokenCrypto` — round-trip encrypt/decrypt AES-256-GCM; IV único por llamada; selección
  por `key_version`.
- `whoopClient` — refresh de token (con fetch inyectado).
- OAuth `state` — validación de nonce: expirado, reutilizado (single-use), binding al
  usuario incorrecto → todos rechazan.
- Throttle del sync manual — dentro de cooldown rechaza con `retry_after`; fuera de
  cooldown procede.
- `prefillDayLog` — "vacío" = `undefined`/`null` (no `0`/`''`); idempotencia vía
  `prefillSource`; escalados correctos; no re-sugiere campos editados a mano.
- `ReadinessCard` / `whoop-status` — render por banda de color y por estado de conexión.
- Migración Dexie v15 — store nuevo + campo `DayLog.prefillSource` sin romper existentes.

Verificación de cierre por tarea: `npm run lint && npm test && npm run build`.
Las migraciones SQL se prueban primero en un proyecto Supabase de staging, no en prod.

## Orden de implementación recomendado

Secuencia que minimiza riesgo y permite validar valor temprano (cada bloque verde antes
del siguiente: `npm run lint && npm test && npm run build`):

1. **Track 0** — Whoop Developer App, env vars, scopes/endpoints confirmados contra docs
   oficiales, copy legal mínimo redactado.
2. **Datos + seguridad server-side** — SQL (tablas + RLS) + migración Dexie v15 +
   `tokenCrypto` (AES-256-GCM) + OAuth (start/callback con state binding) + `whoop-status`.
3. **Normalización con tests, sin UI** — `whoopClient` (refresh) + `whoopNormalize`
   (puro, cubierto por tests). Verificable server-side antes de tocar el frontend.
4. **Sync manual primero** — `whoop-sync` invocable por botón, con throttle/cooldown.
   Permite validar el flujo end-to-end (conectar → sync → datos en `readiness_daily`).
5. **Sync programado** — cron UTC en `netlify.toml`, idempotente últimos 7 días.
6. **ReadinessCard + prefill editable** — tarjeta en Dashboard + `prefillDayLog` en el
   check-in, con metadata de procedencia.
7. **Contexto pasivo en coach** — readiness al prompt + alerta suave en banda roja.
   Sin modificar planes.

El gate legal (consentimiento + privacidad + borrado) debe estar cerrado antes de exponer
los pasos 6-7 a usuarios reales.

## Fuera de alcance (v1, explícito)

- HealthKit / Apple Health (requiere shell nativo / Capacitor).
- Webhooks de Whoop (el poll diario alcanza para v1).
- Ajuste automático de carga (solo contexto pasivo en v1).
- Escribir métricas Whoop de atletas gestionados sin cuenta propia. v1 solo conecta la
  cuenta autenticada y escribe su atleta self.
- Histórico/gráficos de tendencia de readiness (futuro; v1 muestra solo el día).

## Riesgos y mitigaciones

- **Tokens sensibles** → AES-256-GCM en reposo (IV/tag por token, `key_version` para
  rotación), RLS que niega lectura cliente, refresh server-side.
- **CSRF / secuestro de OAuth** → `state` nonce single-use con expiración, binding al
  usuario autenticado, redirect allowlist dev/prod.
- **Abuso del sync manual / rate limit Whoop** → cooldown server-side + error amable con
  `retry_after` + estado visible en UI.
- **API de Whoop cambia** → Track 0 confirma scopes/endpoints/paginación/refresh contra
  docs oficiales antes de codear; `whoopClient`/`whoopNormalize` aislados para absorber cambios.
- **RLS de membresías todavía no está en SP1** → v1 usa `athletes.owner_account_id` /
  `linked_account_id` para lectura de `readiness_daily`. Cuando SP1 aterrice, reemplazar
  ese predicado por `athlete_memberships`.
- **Atleta self faltante en sync** → `whoop-sync` resuelve el atleta self antes de
  escribir; si no existe, devuelve error amable y no crea métricas huérfanas.
- **Datos biométricos crudos** → `biometric_readings` y `whoop_connections`/`whoop_oauth_states`
  son server-only estrictos (RLS sin políticas para cliente); la UI solo ve `readiness_daily`.
- **Días sin dato Whoop** → todos los campos de readiness son nullable; el prefill no
  sobreescribe y la UI muestra estado "sin dato hoy".
- **Cuota/rate limit Whoop** → poll diario acotado + sync manual con throttle.
- **Privacidad/legal** → bloquea exposición pública hasta cerrar consentimiento.

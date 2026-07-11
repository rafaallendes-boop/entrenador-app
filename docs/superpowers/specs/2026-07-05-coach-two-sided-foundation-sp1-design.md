# SP1 — Fundación de dos lados (coach ↔ atleta con login) — Design Spec

> **Estado:** diseño aprobado (brainstorm 2026-07-05) + **enmienda de endurecimiento pre-plan 2026-07-09** (§2b). Próximo paso: plan de implementación (writing-plans) que arranca **solo con SP1a**; SP1b se planifica después.
> **Contexto de producto:** habilitar que una cuenta-atleta con login propio y una cuenta-coach compartan **el mismo perfil de atleta** (misma data), con acceso por membresía, sin fugas cross-cuenta y sin romper el flujo single-athlete actual.
>
> **Veredicto de revisión (2026-07-09):** dirección correcta (memberships canónica, transición owner/linked, split SP1a/SP1b, acople Whoop en `013+`/Dexie v17). Antes de codear se cerraron seis decisiones en §2b: autoría de sesiones, ruteo de completación en sync/offline, PK de `athlete_coach_notes`, lifecycle en reset/export/borrado, lista explícita de RLS tabla-por-tabla, y secuencia claim-antes-de-bootstrap. El plan parte **solo por SP1a** (migraciones `013a/013b/013c`, Dexie v17, memberships pull-only, self link-aware, RLS v2, smoke con membresías sembradas); SP1b (invitaciones/UI) va después.

Este spec es SP1 dentro de una descomposición mayor de la nueva UI de coach:

| # | Sub-proyecto | Estado |
|---|---|---|
| **SP1** | **Fundación de dos lados** (este doc): membresías + invitaciones + RLS v2 + hidratación/sync link-aware | diseño listo |
| SP2 | Dashboard de coach sin suplantación (leer atletas como objetos) | pendiente |
| SP3 | Autoría manual de entrenamientos con biblioteca completa | pendiente |
| SP4 | Asistencia IA del coach (sugerir/mejorar) | pendiente |
| Track B | Integración Whoop (se ejecuta antes de SP1; SP1 la absorbe) | pendiente |

---

## 1. Meta y no-metas

**Meta SP1:** dos cuentas (coach y atleta) operan sobre un mismo `athlete_id` con permisos por rol, vinculadas siempre por **consentimiento** (request → accept), sobre una base de RLS por membresía que reemplaza el modelo actual de "propiedad por columnas" (`owner_account_id`/`linked_account_id`).

**No-metas (a specs siguientes):**
- Dashboard de coach sin suplantación / UX real (SP2). SP1 entrega solo UI mínima testeable.
- Autoría manual de entrenamientos (SP3) y asistencia IA (SP4).
- Multi-coach en UI, permisos por campo finos más allá de lo definido acá.
- Reemplazo del allowlist `VITE_COACH_ACCOUNTS` (sigue gateando "quién ve la UI coach" en beta).
- Whoop (Track B).

---

## 1b. Coordinación con Whoop (Track B, se ejecuta ANTES que SP1)

Whoop v1 (`011_whoop_integration.sql`) aterriza primero y toma
migración SQL `011` + `012_whoop_workouts.sql`, y Dexie `v16`. SP1 arranca en `013+` / Dexie `v17+`. Cuando SP1 reescriba la
RLS athlete-scoped y la resolución de "self", **debe barrer también lo que Whoop dejó**:

- **RLS:** incluir `readiness_daily` (y `biometric_readings`, aunque es server-only) en la migración
  del predicado `owner/linked` → `athlete_id in (select public.auth_athlete_ids())`.
- **Resolución de self:** actualizar `resolveSelfAthleteId` (server, `netlify/functions/_shared/whoopSupabase.ts`)
  y `getSelfAthleteId` (cliente) al modelo de membresía `role='self'` — Whoop los dejó resolviendo
  `ath_<user_id>` determinístico. Es el mismo cambio de §6.1; solo hay que recordar el punto server-side de Whoop.
- Sin cambios de datos en Whoop: `readiness_daily` ya está scoped por `athlete_id`, así que la lectura
  del coach sobre un atleta con Whoop conectado funciona apenas la membresía exista.
- **Contrato producto/landing coach:** SP1 no cambia la promesa pública de Whoop. El dato
  sigue siendo opcional, consentido y conectado por el atleta self. La futura landing o
  dashboard de coach puede decir que el coach ve readiness/sueño/strain cuando el atleta
  lo conecta, pero no que el coach conecta dispositivos por terceros ni que RallyIQ ajusta
  planes automáticamente.
- **SP2:** al construir dashboard de coach sin suplantación, readiness se modela como
  métrica del `athlete_id` en tarjetas/listados. No se debe reutilizar el estado de
  `whoop_connections` del coach para inferir datos de atletas.

## 2. Decisiones tomadas (trazabilidad del brainstorm)

1. **Modelo atleta:** atletas con su propia cuenta/login; el coach se vincula. Modelo completo desde el arranque de la beta.
2. **Vínculo bidireccional:** (a) reclamo por invitación de un perfil gestionado; (b) vincular a un usuario ya registrado. Ambas direcciones = "agregar una membresía".
3. **Keystone:** tabla `athlete_memberships` con rol reemplaza los 2 casilleros `owner/linked`. Soporta multi-coach a futuro y no migra data del atleta existente.
4. **Consentimiento obligatorio:** un coach nunca se auto-agrega a un atleta existente. Toda membresía se crea aceptando una invitación válida vía función `SECURITY DEFINER`.
5. **Escritura por rol** (no simétrica plena): `coach ⊇ self`; el atleta no puede tocar contenido coach-authored (planes, propuestas, notas de coach).
6. **`sessions` vía RPC:** el self solo cambia campos de completación sobre sesiones coach-authored (RPC `mark_session_done`); no reescribe contenido.
7. **`coachMemory` se extrae** de `athlete_profiles` a `athlete_coach_notes` (RLS por tabla; evita RLS por columna).
8. **Invites server-only** (no sync bidireccional); **memberships pull-only** (mutación solo por RPC); tokens **hasheados**.

---

## 2b. Enmienda de endurecimiento pre-plan (2026-07-09)

Seis decisiones que faltaba cerrar antes de convertir el spec en plan. Son **normativas**: el plan SP1a/SP1b las implementa tal cual.

### D1 — Autoría de sesiones (backfill + qué es "coach-authored")

- **Columna explícita, no derivada:** además de `created_by_account_id`/`updated_by_account_id` (§3.4), `sessions` lleva `authored_by_role text not null check (authored_by_role in ('self','coach'))` **estampado en creación** (el backfill llena las filas existentes antes de endurecer `not null`, patrón `009c`/`010c`). El gate de `mark_session_done` (§4.3) y la UI leen esta columna, no re-derivan el rol contra membresías (que pueden cambiar después).
- **Backfill determinístico en la migración:**
  - Sesiones de un atleta **gestionado** (owner=coach, sin `self` en el backfill de membresías) → `authored_by_role='coach'`, `created_by_account_id = owner_account_id`.
  - Sesiones de un atleta **self** (owner=linked) → `authored_by_role='self'`, `created_by_account_id = owner_account_id`.
  - Filas legacy sin `athlete_id` (owner-only) → tratadas como `self` del owner; no entran al modelo coach.
- **Transición de estado:** una sesión legacy **nunca** pasa a coach-authored retroactivamente por reclamar el atleta. Solo las sesiones **creadas** bajo contexto coach (plan builder / propuestas aplicadas por un miembro `coach`) nacen `authored_by_role='coach'`. Reclamar un atleta (§5.1) no reescribe autoría de su historial.

### D2 — Sync y cola offline de la completación coach-authored

- **Ruteo por tipo de op, no upsert genérico.** Si el self completa una sesión `authored_by_role='coach'`, el cliente **no** hace el upsert de fila normal: encola una op discriminada `session_completion` que en reconexión llama **solo** al RPC `mark_session_done`. Sesiones self-authored/manuales siguen por el upsert normal.
- **Whitelist y forma de storage (decisión):** hoy `sessions` guarda la completación **dentro de `data` JSONB** (solo `status` es columna real; ver `sessionToRow` en `syncService.ts`). Los campos TS son `completedAt`, `actualRpe`, `actualDurationMin`, `completionNotes`, `sessionFeedback`. **SP1 no agrega columnas reales:** `mark_session_done` actualiza la columna `status` + un **patch acotado de esas claves camelCase dentro de `data`** (`jsonb_set`/merge de solo la whitelist), y `updated_at`/`updated_by_account_id`. Ningún otro key de `data` se toca. (Promover estos campos a columnas reales queda como opción futura fuera de SP1.)
- **Offline:** se aplica optimista en Dexie y se encola la op `session_completion`; al recuperar red se drena vía RPC. Si el RPC rechaza (deja de ser miembro, sesión borrada), la op falla y se resuelve como conflicto de sync (no se reintenta ciegamente el upsert de fila).
- **Regla dura:** ninguna ruta de cliente puede escribir campos no-whitelist de una sesión coach-authored, ni siquiera offline. El discriminador vive en la cola de sync, no en la policy sola.

### D3 — `athlete_coach_notes` PK = decisión de producto (notas por atleta, no por coach)

- **Decisión de producto para beta:** PK `athlete_id` ⇒ las notas de coach son **compartidas por atleta**, no privadas por coach. Un segundo coach del mismo atleta ve/edita las mismas notas. Es aceptable en beta (multi-coach no está en UI, §1 no-metas).
- **Camino forward declarado:** si se necesita nota privada por coach, la PK evoluciona a `(athlete_id, coach_account_id)` en un SP posterior (expand→contract), migrando la nota actual como la del coach owner. Se documenta acá para no tratarlo como bug más adelante.

### D4 — Lifecycle: reset / export-import / borrado

Una membresía es **acceso a nivel cuenta**, no contenido local del atleta. Por eso no sigue las reglas de "dato local cualquiera":

- **Reset/wipe local:** limpia el **cache local** de `athlete_memberships` (pull-only) pero **no** muta membresías en servidor; se re-hidratan del server al re-loguear. `athlete_invites` nunca vive en local. El wipe no revoca accesos.
- **Export/import:** `athlete_memberships` y `athlete_invites` **quedan fuera** del export/import (son registros de acceso server-authoritative; importar en otra cuenta jamás debe fabricar membresías ni accesos). `athlete_coach_notes` es contenido **coach-only**: se incluye en export/backup **solo cuando lo dispara un miembro `coach`**; el export self-triggered **excluye** `coach_memory` para no filtrar la memoria del coach al self (misma sensibilidad que hoy en `athlete_profiles.coachMemory`).
- **Borrado:** borrar una cuenta cascada sus membresías (`account_id … on delete cascade`); borrar un atleta cascada sus notas (`athlete_id … on delete cascade`). El borrado de datos del atleta **no** debe dejar membresías colgadas. "Borrar mis datos locales" ≠ "revocar acceso": revocar es una acción de membresía por RPC, explícita.

### D5 — RLS v2 tabla por tabla (lista explícita, nada implícito)

Migran del predicado `owner/linked` → `athlete_id in (select public.auth_athlete_ids())` **exactamente estas tablas** (set canónico de `007` + Whoop + nuevas SP1):

| Tabla | Lectura | Escritura | Nota |
|---|---|---|---|
| `athletes` | por membresía (**predicado `id in …`**, no `athlete_id`) | coach (perfil), self acotado | keystone de scope; PK es `id` |
| `sessions` | por membresía | self/coach; coach-authored vía RPC | ver D1/D2 |
| `day_logs` | por membresía | self + coach | provenance §3.4 |
| `week_summaries` | por membresía | self + coach | provenance §3.4 |
| `chat_messages` | por membresía | self + coach | |
| `coach_proposals` | por membresía | **coach-only** (`auth_coach_athlete_ids()`) | |
| `training_plans` | por membresía | **coach-only** | |
| `training_plan_weeks` | por membresía | **coach-only** | athlete_id derivado del plan padre |
| `athlete_profiles` | por membresía | self + coach (campos personales) | `coach_memory` ya extraído a notes |
| `athlete_coach_notes` | **coach ∪ self-sin-coach-externo** | **coach ∪ self-sin-coach-externo** | tabla nueva SP1; helper `auth_coach_note_athlete_ids()` — coach-only puro rompería al owner (solo tiene membresía `self` sobre su atleta y lee/escribe su propia memoria); un self reclamado CON coach externo no lee ni escribe (coherente con D4) |
| `readiness_daily` (Whoop) | por membresía | server-only (service-role) | migrar predicado, sin mover datos (§1b) |

**Server-authoritative, sin mutación directa del cliente:**

- **Sin policies authenticated/anon (solo service-role):** `whoop_connections`, `whoop_oauth_states`, `biometric_readings`, `athlete_invites`.
- **`athlete_memberships` — caso aparte:** SELECT propio (`account_id = auth.uid()`) para pull/cache del cliente (§4.4, §6.3); **sin** INSERT/UPDATE/DELETE por RLS — solo se muta vía RPC `SECURITY DEFINER`. No es server-only puro: el cliente lee sus propias membresías.

El plan lista cada tabla en la migración y confirma todas en el smoke de denegación cross-rol; no se deja ninguna "por defecto".

### D6 — Secuencia claim antes del bootstrap (la parte más delicada)

- **Ruta dedicada:** link de invitación `claim_self` abre `/claim/:token` (o `/invite?token=…`), manejado **antes** de que `hydrateActiveAthlete` bootstrapee el self default.
- **Estado `claim-pending`:** si el arranque detecta un token de claim (en URL o persistido tras el login OAuth), la hidratación entra en estado `claim-pending` que **bloquea la creación de `ath_<uid>`** hasta que el redeem complete o el usuario lo descarte explícitamente. Sin este gate, el bootstrap default crearía el self vacío y colisionaría con `unique(account_id) where role='self'`.
- **Reemplazar self vacío:** si la cuenta ya tenía un `ath_<uid>` **sin data**, el redeem lo convierte/descarta y asigna el gestionado como `self` (flujo explícito §5.1.3). Nunca dos `role='self'`.
- **Persistencia del token cross-OAuth:** el token sobrevive el redirect de login (se guarda antes de ir a Google y se re-lee al volver), para que la secuencia claim→redeem ocurra en el primer render post-auth, antes del bootstrap.
- Esto es SP1b, pero el **gate de bloqueo del bootstrap** se diseña en SP1a (hidratación por membresías) para que exista el punto de corte antes de que haya invitaciones.

---

## 3. Modelo de datos

### 3.1 `athlete_memberships` (fuente canónica de acceso)

```
athlete_memberships(
  athlete_id   text  references athletes(id) on delete cascade,
  account_id   uuid  references auth.users(id) on delete cascade,
  role         text  not null check (role in ('self','coach')),
  created_at   bigint not null,
  updated_at   bigint not null,
  primary key (athlete_id, account_id)
)
```

**Invariantes DB:**
- `PK (athlete_id, account_id)` — una membresía por par.
- `unique(account_id) where role='self'` — cada cuenta tiene exactamente un atleta primario.
- `unique(athlete_id) where role='self'` — cada atleta tiene exactamente un dueño-self.
- índice `(account_id, role)` — para resolución rápida de "mis atletas" y "mi self".

**Regla de negocio:** "tenés acceso a un `athlete_id` si existe una membresía tuya en él". El rol determina qué podés escribir (§4).

### 3.2 `athlete_invites` (server-only)

```
athlete_invites(
  id            uuid primary key,
  kind          text not null check (kind in ('claim_self','grant_coach')),
  athlete_id    text null,            -- claim_self: seteado; grant_coach: resuelto al aceptar
  invited_role  text not null check (invited_role in ('self','coach')),
  created_by    uuid not null references auth.users(id),
  target_email  text null,            -- grant_coach: email del atleta objetivo
  token_hash    text not null,        -- SHA-256 del token; NUNCA el token plano
  status        text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  expires_at    bigint not null,
  created_at    bigint not null,
  accepted_at   bigint null,
  accepted_by   uuid null
)
```

**No entra al sync normal.** El cliente lee "mis invitaciones pendientes" por function (`list_pending_invites()` que filtra por `target_email = auth.email()` o token presentado). El token plano solo existe en el link/código entregado fuera de banda; en DB solo el hash.

### 3.3 `athlete_coach_notes` (coachMemory extraído)

```
-- PK athlete_id ⇒ notas compartidas por atleta, no privadas por coach. Decisión de producto (D3, §2b).
athlete_coach_notes(
  athlete_id   text primary key references athletes(id) on delete cascade,
  coach_memory text,
  -- otros campos coach-only que hoy viven mezclados en athlete_profiles
  updated_by_account_id uuid,
  updated_at   bigint not null
)
```

`athlete_profiles` conserva solo **datos personales** (self-writable). ⚠️ La extracción de `coachMemory` toca lo que lee `src/services/ai/promptBuilder.ts` — se hace revisando el contexto completo del coach (regla del proyecto). El builder pasa a leer `coach_memory` desde la nueva tabla.

### 3.4 Provenance en tablas de escritura compartida

Agregar a `day_logs`, `sessions`, `week_summaries`, `athlete_profiles`:
- `created_by_account_id uuid` (autoría)
- `updated_by_account_id uuid` (última edición)

En `sessions`, además, `authored_by_role text not null check (authored_by_role in ('self','coach'))` estampado en creación define si una sesión es coach-authored (gobierna el RPC de completación, §4.3). Se usa la columna explícita, **no** una derivación contra membresías (que pueden cambiar). Backfill y regla de transición en **D1 (§2b)**. Permite a la UI post-reclamo distinguir "dato propio" vs "editado por coach".

### 3.5 Migración (expand → preflight → contract), patrón `007`/`010c`

- **Expand:** crear `athlete_memberships`, `athlete_invites`, `athlete_coach_notes`; agregar columnas provenance; backfill.
- **Backfill de membresías desde `athletes`:**
  - `owner = linked` (self actual) → `membership(owner, 'self')`.
  - managed (`owner=coach, linked=null`) → `membership(owner, 'coach')`.
  - `linked` no nulo y ≠ owner → **DOS** membresías: `membership(linked, 'self')` **y** `membership(owner, 'coach')` (no perder el acceso del coach).
- **Backfill de `coach_memory`:** mover `athlete_profiles.coachMemory` → `athlete_coach_notes.coach_memory`.
- **Mantener** `owner_account_id`/`linked_account_id` en `athletes` durante varias migraciones; contract diferido hasta que el código deje de leerlas.
- **Trigger anti-reparenting:** `BEFORE UPDATE` en tablas hijas (`sessions`, `day_logs`, `week_summaries`, `chat_messages`, `coach_proposals`, `training_plans`, `training_plan_weeks`, `athlete_profiles`, `athlete_coach_notes`) que rechaza cambiar `athlete_id` en una fila ya creada (cierra exfiltración/corrupción por re-parent).
- **Preflight report-only** (como `008a`/`009a`/`010a`) antes de endurecer.

---

## 4. RLS v2

### 4.1 Helper anti-recursión

```sql
create or replace function public.auth_athlete_ids()
returns setof text
language sql stable security definer
set search_path = public
as $$ select athlete_id from athlete_memberships where account_id = auth.uid() $$;
```

`security definer` + `search_path` fijo evita recursión RLS cuando las policies de tablas hijas consultan membresías. Todas las policies usan `athlete_id in (select public.auth_athlete_ids())` en vez de subquery directa contra `athlete_memberships`.

Análogo para rol: `auth_coach_athlete_ids()` (membresías con `role='coach'`) para las policies de escritura coach-only.

### 4.2 Lectura (todas las tablas hijas + `athletes`)

`using (athlete_id in (select public.auth_athlete_ids()))` para las tablas hijas. Ambos roles ven todo el perfil, con UNA excepción: `athlete_coach_notes` se lee por `auth_coach_note_athlete_ids()` (coach ∪ self-sin-coach-externo) — la memoria del coach no es visible para un self reclamado con coach externo (coherente con D4).

⚠️ **`athletes` no tiene columna `athlete_id`** (su PK es `id`, ver `007`). Su policy es `using (id in (select public.auth_athlete_ids()))`. Igual `athlete_coach_notes` (PK `athlete_id`) sí usa `athlete_id`. No copiar el predicado a ciegas.

### 4.3 Escritura por rol (matriz)

| Tabla | `self` escribe | `coach` escribe | Mecanismo |
|---|---|---|---|
| `day_logs`, `week_summaries`, `athlete_profiles` (personales) | ✓ | ✓ | policy por membresía + `athlete_id not null` |
| `sessions` (manual, self-authored) | ✓ | ✓ | policy por membresía |
| `sessions` (coach-authored) | solo campos de completación | ✓ | **RPC `mark_session_done`** para self |
| `training_plans`, `training_plan_weeks`, `coach_proposals` | ✗ | ✓ | policy `athlete_id in auth_coach_athlete_ids()` |
| `athlete_coach_notes` | solo si NO hay coach externo | ✓ | helper `auth_coach_note_athlete_ids()` (coach ∪ self-sin-coach-externo); lectura con la misma regla — ver D5. Preserva al owner actual (self único) leyendo/escribiendo su propia memoria; excluye al self reclamado con coach |
| `chat_messages` | ✓ | ✓ | policy por membresía |

- **`coach ⊇ self`:** el coach escribe todo (incluido operar atletas gestionados **sin reclamar**, donde aún no hay `self`).
- **Filas legacy/null** siguen owner-only por las policies `user_id` existentes → sin bypass cross-tenant.
- **`mark_session_done(session_id, ...)`** (`SECURITY DEFINER`): valida que el caller sea miembro del atleta y actualiza **solo** `status` (columna) + patch de las claves camelCase de completación dentro de `data` JSONB (`completedAt, actualRpe, actualDurationMin, completionNotes, sessionFeedback`) + `updated_at`/`updated_by_account_id`. **No** hay columnas SQL `completed_at`/`actual_rpe` hoy; viven en `data` (ver D2, §2b). Ningún otro campo de una sesión coach-authored es escribible por el self.

### 4.4 Mutación de membresías e invites

- **`athlete_memberships`:** sin INSERT/UPDATE/DELETE por RLS abierta. Solo se muta desde RPCs `SECURITY DEFINER` (§5). El cliente solo hace SELECT (pull/cache).
- **`athlete_invites`:** server-only; sin policies de lectura directa amplia. Acceso vía funciones (`create_*_invite`, `list_pending_invites`, `redeem_*`, `accept_*`, `revoke_invite`).

---

## 5. Flujos de vínculo (RPCs `SECURITY DEFINER`)

Ambos flujos crean membresías **solo** al aceptar una invitación válida. Tokens hasheados: el RPC recibe el token plano, hashea y compara contra `token_hash`.

### 5.1 `claim_self` (coach invita a reclamar un atleta gestionado)

1. Coach (miembro `coach` del atleta gestionado) → `create_claim_self_invite(athlete_id)` → devuelve token plano (una sola vez) para armar el link/código. DB guarda solo el hash + `expires_at`.
2. El invitado abre el link y se autentica (Google/email).
3. **Secuencia crítica vs `unique(account_id) where role='self'`:** el `redeem_claim_self(token)` corre **antes** del bootstrap del self default del cliente. Si el redeem procede, la membresía `self` del invitado apunta al `athlete_id` gestionado; **no** se crea `ath_<uid>`.
   - Si la cuenta ya tenía un self vacío (`ath_<uid>` sin data), flujo explícito **"reemplazar self vacío"**: se borra/convierte el self vacío y se asigna el gestionado como self. Nunca dos `role='self'`.
4. `redeem_claim_self` valida token/expiry/estado, crea `membership(athlete_id, auth.uid(), 'self')`, marca invite `accepted`.

### 5.2 `grant_coach` (atleta existente da acceso a un coach)

1. Coach → `create_grant_coach_invite(target_email)` → invite `pending` con `athlete_id = null` (se resuelve al aceptar). Se notifica/entrega al atleta.
2. El atleta autenticado ve la invitación (`list_pending_invites()` filtra por `target_email = auth.email()`).
3. `accept_grant_coach(invite_id)`: resuelve `athlete_id` desde la **membresía `self` del usuario autenticado** (el coach nunca lo especifica), crea `membership(athlete_id, created_by, 'coach')`, marca `accepted`.
4. El coach nunca actúa unilateralmente: la acción autorizante la ejecuta quien tiene autoridad sobre el atleta.

Funciones auxiliares: `revoke_invite(id)`, expiración perezosa (invites vencidas → `expired` al listarlas o vía job).

---

## 6. Cliente (Dexie + sync + hidratación)

### 6.1 Resolución de "self" link-aware
`getSelfAthleteId()` pasa a resolver **la membresía `role='self'` de la cuenta** (no `ath_<uid>` hardcodeado). Fallback legacy (sin membresías) → `ath_<uid>`, preservando single-athlete.

### 6.2 Hidratación
`hydrateActiveAthlete`: carga mis membresías → atleta activo = selección persistida si está entre mis membresías, si no mi `self`. **No** crea `ath_<uid>` si ya existe una `self` apuntando a otro atleta (caso reclamado). Integra el gate de secuencia claim (§5.1) antes del bootstrap default: el estado `claim-pending` **bloquea** la creación de `ath_<uid>` hasta redeem/descartar (**D6, §2b**). Este punto de corte se construye en SP1a aunque las invitaciones lleguen en SP1b.

### 6.3 Sync
- **Pull** pasa de `user_id` a **`athlete_id ∈ mis membresías`** (para un coach, varios atletas).
- **Push** sigue estampando `athlete_id` por scope activo; fallback legacy anclado a `getSelfAthleteId()` ya resuelto por membresía. **Excepción:** la completación por el self de una sesión coach-authored no va por upsert de fila sino por op `session_completion` → RPC `mark_session_done`, incluso offline (**D2, §2b**).
- Nuevas tablas en sync: `athlete_coach_notes` (bidireccional). `athlete_memberships`: **pull-only** (cache local; sin push). `athlete_invites`: **fuera del sync**, acceso por RPC.
- No duplicar lógica de sync existente (regla del proyecto).

### 6.4 Provenance en UI
Post-reclamo, la UI puede distinguir dato propio vs editado por coach usando `updated_by_account_id`/`created_by_account_id`.

---

## 7. UI mínima (SP1b — solo testeable end-to-end)

- **Coach en roster:** "Invitar a reclamar" (genera link `claim_self`) y "Vincular atleta existente" (email → invite `grant_coach` pendiente).
- **Atleta:** pantalla de redención de link `claim_self` (con manejo del caso "reemplazar self vacío") y bandeja de invitaciones pendientes para aceptar `grant_coach`.
- Sin pulido visual; la UX real es SP2.

---

## 8. Testing

- **Lógica cliente** (resolución de self, hidratación, secuencia claim vs bootstrap, cache de membresías, hashing de token, scope de sync): vitest + fake-indexeddb, patrón `db.close(); await db.delete(); await db.open()` por test.
- **RLS/policies/trigger/invariantes/RPCs:** no se testean en JS. Modelo de migración manual: **preflight report-only** (como `008a`/`009a`/`010a`) + smoke documentado (self solo, coach+atleta reclamado, coach+atleta existente, escritura cross-rol denegada, `mark_session_done` acotado). Opcional pgTAP para cobertura automatizada de policies/RPCs.

---

## 9. Fase del plan

> **El plan de implementación arranca solo con SP1a.** SP1b se planifica y ejecuta después, para no reabrir el contrato de datos/acceso mientras se estabiliza la fundación. Numeración reservada: migraciones **`013a` (preflight/expand), `013b` (backfill + trigger), `013c` (contract diferido)**, siguiendo el patrón `010a/b/c`; **Dexie v17** (v15/v16 las tomó Whoop, §1b).

### SP1a — Fundación de datos y acceso (sin flujos de invitación)
- Migración `013a/013b/013c`: `athlete_memberships`, `athlete_invites`, `athlete_coach_notes`, columnas provenance (incl. `authored_by_role` en `sessions`, **D1**), backfill, trigger anti-reparenting, invariantes.
- Helper `auth_athlete_ids()`/`auth_coach_athlete_ids()` + RLS v2 lectura + escritura por rol + `mark_session_done`. **La migración lista explícitamente las tablas de D5 (§2b)** y confirma las server-only.
- Cliente: **Dexie v17**, `getSelfAthleteId` link-aware, hidratación por membresías **con gate `claim-pending` que bloquea el bootstrap `ath_<uid>` (D6)**, sync pull por membresías, ruteo de op `session_completion` vía RPC (**D2**), `athlete_coach_notes` en sync, `athlete_memberships` pull-only.
- Lifecycle: reset/export/borrado según **D4** (memberships/invites fuera del export; `coach_memory` fuera del export self-triggered).
- Extracción de `coachMemory` → `athlete_coach_notes` (con revisión de `promptBuilder`).
- Testeable con membresías **sembradas** (sin UI de invitación todavía).
- Preflight report-only + smoke con membresías sembradas (self solo, coach+gestionado, denegación cross-rol, `mark_session_done` acotado).

### SP1b — Flujos de vínculo + UI mínima (plan aparte, después de SP1a)
- RPCs `create_claim_self_invite`/`redeem_claim_self`, `create_grant_coach_invite`/`accept_grant_coach`, `list_pending_invites`, `revoke_invite`.
- Secuencia claim vs bootstrap y "reemplazar self vacío".
- UI mínima coach (invitar/vincular) y atleta (redimir/aceptar).
- Smoke end-to-end de ambas direcciones.

---

## 10. Riesgos y mitigaciones

- **Fuga cross-cuenta (el riesgo central):** RLS por membresía vía helper `SECURITY DEFINER` con `search_path` fijo; escritura por rol; mutación de membresías solo por RPC; invites server-only; trigger anti-reparenting; preflight + smoke de denegación cross-rol antes de endurecer.
- **Romper single-athlete actual:** `getSelfAthleteId` con fallback legacy; filas legacy/null owner-only; smoke self-solo obligatorio.
- **Colisión `unique(role='self')` en claim:** redeem antes del bootstrap + flujo "reemplazar self vacío".
- **`promptBuilder` al mover `coachMemory`:** revisión del contexto del coach; el builder lee de la nueva tabla.
- **Recursión RLS:** helpers `SECURITY DEFINER`, nunca subquery directa contra `athlete_memberships` en policies de tablas hijas.
- **Lifecycle de acceso vs dato (D4):** un reset/export/borrado local que arrastrara membresías o `coach_memory` sería fuga o pérdida de acceso silenciosa. Mitigación: memberships/invites fuera de export/import y no mutables por wipe local; `coach_memory` fuera del export self-triggered; revocar acceso es siempre acción explícita por RPC.

## 11. Rollback

- Migración expand/contract: el contract queda diferido; ante problema se revierten policies nuevas y se cae a las policies `user_id` legacy (que se mantienen).
- Columnas `owner/linked` intactas durante la transición → rollback de RLS no pierde el modelo de acceso previo.
- Flag de UI coach (`VITE_COACH_ACCOUNTS`) sigue gateando la superficie; sin él, la UI de invitación no se muestra.

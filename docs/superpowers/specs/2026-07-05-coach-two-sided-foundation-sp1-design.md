# SP1 — Fundación de dos lados (coach ↔ atleta con login) — Design Spec

> **Estado:** diseño aprobado (brainstorm 2026-07-05). Próximo paso: plan de implementación (writing-plans), fase SP1a → SP1b.
> **Contexto de producto:** habilitar que una cuenta-atleta con login propio y una cuenta-coach compartan **el mismo perfil de atleta** (misma data), con acceso por membresía, sin fugas cross-cuenta y sin romper el flujo single-athlete actual.

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

Whoop (`docs/superpowers/specs/2026-06-21-whoop-integration-design.md`) aterriza primero y toma
migración SQL `011` + Dexie `v15`. SP1 arranca en `012+` / Dexie `v16+`. Cuando SP1 reescriba la
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

## 3. Modelo de datos

### 3.1 `athlete_memberships` (fuente canónica de acceso)

```
athlete_memberships(
  athlete_id   text  references athletes(id) on delete cascade,
  account_id   uuid  references auth.users(id) on delete cascade,
  role         text  check (role in ('self','coach')),
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
  kind          text check (kind in ('claim_self','grant_coach')),
  athlete_id    text null,            -- claim_self: seteado; grant_coach: resuelto al aceptar
  invited_role  text,                 -- 'self' | 'coach'
  created_by    uuid references auth.users(id),
  target_email  text null,            -- grant_coach: email del atleta objetivo
  token_hash    text not null,        -- SHA-256 del token; NUNCA el token plano
  status        text check (status in ('pending','accepted','revoked','expired')),
  expires_at    bigint not null,
  created_at    bigint not null,
  accepted_at   bigint null,
  accepted_by   uuid null
)
```

**No entra al sync normal.** El cliente lee "mis invitaciones pendientes" por function (`list_pending_invites()` que filtra por `target_email = auth.email()` o token presentado). El token plano solo existe en el link/código entregado fuera de banda; en DB solo el hash.

### 3.3 `athlete_coach_notes` (coachMemory extraído)

```
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

En `sessions` el `created_by_account_id` (o un `authored_by_role`) define además si una sesión es coach-authored (gobierna el RPC de completación, §4.3). Permite a la UI post-reclamo distinguir "dato propio" vs "editado por coach".

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

`using (athlete_id in (select public.auth_athlete_ids()))`. Ambos roles ven todo el perfil.

### 4.3 Escritura por rol (matriz)

| Tabla | `self` escribe | `coach` escribe | Mecanismo |
|---|---|---|---|
| `day_logs`, `week_summaries`, `athlete_profiles` (personales) | ✓ | ✓ | policy por membresía + `athlete_id not null` |
| `sessions` (manual, self-authored) | ✓ | ✓ | policy por membresía |
| `sessions` (coach-authored) | solo campos de completación | ✓ | **RPC `mark_session_done`** para self |
| `training_plans`, `training_plan_weeks`, `coach_proposals`, `athlete_coach_notes` | ✗ | ✓ | policy `athlete_id in auth_coach_athlete_ids()` |
| `chat_messages` | ✓ | ✓ | policy por membresía |

- **`coach ⊇ self`:** el coach escribe todo (incluido operar atletas gestionados **sin reclamar**, donde aún no hay `self`).
- **Filas legacy/null** siguen owner-only por las policies `user_id` existentes → sin bypass cross-tenant.
- **`mark_session_done(session_id, ...)`** (`SECURITY DEFINER`): valida que el caller sea miembro del atleta y actualiza **solo** la whitelist `status, completed_at, actual_rpe, actual_duration, completion_notes/feedback`. Ningún otro campo de una sesión coach-authored es escribible por el self.

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
`hydrateActiveAthlete`: carga mis membresías → atleta activo = selección persistida si está entre mis membresías, si no mi `self`. **No** crea `ath_<uid>` si ya existe una `self` apuntando a otro atleta (caso reclamado). Integra el gate de secuencia claim (§5.1) antes del bootstrap default.

### 6.3 Sync
- **Pull** pasa de `user_id` a **`athlete_id ∈ mis membresías`** (para un coach, varios atletas).
- **Push** sigue estampando `athlete_id` por scope activo; fallback legacy anclado a `getSelfAthleteId()` ya resuelto por membresía.
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

### SP1a — Fundación de datos y acceso (sin flujos de invitación)
- Migración: `athlete_memberships`, `athlete_invites`, `athlete_coach_notes`, columnas provenance, backfill, trigger anti-reparenting, invariantes.
- Helper `auth_athlete_ids()`/`auth_coach_athlete_ids()` + RLS v2 lectura + escritura por rol + `mark_session_done`.
- Cliente: `getSelfAthleteId` link-aware, hidratación por membresías, sync pull por membresías, `athlete_coach_notes` en sync, `athlete_memberships` pull-only.
- Extracción de `coachMemory` → `athlete_coach_notes` (con revisión de `promptBuilder`).
- Testeable con membresías **sembradas** (sin UI de invitación todavía).
- Preflight report-only + smoke.

### SP1b — Flujos de vínculo + UI mínima
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

## 11. Rollback

- Migración expand/contract: el contract queda diferido; ante problema se revierten policies nuevas y se cae a las policies `user_id` legacy (que se mantienen).
- Columnas `owner/linked` intactas durante la transición → rollback de RLS no pierde el modelo de acceso previo.
- Flag de UI coach (`VITE_COACH_ACCOUNTS`) sigue gateando la superficie; sin él, la UI de invitación no se muestra.

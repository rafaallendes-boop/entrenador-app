# RFC — Coach Mode: arquitectura evolutiva para entrenadores multi-atleta

- **Estado:** Draft / Diseño (no implementar todavía)
- **Autor:** Principal Product Architect (sesión Claude)
- **Fecha:** 2026-06-16 · **Revisado:** 2026-06-22 (reconciliación con beta privada + piloto Whoop)
- **Horizonte:** 12 meses
- **Alcance:** diseño arquitectónico y plan estratégico. No incluye código.

> Decisión de producto explícita: **NO** se implementa el módulo de entrenadores ahora.
> Este documento define cómo llegar ahí sin romper el modelo individual actual.
>
> **Revisión 2026-06-22:** (1) durante la beta privada solo avanza el desacople interno
> invisible — ver §14.1 "Track Coach-ready foundation"; F1 "duro" (re-scope de sync +
> RLS v2) espera una ventana de migración controlada (ver §5 "Riesgos de migración").
> (2) Whoop se adelanta como piloto individual sobre `user_id`, como excepción táctica
> previa a F4 — ver §9.

---

## 0. Resumen ejecutivo

Entrenador App hoy es una app **local-first de un solo atleta**: Dexie en el cliente +
sync a Supabase, identidad por Google OAuth, y **un perfil singleton (`id: 'default'`)
atado 1:1 al usuario autenticado**. El motor de IA (Plan Builder) ya está bien aislado y
**parametrizado por `(profile, wizardConfig, athleteId)`**, por lo que es el componente
más reutilizable del sistema.

El salto a Coach Mode no es un feature nuevo encima: es **romper el supuesto "un usuario =
un atleta"**. El 80% del riesgo y del trabajo está en tres capas, no en la IA:

1. **Identidad y propiedad de datos** — desacoplar "atleta" de "usuario logueado".
2. **Autorización multi-tenant** — un coach accede a datos que no son suyos (RLS + membresías).
3. **Sync** — hoy scopea todo por `user_id`; debe pasar a scopear por `athlete_id` con acceso compartido.

Estrategia recomendada: **evolución en 4 fases sobre 12 meses**, empezando por
desacoplar el modelo de datos (sin UI de coach), luego una capa de membresías
coach↔atleta con "atletas gestionados sin login", y recién entonces la UI de coach y
las integraciones de wearables.

---

## 1. Auditoría de la arquitectura actual

### 1.1 Stack y topología

```
┌─────────────────────────── Cliente (React + TS + Vite) ───────────────────────────┐
│  Pages (Dashboard, PlanBuilderV2, ChatCoach, Settings, …)                          │
│  Stores Zustand: useAuthStore, useTrainingStore, usePlanBuilderStore,              │
│                  useChatStore, useCoachActionsStore, useCoachMemoryStore, …        │
│  Services: planBuilder/*, weekCreator/*, syncService, ai/*, notifications, pdf…     │
│  Dexie (IndexedDB) — v12, fuente de verdad local                                   │
└───────────────┬──────────────────────────────────────────────┬────────────────────┘
                │  sync (cola por op, tiers A/B/C)               │  IA (proxy/background)
                ▼                                                ▼
        ┌───────────────┐                            ┌──────────────────────────┐
        │   Supabase    │  Postgres + Auth (Google)  │  Netlify Functions       │
        │  filas por    │◀───────────────────────────│  coach.ts (proxy IA)     │
        │   user_id     │   background fn escribe     │  generate-plan-background │
        └───────────────┘   con token del usuario     │  enqueue-plan-generation │
                                                       └──────────────────────────┘
```

### 1.2 Modelo de datos local (Dexie v12)

Tablas que sincronizan a Supabase (scope `user_id`):
`sessions`, `day_logs`, `week_summaries`, `chat_messages`, `coach_proposals`,
`athlete_profiles`, `training_plans`, `training_plan_weeks`.

Tablas **local-only** (no sync hoy):
`planGenerationJobs`, `syncDiagnostics`, `syncErrorLog`, `aiRequestLogs`, `coachFeedback`.

**Tiers de sync** (`ENTITY_TIER`): A = crítico (`athlete_profiles`, `sessions`,
`training_plans`, `training_plan_weeks`), B = (`day_logs`, `week_summaries`,
`coach_proposals`), C = recuperable (`chat_messages`). El drenado de cola prioriza por tier.

### 1.3 Identidad y propiedad — el supuesto que hay que romper

- Auth = **un usuario Supabase** (Google OAuth). `useAuthStore.user`.
- **El perfil de atleta es singleton: `id: 'default'`**, cableado en `syncService` y
  `syncUtils` (`db.athleteProfiles.get('default')`, `id: 'default'` en merges/reset).
- Todas las lecturas remotas: `fetchAll(table, userId)` → `.eq('user_id', userId)`.
- `TrainingPlan.athleteId` **existe** pero en la práctica siempre vale `'default'`.

> Conclusión: la propiedad de datos es **implícita = usuario logueado**. No existe el
> concepto de "atleta como entidad independiente del dueño de la cuenta".

### 1.4 Autorización server-side

- `resolveAuthContext(event)` valida el Bearer token → `userId`.
- `createSupabaseWriter(userId, token)` escribe **con el token del usuario** → RLS aplica
  como ese usuario. No hay ningún camino para que un usuario actúe sobre datos de otro.

### 1.5 El motor de Plan Builder (buena noticia)

`buildPlanShell({ athleteId, profile, wizardConfig, goalEvent })`,
`generatePlanWeeks(...)`, `runAsyncPlanGeneration({ plan, weeks, profile, wizardConfig,
writer, callLLM })` — **todo recibe `profile` + `wizardConfig` + `athleteId` por parámetro**.
No hay acoplamiento al singleton dentro del núcleo. El acoplamiento vive en los **bordes**:
el store carga el perfil `'default'` y el writer scopea por el usuario que llama.

---

## 2. Entidades reutilizables

| Entidad / módulo | Reutilizable | Cómo se reutiliza en Coach Mode |
|---|---|---|
| Motor Plan Builder (`buildPlanShell`, `runAsyncPlanGeneration`, `profileAdapter`) | ✅ Alta | Se le pasa el `profile` del atleta gestionado y se escribe bajo su `athlete_id`. |
| `AthleteProfile` (tipo) | ✅ Alta | Pasa de singleton a **N por cuenta**; se le agrega `ownerId`/`athleteId` real. |
| `TrainingPlan` / `TrainingPlanWeek` (ya tienen `athleteId`) | ✅ Alta | El `athleteId` deja de ser `'default'` y pasa a ser la clave de scope. |
| `Session`, `DayLog`, `WeekSummary` | ✅ Media | Necesitan columna `athlete_id` además de tenant. |
| `CoachProposal` + loop coach→propuesta→impacto | ✅ Media | Reusable como "notas/propuestas del coach humano" además de IA. |
| `syncService` (cola, tiers, recovery) | ⚠️ Parcial | El motor de cola se reusa; el **scope `user_id` → `athlete_id` + acceso compartido** es reescritura. |
| `useAuthStore` | ⚠️ Parcial | Añadir `role`, `activeAthleteId`, `accessibleAthletes`. |
| Netlify auth (`resolveAuthContext`) | ⚠️ Parcial | Añadir verificación de **membresía** coach↔atleta antes de escribir. |
| Notificaciones, PDF import, weekCreator | ✅ Alta | Agnósticos al dueño; operan sobre el atleta activo. |

---

## 3. Modelo de datos Coach–Athlete (propuesto)

### 3.1 Principio rector

Introducir **tres conceptos nuevos** y re-scopear los datos de entrenamiento de
`user_id` a `athlete_id`:

1. **`account`** = una cuenta de login (lo que hoy es el usuario Supabase).
2. **`athlete`** = entidad de atleta **independiente del login**. Puede o no tener una
   cuenta asociada (`linked_account_id` nullable). Esto permite **"atletas gestionados
   sin login"** desde el día 1.
3. **`coach_athlete_link`** = membresía/relación con rol y permisos entre una cuenta
   (coach) y un atleta.

### 3.2 Diagrama entidad-relación

```
            ┌─────────────────┐
            │     account     │  (= usuario Supabase auth.uid())
            │─────────────────│
            │ id (PK=auth.uid)│
            │ email           │
            │ display_name    │
            │ account_type    │  'individual' | 'coach'
            └────────┬────────┘
                     │ owns / coaches
        ┌────────────┴───────────────┐
        │                            │
        ▼                            ▼
┌──────────────────┐        ┌──────────────────────────┐
│     athlete      │        │   coach_athlete_link     │
│──────────────────│        │──────────────────────────│
│ id (PK)          │◀───────│ athlete_id (FK)          │
│ owner_account_id │  N    1│ coach_account_id (FK)    │
│ linked_account_id│  (link)│ role  (coach|assistant|  │
│   (nullable)     │        │        viewer)           │
│ display_name     │        │ status(pending|active|   │
│ status           │        │        revoked)          │
└────────┬─────────┘        │ permissions (jsonb)      │
         │ 1                 │ invited_at / accepted_at │
         │                   └──────────────────────────┘
         │ N  (todos los datos de entrenamiento cuelgan del atleta)
         ▼
┌───────────────────────────────────────────────────────────────┐
│ athlete_profiles · sessions · day_logs · week_summaries ·      │
│ training_plans · training_plan_weeks · coach_proposals ·       │
│ chat_messages                                                  │
│   (cada fila gana columna athlete_id ; conserva user_id como   │
│    "última cuenta que escribió" para auditoría)                │
└───────────────────────────────────────────────────────────────┘
```

### 3.3 Reglas clave

- **Atleta individual de hoy** = un `athlete` con `owner_account_id = linked_account_id =
  su propia cuenta`. No cambia su experiencia.
- **Atleta gestionado por coach sin login** = `athlete` con `owner_account_id = coach`,
  `linked_account_id = NULL`. El coach es dueño de sus datos hasta que el atleta reclame
  la cuenta (futuro "claim/transfer").
- **Atleta con login propio + coach** = `athlete.linked_account_id = cuenta del atleta`,
  y un `coach_athlete_link` activo da acceso al coach.
- El `athlete_id` se vuelve la **clave de scope de todos los datos de entrenamiento**.
  `user_id`/`account_id` queda como metadato de auditoría ("quién escribió esto"), no como
  clave de propiedad.

### 3.4 Impacto en Dexie (local)

- Nueva tabla local `athletes` y `coach_athlete_links`.
- Cada tabla de entrenamiento gana índice `athlete_id` (ya existe en `training_plans` y
  `training_plan_weeks`; falta en `sessions`, `day_logs`, etc.).
- El store mantiene un **`activeAthleteId`**; las queries pasan de "get('default')" a
  "where athlete_id = activeAthleteId". Para el atleta individual el `activeAthleteId` es
  estable y la migración backfillea `'default'` → su athlete real.

---

## 4. Permisos y roles

### 4.1 Roles

| Rol | Origen | Capacidad |
|---|---|---|
| `owner` | dueño del atleta (individual = sí mismo) | Control total, incluye borrar/transferir. |
| `coach` | `coach_athlete_link.role = coach` | Crear/editar planes, sesiones, propuestas, ver todo. |
| `assistant` | link `assistant` | Editar planes/sesiones, sin gestión de la relación. |
| `viewer` | link `viewer` | Solo lectura (ej. preparador físico externo, familiar). |
| `athlete-self` | atleta con login propio | Edita sus datos; ve quién lo entrena; revoca acceso. |

### 4.2 Matriz de permisos (resumen)

| Acción | owner | coach | assistant | viewer | athlete-self |
|---|:--:|:--:|:--:|:--:|:--:|
| Ver datos del atleta | ✅ | ✅ | ✅ | ✅ | ✅ |
| Generar/editar plan (IA) | ✅ | ✅ | ✅ | ❌ | ✅ |
| Crear sesiones / propuestas | ✅ | ✅ | ✅ | ❌ | ✅ |
| Marcar sesión completada | ✅ | ✅* | ✅* | ❌ | ✅ |
| Gestionar relación (invitar/revocar) | ✅ | ✅ | ❌ | ❌ | ✅ (revocar) |
| Borrar atleta / transferir | ✅ | ❌ | ❌ | ❌ | ✅ (claim) |

\* El "completar" idealmente lo hace el atleta; el coach puede registrar a su nombre con auditoría.

### 4.3 Enforcement

- **Supabase RLS** como fuente de verdad de autorización (no confiar solo en el cliente):
  políticas que resuelven acceso vía `coach_athlete_link` (membresía activa) o propiedad.
- **Netlify functions**: `resolveAuthContext` se extiende a `resolveAthleteAccess(userId,
  athleteId)` que verifica membresía **antes** de escribir. Para escrituras de IA en
  nombre del atleta, evaluar service-role con check explícito de membresía (vs. token del
  coach + RLS permisiva).
- El cliente solo **filtra UI**; nunca es la barrera de seguridad.

---

## 5. Migraciones necesarias en Supabase

> Estrategia: **expand → backfill → contract**, sin downtime, compatible con clientes viejos.

### Fase de datos (orden)

1. **Crear tablas nuevas**: `athletes`, `coach_athlete_links`, (`accounts` si se formaliza
   el perfil de cuenta más allá de `auth.users`).
2. **Backfill de atletas individuales**: por cada `user_id` distinto en `athlete_profiles`,
   crear un `athlete` con `owner_account_id = linked_account_id = user_id`. Mapear el
   `'default'` local a ese `athlete.id`.
3. **Añadir `athlete_id` (nullable) a**: `sessions`, `day_logs`, `week_summaries`,
   `chat_messages`, `coach_proposals`, `athlete_profiles`, `training_plans` (ya tiene
   `athleteId`→normalizar), `training_plan_weeks`.
4. **Backfill `athlete_id`** desde el `user_id` de cada fila (1:1 hoy).
5. **RLS v2**: nuevas políticas basadas en propiedad + membresía. Mantener políticas
   viejas por `user_id` hasta que todos los clientes migren.
6. **Contract** (cuando el cliente nuevo es mayoría): `athlete_id` NOT NULL; deprecar
   políticas y dependencia de `user_id` como clave de propiedad.

### Riesgos de migración

- Dexie tiene **12 versiones**; el cambio local es una migración v13 que crea `athletes`,
  backfillea `'default'` y reescribe scope. **Requiere test de upgrade** (el proyecto ya
  trata schema-change con cuidado; ver `CLAUDE.md`).
- El bug histórico de "reset total" de sync (ya corregido) recuerda que **cualquier cambio
  de scope de sync es zona de alto riesgo de pérdida de datos** → feature-flag + dry-run.

> **Tensión con la beta privada (decisión 2026-06-22).** F1 toca a la vez `athlete_id`,
> Dexie, Supabase, RLS y sync — exactamente la zona de mayor riesgo de pérdida de datos, y
> coincide con la ventana en que se están invitando los primeros atletas del piloto. **No
> meter F1 completo mientras la beta privada está activa.** Lo que sí puede avanzar en
> paralelo es el desacople interno (ver §14.1 "Track Coach-ready foundation"), que es
> invisible para el atleta y no cambia el scope de datos. El re-scope real de sync
> (`user_id`→`athlete_id`) y RLS v2 solo se ejecutan **detrás de flag, con dry-run y backup
> verificado, en una ventana de migración controlada**, no durante una invitación activa.

---

## 6. Navegación / UX para entrenadores

```
Coach (account_type = coach)
├── Roster (lista de atletas)            ← pantalla nueva, home del coach
│     ├── filtro por estado/evento próximo/adherencia
│     └── card por atleta: próximo evento, % adherencia, alertas, último plan
├── Athlete Detail (= app actual, "vista como atleta X")
│     ├── Dashboard / WeeklyView / PlanBuilder / Chat   ← REUSO de las pantallas actuales
│     └── selector de "atleta activo" persistente en el header
├── Coach Inbox (propuestas/alertas agregadas de todos los atletas)
└── Settings del coach (invitaciones, equipo, branding futuro)

Atleta individual → experiencia idéntica a hoy (activeAthleteId implícito).
Atleta con coach → ve "Tu entrenador: X" + control de privacidad/revocar.
```

Principio UX: **el detalle de atleta reutiliza el 100% de las pantallas actuales**
operando sobre `activeAthleteId`. Lo nuevo es el **roster** y un **switcher de atleta**.

---

## 7. MVP del módulo entrenador

Objetivo del MVP: que un coach gestione **atletas sin login** y les genere planes con el
motor actual. Es el camino de menor fricción (no requiere onboarding del atleta).

**Incluye:**
- `account_type = coach` y pantalla **Roster**.
- Crear **atleta gestionado** (sin login): nombre + perfil + wizard config.
- **Switcher de atleta activo** → reuso de Dashboard/PlanBuilder/WeeklyView.
- Generar plan con Plan Builder **para el atleta activo** (motor sin cambios funcionales).
- Sync de los datos del atleta gestionado bajo el `owner_account_id` del coach.

**Excluye (MVP):** atletas con login propio, invitaciones/aceptación, roles múltiples,
mensajería coach↔atleta, wearables, facturación, branding.

---

## 8. Roadmap incremental (12 meses)

| Fase | Nombre | Contenido | Entregable | Complejidad |
|---|---|---|---|---|
| **F0** (mes 1–2) | Hardening previo | Resolver deuda técnica bloqueante (sección 11): latencia Plan Builder, UX async, desacoplar `'default'`. Sin UI de coach. | App individual más robusta + `athlete_id` first-class internamente | **L** |
| **F1** (mes 2–4) | Modelo de datos multi-atleta | Tablas `athletes`/`links`, migración Dexie v13, Supabase expand+backfill, RLS v2 detrás de flag. Atleta individual sin cambios visibles. | Datos re-scopeados a `athlete_id`, 0 cambios de UX | **XL** |
| **F2** (mes 4–6) | MVP Coach (atletas gestionados) | Roster, switcher, crear atleta sin login, generar plan. | Coach usable con atletas gestionados | **L** |
| **F3** (mes 6–9) | Cuentas vinculadas + colaboración | Invitaciones, atleta con login propio, roles (coach/assistant/viewer), inbox de propuestas, privacidad/revocar. | Coach↔atleta real, multi-tenant completo | **XL** |
| **F4** (mes 9–12) | Wearables + inteligencia de readiness | Whoop API (server), HealthKit (vía shell nativo), feed de recovery al loop coach. | Decisiones de carga informadas por datos biométricos | **L–XL** |

> Cada fase es desplegable y reversible por flag. F0 y F1 no exponen Coach Mode al usuario.

---

## 9. Integración futura con wearables (F4)

> **Excepción táctica: Whoop v1 previo a F4 (implementado en `011`, 2026-07-08).**
> Whoop ya entrega contexto pasivo —tarjeta, prefill editable del check-in y línea de
> readiness para el coach—, sin ajuste automático de carga ni webhooks. Las credenciales
> y datos crudos permanecen server-side; `readiness_daily` se asocia a `athlete_id` para
> que el modelo pueda evolucionar hacia membresías en SP1 sin mover los datos.

### 9.1 Modelo común

Nueva capa de ingesta normalizada → tabla `biometric_readings` (athlete_id, source,
metric, value, recorded_at) + un resumen diario `readiness_daily` que alimenta el
`recoveryProfile` y el loop coach (ajuste de RPE/volumen).

```
Whoop / HealthKit ──▶ ingest (normalize) ──▶ biometric_readings ──▶ readiness_daily
                                                                         │
                                                  Plan Builder / coach loop (ajuste de carga)
```

### 9.2 Whoop API

- **Patrón:** OAuth2 del atleta → **server-side** (Netlify function) hace polling +
  **webhooks** de Whoop. Tokens guardados cifrados, refresh server-side. **No** exponer
  secretos en `VITE_*`.
- Métricas: recovery score, HRV, RHR, strain, sleep.
- Complejidad: **M** (OAuth + webhook + normalización). Cuota/rate limits a respetar.

### 9.3 Apple HealthKit

- **Restricción dura:** HealthKit es **on-device iOS**; una PWA **no** accede a HealthKit.
  Requiere **shell nativo** (Capacitor o app nativa). Hoy el deploy es Netlify/web PWA →
  esto implica una decisión de plataforma previa.
- **Patrón:** lectura on-device → push de agregados (no datos crudos sensibles) al backend
  bajo el `athlete_id`. Consentimiento explícito y privacidad (datos de salud = sensibles).
- Complejidad: **L–XL** (depende de adoptar Capacitor). Si no hay app nativa en 12 meses,
  HealthKit queda como **import manual / Health Connect** y se prioriza Whoop.

---

## 10. Reutilización del motor de Plan Builder para atletas gestionados

El motor ya es agnóstico al dueño. Cambios necesarios, todos en los **bordes**:

1. **Entrada:** el store pasa el `profile` y `wizardConfig` del **atleta activo** (no el
   `'default'`). `buildPlanShell`/`runAsyncPlanGeneration` no cambian.
2. **Escritura:** el writer escribe bajo `athlete_id` del atleta gestionado, con
   `user_id`/`account_id` del coach como auditoría.
3. **Autorización:** `enqueue-plan-generation` y `generate-plan-background` verifican que
   `coach_account_id` tiene `coach_athlete_link` activo sobre `athlete_id` antes de generar.
4. **Dedupe/jobs:** `planGenerationJobs` y el dedupe activo ya usan `planId`/`athleteId` →
   compatible. Solo asegurar unicidad por atleta, no por usuario.
5. **Costo/cuotas IA:** introducir contabilidad por **coach** (un coach genera N planes).
   Hoy el costo es trivial por usuario; con coaches multiplicará → ver sección 11.

Conclusión: **el motor es el activo más barato de extender**. El costo está en datos y auth.

---

## 11. Riesgos técnicos y deuda a resolver ANTES del módulo

| # | Riesgo / deuda | Por qué bloquea Coach Mode | Acción (fase) |
|---|---|---|---|
| R1 | **Singleton `'default'` y scope por `user_id`** | Es el supuesto que Coach Mode rompe; tocarlo sin desacoplar primero = caos de datos. | Desacoplar `athlete_id` first-class (F0→F1). |
| R2 | **Sync scopeado a una sola cuenta** | No existe acceso compartido ni multi-atleta; reescribir scope es alto riesgo de pérdida de datos (hubo bug de reset total). | Re-scopear con flag + tests de upgrade (F1). |
| R3 | **Autorización solo "actúa como vos mismo"** | Un coach debe actuar sobre datos ajenos; no hay modelo de membresía ni RLS para ello. | RLS v2 + `resolveAthleteAccess` (F1/F3). |
| R4 | **Latencia y UX async de Plan Builder** (231s/plan, error al salir) | Con coaches generando varios planes, la latencia y el "polling fantasma" escalan el dolor. | Paralelizar + fix UX (F0; ya diagnosticado en sesión previa). |
| R5 | **Calidad del generador** (running ausente, sessionMode siempre drill, drills duplicados) | Un coach no tolera planes con defectos visibles; daña confianza del producto pro. | Fixes de generación (F0). |
| R6 | **Costo/cuotas IA sin contabilidad por cuenta** | Coaches multiplican el uso; sin límites/medición hay riesgo de costo. | Medición por coach + límites (F2). |
| R7 | **Plataforma web/PWA vs HealthKit** | HealthKit exige nativo; decidir Capacitor o no condiciona F4. | Decisión de plataforma (antes de F4). |
| R8 | **Datos de salud = sensibles (privacidad/legal)** | Wearables y datos de terceros (atletas) suben el listón de consentimiento y retención. | Política de privacidad + consentimiento (F3/F4). |
| R9 | **Tablas observabilidad local-only** (`aiRequestLogs`, `coachFeedback`) | Para soporte/calidad a escala coach conviene telemetría server, hoy no existe. | Evaluar persistencia remota acotada (F3+). |

---

## 12. Estimación de complejidad (consolidada)

| Bloque | Complejidad | Notas |
|---|:--:|---|
| F0 Hardening (latencia + calidad + desacople interno) | **L** | Bien acotado; ya diagnosticado. |
| Modelo de datos `athlete`/`links` + migración Dexie v13 | **L** | Riesgo medio por migración local. |
| Re-scope de sync `user_id`→`athlete_id` + RLS v2 | **XL** | El item más riesgoso de todo el RFC. |
| MVP Coach (roster, switcher, atleta gestionado) | **L** | Reusa pantallas; poco UI nueva. |
| Cuentas vinculadas + invitaciones + roles | **XL** | Multi-tenant real, estados, seguridad. |
| Reuso Plan Builder para gestionados | **S** | Solo bordes (entrada/escritura/auth). |
| Whoop API | **M** | OAuth + webhook server-side. |
| HealthKit | **L–XL** | Condicionado a shell nativo. |
| Inbox/colaboración coach↔atleta | **M** | Sobre `coach_proposals` existente. |

**Escala:** S ≤ ~3 días · M ≤ ~2 semanas · L ≤ ~1 mes · XL > 1 mes / requiere spike.

---

## 13. Decisiones abiertas (para resolver antes de F1)

1. **¿Atleta gestionado sin login en MVP, o exigir login del atleta desde el inicio?**
   Recomendado: sin login (menor fricción), con "claim" posterior.
2. **¿Adoptar Capacitor en el horizonte?** Define si HealthKit entra en F4 o se pospone.
3. **¿RLS con token del coach (políticas permisivas) o service-role + checks explícitos?**
   Recomendado: RLS como verdad + service-role solo en la background function con check de
   membresía.
4. **¿Monetización del coach (pricing por atleta gestionado)?** Fuera de alcance técnico,
   pero condiciona cuotas/medición (R6).

---

## 14. Recomendación de arranque

No empezar por la UI de coach. Empezar por **F0 (hardening)** y el **desacople interno de
`athlete_id`** (F1 sin UI): es invisible para el usuario actual, reduce el riesgo del item
XL (re-scope de sync) y deja el motor listo. La UI de coach (F2) recién cuando el modelo
de datos multi-atleta esté en producción y estable detrás de flag.

### 14.1 Track "Coach-ready foundation" (paralelo a la beta privada)

Coach Mode y la beta privada **son compatibles**, siempre que el track de Coach Mode sea
**trabajo invisible de arquitectura** que no cambie la experiencia del atleta actual ni
ponga en riesgo sus datos. La beta enseña qué necesita un jugador real; esta fundación
prepara la venta posterior a entrenadores. Mientras la beta esté activa, avanzar **solo**
este subconjunto de F0/F1, en este orden (cada paso es reversible y sin cambio de scope de
datos):

1. **Auditar y encapsular todos los usos de `id: 'default'`** (hoy cableado en
   `syncService`, `syncUtils`, stores). Inventario completo antes de tocar nada.
2. **Introducir `getActiveAthleteId()`** como única fuente de verdad, manteniendo
   `'default'` por debajo. Reemplazar los accesos directos por el helper sin cambiar el
   valor que devuelve.
3. **Preparar tipos y stores para `activeAthleteId`** (en `useAuthStore`/training store),
   **sin roster ni switcher visibles**. El atleta individual nunca ve un selector.
4. **Tests de migración Dexie y de sync ANTES de tocar datos reales** — el upgrade v13 y
   el re-scope deben tener cobertura de upgrade y un dry-run reproducible antes de correr
   contra datos de la beta.
5. **Plan Builder / background jobs pasan `athleteId` explícito** en todos los bordes
   (entrada del store, writer, enqueue/background) — el motor ya lo acepta (§1.5, §10);
   se trata de dejar de inyectar `'default'` implícito.
6. **Recién después: diseñar tablas `athletes` / `coach_athlete_links` detrás de flag**,
   sin activarlas en producción de la beta.

**Qué NO hacer durante la beta privada** (esperar a una ventana de migración controlada,
fuera de una invitación activa):

- RLS v2 completa (políticas por membresía).
- Multi-atleta visible (roster, switcher, "vista como atleta X").
- Invitaciones, aceptación, roles (coach/assistant/viewer).
- Roster real o cuentas de coach (`account_type = coach`) en producción.
- Re-scope masivo de sync `user_id`→`athlete_id` sin flag + dry-run + backup verificado.

Resultado: al terminar la beta, el desacople interno está hecho y testeado, y F1 "duro"
(re-scope + RLS v2) queda como un paso acotado y de bajo riesgo en una ventana dedicada —
no como una reescritura corriendo sobre datos de usuarios activos.

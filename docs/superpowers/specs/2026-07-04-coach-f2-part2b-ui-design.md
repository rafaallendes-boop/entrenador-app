# Coach UI F2-lite Parte 2b — Switcher, Roster y Multi-Atleta Operativo (diseño)

Fecha: 2026-07-04
Estado: aprobado en brainstorming (2 rondas de review de diseño incorporadas)
Base: spec F2-lite `2026-07-02-coach-ui-f2-mvp-design.md` (§3.1, §3.3, §3.5, §3.6, §3.7) + Parte 2a
implementada (`6ba0cd0` + `51b3d54`, smoke prod OK, `009a/b/c` aplicadas).

## 1. Objetivo y alcance

Hacer **operable** la capa de datos de la Parte 2a: la cuenta coach (allowlisted) puede crear
atletas gestionados, cambiar entre ellos y operar la app completa (perfil, plan, check-ins, chat)
como cada atleta, sin contaminar datos. Incluye la migración `010` (contract de
`day_logs`/`week_summaries`) para habilitar check-ins multi-atleta reales — decisión del owner:
entra en 2b, no se difiere.

**Fuera de alcance** (igual que el spec F2-lite §8): `coach_athlete_links`, `account_type`,
atletas con login propio, RLS v2 por membresía, métricas de adherencia/inbox, borrado de atletas.

## 2. Gating por allowlist (UI-only)

- `VITE_COACH_ACCOUNTS`: emails separados por coma (env de Netlify). Helper `isCoachAccount(user)`
  en `src/services/athlete/coachAccess.ts` (nuevo). Default vacío → nadie ve superficie coach →
  deploy seguro en cualquier momento.
- Gate de UI, no de seguridad: la barrera real sigue siendo la RLS por `user_id`.
- **Bootstrap con solo self:** la superficie coach es visible para cuentas allowlisted aunque solo
  exista el atleta self — sin esto no habría puerta para crear el primer gestionado.
- Test guard: usuario fuera de allowlist no renderiza `CoachContextBar` ni `/coach` (redirect a
  HOME si entra manualmente).

## 3. `switchActiveAthlete` + switch epoch (el corazón del cambio)

### 3.1 Switch epoch — guard común para promesas tardías

Primitivo nuevo en `activeAthlete.ts` (holder): contador `switchEpoch` con `getSwitchEpoch()` y
`bumpSwitchEpoch()`. Toda operación async que escriba estado o datos scoped captura el epoch (y/o
el `activeAthleteId`) al inicio y **valida antes de aplicar** (antes de cada `set()` de store y
antes de cada write estampado). Si el epoch cambió → descartar, no escribir.

Vectores verificados que este guard cierra:

- **`acceptProposal` in-flight** (`useCoachActionsStore.ts:541,563`): crea sesiones vía
  `addSession`, que estampa con `withActiveAthleteStamp` = atleta activo *al momento del write*.
  Un switch a mitad del accept estamparía la sesión bajo el atleta nuevo. Fix: capturar
  epoch+athleteId al inicio del accept; si cambió antes de aplicar → abortar el accept (la
  proposal queda pending). Limpiar `activeAcceptProposalPromises` en el reset NO alcanza por sí
  solo — el guard es lo que corta la promesa ya corriendo.
- **Generación local/híbrida de planes** (`generationJobRunner.ts` — `runningJobs` de módulo;
  `usePlanBuilderStore.ts:90`): `generationPollingController.abort()` cubre el poll remoto, pero
  los callbacks de `runPlanGenerationJob` siguen ejecutando y escriben estado del store tras el
  switch. Fix: envolver los callbacks del store con el guard de epoch (no-op si cambió). Los
  writes a Dexie del job van keyed por plan/atleta original — el riesgo es estado de UI.
- **Loads async no abortables:** `loadHistory` (chat) y `loadProposals` no tienen request-id
  propio → se les agrega (o usan el epoch). `loadWeek`/`loadAllSummaries`
  (`useTrainingStore.ts:44-45`), `loadMemory` (`useCoachMemoryStore.ts:24`) ya tienen request-id
  de módulo → el reset los bumpea.

### 3.2 `resetForAthleteSwitch()` por store

Cada store afectado expone un API explícito de teardown, llamado por `switchActiveAthlete`
**antes** de mover el holder:

- `useChatStore`: `activeChatAbortController.abort()` + invalidar `loadHistory` + limpiar estado.
- `usePlanBuilderStore`: `generationPollingController.abort()` + reset de estado (el job local
  queda guardado por epoch, ver 3.1).
- `useTrainingStore`: bump de `latestWeekLoadRequestId`/`latestAllSummariesLoadRequestId` + reset.
- `useCoachActionsStore`: limpiar `activeAcceptProposalPromises` + reset (más el guard 3.1).
- `useCoachMemoryStore`: bump de `latestMemoryLoadRequestId` + limpiar `athleteProfile`/
  `coachMemory` cacheados (alimentan Dashboard/Chat/Settings/PlanBuilder — sin esto el perfil del
  atleta anterior sobrevive el switch).

### 3.3 Secuencia de `switchActiveAthlete(id)` (acción en `useAuthStore`)

1. Validar target contra `db.athletes` (existe, `status: 'active'`, owner correcto); inválido → no-op.
2. `bumpSwitchEpoch()`.
3. `resetForAthleteSwitch()` de todos los stores (3.2).
4. Persistir selección (`persistAthleteSelection`); al volver al **self** limpia la selección
   (null) → el path single-athlete queda prístino.
5. `setActiveAthleteId` (holder) + `useAuthStore.setActiveAthleteId` (Zustand).
6. Remount coordinado: `key={activeAthleteId}` en el subtree autenticado dentro de `AppShell` —
   las páginas releen Dexie con los lookups scoped de la Parte 1. El remount es la **segunda**
   red; el teardown explícito es la primera.

## 4. UI: `CoachContextBar` (adaptación del "header switcher")

No existe header global (`AppShell.tsx` = `<main>` + `BottomNav`; cada página renderiza su
header). `AppShell` renderiza `CoachContextBar` (nuevo) **siempre que `isCoachAccount`**:

- **Self activo:** pill discreto `[👤 Tú ▾]`; dropdown con atletas (`listOwnedAthletes`, self =
  "Tú") + "Gestionar atletas" → `/coach`. Visible aunque solo exista self (bootstrap, §2).
- **Gestionado activo:** banner persistente naranja `⚡ Entrenando a <nombre> · Volver a ti`
  (un tap ejecuta switch al self). Señal de contexto imposible de ignorar.
- Cuenta no-coach: retorna `null` — cero impacto en la app del atleta.
- `BottomNav` no cambia.

## 5. Roster `/coach`

- Reemplaza el redirect legacy `/coach → CHAT` (`App.tsx:313`; inofensivo, único usuario).
  `ROUTES.COACH` nuevo. Gated por `isCoachAccount`: no-coach → `Navigate` a HOME.
- Card por atleta: nombre (`displayName`, self = "Tú"), marcador de activo, botón
  "Entrenar como este atleta" (switch). Con solo self: card propia + "Crear atleta" como acción
  principal.
- "Crear atleta": modal con solo nombre → `createManagedAthlete` (2a) → switch automático al
  nuevo atleta → nudge a completar su perfil vía onboarding (§6).
- Lenguaje humano en español.

## 6. Onboarding athlete-aware

- **Skip key por atleta:** `buildKey(userId, athleteId?)` en `utils/onboarding.ts` — hoy es solo
  por `userId` (`onboarding.ts:6-8`), y un coach que saltó su propio onboarding dejaría al
  gestionado nuevo sin flujo. Sin atleta activo (o self) → key actual, compat con el flag ya
  persistido.
- **El flujo "completar perfil" post-crear usa onboarding** (los 5 pasos son exactamente los
  datos de un gestionado; desde 2a `upsertAthleteProfile` escribe al perfil del atleta activo).
  Alternativa descartada: mandar a Settings — pierde el flujo guiado donde más se necesita.
- `/onboarding` está fuera de `AppShell` (`App.tsx:303`) → sin `CoachContextBar`. Fix:
  `OnboardingPage` muestra contexto propio cuando hay gestionado activo — título
  "Perfil de <nombre>" en paso 1 (en vez de "Cuéntame quién eres") + chip de atleta activo.

## 7. Migración `010` — day/week expand/contract (patrón 009)

Los uniques legacy `(user_id, date)` / `(user_id, week_start_date)` siguen vivos (008b fue
aditivo) y `migrateLocalDataToCloud` los usa como `onConflict` (`syncService.ts:3436-3437`). Con
dos atletas, el segundo check-in de una misma fecha choca `23505`.

- **`010a` preflight (report-only):** duplicados `(athlete_id, date)` / `(athlete_id,
  week_start_date)`, null debt de `athlete_id`, **y descubrimiento de los nombres reales de los
  uniques legacy** vía `pg_indexes`/`pg_constraint` (el schema pre-007 fue manual; los nombres no
  están en el repo — no hardcodear).
- **`010b` expand:** guard (null debt = 0, dups = 0) → `athlete_id set not null` en ambas tablas
  + uniques compuestos **completos** `(athlete_id, date)` / `(athlete_id, week_start_date)`.
  Nota técnica: los índices parciales de 008b no sirven como target de `onConflict` de PostgREST
  (no infiere índices parciales) — por eso el full unique.
- **Cliente:** `migrateLocalDataToCloud` cambia a `onConflict: 'athlete_id,date'` /
  `'athlete_id,week_start_date'`. El path normal de escritura no cambia (upsert por PK +
  reconciliador reactivo `23505`, que sigue cubriendo la clave por atleta).
- **`010c` contract:** drop de los uniques legacy (por descubrimiento dinámico en DO block, no
  por nombre asumido) + drop de los parciales 008b (redundantes con el full unique). Guard:
  verifica que el full unique de 010b existe antes de dropear nada.

## 8. Manejo de errores / seguridad de datos

- Switch con datos sin sincronizar: seguro — la cola scopea por fila (verificado en 2a).
- Selección corrupta/huérfana → fallback self + limpieza (ya implementado, `hydrateActiveAthlete`).
- Sin borrado de atletas; `status` es el único ciclo de vida.
- Regla dura vigente (Parte 1, con tests): un gestionado **nunca** ve ni adopta filas legacy.
- Accept/generación interrumpidos por switch: la operación se descarta limpia (proposal queda
  pending; el job local sigue escribiendo Dexie bajo su atleta original, solo la UI lo suelta).

## 9. Testing

**Orden: los tests de contaminación van primero, antes de tocar UI.**

Contaminación por switch (nuevos, con el epoch guard):
- `acceptProposal` in-flight + switch → la sesión NO se crea bajo el atleta nuevo; proposal pending.
- Callback tardío de generación local de plan + switch → no escribe estado del store.
- `loadMemory`/`loadProposals`/`loadHistory`/`loadWeek` tardíos + switch → responses descartadas.
- `useCoachMemoryStore` reseteado en switch → sin perfil del atleta anterior cacheado.

Gating y UI:
- No-coach: no renderiza `CoachContextBar`; `/coach` manual → redirect HOME.
- Coach allowlisted con solo self: ve acceso a `/coach` y puede crear el primer gestionado.
- Switch al self limpia la selección persistida; a gestionado la persiste.

Onboarding:
- Skip por atleta, no por cuenta (skip del self no bloquea onboarding del gestionado).

Sync/SQL:
- `migrateLocalDataToCloud` usa `onConflict: 'athlete_id,date'` / `'athlete_id,week_start_date'`
  con payloads estampados (`athlete_id` no-null).
- Canónico existente que debe seguir verde: "managed athlete activo no ve legacy self rows".
- SQL: aplicación manual con preflight (no testeable en vitest).

## 10. Rollout (orden estricto)

1. Confirmar bundle 2a estable en prod (sin PWA stale escribiendo sin `athlete_id`).
2. `010a` preflight → resolver deuda si aparece (backfill manual).
3. `010b` expand (NOT NULL + full uniques).
4. Deploy bundle 2b (allowlist configurada en Netlify) → confirmar bundle nuevo (hard refresh).
5. `010c` contract (drop legacy dinámico + parciales 008b).
6. Smoke: crear gestionado desde `/coach` → onboarding → plan → check-in en la misma fecha que
   un check-in del self → sin `23505`; volver a ti → todo el estado propio intacto.

## 11. Decisiones cerradas (owner)

- UI: **switcher en barra de contexto + hub `/coach`** (no selector de acceso al inicio, no tab
  en BottomNav) — el uso real es mixto en una misma sesión y el self es el caso dominante.
- `010` **entra en 2b** (multi-atleta 100% operativo en una iteración).
- Onboarding (no Settings) como flujo de "completar perfil" del gestionado.
- Reemplazar el redirect legacy `/coach → chat`.

# Coach UI F2-lite — Diseño (rev. 3)

**Fecha:** 2026-07-02 (rev. 3 tras segunda ronda de review del owner)
**Estado:** Alcance aprobado conceptualmente. Rev. 2 incorporó los 4 hallazgos de la
primera ronda (perfiles singleton en sync, lecturas sin scope, hidratación vs switcher,
API de atleta gestionado) + rollout 009 como mini expand/contract. Rev. 3 agrega:
ensure remoto del gestionado antes de child rows (FK `23503`), política legacy
self-only (un gestionado nunca adopta filas legacy), chat session athlete-scoped, y
preflight 009 como gate duro del contract.
**Base estratégica:** `docs/rfc/2026-06-16-coach-mode-architecture.md` §6–§7 (MVP Coach)
**Fundación previa:** `docs/superpowers/specs/2026-06-22-athlete-scope-foundation-design.md`
(completa), F2 data prereqs (`6e33926`, Dexie v14), write path 008b (implementado, rollout
pendiente)

## 0. Tesis del alcance (corregida)

**F2-lite NO es "agregar roster + switcher".** Es: **hacer athlete-aware los perfiles, las
lecturas de sessions/summaries, chat/proposals/contexto IA y la selección activa** — y
recién encima de eso, roster y switcher. Day logs y week summaries ya quedaron
athlete-aware en los prereqs (v14); el resto de la superficie de lectura todavía asume un
solo atleta (ver §3.6) y el pipeline de perfiles sigue siendo singleton de punta a punta
(ver §3.2).

## 1. Precondición dura: cerrar el rollout 008b primero

Antes de cualquier UI multi-atleta que escriba datos:

1. Commit (owner) del handler `reconcileNaturalKeyConflict` + tests + `008b.sql`.
2. Deploy y confirmación de bundle nuevo (bump de cache del SW si aplica).
3. Re-correr `008a` → 0 duplicados.
4. Aplicar `008b` (índices únicos parciales remotos).
5. Smoke: crear/editar day log y week summary sin `23505`.

## 2. Decisión de alcance (aprobada)

**Usuario coach del corto plazo: Rafael, operando el piloto premium.** No coaches externos.

- **Atletas gestionados sin login** (`owner_account_id = coach`, `linked_account_id = NULL`).
- **`coach_athlete_links` sigue diferida.** La propiedad basta; la RLS existente la cubre.
- **Sin `account_type` en DB.** Gating de UI por allowlist de cuentas (§3.1).
- **Clientes fundadores con cuenta propia NO se ven desde esta UI** (requiere membresía +
  RLS v2 = F3). Su revisión sigue siendo 1:1/export durante el piloto.

Valor inmediato adicional: los **3 planes arquetipo** del roadmap (sección D) se generan
como atletas gestionados separados, sin contaminar los datos reales del owner.

**Qué NO es:** invitaciones, cuentas vinculadas, roles, coach inbox, métricas de adherencia
en roster, `account_type`, RLS nueva, borrado de atletas.

## 3. Arquitectura

### 3.1 Gating (UI-only)

- `VITE_COACH_ACCOUNTS` — emails separados por coma. Helper `isCoachAccount(user)` en
  `src/services/athlete/coachAccess.ts`. Default vacío → nadie ve la UI de coach.
- Gate de **UI**, no de seguridad: la barrera real es la RLS de propiedad existente (datos
  de gestionados viven bajo `user_id` del coach + `athlete_id` del gestionado).
- Test guard: usuario fuera de la allowlist no renderiza ninguna superficie coach.

### 3.2 Perfiles por atleta — el pipeline completo, no solo el índice

Estado real verificado (2026-07-02): el pipeline de perfiles es singleton en **cuatro**
capas, todas deben cambiar juntas:

1. **UI/local:** `getAthleteProfile()` (`src/db/queries.ts:298`) lee `'default'`
   incondicional → pasa a resolver por atleta activo: self/sin atleta → `'default'`
   (compat); gestionado → fila con `athleteId = activeAthleteId` (índice v13), id local =
   el propio `athleteId`. Se crea al guardar el primer perfil.
2. **Push:** `athleteProfileToRow` (`syncUtils.ts:345`) descarta el id local y genera
   siempre `profile:${userId}` → el id remoto pasa a ser **por atleta**
   (`profile:${userId}:${athleteId}` para gestionados; el legacy `profile:${userId}` se
   mantiene para el self, evitando migrar la fila existente). `pushAthleteProfile` deja de
   asumir una única fila por usuario.
3. **Merge:** `mergeAthleteProfile` (`syncService.ts:2513`) coalescea TODAS las filas
   remotas y escribe siempre en `'default'` local → pasa a agrupar por **effective athlete
   key** y persistir/reparar por atleta: la fila del self (o legacy sin `athlete_id`)
   converge a `'default'`; cada gestionado converge a su fila local propia. El
   profile-reset-lock y el coalesce de duplicados operan **dentro de cada grupo**, no
   globalmente.
4. **Bulk migrate:** `migrateLocalDataToCloud` coalescea perfiles **por atleta**, no por
   usuario (hoy colapsaría los perfiles de gestionados en uno).

**Migración `009` (mini expand/contract, gate propio):**

- **Preflight como gate, no solo informe** (a diferencia de `008a`): `athlete_id` null = 0
  **y** duplicados `(user_id, athlete_id)` = 0 son precondición dura del contract. Un
  unique de Postgres con columna nullable **no** deduplica múltiples NULLs, así que la
  deuda null debe ser 0 antes de dropear el unique viejo (reforzar con DO-guard en el SQL
  del contract, como en `008b`).
- **Expand:** crear UNIQUE compuesto `(user_id, athlete_id)`. El unique viejo
  `athlete_profiles_user_id_unique` sigue vivo.
- **Deploy** del cliente nuevo (push por atleta con `onConflict: 'user_id,athlete_id'`) y
  **confirmación de bundle** (mismo riesgo PWA-stale que 008b: un cliente viejo con
  `onConflict: 'user_id'` rompe tras el contract).
- **Contract:** drop del unique viejo.
- **Gate de habilitación:** crear el **segundo** perfil (primer gestionado) sigue chocando
  con el unique viejo durante la ventana expand→contract. La creación de atletas
  gestionados en la UI queda **deshabilitada hasta post-contract** (mismo flag de allowlist
  + check documentado en el plan; operacionalmente: no crear gestionados hasta cerrar 009).
- Smoke: guardar perfil self + crear gestionado + editar ambos sin `23505`.

### 3.3 Selección activa: hidratación selection-aware

Estado real verificado: `hydrateActiveAthlete` (`hydrateActiveAthlete.ts:13`) siempre
resuelve el self determinístico `ath_<owner>`, y lo llaman `pullAthletes` en **cada full
sync** (`syncService.ts:2108`) y `ensureRemoteAthleteOnce` (`syncService.ts:1863`). Sin
cambio, un sync en background resetearía el switcher al self.

- **Persistencia de selección:** `localStorage: entrenador_active_athlete:<owner>` escrita
  por `switchActiveAthlete(id)` (acción nueva en `useAuthStore` que envuelve
  `setActiveAthlete`).
- **`hydrateActiveAthlete` pasa a ser selection-aware:** lee la selección persistida,
  la valida contra `db.athletes` (existente + `status: 'active'` + owner correcto); si es
  válida la respeta (módulo holder + Zustand); si no, fallback al self determinístico y
  limpia la selección.
- **`pullAthletes`/`ensureRemoteAthlete` no pisan una selección válida:** re-hidratar solo
  confirma/repara; nunca sobreescribe una selección válida por el self.
- Sin selección persistida → comportamiento actual intacto (self), atleta individual jamás
  afectado.

### 3.4 API de atleta gestionado

No existe hoy ningún camino público para crear/pushear atletas (el único upsert vive en
`ensureRemoteAthleteOnce`, solo self). Servicio nuevo
`src/services/athlete/managedAthletes.ts`:

- `createManagedAthlete(displayName): Promise<Athlete>` — genera `id` text client-side
  (prefijo `ath_m_` + uuid), `owner_account_id = coach`, `linked_account_id = null`,
  `status: 'active'`; persiste en Dexie `athletes` y encola el push.
- `pushAthlete(athlete)` en `syncService` — upsert remoto `onConflict: 'id'`, integrado a
  la cola offline con **semántica Tier A** (mismo tratamiento de retry/drenado que
  `athletes` ya tiene en el pull: primero). Reusa el patrón de `pushSession`/cola actual,
  no el upsert inline de `ensureRemoteAthleteOnce`.
- `listOwnedAthletes(ownerAccountId)` — lectura local para roster/switcher.
- Sin borrado; `status` como único ciclo de vida (MVP: siempre `'active'`).

**Bloqueante verificado — asegurar el atleta gestionado remoto antes de los child rows:**
`upsertRow` hoy solo asegura el self (`ensureRemoteAthlete(userId)`, `syncService.ts:1158`
→ `ensureRemoteAthleteOnce` crea `ath_<owner>`), y el FK `athlete_id → athletes(id)` de
`007` (creado `not valid`) **sí aplica a escrituras nuevas**: un day log/session/profile de
`ath_m_x` pusheado antes de que exista la fila remota del gestionado da `23503`.

- `ensureRemoteAthlete(userId, athleteId?)`: cuando el `athlete_id` del payload es un
  gestionado (≠ self determinístico), lee `db.athletes.get(athleteId)` y upsertea **esa**
  fila remota antes del child row (cacheado por id, como el ensure actual por usuario).
- Si el atleta no existe localmente → no escribir el child: falla/encola por el path
  retriable normal (nunca un child row huérfano ni un ensure inventando la fila).
- Test: crear gestionado (online y offline) y guardar day log/profile inmediatamente → sin
  `23503`, sin dependencia del orden de promises entre `pushAthlete` y el child push.

### 3.5 Switcher y ciclo de vida (frontend)

- **Remount coordinado:** subtree autenticado con `key={activeAthleteId}` — cambiar de
  atleta desmonta/remonta Dashboard/WeeklyView/PlanBuilder/Chat, que releen Dexie con los
  lookups scoped. Local-first → remount instantáneo.
- **Reset explícito de stores** en `switchActiveAthlete` para los que cachean fuera del
  ciclo de mount (auditoría en §3.6): `useTrainingStore`, `useChatStore`,
  `usePlanBuilderStore`, `useCoachActionsStore`, `useCoachMemoryStore`.
- **UI del switcher:** header autenticado, visible solo si `isCoachAccount` y hay >1
  atleta. Nombre del atleta activo (self = "Tú"); dropdown + "Gestionar atletas" → roster.

### 3.6 Auditoría y scoping de lecturas (task explícita, previa a la UI)

Estado real verificado: **no todas las pantallas operan sobre `activeAthleteId`**. Solo
day logs / week summaries por clave natural quedaron athlete-aware en v14.

**Política legacy/unscoped (corrige la semántica de transición):** `isInAthleteScope` hoy
adopta filas legacy bajo **cualquier** atleta activo — correcto en single-athlete, pero en
multi-atleta un gestionado sin datos propios "adoptaría" las filas legacy del owner.
Regla para F2-lite: **legacy/unscoped solo se adopta cuando el atleta activo es el self**
(o durante backfill controlado); **un gestionado nunca ve ni adopta filas legacy/null**.
Esto aplica a los lookups v14 existentes (day logs / week summaries: su fallback de
adopción se condiciona al self) y a todo scoping nuevo de esta sección. Test canónico:
"managed athlete activo no ve legacy self rows".

Pendiente de scoping (filas del atleta activo; legacy adoptable solo si activo = self):

- **Sessions:** `getSessionsForWeek` / `getSessionsForDay` (`queries.ts:23`),
  `getHistoricalSessionsWindow` (`queries.ts:277`), `getMatchSessions` (`queries.ts:288`).
  `sessions` tiene índice `athleteId` (v13) pero ninguna lectura lo usa.
- **Week summaries agregadas:** `getAllWeekSummaries` (`queries.ts:274`) devuelve todo.
- **Coach proposals / contexto IA:** `useCoachActionsStore.loadProposals` carga todas las
  propuestas y `addProposal` usa `db.sessions.toArray()` global
  (`useCoachActionsStore.ts:50`). Auditar también `useCoachMemoryStore` y todo contexto
  que alimente `promptBuilder` / weekCreator / weeklyActionLoop con historiales.
- **Chat:** el storage key de sesión es global (`CHAT_SESSION_KEY =
  'coach_chat_session_id'`, `chatSession.ts:3`) → **decisión (owner): la sesión se vuelve
  athlete-scoped por key** (`coach_chat_session_id:<athleteId>`; sin atleta activo → key
  legacy actual, compat). Más simple mentalmente que filtrar `loadHistory` y evita estados
  raros al switchear. Sin esto, el hilo del coach IA mezcla atletas.
- **Entregable de la task:** inventario grep de `db.sessions`, `db.weekSummaries`,
  `db.coachProposals`, `db.chatMessages` fuera de sync, clasificado en
  "scope requerido" / "intencionalmente global" (p.ej. export/backup, que debe seguir
  siendo por cuenta completa), con fix + test por cada lectura scoped.
- Nota deliberada: **sessions NO cambia de clave natural** (sin unique compuesto); solo se
  scopean las lecturas. El riesgo de índices únicos ya se pagó en v14 donde correspondía.

### 3.7 Roster (`/coach`)

- Ruta autenticada nueva, gated por `isCoachAccount`; entrada de menú solo coach.
- Lista desde `listOwnedAthletes`: card por atleta con `display_name`, marcador de activo,
  "Entrenar como este atleta" (switch). Self = "Tú".
- "Crear atleta": modal con `display_name` (único obligatorio). Tras crear → ir al perfil
  (Settings/onboarding sobre el atleta activo) antes de generar plan. Deshabilitado hasta
  post-contract 009 (§3.2).
- Sin métricas de adherencia/alertas (F2 completo / F3). Lenguaje humano en ES (roadmap F).

### 3.8 Motor / Plan Builder

`usePlanBuilderStore` ya resuelve `getActiveAthleteId() ?? ATHLETE_PROFILE_LOCAL_ID`
(`usePlanBuilderStore.ts:429`) y el motor está parametrizado. Con perfil por atleta (§3.2)
y contexto scoped (§3.6), el wizard opera sobre el gestionado. Verificar en el plan:
`planGenerationJobs`/dedupe por `athleteId` con test (RFC §10.4 lo da por compatible).

### 3.9 Sync — sin flag nuevo de datos

`VITE_ATHLETE_SCOPE` puede seguir **off**: el pull legacy por `user_id` trae todas las
filas del coach (incluidas las de gestionados) y los merges athlete-aware + claves
compuestas locales (v14) + merge de perfiles por grupo (§3.2) las separan por atleta. No se
necesita read-scope remoto por atleta para este MVP.

## 4. Manejo de errores / seguridad de datos

- Crear atleta: escritura local + push encolado Tier A; offline se drena normal.
- Switch con datos sin sincronizar: seguro — la cola scopea por fila, no por atleta activo.
- Sin borrado de atletas (elimina la clase de errores destructivos).
- Guard de hidratación intacto: sin fila `athlete` → scope legacy.
- Selección persistida corrupta/huérfana → fallback self + limpieza (nunca un
  `activeAthleteId` que no exista en `athletes`).

## 5. Testing

- `isCoachAccount`: allowlist vacía → false; email presente → true; case-insensitive.
- Guard de superficie: cuenta no-coach no renderiza roster/switcher.
- Perfiles: self → `'default'`; gestionado → fila por `athleteId`; crear-si-falta; push con
  id remoto por atleta; merge agrupado por effective key (self converge a `'default'`,
  gestionado a su fila; reset-lock y dedup dentro del grupo); `migrateLocalDataToCloud`
  coalescea por atleta. Dexie real (fake-indexeddb, patrón de aislamiento del plan F2).
- Hidratación selection-aware: selección válida respetada tras `pullAthletes`; inválida →
  fallback self + limpieza; sin selección → self (regresión individual).
- `createManagedAthlete`: fila local correcta + push encolado (mock supabase) + offline.
- Ensure de gestionados: crear gestionado y guardar day log/profile inmediato (online y
  offline) → sin `23503`, sin depender del orden de promises (§3.4).
- Scoping de lecturas: por cada lectura de §3.6, "atleta A no ve datos de atleta B";
  política legacy: "self activo adopta legacy" y "managed activo NO ve ni adopta legacy"
  (incluye los fallbacks v14 existentes de day logs / week summaries).
- Chat: al switchear de atleta, el hilo no mezcla mensajes de otro atleta (§3.6).
- Switch: reset de stores auditados; remount por key.
- Regresión: usuario individual no-coach — comportamiento idéntico en toda la suite.
- Cierre: `npm run lint && npm test && npm run build` verdes.

## 6. Enfoques considerados

- **A (elegido): F2-lite gated por allowlist**, redefinido como "athlete-aware primero, UI
  después" (§0). Riesgo contenido, reusa fundación v13/v14.
- **B: F2 completo del RFC** (account_type, adherencia, inbox): más superficie sin
  necesidad para 1–3 pilotos; diferido.
- **C: No hacer UI todavía**: cero costo, pero la QA de planes arquetipo contamina los
  datos del owner y no avanza Coach Mode.

## 7. Secuencia recomendada

1. Rollout 008b (§1) — operacional, sin código nuevo.
2. Este spec → plan de implementación (writing-plans). Orden interno sugerido del plan:
   auditoría/scoping de lecturas (§3.6) → selección activa (§3.3) → perfiles + 009 (§3.2,
   gate propio) → API gestionados (§3.4) → switcher/roster (§3.5, §3.7).
3. Después del MVP: 3 planes arquetipo como atletas gestionados (roadmap D).

## 8. Fuera de alcance explícito

Invitaciones y aceptación; atleta con login propio visible para el coach; roles y
`coach_athlete_links`; `account_type` en DB; RLS v2 por membresía; coach inbox; métricas de
adherencia en roster; borrado/archivado de atletas; contabilidad de cuotas IA por coach;
cambio de clave natural de `sessions`; read-scope remoto por atleta; Whoop (v15, diferido).

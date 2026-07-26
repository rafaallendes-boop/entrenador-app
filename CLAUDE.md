# Entrenador App (RallyIQ) — CLAUDE.md

## Proyecto
App web de entrenamiento para squash, running y fuerza. Marca pública: **RallyIQ**.
Stack: React + TypeScript + Vite + Tailwind + Dexie (local-first) + Supabase (sync) + Google OAuth.
Deploy en Netlify. Usuario principal: Rafael Allendes (squash competitivo, masters).
Etapa: preparando piloto premium acompañado (1-3 clientes fundadores). Coach Mode F2-lite y Coach Workspace ya operativos; los bloqueantes restantes son legales/operacionales, no de core.

## Comandos clave
- Dev: `./start.sh` o `npm run dev`
- Lint: `npm run lint`
- Tests: `npm test`
- Build: `npm run build`
- Antes de commitear: `npm run lint && npm test && npm run build`

## Arquitectura
- `src/pages/` — vistas principales
- `src/services/` — lógica de negocio (AI, sync, notificaciones, PDF, export)
- `src/services/athlete/` — athlete scope: `activeAthlete.ts` (holders active/self), `activeScopeFilter.ts` (política de lectura + estampado), `athleteSelection.ts`, `hydrateActiveAthlete.ts`, `effectiveAthleteKey.ts`, `readScope.ts`
- `src/services/athlete/` (coach): `coachScopedReads.ts` / `coachScopedWrites.ts` (lectura/escritura por atleta explícito sin cambiar scope activo), `coachPlanningHydration.ts`, `sessionTemplates.ts` + `sessionTemplateSerializer.ts` (Biblioteca), `managedAthletes.ts`, `switchActiveAthlete.ts`, `membershipCache.ts` / `claimGate.ts` (two-sided)
- `src/services/training/` — librerías curadas de drills/ejercicios + `coachExerciseCatalog.ts` (catálogo unificado para el picker del coach)
- `src/store/` — estado global con Zustand
- `src/types/` — tipos compartidos
- `src/utils/` — helpers
- `src/services/ai/promptBuilder.ts` — prompt del coach IA (tocar con cuidado)
- `public/sw.js` — service worker para notificaciones
- `supabase/00X_*.sql` — migraciones remotas numeradas, de aplicación manual

## Estado actual del producto
Ver `PROJECT_REVIEW_AND_ROADMAP.md` para el estado completo. Actualizado: 2026-07-25.
Suite: 298 archivos / 2162 tests. `npm test` y lint OK.
Migraciones remotas aplicadas hasta `016`. Dexie local en **v18**.
El chunk más pesado es `pdf.worker.min` — ya optimizado, no tocar sin razón.

Bloques recientes relevantes:
- **Athlete scope foundation** (`007`): tabla `athletes`, `athlete_id` backfilleado, hidratación de atleta activo, flag `VITE_ATHLETE_SCOPE` (off).
- **F2 data prereqs**: Dexie v14 con únicos compuestos `[athleteId+date]` / `[athleteId+weekStartDate]`; merges/import/export athlete-aware.
- **008b write path**: handler reactivo de `23505` (`reconcileNaturalKeyConflict`) aplicado en prod; mantener `008a` como preflight operativo antes de futuros cambios de contrato.
- **Coach F2-lite completo** (`009`, `010`): política legacy self-only, lecturas scoped, perfiles multi-atleta, roster, switcher y atletas gestionados desplegados.
- **Whoop v1** (`011`): Dexie v15 `readinessDaily`, OAuth server-side, sync/cron, tarjeta de readiness y prefill editable de check-in. Aplicado en prod.
- **Whoop Workout Auto-Complete** (`012`): Dexie v16 `whoopWorkouts`, reconciliación server/client, matcher self-only con idempotencia durable y badge de sesión. Aplicado en prod.
- **Two-sided foundation** (`013a/b/c`): `athlete_memberships`, invites y RLS v2 en código (`membershipCache.ts`, `claimGate.ts`).
- **Plan generation attempts** (`014`): persistencia y endurecimiento de telemetría del plan builder async.
- **Coach Workspace** (2026-07-13 a 2026-07-19): `/coach` con Resumen, Alumnos, Planificación y Biblioteca; Asistente IA sigue como placeholder. Incluye roster management (archivar/restaurar/borrado duro con tombstone durable, barrera single-tab, supresión de cola y purga transaccional) y edición de sesiones multi-atleta.
- **Biblioteca de plantillas** (`015`, Dexie **v18**, backup v4): plantillas account-scoped con soft-delete por tombstone, payload allowlisted y sync Supabase por fila con LWW/delete-wins. `015` aplicado y bundle desplegado en producción; queda smoke autenticado.
- **Coach exercise catalog picker** (2026-07-19): `coachExerciseCatalog.ts` unifica drills de squash y ejercicios de fuerza; typeahead + explorador en `SessionForm`; `libraryRef` como metadata opcional sanitizada en sesiones, plantillas y backup/import. Sin migraciones.
- **Plan Builder measurement foundation — Plan 2** (`016`, 2026-07-24): telemetría a nivel job/corrida. Nueva tabla `plan_generation_jobs` (una fila por corrida, agrupa `plan_generation_attempts` por `job_id`) con timings (`first_week_ready_ms`, `..._e2e_ms`, `plan_complete_ms`, `terminal_ms`), descriptor de variante fiel a la request (`resolveEffectivePlanBuilderConfig` + `buildVariantId`), tokens/costo fechado (`pricing.ts`) y outcome (`cancelled→budget_exhausted→succeeded→partial→failed`). `runAsyncPlanGeneration` emite vía `finalizeJob` idempotente en todo camino terminal, y las fallas previas al loop las cubre `emitUnstartedJobTelemetry` (handoff explícito vía `onJobFinalizerArmed`, sin ventana). Attempts ganan columnas de variante + taxonomía (incl. 3 contadores de sesiones afectadas). **`016` aplicada en producción (2026-07-25), bundle desplegado y corrida real verificada (2026-07-26).**
- **Plan Builder loadtest — Plan 3 Entrega 1** (2026-07-25): `scripts/loadtest-plan-builder.mjs` corre `runAsyncPlanGeneration` contra el proveedor real con writer en memoria (sin Dexie ni Supabase), sobre un manifest sintético congelado de 6 escenarios × 2 planes / 42 semanas. El control se ejecutó y aceptó con 12/12 planes y 42/42 semanas; su copia byte a byte vive en `docs/superpowers/calibrations/plan-builder-v2-control-2026-07-25.json`, SHA-256 `6c45885a870cf7e019906a0b4d786e828b2653fe1643f95d436be3aa0ee94d7a`. El gate exige cobertura de cada escenario y el reporte resume el lag pareado de detección.
- **Plan Builder quality v2 — Plan 3 Entrega 2** (2026-07-25): calibración congelada (semana `/1`, tope `10`; plan `/4`, tope `8`; warning `5`) y `quality_version = 2` productiva. La versión efectiva se resuelve antes del descriptor, queda alineada con `variant_id`, se estampa en las semanas y se consume explícitamente en attempts, fallback y review final; planes mixtos legacy permanecen en v1. El runner local estampa la misma versión efectiva (solo cuando hay taxonomía v2), para que una regeneración offline no degrade a v1 de forma permanente un plan que ya era v2. **Fase 0 de medición cerrada, incluidos sus pendientes operativos: bundle desplegado y smoke de producción ejecutado el 2026-07-26 (`docs/superpowers/smokes/2026-07-25-quality-v2-production-smoke.md`).** Un plan nuevo produjo `quality_version = 2`, `variant_id s46-q2-00ftsagu`, 4/4 semanas y attempts con `repair_taxonomy_version = 2` alineados con el job. Las regeneraciones parciales (q1 legacy y trinquete q2→q2) quedaron **no reproducibles en producción**: el botón por semana es dev-only (`isDevToolsEnabled()` corta si `import.meta.env.PROD`), así que se apoyan en tests unitarios + el monitoreo M4 (proporción de corridas `q1`). Costo observado: ~**$0.029 por semana generada** — `OPTIMIZATION_AND_COSTS.md` sigue con cifras de la era Gemini y está desactualizado.

## Prioridades abiertas (en orden)
1. Smokear Biblioteca + Planificación autenticadas, incluyendo el catálogo/picker del coach (`015` y su bundle llevan días en producción sin verificación end-to-end con sesión real).
2. Consentimiento in-app (términos/privacidad/IA) + consentimiento biométrico antes de conectar Whoop para terceros; revisión jurídica formal en paralelo.
3. QA deportiva: 3 planes arquetipo como atletas gestionados y checklist manual de revisión.
4. Operación del piloto premium: oferta cerrada, soporte, reembolso, primer cliente onboardeado.
5. Validación operativa real de sync (conflictos concurrentes, recovery multi-dispositivo).

## Reglas del proyecto
- **Athlete scope — reglas duras:**
  - Nunca el literal `'default'` fuera de `activeAthlete.ts` (hay guard test); usar `ATHLETE_PROFILE_LOCAL_ID`, `getActiveAthleteId()` o `getSelfAthleteId()`.
  - Toda lectura de `sessions`/`dayLogs`/`weekSummaries`/`coachProposals`/`chatMessages` fuera de sync/export pasa por `filterRowsToActiveScope`/`isRowInActiveScope`. **Filas legacy/unscoped pertenecen SOLO al self** — un atleta gestionado nunca las ve ni las adopta.
  - Toda creación local de esas filas se estampa con `withActiveAthleteStamp`.
  - En sync, el fallback legacy se ancla a `getSelfAthleteId()`, nunca al atleta activo.
  - `isInAthleteScope` (effectiveAthleteKey) es para delete-scoping de sync; para lecturas usar `activeScopeFilter`.
- El modelo local es Dexie (**v18**) — cualquier cambio de schema requiere migración + test de upgrade real (fake-indexeddb ya instalado; patrón: `db.close(); await db.delete(); await db.open()` por test).
- Las migraciones remotas son de **aplicación manual**: escribir el `.sql` numerado no es aplicarlo. Antes de asumir que una tabla existe en prod, confirmar el rollout con el owner.
- Coach: las lecturas/escrituras por atleta explícito van por `coachScopedReads`/`coachScopedWrites` — nunca cambiando el atleta activo para leer la semana de otro.
- No modificar `promptBuilder.ts` sin revisar el contexto completo del coach.
- Sync con Supabase ya está implementado — no duplicar lógica de sync.
- No agregar dependencias pesadas sin revisar impacto en bundle.
- Las notificaciones web tienen límites reales por navegador — documentar antes de cambiar.
- Los commits los hace el owner — no ejecutar `git commit`/`git add` salvo pedido explícito.

## Referencias clave
@./PROJECT_REVIEW_AND_ROADMAP.md
@./OPTIMIZATION_AND_COSTS.md
- RFC Coach Mode: `docs/rfc/2026-06-16-coach-mode-architecture.md`
- Specs y planes: `docs/superpowers/specs/` y `docs/superpowers/plans/`

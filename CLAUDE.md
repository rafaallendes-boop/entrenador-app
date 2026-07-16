# Entrenador App (RallyIQ) — CLAUDE.md

## Proyecto
App web de entrenamiento para squash, running y fuerza. Marca pública: **RallyIQ**.
Stack: React + TypeScript + Vite + Tailwind + Dexie (local-first) + Supabase (sync) + Google OAuth.
Deploy en Netlify. Usuario principal: Rafael Allendes (squash competitivo, masters).
Etapa: preparando piloto premium acompañado (1-3 clientes fundadores) + Coach Mode F2-lite.

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
- `src/store/` — estado global con Zustand
- `src/types/` — tipos compartidos
- `src/utils/` — helpers
- `src/services/ai/promptBuilder.ts` — prompt del coach IA (tocar con cuidado)
- `public/sw.js` — service worker para notificaciones
- `supabase/00X_*.sql` — migraciones remotas numeradas, de aplicación manual

## Estado actual del producto
Ver `PROJECT_REVIEW_AND_ROADMAP.md` para el estado completo. Actualizado: 2026-07-10.
Suite: 184 archivos / 1292 tests. Lint OK, build OK.
El chunk más pesado es `pdf.worker.min` — ya optimizado, no tocar sin razón.

Bloques recientes relevantes:
- **Athlete scope foundation** (`007`): tabla `athletes`, `athlete_id` backfilleado, hidratación de atleta activo, flag `VITE_ATHLETE_SCOPE` (off).
- **F2 data prereqs**: Dexie **v14** con únicos compuestos `[athleteId+date]` / `[athleteId+weekStartDate]`; merges/import/export athlete-aware.
- **008b write path**: handler reactivo de `23505` (`reconcileNaturalKeyConflict`) commiteado y aplicado en prod; mantener `008a` como preflight operativo antes de futuros cambios de contrato.
- **Coach F2-lite completo**: política legacy self-only, lecturas scoped, perfiles multi-atleta, roster, switcher y atletas gestionados ya desplegados.
- **Whoop v1** (`011`): Dexie **v15** `readinessDaily`, OAuth server-side, sync/cron, tarjeta de readiness y prefill editable de check-in.
- **Whoop Workout Auto-Complete** (`012`): Dexie **v16** `whoopWorkouts`, reconciliacion server/client, matcher self-only con idempotencia durable y badge de sesion.
- **Coach roster management + Planificacion read-only** (2026-07-14): archivar/restaurar/borrado duro de gestionados con tombstone durable, barrera single-tab, supresion de cola y purga transaccional; `coachScopedReads` hidrata y lee una semana por atleta explicito sin cambiar el scope activo.

## Prioridades abiertas (en orden)
1. Aplicar `011`, deploy y smoke end-to-end de Whoop; enlazar consentimiento biométrico antes de terceros.
2. Superficie pública + rutas legales + consentimiento + smoke (piloto premium, ver roadmap).
3. Aplicar `012`, reconectar Whoop para `read:workout` y smokear el auto-complete; SP1a queda reservado para `013+`/Dexie v17+.
4. QA deportiva: 3 planes arquetipo como atletas gestionados.
5. Validación operativa real de sync (conflictos concurrentes, recovery multi-dispositivo).

## Reglas del proyecto
- **Athlete scope — reglas duras:**
  - Nunca el literal `'default'` fuera de `activeAthlete.ts` (hay guard test); usar `ATHLETE_PROFILE_LOCAL_ID`, `getActiveAthleteId()` o `getSelfAthleteId()`.
  - Toda lectura de `sessions`/`dayLogs`/`weekSummaries`/`coachProposals`/`chatMessages` fuera de sync/export pasa por `filterRowsToActiveScope`/`isRowInActiveScope`. **Filas legacy/unscoped pertenecen SOLO al self** — un atleta gestionado nunca las ve ni las adopta.
  - Toda creación local de esas filas se estampa con `withActiveAthleteStamp`.
  - En sync, el fallback legacy se ancla a `getSelfAthleteId()`, nunca al atleta activo.
  - `isInAthleteScope` (effectiveAthleteKey) es para delete-scoping de sync; para lecturas usar `activeScopeFilter`.
- El modelo local es Dexie (**v17**) — cualquier cambio de schema requiere migración + test de upgrade real (fake-indexeddb ya instalado; patrón: `db.close(); await db.delete(); await db.open()` por test).
- `athlete_profiles` remoto tiene UNIQUE por `user_id` (`002`) — **no** crear un segundo perfil por cuenta hasta aplicar la migración `009` (mini expand/contract, ver spec F2-lite §3.2).
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

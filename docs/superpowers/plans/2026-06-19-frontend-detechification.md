# Frontend De-tecnificación Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que en producción la app no exponga ninguna superficie técnica (quality score, reparaciones, retries, fallback, estado de sync), manteniendo todo ese instrumental disponible para desarrollo tras un único flag.

**Architecture:** Un único helper `isDevToolsEnabled()` (prod siempre `false`) es la única fuente de verdad para mostrar debug. Toda superficie de debug se gatea por ese flag — nunca por estado de datos. Donde ocultar dejaría un hueco funcional (aceptar plan, sync offline), se reemplaza por una versión mínima de consumidor (enfoque B).

**Tech Stack:** React + TypeScript + Vite. Tests con Vitest (`vitest run`) y `renderToStaticMarkup` de `react-dom/server`. Flags vía `import.meta.env`.

## Global Constraints

- Prod (`import.meta.env.PROD === true`) siempre oculta debug. Sin excepciones por estado.
- No tocar lógica de sync, generación ni Dexie. Solo render y strings.
- No agregar dependencias.
- Conservar `VITE_SHOW_PLAN_QUALITY` como flag de entrada reconocido (no romper `.env.local`).
- Mantener la API pública de componentes existentes (`SyncStatusBadge` props, `shouldShowPlanQuality()`) para no romper call sites.
- Copy prohibido en superficies de usuario (prod): `retry`, `reintent`, `fallback`, `stalled`, `polling`, `jobId`, `provider`, `reparacion`/`reparaciones`, `warnings`, `validación` (en sentido técnico), `Estrategia:`, `N/M semanas listas`, score numérico de calidad, `pendiente(s)`, `Sincronizando`, `cola`.
- Verificación de cierre por tarea: `npm run lint` y `npm run build` verdes; tests de la tarea verdes.

---

### Task 1: Helper único `isDevToolsEnabled` + alias del flag viejo

**Files:**
- Create: `src/services/devTools.ts`
- Create: `src/services/__tests__/devTools.test.ts`
- Modify: `src/services/ai/showPlanQualityFlag.ts`

**Interfaces:**
- Produces: `isDevToolsEnabled(): boolean` desde `src/services/devTools.ts`.
- `shouldShowPlanQuality(): boolean` se mantiene en `src/services/ai/showPlanQualityFlag.ts` pero delega en `isDevToolsEnabled()`.

- [ ] **Step 1: Write the failing test**

Create `src/services/__tests__/devTools.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isDevToolsEnabled } from '../devTools'

describe('isDevToolsEnabled', () => {
  const originalEnv = { ...import.meta.env }
  afterEach(() => { Object.assign(import.meta.env, originalEnv) })

  it('is false in production regardless of flags', () => {
    Object.assign(import.meta.env, { PROD: true, VITE_DEV_TOOLS: 'true', VITE_SHOW_PLAN_QUALITY: 'true' })
    expect(isDevToolsEnabled()).toBe(false)
  })

  it('is false in dev when no flag is set', () => {
    Object.assign(import.meta.env, { PROD: false, VITE_DEV_TOOLS: undefined, VITE_SHOW_PLAN_QUALITY: undefined })
    expect(isDevToolsEnabled()).toBe(false)
  })

  it('is true in dev when VITE_DEV_TOOLS=true', () => {
    Object.assign(import.meta.env, { PROD: false, VITE_DEV_TOOLS: 'true', VITE_SHOW_PLAN_QUALITY: undefined })
    expect(isDevToolsEnabled()).toBe(true)
  })

  it('is true in dev when legacy VITE_SHOW_PLAN_QUALITY=true', () => {
    Object.assign(import.meta.env, { PROD: false, VITE_DEV_TOOLS: undefined, VITE_SHOW_PLAN_QUALITY: 'true' })
    expect(isDevToolsEnabled()).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/devTools.test.ts`
Expected: FAIL — `Cannot find module '../devTools'`.

- [ ] **Step 3: Create the helper**

Create `src/services/devTools.ts`:

```typescript
/**
 * Single source of truth for developer-only UI (debug surfaces).
 * Production is forcibly off. Dev enables via VITE_DEV_TOOLS=true.
 * VITE_SHOW_PLAN_QUALITY is kept as a legacy alias.
 */
export function isDevToolsEnabled(): boolean {
  if (import.meta.env.PROD === true) return false
  return (
    import.meta.env.VITE_DEV_TOOLS === 'true' ||
    import.meta.env.VITE_SHOW_PLAN_QUALITY === 'true'
  )
}
```

- [ ] **Step 4: Delegate the legacy flag**

Replace the body of `src/services/ai/showPlanQualityFlag.ts` with:

```typescript
import { isDevToolsEnabled } from '../devTools'

/**
 * Legacy alias. Plan Builder debug surfaces use the unified dev-tools flag now.
 * @see isDevToolsEnabled
 */
export function shouldShowPlanQuality(): boolean {
  return isDevToolsEnabled()
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/services/__tests__/devTools.test.ts src/components/planBuilder/PlanQualityBadge.test.tsx`
Expected: PASS (PlanQualityBadge test still works because it sets `VITE_SHOW_PLAN_QUALITY` + `PROD: false`).

- [ ] **Step 6: Commit**

```bash
git add src/services/devTools.ts src/services/__tests__/devTools.test.ts src/services/ai/showPlanQualityFlag.ts
git commit -m "feat: unify dev-tools flag behind isDevToolsEnabled"
```

---

### Task 2: Plan Builder — gatear debug y limpiar la pantalla de aceptar

**Files:**
- Modify: `src/pages/PlanBuilderV2Page.tsx` (líneas ~92-103 status labels; ~678-686 gating; ~1348-1419 validation panel; ~1452-1519 botones de recovery/regeneración)

**Interfaces:**
- Consumes: `isDevToolsEnabled()` de Task 1.

- [ ] **Step 1: Importar el flag unificado**

En `src/pages/PlanBuilderV2Page.tsx`, junto a los imports existentes, reemplazar el import de `shouldShowPlanQuality`:

```typescript
import { isDevToolsEnabled } from '../services/devTools'
```

Y eliminar la línea `import { shouldShowPlanQuality } from '../services/ai/showPlanQualityFlag'`.

- [ ] **Step 2: Gatear quality review SOLO por dev**

Reemplazar (líneas ~678 y ~683-686):

```typescript
  const showPlanQualityDebug = shouldShowPlanQuality()
```
```typescript
  const shouldShowQualityReview = Boolean(
    qualityReview &&
    (showPlanQualityDebug || plan?.generationState === 'complete' || plan?.generationState === 'partial')
  )
```

por:

```typescript
  const showPlanQualityDebug = isDevToolsEnabled()
```
```typescript
  const shouldShowQualityReview = Boolean(qualityReview && showPlanQualityDebug)
```

- [ ] **Step 3: Suavizar labels de estado de semana**

Reemplazar el cuerpo de `getWeekGenerationStatus` (líneas ~92-103) por copy de outcome sin jerga:

```typescript
function getWeekGenerationStatus(week: TrainingPlanWeek): string {
  if (week.status === 'error') return 'pendiente'
  if (week.status === 'generating') return 'preparando…'
  return 'lista'
}
```

- [ ] **Step 4: Envolver el panel de validación técnico en dev**

En el bloque del panel "Validación" (líneas ~1348-1419), envolver TODO el contenido técnico (la `<p>Validación</p>`, el bloque `shouldShowQualityReview`, las listas de `errors`/`warnings`, y el bloque `plan?.generationSummary` con "Estrategia"/"semanas listas") en una condición `isDevToolsEnabled()`. Para usuario (prod), reemplazar todo ese panel `<div>` por una tarjeta limpia de consumidor:

```tsx
          {/* Validation panel */}
          {isDevToolsEnabled() ? (
            <div
              className="rounded-2xl p-3.5 space-y-2 md:max-h-[72vh] md:overflow-y-auto"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {/* ... TODO el contenido técnico actual sin cambios ... */}
            </div>
          ) : (
            <div
              className="rounded-2xl p-4 flex items-center gap-3"
              style={{ background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.16)' }}
            >
              <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-ink">Tu plan está listo</p>
                <p className="text-xs text-ink-muted mt-0.5">
                  {weeks.length} semana{weeks.length === 1 ? '' : 's'} hasta tu evento. Revisalo y aceptalo cuando quieras.
                </p>
              </div>
            </div>
          )}
```

(El contenido técnico actual queda intacto dentro de la rama `isDevToolsEnabled()`.)

- [ ] **Step 5: Gatear botones de recovery/regeneración en dev**

En el action bar (líneas ~1452-1519), envolver los botones `isFailedState` (Reintentar/Reintentar completo), `generationState === 'partial'` (Regenerar fallidas/Reintentar completo) y `generationState === 'complete'` (Reparar semanas marcadas/Regenerar plan) en una sola condición `isDevToolsEnabled()`. Los botones **Aceptar plan** y **Descartar** quedan SIEMPRE visibles (fuera del gate).

Patrón: anteponer `{isDevToolsEnabled() && (` ... `)}` al grupo de botones técnicos, dejando Aceptar/Descartar fuera.

- [ ] **Step 6: Verificar build + lint**

Run: `npm run lint && npm run build`
Expected: ambos OK (sin imports sin usar; `shouldShowPlanQuality` ya no se importa acá).

- [ ] **Step 7: Test de render en prod**

Create `src/pages/__tests__/planBuilderDetech.test.tsx` (si la carpeta no existe, créala):

```tsx
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isDevToolsEnabled } from '../../services/devTools'

describe('isDevToolsEnabled gating (Plan Builder)', () => {
  const originalEnv = { ...import.meta.env }
  afterEach(() => { Object.assign(import.meta.env, originalEnv) })

  it('is off in prod so quality debug stays hidden', () => {
    Object.assign(import.meta.env, { PROD: true, VITE_DEV_TOOLS: 'true' })
    expect(isDevToolsEnabled()).toBe(false)
  })
})
```

> Nota: un render completo de `PlanBuilderV2Page` requiere stores/router; este test fija la garantía del gate. El render limpio se valida manualmente en el smoke de prod.

- [ ] **Step 8: Run test + commit**

Run: `npx vitest run src/pages/__tests__/planBuilderDetech.test.tsx`
Expected: PASS

```bash
git add src/pages/PlanBuilderV2Page.tsx src/pages/__tests__/planBuilderDetech.test.tsx
git commit -m "feat: hide plan builder debug in prod, clean accept screen"
```

---

### Task 3: SyncStatusBadge silencioso en prod

**Files:**
- Modify: `src/components/sync/SyncStatusBadge.tsx`
- Create: `src/components/sync/SyncStatusBadge.test.tsx`

**Interfaces:**
- Consumes: `isDevToolsEnabled()` de Task 1.
- Produces: `SyncStatusBadge` mantiene su misma firma de props. En prod devuelve `null` salvo offline real.

- [ ] **Step 1: Write the failing test**

Create `src/components/sync/SyncStatusBadge.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SyncStatusBadge from './SyncStatusBadge'

describe('SyncStatusBadge in production', () => {
  const originalEnv = { ...import.meta.env }
  afterEach(() => { Object.assign(import.meta.env, originalEnv) })

  it('renders nothing when synced ok in prod', () => {
    Object.assign(import.meta.env, { PROD: true, VITE_DEV_TOOLS: undefined })
    const html = renderToStaticMarkup(<SyncStatusBadge status="idle" error={null} pendingOps={0} />)
    expect(html).toBe('')
  })

  it('does not leak "Sincronizando" or "pendientes" in prod', () => {
    Object.assign(import.meta.env, { PROD: true, VITE_DEV_TOOLS: undefined })
    const syncing = renderToStaticMarkup(<SyncStatusBadge status="syncing" error={null} pendingOps={3} syncAttemptInFlight />)
    expect(syncing).not.toContain('Sincronizando')
    expect(syncing).not.toContain('pendiente')
  })

  it('shows a calm offline message in prod', () => {
    Object.assign(import.meta.env, { PROD: true, VITE_DEV_TOOLS: undefined })
    const html = renderToStaticMarkup(<SyncStatusBadge status="offline" error={null} pendingOps={2} />)
    expect(html).toContain('Sin conexión')
    expect(html).not.toContain('pendiente')
  })

  it('keeps the full technical badge in dev', () => {
    Object.assign(import.meta.env, { PROD: false, VITE_DEV_TOOLS: 'true' })
    const html = renderToStaticMarkup(<SyncStatusBadge status="syncing" error={null} />)
    expect(html).toContain('Sincronizando')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/sync/SyncStatusBadge.test.tsx`
Expected: FAIL — actualmente renderiza "Sincronizando" / "pendientes" siempre.

- [ ] **Step 3: Add the prod-silent path**

En `src/components/sync/SyncStatusBadge.tsx`, agregar import al tope:

```typescript
import { isDevToolsEnabled } from '../../services/devTools'
```

E insertar, al inicio del cuerpo de `SyncStatusBadge` (justo después de `const labelClass = ...`), el guard de consumidor:

```typescript
  // Consumer mode: sync is silent. Only surface a calm offline notice.
  if (!isDevToolsEnabled()) {
    if (status === 'offline') {
      return (
        <span className={`inline-flex items-center gap-1 text-ink-muted ${labelClass}`}>
          <CloudOff size={iconSize} />
          {compact ? 'Sin conexión' : 'Sin conexión'}
        </span>
      )
    }
    return null
  }
```

El resto del componente (las ramas técnicas) queda igual y solo se alcanza en dev.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/sync/SyncStatusBadge.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/sync/SyncStatusBadge.tsx src/components/sync/SyncStatusBadge.test.tsx
git commit -m "feat: make sync status silent for users in prod"
```

---

### Task 4: Settings — gatear diagnóstico de sync y simplificar la sección

**Files:**
- Modify: `src/pages/SettingsPage.tsx` (sección sync ~544-691)

**Interfaces:**
- Consumes: `isDevToolsEnabled()` de Task 1.

- [ ] **Step 1: Importar el flag**

En `src/pages/SettingsPage.tsx`, agregar:

```typescript
import { isDevToolsEnabled } from '../services/devTools'
```

- [ ] **Step 2: Gatear el panel de diagnóstico y el detalle técnico**

Envolver en `{isDevToolsEnabled() && ( ... )}`:
- El bloque `<details>` "Ver detalle tecnico" (líneas ~601-657).
- El `<SyncDiagnosticsPanel ... />` (líneas ~659-663).
- La grilla "Cola pendiente / Ultimo sync OK / Ultimo intento" (líneas ~585-600).
- Los botones "Reintentar ahora" (líneas ~673-690).

- [ ] **Step 3: Simplificar el mensaje de error de sync a una línea humana**

Reemplazar el bloque `syncStatus === 'error' && syncError` (líneas ~557-574) por una versión que, para usuario, solo tranquilice y, para dev, muestre el detalle:

```tsx
            {syncStatus === 'error' && !syncDetails.autoRepairInProgress && (
              <p className="mb-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                Tus cambios están guardados en este dispositivo y se subirán automáticamente.
                {isDevToolsEnabled() && syncError && (
                  <span className="block mt-1 text-amber-200/80">
                    [{syncDetails.lastErrorCategory ?? 'error'}] {syncError}
                  </span>
                )}
              </p>
            )}
```

- [ ] **Step 4: Verificar build + lint**

Run: `npm run lint && npm run build`
Expected: OK. Si quedan variables sin usar (ej. `syncSummary`, `syncHeadline`) solo dentro del gate, mantenerlas dentro del bloque `isDevToolsEnabled()`; si ESLint marca no-usadas en prod-path, dejarlas referenciadas dentro del gate.

- [ ] **Step 5: Commit**

```bash
git add src/pages/SettingsPage.tsx
git commit -m "feat: simplify settings sync section for users, keep diagnostics in dev"
```

---

### Task 5: Barrido catch-all de jerga (WeeklyView + errores crudos)

**Files:**
- Modify: `src/pages/WeeklyView.tsx:348`
- Modify: `src/pages/SettingsPage.tsx` (mensajes `error.message` crudos en export/import: ~204, 217, 231, 245, 264, 286, 439, 461)

**Interfaces:** ninguna nueva.

- [ ] **Step 1: Suavizar copy de nota semanal**

En `src/pages/WeeklyView.tsx:348`, reemplazar:

```tsx
                {isGeneratingNote ? 'Generando...' : currentWeekSummary.coachNote ? 'Regenerar nota RallyIQ' : 'Generar nota RallyIQ'}
```
por:
```tsx
                {isGeneratingNote ? 'Preparando nota…' : currentWeekSummary.coachNote ? 'Actualizar nota' : 'Generar nota'}
```

- [ ] **Step 2: Reemplazar `error.message` crudo por copy fijo**

En `src/pages/SettingsPage.tsx`, en cada `catch` que hoy hace `error instanceof Error ? error.message : '...'`, dejar SIEMPRE el mensaje humano fijo y mandar el detalle a consola. Ejemplo para el export de backup (~204):

```typescript
    } catch (error) {
      console.error('export backup failed', error)
      setExportStatus('No se pudo exportar. Probá de nuevo en un momento.')
    }
```

Aplicar el mismo patrón (mensaje humano fijo + `console.error`) en: `setProfileExportStatus` (~217), `setBetaQualityStatus` export (~231) y reset (~245), `setImportStatus` leer (~264) e importar (~286), reset total (~439) y clear (~461). Usar mensajes ya existentes sin el `error.message`:
- export backup → "No se pudo exportar. Probá de nuevo en un momento."
- export perfil → "No se pudo exportar el perfil."
- import → "No se pudo importar el backup."
- reset/clear → conservar el texto humano que ya está como fallback, quitando el `error.message`.

- [ ] **Step 3: Barrido de confirmación**

Run:
```bash
grep -rniE "reintent|fallback|stalled|polling|jobId| provider|reparacion|warnings|estrategia:|sincronizando|pendiente" src/pages src/components --include="*.tsx" | grep -viE "isDevToolsEnabled|console\.|//|\.test\."
```
Expected: cada hallazgo restante o está dentro de un gate `isDevToolsEnabled()`, o es copy aceptable de consumidor. Si aparece uno nuevo visible al usuario, gatearlo o suavizarlo siguiendo los patrones de las tareas previas.

- [ ] **Step 4: Verificación final**

Run: `npm run lint && npm run build && npm test`
Expected: lint OK, build OK, toda la suite verde.

- [ ] **Step 5: Commit**

```bash
git add src/pages/WeeklyView.tsx src/pages/SettingsPage.tsx
git commit -m "feat: soften user-facing copy and raw error messages"
```

---

## Notas de cierre

- Para probar en dev como usuario: correr sin `VITE_DEV_TOOLS` ni `VITE_SHOW_PLAN_QUALITY` (o en `false`) y verificar que no aparece debug. Para ver el instrumental: `VITE_DEV_TOOLS=true`.
- Smoke manual recomendado tras implementar: generar un plan, ver que la pantalla de aceptar es limpia, navegar Settings sin diagnóstico de sync, forzar offline y ver el aviso calmo.

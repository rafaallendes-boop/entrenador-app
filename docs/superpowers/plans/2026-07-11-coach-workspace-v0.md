# Coach Workspace v0 — Resumen + Roster Mejorado Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `/coach` from a single roster page into a workspace shell with five areas (Resumen, Alumnos, Planificación, Biblioteca, Asistente IA), where Resumen and Alumnos have real content built on the existing roster data, and the other three show an honest "próximamente" placeholder.

**Architecture:** A new container page (`CoachWorkspacePage`) owns the coach gate, its own `listOwnedAthletes` fetch, tab state, and pending/error UI state for athlete-switch and create-athlete actions. The switch-then-navigate and create-then-activate decisions are extracted into small injectable, unit-tested functions (`src/services/athlete/coachWorkspaceActions.ts`) instead of living inline in the component, because `renderToStaticMarkup` (this project's test convention) cannot exercise click handlers — this is the only way to get real coverage on the riskiest logic in this slice. `CoachContextBar` (mounted globally in `AppShell`) keeps its own independent `listOwnedAthletes` read — v0 accepts **two independent local Dexie reads** on `/coach` rather than sharing one, because both reads are cheap (`db.athletes.toArray()`, no network) and unifying them would mean introducing a shared store/hook, which is more surface than this slice needs. `CoachContextBar`'s read gets a `.catch` it was previously missing. No new routes, no new Dexie tables, no new backend calls.

**Tech Stack:** React + TypeScript, react-router-dom (`useNavigate`, `Navigate`), Zustand (`useAuthStore`), Vitest for unit tests (`react-dom/server`'s `renderToStaticMarkup` for markup-shape assertions, plain async function tests for the extracted action logic), Playwright for one added browser smoke step in the existing `scripts/e2e-coach-test.mjs` — no new dependencies (`playwright` is already a devDependency and already has a coach-adjacent e2e script).

## Global Constraints

- Spec of record: `docs/superpowers/specs/coach-landing-strategy.md`, section "Próximo plan: Coach Workspace v0 — Resumen + roster". This plan implements **only** that section's scope.
- v0 is **roster mejorado, not dashboard agregado**: cards show only what `listOwnedAthletes` already returns (id, `displayName`, self/active status). No computed signals (check-in gaps, readiness, overdue sessions) — those require a multi-athlete read layer that is explicitly out of scope.
- CTAs on the Resumen cards link to `ROUTES.WEEK` (`/week`) and `ROUTES.PLAN_BUILDER_V2` (`/plans/builder`) only. No "generate week with AI" CTA — `WeekCreatorEngine` is a chat-invoked service, not a navigable page, and deciding its UI is out of scope for v0.
- Athlete switching reuses `switchActiveAthlete` exactly as `CoachRosterPage.handleTrainAs` does today (switch, then navigate) — this is a **temporary impersonation model**, not a real multi-athlete dashboard. Do not attempt to build aggregate cross-athlete queries in this plan. Unlike the original draft of this plan, the switch-then-navigate decision is now wrapped with pending/error UI feedback (see Task 3 and Task 6) — reusing the impersonation model does not require reusing its previous lack of feedback.
- No new routes are introduced. All five areas live inside the existing `ROUTES.COACH` (`/coach`) route as in-page tabs (local component state) with proper `role="tablist"`/`role="tab"`/`role="tabpanel"` ARIA wiring, sidestepping the routing-architecture decision that public routes (`/coaches`, legal pages) still need.
- Nav is **responsive**: a compact horizontal scrollable tab bar below `md`, a vertical sidebar list at `md` and above — matching the spec's "navegación lateral mínima" on desktop while staying usable on a phone.
- Voice: this codebase's existing coach UI uses tuteo ("Tú", "Entrenando ahora") — all new copy in this plan uses "tú/tus", not "vos". Do not introduce voseo.
- `account_type` gating is explicitly out of scope — `VITE_COACH_ACCOUNTS` / `isCoachAccount` stays as-is.
- No new dependencies. Component tests follow the existing project convention (`renderToStaticMarkup` + prop injection); the extracted action functions in `coachWorkspaceActions.ts` get plain Vitest async-function tests (no rendering, no mocking Dexie/react-router — dependencies are passed as plain injected objects); the end-to-end click/switch/create flow gets one Playwright smoke step added to the existing `scripts/e2e-coach-test.mjs`. Do not add `@testing-library/react` — it is not installed and is out of scope for this plan.
- **Commits are made by the project owner only** (CLAUDE.md rule) — do **not** run `git add` / `git commit` at the end of a task. Each task ends with tests passing and the working tree left as-is for the owner to review and commit.
- Before considering the whole plan done, run `npm run lint && npm test && npm run build` (CLAUDE.md pre-commit rule) and do the manual/Playwright smoke described in Task 8.

---

## File Structure

New files (all under a new `src/components/coach/` directory, plus a services file and a page):

- `src/components/coach/coachWorkspaceTypes.ts` — shared `CoachWorkspaceTab`, `RosterStatus`, `PendingAthleteAction` types. Type-only, no runtime logic, no test.
- `src/components/coach/CoachWorkspaceNav.tsx` (+ test) — responsive `tablist`/`tab` nav for the five areas, exports `coachTabId`/`coachTabPanelId` helpers used by the container to wire `aria-controls`/`aria-labelledby`.
- `src/components/coach/CoachWorkspacePlaceholderPanel.tsx` (+ test) — generic "próximamente" panel, reused for Planificación/Biblioteca/Asistente IA.
- `src/services/athlete/coachWorkspaceActions.ts` (+ test) — `selectAthleteAndNavigate` and `createAndActivateAthlete`, both with injected dependencies, unit-tested directly (no component rendering needed).
- `src/components/coach/CoachSummaryPanel.tsx` (+ test) — Resumen tab: roster cards with "Ver semana"/"Ver plan" CTAs, self-only-aware empty state, pending/disabled button state.
- `src/components/coach/CoachRosterPanel.tsx` (+ test) — Alumnos tab: roster list + create-athlete `<form>` (props-driven extraction of today's `CoachRosterPage` body), pending/disabled switch button state.
- `src/pages/CoachWorkspacePage.tsx` (+ test) — container: coach gate, `listOwnedAthletes` fetch, tab state, pending-action state, action-error/notice banner, wires the four panels above.

Modified:

- `src/components/layout/CoachContextBar.tsx` — add `.catch` to its independent `listOwnedAthletes` read (currently an unhandled rejection on Dexie failure).
- `src/App.tsx` — swap the `ROUTES.COACH` route from `CoachRosterPage` to `CoachWorkspacePage`.
- `scripts/e2e-coach-test.mjs` — add a coach-workspace smoke step (skips gracefully if the authenticated test account isn't coach-allowlisted).

Deleted (superseded by `CoachWorkspacePage` + `CoachRosterPanel`):

- `src/pages/CoachRosterPage.tsx`
- `src/pages/CoachRosterPage.test.tsx`

---

### Task 1: Shared types + `CoachWorkspaceNav`

**Files:**
- Create: `src/components/coach/coachWorkspaceTypes.ts`
- Create: `src/components/coach/CoachWorkspaceNav.tsx`
- Test: `src/components/coach/CoachWorkspaceNav.test.tsx`

**Interfaces:**
- Produces: `type CoachWorkspaceTab = 'resumen' | 'alumnos' | 'planificacion' | 'biblioteca' | 'asistente'` (from `coachWorkspaceTypes.ts`)
- Produces: `type RosterStatus = 'loading' | 'ready' | 'error'` (from `coachWorkspaceTypes.ts`)
- Produces: `interface PendingAthleteAction { athleteId: string; kind: 'week' | 'plan' | 'trainAs' }` (from `coachWorkspaceTypes.ts`)
- Produces: `export default function CoachWorkspaceNav(props: { activeTab: CoachWorkspaceTab; onSelect: (tab: CoachWorkspaceTab) => void }): JSX.Element`
- Produces: `export function coachTabId(tab: CoachWorkspaceTab): string` and `export function coachTabPanelId(tab: CoachWorkspaceTab): string` — used by `CoachWorkspacePage` (Task 6) to wire `aria-controls`/`aria-labelledby` on the tabpanel.

- [ ] **Step 1: Write the failing test**

Create `src/components/coach/CoachWorkspaceNav.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CoachWorkspaceNav, { coachTabId, coachTabPanelId } from './CoachWorkspaceNav'

describe('coachTabId / coachTabPanelId', () => {
  it('generan ids estables por tab', () => {
    expect(coachTabId('alumnos')).toBe('coach-tab-alumnos')
    expect(coachTabPanelId('alumnos')).toBe('coach-tabpanel-alumnos')
  })
})

describe('CoachWorkspaceNav', () => {
  it('renders a tablist with the five areas in order', () => {
    const html = renderToStaticMarkup(
      <CoachWorkspaceNav activeTab="alumnos" onSelect={vi.fn()} />,
    )
    expect(html).toContain('role="tablist"')
    const order = ['Resumen', 'Alumnos', 'Planificación', 'Biblioteca', 'Asistente IA']
    let lastIndex = -1
    for (const label of order) {
      const index = html.indexOf(label)
      expect(index).toBeGreaterThan(lastIndex)
      lastIndex = index
    }
  })

  it('marca el tab activo con role=tab y aria-selected=true', () => {
    const html = renderToStaticMarkup(
      <CoachWorkspaceNav activeTab="alumnos" onSelect={vi.fn()} />,
    )
    const alumnosTab = html.match(/<button[^>]*id="coach-tab-alumnos"[^>]*>/)?.[0]
    expect(alumnosTab).toBeDefined()
    expect(alumnosTab).toContain('role="tab"')
    expect(alumnosTab).toContain('aria-selected="true"')

    const resumenTab = html.match(/<button[^>]*id="coach-tab-resumen"[^>]*>/)?.[0]
    expect(resumenTab).toContain('aria-selected="false"')
  })

  it('cada tab expone aria-controls apuntando a su tabpanel', () => {
    const html = renderToStaticMarkup(
      <CoachWorkspaceNav activeTab="resumen" onSelect={vi.fn()} />,
    )
    expect(html).toContain('aria-controls="coach-tabpanel-biblioteca"')
  })

  it('marks Planificación, Biblioteca y Asistente IA as "pronto"', () => {
    const html = renderToStaticMarkup(
      <CoachWorkspaceNav activeTab="resumen" onSelect={vi.fn()} />,
    )
    expect((html.match(/pronto/g) ?? []).length).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/coach/CoachWorkspaceNav.test.tsx`
Expected: FAIL — `Failed to resolve import "./CoachWorkspaceNav"` (module doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/components/coach/coachWorkspaceTypes.ts`:

```ts
export type CoachWorkspaceTab = 'resumen' | 'alumnos' | 'planificacion' | 'biblioteca' | 'asistente'

export type RosterStatus = 'loading' | 'ready' | 'error'

export interface PendingAthleteAction {
  athleteId: string
  kind: 'week' | 'plan' | 'trainAs'
}
```

Create `src/components/coach/CoachWorkspaceNav.tsx`:

```tsx
import type { CoachWorkspaceTab } from './coachWorkspaceTypes'

interface CoachWorkspaceNavProps {
  activeTab: CoachWorkspaceTab
  onSelect: (tab: CoachWorkspaceTab) => void
}

const TABS: { key: CoachWorkspaceTab; label: string; comingSoon: boolean }[] = [
  { key: 'resumen', label: 'Resumen', comingSoon: false },
  { key: 'alumnos', label: 'Alumnos', comingSoon: false },
  { key: 'planificacion', label: 'Planificación', comingSoon: true },
  { key: 'biblioteca', label: 'Biblioteca', comingSoon: true },
  { key: 'asistente', label: 'Asistente IA', comingSoon: true },
]

export function coachTabId(tab: CoachWorkspaceTab): string {
  return `coach-tab-${tab}`
}

export function coachTabPanelId(tab: CoachWorkspaceTab): string {
  return `coach-tabpanel-${tab}`
}

export default function CoachWorkspaceNav({ activeTab, onSelect }: CoachWorkspaceNavProps) {
  return (
    <div
      role="tablist"
      aria-label="Áreas del workspace de coach"
      className="mb-6 flex gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-white/5 p-1 md:mb-0 md:w-48 md:flex-shrink-0 md:flex-col md:overflow-visible md:border-0 md:bg-transparent md:p-0"
    >
      {TABS.map((tab) => {
        const isActive = tab.key === activeTab
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={coachTabId(tab.key)}
            aria-selected={isActive}
            aria-controls={coachTabPanelId(tab.key)}
            onClick={() => onSelect(tab.key)}
            className={`flex-shrink-0 rounded-xl px-3 py-2 text-left text-xs font-semibold transition-colors md:w-full md:py-2.5 ${
              isActive ? 'bg-brand text-white' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {tab.label}
            {tab.comingSoon && <span className="ml-1 text-[10px] font-normal opacity-70">(pronto)</span>}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/coach/CoachWorkspaceNav.test.tsx`
Expected: PASS (4 tests)

---

### Task 2: `CoachWorkspacePlaceholderPanel`

**Files:**
- Create: `src/components/coach/CoachWorkspacePlaceholderPanel.tsx`
- Test: `src/components/coach/CoachWorkspacePlaceholderPanel.test.tsx`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `export default function CoachWorkspacePlaceholderPanel(props: { title: string; description: string }): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `src/components/coach/CoachWorkspacePlaceholderPanel.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CoachWorkspacePlaceholderPanel from './CoachWorkspacePlaceholderPanel'

describe('CoachWorkspacePlaceholderPanel', () => {
  it('renders the given title and description', () => {
    const html = renderToStaticMarkup(
      <CoachWorkspacePlaceholderPanel
        title="Biblioteca"
        description="Vas a poder guardar tus ejercicios y plantillas favoritas para reutilizarlos entre atletas."
      />,
    )
    expect(html).toContain('Biblioteca')
    expect(html).toContain('Vas a poder guardar tus ejercicios y plantillas favoritas para reutilizarlos entre atletas.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/coach/CoachWorkspacePlaceholderPanel.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/coach/CoachWorkspacePlaceholderPanel.tsx`:

```tsx
interface CoachWorkspacePlaceholderPanelProps {
  title: string
  description: string
}

export default function CoachWorkspacePlaceholderPanel({ title, description }: CoachWorkspacePlaceholderPanelProps) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 px-4 py-8 text-center">
      <p className="font-display text-sm font-semibold text-ink">{title}</p>
      <p className="mt-2 text-xs text-ink-muted">{description}</p>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/coach/CoachWorkspacePlaceholderPanel.test.tsx`
Expected: PASS (1 test)

---

### Task 3: `coachWorkspaceActions` — extracted, unit-tested switch/create logic

This is the fix for the plan's biggest gap: the switch-then-navigate and create-then-activate
decisions must not live only inline inside a component that only gets `renderToStaticMarkup`
tests (which never run effects or clicks). Extracting them into plain async functions with
injected dependencies means they get real unit tests with no rendering at all.

**Files:**
- Create: `src/services/athlete/coachWorkspaceActions.ts`
- Test: `src/services/athlete/coachWorkspaceActions.test.ts`

**Interfaces:**
- Consumes: `Athlete` from `../../types`.
- Produces:
  - `interface SelectAthleteAndNavigateDeps { switchActiveAthlete: (ownerAccountId: string, athleteId: string) => Promise<boolean>; navigate: (destination: string) => void }`
  - `interface SelectAthleteAndNavigateResult { navigated: boolean; switched: boolean }`
  - `function selectAthleteAndNavigate(deps: SelectAthleteAndNavigateDeps, ownerAccountId: string, athleteId: string, activeAthleteId: string | null, destination: string): Promise<SelectAthleteAndNavigateResult>`
  - `interface CreateAndActivateAthleteDeps { createManagedAthlete: (ownerAccountId: string, displayName: string) => Promise<Athlete>; switchActiveAthlete: (ownerAccountId: string, athleteId: string) => Promise<boolean> }`
  - `interface CreateAndActivateAthleteResult { athlete: Athlete; activated: boolean }`
  - `function createAndActivateAthlete(deps: CreateAndActivateAthleteDeps, ownerAccountId: string, displayName: string): Promise<CreateAndActivateAthleteResult>`
  - Contract: `createAndActivateAthlete` **always resolves with the created athlete** even if activation fails (`activated: false`) — it only rejects if `createManagedAthlete` itself rejects (e.g. empty name). This is what lets the container keep a partially-activated athlete visible instead of losing it.

- [ ] **Step 1: Write the failing test**

Create `src/services/athlete/coachWorkspaceActions.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createAndActivateAthlete, selectAthleteAndNavigate } from './coachWorkspaceActions'
import type { Athlete } from '../../types'

const ATHLETE: Athlete = {
  id: 'ath_m_1',
  ownerAccountId: 'user-1',
  linkedAccountId: null,
  displayName: 'Cliente 1',
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
}

describe('selectAthleteAndNavigate', () => {
  it('atleta ya activo: navega directo sin llamar a switchActiveAthlete', async () => {
    const switchActiveAthlete = vi.fn()
    const navigate = vi.fn()
    const result = await selectAthleteAndNavigate({ switchActiveAthlete, navigate }, 'user-1', 'ath_1', 'ath_1', '/week')
    expect(switchActiveAthlete).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/week')
    expect(result).toEqual({ navigated: true, switched: false })
  })

  it('atleta diferente y switch exitoso: cambia y luego navega', async () => {
    const switchActiveAthlete = vi.fn().mockResolvedValue(true)
    const navigate = vi.fn()
    const result = await selectAthleteAndNavigate({ switchActiveAthlete, navigate }, 'user-1', 'ath_2', 'ath_1', '/plans/builder')
    expect(switchActiveAthlete).toHaveBeenCalledWith('user-1', 'ath_2')
    expect(navigate).toHaveBeenCalledWith('/plans/builder')
    expect(result).toEqual({ navigated: true, switched: true })
  })

  it('switch fallido: no navega y reporta el fallo', async () => {
    const switchActiveAthlete = vi.fn().mockResolvedValue(false)
    const navigate = vi.fn()
    const result = await selectAthleteAndNavigate({ switchActiveAthlete, navigate }, 'user-1', 'ath_2', 'ath_1', '/week')
    expect(navigate).not.toHaveBeenCalled()
    expect(result).toEqual({ navigated: false, switched: false })
  })
})

describe('createAndActivateAthlete', () => {
  it('creacion y activacion exitosas', async () => {
    const createManagedAthlete = vi.fn().mockResolvedValue(ATHLETE)
    const switchActiveAthlete = vi.fn().mockResolvedValue(true)
    const result = await createAndActivateAthlete({ createManagedAthlete, switchActiveAthlete }, 'user-1', 'Cliente 1')
    expect(createManagedAthlete).toHaveBeenCalledWith('user-1', 'Cliente 1')
    expect(switchActiveAthlete).toHaveBeenCalledWith('user-1', 'ath_m_1')
    expect(result).toEqual({ athlete: ATHLETE, activated: true })
  })

  it('creacion exitosa pero activacion fallida: igual devuelve el atleta creado', async () => {
    const createManagedAthlete = vi.fn().mockResolvedValue(ATHLETE)
    const switchActiveAthlete = vi.fn().mockResolvedValue(false)
    const result = await createAndActivateAthlete({ createManagedAthlete, switchActiveAthlete }, 'user-1', 'Cliente 1')
    expect(result).toEqual({ athlete: ATHLETE, activated: false })
  })

  it('creacion fallida: propaga el error sin llamar a switchActiveAthlete', async () => {
    const createManagedAthlete = vi.fn().mockRejectedValue(new Error('El nombre del atleta no puede estar vacío'))
    const switchActiveAthlete = vi.fn()
    await expect(
      createAndActivateAthlete({ createManagedAthlete, switchActiveAthlete }, 'user-1', ''),
    ).rejects.toThrow('no puede estar vacío')
    expect(switchActiveAthlete).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/athlete/coachWorkspaceActions.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/services/athlete/coachWorkspaceActions.ts`:

```ts
import type { Athlete } from '../../types'

export interface SelectAthleteAndNavigateDeps {
  switchActiveAthlete: (ownerAccountId: string, athleteId: string) => Promise<boolean>
  navigate: (destination: string) => void
}

export interface SelectAthleteAndNavigateResult {
  navigated: boolean
  switched: boolean
}

/**
 * Switches the active athlete (if needed) and navigates to `destination`.
 * Deps are injected so this can be unit-tested without mocking Dexie or react-router.
 */
export async function selectAthleteAndNavigate(
  deps: SelectAthleteAndNavigateDeps,
  ownerAccountId: string,
  athleteId: string,
  activeAthleteId: string | null,
  destination: string,
): Promise<SelectAthleteAndNavigateResult> {
  if (athleteId === activeAthleteId) {
    deps.navigate(destination)
    return { navigated: true, switched: false }
  }
  const ok = await deps.switchActiveAthlete(ownerAccountId, athleteId)
  if (!ok) return { navigated: false, switched: false }
  deps.navigate(destination)
  return { navigated: true, switched: true }
}

export interface CreateAndActivateAthleteDeps {
  createManagedAthlete: (ownerAccountId: string, displayName: string) => Promise<Athlete>
  switchActiveAthlete: (ownerAccountId: string, athleteId: string) => Promise<boolean>
}

export interface CreateAndActivateAthleteResult {
  athlete: Athlete
  activated: boolean
}

/**
 * Creates a managed athlete and tries to activate it. Always resolves with the
 * created athlete, even when activation fails, so the caller can keep it visible
 * in the roster instead of losing it — only rejects if creation itself fails.
 */
export async function createAndActivateAthlete(
  deps: CreateAndActivateAthleteDeps,
  ownerAccountId: string,
  displayName: string,
): Promise<CreateAndActivateAthleteResult> {
  const athlete = await deps.createManagedAthlete(ownerAccountId, displayName)
  const activated = await deps.switchActiveAthlete(ownerAccountId, athlete.id)
  return { athlete, activated }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/athlete/coachWorkspaceActions.test.ts`
Expected: PASS (6 tests)

---

### Task 4: `CoachSummaryPanel` (Resumen tab)

**Files:**
- Create: `src/components/coach/CoachSummaryPanel.tsx`
- Test: `src/components/coach/CoachSummaryPanel.test.tsx`

**Interfaces:**
- Consumes: `RosterStatus`, `PendingAthleteAction` from `./coachWorkspaceTypes` (Task 1), `Athlete` from `../../types`.
- Produces: `export default function CoachSummaryPanel(props: { athletes: Athlete[]; status: RosterStatus; selfId: string | null; activeAthleteId: string | null; pendingAction: PendingAthleteAction | null; onRetry: () => void; onOpenWeek: (athleteId: string) => void; onOpenPlan: (athleteId: string) => void; onGoToAlumnos: () => void }): JSX.Element`
- Semantics: `athletes.length === 0` is the **defensive true-empty** case (should not normally happen — `listOwnedAthletes` always includes self). The **realistic** "coach with no students yet" case is `athletes.length > 0 && no athlete other than selfId` — these are two different UI states (see Step 1 tests).

- [ ] **Step 1: Write the failing test**

Create `src/components/coach/CoachSummaryPanel.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CoachSummaryPanel from './CoachSummaryPanel'
import type { Athlete } from '../../types'
import type { PendingAthleteAction, RosterStatus } from './coachWorkspaceTypes'

const SELF: Athlete = { id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', displayName: 'Rafa', status: 'active', createdAt: 1, updatedAt: 1 }
const MANAGED: Athlete = { id: 'ath_m_abc', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Cliente 1', status: 'active', createdAt: 1, updatedAt: 1 }

function render(status: RosterStatus, athletes: Athlete[] = [], pendingAction: PendingAthleteAction | null = null) {
  return renderToStaticMarkup(
    <CoachSummaryPanel
      athletes={athletes}
      status={status}
      selfId="ath_user-1"
      activeAthleteId="ath_user-1"
      pendingAction={pendingAction}
      onRetry={vi.fn()}
      onOpenWeek={vi.fn()}
      onOpenPlan={vi.fn()}
      onGoToAlumnos={vi.fn()}
    />,
  )
}

describe('CoachSummaryPanel', () => {
  it('loading: muestra estado de carga sin tarjetas', () => {
    const html = render('loading')
    expect(html).toContain('Cargando tus atletas')
    expect(html).not.toContain('Ver semana')
  })

  it('error: muestra mensaje y boton de reintentar', () => {
    const html = render('error')
    expect(html).toContain('No pudimos cargar tu roster')
    expect(html).toContain('Reintentar')
  })

  it('roster realmente vacio (defensivo): muestra CTA para ir a Alumnos', () => {
    const html = render('ready', [])
    expect(html).toContain('Aún no tienes atletas activos')
    expect(html).toContain('Ir a Alumnos para crear uno')
  })

  it('solo self (caso real de coach nuevo): muestra la tarjeta "Tú" y el bloque de agregar alumnos', () => {
    const html = render('ready', [SELF])
    expect(html).toContain('Tú')
    expect(html).toContain('Ver semana')
    expect(html).toContain('Aún no agregaste alumnos')
    expect(html).toContain('Ir a Alumnos para agregar el primero')
  })

  it('con alumno gestionado: no muestra el bloque de "agregar alumnos"', () => {
    const html = render('ready', [SELF, MANAGED])
    expect(html).toContain('Cliente 1')
    expect(html).not.toContain('Aún no agregaste alumnos')
    expect((html.match(/Ver semana/g) ?? []).length).toBe(2)
    expect((html.match(/Ver plan/g) ?? []).length).toBe(2)
  })

  it('accion pendiente: deshabilita y relabela solo el boton correspondiente', () => {
    const html = render('ready', [SELF, MANAGED], { athleteId: 'ath_m_abc', kind: 'week' })
    const managedCard = html.slice(html.indexOf('Cliente 1'))
    expect(managedCard).toContain('Abriendo semana…')
    expect(managedCard).toContain('disabled')
    const selfCard = html.slice(0, html.indexOf('Cliente 1'))
    expect(selfCard).not.toContain('disabled')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/coach/CoachSummaryPanel.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/coach/CoachSummaryPanel.tsx`:

```tsx
import type { Athlete } from '../../types'
import type { PendingAthleteAction, RosterStatus } from './coachWorkspaceTypes'

interface CoachSummaryPanelProps {
  athletes: Athlete[]
  status: RosterStatus
  selfId: string | null
  activeAthleteId: string | null
  pendingAction: PendingAthleteAction | null
  onRetry: () => void
  onOpenWeek: (athleteId: string) => void
  onOpenPlan: (athleteId: string) => void
  onGoToAlumnos: () => void
}

export default function CoachSummaryPanel({
  athletes,
  status,
  selfId,
  activeAthleteId,
  pendingAction,
  onRetry,
  onOpenWeek,
  onOpenPlan,
  onGoToAlumnos,
}: CoachSummaryPanelProps) {
  if (status === 'loading') {
    return <p className="text-sm text-ink-muted">Cargando tus atletas…</p>
  }

  if (status === 'error') {
    return (
      <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
        No pudimos cargar tu roster.
        <button type="button" onClick={onRetry} className="ml-2 font-semibold underline">
          Reintentar
        </button>
      </div>
    )
  }

  if (athletes.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/15 px-4 py-8 text-center">
        <p className="text-sm text-ink-muted">Aún no tienes atletas activos.</p>
        <button
          type="button"
          onClick={onGoToAlumnos}
          className="mt-3 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-ink transition-colors hover:bg-white/10"
        >
          Ir a Alumnos para crear uno
        </button>
      </div>
    )
  }

  const hasManagedAthletes = athletes.some((athlete) => athlete.id !== selfId)

  return (
    <div className="space-y-3">
      {!hasManagedAthletes && (
        <div className="rounded-2xl border border-dashed border-white/15 px-4 py-4 text-center">
          <p className="text-sm text-ink-muted">Aún no agregaste alumnos.</p>
          <button
            type="button"
            onClick={onGoToAlumnos}
            className="mt-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-ink transition-colors hover:bg-white/10"
          >
            Ir a Alumnos para agregar el primero
          </button>
        </div>
      )}

      {athletes.map((athlete) => {
        const isSelf = athlete.id === selfId
        const isActive = athlete.id === activeAthleteId
        const isBusy = pendingAction?.athleteId === athlete.id
        const isWeekPending = isBusy && pendingAction?.kind === 'week'
        const isPlanPending = isBusy && pendingAction?.kind === 'plan'
        return (
          <div key={athlete.id} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm font-semibold text-ink">
                {isSelf ? 'Tú' : (athlete.displayName ?? 'Atleta')}
              </p>
              {isActive && <p className="text-xs text-brand">Entrenando ahora</p>}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => onOpenWeek(athlete.id)}
                className="flex-1 rounded-xl border border-white/15 bg-white/5 py-2 text-xs font-semibold text-ink transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                {isWeekPending ? 'Abriendo semana…' : 'Ver semana'}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => onOpenPlan(athlete.id)}
                className="flex-1 rounded-xl border border-white/15 bg-white/5 py-2 text-xs font-semibold text-ink transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                {isPlanPending ? 'Abriendo plan…' : 'Ver plan'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/coach/CoachSummaryPanel.test.tsx`
Expected: PASS (6 tests)

---

### Task 5: `CoachRosterPanel` (Alumnos tab)

**Files:**
- Create: `src/components/coach/CoachRosterPanel.tsx`
- Test: `src/components/coach/CoachRosterPanel.test.tsx`

**Interfaces:**
- Consumes: `RosterStatus`, `PendingAthleteAction` from `./coachWorkspaceTypes` (Task 1), `Athlete` from `../../types`.
- Produces: `export default function CoachRosterPanel(props: { athletes: Athlete[]; status: RosterStatus; selfId: string | null; activeAthleteId: string | null; pendingAction: PendingAthleteAction | null; onRetry: () => void; onCreateAthlete: (name: string) => Promise<void>; onTrainAs: (athleteId: string) => void }): JSX.Element`
- `onCreateAthlete` resolves on success (including the "created but not activated" case — see Task 3), throws `Error` (with a user-facing message) only when the athlete was never created — the panel catches it and renders `error.message`.

- [ ] **Step 1: Write the failing test**

Create `src/components/coach/CoachRosterPanel.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CoachRosterPanel from './CoachRosterPanel'
import type { Athlete } from '../../types'
import type { PendingAthleteAction, RosterStatus } from './coachWorkspaceTypes'

const ROSTER: Athlete[] = [
  { id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', displayName: 'Rafa', status: 'active', createdAt: 1, updatedAt: 1 },
  { id: 'ath_m_abc', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Cliente 1', status: 'active', createdAt: 1, updatedAt: 1 },
]

function render(status: RosterStatus, athletes: Athlete[] = [], pendingAction: PendingAthleteAction | null = null) {
  return renderToStaticMarkup(
    <CoachRosterPanel
      athletes={athletes}
      status={status}
      selfId="ath_user-1"
      activeAthleteId="ath_user-1"
      pendingAction={pendingAction}
      onRetry={vi.fn()}
      onCreateAthlete={vi.fn()}
      onTrainAs={vi.fn()}
    />,
  )
}

describe('CoachRosterPanel', () => {
  it('loading: muestra estado de carga', () => {
    const html = render('loading')
    expect(html).toContain('Cargando tus atletas')
  })

  it('error: muestra mensaje y boton de reintentar', () => {
    const html = render('error')
    expect(html).toContain('No pudimos cargar tu roster')
    expect(html).toContain('Reintentar')
  })

  it('con solo self: card "Tú" activa y CTA de crear dentro de un form, sin boton de switch', () => {
    const html = render('ready', [ROSTER[0]])
    expect(html).toContain('Tú')
    expect(html).toContain('Entrenando ahora')
    expect(html).toContain('<form')
    expect(html).toContain('Crear atleta')
    expect(html).not.toContain('Entrenar como este atleta')
  })

  it('con gestionado en el roster: card con nombre real y boton de switch', () => {
    const html = render('ready', ROSTER)
    expect(html).toContain('Cliente 1')
    expect(html).toContain('Entrenar como este atleta')
  })

  it('roster vacio: mensaje explicativo antes del CTA de crear', () => {
    const html = render('ready', [])
    expect(html).toContain('Aún no tienes atletas. Crea el primero.')
  })

  it('accion trainAs pendiente: deshabilita y relabela el boton de switch', () => {
    const html = render('ready', ROSTER, { athleteId: 'ath_m_abc', kind: 'trainAs' })
    expect(html).toContain('Cambiando atleta…')
    expect(html).not.toContain('Entrenar como este atleta')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/coach/CoachRosterPanel.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/coach/CoachRosterPanel.tsx`:

```tsx
import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { Athlete } from '../../types'
import type { PendingAthleteAction, RosterStatus } from './coachWorkspaceTypes'

interface CoachRosterPanelProps {
  athletes: Athlete[]
  status: RosterStatus
  selfId: string | null
  activeAthleteId: string | null
  pendingAction: PendingAthleteAction | null
  onRetry: () => void
  onCreateAthlete: (name: string) => Promise<void>
  onTrainAs: (athleteId: string) => void
}

export default function CoachRosterPanel({
  athletes,
  status,
  selfId,
  activeAthleteId,
  pendingAction,
  onRetry,
  onCreateAthlete,
  onTrainAs,
}: CoachRosterPanelProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleCreate() {
    if (isSubmitting) return
    setError(null)
    setIsSubmitting(true)
    try {
      await onCreateAthlete(newName)
      setNewName('')
      setIsCreating(false)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'No se pudo crear el atleta.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (status === 'loading') {
    return <p className="text-sm text-ink-muted">Cargando tus atletas…</p>
  }

  if (status === 'error') {
    return (
      <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
        No pudimos cargar tu roster.
        <button type="button" onClick={onRetry} className="ml-2 font-semibold underline">
          Reintentar
        </button>
      </div>
    )
  }

  return (
    <div>
      {athletes.length === 0 && (
        <p className="mb-3 text-sm text-ink-muted">Aún no tienes atletas. Crea el primero.</p>
      )}

      <div className="space-y-3">
        {athletes.map((athlete) => {
          const isSelf = athlete.id === selfId
          const isActive = athlete.id === activeAthleteId
          const isPending = pendingAction?.athleteId === athlete.id && pendingAction.kind === 'trainAs'
          return (
            <div
              key={athlete.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {isSelf ? 'Tú' : (athlete.displayName ?? 'Atleta')}
                </p>
                {isActive && <p className="text-xs text-brand">Entrenando ahora</p>}
              </div>
              {!isActive && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => onTrainAs(athlete.id)}
                  className="flex-shrink-0 rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-white/10 disabled:opacity-50"
                >
                  {isPending ? 'Cambiando atleta…' : 'Entrenar como este atleta'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {isCreating ? (
        <form
          onSubmit={(event) => { event.preventDefault(); void handleCreate() }}
          className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4"
        >
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-ink-muted">Nombre del atleta</span>
            <input
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Ej. Juan Pérez"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-ink outline-none"
            />
          </label>
          {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { setIsCreating(false); setError(null) }}
              className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-semibold text-ink-muted"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!newName.trim() || isSubmitting}
              className="flex-1 rounded-xl bg-brand py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {isSubmitting ? 'Creando…' : 'Crear y completar perfil'}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/20 py-3 text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
        >
          <Plus size={16} />
          Crear atleta
        </button>
      )}
    </div>
  )
}
```

Note: `<button type="submit">` inside `<form onSubmit>` means pressing Enter in the name input now submits — this fixes the reviewer's finding that creation was click-only. `handleCreate`'s `if (isSubmitting) return` guard plus the `disabled={... || isSubmitting}` on the submit button together prevent double-submit from a fast double Enter/click.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/coach/CoachRosterPanel.test.tsx`
Expected: PASS (6 tests)

---

### Task 6: `CoachWorkspacePage` container

**Files:**
- Create: `src/pages/CoachWorkspacePage.tsx`
- Test: `src/pages/CoachWorkspacePage.test.tsx`

**Interfaces:**
- Consumes:
  - `CoachWorkspaceTab`, `RosterStatus`, `PendingAthleteAction` from `../components/coach/coachWorkspaceTypes` (Task 1)
  - `CoachWorkspaceNav` default export, `coachTabId`, `coachTabPanelId` (Task 1)
  - `CoachWorkspacePlaceholderPanel` default export (Task 2)
  - `selectAthleteAndNavigate`, `createAndActivateAthlete` from `../services/athlete/coachWorkspaceActions` (Task 3)
  - `CoachSummaryPanel` default export (Task 4)
  - `CoachRosterPanel` default export (Task 5)
  - `isCoachAccount` from `../services/athlete/coachAccess`
  - `getSelfAthleteId` from `../services/athlete/activeAthlete`
  - `createManagedAthlete`, `listOwnedAthletes` from `../services/athlete/managedAthletes`
  - `switchActiveAthlete` from `../services/athlete/switchActiveAthlete`
  - `ROUTES` from `../constants/routes` (uses `ROUTES.HOME`, `ROUTES.ONBOARDING`, `ROUTES.WEEK`, `ROUTES.PLAN_BUILDER_V2`)
- Produces: `export default function CoachWorkspacePage(props: { allowlistOverride?: string; initialAthletes?: Athlete[]; initialTab?: CoachWorkspaceTab }): JSX.Element` — mounted at `ROUTES.COACH` in Task 7.

Note on test coverage boundaries: this container test verifies **wiring** (tab → correct panel, tabpanel ARIA ids match the nav's tab ids, self-only roster flows through to the panel's "Aún no agregaste alumnos" state). It does **not** re-test pending/disabled-button rendering — that's already covered directly in Task 4/5's tests via the `pendingAction` prop, and `pendingAction` here is internal state only reachable through a click, which `renderToStaticMarkup` cannot drive. The click-driven, end-to-end version of that path is covered by the Playwright smoke in Task 8.

- [ ] **Step 1: Write the failing test**

Create `src/pages/CoachWorkspacePage.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'

import type { Athlete } from '../types'
import type { CoachWorkspaceTab } from '../components/coach/coachWorkspaceTypes'
import { coachTabId, coachTabPanelId } from '../components/coach/CoachWorkspaceNav'

// zustand v5 usa getInitialState() como server snapshot: renderToStaticMarkup
// (SSR) ignora setState. Mock con estado mutable para inyectar user/activeAthleteId.
const { authState } = vi.hoisted(() => ({
  authState: { user: null as unknown, activeAthleteId: null as string | null },
}))
vi.mock('../store/useAuthStore', () => {
  const useAuthStore = (selector: (state: typeof authState) => unknown) => selector(authState)
  useAuthStore.setState = (patch: Partial<typeof authState>) => { Object.assign(authState, patch) }
  useAuthStore.getState = () => authState
  return { useAuthStore }
})

import CoachWorkspacePage from './CoachWorkspacePage'
import { useAuthStore } from '../store/useAuthStore'
import { setActiveAthleteId, setSelfAthleteId } from '../services/athlete/activeAthlete'

const SELF: Athlete = { id: 'ath_user-1', ownerAccountId: 'user-1', linkedAccountId: 'user-1', displayName: 'Rafa', status: 'active', createdAt: 1, updatedAt: 1 }
const MANAGED: Athlete = { id: 'ath_m_abc', ownerAccountId: 'user-1', linkedAccountId: null, displayName: 'Cliente 1', status: 'active', createdAt: 1, updatedAt: 1 }

// renderToStaticMarkup no ejecuta efectos → initialAthletes inyecta el roster
// que en runtime carga el useEffect (listOwnedAthletes).
function render(allowlist: string, initialAthletes: Athlete[] = [], initialTab?: CoachWorkspaceTab) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/coach']}>
      <Routes>
        <Route
          path="/coach"
          element={(
            <CoachWorkspacePage
              allowlistOverride={allowlist}
              initialAthletes={initialAthletes}
              initialTab={initialTab}
            />
          )}
        />
        <Route path="/" element={<p>HOME</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('CoachWorkspacePage', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'user-1', email: 'rafa@x.cl' } as User, activeAthleteId: 'ath_user-1' })
    setSelfAthleteId('ath_user-1')
    setActiveAthleteId('ath_user-1')
  })

  afterEach(() => {
    useAuthStore.setState({ user: null, activeAthleteId: null })
    setActiveAthleteId(null)
    setSelfAthleteId(null)
  })

  it('no-coach entrando manualmente a /coach: no renderiza el workspace', () => {
    const html = render('otra@persona.cl')
    expect(html).not.toContain('Workspace de coach')
  })

  it('coach allowlisted: por defecto muestra el tab Resumen con CTAs de semana/plan', () => {
    const html = render('rafa@x.cl', [SELF, MANAGED])
    expect(html).toContain('Workspace de coach')
    expect(html).toContain('Ver semana')
    expect(html).toContain('Ver plan')
  })

  it('coach nuevo con solo self: el tab Resumen invita a agregar el primer alumno', () => {
    const html = render('rafa@x.cl', [SELF])
    expect(html).toContain('Aún no agregaste alumnos')
  })

  it('tab Alumnos: muestra el roster con CTA de crear atleta', () => {
    const html = render('rafa@x.cl', [SELF, MANAGED], 'alumnos')
    expect(html).toContain('Crear atleta')
    expect(html).toContain('Entrenar como este atleta')
  })

  it('tab Planificación/Biblioteca/Asistente IA: muestran su placeholder con voz de tuteo', () => {
    expect(render('rafa@x.cl', [SELF], 'planificacion')).toContain('Vas a poder crear y editar sesiones')
    expect(render('rafa@x.cl', [SELF], 'biblioteca')).toContain('Vas a poder guardar tus ejercicios')
    const asistente = render('rafa@x.cl', [SELF], 'asistente')
    expect(asistente).toContain('tú revisas y confirmas')
    expect(asistente).not.toContain('vos')
  })

  it('el tabpanel activo referencia el tab activo via aria-labelledby/aria-controls', () => {
    const html = render('rafa@x.cl', [SELF, MANAGED], 'alumnos')
    expect(html).toContain(`id="${coachTabPanelId('alumnos')}"`)
    expect(html).toContain(`aria-labelledby="${coachTabId('alumnos')}"`)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/CoachWorkspacePage.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/pages/CoachWorkspacePage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Users } from 'lucide-react'
import { useAuthStore } from '../store/useAuthStore'
import { isCoachAccount } from '../services/athlete/coachAccess'
import { getSelfAthleteId } from '../services/athlete/activeAthlete'
import { createManagedAthlete, listOwnedAthletes } from '../services/athlete/managedAthletes'
import { switchActiveAthlete } from '../services/athlete/switchActiveAthlete'
import { createAndActivateAthlete, selectAthleteAndNavigate } from '../services/athlete/coachWorkspaceActions'
import { ROUTES } from '../constants/routes'
import type { Athlete } from '../types'
import type { CoachWorkspaceTab, PendingAthleteAction, RosterStatus } from '../components/coach/coachWorkspaceTypes'
import CoachWorkspaceNav, { coachTabId, coachTabPanelId } from '../components/coach/CoachWorkspaceNav'
import CoachSummaryPanel from '../components/coach/CoachSummaryPanel'
import CoachRosterPanel from '../components/coach/CoachRosterPanel'
import CoachWorkspacePlaceholderPanel from '../components/coach/CoachWorkspacePlaceholderPanel'

interface CoachWorkspacePageProps {
  /** Solo tests: inyecta la allowlist sin depender de import.meta.env. */
  allowlistOverride?: string
  /** Solo tests: roster inicial (renderToStaticMarkup no ejecuta efectos). */
  initialAthletes?: Athlete[]
  /** Solo tests: tab inicial (renderToStaticMarkup no ejecuta clicks). */
  initialTab?: CoachWorkspaceTab
}

export default function CoachWorkspacePage({ allowlistOverride, initialAthletes, initialTab }: CoachWorkspacePageProps) {
  const user = useAuthStore((state) => state.user)
  const activeAthleteId = useAuthStore((state) => state.activeAthleteId)
  const [athletes, setAthletes] = useState<Athlete[]>(initialAthletes ?? [])
  const [status, setStatus] = useState<RosterStatus>(initialAthletes ? 'ready' : 'loading')
  const [activeTab, setActiveTab] = useState<CoachWorkspaceTab>(initialTab ?? 'resumen')
  const [reloadToken, setReloadToken] = useState(0)
  const [pendingAthleteAction, setPendingAthleteAction] = useState<PendingAthleteAction | null>(null)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const navigate = useNavigate()

  const isCoach = allowlistOverride !== undefined
    ? isCoachAccount(user, allowlistOverride)
    : isCoachAccount(user)

  useEffect(() => {
    if (!isCoach || !user?.id) return
    let cancelled = false
    setStatus('loading')
    listOwnedAthletes(user.id)
      .then((rows) => {
        if (cancelled) return
        setAthletes(rows)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => { cancelled = true }
  }, [isCoach, user?.id, activeAthleteId, reloadToken])

  const handleAthleteAction = useCallback(async (
    athleteId: string,
    kind: PendingAthleteAction['kind'],
    destination: string,
  ) => {
    if (!user?.id) return
    setActionMessage(null)
    setPendingAthleteAction({ athleteId, kind })
    const result = await selectAthleteAndNavigate(
      { switchActiveAthlete, navigate },
      user.id,
      athleteId,
      activeAthleteId,
      destination,
    )
    setPendingAthleteAction(null)
    if (!result.navigated) {
      setActionMessage('No se pudo cambiar de atleta. Intenta de nuevo.')
    }
  }, [user?.id, activeAthleteId, navigate])

  if (!isCoach || !user?.id) return <Navigate to={ROUTES.HOME} replace />

  const selfId = getSelfAthleteId()

  async function handleCreateAthlete(name: string) {
    if (!user?.id) throw new Error('Sesión inválida.')
    setActionMessage(null)
    const result = await createAndActivateAthlete(
      { createManagedAthlete, switchActiveAthlete },
      user.id,
      name,
    )
    const rows = await listOwnedAthletes(user.id)
    setAthletes(rows)
    setStatus('ready')
    if (result.activated) {
      navigate(ROUTES.ONBOARDING)
      return
    }
    setActionMessage(
      `Se creó a "${result.athlete.displayName ?? name}", pero no se pudo activar automáticamente. ` +
      'Usa "Entrenar como este atleta" en la lista para abrir su perfil.',
    )
  }

  function handleRetry() {
    setReloadToken((token) => token + 1)
  }

  return (
    <div className="mx-auto max-w-4xl px-4 pb-8 pt-12 md:grid md:grid-cols-[200px_1fr] md:items-start md:gap-6">
      <div className="mb-6 flex items-center gap-2 md:col-span-2">
        <Users size={20} className="text-brand" />
        <h1 className="font-display text-2xl font-bold text-ink">Workspace de coach</h1>
      </div>

      <CoachWorkspaceNav activeTab={activeTab} onSelect={setActiveTab} />

      <div role="tabpanel" id={coachTabPanelId(activeTab)} aria-labelledby={coachTabId(activeTab)} tabIndex={0}>
        {actionMessage && (
          <p role="alert" className="mb-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {actionMessage}
          </p>
        )}

        {activeTab === 'resumen' && (
          <CoachSummaryPanel
            athletes={athletes}
            status={status}
            selfId={selfId}
            activeAthleteId={activeAthleteId}
            pendingAction={pendingAthleteAction}
            onRetry={handleRetry}
            onOpenWeek={(athleteId) => void handleAthleteAction(athleteId, 'week', ROUTES.WEEK)}
            onOpenPlan={(athleteId) => void handleAthleteAction(athleteId, 'plan', ROUTES.PLAN_BUILDER_V2)}
            onGoToAlumnos={() => setActiveTab('alumnos')}
          />
        )}

        {activeTab === 'alumnos' && (
          <CoachRosterPanel
            athletes={athletes}
            status={status}
            selfId={selfId}
            activeAthleteId={activeAthleteId}
            pendingAction={pendingAthleteAction}
            onRetry={handleRetry}
            onCreateAthlete={handleCreateAthlete}
            onTrainAs={(athleteId) => void handleAthleteAction(athleteId, 'trainAs', ROUTES.HOME)}
          />
        )}

        {activeTab === 'planificacion' && (
          <CoachWorkspacePlaceholderPanel
            title="Planificación"
            description="Vas a poder crear y editar sesiones, semanas y planes completos para cualquier atleta desde acá."
          />
        )}

        {activeTab === 'biblioteca' && (
          <CoachWorkspacePlaceholderPanel
            title="Biblioteca"
            description="Vas a poder guardar tus ejercicios y plantillas favoritas para reutilizarlos entre atletas."
          />
        )}

        {activeTab === 'asistente' && (
          <CoachWorkspacePlaceholderPanel
            title="Asistente IA"
            description="El asistente va a proponer cambios de sesión, semana o plan: tú revisas y confirmas antes de aplicarlos."
          />
        )}
      </div>
    </div>
  )
}
```

Notes:
- The coach/redirect check is placed **after** the hooks (`useState`, `useEffect`, `useCallback`) to keep hook call order stable across renders — same pattern already used in `CoachRosterPage.tsx` today.
- `handleAthleteAction` (switch+navigate) and `handleCreateAthlete` (create+activate) delegate the actual decision logic to Task 3's `selectAthleteAndNavigate`/`createAndActivateAthlete` — this component only owns UI state (`pendingAthleteAction`, `actionMessage`) around those calls.
- Layout: `md:grid md:grid-cols-[200px_1fr]` puts `CoachWorkspaceNav` in a 200px sidebar column at `md` and above; below `md`, the grid collapses and `CoachWorkspaceNav`'s own responsive classes (Task 1) turn it into a horizontal scrollable tab bar.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/CoachWorkspacePage.test.tsx`
Expected: PASS (6 tests)

---

### Task 7: `CoachContextBar` error handling, router wiring, retire `CoachRosterPage`

**Files:**
- Modify: `src/components/layout/CoachContextBar.tsx`
- Modify: `src/App.tsx:35` (lazy import), `src/App.tsx:344` (route element)
- Delete: `src/pages/CoachRosterPage.tsx`
- Delete: `src/pages/CoachRosterPage.test.tsx`

**Interfaces:**
- Consumes: `CoachWorkspacePage` default export (Task 6).

- [ ] **Step 1: Fix the unhandled rejection in `CoachContextBar`**

In `src/components/layout/CoachContextBar.tsx`, the effect currently is:

```tsx
  useEffect(() => {
    if (!isCoach || !user?.id) return
    let cancelled = false
    void listOwnedAthletes(user.id).then((rows) => {
      if (!cancelled) setAthletes(rows)
    })
    return () => { cancelled = true }
  }, [isCoach, user?.id, activeAthleteId])
```

Change it to add a `.catch`, matching v0's accepted "two independent local reads" decision (see this plan's Architecture section):

```tsx
  useEffect(() => {
    if (!isCoach || !user?.id) return
    let cancelled = false
    listOwnedAthletes(user.id)
      .then((rows) => {
        if (!cancelled) setAthletes(rows)
      })
      .catch((error) => {
        console.error('[coach-context-bar] failed to load roster', error)
      })
    return () => { cancelled = true }
  }, [isCoach, user?.id, activeAthleteId])
```

(No test added for this — it's a defensive `.catch` with no observable markup difference, and this component's existing tests are `renderToStaticMarkup`-only, which never runs effects. Covered by the Playwright smoke in Task 8 not crashing, and by manual verification that no unhandled-rejection console error appears.)

- [ ] **Step 2: Update the lazy import in `src/App.tsx`**

Change line 35 from:

```tsx
const CoachRosterPage = lazy(() => import('./pages/CoachRosterPage'))
```

to:

```tsx
const CoachWorkspacePage = lazy(() => import('./pages/CoachWorkspacePage'))
```

- [ ] **Step 3: Update the route element in `src/App.tsx`**

Change line 344 from:

```tsx
                <Route path={ROUTES.COACH} element={<RouteBoundary><CoachRosterPage /></RouteBoundary>} />
```

to:

```tsx
                <Route path={ROUTES.COACH} element={<RouteBoundary><CoachWorkspacePage /></RouteBoundary>} />
```

- [ ] **Step 4: Delete the superseded page and its test**

Run:
```bash
rm src/pages/CoachRosterPage.tsx src/pages/CoachRosterPage.test.tsx
```

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — no failures.

If anything still imports `CoachRosterPage`, find it with:
```bash
grep -rn "CoachRosterPage" src
```
Expected: no matches.

- [ ] **Step 6: Run lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Run build**

Run: `npm run build`
Expected: build succeeds (this also runs `tsc -b`, catching any type mismatch between the new panels and their consumers).

---

### Task 8: Playwright smoke + manual visual check

This is the piece that actually exercises clicks, tab switching, athlete switching, and create —
none of which the `renderToStaticMarkup` unit tests above can drive. It extends the existing dev
e2e script (`scripts/e2e-coach-test.mjs`), reusing its auth-state/navigation helpers, rather than
introducing a new test runner.

**Files:**
- Modify: `scripts/e2e-coach-test.mjs`

**Interfaces:**
- Consumes: the running dev server's `/coach` route (Task 7), and this script's existing helpers (`goto`, `step`, `ok`, `fail`, `safeCheck`, `waitForBodyText`, `hasBodyTextAfterWait`).

- [ ] **Step 1: Add `runCoachWorkspaceSmoke` to `scripts/e2e-coach-test.mjs`**

Add this function after `runWeeklyViewVerification` (and before `saveFailureArtifacts`):

```js
async function runCoachWorkspaceSmoke(page) {
  step('8. Coach workspace (/coach)')
  await goto(page, '/coach')
  const isCoachUi = await hasBodyTextAfterWait(page, /Workspace de coach/i, 5_000)
  if (!isCoachUi) {
    ok('Coach workspace omitido', 'la cuenta autenticada no está en VITE_COACH_ACCOUNTS')
    return
  }

  await safeCheck('Tab Resumen es el default y muestra CTAs', async () => {
    await waitForBodyText(page, /Ver semana/i)
    ok('Tab Resumen es el default y muestra CTAs')
  })

  await safeCheck('Tab Alumnos muestra el roster y el CTA de crear', async () => {
    await page.getByRole('tab', { name: /Alumnos/i }).click()
    await waitForBodyText(page, /Crear atleta/i)
    ok('Tab Alumnos muestra el roster y el CTA de crear')
  })

  await safeCheck('Tabs Planificación/Biblioteca/Asistente IA muestran "próximamente"', async () => {
    await page.getByRole('tab', { name: /Planificación/i }).click()
    await waitForBodyText(page, /Vas a poder crear y editar sesiones/i)
    await page.getByRole('tab', { name: /Biblioteca/i }).click()
    await waitForBodyText(page, /Vas a poder guardar tus ejercicios/i)
    await page.getByRole('tab', { name: /Asistente IA/i }).click()
    await waitForBodyText(page, /revisas y confirmas/i)
    ok('Tabs "próximamente" muestran su copy')
  })

  await safeCheck('Volver a Resumen y abrir semana del atleta activo', async () => {
    await page.getByRole('tab', { name: /^Resumen/i }).click()
    await page.getByRole('button', { name: /Ver semana/i }).first().click()
    await waitForBodyText(page, /Semana|Weekly planner|Sin sesiones planificadas|Día libre|Dia libre/i)
    ok('CTA "Ver semana" navega a /week')
  })
}
```

- [ ] **Step 2: Call it from `main()`**

In the `main()` function, add the call right after `await runWeeklyViewVerification(page)` and before `await verifySettingsQuality(page)`:

```js
    await runWeeklyViewVerification(page)
    await runCoachWorkspaceSmoke(page)
    await verifySettingsQuality(page)
```

- [ ] **Step 3: Run the extended e2e script**

Start the dev server first (`npm run dev` in a separate terminal), then run:

```bash
npm run e2e:dev:quick
```

Expected: all checks PASS, including the new "8. Coach workspace (/coach)" section. If the authenticated test account isn't in `VITE_COACH_ACCOUNTS`, the section reports `ok('Coach workspace omitido', ...)` instead of failing — that's expected, not a bug; re-run with a coach-allowlisted account to actually exercise `/coach`.

- [ ] **Step 4: Manual visual check (viewport-dependent, not automated)**

The Playwright script above runs at a fixed 1280×900 viewport, so it never exercises the mobile
layout. In the browser (same dev server), signed in as a coach account:

1. Open `/coach` at a narrow width (resize the window below ~768px, or use devtools device mode). Confirm the five-area nav renders as a horizontal, scrollable tab bar at the top (not a sidebar).
2. Widen the window back past ~768px. Confirm the nav switches to a vertical sidebar on the left, with the panel content to its right.
3. Confirm no console errors appear on either layout (open devtools console).
4. On the Alumnos tab, create an athlete by pressing **Enter** in the name field (not clicking the button) — confirm the form submits and the redirect to onboarding happens, verifying the `<form>` fix from Task 5.

Report both the Playwright run result and this manual check before considering this task done.

**Do not run `git add` or `git commit`** — per CLAUDE.md, commits are made by the project owner. Leave the working tree as-is for review.

---

## Self-Review Notes

- **Spec coverage:** nav with 5 areas in order, responsive sidebar/tabs (Task 1), 3 "próximamente" placeholders with tuteo copy (Task 2, wired in Task 6), Resumen cards limited to `listOwnedAthletes` fields with no computed signals (Task 4), Alumnos roster+create with form submit (Task 5), single-step switch-then-navigate CTA behavior with pending/error feedback, extracted and unit-tested (Task 3, wired in Task 6), loading/error/empty/self-only states for both real tabs (Tasks 4–5), route wiring + old page retirement + full verification (Task 7), end-to-end click coverage via Playwright + a manual viewport check (Task 8). All bullets from the spec's "Alcance de `Coach Workspace v0`" and "Decisiones a cerrar" sections are covered, plus every finding from the 2026-07-12 review round: extracted/unit-tested switch and create logic (Task 3), fixed the `CoachContextBar` unhandled rejection and documented the two-reads decision instead of the wrong "single fetch" claim (Task 7, Architecture section), corrected the self-only empty-state semantics (Task 4), fixed the partially-successful-creation data loss (Task 3 + Task 6's `handleCreateAthlete`), added pending/disabled-button state and an `role="alert"` error banner for failed switches (Task 4/5/6), responsive sidebar nav with proper `tablist`/`tab`/`tabpanel` ARIA (Task 1 + Task 6), `<form onSubmit>` for the create flow (Task 5), and consistent tuteo copy (Task 6, verified in its test).
- **Out of scope, confirmed absent from this plan:** aggregate multi-athlete signal queries, `/coaches` public landing and legal routes, Biblioteca data model, session/exercise assignment, unifying the three AI modes, `account_type` gating change, arrow-key roving tabindex on the tab list (noted as accepted future polish, not required for v0's ARIA correctness — `tablist`/`tab`/`tabpanel`/`aria-selected`/`aria-controls` are implemented; keyboard arrow navigation between tabs is not).
- **Type consistency:** `RosterStatus`, `CoachWorkspaceTab`, and `PendingAthleteAction` are defined once in Task 1 and imported (never redefined) by Tasks 4, 5, and 6. `Athlete` is always imported from `../../types` (or `../types` from the page). Prop names match exactly between producer and consumer (`onOpenWeek`/`onOpenPlan`/`pendingAction` in `CoachSummaryPanel` vs. `CoachWorkspacePage`'s call sites; `onCreateAthlete`/`onTrainAs`/`pendingAction` in `CoachRosterPanel` vs. its call sites; `selectAthleteAndNavigate`/`createAndActivateAthlete`'s injected-deps shape matches exactly how `CoachWorkspacePage` calls them in Task 6).

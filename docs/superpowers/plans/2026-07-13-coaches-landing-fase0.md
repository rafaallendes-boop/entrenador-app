# Coaches Landing Fase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Fase 0 for the public coach landing per `docs/superpowers/specs/coach-landing-strategy.md`: give the app a real public-routes architecture, publish the four canonical legal pages, ship a standalone `/coaches` **paid-launch prelaunch** landing with honest copy and, once captured, real screenshots, and smoke DEV. There will be no pilot/demo. The owner temporarily confirmed `Rafael Allendes` as the public controller identity; paid activation still waits for payments, commercial terms, persistent roles and versioned acceptance.

**Execution status (2026-07-13):** routes, legal pages, route-specific client and built-HTML metadata, auth-aware public navigation, legal links and the `/coaches` copy are implemented. Real anonymized captures are still pending. To avoid publishing broken images or a false “capturas reales” claim, the screenshot section is intentionally absent until Task 5 produces and validates all three files; Fase 0 is not considered visually closed before then.

**Architecture:** `App.tsx`'s router today has exactly one catch-all route (`path="*"`) that always renders `AuthGate`, which internally string-matches `pathname` to decide whether to show `LandingPage`, `FeaturesPage`, or `PricingPage` for a signed-out visitor — so `/features` and `/pricing` are not real routes, and any other path (`/coaches`, `/terms`, …) silently falls through to `LandingPage`. This plan adds explicit sibling `<Route>` elements for every new public path, outside `AuthGate`, so React Router's own path matching decides what renders — no more pathname string-matching inside a component. `/` stays exactly as it is today (conditional: `AuthGate` shows `LandingPage` to visitors, `Dashboard` to signed-in users) — this plan does not touch that behavior.

**Tech Stack:** React + TypeScript + react-router-dom (`Route`, `Link`, `MemoryRouter` in tests), Vitest (`renderToStaticMarkup` convention, no `@testing-library/react`), existing brand tokens (`#ff4d00` brand orange, Lexend/JetBrains Mono, dark `#0a0a0a` surface) — no new dependencies.

## Global Constraints

- Spec of record: `docs/superpowers/specs/coach-landing-strategy.md`, sections "Fase 0 — Ahora" and "Decisiones cerradas para Fase 0". This plan implements **only** Fase 0.
- **New explicit public routes:** `/features`, `/pricing`, `/coaches`, `/terms`, `/privacy`, `/health-disclaimer`, `/whoop-disclaimer`. `/` stays **conditional** (visitor → `LandingPage`, signed-in → `Dashboard`) — do not make `/` an unconditional public landing. This is a deliberate, closed decision; do not revisit it in this plan.
- **`/coaches` is a separate landing, not a recycling of the athlete landing.** It gets its own nav/footer, not `SharedPublicNav` (which is athlete-funnel branded: "Empezar gratis" CTA, links to `/`, `/features`, `/pricing`). Do not add coach-funnel links into `SharedPublicNav` or vice versa.
- **Single conversion action on `/coaches` during prelaunch:** every primary CTA says "Avisarme del lanzamiento" and points to the exact same `mailto:hola@rallyiq.cl` with a prefilled subject. The action may be repeated in the nav, hero and closing block. At paid activation it is replaced by "Elegir plan" pointing to the real checkout. No "Solicitar demo", free-start claim, WhatsApp link or competing primary action.
- **Keep the athlete funnel separate.** Signed-out visitors on `/`, `/features` and `/pricing` keep "Empezar gratis" / "Ver precios". Signed-in users see "Ir a mi panel" instead of being offered OAuth again. Unifying the coach and athlete funnels is an explicit non-goal of this plan (separate commercial decision, out of scope).
- **Whoop copy rule (project-wide, CLAUDE.md):** whenever Whoop is mentioned in new copy, it must read "contexto objetivo opcional y consentido" — never diagnosis, injury prevention, or automatic plan adjustment.
- **Legal content is the owner's content, not invented text.** On 2026-07-13 the owner explicitly approved `Rafael Allendes` as the temporary public controller identity. It lives once in `src/constants/legal.ts` so it can be replaced when the final person/entity is decided. This is an owner decision, not an inference from Git. No RUT or domicilio has been provided, so neither is invented or published; completing those disclosures and obtaining legal review remain launch gates. The initial paid product is adults-only. Payment processor, renewal, cancellation and refund text remains a paid-launch gate because no payment flow exists yet.
- **Reconcile, don't duplicate, the privacy policy.** `docs/legal/politica-de-privacidad.md` and `public/legal/privacidad/index.html` currently diverge in content, not just format. This plan creates one reconciled `PrivacyPage`, removes the legacy static HTML from the build, and adds a permanent redirect from `/legal/privacidad/` to `/privacy`; Fase 0 must not leave two publicly reachable policies. The reconciled page cites Ley 19.628 as the current framework and Ley 21.719 as a published reform whose changes enter into force on **2026-12-01**, not as law already in force. Flag the full legal text to the owner for sign-off and legal review before the public prelaunch or any paid launch.
- **Publishing legal pages is not consent logging.** These routes close the public-information/linking prerequisite for Fase 0. They do not close the separate roadmap items for versioned acceptance of terms/privacy or durable biometric-consent records. Do not report those items as complete merely because the pages exist.
- No new dependencies. Component tests follow the existing project convention (`renderToStaticMarkup` + `MemoryRouter` where a component uses `<Link>`; no `@testing-library/react`).
- **Coach access remains transitional in this plan.** `VITE_COACH_ACCOUNTS` is a public build-time allowlist, not a Netlify Function and not authorization. Keep it for owner/QA only. Public paid coach registration requires a separate plan for accumulated account roles (`athlete`, `coach`) plus a UI-only `default_mode`; do not introduce an exclusive `account_type`.
- **Commits are made by the project owner only** (CLAUDE.md rule) — do **not** run `git add` / `git commit` at the end of a task unless the owner has explicitly authorized it for this run (as they did for the `coach-workspace-v0` plan's isolated worktree). Each task ends with tests passing and the working tree left as-is for the owner to review and commit, unless told otherwise.
- Before considering the whole plan done, run `npm run lint && npm test && npm run build` (CLAUDE.md pre-commit rule) and do the DEV/production-prelaunch smoke described in Task 7.

---

## File Structure

New files:

- `src/constants/legal.ts` — owner-confirmed controller identity and temporary adults-only policy, shared by Terms and Privacy.
- `src/components/legal/LegalPageLayout.tsx` (+ test) — shared shell (eyebrow, title, "última actualización" date, dark-mode prose styling) reused by all four legal pages.
- `src/pages/TermsPage.tsx` (+ test) — `/terms`.
- `src/pages/HealthDisclaimerPage.tsx` (+ test) — `/health-disclaimer`.
- `src/pages/PrivacyPage.tsx` (+ test) — `/privacy`.
- `src/pages/WhoopDisclaimerPage.tsx` (+ test) — `/whoop-disclaimer`.
- `src/pages/CoachesLandingPage.tsx` (+ test) — `/coaches`.
- `src/constants/routes.test.ts` — locks in the five new route constants.
- `src/hooks/usePageMetadata.ts` — route-specific title, description, Open Graph, Twitter and canonical metadata for the seven public routes.
- `scripts/generate-public-route-html.mjs` — emits a route entry HTML after Vite builds so link-preview crawlers receive that metadata without needing to execute React.
- `src/components/SharedPublicNav.test.tsx`, `src/pages/PublicLegalLinks.test.tsx` — lock auth-aware navigation and the four legal destinations across the athlete funnel.

Modified:

- `src/constants/routes.ts` — add `COACHES`, `TERMS`, `PRIVACY`, `HEALTH_DISCLAIMER`, `WHOOP_DISCLAIMER`.
- `src/App.tsx` — add explicit `<Route>` elements for `/features`, `/pricing`, and (task by task, as each page is built) `/coaches`, `/terms`, `/privacy`, `/health-disclaimer`, `/whoop-disclaimer`.
- `src/components/auth/AuthGate.tsx` — remove the now-dead `pathname === '/features'` / `'/pricing'` special-casing; it always shows `LandingPage` to signed-out visitors on any path that isn't one of the new explicit routes (unchanged from today's fallback behavior for those paths).
- `src/components/SharedPublicNav.tsx` — signed-in users see `Ir a mi panel`; public pages never re-trigger OAuth for an authenticated account.
- `package.json` — the build runs the public-route HTML metadata generator after Vite.
- `netlify.toml` — add a forced permanent redirect from the legacy `/legal/privacidad/` URL to `/privacy` and exact rewrites for the seven generated public-route HTML files, all before the SPA catch-all.
- `src/pages/LandingPage.tsx`, `src/pages/FeaturesPage.tsx`, `src/pages/PricingPage.tsx` — footer legal links point at the real routes instead of `mailto:hola@rallyiq.cl`.
- `public/coaches/` (pending directory) — real, anonymized and optimized screenshots (Task 5). Do not reference these paths from markup until the files exist.

Deleted:

- `public/legal/privacidad/index.html` — replaced by the reconciled `/privacy` route. The redirect in `netlify.toml` preserves the old public URL.

## Preflight and launch gates

### Resolved product decisions

- **No pilot/demo:** the product will launch paid. Fase 0 uses prelaunch copy until checkout is real.
- **Minors:** initial launch is adults-only. `MINORS_POLICY_COPY` states that RallyIQ does not accept accounts or athlete data for people under 18. Supporting minors later requires legal review plus verifiable representative consent; copy alone is insufficient.
- **Coach roles:** the paid launch must replace the manual Netlify allowlist with persistent, accumulated account roles. A coach-player has both `athlete` and `coach`; `default_mode` chooses the initial UI but grants no access. `athlete_memberships` remains the authorization source per athlete.
- **Temporary legal identity:** `LEGAL_CONTROLLER_NAME = 'Rafael Allendes'`, explicitly approved by the owner and centralized for later replacement.

### Still unresolved for paid activation

1. **Payment/commercial contract:** provider, price, currency, taxes/document issued, renewal, cancellation, refunds, webhook/entitlement behavior and failure states.

Payment does not block the informational prelaunch. No `[[...]]`, `<...>` or guessed proper name may ship.

### Operational bridge in Netlify (today)

To enable the current owner account as coach, configure `VITE_COACH_ACCOUNTS` as a Netlify
**environment variable**, not as a Netlify Function. Its value is the exact login email; if
more than one temporary coach/QA account is needed, use comma-separated emails. Because Vite
embeds this value at build time, trigger a new deploy after every change. This flag only exposes
the coach UI; memberships/RLS remain the authorization boundary. Do not use this mechanism for
public coach registration.

### Paid-launch gate (separate implementation plan required)

Before changing the CTA from "Avisarme del lanzamiento" to "Elegir plan":

1. Confirm legal identity and legally review Terms/Privacy/health/Whoop text.
2. Integrate payment checkout, server-verified webhook, durable entitlement, cancellation and refund handling.
3. Add versioned acceptance of Terms/Privacy and durable biometric consent where applicable.
4. Enforce adults-only in signup/onboarding, not only in copy.
5. Replace `VITE_COACH_ACCOUNTS` with persistent accumulated roles and test player, coach and coach-player accounts.
6. Update CTA destination to the real checkout and run payment success/failure/cancel smoke before charging anyone.

---

### Task 1: Public routes architecture

**Files:**
- Modify: `src/constants/routes.ts`
- Create: `src/constants/routes.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/auth/AuthGate.tsx`

**Interfaces:**
- Produces: `ROUTES.COACHES`, `ROUTES.TERMS`, `ROUTES.PRIVACY`, `ROUTES.HEALTH_DISCLAIMER`, `ROUTES.WHOOP_DISCLAIMER` — string constants consumed by Tasks 2-6 when they wire their own `<Route>` and internal `<Link>`s.

- [ ] **Step 1: Write the failing test**

Create `src/constants/routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ROUTES } from './routes'

describe('ROUTES', () => {
  it('defines the new public routes for Coaches Landing Fase 0', () => {
    expect(ROUTES.COACHES).toBe('/coaches')
    expect(ROUTES.TERMS).toBe('/terms')
    expect(ROUTES.PRIVACY).toBe('/privacy')
    expect(ROUTES.HEALTH_DISCLAIMER).toBe('/health-disclaimer')
    expect(ROUTES.WHOOP_DISCLAIMER).toBe('/whoop-disclaimer')
  })

  it('keeps the existing FEATURES and PRICING routes unchanged', () => {
    expect(ROUTES.FEATURES).toBe('/features')
    expect(ROUTES.PRICING).toBe('/pricing')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/constants/routes.test.ts`
Expected: FAIL — `ROUTES.COACHES` (and the other four) is `undefined`, not `'/coaches'`.

- [ ] **Step 3: Add the five route constants**

Edit `src/constants/routes.ts` — the file today is:

```ts
export const ROUTES = {
  HOME:             '/',
  FEATURES:         '/features',
  PRICING:          '/pricing',
  WEEK:             '/week',
  DAY:              (date: string) => `/day/${date}`,
  CHAT:             '/chat',
  PLAN_BUILDER:     '/plan-builder',
  COMPETITION_PLAN: '/competition-plan',
  PLAN_BUILDER_V2: '/plans/builder',
  SETTINGS:         '/settings',
  IMPORT:           '/import',
  ONBOARDING:       '/onboarding',
  COACH:            '/coach',
  IOS_WELCOME_PREVIEW: '/preview/ios-welcome',
} as const
```

Add the five new entries (anywhere in the object; grouped here after `PRICING` for readability):

```ts
export const ROUTES = {
  HOME:             '/',
  FEATURES:         '/features',
  PRICING:          '/pricing',
  COACHES:          '/coaches',
  TERMS:            '/terms',
  PRIVACY:          '/privacy',
  HEALTH_DISCLAIMER: '/health-disclaimer',
  WHOOP_DISCLAIMER: '/whoop-disclaimer',
  WEEK:             '/week',
  DAY:              (date: string) => `/day/${date}`,
  CHAT:             '/chat',
  PLAN_BUILDER:     '/plan-builder',
  COMPETITION_PLAN: '/competition-plan',
  PLAN_BUILDER_V2: '/plans/builder',
  SETTINGS:         '/settings',
  IMPORT:           '/import',
  ONBOARDING:       '/onboarding',
  COACH:            '/coach',
  IOS_WELCOME_PREVIEW: '/preview/ios-welcome',
} as const
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/constants/routes.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Convert `/features` and `/pricing` into real explicit routes**

In `src/App.tsx`, add two lazy imports next to the existing page imports (around line 33-37):

```tsx
const FeaturesPage = lazy(() => import('./pages/FeaturesPage'))
const PricingPage = lazy(() => import('./pages/PricingPage'))
```

Then add two `<Route>` siblings to the existing `<Route path={ROUTES.IOS_WELCOME_PREVIEW} .../>` and `<Route path="*" element={<AuthGate>...}>` block — insert them between those two, still inside the outer `<Routes>` (react-router ranks explicit static paths above `*` regardless of order, but keeping them near each other reads clearly):

```tsx
          <Route path={ROUTES.IOS_WELCOME_PREVIEW} element={<NativeWelcomePreviewPage />} />
          <Route path={ROUTES.FEATURES} element={<RouteBoundary><FeaturesPage /></RouteBoundary>} />
          <Route path={ROUTES.PRICING} element={<RouteBoundary><PricingPage /></RouteBoundary>} />
          <Route path="*" element={(
            <AuthGate>
```

Note: `RouteBoundary` wraps children in an error boundary keyed by `location.pathname` (defined earlier in the same file, already used for every other top-level page route) — reuse it here for consistency, not a new pattern.

- [ ] **Step 6: Simplify `AuthGate` — remove the now-dead pathname special-casing**

`src/components/auth/AuthGate.tsx` today is:

```tsx
import { lazy, Suspense, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/useAuthStore'

const LandingPage = lazy(() => import('../../pages/LandingPage'))
const FeaturesPage = lazy(() => import('../../pages/FeaturesPage'))
const PricingPage = lazy(() => import('../../pages/PricingPage'))

interface AuthGateProps {
  children: ReactNode
}

function AuthLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="rounded-card border border-surface-border bg-surface-card px-8 py-10 text-center shadow-card">
        <div className="mx-auto h-8 w-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
        <p className="mt-4 text-sm font-medium text-ink">Preparando tu sesión</p>
        <p className="mt-1 text-xs text-ink-muted">Estamos restaurando tu acceso y sincronización.</p>
      </div>
    </div>
  )
}

export default function AuthGate({ children }: AuthGateProps) {
  const user = useAuthStore(s => s.user)
  const isLoading = useAuthStore(s => s.isLoading)
  const { pathname } = useLocation()

  if (isLoading) {
    return <AuthLoading />
  }

  if (!user) {
    if (pathname === '/features') {
      return <Suspense fallback={<AuthLoading />}><FeaturesPage /></Suspense>
    }
    if (pathname === '/pricing') {
      return <Suspense fallback={<AuthLoading />}><PricingPage /></Suspense>
    }
    return (
      <Suspense fallback={<AuthLoading />}>
        <LandingPage />
      </Suspense>
    )
  }

  return <>{children}</>
}
```

Now that `/features` and `/pricing` are real routes matched by React Router BEFORE the `path="*"` route ever renders `AuthGate`, `AuthGate` never receives a request for those two paths again — the pathname check is dead code. Replace the whole file with:

```tsx
import { lazy, Suspense, type ReactNode } from 'react'
import { useAuthStore } from '../../store/useAuthStore'

const LandingPage = lazy(() => import('../../pages/LandingPage'))

interface AuthGateProps {
  children: ReactNode
}

function AuthLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-6">
      <div className="rounded-card border border-surface-border bg-surface-card px-8 py-10 text-center shadow-card">
        <div className="mx-auto h-8 w-8 rounded-full border-2 border-brand border-t-transparent animate-spin" />
        <p className="mt-4 text-sm font-medium text-ink">Preparando tu sesión</p>
        <p className="mt-1 text-xs text-ink-muted">Estamos restaurando tu acceso y sincronización.</p>
      </div>
    </div>
  )
}

export default function AuthGate({ children }: AuthGateProps) {
  const user = useAuthStore(s => s.user)
  const isLoading = useAuthStore(s => s.isLoading)

  if (isLoading) {
    return <AuthLoading />
  }

  if (!user) {
    return (
      <Suspense fallback={<AuthLoading />}>
        <LandingPage />
      </Suspense>
    )
  }

  return <>{children}</>
}
```

This is the exact fix the owner described: `/` stays conditional through `AuthGate` (visitor → `LandingPage`, signed-in → the nested route tree's `Dashboard`), completely unchanged — only the incidental `/features`/`/pricing` string-matching is removed, because it's now handled by real routes instead.

- [ ] **Step 7: Run the full test suite, lint, and build**

Run: `npm test`
Expected: PASS — no test referenced the removed `FeaturesPage`/`PricingPage` imports inside `AuthGate` (there was no `AuthGate.test.tsx` before this task), so nothing else should break.

Run: `npm run lint`
Expected: no errors (confirms no now-unused imports were left behind in `AuthGate.tsx`).

Run: `npm run build`
Expected: succeeds — `tsc -b` catches it if `useLocation` or `FeaturesPage`/`PricingPage` imports were left dangling in `AuthGate.tsx`.

- [ ] **Step 8: Manual smoke of this task alone**

With `npm run dev` running, in a signed-out browser session:
1. Visit `/features` and `/pricing` directly (not via in-app links) — confirm they still render `FeaturesPage`/`PricingPage` exactly as before.
2. Visit `/` — confirm it still shows `LandingPage`.
3. Sign in, then visit `/` — confirm it still shows `Dashboard` (the conditional behavior is unchanged).
4. While signed in, visit `/features` and `/pricing` — confirm both remain public informational pages and their nav/CTAs show `Ir a mi panel`, without offering or invoking Google sign-in again.

---

### Task 2: `LegalPageLayout` shared shell + Terms + Health Disclaimer pages

**Files:**
- Create: `src/constants/legal.ts` (only after Preflight item 1 is answered)
- Create: `src/components/legal/LegalPageLayout.tsx`
- Test: `src/components/legal/LegalPageLayout.test.tsx`
- Create: `src/pages/TermsPage.tsx`
- Test: `src/pages/TermsPage.test.tsx`
- Create: `src/pages/HealthDisclaimerPage.tsx`
- Test: `src/pages/HealthDisclaimerPage.test.tsx`
- Modify: `src/App.tsx` (wire `/terms` and `/health-disclaimer`)

**Interfaces:**
- Consumes: `ROUTES.HOME`, `ROUTES.TERMS`, `ROUTES.HEALTH_DISCLAIMER` (Task 1).
- Produces: `export default function LegalPageLayout(props: { eyebrow: string; title: string; updatedAt: string; children: ReactNode }): JSX.Element` — reused by every legal page task in this plan (Tasks 2 and 3).

**Owner input resolved on 2026-07-13:** use `Rafael Allendes` temporarily as `LEGAL_CONTROLLER_NAME`. Keep the value centralized so it can be changed when the final legal person/entity is decided. The adults-only policy and `hola@rallyiq.cl` contact are also closed. Do not invent a processor, price, renewal model or refund policy: those belong to the separate paid-launch gate and no payment flow exists today.

- [ ] **Step 1: Write the failing test for `LegalPageLayout`**

Create `src/components/legal/LegalPageLayout.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import LegalPageLayout from './LegalPageLayout'

describe('LegalPageLayout', () => {
  it('renders the eyebrow, title, update date and children', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LegalPageLayout eyebrow="Legal" title="Título de prueba" updatedAt="2026-07-13">
          <p>Contenido de prueba</p>
        </LegalPageLayout>
      </MemoryRouter>,
    )
    expect(html).toContain('Legal')
    expect(html).toContain('Título de prueba')
    expect(html).toContain('2026-07-13')
    expect(html).toContain('Contenido de prueba')
  })

  it('links the RallyIQ wordmark back to home', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LegalPageLayout eyebrow="Legal" title="X" updatedAt="2026-07-13">
          <p>x</p>
        </LegalPageLayout>
      </MemoryRouter>,
    )
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>\s*RallyIQ/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/legal/LegalPageLayout.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write `LegalPageLayout`**

Create `src/components/legal/LegalPageLayout.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ROUTES } from '../../constants/routes'

const BRAND = '#ff4d00'
const INK = '#f5f5f7'
const INK_MUTED = '#a0a0a5'
const INK_FAINT = '#72727a'
const SURFACE_BORDER = 'rgba(255,255,255,0.1)'
const FONT_MONO = "'JetBrains Mono', 'Fira Mono', monospace"

interface LegalPageLayoutProps {
  eyebrow: string
  title: string
  updatedAt: string
  children: ReactNode
}

export default function LegalPageLayout({ eyebrow, title, updatedAt, children }: LegalPageLayoutProps) {
  return (
    <div style={{ background: '#0a0a0a', color: INK, minHeight: '100vh', fontFamily: "'Inter', system-ui, sans-serif", lineHeight: 1.6 }}>
      <main style={{ maxWidth: 860, margin: '0 auto', padding: '56px 20px 80px' }}>
        <header style={{ borderBottom: `1px solid ${SURFACE_BORDER}`, marginBottom: 32, paddingBottom: 28 }}>
          <Link
            to={ROUTES.HOME}
            style={{
              fontFamily: FONT_MONO, fontSize: 14, fontWeight: 700,
              color: INK, textDecoration: 'none',
            }}
          >
            RallyIQ
          </Link>
          <div
            style={{
              fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700,
              letterSpacing: '0.22em', textTransform: 'uppercase', color: BRAND,
              marginTop: 20, marginBottom: 12,
            }}
          >
            {eyebrow}
          </div>
          <h1 style={{ margin: '0 0 12px', fontSize: 'clamp(34px, 6vw, 54px)', lineHeight: 1.15, letterSpacing: '-0.01em', color: INK }}>
            {title}
          </h1>
          <p style={{ color: INK_FAINT, fontSize: 13, margin: 0 }}>Última actualización: {updatedAt}</p>
        </header>
        <div className="legal-content">
          {children}
        </div>
      </main>
      <style>{`
        .legal-content h2 { margin: 36px 0 12px; font-size: 22px; line-height: 1.15; letter-spacing: -0.01em; color: ${INK}; }
        .legal-content p, .legal-content li { color: ${INK_MUTED}; line-height: 1.6; }
        .legal-content strong { color: ${INK}; }
        .legal-content ul { padding-left: 20px; margin: 12px 0; }
        .legal-content li { margin-bottom: 6px; }
        .legal-content a { color: #ff8a4d; }
      `}</style>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/legal/LegalPageLayout.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 4b: Record the owner-confirmed legal constants**

Only after the legal identity is confirmed, create `src/constants/legal.ts` exporting:

- `LEGAL_CONTROLLER_NAME`: the exact public legal identity confirmed by the owner.
- `MINORS_POLICY_COPY`: the closed adults-only rule, exactly:
  `RallyIQ no está disponible para personas menores de 18 años ni permite registrar datos de atletas menores de 18 años durante esta etapa.`

Use literal confirmed strings, not environment variables (these are public disclosures), and do not commit placeholders or inferred values. Terms and Privacy import these constants so the identity/policy cannot drift between pages.

- [ ] **Step 5: Write the failing test for `TermsPage`**

Create `src/pages/TermsPage.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { LEGAL_CONTROLLER_NAME, MINORS_POLICY_COPY } from '../constants/legal'
import TermsPage from './TermsPage'

describe('TermsPage', () => {
  it('renders the title, the confirmed controller identity, and the payment-not-live note', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    )
    expect(html).toContain('Términos y Condiciones')
    expect(html).toContain(LEGAL_CONTROLLER_NAME)
    expect(html).toContain('hola@rallyiq.cl')
    expect(html).toContain(MINORS_POLICY_COPY)
    expect(html).not.toContain('[[')
    expect(html).toContain('aún no habilita contratación ni cobros')
  })

  it('links to the health disclaimer and privacy policy', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TermsPage />
      </MemoryRouter>,
    )
    expect(html).toContain('href="/health-disclaimer"')
    expect(html).toContain('href="/privacy"')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/pages/TermsPage.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 7: Write `TermsPage`**

Create `src/pages/TermsPage.tsx` — adapted from `docs/legal/terminos-y-condiciones.md` after the Preflight decisions are recorded. Import the confirmed legal identity rather than duplicating it in page copy:

```tsx
import { Link } from 'react-router-dom'
import LegalPageLayout from '../components/legal/LegalPageLayout'
import { LEGAL_CONTROLLER_NAME, MINORS_POLICY_COPY } from '../constants/legal'
import { ROUTES } from '../constants/routes'

export default function TermsPage() {
  return (
    <LegalPageLayout eyebrow="Legal" title="Términos y Condiciones" updatedAt="2026-07-13">
      <p>
        <strong>Titular del servicio:</strong> {LEGAL_CONTROLLER_NAME}.
        Si cambia la persona o entidad titular del servicio, esta sección y la Política de
        Privacidad se actualizarán antes de que el cambio produzca efectos para los usuarios.
      </p>
      <p><strong>Contacto:</strong> hola@rallyiq.cl</p>
      <p><strong>Jurisdicción:</strong> Chile (con expansión internacional posterior).</p>
      <p>
        Al crear una cuenta o usar RallyIQ ("el servicio") aceptas estos Términos. Si no
        estás de acuerdo, no uses el servicio.
      </p>

      <h2>1. Qué es el servicio</h2>
      <p>
        RallyIQ es una aplicación de planificación y seguimiento de entrenamiento deportivo
        (squash, fuerza, running, movilidad), con asistencia de inteligencia artificial. El
        servicio <strong>no es consejo médico</strong>; ver el{' '}
        <Link to={ROUTES.HEALTH_DISCLAIMER}>Descargo de responsabilidad de salud</Link>, que
        forma parte de estos Términos.
      </p>

      <h2>2. Cuenta y acceso</h2>
      <ul>
        <li>Necesitas una cuenta (vía inicio de sesión con Google) para usar el servicio.</li>
        <li>Eres responsable de la actividad de tu cuenta y de mantener segura tu sesión.</li>
        <li>Debes tener al menos 18 años para crear una cuenta o contratar el servicio.</li>
      </ul>
      <p>{MINORS_POLICY_COPY}</p>

      <h2>3. Suscripción, pagos y renovación</h2>
      <p>
        <strong>RallyIQ aún no habilita contratación ni cobros.</strong> Antes del lanzamiento
        pagado, esta sección se actualizará con precio, moneda, impuestos o documento tributario,
        renovación, cancelación y reembolsos. La versión vigente deberá aceptarse explícitamente
        antes de realizar el primer cobro.
      </p>

      <h2>4. Uso aceptable</h2>
      <p>
        No puedes: usar el servicio para fines ilegales; revender o redistribuir masivamente
        el software o sus contenidos fuera del servicio; intentar vulnerar la seguridad,
        extraer datos masivamente o interferir con el funcionamiento del servicio. Si usas
        RallyIQ como coach, sí puedes compartir con los atletas que gestionas los planes y
        sesiones creados para ellos dentro del uso normal del servicio.
      </p>

      <h2>5. Tus datos y contenido</h2>
      <ul>
        <li>
          Conservas la titularidad de los datos que ingresas (perfil, sesiones, registros).
          Nos otorgas una licencia limitada para procesarlos y prestarte el servicio (ver{' '}
          <Link to={ROUTES.PRIVACY}>Política de Privacidad</Link>).
        </li>
        <li>Puedes <strong>exportar y eliminar</strong> tus datos desde Ajustes.</li>
      </ul>

      <h2>6. Inteligencia artificial</h2>
      <p>
        Parte del contenido se genera con modelos de IA y puede contener errores. Las
        sugerencias son orientativas; la decisión final de entrenar es tuya y, cuando
        corresponda, de tu profesional de la salud.
      </p>

      <h2>7. Disponibilidad y cambios</h2>
      <ul>
        <li>
          El servicio se ofrece "tal cual" y "según disponibilidad". Podemos modificar,
          suspender o discontinuar funciones, avisando cuando sea razonable.
        </li>
        <li>
          Podemos actualizar estos Términos; los cambios relevantes se comunicarán y la fecha
          de "última actualización" reflejará la versión vigente.
        </li>
      </ul>

      <h2>8. Limitación de responsabilidad</h2>
      <p>
        En la máxima medida permitida por la ley aplicable, RallyIQ y sus responsables no
        serán responsables por daños indirectos, lesiones, pérdida de datos o lucro cesante
        derivados del uso del servicio. Nada en estos Términos limita derechos que no puedan
        limitarse según la ley de protección al consumidor aplicable.
      </p>

      <h2>9. Ley aplicable</h2>
      <p>
        Estos Términos se rigen por las leyes de <strong>Chile</strong> y cualquier disputa se
        someterá a sus tribunales competentes, sin perjuicio de los derechos irrenunciables
        del consumidor (Ley 19.496).
      </p>

      <h2>10. Contacto</h2>
      <p>Consultas: hola@rallyiq.cl</p>
    </LegalPageLayout>
  )
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/pages/TermsPage.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 9: Write the failing test for `HealthDisclaimerPage`**

Create `src/pages/HealthDisclaimerPage.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import HealthDisclaimerPage from './HealthDisclaimerPage'

describe('HealthDisclaimerPage', () => {
  it('renders the title and the core disclaimer language', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <HealthDisclaimerPage />
      </MemoryRouter>,
    )
    expect(html).toContain('Descargo de responsabilidad de salud')
    expect(html).toContain('no es un dispositivo médico')
    expect(html).toContain('bajo tu propio riesgo')
  })
})
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npx vitest run src/pages/HealthDisclaimerPage.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 11: Write `HealthDisclaimerPage`**

Create `src/pages/HealthDisclaimerPage.tsx` — direct transcription of `docs/legal/descargo-de-salud.md` (it has zero `[[...]]` placeholders, nothing to resolve):

```tsx
import LegalPageLayout from '../components/legal/LegalPageLayout'

export default function HealthDisclaimerPage() {
  return (
    <LegalPageLayout eyebrow="Legal" title="Descargo de responsabilidad de salud" updatedAt="2026-06-20">
      <p>
        RallyIQ ("la aplicación") es una herramienta de{' '}
        <strong>planificación y seguimiento de entrenamiento deportivo</strong>. No es un
        dispositivo médico, no presta servicios de salud y no sustituye el consejo de un
        médico, kinesiólogo, nutricionista ni de ningún profesional de la salud calificado.
      </p>

      <h2>Antes de empezar</h2>
      <ul>
        <li>
          <strong>Consulta a un profesional de la salud</strong> antes de iniciar este o
          cualquier programa de ejercicio, especialmente si tienes una condición
          preexistente, lesiones, estás embarazada, tomas medicación o hace tiempo que no
          entrenas.
        </li>
        <li>
          Si durante una sesión sientes dolor en el pecho, mareo, falta de aire, dolor
          articular agudo u otro síntoma inusual, <strong>detén la actividad y busca
          atención médica</strong>.
        </li>
      </ul>

      <h2>Naturaleza de los planes</h2>
      <ul>
        <li>
          Los planes, cargas, ejercicios y notas que genera RallyIQ son{' '}
          <strong>sugerencias generales</strong> basadas en los datos que ingresas (perfil,
          objetivos, disponibilidad, referencias de fuerza, percepción de fatiga). No están
          calibrados por un profesional que te haya evaluado en persona.
        </li>
        <li>
          Parte del contenido se genera con asistencia de modelos de inteligencia artificial
          y <strong>puede contener errores o recomendaciones inadecuadas para tu caso</strong>.
          Usa tu criterio y el de tu entrenador o profesional de cabecera.
        </li>
        <li>
          Cuando un entrenador revise los planes antes de entregártelos, esa revisión
          <strong>no constituye una prescripción médica</strong>.
        </li>
      </ul>

      <h2>Tu responsabilidad</h2>
      <ul>
        <li>
          Eres responsable de entrenar dentro de tus capacidades, de ajustar o saltar
          cualquier sesión que no sea apropiada para ti ese día, y de usar técnica y
          equipamiento seguros.
        </li>
        <li>
          Al usar la aplicación aceptas que entrenas <strong>bajo tu propio riesgo</strong> y
          que RallyIQ y sus responsables no son responsables por lesiones, daños o pérdidas
          derivadas del uso de los planes o la información provista, en la máxima medida
          permitida por la ley aplicable.
        </li>
      </ul>

      <h2>Emergencias</h2>
      <p>
        RallyIQ no está diseñada para emergencias médicas. Ante una emergencia, contacta a
        los servicios de urgencia de tu país.
      </p>
    </LegalPageLayout>
  )
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `npx vitest run src/pages/HealthDisclaimerPage.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 13: Wire `/terms` and `/health-disclaimer` into `App.tsx`**

Add two lazy imports next to the ones added in Task 1:

```tsx
const TermsPage = lazy(() => import('./pages/TermsPage'))
const HealthDisclaimerPage = lazy(() => import('./pages/HealthDisclaimerPage'))
```

Add two more `<Route>` siblings next to `/features`/`/pricing`:

```tsx
          <Route path={ROUTES.TERMS} element={<RouteBoundary><TermsPage /></RouteBoundary>} />
          <Route path={ROUTES.HEALTH_DISCLAIMER} element={<RouteBoundary><HealthDisclaimerPage /></RouteBoundary>} />
```

- [ ] **Step 14: Run the full test suite, lint, and build**

Run: `npm test && npm run lint && npm run build`
Expected: all pass.

---

### Task 3: Privacy (reconciled) + Whoop Disclaimer pages

**Files:**
- Create: `src/pages/PrivacyPage.tsx`
- Test: `src/pages/PrivacyPage.test.tsx`
- Create: `src/pages/WhoopDisclaimerPage.tsx`
- Test: `src/pages/WhoopDisclaimerPage.test.tsx`
- Modify: `src/App.tsx` (wire `/privacy` and `/whoop-disclaimer`)
- Modify: `netlify.toml` (redirect the legacy privacy URL before the SPA catch-all)
- Delete: `public/legal/privacidad/index.html` (superseded content)

**Interfaces:**
- Consumes: `LegalPageLayout` (Task 2), `ROUTES.PRIVACY`, `ROUTES.WHOOP_DISCLAIMER` (Task 1).

**Reconciliation performed in this task (flag to owner for sign-off):** `docs/legal/politica-de-privacidad.md` (older, unresolved placeholders) and `public/legal/privacidad/index.html` (newer, more operationally accurate, but incomplete as a legal notice) diverge. `PrivacyPage` below uses the HTML as an operational base, restores the confirmed controller identity and current/future Chilean-law distinction, and keeps only claims verified against the current product. The old HTML is already publicly reachable as a static asset at `/legal/privacidad/`; therefore this task removes it and adds a permanent redirect instead of describing it as merely “unrouted”.

Date verification source: Biblioteca del Congreso Nacional, [Ley 21.719](https://www.bcn.cl/leychile/navegar?idNorma=1209272) (published 2024-12-13; entry into force 2026-12-01). Re-check this primary source during implementation in case the legal status has changed.

- [ ] **Step 1: Write the failing test for `PrivacyPage`**

Create `src/pages/PrivacyPage.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { LEGAL_CONTROLLER_NAME, MINORS_POLICY_COPY } from '../constants/legal'
import PrivacyPage from './PrivacyPage'

describe('PrivacyPage', () => {
  it('renders the title, confirmed controller, contact email, and accurate Chilean-law dates', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PrivacyPage />
      </MemoryRouter>,
    )
    expect(html).toContain('Política de Privacidad')
    expect(html).toContain(LEGAL_CONTROLLER_NAME)
    expect(html).toContain('hola@rallyiq.cl')
    expect(html).toContain('Ley 19.628')
    expect(html).toContain('Ley 21.719')
    expect(html).toContain('1 de diciembre de 2026')
    expect(html).toContain(MINORS_POLICY_COPY)
    expect(html).not.toContain('[[')
  })

  it('describes Whoop data use with the required opt-in, non-diagnostic language', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <PrivacyPage />
      </MemoryRouter>,
    )
    expect(html).toContain('opcional')
    expect(html).toContain('no se usan para diagnosticar')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/PrivacyPage.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write `PrivacyPage`**

Create `src/pages/PrivacyPage.tsx`:

```tsx
import LegalPageLayout from '../components/legal/LegalPageLayout'
import { LEGAL_CONTROLLER_NAME, MINORS_POLICY_COPY } from '../constants/legal'

export default function PrivacyPage() {
  return (
    <LegalPageLayout eyebrow="Legal" title="Política de Privacidad" updatedAt="2026-07-13">
      <p>
        Esta política explica qué datos tratamos, para qué los usamos y cómo puedes
        gestionar o eliminar tu información. Para la operación en Chile, el tratamiento se rige
        por la <strong>Ley 19.628</strong> vigente. Esta política también prepara la operación
        para las modificaciones introducidas por la <strong>Ley 21.719</strong>, cuya entrada
        en vigencia está fijada para el <strong>1 de diciembre de 2026</strong>.
      </p>

      <h2>Responsable y contacto</h2>
      <p>
        El responsable del tratamiento es{' '}
        <strong>{LEGAL_CONTROLLER_NAME}</strong>. Para consultas de privacidad, soporte o
        solicitudes sobre tus datos, puedes escribir a{' '}
        <a href="mailto:hola@rallyiq.cl">hola@rallyiq.cl</a>.
      </p>

      <h2>Datos que tratamos</h2>
      <ul>
        <li><strong>Cuenta:</strong> nombre y correo asociados a tu inicio de sesión.</li>
        <li>
          <strong>Entrenamiento:</strong> sesiones, planes, objetivos, disponibilidad,
          notas, RPE y registros diarios.
        </li>
        <li>
          <strong>Salud y rendimiento declarados:</strong> sensaciones, sueño, energía,
          molestias, peso corporal y datos deportivos que ingresas manualmente. Algunos de
          estos pueden considerarse <strong>datos sensibles</strong> (salud); los tratamos
          solo para prestarte el servicio y con tu consentimiento.
        </li>
        <li>
          <strong>Wearables opcionales:</strong> si conectas Whoop, usamos recovery, HRV,
          frecuencia cardiaca en reposo, strain y datos de sueño. La conexión es{' '}
          <strong>opcional</strong> y exige tu autorización.
        </li>
        <li>
          <strong>Datos técnicos:</strong> información mínima necesaria para operar,
          autenticar, sincronizar y diagnosticar errores del servicio.
        </li>
      </ul>

      <h2>Uso de datos de Whoop</h2>
      <p>
        La conexión con Whoop es opcional y requiere tu autorización. Usamos esos datos
        para mostrar readiness, prellenar campos editables del check-in diario y entregar
        contexto pasivo al coach de IA. Los datos de Whoop{' '}
        <strong>no se usan para diagnosticar, tratar o prevenir enfermedades o lesiones</strong>.
        RallyIQ no reemplaza a un profesional médico, entrenador calificado u otro
        especialista de salud.
      </p>

      <h2>Para qué usamos tus datos</h2>
      <ul>
        <li>Generar, registrar y ajustar planes de entrenamiento.</li>
        <li>Sincronizar tus datos entre dispositivos.</li>
        <li>Mostrar resúmenes de carga, adherencia, readiness y progreso.</li>
        <li>Dar contexto al coach de IA y a las recomendaciones dentro de la app.</li>
        <li>Prestar soporte, mejorar el producto y mantener la seguridad del servicio.</li>
      </ul>
      <p><strong>No vendemos tus datos personales.</strong></p>

      <h2>Almacenamiento y proveedores</h2>
      <p>
        La app funciona local-first: parte de tus datos se guarda en tu navegador. Si
        inicias sesión, también se sincronizan en infraestructura cloud para que puedas
        recuperarlos y usarlos entre dispositivos. Usamos proveedores como Supabase para
        base de datos y autenticación, Netlify para hosting y proveedores de IA para generar
        contenido dentro de la app. Estos proveedores solo reciben la información necesaria
        para prestar el servicio. Los tokens de Whoop se almacenan cifrados del lado
        servidor; los datos biométricos crudos no se exponen directamente al cliente — la
        app usa un resumen diario asociado a tu cuenta/atleta activo.
      </p>

      <h2>Tus controles</h2>
      <ul>
        <li>Puedes exportar tus datos desde Ajustes.</li>
        <li>Puedes eliminar datos locales y remotos desde Ajustes.</li>
        <li>
          Puedes desconectar Whoop desde Ajustes; al hacerlo se borran los datos de Whoop
          asociados.
        </li>
        <li>
          Puedes escribir a hola@rallyiq.cl para solicitar acceso, rectificación o
          eliminación.
        </li>
      </ul>

      <h2>Conservación y seguridad</h2>
      <p>
        Conservamos tus datos mientras tu cuenta esté activa o mientras sean necesarios
        para prestar el servicio. Aplicamos medidas razonables de seguridad, incluyendo
        autenticación, conexiones cifradas y cifrado de credenciales de integraciones
        sensibles.
      </p>

      <h2>Menores</h2>
      <p>{MINORS_POLICY_COPY}</p>

      <h2>Cambios a esta política</h2>
      <p>
        Podemos actualizar esta política para reflejar cambios del producto, legales o de
        seguridad. La fecha de "última actualización" indicará la versión vigente. Durante el
        prelanzamiento, esta política puede actualizarse antes de habilitar cuentas pagadas; los
        cambios relevantes deberán comunicarse y aceptarse cuando corresponda.
      </p>
    </LegalPageLayout>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/PrivacyPage.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing test for `WhoopDisclaimerPage`**

Create `src/pages/WhoopDisclaimerPage.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import WhoopDisclaimerPage from './WhoopDisclaimerPage'

describe('WhoopDisclaimerPage', () => {
  it('renders the title and the required non-diagnostic, opt-in language', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <WhoopDisclaimerPage />
      </MemoryRouter>,
    )
    expect(html).toContain('Descargo y consentimiento para datos Whoop')
    expect(html).toContain('opcional')
    expect(html).toContain('no se usan para diagnosticar')
    expect(html).toContain('No recibimos tus credenciales de Whoop')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/pages/WhoopDisclaimerPage.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 7: Write `WhoopDisclaimerPage`**

Create `src/pages/WhoopDisclaimerPage.tsx` — direct transcription of `docs/legal/descargo-whoop.md` (zero `[[...]]` placeholders):

```tsx
import LegalPageLayout from '../components/legal/LegalPageLayout'

export default function WhoopDisclaimerPage() {
  return (
    <LegalPageLayout eyebrow="Legal" title="Descargo y consentimiento para datos Whoop" updatedAt="2026-07-07">
      <p>
        La integración con Whoop es <strong>opcional</strong>. Si decides conectarla,
        autorizas a RallyIQ a recibir y tratar datos biométricos y de actividad generados
        por Whoop para mejorar el contexto de entrenamiento.
      </p>

      <h2>Datos que podemos recibir</h2>
      <ul>
        <li>Recovery diario y puntaje de recuperación.</li>
        <li>HRV y frecuencia cardiaca en reposo.</li>
        <li>Strain / carga registrada por Whoop.</li>
        <li>Datos de sueño, incluyendo horas de sueño y sleep performance.</li>
      </ul>
      <p>
        <strong>No recibimos tus credenciales de Whoop.</strong> El acceso se realiza
        mediante OAuth y los tokens se guardan cifrados del lado servidor.
      </p>

      <h2>Para qué se usan</h2>
      <p>Usamos estos datos como contexto objetivo para:</p>
      <ul>
        <li>Mostrar señales de recuperación, sueño y strain en la app.</li>
        <li>
          Prellenar campos editables del check-in diario, como sueño, calidad de sueño y
          energía.
        </li>
        <li>Dar contexto pasivo al coach de IA.</li>
      </ul>
      <p>
        Estos datos <strong>no se usan para diagnosticar, tratar o prevenir enfermedades o
        lesiones</strong>. RallyIQ no reemplaza la evaluación de un profesional médico,
        entrenador calificado u otro especialista de salud.
      </p>

      <h2>Dónde se guardan</h2>
      <p>
        Los tokens de acceso se guardan cifrados en el servidor. Los datos biométricos
        crudos se procesan del lado servidor y no se exponen directamente al cliente. La
        app solo replica localmente un resumen diario de readiness asociado a tu atleta
        activo.
      </p>

      <h2>Desconexión y borrado</h2>
      <p>
        Puedes desconectar Whoop desde Ajustes. Al desconectar, RallyIQ revoca el acceso
        cuando el backend de Whoop está disponible para ello y deja de sincronizar nuevos
        datos.
      </p>
      <p>
        También puedes eliminar tus datos desde las opciones de borrado de la app. El
        borrado completo elimina los resúmenes locales y remotos asociados a Whoop, además
        de los demás datos de entrenamiento de tu cuenta.
      </p>
    </LegalPageLayout>
  )
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run src/pages/WhoopDisclaimerPage.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 9: Wire `/privacy` and `/whoop-disclaimer` into `App.tsx`**

Add two lazy imports next to the ones from Task 2:

```tsx
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))
const WhoopDisclaimerPage = lazy(() => import('./pages/WhoopDisclaimerPage'))
```

Add two more `<Route>` siblings:

```tsx
          <Route path={ROUTES.PRIVACY} element={<RouteBoundary><PrivacyPage /></RouteBoundary>} />
          <Route path={ROUTES.WHOOP_DISCLAIMER} element={<RouteBoundary><WhoopDisclaimerPage /></RouteBoundary>} />
```

- [ ] **Step 10: Run the full test suite, lint, and build**

Run: `npm test && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 11: Remove the duplicate static policy and preserve its URL**

Delete `public/legal/privacidad/index.html`. In `netlify.toml`, insert this rule **before** the existing `/* → /index.html` SPA fallback:

```toml
[[redirects]]
  from = "/legal/privacidad"
  to = "/privacy"
  status = 301
  force = true

[[redirects]]
  from = "/legal/privacidad/*"
  to = "/privacy"
  status = 301
  force = true
```

Run `npm run build`, then confirm `dist/legal/privacidad/index.html` no longer exists. After deploy, `curl -I https://<production-host>/legal/privacidad/` must return a permanent redirect whose `Location` is `/privacy` (Netlify may report 301 or its normalized permanent-redirect equivalent).

- [ ] **Step 12: Flag the reconciliation to the owner**

In this task's report, explicitly call out: "PrivacyPage reconciles the two prior drafts, names the owner-confirmed controller, treats Ley 19.628 as the current framework and Ley 21.719 as entering into force on 2026-12-01, and redirects the old static URL to the canonical `/privacy` page. This has not been reviewed by a lawyer — validate before the public prelaunch or any paid launch." Do not silently treat this as legally final.

---

### Task 4: `/coaches` — standalone landing for the coach funnel

**Files:**
- Create: `src/pages/CoachesLandingPage.tsx`
- Test: `src/pages/CoachesLandingPage.test.tsx`
- Modify: `src/App.tsx` (wire `/coaches`)

**Interfaces:**
- Consumes: `ROUTES.TERMS`, `ROUTES.PRIVACY`, `ROUTES.HEALTH_DISCLAIMER` (Task 1, pages built in Tasks 2-3) for footer links.
- Produces: the landing shell. The screenshot section is added only after Task 5 places and validates the real files.

This page does **not** import `SharedPublicNav` (global constraint: separate funnel, separate nav). It ships its own minimal header and repeats the same "Avisarme del lanzamiento" conversion action in the nav, hero and closing block. All three instances must have identical label and destination.

**Execution correction:** Task 5 was not completed during the first implementation pass. The current page therefore omits `<Screenshots />` and its helper entirely. This is the safe intermediate state: no broken image paths and no “capturas reales” claim. Add that section only in Task 5 after all assets pass the file, privacy and size checks below.

- [ ] **Step 1: Write the failing test**

Create `src/pages/CoachesLandingPage.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import CoachesLandingPage from './CoachesLandingPage'

describe('CoachesLandingPage', () => {
  it('renders the hero, "Para quién es" and "Qué no es" blocks', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoachesLandingPage />
      </MemoryRouter>,
    )
    expect(html).toContain('Para quién es')
    expect(html).toContain('Qué no es')
  })

  it('uses one consistent CTA action everywhere: Avisarme del lanzamiento with the same mailto', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoachesLandingPage />
      </MemoryRouter>,
    )
    const ctaMatches = html.match(/Avisarme del lanzamiento/g) ?? []
    const mailtoMatches = html.match(/mailto:hola@rallyiq\.cl\?subject=/g) ?? []
    expect(ctaMatches.length).toBeGreaterThan(0)
    expect(mailtoMatches.length).toBe(ctaMatches.length)
    expect(html).not.toContain('Empezar gratis')
  })

  it('does not reuse SharedPublicNav\'s athlete-funnel links', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoachesLandingPage />
      </MemoryRouter>,
    )
    expect(html).not.toContain('Iniciar sesión')
  })

  it('uses the approved opt-in language if it makes a product claim about Whoop data', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoachesLandingPage />
      </MemoryRouter>,
    )
    if (html.includes('datos de Whoop')) {
      expect(html).toContain('contexto objetivo opcional y consentido')
    }
  })

  it('links the four legal routes from the footer', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <CoachesLandingPage />
      </MemoryRouter>,
    )
    expect(html).toContain('href="/terms"')
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('href="/health-disclaimer"')
    expect(html).toContain('href="/whoop-disclaimer"')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/CoachesLandingPage.test.tsx`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Write `CoachesLandingPage`**

Create `src/pages/CoachesLandingPage.tsx`:

```tsx
import { Link } from 'react-router-dom'
import { ROUTES } from '../constants/routes'

const BRAND = '#ff4d00'
const BRAND_LIGHT = '#ff7a33'
const INK = '#f5f5f7'
const INK_MUTED = '#a0a0a5'
const INK_FAINT = '#6e6e73'
const SURFACE_BORDER = 'rgba(255,255,255,0.08)'
const FONT_DISPLAY = "'Lexend', 'Inter', system-ui, sans-serif"
const FONT_MONO = "'JetBrains Mono', 'Fira Mono', monospace"

const PRELAUNCH_MAILTO = 'mailto:hola@rallyiq.cl?subject=' + encodeURIComponent('Quiero recibir novedades del lanzamiento de RallyIQ para coaches')

const PARA_QUIEN_ES = [
  'Ya llevas entre 1 y 5 atletas y quieres ordenar planificación y adherencia en un solo lugar.',
  'Tu deporte de origen es competitivo — squash, running o fuerza — y quieres que la carga se lea igual entre tus atletas.',
  'Quieres ahorrar tiempo armando semanas a mano para cada persona que entrenas.',
] as const

const QUE_NO_ES = [
  'No es diagnóstico ni reemplaza a un profesional de la salud.',
  'No reemplaza tu supervisión presencial — es una herramienta, no un entrenador automático.',
  'No garantiza resultados deportivos.',
  'No es "IA ilimitada": siempre revisas y confirmas las propuestas del coach AI antes de aplicarlas.',
] as const

export default function CoachesLandingPage() {
  return (
    <div style={{ background: '#070707', color: INK, minHeight: '100vh', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <CoachesNav />
      <main>
        <Hero />
        <ParaQuienEs />
        <QueNoEs />
        <Screenshots />
        <ClosingCta />
      </main>
      <CoachesFooter />
    </div>
  )
}

function CoachesNav() {
  return (
    <nav
      style={{
        position: 'sticky', top: 0, zIndex: 10,
        backdropFilter: 'blur(14px)', background: 'rgba(7,7,7,0.85)',
        borderBottom: `1px solid ${SURFACE_BORDER}`,
        padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}
    >
      <Link to={ROUTES.HOME} style={{ fontFamily: FONT_DISPLAY, fontWeight: 900, fontSize: 18, color: INK, textDecoration: 'none' }}>
        RallyIQ <span style={{ color: BRAND }}>Coach</span>
      </Link>
      <a
        href={PRELAUNCH_MAILTO}
        style={{
          fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 700, color: '#fff',
          background: BRAND, padding: '10px 20px', borderRadius: 999, textDecoration: 'none',
        }}
      >
        Avisarme del lanzamiento
      </a>
    </nav>
  )
}

function Hero() {
  return (
    <section style={{ padding: '96px 24px 64px', maxWidth: 860, margin: '0 auto', textAlign: 'center' }}>
      <div style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.24em', textTransform: 'uppercase', color: BRAND_LIGHT, marginBottom: 20 }}>
        Para entrenadores
      </div>
      <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 'clamp(36px, 6vw, 56px)', fontWeight: 800, lineHeight: 1.08, letterSpacing: '-0.02em', margin: '0 0 20px' }}>
        Gestiona el entrenamiento de tus atletas desde una sola cuenta.
      </h1>
      <p style={{ fontSize: 18, lineHeight: 1.6, color: INK_MUTED, maxWidth: 620, margin: '0 auto 32px' }}>
        RallyIQ te da un roster, planificación multideporte y un coach AI con contexto —
        que aporta señales objetivas opcionales, nunca diagnóstico ni ajuste automático.
      </p>
      <a
        href={PRELAUNCH_MAILTO}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 700, color: '#fff',
          background: BRAND, padding: '16px 28px', borderRadius: 12, textDecoration: 'none',
        }}
      >
        Avisarme del lanzamiento
      </a>
      <p style={{ fontSize: 12, lineHeight: 1.6, color: INK_FAINT, margin: '16px auto 0', maxWidth: 560 }}>
        Antes de pedir que te avisemos del lanzamiento puedes revisar nuestros{' '}
        <Link to={ROUTES.TERMS} style={{ color: BRAND_LIGHT }}>Términos</Link>,{' '}
        <Link to={ROUTES.PRIVACY} style={{ color: BRAND_LIGHT }}>Privacidad</Link>,{' '}
        <Link to={ROUTES.HEALTH_DISCLAIMER} style={{ color: BRAND_LIGHT }}>Descargo de salud</Link>{' '}
        y <Link to={ROUTES.WHOOP_DISCLAIMER} style={{ color: BRAND_LIGHT }}>Descargo Whoop</Link>.
      </p>
    </section>
  )
}

function ParaQuienEs() {
  return (
    <section style={{ padding: '48px 24px', maxWidth: 760, margin: '0 auto' }}>
      <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 700, marginBottom: 20 }}>Para quién es</h2>
      <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {PARA_QUIEN_ES.map((item) => (
          <li key={item} style={{ display: 'flex', gap: 12, fontSize: 15, lineHeight: 1.6, color: INK_MUTED }}>
            <span style={{ color: BRAND, flexShrink: 0 }}>—</span>
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}

function QueNoEs() {
  return (
    <section style={{ padding: '48px 24px', maxWidth: 760, margin: '0 auto', borderTop: `1px solid ${SURFACE_BORDER}` }}>
      <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 700, marginBottom: 20 }}>Qué no es</h2>
      <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {QUE_NO_ES.map((item) => (
          <li key={item} style={{ display: 'flex', gap: 12, fontSize: 15, lineHeight: 1.6, color: INK_MUTED }}>
            <span style={{ color: INK_FAINT, flexShrink: 0 }}>—</span>
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Screenshots() {
  return (
    <section style={{ padding: '64px 24px', maxWidth: 1080, margin: '0 auto', borderTop: `1px solid ${SURFACE_BORDER}` }}>
      <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>
        Así se ve tu workspace
      </h2>
      <p style={{ textAlign: 'center', color: INK_FAINT, fontSize: 13, marginBottom: 32 }}>
        Capturas reales del producto, no mockups.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        <Screenshot src="/coaches/screenshots/resumen.png" alt="Tab Resumen del workspace de coach, con tarjetas de roster" caption="Resumen: tu roster de un vistazo" />
        <Screenshot src="/coaches/screenshots/alumnos.png" alt="Tab Alumnos del workspace de coach, con el roster completo" caption="Alumnos: gestiona a cada atleta" />
        <Screenshot src="/coaches/screenshots/plan.png" alt="Un plan real generado por RallyIQ" caption="Un plan real, no un ejemplo" />
      </div>
    </section>
  )
}

function Screenshot({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure style={{ margin: 0 }}>
      <div
        style={{
          borderRadius: 16, overflow: 'hidden', border: `1px solid ${SURFACE_BORDER}`,
          aspectRatio: '16 / 10', background: 'rgba(255,255,255,0.03)',
        }}
      >
        <img
          src={src}
          alt={alt}
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
      <figcaption style={{ marginTop: 10, fontSize: 13, color: INK_FAINT, textAlign: 'center' }}>{caption}</figcaption>
    </figure>
  )
}

function ClosingCta() {
  return (
    <section style={{ padding: '64px 24px 96px', maxWidth: 640, margin: '0 auto', textAlign: 'center', borderTop: `1px solid ${SURFACE_BORDER}` }}>
      <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 700, marginBottom: 16 }}>
        ¿Listo para ordenar el entrenamiento de tus atletas?
      </h2>
      <a
        href={PRELAUNCH_MAILTO}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 700, color: '#fff',
          background: BRAND, padding: '16px 28px', borderRadius: 12, textDecoration: 'none',
        }}
      >
        Avisarme del lanzamiento
      </a>
    </section>
  )
}

function CoachesFooter() {
  return (
    <footer style={{ borderTop: `1px solid ${SURFACE_BORDER}`, padding: '32px 24px', textAlign: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
        <Link to={ROUTES.TERMS} style={{ fontSize: 13, color: INK_FAINT, textDecoration: 'none' }}>Términos</Link>
        <Link to={ROUTES.PRIVACY} style={{ fontSize: 13, color: INK_FAINT, textDecoration: 'none' }}>Privacidad</Link>
        <Link to={ROUTES.HEALTH_DISCLAIMER} style={{ fontSize: 13, color: INK_FAINT, textDecoration: 'none' }}>Descargo de salud</Link>
        <Link to={ROUTES.WHOOP_DISCLAIMER} style={{ fontSize: 13, color: INK_FAINT, textDecoration: 'none' }}>Descargo Whoop</Link>
      </div>
      <p style={{ fontFamily: FONT_MONO, fontSize: 11, color: INK_FAINT, margin: 0 }}>© 2026 · RALLYIQ LABS</p>
    </footer>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/CoachesLandingPage.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Wire `/coaches` into `App.tsx`**

Add the lazy import:

```tsx
const CoachesLandingPage = lazy(() => import('./pages/CoachesLandingPage'))
```

Add the `<Route>` sibling:

```tsx
          <Route path={ROUTES.COACHES} element={<RouteBoundary><CoachesLandingPage /></RouteBoundary>} />
```

- [ ] **Step 6: Run the full test suite, lint, and build**

Run: `npm test && npm run lint && npm run build`
Expected: all pass. Until Task 5 is complete there must be no `<img>` reference under `/coaches/screenshots/` and no claim that the page already shows real captures.

---

### Task 5: Real, anonymized screenshots

**Files:**
- Create: `public/coaches/screenshots/resumen.png`
- Create: `public/coaches/screenshots/alumnos.png`
- Create: `public/coaches/screenshots/plan.png`

**This task starts with manual capture and ends with a small code change.** Missing assets are release-blocking for the visual-proof requirement. The landing remains valid without broken images while capture is pending, but it must not claim the proof exists. Only after all three files are validated should the implementation add the `<Screenshots />` section and its `<img>` paths.

Use a dedicated synthetic/test dataset. Before capture, inspect the full viewport for athlete names, email addresses, avatars, event names, free-text notes, dates that identify a person, and biometric values. Do not mutate or rename a real production athlete merely to manufacture a public screenshot, and do not rely only on cropping if sensitive content remains in the source image.

- [ ] **Step 1: Capture "Resumen"**

With `npm run dev` running and signed in as a coach-allowlisted test account with at least one generic managed athlete (per `docs/superpowers/plans/2026-07-11-coach-workspace-v0.md`'s Coach Workspace v0), navigate to `/coach`, stay on the default "Resumen" tab. Resize the browser to roughly 1280×800 for a clean 16:10 crop. Take a screenshot of the panel area (not the browser chrome).

**Anonymize before saving:** use generic data created for testing (for example, “Atleta Prueba”), not a real person's row. Coach Workspace v0 has a create flow but no guaranteed rename flow; do not make the capture procedure depend on a rename capability that does not exist.

Save as `public/coaches/screenshots/resumen.png`.

- [ ] **Step 2: Capture "Alumnos"**

Same session, click the "Alumnos" tab. Confirm the roster list and "Crear atleta" CTA are visible. Same anonymization check as Step 1. Save as `public/coaches/screenshots/alumnos.png`.

- [ ] **Step 3: Capture a real plan**

Navigate to `/plans/builder` (Plan Builder V2) for the generic test athlete with a genuinely generated plan (not an empty state and not a hand-drawn mockup). Capture the plan view. Confirm its title, event and notes are also generic. Save as `public/coaches/screenshots/plan.png`.

- [ ] **Step 4: Validate and optimize the files**

Confirm all three files are non-empty PNG images, are approximately 1280×800, contain no embedded personal metadata, and stay within a practical public-page budget (target **≤ 750 KB each**, **≤ 2.25 MB total**). Optimize losslessly or visually compare any lossy optimization before accepting it.

Run at minimum:

```bash
test -s public/coaches/screenshots/resumen.png
test -s public/coaches/screenshots/alumnos.png
test -s public/coaches/screenshots/plan.png
file public/coaches/screenshots/*.png
du -h public/coaches/screenshots/*.png
```

- [ ] **Step 5: Verify the images render**

Add the screenshot section described in Task 4, using the three validated paths. Run `npm run dev`, visit `/coaches`, confirm all three screenshots render with no broken-image state at desktop and mobile widths. Visually inspect the rendered assets one more time for identifying data.

- [ ] **Step 6: Confirm no npm test/build regression**

Run: `npm test && npm run build`
Expected: unaffected by adding static assets — both still pass exactly as before this task.

---

### Task 6: Point the athlete-facing footers at the real legal routes

**Files:**
- Modify: `src/pages/LandingPage.tsx`
- Modify: `src/pages/FeaturesPage.tsx`
- Modify: `src/pages/PricingPage.tsx`

**Interfaces:**
- Consumes: `ROUTES.TERMS`, `ROUTES.PRIVACY` (Task 1, pages built in Task 2-3).

This closes the still-open roadmap checklist item "Conectar footer a rutas legales reales" for the general public surface — mechanical link-target changes only, no visual or copy changes.

- [ ] **Step 1: `LandingPage.tsx` — point "Privacidad" and "Terminos" at real routes**

In `src/pages/LandingPage.tsx`, `FooterCol` currently maps only two labels to routes:

```tsx
function FooterCol({ title, links }: { title: string; links: string[] }) {
  const routeByLabel: Record<string, string> = {
    Funcionalidades: '/features',
    Precios: '/pricing',
  }
  // ...
}
```

Add the two legal labels (used in the "Empresa" column: `['Contacto', 'Privacidad', 'Terminos']`):

First import `ROUTES` from `../constants/routes`, then use the shared constants:

```tsx
function FooterCol({ title, links }: { title: string; links: string[] }) {
  const routeByLabel: Record<string, string> = {
    Funcionalidades: ROUTES.FEATURES,
    Precios: ROUTES.PRICING,
    Privacidad: ROUTES.PRIVACY,
    Terminos: ROUTES.TERMS,
  }
  // ...
}
```

The existing rendering logic (`routeByLabel[link] ? <Link to={routeByLabel[link]}>...` else `<a href="mailto:...">`) already handles the rest — "Contacto" keeps its `mailto:hola@rallyiq.cl` link since it's not in the map.

- [ ] **Step 2: `FeaturesPage.tsx` — same fix**

In `FeaturesFooter`'s column data, the "Empresa" column currently is:

```tsx
{ title: 'Empresa', links: [{ label: 'Contacto', href: 'mailto:hola@rallyiq.cl' }, { label: 'Privacidad', href: 'mailto:hola@rallyiq.cl' }, { label: 'Términos', href: 'mailto:hola@rallyiq.cl' }] },
```

Import `ROUTES` from `../constants/routes`. Change `Privacidad` and `Términos` from `href` (mailto) to `to` (real route), matching the `'to' in l ? <Link to={l.to}>... : <a href={l.href}>...` branch already present in the render loop:

```tsx
{ title: 'Empresa', links: [{ label: 'Contacto', href: 'mailto:hola@rallyiq.cl' }, { label: 'Privacidad', to: ROUTES.PRIVACY }, { label: 'Términos', to: ROUTES.TERMS }] },
```

- [ ] **Step 3: `PricingPage.tsx` — same fix**

In `PricingPage`'s footer "Empresa" column:

```tsx
<div className="footer-col">
  <h4>Empresa</h4>
  <ul>
    <li><a href="mailto:hola@rallyiq.cl">Contacto</a></li>
    <li><a href="mailto:hola@rallyiq.cl">Soporte</a></li>
    <li><a href="mailto:hola@rallyiq.cl">Privacidad</a></li>
    <li><a href="mailto:hola@rallyiq.cl">Términos</a></li>
  </ul>
</div>
```

Change the last two to real `<Link>`s (`Link` is already imported) and import `ROUTES` from `../constants/routes`:

```tsx
<div className="footer-col">
  <h4>Empresa</h4>
  <ul>
    <li><a href="mailto:hola@rallyiq.cl">Contacto</a></li>
    <li><a href="mailto:hola@rallyiq.cl">Soporte</a></li>
    <li><Link to={ROUTES.PRIVACY}>Privacidad</Link></li>
    <li><Link to={ROUTES.TERMS}>Términos</Link></li>
  </ul>
</div>
```

- [ ] **Step 4: Run the full test suite, lint, and build**

Run: `npm test && npm run lint && npm run build`
Expected: all pass — none of these three pages had existing tests before this plan (confirmed absent at plan-writing time), so there is nothing to update; this step only confirms the edits don't break the build.

---

### Task 7: Smoke DEV + production prelaunch

**Files:** none (verification only).

- [ ] **Step 1: Full local gate**

Run: `npm run lint && npm test && npm run build`
Expected: all green (CLAUDE.md pre-commit rule).

- [ ] **Step 2: DEV smoke — signed out**

With `npm run dev` running, in a signed-out browser session, visit each and confirm:
- `/` → `LandingPage` (unchanged).
- `/features` → `FeaturesPage` (unchanged, now via a real route).
- `/pricing` → `PricingPage` (unchanged, now via a real route).
- `/coaches` → new landing: hero, "Para quién es", "Qué no es" and only the repeated "Avisarme del lanzamiento" conversion action (no competing CTA). If Task 5 is complete, it must also show all three real screenshots; while it remains pending, the whole screenshot section and its claim must be absent.
- `/terms`, `/privacy`, `/health-disclaimer`, `/whoop-disclaimer` → each renders its title, body text, and a working "RallyIQ" link back to `/`.
- Click "Avisarme del lanzamiento" on `/coaches` — confirm it opens the OS mail client (or a "choose an app" prompt) addressed to `hola@rallyiq.cl` with the subject prefilled to "Quiero recibir novedades del lanzamiento de RallyIQ para coaches". **Do not actually send the email** — this step only confirms the `mailto:` link is well-formed.
- From `/coaches`, click "Privacidad" and "Términos" in the footer — confirm they navigate to the real `/privacy` and `/terms` routes (not a dead link or a 404).
- From the legal note next to the hero CTA and from the footer, confirm all four links work: Términos, Privacidad, Descargo de salud and Descargo Whoop.
- From `/` and `/pricing`, click the footer's "Privacidad"/"Terminos" links (Task 6) — confirm the same.

- [ ] **Step 3: DEV smoke — signed in**

Sign in as any account. Confirm:
- `/` still shows `Dashboard` (conditional behavior unchanged).
- `/features`, `/pricing`, `/coaches`, `/terms`, `/privacy`, `/health-disclaimer`, `/whoop-disclaimer` still render for a signed-in session (these are public informational pages — nothing in this plan gates them behind auth, and that's intentional).
- `/features` and `/pricing` show `Ir a mi panel`; no visible action starts Google OAuth again.

- [ ] **Step 4: Production-prelaunch smoke (after deploy)**

Do not deploy placeholders. Once `LEGAL_CONTROLLER_NAME` is confirmed, the legal text has owner
sign-off and the owner has deployed the prelaunch (push to `main`, per this project's existing
Netlify auto-deploy), repeat Steps 2-3 against the production URL. Confirm no console errors on
any of the seven new/changed public pages. The payment gateway is **not** required for this
prelaunch deployment because the CTA is informational; it is required before switching to
"Elegir plan" or charging anyone.

Also verify the legacy policy URL no longer serves divergent content:

```bash
curl -I https://<production-host>/legal/privacidad/
```

Expected: permanent redirect to `/privacy`, followed by the canonical SPA page when redirects are followed.

- [ ] **Step 5: Report to the owner**

Summarize in the final report:
- Record the exact owner-confirmed legal controller text used by Terms and Privacy; no name may have been inferred from Git metadata.
- Record the adults-only minor-athlete policy and confirm that paid/commercial terms remain gated on the payment implementation.
- Confirm the `PrivacyPage` reconciliation (Task 3, Step 12) is acceptable pending legal review, or flag disagreement.
- If Task 5 is complete, confirm the three screenshots are anonymized to the owner's satisfaction. Otherwise report visual proof as the sole unfinished Fase 0 deliverable and confirm the landing contains no broken-image references.
- Confirm the legacy static privacy file was removed and its old URL redirects permanently to `/privacy`.
- State explicitly that public legal pages are now available, but versioned general acceptance and durable biometric-consent logging remain separate roadmap items.

---

## Self-Review Notes

- **Spec coverage:** routes, canonical legal surface, standalone coach funnel, CTA, metadata and legal links are implemented. Real anonymized screenshots remain Task 5; until then the landing intentionally omits the visual-proof section rather than shipping broken assets. Authenticated athlete-funnel navigation is auth-aware after the public-route refactor.
- **Out of scope, confirmed absent from this plan:** unifying the coach and athlete CTA funnels, SP1a/SP1b, the two-sided "Cómo funciona" section, payment/checkout/entitlement implementation, persistent accumulated account roles, pricing validation, versioned acceptance of general terms/privacy, and durable biometric-consent records. Those remain separate paid-launch or two-sided-product work even after the legal pages are published.
- **Type/interface consistency:** `LegalPageLayout`'s props (`eyebrow`, `title`, `updatedAt`, `children`) are defined once in Task 2 and consumed identically by `TermsPage`, `HealthDisclaimerPage` (Task 2), `PrivacyPage`, `WhoopDisclaimerPage` (Task 3) — no page redefines its own header markup. `ROUTES` constants are defined once in Task 1 and only referenced (never re-declared as raw string literals) from Task 2 onward, except inside `CoachesLandingPage`'s footer and `LegalPageLayout`'s wordmark link, which also import from `../constants/routes` rather than hardcoding path strings.

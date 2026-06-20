# Preparación para clientes (piloto premium) — Plan

**Fecha:** 2026-06-20
**Decisiones tomadas:** público = squash primero (abrir después); modelo =
suscripción mensual (piloto cerrado por invitación primero); arranque = Legal +
Landing en paralelo.
**Base estratégica:** `PROJECT_REVIEW_AND_ROADMAP.md` (corte 2026-06-20).

## Estado actual relevante (verificado en código)

- Las páginas de marketing existen (`src/pages/LandingPage.tsx`,
  `FeaturesPage.tsx`, `PricingPage.tsx`, `components/SharedPublicNav.tsx`) pero
  **no están ruteadas**: `ROUTES.HOME='/'` renderiza el `Dashboard`, y todo
  vive detrás de `<AuthGate>` + `<OnboardingGuard>` (`src/App.tsx`).
- Los links de footer "Privacidad/Términos" son `href="#"` (muertos).
- La "de-tecnificación" de la app ya está hecha en prod (gating `isDevToolsEnabled`).

## Track A — Legal y confianza (bloqueante)

- [x] Borradores de contenido: `docs/legal/descargo-de-salud.md`,
  `terminos-y-condiciones.md`, `politica-de-privacidad.md`.
- [ ] **Completar datos** en los borradores: entidad/responsable, email de
  contacto, jurisdicción (¿Chile?), procesador de pagos, política de reembolso.
- [ ] **Revisión legal** por un profesional (especialmente datos de salud +
  suscripción + Ley 19.628 / GDPR si hay UE).
- [ ] Capa de **rutas públicas** (fuera de `AuthGate`) para `/legal/terminos`,
  `/legal/privacidad`, `/legal/descargo` — accesibles sin login.
- [ ] **Consentimiento en onboarding**: checkbox de aceptación de Términos +
  Descargo de salud antes de crear la cuenta/primer plan (registrar versión y
  fecha aceptada).
- [ ] Exponer "Eliminar mi cuenta y datos" como derecho del usuario (ya existe
  el wipe; falta el encuadre/UX).

## Track B — Landing y cara pública

- [ ] **Routing público**: para visitantes sin sesión, `/` muestra la landing;
  `/features`, `/pricing` y `/legal/*` públicos; la app queda bajo auth. Decidir
  estructura (capa de rutas públicas antes de `AuthGate`).
- [ ] **Copy de-tecnificado** (según roadmap §"Diagnóstico de superficie
  pública"): menos "PWA/AI/analytics/local-first"; más "llegá fresco al torneo,
  ordená la semana, ajustá carga, entrená fuerza con sentido".
- [ ] **Posicionamiento squash-first** en el hero; CTA de piloto: "Solicitar
  cupo piloto" / "Preparar mi próximo torneo" (no "Empezar gratis").
- [ ] **Marca única** (RallyIQ como producto; "Entrenador App" interno).
- [ ] Footer → links reales a `/legal/*`. OG tags, favicon, dominio.
- [ ] **Pricing** alineado a piloto cerrado (no abrir precios públicos aún).

## Track C — Onboarding y activación (sigue a A+B)

- [ ] Alta sin fricción + "primer plan wow" (demo/sample antes de configurar todo).
- [ ] Estados vacíos guiados; microcopy de consumidor en errores.

## Track D — Monetización (suscripción) — posterior al piloto

- [ ] Integración de pagos ([[Stripe/Paddle]]), gestión de plan, cancelación,
  webhooks, estados de cuenta. Encuadre legal ya cubierto en T&C (sección 3).

## Track E — Operación / robustez antes de invitar

- [ ] QA de sync multi-dispositivo; smoke prod controlado.
- [ ] Monitoreo de errores sin filtrar datos; límites de costo de IA.
- [ ] CI mínima; pin de Node (`NODE_VERSION`/`.nvmrc`).

## Orden sugerido

1. Completar datos legales + revisión (Track A contenido) — en paralelo, **B**
   copy/landing pública.
2. Rutas públicas + consentimiento onboarding (cierra A funcional).
3. Onboarding "wow" (C).
4. Pagos (D) cuando se abra cobro.
5. Robustez/operación (E) como gate antes de invitar externos.

## Inputs pendientes del dueño del producto

- Entidad/responsable legal y email de contacto público.
- Jurisdicción (¿Chile? ¿usuarios UE?).
- Procesador de pagos y política de reembolso.
- Marca pública definitiva (RallyIQ).

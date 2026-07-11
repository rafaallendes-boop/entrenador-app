# Estrategia: Landing del coach (RallyIQ)

> Estado: **borrador inicial** (2026-07-10). Base para iterar. No es spec de implementación todavía.

## Principio rector

La landing del coach debe prometer **solo lo que el backend puede cumplir hoy**. SP1a
(datos + RLS v2 + sync de dos lados) ya está implementado, pero **no** incluye
invitaciones ni login de atleta — eso es **SP1b**. Por lo tanto la landing arranca como
**captación con demo manual** y evoluciona a **self-serve dos-lados** recién cuando SP1b
esté en producción.

Restricciones duras (consistentes con las reglas del proyecto y el descargo Whoop):

- No prometer diagnóstico, prevención de lesiones ni ajuste automático.
- No vender "IA ilimitada" como valor central.
- Whoop = "contexto objetivo opcional y consentido", nunca métrica de salud/diagnóstico.
- No exponer datos biométricos sin consentimiento y borrado completo.

## Estado actual (punto de partida)

Hoy **no existe una landing del coach** como página. Existen:

- `src/pages/LandingPage.tsx`, `FeaturesPage.tsx`, `PricingPage.tsx` — superficie pública genérica.
- `src/pages/CoachRosterPage.tsx` (`/coach`) — herramienta interna del roster (gated por `VITE_COACH_ACCOUNTS`).

SP1a es solo datos/RLS/sync: no trae UI ni invitaciones.

## Fase 0 — Ahora (no requiere SP1b)

**Objetivo:** una persona-coach entiende en 10s qué es y pide demo.

- **Hero honesto:** "Operá el entrenamiento de tus atletas desde una sola cuenta, con un
  coach AI multideporte que aporta contexto objetivo opcional." CTA único: **Solicitar demo**
  (no "Empezar gratis" mientras el flujo sea manual).
- **Bloque "Para quién es":** coach/entrenador que ya lleva 1–5 atletas y quiere ordenar
  planificación + adherencia. Deporte de origen competitivo (squash/running/fuerza).
- **Bloque "Qué NO es":** no es diagnóstico, no reemplaza supervisión presencial, no
  garantiza resultados, no es "IA ilimitada".
- **Prueba visual honesta:** 2–4 screenshots reales (roster `/coach`, un plan, la
  ReadinessCard). Sin prueba social inventada.
- **Gating legal:** enlazar `/terms`, `/privacy`, `/health-disclaimer` y el descargo Whoop
  desde el footer y el CTA. Hoy son borradores en `docs/legal/` — publicarlos como rutas es
  prerequisito para captar.
- **Whoop con lenguaje correcto:** contexto objetivo opcional y consentido.

**Bloqueantes reales de Fase 0:** rutas legales publicadas + un canal de demo
(WhatsApp/email `hola@rallyiq.cl`). Nada más.

## Fase 1 — Cuando SP1b esté en prod

**Objetivo:** pasar de "solicitar demo" a mostrar el flujo dos-lados real.

- Sección **"Cómo funciona"**: (1) creás al atleta, (2) lo invitás
  (`grant_coach` / `claim_self`), (3) el atleta entra con su cuenta y completa sus sesiones,
  (4) vos ves adherencia y ajustás.
- Recién acá tiene sentido un CTA self-serve ("Invitá a tu primer atleta").
- Requisitos de producto: RPCs de invitación, ruta `/claim`, consentimiento biométrico
  versionado antes de conectar Whoop de terceros.

## Fase 2 — Monetización

- Encajar con `PricingPage` (Base / Coach Semanal / Avanzado). Validar precios reales antes
  de cobro.
- Oferta fundador: cupos, precio, soporte incluido, política simple de cancelación/reembolso.

## Secuencia recomendada (alineada al roadmap)

El roadmap prioriza **Whoop `011`/`012` + legal antes de SP1**. Por eso:

1. **Cerrar Whoop en prod** (`011`, smoke, deploy) — prioridad #1 del roadmap.
2. **Publicar rutas legales + consentimiento** — desbloquea la Fase 0 de la landing.
3. **Landing del coach Fase 0** (captación + demo manual) — construible en paralelo; no
   depende de SP1.
4. **Aplicar `013a/b/c` + implementar SP1b** (invites/UI).
5. **Landing del coach Fase 1** (dos-lados real) + evolución de pricing.

## Riesgo principal a evitar

Lanzar una landing que prometa "invitá a tus atletas / ellos entran con su cuenta" **antes**
de SP1b: el backend de SP1a no tiene invitaciones ni login de atleta, y quedarías vendiendo
algo que no podés entregar. Mantener la landing en modo captación/demo hasta que SP1b esté
smokeado en prod.

## Pendientes para iterar

- [ ] Definir el one-liner final del hero.
- [ ] Confirmar CTA (`Solicitar demo` vs self-serve) según estado de SP1b.
- [ ] Redactar copy de "Para quién es" / "Qué no es".
- [ ] Definir set de screenshots honestos.
- [ ] Confirmar publicación de rutas legales antes de exponer la landing.

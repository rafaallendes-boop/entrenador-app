# Estrategia: Landing del coach (RallyIQ)

> Estado: **borrador iterado** (2026-07-11). Base para iterar. No es spec de implementación todavía.

## Dos productos distintos

Este documento cubría solo la landing pública, pero coach en RallyIQ son en realidad **dos
superficies separadas** que no deben mezclarse en diseño ni en gating:

- **`/coaches`** — landing pública para *captar* entrenadores. Vive en la superficie pública
  general (como `LandingPage`/`FeaturesPage`/`PricingPage`), no requiere sesión, y es lo único
  que este documento llamaba "landing del coach" hasta ahora.
- **`/coach`** — workspace autenticado donde un coach *opera* su negocio: su roster de atletas,
  la planificación asistida por IA y su biblioteca propia. Hoy existe como `CoachRosterPage`
  (roster básico gated por `VITE_COACH_ACCOUNTS`), pero el destino es un producto completo, no
  una sola página de roster.

Toda decisión de Fase 0/1/2 de este doc aplica a `/coaches`. El diseño del workspace `/coach` se
detalla en la sección siguiente y tiene su propia secuencia de construcción, independiente del
copy/CTA de la landing pública.

**`/coaches` no existe hoy como ruta, y crearla no es solo agregar una página.** Corrección sobre
la versión anterior de este doc: `ROUTES.FEATURES` y `ROUTES.PRICING` (`src/constants/routes.ts`)
y sus componentes (`LandingPage.tsx`, `FeaturesPage.tsx`, `PricingPage.tsx`) existen, pero
**ninguno está montado como `<Route>` en `src/App.tsx`** — no aparecen en absoluto dentro del
árbol de `<Routes>`. No es que vivan "dentro de `AuthGate`"; hoy el router (`src/App.tsx:327-357`)
solo define el árbol autenticado: `<BrowserRouter><AuthGate>…<Routes>…</Routes>…</AuthGate></BrowserRouter>`,
y ese árbol no incluye ninguna ruta pública en absoluto. `src/constants/routes.ts` tampoco define
`/coaches` ni rutas legales (`/terms`, `/privacy`, `/health-disclaimer`).

Publicar la landing pública y las rutas legales requiere decidir la arquitectura de rutas desde
cero: crear un grupo de rutas públicas que se rendericen **fuera** de `AuthGate` (o antes de que
`AuthGate` decida si hay sesión), y luego sí montar `LandingPage`/`FeaturesPage`/`PricingPage`
—hoy huérfanas— más las páginas legales nuevas. Esto es un prerequisito técnico de la Fase 0 de
la landing, separado del trabajo de `/coach`.

## Workspace `/coach`: cinco áreas

El destino de `/coach` no es una página de roster suelta, sino un workspace con cinco áreas:

1. **Resumen** — home del coach: atletas que requieren atención (alertas, sin check-in,
   readiness rojo), adherencia semanal agregada, próximas sesiones del roster.
2. **Alumnos** — roster, perfil de cada atleta, su planificación activa, historial y progreso.
3. **Planificación** — entrenamiento diario, semana y plan completo, asistidos por IA.
4. **Biblioteca** — ejercicios y plantillas reutilizables del coach (propios, no genéricos).
5. **Asistente IA** — propone cambios (sesión, semana, plan, ajustes), pero el coach siempre
   revisa y confirma antes de que impacten a un atleta. Ningún cambio de IA se aplica sin ese
   paso de confirmación explícita — mismo principio que ya rige Plan Builder V2 hoy
   (`needs_review` / "Revisión del plan").

### Base ya aprovechable

No se parte de cero — ya existe backend/UI reusable para construir las cinco áreas:

- **Alumnos**: roster y cambio de atleta activo en `CoachRosterPage` (`src/pages/CoachRosterPage.tsx`),
  gated hoy por `VITE_COACH_ACCOUNTS` (`src/services/athlete/coachAccess.ts`,
  `coachScopeGuard.ts`).
- **Planificación → semana**: `WeekCreatorEngine` (`src/services/weekCreator/WeekCreatorEngine.ts`)
  genera la semana, pero es un servicio invocado desde el flujo de chat (`useChatStore.ts`), **no
  una página navegable**. Hoy no hay ruta que lo exponga directamente. Un CTA "Semana" desde el
  workspace debe llevar a `ROUTES.WEEK` (`/week`, `WeeklyView`) para *ver* la semana del atleta
  seleccionado; si además se quiere un CTA de "crear/generar semana" con IA, hay que definir qué
  UI lo expone (¿reusar el flujo de chat con el atleta activo? ¿una entrada nueva?) — eso queda
  pendiente de decidir, no asumido.
- **Planificación → plan completo**: `PlanBuilderV2` (`src/pages/PlanBuilderV2Page.tsx`), ruteado en
  `ROUTES.PLAN_BUILDER_V2` (`/plans/builder`) — esta sí es una página navegable existente.
- **Asistente IA**: propuestas y ajustes de sesiones vía el coach AI existente (mismo motor que
  ya usa el atleta self, aplicado ahora sobre el atleta activo del roster).
- **Resumen / progreso**: sesiones, check-ins, resúmenes semanales y adherencia ya existen como
  datos por atleta — falta agregarlos en una vista de coach, no construirlos desde cero.

Ninguna de las cinco áreas requiere SP1b para arrancar: todas operan hoy sobre atletas
gestionados (managed athletes), igual que `CoachRosterPage`.

### Modelo de navegación: suplantación temporal, no dashboard agregado

El roster actual no muestra datos de varios atletas a la vez: `handleTrainAs`
(`src/pages/CoachRosterPage.tsx:64`) cambia `activeAthleteId` vía `switchActiveAthlete` y navega
a `ROUTES.HOME`, es decir, el coach entra a ver el dashboard *como si fuera* ese atleta
("Entrenar como este atleta"). Es una suplantación de sesión, no una vista de coach.

Para el primer slice (`Coach Workspace v0`, ver más abajo) es correcto seguir reutilizando este
mecanismo: es barato, ya está probado, y evita construir queries agregadas antes de tener claro
qué necesita ver el coach. Pero debe quedar declarado explícitamente como **solución temporal**,
y tiene una consecuencia directa sobre el alcance de v0: `listOwnedAthletes`
(`src/services/athlete/managedAthletes.ts:33`) —lo único que hoy alimenta `CoachRosterPage`— solo
lee la tabla `athletes` (id, nombre, estado). No lee `sessions`, `dayLogs` ni `readinessDaily` de
esos atletas. Cualquier señal por atleta (sin check-in, readiness rojo, próxima sesión, sesión
vencida) requiere leer datos de N atletas sin cambiar `activeAthleteId` — eso **es** la capa de
lectura multi-atleta que la sección anterior dice que v0 no va a construir. Declarar "v0 tendrá
señales/umbrales por atleta" y "v0 no hace queries agregadas" a la vez es contradictorio; ver
resolución en la sección `Coach Workspace v0` de abajo.

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

El roadmap prioriza **Whoop `011`/`012` + legal antes de SP1**. La landing pública (`/coaches`)
y el workspace (`/coach`) se construyen en paralelo pero con hitos propios:

1. **Cerrar Whoop en prod, legal y despliegue de SP1a** (`011`, `012`, smoke, rutas legales) —
   prioridad #1 del roadmap.
2. **Convertir `/coach` en un home sencillo**: roster mejorado + accesos directos a `/week` y
   `/plans/builder` del atleta seleccionado (ver alcance detallado de `Coach Workspace v0` más
   abajo — sin señales agregadas, sin CTA de generar semana con IA). Esto es reorganizar UI sobre
   suplantación existente, no construir motor nuevo ni dashboard agregado — **no depende del
   paso 1** y puede arrancar ya.
3. **Implementar SP1b**: invitaciones, ruta `/claim`, relación real coach–atleta
   (`grant_coach` / `claim_self`). **Depende de que SP1a del paso 1 esté desplegado y smokeado**
   en prod — SP1b construye sobre esos datos/RLS, no puede empezar antes.
4. **Biblioteca privada** de ejercicios y plantillas por coach.
5. **Asignación**: permitir asignar un ejercicio o plantilla de la biblioteca a la sesión de
   un alumno puntual.
6. **Unificar los tres modos IA** (sesión diaria, semana, plan) en un único flujo del workspace,
   en vez de tres entradas separadas.
7. **Progreso por atleta**: planificado vs. completado, carga, check-ins y alertas básicas —
   alimenta el área Resumen.
8. **Landing pública `/coaches` a self-service** (Fase 1 de este doc) y recién después trabajar
   pricing (Fase 2).

Dependencias reales (no todo lo posterior al paso 1 es independiente de él):

- El paso 2 (home `/coach`) no depende del paso 1 y puede construirse en paralelo.
- El paso 3 (SP1b) **sí depende** del paso 1: necesita SP1a desplegado y smokeado en prod.
- La Fase 0 de la landing pública (captación + demo manual) **depende** de que las rutas legales
  del paso 1 estén publicadas — sin eso no hay dónde enlazar `/terms`, `/privacy`,
  `/health-disclaimer` desde el CTA, y tampoco existe todavía la arquitectura de rutas públicas
  (ver sección "Dos productos distintos" arriba).
- Los pasos 4–7 son sobre el workspace `/coach` y no bloquean la landing pública `/coaches`.

## Próximo plan: Coach Workspace v0 — Resumen + roster

El siguiente documento ejecutable debe cubrir **únicamente el paso 2** de la secuencia de
arriba: convertir `/coach` en un home simple sobre el roster existente. No debe intentar
planificar las cinco áreas completas ni la landing pública `/coaches` en el mismo documento —
son dependencias distintas (una es UI sobre datos existentes, la otra es una decisión de
arquitectura de rutas todavía sin tomar) y mezclarlas en un solo plan ejecutable haría difícil
revisarlo y cerrarlo.

**Resolución de la contradicción de alcance:** `Coach Workspace v0` es **roster mejorado, no
dashboard agregado**. Se descarta la opción de meter señales/umbrales por atleta en v0 porque
eso obligaría a construir la capa de lectura multi-atleta (queries, límites, tests) que la
sección anterior ya declara fuera de alcance para este primer slice — y ese trabajo es
suficientemente grande como para ameritar su propio plan, con su propia decisión de qué señales
importan y qué performance/límites tiene leer N atletas a la vez.

Alcance de `Coach Workspace v0` (roster mejorado):

- Navegación lateral mínima entre las cinco áreas (aunque solo Resumen y Alumnos tengan
  contenido real; el resto puede ser placeholder/"próximamente").
- Tarjetas por atleta del roster en el área Resumen, con **solo lo que `listOwnedAthletes` ya
  provee hoy**: nombre/`displayName`, si es el self, si es el atleta activo ("Entrenando ahora").
  Sin señales calculadas (sin check-in, readiness, sesión vencida) — nada que requiera leer
  `sessions`/`dayLogs`/`readinessDaily` de atletas que no son el activo.
- Selección de atleta activo reutilizando `switchActiveAthlete` / `handleTrainAs` tal como existe
  hoy, declarado explícitamente como suplantación temporal (ver sección de arriba).
- Accesos directos desde cada tarjeta a `ROUTES.WEEK` (`/week`, ver semana) y
  `ROUTES.PLAN_BUILDER_V2` (`/plans/builder`, ver/crear plan) del atleta que se selecciona como
  activo. Sin CTA de "generar semana con IA" en v0, porque esa acción hoy vive en el flujo de
  chat y no en una ruta navegable — decidir esa UI queda para un plan posterior.

Fuera de alcance de este plan (quedan para planes posteriores): **dashboard agregado con
señales/umbrales por atleta** (requiere la capa de lectura multi-atleta descrita arriba), landing
pública `/coaches` y sus rutas legales, Biblioteca, Asignación, unificación de los tres modos IA
(incluyendo qué UI expone "crear semana" con IA fuera del chat), progreso detallado por atleta, y
el cambio de gating a `account_type` (ver sección de gating más abajo — ese cambio es requisito
de la Fase 1 de la landing/self-service, no de este plan).

### Decisiones a cerrar antes de escribir el plan

Acotadas porque v0 es roster mejorado, no dashboard:

- **Estados vacíos, de carga y de error** del roster (sin atletas todavía, fallo al cargar
  `listOwnedAthletes`).
- **Copy/orden de las cinco áreas** en la navegación lateral y qué placeholder muestran las
  tres que no tienen contenido real todavía (Planificación, Biblioteca, Asistente IA — Resumen
  y Alumnos sí tienen contenido real en v0).
- **Comportamiento exacto de los CTA** de cada tarjeta: ¿navegan directo a `/week`/`/plans/builder`
  del atleta ya activo, o primero disparan `switchActiveAthlete` y después navegan? (Hoy
  `handleTrainAs` hace ambas cosas en un solo paso — confirmar si ese es el patrón a seguir para
  los nuevos CTA o si conviene separarlos.)

## Riesgo principal a evitar

Lanzar una landing que prometa "invitá a tus atletas / ellos entran con su cuenta" **antes**
de SP1b: el backend de SP1a no tiene invitaciones ni login de atleta, y quedarías vendiendo
algo que no podés entregar. Mantener la landing en modo captación/demo hasta que SP1b esté
smokeado en prod.

## Gating de acceso: `VITE_COACH_ACCOUNTS` hoy, `account_type` antes de registro público

Mientras Rafael sea el único usuario coach, mantener `VITE_COACH_ACCOUNTS`
(`src/services/athlete/coachAccess.ts` + `coachScopeGuard.ts`) como mecanismo de acceso es
suficiente y no vale la pena reemplazarlo todavía — es un flag de allowlist, barato de operar
con un solo operador.

Eso deja de ser suficiente en el momento en que se abra registro público de coaches (Fase 1/2
de la landing `/coaches`). En ese punto conviene introducir un **rol de cuenta persistente**
(p. ej. `account_type = coach | athlete` en el perfil), en vez de seguir infiriendo "es coach"
solo a partir de la existencia de membresías (`athlete_memberships` de SP1a/SP1b). Inferir el
rol desde membresías funciona para un allowlist manual, pero no escala a self-serve: una cuenta
nueva sin membresías todavía no tiene forma de declarar "soy coach" ni de que el producto la
trate como tal antes de que cree su primer atleta gestionado o reciba su primera invitación.

Este cambio de gating es un prerequisito de la Fase 1 de la landing (self-serve dos-lados), no
del workspace `/coach` en sí — no bloquea los pasos 2–7 de la secuencia de arriba.

## Pendientes para iterar

Landing pública `/coaches`:

- [ ] Definir el one-liner final del hero.
- [ ] Confirmar CTA (`Solicitar demo` vs self-serve) según estado de SP1b.
- [ ] Redactar copy de "Para quién es" / "Qué no es".
- [ ] Definir set de screenshots honestos (idealmente del workspace `/coach` ya reorganizado).
- [ ] Confirmar publicación de rutas legales antes de exponer la landing.

Workspace `/coach` — `Coach Workspace v0` (roster mejorado; ver sección dedicada arriba):

- [ ] Cerrar las 3 decisiones de estados vacíos/copy de navegación/comportamiento de CTA antes de
      repartir tareas.
- [ ] Decidir arquitectura de rutas públicas antes de que la Fase 0 de la landing dependa de ella.

Workspace `/coach` — planes posteriores a v0:

- [ ] Diseñar la capa de lectura multi-atleta (queries, límites, tests) y con ella el dashboard
      agregado con señales/umbrales por atleta (sin check-in, readiness, sesión vencida) que
      quedó fuera de v0.
- [ ] Definir qué UI expone "crear/generar semana con IA" fuera del flujo de chat, si se decide
      llevar `WeekCreatorEngine` a una acción navegable del workspace.
- [ ] Definir modelo de datos mínimo de Biblioteca (ejercicios/plantillas por coach).
- [ ] Definir el punto de confirmación explícita del coach para cambios propuestos por el
      Asistente IA (reusar patrón `needs_review` de Plan Builder V2).
- [ ] Diseñar queries/vistas agregadas por roster que reemplacen la suplantación temporal.
- [ ] Decidir el momento exacto de introducir `account_type` vs. seguir con `VITE_COACH_ACCOUNTS`.

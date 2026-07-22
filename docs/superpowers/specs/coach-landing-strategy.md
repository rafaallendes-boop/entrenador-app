# Estrategia: Landing del coach (RallyIQ)

> Estado: **borrador iterado** (2026-07-11). Base para iterar. No es spec de implementación todavía.

## Dos productos distintos

Este documento cubría solo la landing pública, pero coach en RallyIQ son en realidad **dos
superficies separadas** que no deben mezclarse en diseño ni en gating:

- **`/coaches`** — landing pública para *captar* entrenadores. Vive en la superficie pública
  general (como `LandingPage`/`FeaturesPage`/`PricingPage`), no requiere sesión, y es lo único
  que este documento llamaba "landing del coach" hasta ahora.
- **`/coach`** — workspace autenticado donde un coach *opera* su negocio. Coach Workspace v0 ya
  está en producción como `CoachWorkspacePage`: Resumen y Alumnos tienen contenido real sobre
  el roster existente; Planificación, Biblioteca y Asistente IA son placeholders honestos. El
  acceso sigue gated por `VITE_COACH_ACCOUNTS`.

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

- **Alumnos**: roster, alta y cambio de atleta activo en `CoachWorkspacePage` mediante
  `CoachRosterPanel`, gated hoy por `VITE_COACH_ACCOUNTS`
  (`src/services/athlete/coachAccess.ts`, `coachScopeGuard.ts`). `CoachRosterPage` ya fue retirado.
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

Ninguna de las cinco áreas requiere SP1b para arrancar: las áreas reales de v0 ya operan sobre
atletas gestionados (managed athletes) dentro de `CoachWorkspacePage`.

### Modelo de navegación: suplantación temporal, no dashboard agregado

El workspace actual no agrega señales de varios atletas a la vez. Sus acciones por tarjeta
cambian `activeAthleteId` vía `switchActiveAthlete` y después navegan a la semana o al plan del
atleta seleccionado; "Entrenar como este atleta" navega al dashboard. Es una suplantación de
sesión temporal, no una vista agregada multi-atleta.

Para el primer slice (`Coach Workspace v0`, ver más abajo) es correcto seguir reutilizando este
mecanismo: es barato, ya está probado, y evita construir queries agregadas antes de tener claro
qué necesita ver el coach. Pero debe quedar declarado explícitamente como **solución temporal**,
y tiene una consecuencia directa sobre el alcance de v0: `listOwnedAthletes`
(`src/services/athlete/managedAthletes.ts`) —la fuente del roster de `CoachWorkspacePage`— solo
lee la tabla `athletes` (id, nombre, estado). No lee `sessions`, `dayLogs` ni `readinessDaily` de
esos atletas. Cualquier señal por atleta (sin check-in, readiness rojo, próxima sesión, sesión
vencida) requiere leer datos de N atletas sin cambiar `activeAthleteId` — eso **es** la capa de
lectura multi-atleta que la sección anterior dice que v0 no va a construir. Declarar "v0 tendrá
señales/umbrales por atleta" y "v0 no hace queries agregadas" a la vez es contradictorio; ver
resolución en la sección `Coach Workspace v0` de abajo.

## Principio rector

La landing del coach debe prometer **solo lo que el backend puede cumplir hoy**. SP1a
(datos + RLS v2 + sync de dos lados) está implementado en código; su rollout operativo se
confirma por separado y, en cualquier caso, **no** incluye
invitaciones ni login de atleta — eso es **SP1b**. El owner descartó un piloto/demo: la
landing arranca en modo **prelanzamiento pagado**, capta interés sin prometer acceso inmediato y
pasa a checkout/self-serve cuando estén listos identidad legal, pasarela, términos comerciales,
roles persistentes y aceptación versionada. SP1b no bloquea vender el flujo actual de atletas
gestionados sin login, pero sí bloquea prometer que cada atleta entra con su propia cuenta.

Restricciones duras (consistentes con las reglas del proyecto y el descargo Whoop):

- No prometer diagnóstico, prevención de lesiones ni ajuste automático.
- No vender "IA ilimitada" como valor central.
- Whoop = "contexto objetivo opcional y consentido", nunca métrica de salud/diagnóstico.
- No exponer datos biométricos sin consentimiento y borrado completo.

## Estado actual (punto de partida)

Hoy **no existe una landing del coach** como página. Existen:

- `src/pages/LandingPage.tsx`, `FeaturesPage.tsx`, `PricingPage.tsx` — superficie pública genérica.
- `src/pages/CoachWorkspacePage.tsx` (`/coach`) — Coach Workspace v0 desplegado, gated por
  `VITE_COACH_ACCOUNTS`.

SP1a es solo datos/RLS/sync: no trae UI ni invitaciones.

## Fase 0 — Ahora (no requiere SP1b)

**Objetivo:** una persona-coach entiende en 10s qué es y puede pedir ser avisada del lanzamiento.

- **Hero honesto:** "Gestiona el entrenamiento de tus atletas desde una sola cuenta, con un
  coach AI multideporte que aporta contexto objetivo opcional." Única acción de conversión:
  **Avisarme del lanzamiento** (puede repetirse en nav/hero/cierre, siempre con el mismo label y
  destino). Al habilitar pago cambia a **Elegir plan** y conduce al checkout real; no se publica
  "Empezar gratis" ni "Solicitar demo" porque no habrá plan gratuito ni piloto.
- **Bloque "Para quién es":** coach/entrenador que ya lleva 1–5 atletas y quiere ordenar
  planificación + adherencia. Deporte de origen competitivo (squash/running/fuerza).
- **Bloque "Qué NO es":** no es diagnóstico, no reemplaza supervisión presencial, no
  garantiza resultados, no es "IA ilimitada".
- **Prueba visual honesta:** 2–4 screenshots reales (roster `/coach`, un plan, la
  ReadinessCard). Sin prueba social inventada. Mientras esas capturas no existan y no estén
  anonimizadas, la landing omite la sección completa y no referencia archivos inexistentes.
- **Gating legal:** enlazar `/terms`, `/privacy`, `/health-disclaimer` y `/whoop-disclaimer`
  desde el footer y el CTA. Hoy son borradores en `docs/legal/` — publicarlos como rutas es
  prerequisito para captar.
- **Whoop con lenguaje correcto:** contexto objetivo opcional y consentido.

**Bloqueantes reales de Fase 0 pública:** rutas legales canónicas con responsable identificado +
un canal de prelanzamiento (`hola@rallyiq.cl`). El código, las capturas y el router pueden quedar
listos antes; la publicación legal y el lanzamiento pagado no pueden contener placeholders.

Las siete rutas públicas publican título, descripción, Open Graph, Twitter Card y canonical
específicos tanto durante la navegación React como en el HTML generado por el build; los previews
sociales no dependen de que el crawler ejecute JavaScript.

Publicar las páginas legales cierra el requisito de información/enlaces de Fase 0, pero no
equivale a registrar aceptación versionada ni consentimiento biométrico durable. Esos siguen
siendo requisitos separados antes de abrir Whoop a terceros. La política debe distinguir la
Ley 19.628 vigente de la reforma de la Ley 21.719, cuya entrada en vigor está fijada para el
1 de diciembre de 2026, y no puede inferir la identidad legal del responsable desde Git.

**Decisión temporal sobre menores:** el lanzamiento pagado inicial es solo para cuentas y datos
de atletas mayores de 18 años. No se cargan perfiles, salud, rendimiento ni datos Whoop de
menores hasta tener revisión legal y un flujo verificable de consentimiento del representante.
La [Ley 21.719 publicada por la BCN](https://www.bcn.cl/leychile/navegar?idNorma=1209272)
incorpora reglas específicas para niños y adolescentes cuando entre en vigor. Esta es una
restricción conservadora de producto, no una conclusión ni asesoría legal: evita improvisar ese
tratamiento durante el lanzamiento y debe revalidarse con asesoría antes de admitir menores.

## Fase 1 — Lanzamiento pagado

**Objetivo:** pasar de "avisarme" a checkout, entitlement activo y onboarding por rol.

- CTA **"Elegir plan"** conectado a una pasarela real; precio, impuestos/documento tributario,
  renovación, cancelación y reembolsos deben estar definidos antes del primer cobro.
- Identidad legal del proveedor/controlador publicada y revisada.
- Aceptación versionada de términos/privacidad y consentimiento biométrico durable cuando aplique.
- Registro público de coaches ya no depende de `VITE_COACH_ACCOUNTS`; usa roles persistentes
  acumulables (ver sección de gating).

SP1b sigue siendo una mejora posterior o paralela si el primer producto pagado opera con atletas
gestionados sin login. Cuando SP1b esté en prod, recién se agrega el flujo dos-lados real:

- Sección **"Cómo funciona"**: (1) creás al atleta, (2) lo invitás
  (`grant_coach` / `claim_self`), (3) el atleta entra con su cuenta y completa sus sesiones,
  (4) tú ves adherencia y ajustas.
- Recién con SP1b tiene sentido prometer "Invitá a tu primer atleta".
- Requisitos de producto: RPCs de invitación, ruta `/claim`, consentimiento biométrico
  versionado antes de conectar Whoop de terceros.

## Fase 2 — Producto dos-lados y expansión

- Integrar la experiencia del atleta con login propio, invitaciones y permisos revocables.
- Revalidar segmentación y pricing con uso real, sin introducir un piloto gratuito retroactivo.

## Secuencia recomendada (alineada al roadmap)

Whoop `011`/`012` y Coach Workspace v0 ya están en producción. La secuencia vigente queda:

1. **Cerrar implementación de Fase 0 de `/coaches`**: arquitectura pública, landing de
   prelanzamiento, legal publicado con `Rafael Allendes` como responsable temporal confirmado
   por el owner, screenshots y smoke. El trabajo técnico no depende de SP1a/SP1b.
2. **Cerrar gates del lanzamiento pagado**: identidad legal, mayores de 18, pasarela y
   entitlements, términos comerciales, aceptación versionada, consentimiento biométrico durable
   y roles de cuenta persistentes.
3. **Lanzar pago** con el flujo honesto disponible: coaches gestionan atletas sin login. No
   prometer invitaciones ni acceso del atleta todavía.
4. **Implementar SP1b**: invitaciones, ruta `/claim`, relación real coach–atleta
   (`grant_coach` / `claim_self`). Depende de que SP1a esté desplegado y smokeado en prod.
5. **Biblioteca privada** de ejercicios y plantillas por coach.
6. **Asignación**: permitir asignar un ejercicio o plantilla de la biblioteca a la sesión de
   un alumno puntual.
7. **Unificar los tres modos IA** (sesión diaria, semana, plan) en un único flujo del workspace,
   en vez de tres entradas separadas.
8. **Progreso por atleta**: planificado vs. completado, carga, check-ins y alertas básicas —
   alimenta el área Resumen.

Dependencias reales (no todo lo posterior al paso 1 es independiente de él):

- Los pasos históricos de Whoop y home `/coach` ya están cerrados.
- El lanzamiento pagado del flujo managed-athlete no necesita SP1b, pero sí necesita roles
  persistentes para dar acceso coach sin editar Netlify por cada cuenta.
- SP1b sí necesita SP1a desplegado y smokeado en prod.
- La Fase 0 de la landing pública (prelanzamiento pagado) **depende** de que las rutas legales
  canónicas estén publicadas — sin eso no hay dónde enlazar `/terms`, `/privacy`,
  `/health-disclaimer` y `/whoop-disclaimer` desde el CTA, y tampoco existe todavía la arquitectura de rutas públicas
  (ver sección "Dos productos distintos" arriba).
- Los pasos 4–8 mejoran el producto dos-lados/workspace y no bloquean la landing de prelanzamiento.

## Coach Workspace v0 — Resumen + roster (cerrado y desplegado)

El plan de Coach Workspace v0 ejecutó el antiguo paso de
workspace y ya está desplegado (plan retirado tras el despliegue; historial en git). Se mantiene
esta sección como registro de las decisiones de alcance que guiaron v0;
la landing pública `/coaches` y su arquitectura de rutas se ejecutaron en el plan separado de
Fase 0, también retirado tras su despliegue.

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
el cambio de gating a roles persistentes acumulables (ver sección de gating más abajo — requisito
del lanzamiento pagado, no de Workspace v0).

### Decisiones cerradas por el plan implementado

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

Lanzar una landing o checkout que prometa "invitá a tus atletas / ellos entran con su cuenta"
**antes** de SP1b: el backend de SP1a no trae ese flujo. El lanzamiento pagado inicial puede
vender la operación actual de atletas gestionados sin login, pero debe decirlo con claridad.

## Gating de acceso: allowlist temporal hoy, roles acumulables antes del lanzamiento pagado

`VITE_COACH_ACCOUNTS` no es una Netlify Function ni una barrera de autorización: es una variable
de entorno **build-time y pública** que `isCoachAccount` usa para mostrar la UI coach. Hoy se
configura manualmente en Netlify y acepta varios emails separados por comas, pero cada alta/baja
requiere cambiar configuración y desplegar otro bundle. La seguridad real debe seguir viviendo
en membresías/RLS, nunca en esta variable.

La propuesta anterior de `account_type = coach | athlete` queda descartada porque hace los roles
mutuamente excluyentes y no representa al coach que también entrena. El modelo objetivo separa:

- **Roles globales acumulables de cuenta:** `athlete`, `coach` (tabla `account_roles` con PK
  `(account_id, role)`, o contrato equivalente). Una cuenta puede tener uno o ambos.
- **Modo preferido de entrada:** `default_mode = athlete | coach`, usado solo para decidir home,
  navegación y onboarding; no concede permisos.
- **Autorización por atleta:** `athlete_memberships` sigue siendo la fuente de verdad. `self`
  permite operar el atleta propio; `coach` permite operar los atletas del roster.

Casos resultantes:

- Jugador: rol global `athlete` + membresía `self` sobre su atleta.
- Coach que no usa RallyIQ para entrenarse: rol global `coach` + membresías `coach` sobre sus
  atletas. Puede existir un perfil self técnico por compatibilidad, pero la UI no tiene por qué
  mostrarlo como experiencia principal.
- Coach-jugador: roles globales `athlete` y `coach` + una membresía `self` sobre su propio atleta
  + membresías `coach` sobre otros. En la UI puede alternar “Mi entrenamiento” / “Workspace coach”
  sin cambiar de cuenta ni duplicar identidad.

Hay que distinguir tres alcances que suelen llamarse “varios coaches”:

- **Varios coaches independientes usando RallyIQ:** es el alcance del lanzamiento pagado. Cada
  cuenta tiene rol `coach`, su propio entitlement y ve su roster autorizado.
- **Varios coaches sobre el mismo atleta:** `athlete_memberships` puede representar más de una
  membresía `coach`, pero el roster actual usa `listOwnedAthletes(ownerAccountId)` y filtra por
  `ownerAccountId`. Para soportarlo de verdad hay que cambiar el roster a lectura por membresías,
  agregar grant/revoke y probar RLS; no debe prometerse como parte del primer lanzamiento.
- **Equipo/academia con asientos, billing y administración compartida:** requiere una entidad de
  organización y queda fuera de este modelo inicial.

Rollout recomendado:

1. Mantener `VITE_COACH_ACCOUNTS` solo para el owner y QA mientras no exista alta pública.
2. Antes del lanzamiento pagado, crear roles persistentes y un onboarding donde la persona pueda
   elegir “Entreno”, “Soy coach” o ambas; guardar además `default_mode`.
3. Hacer que `isCoachAccount` lea el rol persistente, con la allowlist únicamente como fallback
   transitorio de rollback.
4. Retirar la allowlist después del backfill y smoke de cuentas jugador, coach y coach-jugador.

El plan de implementación de roles debe incluir, como mínimo:

1. Migración y RLS para roles acumulables; un rol describe el modo de uso, no el estado de pago.
2. Entitlement de suscripción separado, alimentado por webhooks verificados de la pasarela.
3. Onboarding con “Entreno”, “Soy coach” o ambas, más `default_mode` editable.
4. Home/selector de modo para coach-jugador sin crear otra cuenta.
5. `isCoachAccount` leyendo el rol persistente y usando `VITE_COACH_ACCOUNTS` solo como fallback.
6. Tests de aislamiento y navegación para jugador, coach, coach-jugador y cuenta sin entitlement.

Este cambio sí es prerequisito del registro público pagado de coaches. SP1b no lo es si el
producto inicial sigue operando atletas gestionados sin login.

## Decisiones cerradas para Fase 0 (2026-07-13, con Coach Workspace v0 ya en produccion)

Con `/coach` ya reorganizado (Coach Workspace v0), el owner confirmo la direccion de este
documento y cerro las siguientes decisiones para ejecutar Fase 0 de `/coaches`:

1. **Arquitectura de rutas publicas explicitas**: `/features`, `/pricing`, `/coaches`, `/terms`,
   `/privacy`, `/health-disclaimer` y `/whoop-disclaimer`. Correccion tecnica clave
   sobre el estado real: hoy `/features` y `/pricing` "funcionan" solo porque `AuthGate` decide
   que renderizar como fallback segun el pathname — no son rutas reales fuera de `AuthGate`. Eso
   es lo que hay que corregir, no solo agregar `/coaches` como ruta nueva.
   - `/` queda **condicional**, no se vuelve landing publica incondicional: visitante sin sesion
     ve landing, usuario autenticado conserva el Dashboard. Cambiar ese comportamiento de `/` es
     una decision aparte, no incluida en este cierre de Fase 0.
2. **Legal publicado y enlazado, con reconciliacion previa**: ya hay borradores en `docs/legal/`,
   pero tambien existe un HTML estático en `public/legal/privacidad/` que hoy es públicamente
   alcanzable. Hay que reconciliar ambos en una sola `/privacy`, eliminar el archivo duplicado y
   redirigir permanentemente su URL antigua. Para Fase 0 el owner confirmó temporalmente
   `Rafael Allendes` como responsable; debe quedar centralizado para sustituirlo cuando exista
   una entidad definitiva. No se han proporcionado RUT ni domicilio: no se inventan, y su
   definición junto con revisión legal sigue pendiente antes del lanzamiento pagado. La política distingue la Ley 19.628 vigente de la entrada en vigor
   de la Ley 21.719 el 2026-12-01.
3. **`/coaches` es una landing separada, no un reciclaje de la landing de atletas.** Hero +
   "Para quien es" + "Que no es" + 2-4 capturas reales y anonimizadas del workspace. Resumen y
   Alumnos (Coach Workspace v0) ya sirven como primeras capturas honestas; una captura de un plan
   real completa mejor la prueba visual que solo el roster. Hasta que esos archivos existan, se
   oculta la sección completa para no publicar imágenes rotas ni afirmar que ya hay capturas. Si Whoop aparece en el copy, debe
   decir "contexto objetivo opcional y consentido" — nunca metrica de salud/diagnostico.
4. **Única acción de conversión dentro del funnel coach durante prelanzamiento**:
   "Avisarme del lanzamiento" → `mailto:hola@rallyiq.cl` con asunto prellenado. Puede repetirse
   en nav/hero/cierre siempre que todas las instancias tengan el mismo label y destino. En el
   lanzamiento pagado se reemplaza por "Elegir plan" hacia checkout. WhatsApp solo si ya existe un
   numero/canal operativo real — no inventar un canal para la landing. **No se cambia
   automaticamente la superficie publica de atletas** (`/` y
   `/pricing` de hoy siguen prometiendo alta / "Empezar gratis"): ese es un funnel distinto, y
   unificarlo (o no) con el funnel de coach es una decision comercial global aparte, fuera de
   este cierre de Fase 0.

**Matiz sobre los bloqueantes de prelanzamiento:** legal canónico con la identidad temporal ya
confirmada y canal de contacto son gates de publicación; pasarela, roles persistentes y términos comerciales son gates del
lanzamiento pagado. La arquitectura de rutas publicas (punto 1) es además un prerequisito técnico
inevitable para poder publicar cualquiera de los dos — no depende de SP1 ni de mas capacidades
del workspace `/coach`, es una condicion tecnica para que "legal" y "landing" puedan existir como
rutas navegables en absoluto.

**Secuencia de cierre acordada:** rutas publicas → legal preparado/reconciliado → landing de
prelanzamiento sin referencias rotas → screenshots reales y activación de su sección → smoke DEV → publicar → completar
pasarela/roles/aceptaciones → lanzamiento pagado.

## Pendientes para iterar

Landing pública `/coaches`:

- [x] Confirmar CTA de prelanzamiento: `Avisarme del lanzamiento` → `mailto:hola@rallyiq.cl` con asunto prellenado; al lanzar pago cambia a `Elegir plan` → checkout.
- [x] Definir set de screenshots honestos: Resumen + Alumnos de Coach Workspace v0, más un plan real.
- [x] Definir el one-liner y copy inicial de hero en el plan ejecutable de Fase 0.
- [x] Redactar copy inicial de "Para quién es" / "Qué no es" en el plan ejecutable.
- [x] Reconciliar `docs/legal/politica-de-privacidad.md` con el HTML aislado en `public/legal/privacidad/`; queda revisión legal externa antes de lanzamiento.
- [ ] Confirmar publicación de rutas legales antes de exponer la landing.
- [x] Implementar la arquitectura de rutas públicas explícitas de Fase 0; `/` queda condicional (landing si no hay sesión, Dashboard si la hay).
- [ ] Capturar, anonimizar y optimizar las tres imágenes reales; recién entonces habilitar la sección de prueba visual.

Workspace `/coach` — `Coach Workspace v0` (roster mejorado; ver sección dedicada arriba):

- [x] Estados vacíos/copy de navegación/comportamiento de CTA cerrados e implementados.
- [x] Workspace v0 desplegado; la arquitectura pública quedó aislada en su propio plan.

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
- [x] Descartar `account_type` excluyente; introducir roles persistentes acumulables + `default_mode` antes del lanzamiento pagado, manteniendo `VITE_COACH_ACCOUNTS` solo como fallback transitorio.

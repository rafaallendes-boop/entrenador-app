# RallyIQ - Project Review and Roadmap

Actualizado: 2026-07-08

Base de contraste:

- `main` hasta `8f3c721 Prepare athlete scope 008b rollout and coach F2 plan`, mas el commit actual de Athlete-Aware Core.
- `007` aplicado y F2 data prereqs en `6e33926`.
- `008a` ya fue corrido en produccion con 0 nulls / 0 duplicados reportados.
- `008b` fue aplicado en produccion despues del deploy del write path; `008a` volvio a reportar 0 duplicados/null debt operativo.
- Athlete-Aware Core desplegado y smokeado en produccion: single-athlete no cambio.
- **Coach UI F2-lite Parte 2b desplegada en produccion (2026-07-05):** switcher + roster `/coach` + onboarding athlete-aware, gated por `VITE_COACH_ACCOUNTS`. Migracion `010a/b/c` (day/week full unique expand->contract) aplicada; `008a`/`010a` post-deploy en 0. Smoke self + gestionado OK.
- Superficie publica actualizada para demo multideporte: Landing/Features/Pricing limpian residuos visibles de version/localidad, reducen sesgo squash-only y Pricing queda en 3 planes: Base gratis, Coach Semanal y Avanzado con Plan Builder.
- **Polish de uso real implementado (2026-07-06):** la nota/lectura semanal del coach queda disponible solo desde viernes-domingo y completar todos los ejercicios de una sesion marca automaticamente la sesion como realizada.
- **Decision producto WHOOP (2026-07-06):** adelantar Whoop antes de SP1/two-sided. El plan y spec quedan reconciliados con `011`/Dexie v15, SP1 en `012+`/v16+, readiness `athlete_id` first y contrato de landing/coach sin promesas medicas ni ajuste automatico.
- **WHOOP v1 implementado y revisado (2026-07-08):** integracion end-to-end construida en working tree (uncommitted): `011_whoop_integration.sql` (4 tablas, RLS server-only + `readiness_daily` client-read), Dexie v15 `readinessDaily`, OAuth start/callback/status con state single-use, `tokenCrypto` AES-256-GCM, `whoopClient` v2 (`offline` scope + refresh), `whoopNormalize` (anclaje por `cycle_id`, `timezone_offset`, filtro de siestas, sueño por etapas, tri-estado `score_state` SCORED/PENDING/UNSCORABLE), sync manual con cooldown, cron dedicado (`whoop-cron` scheduled, no publico), `ReadinessCard`, `WhoopConnection`, prefill de check-in gateado (hoy+self+atleta), contexto pasivo del coach sin doble conteo (procedencia `prefillSource:'whoop'`), borrado completo service-role + tolerancia a 404/tabla ausente, export/backup y wipe local. **Task 0 completada por el owner.** Pasaron 6 rondas de `/code-review`; todos los hallazgos (incl. scope `offline`, cron pre-auth, gap de borrado biometrico, race de atleta, mutacion historica) resueltos. Verde: lint + 1160 tests + build + typecheck. Pendiente: aplicar `011` y smoke directo en prod (el owner decidio probar en prod, no staging), + gate legal linkeado antes de exponer a terceros.

## Resumen Ejecutivo

RallyIQ esta en una etapa donde el core ya no es el cuello de botella principal. El motor de planificacion, Plan Builder async, calidad deportiva base, athlete scope foundation, claves naturales locales por atleta, write path remoto seguro para day/week, Athlete-Aware Core y Coach F2-lite Parte 2b ya estan construidos y smokeados.

Lo que queda antes de mostrar/cobrar con confianza se divide en cuatro carriles:

1. **Whoop readiness:** implementado y revisado (Task 0 hecha); resta aplicar `011` en prod, commit/deploy del bundle y smoke end-to-end + linkear gate legal.
2. **Cierre comercial/legal:** rutas legales publicas, consentimiento general + biometrico, soporte y oferta piloto.
3. **QA deportiva:** planes arquetipo ahora operables como atletas gestionados.
4. **SP1 dos-lados:** membresias/invitaciones/RLS v2 despues de Whoop, sin rework sobre readiness.

Mi lectura como lider tecnico: ya se puede preparar demo y piloto acompanado. No esta listo para self-serve publico. Para el uso real del owner y una futura oferta coach creible, Whoop es el siguiente incremento de producto con mas retorno, siempre cerrado con consentimiento biometrico y privacidad antes de exponerlo.

## Estado Actual En Una Frase

RallyIQ ya opera multi-atleta en produccion (Coach F2-lite Parte 2b desplegada y smokeada) y Whoop readiness ya esta implementado y revisado (Task 0 hecha, 6 rondas de code review verdes); el siguiente paso es aplicar `011` en prod, desplegar el bundle y smokear el flujo Whoop end-to-end antes de exponerlo con su gate legal.

## Porcentaje De Avance

Estimacion actual:

- Demo acompanada: **93% listo / 7% pendiente**.
- Piloto manual pagado 1-3 clientes: **84% listo / 16% pendiente**.
- Coach UI F2-lite MVP interno: **70% listo / 30% pendiente**.
- Coach dos-lados/SP1: **20% listo / 80% pendiente**.
- Monetizacion publica self-serve: **58% listo / 42% pendiente**.

Traduccion practica: el producto ya tiene sustancia; lo pendiente es reducir riesgo percibido y riesgo operacional.

## Lo Nuevo Desde El Roadmap Anterior

### 1. `008b` paso de plan a produccion

Se commiteo, desplego y aplico en produccion:

- `reconcileNaturalKeyConflict` cableado en `upsertRow`.
- Resolucion reactiva de `23505` para `day_logs` / `week_summaries`.
- LWW remoto seguro: empate gana remoto; local mas nuevo hace update condicional con `lt(updated_at)`.
- Recheck si el update condicional afecta 0 filas.
- Tests nuevos en `syncService.test.ts`.
- `supabase/008b_athlete_scope_unique.sql`.
- Plan y spec de rollout `008b`.

Estado: **cerrado como gate de integridad day/week**. Mantener `008a` como preflight operativo antes de futuros cambios de contrato.

### 2. Athlete-Aware Core y Coach F2-lite 2b quedaron en produccion

Parte 1 del camino F2-lite:

- Holder de self athlete + seleccion activa persistida.
- Politica legacy self-only (`activeScopeFilter`).
- Lecturas de sessions/day logs/week summaries/proposals/contexto IA filtradas por atleta activo.
- Escrituras locales de sessions/chat/proposals estampan `athleteId`.
- Chat session scoped por atleta, incluyendo import/reset global con `clearAllStoredChatSessionIds`.
- `hydrateActiveAthlete` respeta seleccion valida y no la pisa durante sync.
- Tests de rollback/destructivos para `commitPlan`, `applyCreateWeek`, chat mixto y sync legacy.

Estado: **desplegado y smokeado en produccion**. Single-athlete no cambio; self + gestionado OK.

### 3. WHOOP queda priorizado y reconciliado con SP1

Decision de producto del 2026-07-06:

- Whoop se implementa antes que SP1/two-sided porque el owner usa la app al 100% y necesita recovery/sueno/strain reales.
- Spec y plan WHOOP quedan `athlete_id` first, migracion SQL `011`, Dexie v15.
- SP1 arranca despues (`012+`/Dexie v16+) y debe migrar `readiness_daily` al modelo `athlete_memberships`.
- La futura landing/oferta coach solo puede prometer contexto objetivo opcional y consentido; no diagnostico, prevencion de lesiones ni ajuste automatico.

Estado: **diseño y plan alineados; implementacion pendiente**.

### 4. SP1 Coach dos-lados quedo especificado

Spec aprobado conceptualmente:

- `athlete_memberships` reemplaza el modelo `owner_account_id`/`linked_account_id`.
- Invites consentidos: `claim_self` para reclamar gestionados y `grant_coach` para dar acceso a un coach.
- RLS v2 por helper `auth_athlete_ids()` / `auth_coach_athlete_ids()`.
- `coachMemory` sale de `athlete_profiles` a `athlete_coach_notes`.
- Self solo completa campos permitidos de sesiones coach-authored via RPC acotada.
- Whoop queda fuera de SP1 como Track B previo, pero SP1 debe migrar su RLS.

Estado: **diseño aprobado** (`2026-07-05-coach-two-sided-foundation-sp1-design.md`). Falta plan de implementacion. Se ejecuta despues de Whoop para no reabrir el contrato de readiness.

### 5. Superficie publica paso a demo multideporte

Cambios recientes:

- `PricingPage`: nueva arquitectura de planes:
  - **Base** gratis: hablar con RallyIQ Coach y registrar entrenamientos.
  - **Coach Semanal**: coach con contexto + entrenamientos semanales + ajustes.
  - **Avanzado**: todo lo anterior + Plan Builder por carrera, torneo o bloque.
- `LandingPage`: copy principal menos squash-only y mas multideporte/objetivo semanal.
- `FeaturesPage`: hero y CTA menos tecnicos, mas humanos y orientados a entrenamiento real.
- `SharedPublicNav` y footers: eliminados residuos visibles de version/localidad y links muertos en superficie publica principal.

Estado: **mejorado para demo acompanada**. Aun falta legal publico real, screenshots/mockups honestos finales y smoke visual de `/`, `/features`, `/pricing`.

## Avances Ya Implementados

### Producto Publico Y Marca

- Marca publica operativa: `RallyIQ`.
- Landing principal reorientada a multideporte, manteniendo squash como caso de uso inicial.
- Pricing reestructurado en 3 niveles comprensibles: Base gratis, Coach Semanal, Avanzado con Plan Builder.
- Email centralizado: `hola@rallyiq.cl`.
- Se elimino prueba social inventada de la landing.

### Legal Y Confianza

- Borradores en `docs/legal/`:
  - `terminos-y-condiciones.md`.
  - `politica-de-privacidad.md`.
  - `descargo-de-salud.md`.
- Alineados a piloto Chile/persona natural y billing diferido.
- Falta publicarlos como rutas reales y registrar consentimiento.

### Plan Builder Y Calidad Deportiva

- Plan Builder async operativo.
- Rate limit local y reservas de uso.
- Mejoras en taper/race week, double sessions, squash priority, match play y reparacion.
- Tests amplios de Plan Builder, repair, rate limits y generacion async.
- Copys internos parcialmente humanizados.
- Sigue pendiente QA deportiva manual con planes arquetipo.

### Athlete Scope Y Sync

- `007_athlete_scope.sql`: tabla `athletes`, backfill, `athlete_id`, FKs `not valid`, RLS transicional.
- Hidratacion de atleta activo y read scope foundation.
- Dexie v14:
  - `dayLogs`: unico compuesto `[athleteId+date]`.
  - `weekSummaries`: unico compuesto `[athleteId+weekStartDate]`.
- Lookups y merges day/week athlete-aware.
- Import/export day/week por clave efectiva.
- `008a` preflight report-only.
- `008b` aplicado en produccion.
- Athlete-Aware Core:
  - legacy/unscoped se adopta solo para el self.
  - sessions/summaries/proposals/chat/contexto IA ya filtran por atleta activo.
  - creacion local de sessions/chat/proposals estampa `athleteId`.
  - chat session storage es athlete-scoped, con limpieza global para import/reset.
  - sync estampa legacy bajo el self aunque un gestionado este activo.

### Verificacion Tecnica Reciente

Cierre tecnico reciente del core athlete-aware / coach F2-lite:

- `npm run lint`: OK.
- `git diff --check`: OK.
- `npm test`: OK, 139 archivos / 990 tests.
- `npm run build`: OK.

## Riesgos Que Siguen Vivos

### 1. WHOOP agrega dato sensible y superficie legal nueva

Whoop es el track de producto con mas retorno inmediato, pero introduce datos biometricos,
OAuth externo, tokens cifrados y borrado completo. No debe salir a usuarios reales sin:

- consentimiento biometrico explicito;
- politica de privacidad/terminos actualizados;
- desconexion + borrado remoto/local;
- RLS server-only en credenciales/raw;
- smoke en staging de OAuth, sync manual, cooldown y borrado.

### 2. Superficie publica aun necesita cierre legal/visual

La superficie publica principal ya lee mas humana y multideporte, y Pricing ya explica mejor el camino comercial. Lo que falta para cobrar con mas confianza no es otro cambio grande de copy, sino rutas legales reales, consentimiento y screenshots/mockups finales verificados.

### 3. Legal existe como docs, no como experiencia

No hay rutas publicas `/terms`, `/privacy`, `/health-disclaimer`. Tampoco hay consentimiento versionado en app.

### 4. SP1 dos-lados requiere migracion de acceso, no solo UI

El coach interno ya opera gestionados. Lo pendiente para atletas con login propio es SP1:

- `athlete_memberships` + invites;
- RLS v2 por membresia;
- extraccion de `coachMemory`;
- RPC acotada para completacion de sesiones coach-authored;
- migrar tambien `readiness_daily` de Whoop al helper `auth_athlete_ids()`.

### 5. Operacion comercial todavia no esta cerrada

Faltan soporte, cancelacion/reembolso, precio fundador, mensaje de invitacion, protocolo de revision semanal y canal claro de feedback.

## Decisiones Abiertas Para Desarrollo

### Opcion A - WHOOP readiness primero

Objetivo: mejorar el uso real del owner y dar una base objetiva a la oferta coach antes de SP1.

Orden:

1. Track 0 Whoop: Developer App, env vars, copy legal biometrico.
2. `011` Supabase + Dexie v15 + tipos.
3. OAuth/status/sync manual + cooldown.
4. ReadinessCard + prefill editable + contexto pasivo del coach.
5. Borrado completo + export/backup + consentimiento.
6. Ajuste de copy publico: "contexto objetivo opcional", sin promesas medicas.

Ventaja: mejora inmediatamente el loop diario/semanal y reduce la dependencia de sensaciones manuales.

Riesgo: datos sensibles y OAuth externo; exige legal/seguridad bien cerrados.

### Opcion B - Piloto manual primero

Objetivo: mostrar y cobrar antes, sin esperar datos biometricos.

Orden:

1. Rutas legales publicas.
2. Consentimiento minimo o aceptacion documentada.
3. QA de 3 planes arquetipo.
4. Oferta piloto cerrada.
5. Primer piloto acompanado.

Ventaja: aprende antes con cliente real.

Riesgo: el coach sigue trabajando con menos contexto objetivo del dia a dia.

### Opcion C - SP1 dos-lados primero

Objetivo: atletas con login propio + coach compartiendo el mismo perfil.

Estado: deliberadamente despues de Whoop. SP1 ya esta especificado para absorber `readiness_daily`
sin migrar datos. Hacerlo antes no mejora el uso personal inmediato y puede abrir rework de RLS.

### Recomendacion

Si la prioridad es **usar mejor la app ya mismo y preparar la oferta coach**, elegir Opcion A.

Si la prioridad es **conseguir senales comerciales ya**, elegir Opcion B.

Mi recomendacion actual: **WHOOP primero**, con legal biometrico y borrado completo incluidos, y SP1 despues. Es la mejor relacion valor/riesgo porque aporta datos reales al owner y queda listo para la futura experiencia coach.

## Checklist Actualizado Para Mostrar Y Monetizar

### A. Gate Inmediato: Athlete-Aware Core

Objetivo: confirmar en produccion que el core athlete-aware no altera la experiencia single-athlete actual.

- [x] Write path remoto natural-key-safe commiteado.
- [x] `008b_athlete_scope_unique.sql` commiteado.
- [x] `008b` aplicado en produccion.
- [x] `008a` post-008b en 0.
- [x] Athlete-Aware Core implementado.
- [x] Confirmar deploy del commit actual.
- [x] Hard refresh / confirmar bundle nuevo en prod.
- [x] Smoke post-deploy:
  - [x] dashboard y semana cargan igual.
  - [x] crear/editar sesion.
  - [x] crear/editar day log.
  - [x] crear/editar week summary o coach note semanal.
  - [x] chat/proposal basico.
  - [x] hard refresh y confirmar persistencia.
  - [x] re-correr `008a` y confirmar duplicados en 0.

Rollback de emergencia:

```sql
drop index if exists public.day_logs_athlete_date_unique;
drop index if exists public.week_summaries_athlete_week_unique;
```

### B. Oferta Y Posicionamiento

Objetivo: que una persona entienda en 10 segundos para quien es y por que pedir acceso.

- [x] Marca publica operativa: `RallyIQ`.
- [x] Posicionamiento actualizado: coach AI multideporte con origen en deporte competitivo.
- [x] Landing principal con foco en objetivo semanal/multideporte, no solo squash.
- [x] Pricing de demo definido en 3 niveles: Base gratis, Coach Semanal, Avanzado + Plan Builder.
- [ ] One-liner final para sitio, WhatsApp y demo.
- [ ] Validar precios de Coach Semanal y Avanzado antes de cobro real.
- [ ] Oferta piloto cerrada: duracion, cupos, precio fundador, soporte incluido.
- [ ] CTA unico final en toda la superficie publica: mantener `Empezar gratis` si Base sera real, o cambiar a `Solicitar demo` si el piloto sera manual.
- [ ] Mensaje corto para invitar a los primeros 3 jugadores.
- [ ] Definir que no incluye el piloto: urgencias medicas, diagnostico, garantia de resultado, supervision presencial.

### C. Superficie Publica

Objetivo: confianza antes que explicacion tecnica.

- [x] Landing reorientada a multideporte/objetivo semanal.
- [x] Pricing reestructurado para demo en 3 planes claros.
- [x] Email y marca centralizados.
- [x] Reescribir hero/KPIs de `FeaturesPage` para que lea como preparacion deportiva, no feature grid tecnico.
- [x] Remover versiones visibles: `v2.4`, `v1.0`.
- [x] Resolver localidad publica visible: quitar `BUENOS AIRES` / `HECHO EN CHILE` de la superficie publica principal.
- [x] Cambiar trial/pro copy viejo por Base gratis + planes pagados.
- [x] Eliminar `href="#"` en landing/features/pricing/nav/footer principales.
- [ ] Conectar footer a rutas legales reales.
- [ ] Agregar seccion corta "Para quien es".
- [ ] Agregar seccion corta "Que no es".
- [ ] Agregar 2-4 screenshots reales o mockups honestos.
- [ ] Smoke DEV de `/`, `/features`, `/pricing` y rutas legales.
- [ ] Smoke PROD/deploy de las mismas rutas.

### D. Legal, Confianza Y Seguridad

Objetivo: poder enviar links y cobrar sin zona gris innecesaria.

- [x] Borrador de terminos.
- [x] Borrador de politica de privacidad.
- [x] Borrador de descargo de salud.
- [ ] Crear ruta publica `/terms`.
- [ ] Crear ruta publica `/privacy`.
- [ ] Crear ruta publica `/health-disclaimer`.
- [ ] Linkear rutas desde landing, pricing, features y signup/login.
- [ ] Agregar consentimiento de terminos/privacidad/descargo/IA en signup u onboarding.
- [ ] Registrar version y fecha de consentimiento.
- [ ] Agregar politica simple de cancelacion/reembolso para piloto manual.
- [ ] Validar textos con abogado antes de pago publico o anuncios masivos.

### E. Plan Builder Y Calidad Deportiva

Objetivo: que el primer plan pagado se pueda mirar a la cara.

- [x] Double sessions validadas por dias configurados.
- [x] Taper/race week protegida de carga accesoria excesiva.
- [x] Match play fuerte empujado a 3-4 dias antes del evento.
- [x] Ultimo dia orientado a activacion/control.
- [x] Rate limit local visible para Plan Builder async.
- [x] Tests de Plan Builder, repairs y generacion async.
- [x] Copys de sesiones del coach parcialmente humanizados.
- [ ] Generar y revisar 3 planes arquetipo.
- [ ] Guardar backup/export de cada plan arquetipo.
- [ ] Crear checklist manual de revision de entrenador.
- [ ] Revisar warnings de variedad de drills en build/peak.
- [ ] Confirmar que fuerza no repita plantillas clonadas semana a semana.
- [ ] Confirmar que 1RM se usa cuando existe.
- [ ] Confirmar que running/ciclismo aparecen solo si aportan al objetivo.

Arquetipos recomendados:

- [ ] Torneo en 4 semanas.
- [ ] Jugador con 3 dias disponibles.
- [ ] Jugador con 5-6 dias y doble sesion ocasional.
- [ ] Retorno con molestia de rodilla/tobillo/hombro.
- [ ] Semana con poco sueno y match cercano.

### F. Coach UI F2-lite

Objetivo: operar varios atletas gestionados desde tu cuenta sin contaminar datos.

Estado: **desplegada en produccion (2026-07-05).** Parte 1 (`Athlete-Aware Core`) + Parte 2b (switcher/roster/onboarding) live y smokeadas.

Gates:

- [x] `008b` aplicado.
- [x] Auditoria/scoping de lecturas core.
- [x] Seleccion activa selection-aware.
- [x] Chat session athlete-scoped.
- [x] Escrituras locales estampan atleta activo.
- [x] Deploy + smoke de Athlete-Aware Core.
- [x] Plan de implementacion Parte 2b: `docs/superpowers/plans/2026-07-04-coach-f2-part2b-ui.md`.
- [x] Perfiles por atleta + push/merge por grupo implementados localmente.
- [x] API local de atletas gestionados implementada.
- [x] Backup/import preserva roster `athletes` y eventos enriquecidos.
- [x] `009` expand/contract listo; `009c` endurece `athlete_id not null`.
- [x] `switchEpoch` + `resetForAthleteSwitch` + `switchActiveAthlete` (sin contaminacion por promesas tardias; guards de plan builder poller/accept).
- [x] Allowlist `coachAccess` gated por `VITE_COACH_ACCOUNTS` + `CoachScopeGuard` global (defensa de rollback, cubre `/onboarding`).
- [x] Migracion `010a/b/c` (day/week full unique compuesto) aplicada; migrate `onConflict` por atleta.
- [x] Switcher (`CoachContextBar`) y roster `/coach` (`CoachRosterPage`).
- [x] Smoke con self + 1 gestionado (check-in misma fecha sin `23505`).

No entra todavia:

- `coach_athlete_links`.
- `account_type`.
- atletas con login propio visibles para coach.
- RLS v2 por membresia.
- coach inbox y metricas de adherencia.

### G. UI De Atleta

Objetivo: que el atleta no sienta que usa una consola de QA.

- [x] Debug de quality gated en prod por test (`planBuilderDetech.test.tsx`).
- [x] Revisar labels visibles de Plan Builder V2.
- [x] `Plan Builder` -> `Crear plan` o `Plan competitivo` en UI cliente.
- [x] `Quality review` -> interno/admin; cliente ve `Revision del plan`.
- [x] `needs_review` -> `Requiere revision del coach`.
- [x] `Regenerar semana` -> `Mejorar semana` o `Ajustar semana`.
- [x] Ocultar controles debug para usuario normal.
- [x] Mejorar empty states y errores con lenguaje humano.
- [x] Revisar onboarding para datos deportivos reales: torneo, disponibilidad, molestias, historial, fuerza/1RM, acceso a cancha y partner.

### H. Operacion De Piloto Premium

Objetivo: aprender con pocos clientes sin romper confianza.

- [ ] Elegir 1 primer cliente acompanado.
- [ ] Onboarding 1:1 de 20-30 min.
- [ ] Generar primer plan y revisarlo manualmente antes de entregarlo.
- [ ] Definir canal de soporte: WhatsApp/email.
- [ ] Definir precio fundador o si el primer caso sera gratis a cambio de feedback.
- [ ] Pedir check-in diario durante 7 dias.
- [ ] Hacer review semanal breve.
- [ ] Registrar feedback por categoria:
  - plan deportivo.
  - claridad UI.
  - confianza.
  - fallos tecnicos.
  - sync/datos.
  - pricing/oferta.

Metricas de exito:

- [ ] El cliente entiende su semana sin explicacion extra.
- [ ] Registra al menos 4 dias de 7.
- [ ] 0 perdida de datos.
- [ ] 0 planes con issues criticos.
- [ ] Menos de 2 momentos de confusion fuerte por semana.
- [ ] Feedback cualitativo: "esto me ordena" o "esto me ayuda a llegar mejor".

### I. WHOOP Readiness

Objetivo: traer recovery, sueno y strain reales al loop diario/semanal sin crear deuda para SP1.

Estado: **implementado y revisado (6 rondas de code review); pendiente aplicar `011` + smoke en prod y linkear gate legal**.

- [x] API oficial WHOOP v2 revisada en el plan (`Api Whoop`): endpoints/scopes base documentados.
- [x] Reservas cerradas: Supabase `011`, Dexie v15, SP1 `012+`/v16+.
- [x] Modelo `athlete_id` first definido para `readiness_daily` y `biometric_readings`.
- [x] Contrato SP1 definido: migrar RLS a `athlete_memberships` sin mover datos.
- [x] Contrato landing/coach definido: contexto objetivo opcional y consentido, sin diagnostico ni ajuste automatico.
- [x] Crear Whoop Developer App y configurar redirect dev/prod. **(Task 0 — owner)**
- [x] Configurar env vars server-side (`WHOOP_*`, token key) sin `VITE_*`. **(Task 0 — owner)**
- [x] Crear `docs/legal/descargo-whoop.md` y actualizar privacidad (redactado; falta linkear como ruta).
- [x] Escribir `supabase/011_whoop_integration.sql` (4 tablas + RLS server-only + `readiness_daily` client-read).
- [x] Implementar OAuth start/callback/status + token AES-256-GCM (`state` single-use, `offline` scope, refresh server-side).
- [x] Implementar sync manual con cooldown + cron dedicado UTC (`whoop-cron` scheduled, no publico).
- [x] Implementar Dexie v15 `readinessDaily`, pull cliente, `ReadinessCard`.
- [x] Implementar prefill editable de check-in con procedencia `desde Whoop` (gateado hoy+self+atleta).
- [x] Inyectar readiness como contexto pasivo del coach (sin doble conteo objetivo/declarado) + alerta suave en recovery rojo.
- [x] Implementar desconexion/borrado completo service-role + export/backup + wipe local (tolera 404/tabla ausente).
- [x] Normalizacion v2 endurecida: anclaje por `cycle_id`, `timezone_offset`, filtro de siestas, sueño por etapas, tri-estado `score_state` (SCORED/PENDING/UNSCORABLE).
- [ ] Aplicar `011` en prod y smoke end-to-end (conectar → sync → ReadinessCard → prefill → desconectar/borrar). *(El owner probara directo en prod, no staging.)*
- [ ] Linkear `descargo-whoop.md` + consentimiento biometrico antes de exponer a terceros.
- [ ] Commit/deploy del bundle (hoy uncommitted en working tree).

## Sprint Recomendado - 5 Dias Para WHOOP + Confianza

### Dia 0 - Track 0 WHOOP

- Crear/verificar Whoop Developer App.
- Confirmar redirect URIs dev/prod, scopes y rate limits.
- Configurar env vars server-side.
- Redactar copy legal minimo de datos biometricos.

### Dia 1 - Datos Y Seguridad

- `011_whoop_integration.sql` en staging.
- Dexie v15 + tipos `ReadinessDaily`/`prefillSource`.
- `tokenCrypto` + helpers Supabase server-only.

### Dia 2 - OAuth Y Sync Manual

- OAuth start/callback/status.
- Sync manual con cooldown.
- Smoke conectar -> sync -> `readiness_daily` -> cooldown.

### Dia 3 - UI Y Check-in

- ReadinessCard en Dashboard.
- WhoopConnection en Settings.
- Prefill editable en DayDetail con etiqueta "desde Whoop".

### Dia 4 - Coach Pasivo Y Borrado

- Readiness al prompt del coach.
- Alerta suave por recovery rojo.
- Desconexion, borrado completo, wipe local, export/backup.

### Dia 5 - Smoke Y Copy Publico

- Smoke DEV/PROD del flujo completo.
- Ajustar copy landing/pricing a "contexto objetivo opcional".
- Confirmar que no hay promesas medicas ni ajuste automatico.

## Camino A Monetizacion

### Nivel 1 - Demo Acompanada

Estado: casi listo.

Pendiente minimo:

- Smoke visual de superficie publica basica ya actualizada.
- Agregar rutas legales.
- Smoke deploy.
- Pitch de 2 frases.

### Nivel 2 - Piloto Manual Pagado

Estado: viable despues del sprint de 5 dias si el smoke no muestra problemas.

Pendiente minimo:

- Precio fundador.
- Terminos/privacidad/descargo linkeados.
- Consentimiento o aceptacion documentada.
- Canal de soporte.
- Revision manual de los primeros planes.
- Proceso simple de pago externo/manual.

### Nivel 3 - Coach Premium Operado Por Rafael

Estado: operable internamente con F2-lite 2b; gana mucho con Whoop.

Pendiente minimo:

- Whoop readiness para el owner/self.
- QA de planes arquetipo como gestionados.
- Protocolo de revision semanal.
- Rutas legales y consentimiento si se entrega a terceros.

### Nivel 4 - Pago Publico Self-Serve

Estado: todavia no.

Pendiente minimo:

- Payment flow.
- Consentimiento in-app versionado.
- E2E auth/pago/onboarding.
- Politica de soporte y reembolso cerrada.
- CI/smoke automatizado.
- Mejor separacion usuario/coach/atleta si se vende a entrenadores.

## Que Hacer Primero

Orden recomendado (Athlete-Aware Core + Coach F2-lite Parte 2b ya en prod; Whoop v1 implementado y revisado, Task 0 hecha):

1. Aplicar `011_whoop_integration.sql` en prod, commit/deploy del bundle Whoop y smoke end-to-end (conectar → sync → ReadinessCard → prefill → desconectar/borrar). El owner probara directo en prod.
2. Linkear `docs/legal/descargo-whoop.md` + consentimiento biometrico antes de exponer Whoop a terceros.
3. Rutas legales publicas `/terms` `/privacy` `/health-disclaimer` + linkear footers + consentimiento versionado.
4. QA deportiva: generar 3 planes arquetipo como atletas gestionados y revisarlos como coach (guardar export/backup).
5. Smoke visual PROD de superficie publica: `/`, `/features`, `/pricing`, legales.
6. Oferta piloto cerrada (precio fundador, cupos, soporte, mensaje de invitacion) + primer piloto acompanado.

## Que No Hacer Ahora

- No abrir beta publica.
- No activar pagos automaticos todavia.
- No construir SP1/two-sided antes de cerrar Whoop si la prioridad sigue siendo uso real del owner.
- No vender Whoop como diagnostico, prevencion de lesiones o ajuste automatico.
- No prometer prevencion de lesiones ni mejoras porcentuales.
- No vender "IA ilimitada" como valor central.
- No invitar 10+ personas antes del primer piloto acompanado.
- No exponer datos biometricos sin consentimiento y borrado completo.

## Veredicto

RallyIQ ya tiene producto suficiente para operar entrenamiento real y varios atletas gestionados desde la cuenta del owner. El siguiente incremento de mayor valor es traer datos fisiologicos objetivos con Whoop, porque mejora la experiencia diaria del usuario principal y prepara una promesa coach mas creible.

Mi recomendacion: implementar Whoop v1 con legal biometrico y borrado completo, mantener SP1 como siguiente capa de acceso dos-lados, y no prometer en landing mas de lo que el contrato soporta: contexto objetivo opcional, consentido y pasivo para el coach.

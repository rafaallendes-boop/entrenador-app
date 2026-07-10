# RallyIQ - Project Review and Roadmap

Actualizado: 2026-07-10

Base de contraste:

- `main` hasta `167ef6e Plan whoop y entrenador`.
- `007` aplicado y F2 data prereqs en `6e33926`.
- `008a` ya fue corrido en produccion con 0 nulls / 0 duplicados reportados.
- `008b` fue aplicado en produccion despues del deploy del write path; `008a` volvio a reportar 0 duplicados/null debt operativo.
- Athlete-Aware Core desplegado y smokeado en produccion: single-athlete no cambio.
- **Coach UI F2-lite Parte 2b desplegada en produccion (2026-07-05):** switcher + roster `/coach` + onboarding athlete-aware, gated por `VITE_COACH_ACCOUNTS`. Migracion `010a/b/c` (day/week full unique expand->contract) aplicada; `008a`/`010a` post-deploy en 0. Smoke self + gestionado OK.
- Superficie publica actualizada para demo multideporte: Landing/Features/Pricing limpian residuos visibles de version/localidad, reducen sesgo squash-only y Pricing queda en 3 planes: Base gratis, Coach Semanal y Avanzado con Plan Builder.
- **Polish de uso real implementado (2026-07-06):** la nota/lectura semanal del coach queda disponible solo desde viernes-domingo y completar todos los ejercicios de una sesion marca automaticamente la sesion como realizada.
- **WHOOP v1 implementado y commiteado (2026-07-08/10):** integracion end-to-end en `main` (`c8aa5f8`, `14b7056`, `5293e6c`): `011_whoop_integration.sql`, Dexie v15 `readinessDaily`, OAuth start/callback/status con state single-use, tokens AES-256-GCM, sync manual/on-demand con cooldown, cron dedicado, `ReadinessCard`, `WhoopConnection`, prefill de check-in gateado (hoy+self+atleta), contexto pasivo del coach, borrado completo service-role, export/backup y wipe local. Cierre de review previo: lint + 1160 tests + build + typecheck. Pendiente operacional: aplicar `011`, confirmar deploy y smoke directo en prod + gate legal antes de terceros.
- **WHOOP Esfuerzo (2026-07-08) implementado:** `dayLog.rpeActual` se mantiene como storage pero la UI/copy lo relabela a "Esfuerzo"; Whoop strain lo prellena con `clamp(round(strain / 2.1), 1, 10)`, editable, y no se usa para sembrar `Session.actualRpe` ni inflar ACWR/carga.
- **Resumen semanal/coach note corregido (2026-07-10):** snapshot de nota semanal, freshness check y tests evitan reusar notas obsoletas cuando cambia el resumen.
- **SP1a dos-lados planificado (2026-07-09/10):** spec endurecido con D1-D6 y plan de implementacion creado (`docs/superpowers/plans/2026-07-09-sp1a-two-sided-foundation.md`), pero aun sin codigo/migraciones aplicadas.
- **Whoop Workout Auto-Complete implementado (2026-07-10):** `012_whoop_workouts.sql`, Dexie v16, scope `read:workout`, reconciliacion autoritativa server/client, matcher self-only serializado con idempotencia durable, badge y lifecycle completo. SP1a queda reservado para `013+`/Dexie v17+. Pendiente operacional: aplicar `012`, deploy, reconectar Whoop y smoke.

## Resumen Ejecutivo

RallyIQ esta en una etapa donde el core ya no es el cuello de botella principal. El motor de planificacion, Plan Builder async, calidad deportiva base, athlete scope foundation, claves naturales locales por atleta, write path remoto seguro para day/week, Athlete-Aware Core, Coach F2-lite Parte 2b y Whoop v1 ya estan construidos.

Lo que queda antes de mostrar/cobrar con confianza se divide en cinco carriles:

1. **Whoop readiness operativo:** codigo en `main`; resta aplicar `011`, confirmar deploy/smoke prod y linkear consentimiento biometrico antes de terceros.
2. **Cierre comercial/legal:** rutas legales publicas, consentimiento general + biometrico, soporte y oferta piloto.
3. **QA deportiva:** planes arquetipo ahora operables como atletas gestionados.
4. **Whoop workout auto-complete:** codigo implementado; pendiente aplicar `012`, deploy, reconectar para `read:workout` y smoke con workout real.
5. **SP1 dos-lados:** membresias/RLS v2 ya planificadas para `013+`/Dexie v17+, pero sigue siendo una migracion de acceso relevante.

Mi lectura como lider tecnico: ya se puede preparar demo y piloto acompanado. No esta listo para self-serve publico. El cuello actual no es falta de features, sino cerrar gates operacionales, legales y de QA manual con datos reales.

## Estado Actual En Una Frase

RallyIQ ya opera multi-atleta en produccion y Whoop readiness esta codeado/commiteado; el siguiente paso real es aplicar `011`, confirmar deploy y smokear conectar -> sync -> ReadinessCard -> prefill -> desconectar/borrar en prod, con gate legal antes de terceros.

## Porcentaje De Avance

Estimacion actual:

- Demo acompanada: **94% listo / 6% pendiente**.
- Piloto manual pagado 1-3 clientes: **85% listo / 15% pendiente**.
- Coach UI F2-lite MVP interno: **72% listo / 28% pendiente**.
- Coach dos-lados/SP1: **25% listo / 75% pendiente**.
- Monetizacion publica self-serve: **59% listo / 41% pendiente**.

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

### 3. WHOOP v1 paso de plan a codigo en `main`

Decision de producto del 2026-07-06, ejecutada entre 2026-07-08 y 2026-07-10:

- Whoop se implemento antes que SP1/two-sided porque el owner usa la app al 100% y necesita recovery/sueno/strain reales.
- `011_whoop_integration.sql` define credenciales/raw server-only y `readiness_daily` client-readable por atleta.
- OAuth, refresh, sync manual/on-demand, cron, readiness local, tarjeta de dashboard, settings, prefill y borrado completo ya estan implementados.
- `rpeActual` se mantiene como storage pero el producto lo relabela a **Esfuerzo**; Whoop strain lo prellena como esfuerzo diario editable, sin contaminar `Session.actualRpe`.
- La futura landing/oferta coach solo puede prometer contexto objetivo opcional y consentido; no diagnostico, prevencion de lesiones ni ajuste automatico.

Estado: **codigo committed; pendiente aplicar `011`, confirmar deploy y smoke prod + legal biometrico linkeado**.

### 4. SP1 Coach dos-lados quedo especificado y planificado como SP1a/SP1b

Spec aprobado y endurecido:

- `athlete_memberships` reemplaza el modelo `owner_account_id`/`linked_account_id`.
- Invites consentidos: `claim_self` para reclamar gestionados y `grant_coach` para dar acceso a un coach.
- RLS v2 por helper `auth_athlete_ids()` / `auth_coach_athlete_ids()`.
- `coachMemory` sale de `athlete_profiles` a `athlete_coach_notes`.
- Self solo completa campos permitidos de sesiones coach-authored via RPC acotada.
- Enmienda D1-D6 cierra autoría de sesiones, cola offline para completacion, PK de notes, lifecycle reset/export/borrado, lista explicita de RLS y claim-before-bootstrap.
- Plan SP1a existe: `docs/superpowers/plans/2026-07-09-sp1a-two-sided-foundation.md`.

Estado: **diseño + plan listos; implementacion no iniciada**. Numeracion resuelta: Whoop Workout Auto-Complete usa `012` + Dexie v16; SP1a se mueve a `013a/b/c` + Dexie v17.

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

### 6. Whoop Workout Auto-Complete queda como proximo incremento posible

Nuevo spec aprobado el 2026-07-10:

- Lee workouts Whoop via scope `read:workout`.
- Persiste `whoop_workouts` en Supabase y Dexie, `athlete_id` first y server-only para escrituras.
- Auto-completa solo sesiones `planned` del atleta self si hay una unica sesion del mismo deporte/dia.
- No crea sesiones nuevas, no toca atletas gestionados y no ajusta planes automaticamente.
- No escribe `Session.actualRpe`; solo `actualDurationMin`, `completionNotes` generado si no existia, y `autoCompletion` idempotente por `workoutId`.
- Requiere reconectar Whoop para otorgar `read:workout`.

Estado: **implementado en codigo y tests**. Pendiente aplicar `012`, deploy, reconectar Whoop para otorgar `read:workout` y ejecutar el smoke operativo despues de cerrar `011`.

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
  - `descargo-whoop.md`.
- Alineados a piloto Chile/persona natural y billing diferido.
- Falta publicarlos como rutas reales y registrar consentimiento general + biometrico.

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

### WHOOP Readiness Y Esfuerzo

- `011_whoop_integration.sql`: `whoop_connections`, `whoop_oauth_states`, `biometric_readings`, `readiness_daily`.
- Credenciales/raw server-only; cliente solo lee `readiness_daily` por acceso al atleta.
- OAuth v2, refresh, scopes base + `offline`, tokens cifrados AES-256-GCM.
- Sync manual/on-demand con cooldown y cron dedicado.
- Dexie v15 `readinessDaily`, pull local, backup/export y wipe local.
- `ReadinessCard` en dashboard y `WhoopConnection` en settings.
- Prefill de check-in: sueno, calidad, energia y **Esfuerzo** desde Whoop, editable y con procedencia `prefillSource`.
- `Session.actualRpe` queda separado: el esfuerzo objetivo de Whoop no alimenta carga/ACWR por sesion.
- Readiness entra al prompt del coach como contexto pasivo y a alerta suave por recovery rojo.
- Desconexion/borrado remoto con service-role y tolerancia a 404/tabla ausente.

### Resumen Semanal Y Coach Note

- Nota semanal del coach visible solo viernes-domingo.
- Completar todos los ejercicios marca automaticamente la sesion como realizada.
- `coachNoteSnapshot` y freshness check evitan reutilizar notas semanales obsoletas cuando cambia el resumen.
- Prompt del coach distingue nota fresca vs solicitud de generacion nueva.

### Verificacion Tecnica Reciente

Cierres tecnicos recientes:

- Core athlete-aware / Coach F2-lite: `npm run lint`, `git diff --check`, `npm test` (139 archivos / 990 tests) y `npm run build` OK.
- Whoop v1 review: lint + 1160 tests + build + typecheck OK.
- Commits posteriores agregaron tests focalizados para Esfuerzo, sync on-demand y weekly coach note.

## Riesgos Que Siguen Vivos

### 1. WHOOP ya agrega dato sensible: falta cerrar operacion y consentimiento

Whoop es el track de producto con mas retorno inmediato, pero introduce datos biometricos,
OAuth externo, tokens cifrados y borrado completo. El codigo ya esta, pero no debe salir a usuarios reales sin:

- consentimiento biometrico explicito;
- politica de privacidad/terminos actualizados;
- rutas o UI que expliquen desconexion + borrado remoto/local;
- `011` aplicado y RLS confirmado en prod;
- smoke de OAuth, sync manual/on-demand, cooldown, ReadinessCard, prefill y borrado.

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
- migrar tambien `readiness_daily` y, si se implementa antes, `whoop_workouts` al helper `auth_athlete_ids()`.

### 5. Operacion comercial todavia no esta cerrada

Faltan soporte, cancelacion/reembolso, precio fundador, mensaje de invitacion, protocolo de revision semanal y canal claro de feedback.

### 6. Numeracion de migraciones resuelta

Whoop Workout Auto-Complete usa `012_whoop_workouts.sql` + Dexie v16. SP1a queda reservado para `013a/b/c` + Dexie v17; los specs y reglas del proyecto reflejan ese orden.

## Decisiones Abiertas Para Desarrollo

### Opcion A - Cierre operativo de WHOOP readiness

Objetivo: pasar de codigo committed a flujo real confiable en produccion.

Orden:

1. Aplicar `011` en prod.
2. Confirmar deploy del bundle Whoop actual.
3. Smoke conectar -> sync -> `readiness_daily` -> ReadinessCard -> prefill -> desconectar/borrar.
4. Linkear descargo/privacidad y registrar consentimiento biometrico antes de terceros.
5. Ajustar copy publico a "contexto objetivo opcional", sin promesas medicas.

Ventaja: convierte el avance tecnico en valor real usable.

Riesgo: si se salta legal/smoke, el riesgo percibido sube justo donde el producto necesita confianza.

### Opcion B - Whoop Workout Auto-Complete

Objetivo: que entrenamientos registrados por Whoop completen sesiones planificadas self-only sin intervencion manual.

Orden:

1. Cerrar `011` + smoke readiness.
2. Aplicar `012_whoop_workouts.sql` despues de cerrar `011`.
3. Desplegar el codigo implementado de `read:workout`, `pullWorkouts()` y matcher.
4. No escribir `Session.actualRpe`; solo duracion, nota de sistema y `autoCompletion`.
5. Aplicar `012`, reconectar Whoop y smoke auto-complete.

Ventaja: mejora mucho el uso real diario y la adherencia sin sumar carga manual.

Riesgo: consume la siguiente migracion/Dexie y desplaza SP1a; debe quedar self-only y sin promesas de ajuste automatico.

### Opcion C - Piloto manual primero

Objetivo: mostrar y cobrar antes, sin esperar mas integraciones.

Orden:

1. Rutas legales publicas.
2. Consentimiento minimo o aceptacion documentada.
3. QA de 3 planes arquetipo.
4. Oferta piloto cerrada.
5. Primer piloto acompanado.

Ventaja: aprende antes con cliente real.

Riesgo: el coach sigue trabajando con menos automatizacion de adherencia y sin experiencia dos-lados.

### Opcion D - SP1a dos-lados primero

Objetivo: atletas con login propio + coach compartiendo el mismo perfil.

Estado: planificado, pero deliberadamente despues de cerrar Whoop operativo si la prioridad sigue siendo uso real del owner. SP1a debe absorber `readiness_daily` y, si existe, `whoop_workouts` sin mover datos.

### Recomendacion

Si la prioridad es **usar mejor la app ya mismo y preparar la oferta coach**, cerrar Opcion A y luego evaluar Opcion B.

Si la prioridad es **conseguir senales comerciales ya**, cerrar Opcion A al minimo y ejecutar Opcion C.

Mi recomendacion actual: **cerrar WHOOP readiness en prod/legal primero**. Despues, si el foco sigue siendo uso real del owner, Whoop Workout Auto-Complete es el siguiente incremento con mejor retorno. SP1a queda preparado, pero no conviene ejecutarlo hasta resolver numeracion y prioridad.

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
- [x] Borrador de descargo Whoop / datos biometricos.
- [ ] Crear ruta publica `/terms`.
- [ ] Crear ruta publica `/privacy`.
- [ ] Crear ruta publica `/health-disclaimer`.
- [ ] Crear o linkear superficie de descargo/consentimiento Whoop.
- [ ] Linkear rutas desde landing, pricing, features y signup/login.
- [ ] Agregar consentimiento de terminos/privacidad/descargo/IA en signup u onboarding.
- [ ] Agregar consentimiento biometrico antes de conectar Whoop para terceros.
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
- [x] Plan de implementacion Parte 2b ejecutado y archivado tras el despliegue.
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

Estado: **implementado, revisado y commiteado; pendiente aplicar `011`, confirmar deploy/smoke en prod y linkear gate legal**.

- [x] API oficial WHOOP v2 revisada en el plan (`Api Whoop`): endpoints/scopes base documentados.
- [x] Reservas cerradas para v1: Supabase `011`, Dexie v15.
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
- [x] Relabel de `rpeActual` a **Esfuerzo** y prefill desde strain (`strain / 2.1`), editable y sin sembrar `Session.actualRpe`.
- [x] Sync on-demand reutilizable (`useWhoopSync`) desde Dashboard/Settings con mensajes de cooldown/error.
- [x] Inyectar readiness como contexto pasivo del coach (sin doble conteo objetivo/declarado) + alerta suave en recovery rojo.
- [x] Implementar desconexion/borrado completo service-role + export/backup + wipe local (tolera 404/tabla ausente).
- [x] Normalizacion v2 endurecida: anclaje por `cycle_id`, `timezone_offset`, filtro de siestas, sueño por etapas, tri-estado `score_state` (SCORED/PENDING/UNSCORABLE).
- [ ] Aplicar `011` en prod y smoke end-to-end (conectar → sync → ReadinessCard → prefill → desconectar/borrar). *(El owner probara directo en prod, no staging.)*
- [ ] Confirmar deploy del bundle Whoop actual en produccion.
- [ ] Linkear `descargo-whoop.md` + consentimiento biometrico antes de exponer a terceros.
- [ ] Re-correr smoke despues del primer refresh real para confirmar refresh token/scopes.

### J. WHOOP Workout Auto-Complete

Objetivo: usar workouts detectados por Whoop para completar sesiones planificadas del atleta self, sin crear sesiones nuevas ni tocar RPE de carga.

Estado: **implementado; pendiente rollout operativo**.

- [x] Decision de producto: self-only, sesiones `planned`, matching por deporte/dia, sin auto-ajuste de plan.
- [x] Decision de datos: `actualDurationMin` si matchea; `Session.actualRpe` queda vacio.
- [x] Decision de UX: badge "Sincronizado desde Whoop" y aviso de reconexion para `read:workout`.
- [x] Decision de seguridad: `whoop_workouts` server-write/client-read, `athlete_id` first, borrado/export/wipe incluidos.
- [x] Reconciliar numeracion: `012`/Dexie v16 para workouts; SP1a en `013+`/v17+.
- [x] Agregar scope `read:workout` sin romper conexiones antiguas.
- [x] Implementar `012_whoop_workouts.sql`, Dexie v16, `pullWorkouts()` y matcher serializado.
- [x] Tests: normalizacion, matcher, idempotencia durable, re-evaluacion `no_session`, lifecycle, UI badge, refresh scopes.
- [ ] Aplicar `012` en prod y reconectar Whoop para otorgar `read:workout`.
- [ ] Smoke: workout Whoop -> session planned unica -> completed + duracion + nota, sin `actualRpe`.

## Sprint Recomendado - 5 Dias Para Cerrar WHOOP + Confianza

### Dia 0 - Deploy Y Migracion

- Confirmar env vars server-side en prod (`WHOOP_*`, `WHOOP_TOKEN_ENC_KEY`, Supabase service-role).
- Confirmar bundle actual desplegado.
- Aplicar `supabase/011_whoop_integration.sql` en prod.
- Verificar RLS: credenciales/raw sin acceso client; `readiness_daily` solo por atleta.

### Dia 1 - Smoke Whoop End-To-End

- Conectar Whoop desde Settings.
- Ejecutar sync manual/on-demand y validar cooldown.
- Confirmar `readiness_daily`, pull local, ReadinessCard y prefill del check-in.
- Confirmar que Esfuerzo viene desde strain y que `Session.actualRpe` no se autosiembra.
- Desconectar y validar borrado remoto/local.

### Dia 2 - Legal Y Consentimiento

- Crear/linkear rutas legales publicas minimas.
- Linkear `descargo-whoop.md` o superficie equivalente.
- Agregar gate de consentimiento biometrico antes de conectar Whoop para terceros.
- Ajustar copy publico: contexto objetivo opcional, consentido y pasivo.

### Dia 3 - Superficie Publica Y QA

- Smoke visual DEV/PROD de `/`, `/features`, `/pricing` y legales.
- Revisar que no haya promesas medicas, prevencion de lesiones ni ajuste automatico.
- Generar al menos 1-2 planes arquetipo como atletas gestionados y revisar salida coach.

### Dia 4 - Decision De Siguiente Track

- Si el foco es uso real: implementar Whoop Workout Auto-Complete.
- Si el foco es senal comercial: oferta piloto + primer cliente acompanado.
- Si el foco es producto coach dos-lados: ejecutar SP1a desde la reserva `013+`/Dexie v17+.

### Dia 5 - Paquete Piloto

- One-liner final para demo/WhatsApp.
- Precio fundador, cupos y soporte.
- Checklist de revision semanal.
- Export/backup del primer plan piloto.

## Camino A Monetizacion

### Nivel 1 - Demo Acompanada

Estado: casi listo.

Pendiente minimo:

- Smoke visual de superficie publica basica ya actualizada.
- Agregar rutas legales.
- Smoke deploy.
- Pitch de 2 frases.

### Nivel 2 - Piloto Manual Pagado

Estado: viable despues de cerrar smoke `011` + legal minimo si el flujo Whoop no muestra problemas.

Pendiente minimo:

- Precio fundador.
- Terminos/privacidad/descargo linkeados.
- Consentimiento o aceptacion documentada.
- Canal de soporte.
- Revision manual de los primeros planes.
- Proceso simple de pago externo/manual.

### Nivel 3 - Coach Premium Operado Por Rafael

Estado: operable internamente con F2-lite 2b; gana mucho con Whoop readiness smokeado y, potencialmente, con Workout Auto-Complete.

Pendiente minimo:

- Whoop readiness para el owner/self aplicado y smokeado en prod.
- Consentimiento biometrico y privacidad linkeados si se entrega a terceros.
- Decidir si Workout Auto-Complete entra antes del piloto o queda como mejora de uso personal.
- QA de planes arquetipo como gestionados.
- Protocolo de revision semanal.
- Rutas legales y consentimiento general si se entrega a terceros.

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

Orden recomendado (Athlete-Aware Core + Coach F2-lite Parte 2b ya en prod; Whoop v1 codeado y commiteado):

1. Aplicar `011_whoop_integration.sql` en prod, confirmar deploy del bundle actual y smoke end-to-end (conectar -> sync -> ReadinessCard -> prefill -> desconectar/borrar).
2. Linkear `docs/legal/descargo-whoop.md` o superficie equivalente + consentimiento biometrico antes de exponer Whoop a terceros.
3. Aplicar `012_whoop_workouts.sql`, desplegar y reconectar Whoop para otorgar `read:workout`.
4. Smokear workout Whoop -> sesion planned unica -> completed + duracion + nota, sin `actualRpe`.
5. Si el foco es venta acompanada: rutas legales publicas `/terms` `/privacy` `/health-disclaimer`, smoke visual PROD y oferta piloto.
6. QA deportiva: generar 3 planes arquetipo como atletas gestionados, revisarlos como coach y guardar export/backup.

## Que No Hacer Ahora

- No abrir beta publica.
- No activar pagos automaticos todavia.
- No construir SP1/two-sided antes de cerrar Whoop readiness en prod/legal si la prioridad sigue siendo uso real del owner.
- No aplicar `012` antes de cerrar la aplicacion/smoke de `011` y confirmar el orden operativo.
- No vender Whoop como diagnostico, prevencion de lesiones o ajuste automatico.
- No usar strain/workout de Whoop para autollenar `Session.actualRpe`.
- No auto-completar sesiones de atletas gestionados desde Whoop v1.
- No prometer prevencion de lesiones ni mejoras porcentuales.
- No vender "IA ilimitada" como valor central.
- No invitar 10+ personas antes del primer piloto acompanado.
- No exponer datos biometricos sin consentimiento y borrado completo.

## Veredicto

RallyIQ ya tiene producto suficiente para operar entrenamiento real y varios atletas gestionados desde la cuenta del owner. Whoop v1 ya no es una idea pendiente: esta en codigo y necesita cierre operacional/legal para transformarse en confianza de producto.

Mi recomendacion: cerrar `011` + smoke prod + consentimiento biometrico, y recien despues decidir entre dos caminos cortos: Workout Auto-Complete si la prioridad es uso real/adherencia, o piloto manual si la prioridad es senal comercial. SP1a esta bien planificado, pero debe esperar a que la numeracion y la prioridad de producto queden limpias.

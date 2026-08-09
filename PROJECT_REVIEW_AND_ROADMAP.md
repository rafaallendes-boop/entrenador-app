# RallyIQ - Project Review and Roadmap

Actualizado: 2026-08-08

Base de contraste:

- **Whoop — zonas de frecuencia cardíaca por entrenamiento implementadas (2026-08-08):** ver §25. Seis duraciones de zona y cobertura de medición por workout, con normalizador compartido como única autoridad de forma, migración `019` de aplicación manual, flag de ingestión `WHOOP_ZONES_ENABLED` que omite claves en vez de escribir null, guard de drift de columnas en tres ejes, rampa secuencial de un solo tono y dos publicaciones legales registradas y no vigentes. **Sin Dexie v20.** Suite: 385 archivos / 3087 tests. Pendiente todo el rollout, empezando por aplicar `019` antes del primer deploy.
- **Whoop — detalle de entrenamientos y contexto del coach commiteados y pusheados (2026-08-07, `d91e21e`):** cada sesión auto-completada puede mostrar duración, strain, FC, distancia y ritmo elegible; `DayDetail` lista workouts no asociados; y el chat recibe hasta ocho entrenamientos `SCORED` de los últimos siete días, con asociación al plan y guardia explícita strain 0–21 vs esfuerzo 1–10. Sin migraciones: reutiliza `012` y Dexie v19. Code review cerrado con cinco hallazgos corregidos —uno de ellos, el envío de chat abortado, era una pérdida de mensaje real— y la suite quedó en 379 archivos / 3000 tests, typecheck, lint, build y `git diff --check` verdes. Pendientes operativos: deploy y smoke autenticado (`docs/superpowers/smokes/2026-08-07-whoop-workout-detail-smoke.md`).
- **Whoop — auto-sync de datos stale commiteado (2026-08-05, `c267a1f`):** al entrar al Dashboard como self consulta estado y sincroniza en silencio solo si no hay sync previo, pasaron 30 minutos o el último estado fue error. Mantiene cooldown manual y no corre para gestionados. Suite de cierre: 373 archivos / 2938 tests; queda incluido en el mismo smoke autenticado del detalle para evitar dos sesiones de QA con idéntico setup.
- **Superseries de fuerza implementadas y desplegadas (2026-08-05, `49ab6a8`…`faf70f4`):** ver §23. Estructura real y editable en vez de prefijos `A1/A2` en `notes`, con normalizador aislado, sort por unidades, roles group-aware y política determinista cableada en chat y Plan Builder. Sin migraciones. Pendiente solo la verificación manual post-deploy, que no cuesta API.
- **Consentimiento in-app versionado activado en producción (2026-08-03, `c451808`…`e59b85f`):** `017_user_consents.sql` aplicada, `VITE_CONSENT_GATE=true` y `CONSENT_GATE_ENABLED=true`. El smoke real confirmó el gate general, la aceptación biométrica separada, cuatro filas append-only con las versiones vigentes y timestamps de servidor, y la hidratación remota desde una ventana incógnita: con Dexie vacío verificó Supabase y abrió la app sin reaceptación en ~0,2 s.
- **Deploy de 2026-08-03 arrastra las cuatro tandas que estaban pendientes:** rotación coordinada del Plan Builder (§16), roles de partido de squash (§17, `9754f78`), identidad `libraryRef`-first de fuerza (§19, `afaac17`) y copy de la librería de fuerza (§20, `33d585f`). Ninguna trae migración. **El smoke del consentimiento quedó cerrado; sigue pendiente registrar la verificación post-deploy de las tandas de motor.**
- **Fuerza — desacople del nombre, Entregas 1–3 (2026-08-01): commiteadas en `3d480b3`.** Ver §18 — los hallazgos del code review quedaron corregidos y el bloque se cerró sin migraciones.
- **Fuerza — identidad estable (`libraryRef`-first): implementada, commiteada y desplegada el 2026-08-03.** Ver §19 — Plan Builder, coach y calidad consumen el `id` del catálogo sin volver a inferir identidad desde el nombre. Sin migraciones; 2613/2613 tests, lint y build verdes.
- **Fuerza — copy de la librería por `id`: implementado, commiteado (`33d585f`) y desplegado el 2026-08-03.** Ver §20 — 12 renombres, 31 descripciones y aliases legacy sin cambios de prescripción; 2666/2666 tests, lint y build verdes.
- `main` con el commit de esta entrega (`feat: complete coach planning library and calendar hardening`).
- **`011_whoop_integration.sql`, `012_whoop_workouts.sql` y `017_user_consents.sql` aplicadas en produccion.** Whoop readiness y Workout Auto-Complete quedan operativos de punta a punta; el consentimiento biométrico ya está activo y persistió la versión `2026-07-07` en el smoke del owner. La revisión jurídica y la política de retención siguen abiertas (ver Riesgo 1).
- **Coach Workspace v0 + ampliacion implementados (2026-07-13 a 2026-07-19):** `/coach` pasa de un roster unico (`CoachRosterPage`) a `CoachWorkspacePage` con Resumen, Alumnos, Planificacion y Biblioteca operativas; Asistente IA conserva el placeholder. Incluye endurecimiento de `switchActiveAthlete`, edicion multi-atleta, alta/aplicacion de plantillas y lock de concurrencia a nivel de modulo. `015` y el bundle de Biblioteca/Planificacion ya fueron aplicados en produccion; queda el smoke autenticado.
- **Gestion de roster + Planificacion read-only implementadas (2026-07-14):** Alumnos agrega archivar/restaurar y borrado duro confirmado por nombre. El borrado usa tombstones por intento, barrera y tracking single-tab, delete remoto durable, supresion de cola y purga Dexie transaccional para impedir resurrecciones. Planificacion muestra la semana de cualquier atleta del roster mediante lecturas/hidratacion por `athleteId` explicito, sin cambiar el scope activo. `015` y el deploy de Biblioteca ya estan en produccion; resta el smoke autenticado.
- **Coach Biblioteca + Planificacion completa desplegadas (2026-07-18/19):** edicion de sesiones, Biblioteca de plantillas account-scoped, aplicar/guardar plantillas para cualquier atleta/dia, Dexie v18, backup v4 y sync Supabase por fila con LWW/delete-wins y tombstones versionados. `015_session_templates.sql` fue aplicada y el bundle desplegado; falta el smoke autenticado en produccion.
- **Hardening de fechas y semanas (2026-07-19):** conteos de semanas, ventanas de Plan Builder, insights de fatiga y filtros semanales usan dias calendario en vez de milisegundos para no fallar al cruzar DST. Se agrego serializacion JSON canonica para comparar estructuras sin reescrituras redundantes.
- **Fase 0 de medicion del Plan Builder cerrada, incluidos sus pendientes operativos (2026-07-25/26):** control aceptado y versionado con SHA-256 `6c45885a870cf7e019906a0b4d786e828b2653fe1643f95d436be3aa0ee94d7a`; calibracion congelada, `quality_version = 2` productiva, bundle desplegado y smoke de produccion ejecutado el 2026-07-26 con una corrida real verificada en `plan_generation_jobs`.
- **Rotacion coordinada del Plan Builder, con smoke aceptado (2026-07-30):** identidad de bloque unica, rotacion determinista de fuerza y squash, fail-closed para firmas de squash y telemetria allowlisted. Smoke pagado ejecutado sobre `2ea9b53` y aceptado (US$0,8941, `ELEGIBLE`). **Desplegada en el bundle del 2026-08-03; pendiente verificación post-deploy de la primera corrida real.**
- **Roles de partido de squash (2026-07-30, `9754f78`):** el rol de una sesion de squash se deriva de su contenido (`standalone` / `finisher` / `none`), no de `sessionMode`. Commiteado, pusheado y **desplegado en el bundle del 2026-08-03**, con dos hallazgos de code review corregidos antes del commit (ver §17). **Es posterior al smoke de la rotacion, asi que su efecto no esta medido**; queda cubierto por tests locales y por la verificacion post-deploy pendiente.
- **Fase 0 de coaches landing completada (2026-07-13):** rutas públicas reales (no AuthGate fallbacks), las cuatro páginas legales publicadas como rutas (`/terms`, `/privacy`, `/health-disclaimer`, y disclamer Whoop), landing `/coaches` en modo prelanzamiento con estructura de 3 planes, metadata/OG cards por ruta con prerender para crawlers, deep links nativos para OAuth callback en iOS, y cierre de compartimiento entre rutas públicas. Falta aún revisión jurídica y RUT/domicilio legal antes de cobro o anuncios masivos.
- `main` hasta `167ef6e Plan whoop y entrenador`.
- `007` aplicado y F2 data prereqs en `6e33926`.
- `008a` ya fue corrido en produccion con 0 nulls / 0 duplicados reportados.
- `008b` fue aplicado en produccion despues del deploy del write path; `008a` volvio a reportar 0 duplicados/null debt operativo.
- Athlete-Aware Core desplegado y smokeado en produccion: single-athlete no cambio.
- **Coach UI F2-lite Parte 2b desplegada en produccion (2026-07-05):** switcher + roster `/coach` + onboarding athlete-aware, gated por `VITE_COACH_ACCOUNTS`. Migracion `010a/b/c` (day/week full unique expand->contract) aplicada; `008a`/`010a` post-deploy en 0. Smoke self + gestionado OK.
- Superficie publica actualizada para demo multideporte: Landing/Features/Pricing limpian residuos visibles de version/localidad, reducen sesgo squash-only y Pricing queda en 3 planes: Base gratis, Coach Semanal y Avanzado con Plan Builder.
- **Polish de uso real implementado (2026-07-06):** la nota/lectura semanal del coach queda disponible solo desde viernes-domingo y completar todos los ejercicios de una sesion marca automaticamente la sesion como realizada.
- **WHOOP v1 implementado, commiteado y aplicado en produccion (2026-07-08/10, `011` cerrado 2026-07-13):** integracion end-to-end en `main` (`c8aa5f8`, `14b7056`, `5293e6c`): `011_whoop_integration.sql`, Dexie v15 `readinessDaily`, OAuth start/callback/status con state single-use, tokens AES-256-GCM, sync manual/on-demand con cooldown, cron dedicado, `ReadinessCard`, `WhoopConnection`, prefill de check-in gateado (hoy+self+atleta), contexto pasivo del coach, borrado completo service-role, export/backup y wipe local. Cierre de review previo: lint + 1160 tests + build + typecheck. El gate biométrico versionado está activo en producción; falta la revisión jurídica formal.
- **WHOOP Esfuerzo (2026-07-08) implementado:** `dayLog.rpeActual` se mantiene como storage pero la UI/copy lo relabela a "Esfuerzo"; Whoop strain lo prellena con `clamp(round(strain / 2.1), 1, 10)`, editable, y no se usa para sembrar `Session.actualRpe` ni inflar ACWR/carga.
- **Resumen semanal/coach note corregido (2026-07-10):** snapshot de nota semanal, freshness check y tests evitan reusar notas obsoletas cuando cambia el resumen.
- **SP1a dos-lados implementado en codigo (2026-07-09/10):** spec endurecido con D1-D6 y plan `docs/superpowers/plans/2026-07-09-sp1a-two-sided-foundation.md` ejecutado en el cliente (Dexie v17 con `athleteMemberships`/`athleteCoachNotes`, `membershipCache`, `claimGate`, ruteo `session_completion` via RPC `mark_session_done`) y `013a/b/c` escritas en `supabase/`. **Rollout remoto de `013a/b/c` sin confirmar** — el plan se conserva por su guia de aplicacion. SP1b (invites + UI) sigue sin implementar.
- **Whoop Workout Auto-Complete implementado (2026-07-10):** `012_whoop_workouts.sql`, Dexie v16, scope `read:workout`, reconciliacion autoritativa server/client, matcher self-only serializado con idempotencia durable, badge y lifecycle completo. SP1a queda reservado para `013+`/Dexie v17+. `012`, deploy, reconexión y smoke operativo ya están cerrados.

## Resumen Ejecutivo

RallyIQ esta en una etapa donde el core ya no es el cuello de botella principal. El motor de planificacion, Plan Builder async, calidad deportiva base, athlete scope foundation, claves naturales locales por atleta, write path remoto seguro para day/week, Athlete-Aware Core, Coach F2-lite Parte 2b, Whoop v1 + Workout Auto-Complete (ambas migraciones aplicadas), Coach Workspace con roster/Planificacion/Biblioteca, y Fase 0 de coaches landing (rutas legales publicas + landing `/coaches` de prelanzamiento) ya estan construidos. La Fase 0 de medicion del Plan Builder tambien esta cerrada: `quality_version = 2` es productiva, el bundle esta desplegado y una corrida real quedo verificada en `plan_generation_jobs` el 2026-07-26. La rotacion coordinada de fuerza y squash ya tiene su smoke `high` pagado y aceptado, y encima de ella viajan los roles de partido de squash; ambas tandas quedaron desplegadas el 2026-08-03 y resta su verificación post-deploy. Biblioteca y Planificacion tienen `015` y deploy aplicados; queda cerrar el smoke autenticado. El 2026-08-05 se sumaron las superseries de fuerza (§23), y el 2026-08-07 el dato de workouts Whoop dejó de servir solo para auto-completar: ya tiene detalle visible por sesión, residual por día y contexto objetivo de siete días para el coach (§24). Ambas entregas quedan a la espera de su verificación manual.

Lo que queda antes de mostrar/cobrar con confianza se concentra en dos carriles:

1. **Cierre legal:** el consentimiento general y biométrico ya está activo, persistido y smokeado; faltan revisión jurídica formal, decisión de retención al borrar cuenta y RUT/domicilio legal antes de cobro/anuncios masivos.
2. **QA deportiva y operacional:** planes arquetipo como atletas gestionados, protocolo de revision semanal, canales de soporte, y primer piloto acompanado (1-3 clientes).

Carriles de producto que siguen abiertos pero ya no bloquean la oferta comercial:

3. **Coach Workspace ampliado:** gestion de roster, edicion de Planificacion y Biblioteca de plantillas estan desplegadas con `015`; falta smokearlas de punta a punta. Asistente IA sigue como "proximamente".
4. **SP1 dos-lados:** membresias/RLS v2 ya planificadas para `013+`/Dexie v17+, pero es un incremento futuro de acceso, no bloqueante para la oferta coach de una sola cuenta.

Mi lectura como lider tecnico: el cambio principal entre hoy y hace dos dias es que las rutas legales publicas ya existen como rutas reales, no como ideas. Eso permite cobrar sin zona gris innecesaria si se cierra la revision juridica rapido. El cuello actual es revision juridica formal + primer cliente real para validar flujo comercial/operacional.

## Estado Actual En Una Frase

RallyIQ ya opera multi-atleta en produccion, con Whoop readiness y Workout Auto-Complete operativos (`011`/`012` aplicados), Coach Workspace base (`/coach`) y rutas legales publicas + landing `/coaches` en vivo. El consentimiento in-app también está **activo**: `017` aplicada, ambas flags encendidas y smoke de persistencia/hidratación cerrado. `015` y Biblioteca/Planificacion ya estan desplegadas, `quality_version = 2` quedo verificada en `plan_generation_jobs`, la rotacion coordinada del Plan Builder ya paso su control `high` pagado, y las sesiones de fuerza soportan superseries reales de punta a punta. El auto-sync de Whoop, el detalle del workout y el bloque objetivo para el coach están commiteados en `main`. Falta deploy y smoke combinado antes de describir esta última capa como productiva.

## Porcentaje De Avance

Estimacion actual:

- Demo acompanada: **99% listo / 1% pendiente** (rutas legales publicas ya vivas; pendiente solo revision juridica formal).
- Piloto manual pagado 1-3 clientes: **95% listo / 5% pendiente** (Fase 0 y rollout técnico del consentimiento completos; pendientes cierre jurídico y operaciones piloto).
- Coach UI F2-lite MVP interno: **99% listo / 1% pendiente** (roster, edicion de Planificacion y Biblioteca desplegados con `015`; pendiente smoke autenticado y Asistente IA futura).
- Coach dos-lados/SP1: **25% listo / 75% pendiente** (especificado y planificado, pero no urgente frente al piloto de una sola cuenta).
- Monetizacion publica self-serve: **65% listo / 35% pendiente** (rutas legales + landing coach vivas y consentimiento activo; faltan pagos automáticos, cierre jurídico y e2e auth).

Traduccion practica: el producto ya tiene sustancia y superficie legal/comercial minima. Lo pendiente es reducir riesgo juridico formal (revision de abogado) y riesgo operacional (primer cliente real).

## Lo Nuevo Desde El Roadmap Anterior

### Consentimiento in-app versionado quedó activado y smokeado en producción

- Los textos legales pasan a publicaciones de datos inmutables; el ledger congela `documento@versión#sha256`, incluyendo estructura, énfasis y destinos de enlace.
- `017_user_consents.sql` crea un log append-only por cuenta, fuerza `accepted_at` en servidor y solo expone `select`/`insert` propios por RLS. No lleva FK a `auth.users`: mientras el abogado no decida, el default es conservar la evidencia.
- Dexie v19 espeja únicamente filas devueltas por Supabase y siempre filtra por `userId`; el espejo queda fuera de export/import y se limpia con el reset local completo.
- El gate general exige términos, privacidad y salud. Hidrata remoto antes de pedir una aceptación desconocida y funciona sin red en sesiones posteriores gracias al espejo confirmado.
- Aunque el gate esté cerrado, mantiene una superficie restringida para cerrar sesión, exportar y borrar datos; Settings y el resto del producto siguen bloqueados.
- Whoop exige la versión biométrica vigente antes de iniciar OAuth, completar el callback, sincronizar manualmente o procesar la cuenta en cron. La desconexión `DELETE` queda siempre disponible.
- Un `403 consent_required` al iniciar OAuth conserva su código y dispara una verificación remota: solo una ausencia confirmada muestra re-aceptación; una falla o discrepancia muestra indisponibilidad.
- Rollout ejecutado: `017` aplicada y `VITE_CONSENT_GATE` / `CONSENT_GATE_ENABLED` encendidas juntas. Encender solo una sigue siendo un estado inválido para futuros cambios o rollback.

Estado: **mergeado a `main` en cuatro commits (`c451808` publicaciones+persistencia, `084b41a` gate, `5dac6e4` enforcement Whoop, `e59b85f` documentación), desplegado y habilitado el 2026-08-03.** Suite completa: 354 archivos / 2740 tests, typecheck, lint, build y `git diff --check` verdes.

Smoke de activación del 2026-08-03: la cuenta principal aceptó `terms@2026-07-13`, `privacy@2026-07-13`, `health@2026-06-20` y `whoop_biometric@2026-07-07`. Supabase mostró cuatro ids independientes y `accepted_at` generado por servidor. En una ventana incógnita, sin espejo Dexie previo, el gate hidrató esas filas desde Supabase y abrió la app sin pedir una segunda decisión en ~0,2 s. Esto valida el camino feliz, la persistencia remota y la hidratación multi-dispositivo; los tests automatizados siguen cubriendo fallas parciales, `23505`, offline y enforcement de los cuatro puntos Whoop.

Pendientes posteriores al rollout:

1. Aprobar los textos de las cuatro publicaciones; cualquier cambio de redacción obliga a un id de publicación nuevo y a reaceptación.
2. Resolver la retención al borrar cuenta y alinear el copy de Ajustes con lo que se decida.
3. Completar, cuando se programe el siguiente smoke de Whoop, una comprobación manual directa del `403 consent_required` servidor antes de aceptar; el contrato ya está cubierto por tests, pero esa rama no quedó observada en este smoke de activación.
4. Tratar cualquier mejora visual del gate como iteración posterior basada en uso real; el flash breve de “Verificando tus consentimientos” al hidratar un navegador nuevo es esperado y no justifica añadir latencia artificial.

Decisiones abiertas para abogado, con default actual: (1) conservar evidencia al borrar cuenta; (2) salud se acepta por separado e IA queda cubierta por términos; (3) todo id nuevo de publicación, incluso por redacción menor, exige reaceptación.

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

Estado: **`011` aplicado en produccion, deploy y smoke operativo confirmados por el owner.** El gate legal/biométrico está activo y la aceptación vigente quedó persistida; la revisión jurídica formal continúa pendiente antes de terceros.

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

Estado: **`012` aplicado en produccion, Whoop reconectado con `read:workout` y smoke operativo confirmado por el owner.**

### 7. Coach Workspace v0 implementado y deployado (2026-07-13)

`/coach` pasa de un roster unico (`CoachRosterPage`) a un workspace de 5 areas (`CoachWorkspacePage`):

- **Resumen:** tarjetas de roster (self + gestionados) con CTAs "Ver semana"/"Ver plan", sin señales computadas (eso requeriria una capa de lectura multi-atleta fuera de alcance para v0).
- **Alumnos:** roster completo + alta de atleta (formulario con submit por Enter) + "Entrenar como este atleta".
- **Planificacion:** semana por atleta, edicion de sesiones, aplicar y guardar plantillas.
- **Biblioteca:** plantillas account-scoped con persistencia local, backup y sync remoto; `015` aplicada en produccion.
- **Asistente IA:** placeholder honesto "proximamente", con copy en tuteo.
- Nav responsive: sidebar en desktop, tabs horizontales scrolleables en mobile, con ARIA `tablist`/`tab`/`tabpanel` completo.

Endurecimientos que viajaron con la misma pieza:

- `switchActiveAthlete` corrige un bug real: `loadMemory()` corria post-commit del cambio de scope, y su fallo podia convertir un switch ya aplicado en un `false` falso. Ahora es best-effort tras el commit; el unico reject legitimo es el chequeo pre-commit en Dexie.
- Lock de concurrencia para serializar switch/creacion de atleta (crear tambien activa, por lo que comparte el mismo lock). Encontrado durante QA manual en vivo: el lock original (`useRef` en el componente) no sobrevivia al remount que un switch exitoso dispara via `key={activeAthleteId}` en `AppShell` — se movio a un singleton de modulo que si sobrevive.
- Smoke de Playwright (`scripts/e2e-coach-test.mjs`) extendido con un paso no-destructivo por defecto y uno destructivo detras de `--apply` (crea un atleta real, prueba el switch, restaura el atleta original), con gate `E2E_EXPECT_COACH_WORKSPACE` para que una regresion de renderizado falle en vez de reportarse como "cuenta no allowlisted".

**Limitacion conocida, documentada, no bloqueante:** el lock de concurrencia no comparte estado con `CoachContextBar` (la barra de switch montada globalmente en `AppShell`) — dos superficies de switch podrian, en teoria, correr en paralelo. `switchActiveAthlete` ya es atomico en su bloque de mutacion de scope (sin `await` de por medio) y usa un guard de `switchEpoch`, asi que esto no corrompe datos; es un gap de cobertura de UX, no de integridad. Candidato a un incremento futuro si en la practica llega a importar.

Tambien se detecto y corrigio, como efecto secundario de este trabajo, un gap de configuracion preexistente: ni `vitest` ni `eslint` excluian `.claude/worktrees/` de su glob, lo que duplicaba archivos de test y generaba fallos espurios al correr la suite desde un checkout con un worktree anidado adentro. Arreglado en `vite.config.ts` y `eslint.config.js`.

Estado: **deployado en produccion.** Migracion/schema: ninguna (no toca Supabase ni Dexie). Plan de implementacion retirado tras el despliegue (historial en git).

### 8. Fase 0 de coaches landing completada (2026-07-13 a 2026-07-14)

Arquitectura de rutas públicas y landing `/coaches` de prelanzamiento:

- Rutas públicas reales: `/terms`, `/privacy`, `/health-disclaimer` como componentes React renderizados (no archivos HTML estáticos), con `LegalPageLayout` compartida.
- Descargo Whoop agregado como ruta pública adicional antes de exponer biometricos a terceros.
- `SharedPublicNav` y footer centralizados, con links a todas las rutas legales.
- Landing `/coaches` en modo prelanzamiento: explica la oferta de 3 planes (Base gratis, Coach Semanal, Avanzado + Plan Builder), estructura 3-tab (Para quien / Caracteristicas / CTA), copy en tuteo sin promesas medicas.
- Metadata/OG cards por ruta (title, description, imagen) con `usePageMetadata()` y prerender en build para crawlers (`generate-public-route-html.mjs`).
- Deep links nativos: OAuth callback de Whoop usa `whoop://` en iOS (gestionado en `WhoopConnection`), fallback a web en ausencia de app nativa.
- SEO: cada ruta publica tiene su propio title/description distinto (visible en tabs del navegador y en previews de compartimiento).
- SharedPublicNav fix: dejar de ofrecer OAuth a usuarios ya signed-in (redirige a app si estan logged).
- Netlify config actualizado para servir paginas legales con cache headers y prerender en CI.

Pendiente y no bloqueante:

- Screenshots/mockups reales para `/coaches` (hoy placeholders).
- Revision juridica completa y firma de abogado.
- RUT/domicilio legal de RallyIQ antes de cobro o anuncios masivos.

Estado: **Fase 0 desplegada en produccion.** Plan de implementacion retirado tras el despliegue (historial en git); queda pendiente solo capturar los screenshots reales de `/coaches`. Tests de UI agregados para `LegalPageLayout` y `SharedPublicNav`. No toca Supabase ni Dexie.

### 9. Gestion de roster + Planificacion y Biblioteca implementadas (2026-07-14 a 2026-07-19)

El Coach Workspace incorpora el ciclo de vida seguro de atletas gestionados y una primera superficie real de planificacion multi-atleta:

- **Alumnos:** archivar y restaurar gestionados no reclamados; borrado definitivo solo desde Archivados, con confirmacion escribiendo el nombre. Self, atletas de otro owner y cuentas vinculadas quedan bloqueados en dominio y UI.
- **Borrado sin resurreccion:** tombstone durable por intento, barrera exclusiva y tracking de operaciones en vuelo single-tab, abort acotado del generador, delete remoto inmediato o durablemente encolado, limpieza athlete-scoped de la cola y purga de todas las tablas Dexie en una transaccion.
- **Sync endurecido:** pulls y merges filtran tombstones y adquieren leases antes de escribir; la cobertura incluye perfiles, notas, memberships, planes/semanas, polling de generacion, readiness y workouts. El contrato multi-tab no se amplia en este incremento.
- **Planificacion:** selector de atleta, navegacion semanal, estados loading/error/cache stale y sesiones agrupadas por dia. Incluye edicion segura de sesiones con revalidacion de roster, lease, transaccion y recalcado de summary. `coachScopedReads` valida owner/roster y aplica legacy solo al self; la hidratacion remota por semana no cambia el atleta activo.
- **Biblioteca:** plantillas de sesion account-scoped con nombre independiente, CRUD local, soft-delete por tombstone, payload allowlisted con copia profunda, contenido rico preservado al aplicar y modo forward-compatible para filas incompatibles.
- **Aplicar plantillas:** desde cualquier dia/atleta, con materializacion `planned`, UUIDs nuevos de ejercicios, preservacion de warmup/cooldown/details y core compartido con el alta normal.
- **Persistencia y sync:** Dexie v18, backup v4 con tombstones, Supabase `015_session_templates.sql`, pull por `user_id`, LWW/delete-wins, tombstone versionado y re-push de filas ausentes. Las escrituras iguales convergidas no reescriben IndexedDB.
- **Smoke:** el modo `--apply` identifica al atleta creado por id y prueba archivar/restaurar con recuperacion en `finally`; el borrado duro permanece cubierto solo por tests para no destruir datos reales.

Estado: **desplegado en produccion con `015_session_templates.sql` aplicada.** Falta smoke autenticado; Dexie migra v17 → v18 al abrir la app. Planes/specs de roster, Planificacion y Biblioteca retirados tras el despliegue (historial en git).

### 10. Hardening de calendario y latencia local (2026-07-19)

- Conteos de semanas y ventanas de Plan Builder usan `differenceInCalendarDays` para evitar errores en cambios DST.
- Insights de fatiga y filtros de sesiones semanales usan límites de días calendario, no ventanas fijas de milisegundos.
- Se agrego `canonicalJson` para comparar payloads estructurales de forma estable y reducir escrituras redundantes.
- Se fijaron pruebas con reloj determinista para que la suite no dependa del día en que se ejecuta.

Estado: **implementado y verificado localmente.**

### 11. Estado de rollout de esta entrega

- El commit de Biblioteca/Planificacion, su deploy y la migracion `015` ya estan en produccion.
- Lint, build y pruebas dirigidas de Biblioteca/sync/backup/serializer pasan.
- Smoke local público de arranque pasa sin errores de consola; el smoke autenticado de Coach Workspace y el smoke multi-dispositivo requieren una sesión real.

### 12. Coach exercise catalog picker (2026-07-19)

- Catálogo unificado de drills de squash y ejercicios de fuerza sobre las librerías curadas existentes, con búsqueda normalizada y defaults por tipo.
- `SessionForm` incorpora typeahead y explorador filtrable para Planificación, plantillas y el modal del atleta, manteniendo texto libre y el input plano de movilidad.
- Las sesiones de squash admiten ejercicios editables en `Session.exercises`; el contenido rico de `squashDetails` permanece opaco e intacto.
- `libraryRef` queda como metadata opcional, sanitizada en sesiones, plantillas y backup/import, con invalidación al renombrar y sin resurrección durante merges.
- El editor del coach oculta resultado y games del partido, conserva Rival y no borra resultados existentes solo por ocultar los controles.

Estado: **implementado y verificado localmente, sin migraciones Dexie ni Supabase.** Pendiente commit, deploy y smoke autenticado del flujo completo en Coach Workspace.

### 13. Plan Builder measurement foundation — Plan 2 (`016`, 2026-07-24)

Segundo eslabón de la Fase 0 de medición del Plan Builder (Plan 1 —taxonomía de reparación + quality v2 opt-in— ya estaba en `main`). Agrega la unidad de medición a nivel plan/corrida que faltaba:

- Nueva tabla `plan_generation_jobs` (una fila por corrida, `job_id` único) que agrupa los `plan_generation_attempts` existentes, con timings por corrida (`first_week_ready_ms`, `first_week_ready_e2e_ms`, `plan_complete_ms`, `terminal_ms`), forma de la corrida, descriptor de variante experimental, tokens/costo fechado y outcome.
- `runAsyncPlanGeneration` ensambla y emite la telemetría de job vía `finalizeJob` idempotente en **todo** camino terminal (normal, cancelación, excepción), best-effort.
- Descriptor de variante fiel a la request real vía `resolveEffectivePlanBuilderConfig` (única fuente compartida por caller y telemetría) + `buildVariantId` (hash de todas las dimensiones); `estimated_cost_usd` con tabla de precios fechada (`pricing.ts`) y modelo real por intento; costo `null` si falta usage.
- `plan_generation_attempts` gana columnas de variante + taxonomía de reparación (incl. los 3 contadores de sesiones únicas afectadas de §3.2).
- Guard de drift bidireccional row-mapper ↔ migración; retención extendida a la tabla de jobs.
- Cierre de code review (2026-07-25): `emitUnstartedJobTelemetry` cubre las excepciones del worker **previas** al loop (`getPlan`/`putPlan`/lote inicial de `putWeek`, y el preámbulo síncrono del propio loop), con handoff explícito vía `onJobFinalizerArmed` para que no exista ventana sin emisor; y `runAsyncPlanGeneration` precarga los targets ya terminales para que una corrida mixta (semana lista + semana pendiente) no reporte `plan_complete_ms` null siendo `succeeded`.

Estado: **`016` aplicada en produccion el 2026-07-25; bundle desplegado y corrida real verificada el 2026-07-26.** La telemetria ya tiene su contrato remoto y la Fase 0 de medicion se completo con las Entregas 1 y 2 descritas abajo. El smoke produjo una fila de job agrupable por `job_id` con sus 4 attempts, todos con variante y taxonomia coherentes.

### 14. Plan Builder loadtest — Plan 3 Entrega 1 (2026-07-25)

Tercer eslabon de la Fase 0 de medicion: construyo el control reproducible que alimento la calibracion de quality v2.

- Driver real sobre `runAsyncPlanGeneration`, ejecutado secuencialmente sobre un manifest sintético congelado de 6 escenarios × 2 planes / 42 semanas.
- Writer y polling completamente en memoria, sin Dexie ni Supabase; artefacto allowlisted y autocontenido con procedencia de manifest, git y variante.
- Checkpoints atómicos después de cada caso y al cierre; cambios de SHA/dirty, errores del harness o interrupciones vuelven el control no aceptable.
- Reporte puro con latencias por plan en cohortes all-attempts/complete-plans, latencia semanal secundaria y tres distribuciones de reparación globales y por escenario.
- Doble guard para la corrida pagada (`LOADTEST_PLAN_BUILDER=1` + `CLAUDE_API_KEY`); `--report` no requiere credenciales ni llama al proveedor.

Estado: **cerrado.** El owner ejecuto y acepto el control con 12/12 planes completos y 42/42 semanas puntuables. El artefacto sanitizado se versiono byte a byte en `docs/superpowers/calibrations/plan-builder-v2-control-2026-07-25.json`, SHA-256 `6c45885a870cf7e019906a0b4d786e828b2653fe1643f95d436be3aa0ee94d7a`; el gate posterior exige representacion de los seis escenarios y el reporte incluye el lag pareado de deteccion.

### 15. Plan Builder quality v2 — Plan 3 Entrega 2 (2026-07-25)

Cierra la Fase 0 de medicion y activa el contrato calibrado:

- Penalizacion semanal: divisor `1`, tope `10`; penalizacion de plan: divisor `4`, tope `8`; warning de reparacion alta: `5`.
- La procedencia se ancla al artefacto versionado y a su SHA-256; el fingerprint de request excluye solo `qualityVersion` y conserva el `variant_id` historico del control.
- La version efectiva se resuelve antes de construir el descriptor, de modo que `variant_id`, telemetria y scoring no puedan divergir.
- Cada semana generada se estampa con su version efectiva; attempts, fallback y review final la consumen explicitamente. Una corrida con semanas legacy fuera de targets permanece en v1.

Estado: **cerrado end-to-end. `npm test` verde (298 archivos / 2162 tests), `quality_version = 2` productiva en worker remoto y runner local, bundle desplegado y smoke de produccion ejecutado el 2026-07-26** (`docs/superpowers/smokes/2026-07-25-quality-v2-production-smoke.md`).

Resultado del smoke: un plan nuevo dio `quality_version = 2`, `variant_id s46-q2-00ftsagu`, `outcome succeeded`, 4/4 semanas, `plan_complete_ms` 43 947 y `estimated_cost_usd` 0.115128 (~**$0.029 por semana generada**); sus 4 attempts traen `repair_taxonomy_version = 2` y coinciden en variante y version con el job.

Alcance parcial, deliberado y documentado: las **regeneraciones parciales** (Caso 2, plan legacy que debe bajar a q1; Caso 3, trinquete q2 que no debe degradarse) **no son reproducibles en produccion**, porque el boton de regenerar una semana vive detras de `isDevToolsEnabled()`, que devuelve `false` sin condiciones cuando `import.meta.env.PROD` (`src/services/devTools.ts:6-11`). Quedan cubiertas por `effectiveRunQualityVersion.test.ts` y `generationJobRunnerQualityVersion.test.ts` en los dos escenarios exactos, y vigiladas en produccion por el monitoreo **M4** (proporcion de corridas `q1`, que deberia caer con el tiempo). Reproducirlas requiere `netlify dev` contra la Supabase de produccion; el procedimiento quedo escrito en el smoke.

Deuda menor detectada: `OPTIMIZATION_AND_COSTS.md` proyecta costos de la era Gemini y subestima el costo real del Plan Builder en aproximadamente un orden de magnitud. Corregirlo antes de fijar el precio del piloto.

### 16. Plan Builder — rotacion coordinada de fuerza y squash (2026-07-30)

La correccion de repeticion dejo de depender de que la semana anterior ya este
lista, por lo que conserva el comportamiento bajo concurrencia 3.

- `blockIdentity` unifica el bloque e indice de semana para quality review y
  repair, incluidos planes legacy y rangos fuera de fase.
- Fuerza usa roles explicitos: el main lift queda fuera de alcance; la politica
  y la correccion observada se cuentan por separado y la politica no infla
  `countRepairsV2`.
- Squash rota drills por eje, reconstruye bloques y, si no puede resolver una
  firma duplicada de forma segura, devuelve
  `quality.squash.signature_uniqueness_unresolved`: consume reintentos pero no
  puede degradar silenciosamente al fallback local.
- Las metricas de rotacion, omisiones, solape de fuerza, variedad de squash y
  fallos de firma llegan al artefacto allowlisted y al reporte de loadtest.
- No cambia prompts, concurrencia, Dexie, Supabase ni backup.

**Code review (2026-07-30):** tres hallazgos confirmados y corregidos antes del
smoke. (1) El sort canonico alfabetico de `normalizeStrengthSessions` hacia que
el rol `main_lift` —que es posicional— cayera en el ejercicio alfabeticamente
primero, dejando el lift programado como accesorio rotable; se elimino el sort.
(2) Los dos call sites de Week Creator ignoraban `RepairResult.failure` y
entregaban una semana vacia como reparacion exitosa; ahora propagan el fallo,
reintentan y devuelven una respuesta sin accion ni fallback local. (3) La rama
de pares de `generatePlanWeeks` se saltaba el guard de no-fallback; la politica
quedo centralizada en `fallbackEligibility.ts`. Ademas el rechazo de calidad
dejo de contabilizarse como falla de schema: `quality_rejected` es ahora un
outcome propio en `CoachOutcome`, `AITechnicalResult` y `meta.outcome`, cableado
en Week Creator y en `generateWeek`.

**Smoke ejecutado (Task 12, 2026-07-30):** corrida pagada sobre `2ea9b53`, arbol
limpio, `variant_id s46-q2-00qwoc9q` (identico al control `phase2-C`), 12 planes
/ 42 semanas, `--phase2-check high` **ELEGIBLE**, **US$0,8941**. Artefacto y
veredicto en `docs/superpowers/experiments/plan-builder-rotation/`, SHA-256
`7582401f444d7b89c49c83094265b966eff7c241073d72127e29f868eee2e666`.

Resultado contra `phase2-C` (pre-rotacion, mismo manifest y variante):

| Metrica | C | POST | Lectura |
|---|---|---|---|
| `signature_uniqueness_unresolved` | — | **0** en 42 semanas | La invariante nueva no dispara |
| `low_drill_variety` | 6 planes | **1** | Definicion sin cambios: comparable |
| `repeated_template` | 10 planes | 4 | Definicion cambiada: solo descriptivo |
| `high_repair_count` | 2 planes | 3 | Sin inflacion atribuible a la politica |
| planScore p50 / min | 80 / 65 | 89 / 54 | Mediana sube, cola baja |
| 1a semana / plan completo p50 | 14,5 s / 31,2 s | 15,8 s / 33,2 s | Plano en el ruido de n=12 |
| Costo | US$0,8975 | US$0,8941 | Plano |

Las 4 omisiones de squash son bajas: **no se abre** el follow-up de ampliar
`category` que el plan dejaba condicionado a ese numero.

**Hallazgo del smoke:** `quality.squash.low_drill_depth` paso de 0 a 8 planes.
Reproducido A/B en worktrees (`ac01830` vs `2ea9b53`) con dos sesiones
`practice_match` de 60 min y firma duplicada: el codigo viejo agotaba las
variantes de partido —`COMPETITION_MATCH_VARIANTS` y `PRACTICE_MATCH_VARIANTS`
tienen **una sola** entrada cada uno— y caia a `rebuildSquashDetailsAvoidingDuplicates`,
que regeneraba la sesion como contenido multi-drill no-partido; el nuevo la
diferencia cambiandola por otro drill de partido y deja dos sesiones de 1 drill.
El contenido nuevo es mejor: conserva los dos partidos. El punto ciego es la
regla, porque `buildSquashMatchDrills` devuelve una sola entrada por construccion
y ninguna sesion de partido bien formada puede cumplir el umbral. Corregido en
`qualityReview.ts` eximiendo a las sesiones de partido, con test que fija que una
sesion de drills con un solo drill se sigue penalizando. El artefacto es
**anterior** a ese arreglo. No se pudo verificar que las 8 ocurrencias sean todas
de partido: el artefacto guarda metricas allowlisted, no contenido de sesion.

Estado: **veredicto positivo, commiteado, pusheado (`9754f78`) y desplegado en
el bundle del 2026-08-03.** Suite 320 archivos / 2386 tests, lint y build OK al cierre de esta
pieza. El bloqueo previo en `chatCoachConversations.test.tsx` quedo resuelto. No
se re-mide el arreglo de `low_drill_depth` con el loadtest: seria otra corrida
pagada para confirmar un cambio de regla de scoring.

### 17. Plan Builder — roles de partido de squash (2026-07-30, `9754f78`)

Segunda tanda del mismo dia, encima de la rotacion coordinada. El rol de una
sesion de squash pasa a derivarse de su **contenido**, no de `sessionMode`.

- `squashMatchRole.ts`: `standalone` / `finisher` / `none` por enumeracion de
  IDs competitivos, con invariante duro `drills[] = flatten(blocks)`. Es el
  **unico** predicado de exposicion competitiva del proyecto; `utils/squash.ts`
  y `repairWeek.ts` lo envuelven, no lo reimplementan.
- `repairWeek`: la densificacion y el taper conservan el finisher (en taper se
  retira solo el bloque competitivo final, no la sesion); el standalone queda
  fuera de la unicidad de firmas —dos partidos comparten formato, no una
  prescripcion repetida—; el repair habilita y preserva finishers pero no los
  compone desde un esqueleto incompleto.
- Se elimina `practice_match_short_points_attack` del catalogo y su alias.
- Contadores observacionales de rol (`squashFinisherProposedCount`,
  `...PreservedCount`, `squashStandaloneMatchCount`) propagados hasta el
  artefacto del loadtest. **No entran en `countRepairsV2`.**

**Code review (2026-07-30):** dos hallazgos confirmados con reproduccion contra
`HEAD` y corregidos antes del commit.

1. Un slot sin recambio anulaba el **nivel de relajacion completo** en
   `findUniqueSquashSessionCandidate`. El finisher no tiene par rotable en
   `base` ni en `taper`: los tres drills competitivos declaran
   `phaseAppropriate = ['build','peak','race']`, y `isPhaseAllowed`
   (`drillSelector.ts:118`) es hard constraint previo al eje. Que no haya
   partido en base es **deliberado y esta fijado por test**
   (`drillLibrarySchema.test.ts:24`), no un hueco de contenido. El efecto si era
   un bug: dos finishers con firma duplicada hacian fallar la semana entera con
   `quality.squash.signature_uniqueness_unresolved`, que por politica **no**
   puede degradar al fallback local y quema los reintentos. Listas de candidatos
   observadas: `[10,10,7,0]` / `[26,26,7,0]` / `[17,17,17,0]` / `[36,36,36,0]`.
   Ahora un slot sin recambio conserva su drill original y la firma se
   diferencia con los demas.
2. `sessionMode !== 'drill_session'` tambien capturaba `undefined`. El campo es
   opcional (`src/types/index.ts:281`), asi que toda sesion de drills que el
   modelo devolviera sin el campo reservaba una reparacion `corrective` y un
   warning `squash_mode_aligned` que antes no existian, inflando
   `repairedSessionCount` y `countRepairsV2` —justo la metrica que
   `quality_version = 2` penaliza—. Ahora el default se completa en silencio y
   el warning queda solo para un match-play realmente mal declarado.

**Desfase de medicion, deliberado y documentado:** el smoke pagado de §16 se
corrio sobre `2ea9b53`. Esta tanda es **posterior** y cambia que cuenta como
exposicion competitiva, que sesiones entran a la unicidad de firmas y como se
proyecta el contenido competitivo no canonico. Esta cubierta por tests locales,
**no** por el artefacto. Con ~US$0,60 de saldo no alcanza para re-medir
(~US$0,90 por corrida).

Estado: **commiteado, pusheado y desplegado el 2026-08-03.** Suite 324 archivos / 2425
tests, lint y build OK. Sin migraciones Dexie ni Supabase.

### 18. Fuerza — desacople del nombre, Entregas 1–3 (2026-08-01, `3d480b3`)

Mismo espiritu que la rotacion de squash (§16): que el nombre visible del
ejercicio deje de decidir seleccion o carga. Sin migraciones Dexie ni Supabase.

- **Inventario** (retirado tras el cierre del bloque; historial en git):
  tres rutas de resolucion (resuelto por campos / resuelto pero el nombre gana
  igual / no resuelto) y dos hallazgos — dos fuentes de verdad para el 1RM sin
  factor comun, y desempate por nombre en `strengthSelector.ts:1006`, el mismo
  bug ya corregido en squash.
- **Entrega 1 — determinismo.** Desempate por `id`, ganador unico en la rama de
  substring y fixtures por `id`. La auditoria detecto que el snapshot de
  seleccion se genero despues del cambio; la diferencia historica queda
  aislada en un test: en `build`, `back_squat` reemplaza a
  `trap_bar_deadlift` por el nuevo desempate.
- **Entrega 2 — rutas separadas.** Para ejercicios resueltos, protocolo,
  potencia, implementos y topes se leen de metadata; los regex estructurales
  sobreviven como fallback de nombres libres. Tras el code review, la
  resolución expone `exact`/`alias`/`substring`: solo las dos primeras son
  identidad estable y un match parcial conserva las redes por nombre.
- **Entrega 3 — metadata explicita.** `loadReference` reemplaza las dos fuentes
  de verdad anteriores con **25 declaraciones**: 15 elegibles para selector y
  10 solo para calculo de carga. `landmine_press` conserva elegibilidad sin
  factor; `bodyweight_squat` y las cuatro dominadas quedan fuera. Cinco
  planchas declaran `prescriptionUnit: 'seconds'`. `REFERENCE_TABLE` y
  `mapExerciseTo1RMReference` se retiraron deliberadamente.
- **Matriz de nombres libres.** Conserva variantes legitimas mediante aliases
  exactos y documenta la perdida de carga fail-closed para nombres que no
  identifican una referencia segura. Vive en
  `strengthFreeNameLoadMatrix.test.ts` y en el spec de diseno.
- **Correcciones de review (4/4).** Se restauró el filtrado de protocolos y los
  guardas de porcentaje/entrada en calor y peso maximo para nombres largos que
  resolvían por substring. El supuesto basal se renombró a contrato
  post-migración; el cruce de los 25 factores vive ahora en un ledger literal
  independiente de `loadReference`.

Estado: **commiteado en `3d480b3`, sin migraciones.** Code review cerrado. El
copy de fuerza sigue fuera de este bloque.

### 19. Fuerza — identidad estable de ejercicios (`libraryRef`-first) (2026-08-01)

La identidad viaja ahora desde los productores deterministas hasta todos los
consumidores que reciben el ejercicio completo:

- `resolveStrengthExercise` prioriza un ref vivo de fuerza y cae a
  `exact`/`alias`/`substring`/`ambiguous` cuando está muerto, es ajeno o falta;
- selector, core inyectado y expansión de footwork estampan refs; footwork
  reemplaza el ref del bloque genérico y un ref vivo evita la expansión;
- conversión, rotación y deduplicación tienen helpers únicos; historial,
  progresión, reemplazo, roles, cobertura de 1RM y detección del coach son
  ref-aware;
- backup/import sanitiza el ref de propuestas pendientes, mientras el
  normalizador descarta cualquier identidad emitida por la IA;
- los 77 ids conocidos están congelados en una lista append-only y un registro
  separado impide reutilizar ids retirados.

**Gate de comportamiento.** Contra `3d480b3`, 2541 casos de nombres y 116
salidas de selector fueron byte a byte idénticos. La cohorte canónica dio 0/231
mismatches entre resolución por nombre exacto y por ref. El primer barrido de
conversión detectó una regresión en 47/92 filas (RPE, porcentaje, peso y
warmups); se corrigió con una proyección pre-enrichment que conserva el ref sin
adelantar targets, y el barrido final quedó 0/92.

Estado: **implementado, commiteado y desplegado el 2026-08-03, sin migraciones.** Verificado con 339
archivos / **2613/2613 tests**, TypeScript, lint, build y `git diff --check`.
Spec y plan retirados tras el despliegue; historial en git.

Limitación central: sesiones, plantillas y planes creados antes de esta entrega
siguen sin ref. El siguiente proyecto de copy debe conservar cada nombre legacy
en `aliases`; no hay backfill automático.

## Avances Ya Implementados

### 20. Fuerza — copy de la librería por `id` (2026-08-01)

Los 77 ejercicios de fuerza pasan a lenguaje de gimnasio sin que el texto
vuelva a decidir nada. Sin migraciones.

- **12 renombres**, cada nombre anterior agregado a `aliases` del mismo `id`
  (`Press sobre cabeza` → `Press vertical`, `Sentadilla en zancada` →
  `Zancada estática`, `Control de tronco dead bug` → `Dead bug — control de
  tronco`, entre otros).
- **31 descripciones** reescritas a español neutro: primero qué hacer, después
  el objetivo. Se retiran `stance`, `setup`, `tracking`, `bracing`, `snap`,
  `cachado`, `repeat sprint`, `reps`, `overhead`, `lunge`, `footwork` y
  `step-up`; se conservan los términos que sí se usan en una sala de pesas
  (`dead bug`, `goblet`, `Pallof`, `trap bar`, `Icky shuffle`, `kettlebell`,
  `landmine`, `Copenhagen`, `fitball`, `push press`, `split-step`, `TRX`).
- **Un cuarto productor determinista** apareció durante el diseño:
  `buildFallbackSession` (`WeekCreatorEngine.ts`) tenía 14 filas literales con
  13 ids únicos y sin `libraryRef`. Ahora construye por `id` mediante
  `getStrengthExerciseIdentityById`, igual que `makeCoreExercise` y la
  expansión de footwork. Ningún productor repite copy.

**Gate de comportamiento.** Barrido pareado contra `afaac17` con clave por `id`
—porque los nombres cambian—: **231 filas, cero diferencias** de `weight`,
`targetPercent1RM`, `targetRpe`, `reps`, `group` y `warmupSets`. Cubre copy y
migración de productores juntos. Además, para los 12 ids renombrados, resolver
por nombre anterior, por nombre nuevo y por `libraryRef` da prescripción
idéntica (12/12). Cero colisiones de nombre o alias entre ids, y los 77 nombres
canónicos y todos los aliases resuelven a su propio `id`.

El snapshot de invariantes congela la metadata deportiva de los 77 y el texto
fuera de alcance: 65 nombres y 46 descripciones intactos, verificado sin
regenerarlo.

Estado: **implementado, commiteado (`33d585f`) y desplegado el 2026-08-03.** Spec y plan en
git (spec y plan retirados tras el despliegue).

**Riesgo latente — cerrado el 2026-08-03.** Ver §21.

### 21. Week Creator — endurecimiento del fallback determinista (2026-08-03)

Cierra el riesgo latente que §20 dejó documentado. Sin migraciones, un archivo
de producción y un test nuevo.

El defecto real no era que `getStrengthExerciseIdentityById` lanzara —eso es
deliberado y se conserva—, sino que el throw **salteaba una salida que ya
existía y estaba bien instrumentada**. La rama de validación fallida
(`WeekCreatorEngine.ts:604-618`) ya hacía `failRequest` + flush del tracker +
`throw` de un mensaje en español con código de soporte; construir el fallback
fuera de todo `try` esquivaba ese camino y producía tres efectos:

1. se perdía la semana degradada, que es el propósito del fallback;
2. el usuario veía el string interno `Ejercicio de fuerza inexistente: xyz`,
   porque `formatError` (`useChatStore.ts:921`) reexpone `Error.message` tal
   cual en el chat;
3. quedaba un request en vuelo para siempre en `useAIDebugStore`, porque
   `startRequest` ya se había disparado y no corría ni `completeRequest` ni
   `failRequest`.

Solución: el cierre de falla se extrajo a un helper local `failFallback`
—`never`-returning, con el trace id del mensaje como parámetro— que ahora usan
**las dos** ramas. El `try` envuelve **únicamente** la construcción; la
validación queda fuera a propósito, para que `fallback_invalid` conserve su
significado («se construyó pero no validó») y no colapse con
`fallback_build_failed` («no se pudo construir»). La causa cruda va a
`console.warn` y a los `warnings` de telemetría; nunca al mensaje del usuario.

**Calibración honesta del valor.** Esto **no** baja la probabilidad de que
ocurra, que ya era muy baja: dos tests independientes rompen en CI antes
—`strengthCatalogIdPermanence.test.ts` congela los 77 ids, y
`strengthCopyProducerIdentity.test.ts:90` maneja `sendWeekCreate` hasta el
fallback verificando que cada ejercicio resuelva a una definición viva—. Lo que
cambia es **qué pasa si ocurre igual**: degradación instrumentada en vez de
degradación fea. Es defensa en profundidad, no el cierre de un agujero abierto.

**Inconsistencia preexistente corregida en el mismo bloque.** La rama de
validación registraba telemetría bajo `fallbackTraceId` pero lanzaba el mensaje
con `failureTraceId`, el trace del fallo del *proveedor*: el código de soporte
que recibía el usuario no apuntaba a la fila que registraba su error. Por
decisión del owner las dos ramas usan ahora `fallbackTraceId`, y
`failureTraceId` se conserva para correlación interna como warning
`Provider failure trace: <id>` en la fila de telemetría. Es un cambio de
comportamiento observable en una rama que existía, aprobado explícitamente.

Un bloque de tests **espejo** fuerza `fallback_invalid` —rechazando la
validación solo de la semana ya construida, identificada por su
`model: 'local-week-fallback'`— y fija que ambas ramas cumplen el mismo
contrato: código visible igual al `traceId` de su fila, trace del proveedor
presente para correlación, y cero requests en vuelo.

Verificado: **355 archivos / 2750 tests**, typecheck, lint, build y
`git diff --check` verdes. Spec en
git (spec retirado tras el cierre del bloque).

### 22. Telemetría de requests del coach (`018`, 2026-08-05)

Estado operacional: **`018_coach_requests.sql` aplicada en producción el
2026-08-05.** La prueba con tráfico real queda pendiente; hasta completarla no
se considera verificada la durabilidad best-effort, la latencia end-to-end ni
la cobertura de costos.

El chat era el camino de mayor volumen sin una cifra agregable de costo ni de
latencia. `logCoachRequest` ya emitía duración, tokens, `finishReason` y
`outcome` por request, pero como `console.info`; lo que faltaba era
**persistencia**.

`018_coach_requests.sql` guarda una fila por request de las 7 clases que pasan
por `coach.ts`. El Plan Builder **async** no entra: ya lo cubre `016`; las filas
`plan_builder_*` de esta tabla son del camino **síncrono**.

Decisiones principales:

- Escritura con el token del usuario y policy
  `insert with check (auth.uid() = user_id)`, sin service role en la función del
  coach. El trade-off aceptado es que un cliente de confianza podría forjar
  filas; revisar si aparece self-serve.
- `user_id not null`: no se persisten requests en modo dev sin auth ni las que
  fallan autenticación. Los eventos de consola se conservan.
- Persistencia **best-effort sin `await`**, con
  `AbortSignal.timeout(3_000)`. Durabilidad y latencia deben medirse en el
  rollout; un test local no demuestra propiedades del runtime de Netlify.
- `streamed` registra el transporte efectivo para segmentar pérdida y latencia.
  En el cliente, `AITechnicalResult` conserva el transporte **terminal**: un
  fallback streaming→JSON se clasifica como `false`.

`estimated_cost_usd` distingue `0` para el bypass determinista, `null` para
precio ausente o usage insuficiente y un valor numérico cuando el precio
fechado está disponible. **`null` nunca significa cero.** `MODEL_PRICES` aún
solo cubre `claude-sonnet-4-6`; responder cuánto cuesta el chat requiere poblar
los modelos reales de Gemini/OpenAI, trabajo separado.

Rollout de `018`:

1. ✅ Aplicar `supabase/018_coach_requests.sql` en producción (**completado
   2026-08-05**).
2. ⏳ Confirmar el bundle desplegado y ejecutar la prueba de producción.
3. ⏳ Verificar pérdida por `streamed`: filas contra eventos
   `coach.request.completed` sobre la misma ventana.
4. ⏳ Verificar latencia por `streamed`: p50/p90 de
   `completedAt - startedAt` de `useAIDebugStore` contra la línea base. No usar
   `serverDurationMs`, calculado antes de la escritura.
5. Si hay pérdida material o impacto de latencia, escalar al endpoint dedicado
   antes de confiar en los agregados.
6. ⏳ Recién entonces poblar `MODEL_PRICES` y agregar la sección medida del chat.

### 23. Superseries de fuerza (2026-08-05, `49ab6a8`…`faf70f4`)

Las superseries dejan de ser una convención de texto libre en `notes` y pasan a
ser estructura real: editables a mano y generables por el motor determinista.
Sin migraciones — Dexie sigue en v19 y Supabase no cambia, porque el campo viaja
dentro de `sessions.data`, que ya es `jsonb`.

**Modelo.** Un campo opcional `supersetGroup` (id opaco) sobre una lista de
ejercicios que **sigue siendo plana y sigue siendo la única fuente de verdad**.
No hay estructura anidada, así que ningún consumidor existente necesita
enterarse. `supersetGroups.ts` corrige tags y rondas **sin reordenar, insertar
ni borrar** —eso mantiene intactos los contratos posicionales de fuerza— con
tres reglas en orden fijo: contigüidad, cardinalidad, rondas. El orden importa y
queda congelado por el caso `A, X, A, A`, donde el primer segmento reserva el id
aunque después se disuelva por singleton, así que el segundo también lo pierde.

**Persistencia.** Serializers, plantillas y export/import propagan el campo.
Todo borde de deserialización pasa por el normalizador **completo**, no solo por
el saneador de id: un backup puede traer contigüidad rota, un singleton o `sets`
divergentes, y ninguna de esas tres cosas la arregla sanear el id.
Materializar una plantilla **re-emite** los ids por aplicación, para que
aplicarla dos veces el mismo día no produzca dos segmentos con el mismo id que
el normalizador disolvería; import/export normal los conserva.

**Orden.** El sort de fuerza ordena **unidades** con el mismo comparador
evaluado sobre el líder, y tras agrupar no vuelve a correr ningún sort
individual. Una sesión sin grupos ordena exactamente igual que antes: el
snapshot de paridad se congeló contra el código previo y se verificó revirtiendo
el módulo a HEAD antes de tocarlo.

**Roles.** El contrato de roles es group-aware: un seguidor nunca es elegible
para `main_lift`. Un core o un power dentro de un grupo **conservan** su rol, así
que la regla de seguidor solo bloquea la elegibilidad y no abre un agujero de
exención. El conjunto contable que alimenta `qualityReview` y `countRepairsV2`
no se mueve al agrupar accesorios.

**Política determinista.** Cuatro reglas con prioridad fija y reserva por
ejercicio —circuito de zona media sobre la cohorte de series más grande, main
lift + pliométrico, power olímpico + pull accesorio, push accesorio + pull
accesorio— y una restricción dura: **solo agrupa candidatos cuyo `sets` ya
coincide**. Sin ella, la regla de ancla del normalizador convertiría la política
en un cambio de prescripción y dejaría de ser cierto que únicamente cambia el
orden y el tag. Los pliométricos van por allowlist explícita de ids, igual que
los drills competitivos de squash: `intensityType: 'power'` abarca desde el
clean hasta la bici de asalto y no sirve como predicado. El reflow conserva el
orden relativo de los anclajes, así que la identidad del `main_lift` no se
mueve; hay un test de propiedad sobre las rotaciones del pool que lo fija.

**Modo.** `shouldApplySupersetPolicy` es total: un contexto incompleto o una
fase fuera de dominio devuelven `off`, que es el modo seguro. Usa solo las tres
señales comparables entre chat y Plan Builder (`phase`, `sportProfile`,
`sessionDurationMin`); `fatigueLevel`, `experienceLevel` y `recentExercises`
quedan excluidas porque en el chat son constantes hardcodeadas y usarlas
divergiría los dos caminos en silencio. Más `intent`, de **tres** estados.

**Cableado.** Dos puntos. En el chat, `actionPostProcessor.ts`, con las señales
tal como vienen y sin los defaults del selector de ejercicios, que rellenan fase
y duración ausentes y anularían ese resguardo. En el Plan Builder, **un solo**
punto —al final de `normalizeStrengthSessions`, después de toda la rotación y
sustitución— y con la fase **cruda**: `mapStrengthPhase` convierte `transition`
en `base` y dejaría una semana de transición elegible para `full`.

**Prompt.** Se retiró la regla de etiquetado `A1/A2`, que comunicaba supersets
implícitos sin cambio de schema. El normalizador de respuestas no incluye
`supersetGroup` en su allowlist, así que **el modelo no puede emitir identidad
de grupo** — mismo precedente que `libraryRef` en §19.

**UI.** Un riel izquierdo con corchete, el mismo lenguaje en las dos
superficies. El checklist muestra `A · Superserie · 4 rondas` y renderiza el
segmento entero en el bloque visual de su líder, así que un grupo que cruza
bloques nunca se parte. El editor agrupa por costura entre tarjetas, arrastra la
unidad completa al mover un líder, reordena un seguidor solo dentro de su grupo
y asigna un id nuevo al segmento derecho al cortar. El editor **no** normaliza
mientras se edita —un grupo de uno en construcción es un estado intermedio
legítimo— y normaliza al guardar.

**Code review.** Tres hallazgos confirmados y corregidos.

1. La auditoría del corpus usaba `'Remo en maquina'`, que **no resuelve** contra
   el catálogo (rol `unknown`, bloque `other`). El escenario de squash quedaba
   sin ningún pull accesorio, así que el snapshot congelaba un
   `push_pull → no_eligible_partner` producido por el fixture y no por la
   política, y esa regla no estaba ejercitada en positivo en todo el corpus.
   Corregido a `'Remo con pecho apoyado'` y, sobre todo, **cerrado con un guard**
   que exige que todo el corpus resuelva contra el catálogo vivo.
2. El resumen de cabecera de `SessionCard` aparecía en los cuatro tipos de
   sesión con ejercicios, no solo en fuerza, y decía «1 ejercicios». Acotado a
   fuerza y con singular correcto.
3. **`prefersSupersets` ignoraba el rechazo explícito.** Era un booleano, y
   `false` significaba a la vez «no lo mencionó» y «lo rechazó». Como la
   preferencia solo podía subir un nivel y nunca bajar, un contexto que ya
   resolvía `permissive` por fase y duración agrupaba igual: «armame la sesión
   del lunes sin superseries» a 60 min en fase base devolvía el circuito de zona
   media armado. Pasó a un `intent` de tres estados —`undefined`, `'requested'`,
   `'declined'`— donde el rechazo corta en `off` **antes que cualquier otra
   regla**, incluida la validación de contexto, porque «sin superseries»
   significa lo mismo con o sin fase conocida. Es un defecto del diseño del
   plan, no una desviación de la implementación: la detección de negaciones ya
   existía, pero solo servía para no leer «sin superseries» como una petición
   *de* superseries. El oracle de la tabla total pasó de 252 a 378
   combinaciones.

Verificado: **372 archivos / 2900 tests**, lint, build y `git diff --check`
verdes. Spec en
git: spec y plan retirados tras el despliegue.

**Pendiente: verificación manual post-deploy.** No cuesta API y son seis pasos
con una sesión real: (1) una sesión de fuerza vieja sin grupos se ve igual que
antes; (2) crear una superserie a mano, guardar y recargar; (3) guardarla como
plantilla y aplicarla dos veces el mismo día, confirmando que los dos grupos son
independientes; (4) exportar backup, borrar datos locales, importar y confirmar
que los grupos vuelven; (5) pedirle al chat una sesión «en superseries»;
(6) pedirle una «sin superseries» a 60 min en fase base y confirmar que **no**
agrupa.

**Fuera de alcance**, declarado en el spec §2: carga por serie, descanso entre
rondas, tríos automáticos, backfill de sesiones existentes, limpieza de
prefijos `A1/A2` históricos, superseries fuera de fuerza e `intent` en Plan
Builder.

### 24. Whoop — frescura, detalle de workouts y contexto del coach (2026-08-05/07)

El incremento cierra el salto entre “Whoop completó una sesión” y “el atleta y
el coach entienden qué carga registró”. No cambia el matcher ni usa strain para
`Session.actualRpe`.

**Frescura.** `c267a1f` agrega auto-sync self-only al entrar al Dashboard. La
política es determinista: sincroniza si nunca hubo éxito, si pasaron 30 minutos
o si el último sync terminó en error; una lectura fallida de status no dispara
un POST a ciegas. El camino es silencioso y reutiliza el cooldown existente.

**Detalle por sesión.** Las tarjetas auto-completadas por Whoop reciben el
workout real por prop y muestran métricas semánticas formateadas en la UI:
duración siempre; strain, FC y distancia si existen; ritmo solo para `running`,
con distancia mínima de 300 m y duración exacta `endAt - startAt`. `PENDING_SCORE`
y `UNSCORABLE` tienen mensajes distintos; `SCORED` con datos parciales no inventa
un estado pendiente.

**Residual diario.** `DayDetail` consulta por `{ athleteId, date }`, identifica
el estado con esas dos claves para no retener filas al cambiar de scope y lista
una línea por workout que ninguna sesión reclama. La fuente durable de la
asociación es `session.autoCompletion.workoutId`, no el status local del workout.

**Coach.** Cada request de chat arma al vuelo una ventana inclusiva de siete
días, conserva como máximo los ocho workouts `SCORED` más recientes y resume el
desborde. Cada línea separa la carga medida de su sesión planificada o declara
`sin sesion asociada`. La guardia final evita mezclar strain 0–21 con Esfuerzo
1–10. El bloque se omite completo si no hay datos y también en atletas
gestionados. `ChatCoach` captura atleta + switch epoch antes de leer y descarta
**el bloque** si el scope cambió durante las consultas — nunca el envío.

**Datos y costo.** No hay SQL, migración Dexie ni backfill. Se reutilizan los
workouts ya sincronizados por `012`; por eso sesiones viejas obtienen el detalle
al vuelo. El costo máximo aceptado es aproximadamente 280 tokens por request de
chat cuando hay workouts.

**Code review (2026-08-07).** Cinco hallazgos corregidos antes del commit.

1. **El guard de scope del chat descartaba el mensaje entero, y se disparaba en
   una transición benigna.** `hydrateActiveAthlete` publica el atleta con
   `setActiveAthleteId` **sin** `bumpSwitchEpoch` (`activeAthlete.ts:13`), así
   que un arranque que resuelve `null → ath_x` mientras el envío estaba en vuelo
   llegaba al guard con la identidad cambiada y el epoch intacto. `ChatInput`
   limpia el textarea **antes** de llamar a `onSend` (`ChatInput.tsx:18`) y el
   auto-submit ya marcó el draft consumido: el mensaje se perdía sin burbuja,
   sin error y sin reintento. Ahora se descarta **el bloque** y el envío sigue.
   Mandar sin bloque es exactamente el comportamiento previo a esta entrega, así
   que la degradación no puede filtrar nada. Fijado por
   `chatCoachWhoopBlockScope.test.tsx`, cuyos tres casos de scope fallan contra
   el código anterior.
2. **El residual del día se afirmaba antes de tener con qué.** `loadWeek` es un
   efecto y `sessions` arranca vacío, mientras que los workouts salen de un
   índice puntual de Dexie y ganan la carrera: al entrar directo a `/day/:date`,
   un workout que **sí** completó una sesión aparecía un instante bajo «Whoop
   registró además». La afirmación ahora exige `canResolveWorkoutClaims`, que
   compara `loadedWeekStart` con la semana del día. Una lista vacía por no haber
   cargado es indistinguible de una vacía de verdad — por eso se pregunta por la
   semana cargada y no por la cantidad de sesiones.
3. **El recuadro de métricas salía a sangre.** Se renderiza como hermano de la
   cabecera (`p-3 md:p-4`) sin padding propio, así que su borde redondeado
   chocaba con el de la tarjeta y con la franja de acento. Igualado con
   `mx-3 mb-3 md:mx-4 md:mb-4`.
4. **`WINDOW_DAYS` estaba declarado dos veces**, en el orquestador y en el
   formateador: la ventana que se consulta y la que se filtra eran constantes
   independientes. Ampliar una sola truncaría o pediría de menos sin que ningún
   test lo notara. Ahora `whoopWorkoutBlock.ts` importa
   `WHOOP_WORKOUT_WINDOW_DAYS` del formateador, que es su dueño.
5. **El residual imprimía el literal inglés de Whoop** (`weightlifting`,
   `functional fitness`) en una vista que habla el vocabulario de la app. Pasa
   por `mapWhoopSport` + `SESSION_TYPE_CONFIG`, conservando el nombre crudo si
   el deporte no está mapeado.

**No corregido, reportado.** El título de sesión entra al prompt por un
`sanitizeField` local (colapso de espacios + tope de 48) en vez de
`sanitizeUserText` (`promptBuilder.ts:325`), que neutraliza bloques `actions` y
etiquetas de rol. **No es una exposición nueva:** los mismos títulos ya viajan
crudos en `promptBuilder.ts:1506` y `:1805`, así que endurecer solo este bloque
no cierra nada y tocar la política de saneado del coach es una pieza aparte.
También queda abierto que `LegalPageLayout.handleSignIn` se traga el fallo de
OAuth con un `console.error`, sin la superficie de `authError` que sí tiene
`LandingPage`.

**Verificación.** Working tree revisado con **379 archivos / 3000 tests**,
typecheck, lint, build y `git diff --check` verdes. La pasada autenticada quedó
escrita en `docs/superpowers/smokes/2026-08-07-whoop-workout-detail-smoke.md` y
cubre también el auto-sync para cerrar ambos pendientes con una sola sesión real.

**Pendiente de rollout:** deploy y smoke combinado. No marcar esta capa como
productiva antes de observar un workout asociado, uno no asociado si los datos
reales lo permiten, el payload del coach y la ausencia total bajo un atleta
gestionado.

**Siguiente mejora recomendada:** zonas de frecuencia cardíaca por workout.
**Implementada — ver §25.**

### 25. Whoop — zonas de frecuencia cardíaca por entrenamiento (`019`, 2026-08-08)

Tercera entrega del bloque Whoop. Persiste las seis duraciones de zona y la
cobertura de medición de cada entrenamiento, y las usa en la tarjeta de sesión,
el bloque objetivo del coach y un resumen semanal nuevo. **Sin Dexie v20:** las
zonas son propiedades no indexadas de `WhoopWorkout`, así que `stores()` no
cambia.

**Autoridad de forma.** `whoopZoneDurations.ts` es el único normalizador; los
tres bordes que deserializan —servidor, pull del cliente, parser de import— solo
adaptan nombres y delegan. Recibe `scoreState` a propósito: el CHECK de `019` lo
garantiza en Supabase, pero el tipo admite cualquier combinación y un backup
manipulado entraría a Dexie, donde ninguna restricción lo alcanza. Descarta la
distribución completa ante cualquier clave faltante, no entera, negativa, o si
las seis suman cero; la cobertura se valida por separado, así que descartar una
no descarta la otra.

**Migración.** `019_whoop_workout_zones.sql`: siete columnas y cinco `CHECK`
—todo-o-nada, no negatividad, suma positiva, rango de cobertura, y solo con
`SCORED`—. Se agregan sin validación diferida porque todas las filas existentes
las tienen en null. **Se aplica a mano y ANTES del primer deploy de código:**
`pullWorkouts` pide las columnas por nombre y pedir una inexistente devuelve 400
en cada pull.

**Flag de ingestión.** `WHOOP_ZONES_ENABLED` controla **solo** si se incorporan
zonas nuevas desde Whoop. Apagado, el upsert **omite** las siete claves en vez de
escribirlas como `null`: `upsert` pisa toda clave presente, así que un null
borraría zonas ya guardadas y convertiría un flag de ingestión en un destructor
de datos. No oculta zonas persistidas ni impide que un backup las traiga.

**Guard de drift en tres ejes.** `WHOOP_WORKOUT_ZONE_COLUMNS` vive en `src/` —no
en `netlify/`— para que el cliente la importe sin arrastrar código de Functions
al bundle. La consumen el `.sql` (guard de migración), el payload del upsert y el
`SELECT` del cliente. Con una sola lista y los tres tests recorriéndola, ampliar
la migración sin tocar el código rompe en CI en vez de dar 400 en producción.
Verificado no vacuo: una octava columna hace fallar el guard.

**Presentación.** `workoutMetrics.ts` gana `HIGH_ZONE_KEYS` —única declaración
del umbral, sobre la que itera `resolveHighZoneDurationMs`—, el estado de
cobertura en cuatro ramas y el formateo truncado a un decimal (redondear 89,96
daría «90,0» junto a un aviso de cobertura baja). Los milisegundos son la unidad
de autoridad y cada superficie convierte una sola vez.

**Color.** La escala es una rampa **secuencial de un solo tono**, no categórica:
las zonas son ordinales, así que el orden tiene que verse en el color. Tono 37°
—el de `brand`—, luminosidad OKLCH monótona 0,34→0,668, croma 0,028→0,224 y paso
más alto anclado exactamente en `#ff4d00`. La curva de croma sube despacio y
salta al final, así que solo Z4/Z5 llevan croma pleno: lo encendido es lo que
cuenta el titular. Una sola autoridad de color en `hrZoneScale.ts`.

**Legales.** Dos publicaciones nuevas, `privacy@2026-08-08` y
`whoop_biometric@2026-08-08`, **registradas y NO vigentes**. Enumeran los
entrenamientos, las seis zonas y el porcentaje registrado, y reemplazan la
afirmación de que el cliente replica solo un resumen diario, que dejó de ser
cierta con `012`. Un test hermano fija que `currentVersion` no se movió: activarlas
es el Deploy 2 y detiene la sincronización de Whoop para quien no reacepte.

**Code review.** Cuatro hallazgos corregidos. El más serio: la publicación nueva
actualizaba el párrafo de almacenamiento pero dejaba intacta la enumeración
«Wearables opcionales», que es lo que efectivamente se consiente. También se
había perdido la leyenda de las seis zonas en el resumen semanal —el defecto
exacto del mockup que el spec §7.3 mandó corregir, reintroducido— y `HIGH_ZONE_KEYS`
existía duplicada en la capa de presentación.

**Desviación registrada.** En el coach, `unknown` emite `· cobertura ?` y no el
literal largo: medido, el bloque costaba +70/+120 tokens contra los ~40
presupuestados, y el literal puede repetirse en las ocho líneas. La guardia se
probó corta por lo mismo y **se revirtió**: perdía la premisa de que las zonas
son distribución *medida*. Anotado como enmienda en el spec §6.

Verificado: **385 archivos / 3087 tests**, typecheck, lint, build y
`git diff --check`.

**Pendiente de rollout, en este orden:** (0) confirmar flags de consentimiento;
(1) aplicar `019`; (2) Deploy 1 con el flag apagado; (3) aprobación jurídica del
paquete de dos publicaciones; (4) Deploy 2 cambiando ambos `currentVersion`;
(5) reaceptación; (6) Deploy 3 encendiendo `WHOOP_ZONES_ENABLED`. El smoke está
escrito en `docs/superpowers/smokes/2026-08-08-whoop-hr-zones-smoke.md`, separado
entre lo verificable con el flag apagado y lo que exige el Deploy 3.

**Después de esto** quedan, en este orden: desnivel para running/cycling y
kilojoules; ninguno de los dos justifica una migración por sí solo mientras no
exista un caso real frecuente.

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
- Publicados como rutas reales y conectados al consentimiento versionado general + biometrico.
- El rollout técnico está cerrado; faltan aprobación jurídica formal y decisión de retención de la evidencia al borrar cuenta.

### Plan Builder Y Calidad Deportiva

- Plan Builder async operativo.
- Rate limit local y reservas de uso.
- Mejoras en taper/race week, double sessions, squash priority, match play y reparacion.
- Tests amplios de Plan Builder, repair, rate limits y generacion async.
- Copys internos parcialmente humanizados.
- Conteos de semanas, ventanas y filtros corregidos para usar calendario local y resistir cambios DST.
- Serializacion JSON canonica disponible para comparaciones estructurales estables.
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
- Auto-sync self-only al abrir Dashboard cuando el estado está stale (30 min),
  nunca a ciegas tras fallo de status y nunca para atletas gestionados.
- Dexie v15 `readinessDaily`, pull local, backup/export y wipe local.
- `ReadinessCard` en dashboard y `WhoopConnection` en settings.
- Prefill de check-in: sueno, calidad, energia y **Esfuerzo** desde Whoop, editable y con procedencia `prefillSource`.
- `Session.actualRpe` queda separado: el esfuerzo objetivo de Whoop no alimenta carga/ACWR por sesion.
- Readiness entra al prompt del coach como contexto pasivo y a alerta suave por recovery rojo.
- Workouts auto-completados muestran métricas reales en `DayDetail`; los no
  asociados quedan visibles como residual del día.
- El coach recibe hasta ocho workouts `SCORED` de los últimos siete días,
  distinguiendo carga medida, sesión planificada y actividad fuera de plan.
- Desconexion/borrado remoto con service-role y tolerancia a 404/tabla ausente.

### Resumen Semanal Y Coach Note

- Nota semanal del coach visible solo viernes-domingo.
- Completar todos los ejercicios marca automaticamente la sesion como realizada.
- `coachNoteSnapshot` y freshness check evitan reutilizar notas semanales obsoletas cuando cambia el resumen.
- Prompt del coach distingue nota fresca vs solicitud de generacion nueva.

### Verificacion Tecnica Reciente

Cierres tecnicos recientes:

- Plan Builder quality v2: `npm test` verde (298 archivos / 2162 tests); Fase 0 de medicion cerrada contra el control `6c45885a`.
- Core athlete-aware / Coach F2-lite: `npm run lint`, `git diff --check`, `npm test` (139 archivos / 990 tests) y `npm run build` OK.
- Whoop v1 review: lint + 1160 tests + build + typecheck OK.
- Commits posteriores agregaron tests focalizados para Esfuerzo, sync on-demand y weekly coach note.
- Biblioteca/plantillas: pruebas dirigidas de serializer, Dexie, CRUD, sync, backup y UI OK; `npm run lint` + `npm run build` OK.

## Riesgos Que Siguen Vivos

### 1. WHOOP ya agrega dato sensible: enforcement activo, cierre jurídico pendiente

Whoop es el track de producto con mas retorno inmediato, e introduce datos biometricos,
OAuth externo, tokens cifrados y borrado completo. La operacion tecnica ya cerro (`011`/`012`
aplicados, deploy y smoke confirmados por el owner), y desde el 2026-08-03 también están
activos `017` y los gates de cliente/servidor. El smoke persistió
`whoop_biometric@2026-07-07` separado de los tres documentos generales.

El riesgo que queda ya no es falta de enforcement técnico, sino gobernanza legal:

- aprobar formalmente privacidad, términos y descargos;
- decidir cuánto tiempo conservar `user_consents` al borrar una cuenta y alinear el copy de Ajustes;
- verificar manualmente el `403 consent_required` server-side en un próximo smoke de Whoop, además de la cobertura automatizada existente.

### 2. Legal existe como rutas, pero falta revision juridica formal

Las rutas publicas `/terms`, `/privacy`, `/health-disclaimer` y descargo Whoop ya existen como componentes React y estan linkeadas desde la navegacion publica. Lo que falta es revision formal de abogado y firma antes de cobro/anuncios masivos, especialmente para:
- Condiciones sobre uso de Whoop y datos biometricos.
- Descargo de salud y no diagnostico.
- Politica de cancelacion/reembolso para piloto.

Esto es un riesgo legal/reputacional, no tecnico.

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

### Opcion A - Cierre operativo de WHOOP readiness — CERRADA

Objetivo: pasar de codigo committed a flujo real confiable en produccion.

Estado: **`011` aplicado, deploy confirmado, smoke conectar -> sync -> ReadinessCard -> prefill -> desconectar/borrar hecho por el owner.** El consentimiento biométrico técnico está activo y persistido; falta únicamente su aprobación jurídica formal antes de exponerlo a terceros.

### Opcion B - Whoop Workout Auto-Complete — CERRADA

Objetivo: que entrenamientos registrados por Whoop completen sesiones planificadas self-only sin intervencion manual.

Estado: **`012` aplicado, Whoop reconectado con `read:workout`, smoke auto-complete confirmado por el owner.**

### Opcion C - Piloto manual pagado (1-3 clientes) — RECOMENDADO AHORA

Objetivo: mostrar y cobrar antes, validando flujo comercial/operacional con cliente real.

Orden:

1. ✅ Rutas legales publicas (Fase 0 completa).
2. ⏳ Revision juridica formal (en curso).
3. ✅ Consentimiento general y biometrico in-app activo y persistido (2026-08-03).
4. ⏳ QA de 3 planes arquetipo como atletas gestionados.
5. ⏳ Oferta piloto cerrada (1-2 semanas, precio, soporte, reembolso).
6. ⏳ Primer cliente acompanado elegido y onboardeado.

Ventaja: aprende con cliente real, valida operaciones (revision semanal, feedback), cierra riesgos legales en vivo.

Riesgo minimo ahora que Whoop y Coach Workspace ya estan en prod.

### Opcion D - SP1a dos-lados (futuro)

Objetivo: atletas con login propio + coach compartiendo el mismo perfil, membresias/RLS v2.

Estado: especificado y planificado (plan completo: `docs/superpowers/plans/2026-07-09-sp1a-two-sided-foundation.md`), pero deliberadamente despues de Piloto C (Opcion A+B+C primero). SP1a es un incremento de acceso relevante, no bloqueante para la oferta inicial de "coach 1:1 con tus atletas gestionados".

### Recomendacion

Ejecutar **Opcion C (Piloto manual) + cierre jurídico**. El consentimiento técnico y la Opcion B (Workout Auto-Complete) ya están operativos; no requieren otra entrega. Opcion D (SP1a dos-lados) espera hasta post-piloto cuando se entienda mejor si el siguiente cliente sera alguien que quiera compartir con su coach o sera el owner/coach usando mas atletas propios.

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
- [x] Conectar footer a rutas legales reales (Fase 0 completada 2026-07-13).
- [x] Rutas legales publicas activas: `/terms`, `/privacy`, `/health-disclaimer`, `/descargo-whoop`.
- [x] SEO: cada ruta publica con title/description/OG unico (prerender para crawlers).
- [x] Deep links nativos para OAuth callback en iOS.
- [x] Landing `/coaches` en modo prelanzamiento con 3 planes y copy orientado.
- [x] Smoke DEV de `/`, `/features`, `/pricing`, `/coaches` y rutas legales (Fase 0 verificado).
- [x] Smoke PROD/deploy de las mismas rutas (Fase 0 en vivo).
- [ ] Agregar 2-4 screenshots reales o mockups honestos a `/coaches` (hoy placeholders).
- [ ] Revision juridica formal de terminos/privacidad/descargos antes de cobro masivo.

### D. Legal, Confianza Y Seguridad

Objetivo: poder enviar links y cobrar sin zona gris innecesaria.

- [x] Borrador de terminos.
- [x] Borrador de politica de privacidad.
- [x] Borrador de descargo de salud.
- [x] Borrador de descargo Whoop / datos biometricos.
- [x] Crear ruta publica `/terms` (Fase 0 2026-07-13).
- [x] Crear ruta publica `/privacy` (Fase 0).
- [x] Crear ruta publica `/health-disclaimer` (Fase 0).
- [x] Crear superficie de descargo Whoop como ruta publica (Fase 0).
- [x] Linkear rutas desde landing, pricing, features y signup/login (Fase 0 + SharedPublicNav fix).
- [x] Implementar consentimiento de terminos/privacidad/salud en la app autenticada, detrás de flag (2026-08-03).
- [x] Implementar consentimiento biometrico persistido antes de conectar y procesar Whoop (cliente + servidor).
- [x] Registrar version y fecha de consentimiento en log append-only (`017` aplicada; Dexie v19).
- [x] Desplegar el bundle y completar el smoke de activación en producción (2026-08-03).
- [x] Confirmar cuatro filas vigentes en Supabase (`terms`, `privacy`, `health`, `whoop_biometric`) con ids independientes y timestamps de servidor.
- [x] Confirmar hidratación remota con Dexie vacío: login en incógnito abre sin reaceptación en ~0,2 s.
- [ ] Aprobar textos legales de las cuatro publicaciones.
- [ ] Resolver retención de `user_consents` al borrar cuenta y alinear el copy de Ajustes.
- [x] Aplicar `017` en produccion.
- [x] Encender `VITE_CONSENT_GATE` + `CONSENT_GATE_ENABLED` juntas.
- [ ] Verificar manualmente en producción el rechazo server-side `403 consent_required` de Whoop antes de aceptar; cubierto por tests, no observado directamente en este smoke.
- [ ] Evaluar mejoras de UI del gate después de uso real; no agregar espera artificial al chequeo remoto breve.
- [ ] Agregar politica simple de cancelacion/reembolso para piloto manual (en landing coach).
- [ ] Revision juridica formal de textos legales con abogado antes de pago publico o anuncios masivos.

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

Estado: **implementado, revisado, commiteado y `011` aplicado en produccion con deploy/smoke confirmados por el owner; pendiente unicamente linkear gate legal antes de terceros**.

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
- [x] Aplicar `011` en prod y smoke end-to-end (conectar → sync → ReadinessCard → prefill → desconectar/borrar).
- [x] Confirmar deploy del bundle Whoop actual en produccion.
- [x] Linkear el descargo Whoop y activar consentimiento biometrico versionado.
- [ ] Obtener aprobación jurídica formal antes de exponer datos biométricos a terceros.
- [ ] Re-correr smoke despues del primer refresh real para confirmar refresh token/scopes.

### J. WHOOP Workout Auto-Complete

Objetivo: usar workouts detectados por Whoop para completar sesiones planificadas del atleta self, sin crear sesiones nuevas ni tocar RPE de carga.

Estado: **implementado y con rollout operativo cerrado**. Spec retirado tras el cierre; historial en git.

En la auto-revisión encontré tres inconsistencias propias, y dos habrían causado bugs reales si el plan se implementaba tal como lo había redactado:

1. loadSession() no puede validar existencia de mensajes. Lo había puesto como paso 3 del camino compartido, pero loadHistory() también pasa por ahí y una sesión actual recién creada legítimamente no tiene mensajes — el arranque normal habría fallado. La validación se movió a openConversation(), que es quien de verdad necesita defenderse de un id ajeno o inexistente.
2. setStoredChatSessionId() en el camino compartido habría matado la adopción local-only. Esa función borra el marcador local-only (chatSession.ts:36-40), y la adopción de useChatStore.ts:67-87 depende justamente de ese marcador. Llamarla en cada loadHistory() lo habría apagado antes del chequeo, desactivando la adopción de forma permanente y silenciosa. Ahora el id se persiste solo cuando de verdad se cambia de conversación, con un flag persistId, y agregué un test de regresión que fija ese comportamiento.
3. conversationsDirty era estado muerto, porque en paralelo decía "recargar siempre al abrir". Quedó una regla única: recargar si el índice no está ready o está sucio; si no, reusar.

No commiteé el spec — la regla del proyecto dice que los commits los hacés vos. Tenés pendientes de commit: los tres .md de estado del smoke, el backlog en el roadmap, este spec nuevo, y el commit 3a598ed sin pushear.

Revisalo cuando puedas y decime si querés cambios antes de que escriba el plan de implementación. Dos cosas que quizás quieras reconsiderar ahora que están por escrito: la decisión 5.2 (buscás algo, abrís el resultado y caés al final de la conversación, no en el match) y el título derivado del primer mensaje tuyo — que en la práctica va a producir cosas como "hola, quiero ajustar la semana porque me duele el…", útil pero no elegante.

- [x] Decision de producto: self-only, sesiones `planned`, matching por deporte/dia, sin auto-ajuste de plan.
- [x] Decision de datos: `actualDurationMin` si matchea; `Session.actualRpe` queda vacio.
- [x] Decision de UX: badge "Sincronizado desde Whoop" y aviso de reconexion para `read:workout`.
- [x] Decision de seguridad: `whoop_workouts` server-write/client-read, `athlete_id` first, borrado/export/wipe incluidos.
- [x] Reconciliar numeracion: `012`/Dexie v16 para workouts; SP1a en `013+`/v17+.
- [x] Agregar scope `read:workout` sin romper conexiones antiguas.
- [x] Implementar `012_whoop_workouts.sql`, Dexie v16, `pullWorkouts()` y matcher serializado.
- [x] Tests: normalizacion, matcher, idempotencia durable, re-evaluacion `no_session`, lifecycle, UI badge, refresh scopes.
- [x] Aplicar `012` en prod y reconectar Whoop para otorgar `read:workout`.
- [x] Smoke: workout Whoop -> session planned unica -> completed + duracion + nota, sin `actualRpe`.

### K. Coach Workspace v0

Objetivo: reemplazar el roster unico de `/coach` por un workspace de 5 areas y llevar Planificacion/Biblioteca desde placeholder hasta flujo operativo multi-atleta.

Estado: **edicion/Biblioteca desplegadas en produccion con `015` aplicada; pendiente smoke autenticado/multi-dispositivo.**

- [x] `CoachWorkspaceNav`: nav responsive (sidebar desktop, tabs horizontales mobile) con ARIA `tablist`/`tab`/`tabpanel`.
- [x] Tab Resumen: tarjetas de roster con CTAs "Ver semana"/"Ver plan", sin señales computadas (fuera de alcance v0).
- [x] Tab Alumnos: roster + alta de atleta (formulario, submit por Enter) + "Entrenar como este atleta".
- [x] Tab Planificacion: vista semanal multi-atleta con hidratacion explicita, edicion, alta desde plantilla y guardado como plantilla.
- [x] Tab Biblioteca: CRUD de plantillas de sesion, incompatibles forward-compatible, soft-delete y recarga tras sync.
- [x] Alumnos: archivar/restaurar gestionados y borrado duro con confirmacion, tombstone, barrera, cola y purga transaccional.
- [x] `switchActiveAthlete`: `loadMemory()` post-commit pasa a best-effort (bug real corregido, no solo refactor).
- [x] Lock de concurrencia para switch/creacion de atleta, movido a singleton de modulo tras encontrar que un `useRef` no sobrevive al remount de un switch exitoso.
- [x] Smoke de Playwright extendido (no-destructivo por defecto, destructivo detras de `--apply`, gate `E2E_EXPECT_COACH_WORKSPACE`).
- [x] `CoachRosterPage` retirada; ruta `/coach` apunta a `CoachWorkspacePage`.
- [x] Aplicar `015_session_templates.sql` y desplegar Biblioteca/Planificacion.
- [ ] Ejecutar smoke autenticado/multi-dispositivo.
- [x] Fix de tooling: `vitest`/`eslint` excluyen `.claude/worktrees/` (encontrado durante el cierre de esta pieza).
- [x] Documentacion del gap conocido de `CoachContextBar` sin lock compartido en el plan (no bloqueante).
- [ ] Decidir alcance del Asistente IA dentro del Workspace.

No entra todavía:

- señales computadas cross-atleta (check-in gaps, readiness agregado, sesiones vencidas).
- contenido real del Asistente IA.
- semanas plantilla y edicion rica de drills/bloques dentro de Biblioteca.
- lock de concurrencia compartido con `CoachContextBar` (gap de UX, no de integridad).

## Sprint Recomendado - Proximos 2-3 Dias Para Cerrar Riesgo Legal Y Lanzar Piloto

### Dia 1 - Revision Juridica Formal

- Contactar abogado para revision de `/terms`, `/privacy`, `/health-disclaimer`, descargo Whoop.
- Puntos criticos: datos biometricos, consentimiento, no diagnostico, politica cancelacion/reembolso.
- Obtencion de firma y versionado de terminos.
- Estimado: 2-3 dias abogado, no 2-3 horas; paralelizar con siguiente.

### Consentimiento In-App Y Biometrico — CERRADO 2026-08-03

- [x] Gate separable para terminos, privacidad y salud en la app autenticada.
- [x] Descargo biometrico explícito antes de conectar/procesar Whoop.
- [x] Version y timestamp de servidor registrados en `user_consents`.
- [x] Persistencia e hidratación remota verificadas en producción.
- [x] Tests de rechazo, aceptacion, conflicto idempotente, offline y version bump.

### Dia 2-3 - Preparacion Piloto (Paralelo A Abogado)

- QA: generar 3 planes arquetipo como atletas gestionados (torneo, poco tiempo, recovery).
- Revisar salida coach, copiosa, falta de promesas medicas.
- Preparar oferta piloto: duracion (4 semanas?), precio fundador, soporte incluido (WhatsApp/email), reembolso.
- One-liner final para demo/WhatsApp.
- Candidatos: 1-3 personas conocidas, preferiblemente que usen la app ya (squashistas, runners).
- Definir checklist de revision semanal con coach (PDF de resumen, sintesis de feedback, re-play de plan si es necesario).

### Dia 3 - Lanzamiento Minimo

- Abogado firmó términos.
- Consentimiento in-app + biometrico activo.
- Primer cliente acompanado tiene semana 1 planificada.
- Bundle desplegado en prod sin otros cambios grandes.
- Crear issue de seguimiento para feedback de piloto.

## Camino A Monetizacion

### Nivel 1 - Demo Acompanada

Estado: **listo** (Fase 0 completa).

- [x] Superficie publica multideporte/objetivo semanal.
- [x] Rutas legales publicas.
- [x] Landing `/coaches` con 3 planes.
- [x] Smoke visual DEV/PROD.
- [x] Pitch de 2 frases.

Unico pendiente para cerrar: revision juridica formal antes de enviar links masivamente.

### Nivel 2 - Piloto Manual Pagado (1-3 Clientes Acompanados)

Estado: **viable ahora que `011`/`012` y el consentimiento versionado están activos**; falta revision juridica formal y cierre operacional del piloto.

Pendiente minimo:

- [x] Precio fundador + duracion.
- [x] Terminos/privacidad/descargo linkeados.
- [x] Consentimiento in-app de terminos/privacidad/salud/biometrico activo y auditado.
- [x] Canal de soporte (WhatsApp/email).
- [x] Revision manual de planes (requiere QA deportiva).
- [ ] Politica simple de reembolso/cancelacion.
- [x] Primer cliente real elegido y onboardeado.
- [ ] Proceso de revision semanal establecido.

### Nivel 3 - Coach Premium Operado Por Rafael (Self-Serve Limitado)

Estado: operable internamente con F2-lite 2b + Coach Workspace v0; Whoop readiness y Workout Auto-Complete ya aplicados en prod.

Pendiente minimo:

- [x] Consentimiento biometrico técnico activo y persistido.
- [ ] Aprobación jurídica del tratamiento biométrico antes de entregarlo a terceros.
- [ ] QA de planes arquetipo como gestionados (3-5 planes).
- [ ] Protocolo de revision semanal documentado.
- [ ] Rutas legales y consentimiento general firmados por abogado.
- [ ] Primer piloto con feedback documentado.

### Nivel 4 - Pago Publico Self-Serve (Futuro)

Estado: todavia no (pendiente SP1 dos-lados para mejorar experiencia compartida coach/atleta).

Pendiente minimo:

- Payment flow automatizado.
- Consentimiento in-app versionado y auditado.
- E2E auth/pago/onboarding sin friccion.
- Politica de soporte, cancelacion y reembolso cerrada.
- CI/smoke automatizado para rutas publicas.
- Mejor separacion usuario/coach/atleta si se vende a entrenadores.
- SP1a dos-lados (atletas con login propio + invites coach) o equivalente.

## Backlog De Mejoras De Producto (abierto 2026-07-26)

Surgido de una conversacion de brainstorming con el owner. Son **proyectos
independientes**, cada uno con su propio ciclo spec → plan → implementacion; no
un solo bloque de trabajo. Corren en paralelo al piloto y ninguno lo bloquea.

El orden de abajo es de valor percibido en el uso diario del owner, no de
dificultad.

1. **Chat — gestion de conversaciones.** *(implementado y commiteado, 2026-07-26 —
   `0ec9b31`; esta entrada quedo desactualizada)* Abrir el chat y empezar una
   conversacion nueva, ver las anteriores y retomarlas, via `ConversationDrawer`
   e indice derivado de `chatMessages` sin migracion Dexie. Sigue pendiente el
   smoke autenticado en dev (`docs/superpowers/smokes/2026-07-26-chat-conversations-dev-smoke.md`)
   y el deploy. Ya no es un item de backlog sin empezar.
2. **Plan Builder — velocidad.** Fases 2-4 que la Fase 0 habilito: `effort` /
   `thinking`, modelo, concurrencia y prompt caching (esto ultimo solo despues de
   medir el prefijo real con Token Counting). Es el trabajo **mejor preparado**
   del backlog: instrumento desplegado, metodo escrito y control congelado
   (`6c45885a`) contra el cual comparar. Linea base de produccion: 24.2 s hasta
   la primera semana, 43.9 s un plan de 4 semanas, concurrencia 3.
   **Bloqueado por METODO, no por presupuesto** *(actualizado 2026-08-09)*. El
   control-contra-control que la Fase 2 dejo pedido **ya se corrio** (US$1,7938,
   `docs/superpowers/experiments/plan-builder-noise-floor-2026-08-09/`) y su
   resultado invalida la regla: **dos controles identicos comparados entre si dan
   `RECHAZADA`**, con cinco checks en falla. El ruido pareado por caso va de
   −13,5% a +13,9% en la primera semana y de −12,6% a +26,0% en el plan completo,
   asi que el −10,2%/−13,6% de `low` y el `score.min = −7` de `medium` caen los
   dos dentro del ruido: no eran evidencia. Los tres checks `p90 ≤ 0` de
   reparaciones fallan sobre ruido puro — la Fase 2 los anoto como
   «plausiblemente inalcanzable, no medido» y quedaron medidos.
   **No correr mas variantes bajo esta regla:** el resultado seria
   ininterpretable. Lo pendiente es diseno y no cuesta API — recalibrar barras
   contra el ruido medido, reemplazar los `p90 ≤ 0`, calcular potencia, y decidir
   si el manifiesto sintetico sigue sirviendo, dado que corre a 15,0 s / 20,8 s
   contra 24,2 s / 43,9 s de produccion.
3. **Plan Builder — calidad deportiva.** *(pausado 2026-07-31; la premisa no
   sobrevivio a la revision)* La rotacion coordinada (§16) esta medida y
   aceptada y los roles de partido (§17) estan commiteados; queda desplegar
   ambas.

   El follow-up que este backlog daba por siguiente —ampliar
   `COMPETITION_MATCH_VARIANTS` / `PRACTICE_MATCH_VARIANTS`— **se cierra sin
   implementar**. Se descarto al verificar tres cosas:
   - `repeated_template` es `quality.strength.repeated_template`
     (`qualityReview.ts:538`): mide **accesorios de fuerza** compartidos entre
     semanas de un bloque. Nunca midio squash. La entrada anterior de este
     backlog se lo atribuia a las variantes de partido; era incorrecto.
   - La regla de squash equivalente es `quality.squash.low_drill_variety`
     (`qualityReview.ts:583`), y el smoke de §16 **ya la bajo de 6 planes a 1**.
     El problema que justificaba el proyecto esta mayormente resuelto.
   - Con el partido dedicado pinneado al mejor de 5 (decision del owner,
     2026-07-31), ampliar `PRACTICE_MATCH_VARIANTS` es **incompatible** con
     `resolveSquashMatchRole`: cualquier otro formato deja de ser `standalone`,
     cae en la rama de match no canonico y pierde el partido. Las arrays quedan
     estructuralmente congeladas en una entrada, y el `variantIndex` de
     `applySquashMatchDetails` es maquinaria muerta.

   Si el tema se retoma, el trabajo real no es "mas variantes" sino: borrar esa
   maquinaria muerta, eximir a los drills de partido de `low_drill_variety`
   —mismo razonamiento que ya los eximio de `low_drill_depth`,
   `qualityReview.ts:164`— y, si se busca variedad de verdad, moverla al foco
   tactico de la sesion, no a la identidad del drill. Nada de eso es urgente.

   Sigue abierto y sin revisar: `low_drill_depth` legitimo en sesiones de
   drills (ya no en las de partido, que quedaron eximidas).
4. **Librerias de squash y fisico entendibles de cara al usuario.** Nombres,
   descripciones y agrupacion de drills y ejercicios. Se solapa con el punto 3 en
   lo deportivo, pero es sobre todo contenido y UX. Es lo que mas se nota al
   mostrarle la app a un cliente.

   **Mitad de squash: implementada y commiteada (2026-07-31, `21af7f8`…`b9e3f31`
   — esta entrada quedo desactualizada).** Spec y plan en
   `docs/superpowers/specs/2026-07-31-squash-drill-copy-design.md` y
   (plan retirado, historial en git): 14 nombres y 21
   descripciones de los 43 drills reescritos a lenguaje de jugador (terminologia
   tecnica consistente — `boast`, `drop`, `lob`, `nick`, `tin`, glosada en su
   primer uso; se retiran `RSA`, "chapa" y "game"), sin tocar `category`,
   `focus`, `tags` ni metadata de fase — 15 invariantes congeladas por `id` lo
   garantizan. `aliases` pasa a campo de la definicion para que nombres viejos
   sigan resolviendo en Dexie/plantillas/backups y en el buscador del picker.
   Verificado ahora mismo: `drillLibrary.ts` sin diffs pendientes y las 6 suites
   de test relacionadas (112 tests) en verde. Deuda documentada y explicitamente
   fuera de esta entrega: vocabulario de `focus` partido (`mid_court` vs
   `midcourt`), `category` mal asignada en 6 drills tacticos marcados
   `technical`, y los 3 nombres de partido con literales hardcodeados en 5
   consumidores en vez de centralizados por `id`.

   **Mitad de fisico/fuerza: completa — ver §18, §19 y §20.** Desacople del
   nombre commiteado (`3d480b3`), identidad estable `libraryRef`-first
   commiteada (`afaac17`) y copy de la libreria commiteado en este bloque.
   Los cuatro productores deterministas construyen por `id` y cada nombre
   anterior vive en `aliases` para el contenido legacy sin ref.

   **Estructura de sesion: superseries entregadas (§23, 2026-08-05).** Es lo
   que faltaba para que una sesion de fuerza se lea como la escribe un
   entrenador y no como una lista plana. Cierra tambien la deuda de los
   prefijos `A1/A2`, que el prompt pedia y ningun consumidor interpretaba.
5. **Analisis de entrenamientos con Whoop.** *(commiteado y pusheado en
   `d91e21e`, 2026-08-07; ver §24)* La primera capa ya está cerrada: métricas reales en la
   sesión, residual diario y bloque objetivo de siete días para el coach, sin
   diagnóstico ni ajuste automático. Pendientes: deploy/smoke. **Las zonas de FC
   (`019`) y el resumen en `WeeklyView` también están implementados — ver §25**,
   con sus dos publicaciones legales registradas y no vigentes; queda todo el
   rollout. Detrás quedan solo desnivel y kilojoules.
6. **Chat — latencia y costo.** *(precios cargados 2026-08-09; `018` aplicada
   2026-08-05, ver §22)* `MODEL_PRICES` ya cubre los modelos reales: el mapa de
   produccion quedo confirmado y **el chat corre en `gemini-2.5-flash`, no en
   Claude** — la ruta de mayor volumen era entre 6× y 10× mas barata por token de
   lo que cualquier proyeccion previa asumia. Aparecio de paso un defecto: el
   costo se resolvia solo por modelo, y `week_creator` corre en tier `priority`,
   que cuesta ~1,75× el estandar del mismo `gpt-4.1-mini`; se habria subestimado
   ~75%. `MODEL_PRICES` distingue ahora las dos filas por `serviceTier`, con match
   exacto: un tier sin precio da `null` en vez de caer al estandar.
   **Queda** correr la agregacion sobre una ventana real —una semana de uso
   alcanza— y reportar cobertura en dos dimensiones, filas y tokens, excluyendo
   los nulls. Las filas del 05 al 09 de agosto se quedan en `null` porque el costo
   se calcula al escribir, no al leer.
7. **Flags por plan** (Base / Coach Semanal / Avanzado). Necesarios en cuanto el
   piloto tenga mas de un tier conviviendo.
8. **Pasarela de pago.** Deliberadamente al final. Para 1-3 clientes acompanados,
   cobrar por transferencia y conciliar a mano cuesta menos que integrar y
   mantener un gateway; el piloto ya estaba disenado como cobro manual. Retomar
   cuando exista self-serve real (Nivel 4).

Deuda menor asociada: `OPTIMIZATION_AND_COSTS.md` proyecta costos de la era
Gemini y subestima el Plan Builder en cerca de un orden de magnitud (medido:
~$0.029 por semana generada). Corregirlo antes de fijar el precio del piloto.

Estado ambiguo **resuelto (2026-08-06)**: el cierre de ciclo del Plan Builder
esta implementado. El plan tenia 53 checkboxes sin marcar porque se ejecuto via
PR agentico (#10, mergeado el 2026-07-24) y nadie los tildo; el codigo y sus
tests existen (`closePlanCycle.ts`, `deletePlanCycle.ts`, `CycleHistory.tsx`,
`CycleHistory.test.tsx`). Se puede construir encima. Plan retirado.

## Que Hacer Primero

Orden recomendado (Athlete-Aware Core + Coach F2-lite Parte 2b + Whoop v1/Workout Auto-Complete + Coach Workspace v0 + Fase 0 coaches landing ya en prod):

0. ✅ **Desplegar las tandas pendientes.** Hecho el 2026-08-03: rotacion
   coordinada + roles de partido (`9754f78`), identidad de fuerza (`afaac17`),
   copy de la libreria (`33d585f`) y consentimiento versionado
   (`c451808`…`e59b85f`) viajaron en el mismo bundle. Los roles de squash **no**
   estan medidos —el smoke pagado es anterior—, y con ~US$0,60 de saldo no
   alcanza para re-medir (~US$0,90 por corrida): quedan cubiertos por la suite y
   por la verificacion post-deploy del item 2.
1. ✅ **Activar y smokear el consentimiento.** Cerrado el 2026-08-03: `017`
   aplicada, ambas flags encendidas, tres documentos generales + Whoop
   persistidos con las versiones vigentes, y reingreso desde incógnito resuelto
   por hidratación remota sin reaceptación en ~0,2 s. La mejora visual queda
   como backlog posterior; el comportamiento observado es correcto.
2. **Cerrar Whoop auto-sync + detalle de workouts:** deploy y ejecutar
   `docs/superpowers/smokes/2026-08-07-whoop-workout-detail-smoke.md`.
   El mismo recorrido valida frescura, UI, residual, payload del coach y scope
   gestionado sin abrir OAuth ni agregar migraciones.
3. **Verificacion operativa de las tandas de motor:** generar un plan real y
   revisar la fila de job/attempts, mirando
   `squashFinisherPreservedCount` / `squashStandaloneMatchCount` contra lo
   esperado, y de paso confirmar que los nombres nuevos de la libreria de fuerza
   aparecen en la UI sin romper sesiones/plantillas viejas (que resuelven por
   `aliases`). **Aprovechar la misma sesion real para los seis pasos de
   verificacion de superseries (§23)**, que no cuestan API y comparten setup.
4. **Smoke autenticado de Biblioteca y Planificacion** (pendiente §11 desde el
   deploy de `015`): es la deuda de verificacion mas vieja del proyecto y sale
   casi gratis si ya hay una sesion real abierta para el item 3.
5. **Revision juridica formal y retención** (2-3 dias abogado, paralelizar con
   items 2-3): firma de terminos/privacidad/descargos/políticas Whoop y decisión
   sobre `user_consents` al borrar cuenta. El rollout técnico ya no está pendiente.
6. **QA deportiva y preparacion piloto** (1-2 dias): generar 3 planes arquetipo como atletas gestionados, revisar salida coach, preparar oferta (duracion, precio, soporte, reembolso).
7. **Primer cliente acompanado** (ejecutar en paralelo con abogado): elegir 1 candidato, onboarding 1:1, generar semana 1, iniciar protocolo de revision semanal.

**Siguiente bloque de desarrollo recomendado, después del smoke:** Whoop
Entrega 3 — **zonas de frecuencia cardíaca por workout** (§24). Es la extensión
con mejor continuidad de producto: agrega distribución de intensidad útil en
running y squash, reutiliza las superficies recién construidas y mejora el
contexto objetivo sin tocar las reglas de coaching. No empezar por el schema:
primero auditar payloads reales y cerrar el contrato de `zone_durations`; luego
escribir spec/plan para `019` —sin migración Dexie—, incluyendo sync,
export/import, borrado, estados no `SCORED`, UI y costo de prompt. El plan debe
llevar como gate de rollout dos publicaciones nuevas, Whoop biométrica y
Privacidad, revisadas jurídicamente y activadas antes de sincronizar zonas en
producción.

Esto no cambia el gate comercial: lo que separa el producto de cobrarle a
alguien sigue siendo legal y operacional. Si se prioriza salida a piloto sobre
producto Whoop, el mejor uso del tiempo continúa siendo el smoke autenticado de
Biblioteca/Planificacion y la política de cancelación/reembolso + one-liner de
oferta en `/coaches`.

## Que No Hacer Ahora

- No abrir beta publica.
- No activar pagos automaticos todavia.
- No construir SP1/two-sided si la prioridad sigue siendo uso real del owner y cierre comercial/legal.
- No vender Whoop como diagnostico, prevencion de lesiones o ajuste automatico.
- No usar strain/workout de Whoop para autollenar `Session.actualRpe`.
- No auto-completar sesiones de atletas gestionados desde Whoop v1.
- No prometer prevencion de lesiones ni mejoras porcentuales.
- No vender "IA ilimitada" como valor central.
- No invitar 10+ personas antes del primer piloto acompanado.
- No exponer datos biometricos sin consentimiento y borrado completo.
- No construir todavía el Asistente IA ni semanas plantilla/edición rica de drills; Planificacion y Biblioteca ya tienen alcance v1 definido y deben validarse primero con el piloto.

## Veredicto

RallyIQ ya tiene producto suficiente para operar entrenamiento real y varios atletas gestionados desde la cuenta del owner. Whoop v1 y Workout Auto-Complete ya no son ideas pendientes: estan aplicados en produccion y operativos de punta a punta. Coach Workspace v0 suma un roster mejorado y navegacion honesta hacia lo que falta construir. Fase 0 de coaches landing (rutas legales + landing `/coaches` + deep links nativos) ya esta en vivo, reduciendo la zona gris tecnica.

El cambio principal desde hace dos dias es que los bloqueantes técnicos principales ya se cerraron, incluido el consentimiento general y biométrico activo en producción. Lo que falta es operacional y legal: revisión formal de términos y retención de evidencia, y el primer cliente real validando flujo comercial/operacional.

Mi recomendacion: **cerrar revisión jurídica y retención YA** (en paralelo al smoke de Biblioteca/Planificación) + QA deportiva de planes arquetipo + primer cliente acompañado. La UI del consentimiento puede pulirse después con evidencia de uso; SP1a dos-lados y contenido real del Asistente IA quedan como incrementos posteriores al piloto, no son bloqueantes.

Nota tactica que no cambia esta recomendacion: la Entrega 4 de fuerza (§19)
quedo commiteada por separado, revisada y verde. El copy visible de los
ejercicios de fuerza quedo revisado y commiteado por separado en este bloque.

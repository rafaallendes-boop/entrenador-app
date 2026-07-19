# RallyIQ - Project Review and Roadmap

Actualizado: 2026-07-19

Base de contraste:

- `main` con el commit de esta entrega (`feat: complete coach planning library and calendar hardening`).
- **`011_whoop_integration.sql` y `012_whoop_workouts.sql` aplicados en produccion.** Whoop readiness y Workout Auto-Complete quedan operativos de punta a punta (owner confirma cierre operacional); pendiente solo el linkeo de consentimiento biometrico/legal antes de exponer a terceros (ver Riesgo 1).
- **Coach Workspace v0 + ampliacion implementados (2026-07-13 a 2026-07-19):** `/coach` pasa de un roster unico (`CoachRosterPage`) a `CoachWorkspacePage` con Resumen, Alumnos, Planificacion y Biblioteca operativas; Asistente IA conserva el placeholder. Incluye endurecimiento de `switchActiveAthlete`, edicion multi-atleta, alta/aplicacion de plantillas y lock de concurrencia a nivel de modulo. `015` y el bundle de Biblioteca/Planificacion ya fueron aplicados en produccion; queda el smoke autenticado.
- **Gestion de roster + Planificacion read-only implementadas (2026-07-14):** Alumnos agrega archivar/restaurar y borrado duro confirmado por nombre. El borrado usa tombstones por intento, barrera y tracking single-tab, delete remoto durable, supresion de cola y purga Dexie transaccional para impedir resurrecciones. Planificacion muestra la semana de cualquier atleta del roster mediante lecturas/hidratacion por `athleteId` explicito, sin cambiar el scope activo. `015` y el deploy de Biblioteca ya estan en produccion; resta el smoke autenticado.
- **Coach Biblioteca + Planificacion completa desplegadas (2026-07-18/19):** edicion de sesiones, Biblioteca de plantillas account-scoped, aplicar/guardar plantillas para cualquier atleta/dia, Dexie v18, backup v4 y sync Supabase por fila con LWW/delete-wins y tombstones versionados. `015_session_templates.sql` fue aplicada y el bundle desplegado; falta el smoke autenticado en produccion.
- **Hardening de fechas y semanas (2026-07-19):** conteos de semanas, ventanas de Plan Builder, insights de fatiga y filtros semanales usan dias calendario en vez de milisegundos para no fallar al cruzar DST. Se agrego serializacion JSON canonica para comparar estructuras sin reescrituras redundantes.
- **Fase 0 de coaches landing completada (2026-07-13):** rutas públicas reales (no AuthGate fallbacks), las cuatro páginas legales publicadas como rutas (`/terms`, `/privacy`, `/health-disclaimer`, y disclamer Whoop), landing `/coaches` en modo prelanzamiento con estructura de 3 planes, metadata/OG cards por ruta con prerender para crawlers, deep links nativos para OAuth callback en iOS, y cierre de compartimiento entre rutas públicas. Falta aún revisión jurídica y RUT/domicilio legal antes de cobro o anuncios masivos.
- `main` hasta `167ef6e Plan whoop y entrenador`.
- `007` aplicado y F2 data prereqs en `6e33926`.
- `008a` ya fue corrido en produccion con 0 nulls / 0 duplicados reportados.
- `008b` fue aplicado en produccion despues del deploy del write path; `008a` volvio a reportar 0 duplicados/null debt operativo.
- Athlete-Aware Core desplegado y smokeado en produccion: single-athlete no cambio.
- **Coach UI F2-lite Parte 2b desplegada en produccion (2026-07-05):** switcher + roster `/coach` + onboarding athlete-aware, gated por `VITE_COACH_ACCOUNTS`. Migracion `010a/b/c` (day/week full unique expand->contract) aplicada; `008a`/`010a` post-deploy en 0. Smoke self + gestionado OK.
- Superficie publica actualizada para demo multideporte: Landing/Features/Pricing limpian residuos visibles de version/localidad, reducen sesgo squash-only y Pricing queda en 3 planes: Base gratis, Coach Semanal y Avanzado con Plan Builder.
- **Polish de uso real implementado (2026-07-06):** la nota/lectura semanal del coach queda disponible solo desde viernes-domingo y completar todos los ejercicios de una sesion marca automaticamente la sesion como realizada.
- **WHOOP v1 implementado, commiteado y aplicado en produccion (2026-07-08/10, `011` cerrado 2026-07-13):** integracion end-to-end en `main` (`c8aa5f8`, `14b7056`, `5293e6c`): `011_whoop_integration.sql`, Dexie v15 `readinessDaily`, OAuth start/callback/status con state single-use, tokens AES-256-GCM, sync manual/on-demand con cooldown, cron dedicado, `ReadinessCard`, `WhoopConnection`, prefill de check-in gateado (hoy+self+atleta), contexto pasivo del coach, borrado completo service-role, export/backup y wipe local. Cierre de review previo: lint + 1160 tests + build + typecheck. Pendiente unicamente el gate legal/consentimiento biometrico antes de terceros.
- **WHOOP Esfuerzo (2026-07-08) implementado:** `dayLog.rpeActual` se mantiene como storage pero la UI/copy lo relabela a "Esfuerzo"; Whoop strain lo prellena con `clamp(round(strain / 2.1), 1, 10)`, editable, y no se usa para sembrar `Session.actualRpe` ni inflar ACWR/carga.
- **Resumen semanal/coach note corregido (2026-07-10):** snapshot de nota semanal, freshness check y tests evitan reusar notas obsoletas cuando cambia el resumen.
- **SP1a dos-lados planificado (2026-07-09/10):** spec endurecido con D1-D6 y plan de implementacion creado (`docs/superpowers/plans/2026-07-09-sp1a-two-sided-foundation.md`), pero aun sin codigo/migraciones aplicadas.
- **Whoop Workout Auto-Complete implementado (2026-07-10):** `012_whoop_workouts.sql`, Dexie v16, scope `read:workout`, reconciliacion autoritativa server/client, matcher self-only serializado con idempotencia durable, badge y lifecycle completo. SP1a queda reservado para `013+`/Dexie v17+. Pendiente operacional: aplicar `012`, deploy, reconectar Whoop y smoke.

## Resumen Ejecutivo

RallyIQ esta en una etapa donde el core ya no es el cuello de botella principal. El motor de planificacion, Plan Builder async, calidad deportiva base, athlete scope foundation, claves naturales locales por atleta, write path remoto seguro para day/week, Athlete-Aware Core, Coach F2-lite Parte 2b, Whoop v1 + Workout Auto-Complete (ambas migraciones aplicadas), Coach Workspace con roster/Planificacion/Biblioteca, y Fase 0 de coaches landing (rutas legales publicas + landing `/coaches` de prelanzamiento) ya estan construidos. Biblioteca y Planificacion tienen `015` y deploy aplicados; queda cerrar el smoke autenticado.

Lo que queda antes de mostrar/cobrar con confianza se concentra en dos carriles:

1. **Cierre legal completo:** consentimiento biometrico explicito de Whoop + revision juridica formal + RUT/domicilio legal antes de cobro/anuncios masivos.
2. **QA deportiva y operacional:** planes arquetipo como atletas gestionados, protocolo de revision semanal, canales de soporte, y primer piloto acompanado (1-3 clientes).

Carriles de producto que siguen abiertos pero ya no bloquean la oferta comercial:

3. **Coach Workspace ampliado:** gestion de roster, edicion de Planificacion y Biblioteca de plantillas estan desplegadas con `015`; falta smokearlas de punta a punta. Asistente IA sigue como "proximamente".
4. **SP1 dos-lados:** membresias/RLS v2 ya planificadas para `013+`/Dexie v17+, pero es un incremento futuro de acceso, no bloqueante para la oferta coach de una sola cuenta.

Mi lectura como lider tecnico: el cambio principal entre hoy y hace dos dias es que las rutas legales publicas ya existen como rutas reales, no como ideas. Eso permite cobrar sin zona gris innecesaria si se cierra la revision juridica rapido. El cuello actual es revision juridica formal + primer cliente real para validar flujo comercial/operacional.

## Estado Actual En Una Frase

RallyIQ ya opera multi-atleta en produccion, con Whoop readiness y Workout Auto-Complete operativos (`011`/`012` aplicados), Coach Workspace base (`/coach`) y rutas legales publicas + landing `/coaches` en vivo. `015` y Biblioteca/Planificacion ya estan desplegadas; el siguiente paso tecnico es ejecutar el smoke autenticado, incluyendo el catalogo/picker tras este push. En paralelo siguen pendientes revision juridica formal y consentimiento biometrico de Whoop antes del primer piloto pagado.

## Porcentaje De Avance

Estimacion actual:

- Demo acompanada: **99% listo / 1% pendiente** (rutas legales publicas ya vivas; pendiente solo revision juridica formal).
- Piloto manual pagado 1-3 clientes: **93% listo / 7% pendiente** (Fase 0 completa; pendiente consentimiento biometrico Whoop + operaciones piloto).
- Coach UI F2-lite MVP interno: **99% listo / 1% pendiente** (roster, edicion de Planificacion y Biblioteca desplegados con `015`; pendiente smoke autenticado y Asistente IA futura).
- Coach dos-lados/SP1: **25% listo / 75% pendiente** (especificado y planificado, pero no urgente frente al piloto de una sola cuenta).
- Monetizacion publica self-serve: **62% listo / 38% pendiente** (rutas legales + landing coach vivas; falta pagos automaticos, consentimiento in-app, e2e auth).

Traduccion practica: el producto ya tiene sustancia y superficie legal/comercial minima. Lo pendiente es reducir riesgo juridico formal (revision de abogado) y riesgo operacional (primer cliente real).

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

Estado: **`011` aplicado en produccion, deploy y smoke operativo confirmados por el owner.** Pendiente unicamente linkear el gate legal/consentimiento biometrico antes de exponer Whoop a terceros — no bloquea el uso del owner.

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

Estado: **deployado en produccion.** Migracion/schema: ninguna (no toca Supabase ni Dexie). Plan completo: `docs/superpowers/plans/2026-07-11-coach-workspace-v0.md`.

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

Estado: **Fase 0 desplegada en produccion.** Plan completo: `docs/superpowers/plans/2026-07-13-coaches-landing-fase0.md`. Tests de UI agregados para `LegalPageLayout` y `SharedPublicNav`. No toca Supabase ni Dexie.

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

Estado: **desplegado en produccion con `015_session_templates.sql` aplicada.** Falta smoke autenticado; Dexie migra v17 → v18 al abrir la app. Planes/spec: `docs/superpowers/plans/2026-07-14-coach-roster-management-y-planificacion.md`, `docs/superpowers/specs/2026-07-14-coach-roster-management-y-planificacion-design.md`, `docs/superpowers/plans/2026-07-17-coach-biblioteca-plantillas.md` y `docs/superpowers/specs/2026-07-17-coach-biblioteca-plantillas-design.md`.

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
- Biblioteca/plantillas: pruebas dirigidas de serializer, Dexie, CRUD, sync, backup y UI OK; `npm run lint` + `npm run build` OK.

## Riesgos Que Siguen Vivos

### 1. WHOOP ya agrega dato sensible: falta cerrar consentimiento (operacion ya cerrada)

Whoop es el track de producto con mas retorno inmediato, e introduce datos biometricos,
OAuth externo, tokens cifrados y borrado completo. La operacion tecnica ya cerro (`011`/`012`
aplicados, deploy y smoke confirmados por el owner). Lo que falta antes de exponerlo a terceros:

- consentimiento biometrico explicito;
- politica de privacidad/terminos actualizados;
- rutas o UI que expliquen desconexion + borrado remoto/local.

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

Estado: **`011` aplicado, deploy confirmado, smoke conectar -> sync -> ReadinessCard -> prefill -> desconectar/borrar hecho por el owner.** Falta unicamente consentimiento biometrico formalizado antes de exponer a terceros (revision juridica).

### Opcion B - Whoop Workout Auto-Complete — CERRADA

Objetivo: que entrenamientos registrados por Whoop completen sesiones planificadas self-only sin intervencion manual.

Estado: **`012` aplicado, Whoop reconectado con `read:workout`, smoke auto-complete confirmado por el owner.**

### Opcion C - Piloto manual pagado (1-3 clientes) — RECOMENDADO AHORA

Objetivo: mostrar y cobrar antes, validando flujo comercial/operacional con cliente real.

Orden:

1. ✅ Rutas legales publicas (Fase 0 completa).
2. ⏳ Revision juridica formal (en curso).
3. ⏳ Consentimiento biometrico in-app (proxima semana).
4. ⏳ QA de 3 planes arquetipo como atletas gestionados.
5. ⏳ Oferta piloto cerrada (1-2 semanas, precio, soporte, reembolso).
6. ⏳ Primer cliente acompanado elegido y onboardeado.

Ventaja: aprende con cliente real, valida operaciones (revision semanal, feedback), cierra riesgos legales en vivo.

Riesgo minimo ahora que Whoop y Coach Workspace ya estan en prod.

### Opcion D - SP1a dos-lados (futuro)

Objetivo: atletas con login propio + coach compartiendo el mismo perfil, membresias/RLS v2.

Estado: especificado y planificado (plan completo: `docs/superpowers/plans/2026-07-09-sp1a-two-sided-foundation.md`), pero deliberadamente despues de Piloto C (Opcion A+B+C primero). SP1a es un incremento de acceso relevante, no bloqueante para la oferta inicial de "coach 1:1 con tus atletas gestionados".

### Recomendacion

Ejecutar **Opcion C (Piloto manual) + Opcion A consentimiento biometrico YA**. Opcion B (Workout Auto-Complete) ya esta operativa, no requiere trabajo adicional. Opcion D (SP1a dos-lados) espera hasta post-piloto cuando se entienda mejor si el siguiente cliente sera alguien que quiera compartir con su coach o sera el owner/coach usando mas atletas propios.

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
- [ ] Agregar consentimiento de terminos/privacidad/descargo/IA en signup u onboarding (UI checkbox/modal).
- [ ] Agregar consentimiento biometrico antes de conectar Whoop para terceros (en WhoopConnection).
- [ ] Registrar version y fecha de consentimiento (tabla DB si es necesario).
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
- [ ] Linkear `descargo-whoop.md` + consentimiento biometrico antes de exponer a terceros.
- [ ] Re-correr smoke despues del primer refresh real para confirmar refresh token/scopes.

### J. WHOOP Workout Auto-Complete

Objetivo: usar workouts detectados por Whoop para completar sesiones planificadas del atleta self, sin crear sesiones nuevas ni tocar RPE de carga.

Estado: **implementado y con rollout operativo cerrado**.

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

No entra todavia:

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

### Dia 1-2 - Consentimiento In-App Y Biometrico

- Agregar checkbox/modal de consentimiento de terminos/privacidad/descargo/IA en signup u onboarding.
- Agregar descargo biometrico explícito antes de conectar Whoop (en WhoopConnection).
- Registrar version y fecha de consentimiento en DB.
- Tests: flow de rechazo, aceptacion, version bump.

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

Estado: **viable ahora que `011`/`012` estan cerrados y Fase 0 esta en vivo**; falta revision juridica formal y consentimiento biometrico.

Pendiente minimo:

- [x] Precio fundador + duracion.
- [x] Terminos/privacidad/descargo linkeados.
- [ ] Consentimiento in-app de terminos/privacidad/biometrico.
- [x] Canal de soporte (WhatsApp/email).
- [x] Revision manual de planes (requiere QA deportiva).
- [ ] Politica simple de reembolso/cancelacion.
- [x] Primer cliente real elegido y onboardeado.
- [ ] Proceso de revision semanal establecido.

### Nivel 3 - Coach Premium Operado Por Rafael (Self-Serve Limitado)

Estado: operable internamente con F2-lite 2b + Coach Workspace v0; Whoop readiness y Workout Auto-Complete ya aplicados en prod.

Pendiente minimo:

- [ ] Consentimiento biometrico formalizado si se entrega a terceros.
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

## Que Hacer Primero

Orden recomendado (Athlete-Aware Core + Coach F2-lite Parte 2b + Whoop v1/Workout Auto-Complete + Coach Workspace v0 + Fase 0 coaches landing ya en prod):

1. **Revision juridica formal** (2-3 dias abogado, paralelizar con items 2-3): firma de terminos/privacidad/descargos/políticas Whoop.
2. **Consentimiento in-app + biometrico** (1-2 dias implementacion): checkbox en signup, descargo antes de Whoop connect, registrar version/fecha.
3. **QA deportiva y preparacion piloto** (1-2 dias): generar 3 planes arquetipo como atletas gestionados, revisar salida coach, preparar oferta (duracion, precio, soporte, reembolso).
4. **Primer cliente acompanado** (ejecutar en paralelo con abogado): elegir 1 candidato, onboarding 1:1, generar semana 1, iniciar protocolo de revision semanal.

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

El cambio principal desde hace dos dias es que el bloqueante tecnico principales ya se cerraron. Lo que falta es operacional y legal: revision formal de terminos (con abogado), consentimiento in-app biometrico, y el primer cliente real validando flujo comercial/operacional.

Mi recomendacion: **iniciar revision juridica formal YA** (paralelo a items 2-3) + consentimiento biometrico en-app + QA deportiva de planes arquetipo + primer cliente acompanado. SP1a dos-lados y contenido real de Planificacion/Biblioteca quedan como incrementos posteriores al piloto, no son bloqueantes.

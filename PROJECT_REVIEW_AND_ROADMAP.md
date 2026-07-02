# RallyIQ - Project Review and Roadmap

Actualizado: 2026-07-01

Base de contraste:

- Commits recientes en `main` hasta `6e33926 feat: add athlete-scoped day and week data prereqs`.
- Estado actual del repo al 2026-07-01.
- Resultado reportado de `supabase/008a_athlete_scope_preflight.sql`: 0 nulls y 0 duplicados legacy en `day_logs` / `week_summaries`.

## Resumen Ejecutivo

RallyIQ ya esta en una etapa distinta a la del roadmap anterior. El core deportivo, Plan Builder async, calidad de semanas, landing inicial, borradores legales y la base de datos para `athlete_id` ya avanzaron bastante. Lo mas importante del ultimo bloque es que se cerro un riesgo invisible pero critico para F2: `day_logs` y `week_summaries` ya no dependen de fecha sola como clave natural local, sino de `(athleteId, fecha)`.

Lectura como lider tecnico: la app esta cerca de poder mostrarse en piloto acompanado. No esta lista para pago publico self-serve, pero si puede acercarse a monetizacion manual con 1-3 clientes fundadores despues de cerrar superficie publica, rutas legales, smoke real y protocolo de soporte/revision.

La mayor parte de lo que falta ya no es "motor". Es confianza comercial: copy consistente, links legales reales, onboarding/consentimiento, soporte, smoke de produccion y revision humana de los primeros planes.

## Estado Actual En Una Frase

RallyIQ esta suficientemente avanzado para preparar demos y pilotos controlados, pero aun necesita un cierre de presentacion, legal y operacion antes de cobrar fuera del circulo cercano.

## Porcentaje De Avance

Mi estimacion actual:

- Para mostrar la app en demo/piloto acompanado: 85% listo / 15% pendiente.
- Para cobrar un piloto manual a 1-3 clientes fundadores: 72% listo / 28% pendiente.
- Para monetizacion publica self-serve: 50% listo / 50% pendiente.

Traduccion practica: no falta construir otro producto. Falta cerrar el envoltorio de confianza y probar el flujo real end-to-end con gente.

## Avances Ya Implementados

### Producto Publico Y Marca

- Marca publica operativa: `RallyIQ` (`src/constants/contact.ts`).
- Landing principal reorientada a squash competitivo, torneo, taper, carga, match play y preparacion fisica.
- Pricing movido hacia piloto/fundador y CLP, aunque todavia conserva textos legacy que hay que limpiar.
- Contact email centralizado: `CONTACT_EMAIL = 'hola@rallyiq.cl'`.
- Se elimino prueba social inventada de la landing y se reemplazo por criterios del sistema.

### Legal Y Confianza

- Borradores legales creados en `docs/legal/`:
  - `terminos-y-condiciones.md`.
  - `politica-de-privacidad.md`.
  - `descargo-de-salud.md`.
- Textos alineados a piloto Chile/persona natural y billing diferido.
- Falta convertir esos documentos en rutas publicas reales dentro de la app.

### Plan Builder Y Calidad Deportiva

- Plan Builder async operativo con rate limit local y reservas de uso.
- Mejoras de taper/race week, double sessions, squash priority, match play y reparacion de semanas.
- Tests de Plan Builder, double sessions, repair, rate limits, active generation y calidad deportiva.
- Copys internos del coach humanizados en parte (`5d8ecda`), reduciendo referencias tecnicas crudas en sesiones.
- Sigue pendiente una revision deportiva manual de planes arquetipo antes del primer piloto pagado.

### Athlete Scope Y Seguridad De Datos

- `007_athlete_scope.sql` implementado:
  - tabla `athletes`.
  - backfill por usuario.
  - `athlete_id` agregado/backfilled en tablas relevantes.
  - RLS transicional de lectura por atleta.
- Foundation endurecida:
  - hidratacion de atleta activo.
  - read scope.
  - tests de migracion/scope.
  - dry-run script.
- F2 data prerequisites implementado (`6e33926`):
  - Dexie v14.
  - `dayLogs` con unico compuesto `[athleteId+date]`.
  - `weekSummaries` con unico compuesto `[athleteId+weekStartDate]`.
  - lookups athlete-aware.
  - merge/sync/import/export seguro por clave natural scoped.
  - tests con `fake-indexeddb`.
  - `008a_athlete_scope_preflight.sql` report-only.
- Preflight reportado por usuario: 0 nulls y 0 duplicados en day/week. Esto es una muy buena senal.

### Verificacion Tecnica Reciente

- Ultima verificacion del bloque F2: `npm run lint`, `npm test`, `npm run build` pasaron.
- Suite al cierre de ese bloque: 134 archivos / 934 tests.

## Lo Que Ya No Deberia Figurar Como Pendiente

- Definir una marca publica operativa: ya es `RallyIQ`.
- Crear borradores legales base: ya existen en `docs/legal`.
- Preparar foundation de `athlete_id`: ya esta en `007`.
- Resolver la clave natural local de day/week para multi-atleta: ya esta en Dexie v14.
- Crear preflight report-only para day/week: ya esta en `008a`.
- Confirmar que prod no tiene deuda visible de null/duplicados day/week: el usuario ya corrio el preflight y dio 0.

## Riesgos Que Siguen Vivos

### 1. Superficie publica con residuos legacy y friccion de conversion

La superficie publica ya esta mas cerca, pero todavia mezcla promesa premium con senales de producto interno: versiones visibles, CTAs de cuenta gratis/trial, copy tecnico (`PWA/local-first`, `analytics`) y links sin destino real. Eso no rompe la app, pero si baja confianza antes de cobrar.

Nota de revision front: `lanzamiento` no aparece como texto literal en el codigo revisado; no es un problema por si mismo. Solo conviene evitar claims temporales si se vuelven permanentes o si prometen una ventana comercial que no existe.

Archivos relevantes:

- `src/pages/FeaturesPage.tsx`.
- `src/pages/PricingPage.tsx`.
- `src/components/SharedPublicNav.tsx`.
- `src/pages/LandingPage.tsx` footer.

### 2. Legal existe como docs, no como experiencia publica

Los documentos legales ya existen, pero no hay rutas publicas como `/terms`, `/privacy` o `/health-disclaimer`. `AuthGate` hoy solo expone publicamente landing, features y pricing.

Esto bloquea cobro serio y tambien dificulta enviar links claros en invitaciones.

### 3. Consentimiento todavia no esta cerrado en producto

Falta registrar aceptacion de terminos, privacidad, descargo de salud y uso de IA antes de crear cuenta o antes del primer plan.

Para piloto manual se puede compensar temporalmente con aceptacion externa/documentada, pero para escalar debe vivir en app.

### 4. 008b sigue gated

`008a` esta OK y es seguro. `008b` no debe aplicarse todavia.

Antes de un indice unico parcial remoto en `(athlete_id, date)` y `(athlete_id, week_start_date)`, hay que cambiar el write path remoto:

- `upsertRow` no puede depender de PK `id` cuando hay clave natural duplicable por import/sync.
- `migrateLocalDataToCloud` debe abandonar `onConflict: 'user_id,date'` / `user_id,week_start_date`.
- La resolucion remota debe ser natural-key-safe con `select -> update` o estrategia equivalente, legacy-null-aware.
- Smoke posterior: crear/editar day log y week summary sin `23505`.

Este gate no bloquea mostrar la app ni pilotos manuales pequenos. Si bloquea endurecer integridad remota para escala.

### 5. No hay todavia operacion comercial completa

Faltan soporte, cancelacion/reembolso, proceso de pago manual, mensaje de invitacion, protocolo de revision semanal y canal claro de feedback.

## Checklist Actualizado Para Mostrar Y Monetizar

### A. Oferta Y Posicionamiento

Objetivo: que una persona entienda en 10 segundos para quien es y por que pedir acceso.

- [x] Marca publica operativa: `RallyIQ`.
- [x] Nicho inicial: squash competitivo.
- [x] Landing principal con foco squash/torneo/carga.
- [ ] One-liner final para sitio, WhatsApp y demo.
- [ ] Oferta piloto cerrada: duracion, cupos, precio fundador, soporte incluido.
- [ ] CTA unico en toda la superficie publica: recomendado `Solicitar cupo piloto` o `Agendar evaluacion`.
- [ ] Mensaje corto para invitar a los primeros 3 jugadores.
- [ ] Definir que no incluye el piloto: urgencias medicas, diagnostico, garantia de resultado, supervision presencial.

### B. Superficie Publica

Objetivo: confianza antes que explicacion tecnica.

- [x] Landing reorientada a squash competitivo.
- [x] Pricing parcialmente orientado a piloto/fundador.
- [x] Email y marca centralizados.
- [ ] Reescribir el hero/KPIs de `FeaturesPage`: hoy todavia lee como feature grid tecnico (`sistema cerrado`, `analytics`, `PWA/local-first`) mas que como preparacion para squash competitivo.
- [ ] Hacer grep final de labels de version/localidad (`v2.4`, `v1.0`, `BUENOS AIRES`, `HECHO EN CHILE`). Como criterio front, la version publica visible no aporta confianza; la localidad solo mantenerla si es parte deliberada de marca.
- [ ] Alinear CTAs con el funnel real: si el piloto sera manual, cambiar `Empezar gratis`, `Crear cuenta gratis` y trial copy hacia `Solicitar cupo piloto` / `Agendar evaluacion`; si habra trial real, documentar ese flujo.
- [ ] Eliminar `href="#"` de pricing/features/landing footer; cada link debe navegar o no mostrarse.
- [ ] Conectar footer a rutas legales reales.
- [ ] Agregar seccion corta "Para quien es".
- [ ] Agregar seccion corta "Que no es".
- [ ] Agregar 2-4 screenshots reales o mockups honestos de la app.
- [x] No hay texto literal `lanzamiento` detectado en la superficie publica revisada; no requiere cambio salvo que vuelva como claim temporal.
- [ ] Smoke DEV de `/`, `/features`, `/pricing` y rutas legales.
- [ ] Smoke PROD/deploy de las mismas rutas.

### C. Legal, Confianza Y Seguridad

Objetivo: poder enviar links y cobrar sin zona gris innecesaria.

- [x] Borrador de terminos.
- [x] Borrador de politica de privacidad.
- [x] Borrador de descargo de salud.
- [ ] Crear ruta publica `/terms`.
- [ ] Crear ruta publica `/privacy`.
- [ ] Crear ruta publica `/health-disclaimer`.
- [ ] Linkear las rutas desde landing, pricing, features y signup/login.
- [ ] Agregar consentimiento de terminos/privacidad/descargo/IA en signup u onboarding.
- [ ] Registrar version y fecha de consentimiento.
- [ ] Agregar politica simple de cancelacion/reembolso para piloto manual.
- [ ] Validar textos con abogado antes de pago publico o anuncios masivos.

### D. Plan Builder Y Calidad Deportiva

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

### E. Datos, Sync Y Athlete Scope

Objetivo: cero perdida de datos y base lista para F2.

- [x] Athlete scope foundation (`007`).
- [x] Backfill de `athlete_id` en tablas relevantes.
- [x] Dexie v14 con clave natural compuesta en day/week.
- [x] Lookups day/week athlete-aware.
- [x] Merge/sync/import/export day/week por scope efectivo.
- [x] `008a` preflight report-only.
- [x] Preflight ejecutado con 0 nulls / 0 duplicados reportados por el usuario.
- [ ] Cambiar write path remoto day/week para ser natural-key-safe.
- [ ] Re-ejecutar `008a` justo antes de 008b.
- [ ] Aplicar `008b` solo cuando el gate remoto este cerrado.
- [ ] Smoke post-008b: day log + week summary create/edit sin `23505`.
- [ ] F2 real mas adelante: `coach_athlete_links`, `account_type`, roster, switcher, permisos de coach.

### F. UI De Atleta

Objetivo: que el atleta no sienta que esta usando una consola de QA.

- [x] Debug de quality gated en prod por test (`planBuilderDetech.test.tsx`).
- [ ] Revisar labels visibles de Plan Builder V2.
- [ ] `Plan Builder` -> `Crear plan` o `Plan competitivo` en UI cliente.
- [ ] `Quality review` -> interno/admin; cliente ve `Revision del plan`.
- [ ] `needs_review` -> `Requiere revision del coach`.
- [ ] `Regenerar semana` -> `Mejorar semana` o `Ajustar semana`.
- [ ] Ocultar controles debug para usuario normal.
- [ ] Mejorar empty states y errores con lenguaje humano.
- [ ] Revisar onboarding para datos deportivos reales: torneo, disponibilidad, molestias, historial, fuerza/1RM, acceso a cancha y partner.

### G. Operacion De Piloto Premium

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

Metricas de exito del primer piloto:

- [ ] El cliente entiende su semana sin explicacion extra.
- [ ] Registra al menos 4 dias de 7.
- [ ] 0 perdida de datos.
- [ ] 0 planes con issues criticos.
- [ ] Menos de 2 momentos de confusion fuerte por semana.
- [ ] Feedback cualitativo: "esto me ordena" o "esto me ayuda a llegar mejor".

## Sprint Recomendado - 5 Dias Para Mostrar

### Dia 1 - Cierre Publico

- Reescribir `FeaturesPage`.
- Limpiar `PricingPage`.
- Limpiar `SharedPublicNav`.
- Remover versiones visibles innecesarias, CTAs inconsistentes y links muertos.

### Dia 2 - Legal En App

- Crear `/terms`, `/privacy`, `/health-disclaimer`.
- Reutilizar `docs/legal` como fuente.
- Linkear desde footer, pricing y signup/login.
- Agregar politica simple de cancelacion/reembolso del piloto.

### Dia 3 - Smoke Real

- Smoke DEV y PROD:
  - landing.
  - features.
  - pricing.
  - legal.
  - signup/login.
  - crear plan.
  - crear check-in.
  - chat/proposal basico.
  - export/backup.
  - sync desktop/mobile minimo.

### Dia 4 - QA Deportiva

- Generar 3 planes arquetipo.
- Revisarlos como coach/preparador.
- Guardar export/backup.
- Ajustar los warnings que afecten confianza.

### Dia 5 - Primer Piloto

- Enviar invitacion a 1 cliente acompanado.
- Hacer onboarding 1:1.
- Entregar plan revisado.
- Observar uso durante 7 dias sin abrir beta amplia.

## Camino A Monetizacion

### Nivel 1 - Demo Acompanada

Estado: casi listo.

Pendiente minimo:

- Limpiar superficie publica.
- Agregar rutas legales.
- Smoke deploy.
- Tener un pitch de 2 frases.

### Nivel 2 - Piloto Manual Pagado

Estado: viable despues del sprint de 5 dias.

Pendiente minimo:

- Precio fundador.
- Terminos/privacidad/descargo linkeados.
- Consentimiento o aceptacion documentada.
- Canal de soporte.
- Revision manual de los primeros planes.
- Proceso simple de pago externo/manual.

### Nivel 3 - Pago Publico Self-Serve

Estado: todavia no.

Pendiente minimo:

- Payment flow.
- Consentimiento in-app versionado.
- E2E auth/pago/onboarding.
- Politica de soporte y reembolso cerrada.
- CI/smoke automatizado.
- 008b remoto aplicado despues del gate.
- Mejor separacion usuario/coach/atleta si se vende a entrenadores.

## Que Hacer Primero

Orden recomendado:

1. Public surface cleanup: Features, Pricing, Nav, Footer.
2. Legal routes publicas y links reales.
3. Smoke DEV/PROD completo.
4. Tres planes arquetipo con revision manual.
5. Invitacion a 1 cliente acompanado.
6. Solo despues, definir cobro fundador para 1-3 pilotos.

## Que No Hacer Ahora

- No abrir beta publica.
- No activar pagos automaticos todavia.
- No aplicar `008b` hasta cerrar el write path remoto.
- No prometer prevencion de lesiones ni mejoras porcentuales.
- No vender "IA ilimitada" como valor central.
- No invitar 10+ personas antes del primer piloto acompanado.
- No agregar features grandes antes de cerrar confianza publica/legal.

## Veredicto

RallyIQ ya no esta lejos por falta de producto. Esta cerca, pero la siguiente milla es de confianza: que un atleta vea una marca clara, entienda la promesa, tenga links legales, pueda pedir acceso, entre sin friccion, genere un plan revisado y sienta que hay alguien responsable detras.

Si se ejecuta el sprint de 5 dias, mi recomendacion seria pasar a primer piloto acompanado. Para monetizacion manual, apuntaria a estar listo despues de ese primer piloto si el flujo no muestra fallos de datos, confusion fuerte ni planes con issues criticos.

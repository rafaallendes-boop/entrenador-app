# RallyIQ - Project Review and Roadmap

Actualizado: 2026-07-03

Base de contraste:

- `main` hasta `8f3c721 Prepare athlete scope 008b rollout and coach F2 plan`, mas el commit actual de Athlete-Aware Core.
- `007` aplicado y F2 data prereqs en `6e33926`.
- `008a` ya fue corrido en produccion con 0 nulls / 0 duplicados reportados.
- `008b` fue aplicado en produccion despues del deploy del write path; `008a` volvio a reportar 0 duplicados/null debt operativo.
- Athlete-Aware Core esta implementado localmente: scoping de lecturas, seleccion activa, chat session por atleta y estampado local. Falta deploy + smoke.
- Coach UI F2-lite tiene spec aprobado conceptualmente en `docs/superpowers/specs/2026-07-02-coach-ui-f2-mvp-design.md`; todavia no esta implementado.
- Superficie publica actualizada para demo multideporte: Landing/Features/Pricing limpian residuos visibles de version/localidad, reducen sesgo squash-only y Pricing queda en 3 planes: Base gratis, Coach Semanal y Avanzado con Plan Builder.

## Resumen Ejecutivo

RallyIQ esta en una etapa donde el core ya no es el cuello de botella principal. El motor de planificacion, Plan Builder async, calidad deportiva base, athlete scope foundation, claves naturales locales por atleta, write path remoto seguro para day/week y Athlete-Aware Core ya estan construidos.

Lo que queda antes de mostrar/cobrar con confianza se divide en tres carriles:

1. **Cierre operacional de core:** desplegar Athlete-Aware Core y smoke real en produccion.
2. **Cierre comercial/legal:** superficie publica, rutas legales, consentimiento, soporte y oferta piloto.
3. **Coach/F2-lite Parte 2:** perfiles multi-atleta, `009`, API de gestionados y roster/switcher.

Mi lectura como lider tecnico: ya se puede preparar demo y piloto acompanado. No esta listo para self-serve publico. Para cobrar manualmente a 1-3 fundadores, falta menos producto que operacion y confianza.

## Estado Actual En Una Frase

RallyIQ esta cerca de un piloto manual serio; el proximo paso no deberia ser abrir beta, sino desplegar/smokear Athlete-Aware Core, limpiar confianza publica/legal y decidir si F2-lite Parte 2 entra antes o despues del primer piloto acompanado.

## Porcentaje De Avance

Estimacion actual:

- Demo acompanada: **93% listo / 7% pendiente**.
- Piloto manual pagado 1-3 clientes: **82% listo / 18% pendiente**.
- Coach UI F2-lite MVP: **50% listo / 50% pendiente**.
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

### 2. Athlete-Aware Core quedo implementado

Parte 1 del camino F2-lite:

- Holder de self athlete + seleccion activa persistida.
- Politica legacy self-only (`activeScopeFilter`).
- Lecturas de sessions/day logs/week summaries/proposals/contexto IA filtradas por atleta activo.
- Escrituras locales de sessions/chat/proposals estampan `athleteId`.
- Chat session scoped por atleta, incluyendo import/reset global con `clearAllStoredChatSessionIds`.
- `hydrateActiveAthlete` respeta seleccion valida y no la pisa durante sync.
- Tests de rollback/destructivos para `commitPlan`, `applyCreateWeek`, chat mixto y sync legacy.

Estado: **implementado y verificado localmente**. Falta **deploy + smoke single-athlete + smoke con gestionado cuando exista UI**.

### 3. Coach UI F2-lite quedo especificado

Spec aprobado conceptualmente:

- F2-lite no es solo roster/switcher; primero exige lecturas athlete-aware.
- Perfiles dejan de ser singleton y requieren migracion `009`.
- Hidratacion debe respetar seleccion activa.
- Atletas gestionados necesitan API propia y ensure remoto antes de child rows.
- Legacy/unscoped solo se adopta para el self, nunca para gestionados.
- Chat session debe ser athlete-scoped.

Estado: **Parte 1 de datos core implementada**. Falta plan/implementacion Parte 2: perfiles multi-atleta + `009`, API gestionados y UI `/coach`.

### 4. Superficie publica paso a demo multideporte

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

Antes de cerrar Athlete-Aware Core:

- `npm run lint`: OK.
- `git diff --check`: OK.
- `npm test`: OK, 139 archivos / 990 tests.
- `npm run build`: OK.

## Riesgos Que Siguen Vivos

### 1. Athlete-Aware Core aun no esta confirmado en produccion

El codigo esta listo, pero falta la parte operacional:

1. Esperar deploy del commit actual.
2. Confirmar bundle nuevo en prod.
3. Smoke single-athlete:
   - dashboard/semana.
   - crear/editar sesion.
   - check-in/day log.
   - week summary/coach note.
   - chat/proposal.
   - import/export si aplica.
4. Hard refresh y confirmar persistencia/sync.

Esto reemplaza a `008b` como gate inmediato antes de cualquier UI multi-atleta.

### 2. Superficie publica aun necesita cierre legal/visual

La superficie publica principal ya lee mas humana y multideporte, y Pricing ya explica mejor el camino comercial. Lo que falta para cobrar con mas confianza no es otro cambio grande de copy, sino rutas legales reales, consentimiento y screenshots/mockups finales verificados.

### 3. Legal existe como docs, no como experiencia

No hay rutas publicas `/terms`, `/privacy`, `/health-disclaimer`. Tampoco hay consentimiento versionado en app.

### 4. Coach UI F2-lite Parte 2 requiere trabajo real de datos

El core invisible ya esta hecho. Lo pendiente no es una UI superficial; requiere:

- Perfiles por atleta + migracion `009`.
- API de atletas gestionados.
- Roster/switcher.
- Smoke con self + 1 gestionado.

No hay que confundirlo con una UI superficial.

### 5. Operacion comercial todavia no esta cerrada

Faltan soporte, cancelacion/reembolso, precio fundador, mensaje de invitacion, protocolo de revision semanal y canal claro de feedback.

## Decisiones Abiertas Para Desarrollo

### Opcion A - Monetizacion manual primero

Objetivo: mostrar y cobrar antes, con 1 atleta/piloto acompanado.

Orden:

1. Desplegar y smokear Athlete-Aware Core.
2. Limpiar superficie publica.
3. Rutas legales.
4. Consentimiento minimo o aceptacion documentada.
5. QA de 3 planes arquetipo.
6. Primer piloto acompanado.

Ventaja: menor scope tecnico, aprende rapido con cliente real.

Riesgo: operar varios atletas sigue siendo manual/export/1:1.

### Opcion B - Coach UI F2-lite primero

Objetivo: que Rafael opere varios atletas/arquetipos desde la app sin contaminar datos.

Orden:

1. Desplegar y smokear Athlete-Aware Core.
2. Plan de implementacion F2-lite Parte 2 desde el spec aprobado.
3. Perfiles + `009`.
4. API de gestionados.
5. Roster/switcher.
6. Smoke self + 1 gestionado.

Ventaja: mejor herramienta interna para piloto premium y QA de arquetipos.

Riesgo: demora el momento de mostrar/cobrar si se vuelve mas grande que el MVP.

### Recomendacion

Si la prioridad es **monetizar pronto**, elegir Opcion A.

Si la prioridad es **operar bien 3-5 atletas desde tu cuenta**, elegir Opcion B, pero mantener F2-lite estrictamente acotado.

Mi recomendacion actual: **desplegar/smokear Athlete-Aware Core, hacer smoke visual de la nueva superficie publica y cerrar rutas legales/consentimiento antes de F2-lite Parte 2**, salvo que la operacion de arquetipos se vuelva dolorosa ya.

## Checklist Actualizado Para Mostrar Y Monetizar

### A. Gate Inmediato: Athlete-Aware Core

Objetivo: confirmar en produccion que el core athlete-aware no altera la experiencia single-athlete actual.

- [x] Write path remoto natural-key-safe commiteado.
- [x] `008b_athlete_scope_unique.sql` commiteado.
- [x] `008b` aplicado en produccion.
- [x] `008a` post-008b en 0.
- [x] Athlete-Aware Core implementado.
- [ ] Confirmar deploy del commit actual.
- [ ] Hard refresh / confirmar bundle nuevo en prod.
- [ ] Smoke post-deploy:
  - [ ] dashboard y semana cargan igual.
  - [ ] crear/editar sesion.
  - [ ] crear/editar day log.
  - [ ] crear/editar week summary o coach note semanal.
  - [ ] chat/proposal basico.
  - [ ] hard refresh y confirmar persistencia.
  - [ ] re-correr `008a` y confirmar duplicados en 0.

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

Estado: spec aprobado. Parte 1 invisible (`Athlete-Aware Core`) implementada; Parte 2 visible pendiente.

Gates:

- [x] `008b` aplicado.
- [x] Auditoria/scoping de lecturas core.
- [x] Seleccion activa selection-aware.
- [x] Chat session athlete-scoped.
- [x] Escrituras locales estampan atleta activo.
- [ ] Deploy + smoke de Athlete-Aware Core.
- [ ] Crear plan de implementacion Parte 2 desde `2026-07-02-coach-ui-f2-mvp-design.md`.
- [x] Perfiles por atleta + push/merge por grupo implementados localmente.
- [x] API local de atletas gestionados implementada.
- [x] Backup/import preserva roster `athletes` y eventos enriquecidos.
- [x] `009` expand/contract listo; `009c` endurece `athlete_id not null`.
- [ ] Aplicar `009a`/`009b`/`009c` en produccion con bundle nuevo confirmado.
- [ ] Switcher y roster `/coach`.
- [ ] Smoke con self + 1 gestionado.

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

## Sprint Recomendado - 5 Dias Para Mostrar

### Dia 0 - Gate De Datos

- Confirmar deploy del commit Athlete-Aware Core.
- Hard refresh y confirmar bundle nuevo.
- Smoke dashboard/semana/sesiones/day log/week summary/chat.
- Re-correr `008a` y confirmar duplicados en 0.

### Dia 1 - Cierre Publico

- [x] Reescribir `FeaturesPage` hacia preparacion deportiva/multideporte.
- [x] Limpiar `PricingPage` y dejar 3 planes: Base, Coach Semanal, Avanzado.
- [x] Limpiar `SharedPublicNav`.
- [x] Remover versiones visibles, localidad inconsistente y links muertos principales.
- [ ] Smoke visual DEV de `/`, `/features`, `/pricing`.
- [ ] Ajustar copy final segun captura/screenshot.

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
- Ajustar warnings que afecten confianza.

### Dia 5 - Primer Piloto

- Enviar invitacion a 1 cliente acompanado.
- Hacer onboarding 1:1.
- Entregar plan revisado.
- Observar uso durante 7 dias sin abrir beta amplia.

## Camino A Monetizacion

### Nivel 1 - Demo Acompanada

Estado: casi listo.

Pendiente minimo:

- Desplegar/smokear Athlete-Aware Core.
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

Estado: prometedor, pero necesita F2-lite.

Pendiente minimo:

- Deploy/smoke de Athlete-Aware Core.
- Coach UI F2-lite Parte 2.
- `009` perfiles.
- Roster/switcher.
- Protocolo de revision semanal.

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

Orden recomendado:

1. Desplegar y smokear Athlete-Aware Core.
2. Smoke visual DEV de superficie publica actualizada: `/`, `/features`, `/pricing`.
3. Crear rutas legales publicas y linkear footers reales.
4. Smoke PROD completo.
5. Generar 3 planes arquetipo con revision manual.
6. Elegir: primer piloto acompanado o F2-lite.

## Que No Hacer Ahora

- No abrir beta publica.
- No activar pagos automaticos todavia.
- No construir Coach UI F2-lite Parte 2 antes de smokear Athlete-Aware Core en prod.
- No prometer prevencion de lesiones ni mejoras porcentuales.
- No vender "IA ilimitada" como valor central.
- No invitar 10+ personas antes del primer piloto acompanado.
- No agregar features grandes antes de cerrar confianza publica/legal, salvo que elijas deliberadamente F2-lite como herramienta interna.

## Veredicto

RallyIQ ya tiene producto suficiente para empezar a buscar senales reales con una demo acompanada. El siguiente cuello de botella es confianza: que el atleta entienda la promesa, vea una superficie seria, tenga links legales, pueda pedir acceso, genere un plan revisado y no pierda datos.

Mi recomendacion: desplegar/smokear Athlete-Aware Core, hacer el sprint de confianza publica/legal y luego decidir entre primer piloto acompanado o F2-lite Parte 2. Si el objetivo es monetizar antes, piloto primero. Si el objetivo es operar multiples atletas desde tu cuenta sin contaminar datos, F2-lite primero.

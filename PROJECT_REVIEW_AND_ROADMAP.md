# Entrenador App - Review and Roadmap

Actualizado: 2026-06-21

## Resumen Ejecutivo

Entrenador/RallyIQ ya no se siente como un experimento tecnico temprano. El motor de planificacion, el flujo async de Plan Builder, la reparacion de semanas, el soporte de squash/fuerza y el sistema de export/backup estan lo suficientemente avanzados para cambiar de etapa.

La recomendacion ahora es pasar de "beta interna tecnica" a "preparacion para clientes premium en piloto cerrado". No significa abrir pago publico todavia. Significa preparar la experiencia completa que un atleta real va a ver: landing clara, promesa creible, UI menos tecnica, terminos/privacidad, disclaimers de salud, soporte, onboarding y un protocolo de revision de calidad antes de invitar clientes.

El producto debe sentirse como un entrenador digital premium para squash competitivo, con fuerza y recuperacion integradas. La app no deberia hablar como software de IA; deberia hablar como un sistema de preparacion: carga, pista, fuerza, molestias, torneo, revision semanal y decisiones simples.

## Avances Implementados Al 2026-06-21

Desde el corte anterior ya se avanzaron puntos importantes de producto, calidad deportiva y preparacion para clientes:

- Superficie publica:
  - Landing principal reescrita hacia squash competitivo, torneo, taper, carga, preparacion fisica y RallyIQ AI.
  - Se elimino la prueba social ficticia/testimonial inventado y se reemplazo por un componente de criterios del sistema: match play 3-4 dias antes, ultimo dia de activacion, fuerza con transferencia y carga unificada.
  - Se corrigio el nav publico mobile que podia mostrar links desktop por un `display` inline.
  - Pricing ya esta orientado a piloto cerrado/fundador, no a pago publico masivo.
- Plan Builder y calidad deportiva:
  - Double sessions ahora se validan y reparan respetando los dias configurados.
  - El generador utiliza dobles de forma mas estrategica cuando el atleta los permite.
  - Semana taper/race queda mas protegida: menos carga accesoria, strength cap, running/cycling muy limitados y movilidad/recovery preservados.
  - Match play fuerte se empuja a 3-4 dias antes del evento; el ultimo dia se orienta a activacion/control.
  - Se agregaron tests para double sessions, taper load cap, reparacion de semanas y coherencia de Plan Builder.
- Rate limit del Plan Builder async:
  - Se agrego preflight local antes de encolar generaciones remotas.
  - La app reserva consumo por semana al iniciar background generation.
  - Si el enqueue falla definitivamente, libera la reserva.
  - Cuando polling recibe semanas generadas, sincroniza la reserva con el `traceId` real del worker para que Settings refleje el consumo.
- Validacion tecnica reciente:
  - `npm test` completo paso con 122 archivos y 854 tests.
  - `npm run lint` paso.
  - `npm run build` paso.

Lectura actual: el producto ya puede moverse a preparacion de piloto cerrado, pero aun falta cerrar confianza publica, legal, lenguaje de cliente y smoke real en entorno DEV/PROD.

## Cambio De Etapa

Estado anterior:

- Beta interna enfocada en robustez tecnica.
- Validacion local de tests, build, prompts y flujos async.
- Preguntas abiertas sobre debug vs feature visible.

Estado recomendado ahora:

- Piloto premium cerrado en preparacion.
- Mantener QA tecnico, pero mover el foco a confianza del cliente.
- Preparar una primera oferta comercial controlada, sin paywall publico todavia.
- Revisar cada plan generado como lo haria un entrenador antes de mostrarlo como producto.

La pregunta principal deja de ser "puede generar un plan?" y pasa a ser:

"Un jugador de squash pagaria y confiaria en esto despues de verlo 5 minutos?"

## Evidencia Del Corte 2026-06-20

Se revisaron los exports locales mencionados en este corte:

- `entrenador-athlete-profile-2026-06-20T20-47-06-212Z.json`
- `entrenador-backup-2026-06-20T20-47-16-931Z.json`

Senales positivas:

- Existe backup completo con tablas de sesiones, semanas, planes, chat, proposals y perfil.
- Hay un plan activo llamado `Plan Torneo nacional`.
- El plan fue generado por background job y aceptado.
- `generationSummary.completedWeeks`: 5/5.
- `generationSummary.failedWeeks`: 0.
- Duracion de generacion: ~132 s.
- Quality review global: score 77, `needs_review`, sin issues criticos.
- Backup con 23 sesiones:
  - 15 squash.
  - 4 fuerza.
  - 3 running.
  - 1 movilidad.
- Perfil con referencias 1RM para squat, deadlift, bench press y overhead press.

Senales que piden revision de entrenador antes de cliente:

- Warning de salto de carga entre semanas 1 y 2.
- Warning de baja variedad de drills en un bloque build.
- Warning de squash etiquetado como match-play cuando los bloques no eran partido completo.
- Varias semanas requirieron reparaciones automaticas altas.

Lectura premium: esto es bueno. No es un bloqueo; es exactamente el tipo de cola de revision que deberia existir antes de entregar un plan de alto rendimiento. Para cliente final, esos warnings no deben aparecer como lenguaje tecnico. Para entrenador/admin, son el checklist de control.

## Lectura Como Coach De Squash Y Preparador Fisico

La propuesta con mas fuerza no es "app de IA para entrenar". Eso suena generico y facil de desconfiar.

La propuesta mas premium es:

> Preparacion inteligente para jugadores de squash que compiten: plan de torneo, carga semanal, fuerza especifica, recuperacion y ajustes segun como llega el cuerpo.

Pilares deportivos:

- Squash primero: desplazamientos, cambios de direccion, repeticion de rallies, aceleracion/frenado, tolerancia a puntos largos y toma de decision bajo fatiga.
- Fuerza con transferencia: tren inferior, core anti-rotacion, potencia, estabilidad unilateral, hombro/escapula y tolerancia de tejidos.
- Carga controlada: no sumar running/fuerza porque si; todo debe justificar su transferencia o su rol aerobico/recuperativo.
- Taper entendible: menos ruido en la semana final, mas frescura, activacion, velocidad y confianza.
- Feedback diario: sueno, dolor, fatiga y disponibilidad deben modificar el plan sin dramatismo.

Regla de producto:

RallyIQ puede generar y proponer. El entrenador premium revisa, filtra y entrega. En piloto, esa supervision humana es parte del valor.

## Posicionamiento Recomendado

Nombre publico:

- Elegir una identidad principal: `RallyIQ` o `Entrenador`.
- Hoy la app mezcla ambos. Para clientes, la marca visible deberia ser una sola.
- Recomendacion: usar `RallyIQ` como producto y `Entrenador App` como nombre interno/repo.

Cliente inicial:

- Jugador de squash amateur competitivo.
- Tiene torneo, liga, ranking, club o meta concreta.
- Entrena 3-6 dias/semana.
- Necesita ordenar squash, fuerza, running/movilidad y recuperacion.
- No quiere planillas ni explicaciones tecnicas largas.

Oferta piloto:

- Plan de preparacion de 4 a 8 semanas.
- Onboarding inicial con perfil, disponibilidad, historial de lesiones y objetivo.
- Plan semanal en app.
- Check-in diario corto.
- Ajustes con RallyIQ.
- Revision semanal premium por entrenador durante el piloto.
- Export/backup disponible.

CTA recomendado para esta etapa:

- "Solicitar cupo piloto".
- "Agendar evaluacion".
- "Preparar mi proximo torneo".

Evitar por ahora:

- "Empezar gratis" como CTA principal si no hay flujo comercial completo.
- "IA ilimitada 24/7" como promesa central.
- Claims de mejora porcentual sin evidencia real.
- Lenguaje como provider, local-first, schema, background, quality score, regeneration.

## Diagnostico De Superficie Publica

Paginas existentes:

- `src/pages/LandingPage.tsx`
- `src/pages/FeaturesPage.tsx`
- `src/pages/PricingPage.tsx`
- `src/components/SharedPublicNav.tsx`

Estado actual:

- Landing principal: actualizada hacia squash competitivo y promesa premium creible.
- Pricing: orientado a piloto cerrado/fundador, aunque todavia necesita pulir footer, terminos y algunos textos legacy.
- Features: todavia demasiado generica/tech; mantiene `v2.4`, PWA/local-first y narrativa multideporte como foco principal.
- SharedPublicNav: corregido el comportamiento mobile.
- Footer publico: todavia tiene links muertos o textos legacy en algunas paginas.

Lo que ya mejoro:

- La landing ya no vende "app de IA generica"; vende preparacion para squash competitivo.
- Se removio prueba social falsa/testimonial inventado.
- El hero y las secciones principales hablan de torneo, taper, match play, carga y preparacion fisica.
- El pricing ya no empuja pago publico abierto como primer paso.

Lo que sigue pendiente para clientes:

- Reescribir `FeaturesPage` con el mismo foco de squash competitivo.
- Remover versiones/lanzamientos (`v2.4`, "BUENOS AIRES", claims temporales) de features/pricing/footer.
- Crear rutas reales para `Privacidad`, `Terminos` y disclaimer medico/deportivo.
- Conectar todos los footers a rutas reales; eliminar links `href="#"`.
- Hacer smoke de `/`, `/features`, `/pricing` en DEV/PROD y revisar cache/service worker si el navegador muestra pantalla negra.
- Revisar copy de pricing para que no prometa resultados, prevencion de lesiones ni mejoras porcentuales.

Nueva direccion de copy:

- Menos "sistema cerrado, PWA, AI, analytics".
- Mas "llega fresco al torneo, ordena la semana, ajusta carga, entrena fuerza con sentido, registra molestias, revisa decisiones".
- El usuario debe entender el beneficio antes de entender la tecnologia.

## UI Menos Tecnica

Objetivo: que la app se sienta como una herramienta de atleta, no como consola de QA.

Cambios recomendados:

- `Plan Builder` -> `Crear plan`.
- `Quality review` -> interno/admin; si se muestra al usuario, usar `Revision del plan`.
- `needs_review` -> `Requiere revision del coach`.
- `Regenerar semana` -> `Mejorar semana` o `Ajustar semana`.
- `Reparar semanas marcadas` -> oculto para cliente o mover a modo entrenador.
- `Beta quality` -> solo Settings interno/admin.
- `Taper` -> `puesta a punto` en UI de cliente.
- `Background generation`/`polling` -> nunca visible para cliente.
- `Fallback` -> nunca visible para cliente.

Principio:

El usuario no debe sentir que esta evaluando una IA. Debe sentir que tiene una semana clara, revisable y adaptable.

## Legal, Confianza Y Seguridad

Antes de cobrar o invitar fuera del circulo cercano, crear al menos estas paginas:

- Terminos y condiciones.
- Politica de privacidad.
- Disclaimer medico/deportivo.
- Politica de cancelacion/reembolsos, aunque el piloto sea manual.
- Consentimiento de uso de IA y limites del servicio.

Contenido minimo:

- RallyIQ no reemplaza evaluacion medica, kinesiologica ni urgencias.
- El usuario debe detener entrenamiento ante dolor agudo, mareos, sintomas neurologicos, dolor toracico o lesion.
- La app entrega planificacion y recomendaciones generales/personalizadas por datos declarados, no diagnostico medico.
- Datos que se guardan: perfil, sesiones, check-ins, chat/proposals, planes y backups.
- Explicar login, sincronizacion, exportacion y eliminacion de datos.
- Explicar que respuestas de IA pueden ser revisadas/mejoradas y no son garantia de resultado competitivo.
- Incluir contacto de soporte.

Nota operativa: antes de pago publico, revisar estos textos con abogado segun mercado objetivo. Para Chile/LatAm, cuidar tratamiento de datos personales y claims de salud/rendimiento.

## Roadmap Cliente - Checklist Maestro Junio/Julio 2026

### A. Oferta Y Posicionamiento

Objetivo: una promesa clara y premium para el primer nicho.

- [ ] Definir marca publica final: `RallyIQ` como producto, `Entrenador App` como interno/repo.
- [x] Definir nicho inicial: squash competitivo.
- [x] Reorientar la landing principal a squash competitivo.
- [ ] Escribir one-liner final para sitio, pitch y WhatsApp.
- [ ] Definir oferta piloto: duracion, cupos, soporte incluido y si sera gratis, fundador o pagado manualmente.
- [ ] Definir CTA principal unico: `Solicitar cupo piloto`, `Agendar evaluacion` o `Preparar mi proximo torneo`.
- [ ] Definir que incluye y que no incluye el piloto.
- [ ] Preparar mensaje corto para invitar a los primeros 3 jugadores.

Resultado esperado: una persona entiende en 10 segundos para quien es, que resuelve y que debe hacer.

### B. Superficie Publica

Objetivo: convertir interes en solicitud de piloto, no explicar arquitectura.

- [x] Reescribir hero con foco squash/torneo.
- [x] Agregar narrativa de taper, match play, carga y preparacion fisica.
- [x] Remover testimonial/prueba social falsa de la landing.
- [x] Agregar componente honesto de criterios del sistema.
- [x] Corregir nav publico mobile.
- [x] Actualizar pricing hacia piloto cerrado/fundador.
- [ ] Reescribir `FeaturesPage` con foco squash competitivo.
- [ ] Remover `v2.4`, "lanzamiento", "BUENOS AIRES" y textos temporales de paginas publicas.
- [ ] Cambiar CTAs publicos inconsistentes (`Empezar gratis`) hacia piloto/evaluacion donde corresponda.
- [ ] Agregar seccion "Para quien es".
- [ ] Agregar seccion "Que no es".
- [ ] Agregar screenshots reales o mockups basados en pantallas actuales de la app.
- [ ] Conectar footer a rutas reales de privacidad/terminos/disclaimer.
- [ ] Eliminar links muertos `href="#"`.
- [ ] Smoke manual de `/`, `/features`, `/pricing` en DEV.
- [ ] Smoke manual de `/`, `/features`, `/pricing` en deploy/PROD.
- [ ] Si aparece pantalla negra en DEV, limpiar service worker/cache y documentar el fix.

### C. Legal, Confianza Y Seguridad

Objetivo: poder invitar clientes sin links rotos ni zona gris legal.

- [ ] Crear ruta `/terms`.
- [ ] Crear ruta `/privacy`.
- [ ] Crear ruta `/health-disclaimer` o integrar disclaimer claro en terminos.
- [ ] Agregar consentimiento de uso de IA y limites del servicio.
- [ ] Agregar consentimiento medico/deportivo en onboarding o signup.
- [ ] Explicar datos guardados: perfil, sesiones, check-ins, chat/proposals, planes y backups.
- [ ] Explicar exportacion/eliminacion de datos.
- [ ] Agregar contacto de soporte.
- [ ] Revisar textos con abogado antes de cobro publico.
- [ ] Verificar que pricing y landing no prometan prevencion de lesiones ni mejoras de rendimiento no demostradas.

### D. Plan Builder Y Calidad Deportiva

Objetivo: que los planes piloto sean confiables antes de entregarlos.

- [x] Validar double sessions solo en dias configurados.
- [x] Reparar/utilizar double sessions de forma estrategica cuando estan habilitadas.
- [x] Proteger taper/race contra exceso de carga accesoria.
- [x] Limitar strength en taper para preservar frescura.
- [x] Empujar match play fuerte a 3-4 dias antes del evento.
- [x] Orientar ultimo dia a activacion/control.
- [x] Agregar tests para double sessions, taper y reparacion.
- [x] Implementar rate limit visible para Plan Builder async.
- [ ] Generar 3 planes arquetipo y revisarlos como entrenador.
- [ ] Guardar export/backup de cada plan arquetipo.
- [ ] Crear checklist manual de revision por plan dentro de docs o admin.
- [ ] Reducir warnings de variedad de drills en bloques build/peak.
- [ ] Revisar que fuerza no repita plantillas clonadas semana a semana.
- [ ] Verificar uso de 1RM cuando existe.
- [ ] Confirmar que running/ciclismo aparezcan solo si aportan al objetivo.
- [ ] Confirmar que todas las sesiones sean entendibles sin leer contexto tecnico.

Arquetipos obligatorios:

- [ ] Torneo en 4 semanas.
- [ ] Jugador con 3 dias disponibles.
- [ ] Jugador con 5-6 dias y doble sesion ocasional.
- [ ] Retorno con molestia de rodilla/tobillo/hombro.
- [ ] Semana con poco sueno y match cercano.

### E. UI De Atleta

Objetivo: reducir friccion y bajar lenguaje tecnico dentro de la app.

- [ ] Revisar labels de Plan Builder V2.
- [ ] `Plan Builder` -> `Crear plan` o `Plan competitivo` en UI cliente.
- [ ] `Quality review` -> interno/admin; cliente ve `Revision del plan`.
- [ ] `needs_review` -> `Requiere revision del coach`.
- [ ] `Regenerar semana` -> `Mejorar semana` o `Ajustar semana`.
- [ ] Ocultar controles debug para usuario normal.
- [ ] Mantener herramientas de calidad en modo entrenador/admin.
- [ ] Convertir warnings tecnicos en estados accionables:
  - [ ] `Revisar carga`.
  - [ ] `Ajustar variedad`.
  - [ ] `Confirmar objetivo de la semana`.
- [ ] Mejorar empty states y errores con lenguaje humano.
- [ ] Revisar onboarding para datos deportivos reales:
  - [ ] torneo/fecha.
  - [ ] disponibilidad.
  - [ ] molestias.
  - [ ] historial de entrenamiento.
  - [ ] fuerza/1RM si existe.
  - [ ] acceso a cancha.
  - [ ] sesiones con partner.

### F. Operacion De Piloto Premium

Objetivo: aprender con pocos clientes sin romper confianza.

- [ ] Invitar 1 cliente acompanado primero.
- [ ] Luego invitar maximo 3 clientes iniciales.
- [ ] Onboarding 1:1 de 20-30 min.
- [ ] Revisar manualmente el primer plan antes de entregarlo.
- [ ] Pedir check-in diario durante 7 dias.
- [ ] Hacer review semanal breve.
- [ ] Tener canal de soporte claro.
- [ ] Registrar feedback por categoria:
  - [ ] plan deportivo.
  - [ ] claridad UI.
  - [ ] confianza.
  - [ ] fallos tecnicos.
  - [ ] sync/datos.
  - [ ] pricing/oferta.

Metricas de exito:

- [ ] Cliente entiende su semana sin explicacion extra.
- [ ] Cliente registra al menos 4 dias de 7.
- [ ] 0 perdida de datos.
- [ ] 0 planes con criticos.
- [ ] Menos de 2 momentos de confusion fuerte por cliente/semana.
- [ ] Feedback cualitativo: "esto me ordena" o "esto me ayuda a llegar mejor".

## Pendientes Tecnicos Que Siguen Importando

Estos puntos no deben bloquear la preparacion comercial, pero si bloquean apertura amplia:

- [x] Rate limit local visible para Plan Builder async.
- [x] Tests unitarios/store para rate limit async.
- [x] Tests completos recientes pasando.
- [ ] Renovar auth E2E.
- [ ] Correr E2E reales con login vigente.
- [ ] Correr smoke DEV de rutas publicas:
  - [ ] `/`.
  - [ ] `/features`.
  - [ ] `/pricing`.
  - [ ] limpiar service worker/cache si aparece pantalla negra.
- [ ] Correr smoke prod controlado.
- [ ] Verificar Netlify background function con Supabase real.
- [ ] Confirmar que background generation escribe `jobId`, heartbeat y estado terminal.
- [ ] Validar sync desktop/mobile:
  - [ ] crear sesion en desktop, verla en mobile.
  - [ ] completar sesion en mobile, verla en desktop.
  - [ ] aceptar proposal en un dispositivo y converger en el otro.
  - [ ] delete/tombstone no reaparece.
- [ ] Revisar `.env` prod:
  - [ ] `VITE_AI_PROVIDER=proxy`.
  - [ ] sin keys privadas en `VITE_*`.
  - [ ] funciones server-side configuradas.
- [ ] Fijar runtime Node/npm para Netlify/local.
- [ ] Agregar CI minima o checklist automatizado antes de deploy.
- [ ] Confirmar schema Supabase real y migraciones necesarias.

## Sprint Recomendado - 7 Dias

### Dia 1 - Cierre De Oferta

- Cerrar nombre publico.
- Escribir one-liner final.
- Definir cupos piloto, soporte incluido y CTA unico.
- Escribir mensaje de invitacion para primer jugador.

### Dias 2-3 - Features, Pricing Y Footer

- Reescribir `FeaturesPage` hacia squash competitivo.
- Pulir `PricingPage` para piloto fundador sin textos legacy.
- Remover `v2.4`, `BUENOS AIRES` y links muertos.
- Agregar links reales o placeholders seguros hacia legal.
- Smoke DEV de `/`, `/features`, `/pricing`.

### Dia 4 - Legal Y Confianza

- Crear rutas de terminos, privacidad y disclaimer.
- Agregar footer links reales.
- Agregar copy de limites del servicio.
- Preparar version para revision legal.

### Dia 5 - UI De Cliente

- Renombrar labels tecnicos.
- Ocultar debug.
- Convertir acciones de regeneracion en lenguaje de atleta/coach.
- Revisar onboarding y estados vacios.

### Dia 6 - QA Deportiva

- Generar/revisar 3 planes arquetipo.
- Guardar export Beta Quality/backup por plan.
- Crear checklist manual de revision de entrenador.
- Corregir warnings que afecten confianza.

### Dia 7 - Smoke Y Primer Piloto

- Smoke prod o entorno seguro.
- Probar login, plan, semana, chat, export y sync basico.
- Invitar 1 cliente acompanado.
- Observar sin agregar features durante la sesion.

## Que Hacer Primero

Recomendacion inmediata:

1. Reescribir `FeaturesPage` para que deje de sonar a producto tech generico.
2. Pulir `PricingPage` y footers: quitar textos legacy, links muertos y claims no probados.
3. Crear paginas reales de terminos/privacidad/disclaimer.
4. Hacer UI pass para esconder lenguaje tecnico en Plan Builder.
5. Generar 3 planes arquetipo y revisarlos como entrenador.
6. Smoke DEV/PROD de rutas publicas, login, plan, semana, chat, export y sync basico.
7. Invitar solo 1 cliente acompanado cuando el flujo publico no tenga links rotos.

## Que No Hacer Ahora

- No abrir beta publica.
- No activar pagos automaticos sin terminos, privacidad y soporte.
- No prometer prevencion de lesiones ni mejoras porcentuales sin evidencia.
- No mostrar warnings tecnicos crudos a clientes.
- No vender "IA ilimitada" como valor principal.
- No invitar 10+ personas antes del primer piloto acompanado.
- No agregar features grandes antes de corregir la superficie cliente.
- No persistir prompts completos o respuestas largas como telemetria operacional.

## Decision De Producto Sobre Calidad Y Regeneracion

Recomendacion actual:

- La regeneracion debe existir como feature de entrenador/cliente, pero renombrada.
- La calidad tecnica debe quedar interna.
- El cliente puede ver estados simples:
  - `Listo`.
  - `Revisar con coach`.
  - `Ajuste recomendado`.
- El entrenador/admin puede ver:
  - score.
  - issues.
  - repair count.
  - warnings por semana.

Esto conserva confianza. La app se muestra premium hacia afuera y sigue siendo auditable hacia adentro.

## Proximo Paso Inmediato

Empezar por superficie publica pendiente:

- Features enfocada en squash competitivo.
- Pricing y footer sin textos legacy.
- Rutas reales de terminos, privacidad y disclaimer.
- Smoke de rutas publicas para descartar cache/service worker o pantalla negra.

Despues de eso, hacer el pass de UI interna para que Plan Builder y quality review dejen de sonar a herramienta tecnica y empiecen a sonar a experiencia de atleta/coach.

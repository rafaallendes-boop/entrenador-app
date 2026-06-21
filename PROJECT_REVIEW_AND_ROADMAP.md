# Entrenador App - Review and Roadmap

Actualizado: 2026-06-20

## Resumen Ejecutivo

Entrenador/RallyIQ ya no se siente como un experimento tecnico temprano. El motor de planificacion, el flujo async de Plan Builder, la reparacion de semanas, el soporte de squash/fuerza y el sistema de export/backup estan lo suficientemente avanzados para cambiar de etapa.

La recomendacion ahora es pasar de "beta interna tecnica" a "preparacion para clientes premium en piloto cerrado". No significa abrir pago publico todavia. Significa preparar la experiencia completa que un atleta real va a ver: landing clara, promesa creible, UI menos tecnica, terminos/privacidad, disclaimers de salud, soporte, onboarding y un protocolo de revision de calidad antes de invitar clientes.

El producto debe sentirse como un entrenador digital premium para squash competitivo, con fuerza y recuperacion integradas. La app no deberia hablar como software de IA; deberia hablar como un sistema de preparacion: carga, pista, fuerza, molestias, torneo, revision semanal y decisiones simples.

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

Lo bueno:

- Ya hay una identidad visual fuerte.
- Hay landing, features, pricing y nav publica.
- La app transmite energia de producto, no solo prototipo.
- El foco en squash, running, fuerza, movilidad y ciclismo ya esta presente.

Lo que hay que cambiar para clientes:

- La landing habla demasiado como producto tech.
- Aparecen versiones/lanzamientos que pueden quedar obsoletos.
- Hay claims comerciales que necesitan evidencia o suavizado.
- `Privacidad` y `Terminos` aparecen como links de footer, pero todavia no hay rutas/documentos reales.
- Pricing parece mas abierto de lo que conviene para un piloto cerrado.
- El valor premium de squash competitivo todavia no esta en primer plano.

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

## Roadmap Cliente - Junio/Julio 2026

### 1. Oferta Y Posicionamiento

Objetivo: una promesa clara y premium para el primer nicho.

Checklist:

- Definir marca publica principal: RallyIQ vs Entrenador.
- Escribir one-liner de producto.
- Definir nicho inicial: squash competitivo.
- Definir oferta piloto: duracion, cupos, nivel de soporte, precio o invitacion.
- Definir CTA principal: cupo piloto/evaluacion.
- Definir que incluye y que no incluye.

Resultado esperado:

- Una persona entiende en 10 segundos para quien es, que resuelve y que debe hacer.

### 2. Landing Y Paginas Publicas

Objetivo: convertir interes en solicitud de piloto, no explicar arquitectura.

Checklist:

- Reescribir hero con foco squash/torneo.
- Remover `v2.4`, "lanzamiento en abril" y claims temporales.
- Cambiar CTA principal a piloto/evaluacion.
- Agregar seccion "Como funciona" en 3 pasos:
  - Perfil y objetivo.
  - Plan semanal revisado.
  - Check-in y ajustes.
- Agregar seccion "Para quien es".
- Agregar seccion "Que no es".
- Agregar prueba visual real de app o screenshots limpios.
- Actualizar pricing a "piloto fundador" o waitlist.
- Conectar footer a rutas reales de privacidad/terminos.

### 3. UI De Atleta

Objetivo: reducir friccion y bajar lenguaje tecnico dentro de la app.

Checklist:

- Revisar labels de Plan Builder V2.
- Ocultar controles debug para usuario normal.
- Mantener herramientas de calidad en modo entrenador/admin.
- Convertir warnings tecnicos en estados accionables:
  - `Revisar carga`.
  - `Ajustar variedad`.
  - `Confirmar objetivo de la semana`.
- Mejorar empty states y errores con lenguaje humano.
- Revisar onboarding para pedir datos deportivos reales:
  - torneo/fecha.
  - disponibilidad.
  - molestias.
  - historial de entrenamiento.
  - fuerza/1RM si existe.
  - acceso a cancha y sesiones con partner.

### 4. Documentos De Confianza

Objetivo: poder invitar clientes sin links rotos ni zona gris legal.

Checklist:

- Crear `/terms`.
- Crear `/privacy`.
- Crear `/health-disclaimer` o incluirlo claramente en terminos.
- Agregar consentimiento en onboarding o signup.
- Agregar links reales en landing/features/pricing/footer.
- Revisar textos con abogado antes de cobro publico.

### 5. QA Deportiva De Planes

Objetivo: cada plan piloto debe pasar por filtro de entrenador.

Checklist minimo por plan:

- 0 issues criticos.
- Saltos de carga justificados o corregidos.
- Variedad suficiente de drills de squash por bloque.
- Fuerza sin plantillas clonadas semana a semana.
- 1RM usado cuando existe.
- Taper/puesta a punto clara en semana final.
- Running/ciclismo solo si aporta al objetivo.
- Movilidad y recuperacion presentes cuando la carga sube.
- Sesiones comprensibles para el atleta sin leer contexto tecnico.

Arquetipos de prueba:

- Torneo en 4 semanas.
- Jugador con 3 dias disponibles.
- Jugador con 5-6 dias y doble sesion ocasional.
- Retorno con molestia de rodilla/tobillo/hombro.
- Semana con poco sueno y match cercano.

### 6. Operacion De Piloto Premium

Objetivo: aprender con pocos clientes sin romper confianza.

Checklist:

- Invitar 3 clientes primero, no mas.
- Onboarding 1:1 de 20-30 min.
- Revisar manualmente el primer plan antes de entregarlo.
- Pedir check-in diario durante 7 dias.
- Hacer review semanal breve.
- Tener canal de soporte claro.
- Registrar feedback por categoria:
  - plan deportivo.
  - claridad UI.
  - confianza.
  - fallos tecnicos.
  - sync/datos.
  - pricing/oferta.

Metricas de exito:

- Cliente entiende su semana sin explicacion extra.
- Cliente registra al menos 4 dias de 7.
- 0 perdida de datos.
- 0 planes con criticos.
- Menos de 2 momentos de confusion fuerte por cliente/semana.
- Feedback cualitativo: "esto me ordena" o "esto me ayuda a llegar mejor".

## Pendientes Tecnicos Que Siguen Importando

Estos puntos no deben bloquear la preparacion comercial, pero si bloquean apertura amplia:

- Renovar auth E2E.
- Correr E2E reales con login vigente.
- Correr smoke prod controlado.
- Verificar Netlify background function con Supabase real.
- Confirmar que background generation escribe `jobId`, heartbeat y estado terminal.
- Validar sync desktop/mobile:
  - crear sesion en desktop, verla en mobile.
  - completar sesion en mobile, verla en desktop.
  - aceptar proposal en un dispositivo y converger en el otro.
  - delete/tombstone no reaparece.
- Revisar `.env` prod:
  - `VITE_AI_PROVIDER=proxy`.
  - sin keys privadas en `VITE_*`.
  - funciones server-side configuradas.
- Fijar runtime Node/npm para Netlify/local.
- Agregar CI minima o checklist automatizado antes de deploy.
- Confirmar schema Supabase real y migraciones necesarias.

## Sprint Recomendado - 7 Dias

### Dia 1 - Oferta

- Decidir nombre publico.
- Escribir one-liner y promesa.
- Definir cupos piloto y CTA.
- Definir si habra precio fundador o invitacion manual.

### Dias 2-3 - Landing

- Reescribir landing.
- Reescribir features.
- Cambiar pricing a piloto/waitlist.
- Remover links muertos y claims no probados.
- Agregar screenshots o visuales mas cercanos al uso real.

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

1. Actualizar landing/features/pricing hacia "piloto premium de squash".
2. Agregar paginas reales de terminos/privacidad/disclaimer.
3. Hacer UI pass para esconder lenguaje tecnico.
4. Crear checklist de revision de plan como entrenador.
5. Invitar solo 1 cliente acompanado cuando el flujo publico no tenga links rotos.

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

Empezar por superficie publica:

- Landing enfocada en squash competitivo.
- Pricing convertido a piloto fundador.
- Rutas reales de terminos y privacidad.
- Footer sin links muertos.

Despues de eso, hacer el pass de UI interna para que Plan Builder y quality review dejen de sonar a herramienta tecnica y empiecen a sonar a experiencia de atleta/coach.

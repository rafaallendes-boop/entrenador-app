# Entrenador App - Review and Roadmap

Actualizado: 2026-05-10

## Resumen Ejecutivo

Entrenador ya no esta en fase de descubrimiento. La app tiene una base real y usable: coach AI, week creator, Plan Builder, sync, backup, athlete profile, nutricion contextual, PWA, debug local y suites E2E. El foco ahora es uno solo: **lograr confianza operacional antes de mostrarla a usuarios externos**.

La estrategia correcta sigue siendo progresiva:

1. Primero, el owner debe poder usar la app en dev con Gemini sin crashes y sin semanas absurdas.
2. Luego, probar en prod como smoke test controlado.
3. Despues, invitar 3-5 usuarios cercanos.
4. Finalmente, abrir gradualmente.

No conviene agregar monetizacion, paywall, mas proveedores por defecto ni integraciones externas hasta que coach, Plan Builder y sync pasen pruebas repetibles.

## Lectura Actual

Ya esta hecho:

- README actualizado con arquitectura, comandos y estado beta.
- `BETA_AUDIT_AND_PROVIDER_PLAN.md` consolidado como auditoria vigente.
- Documentos antiguos no leidos fueron removidos del flujo.
- Suite E2E de coach y week creator.
- Suite E2E de Plan Builder.
- Guia de comandos en `DEV_TESTING_COMMANDS.md`.
- Beta Quality local en Settings.
- Feedback de respuesta/propuesta.
- Mejor densidad de fuerza/preparacion fisica.
- Squash distingue modalidad `solo`, `partner`, `either`, `match`.
- Bloques de squash visibles en SessionCard/ProposalDrawer.
- Warning local para propuestas de fuerza de baja densidad.
- Prompt audit disponible con `npm run audit:prompt`.

Mayor riesgo actual:

- La app puede pasar tests tecnicos, pero aun falta comprobar con uso real si genera semanas que el owner efectivamente usaria.
- Sync multi-dispositivo sigue siendo el mayor riesgo antes de usuarios externos.
- La observabilidad beta todavia es mayormente local; para beta externa falta persistencia resumida por usuario/request.
- Plan Builder debe probarse con generacion real y aceptacion, no solo wizard seguro.

## Estado por Area

### Coach y Week Creator

Estado: bueno para pruebas internas.

Fortalezas:

- Routing separado por `requestClass`.
- Chat general, chat action y week creator diferenciados.
- Proposals persistidas y aplicables.
- Prevalidacion antes de aplicar acciones.
- Recovery para acciones invalidas o truncadas.
- Stage logging y telemetria local.
- E2E completo `npm run e2e:dev` pasa en modo review-only.

Pendiente:

- Correr varias veces con Gemini real y revisar calidad subjetiva.
- Probar `npm run e2e:dev:apply` en ambiente dev seguro.
- Exportar Beta Quality despues de pruebas reales.
- Revisar si week creator produce semanas que el owner usaria, no solo semanas validas.

### Plan Builder

Estado: base tecnica lista; falta prueba real de generacion.

Fortalezas:

- Wizard de competencia.
- Builder en `/plans/builder`.
- Shell por fases.
- Generacion semana a semana.
- Validacion y regeneracion.
- E2E seguro `npm run e2e:plan` pasa sin guardar plan.

Pendiente:

- Correr `npm run e2e:plan:generate` con Gemini.
- Revisar calidad de semanas generadas.
- Correr `npm run e2e:plan:accept` solo en dev/local seguro.
- Validar que aceptar plan deja WeeklyView usable.
- Revisar telemetria `plan_builder_week` o `plan_builder_pair` en Settings.

### Fuerza y Preparacion Fisica

Estado: mejorado.

Ya se corrigio:

- Sesiones de 45-60 min no deberian caer automaticamente a 3 ejercicios.
- La duracion pesa mas en el target de ejercicios.
- Fatiga, taper y competencia cercana reducen volumen sin destruir la sesion salvo caso extremo.
- Prompt de fuerza refuerza estructura orientada a squash.

Pendiente:

- Probar manualmente prompts de 45, 60 y 75 min.
- Revisar que fuerza para squash tenga activacion, potencia/coordinacion, fuerza principal, unilateral/lateral, tren superior, core y cierre opcional cuando corresponde.

### Squash

Estado: mejorado.

Ya se corrigio:

- Drills clasificables por modalidad.
- Sesiones solo excluyen partner/match.
- Match queda al final.
- Sesiones mixtas pueden mostrar bloques.

Pendiente:

- Probar prompts reales:
  - "solo tengo cancha sin partner"
  - "quiero una sesion con partner"
  - "quiero partido"
  - "quiero sombras y tecnica sin partido"
- Revisar que el coach no mezcle tecnica, control y partido sin separacion clara.

### Prompt Builder

Estado: manejable, pero sensible.

Situacion actual:

- `promptBuilder.ts` sigue siendo grande.
- `npm run audit:prompt` muestra diferencias por requestClass.
- `chat_general` se mantiene liviano.
- `chat_action`, `week_creator` y `plan_builder` son mas grandes y deben serlo.

Decision:

- No refactorizar prompt builder ahora salvo necesidad clara.
- Antes de tocarlo, correr `npm run audit:prompt`.
- Si se refactoriza, hacerlo por requestClass y con tests de contrato.

### Sync

Estado: principal riesgo antes de beta externa.

Fortalezas:

- Local-first con Dexie.
- Supabase auth/sync.
- Cola local.
- Diagnostico visible en Settings.
- Tombstones y delete handling en entidades criticas.

Pendiente:

- QA real desktop + mobile.
- Probar offline/online.
- Probar deletes.
- Probar reset local y local+nube solo en ambiente seguro.
- Confirmar que proposals/sesiones no reaparecen ni se duplican.

### Observabilidad Beta

Estado: suficiente para owner QA, insuficiente para beta externa.

Ya existe:

- Beta Quality local.
- Feedback positivo/negativo.
- Export local.
- Trace, provider, model, duration, outcome y requestClass visibles.

Pendiente para beta externa:

- Persistir telemetria resumida en backend.
- No guardar prompts completos ni respuestas completas por defecto.
- Registrar outcome, requestClass, provider, model, duration, token counts si estan disponibles, retry/fallback, errorClass.
- Asociar feedback de usuario a trace/proposal/session.

## Roadmap por Fases

### Fase 1 - Owner QA con Gemini

Objetivo: que el owner confie en usar la app.

Checklist:

- Correr `npm run e2e:dev`.
- Correr `npm run e2e:plan`.
- Correr `npm run e2e:dev:apply` en dev seguro.
- Correr `npm run e2e:plan:generate`.
- Generar al menos 5 semanas con el coach.
- Generar al menos 2 planes con Plan Builder.
- Revisar Settings/Beta Quality despues de cada bloque.
- Guardar exports relevantes.

Criterio de salida:

- La app no crashea.
- El coach responde sin loaders pegados.
- Las proposals se aplican una sola vez.
- Week creator genera semanas razonables.
- Plan Builder genera semanas revisables.
- El owner usaria al menos una semana generada casi sin cambios.

### Fase 2 - Hardening de Calidad

Objetivo: convertir fallos observados en fixes puntuales.

Prioridades:

- Ajustar prompts solo donde haya evidencia.
- Ajustar selectors deportivos si el output es valido pero deportivamente pobre.
- Mejorar normalizer solo si hay fallos de formato repetidos.
- Mantener cambios pequenos y testeados.
- Agregar tests focalizados para cada bug real.

No hacer:

- Refactor masivo de prompt builder.
- Cambiar provider principal.
- Agregar nuevas features.
- Tocar monetizacion.

### Fase 3 - Sync y Multi-Dispositivo

Objetivo: evitar sorpresas con usuarios reales.

Escenarios:

- Desktop crea sesion, mobile la ve.
- Mobile completa sesion, desktop la ve.
- Coach crea proposal en A, se acepta en A, B converge.
- Sesion borrada no reaparece.
- Offline en A, cambios en B, reconnect en A.
- Export/import conserva conteos.
- Reset local y reset nube solo en ambiente seguro.

Criterio de salida:

- No hay duplicados.
- No reaparecen deletes.
- La UI comunica estado de sync.
- El usuario entiende si hay cola pendiente o error.

### Fase 4 - Smoke Prod Controlado

Objetivo: validar build, env vars, Netlify Function, Supabase auth y proxy real.

Pasos:

```bash
npm run lint
npm run test
npm run build
```

Luego, contra prod:

```bash
E2E_BASE_URL=https://TU_URL_DE_PROD npm run e2e:dev:quick
E2E_BASE_URL=https://TU_URL_DE_PROD npm run e2e:plan
```

Criterio de salida:

- Auth redirige bien.
- Proxy responde.
- No hay keys reales expuestas con `VITE_`.
- Netlify Function no muestra `misconfigured`.
- Settings muestra trazas de requestClass.

### Fase 5 - Beta Cerrada 3-5 Usuarios

Objetivo: aprender con usuarios cercanos sin abrir el producto.

Antes de invitar:

- Disclaimer beta claro.
- Feedback facil en coach/proposals.
- Limites diarios por requestClass o al menos monitoreo manual.
- Export de Beta Quality probado.
- Canal simple para reportar problemas.

Durante beta:

- Revisar feedback semanalmente.
- Separar fallos por causa:
  - provider
  - timeout/streaming
  - parse/schema
  - prompt insuficiente
  - selector/logica deportiva
  - sync
- No perseguir todos los comentarios como feature request.

Criterio de salida:

- Menos de 20% feedback negativo en escenarios clave.
- No hay perdida de datos reportada.
- No hay bloqueos de auth/sync.
- El coach genera al menos algunas semanas utiles para terceros.

### Fase 6 - Proveedores, Costos y Persistencia

Objetivo: profesionalizar operacion sin sobredisenar.

Trabajos candidatos:

- Persistir `coach_request_log` resumido.
- Persistir `coach_feedback`.
- Agregar limites diarios por usuario/requestClass.
- Evaluar routing por requestClass en server:
  - Gemini default.
  - OpenAI/Claude solo donde haya evidencia de mejor calidad.
- Registrar tokens cuando provider los exponga.

No hacer antes:

- Migrar todo a otro provider.
- Optimizar costos sin datos.
- Agregar billing.

## Comandos de Verificacion

Uso diario:

```bash
npm run dev
npm run e2e:dev:quick
npm run e2e:plan
```

Coach completo:

```bash
npm run e2e:dev
npm run e2e:dev:headed
npm run e2e:dev:apply
npm run e2e:dev:quality
```

Plan Builder:

```bash
npm run e2e:plan
npm run e2e:plan:headed
npm run e2e:plan:generate
npm run e2e:plan:accept
```

Tecnico:

```bash
npm run lint
npm run test
npm run build
npm run audit:prompt
```

Load test:

```bash
npm run loadtest:week-creator
```

## Reglas de Cambio

- Cambios pequenos, con commits pequenos.
- No tocar auth, sync, monetizacion o providers en tareas de calidad deportiva salvo pedido explicito.
- Si se toca prompt, correr audit.
- Si se toca selector deportivo, agregar test focalizado.
- Si se toca proposal/apply, correr E2E coach.
- Si se toca Plan Builder, correr E2E plan.
- Si se toca sync, hacer QA manual multi-dispositivo.

## Que No Hacer Ahora

- No abrir beta publica.
- No construir paywall.
- No sumar integraciones externas.
- No reescribir prompt builder por estetica.
- No cambiar Gemini como default sin datos.
- No meter analytics invasivos.
- No agregar features antes de cerrar estabilidad.

## Nota de Direccion

La prioridad ya no es que Entrenador sea mas ambicioso. La prioridad es que sea confiable: que genere semanas razonables, que el Plan Builder no se caiga, que sync no sorprenda y que cada fallo deje una pista clara. Cuando eso ocurra repetidamente en dev y luego en prod, recien ahi tiene sentido invitar usuarios.

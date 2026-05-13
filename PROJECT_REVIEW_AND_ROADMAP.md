# Entrenador App - Review and Roadmap

Actualizado: 2026-05-13

## Resumen Ejecutivo

Entrenador ya no esta en fase de descubrimiento. La app tiene una base real y usable: coach AI, week creator, Plan Builder, sync, backup, athlete profile, nutricion contextual, PWA, debug local y suites E2E. En los ultimos ciclos ya hubo pruebas reales de generacion semanal con Gemini y uso multi-dispositivo desktop/mobile. El foco sigue siendo uno solo: **lograr confianza operacional antes de mostrarla a usuarios externos**.

La estrategia correcta sigue siendo progresiva:

1. Primero, el owner debe poder usar la app en dev con Gemini sin crashes y sin semanas absurdas.
2. Luego, probar en prod como smoke test controlado.
3. Despues, invitar 3-5 usuarios cercanos.
4. Finalmente, abrir gradualmente.

No conviene agregar monetizacion, paywall, mas proveedores por defecto ni integraciones externas hasta que coach, Week Creator, Plan Builder y sync pasen pruebas repetibles.

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
- Prompt audit disponible con `npm run audit:prompt`, ahora con baseline versionado y assertions por requestClass.
- Week Creator tiene fallback local mas explicito cuando Gemini no entrega una semana aplicable.
- Week Creator registra mejor `errorCode`, `outcome`, warnings y causa de fallback.
- Week Creator ahora usa salida estructurada Gemini (`responseMimeType: application/json` + `responseSchema`) para reducir fallos `actions_parse_failed`.
- El normalizador acepta JSON puro de `create_week`, ademas del formato historico con `<actions>`.
- El contrato `create_week` quedo centralizado en `src/services/ai/prompt/core/outputContract.ts`.
- `WEEK_CREATOR_RESPONSE_SCHEMA` y los bloques de schema en prosa se derivan del mismo contrato.
- `WeekCreatorPromptBuilder` consume el contrato central, renderers de schema y pack deportivo de squash.
- `chat_action` ya usa `renderActionCatalog` para el catalogo de acciones de ajuste.
- `chat_general` migro su contrato lite e instrucciones generales a la nueva estructura modular.
- Se agrego test de paridad entre contrato, prosa y schema JSON.
- Las sesiones squash generadas por fallback ya tienen mayor densidad:
  - tecnica: al menos 4 drills.
  - tecnica + juego: drills tecnicos, juegos condicionados y match/game.
  - ghosting + control: ghosting y control separados.
- Sync manual mobile -> desktop fue probado y funciono al presionar `SYNC`.
- Se agrego auto-sync en focus/visibilidad para reducir la necesidad de presionar `SYNC` manualmente.

Mayor riesgo actual:

- Week Creator ya recupero estabilidad tecnica en loadtest local post-refactor: 10/10 requests OK contra `/.netlify/functions/coach`, sin `missing_create_week`.
- La calidad deportiva de squash mejoro, pero aun debe probarse con mas semanas completas aplicadas, no solo propuestas validas.
- Sync multi-dispositivo funciono manualmente, pero el auto-sync recien implementado requiere QA real.
- La observabilidad beta todavia es mayormente local; para beta externa falta persistencia resumida por usuario/request.
- Plan Builder debe probarse con generacion real y aceptacion, no solo wizard seguro.

## Hallazgos de QA Real - 2026-05-13

### Week Creator con Gemini

Se probaron generaciones reales de 1 semana. Al inicio Gemini respondio, pero el sistema no pudo aplicar la salida en varios intentos. Despues del refactor de contrato/schema/prompt, el loadtest local dejo de reproducir el fallo.

Hallazgos:

- Falla recurrente: `actions_parse_failed`.
- Sintoma: "El modelo no devolvio ninguna accion create_week".
- En otro intento hubo `missing_sport_details`, con drills squash repetidos y warning de baja densidad en fuerza.
- El fallback local genero semana aplicable, por lo que el usuario no quedo bloqueado.
- El problema principal no parece ser caida del proveedor, sino fragilidad de contrato entre prompt, respuesta Gemini y parser.

Acciones tomadas:

- Se agrego clasificacion de fallos de Week Creator.
- Se mejoro el mensaje de fallback para explicar que se uso perfil/configuracion actual.
- Se agrego salida estructurada Gemini con schema JSON para `week_creator`.
- Se agrego soporte para parsear respuesta JSON pura.
- Se agrego test para respuesta `create_week` sin `<actions>`.
- Se centralizo el contrato `create_week` en `outputContract`.
- Se derivan desde el contrato tanto el schema Gemini como la prosa usada por prompts.
- Se endurecio el loadtest para detectar `missing_create_week`, pseudo XML y payloads invalidos.
- Ultima corrida reportada de `npm run loadtest:week-creator`: 10/10 OK, successRate 100%, p50 4993ms, p95 5903ms, max 6558ms.

Pendiente:

- Probar aceptacion real con `npm run e2e:dev:apply` en ambiente dev seguro.
- Generar 3-5 semanas reales y revisar si el owner las usaria con pocos ajustes.
- Exportar Beta Quality si aparece cualquier warning/fallback.
- Confirmar que la mejora se mantiene fuera del loadtest sintetico.

### Calidad Squash

Se observaron sesiones squash con solo 2 drills, insuficientes para una guia util.

Regla actualizada:

- Sesion solo tecnica: al menos 4 ejercicios.
- Sesion mixta tecnica + juego: 2 ejercicios tecnicos, 2 juegos condicionados y match/games sueltos.
- Sesion mixta ghosting + control: 2 ejercicios ghosting y 2-3 ejercicios de control.

Estado:

- El fallback local ya respeta mejor esta densidad.
- En la ultima revision visual del usuario, las sesiones se ven "un poco mejor".
- El prompt modular de Week Creator incluye reglas squash especificas desde `packs/sports/squash.ts`.
- Falta revisar variedad en semanas reales aplicadas, porque validez tecnica no garantiza utilidad deportiva.

### Sync

Prueba real:

- Sesiones creadas desde celular.
- Al entrar desde PC aparecio desfase inicial.
- Al hacer clic en `SYNC`, sincronizo y funciono.

Accion tomada:

- Se agrego auto-sync al volver a enfocar la app o cambiar visibilidad, con cooldown para no saturar.

Pendiente:

- Probar entrada PC -> celular sin presionar `SYNC`.
- Probar entrada celular -> PC sin presionar `SYNC`.
- Confirmar que no duplica sesiones ni revive borrados.

## Estado por Area

### Coach y Week Creator

Estado: beta interna en hardening. La estabilidad de formato mejoro significativamente; ahora el foco pasa de "parsear/aplicar" a "calidad deportiva y aceptacion real".

Fortalezas:

- Routing separado por `requestClass`.
- Chat general, chat action y week creator diferenciados.
- Proposals persistidas y aplicables.
- Prevalidacion antes de aplicar acciones.
- Recovery para acciones invalidas o truncadas.
- Stage logging y telemetria local.
- E2E completo `npm run e2e:dev` pasa en modo review-only.
- E2E completo `npm run e2e:dev:headed --export-quality` paso 20/20 incluyendo export Beta Quality.
- Fallback local de Week Creator mantiene al usuario avanzando cuando Gemini falla.
- Salida estructurada por schema para `week_creator`.
- Normalizador compatible con JSON puro y `<actions>`.
- Loadtest Week Creator paso 10/10 OK despues de consolidar contrato y endurecer prompt/schema.

Pendiente:

- Probar `npm run e2e:dev:apply` en ambiente dev seguro.
- Revisar si week creator produce semanas que el owner usaria, no solo semanas validas.
- Confirmar que las semanas generadas por Gemini no dependen del fallback local.
- Revisar export Beta Quality despues de corridas aplicadas, no solo review-only.

### Plan Builder

Estado: base tecnica lista; falta prueba real profunda de generacion y aceptacion.

Fortalezas:

- Wizard de competencia.
- Builder en `/plans/builder`.
- Shell por fases.
- Generacion semana a semana.
- Validacion y regeneracion.
- E2E seguro `npm run e2e:plan` pasa sin guardar plan.
- Ultima corrida reportada de `npm run e2e:plan`: 15/15 OK en review-only.

Pendiente:

- Correr `npm run e2e:plan:generate` con Gemini.
- Revisar calidad de semanas generadas.
- Correr `npm run e2e:plan:accept` solo en dev/local seguro.
- Validar que aceptar plan deja WeeklyView usable.
- Revisar telemetria `plan_builder_week` o `plan_builder_pair` en Settings.
- Comparar si Plan Builder tiene mejor estabilidad que Week Creator con Gemini real.
- Si Plan Builder funciona mejor, considerar reutilizar parte de su contrato/schema en Week Creator.

### Fuerza y Preparacion Fisica

Estado: mejorado; falta QA manual focalizado.

Ya se corrigio:

- Sesiones de 45-60 min no deberian caer automaticamente a 3 ejercicios.
- La duracion pesa mas en el target de ejercicios.
- Fatiga, taper y competencia cercana reducen volumen sin destruir la sesion salvo caso extremo.
- Prompt de fuerza refuerza estructura orientada a squash.

Pendiente:

- Probar manualmente prompts de 45, 60 y 75 min.
- Revisar que fuerza para squash tenga activacion, potencia/coordinacion, fuerza principal, unilateral/lateral, tren superior, core y cierre opcional cuando corresponde.
- Revisar warnings `low_density:strength` en exports reales.

### Squash

Estado: mejorado; el ultimo feedback visual indica avance, pero aun no cerrado.

Ya se corrigio:

- Drills clasificables por modalidad.
- Sesiones solo excluyen partner/match.
- Match queda al final.
- Sesiones mixtas pueden mostrar bloques.
- Week Creator fallback genera mas drills por sesion squash.
- Reglas explicitas de densidad squash estan en el prompt de Week Creator.

Pendiente:

- Probar prompts reales:
  - "solo tengo cancha sin partner"
  - "quiero una sesion con partner"
  - "quiero partido"
  - "quiero sombras y tecnica sin partido"
- Revisar que el coach no mezcle tecnica, control y partido sin separacion clara.
- Generar 3-5 semanas squash con Gemini real post-schema y revisar variedad.
- Confirmar que sesiones tecnicas no vuelven a quedar con solo 1-2 drills.

### Prompt Architecture

Estado: refactor modular en curso, con fases 0-5 completadas para los caminos de mayor riesgo.

Ya se hizo:

- Baseline de prompts guardado en `docs/prompt-baseline-2026-05-13.json`.
- `npm run audit:prompt` ahora falla si una requestClass se sale del rango esperado sin decision explicita.
- `src/services/ai/prompt/core/outputContract.ts` concentra el contrato de acciones y, especialmente, `create_week`.
- `src/services/ai/prompt/renderers/proseSchema.ts` genera schema en prosa para prompts.
- `src/services/ai/prompt/renderers/jsonSchema.ts` genera schema JSON para structured output.
- `src/services/weekCreator/weekCreatorResponseSchema.ts` ya deriva de `ACTION_CONTRACTS.create_week`.
- `src/services/week/prompts/weekPrompt.ts` usa una fuente comun para bloques `minimal/full` y mantiene shims publicos para no romper Plan Builder.
- `src/services/weekCreator/WeekCreatorPromptBuilder.ts` consume `coachContract`, `outputContract`, renderers y `packs/sports/squash`.
- `chat_action` usa `renderActionCatalog` para el set de acciones de ajuste.
- `chat_general` migro su contrato lite e instrucciones generales a `coachContract` y `packs/quality/generalChat`.
- Test de paridad de contrato agregado en `src/services/ai/prompt/__tests__/outputContractParity.test.ts`.

Validacion reportada:

- `npm run audit:prompt` verde.
- Tests focalizados de prompt/coach verdes.
- `npm test` verde.
- `npm run lint` verde.
- `npm run build` verde.
- `npm run e2e:dev:headed --export-quality` verde: 20/20.
- `npm run e2e:plan` verde: 15/15.
- `npm run loadtest:week-creator` verde: 10/10.

Pendiente:

- Reducir mas `promptBuilder.ts` solo si hay beneficio directo; evitar refactor estetico.
- Revisar si los packs `quality` deben integrarse por completo o dejarse para una fase posterior controlada.
- Crear snapshots completos por requestClass si se decide seguir modularizando `chat_action`.
- Evaluar mover Plan Builder al mismo contrato unico despues de pruebas reales de generacion/accept.

#### Refactor de prompts - estado por fase

- Fase 0, baseline e instrumentacion: completada. `audit:prompt` tiene baseline y assertions; baseline guardado en `docs/prompt-baseline-2026-05-13.json`.
- Fase 1, contrato `create_week`: completada. `ACTION_CONTRACTS.create_week` es la fuente comun para prosa y JSON Schema.
- Fase 2, Week Creator modular: completada. `WeekCreatorPromptBuilder` consume `coachContract`, `outputContract`, renderers y pack squash.
- Fase 3, quality packs: parcialmente completada. Existen packs `criticalRules`, `competitionRules` y `goldenRule`; integrarlos totalmente al builder principal queda pendiente porque la fase 4 del usuario reordeno `promptBuilder.ts`.
- Fase 4, `chat_action` action catalog: completada en alcance inicial. El catalogo de acciones de ajuste se renderiza desde `renderActionCatalog`.
- Fase 5, `chat_general` minimo: completada. Persona lite e instrucciones generales salieron del builder monolitico.

Decision actual:

- Cerrar este bloque de refactor como exitoso para la beta interna.
- No seguir reduciendo `promptBuilder.ts` por estetica.
- Solo abrir una siguiente fase si aparece evidencia en Beta Quality, loadtest o E2E aplicada.
- El siguiente candidato tecnico real es persistir telemetria resumida, no seguir moviendo texto de prompts sin impacto medible.

### Sync

Estado: principal riesgo antes de beta externa. Sync manual funciono en una prueba real; auto-sync requiere validacion.

Fortalezas:

- Local-first con Dexie.
- Supabase auth/sync.
- Cola local.
- Diagnostico visible en Settings.
- Tombstones y delete handling en entidades criticas.
- Sync manual mobile -> desktop probado con resultado correcto.
- Auto-sync en focus/visibilidad implementado.

Pendiente:

- QA real desktop + mobile.
- QA especifico de auto-sync sin presionar boton manual.
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
- Export Beta Quality ya permitio identificar fallos reales `week_creator`.
- Warnings de Week Creator incluyen causa de fallback y validacion deportiva.

Pendiente para beta externa:

- Persistir telemetria resumida en backend.
- No guardar prompts completos ni respuestas completas por defecto.
- Registrar outcome, requestClass, provider, model, duration, token counts si estan disponibles, retry/fallback, errorClass.
- Asociar feedback de usuario a trace/proposal/session.

## Roadmap por Fases

### Fase 1 - Owner QA con Gemini

Objetivo: que el owner confie en usar la app. Esta fase ya empezo con pruebas reales y dejo bugs accionables.

Checklist:

- Correr `npm run e2e:dev`.
- Correr `npm run e2e:plan`.
- Correr `npm run e2e:dev:apply` en dev seguro.
- Correr `npm run e2e:plan:generate`.
- Generar al menos 5 semanas con el coach post-schema.
- Generar al menos 2 planes con Plan Builder.
- Revisar Settings/Beta Quality despues de cada bloque.
- Guardar exports relevantes.
- Probar auto-sync PC/celular sin presionar `SYNC`.
- Revisar 3-5 sesiones squash tecnicas/mixtas para densidad de drills.

Criterio de salida:

- La app no crashea.
- El coach responde sin loaders pegados.
- Las proposals se aplican una sola vez.
- Week creator genera semanas razonables.
- Week creator deja de caer al fallback local en casos normales.
- Plan Builder genera semanas revisables.
- El owner usaria al menos una semana generada casi sin cambios.

### Fase 2 - Hardening de Calidad

Objetivo: convertir fallos observados en fixes puntuales.

Prioridades:

- Ajustar prompts solo donde haya evidencia.
- Ajustar selectors deportivos si el output es valido pero deportivamente pobre.
- Mejorar normalizer/schema solo si hay fallos de formato repetidos.
- Mantener cambios pequenos y testeados.
- Agregar tests focalizados para cada bug real.
- Usar exports Beta Quality como fuente principal para priorizar.

No hacer:

- Refactor masivo de prompt builder.
- Cambiar provider principal.
- Agregar OpenAI/Claude para la beta actual.
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
- Abrir app en dispositivo B y verificar sync automatico sin tocar boton.

Criterio de salida:

- No hay duplicados.
- No reaparecen deletes.
- La UI comunica estado de sync.
- El usuario entiende si hay cola pendiente o error.
- El boton `SYNC` queda como respaldo, no como paso obligatorio.

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

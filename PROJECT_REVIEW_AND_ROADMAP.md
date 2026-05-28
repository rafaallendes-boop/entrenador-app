# Entrenador App - Review and Roadmap

Actualizado: 2026-05-28

## Resumen Ejecutivo

Entrenador esta en beta interna avanzada. La app ya tiene una base usable: coach AI, Week Creator, Plan Builder, sync local-first con Supabase, backup/export, perfil de atleta, nutricion contextual, PWA, diagnostico local, suites de tests y scripts E2E. El estado actual del repo muestra una mejora clara respecto del review anterior: el foco ya no es solo que Gemini devuelva JSON aplicable, sino que las semanas y sesiones tengan mejor calidad operacional, fechas correctas y preparacion fisica mas util.

El working tree actual contiene cambios relevantes sin commit. No son cambios cosmeticos: agregan prescripcion de carga por 1RM/RPE, estructura real de fuerza por bloques, cardio especifico para squash, postprocesado de fechas para ajustes de chat, fallback estructurado cuando el modelo responde solo texto, soporte de semanas parciales en Plan Builder, reparacion de minimo de deporte principal, especificidad deportiva Fase 2 para Plan Builder, mejoras de sync y tests nuevos.

Restriccion operativa: por limite de Netlify, no se debe subir a produccion hasta el 2026-05-29. Hasta esa fecha, el trabajo debe ser QA en DEV/local. El 2026-05-29 se hara una prueba fuerte en DEV, luego smoke controlado en prod, despues beta privada y finalmente beta con mas personas.

La estrategia correcta sigue siendo progresiva:

1. Owner QA en DEV hasta el 2026-05-29.
2. Smoke test controlado en prod despues de que Netlify permita deploy.
3. Beta privada con 3-5 usuarios cercanos.
4. Beta ampliada solo despues de datos reales de calidad, sync y estabilidad.

No conviene agregar monetizacion, paywall, proveedores por defecto ni integraciones externas hasta que coach, Week Creator, Plan Builder y sync pasen pruebas repetibles con uso real.

## Estado Actual del Repo

### Validacion local corrida el 2026-05-28

Verde en el estado actual:

```bash
npm run lint
npm test
npm run build
npm run audit:prompt
```

Resultados:

- `npm run lint`: OK.
- `npm test`: 86 archivos, 629 tests OK.
- `npm run build`: OK.
- `npm run audit:prompt`: OK.
  - `chat_general`: 2014 chars / ~504 tokens.
  - `chat_action`: 14650 chars / ~3663 tokens.
  - `week_creator`: 14650 chars / ~3663 tokens.
  - `plan_builder_week`: 14650 chars / ~3663 tokens.
  - `weekly_summary`: 14958 chars / ~3740 tokens.

Tests focalizados nuevos/relevantes de Fase 2:

- `src/services/training/__tests__/exerciseLibrarySchema.test.ts`
- `src/services/training/__tests__/drillLibrarySchema.test.ts`
- `src/services/training/__tests__/strengthBlocks.test.ts`
- `src/services/training/__tests__/strengthSelectorPhase2.test.ts`
- `src/services/training/__tests__/drillSelectorPhase.test.ts`
- `src/services/planBuilder/__tests__/profileAdapter.test.ts`
- `src/services/planBuilder/__tests__/repairWeekPhase2Wiring.test.ts`

No revalidado hoy:

- `npm run e2e:dev`
- `npm run e2e:dev:apply`
- `npm run e2e:plan`
- `npm run e2e:plan:generate`
- `npm run e2e:plan:accept`
- `npm run loadtest:week-creator`

### Validacion local corrida el 2026-05-25

Verde en el estado actual:

```bash
npm test
npm run lint
npm run build
npm run audit:prompt
```

Resultados:

- `npm test`: 66 archivos, 524 tests OK.
- `npm run lint`: OK.
- `npm run build`: OK.
- `npm run audit:prompt`: OK.
  - `chat_general`: 2014 chars / ~504 tokens.
  - `chat_action`: 14650 chars / ~3663 tokens.
  - `week_creator`: 14650 chars / ~3663 tokens.
  - `plan_builder_week`: 14650 chars / ~3663 tokens.
  - `weekly_summary`: 14654 chars / ~3664 tokens.

Tests focalizados corridos durante el cierre:

- `npm test -- strengthLoadPrescription strengthSelector repairWeek strengthPrompt strengthSessionStructure actionPostProcessor WeekCreatorEngine`: 8 archivos, 113 tests OK.
- `npm test -- actionPostProcessor chatRouting responseNormalizer strengthSelector`: 4 archivos, 71 tests OK.

No revalidado hoy:

- `npm run e2e:dev`
- `npm run e2e:dev:apply`
- `npm run e2e:plan`
- `npm run e2e:plan:generate`
- `npm run e2e:plan:accept`
- `npm run loadtest:week-creator`

Ultima referencia previa documentada:

- `npm run e2e:dev:headed --export-quality`: 20/20 OK.
- `npm run e2e:plan`: 15/15 OK en review-only.
- `npm run loadtest:week-creator`: 10/10 OK, successRate 100%, p50 4993ms, p95 5903ms, max 6558ms.

## Mejoras Recientes Detectadas

### Hardening Fases 1+2 post-review

- `generateWeek` vuelve a propagar streaming y `chunkCount`, evitando telemetria falsa en semanas single.
- Timeouts cliente/proxy realineados a Netlify Pro sync 26s: wallclock 24s, `plan_builder_week` 18s y `plan_builder_pair` 23s.
- Env var del Plan Builder alineada al spec: `VITE_PLAN_BUILDER_STRATEGY`.
- Cobertura 1RM ampliada con `incline_bench_press`, `close_grip_bench_press`, `sumo_deadlift` y `landmine_press`.
- `partnerAvailability` y `requireExtraRecovery` ahora se consumen en reparacion/seleccion.
- Semanas fuera de fases declaradas reinician rotacion de bloque en indice 0.
- Race block y Build B/C quedaron menos fragiles para sesiones cortas o semanas de competencia.
- `quality.strength.repeated_template` ahora advierte repeticion de fuerza dentro del mismo bloque con umbral >=3 ejercicios.
- E2E Plan Builder reporta ratio IA real vs fallback por semana.
- `requestPolicyTimeoutConsistency.test.ts` previene drift entre timeouts de cliente y wallclock del proxy.

Riesgos abiertos:

- La metrica empirica >=80% IA real requiere correr `npm run e2e:plan:generate` en DEV con Gemini real y un plan suficientemente largo.
- Drill-by-id por referencia sigue diferido.
- El schema canonico declarativo de fuerza/drills queda como deuda de Fase 2.5 si aparece friccion real.

### Fuerza y prescripcion de carga

Estado: mejora importante implementada y cubierta por tests focalizados. La fuerza ya no debe mostrarse como una lista plana antigua cuando viene desde chat, Week Creator, Plan Builder o fallback.

Cambios principales:

- Nuevo servicio `src/services/training/strengthLoadPrescription.ts`.
- Nuevo servicio `src/services/training/strengthSessionStructure.ts`.
- Mapeo de ejercicios a referencias de fuerza:
  - banca, press inclinado, press declinado, agarre cerrado, fondos.
  - sentadilla, front squat, bulgaras, zancadas, hip thrust.
  - peso muerto, RDL, sumo, trap bar.
  - press hombro/OHP/push press.
  - Press Z, remos medio arrodillados, remos con barra y dominadas.
- Calculo de peso objetivo desde porcentaje de 1RM con redondeo.
- Generacion de rampas de calentamiento segun intensidad.
- Lista canonica de referencias disponibles del perfil.
- Nuevos campos en ejercicios:
  - `targetPercent1RM`
  - `targetRpe`
  - `warmupSets`
- El normalizador acepta esos campos en respuestas del coach.
- Export/import de datos preserva esos campos y valida rangos.
- UI muestra carga en `ProposalDrawer` y `ExerciseChecklist`.
- El prompt de fuerza ahora instruye como usar 1RM, RPE, warmups y estructura por bloques.
- `actionPostProcessor` completa pesos cuando el modelo entrega `%1RM` y hay referencia en perfil.
- Las sesiones de fuerza de 45+ min se separan visualmente en:
  - warm-up.
  - zona media.
  - trabajo de fuerza.
  - cardio especifico opcional.
  - cool-down.
- El warm-up de fuerza ahora se parece mas a una preparacion real: movilidad/prep de tejidos y rango, mas series de aproximacion.
- Para 60 min, el selector apunta a 6-9 ejercicios totales, no a 3-5:
  - 1-2 zona media.
  - 4-5 fuerza/accesorios/correctivos.
  - 0-1 cardio especifico si aplica.
- Cardio especifico para squash queda al final:
  - escalera/footwork.
  - bici de asalto 30s on / 30s off en bloque de 4 min.
  - trotadora de aire 20s on / 20s off en bloque de 4 min.
- `repairWeek` densifica sesiones de fuerza pobres que vengan de Gemini/fallback antes de aplicarlas.
- `create_week` del chat tambien densifica fuerza antes de guardar propuesta.
- Si `chat_action` responde solo texto ante un pedido claro como "crea una sesion de fuerza para mañana", el postprocesador crea un `add_session` estructurado.

Tests nuevos/relevantes:

- `src/services/__tests__/strengthLoadPrescription.test.ts`
- `src/services/__tests__/dataExportStrengthLoad.test.ts`
- Extensiones en `actionPostProcessor`, `responseNormalizer` y prompts.

Riesgo pendiente:

- Falta QA visual/manual en DEV con perfiles reales de fuerza para confirmar que las cargas sugeridas se sienten razonables.
- Dominadas aun se tratan como referencia por reps, no como peso calculado.
- Hay que revisar que el coach use `targetRpe` solo cuando no hay 1RM util.
- Revisar si el selector debe bajar todavia mas impacto/pliometria cuando el atleta viene volviendo de lesion.

### Ajustes de chat y fechas

Estado: mejora concreta para evitar propuestas en semanas/dias incorrectos y respuestas no aplicables.

Cambios principales:

- El prompt de `chat_action` distingue "esta semana" vs "proxima semana".
- El postprocesador alinea acciones a la semana solicitada.
- Si el usuario marca un dia como descanso/libre/off, el sistema evita programar ahi.
- Se considera ocupacion AM/PM para no colisionar slots cuando se mueven o agregan sesiones.
- Se mantiene la conversion de `add_session` a `update_session` cuando el mensaje realmente ajusta una sesion existente.
- Se corrigio el manejo de detalles al cambiar entre running y cycling para no arrastrar estructuras incompatibles.
- "mañana" ahora se interpreta como fecha relativa, no como bloque AM por accidente.
- Si el modelo responde solo en texto a una accion puntual clara, se genera una propuesta aplicable en vez de dejar al usuario sin boton de aplicar.

Riesgo pendiente:

- Probar prompts reales ambiguos:
  - "dejame el lunes libre y agregame fuerza la proxima semana"
  - "mueve lo del martes al jueves"
  - "cambia la bici por trote"
  - "pon squash el viernes de la siguiente semana"
  - "crea una sesion de fuerza para mañana"
  - "hazme pesas manana PM"

### Plan Builder

Estado: base mas robusta y Fase 2 de especificidad deportiva iniciada; falta generacion real con proveedor y QA de calidad del plan completo.

Cambios principales:

- Nuevo helper `src/services/planBuilder/dateRange.ts`.
- El plan ahora distingue:
  - `startDate`: fecha efectiva desde la que se puede entrenar.
  - `endDate`: fecha final solicitada/evento, que puede cortar la ultima semana.
- Las semanas parciales ya no fuerzan sesiones fuera del rango real.
- `getExpectedSessionsForPlanWeek` limita la cantidad esperada segun capacidad real de dias permitidos y doble sesion.
- Prompts de generacion semanal incluyen rango valido y cantidad efectiva.
- Retry instructions ahora usan rango valido, no solo lunes + 6 dias.
- Repair mueve sesiones fuera de rango al slot valido mas cercano.
- Validator usa rango efectivo y cantidad esperada.
- Repair intenta preservar un minimo de deporte principal, especialmente squash en build/peak.
- UI cambia etiqueta `race` a `Competencia`.
- Fase 2 empieza a usar la libreria actual como catalogo declarativo, sin crear una segunda fuente de verdad.
- `exerciseLibrary` expone metadata de fase, rotacion de bloque y referencia 1RM por ejercicio.
- `drillLibrary` expone metadata de fase y `partnerRequired`.
- Nuevo `strengthBlocks/` con templates build A/B/C, peak A/B/C, taper A/B y race.
- Nuevo `profileAdapter` traduce perfil + wizard a parametros de selector: 1RM disponibles, ajuste RPE, edad masters y equipo opcional.
- `selectStrengthSession` usa templates cuando recibe contexto de bloque/perfil, rota lift estrella y expone `starLift`.
- `repairWeek` calcula `weekIndexInBlock`, pasa 1RM/RPE al selector y persiste `metadata.starLift` en la propuesta.
- `applyCreateWeek` conserva metadata de sesion al guardar el plan aceptado.
- `drillSelector` ya consume `phaseAppropriate` y excluye drills con partner cuando la sesion es solo.
- QA con export real del 2026-05-28 detecto que Gemini estaba insertando `Warm-up...` y `Cooldown...` como ejercicios dentro de fuerza, duplicando las secciones dedicadas. `strengthSessionStructure` ahora filtra ejercicios protocolarios cuando hay trabajo real de fuerza.

Riesgo pendiente:

- Repetir `npm run e2e:plan`.
- Correr `npm run e2e:plan:generate` con Gemini.
- Correr `npm run e2e:plan:accept` solo en dev/local seguro.
- Confirmar que una ultima semana parcial antes del evento queda usable en WeeklyView.
- Revisar si el minimo de deporte principal no sobrecorrige reemplazando demasiado soporte.
- Generar un plan de 9 semanas con perfil de fuerza completo y validar:
  - 0 sesiones de fuerza clonadas con 3+ ejercicios repetidos dentro del mismo bloque.
  - al menos 4 ejercicios del plan usando referencia 1RM.
  - cada fuerza de 60 min con core, squat/hinge, push/pull, unilateral y accesorios.
  - al menos 6 drills distintos de squash across plan.
  - ausencia de warning `quality.strength.repeated_template`.
- Regenerar/repairar planes aceptados antes de esta correccion si se quieren limpiar sesiones ya guardadas con warm-up/cooldown dentro del array de ejercicios.

### Week Creator y contrato de salida

Estado: estable en tests locales; pendiente de repetir loadtest real en DEV antes del 2026-05-29.

Ya estaba consolidado:

- Contrato `create_week` centralizado en `src/services/ai/prompt/core/outputContract.ts`.
- Structured output Gemini para `week_creator`.
- Normalizador compatible con JSON puro y `<actions>`.
- Paridad entre contrato, prosa y JSON Schema.
- Loadtest anterior 10/10 OK contra `/.netlify/functions/coach`.

Mejora reciente:

- El contrato `create_week` ahora incluye campos de fuerza:
  - `weight` como numero.
  - `targetPercent1RM`.
  - `targetRpe`.
  - `warmupSets`.
- Prompts de semana y batch pueden incluir el pack de prescripcion de carga cuando strength esta permitido.
- Plan Builder y Week Creator se benefician del mismo lenguaje de fuerza.
- Week Creator y Plan Builder reciben reglas explicitas de fuerza tipo preparador fisico: warm-up de movilidad, zona media, fuerza, cardio especifico opcional y cool-down.
- La reparacion posterior corrige fuerza pobre aunque el modelo haya devuelto un array antiguo o demasiado corto.

Riesgo pendiente:

- Repetir `npm run loadtest:week-creator`.
- Confirmar que Gemini usa cargas/RPE de manera consistente y no inventa 1RM no presentes.
- Confirmar que el output con `warmupSets` no vuelve fragil el parser.

### Sync

Estado: mejora pequena pero importante; sigue siendo un riesgo antes de beta externa.

Cambios recientes:

- Auto-sync en focus/visibilidad queda mas agresivo: si no hay sync en curso, intenta sincronizar.
- `runFullSync` mueve `applyRemoteFullResetIfNeeded` dentro del bloque instrumentado por intento, lo que deberia mejorar tracking/estado cuando hay reset remoto.

Riesgo pendiente:

- QA real desktop + mobile sin tocar `SYNC`.
- Probar que el auto-sync mas frecuente no molesta ni genera exceso de requests.
- Probar delete/tombstones y que no reaparezcan sesiones.
- Probar offline/online y conflictos basicos.

### Export/import y modelo de datos

Estado: mejorado.

Cambios principales:

- `parseAppDataExport` queda exportado para tests.
- Backup valida y preserva `targetPercent1RM`, `targetRpe` y `warmupSets`.
- Nuevos tests aseguran roundtrip de campos de carga de fuerza.

Riesgo pendiente:

- Probar export/import manual desde Settings con datos reales.
- Confirmar compatibilidad con backups viejos que no tienen esos campos.

## Estado por Area

### Coach y Week Creator

Estado: beta interna en hardening. La estabilidad de formato habia mejorado; ahora el foco real es calidad deportiva, fechas correctas, aceptacion real y que las acciones puntuales nunca queden solo como texto.

Fortalezas:

- Routing separado por `requestClass`.
- Chat general, chat action y week creator diferenciados.
- Proposals persistidas y aplicables.
- Prevalidacion antes de aplicar acciones.
- Recovery para acciones invalidas o truncadas.
- Stage logging y telemetria local.
- Salida estructurada por schema para `week_creator`.
- Normalizador compatible con JSON puro y `<actions>`.
- Postprocesado corrige fechas de ajustes puntuales y completa cargas de fuerza cuando hay 1RM.
- Postprocesado crea fallback `add_session` cuando el modelo responde solo texto ante una accion puntual clara.
- Tests locales verdes.

Pendiente:

- Probar `npm run e2e:dev:apply` en ambiente dev seguro.
- Generar 3-5 semanas reales y revisar si el owner las usaria con pocos ajustes.
- Confirmar que las semanas generadas por Gemini no dependen del fallback local.
- Revisar export Beta Quality despues de corridas aplicadas, no solo review-only.

### Plan Builder

Estado: base tecnica fortalecida y Fase 2 parcialmente implementada; falta prueba real profunda de generacion, aceptacion y calidad deportiva del plan completo.

Fortalezas:

- Wizard de competencia.
- Builder en `/plans/builder`.
- Shell por fases.
- Generacion semana a semana.
- Validacion y regeneracion.
- Soporte de semanas parciales por rango efectivo.
- Repair con fechas validas, cantidad esperada y minimo de deporte principal.
- Repair con seleccion de fuerza por bloque, perfil 1RM y metadata de lift estrella.
- Prompts de semana/batch alineados con cantidad efectiva y rango valido.
- Catalogos actuales enriquecidos con metadata de fase/rotacion/partner.
- Templates de fuerza por fase y rotacion A/B/C.
- Tests focalizados de catalogo, blocks, profile adapter, selector y wiring.
- Tests locales verdes.

Pendiente:

- Correr `npm run e2e:plan`.
- Correr `npm run e2e:plan:generate` con Gemini.
- Revisar calidad de semanas generadas.
- Correr `npm run e2e:plan:accept` solo en dev/local seguro.
- Validar que aceptar plan deja WeeklyView usable.
- Revisar telemetria `plan_builder_week` o `plan_builder_pair` en Settings.
- Validar metricas Fase 2 en un plan real de 8-12 semanas: rotacion de fuerza, uso de 1RM, variedad de drills y ausencia de templates repetidos.

### Fuerza y Preparacion Fisica

Estado: mejorado de forma sustantiva; falta QA manual focalizado.

Ya se corrigio/mejoro:

- Sesiones de 45-60 min no deberian caer automaticamente a 3 ejercicios.
- La duracion pesa mas en el target de ejercicios.
- Fatiga, taper y competencia cercana reducen volumen sin destruir la sesion salvo caso extremo.
- Prompt de fuerza refuerza estructura orientada a squash.
- Hay prescripcion por `%1RM`, RPE y warmups.
- UI/export/parser preservan la nueva informacion.
- Las sesiones se separan por zona de entrenamiento en UI/propuestas.
- Week Creator, Plan Builder, chat y fallback pasan por normalizacion/densificacion.
- Warm-up se ajusto a referencias reales tipo preparador fisico: movilidad/prep de tejidos, movilidad dinamica y aproximaciones.
- Cardio especifico queda al final y no reemplaza la fuerza principal.

Pendiente:

- Probar manualmente prompts de 45, 60 y 75 min.
- Probar con perfil con 1RM completo, parcial y sin 1RM.
- Revisar que fuerza para squash tenga activacion, potencia/coordinacion, fuerza principal, unilateral/lateral, tren superior, core y cierre opcional cuando corresponde.
- Revisar warnings `low_density:strength` en exports reales.
- Comparar 2-3 sesiones generadas contra las referencias PDF personales y ajustar heuristicas solo si hay patrones repetidos.

### Squash

Estado: mejorado, pero aun no cerrado.

Ya se corrigio:

- Drills clasificables por modalidad.
- Sesiones solo excluyen partner/match.
- Match queda al final.
- Sesiones mixtas pueden mostrar bloques.
- Week Creator fallback genera mas drills por sesion squash.
- Reglas explicitas de densidad squash estan en el prompt de Week Creator.
- Plan Builder repair protege minimo de squash en fases build/peak.

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

Estado: refactor modular suficientemente bueno para beta interna; no conviene seguir por estetica.

Ya se hizo:

- Baseline de prompts guardado en `docs/prompt-baseline-2026-05-13.json`.
- `npm run audit:prompt` falla si una requestClass se sale del rango esperado sin decision explicita.
- `outputContract.ts` concentra el contrato de acciones y `create_week`.
- Renderers de schema en prosa y JSON.
- `WeekCreatorPromptBuilder` consume contratos/renderers/packs.
- `chat_action` usa catalogo de acciones.
- `chat_general` migro su contrato lite e instrucciones generales.
- Pack de fuerza `quality/strengthLoad.ts` incorporado a prompts relevantes.
- Audit verde el 2026-05-25.

Decision actual:

- Cerrar este bloque de refactor como exitoso para beta interna.
- No seguir reduciendo `promptBuilder.ts` salvo evidencia de Beta Quality, loadtest o E2E aplicada.
- El siguiente candidato tecnico real es persistir telemetria resumida, no seguir moviendo texto de prompts sin impacto medible.

### Observabilidad Beta

Estado: suficiente para owner QA, insuficiente para beta externa.

Ya existe:

- Beta Quality local.
- Feedback positivo/negativo.
- Export local.
- Trace, provider, model, duration, outcome y requestClass visibles.
- Warnings de Week Creator incluyen causa de fallback y validacion deportiva.

Pendiente para beta externa:

- Persistir telemetria resumida en backend.
- No guardar prompts completos ni respuestas completas por defecto.
- Registrar outcome, requestClass, provider, model, duration, token counts si estan disponibles, retry/fallback, errorClass.
- Asociar feedback de usuario a trace/proposal/session.

## Plan de Cierre y Despliegue

### Ventana hasta 2026-05-29

Restriccion: no subir a produccion antes del 2026-05-29 por limite de Netlify.

Uso hasta esa fecha:

- Probar solo en DEV/local.
- No mezclar fixes de calidad deportiva con cambios de monetizacion, auth o providers.
- Guardar evidencia de cada bug real: prompt usado, propuesta, captura, export si corresponde.
- Priorizar sesiones de fuerza, Week Creator, Plan Builder y sync.
- No abrir beta a terceros todavia.

### 2026-05-29 - QA fuerte en DEV

Objetivo: decidir si el build esta listo para smoke prod.

Checklist:

- Correr validacion local completa.
- Correr `npm run loadtest:week-creator`.
- Crear al menos 3 semanas con Week Creator.
- Crear al menos 1 plan con Plan Builder.
- Crear sesiones puntuales desde chat:
  - fuerza mañana.
  - fuerza hoy PM.
  - squash tecnico.
  - movilidad/recovery.
- Revisar que fuerza tenga estructura completa y pesos cuando el perfil lo permita.
- Probar aceptar propuestas y verificar WeeklyView.
- Probar en mobile/desktop con sync normal.
- Exportar Beta Quality si aparecen fallos.

Decision:

- Si DEV esta estable, preparar deploy prod.
- Si aparece bug critico, corregir en DEV y repetir el flujo afectado.

### Post 2026-05-29 - Smoke Prod Controlado

Objetivo: validar que prod no rompa por build, env vars, Netlify Function, auth o Supabase.

Pasos:

- Deploy prod.
- Login real.
- Crear una sesion puntual desde chat.
- Crear una semana desde Week Creator.
- Aceptar una propuesta simple.
- Revisar Settings/traces.
- Probar app en mobile.

Criterio de salida:

- Proxy responde.
- No hay `misconfigured`.
- No hay keys privadas expuestas.
- No hay loaders pegados.
- Proposals se aplican una vez.
- Sync converge entre dispositivos.

### Beta Privada

Objetivo: usar con 3-5 personas cercanas cuando prod este estable.

Antes de invitar:

- Dejar disclaimer beta.
- Tener canal simple de feedback.
- Tener instruccion corta para exportar/reportar bugs.
- Tener limites diarios o monitoreo manual de uso de IA.

Durante beta privada:

- Revisar feedback semanal.
- Clasificar fallos por causa:
  - formato/provider.
  - calidad deportiva.
  - fechas.
  - sync.
  - UI/aplicacion de propuestas.
- Corregir bugs pequenos con tests focalizados.

### Beta Ampliada

Objetivo: invitar mas personas solo cuando beta privada sea estable.

Requisitos previos:

- Sin perdida de datos reportada.
- Feedback negativo bajo en Week Creator y fuerza.
- Sync estable en al menos 2 dispositivos propios y 1-2 usuarios privados.
- Proposals aplicables sin confusion.
- Telemetria/feedback minimo suficiente para entender errores.

## Roadmap por Fases

### Fase 1 - Cerrar Owner QA en DEV

Objetivo: que el owner confie en usar la app en DEV antes del 2026-05-29.

Checklist inmediato:

- Repetir `npm run e2e:dev`.
- Repetir `npm run e2e:plan`.
- Correr `npm run e2e:dev:apply` en dev seguro.
- Correr `npm run e2e:plan:generate`.
- Correr `npm run loadtest:week-creator`.
- Generar al menos 5 semanas con el coach.
- Generar al menos 2 planes con Plan Builder.
- Revisar Settings/Beta Quality despues de cada bloque.
- Guardar exports relevantes.
- Probar auto-sync PC/celular sin presionar `SYNC`.
- Revisar 3-5 sesiones squash tecnicas/mixtas para densidad de drills.
- Revisar 3-5 sesiones de fuerza con estructura completa:
  - warm-up.
  - zona media.
  - fuerza.
  - cardio especifico si aplica.
  - cool-down.
  - `%1RM`, RPE, pesos y warmups si hay perfil.

Criterio de salida:

- La app no crashea.
- El coach responde sin loaders pegados.
- Las proposals se aplican una sola vez.
- Week Creator genera semanas razonables sin caer al fallback local en casos normales.
- Plan Builder genera semanas revisables.
- Las fechas caen dentro del rango solicitado.
- El owner usaria al menos una semana generada casi sin cambios.
- Una sesion puntual de fuerza creada por chat queda aplicable sin tener que pedirlo de nuevo.

### Fase 2 - Hardening de Calidad

Objetivo: convertir fallos observados en fixes puntuales y cerrar la especificidad deportiva del Plan Builder antes de ampliar beta.

Prioridades:

- Completar QA real de Plan Builder Fase 2 con perfil squash competitivo y 1RM completos.
- Medir si el plan cumple rotacion de fuerza, lift estrella y variedad de drills en 8-12 semanas.
- Ajustar selector de fuerza solo con evidencia de planes reales, no por intuicion.
- Ajustar prompts solo donde haya evidencia.
- Ajustar selectors deportivos si el output es valido pero deportivamente pobre.
- Mejorar normalizer/schema solo si hay fallos de formato repetidos.
- Mantener cambios pequenos y testeados.
- Agregar tests focalizados para cada bug real.
- Usar exports Beta Quality como fuente principal para priorizar.
- Revisar si la prescripcion de carga necesita limites por experiencia, fatiga o semana de competencia.

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
- Export/import conserva conteos y campos nuevos de fuerza.
- Reset local y reset nube solo en ambiente seguro.
- Abrir app en dispositivo B y verificar sync automatico sin tocar boton.

Criterio de salida:

- No hay duplicados.
- No reaparecen deletes.
- La UI comunica estado de sync.
- El usuario entiende si hay cola pendiente o error.
- El boton `SYNC` queda como respaldo, no como paso obligatorio.

### Fase 4 - Smoke Prod Controlado desde 2026-05-29

Objetivo: validar build, env vars, Netlify Function, Supabase auth y proxy real.

Pasos locales:

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

### Fase 5 - Beta Privada 3-5 Usuarios

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

### Fase 6 - Beta Ampliada y Operacion

Objetivo: abrir a mas personas con menor riesgo operacional.

Trabajos antes de ampliar:

- Persistir telemetria resumida.
- Persistir feedback asociado a trace/proposal/session.
- Definir limites diarios por usuario/requestClass.
- Documentar criterios de soporte beta.
- Mantener rollback mental claro: si sync o propuestas fallan, pausar invitaciones.

### Fase 7 - Proveedores, Costos y Persistencia

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
- Si se toca modelo/export, probar backup viejo y backup nuevo.

## Que No Hacer Ahora

- No abrir beta publica.
- No subir a prod antes del 2026-05-29 por la limitacion actual de Netlify.
- No construir paywall.
- No sumar integraciones externas.
- No reescribir prompt builder por estetica.
- No cambiar Gemini como default sin datos.
- No meter analytics invasivos.
- No agregar features antes de cerrar estabilidad.

## Nota de Direccion

La prioridad no es que Entrenador sea mas ambicioso. La prioridad es que sea confiable: que genere semanas razonables, que respete fechas, que la fuerza tenga cargas accionables, que Plan Builder no se caiga, que sync no sorprenda y que cada fallo deje una pista clara. Cuando eso ocurra repetidamente en dev y luego en prod, recien ahi tiene sentido invitar usuarios.
